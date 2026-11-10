#include <Arduino.h>
#include <esp_system.h>
#include <Wire.h>
#include <WiFi.h>
#include <ctype.h>
#include <HTTPClient.h>
#include <WiFiClient.h>
#include <Preferences.h>
#include <TinyGPS++.h>
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include <math.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>
// =====================================================
// CHILDGUARD WEARABLE
//
// ESP32-C3
//
// MPU6050 + GPS + BLE + WIFI + ATTENDANCE
//
// ATTENDANCE:
// Gate near -> backend -> teacher confirmation
//
// DANGER ZONE:
// Teacher-confirmed PRESENT
// -> move away from gate
// -> later approach -> local danger event
//
// Experimental prototype firmware.
// =====================================================
// =====================================================
// 1. DEVICE CONFIGURATION
// =====================================================
const char *DEVICE_ID =
  "CG-WEARABLE-001";
const char *GATE_ID =
  "CG-GATE-01";
const char *GATE_UUID =
  "7b700001-24a6-4a25-9d3b-21c547a10001";
// =====================================================
// 2. WIFI AND BACKEND CONFIGURATION
// =====================================================
// Create secrets.h by copying secrets.example.h.
// Never commit your real Wi-Fi password or device token.
#include "secrets.h"
const unsigned long WIFI_RETRY_MS = 20000;
const unsigned long GATE_STATE_POLL_MS = 3000;
const unsigned long GATE_STATE_MAX_AGE_MS = 15000;
const unsigned long ATTENDANCE_RETRY_MS = 5000;
// Prototype telemetry: HTTPS and better scheduling needed before deployment.
const unsigned long TELEMETRY_SEND_INTERVAL_MS = 5000;
// Transition evidence uses a bounded prompt retry path; periodic telemetry stays 5 s.
// TelemetrySchedule.h: 500 ms safety attempts, 5000 ms ordinary/retry attempts.
const unsigned long ACTIVITY_TELEMETRY_INTERVAL_MS = 15000;
const unsigned long GPS_TELEMETRY_INTERVAL_MS = 10000;
#define TELEMETRY_QUEUE_SIZE 12
// =====================================================
// 3. HARDWARE PINS
// =====================================================
#define MPU_SDA_PIN 0
#define MPU_SCL_PIN 1
#define MPU_ADDRESS 0x68
#define GPS_RX_PIN 7
#define GPS_TX_PIN 6
#define GPS_BAUD 9600
// =====================================================
// 4. SAMPLING
// =====================================================
#define SAMPLE_INTERVAL_MS 20
#define WINDOW_SAMPLES 100
#define GPS_REPORT_INTERVAL_MS 5000
#define GPS_DATA_TIMEOUT_MS 5000
#define GPS_FIX_MAX_AGE_MS 5000
#define BLE_REPORT_INTERVAL_MS 1000
#define BLE_SIGNAL_TIMEOUT_MS 4000
#define BLE_RSSI_WINDOW 8
#define BLE_MIN_READINGS 6
#define BLE_CONFIRM_READINGS 3
#define GYRO_CALIBRATION_SAMPLES 500
// =====================================================
// 5. OBJECTS
// =====================================================
Preferences preferences;
HardwareSerial gpsSerial(1);
TinyGPSPlus gpsParser;
String deviceBootId = String(esp_random(), HEX) + "-" + String(esp_random(), HEX);
uint32_t gpsEvidenceSequence = 0;
NimBLEScan *bleScan = nullptr;
// =====================================================
// 6. MPU6050 CALIBRATION
//
// From our 3000-measurement experiment.
// Saved values in Preferences take precedence.
// =====================================================
float accelOffsetX = 0.034447f;
float accelOffsetY = 0.001975f;
float accelOffsetZ = 0.033938f;
float accelScaleX = 1.000194f;
float accelScaleY = 0.999221f;
float accelScaleZ = 0.974000f;
float gyroOffsetX = 0;
float gyroOffsetY = 0;
float gyroOffsetZ = 0;
bool gyroCalibrated = false;
// =====================================================
// 7. ACTIVITY CONFIGURATION
//
// Provisional until movement experiments.
// =====================================================
float accelThreshold = 0.04f;
float gyroThreshold = 4.0f;
unsigned long inactivityLimit = 60;
bool thresholdConfigured = false;
bool durationConfigured = false;
float accelSumSquares = 0;
float gyroSumSquares = 0;
int sampleCount = 0;
unsigned long lastSampleTime = 0;
unsigned long windowStartTime = 0;
unsigned long inactiveDurationMs = 0;
// =====================================================
// 8. GPS VARIABLES
// =====================================================
unsigned long lastGPSByteTime = 0;
unsigned long lastGPSReport = 0;
unsigned long gpsBytesReceived = 0;
bool gpsEverReceivedData = false;
// =====================================================
// 9. BLE CONFIGURATION
// =====================================================
float dangerEntryRSSI = -63.0f;
float dangerExitRSSI = -69.0f;
float attendanceRSSI = -55.0f;
// =====================================================
// 10. BLE PACKET BUFFER
// =====================================================
#define BLE_QUEUE_SIZE 32
struct BLEReading {
  int rssi;
  unsigned long receivedAt;
};
BLEReading bleQueue[BLE_QUEUE_SIZE];
volatile uint8_t bleQueueHead = 0;
volatile uint8_t bleQueueTail = 0;
volatile unsigned long bleLastSeenMs = 0;
volatile bool bleEverSeen = false;
volatile unsigned long bleDroppedPackets = 0;
portMUX_TYPE bleMux =
  portMUX_INITIALIZER_UNLOCKED;
// =====================================================
// 11. FILTER AND PROXIMITY STATE
// =====================================================
int rssiBuffer[BLE_RSSI_WINDOW];
int rssiCount = 0;
int rssiIndex = 0;
float rssiSum = 0;
float filteredRSSI = -127;
int nearHits = 0;
int farHits = 0;
int attendanceHits = 0;
unsigned long lastBLEReport = 0;
enum ProximityState {
  PROXIMITY_UNKNOWN,
  PROXIMITY_OBSERVING,
  PROXIMITY_FAR,
  PROXIMITY_NEAR
};
ProximityState proximity =
  PROXIMITY_UNKNOWN;
