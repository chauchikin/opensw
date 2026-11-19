// Formulas read for the Compute menu as in mathematics (src/mathjson.js). Run: node test/mathjson.mjs
import { ComputeEngine } from '@cortex-js/compute-engine';
import { scopeDerivatives, explicitProducts, normalize, vectorTeX, notation55, naturalLog, definitionOfI, withSettings, odeRows } from '../src/mathjson.js';

const ce = new ComputeEngine();
const read = (tex, fns, opts) => JSON.stringify(normalize(ce.parse(explicitProducts(scopeDerivatives(tex), new Set(fns || []))).json, new Set(fns || []), opts));
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : detail); };
const is = (tex, want, fns, opts) => { const got = read(tex, fns, opts); check(tex, got === JSON.stringify(want), got); };

// a letter before brackets: a product, unless it is a function
is('x(a+b)', ['Multiply', 'x', ['Add', 'a', 'b']]);
is('x \\left(a+b\\right)', ['Multiply', 'x', ['Add', 'a', 'b']]); // as Mathematica writes a product
is('b (\\beta+y)', ['Multiply', 'b', ['Add', 'beta', 'y']]);
is('X(ay+b)', ['Multiply', 'X', ['Add', ['Multiply', 'a', 'y'], 'b']]);
is('\\xi(a+b)', ['Multiply', 'xi', ['Add', 'a', 'b']]);
is('f(x+1)', ['f', ['Add', 'x', 1]]);
is('u(x)', ['u', 'x']);
is('w(0,y)', ['w', 0, 'y']);
is('y(0)=1', ['Equal', ['y', 0], 1]);
is('\\Psi(y)', ['Psi', 'y']);
is('u(x+1)', ['u', ['Add', 'x', 1]], ['u']); // defined as a function
is('W(x)=x^2', ['Equal', ['W', 'x'], ['Power', 'x', 2]]);
// derivatives
is("f'(y)+1", ['Add', ['D', ['f', 'y'], 'y'], 1]);
is("f''(0)", ['EvaluateAt', ['Function', ['Block', ['D', ['f', 'opensw_t'], 'opensw_t', 'opensw_t']], 'opensw_t'], 0]);
is('\\frac{d}{dy}f(y)+a', ['Add', 'a', ['D', ['f', 'y'], 'y']]);
is('\\frac{\\partial}{\\partial y}w_0', ['D', 'w_0', 'y']);
is('\\frac{d^2}{dx^2}x^3-x', ['Add', ['Negate', 'x'], ['D', ['D', ['Power', 'x', 3], 'x'], 'x']]);
is('\\frac{d}{dx}\\left(x^2\\right)y+1', ['Add', ['Multiply', 'y', ['D', ['Power', 'x', 2], 'x']], 1]);
is('\\left(\\frac{d}{dy}f(y)+aw\\right)\\frac{\\partial w}{\\partial x}', ['Multiply', ['Add', ['Multiply', 'a', 'w'], ['D', ['f', 'y'], 'y']], ['D', 'w', 'x']]);
check('d/dx stops at + and -', scopeDerivatives('\\frac{d}{dx}x^2y+\\frac{\\partial}{\\partial y}\\frac{x}{y}-1') === '\\frac{d}{dx}\\left(x^2y\\right)+\\frac{\\partial}{\\partial y}\\left(\\frac{x}{y}\\right)-1',
  scopeDerivatives('\\frac{d}{dx}x^2y+\\frac{\\partial}{\\partial y}\\frac{x}{y}-1'));
is('x\\left(\\frac{1}{c}-\\frac{b}{c^2}\\right)-\\frac{x}{c}', ['Add', ['Multiply', 'x', ['Add', ['Divide', ['Negate', 'b'], ['Power', 'c', 2]], ['Divide', 1, 'c']]], ['Divide', ['Negate', 'x'], 'c']]);
check('\\cdot only before a bracket that is not a function\'s', explicitProducts('ax(b+c)+f(x+1)+u(x)+w(0,y)+\\xi\\left(1+t\\right)+\\sin(x+1)') === 'ax\\cdot (b+c)+f(x+1)+u(x)+w(0,y)+\\xi\\cdot \\left(1+t\\right)+\\sin(x+1)', explicitProducts('ax(b+c)+f(x+1)+u(x)+w(0,y)+\\xi\\left(1+t\\right)+\\sin(x+1)'));
check('\\log is ln, \\log_b keeps its base', naturalLog('\\log x+\\log_{2}y+\\log _{10}z+\\log^2(t)') === '\\ln x+\\log_{2}y+\\log _{10}z+\\ln^2(t)', naturalLog('\\log x+\\log_{2}y'));
// the ODE operations read y' themselves
is("y''+y=0", ['Equal', ['Add', 'y', ['Prime', 'y', 2]], 0], [], { derivatives: false });

