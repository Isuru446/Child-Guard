#include <Arduino.h>
#include <NimBLEDevice.h>
#include <ctype.h>
#if __has_include("bus.private.h")
#include "bus.private.h"
#endif
#ifndef CG_BUS_BEACON_UUID
#define CG_BUS_BEACON_UUID "7b70b001-24a6-4a25-9d3b-21c547a10001"
#endif
// Standalone ESP32-C3, USB power only. No GPIO wiring or child data.
bool ready=false;
void setup(){
 Serial.begin(115200);delay(500);
 if(strlen(CG_BUS_BEACON_UUID)!=36||!strcmp(CG_BUS_BEACON_UUID,"7b700001-24a6-4a25-9d3b-21c547a10001")){Serial.println("BUS_BEACON invalid or Gate identity; advertising disabled");return;}
 for(int i=0;i<36;++i){char c=CG_BUS_BEACON_UUID[i];bool separator=i==8||i==13||i==18||i==23;if(separator?c!='-':!isxdigit((unsigned char)c)||isupper((unsigned char)c)){Serial.println("BUS_BEACON invalid UUID; advertising disabled");return;}}
 if(!NimBLEDevice::init("CG-BUS-BEACON-01"))return;
 auto *ad=NimBLEDevice::getAdvertising();NimBLEAdvertisementData data;
 if(!data.setFlags(0x06)||!data.addServiceUUID(NimBLEUUID(CG_BUS_BEACON_UUID))||!ad->setAdvertisementData(data)||!ad->setConnectableMode(BLE_GAP_CONN_MODE_NON))return;
 ad->enableScanResponse(false);ad->setMinInterval(160);ad->setMaxInterval(240);ready=true;
 Serial.printf("BUS_BEACON advertising=%s uuid=%s\n",ad->start(0)?"yes":"no",CG_BUS_BEACON_UUID);
}
void loop(){delay(1000);if(ready&&!NimBLEDevice::getAdvertising()->isAdvertising())NimBLEDevice::getAdvertising()->start(0);}
