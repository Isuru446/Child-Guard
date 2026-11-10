-- STAGED ONLY. Do not run migrate deploy against live V2 without owner review,
-- verified backup and inspection of ALL pending migrations. No live deployment
-- was performed by this implementation.
BEGIN;
DO $$ BEGIN
 IF current_database() <> 'childguard_v2' THEN
  RAISE EXCEPTION 'RFID migration is restricted to the reviewed childguard_v2 database';
 END IF;
END $$;
CREATE TABLE "RfidReader" (
 "id" TEXT PRIMARY KEY, "hardwareId" TEXT NOT NULL UNIQUE,
 "tokenHash" CHAR(64) NOT NULL UNIQUE, "centerId" TEXT NOT NULL REFERENCES "Center"("id") ON DELETE RESTRICT,
 "active" BOOLEAN NOT NULL DEFAULT true, "modeVersion" INTEGER NOT NULL DEFAULT 0, "startMinute" INTEGER NOT NULL, "endMinute" INTEGER NOT NULL,
 "lastSeen" TIMESTAMPTZ(3), "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RfidReader_window_check" CHECK ("startMinute">=0 AND "endMinute"<=1440 AND "startMinute"<"endMinute")
);
CREATE INDEX "RfidReader_centerId_active_idx" ON "RfidReader"("centerId","active");
CREATE TABLE "RfidCard" (
 "id" TEXT PRIMARY KEY, "uidHash" CHAR(64) NOT NULL, "uidLength" INTEGER NOT NULL,
 "maskedUid" TEXT NOT NULL, "childId" TEXT NOT NULL REFERENCES "Child"("id") ON DELETE RESTRICT,
 "centerId" TEXT NOT NULL REFERENCES "Center"("id") ON DELETE RESTRICT,
 "status" TEXT NOT NULL DEFAULT 'ACTIVE', "issuedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "readerId" TEXT NOT NULL REFERENCES "RfidReader"("id") ON DELETE RESTRICT,
 "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "revokedAt" TIMESTAMPTZ(3), "reason" TEXT,
 CHECK ("uidLength" IN (4,7,10)), CHECK ("status" IN ('ACTIVE','REVOKED','REPLACED'))
);
CREATE UNIQUE INDEX "RfidCard_one_active_child" ON "RfidCard"("childId") WHERE "status"='ACTIVE';
CREATE UNIQUE INDEX "RfidCard_one_active_uid" ON "RfidCard"("uidHash") WHERE "status"='ACTIVE';
CREATE INDEX "RfidCard_childId_issuedAt_idx" ON "RfidCard"("childId","issuedAt");
CREATE INDEX "RfidCard_uidHash_idx" ON "RfidCard"("uidHash");
CREATE TABLE "RfidEnrollment" (
 "id" TEXT PRIMARY KEY, "readerId" TEXT NOT NULL REFERENCES "RfidReader"("id") ON DELETE RESTRICT,
 "childId" TEXT NOT NULL REFERENCES "Child"("id") ON DELETE RESTRICT,
 "centerId" TEXT NOT NULL REFERENCES "Center"("id") ON DELETE RESTRICT,
 "issuedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "expectedCardId" TEXT, "status" TEXT NOT NULL DEFAULT 'PENDING', "expiresAt" TIMESTAMPTZ(3) NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resultCardId" TEXT,
 CHECK ("status" IN ('PENDING','SUCCESS','CANCELLED','EXPIRED','REJECTED'))
);
CREATE UNIQUE INDEX "RfidEnrollment_one_pending_reader" ON "RfidEnrollment"("readerId") WHERE "status"='PENDING';
CREATE UNIQUE INDEX "RfidEnrollment_one_pending_child" ON "RfidEnrollment"("childId") WHERE "status"='PENDING';
CREATE INDEX "RfidEnrollment_childId_createdAt_idx" ON "RfidEnrollment"("childId","createdAt");
CREATE TABLE "RfidScan" (
 "id" TEXT PRIMARY KEY, "eventId" TEXT NOT NULL UNIQUE,
 "actorType" TEXT NOT NULL DEFAULT 'AUTHENTICATED_RFID_READER' CHECK ("actorType"='AUTHENTICATED_RFID_READER'),
 "readerId" TEXT NOT NULL REFERENCES "RfidReader"("id") ON DELETE RESTRICT,
 "centerId" TEXT NOT NULL REFERENCES "Center"("id") ON DELETE RESTRICT,
 "readerBootId" TEXT NOT NULL, "scanSequence" INTEGER NOT NULL, "modeVersion" INTEGER NOT NULL,
 "uidHash" CHAR(64) NOT NULL, "enrollmentId" TEXT,
 "attendanceId" TEXT REFERENCES "Attendance"("id") ON DELETE RESTRICT,
 "cardId" TEXT REFERENCES "RfidCard"("id") ON DELETE RESTRICT, "result" TEXT NOT NULL, "changed" BOOLEAN NOT NULL DEFAULT false,
 "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("readerId","readerBootId","scanSequence"), CHECK ("scanSequence">0)
);
CREATE INDEX "RfidScan_centerId_receivedAt_idx" ON "RfidScan"("centerId","receivedAt");
ALTER TABLE "Confirmation" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Confirmation" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'TEACHER',
 ADD COLUMN "readerId" TEXT REFERENCES "RfidReader"("id") ON DELETE RESTRICT,
 ADD COLUMN "rfidCardId" TEXT REFERENCES "RfidCard"("id") ON DELETE RESTRICT,
 ADD COLUMN "rfidScanId" TEXT UNIQUE REFERENCES "RfidScan"("id") ON DELETE RESTRICT;
ALTER TABLE "Confirmation" ADD CONSTRAINT "Confirmation_actor_check" CHECK (
 ("method"='TEACHER' AND "userId" IS NOT NULL AND "readerId" IS NULL AND "rfidCardId" IS NULL AND "rfidScanId" IS NULL)
 OR ("method"='RFID_CARD' AND "userId" IS NULL AND "readerId" IS NOT NULL AND "rfidCardId" IS NOT NULL AND "rfidScanId" IS NOT NULL)
);
COMMIT;
