// Paragraph tags (A12): description lists, item labels, nested lists, verbatim,
// flush left/right.  node test/paras.mjs
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

await open('test/fixtures/paras.tex');
const kinds = await page.evaluate(() => { const l = []; window.swEditor.state.doc.forEach((n) => l.push(n.type.name + (n.attrs.kind ? ':' + n.attrs.kind : ''))); return l.join(' '); });
check(kinds === 'bullet_list:description ordered_list verbatim env:flushright env:flushleft', kinds);
const verb = await page.evaluate(() => { let t; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'verbatim') t = n.textContent; }); return t; });
check(verb === 'x  = 1   % not a comment\n  indented { }', 'verbatim text kept: ' + JSON.stringify(verb));
const tex = await exportTex();
check(/\\begin\{description\}\n\\item\[Term\] Meaning of term\.\n\\item\[Other\] Second\.\n\\end\{description\}/.test(tex)
  && /\\item\[\(a\)\] First with own label\./.test(tex) && /\\begin\{itemize\}\n\\item Nested\.\n\\end\{itemize\}/.test(tex)
  && /\\begin\{verbatim\}/.test(tex) && /\\begin\{flushright\}\nRight side\.\n\nSecond right\.\n\\end\{flushright\}/.test(tex), 'written back');
fs.rmSync('/tmp/paras', { recursive: true, force: true }); fs.mkdirSync('/tmp/paras');
fs.writeFileSync('/tmp/paras/p.tex', tex);
try { execSync('xelatex -interaction=nonstopmode p.tex', { cwd: '/tmp/paras', stdio: 'ignore' }); } catch (e) { /* below */ }
check(fs.existsSync('/tmp/paras/p.pdf'), 'typesets');
const before = await docJSON();
fs.writeFileSync('/tmp/paras.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
await open('/tmp/paras.sci');
check(await docJSON() === before, 'same after .sci round trip');
check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
