// Compute > Rewrite and Compute > Combine as in 5.5: every item from the menu, and the variables
// asked for Equations as Matrix / Matrix as Equations. Run: node test/c55_rewrite.mjs
// (needs `npx vite preview --port 4173`, or OPENSW_PORT; SymPy in the page)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(600);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 220)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const flat = (s) => s.replace(/\s|\\left|\\right/g, '');
const menu = async (...items) => {
  await page.click(`.menu-top:has-text("${items[0]}")`);
  for (const it of items.slice(1)) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const enter = (i) => page.evaluate((k) => document.querySelectorAll('.math-inline')[k]._mathView.enter(false), i);
const doc = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()));
const waitFor = (text) => page.waitForFunction((t) => JSON.stringify(window.swEditor.state.doc.toJSON()).includes(t), text, { timeout: 30000 }).catch(() => {});

// each item from the menu: [submenu, item, formula, a piece of the answer]
const ITEMS = [
  ['Rewrite', 'Rational', '0.125', '\\\\frac{1}{8}'],
  ['Rewrite', 'Float', '\\frac{1}{8}', '0.125'],
  ['Rewrite', 'Factorial', '\\Gamma(x)', '\\\\left(x - 1\\\\right)!'],
  ['Rewrite', 'Gamma', 'x!', '\\\\Gamma\\\\left(x + 1\\\\right)'],
  ['Rewrite', 'Logarithm', '\\operatorname{arcsinh}x', '\\\\ln'],
  ['Rewrite', 'Sinh and Cosh', '\\tanh x', '\\\\frac{\\\\sinh x}{\\\\cosh x}'],
  ['Rewrite', 'Sin', '\\cos x', '1 - 2 \\\\sin^{2}'],
  ['Rewrite', 'Cos', '\\sin x', '\\\\cos^{2}'],
  ['Rewrite', 'Tan', '\\sin x', '\\\\tan'],
  ['Rewrite', 'Arcsin', '\\arccos x', '\\\\arcsin x'],
  ['Rewrite', 'Arccos', '\\arcsin x', '\\\\arccos x'],
  ['Rewrite', 'Arctan', '\\operatorname{arccot}x', '\\\\arctan x'],
  ['Rewrite', 'Arccot', '\\arctan x', 'arccot'],
  ['Rewrite', 'Polar', '3+5i', '\\\\sqrt{34} e^{i \\\\arctan'],
  ['Rewrite', 'Rectangular', '\\frac{6+7i}{4-3i}', '\\\\frac{46}{25} i'],
  ['Rewrite', 'Normal Form', '\\frac{1}{x}+\\frac{1}{y}', '\\\\frac{x + y}{x y}'],
  ['Rewrite', 'Exponential', '\\sinh x', 'e^{- x}'],
  ['Rewrite', 'Sin and Cos', '\\tan x', '\\\\frac{\\\\sin x}{\\\\cos x}'],
  ['Combine', 'Exponentials', 'e^xe^y', 'e^{x + y}'],
  ['Combine', 'Logs', '\\ln x+\\ln y', '\\\\ln x + \\\\ln y'],
  ['Combine', 'Powers', 'a^xa^y', 'a^{x + y}'],
  ['Combine', 'Trig Functions', '\\sin^2x', '\\\\cos 2 x'],
  ['Combine', 'Arctan', '\\arctan x-\\arctan y', '\\\\arctan'],
  ['Combine', 'Hyperbolic Trig Functions', '\\cosh x\\cosh y', '\\\\cosh\\\\left(x + y\\\\right)'],
];
// mathlive keeps \frac18 for \frac{1}{8}: compared without spaces, braces, \left, \right
const norm = (s) => s.replace(/\\\\/g, '\\').replace(/\s|\\left|\\right|[{}]/g, '');
const latexOf = async (i) => (await call('formulas')).result[i]?.latex || '';
await call('set', { latex: ITEMS.map(([, , f]) => `$${f}$`).join(' and ') + '.' });
for (let i = 0; i < ITEMS.length; i++) {
  const [sub, item, f, want] = ITEMS[i];
  await enter(i);
  await menu('Compute', sub, item);
  for (let k = 0; k < 40 && !(await latexOf(i)).includes('='); k++) await page.waitForTimeout(500);
  const got = await latexOf(i);
  check(`${sub} > ${item}: ${f}`, norm(got).includes(norm(want)), got);
}

// the two that ask the variables, as 5.5 (computeVariables.xul)
await call('set', { latex: 'A system $\\begin{bmatrix}x+2y=3\\\\3x-5y=0\\end{bmatrix}$ and a matrix $\\begin{pmatrix}1&1&-1\\\\2&-3&1\\end{pmatrix}$.' });
await enter(0);
await menu('Compute', 'Rewrite', 'Equations as Matrix');
check('Equations as Matrix asks the variables', await page.isVisible('#dialog #d-vars'));
check('... guessing x, y', (await page.inputValue('#d-vars')) === 'x, y', await page.inputValue('#d-vars'));
await page.click('#dialog-ok');
await waitFor('Corresponding matrix');
let d = await doc();
check('... and gives the augmented matrix', d.includes('Corresponding matrix') && d.includes('1 & 2 & 3'), d.slice(-400));
let n = (await call('formulas')).result.length;
await enter(n - 1);
await menu('Compute', 'Rewrite', 'Matrix as Equations');
check('Matrix as Equations asks the variables', await page.isVisible('#dialog #d-vars'));
check('... guessing x, y for 3 columns', (await page.inputValue('#d-vars')) === 'x, y', await page.inputValue('#d-vars'));
await page.click('#dialog-ok');
await waitFor('Corresponding equations');
d = await doc();
check('... and gives the equations', d.includes('Corresponding equations') && flat(d).includes('2x-3y=1'), d.slice(-300));

// through the AI interface too
let r = await call('compute', { latex: '\\left\\{x+2y-3,3x-5y\\right\\}', op: 'eqs_to_matrix', params: ['x', 'y'] });
check('AI: eqs_to_matrix with params', r.ok && r.result.solutions?.[0]?.includes('3 & -5 & 0'), r);
r = await call('compute', { latex: '\\begin{pmatrix}\\sin^2x+\\cos^2x&\\sin x\\cos y+\\sin y\\cos x\\end{pmatrix}', op: 'combine_trig' });
check('AI: Combine > Trig Functions entry by entry', r.ok && flat(r.result.latex).includes('1&\\sin(x+y)'), r);

check('no page errors', !errs.length, errs);
await b.close();
process.exit(fails ? 1 : 0);
