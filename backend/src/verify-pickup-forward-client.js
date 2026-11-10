// Public artifact verification only: no generated-code evaluation, env loading or DB operations.
import {readFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {pickupForwardClientIntegrity as pins} from './pickup-forward-client-integrity.js';
import {forwardPrismaIntegrity as prior} from './forward-prisma-client-integrity.js';
import {verifyPickupClientMetadata} from './pickup-client-policy.js';
const root=resolve('D:/ChildGuard-V2'),sha=b=>createHash('sha256').update(b).digest('hex').toUpperCase();
const need=value=>{if(!value)throw Error('Pickup forward client integrity refused');};
function read(path,hash){for(let p=path;;p=dirname(p)){const stat=lstatSync(p);need(!stat.isSymbolicLink()&&realpathSync.native(p)===p);if(p===root)break;need(p!==dirname(p));}need(lstatSync(path).isFile()&&lstatSync(path).nlink===1);const bytes=readFileSync(path);if(hash)need(sha(bytes)===hash);return bytes;}
function metadata(bytes){const source=bytes.toString();const match=/const config = (\{[\s\S]*?\r?\n\})\s*\r?\n\s*const fs = require\('fs'\)/.exec(source);need(match);const prefix='config.runtimeDataModel = JSON.parse(',line=source.split(/\r?\n/).find(line=>line.startsWith(prefix));need(line?.endsWith(')'));return {config:JSON.parse(match[1]),model:JSON.parse(JSON.parse(line.slice(prefix.length,-1)))};}
export function verifyPickupForwardClient(){
 const folder=resolve(root,pins.clientDirectory),review=resolve(root,pins.reviewDirectory),found=[];
 function walk(path){need(!lstatSync(path).isSymbolicLink()&&realpathSync.native(path)===path);for(const name of readdirSync(path)){const file=resolve(path,name);need(!lstatSync(file).isSymbolicLink());if(lstatSync(file).isDirectory())walk(file);else found.push(relative(folder,file).replaceAll('\\','/'));}}
 walk(folder);need(JSON.stringify(found.sort())===JSON.stringify(Object.keys(pins.generatedFiles).sort()));
 for(const [name,hash] of Object.entries(pins.generatedFiles))read(resolve(folder,name),hash);
 const source=read(resolve(root,'backend/prisma/schema.prisma'),pins.sourceSchema).toString(),generation=read(resolve(review,'schema.prisma'),pins.generationSchema).toString();
 const expected=source.replace(/generator client\s*\{\s*provider\s*=\s*"prisma-client-js"\s*\}/,`generator client {\n  provider = "prisma-client-js"\n  output = ${JSON.stringify(folder.replaceAll('\\','/'))}\n}`);need(generation===expected);
 const after=metadata(read(resolve(folder,'index.js'))),before=metadata(read(resolve(review,'prior-client/index.js'),prior.generatedFiles['index.js']));
 verifyPickupClientMetadata(after.config,after.model);
 need(after.config.generator.sourceFilePath===resolve(review,'schema.prisma')&&after.config.generator.output.value===folder);
 need(after.config.inlineSchema.replace(/\s+/g,'')===generation.replace(/\s+/g,''));
 need(JSON.stringify(before.model.enums)===JSON.stringify(after.model.enums)&&JSON.stringify(before.model.types)===JSON.stringify(after.model.types));
 let previousFields=0;
 for(const [name,model] of Object.entries(before.model.models)){const next=after.model.models[name];need(next);for(const key of Object.keys(model).filter(key=>key!=='fields'))need(JSON.stringify(model[key])===JSON.stringify(next[key]));for(const field of model.fields){need(JSON.stringify(field)===JSON.stringify(next.fields.find(f=>f.name===field.name)));previousFields++;}}
 for(const [name,hash] of Object.entries(prior.generatedFiles))read(resolve(review,'prior-client',name),hash);
 for(const name of ['prisma','@prisma/client','@prisma/engines'])need(JSON.parse(read(resolve(root,'backend/node_modules',name,'package.json'))).version===pins.clientVersion);
 for(const [name,hash] of Object.entries(pins.toolingFiles))read(resolve(root,'backend/node_modules',name),hash);
 const types=read(resolve(folder,'index.d.ts')).toString();for(const name of Object.keys(after.model.models))need(types.includes('export type '+name+' ='));
 for(const name of found)need(!read(resolve(folder,name)).includes(Buffer.from('offline-only')));
 return {clientVersion:pins.clientVersion,engineVersion:pins.engineVersion,models:31,previousFieldsPreserved:previousFields,artifactFiles:found.length,reviewedGeneratedHashes:true,candidateOnly:true,activationApproved:false};
}
