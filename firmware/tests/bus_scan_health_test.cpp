#include "../ChildGuard_Wearable_Integrated/BusScanHealth.h"
constexpr bool healthyWindows(){
 BusScanHealth h;h.reset(0);
 for(unsigned t=200;t<=5000;t+=200)h.sample(t,true);
 if(h.take(5000).valid())return false; // startup has not proven uninterrupted scanning
 for(unsigned t=5200;t<=10000;t+=200)h.sample(t,true);
 return h.take(10000).valid();
}
constexpr bool interruptedWindow(){
 BusScanHealth h;h.reset(0);h.sample(200,true);h.take(200);
 for(unsigned t=400;t<=5200;t+=200)h.sample(t,t!=2000);
 return !h.take(5200).valid();
}
constexpr bool stalledTask(){
 BusScanHealth h;h.reset(0);h.sample(200,true);h.take(200);
 h.sample(5200,true);return !h.take(5200).valid();
}
constexpr bool stoppedCallback(){
 BusScanHealth h;h.reset(0);h.sample(200,true);h.take(200);
 for(unsigned t=400;t<=5200;t+=200)h.sample(t,true);
 return !h.take(5200,true).valid();
}
static_assert(healthyWindows(),"requires a full healthy scan window");
static_assert(interruptedWindow(),"scanner interruption cannot prove absence");
static_assert(stalledTask(),"missing watchdog ticks cannot prove absence");
static_assert(stoppedCallback(),"scan-end callback invalidates a window immediately");
static_assert(!BusScanHealth::Window{8000,8000,200}.valid(),"long reporting gaps are unknown");
static_assert(!BusScanHealth::Window{5000,1000,200}.valid(),"partial active scanning is not healthy");
static_assert(BusScanHealth::Window{5000,4800,200}.valid(),"allows bounded measurement tick tolerance");
