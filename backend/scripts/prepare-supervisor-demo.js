// Historical implementation retained; synthetic writes require separate redesign.
throw new Error('WP00-B BLOCKED: legacy demo preparation is not approved for V2');
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { validateTestDatabaseUrl, assertTestDatabase } from '../tests/database-safety.js';
import { attendanceDay } from '../src/events.js';

let db;
try {
 const url=validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
 const password=process.env.CHILDGUARD_DEMO_ADMIN_PASSWORD;
 if(!password||password.length<12||Buffer.byteLength(password,'utf8')>72)throw new Error('password');
 db=new PrismaClient({datasources:{db:{url}}});
 await assertTestDatabase(db);
 const migrations=new URL('../prisma/migrations/',import.meta.url);
 const files=readdirSync(migrations,{withFileTypes:true}).filter(entry=>entry.isDirectory());
 const ledger=await db.$queryRaw`SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations"`;
 if(ledger.length!==files.length||ledger.some(row=>!/^\d+_[a-z0-9_]+$/.test(row.migration_name)||!row.finished_at||row.rolled_back_at||createHash('sha256').update(readFileSync(new URL(`${row.migration_name}/migration.sql`,migrations))).digest('hex')!==row.checksum))throw new Error('migrations');
 const suffix=randomUUID(),username=`demo-admin-${suffix}`;
 const hash=await bcrypt.hash(password,12);
 const result=await db.$transaction(async tx=>{
  await assertTestDatabase(tx);
  const center=await tx.center.create({data:{name:`Isolated Supervisor Demo ${suffix.slice(0,8)}`}});
  await tx.user.create({data:{username,passwordHash:hash,role:'ADMIN',centerId:center.id}});
  const child=await tx.child.create({data:{name:'[SIMULATED] Supervisor Demo Child',centerId:center.id}});
  const device=await tx.device.create({data:{hardwareId:`DEMO-WEARABLE-${suffix}`,centerId:center.id,tokenHash:createHash('sha256').update(randomBytes(32)).digest('hex')}});
  const [clock]=await tx.$queryRaw`SELECT clock_timestamp() AS now`;
  await tx.attendance.create({data:{childId:child.id,day:attendanceDay(clock.now),status:'CHECKIN_PENDING'}});
  const event=await tx.deviceEvent.create({data:{eventId:randomUUID(),eventType:'DANGER_ZONE_NEAR',deviceId:device.id,childId:child.id,deviceUptimeMs:0n,payload:{synthetic:true,note:'Supervisor demo fixture, not physical ESP32 telemetry'}}});
  await tx.alert.create({data:{eventId:event.id,kind:'DANGER_ZONE_NEAR',details:{synthetic:true,note:'Isolated demo, not a live hardware alert'}}});
  return {database:'childguard_test',centerId:center.id,centerName:center.name,username,childId:child.id,deviceId:device.id,hardwareId:device.hardwareId};
 });
 console.log(JSON.stringify(result));
} catch {
 console.error('Synthetic demo preparation refused. Verify the isolated test database, seven migration checksums and a private 12+ character / 72-byte maximum password. Details withheld.');
 process.exitCode=1;
} finally {await db?.$disconnect();}
