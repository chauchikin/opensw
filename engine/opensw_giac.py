"""Giac as a first try for the heavy computations of opensw_compute.py, when Python runs on the
computer and the package giacpy is there: an integral, a power series, a determinant goes to
Giac (opensw_giac_worker.py, a process of its own) and comes back in milliseconds where SymPy
takes seconds. Whatever goes wrong (no giacpy, no process, a formula Giac's answer cannot be
read from, an answer that fails the check, no answer in time) the function here returns None
and opensw_compute.py computes with SymPy as before. How the answer is written stays the work
of opensw_compute.py.

OPENSW_GIAC=0 in the environment turns it off. In Pyodide there are no processes: off.

Only formulas are sent, never definitions or assumptions: a formula goes out only when every
part of it is of a kind listed here (to_giac), under made-up variable names, and an answer is
taken only when every name in it is known (from_giac) and it passes numerical checks, plus
a symbolic derivative proof for indefinite integrands with branch-risk structure."""
import importlib.util
import os
import queue
import re
import subprocess
import sys
import threading

import mpmath
import sympy as sp

# Seconds Giac has for one answer. The slowest of the 55 comparison problems took Giac 12 ms
# (SymPy: 2 s), so an answer that has not come in 2 s is not coming soon; the process is
# stopped and SymPy computes. Starting the process (importing giacpy) has START_LIMIT.
TIME_LIMIT = 2.0
START_LIMIT = 20.0


class Refused(Exception):
    """A formula that is not sent to Giac, or an answer of Giac that is not taken."""


# ---------------------------------------------------------------------------
# the process
# ---------------------------------------------------------------------------

class Worker:
    def __init__(self):
        self.process = None
        self.answers = None
        self.off = (os.environ.get("OPENSW_GIAC", "").strip().lower() in ("0", "off", "false", "no")
                    or sys.platform == "emscripten")
        self.found = None  # is giacpy installed: looked up at the first use

    def start(self):
        if self.found is None:
            try:
                self.found = importlib.util.find_spec("giacpy") is not None
            except (ImportError, ValueError):
                self.found = False
            self.off = self.off or not self.found
        if self.off:
            return False
        worker = os.path.join(os.path.dirname(os.path.abspath(__file__)), "opensw_giac_worker.py")
        try:
            self.process = subprocess.Popen(
                [sys.executable, "-B", worker], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, encoding="utf-8", errors="replace", bufsize=1,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))  # Windows: no console window
        except (OSError, ValueError):
            self.process, self.off = None, True
            return False
        self.answers = queue.Queue()
        threading.Thread(target=self.read, args=(self.process, self.answers), daemon=True).start()
        if self.answer(START_LIMIT) != "ready":  # giacpy does not load: no Giac from now on
            self.stop()
            self.off = True
            return False
        return True

    @staticmethod
    def read(process, answers):
        for line in process.stdout:
            if line.startswith("@@"):
                answers.put(line[2:].rstrip("\n"))
        answers.put(None)  # the process has ended

    def answer(self, limit):
        try:
            return self.answers.get(timeout=limit)
        except queue.Empty:
            return None

    def stop(self):
        if self.process:
            for end in (self.process.kill, self.process.stdin.close, lambda: self.process.wait(1)):
                try:
                    end()
                except (OSError, subprocess.SubprocessError):
                    pass
        self.process = None

    def ask(self, text):
        """Giac's answer to one expression; None: an error, no answer in time, or no Giac. After
        no answer or a crash the process is stopped; the next question starts a new one."""
        if self.off or (self.process is None and not self.start()):
            return None
        try:
            self.process.stdin.write(text + "\n")
            self.process.stdin.flush()
        except (OSError, ValueError):
            self.stop()
            return None
        r = self.answer(TIME_LIMIT)
        if r is None:
            self.stop()
            return None
        return None if r.startswith("!") else r


WORKER = Worker()


def enabled():
    return not WORKER.off


# ---------------------------------------------------------------------------
# SymPy -> Giac
# ---------------------------------------------------------------------------

