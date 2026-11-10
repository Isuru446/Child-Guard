// No dotenv, Prisma, network, filesystem or application imports: safe for pure tests.
const targets = Object.freeze({
 development: Object.freeze({database:'childguard_v2', role:'childguard_v2_app'}),
 test: Object.freeze({database:'childguard_v2_test', role:'childguard_v2_test_app'}),
});
const refusal = () => new Error('V2 database admission refused; configuration and connection details withheld');
function targetFor(mode) {
 if (!Object.hasOwn(targets, mode)) throw refusal();
 return targets[mode];
}

export function validateDatabaseUrl(value, mode) {
 const target = targetFor(mode);
 // Check original spelling too: URL parsers can normalize unsafe input.
 const pattern = new RegExp(`^(postgres|postgresql)://${target.role}:([^@/?#:\\s\\\\]+)@127\\.0\\.0\\.1:5432/${target.database}\\?schema=public$`);
 if (typeof value !== 'string' || /[\x00-\x20\x7f\\]/.test(value) || !pattern.test(value)) throw refusal();
 try {
  const url = new URL(value);
  const password = decodeURIComponent(url.password);
  if (!password || /[\x00-\x20\x7f]/.test(password) ||
      url.username !== target.role || url.hostname !== '127.0.0.1' ||
      url.port !== '5432' || url.pathname !== `/${target.database}` ||
      url.search !== '?schema=public' || url.hash) throw refusal();
 } catch { throw refusal(); }
 return value;
}

export function validateDatabaseEnvironment(value, mode, environment) {
 targetFor(mode);
 validateDatabaseUrl(value, mode);
 if (!environment || environment.NODE_ENV !== mode) throw refusal();
 for (const [name, configured] of Object.entries(environment)) {
  if (configured === undefined || configured === '') continue;
  if (/^PG/i.test(name) || /^DOTENV_CONFIG_/i.test(name) ||
      /^(NODE_OPTIONS|DIRECT_URL|SHADOW_DATABASE_URL|PRISMA_CONFIG|PRISMA_SCHEMA_ENGINE_BINARY|PRISMA_QUERY_ENGINE_BINARY|PRISMA_QUERY_ENGINE_LIBRARY)$/i.test(name)) throw refusal();
 }
 if (environment.DATABASE_URL !== undefined && environment.DATABASE_URL !== '' &&
     environment.DATABASE_URL !== value) throw refusal();
 if (mode === 'development') {
  if (environment.TEST_DATABASE_URL) throw refusal();
 } else if (environment.TEST_DATABASE_URL !== value) throw refusal();
 return value;
}

// Refuse conflicts instead of silently choosing file or inherited values.
export function mergeDevelopmentEnvironment(inherited, file = {}) {
 for (const [name, value] of Object.entries(file)) {
  if (inherited[name] !== undefined && inherited[name] !== value) throw refusal();
 }
 const effective = {...inherited, ...file};
 validateDatabaseEnvironment(effective.DATABASE_URL, 'development', effective);
 return effective;
}

// Deliberately narrow .env format: one uppercase KEY=value per line, no duplicates.
export function validateDevelopmentEnvironmentText(text) {
 const seen = new Set();
 for (const line of text.split(/\r?\n/)) {
  if (!line.trim() || line.trimStart().startsWith('#')) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match || seen.has(match[1])) throw refusal();
  const value = match[2];
  if ((value.startsWith('"') || value.startsWith("'")) &&
      (value.length < 2 || !value.endsWith(value[0]))) throw refusal();
  seen.add(match[1]);
 }
}

export async function assertDatabaseIdentity(db, mode) {
 const expected = targetFor(mode);
 try {
  // One read-only SELECT, also usable with existing interactive tx clients.
  const rows = await db.$queryRaw`SELECT current_database() AS name,
    current_user AS role, session_user AS login, current_schema() AS schema,
    host(inet_server_addr()) AS host, inet_server_port() AS port,
    current_setting('server_version_num')::int AS version,
    r.rolsuper AS superuser, r.rolcreatedb AS "createDb",
    r.rolcreaterole AS "createRole", r.rolreplication AS replication,
    r.rolbypassrls AS "bypassRls"
    FROM pg_roles r WHERE r.rolname = current_user`;
  if (!Array.isArray(rows) || rows.length !== 1) throw refusal();
  const actual = rows[0];
  if (actual?.name !== expected.database || actual.role !== expected.role ||
      actual.login !== expected.role || actual.schema !== 'public' ||
      actual.host !== '127.0.0.1' || actual.port !== 5432 ||
      !Number.isInteger(actual.version) || actual.version < 180000 || actual.version >= 190000 ||
      ['superuser','createDb','createRole','replication','bypassRls'].some(key => actual[key] !== false)) throw refusal();
 } catch { throw refusal(); }
}

// Testable ordering boundary: admission must finish before the HTTP action.
export async function withDatabaseAdmission(db, value, mode, environment, action) {
 validateDatabaseEnvironment(value, mode, environment);
 await assertDatabaseIdentity(db, mode);
 return action();
}
