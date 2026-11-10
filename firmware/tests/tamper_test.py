"""Real C++ state-machine checks. Native execution needs g++/clang++.
All build artifacts stay in this workspace; no serial device or network access.
"""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]/'ChildGuard_Wearable_Integrated'
SOURCE=r'''
#include "TamperLoop.h"
#include <cassert>
using cg::TamperLoop;using cg::LoopState;
int main(){
 TamperLoop l;l.begin(0,false);
 assert(!l.tick(2999,false));assert(l.tick(3000,false));assert(l.value()==LoopState::CLOSED);
 assert(!l.tick(3100,true));assert(!l.tick(3500,false));assert(!l.tick(4000,true));
 assert(!l.tick(4799,true));assert(l.tick(4800,true));assert(l.value()==LoopState::OPEN);
 for(unsigned t=4820;t<10000;t+=20)assert(!l.tick(t,true));
 assert(!l.tick(10000,false));assert(l.tick(10800,false));assert(l.value()==LoopState::CLOSED);
 assert(!l.tick(11000,true));assert(l.tick(11800,true));
 TamperLoop startup;startup.begin(0,true);assert(!startup.tick(2999,true));assert(startup.tick(3000,true));
 assert(startup.value()==LoopState::OPEN);
 TamperLoop wrap;wrap.begin(0xfffff000,false);assert(wrap.tick(0xfffffbb8,false));
 assert(!wrap.tick(0xfffffff0,true));assert(wrap.tick(0x310,true));
}
'''
class TamperTests(unittest.TestCase):
 def test_actual_cpp_state_machine(self):
  compiler=shutil.which('g++') or shutil.which('clang++')
  if not compiler:self.skipTest('Native C++ compiler unavailable; hardware/compiler check is separate')
  with tempfile.TemporaryDirectory(dir=ROOT.parent,prefix='tamper-host-') as directory:
   cpp=Path(directory)/'test.cpp';exe=Path(directory)/'test.exe';cpp.write_text(SOURCE)
   subprocess.run([compiler,'-std=c++17','-Wall','-Wextra','-Werror','-I',str(ROOT),str(cpp),'-o',str(exe)],check=True)
   subprocess.run([str(exe)],check=True)
 def test_independent_task_and_reserved_persisted_retry_lane(self):
  runtime=(ROOT/'TamperRuntime.h').read_text();sketch=(ROOT/'ChildGuard_Wearable_Integrated.ino').read_text()
  self.assertIn('pdMS_TO_TICKS(20)',runtime);self.assertIn('INPUT_PULLUP',runtime);self.assertIn('OUTPUT_OPEN_DRAIN',runtime)
  self.assertIn('ARDUINO_USB_CDC_ON_BOOT',runtime);self.assertIn('cg_tamper',runtime)
  self.assertIn('response["data"]["eventId"]',runtime);self.assertIn('if(accepted)',runtime)
  self.assertIn('tamper::flush()',sketch);self.assertIn('tamper::setAssignment(',sketch)
  self.assertLess(sketch.index('tamper::begin();'),sketch.index('delay(1500);'))
  self.assertNotIn('delay(',runtime);self.assertNotIn('HTTP',runtime[runtime.index('void sampleTask'):runtime.index('void begin()')])
  self.assertIn('TAMPER_QUEUE_FULL',runtime);self.assertIn('TAMPER_NVS_FAULT',runtime)
if __name__=='__main__':unittest.main()
