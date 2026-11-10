"""Source-level advertisement contract checks; no claim of compilation or radio testing."""
from pathlib import Path
import re
import unittest

root = Path(__file__).resolve().parents[1]
beacon = (root / 'ChildGuard_Beacon/ChildGuard_Beacon.ino').read_text()
wearable = (root / 'ChildGuard_Wearable_Integrated/ChildGuard_Wearable_Integrated.ino').read_text()
zones = (root / 'ChildGuard_Wearable_Integrated/MultiBeaconRuntime.h').read_text()
backend = (root.parent / 'backend/src/beacons.js').read_text()


class BeaconContract(unittest.TestCase):
    def test_gate_identity_matches_wearable_and_backend(self):
        for value in ['CG-GATE-01', '7b700001-24a6-4a25-9d3b-21c547a10001']:
            for source in [beacon, wearable, backend]:
                self.assertIn(value, source)
        self.assertIn('const char *BEACON_ID = GATE_ID;', beacon)
        self.assertIn('const char *BEACON_SERVICE_UUID = GATE_SERVICE_UUID;', beacon)

    def test_selected_role_is_explicit_and_danger_zone_config_is_not_gate_identity(self):
        self.assertRegex(beacon, r'#define CHILDGUARD_BEACON_ROLE CHILDGUARD_ROLE_(?:GATE|DANGER_ZONE)\b')
        danger = beacon.split('#elif CHILDGUARD_BEACON_ROLE == CHILDGUARD_ROLE_DANGER_ZONE')[1].split('#else')[0]
        identity = re.search(r'const char \*BEACON_ID = "([^"]*)";', danger).group(1)
        service = re.search(r'const char \*BEACON_SERVICE_UUID = "([^"]*)";', danger).group(1)
        self.assertNotEqual(identity, 'CG-GATE-01')
        self.assertNotEqual(service, '7b700001-24a6-4a25-9d3b-21c547a10001')
        self.assertLess(beacon.index('if(!validBeaconConfiguration())'), beacon.index('NimBLEDevice::init('))

    def test_danger_zone_cannot_reuse_gate_identity(self):
        self.assertIn('!strcmp(BEACON_ID,GATE_ID)', beacon)
        self.assertIn('!strcmp(BEACON_SERVICE_UUID,GATE_SERVICE_UUID)', beacon)
        self.assertIn('isupper((unsigned char)c)', beacon)
        self.assertIn('length == 0 || length > 48', beacon)

    def test_primary_payload_is_one_uuid_and_flags_only(self):
        self.assertEqual(beacon.count('data.addServiceUUID('), 1)
        self.assertIn('data.setFlags(0x06)', beacon)
        self.assertIn('setAdvertisementData(data)', beacon)
        self.assertNotRegex(beacon, r'\b(?:setName|setManufacturerData|setServiceData)\(')
        # AD length + type + flags, then AD length + type + 16-byte UUID.
        self.assertLessEqual((1 + 1 + 1) + (1 + 1 + 16), 31)
        self.assertIn('enableScanResponse(false)', beacon)

    def test_passive_wearable_matches_service_not_name(self):
        self.assertIn('setActiveScan(false)', wearable)
        self.assertIn('device->isAdvertisingService(', wearable)
        self.assertIn('device->isAdvertisingService(NimBLEUUID(snapshot[i].uuid))', zones)
        self.assertNotIn('device->getName(', wearable + zones)

    def test_continuous_advertising_and_stopped_advertising_retry(self):
        self.assertIn('getAdvertising()->start(0)', beacon)
        self.assertIn('advertisingReady && !NimBLEDevice::getAdvertising()->isAdvertising()', beacon)
        self.assertIn('BEACON_ADVERTISING_RESTART', beacon)
        self.assertIn('BEACON_ADVERTISING role=%s id=%s uuid=%s', beacon)
        self.assertIn('setMinInterval(160)', beacon)
        self.assertIn('setMaxInterval(240)', beacon)

    def test_no_network_or_usb_wait_dependency(self):
        includes = re.findall(r'#include\s+[<"]([^>"]+)', beacon)
        self.assertEqual(includes, ['Arduino.h', 'NimBLEDevice.h', 'ctype.h'])
        self.assertNotRegex(beacon, r'\b(?:WiFi|HTTPClient|secrets|createServer)\b')
        self.assertNotRegex(beacon, r'while\s*\(\s*!Serial')

    def test_config_accepts_chunked_body_and_keeps_validation_bounds(self):
        self.assertNotIn('http.getSize()<0', zones)
        self.assertIn('declaredLength>8192', zones)
        self.assertIn('response.length()>8192', zones)
        self.assertIn('gates!=1', zones)
        self.assertIn('BEACON_CONFIG_APPLIED count=', zones)
        self.assertIn('BEACON_UUID_MATCH id=', zones)
        self.assertIn('BEACON_SCAN_STATUS id=', zones)


if __name__ == '__main__':
    unittest.main()
