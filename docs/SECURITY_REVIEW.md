# Security and privacy review

## Scope and outcome

The clean copy was selected from the original source without copying real environment files, firmware credentials, private media, database dumps or private-backup contents. Original `secrets.h` and real `.env` contents were not needed for preparation and were not printed. No live credentials were rotated. `private-backups/` was excluded without inspection or traversal.

The public scan found no high-confidence exposed private keys, common access-token formats or prohibited private filenames. This is a bounded source review, not a guarantee against an unknown secret format. [security-scan.json](security-scan.json) records the pattern scan; [public-files.csv](public-files.csv) enumerates selected files and SHA-256 hashes. Generated index files omit their own hashes to avoid circular checksum references.

## Changes and exclusions

- Added the missing wearable `secrets.example.h` using placeholder Wi-Fi, backend and token values.
- Replaced the RFID example's original network identifier and private-LAN example with placeholders; HTTPS certificate checking stays enabled and trusted-LAN HTTP stays disabled by default.
- Replaced the backend example's named child and machine-specific media directory with generic values and a local ignored media path. Its database credentials and JWT secret are explicitly unusable placeholders.
- Added Flutter example dart defines without an operational endpoint or authentication token.
- Replaced personal-looking demo child, guardian, teacher/applicant and driver records, contact numbers and addresses with explicit synthetic data. Related test fixtures remain consistent. The named development activity preview now requires an operator-selected synthetic `Demo Child` record and preserves the existing authorization and ID checks.
- Excluded original private JSON files, dumps, backups, media, machine SDK paths, cached clients, generated stages, logs and report exports before copying. Portable Gradle wrapper files are deliberately retained and allowed by Android's ignore rules; regenerable Android/iOS plugin registrants are excluded.
- Kept runtime database guards, deployment hashes, historical migration bytes, constraint repair SQL and authentication policy intact. Legacy deployment paths remain documented rather than silently redirected.

Synthetic test passwords, tokens, malformed credentials and in-memory hashes remain in tests because they exercise security behavior. The mobile demo security store has a clearly named demo-only password used by its local demo UI; it is not backend authentication or a deployed credential. Public BLE UUIDs and hardware IDs identify radio configuration and are not secrets. Schema-only catalog/ledger evidence contains no child rows or media. No live backup or private approval record was copied.

## Runtime risks still requiring engineering work

The wearable uses HTTP telemetry, so device credentials and observations need a reviewed secure transport before deployment. Public BLE advertisements can be spoofed, and RSSI cannot prove a child's exact position or safety. RFID UID presentation is not strong identity verification. GPS, sensor coverage, bounded queues and offline states can leave information unavailable. The prototype is not an automatic emergency-response service.

Admin cookie origin/CSRF behavior is configured for local development; public hosting requires a reviewed TLS, cookie, CORS, media-storage, rate-limit and deployment configuration. Private photos need controlled retention and access. Migration inconsistencies and the separately supplied tamper SQL repair mean successful mock tests do not establish database readiness.

Some legacy scripts still name the original Windows workspace and protected database roles. They are retained for test support and historical review only. Do not execute them as a portable setup path. [local-paths.csv](local-paths.csv) locates these references without exposing values from private configuration.

Dependency packages were installed from retained lockfiles with lifecycle scripts disabled. A network vulnerability/advisory audit was not performed; no claim that dependencies are vulnerability-free is made. Third-party asset provenance and a redistribution license still require owner review. Unused template artwork and the duplicate reference UI are excluded.

## Original and publication boundaries

All 716 initially selected original source hashes were unchanged when rechecked. The canonical Prisma schema and all 11 migrations remain byte-identical to source. A legacy test's attempted original-folder fixture creation was blocked, then fixed only in the copy. No database operation, physical-device modification, Git initialization, commit, remote creation or upload occurred.

The intended public set excludes `node_modules`, builds, caches and `.validation`; do not upload the whole workspace as an archive. Rerun `python scripts/review-public-copy.py` after edits and inspect the staged manifest list locally after publication approval.
