> Curated source reference. Historical notes may describe earlier API states; current route validation is authoritative. See [database prerequisites](../docs/DATABASE.md).

# Phase 5 registration / management API additions

## Readable center selection

`GET /api/v1/registration/centers` is a public, read-only endpoint returning
`{data:[{id,name}]}` from PostgreSQL. It is registration-gated, rate-limited and
uses `Cache-Control: no-store`. Only real centers in the startup configuration
`PUBLIC_REGISTRATION_CENTER_IDS` (comma-separated UUIDs) are listed. The default
is empty, so existing private centers are not disclosed automatically.

New registrations submit `centerId` (UUID) instead of `centerCode`. The backend
requires that the ID is allowlisted and exists. Legacy `centerCode` submissions
remain supported with the existing expiry/hash checks; submit exactly one of
these fields, never both. Client-supplied center names are rejected. Rejected
applications may resubmit only to their original center. No schema change is
required. Pending status and all center-scoped Admin/Guardian/device reviews
remain unchanged. See `../docs/ARCHITECTURE.md` for policy,
verification and configuration commands.

ENABLE_REGISTRATION defaults false until both additive migrations are approved and applied. New application/media/profile/workflow routes return 503 while disabled. Existing auth/mobile/IoT/attendance/provisioning contracts remain compatible. Admin overview/basic management reads support the original schema.

Public JSON: {fullName,username,email,phone,password,role:PARENT|TEACHER,centerId,acceptTerms:true,children:[{existingChildId?,fullName?,dateOfBirth?,groupName?,relationship,wearable?:{hardwareId,claimCode}}]}. Legacy clients may use centerCode instead of centerId. Existing reference OR new name/date is required; Teachers have no children. Header X-Registration-Receipt is a client-generated 64-hex credential stored securely, used for submission/status/resubmission/photo. No active JWT is issued. Photo PUT is raw image bytes with image/jpeg|image/png|image/webp, at most 2 MB.

Admin decision: {status:APPROVED|REJECTED,reason?}; rejection requires reason. Enrollment approval may specify approved existingChildId for duplicate resolution. Center invitation/device claim-code POST takes {} and returns the private code once. Transfer: {expectedAssignmentId,childId,transferAcknowledged:true}; status PATCH {active}; role PATCH {role:PARENT|TEACHER,roleChangeAcknowledged:true}. Profile PATCH {fullName,email,phone,emergencyContacts:[{name,phone,relationship}]}; password POST {currentPassword,newPassword}. Private APIs use normal Bearer JWT. Center/actor derive from active server identity, never mass-assigned payload.

All JSON uses data envelopes and omits password/receipt/claim hashes and storage paths. Private image GET returns bytes with no-store/nosniff/CSP. See ../docs/ARCHITECTURE.md for state transitions, validation, exact commands, deployment gate and remaining limitations.

| Method | Route | Source |
|---|---|---|
| POST | `/api/v1/registration` | backend/src/registration.js:45 |
| GET | `/api/v1/registration/status` | backend/src/registration.js:61 |
| POST | `/api/v1/registration/resubmit` | backend/src/registration.js:62 |
| POST | `/api/v1/admin/center-invitations` | backend/src/registration.js:88 |
| GET | `/api/v1/admin/registrations` | backend/src/registration.js:94 |
| GET | `/api/v1/admin/registrations/:id` | backend/src/registration.js:99 |
| POST | `/api/v1/admin/registrations/:id/decision` | backend/src/registration.js:103 |
| GET | `/api/v1/admin/enrollments` | backend/src/registration.js:123 |
| POST | `/api/v1/admin/enrollments/:id/decision` | backend/src/registration.js:129 |
| POST | `/api/v1/admin/devices/:id/claim-code` | backend/src/registration.js:153 |
| GET | `/api/v1/admin/wearable-requests` | backend/src/registration.js:163 |
| POST | `/api/v1/admin/wearable-requests/:id/decision` | backend/src/registration.js:169 |
| GET | `/api/v1/account/profile` | backend/src/registration.js:193 |
| PATCH | `/api/v1/account/profile` | backend/src/registration.js:196 |
| POST | `/api/v1/account/password` | backend/src/registration.js:200 |
| GET | `/api/v1/account/requests` | backend/src/registration.js:207 |
| POST | `/api/v1/account/children` | backend/src/registration.js:211 |
| POST | `/api/v1/account/wearables` | backend/src/registration.js:218 |
| GET | `/api/v1/admin/management` | backend/src/registration.js:226 |
| PATCH | `/api/v1/admin/users/:id/status` | backend/src/registration.js:233 |
| PATCH | `/api/v1/admin/users/:id/role` | backend/src/registration.js:238 |
| PATCH | `/api/v1/admin/children/:id` | backend/src/registration.js:246 |
| POST | `/api/v1/admin/devices/:id/transfer` | backend/src/registration.js:251 |
| PUT | `/api/v1/registration/photo` | backend/src/registration-photos.js:68 |
| GET | `/api/v1/registration/photo` | backend/src/registration-photos.js:69 |
| PUT | `/api/v1/account/photo` | backend/src/registration-photos.js:73 |
| GET | `/api/v1/account/photos/:id` | backend/src/registration-photos.js:74 |
| GET | `/api/v1/admin/overview` | backend/src/accounts.js:22 |
| GET | `/api/v1/admin/users` | backend/src/accounts.js:38 |
| POST | `/api/v1/admin/users` | backend/src/accounts.js:43 |
| POST | `/api/v1/admin/users/:id/guardians` | backend/src/accounts.js:64 |

