// The Compute menu (SymPy in Pyodide). Run: node test/compute.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/'); await page.waitForTimeout(600);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 160)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
let t = Date.now();
let r = await call('compute', { latex: '\\int_0^1 x^2\\,dx' });
check(`first compute (engine load ${((Date.now() - t) / 1000).toFixed(1)}s)`, r.ok && r.result.latex === '\\frac{1}{3}', r);
t = Date.now();
r = await call('compute', { latex: 'x^2+2x+1', op: 'factor' });
check(`factor (${Date.now() - t}ms)`, r.ok && r.result.latex.includes('x + 1'), r);
r = await call('compute', { latex: 'x^2-3x+2=0', op: 'solve' });
check('solve', r.ok && r.result.solutions.join(';') === 'x=1;x=2', r);
r = await call('compute', { latex: '\\frac{d}{dx}\\sin x' });
check('derivative', r.ok && r.result.latex.includes('\\cos'), r);
r = await call('compute', { latex: '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', op: 'determinant' });
check('determinant', r.ok && r.result.latex === '-2', r);
// through the editor: cursor in a formula, Ctrl+E appends "= result"
await call('set', { latex: 'Let $\\sum_{k=1}^{10} k$ and $x^2-1=0$.' });
await page.evaluate(() => document.querySelectorAll('.math-inline')[0]._mathView.enter(false));
t = Date.now();
await page.keyboard.press('Control+e');
await page.waitForFunction(() => window.swEditor.state.doc.textContent !== null && JSON.stringify(window.swEditor.state.doc.toJSON()).includes('55'), null, { timeout: 30000 });
r = await call('formulas');
check(`Ctrl+E in a formula (${Date.now() - t}ms)`, r.result[0].latex.replace(/\s/g, '') === '\\sum_{k=1}^{10}k=55', r.result[0]);
await page.evaluate(() => document.querySelectorAll('.math-inline')[1]._mathView.enter(false));
await page.click('#toolbar .tb[title="解方程（精確）"]');
await page.waitForFunction(() => window.swEditor.state.doc.textContent.includes('解為'), null, { timeout: 30000 });
r = await call('formulas');
check('Solve from the toolbar', r.result.length === 4 && r.result[2].latex === 'x=-1' && r.result[3].latex === 'x=1', r.result);
// the rest of 5.5's Compute menu
const cases = [
  ['partialfractions', '\\frac{1}{(x+1)(x+2)}', (x) => x.latex.replace(/\s/g, '') === '-\\frac{1}{x+2}+\\frac{1}{x+1}'],
  ['series', '\\sin x', (x) => x.latex.includes('O\\left(x^{6}\\right)')],
  ['extrema', 'x^3-3x', (x) => x.solutions.join(';') === 'x=-1, f=2;x=1, f=-2'],
  ['numericsolve', '\\cos x=x', (x) => x.solutions[0] === 'x=0.7390851332'],
  ['ode', "y''+y=0", (x) => /C_\{1\} \\sin/.test(x.solutions[0])],
  ['laplace', '\\sin t', (x) => x.latex.replace(/\s/g, '') === '\\frac{1}{s^{2}+1}'],
  ['rank', '\\begin{pmatrix}1&2\\\\2&4\\end{pmatrix}', (x) => x.latex === '1'],
  ['charpoly', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', (x) => x.latex.replace(/\s/g, '') === 'X^{2}-5X-2'],
  ['combine', '\\sin^2 x+\\cos^2 x', (x) => x.latex === '1'],
  ['mean', '\\begin{pmatrix}1&2&3&4\\end{pmatrix}', (x) => x.latex === '\\frac{5}{2}'],
  ['stddev', '\\begin{pmatrix}1&2&3&4\\end{pmatrix}', (x) => x.latex === '\\frac{\\sqrt{15}}{3}'],
  ['implicitdiff', 'x^2+y^2=1', (x) => x.latex.replace(/\s/g, '') === '-\\frac{x}{y}'],
];
for (const [op, latex, ok] of cases) {
  r = await call('compute', { latex, op });
  check(op, r.ok && !r.result.error && ok(r.result), r);
}
r = await call('compute', { latex: '\\foo', op: 'evaluate' });
check('bad input is an error', !r.ok || r.result.error, r);
console.log('page errors', errs);
console.log(fails ? `${fails} FAILED` : 'all passed');
await b.close();
process.exit(fails ? 1 : 0);
