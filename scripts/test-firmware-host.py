"""Run firmware host scripts separately, preserving their CLI arguments.

No serial ports, network services or Arduino upload tools are invoked.
"""
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
native = {"activity_test.py", "activity_sampler_test.py", "gate_workflow_test.py", "multi_beacon_test.py"}
compiler = shutil.which("g++")
failed = 0
for script in sorted((root / "firmware/tests").glob("*_test.py")):
    if script.name in native and not compiler:
        print(f"BLOCKED {script.name}: g++ is not available", flush=True)
        continue
    result = subprocess.run([sys.executable, str(script)], cwd=root)
    print(f"{'PASS' if result.returncode == 0 else 'FAIL'} {script.name}", flush=True)
    failed += result.returncode != 0

for source in sorted((root / "firmware/tests").glob("*_test.cpp")):
    if not compiler:
        print(f"BLOCKED {source.name}: g++ is not available", flush=True)
        continue
    import tempfile
    with tempfile.TemporaryDirectory(dir=root / 'firmware', prefix="firmware-host-") as folder:
        binary = Path(folder) / "test.exe"
        result = subprocess.run([compiler, "-std=c++17", "-Wall", "-Wextra", "-Werror", str(source), "-o", str(binary)], cwd=root)
        if result.returncode == 0:
            result = subprocess.run([str(binary)], cwd=root)
        print(f"{'PASS' if result.returncode == 0 else 'FAIL'} {source.name}", flush=True)
        failed += result.returncode != 0
sys.exit(bool(failed))
