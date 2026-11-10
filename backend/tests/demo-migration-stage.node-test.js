import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,unlinkSync,rmSync,realpathSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareDemoStage,verifyDemoStage,demoMigrationName } from '../src/demo-migration-stage.js';
const root=resolve('D:/ChildGuard-V2');
test('stages exactly the eight unchanged migrations and one pinned prototype migration; rejects tampering/config pollution',()=>{
 const stage=prepareDemoStage();try{
  assert.equal(verifyDemoStage(stage),stage);assert.throws(()=>verifyDemoStage(resolve(root,'backend')));
  const sql=resolve(stage,'prisma/migrations',demoMigrationName,'migration.sql'),original=readFileSync(sql);writeFileSync(sql,'-- altered');assert.throws(()=>verifyDemoStage(stage));writeFileSync(sql,original);
  const synthetic=resolve(stage,'.env');writeFileSync(synthetic,'SYNTHETIC_TEST_ONLY=true');assert.throws(()=>verifyDemoStage(stage));unlinkSync(synthetic);assert.equal(verifyDemoStage(stage),stage);
 }finally{assert.equal(dirname(stage),root);assert.equal(realpathSync.native(stage),stage);rmSync(stage,{recursive:true});}
});
test('pinned Prisma validates the complete prototype stage offline without dotenv reads or generation',()=>{
 const stage=prepareDemoStage();try{
  const env={SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:process.env.TEMP,TMP:process.env.TMP,PATH:process.env.PATH,PRISMA_HIDE_UPDATE_MESSAGE:'1',CHECKPOINT_DISABLE:'1',DATABASE_URL:'postgresql://127.0.0.1:1/offline_validation?schema=public'};
  const r=spawnSync(process.execPath,['-r',resolve(root,'backend/tests/fixtures/offline-prisma-guard.cjs'),resolve(root,'backend/node_modules/prisma/build/index.js'),'validate','--schema','prisma/schema.prisma'],{cwd:stage,env,encoding:'utf8',timeout:30000});
  assert.equal(r.status,0,'Offline Prisma validation failed: '+(r.stdout??'')+(r.stderr??''));assert.equal(verifyDemoStage(stage),stage);
 }finally{assert.equal(dirname(stage),root);assert.equal(realpathSync.native(stage),stage);rmSync(stage,{recursive:true});}
});
