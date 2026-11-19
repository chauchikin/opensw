// The table of engine operations in ENGINE.md and ENGINE.en.md, made from the engines
// themselves: which operations engine/opensw_compute.py (SymPy) and engine/opensw_compute.wl
// (Mathematica) do, with the request and answer of each from OPS below.
//   node scripts/engine-doc.mjs           -> writes the tables
//   node scripts/engine-doc.mjs --check   -> fails when a table is out of date, or an engine
//                                            does an operation OPS does not describe (npm test)
import fs from 'node:fs';

// op -> [request, answer kind, what it is (Chinese), (English)]
// request: F = the formula's MathJSON; F+p = { expr: F, params: [MathJSON or 'word'] };
// L = a list of formulas (a column vector or a matrix of them) as MathJSON
const OPS = {
  evaluate: ['F', 'value', '計算', 'Evaluate'],
  numeric: ['F', 'value', '數值計算', 'Evaluate Numerically'],
  simplify: ['F', 'value', '化簡', 'Simplify'],
  expand: ['F', 'value', '展開', 'Expand'],
  factor: ['F', 'value', '因式分解', 'Factor'],
  check: ['F', 'boolean', '檢查是否相等', 'Check Equality'],
  solve: ['F', 'solutions', "解 > 精確（F+p：要解的未知數；字 'principal'：只要主值，一個解；一個未知數時只寫值，如 5.5）", "Solve > Exact (F+p: the unknowns; the word 'principal': principal value only, one solution; one unknown: the values alone, as 5.5)"],
  numericsolve: ['F', 'solutions', '解 > 數值（F+p：未知數）', 'Solve > Numeric (F+p: the unknown)'],
  integersolve: ['F', 'solutions', '解 > 整數', 'Solve > Integer'],
  recursion: ['L', 'solutions', '解 > 遞迴', 'Solve > Recursion'],
  ode: ['F', 'solutions', '解常微分方程 > 精確', 'Solve ODE > Exact'],
  rewrite_exp: ['F', 'value', '改寫 > 成指數', 'Rewrite > Exponential'],
  rewrite_sincos: ['F', 'value', '改寫 > 成正弦餘弦', 'Rewrite > Sin and Cos'],
  partialfractions: ['F', 'value', '多項式 > 部分分式（F+p：變數）', 'Polynomials > Partial Fractions (F+p: the variable)'],
  collect: ['F', 'value', '多項式 > 依變數整理', 'Polynomials > Collect'],
  combine: ['F', 'value', '合併', 'Combine'],
  differentiate: ['F', 'value', '微積分 > 微分（F+p：變數、次數）', 'Calculus > Differentiate (F+p: variable, times)'],
  integrate: ['F', 'value', '微積分 > 不定積分（F+p：變數）', 'Calculus > Integrate (F+p: variable)'],
  byparts: ['F+p', 'value', '微積分 > 分部積分（參數：u）', 'Calculus > Integrate by Parts (param: u)'],
  changevar: ['F+p', 'value', '微積分 > 換變數（參數：u = g(x)）', 'Calculus > Change Variable (param: u = g(x))'],
  approxint: ['F+p', 'value', "微積分 > 近似積分（參數：'方法'、n）", "Calculus > Approximate Integral (params: 'method', n)"],
  iterate: ['F+p', 'value', '微積分 > 迭代（參數：起始值、次數）', 'Calculus > Iterate (params: start, count)'],
  series: ['F', 'value', '微積分 > 冪級數（F+p：變數、最高次、展開點）', 'Calculus > Power Series (F+p: variable, highest power, point)'],
  pade: ['F', 'value', '微積分 > Padé 近似（F+p：m、n、變數、展開點；沒給是 [2/2]）', 'Calculus > Padé Approximant (F+p: m, n, variable, point; without them [2/2])'],
  extrema: ['F', 'solutions', '微積分 > 求極值', 'Calculus > Find Extrema'],
  implicitdiff: ['F', 'value', '微積分 > 隱函數微分', 'Calculus > Implicit Differentiation'],
  gradient: ['F+p', 'value', '向量微積分 > 梯度（參數：基底變數）', 'Vector Calculus > Gradient (params: basis variables)'],
  divergence: ['F+p', 'value', '向量微積分 > 散度', 'Vector Calculus > Divergence'],
  curl: ['F+p', 'value', '向量微積分 > 旋度', 'Vector Calculus > Curl'],
  laplacian: ['F+p', 'value', '向量微積分 > 拉普拉斯', 'Vector Calculus > Laplacian'],
  hessian: ['F+p', 'value', '向量微積分 > 黑塞矩陣', 'Vector Calculus > Hessian'],
  jacobian: ['F+p', 'value', '向量微積分 > 雅可比矩陣', 'Vector Calculus > Jacobian'],
  wronskian: ['F+p', 'value', '向量微積分 > 朗斯基行列式', 'Vector Calculus > Wronskian'],
  potential: ['F+p', 'value', '向量微積分 > 位勢', 'Vector Calculus > Potential'],
  vectorpotential: ['F+p', 'value', '向量微積分 > 向量位勢', 'Vector Calculus > Vector Potential'],
  determinant: ['F', 'value', '矩陣 > 行列式', 'Matrices > Determinant'],
  inverse: ['F', 'value', '矩陣 > 反矩陣', 'Matrices > Inverse'],
  transpose: ['F', 'value', '矩陣 > 轉置', 'Matrices > Transpose'],
  eigenvalues: ['F', 'value', '矩陣 > 特徵值', 'Matrices > Eigenvalues'],
  rank: ['F', 'value', '矩陣 > 秩', 'Matrices > Rank'],
  rref: ['F', 'value', '矩陣 > 列簡化（RREF）', 'Matrices > Row Reduce (RREF)'],
  nullspace: ['F', 'value', '矩陣 > 零空間', 'Matrices > Null Space'],
  trace: ['F', 'value', '矩陣 > 跡', 'Matrices > Trace'],
  charpoly: ['F', 'value', '矩陣 > 特徵多項式', 'Matrices > Characteristic Polynomial'],
  adjugate: ['F', 'value', '矩陣 > 伴隨矩陣', 'Matrices > Adjugate'],
  maximize: ['L', 'solutions', '單形法 > 最大化', 'Simplex > Maximize'],
  minimize: ['L', 'solutions', '單形法 > 最小化', 'Simplex > Minimize'],
  feasible: ['L', 'text', '單形法 > 可行性', 'Simplex > Feasible?'],
  standardize: ['L', 'solutions', '單形法 > 標準化', 'Simplex > Standardize'],
  dual: ['L', 'solutions', '單形法 > 對偶', 'Simplex > Dual'],
  mean: ['F', 'value', '統計 > 平均數', 'Statistics > Mean'],
  median: ['F', 'value', '統計 > 中位數', 'Statistics > Median'],
  variance: ['F', 'value', '統計 > 變異數', 'Statistics > Variance'],
  stddev: ['F', 'value', '統計 > 標準差', 'Statistics > Standard Deviation'],
  laplace: ['F', 'value', '轉換 > 拉氏轉換', 'Transforms > Laplace'],
  inverselaplace: ['F', 'value', '轉換 > 反拉氏轉換', 'Transforms > Inverse Laplace'],
  fourier: ['F', 'value', '轉換 > 傅立葉轉換', 'Transforms > Fourier'],
  define: ['F', 'value', '定義 > 新定義（x = 3、f(x) = x^2）', 'Definitions > New Definition (x = 3, f(x) = x^2)'],
  showdefs: ['F', 'solutions', '定義 > 顯示定義', 'Definitions > Show Definitions'],
  cleardefs: ['F', 'solutions', '定義 > 清除定義', 'Definitions > Clear Definitions'],
  version: ['F', 'solutions', '工具 > 計算引擎：顯示版本', 'Tools > Computation Engine: the version'],
  plot: ['{expr, var, a, b, n}', 'points', '畫圖 2D：y = f(x) 的點', 'Plot 2D: points of y = f(x)'],
  plot3d: ['{expr, vars, a, b, c, d, n, m}', 'grid', '畫圖 3D：z = f(x, y) 的格點', 'Plot 3D: z = f(x, y) on a grid'],
  plotn: ['{exprs, vars, ranges, ns, grad, complex}', 'values', '畫圖：多個公式在格點上的值（等高線、向量場、複數）', 'Plots: several formulas on a grid (contours, fields, complex)'],
  odeplot: ['{eqs, inits, a, b, n}', 'ode', "畫圖 2D > 常微分方程（y' = f(x, y) 數值解）", "Plot 2D > ODE (y' = f(x, y) solved numerically)"],
  exam: ['{formulas, parts, ...}', 'exam', '工具 > 考卷產生器：一個版本的值', 'Tools > Exam Builder: one version'],
};

