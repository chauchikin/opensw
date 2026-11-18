// Insert > HTML Field, Go > Follow Link / Back / Forward, Edit > Copy as Picture.
// node test/menus3.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 1024, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:4173' });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const open = async (file) => {
  await page.setInputFiles('#file', file);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1500);
};
const htmlFields = () => page.evaluate(() => { const o = []; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'html_field') o.push(n.attrs.html); }); return o; });

// 1. HTML field: inserted from the menu, in the HTML export only, kept in .sci and 5.x .tex
await call('set', { latex: 'Before after.' });
await page.evaluate(() => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(window.swNodeSelection.near(v.state.doc.resolve(8)))); v.focus(); });
await menu('插入', 'HTML 欄位…');
await page.fill('#d-html', '<b class="hf">hi</b>');
await page.click('#dialog-ok');
check((await htmlFields()).join() === '<b class="hf">hi</b>', 'HTML field inserted');
check(await page.isVisible('.html-field'), 'shown in the page as a field');
const html = await page.evaluate(() => window.swHtmlForTests());
check(html.includes('<b class="hf">hi</b>'), 'HTML export: the HTML as it is');
await page.click('#btn-latex'); await page.waitForTimeout(300);
const tex = await page.inputValue('#export-text'); await page.click('#export-close');
check(!/hf|HTML/.test(tex.split('\\begin{document}')[1]), 'LaTeX export: left out');
fs.writeFileSync('/tmp/hf.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
const t55 = Buffer.from(await page.evaluate(() => window.swTex55ForTests())).toString('latin1');
check(/%TCIMACRO\{\\HTML\{<b class="hf">hi<\/b>\}\}%\n%BeginExpansion\n%EndExpansion\n/.test(t55.replace(/\r\n/g, '\n')), '5.x .tex: written as a TCI macro');
fs.writeFileSync('/tmp/hf55.tex', t55);
await open('/tmp/hf.sci');
check((await htmlFields()).join() === '<b class="hf">hi</b>', '.sci: the field comes back');
await open('/tmp/hf55.tex');
check((await htmlFields()).join() === '<b class="hf">hi</b>', '5.x .tex: the field comes back');
check(await page.evaluate(() => window.swEditor.state.doc.textContent.replace(/\s+/g, ' ').trim()) === 'Before after.', '5.x .tex: the text around it unchanged');

// 2. links and the places jumped from
await call('set', { latex: '\\section{One}\nSee \\hyperref[far]{the far place}.\n\n\\section{Two}\nText.\n\n\\section{Three}\nHere\\label{far} it is.' });
await page.waitForTimeout(300);
const linkPos = await page.evaluate(() => { let p; window.swEditor.state.doc.descendants((n, pos) => { if (n.isText && n.marks.some((m) => m.type.name === 'link')) p = pos + 2; }); return p; });
await page.evaluate((p) => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(window.swNodeSelection.near(v.state.doc.resolve(p)))); v.focus(); }, linkPos);
const where = () => page.evaluate(() => window.swEditor.state.selection.$from.parent.textContent);
await menu('前往', '連結');
check(/Here/.test(await where()), 'Follow Link: to the marker');
await menu('前往', '上一個位置');
check(/See/.test(await where()), 'Back: to the link');
await menu('前往', '下一個位置');
check(/Here/.test(await where()), 'Forward: to the marker again');
await menu('前往', '上一節');
check(/Three/.test(await where()), 'Previous Section: the heading of this section');
await menu('前往', '上一個位置');
check(/Here/.test(await where()), 'Back after a section jump');

// 3. Copy as Picture
await call('set', { latex: 'Let $\\frac{a}{b}+\\sqrt{x}$.' });
await page.evaluate(() => document.querySelectorAll('.math-inline')[0]._mathView.enter(false));
await menu('編輯', '複製成圖片');
await page.waitForTimeout(800);
const clip = await page.evaluate(async () => {
  const items = await navigator.clipboard.read();
  const blob = await items[0].getType('image/png');
  const img = new Image(); img.src = URL.createObjectURL(blob); await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) dark++;
  return { types: items[0].types, w: img.width, h: img.height, dark, url: c.toDataURL() };
});
check(clip.types.includes('image/png') && clip.w > 100 && clip.h > 60, `formula on the clipboard as PNG (${clip.w}×${clip.h})`);
check(clip.dark > 300, `the formula is drawn (${clip.dark} dark pixels)`);
fs.writeFileSync('/tmp/copied-formula.png', Buffer.from(clip.url.split(',')[1], 'base64'));

// a plot (a picture) selected
await call('set', { latex: 'Plot $\\sin x$.' });
await page.evaluate(() => document.querySelectorAll('.math-inline')[0]._mathView.enter(false));
await menu('計算', '繪圖 2D', '直角座標');
await page.waitForFunction(() => [...document.querySelectorAll('.image img')].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 60000 });
await page.evaluate(() => { const v = window.swEditor; let p = null; v.state.doc.descendants((n, pos) => { if (n.type.name === 'image') p = pos; }); v.dispatch(v.state.tr.setSelection(window.swNodeSelection.create(v.state.doc, p))); });
await menu('編輯', '複製成圖片');
await page.waitForTimeout(800);
const pic = await page.evaluate(async () => { const it = (await navigator.clipboard.read())[0]; const img = new Image(); img.src = URL.createObjectURL(await it.getType('image/png')); await img.decode(); return [img.width, img.height]; });
check(pic[0] === 288 && pic[1] === 192, `selected plot on the clipboard (${pic.join('×')})`);

check(!errs.length, 'no page errors ' + errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
