import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMigrationEnvironment, assertMigrationIdentity, assertEmptyMigrationTarget,
  verifyMigrationTarget } from '../src/migration-admission.js';
import { validateDatabaseUrl } from '../src/database-admission.js';

const config = mode => {
  const suffix = mode === 'test' ? '_test' : '';
  const name = `childguard_v2${suffix}`;
  const role = `${name}_migrator`;
  return { name, role, url: `postgresql://${role}:synthetic%40password@127.0.0.1:5432/${name}?schema=public` };
};
const environment = mode => ({ NODE_ENV: mode, MIGRATION_DATABASE_URL: config(mode).url });
const identity = mode => ({ name: config(mode).name, role: config(mode).role, login: config(mode).role,
  schema: 'public', host: '127.0.0.1', port: 5432, version: 180006,
  superuser: false, createDb: false, createRole: false, replication: false, bypassRls: false,
  canLogin: true, memberships: false, databaseOwner: 'reviewed_v2_admin', schemaOwner: 'pg_database_owner',
  connect: true, databaseCreate: false, temp: false, usage: true, schemaCreate: true,
  runtimeCreate: false, publicCreate: false, plpgsql: true });
const empty = () => ({ objects: 0, schemas: 0, extensions: 0, ledger: false });
function client(identityRows, objectRows = [empty()]) {
  const calls = [];
  return { calls, async $queryRaw(strings, ...values) {
    const sql = strings.join('?');
    assert.match(sql, /^SELECT\b/);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|GRANT|REVOKE|SET|DROP)\b/i);
    calls.push({ sql, values });
    return calls.length === 1 ? identityRows : objectRows;
  }, async $disconnect() { calls.push('disconnect'); } };
}

for (const mode of ['development', 'test']) {
  const good = config(mode).url;
  test(`${mode}: explicit migrator target passes URL and mocked read-only admission`, async () => {
    const db = client([identity(mode)]);
    await verifyMigrationTarget(mode, environment(mode), async url => { assert.equal(url, good); return db; });
    assert.equal(db.calls.length, 3);
    assert.match(db.calls[0].sql, /host\(inet_server_addr\(\)\)/);
    assert.deepEqual(db.calls[0].values, [`${config(mode).name}_app`]);
    assert.match(db.calls[1].sql, /pg_catalog\.pg_depend/);
    assert.match(db.calls[1].sql, /x\.classid <> 'pg_catalog\.pg_default_acl'::regclass/);
    assert.equal(db.calls[2], 'disconnect');
    assert.throws(() => validateDatabaseUrl(good, mode));
  });
  const variants = [
    undefined, '', good.replace('synthetic%40password', ''), good.replace('synthetic%40password', '%ZZ'),
    good.replace('synthetic%40password', '%0A'), good.replace('synthetic%40password', 'raw password'),
    good.replace('127.0.0.1', 'localhost'), good.replace('127.0.0.1', '127.1'),
    good.replace('127.0.0.1', '[::1]'), good.replace(':5432', ''), good.replace(':5432', ':5433'),
    good.replace('_migrator:', '_app:'), good.replace(config(mode).role + ':', 'postgres:'),
    good.replace('?schema=public', ''), good.replace('schema=public', 'schema=private'),
    good + '&schema=public', good + '&host=elsewhere', good + '#fragment',
    good.replace('/' + config(mode).name + '?', '/ignored/../' + config(mode).name + '?'),
    config(mode === 'test' ? 'development' : 'test').url,
    ...['childguard', 'childguard_test', 'childguard_prototype', 'childguard_verify_20261023_094312', 'postgres', 'other']
      .map(name => good.replace('/' + config(mode).name + '?', '/' + name + '?')),
  ];
  for (const [i, url] of variants.entries()) test(`${mode}: bad URL case ${i} refuses before client creation`, async () => {
    let made = false;
    await assert.rejects(verifyMigrationTarget(mode, { ...environment(mode), MIGRATION_DATABASE_URL: url },
      async () => { made = true; throw Error(); }));
    assert.equal(made, false);
  });
  for (const name of ['PGHOST', 'pgport', 'PGSERVICEFILE', 'DOTENV_CONFIG_PATH', 'DOTENV_KEY',
    'PRISMA_CONFIG', 'PRISMA_SCHEMA_ENGINE_BINARY', 'PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK',
    'DATABASE_URL', 'TEST_DATABASE_URL', 'DIRECT_URL', 'SHADOW_DATABASE_URL', 'NODE_OPTIONS', 'NODE_PATH',
    'DEBUG', 'migration_database_url', 'node_env']) {
    test(`${mode}: conflicting ${name} refused`, () => {
      assert.throws(() => validateMigrationEnvironment(mode, { ...environment(mode), [name]: 'synthetic' }));
    });
  }
  for (const nodeEnv of [undefined, '', 'production', mode === 'test' ? 'development' : 'test']) {
    test(`${mode}: missing/wrong NODE_ENV ${String(nodeEnv)} refused`, () => {
      assert.throws(() => validateMigrationEnvironment(mode, { ...environment(mode), NODE_ENV: nodeEnv }));
    });
  }
  const badFields = {
    name: 'childguard', role: 'postgres', login: 'postgres', schema: null, host: '127.0.0.1/32', port: 5433,
    version: 170006, superuser: true, createDb: true, createRole: true, replication: true, bypassRls: true,
    canLogin: false, memberships: true, databaseOwner: config(mode).role, schemaOwner: config(mode).role,
    connect: false, databaseCreate: true, temp: true, usage: false, schemaCreate: false,
    runtimeCreate: true, publicCreate: true, plpgsql: false,
  };
  for (const [field, value] of Object.entries(badFields)) test(`${mode}: bad actual ${field} refused before catalog inspection`, async () => {
    const db = client([{ ...identity(mode), [field]: value }]);
    await assert.rejects(verifyMigrationTarget(mode, environment(mode), async () => db));
    assert.equal(db.calls.length, 2);
    assert.equal(db.calls[1], 'disconnect');
  });
  for (const field of Object.keys(identity(mode))) test(`${mode}: missing actual ${field} fails closed`, async () => {
    const a = identity(mode); delete a[field];
    await assert.rejects(assertMigrationIdentity(client([a]), mode));
  });
  for (const version of [190000, '180006', 180006.5, null]) test(`${mode}: invalid version ${String(version)} rejected`, async () => {
    await assert.rejects(assertMigrationIdentity(client([{ ...identity(mode), version }]), mode));
  });
}

