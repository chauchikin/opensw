// Pictures (A3): 5.x \FRAME, \includegraphics, .sci pictures; import, properties, export.
// node test/pictures.mjs  (needs `npx vite preview --port 4173`, xelatex, and /home/claude/tex55/tcilatex.tex)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const FIX = 'test/fixtures/pictures/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/'); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const open = async (file) => {
  await page.setInputFiles('#file', file);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1200);
};
const images = () => page.evaluate(() => { const l = []; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image') l.push(n.attrs); }); return l; });
const exportTex = async () => { await page.click('#btn-latex'); await page.waitForTimeout(300); const t = await page.inputValue('#export-text'); await page.click('#export-close'); return t; };
const provide = (path, file) => page.evaluate(([p, data]) => window.swPictures.assets.set(p, new Uint8Array(data)), [path, [...fs.readFileSync(file)]]);
const menu = async (top, item) => { await page.click(`.menu-top:has-text("${top}")`); await page.click(`.menu-list button:has(> span:text-is("${item}"))`); };

// 1. a 5.x document with frames
await open(FIX + 'frame55.tex');
let im = await images();
check(im.length === 3 && im.map((a) => a.place).join() === 'inline,float,display', 'three frames: inline, floating, displayed');
check(im[0].width === 48 && im[1].caption === 'A red dot' && im[1].label === 'fig:dot' && im[2].plot && im[2].path === 'PLOT0001.wmf', 'sizes, caption, label, plot snapshot name');
check(await page.evaluate(() => document.querySelectorAll('.image-missing').length) === 3, 'files not at hand: three placeholder boxes');
check(await page.evaluate(() => document.querySelector('.image.place-float')?.getAttribute('data-num')) === '圖 1', 'floating frame numbered 圖 1');
check(await page.evaluate(() => document.querySelector('.xref')?.getAttribute('data-num')) === '1', 'reference to the frame resolves');
const plain = await exportTex();
check((plain.match(/\\FRAME\{/g) || []).length === 3 && !/includegraphics/.test(plain), 'without files: frames written as they were');

// the desktop app finds dot.png next to the document (simulated here)
await provide('dot.png', FIX + 'graphics/dot.png');
await page.evaluate(() => window.swPictures.loadPictures(null));
await page.waitForTimeout(400); // the pictures decode
check(await page.evaluate(() => [...document.querySelectorAll('.image img')].filter((i) => i.complete && i.naturalWidth > 0).length) === 2, 'found picture shown twice');
const tex = await exportTex();
check((tex.match(/\\raisebox\{-[^}]+\}\{\\includegraphics\[width=[^,]+,height=[^\]]+\]\{dot\.png\}\}/g) || []).length === 2 && /\\usepackage\{graphicx\}/.test(tex), 'with the file: \\includegraphics added to both dot frames');
check(tex.includes(im[2].frame), 'plot frame unchanged');
// typeset it with 5.x's macros, the picture next to it
fs.rmSync('/tmp/pic55', { recursive: true, force: true }); fs.mkdirSync('/tmp/pic55');
fs.writeFileSync('/tmp/pic55/frame55.tex', tex);
fs.copyFileSync(FIX + 'graphics/dot.png', '/tmp/pic55/dot.png');
for (const f of fs.readdirSync('/home/claude/tex55/swmacros')) fs.copyFileSync('/home/claude/tex55/swmacros/' + f, '/tmp/pic55/' + f);
fs.copyFileSync('/home/claude/tex55/tcilatex.tex', '/tmp/pic55/tcilatex.tex');
try { execSync('xelatex -interaction=nonstopmode frame55.tex && xelatex -interaction=nonstopmode frame55.tex', { cwd: '/tmp/pic55', stdio: 'ignore' }); } catch (e) { /* checked below */ }
const imgs = fs.existsSync('/tmp/pic55/frame55.pdf') ? execSync('pdfimages -list frame55.pdf', { cwd: '/tmp/pic55' }).toString().trim().split('\n').length - 2 : -1;
const pdfText = fs.existsSync('/tmp/pic55/frame55.pdf') ? execSync('pdftotext frame55.pdf -', { cwd: '/tmp/pic55' }).toString() : '';
check(imgs === 2 && /Figure 1: A red dot/.test(pdfText) && /See Figure 1/.test(pdfText), `typeset with xelatex: ${imgs} pictures, caption and reference`);

// 2. saved as .sci and opened again: picture inside the .sci, frames kept
const before = (await images()).map(({ src, ...a }) => a);
fs.writeFileSync('/tmp/pictures.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
const zipNames = execSync('unzip -Z1 /tmp/pictures.sci').toString();
check(/^graphics\/dot\.png$/m.test(zipNames), '.sci holds graphics/dot.png');
await open('/tmp/pictures.sci');
await page.waitForTimeout(400);
const after = (await images()).map(({ src, ...a }) => a);
check(JSON.stringify(after) === JSON.stringify(before), 'same pictures after .sci round trip');
check(await page.evaluate(() => [...document.querySelectorAll('.image img')].filter((i) => i.complete && i.naturalWidth > 0).length) === 2, 'pictures shown from the .sci');

// 3. File > Import Picture (a GIF), Properties: floating with caption, export
await menu('檔案', '新增');
if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
await page.waitForTimeout(300);
await page.click('#editor .ProseMirror');
await page.evaluate(async (data) => { await window.swPictures.importPicture(new File([new Uint8Array(data)], 'square.gif', { type: 'image/gif' })); }, [...fs.readFileSync(FIX + 'square.gif')]);
im = await images();
check(im.length === 1 && im[0].width === 120 && im[0].height === 80 && im[0].src, 'imported GIF at its own size');
await page.evaluate(() => { const v = window.swEditor; let p = null; v.state.doc.descendants((n, pos) => { if (n.type.name === 'image') p = pos; }); v.dispatch(v.state.tr.setSelection(window.swNodeSelection.create(v.state.doc, p))); });
await page.keyboard.press('Control+F5');
await page.fill('#d-w', '2in');
await page.selectOption('#d-place', 'float');
await page.fill('#d-cap', 'Blue square'); await page.fill('#d-key', 'fig:sq');
await page.click('#dialog-ok');
im = await images();
check(im[0].width === 192 && im[0].height === 128 && im[0].place === 'float', 'properties: 2in wide keeps the shape, floating');
const tex3 = await exportTex();
check(/\\begin\{figure\}\n\\centering\n\\includegraphics\[width=2in,height=1\.3333in\]\{square\.gif\.png\}\n\\caption\{Blue square\}\\label\{fig:sq\}\n\\end\{figure\}/.test(tex3), 'exported as figure; the GIF goes to TeX as PNG');
const files = await page.evaluate(async () => (await window.swPictures.texPictureFiles()).list.map((f) => [f.name, f.data[1], f.data[2], f.data[3]]));
check(files.length === 1 && files[0][0] === 'square.gif.png' && String.fromCharCode(files[0][1], files[0][2], files[0][3]) === 'PNG', 'TeX run gets square.gif.png as PNG');

// 4. LaTeX with \includegraphics and a figure
await open(FIX + 'include.tex');
im = await images();
check(im.length === 2 && im[0].path === 'graphics/dot.png' && im[0].width === 96 && im[0].opts === 'width=1in', '\\includegraphics read with its options');
check(await page.evaluate(() => document.querySelector('.xref')?.getAttribute('data-num')) === '1', 'figure reference resolves');
await provide('graphics/dot.png', FIX + 'graphics/dot.png');
const tex4 = await exportTex();
check(/\\includegraphics\[width=1in\]\{graphics\/dot\.png\}/.test(tex4) && /\\includegraphics\[width=2in\]\{graphics\/dot\.png\}/.test(tex4), 'options written back as they were');

check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
