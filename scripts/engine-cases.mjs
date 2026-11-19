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
// the Compute settings in force (Tools > Computation Engine), changed by the ['settings', {..}] lines below
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
  ['evaluate', '\\frac{d}{dx}J_{0}\\left( x\\right)', null, '-J_1'],
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
  ['evaluate', '\\cos(x+1)\\sin(2x)y', null, ['y\\sin 2 x\\cos(x+1)', 'y\\sin2x\\cos(x+1)', 'y\\cos(x+1)\\sin 2x']],
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
  ['solve', 'a+xu^{\\prime }=2u^{\\prime }', ['u^{\\prime }'], '\\frac{a}{x-2}'],
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
  const expr = mj(latex, op);
  if (op === 'define' && definedFunction(expr)) defined.add(definedFunction(expr));
  if (op === 'define' && definedVector(expr)) vectors.add(definedVector(expr));
  if (op === 'cleardefs') { defined.clear(); vectors.clear(); }
  const payload = params ? { expr, params: params.map((p) => (p.startsWith("'") ? p : mj(p))) } : expr;
  return { op, latex, json: JSON.stringify(payload), expect, ...(by && { by }) };
});
writeFileSync(new URL('../test/fixtures/engine/cases.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out.length, 'cases');