for (const mode of [undefined, '', 'production', 'constructor', 'toString']) test(`explicit mode ${String(mode)} refused`, () => {
  assert.throws(() => validateMigrationEnvironment(mode, environment('development')));
});
for (const rows of [undefined, [], [{}], [identity('development'), identity('development')]]) {
  test('malformed identity row set refused', async () => {
    await assert.rejects(assertMigrationIdentity(client(rows), 'development'));
  });
}
for (const patch of [{ objects: 1 }, { schemas: 1 }, { extensions: 1 }, { ledger: true },
  { objects: '0' }, { objects: -1 }, { objects: 0n }, { ledger: undefined }, { schemas: null }]) {
  test(`catalog mismatch ${Object.keys(patch)[0]} refused and disconnected`, async () => {
    const db = client([identity('development')], [{ ...empty(), ...patch }]);
    await assert.rejects(verifyMigrationTarget('development', environment('development'), async () => db));
    assert.equal(db.calls.at(-1), 'disconnect');
  });
}
for (const rows of [undefined, [], [{}], [empty(), empty()]]) test('malformed catalog rows refused', async () => {
  const db = { $queryRaw: async () => rows };
  await assert.rejects(assertEmptyMigrationTarget(db));
});
for (const failureAt of [1, 2]) test(`query ${failureAt} failure is sanitized and disconnects`, async () => {
  let queries = 0, closed = false;
  const db = { async $queryRaw() { if (++queries === failureAt) throw Error(config('development').url); return [identity('development')]; },
    async $disconnect() { closed = true; } };
  await assert.rejects(verifyMigrationTarget('development', environment('development'), async () => db), e => {
    assert.equal(e.message, 'V2 migration preflight refused; details withheld');
    assert.equal(e.cause, undefined); return true;
  });
  assert.equal(closed, true);
});
test('client creation and disconnect failures are sanitized', async () => {
  const fail = async () => { throw Error(config('development').url); };
  await assert.rejects(verifyMigrationTarget('development', environment('development'), fail), /details withheld/);
  const db = client([identity('development')]); db.$disconnect = fail;
  await assert.rejects(verifyMigrationTarget('development', environment('development'), async () => db), /details withheld/);
});
