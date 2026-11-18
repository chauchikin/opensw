// Text tags (A11): small caps, sans, underline, sizes, colours, 5.x \QTR.  node test/styles.mjs
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
const styled = () => page.evaluate(() => { const l = []; window.swEditor.state.doc.descendants((n) => { if (n.isText && n.marks.length) l.push(n.text + ':' + n.marks.map((m) => m.type.name + (m.attrs.size || m.attrs.color ? '=' + (m.attrs.size || m.attrs.color) : '')).join('+')); }); return l.join(' | '); });

await open('test/fixtures/styles.tex');
const st = await styled();
check(st === 'Small Caps:smallcaps | sans:sans | under:underline | big:size=large | small:size=footnotesize | red:color=red | blue:color=blue | tagged bold:bold | tagged large:size=Large', st);
const tex = await exportTex();
check(['\\textsc{Small Caps}', '\\textsf{sans}', '\\underline{under}', '{\\large big}', '{\\footnotesize small}', '\\textcolor{red}{red}', '\\textcolor{blue}{blue}', '\\textbf{tagged bold}', '{\\Large tagged large}'].every((x) => tex.includes(x)), 'written back');
fs.rmSync('/tmp/styles', { recursive: true, force: true }); fs.mkdirSync('/tmp/styles');
fs.writeFileSync('/tmp/styles/s.tex', tex);
try { execSync('xelatex -interaction=nonstopmode s.tex', { cwd: '/tmp/styles', stdio: 'ignore' }); } catch (e) { /* below */ }
check(fs.existsSync('/tmp/styles/s.pdf'), 'typesets');
const before = await docJSON();
fs.writeFileSync('/tmp/styles.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
await open('/tmp/styles.sci');
check(await docJSON() === before, 'same after .sci round trip');
check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
