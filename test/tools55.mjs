// Tools > Automatic Substitution, User Setup, Export Settings, Document Manager (package a
// document with its pictures; open a .zip package or a 5.5 wrapped .rap file).
// node test/tools55.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import fs from 'node:fs';
import JSZip from 'jszip';
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const FIX = 'test/fixtures/pictures/';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(600);
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const maths = () => page.evaluate(() => { const l = []; window.swEditor.state.doc.descendants((n) => { if (n.type.name.startsWith('math')) l.push(n.attrs.latex); }); return l; });
// types into a new formula at the end of "x " and leaves it
const typeFormula = async (keys) => {
  await call('set', { latex: 'x $y$' });
  await page.evaluate(() => document.querySelectorAll('.math-inline')[0]._mathView.enter(false));
  await page.waitForTimeout(150);
  await page.keyboard.type(keys, { delay: 30 });
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  return (await maths())[0];
};

// 1. Automatic Substitution
await menu('工具', '自動替換…');
await page.fill('#d-keys', 'sum10'); await page.fill('#d-latex', '\\sum_{n=1}^{10}');
await page.click('#d-sub-save');
check(await page.evaluate(() => [...document.querySelectorAll('#d-list option')].some((o) => o.value === 'sum10')), 'substitution listed');
await page.click('#dialog-ok');
let l = await typeFormula('+sum10');
check(/\\sum_\{n=1\}\^\{10\}/.test(l), 'typing sum10 in a formula puts in the sum: ' + l);
l = await typeFormula('+alpha');
check(/\\alpha/.test(l), 'built-in substitution (alpha) still on: ' + l);
await menu('工具', '自動替換…');
await page.uncheck('#d-on');
await page.click('#dialog-ok');
l = await typeFormula('+alpha');
check(!/\\alpha|\\sum/.test(l) && /alpha/.test(l.replace(/[\\{}]|mathrm|text/g, '')), 'turned off: letters stay letters: ' + l);
await menu('工具', '自動替換…');
await page.check('#d-on');
await page.click('#dialog-ok');

// 2. User Setup
await menu('工具', '使用者設定…');
await page.fill('#d-mr', '4'); await page.fill('#d-mc', '5'); await page.fill('#d-tr', '2'); await page.fill('#d-tc', '6');
await page.selectOption('#d-start', 'blank'); await page.uncheck('#d-bak'); await page.selectOption('#d-color', '#000000');
await page.click('#dialog-ok');
const s = await page.evaluate(() => JSON.parse(localStorage.getItem('opensw-settings')));
check(s.matrix.join() === '4,5' && s.table.join() === '2,6' && s.startup === 'blank' && s.backup === false && s.mathColor === '#000000', 'settings kept');
check(await page.evaluate(() => getComputedStyle(document.querySelector('math-field')).color) === 'rgb(0, 0, 0)', 'formulas drawn in the chosen colour');
await call('set', { latex: 'Some text.' });
await menu('插入', '表格…');
check(await page.inputValue('#d-rows') === '2' && await page.inputValue('#d-cols') === '6', 'Insert > Table: the default size');
await page.click('#dialog-cancel');
await page.evaluate(() => document.querySelector('.ProseMirror').focus());
await menu('插入', '矩陣…');
check(await page.inputValue('#matrix-rows') === '4' && await page.inputValue('#matrix-cols') === '5', 'Insert > Matrix: the default size');
await page.click('#matrix-cancel');
await page.reload(); await page.waitForTimeout(800);
check(await page.evaluate(() => window.swEditor.state.doc.textContent === ''), 'start-up document: blank');

// 3. Export Settings
await call('set', { latex: 'Area $\\pi r^{2}$.\n\n\\[ x=1 \\]' });
await menu('工具', '匯出設定…');
await page.selectOption('#d-hm', 'mathjax'); await page.selectOption('#d-scale', '2');
await page.click('#dialog-ok');
let html = await page.evaluate(() => window.swHtmlForTests());
check(/\\\(\\pi r\^\{2\}\\\)/.test(html) && /\\\[x=1\\\]|\\\[ ?x ?= ?1 ?\\\]/.test(html) && /mathjax@3/.test(html) && !/<math/.test(html), 'HTML with MathJax: \\( \\) and \\[ \\], the script');
await menu('工具', '匯出設定…');
await page.selectOption('#d-hm', 'mathml');
await page.click('#dialog-ok');
html = await page.evaluate(() => window.swHtmlForTests());
check(/<math/.test(html) && !/mathjax/.test(html), 'back to MathML');

