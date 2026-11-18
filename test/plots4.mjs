// The other kinds of plot: 2D implicit, inequality, vector field, gradient, conformal,
// approximate integral, log, ODE; 3D cylindrical, spherical, parametric surface, implicit,
// tube, vector field, gradient. Read from 5.5 settings, made from the Compute menu, the
// points checked against the formulas.  node test/plots4.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import { parsePlot, drawable, plotKind, splitRelation } from '../src/plots.js';
import { odeRows } from '../src/plotdata.js';
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// 1. reading (no browser)
const sp = (body) => parsePlot(`\\special{language "Scientific Word";type "MAPLEPLOT";${body}}`);
const sph = sp('xmin "-3.1416";xmax "3.1416";plottype 15;constrained TRUE;var1name \\TEXUX{$\\U{3b8} $};var2name \\TEXUX{$\\U{3c6} $};var3name \\TEXUX{$\\U{3c1} $};function \\TEXUX{$2$};var1range "-3.1416,3.1416";var2range "0,3.1416";num-x-gridlines 25;num-y-gridlines 25;');
check(plotKind(sph) === 'spherical' && drawable(sph) && sph.variable === '\\theta' && sph.variable2 === '\\varphi' && sph.curves[0].grid.join() === '25,25,', 'spherical: kind, Greek names from \\U{..}, grid');
check(drawable(sp('plottype 11;function \\TEXUX{$\\left[ x+y,x-y\\right] $};curveStyle "Point";')), 'vector field with point style is drawable');
check(!drawable(sp('plottype 11;function \\TEXUX{$x+y$};')), 'vector field of one formula is not');
check(!drawable(sp('plottype 12;function \\TEXUX{$x+y$};')) && !drawable(sp('plottype 25;function \\TEXUX{$x+y=1$};')), 'implicit needs "=", inequality needs "<" or ">"');
check(splitRelation('\\left( x<1\\right) \\leq y').rel === '<=', 'relation found outside brackets');
const rows = odeRows("\\begin{array}{r}y^{\\prime }=\\sin \\left( xy\\right) \\\\ y(0)=3\\end{array}");
check(rows.equations.join() === 'y^{\\prime }=\\sin \\left( xy\\right)' && rows.inits[0].join() === 'y,0,3', 'ODE rows: equation and initial value');

// 2. in the editor
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'warning' && /繪圖/.test(m.text())) errs.push(m.text()); });
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(600);
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
// the plot made from the formula: its frame, its SVG, and its points (plotData)
const plotFrom = async (latex, items, dialog) => {
  await call('set', { latex: `Plot $${latex}$.` });
  await page.evaluate(() => document.querySelectorAll('.math-inline')[0]._mathView.enter(false));
  await menu('計算', ...items);
  if (dialog) await dialog();
  await page.waitForFunction(() => [...document.querySelectorAll('.image img')].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 90000 });
  return page.evaluate(async () => {
    let frame;
    window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image') frame = n.attrs.frame; });
    return { frame, svg: await (await fetch(document.querySelector('.image img').src)).text() };
  });
};
const dataOf = (frame) => page.evaluate((f) => window.swComputeForTests.plotDataOfFrame(f), frame);

let r = await plotFrom('x^2+y^2=4', ['繪圖 2D', '隱函數']);
check(/plottype 12;/.test(r.frame) && /function \\TEXUX\{\$x\^2\+y\^2=4\$\}/.test(r.frame), 'implicit: frame keeps the equation');
let d = (await dataOf(r.frame))[0];
let worst = 0;
for (let i = 0; i < d.segs.length; i += 2) worst = Math.max(worst, Math.abs(Math.hypot(d.segs[i], d.segs[i + 1]) - 2));
check(d.segs.length > 200 && worst < 0.02, `implicit x²+y²=4: ${d.segs.length / 4} pieces on the circle (worst ${worst.toFixed(4)})`);

r = await plotFrom('x+y^2<5', ['繪圖 2D', '不等式']);
d = (await dataOf(r.frame))[0];
const covered = (x, y) => d.cells.some(([a, b, c, e]) => a <= x && x <= c && b <= y && y <= e);
check(/plottype 25;/.test(r.frame) && covered(0, 0) && covered(-4, 2) && !covered(4.9, 4.9) && !covered(4, 1.5), 'inequality x+y²<5: the region holds where it should');
check(/fill="#ffcd99"/.test(r.svg), 'inequality: filled');

