// Offline preparation only. No database, environment loader, CLI execution or deployment.
import { readFileSync, readdirSync, lstatSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { baseline } from './baseline-manifest.js';
import {absenceSchemaHash} from './absence-client-policy.js';
import {pickupReview,appliedPickupHashes} from './pickup-preparation.js';
export const absenceMigrationHash='9327EDFD2707C35F682A823425E48C12E942C4D404BE30F441BF2E292A827681';
const root=resolve('D:/ChildGuard-V2'),backend=resolve(root,'backend');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
function regular(path){
 if(path!==root&&!path.startsWith(root+'\\'))throw Error('Workspace refused');
 for(let p=path;;p=dirname(p)){const s=lstatSync(p);if(s.isSymbolicLink()||realpathSync.native(p)!==p)throw Error('Redirect refused');if(p===root)break;}
 const stat=lstatSync(path);if(stat.isFile()&&stat.nlink!==1)throw Error('Linked file refused');
}
function pinned(path,hash){regular(path);const bytes=readFileSync(path);if(sha(bytes)!==hash)throw Error('Checksum mismatch: '+relative(root,path));return bytes;}
function sources(){
 const result={'package.json':Buffer.from('{"name":"childguard-v2-pickup-stage","private":true}'),
  'prisma/schema.prisma':pinned(resolve(backend,'prisma/schema.prisma'),absenceSchemaHash),
  'prisma/migrations/migration_lock.toml':pinned(resolve(backend,'prisma/migrations/migration_lock.toml'),baseline.hashes['prisma/migrations/migration_lock.toml'])};
 const canonical=Object.keys(appliedPickupHashes).filter(name=>name!==pickupReview.geofence).concat(pickupReview.name,'202610270001_attendance_absence').sort();
 if(JSON.stringify(readdirSync(resolve(backend,'prisma/migrations')).sort())!==JSON.stringify([...canonical,'migration_lock.toml'].sort()))throw Error('Unexpected migration source inventory');
 for(const [name,hash] of Object.entries({...appliedPickupHashes,[pickupReview.name]:pickupReview.sql,'202610270001_attendance_absence':absenceMigrationHash})){
  const source=name===pickupReview.geofence?'prisma/review/geofence/prototype-migration.sql':`prisma/migrations/${name}/migration.sql`;
  result[`prisma/migrations/${name}/migration.sql`]=pinned(resolve(backend,source),hash);
 }
 return result;
}
export function verifyAbsenceStage(stage){
 if(dirname(stage)!==root||!/^\.absence-migration-stage-[a-f0-9-]{36}$/.test(relative(root,stage)))throw Error('Stage path refused');
 const expected=sources(),found=[];
 function walk(path){regular(path);for(const entry of readdirSync(path)){const p=resolve(path,entry);regular(p);if(lstatSync(p).isDirectory())walk(p);else found.push(relative(stage,p).replaceAll('\\','/'));}}
 walk(stage);if(JSON.stringify(found.sort())!==JSON.stringify(Object.keys(expected).sort()))throw Error('Unexpected staged file');
 for(const [path,bytes] of Object.entries(expected))if(!readFileSync(resolve(stage,path)).equals(bytes))throw Error('Staged checksum mismatch');
 return {stage,appliedSources:10,pendingSource:'202610270001_attendance_absence',liveLedgerVerified:false,backupIndependentlyVerified:false};
}
export function prepareAbsenceStage(){
 const files=sources(),stage=resolve(root,'.absence-migration-stage-'+randomUUID());mkdirSync(stage);
 for(const [path,bytes] of Object.entries(files)){const destination=resolve(stage,path);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,bytes,{flag:'wx'});}
 return verifyAbsenceStage(stage);
}
