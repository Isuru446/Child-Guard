// Offline regression tests. The wrong-directory probe stops before configuration or DB access.
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve('..'),script=resolve('scripts/verify-absence-readiness.mjs');
const source=readFileSync(script,'utf8');
it('fails from workspace root before environment loading with an actionable, nonsecret cause',()=>{
 const env={SystemRoot:process.env.SystemRoot??'C:\\Windows'};
 const result=spawnSync(process.execPath,[script],{cwd:root,env,encoding:'utf8',windowsHide:true});
 expect(result.error).toBeUndefined();expect(result.status).toBe(1);expect(result.stdout).toBe('');
 const error=JSON.parse(result.stderr.trim());
 expect(error).toMatchObject({check:'absence-readiness',step:'WORKING_DIRECTORY',cause:'BACKEND_WORKING_DIRECTORY_REQUIRED',databaseChanged:false});
 expect(error.instruction).toContain('node scripts/verify-absence-readiness.mjs');
 expect(result.stderr).not.toMatch(/DATABASE_URL|postgresql:\/\/|password|stack/i);
});
it('retains backend-directory admission instead of changing cwd or bypassing configuration guards',()=>{
 expect(source.indexOf('realpathSync(process.cwd())')).toBeLessThan(source.indexOf('const env=loadDevelopmentEnvironment()'));
 expect(source).not.toContain('process.chdir');
 expect(source).toContain("withDatabaseAdmission(db,env.DATABASE_URL,'development',env");
 expect(source).toContain("assertDatabaseIdentity(tx,'development')");
 expect(source).toContain('SET TRANSACTION READ ONLY');
});
it('keeps model, enum availability, Pickup and real attendance-read checks; activation flag is not an input',()=>{
 expect(source).toContain('Prisma.dmmf.datamodel.models');expect(source).toContain('await absenceAvailable(db)');
 expect(source).toContain("if(result.models!==31)");expect(source).toContain('if(!result.pickup)');expect(source).toContain('if(!ready)');
 expect(source).toContain('await tx.attendance.count()');
 expect(source).not.toContain('activationPerformed');
 const verifier=readFileSync('scripts/verify-absence-client.mjs','utf8');
 expect(verifier).toContain('activationPerformed:false');
});
it('uses only fixed safe failure codes without printing error messages or configuration',()=>{
 expect(source).toContain("allowed.has(error?.code)?error.code:'REFUSED_OR_UNAVAILABLE'");
 expect(source).not.toMatch(/console\.(?:error|log)\(error/);
 expect(source).not.toContain('error.message');expect(source).not.toContain('error.stack');
 for(const step of ['CONFIGURATION','CLIENT_CONSTRUCTION','DATABASE_ADMISSION','DATABASE_IDENTITY','ATTENDANCE_ENUM_READ','CLIENT_MODEL_METADATA','PICKUP_TABLES','ATTENDANCE_READ','ABSENCE_AVAILABILITY','READINESS_ASSERTIONS'])expect(source).toContain("step='"+step+"'");
});
