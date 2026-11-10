// Historical implementation retained; no V2 approval for its original DB target.
throw new Error('WP00-B BLOCKED: legacy supervisor database checks target V1; use no legacy helper for V2 admission');
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const config=existsSync(resolve(root,'.env.windows'))?'.env.windows':'.env';
// Match Start-Backend.ps1: file values override inherited values; absent keys
// (including a terminal-only public allowlist) retain the caller's environment.
dotenv.config({path:resolve(root,config),override:true});
let db;
try {
 const url=new URL(process.env.DATABASE_URL);
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.port!=='5432'||url.pathname!=='/childguard')throw new Error('target');
 db=new PrismaClient();
 const result=await db.$transaction(async tx=>{
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const [identity]=await tx.$queryRaw`SELECT current_database() AS name, current_setting('server_version_num')::int AS version, current_setting('server_version') AS server_version`;
  if(identity.name!=='childguard'||identity.version<180000||identity.version>=190000)throw new Error('identity');
  const ledger=await tx.$queryRaw`SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`;
  const directory=resolve(root,'prisma/migrations');
  const files=readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isDirectory());
  const migrationsMatch=ledger.length===files.length&&ledger.every(row=>{
   if(!/^\d+_[a-z0-9_]+$/.test(row.migration_name)||!row.finished_at||row.rolled_back_at)return false;
   const file=resolve(directory,row.migration_name,'migration.sql');
   return existsSync(file)&&createHash('sha256').update(readFileSync(file)).digest('hex')===row.checksum;
  });
  const roles=await tx.$queryRaw`SELECT role, count(*)::int AS count FROM "User" GROUP BY role ORDER BY role`;
  const counts={};
  for(const model of ['center','child','guardian','device','assignment','attendance','alert','activitySummary','registrationApplication'])counts[model]=await tx[model].count();
  const publicIds=(process.env.PUBLIC_REGISTRATION_CENTER_IDS||'').split(',').map(value=>value.trim()).filter(Boolean);
  if(publicIds.some(id=>!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(id)))throw new Error('public center config');
  const eligible=await tx.center.count({where:{id:{in:publicIds}}});
  const [test]=await tx.$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='childguard_test') AS present`;
  return {database:identity.name,postgresMajor:18,serverVersion:identity.server_version,testDatabaseExists:test.present,migrations:ledger.length,migrationsMatch,roles,counts,configuredPublicCenters:publicIds.length,existingPublicCenters:eligible,configFile:config};
 },{timeout:15000});
 console.log(JSON.stringify(result));
 process.exitCode=result.migrationsMatch?0:1;
} catch {
 console.error('Read-only database preflight failed. Check local configuration, PostgreSQL 18, permissions and migration ledger privately; details withheld.');
 process.exitCode=1;
} finally {await db?.$disconnect();}
