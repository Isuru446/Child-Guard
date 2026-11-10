// Shared Admin cookie-session provider and route gate.
import { useContext, useEffect, useSyncExternalStore } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { CookieAdminSessionContext } from '../lib/admin-session-context';
export function CookieAdminSessionProvider({client,children}) {
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
  useEffect(()=>{
    client.restore().catch(()=>{});
    return client.bindTrustedActivity(window,()=>{});
  },[client]);
  useEffect(()=>{
    if(state.status!=='ready')return;
    // Timer verifies expiry with a read; it never calls activity/renews a session.
    const timer=setTimeout(()=>{client.restore().catch(()=>{});},Math.max(0,client.remainingMs())+25);
    return()=>clearTimeout(timer);
  },[client,state]);
  return <CookieAdminSessionContext.Provider value={client}>{children}</CookieAdminSessionContext.Provider>;
}
export function CookieAdminSessionGate({children,signedOut}) {
  const location=useLocation();
  const client=useContext(CookieAdminSessionContext);
  const state=useSyncExternalStore(client.subscribe,client.getSnapshot,client.getSnapshot);
  if(state.status==='signed-out')return signedOut ?? <Navigate to="/login" replace state={{sessionMessage:state.message,returnTo:location.pathname+location.search+location.hash}}/>;
  if(state.status==='ready'&&state.user?.role!=='ADMIN')return signedOut ?? <Navigate to="/login" replace/>;
  if(state.status==='error')return <div role="alert"><p>{state.message}</p><button onClick={()=>{client.restore().catch(()=>{});}}>Retry</button></div>;
  if(state.status!=='ready')return <p role="status">Checking administrator session…</p>;
  return children;
}
