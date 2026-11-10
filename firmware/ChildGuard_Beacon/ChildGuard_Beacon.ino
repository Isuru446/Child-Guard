#include <Arduino.h>
#include <NimBLEDevice.h>
#include <ctype.h>
// Select ONE role for each physical board. Only one board may use the gate identity.
#define CHILDGUARD_ROLE_GATE 1
#define CHILDGUARD_ROLE_DANGER_ZONE 2
#ifndef CHILDGUARD_BEACON_ROLE
#define CHILDGUARD_BEACON_ROLE CHILDGUARD_ROLE_GATE
#endif

const char *GATE_ID = "CG-GATE-01";
const char *GATE_SERVICE_UUID = "7b700001-24a6-4a25-9d3b-21c547a10001";
#if CHILDGUARD_BEACON_ROLE == CHILDGUARD_ROLE_GATE
const char *BEACON_ROLE = "GATE";
const char *BEACON_ID = GATE_ID;
const char *BEACON_SERVICE_UUID = GATE_SERVICE_UUID;
#elif CHILDGUARD_BEACON_ROLE == CHILDGUARD_ROLE_DANGER_ZONE
const char *BEACON_ROLE = "DANGER_ZONE";
// Copy this board's hardware ID and lowercase service UUID from its Admin registration.
// Intentionally blank: no invented/shared danger-zone identity is broadcast.
const char *BEACON_ID = "DG-zone1";
const char *BEACON_SERVICE_UUID = "a4ee29a2-1c0c-417b-919e-1a969830494f";
#else
#error "Select CHILDGUARD_ROLE_GATE or CHILDGUARD_ROLE_DANGER_ZONE"
#endif

bool advertisingReady = false;

bool validBeaconConfiguration() {
  size_t length = strlen(BEACON_ID);
  if(length == 0 || length > 48) return false;
  for(size_t i=0;i<length;++i)
    if(!isalnum((unsigned char)BEACON_ID[i]) && BEACON_ID[i]!='_' && BEACON_ID[i]!='-') return false;
  if(strlen(BEACON_SERVICE_UUID)!=36) return false;
  bool nonzero=false;
  for(int i=0;i<36;++i){
    char c=BEACON_SERVICE_UUID[i];
    bool separator=i==8||i==13||i==18||i==23;
    if(separator){if(c!='-')return false;}
    else{
      if(!isxdigit((unsigned char)c)||isupper((unsigned char)c))return false;
      if(c!='0')nonzero=true;
    }
  }
  if(!nonzero)return false;
  if(CHILDGUARD_BEACON_ROLE==CHILDGUARD_ROLE_DANGER_ZONE &&
     (!strcmp(BEACON_ID,GATE_ID)||!strcmp(BEACON_SERVICE_UUID,GATE_SERVICE_UUID))) return false;
  return true;
}

void startBeaconAdvertising() {
  // Explicit zero duration means continuous advertising in NimBLE-Arduino 2.x.
  if(NimBLEDevice::getAdvertising()->start(0)) {
    Serial.printf("BEACON_ADVERTISING role=%s id=%s uuid=%s interval=100-150ms\n",BEACON_ROLE,BEACON_ID,BEACON_SERVICE_UUID);
  } else Serial.println("BEACON_ADVERTISING_FAILED: retry in 1s");
}

void setup() {
  Serial.begin(115200);
  delay(500); // Bounded USB startup; advertising never waits for an open Serial Monitor.
  if(!validBeaconConfiguration()){
    Serial.println("BEACON_CONFIG_ERROR: set a unique ID (1-48 letters/digits/_/-) and lowercase UUID; danger zones cannot use gate identity");
    return;
  }
  if(!NimBLEDevice::init(BEACON_ID)){
    Serial.println("BEACON_BLE_INIT_FAILED: reset and check board/core/library");return;
  }
  auto *advertising=NimBLEDevice::getAdvertising();
  // Legacy primary advertising data: flags (3 bytes) + one 128-bit UUID (18 bytes).
  // No name or scan-response dependency: compatible with passive wearable scanning.
  NimBLEAdvertisementData data;
  if(!data.setFlags(0x06)||!data.addServiceUUID(NimBLEUUID(BEACON_SERVICE_UUID))||!advertising->setAdvertisementData(data)){
    Serial.println("BEACON_ADVERTISEMENT_INVALID");return;
  }
  if(!advertising->setConnectableMode(BLE_GAP_CONN_MODE_NON)){
    Serial.println("BEACON_ADVERTISEMENT_INVALID: connectable mode");return;
  }
  advertising->enableScanResponse(false);
  advertising->setMinInterval(160); // 100 ms (units of 0.625 ms)
  advertising->setMaxInterval(240); // 150 ms
  advertisingReady=true;
  startBeaconAdvertising();
}
void loop(){
  delay(1000);
  if(advertisingReady && !NimBLEDevice::getAdvertising()->isAdvertising()){
    Serial.println("BEACON_ADVERTISING_RESTART");startBeaconAdvertising();
  }
}