const read = (f) => fs.readFileSync(f, 'utf8');
const words = (text) => [...text.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);
const between = (text, start, end) => { const i = text.indexOf(start); return text.slice(i, text.indexOf(end, i + start.length)); };

// the operations each engine does
function sympyOps() {
  const py = read('engine/opensw_compute.py');
  const ops = new Set();
  for (const m of between(py, 'OPERATIONS = {', '\n}').matchAll(/^\s*"([a-z_0-9]+)":/gm)) ops.add(m[1]);
  for (const set of ['VECTOR_OPS', 'PARAM_OPS', 'LIST_OPS']) for (const w of words(py.match(new RegExp(`^${set} = .*$`, 'm'))[0])) ops.add(w);
  for (const m of between(py, 'def compute(op, mathjson_text):', '\n\n\n').matchAll(/op (?:==|in) (\([^)]*\)|"[a-z_0-9]+")/g)) for (const w of words(m[1])) ops.add(w);
  return ops;
}

function wolframOps() {
  const wl = read('engine/opensw_compute.wl');
  const ops = new Set();
  for (const m of between(wl, 'operations = <|', '|>;').matchAll(/^\s*"([a-z_0-9]+)" ->/gm)) ops.add(m[1]);
  for (const w of words(wl.match(/^vectorOps = .*$/m)[0])) ops.add(w);
  for (const m of between(wl, 'compute[op_String, j_] := Switch[op,', '_, Which[').matchAll(/^\s*("[a-z_0-9]+"(?: \| "[a-z_0-9]+")*),/gm)) for (const w of words(m[1])) ops.add(w);
  return ops;
}

