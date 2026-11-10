// Pure migration-only policy. No imports, environment loading or connections.
const targets = Object.freeze({
  development: Object.freeze({ database: 'childguard_v2', role: 'childguard_v2_migrator', runtime: 'childguard_v2_app' }),
  test: Object.freeze({ database: 'childguard_v2_test', role: 'childguard_v2_test_migrator', runtime: 'childguard_v2_test_app' }),
});
const refuse = () => new Error('V2 migration preflight refused; details withheld');
function targetFor(mode) {
  if (!Object.hasOwn(targets, mode)) throw refuse();
  return targets[mode];
}

export function validateMigrationEnvironment(mode, environment) {
  const target = targetFor(mode);
  if (!environment || environment.NODE_ENV !== mode) throw refuse();
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined || value === '') continue;
    if (/^(PG|DOTENV|PRISMA_)/i.test(name) ||
        /^(DATABASE_URL|TEST_DATABASE_URL|DIRECT_URL|SHADOW_DATABASE_URL|NODE_OPTIONS|NODE_PATH|DEBUG)$/i.test(name) ||
        (/^(MIGRATION_DATABASE_URL|NODE_ENV)$/i.test(name) &&
         name !== 'MIGRATION_DATABASE_URL' && name !== 'NODE_ENV')) throw refuse();
  }
  const value = environment.MIGRATION_DATABASE_URL;
  const pattern = new RegExp(`^(postgres|postgresql)://${target.role}:([^@/?#:\\s\\\\]+)@127\\.0\\.0\\.1:5432/${target.database}\\?schema=public$`);
  if (typeof value !== 'string' || /[\x00-\x20\x7f\\]/.test(value) || !pattern.test(value)) throw refuse();
  try {
    const url = new URL(value);
    const password = decodeURIComponent(url.password);
    if (!password || /[\x00-\x20\x7f]/.test(password) ||
        url.username !== target.role || url.hostname !== '127.0.0.1' || url.port !== '5432' ||
        url.pathname !== `/${target.database}` || url.search !== '?schema=public' || url.hash) throw refuse();
  } catch { throw refuse(); }
  return value;
}

export async function assertMigrationIdentity(db, mode) {
  const target = targetFor(mode);
  try {
    const rows = await db.$queryRaw`SELECT current_database() AS name,
      current_user AS role, session_user AS login, current_schema() AS schema,
      host(inet_server_addr()) AS host, inet_server_port() AS port,
      current_setting('server_version_num')::int AS version,
      r.rolsuper AS superuser, r.rolcreatedb AS "createDb", r.rolcreaterole AS "createRole",
      r.rolreplication AS replication, r.rolbypassrls AS "bypassRls", r.rolcanlogin AS "canLogin",
      EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid) AS memberships,
      pg_get_userbyid(d.datdba)::text AS "databaseOwner",
      pg_get_userbyid(n.nspowner)::text AS "schemaOwner",
      has_database_privilege(current_user, d.oid, 'CONNECT') AS connect,
      has_database_privilege(current_user, d.oid, 'CREATE') AS "databaseCreate",
      has_database_privilege(current_user, d.oid, 'TEMP') AS temp,
      has_schema_privilege(current_user, n.oid, 'USAGE') AS usage,
      has_schema_privilege(current_user, n.oid, 'CREATE') AS "schemaCreate",
      has_schema_privilege(${target.runtime}, n.oid, 'CREATE') AS "runtimeCreate",
      EXISTS (SELECT 1 FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'CREATE') AS "publicCreate",
      EXISTS (SELECT 1 FROM pg_catalog.pg_language l
        WHERE l.lanname = 'plpgsql' AND l.lanpltrusted
          AND has_language_privilege(current_user, l.oid, 'USAGE')) AS plpgsql
      FROM pg_catalog.pg_roles r
      JOIN pg_catalog.pg_database d ON d.datname = current_database()
      JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
      WHERE r.rolname = current_user`;
    if (!Array.isArray(rows) || rows.length !== 1) throw refuse();
    const a = rows[0];
    if (a?.name !== target.database || a.role !== target.role || a.login !== target.role ||
        a.schema !== 'public' || a.host !== '127.0.0.1' || a.port !== 5432 ||
        !Number.isInteger(a.version) || a.version < 180000 || a.version >= 190000 ||
        a.schemaOwner !== 'pg_database_owner' || typeof a.databaseOwner !== 'string' || !a.databaseOwner ||
        Object.values(targets).some(t => [t.role, t.runtime].includes(a.databaseOwner)) ||
        ['superuser', 'createDb', 'createRole', 'replication', 'bypassRls', 'memberships',
          'databaseCreate', 'temp', 'runtimeCreate', 'publicCreate'].some(k => a[k] !== false) ||
        ['canLogin', 'connect', 'usage', 'schemaCreate', 'plpgsql'].some(k => a[k] !== true)) throw refuse();
  } catch { throw refuse(); }
}

export async function assertEmptyMigrationTarget(db) {
  try {
    // Namespace dependencies also catch non-table objects such as functions,
    // enum/domain types, operators and text-search objects in public.
    const rows = await db.$queryRaw`SELECT
      (SELECT count(*)::int FROM pg_catalog.pg_depend x
        WHERE x.refclassid = 'pg_catalog.pg_namespace'::regclass
          AND x.classid <> 'pg_catalog.pg_default_acl'::regclass
          AND x.refobjid = (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = 'public')) AS objects,
      (SELECT count(*)::int FROM pg_catalog.pg_namespace
        WHERE nspname <> 'public' AND nspname <> 'information_schema'
          AND nspname !~ '^pg_') AS schemas,
      (SELECT count(*)::int FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql') AS extensions,
      EXISTS (SELECT 1 FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = '_prisma_migrations') AS ledger`;
    if (!Array.isArray(rows) || rows.length !== 1) throw refuse();
    const a = rows[0];
    if (!a || ['objects', 'schemas', 'extensions'].some(k => !Number.isSafeInteger(a[k]) || a[k] !== 0) ||
        a.ledger !== false) throw refuse();
  } catch { throw refuse(); }
}

// Shared injectable ordering boundary; never executes deployment or writes.
export async function verifyMigrationTarget(mode, environment, createClient) {
  const url = validateMigrationEnvironment(mode, environment);
  let db;
  try {
    db = await createClient(url);
    await assertMigrationIdentity(db, mode);
    await assertEmptyMigrationTarget(db);
  } catch { throw refuse(); }
  finally {
    if (db) {
      try { await db.$disconnect(); } catch { throw refuse(); }
    }
  }
}
