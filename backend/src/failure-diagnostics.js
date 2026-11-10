const sqlStatePattern = /^[0-9A-Z]{5}$/;
const prismaCodePattern = /^P\d{4}$/;

/**
 * Return only safe, structured fields for server logs and a small public class.
 * Prisma error messages and metadata can contain query text or private values,
 * so they are intentionally never copied into this result.
 */
export function classifyBackendFailure(error) {
  if (error?.cause && error.cause !== error) {
    const nested=classifyBackendFailureWithoutCause(error.cause);
    if(nested.kind!=='UNCLASSIFIED')return nested;
  }
  return classifyBackendFailureWithoutCause(error);
}
function classifyBackendFailureWithoutCause(error) {
  const prismaCode = typeof error?.code === 'string' && prismaCodePattern.test(error.code)
    ? error.code : null;
  const sqlState = typeof error?.meta?.code === 'string' && sqlStatePattern.test(error.meta.code)
    ? error.meta.code
    : typeof error?.code === 'string' && sqlStatePattern.test(error.code) ? error.code : null;

  if (prismaCode === 'P1010' || sqlState === '42501') {
    return {kind:'DATABASE_PERMISSION', prismaCode, sqlState, httpStatus:500, responseCode:'DATABASE_PERMISSION_DENIED'};
  }
  if (prismaCode === 'P1000' || sqlState === '28P01') {
    return {kind:'DATABASE_CREDENTIAL_CONFIGURATION', prismaCode, sqlState, httpStatus:500, responseCode:'DATABASE_CONFIGURATION_ERROR'};
  }
  if (['P2021','P2022'].includes(prismaCode)) {
    return {kind:'DATABASE_SCHEMA_CONFIGURATION', prismaCode, sqlState, httpStatus:500, responseCode:'DATABASE_SCHEMA_ERROR'};
  }
  if (['P1001','P1002','P1008','P1017'].includes(prismaCode) ||
      (sqlState && (sqlState.startsWith('08') || ['53300','53400','57P01','57P02','57P03','58030'].includes(sqlState))) ||
      ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EHOSTUNREACH'].includes(error?.code)) {
    return {kind:'DATABASE_UNAVAILABLE', prismaCode, sqlState, httpStatus:503, responseCode:'SERVICE_UNAVAILABLE'};
  }
  const runtime=['TypeError','ReferenceError','SyntaxError','RangeError'].includes(error?.name);
  return {kind:runtime?'JAVASCRIPT_RUNTIME':'UNCLASSIFIED', prismaCode, sqlState, httpStatus:runtime?500:503, responseCode:runtime?'INTERNAL_ERROR':'SERVICE_UNAVAILABLE'};
}

// Source locations only: no exception message, arguments, paths, SQL or payload.
export function developmentFailureLocations(error) {
 const result=[];const visited=new Set();
 for(let e=error;e&&result.length<4&&!visited.has(e);e=e.cause){
  visited.add(e);
  const name=/^[A-Za-z][A-Za-z0-9]{0,70}$/.test(e.name??'')?e.name:'Error';
  const locations=String(e.stack??'').split('\n').slice(1).flatMap(line=>{
   const match=line.match(/(?:\/|\\)([A-Za-z0-9_.-]+\.[cm]?js):(\d+):(\d+)\)?\s*$/);
   return match?[`${match[1]}:${match[2]}:${match[3]}`]:[];
  }).slice(0,4);
  const text=String(e.message??'').toLowerCase();
  const findings=['cached plan must not change result type','prepared statement','permission denied','does not exist','unsupported type','inconsistent column data','transaction already closed','connection closed'].filter(term=>text.includes(term));
  result.push({name,locations,operation:e.ingestionOperation??null,findings});
 }
 return result;
}

// Operation names come from source code, never from query arguments or values.
export function tracedTamperTransaction(tx) {
 const models=new Set(['device','deviceEvent','assignment','alert']);
 const invoke=(owner,key,label)=>(...args)=>Promise.resolve().then(()=>owner[key](...args)).catch(error=>{
  if(error&&typeof error==='object'&&!error.ingestionOperation)Object.defineProperty(error,'ingestionOperation',{value:label,configurable:true});
  throw error;
 });
 return new Proxy(tx,{get(target,key){
  if(key==='$queryRaw')return (...args)=>{
   const sql=Array.isArray(args[0])?args[0].join('?'):'';
   const operation=sql.includes('clock_timestamp()')?'tamper.clock':sql.includes('FROM "Device"')?'tamper.lockDevice':sql.includes('FROM "Child"')?'tamper.lockChild':'tamper.raw';
   return invoke(target,key,operation)(...args);
  };
  if(models.has(key))return new Proxy(target[key],{get(model,method){return typeof model[method]==='function'?invoke(model,method,`tamper.${key}.${String(method)}`):model[method];}});
  return target[key];
 }});
}