// 5.x matrices and vectors (vectorTeX): \left[ array \right] a matrix, \times and \cdot between
// vectors the cross and dot product, ∇
const readV = (tex, vectors = []) => JSON.stringify(normalize(ce.parse(explicitProducts(scopeDerivatives(vectorTeX(tex, vectors.length > 0)))).json, new Set(), { vectors: new Set(vectors) }));
const isV = (tex, want, vectors) => { const got = readV(tex, vectors); check(tex, got === JSON.stringify(want), got); };
isV('x\\left[ \\begin{array}{cc} 1 & 2\\end{array}\\right]', ['Multiply', 'x', ['Matrix', ['List', ['List', 1, 2]], "'[]'"]]);
isV('\\left\\vert \\begin{array}{cc} a & b \\\\ c & d\\end{array}\\right\\vert', ['Determinant', ['Matrix', ['List', ['List', 'a', 'b'], ['List', 'c', 'd']]]]);
isV('(1,0,0)\\times (0,1,0)\\cdot (1,1,1)', ['Dot', ['Cross', ['Tuple', 1, 0, 0], ['Tuple', 0, 1, 0]], ['Tuple', 1, 1, 1]]);
isV('(a\\cdot b,1)', ['Tuple', ['Multiply', 'a', 'b'], 1]);
isV('u\\times v', ['Cross', 'u', 'v'], ['u']);
isV('\\nabla \\cdot F+\\nabla ^{2}f', ['Add', ['Divergence', 'F'], ['Laplacian', 'f']]);
isV('\\frac{d}{dx}\\left[ \\begin{array}{cc} x & 1\\end{array}\\right]', ['D', ['Matrix', ['List', ['List', 'x', 1]], "'[]'"], 'x']);
// 5.5's notation (notation55)
const n55 = (tex, want) => { const got = JSON.stringify(normalize(ce.parse(notation55(tex)).json)); check(tex, got === JSON.stringify(want), got); };
n55('\\displaystyle\\sum\\limits_{k=1}^{3}k\\vspace{6pt}', ['Sum', 'k', ['Limits', 'k', 1, 3]]);
n55('x^{2}+3\\operatorname{mod}5=1', ['Equal', ['Modulo', ['Add', ['Power', 'x', 2], 3], 5], 1]);
n55('\\left( a\\operatorname{mod}b\\right) \\operatorname{mod}c', ['Modulo', ['Modulo', 'a', 'b'], 'c']);
n55('\\left[ x^{2}\\right] _{x=1}^{x=2}', ['EvaluateAt', ['Function', ['Block', ['Power', 'x', 2]], 'x'], 1, ['Equal', 'x', 2]]);
n55('\\left. y\\right\\vert _{y=3}', ['EvaluateAt', ['Function', ['Block', 'y'], 'y'], 3]);
n55('J_{2}\\left( x\\right) +K_{\\nu }(t)', ['Add', ['BesselK', 'nu', 't'], ['BesselJ', 2, 'x']]);
n55('D_{x^{2}y}\\left( u\\right)', ['D', 'u', 'x', 'x', 'y']);
n55('\\mathcal{L}^{-1}\\left( F\\right)', ['InverseLaplaceTransform', 'F', 's', 't']);
n55('3\\,\\mathrm{ft}+\\int x\\,\\mathrm{d}x', ['Add', ['Multiply', 3, 'unit_ft'], ['Integrate', 'x', ['Limits', 'x', 'Nothing', 'Nothing']]]);
n55('A^{\\mathrm{T}}', ['Power', 'A', 'T']);
n55('9\\vee 4', ['Max', 9, 4]);
n55('g\\left( i\\right) =i\\ast 10^{-2}', ['Equal', ['g', ['Complex', 0, 1]], ['Multiply', ['Complex', 0, 1], ['Power', 10, -2]]]);
n55('z_{x}=\\left[ D_{x}z\\left( x,y\\right) \\right] _{x=1,y=2}', ['Equal', 'z_x', ['EvaluateAt', ['Function', ['Block', ['D', ['z', 'x', 'y'], 'x']], 'x', 'y'], ['Tuple', 1, 2]]]);
n55('\\operatorname{AiryAi}\\left( x,1\\right)', ['AiryAi', 'x', 1]);
n55('\\mathcal{L}\\left( \\operatorname{Heaviside}(t\\right)', ['LaplaceTransform', ['Heaviside', 't'], 't', 's']);
// in a definition of g(i), i is g's variable (elsewhere the imaginary unit)
check('g(i) = 0.1i: i is the variable', JSON.stringify(normalize(ce.parse(definitionOfI('g(i)=0.1i+\\sin i')).json)) === JSON.stringify(['Equal', ['g', 'i'], ['Add', ['Multiply', 0.1, 'i'], ['Sin', 'i']]]),
  JSON.stringify(normalize(ce.parse(definitionOfI('g(i)=0.1i+\\sin i')).json)));
