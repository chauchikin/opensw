// Interface language: ?lang=en shows English everywhere outside the document, ?lang=zh-TW Chinese,
// and every Chinese text in the program has an English translation.
// node test/i18n.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) failed++; };

const keys = execFileSync(process.execPath, ['scripts/i18n-keys.mjs'], { encoding: 'utf8' });
check(/en\.json: \d+ texts, 0 to translate/.test(keys), 'every text has an English translation');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const chineseOutsideDocument = () => page.evaluate(() => {
  const found = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    if (/[一-鿿]/.test(n.nodeValue) && !n.parentElement.closest('.ProseMirror')) found.push(n.nodeValue.trim());
  }
  for (const el of document.querySelectorAll('[title], [placeholder]')) {
    for (const a of ['title', 'placeholder']) if (/[一-鿿]/.test(el.getAttribute(a) || '')) found.push(a + ': ' + el.getAttribute(a));
  }
  return found;
});

await page.goto('http://localhost:4173/?lang=en'); await page.waitForTimeout(800);
check(await page.isVisible('.menu-top:has-text("File")'), 'English: File menu');
const left = await chineseOutsideDocument();
check(!left.length, 'English: no Chinese outside the document ' + left.slice(0, 5).join(' | '));
check(await page.evaluate(() => document.documentElement.lang) === 'en', 'English: <html lang="en">');
// a dialog made by the program
await page.click('.menu-top:has-text("Tools")');
await page.locator('.menu-list button:has(> span:text-is("User setup…"))').filter({ visible: true }).first().click();
check(await page.isVisible('#dialog:has-text("Interface language")'), 'English: User setup dialog');
const inDialog = await chineseOutsideDocument();
check(inDialog.every((t) => t === '繁體中文'), 'English: dialog has no Chinese but the language name ' + inDialog.slice(0, 5).join(' | '));
await page.click('#dialog-cancel');

await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(800);
check(await page.isVisible('.menu-top:has-text("檔案")'), 'Chinese: 檔案 menu');

check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(failed ? 1 : 0);
