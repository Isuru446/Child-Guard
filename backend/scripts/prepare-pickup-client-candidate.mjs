// Authorized offline candidate generation only. Never writes active generated files or connects to a database.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {forwardPrismaIntegrity as prior} from '../src/forward-prisma-client-integrity.js';
import {pickupReview} from '../src/pickup-preparation.js';
const root=resolve('D:/ChildGuard-V2'),backend=resolve(root,'backend');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
function regular(path){for(let p=path;;p=dirname(p)){const s=lstatSync(p);if(s.isSymbolicLink()||realpathSync.native(p)!==p)throw Error('Redirect refused');if(p===root)break;if(p===dirname(p))throw Error('Workspace refused');}}
const source=resolve(backend,'node_modules/.prisma/client');
regular(source);
if(JSON.stringify(readdirSync(source).sort())!==JSON.stringify(Object.keys(prior.generatedFiles).sort()))throw Error('Prior client inventory changed');
for(const [name,hash] of Object.entries(prior.generatedFiles))if(sha(readFileSync(resolve(source,name)))!==hash)throw Error('Prior client checksum changed');
for(const name of ['prisma','@prisma/client','@prisma/engines'])if(JSON.parse(readFileSync(resolve(backend,'node_modules',name,'package.json'),'utf8')).version!=='6.12.0')throw Error('Prisma version refused');
const cli=resolve(backend,'node_modules/prisma/build/index.js');
if(sha(readFileSync(cli))!=='245FCBC1156EE5D35F04AB5EA18E1558DF1A6D92DEDD9BAE80E49F58D3EF9920')throw Error('CLI checksum refused');
const schema=readFileSync(resolve(backend,'prisma/schema.prisma'));
if(sha(schema)!==pickupReview.schema)throw Error('Source schema changed');
const review=resolve(root,'.local-tools','pickup-client-review-'+randomUUID());mkdirSync(review);
const snapshot=resolve(review,'prior-client'),policies=resolve(review,'prior-policy');mkdirSync(snapshot);mkdirSync(policies);
for(const [name,hash] of Object.entries(prior.generatedFiles)){copyFileSync(resolve(source,name),resolve(snapshot,name));if(sha(readFileSync(resolve(snapshot,name)))!==hash)throw Error('Snapshot failed');}
const policyFiles=['baseline-manifest.js','admin-session-forward-manifest.js','forward-prisma-client-integrity.js','verify-forward-prisma-client.js','migration-prisma-client.js'];
const policyHashes={};for(const name of policyFiles){const from=resolve(backend,'src',name);regular(from);copyFileSync(from,resolve(policies,name));policyHashes[name]=sha(readFileSync(from));if(sha(readFileSync(resolve(policies,name)))!==policyHashes[name])throw Error('Policy snapshot failed');}
const candidate=resolve(review,'candidate'),environment=resolve(review,'os-profile');mkdirSync(environment);
const output=JSON.stringify(candidate.replaceAll('\\','/'));
const generationSchema=schema.toString().replace(/generator client\s*\{\s*provider\s*=\s*"prisma-client-js"\s*\}/,`generator client {\n  provider = "prisma-client-js"\n  output = ${output}\n}`);
if(generationSchema===schema.toString()||!generationSchema.includes(`output = ${output}`))throw Error('Isolated output preparation failed');
writeFileSync(resolve(review,'schema.prisma'),generationSchema,{flag:'wx'});
writeFileSync(resolve(review,'package.json'),'{"name":"childguard-pickup-offline-candidate","private":true}',{flag:'wx'});
// Prisma resolves its existing generator relative to the schema. Copy the pinned installed package, never install or symlink it.
const clientPackage=resolve(backend,'node_modules/@prisma/client'),reviewPackage=resolve(review,'node_modules/@prisma/client');regular(clientPackage);
cpSync(clientPackage,reviewPackage,{recursive:true,errorOnExist:true,force:false});
if(sha(readFileSync(resolve(reviewPackage,'runtime/library.js')))!==prior.runtime||sha(readFileSync(resolve(reviewPackage,'generator-build/index.js')))!=='EBD602AD651313944AF98F3C02D93B761586493BC8455639BFE23911B2586490')throw Error('Generator package copy refused');
writeFileSync(resolve(review,'snapshot.json'),JSON.stringify({createdAt:new Date().toISOString(),sourceSchema:pickupReview.schema,generationSchema:sha(Buffer.from(generationSchema)),priorGeneratedFiles:prior.generatedFiles,priorPolicyFiles:policyHashes,candidate,activeFilesChanged:false},null,2),{flag:'wx'});
const env={SystemRoot:'C:\\Windows',PATH:'C:\\Program Files\\nodejs;C:\\Windows\\System32',USERPROFILE:environment,TEMP:environment,TMP:environment,APPDATA:environment,LOCALAPPDATA:environment,
 DATABASE_URL:'postgresql://childguard_v2_app:offline-only@127.0.0.1:5432/childguard_v2?schema=public',PRISMA_GENERATE_SKIP_AUTOINSTALL:'true',PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1'};
console.log('Verified snapshot and isolated generation directory: '+review);
const child=spawn('C:/Program Files/nodejs/node.exe',[cli,'generate','--schema',resolve(review,'schema.prisma')],{cwd:review,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
let log='';child.stdout.on('data',chunk=>{log+=chunk;});child.stderr.on('data',chunk=>{log+=chunk;});
const code=await new Promise((done,reject)=>{child.on('error',reject);child.on('close',done);});
writeFileSync(resolve(review,'generation.log'),log,{flag:'wx'});
for(const [name,hash] of Object.entries(prior.generatedFiles))if(sha(readFileSync(resolve(source,name)))!==hash)throw Error('Active client changed unexpectedly');
if(code!==0){console.error('Candidate generation failed; diagnostics preserved; active snapshot unchanged.');process.exitCode=1;}
else console.log('Candidate generated; active client and backend were not replaced or restarted.');