// =====================================================
// 12. BACKEND ATTENDANCE STATE
// =====================================================
String attendanceStatus = "UNKNOWN";
String attendanceEpoch = "";
bool resetArrivalNeedsFar = false;
String lastAttendanceDay = "";
bool gatePassAuthorized = false;
bool gateStateValid = false;
unsigned long lastGoodGateStateMs = 0;
unsigned long lastGatePollMs = 0;
unsigned long lastWiFiAttemptMs = 0;
unsigned long lastAttendanceAttemptMs = 0;
bool attendanceReportSent = false;
bool arrivalArmed = true;
bool gateDangerArmed = false;
// Backend-authorized ordinary-zone session; independent of live Gate RSSI.
bool zoneMonitoringArmed = false;
String zoneMonitoringSession = "";
unsigned long zoneDepartureUptimeMs = 0;
// Episode latch: queued/handled, never proof that the server created an alert.
bool dangerEventReported = false;
unsigned long attendanceEventSequence = 0;
String pendingEventId = "";
String pendingAttendanceJson = "";
struct QueuedTelemetry {
  String json;
  unsigned long queuedAtMs = 0;
};
QueuedTelemetry pendingGPS;
unsigned long lastGPSAttemptMs=0;
QueuedTelemetry telemetryQueue[TELEMETRY_QUEUE_SIZE];
uint8_t telemetryHead = 0;
uint8_t telemetryTail = 0;
unsigned long lastTelemetrySendAttemptMs = 0;
bool telemetryRetryNeeded = false;
unsigned long lastActivityTelemetryMs = 0;
unsigned long lastGPSTelemetryMs = 0;
unsigned long lastSampleGapEventMs = 0;
String lastActivityStateSent = "";
String lastGPSStatusSent = "";
// One coalesced BLE slot: outages cannot fill the workflow telemetry queue.
String pendingBLEJson = "";
String pendingArmedFARJson = "";
unsigned long pendingArmedFARAtMs = 0;
unsigned long pendingBLEAtMs = 0;
unsigned long lastBLEObservationMs = 0;
String lastBLEStateSent = "";
bool preferBLETelemetry = true;
void queueBLEObservation(bool force = false);
void queueDeviceTelemetry(
  const char *eventType,
  const char *activityState,
  float accelRms,
  float gyroRms,
  float eventRssi
);
// =====================================================
// 13. SENSOR STRUCTURE
// =====================================================
struct SensorData {
  float ax;
  float ay;
  float az;
  float gx;
  float gy;
  float gz;
};
// =====================================================
// 14. BLE CALLBACK
// =====================================================
void configureRequest(HTTPClient &http);
void logBackendError(HTTPClient &http,int status) {
  JsonDocument result;
  if(deserializeJson(result,http.getString())){Serial.printf("BACKEND_ERROR HTTP=%d code=UNREADABLE_RESPONSE\n",status);return;}
  // Print only the structured code, never headers, body, tokens or credentials.
  String code=result["error"]["code"]|"UNKNOWN";
  for(size_t i=0;i<code.length();++i)if(!isalnum((unsigned char)code[i])&&code[i]!='_'){code="UNKNOWN";break;}
  Serial.printf("BACKEND_ERROR HTTP=%d code=%s\n",status,code.substring(0,64).c_str());
}
// Delivery is terminal on deliberate rejection/suppression; only backend truth is an alert.
void logTelemetryResult(JsonVariantConst result,int status) {
  bool handled=status>=200&&status<300&&!result["eventId"].isNull();
  JsonVariantConst alert=result["alertCreated"].is<bool>()?result["alertCreated"]:result["geofence"]["alertCreated"];
  Serial.printf("EVENT_RESULT eventId=%s HTTP=%d stored=%s processed=%s duplicate=%s alert=%s reason=%s\n",result["eventId"]|"unknown",status,
    handled?"yes":"unknown",handled?"yes":"unknown",
    result["duplicate"].as<bool>()?"yes":"no",
    alert.is<bool>()?(alert.as<bool>()?"created":"none"):"unknown",
    result["suppressionReason"] | (result["geofence"]["reason"] | (result["error"]["code"] | "none")));
}
void flushFreshGPS() {
  if(!pendingGPS.json.length())return;
  unsigned long age=millis()-pendingGPS.queuedAtMs;
  if(age>1000){pendingGPS.json="";Serial.println("GPS_QUEUE_EXPIRED");return;}
  if(WiFi.status()!=WL_CONNECTED || (lastGPSAttemptMs && millis()-lastGPSAttemptMs<250))return;
  lastGPSAttemptMs=millis();
  WiFiClient client;HTTPClient http;
  if(!http.begin(client,String(BACKEND_URL)+"/api/events"))return;
  configureRequest(http);http.addHeader("Content-Type","application/json");
  JsonDocument event;deserializeJson(event,pendingGPS.json);
  event["gpsQueueAgeMs"]=(unsigned long)(millis()-pendingGPS.queuedAtMs);
  if(event["gpsQueueAgeMs"].as<unsigned long>()>1000){pendingGPS.json="";http.end();return;}
  String body;serializeJson(event,body);int code=http.POST(body);
  JsonDocument result;bool parsed=!deserializeJson(result,http.getString());
  if(parsed)logTelemetryResult(result["data"].isNull()?result.as<JsonVariantConst>():result["data"].as<JsonVariantConst>(),code);
  if(code>=200&&code<300 && (!parsed || String(result["data"]["eventId"]|"")!=String(event["eventId"]|"")))code=-100;
  Serial.printf("GPS_HTTP %d queueAgeMs=%lu\n",code,age);http.end();
  if((code>=200&&code<300)||code==400||code==409||code==422)pendingGPS.json="";
}
#include "MultiBeaconRuntime.h"
#include "BusTransportRuntime.h"
#include "ActivityRuntime.h"
#include "ActivitySampler.h"
#include "TamperRuntime.h"
class GateScanCallbacks :
  public NimBLEScanCallbacks {
  void onScanEnd(const NimBLEScanResults &, int) override { busTransport::scanStopped(); }
  void onResult(
    const NimBLEAdvertisedDevice *device
  ) override {
    if(busTransport::capture(device)) return;
    if(captureZoneAdvertisement(device)) return;
    static const NimBLEUUID gateUUID(
      GATE_UUID
    );
    if (
      !device->isAdvertisingService(
        gateUUID
      )
    ) {
      return;
    }
    int rssi = device->getRSSI();
    if (
      rssi > 0 ||
      rssi < -127
    ) {
      return;
    }
    unsigned long now = millis();
    portENTER_CRITICAL(&bleMux);
    uint8_t nextHead =
      (bleQueueHead + 1) %
      BLE_QUEUE_SIZE;
    if (
      nextHead != bleQueueTail
    ) {
      bleQueue[bleQueueHead].rssi =
        rssi;
      bleQueue[bleQueueHead].receivedAt =
        now;
      bleQueueHead = nextHead;
    } else {
      bleDroppedPackets++;
    }
    bleLastSeenMs = now;
    bleEverSeen = true;
    portEXIT_CRITICAL(&bleMux);
  }
};
GateScanCallbacks gateScanCallbacks;
// =====================================================
// 15. MPU REGISTER WRITE
// =====================================================
bool writeMPURegister(
  uint8_t reg,
  uint8_t value
) {
  ActivityBusGuard busGuard;
  Wire.beginTransmission(
    MPU_ADDRESS
  );
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}
// =====================================================
// 16. READ CALIBRATED MPU6050
// =====================================================
bool readMPU(
  SensorData &data
) {
  ActivityBusGuard busGuard;
  Wire.beginTransmission(
    MPU_ADDRESS
  );
  Wire.write(0x3B);
  if (
    Wire.endTransmission(false) != 0
  ) {
    return false;
  }
  int received =
    Wire.requestFrom(
      (uint8_t)MPU_ADDRESS,
      (uint8_t)14,
      (uint8_t)true
    );
  if (received != 14) {
    return false;
  }
  int16_t rawAX =
    (int16_t)(
      (Wire.read() << 8) |
      Wire.read()
    );
  int16_t rawAY =
    (int16_t)(
      (Wire.read() << 8) |
      Wire.read()
    );
  int16_t rawAZ =
    (int16_t)(
      (Wire.read() << 8) |
      Wire.read()
    );
  Wire.read();
  Wire.read();
  int16_t rawGX =
    (int16_t)(
      (Wire.read() << 8) |
      Wire.read()
    );
  int16_t rawGY =
    (int16_t)(
      (Wire.read() << 8) |
      Wire.read()
    );
  int16_t rawGZ =
    (int16_t)(
      (Wire.read() << 8) |
      Wire.read()
    );
  data.ax =
    ((rawAX / 16384.0f) -
      accelOffsetX) *
    accelScaleX;
  data.ay =
    ((rawAY / 16384.0f) -
      accelOffsetY) *
    accelScaleY;
  data.az =
    ((rawAZ / 16384.0f) -
      accelOffsetZ) *
    accelScaleZ;
  data.gx =
    rawGX / 131.0f -
    gyroOffsetX;
  data.gy =
    rawGY / 131.0f -
    gyroOffsetY;
  data.gz =
    rawGZ / 131.0f -
    gyroOffsetZ;
  return true;
}
// =====================================================
// 17. LOAD CALIBRATION AND CONFIGURATION
// =====================================================
bool loadSettings() {
  Serial.println(
    "Loading ChildGuard settings..."
  );
  if (
    preferences.getBool(
      "accOK", false
    )
  ) {
    accelOffsetX =
      preferences.getFloat(
        "axOff", NAN
      );
    accelOffsetY =
      preferences.getFloat(
        "ayOff", NAN
      );
    accelOffsetZ =
      preferences.getFloat(
        "azOff", NAN
      );
    accelScaleX =
      preferences.getFloat(
        "axScale", NAN
      );
    accelScaleY =
      preferences.getFloat(
        "ayScale", NAN
      );
    accelScaleZ =
      preferences.getFloat(
        "azScale", NAN
      );
    if (
      !isfinite(accelOffsetX) ||
      !isfinite(accelOffsetY) ||
      !isfinite(accelOffsetZ) ||
      !isfinite(accelScaleX) ||
      !isfinite(accelScaleY) ||
      !isfinite(accelScaleZ) ||
      accelScaleX <= 0 ||
      accelScaleY <= 0 ||
      accelScaleZ <= 0
    ) {
      Serial.println(
        "Invalid accelerometer calibration"
      );
      return false;
    }
    Serial.println(
      "ACCEL CALIBRATION LOADED"
    );
  }
  gyroCalibrated =
    preferences.getBool(
      "gyroOK", false
    );
  if (gyroCalibrated) {
    gyroOffsetX =
      preferences.getFloat(
        "gxOff", NAN
      );
    gyroOffsetY =
      preferences.getFloat(
        "gyOff", NAN
      );
    gyroOffsetZ =
      preferences.getFloat(
        "gzOff", NAN
      );
    gyroCalibrated =
      isfinite(gyroOffsetX) &&
      isfinite(gyroOffsetY) &&
      isfinite(gyroOffsetZ);
    if (gyroCalibrated) {
      Serial.println(
        "GYRO CALIBRATION LOADED"
      );
    }
  }
  if (!gyroCalibrated) {
    gyroOffsetX = 0;
    gyroOffsetY = 0;
    gyroOffsetZ = 0;
    Serial.println(
      "Gyroscope calibration required"
    );
  }
  accelThreshold =
    preferences.getFloat(
      "actAcc", 0.04f
    );
  gyroThreshold =
    preferences.getFloat(
      "actGyro", 4.0f
    );
  inactivityLimit =
    preferences.getULong(
      "actTime", 60
    );
  thresholdConfigured =
    preferences.getBool(
      "thrReady", false
    );
  durationConfigured =
    preferences.getBool(
      "durReady", false
    );
  if (
    !isfinite(accelThreshold) ||
    !isfinite(gyroThreshold) ||
    accelThreshold <= 0 ||
    gyroThreshold <= 0
  ) {
    thresholdConfigured = false;
  }
  if (
    inactivityLimit == 0 ||
    inactivityLimit > 86400
  ) {
    durationConfigured = false;
  }
  float entry =
    preferences.getFloat(
      "bleIn", -63.0f
    );
  float exit =
    preferences.getFloat(
      "bleOut", -69.0f
    );
  if (
    isfinite(entry) &&
    isfinite(exit) &&
    entry > exit &&
    entry >= -100 &&
    entry <= -25 &&
    exit >= -110
  ) {
    dangerEntryRSSI = entry;
    dangerExitRSSI = exit;
  }
  float savedAttendance =
    preferences.getFloat(
      "attIn", -55.0f
    );
  if (
    isfinite(savedAttendance) &&
    savedAttendance >= -100 &&
    savedAttendance <= -25
  ) {
    attendanceRSSI =
      savedAttendance;
  }
  Serial.println(
    "SETTINGS LOADED"
  );
  return true;
}
// =====================================================
// 18. GYROSCOPE CALIBRATION
// =====================================================
void calibrateGyro() {
  if (
    attendanceStatus == "PRESENT" ||
    proximity == PROXIMITY_NEAR
  ) {
    Serial.println(
      "Calibration blocked during gate monitoring"
    );
    return;
  }
  Serial.println();
  Serial.println(
    "Keep MPU6050 stationary!"
  );
  delay(3000);
  float sx = 0;
  float sy = 0;
  float sz = 0;
  float sx2 = 0;
  float sy2 = 0;
  float sz2 = 0;
  float sm = 0;
  float sm2 = 0;
  SensorData d;
  for (
    int i = 0;
    i < GYRO_CALIBRATION_SAMPLES;
    i++
  ) {
    if (!readMPU(d)) {
      Serial.println(
        "Calibration read error"
      );
      return;
    }
    float x =
      d.gx + gyroOffsetX;
    float y =
      d.gy + gyroOffsetY;
    float z =
      d.gz + gyroOffsetZ;
    sx += x;
    sy += y;
    sz += z;
    sx2 += x * x;
    sy2 += y * y;
    sz2 += z * z;
    float mag = sqrtf(
      d.ax * d.ax +
      d.ay * d.ay +
      d.az * d.az
    );
    sm += mag;
    sm2 += mag * mag;
    while (gpsSerial.available()) {
      gpsParser.encode(
        (char)gpsSerial.read()
      );
      lastGPSByteTime = millis();
      gpsEverReceivedData = true;
    }
    delay(5);
  }
  float n =
    GYRO_CALIBRATION_SAMPLES;
  float mx = sx / n;
  float my = sy / n;
  float mz = sz / n;
  float mm = sm / n;
  float stdX = sqrtf(
    fmaxf(
      0.0f,
      sx2 / n - mx * mx
    )
  );
  float stdY = sqrtf(
    fmaxf(
      0.0f,
      sy2 / n - my * my
    )
  );
  float stdZ = sqrtf(
    fmaxf(
      0.0f,
      sz2 / n - mz * mz
    )
  );
  float stdMag = sqrtf(
    fmaxf(
      0.0f,
      sm2 / n - mm * mm
    )
  );
  if (
    stdX > 1.0f ||
    stdY > 1.0f ||
    stdZ > 1.0f ||
    stdMag > 0.04f ||
    mm < 0.8f ||
    mm > 1.2f
  ) {
    Serial.println(
      "CALIBRATION REJECTED: MOVEMENT"
    );
    return;
  }
  if (
    !preferences.putBool(
      "gyroOK", false
    )
  ) {
    Serial.println(
      "Flash write failed"
    );
    return;
  }
  gyroCalibrated = false;
  bool ok = true;
  ok &= preferences.putFloat(
    "gxOff", mx
  ) == 4;
  ok &= preferences.putFloat(
    "gyOff", my
  ) == 4;
  ok &= preferences.putFloat(
    "gzOff", mz
  ) == 4;
  if (
    !ok ||
    !preferences.putBool(
      "gyroOK", true
    )
  ) {
    Serial.println(
      "Gyro save failed"
    );
    return;
  }
  gyroOffsetX = mx;
  gyroOffsetY = my;
  gyroOffsetZ = mz;
  gyroCalibrated = true;
  Serial.println(
    "GYRO CALIBRATION SAVED"
  );
}
// =====================================================
// 19. ACTIVITY ANALYSIS
// =====================================================
void resetActivityWindow() {
  accelSumSquares = 0;
  gyroSumSquares = 0;
  sampleCount = 0;
  inactiveDurationMs = 0;
  windowStartTime = millis();
}
void analyzeActivity() {
  if (sampleCount == 0) {
    return;
  }
  float accelRMS = sqrtf(
    accelSumSquares /
    sampleCount
  );
  float gyroRMS = sqrtf(
    gyroSumSquares /
    sampleCount
  );
  Serial.println();
  Serial.println(
    "===== CHILDGUARD ACTIVITY ====="
  );
  Serial.print(
    "Acceleration RMS: "
  );
  Serial.print(
    accelRMS, 5
  );
  Serial.println(" g");
  Serial.print(
    "Gyroscope RMS: "
  );
  Serial.print(
    gyroRMS, 5
  );
  Serial.println(" deg/s");
  const char *stateForBackend = "UNKNOWN";
  if (!gyroCalibrated) {
    stateForBackend =
      "GYRO_NOT_CALIBRATED";
    Serial.println(
      "STATE: GYRO_NOT_CALIBRATED"
    );
    inactiveDurationMs = 0;
  } else if (
    !thresholdConfigured ||
    !durationConfigured
  ) {
    stateForBackend =
      "BASELINE_COLLECTION";
    Serial.println(
      "STATE: BASELINE_COLLECTION"
    );
    inactiveDurationMs = 0;
  } else {
    bool movement =
      accelRMS > accelThreshold ||
      gyroRMS > gyroThreshold;
    if (movement) {
      stateForBackend = "ACTIVE";
      Serial.println(
        "STATE: ACTIVE"
      );
      inactiveDurationMs = 0;
    } else {
      inactiveDurationMs +=
        millis() - windowStartTime;
      unsigned long seconds =
        inactiveDurationMs / 1000UL;
      if (
        seconds >= inactivityLimit
      ) {
        stateForBackend =
          "PROLONGED_INACTIVITY";
        Serial.println(
          "STATE: PROLONGED_INACTIVITY"
        );
      } else {
        stateForBackend = "INACTIVE";
        Serial.println(
          "STATE: INACTIVE"
        );
      }
      Serial.print(
        "Inactive seconds: "
      );
      Serial.println(seconds);
    }
  }
  if (
    String(stateForBackend) !=
      lastActivityStateSent ||
    millis() -
      lastActivityTelemetryMs >=
      ACTIVITY_TELEMETRY_INTERVAL_MS
  ) {
    queueDeviceTelemetry(
      "ACTIVITY_WINDOW",
      stateForBackend,
      accelRMS,
      gyroRMS,
      NAN
    );
    lastActivityStateSent =
      stateForBackend;
    lastActivityTelemetryMs =
      millis();
  }
  accelSumSquares = 0;
  gyroSumSquares = 0;
  sampleCount = 0;
  windowStartTime = millis();
}
void sampleMPU() {
  SensorData d;
  if(!recoverActivityMpu()){
    // Activity acquisition runs independently in activitySampleTask.
    return;
  }
  if (!readMPU(d)) {
    // Activity acquisition runs independently in activitySampleTask.
    mpuConfigured=false;
    Serial.println(
      "MPU6050 READ ERROR"
    );
    resetActivityWindow();
    return;
  }
  // MAD samples are acquired by activitySampleTask, independently of HTTP.
  float magnitude = sqrtf(
    d.ax * d.ax +
    d.ay * d.ay +
    d.az * d.az
  );
  float dynamicAccel =
    magnitude - 1.0f;
  float gyroMagnitude = sqrtf(
    d.gx * d.gx +
    d.gy * d.gy +
    d.gz * d.gz
  );
  accelSumSquares +=
    dynamicAccel *
    dynamicAccel;
  gyroSumSquares +=
    gyroMagnitude *
    gyroMagnitude;
  sampleCount++;
  if (
    sampleCount >=
      WINDOW_SAMPLES
  ) {
    analyzeActivity();
  }
}
// =====================================================
// 20. GPS
// =====================================================
void setupGPS() {
  gpsSerial.begin(
    GPS_BAUD,
    SERIAL_8N1,
    GPS_RX_PIN,
    GPS_TX_PIN
  );
  Serial.println(
    "GPS UART INITIALIZED"
  );
}
void processGPS() {
  int processed = 0;
  while (
    gpsSerial.available() &&
    processed < 96
  ) {
    char c =
      (char)gpsSerial.read();
    gpsParser.encode(c);
    gpsBytesReceived++;
    gpsEverReceivedData = true;
    lastGPSByteTime = millis();
    processed++;
  }
}
const char *gpsStatus() {
  unsigned long now = millis();
  if (
    !gpsEverReceivedData ||
    now - lastGPSByteTime >
      GPS_DATA_TIMEOUT_MS
  ) {
    return "GPS_NO_SERIAL";
  }
  if (
    !gpsParser.location.isValid() ||
    gpsParser.location.age() >
      GPS_FIX_MAX_AGE_MS
  ) {
    return "GPS_NO_FIX";
  }
  return "GPS_FIX";
}
void reportGPS() {
  if (
    millis() - lastGPSReport <
      GPS_REPORT_INTERVAL_MS
  ) {
    return;
  }
  lastGPSReport = millis();
  Serial.println();
  Serial.println(
    "===== CHILDGUARD GPS ====="
  );
  Serial.print("Status: ");
  Serial.println(gpsStatus());
  Serial.print(
    "Bytes received: "
  );
  Serial.println(
    gpsBytesReceived
  );
  gpsBytesReceived = 0;
  if (
    strcmp(
      gpsStatus(),
      "GPS_FIX"
    ) == 0
  ) {
    Serial.print("Latitude: ");
    Serial.println(
      gpsParser.location.lat(), 6
    );
    Serial.print("Longitude: ");
    Serial.println(
      gpsParser.location.lng(), 6
    );
  } else {
    Serial.println(
      "Location unavailable"
    );
    Serial.print(
      "Valid NMEA checksums: "
    );
    Serial.println(
      gpsParser.passedChecksum()
    );
  }
  String currentGPSStatus =
    gpsStatus();
  if (
    currentGPSStatus !=
      lastGPSStatusSent ||
    millis() -
      lastGPSTelemetryMs >=
      GPS_TELEMETRY_INTERVAL_MS
  ) {
    queueDeviceTelemetry(
      "GPS_STATUS",
      nullptr,
      NAN,
      NAN,
      NAN
    );
    lastGPSStatusSent =
      currentGPSStatus;
    lastGPSTelemetryMs =
      millis();
  }
}
// =====================================================
// 21. BLE INITIALIZATION
// =====================================================
void setupBLE() {
  NimBLEDevice::init(
    DEVICE_ID
  );
  bleScan =
    NimBLEDevice::getScan();
  bleScan->setScanCallbacks(
    &gateScanCallbacks,
    true
  );
  bleScan->setActiveScan(false);
  bleScan->setInterval(100);
  bleScan->setWindow(70);
  bleScan->setMaxResults(0);
  bool started =
    bleScan->start(
      0, false, true
    );
  Serial.println();
  if (started) {
    Serial.println(
      "BLE GATE SCANNING STARTED"
    );
  } else {
    Serial.println(
      "BLE SCAN START FAILED"
    );
  }
}
// =====================================================
// 22. BLE FILTER
// =====================================================
void resetBLEFilter() {
  rssiCount = 0;
  rssiIndex = 0;
  rssiSum = 0;
  filteredRSSI = -127;
  nearHits = 0;
  farHits = 0;
  attendanceHits = 0;
}
const char *proximityText() {
  switch (proximity) {
    case PROXIMITY_UNKNOWN:
      return "UNKNOWN";
    case PROXIMITY_OBSERVING:
      return "OBSERVING";
    case PROXIMITY_FAR:
      return "FAR";
    case PROXIMITY_NEAR:
      return "NEAR";
    default:
      return "UNKNOWN";
  }
}
// =====================================================
// 23. CHECK WHETHER BACKEND STATE IS FRESH
// =====================================================
bool hasFreshGateState() {
  return (
    gateStateValid &&
    WiFi.status() ==
      WL_CONNECTED &&
    millis() -
      lastGoodGateStateMs <=
      GATE_STATE_MAX_AGE_MS
  );
}
// Require fresh advertisements and new FAR confirmations after approval/recovery.
bool hasFreshBLESignal() {
  portENTER_CRITICAL(&bleMux);
  unsigned long seen = bleLastSeenMs;
  bool ever = bleEverSeen;
  portEXIT_CRITICAL(&bleMux);
  return ever && millis() - seen <= BLE_SIGNAL_TIMEOUT_MS;
}
void armGateDangerIfFar() {
  if (resetArrivalNeedsFar && attendanceStatus == "NOT_CHECKED_IN" &&
      hasFreshGateState() && hasFreshBLESignal() &&
      proximity == PROXIMITY_FAR && farHits >= BLE_CONFIRM_READINGS) {
    resetArrivalNeedsFar = false;
    arrivalArmed = true;
    queueBLEObservation(true);
    if (!pendingArmedFARJson.length()) {
      pendingArmedFARJson = pendingBLEJson;
      pendingArmedFARAtMs = pendingBLEAtMs;
    }
    pendingBLEJson = "";
  }
  if (attendanceStatus == "PRESENT" && !gatePassAuthorized &&
      hasFreshGateState() && hasFreshBLESignal() &&
      proximity == PROXIMITY_FAR && farHits >= BLE_CONFIRM_READINGS &&
      !gateDangerArmed) {
    gateDangerArmed = true;
    dangerEventReported = false;
    // Preserve arming evidence until accepted, even if NEAR quickly supersedes FAR.
    queueBLEObservation(true);
    if (!pendingArmedFARJson.length()) {
      pendingArmedFARJson = pendingBLEJson;
      pendingArmedFARAtMs = pendingBLEAtMs;
    }
    pendingBLEJson = "";
    Serial.println("GATE DANGER MONITORING ARMED");
  }
}
// =====================================================
// 24. APPLY A CONFIRMED BLE STATE
// =====================================================
void setProximity(
  ProximityState next
) {
  if (
    next == proximity
  ) {
    return;
  }
  ProximityState previous =
    proximity;
  proximity = next;
  queueBLEObservation(true);
  Serial.println();
  Serial.print(
    "GATE PROXIMITY: "
  );
  Serial.println(
    proximityText()
  );
  if (
    next == PROXIMITY_FAR
  ) {
    attendanceHits = 0;
    attendanceReportSent = false;
    pendingEventId = "";
    pendingAttendanceJson = "";
    if (
      attendanceStatus ==
        "NOT_CHECKED_IN"
    ) {
      arrivalArmed = !resetArrivalNeedsFar;
    }
    if (
      previous ==
        PROXIMITY_NEAR &&
      dangerEventReported
    ) {
      Serial.println(
        "EVENT: DANGER_ZONE_EXIT"
      );
      queueDeviceTelemetry(
        "DANGER_ZONE_EXIT",
        nullptr,
        NAN,
        NAN,
        filteredRSSI
      );
    }
    dangerEventReported = false;

  }
  if (
    next == PROXIMITY_UNKNOWN
  ) {
    gateDangerArmed = false;
    Serial.println(
      "GATE PROXIMITY UNKNOWN"
    );
  }
}
// =====================================================
// 25. PROCESS ONE RSSI READING
// =====================================================
void addRSSIReading(
  int rssi
) {
  if (
    proximity ==
      PROXIMITY_UNKNOWN
  ) {
    proximity =
      PROXIMITY_OBSERVING;
  }
  if (
    rssiCount <
      BLE_RSSI_WINDOW
  ) {
    rssiBuffer[rssiIndex] =
      rssi;
    rssiSum += rssi;
    rssiCount++;
  } else {
    rssiSum -=
      rssiBuffer[rssiIndex];
    rssiBuffer[rssiIndex] =
      rssi;
    rssiSum += rssi;
  }
  rssiIndex =
    (rssiIndex + 1) %
    BLE_RSSI_WINDOW;
  filteredRSSI =
    rssiSum / rssiCount;
  if (
    rssiCount <
      BLE_MIN_READINGS
  ) {
    return;
  }
  if (
    filteredRSSI >=
      attendanceRSSI
  ) {
    attendanceHits++;
  } else {
    attendanceHits = 0;
  }
  if (
    filteredRSSI >=
      dangerEntryRSSI
  ) {
    nearHits++;
    farHits = 0;
    if (
      nearHits >=
        BLE_CONFIRM_READINGS
    ) {
      setProximity(
        PROXIMITY_NEAR
      );
    }
  } else if (
    filteredRSSI <=
      dangerExitRSSI
  ) {
    farHits++;
    nearHits = 0;
    if (
      farHits >=
        BLE_CONFIRM_READINGS
    ) {
      setProximity(
        PROXIMITY_FAR
      );
      armGateDangerIfFar();
    }
  } else {
    nearHits = 0;
    farHits = 0;
  }
}
// =====================================================
// 26. PROCESS BLE PACKET QUEUE
// =====================================================
void processBLE() {
  BLEReading reading;
  while (true) {
    bool available = false;
    portENTER_CRITICAL(
      &bleMux
    );
    if (
      bleQueueTail !=
        bleQueueHead
    ) {
      reading =
        bleQueue[bleQueueTail];
      bleQueueTail =
        (bleQueueTail + 1) %
        BLE_QUEUE_SIZE;
      available = true;
    }
    portEXIT_CRITICAL(
      &bleMux
    );
    if (!available) {
      break;
    }
    if (
      millis() -
        reading.receivedAt <=
        BLE_SIGNAL_TIMEOUT_MS
    ) {
      addRSSIReading(
        reading.rssi
      );
    }
  }
  unsigned long lastSeen;
  bool everSeen;
  portENTER_CRITICAL(
    &bleMux
  );
  lastSeen =
    bleLastSeenMs;
  everSeen =
    bleEverSeen;
  portEXIT_CRITICAL(
    &bleMux
  );
  if (
    everSeen &&
    millis() - lastSeen >
      BLE_SIGNAL_TIMEOUT_MS
  ) {
    if (
      proximity !=
        PROXIMITY_UNKNOWN
    ) {
      resetBLEFilter();
      setProximity(
        PROXIMITY_UNKNOWN
      );
      Serial.println(
        "EVENT: BEACON_SIGNAL_LOST"
      );
      queueDeviceTelemetry(
        "BEACON_SIGNAL_LOST",
        nullptr,
        NAN,
        NAN,
        NAN
      );
    }
  }
}
// =====================================================
// 27. WIFI
// =====================================================
void maintainWiFi() {
  static unsigned long lastRetryMs = 0;
  if (
    WiFi.status() ==
      WL_CONNECTED
  ) {
    return;
  }
  if (
    lastRetryMs != 0 &&
    millis() - lastRetryMs <
      WIFI_RETRY_MS
  ) {
    return;
  }
  lastRetryMs = millis();
  Serial.println();
  Serial.println(
    "Wi-Fi disconnected. Reconnecting..."
  );
  bool restartBLE = false;
  if (
    bleScan != nullptr &&
    bleScan->isScanning()
  ) {
    bleScan->stop();
    restartBLE = true;
    Serial.println(
      "BLE scan paused for Wi-Fi reconnect"
    );
  }
  WiFi.disconnect(
    false,
    false
  );
  delay(100);
  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );
  unsigned long start =
    millis();
  while (
    WiFi.status() !=
      WL_CONNECTED &&
    millis() - start <
      15000
  ) {
    processGPS();
    delay(100);
  }
  if (
    WiFi.status() ==
      WL_CONNECTED
  ) {
    Serial.println(
      "Wi-Fi reconnected!"
    );
    Serial.print(
      "ESP32 IP: "
    );
    Serial.println(
      WiFi.localIP()
    );
    Serial.print(
      "Wi-Fi RSSI: "
    );
    Serial.print(
      WiFi.RSSI()
    );
    Serial.println(
      " dBm"
    );
  } else {
    Serial.println(
      "Wi-Fi reconnect failed."
    );
  }
  if (
    restartBLE &&
    bleScan != nullptr
  ) {
    bleScan->start(
      0,
      false,
      true
    );
  }
  lastSampleTime =
    millis();
}
// =====================================================
// 28. API HELPER
// =====================================================
void configureRequest(
  HTTPClient &http
) {
  http.setConnectTimeout(500);
  http.setTimeout(700);
  if (
    strlen(DEVICE_TOKEN) > 0
  ) {
    http.addHeader(
      "X-Device-Token",
      DEVICE_TOKEN
    );
  }
}
// =====================================================
// 29. GET TEACHER-CONFIRMED GATE STATE
// =====================================================
void applyAttendanceEpoch(const String &newEpoch) {
  if (newEpoch != attendanceEpoch) {
    attendanceEpoch = newEpoch;
    gateDangerArmed = false;
    dangerEventReported = false;
    farHits = 0;
    attendanceHits = 0;
    pendingEventId = "";
    pendingAttendanceJson = "";
    pendingBLEJson = "";
    pendingArmedFARJson = "";
    resetArrivalNeedsFar = attendanceEpoch.length() > 0 && attendanceStatus == "NOT_CHECKED_IN";
    if (resetArrivalNeedsFar) {
      arrivalArmed = false;
      attendanceReportSent = false;
    }
  }
}

