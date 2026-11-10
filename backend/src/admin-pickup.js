import { z } from 'zod';
import { attendanceDay, dbTime, fail } from './events.js';

const statuses=['PENDING','COMPLETED','CANCELLED','EXPIRED','REJECTED'];
const actor={select:{id:true,username:true,centerId:true}};
const fields={id:true,childId:true,personId:true,photoId:true,snapshot:true,day:true,windowStart:true,windowEnd:true,expiresAt:true,status:true,verifiedAt:true,completedAt:true,reason:true,createdAt:true,
 child:{select:{id:true,name:true}},requestedBy:actor,reviewedBy:actor,verifiedBy:actor};
const statusWhere=(status,now)=>status==='EXPIRED'?{OR:[{status:'EXPIRED'},{status:'PENDING',expiresAt:{lte:now}}]}:status==='PENDING'?{status,expiresAt:{gt:now}}:status?{status}:{};
const text=value=>typeof value==='string'?value:null;
function view(row,centerId,now){
 const person=row.snapshot??{};
 const visibleActor=user=>user?.centerId===centerId?{id:user.id,username:user.username}:null;
 return {id:row.id,child:row.child,personId:row.personId,person:{fullName:text(person.fullName),address:text(person.address),phone:text(person.phone),relationship:text(person.relationship)},
  photoAvailable:!!row.photoId,day:row.day,windowStart:row.windowStart,windowEnd:row.windowEnd,expiresAt:row.expiresAt,status:row.status==='PENDING'&&+row.expiresAt<=+now?'EXPIRED':row.status,
  requestedBy:visibleActor(row.requestedBy),reviewedBy:visibleActor(row.reviewedBy),verifiedBy:visibleActor(row.verifiedBy),verifiedAt:row.verifiedAt,completedAt:row.completedAt,reason:row.reason,createdAt:row.createdAt};
}

export function mountAdminPickupRoutes(app,{db,asyncRoute,ready}){
 const root='/api/v1/admin/pickups';
 const admin=(req,res,next)=>req.user?.role==='ADMIN'&&req.authTransport==='admin-cookie'?next():next(fail(403,'FORBIDDEN','Admin cookie session required'));
 const scope=user=>({centerId:user.centerId,child:{centerId:user.centerId}});
 app.use(root,admin,(req,res,next)=>{res.set('Cache-Control','no-store');next();},ready);
 app.get(root,asyncRoute(async(req,res)=>{
  const q=z.object({day:z.string().date().optional(),status:z.enum(statuses).optional(),limit:z.coerce.number().int().min(1).max(50).default(25),offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict().parse(req.query);
  const now=await dbTime(db),base={...scope(req.user),...(q.day?{day:q.day}:{})};
  const [rows,counts]=await Promise.all([
   db.pickupRequest.findMany({where:{...base,...statusWhere(q.status,now)},select:fields,orderBy:[{createdAt:'desc'},{id:'desc'}],take:q.limit+1,skip:q.offset}),
   Promise.all(statuses.map(status=>db.pickupRequest.count({where:{...base,...statusWhere(status,now)}}))),
  ]);
  const summary=Object.fromEntries(statuses.map((status,index)=>[status,counts[index]]));summary.total=counts.reduce((n,count)=>n+count,0);
  res.json({data:{rows:rows.slice(0,q.limit).map(row=>view(row,req.user.centerId,now)),summary,hasMore:rows.length>q.limit,day:q.day??null,today:attendanceDay(now),serverTime:now,limit:q.limit,offset:q.offset}});
 }));
 app.get(root+'/:id',asyncRoute(async(req,res)=>{
  const row=await db.pickupRequest.findFirst({where:{id:z.string().uuid().parse(req.params.id),...scope(req.user)},select:fields});
  if(!row)throw fail(404,'NOT_FOUND','Pickup request unavailable');
  res.json({data:view(row,req.user.centerId,await dbTime(db))});
 }));
 app.get(root+'/:id/photo',asyncRoute(async(req,res)=>{
  const row=await db.pickupRequest.findFirst({where:{id:z.string().uuid().parse(req.params.id),...scope(req.user)},select:{childId:true,photoId:true}});
  if(!row?.photoId)throw fail(404,'NOT_FOUND','Pickup photograph unavailable');
  const photo=await db.pickupPhoto.findFirst({where:{id:row.photoId,childId:row.childId,centerId:req.user.centerId},select:{mime:true,bytes:true}});
  if(!photo||!['image/jpeg','image/png','image/webp'].includes(photo.mime))throw fail(404,'NOT_FOUND','Pickup photograph unavailable');
  res.set({'Content-Type':photo.mime,'Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'}).send(Buffer.from(photo.bytes));
 }));
}
