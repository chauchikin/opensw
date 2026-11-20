// Builds test/fixtures/engine/cases.json for scripts/engine-check.mjs: each case is a formula
// as LaTeX turned into the same MathJSON payload src/compute.js sends to an engine.
// Run: node scripts/engine-cases.mjs   (then: node scripts/engine-check.mjs <engine>)
import { writeFileSync } from 'node:fs';
import { ComputeEngine } from '@cortex-js/compute-engine';
import { standardTeX } from '../src/tex55.js';
import { demoProblems } from '../src/demos.js';
import { scopeDerivatives, explicitProducts, normalize, definedFunction, definedVector, vectorTeX, parseWithVectors, notation55, naturalLog, definitionOfI, odeRows, withSettings } from '../src/mathjson.js';

const ce = new ComputeEngine();
// as src/compute.js reads a formula (the functions defined so far stay functions, the vectors vectors)
const defined = new Set();
const vectors = new Set();
// 5.x groups digits with thin spaces (77\,531, 0.170\,06): one number, as in compute.js
const digits = (tex) => tex.replace(/(\d\.?)\s*\\,\s*(?=\d)/g, '$1');
// the Compute settings in force (Tools > Engine Setup), changed by the ['settings', {..}] lines below
let current = {};
const mj = (latex, op, subscript) => withSettings(normalize(parseWithVectors(ce, explicitProducts(scopeDerivatives(vectorTeX((current.logBase10 ? (t) => t : naturalLog)(digits(notation55(standardTeX(op === 'define' ? definitionOfI(latex, subscript === "'argument'") : latex)))), vectors.size > 0)), defined), vectors), defined, { derivatives: op !== 'ode', vectors }), current);
// [op, LaTeX, params or null, the answer's LaTeX must contain this (a list: one of them; the
//  forms engines write differently are made alike first, see engine-check.mjs), and for an
//  engine that answers otherwise: { engine id: what it must answer }]
const CASES = [
  ['evaluate', '\\int_0^1 x^2\\,dx', null, '\\frac{1}{3}'],
  ['evaluate', '\\sum_{k=1}^{10} k', null, '55'],
  ['evaluate', '\\frac{d}{dx}\\sin x', null, ['\\cos(x)', '\\cos x']],
  ['evaluate', '\\lim_{x\\to0}\\frac{\\sin x}{x}', null, '1'],
  ['numeric', '\\sqrt{2}', null, '1.4142'],
  ['simplify', '\\sin^2 x+\\cos^2 x', null, '1'],
  ['expand', '(x+1)^3', null, 'x^3+3x^2+3x+1'],
  ['factor', 'x^2+2x+1', null, '(x+1)^2'],
  ['factor', '360', null, '2^{3}\\cdot3^{2}\\cdot5'],
  ['solve', 'x^2-3x+2=0', null, ['1;2', 'x=1']],  // one unknown: its values alone, as 5.5 writes them
  ['check', '(x+1)^2=x^2+2x+1', null, true],
  ['check', 'x+1=x', null, false],
  ['determinant', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', null, '-2'],
  ['inverse', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', null, '\\begin{pmatrix}-2&1\\\\\\frac{3}{2}&-\\frac{1}{2}\\end{pmatrix}'],
  ['eigenvalues', '\\begin{pmatrix}2&0\\\\0&3\\end{pmatrix}', null, ['\\{3,2\\}', '\\{2,3\\}']],
  ['rank', '\\begin{pmatrix}1&2\\\\2&4\\end{pmatrix}', null, '1'],
  ['charpoly', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', null, 'X^2-5X-2'],
  ['partialfractions', '\\frac{1}{x^2-1}', null, '\\frac{1}{2(x-1)}'],
  ['series', 'e^x', null, 'O'],
  ['differentiate', 'x^3', null, '3x^2'],
  ['integrate', '\\frac{1}{1+x^2}', null, ['\\tan^{-1}(x)', '\\operatorname{atan}{(x)}', '\\arctan x']],
  ['laplace', 't^2', null, '\\frac{2}{s^3}'],
  ['ode', "y''+y=0", null, ['c_1\\cos(x)', 'C_2\\cos(x)', 'C_{2}\\cos x', 'c_{1}\\cos x']],
  ['extrema', 'x^2-2x', null, 'x=1'],
  // Implicit Differentiation as 5.5: every letter but the variable is a function of it (b'), y' gives y''
  ['implicitdiff', 'x^2+by=3', null, ["b^{\\prime}y", "yb^{\\prime}"]],
  ['implicitdiff', "y'=\\frac{y}{x}", null, "y^{\\prime\\prime}="],
  ['implicitdiff', 't^2+s^2=1', ['t'], ["ss^{\\prime}", "s^{\\prime}s"]],
  ['numericsolve', 'x^2-2=0', null, '1.4142'],
  ['mean', '\\begin{pmatrix}1&2&3&4\\end{pmatrix}', null, '\\frac{5}{2}'],
  ['gradient', 'x^2y', ['x', 'y'], '\\begin{pmatrix}2xy\\\\x^2\\end{pmatrix}'],
  ['curl', '\\begin{pmatrix}-y\\\\x\\\\0\\end{pmatrix}', ['x', 'y', 'z'], '2'],
  ['define', 'a=3', null, 'a=3'],
  ['evaluate', 'a^2+1', null, '10'],
  ['define', 'f(x)=x^2+1', null, 'f(x)=x^2+1'],
  ['evaluate', 'f(2)', null, '5'],
  ['cleardefs', '0', null, null],
  ['evaluate', 'a+1', null, 'a+1'],
  ['solve', '\\alpha^2=4', null, ['-2;2', '\\alpha=2']],
  ['evaluate', 'N+D', null, 'D+N'],
  ['byparts', '\\int x e^x dx', ['x'], '-\\inte^x'],
  ['showdefs', '0', null, null],
  ['check', 'x+1', null, 'error:Needs an equals sign'],
  ['integersolve', '3x+5y=1', null, ['x=2+5c_1', 'x=5t_0+2']],
  ['minimize', '\\begin{pmatrix}x+y\\\\x+2y\\geq 2\\\\3x+y\\geq 3\\end{pmatrix}', null, '\\text{minimum}=\\frac{7}{5}'],
  ['standardize', '\\begin{pmatrix}3x+2y\\\\x+y\\leq 4\\\\x+3y\\geq 6\\end{pmatrix}', null, '\\leq-6'],
  ['vectorpotential', '\\begin{pmatrix}0\\\\0\\\\1\\end{pmatrix}', ['x', 'y', 'z'], '\\begin{pmatrix}-y\\\\0\\\\0\\end{pmatrix}'],
  // SymPy cannot yet change the variable here (the limits of x = sin u are not unique for it)
  ['changevar', '\\int_0^1 \\sqrt{1-x^2}\\,dx', ['x=\\sin u'], '\\int_0^{\\frac{\\pi}{2}}', { sympy: 'error:unique limit' }],
  ['combine', '\\ln x+\\ln y', null, ['\\ln(xy)', '\\log(xy)', '\\ln x y']],
  ['rewrite_exp', '\\sin x', null, 'e^{-ix}'],
  ['inverselaplace', '\\frac{1}{s^2}', null, 't'],
  ['fourier', 'e^{-x^2}', null, '\\sqrt{\\pi}'],
  ['nullspace', '\\begin{pmatrix}1&2\\\\2&4\\end{pmatrix}', null, '\\begin{pmatrix}-2\\\\1\\end{pmatrix}'],
  ['hessian', 'x^2y', ['x', 'y'], '\\begin{pmatrix}2y&2x\\\\2x&0\\end{pmatrix}'],
  ['approxint', '\\int_0^1 x^2\\,dx', ["'trapezoid'", '4'], '0.34375'],
  ['iterate', '\\cos x', ['0', '2'], ['\\cos(1)', '\\cos 1']],
  // what 5.5 asks in a dialog, as params: the variable, the order, the unknowns; Pade
  ['series', '\\frac{1}{1-t}', ['t', '4'], 't^3+O'],
  ['series', '\\frac{1}{1-x}', ['x', '3', '2'], '(x-2)^2'],
  // Power Series' Number of terms counts from the lowest power, as in 5.5's help (MuPAD's series)
  ['series', '(1-2t)^{-1/2}', ['t', '6'], '\\frac{63}{8}t^{5}+O(t^{6})'],
  ['series', '\\frac{\\sin x}{x}', ['x', '10'], '\\frac{1}{362880}x^{8}+O(x^{10})'],
  ['series', 'e^x\\sin x', ['x', '6'], '\\frac{1}{90}x^{6}+O(x^{7})'],
  ['series', '\\ln x', ['x', '4', '1'], '\\frac{1}{4}(x-1)^{4}+O((x-1)^{5})'],
  // ... and O moves past powers whose coefficient is 0: the answers of 5.5 itself (2026-11-19)
  ['series', '\\sin x', ['x', '5'], '\\frac{1}{120}x^{5}+O(x^{7})'],
  ['series', '\\sin^2 x', ['x', '5'], '\\frac{2}{45}x^{6}+O(x^{8})'],
  ['series', '\\frac{\\sin x}{x}', ['x', '5'], '\\frac{1}{120}x^{4}+O(x^{6})'],
  ['series', '\\frac{\\cos x}{x^4}', ['x', '3'], 'O(1)'],
  ['differentiate', 'x^2y^3', ['y'], '3x^2y^2'],
  ['integrate', 'xy', ['y'], ['\\frac{xy^2}{2}', '\\frac{1}{2}xy^2']],
  ['solve', '\\begin{pmatrix}p=aq\\\\0=q+1\\end{pmatrix}', ['p', 'q'], 'p=-a'],
  ['pade', 'e^x', ['2', '2'], ['6x+12', '12+6x']],
  ['pade', '\\frac{x+y+\\beta}{bx-ay-\\alpha}', ['1', '1', 'x'], ['x+y+\\beta', '\\beta+x+y']],
  // read as in mathematics (src/mathjson.js)
  ['expand', 'x(a+b)', null, 'ax+bx'],
  ['simplify', '\\frac{d}{dy}f(y)+a-f\'(y)', null, 'a'],
  ['simplify', '\\Psi(y)-\\Psi(y)+\\Upsilon(x)', null, '\\Upsilon(x)'],
  ['evaluate', '\\left.x^2+y\\right|_{x=0}', null, 'y'],
  ['evaluate', '\\left.x^2\\right|_{0}^{1}', null, '1'],
  ['define', 'W(x)=x^3', null, 'W(x)=x^3'],
  ['evaluate', '\\frac{d}{dx}W(x)', null, '3x^2'],
  ['define', 'w(x,y)=\\frac{x+y}{b}', null, 'w(x,y)='],
  ['evaluate', '\\frac{\\partial}{\\partial x}w(x,y)', null, '\\frac{1}{b}'],
  ['define', 'w_0=\\frac{y}{b}', null, 'w_0='],
  ['evaluate', '\\frac{\\partial}{\\partial y}w_0', null, '\\frac{1}{b}'],
  ['cleardefs', '0', null, null],
  // matrices, vectors and lists as 5.5 computes them: the answer keeps the question's brackets
  ['evaluate', '\\left[ \\begin{array}{cc} 2 & 1 \\\\ 0 & 3\\end{array}\\right] +\\left[ \\begin{array}{cc} 1 & 1 \\\\ 1 & 1\\end{array}\\right]', null, ['[\\begin{matrix}3&2\\\\1&4\\end{matrix}]', '\\begin{pmatrix}3&2\\\\1&4\\end{pmatrix}']],
  ['evaluate', '\\left[ \\begin{array}{cc} 2 & 1 \\\\ 0 & 3\\end{array}\\right] ^{2}-1', null, '[\\begin{matrix}3&5\\\\0&8\\end{matrix}]'],
  ['evaluate', '\\left( \\begin{array}{cc} 1 & 2\\end{array}\\right) \\left( \\begin{array}{c} 3 \\\\ 4\\end{array}\\right)', null, '11'],
  ['evaluate', '\\left( \\begin{array}{cc} 1 & 2 \\\\ 3 & 5\\end{array}\\right) ^{-1}', null, '\\begin{pmatrix}-5&2\\\\3&-1\\end{pmatrix}'],
  ['evaluate', '\\left( \\begin{array}{cc} 1 & i \\\\ 0 & 2\\end{array}\\right) ^{H}', null, '\\begin{pmatrix}1&0\\\\-i&2\\end{pmatrix}'],
  ['evaluate', '\\left[ 1,0,0\\right] \\times \\left[ 0,1,0\\right]', null, '\\begin{pmatrix}0&0&1\\end{pmatrix}'],
  ['evaluate', '(1,2,2)\\cdot (2,0,1)', null, '4'],
  ['evaluate', '(1,2)+(3,-5)', null, '[\\begin{matrix}4&-3\\end{matrix}]'],
  ['evaluate', '\\left\\Vert (3,4)\\right\\Vert', null, '5'],
  ['evaluate', '\\Vert (1,-2,2)\\Vert _{1}', null, '5'],
  ['evaluate', '\\Vert \\left[ 1,-7,2\\right] \\Vert _{\\infty }', null, '7'],
  ['evaluate', '\\left\\Vert \\begin{array}{cc} 1 & -4 \\\\ 2 & 3\\end{array}\\right\\Vert _{1}', null, '7'],
  ['evaluate', '\\left\\Vert \\begin{array}{cc} 3 & 0 \\\\ 0 & -5\\end{array}\\right\\Vert', null, '5.0'],
  ['evaluate', '\\left\\vert \\begin{array}{cc} 2 & 5 \\\\ 1 & 4\\end{array}\\right\\vert', null, '3'],
  ['evaluate', '\\max \\left[ \\begin{array}{cc} 1 & 9 \\\\ -3 & 4\\end{array}\\right]', null, '9'],
  ['evaluate', '\\frac{d}{dx}\\left[ \\begin{array}{cc} x^{2} & \\sin x\\end{array}\\right]', null, ['[\\begin{matrix}2x&\\cos x\\end{matrix}]', '[\\begin{matrix}2x&\\cos(x)\\end{matrix}]', '\\begin{pmatrix}2x&\\cos(x)\\end{pmatrix}']],
  ['solve', '\\left[ \\begin{array}{cc} 1 & 1 \\\\ 1 & -1\\end{array}\\right] \\left[ \\begin{array}{c} x \\\\ y\\end{array}\\right] =\\left[ \\begin{array}{c} 3 \\\\ 1\\end{array}\\right]', null, '[\\begin{matrix}2\\\\1\\end{matrix}]'],
  ['evaluate', '\\nabla \\times \\left( \\begin{array}{c} -y \\\\ x \\\\ 0\\end{array}\\right)', null, '\\begin{pmatrix}0\\\\0\\\\2\\end{pmatrix}'],
  ['evaluate', '\\nabla \\cdot (x^{2},y,z)', null, '2x+2'],
  ['evaluate', '\\nabla \\left( x^{2}y\\right)', null, '\\begin{pmatrix}2xy\\\\x^2\\\\0\\end{pmatrix}'],
  ['define', 'M=\\left[ \\begin{array}{cc} 1 & 1 \\\\ 0 & 2\\end{array}\\right]', null, 'M='],
  ['evaluate', 'M^{2}+M+1', null, '[\\begin{matrix}3&4\\\\0&7\\end{matrix}]'],
  ['evaluate', 'M_{1,2}', null, '1'],
  ['define', 'u=\\left[ \\begin{array}{ccc} 1 & 2 & 3\\end{array}\\right]', null, 'u='],
  ['define', 'v=\\left[ \\begin{array}{ccc} 0 & 1 & 0\\end{array}\\right]', null, 'v='],
  ['evaluate', 'u\\times v', null, '[\\begin{matrix}-3&0&1\\end{matrix}]'],
  ['define', 'g(x)=x^{2}+1', null, 'g(x)='],
  ['evaluate', 'g\\left( \\left[ \\begin{array}{cc} 0 & 1 \\\\ 1 & 0\\end{array}\\right] \\right)', null, '[\\begin{matrix}2&0\\\\0&2\\end{matrix}]'],
  ['cleardefs', '0', null, null],
  // 5.5's notation (src/mathjson.js notation55): layout commands, mod, evaluation bars, Bessel ...
  ['evaluate', '\\lim\\limits_{x\\to 0}\\frac{\\sin 2x}{x}\\vspace{4pt}', null, '2'],
  ['evaluate', '\\displaystyle\\int_{0}^{2}x\\,dx', null, '2'],
  ['evaluate', '37\\func{mod}5', null, '2'],
  ['evaluate', '3^{-1}\\func{mod}11', null, '4'],
  ['evaluate', 'x^{3}+7x-4\\func{mod}3', null, 'x^3+x+2'],
  ['evaluate', 'x^{3}+1\\func{mod}\\left( x^{2}+1\\right)', null, '1-x'],
  ['factor', 'x^{4}+1\\func{mod}2', null, '(x+1)^4'],
  ['evaluate', '\\begin{pmatrix}7&5\\\\4&9\\end{pmatrix}\\func{mod}4', null, '\\begin{pmatrix}3&1\\\\0&1\\end{pmatrix}'],
  ['evaluate', '\\left[ x^{2}+y\\right] _{x=2}^{x=3}', null, '5'],
  ['evaluate', '\\left. xy\\right\\vert _{x=2,y=5}', null, '10'],
  // (J_0 as the Bessel function: Compute > Settings > Use I, J, K, and Y with Subscripts, off in 5.5 unless checked)
  ['setoptions', { bessel_subscripts: true }, null, null],
  ['evaluate', '\\frac{d}{dx}J_{0}\\left( x\\right)', null, '-J_1'],
  ['setoptions', { bessel_subscripts: false }, null, null],
  ['numeric', 'J_{1}\\left( 2\\right)', null, '0.57672'],
  ['evaluate', 'I_{1/2}\\left( x\\right)', null, '\\sinh'],
  ['evaluate', '\\func{Heaviside}\\left( 3\\right)+\\func{Dirac}\\left( 1\\right)', null, '1'],
  ['numeric', '\\arg \\left( 1+i\\right)', null, '0.78540'],
  ['evaluate', '\\sec ^{-1}2', null, ['\\frac{1}{3}\\pi', '\\frac{\\pi}{3}']],
  ['evaluate', '\\sin 30^{\\circ }', null, '\\frac{1}{2}'],
  ['evaluate', '\\left( 2-3i\\right) ^{\\ast }', null, '2+3i'],
  ['evaluate', '\\left\\{ 1,2,3\\right\\} \\cap \\left\\{ 2,u\\right\\}', null, '\\{2\\}'],
  ['evaluate', '\\left\\{ p,q\\right\\} \\cup \\left\\{ q,r\\right\\}', null, '\\{p,q,r\\}'],
  ['evaluate', '\\left\\{ 1,2\\right\\} \\setminus \\left\\{ 1,2\\right\\}', null, '\\emptyset'],
  ['evaluate', '\\max_{0\\leq k\\leq 4}\\left( k\\left( 4-k\\right) \\right)', null, '4'],
  ['evaluate', '3\\vee 7\\vee 5', null, '7'],
  ['evaluate', '\\lim_{x\\rightarrow 0}\\frac{1}{x}', null, ['\\operatorname{undefined}', '\\text{undefined}']],
  ['evaluate', '\\lim_{x\\rightarrow 0^{-}}\\frac{1}{x}', null, '-\\infty'],
  ['evaluate', '\\int 2xy', null, 'xy^2'],
  ['evaluate', '\\frac{d}{dx}\\left\\{ \\begin{array}{lll} x^{2} & \\text{if} & x<0 \\\\ 3x & \\text{if} & x\\geq 0\\end{array}\\right.', null, '2x'],
  ['evaluate', '\\func{Re}\\left( 3+4i\\right) +\\func{Im}\\left( 3+4i\\right)', null, '7'],
  // 5.5's transforms: \mathcal{L}(f) from t to s, \mathcal{F}(f) = int f e^{iwx} dx, inverses
  ['evaluate', '\\mathcal{L}\\left( t^{2}e^{t}\\right)', null, '\\frac{2}{(s-1)^3}'],
  ['evaluate', '\\mathcal{L}^{-1}\\left( \\frac{3}{u^{2}+9},u,v\\right)', null, ['\\sin3v', '\\sin(3v)']],
  ['evaluate', '\\mathcal{F}\\left( 5\\right)', null, '10\\pi\\operatorname{Dirac}(w)'],
  ['evaluate', '\\mathcal{F}^{-1}\\left( \\pi \\func{Dirac}\\left( w-3\\right) \\right)', null, 'e^{-3ix}'],
  ['evaluate', '\\tciFourier\\left( \\func{Dirac}\\left( x-1\\right) ,x,k\\right)', null, 'e^{ik}'],
  // 5.5's units (\unit{ft} is \mathrm{ft}): kept when alike, else in SI units; Solve in SI units
  ['evaluate', '3\\mathrm{m}+4\\mathrm{m}', null, '7\\mathrm{m}'],
  ['evaluate', '2\\mathrm{yd}+3\\mathrm{ft}', null, '2.7432\\mathrm{m}'],
  ['solve', '5\\mathrm{km}=x\\mathrm{mi}', null, ['3.1069', 'x=3.1069']],
  ['numeric', '\\cos 60\\mathrm{{{}^\\circ}}', null, '0.5'],
  ['evaluate', '\\int_{0}^{1}t\\,\\mathrm{d}t', null, '\\frac{1}{2}'],
  // |ax+b| = c (x complex: a circle, as 5.5; x real: below), a_k in a sum, D_{x^2y}(f), x \in (a, b) in Solve > Numeric
  ['solve', '\\left\\vert 2x+1\\right\\vert =3', null, '\\frac{3}{2}e^{2i\\pi t}-\\frac{1}{2}\\mid t\\in[0,1]'],
  ['evaluate', '\\sum_{j=1}^{3}b_{j}y^{j}', null, 'b_{2}y^{2}'],
  ['evaluate', 'D_{x^{2}y}\\left( x^{3}y^{2}\\right)', null, '12xy'],
  ['numericsolve', '\\begin{array}{c} \\cos x=x^{2} \\\\ x\\in \\left( 0,2\\right)\\end{array}', null, 'x=0.82413'],
  ['numericsolve', '\\begin{pmatrix} x+y=3 \\\\ x-y=1\\end{pmatrix}', null, 'x=2.0'],
  // MuPAD commands 5.5 passed on as they are
  ['evaluate', '\\func{factor}\\left( 360\\right)', null, '2^{3}\\cdot3^{2}\\cdot5'],
  ['evaluate', '\\func{expand}\\left( \\left( x+1\\right) ^{2}\\right)', null, 'x^2+2x+1'],
  ['evaluate', '\\func{float}\\left( \\frac{3}{8}\\right)', null, '0.375'],
  ['evaluate', '\\func{istrue}\\left( 3<2\\right)', null, ['false', '\\text{false}']],
  ['evaluate', '\\func{col}\\left( \\left[ \\begin{array}{cc} 1 & 2 \\\\ 4 & 3\\end{array}\\right] ,2\\right)', null, ['[\\begin{matrix}2\\\\3\\end{matrix}]', '\\begin{pmatrix}2\\\\3\\end{pmatrix}']],
  ['evaluate', '\\func{seq}_{k=1..3}\\left( k^{2}\\right)', null, '1,4,9'],
  ['evaluate', '\\lim_{x\\rightarrow b}x^{3}', null, 'b^3'],
  ['numericsolve', '\\hat{Z}^{2}=2', null, '\\hat{Z}=1.4142'],
  // 5.5's distribution functions (x; parameters)
  ['evaluate', '\\func{NormalDist}(1;0,1)', null, '0.84134'],
  ['numeric', '\\func{TInv}(0.975;10)', null, '2.2281'],
  ['evaluate', '\\func{PoissonDen}(1;2)', null, '0.27067'],
  ['evaluate', '\\func{BinomialDist}(1;4,0.5)', null, '0.3125'],
  // decimals as 5.5 shows them: 5 significant digits, d.dddd x 10^k below 0.1; a decimal in the
  // formula makes functions of numbers decimals, constants stay
  // (mathematica: '' = any answer: the .wl adapter does not follow these 5.5 forms yet)
  ['numeric', '\\frac{1}{30}', null, '3.3333\\times10^{-2}'],
  ['evaluate', '\\frac{1.5}{7}', null, '0.21429'],
  ['evaluate', '\\sqrt{1.5+i}', null, '1.2851+0.38909i'],
  ['evaluate', '2.5\\pi+\\pi', null, '3.5\\pi'],
  ['solve', '2x^2=1.0', null, '0.70711'],
  // \\log is ln, as in 5.5 (\\log_{10} is base 10)
  ['evaluate', '\\log(e^3)+\\log_{10}100', null, '5'],
  // Evaluate: an odd root of a negative number is the real root; Evaluate Numerically: the principal value
  ['evaluate', '\\sqrt[3]{-64}+\\sqrt[5]{-\\frac{1}{32}}', null, '-\\frac{9}{2}'],
  ['numeric', '\\sqrt[3]{-64}', null, '2.0+3.4641i'],
  // Expand: addition formulas and multiple angles (de Moivre), a fraction as a mixed number;
  // Combine: products and powers of sin, cos as sums; Rewrite: in sin and cos, in exponentials
  ['expand', '\\cos 3x', null, ['-3\\sin^{2} x\\cos x+\\cos^{3} x', '\\cos^{3} x-3\\cos x\\sin^{2} x']],
  ['expand', '\\sinh(a+b)', null, ['\\sinh a\\cosh b+\\sinh b\\cosh a', '\\cosh b\\sinh a+\\cosh a\\sinh b']],
  ['expand', '\\frac{7}{3}', null, '2\\frac{1}{3}'],
  ['combine', '\\cos^2 y', null, '\\frac{1}{2}\\cos 2 y'],
  ['rewrite_sincos', '\\sec x+\\cot x', null, '\\frac{\\cos x}{\\sin x}'],
  ['rewrite_exp', '\\tanh y', null, '\\frac{e^{2y}-1}{e^{2y}+1}'],
  ['simplify', '\\frac{2}{\\sqrt{5}-\\sqrt{3}}', null, ['\\sqrt{3}+\\sqrt{5}', '\\sqrt{5}+\\sqrt{3}']],
  // a fraction times the rest is written first, as 5.5: \\frac{1}{2}\\sqrt{3}; sin x, \\ln x without brackets
  ['evaluate', '\\frac{\\ln(xy)}{\\sin\\frac{\\pi}{7}}+\\cos(x+1)\\sin(2x)\\int_0^1 t\\,dt', null, '\\frac{\\ln x y}{\\sin \\frac{1}{7} \\pi}'],
  ['evaluate', 'y\\cos(x+1)\\sin(2x)', null, ['y\\sin 2 x\\cos(x+1)', 'y\\sin2x\\cos(x+1)', 'y\\cos(x+1)\\sin 2x']],
  ['evaluate', '\\cos\\frac{\\pi}{6}+\\frac{x}{4}', null, ['\\frac{1}{2}\\sqrt{3}', '\\frac{\\sqrt{3}}{2}']],
  ['evaluate', '\\frac{x}{4}', null, ['\\frac{1}{4}x', '\\frac{x}{4}']],
  ['evaluate', '\\arcsin 2i', null, '\\operatorname{arcsinh}2'],
  ['solve', '\\cos\\frac{\\pi}{9}=\\frac{3}{c}', null, '\\frac{3}{\\cos\\frac{1}{9}\\pi}'],
  ['evaluate', '\\cos\\frac{29}{9}\\pi', null, '-\\cos\\frac{2}{9}\\pi'],
  ['evaluate', '(2^{10}>10^{3})\\wedge(1=1)', null, 'true'],
  ['evaluate', '\\int_{-1}^{2}\\frac{dx}{x}', null, '\\operatorname{undefined}', { mathematica: 'fallback' }],
  // an inequality: the real numbers that satisfy it, as intervals
  ['solve', 'x^2-4x+3<0', null, '(1,3)'],
  ['solve', '2-x\\leq 3x', null, '[\\frac{1}{2},\\infty)'],
  // variables are complex unless assumed otherwise (the editor sends assume(...) as a definition)
  ['solve', 'x^3+4x=0', null, '2i'],
  // Solve as 5.5: every solution of a periodic or exponential equation (k an integer), one
  // with Principal Value Only; with more unknowns than equations, the first ones (as the dialog)
  ['solve', '\\cos x=\\frac{1}{2}', null, '\\left\\{\\frac{1}{3}\\pi+2\\pi k\\mid k\\in\\mathbb{Z}\\right\\}'],
  ['solve', 'x\\sin x=0', null, '\\left\\{\\pi k\\mid k\\in\\mathbb{Z}\\right\\}'],
  ['solve', '2^{x}=5', null, '\\frac{2i\\pi k}{\\ln2}'],
  ['solve', '\\cos x=0.5', null, '6.2832k-1.0472'],
  ['solve', '\\cos x=\\frac{1}{2}', ["'principal'"], '\\frac{1}{3}\\pi'],
  ['solve', 'x^2=9', ["'principal'"], '3'],
  ['solve', 'x+2y=4', null, '4-2y'],
  ['numericsolve', 'e^{x}=x+2', null, 'x=1.1462'],
  // the coefficient x - 2 can be 0: with Ignore Special Cases off, cases as 5.5 (SymPy; Mathematica hands it over)
  ['solve', 'a+xu^{\\prime }=2u^{\\prime }', ['u^{\\prime }'], '\\frac{a}{x-2}', { mathematica: 'fallback' }],
  ['solve', '\\left[ \\begin{array}{ccc} 1 & 2 & 0 \\\\ 0 & 1 & 1\\end{array}\\right] \\left[ \\begin{array}{c} p \\\\ q \\\\ r\\end{array}\\right] =\\left[ \\begin{array}{c} 3 \\\\ 1\\end{array}\\right]', null, '\\hat{t}_3'],
  ['evaluate', '2\\hat{t}_{3}+\\hat{t}_{3}', null, '3\\hat{t}_{3}'],
  ['define', 'h(x)=\\frac{x^{3}}{x-2}', null, 'h(x)'],
  ['solve', 'h^{\\prime }(x)=0', null, '0;3'],
  ['evaluate', '\\frac{2}{3}+e^{0.5i\\pi}', null, '\\frac{2}{3}+1.0i'],
  ['define', '\\operatorname{assume}(\\operatorname{real})', null, '\\mathbb{R}'],
  ['solve', 'x^3+4x=0', null, '0'],
  ['solve', '\\left\\vert 2x+1\\right\\vert =3', null, '-2;1'],
  ['evaluate', '|p+iq|', null, '\\sqrt{p^{2}+q^{2}}'],
  ['define', '\\operatorname{assume}(m,\\operatorname{positive})', null, '\\left(0,\\infty\\right)'],
  ['define', '\\operatorname{additionally}(m,\\operatorname{integer})', null, '\\mathbb{Z}\\cap\\left(0,\\infty\\right)'],
  ['evaluate', '\\operatorname{about}(m)', null, '\\mathbb{Z}\\cap\\left(0,\\infty\\right)'],
  ['evaluate', '\\sqrt{m^2}', null, 'm'],
  // assumptions written as relations, kept as sets (as 5.5 shows them); about of an expression
  ['define', '\\operatorname{additionally}(m<5)', null, '\\mathbb{Z}\\cap\\left(0,5\\right)'],
  ['define', '\\operatorname{assume}(\\operatorname{Re}(w)>1)', null, '\\left(1,\\infty\\right)+i\\mathbb{R}'],
  ['define', '\\operatorname{assume}(u\\neq 2)', null, '\\mathbb{R}\\setminus\\left\\{2\\right\\}'],
  ['evaluate', '\\operatorname{about}(m^2-1)', null, '\\mathbb{Z}\\cap\\left[0,\\infty\\right)'],
  ['cleardefs', '0', null, null],
  ['evaluate', '|p+iq|', null, '|{p+iq}|'],
  // definitions as 5.5 makes them: g(i) is a function of i (not of the imaginary unit); x = a keeps a
  // (its value when x is used), x := a puts in a's value now; a name may be defined again
  ['define', 'g(i)=0.5i', null, 'g(i)=0.5i'],
  ['evaluate', 'g(4)', null, '2.0'],
  ['define', 'q(i,j)=i\\ast j+1', null, 'q(i,j)=ij+1'],
  ['evaluate', 'q(2,3)', null, '7'],
  ['define', 'a=1', null, 'a=1'],
  ['define', 'b:=a', null, 'b=1'],
  ['define', 'c=a', null, 'c=a'],
  ['define', 'a=2', null, 'a=2'],
  ['evaluate', 'b+10c', null, '21'],
  ['define', 'v=[1,2]', null, 'v='],
  ['define', 'v=[3,4,5]', null, 'v='],
  ['evaluate', 'v', null, '3&4&5'],
  ['define', 'p(x)=\\left\\{\\begin{array}{lll} x & if & x<0 \\\\ x^{2} & if & x\\geq 0\\end{array}\\right.', null, 'p(x)='],
  ['evaluate', 'p(-3)+p(2)', null, '1'],
  ['define', 'w(x,y)=x^{2}y', null, 'w(x,y)='],
  ['evaluate', 'D_{x}w(x,y)', null, ['2xy', '2x y']],
  ['evaluate', '\\func{AiryAi}(x,1)+\\func{AiryBi}(x)', null, '\\operatorname{AiryAi}(x,1)+\\operatorname{AiryBi}(x,0)'],
  ['evaluate', '\\func{Dirac}(i)', null, '\\operatorname{undefined}'],
  ['cleardefs', '0', null, null],
  // MuPAD functions 5.5's pages call (series(f, x = a, n); nextprime, numlib::contfrac, numlib::divisors,
  // linalg::swapRow through Define MuPAD Name: here by their names, also inside a definition)
  ['evaluate', '\\func{series}\\left(\\frac{1}{x},x=1,3\\right)', null, '1-(x-1)+(x-1)^{2}+O((x-1)^{3})'],
  ['define', 'p(x)=\\operatorname{nextprime}(x)', null, 'p(x)='],
  ['evaluate', 'p(90)', null, '97'],
  ['evaluate', '\\operatorname{contfrac}\\left(\\sqrt{2},5\\right)', null, '1+\\frac{1}{2+\\frac{1}{2+\\frac{1}{2+\\frac{1}{2+\\frac{1}{2+\\frac{1}{2+..}}}}}}'],
  ['evaluate', '\\operatorname{divisors}(12)', null, '[1,2,3,4,6,12]'],
  ['evaluate', '\\operatorname{swapRow}\\left(\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix},1,2\\right)', null, '\\begin{pmatrix}3&4\\\\1&2\\end{pmatrix}'],
  ['cleardefs', '0', null, null],
  // 5.5's forms: Evaluate of an equation works out its right side; a^{x-y} expands to a^x/a^y; with i
  // Factor works over the Gaussian integers; partial fractions in a chosen variable; cases written as 5.5
  // writes them; an indefinite integral in the general case and without constant factors in ln
  ['evaluate', '\\operatorname{Re}(u+iv)=u+\\frac{1}{2}u', null, '\\frac{3}{2}u'],
  ['expand', 'b^{x-y}', null, '\\frac{b^{x}}{b^{y}}'],
  ['factor', 'i(x^{2}+4)', null, 'i(x-2i)(x+2i)'],
  ['partialfractions', '\\frac{1}{(x-y)(x+y)}', ['y'], ['\\frac{1}{2x(x+y)}', '-\\frac{1}{2x(y-x)}', '\\frac{1}{2x(x-y)}']],
  ['evaluate', '\\frac{d}{dx}\\left\\{\\begin{array}{lll} x^{2} & \\text{if} & x<1 \\\\ 2x & \\text{if} & x\\geq 1\\end{array}\\right.', null, '\\left\\{\\begin{array}{ccc}2x&\\text{if}&x<1\\\\2&\\text{if}&x\\geq1\\end{array}\\right.'],
  ['evaluate', '\\int e^{ax}\\sin bx\\,dx', null, ['\\frac{ae^{ax}\\sin bx}{a^{2}+b^{2}}', '\\frac{ae^{ax}\\sin bx-be^{ax}\\cos bx}{a^{2}+b^{2}}']],
  ['evaluate', '\\int\\frac{3}{4x+8}dx', null, '\\frac{3}{4}\\ln(x+2)'],
  ['evaluate', '\\mathcal{L}\\left(\\func{Heaviside}(t\\right)', null, '\\frac{1}{s}'],
  ['evaluate', '\\func{solve}\\left(x^{2}=4\\right)', null, ['\\{[x=-2],[x=2]\\}', '\\{[x=2],[x=-2]\\}']],
  // a_n = f(n) with n on the right: n is an argument (a_3, a_{n+1}, a_k in a sum)
  ['define', 'a_{n}=\\frac{1}{2^{n}}', null, 'a_n=\\frac{1}{2^{n}}'],
  ['evaluate', '\\sum_{n=1}^{\\infty}a_{n}+a_{2}', null, '\\frac{5}{4}'],
  // the variable of a definite integral, or of a function defined, is its own: not the x assumed nonzero
  ['define', '\\operatorname{assume}(x\\neq 0)', null, '\\mathbb{R}\\setminus\\left\\{0\\right\\}'],
  ['evaluate', '\\int_{-1}^{1}\\func{Dirac}(x)dx+\\func{Dirac}(x)', null, '1'],
  ['cleardefs', '0', null, null],
  // the chain rule written as 5.5 writes it: f'(g(x)), (g(x))^2
  ['evaluate', '\\frac{d}{dx}f(g(x))', null, "f^{\\prime}(g(x))"],
  ['evaluate', '\\frac{d}{dx}\\frac{1}{g(x)}', null, '(g(x))^{2}'],
  // D(x) = ..: a function named D (5.5's Define MuPAD Name), not the derivative D
  ['define', 'D(x)=x^{3}+1', null, 'D(x)=', { mathematica: 'fallback' }],
  ['evaluate', 'D\\left(2\\right)+D_{x}x^{2}', null, ['2x+9', '9+2x'], { mathematica: 'fallback' }],
  ['cleardefs', '0', null, null],
  // the variable a transform integrates over is its own: not the x assumed positive
  ['define', '\\operatorname{assume}(x,\\operatorname{positive})', null, '\\left(0,\\infty\\right)'],
  ['evaluate', '\\mathcal{F}\\left(\\operatorname{Dirac}(x)\\right)', null, '1'],
  ['cleardefs', '0', null, null],
  // a definite integral with a pole inside (not integrable there): not attempted, as 5.5 (SymPy's
  // antiderivative would give a finite number); an integrable one, or one SymPy finds infinite, is worked out
  ['evaluate', '\\int_{0}^{2}\\frac{2+\\cos x}{(x-\\cos x)^{2}}dx', null, '\\int', { mathematica: 'fallback' }],
  ['numeric', '\\int_{-1}^{1}\\frac{x}{x-\\sin 2x}dx', null, '\\int', { mathematica: 'fallback' }],
  ['evaluate', '\\int_{0}^{4}\\frac{1}{\\sqrt{x}}dx+\\int_{2}^{5}\\frac{dx}{x-2}', null, '\\infty', { mathematica: 'fallback' }],
  // a root of a negative decimal: \\sqrt[3]{..} the real root, (..)^{1/3} the principal value (5.5); after
  // assume(real) 5.5 gives the principal value of \\sqrt[3]{..} of a decimal too
  ['evaluate', '\\sqrt[3]{-0.064}+\\left(-0.064\\right)^{\\frac{1}{3}}', null, '-0.2+0.34641i', { mathematica: '' }],
  ['define', '\\operatorname{assume}(\\operatorname{real})', null, '\\mathbb{R}'],
  ['evaluate', '\\sqrt[3]{-0.064}', null, '0.2+0.34641i', { mathematica: '' }],
  ['cleardefs', '0', null, null],
  // an unknown assumed in a range: the solutions in it (5.5)
  ['define', '\\operatorname{assume}(t,\\operatorname{real})', null, '\\mathbb{R}'],
  ['define', '\\operatorname{additionally}(t<4)', null, '\\left(-\\infty,4\\right)'],
  ['define', '\\operatorname{additionally}(t>-1)', null, '\\left(-1,4\\right)'],
  ['solve', '\\cos\\pi t=0', null, '\\frac{7}{2}', { mathematica: '' }],
  ['cleardefs', '0', null, null],
  // d/dx [..]: brackets, as d/dx (..) (5.5)
  ['evaluate', '\\frac{d}{dx}\\left[ x^{3}+x\\right] -1', null, '3x^{2}'],
  // g_b(y) defined: g_2 is a subscripted name (5.5), g_2(3) a product
  ['define', 'g_{b}(y)=2by', null, 'g_{b}', { mathematica: '' }],
  ['evaluate', 'g_{2}\\left(3\\right)+g_{b}(1)', null, '3g_{2}', { mathematica: '' }],
  ['cleardefs', '0', null, null],
  // a math name of several letters (dt) is written upright, so it is read back as one name
  ['evaluate', '2\\operatorname{dt}+\\operatorname{dt}', null, '3\\operatorname{dt}', { mathematica: '' }],
  // Solve ODE > Numeric: the solutions are functions the engine keeps (y(0.5) a number, y of a column a column)
  ['odenumeric', "\\begin{pmatrix}y'=2y\\\\y(0)=3\\end{pmatrix}", null, 'y'],
  ['evaluate', 'y(0.5)+y\\left(-1\\right)', null, '8.5609'],
  ['odenumeric', "\\begin{pmatrix}u'=v\\\\v'=-u+t\\\\u(0)=0\\\\v(0)=1\\end{pmatrix}", null, 'u,v'],
  ['evaluate', 'u(2)', null, '2.0'],
  ['evaluate', 'v\\left[\\begin{array}{c}0\\\\3\\end{array}\\right]', null, '[\\begin{matrix}1.0\\\\1.0\\end{matrix}]'],
  // a second-order equation: y, y' are the state, so it needs y(0) and y'(0); y(1) = cos 1
  ['odenumeric', "\\begin{array}{r}y^{\\prime \\prime }+y=0\\\\y(0)=1\\\\y^{\\prime }(0)=0\\end{array}", null, 'y'],
  ['evaluate', 'y(1)', null, '0.54030'],
  ['showdefs', '0', null, 'y(0)=1'],
  // mixed orders: x'' = -x, y' = x with x(0) = 0, x'(0) = 1, y(0) = 0 (x = sin t, y = 1 - cos t)
  ['odenumeric', "\\begin{pmatrix}x''=-x\\\\y'=x\\\\x(0)=0\\\\x'(0)=1\\\\y(0)=0\\end{pmatrix}", null, 'x,y'],
  ['evaluate', 'y(\\pi )', null, '2.0'],
  ['cleardefs', '0', null, null],
  // the log base set to 10 (5.5's Base for Log Function): \\log x is \\log_{10} x, shown so (SymPy: Log10)
  ['settings', { logBase10: true }],
  ['evaluate', '3\\log x+\\ln e', null, ['3\\log_{10}x+1', '1+3\\log_{10}x']],
  ['evaluate', '\\log 1000', null, '3'],
  ['solve', '\\log t=3', null, '1000'],
  ['settings', { logBase10: false }],
  // ∇ in other basis variables (5.5's Set Basis Variables): they follow the formula
  ['settings', { basis: ['p', 'q', 'r'] }],
  ['evaluate', '\\nabla \\left( p^{2}qr+x\\right)', null, '\\begin{pmatrix}2pqr\\\\p^{2}r\\\\p^{2}q\\end{pmatrix}'],
  ['settings', { basis: ['x', 'y', 'z'] }],
  // Interpret Subscript: chosen as the engines' rule has it (the letter on the right), a plain definition;
  // against it, with the choice
  ['define', 'a_{i}=3i+1', ["'argument'"], 'a_{i}'],
  ['define', 'c_{n}=n^{2}', ["'name'"], 'c_{n}'],
  ['define', 'd_{n}=7', ["'argument'"], 'd_{n}'],
  ['evaluate', 'a_{2}+c_{3}+d_{4}', null, ['c_{3}+14', '14+c_{3}']],
  ['cleardefs', '0', null, null],
  // a defined name under a derivative: its definition is put in before differentiating
  // (with u = y^3 and w = y^2, d/dy (u + t w) is 3y^2 + 2ty; d/dy at t = 0 of its t-derivative is 2y)
  ['define', 'u=y^{3}', null, 'u=y^{3}'],
  ['define', 'w=y^{2}', null, 'w=y^{2}'],
  ['expand', '\\frac{\\partial}{\\partial y}(u+tw)', null, ['2ty+3y^{2}', '3y^{2}+2ty', '2yt+3y^{2}', '3y^{2}+2yt']],
  ['evaluate', '\\left.\\frac{\\partial}{\\partial t}\\frac{\\partial}{\\partial y}(u+tw)\\right|_{t=0}', null, '2y'],
  ['cleardefs', '0', null, null],
  // a limit of a quotient of polynomials with letters in it
  ['evaluate', '\\lim_{t\\to0}\\frac{(a+bt)^{2}-a^{2}}{t}', null, ['2ab', '2ba']],
  // ... the answer simplified ((a^2-b^2)/(a-b) is a+b), and a defined name with the variable in it put in first
  ['evaluate', '\\lim_{t\\to0}\\frac{a^{2}-b^{2}+t}{a-b}', null, ['a+b', 'b+a']],
  ['define', 'u=t^{2}+3t', null, 'u='],
  ['evaluate', '\\lim_{t\\to0}\\frac{u}{t}', null, '3'],
  ['cleardefs', '0', null, null],
  // a power series of a quotient of polynomials with several letters in it (SymPy's own series took minutes)
  ['define', 'w_0=-\\frac{\\beta+y}{ay+\\alpha}', null, 'w_0='],
  ['define', 'w_1=-\\frac{x\\left(x(ay+\\alpha)+b(\\beta+y)\\right)}{(ay+\\alpha)^2}', null, 'w_1='],
  ['series', '\\frac{\\left(b(w_0+tw_1)-2x\\right)\\frac{\\partial}{\\partial y}(w_0+tw_1)}{1+a(w_0+tw_1)}', ['t', '2'], 'O(t^{2})'],
  ['cleardefs', '0', null, null],
  // ---- the rest of 5.5's Compute menu, one part per group ----
  // part: matdecomp
  // Matrices: decompositions and normal forms (answers from 5.5's help, dm8-3, dm8-6, dm8-7, dm8-8)
  ['gauss', '\\begin{pmatrix}8&2&3\\\\2&-5&8\\end{pmatrix}', null, '\\begin{pmatrix}8&2&3\\\\0&-\\frac{11}{2}&\\frac{29}{4}\\end{pmatrix}'],
  ['ffgauss', '\\begin{pmatrix}8&2&3\\\\2&-5&8\\end{pmatrix}', null, '\\begin{pmatrix}8&2&3\\\\0&-44&58\\end{pmatrix}'],
  ['ffgauss', '\\begin{pmatrix}1&2&3\\\\2&4&6\\\\3&2&1\\end{pmatrix}', null, '\\begin{pmatrix}1&2&3\\\\0&-4&-8\\\\0&0&0\\end{pmatrix}'],
  ['plu', '\\begin{pmatrix}1&2&3\\\\2&4&6\\\\3&2&1\\end{pmatrix}', null, '\\begin{pmatrix}1&0&0\\\\0&0&1\\\\0&1&0\\end{pmatrix}\\begin{pmatrix}1&0&0\\\\3&1&0\\\\2&0&1\\end{pmatrix}\\begin{pmatrix}1&2&3\\\\0&-4&-8\\\\0&0&0\\end{pmatrix}'],
  ['plu', '\\begin{pmatrix}45&-8\\\\-93&92\\\\43&-62\\end{pmatrix}', null, '\\begin{pmatrix}1&0&0\\\\-\\frac{31}{15}&1&0\\\\\\frac{43}{45}&-\\frac{1223}{1698}&1\\end{pmatrix}'],
  ['plu', '\\begin{pmatrix}0.532&1.95\\\\1.5&0.0013\\end{pmatrix}', null, '\\begin{pmatrix}0&1\\\\1&0\\end{pmatrix}\\begin{pmatrix}1.0&0\\\\0.35467&1.0\\end{pmatrix}'],
  ['qr', '\\begin{pmatrix}3&0\\\\4&5\\end{pmatrix}', null, '\\begin{pmatrix}\\frac{3}{5}&-\\frac{4}{5}\\\\\\frac{4}{5}&\\frac{3}{5}\\end{pmatrix}\\begin{pmatrix}5&4\\\\0&3\\end{pmatrix}'],
  ['cholesky', '\\begin{pmatrix}4&2\\\\2&2\\end{pmatrix}', null, '\\begin{pmatrix}2&0\\\\1&1\\end{pmatrix}\\begin{pmatrix}2&1\\\\0&1\\end{pmatrix}'],
  ['cholesky', '\\begin{pmatrix}2.0&-1.0\\\\-1.0&2.0\\end{pmatrix}', null, '\\begin{pmatrix}1.4142&0\\\\-0.70711&1.2247\\end{pmatrix}'],
  ['singularvalues', '\\begin{pmatrix}5&-5&-3\\\\-3&0&5\\\\1&5&4\\end{pmatrix}', null, '[10.053,4.6119,3.5588]'],
  ['svd', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', null, '\\begin{pmatrix}0.40455&-0.91451\\\\0.91451&0.40455\\end{pmatrix}\\begin{pmatrix}5.4650&0\\\\0&0.36597\\end{pmatrix}\\begin{pmatrix}0.57605&0.81742\\\\0.81742&-0.57605\\end{pmatrix}'],
  ['jordan', '\\begin{pmatrix}2&0&0&0\\\\1&2&0&0\\\\0&0&2&0\\\\0&0&-3&2\\end{pmatrix}', null, '\\begin{pmatrix}1&0&0&0\\\\0&1&0&0\\\\0&0&-\\frac{1}{3}&0\\\\0&0&0&1\\end{pmatrix}\\begin{pmatrix}2&0&0&0\\\\1&2&0&0\\\\0&0&2&0\\\\0&0&1&2\\end{pmatrix}\\begin{pmatrix}1&0&0&0\\\\0&1&0&0\\\\0&0&-3&0\\\\0&0&0&1\\end{pmatrix}'],
  ['jordan', '\\begin{pmatrix}1&2\\\\-1&-1\\end{pmatrix}', null, '\\begin{pmatrix}-i&0\\\\0&i\\end{pmatrix}'],
  ['smith', '\\begin{pmatrix}4&18&-10\\\\18&24&-18\\\\96&24&-48\\end{pmatrix}', null, '\\begin{pmatrix}2&0&0\\\\0&6&0\\\\0&0&24\\end{pmatrix}'],
  ['smith', '\\begin{pmatrix}x-5&6&6\\\\1&x-4&-2\\\\-3&6&x+4\\end{pmatrix}', null, '\\begin{pmatrix}1&0&0\\\\0&x-2&0\\\\0&0&x^2-3x+2\\end{pmatrix}'],
  ['hermite', '\\begin{pmatrix}7&34&46\\\\4&20&27\\end{pmatrix}', null, '\\begin{pmatrix}1&2&3\\\\0&4&5\\end{pmatrix}'],
  ['hermite', '\\begin{pmatrix}2&5\\\\-4&5\\end{pmatrix}', null, '\\begin{pmatrix}2&5\\\\0&15\\end{pmatrix}'],
  ['rationalcanonical', '\\begin{pmatrix}1&2&3\\\\4&5&6\\\\7&8&9\\end{pmatrix}', null, '\\begin{pmatrix}1&1&30\\\\0&4&66\\\\0&7&102\\end{pmatrix}\\begin{pmatrix}0&0&0\\\\1&0&18\\\\0&1&15\\end{pmatrix}\\begin{pmatrix}1&-2&1\\\\0&-\\frac{17}{9}&\\frac{11}{9}\\\\0&\\frac{7}{54}&-\\frac{2}{27}\\end{pmatrix}'],
  ['rationalcanonical', '\\begin{pmatrix}5&-6&-6\\\\-1&4&2\\\\3&-6&-4\\end{pmatrix}', null, '\\begin{pmatrix}1&5&2\\\\0&-1&0\\\\0&3&1\\end{pmatrix}\\begin{pmatrix}0&-2&0\\\\1&3&0\\\\0&0&2\\end{pmatrix}\\begin{pmatrix}1&-1&-2\\\\0&-1&0\\\\0&3&1\\end{pmatrix}'],
  ['minpoly', '\\begin{pmatrix}4&1&0\\\\0&4&0\\\\0&0&4\\end{pmatrix}', null, 'X^2-8X+16'],
  ['minpoly', '\\begin{pmatrix}1&2&3\\\\4&5&6\\\\7&8&9\\end{pmatrix}', null, 'X^3-15X^2-18X'],
  ['minpoly', '\\begin{pmatrix}3X&x\\\\5&y\\end{pmatrix}', ['\\lambda'], ['\\lambda^2+(-3X-y)\\lambda+(3Xy-5x)', '\\lambda^2+(-3X-y)\\lambda+(-5x+3Xy)']],
  ['minpoly', '\\begin{pmatrix}3X&x\\\\5&y\\end{pmatrix}', null, 'error:polynomial variable'],
  ['eigenvectors', '\\begin{pmatrix}5&-6&-6\\\\-1&4&2\\\\3&-6&-4\\end{pmatrix}', null, '\\{\\begin{pmatrix}1\\\\-\\frac{1}{3}\\\\1\\end{pmatrix}\\}\\leftrightarrow1,\\{\\begin{pmatrix}2\\\\0\\\\1\\end{pmatrix},\\begin{pmatrix}2\\\\1\\\\0\\end{pmatrix}\\}\\leftrightarrow2'],
  // (end of part: matdecomp)

  // part: matmisc
  // Compute > Matrices, the examples of 5.5's help (Doing Mathematics ch. 8: dm8-1, dm8-5, dm8-6, dm8-7)
  ['colbasis', '\\left[\\begin{array}{rrrr}-85&-55&-37&-35\\\\97&50&79&56\\\\49&63&57&-59\\\\-36&8&20&-94\\end{array}\\right]', null, '\\left[\\begin{matrix}-37\\\\79\\\\57\\\\20\\end{matrix}\\right]'],
  ['rowbasis', '\\left[\\begin{array}{rrrr}-85&-55&-37&-35\\\\97&50&79&56\\\\49&63&57&-59\\\\-36&8&20&-94\\end{array}\\right]', null, '\\left[\\begin{matrix}49&63&57&-59\\end{matrix}\\right]\\right]'],
  ['concat', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}\\begin{pmatrix}5&6\\\\7&8\\end{pmatrix}', null, '\\begin{pmatrix}1&2&5&6\\\\3&4&7&8\\end{pmatrix}'],
  ['stack', '\\left[\\begin{array}{cc}1&2\\\\3&4\\\\-5&7\\end{array}\\right]\\left[\\begin{array}{cc}5&6\\end{array}\\right]', null, '\\left[\\begin{matrix}1&2\\\\3&4\\\\-5&7\\\\5&6\\end{matrix}\\right]'],
  ['reshape', '45,21,8,19,0,5,15,6', ['3'], '\\begin{matrix}45&21&8\\\\19&0&5\\\\15&6&\\end{matrix}'],
  ['reshape', '\\left[\\begin{array}{rrrr}-85&-55&-37&-35\\\\97&50&79&56\\end{array}\\right]', ['3'], '\\begin{matrix}-85&-55&-37\\\\-35&97&50\\\\79&56&\\end{matrix}'],
  ['norm', '\\begin{pmatrix}2&3\\\\5&7\\end{pmatrix}', null, '9.3268'],
  ['norm', '\\begin{pmatrix}2+3i&5\\\\6&-7+2i\\end{pmatrix}', null, '9.9378'],
  ['norm', '\\begin{pmatrix}3\\\\4\\end{pmatrix}', null, '5'],
  ['condition', '\\left[\\begin{array}{ccc}0&1&0\\\\0&0&1\\\\1&0&0\\end{array}\\right]', null, '1.0'],
  ['condition', '\\left[\\begin{array}{rrr}5&-5&-3\\\\-3&0&5\\\\1&5&4\\end{array}\\right]', null, '2.8249'],
  ['condition', '\\left[\\begin{array}{cccc}2&-1&0&0\\\\-1&2&-1&0\\\\0&-1&2&-1\\\\0&0&-1&2\\end{array}\\right]', null, '9.4721'],
  ['spectralradius', '\\left[\\begin{array}{rrr}5&-3&1\\\\-3&0&5\\\\1.0&5&4\\end{array}\\right]', null, '7.7627'],
  ['spectralradius', '\\left[\\begin{array}{cc}5&-4\\\\-4&3.0\\end{array}\\right]', null, '8.1231'],
  ['definiteness', '\\left[\\begin{array}{cc}2&-1\\\\-1&2\\end{array}\\right]', null, null],
  ['definiteness', '\\left[\\begin{array}{cc}1&-1\\\\-1&1\\end{array}\\right]', null, null],
  ['orthogonal', '\\begin{pmatrix}0&0&1\\\\1&0&0\\\\0&1&0\\end{pmatrix}', null, 'true'],
  ['orthogonal', '\\begin{pmatrix}0&1\\\\1&1\\end{pmatrix}', null, 'false'],
  ['permanent', '\\left[\\begin{array}{cc}a&b\\\\c&d\\end{array}\\right]', null, ['ad+bc', 'bc+ad']],
  ['htranspose', '\\begin{pmatrix}2+i&-i\\\\4-i&2+i\\end{pmatrix}', null, '\\begin{pmatrix}2-i&4+i\\\\i&2-i\\end{pmatrix}'],
  ['fillmatrix', '0', ["'identity'", '3', '4'], '\\begin{matrix}1&0&0&0\\\\0&1&0&0\\\\0&0&1&0\\end{matrix}'],
  ['fillmatrix', '0', ["'zero'", '2', '2'], '\\begin{matrix}0&0\\\\0&0\\end{matrix}'],
  ['fillmatrix', '0', ["'jordan'", '2', '2', '\\lambda'], '\\begin{matrix}\\lambda&1\\\\0&\\lambda\\end{matrix}'],
  ['fillmatrix', '0', ["'band'", '2', '5', 'a,b,c'], '\\begin{matrix}b&c&0&0&0\\\\a&b&c&0&0\\end{matrix}'],
  ['fillmatrix', '0', ["'function'", '2', '2', '5'], '\\begin{matrix}5&5\\\\5&5\\end{matrix}'],
  ['define', 'f(i,j)=\\frac{1}{i+j-1}', null, 'f(i,j)'],
  ['fillmatrix', '0', ["'function'", '2', '2', 'f'], '\\begin{matrix}1&\\frac{1}{2}\\\\\\frac{1}{2}&\\frac{1}{3}\\end{matrix}'],
  ['cleardefs', '0', null, null],
  ['randommatrix', '0', ["'antisymmetric'", '2', '2', '1', '1'], '\\begin{matrix}0&1\\\\-1&0\\end{matrix}'],
  ['randommatrix', '0', ["'triangular'", '2', '2', '3', '3'], '\\begin{matrix}3&3\\\\0&3\\end{matrix}'],
  // (end of part: matmisc)

  // part: rewrite
  ['rewrite_rational', '0.125', null, '\\frac{1}{8}'],
  ['rewrite_rational', '4.72', null, '\\frac{118}{25}'],
  ['rewrite_rational', '6.9\\pi', null, '\\frac{69}{10}'],
  ['rewrite_rational', '3.1416', null, '\\frac{3927}{1250}'],
  ['rewrite_float', '\\frac{1}{8}', null, '0.125'],
  ['rewrite_float', '\\frac{69}{10}\\pi', null, '21.677'],
  ['rewrite_float', '\\frac{3927}{1250}', null, '3.1416'],
  ['rewrite_factorial', '\\binom{m}{n}', null, '\\frac{m!}{n! (m-n)!}'],
  ['rewrite_factorial', '\\Gamma(x)', null, '(x-1)!'],
  ['rewrite_factorial', '\\binom{m}{5}', null, '\\frac{m!}{120 (m-5)!}'],
  ['rewrite_gamma', '(x-1)!', null, '\\Gamma(x)'],
  ['rewrite_gamma', '\\binom{m}{n}', null, '\\frac{\\Gamma(m+1)}{\\Gamma(n+1)\\Gamma(m-n+1)}'],
  ['rewrite_gamma', 'x!y!z!', null, '\\Gamma(x+1)\\Gamma(y+1)\\Gamma(z+1)'],
  ['rewrite_log', '\\operatorname{arcsinh}x', null, '\\ln(x+\\sqrt{x^2+1})'],
  ['rewrite_log', '\\operatorname{arccosh}x', null, '\\ln(x+\\sqrt{x^2-1})'],
  ['rewrite_log', '\\operatorname{arcsech}x', null, '\\frac{1}{x}'],
  ['rewrite_sinhcosh', '\\operatorname{sech}x\\tanh x-\\operatorname{csch}^2x', null, '\\frac{\\sinh x}{\\cosh^2x}-\\frac{1}{\\sinh^2x}'],
  ['rewrite_sin', '\\cos x', null, '1-2\\sin^2\\frac{1}{2}x'],
  ['rewrite_sin', '\\tan x', null, '\\frac{\\sin x}{1-2\\sin^2\\frac{1}{2}x}'],
  ['rewrite_cos', '\\sin x', null, '2\\cos^2(\\frac{1}{2}x-\\frac{1}{4}\\pi)-1'],
  ['rewrite_tan', '\\sin x', null, '\\frac{2\\tan\\frac{1}{2}x}{\\tan^2\\frac{1}{2}x+1}'],
  ['rewrite_tan', '\\cos x\\sin x-2\\sec x\\csc x', null, '\\tan\\frac{1}{2}x'],
  ['rewrite_arcsin', '\\arctan x', null, '\\arcsin(\\frac{x}{\\sqrt{x^2+1}})'],
  ['rewrite_arcsin', '\\arccos x', null, '-\\arcsin x+\\frac{1}{2}\\pi'],
  ['rewrite_arccos', '\\arcsin x', null, '-\\arccos x+\\frac{1}{2}\\pi'],
  ['rewrite_arccos', '\\operatorname{arccot}x', null, '\\arccos(\\frac{x}{\\sqrt{x^2+1}})'],
  ['rewrite_arctan', '\\arcsin x', null, '\\arctan(\\frac{x}{\\sqrt{1-x^2}})'],
  ['rewrite_arctan', '\\arccos x', null, '-\\arctan(\\frac{x}{\\sqrt{1-x^2}})+\\frac{1}{2}\\pi'],
  ['rewrite_arctan', '\\arctan x+\\operatorname{arccot}x', null, '\\frac{1}{2}\\pi'],
  ['rewrite_arccot', '\\arctan x', null, '-\\operatorname{arccot}x+\\frac{1}{2}\\pi'],
  ['rewrite_arccot', '\\arccos x', null, '\\operatorname{arccot}(\\frac{x}{\\sqrt{1-x^2}})'],
  ['rewrite_polar', '3+5i', null, '\\sqrt{34}e^{i\\arctan\\frac{5}{3}}'],
  // Mathematica writes \frac{\sqrt{2}}{16\pi} as \frac{1}{8\sqrt{2}\pi} as soon as it reads it (the same number)
  ['rewrite_polar', '16\\pi-\\sqrt{2}i', null, 'e^{-i\\arctan\\frac{\\sqrt{2}}{16\\pi}}', { mathematica: 'e^{-i\\arctan\\frac{1}{8\\sqrt{2}\\pi}}' }],
  ['rewrite_rectangular', '\\sqrt[3]{i}', null, '\\frac{1}{2}\\sqrt{3}+\\frac{1}{2}i'],
  ['rewrite_rectangular', '\\sqrt{2+3i}', null, '\\sqrt{1+\\frac{1}{2}\\sqrt{13}}+i\\sqrt{-1+\\frac{1}{2}\\sqrt{13}}'],
  ['rewrite_rectangular', '(a+bi)^{-1}', null, '\\frac{a}{a^2+b^2}-\\frac{ib}{a^2+b^2}'],
  ['rewrite_rectangular', 'i^i', null, 'e^{-\\frac{1}{2}\\pi}'],
  ['rewrite_rectangular', '5^{2i}', null, '\\cos(2\\ln5)+i\\sin(2\\ln5)'],
  ['rewrite_rectangular', '\\sqrt{34}e^{i\\arctan\\frac{5}{3}}', null, '3+5i'],
  ['rewrite_rectangular', '\\frac{6+7i}{4-3i}', null, '\\frac{3}{25}+\\frac{46}{25}i'],
  ['rewrite_normal', '\\frac{3x^2+3x}{8x^2+7}+\\frac{5x^2+3}{2x^2+x+7}', null, '\\frac{46x^4+9x^3+83x^2+21x+21}{16x^4+8x^3+70x^2+7x+49}'],
  ['rewrite_sincos', '\\tan x', null, '\\frac{\\sin x}{\\cos x}'],
  ['rewrite_sincos', 'e^{-15i}', null, '\\cos15-i\\sin15'],
  ['rewrite_sincos', 're^{it}', null, '\\sin t'],
  ['rewrite_sincos', '\\frac{6+7i}{4-3i}', null, '\\frac{3}{25}+\\frac{46}{25}i'],
  ['rewrite_sincos', '\\cos x\\sin x-2\\sec x\\csc x', null, '\\frac{2}{\\sin x\\cos x}'],
  ['rewrite_exp', '\\sinh x', null, '\\frac{1}{2}e^x-\\frac{1}{2}e^{-x}'],
  ['rewrite_exp', '\\coth x', null, '\\frac{e^{2x}+1}{e^{2x}-1}'],
  ['combine_exp', '\\left(e^x\\right)^y', null, 'e^{xy}'],
  ['combine_exp', 'e^xe^y', null, 'e^{x+y}'],
  ['combine_exp', '2^x2^y', null, '2^x2^y'],
  ['combine_exp', '\\left(e^{a+b}\\right)^3', null, 'e^{3a+3b}'],
  ['combine_exp', 'e^{x^2-3xy}e^{2x+5}', null, 'e^{x^2-3xy+2x+5}'],
  ['combine_powers', 'a^xa^y', null, 'a^{x+y}'],
  ['combine_powers', '3^{x^2-3xy}3^{2x+5}', null, '3^{x^2-3xy+2x+5}'],
  ['combine_powers', '\\frac{a^x}{a^y}', null, 'a^{x-y}'],
  ['combine_powers', '10^{x+i}10^{x-i}', null, '10^{2x}'],
  ['combine_log', '\\ln x+\\ln y', null, '\\ln x+\\ln y'],
  // 5.5: Combine > Logs after assume(positive) (dm3-5.tex)
  ['define', '\\operatorname{assume}(\\operatorname{positive})', null, null],
  ['combine_log', '\\ln x+\\ln y', null, '\\ln xy'],
  ['combine_log', '\\ln a-\\ln b', null, '\\ln\\frac{a}{b}'],
  ['define', '\\operatorname{unassume}(\\operatorname{positive})', null, null],
  ['combine_trig', '\\sin x\\sin y', null, '\\frac{1}{2}\\cos(x-y)-\\frac{1}{2}\\cos(x+y)'],
  ['combine_trig', '\\sin^2x', null, '\\frac{1}{2}-\\frac{1}{2}\\cos2x'],
  ['combine_trig', '\\sin x\\cos y', null, '\\frac{1}{2}\\sin(x+y)'],
  ['combine_trig', '\\begin{bmatrix}\\sin^2x+\\cos^2x&6x^2\\\\4\\sin 4x\\cos 4x&\\sin x\\cos y+\\sin y\\cos x\\end{bmatrix}', null, '2\\sin8x&\\sin(x+y)'],
  ['combine_arctan', '\\arctan x+\\arctan y', null, '-\\arctan(\\frac{x+y}{xy-1})'],
  ['combine_arctan', '\\arctan x-\\arctan y', null, '\\arctan(\\frac{x-y}{xy+1})'],
  ['combine_hyp', '\\sinh x\\sinh y', null, '-\\frac{1}{2}\\cosh(x-y)+\\frac{1}{2}\\cosh(x+y)'],
  ['combine_hyp', '\\sinh x\\cosh y', null, '\\frac{1}{2}\\sinh(x-y)+\\frac{1}{2}\\sinh(x+y)'],
  ['combine_hyp', '\\cosh x\\cosh y', null, '\\frac{1}{2}\\cosh(x-y)+\\frac{1}{2}\\cosh(x+y)'],
  ['eqs_to_matrix', '\\left\\{x+2y=3,3x-5y=0\\right\\}', ['x', 'y'], '1&2&3\\\\3&-5&0'],
  ['eqs_to_matrix', '\\begin{bmatrix}x+y-2z=1\\\\2x-4y+z=0\\\\2y-3z=-1\\end{bmatrix}', ['x', 'y', 'z'], '1&1&-2&1\\\\2&-4&1&0\\\\0&2&-3&-1'],
  ['eqs_to_matrix', '\\left\\{x+2y-3,3x-5y\\right\\}', ['x', 'y'], '1&2&3\\\\3&-5&0'],
  ['matrix_to_eqs', '\\begin{pmatrix}1&1&-1\\\\2&-3&1\\end{pmatrix}', ['x', 'y'], '\\{x+y=-1,2x-3y=1\\}'],
  ['matrix_to_eqs', '\\begin{bmatrix}1&1&-2&1\\\\2&-4&1&0\\\\0&2&-3&-1\\end{bmatrix}', ['x', 'y', 'z'], 'x+y-2z=1,2x-4y+z=0,2y-3z=-1'],
  // (end of part: rewrite)

  // part: statpoly
  // Statistics (5.5's help, dm11-2, dm11-3, dm11-8): a list, or a matrix column by column
  ['mean', '23,5,-6,18,23,-22,5', null, '\\frac{46}{7}'],
  ['mean', 'a,b,c', null, '\\frac{1}{3}a+\\frac{1}{3}b+\\frac{1}{3}c'],
  ['mean', '16.5,22.1,6.9,14.2,9.0', null, '13.74'],
  ['mean', '\\begin{bmatrix}23&5&-6\\\\18&23&-22\\\\5&0&0\\end{bmatrix}', null, '[\\frac{46}{3},\\frac{28}{3},-\\frac{28}{3}]'],
  ['mean', '\\begin{bmatrix}x&y&z\\\\1&1&4\\\\3&2&5\\\\5&3&6\\\\7&4&7\\end{bmatrix}', null, '[4,\\frac{5}{2},\\frac{11}{2}]'],
  ['median', '1,2,3,4', null, '2'],
  ['median', '23,5,-6,18,23,-22,5,7', null, '5'],
  ['median', '\\begin{bmatrix}23&5&-6\\\\18&23&-22\\\\5&0&0\\end{bmatrix}', null, '[18,5,-6]'],
  ['mode', '23,5,-6,18,23,-22,5', null, '[23,5],2'],
  ['mode', '\\begin{bmatrix}23&5&-6\\\\18&23&-22\\\\5&23&0\\end{bmatrix}', null, '[[23,18,5],1,[23],2,[-6,-22,0],1]'],
  ['geomean', '3,56,14,2', null, '\\sqrt[4]{4704}'],
  ['geomean', '5.19,7.3,2.77,3.67,8', null, '4.9859'],
  ['harmonicmean', '2,4,6,8', null, '\\frac{96}{25}'],
  ['harmonicmean', '\\begin{bmatrix}47&82&8&89\\\\53&62&11&47\\end{bmatrix}', null, '[\\frac{2491}{50},\\frac{1271}{18},\\frac{176}{19},\\frac{4183}{68}]'],
  ['meandev', '1,2,3,4,5', null, '\\frac{6}{5}'],
  ['meandev', '\\begin{bmatrix}-85&-55&-37\\\\-35&97&50\\end{bmatrix}', null, '[25,76,\\frac{87}{2}]'],
  ['variance', '5,1,89,4,29,47,18', null, '\\frac{21055}{21}'],
  ['variance', '\\begin{bmatrix}18.1\\\\5.3\\\\7.6\\end{bmatrix}', null, '46.563'],
  ['variance', '\\begin{bmatrix}23&5&-6\\\\18&23&-22\\\\5&0&0\\end{bmatrix}', null, '[\\frac{259}{3},\\frac{439}{3},\\frac{388}{3}]'],
  ['stddev', '\\left[5,1,89,4,29,47,18\\right]', null, '\\frac{1}{21}\\sqrt{21}\\sqrt{21055}'],
  ['stddev', '\\begin{bmatrix}18.1\\\\5.3\\\\7.6\\end{bmatrix}', null, '6.8237'],
  ['stddev', '\\begin{bmatrix}23&5&-6\\\\18&23&-22\\\\5&0&0\\end{bmatrix}', null, '\\frac{2}{3}\\sqrt{3}\\sqrt{97}'],
  ['covariance', '\\begin{bmatrix}1&2\\\\3&5\\\\4&3\\end{bmatrix}', null, '2.3333&1.1667'],
  ['correlation', '\\begin{bmatrix}-50&-12&-18\\\\31&-26&-62\\\\1&-47&-91\\end{bmatrix}', null, '1.0&-0.52883&-0.71054'],
  ['moment', '0.1,0.5,0.8,0.4', ['2', '0'], '0.265'],
  ['moment', '\\begin{bmatrix}8.5&-3.5&7.9\\\\-5.5&9.7&5.6\\\\-3.7&5.0&4.9\\\\3.5&2.7&9.4\\end{bmatrix}', ['1', '0.5'], '[0.2,2.975,6.45]'],
  ['moment', '2,4,6,8,10,12,14,16,18', ['4', "'mean'"], '1258.7'],
  ['quantile', '1,2,3,4,5,6,7,8,9,10', ['0.87'], '9'],
  ['quantile', '\\begin{bmatrix}23&5&-6\\\\18&23&-22\\\\5&0&0\\end{bmatrix}', ['0.33'], '[5,0,-22]'],
  ['fitcurve', '\\begin{bmatrix}y&x\\\\0&1.1\\\\0.5&1.5\\\\1&1.9\\\\1.5&2.4\\\\2&2.9\\end{bmatrix}', ["'regression'", "'first'"], 'y=1.1073x-1.1703'],
  ['fitcurve', '\\begin{bmatrix}z&x&y\\\\1&0&1.1\\\\2&0.5&1.1\\\\4&1&1.9\\\\5&1.5&1.9\\\\7&2&2.9\\end{bmatrix}', ["'noconstant'", "'first'"], 'z=2.1829x+0.91245y'],
  ['fitcurve', '\\begin{bmatrix}1&12\\\\3&4\\\\5&6\\\\7&8\\\\9&18\\end{bmatrix}', ["'polynomial'", "'last'", '4'], '27.797'],
  ['randomnumbers', '0', ["'poisson'", '5', '4'], null],
  // Polynomials (5.5's help, dm3-1, dm8-8)
  ['divide', '\\frac{3x^2+3x}{8x^2+7}', null, '\\frac{3x-\\frac{21}{8}}{8x^2+7}'],
  ['divide', '\\frac{5x^2y^3+3x-2y}{4x+y}', null, 'error:Choose the polynomial variable'],
  ['divide', '\\frac{5x^2y^3+3x-2y}{4x+y}', ['y'], '\\frac{-320x^5+11x}{4x+y}'],
  ['roots', '5x^2+2x-3', null, '\\begin{pmatrix}-1\\\\\\frac{3}{5}\\end{pmatrix}'],
  ['roots', 'x^3+5x^2+9x+45', null, '\\begin{pmatrix}-5\\\\-3i\\\\3i\\end{pmatrix}'],
  ['sort', 'x^2+3x+5-3x^3+5x^2+4x^3+13+2x^4', null, '2x^4+x^3+6x^2+3x+18'],
  ['sort', '5t^2+2t-16t^5+t^3-2t^2+9+at^2', ['t'], '-16t^5+t^3+3t^2+at^2+2t+9'],
  ['collect', '5t^2+2t-16t^5+t^3-2t^2+9+at^2', ['t'], ['t^2(a+3)', '(a+3)t^2']],
  ['companion', 'x^4+3x^2-2x+1', null, '\\begin{pmatrix}0&0&0&-1\\\\1&0&0&2\\\\0&1&0&-3\\\\0&0&1&0\\end{pmatrix}'],
  ['companion', 'x^3+ax^2+bx+c', ['x'], '\\begin{pmatrix}0&0&-c\\\\1&0&-b\\\\0&1&-a\\end{pmatrix}'],
  // (end of part: statpoly)

  // part: defsmisc
  // Compute > Interpret (Ctrl+?): the formula as read, with the brackets that say what goes with what (5.5's help, trigarg.tex)
  // Interpret shows how opensw reads the formula: the SymPy engine answers it (Mathematica: fallback)
  ['interpret', '\\sin x+5', null, '\\sin x+5', { mathematica: 'fallback' }],
  ['interpret', '\\left( 1/3\\right) x+4', null, '\\frac{1}{3}x+4', { mathematica: 'fallback' }],
  ['interpret', '\\sin\\left(x\\right) e^{x}', null, ['\\sin\\left(x\\right)e^{x}', 'e^{x}\\sin x'], { mathematica: 'fallback' }],
  // Transforms > Inverse Fourier (5.5's help dm10-1.tex: 2 pi Dirac(w), Is Fourier transform of 1)
  ['inversefourier', '2\\pi \\operatorname{Dirac}\\left( w\\right)', null, '1'],
  ['inversefourier', '1', null, '\\operatorname{Dirac}\\left(x\\right)'],
  ['inversefourier', '2\\pi \\operatorname{Dirac}\\left( w+1\\right)', null, 'e^{ix}'],
  // Solve ODE > Laplace (dm10-2.tex): {3 cos x + sin x + x^2 - 2}; nonlinear: no solution
  ['odelaplace', "\\begin{array}{r}y''+y=x^{2}\\\\y(0)=1\\\\y'(0)=1\\end{array}", null, ['x^2+\\sin x+3\\cos x-2', '3\\cos x+\\sin x+x^2-2', 'x^2+\\sin(x)+3\\cos(x)-2', '-2+x^2+3\\cos(x)+\\sin(x)']],
  ['odelaplace', "\\begin{array}{c}y''+y=0\\\\y\\left( 0\\right) =0\\\\y'\\left( 0\\right) =1\\end{array}", null, ['\\{\\sin x\\}', '\\{\\sin(x)\\}']],
  ['odelaplace', "\\begin{array}{r}y'=x\\\\x'=-y\\\\x(0)=0\\\\y(0)=1\\end{array}", null, ['x(t)=-\\sin t,y(t)=\\cos t', 'x(t)=-\\sin(t),y(t)=\\cos(t)']],
  ['odelaplace', "\\begin{array}{r}y'=y^{2}+4\\\\y(0)=-2\\end{array}", null, null],
  // Solve ODE > Series (dm10-2.tex, series order 5, Independent Variable t)
  ['odeseries', "\\begin{array}{r}y'=y^{2}+4\\\\y(0)=-2\\end{array}", ['5', 't'], '-2+8t-16t^2+\\frac{128}{3}t^3-\\frac{320}{3}t^4+O(t^5)'],
  ['odeseries', "\\begin{array}{r}y''-y=0\\\\y(0)=1\\\\y'\\left( 0\\right) =0\\end{array}", ['5'], '1+\\frac{1}{2}x^2+\\frac{1}{24}x^4+O(x^5)'],
  // Define MuPAD Name (5.5's help dm5-6.tex: n(x) <-> nextprime(x)); then n(100)
  ['mapname', 'n(x)', ['nextprime'], null],
  ['evaluate', 'n\\left( 100\\right) ', null, '101'],
  ['mapname', 'c', ['PI'], null],
  ['numeric', 'c', null, '3.1416'],
  ['cleardefs', '0', null, null],
  // Compute > Settings: Digits Shown 8, Threshold 3, i to j, Bessel names without subscripts; then 5.5's own again (Bessel names without subscripts is 5.5's own)
  ['setoptions', { digits: 8, threshold: 3, imaginary_j: true, bessel_subscripts: false }, null, null],
  ['numeric', '\\sqrt{2}', null, '1.4142136'],
  ['numeric', '12345\\sqrt{2}', null, '1.7458466\\times10^{4}'],
  ['evaluate', '3i\\cdot 2', null, '6j'],
  ['setoptions', { digits: 5, threshold: 5, imaginary_j: false, bessel_subscripts: false }, null, null],
  ['numeric', '\\sqrt{2}', null, '1.4142'],
  // (end of part: defsmisc)

  // part: anim
  // (end of part: anim)

  // part: core55
  // how 5.5 reads a formula (its help: trigarg.tex, dm1-3.tex): each is checked against the form with brackets
  ['check', '\\sin x+5=\\left(\\sin x\\right)+5', null, true],
  ['check', '\\sin (a+b)x=\\sin\\left(\\left(a+b\\right)x\\right)', null, true],
  ['check', '\\sin (a+b)x=\\left(\\sin\\left(a+b\\right)\\right)x', null, false],
  ['check', '\\sin x(a+b)=\\sin\\left(x\\left(a+b\\right)\\right)', null, true],
  ['check', '\\sin x\\cos x=\\left(\\sin x\\right)\\left(\\cos x\\right)', null, true],
  ['check', '\\sin x(\\cos x+\\tan x)=\\sin\\left(x\\left(\\cos x+\\tan x\\right)\\right)', null, true],
  ['check', '\\sin \\left( x\\right) (a+\\cos b)=\\left(\\sin x\\right)\\left(a+\\cos b\\right)', null, true],
  ['check', '\\sin x\\cos \\left( ax+b\\right)=\\left(\\sin x\\right)\\cos\\left(ax+b\\right)', null, true],
  ['check', '\\sin x\\left( \\cos \\left( ax+b\\right) \\right)=\\sin\\left(x\\cos\\left(ax+b\\right)\\right)', null, true],
  ['check', '\\sin xe^{x}=\\left(\\sin x\\right)e^{x}', null, true],
  ['check', '\\sin x\\left( a+e^{b}\\right)=\\sin\\left(x\\left(a+e^{b}\\right)\\right)', null, true],
  ['check', '\\sin \\left( x\\right) \\left( a+e^{b}\\right)=\\left(\\sin x\\right)\\left(a+e^{b}\\right)', null, true],
  ['check', '\\sin x/2=\\sin\\frac{x}{2}', null, true],
  ['check', '\\sin (x)/2=\\frac{\\sin x}{2}', null, true],
  ['check', '\\sin x/\\cos x=\\frac{\\sin x}{\\cos x}', null, true],
  ['check', '\\sin xy/2=\\sin\\left(x\\frac{y}{2}\\right)', null, true],
  ['check', '\\sin (xy)/2=\\frac{\\sin\\left(xy\\right)}{2}', null, true],
  ['check', '\\ln x^{2}y=\\ln\\left(x^{2}y\\right)', null, true],
  ['check', '1/3x+4=\\frac{1}{3}x+4', null, true],
  ['check', '1/3x+4=\\frac{1}{3x}+4', null, false],
  ['check', '1/\\left( 3x+4\\right)=\\frac{1}{3x+4}', null, true],
  ['check', '1/3\\left( x+4\\right)=\\frac{1}{3}\\left(x+4\\right)', null, true],
  ['check', 'a/bc/d=\\frac{ac}{bd}', null, true],
  ['interpret', '1/3x+4', null, '\\frac{1}{3}x+4', { mathematica: 'fallback' }],
  ['interpret', '\\sin x/2', null, ['\\sin\\frac{x}{2}', '\\sin\\left(\\frac{x}{2}\\right)', '\\sin\\frac{1}{2}x'], { mathematica: 'fallback' }],
  // Transforms as 5.5 (MuPAD, dm10-1.tex): F f(w) = int f(x) e^(iwx) dx, with 5.5's words before the answer
  ['fourier', '1', null, '2\\pi\\operatorname{Dirac}\\left(w\\right)'],
  ['fourier', '\\operatorname{Dirac}\\left( x\\right)', null, '1'],
  ['fourier', '\\operatorname{Heaviside}\\left( x\\right)', null, ['\\pi\\operatorname{Dirac}\\left(w\\right)+\\frac{i}{w}', '\\frac{i}{w}+\\pi\\operatorname{Dirac}\\left(w\\right)']],
  ['fourier', 'e^{-ix}', null, '2\\pi\\operatorname{Dirac}\\left(w-1\\right)'],
  ['fourier', 'e^{2\\pi ix}', null, ['2\\pi\\operatorname{Dirac}\\left(w+2\\pi\\right)', '2\\pi\\operatorname{Dirac}\\left(2\\pi+w\\right)']],
  ['fourier', '\\frac{1}{x}', null, ['i\\pi\\left(2\\operatorname{Heaviside}\\left(w\\right)-1\\right)', 'i\\pi(2\\operatorname{Heaviside}(w)-1)']],
  ['laplace', 't', null, '\\frac{1}{s^2}'],
  ['inverselaplace', '\\frac{2}{s^{3}}', null, 't^2'],
  // Solve Options (Compute > Settings > Engine Setup; 5.5's help dm3-3.tex, dm7-3.tex): Maximum Degree 3, Ignore Special Cases off
  // a root above the Maximum Degree, or cases: Mathematica hands them to SymPy, which writes them as 5.5
  ['solve', 'x^{4}+x-1=0', null, ['\\rho_{1}\\text{where}\\rho_{1}\\text{isarootof}X_{1}^{4}+X_{1}-1,X_{1}'], { mathematica: 'fallback' }],
  ['solve', 'x^{4}+x=0', null, '\\frac{1}{2}\\sqrt{3}i'],
  ['solve', '\\cos x+y+xz=z', ['z'], ['x\\neq1\\\\\\mathbb{C}&\\text{if}&x=1\\wedgey=-\\cos1'], { mathematica: 'fallback' }],
  ['setoptions', { max_degree: 1, ignore_special: true }, null, null],
  ['solve', '5x^{2}+3x=1', null, ['\\rho_{1}\\text{where}\\rho_{1}\\text{isarootof}5X_{1}^{2}+3X_{1}-1,X_{1}'], { mathematica: 'fallback' }],
  ['solve', 'x^{4}+x=0', null, ['\\left\\{-1,0\\right\\}\\cup\\rho_{1}\\text{where}\\rho_{1}\\text{isarootof}X_{1}^{2}-X_{1}+1,X_{1}'], { mathematica: 'fallback' }],
  ['solve', '\\cos x+y+xz=z', ['z'], ['-\\frac{y+\\cos x}{x-1}', '\\frac{-y-\\cos x}{x-1}']],
  ['setoptions', { max_degree: 3, ignore_special: false }, null, null],
  // (end of part: core55)
  // integers of more than 4300 digits (Python refuses to print them unless told otherwise)
  ['evaluate', '2^{20000}', null, '39802768403379665923543072061912024537047727804924'],
  ['evaluate', '2000!', null, '33162750924506332411753933805763240382811172081057'],
];
// the problems of the demo documents (src/demos.js, File > Samples), each demo from a clean start
for (const [demo, p] of demoProblems()) {
  if (p === demo.sections[0].problems[0]) CASES.push(['cleardefs', '0', null, null]);
  if (p.op) CASES.push([p.op, p.latex, p.params || null, p.expect, p.by]);
}
CASES.push(['cleardefs', '0', null, null]);
const out = CASES.flatMap(([op, latex, params, expect, by]) => {
  if (op === 'settings') { current = { ...current, ...latex }; return []; }
  if (op === 'define' && params?.length === 1 && /^'(argument|name)'$/.test(params[0])) { // Interpret Subscript, as compute.js
    const expr = mj(latex, op, params[0]);
    const onRight = JSON.stringify(expr[2]).includes(JSON.stringify(expr[1].split('_')[1]));
    const json = (params[0] === "'argument'") !== onRight ? { expr, params } : expr;
    return { op, latex, json: JSON.stringify(json), expect, ...(by && { by }) };
  }
  if (op === 'odenumeric') { // as compute.js: the equations and initial values of the column, a definition
    const { equations, inits } = odeRows(latex);
    inits.forEach(([name]) => defined.add(name));
    const json = ['OdeNumeric', ['List', ...equations.map((l) => mj(l, 'ode'))], ['List', ...inits.map(([n, a, v, k]) => ['List', n, mj(a), mj(v), k])]];
    return { op: 'define', latex, json: JSON.stringify(json), expect, ...(by && { by }) };
  }
  if (op === 'odelaplace' || op === 'odeseries') { // as compute.js: ["OdeSystem", equations, initial values, order, variable]
    const { equations, inits } = odeRows(latex);
    const [order, v] = params || [];
    const json = ['OdeSystem', ['List', ...equations.map((l) => mj(l, 'ode'))], ['List', ...inits.map(([n, a, w, k]) => ['List', n, mj(a), mj(w), k])], order ? mj(order) : 'Nothing', v ? mj(v) : 'Nothing'];
    return { op, latex, json: JSON.stringify(json), expect, ...(by && { by }) };
  }
  if (op === 'setoptions') return { op, latex: JSON.stringify(latex), json: JSON.stringify(latex), expect, ...(by && { by }) }; // Compute > Settings
  if (op === 'mapname') { // Define MuPAD Name, as compute.js mapName: [name(args), MuPAD name]
    const [name, args] = [latex.split('(')[0], (latex.match(/\((.*)\)/) || [])[1]];
    const json = ['Equal', args ? [name, ...args.split(',')] : name, ['MapName', `'${params[0]}'`, args ? "'procedure'" : "'value'"]];
    defined.add(name);
    return { op: 'define', latex, json: JSON.stringify(json), expect, ...(by && { by }) };
  }
  const expr = mj(latex, op);
  if (op === 'define' && definedFunction(expr)) defined.add(definedFunction(expr));
  if (op === 'define' && definedVector(expr)) vectors.add(definedVector(expr));
  if (op === 'cleardefs') { defined.clear(); vectors.clear(); }
  const payload = params ? { expr, params: params.map((p) => (p.startsWith("'") ? p : mj(p))) } : expr;
  return { op, latex, json: JSON.stringify(payload), expect, ...(by && { by }) };
});
writeFileSync(new URL('../test/fixtures/engine/cases.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out.length, 'cases');
