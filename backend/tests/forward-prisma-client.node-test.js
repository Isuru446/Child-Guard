import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { forwardPrismaIntegrity } from '../src/forward-prisma-client-integrity.js';
import { verifyForwardPrismaClient } from '../src/verify-forward-prisma-client.js';
import { baseline } from '../src/baseline-manifest.js';
import { adminForwardHashes } from '../src/admin-session-forward-manifest.js';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
const source=read('backend/node_modules/.prisma/client/index.js').toString('utf8');
const prefix='config.runtimeDataModel = JSON.parse(';
const line=source.split(/\r?\n/).find(l=>l.startsWith(prefix));
const model=JSON.parse(JSON.parse(line.slice(prefix.length,-1)));
const config=JSON.parse(/const config = (\{[\s\S]*?\r?\n\})\s*\r?\n\s*const fs = require\('fs'\)/.exec(source)[1]);
test('forward-only integrity verification reads pinned artifacts without constructing Prisma',()=>{
 const result=verifyForwardPrismaClient();assert.equal(result.clientVersion,'6.12.0');assert.equal(result.models.length,28);assert.equal(result.authVersion,true);
});
for(const name of ['AuthSession','Center','User','Child','Device','Attendance'])test('generated client retains '+name,()=>{
 assert.ok(model.models[name]);const types=read('backend/node_modules/.prisma/client/index.d.ts').toString('utf8');assert.ok(types.includes('export type '+name+' ='));
});
test('User.authVersion is a required integer with default zero, including generated create/update types',()=>{
 const field=model.models.User.fields.find(f=>f.name==='authVersion');assert.equal(field.type,'Int');assert.equal(field.isRequired,true);assert.equal(field.default,0);
 const types=read('backend/node_modules/.prisma/client/index.d.ts').toString('utf8');assert.match(types,/authVersion\??: number/);assert.match(types,/authVersion\?: IntFieldUpdateOperationsInput \| number/);
});
test('source schema, all eight migration files and lock remain reviewed and unchanged',()=>{
 for(const [p,h]of Object.entries({...baseline.hashes,...adminForwardHashes}))assert.equal(sha(read('backend/'+p)),h);
 assert.equal(sha(read('backend/prisma/schema.prisma')),forwardPrismaIntegrity.sourceSchema);
});
test('original baseline generated-code pin and deployment policy stay frozen',()=>{
 const policy=read('scripts/V2BaselineDeployment.psm1');assert.equal(sha(policy),'10867C393CD436E6BC7CA721F7D8178395809124387AA143D192570A2719FA5A');
 assert.ok(policy.toString('utf8').includes('7A681FAEFFB923A2AD28D5CD5B9AE57798A24017DFBB393E94F53B759B7C67D8'));
 assert.notEqual(forwardPrismaIntegrity.generatedFiles['index.js'],'7A681FAEFFB923A2AD28D5CD5B9AE57798A24017DFBB393E94F53B759B7C67D8');
 assert.equal(baseline.hashes['prisma/schema.prisma'],'7CEB70CEF00F9BCB0F7E293F714BA806C239DE05A10CE176797B760C7DAF91C0');
});
test('CLI, runtime, native engine, package declarations and reviewed patch are unchanged',()=>{
 const pins={
  'backend/node_modules/prisma/build/index.js':'245FCBC1156EE5D35F04AB5EA18E1558DF1A6D92DEDD9BAE80E49F58D3EF9920',
  'backend/node_modules/@prisma/client/runtime/library.js':'C7007AE0F7E447362DAC9F28022ED902EB279EC73F7B630111D45D61C34A10E6',
  'backend/node_modules/.prisma/client/query_engine-windows.dll.node':'335F15347A9400C7830D7650B3BA0D961138960348B8036AC3702CCC03AE56BB',
  'backend/package.json':'6214A6A83BC922E47B5AF2FFA68870DAB9BF93277E3B47A122AB8C31C6D542CC',
  'backend/package-lock.json':'FC2A38AE8055C54E8C1A273F5FE3060DD0EE883EDE00C894973B419F2B90F1A0',
  'V2_Planning/WP02B_ADMIN_SESSION_CUTOVER.patch':'17E67260E02D4B0667EA4E7812F9DE9B395F9EAAB17AC00E2EDDF3030A68126E'
 };for(const [p,h]of Object.entries(pins))assert.equal(sha(read(p)),h);
});
test('generated schema copy and runtime metadata contain no injected datasource value or env-file fallback',()=>{
 assert.equal(sha(read('backend/node_modules/.prisma/client/schema.prisma')),forwardPrismaIntegrity.generatedFiles['schema.prisma']);
 assert.equal(config.generator.sourceFilePath,'D:\\ChildGuard-V2\\backend\\prisma\\schema.prisma');
 assert.equal(config.inlineDatasources.db.url.fromEnvVar,'DATABASE_URL');assert.equal(config.inlineDatasources.db.url.value,null);
 assert.equal(Boolean(config.relativeEnvPaths.rootEnvPath),false);assert.equal(Boolean(config.relativeEnvPaths.schemaEnvPath),false);
 for(const p of Object.keys(forwardPrismaIntegrity.generatedFiles).filter(p=>p.endsWith('.js')||p==='schema.prisma'))assert.ok(!read('backend/node_modules/.prisma/client/'+p).includes(Buffer.from('generation_only')));
});
