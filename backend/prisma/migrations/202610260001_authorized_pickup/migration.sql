-- STAGED ONLY. Owner approval and verified V2 backup required before deployment.
-- Offline Prisma-generated additive DDL, plus handover invariants. No existing rows changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public, pg_catalog;
DO $$ BEGIN
 IF current_database() <> 'childguard_v2'
    OR current_user <> 'childguard_v2_migrator'
    OR session_user <> 'childguard_v2_migrator'
    OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
    OR inet_server_port() IS DISTINCT FROM 5432
 THEN RAISE EXCEPTION 'V2 pickup target refused'; END IF;
END $$;

CREATE TABLE "PickupPhoto" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupPhoto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthorizedPickupPerson" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT,
    "photoId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthorizedPickupPerson_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PickupRequest" (
    "id" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "day" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "windowEnd" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "codeHash" CHAR(64),
    "codeSalt" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "codeIssues" INTEGER NOT NULL DEFAULT 1,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "handoverHash" CHAR(64),
    "handoverExpiresAt" TIMESTAMPTZ(3),
    "reviewedById" TEXT,
    "completedAt" TIMESTAMPTZ(3),
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PickupPhoto_childId_idx" ON "PickupPhoto"("childId");

CREATE INDEX "AuthorizedPickupPerson_childId_active_idx" ON "AuthorizedPickupPerson"("childId", "active");

CREATE INDEX "PickupRequest_centerId_createdAt_idx" ON "PickupRequest"("centerId", "createdAt");

CREATE INDEX "PickupRequest_childId_day_idx" ON "PickupRequest"("childId", "day");

ALTER TABLE "PickupPhoto" ADD CONSTRAINT "PickupPhoto_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PickupPhoto" ADD CONSTRAINT "PickupPhoto_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PickupPhoto" ADD CONSTRAINT "PickupPhoto_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuthorizedPickupPerson" ADD CONSTRAINT "AuthorizedPickupPerson_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuthorizedPickupPerson" ADD CONSTRAINT "AuthorizedPickupPerson_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuthorizedPickupPerson" ADD CONSTRAINT "AuthorizedPickupPerson_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuthorizedPickupPerson" ADD CONSTRAINT "AuthorizedPickupPerson_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "PickupPhoto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_personId_fkey" FOREIGN KEY ("personId") REFERENCES "AuthorizedPickupPerson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "PickupPhoto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PickupPhoto" ADD CONSTRAINT "PickupPhoto_size" CHECK (octet_length(bytes) BETWEEN 24 AND 2097152);
ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_state" CHECK (status IN ('PENDING','COMPLETED','CANCELLED','EXPIRED','REJECTED'));
ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_attempts" CHECK (attempts BETWEEN 0 AND 5 AND "codeIssues" BETWEEN 1 AND 3);
ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_window" CHECK ("windowEnd">"windowStart" AND "expiresAt"<="windowEnd");
ALTER TABLE "PickupRequest" ADD CONSTRAINT "PickupRequest_completion" CHECK (status<>'COMPLETED' OR ("completedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND "verifiedById" IS NOT NULL AND "verifiedById"="reviewedById"));
CREATE UNIQUE INDEX "PickupRequest_one_pending" ON "PickupRequest" ("childId",day) WHERE status='PENDING';
CREATE UNIQUE INDEX "PickupRequest_one_completion" ON "PickupRequest" ("childId",day) WHERE status='COMPLETED';
-- Grant only the operations used by these new endpoints; photos are immutable.
REVOKE ALL ON TABLE "PickupPhoto", "AuthorizedPickupPerson", "PickupRequest" FROM PUBLIC;
GRANT SELECT, INSERT ON TABLE "PickupPhoto" TO childguard_v2_app;
GRANT SELECT, INSERT, UPDATE ON TABLE "AuthorizedPickupPerson", "PickupRequest" TO childguard_v2_app;
COMMIT;
