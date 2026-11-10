import { assertDatabaseIdentity, validateDatabaseEnvironment } from './database-admission.js';

export const confirmationPhrase = 'CREATE CHILDGUARD V2 FIRST ADMIN';
const refused = () => new Error('V2 first-admin bootstrap refused; details withheld');
export function validateBootstrapInput(input) {
  const { centerName, username, password, repeatPassword, confirmation } = input;
  if (confirmation !== confirmationPhrase || typeof centerName !== 'string' ||
      centerName !== centerName.trim() || centerName.length < 1 || centerName.length > 150 ||
      /[\x00-\x1f\x7f-\x9f]/.test(centerName) || typeof username !== 'string' ||
      !/^[A-Za-z0-9._@+-]{3,100}$/.test(username) || typeof password !== 'string' ||
      password.length < 12 || password.length > 72 || Buffer.byteLength(password, 'utf8') > 72 ||
      /[\x00-\x1f\x7f]/.test(password) || password !== repeatPassword) throw refused();
}

async function assertRuntimePrivileges(db) {
  const rows = await db.$queryRaw`SELECT
    has_schema_privilege(current_user, 'public', 'USAGE') AS usage,
    has_schema_privilege(current_user, 'public', 'CREATE') AS ddl,
    has_database_privilege(current_user, current_database(), 'CREATE') AS "databaseDdl",
    has_table_privilege(current_user, 'public."User"', 'SELECT') AND
    has_table_privilege(current_user, 'public."User"', 'INSERT') AND
    has_table_privilege(current_user, 'public."User"', 'UPDATE') AND
    has_table_privilege(current_user, 'public."Center"', 'SELECT') AND
    has_table_privilege(current_user, 'public."Center"', 'INSERT') AND
    has_table_privilege(current_user, 'public."Center"', 'UPDATE') AS dml,
    EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('User','Center','_prisma_migrations')
      AND pg_catalog.pg_get_userbyid(c.relowner)=current_user) AS owner,
    has_table_privilege(current_user, 'public._prisma_migrations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS ledger`;
  if (rows.length !== 1 || rows[0].usage !== true || rows[0].dml !== true ||
      ['ddl', 'databaseDdl', 'owner', 'ledger'].some(k => rows[0][k] !== false)) throw refused();
}

// No filesystem, environment loading or client creation until the console wrapper
// establishes its interactive boundary. Tests inject a memory-only client/hash.
export async function bootstrapFirstAdmin({ environment, input, createClient, hash }) {
  let db;
  try {
    validateBootstrapInput(input);
    const url = validateDatabaseEnvironment(environment.DATABASE_URL, 'development', environment);
    db = createClient(url);
    await assertDatabaseIdentity(db, 'development');
    await assertRuntimePrivileges(db);
    const passwordHash = await hash(input.password, 12);
    if (typeof passwordHash !== 'string' || !/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(passwordHash)) throw refused();
    return await db.$transaction(async tx => {
      await assertDatabaseIdentity(tx, 'development');
      await assertRuntimePrivileges(tx);
      // Fixed DML-authorized table locks block other inserts until commit, even
      // from writers that do not use this utility. READ COMMITTED ensures counts
      // see commits completed while waiting for those locks. No DDL or retries.
      await tx.$executeRaw`LOCK TABLE public."Center", public."User" IN SHARE ROW EXCLUSIVE MODE`;
      if (await tx.user.count() !== 0 || await tx.center.count() !== 0 ||
          await tx.user.findUnique({ where: { username: input.username }, select: { id: true } })) throw refused();
      const center = await tx.center.create({ data: { name: input.centerName }, select: { id: true } });
      await tx.user.create({ data: { username: input.username, passwordHash, role: 'ADMIN', active: true, centerId: center.id }, select: { id: true } });
      return { centerName: input.centerName, username: input.username, role: 'ADMIN' };
    }, { isolationLevel: 'ReadCommitted', maxWait: 5000, timeout: 10000 });
  } catch { throw refused(); }
  finally {
    if (db) { try { await db.$disconnect(); } catch { throw refused(); } }
  }
}
