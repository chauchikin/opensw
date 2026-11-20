# The computation engine interface

中文：[ENGINE.md](ENGINE.md)

The Compute menu, plots and the Exam Builder of opensw all go through one interface. To replace an engine or add one (Maxima, Giac, a program of your own ...), follow this file; the editor needs no change.

## How it works

1. The editor (`src/compute.js`) turns the formula's LaTeX into MathJSON (the format of the CortexJS Compute Engine).
2. It asks the engines in turn: first the one chosen in Tools > Computation Engine (desktop app; an engine in `engine/engines.json`), then SymPy.
3. An engine answers `{"fallback": true}` for an operation it does not do, and the next one is asked. SymPy is built in and does every operation, so it comes last.

SymPy is run in two ways, both with the same `engine/opensw_compute.py`: by the Python that comes with the desktop app (fast), and in Pyodide in a browser. See "How SymPy is run" below.

An engine does one thing:

```
compute(op, request) -> answer
```

`op` is a lowercase word (e.g. `factor`); the request and the answer are JSON text. All operations are in the table below.

## Answers

| kind | Content | Example |
|---|---|---|
| `value` | `latex`: one result | `{"kind":"value","latex":"(x+1)^2"}` |
| `solutions` | `solutions`: several results (LaTeX); `label`: text put after the formula (optional) | `{"kind":"solutions","solutions":["x=1","x=2"]}` |
| `boolean` | `value`: true/false | `{"kind":"boolean","value":true}` |
| `text` | `text`: some text | `{"kind":"text","text":" (feasible)"}` |
| `step` | `result`: `equal`, `notequal` or `unknown`; with `notequal`, `point` (LaTeX, e.g. `x=-\frac{3}{5}`) and `values` (the two sides there) | `{"kind":"step","result":"equal"}` |
| `points`, `grid`, `values`, `ode`, `exam` | numbers for plots and exams; see the operation of the same name in `engine/opensw_compute.py` | |

Two more:

- `{"error": "Cannot compute this yet: <why>"}`: it could not compute. Messages, texts and labels are written in English; the editor shows them in the interface language with src/locales/zh-TW.json (a text with a name or number in it has an entry with {0}, e.g. "Variables without a value: {0}"). After adding a message, `node scripts/i18n-keys.mjs` lists what zh-TW.json still lacks.
- `{"fallback": true}`: this engine does not do the operation; the next engine does.

LaTeX is written as Scientific Word 5.5 shows it: matrices as `pmatrix` (or `\left(\begin{matrix}…\end{matrix}\right)`), functions as `f(x)`.

## Definitions (Compute > Definitions)

Definitions are kept in one place: the editor (`src/compute.js`). An engine only needs three operations:

