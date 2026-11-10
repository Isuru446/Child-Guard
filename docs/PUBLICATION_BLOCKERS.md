# Unresolved review items

The source copy is prepared for review. The items below distinguish approval to share source from proof that the complete system can be deployed.

| Item | Effect | Required next step |
| --- | --- | --- |
| Owner approval pending | No Git initialization, commit or upload is authorized yet | Review README, public manifest, exclusions, changes and security summary |
| License and asset provenance | No redistribution license is asserted | Confirm ownership, third-party image/logo rights and preferred license before public sharing |
| Geofence migration absent from canonical chain | Fresh database deployment is not reproducible | Reconcile authoritative history and reviewed SQL in a separately approved disposable environment |
| Tamper event constraint repair outside chain | Persisted tamper events may be rejected | Review the supplied narrow repair and design an accountable forward deployment path |
| Schema/client/ledger drift | Current models and historical client/hash tests represent different stages | Verify a complete forward schema and regenerate a current client without rewriting history |
| PostgreSQL compatibility | Guards demand PostgreSQL 18; legacy scripts mention other versions | Validate Prisma 6.12.0, SQL constraints/grants and runtime behavior on disposable PostgreSQL 18 |
| Original Windows deployment paths and frozen hashes | Historical tooling/tests cannot safely be relocated by search-and-replace | Retain as historical evidence; design and review a new portable deployment procedure separately |
| Excluded historical client snapshots/private stages | Some legacy source tests cannot run from the public copy | Replace artifact-dependent acceptance with a new reviewed reproducibility workflow; do not publish private backups |
| Two stale backend mock tests | Isolated backend checks are not entirely green | Update the attendance repository fixture and review the obsolete 27-writer inventory assertion; see VALIDATION.md |
| Flutter SDK write restriction | Flutter dependency resolution, analysis, tests and builds could not run here | Use a compatible SDK located in an authorized writable tool directory |
| Missing C++17 compiler and Arduino build validation | Native firmware state machines and complete linked sketches remain unverified | Run retained host tests with g++; compile every sketch with reviewed library versions without flashing |
| Firmware library versions incompletely pinned | Exact wearable build is not fully reproducible | Record tested ArduinoJson/TinyGPSPlus/MFRC522 versions and linked memory usage |
| Wearable HTTP and BLE spoofability | Prototype transport/location evidence is unsuitable for unattended production | Review authenticated secure transport, threat model and supervised hardware acceptance |

See [validation results](VALIDATION.md) for any isolated test failures. Publication of reviewed prototype source can be considered separately from resolving runtime deployment limitations, but the owner must approve the intended public contents first.