---

## Prior API documentation

# Account administration addition — 2026-10-23

Existing mobile, attendance and device contracts below are unchanged. This addition uses the existing User/Guardian/AuditLog schema, with no migration. All routes require Bearer JWT, active database identity and ADMIN role; server derives centerId from that identity, never from request body. Mutation rate limit is 10/minute per Admin.

| Method/path | Request | Response |
|---|---|---|
| GET /api/v1/admin/users | limit(default25,max100),offset(default0,max100000),role? PARENT/TEACHER | data:[{id,username,role,centerId,active}],page:{limit,offset}; own-center Parent/Teacher only |
| POST /api/v1/admin/users | Strict JSON {username,password,role,childIds?} | 201 data:{id,username,role,centerId,active,childIds}; no credentials/hashes |
| POST /api/v1/admin/users/:id/guardians | Strict JSON {childIds:[UUID,...]} | 200 data:{userId,childIds,linked}; retry of existing links returns linked:0 without duplicate audit |

Creation username is trimmed, 3..100 characters using letters/digits/._@+-; uniqueness is case-sensitive like existing login/database. Password >=12 characters and <=72 UTF-8 bytes; bcrypt cost 12. Role only PARENT or TEACHER. Parent requires >=1 approved existing same-center child; Teacher forbids childIds because membership is User.centerId. Child lists have 1..100 unique UUIDs where required. centerId, passwordHash, active, ADMIN/TRANSPORT and unknown properties are rejected. Guardian addition accepts only an existing active same-center Parent and same-center children. No self-service linking, role promotion, user deletion or password override endpoint exists.

Every creation/link operation uses a Serializable Prisma transaction and required audit records. Missing/outside children/Parent use generic 404 NOT_FOUND; unavailable username 409 USERNAME_EXISTS; validation 422 VALIDATION_ERROR; non-Admin 403 FORBIDDEN; no JWT 401 UNAUTHENTICATED; rate limit 429 RATE_LIMITED. Audit actor is the authenticated Admin; actions ACCOUNT_PROVISIONED_PARENT/TEACHER and GUARDIAN_LINK_CREATED:<new-parent-id> contain no password or hash. Existing Guardian link is idempotent. Hashes and credentials never returned.

These are data-access Guardian links, not pickup/release grants. No live account request was performed in the implementing session. See ../docs/ARCHITECTURE.md for approved provisioning workflow, test evidence and exact commands.

---

# Phase 1 API contract

JSON success `{ "data": ... }`, errors `{ "error": { "code": "...", "message": "..." } }`. Gate state is an intentional top-level firmware exception. Timestamps ISO-8601 UTC; attendance day YYYY-MM-DD in Asia/Colombo. Missing sensor properties stay absent, missing records null. No battery telemetry: batteryPercent null. Internal UUIDs are different from hardwareId. API never returns token hashes/password hashes.

