"""Giac (by the Python package giacpy) as a process of its own, for opensw_giac.py: each line
in is one Giac expression, each line out "@@" and its answer ("@@!" and the message for an
error). Giac is native code: when it does not come back, only stopping the process ends it,
and when it crashes it does not take SymPy with it."""
import os
import sys
import threading
import time

# the answers go out by a copy of standard output; what Giac itself prints (warnings) is dropped
out = os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n")
null = os.open(os.devnull, os.O_WRONLY)
os.dup2(null, 1)
os.dup2(null, 2)

try:
    from giacpy import giac
except Exception:  # no giacpy here: opensw_giac.py goes on without Giac
    out.write("@@none\n")
    out.flush()
    sys.exit(1)

# the lines are read by a thread, so that the end of the input (opensw closed, or stopped)
# ends this process even while Giac is still computing: 5 seconds for the lines already read
lines, more = [], threading.Semaphore(0)


def read():
    for line in sys.stdin:
        lines.append(line)
        more.release()
    more.release()
    time.sleep(5)
    os._exit(0)


threading.Thread(target=read, daemon=True).start()
out.write("@@ready\n")
out.flush()
while True:
    more.acquire()
    if not lines:  # the end of the input
        break
    try:
        answer = str(giac(lines.pop(0).strip()))
    except Exception as e:  # giacpy raises for a Giac error
        answer = "!" + str(e)
    out.write("@@" + " ".join(answer.split()) + "\n")
    out.flush()
