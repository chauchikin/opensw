"""Computation engine of opensw (runs in Pyodide, i.e. Python inside the editor).

The editor parses a formula with the CortexJS Compute Engine into MathJSON
(nested lists such as ["Add", ["Power", "x", 2], 1]) and calls
``compute(op, mathjson_text)``.  This module turns MathJSON into SymPy objects
(no eval of strings) and performs one of the operations of Scientific Word 5.5's
Compute menu.  The answer is LaTeX, shown after the formula.
"""

import json
import re

import sympy as sp
from sympy.printing.latex import LatexPrinter

try:  # Giac as a faster first try for integrals, series and determinants (see opensw_giac.py)
    import opensw_giac
except ImportError:  # Pyodide is given this file alone
    opensw_giac = None
try:  # FriCAS for the indefinite integrals Giac does not find, before SymPy (see opensw_fricas.py)
    import opensw_fricas
except ImportError:
    opensw_fricas = None


def integrate(f, x):
    """sp.integrate(f, x), asking Giac first, then FriCAS."""
    r = opensw_giac.integral(f, (x,)) if opensw_giac else None
    if r is None and opensw_fricas:
        r = opensw_fricas.integral(f, x)
    return sp.integrate(f, x) if r is None else r


def det(m):
    """m.det(), asking Giac first."""
    r = opensw_giac.det(m) if opensw_giac else None
    return m.det() if r is None else r

# ---------------------------------------------------------------------------
# MathJSON -> SymPy
# ---------------------------------------------------------------------------

CONSTANTS = {
    "Pi": sp.pi,
    "ExponentialE": sp.E,
    "ImaginaryUnit": sp.I,
    "PositiveInfinity": sp.oo,
    "NegativeInfinity": -sp.oo,
    "ComplexInfinity": sp.zoo,
    "NaN": sp.nan,
    "True": sp.true,
    "False": sp.false,
    "Nothing": None,
    "EmptySet": sp.EmptySet,
}

# heads that map directly to a SymPy function of the same arguments
FUNCTIONS = {
    "Sqrt": sp.sqrt, "Exp": sp.exp, "Ln": sp.log, "Abs": sp.Abs,
    "Sin": sp.sin, "Cos": sp.cos, "Tan": sp.tan, "Cot": sp.cot, "Sec": sp.sec, "Csc": sp.csc,
    "Arcsin": sp.asin, "Arccos": sp.acos, "Arctan": sp.atan, "Arccot": sp.acot,
    "Sinh": sp.sinh, "Cosh": sp.cosh, "Tanh": sp.tanh, "Coth": sp.coth,
    "Arsinh": sp.asinh, "Arcosh": sp.acosh, "Artanh": sp.atanh,
    "Floor": sp.floor, "Ceil": sp.ceiling, "Factorial": sp.factorial,
    "Binomial": sp.binomial, "Max": sp.Max, "Min": sp.Min, "Sign": sp.sign,
    "Gamma": sp.gamma, "Erf": sp.erf, "Real": sp.re, "Imaginary": sp.im,
    "Conjugate": sp.conjugate, "GCD": sp.gcd, "LCM": sp.lcm,
    # more of the functions 5.5 knows (sec^-1, arccoth, arg, J_n(x) ...)
    "Sech": sp.sech, "Csch": sp.csch, "Arcsec": lambda x: sp.acos(1 / x), "Arccsc": lambda x: sp.asin(1 / x),
    "Arcoth": sp.acoth, "Arsech": sp.asech, "Arcsch": sp.acsch, "Argument": sp.arg,
    "Re": sp.re, "Im": sp.im, "Erfc": sp.erfc, "Zeta": sp.zeta, "Ei": sp.Ei, "Si": sp.Si, "Ci": sp.Ci,
    "BesselJ": sp.besselj, "BesselY": sp.bessely, "BesselI": sp.besseli, "BesselK": sp.besselk,
    "Dirac": sp.DiracDelta, "Heaviside": sp.Heaviside,
    # MuPAD's AiryAi(z, n): n = 1 is the derivative
    "AiryAi": lambda z, n=0: sp.airyaiprime(z) if n == 1 else sp.airyai(z),
    "AiryBi": lambda z, n=0: sp.airybiprime(z) if n == 1 else sp.airybi(z),
}

RELATIONS = {
    "Equal": sp.Eq, "NotEqual": sp.Ne, "Less": sp.Lt, "LessEqual": sp.Le,
    "Greater": sp.Gt, "GreaterEqual": sp.Ge,
}


class Unsupported(Exception):
    """A part of the formula this engine cannot compute with."""


# Assumptions about variables (5.5's assume, additionally, unassume, about). Variables are
# complex unless assumed otherwise, as in 5.5: assume(real) makes all of them real,
# assume(x, positive) one of them. name -> SymPy assumptions; "" is every variable.
ASSUMED = {}
# x < 10, x \neq 0, Re(z) > 0: name -> (the real numbers allowed for x or Re z, those for Im z or None)
RANGES = {}
PROPERTIES = {"real": "real", "positive": "positive", "negative": "negative", "integer": "integer", "nonzero": "nonzero", "complex": None}
FLIPPED = {"Less": "Greater", "LessEqual": "GreaterEqual", "Greater": "Less", "GreaterEqual": "LessEqual", "NotEqual": "NotEqual"}


class Unassumed:
    """These names without their own assumptions for a while: the variable of a definite integral, or
    of a function being defined, is its own (not the x assumed nonzero)."""

    def __init__(self, names):
        self.names = names

    def __enter__(self):
        self.saved = {n: ASSUMED.pop(n) for n in self.names if n in ASSUMED}

    def __exit__(self, *exc):
        ASSUMED.update(self.saved)


def variable(name):
    return sp.Symbol(name, **ASSUMED.get(name, ASSUMED.get("", {})))


def domain_of(e):
    """What is known of e, as a set as 5.5 writes it: Z \\cap (0, \\infty), \\mathbb{R}, Z \\cap [0, \\infty)."""
    parts = ["\\mathbb{Z}"] if e.is_integer else []
    if e.is_positive:
        parts.append("\\left(0,\\infty\\right)")
    elif e.is_negative:
        parts.append("\\left(-\\infty,0\\right)")
    elif e.is_nonnegative:
        parts.append("\\left[0,\\infty\\right)")
    elif e.is_nonpositive:
        parts.append("\\left(-\\infty,0\\right]")
    elif not parts:
        parts.append("\\mathbb{R}" if e.is_real else "\\mathbb{C}")
        if e.is_zero is False:
            parts[-1] += "\\setminus\\left\\{0\\right\\}"
    return "\\cap ".join(parts)


def set_tex(s):
    """The real numbers allowed: \\mathbb{R}, \\mathbb{R} \\setminus \\{0\\}, an interval."""
    if s == sp.S.Reals:
        return "\\mathbb{R}"
    holes = sp.S.Reals - s
    return "\\mathbb{R}\\setminus " + tex(holes) if isinstance(holes, sp.FiniteSet) else tex(s)


def range_tex(name):
    re_, im_ = RANGES[name]
    if im_ is not None:  # Re(z) > 0: (0, infinity) + iR
        return set_tex(re_) + "+i" + set_tex(im_)
    return ("\\mathbb{Z}\\cap " if ASSUMED.get(name, {}).get("integer") else "") + set_tex(re_)


def relation(r):
    """x < 10, x \\neq 0, Re(z) > 0 (MathJSON) -> (name, "re", "im" or None, the real numbers allowed), or None."""
    if not (isinstance(r, list) and len(r) == 3 and r[0] in FLIPPED):
        return None
    for side, other, head in ((r[1], r[2], r[0]), (r[2], r[1], FLIPPED[r[0]])):
        part = None
        if isinstance(side, list) and len(side) == 2 and side[0] in ("Re", "Real", "Im", "Imaginary") and isinstance(side[1], str):
            part, side = ("re" if side[0] in ("Re", "Real") else "im"), side[1]
        if isinstance(side, str) and side not in CONSTANTS and side not in PROPERTIES:
            c = build(other)
            if not (c.is_number and c.is_extended_real):
                return None
            t = sp.Symbol("t", real=True)
            allowed = sp.S.Reals - sp.FiniteSet(c) if head == "NotEqual" else sp.solveset(RELATIONS[head](t, c), t, sp.S.Reals)
            return side, part, allowed
    return None


def assume_range(head, name, part, allowed):
    """assume(x < 10), additionally(x \\neq 0), assume(Re(z) > 0): kept as sets (for about) and,
    as far as SymPy can, as assumptions (x \\neq 0: nonzero; x > 0: positive)."""
    kw = ASSUMED.get(name, ASSUMED.get("", {})) if head == "additionally" else {}
    old = RANGES.get(name) if head == "additionally" else None
    if old is None:  # what assume(x, positive) .. allowed so far
        old = (sp.Interval.open(0, sp.oo) if kw.get("positive") else sp.Interval.open(-sp.oo, 0) if kw.get("negative")
               else sp.S.Reals - sp.FiniteSet(0) if kw.get("nonzero") else sp.S.Reals, None if kw.get("real") else sp.S.Reals)
    re_, im_ = old
    if part is None:
        re_, im_ = re_ & allowed, None  # x < 10: x is real
    elif part == "re":
        re_, im_ = re_ & allowed, sp.S.Reals if im_ is None else im_
    else:
        im_ = (sp.S.Reals if im_ is None else im_) & allowed
    if re_ is sp.S.EmptySet or im_ is sp.S.EmptySet:
        raise Unsupported("These assumptions contradict each other")
    new = {"integer": True} if kw.get("integer") and im_ is None else {}
    if im_ is None:
        new["real"] = True
        for prop, part_set in (("positive", sp.Interval.open(0, sp.oo)), ("negative", sp.Interval.open(-sp.oo, 0)),
                               ("nonnegative", sp.Interval(0, sp.oo)), ("nonpositive", sp.Interval(-sp.oo, 0))):
            if re_.is_subset(part_set):
                new[prop] = True
                break
        if not re_.contains(0):
            new["nonzero"] = True
    ASSUMED[name] = new
    RANGES[name] = (re_, im_)
    return range_tex(name)


def assume(j):
    """["assume", "Real"], ["assume", "x", "positive"], ["additionally", "n", "integer"],
    ["additionally", ["Less", "x", 10]], ["unassume", "x"], ["about", "n"] -> the LaTeX 5.5 answers with."""
    head, args = j[0], [a.lower() if isinstance(a, str) and a.lower() in PROPERTIES else a for a in j[1:]]
    if not all(isinstance(a, str) for a in args):
        if head == "about" and len(args) == 1:  # about(n^2): what follows from the assumptions
            return domain_of(build(args[0]))
        found = relation(args[0]) if len(args) == 1 and head in ("assume", "additionally") else None
        if not found:
            raise Unsupported("Write an assumption as assume(x, positive), assume(x < 3) or assume(Re(z) > 0)")
        return assume_range(head, *found)
    names = [a for a in args if isinstance(a, str) and a not in PROPERTIES]
    props = [a for a in args if a in PROPERTIES]
    if len(args) != len(names) + len(props) or len(names) > 1 or (head != "about" and len(props) > 1):
        raise Unsupported("Write assume(real) or assume(x, positive); allowed: real, complex, integer, positive, negative, nonzero")
    key = names[0] if names else ""
    if head == "about":
        if key in RANGES:
            return range_tex(key)
        if not key:  # no assumption about all variables: 5.5 says Global
            return domain_of(variable("t")) if "" in ASSUMED else "\\operatorname{Global}"
        return tex(variable(key)) if key not in ASSUMED and "" not in ASSUMED else domain_of(variable(key))
    if head == "unassume":
        ASSUMED.pop(key, None)
        RANGES.pop(key, None)
        return tex(variable(key)) if key else "\\operatorname{complex}"
    if not props:
        raise Unsupported("Give an assumption: real, complex, integer, positive, negative or nonzero")
    prop = PROPERTIES[props[0]]
    kw = dict(ASSUMED.get(key, ASSUMED.get("", {}))) if head == "additionally" else {}
    if prop:
        kw[prop] = True
    try:
        sp.Symbol("t", **kw)
    except Exception:
        raise Unsupported("These assumptions contradict each other")
    if head == "assume":
        RANGES.pop(key, None)
    if kw or key:
        ASSUMED[key] = kw
    else:
        ASSUMED.pop("", None)  # assume(complex): back to the default
    if key in RANGES:  # additionally(n, integer) after n < 10
        return range_tex(key)
    return domain_of(variable(key or "t"))


def build(j):
    """MathJSON -> SymPy object."""
    if isinstance(j, bool):
        return sp.true if j else sp.false
    if isinstance(j, int):
        return sp.Integer(j)
    if isinstance(j, float):
        return sp.Float(j)
    if isinstance(j, dict):  # {"num": "1.25"} or {"sym": "x"} or {"str": "..."}
        if "num" in j:  # a decimal is a floating-point number (8.0 too), as in 5.5
            n = j["num"]
            return sp.Float(n, max(15, len(re.sub(r"\D", "", n)))) if "." in n or "e" in n else sp.Integer(n)
        if "sym" in j:
            return build(j["sym"])
        raise Unsupported("Text")
    if isinstance(j, str):
        if j in CONSTANTS:
            return CONSTANTS[j]
        if j.startswith("'"):
            raise Unsupported("Text")
        if j.startswith("unit_"):  # \mathrm{ft}: a unit (compute.js names the units 5.5 knows)
            return unit(j[5:])
        if j in DEFINITIONS and isinstance(DEFINITIONS[j][1], sp.MatrixBase) and j not in PARAMS:
            return a_matrix(DEFINITIONS[j][1], MATRIX_DELIMS.get(j))  # a matrix defined earlier: matrix arithmetic needs it now
        if j not in NAMES:
            NAMES.append(j)
        return variable(j)
    head, args = j[0], j[1:]
    if not isinstance(head, str):
        raise Unsupported(str(head))
    if head == "Error":
        raise Unsupported("The formula has notation that is not understood")
    if head == "Prime" and isinstance(args[0], str) and args[0] not in DEFINITIONS and (len(args) == 1 or isinstance(args[1], int)):
        return build(args[0] + "'" * (args[1] if len(args) > 1 else 1))  # y' an unknown of its own (Solve for y', as 5.5)
    a = lambda i: build(args[i])  # noqa: E731
    if head == "Add":
        return add([build(x) for x in args])
    if head == "Multiply":
        factors = [build(x) for x in args]
        # L(s, t, x): a function the parser does not know, not a name times a vector
        if any(x[:1] == ["Tuple"] for x in args if isinstance(x, list)) and any(not is_matrix(f) and f.free_symbols for f in factors):
            raise Unsupported("A name before a list in parentheses: a function this engine does not know")
        return multiply(factors)
    if head == "Subtract":
        return add([a(0), -a(1)]) if len(args) == 2 else -a(0)
    if head == "Negate":
        return -a(0)
    if head == "Divide":
        return a(0) / a(1)
    if head == "Rational":
        return sp.Rational(a(0), a(1))
    if head in ("Power", "MatrixPower"):
        return power(a(0), args[1])
    if head == "Square":
        return a(0) ** 2
    if head == "Root":
        return sp.root(a(0), a(1))
    if head == "Log":
        return sp.log(a(0), a(1)) if len(args) > 1 else sp.log(a(0), 10)
    if head == "Log10":  # \log with the log base set to 10 (compute.js): shown as \log_{10}, as 5.5 then
        STYLE["log10"] = True
        return sp.log(a(0), 10)
    if head == "Lb":
        return sp.log(a(0), 2)
    if head == "Complex":
        return a(0) + sp.I * a(1)
    if head in ("Max", "Min") and len(args) == 1 and isinstance(args[0], list) and args[0][:2] == ["Tuple", "_"]:
        return extreme_over(head, args[0][2], args[0][3])  # max over n = 1..10 of sin n
    if head in ("Max", "Min") and len(args) == 1:  # the largest entry of a matrix or list
        m = a(0)
        if isinstance(m, (list, sp.MatrixBase)):
            return (sp.Max if head == "Max" else sp.Min)(*numbers(m))
    if head in FUNCTIONS:
        xs = [build(x) for x in args]
        if head in ("Dirac", "Heaviside") and xs[0].is_number and xs[0].is_extended_real is False:
            return sp.nan  # Dirac(i): undefined, as 5.5
        if head in ("GCD", "LCM"):  # of defined polynomials: put them in first (SymPy would answer 1 at once)
            xs = [apply_definitions(x) for x in xs]
        if head in MATRIX_FUNCTIONS and len(xs) == 1 and is_matrix(xs[0]):
            return MATRIX_FUNCTIONS[head](xs[0])
        return FUNCTIONS[head](*xs)
    if head.endswith(("Dist", "Den", "Inv")) and head[:-4 if head.endswith("Dist") else -3] in DISTRIBUTIONS:
        return distribution(head, [build(y) for x in args for y in (x[1:] if isinstance(x, list) and x[:1] == ["Tuple"] else [x])])
    if head in TRANSFORM_VARIABLES:  # \mathcal{L}(f), \mathcal{F}^{-1}(F, w, x) ...
        # the variable integrated over is its own: not the x assumed positive (Dirac(x) is not 0 then)
        with Unassumed([args[1] if len(args) >= 3 and isinstance(args[1], str) else TRANSFORM_VARIABLES[head][0]]):
            f = a(0)
            names = [build(x) for x in args[1:3]] if len(args) >= 3 else [variable(v) for v in TRANSFORM_VARIABLES[head]]
        f = (f[0] if len(f) == 1 and isinstance(f[0], sp.MatrixBase) else sp.Matrix(f)) if isinstance(f, list) else f
        return Transform(f, *names, sp.Integer(list(TRANSFORM_VARIABLES).index(head)))
    if head == "Modulo":  # a mod n (written in compute.js from 5.5's \func{mod})
        x = a(0)
        if isinstance(x, list):  # a matrix in brackets
            x = x[0] if len(x) == 1 and isinstance(x[0], sp.MatrixBase) else sp.Matrix(x)
        return Modulo(x, a(1))
    if head == "Element":  # x \in (a, b)
        return sp.Contains(a(0), a(1), evaluate=False)
    if head == "Interval":
        ends = [x[1] if isinstance(x, list) and x[:1] == ["Open"] else x for x in args]
        return sp.Interval(build(ends[0]), build(ends[1]), *[isinstance(x, list) and x[:1] == ["Open"] for x in args])
    if head == "Subscript" and isinstance(args[0], str) and build(args[1]).free_symbols:  # a_k in a sum
        return sp.IndexedBase(args[0])[a(1)]
    if head in ("OverHat", "OverTilde") and isinstance(args[0], str):  # \hat{Z}: a name
        return sp.Symbol(args[0] + {"OverHat": "hat", "OverTilde": "tilde"}[head])
    if head == "Subscript" and isinstance(args[0], list) and args[0][0] in ("OverHat", "OverTilde") and isinstance(args[0][1], str) \
            and isinstance(args[1], (int, str)):  # \hat{t}_{3}: a name (5.5's parameters)
        return sp.Symbol("%s%s_%s" % (args[0][1], {"OverHat": "hat", "OverTilde": "tilde"}[args[0][0]], args[1]))
    if head == "Seq":  # \func{seq}_{n=1..4}(f): f at n = 1, 2, 3, 4
        f, v = a(0), variable(args[1])
        lo, hi = a(2), a(3)
        if not (lo.is_Integer and hi.is_Integer) or hi - lo > 10000:
            raise Unsupported("Needs whole numbers n=a..b")
        return Listed(*[f.subs(v, k) for k in range(int(lo), int(hi) + 1)])
    if head == "Degrees":
        return a(0) * sp.pi / 180
    if head in ("Union", "Intersection", "SetMinus"):
        return set_operation(head, [build(x) for x in args])
    if head in RELATIONS:
        if len(args) > 2 and head != "Equal":  # 0 < x < 1
            return sp.And(*[RELATIONS[head](build(p), build(q)) for p, q in zip(args, args[1:])])
        lhs, rhs = a(0), a(1)
        if head == "Equal" and (is_matrix(lhs) or is_matrix(rhs)):
            return sp.Eq(lhs, rhs, evaluate=False)  # a matrix equation (or a matrix defined: A = ..)
        return RELATIONS[head](lhs, rhs)
    if head in ("And", "Or"):
        return (sp.And if head == "And" else sp.Or)(*[build(x) for x in args])
    if head == "Not":
        return sp.Not(a(0))
    if head == "Mod":
        return sp.Mod(a(0), a(1))
    if head == "Set":
        rows = piecewise_rows(args)
        if rows:  # \left\{ \begin{array} value & if & condition \\ ... \end{array}\right.
            return sp.Piecewise(*rows)
        return sp.FiniteSet(*[build(x) for x in args])
    if head in ("Delimiter", "Hold", "Parentheses"):
        items = [build(x) for x in args if x != "Nothing"]
        return items[0] if len(items) == 1 else sp.Tuple(*items)
    if head == "Block":
        return a(-1)
    if head in ("List", "Tuple"):
        items = [build(x) for x in args]
        if items and all(isinstance(x, sp.Expr) for x in items):
            return a_matrix([items], "list")  # a list of numbers is a vector
        if head == "Tuple":
            raise Unsupported(head)  # (as any head it does not know)
        return items
    if head == "Matrix":
        rows = [[build(x) for x in r[1:]] if isinstance(r, list) and r[:1] == ["List"] else [build(r)] for r in args[0][1:]]
        if any(isinstance(x, sp.core.relational.Relational) for r in rows for x in r):
            return [x for r in rows for x in r]  # a system of equations
        return a_matrix(rows, "[" if args[1:2] == ["'[]'"] else "(")
    if head == "Determinant":
        return det(sp.Matrix(a(0)))
    if head == "Transpose":
        return sp.ImmutableMatrix(a(0)).T
    if head == "Inverse":
        return sp.ImmutableMatrix(a(0)).inv()
    if head in ("ConjugateTranspose", "Superstar"):  # z^*: the complex conjugate; A^*: the conjugate transpose
        return a(0).H if isinstance(a(0), sp.MatrixBase) else sp.conjugate(a(0))
    if head == "Dot":
        return dot(a(0), a(1))
    if head == "Cross":
        return cross(a(0), a(1))
    if head == "Norm":
        return norm(a(0), args[1] if len(args) > 1 else None)
    if head in NABLA:  # 5.5's ∇f, ∇·F, ∇×F, ∇^2 f, in the basis variables (x, y, z unless given after f)
        STYLE["product"] = True
        r = vector_op(NABLA[head], apply_definitions(a(0)), [variable(v) for v in (args[1:] or "xyz")])
        return sp.ImmutableMatrix(r) if is_matrix(r) else r
    if head in ("Subscript", "At") and is_matrix(m := a(0)):  # A_{i,j}: an entry of a matrix
        ij = [build(x) for x in (args[1][1:] if len(args) == 2 and isinstance(args[1], list) and args[1][0] in ("Sequence", "Delimiter", "Tuple") else args[1:])]
        if len(ij) == 1 and is_vector(m):
            ij = [1, ij[0]] if m.rows == 1 else [ij[0], 1]
        if len(ij) != 2 or not all(k.is_integer and 1 <= k <= n for k, n in zip(ij, m.shape)):
            raise Unsupported("No such entry of the matrix")
        return m[ij[0] - 1, ij[1] - 1]
    if head in ("Integrate", "Sum", "Product"):
        # the variable of a definite integral runs over the range: not the x assumed nonzero or positive
        bound = [x[1] for x in args[1:] if head == "Integrate" and isinstance(x, list) and x[:1] == ["Limits"]
                 and isinstance(x[1], str) and any(b != "Nothing" for b in x[2:])]
        with Unassumed(bound):
            body, var = function_body(args[0])
            lims = [limits(x) for x in args[1:]] or ([(var,)] if var is not None else [])
        if not any(lims) and head == "Integrate":  # \int ax^3 without dx: in the last variable, as 5.5
            free = sorted(body.free_symbols, key=str)
            lims = [(free[-1],)] if free else []
        fn = {"Integrate": sp.Integral, "Sum": sp.Sum, "Product": sp.Product}[head]
        return fn(body, *[l if len(l) > 1 else l[0] for l in lims])
    if head == "Limit":  # x -> a^+, a^- (a third argument 1, -1), or from both sides
        body, var = function_body(args[0])
        side = {1: "+", -1: "-"}.get(args[2] if len(args) > 2 else None)
        point = a(1)
        if side or point.is_infinite:
            return sp.Limit(body, var, point, side or "+")
        return BothSidesLimit(body, var, point, "+-")
    if head == "D":
        f = a(0)
        if is_matrix(f):
            return f.diff(*[build(x) for x in args[1:]])
        return sp.Derivative(f, *[build(x) for x in args[1:]])
    if head == "EvaluateAt":  # f|_{x=a}, or f|_a^b = f(b) - f(a); f|_{x=1,y=2}
        body, var = function_body(args[0])
        names = [variable(v) for v in args[0][2:]] if isinstance(args[0], list) and args[0][:1] == ["Function"] else [var]

        def at(j):
            v = [build(x) for x in j[1:]] if isinstance(j, list) and j[:1] == ["Tuple"] else build(j)
            v = v.rhs if isinstance(v, sp.Equality) else v  # the x= of _{x=a}^{x=b}
            vals = list(v) if isinstance(v, (sp.Tuple, list)) else [v]
            return apply_definitions(body).doit().subs(list(zip(names, vals)), simultaneous=True)
        return at(args[1]) if len(args) == 2 else at(args[2]) - at(args[1])
    if head in MUPAD_COMMANDS:  # \func{factor}(n), \func{float}(x): MuPAD commands 5.5 passed on
        return MUPAD_COMMANDS[head](*[build(x) for x in args])
    # an unknown head with arguments: a function written by the user, e.g. f(x), W(x), \Psi(y)
    if head in ("row", "col") and len(args) == 2 and is_matrix(m := a(0)):  # 5.5's row(A, i), col(A, j)
        k = a(1)
        if not (k.is_integer and 1 <= k <= (m.rows if head == "row" else m.cols)):
            raise Unsupported("No such row or column")
        return m.row(k - 1) if head == "row" else m.col(k - 1)
    if head == "opensw_D":  # D(x): a function named D (compute.js; "D" is the derivative)
        head = "D"
    if user_function_name(head):
        xs = [build(x) for x in args]
        if len(xs) == 1 and isinstance(xs[0], sp.MatrixBase):
            return polynomial_at_matrix(head, xs[0])
        return sp.Function(head)(*xs)
    raise Unsupported(head)


def _beta_cdf(x, a, b):
    return sp.betainc_regularized(a, b, 0, sp.Max(0, sp.Min(1, x)))


# 5.5's distribution functions: name -> (default parameters, density, distribution function,
# inverse or None (found numerically)); the parameters as 5.5 writes them after the ';'
DISTRIBUTIONS = {
    "Normal": ((0, 1), lambda x, m, s: sp.exp(-(x - m) ** 2 / (2 * s ** 2)) / (s * sp.sqrt(2 * sp.pi)),
               lambda x, m, s: (1 + sp.erf((x - m) / (s * sp.sqrt(2)))) / 2,
               lambda p, m, s: m + s * sp.sqrt(2) * sp.erfinv(2 * p - 1)),
    "T": ((), lambda x, n: sp.gamma((n + 1) / 2) / (sp.sqrt(n * sp.pi) * sp.gamma(n / 2)) * (1 + x ** 2 / n) ** (-(n + 1) / 2),
          lambda x, n: 1 - _beta_cdf(n / (n + x ** 2), n / 2, sp.S.Half) / 2 if x >= 0 else _beta_cdf(n / (n + x ** 2), n / 2, sp.S.Half) / 2,
          None),
    "ChiSquare": ((), lambda x, k: sp.Piecewise((x ** (k / 2 - 1) * sp.exp(-x / 2) / (2 ** (k / 2) * sp.gamma(k / 2)), x > 0), (0, True)),
                  lambda x, k: sp.Piecewise((sp.lowergamma(k / 2, x / 2) / sp.gamma(k / 2), x > 0), (0, True)), None),
    "F": ((), lambda x, m, n: sp.Piecewise((sp.sqrt((m * x) ** m * n ** n / (m * x + n) ** (m + n)) / (x * sp.beta(m / 2, n / 2)), x > 0), (0, True)),
          lambda x, m, n: _beta_cdf(m * x / (m * x + n), m / 2, n / 2), None),
    "Exponential": ((), lambda x, m: sp.Piecewise((sp.exp(-x / m) / m, x >= 0), (0, True)),
                    lambda x, m: sp.Piecewise((1 - sp.exp(-x / m), x >= 0), (0, True)),
                    lambda p, m: -m * sp.log(1 - p)),
    "Weibull": ((), lambda x, a, b: sp.Piecewise((a / b * (x / b) ** (a - 1) * sp.exp(-(x / b) ** a), x > 0), (0, True)),
                lambda x, a, b: sp.Piecewise((1 - sp.exp(-(x / b) ** a), x > 0), (0, True)),
                lambda p, a, b: b * (-sp.log(1 - p)) ** (1 / a)),
    "Gamma": ((), lambda x, a, b: sp.Piecewise((x ** (a - 1) * sp.exp(-x / b) / (sp.gamma(a) * b ** a), x > 0), (0, True)),
              lambda x, a, b: sp.Piecewise((sp.lowergamma(a, x / b) / sp.gamma(a), x > 0), (0, True)), None),
    "Beta": ((), lambda x, a, b: sp.Piecewise((x ** (a - 1) * (1 - x) ** (b - 1) / sp.beta(a, b), (x > 0) & (x < 1)), (0, True)),
             _beta_cdf, None),
    "Cauchy": ((), lambda x, a, b: 1 / (sp.pi * b * (1 + ((x - a) / b) ** 2)),
               lambda x, a, b: sp.Rational(1, 2) + sp.atan((x - a) / b) / sp.pi,
               lambda p, a, b: a + b * sp.tan(sp.pi * (p - sp.Rational(1, 2)))),
    "Uniform": ((), lambda x, a, b: sp.Piecewise((1 / (b - a), (x > a) & (x < b)), (0, True)),
                lambda x, a, b: sp.Piecewise((0, x <= a), ((x - a) / (b - a), x < b), (1, True)),
                lambda p, a, b: a + p * (b - a)),
    "Binomial": ((), lambda k, n, p: sp.binomial(n, k) * p ** k * (1 - p) ** (n - k),
                 lambda x, n, p: sp.Add(*[sp.binomial(n, k) * p ** k * (1 - p) ** (n - k) for k in range(0, int(sp.floor(x)) + 1)]), None),
    "Poisson": ((), lambda k, m: sp.exp(-m) * m ** k / sp.factorial(k),
                lambda x, m: sp.Add(*[sp.exp(-m) * m ** k / sp.factorial(k) for k in range(0, int(sp.floor(x)) + 1)]), None),
    "Hypergeom": ((), lambda k, M, K, n: sp.binomial(K, k) * sp.binomial(M - K, n - k) / sp.binomial(M, n),
                  lambda x, M, K, n: sp.Add(*[sp.binomial(K, k) * sp.binomial(M - K, n - k) for k in range(0, int(sp.floor(x)) + 1)]) / sp.binomial(M, n), None),
}


def distribution(head, args):
    """NormalDist(x; mu, sigma), TInv(p; n), PoissonDen(k; mu) ...: a number when all the
    arguments are numbers (as 5.5 gives them), else the formula."""
    kind = "Dist" if head.endswith("Dist") else head[-3:]
    defaults, den, dist, inv = DISTRIBUTIONS[head[:-len(kind)]]
    args = args + [sp.Integer(d) for d in defaults[len(args) - 1:]]  # NormalDist(x) is NormalDist(x; 0, 1)
    numeric = all(x.is_number for x in args)
    if kind == "Den":
        r = den(*args)
    elif kind == "Dist":
        if not numeric and head[:-4] in ("Binomial", "Poisson", "Hypergeom", "T"):
            return sp.Function(head)(*args)
        r = dist(*args)
    elif inv:
        r = inv(*args)
    elif numeric:  # the x with dist(x) = p, by bisection
        p, params = sp.N(args[0], 20), args[1:]
        if not 0 < p < 1:
            raise Unsupported("The probability must be between 0 and 1")
        lo, hi = (-1, 1) if head == "TInv" else (0, 1)
        while sp.N(dist(lo, *params), 20) > p:
            lo *= 2
        while sp.N(dist(hi, *params), 20) < p:
            hi *= 2
        for _ in range(80):
            mid = (sp.Float(lo, 20) + hi) / 2
            lo, hi = (mid, hi) if sp.N(dist(mid, *params), 20) < p else (lo, mid)
        r = (lo + hi) / 2
    else:
        return sp.Function(head)(*args)
    return sp.N(r, 10) if numeric else r


# 5.5's transforms and their variables when not given: from t to s, from x to w ...
TRANSFORM_VARIABLES = {"LaplaceTransform": ("t", "s"), "InverseLaplaceTransform": ("s", "t"),
                       "FourierTransform": ("x", "w"), "InverseFourierTransform": ("w", "x")}


