"""Compile the real MAD module and real sensor sampling/recovery hooks with native I/O mocks."""
from pathlib import Path
import subprocess
import tempfile
import re
root=Path(__file__).resolve().parents[1] / 'ChildGuard_Wearable_Integrated'
source=r'''
#include <cassert>
#include <cmath>
#include <iostream>
#include "ActivityMetric.h"
using namespace ChildGuardActivity;
void minute(Meter &m,uint32_t start,bool valid=true,bool motion=false){
 for(uint32_t t=start;t<start+60000;t+=20){float z=motion?(1.0f+((t/40)%2?.2f:-.2f)):1.0f;m.sample(t,valid,0,0,z);}m.advance(start+60000);
}
int main(){
 assert(terminalDeliveryStatus(201)&&terminalDeliveryStatus(200)&&terminalDeliveryStatus(422)&&terminalDeliveryStatus(409));
 assert(!terminalDeliveryStatus(401)&&!terminalDeliveryStatus(429)&&!terminalDeliveryStatus(503)&&!terminalDeliveryStatus(0));
 Meter still;minute(still,0);assert(still.count==1&&still.at(0).validSamples==1500&&still.at(0).madG==0&&still.at(0).sensorStatus==2);
 Meter moving;minute(moving,0,true,true);assert(moving.at(0).madG>.19&&moving.at(0).madG<.21);assert(moving.at(0).validSeconds==60);
 Meter orientation;for(uint32_t t=0;t<60000;t+=40)orientation.sample(t,true,(t/5000)%2?1:0,0,(t/5000)%2?0:1);orientation.advance(60000);assert(orientation.at(0).madG==0);
 Meter invalid;for(uint32_t t=0;t<60000;t+=40)invalid.sample(t,true,NAN,0,1);invalid.advance(60000);assert(invalid.at(0).validSamples==0&&invalid.at(0).sensorStatus==0);
 Meter missing;minute(missing,0,false);assert(missing.at(0).validSeconds==0&&missing.at(0).sensorStatus==0);
 Meter partial;for(uint32_t t=0;t<60000;t+=40)partial.sample(t,(t/40)%5!=0,0,0,1);partial.advance(60000);assert(partial.at(0).validSamples==1200&&partial.at(0).validSeconds==48&&partial.at(0).sensorStatus==1);
 Meter poor;for(uint32_t t=0;t<60000;t+=40)poor.sample(t,(t/40)%2!=0,0,0,1);poor.advance(60000);assert(poor.at(0).validSamples==0);
 Meter gap;gap.begin(0);gap.advance(60000);assert(gap.count==1&&gap.at(0).sensorStatus==0);
 Meter bounded;for(unsigned i=0;i<31;++i)minute(bounded,i*60000);assert(bounded.count==30&&bounded.dropped==1&&bounded.at(0).sequence==2);bounded.pop();assert(bounded.count==29);
 Meter blocked; // Independent producer retains real timestamped reads across HTTP stalls.
 for(uint32_t base=0;base<300000;base+=1000){
  for(uint32_t t=base;t<base+1000;t+=40)blocked.sample(t,true,0,0,1);
  blocked.advance(base+1000);
 }
 assert(blocked.count==5&&blocked.at(4).validSamples==1500);
 Meter jitter;for(uint32_t t=0;t<60000;t+=40)jitter.sample(t+((t/40)%2),true,0,0,1);
 jitter.advance(60000);assert(jitter.at(0).validSamples>=1499);
 Meter overflowGap;for(uint32_t t=0;t<60000;t+=40)if(t<10000||t>=25000)overflowGap.sample(t,true,0,0,1);
 overflowGap.advance(60000);assert(overflowGap.at(0).validSamples==1125&&overflowGap.rejectedWindows==3);
 Meter reboot;minute(reboot,0,true,true);reboot=Meter{};assert(reboot.count==0);minute(reboot,0);assert(reboot.at(0).sequence==1);
 Meter paused;paused.begin(0);paused.advance(3600000);assert(paused.count<=QUEUE_CAPACITY&&paused.dropped>0);
 std::cout<<"PASS: actual magnitude/MAD, stillness/orientation, motion, invalid/failed samples, minute quality, bounded queue, restart and long gaps\n";
}
'''
def function(text,name):
 match=re.search(r'(?:bool|void) '+name+r'\([^)]*\)\s*\{',text)
 depth,end=1,match.end()
 while depth:
  depth+=(text[end]=='{')-(text[end]=='}');end+=1
 return text[match.start():end]
