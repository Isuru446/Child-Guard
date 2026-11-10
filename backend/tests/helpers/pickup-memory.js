// Extends only synthetic memory. No database/client/environment imports.
import { randomUUID } from 'node:crypto';
export function pickupMemory(m,f,vi){
 for(const name of ['pickupPhoto','authorizedPickupPerson','pickupRequest'])m.data()[name]=[];
 const users=()=>[f.state.user,...m.data().user];
 const profiles=new Map();let installed=true;
 const hydrate=(model,r)=>r&&({...r,child:m.data().child.filter(c=>c.id===r.childId).map(c=>({...c,guardians:m.data().guardian.filter(g=>g.childId===c.id)}))[0],requestedBy:users().find(u=>u.id===r.requestedById),reviewedBy:users().find(u=>u.id===r.reviewedById)??null,verifiedBy:users().find(u=>u.id===r.verifiedById)??null});
 function match(r,w={}){return !!r&&Object.entries(w).every(([k,v])=>v===undefined?true:k==='OR'?v.some(x=>match(r,x)):k==='AND'?v.every(x=>match(r,x)):v===null||typeof v!=='object'?r[k]===v:v instanceof Date?+r[k]===+v:v.in?v.in.includes(r[k]):v.some?r[k]?.some(x=>match(x,v.some)):v.lte!==undefined?+r[k]<=+v.lte:v.gt!==undefined?+r[k]>+v.gt:match(r[k],v));}
 function project(r,s){if(!r)return null;if(!s)return structuredClone(r);return Object.fromEntries(Object.entries(s).map(([k,v])=>[k,v===true?r[k]:project(r[k],v.select)]));}
 for(const model of ['pickupPhoto','authorizedPickupPerson','pickupRequest']){
  const rows=()=>m.data()[model];const find=(where,select)=>project(hydrate(model,rows().find(r=>match(hydrate(model,r),where))),select);
  m.db[model]={count:vi.fn(async({where}={})=>rows().filter(r=>match(hydrate(model,r),where)).length),findFirst:vi.fn(async({where,select}={})=>find(where,select)),findUnique:vi.fn(async({where,select})=>find(where,select)),findMany:vi.fn(async({where,select,take=100,skip=0}={})=>rows().filter(r=>match(hydrate(model,r),where)).slice(skip,skip+take).map(r=>project(hydrate(model,r),select))),
   create:vi.fn(async({data,select})=>{const r={id:randomUUID(),createdAt:new Date(f.clock),updatedAt:new Date(f.clock),...(model==='pickupRequest'?{status:'PENDING',attempts:0,codeIssues:1,verifiedAt:null,verifiedById:null,handoverHash:null,reviewedById:null}:{}),...(model==='authorizedPickupPerson'?{active:true}:{}),...data};rows().push(r);return project(hydrate(model,r),select);}),
   update:vi.fn(async({where,data,select})=>{const r=rows().find(r=>match(r,where));if(!r)throw Error('missing synthetic record');for(const[k,v]of Object.entries(data))r[k]=v&&typeof v==='object'&&'increment'in v?r[k]+v.increment:v;return project(hydrate(model,r),select);}),
   updateMany:vi.fn(async({where,data})=>{const selected=rows().filter(r=>match(hydrate(model,r),where));for(const r of selected)Object.assign(r,data);return {count:selected.length};}),
  };
 }
 m.db.$queryRaw=vi.fn(async(strings)=>strings.join('').includes('to_regclass')?[{installed,available:true}]:[{now:new Date(f.clock)}]);
 m.db.center={findUnique:vi.fn(async()=>({id:m.parent.centerId,name:'Synthetic School'}))};
 const hydratedUsers=()=>users().map(u=>({...u,guardians:m.data().guardian.filter(g=>g.userId===u.id),profile:profiles.get(u.id)??null}));
 m.db.user.findFirst=vi.fn(async({where,select})=>project(hydratedUsers().find(u=>match(u,where)),select));
 m.db.user.findMany=vi.fn(async({where,select})=>hydratedUsers().filter(u=>match(u,where)).map(u=>project(u,select)));
 return {profiles,uninstall:()=>{installed=false;}};
}
