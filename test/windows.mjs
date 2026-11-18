// Window menu (B): several documents open, switch, close.  node test/windows.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const menuItems = async () => { await page.click('.menu-top:has-text("視窗")'); const l = await page.$$eval('.menu-list button > span', (s) => s.map((x) => x.textContent)); await page.keyboard.press('Escape'); await page.click('#editor'); return l; };
const text = () => page.evaluate(() => window.swEditor.state.doc.textContent.slice(0, 30));
await page.setInputFiles('#file', 'test/fixtures/tables.tex'); await page.waitForTimeout(1000);
// change it, then open another: the first stays open
await page.click('#editor .ProseMirror > p'); await page.keyboard.press('End'); await page.keyboard.type(' edited');
await page.setInputFiles('#file', 'test/fixtures/notes.tex'); await page.waitForTimeout(1000);
check(!(await page.isVisible('#confirm')), 'opening does not ask: the edited document stays open');
let items = await menuItems();
check(items[0] === '✓ notes' && items.some((x) => /tables \*/.test(x)), 'Window menu lists both: ' + items.join(' | '));
check(/^Text with a footnote/.test(await text()), 'notes on screen');
await page.keyboard.press('Control+F6');
check(/Data/.test(await text()), 'Ctrl+F6 brings tables back');
check(await page.evaluate(() => window.swEditor.state.doc.textContent.includes('edited')), 'with its edit kept');
check(await page.evaluate(() => document.title) === 'tables * - opensw', 'title shows name and changed mark: ' + await page.evaluate(() => document.title));
// close the edited one: asks; then the other one is on screen
await page.keyboard.press('Control+F4');
check(await page.isVisible('#confirm'), 'closing an edited document asks first');
await page.click('#confirm-ok');
check(/^Text with a footnote/.test(await text()), 'after closing, the other document is on screen');
items = await menuItems();
check(items.filter((x) => !/下一個/.test(x)).length === 1, 'one document left: ' + items.join(' | '));
check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
