// What writing a homework (ADM, Pade) in opensw needed: products like x(a+b), d/dx acting on the
// next term, defined names differentiated, evaluate at x=0, the variable / order / unknowns asked
// as in 5.5, Pade approximants, typesetting with amsmath. Run: node test/compute2.mjs
// (needs `npx vite preview --port 4173`; SymPy in the page)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/?lang=en'); await page.waitForTimeout(600);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 220)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const flat = (s) => s.replace(/\s|\\left|\\right/g, '');
const compute = async (latex, op, params) => { const r = await call('compute', { latex, op, params }); return r.ok ? r.result : { error: r.error }; };

let r = await compute('x(a+b)', 'expand');
check('x(a+b) is a product', flat(r.latex) === 'ax+bx', r);
r = await compute('x\\left(\\frac{1}{c}-\\frac{b}{c^2}\\right)-\\frac{x}{c}+\\frac{bx}{c^2}', 'simplify');
check('Mathematica\'s x \\left(...\\right) read back', r.latex === '0', r);
r = await compute('\\left(\\frac{d}{dy}f(y)+a\\frac{f(y)-g(x)+\\beta}{bx-ay-\\alpha}\\right)\\frac{\\partial}{\\partial x}\\frac{f(y)-g(x)+\\beta}{bx-ay-\\alpha}+\\left(\\frac{d}{dx}g(x)+b\\frac{f(y)-g(x)+\\beta}{bx-ay-\\alpha}\\right)\\frac{\\partial}{\\partial y}\\frac{f(y)-g(x)+\\beta}{bx-ay-\\alpha}', 'simplify');
check('the homework\'s check, written plainly, is 0', r.latex === '0', r);
r = await compute("\\left(\\Psi'(y)+a\\frac{\\Psi(y)-\\Upsilon(x)}{bx-ay}\\right)\\frac{\\partial}{\\partial x}\\frac{\\Psi(y)-\\Upsilon(x)}{bx-ay}+\\left(\\Upsilon'(x)+b\\frac{\\Psi(y)-\\Upsilon(x)}{bx-ay}\\right)\\frac{\\partial}{\\partial y}\\frac{\\Psi(y)-\\Upsilon(x)}{bx-ay}", 'simplify');
check('with \\Psi, \\Upsilon and primes', r.latex === '0', r);
await compute('w_0=-\\frac{y+\\beta}{ay+\\alpha}', 'define');
r = await compute('\\frac{\\partial}{\\partial y}w_0', 'factor');
check('a defined name differentiated', flat(r.latex).includes('\\alpha-a\\beta') || flat(r.latex).includes('a\\beta-\\alpha'), r);
await compute('w(x,y)=\\frac{x+y+\\beta}{bx-ay-\\alpha}', 'define');
r = await compute('\\frac{\\partial}{\\partial x}w(x,y)', 'factor');
check('a defined function differentiated', !r.latex.includes('w') && r.latex.includes('\\alpha'), r);
r = await compute('\\left.\\frac{x+y+\\beta}{bx-ay-\\alpha}\\right|_{x=0}', 'simplify');
check('evaluate at x = 0', r.latex?.includes('\\beta') && !r.latex.includes('x'), r);
await call('compute', { latex: '0', op: 'cleardefs' });
r = await compute('\\frac{1}{1-t+x}', 'series', ['t', '4']);
check('series in t, 4 terms: up to t^3', r.latex.includes('O\\left(t^{4}\\right)'), r);
r = await compute('\\begin{pmatrix}p_0=-\\frac12\\\\p_1=-\\frac12-\\frac12q_1\\\\0=-\\frac{b}{4}-\\frac12q_1\\end{pmatrix}', 'solve', ['p_0', 'p_1', 'q_1']);
check('solve for the chosen unknowns', r.solutions?.length === 1 && r.solutions[0].includes('q_{1}=- \\frac{1}{2} b'), r);
r = await compute('\\frac{x+y+\\beta}{bx-ay-\\alpha}', 'pade', ['1', '1', 'x']);
check('Pade [1/1] of a [1/1] function is itself', flat(r.latex).replace(/[{}]/g, '').includes('\\beta+x+y'), r);
r = await compute('e^x', 'pade', ['2', '2']);
check('Pade [2/2] of e^x', flat(r.latex).replace(/[{}]/g, '').includes('x^2+6x+12'), r);
r = await compute('\\frac{d}{dx}W(x)+\\Psi(y)', 'evaluate');
check('W(x), \\Psi(y): functions', r.latex && !r.error, r);

