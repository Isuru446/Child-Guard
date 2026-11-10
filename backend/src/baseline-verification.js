import { baseline } from './baseline-manifest.js';
import { expressionTree } from './baseline-expression.js';
import { validateMigrationEnvironment, assertMigrationIdentity } from './migration-admission.js';

const refuse = () => new Error('Baseline verification refused; details withheld');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function exactRows(rows, expected, key, check) {
  if (!Array.isArray(rows) || rows.length !== expected.length) throw refuse();
  const found = new Map();
  for (const row of rows) {
    if (!row || typeof key(row) !== 'string' || found.has(key(row))) throw refuse();
    found.set(key(row), row);
  }
  for (const e of expected) { const a = found.get(key(e)); if (!a) throw refuse(); check(a, e); }
}
const requireTrue = condition => { if (!condition) throw refuse(); };

export function validateBaselineLedger(rows) {
  const migrations = Object.entries(baseline.hashes).filter(([p]) => p.endsWith('/migration.sql'))
    .map(([p, checksum]) => ({ name: p.split('/')[2], checksum }));
  exactRows(rows, migrations, r => r.name, (a, e) => {
    requireTrue(a.finished === true && a.notRolledBack === true && a.steps === 1 &&
      typeof a.checksum === 'string' && a.checksum.toUpperCase() === e.checksum);
  });
}

export function validateBaselineSnapshot(s) {
  requireTrue(s && s.schemas === 0 && s.extensions === 0 && s.otherObjects === 0);
  const owner = 'childguard_v2_migrator';
  const tables = [...baseline.tables, '_prisma_migrations'].map(name => ({ name }));
  exactRows(s.tables, tables, r => r.name, a => requireTrue(a.kind === 'r' && a.owner === owner &&
    a.rls === false && a.forcedRls === false));
  exactRows(s.enums, Object.entries(baseline.enums).map(([name, labels]) => ({ name, labels })), r => r.name,
    (a, e) => requireTrue(a.owner === owner && same(a.labels, e.labels)));
  const types = [...tables.map(t => ({ name: t.name, kind: 'c' })), ...Object.keys(baseline.enums).map(name => ({ name, kind: 'e' }))];
  exactRows(s.types, [...types.map(t => ({ ...t, element: null })), ...types.map(t => ({ name: '_' + t.name, kind: 'b', element: t.name }))],
    r => r.name, (a, e) => requireTrue(a.owner === owner && a.kind === e.kind && a.element === e.element));
  exactRows(s.constraints, baseline.constraints, r => `${r.table}.${r.name}`, (a, e) => {
    requireTrue(a.type === e.type && a.validated === true && a.enforced === true && (e.type !== 'c' || a.noInherit === false) &&
      a.deferrable === false && a.deferred === false);
    if (e.type === 'c') requireTrue(same(expressionTree(a.expression), expressionTree(e.expression)));
    else requireTrue(same(a.columns, e.columns));
    if (e.type === 'f') requireTrue(a.referenceSchema === 'public' && a.reference === e.reference &&
      same(a.referenceColumns, e.referenceColumns) && a.delete === e.delete && a.update === e.update && a.match === 's');
  });
  const indexes = [...baseline.indexes, ...baseline.constraints.filter(c => c.type === 'p')
    .map(c => ({ name: c.name, table: c.table, columns: c.columns, unique: true, predicate: null }))];
  exactRows(s.indexes, indexes, r => r.name, (a, e) => {
    requireTrue(a.table === e.table && a.owner === owner && a.unique === e.unique && a.method === 'btree' &&
      a.valid === true && a.ready === true && a.live === true && a.expressions === false && a.nullsNotDistinct === false &&
      a.keys === e.columns.length && same(a.columns, e.columns) &&
      same(a.options, e.columns.map(() => 0)));
    if (e.predicate === null) requireTrue(a.predicate === null);
    else requireTrue(same(expressionTree(a.predicate), expressionTree(e.predicate)));
  });
  exactRows(s.functions, [{ name: 'enforce_assignment_center' }], r => r.name, a => {
    requireTrue(a.owner === owner && a.language === 'plpgsql' && a.returnType === 'trigger' &&
      a.arguments === 0 && a.kind === 'f' && a.securityDefiner === false && a.config === null &&
      a.volatility === 'v' && a.strict === false && typeof a.source === 'string' &&
      a.source.replaceAll('\r\n', '\n').trim() === baseline.functionSource);
  });
  exactRows(s.triggers, [{ name: 'assignment_center' }], r => r.name, a => {
    requireTrue(a.table === 'Assignment' && a.functionSchema === 'public' &&
      a.function === 'enforce_assignment_center' && a.type === 23 && a.enabled === 'O' &&
      a.arguments === 0 && a.condition === null && same(a.columns, []) &&
      a.constraint === false && a.oldTransition === null && a.newTransition === null);
  });
  exactRows(s.runtime, [{ name: 'childguard_v2_app' }, { name: 'childguard_v2_test_app' }], r => r.name, a => {
    requireTrue(['schemaCreate', 'databaseCreate', 'memberships', 'superuser', 'createDb', 'createRole',
      'replication', 'bypassRls', 'ledgerAccess', 'ledgerColumnAccess'].every(k => a[k] === false));
  });
}

