# Database and migration review

## Preserved evidence

All 11 canonical migration SQL files, `migration_lock.toml` and the current Prisma schema are copied byte-for-byte. Review SQL for absence, geofence and pickup remains under `backend/prisma/review`; the tamper constraint repair remains under `backend/scripts`. No SQL was executed, no database was contacted and no migration history was altered.

The retained pickup catalog and owner-ledger JSON contain schema/privilege/checksum metadata used by tests, not row data, credentials or database backups. They describe historical evidence only. The original private-backup directory was not inspected or traversed and is excluded in full.

## Confirmed discrepancies

1. The historical owner ledger expects `202610250002_prototype_geofence`. That directory is absent from canonical migrations, although the reviewed SQL exists at `backend/prisma/review/geofence/prototype-migration.sql`. Do not promote it to a new historical migration without reconciliation of the authoritative deployment history.
2. Frozen baseline policies represent an earlier schema. The current schema contains later session, pickup, absence, RFID and other runtime structures. Some baseline fingerprint tests intentionally detect this difference; historical generated-client reviews also depend on excluded machine-local artifacts. A new client generated from the current schema cannot satisfy every historical artifact assertion.
3. Tamper code emits `TAMPER_LOOP_OPEN`, `TAMPER_LOOP_RESTORED` and `TAMPER_LOOP_STATUS`; the original canonical event-type constraint does not include these. `repair-tamper-event-constraint.sql` extends the existing constraint separately. Its presence does not establish that any target database has the repair. Reconcile it through a reviewed forward change before relying on persisted tamper behavior.
4. Runtime functionality and review SQL extend beyond a proven fresh-database migration chain. Schema parsing is not proof that migrations reproduce the entire schema, triggers, grants or concurrency behavior.

## PostgreSQL version

Current V2 runtime and migration admission code explicitly accepts `server_version_num` 180000 through 189999: PostgreSQL 18 only. Some legacy scripts, especially backup/restore-era tooling, reference PostgreSQL 16 and different database/port names. Those scripts are retained as historical support and must not be used as current setup instructions. Their hard-coded boundaries and hashes were not weakened during publication preparation. This documentation follows current V2 guard behavior; it does not claim Prisma 6.12.0 / PostgreSQL 18 runtime compatibility was independently validated here.

## Required future resolution

Obtain the authoritative schema-only migration history through a separate approved process. Compare the historical checksum ledger, review SQL and required runtime tables against a disposable empty PostgreSQL 18 instance. Design reviewed forward migrations for uncovered changes without rewriting applied migration bytes or marking fictitious migrations as applied. Regenerate the client in that environment and verify authorization, constraints, grants, triggers and transaction races. Keep all live credentials and any recovery material outside the repository.

Until then, fresh-database deployment and persisted end-to-end acceptance remain blocked. This does not prevent reviewing the embedded/application source or running isolated mock and source-contract tests.
