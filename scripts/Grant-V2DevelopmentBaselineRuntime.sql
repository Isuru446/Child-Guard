-- PREPARED ONLY. Separate runtime-grant approval required; never called by deploy runner.
-- psql -X, explicit 127.0.0.1:5432/childguard_v2, childguard_v2_migrator, private -W prompt.
-- Run the independent baseline verifier immediately beforehand in the maintenance window.
\set ON_ERROR_STOP on
\prompt 'Type GRANT CHILDGUARD V2 DEVELOPMENT RUNTIME after separate approval: ' grant_confirmation
SELECT :'grant_confirmation' = 'GRANT CHILDGUARD V2 DEVELOPMENT RUNTIME' AS grant_approved \gset
\if :grant_approved
\else
  \quit 1
\endif

BEGIN;
DO $$
DECLARE a record;
BEGIN
  IF current_database() IS DISTINCT FROM 'childguard_v2'
     OR current_user IS DISTINCT FROM 'childguard_v2_migrator'
     OR session_user IS DISTINCT FROM 'childguard_v2_migrator'
     OR current_schema() IS DISTINCT FROM 'public'
     OR host(inet_server_addr()) IS DISTINCT FROM '127.0.0.1'
     OR inet_server_port() IS DISTINCT FROM 5432
     OR current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999
  THEN RAISE EXCEPTION 'Runtime grant admission refused'; END IF;
  SELECT * INTO STRICT a FROM pg_catalog.pg_roles WHERE rolname = current_user;
  IF a.rolsuper OR a.rolcreatedb OR a.rolcreaterole OR a.rolreplication OR a.rolbypassrls
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = a.oid)
  THEN RAISE EXCEPTION 'Runtime grant admission refused'; END IF;
  SELECT * INTO STRICT a FROM pg_catalog.pg_roles WHERE rolname = 'childguard_v2_app';
  IF a.rolsuper OR a.rolcreatedb OR a.rolcreaterole OR a.rolreplication OR a.rolbypassrls
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = a.oid)
     OR has_schema_privilege(a.oid,'public','CREATE')
     OR NOT has_schema_privilege(a.oid,'public','USAGE')
     OR has_database_privilege(a.oid,current_database(),'CREATE')
  THEN RAISE EXCEPTION 'Runtime grant admission refused'; END IF;
  IF (SELECT count(*) FROM public._prisma_migrations) <> 7 OR
     (SELECT count(*) FROM public._prisma_migrations m JOIN (VALUES
       ('202610190001_phase1','558509edb058d17c39d59eb25b00e8d494986c8f48bbb792e7c29b707af5990f'),
       ('202610190002_constraints','ec07e4d242b912c03712c5f7f67081da1c938d2d7d1658c15c5be7932f90cd07'),
       ('202610210001_ble_proximity','78b9537d308fb1e919f0446d97f3571c53182f181bce6659657a0af0d33ec3f4'),
       ('202610220001_multi_beacon','524aa22cfac44a7434ac900feeac2ae9262230505e96ce10d6cd125cd1d102c7'),
       ('202610230001_personal_activity','6bd9b95f2c5b707ca6a6c83b4c4fbe5b4eeeb0db5c6dfb13278283297bc0c527'),
       ('202610240001_registration_review','ffc15c752473e5e7ac064a3c4429eb29b3b9b87cc30f3ec18de9884f2ea8fed4'),
       ('202610240002_registration_invariants','d7aad501eff8c74c82842a0042bb32bb57d9ff54435cebe020c949990ef517a0')
     ) expected(name,checksum) ON m.migration_name = expected.name AND lower(m.checksum) = expected.checksum
     WHERE m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL AND m.applied_steps_count = 1) <> 7
     OR (SELECT count(DISTINCT migration_name) FROM public._prisma_migrations) <> 7
  THEN RAISE EXCEPTION 'Runtime grant admission refused'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) <> 'childguard_v2_migrator')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) <> 'childguard_v2_migrator')
  THEN RAISE EXCEPTION 'Runtime grant admission refused'; END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Runtime grant admission refused; details withheld';
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."Center", public."User", public."Child", public."Guardian", public."Device",
  public."Assignment", public."Beacon", public."DeviceEvent", public."Attendance",
  public."Observation", public."Confirmation", public."Alert", public."AuditLog",
  public."ActivityPolicy", public."ActivityAttendanceSession", public."ActivityBoot",
  public."ActivitySummary", public."ActivityInterval", public."ActivityDaily",
  public."UserProfile", public."CenterInvitation", public."RegistrationApplication",
  public."RegistrationDecision", public."EnrollmentRequest", public."DeviceClaimCode",
  public."WearableRequest", public."PrivatePhoto" TO childguard_v2_app;
GRANT USAGE ON TYPE public."Role", public."AttendanceStatus", public."ReviewStatus" TO childguard_v2_app;
GRANT EXECUTE ON FUNCTION public.enforce_assignment_center() TO childguard_v2_app;
REVOKE ALL ON FUNCTION public.enforce_assignment_center() FROM PUBLIC;
REVOKE ALL ON TABLE public._prisma_migrations FROM PUBLIC, childguard_v2_app, childguard_v2_test_app;

DO $$
BEGIN
  IF has_schema_privilege('childguard_v2_app','public','CREATE')
     OR has_database_privilege('childguard_v2_app',current_database(),'CREATE')
     OR has_table_privilege('childguard_v2_app','public._prisma_migrations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR has_any_column_privilege('childguard_v2_app','public._prisma_migrations','SELECT,INSERT,UPDATE,REFERENCES')
     OR NOT has_function_privilege('childguard_v2_app','public.enforce_assignment_center()','EXECUTE')
     OR NOT has_type_privilege('childguard_v2_app','public."Role"','USAGE')
     OR NOT has_type_privilege('childguard_v2_app','public."AttendanceStatus"','USAGE')
     OR NOT has_type_privilege('childguard_v2_app','public."ReviewStatus"','USAGE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
         AND (has_table_privilege('childguard_v2_app',c.oid,'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR
              NOT (has_table_privilege('childguard_v2_app',c.oid,'SELECT') AND
                   has_table_privilege('childguard_v2_app',c.oid,'INSERT') AND
                   has_table_privilege('childguard_v2_app',c.oid,'UPDATE') AND
                   has_table_privilege('childguard_v2_app',c.oid,'DELETE'))))
  THEN RAISE EXCEPTION 'Runtime privilege post-check refused; transaction must roll back'; END IF;
END;
$$;
COMMIT;
