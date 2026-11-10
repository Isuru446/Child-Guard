// Offline preparation only. No database, environment loader, CLI execution or deployment.
import { readFileSync, readdirSync, lstatSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { baseline } from './baseline-manifest.js';
import { adminForwardHashes } from './admin-session-forward-manifest.js';
export const pickupReview=Object.freeze({
 name:'202610260001_authorized_pickup',sql:'7C29F1C5608276BC6AAB4B502F725F7B88819D914812247945A8FEE63BB18169',
 schema:'1D3827BEE1AAF740CDA07B47B08739C998509AE3BE960FD47E6565DBCB4074E4',
 geofence:'202610250002_prototype_geofence',geofenceSql:'976129BBD79152A9A8EE059BC61D228A9630AC23C1D3BC814C3A5FE1C9BFEDAE',
 backup:'private-backups/childguard-v2/before-pickup-20261026-115119-0eeebd8cd60a40cab3c534ff156b5ccb.dump',backupSize:156042,backupSha:'3FBF2F33BDD108189C0B913762F0B58B68D36C91E6CFC348319D8237D3615C9B',
});
const root=resolve('D:/ChildGuard-V2'),backend=resolve(root,'backend');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
export const appliedPickupHashes=Object.freeze({...Object.fromEntries(Object.entries({...baseline.hashes,...adminForwardHashes}).filter(([path])=>path.endsWith('/migration.sql')).map(([path,hash])=>[path.split('/')[2],hash])),[pickupReview.geofence]:pickupReview.geofenceSql});
function regular(path){
 if(path!==root&&!path.startsWith(root+'\\'))throw Error('Workspace refused');
 for(let p=path;;p=dirname(p)){const s=lstatSync(p);if(s.isSymbolicLink()||realpathSync.native(p)!==p)throw Error('Redirect refused');if(p===root)break;}
 const stat=lstatSync(path);if(stat.isFile()&&stat.nlink!==1)throw Error('Linked file refused');
}
function pinned(path,hash){regular(path);const bytes=readFileSync(path);if(sha(bytes)!==hash)throw Error('Checksum mismatch: '+relative(root,path));return bytes;}
export function comparePickupLedger(rows,{after=false}={}){
 const expected=after?{...appliedPickupHashes,[pickupReview.name]:pickupReview.sql}:appliedPickupHashes;
 if(!Array.isArray(rows)||rows.length!==Object.keys(expected).length)throw Error('Unexpected migration ledger entry count');
 const names=new Set();
 for(const row of rows){
  if(names.has(row.migration_name)||!Object.hasOwn(expected,row.migration_name)||String(row.checksum).toUpperCase()!==expected[row.migration_name]||
    !(row.finished===true||row.finished_at)||row.rolled_back===true||row.rolled_back_at||(row.applied_steps_count!==undefined&&row.applied_steps_count!==1))throw Error('Migration history/checksum mismatch');
  names.add(row.migration_name);
 }
 return {applied:rows.length,onlyPending:after?null:pickupReview.name};
}
function sources(){
 const result={'package.json':Buffer.from('{"name":"childguard-v2-pickup-stage","private":true}'),
  'prisma/schema.prisma':pinned(resolve(backend,'prisma/schema.prisma'),pickupReview.schema),
  'prisma/migrations/migration_lock.toml':pinned(resolve(backend,'prisma/migrations/migration_lock.toml'),baseline.hashes['prisma/migrations/migration_lock.toml'])};
 const canonical=Object.keys(appliedPickupHashes).filter(name=>name!==pickupReview.geofence).concat(pickupReview.name).sort();
 if(JSON.stringify(readdirSync(resolve(backend,'prisma/migrations')).sort())!==JSON.stringify([...canonical,'migration_lock.toml'].sort()))throw Error('Unexpected migration source inventory');
 for(const [name,hash] of Object.entries({...appliedPickupHashes,[pickupReview.name]:pickupReview.sql})){
  const source=name===pickupReview.geofence?'prisma/review/geofence/prototype-migration.sql':`prisma/migrations/${name}/migration.sql`;
  result[`prisma/migrations/${name}/migration.sql`]=pinned(resolve(backend,source),hash);
 }
 return result;
}
export function verifyPickupStage(stage){
 if(dirname(stage)!==root||!/^\.pickup-migration-stage-[a-f0-9-]{36}$/.test(relative(root,stage)))throw Error('Stage path refused');
 const expected=sources(),found=[];
 function walk(path){regular(path);for(const entry of readdirSync(path)){const p=resolve(path,entry);regular(p);if(lstatSync(p).isDirectory())walk(p);else found.push(relative(stage,p).replaceAll('\\','/'));}}
 walk(stage);if(JSON.stringify(found.sort())!==JSON.stringify(Object.keys(expected).sort()))throw Error('Unexpected staged file');
 for(const [path,bytes] of Object.entries(expected))if(!readFileSync(resolve(stage,path)).equals(bytes))throw Error('Staged checksum mismatch');
 return {stage,appliedSources:9,pendingSource:pickupReview.name,liveLedgerVerified:false,backupIndependentlyVerified:false};
}
export function preparePickupStage(){
 const files=sources(),stage=resolve(root,'.pickup-migration-stage-'+randomUUID());mkdirSync(stage);
 for(const [path,bytes] of Object.entries(files)){const destination=resolve(stage,path);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,bytes,{flag:'wx'});}
 return verifyPickupStage(stage);
}
export function verifyPickupBackup(){
 const path=resolve(root,pickupReview.backup);regular(path);const bytes=readFileSync(path);
 if(bytes.length!==pickupReview.backupSize||bytes.subarray(0,5).toString()!=='PGDMP'||sha(bytes)!==pickupReview.backupSha)throw Error('Backup verification failed');
 return {path,size:bytes.length,sha256:sha(bytes)};
}
export function readOwnerPickupLedger(path){
 if(resolve(path)!==resolve(backend,'prisma/review/pickup/owner-ledger-20261026.json'))throw Error('Owner ledger path refused');
 regular(resolve(path));
 try{return JSON.parse(readFileSync(path,'utf8'));}catch{throw Error('Owner ledger JSON refused');}
}
