"""Host tests for actual sketch guards; mocks I/O, never claims ESP32 verification."""
from pathlib import Path
import re
import subprocess
import tempfile

sketch = (Path(__file__).resolve().parents[1] / 'ChildGuard_Wearable_Integrated/ChildGuard_Wearable_Integrated.ino').read_text()


def function(name):
    match = re.search(r'(?:bool|void) ' + name + r'\([^)]*\)\s*\{', sketch)
    if not match:
        raise RuntimeError('Missing sketch function: ' + name)
    depth, end = 1, match.end()
    while depth:
        depth += (sketch[end] == '{') - (sketch[end] == '}')
        end += 1
    return sketch[match.start():end]


names = ['applyAttendanceEpoch', 'resetBLEFilter', 'hasFreshGateState', 'hasFreshBLESignal', 'armGateDangerIfFar', 'setProximity', 'addRSSIReading', 'checkGateDanger']
constants = []
for name in ['BLE_RSSI_WINDOW', 'BLE_MIN_READINGS', 'BLE_CONFIRM_READINGS', 'BLE_SIGNAL_TIMEOUT_MS', 'GATE_STATE_MAX_AGE_MS']:
    match = re.search(r'(?:#define\s+' + name + r'\s+[^\n]+|const\s+[^;]+\b' + name + r'\s*=\s*[^;]+;)', sketch)
    if not match:
        raise RuntimeError('Missing sketch constant: ' + name)
    constants.append(match.group())
source = r'''
#include <cassert>
#include <cmath>
#include <cstring>
#include <iostream>
#include <string>
using String=std::string;
#define portENTER_CRITICAL(x) ((void)0)
#define portEXIT_CRITICAL(x) ((void)0)
const int WL_CONNECTED=1;
struct { int connected=1; int status(){return connected;} } WiFi;
struct { template<class... T> void print(T... ){} template<class... T> void println(T... ){} } Serial;
unsigned long clockMs=100000;
unsigned long millis(){return clockMs;}
int bleMux=0;
unsigned long bleLastSeenMs=100000,lastGoodGateStateMs=100000;
bool bleEverSeen=true,gateStateValid=true;
enum ProximityState { PROXIMITY_UNKNOWN,PROXIMITY_OBSERVING,PROXIMITY_FAR,PROXIMITY_NEAR };
ProximityState proximity=PROXIMITY_UNKNOWN;
bool resetArrivalNeedsFar=false;
bool gatePassAuthorized=false,gateDangerArmed=false,dangerEventReported=false,attendanceReportSent=false,arrivalArmed=true;
String attendanceEpoch="";
String attendanceStatus="CHECKIN_PENDING",pendingEventId="",pendingAttendanceJson="",pendingBLEJson="",pendingArmedFARJson="";
unsigned long pendingBLEAtMs=0,pendingArmedFARAtMs=0;
int nearHits=0,farHits=0,attendanceHits=0,rssiCount=0,rssiIndex=0;
float filteredRSSI=-127,rssiSum=0,dangerEntryRSSI=-63,dangerExitRSSI=-69,attendanceRSSI=-55;
int dangerEvents=0;
void queueBLEObservation(bool){}
const char *proximityText(){return "test";}
void queueDeviceTelemetry(const char *kind,const char *,float,float,float){if(strcmp(kind,"DANGER_ZONE_NEAR")==0) ++dangerEvents;}
'''
source += '\n'.join(constants) + '\nint rssiBuffer[BLE_RSSI_WINDOW];\n'
source += '\n'.join(function(name) for name in names)
source += r'''
void sample(int rssi,int count=100){for(int i=0;i<count;++i){bleLastSeenMs=clockMs;addRSSIReading(rssi);checkGateDanger();}}
int main(){
 sample(-95); assert(proximity==PROXIMITY_FAR && !gateDangerArmed);
 sample(-40); assert(dangerEvents==0);
 attendanceStatus="PRESENT";farHits=0;gateDangerArmed=false;
 sample(-40);assert(!gateDangerArmed && dangerEvents==0);
 sample(-95);assert(gateDangerArmed);
 sample(-40);assert(dangerEvents==1);
 sample(-40);assert(dangerEvents==1);
 sample(-95);sample(-40);assert(dangerEvents==2);
 gatePassAuthorized=true;gateDangerArmed=false;sample(-95);assert(!gateDangerArmed);
 sample(-40);assert(dangerEvents==2);
 gatePassAuthorized=false;sample(-95);assert(gateDangerArmed);
 resetBLEFilter();setProximity(PROXIMITY_UNKNOWN);assert(!gateDangerArmed);
 sample(-40);assert(dangerEvents==2);
 sample(-95);assert(gateDangerArmed);
 WiFi.connected=0;sample(-40);assert(dangerEvents==2);
 WiFi.connected=1;gateStateValid=false;checkGateDanger();assert(dangerEvents==2);
 gateStateValid=true;lastGoodGateStateMs=clockMs-GATE_STATE_MAX_AGE_MS-1;checkGateDanger();assert(dangerEvents==2);
 lastGoodGateStateMs=clockMs;bleLastSeenMs=clockMs-BLE_SIGNAL_TIMEOUT_MS-1;checkGateDanger();assert(dangerEvents==2);
 attendanceStatus="CHECKED_OUT";bleLastSeenMs=clockMs;checkGateDanger();assert(dangerEvents==2);
 attendanceStatus="NOT_CHECKED_IN";gateDangerArmed=true;dangerEventReported=true;
 pendingEventId="old-event";pendingAttendanceJson="old-body";pendingArmedFARJson="old-far";
 applyAttendanceEpoch("reset-1");
 assert(!gateDangerArmed && !dangerEventReported && pendingEventId.empty() && pendingAttendanceJson.empty() && pendingArmedFARJson.empty());
 sample(-40);assert(!arrivalArmed && resetArrivalNeedsFar && !gateDangerArmed);
 sample(-95);assert(arrivalArmed && !resetArrivalNeedsFar && !gateDangerArmed);
 sample(-40);assert(arrivalArmed && !gateDangerArmed);
 applyAttendanceEpoch("reset-1");assert(arrivalArmed && !resetArrivalNeedsFar);
 attendanceEpoch="";arrivalArmed=true;applyAttendanceEpoch("reset-1");
 assert(!arrivalArmed && resetArrivalNeedsFar); // reboot into an existing reset while NEAR
 sample(-40);assert(!arrivalArmed);
 sample(-95);assert(arrivalArmed);
 applyAttendanceEpoch("reset-2");assert(!arrivalArmed && resetArrivalNeedsFar);
 std::cout<<"PASS: actual sketch guards for pending, approval while near, FAR arming, repeated approaches, gate pass, UNKNOWN, Wi-Fi/backend/BLE freshness and checkout\n";
}
'''
with tempfile.TemporaryDirectory(prefix='childguard-firmware-test-') as directory:
    cpp = Path(directory) / 'test.cpp'
    cpp.write_text(source)
    executable = Path(directory) / 'gate-test'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', str(cpp), '-o', str(executable)], check=True)
    subprocess.run([str(executable)], check=True)
