#pragma once
#include <stdint.h>
inline bool telemetryDispatchDue(uint32_t now,uint32_t last,bool priority,bool failed,uint32_t ordinaryMs=5000){
  const uint32_t interval=failed?ordinaryMs:priority?500:ordinaryMs;
  return last==0 || uint32_t(now-last)>=interval;
}
