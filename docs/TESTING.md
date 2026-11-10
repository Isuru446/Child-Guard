# Testing without live services

Install locked dependencies as described in [setup](SETUP.md). Start from the clean copy. Do not run deployment, backup, restore, provisioning or database integration scripts during this review.

```powershell
# From the repository root: reviewed backend suites, all web tests and web build
powershell -NoProfile -File scripts/Test-Isolated.ps1
```

The backend isolation configuration selects mock suites and named pure/source-contract suites. It blocks the real Prisma client and private environment loader. The tests exercise an in-memory Express application, sometimes through temporary loopback HTTP listeners used by Supertest. They do not start the operational server or need a database. Its environment clears database URLs and runtime secrets. The configuration must not be broadened to all backend tests without reviewing integration dependencies.

```powershell
# Same backend selection directly
Set-Location backend
node node_modules/vitest/vitest.mjs run --config vitest.isolated.config.js
npm.cmd run lint
Set-Location ../web_front
npm.cmd test
npm.cmd run build
npm.cmd run lint
```

`backend/npm test` is the original broad command and includes database integration tests. Historical `*.node-test.js` suites are retained separately: some inspect excluded generated-client snapshots, canonical Windows deployment locations and frozen hashes. Do not run them indiscriminately. Their missing artifacts and original-root dependencies are recorded in [publication blockers](PUBLICATION_BLOCKERS.md).

## Firmware host tests

```powershell
python scripts/test-firmware-host.py
```

The runner executes each script separately because several legacy files run native programs at import time, and the multi-beacon script has its own argument parser. It reports unavailable compiler checks as BLOCKED. Native checks require `g++` on PATH. `multi_beacon_test.py` also accepts `--compiler` when invoked directly. These checks do not verify an ESP32-linked binary or radio timing. Individual source-only checks can run without a compiler:

```powershell
python firmware/tests/beacon_contract_test.py
python firmware/tests/bus_transport_contract_test.py
python firmware/tests/rfid_test.py
python firmware/tests/tamper_test.py
python firmware/tests/telemetry_priority_test.py
```

## Flutter

Inside `App`, run `flutter pub get`, `flutter analyze` and `flutter test` using a compatible SDK. The test support uses synthetic API fixtures. A platform release build additionally needs its platform SDK, local SDK paths and signing setup. Never copy platform signing keys into this repository.

## Interpretation

See [recorded results](VALIDATION.md) for checks actually attempted on this copy. Passing mocked tests demonstrates application logic in the mocked environment; it does not establish a complete migration path, PostgreSQL permissions, persisted transaction behavior, BLE performance, correct wearing, notification delivery or physical safety.
