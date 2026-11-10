"""Exercise the actual FreeRTOS producer/drain code with a bounded native queue."""
from pathlib import Path
import subprocess
import tempfile
root=Path(__file__).resolve().parents[1]/'ChildGuard_Wearable_Integrated'
source=r'''
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <deque>
#include "ActivityMetric.h"
using TickType_t=uint32_t;using SemaphoreHandle_t=void*;using QueueHandle_t=void*;
constexpr int portMAX_DELAY=0,pdPASS=1,pdTRUE=1;
#define pdMS_TO_TICKS(ms) (ms)
uint32_t clockMs=0,iterations=0,stallUntil=0;bool sensorValid=true;
uint32_t millis(){return clockMs;}uint32_t xTaskGetTickCount(){return clockMs;}
void *xSemaphoreCreateMutex(){return (void*)1;}
void xSemaphoreTake(void*,int){}void xSemaphoreGive(void*){}
void *xQueueCreate(int count,unsigned){assert(count==256);return (void*)1;}
void vQueueDelete(void*){}
int xTaskCreate(void(*)(void*),const char*,int,void*,int,void*){return pdPASS;}
struct SensorData{float ax=0,ay=0,az=1;};
bool readMPU(SensorData &d){d.az=iterations%2?1.2f:.8f;return sensorValid;}
ChildGuardActivity::Meter movementMeter;
void initializeActivityBoot(){movementMeter.begin(clockMs);}
struct {template<class... T>void printf(const char*,T...){}void println(const char*){} }Serial;
void drainActivitySamples();
void vTaskDelayUntil(uint32_t *wake,uint32_t period){
 *wake+=period;clockMs=*wake;
 if(clockMs>=stallUntil&&clockMs%1000==0)drainActivitySamples();
 if(++iterations==1500)throw 1;
}
// Queue mocks are declared before including the real header, then implemented
// using the real ActivityReading type.
int xQueueSend(void*,const void*,int);int xQueueReceive(void*,void*,int);
#include "ActivitySampler.h"
std::deque<ActivityReading> buffer;
int xQueueSend(void*,const void *p,int){if(buffer.size()==256)return 0;buffer.push_back(*(const ActivityReading*)p);return 1;}
int xQueueReceive(void*,void *p,int){if(buffer.empty())return 0;*(ActivityReading*)p=buffer.front();buffer.pop_front();return 1;}
void run(uint32_t stall){clockMs=iterations=0;stallUntil=stall;buffer.clear();movementMeter={};activityReads=activityValidReads=activityBufferDrops=0;startActivitySampler();try{activitySampleTask(nullptr);}catch(int){}drainActivitySamples();movementMeter.advance(clockMs);}
int main(){
 run(0);assert(movementMeter.at(0).validSamples==1500&&movementMeter.at(0).madG>.19f);
 run(8000);assert(movementMeter.at(0).validSamples==1500); // eight-second HTTP pause, real samples buffered
 run(16000);assert(movementMeter.at(0).validSamples<1500&&movementMeter.rejectedWindows>0); // bounded queue loss is missing time
 sensorValid=false;run(0);assert(movementMeter.at(0).sensorStatus==0&&movementMeter.at(0).validSamples==0);
 puts("PASS: actual task producer/drain at 25 Hz, HTTP pause buffering, bounded overflow and invalid reads");
}
'''
with tempfile.TemporaryDirectory(prefix='childguard-sampler-host-') as tmp:
 cpp=Path(tmp)/'sampler.cpp';exe=Path(tmp)/'sampler';cpp.write_text(source)
 subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-I',str(root),str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
