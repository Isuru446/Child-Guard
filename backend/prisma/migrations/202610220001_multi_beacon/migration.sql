-- Additive registry extension: existing Beacon IDs/event foreign keys stay intact.
ALTER TABLE "Beacon"
 ADD COLUMN "serviceUuid" TEXT,
 ADD COLUMN "name" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "location" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "entryRssi" DOUBLE PRECISION NOT NULL DEFAULT -63,
 ADD COLUMN "exitRssi" DOUBLE PRECISION NOT NULL DEFAULT -69,
 ADD COLUMN "attendanceRssi" DOUBLE PRECISION DEFAULT -55,
 ADD COLUMN "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "createdById" TEXT REFERENCES "User"(id),
 ADD COLUMN "updatedById" TEXT REFERENCES "User"(id);
UPDATE "Beacon" SET "serviceUuid"='7b700001-24a6-4a25-9d3b-21c547a10001'
 WHERE "hardwareId"='CG-GATE-01' AND kind='GATE';
-- Existing records do not supply trustworthy names/locations: leave them unset.
CREATE UNIQUE INDEX "Beacon_serviceUuid_key" ON "Beacon"("serviceUuid");
ALTER TABLE "Beacon" ADD CONSTRAINT "Beacon_identity_lowercase" CHECK ("serviceUuid" IS NULL OR "serviceUuid" = lower("serviceUuid"));
ALTER TABLE "Beacon" ADD CONSTRAINT "Beacon_rssi_hysteresis" CHECK ("entryRssi" BETWEEN -127 AND 0 AND "exitRssi" BETWEEN -127 AND 0 AND "exitRssi" <= "entryRssi" - 3 AND ("attendanceRssi" IS NULL OR "attendanceRssi" BETWEEN "entryRssi" AND 0));
ALTER TABLE "DeviceEvent" ADD COLUMN "observedAt" TIMESTAMPTZ(3);
UPDATE "DeviceEvent" SET "observedAt"="receivedAt" - COALESCE((payload->>'queueAgeMs')::double precision,0) * INTERVAL '1 millisecond';
CREATE INDEX "DeviceEvent_deviceId_beaconId_eventType_observedAt_idx" ON "DeviceEvent"("deviceId","beaconId","eventType","observedAt");

CREATE INDEX "Beacon_centerId_active_idx" ON "Beacon"("centerId","active");
CREATE INDEX "DeviceEvent_beaconId_eventType_observedAt_idx" ON "DeviceEvent"("beaconId","eventType","observedAt");
