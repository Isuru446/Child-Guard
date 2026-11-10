import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { baseline } from '../src/baseline-manifest.js';
import { adminForwardHashes } from '../src/admin-session-forward-manifest.js';
import { expressionTree } from '../src/baseline-expression.js';
import { migrationClientOptions } from '../src/migration-client-options.js';
import { validateBaselineSnapshot, validateBaselineLedger, validateBaselineContents, verifyBaselineDeployed } from '../src/baseline-verification.js';

const owner = 'childguard_v2_migrator';
const url = 'postgresql://childguard_v2_migrator:synthetic%40password@127.0.0.1:5432/childguard_v2?schema=public';
const env = { NODE_ENV: 'development', MIGRATION_DATABASE_URL: url };
const contents = () => baseline.tables.map(name => ({ name, populated: false }));
const ledger = () => Object.entries(baseline.hashes).filter(([p]) => p.endsWith('/migration.sql'))
  .map(([p, checksum]) => ({ name: p.split('/')[2], checksum: checksum.toLowerCase(), finished: true, notRolledBack: true, steps: 1 }));
function snapshot() {
  const types = [...baseline.tables, '_prisma_migrations'].map(name => ({ name, kind: 'c', owner, element: null }));
  types.push(...Object.keys(baseline.enums).map(name => ({ name, kind: 'e', owner, element: null })));
  return { schemas: 0, extensions: 0, otherObjects: 0,
    types: [...types, ...types.map(t => ({ name: '_' + t.name, kind: 'b', owner, element: t.name }))],
    tables: [...baseline.tables, '_prisma_migrations'].map(name => ({ name, owner, kind: 'r', rls: false, forcedRls: false })),
    enums: Object.entries(baseline.enums).map(([name, labels]) => ({ name, labels: [...labels], owner })),
    constraints: baseline.constraints.map(e => ({ ...structuredClone(e), validated: true, enforced: true, noInherit: false,
      deferrable: false, deferred: false, referenceSchema: e.type === 'f' ? 'public' : null, match: 's' })),
    indexes: [...baseline.indexes, ...baseline.constraints.filter(c => c.type === 'p').map(c => ({ ...c, unique: true, predicate: null }))]
      .map(e => ({ ...structuredClone(e), owner, method: 'btree', valid: true, ready: true, live: true,
        expressions: false, nullsNotDistinct: false, keys: e.columns.length, options: e.columns.map(() => 0) })),
    functions: [{ name: 'enforce_assignment_center', owner, language: 'plpgsql', returnType: 'trigger', arguments: 0,
      kind: 'f', securityDefiner: false, config: null, volatility: 'v', strict: false, source: baseline.functionSource }],
    triggers: [{ name: 'assignment_center', table: 'Assignment', functionSchema: 'public', function: 'enforce_assignment_center',
      type: 23, enabled: 'O', arguments: 0, condition: null, columns: [], constraint: false, oldTransition: null, newTransition: null }],
    runtime: ['childguard_v2_app', 'childguard_v2_test_app'].map(name => ({ name, schemaCreate: false, databaseCreate: false,
      memberships: false, superuser: false, createDb: false, createRole: false, replication: false, bypassRls: false,
      ledgerAccess: false, ledgerColumnAccess: false })),
  };
}
const identity = () => ({ name: 'childguard_v2', role: owner, login: owner, schema: 'public', host: '127.0.0.1',
  port: 5432, version: 180006, superuser: false, createDb: false, createRole: false, replication: false,
  bypassRls: false, canLogin: true, memberships: false, databaseOwner: 'reviewed_v2_admin', schemaOwner: 'pg_database_owner',
  connect: true, databaseCreate: false, temp: false, usage: true, schemaCreate: true, runtimeCreate: false, publicCreate: false, plpgsql: true });
function mockDb({ actual = [identity()], state = [{ snapshot: snapshot() }], migrations = ledger(), data = contents(), failure = 0, disconnectFailure = false } = {}) {
  let calls = 0, disconnected = false;
  return { get calls() { return calls; }, get disconnected() { return disconnected; }, async $queryRaw(strings) {
    const sql = strings.join('?');
    assert.match(sql, /^SELECT\b/);
    const code = sql.replace(/'(?:''|[^'])*'/g, "''").replace(/"[^"]*"/g, 'identifier');
    assert.doesNotMatch(code, /\b(?:INSERT|DELETE|UPDATE|TRUNCATE|ALTER|DROP|GRANT|REVOKE)\b/i);
    if (++calls === failure) throw Error(url);
    return [actual, state, migrations, data][calls - 1];
  }, async $disconnect() { disconnected = true; if (disconnectFailure) throw Error(url); } };
}