class Transform(sp.Function):
    """A Laplace or Fourier transform as 5.5 (MuPAD) defines them, worked out by doit():
    L f(s) = int_0^oo f(t) e^(-st) dt;  F f(w) = int f(x) e^(iwx) dx;
    F^-1 F(x) = 1/(2 pi) int F(w) e^(-iwx) dw (so F(1) = 2 pi delta(w))."""

    def doit(self, **hints):
        f, x, y, kind = (a.doit(**hints) if hasattr(a, "doit") and not a.is_Symbol else a for a in self.args)
        if isinstance(f, sp.MatrixBase):
            return f.applyfunc(lambda g: Transform(g, x, y, kind).doit(**hints))
        f = apply_definitions(f)
        if kind == 0:
            return sp.laplace_transform(f, x, y, noconds=True)
        if kind == 1:  # for t > 0, as 5.5 shows it: t, not t Heaviside(t)
            return sp.inverse_laplace_transform(f, x, y).subs(sp.Heaviside(y), 1)
        if kind == 2:
            return fourier55(f, x, y)
        z = sp.Dummy("z")
        return sp.expand(fourier55(f, x, z).subs(z, -y) / (2 * sp.pi))

    def _latex(self, printer):
        f, x, y, kind = self.args
        name = [r"\mathcal{L}", r"\mathcal{L}^{-1}", r"\mathcal{F}", r"\mathcal{F}^{-1}"][int(kind)]
        return r"%s\left(%s, %s, %s\right)" % (name, printer._print(f), printer._print(x), printer._print(y))


def fourier55(f, x, w):
    """int f(x) e^(iwx) dx, term by term, with the transforms of 1, e^(ikx), 1/x, Heaviside(x)
    that 5.5 gives (in delta functions)."""
    f = sp.powsimp(sp.expand(f.rewrite(sp.exp) if f.has(sp.sin, sp.cos) else f))
    out = sp.Integer(0)
    for term in sp.Add.make_args(f):
        c, g = term.as_independent(x, as_Add=False)
        if g == 1:
            r = 2 * sp.pi * sp.DiracDelta(w)
        elif g == 1 / x:
            r = sp.I * sp.pi * (2 * sp.Heaviside(w) - 1)
        elif g == sp.Heaviside(x):
            r = sp.pi * sp.DiracDelta(w) + sp.I / w
        elif g.func == sp.exp and sp.expand(g.args[0] / (sp.I * x)).free_symbols.isdisjoint({x}):
            r = 2 * sp.pi * sp.DiracDelta(w + sp.expand(g.args[0] / (sp.I * x)))
        else:
            r = sp.integrate(g * sp.exp(sp.I * w * x), (x, -sp.oo, sp.oo), conds="none")
            if r.has(sp.Integral):
                raise Unsupported("This Fourier transform")
            r = sp.simplify(r)  # e^(-x^2): sqrt(pi) e^(-w^2/4), not in erfc
        out += c * r
    return out


# 5.5's units: name -> (value in SI units, SI base units as "m kg s-2"); prefixed SI units
# (km, mA, GHz, \mu m ...) are made from these
SI_BASE = ("m", "kg", "s", "A", "K", "mol", "cd")
UNITS = {
    "m": ("1", "m"), "kg": ("1", "kg"), "s": ("1", "s"), "A": ("1", "A"), "K": ("1", "K"), "mol": ("1", "mol"),
    "cd": ("1", "cd"), "g": ("0.001", "kg"), "rad": ("1", ""), "sr": ("1", ""),
    "N": ("1", "kg m s-2"), "J": ("1", "kg m2 s-2"), "W": ("1", "kg m2 s-3"), "Pa": ("1", "kg m-1 s-2"),
    "C": ("1", "A s"), "V": ("1", "kg m2 s-3 A-1"), "F": ("1", "kg-1 m-2 s4 A2"), "Ohm": ("1", "kg m2 s-3 A-2"),
    "S": ("1", "kg-1 m-2 s3 A2"), "Wb": ("1", "kg m2 s-2 A-1"), "T": ("1", "kg s-2 A-1"), "H": ("1", "kg m2 s-2 A-2"),
    "Hz": ("1", "s-1"), "Bq": ("1", "s-1"), "Ci": ("3.7e10", "s-1"), "Gy": ("1", "m2 s-2"), "Sv": ("1", "m2 s-2"),
    "lm": ("1", "cd"), "lx": ("1", "cd m-2"), "phot": ("10000", "cd m-2"), "sb": ("10000", "cd m-2"), "G": ("0.0001", "kg s-2 A-1"),
    "min": ("60", "s"), "h": ("3600", "s"), "d": ("86400", "s"), "y": ("31557600", "s"),
    "Angstrom": ("1e-10", "m"), "in": ("0.0254", "m"), "ft": ("0.3048", "m"), "yd": ("0.9144", "m"), "mi": ("1609.344", "m"),
    "nmi": ("1852", "m"), "au": ("149597870700", "m"), "ly": ("9460730472580800", "m"), "pc": ("3.0856775814913673e16", "m"),
    "acre": ("4046.8564224", "m2"), "hectare": ("10000", "m2"),
    "l": ("0.001", "m3"), "L": ("0.001", "m3"), "gal": ("0.003785411784", "m3"), "qt": ("0.000946352946", "m3"), "pint": ("0.000473176473", "m3"),
    "lb": ("0.45359237", "kg"), "oz": ("0.028349523125", "kg"), "slug": ("14.593902937206", "kg"), "ton": ("907.18474", "kg"),
    "u": ("1.66053906660e-27", "kg"), "lbf": ("4.4482216152605", "kg m s-2"), "ozf": ("0.27801385095378", "kg m s-2"),
    "dyn": ("1e-5", "kg m s-2"), "erg": ("1e-7", "kg m2 s-2"), "cal": ("4.1868", "kg m2 s-2"), "kcal": ("4186.8", "kg m2 s-2"),
    "Btu": ("1055.05585262", "kg m2 s-2"), "eV": ("1.602176634e-19", "kg m2 s-2"), "hp": ("745.69987158227", "kg m2 s-3"),
    "bar": ("100000", "kg m-1 s-2"), "atm": ("101325", "kg m-1 s-2"), "torr": ("133.32236842105", "kg m-1 s-2"),
    "mmHg": ("133.322387415", "kg m-1 s-2"), "psi": ("6894.757293168", "kg m-1 s-2"),
}
PREFIXES = {"a": "1e-18", "f": "1e-15", "p": "1e-12", "n": "1e-9", "mu": "1e-6", "m": "1e-3", "c": "1e-2", "d": "1e-1",
            "k": "1e3", "M": "1e6", "G": "1e9", "T": "1e12", "P": "1e15", "E": "1e18"}
PREFIXED = re.compile(r"^(a|f|p|n|mu|m|c|d|k|M|G|T|P|E)(m|s|g|A|K|mol|N|J|W|Pa|C|V|F|S|T|H|Wb|Hz|l|L|eV|bar|rad|Ohm)$")
UNIT_SYMBOLS = set()


def unit(name):
    """The symbol of a unit (shown \\mathrm{ft})."""
    if name not in UNITS and not PREFIXED.match(name):
        raise Unsupported("The unit " + name)
    u = sp.Symbol("unit_" + name, positive=True)
    UNIT_SYMBOLS.add(u)
    return u


def si_value(name):
    """A unit in SI base units: ft -> 0.3048 m."""
    if name in UNITS:
        factor, dims = UNITS[name]
    else:
        p, base = PREFIXED.match(name).groups()
        factor, dims = UNITS[base]
        factor = str(sp.Float(p_value(PREFIXES[p]) * p_value(factor), 15)) if base != "g" else str(sp.Float(p_value(PREFIXES[p]) / 1000, 15))
    v = p_value(factor)
    for d in dims.split():
        b, k = re.match(r"([A-Za-z]+)(-?\d*)$", d).groups()
        v *= unit(b) ** int(k or 1)
    return v


def p_value(text):
    """A unit's factor: exact if it is a whole number, else a decimal (as 5.5 converts)."""
    return sp.Integer(text) if re.match(r"^\d+$", text) else sp.Float(text, 15)


def in_si(e):
    units = getattr(e, "free_symbols", set()) & UNIT_SYMBOLS
    return e.xreplace({u: si_value(u.name[5:]) for u in units if u.name[5:] not in SI_BASE})


class BothSidesLimit(sp.Limit):
    """A limit from both sides: undefined when the sides differ or it oscillates (5.5)."""

    def doit(self, **hints):
        f, x, a = (self.args[0].doit(**hints) if hints.get("deep", True) else self.args[0]), self.args[1], self.args[2]
        if a.is_finite and f.is_rational_function(x):
            # a quotient of polynomials in x: with the common factors cancelled, it is continuous where
            # the bottom is not 0, so the limit is the value there (quick also with many letters)
            num, den = sp.fraction(sp.cancel(f))
            if sp.simplify(den.subs(x, a)) != 0:
                return sp.cancel((num / den).subs(x, a))
        right, left = sp.limit(f, x, a, "+"), sp.limit(f, x, a, "-")
        if right.has(sp.Limit) or left.has(sp.Limit):  # not found: stays a limit
            return self
        if right != left or isinstance(right, sp.AccumBounds) or right == sp.zoo:
            return sp.nan
        return right


class KeptIntegral(sp.Integral):
    """A definite integral 5.5 does not attempt: one with a point inside where it diverges (the
    integrand has a pole there, of order 1 or more). Kept as written, by Evaluate Numerically too."""

    def doit(self, **hints):
        return self

    def _eval_evalf(self, prec):
        return self


def diverges_inside(n):
    """n: a definite integral over [a, b] (numbers) of a function of its variable alone. True when a
    zero of a factor of the denominator in [a, b] is a pole of order 1 or more: (x - c) f(x) does
    not go to 0 there (1/(x - cos x)^2 at x = cos x; not 1/sqrt(x) at 0)."""
    if len(n.limits) != 1 or len(n.limits[0]) != 3:
        return False
    x, a, b = n.limits[0]
    f = n.function
    if f.free_symbols != {x} or not (a.is_real and b.is_real and a.is_finite and b.is_finite):
        return False
    a, b = sorted((float(a), float(b)))
    den = sp.fraction(sp.together(f))[1]
    try:
        fn = sp.lambdify(x, f, "mpmath")
    except Exception:  # dx/dt in it ..: not a function of x alone
        return False

    def at(g, t):
        try:
            v = complex(g(t))
            return v.real if abs(v.imag) < 1e-12 else None
        except (ValueError, ZeroDivisionError, OverflowError, TypeError):
            return None
    for base in {p.as_base_exp()[0] for p in sp.Mul.make_args(den) if p.has(x)}:
        g = sp.lambdify(x, base, "mpmath")
        ts = [a + (b - a) * k / 400 for k in range(401)]
        vs = [at(g, t) for t in ts]
        roots = [t for t, v in zip(ts, vs) if v == 0]
        for t0, t1, v0, v1 in zip(ts, ts[1:], vs, vs[1:]):
            if v0 is None or v1 is None or v0 * v1 >= 0:
                continue
            for _ in range(60):  # bisection
                m = (t0 + t1) / 2
                vm = at(g, m)
                if vm is None:
                    break
                t0, t1, v0 = (m, t1, vm) if vm * v0 > 0 else (t0, m, v0)
            roots.append((t0 + t1) / 2)
        for c in roots:
            for s in (1, -1):
                if not a <= c + s * 1e-4 <= b:
                    continue
                near = [at(fn, c + s * h) for h in (1e-4, 1e-6)]
                if None not in near and abs(near[1]) * 1e-6 >= 0.5 * abs(near[0]) * 1e-4 > 0:
                    return True
    return False


def kept_divergent(e):
    """The definite integrals that diverge inside: kept (5.5), unless SymPy finds them infinite or
    undefined too (a finite value would be wrong; a number by quadrature too)."""
    return e.replace(lambda n: isinstance(n, sp.Integral) and not isinstance(n, KeptIntegral) and diverges_inside(n)
                     and n.doit() not in (sp.oo, -sp.oo, sp.zoo, sp.nan), lambda n: KeptIntegral(*n.args))


def piecewise_rows(args):
    """The rows (value, condition) of a function defined by cases, or None."""
    if len(args) != 1 or not isinstance(args[0], list) or args[0][:1] != ["Matrix"]:
        return None
    rows = args[0][1][1:] if isinstance(args[0][1], list) and args[0][1][:1] == ["List"] else []
    out = []
    for r in rows:
        r = r[1:] if isinstance(r, list) and r[:1] == ["List"] else []
        if len(r) == 3 and r[1] == "'if'":
            out.append((build(r[0]), build(r[2])))
        elif len(r) == 2 and r[1] in ("'otherwise'", "'else'"):
            out.append((build(r[0]), True))
        else:
            return None
    return out or None


class Modulo(sp.Function):
    """a mod m as 5.5 (MuPAD) computes it: of integers and fractions (1/5 mod 7 = 3, the inverse
    of 5), of the coefficients of a polynomial, of each entry of a matrix; mod a polynomial,
    the remainder. Worked out by doit(), so Factor can still see the modulus."""

    def doit(self, **hints):
        a, m = (x.doit(**hints) if hasattr(x, "doit") else x for x in self.args)
        return modulo(a, m)

    def _latex(self, printer):
        return r"\left(%s \bmod %s\right)" % (printer._print(self.args[0]), printer._print(self.args[1]))


def modulo(a, m):
    if isinstance(a, sp.MatrixBase):
        return a.applyfunc(lambda x: modulo(x, m))
    if m.is_Integer and m > 0:
        if a.is_Rational:
            p, q = sp.fraction(a)
            return sp.Integer(int(p) * pow(int(q), -1, int(m)) % int(m))
        gens = sorted(a.free_symbols, key=str)
        if gens and sp.expand(a).is_polynomial(*gens):
            poly = sp.Poly(sp.expand(a), *gens)
            return sp.Add(*[modulo(c, m) * sp.Mul(*[g ** k for g, k in zip(gens, mon)]) for mon, c in poly.terms()])
        return sp.Mod(a, m)
    var = sorted(m.free_symbols, key=str)
    if var:
        return sp.expand(sp.rem(sp.expand(a), sp.expand(m), var[0]))
    return sp.Mod(a, m)


def set_operation(head, sets):
    """Union, intersection and difference of sets; of listed elements as 5.5 does them, each
    name a different element ({1, 2} \\cap {a, b} is empty)."""
    def listed(x):
        return list(x.args) if isinstance(x, sp.FiniteSet) else [] if x == sp.EmptySet else None
    items = [listed(x) for x in sets]
    if any(i is None for i in items):  # intervals: SymPy's own
        return {"Union": sp.Union, "Intersection": sp.Intersection, "SetMinus": sp.Complement}[head](*sets)
    out = items[0]
    for other in items[1:]:
        if head == "Union":
            out = out + [x for x in other if x not in out]
        elif head == "Intersection":
            out = [x for x in out if x in other]
        else:
            out = [x for x in out if x not in other]
    return sp.FiniteSet(*out) if out else sp.EmptySet


def extreme_over(head, cond, body):
    """\\max_{1\\leq n\\leq 10} f(n), \\min_{k\\in [1,10]} f(k): over the integers in the range, as
    5.5 does; the term itself (\\sin 8), not its value."""
    if isinstance(cond, list) and cond[0] == "Element" and isinstance(cond[2], list) and cond[2][0] == "Interval":
        var, (lo, hi) = cond[1], [build(x[1] if isinstance(x, list) and x[0] == "Open" else x) for x in cond[2][1:3]]
        open_lo = isinstance(cond[2][1], list) and cond[2][1][0] == "Open"
        open_hi = isinstance(cond[2][2], list) and cond[2][2][0] == "Open"
    elif isinstance(cond, list) and cond[0] in ("LessEqual", "Less") and len(cond) == 4:
        lo, var, hi = build(cond[1]), cond[2], build(cond[3])
        open_lo = open_hi = cond[0] == "Less"
    else:
        raise Unsupported("Write the range as 1 \\leq n \\leq 10 or n \\in [1, 10]")
    v, f = variable(var), build(body)
    start = sp.floor(lo) + 1 if open_lo or not lo.is_integer else lo
    stop = sp.ceiling(hi) - 1 if open_hi or not hi.is_integer else hi
    if not (start.is_Integer and stop.is_Integer) or stop - start > 10000:
        raise Unsupported("Needs a range of at most 10000 integers")
    terms = [f.subs(v, k) for k in range(int(start), int(stop) + 1)]
    if not terms:
        raise Unsupported("The range has no integers")
    return (max if head == "Max" else min)(terms, key=lambda t: float(sp.N(t)))


def as_matrix(m):
    return m[0] if isinstance(m, list) and len(m) == 1 and isinstance(m[0], sp.MatrixBase) else sp.Matrix(m)


class Listed(sp.Function):
    """Values shown one after another, a, b, c (5.5's seq)."""

    def doit(self, **hints):
        return Listed(*[x.doit(**hints) for x in self.args])

    def _eval_evalf(self, prec):
        from mpmath.libmp import prec_to_dps  # prec is in bits
        return Listed(*[x.evalf(prec_to_dps(prec)) for x in self.args], evaluate=False)

    def _latex(self, printer):
        return ", ".join(printer._print(x) for x in self.args)


class Shown(sp.Function):
    """An answer kept as it is (Evaluate would multiply out a factored number or simplify
    an expanded polynomial again)."""

    def doit(self, **hints):
        return self

    def _eval_simplify(self, **kwargs):
        return self

    def _latex(self, printer):
        return printer._print(self.args[0])


class Bracketed(sp.Function):
    """A MuPAD list as 5.5 shows it: [1, 2, 3]."""

    def doit(self, **hints):
        return self

    def _latex(self, printer):
        return "\\left[%s\\right]" % ",".join(printer._print(x) for x in self.args)


class ContinuedFraction(sp.Function):
    """3 + 1/(7 + 1/(15 + ..)): the terms, and 1 at the end when the fraction goes on (MuPAD's contfrac)."""

    def doit(self, **hints):
        return self

    def _latex(self, printer):
        *terms, more = self.args
        out = printer._print(terms[-1]) + ("+.." if more else "")
        for t in reversed(terms[:-1]):
            out = "%s+\\frac{1}{%s}" % (printer._print(t), out)
        return out


def continued_fraction(x, digits):
    """The terms of x's continued fraction until a convergent agrees with x to digits digits."""
    v = sp.Rational(x) if x.is_Rational else sp.Rational(str(sp.N(x, int(digits) + 30)))
    terms, (p0, q0), (p1, q1) = [], (0, 1), (1, 0)
    rest = v
    while len(terms) < 200:
        a = sp.floor(rest)
        terms.append(a)
        p0, q0, p1, q1 = p1, q1, a * p1 + p0, a * q1 + q0
        if rest == a:
            return ContinuedFraction(*terms, 0)
        if abs(v - sp.Rational(p1, q1)) < abs(v) * sp.Rational(1, 10) ** digits:
            break
        rest = 1 / (rest - a)
    return ContinuedFraction(*terms, 1)


# MuPAD functions 5.5's pages call through Define MuPAD Name (p(x) as nextprime(x)); worked out
# when the arguments are numbers, so they can be used in a definition


class nextprime(sp.Function):
    """The smallest prime >= n."""

    def _latex(self, printer):  # (SymPy would read "prime" as a mark: next')
        return "\\operatorname{nextprime}\\left(%s\\right)" % printer._print(self.args[0])

    @classmethod
    def eval(cls, n):
        if n.is_number and n.is_extended_real:
            return sp.nextprime(sp.ceiling(n) - 1)


class divisors(sp.Function):
    """numlib::divisors(n): the positive divisors of n, as a list [1, 2, ..]."""

    @classmethod
    def eval(cls, n):
        if n.is_Integer and n != 0:
            return Bracketed(*sp.divisors(n))


class contfrac(sp.Function):
    """numlib::contfrac(x, n): the continued fraction of x to n digits (10 if not given), as MuPAD
    writes it (pi, 10: 3 + 1/(7 + 1/(15 + 1/(1 + 1/(292 + 1/(1 + 1/(1 + ..)))))))."""

    @classmethod
    def eval(cls, x, digits=sp.Integer(10)):
        if x.is_number and x.is_extended_real and x.is_finite and digits.is_Integer and digits > 0:
            return continued_fraction(x, digits)


class swapRow(sp.Function):
    """linalg::swapRow(A, i, j): A with rows i and j swapped."""

    @classmethod
    def eval(cls, m, i, j):
        if is_matrix(m) and all(k.is_Integer and 1 <= k <= m.rows for k in (i, j)):
            m = sp.Matrix(m)
            m.row_swap(int(i) - 1, int(j) - 1)
            return sp.ImmutableMatrix(m)


class PowerSeries(sp.Function):
    """c0 + c1 (x - a) + c2 (x - a)^2 + .. + O((x - a)^n), written in powers of x - a as MuPAD does.
    args: x - a, the O term, c0, c1, .."""

    def doit(self, **hints):
        return self

    def _latex(self, printer):
        u, order, *cs = self.args
        out = ""
        for k, c in enumerate(cs):
            if c == 0:
                continue
            minus = c.could_extract_minus_sign()
            c = -c if minus else c
            power = "" if k == 0 else (printer._print(u) if u.is_Symbol else printer.parenthesize(u, 1000)) + ("^{%d}" % k if k > 1 else "")
            coeff = printer._print(c) if k == 0 or c != 1 else ""
            if k and c.is_Add:
                coeff = "\\left(%s\\right)" % coeff
            out += ("-" if minus else "+" if out else "") + coeff + power
        return (out + "+" if out else "") + printer._print(order)


def rational_series(g, t, n):
    """A quotient of polynomials in t by long division -> (v + n, the powers of t below
    max(v + n, 1) + 8), v its lowest power. SymPy's series leaves the coefficients as they come:
    with several letters in them it takes minutes, and it does not see a coefficient that is 0."""
    p, q = (sp.Poly(e, t) for e in sp.fraction(sp.together(g)))
    if p.is_zero:
        return sp.Integer(n), sp.S.Zero
    p, q = p.unify(q)
    K = p.domain.get_field()  # the coefficients as quotients of polynomials in the other letters
    vp, vq = (min(m[0] for m in poly.monoms()) for poly in (p, q))
    pk, qk = ([K.from_sympy(poly.coeff_monomial(t ** (v + k))) for k in range(max(vp - vq + n, 1) + 8 - (vp - vq))] for poly, v in ((p, vp), (q, vq)))
    c = []
    for k in range(len(pk)):
        c.append((pk[k] - sum((qk[j] * c[k - j] for j in range(1, k + 1)), K.zero)) / qk[0])
    return sp.Integer(vp - vq + n), sp.Add(*[K.to_sympy(ck) * t ** (vp - vq + k) for k, ck in enumerate(c)])


def mupad_series(f, at=None, order=sp.Integer(5)):
    """MuPAD's series(f, x = a, n), which 5.5's Power Series (Number of terms n) also uses: n powers
    of x - a counted from the lowest one v, ending in O((x - a)^(v + n)), or further when the next
    coefficients are 0. 5.5's help: sin(x)/x with 10 terms ends in O(x^10), Y3(x)/x (from x^-4)
    with 5 terms in O(x)."""
    x, a = (at.lhs, at.rhs) if isinstance(at, sp.Equality) else (at, 0) if isinstance(at, sp.Symbol) else (main_variable(f), 0)
    if not (getattr(order, "is_Integer", False) and order > 0):
        raise Unsupported("The order of series must be a positive whole number")
    t = sp.Dummy("t")
    g = f.subs(x, a + t)
    def power(term):  # the power of t in one term (a log(t) factor counts as 0)
        return sum((e for b, e in (f.as_base_exp() for f in sp.Mul.make_args(term)) if b == t), sp.S.Zero)

    if g.is_rational_function(t):
        top, s = rational_series(g, t, int(order))
    else:
        v = g.as_leading_term(t).as_coeff_exponent(t)[1]
        top = v + int(order)  # v + n (v may be a fraction: sqrt(x))
        # SymPy's own count can stop short (Y3(x)/x with n = 1 gives only -16/(pi x^4)), and it takes
        # no n below 1: ask for more powers and keep the powers below top
        most = max(int(sp.ceiling(top)), 1) + 8
        if v.is_Integer and v >= 0 and not g.has(sp.log, sp.bessely, sp.besselk, sp.Ei, sp.Ci, sp.li):
            # a Taylor series: SymPy's terms below the order asked are all there, and asking for
            # many more is slow (e^{sin x}: 0.4 s to x^7, 6 s to x^14); ask for one power past top,
            # then more only while no term at or past top has come (to see where O goes, below)
            n = max(int(sp.ceiling(top)), 1) + 1
            while True:
                s = opensw_giac.series(g, t, n) if opensw_giac else None
                s = sp.expand(sp.series(g, t, 0, n).removeO()) if s is None else s
                if n >= most or any(power(term) >= top for term in sp.Add.make_args(s)):
                    break
                n = min(most, n + 2 * (n - int(sp.ceiling(top))))
        else:
            s = opensw_giac.series(g, t, most) if opensw_giac else None
            s = sp.expand(sp.series(g, t, 0, most).removeO()) if s is None else s
    # as 5.5 shows it, O moves past powers whose coefficient is 0, to the first term left out
    # (checked on 5.5: sin x with 5 terms ends in O(x^7), cos x / x^4 with 3 terms in O(1));
    # not past a term with log x (5.5's help: Y3(x)/x with 5 terms ends in O(x))
    later = [term for term in sp.Add.make_args(s) if power(term) >= top]
    if top.is_Integer and later:
        nxt = min(power(term) for term in later)
        with_log = any(lg.has(t) for term in later if power(term) == nxt for lg in term.atoms(sp.log))
        if nxt.is_Integer and not with_log:
            top = nxt
    s = sp.Add(*[term for term in sp.Add.make_args(s) if power(term) < top])
    big_o = sp.Order((x - a) ** top, (x, a))
    if not s.is_polynomial(t):  # negative powers: as SymPy writes it
        return Shown(sp.Add(*sp.Add.make_args(s.subs(t, x - a)), big_o, evaluate=False))
    p = sp.Poly(s, t)
    return PowerSeries(x - a, big_o, *[p.coeff_monomial(t ** k) for k in range(int(top))])


# MuPAD commands written in a formula, which 5.5 gave to MuPAD as they are; also the ones 5.5's
# pages name with Define MuPAD Name (nextprime, numlib::contfrac, numlib::divisors, linalg::swapRow)
MUPAD_COMMANDS = {
    "series": mupad_series, "nextprime": nextprime, "divisors": divisors, "contfrac": contfrac, "swapRow": swapRow,
    "factor": lambda e: Shown(factor(e)), "expand": lambda e: Shown(sp.expand(e)), "float": lambda e: sp.N(e, 10),
    "istrue": lambda r: sp.true if r == sp.true else sp.false,
    "solve": lambda e, *xs: sp.FiniteSet(*[Bracketed(*[sp.Eq(v, x) for v, x in sol]) for sol in solve(e, list(xs) or None)]),
    "row": lambda m, i: as_matrix(m).row(int(i) - 1), "col": lambda m, i: as_matrix(m).col(int(i) - 1),
}


CAPITAL_GREEK = {"Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega"}


def user_function_name(head):
    """f, w_0, xi (small letters), W (one capital letter), Psi (a capital Greek letter)."""
    base = head.split("_")[0]
    return head[:1].islower() or len(base) == 1 or base in CAPITAL_GREEK


def function_body(j):
    """["Function", ["Block", body], "x"] -> (body, x); a plain expression -> (expr, None)."""
    if isinstance(j, list) and j and j[0] == "Function":
        variables = [variable(v) for v in j[2:]]
        return build(j[1]), (variables[0] if variables else None)
    return build(j), None


def limits(j):
    """["Limits", "x", 0, 1] -> (x, 0, 1); bounds of "Nothing" are left out."""
    if isinstance(j, list) and j and j[0] in ("Limits", "Tuple", "Triple", "Pair"):
        parts = [build(x) for x in j[1:]]
        return tuple(p for p in parts if p is not None)
    return (build(j),)


# ---------------------------------------------------------------------------
# matrices, vectors and lists, as 5.5 computes with them
# ---------------------------------------------------------------------------

# reset for each computation (compute()): the names in the order they are written (the unknowns
# of a matrix equation A x = b), and the brackets of the answer: those of the first matrix written
# (or defined); without one, [ ] for arithmetic with lists (1, 2) + (3, 4), else ( )
NAMES = []
STYLE = {"delim": None, "list": False, "product": False, "log10": False}
PARAMS = set()  # the parameters of a function being defined: f(x) = .. (not x's own definition)


def a_matrix(rows, delim):
    if delim == "list":
        STYLE["list"] = True
    elif STYLE["delim"] is None:
        STYLE["delim"] = delim
    return sp.ImmutableMatrix(rows)


def answer_delim():
    return STYLE["delim"] or ("[" if STYLE["list"] and not STYLE["product"] else "(")


def is_matrix(x):
    return isinstance(x, sp.MatrixBase)


def is_vector(x):
    return is_matrix(x) and 1 in x.shape


def add(terms):
    """A sum; a number added to a square matrix is that number times the identity (5.5)."""
    first = next((k for k, t in enumerate(terms) if is_matrix(t)), None)
    if first is None:
        return sp.Add(*terms)
    total = terms[first]
    for t in terms[:first] + terms[first + 1:]:
        if not is_matrix(t):
            if not total.is_square:
                raise Unsupported("Only a square matrix can be added to a number")
            t = t * sp.eye(total.rows)
        elif t.shape != total.shape:
            raise Unsupported("Matrices of different sizes cannot be added")
        total = total + t
    return sp.ImmutableMatrix(total)


def multiply(factors):
    """A product, left to right: matrix products; two vectors of one length that cannot be
    multiplied as matrices give their dot product (a list times a list)."""
    out = factors[0]
    for f in factors[1:]:
        if is_matrix(out) and is_matrix(f):
            if out.cols == f.rows:
                out = out * f
            elif is_vector(out) and is_vector(f) and len(out) == len(f):
                out = dot(out, f)
            else:
                raise Unsupported("These matrices cannot be multiplied: the sizes do not match")
        else:
            out = out * f if is_matrix(out) or is_matrix(f) else sp.Mul(out, f)
    return sp.ImmutableMatrix(out) if is_matrix(out) else out


def power(base, j):
    """base^j: A^n (A^{-1} the inverse, A^0 the identity), A^H the Hermitian transpose, e^A."""
    if is_matrix(base):
        if j == "H":
            return base.H
        n = build(j)
        if not n.is_integer:
            raise Unsupported("A matrix can only be raised to a whole power")
        return sp.ImmutableMatrix(base ** n)
    e = build(j)
    if is_matrix(e):
        if base != sp.E:
            raise Unsupported("Only e can be raised to a matrix")
        return sp.ImmutableMatrix(sp.simplify(e.exp()))
    return sp.Pow(base, e)


def dot(u, v):
    if not (is_matrix(u) and is_matrix(v)):
        return multiply([u, v])
    if is_vector(u) and is_vector(v) and len(u) == len(v):  # 5.5: u . v = sum of u_i v_i^*
        return sp.Add(*[x * sp.conjugate(y) for x, y in zip(u, v)])
    return multiply([u, v])


def cross(u, v):
    if not (is_matrix(u) and is_matrix(v)):  # a number times a vector (5.5 works left to right)
        return multiply([u, v])
    if not (is_vector(u) and is_vector(v) and len(u) == 3 and len(v) == 3):
        raise Unsupported("The cross product needs two vectors with 3 components")
    STYLE["product"] = True
    (a1, a2, a3), (b1, b2, b3) = list(u), list(v)
    c = [a2 * b3 - a3 * b2, a3 * b1 - a1 * b3, a1 * b2 - a2 * b1]
    return sp.ImmutableMatrix([c] if u.rows == 1 else c)  # shaped as the first vector


def norm(m, p):
    """||v||, ||v||_p, ||v||_infinity of a vector; ||A||_1 (largest column sum), ||A||_infinity
    (largest row sum), ||A||_F (Frobenius) of a matrix, and ||A|| = ||A||_2, the largest singular
    value, which 5.5 gives as a decimal number."""
    if p == "'Frobenius'":
        p = "F"
    elif p is not None:
        p = build(p)
    if not is_matrix(m):
        return sp.Abs(m)
    entries = list(m)
    if is_vector(m) or p == "F":
        if p in (None, 2, "F"):
            return sp.sqrt(sp.Add(*[sp.Abs(x) ** 2 for x in entries]))
        if p == sp.oo:
            return sp.Max(*[sp.Abs(x) for x in entries])
        if p.is_integer and p > 0:
            return sp.Pow(sp.Add(*[sp.Abs(x) ** p for x in entries]), 1 / p)
        raise Unsupported("The norm's subscript must be a positive integer or infinity")
    if p == 1:
        return sp.Max(*[sp.Add(*[sp.Abs(x) for x in m.col(k)]) for k in range(m.cols)])
    if p == sp.oo:
        return sp.Max(*[sp.Add(*[sp.Abs(x) for x in m.row(k)]) for k in range(m.rows)])
    if p in (None, 2):
        eig = list((m * m.H).eigenvals())
        if m.free_symbols:
            return sp.sqrt(sp.Max(*eig))
        return sp.sqrt(max(sp.re(sp.N(x, 15)) for x in eig)).evalf(10)
    raise Unsupported("A matrix norm is ||A||, ||A||_1, ||A||_2, ||A||_F or ||A||_∞")


NABLA = {"Gradient": "gradient", "Divergence": "divergence", "Curl": "curl", "Laplacian": "laplacian"}

