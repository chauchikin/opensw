// Citations and bibliographies (A6).  node test/cites.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
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
const exportTex = async () => { await page.click('#btn-latex'); await page.waitForTimeout(300); const t = await page.inputValue('#export-text'); await page.click('#export-close'); return t; };
const shown = () => page.evaluate(() => [...document.querySelectorAll('.cite-cite')].map((e) => e.getAttribute('data-num') + (e.classList.contains('xref-missing') ? '!' : '')));
const docJSON = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()));

await open('test/fixtures/cites.tex');
check((await shown()).join('|') === '[1]|[L94, 1, p. 5]|[?]!', 'citations numbered from the list; unknown key marked: ' + (await shown()).join('|'));
check(await page.evaluate(() => [...document.querySelectorAll('.bib-item')].map((e) => e.getAttribute('data-num')).join()) === '1,L94', 'list items numbered (own label kept)');
check(await page.isVisible('.cite-nocite'), '\\nocite kept (shown greyed)');
const tex = await exportTex();
check(/\\cite\{knuth\}/.test(tex) && /\\cite\[p\.~5\]\{lamport,knuth\}/.test(tex) && /\\nocite\{extra\}/.test(tex)
  && /\\begin\{thebibliography\}\{9\}[^]*\\bibitem\{knuth\} D\. Knuth[^]*\\bibitem\[L94\]\{lamport\}[^]*\\end\{thebibliography\}/.test(tex), 'written back as LaTeX');
fs.rmSync('/tmp/cites', { recursive: true, force: true }); fs.mkdirSync('/tmp/cites');
fs.writeFileSync('/tmp/cites/c.tex', tex);
try { execSync('xelatex -interaction=nonstopmode c.tex; xelatex -interaction=nonstopmode c.tex', { cwd: '/tmp/cites', stdio: 'ignore' }); } catch (e) { /* checked below */ }
const pdf = fs.existsSync('/tmp/cites/c.pdf') ? execSync('pdftotext c.pdf -', { cwd: '/tmp/cites' }).toString() : '';
check(/As shown in \[1\] and \[L94, 1, p\. 5\]/.test(pdf), 'xelatex prints the same numbers');
const before = await docJSON();
fs.writeFileSync('/tmp/cites.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
await open('/tmp/cites.sci');
check(await docJSON() === before, 'same document after .sci round trip');

await open('test/fixtures/bibtex.tex');
check(await page.evaluate(() => document.querySelector('.bibtex')?.textContent) === '參考文獻（BibTeX：refs,more，樣式 alpha）', 'BibTeX block read');
check((await shown()).join() === '[a1]', 'with BibTeX the key is shown');
const tex2 = await exportTex();
check(/\\bibliographystyle\{alpha\}\n\\bibliography\{refs,more\}/.test(tex2), 'BibTeX commands written back');
const before2 = await docJSON();
fs.writeFileSync('/tmp/bibtex.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
await open('/tmp/bibtex.sci');
check(await docJSON() === before2, 'BibTeX document same after .sci round trip');

check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
