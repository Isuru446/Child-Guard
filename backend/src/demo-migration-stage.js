// Public files only. This module never connects, loads .env, constructs Prisma or deploys.
import { readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,realpathSync } from 'node:fs';
import { resolve,dirname,relative } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { baseline } from './baseline-manifest.js';
import { adminForwardHashes } from './admin-session-forward-manifest.js';
import { verifyForwardPrismaClient } from './verify-forward-prisma-client.js';
export const demoMigrationName='202610250002_prototype_geofence';
export const demoHashes=Object.freeze({sql:'976129BBD79152A9A8EE059BC61D228A9630AC23C1D3BC814C3A5FE1C9BFEDAE',schema:'AB860DC743F4F9DDD8AA2D1491BC8B12DCF79E49D8D8DCDDBE80307E6A8D2967'});
export const originalMigrationHashes=Object.freeze(Object.fromEntries(Object.entries({...baseline.hashes,...adminForwardHashes}).filter(([p])=>p.endsWith('/migration.sql'))));
const root=resolve('D:/ChildGuard-V2'),backend=resolve(root,'backend'),sha=b=>createHash('sha256').update(b).digest('hex').toUpperCase();
const pkg='{"name":"childguard-v2-demo-migration-stage","private":true}';
function regular(path){
 if(path!==root&&!path.startsWith(root+'\\'))throw Error('Workspace path refused');
 for(let p=path;;p=dirname(p)){const s=lstatSync(p);if(s.isSymbolicLink()||realpathSync.native(p)!==p)throw Error('Redirect refused');if(p===root)break;}
 const s=lstatSync(path);if(s.isFile()&&s.nlink!==1)throw Error('Linked file refused');
}
function source(){
 verifyForwardPrismaClient();
 const file=(p,hash)=>{const path=resolve(backend,p);regular(path);const b=readFileSync(path);if(sha(b)!==hash)throw Error('Source integrity refused');return b;};
 const result={'package.json':Buffer.from(pkg),'prisma/schema.prisma':file('prisma/review/geofence/prototype.schema.prisma',demoHashes.schema),'prisma/migrations/migration_lock.toml':file('prisma/migrations/migration_lock.toml',baseline.hashes['prisma/migrations/migration_lock.toml'])};
 for(const [p,h] of Object.entries(originalMigrationHashes)){result[p]=file(p,h);if(JSON.stringify(readdirSync(dirname(resolve(backend,p))))!=='["migration.sql"]')throw Error('Unknown migration source refused');}
 result[`prisma/migrations/${demoMigrationName}/migration.sql`]=file('prisma/review/geofence/prototype-migration.sql',demoHashes.sql);
 const dirs=readdirSync(resolve(backend,'prisma/migrations')).sort();if(JSON.stringify(dirs)!==JSON.stringify([...Object.keys(originalMigrationHashes).map(p=>p.split('/')[2]),'migration_lock.toml'].sort()))throw Error('Migration inventory refused');
 const cli=file('node_modules/prisma/build/index.js','245FCBC1156EE5D35F04AB5EA18E1558DF1A6D92DEDD9BAE80E49F58D3EF9920');if(!cli.length)throw Error();
 return result;
}
export function verifyDemoStage(stage){
 if(dirname(stage)!==root||!/^\.demo-geofence-stage-[0-9a-f-]{36}$/.test(relative(root,stage)))throw Error('Stage path refused');regular(stage);
 const files=source(),found=[];
 const walk=p=>{regular(p);for(const n of readdirSync(p)){const f=resolve(p,n);regular(f);if(lstatSync(f).isDirectory())walk(f);else found.push(relative(stage,f).replaceAll('\\','/'));}};walk(stage);
 if(JSON.stringify(found.sort())!==JSON.stringify(Object.keys(files).sort()))throw Error('Stage inventory refused');
 for(const [p,b]of Object.entries(files))if(!readFileSync(resolve(stage,p)).equals(b))throw Error('Stage integrity refused');
 return stage;
}
export function prepareDemoStage(){
 const files=source(),stage=resolve(root,'.demo-geofence-stage-'+randomUUID());mkdirSync(stage);
 for(const [p,b]of Object.entries(files)){const destination=resolve(stage,p);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,b,{flag:'wx'});}
 return verifyDemoStage(stage);
}