- `define`: remember `x = 3` or `f(x) = x^2` and use it in every later computation. Assumptions as in 5.5 come the same way: `["assume", "Real"]` (every variable real), `["assume", "x", "positive"]`, `["additionally", "n", "integer"]`, `["unassume", "x"]` (variables are complex otherwise); `evaluate` of `["about", "x"]` tells them. An engine that does not keep assumptions answers these with `{"fallback": true}`.
- `define` also brings Solve ODE > Numeric: `["OdeNumeric", ["List", equations], ["List", ["List", name, x0, value, order], ...]]`, equations (of any order) and the initial values of each unknown (order 0 is y(x0), 1 is y'(x0), ...; an equation of order n needs orders 0 to n-1); the unknowns become functions of their numerical solution (y(1) is a number), answered `{"kind": "solutions", "label": ", Functions defined: ", "solutions": ["y"]}`. And a_n = .. with 5.5's Interpret Subscript chosen against the rule that a subscript is an argument when its letter is on the right: `{"expr": F, "params": ["'argument'"]}` or `["'name'"]`. An engine that does not do these answers `{"fallback": true}`; the editor then sends whatever uses those names to SymPy alone.
- `showdefs`: list the definitions.
- `cleardefs`: clear them all.

Two settings of Tools > Computation Engine are written into the formula: with the log base set to 10, \log x is `["Log10", x]` (shown as \log_{10} x, as 5.5 then); with basis variables other than x, y, z, ∇ and its kin carry them after the formula: `["Gradient", f, "u", "v", "w"]`. An engine that does not know these heads falls back.

The editor sends an engine the definitions it does not have yet before asking it anything else, and all of them again when the engine's program was started again. An engine keeps nothing in files and syncs nothing.

## Adding an engine (desktop app)

An engine is a program on the computer (e.g. `wolfram.exe`), kept running, talked to line by line through its standard input and output:

1. Write an adapter file in `engine/` that makes the program read the requests and answer as above. Example: `engine/opensw_compute.wl` (Mathematica); the shortest example: `engine/opensw_stdio.py` (SymPy run by Python).
2. Add an entry to `engine/engines.json`:

| Field | Meaning |
|---|---|
| `id`, `name` | the engine's id and the name shown |
| `program` | where to look for the program. `*` is any folder name; of several found, the newest version (the numbers in the path) is used. A bare name (no `/` or `\`) is looked for on the PATH. `{engine}` at the start is the `engine/` folder (a program that comes with opensw, e.g. `{engine}/python/python.exe`); an engine without a bare name is never looked for on the PATH |
| `example` | an example path shown in the Computation Engine dialog |
| `args` | the program's arguments |
| `adapter` | the adapter file (a file name in `engine/`) |
| `load` | the first line sent after starting: loads the adapter and prints `@@OPENSW@@ready`. Empty: the program loads it from its arguments and prints that line itself |
| `call` | the line sent for each computation |

In `args` and `load`, `{adapter}` becomes the adapter's full path and `{adapter64}` the same path in base64. In `call`, `{op}` becomes the operation and `{data}` the request (UTF-8, base64).

The program's answer: the output line that contains `@@OPENSW@@`, followed by the answer (UTF-8 JSON, base64). Other lines (a start-up banner ...) are skipped. Base64 keeps a Windows console code page from garbling non-ASCII text.

3. Acceptance: `node scripts/engine-check.mjs <id> [program path]`. It starts the engine the way the desktop app does, runs the cases of `test/fixtures/engine/cases.json` and checks the answers. The cases are made by `scripts/engine-cases.mjs`; add new ones there.

In an installed opensw, `engine/` is in the program folder; changing an adapter or `engines.json` needs no rebuild, only a restart of opensw.

## How SymPy is run

The desktop app (Windows) comes with a Python of its own (`engine/python/`, made by `scripts/bundle-python.mjs`: the embeddable Python from python.org with SymPy, mpmath, giacpy and python-flint), kept running as above with `engine/opensw_stdio.py`. It is the entry `python` of `engines.json`, looked for in the `engine/` folder only: a Python installed on the computer is not used (another SymPy version gives other answers); to use another Python, give its location in Tools > Computation Engine. When this Python does not start (not there, broken), the SymPy in Pyodide is used instead and the user is told once. With Mathematica chosen it is the same: what Mathematica does not do goes to this Python first, then to Pyodide.

This Python has `python-flint` (FLINT): SymPy, finding it, uses it by itself for the arithmetic of integers, rationals and polynomials (`sympy/external/gmpy.py`; the python-flint version must be one that SymPy version knows), and large polynomials are factored much faster. The answers are the same as without it (Pyodide has none); check that again when the version of python-flint or SymPy changes: run the acceptance below both ways and compare every answer.

Acceptance: `node scripts/engine-check.mjs sympy [the Python's location]`.

## Giac, with SymPy run by Python

When `engine/opensw_compute.py` is run by a Python on the computer (`engine/opensw_stdio.py`) and that Python has the package `giacpy`, the heavy computations are tried with Giac first: integrals (Evaluate, Integrate), power series, and determinants of 4 or more rows with letters in them. `engine/opensw_giac.py` sends the formula (never definitions or assumptions) to Giac in a process of its own (`engine/opensw_giac_worker.py`), checks the answer with numbers, and gives it to `opensw_compute.py`, which writes it as before. A formula with a part Giac's answer could not be read back from, an answer that fails the check, no answer within 2 seconds, a crash of Giac: SymPy computes, as it does without `giacpy`. `OPENSW_GIAC=0` in the environment turns Giac off. Test: `node test/engine_giac.mjs` (`OPENSW_PYTHON`: the Python to use).

## FriCAS, for the indefinite integrals Giac does not find, before SymPy

An indefinite integral (Evaluate, Integrate) that Giac has not found is given to FriCAS, and to SymPy after it: the order is Giac, FriCAS, SymPy. FriCAS's integrator finds more of them (roots of functions, roots inside roots, exponentials and logarithms mixed), it writes with elementary functions some that SymPy answers with gamma and hypergeometric functions, and when it finds none it mostly says so at once (SymPy takes seconds, up to tens of seconds, to give up). Definite integrals and the other operations are not given to it. `engine/opensw_fricas.py` looks for FriCAS in `engine/fricas/` (the desktop app comes with it, made by `scripts/bundle-fricas.mjs`: the FriCAS team's Windows build without its source text, help and native libraries), sends the formula (never definitions or assumptions) to FriCAS in a process of its own, checks the answer by differentiating it at numbers, and gives it to `opensw_compute.py`, which writes it as before. A formula with a part not on the list, an answer with a name not known (`rootOf`, an elliptic integral ...), an answer that fails the check, a crash of FriCAS: SymPy computes, as it does without FriCAS. FriCAS is stopped when it has no answer within 5 seconds, so where it searches long SymPy starts at most 5 seconds later. `OPENSW_FRICAS=0` in the environment turns FriCAS off; `OPENSW_FRICAS_DIR` names another FriCAS (the folder that holds `bin/FRICASsys`). Test: `node test/engine_fricas.mjs` (`OPENSW_PYTHON`: the Python to use).

## The browser version

The browser version has SymPy only: `engine/opensw_compute.py` run in Pyodide (`engine/worker.mjs`), with no internet needed.

## All operations

This table is made by `node scripts/engine-doc.mjs` from the two engines' code (`npm test` checks it is up to date). Request: F = the formula's MathJSON; F+p = `{"expr": F, "params": [...]}`, each parameter MathJSON or a word written as `'word'`; L = several formulas as a row, column or matrix; otherwise a JSON object for plots and exams. "falls back": the engine answers `{"fallback": true}`.

<!-- ops -->
| op | Menu | Request | Answer kind | SymPy | Mathematica |
|---|---|---|---|---|---|
| `evaluate` | Evaluate | F | value | ✓ | ✓ |
| `numeric` | Evaluate Numerically | F | value | ✓ | ✓ |
| `simplify` | Simplify | F | value | ✓ | ✓ |
| `expand` | Expand | F | value | ✓ | ✓ |
| `factor` | Factor | F | value | ✓ | ✓ |
| `check` | Check Equality | F | boolean | ✓ | ✓ |
| `solve` | Solve > Exact (F+p: the unknowns; the word 'principal': principal value only, one solution; one unknown: the values alone, as 5.5) | F | solutions | ✓ | ✓ |
| `numericsolve` | Solve > Numeric (F+p: the unknown) | F | solutions | ✓ | ✓ |
| `integersolve` | Solve > Integer | F | solutions | ✓ | ✓ |
| `recursion` | Solve > Recursion | L | solutions | ✓ | ✓ |
| `ode` | Solve ODE > Exact | F | solutions | ✓ | ✓ |
| `rewrite_exp` | Rewrite > Exponential | F | value | ✓ | ✓ |
| `rewrite_sincos` | Rewrite > Sin and Cos | F | value | ✓ | ✓ |
| `partialfractions` | Polynomials > Partial Fractions (F+p: the variable) | F | value | ✓ | ✓ |
| `collect` | Polynomials > Collect (params: the variables) | F+p | value | ✓ | ✓ |
| `combine` | Combine | F | value | ✓ | ✓ |
| `differentiate` | Calculus > Differentiate (F+p: variable, times) | F | value | ✓ | ✓ |
| `integrate` | Calculus > Integrate (F+p: variable) | F | value | ✓ | ✓ |
| `byparts` | Calculus > Integrate by Parts (param: u) | F+p | value | ✓ | ✓ |
| `changevar` | Calculus > Change Variable (param: u = g(x)) | F+p | value | ✓ | ✓ |
| `approxint` | Calculus > Approximate Integral (params: 'method', n) | F+p | value | ✓ | ✓ |
| `iterate` | Calculus > Iterate (params: start, count) | F+p | value | ✓ | ✓ |
| `series` | Calculus > Power Series (F+p: variable, number of terms, point; terms counted from the lowest power, as in 5.5) | F | value | ✓ | ✓ |
| `pade` | Calculus > Padé Approximant (F+p: m, n, variable, point; without them [2/2]) | F | value | ✓ | ✓ |
| `extrema` | Calculus > Find Extrema | F | solutions | ✓ | ✓ |
| `implicitdiff` | Calculus > Implicit Differentiation (F+p: the differentiation variable, x if not given) | F | value | ✓ | ✓ |
| `stepcheck` | Derivation check: is a = b a right step (param: b); answers equal (proved), notequal (with point, values) or unknown | F+p | step | ✓ | falls back |
| `gradient` | Vector Calculus > Gradient (params: basis variables) | F+p | value | ✓ | ✓ |
| `divergence` | Vector Calculus > Divergence | F+p | value | ✓ | ✓ |
| `curl` | Vector Calculus > Curl | F+p | value | ✓ | ✓ |
| `laplacian` | Vector Calculus > Laplacian | F+p | value | ✓ | ✓ |
| `hessian` | Vector Calculus > Hessian | F+p | value | ✓ | ✓ |
| `jacobian` | Vector Calculus > Jacobian | F+p | value | ✓ | ✓ |
| `wronskian` | Vector Calculus > Wronskian | F+p | value | ✓ | ✓ |
| `potential` | Vector Calculus > Potential | F+p | value | ✓ | ✓ |
| `vectorpotential` | Vector Calculus > Vector Potential | F+p | value | ✓ | ✓ |
| `determinant` | Matrices > Determinant | F | value | ✓ | ✓ |
| `inverse` | Matrices > Inverse | F | value | ✓ | ✓ |
| `transpose` | Matrices > Transpose | F | value | ✓ | ✓ |
| `eigenvalues` | Matrices > Eigenvalues | F | value | ✓ | ✓ |
| `rank` | Matrices > Rank | F | value | ✓ | ✓ |
| `rref` | Matrices > Row Reduce (RREF) | F | value | ✓ | ✓ |
| `nullspace` | Matrices > Null Space | F | value | ✓ | ✓ |
| `trace` | Matrices > Trace | F | value | ✓ | ✓ |
| `charpoly` | Matrices > Characteristic Polynomial | F | value | ✓ | ✓ |
| `adjugate` | Matrices > Adjugate | F | value | ✓ | ✓ |
| `maximize` | Simplex > Maximize | L | solutions | ✓ | ✓ |
| `minimize` | Simplex > Minimize | L | solutions | ✓ | ✓ |
| `feasible` | Simplex > Feasible? | L | text | ✓ | ✓ |
| `standardize` | Simplex > Standardize | L | solutions | ✓ | ✓ |
| `dual` | Simplex > Dual | L | solutions | ✓ | ✓ |
| `mean` | Statistics > Mean (a matrix: one per column) | F | solutions | ✓ | ✓ |
| `median` | Statistics > Median (of two middle numbers the smaller, as 5.5) | F | solutions | ✓ | ✓ |
| `variance` | Statistics > Variance (sample, n − 1) | F | solutions | ✓ | ✓ |
| `stddev` | Statistics > Standard Deviation | F | solutions | ✓ | ✓ |
| `laplace` | Transforms > Laplace (label: ", Laplace transform is: ") | F | solutions | ✓ | ✓ |
| `inverselaplace` | Transforms > Inverse Laplace (label: ", Is Laplace transform of ") | F | solutions | ✓ | ✓ |
| `fourier` | Transforms > Fourier (MuPAD's convention, the integral of f(x) e^(iwx) dx, x to w; label: ", Fourier transform is: ") | F | solutions | ✓ | ✓ |
| `define` | Definitions > New Definition (x = 3, f(x) = x^2) | F | value | ✓ | ✓ |
| `showdefs` | Definitions > Show Definitions | F | solutions | ✓ | ✓ |
| `cleardefs` | Definitions > Clear Definitions | F | solutions | ✓ | ✓ |
| `version` | Tools > Computation Engine: the version | F | solutions | ✓ | ✓ |
| `plot` | Plot 2D: points of y = f(x) | {expr, var, a, b, n} | points | ✓ | ✓ |
| `plot3d` | Plot 3D: z = f(x, y) on a grid | {expr, vars, a, b, c, d, n, m} | grid | ✓ | ✓ |
| `plotn` | Plots: several formulas on a grid (contours, fields, complex) | {exprs, vars, ranges, ns, grad, complex} | values | ✓ | ✓ |
| `odeplot` | Plot 2D > ODE (y' = f(x, y) solved numerically) | {eqs, inits, a, b, n} | ode | ✓ | ✓ |
| `exam` | Tools > Exam Builder: one version | {formulas, parts, ...} | exam | ✓ | ✓ |
| `cholesky` | Matrices > Cholesky Decomposition (answers G G^T) | F | value | ✓ | ✓ |
| `plu` | Matrices > PLU Decomposition (answers P L U) | F | value | ✓ | ✓ |
| `qr` | Matrices > QR Decomposition (answers Q R, Q square) | F | value | ✓ | ✓ |
| `svd` | Matrices > SVD (answers U D V, decimals) | F | value | ✓ | ✓ |
| `singularvalues` | Matrices > Singular Values (decimals) | F | solutions | ✓ | ✓ |
| `jordan` | Matrices > Jordan Form (answers P J P^{-1}, the ones of J below the diagonal) | F | value | ✓ | ✓ |
| `hermite` | Matrices > Hermite Normal Form (integer matrices) | F | solutions | ✓ | ✓ |
| `smith` | Matrices > Smith Normal Form (integers or polynomials in one variable) | F | solutions | ✓ | ✓ |
| `rationalcanonical` | Matrices > Rational Canonical Form (answers P B P^{-1}) | F | value | ✓ | ✓ |
| `ffgauss` | Matrices > Fraction-Free Gaussian Elimination | F | solutions | ✓ | ✓ |
| `gauss` | Matrices > Gaussian Elimination | F | solutions | ✓ | ✓ |
| `minpoly` | Matrices > Minimum Polynomial (F+p: the polynomial variable, needed when the matrix has X in it) | F | solutions | ✓ | ✓ |
| `eigenvectors` | Matrices > Eigenvectors (each eigenvalue with its eigenvectors) | F | solutions | ✓ | ✓ |
| `colbasis` | Matrices > Column Basis (label ", column basis: ") | F | solutions | ✓ | ✓ |
| `rowbasis` | Matrices > Row Basis | F | solutions | ✓ | ✓ |
| `concat` | Matrices > Concatenate (matrices side by side, same number of rows) | F | solutions | ✓ | ✓ |
| `stack` | Matrices > Stack (matrices side by side, same number of columns) | F | solutions | ✓ | ✓ |
| `reshape` | Matrices > Reshape (params: number of columns; a list or matrix, read left to right, top to bottom) | F+p | solutions | ✓ | ✓ |
| `fillmatrix` | Matrices > Fill Matrix (params: 'zero'|'identity'|'random'|'jordan'|'function'|'band', rows, columns, item; the answer is a new matrix without brackets) | F+p | value | ✓ | ✓ |
| `randommatrix` | Matrices > Random Matrix (params: 'unrestricted'|'symmetric'|'antisymmetric'|'triangular', rows, columns, min, max) | F+p | value | ✓ | ✓ |
| `condition` | Matrices > Condition Number (numeric) | F | solutions | ✓ | ✓ |
| `definiteness` | Matrices > Definiteness Tests (" is positive definite" / " is indefinite") | F | text | ✓ | ✓ |
| `norm` | Matrices > Norm (the 2-norm; of a vector exactly) | F | solutions | ✓ | ✓ |
| `orthogonal` | Matrices > Orthogonality Test (true / false) | F | solutions | ✓ | ✓ |
| `permanent` | Matrices > Permanent | F | solutions | ✓ | ✓ |
| `spectralradius` | Matrices > Spectral Radius (numeric) | F | solutions | ✓ | ✓ |
| `htranspose` | Matrices > Hermitian Transpose | F | solutions | ✓ | ✓ |
| `rewrite_rational` | Rewrite > Rational | F | value | ✓ | ✓ |
| `rewrite_float` | Rewrite > Float | F | value | ✓ | ✓ |
| `rewrite_factorial` | Rewrite > Factorial | F | value | ✓ | ✓ |
| `rewrite_gamma` | Rewrite > Gamma | F | value | ✓ | ✓ |
| `rewrite_log` | Rewrite > Logarithm | F | value | ✓ | ✓ |
| `rewrite_sinhcosh` | Rewrite > Sinh and Cosh | F | value | ✓ | ✓ |
| `rewrite_sin` | Rewrite > Sin | F | value | ✓ | ✓ |
| `rewrite_cos` | Rewrite > Cos | F | value | ✓ | ✓ |
| `rewrite_tan` | Rewrite > Tan | F | value | ✓ | ✓ |
| `rewrite_arcsin` | Rewrite > Arcsin | F | value | ✓ | ✓ |
| `rewrite_arccos` | Rewrite > Arccos | F | value | ✓ | ✓ |
| `rewrite_arctan` | Rewrite > Arctan | F | value | ✓ | ✓ |
| `rewrite_arccot` | Rewrite > Arccot | F | value | ✓ | ✓ |
| `rewrite_polar` | Rewrite > Polar | F | value | ✓ | ✓ |
| `rewrite_rectangular` | Rewrite > Rectangular | F | value | ✓ | ✓ |
| `rewrite_normal` | Rewrite > Normal Form | F | value | ✓ | ✓ |
| `combine_exp` | Combine > Exponentials | F | value | ✓ | ✓ |
| `combine_log` | Combine > Logs (after assume(positive), as in 5.5) | F | value | ✓ | ✓ |
| `combine_powers` | Combine > Powers | F | value | ✓ | ✓ |
| `combine_trig` | Combine > Trig Functions | F | value | ✓ | ✓ |
| `combine_arctan` | Combine > Arctan | F | value | ✓ | ✓ |
| `combine_hyp` | Combine > Hyperbolic Trig Functions | F | value | ✓ | ✓ |
| `eqs_to_matrix` | Rewrite > Equations as Matrix (params: the variables; answers the augmented matrix) | F+p | solutions | ✓ | ✓ |
| `matrix_to_eqs` | Rewrite > Matrix as Equations (params: the variables; the last column is the right side, 0 for a square matrix) | F+p | solutions | ✓ | ✓ |
| `mode` | Statistics > Mode ([modes], how often) | F | solutions | ✓ | ✓ |
| `geomean` | Statistics > Geometric Mean | F | solutions | ✓ | ✓ |
| `harmonicmean` | Statistics > Harmonic Mean | F | solutions | ✓ | ✓ |
| `meandev` | Statistics > Mean Deviation | F | solutions | ✓ | ✓ |
| `moment` | Statistics > Moment (params: [number, origin], or [number, 'mean']: about the mean) | F+p | solutions | ✓ | ✓ |
| `quantile` | Statistics > Quantile (params: [q], 0 < q < 1) | F+p | solutions | ✓ | ✓ |
| `correlation` | Statistics > Correlation (the correlation matrix) | F | solutions | ✓ | ✓ |
| `covariance` | Statistics > Covariance (the covariance matrix) | F | solutions | ✓ | ✓ |
| `fitcurve` | Statistics > Fit Curve to Data (params: 'regression', 'noconstant' or 'polynomial'; 'first' or 'last': the dependent variable's column; the polynomial's degree) | F+p | solutions | ✓ | ✓ |
| `randomnumbers` | Statistics > Random Numbers (no formula needed; params: the distribution 'beta' 'binomial' 'cauchy' 'chisquare' 'exponential' 'f' 'gamma' 'normal' 'poisson' 't' 'uniform' 'weibull', how many, its parameters) | F+p | value | ✓ | ✓ |
| `divide` | Polynomials > Divide (quotient + remainder/divisor) | F+p | value | ✓ | ✓ |
| `roots` | Polynomials > Roots (a multiple root as often as it is one) | F+p | solutions | ✓ | ✓ |
| `sort` | Polynomials > Sort (by decreasing degree) | F+p | value | ✓ | ✓ |
| `companion` | Polynomials > Companion Matrix | F+p | solutions | ✓ | ✓ |
| `interpret` | Interpret (Ctrl+?): the formula as it is read, worked out no further | F | value | ✓ | ✓ |
| `inversefourier` | Transforms > Inverse Fourier (label: , Is Fourier transform of) | F | solutions | ✓ | ✓ |
| `odelaplace` | Solve ODE > Laplace (O: ["OdeSystem", equations, initial values [name, x0, value, order], "Nothing", the independent variable or "Nothing"]; linear, constant coefficients only; label: , Laplace solution is:) | O | solutions | ✓ | ✓ |
| `odeseries` | Solve ODE > Series (O, the 4th item the order, "Nothing": the Series Order setting; label: , Series solution is:) | O | solutions | ✓ | ✓ |
| `setoptions` | Compute settings (S: {"digits", "threshold", "comp_digits", "imaginary_j", "bessel_subscripts", "ode_series_order"}; the answers follow them from then on) | S | text | ✓ | ✓ |
<!-- /ops -->
