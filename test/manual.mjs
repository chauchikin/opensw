// Help > Manual: opensw's manual opens as a document that covers every menu.
// node test/manual.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1200, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(700);
const tops = await page.$$eval('.menu-top', (l) => l.map((e) => e.textContent.trim()));
await page.click('.menu-top:has-text("說明")');
await page.locator('.menu-list button:has(> span:text-is("目錄"))').click();
await page.waitForTimeout(1000);
const r = await page.evaluate(() => {
  const heads = []; let title = null; let tex = 0;
  window.swEditor.state.doc.descendants((n) => {
    if (n.type.name === 'heading') heads.push(n.textContent);
    if (n.type.name === 'title') title = n.textContent;
    if (n.type.name === 'tex_field') tex++;
  });
  return { heads, title, tex, text: window.swEditor.state.doc.textContent, name: document.title };
});
check(r.title === 'opensw 說明文件' && /opensw 說明文件/.test(r.name), 'opens as its own document with a title');
check(r.tex === 0, 'no TeX fields (everything read as text and formulas)');
const missingMenus = tops.filter((t) => !['說明', '檢視', '前往', '標籤'].includes(t) && !r.heads.some((h) => h.includes(t)));
check(!missingMenus.length && r.heads.some((h) => /檢視、前往、標籤/.test(h)), 'a section for every menu ' + missingMenus.join(','));
const words = ['開啟網址', '片段', '版面設定', '預覽', '選擇性貼上', '複製成圖片', '考卷公式', 'HTML 欄位', '工具列', '外觀', '單形法', '向量微積分',
  '隱函數', '保角', '不等式', '常微分方程', '近似積分圖', '柱座標', '球座標', '管狀', '考卷產生器', '文件管理', '自動替換', '使用者設定', '匯出設定', 'Lean', 'MCP'];
const missing = words.filter((w) => !r.text.includes(w));
check(!missing.length, 'covers the features: ' + (missing.join(', ') || 'all'));
// the pictures (public/manual/zh-TW) are loaded and shown
await page.waitForFunction(() => [...document.querySelectorAll('.image img')].filter((i) => i.complete && i.naturalWidth > 0).length > 0, null, { timeout: 10000 }).catch(() => {});
const pics = await page.evaluate(() => {
  const all = []; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image') all.push(n.attrs.path); });
  return { all, shown: [...document.querySelectorAll('.image img')].filter((i) => i.complete && i.naturalWidth > 0).length };
});
check(pics.all.length >= 20 && pics.all.every((p) => p.startsWith('manual/zh-TW/')) && pics.shown === pics.all.length, `pictures shown: ${pics.shown} of ${pics.all.length}`);
check(!errs.length, 'no page errors ' + errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
