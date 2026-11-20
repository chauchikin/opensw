"""FriCAS, asked for indefinite integrals before SymPy (engine/opensw_fricas.py), run by
test/engine_fricas.mjs with a Python that has SymPy. Without FriCAS (none in engine/fricas and
none where OPENSW_FRICAS_DIR says) only parts 0 and 1 run: nothing changes when FriCAS is
not there."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "engine"))
import sympy as sp  # noqa: E402

import opensw_fricas as fr  # noqa: E402
import opensw_giac as g  # noqa: E402
from opensw_compute import compute  # noqa: E402

fails = []


def check(name, ok, got=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else " -> " + str(got)[:300]))
    if not ok:
        fails.append(name)


def integral(body, var):
    return ["Integrate", ["Function", ["Block", body], var], ["Limits", var, "Nothing", "Nothing"]]


def latex(op, j):
    return json.loads(compute(op, json.dumps(j))).get("latex")


x, y, a = sp.symbols("x y a")
ROOT_OF_SINE = ["Sqrt", ["Add", 1, ["Sin", "x"]]]  # an integral neither Giac nor SymPy finds, and FriCAS does
XEX = integral(["Multiply", "x", ["Power", "ExponentialE", "x"]], "x")
XX = integral(["Power", "x", "x"], "x")  # one nobody finds
NESTED_ROOT = ["Sqrt", ["Add", "x", ["Sqrt", ["Add", 1, ["Power", "x", 2]]]]]  # Giac finds none; SymPy one with gamma functions, FriCAS one without
left = sp.Integral(sp.sqrt(1 + sp.sin(x)), x)

# 0. FriCAS's folder as FriCAS is given it: without the \\?\ the desktop app's paths begin with
for long, plain in ((r"\\?\C:\opensw\engine\fricas", r"C:\opensw\engine\fricas"), (r"\\?\UNC\server\share\fricas", r"\\server\share\fricas"),
                    (r"C:\opensw\engine\fricas", r"C:\opensw\engine\fricas"), ("/opt/opensw/engine/fricas", "/opt/opensw/engine/fricas")):
    check("the folder's path: " + long, fr.plain_path(long) == plain, fr.plain_path(long))

# 1. without FriCAS (OPENSW_FRICAS=0, or none found): every question is None, the answers are SymPy's
have = fr.WORKER.start() if os.environ.get("OPENSW_FRICAS") != "0" else False
if not have:
    check("no FriCAS: the integral is left as it is", fr.integral(sp.sqrt(1 + sp.sin(x)), x) is None and fr.integrals(left) is left)
    check("no FriCAS: no process", fr.WORKER.process is None)
    check("no FriCAS: compute answers", latex("evaluate", XEX) == r"\left(x - 1\right) e^{x}", latex("evaluate", XEX))
    check("no FriCAS: an integral SymPy leaves stays an integral", r"\int" in latex("evaluate", integral(ROOT_OF_SINE, "x")), latex("evaluate", integral(ROOT_OF_SINE, "x")))
    print("skipped: the FriCAS part (no FriCAS in engine/fricas; set OPENSW_FRICAS_DIR to one)" if os.environ.get("OPENSW_FRICAS") != "0" else "FriCAS off")
    sys.exit(1 if fails else 0)

# 2. formulas out and answers in: only what is listed
names = g.Names()
names.name(x), names.name(y)  # zv1, zv2
sent = fr.to_fricas(x ** 2 * sp.exp(-x) / 3 + sp.sqrt(y) + sp.pi, names)
check("to FriCAS", sorted(sent[1:-1].split("+")) == ["%pi", "((1/3)*(zv1^(2))*exp(((-1)*zv1)))", "(zv2^(1/2))"], sent)
for bad in (sp.Function("f")(x), sp.Float(0.5) * x, sp.gamma(x), sp.Symbol("n", integer=True), sp.Integral(x, x), sp.Piecewise((x, x > 0), (0, True)),
            sp.Abs(x), sp.I * x, sp.oo):
    try:
        fr.to_fricas(bad, g.Names())
        check("not sent: %s" % bad, False)
    except g.Refused:
        check("not sent: %s" % bad, True)
check("from FriCAS", fr.from_fricas("((-1)*zv1^2*exp((-1)*zv1)+pi()^(1/2)*zv2^3)/2+li(zv1)+log(zv1+(-1))", names)
      == (-x ** 2 * sp.exp(-x) + sp.sqrt(sp.pi) * y ** 3) / 2 + sp.li(x) + sp.log(x - 1))
for bad in ("integral(zv1^zv1,zv1::Symbol)", "[atan(zv1),log(zv1)]", "rootOf((%%A0^3+%%A0+1)/3,%%A0)", "ellipticF(zv1,-1)", "complex(1,0)*zv1",
            "1.5*zv1", "zv9", "%i*zv1", '"Error"', "zv1+", "x", "e"):
    try:
        fr.from_fricas(bad, names)
        check("not taken: " + bad, False)
    except g.Refused:
        check("not taken: " + bad, True)

# 3. the answers, checked by differentiating
r = fr.integral(sp.sqrt(1 + sp.sin(x)), x)
check("integral", r is not None and not r.has(sp.Integral) and g.same_function(sp.diff(r, x), sp.sqrt(1 + sp.sin(x))), r)
check("integral with pi and a letter", fr.integral(sp.pi * a * sp.exp(-x), x) == -sp.pi * a * sp.exp(-x))
check("an integral FriCAS does not find", fr.integral(x ** x, x) is None)
check("an answer for each sign of a letter is not taken", fr.integral(1 / (x ** 2 + a), x) is None)
check("an error of FriCAS", fr.integral(sp.exp(2 * x) / sp.sqrt(sp.exp(x) + 1) * x, x) is None and fr.WORKER.process is not None)
kept = sp.Integral(sp.sin(x) / x, (x, 0, 1))
done = fr.integrals(2 * left + sp.Integral(x ** x, x) + kept)
check("integrals(): the indefinite ones FriCAS finds, the others as they are",
      done == 2 * r + sp.Integral(x ** x, x) + kept, done)
check("integrals(): the inner integral first", fr.integrals(sp.Integral(sp.Integral(x * y, x), y)) == x ** 2 * y ** 2 / 4)
check("integrals(): nothing to do", fr.integrals(x + 1) == x + 1)
# a wrong answer does not pass the check
real = fr.WORKER.ask
fr.WORKER.ask = lambda text: "zv1^2"
check("a wrong antiderivative is not taken", fr.integral(sp.sqrt(1 + sp.sin(x)), x) is None and fr.integrals(left) is left)
fr.WORKER.ask = real

# 4. by compute(), the way the editor asks: Giac, then FriCAS, then SymPy
def answers():
    return [latex("evaluate", XEX), latex("evaluate", XX), latex("evaluate", integral(ROOT_OF_SINE, "x")),
            json.loads(compute("integrate", json.dumps({"expr": ROOT_OF_SINE, "params": ["x"]}))).get("latex"),
            latex("evaluate", integral(NESTED_ROOT, "x"))]


on = answers()
fr.WORKER.off = True
off = answers()
fr.WORKER.off = False
check("compute(): a simple integral, and one nobody finds, is written the same", on[:2] == off[:2], (on[:2], off[:2]))
check("compute(): Evaluate has the integral only FriCAS finds", r"\int" in off[2] and r"\int" not in on[2] and r"\sqrt{\sin x + 1}" in on[2], (on[2], off[2]))
check("compute(): Integrate has it too", r"\int" in off[3] and on[3] == on[2], (on[3], off[3]))
by_fricas = fr.integral(sp.sqrt(x + sp.sqrt(1 + x ** 2)), x)
check("compute(): FriCAS is asked before SymPy (its answer has no gamma function, SymPy's has)",
      by_fricas is not None and r"\Gamma" not in on[4] and r"\int" not in on[4] and r"\Gamma" in off[4], (on[4], off[4]))

# 5. no answer in time: the integral stays, and the next question has a new process
limit, fr.TIME_LIMIT = fr.TIME_LIMIT, 0.5
t = time.perf_counter()
slow = fr.integral((x ** 2 + 1) ** sp.Rational(1, 3) / (x ** 3 + x + 2), x)
took = time.perf_counter() - t
fr.TIME_LIMIT = limit
check("no answer in time: None after the limit", slow is None and took < 2.5, (slow is None, took))
check("no answer in time: the process is stopped", fr.WORKER.process is None)
check("after that FriCAS answers again", fr.integral(sp.pi * a * sp.exp(-x), x) == -sp.pi * a * sp.exp(-x))

# 6. the process crashes: this integral stays, the next one is FriCAS's again
fr.WORKER.process.kill()
fr.WORKER.process.wait()
check("after a crash: None", fr.integral(sp.sqrt(1 + sp.sin(x)), x) is None)
check("after a crash: compute() answers", latex("evaluate", XEX) == r"\left(x - 1\right) e^{x}")
check("after a crash: FriCAS answers again", fr.integral(sp.sqrt(1 + sp.sin(x)), x) == r and fr.WORKER.process is not None)
fr.WORKER.stop()

# 7. Windows: FriCAS answers when its folder is written \\?\C:\.., as the desktop app writes it
if os.name == "nt" and os.path.abspath(fr.WORKER.root)[1:3] == ":\\":
    os.environ["OPENSW_FRICAS_DIR"] = "\\\\?\\" + os.path.abspath(fr.WORKER.root)
    fr.WORKER = fr.Worker()
    check(r"a folder written \\?\C:\..: FriCAS answers", fr.integral(sp.sqrt(1 + sp.sin(x)), x) == r and fr.WORKER.process is not None)
    fr.WORKER.stop()

print("%d failed" % len(fails))
sys.exit(1 if fails else 0)
