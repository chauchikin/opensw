// The 5.x files opensw writes with what this round added (animated plots, Document Info,
// Front Matter, Options and Packages, Bibliography Choice, Spacing, Typeset Objects, Label,
// Math Name, Decoration, Operator, Save Definitions, Compute Settings as document values, Fill
// and Random Matrix, answers of Rewrite, Statistics, Matrices), one file each, in /tmp/check55
// (or the folder given), to be opened with real 5.5:
//   node test/c55_check55.mjs [folder]   then on Windows: scripts\open55batch.ps1 -dir <folder>
// Here each file is only checked to be read back by opensw the same way (no 5.5 needed).
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = process.argv[2] || '/tmp/check55';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
let page;
const errs = [];
// a new browser context each time: nothing kept from the document before (the page keeps its
// last document and its Document Info, preamble and definitions in local storage)
const newPage = async () => {
  if (page) await page.context().close();
  page = await (await b.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  page.on('pageerror', (e) => errs.push(e.message));
};
await newPage();
const URL = `http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`;
await page.goto(URL); await page.waitForTimeout(700);
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const tex55 = async () => Buffer.from(await page.evaluate(() => window.swTex55ForTests()));
const docText = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()));
const enter = async (i = 0) => { await page.evaluate((k) => document.querySelectorAll('.math-inline, .math-display')[k]._mathView.enter(false), i); await page.waitForTimeout(150); };
const leave = () => page.evaluate(() => document.querySelectorAll('.math-inline, .math-display').forEach((m) => m._mathView?.exit?.(1)));
const toEnd = () => page.evaluate(() => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.atEnd(v.state.doc))); v.focus(); });
const until = async (re, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await docText())) return true; await page.waitForTimeout(300); } return false; };
// a fresh document (nothing kept from the one before: Document Info, preamble, definitions)
const fresh = async (latex) => {
  await newPage();
  await page.goto(URL); await page.waitForTimeout(700);
  await call('set', { latex });
  await page.waitForTimeout(300);
};
// write it as 5.x, read it back in opensw: the same text and as many formulas and pictures
const save = async (name, want) => {
  const bytes = await tex55();
  fs.writeFileSync(`${OUT}/${name}.tex`, bytes);
  const before = await page.evaluate(() => { let f = 0, p = 0; window.swEditor.state.doc.descendants((n) => { if (/^math/.test(n.type.name)) f++; if (n.type.name === 'image') p++; }); return [f, p, window.swEditor.state.doc.textContent.replace(/\s+/g, '')]; });
  await page.setInputFiles('#file', `${OUT}/${name}.tex`); await page.waitForTimeout(1200);
  const after = await page.evaluate(() => { let f = 0, p = 0; window.swEditor.state.doc.descendants((n) => { if (/^math/.test(n.type.name)) f++; if (n.type.name === 'image') p++; }); return [f, p, window.swEditor.state.doc.textContent.replace(/\s+/g, '')]; });
  const t = bytes.toString('latin1');
  check(JSON.stringify(before) === JSON.stringify(after) && (!want || want.test(t)), `${name}: written${want ? ' with ' + want : ''} and read back the same (formulas ${after[0]}, pictures ${after[1]})`);
};

// animated plots (Plot 2D / 3D Animated, Plot Approximate Integral Animated)
const animate = async (name, latex, items) => {
  await fresh(`Plot $${latex}$.`);
  await enter(0);
  await menu('Compute', ...items);
  await page.waitForFunction(() => { const s = document.querySelector('.anim-ctl .anim-frame'); return s && !s.disabled; }, null, { timeout: 240000 });
  await save(name, /animated TRUE/);
};
await animate('anim2d', '\\sin \\left( x+t\\right) ', ['Plot 2D Animated', 'Rectangular']);
await animate('anim3d', 'x^{2}+txy', ['Plot 3D Animated', 'Rectangular']);
await animate('animapprox', 'x^{2}', ['Calculus', 'Plot Approximate Integral Animated']);