// 4. Document Manager: a 5.x document whose picture is not here (a web page cannot read the disk)
await page.setInputFiles('#file', FIX + 'frame55.tex');
if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
await page.waitForTimeout(1000);
await menu('工具', '文件管理…');
const rows = await page.$$eval('.dm-files tr', (trs) => trs.slice(1).map((t) => t.textContent));
check(rows.some((r) => /圖片dot\.png找不到/.test(r)) && rows.some((r) => /繪圖/.test(r)), 'files listed: the picture is missing, the plot');
await page.click('#dialog-cancel');
// a package with the picture opens with it
const zip = new JSZip();
zip.file('frame55.tex', fs.readFileSync(FIX + 'frame55.tex'));
zip.file('graphics/dot.png', fs.readFileSync(FIX + 'graphics/dot.png'));
fs.writeFileSync('/tmp/frame55.zip', await zip.generateAsync({ type: 'nodebuffer' }));
const openPack = async (file) => {
  await menu('工具', '文件管理…');
  const chooser = page.waitForEvent('filechooser');
  await page.click('#d-unpack');
  await (await chooser).setFiles(file);
  await page.waitForTimeout(500);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1500);
};
await openPack('/tmp/frame55.zip');
const shown = await page.evaluate(() => [...document.querySelectorAll('.image img')].filter((i) => i.complete && i.naturalWidth > 0 && /^blob:/.test(i.src)).length);
check(shown >= 2 && /frame55/.test(await page.textContent('#toast')), `package opened, the pictures shown (${shown})`);
// packing: .sci, 5.x .tex and the picture
await page.evaluate(async (data) => { await window.swPictures.importPicture(new File([new Uint8Array(data)], 'square.gif', { type: 'image/gif' })); }, [...fs.readFileSync(FIX + 'square.gif')]);
await menu('工具', '文件管理…');
const dl = page.waitForEvent('download');
await page.click('#d-pack');
const d = await dl;
await d.saveAs('/tmp/pack.zip');
const z = await JSZip.loadAsync(fs.readFileSync('/tmp/pack.zip'));
const names = Object.keys(z.files).sort();
check(names.includes('frame55.sci') && names.includes('frame55.tex') && names.includes('dot.png') && names.includes('square.gif'), 'package: ' + names.join(', '));
const tex = await z.file('frame55.tex').async('string');
check(/\\FRAME\{[^}]*\}[^]*\{dot\.png\}/.test(tex) && /square\.gif/.test(tex), 'the .tex names the pictures as they are in the package');
// the package opens again
await openPack('/tmp/pack.zip');
check(await page.evaluate(() => [...document.querySelectorAll('.image img')].filter((i) => i.complete && i.naturalWidth > 0).length) >= 3, 'the package opens again with its pictures (from the .sci)');

// a 5.5 wrapped file (.rap): the document and a picture written as text
const png = fs.readFileSync(FIX + 'graphics/dot.png');
const rap = ['%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%',
  '%              Scientific Word   Wrap/Unwrap  Version 3.0             %',
  '% Files included:                                                     %',
  '% "/document/wrapped.tex", Document, 300, 9/22/2004, 21:33:31, ""%',
  '% "/document/dot.png", Graphic, 100, 9/22/2004, 21:33:31, ""%',
  '%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%', '',
  '%%%%%%%%%%%% Start /document/wrapped.tex %%%%%%%%%%%%', '', '',
  '\\documentclass{article}', '\\input{tcilatex}', '\\begin{document}', '', 'Wrapped text $\\alpha+1$ and a dot \\FRAME{itbpF}{0.5in}{0.5in}{0in}{}{}{dot.png}{\\special{language "Scientific Word";type "GRAPHIC";display "USEDEF";valid_file "F";width 0.5in;height 0.5in;filename \'dot.png\';}}', '', '\\end{document}', '',
  '%%%%%%%%%%%%% End /document/wrapped.tex %%%%%%%%%%%%%', '',
  '%%%%%%%%%%%% Start /document/dot.png %%%%%%%%%%%%', png.toString('base64').match(/.{1,60}/g).join('\n'), '%%%%%%%%%%%%% End /document/dot.png %%%%%%%%%%%%%', ''].join('\r\n');
fs.writeFileSync('/tmp/wrapped.rap', rap);
await openPack('/tmp/wrapped.rap');
check(await page.evaluate(() => window.swEditor.state.doc.textContent.includes('Wrapped text')) && (await maths()).includes('\\alpha+1'), '.rap: the document opened');
check(await page.evaluate(() => [...document.querySelectorAll('.image img')].some((i) => i.complete && i.naturalWidth > 0)), '.rap: its picture shown');

check(!errs.length, 'no page errors ' + errs);
await page.evaluate(() => localStorage.removeItem('opensw-settings'));
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