export function validateBaselineContents(rows) {
  exactRows(rows, baseline.tables.map(name => ({ name })), r => r.name, a => requireTrue(a.populated === false));
}

export async function verifyBaselineDeployed(environment, createClient) {
  const url = validateMigrationEnvironment('development', environment);
  let db;
  try {
    db = await createClient(url);
    // Independent current/session identity/privilege query. Never the empty-target check.
    await assertMigrationIdentity(db, 'development');
    validateBaselineSnapshot(await readBaselineSnapshot(db));
    const ledger = await db.$queryRaw`SELECT migration_name AS name, checksum,
      finished_at IS NOT NULL AS finished, rolled_back_at IS NULL AS "notRolledBack",
      applied_steps_count AS steps FROM public._prisma_migrations ORDER BY migration_name`;
    validateBaselineLedger(ledger);
    const contents = await readBaselineContents(db);
    validateBaselineContents(contents);
  } catch { throw refuse(); }
  finally { if (db) { try { await db.$disconnect(); } catch { throw refuse(); } } }
}

async function readBaselineContents(db) {
  // Fixed identifiers from the reviewed baseline; no dynamic/unsafe SQL API.
  return db.$queryRaw`SELECT 'Center' AS name, EXISTS(SELECT 1 FROM public."Center") AS populated
    UNION ALL SELECT 'User', EXISTS(SELECT 1 FROM public."User")
    UNION ALL SELECT 'Child', EXISTS(SELECT 1 FROM public."Child")
    UNION ALL SELECT 'Guardian', EXISTS(SELECT 1 FROM public."Guardian")
    UNION ALL SELECT 'Device', EXISTS(SELECT 1 FROM public."Device")
    UNION ALL SELECT 'Assignment', EXISTS(SELECT 1 FROM public."Assignment")
    UNION ALL SELECT 'Beacon', EXISTS(SELECT 1 FROM public."Beacon")
    UNION ALL SELECT 'DeviceEvent', EXISTS(SELECT 1 FROM public."DeviceEvent")
    UNION ALL SELECT 'Attendance', EXISTS(SELECT 1 FROM public."Attendance")
    UNION ALL SELECT 'Observation', EXISTS(SELECT 1 FROM public."Observation")
    UNION ALL SELECT 'Confirmation', EXISTS(SELECT 1 FROM public."Confirmation")
    UNION ALL SELECT 'Alert', EXISTS(SELECT 1 FROM public."Alert")
    UNION ALL SELECT 'AuditLog', EXISTS(SELECT 1 FROM public."AuditLog")
    UNION ALL SELECT 'ActivityPolicy', EXISTS(SELECT 1 FROM public."ActivityPolicy")
    UNION ALL SELECT 'ActivityAttendanceSession', EXISTS(SELECT 1 FROM public."ActivityAttendanceSession")
    UNION ALL SELECT 'ActivityBoot', EXISTS(SELECT 1 FROM public."ActivityBoot")
    UNION ALL SELECT 'ActivitySummary', EXISTS(SELECT 1 FROM public."ActivitySummary")
    UNION ALL SELECT 'ActivityInterval', EXISTS(SELECT 1 FROM public."ActivityInterval")
    UNION ALL SELECT 'ActivityDaily', EXISTS(SELECT 1 FROM public."ActivityDaily")
    UNION ALL SELECT 'UserProfile', EXISTS(SELECT 1 FROM public."UserProfile")
    UNION ALL SELECT 'CenterInvitation', EXISTS(SELECT 1 FROM public."CenterInvitation")
    UNION ALL SELECT 'RegistrationApplication', EXISTS(SELECT 1 FROM public."RegistrationApplication")
    UNION ALL SELECT 'RegistrationDecision', EXISTS(SELECT 1 FROM public."RegistrationDecision")
    UNION ALL SELECT 'EnrollmentRequest', EXISTS(SELECT 1 FROM public."EnrollmentRequest")
    UNION ALL SELECT 'DeviceClaimCode', EXISTS(SELECT 1 FROM public."DeviceClaimCode")
    UNION ALL SELECT 'WearableRequest', EXISTS(SELECT 1 FROM public."WearableRequest")
    UNION ALL SELECT 'PrivatePhoto', EXISTS(SELECT 1 FROM public."PrivatePhoto")`;
}

