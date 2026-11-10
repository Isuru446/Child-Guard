#pragma once
#include <stdint.h>
#include <stddef.h>
namespace cg_rfid {
struct Uid {uint8_t length=0;uint8_t bytes[10]={};};
constexpr bool equal(const Uid &a,const Uid &b){if(a.length!=b.length)return false;for(uint8_t i=0;i<a.length;i++)if(a.bytes[i]!=b.bytes[i])return false;return true;}
class PresentationGuard {
 public:
  constexpr bool observe(uint32_t now,const Uid &uid){
    if(uid.length!=4&&uid.length!=7&&uid.length!=10)return false;
    const bool held=hasPresent&&equal(present,uid);present=uid;hasPresent=true;lastSeen=now;
    if(held)return false;
    for(const auto &e:recent)if(e.used&&equal(e.uid,uid)&&uint32_t(now-e.at)<2500)return false;
    recent[next]={uid,now,true};next=(next+1)%8;return true;
  }
  constexpr void absent(uint32_t now){if(uint32_t(now-lastSeen)>=300)hasPresent=false;}
 private:
  struct Entry{Uid uid;uint32_t at=0;bool used=false;};
  Entry recent[8]={};Uid present;bool hasPresent=false;uint32_t lastSeen=0;uint8_t next=0;
};
}
