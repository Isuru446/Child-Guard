// Shared by Vitest and Node's built-in runner. No real client can be imported here.
import assert from 'node:assert/strict';
import { validateDatabaseUrl, validateDatabaseEnvironment, mergeDevelopmentEnvironment, validateDevelopmentEnvironmentText,
 assertDatabaseIdentity, withDatabaseAdmission } from '../src/database-admission.js';
import { validateTestDatabaseUrl, assertTestDatabase } from './database-safety.js';

const settings = mode => mode === 'test'
 ? {name:'childguard_v2_test', role:'childguard_v2_test_app'}
 : {name:'childguard_v2', role:'childguard_v2_app'};
const urlFor = mode => {
 const {name,role} = settings(mode);
 return `postgresql://${role}:synthetic%40password@127.0.0.1:5432/${name}?schema=public`;
};
const envFor = mode => ({NODE_ENV:mode, DATABASE_URL:urlFor(mode),
 ...(mode === 'test' ? {TEST_DATABASE_URL:urlFor(mode)} : {})});
const identity = mode => ({...settings(mode),login:settings(mode).role, schema:'public',
 host:'127.0.0.1',port:5432,version:180006,superuser:false,createDb:false,
 createRole:false,replication:false,bypassRls:false});
function fakeDb(rows) {
 const calls = [];
 return {calls, async $queryRaw(strings,...values) {
  calls.push({sql:strings.join('?'), values});
  return rows;
 }};
}

