// Migration tooling only: pin the inspected 6.12 private configuration boundary.
// Constructor-time env discovery only, never database admission. The generated
// entry also loads env at import: use migration-prisma-client.js to avoid it.
export function migrationClientOptions(url, version) {
  if (version !== '6.12.0') throw new Error('Migration client refused; details withheld');
  return { datasources: { db: { url } }, log: [],
    __internal: { configOverride(config) {
      if (config.clientVersion !== '6.12.0' || config.activeProvider !== 'postgresql' ||
          JSON.stringify(config.datasourceNames) !== '["db"]') {
        throw new Error('Migration client refused; details withheld');
      }
      return { ...config, relativeEnvPaths: { rootEnvPath: null, schemaEnvPath: null }, injectableEdgeEnv: undefined };
    } },
  };
}
