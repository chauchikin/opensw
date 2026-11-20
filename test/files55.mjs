// File > Open Location, Import / Save Fragment and the Fragments toolbar, Page Setup and
// Preview.  node test/files55.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };

// a web server with a 5.x document (as a site that lets pages read it)
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(req.url.slice(1));
  if (name === 'page.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<p>a web page</p>'); return; }
  const file = { 'doc.tex': 'test/fixtures/misc.tex', 'doc.txt': 'test/fixtures/misc.tex' }[name];
  if (!file) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end(); return; }
  res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(4180, r));

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1200, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(600);
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const text = () => page.evaluate(() => window.swEditor.state.doc.textContent);
const maths = () => page.evaluate(() => { const l = []; window.swEditor.state.doc.descendants((n) => { if (n.type.name.startsWith('math')) l.push(n.attrs.latex); }); return l; });
const expected = (await (async () => {
  await page.setInputFiles('#file', 'test/fixtures/misc.tex');
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1000);
  return text();
})());

// 1. Open Location
const openLoc = async (url) => {
  await call('set', { latex: 'Something else.' });
  await menu('檔案', '開啟網址…');
  await page.fill('#d-url', url);
  await page.click('#dialog-ok');
  await page.waitForTimeout(300);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1200);
};
await openLoc('http://localhost:4180/doc.tex');
check((await text()) === expected, 'a .tex at a web address opens as the 5.x document');
await openLoc('http://localhost:4180/doc.txt as .tex');
check((await text()) === expected, '"address as .tex" opens a file without that ending');
await openLoc('http://localhost:4180/missing.tex');
check((await text()) === 'Something else.' && /讀不到這個網址/.test(await page.textContent('#toast')), 'a missing file: message, the document stays');
const popup = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
await menu('檔案', '開啟網址…');
await page.fill('#d-url', 'http://localhost:4180/page.html');
await page.click('#dialog-ok');
const p = await popup;
if (p) await p.waitForLoadState('domcontentloaded').catch(() => {});
check(p && p.url() === 'http://localhost:4180/page.html', 'another address opens in the browser');
if (p) await p.close();
await menu('檔案', '開啟網址…');
check(await page.evaluate(() => [...document.querySelectorAll('#d-urls option')].map((o) => o.value)).then((l) => l[0] === 'http://localhost:4180/page.html' && l.includes('http://localhost:4180/doc.tex')), 'recent addresses listed');
await page.click('#dialog-cancel');

// 2. Fragments: save the selection, insert it from the toolbar list and from the dialog
await call('set', { latex: 'Area $\\pi r^{2}$ of a disc.' });
await page.evaluate(() => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(window.swTextSelection.create(v.state.doc, 1, v.state.doc.content.size - 1))); });
await menu('檔案', '存成片段…');
await page.fill('#d-name', 'disc');
await page.click('#dialog-ok');
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('opensw-fragments')).disc);
check(stored === 'Area $\\pi r^{2}$ of a disc.', 'saved as 5.x LaTeX: ' + stored);
await call('set', { latex: 'Start: ' });
await page.evaluate(() => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(window.swTextSelection.atEnd(v.state.doc))); v.focus(); });
check(await page.evaluate(() => [...document.querySelectorAll('#frag-select option')].some((o) => o.value === 'disc')), 'Fragments toolbar lists it');
await page.selectOption('#frag-select', 'disc');
await page.waitForTimeout(200);
check((await text()).includes('Area') && (await maths()).includes('\\pi r^{2}'), 'inserted from the toolbar, with its formula');
await page.selectOption('#frag-select', '常數/光速');
await page.waitForTimeout(200);
check((await maths()).some((m) => /2\.99792458/.test(m)), 'a built-in constant inserted');
// a 5.5 .frg file added from the dialog
fs.writeFileSync('/tmp/Sum rule.frg', '$\\sum_{k=1}^{n}k=\\frac{n\\left( n+1\\right) }{2}$');
await menu('檔案', '匯入片段…');
const chooser = page.waitForEvent('filechooser');
await page.click('#d-frag-file');
await (await chooser).setFiles('/tmp/Sum rule.frg');
await page.waitForTimeout(400);
await page.selectOption('#d-frag', 'Sum rule');
await page.click('#dialog-ok');
await page.waitForTimeout(200);
check((await maths()).some((m) => /\\sum/.test(m)), '.frg file added and inserted');
// deleting: own fragments only
await menu('檔案', '匯入片段…');
await page.selectOption('#d-frag', 'disc');
await page.click('#d-frag-del');
check(!(await page.evaluate(() => 'disc' in JSON.parse(localStorage.getItem('opensw-fragments')))), 'own fragment deleted');
await page.selectOption('#d-frag', '常數/光速');
await page.click('#d-frag-del');
check(/內建/.test(await page.textContent('#toast')), 'built-in fragment kept');
await page.click('#dialog-cancel');

// 3. Page Setup and Preview
await call('set', { latex: Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} with some words to fill the page and more words.`).join('\n\n') });
await menu('檔案', '版面設定…');
await page.fill('#d-t', '1.5'); await page.fill('#d-l', '0.5');
await page.fill('#d-head', 'My header'); await page.fill('#d-foot', 'My footer');
await page.selectOption('#d-num', 'bottom-right'); await page.selectOption('#d-style', 'lower-roman');
await page.click('#dialog-ok');
const html = await page.evaluate(() => window.swPrintHtmlForTests());
check(/@page \{ size: letter; margin: 1\.5in 1in 1in 0\.5in;/.test(html) && /@top-center \{ content: "My header"/.test(html) && /@bottom-right \{ content: counter\(page, lower-roman\)/.test(html), 'page CSS: margins, header, roman page number');
// printed as the system would: header, footer and page numbers on each page
const pp = await b.newPage();
await pp.setContent(html);
await pp.pdf({ path: '/tmp/preview.pdf', preferCSSPageSize: true });
await pp.close();
const pdfText = execSync('pdftotext -layout /tmp/preview.pdf -').toString();
const pages = pdfText.split('\f').filter((t) => t.trim());
check(pages.length >= 2 && pages.every((t) => t.includes('My header') && t.includes('My footer')) && /\bii\b/.test(pages[1]), `printed: ${pages.length} pages with header, footer, page ii`);
const size = execSync('pdfinfo /tmp/preview.pdf').toString().match(/Page size:\s+([\d.]+) x ([\d.]+)/);
check(size && Math.round(+size[1]) === 612 && Math.round(+size[2]) === 792, 'letter paper');
// Preview: the page goes to the print dialog through a frame
await page.evaluate(() => { window.__printed = 0; const f = HTMLIFrameElement.prototype; const d = Object.getOwnPropertyDescriptor(f, 'contentWindow'); Object.defineProperty(f, 'contentWindow', { get() { const w = d.get.call(this); if (w) w.print = () => { window.__printed++; }; return w; } }); });
await menu('檔案', '列印…');
await page.waitForTimeout(800);
check(await page.evaluate(() => window.__printed === 1), 'Preview opens the print preview');

check(!errs.length, 'no page errors ' + errs);
await b.close();
server.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