# SymPy function -> its name in Giac; a formula with any other function is not sent
TO_GIAC = {
    sp.sin: "sin", sp.cos: "cos", sp.tan: "tan", sp.cot: "cot", sp.sec: "sec", sp.csc: "csc",
    sp.asin: "asin", sp.acos: "acos", sp.atan: "atan", sp.sinh: "sinh", sp.cosh: "cosh", sp.tanh: "tanh",
    sp.asinh: "asinh", sp.acosh: "acosh", sp.atanh: "atanh", sp.exp: "exp", sp.log: "ln", sp.Abs: "abs", sp.erf: "erf",
}
CONSTANTS_TO = {sp.pi: "pi", sp.E: "exp(1)", sp.I: "i", sp.oo: "(+infinity)", -sp.oo: "(-infinity)"}


class Names:
    """The variables of one question: each goes to Giac under a made-up name (zv1, zv2, ..),
    because Giac has names of its own (e, i, D, gamma ..), and comes back as itself."""

    def __init__(self):
        self.out, self.back = {}, {}

    def name(self, symbol):
        if symbol not in self.out:
            # a whole-number variable (assume(n, integer)) may make SymPy's answer another one
            if symbol.is_commutative is not True or symbol.is_integer or isinstance(symbol, sp.Wild):
                raise Refused(symbol)
            self.out[symbol] = "zv%d" % (len(self.out) + 1)
            self.back[self.out[symbol]] = symbol
        return self.out[symbol]


def to_giac(e, names):
    """The formula in Giac's syntax, fully parenthesized. Refused for a part not listed here:
    a decimal, an undefined function, a function Giac may define differently, a matrix .."""
    if e in CONSTANTS_TO:
        return CONSTANTS_TO[e]
    if isinstance(e, sp.Symbol):
        return names.name(e)
    if isinstance(e, sp.Integer):
        return "(%d)" % e.p
    if isinstance(e, sp.Rational):
        return "(%d/%d)" % (e.p, e.q)
    if isinstance(e, (sp.Add, sp.Mul)):
        return "(" + ("+" if isinstance(e, sp.Add) else "*").join(to_giac(x, names) for x in e.args) + ")"
    if isinstance(e, sp.Pow):
        return "(%s^%s)" % (to_giac(e.base, names), to_giac(e.exp, names))
    if type(e) in TO_GIAC and len(e.args) == 1:
        return "%s(%s)" % (TO_GIAC[type(e)], to_giac(e.args[0], names))
    raise Refused(e)


# ---------------------------------------------------------------------------
# Giac -> SymPy
# ---------------------------------------------------------------------------

FROM_GIAC = {
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "cot": sp.cot, "sec": sp.sec, "csc": sp.csc,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan, "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
    "asinh": sp.asinh, "acosh": sp.acosh, "atanh": sp.atanh, "exp": sp.exp, "ln": sp.log, "log": sp.log,
    "sqrt": sp.sqrt, "abs": sp.Abs, "sign": sp.sign, "erf": sp.erf, "erfc": sp.erfc, "Ei": sp.Ei, "Si": sp.Si, "Ci": sp.Ci,
}
CONSTANTS_FROM = {"pi": sp.pi, "e": sp.E, "i": sp.I}
TOKEN = re.compile(r"\s*(\d+\.\d*(?:[eE][-+]?\d+)?|\d+[eE][-+]?\d+|\d+|[A-Za-z_]\w*|\*\*|[-+*/^(),])")


