-- Extend the existing event-type allowlist without removing any supported event.
ALTER TABLE "DeviceEvent" DROP CONSTRAINT "known_event_type";
ALTER TABLE "DeviceEvent" ADD CONSTRAINT "known_event_type" CHECK ("eventType" IN ('CHILD_NEAR_GATE','GPS_STATUS','ACTIVITY_WINDOW','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST','ACTIVITY_SAMPLE_GAP','BLE_PROXIMITY','ACTIVITY_SUMMARY'));
-- Activity is sensor telemetry, not a gate observation. Existing beacon links stay intact.
ALTER TABLE "DeviceEvent" ALTER COLUMN "beaconId" DROP NOT NULL;
ALTER TABLE "Alert" ADD COLUMN "activityDedupKey" TEXT, ADD COLUMN "details" JSONB;
CREATE UNIQUE INDEX "Alert_activityDedupKey_key" ON "Alert"("activityDedupKey");
CREATE TABLE "ActivityPolicy" (
 "centerId" TEXT PRIMARY KEY REFERENCES "Center"(id), "settings" JSONB NOT NULL,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "ActivityAttendanceSession" (
 id TEXT PRIMARY KEY, "attendanceId" TEXT NOT NULL REFERENCES "Attendance"(id),
 "startedAt" TIMESTAMPTZ(3) NOT NULL, "endedAt" TIMESTAMPTZ(3), "lastObservedAt" TIMESTAMPTZ(3),
 CONSTRAINT "ActivityAttendanceSession_range" CHECK ("endedAt" IS NULL OR "endedAt">="startedAt")
);
CREATE UNIQUE INDEX "ActivityAttendanceSession_attendanceId_startedAt_key" ON "ActivityAttendanceSession"("attendanceId","startedAt");
CREATE INDEX "ActivityAttendanceSession_attendanceId_endedAt_idx" ON "ActivityAttendanceSession"("attendanceId","endedAt");
-- Existing confirmed PRESENT records start an activity session without changing confirmation/audit.
INSERT INTO "ActivityAttendanceSession"(id,"attendanceId","startedAt")
 SELECT 'activity-legacy-'||a.id,a.id,c."confirmedAt" FROM "Attendance" a JOIN "Confirmation" c ON c."attendanceId"=a.id WHERE a.status='PRESENT';
CREATE TABLE "ActivityBoot" (
 id TEXT PRIMARY KEY,"deviceId" TEXT NOT NULL REFERENCES "Device"(id),"sessionId" TEXT NOT NULL,
 "anchorUptimeMs" BIGINT NOT NULL,"anchorAt" TIMESTAMPTZ(3) NOT NULL,"createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ActivityBoot_deviceId_sessionId_key" ON "ActivityBoot"("deviceId","sessionId");
CREATE TABLE "ActivitySummary" (
 id TEXT PRIMARY KEY,"eventId" TEXT NOT NULL REFERENCES "DeviceEvent"(id),
 "childId" TEXT NOT NULL REFERENCES "Child"(id),"deviceId" TEXT NOT NULL REFERENCES "Device"(id),"centerId" TEXT NOT NULL REFERENCES "Center"(id),
 "attendanceSessionId" TEXT REFERENCES "ActivityAttendanceSession"(id),"sessionId" TEXT NOT NULL,sequence INTEGER NOT NULL,
 "measurementVersion" TEXT NOT NULL,timezone TEXT NOT NULL,day TEXT NOT NULL,"startAt" TIMESTAMPTZ(3) NOT NULL,"endAt" TIMESTAMPTZ(3) NOT NULL,
 "movementIntensity" DOUBLE PRECISION,"validSampleCount" INTEGER NOT NULL,"expectedSampleCount" INTEGER NOT NULL,
 "validDurationSeconds" DOUBLE PRECISION NOT NULL,"sensorStatus" TEXT NOT NULL,eligible BOOLEAN NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ActivitySummary_quality" CHECK ("validSampleCount" BETWEEN 0 AND "expectedSampleCount" AND "validDurationSeconds" BETWEEN 0 AND 60 AND ("movementIntensity" IS NULL OR "movementIntensity" BETWEEN 0 AND 4) AND "endAt">"startAt")
);
CREATE UNIQUE INDEX "ActivitySummary_eventId_key" ON "ActivitySummary"("eventId");
CREATE UNIQUE INDEX "ActivitySummary_deviceId_sessionId_sequence_key" ON "ActivitySummary"("deviceId","sessionId",sequence);
CREATE INDEX "ActivitySummary_childId_startAt_idx" ON "ActivitySummary"("childId","startAt");
CREATE INDEX "ActivitySummary_centerId_day_idx" ON "ActivitySummary"("centerId",day);
CREATE INDEX "ActivitySummary_deviceId_endAt_idx" ON "ActivitySummary"("deviceId","endAt");
CREATE TABLE "ActivityInterval" (
 "childId" TEXT NOT NULL REFERENCES "Child"(id),"centerId" TEXT NOT NULL REFERENCES "Center"(id),day TEXT NOT NULL,
 "startMinute" INTEGER NOT NULL,timezone TEXT NOT NULL,"measurementVersion" TEXT NOT NULL,"utcStart" TIMESTAMPTZ(3) NOT NULL,
 "clockAmbiguous" BOOLEAN NOT NULL DEFAULT false,"movementIntegral" DOUBLE PRECISION NOT NULL DEFAULT 0,
 "validSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,"observedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("childId",day,"startMinute",timezone,"measurementVersion")
);
CREATE INDEX "ActivityInterval_centerId_day_idx" ON "ActivityInterval"("centerId",day);
CREATE TABLE "ActivityDaily" (
 "childId" TEXT NOT NULL REFERENCES "Child"(id),"centerId" TEXT NOT NULL REFERENCES "Center"(id),day TEXT NOT NULL,
 timezone TEXT NOT NULL,"measurementVersion" TEXT NOT NULL,"movementIntegral" DOUBLE PRECISION NOT NULL DEFAULT 0,
 "validSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,"observedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY("childId",day,timezone,"measurementVersion")
);
CREATE INDEX "ActivityDaily_centerId_day_idx" ON "ActivityDaily"("centerId",day);
