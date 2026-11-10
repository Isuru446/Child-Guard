-- Run only against childguard_v2 as the existing table owner
-- (childguard_v2_migrator), after the owner's normal backup procedure.
-- Narrow repair only; do not deploy other pending Prisma migrations.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$
DECLARE definition text;
BEGIN
 IF current_database() <> 'childguard_v2' THEN
  RAISE EXCEPTION 'This repair is restricted to childguard_v2';
 END IF;
 SELECT pg_get_constraintdef(oid) INTO STRICT definition
 FROM pg_constraint WHERE conrelid='public."DeviceEvent"'::regclass
 AND conname='known_event_type' AND contype='c';
 -- Retain the existing expression verbatim; extend only its allowed values.
 EXECUTE 'ALTER TABLE public."DeviceEvent" DROP CONSTRAINT "known_event_type", '
  || 'ADD CONSTRAINT "known_event_type" CHECK (('
  || substring(definition from 8 for length(definition)-8)
  || ') OR "eventType" IN (''TAMPER_LOOP_OPEN'',''TAMPER_LOOP_RESTORED'',''TAMPER_LOOP_STATUS''))';
END $$;
COMMIT;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid='public."DeviceEvent"'::regclass
AND conname='known_event_type';
