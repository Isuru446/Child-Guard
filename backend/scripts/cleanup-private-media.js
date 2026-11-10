// Historical cleanup retained; DB/media admission requires separate review.
throw new Error('WP00-B BLOCKED: legacy media cleanup is not approved for V2');
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readdir, lstat, unlink } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Nonrecursive, metadata-aware cleanup. Default is inspection only.
const root=resolve(process.env.PRIVATE_MEDIA_DIR??fileURLToPath(new URL('../private-media/',import.meta.url)));
const db=new PrismaClient();
try {
 const retained=new Set((await db.privatePhoto.findMany({select:{storageKey:true}})).map(p=>p.storageKey));
 let orphans=0;
 const files=await readdir(root).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
 for(const key of files){
  if(!/^[a-f0-9-]{36}$/.test(key)||retained.has(key))continue;
  const path=resolve(join(root,key));if(dirname(path)!==root)throw new Error('Invalid managed media path');
  const stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||Date.now()-stat.mtimeMs<86400000)continue;
  orphans++;
  if(process.argv.includes('--apply'))await unlink(path);
 }
 console.log(`${process.argv.includes('--apply')?'Removed':'Eligible abandoned uploads'}: ${orphans}. Referenced photos retained.`);
} catch {
 console.error('Media cleanup stopped. Verify database migration and private storage configuration locally.');process.exitCode=1;
} finally {await db.$disconnect();}
