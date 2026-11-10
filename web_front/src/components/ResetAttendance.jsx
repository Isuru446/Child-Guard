import { useRef, useState } from 'react';
import { api } from '../lib/api';
import ActionButton from './ActionButton';

export default function ResetAttendance({ row }) {
 const [busy,setBusy]=useState(false);
 const [feedback,setFeedback]=useState(null);
 const inFlight=useRef(false);
 if(!row.canReset) return feedback ? <p role={feedback.error?'alert':'status'}>{feedback.text}</p> : null;
 const reset=async()=>{
  if(inFlight.current || !window.confirm(`Development reset for ${row.child?.name || row.childId}: confirmation history is preserved. Attendance returns to NOT_CHECKED_IN and danger monitoring is disarmed. Move the wearable to confirmed FAR, then approach again. Continue?`)) return;
  inFlight.current=true;setBusy(true);setFeedback(null);
  try {
   await api(`/api/v1/attendance/${encodeURIComponent(row.id)}/reset`,{method:'POST',body:JSON.stringify({confirmedAt:row.confirmations[0]?.confirmedAt})});
   setFeedback({text:'Development attendance reset completed.',error:false});
   window.dispatchEvent(new Event('childguard:attendance-updated'));
  } catch(error) {setFeedback({text:error.message,error:true});}
  finally {inFlight.current=false;setBusy(false);}
 };
 return <><ActionButton disabled={busy} onClick={reset}>{busy?'Resetting…':'Reset Attendance'}</ActionButton>{feedback && <p role={feedback.error?'alert':'status'}>{feedback.text}</p>}</>;
}
