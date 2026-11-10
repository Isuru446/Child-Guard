#pragma once
#include <stdint.h>
// Observed scan-active time, not inferred from Wi-Fi or from missing advertisements.
struct BusScanHealth {
 struct Window {
  uint32_t elapsed,healthy,maxGap;
  constexpr bool valid() const {return elapsed>=4000&&elapsed<=7000&&healthy+500>=elapsed&&maxGap<=1000;}
 };
 uint32_t started=0,lastTick=0,healthy=0,maxGap=60000;
 bool wasScanning=false;
 constexpr void reset(uint32_t now){started=lastTick=now;healthy=0;maxGap=60000;wasScanning=false;}
 constexpr void sample(uint32_t now,bool scanning,bool stopped=false){
  uint32_t gap=now-lastTick;
  if(scanning&&wasScanning&&gap<=1000&&!stopped)healthy+=gap;
  if(gap>maxGap)maxGap=gap;
  if(!scanning||!wasScanning||stopped)maxGap=60000;
  wasScanning=scanning;lastTick=now;
 }
 constexpr Window take(uint32_t now,bool stopped=false){
  Window result{now-started,healthy,stopped?60000U:maxGap};started=now;healthy=0;maxGap=0;return result;
 }
};
