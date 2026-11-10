-- ONE coordinated classroom-prototype forward migration. REVIEW ONLY; NOT APPLIED.
BEGIN;
CREATE TABLE public."SafeZone" (
 id TEXT PRIMARY KEY,
 "centerId" TEXT NOT NULL UNIQUE REFERENCES public."Center"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 name VARCHAR(100) NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100 AND name=btrim(name) AND name !~ '[[:cntrl:]]'),
 latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
 longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
 "radiusM" DOUBLE PRECISION NOT NULL CHECK ("radiusM" BETWEEN 50 AND 5000),
 active BOOLEAN NOT NULL DEFAULT false,
 revision INTEGER NOT NULL DEFAULT 0 CHECK (revision>=0),
 "effectiveAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public."GeofenceState" (
 "zoneId" TEXT NOT NULL REFERENCES public."SafeZone"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "deviceId" TEXT NOT NULL REFERENCES public."Device"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 checkpoint JSONB NOT NULL CHECK (jsonb_typeof(checkpoint)='object'),
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("zoneId","deviceId")
);
CREATE TABLE public."GeofenceReading" (
 "eventId" TEXT PRIMARY KEY REFERENCES public."DeviceEvent"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "zoneId" TEXT NOT NULL REFERENCES public."SafeZone"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 "zoneRevision" INTEGER NOT NULL CHECK ("zoneRevision">=0),
 state TEXT NOT NULL CHECK (state IN ('UNKNOWN','INSIDE','OUTSIDE')),
 reason TEXT NOT NULL,
 "distanceM" DOUBLE PRECISION CHECK ("distanceM">=0 AND "distanceM"<'Infinity'::float8),
 "observedAt" TIMESTAMPTZ(3),
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "GeofenceReading_zoneId_createdAt_idx" ON public."GeofenceReading"("zoneId","createdAt");
-- Narrow new-table privileges in the same atomic rollout; no broad defaults or roles.
REVOKE ALL ON public."SafeZone",public."GeofenceState",public."GeofenceReading" FROM PUBLIC,childguard_v2_app;
GRANT SELECT,INSERT,UPDATE ON public."SafeZone",public."GeofenceState" TO childguard_v2_app;
GRANT SELECT,INSERT ON public."GeofenceReading" TO childguard_v2_app;
COMMIT;
