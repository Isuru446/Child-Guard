-- SEPARATE REVIEW OPTION ONLY; requires the configuration-only SafeZone draft.
-- Not an executable Prisma migration. No runtime consumer or alert activation.
BEGIN;
CREATE TABLE "GeofenceCursor" (
 "zoneId" TEXT NOT NULL REFERENCES "SafeZone"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "deviceId" TEXT NOT NULL REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "centerId" TEXT NOT NULL REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "zoneRevision" INTEGER NOT NULL,
 "assignmentId" TEXT REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "childId" TEXT REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "lastEventId" TEXT REFERENCES "DeviceEvent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "lastObservedAt" TIMESTAMPTZ(3),
 "stableState" TEXT NOT NULL DEFAULT 'UNKNOWN',
 "pendingState" TEXT,
 "pendingSince" TIMESTAMPTZ(3),
 "pendingCount" INTEGER NOT NULL DEFAULT 0,
 "openEpisodeId" TEXT,
 "version" INTEGER NOT NULL DEFAULT 0,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "GeofenceCursor_pkey" PRIMARY KEY ("zoneId","deviceId"),
 CONSTRAINT "GeofenceCursor_revision_check" CHECK ("zoneRevision" >= 0 AND "version" >= 0),
 CONSTRAINT "GeofenceCursor_state_check" CHECK ("stableState" IN ('UNKNOWN','INSIDE','OUTSIDE') AND ("pendingState" IS NULL OR "pendingState" IN ('INSIDE','OUTSIDE'))),
 CONSTRAINT "GeofenceCursor_assignment_check" CHECK (("assignmentId" IS NULL) = ("childId" IS NULL)),
 CONSTRAINT "GeofenceCursor_watermark_check" CHECK (("lastEventId" IS NULL) = ("lastObservedAt" IS NULL)),
 CONSTRAINT "GeofenceCursor_pending_check" CHECK (("pendingState" IS NULL AND "pendingSince" IS NULL AND "pendingCount" = 0) OR ("pendingState" IS NOT NULL AND "pendingSince" IS NOT NULL AND "lastObservedAt" IS NOT NULL AND "pendingSince" <= "lastObservedAt" AND "pendingCount" >= 1)),
 CONSTRAINT "GeofenceCursor_episode_check" CHECK ("openEpisodeId" IS NULL OR ("assignmentId" IS NOT NULL AND "lastObservedAt" IS NOT NULL))
);
CREATE INDEX "GeofenceCursor_centerId_idx" ON "GeofenceCursor"("centerId");
CREATE TABLE "GeofenceEvaluation" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "zoneId" TEXT NOT NULL REFERENCES "SafeZone"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "deviceId" TEXT NOT NULL REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "centerId" TEXT NOT NULL REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "assignmentId" TEXT REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "childId" TEXT REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "eventId" TEXT NOT NULL REFERENCES "DeviceEvent"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "zoneRevision" INTEGER NOT NULL CHECK ("zoneRevision" >= 0),
 "observedAt" TIMESTAMPTZ(3),
 "receivedAt" TIMESTAMPTZ(3) NOT NULL,
 "decision" TEXT NOT NULL CHECK ("decision" IN ('UNKNOWN','INSIDE','OUTSIDE')),
 "reason" TEXT NOT NULL,
 "zoneSnapshot" JSONB NOT NULL CHECK (jsonb_typeof("zoneSnapshot") = 'object'),
 "episodeId" TEXT,
 "alertId" TEXT REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "GeofenceEvaluation_assignment_check" CHECK (("assignmentId" IS NULL) = ("childId" IS NULL)),
 CONSTRAINT "GeofenceEvaluation_time_check" CHECK ("observedAt" IS NULL OR "observedAt" <= "receivedAt"),
 CONSTRAINT "GeofenceEvaluation_decision_check" CHECK ("decision" = 'UNKNOWN' OR ("observedAt" IS NOT NULL AND "assignmentId" IS NOT NULL)),
 CONSTRAINT "GeofenceEvaluation_alert_check" CHECK (("episodeId" IS NULL AND "alertId" IS NULL) OR ("episodeId" IS NOT NULL AND "alertId" IS NOT NULL AND "decision" = 'OUTSIDE' AND "assignmentId" IS NOT NULL AND "observedAt" IS NOT NULL))
);
-- Revision is deliberately absent from the receipt key: old events cannot be reused on edit.
CREATE UNIQUE INDEX "GeofenceEvaluation_zoneId_eventId_key" ON "GeofenceEvaluation"("zoneId","eventId");
-- episodeId is set ONLY on the opening alert row; other receipt rows use NULL.
CREATE UNIQUE INDEX "GeofenceEvaluation_zoneId_deviceId_episodeId_key" ON "GeofenceEvaluation"("zoneId","deviceId","episodeId");
CREATE UNIQUE INDEX "GeofenceEvaluation_alertId_key" ON "GeofenceEvaluation"("alertId");
CREATE INDEX "GeofenceEvaluation_centerId_createdAt_idx" ON "GeofenceEvaluation"("centerId","createdAt");
COMMIT;
-- No ALTERs to deployed tables, backfills, triggers, roles or GRANTs.
-- Scalar FKs do NOT prove tenant/assignment/event consistency; see READINESS.md.