r = await plotFrom('\\left[x+y,x-y\\right]', ['繪圖 2D', '向量場']);
d = (await dataOf(r.frame))[0];
check(/plottype 11;/.test(r.frame) && d.arrows.length === 400 && d.arrows.every(([x, y, u, v]) => near(u, x + y) && near(v, x - y)), `vector field [x+y, x-y]: ${d.arrows.length} arrows, all right`);

r = await plotFrom('xy', ['繪圖 2D', '梯度']);
d = (await dataOf(r.frame))[0];
check(/plottype 10;/.test(r.frame) && d.arrows.length === 100 && d.arrows.every(([x, y, u, v]) => near(u, y) && near(v, x)), 'gradient of xy: (y, x) at every point');

r = await plotFrom('\\frac{z-1}{z+1}', ['繪圖 2D', '保角']);
d = (await dataOf(r.frame))[0];
check(/plottype 9;/.test(r.frame) && near(d.paths[0].x[0], -1) && near(d.paths[0].y[0], 0) && d.paths.length === 22, 'conformal (z-1)/(z+1): z = 0 goes to -1; 11 + 11 lines');

r = await plotFrom('\\begin{pmatrix}y\'=y\\\\ y(0)=1\\end{pmatrix}', ['繪圖 2D', '常微分方程']);
d = (await dataOf(r.frame))[0];
const yl = d.paths[0].y;
check(/plottype 23;/.test(r.frame) && near(d.paths[0].x[0], 0) && near(yl[Math.round(yl.length / 5)], Math.E, 1e-6), `ODE y' = y, y(0) = 1: y(1) = ${yl[Math.round(yl.length / 5)]}`);

r = await plotFrom('\\frac{1}{x^2+1}', ['微積分', '畫近似積分圖…'], async () => {
  await page.selectOption('#d-m', 'right'); await page.fill('#d-n', '10'); await page.fill('#d-a', '-1'); await page.fill('#d-b', '1'); await page.click('#dialog-ok');
});
d = (await dataOf(r.frame))[0];
let sum = 0;
for (let k = 1; k <= 10; k++) sum += 0.2 / (1 + (-1 + 0.2 * k) ** 2);
check(/plottype 3;/.test(r.frame) && /approxIntBoxType "right"/.test(r.frame) && near(d.boxes.reduce((s, [a1, b1, h]) => s + (b1 - a1) * h, 0), sum, 1e-9), 'approximate integral: 10 right boxes, the right sum');

