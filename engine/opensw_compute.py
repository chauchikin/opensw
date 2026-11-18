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
    "True": sp.true,
    "False": sp.false,
    "Nothing": None,
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
}

RELATIONS = {
    "Equal": sp.Eq, "NotEqual": sp.Ne, "Less": sp.Lt, "LessEqual": sp.Le,
    "Greater": sp.Gt, "GreaterEqual": sp.Ge,
}


class Unsupported(Exception):
    """A part of the formula this engine cannot compute with."""


def build(j):
    """MathJSON -> SymPy object."""
    if isinstance(j, bool):
        return sp.true if j else sp.false
    if isinstance(j, int):
        return sp.Integer(j)
    if isinstance(j, float):
        return sp.Float(j)
    if isinstance(j, dict):  # {"num": "1.25"} or {"sym": "x"} or {"str": "..."}
        if "num" in j:
            return sp.nsimplify(j["num"]) if "." in j["num"] else sp.Integer(j["num"])
        if "sym" in j:
            return build(j["sym"])
        raise Unsupported("文字")
    if isinstance(j, str):
        if j in CONSTANTS:
            return CONSTANTS[j]
        if j.startswith("'"):
            raise Unsupported("文字")
        return sp.Symbol(j)
    head, args = j[0], j[1:]
    if not isinstance(head, str):
        raise Unsupported(str(head))
    if head == "Error":
        raise Unsupported("公式裡有看不懂的寫法")
    a = lambda i: build(args[i])  # noqa: E731
    if head == "Add":
        return sp.Add(*[build(x) for x in args])
    if head == "Multiply":
        return sp.Mul(*[build(x) for x in args])
    if head == "Subtract":
        return a(0) - a(1) if len(args) == 2 else -a(0)
    if head == "Negate":
        return -a(0)
    if head == "Divide":
        return a(0) / a(1)
    if head == "Rational":
        return sp.Rational(a(0), a(1))
    if head == "Power":
        return sp.Pow(a(0), a(1))
    if head == "Square":
        return a(0) ** 2
    if head == "Root":
        return sp.root(a(0), a(1))
    if head == "Log":
        return sp.log(a(0), a(1)) if len(args) > 1 else sp.log(a(0), 10)
    if head == "Lb":
        return sp.log(a(0), 2)
    if head == "Complex":
        return a(0) + sp.I * a(1)
    if head in FUNCTIONS:
        return FUNCTIONS[head](*[build(x) for x in args])
    if head in RELATIONS:
        return RELATIONS[head](a(0), a(1))
    if head in ("Delimiter", "Hold", "Parentheses"):
        items = [build(x) for x in args if x != "Nothing"]
        return items[0] if len(items) == 1 else sp.Tuple(*items)
    if head == "Block":
        return a(-1)
    if head == "List":
        return [build(x) for x in args]
    if head == "Matrix":
        rows = build(args[0])
        return sp.Matrix(rows)
    if head == "Determinant":
        return sp.Matrix(a(0)).det()
    if head == "Transpose":
        return sp.Matrix(a(0)).T
    if head == "Inverse":
        return sp.Matrix(a(0)).inv()
    if head in ("Integrate", "Sum", "Product"):
        body, var = function_body(args[0])
        lims = [limits(x) for x in args[1:]] or ([(var,)] if var is not None else [])
        fn = {"Integrate": sp.Integral, "Sum": sp.Sum, "Product": sp.Product}[head]
        return fn(body, *[l if len(l) > 1 else l[0] for l in lims])
    if head == "Limit":
        body, var = function_body(args[0])
        return sp.Limit(body, var, a(1))
    if head == "D":
        return sp.Derivative(a(0), *[build(x) for x in args[1:]])
    # an unknown head with arguments: a function written by the user, e.g. f(x)
    if head[:1].islower():
        return sp.Function(head)(*[build(x) for x in args])
    raise Unsupported(head)


def function_body(j):
    """["Function", ["Block", body], "x"] -> (body, x); a plain expression -> (expr, None)."""
    if isinstance(j, list) and j and j[0] == "Function":
        variables = [sp.Symbol(v) for v in j[2:]]
        return build(j[1]), (variables[0] if variables else None)
    return build(j), None


def limits(j):
    """["Limits", "x", 0, 1] -> (x, 0, 1); bounds of "Nothing" are left out."""
    if isinstance(j, list) and j and j[0] in ("Limits", "Tuple", "Triple", "Pair"):
        parts = [build(x) for x in j[1:]]
        return tuple(p for p in parts if p is not None)
    return (build(j),)


# ---------------------------------------------------------------------------
# operations of the Compute menu
# ---------------------------------------------------------------------------

def last_side(e):
    """The expression to work on: for "a = b" the right side (so results can be chained)."""
    return e.rhs if isinstance(e, sp.Equality) else e


