# Excluded files and retained support

Only the reviewed project source is selected for publication. [excluded-files.json](excluded-files.json) records each decision for the individually inventoried source files. Excluded directory policies below apply to entire subtrees; a directory entry is not a claim that its contents were inspected.

| Original path/category | Decision and reason |
| --- | --- |
| `private-backups/` | Excluded without inspection or traversal, as instructed |
| `backups/`, root database dump, `*.dump`, `*.backup` | Excluded database recovery material; no row data copied |
| Real `.env`, `secrets.h`, `*.private.*`, private firmware overrides, signing material | Excluded before copying; values not printed or rotated |
| Private media, registration integration media, supervisor demo media | Excluded personal photos and temporary test storage |
| `node_modules/`, root package runtime, `.npm-cache/`, `.local-tools/`, `.pub-cache/` | Excluded original dependencies, cached toolchains and machine-local client review artifacts |
| Hidden migration-stage directories | Excluded duplicate generated migration stages; canonical schema, migrations and reviewed SQL retained |
| Flutter/Android/iOS caches, local SDK files, ephemeral plugins, build and distribution output | Excluded machine paths and regenerable artifacts; portable platform source and Gradle wrapper retained |
| `reference_ui/` | Excluded duplicated earlier frontend; current Web Admin retained |
| `web_front/scripts/reference-preview.mjs` | Excluded unused design-reference builder because it requires the excluded duplicate UI |
| Unused frontend template artwork and SVG sprite | Excluded after checking current source, test, script and HTML references; required logo/favicon retained |
| `database_study/` | Excluded generated database book, catalog exports, images, PDF rendering and execution evidence |
| Root implementation/audit reports, temporary backend/web/firmware reports, most `V2_Planning` reports | Engineering decisions summarized in architecture, hardware, database and security documentation; raw transcripts excluded |
| `test_documents/`, root test workbook | Excluded generated spreadsheet test-case exports and workbook generators; executable application/firmware tests and their actual fixtures retained |
| Benchmarks, log/status files, debug output, temporary test artifacts | Excluded results tied to a prior execution; current validation summarized separately |
| Unrelated bus firmware PDF attachment | Excluded non-build study attachment |
| `.git`, agent/editor/cloud account configuration | Excluded metadata and machine configuration; no Git repository initialized |

## Files deliberately retained

All wearable support headers, Gate/Danger Zone, bus and RFID sketches, backend source, Prisma migration SQL, frontend assets, Flutter platform projects, lockfiles and executable tests are retained. PowerShell deployment modules, review SQL and schema-only pickup catalog/ledger evidence remain because source tests and deployment guards depend on them. Their presence does not authorize execution.

`V2_Planning/WP00E_MIGRATION_READINESS.md` is a new curated fingerprint table supporting a regression test. The original report is excluded. The admin-session cutover patch is retained because an existing source check inspects the historical patch. Historical machine-specific artifacts that cannot be safely reproduced are documented as unresolved test dependencies instead of being silently substituted.

The `.validation/` directory holds only local preparation tools, test logs and dependency-download cache created for this review. Dependency directories and generated build output are also ignored. They are outside the public manifest and must not be uploaded. The public manifest enumerates the intended publication contents; it is not a blind recursive folder export.
