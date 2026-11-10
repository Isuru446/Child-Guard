import { defineConfig } from 'vitest/config';

// Reviewed suites use in-memory repositories or pure functions. Do not expand
// this to tests/**/*.test.js: that would select real database integration tests.
export default defineConfig({
  test: {
    include: [
      'tests/*.mock.test.js',
      'tests/activity-analysis.test.js',
      'tests/activity-history.test.js',
      'tests/ble-validation.test.js',
      'tests/database-safety.test.js',
      'tests/firmware-integration.test.js',
      'tests/gate-danger.test.js',
      'tests/monitoring-events.test.js',
      'tests/parent-updates.test.js',
    ],
    setupFiles: ['./tests/helpers/isolated-review-guard.js'],
    maxWorkers: 1,
    env: { NODE_ENV: 'test', DATABASE_URL: '', TEST_DATABASE_URL: '', JWT_SECRET: '', RFID_UID_HMAC_KEY: '' },
  },
});