# a function of one matrix: its largest or smallest entry, |A| (the determinant), e^A
MATRIX_FUNCTIONS = {
    "Max": lambda m: sp.Max(*m), "Min": lambda m: sp.Min(*m), "Abs": lambda m: det(m),
    "Exp": lambda m: sp.ImmutableMatrix(sp.simplify(m.exp())),
}


def polynomial_at_matrix(name, m):
    """f(A) for a polynomial f defined earlier (f(x) = x^2 - 5x - 2x^0): x^0 is the identity;
    y(A) for y of Solve ODE > Numeric: its values at the entries."""
    d = DEFINITIONS.get(name)
    if d and isinstance(d[1], type):  # y of Solve ODE > Numeric at each entry: a table of its values (5.5)
        return sp.ImmutableMatrix(m.applyfunc(d[1]))
    if not d or not isinstance(d[1], sp.Lambda) or len(d[1].variables) != 1:
        raise Unsupported("Only a polynomial defined with Compute > Define can be applied to a matrix")
    x, body = d[1].variables[0], d[1].expr
    if not body.is_polynomial(x) or not m.is_square:
        raise Unsupported("Only a polynomial can be applied to a square matrix")
    out = sp.zeros(m.rows)
    for (k,), c in sp.Poly(body, x).terms():
        out += c * m ** k
    return sp.ImmutableMatrix(out)


def matrix_equation(e):
    return isinstance(e, sp.Equality) and is_matrix(e.lhs) and is_matrix(e.rhs)


# ---------------------------------------------------------------------------
# operations of the Compute menu
# ---------------------------------------------------------------------------

def last_side(e):
    """The expression to work on: for "a = b" the right side (so results can be chained)."""
    return e.rhs if isinstance(e, sp.Equality) else e


def antiderivative(e, r):
    """An indefinite integral as MuPAD gives it: the general case of SymPy's cases (a = ib, ..), and
    c ln(2x - 2) as c ln(x - 1) (an antiderivative too: they differ by a constant)."""
    if not (isinstance(e, sp.Integral) and all(len(l) == 1 for l in e.limits)) or e.has(sp.Piecewise):
        return r
    if isinstance(r, sp.Piecewise) and r.args[-1].cond == sp.true:
        r = r.args[-1].expr
    xs = {l[0] for l in e.limits}

    def term(t):
        k, rest = t.as_independent(*xs, as_Add=False)
        if isinstance(rest, sp.log) and rest.args[0].is_Add:
            c, u = rest.args[0].as_content_primitive()
            if c.is_Rational and c > 0 and c != 1:
                return k * sp.log(u)
        return t
    return sp.Add(*[term(t) for t in sp.Add.make_args(r)])


def evaluated(e):
    e = last_side(e)
    if isinstance(e, sp.MatrixBase):
        return e.applyfunc(lambda x: with_decimals(x.doit())) if e.has(sp.Float) else e.applyfunc(lambda x: x.doit())
    if e.has(sp.Integral):
        e = kept_divergent(e)
    r = opensw_giac.integrals(e) if opensw_giac else e
    r = antiderivative(e, (opensw_fricas.integrals(r) if opensw_fricas else r).doit())
    if e.has(sp.Float):
        return with_decimals(r)
    return sp.simplify(r) if r == e else r


def evaluate(e):
    """Compute > Evaluate. An odd root of a negative number is the real root, as in 5.5
    (cube root of -8 = -2; Evaluate Numerically gives the principal value 1 + 1.7321i). After
    assume(real) 5.5 keeps it a root, and of a decimal gives the principal value (0.1 + 0.17321i)."""
    r = evaluated(e)
    if not hasattr(r, "replace"):
        return r
    odd_root = lambda n: n.is_Pow and n.base.is_Number and n.base < 0 and n.exp.is_Rational and n.exp.p == 1 and n.exp.q % 2 == 1  # noqa: E731
    if not ASSUMED.get("", {}).get("real"):
        r = r.replace(odd_root, lambda n: -sp.Pow(-n.base, n.exp))
    elif r.has(sp.Float):
        r = with_decimals(r.replace(odd_root, lambda n: n.evalf()))
    # cos(20/9 pi) = cos(2/9 pi): an angle of 2 pi or more brought back (SymPy leaves some cosines)
    trig = (sp.sin, sp.cos, sp.tan, sp.cot, sp.sec, sp.csc)
    turn = lambda n: isinstance(n, trig) and (n.args[0] / sp.pi).is_Rational and abs(n.args[0] / sp.pi) >= 2  # noqa: E731
    return r.replace(turn, lambda n: n.func((n.args[0] / sp.pi % 2) * sp.pi))


def with_decimals(r):
    """5.5 (MuPAD) computes with decimals: a function or power of a number with a decimal in it
    becomes a decimal (sqrt(2.34 - i), 3.1416^2.7183), and so does arithmetic of such numbers;
    constants stay (9.6 pi - 2.7 pi = 6.9 pi)."""
    r = r.replace(lambda n: (n.is_Pow or isinstance(n, sp.Function)) and n.is_number and n.has(sp.Float), lambda n: without_noise(n.evalf()))
    return sp.expand(r) if r.is_number else r


def without_noise(v):
    """e^{0.5 i pi} = 1.7 x 10^-21 + 1.0 i: the real part is a Float without a significant
    digit (SymPy's precision 1), which would make 2/3 + it a number without digits too: 0."""
    return v.replace(lambda f: f.is_Float and f._prec < 10, lambda f: sp.S.Zero)


def evaluate_numerically(e):
    r = evaluated(e)
    return r.evalf(10) if hasattr(r, "evalf") else r


def factor(e):
    e = last_side(e)
    if isinstance(e, Modulo) and e.args[1].is_Integer:  # a polynomial mod p: factored mod p
        p = int(e.args[1])
        c, fs = sp.factor_list(sp.expand(e.args[0].doit()), modulus=p)
        return sp.Mul(modulo(c, e.args[1]), *[sp.Pow(modulo(f, e.args[1]), k, evaluate=False) if k > 1 else modulo(f, e.args[1]) for f, k in fs], evaluate=False)
    if e.is_Integer:
        return sp.Mul(*[p if k == 1 else sp.Pow(p, k, evaluate=False) for p, k in sp.factorint(e).items()], evaluate=False)
    e = e.doit()
    return sp.factor(e, gaussian=True) if e.has(sp.I) else sp.factor(e)  # i(x^2 + 1) = i(x - i)(x + i), as 5.5


def solve(e, unknowns=None, principal=False):
    """-> list of solutions, each a list of (variable, value); unknowns: the variables to solve
    for (with none given, as many as there are equations, the first ones in alphabetical order:
    what the Solve dialog offers, as 5.5 asks). One equation whose unknown is in a periodic
    function or an exponent: every solution, as 5.5 gives it, families with an integer k
    (sin x = 1/2: x \\in {pi/6 + 2 pi k | k in Z} u ...); principal: 5.5's Principal Value Only,
    one solution."""
    eqs = list(e) if isinstance(e, (list, sp.MatrixBase)) else [e]  # a system: one equation per row
    if len(eqs) == 1 and matrix_equation(eqs[0]):  # A x = b: one equation per entry
        if eqs[0].lhs.shape != eqs[0].rhs.shape:
            raise Unsupported("The two sides are matrices of different sizes")
        eqs = [sp.Eq(p, q) for p, q in zip(eqs[0].lhs, eqs[0].rhs)]
        if sp.false in eqs:
            return []
        eqs = [q for q in eqs if q != sp.true]
    eqs = [q.doit() if q.has(sp.Derivative) else q for q in eqs]  # f'(x) = 0 with f defined
    if any(q is sp.false for q in eqs):  # x^2 = -1 with x positive: no solution
        return []
    eqs = [q if isinstance(q, sp.core.relational.Relational) and not isinstance(q, sp.Ne) else sp.Eq(q, 0) for q in eqs if q is not sp.true]
    free = sorted(set().union(*[q.free_symbols for q in eqs]) - UNIT_SYMBOLS, key=str)
    variables = unknowns or free
    if any(not isinstance(q, sp.Equality) for q in eqs):
        # inequalities: the real numbers that satisfy them, as intervals (as 5.5)
        if len(variables) != 1 or not all(isinstance(q, (sp.Lt, sp.Le, sp.Gt, sp.Ge)) for q in eqs):
            raise Unsupported("Inequalities can be solved in one variable, without equations")
        x = variables[0]
        found = sp.S.Reals
        for q in eqs:
            found = found & sp.solveset(q, x, sp.S.Reals)
        return [] if found is sp.S.EmptySet else [[(x, found)]]
    if not unknowns and len(free) > len(eqs):
        variables = free[:len(eqs)]
    if len(eqs) == 1 and len(variables) == 1 and not principal:
        # x assumed in a range (additionally(x < 10) ..): the solutions in it, as 5.5 (sin x = 0: -3 pi, .., 3 pi)
        x = variables[0]
        allowed = RANGES.get(x.name, (sp.S.Reals, sp.S.Reals))
        if allowed[1] is None and allowed[0] != sp.S.Reals:
            found = sp.solveset(eqs[0].lhs - eqs[0].rhs, x, allowed[0])
            if isinstance(found, sp.FiniteSet):
                return [[(x, v)] for v in sorted(found, key=lambda v: float(sp.re(sp.N(v))))]
        every = general_solution(eqs[0], variables[0]) or abs_circle(eqs[0], variables[0])
        if every is not None:
            return [[(variables[0], every)]]
    # one equation in one unknown on its own: as a system SymPy may write a constant such as
    # sin(11 pi/90) as a polynomial in itself (14/sin 22 degrees became a sum of 11 powers)
    try:
        found = sp.solve(eqs[0], variables[0], dict=True) if len(eqs) == 1 and len(variables) == 1 else sp.solve(eqs, variables, dict=True)
    except NotImplementedError:
        if not any(q.has(sp.Abs) for q in eqs):
            raise
        # |3x - 2| = 5: SymPy solves it for real x (as 5.5 does with real variables)
        real = {v: sp.Dummy(v.name, real=True) for v in variables}
        back = {r: v for v, r in real.items()}
        found = [{back[k]: x.xreplace(back) for k, x in f.items()} for f in sp.solve([q.xreplace(real) for q in eqs], list(real.values()), dict=True)]
    found = [[(v, s[v]) for v in variables if v in s] for s in found]
    # real unknowns (assume(real)): SymPy keeps roots it cannot tell are complex (Cardano's forms); 5.5 does not
    nonreal = lambda v, x: v.is_real and x.is_number and abs(sp.im(sp.N(x, 30))) > 1e-20 * (1 + abs(sp.N(x, 30)))  # noqa: E731
    found = [s for s in found if not any(nonreal(v, x) for v, x in s)]
    if principal and len(found) > 1 and not any(q.has(sp.Float) for q in eqs):  # with decimals 5.5 gives all
        found = [min(found, key=principal_order)]
    return found


def principal_order(sol):
    """The solution 5.5's Principal Value Only gives: the smallest, the positive one of +-a
    (other variables taken as 1)."""
    v = sp.N(sol[0][1].subs({s: 1 for s in sol[0][1].free_symbols}))
    if not v.is_number or v.has(sp.nan, sp.zoo):
        return (sp.oo, 0, 0)
    re_, im_ = (float(t) for t in v.as_real_imag())
    return (round(abs(complex(re_, im_)), 9), -re_, -im_)


def periodic_in(e, x):
    """x inside a periodic function or an exponent (sin x, e^x, 3^x)."""
    from sympy.functions.elementary.trigonometric import TrigonometricFunction
    from sympy.functions.elementary.hyperbolic import HyperbolicFunction
    kinds = (TrigonometricFunction, HyperbolicFunction, sp.exp)
    return any((isinstance(n, kinds) or n.is_Pow and n.exp.has(x)) and n.has(x) for n in sp.preorder_traversal(e))


class Families(sp.Basic):
    """Every solution as 5.5 writes it: {b + a k | k in Z} u ... (args: the k, the families as
    Tuples (a, b), then the single solutions)."""

    def _latex(self, printer):
        k, fams, single = self.args[0], self.args[1], self.args[2]
        parts = []
        for a, b in fams:
            ak = printer._print(a * k)
            if b == 0:
                body = ak
            elif b.has(sp.Float):  # 6.2832 k - 1.5708, as 5.5 writes decimals
                body = ak + ("" if printer._print(b).startswith("-") else "+") + printer._print(b)
            else:  # -\\frac{1}{2}\\pi + 2\\pi k
                body = printer._print(b) + ("" if ak.startswith("-") else "+") + ak
            parts.append(r"\left\{ %s\mid %s\in \mathbb{Z}\right\}" % (body, printer._print(k)))
        if single:
            parts.insert(0, r"\left\{ %s\right\}" % ", ".join(printer._print(x) for x in single))
        return r"\cup ".join(parts)


def general_solution(eq, x):
    """Every solution of eq in x as 5.5 gives it (a Families), when x is in a periodic function
    or an exponent and SymPy finds them; else None. The families as MuPAD writes them: the
    offset of each within one period around 0 (-\\arcsin \\frac{1}{3} + 2 pi k), and two
    that together make one of half the period joined ({pi k} for sin x = 0)."""
    e = eq.lhs - eq.rhs
    if not periodic_in(e, x):
        return None
    # 3^x: as an exponential, which solveset inverts in the complex numbers
    e = e.replace(lambda n: n.is_Pow and n.exp.has(x) and not n.base.has(x) and n.base.is_positive, lambda n: sp.exp(n.exp * sp.log(n.base)))
    s = None
    for dom in ([sp.S.Reals] if x.is_real else [sp.S.Complexes, sp.S.Reals]):
        try:
            s = sp.solveset(e, x, dom)
        except Exception:  # NotImplementedError, ValueError (|z| in the complex numbers)
            s = None
        if isinstance(s, (sp.Union, sp.ImageSet)):
            break
    parts = s.args if isinstance(s, sp.Union) else (s,)
    if not any(isinstance(p, sp.ImageSet) for p in parts):
        return None
    fams, single = [], []
    for p in parts:
        if isinstance(p, sp.FiniteSet):
            single.extend(p.args)
            continue
        if not (isinstance(p, sp.ImageSet) and p.base_sets == (sp.S.Integers,)):
            return None
        n = p.lamda.variables[0]
        f = sp.expand(p.lamda.expr)
        for a in f.atoms(sp.arg):  # i (2 pi n + arg y) + ln |y|: ln y + 2 pi i n
            f = sp.expand(f.subs(sp.log(sp.Abs(a.args[0])), sp.log(a.args[0]) - sp.I * a))
        a, b = f.coeff(n), f.subs(n, 0)
        if a == 0 or a.has(n) or sp.expand(f - a * n - b) != 0:
            return None
        fams.append((a, b))
    fams = join_families(fams)
    single = [y for y in single if not any(in_family(y - b, a) for a, b in fams)]
    if eq.has(sp.Float):  # decimals in, decimals out (6.2832 k + 0.77540)
        fams = [(a.evalf(), b.evalf()) for a, b in fams]
        single = [y.evalf() for y in single]
    names = {str(v) for v in eq.free_symbols}
    k = sp.Symbol(next(c for c in ("k", "n", "m", "j", "l") if c not in names), integer=True)
    return Families(k, sp.Tuple(*[sp.Tuple(a, b) for a, b in fams]), sp.Tuple(*single))


class Circle(sp.Basic):
    """|a x + b| = c in the complex numbers: the circle {r e^{2 i pi t} + m | t in [0, 1]}, as
    5.5 writes it (args: t, r, m)."""

    def _latex(self, printer):
        t, r, m = self.args
        body = printer._print(r * sp.exp(2 * sp.I * sp.pi * t))
        if m != 0:
            mm = printer._print(m)
            body += mm if mm.startswith("-") else "+" + mm
        return r"\left\{ %s\mid %s\in \left[0,1\right]\right\}" % (body, printer._print(t))


def abs_circle(eq, x):
    """|a x + b| = c, c > 0, for a complex x (5.5's default): every solution, a circle; else None."""
    if x.is_real:
        return None
    for u, c in ((eq.lhs, eq.rhs), (eq.rhs, eq.lhs)):
        if isinstance(u, sp.Abs) and c.is_number and c.is_positive and u.args[0].is_polynomial(x) and sp.degree(u.args[0], x) == 1:
            a, b = sp.Poly(u.args[0], x).all_coeffs()
            if a.is_number and b.is_number:
                names = {str(v) for v in eq.free_symbols}
                t = sp.Symbol(next(n for n in ("t", "s", "u", "v") if n not in names))
                return Circle(t, c / sp.Abs(a), -b / a)
    return None


def in_family(d, a, frac=0):
    """d is (an integer + frac) times a."""
    try:
        q = complex(sp.N(d / a))
    except (TypeError, ValueError):
        return False
    return abs(q.imag) < 1e-9 and abs(q.real - frac - round(q.real - frac)) < 1e-9


def shifted(a, b):
    """b + a k with b's multiple of pi brought within half a period of 0."""
    q = a / sp.pi
    c = sp.expand(b).coeff(sp.pi)
    if not (q.is_Rational and q > 0 and c.is_Rational):
        return b
    m = sp.ceiling((c - q / 2) / q)
    return sp.expand(b - m * a)


def join_families(fams):
    fams = [(a, shifted(a, b)) for a, b in fams]
    changed = True
    while changed:
        changed = False
        for i in range(len(fams)):
            for j in range(i + 1, len(fams)):
                (a, b), (a2, b2) = fams[i], fams[j]
                if a != a2:
                    continue
                if in_family(b2 - b, a):  # the same family twice
                    del fams[j]
                elif in_family(b2 - b, a, 0.5):  # {2 pi k} u {pi + 2 pi k} = {pi k}
                    keep = b if abs(complex(sp.N(b))) <= abs(complex(sp.N(b2))) else b2
                    fams[i] = (a / 2, shifted(a / 2, keep))
                    del fams[j]
                else:
                    continue
                changed = True
                break
            if changed:
                break
    return fams


def solution_tex(v, x):
    """x = 3, or x \\in an interval (inequalities) or the families of every solution"""
    return f"{tex(v)}\\in {tex(x)}" if isinstance(x, (sp.Set, Families, Circle)) else f"{tex(v)}={tex(x)}"


def partial_fractions(e, var=None):
    """In the variable asked for, or x (main_variable) when there are several: the others are constants."""
    e = sp.together(last_side(e).doit())
    return sp.apart(e, var or main_variable(e)) if var or len(e.free_symbols) > 1 else sp.apart(e)


def simplify(e):
    r = sp.simplify(last_side(e).doit())
    return sp.radsimp(r) if getattr(r, "is_number", False) else r  # 5.5 rationalizes: 1/(sqrt 2 + sqrt 3) = sqrt 3 - sqrt 2


