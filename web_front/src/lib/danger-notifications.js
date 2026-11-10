// Session-local presentation only. No persisted unread/acknowledgement claims.
export function createDangerNotifications(){
 const seen=new Set();let primed=false;
 return {read(rows){
  const fresh=rows.filter(r=>['DANGER_ZONE_NEAR','TAMPER_LOOP_OPEN'].includes(r.kind)&&!seen.has(r.id));
  for(const row of rows)seen.add(row.id);
  while(seen.size>512)seen.delete(seen.values().next().value);
  if(!primed){primed=true;return [];}
  return fresh;
 }};
}