sketch=(root/'ChildGuard_Wearable_Integrated.ino').read_text()
runtime=(root/'ActivityRuntime.h').read_text()
# Arduino compiles the sketch and includes these integration headers in one
# translation unit. A copied sketch in a guarded header still duplicates symbols.
assert runtime.startswith('#pragma once\n#include "ActivityMetric.h"')
assert '#include "ActivityRuntime.h"' not in runtime
assert not re.search(r'\bvoid\s+(?:setup|loop)\s*\(',runtime)
assert not re.search(r'\b(?:struct|class)\s+(?:SensorData|BLEReading)\b',runtime)
assert not re.search(r'const\s+char\s*\*\s*(?:DEVICE_ID|GATE_ID)\s*=',runtime)
assert sketch.index('#include "MultiBeaconRuntime.h"') < sketch.index('#include "ActivityRuntime.h"') < sketch.index('#include "ActivitySampler.h"')
for symbol in ['initializeActivityBoot','recoverActivityMpu','activityUploadDue','safetyTelemetryPending','flushActivityBatch','tickMovementActivity']:
 assert len(re.findall(r'\b(?:bool|void)\s+'+symbol+r'\s*\([^;{}]*\)\s*\{',runtime))==1,symbol
 assert not re.search(r'\b(?:bool|void)\s+'+symbol+r'\s*\([^;{}]*\)\s*\{',sketch),symbol
assert len(re.findall(r'ChildGuardActivity::Meter\s+movementMeter\s*;',runtime))==1
assert len(re.findall(r'bool\s+mpuConfigured\s*=\s*false\s*;',runtime))==1
print('PASS: activity-only runtime, unique definitions and integration include order')

wrapped=r'''
#include <cassert>
#include <cmath>
#include <iostream>
#include "ActivityMetric.h"
unsigned long clockMs=100000,lastMpuProbe=0;
unsigned long millis(){return clockMs;}
bool mpuConfigured=false,busWorking=false,csvLogging=false;
int registerWrites=0,readCount=0,resets=0,analyses=0;
bool writeMPURegister(uint8_t reg,uint8_t value){assert(value==0&&(reg==0x6B||reg==0x1C||reg==0x1B));++registerWrites;return busWorking;}
struct {template<class... T>void print(T... ){}template<class... T>void println(T... ){} } Serial;
struct SensorData {float ax=0,ay=0,az=1,gx=0,gy=0,gz=0;};
bool readMPU(SensorData &){++readCount;return busWorking;}
ChildGuardActivity::Meter movementMeter;
float accelSumSquares=0,gyroSumSquares=0;
int sampleCount=0;
const int WINDOW_SAMPLES=100;
void resetActivityWindow(){++resets;sampleCount=0;}
void analyzeActivity(){++analyses;sampleCount=0;}
'''
wrapped+=function(runtime,'recoverActivityMpu')+'\n'+function(sketch,'sampleMPU')
wrapped+=r'''
int main(){
 sampleMPU();assert(!mpuConfigured&&readCount==0&&registerWrites==3);
 for(int i=0;i<50;i++){clockMs+=20;sampleMPU();}assert(registerWrites==3); // bounded recovery, no busy read loop
 busWorking=true;clockMs=105001;sampleMPU();assert(mpuConfigured&&registerWrites==6&&readCount==1);
 for(int i=0;i<3000;i++){clockMs+=20;sampleMPU();}
 assert(analyses>0&&movementMeter.count==0); // legacy hook no longer feeds MAD
 busWorking=false;clockMs+=20;sampleMPU();assert(!mpuConfigured&&resets>0);
 std::cout<<"PASS: actual sampleMPU and sensor recovery hooks preserve calibrated sampling and bound disconnected-sensor probes\n";
}
'''
with tempfile.TemporaryDirectory(prefix='childguard-activity-host-') as directory:
 for name,body in [('metric',source),('hooks',wrapped)]:
  cpp=Path(directory)/(name+'.cpp');exe=Path(directory)/name;cpp.write_text(body)
  subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-I',str(root),str(cpp),'-o',str(exe)],check=True)
  subprocess.run([str(exe)],check=True)

