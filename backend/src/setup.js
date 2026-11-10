// Preserve historical setup without permitting unguarded fixture provisioning.
throw new Error('WP00-B BLOCKED: setup/provisioning requires a separately approved V2 implementation');
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { tokenHash } from './app.js';
if(process.env.NODE_ENV==='production') throw new Error('Development setup only');
const {ADMIN_USERNAME,ADMIN_PASSWORD,DEVICE_TOKEN,CENTER_NAME}=process.env;
if(!ADMIN_USERNAME||!ADMIN_PASSWORD||ADMIN_PASSWORD.length<12||!DEVICE_TOKEN||DEVICE_TOKEN.length<32||!CENTER_NAME) throw new Error('Set ADMIN_USERNAME, ADMIN_PASSWORD (12+), DEVICE_TOKEN (32+), CENTER_NAME privately');
const db=new PrismaClient();
try {
 await db.$transaction(async tx=>{
  const center=await tx.center.create({data:{name:CENTER_NAME}});
  await tx.user.create({data:{username:ADMIN_USERNAME,passwordHash:await bcrypt.hash(ADMIN_PASSWORD,12),role:'ADMIN',centerId:center.id}});
  const child=await tx.child.create({data:{name:'Development test child',centerId:center.id}});
  const device=await tx.device.create({data:{hardwareId:'CG-WEARABLE-001',tokenHash:tokenHash(DEVICE_TOKEN),centerId:center.id}});
  await tx.beacon.create({data:{hardwareId:'CG-GATE-01',serviceUuid:'7b700001-24a6-4a25-9d3b-21c547a10001',centerId:center.id}});
  await tx.assignment.create({data:{deviceId:device.id,childId:child.id}});
 });
 console.info('Development center, admin, child, wearable and gate created. Re-running fails safely on duplicate hardware/user.');
} finally { await db.$disconnect(); }
