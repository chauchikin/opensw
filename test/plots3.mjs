// Plot 2D > Polar, Parametric and Plot 3D > Rectangular: 5.5's plottype 8, 19 and 5 read,
// made from the Compute menu and drawn.  node test/plots3.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import { parsePlot, drawable, plotKind, components } from '../src/plots.js';
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };

// 1. settings as 5.5 writes them (from 5.5's own help files)
const polar = parsePlot('\\special{language "Scientific Word";type "MAPLEPLOT";width 2.7916in;height 1.8602in;depth 0in;xmin "-3.1416";xmax "3.1416";plottype 8;numpoints 100;axesstyle "normal";var1name \\TEXUX{$\\theta $};function \\TEXUX{$\\left( 6,\\theta \\right) $};linecolor "black";coordinateSystem "polar";var1range "-3.1416,3.1416";num-x-gridlines 100;curveColor "[flat::RGB:0000000000]";curveStyle "Line";}');
check(plotKind(polar) === 'polar' && drawable(polar) && components(polar.curves[0].latex).join('|') === '6|\\theta', 'polar (6, θ): kind, drawable, two parts');
const param = parsePlot('\\special{language "Scientific Word";type "MAPLEPLOT";xmin "0";xmax "6.29";plottype 19;numpoints 49;axesstyle "normal";var1name \\TEXUX{$t$};function \\TEXUX{$\\left( \\cos t,\\sin t\\right) $};linecolor "blue";var1range "0,6.29";num-x-gridlines 49;curveColor "[flat::RGB:0x00000080]";curveStyle "Line";}');
check(plotKind(param) === 'param' && drawable(param) && param.curves[0].range.join() === '0,6.29', 'parametric (cos t, sin t)');
const surf = parsePlot('\\special{language "Scientific Word";type "MAPLEPLOT";xmin "-5";xmax "5";ymin "-5";ymax "5";plottype 5;axesstyle "normal";var1name \\TEXUX{$x$};var2name \\TEXUX{$y$};function \\TEXUX{$x^{3}-3xy^{2}$};var1range "-5,5";var2range "-5,5";surfaceStyle "Color Patch";}');
check(plotKind(surf) === 'surface' && drawable(surf) && surf.variable2 === 'y' && surf.curves[0].range2.join() === '-5,5', '3D rectangular x^3 - 3xy^2');
check(drawable(parsePlot('\\special{plottype 12;function \\TEXUX{$x^2+y^2=1$};}')), 'implicit (12) is drawn now');

// 2. from the Compute menu
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(600);
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const plotFrom = async (latex, ...items) => {
  await call('set', { latex: `Plot $${latex}$.` });
  await page.evaluate(() => document.querySelectorAll('.math-inline')[0]._mathView.enter(false));
  await menu('計算', ...items);
  await page.waitForFunction(() => [...document.querySelectorAll('.image img')].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 60000 });
  return page.evaluate(async () => {
    let frame;
    window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image') frame = n.attrs.frame; });
    return { frame, svg: await (await fetch(document.querySelector('.image img').src)).text() };
  });
};
// all the points of the first curve, in px
const points = (svg) => svg.match(/<path d="([^"]+)" fill="none" stroke="#ff0000"/)[1].split(/[ML]/).filter(Boolean).map((p) => p.split(' ').map(Number));

let r = await plotFrom('r=2', '繪圖 2D', '極座標');
check(/plottype 8;constrained TRUE;/.test(r.frame) && /coordinateSystem "polar"/.test(r.frame), 'polar: frame as 5.5 writes it');
let pts = points(r.svg);
let xs = pts.map((p) => p[0]); let ys = pts.map((p) => p[1]);
const wpx = Math.max(...xs) - Math.min(...xs); const hpx = Math.max(...ys) - Math.min(...ys);
check(pts.length > 150 && Math.abs(wpx - hpx) < 2, `r = 2 is a round circle (${wpx.toFixed(1)} × ${hpx.toFixed(1)} px)`);

r = await plotFrom('\\left(\\cos t,\\sin 2t\\right)', '繪圖 2D', '參數式');
check(/plottype 19;/.test(r.frame) && /var1range "0,6.2832"/.test(r.frame), 'parametric: frame');
pts = points(r.svg);
xs = pts.map((p) => p[0]); ys = pts.map((p) => p[1]);
check(pts.length > 150 && Math.max(...xs) - Math.min(...xs) > 200, 'parametric curve spans the plot');

r = await plotFrom('z=x^2-y^2', '繪圖 3D', '直角座標');
check(/plottype 5;/.test(r.frame) && /var1name \\TEXUX\{\$x\$\};var2name \\TEXUX\{\$y\$\}/.test(r.frame) && /function \\TEXUX\{\$x\^2-y\^2\$\}/.test(r.frame), '3D: frame with x, y and the right side');
const patches = (r.svg.match(/fill="hsl\(/g) || []).length;
check(patches === 24 * 24, `3D: ${patches} shaded patches`);

// the 3D plot's Properties: another function and the y range
await page.evaluate(() => { const v = window.swEditor; let p = null; v.state.doc.descendants((n, pos) => { if (n.type.name === 'image') p = pos; }); v.dispatch(v.state.tr.setSelection(window.swNodeSelection.create(v.state.doc, p))); });
await page.keyboard.press('Control+F5');
await page.fill('#d-f0', 'xy');
await page.fill('#d-y0', '0'); await page.fill('#d-y1', '2');
await page.click('#dialog-ok');
let frame = '';
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(500);
  frame = await page.evaluate(() => { let f, ok; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image') { f = n.attrs.frame; ok = !!n.attrs.src; } }); return ok ? f : ''; });
  if (frame) break;
}
check(/function \\TEXUX\{\$xy\$\};var1range "-5,5";var2range "0,2"/.test(frame) && /plottype 5;/.test(frame), '3D properties: new function and y range, drawn again');

// the parametric message when the formula is not a pair
await call('set', { latex: 'Plot $x^2$.' });
await page.evaluate(() => document.querySelectorAll('.math-inline')[0]._mathView.enter(false));
await menu('計算', '繪圖 2D', '參數式');
await page.waitForTimeout(300);
check(await page.evaluate(() => !document.querySelector('.image')), 'parametric of one formula: nothing inserted');

check(!errs.length, 'no page errors ' + errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
