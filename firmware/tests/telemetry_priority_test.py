"""Compile the actual scheduler when a native C++ compiler is available."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

class PriorityScheduling(unittest.TestCase):
    def test_actual_priority_retry_and_wraparound_policy(self):
        compiler = shutil.which('g++') or shutil.which('clang++')
        if not compiler:
            self.skipTest('No native C++ compiler; Arduino board compilation is also a separate check')
        root = Path(__file__).resolve().parents[1] / 'ChildGuard_Wearable_Integrated'
        with tempfile.TemporaryDirectory(dir=root.parent, prefix='priority-host-') as directory:
            source = Path(directory) / 'test.cpp'
            source.write_text('''#include <cassert>
#include "TelemetrySchedule.h"
int main(){
 assert(telemetryDispatchDue(100,0,true,false));
 assert(!telemetryDispatchDue(1499,1000,true,false));
 assert(telemetryDispatchDue(1500,1000,true,false));
 assert(!telemetryDispatchDue(5999,1000,false,false));
 assert(telemetryDispatchDue(6000,1000,false,false));
 assert(!telemetryDispatchDue(1500,1000,true,true));
 assert(telemetryDispatchDue(6000,1000,true,true));
 assert(telemetryDispatchDue(250,0xffffff00u,true,false));
 assert(!telemetryDispatchDue(200,0xffffff00u,true,false));
}''')
            binary = Path(directory) / 'priority-test.exe'
            subprocess.run([compiler,'-std=c++17','-Wall','-Wextra','-Werror','-I',str(root),str(source),'-o',str(binary)],check=True)
            subprocess.run([str(binary)],check=True)

if __name__ == '__main__':
    unittest.main()
