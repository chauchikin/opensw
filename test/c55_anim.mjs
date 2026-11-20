// Compute > Plot 2D Animated, Plot 3D Animated, Calculus > Plot Approximate Integral Animated:
// the frame as 5.5 writes it, the frames drawn, the bar that plays them, and 5.5's own animated
// plots read and saved again.  OPENSW_PORT=4186 node test/c55_anim.mjs  (needs `npx vite preview`)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { parsePlot, plotSpecial, plotKind, drawable } from '../src/plots.js';
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const FIX = 'test/fixtures/pictures/anim55.tex';

// 1. 5.5's settings (its help files: dm6-6, dm7-6, dm9-3), read and written back
const src = fs.readFileSync(FIX, 'latin1');
const specials = [...src.matchAll(/\\special\{[^]*?\}\}(?=\r\n)/g)].map((m) => m[0]);
const [surf, approx, vec] = specials.map(parsePlot);
check(plotKind(surf) === 'surface' && drawable(surf) && surf.anim?.param === 't' && surf.anim.range.join() === '-3,3' && surf.anim.fps === 5 && surf.anim.end === 10,
  '3D rectangular x^2+y^2+txy: animated, t from -3 to 3, 5 frames a second for 10 s');
check(plotKind(approx) === 'approx' && approx.anim.current === 4.76685 && approx.curves[0].boxType === 'middle' && approx.curves[0].boxes === 10, 'approximate integral: middle boxes, current time');
check(plotKind(vec) === 'vector' && vec.anim.range.join() === '-1,1', 'vector field [x+ty, x-ty]: t from -1 to 1');
for (const p of [surf, approx, vec]) {
  const s = plotSpecial(p, { width: '3in', height: '2in', path: 'p.wmf' });
  const q = parsePlot(s);
  check(/animated TRUE;/.test(s) && /animationStartTime "0";animationEndTime "10";animationFramesPerSecond "5";/.test(s) && /animationParam \\TEXUX\{t\};animationParamList \\TEXUX\{\$t\$\};/.test(s)
    && JSON.stringify(q.anim) === JSON.stringify(p.anim) && plotKind(q) === plotKind(p) && q.curves[0].latex === p.curves[0].latex, `${plotKind(p)}: written as 5.5 writes it and read back the same`);
}
check(/phi 75;theta 40;/.test(plotSpecial(surf, { path: 'p.wmf' })), '3D: the view (turn 40, tilt 75) is kept');
const plain = parsePlot('\\special{language "Scientific Word";type "MAPLEPLOT";xmin "-5";xmax "5";plottype 4;var1name \\TEXUX{$x$};function \\TEXUX{$\\sin x$};var1range "-5,5";}');
check(plain.anim === null && !/anim/i.test(plotSpecial(plain, { path: 'p.wmf' })), 'a plot that is not animated: nothing about animation');

