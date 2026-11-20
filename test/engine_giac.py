"""Giac as a first try of the SymPy engine (engine/opensw_giac.py), run by test/engine_giac.mjs
with a Python that has SymPy. Without the package giacpy only the first part runs: nothing
changes when Giac is not there."""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "engine"))
import sympy as sp  # noqa: E402

import opensw_giac as g  # noqa: E402
from opensw_compute import compute  # noqa: E402

fails = []


def check(name, ok, got=""):
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else " -> " + str(got)[:300]))
    if not ok:
        fails.append(name)


def integral(body, var, a="Nothing", b="Nothing"):
    return ["Integrate", ["Function", ["Block", body], var], ["Limits", var, a, b]]


def latex(op, j):
    return json.loads(compute(op, json.dumps(j))).get("latex")


x, y, a = sp.symbols("x y a")
XEX = integral(["Multiply", "x", ["Power", "ExponentialE", "x"]], "x")
HEAVY = integral(["Multiply", ["Power", "x", 5], ["Power", "ExponentialE", ["Multiply", 2, "x"]], ["Sin", ["Multiply", 3, "x"]]], "x")
VANDERMONDE = ["Matrix", ["List"] + [["List", 1, s, ["Power", s, 2], ["Power", s, 3]] for s in "pqrs"]]
SERIES = {"expr": ["Power", "ExponentialE", ["Sin", "x"]], "params": ["x", 8]}

# 1. without Giac (OPENSW_GIAC=0, or no giacpy): every question is None, the answers are SymPy's
have = g.WORKER.start() if os.environ.get("OPENSW_GIAC") != "0" else False
if not have:
    check("no Giac: integral is left to SymPy", g.integral(x * sp.exp(x), (x,)) is None)
    check("no Giac: series", g.series(sp.exp(sp.sin(x)), x, 6) is None)
    check("no Giac: det", g.det(sp.Matrix(4, 4, sp.symbols("a:p"))) is None)
    check("no Giac: no process", g.WORKER.process is None)
    check("no Giac: compute answers", latex("evaluate", XEX) == r"\left(x - 1\right) e^{x}", latex("evaluate", XEX))
    print("skipped: the Giac part (no giacpy in this Python)" if os.environ.get("OPENSW_GIAC") != "0" else "Giac off")
    sys.exit(1 if fails else 0)

# 2. formulas out and answers in: only what is listed
names = g.Names()
names.name(x), names.name(y)  # zv1, zv2
sent = g.to_giac(x ** 2 * sp.exp(-x) / 3 + sp.sqrt(y), names)
check("to Giac", sorted(sent[1:-1].split("+")) == ["((1/3)*(zv1^(2))*exp(((-1)*zv1)))", "(zv2^(1/2))"], sent)
for bad in (sp.Function("f")(x), sp.Float(0.5) * x, sp.gamma(x), sp.Symbol("n", integer=True), sp.Integral(x, x), sp.Piecewise((x, x > 0), (0, True))):
    try:
        g.to_giac(bad, g.Names())
        check("not sent: %s" % bad, False)
    except g.Refused:
        check("not sent: %s" % bad, True)
check("from Giac", g.from_giac("1/2*zv1**2*exp(-zv1)+sqrt(pi)/zv2^-3-ln(abs(zv1))", names) == x ** 2 * sp.exp(-x) / 2 + sp.sqrt(sp.pi) * y ** 3 - sp.log(sp.Abs(x)))
check("from Giac: ln(abs(u)) as ln(u) for an antiderivative", g.from_giac("ln(abs(zv1+1))", names, log_of_abs=False) == sp.log(x + 1))
check("from Giac: infinity", g.from_giac("+infinity", names) == sp.oo and g.from_giac("-infinity", names) == -sp.oo)
for bad in ("integrate(zv1,zv1)", "c_0*exp(zv1)", "1.5*zv1", "rootof([[1,0],[1,0,1]])", "undef", "infinity", "[zv1,1]", "zv9", '"Error"', "zv1+", "x", "zv1!"):
    try:
        g.from_giac(bad, names)
        check("not taken: " + bad, False)
    except g.Refused:
        check("not taken: " + bad, True)

