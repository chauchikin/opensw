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
    if head in ("And", "Or"):
        return (sp.And if head == "And" else sp.Or)(*[build(x) for x in args])
    if head == "Not":
        return sp.Not(a(0))
    if head == "Mod":
        return sp.Mod(a(0), a(1))
    if head == "Set":
        return sp.FiniteSet(*[build(x) for x in args])
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


# ---------------------------------------------------------------------------
# operations that need more input than the formula (asked in a dialog):
# compute(op, '{"expr": MathJSON, "params": [MathJSON, ...]}')
# ---------------------------------------------------------------------------

def the_integral(e):
    e = last_side(e)
    if not isinstance(e, sp.Integral) or len(e.limits) != 1:
        raise Unsupported("要把游標放在一個積分裡")
    return e


def by_parts(e, u):
    """Calculus > Integrate by Parts: u is the part to differentiate; the integral is left
    unevaluated, as 5.5 shows it: u v - integral of v u'."""
    i = the_integral(e)
    lim = i.limits[0]
    x = lim[0]
    v = sp.integrate(sp.cancel(i.function / u), x)
    if v.has(sp.Integral):
        raise Unsupported("剩下的部分積不出來，換一個要微分的部分試試")
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
        raise Unsupported("要寫成 u = g(x) 或 x = h(u)")
    if eq.lhs == x:
        return i.transform(x, eq.rhs)
    if isinstance(eq.lhs, sp.Symbol) and x in eq.rhs.free_symbols:
        return i.transform(eq.rhs, eq.lhs)
    raise Unsupported("左邊要是新的變數 u（u = g(x)）或積分變數（x = h(u)）")


def approximate_integral(e, method, n):
    """Calculus > Approximate Integral: left, midpoint, right, trapezoid or Simpson with n
    subintervals of a definite integral."""
    i = the_integral(e)
    if len(i.limits[0]) != 3:
        raise Unsupported("要有上下限的積分")
    x, a, b = i.limits[0]
    n = int(n)
    if n < 1 or (method == "simpson" and n % 2):
        raise Unsupported("Simpson 法的區間數要是正偶數" if method == "simpson" else "區間數要是正整數")
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
        raise Unsupported("次數要在 1 到 1000 之間")
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
        raise Unsupported("要有遞迴式，例如 a_{n+1} = 2a_n + 1")
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
        raise Unsupported("這個遞迴式解不出來")
    return sp.Eq(a(n), r)


# Simplex (linear programming); the variables are taken as nonnegative, as in 5.5

def lp_parts(items):
    """[objective, constraint, ...] -> (objective, constraints including x >= 0)."""
    if len(items) < 2:
        raise Unsupported("第一列寫目標函數，下面每列一條限制式")
    obj, cons = items[0], items[1:]
    if not all(isinstance(c, (sp.LessThan, sp.GreaterThan, sp.StrictLessThan, sp.StrictGreaterThan, sp.Equality)) for c in cons):
        raise Unsupported("限制式要用 ≤、≥ 或 =")
    variables = sorted(set().union(obj.free_symbols, *[c.free_symbols for c in cons]), key=str)
    return obj, list(cons) + [v >= 0 for v in variables], variables


def lp_optimum(items, maximize):
    from sympy.solvers.simplex import lpmax, lpmin, InfeasibleLPError, UnboundedLPError
    obj, cons, variables = lp_parts(items)
    try:
        value, point = (lpmax if maximize else lpmin)(obj, cons)
    except InfeasibleLPError:
        raise Unsupported("限制式沒有共同的解（不可行）")
    except UnboundedLPError:
        raise Unsupported("沒有最大值" if maximize else "沒有最小值")
    parts = [f"{tex(v)}={tex(point.get(v, 0))}" for v in variables]
    parts.append(("\\text{最大值}" if maximize else "\\text{最小值}") + "=" + tex(value))
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
        raise Unsupported("要一個向量（一行或一列的矩陣）")
    return list(e)


