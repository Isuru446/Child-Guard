import {useEffect,useState} from 'react';
export default function TamperStatus({tamper,now,unavailable=false}) {
 const [clock,setClock]=useState(()=>Date.now());
 useEffect(()=>{if(now!==undefined)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[now]);
 const age=(now??clock)-Date.parse(tamper?.observedAt);
 const fresh=!unavailable&&tamper?.stale===false&&Number.isFinite(age)&&age>=0&&age<=(tamper.staleAfterMs||60000);
 const state=fresh?tamper.state:'UNKNOWN';
 const label=state==='OPEN'?'Disconnected':state==='CLOSED'?'Connected':'Unavailable';
 return <div><span className={`dv-badge ${state==='OPEN'?'dv-badge--danger':state==='CLOSED'?'dv-badge--success':'dv-badge--unknown'}`} role={state==='OPEN'?'status':undefined}>Tamper loop: {label}</span>
  {!fresh&&['OPEN','CLOSED'].includes(tamper?.lastKnownState)&&<small> · Last known: {tamper.lastKnownState==='OPEN'?'Disconnected':'Connected'}</small>}
  {tamper?.transitionAt&&<small> · Changed {new Date(tamper.transitionAt).toLocaleString()}</small>}
  {tamper?.observedAt&&<small> · Observed {new Date(tamper.observedAt).toLocaleString()}</small>}
 </div>;
}
