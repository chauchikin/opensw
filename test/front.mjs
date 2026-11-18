// Front matter and document structure (A9, A10): title, date, abstract, contents,
// quotations, appendix.  node test/front.mjs
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
const docJSON = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()));

await open('test/fixtures/front.tex');
const kinds = await page.evaluate(() => { const l = []; window.swEditor.state.doc.forEach((n) => l.push(n.type.name + (n.attrs.kind ? ':' + n.attrs.kind : ''))); return l.join(' '); });
check(kinds === 'title env:centered env:abstract toc:tableofcontents heading paragraph env:quote appendix heading paragraph', 'blocks: ' + kinds);
check(await page.evaluate(() => [...document.querySelectorAll('.xref')].map((e) => e.getAttribute('data-num')).join()) === 'A,1', 'after \\appendix the section is A');
const tex = await exportTex();
check(/\\date\{\\today\}/.test(tex) && /\\begin\{abstract\}\nWe study things\.\n\\end\{abstract\}/.test(tex) && /\\tableofcontents/.test(tex)
  && /\\begin\{quote\}\nPremature optimization\.\n\\end\{quote\}/.test(tex) && /\\appendix/.test(tex) && !/newtheorem\{(abstract|quote)\}/.test(tex), 'written back; no theorem made for abstract or quote');
fs.rmSync('/tmp/front', { recursive: true, force: true }); fs.mkdirSync('/tmp/front');
fs.writeFileSync('/tmp/front/f.tex', tex);
try { execSync('xelatex -interaction=nonstopmode f.tex; xelatex -interaction=nonstopmode f.tex', { cwd: '/tmp/front', stdio: 'ignore' }); } catch (e) { /* below */ }
const pdf = fs.existsSync('/tmp/front/f.pdf') ? execSync('pdftotext /tmp/front/f.pdf -').toString() : '';
check(/Abstract/.test(pdf) && /Contents/.test(pdf) && /See Section A and 1/.test(pdf), 'typesets: abstract, contents, appendix numbering');
const before = await docJSON();
fs.writeFileSync('/tmp/front.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
await open('/tmp/front.sci');
check(await docJSON() === before, 'same after .sci round trip');

check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