const py = sympyOps();
const wl = wolframOps();
const unknown = [...py, ...wl].filter((op) => !OPS[op]);
const gone = Object.keys(OPS).filter((op) => !py.has(op) && !wl.has(op));
if (unknown.length || gone.length) {
  console.error(`OPS in scripts/engine-doc.mjs: describe ${unknown.join(', ') || '-'}; remove ${gone.join(', ') || '-'}`);
  process.exit(1);
}

function table(en) {
  const yes = (has) => (has ? '✓' : (en ? 'falls back' : '交給下一個'));
  const head = en
    ? '| op | Menu | Request | Answer kind | SymPy | Mathematica |\n|---|---|---|---|---|---|'
    : '| op | 選單 | 要求 | 回答 kind | SymPy | Mathematica |\n|---|---|---|---|---|---|';
  const rows = Object.entries(OPS).map(([op, [req, kind, zh, eng]]) => `| \`${op}\` | ${en ? eng : zh} | ${req} | ${kind} | ${yes(py.has(op))} | ${yes(wl.has(op))} |`);
  return `${head}\n${rows.join('\n')}`;
}

let stale = false;
for (const [file, en] of [['ENGINE.md', false], ['ENGINE.en.md', true]]) {
  const text = read(file);
  const made = text.replace(/(<!-- ops -->)[^]*?(<!-- \/ops -->)/, `$1\n${table(en)}\n$2`);
  if (made === text) continue;
  if (process.argv.includes('--check')) { console.error(`${file}: the table is out of date (node scripts/engine-doc.mjs)`); stale = true; } else fs.writeFileSync(file, made);
}
process.exit(stale ? 1 : 0);
