import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { fail, serial } from './events.js';

export function inspectImage(bytes) {
 if(!Buffer.isBuffer(bytes)||bytes.length>2*1024*1024||bytes.length<24)throw fail(422,'IMAGE_INVALID','Choose a JPEG, PNG or WebP image up to 2 MB');
 let mime,width,height;
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
  if(bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(8)!==13)throw fail(422,'IMAGE_INVALID','Invalid PNG');
  width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
  let offset=8,ended=false,data=false;const compressed=[];
  while(offset+12<=bytes.length){const size=bytes.readUInt32BE(offset);const type=bytes.toString('ascii',offset+4,offset+8);if(size>bytes.length-offset-12)break;let crc=0xffffffff;for(const value of bytes.subarray(offset+4,offset+8+size)){crc^=value;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}if(((crc^0xffffffff)>>>0)!==bytes.readUInt32BE(offset+8+size))throw fail(422,'IMAGE_INVALID','Invalid PNG checksum');data ||= type==='IDAT';if(type==='IDAT')compressed.push(bytes.subarray(offset+8,offset+8+size));offset+=size+12;if(type==='IEND'){ended=size===0&&offset===bytes.length;break;}}
  if(!ended||!data)throw fail(422,'IMAGE_INVALID','Incomplete PNG');
  const channels={0:1,2:3,3:1,4:2,6:4}[bytes[25]],depth=bytes[24];
  const stride=Math.ceil(width*(channels??0)*depth/8)+1,expected=stride*height;
  if(!channels||![1,2,4,8,16].includes(depth)||bytes[28]!==0||!expected||expected>32*1024*1024)throw fail(422,'IMAGE_INVALID','Unsupported PNG encoding');
  try {const pixels=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected});if(pixels.length!==expected)throw new Error();for(let row=0;row<height;row++)if(pixels[row*stride]>4)throw new Error();}catch{throw fail(422,'IMAGE_INVALID','Invalid PNG pixel data');}
  mime='image/png';
 } else if(bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217) {
  let offset=2,scan=false,ended=false;
  while(offset+1<bytes.length){
   if(bytes[offset++]!==255)break;while(bytes[offset]===255)offset++;const marker=bytes[offset++];
   if(marker===217){ended=scan&&offset===bytes.length;break;}
   if(offset+2>bytes.length)break;const size=bytes.readUInt16BE(offset);if(size<2||offset+size>bytes.length)break;
   if([0xc0,0xc1,0xc2].includes(marker)&&size>=11){height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);}
   offset+=size;
   if(marker===218){const start=offset;while(offset+1<bytes.length){if(bytes[offset]===255&&bytes[offset+1]!==0&&!(bytes[offset+1]>=208&&bytes[offset+1]<=215))break;offset+=bytes[offset]===255?2:1;}scan ||= offset>start;}
  }
  if(!ended)throw fail(422,'IMAGE_INVALID','Incomplete JPEG');
  mime='image/jpeg';
 } else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length) {
  const kind=bytes.toString('ascii',12,16);
  if(bytes.readUInt32LE(16)>bytes.length-20)throw fail(422,'IMAGE_INVALID','Incomplete WebP');
  if(kind==='VP8 '&&bytes.length>30&&bytes.subarray(23,26).equals(Buffer.from([157,1,42]))){width=bytes.readUInt16LE(26)&16383;height=bytes.readUInt16LE(28)&16383;}
  if(kind==='VP8L'&&bytes.length>25&&bytes[20]===47){const bits=bytes.readUInt32LE(21);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
  mime='image/webp';
 }
 if(!mime||!width||!height||width>4096||height>4096||width*height>16000000)throw fail(422,'IMAGE_INVALID','Invalid or unsupported image; maximum dimensions 4096 x 4096');
 return mime;
}
const raw=()=>express.raw({type:['image/jpeg','image/png','image/webp'],limit:'2mb'});
const rootPath=root=>resolve(root??process.env.PRIVATE_MEDIA_DIR??fileURLToPath(new URL('../private-media/',import.meta.url)));
async function replacePhoto(db,bytes,owner,mediaRoot) {
 const mime=inspectImage(bytes),storageKey=randomUUID(),root=rootPath(mediaRoot);
 await mkdir(root,{recursive:true});await writeFile(join(root,storageKey),bytes,{flag:'wx'});
 let previous;
 try {
  const photo=await serial(db,async tx=>{
   if(owner.applicationId){const app=await tx.registrationApplication.findUnique({where:{id:owner.applicationId}});if(!['PENDING','REJECTED'].includes(app?.status))throw fail(409,'INVALID_STATE','Application photo is no longer editable');}
   else if(!await tx.userProfile.findUnique({where:{userId:owner.userId}}))throw fail(409,'PROFILE_REQUIRED','Save your profile before uploading a photo');
   previous=await tx.privatePhoto.findUnique({where:owner});
   return tx.privatePhoto.upsert({where:owner,create:{...owner,mime,storageKey,size:bytes.length},update:{mime,storageKey,size:bytes.length,createdAt:new Date()}});
  });
  if(previous?.storageKey)await unlink(join(root,previous.storageKey)).catch(()=>{});
  return {id:photo.id};
 }catch(error){await unlink(join(root,storageKey)).catch(()=>{});throw error;}
}
async function sendPhoto(res,photo,mediaRoot) {
 if(!photo||!/^[a-f0-9-]{36}$/.test(photo.storageKey))throw fail(404,'NOT_FOUND','Photo unavailable');
 let bytes;try{bytes=await readFile(join(rootPath(mediaRoot),photo.storageKey));}catch{throw fail(404,'NOT_FOUND','Photo unavailable');}
 res.set({'Content-Type':photo.mime,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; sandbox",'X-Content-Type-Options':'nosniff'}).send(bytes);
}
export function mountApplicantPhotoRoutes(app,{db,asyncRoute,applicant,mediaRoot}) {
 app.put('/api/v1/registration/photo',raw(),asyncRoute(async(req,res)=>{const owner=await applicant(db,req);res.json({data:await replacePhoto(db,req.body,{applicationId:owner.id},mediaRoot)});}));
 app.get('/api/v1/registration/photo',asyncRoute(async(req,res)=>{const owner=await applicant(db,req);await sendPhoto(res,await db.privatePhoto.findUnique({where:{applicationId:owner.id}}),mediaRoot);}));
}
export function mountPhotoRoutes(app,{db,asyncRoute,enabled,mediaRoot}) {
 const gate=(req,res,next)=>enabled?next():next(fail(503,'REGISTRATION_UNAVAILABLE','Profile media requires the approved migration'));
 app.put('/api/v1/account/photo',gate,raw(),asyncRoute(async(req,res)=>res.json({data:await replacePhoto(db,req.body,{userId:req.user.id},mediaRoot)})));
 app.get('/api/v1/account/photos/:id',gate,asyncRoute(async(req,res)=>{
  if(!/^[a-f0-9-]{36}$/.test(req.params.id))throw fail(404,'NOT_FOUND','Photo unavailable');
  const photo=await db.privatePhoto.findUnique({where:{id:req.params.id},include:{application:{select:{centerId:true}},profile:{include:{user:{select:{centerId:true}}}}}});
  if(!photo||!(photo.userId===req.user.id||(req.user.role==='ADMIN'&&(photo.application?.centerId??photo.profile?.user.centerId)===req.user.centerId)))throw fail(404,'NOT_FOUND','Photo unavailable');
  await sendPhoto(res,photo,mediaRoot);
 }));
}
