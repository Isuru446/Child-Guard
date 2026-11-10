#pragma once
#include "BeaconTracker.h"
#include "LatencyTrace.h"
#include "TelemetrySchedule.h"
#include <ctype.h>

bool hasFreshGateState();
const char *gpsStatus();
void configureRequest(HTTPClient &http);
void resetBLEFilter();

constexpr int MAX_ZONE_BEACONS=7; // Plus the existing gate = 8; backend enforces the same cap.
constexpr int ZONE_PACKET_CAPACITY=8;
constexpr unsigned long CONFIG_TTL_MS=300000;
struct ZoneConfig {
  char id[49]={};
  char uuid[37]={};
  float entry=-63,exit=-69;
  bool active=false;
};
using ZoneFilter=BeaconTracker<BLE_RSSI_WINDOW,BLE_MIN_READINGS,BLE_CONFIRM_READINGS>;
struct ZoneRuntime {
  ZoneConfig config;
  BLEReading packets[ZONE_PACKET_CAPACITY];
  uint8_t head=0,tail=0;
  ZoneFilter filter;
  String pendingBLE,pendingFAR,pendingNear,pendingDanger,lastState,eligibility,lastDangerDecision;
  unsigned long nearAt=0;
  unsigned long farAt=0;
  bool approachArmed=false;
  unsigned long bleAt=0,dangerAt=0,lastReport=0;
  unsigned long nearConfirmedAt=0;
  unsigned long matchedPackets=0,droppedPackets=0,lastRadioReport=0;
  bool matchLogged=false;
};
ZoneRuntime zoneBeacons[MAX_ZONE_BEACONS];
unsigned long lastConfigAttempt=0,lastConfigSuccess=0;
bool haveBeaconConfig=false,configWasConnected=false,configStaleLogged=false;
String beaconConfigRevision="";
unsigned long zoneDroppedPackets=0;
bool preferZoneBatch=true;

bool validBeaconIdentifier(const char *id) {
  if(!strlen(id)||strlen(id)>48) return false;
  for(size_t i=0;id[i];++i) if(!isalnum((unsigned char)id[i])&&id[i]!='_'&&id[i]!='-') return false;
  return true;
}
bool validBeaconUuid(const char *uuid) {
  if(strlen(uuid)!=36) return false;
  for(int i=0;i<36;++i) {
    if(i==8||i==13||i==18||i==23){if(uuid[i]!='-') return false;}
    else if(!isxdigit((unsigned char)uuid[i]) || isupper((unsigned char)uuid[i])) return false;
  }
  return true;
}
bool zonesConfigFresh(){return haveBeaconConfig && millis()-lastConfigSuccess<=CONFIG_TTL_MS;}

// Called from NimBLE's task. No HTTP, JSON or filtering here. Each zone has its own ring.
bool captureZoneAdvertisement(const NimBLEAdvertisedDevice *device) {
  ZoneConfig snapshot[MAX_ZONE_BEACONS];
  portENTER_CRITICAL(&bleMux);
  for(int i=0;i<MAX_ZONE_BEACONS;++i) snapshot[i]=zoneBeacons[i].config;
  portEXIT_CRITICAL(&bleMux);
  int rssi=device->getRSSI();if(rssi>0 || rssi< -127) return true;
  // Reject ambiguous advertisements containing more than one registered identity.
  int matched=-1;
  bool matchesGate=device->isAdvertisingService(NimBLEUUID(GATE_UUID));
  for(int i=0;i<MAX_ZONE_BEACONS;++i) if(snapshot[i].active && device->isAdvertisingService(NimBLEUUID(snapshot[i].uuid))) {
    if(matched>=0 || matchesGate) return true;
    matched=i;
  }
  if(matched<0) return false;
  unsigned long now=millis();
  portENTER_CRITICAL(&bleMux);
  auto &z=zoneBeacons[matched];
  if(z.config.active && strcmp(z.config.uuid,snapshot[matched].uuid)==0) {
    ++z.matchedPackets;
    uint8_t next=(z.head+1)%ZONE_PACKET_CAPACITY;
    if(next!=z.tail){z.packets[z.head]={rssi,now};z.head=next;}
    else {++zoneDroppedPackets;++z.droppedPackets;}
  }
  portEXIT_CRITICAL(&bleMux);
  return true;
}

