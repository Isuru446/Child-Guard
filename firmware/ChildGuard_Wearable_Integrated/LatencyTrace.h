#pragma once
// Set to 1 in Arduino build flags for supervised timing trials. No secrets or names.
#ifndef CHILDGUARD_LATENCY_DEBUG
#define CHILDGUARD_LATENCY_DEBUG 0
#endif
inline void latencyTrace(const char *phase,const char *eventId,unsigned long queuedAt,unsigned long sampleAt=0){
#if CHILDGUARD_LATENCY_DEBUG
  unsigned long now=millis();
  Serial.printf("LATENCY phase=%s eventId=%s at_ms=%lu queue_ms=%lu sample_age_ms=%lu\n",phase,eventId,now,now-queuedAt,sampleAt?now-sampleAt:0);
#else
  (void)phase;(void)eventId;(void)queuedAt;(void)sampleAt;
#endif
}
