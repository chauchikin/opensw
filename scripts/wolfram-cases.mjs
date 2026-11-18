// Builds test/fixtures/wolfram/cases.json for test/wolfram.wls: each case is a formula as
// LaTeX turned into the same MathJSON payload src/compute.js sends to an engine.
// Run: node scripts/wolfram-cases.mjs   (then, where Mathematica is: wolframscript -file test/wolfram.wls)
import { writeFileSync } from 'node:fs';
import { ComputeEngine } from '@cortex-js/compute-engine';
import { standardTeX } from '../src/tex55.js';

const ce = new ComputeEngine();
const mj = (latex) => ce.parse(standardTeX(latex)).json;
// [op, LaTeX, params or null, the answer's LaTeX (spaces removed) must contain this]
const CASES = [
  ['evaluate', '\\int_0^1 x^2\\,dx', null, '\\frac{1}{3}'],
  ['evaluate', '\\sum_{k=1}^{10} k', null, '55'],
  ['evaluate', '\\frac{d}{dx}\\sin x', null, '\\cos(x)'],
  ['evaluate', '\\lim_{x\\to0}\\frac{\\sin x}{x}', null, '1'],
  ['numeric', '\\sqrt{2}', null, '1.414213562'],
  ['simplify', '\\sin^2 x+\\cos^2 x', null, '1'],
  ['expand', '(x+1)^3', null, 'x^3+3x^2+3x+1'],
  ['factor', 'x^2+2x+1', null, '(x+1)^2'],
  ['factor', '360', null, '2^{3}\\cdot3^{2}\\cdot5'],
  ['solve', 'x^2-3x+2=0', null, 'x=1'],
  ['check', '(x+1)^2=x^2+2x+1', null, true],
  ['check', 'x+1=x', null, false],
  ['determinant', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', null, '-2'],
  ['inverse', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', null, '\\begin{pmatrix}-2&1\\\\\\frac{3}{2}&-\\frac{1}{2}\\end{pmatrix}'],
  ['eigenvalues', '\\begin{pmatrix}2&0\\\\0&3\\end{pmatrix}', null, '\\left\\{3,2\\right\\}'],
  ['rank', '\\begin{pmatrix}1&2\\\\2&4\\end{pmatrix}', null, '1'],
  ['charpoly', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', null, 'X^2-5X-2'],
  ['partialfractions', '\\frac{1}{x^2-1}', null, '\\frac{1}{2(x-1)}'],
  ['series', 'e^x', null, 'O'],
  ['differentiate', 'x^3', null, '3x^2'],
  ['integrate', '\\frac{1}{1+x^2}', null, '\\tan^{-1}(x)'],
  ['laplace', 't^2', null, '\\frac{2}{s^3}'],
  ['ode', "y''+y=0", null, 'c_1\\cos(x)'],
  ['extrema', 'x^2-2x', null, 'x=1'],
  ['numericsolve', 'x^2-2=0', null, '1.414213562'],
  ['mean', '\\begin{pmatrix}1&2&3&4\\end{pmatrix}', null, '\\frac{5}{2}'],
  ['gradient', 'x^2y', ['x', 'y'], '\\begin{pmatrix}2xy\\\\x^2\\end{pmatrix}'],
  ['curl', '\\begin{pmatrix}-y\\\\x\\\\0\\end{pmatrix}', ['x', 'y', 'z'], '2'],
  ['define', 'a=3', null, 'a=3'],
  ['evaluate', 'a^2+1', null, '10'],
  ['define', 'f(x)=x^2+1', null, 'f(x)=x^2+1'],
  ['evaluate', 'f(2)', null, '5'],
  ['cleardefs', '0', null, null],
  ['evaluate', 'a+1', null, 'a+1'],
  ['solve', '\\alpha^2=4', null, '\\alpha=2'],
  ['evaluate', 'N+D', null, 'D+N'],
  ['byparts', '\\int x e^x dx', ['x'], '-\\inte^x'],
  ['showdefs', '0', null, null],
  ['check', 'x+1', null, 'error:要有等號'],
  ['integersolve', '3x+5y=1', null, 'x=2+5c_1'],
  ['minimize', '\\begin{pmatrix}x+y\\\\x+2y\\geq 2\\\\3x+y\\geq 3\\end{pmatrix}', null, '\\text{最小值}=\\frac{7}{5}'],
  ['standardize', '\\begin{pmatrix}3x+2y\\\\x+y\\leq 4\\\\x+3y\\geq 6\\end{pmatrix}', null, '\\leq-6'],
  ['vectorpotential', '\\begin{pmatrix}0\\\\0\\\\1\\end{pmatrix}', ['x', 'y', 'z'], '\\begin{pmatrix}-y\\\\0\\\\0\\end{pmatrix}'],
  ['changevar', '\\int_0^1 \\sqrt{1-x^2}\\,dx', ['x=\\sin u'], '\\int_0^{\\frac{\\pi}{2}}'],
  ['combine', '\\ln x+\\ln y', null, '\\log(xy)'],
  ['rewrite_exp', '\\sin x', null, 'e^{-ix}'],
  ['inverselaplace', '\\frac{1}{s^2}', null, 't'],
  ['fourier', 'e^{-x^2}', null, '\\sqrt{\\pi}'],
  ['nullspace', '\\begin{pmatrix}1&2\\\\2&4\\end{pmatrix}', null, '\\begin{pmatrix}-2\\\\1\\end{pmatrix}'],
  ['hessian', 'x^2y', ['x', 'y'], '\\begin{pmatrix}2y&2x\\\\2x&0\\end{pmatrix}'],
  ['approxint', '\\int_0^1 x^2\\,dx', ["'trapezoid'", '4'], '0.34375'],
  ['iterate', '\\cos x', ['0', '2'], '\\cos(1)'],
];
const out = CASES.map(([op, latex, params, expect]) => {
  const expr = mj(latex);
  const payload = params ? { expr, params: params.map((p) => (p.startsWith("'") ? p : mj(p))) } : expr;
  return { op, latex, json: JSON.stringify(payload), expect };
});
writeFileSync(new URL('../test/fixtures/wolfram/cases.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out.length, 'cases');
