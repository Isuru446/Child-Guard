// Offline filesystem/protocol assertions only; never starts Prisma or reads .env.
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyAbsenceStage,absenceMigrationHash} from '../src/absence-preparation.js';
it('stages exactly the ten reviewed migrations and the enum-only absence migration',()=>{
 const stage=verifyAbsenceStage(resolve('../.absence-migration-stage-912195b5-fcfd-4885-92ed-cfea0f9288b8'));
 expect(stage).toMatchObject({appliedSources:10,pendingSource:'202610270001_attendance_absence',liveLedgerVerified:false});
 const bytes=readFileSync('prisma/migrations/202610270001_attendance_absence/migration.sql');
 expect(bytes.toString().replaceAll('\r\n','\n')).toBe('ALTER TYPE "AttendanceStatus" ADD VALUE \'ABSENT\';\n');
 expect(createHash('sha256').update(bytes).digest('hex').toUpperCase()).toBe(absenceMigrationHash);
});
it('firmware accepts ABSENT explicitly and disables arrival/gate-danger arming',()=>{
 const source=readFileSync('../firmware/ChildGuard_Wearable_Integrated/ChildGuard_Wearable_Integrated.ino','utf8');
 expect(source).toContain('"CHECKED_OUT" || newStatus == "ABSENT";');
 expect(source).toMatch(/"CHECKED_OUT" \|\| newStatus == "ABSENT"\s*\) \{\s*gateDangerArmed = false;\s*arrivalArmed = false;/);
 expect(source).toContain('applyAttendanceEpoch');
});
