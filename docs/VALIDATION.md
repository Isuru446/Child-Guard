# Validation results

Prepared on 2026-11-10 in the clean workspace. Commands operated on the copy. No database server, migration, SQL repair, provisioning, restore, physical device connection or firmware upload was run. Tests used memory repositories, synthetic fixtures and temporary loopback HTTP listeners where required.

| Check | Result |
| --- | --- |
| Locked backend dependency installation | Passed with lifecycle scripts disabled; 155 packages installed |
| Locked Web Admin dependency installation | Passed with lifecycle scripts disabled; 262 packages installed |
| Backend isolated Vitest selection | Initial full run: 864 passed, 10 failed across 874 tests; eight failures were a hardcoded media-fixture path and now pass on targeted rerun. Combined coverage: 872 passed, 2 unresolved failures |
| Relocated media/session application suite | All 8 tests passed after fixing fixture creation and guarded cleanup to use the clean copy |
| Portable Node source/catalog checks | All 12 tests passed across admin-session cutover and pickup catalog-policy suites |
| Backend package syntax checks | Passed (`npm run lint`) without importing the operational server |
| React Web Admin | All 464 tests passed across 54 files |
| Web Admin ESLint | Passed |
| Web Admin production build | Passed; Vite reports a bundle-size warning (main JavaScript about 1.09 MB before gzip) |
| Firmware source-contract / host wrappers | 16 assertions passed; 2 native checks explicitly skipped; 4 Python native scripts and 3 standalone C++ programs blocked by absent g++ |
| Complete ESP32 sketch compilation | Not run: no reviewed complete Arduino build environment established in this workspace; no firmware installed or flashed |
| Prisma schema CLI validation | Blocked: lifecycle scripts were disabled, and the required schema engine was absent; offline validation refused its attempted binary download |
| Flutter dependency resolution / analyze / test / platform build | Blocked: Flutter attempted to open its SDK cache lock outside the allowed workspace; no SDK permission change or unrestricted access requested |
| Dart syntax parsing | Passed for 106 Dart source/test files through `dart format --output=none`; missing flutter_lints package warnings mean this is not Flutter analysis or a runtime test |
| Public source exposure-pattern scan | No high-confidence private-key/token patterns or prohibited filenames found; see `security-scan.json` and manual review limits |
| Original-source integrity | All 716 initially copied/reviewed source-file hashes unchanged at verification; canonical schema and all 11 migration SQL files preserved byte-for-byte in the copy |

## Remaining backend failures

1. `backend/tests/accounts.mock.test.js`: **provisioned Parent uses normal login and sees updated attendance only for linked children**. Its in-memory repository lacks later read-support methods used by the attendance endpoint (audit/absence/RFID projection), so the response lacks the expected `data[0]`. The test and relevant runtime files are unchanged from the original source. This needs a fixture update and a reviewed assertion of the current response contract; it is not evidence of a live database failure.
2. `backend/tests/admin-session-cutover.mock.test.js`: **inventory explicitly includes every Admin database writer and excludes public/device/parent-only writes**. The test expects 27 writers; current inventory contains 32, including five RFID routes. The unchanged assertion is stale. The inventory itself was preserved rather than weakened to satisfy the test.

These failures remain visible in the isolated command. They were not skipped or changed into passing tests. No runtime authorization or database policy was altered to make validation succeed.

## Boundaries and initial failures

The first media-fixture suite attempted to create a directory at its hardcoded original-project path. The sandbox refused those writes. The copied test now derives both creation and cleanup paths from its own module location, and all eight tests pass. Original-file hash checks found no changes. No access escalation to the original was requested.

An initial broad Python unittest-discovery attempt also exposed that some legacy firmware scripts execute their native build at import time and one has its own CLI parser. The new `scripts/test-firmware-host.py` runs each script independently and reports unavailable native checks as BLOCKED. A zero runner exit does not mean blocked checks ran.

Initial anonymization introduced a fixture identifier/search mismatch and a JavaScript identifier typo; those were corrected before the final Web Admin test run. Current results above supersede those failures. No hypothetical formatting from `dart format --output=none` was applied.

Initial npm network access was sandbox-blocked; dependency downloads subsequently completed using the approved scoped install commands. Raw npm/test logs and caches remain only under ignored `.validation/`. They are not publication artifacts. Historical report claims were not counted as tests of this copy.
