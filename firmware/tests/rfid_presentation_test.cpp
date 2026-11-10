#include "../ChildGuard_RFID_Reader/PresentationGuard.h"
using namespace cg_rfid;
constexpr bool behavior(){
 PresentationGuard guard;Uid a{4,{1,2,3,4}},b{7,{1,2,3,4,5,6,7}},bad{5,{1,2,3,4,5}};
 if(!guard.observe(0,a))return false;
 for(unsigned t=80;t<4000;t+=80)if(guard.observe(t,a))return false; // Held indefinitely.
 if(!guard.observe(4100,b))return false; // A's presentation does not block B.
 guard.absent(4500);
 if(guard.observe(4600,b))return false; // Same UID's independent cooldown.
 guard.absent(5000);
 if(!guard.observe(7000,b))return false;
 if(guard.observe(7100,bad))return false;
 guard.absent(7500);return guard.observe(7600,a);
}
constexpr bool wraparound(){PresentationGuard guard;Uid a{4,{1,2,3,4}};return guard.observe(0xffffff00,a)&&(guard.absent(0x200),!guard.observe(0x300,a))&&(guard.absent(0x600),guard.observe(0xc00,a));}
static_assert(behavior(),"Held-card suppression, same-card cooldown, different-card flow and valid UID length");
static_assert(wraparound(),"Timer rollover must not disable scanning");
