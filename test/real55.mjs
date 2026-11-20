// What real Scientific Word 5.5 lecture notes do (test/fixtures/real55.tex, made from
// patterns met in a teacher's files): tables inside formulas, "\ " closing a formula,
// \\[2pt], "\" at a line end, an empty \author{} before a centered block, \date, --,
// and formula parts MathLive does not know. Each must show without errors and come
// back the same after saving as 5.x and as .sci. Also: a document with many formulas
// opens fast (pictures first, editable fields near the screen).  node test/real55.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what, detail) => { console.log(ok ? 'ok  ' : 'FAIL', what, ok || detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)); if (!ok) fails++; };
const open = async (file) => {
  await page.setInputFiles('#file', file);
  for (let i = 0; i < 3; i++) { if (await page.isVisible('#confirm')) await page.click('#confirm-ok'); await page.waitForTimeout(150); }
  await page.waitForTimeout(1200);
};
const docJSON = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()).replace(/"src":"blob:[^"]*"/g, '"src":null'));
const maths = () => page.evaluate(() => { const l = []; window.swEditor.state.doc.descendants((n) => { if (n.type.name.startsWith('math')) l.push(n.attrs.latex); }); return l; });
const text = () => page.evaluate(() => window.swEditor.state.doc.textContent);

await open('test/fixtures/real55.tex');
const m = await maths();
check(m.length === 15, 'fifteen formulas', m);
check(m.some((l) => l.startsWith('\\begin{tabular}{l}') && l.includes('g_{1}(x)') && l.endsWith('\\end{tabular}')), 'a table inside $..$ stays one formula', m);
check(m.includes('f(x)=\\sqrt{x}\\ '), 'a formula closing with "\\ " keeps it', m);
const t = await text();
check(t.includes('at the equally spaced points'), 'the text after it is text');
check(t.includes('on the direction ') && / Recall from calculus/.test(t), '"\\" at a line end is a space, not a TeX field', t.slice(0, 400));
check(t.includes('4:10–6:00'), '-- is an en dash');
check(!t.includes('0pt]') && !t.includes('2pt]'), '\\\\[2pt] is a line break, not a display');
check(/\\proof/.test(await page.evaluate(() => { let t = ''; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'tex_field') t += n.attrs.tex + '|'; }); return t; })) && t.includes('Let '), '"\\proof%" then "Let" on a later line: two things, not \\proofLet');
const tbl = await page.evaluate(() => { let a = null; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'table') a = n.attrs; }); return a; });
check(tbl && tbl.inline && tbl.pos === 't', 'a table inside a paragraph is marked so, [t] kept', tbl);
check(m.some((l) => l.includes('\\TEXTsymbol{\\backslash}op')), '\\TEXTsymbol stays as written in a formula', m);
const title = await page.evaluate(() => { const n = window.swEditor.state.doc.firstChild; return { type: n.type.name, date: n.attrs.date, br: n.content.content.some((c) => c.type.name === 'hard_break') }; });
check(title.type === 'title' && title.date === 'Feb. 22, 2021' && title.br, 'title keeps its line break and date', title);
const bad = await page.evaluate(() => [...document.querySelectorAll('math-field')].filter((mf) => mf.shadowRoot?.querySelector('.ML__error')).map((mf) => mf.value));
check(bad.length === 0, 'every formula shows without errors', bad);

// clicking into a formula and leaving without typing keeps what 5.x wrote
await page.click('.math-display math-field');
await page.waitForTimeout(200);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check(JSON.stringify(await maths()) === JSON.stringify(m), 'visiting a formula does not rewrite it');

// saved as 5.x and as .sci: the same document again
const before = await docJSON();
fs.rmSync('/tmp/real55', { recursive: true, force: true }); fs.mkdirSync('/tmp/real55');
const bytes = Buffer.from(await page.evaluate(() => window.swTex55ForTests()));
fs.writeFileSync('/tmp/real55/saved.tex', bytes);
const saved = bytes.toString('latin1');
check(saved.includes('\\date{Feb. 22, 2021}') && saved.includes('4:10--6:00') && saved.includes('\\author{}') && saved.includes('Some University'), '5.x file: date, --, empty author, centered block');
await open('/tmp/real55/saved.tex');
check(await docJSON() === before, 'saved as 5.x: opens again as the same document');
await open('test/fixtures/real55.tex');
const sci = await page.evaluate(() => window.swSaveSci());
fs.writeFileSync('/tmp/real55/saved.sci', Buffer.from(sci, 'base64'));
await open('/tmp/real55/saved.sci');
check(await docJSON() === before, 'saved as .sci: opens again as the same document');
const docx = await page.evaluate(async () => { try { return (await window.swDocxForTests()).length; } catch (e) { return e.message; } });
check(typeof docx === 'number' && docx > 1000, 'exports as Word (.docx)', docx);

