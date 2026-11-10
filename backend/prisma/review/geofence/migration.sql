-- REVIEW ONLY: deliberately outside prisma/migrations. Not approved for execution.
BEGIN;
CREATE TABLE "SafeZone" (
 "id" TEXT NOT NULL,
 "centerId" TEXT NOT NULL,
 "name" VARCHAR(100) NOT NULL,
 "latitude" DOUBLE PRECISION NOT NULL,
 "longitude" DOUBLE PRECISION NOT NULL,
 "radiusM" DOUBLE PRECISION NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT false,
 "revision" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SafeZone_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "SafeZone_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT "SafeZone_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 100 AND "name" = btrim("name") AND "name" !~ '[[:cntrl:]]'),
 CONSTRAINT "SafeZone_coordinates_check" CHECK ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180),
 CONSTRAINT "SafeZone_radiusM_check" CHECK ("radiusM" BETWEEN 50 AND 5000),
 CONSTRAINT "SafeZone_revision_check" CHECK ("revision" >= 0)
);
CREATE UNIQUE INDEX "SafeZone_centerId_name_key" ON "SafeZone"("centerId", "name");
CREATE INDEX "SafeZone_centerId_active_idx" ON "SafeZone"("centerId", "active");
COMMIT;
-- No extensions, functions, triggers, existing-row backfills, role changes or grants.
-- Range checks also reject PostgreSQL floating NaN / infinities.
