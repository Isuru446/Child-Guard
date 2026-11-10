import { useContext, useEffect, useState } from 'react';
import { CookieAdminSessionContext } from '../lib/admin-session-context';
import { CookieAdminSessionGate } from './CookieAdminSession';
import { Navigate, useLocation } from 'react-router-dom';
import { api, clearSession, hasToken } from '../lib/api';

export default function AdminSessionGate({children, signedOut}) {
 const session=useContext(CookieAdminSessionContext);
 return session?<CookieAdminSessionGate signedOut={signedOut}>{children}</CookieAdminSessionGate>:<LegacyAdminSessionGate signedOut={signedOut}>{children}</LegacyAdminSessionGate>;
}
function LegacyAdminSessionGate({ children, signedOut }) {
 const location=useLocation();
 const [state,setState]=useState(()=>({status:hasToken()?'loading':'signed-out'}));
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true;
  const ended=event=>{if(active)setState({status:'signed-out',message:event.detail?.message});};
  window.addEventListener('childguard:session-ended',ended);
  if(hasToken()) {
   api('/api/v1/auth/me').then(user=>{
    if(!active||!hasToken())return;
    if(user?.role!=='ADMIN'){clearSession();return;}
    sessionStorage.setItem('childguardAdminName',user.username||'Admin');
    setState({status:'ready'});
   }).catch(error=>{
    if(active)setState(previous=>hasToken()?{status:'error',error:error.message}:previous.status==='signed-out'?previous:{status:'signed-out'});
   });
  }
  return ()=>{active=false;window.removeEventListener('childguard:session-ended',ended);};
 },[attempt]);
 if(state.status==='signed-out')return signedOut ?? <Navigate to="/login" replace state={{sessionMessage:state.message, returnTo:location.pathname+location.search+location.hash}}/>;
 if(state.status==='error')return <div role="alert"><p>{state.error}</p><button onClick={()=>{setState({status:'loading'});setAttempt(value=>value+1);}}>Retry</button></div>;
 if(state.status!=='ready')return <p role="status">Checking administrator session…</p>;
 return children;
}
