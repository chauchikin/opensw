// The toolbars docked on the right (Typeset Object, Navigate, History, Link, Field, Exam), the
// Typeset toolbar, and View > Toolbars (show / hide, remembered, reset).
// node test/toolbars.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(700);
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const groups = (where) => page.$$eval(`${where} .tb-group`, (l) => l.filter((g) => !g.hidden).map((g) => g.dataset.name));

check((await groups('#toolbar-right')).join() === '排版物件,前往,歷史,連結,欄位,考卷', 'right toolbars: ' + (await groups('#toolbar-right')).join());
const box = await page.$eval('#toolbar-right', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height }; });
check(box.x > 1150 && box.w < 60 && box.h > 400, `docked at the right edge, one column (${Math.round(box.x)}, ${Math.round(box.w)}×${Math.round(box.h)})`);
check((await groups('#toolbar')).includes('排版'), 'Typeset toolbar at the top');

// buttons do what their menu items do
await call('set', { latex: '\\section{One}\n\nText.\n\n\\section{Two}\n\nMore.' });
await page.evaluate(() => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(window.swTextSelection.create(v.state.doc, 1))); v.focus(); });
await page.click('#toolbar-right button[title="下一節"]');
await page.waitForTimeout(200);
check(await page.evaluate(() => window.swEditor.state.selection.$from.parent.textContent === 'Two'), 'Navigate: next section');
await page.click('#toolbar-right button[title="上一個位置"]');
await page.waitForTimeout(200);
check(await page.evaluate(() => window.swEditor.state.selection.$from.parent.textContent === 'One'), 'History: back to where it was');
await page.click('#toolbar-right button[title="插入超連結"]');
check(await page.isVisible('#dialog') && /超連結/.test(await page.textContent('#dialog-title')), 'Link: the hyperlink dialog');
await page.click('#dialog-cancel');
await page.click('#toolbar-right button[title="考卷公式"]');
check(await page.isVisible('#d-expr'), 'Field: the formula dialog');
await page.click('#dialog-cancel');
await page.evaluate(() => { window.__printed = 0; const f = HTMLIFrameElement.prototype; const d = Object.getOwnPropertyDescriptor(f, 'contentWindow'); Object.defineProperty(f, 'contentWindow', { get() { const w = d.get.call(this); if (w) w.print = () => { window.__printed++; }; return w; } }); });
await page.click('#toolbar button[title="預覽（不排版，可列印）"]');
await page.waitForTimeout(800);
check(await page.evaluate(() => window.__printed === 1), 'Typeset toolbar: Preview');

// View > Toolbars
await menu('檢視', '工具列…');
await page.uncheck('input[data-bar="符號面板"]'); await page.uncheck('input[data-bar="考卷"]');
await page.click('#dialog-ok');
check(!(await groups('#toolbar')).includes('符號面板') && !(await groups('#toolbar-right')).includes('考卷'), 'hidden');
await page.reload(); await page.waitForTimeout(700);
check(!(await groups('#toolbar')).includes('符號面板') && !(await groups('#toolbar-right')).includes('考卷'), 'still hidden after a reload');
await menu('檢視', '工具列…');
await page.click('#d-tb-reset');
await page.click('#dialog-ok');
check((await groups('#toolbar-right')).length === 6 && (await groups('#toolbar')).includes('符號面板'), 'reset: all shown');
// all of the right column hidden: it takes no room
await menu('檢視', '工具列…');
for (const n of ['排版物件', '前往', '歷史', '連結', '欄位', '考卷']) await page.uncheck(`input[data-bar="${n}"]`);
await page.click('#dialog-ok');
check(await page.$eval('#toolbar-right', (e) => e.getBoundingClientRect().width) === 0, 'none on the right: the column is gone');
await menu('檢視', '工具列…'); await page.click('#d-tb-reset'); await page.click('#dialog-ok');

check(!errs.length, 'no page errors ' + errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