// File > Document Info: title and a link
await fresh('Text $x$ here.\\label{spot}');
await menu('File', 'Document Info...');
await page.fill('#d-title', 'My notes');
await page.click('#dialog details summary');
await page.fill('#d-l-next', 'spot');
await page.click('#dialog-ok');
await save('docinfo', /%TCIDATA\{<META NAME="Title" CONTENT="My notes">\}/);

// Typeset > Front Matter
await fresh('Body $x$.');
await menu('Typeset', 'Front Matter...');
await page.fill('#d-title', 'A Title');
await page.fill('#d-author', 'Someone');
await page.fill('#d-f-keywords', 'algebra');
await page.click('#dialog-ok');
await save('frontmatter', /\\title\{A Title\}\r?\n\\author\{Someone\}\r?\n\\keywords\{algebra\}\r?\n\\maketitle/); // as 5.x: front matter before \maketitle (5.5 shows it only in Typeset > Front Matter)

// Typeset > Options and Packages, Bibliography Choice
await fresh('Body $x$.');
await menu('Typeset', 'Options and Packages...');
await page.fill('#d-o', '12pt');
await page.fill('#d-p', 'amsmath\n[margin=1in]geometry');
await page.click('#dialog-ok');
await menu('Typeset', 'Bibliography Choice...');
await page.check('input[name="d-b"][value="BibTeX"]');
await page.click('#dialog-ok');
await save('options', /\\documentclass\[12pt\]/);

// Insert > Spacing (horizontal, vertical, rule, break)
await fresh('First paragraph $x$.\n\nSecond paragraph.');
await toEnd();
await menu('Insert', 'Spacing', 'Vertical Space...'); await page.click('#dialog-ok');
await menu('Insert', 'Spacing', 'Rule...'); await page.click('#dialog-ok');
await menu('Insert', 'Spacing', 'Break...'); await page.check('input[name="d-br"][value="newpage"]'); await page.click('#dialog-ok');
await menu('Insert', 'Spacing', 'Horizontal Space...'); await page.check('input[name="d-sp"][value="custom"]'); await page.fill('#d-w', '2cm'); await page.click('#dialog-ok');
await save('spacing', /\\newpage/);

// Insert > Typeset Object: Subdocument, Bibliography, Hypertext Target and Reference
await fresh('A place\\label{spot} to go.\n\nSecond paragraph.');
await toEnd();
await menu('Insert', 'Typeset Object', 'Hypertext Target...'); await page.fill('#d-key', 'here'); await page.click('#dialog-ok');
await toEnd();
await menu('Insert', 'Typeset Object', 'Hypertext Reference...'); await page.fill('#d-text', 'go there'); await page.click('#dialog-ok');
await toEnd();
await menu('Insert', 'Typeset Object', 'Bibliography...'); await page.fill('#d-files', 'refs.bib'); await page.click('#dialog-ok');
await save('typesetobj', /\\hyperref\{go there\}/);
await fresh('Main text.');
await toEnd();
await menu('Insert', 'Typeset Object', 'Subdocument...'); await page.fill('#d-file', 'chapter1.tex'); await page.click('#dialog-ok');
await save('subdoc', /\\QSubDoc\{Include chapter1\}/);

// Insert > Label, Math Name (a name of one's own), Decoration, Operator
await fresh('Formula $x$ here.');
await enter(0);
await page.keyboard.press('End');
await menu('Insert', 'Operator...'); await page.click('#dialog .pick55 button[title="\\\\sum"]');
await menu('Insert', 'Math Name...'); await page.fill('#d-name', 'sgn'); await page.click('#dialog-ok');
await menu('Insert', 'Label...'); await page.click('#dialog-ok');
await menu('Insert', 'Decoration...'); await page.click('#dialog-ok');
await leave();
await save('mathinsert', /\\func\{sgn\}/);

