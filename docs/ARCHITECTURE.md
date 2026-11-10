# Architecture and engineering decisions

The implementation separates radio observations, authenticated backend events and human workflow decisions. A Gate observation is evidence for attendance, while a teacher makes the confirmation. Parent reads are limited to linked children; teacher and administrator operations are restricted by role and center. Wearable events authenticate through a device token and resolve an assignment on the server.

## Embedded sensing and delivery

The wearable integrates I2C motion sensing, UART GPS, passive BLE scans and Wi-Fi requests. The activity modules preserve sensor coverage and validity alongside movement measurements. Invalid or missing samples must not become a fabricated low-activity observation. MAD summaries feed the backend's coverage-aware daily history and personalized baseline logic.

GPS uses a latest-only pending slot outside the workflow FIFO. Queue age, fix age, quality, boot identity and sequence help distinguish current evidence from delayed telemetry. Old positions do not accumulate as if they were live locations.

Gate and zone filters maintain hysteresis and confirmation readings. Danger eligibility requires the attendance workflow and valid departure/approach evidence. Fresh zone FAR evidence must precede NEAR; UNKNOWN is not a substitute for FAR. The backend checks ordering, freshness, center and assignment. Suppressed episodes remain latched until legitimate rearming, avoiding repeated alerts while continuously NEAR.

Safety transitions have delivery priority. Retries retain event IDs; acknowledgements must identify the corresponding event before removing it. The backend uses transactions and deduplication to prevent retries from creating duplicate incidents. GPS latest-only handling and bounded queues limit stale evidence during outages, but cannot guarantee delivery through an unlimited disconnection.

## Tamper monitoring

`TamperLoop.h` implements UNKNOWN/CLOSED/OPEN with a three-second startup delay and 800 ms stable input. `TamperRuntime.h` samples on an independent 20 ms FreeRTOS task. Network work stays outside that task. A separate Preferences namespace stores an epoch, sequence, episode and up to 24 pending transitions. Reboot backlog has explicit timing uncertainty; an NVS failure or full queue is reported rather than hidden.

The backend validates the device and assignment, applies fitting grace and deduplicates incident creation. Restoration updates status without deleting the opening incident. Current state expires rather than remaining indefinitely reassuring. The event-type SQL constraint still needs the retained separately reviewed repair; application support alone does not establish database readiness.

## RFID and transport

The RFID reader is a separate board. Its presentation guard suppresses repeated reads from a card held at the antenna. Reader credentials are distinct from wearable credentials. Backend HMAC handling avoids treating raw RFID UIDs as public identifiers. Card UID possession is not strong identity verification.

The bus prototype uses a distinct public BLE UUID and separate observation logic, leaving Gate and Danger Zone identities separate. It is disabled by default in the example configuration. Its bounded history and inferred presence are suitable for supervised experimentation, not proof of boarding, custody transfer or route compliance.

## Applications and persistence

Express modules expose authenticated APIs with validation and authorization. The current server integrates admin cookie sessions, CSRF handling and monitoring updates; Flutter uses its authenticated API session. PostgreSQL constraints and transactional writes enforce invariants that mocks cannot prove under real concurrency. Prisma schema, canonical migrations and additional SQL review artifacts are retained separately so the historical discrepancy is visible.

The clean copy keeps hash-pinned deployment policies unchanged. Changing their paths or refreshing their fingerprints would invalidate the original reviewed boundary. Portable source checks are adjusted only where they can resolve local files without activating deployment code. See [database limitations](DATABASE.md).

This summary extracts design information from the original firmware integration, danger-zone, tamper, bus, activity, authentication and application audit reports. Their raw execution transcripts are excluded. Historical success claims are not substituted for validation of this copy.