def from_giac(text, names, log_of_abs=True, order=None, functions=FROM_GIAC, constants=CONSTANTS_FROM):
    """Giac's answer as a SymPy expression. Refused for anything but whole numbers, the variables
    of the question, the constants and functions listed above and + - * / ^: a decimal, an
    integral Giac left undone, rootof, undef, a list, a text ..
    log_of_abs False: ln(abs(u)), as Giac writes the integral of u'/u, becomes ln(u) (an
    antiderivative as well, and the one 5.5 and SymPy write).
    order: a symbol for Giac's order_size(x), the remainder of a series.
    functions, constants: the names known, for another system that writes its answers this way
    (opensw_fricas.py)."""
    tokens, at = [], 0
    while at < len(text):
        m = TOKEN.match(text, at)
        if not m:
            if text[at:].strip():
                raise Refused(text)
            break
        tokens.append(m.group(1))
        at = m.end()
    tokens.append("")
    k = 0

    def take(t=None):
        nonlocal k
        if t is not None and tokens[k] != t:
            raise Refused(text)
        k += 1
        return tokens[k - 1]

    def total():  # the terms are added in one step: a determinant has hundreds
        terms = [product()]
        while tokens[k] in ("+", "-"):
            terms.append(product() if take() == "+" else -product())
        return sp.Add(*terms)

    def product():
        factors = [signed()]
        while tokens[k] in ("*", "/"):
            factors.append(signed() if take() == "*" else 1 / signed())
        return sp.Mul(*factors)

    def signed():
        if tokens[k] in ("+", "-"):
            sign = take()
            if tokens[k] == "infinity":  # +infinity, -infinity; infinity alone has no direction
                take()
                return sp.oo if sign == "+" else -sp.oo
            return signed() if sign == "+" else -signed()
        r = atom()
        if tokens[k] in ("^", "**"):
            take()
            r = sp.Pow(r, signed())
        return r

    def atom():
        t = take()
        if t == "(":
            r = total()
            take(")")
            return r
        if t.isdigit():
            return sp.Integer(t)
        if not re.fullmatch(r"[A-Za-z_]\w*", t):
            raise Refused(text)
        if tokens[k] != "(":
            if t in names.back:
                return names.back[t]
            if t in constants:
                return constants[t]
            raise Refused(text)
        take("(")
        x = total()
        take(")")
        if t == "order_size" and order is not None:
            return order
        if t not in functions:
            raise Refused(text)
        if t in ("ln", "log") and isinstance(x, sp.Abs) and not log_of_abs and not x.args[0].is_number:
            x = x.args[0]
        return functions[t](x)

    r = total()
    if tokens[k] != "" or r.has(sp.nan, sp.zoo):
        raise Refused(text)
    return r


# ---------------------------------------------------------------------------
# the checks with numbers
# ---------------------------------------------------------------------------

# values for the variables: not special ones (0, 1, a zero of sin ..); the second set has both signs
POINTS = (("0.7310", "1.2970", "0.4130", "1.8710", "0.5690", "2.3170"),
          ("-0.8390", "0.6170", "-1.4590", "0.3530", "1.1030", "-0.2710"))


def points(symbols):
    """Dictionaries symbol -> value to check with; a positive variable gets positive values .."""
    out = []
    for row in POINTS:
        values = {}
        for i, s in enumerate(sorted(symbols, key=str)):
            v = mpmath.mpf(row[i % len(row)]) + i // len(row)
            if s.is_positive or s.is_nonnegative:
                v = abs(v)
            elif s.is_negative or s.is_nonpositive:
                v = -abs(v)
            values[s] = v
        out.append(values)
    return out


def close(a, b, digits, floor=0):
    """Do a and b agree to `digits` digits? floor: the size below which both count as 0 (for a
    definite integral, whose value can be 0 itself: quadrature leaves noise there)."""
    return mpmath.isfinite(a) and mpmath.isfinite(b) and abs(a - b) <= mpmath.mpf(10) ** -digits * max(floor, abs(a), abs(b))


# values for the variable of an indefinite integral, to check an antiderivative with: one can be
# right on part of the line only (FriCAS's x^2/2 + x for sqrt(x^2 + 2x + 1) = |x + 1|, right for
# x > -1, passed at the two values of POINTS), so both signs and sizes from about 0.1 to 10, not
# special numbers; fixed, so that answers are the same each time
VARIABLE_POINTS = ("0.1173", "-0.1931", "0.3530", "-0.4130", "0.6170", "-0.7310", "1.1030", "-1.2970", "1.5690",
                   "-1.8710", "2.3170", "-2.7590", "3.4430", "-4.1590", "5.2710", "-6.3830", "7.7290", "-9.4370")
# a point where a side has no value (a pole, a function mpmath has not) is no evidence; with
# fewer than a third of the points left there is not enough to go on and the answer is no
MIN_VALUED = 6


def branch_risk(f):
    """Roots/fractional powers of repeated symbolic factors, or Abs/sign.
    Factor over all symbols, including parameters. This deliberately does not find hidden
    squares such as 1-cos(x) or 1+sin(x): numerical checking alone is not a branch proof.
    """
    if f.has(sp.Abs, sp.sign):
        return True
    for n in sp.preorder_traversal(f):
        if not n.is_Pow or n.exp.is_integer is True or not n.base.free_symbols:
            continue
        base = sp.factor(n.base, extension=True)
        if any(t.is_Pow and t.exp.is_Integer and abs(t.exp) >= 2 and t.base.free_symbols
               for t in sp.Mul.make_args(base)):
            return True
    return False


