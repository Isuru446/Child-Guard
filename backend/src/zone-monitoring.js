// Server-created authorization on immutable DeviceEvent JSON; no client armed flag.
// Freshness is checked when departure is accepted, not continuously afterwards.
export function zoneSessionKey({device,assignment,attendance,confirmation,resetCycle,boot}) {
 if(!boot || !assignment || !attendance || attendance.status!=='PRESENT' || attendance.gatePassAuthorized || !confirmation) return null;
 return JSON.stringify([device.id,device.centerId,assignment.id,assignment.childId,attendance.id,confirmation.id??null,confirmation.userId,+confirmation.confirmedAt,resetCycle?.id??null,boot]);
}
export async function verifiedDeparture(db,context) {
 const key=zoneSessionKey(context);
 if(!key)return null;
 return db.deviceEvent.findFirst({where:{deviceId:context.device.id,childId:context.assignment.childId,eventType:'BLE_PROXIMITY',beacon:{centerId:context.device.centerId,kind:'GATE',active:true},payload:{path:['zoneDeparture','key'],equals:key}},orderBy:{observedAt:'asc'}});
}