// typesets with 5.x's macros
if (fs.existsSync('src-tauri/tex55/tcilatex.tex')) {
  await open('test/fixtures/real55.tex');
  await page.click('#btn-latex'); await page.waitForTimeout(300);
  fs.writeFileSync('/tmp/real55/doc.tex', await page.inputValue('#export-text'));
  await page.click('#export-close');
  for (const f of fs.readdirSync('src-tauri/tex55')) fs.copyFileSync('src-tauri/tex55/' + f, '/tmp/real55/' + f);
  fs.copyFileSync('src-tauri/tex55/tcilatex.tex', '/tmp/real55/tcilatex.tex');
  try { execSync('xelatex -interaction=nonstopmode -halt-on-error doc.tex', { cwd: '/tmp/real55', stdio: 'ignore', timeout: 120000 }); } catch (e) { /* below */ }
  check(fs.existsSync('/tmp/real55/doc.pdf'), 'typesets with 5.x macros');
  const log = fs.existsSync('/tmp/real55/doc.log') ? fs.readFileSync('/tmp/real55/doc.log', 'latin1') : '';
  check(!/^! /m.test(log), 'no TeX errors (theorems the style made are not made again)', (log.match(/^! .*/m) || [])[0]);
  const ex = fs.readFileSync('/tmp/real55/doc.tex', 'utf8');
  check(/\\\]\n\\\[/.test(ex), 'displays one after another stay in one paragraph');
  check(/\\begin\{tabular\}\[t\]/.test(ex) && /\\end\{tabular\}\n\$/.test(ex), 'the table goes back into its text line, [t] kept');
}

// a document starting with {\huge A} and {\Large B} lines in a center: two lines, not one heading
await page.evaluate(() => window.sw.call('set', { latex: '\\begin{center}\n{\\huge Series Computation}\n\n\\medskip\n\n{\\Large 1. Basic Arithmetic}\n\\end{center}\n\nText.' }));
const head = await page.evaluate(() => window.swEditor.state.doc.textContent);
check(head.includes('Series Computation') && head.includes('1. Basic Arithmetic'), 'two big lines in a center both kept', head);

// many formulas: shown as pictures at once, editable near the screen and when used
const many = Array.from({ length: 400 }, (_, i) => `Item ${i}: $x_{${i}}^{2}+\\frac{1}{${i + 1}}$ and $\\sqrt{${i}}$.`).join('\n\n');
const t0 = Date.now();
await page.evaluate((latex) => window.sw.call('set', { latex }), many);
const ms = Date.now() - t0;
await page.waitForTimeout(800);
const c1 = await page.evaluate(() => ({ st: document.querySelectorAll('.math-static').length, mf: document.querySelectorAll('math-field').length }));
check(c1.st > 600 && c1.mf > 0 && c1.mf < 200, '800 formulas: pictures, the ones on screen editable', c1);
check(ms < 15000, `800 formulas shown in ${ms} ms`);
await page.evaluate(() => document.querySelectorAll('.math-static')[500].scrollIntoView({ block: 'center' }));
await page.waitForTimeout(600);
const c2 = await page.evaluate(() => document.querySelectorAll('math-field').length);
check(c2 > c1.mf, 'scrolling makes more of them editable', [c1.mf, c2]);
const r = await page.evaluate(() => window.sw.call('setFormula', { n: 790, latex: 'y=1' }));
const f790 = await page.evaluate(() => window.sw.call('formulas'));
check(r.ok && f790.result[790].latex === 'y=1', 'a formula still a picture can be changed', f790.result[790]);
const shown = await page.evaluate(() => { const el = [...document.querySelectorAll('.math-static')].pop(); return el ? el.textContent : null; });
check(shown === null || !/x_\{/.test(shown), 'pictures show the formula, not its LaTeX', shown);

check(!errs.length, 'no page errors', errs);
await b.close();
process.exit(fails ? 1 : 0);