def same_derivative(r, f, x):
    """Numerical sieve, plus a symbolic proof for branch-risk integrands.
    No assumptions are added and powers are never forcibly denested. Ordinary integrands
    still get numerical checking only, not a proof. Parameter signs vary independently of x.
    Undefined f and values below the working precision give no evidence; a finite f with an
    undefined derivative rejects the candidate. At least MIN_VALUED comparisons are needed.
    """
    d = sp.diff(r, x)
    if branch_risk(f) and sp.simplify(d - f) != 0:
        return False
    others = sorted((d.free_symbols | f.free_symbols) - {x}, key=str)
    rows = points(others)
    # The second column of POINTS used to stay positive, and its row was selected by the
    # parity of x's index. Test each row at every x, with either sign of every parameter.
    rows += [{s: (-v if not (s.is_nonnegative or s.is_nonpositive) else v) for s, v in row.items()}
             for row in list(rows)]
    rows = [dict(row) for row in dict.fromkeys(tuple(row.items()) for row in rows)]
    with mpmath.workdps(30):
        try:
            derivative = sp.lambdify([x] + others, d, "mpmath")
            integrand = sp.lambdify([x] + others, f, "mpmath")
        except Exception:  # a derivative left undone (of sign(x) ..): nothing can be checked
            return False
        valued = 0
        for text in VARIABLE_POINTS:
            v = mpmath.mpf(text)
            v = abs(v) if (x.is_positive or x.is_nonnegative) else -abs(v) if (x.is_negative or x.is_nonpositive) else v
            for values in rows:
                args = [v] + [values[s] for s in others]
                try:
                    b = mpmath.mpmathify(integrand(*args))
                except Exception:
                    continue
                if not mpmath.isfinite(b):
                    continue
                try:
                    a = mpmath.mpmathify(derivative(*args))
                except Exception:
                    return False
                if not mpmath.isfinite(a):
                    return False
                if max(abs(a), abs(b)) < mpmath.mpf(10) ** -mpmath.mp.dps:
                    continue
                if not close(a, b, 20):
                    return False
                valued += 1
        return valued >= MIN_VALUED


# ---------------------------------------------------------------------------
# what opensw_compute.py asks
# ---------------------------------------------------------------------------

def asked(make, read):
    """make(names) -> the question; read(answer text, names) -> the result. None when anything
    along the way says no."""
    if WORKER.off:
        return None
    try:
        names = Names()
        text = WORKER.ask(make(names))
        return None if text is None else read(text, names)
    except Refused:
        return None
    except Exception:  # an answer SymPy cannot work with: as no answer
        return None


def integral(f, limit):
    """The integral of f; limit: (x,) or (x, a, b). None: not by Giac.
    Indefinite: checked by differentiating (same_derivative). Definite: checked against numerical integration."""
    x = limit[0]
    if len(limit) == 1:
        def read(text, names):
            r = from_giac(text, names, log_of_abs=False)
            if not same_derivative(r, f, x):
                raise Refused(text)
            return sp.Add(*[multiplied_out(term) for term in sp.Add.make_args(r)])
        return asked(lambda names: "integrate(%s,%s)" % (to_giac(f, names), names.name(x)), read)
    if len(limit) != 3:
        return None
    a, b = limit[1:]

    def read(text, names):
        r = from_giac(text, names)
        if r.has(sp.oo, -sp.oo) or not definite_checked(f, x, a, b, r):
            raise Refused(text)
        return r
    return asked(lambda names: "integrate(%s,%s,%s,%s)" % (to_giac(f, names), names.name(x), to_giac(a, names), to_giac(b, names)), read)


def multiplied_out(term):
    """Giac writes e^(ax) (a sin(bx)/(a^2 + b^2) - b cos(bx)/(a^2 + b^2)), SymPy and 5.5 the two
    products: a product with a sum of functions in it is multiplied out. (x + 1) e^x, a
    polynomial times a function, stays as it is, as SymPy leaves it."""
    if term.is_Mul and any(f.is_Add and not f.is_polynomial() for f in term.args):
        return sp.expand_mul(term)
    return term


