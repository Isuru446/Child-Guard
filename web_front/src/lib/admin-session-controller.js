// Admin cookie client. The only browser marker is a non-secret sign-out intent.
import { createAdminSessionAdapter } from './admin-session-adapter';
export function createAdminSessionController({storage=window.sessionStorage,...options}={}) {
  const marker='childguardAdminLogoutPending';
  let snapshot=Object.freeze({status:'checking'});
  const listeners=new Set();
  const publish=value=>{snapshot=Object.freeze(value);listeners.forEach(fn=>fn());};
  const pending=()=>storage.getItem(marker)==='1';
  // Retire legacy browser credentials when the cookie client is constructed.
  storage.removeItem('childguardToken');storage.removeItem('childguardAdminName');
  const adapter=createAdminSessionAdapter({...options,
    onEnded:message=>publish({status:'signed-out',message}),
    onSession:data=>{if(!pending())publish({status:'ready',...data});},
  });
  return {
    getSnapshot:()=>snapshot,
    subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    async login(username,password) {
      if(pending())await this.retryLogout();
      publish({status:'checking'});
      return adapter.login(username,password);
    },
    async restore() {
      if(pending()){publish({status:'signed-out',message:'Signed out on this device. Server sign-out is not yet confirmed.'});return;}
      publish({status:'checking'});
      try{return await adapter.restore();}
      catch(e){if(e.code!=='STALE_RESPONSE')publish({status:e.status===401?'signed-out':'error',message:e.message});throw e;}
    },
    async logout() {
      storage.setItem(marker,'1');
      try {const result=await adapter.logout();storage.removeItem(marker);return result;}
      catch(e){publish({status:'signed-out',message:'Signed out on this device. Server sign-out is not yet confirmed.'});throw e;}
    },
    async retryLogout() {
      // Recover CSRF without rendering private content or restoring local login.
      try {await adapter.restore();await adapter.logout();storage.removeItem(marker);publish({status:'signed-out'});}
      catch(e){if(e.status===401){storage.removeItem(marker);publish({status:'signed-out'});return;}throw e;}
    },
    request:(path,opts)=>snapshot.status==='ready'?adapter.request(path,opts):Promise.reject(Object.assign(Error('Sign in required'),{status:401})),
    privatePhoto:id=>snapshot.status==='ready'?adapter.privatePhoto(id):Promise.reject(Object.assign(Error('Sign in required'),{status:401})),
    bindTrustedActivity:(...args)=>adapter.bindTrustedActivity(...args),
    remainingMs:()=>adapter.remainingMs(),
  };
}