def expand_angles(e):
    """sin, cos, sinh, cosh of a sum by the addition formulas and of n x by de Moivre's formula
    (sin 3x = 3 cos^2 x sin x - sin^3 x), as 5.5's Expand writes them."""
    def one(f, u):
        if u.is_Add:
            a, b = u.args[0], sp.Add(*u.args[1:])
            sa, ca, sb, cb = one(SIN[f], a), one(COS[f], a), one(SIN[f], b), one(COS[f], b)
            if f in (sp.sin, sp.sinh):
                return sa * cb + ca * sb
            return ca * cb - sa * sb if f == sp.cos else ca * cb + sa * sb
        n, v = u.as_coeff_Mul()
        if n.is_Integer and n > 1 and not v.is_number:
            s, c, sign = SIN[f](v), COS[f](v), (-1 if f in (sp.sin, sp.cos) else 1)
            first = 1 if f in (sp.sin, sp.sinh) else 0  # odd powers of sin for sin, even for cos
            return sp.Add(*[sp.binomial(n, k) * sign ** (k // 2) * c ** (n - k) * s ** k for k in range(first, n + 1, 2)])
        return f(u)
    SIN = {sp.sin: sp.sin, sp.cos: sp.sin, sp.sinh: sp.sinh, sp.cosh: sp.sinh}
    COS = {sp.sin: sp.cos, sp.cos: sp.cos, sp.sinh: sp.cosh, sp.cosh: sp.cosh}
    return e.replace(lambda n: isinstance(n, (sp.sin, sp.cos, sp.sinh, sp.cosh)), lambda n: one(n.func, n.args[0]))


def expand(e):
    e = last_side(e).doit()
    if isinstance(e, sp.MatrixBase):
        return e.applyfunc(sp.expand)
    e = e.replace(lambda n: n.is_Pow and n.exp.is_Add, lambda n: sp.Mul(*[n.base ** t for t in n.exp.args]))  # a^(x-y) = a^x/a^y
    return sp.expand(expand_angles(sp.expand_power_exp(e)))


def linearize(e):
    """Products and powers of sin and cos as sums of sin and cos of multiple angles
    (sin^2 x = 1/2 - 1/2 cos 2x): 5.5's Combine > Trig Functions."""
    from sympy.simplify.fu import TR8
    for _ in range(20):
        r = sp.expand(TR8(e))
        if r == e:
            break
        e = r
    return e


def combine(e):
    e = sp.together(last_side(e).doit())
    e = linearize(e) if e.has(sp.sin, sp.cos) else sp.trigsimp(e)
    return sp.powsimp(sp.logcombine(e, force=True))


def rewrite_sincos(e):
    """tan, cot, sec, csc and e^(ix) in sin and cos; a complex number as a + bi."""
    e = last_side(e).doit()
    if isinstance(e, sp.MatrixBase):
        return e.applyfunc(rewrite_sincos)
    e = e.replace(sp.tan, lambda u: sp.sin(u) / sp.cos(u)).replace(sp.cot, lambda u: sp.cos(u) / sp.sin(u))
    e = e.replace(sp.sec, lambda u: 1 / sp.cos(u)).replace(sp.csc, lambda u: 1 / sp.sin(u))
    e = e.replace(lambda n: isinstance(n, sp.exp) and n.args[0].has(sp.I), lambda n: n.rewrite(sp.cos))
    return sp.expand_complex(e) if getattr(e, "is_number", False) else e


def rewrite_exp(e):
    """In exponentials; tanh x = (e^(2x) - 1)/(e^(2x) + 1) as 5.5 writes it."""
    e = last_side(e).doit()
    if isinstance(e, sp.MatrixBase):
        return e.applyfunc(rewrite_exp)
    e = e.replace(sp.tanh, lambda u: (sp.exp(2 * u) - 1) / (sp.exp(2 * u) + 1)).replace(sp.coth, lambda u: (sp.exp(2 * u) + 1) / (sp.exp(2 * u) - 1))
    # the functions only: a power such as (x + 1)^2 stays (not e^(2 ln(x + 1)))
    kinds = (sp.functions.elementary.trigonometric.TrigonometricFunction, sp.functions.elementary.hyperbolic.HyperbolicFunction)
    return e.replace(lambda n: isinstance(n, kinds), lambda n: n.rewrite(sp.exp))


def check_equality(e):
    if e in (sp.true, sp.false):  # SymPy already decided it: x + 1 = x is False
        return e == sp.true
    if not isinstance(e, sp.Equality):
        raise Unsupported("Needs an equals sign")
    if is_matrix(e.lhs) or is_matrix(e.rhs):
        lhs, rhs = (x[0, 0] if is_matrix(x) and x.shape == (1, 1) else x for x in (e.lhs, e.rhs))
        if not (is_matrix(lhs) and is_matrix(rhs)):
            return not (is_matrix(lhs) or is_matrix(rhs)) and sp.simplify(lhs - rhs) == 0
        return lhs.shape == rhs.shape and all(sp.simplify(x) == 0 for x in (lhs - rhs).doit())
    return sp.simplify(e.lhs - e.rhs) == 0


def step_check(a, b):
    """One step a = b of a derivation (Changes and errors panel): "equal" when a - b simplifies to 0
    (proved for every value of the letters, complex ones included: sqrt(x^2) = x is not), "notequal"
    with a point where the two have different values (exact numbers put in for the letters),
    "unknown" when neither is found (then nothing is said to be wrong)."""
    a, b = (x.doit() if hasattr(x, "doit") else x for x in (a, b))
    if is_matrix(a) or is_matrix(b):
        same = is_matrix(a) and is_matrix(b) and a.shape == b.shape and all(sp.simplify(x) == 0 for x in (a - b))
        return {"result": "equal" if same else "unknown"}
    if sp.simplify(a - b) == 0:
        return {"result": "equal"}
    xs = sorted((a - b).free_symbols, key=str)
    values = [sp.Rational(1, 3), sp.Rational(-3, 5), sp.Rational(2, 7), sp.Rational(5, 2), sp.Rational(-7, 4), sp.Rational(11, 13)]
    for k in range(len(values)):
        point = {x: values[(k + i) % len(values)] for i, x in enumerate(xs)}
        va, vb = a.subs(point).doit(), b.subs(point).doit()
        if not (va.is_number and vb.is_number) or any(v.has(sp.zoo, sp.nan, sp.oo, -sp.oo) for v in (va, vb)):
            continue
        d = sp.simplify(va - vb)
        if d.has(sp.Float):  # decimals in the formula: different beyond rounding
            far = abs(complex(sp.N(d))) > 1e-9 * max(1.0, abs(complex(sp.N(va))))
        else:
            far = d.is_zero is False
        if far:
            return {"result": "notequal", "point": ", ".join(f"{tex(x)}={tex(v)}" for x, v in point.items()),
                    "values": [tex(va), tex(vb)]}
    return {"result": "unknown"}


def main_variable(e):
    """The variable an operation works in: x if present, otherwise the first one."""
    free = sorted(e.free_symbols, key=str)
    if not free:
        raise Unsupported("The expression has no variable")
    for name in ("x", "t", "s", "z", "y"):
        for v in free:
            if v.name == name:
                return v
    return free[0]


def power_series(e, var=None, terms=5, point=0):
    """Calculus > Power Series as in 5.5: terms (Number of terms) powers of var - point, see
    mupad_series; var: x if present (main_variable)."""
    e = last_side(e).doit()
    return mupad_series(e, sp.Eq(var or main_variable(e), point, evaluate=False), sp.Integer(terms))


def pade(e, m, n, var=None, point=0):
    """The Pade approximant [m/n]: P/Q with deg P <= m, deg Q <= n, Q(point) = 1, whose series
    agrees with e's up to (var - point)^(m+n)."""
    e = last_side(e).doit()
    v = var or main_variable(e)
    m, n = int(m), int(n)
    if m < 0 or n < 0:
        raise Unsupported("The degrees must be whole numbers, 0 or more")
    t = sp.Symbol("opensw_t")
    series = sp.series(e.subs(v, t + point), t, 0, m + n + 1).removeO()
    c = [sp.simplify(series.coeff(t, k)) for k in range(m + n + 1)]
    q = sp.symbols(f"opensw_q1:{n + 1}") if n else ()
    qs = [sp.Integer(1), *q]
    coef = lambda k: c[k] if 0 <= k <= m + n else 0  # noqa: E731
    eqs = [sum(qs[j] * coef(k - j) for j in range(n + 1)) for k in range(m + 1, m + n + 1)]
    sol = sp.solve(eqs, q, dict=True) if n else [{}]
    if not sol:
        raise Unsupported("This Pade approximant does not exist")
    qs = [sp.simplify(x.subs(sol[0])) for x in qs]
    if any(x.free_symbols & set(q) for x in qs):
        raise Unsupported("This Pade approximant is not unique")
    num = sum(sp.simplify(sum(qs[j] * coef(k - j) for j in range(min(k, n) + 1))) * t**k for k in range(m + 1))
    den = sum(qs[j] * t**j for j in range(n + 1))
    x = v - point
    return sp.factor(sp.cancel(num.subs(t, x) / den.subs(t, x)))


def extrema(e):
    """Critical points of f(x) and the value there: solutions of f'(x) = 0."""
    f = last_side(e).doit()
    x = main_variable(f)
    pts = sp.solve(sp.diff(f, x), x)
    return [[(x, p), (sp.Symbol("f"), sp.simplify(f.subs(x, p)))] for p in pts]


def solve_numeric(e, unknowns=None):
    """Real numerical solutions of one equation in one variable (polynomials: all roots; others:
    one, as 5.5), or of a system; rows x \\in (a, b) (as 5.5 writes them) give the interval to
    look in."""
    rows = list(e) if isinstance(e, (list, sp.MatrixBase)) else [e]
    if len(rows) == 1 and isinstance(rows[0], list):  # a system in brackets
        rows = rows[0]
    ranges = {r.args[0]: r.args[1] for r in rows if isinstance(r, sp.Contains)}
    eqs = [r if isinstance(r, sp.Equality) else sp.Eq(r, 0) for r in rows if not isinstance(r, sp.Contains)]
    if len(eqs) > 1 or ranges:
        return solve_numeric_in(eqs, ranges, unknowns)
    eq = eqs[0]
    expr = eq.lhs - eq.rhs
    if expr.has(sp.Derivative):  # f'(x) = 0 with f defined
        expr = expr.doit()
    x = unknowns[0] if unknowns else main_variable(expr)
    if expr.is_polynomial(x):
        roots = sp.Poly(expr, x).nroots(n=10)
    else:
        roots = []
        for guess in [-10, -3, -1, -0.5, 0, 0.5, 1, 3, 10]:
            try:
                r = sp.nsolve(expr, x, guess)
            except Exception:  # no convergence from this start
                continue
            if all(abs(r - q) > 1e-8 for q in roots):
                roots.append(r)
        # 5.5 finds one solution of an equation that is not a polynomial: the one nearest 0
        roots = sorted(roots, key=lambda r: abs(complex(r)))[:1]
    # a root found with a tiny imaginary part (1.3395 - 5.8 x 10^-32 i) is real
    roots = [sp.re(r) if abs(sp.im(r)) < 1e-12 * max(1, abs(r)) else r for r in (sp.N(r, 15) for r in roots)]
    return [[(x, sp.Float(r, 10) if r.is_real else sp.N(r, 10))] for r in roots]


def solve_numeric_in(eqs, ranges, unknowns=None):
    """Numerical solutions of equations, in the intervals given (5.5 gives the ones it finds)."""
    exprs = [q.lhs - q.rhs for q in eqs]
    xs = unknowns or sorted(set().union(*[x.free_symbols for x in exprs]), key=str)
    if len(exprs) != len(xs):
        raise Unsupported("Needs as many equations as unknowns")
    inside = lambda v, r: r.contains(v) == sp.true  # noqa: E731
    found = []

    def keep(sol):
        sol = [sp.Float(v, 10) if abs(sp.im(v)) < 1e-12 else sp.N(v, 10) for v in sol]
        sol = [sp.re(v) if abs(sp.im(v)) < 1e-12 else v for v in sol]
        if all(x not in ranges or (v.is_real and inside(v, ranges[x])) for x, v in zip(xs, sol)) \
                and all(max(abs(a - b) for a, b in zip(sol, f)) > 1e-8 for f in found):
            found.append(sol)
    if len(xs) == 1 and xs[0] in ranges:  # one equation: where it changes sign in the interval
        x, f = xs[0], sp.lambdify(xs[0], exprs[0], "mpmath")
        lo, hi = float(ranges[x].inf), float(ranges[x].sup)
        pts = [lo + (hi - lo) * k / 400 for k in range(401)]
        for a, b in zip(pts, pts[1:]):
            try:
                fa, fb = complex(f(a)).real, complex(f(b)).real
                if fa == 0 or fa * fb < 0:
                    keep([sp.nsolve(exprs[0], x, (a, b), solver="bisect") if fa else sp.Float(a)])
            except Exception:  # not defined there
                continue
    else:
        if all(e.is_polynomial(*xs) for e in exprs) and not ranges:
            try:
                for s in sp.solve(exprs, xs, dict=True):
                    if len(s) == len(xs):
                        keep([sp.N(s[x], 15) for x in xs])
                return [list(zip(xs, f)) for f in found]
            except NotImplementedError:
                pass
        import itertools
        grids = [[ranges[x].inf + (ranges[x].sup - ranges[x].inf) * k / 8 for k in (4, 1, 3, 5, 7)] if x in ranges else [-3, -1, 1, 3] for x in xs]
        for start in itertools.product(*grids):
            try:
                keep(list(sp.nsolve(exprs, xs, list(start))))
            except Exception:  # no convergence from this start
                continue
            if ranges and found:  # in the intervals given: the first one found, as 5.5
                break
    return [list(zip(xs, f)) for f in found]


def ode_form(j, unknowns=(), default=None):
    """MathJSON of an ODE as typed (y'' + y = 0, y'(x) = 2y(x), dy/dx = y) -> MathJSON in
    which the unknown is the function y(x) and its derivatives are ["D", ["y", "x"], "x", ...].
    The variable: the one of dy/dx, else default, else x (t when x is an unknown: x' = y)."""
    names, var = set(unknowns), None

    def scan(n):
        nonlocal var
        if isinstance(n, list) and n:
            if n[0] == "Prime" and isinstance(n[1], str):
                names.add(n[1])
            if n[0] == "Apply" and isinstance(n[1], list) and n[1][:1] == ["Derivative"]:
                names.add(n[1][1])
                var = var or n[2]
            if n[0] == "D" and isinstance(n[1], list) and n[1][:1] == ["Function"]:
                body = n[1][1]
                if isinstance(body, list) and body[:1] == ["Block"] and isinstance(body[1], str):
                    names.add(body[1])
                var = var or n[2]
            for c in n[1:]:
                scan(c)

    scan(j)
    if not names:
        names.add("y")
    var = var or default or ("t" if "x" in names else "x")

    def fix(n):
        if isinstance(n, str):
            return [n, var] if n in names else n
        if not isinstance(n, list) or not n:
            return n
        if n[0] == "Prime" and n[1] in names:
            return ["D", [n[1], var]] + [var] * (n[2] if len(n) > 2 else 1)
        if n[0] == "Apply" and isinstance(n[1], list) and n[1][:1] == ["Derivative"]:
            return ["D", [n[1][1], n[2]]] + [n[2]] * (n[1][2] if len(n[1]) > 2 else 1)
        if n[0] == "D" and isinstance(n[1], list) and n[1][:1] == ["Function"]:
            body = n[1][1]
            name = body[1] if isinstance(body, list) and body[:1] == ["Block"] else body
            return ["D", [name, n[2]]] + list(n[2:])
        if isinstance(n[0], str) and n[0] in names:
            return n  # already y(x)
        return [n[0]] + [fix(c) for c in n[1:]]

    return fix(j)


def solve_ode(e):
    """An ordinary differential equation in y(x) (written with y', y'' or d/dx)."""
    eq = e if isinstance(e, sp.Equality) else sp.Eq(e, 0)
    funcs = sorted(eq.atoms(sp.Function), key=str)
    funcs = [f for f in funcs if isinstance(f.func, sp.core.function.UndefinedFunction)]
    if not funcs:
        raise Unsupported("Needs an unknown function, e.g. y(x)")
    sol = sp.dsolve(eq, funcs[0])
    return sol if isinstance(sol, list) else [sol]


def matrix_of(e):
    return sp.Matrix(last_side(e))


def numbers(e):
    """The numbers of a list or matrix (a row or column of data)."""
    e = last_side(e)
    items = list(e) if isinstance(e, (list, sp.MatrixBase, sp.Tuple)) else [e]
    flat = []
    for x in items:
        flat.extend(list(x) if isinstance(x, (list, sp.MatrixBase, sp.Tuple)) else [x])
    if not flat:
        raise Unsupported("Needs a row of numbers")
    return flat


def mean(xs):
    return sp.Add(*xs) / len(xs)


def variance(xs):
    """Sample variance (n - 1), as statistics programs give it."""
    m = mean(xs)
    return sp.Add(*[(x - m) ** 2 for x in xs]) / (len(xs) - 1) if len(xs) > 1 else sp.Integer(0)


def median(xs):
    s = sorted(xs, key=lambda v: float(v))
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def implicit_derivative(e, var=None):
    """5.5's Implicit Differentiation: both sides of F = G (or F = 0) differentiated in the
    differentiation variable (x when not given); every other letter is a function of it (b too,
    giving b'), the derivatives written with primes (5.5's help: x y + sin x = y gives
    cos x + y + x y' = y'; y' = .. gives y'' = ..)."""
    eq = e if isinstance(e, sp.Equality) else sp.Eq(e, 0)
    x = var if var is not None else variable("x")
    others = sorted((eq.lhs - eq.rhs).free_symbols - {x}, key=str)
    if not others:
        raise Unsupported(f"Needs an expression in {tex(x)} and another letter, e.g. y")
    order = lambda s: len(s.name) - len(s.name.rstrip("'"))  # y'' -> 2
    as_function = {s: sp.Function(s.name.rstrip("'"))(x).diff(x, order(s)) for s in others}
    back = lambda u: u.replace(lambda t: isinstance(t, sp.Derivative) and len(t.variables) == t.derivative_count and set(t.variables) == {x},
                               lambda t: variable(t.expr.func.__name__ + "'" * t.derivative_count)) \
        .replace(lambda t: isinstance(t, sp.core.function.AppliedUndef) and t.args == (x,), lambda t: variable(t.func.__name__))
    side = lambda u: back(sp.expand_mul(u.subs(as_function).diff(x)))
    return f"{tex(side(eq.lhs))}={tex(side(eq.rhs))}"


def laplace(e):
    f = last_side(e).doit()
    t = main_variable(f)
    return sp.laplace_transform(f, t, sp.Symbol("s"), noconds=True)


def inverse_laplace(e):
    f = last_side(e).doit()
    s = variable("s") if variable("s") in f.free_symbols else main_variable(f)
    t = sp.Symbol("t")
    return sp.inverse_laplace_transform(f, s, t).subs(sp.Heaviside(t), 1)  # for t > 0, as 5.5 shows it


def fourier(e):
    """Transforms > Fourier, as 5.5 (MuPAD): F f(w) = int f(x) e^(iwx) dx, from x to w."""
    f = last_side(e).doit()
    free = getattr(f, "free_symbols", set())
    x = variable("x") if variable("x") in free or not free else main_variable(f)
    w = variable("t") if x == variable("w") else variable("w")
    return Transform(f, x, w, 2).doit()


# Compute > Transforms as 5.5 answers them (its help, dm10-1.tex): "1, Fourier transform is: 2 pi Dirac(w)",
# "2/s^3, Is Laplace transform of t^2"
def transform_answer(op, label):  # (label as **{"label": ..}: i18n-keys finds it)
    return lambda j: {"kind": "solutions", "label": label, "solutions": [tex(OPERATIONS[op](apply_definitions(build(j))))]}


# ---------------------------------------------------------------------------
# operations that need more input than the formula (asked in a dialog):
# compute(op, '{"expr": MathJSON, "params": [MathJSON, ...]}')
# ---------------------------------------------------------------------------

def the_integral(e):
    e = last_side(e)
    if not isinstance(e, sp.Integral) or len(e.limits) != 1:
        raise Unsupported("Put the cursor in an integral")
    return e


def by_parts(e, u):
    """Calculus > Integrate by Parts: u is the part to differentiate; the integral is left
    unevaluated, as 5.5 shows it: u v - integral of v u'."""
    i = the_integral(e)
    lim = i.limits[0]
    x = lim[0]
    v = sp.integrate(sp.cancel(i.function / u), x)
    if v.has(sp.Integral):
        raise Unsupported("The rest cannot be integrated; try another part to differentiate")
    rest = sp.simplify(v * sp.diff(u, x))
    if len(lim) == 3:
        a, b = lim[1], lim[2]
        return sp.Add((u * v).subs(x, b) - (u * v).subs(x, a), -sp.Integral(rest, (x, a, b)), evaluate=False)
    return sp.Add(u * v, -sp.Integral(rest, x), evaluate=False)


def change_variable(e, eq):
    """Calculus > Change Variable: eq is u = g(x) (new variable u) or x = h(u)."""
    i = the_integral(e)
    x = i.limits[0][0]
    if not isinstance(eq, sp.Equality):
        raise Unsupported("Write it as u = g(x) or x = h(u)")
    if eq.lhs == x:
        return i.transform(x, eq.rhs)
    if isinstance(eq.lhs, sp.Symbol) and x in eq.rhs.free_symbols:
        return i.transform(eq.rhs, eq.lhs)
    raise Unsupported("The left side must be the new variable u (u = g(x)) or the variable of integration (x = h(u))")


def approximate_integral(e, method, n):
    """Calculus > Approximate Integral: left, midpoint, right, trapezoid or Simpson with n
    subintervals of a definite integral."""
    i = the_integral(e)
    if len(i.limits[0]) != 3:
        raise Unsupported("Needs an integral with limits")
    x, a, b = i.limits[0]
    n = int(n)
    if n < 1 or (method == "simpson" and n % 2):
        raise Unsupported("Simpson's rule needs a positive even number of subintervals" if method == "simpson" else "The number of subintervals must be a positive integer")
    h = (b - a) / n
    f = lambda t: i.function.subs(x, t)  # noqa: E731
    if method == "left":
        r = h * sp.Add(*[f(a + k * h) for k in range(n)])
    elif method == "right":
        r = h * sp.Add(*[f(a + k * h) for k in range(1, n + 1)])
    elif method == "midpoint":
        r = h * sp.Add(*[f(a + (k + sp.Rational(1, 2)) * h) for k in range(n)])
    elif method == "trapezoid":
        r = h / 2 * (f(a) + 2 * sp.Add(*[f(a + k * h) for k in range(1, n)]) + f(b))
    elif method == "simpson":
        r = h / 3 * (f(a) + f(b) + sp.Add(*[(4 if k % 2 else 2) * f(a + k * h) for k in range(1, n)]))
    else:
        raise Unsupported(method)
    return sp.N(r, 10)


def iterate(e, start, count):
    """Calculus > Iterate: x0, f(x0), f(f(x0)), ... (count steps), as a column."""
    f = last_side(e).doit()
    x = main_variable(f)
    count = int(count)
    if count < 1 or count > 1000:
        raise Unsupported("The number of steps must be 1 to 1000")
    values, v = [start], start
    for _ in range(count):
        v = f.subs(x, v)
        v = sp.nsimplify(v) if v.is_Rational else v
        values.append(v)
    return sp.Matrix(values)


def integer_solutions(e):
    """Solve > Integer: integer solutions (one variable: the integer roots; several:
    Diophantine equations, with parameters t_0, t_1 ...)."""
    eq = e if isinstance(e, sp.Equality) else sp.Eq(e, 0)
    f = sp.expand(eq.lhs - eq.rhs)
    variables = sorted(f.free_symbols, key=str)
    if len(variables) == 1:
        x = variables[0]
        return [[(x, r)] for r in sp.solve(f, x) if r.is_integer]
    found = sp.diophantine(f, syms=variables)
    return [list(zip(variables, s)) for s in sorted(found, key=str)]


def items_json(j):
    """The entries of a list or matrix (MathJSON), row by row; anything else is one item."""
    if isinstance(j, list) and j and j[0] == "Matrix":
        j = j[1]
    if isinstance(j, list) and j and j[0] == "List":
        out = []
        for r in j[1:]:
            out.extend(items_json(r) if isinstance(r, list) and r[:1] == ["List"] else [r])
        return out
    return [j]


SUBSCRIPTED = re.compile(r"^([A-Za-z])_(\w+)$")


def sequence_form(j):
    """a_{n+1} and a_n -> a(n+1), a(n): the unknown sequence written as a function."""
    if isinstance(j, str):
        m = SUBSCRIPTED.match(j)
        if m:
            idx = m.group(2)
            return [m.group(1), int(idx) if idx.isdigit() else idx]
        return j
    if isinstance(j, list) and j:
        if j[0] == "Subscript" and isinstance(j[1], str) and len(j[1]) == 1:
            return [j[1], sequence_form(j[2])]
        return [j[0]] + [sequence_form(x) for x in j[1:]]
    return j


def solve_recursion(eqs):
    """Solve > Recursion: a recurrence (a_{n+1} = 2a_n + 1), with starting values (a_0 = 1)
    as more equations in a column."""
    eqs = [q if isinstance(q, sp.Equality) else sp.Eq(q, 0) for q in eqs]
    seqs = set()
    for q in eqs:
        seqs |= {f for f in q.atoms(sp.Function) if isinstance(f.func, sp.core.function.UndefinedFunction)}
    general = [q for q in eqs if any(a.free_symbols for f in q.atoms(sp.Function) for a in f.args)]
    if not general:
        raise Unsupported("Needs a recurrence, for example a_{n+1} = 2a_n + 1")
    rec = general[0]
    fs = [f for f in rec.atoms(sp.Function) if isinstance(f.func, sp.core.function.UndefinedFunction)]
    a = fs[0].func
    n = sorted(set().union(*[f.free_symbols for f in fs]), key=str)[0]
    init = {}
    for q in eqs:
        if q is rec:
            continue
        if isinstance(q.lhs, sp.Function) and q.lhs.func == a and q.lhs.args[0].is_Integer:
            init[q.lhs] = q.rhs
    r = sp.rsolve(rec.lhs - rec.rhs, a(n), init or None)
    if r is None:
        raise Unsupported("This recursion cannot be solved")
    return sp.Eq(a(n), r)


# Simplex (linear programming); the variables are taken as nonnegative, as in 5.5

def lp_parts(items):
    """[objective, constraint, ...] -> (objective, constraints including x >= 0)."""
    if len(items) < 2:
        raise Unsupported("Put the objective in the first row and one constraint in each row below")
    obj, cons = items[0], items[1:]
    if not all(isinstance(c, (sp.LessThan, sp.GreaterThan, sp.StrictLessThan, sp.StrictGreaterThan, sp.Equality)) for c in cons):
        raise Unsupported("Constraints must use ≤, ≥ or =")
    variables = sorted(set().union(obj.free_symbols, *[c.free_symbols for c in cons]), key=str)
    return obj, list(cons) + [v >= 0 for v in variables], variables


def lp_optimum(items, maximize):
    from sympy.solvers.simplex import lpmax, lpmin, InfeasibleLPError, UnboundedLPError
    obj, cons, variables = lp_parts(items)
    try:
        value, point = (lpmax if maximize else lpmin)(obj, cons)
    except InfeasibleLPError:
        raise Unsupported("The constraints have no common solution (infeasible)")
    except UnboundedLPError:
        raise Unsupported("No maximum" if maximize else "No minimum")
    parts = [f"{tex(v)}={tex(point.get(v, 0))}" for v in variables]
    parts.append(("\\text{maximum}" if maximize else "\\text{minimum}") + "=" + tex(value))
    return ", ".join(parts)


def lp_feasible(items):
    from sympy.solvers.simplex import lpmin, InfeasibleLPError, UnboundedLPError
    _, cons, _ = lp_parts(items)
    try:
        lpmin(sp.Integer(0), cons)
    except InfeasibleLPError:
        return False
    except UnboundedLPError:
        return True
    return True


def lp_standard(items):
    """Simplex > Standardize: every constraint as  (linear part) <= number."""
    obj, cons, _ = lp_parts(items)
    out = [obj]
    for c in cons[:len(items) - 1]:
        lhs = sp.expand(c.lhs - c.rhs)
        const = lhs.as_coeff_Add()[0] if lhs.as_coeff_Add()[0].is_number else 0
        lin = lhs - const
        if isinstance(c, (sp.GreaterThan, sp.StrictGreaterThan)):
            out.append(sp.Le(-lin, const))
        elif isinstance(c, sp.Equality):
            out += [sp.Le(lin, -const), sp.Le(-lin, const)]
        else:
            out.append(sp.Le(lin, -const))
    return out


def lp_dual(items):
    """Simplex > Dual: the dual of 'maximize c.x with A x <= b, x >= 0':
    minimize b.y with A^T y >= c, y >= 0 (variables y_1, y_2, ...)."""
    std = lp_standard(items)
    obj, cons = std[0], std[1:]
    variables = sorted(set().union(obj.free_symbols, *[c.free_symbols for c in cons]), key=str)
    A = sp.Matrix([[sp.expand(c.lhs).coeff(v) for v in variables] for c in cons])
    b = sp.Matrix([c.rhs for c in cons])
    cvec = sp.Matrix([sp.expand(obj).coeff(v) for v in variables])
    ys = sp.Matrix(sp.symbols(f"y_1:{len(cons) + 1}"))
    out = [(b.T * ys)[0]]
    for k in range(len(variables)):
        out.append(sp.Ge((A[:, k].T * ys)[0], cvec[k]))
    return out


def column(items):
    """Several formulas (constraints, equations ...) as one column, as 5.5 writes them."""
    return "\\begin{pmatrix}" + "\\\\".join(tex(x) for x in items) + "\\end{pmatrix}"


# Vector calculus, in the basis variables (x, y, z unless set otherwise)

def vector(e):
    e = last_side(e)
    if isinstance(e, (list, sp.Tuple)):
        e = sp.Matrix(list(e))
    if not isinstance(e, sp.MatrixBase):
        raise Unsupported("Needs a vector (a one-row or one-column matrix)")
    return list(e)


def potential(F, xs):
    """A scalar potential phi with grad phi = F (F must have curl 0)."""
    if len(F) != len(xs):
        raise Unsupported(f"The vector needs {len(xs)} components (as many as the basis variables)")
    for i in range(len(xs)):
        for j in range(i + 1, len(xs)):
            if sp.simplify(sp.diff(F[i], xs[j]) - sp.diff(F[j], xs[i])) != 0:
                raise Unsupported("This vector field has no scalar potential (its curl is not 0)")
    phi = sp.Integer(0)
    for i, v in enumerate(xs):
        phi += sp.integrate(sp.simplify(F[i] - sp.diff(phi, v)), v)
    return sp.simplify(phi)


def vector_potential(F, xs):
    """A with curl A = F (F must have divergence 0); A_z = 0."""
    if len(xs) != 3 or len(F) != 3:
        raise Unsupported("Vector potentials are three-dimensional only")
    x, y, z = xs
    if sp.simplify(sum(sp.diff(F[i], xs[i]) for i in range(3))) != 0:
        raise Unsupported("This vector field has no vector potential (its divergence is not 0)")
    t = sp.Dummy("t")
    ax = sp.integrate(F[1].subs(z, t), (t, 0, z)) - sp.integrate(F[2].subs({y: t, z: 0}), (t, 0, y))
    ay = -sp.integrate(F[0].subs(z, t), (t, 0, z))
    return sp.Matrix([sp.simplify(ax), sp.simplify(ay), 0])


def vector_op(op, e, xs):
    if op == "gradient":
        f = last_side(e).doit()
        return sp.Matrix([sp.diff(f, v) for v in xs])
    if op == "laplacian":
        f = last_side(e).doit()
        return sp.simplify(sum(sp.diff(f, v, 2) for v in xs))
    if op == "hessian":
        return sp.hessian(last_side(e).doit(), xs)
    if op == "wronskian":
        fs = vector(e)
        return sp.simplify(sp.wronskian(fs, main_variable(sp.Add(*fs))))
    F = vector(e)
    if op == "divergence":
        if len(F) != len(xs):
            raise Unsupported(f"The vector needs {len(xs)} components (as many as the basis variables)")
        return sp.simplify(sum(sp.diff(F[i], xs[i]) for i in range(len(xs))))
    if op == "curl":
        if len(F) != 3 or len(xs) != 3:
            raise Unsupported("Curl is three-dimensional only")
        (P, Q, R), (x, y, z) = F, xs
        return sp.Matrix([sp.diff(R, y) - sp.diff(Q, z), sp.diff(P, z) - sp.diff(R, x), sp.diff(Q, x) - sp.diff(P, y)])
    if op == "jacobian":
        return sp.Matrix(F).jacobian(xs)
    if op == "potential":
        return potential(F, xs)
    if op == "vectorpotential":
        return vector_potential(F, xs)
    raise Unsupported(op)


VECTOR_OPS = {"gradient", "divergence", "curl", "laplacian", "hessian", "jacobian", "wronskian", "potential", "vectorpotential"}
PARAM_OPS = {"byparts", "changevar", "approxint", "iterate"} | VECTOR_OPS
LIST_OPS = {"recursion", "maximize", "minimize", "feasible", "standardize", "dual"}


def compute_more(op, j, params):
    """The operations above -> the same JSON answers as compute()."""
    if op in LIST_OPS:
        if op == "recursion":
            eqs = [build(x) for x in items_json(sequence_form(j))]
            return {"kind": "solutions", "solutions": [tex(solve_recursion(eqs))]}
        items = [apply_definitions(build(x)) for x in items_json(j)]
        if op in ("maximize", "minimize"):
            return {"kind": "solutions", "solutions": [lp_optimum(items, op == "maximize")]}
        if op == "feasible":
            return {"kind": "text", "text": " (feasible)" if lp_feasible(items) else " (infeasible: the constraints have no common solution)"}
        label = ", standard form: " if op == "standardize" else ", dual problem (minimize, all y ≥ 0): "
        return {"kind": "solutions", "label": label, "solutions": [column(lp_standard(items) if op == "standardize" else lp_dual(items))]}
    e = apply_definitions(build(j))
    ps = [build(p) if not isinstance(p, str) or p[:1] != "'" else p.strip("'") for p in params]
    if op in VECTOR_OPS:
        xs = [p for p in ps if isinstance(p, sp.Symbol)] or [variable(n) for n in "xyz"]
        return {"kind": "value", "latex": tex(vector_op(op, e, xs))}
    if op == "byparts":
        return {"kind": "value", "latex": tex(by_parts(e, ps[0]))}
    if op == "changevar":
        return {"kind": "value", "latex": tex(change_variable(e, ps[0]))}
    if op == "approxint":
        return {"kind": "value", "latex": tex(approximate_integral(e, ps[0], ps[1]))}
    if op == "iterate":
        return {"kind": "value", "latex": tex(iterate(e, ps[0], ps[1]))}
    raise Unsupported(op)


# operations whose params choose what 5.5 asks in a dialog: the variable, the order, the unknowns
OPTION_OPS = {"series", "differentiate", "integrate", "solve", "numericsolve", "pade", "partialfractions"}


def with_options(op, e, ps, words=()):
    symbols = [p for p in ps if isinstance(p, sp.Symbol)]
    numbers = [p for p in ps if not isinstance(p, sp.Symbol)]
    var = symbols[0] if symbols else None
    if op == "series":  # params: [variable, number of terms, point]
        terms = int(numbers[0]) if numbers else 5
        point = numbers[1] if len(numbers) > 1 else 0
        return {"kind": "value", "latex": tex(power_series(e, var, terms, point))}
    if op == "differentiate":  # params: [variable, times]
        v = var or main_variable(last_side(e))
        return {"kind": "value", "latex": tex(sp.diff(last_side(e).doit(), v, int(numbers[0]) if numbers else 1))}
    if op == "partialfractions":  # params: [variable]
        return {"kind": "value", "latex": tex(partial_fractions(e, var))}
    if op == "integrate":  # params: [variable]
        return {"kind": "value", "latex": tex(integrate(last_side(e).doit(), var or main_variable(last_side(e))))}
    if op == "pade":  # params: [m, n, variable, point]
        if len(numbers) < 2:
            raise Unsupported("Give the degrees m and n of [m/n]")
        return {"kind": "value", "latex": tex(pade(e, numbers[0], numbers[1], var, numbers[2] if len(numbers) > 2 else 0))}
    # solve, numericsolve: params are the unknowns (and the word 'principal': Principal Value Only)
    if op == "solve":
        return solve_answer(e, symbols or None, "principal" in words)
    sols = solve_numeric(e, symbols or None)
    return {"kind": "solutions", "solutions": [", ".join(solution_tex(v, x) for v, x in s) for s in sols]}


def solve_answer(e, unknowns=None, principal=False):
    if matrix_equation(e) and not unknowns:
        # A x = b: 5.5 answers with the vector of the unknowns, in the order they are written
        unknowns = [sp.Symbol(n) for n in NAMES if sp.Symbol(n) in e.free_symbols]
        sols = [dict(s) for s in solve(e, unknowns, principal)]
        # an unknown left free is a parameter, named as 5.5 names it: \\hat{t}_3 for the third
        free = [{v: sp.Symbol("that_%d" % (i + 1)) for i, v in enumerate(unknowns) if v not in s} for s in sols]
        return {"kind": "solutions", "solutions": [tex(sp.ImmutableMatrix([s.get(v, v) for v in unknowns]).xreplace(f)) for s, f in zip(sols, free)]}
    sols = solve(e, unknowns, principal)
    if len({v for s in sols for v, x in s}) == 1 and all(len(s) == 1 for s in sols):
        # one unknown: its values alone, as 5.5 writes them (Solution is: 1, 2), sets and families too
        return {"kind": "solutions", "solutions": [tex(s[0][1]) for s in sols]}
    return {"kind": "solutions", "solutions": [", ".join(solution_tex(v, x) for v, x in s) for s in sols]}


OPERATIONS = {
    "evaluate": evaluate,
    "numeric": evaluate_numerically,
    "simplify": simplify,
    "expand": expand,
    "factor": factor,
    "determinant": lambda e: det(sp.Matrix(last_side(e))),
    "inverse": lambda e: sp.Matrix(last_side(e)).inv(),
    "transpose": lambda e: sp.Matrix(last_side(e)).T,
    "eigenvalues": lambda e: sp.Matrix(last_side(e)).eigenvals(),
    # Polynomials
    "partialfractions": lambda e: partial_fractions(e),
    "collect": lambda e: sp.collect(sp.expand(last_side(e).doit()), main_variable(last_side(e))),
    "combine": combine,
    "rewrite_exp": rewrite_exp,
    "rewrite_sincos": rewrite_sincos,
    # Calculus
    "series": power_series,
    "pade": lambda e: pade(e, 2, 2),
    "differentiate": lambda e: sp.diff(last_side(e).doit(), main_variable(last_side(e))),
    "integrate": lambda e: integrate(last_side(e).doit(), main_variable(last_side(e))),
    "laplace": laplace,
    "inverselaplace": inverse_laplace,
    "fourier": fourier,
    # Matrices
    "rank": lambda e: matrix_of(e).rank(),
    "rref": lambda e: matrix_of(e).rref()[0],
    "nullspace": lambda e: sp.Matrix.hstack(*matrix_of(e).nullspace()) if matrix_of(e).nullspace() else sp.Matrix([0]),
    "trace": lambda e: matrix_of(e).trace(),
    "charpoly": lambda e: matrix_of(e).charpoly(sp.Symbol("X")).as_expr(),
    "adjugate": lambda e: matrix_of(e).adjugate(),
    # Statistics (a row or column of numbers)
    "mean": lambda e: sp.nsimplify(mean(numbers(e))),
    "median": lambda e: median(numbers(e)),
    "variance": lambda e: sp.nsimplify(variance(numbers(e))),
    "stddev": lambda e: sp.sqrt(sp.nsimplify(variance(numbers(e)))),
}


# op -> function(request) -> the answer (a dict as compute() returns): the request is the MathJSON,
# or {"expr": MathJSON, "params": [...]} when the menu item asks for more (see the parts at the end)
EXTRA_OPS = {}
EXTRA_OPS["laplace"] = transform_answer("laplace", **{"label": ", Laplace transform is: "})
EXTRA_OPS["inverselaplace"] = transform_answer("inverselaplace", **{"label": ", Is Laplace transform of "})
EXTRA_OPS["fourier"] = transform_answer("fourier", **{"label": ", Fourier transform is: "})

# operations done entry by entry on a matrix
ELEMENTWISE = {"numeric", "simplify", "expand", "factor", "partialfractions", "collect", "combine", "rewrite_exp", "rewrite_sincos"}

def shown_float(v):
    """A decimal as 5.5 shows it (5 significant digits shown): a number of at most 5 digits as
    it is (0.2, 3.0, 15625.0), others rounded to 5 digits (22.460); below 0.1 or from 10^5 on
    as d.dddd x 10^k (6.8068 x 10^{-2})."""
    from decimal import Decimal
    d = Decimal(str(sp.Float(v, 10)))  # the number as computed, to 10 digits
    if not d.is_finite():
        return str(d)
    if d == 0:
        return "0.0"
    exact = len(d.normalize().as_tuple().digits) <= 5
    k = Decimal(format(d, ".4e")).adjusted()  # the power of 10 after rounding
    if -1 <= k < 5:
        s = format(d.normalize(), "f") if exact else format(d, ".%df" % (4 - k))
        return s if "." in s else s + ".0"
    m = format(d, ".4e").split("e")[0]
    if exact:
        m = m.rstrip("0")
        m = m + "0" if m.endswith(".") else m
    return "%s\\times 10^{%d}" % (m, k)


def negative_power(f):
    """a^{-y}: written as 1/a^y (not e^{-x})"""
    return f.is_Pow and f.base != sp.E and not f.exp.is_number and f.exp.could_extract_minus_sign()


class Printer(LatexPrinter):
    def _print_Float(self, expr):
        return shown_float(expr)

    # true, false and undefined written as in 5.5
    def _print_BooleanTrue(self, expr):
        return "true"

    def _print_BooleanFalse(self, expr):
        return "false"

    def _print(self, expr, **kwargs):
        # (NaN prints itself, so it is caught here)
        return "\\operatorname{undefined}" if expr is sp.nan else super()._print(expr, **kwargs)

    def _print_Pow(self, expr):
        if negative_power(expr):
            return r"\frac{1}{%s}" % self._print(1 / expr)
        return super()._print_Pow(expr)

    def _print_Mul(self, expr):
        # a^x a^{-y}, 2^{-n} n^2: as a fraction, as 5.5 writes them (e^{-x} stays)
        if any(negative_power(f) for f in expr.args):
            num, den = sp.fraction(expr)
            return r"\frac{%s}{%s}" % (self._print(num), self._print(den))
        # a fraction times the rest is written first, as 5.5 does: \\frac{1}{2}\\sqrt{2}, \\frac{3}{2}\\pi
        c, rest = expr.as_coeff_Mul()
        if c.is_Rational and not c.is_Integer and rest is not sp.S.One and sp.fraction(rest, exact=True)[1] == 1:
            from sympy.printing.precedence import PRECEDENCE
            return "%s\\frac{%d}{%d} %s" % ("- " if c < 0 else "", abs(c.p), c.q, self.parenthesize(rest, PRECEDENCE["Mul"], strict=True))
        return super()._print_Mul(expr)

    def _print_Function(self, expr, exp=None):
        if exp is not None and isinstance(expr.func, sp.core.function.UndefinedFunction):
            return r"\left(%s\right)^{%s}" % (self._print(expr), exp)  # (g(x))^2, as 5.5 (not g^2(x))
        return self._bare(expr, exp) or super()._print_Function(expr, exp)

    def _print_Derivative(self, expr):
        # f'(g(x)): the derivative of f at g(x), from the chain rule (SymPy: d/dg(x) f(g(x)))
        f = expr.expr
        if (isinstance(f.func, sp.core.function.UndefinedFunction) and len(f.args) == 1 and not f.args[0].is_Symbol
                and all(v == f.args[0] for v, _ in expr.variable_count)):
            return r"%s^{%s}\left(%s\right)" % (self._print(sp.Symbol(f.func.__name__)), r"\prime " * expr.derivative_count, self._print(f.args[0]))
        return super()._print_Derivative(expr)

    def _print_log(self, expr, exp=None):
        return self._bare(expr, exp) or super()._print_log(expr, exp)

    def _bare(self, expr, exp):
        # sin x, \\ln x, \\cos \\frac{2}{9}\\pi without brackets, as 5.5; brackets for a sum, a minus sign
        # or a function inside (and where the next factor could be read as part of it, see tex())
        name = WITHOUT_BRACKETS.get(expr.func)
        if name and len(expr.args) == 1:
            u = expr.args[0]
            head = name + ("^{%s}" % exp if exp else "")
            if not (u.has(sp.Add, sp.Function, sp.Integral, sp.Sum, sp.Product, sp.Derivative, sp.Limit) or u.could_extract_minus_sign()):
                return "%s\x01%s\x02" % (head, self._print(u))
            return "%s\\left(%s\\right)" % (head, self._print(u))
        return None


class CommonLog(sp.Function):
    """log(x)/log(10) as it is shown with the log base set to 10 (5.5: \\log_{10} x); for tex() only."""


WITHOUT_BRACKETS = {f: "\\" + f.__name__ for f in (sp.sin, sp.cos, sp.tan, sp.cot, sp.sec, sp.csc, sp.sinh, sp.cosh, sp.tanh, sp.coth)}
WITHOUT_BRACKETS[CommonLog] = "\\log_{10}"
WITHOUT_BRACKETS.update({sp.log: "\\ln", sp.asin: "\\arcsin", sp.acos: "\\arccos", sp.atan: "\\arctan"})
WITHOUT_BRACKETS.update({f: "\\operatorname{arc%s}" % f.__name__[1:] for f in (sp.asinh, sp.acosh, sp.atanh)})
# what may follow \\sin x without being read as part of its argument
ENDS_ARGUMENT = re.compile(r"\s*($|[-+=,)}\]&]|\\\\|\\,|\\right|\\end|\\(sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|coth|ln|arcsin|arccos|arctan|operatorname\{arc(sinh|cosh|tanh)\})(?![A-Za-z]))")


def brackets(latex):
    """The marked arguments of tex()'s functions: \\sin x where nothing could join the argument,
    \\sin\\left(x\\right) where something follows (\\sin x y would be read as sin(xy))."""
    out, i = [], 0
    for m in re.finditer("\x01([^\x01\x02]+)\x02", latex):
        out.append(latex[i:m.start()])
        out.append(" " + m.group(1) if ENDS_ARGUMENT.match(latex, m.end()) else "\\left(" + m.group(1) + "\\right)")
        i = m.end()
    out.append(latex[i:])
    return "".join(out)


class Printer55(Printer):
    """Dirac and Heaviside written as 5.5 writes them (and as opensw reads them back)."""

    def _print_DiracDelta(self, e, exp=None):
        if len(e.args) > 1:
            return super()._print_DiracDelta(e, exp)
        t = r"\operatorname{Dirac}\left(%s\right)" % self._print(e.args[0])
        return t if exp is None else r"%s^{%s}" % (t, exp)

    def _print_Symbol(self, e, style="plain"):
        if e.name.endswith("'"):  # y' (see build)
            base = e.name.rstrip("'")
            return r"%s^{%s}" % (super()._print_Symbol(sp.Symbol(base), style), r"\prime " * (len(e.name) - len(base)))
        if e in UNIT_SYMBOLS:  # a unit: \mathrm{ft}, \mu\mathrm{m}, \mathrm{k}\Omega
            name = e.name[5:]
            mu = name.startswith("mu")
            name = name[2:] if mu else name
            ohm = name.endswith("Ohm")
            name = name[:-3] if ohm else name
            return (r"\mu " if mu else "") + (r"\mathrm{%s}" % name if name else "") + (r"\Omega " if ohm else "")
        out = super()._print_Symbol(e, style)
        # a name of several letters (5.5's math names du, dx, century): upright, read back as one name
        return r"\operatorname{%s}" % out if re.fullmatch(r"[A-Za-z]{2,}", out) else out

    def _print_Piecewise(self, e):
        """Cases as 5.5 writes them (and opensw reads them back): value & if & condition; the last
        case's "otherwise" as the condition it stands for."""
        rows, before = [], []
        for value, cond in e.args:
            if cond == sp.true and before:
                cond = sp.And(*[sp.Not(c) for c in before])
            rows.append(r"%s & \text{if} & %s" % (self._print(value), self._print(cond)))
            before.append(cond)
        return r"\left\{ \begin{array}{ccc} %s \end{array}\right." % r" \\ ".join(rows)

    def _print_Order(self, e):  # O((x - 1)^3), without SymPy's "; x -> 1"
        return r"O\left(%s\right)" % self._print(e.expr)

    def _print_Heaviside(self, e, exp=None):
        t = r"\operatorname{Heaviside}\left(%s\right)" % self._print(e.args[0])
        return t if exp is None else r"%s^{%s}" % (t, exp)

    def _airy(self, name, n, e, exp):  # AiryAi(z, 0), AiryAi(z, 1) for the derivative, as 5.5
        t = r"\operatorname{%s}\left(%s,%d\right)" % (name, self._print(e.args[0]), n)
        return t if exp is None else r"%s^{%s}" % (t, exp)

    def _print_airyai(self, e, exp=None):
        return self._airy("AiryAi", 0, e, exp)

    def _print_airybi(self, e, exp=None):
        return self._airy("AiryBi", 0, e, exp)

    def _print_airyaiprime(self, e, exp=None):
        return self._airy("AiryAi", 1, e, exp)

    def _print_airybiprime(self, e, exp=None):
        return self._airy("AiryBi", 1, e, exp)


def tex(x):
    """LaTeX as Scientific Word shows it (matrices in the brackets of the question, else parentheses)."""
    # f{\left(x \right)} -> f(x): a function applied to simple arguments, as it is typed
    if isinstance(x, sp.Basic) and x.has(sp.Indexed):  # a_{3} from a sum: the name a_3, as typed
        x = x.replace(lambda y: isinstance(y, sp.Indexed) and all(i.is_Integer for i in y.indices),
                      lambda y: sp.Symbol("%s_%s" % (y.base, "".join(str(i) for i in y.indices))))
    if STYLE["log10"] and isinstance(x, sp.Basic):  # the log base set to 10: log(x)/log(10) is \\log_{10} x
        over = sp.Pow(sp.log(10), -1)
        terms = lambda y: sp.Add.make_args(sp.Mul(*[f for f in y.args if f != over]))  # noqa: E731
        one_log = lambda t: sum(isinstance(f, sp.log) for f in sp.Mul.make_args(t)) == 1  # noqa: E731
        x = x.replace(lambda y: y.is_Mul and over in y.args and all(one_log(t) for t in terms(y)),
                      lambda y: sp.Add(*[sp.Mul(*[CommonLog(f.args[0]) if isinstance(f, sp.log) else f for f in sp.Mul.make_args(t)]) for t in terms(y)]))
    latex = Printer55({"mat_delim": answer_delim(), "ln_notation": True}).doprint(x)
    t = brackets(re.sub(r"([A-Za-z])\{\\left\(([^{}()]*?) \\right\)\}", r"\1(\2)", latex))
    return t.replace(r"\text{NaN}", r"\text{undefined}")  # as 5.5 says it


def plot_points(expr, var, a, b, n):
    """y values of expr at n+1 equally spaced x in [a, b] (None where it has no real value).

    Formulas with an integral (e.g. 1 + integral from 0 to x) are evaluated point by point
    with SymPy's numerical integration; others are turned into one fast mpmath function.
    """
    xs = [a + (b - a) * i / n for i in range(n + 1)]
    if expr.has(sp.Integral, sp.Sum, sp.Product, sp.Limit, sp.Derivative):
        f = lambda v: expr.subs(var, v).evalf(15)  # noqa: E731
    else:
        g = sp.lambdify(var, expr, modules="mpmath")
        f = lambda v: g(sp.Float(v, 15))  # noqa: E731
    ys = []
    for v in xs:
        try:
            y = complex(f(v))
            ys.append(y.real if abs(y.imag) < 1e-12 * max(1.0, abs(y.real)) and y.real == y.real and abs(y.real) != float("inf") else None)
        except Exception:  # outside the domain (log of a negative number, division by 0 ...)
            ys.append(None)
    return xs, ys


def plot_grid(expr, xv, yv, a, b, c, d, n, m):
    """z values of expr(x, y) on an (n+1) x (m+1) grid over [a, b] x [c, d] (None where it
    has no real value); z[i][j] is at x_i, y_j."""
    g = sp.lambdify((xv, yv), expr, modules="mpmath")
    xs = [a + (b - a) * i / n for i in range(n + 1)]
    ys = [c + (d - c) * j / m for j in range(m + 1)]
    zs = []
    for x in xs:
        row = []
        for y in ys:
            try:
                z = complex(g(sp.Float(x, 15), sp.Float(y, 15)))
                row.append(z.real if abs(z.imag) < 1e-12 * max(1.0, abs(z.real)) and z.real == z.real and abs(z.real) != float("inf") else None)
            except Exception:  # outside the domain
                row.append(None)
        zs.append(row)
    return xs, ys, zs


def real_or_none(v):
    z = complex(v)
    return z.real if abs(z.imag) < 1e-12 * max(1.0, abs(z.real)) and z.real == z.real and abs(z.real) != float("inf") else None


def plot_values(exprs, vs, ranges, ns, grad=False, cplx=None):
    """Values of each expression on the grid of the variables vs (n+1 points over each
    range), the last variable running fastest. grad: the partial derivatives of the one
    expression instead. cplx: the name of a complex variable z = x + iy (vs are x, y);
    then the real and imaginary parts of the one expression (conformal plots)."""
    import itertools
    if grad:
        exprs = [sp.diff(exprs[0], v) for v in vs]
    if cplx:
        e = exprs[0].subs(variable(cplx), vs[0] + sp.I * vs[1])
        exprs = [e]
    axes = [[a + (b - a) * i / n for i in range(n + 1)] for (a, b), n in zip(ranges, ns)]
    fs = [sp.lambdify(vs, e, modules="mpmath") for e in exprs]
    out = [[] for _ in (fs * 2 if cplx else fs)]
    for p in itertools.product(*axes):
        args = [sp.Float(x, 15) for x in p]
        for k, f in enumerate(fs):
            try:
                v = f(*args)
                if cplx:
                    z = complex(v)
                    ok = z == z and abs(z) != float("inf")
                    out[0].append(z.real if ok else None)
                    out[1].append(z.imag if ok else None)
                else:
                    out[k].append(real_or_none(v))
            except Exception:  # outside the domain
                out[k].append(None)
                if cplx:
                    out[1].append(None)
    return axes, out


def first_order_system(eq_jsons, inits_in):
    """Equations of any order (y' = f(x, y), y'' + y = 0, or a system) and the initial values
    ([[name, x0, value(, order of the derivative)], ...], MathJSON numbers: y(0) = 1, y'(0) = 0)
    -> (unknowns, the variable, F(x, *state) -> the state's derivatives as floats, x0, the
    initial state, the place of each unknown in the state). An equation of order n in y is
    solved for y^(n); the state is y, y', ..., y^(n-1) of each unknown, so it needs those n
    initial values. The variable is the one the derivatives are taken in (dy/dt), else the one
    other name in the equations (y' = sin xy), else x (t when x is an unknown, as 5.5)."""
    names = {i[0] for i in inits_in}
    found = symbol_names(["List", *eq_jsons]) - names - set(CONSTANTS)
    eqs = [build(x) for x in ode_form(["List", *eq_jsons], names, found.pop() if len(found) == 1 else None)[1:]]
    highest, var = {}, None
    for e in eqs:
        if not isinstance(e, sp.Equality):
            raise Unsupported("The equation must be y' = f(x, y)")
        ds = list(e.atoms(sp.Derivative))
        if not ds:
            raise Unsupported("The equation needs a derivative, e.g. y'")
        top = max(d.derivative_count for d in ds)
        d = [d for d in ds if d.derivative_count == top]
        if len(d) > 1 or len({x.variables[0] for x in ds}) > 1:
            raise Unsupported("Each equation needs one highest derivative, e.g. y'' = -y")
        d = d[0]
        var = d.variables[0]
        f = d.expr.func
        if f in highest:
            raise Unsupported("Each unknown function needs one equation and one initial value")
        sol = sp.solve(e, d)
        if len(sol) != 1:
            raise Unsupported("Cannot solve " + str(d))
        highest[f] = (top, sol[0])
    inits = {}
    for i in inits_in:
        name, x0, v, k = (*i, 0) if len(i) == 3 else i
        inits[(sp.Function(name), int(k))] = (float(build(x0).evalf()), float(build(v).evalf()))
    funcs = sorted(highest, key=str)
    state = [(f, k) for f in funcs for k in range(highest[f][0])]
    if not funcs or set(state) != set(inits):
        needed = ", ".join(str(f) + "'" * k + "(x0)" for f, k in state)
        raise Unsupported("Each unknown function needs one equation and its initial values: " + needed)
    x0 = inits[state[0]][0]
    if any(inits[s][0] != x0 for s in state):
        raise Unsupported("The initial values must be at the same point")
    ys = [sp.Symbol("_y%d" % k) for k in range(len(state))]
    # the derivatives in the state, highest first (y'' before y' before y)
    put = sorted(((f(var).diff(var, k) if k else f(var), y) for (f, k), y in zip(state, ys)),
                 key=lambda p: -p[0].derivative_count if isinstance(p[0], sp.Derivative) else 0)
    rhs = []
    for j, (f, k) in enumerate(state):
        if k + 1 < highest[f][0]:
            rhs.append(ys[j + 1])
        else:
            r = highest[f][1]
            for a, y in put:
                r = r.subs(a, y)
            rhs.append(r)
    free = set().union(*(r.free_symbols for r in rhs)) - set(ys) - {var}
    if free:
        raise Unsupported("Variables without a value: " + ", ".join(sorted(str(x) for x in free)))
    return (funcs, var, sp.lambdify([var, *ys], rhs, modules="math"), x0, [inits[s][1] for s in state],
            [state.index((f, 0)) for f in funcs])


def symbol_names(j):
    """The names written in a MathJSON formula (not its heads or words)."""
    if isinstance(j, str):
        return set() if j.startswith("'") else {j}
    if isinstance(j, list):
        return set().union(set(), *(symbol_names(x) for x in j[1:]))
    return set()


def ode_points(eq_jsons, inits_in, a, b, n):
    """Plot 2D > ODE: equations (y' = f(x, y), y'' = f(x, y, y'), or a system), solved numerically
    from the initial values (classical Runge-Kutta, n steps over [a, b]).
    inits_in: [[name, x0, value(, order)], ...] (MathJSON numbers). -> (xs, {name: [values]}, var)"""
    funcs, var, F, x0, y0, at = first_order_system(eq_jsons, inits_in)

    def run(t0, y0, t1, steps):
        h = (t1 - t0) / steps if steps else 0
        ts, out, y, t = [t0], [list(y0)], list(y0), t0
        for _ in range(steps):
            try:
                k1 = F(t, *y)
                k2 = F(t + h / 2, *[a + h / 2 * k for a, k in zip(y, k1)])
                k3 = F(t + h / 2, *[a + h / 2 * k for a, k in zip(y, k2)])
                k4 = F(t + h, *[a + h * k for a, k in zip(y, k3)])
                y = [a + h / 6 * (p + 2 * q + 2 * r + s) for a, p, q, r, s in zip(y, k1, k2, k3, k4)]
            except (OverflowError, ZeroDivisionError, ValueError):
                y = [float("nan")] * len(y)
            t += h
            ts.append(t)
            out.append(y)
        return ts, out
    lo = max(0, min(n, round(n * (x0 - a) / (b - a)))) if b > a else 0
    back_t, back_y = run(x0, y0, a, lo) if x0 > a else ([], [])
    fwd_t, fwd_y = run(x0, y0, b, n - lo) if x0 < b else ([x0], [y0])
    ts = back_t[::-1][:-1] + fwd_t if back_t else fwd_t
    vals = back_y[::-1][:-1] + fwd_y if back_y else fwd_y
    clean = lambda v: v if v == v and abs(v) != float("inf") and abs(v) < 1e300 else None  # noqa: E731
    return ts, {str(f): [clean(v[at[k]]) for v in vals] for k, f in enumerate(funcs)}, str(var)


# Solve ODE > Numeric: an initial-value problem solved numerically; each unknown becomes a function
# that later computations evaluate and plot (5.5: "Functions defined: y")

# Dormand-Prince Runge-Kutta 5(4): the nodes, the stages, the 5th-order weights, and the
# difference of the 4th-order weights from them (the error estimate)
DP_C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1]
DP_A = [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
        [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]]
DP_B = DP_A[6] + [0]
DP_E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40]


class InitialValueProblem:
    """y' = F(t, y), y(t0) = y0, solved by steps whose error is kept within RTOL of the values (ATOL
    near 0). The points reached on each side of t0 are kept: values asked for in order (a plot)
    go on from the last one. Past a point the solution cannot be continued to (it grows without
    bound), the values are undefined (nan)."""
    RTOL, ATOL, MAX_STEPS = 1e-10, 1e-12, 200000

    def __init__(self, F, t0, y0):
        self.F, self.t0 = F, t0
        self.reached = {1: [(t0, list(y0))], -1: [(t0, list(y0))]}
        self.stop = {1: None, -1: None}

    def at(self, t):
        side = 1 if t >= self.t0 else -1
        if self.stop[side] is not None and (t - self.stop[side]) * side >= 0:
            return [float("nan")] * len(self.reached[1][0][1])
        pts = self.reached[side]
        k = max(i for i, (s, _) in enumerate(pts) if (t - s) * side >= 0)
        y = self.advance(*pts[k], t)
        if y is None:
            return self.at(t)
        if k == len(pts) - 1 and t != pts[k][0]:
            pts.append((t, y))
        return y

    def advance(self, t, y, t1):
        F, side, n = self.F, 1 if t1 >= t else -1, 0
        h = side * min(abs(t1 - t), 0.01 * max(1.0, abs(t1 - t)))
        while (t1 - t) * side > 0:
            n += 1
            if n > self.MAX_STEPS:
                raise Unsupported("The numerical solution needs too many steps here")
            if (t + h - t1) * side > 0:
                h = t1 - t
            try:
                k = []
                for c, a in zip(DP_C, DP_A):
                    k.append(F(t + c * h, *[yi + h * sum(aj * kj[i] for aj, kj in zip(a, k)) for i, yi in enumerate(y)]))
                y5 = [yi + h * sum(b * kj[i] for b, kj in zip(DP_B, k)) for i, yi in enumerate(y)]
                err = max(abs(h * sum(e * kj[i] for e, kj in zip(DP_E, k))) / (self.ATOL + self.RTOL * max(abs(yi), abs(zi)))
                          for i, (yi, zi) in enumerate(zip(y, y5)))
            except (OverflowError, ZeroDivisionError, ValueError, TypeError):  # a value too large, or not real
                err = float("inf")
            if err <= 1:
                t, y = t + h, y5
            h *= min(5.0, max(0.2, 0.9 * (err or 1e-10) ** -0.2)) if err == err and err != float("inf") else 0.2
            if abs(h) < 1e-13 * max(1.0, abs(t)):  # it cannot go on: blows up before t1
                self.stop[side] = t
                return None
        return y


class NumericSolution(sp.Function):
    """An unknown of Solve ODE > Numeric: y(1) is its value, y(x) stays y(x); a subclass for each
    (see numeric_ode), whose _imp_ gives the values to lambdify (plots)."""
    problem, index = None, 0

    @classmethod
    def eval(cls, t):
        if t.is_number and t.is_extended_real:
            v = cls.problem.at(float(t))[cls.index]
            return sp.Float(v, 15) if v == v and abs(v) != float("inf") else sp.nan
        return None


def numeric_ode(j):
    """Solve ODE > Numeric: ["OdeNumeric", ["List", equations], ["List", ["List", name, x0, value(, order)], ...]]
    -> the unknowns are defined as functions (5.5's answer: Functions defined: y)."""
    eqs, inits = j[1][1:], [x[1:] for x in j[2][1:]]
    for i in inits:  # defined again (y' is y's derivative, not that of the old y)
        DEFINITIONS.pop(i[0], None)
    funcs, var, F, x0, y0, at = first_order_system(eqs, inits)
    problem = InitialValueProblem(F, x0, y0)

    def initial(n, a, v, k=0):  # y'(0) = 1 as typed
        t = tex(sp.Eq(sp.Function(n)(build(a)), build(v)))
        return t.replace(n, n + "^{" + "\\prime" * k + "}", 1) if k else t
    shown = [tex(build(x)) for x in eqs] + [initial(*i) for i in inits]
    for k, f in enumerate(funcs):
        name = str(f)
        cls = type(name, (NumericSolution,), {"problem": problem, "index": at[k],
                                              "_imp_": staticmethod(lambda t, k=at[k]: problem.at(float(t))[k])})
        DEFINITIONS[name] = (sp.Function(name), cls)
        NUMERIC_SHOWN[name] = shown
    return {"kind": "solutions", "label": ", Functions defined: ", "solutions": [",".join(str(f) for f in funcs)]}


NUMERIC_SHOWN = {}  # name -> the equations that defined it (Show Definitions)


def apply_numeric(e):
    """y(2) of Solve ODE > Numeric in a formula to plot (other definitions are not put in there)."""
    for name, (key, value) in DEFINITIONS.items():
        if isinstance(value, type) and hasattr(e, "replace"):
            e = e.replace(key, value)
    return e


def numeric_functions(e, var):
    """y of Solve ODE > Numeric written alone in a formula to plot: the function of the plot's variable."""
    if not hasattr(e, "subs"):
        return e
    return e.subs({s: DEFINITIONS[s.name][1](var) for s in e.free_symbols
                   if s.name in DEFINITIONS and isinstance(DEFINITIONS[s.name][1], type)})


# ---------------------------------------------------------------------------
# Tools > Exam Builder: the values of a template's Setup sections and its formulas
# ---------------------------------------------------------------------------

def exam_random(kind, args, rng):
    """rand(), rand(n) in 0..n-1, rand(n, m) in n..m, rand({set}); randmat(rows, cols, type, (range))
    with type 1 any, 2 symmetric, 3 antisymmetric, 4 unimodular (as 5.5's Exam Builder)."""
    def pick(r):
        if isinstance(r, sp.FiniteSet):
            return rng.choice(list(r.args))
        if isinstance(r, (sp.Tuple, tuple, list)) and len(r) == 2:
            return sp.Integer(rng.randint(int(r[0]), int(r[1])))
        n = int(r[0] if isinstance(r, (sp.Tuple, tuple, list)) else r)
        if n < 1:
            raise Unsupported("The n in rand(n) must be a positive integer")
        return sp.Integer(rng.randrange(n))
    if kind == "rand":
        if not args:
            return sp.Integer(rng.randrange(10 ** 12))
        return pick(args[0] if len(args) == 1 else args[:2])
    rows, cols, typ = int(args[0]), int(args[1]), int(args[2])
    rng_of = args[3] if len(args) > 3 else (10,)
    if typ in (2, 3, 4) and rows != cols:
        raise Unsupported("Symmetric, antisymmetric and unimodular matrices must be square")
    m = sp.zeros(rows, cols)
    for i in range(rows):
        for j in range(cols):
            if typ == 1 or (typ == 2 and j >= i) or (typ == 3 and j > i):
                m[i, j] = pick(rng_of)
                if typ == 2:
                    m[j, i] = m[i, j]
                if typ == 3:
                    m[j, i] = -m[i, j]
    if typ == 4:  # lower and upper triangular with 1 on the diagonal: determinant 1
        lo, up = sp.eye(rows), sp.eye(rows)
        for i in range(rows):
            for j in range(i):
                lo[i, j] = pick(rng_of)
                up[j, i] = pick(rng_of)
        m = lo * up
    return m


EXAM_FUNCTION = object()  # marks a function of a Setup in env


def exam_value(j, env, rng):
    """MathJSON -> SymPy, with the variables of env (name -> (value, delayed MathJSON or None))
    and new random numbers for rand and randmat."""
    holes = {}

    def hole(v):
        # a whole number or a fraction goes in as itself, so gcd(u_1, u_2) and the like are worked
        # out with the values (a stand-in symbol would make gcd 1 before the values come in)
        if isinstance(v, sp.Integer):
            return int(v)
        if isinstance(v, sp.Rational):
            return ["Rational", int(v.p), int(v.q)]
        name = "_eb%d" % len(holes)
        holes[sp.Symbol(name)] = v
        return name

    def put(body, values):  # a function's body with its parameters replaced
        if isinstance(body, str):
            return values.get(body, body)
        return [put(x, values) for x in body] if isinstance(body, list) else body

    def walk(n):
        # e (or i) defined in a Setup is that variable, not the number e
        if n == "ExponentialE" and "e" in env:
            n = "e"
        elif n == "ImaginaryUnit" and "i" in env:
            n = "i"
        if isinstance(n, str) and n in env and env[n][0] is not EXAM_FUNCTION:
            value, delayed = env[n]
            return walk(delayed) if delayed is not None else hole(value)
        # f(x, n) = .. defined in a Setup (5.5: nplaces(x, n) = 1.0 floor(10^n x + .5)/10^n)
        if isinstance(n, list) and n and isinstance(n[0], str) and env.get(n[0], (None,))[0] is EXAM_FUNCTION:
            params, body = env[n[0]][1]
            return walk(put(body, dict(zip(params, [walk(x) for x in n[1:]]))))
        # distinct(a, b, c): no two of them equal (the Exam Builder's, for conditions)
        if isinstance(n, list) and n[:1] == ["distinct"]:
            vals = [sp.simplify(exam_value(x, env, rng)) for x in n[1:]]
            return "True" if all(sp.simplify(a - b) != 0 for i, a in enumerate(vals) for b in vals[i + 1:]) else "False"
        if isinstance(n, list) and n and n[0] in ("rand", "randmat"):
            # a range written (1, 9) is a pair of numbers
            args = [tuple(exam_value(y, env, rng) for y in x[1:]) if isinstance(x, list) and x[:1] in (["Tuple"], ["Pair"], ["Triple"], ["Delimiter"])
                    else exam_value(x, env, rng) for x in n[1:]]
            return hole(exam_random(n[0], args, rng))
        if isinstance(n, list):
            return [walk(x) for x in n]
        return n
    e = build(walk(j))
    return e.xreplace(holes) if holes and hasattr(e, "xreplace") else e


def exam_setup(statements, env, rng):
    """One Setup section: definitions (v := expr once, v = expr each time v is used) and
    conditions; new random numbers until the conditions hold."""
    for _ in range(500):
        mine = dict(env)
        for st in statements:
            if "cond" in st:
                continue
            if st.get("params") is not None:  # a function f(x) = ..
                mine[st["name"]] = (EXAM_FUNCTION, (st["params"], st["expr"]))
            elif st.get("delayed"):
                mine[st["name"]] = (None, st["expr"])
            else:
                mine[st["name"]] = (exam_value(st["expr"], mine, rng), None)
        if all(bool(exam_value(st["cond"], mine, rng)) is True for st in statements if "cond" in st):
            return mine
    raise Unsupported("The conditions are too hard to meet: 500 tries failed")


def exam_formula(f, env, rng):
    """\\FORMULA{expr}{..}{operation} of a generated exam -> LaTeX"""
    try:
        e = exam_value(f[0], env, rng)
        op = (f[1] if len(f) > 1 else "evaluate").lower()
        if op == "opensw-sample":  # GradeProc's answer for the online quiz: its values at 3 points
            e = e.doit() if hasattr(e, "doit") else e
            names = sorted(e.free_symbols, key=lambda x: x.name)
            points = [[0.5 + 0.37 * (k + 1) + 0.13 * i for i in range(len(names))] for k in range(3)]
            values = []
            for p in points:
                v = complex(sp.N(e.subs(dict(zip(names, p)))))
                values.append([v.real, v.imag])
            return "SAMPLE:" + json.dumps({"vars": [x.name for x in names], "points": points, "values": values})
        if op == "numeric" or op == "evaluate numerically":
            e = e.evalf(6)
        elif op == "simplify":
            e = sp.simplify(e)
        elif op == "expand":
            e = sp.expand(e)
        elif op == "factor":
            e = sp.factor(e)
        elif hasattr(e, "doit"):
            e = e.doit()
        return tex(e)
    except Exception as err:  # noqa: BLE001 - shown in the exam where the formula is
        return "\\text{(cannot compute: %s)}" % str(err).replace("{", "").replace("}", "")


def exam(p):
    """One version of an exam: {"seed", "setup", "formulas", "parts": [{"setup", "formulas",
    "questions": [{"setup", "formulas"}]}]} -> the formulas' LaTeX in the same shape."""
    import random
    rng = random.Random(p.get("seed"))
    env = exam_setup(p.get("setup", []), {}, rng)
    out = {"formulas": [exam_formula(f, env, rng) for f in p.get("formulas", [])], "parts": []}
    for part in p.get("parts", []):
        penv = exam_setup(part.get("setup", []), env, rng)
        po = {"formulas": [exam_formula(f, penv, rng) for f in part.get("formulas", [])], "questions": []}
        for q in part.get("questions", []):
            try:
                qenv = exam_setup(q.get("setup", []), penv, rng)
            except Unsupported as err:  # this question's formulas say why; the others are made
                po["questions"].append({"formulas": ["\\text{(%s)}" % err for _ in q.get("formulas", [])]})
                continue
            po["questions"].append({"formulas": [exam_formula(f, qenv, rng) for f in q.get("formulas", [])]})
        out["parts"].append(po)
    return out


# Compute > Definitions: names given a value or a function, used by every later computation
# (kept while the editor runs, like 5.5)
DEFINITIONS = {}  # name -> (Symbol or Function class, value or Lambda)
MATRIX_DELIMS = {}  # name -> the brackets a matrix was defined with


def define(e, full=False):
    """x = a + 1 keeps a (its value when x is used, as 5.5); x := a + 1 (full) puts in a's value now.
    f(x) = x^2: x is the function's own, whatever x is defined as."""
    if not isinstance(e, sp.Equality):
        raise Unsupported("Write a definition as x = 3 or f(x) = x^2")
    lhs = e.lhs
    rhs = apply_definitions(e.rhs, PARAMS) if full else e.rhs
    if isinstance(lhs, sp.Symbol):
        DEFINITIONS[lhs.name] = (lhs, rhs)
        MATRIX_DELIMS[lhs.name] = answer_delim()
        SUBSCRIPTS.pop(lhs.name, None)
    elif isinstance(lhs, sp.Function) and isinstance(lhs.func, sp.core.function.UndefinedFunction) and all(isinstance(a, sp.Symbol) for a in lhs.args):
        DEFINITIONS[lhs.func.__name__] = (lhs.func, sp.Lambda(lhs.args, rhs))
    else:
        raise Unsupported("The left side must be a name or a function such as f(x)")
    return sp.Eq(lhs, rhs, evaluate=False)


SUBSCRIPT_ARGUMENT = re.compile(r"^([A-Za-z])_([A-Za-z])$")
SUBSCRIPTS = {}  # a_n -> "argument" or "name": 5.5's Interpret Subscript, where it was chosen against the rule below


def subscript_argument(e, name, value):
    """a_n = n^2/2^n with n on the right: n is an argument (5.5's Interpret Subscript, "a function
    argument"), so a_2, a_{n+1} and a_k in a sum are worked out too. Without n on the right, or
    chosen as "part of the name" (SUBSCRIPTS), a_n is only a name."""
    m = SUBSCRIPT_ARGUMENT.match(name)
    mode = SUBSCRIPTS.get(name)
    if not m or mode == "name" or (mode != "argument" and not any(x.name == m.group(2) for x in getattr(value, "free_symbols", ()))):
        return e
    base, v = m.groups()
    at = lambda k: value.subs({x: k for x in value.free_symbols if x.name == v})  # noqa: E731
    e = e.replace(lambda n: isinstance(n, sp.Indexed) and n.base.name == base and len(n.indices) == 1, lambda n: at(n.indices[0]))
    return e.subs({x: at(sp.Integer(x.name[2:])) for x in e.free_symbols if re.fullmatch(base + r"_\d+", x.name)})


def inside_derivatives(e, name, value):
    """e with the defined name put in where it stands under a derivative not carried out yet, in a
    variable its value has: with w = y^2, d/dy (t w) is the derivative of t y^2. (subs alone keeps
    that as "differentiate with w a constant, then put in": 0.)"""
    def here(d):
        return any(s.name == name for s in d.expr.free_symbols) and not any(v.name == name for v in d.variables) \
            and bool(getattr(value, "free_symbols", set()) & set(d.variables))

    def put(d):
        return d.func(d.expr.subs({s: value for s in d.expr.free_symbols if s.name == name}), *d.variable_count)
    return e.replace(lambda n: isinstance(n, sp.Derivative) and here(n), put)


def apply_definitions(e, skip=()):
    if not DEFINITIONS or not hasattr(e, "subs"):
        return e
    for _ in range(5):  # definitions may use other definitions
        before = e
        for name, (key, value) in DEFINITIONS.items():
            if name in skip:
                continue
            if isinstance(value, sp.Lambda) or isinstance(value, type):  # f(x) = ..; y of Solve ODE > Numeric
                e = e.replace(key, value)
            else:  # by name: the variable may have other assumptions now
                e = inside_derivatives(e, key.name, value).subs({s: value for s in e.free_symbols if s.name == key.name})
                e = subscript_argument(e, name, value)
        if e == before:
            break
    return e


def compute(op, mathjson_text):
    """-> JSON text: {"latex": ..., "kind": "value"|"solutions"|"boolean"} or {"error": ...}."""
    NAMES.clear()
    STYLE.update(delim=None, list=False, product=False, log10=False)
    PARAMS.clear()
    try:
        if op == "plot":  # mathjson_text: {"expr": MathJSON, "var": "x", "a": .., "b": .., "n": ..}
            p = json.loads(mathjson_text)
            var = variable(p.get("var") or "x")
            if var.name in DEFINITIONS and isinstance(DEFINITIONS[var.name][1], type):  # y of Solve ODE > Numeric, plotted in y
                var = sp.Dummy(var.name)
            e = numeric_functions(apply_numeric(build(p["expr"])), var)
            free = e.free_symbols - {var}
            if free:
                raise Unsupported("Variables without a value: " + ", ".join(sorted(str(x) for x in free)))
            xs, ys = plot_points(e, var, float(p["a"]), float(p["b"]), int(p.get("n", 100)))
            return json.dumps({"kind": "points", "x": xs, "y": ys})
        if op == "plot3d":  # {"expr": MathJSON, "vars": ["x", "y"], "a", "b", "c", "d", "n", "m"}
            p = json.loads(mathjson_text)
            e = build(p["expr"])
            xv, yv = (variable(v) for v in p.get("vars") or ["x", "y"])
            free = e.free_symbols - {xv, yv}
            if free:
                raise Unsupported("Variables without a value: " + ", ".join(sorted(str(x) for x in free)))
            xs, ys, zs = plot_grid(e, xv, yv, float(p["a"]), float(p["b"]), float(p["c"]), float(p["d"]), int(p.get("n", 24)), int(p.get("m", 24)))
            return json.dumps({"kind": "grid", "x": xs, "y": ys, "z": zs})
        if op == "plotn":  # {"exprs": [MathJSON], "vars": [..], "ranges": [[a, b]], "ns": [n], "grad", "complex"}
            p = json.loads(mathjson_text)
            vs = [variable(v) for v in p["vars"]]
            cplx = p.get("complex")
            es = [numeric_functions(apply_definitions(build(e)), vs[0]) for e in p["exprs"]]
            free = set().union(*(e.free_symbols for e in es)) - set(vs) - ({variable(cplx)} if cplx else set())
            if free:
                raise Unsupported("Variables without a value: " + ", ".join(sorted(str(x) for x in free)))
            axes, vals = plot_values(es, vs, [[float(a), float(b)] for a, b in p["ranges"]], [int(n) for n in p["ns"]], bool(p.get("grad")), cplx)
            return json.dumps({"kind": "values", "axes": axes, "values": vals})
        if op == "odeplot":  # {"eqs": [MathJSON], "inits": [[name, x0, value]], "a", "b", "n"}
            p = json.loads(mathjson_text)
            xs, ys, var = ode_points(p["eqs"], p["inits"], float(p["a"]), float(p["b"]), int(p.get("n", 200)))
            return json.dumps({"kind": "ode", "x": xs, "y": ys, "var": var})
        if op == "exam":  # Tools > Exam Builder (see exam())
            return json.dumps({"kind": "exam", **exam(json.loads(mathjson_text))})
        if op == "version":
            import mpmath
            return json.dumps({"kind": "solutions", "solutions": [f"SymPy {sp.__version__}", f"mpmath {mpmath.__version__}"]})
        if op == "cleardefs":
            DEFINITIONS.clear()
            NUMERIC_SHOWN.clear()
            SUBSCRIPTS.clear()
            MATRIX_DELIMS.clear()
            ASSUMED.clear()
            RANGES.clear()
            return json.dumps({"kind": "solutions", "solutions": []})
        if op == "showdefs":
            shown = [f"{tex(k(*v.variables))} = {tex(v.expr)}" if isinstance(v, sp.Lambda)
                     else ", ".join(NUMERIC_SHOWN[str(k)]) if isinstance(v, type) else f"{tex(k)} = {tex(v)}"
                     for k, v in DEFINITIONS.values()]
            return json.dumps({"kind": "solutions", "solutions": list(dict.fromkeys(shown))})  # a system once
        j = json.loads(mathjson_text)
        if op in EXTRA_OPS:  # the rest of 5.5's Compute menu, in the parts at the end of this file
            return json.dumps(EXTRA_OPS[op](j))
        if op in ("define", "evaluate") and isinstance(j, list) and j and j[0] in ("assume", "additionally", "unassume", "about"):
            return json.dumps({"kind": "value", "latex": assume(j)})
        if isinstance(j, dict) and "expr" in j and op in OPTION_OPS:
            ps = j.get("params", [])
            words = [p.strip("'") for p in ps if isinstance(p, str) and p[:1] == "'"]
            return json.dumps(with_options(op, apply_definitions(build(j["expr"])), [build(p) for p in ps if not (isinstance(p, str) and p[:1] == "'")], words))
        if op == "stepcheck":  # {"expr": a, "params": [b]}: is a = b one right step (Changes and errors panel)
            r = step_check(apply_definitions(build(j["expr"])), apply_definitions(build(j["params"][0])))
            return json.dumps({"kind": "step", **r})
        if op == "implicitdiff":  # 5.5 writes the differentiated equation after "Derivative:"
            e, var = (j["expr"], j.get("params", [])[:1]) if isinstance(j, dict) else (j, [])  # params: [the differentiation variable]
            return json.dumps({"kind": "solutions", "label": ", Derivative: ", "solutions": [implicit_derivative(apply_definitions(build(e)), build(var[0]) if var else None)]})
        if op in PARAM_OPS or op in LIST_OPS:
            return json.dumps(compute_more(op, j["expr"], j.get("params", [])) if isinstance(j, dict) else compute_more(op, j, []))
        if op in ("solve", "numericsolve", "integersolve") and isinstance(j, list) and j[:1] == ["Tuple"]:
            raise Unsupported("Write the equations to solve; this is only a list")  # e.g. only the unknowns x, y
        subscript = None
        if op == "define" and isinstance(j, dict) and "expr" in j:  # a_n = .. with 5.5's Interpret Subscript: 'argument' or 'name'
            subscript = next((p.strip("'") for p in j.get("params", []) if p in ("'argument'", "'name'")), None)
            j = j["expr"]
        if op == "define" and isinstance(j, list) and j[:1] == ["OdeNumeric"]:  # Solve ODE > Numeric
            return json.dumps(numeric_ode(j))
        full = op == "define" and isinstance(j, list) and j[:1] == ["Assign"] and len(j) == 3
        if full:  # z := 25a, f := x -> ..: 5.5's assignment (full evaluation)
            f = j[2]
            fn = isinstance(f, list) and f[:1] == ["Function"] and all(isinstance(x, str) for x in f[2:])
            j = ["Equal", [j[1], *f[2:]] if fn else j[1], f[1] if fn else f]
        if op == "define" and isinstance(j, list) and j[:1] == ["Equal"]:
            # the function's parameters, or the name defined again (s = [2, 4] after s = [3, 5]): not their values
            PARAMS.update(x for x in (j[1][1:] if isinstance(j[1], list) else [j[1]]) if isinstance(x, str))
        if op in ELEMENTWISE | {"evaluate"} and isinstance(j, list) and j[:1] == ["Equal"] and len(j) == 3:
            e = sp.Eq(build(j[1]), build(j[2]), evaluate=False)  # Re(z) = a + b: 5.5 works out the right side
        else:
            with Unassumed(PARAMS if op == "define" else ()):
                e = build(ode_form(j) if op == "ode" else j)
        if op == "define":
            r = define(e, full)
            if subscript and isinstance(e.lhs, sp.Symbol):
                SUBSCRIPTS[e.lhs.name] = subscript
            return json.dumps({"kind": "value", "latex": tex(r)})
        e = apply_definitions(e)
        units = getattr(e, "free_symbols", set()) & UNIT_SYMBOLS
        if units and op in ("solve", "numericsolve", "check"):  # 7 ft = x in: in SI units, x = 84.0
            e = in_si(e)
        if op == "solve":
            return json.dumps(solve_answer(e))
        if op in ("extrema", "numericsolve", "integersolve"):
            sols = {"extrema": extrema, "numericsolve": solve_numeric, "integersolve": integer_solutions}[op](e)
            parts = [", ".join(solution_tex(v, x) for v, x in s) for s in sols]
            return json.dumps({"kind": "solutions", "solutions": parts})
        if op == "ode":
            return json.dumps({"kind": "solutions", "solutions": [tex(s) for s in solve_ode(e)]})
        if op == "check":
            return json.dumps({"kind": "boolean", "value": bool(check_equality(e))})
        if op in ELEMENTWISE and isinstance(last_side(e), sp.MatrixBase):
            r = last_side(e).applyfunc(OPERATIONS[op])
        else:
            r = OPERATIONS[op](e)
        if units and isinstance(r, sp.Add) and len({t.as_independent(*UNIT_SYMBOLS)[1] for t in r.args}) > 1:
            r = sp.expand(in_si(r))  # 4 ft + 16 in: different units are added in SI units, as 5.5
        if isinstance(r, dict):  # eigenvalues with multiplicities
            r = sp.FiniteSet(*r.keys())
        if isinstance(r, sp.MatrixBase) and r.shape == (1, 1):  # a row times a column: a number, as in 5.5
            r = r[0, 0]
        if op == "expand" and getattr(r, "is_Rational", False) and abs(r) > 1 and not r.is_Integer:  # 131/9 = 14 5/9, as 5.5
            whole = int(abs(r))
            return json.dumps({"kind": "value", "latex": ("-" if r < 0 else "") + f"{whole}\\frac{{{abs(r.p) - whole * r.q}}}{{{r.q}}}"})
        return json.dumps({"kind": "value", "latex": tex(r)})
    except Unsupported as x:
        return json.dumps({"error": f"Cannot compute this yet: {x}"})
    except Exception as x:  # SymPy raises many kinds; the editor shows the message
        return json.dumps({"error": f"{type(x).__name__}: {x}"})

# =============================================================================
# The rest of 5.5's Compute menu, one part per group of items. Each part adds its functions
# here and registers them in EXTRA_OPS (or OPERATIONS / ELEMENTWISE for a plain op).
# =============================================================================


# -----------------------------------------------------------------------------
# part: matdecomp
# -----------------------------------------------------------------------------

# Compute > Matrices: the decompositions and normal forms, answered as 5.5 (MuPAD) answers them:
# a factorization "A = P L U" (the factors after "="), or ", label: result" after the matrix.
# What each does follows SW6's MuPAD code (computelib/swfcns.mu: tciLU, tciQR, tcicholesky, tciSVD,
# tcisingvals, tcijordan, tcihermite, tcismith, tcifrob, tciffgausselim, tciminpoly,
# tcieigenvectors) and the examples of 5.5's help (dm8-3, dm8-6, dm8-7, dm8-8).

def md_matrix(j):
    """The matrix of the request (and the params): a defined name is replaced by its value."""
    expr, params = (j["expr"], j.get("params", [])) if isinstance(j, dict) and "expr" in j else (j, [])
    m = last_side(apply_definitions(build(expr)))
    if not isinstance(m, sp.MatrixBase):
        raise Unsupported("Put the cursor in a matrix")
    return sp.Matrix(m), params


def md_float(m):
    """5.5 works with decimals when an entry is a decimal (MuPAD's numeric:: functions)."""
    return m.has(sp.Float)


def md_zero(x):
    return sp.cancel(sp.expand(x)) == 0


def md_tidy(x, numeric=False):
    if numeric:
        x = sp.N(x, 15)
        if isinstance(x, sp.Float) and abs(x) < 1e-13:
            return sp.Integer(0)
        if x.is_number and abs(sp.im(x)) < 1e-13:
            x = sp.re(x)
        return x
    x = sp.radsimp(sp.cancel(x))
    return sp.expand(x) if x.is_number else x


def md_product(*ms):
    """the factors of A = .. side by side, as 5.5 writes them"""
    return {"kind": "value", "latex": " ".join(tex(m) for m in ms)}



def md_echelon(m, fraction_free=False, largest_pivot=False):
    """Row echelon form by Gaussian elimination, as MuPAD's linalg::gaussElim: the first nonzero
    entry of the column as pivot (the largest with decimals), rows swapped only for that.
    -> (U, L, perm): Q A = L U with row i of Q A row perm[i] of A."""
    a = m.copy()
    rows, cols = a.shape
    low = sp.zeros(rows, rows)
    perm = list(range(rows))
    r, prev = 0, sp.Integer(1)
    for c in range(cols):
        if r >= rows:
            break
        found = [i for i in range(r, rows) if not md_zero(a[i, c])]
        if not found:
            continue
        p = max(found, key=lambda i: abs(sp.N(a[i, c]))) if largest_pivot else found[0]
        if p != r:
            a.row_swap(p, r)
            low.row_swap(p, r)
            perm[p], perm[r] = perm[r], perm[p]
        piv = a[r, c]
        for i in range(r + 1, rows):
            f = a[i, c]
            if fraction_free:  # Bareiss: (pivot row_i - a_ic row_r) / the pivot before
                for k in range(cols):
                    a[i, k] = sp.expand(sp.cancel((piv * a[i, k] - f * a[r, k]) / prev))
            else:
                q = sp.cancel(f / piv)
                low[i, r] = q
                for k in range(cols):
                    a[i, k] = sp.cancel(a[i, k] - q * a[r, k])
                a[i, c] = 0
        prev = piv
        r += 1
    return a, low + sp.eye(rows), perm


def md_gauss(j):
    m, _ = md_matrix(j)
    u, _, _ = md_echelon(m, largest_pivot=False)
    return {"kind": "solutions", "label": ", Gaussian elimination: ", "solutions": [tex(u.applyfunc(lambda x: md_tidy(x, md_float(m))))]}


def md_ffgauss(j):
    m, _ = md_matrix(j)
    if md_float(m):
        raise Unsupported("Matrix entries must be polynomials over the rationals")
    u, _, _ = md_echelon(m, fraction_free=True)
    return {"kind": "solutions", "label": ", fraction-free Gaussian elimination: ", "solutions": [tex(u)]}


def md_plu(j):
    m, _ = md_matrix(j)
    num = md_float(m)
    u, low, perm = md_echelon(m, largest_pivot=num)
    n = m.rows
    p = sp.zeros(n, n)
    for i, k in enumerate(perm):
        p[k, i] = 1
    if num:  # MuPAD's numeric::factorLU: 1.0 on the diagonal of L
        low = low.applyfunc(lambda x: sp.Float(1.0) if x == 1 else md_tidy(x, True))
        u = u.applyfunc(lambda x: md_tidy(x, True))
    else:
        low, u = low.applyfunc(md_tidy), u.applyfunc(md_tidy)
    return md_product(p, low, u)


def md_dot(u, v):
    return sum(sp.conjugate(a) * b for a, b in zip(u, v))


def md_qr(j):
    """Gram-Schmidt on the columns (linalg::factorQR): Q is m x m (completed with the unit vectors
    when there are fewer columns), R = Q^T A is m x n."""
    m, _ = md_matrix(j)
    num = md_float(m)
    rows = m.rows
    qs = []
    cands = [m.col(k) for k in range(m.cols)] + [sp.eye(rows).col(k) for k in range(rows)]
    for v in cands:
        if len(qs) == rows:
            break
        w = v - sum((md_dot(q, v) * q for q in qs), sp.zeros(rows, 1))
        w = w.applyfunc(lambda x: md_tidy(x, num))
        if all(md_zero(x) if not num else abs(sp.N(x)) < 1e-12 for x in w):
            continue
        norm = sp.sqrt(md_dot(w, w))
        qs.append((w / norm).applyfunc(lambda x: md_tidy(x, num)))
    q = sp.Matrix.hstack(*qs)
    r = (q.H * m).applyfunc(lambda x: md_tidy(x, num))
    for i in range(r.rows):  # below the diagonal is 0 (rounding)
        for k in range(min(i, r.cols)):
            r[i, k] = 0
    return md_product(q, r)


def md_cholesky(j):
    m, _ = md_matrix(j)
    if not m.is_square:
        raise Unsupported("Cholesky decomposition needs a square matrix")
    num = md_float(m)
    try:
        g = m.cholesky(hermitian=False)
    except ValueError:
        raise Unsupported("Cholesky decomposition needs a symmetric matrix")
    g = g.applyfunc(lambda x: md_tidy(x, num))
    return md_product(g, g.T)


def md_mp(m):
    import mpmath
    return mpmath.matrix([[complex(sp.N(x)) if not sp.N(x).is_real else float(sp.N(x)) for x in m.row(i)] for i in range(m.rows)])


def md_float_of(x):
    import mpmath
    x = complex(x) if isinstance(x, mpmath.mpc) else float(x)
    if isinstance(x, complex):
        if abs(x.imag) < 1e-13 * max(1, abs(x.real)):
            x = x.real
        else:
            return md_tidy(sp.Float(x.real, 15) + sp.I * sp.Float(x.imag, 15), True)
    return sp.Integer(0) if abs(x) < 1e-13 else sp.Float(x, 15)


def md_svd_parts(m):
    import mpmath
    a = md_mp(m)
    cplx = any(isinstance(a[i, k], mpmath.mpc) for i in range(a.rows) for k in range(a.cols))
    u, s, v = (mpmath.svd_c if cplx else mpmath.svd_r)(a, full_matrices=True)
    return u, s, v


def md_singularvalues(j):
    m, _ = md_matrix(j)
    _, s, _ = md_svd_parts(m)
    vals = [md_float_of(s[i]) for i in range(len(s))]
    shown = r"\left[ " + ",".join(tex(sp.Float(x, 15) if x == 0 else x) for x in vals) + r"\right] "
    return {"kind": "solutions", "label": ", singular values: ", "solutions": [shown]}


def md_svd(j):
    """A = U D V (MuPAD's numeric::singularvectors, always with decimals); each pair of singular
    vectors signed so that the row of V starts with a positive number, as in 5.5's examples."""
    m, _ = md_matrix(j)
    u, s, v = md_svd_parts(m)
    rows, cols = m.shape
    big_u = sp.Matrix(rows, rows, lambda i, k: md_float_of(u[i, k]))
    big_v = sp.Matrix(cols, cols, lambda i, k: md_float_of(v[i, k]))
    for i in range(min(len(s), rows, cols)):
        first = next((x for x in big_v.row(i) if x != 0), 1)
        if sp.re(first) < 0:
            big_v[i, :] = -big_v[i, :]
            big_u[:, i] = -big_u[:, i]
    d = sp.zeros(rows, cols)
    for i in range(len(s)):
        d[i, i] = md_float_of(s[i])
    return md_product(big_u, d, big_v)


def md_jordan(j):
    """A = P J P^-1 with J's ones below the diagonal: tcijordan takes MuPAD's Jordan form of A^T
    (A^T = q j q^-1) and answers (q^-1)^T, j^T, q^T."""
    m, _ = md_matrix(j)
    if not m.is_square:
        raise Unsupported("Needs a square matrix")
    num = md_float(m)
    a = m.applyfunc(sp.nsimplify) if num else m
    q, jj = a.T.jordan_form()
    p, jl = q.inv().T, jj.T
    # each chain scaled so that its eigenvector (the chain's last column) starts with 1, as 5.5
    n, s = a.rows, 0
    while s < n:
        e = s
        while e + 1 < n and jl[e + 1, e] == 1:
            e += 1
        first = next((x for x in p.col(e) if not md_zero(x)), 1)
        for k in range(s, e + 1):
            p[:, k] = p[:, k] / first
        s = e + 1
    f = (lambda x: md_tidy(x, True)) if num else md_tidy
    p = p.applyfunc(f)
    return md_product(p, jl.applyfunc(f), p.inv().applyfunc(f))


def md_poly_domain(m):
    """ZZ for integers, QQ[x] for polynomials in one variable x (the rings 5.5's normal forms use)."""
    from sympy.polys.domains import ZZ, QQ
    if all(x.is_Integer for x in m):
        return ZZ, None
    vs = sorted(m.free_symbols, key=str)
    if len(vs) == 1 and all(x.is_polynomial(vs[0]) and all(c.is_Rational for c in sp.Poly(x, vs[0]).coeffs()) for x in m if x != 0):
        return QQ[vs[0]], vs[0]
    raise Unsupported("The entries must be integers, or polynomials in one variable with rational coefficients")


def md_smith(j):
    m, _ = md_matrix(j)
    from sympy.matrices.normalforms import smith_normal_form
    dom, x = md_poly_domain(m)
    s = smith_normal_form(m, domain=dom)
    for i in range(min(s.shape)):
        d = s[i, i]
        if x is None:
            s[i, i] = abs(d)
        elif d != 0:
            s[i, i] = sp.Poly(d, x).monic().as_expr()
    return {"kind": "solutions", "label": ", Smith normal form: ", "solutions": [tex(s)]}


def md_hermite(j):
    """Row Hermite normal form over the integers (linalg::hermiteForm): upper echelon, pivots
    positive, the entries above a pivot from 0 to the pivot - 1."""
    m, _ = md_matrix(j)
    if not all(x.is_Integer for x in m):
        raise Unsupported("Hermite normal form needs a matrix of integers")
    a = [[int(x) for x in m.row(i)] for i in range(m.rows)]
    rows, cols = m.shape
    r = 0
    for c in range(cols):
        if r >= rows:
            break
        while True:
            nz = [i for i in range(r, rows) if a[i][c] != 0]
            if not nz:
                break
            p = min(nz, key=lambda i: abs(a[i][c]))
            a[r], a[p] = a[p], a[r]
            clean = True
            for i in range(r + 1, rows):
                q = a[i][c] // a[r][c]
                a[i] = [x - q * y for x, y in zip(a[i], a[r])]
                clean = clean and a[i][c] == 0
            if clean:
                break
        if a[r][c] == 0:
            continue
        if a[r][c] < 0:
            a[r] = [-x for x in a[r]]
        for i in range(r):
            q = a[i][c] // a[r][c]
            a[i] = [x - q * y for x, y in zip(a[i], a[r])]
        r += 1
    return {"kind": "solutions", "label": ", Hermite normal form: ", "solutions": [tex(sp.Matrix(a))]}


def md_companion(d, x):
    """MuPAD's companion matrix: ones below the diagonal, the last column -a_0, .., -a_(n-1)."""
    c = sp.Poly(d, x).monic().all_coeffs()[::-1]  # a_0 .. a_n (= 1)
    n = len(c) - 1
    b = sp.zeros(n, n)
    for i in range(1, n):
        b[i, i - 1] = 1
    for i in range(n):
        b[i, n - 1] = -c[i]
    return b


def md_rationalcanonical(j):
    """A = P B P^-1 with B in rational canonical (Frobenius) form (tcifrob): B's blocks are the
    companion matrices of the invariant factors, largest first; P's columns for a block are
    v, Av, .. A^(k-1) v with d(A) v = 0 (the unit vectors tried first, as 5.5's examples)."""
    m, _ = md_matrix(j)
    if not m.is_square:
        raise Unsupported("Needs a square matrix")
    from sympy.matrices.normalforms import invariant_factors
    from sympy.polys.domains import QQ
    x = sp.Dummy("x")
    a = m.applyfunc(sp.nsimplify)
    n = a.rows
    if not all(v.is_Rational for v in a):
        raise Unsupported("Rational canonical form needs a matrix of rational numbers")
    char = x * sp.eye(n) - a
    facs = [sp.Poly(f.as_expr() if hasattr(f, "as_expr") else QQ[x].to_sympy(f), x) for f in invariant_factors(char, domain=QQ[x])]
    facs = [f.monic() for f in facs if f.degree() > 0][::-1]  # largest first
    cols, blocks = [], []
    for f in facs:
        k = f.degree()
        dA = sp.zeros(n, n)
        for c in f.all_coeffs():
            dA = dA * a + c * sp.eye(n)
        ns = dA.nullspace()[::-1]
        cands = [sp.eye(n).col(i) for i in range(n) if (dA * sp.eye(n).col(i)).is_zero_matrix] + ns
        cands += [u + w for i, u in enumerate(ns) for w in ns[i + 1:]]
        for v in cands:
            kry = [v]
            for _ in range(k - 1):
                kry.append(a * kry[-1])
            trial = cols + kry
            if sp.Matrix.hstack(*trial).rank() == len(trial):
                cols = trial
                break
        else:
            raise Unsupported("Could not find the rational canonical form")
        blocks.append(md_companion(f.as_expr(), x))
    p = sp.Matrix.hstack(*cols)
    b = sp.diag(*blocks)
    return md_product(p, b, p.inv())


def md_poly_tex(coeffs, var):
    """a polynomial from the highest power down, a coefficient with several terms in brackets:
    \\lambda^2 + (-3X - y) \\lambda + (3Xy - 5x), as 5.5 writes it"""
    if all(not c.free_symbols for c in coeffs):
        return tex(sum(c * var ** i for i, c in enumerate(coeffs)))
    out = []
    for i in range(len(coeffs) - 1, -1, -1):
        c = sp.expand(coeffs[i])
        if c == 0:
            continue
        power = tex(var ** i) if i else ""
        if not power:
            t = r"\left( %s\right)" % tex(c) if c.is_Add and out else tex(c)
        elif c == 1:
            t = power
        elif c == -1:
            t = "-" + power
        elif c.is_Add:
            t = r"\left( %s\right) %s" % (tex(c), power)
        else:
            t = "%s %s" % (tex(c), power)
        out.append(t)
    s = " + ".join(out) or "0"
    return s.replace("+ -", "- ")


def md_minpoly(j):
    """The monic polynomial of least degree with p(A) = 0, in X (tciminpoly); a matrix with X in it
    needs another variable (params: [variable], 5.5 asks for it)."""
    m, params = md_matrix(j)
    if not m.is_square:
        raise Unsupported("Needs a square matrix")
    if params:
        var = build(params[0])
    elif any("X" in str(s) for s in m.free_symbols):
        raise Unsupported("The matrix has X in it: give the polynomial variable")
    else:
        var = sp.Symbol("X")
    n = m.rows
    powers = [sp.eye(n)]
    for k in range(1, n + 1):
        powers.append((powers[-1] * m).applyfunc(sp.expand))
        big = sp.Matrix.hstack(*[sp.Matrix(p.reshape(n * n, 1)) for p in powers])
        ns = big.nullspace(simplify=True)
        if ns:
            c = ns[0]
            c = [sp.factor(sp.cancel(x / c[k])) for x in c]
            c = [sp.expand(x) if not sp.fraction(sp.cancel(x))[1].free_symbols else x for x in c]
            return {"kind": "solutions", "label": ", minimum polynomial: ", "solutions": [md_poly_tex(c, var)]}
    raise Unsupported("Could not find the minimum polynomial")


def md_eigenvectors(j):
    """Each eigenvalue with the set of its eigenvectors: {v1, v2} <-> c (tcieigenvectors), the
    eigenvalues from the smallest; with decimals one vector of length 1 for each eigenvalue."""
    m, _ = md_matrix(j)
    if not m.is_square:
        raise Unsupported("Needs a square matrix")
    key = lambda v: (sp.N(sp.re(v)), sp.N(sp.im(v))) if v.is_number else (0, 0)  # noqa: E731
    parts = []
    if md_float(m):
        import mpmath
        e, er = mpmath.eig(md_mp(m))
        pairs = []
        for i in range(len(e)):
            vec = [er[k, i] for k in range(m.rows)]
            norm = mpmath.sqrt(sum(abs(z) ** 2 for z in vec))
            vec = [z / norm for z in vec]
            big = max(vec, key=abs)
            if mpmath.re(big) < 0:
                vec = [-z for z in vec]
            pairs.append((md_float_of(e[i]), [sp.Matrix([md_float_of(z) for z in vec])]))
        pairs.sort(key=lambda p: key(p[0]))
    else:
        pairs = [(val, vecs[::-1]) for val, _, vecs in m.eigenvects()]
        pairs = [(md_tidy(val), [v.applyfunc(md_tidy) for v in vecs]) for val, vecs in pairs]
        if all(v.is_number for v, _ in pairs):
            pairs.sort(key=lambda p: key(p[0]))
    for val, vecs in pairs:
        parts.append(r"\left\{ %s\right\} \leftrightarrow %s" % (",".join(tex(v) for v in vecs), tex(val)))
    return {"kind": "solutions", "label": ", eigenvectors: ", "solutions": [",".join(parts)]}


EXTRA_OPS["cholesky"] = md_cholesky
EXTRA_OPS["plu"] = md_plu
EXTRA_OPS["qr"] = md_qr
EXTRA_OPS["svd"] = md_svd
EXTRA_OPS["singularvalues"] = md_singularvalues
EXTRA_OPS["jordan"] = md_jordan
EXTRA_OPS["hermite"] = md_hermite
EXTRA_OPS["smith"] = md_smith
EXTRA_OPS["rationalcanonical"] = md_rationalcanonical
EXTRA_OPS["ffgauss"] = md_ffgauss
EXTRA_OPS["gauss"] = md_gauss
EXTRA_OPS["minpoly"] = md_minpoly
EXTRA_OPS["eigenvectors"] = md_eigenvectors

# (end of part: matdecomp)


# -----------------------------------------------------------------------------
# part: matmisc
# -----------------------------------------------------------------------------

# Compute > Matrices: Column Basis, Row Basis, Concatenate, Stack, Reshape, Fill Matrix, Random Matrix,
# Condition Number, Definiteness Tests, Norm, Orthogonality Test, Permanent, Spectral Radius,
# Hermitian Transpose. The answers as 5.5 writes them (its help, Doing Mathematics ch. 8: ", column
# basis: [..]", " is positive definite", ", 2-norm: 9.3268"); the MuPAD of each is tci* in SW6's swfcns.mu.

def mm_request(j):
    """-> (formula MathJSON, params) of a request"""
    if isinstance(j, dict) and "expr" in j:
        return j["expr"], j.get("params", [])
    return j, []


def mm_matrix(j):
    """the matrix the formula is (or gives), as written"""
    e = last_side(apply_definitions(build(mm_request(j)[0])))
    if hasattr(e, "doit") and not is_matrix(e):
        e = e.doit()
    if not is_matrix(e):
        raise Unsupported("Put the insertion point in a matrix")
    return sp.Matrix(e)


def mm_side_by_side(j):
    """the matrices written next to each other (Concatenate, Stack): A B, as 5.5 asks"""
    f = mm_request(j)[0]
    while isinstance(f, list) and f[:1] == ["Equal"]:
        f = f[-1]
    items, todo = [], [f]
    while todo:
        x = todo.pop(0)
        if isinstance(x, list) and x[:1] == ["Multiply"]:
            todo[:0] = x[1:]
        else:
            items.append(x)
    ms = []
    for x in items:
        m = last_side(apply_definitions(build(x)))
        if not is_matrix(m):
            raise Unsupported("Place two matrices next to each other")
        ms.append(sp.Matrix(m))
    if len(ms) < 2:
        raise Unsupported("Place two matrices next to each other")
    return ms


def mm_rows_tex(rows):
    """a matrix as tex() writes one, with empty entries (Reshape leaves the last ones blank)"""
    o, c = {"(": ("\\left(", "\\right)"), "[": ("\\left[", "\\right]")}.get(answer_delim(), ("\\left(", "\\right)"))
    body = "\\\\".join(" & ".join("" if x is None else tex(x) for x in r) for r in rows)
    return "%s\\begin{matrix}%s\\end{matrix}%s" % (o, body, c)


def mm_independent(vectors):
    """the first vectors that are independent of those before them (MuPAD's linalg::basis keeps the
    given vectors, in order)"""
    kept = []
    for v in vectors:
        if sp.Matrix.hstack(*kept, v).rank(simplify=True) > len(kept):
            kept.append(v)
    return kept


def mm_basis(j, rows):
    a = mm_matrix(j)
    vs = mm_independent([a.row(i).T for i in range(a.rows)] if rows else [a.col(i) for i in range(a.cols)])
    shown = [tex(v.T if rows else v) for v in vs] or [tex(sp.zeros(1, a.cols) if rows else sp.zeros(a.rows, 1))]
    return "\\left[ " + ",".join(shown) + "\\right] "


def mm_colbasis(j):
    return {"kind": "solutions", "label": ", column basis: ", "solutions": [mm_basis(j, False)]}


def mm_rowbasis(j):
    return {"kind": "solutions", "label": ", row basis: ", "solutions": [mm_basis(j, True)]}


def mm_concat(j):
    ms = mm_side_by_side(j)
    if len({m.rows for m in ms}) > 1:
        raise Unsupported("Concatenate needs matrices with the same number of rows")
    return {"kind": "solutions", "label": ", concatenate: ", "solutions": [tex(sp.Matrix.hstack(*ms))]}


def mm_stack(j):
    ms = mm_side_by_side(j)
    if len({m.cols for m in ms}) > 1:
        raise Unsupported("Stack needs matrices with the same number of columns")
    return {"kind": "solutions", "label": ", stack: ", "solutions": [tex(sp.Matrix.vstack(*ms))]}


def mm_reshape(j):
    """a list or matrix into rows of n entries, read left to right and top to bottom; the last row
    filled with blanks (5.5: 45, 21, 8, 19 to 3 columns)"""
    f, ps = mm_request(j)
    if not ps:
        raise Unsupported("Give the number of columns")
    n = build(ps[0])
    if not (n.is_Integer and n > 0):
        raise Unsupported("The number of columns must be a positive whole number")
    n = int(n)
    e = last_side(apply_definitions(build(f)))
    items = list(e) if isinstance(e, (sp.MatrixBase, sp.Tuple, list)) else [e]
    rows = [items[i:i + n] + [None] * (n - len(items[i:i + n])) for i in range(0, len(items), n)]
    return {"kind": "solutions", "label": f" to {n} columns: ", "solutions": [mm_rows_tex(rows)]}


def mm_numeric(a):
    """an mpmath matrix of a matrix of numbers (5.5 computes these numerically)"""
    import mpmath
    try:
        return mpmath.matrix([[complex(sp.N(x, 20)) if not sp.N(x, 20).is_real else float(sp.N(x, 20)) for x in a.row(i)] for i in range(a.rows)])
    except TypeError:
        raise Unsupported("This needs a matrix of numbers")


def mm_norm2(a):
    """the 2-norm: the largest singular value (MuPAD's twonorm: sqrt of the largest eigenvalue of A A^H)"""
    import mpmath
    m = mm_numeric(a)
    return max(abs(s) for s in mpmath.svd(m, compute_uv=False))


def mm_norm(j):
    a = mm_matrix(j)
    if 1 in a.shape:  # a vector: its length, exactly (sqrt(a^2 + b^2) for real a, b)
        r = sp.sqrt(sum(sp.Abs(x) ** 2 for x in a))
    else:
        r = sp.Float(mm_norm2(a), 15)
    return {"kind": "solutions", "label": ", 2-norm: ", "solutions": [tex(r)]}


def mm_condition(j):
    a = mm_matrix(j)
    if a.rows != a.cols:
        raise Unsupported("The condition number is for a square matrix")
    if a.det() == 0:
        raise Unsupported("The matrix has no inverse")
    r = sp.Float(mm_norm2(a) * mm_norm2(a.inv()), 15)
    return {"kind": "solutions", "label": ", condition number: ", "solutions": [tex(r)]}


def mm_spectral_radius(j):
    import mpmath
    a = mm_matrix(j)
    if a.rows != a.cols:
        raise Unsupported("The spectral radius is for a square matrix")
    ev = mpmath.eig(mm_numeric(a), left=False, right=False)
    r = sp.Float(max(abs(x) for x in ev), 15)
    return {"kind": "solutions", "label": ", spectral radius: ", "solutions": [tex(r)]}


def mm_definiteness(j):
    """5.5: a Hermitian matrix with all eigenvalues positive "is positive definite", any other "is
    indefinite" (Sylvester: all leading principal minors positive)"""
    a = mm_matrix(j)
    if a.rows != a.cols:
        raise Unsupported("Definiteness tests are for a square matrix")
    hermitian = all(sp.simplify(x) == 0 for x in a - a.H)
    if not hermitian and not (a.free_symbols and a == a.T):  # letters: taken as real if the matrix is symmetric
        return {"kind": "text", "text": " is indefinite"}
    minors = [sp.simplify(a[:k, :k].det()) for k in range(1, a.rows + 1)]
    signs = [sp.ask(sp.Q.positive(m)) if m.free_symbols else bool(m > 0) for m in minors]
    if all(s is True for s in signs):
        return {"kind": "text", "text": " is positive definite"}
    if any(s is False for s in signs):
        return {"kind": "text", "text": " is indefinite"}
    return {"kind": "text", "text": " is indeterminant"}


def mm_orthogonal(j):
    """orthonormal columns: A^H A is the identity (a square matrix)"""
    a = mm_matrix(j)
    ok = a.rows == a.cols and all(sp.simplify(x) == 0 for x in a.H * a - sp.eye(a.cols))
    return {"kind": "solutions", "label": ", orthogonal? ", "solutions": [tex(sp.true if ok else sp.false)]}


def mm_permanent(j):
    a = mm_matrix(j)
    if a.rows != a.cols:
        raise Unsupported("The permanent is for a square matrix")
    return {"kind": "solutions", "label": ", permanent: ", "solutions": [tex(sp.expand(a.per()))]}


def mm_htranspose(j):
    return {"kind": "solutions", "label": ", Hermitian transpose: ", "solutions": [tex(mm_matrix(j).H)]}


def mm_band(items, rows, cols):
    """MuPAD's matrix(d, d, [.., diagonal, ..], Banded) cut to rows x cols (tciBand): the middle item on
    the diagonal, those before it below, those after it above"""
    if len(items) % 2 == 0:
        raise Unsupported("The band list needs an odd number of entries")
    k = len(items) // 2
    return sp.Matrix(rows, cols, lambda i, c: items[k + c - i] if abs(c - i) <= k else 0)


def mm_size(ps):
    try:
        rows, cols = (int(build(p)) for p in ps[:2])
    except (TypeError, ValueError):
        raise Unsupported("Give the numbers of rows and columns")
    if rows < 1 or cols < 1:
        raise Unsupported("Give the numbers of rows and columns")
    return rows, cols


def mm_bare(m):
    """the entries of a new matrix, for the brackets the insertion point is in (as 5.5 fills them)"""
    return "\\begin{matrix}%s\\end{matrix}" % "\\\\".join(" & ".join(tex(x) for x in m.row(i)) for i in range(m.rows))


def mm_fill(j):
    """Matrices > Fill Matrix: params ['zero'|'identity'|'random'|'jordan'|'function'|'band', rows, cols, item]"""
    import random
    _, ps = mm_request(j)
    kind = str(ps[0]).strip("'") if ps else "zero"
    rows, cols = mm_size(ps[1:])
    item = ps[3] if len(ps) > 3 else None
    if kind in ("jordan", "function", "band") and item is None:
        raise Unsupported("Fill in the entry")
    if kind == "zero":
        m = sp.zeros(rows, cols)
    elif kind == "identity":
        m = sp.eye(rows, cols)
    elif kind == "random":  # linalg::randomMatrix(.., Dom::Integer): -999..999
        m = sp.Matrix(rows, cols, lambda i, c: random.randint(-999, 999))
    elif kind == "jordan":
        m = mm_band([sp.Integer(0), apply_definitions(build(item)), sp.Integer(1)], rows, cols)
    elif kind == "band":
        e = apply_definitions(build(item))
        m = mm_band(list(e) if isinstance(e, (sp.Tuple, list, sp.MatrixBase)) else [e], rows, cols)
    elif kind == "function":  # f(i, j) for a function name, else the same entry everywhere (5 -> all 5)
        if isinstance(item, str) and item[:1] != "'":
            m = sp.Matrix(rows, cols, lambda i, c: apply_definitions(build([item, int(i) + 1, int(c) + 1])))
        else:
            v = apply_definitions(build(item))
            m = sp.Matrix(rows, cols, lambda i, c: v)
    else:
        raise Unsupported(kind)
    return {"kind": "value", "latex": mm_bare(m)}


def mm_random(j):
    """Matrices > Random Matrix: params ['unrestricted'|'symmetric'|'antisymmetric'|'triangular', rows, cols, min, max]
    (tcirandmat: whole numbers from min to max)"""
    import random
    _, ps = mm_request(j)
    kind = str(ps[0]).strip("'") if ps else "unrestricted"
    rows, cols = mm_size(ps[1:])
    try:
        lo, hi = (int(build(p)) for p in ps[3:5])
    except (TypeError, ValueError):
        lo, hi = -9, 9
    lo, hi = min(lo, hi), max(lo, hi)
    m = sp.Matrix(rows, cols, lambda i, c: random.randint(lo, hi))
    for i in range(rows):
        for c in range(min(i + 1, cols)):
            if kind == "symmetric" and c < i and i < cols and c < rows:
                m[i, c] = m[c, i]
            elif kind == "antisymmetric":
                m[i, c] = 0 if c == i else (-m[c, i] if i < cols and c < rows else m[i, c])
            elif kind == "triangular" and c < i:
                m[i, c] = 0
    return {"kind": "value", "latex": mm_bare(m)}


EXTRA_OPS["colbasis"] = mm_colbasis
EXTRA_OPS["rowbasis"] = mm_rowbasis
EXTRA_OPS["concat"] = mm_concat
EXTRA_OPS["stack"] = mm_stack
EXTRA_OPS["reshape"] = mm_reshape
EXTRA_OPS["fillmatrix"] = mm_fill
EXTRA_OPS["randommatrix"] = mm_random
EXTRA_OPS["condition"] = mm_condition
EXTRA_OPS["definiteness"] = mm_definiteness
EXTRA_OPS["norm"] = mm_norm
EXTRA_OPS["orthogonal"] = mm_orthogonal
EXTRA_OPS["permanent"] = mm_permanent
EXTRA_OPS["spectralradius"] = mm_spectral_radius
EXTRA_OPS["htranspose"] = mm_htranspose

# (end of part: matmisc)


# -----------------------------------------------------------------------------
# part: rewrite
# -----------------------------------------------------------------------------

# Compute > Rewrite and Compute > Combine, as 5.5 does them: MuPAD's rewrite(e, target) and
# combine(e, target) (SW6's swfcns.mu, tcirewrite and tcicomb2; 5.5's own table: Combine > Powers
# and Trig Functions are simplify there). Each works on the formula's last side, entry by entry on
# a matrix, as the other plain items do.

def rw_plain(f):
    def run(j):
        j = j.get("expr") if isinstance(j, dict) else j
        if isinstance(j, list) and j[:1] == ["Equal"] and len(j) == 3:
            e = sp.Eq(build(j[1]), build(j[2]), evaluate=False)
        else:
            e = build(j)
        x = last_side(apply_definitions(e))
        one = lambda u: f(u.doit() if hasattr(u, "doit") else u)  # noqa: E731
        if isinstance(x, sp.MatrixBase):
            r = x.applyfunc(one)
            r = r[0, 0] if r.shape == (1, 1) else r
        elif isinstance(x, (list, tuple)):
            r = [one(u) for u in x]
        elif isinstance(x, sp.FiniteSet):
            r = sp.FiniteSet(*[one(u) for u in x])
        else:
            r = one(x)
        return {"kind": "value", "latex": tex(r)}
    return run


def rw_rational(x):
    """numeric::rationalize: each decimal as the fraction it is (4.72 = 118/25, 3.1416 = 3927/1250)."""
    return x.replace(lambda n: n.is_Float, lambda f: sp.nsimplify(f, rational=True))


def rw_float(x):
    return x.evalf(10)


def rw_log(x):
    """rewrite(e, ln): the inverse hyperbolic functions as MuPAD writes them (arccosh x = ln(x + sqrt(x^2 - 1)))."""
    x = x.replace(sp.asinh, lambda u: sp.log(u + sp.sqrt(u**2 + 1))).replace(sp.acosh, lambda u: sp.log(u + sp.sqrt(u**2 - 1)))
    x = x.replace(sp.atanh, lambda u: sp.log(u + 1) / 2 - sp.log(1 - u) / 2).replace(sp.acoth, lambda u: sp.log(u + 1) / 2 - sp.log(u - 1) / 2)
    x = x.replace(sp.asech, lambda u: sp.log(1 / u + sp.sqrt(1 / u**2 - 1))).replace(sp.acsch, lambda u: sp.log(1 / u + sp.sqrt(1 / u**2 + 1)))
    return x.replace(lambda n: isinstance(n, (sp.asin, sp.acos, sp.atan, sp.acot)), lambda n: n.rewrite(sp.log))


def rw_sinhcosh(x):
    """rewrite(e, sinhcosh): tanh, coth, sech, csch and e^x in sinh and cosh (e^x = cosh x + sinh x)."""
    x = x.replace(sp.tanh, lambda u: sp.sinh(u) / sp.cosh(u)).replace(sp.coth, lambda u: sp.cosh(u) / sp.sinh(u))
    x = x.replace(sp.sech, lambda u: 1 / sp.cosh(u)).replace(sp.csch, lambda u: 1 / sp.sinh(u))
    return x.replace(lambda n: isinstance(n, sp.exp) and not n.args[0].has(sp.I), lambda n: sp.cosh(n.args[0]) + sp.sinh(n.args[0]))


def rw_trig(target):
    """rewrite(e, sin), (e, cos), (e, tan): the six trigonometric functions in one of them, by the
    half angle (no square roots): cos x = 1 - 2 sin^2(x/2); sin x = 2 tan(x/2)/(tan^2(x/2) + 1)."""
    def via(u):
        h = u / 2
        if target == "sin":
            s, c = sp.sin(u), 1 - 2 * sp.sin(h)**2
        elif target == "cos":
            s, c = 2 * sp.cos(h - sp.pi / 4, evaluate=False)**2 - 1, sp.cos(u)  # (SymPy would make it sin(x/2 + pi/4))
        else:
            t = sp.tan(h)
            s, c = 2 * t / (t**2 + 1), (1 - t**2) / (t**2 + 1)
        return s, c

    def one(n):
        u = n.args[0]
        s, c = via(u)
        if isinstance(n, sp.sin):
            return s
        if isinstance(n, sp.cos):
            return c
        if isinstance(n, sp.tan):
            return n if target == "tan" else s / c
        if isinstance(n, sp.cot):
            return 1 / sp.tan(u) if target == "tan" else c / s
        if isinstance(n, sp.sec):
            return 1 / c
        return 1 / s  # csc
    kinds = (sp.sin, sp.cos, sp.tan, sp.cot, sp.sec, sp.csc)
    return lambda x: x.replace(lambda n: isinstance(n, kinds) and not (target == "sin" and isinstance(n, sp.sin))
                                and not (target == "cos" and isinstance(n, sp.cos)), one)


def rw_arc(target):
    """rewrite(e, arcsin) .. (e, arccot): arcsin, arccos, arctan, arccot in one of them
    (arctan x = arcsin(x/sqrt(x^2 + 1)), arccos x = pi/2 - arcsin x, as 5.5's examples)."""
    half = sp.pi / 2
    forms = {
        "asin": {sp.acos: lambda u: half - sp.asin(u), sp.atan: lambda u: sp.asin(u / sp.sqrt(u**2 + 1)),
                 sp.acot: lambda u: half - sp.asin(u / sp.sqrt(u**2 + 1))},
        "acos": {sp.asin: lambda u: half - sp.acos(u), sp.acot: lambda u: sp.acos(u / sp.sqrt(u**2 + 1)),
                 sp.atan: lambda u: half - sp.acos(u / sp.sqrt(u**2 + 1))},
        "atan": {sp.asin: lambda u: sp.atan(u / sp.sqrt(1 - u**2)), sp.acos: lambda u: half - sp.atan(u / sp.sqrt(1 - u**2)),
                 sp.acot: lambda u: half - sp.atan(u)},
        "acot": {sp.atan: lambda u: half - sp.acot(u), sp.acos: lambda u: sp.acot(u / sp.sqrt(1 - u**2)),
                 sp.asin: lambda u: half - sp.acot(u / sp.sqrt(1 - u**2))},
    }[target]
    return lambda x: x.replace(lambda n: type(n) in forms, lambda n: forms[type(n)](n.args[0]))


def rw_sqrt_rect(n):
    """sqrt(a + bi) of numbers as 5.5 writes it: sqrt((|z| + a)/2) + i sqrt((|z| - a)/2) (sign of b)."""
    a, b = sp.re(n.base), sp.im(n.base)
    r = sp.sqrt(a**2 + b**2)
    return sp.sqrt(sp.expand((r + a) / 2)) + sp.sign(b) * sp.I * sp.sqrt(sp.expand((r - a) / 2))


def rw_rectangular(x):
    """rectform: a + bi, the letters taken as real (5.5: (a + bi)^-1 = a/(a^2 + b^2) - b/(a^2 + b^2) i)."""
    real = {s: sp.Symbol(s.name, real=True) for s in x.free_symbols if s.is_real is None}
    x = x.xreplace(real)
    x = x.replace(lambda n: n.is_Pow and n.exp == sp.S.Half and n.base.is_number and sp.im(n.base) != 0, rw_sqrt_rect)
    # a number to a complex power: e^(w ln z) (i^i = e^(-pi/2), 5^(2i) = cos(2 ln 5) + i sin(2 ln 5))
    x = x.replace(lambda n: n.is_Pow and n.base.is_number and n.exp.is_number and sp.im(n.exp) != 0, lambda n: sp.exp(sp.expand(n.exp * sp.log(n.base))))
    r = sp.expand_complex(x)
    return r.xreplace({v: k for k, v in real.items()})


def rw_polar(x):
    """abs(e) exp(i arg(e)): 3 + 5i = sqrt(34) e^(i arctan(5/3))."""
    if x.is_number:
        return sp.Mul(sp.Abs(x), sp.exp(sp.I * sp.arg(x)), evaluate=False)
    return sp.Mul(sp.exp(sp.I * sp.arg(x), evaluate=False), sp.Abs(x), evaluate=False)


def rw_normal(x):
    """normal: one fraction, numerator and denominator expanded."""
    return sp.cancel(sp.together(x))


def cb_exp(x):
    """combine(e, exp): e^x e^y = e^(x + y), (e^x)^y = e^(xy); other bases stay (2^x 2^y)."""
    x = x.replace(lambda n: n.is_Pow and isinstance(n.base, sp.exp), lambda n: sp.exp(sp.expand(n.base.args[0] * n.exp)))

    def merge(m):
        es = [f for f in m.args if isinstance(f, sp.exp)]
        if len(es) < 2:
            return m
        return sp.Mul(*[f for f in m.args if not isinstance(f, sp.exp)]) * sp.exp(sp.expand(sp.Add(*[f.args[0] for f in es])))
    return x.replace(lambda n: n.is_Mul, merge)


def cb_log(x):
    """combine(e, ln): ln x + ln y = ln xy where it holds (5.5: after assume(positive))."""
    return sp.logcombine(x)


def cb_powers(x):
    """5.5 simplifies: a^x a^y = a^(x + y), a^x/a^y = a^(x - y), 10^(x + i) 10^(x - i) = 10^(2x)
    (not 100^x: a number keeps its power)."""
    def merge(m):
        powers, rest = {}, []
        for f in m.args:
            b, k = f.as_base_exp()
            if f.is_Pow or isinstance(f, sp.exp):
                powers.setdefault(b, []).append(k)
            else:
                rest.append(f)
        if all(len(ks) < 2 for ks in powers.values()):
            return m
        out = [sp.Pow(b, sp.expand(sp.Add(*ks)), evaluate=not b.is_Number) for b, ks in powers.items()]
        return sp.Mul(*rest, *out)
    return x.replace(lambda n: n.is_Mul, merge)


def cb_trig(x):
    return linearize(x)


def cb_arctan(x):
    """combine(e, arctan): arctan x + arctan y = -arctan((x + y)/(xy - 1)), arctan x - arctan y = arctan((x - y)/(xy + 1))."""
    if not x.is_Add:
        return x
    items, rest = [], []
    for t in x.args:
        c, f = t.as_coeff_Mul()
        if isinstance(f, sp.atan) and c.is_Integer:
            items += [(1 if c > 0 else -1, f.args[0])] * abs(int(c))
        else:
            rest.append(t)
    if len(items) < 2:
        return x
    s0, u = items[0]
    u = s0 * u
    for s, v in items[1:]:
        u = sp.cancel((u + s * v) / (1 - s * u * v))
    n, d = sp.fraction(sp.cancel(u))
    lead = None
    xs = sorted(d.free_symbols, key=str)
    if xs:
        terms = sp.Poly(d, *xs).terms()
        lead = max(terms, key=lambda t: (sum(t[0]), t[0]))[1]
    if (lead < 0) if lead is not None else d.could_extract_minus_sign():
        n, d = -n, sp.expand(-d)
    n = sp.expand(n)
    r = -sp.atan(sp.expand(-n) / d) if n.could_extract_minus_sign() else sp.atan(n / d)
    return sp.Add(*rest) + r


def cb_hyp(x):
    """combine(e, sinhcosh): products and powers of sinh and cosh as sums
    (sinh x sinh y = 1/2 cosh(x + y) - 1/2 cosh(x - y))."""
    def term(t):
        fs = []
        for f in sp.Mul.make_args(t):
            if f.is_Pow and isinstance(f.base, (sp.sinh, sp.cosh)) and f.exp.is_Integer and f.exp > 1:
                fs += [f.base] * int(f.exp)
            else:
                fs.append(f)
        hs = [i for i, f in enumerate(fs) if isinstance(f, (sp.sinh, sp.cosh))]
        if len(hs) < 2:
            return t
        f, g = fs[hs[0]], fs[hs[1]]
        a, b = f.args[0], g.args[0]
        if isinstance(f, sp.sinh) and isinstance(g, sp.sinh):
            p = (sp.cosh(a + b) - sp.cosh(a - b)) / 2
        elif isinstance(f, sp.sinh):
            p = (sp.sinh(a + b) + sp.sinh(a - b)) / 2
        elif isinstance(g, sp.sinh):
            p = (sp.sinh(a + b) - sp.sinh(a - b)) / 2
        else:
            p = (sp.cosh(a + b) + sp.cosh(a - b)) / 2
        return sp.Mul(*[h for i, h in enumerate(fs) if i not in hs[:2]]) * p
    for _ in range(20):
        r = sp.expand(sp.Add(*[term(t) for t in sp.Add.make_args(sp.expand(x))]))
        if r == x:
            break
        x = r
    return x


def rw_items(j):
    """The equations (or expressions = 0) of a list, set or one-column matrix."""
    if isinstance(j, list) and j[:1] in (["Set"], ["List"]) and not (len(j) == 2 and isinstance(j[1], list) and j[1][:1] == ["List"]):
        return [build(x) for x in j[1:]]
    return [build(x) for x in items_json(j)]


def rw_vars(params, count=None):
    vs = [build(p) for p in params]
    vs = [v for v in vs if isinstance(v, sp.Symbol)]
    if vs:
        return vs
    if count is None:
        return []
    return [variable(n) for n in "xyz"[:count]] if count <= 3 else [variable("x_%d" % (i + 1)) for i in range(count)]


def eqs_to_matrix(j):
    """Rewrite > Equations as Matrix (5.5 asks the variables): the augmented matrix [A | b]."""
    expr, params = (j["expr"], j.get("params", [])) if isinstance(j, dict) else (j, [])
    eqs = [apply_definitions(e) for e in rw_items(expr)]
    exprs = [e.lhs - e.rhs if isinstance(e, sp.Equality) else e for e in eqs]
    vs = rw_vars(params)
    if not vs:
        vs = sorted(set().union(*(e.free_symbols for e in exprs)), key=str)
    A, b = sp.linear_eq_to_matrix(exprs, vs)
    return {"kind": "solutions", "label": ", Corresponding matrix: ", "solutions": [tex(sp.ImmutableMatrix(sp.Matrix.hstack(A, b)))]}


def matrix_to_eqs(j):
    """Rewrite > Matrix as Equations (5.5 asks the variables): an m x n matrix is the system with
    the last column on the right; a square one has 0 on the right."""
    expr, params = (j["expr"], j.get("params", [])) if isinstance(j, dict) else (j, [])
    M = sp.Matrix(last_side(apply_definitions(build(expr))))
    if M.rows == M.cols:
        S, c = M, sp.zeros(M.rows, 1)
    else:
        S, c = M[:, :-1], M[:, -1]
    vs = rw_vars(params, S.cols)
    if len(vs) != S.cols:
        raise Unsupported("Give {0} variables".format(S.cols))
    eqs = [sp.Eq(sp.Add(*[S[r, k] * vs[k] for k in range(S.cols)]), c[r], evaluate=False) for r in range(S.rows)]
    return {"kind": "solutions", "label": ", Corresponding equations: ", "solutions": ["\\left\\{" + ", ".join(tex(e) for e in eqs) + "\\right\\}"]}


# arccot written as 5.5 writes it (SymPy's printer would write acot)
WITHOUT_BRACKETS[sp.acot] = "\\operatorname{arccot}"

EXTRA_OPS["rewrite_rational"] = rw_plain(rw_rational)
EXTRA_OPS["rewrite_float"] = rw_plain(rw_float)
EXTRA_OPS["rewrite_factorial"] = rw_plain(lambda x: x.rewrite(sp.factorial))
EXTRA_OPS["rewrite_gamma"] = rw_plain(lambda x: x.rewrite(sp.gamma))
EXTRA_OPS["rewrite_log"] = rw_plain(rw_log)
EXTRA_OPS["rewrite_sinhcosh"] = rw_plain(rw_sinhcosh)
EXTRA_OPS["rewrite_sin"] = rw_plain(rw_trig("sin"))
EXTRA_OPS["rewrite_cos"] = rw_plain(rw_trig("cos"))
EXTRA_OPS["rewrite_tan"] = rw_plain(rw_trig("tan"))
EXTRA_OPS["rewrite_arcsin"] = rw_plain(rw_arc("asin"))
EXTRA_OPS["rewrite_arccos"] = rw_plain(rw_arc("acos"))
EXTRA_OPS["rewrite_arctan"] = rw_plain(rw_arc("atan"))
EXTRA_OPS["rewrite_arccot"] = rw_plain(rw_arc("acot"))
EXTRA_OPS["rewrite_polar"] = rw_plain(rw_polar)
EXTRA_OPS["rewrite_rectangular"] = rw_plain(rw_rectangular)
EXTRA_OPS["rewrite_normal"] = rw_plain(rw_normal)
EXTRA_OPS["eqs_to_matrix"] = eqs_to_matrix
EXTRA_OPS["matrix_to_eqs"] = matrix_to_eqs
EXTRA_OPS["combine_exp"] = rw_plain(cb_exp)
EXTRA_OPS["combine_log"] = rw_plain(cb_log)
EXTRA_OPS["combine_powers"] = rw_plain(cb_powers)
EXTRA_OPS["combine_trig"] = rw_plain(cb_trig)
EXTRA_OPS["combine_arctan"] = rw_plain(cb_arctan)
EXTRA_OPS["combine_hyp"] = rw_plain(cb_hyp)

# (end of part: rewrite)


# -----------------------------------------------------------------------------
# part: statpoly
# -----------------------------------------------------------------------------

# Compute > Statistics, as 5.5 (MuPAD's tcimean, tcimedian ... in SW6's swfcns.mu): a list is one
# set of data; a matrix gives one answer per column (its first row left out when it starts with a
# name: a labeled matrix); the answer follows a label (", Mean(s): ..."), as 5.5 writes it.

def stat_data(j):
    """-> (columns of data, the matrix's first row when it is labels, whether a matrix was given)."""
    req = j["expr"] if isinstance(j, dict) else j
    plain = isinstance(req, list) and req[:1] in (["Tuple"], ["Set"], ["Delimiter"], ["Sequence"])
    e = last_side(apply_definitions(build(req)))
    if isinstance(e, sp.Set):
        e = sp.Matrix([list(e)])
    if isinstance(e, (list, tuple, sp.Tuple)):
        e = sp.Matrix([list(e)])
    if not isinstance(e, sp.MatrixBase):
        return [[e]], None, False
    m = sp.Matrix(e)
    if plain:
        return [list(m)], None, False
    if m.rows == 1:  # a vector comes in as a row (tcistatdata)
        m = m.T
    labels = None
    if m.rows > 1 and m[0, 0].is_Symbol:  # a labeled matrix: the first row names the columns
        labels = list(m[0, :])
        m = m[1:, :]
    return [list(m[:, k]) for k in range(m.cols)], labels, m.cols > 1


def stat_list(values):
    return "\\left[" + ",".join(values) + "\\right]"


def stat_answer(j, one):
    """one(column) -> LaTeX of its answer; several columns: a list of them (the caller adds the label)."""
    cols, _, _ = stat_data(j)
    parts = [one(c) for c in cols]
    return {"kind": "solutions", "solutions": [parts[0] if len(parts) == 1 else stat_list(parts)]}


def stat_mean(xs):
    return sp.expand(sp.Add(*xs) / len(xs))


def stat_median(xs):
    """MuPAD's stats::median: of two middle numbers the smaller."""
    s = sorted(xs, key=lambda v: float(v))
    return s[(len(s) - 1) // 2]


def stat_mode(xs):
    """MuPAD's stats::modal: the values that occur most, in the order they first come, and how often."""
    count = {}
    for x in xs:
        count[x] = count.get(x, 0) + 1
    most = max(count.values())
    return stat_list([tex(x) for x in count if count[x] == most]) + "," + str(most)


def stat_geomean(xs):
    p = sp.Mul(*xs)
    r = p ** sp.Rational(1, len(xs))
    if p.is_Rational and not r.is_Rational:  # \\sqrt[4]{4704}, as MuPAD leaves it
        return sp.Pow(p, sp.Rational(1, len(xs)), evaluate=False)
    return r


def stat_harmonic(xs):
    return len(xs) / sp.Add(*[1 / x for x in xs])


def stat_meandev(xs):
    m = stat_mean(xs)
    return sp.Add(*[sp.Abs(x - m) for x in xs]) / len(xs)


def stat_variance(xs):
    """The sample variance (n - 1), MuPAD's stats::variance; (x - m)^2 with the sign of x - m made
    alike, so a b c d data gives 2(a/2 - c/2)^2 as 5.5."""
    if len(xs) < 2:
        return sp.Integer(0)
    m = stat_mean(xs)
    def sq(d):
        d = sp.expand(d)
        return (-d if d.could_extract_minus_sign() else d) ** 2
    return sp.Add(*[sq(x - m) for x in xs]) / (len(xs) - 1)


def stat_sqrt(v):
    """LaTeX of the square root of a variance as MuPAD writes it: sqrt(p/q) = (a/(b q')) sqrt(q') sqrt(p'),
    where p = a^2 p', q = b^2 q' (\\frac{1}{21} \\sqrt{21} \\sqrt{21055})."""
    if not v.is_Rational or v < 0 or v.q == 1:
        return tex(sp.sqrt(v))
    def part(n):
        a, rest = 1, n
        for f, k in sp.factorint(n).items():
            a *= f ** (k // 2)
            rest //= f ** (2 * (k // 2))
        return a, rest
    a, p1 = part(int(v.p))
    b, q1 = part(int(v.q))
    c = sp.Rational(a, b * q1)
    parts = [] if c == 1 else [tex(c)]
    parts += [tex(sp.sqrt(n)) for n in (q1, p1) if n != 1]
    return " ".join(parts) or "1"


def stat_moment(xs, r, about):
    """MuPAD's tcimoment1: the r-th moment about a number, or about the mean (about is None), as a decimal."""
    a = stat_mean(xs) if about is None else about
    return sp.Add(*[sp.N((x - a) ** r) for x in xs]) / len(xs)


def stat_quantile(xs, q):
    """MuPAD's stats::empiricalQuantile(data)(q, Averaged): the k-th smallest for k = ceil(n q);
    when n q is a whole number k, the mean of the k-th and the next."""
    s = sorted(xs, key=lambda v: float(v))
    n = len(s)
    k = sp.nsimplify(q, rational=True) * n
    if k <= 0:
        return s[0]
    if k >= n:
        return s[-1]
    if k.is_Integer:
        return (s[int(k) - 1] + s[int(k)]) / 2
    return s[int(sp.ceiling(k)) - 1]


def stat_cov(a, b):
    ma, mb = stat_mean(a), stat_mean(b)
    return sp.Add(*[sp.N((x - ma) * (y - mb)) for x, y in zip(a, b)]) / (len(a) - 1)


def stat_matrix(j, entry):
    cols, _, _ = stat_data(j)
    if len(cols) == 1 and not isinstance(last_side(build(j["expr"] if isinstance(j, dict) else j)), sp.MatrixBase):
        raise Unsupported("The selection must be a matrix")
    n = len(cols)
    m = sp.Matrix(n, n, lambda i, k: sp.N(entry(cols[i], cols[k])))
    return {"kind": "solutions", "solutions": [tex(m)]}


def stat_corr(a, b):
    return stat_cov(a, b) / sp.sqrt(stat_cov(a, a) * stat_cov(b, b))


def word_params(j):
    """The words ('first', ...) and the other params of a request."""
    ps = j.get("params", []) if isinstance(j, dict) else []
    return [p.strip("'") for p in ps if isinstance(p, str) and p[:1] == "'"], [p for p in ps if not (isinstance(p, str) and p[:1] == "'")]


def stat_fit(j):
    """Statistics > Fit Curve to Data. params: 'regression' | 'noconstant' | 'polynomial', 'first' |
    'last' (where the dependent variable is), degree. A least-squares fit, as MuPAD's stats::reg
    (tcimregress, tcipolyfit): exact for exact data, decimals for decimal data."""
    words, nums = word_params(j)
    kind = next((w for w in words if w in ("regression", "noconstant", "polynomial")), "regression")
    first = "first" in words
    req = j["expr"] if isinstance(j, dict) else j
    e = last_side(apply_definitions(build(req)))
    if not isinstance(e, sp.MatrixBase):
        raise Unsupported("The selection must be a matrix")
    m = sp.Matrix(e)
    labels = list(m[0, :]) if m[0, 0].is_Symbol else None
    if labels:
        m = m[1:, :]
    # decimals for numbers (as stats::reg answers), exact for letters; Multiple Regression of two
    # columns (stats::linReg) keeps exact numbers exact
    exact = not all(x.is_number for x in m) or (kind == "regression" and m.cols == 2 and not any(isinstance(x, sp.Float) for x in m))
    num = (lambda v: v) if exact else (lambda v: sp.N(v))
    if kind == "polynomial":
        if m.cols != 2:
            raise Unsupported("The selection must be a matrix of 2 columns")
        key = labels or [variable("x"), variable("y")]
        x, y = (1, 0) if first else (0, 1)
        deg = int(build(nums[0])) if nums else 2
        deg = min(deg, m.rows - 1)
        X = sp.Matrix(m.rows, deg + 1, lambda i, k: m[i, x] ** k)
        c = (X.T * X).solve(X.T * m[:, y])
        fit = sp.Add(*[num(sp.simplify(c[k])) * key[x] ** k for k in range(deg + 1)])
        return {"kind": "solutions", "label": ", Polynomial fit: ", "solutions": [tex(sp.Eq(key[y], fit, evaluate=False))]}
    if m.cols < 2:
        raise Unsupported("The selection must be a matrix of at least 2 columns")
    if not labels:
        raise Unsupported("The columns must be labeled (a first row of names)")
    dep = 0 if first else m.cols - 1
    ind = [k for k in range(m.cols) if k != dep]
    X = sp.Matrix(m.rows, len(ind), lambda i, k: m[i, ind[k]])
    if kind == "regression":
        X = X.row_join(sp.ones(m.rows, 1))
    c = (X.T * X).solve(X.T * m[:, dep])
    fit = sp.Add(*[num(sp.simplify(c[k])) * labels[ind[k]] for k in range(len(ind))])
    if kind == "regression":
        fit += num(sp.simplify(c[len(ind)]))
    return {"kind": "solutions", "label": ", Regression is: ", "solutions": [tex(sp.Eq(labels[dep], fit, evaluate=False))]}


def random_numbers(j):
    """Statistics > Random Numbers. params: the distribution ('normal' ...), how many, the parameters
    (as 5.5's dialog asks them). -> the numbers, as a list."""
    import math
    import random
    words, nums = word_params(j)
    dist = words[0] if words else "uniform"
    vals = [float(build(p)) for p in nums]
    if not vals or vals[0] < 1 or vals[0] != int(vals[0]):
        raise Unsupported("How many: a whole number from 1 on")
    n, p = int(vals[0]), vals[1:] + [None, None]
    a, b = p[0], p[1]
    def need(*xs):
        if any(x is None for x in xs):
            raise Unsupported("Give the parameters of the distribution")
    def chi2(k):
        return random.gammavariate(k / 2, 2)
    def poisson(lam):
        L, k, q = math.exp(-lam), 0, 1.0
        while True:
            q *= random.random()
            if q <= L:
                return k
            k += 1
    draws = {
        "beta": (2, lambda: random.betavariate(a, b)),
        "binomial": (2, lambda: sum(random.random() < b for _ in range(int(a)))),
        "cauchy": (2, lambda: a + b * math.tan(math.pi * (random.random() - 0.5))),
        "chisquare": (1, lambda: chi2(a)),
        "exponential": (1, lambda: random.expovariate(1 / a)),
        "f": (2, lambda: (chi2(a) / a) / (chi2(b) / b)),
        "gamma": (2, lambda: random.gammavariate(a, b)),
        "normal": (2, lambda: random.gauss(a, b)),
        "poisson": (1, lambda: poisson(a)),
        "t": (1, lambda: random.gauss(0, 1) / math.sqrt(chi2(a) / a)),
        "uniform": (2, lambda: random.uniform(a, b)),
        "weibull": (2, lambda: random.weibullvariate(b, a)),  # shape a, scale b
    }
    if dist not in draws:
        raise Unsupported("Unknown distribution: " + dist)
    k, draw = draws[dist]
    need(*p[:k])
    out = [draw() for _ in range(n)]
    return {"kind": "value", "latex": ",".join(str(x) if isinstance(x, int) else tex(sp.Float(x)) for x in out)}


def stat_moment_answer(j):
    """Statistics > Moment. params: the moment number, then the origin or the word 'mean'."""
    words, nums = word_params(j)
    if not nums:
        raise Unsupported("Give the moment number")
    r = build(nums[0])
    about = None if "mean" in words or len(nums) < 2 else build(nums[1])
    return {"label": ", Moment(s): ", **stat_answer(j, lambda c: tex(stat_moment(c, r, about)))}


def stat_quantile_answer(j):
    _, nums = word_params(j)
    if not nums:
        raise Unsupported("Give the quantile q (0 < q < 1)")
    q = build(nums[0])
    if not (q.is_number and 0 < q < 1):
        raise Unsupported("The quantile must be between 0 and 1")
    shown = str(nums[0]) if isinstance(nums[0], (int, float)) else tex(q)
    return {"label": f", {shown}th Quantile(s): ", **stat_answer(j, lambda c: tex(stat_quantile(c, q)))}


EXTRA_OPS["mean"] = lambda j: {"label": ", Mean(s): ", **stat_answer(j, lambda c: tex(stat_mean(c)))}
EXTRA_OPS["median"] = lambda j: {"label": ", Median(s): ", **stat_answer(j, lambda c: tex(stat_median(c)))}
EXTRA_OPS["mode"] = lambda j: {"label": ", Mode(s): ", **stat_answer(j, stat_mode)}
EXTRA_OPS["geomean"] = lambda j: {"label": ", Geometric Mean(s): ", **stat_answer(j, lambda c: tex(stat_geomean(c)))}
EXTRA_OPS["harmonicmean"] = lambda j: {"label": ", Harmonic Mean(s): ", **stat_answer(j, lambda c: tex(stat_harmonic(c)))}
EXTRA_OPS["meandev"] = lambda j: {"label": ", Mean deviation(s): ", **stat_answer(j, lambda c: tex(stat_meandev(c)))}
EXTRA_OPS["variance"] = lambda j: {"label": ", Variance(s): ", **stat_answer(j, lambda c: tex(stat_variance(c)))}
EXTRA_OPS["stddev"] = lambda j: {"label": ", Standard deviation(s): ", **stat_answer(j, lambda c: stat_sqrt(stat_variance(c)))}
EXTRA_OPS["moment"] = stat_moment_answer
EXTRA_OPS["quantile"] = stat_quantile_answer
EXTRA_OPS["correlation"] = lambda j: {"label": ", Correlation matrix: ", **stat_matrix(j, stat_corr)}
EXTRA_OPS["covariance"] = lambda j: {"label": ", Covariance matrix: ", **stat_matrix(j, stat_cov)}
EXTRA_OPS["fitcurve"] = stat_fit
EXTRA_OPS["randomnumbers"] = random_numbers


# Compute > Polynomials, as 5.5 (tcidiv, tciroot, tcisort, tcicollect, tcicompanion). Without a
# variable given (params: [variable], Collect: several), the one variable there is, else the
# editor asks (5.5 asks too) on the error below.

def need_variable():
    raise Unsupported("Choose the polynomial variable (there are several)")


def poly_request(j):
    """-> (the expression, the variables given)"""
    req, ps = (j["expr"], j.get("params", [])) if isinstance(j, dict) else (j, [])
    e = last_side(apply_definitions(build(req)))
    vs = [build(p) for p in ps if not (isinstance(p, str) and p[:1] == "'")]
    vs = [v for x in vs for v in (x if isinstance(x, (list, tuple, sp.Tuple, sp.MatrixBase)) else [x])]
    return e, vs


def poly_variable(e, vs):
    if vs:
        return vs[0]
    free = sorted(e.free_symbols, key=str)
    if len(free) == 1:
        return free[0]
    if not free:
        raise Unsupported("The expression has no variable")
    need_variable()


def poly_divide(j):
    """Polynomials > Divide: f/g as q + r/g (long division), in the variable of whichever of f, g has
    one variable, or the one they share (tcidiv)."""
    e, vs = poly_request(j)
    num, den = sp.fraction(sp.together(e.doit()))
    if vs:
        x = vs[0]
    else:
        a, b = num.free_symbols, den.free_symbols
        both = a & b
        x = next(iter(a)) if len(a) == 1 else next(iter(b)) if len(b) == 1 else next(iter(both)) if len(both) == 1 else None
        if x is None:
            need_variable()
    if sp.degree(num, x) < sp.degree(den, x):
        return {"kind": "value", "latex": tex(e)}
    q, r = sp.div(num, den, x)
    q, r = sp.expand(q), sp.expand(r)
    out = q if r == 0 else sp.Add(*sp.Add.make_args(q), sp.Mul(r, sp.Pow(den, -1), evaluate=False), evaluate=False)
    return {"kind": "value", "latex": tex(out)}


def poly_roots(j):
    """Polynomials > Roots: every root, as often as it is a root (degree <= 4 exactly, otherwise and
    for decimal coefficients as decimals), in a column, after ", roots: "."""
    e, vs = poly_request(j)
    p = sp.expand(e.doit())
    x = poly_variable(p, vs)
    P = sp.Poly(p, x)
    if P.degree() < 1:
        return {"kind": "solutions", "label": ", roots: ", "solutions": [tex(sp.EmptySet)]}
    if P.degree() < 5 and not any(isinstance(c, sp.Float) for c in P.coeffs()):
        rs = []
        for r, k in sp.roots(P, multiple=False).items():
            rs += [r] * k
        if len(rs) < P.degree():  # not all found exactly
            rs = P.nroots()
    else:
        rs = P.nroots()
    if x.is_real:  # assume(real): the real roots
        rs = [r for r in rs if r.is_real]
    if not rs:
        return {"kind": "solutions", "label": ", roots: ", "solutions": [tex(sp.EmptySet)]}
    rs = sorted(rs, key=lambda r: (float(sp.re(sp.N(r))), float(sp.im(sp.N(r)))))
    shown = tex(rs[0]) if len(rs) == 1 else tex(sp.Matrix(rs))
    return {"kind": "solutions", "label": ", roots: ", "solutions": [shown]}


def poly_sort(j):
    """Polynomials > Sort: the terms by decreasing degree in the variable (numbers collected, as
    MuPAD's polylib::sortMonomials; terms with other letters stay apart)."""
    e, vs = poly_request(j)
    p = sp.expand(e.doit())
    xs = vs or [poly_variable(p, vs)]
    terms = list(sp.Add.make_args(p))
    terms.sort(key=lambda t: tuple(-sp.degree(t, x) for x in xs))
    out = ""
    for t in terms:
        s = tex(t)
        out += s if not out else (" " + s if s.startswith("-") else " + " + s)
    return {"kind": "value", "latex": out}


def poly_collect(j):
    """Polynomials > Collect: the coefficients of each power of the variables asked for (5.5 asks)."""
    e, vs = poly_request(j)
    def one(x):
        x = sp.expand(x.doit()) if isinstance(x, sp.Basic) else x
        return sp.collect(x, vs or [main_variable(x)])
    r = last_side(e)
    r = r.applyfunc(one) if isinstance(r, sp.MatrixBase) else one(r)
    return {"kind": "value", "latex": tex(r)}


def poly_companion(j):
    """Polynomials > Companion Matrix (linalg::companion): ones below the diagonal, the last column
    minus the coefficients of the polynomial made monic, after ", Companion matrix: "."""
    e, vs = poly_request(j)
    p = sp.expand(e.doit())
    x = poly_variable(p, vs)
    P = sp.Poly(p, x)
    n = P.degree()
    if n < 1:
        raise Unsupported("Needs a polynomial of degree 1 or more")
    c = [sp.simplify(a / P.LC()) for a in reversed(P.all_coeffs())]  # a_0 .. a_n
    m = sp.zeros(n, n)
    for i in range(1, n):
        m[i, i - 1] = 1
    for i in range(n):
        m[i, n - 1] = -c[i]
    return {"kind": "solutions", "label": ", Companion matrix: ", "solutions": [tex(m)]}


EXTRA_OPS["divide"] = poly_divide
EXTRA_OPS["roots"] = poly_roots
EXTRA_OPS["sort"] = poly_sort
EXTRA_OPS["collect"] = poly_collect
EXTRA_OPS["companion"] = poly_companion

# (end of part: statpoly)


# -----------------------------------------------------------------------------
# part: defsmisc
# -----------------------------------------------------------------------------

# Compute > Interpret, Solve ODE > Laplace and Series, Transforms > Inverse Fourier,
# Definitions > Define MuPAD Name, and the Compute settings of 5.5 the engine uses
# (Compute > Settings, Tools > Computation Setup: digits shown, i or j, Bessel names ...).

# 5.5's defaults; the editor sends what is in force with "setoptions" (src/compute.js)
OPTIONS55 = {"digits": 5, "threshold": 5, "comp_digits": 10, "imaginary_j": False,
             "bessel_subscripts": False, "ode_series_order": 6}


def set_options(j):
    """setoptions {"digits": 5, "threshold": 5, ...}: the settings the answers follow from now on."""
    if isinstance(j, dict):
        for k, v in j.items():
            if k in OPTIONS55 and isinstance(v, type(OPTIONS55[k])):
                OPTIONS55[k] = v
    OPTIONS55["digits"] = max(1, min(OPTIONS55["digits"], OPTIONS55["comp_digits"]))
    OPTIONS55["threshold"] = max(1, OPTIONS55["threshold"])
    return {"kind": "text", "text": ""}


_shown_float_55 = shown_float


def shown_float(v):  # noqa: F811 (the Printer looks it up when it prints)
    """A decimal with 5.5's Digits Shown in Results (n) and Threshold for Scientific Notation (t):
    n significant digits, as d.ddd x 10^k from 10^t on and below 0.1."""
    n, t = OPTIONS55["digits"], OPTIONS55["threshold"]
    if (n, t) == (5, 5):
        return _shown_float_55(v)
    from decimal import Decimal
    d = Decimal(str(sp.Float(v, max(n, 10))))
    if not d.is_finite():
        return str(d)
    if d == 0:
        return "0.0"
    exact = len(d.normalize().as_tuple().digits) <= n
    k = Decimal(format(d, ".%de" % (n - 1))).adjusted()
    if -1 <= k < t:
        s = format(d.normalize(), "f") if exact else format(d, ".%df" % max(n - 1 - k, 0))
        return s if "." in s else s + ".0"
    m = format(d, ".%de" % (n - 1)).split("e")[0]
    if exact:
        m = m.rstrip("0")
        m = m + "0" if m.endswith(".") else m
    return "%s\\times 10^{%d}" % (m, k)


def evaluate_numerically_55(e):
    """Evaluate Numerically with 5.5's Digits Used in Computations (10 by default)."""
    r = evaluated(e)
    return r.evalf(OPTIONS55["comp_digits"]) if hasattr(r, "evalf") else r


OPERATIONS["numeric"] = evaluate_numerically_55

# i or j for the imaginary unit (5.5: Imaginary Unit, Change from i to j); the Bessel functions as
# J_v(z) (Use I, J, K and Y with Subscripts) or as BesselJ_v(z)
_print_55 = Printer55._print


def _print_with_j(self, expr, **kwargs):  # (sp.I prints itself, so it is caught here)
    return "j" if expr is sp.I and OPTIONS55["imaginary_j"] else _print_55(self, expr, **kwargs)


Printer55._print = _print_with_j


def _bessel_printer(name, own):
    def p(self, e, exp=None):
        if OPTIONS55["bessel_subscripts"]:
            return own(self, e, exp)
        t = r"\operatorname{%s}_{%s}\left(%s\right)" % (name, self._print(e.args[0]), self._print(e.args[1]))
        return t if exp is None else r"%s^{%s}" % (t, exp)
    return p


for _f, _n in (("besselj", "BesselJ"), ("bessely", "BesselY"), ("besseli", "BesselI"), ("besselk", "BesselK")):
    setattr(Printer55, "_print_" + _f, _bessel_printer(_n, getattr(Printer55, "_print_" + _f)))


def interpret(j):
    """Compute > Interpret (Ctrl+?): the formula as it is read, worked out no further, with
    brackets where they say what goes with what (5.5: 1/3x + 4 = 1/3 x + 4, sin x/2 = sin(x/2))."""
    if isinstance(j, dict):
        j = j.get("expr")
    with sp.evaluate(False):
        e = build(j)
    if hasattr(e, "replace"):  # e^x as the exponential function (a function: its argument is clear)
        e = e.replace(lambda y: isinstance(y, sp.Pow) and y.base == sp.E, lambda y: sp.exp(y.exp, evaluate=False))
    latex = Printer55({"mat_delim": answer_delim(), "ln_notation": True, "order": "none"}).doprint(e)
    return {"kind": "value", "latex": brackets(re.sub(r"([A-Za-z])\{\\left\(([^{}()]*?) \\right\)\}", r"\1(\2)", latex))}


def inverse_fourier(j):
    """Transforms > Inverse Fourier: F in w -> the f(x) whose transform it is (5.5: 2 pi Dirac(w),
    Is Fourier transform of 1), with MuPAD's F f(w) = int f(x) e^(iwx) dx."""
    e = apply_definitions(build(j))
    f = last_side(e).doit()
    free = getattr(f, "free_symbols", set())
    w = variable("w") if variable("w") in free or not free else main_variable(f)
    x = variable("t") if w == variable("x") else variable("x")
    r = Transform(f, w, x, 3).doit()
    return {"kind": "solutions", "label": ", Is Fourier transform of ", "solutions": [tex(r)]}


def ode_problem(j):
    """["OdeSystem", ["List", equations], ["List", ["List", name, x0, value, order], ...], order, variable]
    (as src/compute.js sends a column of equations and initial values, see odeRows; order: Series's
    number of terms or "Nothing"; variable: the independent variable 5.5 asks for, or "Nothing")
    -> (equations in y(x) with y' as Derivative, the unknown functions, the variable,
    {(function, order): (x0, value)})."""
    eq_jsons, inits_in = j[1][1:], [x[1:] for x in j[2][1:]]
    names = {i[0] for i in inits_in}

    def primed(n):  # the names written with a prime: y in y'
        if isinstance(n, list) and n:
            return ({n[1]} if n[0] == "Prime" and isinstance(n[1], str) else set()).union(*[primed(x) for x in n[1:]])
        return set()
    found = symbol_names(["List", *eq_jsons]) - names - primed(["List", *eq_jsons]) - set(CONSTANTS)
    given = j[4] if len(j) > 4 and isinstance(j[4], str) and j[4] != "Nothing" else None
    form = ode_form(["List", *eq_jsons], names, given or (found.pop() if len(found) == 1 else None))
    eqs = []
    for x in form[1:]:
        e = apply_definitions(build(x))
        eqs.append(e if isinstance(e, sp.Equality) else sp.Eq(e, 0))
    ds = [d for e in eqs for d in e.atoms(sp.Derivative)]
    if not ds:
        raise Unsupported("The equation needs a derivative, e.g. y'")
    var = ds[0].variables[0]
    funcs = sorted({d.expr.func for d in ds if isinstance(d.expr, sp.core.function.AppliedUndef)}, key=str)
    inits = {}
    for i in inits_in:
        name, x0, v, k = (*i, 0) if len(i) == 3 else i
        inits[(sp.Function(name), int(k))] = (build(x0), build(v))
    return eqs, funcs, var, inits


def ode_parts(eqs, funcs, var):
    """Each equation as {(f, k): coefficient} for f^(k)(x) and the rest; None when one is not linear."""
    marks = {}
    for f in funcs:
        top = max([d.derivative_count for e in eqs for d in e.atoms(sp.Derivative) if d.expr.func == f] + [0])
        for k in range(top + 1):
            marks[(f, k)] = sp.Dummy("%s%d" % (f, k))
    out = []
    for e in eqs:
        x = e.lhs - e.rhs
        for (f, k), m in sorted(marks.items(), key=lambda t: -t[0][1]):
            x = x.subs(f(var).diff(var, k) if k else f(var), m)
        if x.has(sp.Derivative) or any(isinstance(a, sp.core.function.AppliedUndef) and a.func in funcs for a in x.atoms(sp.Function)):
            return None
        poly = sp.Poly(sp.expand(x), *marks.values()) if marks else None
        if poly is None or poly.total_degree() > 1:
            return None
        coef = {fk: poly.coeff_monomial(m) for fk, m in marks.items()}
        rest = poly.coeff_monomial(1)
        out.append((coef, rest))
    return out


def initial_value(inits, f, k, at):
    """y^(k)(at) as given, else its name (y(0), y'(0))."""
    for (g, j), (x0, v) in inits.items():
        if g == f and j == k and x0 == at:
            return v
    return sp.Symbol(str(f) + "'" * k + "(%s)" % at)


def solve_ode_laplace(j):
    """Solve ODE > Laplace (MuPAD's ode::laplace): linear equations with constant coefficients,
    each term transformed (L y^(k) = s^k Y - s^(k-1) y(0) - ... - y^(k-1)(0)), solved for the
    transforms and transformed back. Other equations: no solution, as 5.5 gives none."""
    eqs, funcs, var, inits = ode_problem(j)
    parts = ode_parts(eqs, funcs, var)
    if parts is None or any(c.has(var) for coef, _ in parts for c in coef.values()):
        return {"kind": "solutions", "label": ", Laplace solution is: ", "solutions": []}
    s = sp.Dummy("s")
    Y = {f: sp.Dummy("Y" + str(f)) for f in funcs}
    lin = []
    for coef, rest in parts:
        t = sp.laplace_transform(rest, var, s, noconds=True) if rest != 0 else sp.Integer(0)
        if t.has(sp.LaplaceTransform):
            return {"kind": "solutions", "label": ", Laplace solution is: ", "solutions": []}
        for (f, k), c in coef.items():
            if c != 0:
                t += c * (s ** k * Y[f] - sum(s ** (k - 1 - i) * initial_value(inits, f, i, 0) for i in range(k)))
        lin.append(t)
    sol = sp.solve(lin, list(Y.values()), dict=True)
    if not sol:
        return {"kind": "solutions", "label": ", Laplace solution is: ", "solutions": []}
    found = []
    for f in funcs:
        F = sp.apart(sp.cancel(sol[0][Y[f]]), s) if sol[0][Y[f]].is_rational_function(s) else sol[0][Y[f]]
        y = sp.inverse_laplace_transform(F, s, var).subs(sp.Heaviside(var), 1)
        if y.has(sp.InverseLaplaceTransform):
            return {"kind": "solutions", "label": ", Laplace solution is: ", "solutions": []}
        found.append((f, sp.expand(sp.simplify(y))))
    if len(found) == 1:
        shown = sp.FiniteSet(found[0][1])
    else:
        shown = sp.FiniteSet(Bracketed(*[sp.Eq(f(var), y, evaluate=False) for f, y in found]))
    return {"kind": "solutions", "label": ", Laplace solution is: ", "solutions": [tex(shown)]}


def solve_ode_series(j):
    """Solve ODE > Series (MuPAD's ode::series): the Taylor series of the solution about the point
    of the initial values, to 5.5's Series Order for ODE Solutions (params: [order]; else the
    setting), each equation solved for its highest derivative. An initial value not given stays a
    name, y(0). 5.5: y' = y^2 + 4, y(0) = -2, order 5: {-2 + 8t - 16t^2 + 128/3 t^3 - 320/3 t^4 + O(t^5)}."""
    eqs, funcs, var, inits = ode_problem(j)
    order = int(build(j[3])) if len(j) > 3 and j[3] != "Nothing" else OPTIONS55["ode_series_order"]
    if order < 1:
        raise Unsupported("The order of series must be a positive whole number")
    at = {x0 for x0, _ in inits.values()}
    if len(at) > 1:
        raise Unsupported("The initial values must be at the same point")
    x0 = at.pop() if at else sp.Integer(0)
    high = {}
    for e in eqs:
        ds = [d for d in e.atoms(sp.Derivative) if d.expr.func in funcs]
        top = max(d.derivative_count for d in ds)
        d = [d for d in ds if d.derivative_count == top][0]
        if d.expr.func in high:
            raise Unsupported("Each unknown function needs one equation")
        sol = sp.solve(e, d)
        if len(sol) != 1:
            raise Unsupported("Cannot solve " + str(d))
        high[d.expr.func] = (top, sol[0])
    # the state: f^(k)(x) for k below each function's order, as symbols
    state = {(f, k): sp.Dummy("%s%d" % (f, k)) for f, (n, _) in high.items() for k in range(n)}

    def as_state(x):
        for (f, k), m in sorted(state.items(), key=lambda t: -t[0][1]):
            x = x.subs(f(var).diff(var, k) if k else f(var), m)
        return x
    rhs = {f: as_state(g) for f, (n, g) in high.items()}

    def total(x):  # d/dx along a solution
        r = sp.diff(x, var)
        for (f, k), m in state.items():
            nxt = state.get((f, k + 1), rhs[f])
            r += sp.diff(x, m) * nxt
        return r
    start = {m: initial_value(inits, f, k, x0) for (f, k), m in state.items()}
    out = []
    for f in sorted(high, key=str):
        n = high[f][0]
        coeffs, cur = [], None
        for m in range(order):
            if m < n:
                c = start[state[(f, m)]]
            else:
                cur = rhs[f] if cur is None else total(cur)
                c = sp.simplify(cur.subs(var, x0).subs(start))
            coeffs.append(sp.simplify(c / sp.factorial(m)))
        big_o = sp.Order((var - x0) ** order, (var, x0))
        out.append((f, PowerSeries(var - x0, big_o, *coeffs)))
    shown = sp.FiniteSet(out[0][1]) if len(out) == 1 else sp.FiniteSet(Bracketed(*[sp.Eq(f(var), y, evaluate=False) for f, y in out]))
    return {"kind": "solutions", "label": ", Series solution is: ", "solutions": [tex(shown)]}


EXTRA_OPS["interpret"] = interpret
EXTRA_OPS["inversefourier"] = inverse_fourier
EXTRA_OPS["odelaplace"] = solve_ode_laplace
EXTRA_OPS["odeseries"] = solve_ode_series
EXTRA_OPS["setoptions"] = set_options

# Definitions > Define MuPAD Name: a name of the document stands for a MuPAD function (5.5's pages:
# n(x) <-> nextprime(x), D(x) <-> numlib::divisors(x), S(x, i, j) <-> linalg::swapRow(x, i, j)) or a
# MuPAD value (PI). Here the MuPAD name is looked up among the MuPAD functions opensw knows, else
# taken as SymPy's function of that name.
MUPAD_SYMPY = {
    "isprime": sp.isprime, "ithprime": sp.prime, "prevprime": sp.prevprime, "ifactor": sp.factorint,
    "fibonacci": sp.fibonacci, "binomial": sp.binomial, "gcd": sp.gcd, "igcd": sp.igcd, "lcm": sp.lcm, "ilcm": sp.ilcm,
    "phi": sp.totient, "mobius": sp.mobius, "numdivisors": sp.divisor_count, "sumdivisors": lambda n: sp.divisor_sigma(n, 1),
    "abs": sp.Abs, "sign": sp.sign, "floor": sp.floor, "ceil": sp.ceiling, "round": lambda x: sp.Integer(round(x)),
    "fact": sp.factorial, "dfact": sp.factorial2, "gamma": sp.gamma, "beta": sp.beta, "zeta": sp.zeta, "erf": sp.erf,
    "max": sp.Max, "min": sp.Min, "sqrt": sp.sqrt, "exp": sp.exp, "ln": sp.log, "sin": sp.sin, "cos": sp.cos, "tan": sp.tan,
    "det": lambda m: det(as_matrix(m)), "transpose": lambda m: as_matrix(m).T, "rank": lambda m: as_matrix(m).rank(),
    "nops": lambda x: sp.Integer(len(x.args) if hasattr(x, "args") else 1),
}
MUPAD_VALUES = {"PI": sp.pi, "E": sp.E, "I": sp.I, "EULER": sp.EulerGamma, "CATALAN": sp.Catalan, "infinity": sp.oo}


def mupad_target(name):
    key = name.split("::")[-1]
    if key in MUPAD_COMMANDS:
        return MUPAD_COMMANDS[key]
    if key in MUPAD_SYMPY:
        return MUPAD_SYMPY[key]
    f = getattr(sp, key, None)
    # SymPy's own mathematical functions only (not those that read text: sympify, parse_expr ...)
    if isinstance(f, type) and issubclass(f, sp.Function):
        return f
    if callable(f) and getattr(f, "__module__", "").startswith(("sympy.ntheory", "sympy.functions", "sympy.polys.polytools")):
        return f
    raise Unsupported("Not a MuPAD name opensw knows: " + name)


def map_name(lhs, rhs):
    """define with ["Equal", ["n", "x"], ["MapName", "'nextprime'"]] (a procedure) or
    ["Equal", "c", ["MapName", "'PI'"]] (a value)."""
    target = rhs[1].strip("'") if len(rhs) > 1 and isinstance(rhs[1], str) else ""
    if isinstance(lhs, str):
        if target not in MUPAD_VALUES:
            raise Unsupported("Not a MuPAD value opensw knows: " + target)
        s = variable(lhs)
        DEFINITIONS[s.name] = (s, MUPAD_VALUES[target])
        shown = "%s \\leftrightarrow \\text{%s}" % (tex(s), target)
        return {"kind": "value", "latex": shown}
    if not (isinstance(lhs, list) and lhs and isinstance(lhs[0], str) and all(isinstance(a, str) for a in lhs[1:])):
        raise Unsupported("Write the name as n(x) or n(x, y)")
    name, args = lhs[0], [variable(a) for a in lhs[1:]]
    fn = mupad_target(target)

    def ev(cls, *a):
        if len(a) == len(args) and all(getattr(x, "is_number", False) or is_matrix(x) for x in a):
            r = fn(*a)
            return sp.sympify(r) if isinstance(r, (int, float, bool)) else (sp.Dict(r) if isinstance(r, dict) else r)
        return None
    cls = type(name, (sp.Function,), {"eval": classmethod(ev)})
    DEFINITIONS[name] = (sp.Function(name), cls)
    shown = "%s \\leftrightarrow \\text{%s}(%s)" % (tex(sp.Function(name)(*args)), target, ", ".join(str(a) for a in args))
    NUMERIC_SHOWN[name] = [shown]
    return {"kind": "value", "latex": shown}


_compute_55 = compute


def compute(op, mathjson_text):  # noqa: F811 (Define MuPAD Name comes as a definition, kept with the others)
    if op == "define":
        try:
            j = json.loads(mathjson_text)
        except ValueError:
            j = None
        if isinstance(j, list) and j[:1] == ["Equal"] and len(j) == 3 and isinstance(j[2], list) and j[2][:1] == ["MapName"]:
            try:
                return json.dumps(map_name(j[1], j[2]))
            except Unsupported as x:
                return json.dumps({"error": f"Cannot compute this yet: {x}"})
            except Exception as x:
                return json.dumps({"error": f"{type(x).__name__}: {x}"})
    return _compute_55(op, mathjson_text)

# (end of part: defsmisc)


# -----------------------------------------------------------------------------
# part: anim
# -----------------------------------------------------------------------------

# (end of part: anim)


# -----------------------------------------------------------------------------
# part: core55
# -----------------------------------------------------------------------------

# Compute > Settings > Engine Setup, Solve Options (MuPAD's solve(.., MaxDegree = n, IgnoreSpecialCases),
# swfcns.mu tcisolve2; 5.5's help dm3-3.tex, dm3-5.tex, dm7-3.tex):
# - Maximum Degree (3): a polynomial factor of higher degree is not solved in radicals; its roots are
#   rho_1 .. "where rho_1 is a root of X^4 + X - 1, X" (with 1, quadratics too).
# - Ignore Special Cases (off): an equation whose coefficients have other letters is solved case by
#   case, as MuPAD: {-(y + cos x)/(x - 1)} if x != 1, C if x = 1 and y = -cos 1, empty otherwise.
OPTIONS55.update({"max_degree": 3, "ignore_special": False})
ROOT_COUNT = [0]


class RootOf55(sp.Basic):
    """rho_k: a root of a polynomial (args: k, the polynomial in X_k, X_k)."""

    def _latex(self, printer):
        return r"\rho _{%s}" % printer._print(self.args[0])


def _cases_tex(cases):
    rows = [r"%s & \text{if} & %s" % (s, c) for s, c in cases]
    return r"\left\{ \begin{array}{ccc} %s \end{array}\right." % r" \\ ".join(rows)


def _solved(c):
    """c = 0 solved for one letter when that is simple: (letter, value), else None"""
    c = sp.factor(c)
    for s in sorted(c.free_symbols, key=str):
        try:
            sol = sp.solve(c, s)
        except Exception:  # noqa: BLE001
            continue
        if len(sol) == 1 and s not in sol[0].free_symbols:
            return s, sol[0]
    return None


def _condition_tex(c, zero):
    """c = 0 (zero) or c != 0 as MuPAD writes it: solved for a letter when that is simple (x = 1)."""
    v = _solved(c)
    if v:
        return tex(sp.Eq(*v) if zero else sp.Ne(*v))
    return tex(sp.Eq(sp.factor(c), 0) if zero else sp.Ne(sp.factor(c), 0))


def _poly_cases(p, x, conds, out):
    """the cases of p(x) = 0 with letters in its coefficients: [(solution set as LaTeX, [conditions])]
    (a case's condition put into the rest: x = 1 makes y + cos x the condition y = -cos 1)"""
    coeffs = p.all_coeffs()
    while coeffs and coeffs[0] == 0:
        coeffs = coeffs[1:]
    if not coeffs or len(coeffs) == 1:
        c = coeffs[0] if coeffs else sp.Integer(0)
        if c == 0 or (c.free_symbols and sp.simplify(c) == 0):
            out.append((r"\mathbb{C}", conds))
        elif not c.free_symbols:
            out.append((r"\emptyset", conds))
        else:
            out.append((r"\mathbb{C}", conds + [_condition_tex(c, True)]))
            out.append((r"\emptyset", conds + [_condition_tex(c, False)]))
        return
    lead = coeffs[0]
    q = sp.Poly(coeffs, x)
    if lead.free_symbols:
        found = list(sp.solve(q.as_expr(), x))
        out.append((r"\left\{ %s\right\}" % ", ".join(tex(r) for r in found), conds + [_condition_tex(lead, False)]))
        v = _solved(lead)
        rest = [sp.simplify(c.subs(*v)) for c in coeffs[1:]] if v else coeffs[1:]
        _poly_cases(sp.Poly(rest, x), x, conds + [_condition_tex(lead, True)], out)
        return
    found = list(sp.solve(q.as_expr(), x))
    out.append((r"\left\{ %s\right\}" % ", ".join(tex(r) for r in found) if found else r"\emptyset", conds))


def solve_options55(e, unknowns=None, principal=False):
    """Solve > Exact of one polynomial equation in one unknown, with the Solve Options; None: as before."""
    if isinstance(e, (list, sp.MatrixBase)) or not isinstance(e, sp.Equality) or e.has(sp.Float):
        return None
    f = sp.expand(e.lhs - e.rhs)
    free = sorted(f.free_symbols - UNIT_SYMBOLS, key=str)
    if unknowns and len(unknowns) != 1:
        return None
    x = unknowns[0] if unknowns else (free[0] if free else None)
    if x is None or not f.is_polynomial(x) or f.has(sp.Derivative):
        return None
    p = sp.Poly(f, x)
    if p.degree() < 1:
        return None
    params = set().union(*[c.free_symbols for c in p.all_coeffs()])
    if params and not OPTIONS55["ignore_special"] and not principal:
        out = []
        _poly_cases(p, x, [], out)
        if len(out) > 1:  # a real case split; one case is the usual answer
            return {"kind": "solutions", "solutions": [_cases_tex([(s, r" \wedge ".join(c)) for s, c in out])]}
        return None
    if params:
        return None
    # Maximum Degree: the factors over the rationals; one of higher degree kept as a root of it
    _, factors = sp.factor_list(p.as_expr(), x)
    if all(sp.degree(g, x) <= OPTIONS55["max_degree"] for g, _ in factors):
        return None
    explicit, implicit = [], []
    ROOT_COUNT[0] = 0  # rho_1, X_1 in each answer
    for g, _ in factors:
        d = sp.degree(g, x)
        if d <= OPTIONS55["max_degree"]:
            explicit += sp.solve(g, x)
        else:
            ROOT_COUNT[0] += 1
            k = ROOT_COUNT[0]
            X = sp.Symbol("X_%d" % k)
            implicit.append((k, g.subs(x, X), X))
    explicit.sort(key=lambda r: [float(t) for t in sp.N(r).as_real_imag()])
    rhos = [RootOf55(sp.Integer(k), g, X) for k, g, X in implicit]
    main = " \\cup ".join(([r"\left\{ %s\right\}" % ", ".join(tex(r) for r in explicit)] if explicit else []) + [tex(r) for r in rhos])
    where = "; ".join(r"%s \text{ is a root of } %s, %s" % (tex(r), tex(g), tex(X)) for r, (k, g, X) in zip(rhos, implicit))
    return {"kind": "solutions", "solutions": [main + r" \text{ where } " + where]}


_solve_answer_before55 = solve_answer


def solve_answer(e, unknowns=None, principal=False):  # noqa: F811 (compute() looks it up when it solves)
    return solve_options55(e, unknowns, principal) or _solve_answer_before55(e, unknowns, principal)

# (end of part: core55)