// 3D
r = await plotFrom('3', ['繪圖 3D', '柱座標']);
d = (await dataOf(r.frame))[0];
check(/plottype 14;/.test(r.frame) && d.mesh.flat().every((p) => near(Math.hypot(p[0], p[1]), 3, 1e-9)) && (r.svg.match(/fill="hsl/g) || []).length === 24 * 24, 'cylindrical r = 3: a cylinder, 24 × 24 patches');
r = await plotFrom('2', ['繪圖 3D', '球座標']);
d = (await dataOf(r.frame))[0];
check(/plottype 15;/.test(r.frame) && d.mesh.flat().every((p) => near(Math.hypot(...p), 2, 1e-9)), 'spherical ρ = 2: a sphere');
r = await plotFrom('\\left(s,t,st\\right)', ['繪圖 3D', '直角座標']);
d = (await dataOf(r.frame))[0];
check(/plottype 5;/.test(r.frame) && d.mesh.flat().every((p) => near(p[2], p[0] * p[1], 1e-9)), 'parametric surface (s, t, st)');
r = await plotFrom('x^2+y^2+z^2=9', ['繪圖 3D', '隱函數']);
d = (await dataOf(r.frame))[0];
worst = Math.max(...d.tris.flat().map((p) => Math.abs(Math.hypot(...p) - 3)));
check(/plottype 18;/.test(r.frame) && d.tris.length > 500 && worst < 0.15, `implicit sphere: ${d.tris.length} triangles (worst ${worst.toFixed(3)})`);
r = await plotFrom('\\left(\\cos t,\\sin t,t/5\\right)', ['繪圖 3D', '管狀']);
d = (await dataOf(r.frame))[0];
const mid = d.mesh[25];
const t25 = 6.2832 * 25 / 50;
check(/plottype 13;/.test(r.frame) && /radius \\TEXUX\{\$0\.2\$\}/.test(r.frame) && mid.every((p) => near(Math.hypot(p[0] - Math.cos(t25), p[1] - Math.sin(t25), p[2] - t25 / 5), 0.2, 0.01)), 'tube: the ring is 0.2 from the curve');
r = await plotFrom('\\left[-y,x,z\\right]', ['繪圖 3D', '向量場']);
d = (await dataOf(r.frame))[0];
check(/plottype 17;/.test(r.frame) && d.arrows.length === 216 && d.arrows.every(([p, v]) => near(v[0], -p[1]) && near(v[1], p[0]) && near(v[2], p[2])), '3D vector field [-y, x, z]: 216 arrows, all right');
r = await plotFrom('xz+xy+yz', ['繪圖 3D', '梯度']);
d = (await dataOf(r.frame))[0];
check(/plottype 16;/.test(r.frame) && d.arrows.every(([p, v]) => near(v[0], p[1] + p[2]) && near(v[1], p[0] + p[2]) && near(v[2], p[0] + p[1])), '3D gradient of xz+xy+yz');
check(/<path d="M[^"]+" fill="none" stroke="hsl/.test(r.svg), '3D arrows drawn');

// messages when the formula does not fit
await call('set', { latex: 'Plot $x^2$.' });
await page.evaluate(() => document.querySelectorAll('.math-inline')[0]._mathView.enter(false));
await menu('計算', '繪圖 2D', '向量場');
await page.waitForTimeout(300);
check(await page.evaluate(() => !document.querySelector('.image')), 'vector field of one formula: nothing inserted');

// Properties of an implicit plot: range and formula changed, drawn again; log scale for a rectangular plot
r = await plotFrom('x^2+y^2=4', ['繪圖 2D', '隱函數']);
const selectPlot = () => page.evaluate(() => { const v = window.swEditor; let p = null; v.state.doc.descendants((n, pos) => { if (n.type.name === 'image') p = pos; }); v.dispatch(v.state.tr.setSelection(window.swNodeSelection.create(v.state.doc, p))); });
const redrawn = async () => {
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    const f = await page.evaluate(() => { let f, ok; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image') { f = n.attrs.frame; ok = !!n.attrs.src; } }); return ok ? f : ''; });
    if (f) return f;
  }
  return '';
};
await selectPlot();
await page.keyboard.press('Control+F5');
await page.fill('#d-f0', 'x^2+y^2=1'); await page.fill('#d-a0', '-2'); await page.fill('#d-b0', '2'); await page.fill('#d-g', '30');
await page.click('#dialog-ok');
let frame = await redrawn();
check(/function \\TEXUX\{\$x\^2\+y\^2=1\$\};var1range "-2,2";var2range "-5,5";num-x-gridlines 30;num-y-gridlines 30;/.test(frame), 'implicit properties: formula, x range and grid');

await call('set', { latex: 'Plot $5\\cdot 2^{x}$.' });
await page.evaluate(() => document.querySelectorAll('.math-inline')[0]._mathView.enter(false));
await menu('計算', '繪圖 2D', '直角座標');
await page.waitForFunction(() => [...document.querySelectorAll('.image img')].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 60000 });
await selectPlot();
await page.keyboard.press('Control+F5');
await page.selectOption('#d-scale', 'log');
await page.click('#dialog-ok');
frame = await redrawn();
const svg = await page.evaluate(async () => (await (await fetch(document.querySelector('.image img').src)).text()));
check(/plottype 20;/.test(frame) && /10<tspan/.test(svg), 'rectangular → log scale: plottype 20, powers of ten on the axis');
// on a log scale 5·2^x is a straight line
d = (await dataOf(frame))[0];
const ly = d.y.map(Math.log10);
check(d.x.every((x, i) => near(ly[i], Math.log10(5) + x * Math.log10(2), 1e-9)), 'log plot points: log y is linear in x');

// 5.5's own settings (a file with one plot of each kind, written as 5.5 writes them)
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(600);
await page.setInputFiles('#file', 'test/fixtures/pictures/plots55more.tex');
if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
await page.waitForTimeout(1200);
await page.evaluate(() => window.swPictures.renderPlots());
const shown = await page.evaluate(() => [...document.querySelectorAll('.image img')].filter((i) => i.complete && i.naturalWidth > 0).length);
const total = await page.evaluate(() => document.querySelectorAll('.image').length);
check(total === 11 && shown === 11, `5.5 file: ${shown} of ${total} plots drawn`);

check(!errs.length, 'no page errors ' + errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
