-- Metadata only. Owner authentication required; no role changes or business records.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN
 IF current_database()<>'childguard_v2'
 OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
 OR inet_server_port() IS DISTINCT FROM 5432
 OR current_setting('transaction_read_only')<>'on'
 OR current_user<>'postgres' OR session_user<>'postgres'
 THEN RAISE EXCEPTION 'V2 owner read-only reconciliation refused'; END IF;
END $$;
SELECT migration_name,checksum,
 started_at AT TIME ZONE 'UTC' AS started_utc,
 finished_at AT TIME ZONE 'UTC' AS finished_utc,
 finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS rolled_back,applied_steps_count
 FROM public."_prisma_migrations" ORDER BY started_at,migration_name;
ROLLBACK;
