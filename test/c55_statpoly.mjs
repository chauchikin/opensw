// Compute > Statistics and Polynomials as in 5.5: the answers after 5.5's labels, and the dialogs
// 5.5 asks in (Fit Curve to Data, Random Numbers, Moment, Quantile, Collect, the polynomial variable).
// Run: node test/c55_statpoly.mjs  (needs `npx vite preview --port 4173`, or OPENSW_PORT; SymPy in the page)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1600, height: 1300 } }); // the Compute menu is long (5.5's)
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(600);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 220)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const flat = (s) => s.replace(/\s|\\left|\\right/g, '');
const compute = async (latex, op, params) => { const r = await call('compute', { latex, op, params }); return r.ok ? r.result : { error: r.error }; };

// the engine, as an AI asks it
let r = await compute('\\begin{bmatrix}23&5&-6\\\\18&23&-22\\\\5&0&0\\end{bmatrix}', 'mean');
check('Mean of a matrix: one per column, after "Mean(s)"', r.label === ', Mean(s): ' && flat(r.solutions[0]) === '[\\frac{46}{3},\\frac{28}{3},-\\frac{28}{3}]', r);
r = await compute('1,2,3,4', 'median');
check('Median: of two middle numbers the smaller (MuPAD)', r.solutions?.[0] === '2', r);
r = await compute('23,5,-6,18,23,-22,5', 'mode');
check('Mode: [modes], how often', flat(r.solutions[0]) === '[23,5],2', r);

// the document: the dialogs and what goes after the formula
await call('set', { latex: 'A $1,2,3,4,5,6,7,8,9,10$ B $\\begin{bmatrix}y&x\\\\0&1.1\\\\0.5&1.5\\\\1&1.9\\\\1.5&2.4\\\\2&2.9\\end{bmatrix}$ C $0.1,0.5,0.8,0.4$ D $5t^{2}+2t-16t^{5}+t^{3}-2t^{2}+9+at^{2}$ E $\\frac{5x^2y^3+3x-2y}{4x+y}$ F $x^4+3x^2-2x+1$ G ' });
// into the formula whose LaTeX has this in it (the answers make new formulas, so not by number)
const enter = (t) => page.evaluate((s) => [...document.querySelectorAll('.math-inline')].find((m) => m._mathView.latex.includes(s))._mathView.enter(false), t);
const menu = async (...items) => {
  await page.click(`.menu-top:has-text("${items[0]}")`);
  for (const it of items.slice(1)) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const text = () => page.evaluate(() => window.swEditor.state.doc.textContent);
const docJson = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()));
const waitFor = (s) => page.waitForFunction((t) => JSON.stringify(window.swEditor.state.doc.toJSON()).includes(t), s, { timeout: 30000 }).catch(() => {});

await enter('9,10');
await menu('Compute', 'Statistics', 'Quantile...');
check('Quantile asks q', await page.isVisible('#dialog #d-q'));
await page.fill('#d-q', '0.87');
await page.click('#dialog-ok');
await waitFor('Quantile');
check('... and writes ", 0.87th Quantile(s): 9"', (await text()).includes('0.87th Quantile(s): '), await text());

await enter('0.5&1.5');
await menu('Compute', 'Statistics', 'Fit Curve to Data...');
check('Fit Curve to Data asks the column and the kind of fit', await page.isVisible('#dialog input[name="d-col"]') && await page.isVisible('#dialog input[name="d-kind"]'));
await page.check('#dialog input[name="d-col"][value="first"]');
await page.click('#dialog-ok');
await waitFor('1.1073');
check('... and gives y = 1.1073x - 1.1703 after "Regression is"', (await text()).includes('Regression is: ') && (await docJson()).includes('1.1073'), await text());

await enter('0.1,0.5');
await menu('Compute', 'Statistics', 'Moment...');
check('Moment asks the number and the origin', await page.isVisible('#dialog #d-r') && await page.isVisible('#dialog input[name="d-o"]'));
await page.fill('#d-r', '2');
await page.check('#dialog input[name="d-o"][value="about"]');
await page.fill('#d-a', '0');
await page.click('#dialog-ok');
await waitFor('0.265');
check('... and gives 0.265 after "Moment(s)"', (await text()).includes('Moment(s): ') && (await docJson()).includes('0.265'), await text());

await enter('16t');
await menu('Compute', 'Polynomials', 'Collect...');
check('Collect asks the variables', await page.isVisible('#dialog #d-v'));
await page.fill('#d-v', 't');
await page.click('#dialog-ok');
await waitFor('a+3');
check('... and collects in t', /a\s*\+\s*3/.test(await docJson()), (await call('formulas')).result.map((x) => x.latex));

await enter('4x+y');
await menu('Compute', 'Polynomials', 'Divide');
await page.waitForSelector('#dialog:not([hidden]) #d-v', { timeout: 30000 }).catch(() => {});
check('Divide with x and y on both sides asks the variable (as 5.5)', await page.isVisible('#dialog #d-v'));
await page.fill('#d-v', 'y');
await page.click('#dialog-ok');
await waitFor('11x');
check('... and divides in y', (await docJson()).includes('11x') || (await docJson()).includes('11 x'), (await call('formulas')).result.map((x) => x.latex));

await enter('x^4+3x^2');
await menu('Compute', 'Polynomials', 'Companion Matrix');
await waitFor('Companion matrix');
check('Companion Matrix: one variable, no dialog, after "Companion matrix"', (await text()).includes('Companion matrix: '), await text());

// Random Numbers: no formula needed; the numbers go where the cursor is
await page.evaluate(() => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.atEnd(v.state.doc))); v.focus(); });
const count = () => page.evaluate(() => document.querySelectorAll('.math-inline').length);
const before = await count();
await menu('Compute', 'Statistics', 'Random Numbers...');
check('Random Numbers asks how many, the distribution and its parameters', await page.isVisible('#dialog #d-n') && await page.isVisible('#dialog #d-dist'));
await page.selectOption('#d-dist', 'poisson');
check('... Poisson asks one parameter', !(await page.isVisible('#dialog #d-p2')), await page.textContent('#d-l1'));
await page.fill('#d-n', '5'); await page.fill('#d-p1', '4');
await page.click('#dialog-ok');
await page.waitForFunction((k) => document.querySelectorAll('.math-inline').length > k, before, { timeout: 30000 }).catch(() => {});
const f = (await call('formulas')).result;
check('... and writes five whole numbers as a new formula', (await count()) === before + 1 && /^\d+(,\d+){4}$/.test(f[f.length - 1].latex.replace(/\s/g, '')), f.slice(-2));

check('no page errors', !errs.length, errs);
await b.close();
process.exit(fails ? 1 : 0);