is('\\dfrac{d}{dx}x^{2}+3x', ['Add', ['Multiply', 3, 'x'], ['D', ['Power', 'x', 2], 'x']]);
// b_i = 2i+1 with the subscript a function argument (Interpret Subscript): i is the argument, a name
const sub = JSON.stringify(normalize(ce.parse(definitionOfI('b_{i}=2i+1', true)).json));
check('b_i = 2i+1 as an argument: i a name', sub === JSON.stringify(['Equal', 'b_i', ['Add', ['Multiply', 2, 'i'], 1]]), sub);
check('b_i = 2i+1 as a name: i the imaginary unit', definitionOfI('b_{i}=2i+1') === 'b_{i}=2i+1', definitionOfI('b_{i}=2i+1'));
// the Compute settings: \log in base 10, other basis variables after a gradient
const set = JSON.stringify(withSettings(['Add', ['Log', 'x'], ['Log', 'x', 2], ['Gradient', ['Multiply', 'p', 'q']]], { logBase10: true, basis: ['p', 'q', 'r'] }));
check('settings: log base 10, basis p, q, r', set === JSON.stringify(['Add', ['Log10', 'x'], ['Log', 'x', 2], ['Gradient', ['Multiply', 'p', 'q'], 'p', 'q', 'r']]), set);
check('settings: the defaults change nothing', JSON.stringify(withSettings(['Gradient', ['Log', 'x']])) === JSON.stringify(['Gradient', ['Log', 'x']]));
// Solve ODE > Numeric: a column of equations and initial values
const rows = odeRows("\\begin{array}{r} u^{\\prime }=v \\\\ v'=-u \\\\ u(0)=0 \\\\ v\\left( 0\\right) =1\\end{array}");
check('ODE rows', JSON.stringify(rows) === JSON.stringify({ equations: ['u^{\\prime }=v', "v'=-u"], inits: [['u', '0', '0', 0], ['v', '0', '1', 0]] }), JSON.stringify(rows));
// higher order: y'(0) and y^{\prime\prime}(1) are initial values (no letter in the point), y'(x) = .. an equation
const rows2 = odeRows("\\begin{array}{r} y^{\\prime \\prime \\prime }=-y \\\\ y'(x)=2 \\\\ y(0)=1 \\\\ y'(0)=0 \\\\ y^{\\prime \\prime }\\left( \\pi \\right) =2\\end{array}");
check('ODE rows: initial values of derivatives', JSON.stringify(rows2) === JSON.stringify({ equations: ['y^{\\prime \\prime \\prime }=-y', "y'(x)=2"], inits: [['y', '0', '1', 0], ['y', '0', '0', 1], ['y', '\\pi', '2', 2]] }), JSON.stringify(rows2));

process.exit(fails ? 1 : 0);
