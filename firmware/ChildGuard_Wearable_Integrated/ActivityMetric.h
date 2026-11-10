#pragma once
#include <stdint.h>
#include <math.h>

namespace ChildGuardActivity {
// Changing measurement parameters requires a new backend-supported metric version.
constexpr uint32_t MPU_SAMPLE_HZ=25;
constexpr uint32_t WINDOW_SECONDS=5;
constexpr uint32_t AGGREGATION_SECONDS=60;
constexpr uint32_t UPLOAD_INTERVAL_SECONDS=300;
constexpr unsigned QUEUE_CAPACITY=30;
constexpr unsigned BATCH_CAPACITY=5;
constexpr unsigned WINDOW_CAPACITY=MPU_SAMPLE_HZ*WINDOW_SECONDS;
constexpr unsigned MIN_WINDOW_SAMPLES=WINDOW_CAPACITY*80/100;
constexpr const char *MEASUREMENT_VERSION="MAD_G_V1_25HZ_5S";
inline bool terminalDeliveryStatus(int status){
  return (status>=200&&status<300)||status==400||status==409||status==422;
}
struct Summary {
  uint32_t sequence=0,endUptimeMs=0;
  unsigned validSamples=0;
  float validSeconds=0,madG=0;
  // 0 unavailable, 1 partial, 2 >=95% valid coverage.
  uint8_t sensorStatus=0;
};
struct Meter {
  float magnitudes[WINDOW_CAPACITY]={};
  unsigned sampleCount=0,minuteSamples=0;
  float weightedMAD=0;
  uint32_t windowStart=0,minuteStart=0,lastSampleAt=0,sequence=0;
  bool initialized=false,sampled=false;
  Summary queue[QUEUE_CAPACITY];
  unsigned head=0,count=0,dropped=0;
  unsigned completedWindows=0,rejectedWindows=0,lastWindowSamples=0;
  float lastWindowMAD=0;
  uint32_t maxSampleGapMs=0,actualSampleAt=0;
  void begin(uint32_t now){windowStart=minuteStart=now;lastSampleAt=now;initialized=true;sampled=false;}
  void finishWindow(){
    ++completedWindows;lastWindowSamples=sampleCount;lastWindowMAD=0;
    if(sampleCount<MIN_WINDOW_SAMPLES)++rejectedWindows;
    if(sampleCount>=MIN_WINDOW_SAMPLES){
      float mean=0;for(unsigned i=0;i<sampleCount;++i)mean+=magnitudes[i];mean/=sampleCount;
      float mad=0;for(unsigned i=0;i<sampleCount;++i)mad+=fabsf(magnitudes[i]-mean);mad/=sampleCount;
      lastWindowMAD=mad;
      weightedMAD+=mad*sampleCount;minuteSamples+=sampleCount;
    }
    sampleCount=0;
  }
  void finishMinute(){
    Summary s;s.sequence=++sequence;s.endUptimeMs=minuteStart+AGGREGATION_SECONDS*1000;
    s.validSamples=minuteSamples;s.validSeconds=(float)minuteSamples/MPU_SAMPLE_HZ;
    s.madG=minuteSamples?weightedMAD/minuteSamples:0;
    s.sensorStatus=minuteSamples>=MPU_SAMPLE_HZ*AGGREGATION_SECONDS*95/100?2:minuteSamples?1:0;
    if(count==QUEUE_CAPACITY){head=(head+1)%QUEUE_CAPACITY;--count;++dropped;}
    queue[(head+count)%QUEUE_CAPACITY]=s;++count;
    minuteStart+=AGGREGATION_SECONDS*1000;minuteSamples=0;weightedMAD=0;
  }
  void advance(uint32_t now){
    if(!initialized){begin(now);return;}
    // Work is bounded even after a prolonged console/calibration pause.
    unsigned steps=0;
    while((uint32_t)(now-windowStart)>=WINDOW_SECONDS*1000 && steps++<QUEUE_CAPACITY*12+12){
      finishWindow();windowStart+=WINDOW_SECONDS*1000;
      if((uint32_t)(windowStart-minuteStart)>=AGGREGATION_SECONDS*1000)finishMinute();
    }
    if((uint32_t)(now-windowStart)>=WINDOW_SECONDS*1000){
      ++dropped;sampleCount=minuteSamples=0;weightedMAD=0;windowStart=minuteStart=now;
    }
  }
  void sample(uint32_t now,bool valid,float ax,float ay,float az){
    advance(now);
    if(sampled&&(uint32_t)(now-lastSampleAt)<1000/MPU_SAMPLE_HZ)return;
    if(sampled&&(uint32_t)(now-actualSampleAt)>maxSampleGapMs)maxSampleGapMs=now-actualSampleAt;
    actualSampleAt=now;
    lastSampleAt=sampled&&now-lastSampleAt<80?lastSampleAt+40:now;sampled=true;
    if(!valid||!isfinite(ax)||!isfinite(ay)||!isfinite(az)||fabsf(ax)>2.2f||fabsf(ay)>2.2f||fabsf(az)>2.2f)return;
    float magnitude=sqrtf(ax*ax+ay*ay+az*az);
    if(isfinite(magnitude)&&sampleCount<WINDOW_CAPACITY)magnitudes[sampleCount++]=magnitude;
  }
  const Summary &at(unsigned index)const{return queue[(head+index)%QUEUE_CAPACITY];}
  void pop(){if(count){head=(head+1)%QUEUE_CAPACITY;--count;}}
};
}