// 2. in the editor
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1100, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(600);
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const frameOf = () => page.evaluate(() => { let f; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image') f = n.attrs.frame; }); return f; });
// a formula, then the menu item: wait until the bar can play the frames
const animate = async (latex, items, timeout = 240000) => {
  await call('set', { latex: `Plot $${latex}$.` });
  await page.evaluate(() => document.querySelectorAll('.math-inline')[0]._mathView.enter(false));
  await menu('Compute', ...items);
  await page.waitForFunction(() => { const s = document.querySelector('.anim-ctl .anim-frame'); return s && !s.disabled; }, null, { timeout });
  return frameOf();
};
const bar = () => page.evaluate(() => ({ max: +document.querySelector('.anim-frame').max, label: document.querySelector('.anim-value').textContent, src: document.querySelector('.image img').src }));
const svgAt = (i) => page.evaluate(async (k) => {
  const s = document.querySelector('.anim-frame');
  s.value = k; s.dispatchEvent(new Event('input', { bubbles: true }));
  return (await fetch(document.querySelector('.image img').src)).text();
}, i);

const ITEMS = [
  ['x+\\sin tx', ['Plot 2D Animated', 'Rectangular'], 4], ['1+t\\cos\\theta', ['Plot 2D Animated', 'Polar'], 8],
  ['x^2+y^2=t+1', ['Plot 2D Animated', 'Implicit'], 12], ['x+y^2<t', ['Plot 2D Animated', 'Inequality'], 25],
  ['\\left(\\cos s,t\\sin s\\right)', ['Plot 2D Animated', 'Parametric'], 19], ['z^2+t', ['Plot 2D Animated', 'Conformal'], 9],
  ['x^2-ty^2', ['Plot 2D Animated', 'Gradient'], 10], ['\\left[x+ty,x-ty\\right]', ['Plot 2D Animated', 'Vector Field'], 11],
  ['x^{2}+y^{2}+txy', ['Plot 3D Animated', 'Rectangular'], 5], ['1+t\\sin z', ['Plot 3D Animated', 'Cylindrical'], 14],
  ['1+t\\cos\\phi', ['Plot 3D Animated', 'Spherical'], 15], ['x^2+y^2+z^2=t+1', ['Plot 3D Animated', 'Implicit'], 18],
  ['\\left(\\cos s,\\sin s,ts\\right)', ['Plot 3D Animated', 'Tube'], 13], ['x^2+ty^2+z^2', ['Plot 3D Animated', 'Gradient'], 16],
  ['\\left[-y,x,tz\\right]', ['Plot 3D Animated', 'Vector Field'], 17], ['x+\\sin tx', ['Calculus', 'Plot Approximate Integral Animated'], 3],
];
for (const [latex, items, type] of ITEMS) {
  const t0 = Date.now();
  let f;
  try { f = await animate(latex, items); } catch (e) { check(false, `${items.join(' > ')}: ${e.message.split('\n')[0]}`); continue; }
  const p = parsePlot(f.slice(f.indexOf('\\special')));
  const r = await bar();
  const moves = (await svgAt(0)) !== (await svgAt(r.max));
  await svgAt(0);
  check(moves, `${items.join(' > ')}: the first and last frames differ`);
  check(p.plottype === type && p.anim?.param === 't' && p.anim.range.join() === '0,10' && /animated TRUE;/.test(f) && /animationParamRange "0,10";/.test(f)
    && r.max >= 20 && /^t = 0$/.test(r.label), `${items.join(' > ')} ${latex}: plottype ${p.plottype}, t from 0 to 10, ${r.max + 1} frames (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
// the frames differ, the slider shows the parameter's value, play moves on and pause stops
await animate('x+\\sin tx', ['Plot 2D Animated', 'Rectangular']);
const a0 = await svgAt(0);
const a5 = await svgAt(25);
const r5 = await bar();
check(a0 !== a5 && r5.label === 't = 5', `frame 25 is another picture, at t = 5 (${r5.label})`);
const axes = (svg) => (svg.match(/<text[^>]*>[^<]*<\/text>/g) || []).join();
check(axes(a0) === axes(a5), 'the axes stay the same in every frame');
await page.click('.anim-play');
await page.waitForTimeout(1200);
const playing = await bar();
await page.click('.anim-play');
const paused = await bar();
await page.waitForTimeout(700);
check(playing.label !== r5.label && paused.label === (await bar()).label && (await page.textContent('.anim-play')) === '▶', `play moves on (${playing.label}), pause stops (${paused.label})`);
const plotsInDoc = await page.evaluate(() => { let k = 0; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image') k++; }); return k; });
check(plotsInDoc === 1, 'clicking the bar did not change the document');

// the plot's Properties: the animation's settings
await page.evaluate(() => { const v = window.swEditor; let p = null; v.state.doc.descendants((n, pos) => { if (n.type.name === 'image') p = pos; }); v.dispatch(v.state.tr.setSelection(window.swNodeSelection.create(v.state.doc, p))); });
await page.keyboard.press('Control+F5');
if (await page.isVisible('#dialog #d-aa')) {
  await page.fill('#d-aa', '-2'); await page.fill('#d-ab', '2'); await page.fill('#d-fps', '2');
  await page.click('#dialog-ok');
  await page.waitForFunction(() => { const s = document.querySelector('.anim-ctl .anim-frame'); return s && !s.disabled && document.querySelector('.anim-value').textContent === 't = -2'; }, null, { timeout: 120000 });
  const f = await frameOf();
  check(/animationParamMin "-2";animationParamMax "2";/.test(f) && /animationFramesPerSecond "2";/.test(f) && /animationParamRange "-2,2";/.test(f) && +(await bar()).max === 20, 'Properties: t from -2 to 2, 2 frames a second (21 frames)');
} else check(false, 'Properties dialog with the animation settings');

// 3. 5.5's animated plots opened, played, saved as 5.x and read again
await page.setInputFiles('#file', FIX);
if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
await page.waitForFunction(() => document.querySelectorAll('.anim-ctl .anim-frame:not([disabled])').length === 3, null, { timeout: 300000 });
const bars = await page.evaluate(() => [...document.querySelectorAll('.anim-ctl')].map((b) => ({ max: +b.querySelector('.anim-frame').max, v: +b.querySelector('.anim-frame').value, label: b.querySelector('.anim-value').textContent })));
check(bars.length === 3 && bars[0].label === 't = -3' && bars[2].label === 't = -1', `5.5's three animated plots play (${bars.map((x) => x.label).join(', ')})`);
check(bars[1].v === Math.round((4.76685 / 10) * bars[1].max), `the approximate integral shows the frame at 5.5's currentAnimationTime (${bars[1].label})`);
const t55 = Buffer.from(await page.evaluate(() => window.swTex55ForTests())).toString('latin1');
const kept = [...src.matchAll(/\\FRAME\{[^]*?\}\}(?=\r\n)/g)].map((m) => m[0]);
check(kept.every((fr) => t55.includes(fr)), 'saved as 5.x: 5.5\'s three frames exactly as they were');
check(!errs.length, 'no page errors ' + errs.join(' | '));
await b.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
