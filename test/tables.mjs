// Tables (A2): LaTeX tabular/table/figure and Scientific Word 6 tables open, edit, and
// survive saving as .sci.  node test/tables.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import fs from 'node:fs';
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
const docJSON = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()));

// 1. LaTeX file with tables
await open('test/fixtures/tables.tex');
const kinds = await page.evaluate(() => { const l = []; window.swEditor.state.doc.descendants((n) => { if (/table$|float_box|caption/.test(n.type.name)) l.push(n.type.name); }); return l; });
check(kinds.filter((k) => k === 'table').length === 3 && kinds.filter((k) => k === 'float_box').length === 2, 'three tables, two floats: ' + kinds.join(','));
const refs = await page.evaluate(() => [...document.querySelectorAll('.xref')].map((e) => e.getAttribute('data-num')));
check(refs.join() === '1,1', 'table and figure references resolve: ' + refs);
const caps = await page.evaluate(() => [...document.querySelectorAll('.caption')].map((e) => e.getAttribute('data-num')));
check(caps.join() === '表 1,圖 1', 'captions numbered: ' + caps);
const merged = await page.evaluate(() => document.querySelector('td[colspan="2"]')?.textContent);
check(merged === 'merged', 'merged cell shown');
const before = await docJSON();
fs.writeFileSync('/tmp/tables.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
await open('/tmp/tables.sci');
check(await docJSON() === before, 'same document after saving as .sci and opening again');

// 2. Tab moves to the next cell; typing goes into that cell
await page.click('table.sw-table td p:text-is("Name")');
await page.waitForTimeout(300);
await page.keyboard.press('Tab');
await page.keyboard.type('Z');
const second = await page.evaluate(() => document.querySelectorAll('table.sw-table td')[1].textContent);
check(second.startsWith('Z'), 'Tab moves to the next cell: ' + second);

// 3. Scientific Word 6 book sample: table frame with caption and TableKey
await open('test/fixtures/sw6/SW_Book_1.sci');
const missing = await page.evaluate(() => [...document.querySelectorAll('.xref-missing')].map((e) => e.textContent));
check(!missing.length, 'all references in SW_Book_1 resolve: ' + missing);
const tableRef = await page.evaluate(() => [...document.querySelectorAll('.xref')].find((e) => /TableKey/.test(e.outerHTML) || e.title === 'TableKey')?.getAttribute('data-num'));
const bookCap = await page.evaluate(() => document.querySelector('.caption')?.getAttribute('data-num'));
check(bookCap === '表 3.1' && (tableRef == null || tableRef === '3.1'), 'SW_Book_1 table numbered 3.1 like LaTeX: ' + bookCap + ' ref ' + tableRef);
const shape = await page.evaluate(() => { const t = document.querySelector('table.sw-table'); return t && [t.rows.length, t.rows[0].cells.length, t.rows[0].textContent]; });
check(shape && shape[0] === 4 && shape[1] === 3 && /Head/.test(shape[2]), 'SW_Book_1 table 4×3: ' + shape);
const tex = await page.evaluate(async () => { document.querySelector('#btn-latex').click(); await new Promise((r) => setTimeout(r, 300)); return document.querySelector('#export-text').value; });
check(/\\begin\{table\}[^]*\\begin\{tabular\}\{lll\}[^]*\\caption\{Table caption text here\.\}\\label\{TableKey\}/.test(tex), 'SW_Book_1 table exported as table + tabular + caption');
await page.click('#export-close');

// 4. swwelcome: centred one-column table with links
await open('test/fixtures/sw6/swwelcome.sci');
const welcome = await page.evaluate(() => { const t = document.querySelector('table.sw-table'); return t && [t.rows.length, getComputedStyle(t.rows[0].cells[0]).textAlign, !!t.querySelector('a')]; });
check(welcome && welcome[0] === 6 && welcome[1] === 'center', 'swwelcome table 6 rows, centred: ' + welcome);

// 5. Insert > Table, add a row, merge two cells, lines from Properties, export
const menu = async (top, item) => { await page.click(`.menu-top:has-text("${top}")`); await page.click(`.menu-list button:has(> span:text-is("${item}"))`); };
await menu('檔案', '新增');
if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
await page.waitForTimeout(300);
await page.click('#editor .ProseMirror');
await menu('插入', '表格…');
await page.fill('#d-rows', '2'); await page.fill('#d-cols', '3'); await page.selectOption('#d-align', 'c');
await page.click('#dialog-ok');
await page.keyboard.type('a'); await page.keyboard.press('Tab'); await page.keyboard.type('b');
await menu('編輯', '插入列…'); await page.click('#dialog-ok');
const size = await page.evaluate(() => { const t = document.querySelector('table.sw-table'); return [t.rows.length, t.rows[0].cells.length, t.rows[0].textContent]; });
check(size.join() === '3,3,ab', 'new 2×3 table, typed a b, one row inserted: ' + size);
// select the first two cells of the first row and merge
await page.evaluate(() => {
  const v = window.swEditor; const { CellSelection } = window.swTables;
  let cells = []; v.state.doc.descendants((n, pos) => { if (n.type.name === 'table_cell') cells.push(pos); });
  v.dispatch(v.state.tr.setSelection(CellSelection.create(v.state.doc, cells[0], cells[1])));
});
await menu('編輯', '合併儲存格');
check(await page.evaluate(() => document.querySelector('td[colspan="2"]') != null), 'two cells merged');
await page.click('table.sw-table tr:nth-child(2) td >> nth=1'); await page.waitForTimeout(200);
await page.keyboard.press('Control+F5');
await page.selectOption('#d-lines', 'all'); await page.click('#dialog-ok');
await menu('插入', '表格標題');
await page.keyboard.type('My table');
const tex2 = await page.evaluate(async () => { document.querySelector('#btn-latex').click(); await new Promise((r) => setTimeout(r, 300)); return document.querySelector('#export-text').value; });
await page.click('#export-close');
const tab = tex2.match(/\\begin\{table\}[^]*?\\end\{table\}/)?.[0] || '';
fs.writeFileSync('/tmp/t2/newtable.tex', tex2);
check(/\\begin\{tabular\}\{\|c\|c\|c\|\}/.test(tab) && /\\multicolumn\{2\}\{\|c\|\}\{a b\}/.test(tab) && (tab.match(/\\hline/g) || []).length === 4 && /\\caption\{My table\}/.test(tab), 'exported with lines, merged cell and caption');

check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
