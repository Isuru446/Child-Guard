-- Owner-run metadata only. Does not deploy, grant privileges or read business rows.
\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
DO $$ BEGIN
 IF current_database()<>'childguard_v2'
    OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
    OR inet_server_port() IS DISTINCT FROM 5432
    OR current_setting('transaction_read_only')<>'on'
    OR current_user='childguard_v2_app'
    OR NOT has_table_privilege(current_user,'public."_prisma_migrations"','SELECT')
 THEN RAISE EXCEPTION 'Authorized V2 read-only inspection refused'; END IF;
END $$;
SELECT current_database() AS database,host(inet_server_addr()) AS host,
 inet_server_port() AS port,current_user AS inspector,current_setting('transaction_read_only') AS read_only;
SELECT migration_name,checksum,finished_at IS NOT NULL AS finished,
 rolled_back_at IS NOT NULL AS rolled_back,applied_steps_count
 FROM public."_prisma_migrations" ORDER BY migration_name;
SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
 has_database_privilege(rolname,current_database(),'CONNECT') AS connect,
 has_schema_privilege(rolname,'public','USAGE') AS schema_usage,
 has_schema_privilege(rolname,'public','CREATE') AS schema_create
 FROM pg_roles WHERE rolname='childguard_v2_migrator';
SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,
 has_table_privilege('childguard_v2_app',c.oid,'SELECT') AS app_select,
 has_table_privilege('childguard_v2_app',c.oid,'INSERT') AS app_insert,
 has_table_privilege('childguard_v2_app',c.oid,'UPDATE') AS app_update,
 has_table_privilege('childguard_v2_app',c.oid,'DELETE') AS app_delete
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r'
 AND c.relname IN ('_prisma_migrations','Child','Center','User','AuthorizedPickupPerson','PickupPhoto','PickupRequest')
 ORDER BY c.relname;
SELECT c.relname,k.conname,k.contype,k.convalidated
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN ('AuthorizedPickupPerson','PickupPhoto','PickupRequest') ORDER BY c.relname,k.conname;
SELECT tablename,indexname,indexdef FROM pg_indexes
 WHERE schemaname='public' AND tablename IN ('AuthorizedPickupPerson','PickupPhoto','PickupRequest') ORDER BY tablename,indexname;
ROLLBACK;
