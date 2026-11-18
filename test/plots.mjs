// 5.x plots (A4): settings read from the \FRAME, drawn again with the engine,
// typeset as PNG, kept in .sci.  node test/plots.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { parsePlot, drawable } from '../src/plots.js';
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const FIX = 'test/fixtures/pictures/';

// 1. reading the settings (no browser needed)
const src = fs.readFileSync(FIX + 'plot55.tex', 'latin1');
const plot = parsePlot(src.slice(src.indexOf('\\special')));
check(plot.curves.length === 2 && drawable(plot), 'two curves, drawable');
check(plot.curves[0].latex === '1+\\int_{0}^{x}\\cos s\\,ds' && plot.curves[0].color === '#0000ff' && plot.curves[0].n === 60, 'first curve: formula, colour, points');
check(plot.curves[1].color === '#ff0000' && plot.curves[1].width === 2 && plot.curves[1].dash && plot.curves[1].range.join() === '-1,3', 'second curve: colour, width, dashes, range');
check(plot.view.x.join() === '-1,3' && plot.view.y.join() === '-2,2' && plot.axes === 'normal', 'window and axes');

// 2. in the editor
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/'); await page.waitForTimeout(600);
const open = async (file) => {
  await page.setInputFiles('#file', file);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1200);
};
await open(FIX + 'plot55.tex');
await page.evaluate(() => window.swPictures.renderPlots());
check(await page.evaluate(() => [...document.querySelectorAll('.image img')].filter((i) => i.complete && i.naturalWidth > 0).length) === 1, 'plot drawn and shown');
const svg = await page.evaluate(async () => { const s = document.querySelector('.image img').src; return (await (await fetch(s)).text()); });
check((svg.match(/stroke="#0000ff"/g) || []).length === 1 && /stroke="#ff0000" stroke-width="2" stroke-dasharray/.test(svg), 'curves in their colours, widths and dashes');
// ln(2-x) has no value for x >= 2: its line stops there
const red = svg.match(/<path d="([^"]+)" fill="none" stroke="#ff0000"/)[1];
const lastX = +red.split(/[ML]/).filter(Boolean).pop().split(' ')[0];
// the window is x from -1 to 3 over 10..326 px: x = 2 is at 247 px
check(lastX < 247 && lastX > 235, 'ln(2-x) stops before x = 2: last point at ' + lastX + 'px');
// points: 1 + integral of cos from 0 to x = 1 + sin x (the engine in the page)
const pts = await page.evaluate(() => window.swComputeForTests.plotPoints('1+\\int_{0}^{x}\\cos s\\,ds', 'x', 0, 2, 4));
check(pts.y.every((y, i) => Math.abs(y - (1 + Math.sin(pts.x[i]))) < 1e-9), 'engine points: 1 + ∫cos = 1 + sin x');
const files = await page.evaluate(async () => (await window.swPictures.texPictureFiles()).list.map((f) => f.name));
check(files.join() === 'PLOT0002.wmf.png', 'the plot goes to TeX as PNG');
await page.click('#btn-latex'); await page.waitForTimeout(300);
const tex = await page.inputValue('#export-text'); await page.click('#export-close');
check(/\\raisebox\{-2\.4in\}\{\\includegraphics\[width=3\.5in,height=2\.4in\]\{PLOT0002\.wmf\.png\}\}\}/.test(tex), 'exported frame includes the plot picture');
// typeset with 5.x's macros
fs.rmSync('/tmp/plot55', { recursive: true, force: true }); fs.mkdirSync('/tmp/plot55');
fs.writeFileSync('/tmp/plot55/plot55.tex', tex);
const png = await page.evaluate(() => Array.from(window.swPictures.assets.get('PLOT0002.wmf')));
fs.writeFileSync('/tmp/plot55/PLOT0002.wmf.png', Buffer.from(png));
for (const f of fs.readdirSync('/home/claude/tex55/swmacros')) fs.copyFileSync('/home/claude/tex55/swmacros/' + f, '/tmp/plot55/' + f);
fs.copyFileSync('/home/claude/tex55/tcilatex.tex', '/tmp/plot55/tcilatex.tex');
try { execSync('xelatex -interaction=nonstopmode plot55.tex', { cwd: '/tmp/plot55', stdio: 'ignore' }); } catch (e) { /* checked below */ }
const n = fs.existsSync('/tmp/plot55/plot55.pdf') ? execSync('pdfimages -list plot55.pdf', { cwd: '/tmp/plot55' }).toString().split('\n').filter((l) => /^\s*\d+\s+\d+\s+image\b/.test(l)).length : -1;
check(n === 1, 'typeset with xelatex: plot in the PDF');

// 3. .sci keeps the drawn plot
fs.writeFileSync('/tmp/plot55.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
check(/^graphics\/PLOT0002\.wmf\.png$/m.test(execSync('unzip -Z1 /tmp/plot55.sci').toString()), '.sci holds the plot as PNG');
const frameBefore = await page.evaluate(() => { let f; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image') f = n.attrs.frame; }); return f; });
await open('/tmp/plot55.sci');
const after = await page.evaluate(() => { let a; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image') a = n.attrs; }); return a; });
check(after.frame === frameBefore && after.plot && after.src && after.path === 'PLOT0002.wmf', 'reopened: same frame, picture shown without drawing again');

check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
