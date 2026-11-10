#pragma once
#include <stdint.h>
// Same moving average, minimum samples and hysteresis as the gate, per beacon.
template<int Window, int Minimum, int Confirm>
struct BeaconTracker {
  enum State { UNKNOWN, OBSERVING, FAR, NEAR };
  int samples[Window] = {}, count=0, index=0, nearHits=0, farHits=0;
  float sum=0, rssi=-127;
  State state=UNKNOWN;
  bool alerted=false;
  uint32_t lastSeen=0;
  void resetSignal() {
    count=index=nearHits=farHits=0;sum=0;rssi=-127;state=UNKNOWN;
    // Signal loss is not FAR and must not rearm an already reported approach.
  }
  void sample(int value, float entry, float exit, uint32_t now) {
    if(value < -127 || value>0) return;
    lastSeen=now;
    if(state==UNKNOWN) state=OBSERVING;
    if(count<Window){samples[index]=value;sum+=value;++count;}
    else{sum-=samples[index];samples[index]=value;sum+=value;}
    index=(index+1)%Window;rssi=sum/count;
    if(count<Minimum) return;
    if(rssi>=entry){if(nearHits<Confirm) ++nearHits;farHits=0;if(nearHits>=Confirm) state=NEAR;}
    else if(rssi<=exit){if(farHits<Confirm) ++farHits;nearHits=0;if(farHits>=Confirm){state=FAR;alerted=false;}}
    else nearHits=farHits=0;
  }
};