// Compute > Definitions > Save Definitions; Compute > Settings as this document's values
await fresh('Define $a=7$ and $f\\left( x\\right) =x^{2}+1$; root $\\sqrt{2}$.');
await call('compute', { latex: 'a=7', op: 'define' });
await call('compute', { latex: 'f\\left( x\\right) =x^{2}+1', op: 'define' });
await enter(2);
await menu('Compute', 'Settings...');
await page.check('input[name="d-gs"][value="doc"]');
await page.fill('#d-dig', '8');
await page.click('#dialog-ok');
await enter(0);
await menu('Compute', 'Definitions', 'Save Definitions');
await page.waitForTimeout(500);
await save('defs', /%TCIDATA\{ComputeDefs=/);
const defsTex = fs.readFileSync(`${OUT}/defs.tex`, 'latin1');
check(/%TCIDATA\{ComputeGeneralSettings=[\d,]+\}/.test(defsTex), 'defs: ComputeGeneralSettings written');

// Fill Matrix, Random Matrix
await fresh('Matrix $\\left(\\right)$ and text.');
await page.evaluate(() => { const mv = document.querySelectorAll('.math-inline')[0]._mathView; mv.enter(true); mv.mf.executeCommand('moveToNextChar'); });
await menu('Compute', 'Matrices', 'Fill Matrix...');
await page.check('input[name=d-fill][value=jordan]');
await page.fill('#d-r', '3'); await page.fill('#d-c', '3'); await page.fill('#d-item', 'x');
let before = await docText();
await page.click('#dialog-ok');
check(await until(/x\s*&\s*1/), 'Fill Matrix put in');
await leave();
await toEnd();
await menu('Compute', 'Matrices', 'Random Matrix...');
await page.fill('#d-r', '2'); await page.fill('#d-c', '3');
before = await docText();
await page.click('#dialog-ok');
{ const t0 = Date.now(); while (Date.now() - t0 < 60000 && (await docText()) === before) await page.waitForTimeout(300); }
await page.waitForTimeout(500);
await save('matrices', /x & 1 & 0/);

// answers put in the document: Rewrite, Statistics, Matrices
await fresh('Rewrite $3+5i$, mean $\\begin{pmatrix}1 & 2 \\\\ 3 & 5\\end{pmatrix}$, PLU $\\begin{pmatrix}0 & 1 \\\\ 2 & 3\\end{pmatrix}$, eigenvectors $\\begin{pmatrix}2 & 1 \\\\ 1 & 2\\end{pmatrix}$, combine $\\sin x\\cos y+\\cos x\\sin y$.');
// the formula whose LaTeX matches re (the answers put in move the others along)
const at = (re) => page.evaluate((src) => [...document.querySelectorAll('.math-inline, .math-display')].findIndex((m) => new RegExp(src).test((m._mathView?.mf?.getValue?.('latex') || '').replace(/\s/g, ''))), re.source);
const run = async (re, items, done) => {
  const i = await at(re);
  const before = await docText();
  await enter(i); await menu('Compute', ...items);
  const t0 = Date.now(); while (Date.now() - t0 < 120000 && (await docText()) === before) await page.waitForTimeout(300);
  await page.waitForTimeout(500);
  check(i >= 0 && done.test(await docText()), items.join(' > ') + ' answered');
  await leave();
};
await run(/^3\+5i$/, ['Rewrite', 'Polar'], /arctan/);
await run(/1&2\\\\3&5/, ['Statistics', 'Mean'], /Mean/);
await run(/0&1\\\\2&3/, ['Matrices', 'PLU Decomposition'], /2&3\\\\0&1|2 & 3\\\\\\\\ 0 & 1/);
await run(/2&1\\\\1&2/, ['Matrices', 'Eigenvectors'], /eigenvectors/);
await run(/sinx\\cosy/, ['Combine', 'Trig Functions'], /sin\s*\\\\left\(x\+y|sin\s*\(x\+y/);
await save('answers');

// 5.5's own files, read and saved again
for (const [name, f] of [['anim55_resaved', 'test/fixtures/pictures/anim55.tex'], ['defs55_resaved', 'test/fixtures/defs55.tex']]) {
  await newPage();
  await page.goto(URL); await page.waitForTimeout(700);
  await page.setInputFiles('#file', f); await page.waitForTimeout(3000);
  fs.writeFileSync(`${OUT}/${name}.tex`, await tex55());
  check(fs.statSync(`${OUT}/${name}.tex`).size > 500, `${name}: written`);
}

check(!errs.length, 'no page errors ' + errs);
console.log(fs.readdirSync(OUT).join(' '));
await b.close();
process.exit(fails ? 1 : 0);