| Method/path | Authorization | Response |
|---|---|---|
| GET /api/health | none | data.status ok after database probe; otherwise 503 |
| POST /api/events | X-Device-Token | 201 stored / 200 exact duplicate; data.eventId, duplicate |
| GET /api/gate/state?deviceId=…&gateId=… | X-Device-Token | attendanceStatus, gatePassAuthorized, attendanceDay |
| POST /api/v1/auth/login | username/password JSON | data.token, user, expiresIn (3600 seconds) |
| GET /api/v1/auth/me | Bearer JWT | data.id, username, role, centerId |
| GET /api/v1/devices?limit=25&offset=0 | admin/teacher | data array, page |
| GET /api/v1/devices/:id | admin/teacher | data device status |
| GET /api/v1/events?deviceId=internalUUID&limit=25&offset=0 | admin/teacher | data events, page |
| GET /api/v1/attendance | admin/teacher | today's paginated attendance rows, arrival details and confirmations |
| POST /api/v1/attendance/:id/confirm | admin/teacher | empty JSON body; data updated attendance |

All records restricted to current user's center. Teachers have center-wide permission in Phase 1; do not provision teachers needing narrower class access until class policy exists. Parent/transport roles denied monitoring access. Attendance listing capped at 100 for this milestone. Device/event pagination uses offset, maximum limit 100. Devices ordered by hardware ID, events newest receipt first. Concurrent inserts can shift offset history; cursor pagination planned.

Device status: id, hardwareId, active, lastSeen, connectionState (ONLINE <=60s, STALE <=300s, OFFLINE otherwise/never), batteryPercent:null, latestEvent, gps, ble, mpu6050. Observation objects include receivedAt and original payload; age must be considered, and these do not prove hardware sensor health. gps is latest event reporting gpsStatus; coordinate omission must never be filled from an older fix. BLE/MPU objects are latest observations of those types, including signal-loss/sample-gap diagnostics. MPU values are observations, not medical conclusions.

Event fields and conditional validation are documented in ../docs/ARCHITECTURE.md and src/events.js. No device wall-clock timestamp exists. deviceUptimeMs is uint32 millis and may wrap. Event rows retain child association at receipt; unassigned devices can submit events but cannot create attendance. gateId must be a registered GATE in the same center. Every new event updates lastSeen; exact duplicates don't replay side effects or refresh it. Token verification is constant-time against SHA-256 hashes; unknown/revoked/wrong credentials all return DEVICE_UNAUTHORIZED 401. Device token must be high entropy. Duplicate conflicting content is 409. Validation 422; malformed JSON 400; invalid transitions 409; forbidden role 403; missing/out-of-center resources 404; database failures 503. Login limited to 10 attempts/minute per IP. Gate responses support all four firmware statuses; checkout and gate-pass write APIs are deferred and defaults remain false.

Confirmation preserves BLE observation(s), adds Confirmation with user/time and AuditLog. It accepts today's CHECKIN_PENDING, with idempotent retries for an already confirmed PRESENT record, and never treats proximity as attendance proof. No route confirms by device token.

## Planned mobile contracts (not implemented)

/api/v1/children, /children/:id/attendance, /children/:id/location, /children/:id/alerts require Guardian(userId,childId) for parents on every read. Teacher class memberships constrain children/events/attendance. /transport/trips, /trips/:id/boarding require center plus assigned transport staff. SafeZone/Geofence versioned geometries attach to center and alerts; Trip/Route/Stop/Boarding reference child, assigned staff and audited confirmations. Future push subscriptions and Socket.IO must reuse these policies and deliver only after commit. No Phase 2 realtime or Flutter code implemented.

## Phase 2 BLE telemetry

`POST /api/events` additionally accepts `eventType: "BLE_PROXIMITY"` with existing device-token authentication, deviceId/gateId hardware identifiers, unique eventId, gpsStatus and uint32 deviceUptimeMs. Required BLE fields: `proximity` (`NEAR`, `FAR`, `UNKNOWN`) and uint32 `queueAgeMs` (elapsed milliseconds from sampling to this HTTP attempt). NEAR/FAR require finite rssi in [-127,0]; UNKNOWN must omit rssi. Other event types reject BLE-specific fields. Gates must be registered GATE beacons in the device center. Example (identifiers must match registration):

```json
{"eventId":"unique-boot-sequence-001","eventType":"BLE_PROXIMITY","deviceId":"CG-WEARABLE-001","gateId":"CG-GATE-01","gpsStatus":"GPS_NO_FIX","deviceUptimeMs":12345,"queueAgeMs":0,"proximity":"NEAR","rssi":-52.5}
```

BLE telemetry has no attendance/alert side effects. Rows persist in DeviceEvent; the attendance-specific Observation table is unchanged. Duplicate event IDs retain existing 200/409 behavior, except queueAgeMs may increase on retry without causing conflict. Duplicates never refresh state or lastSeen.

