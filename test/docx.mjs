// Word export (.docx): open documents, export, read back with pandoc, render with LibreOffice.
// node test/docx.mjs  (needs `npx vite preview --port 4173`, pandoc, soffice)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/'); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const open = async (file) => { await page.setInputFiles('#file', file); await page.waitForTimeout(1200); };
fs.rmSync('/tmp/docx', { recursive: true, force: true }); fs.mkdirSync('/tmp/docx');
const exportAs = async (name) => {
  fs.writeFileSync(`/tmp/docx/${name}.docx`, Buffer.from(await page.evaluate(() => window.swDocxForTests()), 'base64'));
  return execSync(`pandoc -t markdown /tmp/docx/${name}.docx`).toString();
};

await open('test/fixtures/sw6/SW_Book_1.sci');
let md = await exportAs('book');
check((md.match(/\$\$?[^$]+\$/g) || []).length > 40, 'SW_Book_1: formulas are Word equations (pandoc reads them back as math)');
await open('test/fixtures/docxmath.tex');
md = await exportAs('math');
check(md.includes('\\frac{a}{b} + \\sqrt{x} + \\sqrt[3]{y}') && md.includes('\\sum_{i = 1}^{n}i^{2}') && md.includes('\\int_{0}^{1}f(x)') && md.includes('\\lim_{n \\rightarrow \\infty}a_{n}'), 'fractions, roots, sums, integrals, limits as Word equations');
check(/E = mc\^\{2\}\$\s*\(1\)/.test(md), 'numbered display: (1)');
await open('test/fixtures/sw6/SW_Book_1.sci');
md = await exportAs('book');
check(/Head/.test(md), 'table text');
await open('test/fixtures/notes.tex');
md = await exportAs('notes');
check(/\[\^1\]/.test(md) && /The note has math \$x\^\{?2\}?\$/.test(md), 'footnotes with their formula');
await open('test/fixtures/tables.tex');
md = await exportAs('tables');
check(/merged/.test(md) && /表 1：Results of/.test(md), 'table with merged cell and caption');
await open('test/fixtures/paras.tex');
md = await exportAs('paras');
check(/Term.*Meaning of term/.test(md) && /Nested/.test(md) && /indented/.test(md), 'lists and verbatim');
await open('test/fixtures/pictures/frame55.tex');
await page.evaluate((data) => window.swPictures.assets.set('dot.png', new Uint8Array(data)), [...fs.readFileSync('test/fixtures/pictures/graphics/dot.png')]);
md = await exportAs('pics');
check((md.match(/!\[\]\(media\//g) || []).length === 2, 'both pictures inside the .docx');
// Word-compatible: LibreOffice opens and renders it
try { execSync('cd /tmp/docx && timeout 120 soffice --headless --convert-to pdf book.docx >/dev/null 2>&1'); } catch (e) { /* below */ }
check(fs.existsSync('/tmp/docx/book.pdf') && execSync('pdfinfo /tmp/docx/book.pdf').toString().includes('Pages'), 'LibreOffice renders the .docx');
check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
