// Index entries (A8), \thanks and AMS front matter (A9), theorem titles, subdocuments (A15),
// 5.x math macros (A13).  node test/misc.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const open = async (file) => {
  await page.setInputFiles('#file', file);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1200);
};
const exportTex = async () => { await page.click('#btn-latex'); await page.waitForTimeout(300); const t = await page.inputValue('#export-text'); await page.click('#export-close'); return t; };
const docJSON = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()));
const nodes = () => page.evaluate(() => { const l = []; window.swEditor.state.doc.descendants((n) => { if (['note', 'index_entry', 'front_field', 'subdoc', 'toc', 'env'].includes(n.type.name)) l.push(n.type.name + ':' + (n.attrs.kind || n.attrs.entry || n.attrs.cmd || n.attrs.file || '') + (n.attrs.title ? '[' + n.attrs.title + ']' : '')); }); return l.join(' '); });

await open('test/fixtures/misc.tex');
const ns = await nodes();
check(ns === 'note:thanks env:centered front_field:address front_field:email env:theorem[Main] index_entry:statement!main@\\textbf{main}|textbf subdoc:chapter1 toc:printindex', ns);
check(await page.evaluate(() => [...document.querySelectorAll('math-field')].filter((mf) => mf.shadowRoot?.querySelector('.ML__error')).length) === 0, '5.x math macros shown without errors');
const tex = await exportTex();
check(['\\title{Paper\\thanks{Supported by a grant.}}', '\\address{Dept. of Math, Some University}', '\\email{a@b.edu}', '\\begin{theorem}[Main]',
  '\\index{statement!main@\\textbf{main}|textbf}', '\\input{chapter1}', '\\printindex', '\\usepackage{makeidx}', '\\makeindex'].every((x) => tex.includes(x)), 'written back as LaTeX');
const before = await docJSON();
fs.writeFileSync('/tmp/misc.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
await open('/tmp/misc.sci');
check(await docJSON() === before, 'same after .sci round trip');
check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
