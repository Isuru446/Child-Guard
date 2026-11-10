"""Native checks of the actual per-beacon filter. No ESP32/Arduino claims."""
from pathlib import Path
import subprocess
import tempfile
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--compiler', default='g++')
parser.add_argument('--compile-only', action='store_true', help='Compile fixtures without claiming host execution')
args = parser.parse_args()

def check_fixture(cpp, executable):
    command = [args.compiler, '-std=c++17', '-Wall', '-Wextra', '-Werror', '-I', str(header.parent), str(cpp)]
    if args.compile_only:
        command += ['-c']
    command += ['-o', str(executable)]
    subprocess.run(command, check=True)
    if not args.compile_only:
        subprocess.run([str(executable)], check=True)
    else:
        print('COMPILED ONLY (not executed):', cpp.name)

header = Path(__file__).resolve().parents[1] / 'ChildGuard_Wearable_Integrated/BeaconTracker.h'
source = r'''
#include <cassert>
#include <iostream>
#include "BeaconTracker.h"
using Tracker=BeaconTracker<8,6,3>;
void samples(Tracker &t,int value,float entry=-63,float exit=-69){for(int i=0;i<30;i++)t.sample(value,entry,exit,1000+i);}
int main(){
 Tracker gate,pool,stairs;
 samples(gate,-90);samples(pool,-45);
 assert(gate.state==Tracker::FAR && pool.state==Tracker::NEAR && stairs.state==Tracker::UNKNOWN);
 assert(gate.rssi==-90 && pool.rssi==-45);
 Tracker spike;samples(spike,-90);spike.sample(-40,-63,-69,2000);assert(spike.state==Tracker::FAR); // transient spike is not entry
 pool.alerted=true;pool.resetSignal();
 assert(pool.state==Tracker::UNKNOWN && pool.alerted); // loss cannot rearm an alert
 assert(gate.state==Tracker::FAR && gate.rssi==-90);
 samples(pool,-45);assert(pool.state==Tracker::NEAR && pool.alerted);
 samples(pool,-90);assert(pool.state==Tracker::FAR && !pool.alerted);
 samples(pool,-45);assert(pool.state==Tracker::NEAR && !pool.alerted);
 samples(stairs,-65,-60,-75);assert(stairs.state==Tracker::OBSERVING); // independent thresholds
 samples(stairs,-50,-60,-75);assert(stairs.state==Tracker::NEAR);
 samples(stairs,-65,-60,-75);assert(stairs.state==Tracker::NEAR); // hysteresis band
 samples(stairs,-80,-60,-75);assert(stairs.state==Tracker::FAR);
 float before=gate.rssi;gate.sample(-128,-63,-69,2000);gate.sample(1,-63,-69,2000);assert(gate.rssi==before);
 Tracker confirming;
 for(int i=0;i<7;i++) confirming.sample(-50,-63,-69,i);
 assert(confirming.state==Tracker::OBSERVING);
 confirming.sample(-50,-63,-69,8);assert(confirming.state==Tracker::NEAR);
 std::cout<<"PASS: actual independent filters, per-beacon thresholds, confirmation counts, hysteresis, UNKNOWN isolation and FAR-only rearming\n";
}
'''
with tempfile.TemporaryDirectory(prefix='childguard-multi-host-', dir=header.parent.parent) as directory:
    cpp = Path(directory) / 'test.cpp'
    cpp.write_text(source)
    executable = Path(directory) / 'multi-test'
    check_fixture(cpp, executable)

# Compile actual runtime routing/eligibility functions with native I/O stubs.
runtime = (header.parent / 'MultiBeaconRuntime.h').read_text()
def extract(name):
    start = runtime.index(name + '(')
    start = runtime.rfind('\n', 0, start) + 1
    opening = runtime.index('{', start)
    depth, end = 1, opening + 1
    while depth:
        depth += (runtime[end] == '{') - (runtime[end] == '}')
        end += 1
    return runtime[start:end]

