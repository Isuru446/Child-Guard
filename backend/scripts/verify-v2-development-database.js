import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDevelopmentEnvironment } from '../src/development-environment.js';
import { assertDatabaseIdentity, validateDatabaseEnvironment } from '../src/database-admission.js';

let db;
let summary;
let passed = false;
let stage = 'ENVIRONMENT_LOADING';
try {
  // Refuse copies and other working directories; never change directory implicitly.
  const backend = realpathSync('D:/ChildGuard-V2/backend');
  if (realpathSync(process.cwd()) !== backend ||
      realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..')) !== backend) {
    throw new Error();
  }
  const environment = loadDevelopmentEnvironment();
  stage = 'URL_VALIDATION';
  // The existing development allowlist requires the exact database, role,
  // loopback address, explicit port and sole schema=public option before Prisma.
  const url = validateDatabaseEnvironment(environment.DATABASE_URL, 'development', environment);
  stage = 'PRISMA_CONNECTION';
  // Import only after admission; catch import/engine failures without printing them.
  const { PrismaClient } = await import('@prisma/client');
  db = new PrismaClient({ datasources: { db: { url } }, log: [] });
  await db.$connect();
  stage = 'DATABASE_IDENTITY';
  // Checks actual database, current/session role, schema, endpoint, version,
  // and NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS.
  await assertDatabaseIdentity(db, 'development');
  stage = 'SCHEMA_INSPECTION';

  // Catalog reads include ordinary, partitioned and foreign public tables.
  // Application count excludes the separately checked migration ledger.
  const rows = await db.$queryRaw`SELECT
    current_database() AS name, current_user AS role,
    (current_setting('server_version_num')::int / 10000) AS major,
    (SELECT count(*)::int FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'f')
        AND c.relname <> '_prisma_migrations') AS tables,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations') AS ledger`;
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error();
  const actual = rows[0];
  if (actual?.name !== 'childguard_v2' || actual.role !== 'childguard_v2_app' ||
      actual.major !== 18 || !Number.isSafeInteger(actual.tables) || actual.tables < 0 ||
      typeof actual.ledger !== 'boolean') throw new Error();
  summary = actual;
  // A nonempty target is a stop condition, never a reason to reset it.
  passed = actual.tables === 0 && !actual.ledger;
} catch {
  // Never log raw errors, configuration, credentials or connection strings.
  passed = false;
} finally {
  if (db) {
    try { await db.$disconnect(); } catch { passed = false; stage = 'PRISMA_CONNECTION'; }
  }
}

console.log(`Admission ${passed ? 'PASSED' : 'FAILED'}`);
if (!passed) console.log(`Failure stage: ${stage}`);
if (summary) {
  console.log(`Actual database name: ${summary.name}`);
  console.log(`Connected role: ${summary.role}`);
  console.log(`PostgreSQL major version: ${summary.major}`);
  console.log(`Public table count: ${summary.tables}`);
  console.log(`Migration ledger exists: ${summary.ledger ? 'yes' : 'no'}`);
  console.log(`Target is empty: ${summary.tables === 0 && !summary.ledger ? 'yes' : 'no'}`);
}
process.exitCode = passed ? 0 : 1;