Device list/detail responses add `bleState`: gateId, proximity, rssi (nullable), observedAt, receivedAt, stale, staleAfterMs (45000). observedAt is server receipt minus queueAgeMs, an estimate without synchronized device clock; receivedAt is authoritative receipt time. Missing telemetry yields UNKNOWN, null timestamps/RSSI and stale:true. Historical proximity remains available in the API when stale; clients must render it as stale/UNKNOWN. Existing `ble` history remains compatible. Latest BLE uses receipt ordering, matching the firmware's single coalesced pending slot. Separate device communication thresholds remain 60/300 seconds. The associated gate is the latest reporting registered gate; there is no persistent per-device gate assignment in Phase 1.

Deploy migration `202610210001_ble_proximity` before flashing firmware. It expands the SQL event allowlist and adds a latest-event index; no new table or Prisma field is needed. Observation history grows continuously: use a deployment-specific retention policy before long-term operation.


## Admin approval and gate danger workflow

ADMIN and TEACHER already have center-wide confirmation permission; this change preserves that policy. No new privilege or temporary production bypass was added. Parents, transport users and device tokens cannot confirm. Confirmation audits now use `ATTENDANCE_CONFIRMED_ADMIN` or `ATTENDANCE_CONFIRMED_TEACHER` as an immutable snapshot of the real confirming role. Confirmation still stores the actual user ID and database timestamp. Old audits are preserved and their historical role is returned as null rather than inferred from a user's current role. No database migration is needed.

- `GET /api/v1/attendance?status=CHECKIN_PENDING&limit=100&offset=0`: optional status filter and existing offset conventions; defaults to today's first 100 rows. Adds child `{id,name}`, first arrival observation with device/beacon hardware IDs, `canConfirm`, and confirmations with safe user fields and `roleAtConfirmation`. Top-level `day` identifies the server's Colombo attendance day. Only the earliest arrival is included in this listing; all DeviceEvent history remains stored.
- `GET /api/v1/attendance/pending-count`: `{data:{count,day}}`, exact current-day, center-scoped pending count.
- `POST /api/v1/attendance/:id/confirm`: empty object, as before. First approval atomically writes confirmation, audit and PRESENT; repeat/concurrent requests return the existing PRESENT without replacing the original confirmer or adding audits. Wrong-day, CHECKED_OUT and other invalid transitions return 409. Missing/out-of-center remains 404. The gate-state response stays unchanged: attendanceStatus, gatePassAuthorized, attendanceDay.
- `GET /api/v1/alerts?limit=100&offset=0`: center-scoped persisted Alert rows with safe child/device/beacon details and their DeviceEvent. `status: RECORDED` describes storage, not acknowledgement/resolution; those workflows are not implemented.

CHILD_NEAR_GATE can create CHECKIN_PENDING only for no current-day attendance or NOT_CHECKED_IN; repeated candidates attach to the same pending attendance. PRESENT/CHECKED_OUT cannot be reopened by BLE. A new day has its own attendance row. BLE_PROXIMITY has no attendance/alert side effects.

DANGER_ZONE_NEAR now requires RSSI. DANGER_ZONE_NEAR/EXIT may include uint32 queueAgeMs to account for delayed transmission; proximity remains exclusive to BLE_PROXIMITY. Server accepts and stores valid workflow telemetry but creates a DANGER_ZONE_NEAR Alert only for currently confirmed PRESENT, no authorized gate pass, and persisted fresh FAR sampled after confirmation. FAR/queued approach must be at most 45 seconds old; UNKNOWN or signal loss after FAR invalidates arming. A previous alert since that FAR suppresses another alert for the same approach; a new FAR permits rearming. Device uptime going backwards relative to FAR is rejected as arming evidence (conservatively including millis wrap). New danger results include alertCreated and suppressionReason; exact duplicate acknowledgements retain the original generic duplicate contract. BEACON_SIGNAL_LOST remains a diagnostic alert, visually separate from gate danger. Normal proximity never creates alerts. Firmware reserves a bounded priority FAR slot so rapid later NEAR cannot erase the backend arming evidence before delivery.

Additional beacons are not implemented: the wearable currently matches one configured gate UUID and the ingest endpoint accepts same-center GATE beacons. Other danger beacon kinds, concurrent beacon tracking and per-beacon arming require future work. No beacon hardware changes mode or sends HTTP.

### Development attendance reset

