"""opensw_compute.py (SymPy) run as an engine on the computer, speaking the line protocol of
ENGINE.md: python opensw_stdio.py, then each line in is "<op> <request in base64>" and each
line out "@@OPENSW@@<answer in base64>". The desktop app computes with it, by the Python that
comes with the app (engine/engines.json, "python"); scripts/engine-check.mjs uses it to check
SymPy the same way as the other engines; it is also the smallest example of an adapter."""
import base64
import json
import os
import platform
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from opensw_compute import compute  # noqa: E402

print("@@OPENSW@@ready", flush=True)
for line in sys.stdin:
    op, _, data = line.strip().partition(" ")
    answer = compute(op, base64.b64decode(data).decode("utf-8"))
    if op == "version":  # Tools > Computation Engine: which Python it is, too (not the one in Pyodide)
        answer = json.loads(answer)
        answer["solutions"].append("Python " + platform.python_version())
        answer = json.dumps(answer)
    print("@@OPENSW@@" + base64.b64encode(answer.encode("utf-8")).decode("ascii"), flush=True)
