// Executed as constant evaluation by the actual ESP32-C3 C++ compiler, so these
// checks also run where a native executable compiler is unavailable.
#include "../ChildGuard_Wearable_Integrated/TamperLoop.h"
using cg::TamperLoop;using cg::LoopState;
constexpr bool transitions(){
 TamperLoop loop;loop.begin(0,false);
 if(loop.tick(2999,false)||!loop.tick(3000,false)||loop.value()!=LoopState::CLOSED)return false;
 if(loop.tick(3100,true)||loop.tick(3500,false)||loop.tick(4000,true)||loop.tick(4799,true))return false;
 if(!loop.tick(4800,true)||loop.value()!=LoopState::OPEN)return false;
 for(unsigned t=4820;t<10000;t+=20)if(loop.tick(t,true))return false;
 if(loop.tick(10000,false)||!loop.tick(10800,false)||loop.value()!=LoopState::CLOSED)return false;
 if(loop.tick(11000,true)||!loop.tick(11800,true))return false;
 return true;
}
constexpr bool startupOpen(){
 TamperLoop loop;loop.begin(100,true);
 return !loop.tick(3099,true)&&loop.tick(3100,true)&&loop.value()==LoopState::OPEN&&!loop.tick(4000,true);
}
constexpr bool wraparound(){
 TamperLoop loop;loop.begin(0xfffff000,false);
 return loop.tick(0xfffffbb8,false)&&!loop.tick(0xfffffff0,true)&&loop.tick(0x310,true);
}
static_assert(transitions(),"Closed, debounce, one opening, restoration and reopening");
static_assert(startupOpen(),"A disconnected loop at boot must become OPEN");
static_assert(wraparound(),"Debounce must work across millis wraparound");
