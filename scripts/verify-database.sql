\set ON_ERROR_STOP on
BEGIN READ ONLY;
SELECT current_database() AS database, version() AS server;
SELECT current_user AS application_role, inet_server_addr() AS host, inet_server_port() AS port;
SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='childguard_test') AS isolated_test_database_exists;
SELECT role, count(*) FROM "User" GROUP BY role ORDER BY role;
SELECT migration_name, checksum FROM "_prisma_migrations" ORDER BY migration_name;
SELECT has_database_privilege(current_user,current_database(),'CONNECT') AS can_connect,
       has_schema_privilege(current_user,'public','USAGE') AS schema_usage;
SELECT tablename,
       has_table_privilege(current_user,format('%I.%I',schemaname,tablename),'SELECT') AS can_select,
       has_table_privilege(current_user,format('%I.%I',schemaname,tablename),'INSERT') AS can_insert,
       has_table_privilege(current_user,format('%I.%I',schemaname,tablename),'UPDATE') AS can_update,
       has_table_privilege(current_user,format('%I.%I',schemaname,tablename),'DELETE') AS can_delete
FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
SELECT count(*) AS user_triggers FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal;
-- Counts only: never select private account, child, token or event payload values.
SELECT format('SELECT %L AS table_name, count(*) AS rows FROM %I.%I;', tablename, schemaname, tablename)
FROM pg_tables WHERE schemaname='public' ORDER BY tablename
\gexec
SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
FROM "_prisma_migrations" ORDER BY migration_name;
SELECT count(*) AS foreign_keys,
       count(*) FILTER (WHERE NOT convalidated) AS unvalidated_foreign_keys
FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace;
SELECT count(*) AS invalid_indexes FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND NOT i.indisvalid;
SELECT count(*) AS assignment_center_mismatches FROM "Assignment" a
JOIN "Device" d ON d.id=a."deviceId" JOIN "Child" c ON c.id=a."childId"
WHERE c."centerId"<>d."centerId";
SELECT count(*) AS guardian_center_mismatches FROM "Guardian" g
JOIN "User" u ON u.id=g."userId" JOIN "Child" c ON c.id=g."childId"
WHERE c."centerId"<>u."centerId";
SELECT count(*) AS duplicate_current_assignments FROM
(SELECT "deviceId" FROM "Assignment" WHERE "endedAt" IS NULL GROUP BY "deviceId" HAVING count(*)>1) x;
SELECT count(*) AS duplicate_child_assignments FROM
(SELECT "childId" FROM "Assignment" WHERE "endedAt" IS NULL GROUP BY "childId" HAVING count(*)>1) x;
SELECT status, count(*) FROM "Attendance" GROUP BY status ORDER BY status;
SELECT kind, count(*) FROM "Alert" GROUP BY kind ORDER BY kind;
SELECT "sensorStatus", eligible, count(*) FROM "ActivitySummary" GROUP BY "sensorStatus", eligible;
SELECT 'missing model table' AS issue, model FROM unnest(ARRAY[
'Center','User','Child','Guardian','Device','Assignment','Beacon','DeviceEvent','Attendance','Observation',
'Confirmation','Alert','AuditLog','ActivityPolicy','ActivityAttendanceSession','ActivityBoot','ActivitySummary','ActivityInterval','ActivityDaily'
]) model WHERE to_regclass(format('public.%I',model)) IS NULL;
COMMIT;
