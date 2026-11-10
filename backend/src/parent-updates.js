// Read-only saved routine evidence, merged with explicitly volatile transport rows.
// No notification rows, inferred expiry events, secrets or medical reasons.
import {rfidInstalled} from './rfid-storage.js';
export async function parentUpdates(db,child,{limit,offset,volatileRows=[]}) {
 const take=limit+offset;
 const attendance=await db.$queryRaw`
  SELECT l.id, l.action AS kind, l."createdAt" AS "createdAt", NULL::jsonb AS details
  FROM "AuditLog" l JOIN "Attendance" a ON a.id=l."resourceId"
  JOIN "Child" c ON c.id=a."childId"
  WHERE c.id=${child.id} AND c."centerId"=${child.centerId}
   AND (l.action IN ('ATTENDANCE_CONFIRMED_TEACHER','ATTENDANCE_CONFIRMED_ADMIN','ATTENDANCE_ABSENCE_CORRECTED')
    OR strpos(l.action,'ATTENDANCE_CHECKED_OUT:')=1 OR strpos(l.action,'ATTENDANCE_ABSENT:')=1)
  UNION ALL
  SELECT 'arrival:' || a.id AS id, CASE WHEN a.status IN ('PRESENT','CHECKED_OUT') THEN 'ARRIVAL_RECORDED' ELSE 'CHECKIN_PENDING' END AS kind, MIN(e."receivedAt") AS "createdAt", NULL::jsonb AS details
  FROM "Attendance" a JOIN "Observation" o ON o."attendanceId"=a.id
  JOIN "DeviceEvent" e ON e.id=o."eventId" JOIN "Device" d ON d.id=e."deviceId" JOIN "Child" c ON c.id=a."childId"
  WHERE c.id=${child.id} AND c."centerId"=${child.centerId} AND e."childId"=c.id AND d."centerId"=c."centerId"
  GROUP BY a.id
  UNION ALL
  SELECT a.id,a.kind AS kind,a."createdAt" AS "createdAt",a.details
  FROM "Alert" a JOIN "DeviceEvent" e ON e.id=a."eventId" JOIN "Device" d ON d.id=e."deviceId"
  WHERE e."childId"=${child.id} AND d."centerId"=${child.centerId} AND a.kind='LOW_ACTIVITY_ADVISORY'
  ORDER BY "createdAt" DESC, id DESC LIMIT ${take}`;
 let pickup=[],pickupAvailable=false,rfid=[];
 if(await rfidInstalled(db))rfid=await db.$queryRaw`
  SELECT 'rfid:' || s.id AS id,'ATTENDANCE_CONFIRMED_RFID' AS kind,s."receivedAt" AS "createdAt"
  FROM "RfidScan" s JOIN "Attendance" a ON a.id=s."attendanceId"
  JOIN "Child" c ON c.id=a."childId" JOIN "RfidReader" r ON r.id=s."readerId"
  WHERE c.id=${child.id} AND c."centerId"=${child.centerId} AND r."centerId"=${child.centerId}
   AND s."centerId"=${child.centerId} AND s.changed=true
  ORDER BY s."receivedAt" DESC,s.id DESC LIMIT ${take}`;
 const [storage]=await db.$queryRaw`SELECT to_regclass('public."PickupRequest"') IS NOT NULL AS installed`;
 if(storage?.installed){
  try{
   pickup=await db.$queryRaw`
    SELECT l.id,l.action AS kind,l."createdAt" AS "createdAt"
    FROM "AuditLog" l JOIN "PickupRequest" p ON p.id=l."resourceId"
    WHERE p."childId"=${child.id} AND p."centerId"=${child.centerId}
     AND l.action IN ('PICKUP_REQUEST_CREATED','PICKUP_COMPLETED','PICKUP_CANCELLED','PICKUP_REJECTED','PICKUP_EXPIRED')
    ORDER BY l."createdAt" DESC,l.id DESC LIMIT ${take}`;
   pickupAvailable=true;
  }catch(error){
   if(!(error.code==='P2021'||(error.code==='P2010'&&error.meta?.code==='42P01')))throw error;
  }
 }
 const safeKind=kind=>kind.startsWith('ATTENDANCE_ABSENT:')?'ABSENT':kind.startsWith('ATTENDANCE_CHECKED_OUT:')?'CHECKED_OUT':kind;
 const rows=[...attendance,...pickup,...rfid].map(row=>({id:row.id,kind:safeKind(row.kind),createdAt:row.createdAt,...(row.kind==='LOW_ACTIVITY_ADVISORY'?{details:{reductionPercent:typeof row.details?.reductionPercent==='number'&&Number.isFinite(row.details.reductionPercent)?row.details.reductionPercent:null}}:{}),child:{id:child.id,name:child.name}}))
  .concat(volatileRows.filter(row=>row.child.id===child.id))
  .sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt)||b.id.localeCompare(a.id));
 return {rows:rows.slice(offset,offset+limit),pickupAvailable};
}
