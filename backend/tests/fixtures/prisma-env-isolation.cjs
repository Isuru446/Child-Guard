// DB-free constructor probe. Run only through prisma-env-isolation.node-test.js.
// Private env paths are blocked BEFORE even exists/stat/read is delegated.
// Native addons, network operations and child processes are replaced/blocked.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const net = require('node:net');
const tls = require('node:tls');
const dns = require('node:dns');
const cp = require('node:child_process');

const mode = process.argv[2];
const counters = { envProbes: 0, prohibitedOperations: 0, nativeStubLoads: 0, engineConstructions: 0 };
let datasourcePinned = false;
let stage = 'BOOT';
const url = 'postgresql://childguard_v2_migrator:synthetic%40password@127.0.0.1:5432/childguard_v2?schema=public';
const sentinel = new Error('PRIVATE_ENV_PROBE_BLOCKED');
const fail = () => { process.stdout.write(JSON.stringify({ mode, stage, ...counters, datasourcePinned }) + '\n'); process.stderr.write('Isolation probe FAILED; details withheld\n'); process.exitCode = 1; };
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
// Never forward third-party diagnostics from this intentionally instrumented child.
for (const key of ['log', 'info', 'warn', 'error', 'debug']) console[key] = () => {};

function guardFile(value) {
  const name = value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value;
  if (typeof name === 'string' && path.basename(name).startsWith('.env')) {
    counters.envProbes++;
    throw sentinel;
  }
}
for (const key of ['existsSync', 'readFileSync', 'readFile', 'statSync', 'stat', 'lstatSync', 'lstat', 'accessSync', 'access', 'openSync', 'open']) {
  const original = fs[key];
  fs[key] = function (...args) {
    guardFile(args[0]);
    if (key.startsWith('open') && args[1] !== 'r') return prohibited();
    const result = original.apply(this, args);
    // In-memory corruption only; never edit installed files to test hash refusal.
    const target = mode === 'tampered-generated' ? 'node_modules/.prisma/client/index.js' :
      mode === 'tampered-runtime' ? 'node_modules/@prisma/client/runtime/library.js' : null;
    if (key === 'readFileSync' && target && typeof args[0] === 'string' && args[0].replaceAll('\\', '/').endsWith(target)) {
      return Buffer.isBuffer(result) ? Buffer.concat([result, Buffer.from('\n// synthetic corruption\n')]) : result + '\n// synthetic corruption\n';
    }
    return result;
  };
}
for (const key of ['readFile', 'stat', 'lstat', 'access', 'open']) {
  const original = fs.promises[key];
  fs.promises[key] = function (...args) {
    guardFile(args[0]);
    if (key === 'open' && args[1] !== 'r') return prohibited();
    return original.apply(this, args);
  };
}
function prohibited() { counters.prohibitedOperations++; throw new Error('OPERATION_BLOCKED'); }
for (const key of ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'createWriteStream', 'mkdirSync', 'mkdir', 'unlinkSync', 'unlink', 'rmSync', 'rm', 'renameSync', 'rename', 'copyFileSync', 'copyFile']) fs[key] = prohibited;
for (const key of ['writeFile', 'appendFile', 'mkdir', 'unlink', 'rm', 'rename', 'copyFile']) fs.promises[key] = prohibited;
net.Socket.prototype.connect = prohibited;
net.connect = net.createConnection = tls.connect = prohibited;
for (const key of Object.keys(dns)) if (/^(lookup|resolve|reverse)/.test(key)) dns[key] = prohibited;
for (const key of Object.keys(dns.promises)) if (/^(lookup|resolve|reverse)/.test(key)) dns.promises[key] = prohibited;
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = prohibited;

// The real native QueryEngine never loads, so it cannot connect outside Node's
// network hooks. Only the JS client's constructor/discovery machinery is real.
process.dlopen = (module, filename) => {
  if (typeof filename !== 'string' || !path.basename(filename).startsWith('query_engine-')) return prohibited();
  counters.nativeStubLoads++;
  module.exports = {
    version: () => ({ version: '6.12.0', commit: '8047c96bbd92db98a2abc7c9323ce77c02c89dbc' }),
    QueryEngine: class {
      constructor(config) {
        counters.engineConstructions++;
        const overrides = config.datasourceOverrides;
        datasourcePinned = overrides?.db === url || overrides?.db?.url === url ||
          (Array.isArray(overrides) && overrides.length === 1 && overrides[0]?.name === 'db' && overrides[0]?.url === url);
      }
      connect() { return prohibited(); }
      query() { return prohibited(); }
      startTransaction() { return prohibited(); }
      commitTransaction() { return prohibited(); }
      rollbackTransaction() { return prohibited(); }
      disconnect() { return prohibited(); }
      trace() { return '{}'; }
    },
  };
};

(async () => {
  if (!['guarded', 'control', 'tampered-generated', 'tampered-runtime'].includes(mode)) throw Error();
  if (mode === 'control') {
    stage = 'CONTROL_GENERATED_IMPORT';
    // Generation now carries null env paths. Deliberately enable a forbidden
    // path in this isolated negative-control constructor to prove the probe.
    let caught = false;
    try {
      const { PrismaClient } = require('@prisma/client');
      stage = 'CONTROL_ENV_ENABLED_CONSTRUCTOR';
      new PrismaClient({datasources:{db:{url}},log:[],__internal:{configOverride(config) {
        return {...config,relativeEnvPaths:{rootEnvPath:'../../../.env',schemaEnvPath:null}};
      }}});
    } catch (error) { caught = error === sentinel; }
    if (!caught || counters.envProbes !== 1 || counters.nativeStubLoads !== 0) throw Error();
  } else {
    stage = 'IMPORT_ISOLATED_FACTORY';
    const { createMigrationPrismaClient } = await import('../../src/migration-prisma-client.js');
    if (mode.startsWith('tampered-')) {
      let caught = false;
      try { createMigrationPrismaClient(url); } catch (error) { caught = error.message === 'Migration client refused; details withheld'; }
      if (!caught || counters.envProbes !== 0 || counters.nativeStubLoads !== 0 || counters.prohibitedOperations !== 0) throw Error();
      process.stdout.write(JSON.stringify({ mode, ...counters, datasourcePinned }) + '\n');
      return;
    }
    stage = 'GUARDED_CONSTRUCTOR';
    const client = createMigrationPrismaClient(url);
    // Delegate/field inspection never issues a Prisma query.
    if (!['authSession','center','user','child','device','attendance'].every(name => typeof client[name]?.findMany === 'function') ||
        !client.user.fields.authVersion || !client.authSession.fields.credentialHash) throw Error();
    // Wait for mocked engine construction; stop does not connect a new client.
    stage = 'GUARDED_DISCONNECT';
    await client.$disconnect();
    stage = 'GUARDED_ASSERTIONS';
    if (counters.envProbes !== 0 || counters.nativeStubLoads !== 1 ||
        counters.engineConstructions !== 1 || !datasourcePinned) throw Error();
  }
  if (counters.prohibitedOperations !== 0) throw Error();
  process.stdout.write(JSON.stringify({ mode, ...counters, datasourcePinned }) + '\n');
})().catch(fail);
