#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
#include "PresentationGuard.h"
#include "secrets.h"
#if !defined(CONFIG_IDF_TARGET_ESP32C3) || !ARDUINO_USB_CDC_ON_BOOT
#error "Select ESP32C3 Dev Module with USB CDC On Boot Enabled."
#endif
constexpr uint8_t SS_PIN=7,SCK_PIN=4,MOSI_PIN=6,MISO_PIN=5,RST_PIN=3;
MFRC522 reader(SS_PIN,RST_PIN);
cg_rfid::PresentationGuard presentation;
struct ScanJob{char uid[21]={},eventId[100]={},enrollment[37]={};uint32_t sequence=0,atMs=0,modeVersion=0;uint8_t attempts=0;};
QueueHandle_t jobs=nullptr;
portMUX_TYPE stateMux=portMUX_INITIALIZER_UNLOCKED;
char enrollment[37]={},bootId[33]={};
uint32_t modeVersion=0;bool modeKnown=false;
uint32_t sequence=0,lastWifi=0,lastPoll=0,lastInit=0;
bool readerReady=false,configurationValid=false;
// A verified card UID read is required to establish functional 0x82 compatibility.
// The MFRC522 library has no digital self-test reference for firmware 0x82.
bool version82AwaitingValidCard=true;

// HTTPClient decodes chunked responses into this bounded sink. A proxy may omit
// Content-Length; that must not force an unbounded String allocation.
class LimitedResponse : public Stream {
 public:
  char bytes[2049]={};size_t length=0;bool overflow=false;
  size_t write(uint8_t value) override {return write(&value,1);}
  size_t write(const uint8_t *data,size_t size) override {
    if(length+size>2048){overflow=true;return 0;}
    memcpy(bytes+length,data,size);length+=size;bytes[length]=0;return size;
  }
  int available() override {return 0;} int read() override {return -1;}
  int peek() override {return -1;} void flush() override {}
};

bool backendConfiguration(){
 String url=RFID_BACKEND_URL;const bool tls=url.startsWith("https://");
 if(!tls&&!url.startsWith("http://"))return false;
 String authority=url.substring(tls?8:7);const int slash=authority.indexOf('/');
 if(slash>=0){if(authority.substring(slash)!="/")return false;authority=authority.substring(0,slash);}
 if(authority.indexOf('@')>=0||authority.indexOf('?')>=0||authority.indexOf('#')>=0)return false;
 const int colon=authority.indexOf(':');String host=colon>=0?authority.substring(0,colon):authority;
 if(host!=RFID_ALLOWED_HOST||strlen(RFID_READER_TOKEN)<32||String(RFID_READER_TOKEN).startsWith("REPLACE"))return false;
 if(tls)return strlen(RFID_ROOT_CA)>0;
 IPAddress ip;if(!RFID_ALLOW_TRUSTED_LAN_HTTP||!ip.fromString(host))return false;
 return ip[0]==10||(ip[0]==192&&ip[1]==168)||(ip[0]==172&&ip[1]>=16&&ip[1]<=31);
}

bool requestBackend(const char *path,const String *body,JsonDocument &response){
 if(!configurationValid||WiFi.status()!=WL_CONNECTED)return false;
 String base=RFID_BACKEND_URL;if(base.endsWith("/"))base.remove(base.length()-1);
 const bool tls=base.startsWith("https://");
 if(tls&&time(nullptr)<1700000000){Serial.println("RFID_TLS waiting for clock synchronization");return false;}
 WiFiClient plain;WiFiClientSecure secure;HTTPClient http;
 if(tls)secure.setCACert(RFID_ROOT_CA);
 if(!http.begin(tls?static_cast<NetworkClient&>(secure):static_cast<NetworkClient&>(plain),base+path))return false;
 http.setConnectTimeout(1500);http.setTimeout(2000);http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
 http.addHeader("X-RFID-Reader-Token",RFID_READER_TOKEN);
 int status;
 if(body){http.addHeader("Content-Type","application/json");status=http.POST(*body);}else status=http.GET();
 if(status<200||status>=300){Serial.printf("RFID_HTTP_UNCONFIRMED code=%d\n",status);http.end();return false;}
 const int size=http.getSize();
 if(size>2048){http.end();return false;}
 LimitedResponse buffer;
 const int received=http.writeToStream(&buffer);
 const bool ok=received>=0&&!buffer.overflow&&buffer.length>0&&!deserializeJson(response,buffer.bytes,buffer.length);http.end();return ok;
}

