"""Source integration checks only; no hardware, credentials or network access."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
class ReaderIntegration(unittest.TestCase):
 def test_hardware_and_network_safeguards(self):
  source=(ROOT/'ChildGuard_RFID_Reader/ChildGuard_RFID_Reader.ino').read_text()
  self.assertIn('SS_PIN=7,SCK_PIN=4,MOSI_PIN=6,MISO_PIN=5,RST_PIN=3',source)
  self.assertIn('SPI.begin(SCK_PIN,MISO_PIN,MOSI_PIN,SS_PIN)',source)
  self.assertIn('PCD_PerformSelfTest()',source)
  self.assertIn('HTTPC_DISABLE_FOLLOW_REDIRECTS',source)
  self.assertIn('secure.setCACert(RFID_ROOT_CA)',source)
  self.assertNotIn('.setInsecure(',source)
  self.assertIn('RFID_ALLOW_TRUSTED_LAN_HTTP',source)
  self.assertIn('size>2048',source)
  self.assertIn('xQueueCreate(4,sizeof(ScanJob))',source)
  self.assertIn('uint32_t(millis()-job.atMs)>5000',source)
  self.assertIn('job.eventId',source)
  self.assertNotIn('Serial.println(job.uid)',source)
  self.assertNotIn('Serial.println(RFID_READER_TOKEN)',source)
 def test_no_wearable_or_beacon_dependency(self):
  source=(ROOT/'ChildGuard_RFID_Reader/ChildGuard_RFID_Reader.ino').read_text()
  self.assertNotIn('X-Device-Token',source);self.assertNotIn('childId',source);self.assertNotIn('centerId',source)
  self.assertIn('/api/v1/rfid-reader/scans',source)
  self.assertIn('ENROLLMENT_SUCCESS',source);self.assertIn('ALREADY_PRESENT',source)
if __name__=='__main__':unittest.main()
