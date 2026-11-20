// Equation numbers, markers (\label) and cross-references (\ref, \eqref).
// Run: node test/numbering.mjs   (writes test-out/numbering.tex and .pdf)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(600);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 220)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const SRC = String.raw`\documentclass{article}
\usepackage{amsmath}
\newtheorem{theorem}{Theorem}
\begin{document}
\section{Intro}\label{sec:intro}
First
\begin{equation}
a^2+b^2=c^2 \label{eq:pyth}
\end{equation}
then unnumbered
\begin{equation*}
x=1
\end{equation*}
and rows
\begin{align}
f(x) &= x^2 \label{eq:f}\\
g(x) &= x^3 \nonumber\\
h(x) &= x^4 \tag{H}
\end{align}
\begin{theorem}[Pythagoras]\label{thm:p}
See (\ref{eq:pyth}), \eqref{eq:f}, \eqref{eq:h}, Section \ref{sec:intro} and Theorem \ref{thm:p}.
\end{theorem}
\end{document}`;
let r = await call('set', { latex: SRC });
r = await call('outline');
check('outline', r.ok, r.result.map((x) => x.type));
const eqnos = await page.evaluate(() => [...document.querySelectorAll('.math-display')].map((d) => d.getAttribute('data-eqno')));
check('numbers shown next to formulas', JSON.stringify(eqnos) === JSON.stringify(['(1)', null, '(2) (H)']), eqnos);
const refs = await page.evaluate(() => [...document.querySelectorAll('.xref')].map((x) => x.getAttribute('data-num')));
check('references show numbers', JSON.stringify(refs) === JSON.stringify(['1', '(2)', '??', '1', '1']), refs);
const thm = await page.evaluate(() => { const e = document.querySelector('.env-theorem'); return e.getAttribute('data-num') + '|' + e.getAttribute('data-title'); });
check('theorem number and title', thm === '1|（Pythagoras）', thm);
r = await call('get', { format: 'latex' });
const tex = r.result;
fs.mkdirSync('test-out', { recursive: true });
fs.writeFileSync('test-out/numbering.tex', tex);
check('export: equation with label', /\\begin\{equation\}\s*a\^2\+b\^2=c\^2\\label\{eq:pyth\}\s*\\end\{equation\}/.test(tex), tex.match(/\\begin\{equation\}[^]*?\\end\{equation\}/)?.[0]);
check('export: align rows', /\\begin\{align\}[^]*\\label\{eq:f\}[^]*\\nonumber[^]*\\tag\{H\}[^]*\\end\{align\}/.test(tex), tex.match(/\\begin\{align\}[^]*?\\end\{align\}/)?.[0]);
check('export: refs, markers, title', tex.includes('\\eqref{eq:f}') && tex.includes('\\label{sec:intro}') && tex.includes('\\begin{theorem}[Pythagoras]'), '');
execSync('cd test-out && xelatex -interaction=nonstopmode numbering.tex >/dev/null 2>&1; xelatex -interaction=nonstopmode numbering.tex >/dev/null 2>&1 || true');
const pdfText = execSync('pdftotext -layout test-out/numbering.pdf - 2>/dev/null || true').toString();
check('PDF: numbers and references resolved', /\(1\)/.test(pdfText) && /\(2\)/.test(pdfText) && /\(H\)/.test(pdfText) && /See \(1\), \(2\)/.test(pdfText.replace(/\s+/g, ' ')), pdfText.replace(/\s+/g, ' ').slice(0, 300));
// .sci round trip keeps numbering, markers and references
const b64 = await page.evaluate(() => window.swSaveSci());
fs.writeFileSync('/tmp/numbering.sci', Buffer.from(b64, 'base64'));
await page.setInputFiles('#file', '/tmp/numbering.sci');
if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
await page.waitForTimeout(1000);
const eqnos2 = await page.evaluate(() => [...document.querySelectorAll('.math-display')].map((d) => d.getAttribute('data-eqno')));
const refs2 = await page.evaluate(() => [...document.querySelectorAll('.xref')].map((x) => x.getAttribute('data-num')));
check('.sci round trip keeps numbers', JSON.stringify(eqnos2) === JSON.stringify(eqnos), eqnos2);
check('.sci round trip keeps references', refs2.join(',') === refs.join(','), refs2);
// menus: a marker on an unnumbered display, then a reference to it
await call('set', { latex: 'Text before.\n\\[y=mx+b\\]\nSee .' });
await page.evaluate(() => document.querySelector('.math-display')._mathView.enter(false));
await page.click('.menu-top:has-text("插入")');
await page.click('.menu-list button:has-text("標記…")');
await page.fill('#d-key', 'line');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('marker on a display numbers it', await page.evaluate(() => document.querySelector('.math-display').getAttribute('data-eqno')) === '(1)', '');
await page.evaluate(() => { const v = window.swEditor; const p = v.state.doc.content.size - 2; v.dispatch(v.state.tr.setSelection(v.state.selection.constructor.near(v.state.doc.resolve(p)))); v.focus(); });
await page.click('.menu-top:has-text("插入")');
await page.click('.menu-list button:has-text("排版物件")');
await page.click(`.menu-list button:has(> span:text-is("交叉引用…"))`);
await page.selectOption('#d-kind', 'eqref');
await page.click('#dialog-ok');
await page.waitForTimeout(200);
check('cross reference from the menu', await page.evaluate(() => document.querySelector('.xref')?.getAttribute('data-num')) === '(1)', '');
await page.screenshot({ path: 'test-out/numbering.png' });
console.log('page errors', errs);
console.log(fails ? `${fails} FAILED` : 'all passed');
await b.close();
process.exit(fails ? 1 : 0);
