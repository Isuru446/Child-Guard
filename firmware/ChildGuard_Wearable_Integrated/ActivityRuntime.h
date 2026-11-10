#pragma once
#include "ActivityMetric.h"

bool writeMPURegister(uint8_t reg,uint8_t value);
ChildGuardActivity::Meter movementMeter;
bool mpuConfigured=false;
unsigned long lastMpuProbe=0;
uint32_t activityLastUptime=0;
unsigned activityDroppedReported=0;
String activityBootId="";
unsigned long activityNextUpload=0;

void initializeActivityBoot(){
  activityBootId=String(esp_random(),HEX)+"-"+String(esp_random(),HEX)+"-"+String(esp_random(),HEX);
  movementMeter.begin(millis());activityNextUpload=millis()+ChildGuardActivity::UPLOAD_INTERVAL_SECONDS*1000;
}
void tickMovementActivity(bool advanceClock=true){
  uint32_t now=millis();
  if(!activityBootId.length())initializeActivityBoot();
  if(now<activityLastUptime){
    // New timing session at the ~49-day millis wrap; never misdate queued records.
    unsigned lost=movementMeter.count;movementMeter=ChildGuardActivity::Meter{};movementMeter.dropped=lost;
    initializeActivityBoot();Serial.println("ACTIVITY_UPTIME_SESSION_CHANGED");
  }
  activityLastUptime=now;
  static uint32_t reportedSequence=0;
  unsigned before=reportedSequence;
  if(advanceClock)movementMeter.advance(now);
  if(movementMeter.dropped!=activityDroppedReported){Serial.print("ACTIVITY_QUEUE_OVERFLOW_OR_GAP ");Serial.println(movementMeter.dropped);activityDroppedReported=movementMeter.dropped;}
  static unsigned reportedWindows=0;
  if(reportedWindows!=movementMeter.completedWindows){
    reportedWindows=movementMeter.completedWindows;
    String mad=movementMeter.lastWindowSamples>=ChildGuardActivity::MIN_WINDOW_SAMPLES?String(movementMeter.lastWindowMAD,5):String("unavailable");
    Serial.printf("ACTIVITY_WINDOW_COMPLETE: mad=%s coverage=%.1f%% valid=%u missed=%u windows=%u rejected=%u maxGapMs=%lu\n",mad.c_str(),100.0f*movementMeter.lastWindowSamples/ChildGuardActivity::WINDOW_CAPACITY,movementMeter.lastWindowSamples,ChildGuardActivity::WINDOW_CAPACITY-movementMeter.lastWindowSamples,movementMeter.completedWindows,movementMeter.rejectedWindows,(unsigned long)movementMeter.maxSampleGapMs);
  }
  if(movementMeter.sequence!=before&&movementMeter.count){
    reportedSequence=movementMeter.sequence;
    const auto &s=movementMeter.at(movementMeter.count-1);
    String score=s.validSamples?String(s.madG,5):String("unavailable");
    Serial.printf("ACTIVITY_MINUTE_COMPLETE: score=%s valid=%u coverage=%.1f%% sequence=%lu\n",score.c_str(),s.validSamples,100.0f*s.validSamples/1500,(unsigned long)s.sequence);
    Serial.printf("ACTIVITY_SUMMARY_QUEUED: count=%u generated=%lu\n",movementMeter.count,(unsigned long)movementMeter.sequence);
  }
}
bool recoverActivityMpu(){
  if(mpuConfigured)return true;
  unsigned long now=millis();
  if(lastMpuProbe && now-lastMpuProbe<5000)return false;
  lastMpuProbe=now;
  bool ok=writeMPURegister(0x6B,0x00);
  ok=writeMPURegister(0x1C,0x00)&&ok;
  ok=writeMPURegister(0x1B,0x00)&&ok;
  mpuConfigured=ok;
  if(ok)Serial.println("MPU6050_RECOVERED");
  return ok;
}
bool activityUploadDue(){return movementMeter.count && (int32_t)(millis()-activityNextUpload)>=0;}
bool safetyTelemetryPending(){
  if(pendingArmedFARJson.length() || (hasFreshGateState()&&attendanceStatus=="NOT_CHECKED_IN"&&pendingAttendanceJson.length()))return true;
  for(auto &z:zoneBeacons)if(zonesConfigFresh()&&z.config.active&&z.pendingDanger.length()&&millis()-z.dangerAt<=45000)return true;
  for(uint8_t i=telemetryTail;i!=telemetryHead;i=(i+1)%TELEMETRY_QUEUE_SIZE){
    JsonDocument doc;deserializeJson(doc,telemetryQueue[i].json);
    const char *kind=doc["eventType"]|"";
    if(!strcmp(kind,"DANGER_ZONE_NEAR")||!strcmp(kind,"DANGER_ZONE_EXIT")||!strcmp(kind,"BEACON_SIGNAL_LOST"))return true;
  }
  return false;
}
void flushActivityBatch(HTTPClient &http){
  using namespace ChildGuardActivity;
  JsonDocument doc;doc["deviceId"]=DEVICE_ID;JsonArray events=doc["events"].to<JsonArray>();
  unsigned sent=movementMeter.count<BATCH_CAPACITY?movementMeter.count:BATCH_CAPACITY;
  for(unsigned i=0;i<sent;++i){
    const auto &s=movementMeter.at(i);JsonObject event=events.add<JsonObject>();
    event["eventId"]=String(DEVICE_ID)+"-mad-"+activityBootId+"-"+String(s.sequence);
    event["eventType"]="ACTIVITY_SUMMARY";event["deviceId"]=DEVICE_ID;
    event["sessionId"]=activityBootId;event["sequence"]=s.sequence;
    event["measurementVersion"]=MEASUREMENT_VERSION;event["windowDurationSeconds"]=AGGREGATION_SECONDS;
    event["validSampleCount"]=s.validSamples;event["expectedSampleCount"]=MPU_SAMPLE_HZ*AGGREGATION_SECONDS;
    event["validDurationSeconds"]=s.validSeconds;
    if(s.validSamples)event["movementIntensity"]=s.madG;else event["movementIntensity"]=nullptr;
    event["sensorStatus"]=s.sensorStatus==2?"OK":s.sensorStatus==1?"PARTIAL":"UNAVAILABLE";
    event["deviceUptimeMs"]=s.endUptimeMs;event["queueAgeMs"]=(uint32_t)(millis()-s.endUptimeMs);
  }
  String body;serializeJson(doc,body);int code=http.POST(body);
  if(code==200){
    JsonDocument result;
    if(!deserializeJson(result,http.getString())){
      unsigned acknowledged=0;
      for(JsonObject item:result["data"].as<JsonArray>()){
        if(acknowledged>=sent)break;
        const auto &s=movementMeter.at(0);
        String expected=String(DEVICE_ID)+"-mad-"+activityBootId+"-"+String(s.sequence);
        if(expected!=String(item["eventId"]|""))break;
        int status=item["status"]|0;
        logTelemetryResult(item,status);
        if(!terminalDeliveryStatus(status))break;
        movementMeter.pop();++acknowledged;
        Serial.print(status>=200&&status<300?"ACTIVITY_SUMMARY_SENT: HTTP ":"ACTIVITY_SUMMARY_REJECTED: HTTP ");Serial.println(status);
        if(status>=400){String reason=item["error"]["code"]|"UNKNOWN";Serial.println(reason.substring(0,160));}
      }
    }
  }else{Serial.print("ACTIVITY_UPLOAD_RETRY HTTP ");Serial.println(code);logBackendError(http,code);}
  // Drain outage backlog without starving normal BLE, retry failures at most every 30s.
  activityNextUpload=millis()+(movementMeter.count?30000:UPLOAD_INTERVAL_SECONDS*1000);
}
