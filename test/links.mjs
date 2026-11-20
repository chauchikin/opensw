// Links (A7): \href, \url, \hyperref (package and 5.x form).  node test/links.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
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
const links = () => page.evaluate(() => { const l = []; window.swEditor.state.doc.descendants((n) => { const m = n.marks.find((x) => x.type.name === 'link'); if (m) l.push([n.text, m.attrs.href, m.attrs.kind, m.attrs.sw5 && m.attrs.sw5.before]); }); return l; });
const docJSON = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()));

await open('test/fixtures/links.tex');
const l = await links();
check(JSON.stringify(l) === JSON.stringify([['the site', 'https://example.com/a_b#x', null, null], ['https://example.org', 'https://example.org', 'url', null], ['the start', '#sec:start', null, null]]), 'three links read: ' + JSON.stringify(l));
const tex = await exportTex();
check(tex.includes('\\href{https://example.com/a\\_b\\#x}{the site}') && tex.includes('\\url{https://example.org}') && tex.includes('\\hyperref[sec:start]{the start}'), 'written back as \\href, \\url, \\hyperref');
fs.rmSync('/tmp/links', { recursive: true, force: true }); fs.mkdirSync('/tmp/links');
fs.writeFileSync('/tmp/links/l.tex', tex);
try { execSync('xelatex -interaction=nonstopmode l.tex', { cwd: '/tmp/links', stdio: 'ignore' }); } catch (e) { /* below */ }
check(fs.existsSync('/tmp/links/l.pdf') && /the site/.test(execSync('pdftotext /tmp/links/l.pdf -').toString()), 'typesets');
let before = await docJSON();
fs.writeFileSync('/tmp/links.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
await open('/tmp/links.sci');
check(await docJSON() === before, 'same after .sci round trip');

await open('test/fixtures/links55.tex');
check(JSON.stringify(await links()) === JSON.stringify([['section one', '#one', null, 'Section ']]), '5.x hypertext link read');
const tex55 = await exportTex();
check(tex55.includes('\\hyperref{section one}{Section }{ above}{one}'), '5.x link written back as it was');
fs.writeFileSync('/tmp/links/l55.tex', tex55);
for (const f of fs.readdirSync('src-tauri/tex55')) fs.copyFileSync('src-tauri/tex55/' + f, '/tmp/links/' + f);
fs.copyFileSync('src-tauri/tex55/tcilatex.tex', '/tmp/links/tcilatex.tex');
try { execSync('xelatex -interaction=nonstopmode l55.tex; xelatex -interaction=nonstopmode l55.tex', { cwd: '/tmp/links', stdio: 'ignore' }); } catch (e) { /* below */ }
check(/See Section 1 above please/.test(fs.existsSync('/tmp/links/l55.pdf') ? execSync('pdftotext /tmp/links/l55.pdf -').toString() : ''), '5.x link typesets as "Section 1 above"');
before = await docJSON();
fs.writeFileSync('/tmp/links55.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
await open('/tmp/links55.sci');
check(await docJSON() === before, '5.x link same after .sci round trip');

check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
