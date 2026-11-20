// Saving as a Scientific Word 5.x .tex (A18): the file opens again as the same
// document, keeps its preamble and code page, and typesets with 5.x's macros.
// node test/save55.mjs [more 5.x files ...]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
const extra = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const open = async (file) => {
  await page.setInputFiles('#file', file);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1500);
};
// the document without what opening adds on its own (picture memory)
const docJSON = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()).replace(/"src":"blob:[^"]*"/g, '"src":null'));
fs.rmSync('/tmp/save55', { recursive: true, force: true }); fs.mkdirSync('/tmp/save55');
for (const f of fs.readdirSync('src-tauri/tex55')) fs.copyFileSync('src-tauri/tex55/' + f, '/tmp/save55/' + f);
fs.copyFileSync('src-tauri/tex55/tcilatex.tex', '/tmp/save55/tcilatex.tex');
for (const f of fs.existsSync('src-tauri/tex55/fb') ? fs.readdirSync('src-tauri/tex55/fb') : []) if (!fs.existsSync('/tmp/save55/' + f)) fs.copyFileSync('src-tauri/tex55/fb/' + f, '/tmp/save55/' + f);

const files = ['test/fixtures/big5.tex', 'test/fixtures/pictures/frame55.tex', 'test/fixtures/links55.tex', 'test/fixtures/paras.tex', 'test/fixtures/cites.tex', 'test/fixtures/misc.tex', ...extra];
for (const f of files) {
  const name = path.basename(f, '.tex');
  await open(f);
  const before = await docJSON();
  const bytes = Buffer.from(await page.evaluate(() => window.swTex55ForTests()));
  const out = `/tmp/save55/${name.replace(/\s+/g, '_')}.tex`;
  fs.writeFileSync(out, bytes);
  await open(out);
  check(await docJSON() === before, `${name}: opens again as the same document`);
  // the preamble written by 5.x comes back as it was (comments included)
  const orig = fs.readFileSync(f, 'latin1').replace(/\r\n?/g, '\n');
  // (a file that needs a code page it did not name gets 5.5's first line saying which)
  const saved = bytes.toString('latin1').replace(/\r\n?/g, '\n').replace(/^%2multibyte Version: [\d.]+ CodePage: \d+\n(?!%2multibyte)/, (m) => (orig.startsWith('%2multibyte') ? m : ''));
  const pre = (s) => s.slice(0, s.indexOf('\\begin{document}')).trimEnd();
  // a 5.x file keeps its preamble; plain LaTeX gets 5.x's, with its own class and packages
  if (/\\input\{tcilatex\}|%TCIDATA/.test(orig)) check(saved.startsWith(pre(orig)), `${name}: preamble kept`);
  else check(saved.includes('\\input{tcilatex}') && saved.includes((orig.match(/\\documentclass[^\n]*/) || [''])[0]), `${name}: 5.x preamble with its class`);
  if (/\\input\{tcilatex\}/.test(saved) && bytes.every((x) => x < 128)) { // xelatex reads UTF-8; 5.x reads its code page
    try { execSync(`xelatex -interaction=nonstopmode "${path.basename(out)}"`, { cwd: '/tmp/save55', stdio: 'ignore', timeout: 120000 }); } catch (e) { /* below */ }
    check(fs.existsSync(out.replace(/\.tex$/, '.pdf')), `${name}: typesets with 5.x's macros`);
  }
}
// Big5: Chinese written in code page 950, a character Big5 lacks as \U{...}
const big5 = fs.readFileSync('/tmp/save55/big5.tex');
check(big5.includes(Buffer.from([0xa4, 0xa4, 0xa4, 0xe5])) && big5.toString('latin1').includes('\\U{20BB7}') && /CodePage: 950/.test(big5.toString('latin1')), 'big5: 中文 in Big5, 𠮷 as \\U{20BB7}');

// a .sci document saved for 5.x gets 5.x's preamble
await open('test/fixtures/sw6/SW_Book_1.sci');
const t = Buffer.from(await page.evaluate(() => window.swTex55ForTests())).toString('latin1').replace(/\r\n/g, '\n');
check(/^%% This document created by opensw\n\n\\documentclass\{book\}[^]*%TCIDATA\{OutputFilter=LATEX\.DLL\}[^]*\\input\{tcilatex\}/.test(t), '.sci document: 5.x preamble made');
fs.writeFileSync('/tmp/save55/book.tex', t);
try { execSync('xelatex -interaction=nonstopmode book.tex', { cwd: '/tmp/save55', stdio: 'ignore', timeout: 120000 }); } catch (e) { /* below */ }
check(fs.existsSync('/tmp/save55/book.pdf'), '.sci document saved for 5.x typesets with 5.x macros');

check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