bool refreshMode(){
 JsonDocument response;if(!requestBackend("/api/v1/rfid-reader/state",nullptr,response)){portENTER_CRITICAL(&stateMux);modeKnown=false;portEXIT_CRITICAL(&stateMux);return false;}
 const char *mode=response["data"]["enrollmentId"]|"";
 const char *identity=response["data"]["hardwareId"]|"";
 if(!identity[0]||strlen(identity)>150||strlen(mode)>36||!response["data"]["modeVersion"].is<uint32_t>())return false;
 static bool announced=false;
 if(!announced){Serial.printf("RFID_AUTHENTICATED reader=%s\n",identity);announced=true;}
 portENTER_CRITICAL(&stateMux);strlcpy(enrollment,mode,sizeof(enrollment));modeVersion=response["data"]["modeVersion"].as<uint32_t>();modeKnown=true;portEXIT_CRITICAL(&stateMux);
 Serial.println(mode[0]?"RFID_MODE Enrollment - tap the card selected by Admin":"RFID_MODE Attendance");return true;
}

void networkingTask(void*){
 uint32_t lastState=0;bool connected=false;
 for(;;){
  if(WiFi.status()!=WL_CONNECTED){
   connected=false;
   portENTER_CRITICAL(&stateMux);modeKnown=false;portEXIT_CRITICAL(&stateMux);
   ScanJob abandoned;while(xQueueReceive(jobs,&abandoned,0)==pdTRUE)Serial.println("Attendance not recorded - scan again when connected");
   vTaskDelay(pdMS_TO_TICKS(100));continue;
  }
  if(!connected||uint32_t(millis()-lastState)>=2000){connected=refreshMode();lastState=millis();}
  ScanJob job;
  if(xQueueReceive(jobs,&job,pdMS_TO_TICKS(50))!=pdTRUE)continue;
  if(uint32_t(millis()-job.atMs)>5000){Serial.println("Attendance not confirmed - scan again when connected");continue;}
  JsonDocument doc;doc["eventId"]=job.eventId;doc["cardUid"]=job.uid;doc["readerBootId"]=bootId;doc["scanSequence"]=job.sequence;doc["modeVersion"]=job.modeVersion;
  if(job.enrollment[0])doc["enrollmentId"]=job.enrollment;else doc["enrollmentId"]=nullptr;
  String body;serializeJson(doc,body);JsonDocument response;
  const bool ok=requestBackend("/api/v1/rfid-reader/scans",&body,response)&&String(response["data"]["eventId"]|"")==job.eventId;
  if(!ok){
   // One short-lived retry of exactly the same event, never a durable offline queue.
   if(job.attempts++==0&&WiFi.status()==WL_CONNECTED&&uint32_t(millis()-job.atMs)<3000&&xQueueSend(jobs,&job,0)==pdTRUE)continue;
   Serial.println("Attendance not confirmed - check the app, then scan again when connected");continue;
  }
  const char *result=response["data"]["result"]|"SERVER_ERROR";
  if(!strcmp(result,"PRESENT_RECORDED")||!strcmp(result,"PENDING_CONFIRMED"))Serial.println("Attendance marked PRESENT");
  else if(!strcmp(result,"ALREADY_PRESENT"))Serial.println("Already marked PRESENT");
  else if(!strcmp(result,"CARD_UNKNOWN"))Serial.println("Card not registered");
  else if(!strcmp(result,"CARD_REVOKED"))Serial.println("Card revoked or replaced");
  else if(!strcmp(result,"ATTENDANCE_CONFLICT"))Serial.println("Attendance conflict - Teacher/Admin review needed");
  else if(!strcmp(result,"OUTSIDE_ATTENDANCE_HOURS"))Serial.println("Outside authorized attendance hours");
  else if(!strcmp(result,"ENROLLMENT_SUCCESS"))Serial.println("Card successfully enrolled - remove card before attendance scan");
  else if(!strcmp(result,"ENROLLMENT_REJECTED"))Serial.println("Enrollment rejected or expired - Admin review needed");
  else if(!strcmp(result,"ENROLLMENT_REFRESH_REQUIRED"))Serial.println("Enrollment mode changed - remove card, wait and tap again");
  else Serial.println("Server response not recognized - review the app");
  if(String(result).startsWith("ENROLLMENT")){refreshMode();lastState=millis();}
 }
}

