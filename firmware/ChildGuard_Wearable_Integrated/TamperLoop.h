#pragma once
#include <stdint.h>

// Pure state machine: no networking, allocation or hardware dependency.
namespace cg {
enum class LoopState : uint8_t { UNKNOWN, CLOSED, OPEN };
class TamperLoop {
 public:
  constexpr void begin(uint32_t now, bool open) {
    started=changed=now; candidate=open; state=LoopState::UNKNOWN;
  }
  constexpr bool tick(uint32_t now, bool open) {
    if(open!=candidate){candidate=open;changed=now;}
    if(uint32_t(now-started)<3000 || uint32_t(now-changed)<800)return false;
    const auto next=candidate?LoopState::OPEN:LoopState::CLOSED;
    if(next==state)return false;
    state=next;return true;
  }
  constexpr LoopState value() const {return state;}
 private:
  uint32_t started=0,changed=0;
  bool candidate=false;
  LoopState state=LoopState::UNKNOWN;
};
}
