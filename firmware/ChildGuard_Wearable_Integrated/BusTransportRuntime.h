#pragma once
#include "BeaconTracker.h"
#include "BusScanHealth.h"
#if __has_include("bus.private.h")
#include "bus.private.h"
#endif
#ifndef CG_BUS_BEACON_UUID
#define CG_BUS_BEACON_UUID "7b70b001-24a6-4a25-9d3b-21c547a10001"
#endif
namespace busTransport {
using Filter=BeaconTracker<8,6,3>;
Filter filter;
BLEReading packets[16];uint8_t head=0,tail=0;
bool enabled=false;
float entryRssi=-63,exitRssi=-72;
String assignment,epoch,busId,beaconId,pending;
uint32_t sequence=0,lastConfig=0,lastReport=0,pendingAt=0,lastAttempt=0;
BusScanHealth scanHealth;
bool stopped=false;
TaskHandle_t watchTask=nullptr;

bool capture(const NimBLEAdvertisedDevice *device){
 if(!strcmp(CG_BUS_BEACON_UUID,GATE_UUID))return false; // misconfiguration cannot steal Gate scanning
 if(!device->isAdvertisingService(NimBLEUUID(CG_BUS_BEACON_UUID)))return false;
 if(device->isAdvertisingService(NimBLEUUID(GATE_UUID)))return true;
 ZoneConfig configs[MAX_ZONE_BEACONS];
 portENTER_CRITICAL(&bleMux);for(int i=0;i<MAX_ZONE_BEACONS;++i)configs[i]=zoneBeacons[i].config;portEXIT_CRITICAL(&bleMux);
 for(auto &z:configs)if(z.active){
  if(!strcmp(z.uuid,CG_BUS_BEACON_UUID))return false; // let the existing registered zone retain its identity
  if(device->isAdvertisingService(NimBLEUUID(z.uuid)))return true;
 }
 int rssi=device->getRSSI();if(rssi>0||rssi< -127)return true;
 portENTER_CRITICAL(&bleMux);
 // Preserve the latest real contact if HTTP work temporarily delays the consumer.
 // Dropping newest advertisements could otherwise look like beacon absence.
 uint8_t next=(head+1)%16;if(next==tail)tail=(tail+1)%16;
 packets[head]={rssi,millis()};head=next;
 portEXIT_CRITICAL(&bleMux);return true;
}
void scanStopped(){portENTER_CRITICAL(&bleMux);stopped=true;portEXIT_CRITICAL(&bleMux);}
void scanWatch(void *){
 for(;;){
  vTaskDelay(pdMS_TO_TICKS(200));uint32_t now=millis();
  bool scanning=bleScan!=nullptr&&bleScan->isScanning();
  portENTER_CRITICAL(&bleMux);
  scanHealth.sample(now,scanning,stopped);
  stopped=false;portEXIT_CRITICAL(&bleMux);
 }
}
void start(){scanHealth.reset(millis());if(xTaskCreate(scanWatch,"bus-scan-health",2048,nullptr,1,&watchTask)!=pdPASS)Serial.println("BUS_SCAN_HEALTH unavailable; transport remains unconfirmed");}
void poll(){
 uint32_t now=millis();if(WiFi.status()!=WL_CONNECTED||(lastConfig&&now-lastConfig<10000))return;lastConfig=now;
 WiFiClient client;HTTPClient http;
 if(!http.begin(client,String(BACKEND_URL)+"/api/device/transport?deviceId="+DEVICE_ID))return;
 configureRequest(http);int code=http.GET();JsonDocument doc;
 bool valid=code==200&&!deserializeJson(doc,http.getString());http.end();
 if(!valid){enabled=false;return;}
 JsonObject data=doc["data"];
 bool configured=data["enabled"].as<bool>()&&strcmp(data["beaconUuid"]|"",CG_BUS_BEACON_UUID)==0;
 float nextEntry=data["entryRssi"]|-63.0f,nextExit=data["exitRssi"]|-72.0f;
 configured=configured&&!data["entryRssi"].isNull()&&!data["exitRssi"].isNull()&&isfinite(nextEntry)&&isfinite(nextExit)&&nextEntry<=0&&nextExit>=-127&&nextExit<=nextEntry-3;
 String nextAssignment=data["assignmentId"]|"",nextEpoch=data["sessionEpoch"]|"";
 if(nextAssignment!=assignment||nextEpoch!=epoch||configured!=enabled||entryRssi!=nextEntry||exitRssi!=nextExit){
  pending="";filter=Filter{};portENTER_CRITICAL(&bleMux);head=tail=0;scanHealth.reset(millis());portEXIT_CRITICAL(&bleMux);
  Serial.printf("BUS_SESSION configured=%s active=%s\n",configured?"yes":"no",nextEpoch.length()?"yes":"no");
 }
 assignment=nextAssignment;epoch=nextEpoch;busId=data["busId"]|"";beaconId=data["beaconId"]|"";entryRssi=nextEntry;exitRssi=nextExit;enabled=configured;
}
void process(){
 for(int n=0;n<16;++n){
  BLEReading reading;bool available=false;portENTER_CRITICAL(&bleMux);
  if(head!=tail){reading=packets[tail];tail=(tail+1)%16;available=true;}portEXIT_CRITICAL(&bleMux);
  if(!available)break;if(millis()-reading.receivedAt<=4000)filter.sample(reading.rssi,entryRssi,exitRssi,reading.receivedAt);
 }
 if(filter.state!=Filter::UNKNOWN&&millis()-filter.lastSeen>4000)filter.resetSignal();
 uint32_t now=millis();if(now-lastReport<5000)return;lastReport=now;
 portENTER_CRITICAL(&bleMux);auto evidence=scanHealth.take(now,stopped);portEXIT_CRITICAL(&bleMux);
 uint32_t window=evidence.elapsed,healthy=evidence.healthy,gap=evidence.maxGap;
 if(!enabled||!assignment.length())return;
 JsonDocument doc;doc["deviceId"]=DEVICE_ID;doc["deviceBootId"]=deviceBootId;
 doc["sequence"]=++sequence;doc["eventId"]=String(DEVICE_ID)+"-bus-"+deviceBootId+"-"+String(sequence);
 doc["deviceUptimeMs"]=now;doc["assignmentId"]=assignment;doc["sessionEpoch"]=epoch;doc["busId"]=busId;doc["beaconId"]=beaconId;doc["beaconUuid"]=CG_BUS_BEACON_UUID;
 const char *state=filter.state==Filter::NEAR?"NEAR":filter.state==Filter::FAR?"FAR":"UNKNOWN";
 doc["proximity"]=state;if(strcmp(state,"UNKNOWN"))doc["rssi"]=filter.rssi;
 if(filter.lastSeen)doc["lastSeenAgeMs"]=(uint32_t)(now-filter.lastSeen);else doc["lastSeenAgeMs"]=nullptr;
 doc["scanWindowMs"]=min(window,(uint32_t)60000);doc["healthyScanMs"]=min(healthy,min(window,(uint32_t)60000));doc["maxScanGapMs"]=min(gap,(uint32_t)60000);
 doc["scannerHealthy"]=watchTask!=nullptr&&evidence.valid();
 // One latest-report slot: never backdate an offline observation.
 pending="";serializeJson(doc,pending);pendingAt=now;
 Serial.printf("BUS_SCAN proximity=%s healthy=%s window_ms=%lu\n",state,doc["scannerHealthy"].as<bool>()?"yes":"no",(unsigned long)window);
}
void flush(){
 if(!pending.length())return;uint32_t now=millis();
 if(now-pendingAt>2000){pending="";return;}
 if(WiFi.status()!=WL_CONNECTED||(lastAttempt&&now-lastAttempt<500))return;lastAttempt=now;
 WiFiClient client;HTTPClient http;if(!http.begin(client,String(BACKEND_URL)+"/api/device/transport/observations"))return;
 configureRequest(http);http.addHeader("Content-Type","application/json");JsonDocument doc;deserializeJson(doc,pending);doc["queueAgeMs"]=(uint32_t)(millis()-pendingAt);
 String body;serializeJson(doc,body);int code=http.POST(body);JsonDocument response;
 if(code==200&&!deserializeJson(response,http.getString())&&String(response["data"]["eventId"]|"")==String(doc["eventId"]|"")){
  Serial.printf("BUS_REPORT_ACCEPTED state=%s notification=%s\n",response["data"]["state"]|"unknown",response["data"]["notification"]["kind"]|"none");pending="";
 }else if(code==400||code==401||code==409||code==422){Serial.printf("BUS_REPORT_REJECTED HTTP=%d; refresh session\n",code);pending="";lastConfig=0;}
 else Serial.printf("BUS_REPORT_RETRY HTTP=%d; no delivery claimed\n",code);
 http.end();
}
}
