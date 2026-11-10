#pragma once
#include <atomic>
// The producer owns I2C reads only. The main loop alone owns the MAD meter,
// aggregation and networking. Never hold a bus lock during HTTP or Serial I/O.
bool readMPU(SensorData &data);
SemaphoreHandle_t activityBusMutex=nullptr;
QueueHandle_t activitySamples=nullptr;
uint32_t activitySampleReportAt=0;
std::atomic<uint32_t> activityReads{0},activityValidReads{0},activityBufferDrops{0};
struct ActivityBusGuard {
  SemaphoreHandle_t held;
  ActivityBusGuard():held(activityBusMutex){if(held)xSemaphoreTake(held,portMAX_DELAY);}
  ~ActivityBusGuard(){if(held)xSemaphoreGive(held);}
};
struct ActivityReading {uint32_t at;float ax,ay,az;bool valid;};
void activitySampleTask(void *){
  TickType_t wake=xTaskGetTickCount();
  for(;;){
    SensorData d{};
    bool valid=readMPU(d);
    ActivityReading r{millis(),d.ax,d.ay,d.az,valid};
    // Overflow drops a real sample; timestamps expose the gap to the meter.
    ++activityReads;if(valid)++activityValidReads;
    if(xQueueSend(activitySamples,&r,0)!=pdTRUE)++activityBufferDrops;
    TickType_t now=xTaskGetTickCount();
    // A late task never bursts duplicate/current readings to catch up.
    if(now-wake>=pdMS_TO_TICKS(40))wake=now;
    vTaskDelayUntil(&wake,pdMS_TO_TICKS(40));
  }
}
void startActivitySampler(){
  initializeActivityBoot();
  activitySampleReportAt=millis();
  activityBusMutex=xSemaphoreCreateMutex();
  // 256 readings (~5 KB) tolerate about ten seconds of main-loop HTTP stalls.
  activitySamples=xQueueCreate(256,sizeof(ActivityReading));
  if(!activityBusMutex||!activitySamples||xTaskCreate(activitySampleTask,"activity25Hz",3072,nullptr,1,nullptr)!=pdPASS){
    Serial.println("ACTIVITY_COLLECTION_STATUS: sampler_start_failed");
    if(activitySamples){vQueueDelete(activitySamples);activitySamples=nullptr;}
    return;
  }
  Serial.println("ACTIVITY_COLLECTION_STATUS: independent_sampler rateHz=25 buffer=256");
}
void drainActivitySamples(){
  if(!activitySamples)return;
  uint32_t now=millis(),elapsed=now-activitySampleReportAt;
  if(elapsed>=5000){
    uint32_t reads=activityReads.exchange(0),valid=activityValidReads.exchange(0),drops=activityBufferDrops.exchange(0);
    Serial.printf("ACTIVITY_SENSOR_SAMPLES: valid=%lu reads=%lu bufferDropped=%lu achievedHz=%.2f\n",(unsigned long)valid,(unsigned long)reads,(unsigned long)drops,1000.0f*reads/elapsed);
    activitySampleReportAt=now;
  }
  ActivityReading r;
  unsigned drained=0;
  while(drained++<256&&xQueueReceive(activitySamples,&r,0)==pdTRUE)
    movementMeter.sample(r.at,r.valid,r.ax,r.ay,r.az);
}

void observeActivityLoopBlock(const char *source,void (*operation)()){
  uint32_t started=millis();operation();uint32_t elapsed=millis()-started;
  static uint32_t lastReport=0;
  if(elapsed>=100&&(!lastReport||millis()-lastReport>=30000)){
    Serial.printf("ACTIVITY_LOOP_BLOCK: source=%s durationMs=%lu\n",source,(unsigned long)elapsed);
    lastReport=millis();
  }
}
