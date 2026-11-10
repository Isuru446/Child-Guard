# ChildGuard V2 backend

Node.js/Express APIs support authenticated wearable events, RFID attendance, role- and center-scoped Parent/Teacher/Admin workflows, monitoring, pickup, activity and tamper alerts. Persistence uses Prisma 6.12.0 and PostgreSQL.

Use Node.js >=22.12.0. Run `npm ci --ignore-scripts` in this directory. Configure private values from `.env.example` only in an approved isolated environment. Current V2 admission code requires PostgreSQL 18, the documented loopback endpoint and dedicated V2 roles.

**Database setup is blocked pending migration reconciliation.** Do not run `npm run migrate`, `npm run setup`, repair SQL or the historical deployment scripts as a source-review step. The canonical chain is missing a migration expected by historical evidence and does not establish full runtime readiness.

Run isolated tests with `node node_modules/vitest/vitest.mjs run --config vitest.isolated.config.js`. The original `npm test` includes real database integration suites. `npm run lint` performs syntax checks. Startup uses `npm start` from this directory after the database prerequisite is resolved; no server was started during preparation.

See [setup](../docs/SETUP.md), [database review](../docs/DATABASE.md), [testing](../docs/TESTING.md), [architecture](../docs/ARCHITECTURE.md) and the retained [API reference](API.md). Historical API notes may describe earlier contracts; current route validation and authorization code are authoritative.