def evaluate(e):
    e = last_side(e)
    if isinstance(e, sp.MatrixBase):
        return e
    r = e.doit()
    return sp.simplify(r) if r == e else r


def evaluate_numerically(e):
    r = evaluate(e)
    return r.evalf(10) if hasattr(r, "evalf") else r


def factor(e):
    e = last_side(e)
    if e.is_Integer:
        return sp.Mul(*[p if k == 1 else sp.Pow(p, k, evaluate=False) for p, k in sp.factorint(e).items()], evaluate=False)
    return sp.factor(e.doit())


def solve(e):
    """-> list of solutions, each a list of (variable, value)."""
    eqs = e if isinstance(e, list) else [e]
    eqs = [q if isinstance(q, sp.Equality) else sp.Eq(q, 0) for q in eqs]
    variables = sorted(set().union(*[q.free_symbols for q in eqs]), key=str)
    found = sp.solve(eqs, variables, dict=True)
    return [[(v, s[v]) for v in variables if v in s] for s in found]


def check_equality(e):
    if not isinstance(e, sp.Equality):
        raise Unsupported("要有等號")
    return sp.simplify(e.lhs - e.rhs) == 0


def main_variable(e):
    """The variable an operation works in: x if present, otherwise the first one."""
    free = sorted(e.free_symbols, key=str)
    if not free:
        raise Unsupported("式子裡沒有變數")
    for name in ("x", "t", "s", "z", "y"):
        for v in free:
            if v.name == name:
                return v
    return free[0]


def power_series(e, order=6):
    e = last_side(e).doit()
    return sp.series(e, main_variable(e), 0, order)


def extrema(e):
    """Critical points of f(x) and the value there: solutions of f'(x) = 0."""
    f = last_side(e).doit()
    x = main_variable(f)
    pts = sp.solve(sp.diff(f, x), x)
    return [[(x, p), (sp.Symbol("f"), sp.simplify(f.subs(x, p)))] for p in pts]


def solve_numeric(e):
    """Real numerical solutions of one equation in one variable (polynomials: all roots)."""
    eq = e if isinstance(e, sp.Equality) else sp.Eq(e, 0)
    expr = eq.lhs - eq.rhs
    x = main_variable(expr)
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
    return [[(x, sp.Float(r, 10) if r.is_real else sp.N(r, 10))] for r in roots]


def ode_form(j):
    """MathJSON of an ODE as typed (y'' + y = 0, y'(x) = 2y(x), dy/dx = y) -> MathJSON in
    which the unknown is the function y(x) and its derivatives are ["D", ["y", "x"], "x", ...]."""
    names, var = set(), None

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
    var = var or "x"

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
        raise Unsupported("要有未知函數，例如 y(x)")
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
        raise Unsupported("要一列數字")
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


def implicit_derivative(e):
    """dy/dx from F(x, y) = 0 (or F = G)."""
    eq = e if isinstance(e, sp.Equality) else sp.Eq(e, 0)
    f = eq.lhs - eq.rhs
    x, y = sp.Symbol("x"), sp.Symbol("y")
    if y not in f.free_symbols:
        raise Unsupported("要有 x 和 y 的式子")
    return sp.simplify(sp.idiff(f, y, x))


def laplace(e):
    f = last_side(e).doit()
    t = main_variable(f)
    return sp.laplace_transform(f, t, sp.Symbol("s"), noconds=True)


def inverse_laplace(e):
    f = last_side(e).doit()
    s = sp.Symbol("s") if sp.Symbol("s") in f.free_symbols else main_variable(f)
    return sp.inverse_laplace_transform(f, s, sp.Symbol("t"))


def fourier(e):
    f = last_side(e).doit()
    return sp.fourier_transform(f, main_variable(f), sp.Symbol("k"))


OPERATIONS = {
    "evaluate": evaluate,
    "numeric": evaluate_numerically,
    "simplify": lambda e: sp.simplify(last_side(e).doit()),
    "expand": lambda e: sp.expand(last_side(e).doit()),
    "factor": factor,
    "determinant": lambda e: sp.Matrix(last_side(e)).det(),
    "inverse": lambda e: sp.Matrix(last_side(e)).inv(),
    "transpose": lambda e: sp.Matrix(last_side(e)).T,
    "eigenvalues": lambda e: sp.Matrix(last_side(e)).eigenvals(),
    # Polynomials
    "partialfractions": lambda e: sp.apart(sp.together(last_side(e).doit())),
    "collect": lambda e: sp.collect(sp.expand(last_side(e).doit()), main_variable(last_side(e))),
    "combine": lambda e: sp.powsimp(sp.logcombine(sp.trigsimp(sp.together(last_side(e).doit())), force=True)),
    "rewrite_exp": lambda e: last_side(e).doit().rewrite(sp.exp),
    "rewrite_sincos": lambda e: last_side(e).doit().rewrite(sp.cos).rewrite(sp.sin),
    # Calculus
    "series": power_series,
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
    "implicitdiff": implicit_derivative,
}


