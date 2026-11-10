# Changes from the reviewed original

Only the clean copy was edited. The source-integrity table records the original and public hashes for every initially selected source file. All 716 original hashes were rechecked without a mismatch. All 11 canonical migration SQL files, the migration lock and current Prisma schema remain byte-identical.

## Intentional changes

- New professional root README, architecture/hardware/setup/database/test/security documentation and publication instructions replace temporary implementation reports.
- New root ignore rules protect credentials, private data, caches, generated stages and local validation output. Android ignore exceptions retain portable Gradle launchers and wrapper JAR. Regenerable platform registrants are excluded.
- New safe wearable and Flutter configuration examples; sanitized backend/RFID examples contain only placeholders.
- UI demonstration records use synthetic names/contacts. The development activity preview's name restriction now matches the synthetic `Demo Child`, retaining its pinned ID and authorization requirements. Related test fixtures and localized demo text are updated consistently.
- Three general test files now derive fixture inputs or temporary media paths from their module location. Media cleanup keeps its containment/realpath checks. Historical hash-pinned deployment policies and stage generators remain unchanged.
- The Vite configuration imports its proxy with an explicit `.js` extension, removing a portability warning. Unused template artwork, sprite and reference-UI builder are excluded after checking source references.
- The historical baseline report is replaced with the exact public fingerprint table required by regression tests. The historical admin-session cutover patch and schema-only catalog/ledger test support remain.
- Added an explicit isolated Vitest configuration with real-client/environment-loader guards, a PowerShell test runner, a standalone firmware host runner and a public-file inventory/security-pattern scan. No automated deployment or firmware upload was added.

Two stale backend mock tests remain unresolved and visible; see [validation](VALIDATION.md). Missing migrations, old generated-client snapshots and database approval history were not invented. No application authorization, SQL constraint or deployment checksum was loosened.

## Modified retained source files

- [App/README.md](../App/README.md)
- [App/android/.gitignore](../App/android/.gitignore)
- [App/lib/core/app_translations.dart](../App/lib/core/app_translations.dart)
- [App/lib/screens/attendance/attendance_record_screen.dart](../App/lib/screens/attendance/attendance_record_screen.dart)
- [App/lib/screens/auth/register_screen.dart](../App/lib/screens/auth/register_screen.dart)
- [App/lib/screens/map/map_screen.dart](../App/lib/screens/map/map_screen.dart)
- [App/lib/screens/profile/emergency_contacts_screen.dart](../App/lib/screens/profile/emergency_contacts_screen.dart)
- [App/lib/screens/profile/help_support_screen.dart](../App/lib/screens/profile/help_support_screen.dart)
- [App/lib/screens/profile/teacher_profile_screen.dart](../App/lib/screens/profile/teacher_profile_screen.dart)
- [App/test/daily_activity_history_test.dart](../App/test/daily_activity_history_test.dart)
- [App/test/navigation_settings_test.dart](../App/test/navigation_settings_test.dart)
- [App/test/reference_screens_test.dart](../App/test/reference_screens_test.dart)
- [App/test/teacher_attendance_filter_test.dart](../App/test/teacher_attendance_filter_test.dart)
- [backend/.env.example](../backend/.env.example)
- [backend/API.md](../backend/API.md)
- [backend/README.md](../backend/README.md)
- [backend/src/activity-history.js](../backend/src/activity-history.js)
- [backend/tests/activity-history-auth.mock.test.js](../backend/tests/activity-history-auth.mock.test.js)
- [backend/tests/activity-history.test.js](../backend/tests/activity-history.test.js)
- [backend/tests/admin-session-application.mock.test.js](../backend/tests/admin-session-application.mock.test.js)
- [backend/tests/admin-session-cutover-patch.node-test.js](../backend/tests/admin-session-cutover-patch.node-test.js)
- [backend/tests/attendance-workflow.mock.test.js](../backend/tests/attendance-workflow.mock.test.js)
- [backend/tests/fixtures/activity-history.contract.json](../backend/tests/fixtures/activity-history.contract.json)
- [backend/tests/pickup-catalog-policy.node-test.js](../backend/tests/pickup-catalog-policy.node-test.js)
- [firmware/ChildGuard_Beacon/README.md](../firmware/ChildGuard_Beacon/README.md)
- [firmware/ChildGuard_Bus_Beacon/README.md](../firmware/ChildGuard_Bus_Beacon/README.md)
- [firmware/ChildGuard_RFID_Reader/README.md](../firmware/ChildGuard_RFID_Reader/README.md)
- [firmware/ChildGuard_RFID_Reader/secrets.example.h](../firmware/ChildGuard_RFID_Reader/secrets.example.h)
- [web_front/README.md](../web_front/README.md)
- [web_front/src/components/ActivityDailyHistory.test.jsx](../web_front/src/components/ActivityDailyHistory.test.jsx)
- [web_front/src/components/ActivityHistoryIntegration.test.jsx](../web_front/src/components/ActivityHistoryIntegration.test.jsx)
- [web_front/src/components/Footer.jsx](../web_front/src/components/Footer.jsx)
- [web_front/src/data/mockData](../web_front/src/data/mockData)
- [web_front/src/lib/attendance-report.test.js](../web_front/src/lib/attendance-report.test.js)
- [web_front/src/pages/AttendanceOverview.test.jsx](../web_front/src/pages/AttendanceOverview.test.jsx)
- [web_front/vite.config.js](../web_front/vite.config.js)

## Initially selected files excluded after review

- `App/android/app/src/main/java/io/flutter/plugins/GeneratedPluginRegistrant.java`
- `App/ios/Runner/GeneratedPluginRegistrant.h`
- `App/ios/Runner/GeneratedPluginRegistrant.m`
- `web_front/public/icons.svg`
- `web_front/scripts/reference-preview.mjs`
- `web_front/src/assets/hero.png`
- `web_front/src/assets/icon.png`
- `web_front/src/assets/react.svg`
- `web_front/src/assets/vite.svg`

The full intended publication set, including newly authored files, is in [public-files.csv](public-files.csv). Directory exclusion policies are in [EXCLUDED_FILES.md](EXCLUDED_FILES.md). Exact source/public hashes and disposition are in [source-integrity.csv](source-integrity.csv). No `.git` repository or remote was created.
