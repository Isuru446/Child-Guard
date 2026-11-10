# Setup

Run these commands from the clean repository copy. Do not point setup tools at the original project. Dependency downloads require network access, but tests described here do not need an operational database.

## JavaScript packages

Use Node.js >=22.12.0 and npm. Both package lockfiles are retained unchanged.

```powershell
Set-Location backend
npm.cmd ci --ignore-scripts
Set-Location ../web_front
npm.cmd ci --ignore-scripts
Set-Location ..
```

Disabling install scripts avoids unexpected setup actions. Prisma Client generation is a separate step after schema review; validation instructions do not require connecting to PostgreSQL. Some package-native tools may need an explicitly reviewed rebuild if the local platform binding was not installed.

Copy `backend/.env.example` to `backend/.env` locally and replace placeholders privately only when preparing an approved isolated runtime. Current guards require `childguard_v2`, role `childguard_v2_app`, `127.0.0.1:5432`, schema `public`, and PostgreSQL 18. A test environment instead requires `childguard_v2_test` / `childguard_v2_test_app` and separate explicit test configuration. Do not reuse a live database or mix development and test URLs in one process.

Use a private high-entropy JWT secret. Set `RFID_UID_HMAC_KEY` privately before RFID enrollment; keep it stable for the associated database. `PRIVATE_MEDIA_DIR=./private-media` is relative to the backend working directory and remains ignored. Registration, attendance reset, activity preview and bus transport are disabled by default. The demo preview is restricted to a deliberately selected synthetic `Demo Child` record.

## Database prerequisite

Read [DATABASE.md](DATABASE.md) before generation, setup or migration execution. Do not run `npm run migrate`, `npm run setup`, deployment scripts or SQL repairs as part of source validation. The migration chain is incomplete relative to the historical ledger and runtime schema; it needs owner review in a disposable PostgreSQL 18 instance. Do not fabricate migration folders, edit applied SQL, reset history or copy a live dump to make setup appear complete.

After that separate reconciliation and authorization, generate the Prisma client from the reviewed schema, provision synthetic accounts and run the backend from its own directory with `npm.cmd start`. Startup verifies database identity and may intentionally refuse an incompatible environment. The historical PowerShell launch/deployment tools are not the recommended portable startup route.

## Web Admin

Copy `web_front/.env.example` to a local ignored `.env` and use a reviewed local API endpoint. Browser environment variables are public and must never contain credentials.

```powershell
Set-Location web_front
npm.cmd run dev -- --port 5174 --strictPort
```

The retained admin cookie proxy is configured for the localhost development origin. A different origin or production host requires a reviewed cookie/CORS/CSRF deployment configuration.

## Flutter Parent/Teacher app

Use a Flutter SDK compatible with Dart `^3.13.2` and the retained `pubspec.lock`. Install dependencies with `flutter pub get` inside `App`. Copy `config.example.json` to ignored `config.local.json`, replace the placeholder endpoint and use:

```powershell
flutter run --dart-define-from-file=config.local.json
```

An Android emulator can reach a host-local development API at `http://10.0.2.2:3100`; a physical phone needs an authorized reachable host. Configure Android SDK paths locally rather than committing `android/local.properties`. Platform signing credentials are intentionally absent. Native release builds require platform SDKs and separate signing setup.

## Firmware

See [HARDWARE.md](HARDWARE.md). Copy the relevant `secrets.example.h` to ignored `secrets.h` locally and fill placeholders without sharing values. Configure registered hardware identities and BLE roles in the appropriate sketch. Compile only after selecting the correct board, library versions and partition layout. Uploading is a separate manual, approved hardware operation.
