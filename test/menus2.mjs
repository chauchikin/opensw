// More 5.5 menu commands (B): Insert > TeX Field, Go > Marker, Typeset > Preamble,
// Compute > Plot 2D > Rectangular, File > Save As.  node test/menus2.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/'); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.click(`.menu-list button:has(> span:text-is("${it}"))`);
};
const exportTex = async () => { await page.click('#btn-latex'); await page.waitForTimeout(300); const t = await page.inputValue('#export-text'); await page.click('#export-close'); return t; };
await page.evaluate(() => window.sw.call('set', { latex: 'Intro text.\n\n\\section{A}\\label{sa}\n\nThe square $x^2-1$ here.\n\n' + 'More text.\n\n'.repeat(40) }));
await page.waitForTimeout(500);

// Insert > TeX Field
await page.click('#editor .ProseMirror > p'); await page.keyboard.press('End');
await menu('插入', 'TeX 欄位…');
await page.fill('#d-tex', '\\vspace{1cm}');
await page.click('#dialog-ok');
check(await page.evaluate(() => { let t; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'tex_field') t = n.attrs.tex; }); return t; }) === '\\vspace{1cm}', 'TeX field inserted');

// Go > Marker
await page.evaluate(() => { document.querySelector('#scroller').scrollTop = 99999; });
await menu('前往', '標記…');
await page.click('#dialog-ok');
await page.waitForTimeout(300);
const near = await page.evaluate(() => { const s = window.swEditor.state.selection; return s.$from.parent.textContent; });
check(near === 'A', 'Go > Marker moves to the marker: ' + near);

// Typeset > Preamble
await menu('排版', '導言…');
await page.fill('#d-pre', '\\newcommand{\\R}{\\mathbb{R}}');
await page.click('#dialog-ok');
check((await exportTex()).includes('\\newcommand{\\R}{\\mathbb{R}}'), 'preamble goes into the LaTeX');

// Compute > Plot 2D > Rectangular on x^2-1
await page.click('.math-inline math-field');
await page.waitForTimeout(200);
await menu('計算', '繪圖 2D', '直角座標');
for (let i = 0; i < 60 && !(await page.evaluate(() => [...document.querySelectorAll('.image img')].some((im) => im.naturalWidth > 0))); i++) await page.waitForTimeout(500);
check(await page.evaluate(() => [...document.querySelectorAll('.image img')].some((im) => im.naturalWidth > 0)), 'plot drawn after the formula');
const svg = await page.evaluate(async () => (await (await fetch(document.querySelector('.image img').src)).text()));
check(/stroke="#ff0000"/.test(svg) && (svg.match(/[ML]/g) || []).length > 90, 'red curve with its points');
const tex = await exportTex();
check(/\\includegraphics\[width=3in,height=2in\]\{opensw-plot-1\.wmf\.png\}/.test(tex), 'plot exported as a picture for TeX');
// the plot's Properties: colour, a second function, the window
await page.evaluate(() => { const v = window.swEditor; let p = null; v.state.doc.descendants((n, pos) => { if (n.type.name === 'image') p = pos; }); v.dispatch(v.state.tr.setSelection(window.swNodeSelection.create(v.state.doc, p))); });
await page.keyboard.press('Control+F5');
await page.selectOption('#d-c0', '#0000ff');
await page.fill('#d-fnew', '\\cos x');
await page.fill('#d-x0', '0'); await page.fill('#d-x1', '6');
await page.click('#dialog-ok');
let svg2 = '';
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(500);
  svg2 = await page.evaluate(async () => { const im = document.querySelector('.image img'); return im ? (await (await fetch(im.src)).text()) : ''; });
  if (/stroke="#0000ff"/.test(svg2)) break;
}
check(/stroke="#0000ff"/.test(svg2) && (svg2.match(/fill="none" stroke="#/g) || []).length === 2, 'plot properties: blue curve and a second function');
check(/xviewmin "0";xviewmax "6"/.test(await page.evaluate(() => { let f; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image') f = n.attrs.frame; }); return f; })), 'new window written into the frame');
// Compute > Definitions
await page.evaluate(() => window.sw.call('set', { latex: 'Let $a=3$ and $f(x)=x^2+1$, then $f(a)$.' }));
await page.waitForTimeout(400);
for (const k of [0, 1]) {
  await page.evaluate((i) => document.querySelectorAll('.math-inline')[i]._mathView.enter(false), k);
  await menu('計算', '定義', '新定義');
  await page.waitForFunction(() => /已定義/.test(document.querySelector('#toast')?.textContent || ''), null, { timeout: 30000 });
  await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
}
await page.evaluate(() => document.querySelectorAll('.math-inline')[2]._mathView.enter(false));
await page.keyboard.press('Control+e');
await page.waitForFunction(() => JSON.stringify(window.swEditor.state.doc.toJSON()).includes('=10'), null, { timeout: 30000 }).catch(() => {});
const fa = await page.evaluate(() => window.sw.call('formulas').then((r) => r.result[2].latex.replace(/\s/g, '')));
check(fa === 'f(a)=10', 'definitions used: ' + fa);
await menu('計算', '定義', '清除定義');
// View: hide markers
await page.evaluate(() => window.sw.call('set', { latex: 'A\\label{k} B' }));
await page.waitForTimeout(300);
await menu('檢視', '　標記'.replace('　', '✓ '));
check(await page.evaluate(() => getComputedStyle(document.querySelector('.marker')).display) === 'none', 'View: markers hidden');
await menu('檢視', '　標記');
check(await page.evaluate(() => getComputedStyle(document.querySelector('.marker')).display) !== 'none', 'View: markers shown again');
// File > Document Info, Typeset > Options
await menu('檔案', '文件資訊');
check(/段落/.test(await page.textContent('#dialog-body')), 'document info shown');
await page.click('#dialog-ok');
await menu('排版', '選項…');
await page.selectOption('#d-class', 'report');
await page.click('#dialog-ok');
check(/\\documentclass\{report\}/.test(await exportTex()), 'document class changed');
check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
