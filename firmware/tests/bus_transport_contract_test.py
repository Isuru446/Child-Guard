"""Source-contract checks only; compile-time health tests are in bus_scan_health_test.cpp."""
from pathlib import Path
import unittest

root = Path(__file__).resolve().parents[2]
wearable = (root/'firmware/ChildGuard_Wearable_Integrated/ChildGuard_Wearable_Integrated.ino').read_text()
bus = (root/'firmware/ChildGuard_Wearable_Integrated/BusTransportRuntime.h').read_text()
beacon = (root/'firmware/ChildGuard_Bus_Beacon/ChildGuard_Bus_Beacon.ino').read_text()
backend = (root/'backend/src/bus-transport.js').read_text()

class BusContract(unittest.TestCase):
    def test_same_explicit_distinct_identity_across_all_layers(self):
        identity = '7b70b001-24a6-4a25-9d3b-21c547a10001'
        for source in [bus, beacon, backend]:
            self.assertIn(identity, source)
        self.assertNotEqual(identity, '7b700001-24a6-4a25-9d3b-21c547a10001')

    def test_preserves_gate_zone_and_bus_routes_and_separate_filters(self):
        self.assertIn('if(busTransport::capture(device)) return;', wearable)
        self.assertIn('if(captureZoneAdvertisement(device)) return;', wearable)
        self.assertIn('static const NimBLEUUID gateUUID', wearable)
        self.assertIn('using Filter=BeaconTracker<8,6,3>', bus)
        self.assertIn('filter.sample(reading.rssi,entryRssi,exitRssi,reading.receivedAt)', bus)
        self.assertIn('if(!strcmp(CG_BUS_BEACON_UUID,GATE_UUID))return false', bus)

    def test_health_is_observed_separately_from_signal_and_wifi(self):
        self.assertIn('bleScan->isScanning()', bus)
        self.assertIn('vTaskDelay(pdMS_TO_TICKS(200))', bus)
        self.assertIn('scanHealth.sample(now,scanning,stopped)', bus)
        self.assertIn('busTransport::scanStopped()', wearable)
        self.assertIn('evidence.valid()', bus)

    def test_bounded_fresh_authenticated_reports_not_synthetic_safety_events(self):
        self.assertIn('packets[16]', bus)
        self.assertIn('if(next==tail)tail=(tail+1)%16', bus)
        self.assertIn('now-pendingAt>2000', bus)
        self.assertIn('configureRequest(http)', bus)
        self.assertIn('/api/device/transport/observations', bus)
        self.assertNotIn('DANGER_ZONE_NEAR', bus)
        self.assertNotIn('CHILD_NEAR_GATE', bus)
        self.assertNotIn('delay(', bus)

    def test_beacon_needs_no_peripheral_and_uses_passive_scan_compatible_advertising(self):
        self.assertIn('data.addServiceUUID', beacon)
        self.assertIn('enableScanResponse(false)', beacon)
        self.assertIn('ad->start(0)', beacon)
        self.assertNotIn('pinMode(', beacon)
        self.assertNotIn('WiFi', beacon)
        self.assertNotIn('DEVICE_TOKEN', beacon)

if __name__ == '__main__':
    unittest.main()
