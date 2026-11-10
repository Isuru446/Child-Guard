// Synthetic transactional persistence only; no Prisma, env loader or DB connection.
import { randomUUID } from 'node:crypto';
export function attendanceMemory(f,{hash,tokenHash,rfid=false}) {
 const centerId='center-a';
 const user=(role,center=centerId)=>({id:randomUUID(),username:role.toLowerCase()+'-'+center,role,active:true,centerId:center,passwordHash:hash});
 const teacher=user('TEACHER'),otherTeacher=user('TEACHER','center-b'),parent=user('PARENT');
 const child={id:randomUUID(),name:'Registered child',centerId},unrecorded={id:randomUUID(),name:'Unrecorded child',centerId},foreignChild={id:randomUUID(),name:'Foreign child',centerId:'center-b'};
 const device={id:randomUUID(),hardwareId:'CG-WORKFLOW',tokenHash,active:true,centerId,lastSeen:null};
 const gate={id:randomUUID(),hardwareId:'CG-GATE-01',centerId,active:true,kind:'GATE',entryRssi:-63,exitRssi:-69,serviceUuid:randomUUID(),name:'',location:''};
 f.state.domain.push({...(rfid?{rfidReader:[],rfidCard:[],rfidEnrollment:[],rfidScan:[]}:{}),user:[teacher,otherTeacher,parent],child:[child,unrecorded,foreignChild],guardian:[{userId:parent.id,childId:child.id}],device:[device],beacon:[gate],assignment:[{id:randomUUID(),deviceId:device.id,childId:child.id,startedAt:new Date(f.clock-1000),endedAt:null}],attendance:[],confirmation:[],observation:[],deviceEvent:[],auditLog:[],activityAttendanceSession:[],alert:[]});
 const data=()=>f.state.domain[0],allUsers=()=>[f.state.user,...data().user];
 function matches(row,where={}) {
  return Object.entries(where).every(([key,v])=>{
   if(v===undefined)return true;if(key==='NOT')return !matches(row,v);if(key==='OR')return v.some(w=>matches(row,w));if(key==='AND')return v.every(w=>matches(row,w));
   if(key==='childId_day'||key==='attendanceId_startedAt'||key==='readerId_readerBootId_scanSequence')return matches(row,v);
   let value=row?.[key];if(v===null||typeof v!=='object'||v instanceof Date)return v instanceof Date?+value===+v:value===v;
   if(v.path)value=v.path.reduce((p,k)=>p?.[k],value);
   if(v.some)return value?.some(r=>matches(r,v.some));if(v.none)return !value?.some(r=>matches(r,v.none));if(v.in)return v.in.includes(value);
   if(v.contains!==undefined)return String(value).toLowerCase().includes(v.contains.toLowerCase());if(v.startsWith!==undefined)return String(value).startsWith(v.startsWith);
   if(Object.hasOwn(v,'gte')||Object.hasOwn(v,'lte')||Object.hasOwn(v,'gt')||Object.hasOwn(v,'lt'))return value!==undefined&&value!==null&&(v.gte===undefined||value>=v.gte)&&(v.lte===undefined||value<=v.lte)&&(v.gt===undefined||value>v.gt)&&(v.lt===undefined||value<v.lt);
   if(v.equals!==undefined)return value===v.equals;
   return matches(value,v);
  });
 }
 function sorted(rows,orderBy){
  if(!orderBy)return rows;const fields=Array.isArray(orderBy)?orderBy:[orderBy];
  return [...rows].sort((a,b)=>{for(const o of fields){const [key,order]=Object.entries(o)[0];if(typeof order==='object'){const nested=sorted([a[key],b[key]],[order]);if(nested[0]!==nested[1])return nested[0]===a[key]?-1:1;}else{const cmp=a[key]<b[key]?-1:a[key]>b[key]?1:0;if(cmp)return order==='desc'?-cmp:cmp;}}return 0;});
 }
 function hydrate(model,row){
  if(!row)return null;const r={...row};
  if(model==='child'){r.guardians=data().guardian.filter(g=>g.childId===r.id);r.attendance=data().attendance.filter(a=>a.childId===r.id).map(a=>({...a,child:{...row},confirmations:data().confirmation.filter(c=>c.attendanceId===a.id).map(c=>hydrate('confirmation',c)),observations:data().observation.filter(o=>o.attendanceId===a.id).map(o=>hydrate('observation',o))}));}
  if(model==='attendance'){r.child=data().child.find(c=>c.id===r.childId);r.confirmations=data().confirmation.filter(c=>c.attendanceId===r.id).map(c=>hydrate('confirmation',c));r.observations=data().observation.filter(o=>o.attendanceId===r.id).map(o=>hydrate('observation',o));}
  if(model==='confirmation'||model==='auditLog')r.user=allUsers().find(u=>u.id===r.userId);
  if(model==='confirmation'&&rfid)r.reader=data().rfidReader.find(v=>v.id===r.readerId)??null;
  if(model==='rfidCard'){r.issuedBy=allUsers().find(u=>u.id===r.issuedById);r.reader=data().rfidReader.find(v=>v.id===r.readerId);}
  if(model==='observation')r.event=hydrate('deviceEvent',data().deviceEvent.find(e=>e.id===r.eventId));
  if(model==='deviceEvent'){r.device=data().device.find(d=>d.id===r.deviceId);r.beacon=data().beacon.find(b=>b.id===r.beaconId);r.child=data().child.find(c=>c.id===r.childId);}
  if(model==='alert')r.event=hydrate('deviceEvent',data().deviceEvent.find(e=>e.id===r.eventId));
  if(model==='assignment'){r.child=data().child.find(c=>c.id===r.childId);r.device=data().device.find(d=>d.id===r.deviceId);}
  return r;
 }
 function project(row,select,include){
  if(!row)return null;
  const relations=new Set(['child','user','event','device','beacon','confirmations','observations','attendance','guardians']);
  const scalar=Object.fromEntries(Object.entries(row).filter(([key])=>!relations.has(key)));
  if(!select&&!include)return structuredClone(scalar);
  const out=select?{}:{...scalar};
  for(const [key,value] of Object.entries(select??include)){
   if(value===true){out[key]=row[key];continue;}
   if(Array.isArray(row[key]))out[key]=sorted(row[key].filter(r=>matches(r,value.where)),value.orderBy).slice(0,value.take??Infinity).map(r=>project(r,value.select,value.include));
   else out[key]=project(row[key],value.select,value.include);
  }return out;
 }
 const db={};let auditFailure=false;
 for(const model of Object.keys(data())){
  const rows=()=>model==='user'?allUsers():data()[model];
  const find=where=>rows().map(r=>hydrate(model,r)).find(r=>matches(r,where));
  db[model]={findUnique:viFn(async({where,select,include})=>project(find(where),select,include)),findFirst:viFn(async({where,select,include,orderBy})=>project(sorted(rows().map(r=>hydrate(model,r)).filter(r=>matches(r,where)),orderBy)[0],select,include)),findMany:viFn(async({where,select,include,orderBy,take=100,skip=0}={})=>sorted(rows().map(r=>hydrate(model,r)).filter(r=>matches(r,where)),orderBy).slice(skip,skip+take).map(r=>project(r,select,include))),count:viFn(async({where}={})=>rows().map(r=>hydrate(model,r)).filter(r=>matches(r,where)).length),
   create:viFn(async({data:input,select})=>{
    if(model==='auditLog'&&auditFailure)throw Error('synthetic-private-audit-error');
    const r={id:randomUUID(),createdAt:new Date(f.clock),...(model==='rfidReader'?{active:true,modeVersion:0}:model==='rfidEnrollment'?{status:'PENDING'}:model==='rfidCard'?{status:'ACTIVE'}:{}),...input};data()[model].push(r);return project(hydrate(model,r),select);
   }),update:viFn(async({where,data:input,select})=>{const r=rows().find(r=>matches(r,where));Object.assign(r,input);return project(hydrate(model,r),select);}),
  };
  db[model].upsert=viFn(async({where,create,update})=>find(where)?db[model].update({where,data:update}):db[model].create({data:create}));
  if(model.startsWith('rfid'))db[model].updateMany=viFn(async({where,data:input})=>{let count=0;for(const row of rows().filter(r=>matches(r,where))){Object.assign(row,input);count++;}return {count};});
 }
 db.attendance.groupBy=viFn(async({where})=>{const grouped=new Map();for(const r of data().attendance.map(a=>hydrate('attendance',a)).filter(a=>matches(a,where))){const key=r.day+'|'+r.status;const g=grouped.get(key)??{day:r.day,status:r.status,_count:{_all:0}};g._count._all++;grouped.set(key,g);}return [...grouped.values()];});
 db.$queryRaw=viFn(async(strings,...values)=>{
  const sql=strings?.join('')??'';
  if(rfid&&sql.includes('to_regclass'))return [{installed:sql.includes('RfidReader')}];
  if(rfid&&sql.includes('FROM "RfidScan" s JOIN'))return data().rfidScan.filter(s=>s.changed&&s.centerId===values[1]&&data().attendance.some(a=>a.id===s.attendanceId&&a.childId===values[0])).map(s=>({id:'rfid:'+s.id,kind:'ATTENDANCE_CONFIRMED_RFID',createdAt:s.receivedAt}));
  if(rfid&&sql.includes('SELECT l.id, l.action AS kind'))return [];
  return [{now:new Date(f.clock)}];
 });let tail=Promise.resolve();
 db.$transaction=viFn((work,options)=>{const result=tail.then(async()=>{const snapshot=structuredClone(f.state.domain);try{return await work(db);}catch(e){f.state.domain.splice(0,f.state.domain.length,...snapshot);throw e;}});tail=result.catch(()=>{});return result;});
 return {db,data,teacher,otherTeacher,parent,child,unrecorded,foreignChild,device,gate,failAudit:()=>{auditFailure=true;}};
}
// Injecting the spy factory keeps this fixture free of runtime service imports.
let viFn=work=>work;
export function instrumentAttendanceMemory(fn){viFn=fn;}
