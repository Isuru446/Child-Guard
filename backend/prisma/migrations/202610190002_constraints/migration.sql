CREATE UNIQUE INDEX "Assignment_current_device" ON "Assignment" ("deviceId") WHERE "endedAt" IS NULL;
CREATE UNIQUE INDEX "Assignment_current_child" ON "Assignment" ("childId") WHERE "endedAt" IS NULL;
ALTER TABLE "Assignment" ADD CONSTRAINT "assignment_time_order" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");
ALTER TABLE "Device" ADD CONSTRAINT "device_token_hash_length" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "DeviceEvent" ADD CONSTRAINT "device_uptime_uint32" CHECK ("deviceUptimeMs" BETWEEN 0 AND 4294967295);
ALTER TABLE "DeviceEvent" ADD CONSTRAINT "known_event_type" CHECK ("eventType" IN ('CHILD_NEAR_GATE','GPS_STATUS','ACTIVITY_WINDOW','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST','ACTIVITY_SAMPLE_GAP'));
ALTER TABLE "Attendance" ADD CONSTRAINT "attendance_day_format" CHECK (day ~ '^\d{4}-\d{2}-\d{2}$');
CREATE FUNCTION enforce_assignment_center() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT "centerId" FROM "Device" WHERE id = NEW."deviceId") IS DISTINCT FROM (SELECT "centerId" FROM "Child" WHERE id = NEW."childId") THEN
  RAISE EXCEPTION 'Assignment must belong to one center';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_center BEFORE INSERT OR UPDATE ON "Assignment" FOR EACH ROW EXECUTE FUNCTION enforce_assignment_center();
