// Source/AST regression checks only. No PostgreSQL command, deployment, password or backup access.
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const script=readFileSync('../scripts/Deploy-V2Absence.ps1','utf8');
const before=readFileSync('prisma/review/absence/before.sql','utf8');
it('keeps Validate before all migrator credential, role and migration operations',()=>{
 const stop=script.indexOf("if($Mode -eq 'Validate'){Record 'VALIDATION_PASSED'");
 const prompt=script.indexOf("$migratorSecret=Read-Host");
 expect(stop).toBeGreaterThan(0);expect(prompt).toBeGreaterThan(stop);
 expect(script.slice(stop,prompt)).toContain(';return}');
 expect(script.indexOf("$migratorPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($migratorSecret)")).toBeGreaterThan(stop);
 expect(script.indexOf('ALTER ROLE childguard_v2_migrator LOGIN')).toBeGreaterThan(stop);
 expect(script.indexOf(' migrate deploy --schema')).toBeGreaterThan(stop);
});
it('uses postgres, private owner environment and fixed read-only SQL for validation',()=>{
 const catalog=script.slice(script.indexOf('function Catalog'),script.indexOf('function MigrationEnvironment'));
 expect(catalog).toContain('-U postgres -d childguard_v2');expect(catalog).toContain('$ownerEnvironment');
 expect(catalog).toContain("('CATALOG_'+$phase.ToUpperInvariant())");
 expect(script).toContain("OwnerSql ('BEGIN READ ONLY; '+$targetGuard+$lockedGuard+' ROLLBACK;') 'OWNER_TARGET_AND_LOCK'");
 expect(script).toContain("Catalog 'before'");
 expect(before).toContain('BEGIN READ ONLY;');expect(before.trimEnd()).toMatch(/ROLLBACK;$/);
 expect(before).not.toMatch(/\b(?:ALTER|GRANT|REVOKE|INSERT|UPDATE\s+public|DELETE|CREATE)\s+(?:ROLE|TABLE|TYPE|ON|INTO|FROM|public\.)/i);
});
it('retains every existing BEFORE assertion and all ten ledger checksum expectations',()=>{
 for(const message of ['V2 owner target refused','Unexpected ledger count','Migration checksum/history mismatch','Attendance enum mismatch','Enum ownership requires review','Migrator is not locked','Competing migrator connection','Runtime ledger access refused','Pickup storage missing'])expect(before).toContain(message);
 expect(before.match(/'2026\d+_[a-z0-9_]+'\s*,\s*'[a-f0-9]{64}'/g)).toHaveLength(10);
 expect(before).toContain("NOT has_schema_privilege(rolname,'public','CREATE')");
 expect(before).toContain("NOT rolreplication AND NOT rolbypassrls");
 expect(before).toContain('pg_auth_members');
});
it('names each child step without exposing raw stdout, stderr, passwords or URLs',()=>{
 for(const label of ['BACKUP_LIST','BACKUP_DECODE','OWNER_TARGET_AND_LOCK','CATALOG_','MIGRATOR_ENABLE','MIGRATOR_CLEANUP'])expect(script).toContain(label);
 expect(script).toContain("'_FAILED exit='+$process.ExitCode+' cause='+$cause");
 expect(script).toContain('[void]$outTask.GetAwaiter().GetResult()');
 expect(script).not.toMatch(/(?:Write-Host|Write-Output|throw|Record)\s+\$privateError/);
 expect(script).toContain("$privateError=$null;$info.EnvironmentVariables.Clear();$process.Dispose()");
 expect(script).toContain("(?:ERROR|FATAL):\\s+(?:P0001:\\s+)?");
});
it('preserves the pinned shared helper and original role cleanup boundary',()=>{
 expect(createHash('sha256').update(readFileSync('../scripts/V2BaselineDeployment.psm1')).digest('hex').toUpperCase()).toBe('10867C393CD436E6BC7CA721F7D8178395809124387AA143D192570A2719FA5A');
 expect(script).toContain("if($roleAttempted){");expect(script).toContain('REVOKE CREATE ON SCHEMA public FROM childguard_v2_migrator; ALTER ROLE childguard_v2_migrator NOLOGIN;');
 expect(script).toContain('ZeroFreeBSTR($ownerPointer)');expect(script).toContain('ZeroFreeBSTR($migratorPointer)');
});
it('parses the runner and isolated owner-test harness without executing either',()=>{
 const ps='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
 for(const name of ['Deploy-V2Absence.ps1','Test-V2AbsenceValidation.ps1']){
  const command="$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('D:\\ChildGuard-V2\\scripts\\"+name+"',[ref]$null,[ref]$e);if($e.Count){exit 1}";
  const result=spawnSync(ps,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true});
  expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);
 }
});
