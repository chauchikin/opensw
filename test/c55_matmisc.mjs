// Compute > Matrices, the items of part "matmisc" (5.5's help, Doing Mathematics ch. 8): from the menu,
// with the dialogs 5.5 has (Reshape, Fill Matrix, Random Matrix), the answers written as 5.5 writes them.
// Run: node test/c55_matmisc.mjs  (needs `npx vite preview --port 4173`, or OPENSW_PORT; SymPy in the page)
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
const doc = async () => String((await call('get', {})).result ?? '');
const waitFor = async (pred, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred(await doc())) return true; await page.waitForTimeout(300); } return false; };

// items without a dialog: the label and the answer after the formula
await call('set', { latex: 'A $\\left(\\begin{array}{cc}1 & 2\\\\3 & 4\\end{array}\\right)\\left(\\begin{array}{cc}5 & 6\\\\7 & 8\\end{array}\\right)$ B $\\left(\\begin{array}{cc}2 & 3\\\\5 & 7\\end{array}\\right)$ C' });
await enter(0);
await menu('Compute', 'Matrices', 'Concatenate');
check('Concatenate: ", concatenate:" and the matrix', await waitFor((t) => t.includes('concatenate:') && flat(t).includes('1&2&5&6')), await doc());
await enter(2);
await menu('Compute', 'Matrices', 'Norm');
check('Norm: ", 2-norm: 9.3268"', await waitFor((t) => t.includes('2-norm:') && t.includes('9.3268')), await doc());

// Reshape asks the number of columns
await call('set', { latex: 'List $45,21,8,19,0,5,15,6$.' });
await enter(0);
await menu('Compute', 'Matrices', 'Reshape...');
check('Reshape asks the columns', await page.isVisible('#dialog #d-n'));
await page.fill('#d-n', '3');
await page.click('#dialog-ok');
check('Reshape: " to 3 columns: " and 3 rows', await waitFor((t) => t.includes('to 3 columns:') && flat(t).includes('45&21&8\\\\19&0&5\\\\15&6&')), await doc());

// Fill Matrix: a Jordan block in the brackets the insertion point is in
await call('set', { latex: 'M $\\left(\\right)$ end' });
await page.evaluate(() => { const mv = document.querySelectorAll('.math-inline')[0]._mathView; mv.enter(true); mv.mf.executeCommand('moveToNextChar'); });
await menu('Compute', 'Matrices', 'Fill Matrix...');
check('Fill Matrix: the item box is off for Zero', await page.isDisabled('#d-item'));
await page.check('input[name=d-fill][value=jordan]');
check('... and on for Jordan block', await page.isEnabled('#d-item'));
await page.fill('#d-r', '2'); await page.fill('#d-c', '2'); await page.fill('#d-item', 'x');
await page.click('#dialog-ok');
check('Fill Matrix, Jordan block: x 1 / 0 x inside the brackets', await waitFor((t) => /\\left\(\s*\\begin\{(?:matrix|array)\}(?:\{cc\})?\s*x\s*&\s*1\s*\\\\\s*0\s*&\s*x/.test(t)), await doc());

// Random Matrix: antisymmetric, from 1 to 1 (so the answer is known); in text: a new formula
await call('set', { latex: 'Text only.' });
await page.evaluate(() => document.querySelector('.ProseMirror').focus());
await menu('Compute', 'Matrices', 'Random Matrix...');
await page.fill('#d-r', '2'); await page.fill('#d-c', '2'); await page.fill('#d-min', '1'); await page.fill('#d-max', '1');
await page.check('input[name=d-type][value=antisymmetric]');
await page.click('#dialog-ok');
check('Random Matrix, antisymmetric: 0 1 / -1 0 in a new formula', await waitFor((t) => /0\s*&\s*1\s*\\\\\s*-1\s*&\s*0/.test(t)), await doc());

check('no page errors', !errs.length, errs);
await b.close();
process.exit(fails ? 1 : 0);
