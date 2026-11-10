import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { baseline } from '../src/baseline-manifest.js';
import { approvalBytes, developmentIdentity } from '../src/backup-approval.js';
import { recoveryChecklist, verifyLocalDevelopmentApproval } from '../src/local-development-approval.js';
const now = Date.parse('2026-10-24T10:00:00.000Z');
const id = '12345678-1234-4234-8234-123456789abc';
const metadata = (prefix, ext) => ({ relativePath: `private-backups/childguard-v2/${prefix}-${id}.${ext}`, size: 100, sha256: 'A'.repeat(64) });
function record() { return {
  schemaVersion: 1, purpose: 'LOCAL_DEVELOPMENT_ONLY', target: {...developmentIdentity}, baselineHashes: {...baseline.hashes},
  backup: metadata('baseline','dump'), recoveryPlan: metadata('recovery','md'),
  inspection: {source:{...developmentIdentity},createdAt:'2026-10-24T09:00:00.000Z',inspectedAt:'2026-10-24T09:15:00.000Z',archiveListPassed:true,archiveContentsPassed:true,applicationObjects:0,migrationLedgerExists:false},
  review: {owner:'Local Owner',reviewedAt:'2026-10-24T09:30:00.000Z',expiresAt:'2026-10-24T12:00:00.000Z',checklist:Object.fromEntries(recoveryChecklist.map(k=>[k,true]))}
}; }
const inspect = async p => ({regular:true,links:1,size:100,sha256:p.startsWith('backend/')?baseline.hashes[p.slice(8)]:'A'.repeat(64),customArchive:true});
const verify = (r, fn=inspect, clock=()=>now) => verifyLocalDevelopmentApproval(approvalBytes(r),fn,clock);
test('valid manually reviewed local evidence needs no signature or enrolled key', async()=>assert.match(await verify(record()),/^[A-F0-9]{64}$/));
for (const [name,change] of [
 ['missing evidence',r=>delete r.backup],['wrong database',r=>r.target.database='childguard'],
 ['test database',r=>r.target.database='childguard_v2_test'],['wrong role',r=>r.target.role='postgres'],
 ['wrong host',r=>r.target.host='localhost'],['wrong port',r=>r.target.port=5433],['wrong schema',r=>r.target.schema='other'],
 ['wrong source',r=>r.inspection.source.database='childguard_v2_test'],['bad size',r=>r.backup.size=0],
 ['outside backup',r=>r.backup.relativePath='D:/Pro/backup.dump'],['test backup',r=>r.backup.relativePath=r.backup.relativePath.replace('childguard-v2','childguard-v2-test')],
 ['invalid checksum',r=>r.backup.sha256='bad'],['expired review',r=>r.review.expiresAt='2026-10-24T09:45:00.000Z'],
 ['too long window',r=>r.review.expiresAt='2026-10-25T09:30:00.000Z'],['missing manual review',r=>r.review.checklist={}],
 ['uninspected archive',r=>r.inspection.archiveContentsPassed=false],['nonempty target',r=>r.inspection.applicationObjects=1],
 ['ledger already exists',r=>r.inspection.migrationLedgerExists=true],['changed baseline',r=>r.baselineHashes['prisma/schema.prisma']='B'.repeat(64)],
 ['self approved flag',r=>r.approved=true],['production purpose',r=>r.purpose='PRODUCTION'],
]) test('reject '+name,async()=>{const r=record();change(r);await assert.rejects(verify(r),/^Error: Local development backup evidence refused; details withheld$/);});
for(const [name,mutation] of [['changed backup',a=>({...a,sha256:'B'.repeat(64)} )],['changed size',a=>({...a,size:101})],['linked file',a=>({...a,links:2})],['not custom archive',a=>({...a,customArchive:false})]])
 test('reject '+name,async()=>assert.rejects(verify(record(),async p=>p.endsWith('.dump')?mutation(await inspect(p)):inspect(p))));
for(const checklist of recoveryChecklist) test('require '+checklist,async()=>{const r=record();r.review.checklist[checklist]=false;await assert.rejects(verify(r));});
test('expiration rechecked after file inspection',async()=>{let n=0;await assert.rejects(verify(record(),inspect,()=>n++?now+86400000:now));});
test('no raw inspector errors',async()=>{await assert.rejects(verify(record(),()=>{throw Error('private synthetic value');}),/^Error: Local development backup evidence refused; details withheld$/);});
const runner=readFileSync(new URL('../../scripts/Deploy-V2LocalDevelopmentBaseline.ps1',import.meta.url),'utf8');
test('all literal local bootstrap code pins match reviewed public files',()=>{const pins=[...runner.matchAll(/'([^'\r\n]+)' = '([A-F0-9]{64})'/g)];assert.ok(pins.length>=24);for(const [,p,h] of pins){const path=p.startsWith('prisma\\')?'backend/'+p:p;assert.equal(createHash('sha256').update(readFileSync(new URL('../../'+path.replaceAll('\\','/'),import.meta.url)) ).digest('hex').toUpperCase(),h);}});
test('local gate precedes import, stage and password; is repeated immediately before writing',()=>{const first=runner.indexOf('$approvalFingerprint = Invoke-V2RecoveryEvidenceCheck');for(const point of ['  Import-Module','  $stage = New-V2BaselineStage','  $secret = Read-Host'])assert.ok(first<runner.indexOf(point));assert.ok(runner.indexOf('$recheckedApproval = Invoke-V2RecoveryEvidenceCheck')<runner.indexOf(' migrate deploy '));assert.match(runner, /if \(\$recheckedApproval -cne \$approvalFingerprint\)/);});
test('local entry retains explicit consent, private password and independent guards',()=>{for(const required of ['-not $ConfirmDevelopmentBaselineDeployment','IsInputRedirected','Assert-V2Consent','Assert-V2CleanEnvironment','Assert-V2Dependencies','New-V2ChildEnvironment','Invoke-V2BaselineSequence','verify-v2-migration-target.js','verify-v2-baseline-deployed.js','-AsSecureString','ZeroFreeBSTR'])assert.ok(runner.includes(required));assert.equal((runner.match(/ migrate deploy /g)||[]).length,1);assert.ok(!runner.includes('V2BackupApprovalTrust.json'));assert.ok(!runner.includes('verify-v2-backup-approval.js'));});
