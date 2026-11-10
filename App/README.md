# ChildGuard Parent/Teacher app

Flutter source provides authenticated Parent and Teacher workflows for linked children, attendance, recorded location, activity history, alerts, account management and pickup. Foreground updates use the backend and polling fallback. Background push and automatic emergency dispatch remain unavailable; the SOS action opens the native dialer.

Use a Flutter SDK satisfying Dart `^3.13.2`, then run `flutter pub get`, `flutter analyze` and `flutter test` in this directory. Copy `config.example.json` to ignored `config.local.json`, replace its endpoint and launch with `flutter run --dart-define-from-file=config.local.json`. Do not embed credentials in dart defines.

Platform projects and the dependency lockfile are retained. Generate Android SDK paths locally; signing keys are excluded. Database-backed features require the reviewed backend schema and authorization setup. See [setup](../docs/SETUP.md), [database limitations](../docs/DATABASE.md), [testing](../docs/TESTING.md) and [validation](../docs/VALIDATION.md).