void pollBeaconConfiguration() {
  bool connected=WiFi.status()==WL_CONNECTED;
  bool recovered=connected&&!configWasConnected;configWasConnected=connected;
  if(!connected) return;
  unsigned long now=millis();
  if(!recovered && lastConfigAttempt && now-lastConfigAttempt<60000) return;
  lastConfigAttempt=now;
  WiFiClient client;HTTPClient http;
  if(!http.begin(client,String(BACKEND_URL)+"/api/device/beacons?deviceId="+DEVICE_ID)){Serial.println("BEACON_CONFIG_HTTP_BEGIN_FAILED");return;}
  configureRequest(http);
  int code=http.GET();
  int declaredLength=http.getSize();
  if(code!=200 || declaredLength>8192){Serial.print("BEACON_CONFIG_RETRY HTTP ");Serial.println(code);if(code!=200)logBackendError(http,code);http.end();return;}
  // A valid HTTP response can be chunked (getSize() == -1). HTTPClient decodes it.
  String response=http.getString();http.end();
  if(response.length()>8192){Serial.println("BEACON_CONFIG_INVALID: response too large");return;}
  Serial.printf("BEACON_CONFIG_RESPONSE HTTP=%d declared=%d bytes=%u\n",code,declaredLength,(unsigned)response.length());
  JsonDocument doc;auto error=deserializeJson(doc,response);
  if(error){Serial.print("BEACON_CONFIG_JSON_ERROR ");Serial.println(error.c_str());return;}
  JsonArray list=doc["data"]["beacons"].as<JsonArray>();
  const char *revision=doc["data"]["revision"]|"";
  if(list.isNull() || list.size()>8 || strlen(revision)!=64 || doc["data"]["validForMs"].as<unsigned long>()!=CONFIG_TTL_MS){Serial.println("BEACON_CONFIG_INVALID: envelope/revision/TTL");return;}
  ZoneConfig incoming[MAX_ZONE_BEACONS];int count=0,gates=0;
  float gateEntry=dangerEntryRSSI,gateExit=dangerExitRSSI,gateAttendance=attendanceRSSI;
  bool valid=true;
  for(JsonObject b:list){
    const char *id=b["beaconId"]|"",*uuid=b["serviceUuid"]|"",*kind=b["kind"]|"";
    if(!validBeaconIdentifier(id)||!validBeaconUuid(uuid)||!b["entryRssi"].is<float>()||!b["exitRssi"].is<float>()){valid=false;break;}
    float entry=b["entryRssi"],exit=b["exitRssi"];
    if(!isfinite(entry)||!isfinite(exit)||entry>0||exit< -127||exit>entry-3){valid=false;break;}
    if(strcmp(kind,"GATE")==0){
      if(strcmp(id,GATE_ID)||strcmp(uuid,GATE_UUID)||!b["attendanceRssi"].is<float>()){valid=false;break;}
      gateEntry=entry;gateExit=exit;gateAttendance=b["attendanceRssi"];
      if(!isfinite(gateAttendance)||gateAttendance<entry||gateAttendance>0){valid=false;break;}++gates;
    } else if(strcmp(kind,"DANGER_ZONE")==0 && count<MAX_ZONE_BEACONS && strcmp(id,GATE_ID) && strcmp(uuid,GATE_UUID)) {
      for(int j=0;j<count;++j) if(!strcmp(incoming[j].id,id)||!strcmp(incoming[j].uuid,uuid)) valid=false;
      if(!valid) break;
      auto &c=incoming[count++];strlcpy(c.id,id,sizeof(c.id));strlcpy(c.uuid,uuid,sizeof(c.uuid));c.entry=entry;c.exit=exit;c.active=true;
    } else {valid=false;break;}
  }
  if(!valid || gates!=1){Serial.println("BEACON_CONFIG_INVALID: identity/kind/thresholds/gate count");return;}
  bool recoveringStale=!zonesConfigFresh();
  bool keep[MAX_ZONE_BEACONS]={};
  for(int i=0;i<MAX_ZONE_BEACONS;++i) for(int j=0;j<count;++j) if(zoneBeacons[i].config.active && !strcmp(zoneBeacons[i].config.id,incoming[j].id) && !strcmp(zoneBeacons[i].config.uuid,incoming[j].uuid)) keep[i]=true;
  for(int i=0;i<MAX_ZONE_BEACONS;++i) if(!keep[i]) {
    portENTER_CRITICAL(&bleMux);zoneBeacons[i].config.active=false;zoneBeacons[i].head=zoneBeacons[i].tail=0;zoneBeacons[i].matchedPackets=zoneBeacons[i].droppedPackets=0;portEXIT_CRITICAL(&bleMux);
    zoneBeacons[i].matchLogged=false;zoneBeacons[i].lastRadioReport=0;
    auto &z=zoneBeacons[i];z.filter=ZoneFilter{};z.pendingBLE="";z.pendingFAR="";z.pendingNear="";z.approachArmed=false;z.pendingDanger="";z.lastState="";z.eligibility="";z.lastReport=0;
  }
  for(int j=0;j<count;++j){
    int slot=-1;
    for(int i=0;i<MAX_ZONE_BEACONS;++i) if(zoneBeacons[i].config.active&&!strcmp(zoneBeacons[i].config.id,incoming[j].id)) slot=i;
    if(slot<0) for(int i=0;i<MAX_ZONE_BEACONS;++i) if(!zoneBeacons[i].config.active){slot=i;break;}
    auto &z=zoneBeacons[slot];
    bool changed=!z.config.active || z.config.entry!=incoming[j].entry || z.config.exit!=incoming[j].exit;
    if(changed||recoveringStale){z.filter.resetSignal();z.pendingBLE="";z.pendingFAR="";z.pendingNear="";z.approachArmed=false;z.pendingDanger="";z.lastState="";z.lastReport=0;}
    portENTER_CRITICAL(&bleMux);z.config=incoming[j];if(changed||recoveringStale) z.head=z.tail=0;portEXIT_CRITICAL(&bleMux);
  }
  if(gateEntry!=dangerEntryRSSI || gateExit!=dangerExitRSSI || gateAttendance!=attendanceRSSI){
    dangerEntryRSSI=gateEntry;dangerExitRSSI=gateExit;attendanceRSSI=gateAttendance;
    resetBLEFilter();gateDangerArmed=false;
    Serial.println("GATE_CONFIG_THRESHOLDS_UPDATED");
  }
  lastConfigSuccess=now;haveBeaconConfig=true;configStaleLogged=false;
  if(beaconConfigRevision!=revision || recoveringStale){
    Serial.printf("BEACON_CONFIG_APPLIED count=%u zones=%d revision=%s\n",(unsigned)list.size(),count,revision);
    for(JsonObject b:list)Serial.printf("BEACON_REGISTERED id=%s kind=%s uuid=%s\n",b["beaconId"].as<const char*>(),b["kind"].as<const char*>(),b["serviceUuid"].as<const char*>());
  }
  beaconConfigRevision=revision;
}