void pollGateState() {
  if (
    WiFi.status() !=
      WL_CONNECTED
  ) {
    gateStateValid = false;
    return;
  }
  if (
    millis() -
      lastGatePollMs <
      GATE_STATE_POLL_MS
  ) {
    return;
  }
  lastGatePollMs = millis();
  String url =
    String(BACKEND_URL) +
    "/api/gate/state?deviceId=" +
    DEVICE_ID +
    "&gateId=" +
    GATE_ID + "&deviceBootId=" + deviceBootId;
  WiFiClient client;
  HTTPClient http;
  if (
    !http.begin(
      client,
      url
    )
  ) {
    return;
  }
  configureRequest(http);
  int statusCode =
    http.GET();
  if (
    statusCode != 200
  ) {
    logBackendError(http,statusCode);
    Serial.print(
      "Gate state HTTP error: "
    );
    Serial.println(
      statusCode
    );
    http.end();
    return;
  }
  String response =
    http.getString();
  http.end();
  JsonDocument doc;
  DeserializationError error =
    deserializeJson(
      doc,
      response
    );
  if (error) {
    Serial.println(
      "Invalid gate-state JSON"
    );
    return;
  }
  if (
    !doc[
      "attendanceStatus"
    ].is<const char *>() ||
    !doc[
      "gatePassAuthorized"
    ].is<bool>()
  ) {
    Serial.println(
      "Incomplete gate-state response"
    );
    return;
  }
  String newStatus =
    doc["attendanceStatus"]
      .as<String>();
  bool newAuthorization =
    doc["gatePassAuthorized"]
      .as<bool>();
  bool known =
    newStatus ==
      "NOT_CHECKED_IN" ||
    newStatus ==
      "CHECKIN_PENDING" ||
    newStatus ==
      "PRESENT" ||
    newStatus ==
      "CHECKED_OUT" || newStatus == "ABSENT";
  if (!known) {
    Serial.println(
      "Unknown attendance status"
    );
    return;
  }
  String newAttendanceDay =
    doc["attendanceDay"]
      .as<String>();
  bool newDayStarted =
    lastAttendanceDay.length() > 0 &&
    newAttendanceDay.length() > 0 &&
    newAttendanceDay !=
      lastAttendanceDay;
  if (
    newAttendanceDay.length() > 0
  ) {
    lastAttendanceDay =
      newAttendanceDay;
  }
  String newEpoch = doc["attendanceEpoch"] | "";
  String previousStatus =
    attendanceStatus;
  bool previousAuthorization =
    gatePassAuthorized;
  attendanceStatus =
    newStatus;
  gatePassAuthorized =
    newAuthorization;
  if (!gateStateValid || newDayStarted || newStatus != previousStatus || newAuthorization != previousAuthorization) {
    gateDangerArmed = false;
    farHits = 0;
  }
  gateStateValid = true;
  lastGoodGateStateMs =
    millis();
  if (
    newStatus !=
      previousStatus
  ) {
    Serial.println();
    Serial.print(
      "BACKEND ATTENDANCE: "
    );
    Serial.println(
      attendanceStatus
    );
    if (
      newStatus ==
        "PRESENT"
    ) {
      Serial.println(
        "Backend-confirmed arrival"
      );
      gateDangerArmed = false;
      dangerEventReported = false;
      arrivalArmed = false;
      attendanceReportSent = true;
    } else if (
      newStatus ==
        "CHECKIN_PENDING"
    ) {
      attendanceReportSent = true;
      arrivalArmed = false;
    } else if (
      newStatus ==
        "NOT_CHECKED_IN"
    ) {
      attendanceReportSent = false;
      pendingEventId = "";
      pendingAttendanceJson = "";
      gateDangerArmed = false;
      arrivalArmed =
        previousStatus ==
          "UNKNOWN" ||
        newDayStarted ||
        proximity !=
          PROXIMITY_NEAR;
    } else if (
      newStatus ==
        "CHECKED_OUT" || newStatus == "ABSENT"
    ) {
      gateDangerArmed = false;
      arrivalArmed = false;
      if (newStatus == "ABSENT") {
        pendingEventId = "";
        pendingAttendanceJson = "";
      }
    }
  }
  if (
    newDayStarted &&
    attendanceStatus ==
      "NOT_CHECKED_IN"
  ) {
    arrivalArmed = true;
    attendanceReportSent = false;
    pendingEventId = "";
    pendingAttendanceJson = "";
  }
  applyAttendanceEpoch(newEpoch);
  bool wasZoneMonitoringArmed = zoneMonitoringArmed;
  zoneMonitoringArmed = doc["zoneMonitoringArmed"] | false;
  zoneMonitoringSession = doc["zoneMonitoringSession"] | "";
  tamper::setAssignment(doc["tamperAssignmentId"] | "");
  zoneDepartureUptimeMs = doc["zoneDepartureUptimeMs"] | 0UL;
  zoneMonitoringArmed = zoneMonitoringArmed && attendanceStatus == "PRESENT" && !gatePassAuthorized && zoneMonitoringSession.length() > 0;
  if (wasZoneMonitoringArmed != zoneMonitoringArmed) Serial.printf("ZONE_MONITORING armed=%s reason=BACKEND_SESSION_CHECK\n", zoneMonitoringArmed ? "true" : "false");
  if (gatePassAuthorized) {
    gateDangerArmed = false;
    dangerEventReported = false;
  }
  if (
    previousAuthorization &&
    !gatePassAuthorized
  ) {
    gateDangerArmed = false;
  }

}
// =====================================================
// 30. SEND PENDING ARRIVAL EVENT
// =====================================================
void sendAttendanceCandidate() {
  if (
    !hasFreshGateState()
  ) {
    return;
  }
  if (
    attendanceStatus !=
      "NOT_CHECKED_IN"
  ) {
    return;
  }
  if (!arrivalArmed || resetArrivalNeedsFar || pendingArmedFARJson.length() > 0) {
    return;
  }
  if (
    attendanceReportSent
  ) {
    return;
  }
  if (
    proximity !=
      PROXIMITY_NEAR ||
    attendanceHits <
      BLE_CONFIRM_READINGS
  ) {
    return;
  }
  if (
    lastAttendanceAttemptMs != 0 &&
    millis() -
      lastAttendanceAttemptMs <
      ATTENDANCE_RETRY_MS
  ) {
    return;
  }
  lastAttendanceAttemptMs =
    millis();
  if (
    pendingEventId.length() == 0
  ) {
    attendanceEventSequence++;
    pendingEventId = String(DEVICE_ID) + "-arrival-" + String(esp_random(), HEX) + "-" + String(esp_random(), HEX) + "-" + String(attendanceEventSequence);
    JsonDocument doc;
    doc["eventId"] = pendingEventId;
    doc["eventType"] = "CHILD_NEAR_GATE";
    doc["deviceId"] = DEVICE_ID;
    doc["gateId"] = GATE_ID;
    if (attendanceEpoch.length() > 0) doc["attendanceEpoch"] = attendanceEpoch;
    doc["rssi"] = filteredRSSI;
    doc["gpsStatus"] = gpsStatus();
    doc["deviceUptimeMs"] = millis();
    pendingAttendanceJson = "";
    serializeJson(doc, pendingAttendanceJson);
  }
  String url =
    String(BACKEND_URL) +
    "/api/events";
  WiFiClient client;
  HTTPClient http;
  if (
    !http.begin(
      client,
      url
    )
  ) {
    Serial.println(
      "Attendance HTTP begin failed"
    );
    return;
  }
  configureRequest(http);
  http.addHeader(
    "Content-Type",
    "application/json"
  );
  int statusCode =
    http.POST(pendingAttendanceJson);
  if(statusCode<200 || statusCode>=300)logBackendError(http,statusCode);
  http.end();
  Serial.println();
  Serial.println(
    "===== ATTENDANCE REQUEST ====="
  );
  Serial.print(
    "HTTP status: "
  );
  Serial.println(
    statusCode
  );
  if (
    statusCode >= 200 &&
    statusCode < 300
  ) {
    attendanceReportSent = true;
    arrivalArmed = false;
    Serial.println(
      "EVENT: CHILD_NEAR_GATE"
    );
    Serial.println(
      "Observation accepted by backend"
    );
    Serial.println(
      "Waiting for authorized attendance confirmation"
    );
  } else {
    Serial.println(
      "Attendance report failed"
    );
    Serial.println(
      "Will retry while gate remains near"
    );
  }
}
// =====================================================
// 31. LOCAL DANGER-ZONE MONITORING
// =====================================================
void checkGateDanger() {
  if (!hasFreshBLESignal()) return;
  if (
    !hasFreshGateState()
  ) {
    return;
  }
  if (
    attendanceStatus !=
      "PRESENT" ||
    gatePassAuthorized
  ) {
    return;
  }
  if (!gateDangerArmed) {
    return;
  }
  if (
    proximity ==
      PROXIMITY_NEAR &&
    !dangerEventReported
  ) {
    dangerEventReported = true;
    Serial.println();
    Serial.println(
      "DANGER_EPISODE_QUEUED"
    );
    Serial.println(
      "EVENT: DANGER_ZONE_NEAR"
    );
    Serial.println(
      "Child approached daycare gate"
    );
    Serial.print(
      "Filtered RSSI: "
    );
    Serial.println(
      filteredRSSI, 2
    );
    Serial.println(
      "EXPERIMENTAL GATE EVENT - NOT SAFETY CERTIFIED"
    );
    queueDeviceTelemetry(
      "DANGER_ZONE_NEAR",
      nullptr,
      NAN,
      NAN,
      filteredRSSI
    );
    Serial.println(
      "DANGER_EPISODE_QUEUED"
    );
  }
}
// =====================================================
// TELEMETRY
// =====================================================
void queueDeviceTelemetry(
  const char *eventType,
  const char *activityState,
  float accelRms,
  float gyroRms,
  float eventRssi
) {
  uint8_t next =
    (telemetryHead + 1) %
    TELEMETRY_QUEUE_SIZE;
  if (
    strcmp(eventType,"GPS_STATUS")!=0 && next == telemetryTail
  ) {
    Serial.println(
      "TELEMETRY_QUEUE_FULL: observation dropped"
    );
    return;
  }
  JsonDocument doc;
  doc["eventId"] =
    String(DEVICE_ID) +
    "-" +
    String(
      esp_random(),
      HEX
    ) +
    "-" +
    String(millis());
  doc["eventType"] =
    eventType;
  doc["deviceId"] =
    DEVICE_ID;
  doc["gateId"] =
    GATE_ID;
  if (attendanceEpoch.length() > 0) doc["attendanceEpoch"] = attendanceEpoch;
  doc["gpsStatus"] =
    gpsStatus();
  doc["deviceUptimeMs"] =
    millis();
  if (activityState) {
    doc["activityState"] =
      activityState;
  }
  if (isfinite(accelRms)) {
    doc["accelRms"] =
      accelRms;
  }
  if (isfinite(gyroRms)) {
    doc["gyroRms"] =
      gyroRms;
  }
  if (
    isfinite(eventRssi) &&
    eventRssi >= -127 &&
    eventRssi <= 0
  ) {
    doc["rssi"] =
      eventRssi;
  }
  if (
    strcmp(
      gpsStatus(),
      "GPS_FIX"
    ) == 0
  ) {
    doc["latitude"] =
      gpsParser.location.lat();
    doc["longitude"] =
      gpsParser.location.lng();
  }
  doc["deviceBootId"] = deviceBootId;
  if (strcmp(eventType,"GPS_STATUS")==0) {
    doc["gpsEvidenceVersion"]="CG_GPS_V1";
    doc["gpsSequence"]=gpsEvidenceSequence++;
    doc["gpsQueueAgeMs"]=0;
    if (gpsParser.location.isValid()) doc["gpsFixAgeMs"]=gpsParser.location.age();
    if (gpsParser.date.isValid() && gpsParser.time.isValid() && gpsParser.date.age()<=5000 && gpsParser.time.age()<=5000) {
      char utc[32];
      snprintf(utc,sizeof(utc),"%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",gpsParser.date.year(),gpsParser.date.month(),gpsParser.date.day(),gpsParser.time.hour(),gpsParser.time.minute(),gpsParser.time.second(),gpsParser.time.centisecond()*10);
      doc["gpsObservedAt"]=utc;
    }
    if (gpsParser.hdop.isValid() && gpsParser.hdop.age()<=5000 && gpsParser.hdop.hdop()>0) doc["gpsHdop"]=gpsParser.hdop.hdop();
    if (gpsParser.satellites.isValid() && gpsParser.satellites.age()<=5000) doc["gpsSatellites"]=gpsParser.satellites.value();
  }
  if (strcmp(eventType,"GPS_STATUS")==0) {
    pendingGPS.json="";serializeJson(doc,pendingGPS.json);pendingGPS.queuedAtMs=millis();return;
  }
  serializeJson(
    doc,
    telemetryQueue[
      telemetryHead
    ].json
  );
  telemetryQueue[telemetryHead].queuedAtMs = millis();
  telemetryHead = next;
}
// OBSERVING is UNKNOWN externally until the existing filter confirms a state.
void queueBLEObservation(bool force) {
  const char *state = proximity == PROXIMITY_NEAR ? "NEAR" :
    proximity == PROXIMITY_FAR ? "FAR" : "UNKNOWN";
  unsigned long now = millis();
  if (!force && lastBLEStateSent == state && now - lastBLEObservationMs < 15000) return;
  JsonDocument doc;
  doc["eventId"] = String(DEVICE_ID) + "-ble-" + String(esp_random(), HEX) + "-" + String(esp_random(), HEX) + "-" + String(now);
  doc["eventType"] = "BLE_PROXIMITY";
  doc["deviceId"] = DEVICE_ID;
  doc["gateId"] = GATE_ID;
    if (attendanceEpoch.length() > 0) doc["attendanceEpoch"] = attendanceEpoch;
  doc["deviceUptimeMs"] = now;
  doc["deviceBootId"] = deviceBootId;
  doc["gpsStatus"] = gpsStatus();
  doc["proximity"] = state;
  if (strcmp(state, "UNKNOWN") != 0) doc["rssi"] = filteredRSSI;
  pendingBLEJson = "";
  serializeJson(doc, pendingBLEJson);
  pendingBLEAtMs = now;
  lastBLEObservationMs = now;
  lastBLEStateSent = state;
  Serial.print("BLE_OBSERVATION_QUEUED ");
  Serial.println(state);
}
void flushDeviceTelemetry() {
  if(WiFi.status()==WL_CONNECTED && tamper::flush())return;
  if (
    (telemetryHead == telemetryTail && pendingBLEJson.length() == 0 && pendingArmedFARJson.length() == 0 && !zoneTelemetryPending() && !activityUploadDue()) ||
    WiFi.status() !=
      WL_CONNECTED
  ) {
    return;
  }
  if (!telemetryDispatchDue(millis(),lastTelemetrySendAttemptMs,
      safetyTelemetryPending() || zoneTelemetryPending(),telemetryRetryNeeded,TELEMETRY_SEND_INTERVAL_MS)) {
    return;
  }
  lastTelemetrySendAttemptMs =
    millis();
  telemetryRetryNeeded=true; // Cleared only for a handled attempt.
  bool sendingActivity=activityUploadDue()&&!safetyTelemetryPending()&&!zoneTelemetryPending();
  bool sendingZones = !sendingActivity && pendingArmedFARJson.length()==0 && zoneTelemetryPending() &&
    (preferZoneBatch || (telemetryHead==telemetryTail && pendingBLEJson.length()==0));
  preferZoneBatch = !sendingZones;
  WiFiClient client;
  HTTPClient http;
  if (
    !http.begin(
      client,
      String(BACKEND_URL) +
      ((sendingZones||sendingActivity) ? "/api/events/batch" : "/api/events")
    )
  ) {
    return;
  }
  configureRequest(http);
  http.addHeader(
    "Content-Type",
    "application/json"
  );
  if(sendingActivity){flushActivityBatch(http);http.end();telemetryRetryNeeded=false;return;}
  if(sendingZones){telemetryRetryNeeded=!flushZoneBatch(http);http.end();return;}
  bool sendingArmedFAR = pendingArmedFARJson.length() > 0;
  bool sendingBLE = sendingArmedFAR || (pendingBLEJson.length() > 0 &&
    (preferBLETelemetry || telemetryHead == telemetryTail));
  preferBLETelemetry = !sendingBLE;
  String outgoing;
  if (sendingBLE) {
    JsonDocument doc;
    deserializeJson(doc, sendingArmedFAR ? pendingArmedFARJson : pendingBLEJson);
    doc["queueAgeMs"] = (unsigned long)(millis() - (sendingArmedFAR ? pendingArmedFARAtMs : pendingBLEAtMs));
    serializeJson(doc, outgoing);
  } else {
    outgoing = telemetryQueue[telemetryTail].json;
    JsonDocument doc;
    deserializeJson(doc, outgoing);
    const char *kind = doc["eventType"] | "";
    if (strcmp(kind,"GPS_STATUS")==0 && doc["gpsEvidenceVersion"].is<const char*>()) {
      doc["gpsQueueAgeMs"]=(unsigned long)(millis()-telemetryQueue[telemetryTail].queuedAtMs);
      outgoing="";serializeJson(doc,outgoing);
    }
    if (strcmp(kind, "DANGER_ZONE_NEAR") == 0 || strcmp(kind, "DANGER_ZONE_EXIT") == 0) {
      doc["queueAgeMs"] = (unsigned long)(millis() - telemetryQueue[telemetryTail].queuedAtMs);
      outgoing = "";
      serializeJson(doc, outgoing);
    }
  }
  int code = http.POST(outgoing);
  JsonDocument response;
  bool parsed=!deserializeJson(response,http.getString());
  if(parsed) logTelemetryResult(response["data"].isNull()?response.as<JsonVariantConst>():response["data"].as<JsonVariantConst>(),code);
  JsonDocument sentEvent;deserializeJson(sentEvent,outgoing);
  if(code>=200&&code<300 && (!parsed || String(response["data"]["eventId"]|"")!=String(sentEvent["eventId"]|"")))code=-100;
  http.end();
  if (
    code >= 200 &&
    code < 300
  ) {
    telemetryRetryNeeded=false;
    Serial.print(
      "TELEMETRY_HTTP_ACCEPTED "
    );
    Serial.println(code);
    if (sendingBLE) {
      if (sendingArmedFAR) pendingArmedFARJson = "";
      else pendingBLEJson = "";
      return;
    }
    telemetryQueue[
      telemetryTail
    ].json = "";
    telemetryTail =
      (telemetryTail + 1) %
      TELEMETRY_QUEUE_SIZE;
  } else if (code == 400 || code == 409 || code == 422) {
    telemetryRetryNeeded=false;
    // Permanent rejection must not block all subsequent telemetry.
    Serial.print("TELEMETRY_REJECTED HTTP ");
    Serial.println(code);
    if (sendingBLE) {
      if (sendingArmedFAR) pendingArmedFARJson = "";
      else pendingBLEJson = "";
    } else {
      telemetryQueue[telemetryTail].json = "";
      telemetryTail = (telemetryTail + 1) % TELEMETRY_QUEUE_SIZE;
    }
  } else {
    Serial.print(
      "TELEMETRY_RETRY HTTP "
    );
    Serial.println(code);
  }
}
// =====================================================
// 32. BLE STATUS REPORT
// =====================================================
void reportBLE() {
  if (
    millis() -
      lastBLEReport <
      BLE_REPORT_INTERVAL_MS
  ) {
    return;
  }
  lastBLEReport =
    millis();
  unsigned long dropped;
  portENTER_CRITICAL(
    &bleMux
  );
  dropped =
    bleDroppedPackets;
  portEXIT_CRITICAL(
    &bleMux
  );
  Serial.println();
  Serial.println(
    "===== CHILDGUARD GATE ====="
  );
  Serial.print(
    "Beacon: "
  );
  Serial.println(GATE_ID);
  Serial.print(
    "Proximity: "
  );
  Serial.println(
    proximityText()
  );
  Serial.print(
    "Filtered RSSI: "
  );
  Serial.println(
    filteredRSSI, 2
  );
  Serial.print(
    "Attendance threshold: "
  );
  Serial.println(
    attendanceRSSI, 2
  );
  Serial.print(
    "Danger entry: "
  );
  Serial.println(
    dangerEntryRSSI, 2
  );
  Serial.print(
    "Danger exit: "
  );
  Serial.println(
    dangerExitRSSI, 2
  );
  Serial.print(
    "Attendance status: "
  );
  Serial.println(
    attendanceStatus
  );
  Serial.print(
    "Backend state fresh: "
  );
  Serial.println(
    hasFreshGateState() ?
      "YES" : "NO"
  );
  Serial.print(
    "Gate danger armed: "
  );
  Serial.println(
    gateDangerArmed ?
      "YES" : "NO"
  );
  Serial.print(
    "BLE packets dropped: "
  );
  Serial.println(dropped);
}
// =====================================================
// 33. SERIAL SETTINGS
// =====================================================
void printSettings() {
  Serial.println();
  Serial.println(
    "===== CHILDGUARD SETTINGS ====="
  );
  Serial.print(
    "Device: "
  );
  Serial.println(
    DEVICE_ID
  );
  Serial.print(
    "Wi-Fi: "
  );
  Serial.println(
    WiFi.status() ==
      WL_CONNECTED ?
      "CONNECTED" :
      "DISCONNECTED"
  );
  if (
    WiFi.status() ==
      WL_CONNECTED
  ) {
    Serial.print(
      "ESP32 IP: "
    );
    Serial.println(
      WiFi.localIP()
    );
  }
  Serial.print(
    "Accel threshold: "
  );
  Serial.println(
    accelThreshold
  );
  Serial.print(
    "Gyro threshold: "
  );
  Serial.println(
    gyroThreshold
  );
  Serial.print(
    "Inactivity seconds: "
  );
  Serial.println(
    inactivityLimit
  );
  Serial.print(
    "Gyro calibrated: "
  );
  Serial.println(
    gyroCalibrated ?
      "YES" : "NO"
  );
  Serial.print(
    "Attendance RSSI: "
  );
  Serial.println(
    attendanceRSSI
  );
  Serial.print(
    "Danger entry: "
  );
  Serial.println(
    dangerEntryRSSI
  );
  Serial.print(
    "Danger exit: "
  );
  Serial.println(
    dangerExitRSSI
  );
  Serial.print(
    "Backend status: "
  );
  Serial.println(
    attendanceStatus
  );
}
// =====================================================
// 34. SERIAL COMMANDS
// =====================================================
void executeCommand(
  String command
) {
  command.trim();
  if (
    command.length() == 0
  ) {
    return;
  }
  if (
    command == "p"
  ) {
    printSettings();
  } else if (
    command == "c"
  ) {
    calibrateGyro();
    resetActivityWindow();
    lastSampleTime =
      millis();
  } else if (
    command.startsWith(
      "a "
    )
  ) {
    float value;
    if (
      sscanf(
        command.c_str(),
        "a %f",
        &value
      ) == 1 &&
      isfinite(value) &&
      value >= -100 &&
      value <= -25
    ) {
      if (
        preferences.putFloat(
          "attIn",
          value
        ) == 4
      ) {
        attendanceRSSI =
          value;
        Serial.println(
          "Attendance threshold saved"
        );
      }
    } else {
      Serial.println(
        "Use: a -55"
      );
    }
  } else if (
    command.startsWith(
      "b "
    )
  ) {
    float entry;
    float exit;
    if (
      sscanf(
        command.c_str(),
        "b %f %f",
        &entry,
        &exit
      ) == 2 &&
      isfinite(entry) &&
      isfinite(exit) &&
      entry > exit &&
      entry >= -100 &&
      entry <= -25 &&
      exit >= -110
    ) {
      bool ok = true;
      ok &=
        preferences.putFloat(
          "bleIn",
          entry
        ) == 4;
      ok &=
        preferences.putFloat(
          "bleOut",
          exit
        ) == 4;
      if (ok) {
        dangerEntryRSSI =
          entry;
        dangerExitRSSI =
          exit;
        gateDangerArmed =
          false;
        resetBLEFilter();
        proximity =
          PROXIMITY_UNKNOWN;
        Serial.println(
          "Danger thresholds saved"
        );
      }
    } else {
      Serial.println(
        "Use: b -63 -69"
      );
    }
  } else if (
    command.startsWith(
      "t "
    )
  ) {
    float acc;
    float gyro;
    if (
      sscanf(
        command.c_str(),
        "t %f %f",
        &acc,
        &gyro
      ) == 2 &&
      isfinite(acc) &&
      isfinite(gyro) &&
      acc > 0 &&
      gyro > 0
    ) {
      bool ok = true;
      ok &=
        preferences.putFloat(
          "actAcc",
          acc
        ) == 4;
      ok &=
        preferences.putFloat(
          "actGyro",
          gyro
        ) == 4;
      ok &=
        preferences.putBool(
          "thrReady",
          true
        );
      if (ok) {
        accelThreshold =
          acc;
        gyroThreshold =
          gyro;
        thresholdConfigured =
          true;
        resetActivityWindow();
        Serial.println(
          "Activity thresholds saved"
        );
      }
    } else {
      Serial.println(
        "Use: t 0.04 4.0"
      );
    }
  } else if (
    command.startsWith(
      "d "
    )
  ) {
    unsigned long seconds;
    if (
      sscanf(
        command.c_str(),
        "d %lu",
        &seconds
      ) == 1 &&
      seconds > 0 &&
      seconds <= 86400
    ) {
      bool ok =
        preferences.putULong(
          "actTime",
          seconds
        ) == 4;
      ok &=
        preferences.putBool(
          "durReady",
          true
        );
      if (ok) {
        inactivityLimit =
          seconds;
        durationConfigured =
          true;
        resetActivityWindow();
        Serial.println(
          "Inactivity duration saved"
        );
      }
    } else {
      Serial.println(
        "Use: d 60"
      );
    }
  } else if (
    command == "help"
  ) {
    Serial.println();
    Serial.println(
      "CHILDGUARD COMMANDS"
    );
    Serial.println(
      "p = Print settings"
    );
    Serial.println(
      "c = Gyroscope calibration"
    );
    Serial.println(
      "a -55 = Attendance threshold"
    );
    Serial.println(
      "b -63 -69 = Danger thresholds"
    );
    Serial.println(
      "t 0.04 4.0 = Activity thresholds"
    );
    Serial.println(
      "d 60 = Inactivity seconds"
    );
  } else {
    Serial.println(
      "Unknown command"
    );
  }
}
// =====================================================
// 35. NON-BLOCKING SERIAL INPUT
// =====================================================
String serialCommand = "";
void handleSerialCommands() {
  while (
    Serial.available()
  ) {
    char c =
      (char)Serial.read();
    if (
      c == '\n' ||
      c == '\r'
    ) {
      if (
        serialCommand.length() > 0
      ) {
        executeCommand(
          serialCommand
        );
        serialCommand = "";
      }
    } else {
      if (
        serialCommand.length() < 64
      ) {
        serialCommand += c;
      } else {
        serialCommand = "";
      }
    }
  }
}
// =====================================================
// 36. SETUP
// =====================================================
void setup() {
  Serial.begin(115200);
  tamper::begin();
  delay(1500);
  Serial.println();
  Serial.println(
    "================================"
  );
  Serial.println(
    "CHILDGUARD WEARABLE"
  );
  Serial.println(
    "MPU6050 + GPS + BLE + ATTENDANCE"
  );
  Serial.println(
    "================================"
  );
  // --------------------------
  // MPU6050
  // --------------------------
  Wire.begin(
    MPU_SDA_PIN,
    MPU_SCL_PIN
  );
  Wire.setClock(100000);
  Wire.setTimeOut(20);
  Wire.beginTransmission(
    MPU_ADDRESS
  );
  if (
    Wire.endTransmission() != 0
  ) {
    Serial.println(
      "MPU6050 NOT FOUND"
    );
    // Sensor failure must not prevent Wi-Fi/BLE startup.
  }
  bool mpuOK = true;
  mpuOK &=
    writeMPURegister(
      0x6B,
      0x00
    );
  mpuOK &=
    writeMPURegister(
      0x1C,
      0x00
    );
  mpuOK &=
    writeMPURegister(
      0x1B,
      0x00
    );
  if (!mpuOK) {
    Serial.println(
      "MPU INITIALIZATION FAILED"
    );
    // Sensor failure must not prevent Wi-Fi/BLE startup.
  }
  mpuConfigured=mpuOK;
  if(mpuConfigured) Serial.println("MPU6050 INITIALIZED");
  // --------------------------
  // FLASH STORAGE
  // --------------------------
  if (
    !preferences.begin(
      "cg_mpu",
      false
    )
  ) {
    Serial.println(
      "NVS ERROR"
    );
    while (true) {
      delay(1000);
    }
  }
  if (!loadSettings()) {
    Serial.println(
      "CALIBRATION ERROR"
    );
    while (true) {
      delay(1000);
    }
  }
  // --------------------------
  // GPS
  // --------------------------
  setupGPS();
  // --------------------------
  // WIFI - CONNECT BEFORE BLE
  // --------------------------
  WiFi.mode(
    WIFI_STA
  );
  WiFi.setTxPower(
    WIFI_POWER_8_5dBm
  );
  Serial.println(
    "Wi-Fi TX power set to 8.5 dBm"
  );
  WiFi.setAutoReconnect(
    true
  );
  Serial.println();
  Serial.println(
    "Connecting Wi-Fi before starting BLE..."
  );
  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );
  unsigned long wifiStart =
    millis();
  while (
    WiFi.status() !=
      WL_CONNECTED &&
    millis() - wifiStart <
      30000
  ) {
    processGPS();
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (
    WiFi.status() ==
      WL_CONNECTED
  ) {
    Serial.println(
      "Wi-Fi connected successfully!"
    );
    Serial.print(
      "ESP32 IP: "
    );
    Serial.println(
      WiFi.localIP()
    );
    Serial.print(
      "Wi-Fi RSSI: "
    );
    Serial.print(
      WiFi.RSSI()
    );
    Serial.println(
      " dBm"
    );
  } else {
    Serial.println(
      "Initial Wi-Fi connection failed."
    );
    Serial.println(
      "Firmware will retry in loop()."
    );
  }
  // --------------------------
  // BLE - START AFTER WIFI ATTEMPT
  // --------------------------
  setupBLE();
  busTransport::start();
  startActivitySampler();
  // --------------------------
  // TIMERS
  // --------------------------
  lastSampleTime =
    millis();
  windowStartTime =
    millis();
  lastGPSReport =
    millis();
  lastBLEReport =
    millis();
  Serial.println();
  Serial.println(
    "CHILDGUARD READY"
  );
  Serial.println(
    "Send help for commands"
  );
}
// =====================================================
// 37. MAIN LOOP
// =====================================================
void loop() {
  observeActivityLoopBlock("handleSerialCommands",handleSerialCommands);
  processGPS();
  reportGPS();
  flushFreshGPS();
  if (!hasFreshGateState()) {
    // An outage invalidates prior arming; require fresh FAR readings after recovery.
    gateDangerArmed = false;
    farHits = 0;
  }
  observeActivityLoopBlock("processBLE",processBLE);
  queueBLEObservation();
  reportBLE();
  // Drain actual radio samples and attempt ordered transition delivery before
  // optional polling can block this loop. The existing post-poll pass remains.
  processZoneBeacons();
  if(pendingArmedFARJson.length() || zoneTelemetryPending())
    observeActivityLoopBlock("flushPriorityTelemetry",flushDeviceTelemetry);
  observeActivityLoopBlock("maintainWiFi",maintainWiFi);
  observeActivityLoopBlock("pollGateState",pollGateState);
  observeActivityLoopBlock("pollBeaconConfiguration",pollBeaconConfiguration);
  busTransport::poll();
  busTransport::process();
  busTransport::flush();
  processZoneBeacons();
  observeActivityLoopBlock("sendAttendanceCandidate",sendAttendanceCandidate);
  checkGateDanger();
  drainActivitySamples();
  tickMovementActivity(activitySamples==nullptr);
  unsigned long now =
    millis();
  unsigned long sampleDelay =
    now - lastSampleTime;
  if (
    sampleDelay >=
      SAMPLE_INTERVAL_MS
  ) {
    if (
      sampleDelay > 100
    ) {
      // This diagnostic measures the legacy main-loop RMS collector.
      // The independent MAD collector reports its own measured coverage below.
      if (
        lastSampleGapEventMs == 0 ||
        millis() -
          lastSampleGapEventMs >
          30000
      ) {
        Serial.print("ACTIVITY_SAMPLE_GAP: collector=legacy_loop gapMs=");
        Serial.println(sampleDelay);
        queueDeviceTelemetry(
          "ACTIVITY_SAMPLE_GAP",
          nullptr,
          NAN,
          NAN,
          NAN
        );
        lastSampleGapEventMs =
          millis();
      }
      resetActivityWindow();
    }
    lastSampleTime = now;
    sampleMPU();
  }
  observeActivityLoopBlock("flushDeviceTelemetry",flushDeviceTelemetry);
  static unsigned long lastScanCheck = 0;
  if (
    millis() -
      lastScanCheck >
      5000
  ) {
    lastScanCheck =
      millis();
    if (
      bleScan != nullptr &&
      !bleScan->isScanning()
    ) {
      bleScan->start(
        0,
        false,
        true
      );
    }
  }
}
