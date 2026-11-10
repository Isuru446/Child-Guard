import {hydrateConfirmations} from './rfid-storage.js';
import {parentUpdates} from './parent-updates.js';
import {CONNECTION_LOST,connectionDetails} from './wearable-connection.js';
import {absenceEvidence} from './attendance-absence.js';
import { CHECKOUT_ACTION, checkoutView } from './attendance-checkout.js';
import { z } from 'zod';
import { fail } from './events.js';
import { activityReadView } from './activity.js';
import { mobileDevice, mobileLocation } from './mobile-telemetry.js';
import { mountMobileProfile, profileAvailable } from './mobile-profile.js';
import { monitoringEventFields, monitoringEvent } from './device-monitoring.js';
import { mobileStream } from './mobile-stream.js';
import {checkTeacherDanger} from './teacher-alert-checks.js';
import {teacherOnly,teacherAlerts,teacherDangerGroups} from './teacher-alerts.js';

// Mounted after JWT verification, before the existing staff-only routes.
// Every child query includes the database relationship, never client filtering.
export function mountMobileRoutes(app, { db, asyncRoute, registrationEnabled=false,monitoringHub,jwtSecret,activityHistoryPreview,transportManager }) {
 const page = z.object({limit:z.coerce.number().int().min(1).max(100).default(25),offset:z.coerce.number().int().min(0).max(100000).default(0)});
 const scope = user => ({centerId:user.centerId,...(user.role==='PARENT'?{guardians:{some:{userId:user.id}}}:{})});
 const childFields={id:true,name:true,centerId:true,...(registrationEnabled?{dateOfBirth:true,groupName:true}:{})};
 const allowed = (req,res,next) => ['PARENT','TEACHER','ADMIN'].includes(req.user.role)?next():next(fail(403,'FORBIDDEN','Role not permitted'));
 app.use('/api/v1/mobile',allowed);
 app.get('/api/v1/mobile/alerts',asyncRoute(async(req,res)=>res.set('Cache-Control','no-store').json({data:await teacherAlerts(db,req,{reviewSecret:jwtSecret})})));
 app.get('/api/v1/mobile/alerts/danger-groups',asyncRoute(async(req,res)=>res.set('Cache-Control','no-store').json({data:await teacherDangerGroups(db,req,{reviewSecret:jwtSecret})})));
 app.post('/api/v1/mobile/alerts/:id/check',asyncRoute(async(req,res)=>{const data=await checkTeacherDanger(db,req,jwtSecret);res.json({data});}));
 app.get('/api/v1/mobile/alerts/stream',asyncRoute(async(req,res)=>{
  teacherOnly(req);await mobileStream(req,res,{db,hub:monitoringHub,authorize:teacherOnly,centerWide:true});
 }));
 mountMobileProfile(app,{db,asyncRoute,registrationEnabled});
 async function child(req) {
  const id=z.string().uuid().parse(req.params.id);
  const row=await db.child.findFirst({where:{id,...scope(req.user)},select:childFields});
  if(!row)throw fail(404,'NOT_FOUND','Child not found');
  return row;
 }
 app.get('/api/v1/mobile/profile',asyncRoute(async(req,res)=>{
  const center=await db.center.findUnique({where:{id:req.user.centerId},select:{id:true,name:true}});
  const available=await profileAvailable(db,registrationEnabled);
  const profile=available?await db.userProfile.findUnique({where:{userId:req.user.id},...(registrationEnabled?{include:{photo:{select:{id:true,createdAt:true}}}}:{})}):null;
  res.set('Cache-Control','no-store').json({data:{id:req.user.id,username:req.user.username,role:req.user.role,center,profile,profileAvailable:available,registrationEnabled}});
 }));
 app.get('/api/v1/mobile/children',asyncRoute(async(req,res)=>{
  const {limit,offset}=page.parse(req.query);
  const rows=await db.child.findMany({where:scope(req.user),select:childFields,orderBy:{id:'asc'},take:limit,skip:offset});
  res.json({data:rows,page:{limit,offset}});
 }));
 app.get('/api/v1/mobile/children/:id',asyncRoute(async(req,res)=>res.json({data:await child(req)})));
 app.get('/api/v1/mobile/children/:id/updates',asyncRoute(async(req,res)=>{
  const c=await child(req),q=page.extend({offset:z.coerce.number().int().min(0).max(10000).default(0)}).parse(req.query);
  const result=await parentUpdates(db,c,{...q,volatileRows:transportManager?.notifications(c.centerId,c.id)??[]});
  res.set('Cache-Control','no-store').json({data:result.rows,page:q,pickupAvailable:result.pickupAvailable});
 }));
 app.get('/api/v1/mobile/children/:id/location',asyncRoute(async(req,res)=>res.set('Cache-Control','no-store').json({data:await mobileLocation(db,await child(req))})));
 app.get('/api/v1/mobile/children/:id/stream',asyncRoute(async(req,res)=>{
  await child(req);await mobileStream(req,res,{db,hub:monitoringHub,authorize:child});
 }));
 app.get('/api/v1/mobile/children/:id/attendance',asyncRoute(async(req,res)=>{
  const c=await child(req),{limit,offset}=page.parse(req.query);
  const day=z.string().date().optional().parse(req.query.day);
  const rows=await db.attendance.findMany({where:{childId:c.id,day},select:{id:true,childId:true,day:true,status:true,confirmations:{select:{confirmedAt:true,user:{select:{id:true,username:true,role:true}}}}},orderBy:[{day:'desc'},{id:'asc'}],take:limit,skip:offset});
  const logs=rows.length?await db.auditLog.findMany({where:{resourceId:{in:rows.map(r=>r.id)},action:{startsWith:CHECKOUT_ACTION}},include:{user:{select:{username:true,centerId:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}]}):[];
  await hydrateConfirmations(db,rows);
  const absenceHistory=await absenceEvidence(db,rows.map(r=>r.id));
  res.json({data:rows.map(row=>({...row,absenceHistory:absenceHistory.filter(a=>a.attendanceId===row.id),checkout:row.status==='CHECKED_OUT'?checkoutView(logs.find(log=>log.resourceId===row.id&&log.user?.centerId===c.centerId)):null})),page:{limit,offset}});
 }));
 app.get('/api/v1/mobile/children/:id/alerts',asyncRoute(async(req,res)=>{
  const c=await child(req),{limit,offset}=page.parse(req.query);
  const kind=z.literal('DANGER_ZONE_NEAR').optional().parse(req.query.kind);
  const category=z.literal('safety').optional().parse(req.query.category);
  const rows=await db.alert.findMany({where:{NOT:{kind:'BEACON_SIGNAL_LOST'},...(category?{kind:{in:['DANGER_ZONE_NEAR','GEOFENCE_OUTSIDE','TAMPER_LOOP_OPEN']}}:{}),...(kind?{kind}:{}),event:{childId:c.id,device:{centerId:c.centerId}}},select:{id:true,kind:true,createdAt:true,details:true,event:{select:{...monitoringEventFields,device:{select:{hardwareId:true}},beacon:{select:{id:true,centerId:true,hardwareId:true,name:true,location:true,kind:true}}}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:limit,skip:offset});
  res.json({data:rows.map(row=>{
   const snapshot=row.event.payload?.beaconMetadata;
   const beacon=row.event.beacon?.centerId===c.centerId?row.event.beacon:null;
   const e=monitoringEvent(row.event,c.centerId);
   const location=row.kind!=='WEARABLE_CONNECTION_LOST'&&e.payload.gpsStatus==='GPS_FIX'&&typeof e.payload.latitude==='number'?{latitude:e.payload.latitude,longitude:e.payload.longitude,observedAt:e.observedAt,receivedAt:e.receivedAt}:null;
   return {connection:row.kind===CONNECTION_LOST?connectionDetails(row.details):null,id:row.id,kind:row.kind,createdAt:row.createdAt,details:row.details,state:'RECORDED',child:{id:c.id,name:c.name},location,event:{...e,device:{hardwareId:row.event.device?.hardwareId??null},beacon:beacon&&snapshot?{hardwareId:beacon.hardwareId,name:snapshot.name??null,location:snapshot.location??null,kind:snapshot.kind??beacon.kind}:beacon?{hardwareId:beacon.hardwareId,name:null,location:null,kind:beacon.kind}:null}};
  }),page:{limit,offset}});
 }));
 app.get('/api/v1/mobile/children/:id/device',asyncRoute(async(req,res)=>{
  res.set('Cache-Control','no-store').json({data:await mobileDevice(db,await child(req))});
 }));
 app.get('/api/v1/mobile/children/:id/activity',asyncRoute(async(req,res)=>res.json({data:await activityReadView(db,await child(req),{preview:activityHistoryPreview,source:req.query.source||'recorded'})})));
}
