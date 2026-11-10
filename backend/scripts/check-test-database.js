import { PrismaClient } from '@prisma/client';
import { assertTestDatabase, validateTestDatabaseUrl } from '../tests/database-safety.js';

let db;
try {
 const url = validateTestDatabaseUrl(process.env.TEST_DATABASE_URL);
 db = new PrismaClient({datasources:{db:{url}},log:[]});
 await assertTestDatabase(db);
 const tables = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname !~ '^pg_' AND schemaname <> 'information_schema'`;
 console.log(`Verified childguard_v2_test / childguard_v2_test_app on PostgreSQL 18; existing user tables: ${tables[0].count}.`);
 // A nonempty database requires an explicit local review before migrations.
 process.exitCode = tables[0].count === 0 ? 0 : 2;
} catch {
 console.error('Test database preflight refused the connection. Check the dedicated local database and credentials privately. No migration or fixture executed.');
 process.exitCode = 1;
} finally {
 await db?.$disconnect().catch(() => {});
}