prefix = runtime[runtime.index('constexpr int MAX_ZONE_BEACONS'):runtime.index('bool validBeaconIdentifier')]
source = r'''
#include <cassert>
#include <cstring>
#include <cctype>
#include <iostream>
#include <string>
#include <vector>
#include "BeaconTracker.h"
using String=std::string;
#define BLE_RSSI_WINDOW 8
#define BLE_MIN_READINGS 6
#define BLE_CONFIRM_READINGS 3
#define BLE_SIGNAL_TIMEOUT_MS 4000
#define portENTER_CRITICAL(x) ((void)0)
#define portEXIT_CRITICAL(x) ((void)0)
int bleMux=0;
unsigned long clockMs=100000;
unsigned long millis(){return clockMs;}
struct BLEReading {int rssi;unsigned long receivedAt;};
struct {template<class T> void print(T){}template<class T> void println(T){}template<class... T> void printf(const char *,T...){} } Serial;
const char *GATE_UUID="7b700001-24a6-4a25-9d3b-21c547a10001";
struct NimBLEUUID {String value;NimBLEUUID(const char *v):value(v){}};
struct NimBLEAdvertisedDevice {
 std::vector<String> services;int rssi=-50;
 bool isAdvertisingService(const NimBLEUUID &uuid) const {for(auto &s:services)if(s==uuid.value)return true;return false;}
 int getRSSI() const{return rssi;}
};
bool freshGate=true,gateDangerArmed=true,zoneMonitoringArmed=true,gatePassAuthorized=false;
String zoneMonitoringSession="session";
unsigned long zoneDepartureUptimeMs=0;
unsigned long pendingArmedFARAtMs=0;
bool hasFreshGateState(){return freshGate;}
String attendanceStatus="NOT_CHECKED_IN",lastAttendanceDay="2026-10-22",attendanceEpoch="";
'''
source += prefix
source += '\n'.join(extract(name) for name in ['validBeaconIdentifier', 'validBeaconUuid', 'zonesConfigFresh', 'captureZoneAdvertisement', 'zoneState'])
source += r'''
int dangerCounts[MAX_ZONE_BEACONS]={},bleCounts[MAX_ZONE_BEACONS]={};
void queueZoneObservation(ZoneRuntime &z,bool danger=false){
 int slot=&z-zoneBeacons;
 if(danger){++dangerCounts[slot];z.pendingDanger="event";z.dangerAt=millis();}
 else{++bleCounts[slot];z.pendingBLE="reading-"+std::to_string(bleCounts[slot]);z.bleAt=millis();z.lastReport=millis();z.lastState=zoneState(z);}
}
'''
source += '\n'.join(extract(name) for name in ['processZoneBeacons', 'zoneTelemetryPending'])
source += r'''
void sampleZone(int slot,int rssi){for(int i=0;i<30;i++)zoneBeacons[slot].filter.sample(rssi,-63,-69,millis());}
int main(){
 haveBeaconConfig=true;lastConfigSuccess=millis();
 const char *pool="6f50c597-34c5-4707-be46-a51ed3942468",*stairs="7b700003-24a6-4a25-9d3b-21c547a10001";
 assert(validBeaconIdentifier("CG-DZ-01"));assert(!validBeaconIdentifier("invalid id"));
 assert(validBeaconUuid(pool));assert(!validBeaconUuid("invalid"));
 for(int i=0;i<2;i++){zoneBeacons[i].config.active=true;strcpy(zoneBeacons[i].config.uuid,i?stairs:pool);strcpy(zoneBeacons[i].config.id,i?"CG-DZ-02":"CG-DZ-01");}
 NimBLEAdvertisedDevice a{{pool},-45},b{{stairs},-90},g{{GATE_UUID},-80},ambiguous{{pool,GATE_UUID},-40},unknown{{"unregistered"},-50};
 assert(!captureZoneAdvertisement(&unknown));
 for(int i=0;i<20;i++)captureZoneAdvertisement(&a);
 assert(zoneDroppedPackets>0);assert(captureZoneAdvertisement(&b));assert(!captureZoneAdvertisement(&g));
 auto previous=zoneBeacons[0].head;assert(captureZoneAdvertisement(&ambiguous));assert(zoneBeacons[0].head==previous);
 processZoneBeacons();assert(zoneBeacons[1].filter.count==1); // busy pool did not starve stairs
 sampleZone(0,-45);sampleZone(1,-45);processZoneBeacons();assert(dangerCounts[0]==0&&dangerCounts[1]==0);
 attendanceStatus="PRESENT";processZoneBeacons();assert(dangerCounts[0]==0&&dangerCounts[1]==0); // already NEAR cannot alert
 gateDangerArmed=false; // Gate radio UNKNOWN must not disarm the server-authorized zone session
 sampleZone(0,-90);sampleZone(1,-90);processZoneBeacons();
 sampleZone(0,-45);sampleZone(1,-45);processZoneBeacons();assert(dangerCounts[0]==1&&dangerCounts[1]==1);
 auto evidence=zoneBeacons[0].pendingNear;auto evidenceAt=zoneBeacons[0].nearAt;
 assert(!evidence.empty());
 clockMs+=15001;sampleZone(0,-45);sampleZone(1,-45);processZoneBeacons();
 assert(zoneBeacons[0].pendingNear==evidence&&zoneBeacons[0].nearAt==evidenceAt);
 assert(zoneBeacons[0].pendingBLE!=evidence); // routine heartbeat cannot replace entry evidence
 zoneBeacons[0].pendingDanger="";zoneBeacons[1].pendingDanger="";processZoneBeacons();assert(dangerCounts[0]==1);
 zoneBeacons[0].pendingFAR="obsolete-far";
 clockMs+=4001;zoneBeacons[1].filter.lastSeen=millis();processZoneBeacons();
 assert(zoneBeacons[0].filter.state==ZoneFilter::UNKNOWN&&zoneBeacons[1].filter.state==ZoneFilter::NEAR);
 assert(zoneBeacons[0].pendingFAR.empty()&&zoneBeacons[0].pendingNear.empty());
 sampleZone(0,-45);processZoneBeacons();assert(dangerCounts[0]==1); // loss is not FAR
 sampleZone(0,-90);processZoneBeacons();sampleZone(0,-45);processZoneBeacons();assert(dangerCounts[0]==2&&dangerCounts[1]==1);
 attendanceEpoch="reset-1";attendanceStatus="NOT_CHECKED_IN";processZoneBeacons();assert(zoneBeacons[0].pendingDanger.empty());assert(dangerCounts[0]==2);
 attendanceStatus="PRESENT";freshGate=false;processZoneBeacons();assert(dangerCounts[0]==2);
 freshGate=true;processZoneBeacons();assert(dangerCounts[0]==2);
 sampleZone(0,-90);processZoneBeacons();sampleZone(0,-45);processZoneBeacons();assert(dangerCounts[0]==3);
 clockMs=lastConfigSuccess+CONFIG_TTL_MS+1;processZoneBeacons();assert(!zoneTelemetryPending()&&configStaleLogged);
 std::cout<<"PASS: actual runtime UUID routing, ambiguous identity rejection, independent queues/loss, already-NEAR prevention, reset, stale configuration and FAR-only rearming\n";
}
'''
with tempfile.TemporaryDirectory(prefix='childguard-multi-runtime-', dir=header.parent.parent) as directory:
    cpp = Path(directory) / 'runtime.cpp'
    cpp.write_text(source)
    executable = Path(directory) / 'runtime-test'
    check_fixture(cpp, executable)