// the dialogs that ask, as in 5.5
await call('set', { latex: 'Series $\\frac{1}{1-t}+x$ and $e^x$ and $p=aq$.' });
const enter = (i) => page.evaluate((k) => document.querySelectorAll('.math-inline')[k]._mathView.enter(false), i);
const menu = async (...items) => {
  await page.click(`.menu-top:has-text("${items[0]}")`);
  for (const it of items.slice(1)) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
await enter(0);
await menu('Compute', 'Calculus', 'Power series…');
check('Power series asks the variable and the number of terms', await page.isVisible('#dialog #d-v') && await page.isVisible('#dialog #d-n'));
await page.fill('#d-v', 't'); await page.fill('#d-n', '3');
await page.click('#dialog-ok');
await page.waitForFunction(() => /O\\\\left\(t\^\{?3/.test(JSON.stringify(window.swEditor.state.doc.toJSON())), null, { timeout: 30000 }).catch(() => {});
r = await call('formulas');
check('... and expands in t', /O\\left\(t\^\{?3/.test(r.result[0].latex), r.result[0]);
await enter(1);
await menu('Compute', 'Calculus', 'Padé approximant…');
check('Padé approximant asks m and n', await page.isVisible('#dialog #d-m'));
await page.click('#dialog-ok');
await page.waitForFunction(() => JSON.stringify(window.swEditor.state.doc.toJSON()).includes('12'), null, { timeout: 30000 }).catch(() => {});
r = await call('formulas');
check('... and gives [2/2]', r.result.some((f) => f.latex.replace(/\s/g, '').includes('6x+12')), r.result.map((f) => f.latex));
const n = (await call('formulas')).result.length;
await enter(n - 1);
await menu('Compute', 'Solution', 'Exact');
check('Solve with more unknowns than equations asks which', await page.isVisible('#dialog #d-u'));
await page.fill('#d-u', 'q');
await page.click('#dialog-ok');
await page.waitForFunction(() => JSON.stringify(window.swEditor.state.doc.toJSON()).includes('\\\\frac{p}{a}'), null, { timeout: 30000 }).catch(() => {});
r = await call('formulas');
check('... and solves for q', r.result.some((f) => f.latex.replace(/\s/g, '') === '\\frac{p}{a}'), r.result.map((f) => f.latex));

// 5.x groups digits with thin spaces: one number, not a product
r = await compute('\\sqrt{86.\\, 989}', 'numeric');
check('86.\\, 989 is one number (5.x digit groups)', r.latex?.startsWith('9.326'), r);
r = await compute('77\\,531+1');
check('77\\,531 is one number', r.latex === '77532', r);

// a whole document set by AI: no old name; amsmath for \dfrac in what is typeset
await call('set', { latex: '\\documentclass{article}\\begin{document}Let $w=\\dfrac{1}{x}$.\\end{document}' });
r = await call('info');
check('a whole new document set by AI has no old name', r.result.name === null, r.result);
const tex = await page.evaluate(() => window.swTypesetTexForTests());
check('\\dfrac without amsmath in the preamble: amsmath added', /\\usepackage\{amsmath\}/.test(tex) && tex.includes('\\dfrac'), tex.slice(0, 300));

check('no page errors', !errs.length, errs);
await b.close();
process.exit(fails ? 1 : 0);