def definite_checked(f, x, a, b, r):
    """Is r the integral of f from a to b: compared with mpmath's quadrature (to 10 digits) at
    each check point for the other variables."""
    symbols = sorted((f.free_symbols | a.free_symbols | b.free_symbols | r.free_symbols) - {x}, key=str)
    g = sp.lambdify([x] + symbols, f, "mpmath")
    ends = sp.lambdify(symbols, [a, b, r], "mpmath")
    with mpmath.workdps(20):
        seen = 0
        for values in points(symbols)[:1 if not symbols else 2]:
            vs = [values[s] for s in symbols]
            try:
                lo, hi, value = ends(*vs)
                got, error = mpmath.quad(lambda t: g(t, *vs), [lo, hi], error=True)
            except Exception:
                continue
            if error > mpmath.mpf(10) ** -10 * max(1, abs(got)) or not close(got, mpmath.mpmathify(value), 10, floor=1):
                return False
            seen += 1
        return seen >= (1 if not symbols else 2)


def integrals(e):
    """e with the integrals in it Giac can do worked out; the others, and everything else, are
    left for SymPy's doit(). An integral of an integral is worked out only when both are:
    SymPy takes longer over Giac's inner answer than over its own."""
    if WORKER.off or not e.has(sp.Integral):
        return e
    if type(e) is sp.Integral:  # exactly: not opensw_compute's integrals that are kept as written
        f = integrals(e.function)
        for limit in () if f.has(sp.Integral) else e.limits:
            f = integral(f, tuple(limit))
            if f is None:
                break
        else:
            if not f.has(sp.Integral):
                return f
        return e
    if isinstance(e, sp.Integral):
        return e
    args = [integrals(x) for x in e.args]
    return e.func(*args) if any(x is not y for x, y in zip(args, e.args)) else e


def series(g, t, n):
    """The series of g at t = 0 with the powers of t below n (as sp.series(g, t, 0, n).removeO()).
    Checked: the difference from g at two small t falls as t^n does."""
    def read(text, names):
        order = sp.Dummy("order")
        r = sp.expand(from_giac(text, names, order=order))
        rest = r.coeff(order)  # t^k order_size(t): Giac's series is complete below t^k
        s = r.subs(order, 0)
        if rest == 0 or not (rest.is_Pow and rest.base == t and rest.exp.is_Integer and rest.exp >= n) or not s.is_polynomial(t):
            raise Refused(text)
        s = sp.Add(*[term for term in sp.Add.make_args(s) if sp.degree(term, t) < n])
        symbols = sorted(g.free_symbols | s.free_symbols, key=str)
        f = sp.lambdify(symbols, g - s, "mpmath")
        with mpmath.workdps(60):
            for values in points(symbols):
                d = []
                for h in (mpmath.mpf(1) / 32, mpmath.mpf(1) / 64):
                    values[t] = h
                    d.append(abs(mpmath.mpmathify(f(*[values[v] for v in symbols]))))
                if not (d[0] <= mpmath.mpf(10) ** -50 or d[1] <= d[0] / mpmath.mpf(2) ** (n - 0.5)):
                    raise Refused(text)
        return s
    return asked(lambda names: "series(%s,%s=0,%d)" % (to_giac(g, names), names.name(t), n - 1), read)


def det(m):
    """The determinant of a matrix of 4 or more rows with letters in it (SymPy is quick with
    numbers and with small matrices), written as SymPy's det() writes it (cancelled). Checked:
    at two points for the letters it is the determinant of the matrix of numbers."""
    if WORKER.off or m.rows != m.cols or m.rows < 4 or not m.free_symbols:
        return None

    def read(text, names):
        r = from_giac(text, names)
        r = sp.expand(r) if r.is_polynomial() else sp.cancel(r)
        symbols = sorted(m.free_symbols | r.free_symbols, key=str)
        for row in ((3, 7, 11, 13, 17, 19, 23), (-5, 2, 29, -31, 37, 41, -43)):
            values = {s: sp.Rational(row[i % len(row)] + i // len(row), 10) for i, s in enumerate(symbols)}
            if sp.simplify(m.subs(values).det() - r.subs(values)) != 0:
                raise Refused(text)
        return r
    return asked(lambda names: "det([%s])" % ",".join(
        "[" + ",".join(to_giac(sp.sympify(x), names) for x in m.row(i)) + "]" for i in range(m.rows)), read)
