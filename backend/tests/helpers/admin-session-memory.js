// Memory-only transactional fixture; never imports Prisma, dotenv or application startup.
import { randomBytes } from 'node:crypto';
import { SessionService, SessionError } from '../../src/admin-session-service.js';
export function sessionFixture() {
 let clock=Date.parse('2026-10-25T08:00:00.000Z');
 let state={user:{id:'user-a',username:'admin',passwordHash:'verified-hash',role:'ADMIN',active:true,centerId:'center-a',authVersion:0},sessions:[],domain:[],audits:[]};
 let tail=Promise.resolve(), updates=0;
 const locked=work=>{const pending=tail.then(async()=>{const snapshot=structuredClone(state);try{return await work();}catch(e){state=snapshot;throw e;}});tail=pending.catch(()=>{});return pending;};
 function context(session) {
  return {user:state.user,session,db:{domain:state.domain},now:async()=>new Date(clock),
   insert:async row=>state.sessions.push(structuredClone(row)),
   audit:async(action,resourceId)=>state.audits.push({userId:state.user.id,action,resourceId}),
   update:async data=>{if(data.lastActivityAt && (session.revokedAt || +session.idleExpiresAt<=clock || +session.absoluteExpiresAt<=clock))throw new SessionError('SESSION_EXPIRED');updates++;Object.assign(session,data);},
   async refresh(){this.user=state.user;this.session=state.sessions.find(s=>s.id===session.id);}
  };
 }
 const repository={forUser:(id,work)=>locked(()=>work(context(null))),forCredential:(hash,work)=>locked(()=>work(context(state.sessions.find(s=>s.credentialHash===hash)||null)))};
 const csrfKey=randomBytes(32);
 const service=new SessionService({repository,csrfKey});
 return {service,repository,csrfKey,get state(){return state;},get updates(){return updates;},get clock(){return clock;},tick:ms=>{clock+=ms;},
  login:()=>service.create({userId:'user-a',verifiedPasswordHash:'verified-hash'})};
}