export function registerDatabaseSafetyTests(test) {
 test('identity SELECT extracts the inet host without its text-cast network mask', async () => {
  const db = {async $queryRaw(strings, ...values) {
   const sql = strings.join('?');
   assert.equal(values.length, 0);
   assert.match(sql, /host\(inet_server_addr\(\)\) AS host/);
   assert.doesNotMatch(sql, /inet_server_addr\(\)::text/);
   return [identity('development')];
  }};
  await assertDatabaseIdentity(db, 'development');
 });
 test('identity validator still refuses masked inet text rather than broadening its host allowlist', async () => {
  await assert.rejects(assertDatabaseIdentity(
   fakeDb([{...identity('development'), host:'127.0.0.1/32'}]), 'development'));
 });
 for (const mode of ['development','test']) {
  const good = urlFor(mode);
  const {name,role} = settings(mode);
  test(`${mode}: admits only its exact explicit V2 target`, () => {
   assert.equal(validateDatabaseEnvironment(good,mode,envFor(mode)),good);
   assert.equal(validateDatabaseUrl(good.replace('postgresql:','postgres:'),mode),good.replace('postgresql:','postgres:'));
  });
  for (const rejectedName of ['childguard','childguard_test','childguard_prototype',
   'childguard_verify_20261023_094312',mode === 'test' ? 'childguard_v2' : 'childguard_v2_test','other']) {
   test(`${mode}: rejects database ${rejectedName} without a query`, async () => {
    const db = fakeDb([identity(mode)]);
    let action = false;
    await assert.rejects(withDatabaseAdmission(db, good.replace(`/${name}?`,`/${rejectedName}?`),
     mode,envFor(mode),() => {action = true;}));
    assert.equal(db.calls.length,0); assert.equal(action,false);
   });
  }
  const badUrls = [
   ['missing',undefined],['empty',''],['malformed','not-a-url'],['object',{}],
   ['wrong protocol',good.replace('postgresql:','http:')],
   ['wrong host',good.replace('127.0.0.1','localhost')],
   ['remote host',good.replace('127.0.0.1','192.0.2.1')],
   ['normalized IP',good.replace('127.0.0.1','127.1')],
   ['IPv6',good.replace('127.0.0.1','[::1]')],
   ['wrong port',good.replace(':5432',':5433')],
   ['implicit port',good.replace(':5432','')],
   ['wrong role',good.replace(role,'other_app')],
   ['superuser',good.replace(role,'postgres')],
   ['missing password',good.replace('synthetic%40password','')],
   ['bad escape',good.replace('%40','%zz')],
   ['encoded control',good.replace('%40','%00')],
   ['raw delimiter',good.replace('%40',':')],
   ['missing schema',good.replace('?schema=public','')],
   ['wrong schema',good.replace('schema=public','schema=private')],
   ['duplicate schema',good+'&schema=public'],
   ['host redirect',good+'&host=192.0.2.1'],
   ['port redirect',good+'&port=5433'],
   ['user redirect',good+'&user=postgres'],
   ['database redirect',good+'&dbname=childguard'],
   ['connection options',good+'&options=-csearch_path=private'],
   ['unknown parameter',good+'&connection_limit=1'],
   ['encoded query key',good.replace('schema','%73chema')],
   ['fragment',good+'#ignored'],['trailing whitespace',good+' '],
   ['newline',good+'\n'],['dot normalization',good.replace(`/${name}`,`/other/../${name}`)],
  ];
  for (const [label,value] of badUrls) test(`${mode}: rejects ${label}`, () => {
   assert.throws(() => validateDatabaseUrl(value,mode), /details withheld/);
  });
  for (const [label,patch] of [
   ['missing mode',{NODE_ENV:undefined}],['wrong mode',{NODE_ENV:mode === 'test' ? 'development' : 'test'}],
   ['production',{NODE_ENV:'production'}],['conflicting datasource',{DATABASE_URL:urlFor(mode === 'test' ? 'development' : 'test')}],
   ...['PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGOPTIONS',
    'DOTENV_CONFIG_PATH','DOTENV_CONFIG_OVERRIDE','NODE_OPTIONS','DIRECT_URL','SHADOW_DATABASE_URL',
    'PRISMA_QUERY_ENGINE_LIBRARY','PRISMA_QUERY_ENGINE_BINARY','PRISMA_SCHEMA_ENGINE_BINARY','PRISMA_CONFIG'].map(key => [key,{[key]:'synthetic-conflict'}]),
   ...(mode === 'test' ? [['missing explicit test URL',{TEST_DATABASE_URL:undefined}]]
    : [['test URL in dev',{TEST_DATABASE_URL:urlFor('test')}]]),
  ]) test(`${mode}: rejects environment ${label}`, () => {
   assert.throws(() => validateDatabaseEnvironment(good,mode,{...envFor(mode),...patch}));
  });
  test(`${mode}: performs a read-only identity SELECT before the admitted action`, async () => {
   const db = fakeDb([identity(mode)]);
   let called = false;
   await withDatabaseAdmission(db,good,mode,envFor(mode),() => {
    assert.equal(db.calls.length,1); called = true;
   });
   assert.equal(called,true);
   assert.match(db.calls[0].sql,/^SELECT /);
   assert.equal(db.calls[0].values.length,0);
   assert.doesNotMatch(db.calls[0].sql,/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
  });
  for (const [label,patch] of [
   ['protected database',{name:'childguard_test'}],['other V2 database',{name:settings(mode === 'test' ? 'development' : 'test').name}],
   ['wrong role',{role:'other_app'}],['superuser login',{login:'postgres'}],['wrong schema',{schema:'private'}],
   ['wrong server address',{host:'192.0.2.1'}],['wrong server port',{port:5433}],
   ['old PostgreSQL',{version:170006}],['future PostgreSQL',{version:190000}],['missing version',{version:undefined}],
   ['noninteger version',{version:'180006'}],
   ...['superuser','createDb','createRole','replication','bypassRls'].map(key => [key,{[key]:true}]),
  ]) test(`${mode}: refuses actual ${label} before action`, async () => {
   let called = false;
   await assert.rejects(withDatabaseAdmission(fakeDb([{...identity(mode),...patch}]),
    good,mode,envFor(mode),() => {called=true;}));
   assert.equal(called,false);
  });
  for (const [label,rows] of [['empty',[]],['duplicate',[identity(mode),identity(mode)]],['missing fields',[{}]],['missing result',undefined]]) {
   test(`${mode}: refuses ${label} identity results`, async () => {
    await assert.rejects(assertDatabaseIdentity(fakeDb(rows),mode));
   });
  }
 }
 test('never includes URL or engine error secrets in admission errors', async () => {
  await assert.rejects(assertDatabaseIdentity({$queryRaw:async () => {throw Error(urlFor('test'));}},'test'),error => {
   assert.equal(error.cause,undefined);
   assert.doesNotMatch(error.message,/synthetic|postgresql:|password/);
   return true;
  });
 });
 test('unknown admission mode is refused', () => assert.throws(() => validateDatabaseUrl(urlFor('test'),'production')));
 test('canonical environment text permits comments and blank template values', () => {
  validateDevelopmentEnvironmentText('# documentation\nDATABASE_URL=\nNODE_ENV=development\n');
 });
 for (const [label,text] of [
  ['duplicate key','DATABASE_URL=first\nDATABASE_URL=second'],
  ['export syntax','export DATABASE_URL=value'],
  ['lowercase key','database_url=value'],
  ['multiline value','JWT_SECRET="first\nsecond"'],
 ]) test(`canonical environment text rejects ${label}`, () => assert.throws(() => validateDevelopmentEnvironmentText(text)));
 test('dev file and inherited conflicts are refused rather than overwritten', () => {
  assert.throws(() => mergeDevelopmentEnvironment(envFor('development'),{DATABASE_URL:urlFor('test')}));
  assert.throws(() => mergeDevelopmentEnvironment(envFor('development'),{PORT:'3100',NODE_ENV:'test'}));
  assert.deepEqual(mergeDevelopmentEnvironment({},envFor('development')),envFor('development'));
 });
 test('existing test wrappers enforce environment and identity with injected mocks only', async () => {
  const env=envFor('test');
  assert.equal(validateTestDatabaseUrl(env.TEST_DATABASE_URL,env),env.TEST_DATABASE_URL);
  const db=fakeDb([identity('test')]);
  await assertTestDatabase(db,env);
  assert.equal(db.calls.length,1);
  const blocked=fakeDb([identity('test')]);
  await assert.rejects(assertTestDatabase(blocked,{...env,TEST_DATABASE_URL:urlFor('development')}));
  assert.equal(blocked.calls.length,0);
 });
}