test('frozen baseline fingerprints remain fixed and expanded schema requires forward admission', () => {
  assert.equal(baseline.tables.length, 27); assert.equal(baseline.constraints.length, 96); assert.equal(baseline.indexes.length, 41);
  assert.equal(baseline.constraints.filter(c => c.type === 'f').length, 52);
  assert.equal(baseline.constraints.filter(c => c.type === 'c').length, 16);
  const report = readFileSync(new URL('../../V2_Planning/WP00E_MIGRATION_READINESS.md', import.meta.url), 'utf8');
  for (const [path, hash] of Object.entries(baseline.hashes)) {
    assert.ok(report.includes(`'${path.replaceAll('/', '\\')}' = '${hash}'`));
    const actual=createHash('sha256').update(readFileSync(new URL('../' + path, import.meta.url))).digest('hex').toUpperCase();
    if(path==='prisma/schema.prisma') {
      assert.notEqual(actual,hash); // Old baseline runner must refuse this source tree.
      assert.equal(actual,adminForwardHashes[path]);
    } else assert.equal(actual,hash);
  }
});
test('complete synthetic deployed baseline passes without an empty-target query', async () => {
  const db = mockDb(); await verifyBaselineDeployed(env, async actualUrl => { assert.equal(actualUrl, url); return db; });
  assert.equal(db.calls, 4); assert.equal(db.disconnected, true);
});
for (const key of ['tables', 'types', 'enums', 'constraints', 'indexes', 'functions', 'triggers', 'runtime']) {
  for (const mutation of ['missing', 'extra', 'duplicate']) test(`${key}: ${mutation} fails closed`, () => {
    const s = snapshot(); if (mutation === 'missing') s[key].pop(); else s[key].push({ ...s[key][0], ...(mutation === 'extra' ? { name: 'unexpected' } : {}) });
    assert.throws(() => validateBaselineSnapshot(s));
  });
}
for (const [index, constraint] of baseline.constraints.entries()) test(`missing required constraint ${constraint.table}.${constraint.name} refuses`, () => {
  const s = snapshot(); s.constraints.splice(index, 1); assert.throws(() => validateBaselineSnapshot(s));
});
for (const [index, table] of baseline.tables.entries()) {
  test(`${table}: wrong owner refuses`, () => { const s = snapshot(); s.tables[index].owner = 'childguard_v2_app'; assert.throws(() => validateBaselineSnapshot(s)); });
  test(`${table}: fixture data refuses`, () => { const c = contents(); c[index].populated = true; assert.throws(() => validateBaselineContents(c)); });
}
const badSnapshot = [
  s => { s.schemas = 1; }, s => { s.extensions = 1; }, s => { s.schemas = '0'; },
  s => { s.otherObjects = 1; },
  s => { s.tables[0].kind = 'v'; }, s => { s.tables[0].rls = true; }, s => { s.tables[0].forcedRls = true; },
  s => { s.enums[0].labels.reverse(); }, s => { s.enums[0].owner = 'childguard_v2_app'; },
  s => { s.constraints[0].columns = ['other']; }, s => { s.constraints[0].validated = false; },
  s => { s.constraints[0].enforced = false; }, s => { s.constraints[0].deferrable = true; },
  s => { s.constraints.find(c => c.type === 'f').delete = 'c'; },
  s => { s.constraints.find(c => c.type === 'f').referenceSchema = 'other'; },
  s => { s.constraints.find(c => c.type === 'c').expression = '1 = 1'; },
  s => { s.constraints.find(c => c.type === 'c').noInherit = true; },
  s => { s.indexes.find(x => x.predicate).predicate = '"endedAt" IS NOT NULL'; },
  s => { s.indexes.find(x => x.predicate).unique = false; },
  s => { s.indexes[0].nullsNotDistinct = true; }, s => { s.indexes[0].valid = false; },
  s => { s.indexes[0].columns = ['other']; }, s => { s.indexes[0].options = [1]; },
  s => { s.functions[0].source += '\nRETURN NULL;'; }, s => { s.functions[0].securityDefiner = true; },
  s => { s.functions[0].config = ['search_path=other']; }, s => { s.functions[0].owner = 'childguard_v2_app'; },
  s => { s.triggers[0].enabled = 'D'; }, s => { s.triggers[0].type = 7; }, s => { s.triggers[0].functionSchema = 'other'; },
  s => { s.triggers[0].condition = 'false'; },
];
badSnapshot.forEach((mutate, i) => test(`catalog semantic mismatch ${i} refuses`, () => { const s = snapshot(); mutate(s); assert.throws(() => validateBaselineSnapshot(s)); }));
for (const flag of Object.keys(snapshot().runtime[0]).filter(k => k !== 'name')) test(`runtime ${flag} refuses`, () => {
  const s = snapshot(); s.runtime[0][flag] = true; assert.throws(() => validateBaselineSnapshot(s));
});
for (const mutation of ['missing', 'extra', 'duplicate', 'checksum', 'unfinished', 'rollback', 'steps']) test(`ledger ${mutation} refuses`, () => {
  const rows = ledger();
  if (mutation === 'missing') rows.pop();
  if (mutation === 'extra') rows.push({ ...rows[0], name: 'other' });
  if (mutation === 'duplicate') rows[1] = { ...rows[0] };
  if (mutation === 'checksum') rows[0].checksum = '0'.repeat(64);
  if (mutation === 'unfinished') rows[0].finished = false;
  if (mutation === 'rollback') rows[0].notRolledBack = false;
  if (mutation === 'steps') rows[0].steps = 0;
  assert.throws(() => validateBaselineLedger(rows));
});
for (const rows of [undefined, null, [], [{}]]) test('malformed content/ledger rejects', () => {
  assert.throws(() => validateBaselineContents(rows)); assert.throws(() => validateBaselineLedger(rows));
});
for (const patch of [{ name: 'childguard' }, { name: 'childguard_v2_test' }, { role: 'postgres' }, { login: 'postgres' }, { version: 190000 }, { host: '127.0.0.1/32' }]) test(`independent actual identity ${Object.keys(patch)[0]} rejects before ledger`, async () => {
  const db = mockDb({ actual: [{ ...identity(), ...patch }] });
  await assert.rejects(verifyBaselineDeployed(env, async () => db)); assert.equal(db.calls, 1); assert.equal(db.disconnected, true);
});
for (const badEnv of [{ ...env, DATABASE_URL: url }, { ...env, NODE_ENV: 'test' }, { ...env, PGHOST: 'elsewhere' },
  { ...env, MIGRATION_DATABASE_URL: url.replace('childguard_v2_migrator', 'postgres') },
  { ...env, MIGRATION_DATABASE_URL: url.replace('/childguard_v2?', '/childguard_v2_test?') }]) test('wrong environment refuses before construction', async () => {
  let made = false; await assert.rejects(verifyBaselineDeployed(badEnv, async () => { made = true; })); assert.equal(made, false);
});
for (const failure of [1, 2, 3, 4]) test(`query ${failure} failures redact and disconnect`, async () => {
  const db = mockDb({ failure });
  await assert.rejects(verifyBaselineDeployed(env, async () => db), e => { assert.equal(e.message, 'Baseline verification refused; details withheld'); assert.equal(e.cause, undefined); return true; });
  assert.equal(db.disconnected, true);
});
test('disconnect failure fails closed', async () => { await assert.rejects(verifyBaselineDeployed(env, async () => mockDb({ disconnectFailure: true }))); });
test('numeric BETWEEN, text/enum ANY and cast deparser forms preserve baseline semantics', () => {
  assert.deepEqual(expressionTree('x BETWEEN 0 AND 4294967295'), expressionTree("((x >= 0) AND (x <= '4294967295'::bigint))"));
  assert.deepEqual(expressionTree('"role" IN (\'PARENT\',\'TEACHER\')'), expressionTree("(role = ANY (ARRAY['PARENT'::\"Role\", 'TEACHER'::\"Role\"]))"));
  assert.deepEqual(expressionTree('x BETWEEN -127 AND 0'), expressionTree("((x >= '-127'::integer) AND (x <= '0'::double precision))"));
  assert.notDeepEqual(expressionTree('(a = 1 OR b = 2) AND c = 3'), expressionTree('a = 1 OR (b = 2 AND c = 3)'));
  assert.throws(() => expressionTree('evil()')); assert.throws(() => expressionTree('x = 1; DROP TABLE x'));
});
test('migration client suppresses file discovery only, preserving explicit datasource and policy', () => {
  const options = migrationClientOptions(url, '6.12.0');
  assert.equal(options.datasources.db.url, url); assert.deepEqual(options.log, []);
  const base = { clientVersion: '6.12.0', activeProvider: 'postgresql', datasourceNames: ['db'], relativeEnvPaths: { schemaEnvPath: '../../../.env' }, marker: 1 };
  const result = options.__internal.configOverride(base);
  assert.deepEqual(result.relativeEnvPaths, { rootEnvPath: null, schemaEnvPath: null }); assert.equal(result.marker, 1);
  assert.equal(result.injectableEdgeEnv, undefined); assert.equal(base.relativeEnvPaths.schemaEnvPath, '../../../.env');
  assert.throws(() => migrationClientOptions(url, '6.13.0'));
  assert.throws(() => options.__internal.configOverride({ ...base, clientVersion: '6.13.0' }));
});
test('inspected installed 6.12 override executes before env-file discovery', () => {
  const text = readFileSync(new URL('../node_modules/@prisma/client/runtime/library.js', import.meta.url), 'utf8');
  const constructor = text.indexOf('constructor(n){e=n?.__internal?.configOverride?.(e)??e');
  const envPaths = text.indexOf('let o=e.relativeEnvPaths', constructor);
  const load = text.indexOf('ot(o,{conflictCheck:"none"})', envPaths);
  assert.ok(constructor >= 0 && envPaths > constructor && load > envPaths);
});