def potential(F, xs):
    """A scalar potential phi with grad phi = F (F must have curl 0)."""
    if len(F) != len(xs):
        raise Unsupported(f"向量要有 {len(xs)} 個分量（和基底變數一樣多）")
    for i in range(len(xs)):
        for j in range(i + 1, len(xs)):
            if sp.simplify(sp.diff(F[i], xs[j]) - sp.diff(F[j], xs[i])) != 0:
                raise Unsupported("這個向量場沒有位勢（旋度不是 0）")
    phi = sp.Integer(0)
    for i, v in enumerate(xs):
        phi += sp.integrate(sp.simplify(F[i] - sp.diff(phi, v)), v)
    return sp.simplify(phi)


def vector_potential(F, xs):
    """A with curl A = F (F must have divergence 0); A_z = 0."""
    if len(xs) != 3 or len(F) != 3:
        raise Unsupported("向量位勢只有三維")
    x, y, z = xs
    if sp.simplify(sum(sp.diff(F[i], xs[i]) for i in range(3))) != 0:
        raise Unsupported("這個向量場沒有向量位勢（散度不是 0）")
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
            raise Unsupported(f"向量要有 {len(xs)} 個分量（和基底變數一樣多）")
        return sp.simplify(sum(sp.diff(F[i], xs[i]) for i in range(len(xs))))
    if op == "curl":
        if len(F) != 3 or len(xs) != 3:
            raise Unsupported("旋度只有三維")
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
            return {"kind": "text", "text": "（可行）" if lp_feasible(items) else "（不可行：限制式沒有共同的解）"}
        label = "，標準形式：" if op == "standardize" else "，對偶問題（求最小值，y 都 ≥ 0）："
        return {"kind": "solutions", "label": label, "solutions": [column(lp_standard(items) if op == "standardize" else lp_dual(items))]}
    e = apply_definitions(build(j))
    ps = [build(p) if not isinstance(p, str) or p[:1] != "'" else p.strip("'") for p in params]
    if op in VECTOR_OPS:
        xs = [p for p in ps if isinstance(p, sp.Symbol)] or list(sp.symbols("x y z"))
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
        e = exprs[0].subs(sp.Symbol(cplx), vs[0] + sp.I * vs[1])
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


