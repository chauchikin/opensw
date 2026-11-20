"""FriCAS for the indefinite integrals Giac does not find, when Python runs on the computer and
FriCAS is there: such an integral is given to FriCAS before SymPy. Its integrator finds more of
them (roots of functions, mixed exponentials and logarithms), it writes with elementary
functions some that SymPy answers with gamma and hypergeometric functions, and it says no in
a fraction of a second where SymPy takes seconds. Whatever goes wrong (no FriCAS, no process,
a formula FriCAS's answer cannot be read from, an answer that fails the check, no answer in
time) the function here returns None and opensw_compute.py computes with SymPy as before.
How the answer is written stays the work of opensw_compute.py.

FriCAS is looked for in the folder fricas beside this file (the desktop app comes with it), or
where OPENSW_FRICAS_DIR in the environment says: the folder that holds bin/FRICASsys.
OPENSW_FRICAS=0 turns it off. In Pyodide there are no processes: off.

As with Giac, only formulas are sent: a formula goes out only when every part of it is of a
kind listed here (to_fricas), under made-up variable names, and an answer is taken only when
every name in it is known and its derivative is the formula at the check points."""
import os
import queue
import subprocess
import sys
import threading

import sympy as sp

from opensw_giac import Names, Refused, from_giac, same_derivative

# Seconds FriCAS has for one answer; it is asked before SymPy, so this is the most SymPy's turn
# is put off. Of the 43 hard integrals it was tried with, the 41 it found came within 0.6 s
# each and the other two it refused at once; but an integrand it searches long for (a cube
# root over a cubic) had not ended after 20 s. 5 s leaves room for a slower computer. Starting
# the process, with the integral start() asks to have FriCAS load its integrator, takes 0.3 s,
# and longer the first time (its files not yet read from the disk).
TIME_LIMIT = 5.0
START_LIMIT = 20.0

# FriCAS is used as it prints to a terminal: no prompt, no two-dimensional output, no history
# kept (memory), and the answer written by a line of our own (ask)
SETUP = (")set messages prompt none", ")set messages type off", ")set messages time off", ")set messages autoload off",
         ")set output algebra off", ")set history off", ")set quit unprotected", "TERPRI()$Lisp")
WARM_UP = "unparse(integrate((exp(zv1)*sin(zv1)+sqrt(zv1+1))::Expression(Integer),zv1)::InputForm)"


# ---------------------------------------------------------------------------
# the process
# ---------------------------------------------------------------------------

def plain_path(path):
    r"""A Windows path without the \\?\ it may begin with: \\?\C:\.. is C:\.., and
    \\?\UNC\server\share\.. is \\server\share\..; any other path as it is. The desktop app
    starts Python with paths written that way, so the folder beside this file is one too, and
    FriCAS (the SBCL it is built with) ends at once when its folder is named so: "Can't find
    the TRUENAME of wild pathname"."""
    if path.startswith("\\\\?\\UNC\\"):
        return "\\\\" + path[8:]
    if path.startswith("\\\\?\\"):
        return path[4:]
    return path


