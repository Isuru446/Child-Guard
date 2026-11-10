#pragma once
#include "TamperLoop.h"

// GPIO20/21 are UART0. Serial MUST be native USB CDC, never UART0.
#if !defined(CONFIG_IDF_TARGET_ESP32C3) || !ARDUINO_USB_CDC_ON_BOOT
#error "Tamper pins require ESP32-C3 with USB CDC On Boot Enabled (native USB18/19)."
#endif

namespace tamper {
constexpr uint8_t INPUT_PIN=20,SINK_PIN=21,CAPACITY=24;
struct Record {
  uint64_t sequence;
  uint32_t atMs;
  char boot[81],assignment[37];
  uint8_t state,reason; // 1 closed, 2 open; 0 startup, 1 transition
};
struct Journal {
  uint32_t magic=0x43475431,version=1;
  uint64_t sequence=0,episode=0;
  char epoch[33]={0};
  uint8_t state=0,count=0;
  Record records[CAPACITY]={};
};
static Journal journal;
static Preferences storage;
static SemaphoreHandle_t mutex=nullptr;
static cg::TamperLoop detector;
static char assignment[37]={0};
static bool durable=false,storageFault=false,ready=false;
static uint32_t statusCounter=0,lastStatus=0,lastAttempt=0;
static bool retry=false;

bool save(){
  const bool ok=durable&&storage.putBytes("journal",&journal,sizeof(journal))==sizeof(journal);
  if(!ok&&!storageFault)Serial.println("TAMPER_NVS_FAULT pending transitions only retained in RAM");
  storageFault=!ok;return ok;
}
bool valid(const Journal &value){
  if(value.magic!=0x43475431||value.version!=1||value.count>CAPACITY||value.state>2||
     value.sequence>=9007199254740991ULL||value.epoch[32]!=0||!value.epoch[0])return false;
  for(uint8_t i=0;i<value.count;i++){
    const Record &r=value.records[i];
    if(!r.sequence||r.sequence>value.sequence||r.state<1||r.state>2||r.reason>1||r.boot[80]!=0||r.assignment[36]!=0)return false;
  }
  return true;
}
void setAssignment(const char* id){
  if(!mutex)return;
  xSemaphoreTake(mutex,portMAX_DELAY);strlcpy(assignment,id,sizeof(assignment));xSemaphoreGive(mutex);
}
void sampleTask(void*){
  auto wake=xTaskGetTickCount();
  for(;;){
    const uint32_t now=millis();
    if(detector.tick(now,digitalRead(INPUT_PIN)==HIGH)){
      xSemaphoreTake(mutex,portMAX_DELAY);
      const uint8_t next=detector.value()==cg::LoopState::OPEN?2:1;
      const bool startup=journal.state==0;
      // Persisted same state after reboot keeps its episode identity.
      const bool transition=journal.state!=next;
      if(transition){
        ++journal.sequence;
        if(next==2)journal.episode=journal.sequence;
        journal.state=next;
        if(journal.count<CAPACITY){
          Record &r=journal.records[journal.count++];r={};
          r.sequence=journal.sequence;r.atMs=now;r.state=next;r.reason=startup?0:1;
          strlcpy(r.boot,deviceBootId.c_str(),sizeof(r.boot));strlcpy(r.assignment,assignment,sizeof(r.assignment));
        }else{
          Serial.println("TAMPER_QUEUE_FULL history exceeds 24 pending transitions; oldest retained, current state retained. Check device.");
        }
        save();
      }
      // Startup status is sent separately even when physical state is unchanged.
      lastStatus=0;
      ready=true;
      Serial.printf("TAMPER_LOOP %s sequence=%llu pending=%u\n",next==2?"OPEN":"CLOSED",(unsigned long long)journal.sequence,journal.count);
      xSemaphoreGive(mutex);
    }
    vTaskDelayUntil(&wake,pdMS_TO_TICKS(20));
  }
}
void begin(){
  digitalWrite(SINK_PIN,LOW);pinMode(SINK_PIN,OUTPUT_OPEN_DRAIN);pinMode(INPUT_PIN,INPUT_PULLUP);
  mutex=xSemaphoreCreateMutex();if(!mutex){Serial.println("TAMPER_TASK_FAULT no mutex");return;}
  durable=storage.begin("cg_tamper",false);
  Journal loaded;
  if(durable&&storage.getBytesLength("journal")==sizeof(loaded)&&storage.getBytes("journal",&loaded,sizeof(loaded))==sizeof(loaded)&&
     valid(loaded)){
    journal=loaded;
  }else{
    snprintf(journal.epoch,sizeof(journal.epoch),"%08lx%08lx",(unsigned long)esp_random(),(unsigned long)esp_random());save();
  }
  detector.begin(millis(),digitalRead(INPUT_PIN)==HIGH);
  if(xTaskCreate(sampleTask,"cg_tamper",4096,nullptr,2,nullptr)!=pdPASS)Serial.println("TAMPER_TASK_FAULT unable to start");
}
bool pending(){
  if(!mutex)return false;
  xSemaphoreTake(mutex,portMAX_DELAY);
  const bool due=ready&&(journal.count||lastStatus==0||uint32_t(millis()-lastStatus)>=30000);
  xSemaphoreGive(mutex);return due;
}
// Reserved critical lane in the existing HTTP scheduler; no ordinary packet can
// evict this FIFO. Only exact event acceptance removes its persisted head.
bool flush(){
  if(!pending()||uint32_t(millis()-lastAttempt)<(retry?5000UL:500UL))return false;
  lastAttempt=millis();
  retry=true;
  Record r;char epoch[33];uint64_t currentEpisode;bool critical;
  xSemaphoreTake(mutex,portMAX_DELAY);
  strlcpy(epoch,journal.epoch,sizeof(epoch));currentEpisode=journal.episode;critical=journal.count>0;
  if(critical)r=journal.records[0];
  else{r={};r.sequence=journal.sequence;r.atMs=millis();r.state=journal.state;strlcpy(r.boot,deviceBootId.c_str(),sizeof(r.boot));strlcpy(r.assignment,assignment,sizeof(r.assignment));}
  xSemaphoreGive(mutex);
  const bool reboot=String(r.boot)!=deviceBootId;
  const String prefix=String(DEVICE_ID)+"-tamper-"+epoch+"-";
  // Transition sequences alternate OPEN/CLOSED. Heartbeats never increment it.
  uint64_t episode=currentEpisode;
  if(critical){
    episode=r.state==2?r.sequence:0;
    // Transitions alternate; the immediately preceding sequence is OPEN.
    if(!episode&&r.sequence>1)episode=r.sequence-1;
  }
  if(!episode)episode=1;
  JsonDocument doc;
  const String eventId=critical?prefix+String((unsigned long long)r.sequence):prefix+deviceBootId+"-status-"+String(++statusCounter);
  doc["eventId"]=eventId;doc["deviceId"]=DEVICE_ID;
  doc["eventType"]=critical?(r.state==2?"TAMPER_LOOP_OPEN":r.reason==0?"TAMPER_LOOP_STATUS":"TAMPER_LOOP_RESTORED"):"TAMPER_LOOP_STATUS";
  doc["tamperVersion"]="CG_TAMPER_V1";doc["deviceBootId"]=r.boot;doc["tamperEpoch"]=epoch;
  doc["tamperSequence"]=r.sequence;doc["tamperEpisodeId"]=prefix+String((unsigned long long)episode);
  doc["tamperState"]=r.state==2?"OPEN":"CLOSED";
  doc["reason"]=critical?(r.reason==0?"STARTUP":"TRANSITION"):(lastStatus==0?"STARTUP":"PERIODIC");
  doc["deviceUptimeMs"]=r.atMs;doc["queueAgeMs"]=reboot?0UL:uint32_t(millis()-r.atMs);doc["timingUncertain"]=reboot;
  if(r.assignment[0])doc["assignmentId"]=r.assignment;
  String body;serializeJson(doc,body);
  WiFiClient client;HTTPClient http;
  if(!http.begin(client,String(BACKEND_URL)+"/api/events"))return true;
  configureRequest(http);http.addHeader("Content-Type","application/json");
  const int code=http.POST(body);JsonDocument response;
  const bool parsed=!deserializeJson(response,http.getString());http.end();
  const bool accepted=code>=200&&code<300&&parsed&&String(response["data"]["eventId"]|"")==eventId;
  xSemaphoreTake(mutex,portMAX_DELAY);
  if(accepted){
    retry=false;
    if(critical&&journal.count&&journal.records[0].sequence==r.sequence){
      for(uint8_t i=1;i<journal.count;i++)journal.records[i-1]=journal.records[i];
      --journal.count;
      // If removal cannot be persisted, retain head and retry the same ID.
      if(durable&&!save()){
        for(uint8_t i=journal.count;i>0;i--)journal.records[i]=journal.records[i-1];
        journal.records[0]=r;++journal.count;
      }
    }else if(!critical)lastStatus=millis();
    Serial.printf("TAMPER_HTTP_ACCEPTED state=%s pending=%u suppression=%s\n",r.state==2?"OPEN":"CLOSED",journal.count,response["data"]["suppressionReason"]|"none");
  }else Serial.printf("TAMPER_HTTP_RETRY code=%d pending=%u\n",code,journal.count);
  xSemaphoreGive(mutex);
  return true;
}
}