priority=r'''
#include <cassert>
#include <string>
#include <cstring>
#include <iostream>
#include "ActivityMetric.h"
using String=std::string;
unsigned long clockMs=100000,activityNextUpload=300000;
unsigned long millis(){return clockMs;}
ChildGuardActivity::Meter movementMeter;
String pendingArmedFARJson="",pendingAttendanceJson="",attendanceStatus="PRESENT";
bool freshGate=true,freshConfig=true;
bool hasFreshGateState(){return freshGate;}
bool zonesConfigFresh(){return freshConfig;}
struct Zone {struct {bool active=false;}config;String pendingDanger;unsigned long dangerAt=0;};
Zone zoneBeacons[7];
constexpr int TELEMETRY_QUEUE_SIZE=12;
struct Telemetry {String json;};
Telemetry telemetryQueue[TELEMETRY_QUEUE_SIZE];
uint8_t telemetryHead=0,telemetryTail=0;
struct JsonValue {const String &v;const char *operator|(const char *fallback){return v.empty()?fallback:v.c_str();}};
struct JsonDocument {String kind;JsonValue operator[](const char *){return {kind};}};
void deserializeJson(JsonDocument &doc,const String &body){doc.kind=body;}
'''
priority+=function(runtime,'activityUploadDue')+'\n'+function(runtime,'safetyTelemetryPending')
priority+=r'''
int main(){
 movementMeter.begin(0);movementMeter.advance(60000);assert(!activityUploadDue());clockMs=299999;assert(!activityUploadDue());clockMs=300000;assert(activityUploadDue());
 telemetryQueue[0].json="ACTIVITY_WINDOW";telemetryHead=1;assert(!safetyTelemetryPending()); // routine traffic cannot starve due activity
 telemetryQueue[0].json="DANGER_ZONE_NEAR";assert(safetyTelemetryPending());telemetryHead=0;
 pendingArmedFARJson="gate-far";assert(safetyTelemetryPending());pendingArmedFARJson="";
 attendanceStatus="NOT_CHECKED_IN";pendingAttendanceJson="arrival";assert(safetyTelemetryPending());freshGate=false;assert(!safetyTelemetryPending());pendingAttendanceJson="";
 zoneBeacons[0].config.active=true;zoneBeacons[0].pendingDanger="zone-danger";zoneBeacons[0].dangerAt=clockMs;assert(safetyTelemetryPending());
 zoneBeacons[0].dangerAt=clockMs-45001;assert(!safetyTelemetryPending());zoneBeacons[0].dangerAt=clockMs;freshConfig=false;assert(!safetyTelemetryPending());
 std::cout<<"PASS: actual activity due/priority guards defer to attendance, gate FAR and fresh dangers without starvation by ordinary/stale telemetry\n";
}
'''
with tempfile.TemporaryDirectory(prefix='childguard-activity-priority-') as directory:
 cpp=Path(directory)/'priority.cpp';exe=Path(directory)/'priority';cpp.write_text(priority)
 subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-I',str(root),str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