// Readiness policy:
//  - Known MFRC522 versions (0x88/0x90/0x91/0x92): require their matching
//    library digital self-test to PASS, exactly as before.
//  - This specific 0x82 module: the MFRC522 library has no self-test reference.
//    Accept it in a limited compatibility mode only if VersionReg remains 0x82
//    across re-initialization. Log that the test is UNAVAILABLE, never PASS.
//    A real 4/7/10-byte UID must be decoded before any scan can be queued.
//  - Other/unstable versions: fail closed and retry later.
void initializeReader() {
  lastInit = millis();
  readerReady = false;
  version82AwaitingValidCard = true;

  reader.PCD_Init();
  delay(10);
  const byte version = reader.PCD_ReadRegister(MFRC522::VersionReg);
  delay(2);
  const byte repeatVersion = reader.PCD_ReadRegister(MFRC522::VersionReg);

  if (version != repeatVersion || version == 0x00 || version == 0xFF) {
    Serial.printf("RC522 not detected or unstable version: 0x%02X / 0x%02X - check 3.3 V and SPI wiring\n",
                  version, repeatVersion);
    return;
  }

  if (version == 0x82) {
    // PCD_PerformSelfTest() always returns false for 0x82 because its
    // reference bytes are absent from MFRC522 1.4.12. That is *not* evidence
    // of a failed UID reader. The same physical module already read a UID
    // in an independent bench test. Do not modify the library or pretend
    // the digital self-test passed.
    reader.PCD_Init();
    delay(10);
    const byte afterInit = reader.PCD_ReadRegister(MFRC522::VersionReg);
    if (afterInit != 0x82) {
      Serial.printf("RC522 0x82 compatibility check FAILED: version changed to 0x%02X\n", afterInit);
      return;
    }
    readerReady = true;
    Serial.println("RC522 version=0x82, digital self-test=UNSUPPORTED by MFRC522 library");
    Serial.println("RC522 0x82 compatibility mode - waiting for a valid physical card UID");
    return;
  }

  if (version != 0x88 && version != 0x90 && version != 0x91 && version != 0x92) {
    Serial.printf("RC522 unsupported version=0x%02X - reader disabled\n", version);
    return;
  }

  const bool selfTest = reader.PCD_PerformSelfTest();
  // The library leaves the chip needing re-initialization after self-test.
  reader.PCD_Init();
  delay(10);
  const byte afterInit = reader.PCD_ReadRegister(MFRC522::VersionReg);
  readerReady = selfTest && (afterInit == version);
  version82AwaitingValidCard = false;
  Serial.printf("RC522 version=0x%02X digital self-test=%s post-init=0x%02X\n",
                version, selfTest ? "PASS" : "FAIL", afterInit);
  if (!readerReady) {
    Serial.println("RC522 reader disabled - check module and SPI wiring");
  }
}
void setup(){
 Serial.begin(115200);
 snprintf(bootId,sizeof(bootId),"%012llx%08lx%08lx",(unsigned long long)(ESP.getEfuseMac()&0xFFFFFFFFFFFFULL),(unsigned long)esp_random(),(unsigned long)esp_random());
 configurationValid=backendConfiguration();
 if(!configurationValid)Serial.println("RFID configuration invalid - private credentials, host and TLS/LAN settings required");
 WiFi.mode(WIFI_STA);
 WiFi.setTxPower(
    WIFI_POWER_8_5dBm
  );
 WiFi.setAutoReconnect(true);if(configurationValid)WiFi.begin(RFID_WIFI_SSID,RFID_WIFI_PASSWORD);
 configTime(0,0,"pool.ntp.org","time.google.com");
 SPI.begin(SCK_PIN,MISO_PIN,MOSI_PIN,SS_PIN);initializeReader();
 jobs=xQueueCreate(4,sizeof(ScanJob));
 if(!jobs||xTaskCreate(networkingTask,"rfid_http",8192,nullptr,1,nullptr)!=pdPASS){configurationValid=false;Serial.println("RFID networking unavailable - attendance not recorded");}
 Serial.println(configurationValid&&readerReady&&jobs?"RFID hardware initialized - awaiting authenticated backend mode":"RFID reader not ready - review configuration and hardware diagnostics");
}
void loop(){
 const uint32_t now=millis();
 if(configurationValid&&WiFi.status()!=WL_CONNECTED&&uint32_t(now-lastWifi)>=15000){lastWifi=now;WiFi.reconnect();Serial.println("RFID Wi-Fi reconnecting");}
 if(!readerReady){if(uint32_t(now-lastInit)>=5000)initializeReader();delay(10);return;}
 if(uint32_t(now-lastPoll)<80){delay(1);return;}lastPoll=now;
 byte atqa[2],size=sizeof(atqa);
 const auto status=reader.PICC_WakeupA(atqa,&size);
 if((status!=MFRC522::STATUS_OK&&status!=MFRC522::STATUS_COLLISION)||!reader.PICC_ReadCardSerial()){presentation.absent(now);return;}
 cg_rfid::Uid uid;uid.length=reader.uid.size;
 if(uid.length!=4&&uid.length!=7&&uid.length!=10){reader.PICC_HaltA();Serial.println("Unsupported card UID length");return;}
 memcpy(uid.bytes,reader.uid.uidByte,uid.length);
 if (version82AwaitingValidCard) {
   version82AwaitingValidCard = false;
   Serial.println("RC522 0x82 functional UID read: PASS (digital self-test remains unsupported)");
 }
 const bool submit=presentation.observe(now,uid);
 reader.PICC_HaltA();reader.PCD_StopCrypto1();
 if(!submit)return;
 Serial.printf("RFID_CARD_DETECTED uid_bytes=%u (UID not printed)\n",(unsigned)uid.length);
 if(!configurationValid||WiFi.status()!=WL_CONNECTED){Serial.println("Attendance not recorded - scan again when connected");return;}
 ScanJob job;job.atMs=now;job.sequence=++sequence;
 for(uint8_t i=0;i<uid.length;i++)snprintf(job.uid+i*2,3,"%02X",uid.bytes[i]);
 snprintf(job.eventId,sizeof(job.eventId),"rfid-%s-%lu",bootId,(unsigned long)job.sequence);
 portENTER_CRITICAL(&stateMux);strlcpy(job.enrollment,enrollment,sizeof(job.enrollment));job.modeVersion=modeVersion;const bool known=modeKnown;portEXIT_CRITICAL(&stateMux);
 if(!known){Serial.println("Reader offline or awaiting authenticated mode - attendance not recorded; scan again when connected");return;}
 if(xQueueSend(jobs,&job,0)!=pdTRUE)Serial.println("Reader busy - attendance not recorded; remove and scan again");
}