`POST /api/v1/attendance/:id/reset` requires a JWT for an active ADMIN in the child's center, `ENABLE_DEV_ATTENDANCE_RESET=true`, and `NODE_ENV=development` or `test`. All other environments reject it with `403 DEV_RESET_DISABLED`. Body: `{ "confirmedAt": "<exact latest confirmation ISO timestamp>" }`. Success returns the existing daily attendance row with NOT_CHECKED_IN and gatePassAuthorized=false. Exact retries before another arrival are safe; stale confirmation timestamps and ineligible states return `409 INVALID_TRANSITION`. Wrong-center records return 404. No rows or historical events are deleted.

The existing AuditLog stores `ATTENDANCE_DEV_RESET` with the actual resetting admin and database time, and `ATTENDANCE_CONFIRMATION_SNAPSHOT:<JSON>` with the previous confirming user, confirmation ID and timestamp. The unique Confirmation row remains until the next approval updates it; its earlier value remains in the snapshot and original confirmation audit. Attendance GET adds `canReset`, `attendanceEpoch`, `resetHistory`, `confirmationHistory` and, after reset, `originalArrival`. Its `observations` describe the current reset cycle. Latest recorded confirmation is not an active approval when status is NOT_CHECKED_IN or CHECKIN_PENDING. Auth/me also reports `devAttendanceResetEnabled`.

After a reset, gate/state includes `attendanceEpoch` (the latest durable reset audit ID). Updated firmware includes it in BLE and workflow events. Arrivals need that epoch and fresh, same-device/gate post-reset FAR evidence (maximum 45 seconds, no subsequent UNKNOWN/loss). Old cycles return `409 ATTENDANCE_CYCLE_CHANGED`; missing valid FAR returns `409 NEW_ARRIVAL_REQUIRED`. Exact event retries remain idempotent without recreating attendance. Confirm POST accepts optional `attendanceEpoch`; it is required to match after a reset, preventing old approval retries from confirming a new cycle. Old-cycle danger events are stored without creating alerts. First-arrival clients without any reset retain their existing contract.

Devices `bleState.gateId` comes from the event's registered Beacon relation; `beaconType` identifies the current gate's attendance and danger purpose. No mock beacon registry or multi-beacon support is introduced.

## Phase 3 — Registered BLE beacons

Apply `202610220001_multi_beacon` before deploying this backend. It extends the existing Beacon row; no event, attendance or audit IDs change. The primary CG-GATE-01 UUID is backfilled without inventing a location/name. Other legacy rows without an identity require review before device configuration is valid.

JWT ADMIN/TEACHER read APIs (always center-scoped):

- `GET /api/v1/beacons?limit=25&offset=0`: stored registry plus latest actual observation, registration status, timestamps and registering/updating user IDs. Active is configuration status, not radio ONLINE.
- `GET /api/v1/beacons/:id`: registry details and latest current-identity observation. Route `:id` is the internal database ID; hardwareId is the physical registration ID.
- `GET /api/v1/beacons/:id/events?eventType=DANGER_ZONE_NEAR&limit=25&offset=0`: retained history. eventType is optional.

JWT ADMIN write APIs:

- `POST /api/v1/beacons`: register an additional DANGER_ZONE. Center is taken from the authenticated user; client centerId is rejected. Hardware ID and case-normalized UUID must be globally unique. Only the existing primary gate is supported.
- `PATCH /api/v1/beacons/:id`: submit the editable configuration fields below (hardwareId/kind/center cannot change). `active:false` deactivates without deleting history. Gate deactivation and UUID replacement are rejected. A danger beacon UUID change requires `identityChangeAcknowledged:true` because physical reflashing is necessary. There is no DELETE operation.

Registration example (example only; never automatically seeded):

```json
{
  "hardwareId": "CG-DZ-01",
  "kind": "DANGER_ZONE",
  "name": "Pool boundary beacon",
  "location": "Pool entrance",
  "description": "Physical beacon at the pool boundary",
  "serviceUuid": "7b700002-24a6-4a25-9d3b-21c547a10001",
  "entryRssi": -63,
  "exitRssi": -69,
  "attendanceRssi": null,
  "active": true
}
```

PATCH supplies name, location, description, serviceUuid, entryRssi, exitRssi, attendanceRssi and active; it is a full editable-configuration update. RSSI is finite, within [-127,0], and exit must be at least 3 dBm below entry. Attendance threshold is null for danger-only beacons; on the gate it is required and at least the entry threshold. Hardware IDs are case-sensitive, 1–48 ASCII letters/digits/underscore/hyphen. UUID input is normalized lowercase. Names/locations are required, bounded strings. AuditLog records actual admin registration/update activity.

