// What makes opensw compute and plot as 5.5 does: formulas read as 5.5 reads them (sin x/2, 1/3x),
// Transforms with 5.5's convention and words, the Solve Options and the plot pages of Compute >
// Settings, and each document's own definitions.
// Run: node test/c55_core55.mjs  (needs `npx vite preview --port 4173`, or OPENSW_PORT; SymPy in the page)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(600);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 300)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const flat = (s) => (s || '').replace(/\s|\\left|\\right|[{}]/g, '');
const enter = (i) => page.evaluate((k) => document.querySelectorAll('.math-inline')[k]._mathView.enter(false), i);
const menu = async (...items) => {
  await page.click(`.menu-top:has-text("${items[0]}")`);
  for (const it of items.slice(1)) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const frames = () => page.evaluate(() => { const f = []; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image' && n.attrs.plot) f.push(n.attrs.frame); }); return f; });

// 1. read as 5.5 reads it (its help, trigarg.tex and dm1-3.tex)
let r = await call('compute', { latex: '1/3x+4', op: 'interpret' });
check('1/3x+4 is (1/3)x+4', flat(r.result?.latex).includes('\\frac13x+4') || flat(r.result?.latex).includes('\\frac{1}{3}x+4'), r);
r = await call('compute', { latex: '\\sin xe^{x}=\\left( \\sin x\\right) e^{x}', op: 'check' });
check('sin x e^x is (sin x) e^x', r.result?.value === true, r);
r = await call('compute', { latex: '\\sin x/2=\\sin \\frac{x}{2}', op: 'check' });
check('sin x/2 is sin(x/2)', r.result?.value === true, r);
r = await call('compute', { latex: '\\sin \\left( x\\right) /2=\\frac{\\sin x}{2}', op: 'check' });
check('sin(x)/2 is (sin x)/2', r.result?.value === true, r);

// 2. Transforms: MuPAD's convention, 5.5's words
await call('set', { latex: 'Take $1$ and $t^{2}$.' });
await enter(0);
await menu('Compute', 'Transforms', 'Fourier');
await page.waitForFunction(() => window.swEditor.state.doc.textContent.includes('Fourier transform is'), null, { timeout: 60000 }).catch(() => {});
let text = await page.evaluate(() => window.swEditor.state.doc.textContent);
let latex = (await call('formulas')).result.map((f) => f.latex);
check('Transforms > Fourier: "1, Fourier transform is: 2 pi Dirac(w)"', text.includes(', Fourier transform is: ') && latex.some((l) => flat(l).includes('2\\pi\\operatornameDirac(w)')), [text, latex]);
await enter(latex.findIndex((l) => l.includes('t^{2}')));
await menu('Compute', 'Transforms', 'Laplace');
await page.waitForFunction(() => window.swEditor.state.doc.textContent.includes('Laplace transform is'), null, { timeout: 30000 }).catch(() => {});
latex = (await call('formulas')).result.map((f) => f.latex);
check('Transforms > Laplace: "t^2, Laplace transform is: 2/s^3"', latex.some((l) => flat(l) === '\\frac2s^3'), latex);

// 3. Solve Options (Engine Setup page): Maximum Degree, Ignore Special Cases
r = await call('compute', { latex: 'x^{4}+x-1=0', op: 'solve' });
check('Maximum Degree 3: a quartic answered as rho_1, a root of X^4+X-1', /\\rho/.test(r.result?.solutions?.[0] || '') && /is a root of/.test(r.result?.solutions?.[0] || ''), r);
r = await call('compute', { latex: '\\cos x+y+xz=z', op: 'solve', params: ['z'] });
check('Ignore Special Cases off: solved case by case (x ≠ 1, x = 1 ...)', /\\text\{if\}/.test(r.result?.solutions?.[0] || '') && /x \\neq 1/.test(r.result?.solutions?.[0] || ''), r);
await call('set', { latex: 'Here $x$.' });
await enter(0);
await menu('Compute', 'Settings...');
check('Compute > Settings shows 5.5\'s pages as tabs', await page.$$eval('#dialog .tabs55 button', (bs) => bs.map((x) => x.textContent).join('|')).then((t) => /General\|Definition Options\|Engine Setup\|Plot Layout\|2D Plots\|3D Plots\|Plot Behavior\|Default Plot Intervals and Animation/.test(t)));
await page.click('#dialog .tabs55 button:text-is("Engine Setup")');
check('a tab shows its page only', await page.isVisible('#d-deg') && !(await page.isVisible('#d-dig')));
await page.fill('#d-deg', '4');
await page.check('#d-isc');
// the plot pages: 2D colour blue, the Rectangular interval -2..2 with 50 points, 3D Wire Frame, a 4in x 3in floating plot
await page.click('#dialog .tabs55 button:text-is("2D Plots")');
await page.selectOption('#p55-2c', '#0000ff');
await page.selectOption('#p55-2ls', 'dash');
await page.click('#dialog .tabs55 button:text-is("3D Plots")');
await page.selectOption('#p55-3ss', 'Wire Frame');
await page.selectOption('#p55-3b', '#008000');
await page.click('#dialog .tabs55 button:text-is("Default Plot Intervals and Animation")');
await page.fill('#p55-i-rect-0-a', '-2'); await page.fill('#p55-i-rect-0-b', '2'); await page.fill('#p55-i-rect-0-n', '50');
await page.fill('#p55-af', '8');
await page.click('#dialog .tabs55 button:text-is("Plot Layout")');
await page.fill('#p55-w', '4'); await page.fill('#p55-h', '3');
await page.check('input[name="p55-pl"][value="float"]');
await page.click('#dialog-ok');
await page.waitForTimeout(300);
r = await call('compute', { latex: 'x^{4}+x-1=0', op: 'solve' });
check('Maximum Degree 4: the quartic in radicals', r.result?.solutions?.length === 4 && !/\\rho/.test(r.result.solutions.join()), r);
r = await call('compute', { latex: '\\cos x+y+xz=z', op: 'solve', params: ['z'] });
check('Ignore Special Cases: one answer, -(y + cos x)/(x - 1)', r.result?.solutions?.length === 1 && !/\\text\{if\}/.test(r.result.solutions[0]), r);
// a new plot takes the plot pages
await call('set', { latex: 'Plot $x^{2}$ and $x^{2}+y^{2}$ and $\\sin (x+t)$.' });
await enter(0);
await menu('Compute', 'Plot 2D', 'Rectangular');
await page.waitForTimeout(500);
let f = (await frames())[0] || '';
check('Plot 2D > Rectangular: interval -2..2, 50 points, blue, dashed', /xmin "-2";xmax "2"/.test(f) && /num-x-gridlines 50/.test(f) && /0x000000ff/.test(f) && /lineAttributes "Dash"/.test(f), f.slice(0, 600));
check('... 4in x 3in, floating', /^\\FRAME\{f[a-z]*F\}\{4in\}\{3in\}/.test(f), f.slice(0, 40));
await enter(1);
await menu('Compute', 'Plot 3D', 'Rectangular');
await page.waitForTimeout(500);
f = (await frames())[1] || '';
check('Plot 3D > Rectangular: Wire Frame, green', /surfaceStyle "Wire Frame"/.test(f) && /0x00008000/.test(f), f.slice(0, 900));
await enter(2);
await menu('Compute', 'Plot 2D Animated', 'Rectangular');
await page.waitForTimeout(500);
f = (await frames())[2] || '';
check('Plot 2D Animated: 8 frames per second, the interval -2..2', /animationFramesPerSecond "8"/.test(f) && /xmin "-2"/.test(f), f.slice(0, 500));
// Plot Behavior: Display Plot Properties Dialog Before Plotting
await enter(0);
await menu('Compute', 'Settings...');
await page.click('#dialog .tabs55 button:text-is("Plot Behavior")');
await page.check('#p55-dlg');
await page.click('#dialog-ok');
await page.waitForTimeout(200);
await enter(0);
await menu('Compute', 'Plot 2D', 'Polar');
await page.waitForTimeout(500);
check('Display Plot Properties Dialog Before Plotting: the new plot\'s Properties open', await page.isVisible('#dialog') && /Plot properties/.test(await page.textContent('#dialog-title')));
await page.click('#dialog-cancel');
// set back for the other tests
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('opensw-settings') || '{}'); delete s.plot55; if (s.compute55) { s.compute55.max_degree = 3; s.compute55.ignore_special = false; } localStorage.setItem('opensw-settings', JSON.stringify(s)); });

// 5. each document has its own definitions (5.5)
await page.reload(); await page.waitForTimeout(800);
await call('set', { latex: 'A $a=7$.' });
await enter(0);
await menu('Compute', 'Definitions', 'New Definition');
await page.waitForTimeout(1500);
r = await call('compute', { latex: 'a+1' });
check('a = 7 defined in the first document', r.result?.latex === '8', r);
await page.setInputFiles('#file', 'test/fixtures/notes.tex'); await page.waitForTimeout(1200);
r = await call('compute', { latex: 'a+1' });
check('another document has none of it', flat(r.result?.latex) === 'a+1', r);
await call('compute', { latex: 'a=2', op: 'define' });
r = await call('compute', { latex: 'a+1' });
check('... and its own a = 2', r.result?.latex === '3', r);
await page.keyboard.press('Control+F6');
await page.waitForTimeout(300);
r = await call('compute', { latex: 'a+1' });
check('back to the first: a = 7 again', r.result?.latex === '8', r);
await page.keyboard.press('Control+F6');
await page.waitForTimeout(300);
r = await call('compute', { latex: 'a+1' });
check('and the second: a = 2', r.result?.latex === '3', r);

check('no page errors', errs.length === 0, errs);
await b.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