# 3. the answers, checked, and written as SymPy's
check("integral", g.integral(x * sp.exp(-x), (x,)) == (-x - 1) * sp.exp(-x))
check("integral of 1/x is ln x", g.integral(1 / x, (x,)) == sp.log(x))
check("a product with a sum of functions is multiplied out",
      g.integral(sp.exp(a * x) * sp.sin(y * x), (x,)) == a * sp.exp(a * x) * sp.sin(x * y) / (a ** 2 + y ** 2) - y * sp.exp(a * x) * sp.cos(x * y) / (a ** 2 + y ** 2))
check("definite integral", g.integral(sp.exp(-x ** 2), (x, sp.S.Zero, sp.oo)) == sp.sqrt(sp.pi) / 2)
check("a divergent integral is left to SymPy", g.integral(1 / x, (x, sp.S.Zero, sp.S.One)) is None)
check("an integral Giac does not find", g.integral(x ** x, (x,)) is None)
check("the inner integral first", g.integrals(sp.Integral(sp.Integral(x * y, (x, 0, y)), (y, 0, 2))) == 2)
check("series", g.series(sp.exp(sp.sin(x)), x, 5) == 1 + x + x ** 2 / 2 - x ** 4 / 8)
check("series: a pole is left to SymPy", g.series(sp.cos(x) / x, x, 5) is None)
m = sp.Matrix(4, 4, lambda i, j: sp.symbols("p q r s")[i] ** j)
check("det", g.det(m) == m.det())
check("det: numbers and small matrices are SymPy's", g.det(sp.Matrix(4, 4, range(16))) is None and g.det(sp.Matrix(2, 2, [x, 1, 1, x])) is None)
# a wrong answer does not pass the checks
real = g.WORKER.ask
g.WORKER.ask = lambda text: "zv1**2" if text.startswith("integrate") else "1+2*zv1+zv1**6*order_size(zv1)" if text.startswith("series") else "zv1"
check("a wrong antiderivative is not taken", g.integral(x * sp.exp(-x), (x,)) is None)
check("a wrong definite integral is not taken", g.integral(x, (x, sp.S.Zero, sp.S.One)) is None)
check("a wrong series is not taken", g.series(sp.exp(sp.sin(x)), x, 5) is None)
check("a wrong determinant is not taken", g.det(m) is None)
g.WORKER.ask = real

# 4. by compute(), the way the editor asks: the same LaTeX with Giac and without
on = [latex("evaluate", XEX), latex("evaluate", HEAVY), latex("determinant", VANDERMONDE), latex("series", SERIES)]
g.WORKER.off = True
off = [latex("evaluate", XEX), latex("evaluate", HEAVY), latex("determinant", VANDERMONDE), latex("series", SERIES)]
g.WORKER.off = False
check("compute(): the answers are written the same with Giac and without", on == off, [p for p in zip(on, off) if p[0] != p[1]])
# An indefinite integral step proves derivative and exact SymPy equality without asking Giac.
asked, real = [], g.WORKER.ask
g.WORKER.ask = lambda text: (asked.append(text), real(text))[1]
r = json.loads(compute("stepcheck", json.dumps({"expr": XEX, "params": [["Multiply", ["Subtract", "x", 1], ["Power", "ExponentialE", "x"]]]})))
g.WORKER.ask = real
check("stepcheck: derivative and exact SymPy equality without asking Giac", r.get("result") == "equal" and not any(t.startswith("integrate") for t in asked), (r, asked))

# 5. no answer in time: SymPy computes, and the next question has a new process
limit, g.TIME_LIMIT = g.TIME_LIMIT, 0.2
t = time.perf_counter()
slow = g.series(sp.exp(sp.sin(x)) * sp.log(1 + x), x, 700)
took = time.perf_counter() - t
g.TIME_LIMIT = limit
check("no answer in time: None after the limit", slow is None and took < 1.5, (slow is None, took))
check("no answer in time: the process is stopped", g.WORKER.process is None)
check("after that Giac answers again", g.integral(x * sp.exp(-x), (x,)) == (-x - 1) * sp.exp(-x))

# 6. the process crashes: this question is SymPy's, the next one is Giac's again
g.WORKER.process.kill()
g.WORKER.process.wait()
check("after a crash: None", g.integral(x * sp.exp(-x), (x,)) is None)
check("after a crash: compute() answers (SymPy)", latex("evaluate", XEX) == r"\left(x - 1\right) e^{x}")
check("after a crash: Giac answers again", g.integral(x * sp.exp(-x), (x,)) == (-x - 1) * sp.exp(-x) and g.WORKER.process is not None)

print("%d failed" % len(fails))
sys.exit(1 if fails else 0)