def tex(x):
    """LaTeX as Scientific Word shows it (matrices in parentheses)."""
    # f{\left(x \right)} -> f(x): a function applied to simple arguments, as it is typed
    return re.sub(r"([A-Za-z])\{\\left\(([^{}()]*?) \\right\)\}", r"\1(\2)", sp.latex(x, mat_delim="("))


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


# Compute > Definitions: names given a value or a function, used by every later computation
# (kept while the editor runs, like 5.5)
DEFINITIONS = {}  # name -> (Symbol or Function class, value or Lambda)


def define(e):
    if not isinstance(e, sp.Equality):
        raise Unsupported("定義要寫成 x = 3 或 f(x) = x^2")
    lhs, rhs = e.lhs, apply_definitions(e.rhs)
    if isinstance(lhs, sp.Symbol):
        DEFINITIONS[lhs.name] = (lhs, rhs)
    elif isinstance(lhs, sp.Function) and isinstance(lhs.func, sp.core.function.UndefinedFunction) and all(isinstance(a, sp.Symbol) for a in lhs.args):
        DEFINITIONS[lhs.func.__name__] = (lhs.func, sp.Lambda(lhs.args, rhs))
    else:
        raise Unsupported("左邊要是一個名稱或 f(x) 這種函數")
    return sp.Eq(lhs, rhs)


def apply_definitions(e):
    if not DEFINITIONS or not hasattr(e, "subs"):
        return e
    for _ in range(5):  # definitions may use other definitions
        before = e
        for key, value in DEFINITIONS.values():
            e = e.replace(key, value) if isinstance(value, sp.Lambda) else e.subs(key, value)
        if e == before:
            break
    return e


def compute(op, mathjson_text):
    """-> JSON text: {"latex": ..., "kind": "value"|"solutions"|"boolean"} or {"error": ...}."""
    try:
        if op == "plot":  # mathjson_text: {"expr": MathJSON, "var": "x", "a": .., "b": .., "n": ..}
            p = json.loads(mathjson_text)
            e = build(p["expr"])
            var = sp.Symbol(p.get("var") or "x")
            free = e.free_symbols - {var}
            if free:
                raise Unsupported("沒有給值的變數 " + ", ".join(sorted(str(x) for x in free)))
            xs, ys = plot_points(e, var, float(p["a"]), float(p["b"]), int(p.get("n", 100)))
            return json.dumps({"kind": "points", "x": xs, "y": ys})
        if op == "version":
            import mpmath
            return json.dumps({"kind": "solutions", "solutions": [f"SymPy {sp.__version__}", f"mpmath {mpmath.__version__}"]})
        if op == "cleardefs":
            DEFINITIONS.clear()
            return json.dumps({"kind": "solutions", "solutions": []})
        if op == "showdefs":
            shown = [f"{tex(k(*v.variables))} = {tex(v.expr)}" if isinstance(v, sp.Lambda) else f"{tex(k)} = {tex(v)}"
                     for k, v in DEFINITIONS.values()]
            return json.dumps({"kind": "solutions", "solutions": shown})
        j = json.loads(mathjson_text)
        e = build(ode_form(j) if op == "ode" else j)
        if op == "define":
            return json.dumps({"kind": "value", "latex": tex(define(e))})
        e = apply_definitions(e)
        if op == "solve":
            sols = solve(e)
            parts = [", ".join(f"{tex(v)}={tex(x)}" for v, x in s) for s in sols]
            return json.dumps({"kind": "solutions", "solutions": parts})
        if op in ("extrema", "numericsolve"):
            sols = extrema(e) if op == "extrema" else solve_numeric(e)
            parts = [", ".join(f"{tex(v)}={tex(x)}" for v, x in s) for s in sols]
            return json.dumps({"kind": "solutions", "solutions": parts})
        if op == "ode":
            return json.dumps({"kind": "solutions", "solutions": [tex(s) for s in solve_ode(e)]})
        if op == "check":
            return json.dumps({"kind": "boolean", "value": bool(check_equality(e))})
        r = OPERATIONS[op](e)
        if isinstance(r, dict):  # eigenvalues with multiplicities
            r = sp.FiniteSet(*r.keys())
        return json.dumps({"kind": "value", "latex": tex(r)})
    except Unsupported as x:
        return json.dumps({"error": f"還不能計算：{x}"})
    except Exception as x:  # SymPy raises many kinds; the editor shows the message
        return json.dumps({"error": f"{type(x).__name__}: {x}"})
