# The computation engine interface

中文：[ENGINE.md](ENGINE.md)

The Compute menu, plots and the Exam Builder of opensw all go through one interface. To replace an engine or add one (Maxima, Giac, a program of your own ...), follow this file; the editor needs no change.

## How it works

1. The editor (`src/compute.js`) turns the formula's LaTeX into MathJSON (the format of the CortexJS Compute Engine).
2. It asks the engines in turn: first the one chosen in Tools > Computation Engine (desktop app; an engine in `engine/engines.json`), then SymPy.
3. An engine answers `{"fallback": true}` for an operation it does not do, and the next one is asked. SymPy is built in and does every operation, so it comes last.

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
| `program` | where to look for the program. `*` is any folder name; of several found, the newest version (the numbers in the path) is used. A bare name (no `/` or `\`) is looked for on the PATH |
| `example` | an example path shown in the Computation Engine dialog |
| `args` | the program's arguments |
| `adapter` | the adapter file (a file name in `engine/`) |
| `load` | the first line sent after starting: loads the adapter and prints `@@OPENSW@@ready`. Empty: the program loads it from its arguments and prints that line itself |
| `call` | the line sent for each computation |

In `args` and `load`, `{adapter}` becomes the adapter's full path and `{adapter64}` the same path in base64. In `call`, `{op}` becomes the operation and `{data}` the request (UTF-8, base64).

The program's answer: the output line that contains `@@OPENSW@@`, followed by the answer (UTF-8 JSON, base64). Other lines (a start-up banner ...) are skipped. Base64 keeps a Windows console code page from garbling non-ASCII text.

3. Acceptance: `node scripts/engine-check.mjs <id> [program path]`. It starts the engine the way the desktop app does, runs the cases of `test/fixtures/engine/cases.json` and checks the answers. The cases are made by `scripts/engine-cases.mjs`; add new ones there.

In an installed opensw, `engine/` is in the program folder; changing an adapter or `engines.json` needs no rebuild, only a restart of opensw.

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
| `collect` | Polynomials > Collect | F | value | ✓ | ✓ |
| `combine` | Combine | F | value | ✓ | ✓ |
| `differentiate` | Calculus > Differentiate (F+p: variable, times) | F | value | ✓ | ✓ |
| `integrate` | Calculus > Integrate (F+p: variable) | F | value | ✓ | ✓ |
| `byparts` | Calculus > Integrate by Parts (param: u) | F+p | value | ✓ | ✓ |
| `changevar` | Calculus > Change Variable (param: u = g(x)) | F+p | value | ✓ | ✓ |
| `approxint` | Calculus > Approximate Integral (params: 'method', n) | F+p | value | ✓ | ✓ |
| `iterate` | Calculus > Iterate (params: start, count) | F+p | value | ✓ | ✓ |
| `series` | Calculus > Power Series (F+p: variable, highest power, point) | F | value | ✓ | ✓ |
| `pade` | Calculus > Padé Approximant (F+p: m, n, variable, point; without them [2/2]) | F | value | ✓ | ✓ |
| `extrema` | Calculus > Find Extrema | F | solutions | ✓ | ✓ |
| `implicitdiff` | Calculus > Implicit Differentiation | F | value | ✓ | ✓ |
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
| `mean` | Statistics > Mean | F | value | ✓ | ✓ |
| `median` | Statistics > Median | F | value | ✓ | ✓ |
| `variance` | Statistics > Variance | F | value | ✓ | ✓ |
| `stddev` | Statistics > Standard Deviation | F | value | ✓ | ✓ |
| `laplace` | Transforms > Laplace | F | value | ✓ | ✓ |
| `inverselaplace` | Transforms > Inverse Laplace | F | value | ✓ | ✓ |
| `fourier` | Transforms > Fourier | F | value | ✓ | ✓ |
| `define` | Definitions > New Definition (x = 3, f(x) = x^2) | F | value | ✓ | ✓ |
| `showdefs` | Definitions > Show Definitions | F | solutions | ✓ | ✓ |
| `cleardefs` | Definitions > Clear Definitions | F | solutions | ✓ | ✓ |
| `version` | Tools > Computation Engine: the version | F | solutions | ✓ | ✓ |
| `plot` | Plot 2D: points of y = f(x) | {expr, var, a, b, n} | points | ✓ | ✓ |
| `plot3d` | Plot 3D: z = f(x, y) on a grid | {expr, vars, a, b, c, d, n, m} | grid | ✓ | ✓ |
| `plotn` | Plots: several formulas on a grid (contours, fields, complex) | {exprs, vars, ranges, ns, grad, complex} | values | ✓ | ✓ |
| `odeplot` | Plot 2D > ODE (y' = f(x, y) solved numerically) | {eqs, inits, a, b, n} | ode | ✓ | ✓ |
| `exam` | Tools > Exam Builder: one version | {formulas, parts, ...} | exam | ✓ | ✓ |
<!-- /ops -->