Errors include `409 BEACON_CONFLICT`, `409 GATE_PROTECTED`, `409 PROVISIONING_ACK_REQUIRED`, `409 CONFIG_TOO_LARGE`, `422 INVALID_THRESHOLDS`, `422 VALIDATION_ERROR`, 401/403 authorization errors and 404 for another center's row.

### Wearable configuration

`GET /api/device/beacons?deviceId=CG-WEARABLE-001` uses X-Device-Token, not JWT. It returns `{data:{revision,maxBeacons:8,refreshAfterMs:60000,validForMs:300000,beacons:[...]}}`. Each beacon contains beaconId (hardwareId), serviceUuid, kind, entryRssi, exitRssi and attendanceRssi. Only active rows in the device's center are returned. Revision is SHA-256 of the ordered operational configuration, not a security token. Missing/unsupported identities or a missing/conflicting primary gate fail with CONFIG_INVALID; an oversized list fails entirely with CONFIG_TOO_LARGE, never silent truncation. Administrative metadata edits that do not change monitoring settings need no firmware-state change.

### Compatible events and bounded batches

Legacy `gateId` events remain accepted, including attendance and gate danger. New danger-beacon events require both `beaconId` (registered hardware ID) and `beaconUuid` (registered service UUID). If gateId is also provided, it must equal beaconId. No identity may be omitted or implicitly mapped to the gate. UUID must match the current registration. Inactive, unknown, foreign-center or mismatched registrations are rejected before creating new events. Exact retries of already stored events still return duplicate without operational changes.

```json
{
  "eventId": "wearable-zone-unique-event",
  "deviceId": "CG-WEARABLE-001",
  "beaconId": "CG-DZ-01",
  "beaconUuid": "7b700002-24a6-4a25-9d3b-21c547a10001",
  "eventType": "BLE_PROXIMITY",
  "proximity": "NEAR",
  "rssi": -52.5,
  "gpsStatus": "GPS_NO_FIX",
  "deviceUptimeMs": 120000,
  "queueAgeMs": 100
}
```

UNKNOWN omits RSSI. Known proximity requires RSSI. DANGER_ZONE_NEAR has RSSI and queueAgeMs and omits proximity. After a development reset include the current attendanceEpoch as before. Non-gate beacons cannot submit CHILD_NEAR_GATE or sensor/gate-only events. BLE_PROXIMITY itself never creates attendance or danger alerts.

`POST /api/events/batch`, authenticated with the same X-Device-Token, accepts `{deviceId,events:[<complete explicit-beacon events>]}` (1–16 events; 32 KB body maximum). It is intended for independent zone BLE/danger telemetry; attendance stays on the existing route. All entries must name the authenticated device. Envelope/schema failures return 422. Valid envelopes return HTTP 200 and a data array of `{eventId,status,...ingestResult}` or `{eventId,status,error}`. Entries execute sequentially with independent serializable transactions: preceding NEAR telemetry can validate a following danger event, one inactive beacon does not block unrelated entries, and an interrupted response is safely retried by event ID. A transient server failure can leave earlier entries committed; exact retries are mandatory. Single-event and batch routes share a 240-request/minute authenticated-device limit (429).

DeviceEvent.observedAt is database receipt time minus queueAgeMs, backfilled for history. Current proximity queries order by observation time rather than receipt time, so delayed telemetry stays historical. New identified events snapshot registered beacon name/location/type in server-generated `payload.beaconMetadata`; clients cannot submit this field. Alert responses prefer that snapshot when present; older events retain their existing registry association. Raw payload/observation history remains available.

### Independent danger policy and views

A DANGER_ZONE event needs current PRESENT attendance/confirmation, the current reset epoch where applicable, a fresh identified NEAR observation, RSSI satisfying entry and event time after confirmation. Older-session uptime or stale queued events are suppressed. Already-NEAR at eligibility is evaluated; no gate-specific FAR is needed for the first alert. After an alert, that same beacon needs a new confirmed FAR before another approach alert. UNKNOWN/loss alone does not rearm. Ordinary gate-pass authorization applies only to the gate, not unrelated danger zones. Suppressed valid events remain diagnostic history with alertCreated=false and suppressionReason. Gate danger guards remain unchanged.

