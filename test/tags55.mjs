// Tag > Function Keys (which tag F2 … F12 apply) and Tag > Appearance (how a tag looks on screen).
// node test/tags55.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const cursorIn = (k) => page.evaluate((k) => {
  const v = window.swEditor; let at = null; let i = 0;
  v.state.doc.descendants((n, pos) => { if (n.isTextblock) { if (i === k) at = pos + 1; i++; } });
  v.dispatch(v.state.tr.setSelection(window.swNodeSelection.near(v.state.doc.resolve(at)))); v.focus();
}, k);
const blockTypes = () => page.evaluate(() => { const o = []; window.swEditor.state.doc.forEach((n) => o.push(n.type.name + (n.attrs.level != null ? n.attrs.level : '') + (n.attrs.kind ? ':' + n.attrs.kind : ''))); return o.join(' '); });

// defaults as 5.5: F11 section
await call('set', { latex: 'One.\n\nTwo.' });
await cursorIn(0);
await page.keyboard.press('F11');
check((await blockTypes()).startsWith('heading2'), 'F11 makes a section (5.5 default)');
// the menu shows each key's tag
await page.click('.menu-top:has-text("標籤")');
const items = await page.$$eval('.menu-list button', (bs) => bs.map((x) => x.textContent));
check(items.some((t) => t === '節F11') && items.some((t) => t === '粗體F5'), 'Tag menu lists the function keys');
await page.keyboard.press('Escape');
// F11 changed to Theorem
await menu('標籤', '功能鍵…');
await page.selectOption('#d-F11', 'item:theorem');
await page.click('#dialog-ok');
await cursorIn(1);
await page.keyboard.press('F11');
check(/theorem/.test(await blockTypes()), 'F11 now gives a theorem: ' + await blockTypes());
await page.click('.menu-top:has-text("標籤")');
check((await page.$$eval('.menu-list button', (bs) => bs.map((x) => x.textContent))).includes('定理F11'), 'the menu shows the new tag');
await page.keyboard.press('Escape');
// kept after reloading
await page.reload(); await page.waitForTimeout(800);
check(await page.evaluate(() => JSON.parse(localStorage.getItem('opensw-fkeys')).F11) === 'item:theorem', 'kept between sessions');
// back to 5.5's keys
await menu('標籤', '功能鍵…');
await page.check('#d-reset');
await page.click('#dialog-ok');
await call('set', { latex: 'One.' });
await cursorIn(0);
await page.keyboard.press('F11');
check((await blockTypes()).startsWith('heading2'), 'reset: F11 is a section again');

// Appearance: sections in red, 150 %, sans; text untouched in the LaTeX
await call('set', { latex: '\\section{Head}\nBody.' });
await menu('標籤', '外觀…');
await page.selectOption('#d-tag', 'block:h2');
await page.selectOption('#d-font', 'sans');
await page.fill('#d-size', '150');
await page.check('#d-hascolor');
await page.fill('#d-color', '#cc0000');
await page.click('#dialog-ok');
const look = await page.evaluate(() => { const h = document.querySelector('#editor .ProseMirror h3'); const s = getComputedStyle(h); const p = getComputedStyle(document.querySelector('#editor .ProseMirror p')); return { color: s.color, font: s.fontFamily, size: parseFloat(s.fontSize), body: parseFloat(p.fontSize) }; });
check(look.color === 'rgb(204, 0, 0)' && /Arial/.test(look.font), `section shown red and sans (${look.color}, ${look.font})`);
check(look.size > look.body * 1.3, `section shown larger (${look.size}px)`);
await page.click('#btn-latex'); await page.waitForTimeout(300);
const tex = await page.inputValue('#export-text'); await page.click('#export-close');
check(/\\section\{Head\}/.test(tex) && !/cc0000|color/.test(tex), 'LaTeX unchanged');
// another tag in the same dialog keeps the first one
await menu('標籤', '外觀…');
check(await page.inputValue('#d-size') === '', 'the dialog opens on 本文 (nothing set)');
await page.selectOption('#d-tag', 'block:h2');
await page.dispatchEvent('#d-tag', 'change');
check(await page.inputValue('#d-size') === '150', 'switching to 節 shows its settings');
await page.check('#d-clear');
await page.click('#dialog-ok');
check(await page.evaluate(() => getComputedStyle(document.querySelector('#editor .ProseMirror h3')).color) !== 'rgb(204, 0, 0)', 'reset: section colour back');

check(!errs.length, 'no page errors ' + errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