// Shared read-only catalog reader; validation remains with each caller.
export async function readBaselineSnapshot(db) {
    const rows = await db.$queryRaw`SELECT jsonb_build_object(
      'schemas', (SELECT count(*)::int FROM pg_catalog.pg_namespace
        WHERE nspname <> 'public' AND nspname <> 'information_schema' AND nspname !~ '^pg_'),
      'extensions', (SELECT count(*)::int FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql'),
      'otherObjects', (SELECT count(*)::int FROM pg_catalog.pg_depend x
        JOIN pg_catalog.pg_namespace n ON n.oid = x.refobjid
        WHERE x.refclassid = 'pg_catalog.pg_namespace'::regclass AND n.nspname = 'public'
          AND x.classid NOT IN ('pg_catalog.pg_class'::regclass,'pg_catalog.pg_type'::regclass,
            'pg_catalog.pg_proc'::regclass,'pg_catalog.pg_constraint'::regclass,'pg_catalog.pg_default_acl'::regclass)),
      'types', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', t.typname, 'kind', t.typtype,
        'owner', pg_get_userbyid(t.typowner), 'element', e.typname)), '[]'::jsonb)
        FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        LEFT JOIN pg_catalog.pg_type e ON e.oid = t.typelem WHERE n.nspname = 'public'),
      'tables', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', c.relname, 'kind', c.relkind,
        'owner', pg_get_userbyid(c.relowner), 'rls', c.relrowsecurity, 'forcedRls', c.relforcerowsecurity)), '[]'::jsonb)
        FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind NOT IN ('i','I')),
      'enums', (SELECT COALESCE(jsonb_agg(e.value), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('name', t.typname, 'owner', pg_get_userbyid(t.typowner),
          'labels', (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_catalog.pg_enum e WHERE e.enumtypid = t.oid)) AS value
        FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' AND t.typtype = 'e') e),
      'constraints', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'table', c.relname, 'name', k.conname, 'type', k.contype, 'validated', k.convalidated,
        'deferrable', k.condeferrable, 'deferred', k.condeferred, 'enforced', k.conenforced, 'noInherit', k.connoinherit,
        'expression', CASE WHEN k.contype = 'c' THEN pg_get_expr(k.conbin,k.conrelid) ELSE NULL END,
        'columns', (SELECT COALESCE(jsonb_agg(a.attname ORDER BY x.ord), '[]'::jsonb)
          FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ord)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = x.attnum),
        'reference', rc.relname, 'referenceSchema', rn.nspname,
        'referenceColumns', (SELECT COALESCE(jsonb_agg(a.attname ORDER BY x.ord), '[]'::jsonb)
          FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ord)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = x.attnum),
        'delete', k.confdeltype, 'update', k.confupdtype, 'match', k.confmatchtype)), '[]'::jsonb)
        FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_class rc ON rc.oid = k.confrelid
        LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
        WHERE n.nspname = 'public' AND k.contype <> 'n'),
      'indexes', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', ix.relname,
        'table', t.relname, 'owner', pg_get_userbyid(ix.relowner), 'unique', i.indisunique,
        'method', am.amname, 'valid', i.indisvalid, 'ready', i.indisready, 'live', i.indislive,
        'expressions', i.indexprs IS NOT NULL, 'keys', i.indnkeyatts, 'nullsNotDistinct', i.indnullsnotdistinct,
        'columns', (SELECT jsonb_agg(a.attname ORDER BY x.ord)
          FROM unnest(i.indkey::smallint[]) WITH ORDINALITY x(attnum,ord)
          LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum),
        'options', to_jsonb(i.indoption::smallint[]), 'predicate', pg_get_expr(i.indpred,i.indrelid))), '[]'::jsonb)
        FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ix ON ix.oid = i.indexrelid
        JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_catalog.pg_am am ON am.oid = ix.relam WHERE n.nspname = 'public'),
      'functions', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', p.proname,
        'owner', pg_get_userbyid(p.proowner), 'language', l.lanname,
        'returnType', rt.typname, 'arguments', p.pronargs, 'kind', p.prokind,
        'securityDefiner', p.prosecdef, 'config', p.proconfig, 'volatility', p.provolatile,
        'strict', p.proisstrict, 'source', p.prosrc)), '[]'::jsonb)
        FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_catalog.pg_language l ON l.oid = p.prolang
        JOIN pg_catalog.pg_type rt ON rt.oid = p.prorettype WHERE n.nspname = 'public'),
      'triggers', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', g.tgname,
        'table', c.relname, 'functionSchema', pn.nspname, 'function', p.proname,
        'type', g.tgtype, 'enabled', g.tgenabled, 'arguments', g.tgnargs,
        'condition', pg_get_expr(g.tgqual,g.tgrelid), 'columns', to_jsonb(g.tgattr::smallint[]),
        'constraint', g.tgconstraint <> 0, 'oldTransition', g.tgoldtable, 'newTransition', g.tgnewtable)), '[]'::jsonb)
        FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_class c ON c.oid = g.tgrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_proc p ON p.oid = g.tgfoid
        JOIN pg_catalog.pg_namespace pn ON pn.oid = p.pronamespace WHERE n.nspname = 'public' AND NOT g.tgisinternal),
      'runtime', (SELECT COALESCE(jsonb_agg(jsonb_build_object('name', r.rolname,
        'schemaCreate', has_schema_privilege(r.oid,n.oid,'CREATE'),
        'databaseCreate', has_database_privilege(r.oid,d.oid,'CREATE'),
        'memberships', EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member = r.oid),
        'superuser', r.rolsuper, 'createDb', r.rolcreatedb, 'createRole', r.rolcreaterole,
        'replication', r.rolreplication, 'bypassRls', r.rolbypassrls,
        'ledgerAccess', has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'),
        'ledgerColumnAccess', has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))), '[]'::jsonb)
        FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
        JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = '_prisma_migrations'
        JOIN pg_catalog.pg_database d ON d.datname = current_database()
        WHERE r.rolname IN ('childguard_v2_app','childguard_v2_test_app'))
      ) AS snapshot`;
    if (!Array.isArray(rows) || rows.length !== 1) throw refuse();
    return rows[0]?.snapshot;
}