class Worker:
    def __init__(self):
        self.process = None
        self.lines = None
        self.off = (os.environ.get("OPENSW_FRICAS", "").strip().lower() in ("0", "off", "false", "no")
                    or sys.platform == "emscripten")
        self.root = None  # where FriCAS is: looked up at the first use

    def start(self):
        if self.root is None:
            self.root = plain_path(os.environ.get("OPENSW_FRICAS_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "fricas"))
            self.off = self.off or not os.path.isfile(self.program())
        if self.off:
            return False
        try:
            # its own folder is the working folder: FriCAS reads .fricas.input from there, and
            # would write there. Bytes, not text: FriCAS takes the "\r" of "\r\n" as part of a line
            self.process = subprocess.Popen(
                [self.program()], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                cwd=self.root, env=dict(os.environ, FRICAS=self.root),
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))  # Windows: no console window
        except (OSError, ValueError):
            self.process, self.off = None, True
            return False
        self.lines = queue.Queue()
        threading.Thread(target=self.read, args=(self.process, self.lines), daemon=True).start()
        # A small integral is asked at once: FriCAS loads its integrator at the first one, and where
        # its files are slow to read that would take the first real question past TIME_LIMIT, so that
        # SymPy answered it and FriCAS the same question later, written another way
        if self.said("\n".join(SETUP) + "\n" + WARM_UP, START_LIMIT) is None:  # no FriCAS from now on
            self.stop()
            self.off = True
            return False
        return True

    def program(self):
        return os.path.join(self.root, "bin", "FRICASsys.exe" if os.name == "nt" else "FRICASsys")

    @staticmethod
    def read(process, lines):
        for line in process.stdout:
            lines.put(line.decode("utf-8", "replace").rstrip("\r\n"))
        lines.put(None)  # the process has ended

    def stop(self):
        if self.process:
            for end in (self.process.kill, self.process.stdin.close, lambda: self.process.wait(1)):
                try:
                    end()
                except (OSError, subprocess.SubprocessError):
                    pass
        self.process = None

    def said(self, text, limit):
        """What FriCAS writes for text, whose last line is an expression for a String: a line
        "@@a " and the string, then a line "@@e" from a second command, which comes after an
        error too. The marks are sent in two pieces, so that a message of FriCAS repeating the
        line it was given has none. None: an error, the process ended, or no "@@e" in time
        (the process is stopped then)."""
        *before, value = text.split("\n")
        ask = 'PRINC(concat(["@", "@a ", %s]))$Lisp; TERPRI()$Lisp\nPRINC(concat("@", "@e"))$Lisp; TERPRI()$Lisp\n' % value
        try:
            self.process.stdin.write(("".join(line + "\n" for line in before) + ask).encode("ascii"))
            self.process.stdin.flush()
        except (OSError, ValueError):
            self.stop()
            return None
        answer = None
        while True:
            try:
                line = self.lines.get(timeout=limit)
            except queue.Empty:
                line = None
            if line is None:
                self.stop()
                return None
            if line.startswith("@@a "):
                answer = line[4:]
            elif line == "@@e":
                return answer

    def ask(self, text):
        """FriCAS's answer to one expression, as it would be typed in (its InputForm); None: an
        error, no answer in time, or no FriCAS. After no answer or a crash the process is
        stopped; the next question starts a new one."""
        if self.off or (self.process is None and not self.start()):
            return None
        return self.said("unparse((%s)::InputForm)" % text, TIME_LIMIT)


WORKER = Worker()


# ---------------------------------------------------------------------------
# SymPy -> FriCAS
# ---------------------------------------------------------------------------

# SymPy function -> its name in FriCAS; a formula with any other function is not sent
TO_FRICAS = {
    sp.sin: "sin", sp.cos: "cos", sp.tan: "tan", sp.cot: "cot", sp.sec: "sec", sp.csc: "csc",
    sp.asin: "asin", sp.acos: "acos", sp.atan: "atan", sp.acot: "acot",
    sp.sinh: "sinh", sp.cosh: "cosh", sp.tanh: "tanh", sp.coth: "coth", sp.sech: "sech", sp.csch: "csch",
    sp.asinh: "asinh", sp.acosh: "acosh", sp.atanh: "atanh", sp.exp: "exp", sp.log: "log", sp.erf: "erf",
}
CONSTANTS_TO = {sp.pi: "%pi", sp.E: "%e"}


def to_fricas(e, names):
    """The formula in FriCAS's syntax, fully parenthesized. Refused for a part not listed here:
    a decimal, i (FriCAS answers with complex(..)), an undefined function, |x|, a matrix .."""
    if e in CONSTANTS_TO:
        return CONSTANTS_TO[e]
    if isinstance(e, sp.Symbol):
        return names.name(e)
    if isinstance(e, sp.Integer):
        return "(%d)" % e.p
    if isinstance(e, sp.Rational):
        return "(%d/%d)" % (e.p, e.q)
    if isinstance(e, (sp.Add, sp.Mul)):
        return "(" + ("+" if isinstance(e, sp.Add) else "*").join(to_fricas(x, names) for x in e.args) + ")"
    if isinstance(e, sp.Pow):
        return "(%s^%s)" % (to_fricas(e.base, names), to_fricas(e.exp, names))
    if type(e) in TO_FRICAS and len(e.args) == 1:
        return "%s(%s)" % (TO_FRICAS[type(e)], to_fricas(e.args[0], names))
    raise Refused(e)


# ---------------------------------------------------------------------------
# FriCAS -> SymPy
# ---------------------------------------------------------------------------

# The names an answer may have; with any other (integral: not found; rootOf, %%A0: a root of a
# polynomial; ellipticF, Gamma, dilog ..: functions FriCAS may define differently) it is not taken
FROM_FRICAS = {
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "cot": sp.cot, "sec": sp.sec, "csc": sp.csc,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan, "acot": sp.acot,
    "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh, "coth": sp.coth, "sech": sp.sech, "csch": sp.csch,
    "asinh": sp.asinh, "acosh": sp.acosh, "atanh": sp.atanh, "exp": sp.exp, "log": sp.log, "sqrt": sp.sqrt,
    "erf": sp.erf, "Ei": sp.Ei, "Si": sp.Si, "Ci": sp.Ci, "li": sp.li,
}
CONSTANTS_FROM = {"pi": sp.pi}


def from_fricas(text, names):
    """FriCAS's answer (InputForm: one line, + - * / ^ and function calls, pi as pi()) as a
    SymPy expression, read as Giac's answers are; Refused for a list of answers (one for each
    sign of a letter), an integral left undone, a name not listed above .."""
    return from_giac(text.replace("pi()", "pi"), names, functions=FROM_FRICAS, constants=CONSTANTS_FROM)


# ---------------------------------------------------------------------------
# what opensw_compute.py asks
# ---------------------------------------------------------------------------

def integral(f, x):
    """An antiderivative of f in x by FriCAS; None: not by FriCAS. Checked by differentiating:
    FriCAS takes roots and logarithms as algebra does, and an answer is taken only when its
    derivative is f for the roots and logarithms SymPy computes with. The shared
    opensw_giac.same_derivative uses numerical checking and additionally requires a symbolic
    proof for roots of repeated factors, Abs and sign; it does not detect hidden squares."""
    if WORKER.off:
        return None
    try:
        names = Names()
        text = WORKER.ask("integrate(%s::Expression(Integer),%s)" % (to_fricas(f, names), names.name(x)))
        if text is None:
            return None
        r = from_fricas(text, names)
        return r if same_derivative(r, f, x) else None
    except Refused:
        return None
    except Exception:  # an answer SymPy cannot work with: as no answer
        return None


def no_antiderivative(f, x):
    """True when FriCAS answers f's integral in x with that integral left undone, as a whole: its
    integrator (the Risch algorithm) has then found that f has no antiderivative it can write
    (elementary functions, and erf, Ei, li ..). False otherwise: an answer, part of one, no
    answer in time, a formula not sent, or no FriCAS."""
    if WORKER.off:
        return False
    try:
        names = Names()
        text = WORKER.ask("integrate(%s::Expression(Integer),%s)" % (to_fricas(f, names), names.name(x)))
    except Refused:
        return False
    if not text or not text.startswith("integral("):
        return False
    depth = 0
    for i in range(len("integral"), len(text)):  # the "(" of integral( must close at the very end
        depth += (text[i] == "(") - (text[i] == ")")
        if depth == 0:
            return i == len(text) - 1
    return False


def integrals(e):
    """e with the indefinite integrals in it worked out where FriCAS can; the others, and
    everything else, are left for SymPy's doit(). An integral of an integral only when both are."""
    if WORKER.off or not e.has(sp.Integral):
        return e
    if type(e) is sp.Integral and all(len(limit) == 1 for limit in e.limits):  # not opensw_compute's integrals that are kept as written
        f = integrals(e.function)
        for limit in () if f.has(sp.Integral) else e.limits:
            f = integral(f, limit[0])
            if f is None:
                return e
        return e if f.has(sp.Integral) else f
    if isinstance(e, sp.Integral):
        return e
    args = [integrals(x) for x in e.args]
    return e.func(*args) if any(x is not y for x, y in zip(args, e.args)) else e
