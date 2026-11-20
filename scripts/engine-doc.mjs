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
  series: ['F', 'value', '微積分 > 冪級數（F+p：變數、項數、展開點；項數從最低次數起算，照 5.5）', 'Calculus > Power Series (F+p: variable, number of terms, point; terms counted from the lowest power, as in 5.5)'],
  pade: ['F', 'value', '微積分 > Padé 近似（F+p：m、n、變數、展開點；沒給是 [2/2]）', 'Calculus > Padé Approximant (F+p: m, n, variable, point; without them [2/2])'],
  extrema: ['F', 'solutions', '微積分 > 求極值', 'Calculus > Find Extrema'],
  implicitdiff: ['F', 'value', '微積分 > 隱函數微分（F+p：微分變數，沒給是 x）', 'Calculus > Implicit Differentiation (F+p: the differentiation variable, x if not given)'],
  stepcheck: ['F+p', 'step', '推導檢查：a = b 是不是對的一步（參數：b）；答 equal（證明相等）、notequal（附 point、values）或 unknown', 'Derivation check: is a = b a right step (param: b); answers equal (proved), notequal (with point, values) or unknown'],
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
  laplace: ['F', 'solutions', '轉換 > 拉氏轉換（label：「, Laplace transform is: 」）', 'Transforms > Laplace (label: ", Laplace transform is: ")'],
  inverselaplace: ['F', 'solutions', '轉換 > 反拉氏轉換（label：「, Is Laplace transform of 」）', 'Transforms > Inverse Laplace (label: ", Is Laplace transform of ")'],
  fourier: ['F', 'solutions', '轉換 > 傅立葉轉換（MuPAD 的慣例 ∫f(x)e^{iwx}dx，x 到 w；label：「, Fourier transform is: 」）', 'Transforms > Fourier (MuPAD\'s convention, the integral of f(x) e^(iwx) dx, x to w; label: ", Fourier transform is: ")'],
  define: ['F', 'value', '定義 > 新定義（x = 3、f(x) = x^2）', 'Definitions > New Definition (x = 3, f(x) = x^2)'],
  showdefs: ['F', 'solutions', '定義 > 顯示定義', 'Definitions > Show Definitions'],
  cleardefs: ['F', 'solutions', '定義 > 清除定義', 'Definitions > Clear Definitions'],
  version: ['F', 'solutions', '工具 > 計算引擎：顯示版本', 'Tools > Engine Setup: the version'],
  plot: ['{expr, var, a, b, n}', 'points', '畫圖 2D：y = f(x) 的點', 'Plot 2D: points of y = f(x)'],
  plot3d: ['{expr, vars, a, b, c, d, n, m}', 'grid', '畫圖 3D：z = f(x, y) 的格點', 'Plot 3D: z = f(x, y) on a grid'],
  plotn: ['{exprs, vars, ranges, ns, grad, complex}', 'values', '畫圖：多個公式在格點上的值（等高線、向量場、複數）', 'Plots: several formulas on a grid (contours, fields, complex)'],
  odeplot: ['{eqs, inits, a, b, n}', 'ode', "畫圖 2D > 常微分方程（y' = f(x, y) 數值解）", "Plot 2D > ODE (y' = f(x, y) solved numerically)"],
  exam: ['{formulas, parts, ...}', 'exam', '工具 > 考卷產生器：一個版本的值', 'Tools > Exam Builder: one version'],
  // ---- the rest of 5.5's Compute menu, one part per group ----
  // part: matdecomp
  cholesky: ['F', 'value', '矩陣 > Cholesky 分解（回 G G^T）', 'Matrices > Cholesky Decomposition (answers G G^T)'],
  plu: ['F', 'value', '矩陣 > PLU 分解（回 P L U）', 'Matrices > PLU Decomposition (answers P L U)'],
  qr: ['F', 'value', '矩陣 > QR 分解（回 Q R，Q 是方陣）', 'Matrices > QR Decomposition (answers Q R, Q square)'],
  svd: ['F', 'value', '矩陣 > SVD（回 U D V，小數）', 'Matrices > SVD (answers U D V, decimals)'],
  singularvalues: ['F', 'solutions', '矩陣 > 奇異值（小數）', 'Matrices > Singular Values (decimals)'],
  jordan: ['F', 'value', '矩陣 > Jordan 標準形（回 P J P^{-1}，J 的 1 在對角線下）', 'Matrices > Jordan Form (answers P J P^{-1}, the ones of J below the diagonal)'],
  hermite: ['F', 'solutions', '矩陣 > Hermite 標準形（整數矩陣）', 'Matrices > Hermite Normal Form (integer matrices)'],
  smith: ['F', 'solutions', '矩陣 > Smith 標準形（整數或一個變數的多項式）', 'Matrices > Smith Normal Form (integers or polynomials in one variable)'],
  rationalcanonical: ['F', 'value', '矩陣 > 有理標準形（回 P B P^{-1}）', 'Matrices > Rational Canonical Form (answers P B P^{-1})'],
  ffgauss: ['F', 'solutions', '矩陣 > 無分數高斯消去', 'Matrices > Fraction-Free Gaussian Elimination'],
  gauss: ['F', 'solutions', '矩陣 > 高斯消去', 'Matrices > Gaussian Elimination'],
  minpoly: ['F', 'solutions', '矩陣 > 最小多項式（F+p：多項式變數，矩陣裡有 X 時要給）', 'Matrices > Minimum Polynomial (F+p: the polynomial variable, needed when the matrix has X in it)'],
  eigenvectors: ['F', 'solutions', '矩陣 > 特徵向量（每個特徵值配它的特徵向量）', 'Matrices > Eigenvectors (each eigenvalue with its eigenvectors)'],
  // (end of part: matdecomp)

  // part: matmisc
  colbasis: ['F', 'solutions', '矩陣 > 行空間基底（標籤 ", column basis: "）', 'Matrices > Column Basis (label ", column basis: ")'],
  rowbasis: ['F', 'solutions', '矩陣 > 列空間基底', 'Matrices > Row Basis'],
  concat: ['F', 'solutions', '矩陣 > 左右合併（公式裡相鄰的兩個以上矩陣，列數相同）', 'Matrices > Concatenate (matrices side by side, same number of rows)'],
  stack: ['F', 'solutions', '矩陣 > 上下合併（相鄰的矩陣，行數相同）', 'Matrices > Stack (matrices side by side, same number of columns)'],
  reshape: ['F+p', 'solutions', '矩陣 > 改變形狀（參數：行數；一串數或矩陣，由左到右、由上到下排）', 'Matrices > Reshape (params: number of columns; a list or matrix, read left to right, top to bottom)'],
  fillmatrix: ['F+p', 'value', "矩陣 > 填入矩陣（參數：'zero'|'identity'|'random'|'jordan'|'function'|'band'、列數、行數、項目；回答是沒有括號的新矩陣）", "Matrices > Fill Matrix (params: 'zero'|'identity'|'random'|'jordan'|'function'|'band', rows, columns, item; the answer is a new matrix without brackets)"],
  randommatrix: ['F+p', 'value', "矩陣 > 隨機矩陣（參數：'unrestricted'|'symmetric'|'antisymmetric'|'triangular'、列數、行數、最小、最大）", "Matrices > Random Matrix (params: 'unrestricted'|'symmetric'|'antisymmetric'|'triangular', rows, columns, min, max)"],
  condition: ['F', 'solutions', '矩陣 > 條件數（數值）', 'Matrices > Condition Number (numeric)'],
  definiteness: ['F', 'text', '矩陣 > 正定性檢查（" is positive definite"／" is indefinite"）', 'Matrices > Definiteness Tests (" is positive definite" / " is indefinite")'],
  norm: ['F', 'solutions', '矩陣 > 範數（2-範數；向量時是精確長度）', 'Matrices > Norm (the 2-norm; of a vector exactly)'],
  orthogonal: ['F', 'solutions', '矩陣 > 正交性檢查（true／false）', 'Matrices > Orthogonality Test (true / false)'],
  permanent: ['F', 'solutions', '矩陣 > 積和式', 'Matrices > Permanent'],
  spectralradius: ['F', 'solutions', '矩陣 > 譜半徑（數值）', 'Matrices > Spectral Radius (numeric)'],
  htranspose: ['F', 'solutions', '矩陣 > 共軛轉置', 'Matrices > Hermitian Transpose'],
  // (end of part: matmisc)

  // part: rewrite
  rewrite_rational: ['F', 'value', '改寫 > 有理數（小數改成分數）', 'Rewrite > Rational'],
  rewrite_float: ['F', 'value', '改寫 > 浮點數', 'Rewrite > Float'],
  rewrite_factorial: ['F', 'value', '改寫 > 階乘', 'Rewrite > Factorial'],
  rewrite_gamma: ['F', 'value', '改寫 > Gamma 函數', 'Rewrite > Gamma'],
  rewrite_log: ['F', 'value', '改寫 > 對數', 'Rewrite > Logarithm'],
  rewrite_sinhcosh: ['F', 'value', '改寫 > 雙曲正弦和雙曲餘弦', 'Rewrite > Sinh and Cosh'],
  rewrite_sin: ['F', 'value', '改寫 > 正弦', 'Rewrite > Sin'],
  rewrite_cos: ['F', 'value', '改寫 > 餘弦', 'Rewrite > Cos'],
  rewrite_tan: ['F', 'value', '改寫 > 正切', 'Rewrite > Tan'],
  rewrite_arcsin: ['F', 'value', '改寫 > 反正弦', 'Rewrite > Arcsin'],
  rewrite_arccos: ['F', 'value', '改寫 > 反餘弦', 'Rewrite > Arccos'],
  rewrite_arctan: ['F', 'value', '改寫 > 反正切', 'Rewrite > Arctan'],
  rewrite_arccot: ['F', 'value', '改寫 > 反餘切', 'Rewrite > Arccot'],
  rewrite_polar: ['F', 'value', '改寫 > 極座標形式', 'Rewrite > Polar'],
  rewrite_rectangular: ['F', 'value', '改寫 > 直角座標形式（a + bi）', 'Rewrite > Rectangular'],
  rewrite_normal: ['F', 'value', '改寫 > 標準形式（通分成一個分式）', 'Rewrite > Normal Form'],
  combine_exp: ['F', 'value', '合併 > 指數', 'Combine > Exponentials'],
  combine_log: ['F', 'value', '合併 > 對數（要先 assume(positive)，如 5.5）', 'Combine > Logs (after assume(positive), as in 5.5)'],
  combine_powers: ['F', 'value', '合併 > 冪次', 'Combine > Powers'],
  combine_trig: ['F', 'value', '合併 > 三角函數', 'Combine > Trig Functions'],
  combine_arctan: ['F', 'value', '合併 > 反正切', 'Combine > Arctan'],
  combine_hyp: ['F', 'value', '合併 > 雙曲三角函數', 'Combine > Hyperbolic Trig Functions'],
  eqs_to_matrix: ['F+p', 'solutions', '改寫 > 方程組成矩陣（參數：變數；回答增廣矩陣，label「, Corresponding matrix: 」）', 'Rewrite > Equations as Matrix (params: the variables; answers the augmented matrix)'],
  matrix_to_eqs: ['F+p', 'solutions', '改寫 > 矩陣成方程組（參數：變數；最後一行是右邊，方陣右邊是 0）', 'Rewrite > Matrix as Equations (params: the variables; the last column is the right side, 0 for a square matrix)'],
  // (end of part: rewrite)

  // part: statpoly
  // Statistics: a list is one set of data, a matrix one per column (a first row of names is left out); the answer follows 5.5's label
  mean: ['F', 'solutions', '統計 > 平均數（矩陣：每一行一個）', 'Statistics > Mean (a matrix: one per column)'],
  median: ['F', 'solutions', '統計 > 中位數（兩個中間數取小的，如 5.5）', 'Statistics > Median (of two middle numbers the smaller, as 5.5)'],
  mode: ['F', 'solutions', '統計 > 眾數（[眾數], 出現次數）', 'Statistics > Mode ([modes], how often)'],
  geomean: ['F', 'solutions', '統計 > 幾何平均數', 'Statistics > Geometric Mean'],
  harmonicmean: ['F', 'solutions', '統計 > 調和平均數', 'Statistics > Harmonic Mean'],
  meandev: ['F', 'solutions', '統計 > 平均差', 'Statistics > Mean Deviation'],
  variance: ['F', 'solutions', '統計 > 變異數（樣本，n − 1）', 'Statistics > Variance (sample, n − 1)'],
  stddev: ['F', 'solutions', '統計 > 標準差', 'Statistics > Standard Deviation'],
  moment: ['F+p', 'solutions', "統計 > 動差（參數：[次數, 原點]，或 [次數, 'mean']：對平均數）", "Statistics > Moment (params: [number, origin], or [number, 'mean']: about the mean)"],
  quantile: ['F+p', 'solutions', '統計 > 分位數（參數：[q]，0 < q < 1）', 'Statistics > Quantile (params: [q], 0 < q < 1)'],
  correlation: ['F', 'solutions', '統計 > 相關係數矩陣', 'Statistics > Correlation (the correlation matrix)'],
  covariance: ['F', 'solutions', '統計 > 共變異數矩陣', 'Statistics > Covariance (the covariance matrix)'],
  fitcurve: ['F+p', 'solutions', "統計 > 資料曲線擬合（參數：'regression'、'noconstant' 或 'polynomial'，'first' 或 'last'：應變數在哪一行，多項式的次數）", "Statistics > Fit Curve to Data (params: 'regression', 'noconstant' or 'polynomial'; 'first' or 'last': the dependent variable's column; the polynomial's degree)"],
  randomnumbers: ['F+p', 'value', "統計 > 亂數（公式不用；參數：分佈 'beta' 'binomial' 'cauchy' 'chisquare' 'exponential' 'f' 'gamma' 'normal' 'poisson' 't' 'uniform' 'weibull'，個數，分佈的參數）", "Statistics > Random Numbers (no formula needed; params: the distribution 'beta' 'binomial' 'cauchy' 'chisquare' 'exponential' 'f' 'gamma' 'normal' 'poisson' 't' 'uniform' 'weibull', how many, its parameters)"],
  // Polynomials: params [variable] (Collect: the variables); without it the one there is, or the error "Choose the polynomial variable"
  collect: ['F+p', 'value', '多項式 > 合併同類項（參數：變數）', 'Polynomials > Collect (params: the variables)'],
  divide: ['F+p', 'value', '多項式 > 除法（商 + 餘式/除式）', 'Polynomials > Divide (quotient + remainder/divisor)'],
  roots: ['F+p', 'solutions', '多項式 > 根（重根重複列出）', 'Polynomials > Roots (a multiple root as often as it is one)'],
  sort: ['F+p', 'value', '多項式 > 排序（次數由高到低）', 'Polynomials > Sort (by decreasing degree)'],
  companion: ['F+p', 'solutions', '多項式 > 友矩陣', 'Polynomials > Companion Matrix'],
  // (end of part: statpoly)

  // part: defsmisc
  interpret: ['F', 'value', '解讀（Ctrl+?）：公式被讀成什麼，不再計算', 'Interpret (Ctrl+?): the formula as it is read, worked out no further'],
  inversefourier: ['F', 'solutions', '轉換 > 反傅立葉轉換（label：, Is Fourier transform of）', 'Transforms > Inverse Fourier (label: , Is Fourier transform of)'],
  odelaplace: ['O', 'solutions', '解常微分方程 > 拉氏（O：["OdeSystem", 方程, 初值 [名, x0, 值, 階], "Nothing", 自變數或 "Nothing"]；只解常係數線性方程；label：, Laplace solution is:）', 'Solve ODE > Laplace (O: ["OdeSystem", equations, initial values [name, x0, value, order], "Nothing", the independent variable or "Nothing"]; linear, constant coefficients only; label: , Laplace solution is:)'],
  odeseries: ['O', 'solutions', '解常微分方程 > 級數（O，第 4 項是項數，"Nothing"：設定裡的 ODE 級數次數；label：, Series solution is:）', 'Solve ODE > Series (O, the 4th item the order, "Nothing": the Series Order setting; label: , Series solution is:)'],
  setoptions: ['S', 'text', '計算設定（S：{"digits", "threshold", "comp_digits", "imaginary_j", "bessel_subscripts", "ode_series_order"}；之後的答案照它）', 'Compute settings (S: {"digits", "threshold", "comp_digits", "imaginary_j", "bessel_subscripts", "ode_series_order"}; the answers follow them from then on)'],
  // (end of part: defsmisc)

  // part: anim
  // (end of part: anim)

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
  for (const m of py.matchAll(/^\s*EXTRA_OPS\["([a-z_0-9]+)"\] = /gm)) ops.add(m[1]); // the parts at the end
  for (const m of between(py, 'def compute(op, mathjson_text):', '\n\n\n').matchAll(/op (?:==|in) (\([^)]*\)|"[a-z_0-9]+")/g)) for (const w of words(m[1])) ops.add(w);
  return ops;
}

function wolframOps() {
  const wl = read('engine/opensw_compute.wl');
  const ops = new Set();
  for (const m of between(wl, 'operations = <|', '|>;').matchAll(/^\s*"([a-z_0-9]+)" ->/gm)) ops.add(m[1]);
  for (const w of words(wl.match(/^vectorOps = .*$/m)[0])) ops.add(w);
  for (const m of wl.matchAll(/^\s*\$extraOps\["([a-z_0-9]+)"\] = /gm)) ops.add(m[1]); // the parts near the end
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
