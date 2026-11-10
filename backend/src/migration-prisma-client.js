// Migration tooling only. The generated entry point calls warnEnvConflicts at
// import time, before configOverride. Read its hash-pinned JSON DATA instead;
// never evaluate/import that entry point or patch the shared runtime exports.
import { readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationClientOptions } from './migration-client-options.js';
import { forwardPrismaIntegrity } from './forward-prisma-client-integrity.js';

const refuse = () => new Error('Migration client refused; details withheld');
const pins = Object.freeze({
  generated: forwardPrismaIntegrity.generatedFiles['index.js'],
  runtime: 'C7007AE0F7E447362DAC9F28022ED902EB279EC73F7B630111D45D61C34A10E6',
});
function readPinned(path, hash) {
  if (realpathSync(path) !== path) throw refuse();
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex').toUpperCase() !== hash) throw refuse();
  return bytes.toString('utf8');
}

export function createMigrationPrismaClient(url) {
  try {
    const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    if (backend !== resolve('D:/ChildGuard-V2/backend') || realpathSync(backend) !== backend) throw refuse();
    const generatedPath = resolve(backend, 'node_modules/.prisma/client/index.js');
    const runtimePath = resolve(backend, 'node_modules/@prisma/client/runtime/library.js');
    const source = readPinned(generatedPath, pins.generated);
    readPinned(runtimePath, pins.runtime);
    // Delimiters belong to this exact pinned file format. JSON.parse never runs
    // code; changes to generator output require another review, never fallback.
    const match = /const config = (\{[\s\S]*?\r?\n\})\s*\r?\n\s*const fs = require\('fs'\)/.exec(source);
    if (!match) throw refuse();
    const config = JSON.parse(match[1]);
    const prefix = 'config.runtimeDataModel = JSON.parse(';
    const modelLine = source.split(/\r?\n/).find(line => line.startsWith(prefix));
    if (!modelLine?.endsWith(')')) throw refuse();
    config.runtimeDataModel = JSON.parse(JSON.parse(modelLine.slice(prefix.length, -1)));
    config.dirname = dirname(generatedPath);
    config.relativeEnvPaths = { rootEnvPath: null, schemaEnvPath: null };
    config.injectableEdgeEnv = undefined;
    const options = migrationClientOptions(url, config.clientVersion);
    // The same guard runs before getPrismaClient and again at construction.
    const isolated = options.__internal.configOverride(config);
    const { getPrismaClient } = createRequire(import.meta.url)(runtimePath);
    const PrismaClient = getPrismaClient(isolated);
    return new PrismaClient(options);
  } catch { throw refuse(); }
}