Devices responses retain the legacy gate-only bleState and add `beaconStates[]` for active registrations with actual ID/name/location/type, proximity, reportedProximity, RSSI, observedAt, receivedAt and freshness. Unobserved/stale/inactive-device proximity is UNKNOWN. A UUID reprovisioning does not display an old UUID's reading as current. Alerts remain center-scoped and include actual beacon metadata. No external notification service or GPS safe-zone monitoring was added.

## Phase 5 — Personalized movement monitoring

Apply `202610230001_personal_activity` before deploying the updated backend/client. All activity routes use the existing JWT/ADMIN-or-TEACHER center authorization. Policy writes require ADMIN. Existing gate/BLE contracts remain valid; the database event-type allowlist is extended to include ACTIVITY_SUMMARY.

### Device activity summary

POST `/api/events` with the existing X-Device-Token. An ACTIVITY_SUMMARY is independent sensor telemetry: it has **no gateId, beaconId, childId, centerId or GPS dependency**. Server assignment history determines the child/center for the entire measurement minute.

```json
{
  "eventId": "CG-WEARABLE-001-mad-bootnonce-1",
  "eventType": "ACTIVITY_SUMMARY",
  "deviceId": "CG-WEARABLE-001",
  "sessionId": "bootnonce",
  "sequence": 1,
  "measurementVersion": "MAD_G_V1_25HZ_5S",
  "movementIntensity": 0.012,
  "windowDurationSeconds": 60,
  "validSampleCount": 1450,
  "expectedSampleCount": 1500,
  "validDurationSeconds": 58,
  "sensorStatus": "OK",
  "deviceUptimeMs": 600000,
  "queueAgeMs": 1200
}
```

movementIntensity is duration/sample-weighted mean five-second acceleration-magnitude MAD, in **g**. The UI score is exactly g × 1000, in mg MAD, not a 0–100 classification. Only MAD_G_V1_25HZ_5S is accepted. This version fixes 25 Hz, 5-second calculation windows, 60-second summaries and 1500 expected samples. Each five-second window needs 80% samples; minute validSampleCount counts samples from accepted windows only. validDurationSeconds must agree with validSampleCount/25 within 0.05 s. OK requires >=95% coverage; PARTIAL can contain usable data; UNAVAILABLE requires zero valid samples/duration and movementIntensity:null. A genuine zero MAD with valid samples is allowed and is not a sensor failure. Scores must be finite, nonnegative and <=4 g; uptime, sequence and queue age are bounded integers. Summaries older than 24 hours or mapped more than five seconds into the future are rejected.

Uptime is the measurement **end**, not transmission time. queueAgeMs is elapsed time since that end, refreshed on retries. On the first summary for a device/sessionId the server anchors end time to database time minus queue age. Following summaries reuse this persisted anchor plus uptime differences, giving stable order/non-overlapping times across retries, backend restart and delayed delivery without requiring GPS/NTP. Exact event retries ignore only queueAgeMs and return duplicate. A different eventId with the same device/session/sequence returns 409 ACTIVITY_SEQUENCE_CONFLICT. Overlapping measurements for the same child/version return 409 ACTIVITY_OVERLAP, rather than double-counting coverage. A minute spanning an assignment change returns 409 NO_ACTIVITY_ASSIGNMENT. An old assignment can receive its own delayed data; it cannot be relabelled as the currently assigned child.

Successful new events return 201 `{data:{eventId,duplicate:false,eligible,alertCreated}}`; exact retries return 200 duplicate. Activity data outside confirmed attendance is retained with eligible=false but does not enter attendance aggregates/baselines. Activity does not create attendance or gate-danger events. Reset closes an activity attendance session without deleting measurements/aggregates. Sessions are created on confirmation and backfilled for existing PRESENT records by the migration. Historical eligible data remains immutable. Reapproval starts another session; partial session boundaries cannot masquerade as a full comparison interval.

The existing POST `/api/events/batch` also accepts same-device ACTIVITY_SUMMARY entries (1–16 complete events overall, <=32 KB). The wearable sends at most five activity summaries per request. Entries remain individually transactional/idempotent. Activity evaluation is deferred until the final activity entry, so earlier minutes do not alert before a newest unavailable-sensor entry is committed. An interrupted response is retried by the same IDs. Suppressed/dropped stale periods are never replaced with zero scores. Existing per-device request limits apply.

### Activity views

