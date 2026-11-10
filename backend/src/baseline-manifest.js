// Frozen reviewed WP00-E baseline. Do not refresh from source at deployment time.
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
export const baseline = freeze({
  "hashes": {
    "prisma/schema.prisma": "7CEB70CEF00F9BCB0F7E293F714BA806C239DE05A10CE176797B760C7DAF91C0",
    "prisma/migrations/migration_lock.toml": "1DB17A8D051AA136110736752C5E1F8B7ED92B6EA8E803112FBBE2497047C210",
    "prisma/migrations/202610190001_phase1/migration.sql": "558509EDB058D17C39D59EB25B00E8D494986C8F48BBB792E7C29B707AF5990F",
    "prisma/migrations/202610190002_constraints/migration.sql": "EC07E4D242B912C03712C5F7F67081DA1C938D2D7D1658C15C5BE7932F90CD07",
    "prisma/migrations/202610210001_ble_proximity/migration.sql": "78B9537D308FB1E919F0446D97F3571C53182F181BCE6659657A0AF0D33EC3F4",
    "prisma/migrations/202610220001_multi_beacon/migration.sql": "524AA22CFAC44A7434AC900FEEAC2AE9262230505E96CE10D6CD125CD1D102C7",
    "prisma/migrations/202610230001_personal_activity/migration.sql": "6BD9B95F2C5B707CA6A6C83B4C4FBE5B4EEEB0DB5C6DFB13278283297BC0C527",
    "prisma/migrations/202610240001_registration_review/migration.sql": "FFC15C752473E5E7AC064A3C4429EB29B3B9B87CC30F3EC18DE9884F2EA8FED4",
    "prisma/migrations/202610240002_registration_invariants/migration.sql": "D7AAD501EFF8C74C82842A0042BB32BB57D9FF54435CEBE020C949990EF517A0"
  },
  "tables": [
    "Center",
    "User",
    "Child",
    "Guardian",
    "Device",
    "Assignment",
    "Beacon",
    "DeviceEvent",
    "Attendance",
    "Observation",
    "Confirmation",
    "Alert",
    "AuditLog",
    "ActivityPolicy",
    "ActivityAttendanceSession",
    "ActivityBoot",
    "ActivitySummary",
    "ActivityInterval",
    "ActivityDaily",
    "UserProfile",
    "CenterInvitation",
    "RegistrationApplication",
    "RegistrationDecision",
    "EnrollmentRequest",
    "DeviceClaimCode",
    "WearableRequest",
    "PrivatePhoto"
  ],
  "enums": {
    "Role": [
      "ADMIN",
      "TEACHER",
      "PARENT",
      "TRANSPORT"
    ],
    "AttendanceStatus": [
      "NOT_CHECKED_IN",
      "CHECKIN_PENDING",
      "PRESENT",
      "CHECKED_OUT"
    ],
    "ReviewStatus": [
      "PENDING",
      "APPROVED",
      "REJECTED"
    ]
  },
  "constraints": [
    {
      "table": "Center",
      "name": "Center_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "User",
      "name": "User_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "Child",
      "name": "Child_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "Guardian",
      "name": "Guardian_pkey",
      "type": "p",
      "columns": [
        "userId",
        "childId"
      ]
    },
    {
      "table": "Device",
      "name": "Device_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "Assignment",
      "name": "Assignment_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "Beacon",
      "name": "Beacon_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "DeviceEvent",
      "name": "DeviceEvent_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "Attendance",
      "name": "Attendance_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "Observation",
      "name": "Observation_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "Confirmation",
      "name": "Confirmation_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "Alert",
      "name": "Alert_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "AuditLog",
      "name": "AuditLog_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "User",
      "name": "User_centerId_fkey",
      "type": "f",
      "columns": [
        "centerId"
      ],
      "reference": "Center",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Child",
      "name": "Child_centerId_fkey",
      "type": "f",
      "columns": [
        "centerId"
      ],
      "reference": "Center",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Guardian",
      "name": "Guardian_userId_fkey",
      "type": "f",
      "columns": [
        "userId"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Guardian",
      "name": "Guardian_childId_fkey",
      "type": "f",
      "columns": [
        "childId"
      ],
      "reference": "Child",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Device",
      "name": "Device_centerId_fkey",
      "type": "f",
      "columns": [
        "centerId"
      ],
      "reference": "Center",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Assignment",
      "name": "Assignment_deviceId_fkey",
      "type": "f",
      "columns": [
        "deviceId"
      ],
      "reference": "Device",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Assignment",
      "name": "Assignment_childId_fkey",
      "type": "f",
      "columns": [
        "childId"
      ],
      "reference": "Child",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Beacon",
      "name": "Beacon_centerId_fkey",
      "type": "f",
      "columns": [
        "centerId"
      ],
      "reference": "Center",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "DeviceEvent",
      "name": "DeviceEvent_deviceId_fkey",
      "type": "f",
      "columns": [
        "deviceId"
      ],
      "reference": "Device",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "DeviceEvent",
      "name": "DeviceEvent_childId_fkey",
      "type": "f",
      "columns": [
        "childId"
      ],
      "reference": "Child",
      "referenceColumns": [
        "id"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "DeviceEvent",
      "name": "DeviceEvent_beaconId_fkey",
      "type": "f",
      "columns": [
        "beaconId"
      ],
      "reference": "Beacon",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Attendance",
      "name": "Attendance_childId_fkey",
      "type": "f",
      "columns": [
        "childId"
      ],
      "reference": "Child",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Observation",
      "name": "Observation_attendanceId_fkey",
      "type": "f",
      "columns": [
        "attendanceId"
      ],
      "reference": "Attendance",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Observation",
      "name": "Observation_eventId_fkey",
      "type": "f",
      "columns": [
        "eventId"
      ],
      "reference": "DeviceEvent",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Confirmation",
      "name": "Confirmation_attendanceId_fkey",
      "type": "f",
      "columns": [
        "attendanceId"
      ],
      "reference": "Attendance",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Confirmation",
      "name": "Confirmation_userId_fkey",
      "type": "f",
      "columns": [
        "userId"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Alert",
      "name": "Alert_eventId_fkey",
      "type": "f",
      "columns": [
        "eventId"
      ],
      "reference": "DeviceEvent",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "AuditLog",
      "name": "AuditLog_userId_fkey",
      "type": "f",
      "columns": [
        "userId"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "Assignment",
      "name": "assignment_time_order",
      "type": "c",
      "expression": "(\"endedAt\" IS NULL OR \"endedAt\" >= \"startedAt\")"
    },
    {
      "table": "Device",
      "name": "device_token_hash_length",
      "type": "c",
      "expression": "(\"tokenHash\" ~ '^[0-9a-f]{64}$')"
    },
    {
      "table": "DeviceEvent",
      "name": "device_uptime_uint32",
      "type": "c",
      "expression": "(\"deviceUptimeMs\" BETWEEN 0 AND 4294967295)"
    },
    {
      "table": "DeviceEvent",
      "name": "known_event_type",
      "type": "c",
      "expression": "(\"eventType\" IN ('CHILD_NEAR_GATE','GPS_STATUS','ACTIVITY_WINDOW','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST','ACTIVITY_SAMPLE_GAP','BLE_PROXIMITY','ACTIVITY_SUMMARY'))"
    },
    {
      "table": "Attendance",
      "name": "attendance_day_format",
      "type": "c",
      "expression": "(day ~ '^\\d{4}-\\d{2}-\\d{2}$')"
    },
    {
      "table": "Beacon",
      "name": "Beacon_identity_lowercase",
      "type": "c",
      "expression": "(\"serviceUuid\" IS NULL OR \"serviceUuid\" = lower(\"serviceUuid\"))"
    },
    {
      "table": "Beacon",
      "name": "Beacon_rssi_hysteresis",
      "type": "c",
      "expression": "(\"entryRssi\" BETWEEN -127 AND 0 AND \"exitRssi\" BETWEEN -127 AND 0 AND \"exitRssi\" <= \"entryRssi\" - 3 AND (\"attendanceRssi\" IS NULL OR \"attendanceRssi\" BETWEEN \"entryRssi\" AND 0))"
    },
    {
      "table": "Beacon",
      "name": "Beacon_createdById_fkey",
      "type": "f",
      "columns": [
        "createdById"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "Beacon",
      "name": "Beacon_updatedById_fkey",
      "type": "f",
      "columns": [
        "updatedById"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivityPolicy",
      "name": "ActivityPolicy_pkey",
      "type": "p",
      "columns": [
        "centerId"
      ]
    },
    {
      "table": "ActivityPolicy",
      "name": "ActivityPolicy_centerId_fkey",
      "type": "f",
      "columns": [
        "centerId"
      ],
      "reference": "Center",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivityAttendanceSession",
      "name": "ActivityAttendanceSession_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "ActivityAttendanceSession",
      "name": "ActivityAttendanceSession_attendanceId_fkey",
      "type": "f",
      "columns": [
        "attendanceId"
      ],
      "reference": "Attendance",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivityAttendanceSession",
      "name": "ActivityAttendanceSession_range",
      "type": "c",
      "expression": "(\"endedAt\" IS NULL OR \"endedAt\">=\"startedAt\")"
    },
    {
      "table": "ActivityBoot",
      "name": "ActivityBoot_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "ActivityBoot",
      "name": "ActivityBoot_deviceId_fkey",
      "type": "f",
      "columns": [
        "deviceId"
      ],
      "reference": "Device",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivitySummary",
      "name": "ActivitySummary_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "ActivitySummary",
      "name": "ActivitySummary_eventId_fkey",
      "type": "f",
      "columns": [
        "eventId"
      ],
      "reference": "DeviceEvent",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivitySummary",
      "name": "ActivitySummary_childId_fkey",
      "type": "f",
      "columns": [
        "childId"
      ],
      "reference": "Child",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivitySummary",
      "name": "ActivitySummary_deviceId_fkey",
      "type": "f",
      "columns": [
        "deviceId"
      ],
      "reference": "Device",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivitySummary",
      "name": "ActivitySummary_centerId_fkey",
      "type": "f",
      "columns": [
        "centerId"
      ],
      "reference": "Center",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivitySummary",
      "name": "ActivitySummary_attendanceSessionId_fkey",
      "type": "f",
      "columns": [
        "attendanceSessionId"
      ],
      "reference": "ActivityAttendanceSession",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivitySummary",
      "name": "ActivitySummary_quality",
      "type": "c",
      "expression": "(\"validSampleCount\" BETWEEN 0 AND \"expectedSampleCount\" AND \"validDurationSeconds\" BETWEEN 0 AND 60 AND (\"movementIntensity\" IS NULL OR \"movementIntensity\" BETWEEN 0 AND 4) AND \"endAt\">\"startAt\")"
    },
    {
      "table": "ActivityInterval",
      "name": "ActivityInterval_childId_fkey",
      "type": "f",
      "columns": [
        "childId"
      ],
      "reference": "Child",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivityInterval",
      "name": "ActivityInterval_centerId_fkey",
      "type": "f",
      "columns": [
        "centerId"
      ],
      "reference": "Center",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivityInterval",
      "name": "ActivityInterval_pkey",
      "type": "p",
      "columns": [
        "childId",
        "day",
        "startMinute",
        "timezone",
        "measurementVersion"
      ]
    },
    {
      "table": "ActivityDaily",
      "name": "ActivityDaily_childId_fkey",
      "type": "f",
      "columns": [
        "childId"
      ],
      "reference": "Child",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivityDaily",
      "name": "ActivityDaily_centerId_fkey",
      "type": "f",
      "columns": [
        "centerId"
      ],
      "reference": "Center",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "ActivityDaily",
      "name": "ActivityDaily_pkey",
      "type": "p",
      "columns": [
        "childId",
        "day",
        "timezone",
        "measurementVersion"
      ]
    },
    {
      "table": "UserProfile",
      "name": "UserProfile_pkey",
      "type": "p",
      "columns": [
        "userId"
      ]
    },
    {
      "table": "CenterInvitation",
      "name": "CenterInvitation_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "RegistrationApplication",
      "name": "RegistrationApplication_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "RegistrationDecision",
      "name": "RegistrationDecision_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "EnrollmentRequest",
      "name": "EnrollmentRequest_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "DeviceClaimCode",
      "name": "DeviceClaimCode_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "WearableRequest",
      "name": "WearableRequest_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "PrivatePhoto",
      "name": "PrivatePhoto_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    },
    {
      "table": "UserProfile",
      "name": "UserProfile_userId_fkey",
      "type": "f",
      "columns": [
        "userId"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "CenterInvitation",
      "name": "CenterInvitation_centerId_fkey",
      "type": "f",
      "columns": [
        "centerId"
      ],
      "reference": "Center",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "RegistrationApplication",
      "name": "RegistrationApplication_centerId_fkey",
      "type": "f",
      "columns": [
        "centerId"
      ],
      "reference": "Center",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "RegistrationApplication",
      "name": "RegistrationApplication_reviewerId_fkey",
      "type": "f",
      "columns": [
        "reviewerId"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "RegistrationApplication",
      "name": "RegistrationApplication_userId_fkey",
      "type": "f",
      "columns": [
        "userId"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "RegistrationDecision",
      "name": "RegistrationDecision_applicationId_fkey",
      "type": "f",
      "columns": [
        "applicationId"
      ],
      "reference": "RegistrationApplication",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "EnrollmentRequest",
      "name": "EnrollmentRequest_applicationId_fkey",
      "type": "f",
      "columns": [
        "applicationId"
      ],
      "reference": "RegistrationApplication",
      "referenceColumns": [
        "id"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "EnrollmentRequest",
      "name": "EnrollmentRequest_userId_fkey",
      "type": "f",
      "columns": [
        "userId"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "EnrollmentRequest",
      "name": "EnrollmentRequest_centerId_fkey",
      "type": "f",
      "columns": [
        "centerId"
      ],
      "reference": "Center",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "EnrollmentRequest",
      "name": "EnrollmentRequest_childId_fkey",
      "type": "f",
      "columns": [
        "childId"
      ],
      "reference": "Child",
      "referenceColumns": [
        "id"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "EnrollmentRequest",
      "name": "EnrollmentRequest_reviewerId_fkey",
      "type": "f",
      "columns": [
        "reviewerId"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "DeviceClaimCode",
      "name": "DeviceClaimCode_deviceId_fkey",
      "type": "f",
      "columns": [
        "deviceId"
      ],
      "reference": "Device",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "WearableRequest",
      "name": "WearableRequest_enrollmentId_fkey",
      "type": "f",
      "columns": [
        "enrollmentId"
      ],
      "reference": "EnrollmentRequest",
      "referenceColumns": [
        "id"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "WearableRequest",
      "name": "WearableRequest_userId_fkey",
      "type": "f",
      "columns": [
        "userId"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "WearableRequest",
      "name": "WearableRequest_childId_fkey",
      "type": "f",
      "columns": [
        "childId"
      ],
      "reference": "Child",
      "referenceColumns": [
        "id"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "WearableRequest",
      "name": "WearableRequest_centerId_fkey",
      "type": "f",
      "columns": [
        "centerId"
      ],
      "reference": "Center",
      "referenceColumns": [
        "id"
      ],
      "delete": "r",
      "update": "c"
    },
    {
      "table": "WearableRequest",
      "name": "WearableRequest_reviewerId_fkey",
      "type": "f",
      "columns": [
        "reviewerId"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "PrivatePhoto",
      "name": "PrivatePhoto_applicationId_fkey",
      "type": "f",
      "columns": [
        "applicationId"
      ],
      "reference": "RegistrationApplication",
      "referenceColumns": [
        "id"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "PrivatePhoto",
      "name": "PrivatePhoto_userId_fkey",
      "type": "f",
      "columns": [
        "userId"
      ],
      "reference": "UserProfile",
      "referenceColumns": [
        "userId"
      ],
      "delete": "n",
      "update": "c"
    },
    {
      "table": "RegistrationDecision",
      "name": "RegistrationDecision_reviewerId_fkey",
      "type": "f",
      "columns": [
        "reviewerId"
      ],
      "reference": "User",
      "referenceColumns": [
        "id"
      ],
      "delete": "a",
      "update": "a"
    },
    {
      "table": "RegistrationApplication",
      "name": "registration_mobile_roles",
      "type": "c",
      "expression": "(\"role\" IN ('PARENT','TEACHER'))"
    },
    {
      "table": "RegistrationApplication",
      "name": "registration_email_normalized",
      "type": "c",
      "expression": "(email = lower(email))"
    },
    {
      "table": "UserProfile",
      "name": "profile_email_normalized",
      "type": "c",
      "expression": "(email = lower(email))"
    },
    {
      "table": "PrivatePhoto",
      "name": "photo_owner_required",
      "type": "c",
      "expression": "(\"applicationId\" IS NOT NULL OR \"userId\" IS NOT NULL)"
    },
    {
      "table": "PrivatePhoto",
      "name": "photo_safe_storage_key",
      "type": "c",
      "expression": "(\"storageKey\" ~ '^[0-9a-f-]{36}$')"
    },
    {
      "table": "EnrollmentRequest",
      "name": "enrollment_owner_required",
      "type": "c",
      "expression": "(\"applicationId\" IS NOT NULL OR \"userId\" IS NOT NULL)"
    },
    {
      "table": "WearableRequest",
      "name": "wearable_owner_required",
      "type": "c",
      "expression": "(\"enrollmentId\" IS NOT NULL OR \"userId\" IS NOT NULL)"
    },
    {
      "table": "_prisma_migrations",
      "name": "_prisma_migrations_pkey",
      "type": "p",
      "columns": [
        "id"
      ]
    }
  ],
  "indexes": [
    {
      "name": "User_username_key",
      "table": "User",
      "unique": true,
      "columns": [
        "username"
      ],
      "predicate": null
    },
    {
      "name": "Device_hardwareId_key",
      "table": "Device",
      "unique": true,
      "columns": [
        "hardwareId"
      ],
      "predicate": null
    },
    {
      "name": "Assignment_deviceId_endedAt_idx",
      "table": "Assignment",
      "unique": false,
      "columns": [
        "deviceId",
        "endedAt"
      ],
      "predicate": null
    },
    {
      "name": "Beacon_hardwareId_key",
      "table": "Beacon",
      "unique": true,
      "columns": [
        "hardwareId"
      ],
      "predicate": null
    },
    {
      "name": "DeviceEvent_eventId_key",
      "table": "DeviceEvent",
      "unique": true,
      "columns": [
        "eventId"
      ],
      "predicate": null
    },
    {
      "name": "DeviceEvent_deviceId_receivedAt_idx",
      "table": "DeviceEvent",
      "unique": false,
      "columns": [
        "deviceId",
        "receivedAt"
      ],
      "predicate": null
    },
    {
      "name": "Attendance_childId_day_key",
      "table": "Attendance",
      "unique": true,
      "columns": [
        "childId",
        "day"
      ],
      "predicate": null
    },
    {
      "name": "Observation_eventId_key",
      "table": "Observation",
      "unique": true,
      "columns": [
        "eventId"
      ],
      "predicate": null
    },
    {
      "name": "Confirmation_attendanceId_key",
      "table": "Confirmation",
      "unique": true,
      "columns": [
        "attendanceId"
      ],
      "predicate": null
    },
    {
      "name": "Assignment_current_device",
      "table": "Assignment",
      "unique": true,
      "columns": [
        "deviceId"
      ],
      "predicate": "\"endedAt\" IS NULL"
    },
    {
      "name": "Assignment_current_child",
      "table": "Assignment",
      "unique": true,
      "columns": [
        "childId"
      ],
      "predicate": "\"endedAt\" IS NULL"
    },
    {
      "name": "DeviceEvent_deviceId_eventType_receivedAt_idx",
      "table": "DeviceEvent",
      "unique": false,
      "columns": [
        "deviceId",
        "eventType",
        "receivedAt"
      ],
      "predicate": null
    },
    {
      "name": "Beacon_serviceUuid_key",
      "table": "Beacon",
      "unique": true,
      "columns": [
        "serviceUuid"
      ],
      "predicate": null
    },
    {
      "name": "DeviceEvent_deviceId_beaconId_eventType_observedAt_idx",
      "table": "DeviceEvent",
      "unique": false,
      "columns": [
        "deviceId",
        "beaconId",
        "eventType",
        "observedAt"
      ],
      "predicate": null
    },
    {
      "name": "Beacon_centerId_active_idx",
      "table": "Beacon",
      "unique": false,
      "columns": [
        "centerId",
        "active"
      ],
      "predicate": null
    },
    {
      "name": "DeviceEvent_beaconId_eventType_observedAt_idx",
      "table": "DeviceEvent",
      "unique": false,
      "columns": [
        "beaconId",
        "eventType",
        "observedAt"
      ],
      "predicate": null
    },
    {
      "name": "Alert_activityDedupKey_key",
      "table": "Alert",
      "unique": true,
      "columns": [
        "activityDedupKey"
      ],
      "predicate": null
    },
    {
      "name": "ActivityAttendanceSession_attendanceId_startedAt_key",
      "table": "ActivityAttendanceSession",
      "unique": true,
      "columns": [
        "attendanceId",
        "startedAt"
      ],
      "predicate": null
    },
    {
      "name": "ActivityAttendanceSession_attendanceId_endedAt_idx",
      "table": "ActivityAttendanceSession",
      "unique": false,
      "columns": [
        "attendanceId",
        "endedAt"
      ],
      "predicate": null
    },
    {
      "name": "ActivityBoot_deviceId_sessionId_key",
      "table": "ActivityBoot",
      "unique": true,
      "columns": [
        "deviceId",
        "sessionId"
      ],
      "predicate": null
    },
    {
      "name": "ActivitySummary_eventId_key",
      "table": "ActivitySummary",
      "unique": true,
      "columns": [
        "eventId"
      ],
      "predicate": null
    },
    {
      "name": "ActivitySummary_deviceId_sessionId_sequence_key",
      "table": "ActivitySummary",
      "unique": true,
      "columns": [
        "deviceId",
        "sessionId",
        "sequence"
      ],
      "predicate": null
    },
    {
      "name": "ActivitySummary_childId_startAt_idx",
      "table": "ActivitySummary",
      "unique": false,
      "columns": [
        "childId",
        "startAt"
      ],
      "predicate": null
    },
    {
      "name": "ActivitySummary_centerId_day_idx",
      "table": "ActivitySummary",
      "unique": false,
      "columns": [
        "centerId",
        "day"
      ],
      "predicate": null
    },
    {
      "name": "ActivitySummary_deviceId_endAt_idx",
      "table": "ActivitySummary",
      "unique": false,
      "columns": [
        "deviceId",
        "endAt"
      ],
      "predicate": null
    },
    {
      "name": "ActivityInterval_centerId_day_idx",
      "table": "ActivityInterval",
      "unique": false,
      "columns": [
        "centerId",
        "day"
      ],
      "predicate": null
    },
    {
      "name": "ActivityDaily_centerId_day_idx",
      "table": "ActivityDaily",
      "unique": false,
      "columns": [
        "centerId",
        "day"
      ],
      "predicate": null
    },
    {
      "name": "UserProfile_email_key",
      "table": "UserProfile",
      "unique": true,
      "columns": [
        "email"
      ],
      "predicate": null
    },
    {
      "name": "CenterInvitation_codeHash_key",
      "table": "CenterInvitation",
      "unique": true,
      "columns": [
        "codeHash"
      ],
      "predicate": null
    },
    {
      "name": "RegistrationApplication_receiptHash_key",
      "table": "RegistrationApplication",
      "unique": true,
      "columns": [
        "receiptHash"
      ],
      "predicate": null
    },
    {
      "name": "RegistrationApplication_username_key",
      "table": "RegistrationApplication",
      "unique": true,
      "columns": [
        "username"
      ],
      "predicate": null
    },
    {
      "name": "RegistrationApplication_email_key",
      "table": "RegistrationApplication",
      "unique": true,
      "columns": [
        "email"
      ],
      "predicate": null
    },
    {
      "name": "RegistrationApplication_userId_key",
      "table": "RegistrationApplication",
      "unique": true,
      "columns": [
        "userId"
      ],
      "predicate": null
    },
    {
      "name": "RegistrationApplication_centerId_status_createdAt_idx",
      "table": "RegistrationApplication",
      "unique": false,
      "columns": [
        "centerId",
        "status",
        "createdAt"
      ],
      "predicate": null
    },
    {
      "name": "EnrollmentRequest_centerId_status_idx",
      "table": "EnrollmentRequest",
      "unique": false,
      "columns": [
        "centerId",
        "status"
      ],
      "predicate": null
    },
    {
      "name": "DeviceClaimCode_codeHash_key",
      "table": "DeviceClaimCode",
      "unique": true,
      "columns": [
        "codeHash"
      ],
      "predicate": null
    },
    {
      "name": "WearableRequest_enrollmentId_key",
      "table": "WearableRequest",
      "unique": true,
      "columns": [
        "enrollmentId"
      ],
      "predicate": null
    },
    {
      "name": "WearableRequest_centerId_status_idx",
      "table": "WearableRequest",
      "unique": false,
      "columns": [
        "centerId",
        "status"
      ],
      "predicate": null
    },
    {
      "name": "PrivatePhoto_applicationId_key",
      "table": "PrivatePhoto",
      "unique": true,
      "columns": [
        "applicationId"
      ],
      "predicate": null
    },
    {
      "name": "PrivatePhoto_userId_key",
      "table": "PrivatePhoto",
      "unique": true,
      "columns": [
        "userId"
      ],
      "predicate": null
    },
    {
      "name": "PrivatePhoto_storageKey_key",
      "table": "PrivatePhoto",
      "unique": true,
      "columns": [
        "storageKey"
      ],
      "predicate": null
    }
  ],
  "functionSource": "BEGIN\n IF (SELECT \"centerId\" FROM \"Device\" WHERE id = NEW.\"deviceId\") IS DISTINCT FROM (SELECT \"centerId\" FROM \"Child\" WHERE id = NEW.\"childId\") THEN\n  RAISE EXCEPTION 'Assignment must belong to one center';\n END IF;\n RETURN NEW;\nEND;"
});
