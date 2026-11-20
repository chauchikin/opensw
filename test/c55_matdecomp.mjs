// Compute > Matrices, the decompositions and normal forms (5.5's answers, from its help dm8-3,
// dm8-6, dm8-7, dm8-8), from the menu and by the AI's compute.
// Run: node test/c55_matdecomp.mjs  (needs `npx vite preview --port 4173` or OPENSW_PORT; SymPy in the page)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(600);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 260)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const flat = (s) => (s || '').replace(/\s|\\left|\\right/g, '');
const menu = async (...items) => {
  await page.click(`.menu-top:has-text("${items[0]}")`);
  for (const it of items.slice(1)) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const text = () => page.evaluate(() => document.querySelector('.ProseMirror').innerText);
const mathAfter = () => page.evaluate(() => [...document.querySelectorAll('.math-inline')].map((m) => m._mathView?.latex ?? m.getAttribute('data-latex')));
const enter = (i) => page.evaluate((k) => document.querySelectorAll('.math-inline')[k]._mathView.enter(false), i);

// from the menu: an answer after the matrix with 5.5's words
await call('set', { latex: 'A $\\begin{pmatrix}8&2&3\\\\2&-5&8\\end{pmatrix}$ end' });
await enter(0);
await menu('Compute', 'Matrices', 'Fraction-Free Gaussian Elimination');
await page.waitForFunction(() => document.querySelector('.ProseMirror').innerText.includes('fraction-free'), null, { timeout: 60000 });
let m = await mathAfter();
check('Fraction-Free Gaussian Elimination: ", fraction-free Gaussian elimination:" and the matrix', (await text()).includes(', fraction-free Gaussian elimination: ') && flat(m[1]).includes('0&-44&58'), m);

// a factorization: A = P L U inside the formula
await call('set', { latex: 'A $\\begin{pmatrix}1&2&3\\\\2&4&6\\\\3&2&1\\end{pmatrix}$ end' });
await enter(0);
await menu('Compute', 'Matrices', 'PLU Decomposition');
await page.waitForFunction(() => [...document.querySelectorAll('.math-inline')].some((x) => (x._mathView?.latex || '').includes('=')), null, { timeout: 60000 });
m = await mathAfter();
check('PLU Decomposition: A = P L U', flat(m[0]).includes('=\\begin{pmatrix}1&0&0\\\\0&0&1\\\\0&1&0\\end{pmatrix}') || flat(m[0]).replace(/matrix}/g, 'pmatrix}').includes('0&0&1\\\\0&1&0'), m);

// Minimum Polynomial asks for the variable when the matrix has X in it, as 5.5
await call('set', { latex: 'A $\\begin{pmatrix}3X&x\\\\5&y\\end{pmatrix}$ end' });
await enter(0);
await menu('Compute', 'Matrices', 'Minimum Polynomial');
await page.waitForSelector('#dialog #d-v', { timeout: 10000 }).catch(() => {});
check('Minimum Polynomial with X: asks for the polynomial variable', await page.isVisible('#dialog #d-v'));
if (await page.isVisible('#dialog #d-v')) {
  await page.click('#dialog-ok');
  await page.waitForFunction(() => document.querySelector('.ProseMirror').innerText.includes('minimum polynomial'), null, { timeout: 60000 }).catch(() => {});
  m = await mathAfter();
  check('… and answers in \\lambda', flat(m[1]).includes('\\lambda^{2}') || flat(m[1]).includes('\\lambda^2'), m);
}
// without X no dialog
await call('set', { latex: 'A $\\begin{pmatrix}4&1&0\\\\0&4&0\\\\0&0&4\\end{pmatrix}$ end' });
await enter(0);
await menu('Compute', 'Matrices', 'Minimum Polynomial');
await page.waitForFunction(() => document.querySelector('.ProseMirror').innerText.includes('minimum polynomial'), null, { timeout: 60000 }).catch(() => {});
m = await mathAfter();
check('Minimum Polynomial: X^2 - 8X + 16', flat(m[1]).includes('X^{2}-8X+16'), m);

// every op of the part by the AI's compute
const cases = [
  ['gauss', '\\begin{pmatrix}8&2&3\\\\2&-5&8\\end{pmatrix}', '-\\frac{11}{2}'],
  ['qr', '\\begin{pmatrix}3&0\\\\4&5\\end{pmatrix}', '\\frac{3}{5}'],
  ['cholesky', '\\begin{pmatrix}4&2\\\\2&2\\end{pmatrix}', '2&0\\\\1&1'],
  ['svd', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', '5.4650'],
  ['singularvalues', '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', '5.4650,0.36597'],
  ['jordan', '\\begin{pmatrix}1&2\\\\-1&-1\\end{pmatrix}', '-i&0\\\\0&i'],
  ['hermite', '\\begin{pmatrix}7&34&46\\\\4&20&27\\end{pmatrix}', '1&2&3\\\\0&4&5'],
  ['smith', '\\begin{pmatrix}2&9&5\\\\3&4&3\\\\4&1&-1\\end{pmatrix}', '0&0&56'],
  ['rationalcanonical', '\\begin{pmatrix}1&2&3\\\\4&5&6\\\\7&8&9\\end{pmatrix}', '1&0&18\\\\0&1&15'],
  ['eigenvectors', '\\begin{pmatrix}5&-6&-6\\\\-1&4&2\\\\3&-6&-4\\end{pmatrix}', '\\leftrightarrow2'],
];
for (const [op, latex, want] of cases) {
  const r = await call('compute', { latex, op });
  const got = r.ok ? (r.result.latex ?? (r.result.solutions || []).join(';')) : r.error;
  check(`${op}`, r.ok && flat(got).includes(flat(want)), got);
}
check('no page errors', errs.length === 0, errs);
await b.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