| Endpoint | Response / bounds |
|---|---|
| GET /api/v1/activity/children?limit=25&offset=0 | Up to 25 center children with monitoring views; refreshes are read-only |
| GET /api/v1/activity/children/:id | Single authorized child: current comparison, baseline, interval chart and daily history |
| GET /api/v1/activity/children/:id/summaries?days=1&limit=25&offset=0 | Raw minute summary history, days 1–7, limit 1–100 |
| GET /api/v1/activity/settings | Authorized center's policy, including safe disabled defaults |
| PATCH /api/v1/activity/settings | ADMIN-only full validated policy; actual user's change is audited |

Child views include child{id,name}, wearableId, day, measurementVersion, state/reason, currentScoreMg, baselineScoreMg, reductionPercent, coveragePercent, sensorStatus, lastSummaryAt (measurement end), lastReceivedAt (receipt of latest observed summary), baselineAvailable, baselineDayCount, baselineDays[{day,scoreMg}], period{day,startMinute,endMinute,startAt,endAt}, todayIntervals, history and persisted alert details/status. Missing scores/baselines are null, never fabricated zeros. Raw daily means and valid/observed minutes are explicitly partial observed attendance data; alert comparisons use equivalent clock-time intervals, not daily totals.

States: NORMAL, LOW_ACTIVITY, BASELINE_LEARNING, INSUFFICIENT_DATA, SENSOR_UNAVAILABLE and NOT_MONITORING. No summary, unavailable samples or data older than ten minutes yields an unavailable/stale data state, not NORMAL. Outside configured attendance/hours/quiet exclusions yields NOT_MONITORING. Today's incomplete intervals can be shown in history but cannot qualify for alert comparison.

### Center monitoring policy

The default is disabled until actual hours/quiet periods are configured. A full PATCH body is:

```json
{
  "enabled": false,
  "timezone": "Asia/Colombo",
  "startMinute": 480,
  "endMinute": 1020,
  "weekdays": [1, 2, 3, 4, 5],
  "quietPeriods": [{"startMinute": 720, "endMinute": 780}],
  "baselineDays": 7,
  "minBaselineDays": 5,
  "reductionPercent": 40,
  "sustainedMinutes": 60,
  "minCoveragePercent": 80,
  "minimumBaselineMADg": 0.005,
  "maxInitialAlertsPerDay": 1,
  "followUpMinutes": null
}
```

The quiet period above is an example, not a claimed daycare schedule; default quietPeriods is empty and monitoring remains disabled. Minutes are center-local minutes after midnight, weekdays 0=Sunday through 6=Saturday. End can be 1440. Overnight windows are not supported. Timezone must be a valid IANA name. baselineDays is 5–14, minBaselineDays 5–baselineDays, reductionPercent 10–90, sustainedMinutes 30–240 in multiples of 30, coverage 50–100%, and minimum baseline 0.001–1 g. Defaults are engineering thresholds to calibrate, not clinical limits. Initial alerts have a hard one-per-child/local-day/version uniqueness cap. Follow-ups are off when null; an explicit 60–480 minute interval enables deduplicated follow-ups only while fresh sustained reduction remains validated. Missed follow-up slots are not replayed after outages.

Analysis uses up to the previous seven **qualifying attendance days**, excluding today, within a bounded 90-calendar-day lookback. Corresponding complete 30-minute intervals must each satisfy coverage and full attendance-session boundaries. Historical per-interval means are averaged equally across qualifying days. Today's last sustainedMinutes of completed contiguous intervals are compared to those same historical periods. Every interval must meet the reduction threshold; short dips cannot average into a sustained alert. Quiet-period overlap excludes the entire 30-minute interval and breaks continuity. Missing or ambiguous repeated local-clock intervals cannot qualify. All calculations filter measurement version and timezone. A timezone change retains old data but starts qualification under the new grouping; it does not silently merge historical clocks.

LOW_ACTIVITY additionally needs currently confirmed PRESENT, a fresh valid newest summary and a comparison period that ended within the last ten minutes. An old backlog cannot generate a new current alert. A near-zero baseline suppresses percentage interpretation. Existing alerts use Alert.kind=LOW_ACTIVITY, database-unique activityDedupKey and numeric details (scores, reduction, coverage, period, timezone, baseline days/version, followUp). They remain RECORDED under the existing alert-status pattern; no medical diagnosis or new external notification provider is implied. Danger alerts remain high priority; activity is medium priority.
