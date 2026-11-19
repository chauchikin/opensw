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
        return sp.Matrix(a(0)).det()
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
            power = "" if k == 0 else printer.parenthesize(u, 1000) + ("^{%d}" % k if k > 1 else "")
            coeff = printer._print(c) if k == 0 or c != 1 else ""
            if k and c.is_Add:
                coeff = "\\left(%s\\right)" % coeff
            out += ("-" if minus else "+" if out else "") + coeff + power
        return (out + "+" if out else "") + printer._print(order)


def mupad_series(f, at=None, order=sp.Integer(5)):
    """MuPAD's series(f, x = a, n): the terms up to (x - a)^(n-1) in powers of x - a, and O((x - a)^n)."""
    x, a = (at.lhs, at.rhs) if isinstance(at, sp.Equality) else (at, 0) if isinstance(at, sp.Symbol) else (main_variable(f), 0)
    if not (getattr(order, "is_Integer", False) and order > 0):
        raise Unsupported("The order of series must be a positive whole number")
    t = sp.Dummy("t")
    s = sp.series(f.subs(x, a + t), t, 0, int(order)).removeO()
    big_o = sp.Order((x - a) ** int(order), (x, a))
    if not s.is_polynomial(t):  # negative powers: as SymPy writes it
        return Shown(sp.Add(s.subs(t, x - a), big_o, evaluate=False))
    p = sp.Poly(s, t)
    return PowerSeries(x - a, big_o, *[p.coeff_monomial(t ** k) for k in range(int(order))])


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
    "Max": lambda m: sp.Max(*m), "Min": lambda m: sp.Min(*m), "Abs": lambda m: m.det(),
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
    r = antiderivative(e, e.doit())
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


def power_series(e, var=None, order=5, point=0):
    """The series up to (var - point)^order; var: x if present (main_variable)."""
    e = last_side(e).doit()
    return sp.series(e, var or main_variable(e), point, order + 1)


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
    return sp.inverse_laplace_transform(f, s, sp.Symbol("t"))


def fourier(e):
    f = last_side(e).doit()
    return sp.fourier_transform(f, main_variable(f), sp.Symbol("k"))


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
    if op == "series":  # params: [variable, order, point]
        order = int(numbers[0]) if numbers else 5
        point = numbers[1] if len(numbers) > 1 else 0
        return {"kind": "value", "latex": tex(power_series(e, var, order, point))}
    if op == "differentiate":  # params: [variable, times]
        v = var or main_variable(last_side(e))
        return {"kind": "value", "latex": tex(sp.diff(last_side(e).doit(), v, int(numbers[0]) if numbers else 1))}
    if op == "partialfractions":  # params: [variable]
        return {"kind": "value", "latex": tex(partial_fractions(e, var))}
    if op == "integrate":  # params: [variable]
        return {"kind": "value", "latex": tex(sp.integrate(last_side(e).doit(), var or main_variable(last_side(e))))}
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
    "determinant": lambda e: sp.Matrix(last_side(e)).det(),
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
    "integrate": lambda e: sp.integrate(last_side(e).doit(), main_variable(last_side(e))),
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


def exam_value(j, env, rng):
    """MathJSON -> SymPy, with the variables of env (name -> (value, delayed MathJSON or None))
    and new random numbers for rand and randmat."""
    holes = {}

    def hole(v):
        name = "_eb%d" % len(holes)
        holes[sp.Symbol(name)] = v
        return name

    def walk(n):
        if isinstance(n, str) and n in env:
            value, delayed = env[n]
            return walk(delayed) if delayed is not None else hole(value)
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
            if st.get("delayed"):
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
                e = e.subs({s: value for s in e.free_symbols if s.name == key.name})
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
