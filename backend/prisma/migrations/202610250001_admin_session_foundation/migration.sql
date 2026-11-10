-- WP02-A forward-only draft. NOT authorized for execution.
-- Existing IDs are text UUID strings; preserve their actual baseline types.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = public, pg_catalog;
DO $$
BEGIN
  IF current_database() <> 'childguard_v2' OR current_user <> 'childguard_v2_migrator'
     OR session_user <> 'childguard_v2_migrator' OR current_schema() <> 'public'
     OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1' OR inet_server_port() IS DISTINCT FROM 5432
     OR current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND
       (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN
    RAISE EXCEPTION 'V2 forward migration target refused';
  END IF;
END;
$$;
ALTER TABLE "User" ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_authVersion_nonnegative" CHECK ("authVersion" >= 0);

CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "centerId" TEXT NOT NULL,
  "clientKind" TEXT NOT NULL DEFAULT 'ADMIN_WEB',
  "roleAtLogin" "Role" NOT NULL DEFAULT 'ADMIN',
  "authVersion" INTEGER NOT NULL,
  "credentialHash" CHAR(64) NOT NULL,
  "csrfHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "absoluteExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "lastActivityAt" TIMESTAMPTZ(3) NOT NULL,
  "idleExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "revokeReason" TEXT,
  "lastInteractionId" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthSession_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "AuthSession_admin_only" CHECK ("clientKind" = 'ADMIN_WEB' AND "roleAtLogin" = 'ADMIN'),
  CONSTRAINT "AuthSession_versions" CHECK ("authVersion" >= 0 AND "revision" >= 0),
  CONSTRAINT "AuthSession_hashes" CHECK ("credentialHash" ~ '^[a-f0-9]{64}$' AND "csrfHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "AuthSession_time_order" CHECK ("createdAt" <= "lastActivityAt" AND "lastActivityAt" < "idleExpiresAt" AND "idleExpiresAt" <= "absoluteExpiresAt"),
  CONSTRAINT "AuthSession_idle_limit" CHECK ("idleExpiresAt" <= "lastActivityAt" + INTERVAL '300 seconds'),
  CONSTRAINT "AuthSession_absolute_limit" CHECK ("absoluteExpiresAt" <= "createdAt" + INTERVAL '8 hours')
);
CREATE UNIQUE INDEX "AuthSession_credentialHash_key" ON "AuthSession"("credentialHash");
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");
CREATE INDEX "AuthSession_absoluteExpiresAt_idx" ON "AuthSession"("absoluteExpiresAt");
CREATE INDEX "AuthSession_idleExpiresAt_idx" ON "AuthSession"("idleExpiresAt");
CREATE INDEX "AuthSession_centerId_idx" ON "AuthSession"("centerId");

-- Same transaction as trigger creation: no committed missing-privilege window.
-- Runtime stays DML-only; no ownership, DDL, DELETE or migration-ledger access.
REVOKE ALL ON public."AuthSession" FROM PUBLIC;
REVOKE ALL ON public."AuthSession" FROM childguard_v2_app;
GRANT SELECT, INSERT, UPDATE ON public."AuthSession" TO childguard_v2_app;

-- Lock order: User row, then that user's AuthSession rows. Invoker privileges,
-- fixed search path, no extensions, dynamic SQL or SECURITY DEFINER.
CREATE FUNCTION public.childguard_invalidate_admin_sessions() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW."passwordHash" IS DISTINCT FROM OLD."passwordHash"
     OR NEW."active" IS DISTINCT FROM OLD."active"
     OR NEW."role" IS DISTINCT FROM OLD."role"
     OR NEW."centerId" IS DISTINCT FROM OLD."centerId"
     OR NEW."authVersion" IS DISTINCT FROM OLD."authVersion" THEN
    NEW."authVersion" := GREATEST(NEW."authVersion", OLD."authVersion" + 1);
    UPDATE public."AuthSession" SET "revokedAt" = clock_timestamp(),
      "revokeReason" = 'ACCOUNT_CHANGED', "revision" = "revision" + 1
      WHERE "userId" = OLD."id" AND "revokedAt" IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.childguard_invalidate_admin_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.childguard_invalidate_admin_sessions() TO childguard_v2_app;
CREATE TRIGGER "User_invalidate_admin_sessions"
BEFORE UPDATE OF "passwordHash", "active", "role", "centerId", "authVersion" ON "User"
FOR EACH ROW EXECUTE FUNCTION public.childguard_invalidate_admin_sessions();
COMMIT;
