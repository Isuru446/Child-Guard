import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Each constructor probe runs in a new, minimal-environment child. No env file
// is created/read/copied; the negative control throws before private path access.
for (const mode of ['control', 'guarded', 'tampered-generated', 'tampered-runtime']) {
  test(`installed Prisma 6.12 ${mode} import/constructor env-discovery probe is DB-free`, () => {
    const env = { NODE_ENV: 'development', NO_COLOR: '1' };
    if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot;
    const result = spawnSync(process.execPath,
      [fileURLToPath(new URL('./fixtures/prisma-env-isolation.cjs', import.meta.url)), mode],
      { cwd: fileURLToPath(new URL('../', import.meta.url)), env, encoding: 'utf8', timeout: 15000 });
    // Never include raw child stderr/stdout in assertion errors.
    assert.equal(result.status, 0, 'Instrumented constructor probe failed; details withheld');
    let data;
    try { data = JSON.parse(result.stdout); } catch { assert.fail('Invalid redacted probe result'); }
    assert.equal(data.mode, mode);
    assert.equal(data.prohibitedOperations, 0);
    assert.equal(data.envProbes, mode === 'control' ? 1 : 0);
    assert.equal(data.nativeStubLoads, mode === 'guarded' ? 1 : 0);
    assert.equal(data.engineConstructions, mode === 'guarded' ? 1 : 0);
    if (mode === 'guarded') assert.equal(data.datasourcePinned, true);
  });
}