const char *zoneState(const ZoneRuntime &z){return z.filter.state==ZoneFilter::NEAR?"NEAR":z.filter.state==ZoneFilter::FAR?"FAR":"UNKNOWN";}
void queueZoneObservation(ZoneRuntime &z,bool danger=false){
  JsonDocument doc;
  unsigned long now=millis();
  doc["eventId"]=String(DEVICE_ID)+"-zone-"+String(esp_random(),HEX)+"-"+String(esp_random(),HEX)+"-"+String(now);
  doc["deviceId"]=DEVICE_ID;doc["beaconId"]=z.config.id;doc["beaconUuid"]=z.config.uuid;
  doc["eventType"]=danger?"DANGER_ZONE_NEAR":"BLE_PROXIMITY";
  doc["deviceUptimeMs"]=now;doc["gpsStatus"]=gpsStatus();
  doc["deviceBootId"]=deviceBootId;
  if(strcmp(gpsStatus(),"GPS_FIX")==0){doc["latitude"]=gpsParser.location.lat();doc["longitude"]=gpsParser.location.lng();}
  if(attendanceEpoch.length()) doc["attendanceEpoch"]=attendanceEpoch;
  const char *state=zoneState(z);
  if(!danger) doc["proximity"]=state;
  if(danger || strcmp(state,"UNKNOWN")) doc["rssi"]=z.filter.rssi;
  if(danger){z.pendingDanger="";serializeJson(doc,z.pendingDanger);z.dangerAt=now;latencyTrace("danger_queued",doc["eventId"].as<const char*>(),now,z.filter.lastSeen);}
  else{
    if(!strcmp(state,"FAR") && z.approachArmed && !z.pendingFAR.length()){
      serializeJson(doc,z.pendingFAR);z.farAt=now;
    }
    z.pendingBLE="";serializeJson(doc,z.pendingBLE);z.bleAt=now;z.lastReport=now;z.lastState=state;
    Serial.printf("BLE_OBSERVATION_QUEUED id=%s proximity=%s eventId=%s\n",z.config.id,state,doc["eventId"].as<const char*>());
  }
}
void processZoneBeacons(){
  if(!zonesConfigFresh()){
    if(haveBeaconConfig&&!configStaleLogged){Serial.println("BEACON_CONFIG_STALE: danger beacons paused; gate fallback retained");configStaleLogged=true;}
    return;
  }
  String eligibility=lastAttendanceDay+"/"+attendanceEpoch+"/"+attendanceStatus+"/"+zoneMonitoringSession+((hasFreshGateState() && zoneMonitoringArmed)?"/DEPARTED":"/NOT_DEPARTED");
  for(int i=0;i<MAX_ZONE_BEACONS;++i){
    auto &z=zoneBeacons[i];if(!z.config.active) continue;
    unsigned long matches,dropped;
    portENTER_CRITICAL(&bleMux);matches=z.matchedPackets;dropped=z.droppedPackets;portEXIT_CRITICAL(&bleMux);
    if(matches && !z.matchLogged){Serial.printf("BEACON_UUID_MATCH id=%s uuid=%s\n",z.config.id,z.config.uuid);z.matchLogged=true;}
    auto previousState=z.filter.state;
    if(!z.lastRadioReport || millis()-z.lastRadioReport>=30000){
      Serial.printf("BEACON_SCAN_STATUS id=%s matched=%lu dropped=%lu\n",z.config.id,matches,dropped);z.lastRadioReport=millis();
    }
    for(int n=0;n<ZONE_PACKET_CAPACITY;++n){
      BLEReading reading;bool available=false;
      portENTER_CRITICAL(&bleMux);
      if(z.head!=z.tail){reading=z.packets[z.tail];z.tail=(z.tail+1)%ZONE_PACKET_CAPACITY;available=true;}
      portEXIT_CRITICAL(&bleMux);
      if(!available) break;
      if(millis()-reading.receivedAt<=BLE_SIGNAL_TIMEOUT_MS) z.filter.sample(reading.rssi,z.config.entry,z.config.exit,reading.receivedAt);
    }
    if(z.filter.state!=ZoneFilter::UNKNOWN && millis()-z.filter.lastSeen>BLE_SIGNAL_TIMEOUT_MS) z.filter.resetSignal();
    if(previousState!=ZoneFilter::NEAR && z.filter.state==ZoneFilter::NEAR){
      z.nearConfirmedAt=millis();
      Serial.printf("PROXIMITY_NEAR_CONFIRMED id=%s kind=DANGER_ZONE\n",z.config.id);
#if CHILDGUARD_LATENCY_DEBUG
      Serial.printf("LATENCY phase=near_confirmed beaconId=%s at_ms=%lu sample_age_ms=%lu\n",z.config.id,z.nearConfirmedAt,millis()-z.filter.lastSeen);
#endif
    }
    if(z.eligibility!=eligibility){if(z.pendingDanger.length())Serial.printf("DANGER_EPISODE_CANCELLED id=%s reason=ELIGIBILITY_CHANGED\n",z.config.id);z.eligibility=eligibility;z.filter.alerted=false;z.approachArmed=false;z.pendingFAR="";z.pendingNear="";z.pendingDanger="";z.lastState="";}
    if(z.filter.state==ZoneFilter::UNKNOWN){z.approachArmed=false;if(z.pendingDanger.length())Serial.printf("DANGER_EPISODE_CANCELLED id=%s reason=SIGNAL_UNKNOWN\n",z.config.id);z.pendingFAR="";z.pendingNear="";z.pendingDanger="";}
    if(hasFreshGateState() && zoneMonitoringArmed && !gatePassAuthorized && attendanceStatus=="PRESENT" && z.filter.state==ZoneFilter::FAR && z.filter.lastSeen>zoneDepartureUptimeMs && !z.approachArmed){
      z.approachArmed=true;z.lastState="";
    }
    const char *state=zoneState(z);
    if(z.lastState!=state || millis()-z.lastReport>=15000){
      queueZoneObservation(z);Serial.print("BEACON_STATE ");Serial.print(z.config.id);Serial.print(" ");Serial.println(state);
    }
    if(z.filter.state==ZoneFilter::NEAR){
      const char *reason=!hasFreshGateState()?"BACKEND_STATE_STALE":attendanceStatus!="PRESENT"?"NOT_CONFIRMED_PRESENT":gatePassAuthorized?"GATE_PASS_AUTHORIZED":!zoneMonitoringArmed?"NO_VERIFIED_DEPARTURE":z.filter.alerted?"APPROACH_ALREADY_REPORTED":!z.approachArmed?"NO_POST_DEPARTURE_ZONE_FAR":"ELIGIBLE";
      if(z.lastDangerDecision!=reason){Serial.printf("DANGER_ZONE_ELIGIBILITY id=%s kind=DANGER_ZONE reason=%s\n",z.config.id,reason);z.lastDangerDecision=reason;}
    }else z.lastDangerDecision="";
    // Server-authorized departure survives Gate UNKNOWN; each zone still needs fresh FAR/NEAR.
    if(hasFreshGateState() && zoneMonitoringArmed && !gatePassAuthorized && z.approachArmed && attendanceStatus=="PRESENT" && z.filter.state==ZoneFilter::NEAR && millis()-z.filter.lastSeen<=BLE_SIGNAL_TIMEOUT_MS && !z.filter.alerted && z.pendingDanger.length()==0){
      queueZoneObservation(z);
      // Keep the exact confirmed NEAR with its original ID/time until handled.
      // Routine telemetry may continue updating pendingBLE during HTTP retries.
      z.pendingNear=z.pendingBLE;z.nearAt=z.bleAt;
      queueZoneObservation(z,true);z.filter.alerted=true;z.approachArmed=false;
      Serial.print("EVENT: DANGER_ZONE_NEAR ");Serial.println(z.config.id);
    }
  }
}
bool zoneTelemetryPending(){
  if(!zonesConfigFresh()) return false;
  for(auto &z:zoneBeacons) if(z.config.active&&(z.pendingFAR.length()||z.pendingBLE.length()||z.pendingNear.length()||z.pendingDanger.length())) return true;
  return false;
}
bool flushZoneBatch(HTTPClient &http){
  JsonDocument doc;doc["deviceId"]=DEVICE_ID;JsonArray events=doc["events"].to<JsonArray>();
  for(auto &z:zoneBeacons) if(z.config.active){
    if(z.pendingDanger.length() && millis()-z.dangerAt>45000){Serial.printf("DANGER_EPISODE_EXPIRED id=%s age_ms=%lu\n",z.config.id,millis()-z.dangerAt);z.pendingNear="";z.pendingDanger="";}
    for(int kind=0;kind<3;++kind){
      String &body=kind==0?z.pendingFAR:kind==1?(z.pendingNear.length()?z.pendingNear:z.pendingBLE):z.pendingDanger;if(!body.length()) continue;
      JsonDocument event;deserializeJson(event,body);
      unsigned long queuedAt=kind==0?z.farAt:kind==1?(z.pendingNear.length()?z.nearAt:z.bleAt):z.dangerAt;
      event["queueAgeMs"]=(unsigned long)(millis()-queuedAt);if(events.size()<16){events.add(event.as<JsonObject>());latencyTrace("http_start",event["eventId"].as<const char*>(),queuedAt);}
    }
  }
  Serial.printf("BEACON_BATCH_SEND events=%u\n",(unsigned)events.size());
  String body;serializeJson(doc,body);unsigned long started=millis();int code=http.POST(body);
#if CHILDGUARD_LATENCY_DEBUG
  Serial.printf("LATENCY phase=batch_response at_ms=%lu http_ms=%lu HTTP=%d\n",millis(),millis()-started,code);
#else
  (void)started;
#endif
  if(code==200){
    JsonDocument result;if(deserializeJson(result,http.getString())){Serial.println("BEACON_BATCH_INVALID_RESPONSE: retry same event IDs");return false;}
    if(!result["data"].is<JsonArray>() || result["data"].as<JsonArray>().size()==0)return false;
    bool transient=false;
    for(JsonObject item:result["data"].as<JsonArray>()){
      int status=item["status"]|0;
      logTelemetryResult(item,status);
      if((status<200||status>=300)&&status!=400&&status!=409&&status!=422){transient=true;continue;}
      const char *eventId=item["eventId"]|"";
      for(auto &z:zoneBeacons) for(int kind=0;kind<4;++kind){
        String &queued=kind==0?z.pendingFAR:kind==1?z.pendingBLE:kind==2?z.pendingNear:z.pendingDanger;if(!queued.length()) continue;
        JsonDocument event;deserializeJson(event,queued);
        if(strcmp(event["eventId"]|"",eventId)==0){
          latencyTrace("event_handled",eventId,kind==0?z.farAt:kind==1?z.bleAt:kind==2?z.nearAt:z.dangerAt);
          Serial.printf("BEACON_TELEMETRY_RESULT id=%s eventId=%s HTTP=%d\n",z.config.id,eventId,status);queued="";
        }
      }
    }
    return !transient;
  } else {Serial.print("BEACON_TELEMETRY_RETRY HTTP ");Serial.println(code);logBackendError(http,code);return false;}
}
