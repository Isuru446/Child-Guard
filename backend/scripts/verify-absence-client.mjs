// Offline candidate/installed bundle verification. Never activates files or connects to PostgreSQL.
import {readFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {absenceSchemaHash} from '../src/absence-client-policy.js';
import {verifyPickupClientMetadata} from '../src/pickup-client-policy.js';
const root=resolve('D:/ChildGuard-V2');
const manifest=JSON.parse(readFileSync(resolve(root,'backend/prisma/review/absence/forward-client-manifest.json')));
const installed=process.argv[2]==='--installed';
if(process.argv.length>3||(process.argv[2]&&!installed))throw Error('Unexpected verification argument');
const folder=installed?resolve(root,'backend/node_modules/.prisma/client'):manifest.candidate;
const need=(value,message)=>{if(!value)throw Error(message);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
need(manifest.reviewed&&manifest.sourceSchema===absenceSchemaHash,'Unreviewed schema');
for(const name of ['prisma','@prisma/client','@prisma/engines'])need(JSON.parse(readFileSync(resolve(root,'backend/node_modules',name,'package.json'))).version==='6.12.0','Tooling version mismatch');
need(sha(readFileSync(resolve(root,'backend/node_modules/prisma/build/index.js')))==='245FCBC1156EE5D35F04AB5EA18E1558DF1A6D92DEDD9BAE80E49F58D3EF9920','CLI checksum mismatch');
need(sha(readFileSync(resolve(root,'backend/node_modules/@prisma/client/default.js')))==='0CFFF057C91FCB7559BD1A3BB4891404E455829CED5B18A87C9393EE1721ACE4','Runtime wrapper checksum mismatch');
need(sha(readFileSync(resolve(root,'backend/node_modules/@prisma/client/runtime/library.js')))==='C7007AE0F7E447362DAC9F28022ED902EB279EC73F7B630111D45D61C34A10E6','Runtime checksum mismatch');
need(sha(readFileSync(resolve(root,'backend/prisma/schema.prisma')))===absenceSchemaHash,'Canonical schema changed');
const found=[];
function walk(path){need(realpathSync.native(path)===path&&!lstatSync(path).isSymbolicLink(),'Redirect refused');for(const entry of readdirSync(path)){const file=resolve(path,entry),stat=lstatSync(file);need(!stat.isSymbolicLink(),'Redirect refused');if(stat.isDirectory())walk(file);else{need(stat.isFile()&&stat.nlink===1,'Linked artifact refused');found.push(relative(folder,file).replaceAll('\\','/'));}}}
walk(folder);
need(JSON.stringify(found.sort())===JSON.stringify(Object.keys(manifest.generatedFiles).sort()),'Artifact inventory mismatch');
for(const [name,hash] of Object.entries(manifest.generatedFiles))need(sha(readFileSync(resolve(folder,name)))===hash,'Artifact checksum mismatch: '+name);
const source=readFileSync(resolve(folder,'index.js'),'utf8');
const config=JSON.parse(/const config = (\{[\s\S]*?\r?\n\})\s*\r?\n\s*const fs = require\('fs'\)/.exec(source)[1]);
const prefix='config.runtimeDataModel = JSON.parse(',line=source.split(/\r?\n/).find(s=>s.startsWith(prefix)),model=JSON.parse(JSON.parse(line.slice(prefix.length,-1)));
verifyPickupClientMetadata(config,model);
need(model.enums.AttendanceStatus.values.map(v=>v.name).join(',')==='NOT_CHECKED_IN,CHECKIN_PENDING,PRESENT,CHECKED_OUT,ABSENT','Attendance enum mismatch');
need(sha(readFileSync(resolve(manifest.review,'schema.prisma')))===manifest.generationSchema,'Generation schema changed');
const prior=JSON.parse(readFileSync(resolve(manifest.review,'snapshot.json')));
if(!installed)for(const [name,hash] of Object.entries(prior.priorGeneratedFiles))need(sha(readFileSync(resolve(root,'backend/node_modules/.prisma/client',name)))===hash,'Active prior client changed');
for(const [name,hash] of Object.entries(prior.priorGeneratedFiles))need(sha(readFileSync(resolve(manifest.review,'prior-client',name)))===hash,'Prior snapshot changed');
for(const [name,hash] of Object.entries(prior.priorPolicyFiles))need(sha(readFileSync(resolve(root,'backend/src',name)))===hash,'Historical integrity policy changed');
if(installed){const require=createRequire(resolve(root,'backend/src/server.js')),wrapper=require.resolve('@prisma/client');need(wrapper===resolve(root,'backend/node_modules/@prisma/client/default.js'),'Runtime wrapper redirected');need(createRequire(wrapper).resolve('.prisma/client/default')===resolve(folder,'default.js'),'Runtime bundle mismatch');}
console.log(JSON.stringify({installed,models:Object.keys(model.models).length,previousFieldsPreserved:manifest.previousFieldsPreserved,artifacts:found.length,enum:'ABSENT',historicalPoliciesUnchanged:true,activationPerformed:false}));