def ode_points(eq_jsons, inits_in, a, b, n):
    """Plot 2D > ODE: first-order equations (y' = f(x, y), or a system), solved numerically
    from one initial value for each unknown (classical Runge-Kutta, n steps over [a, b]).
    inits_in: [[name, x0, value], ...] (MathJSON numbers). -> (xs, {name: [values]}, var)"""
    eqs = [build(x) for x in ode_form(["List", *eq_jsons])[1:]]
    derivs, inits = {}, {}
    var = None
    for e in eqs:
        if not isinstance(e, sp.Equality):
            raise Unsupported("方程要是等式：y' = f(x, y)")
        ds = list(e.atoms(sp.Derivative))
        if not ds:
            raise Unsupported("方程裡要有導數，例如 y'")
        d = ds[0]
        if d.derivative_count != 1 or len(ds) > 1:
            raise Unsupported("只能畫一階方程（或一階方程組）")
        var = d.variables[0]
        sol = sp.solve(e, d)
        if len(sol) != 1:
            raise Unsupported("解不出 " + str(d))
        derivs[d.expr.func] = sol[0]
    for name, x0, v in inits_in:
        inits[sp.Function(name)] = (float(build(x0).evalf()), float(build(v).evalf()))
    funcs = sorted(derivs, key=str)
    if not funcs or set(funcs) != set(inits):
        raise Unsupported("每個未知函數要有一條方程和一個起始值")
    x0 = inits[funcs[0]][0]
    if any(inits[f][0] != x0 for f in funcs):
        raise Unsupported("起始值要在同一點")
    ys = [sp.Symbol("_y%d" % k) for k in range(len(funcs))]
    rhs = [derivs[f].subs({f(var): y for f, y in zip(funcs, ys)}) for f in funcs]
    free = set().union(*(r.free_symbols for r in rhs)) - set(ys) - {var}
    if free:
        raise Unsupported("沒有給值的變數 " + ", ".join(sorted(str(x) for x in free)))
    F = sp.lambdify([var, *ys], rhs, modules="math")

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
    y0 = [inits[f][1] for f in funcs]
    lo = max(0, min(n, round(n * (x0 - a) / (b - a)))) if b > a else 0
    back_t, back_y = run(x0, y0, a, lo) if x0 > a else ([], [])
    fwd_t, fwd_y = run(x0, y0, b, n - lo) if x0 < b else ([x0], [y0])
    ts = back_t[::-1][:-1] + fwd_t if back_t else fwd_t
    vals = back_y[::-1][:-1] + fwd_y if back_y else fwd_y
    clean = lambda v: v if v == v and abs(v) != float("inf") and abs(v) < 1e300 else None  # noqa: E731
    return ts, {str(f): [clean(v[k]) for v in vals] for k, f in enumerate(funcs)}, str(var)


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
            raise Unsupported("rand(n) 的 n 要是正整數")
        return sp.Integer(rng.randrange(n))
    if kind == "rand":
        if not args:
            return sp.Integer(rng.randrange(10 ** 12))
        return pick(args[0] if len(args) == 1 else args[:2])
    rows, cols, typ = int(args[0]), int(args[1]), int(args[2])
    rng_of = args[3] if len(args) > 3 else (10,)
    if typ in (2, 3, 4) and rows != cols:
        raise Unsupported("對稱、反對稱、么模矩陣要是方陣")
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
    raise Unsupported("條件太難滿足：試了 500 次都不行")


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
        return "\\text{(算不出：%s)}" % str(err).replace("{", "").replace("}", "")


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
        if op == "plot3d":  # {"expr": MathJSON, "vars": ["x", "y"], "a", "b", "c", "d", "n", "m"}
            p = json.loads(mathjson_text)
            e = build(p["expr"])
            xv, yv = (sp.Symbol(v) for v in p.get("vars") or ["x", "y"])
            free = e.free_symbols - {xv, yv}
            if free:
                raise Unsupported("沒有給值的變數 " + ", ".join(sorted(str(x) for x in free)))
            xs, ys, zs = plot_grid(e, xv, yv, float(p["a"]), float(p["b"]), float(p["c"]), float(p["d"]), int(p.get("n", 24)), int(p.get("m", 24)))
            return json.dumps({"kind": "grid", "x": xs, "y": ys, "z": zs})
        if op == "plotn":  # {"exprs": [MathJSON], "vars": [..], "ranges": [[a, b]], "ns": [n], "grad", "complex"}
            p = json.loads(mathjson_text)
            vs = [sp.Symbol(v) for v in p["vars"]]
            cplx = p.get("complex")
            es = [apply_definitions(build(e)) for e in p["exprs"]]
            free = set().union(*(e.free_symbols for e in es)) - set(vs) - ({sp.Symbol(cplx)} if cplx else set())
            if free:
                raise Unsupported("沒有給值的變數 " + ", ".join(sorted(str(x) for x in free)))
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
            return json.dumps({"kind": "solutions", "solutions": []})
        if op == "showdefs":
            shown = [f"{tex(k(*v.variables))} = {tex(v.expr)}" if isinstance(v, sp.Lambda) else f"{tex(k)} = {tex(v)}"
                     for k, v in DEFINITIONS.values()]
            return json.dumps({"kind": "solutions", "solutions": shown})
        j = json.loads(mathjson_text)
        if op in PARAM_OPS or op in LIST_OPS:
            return json.dumps(compute_more(op, j["expr"], j.get("params", [])) if isinstance(j, dict) else compute_more(op, j, []))
        e = build(ode_form(j) if op == "ode" else j)
        if op == "define":
            return json.dumps({"kind": "value", "latex": tex(define(e))})
        e = apply_definitions(e)
        if op == "solve":
            sols = solve(e)
            parts = [", ".join(f"{tex(v)}={tex(x)}" for v, x in s) for s in sols]
            return json.dumps({"kind": "solutions", "solutions": parts})
        if op in ("extrema", "numericsolve", "integersolve"):
            sols = {"extrema": extrema, "numericsolve": solve_numeric, "integersolve": integer_solutions}[op](e)
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
