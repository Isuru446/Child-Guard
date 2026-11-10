ALTER TABLE "DeviceEvent" DROP CONSTRAINT "known_event_type";
ALTER TABLE "DeviceEvent" ADD CONSTRAINT "known_event_type" CHECK ("eventType" IN ('CHILD_NEAR_GATE','GPS_STATUS','ACTIVITY_WINDOW','DANGER_ZONE_NEAR','DANGER_ZONE_EXIT','BEACON_SIGNAL_LOST','ACTIVITY_SAMPLE_GAP','BLE_PROXIMITY'));
CREATE INDEX "DeviceEvent_deviceId_eventType_receivedAt_idx" ON "DeviceEvent" ("deviceId", "eventType", "receivedAt");
