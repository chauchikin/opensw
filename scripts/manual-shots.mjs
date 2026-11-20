// The pictures of the manual (Help > Full manual): screenshots of the web version, one set per language.
// Needs a build and `npx vite preview --port 4173`, then:
//   node scripts/manual-shots.mjs en public/manual/en
//   node scripts/manual-shots.mjs zh-TW public/manual/zh-TW
//   python3 scripts/manual-shots.py public/manual      (adds a grey frame and makes the files smaller)
// A third argument takes only some of them, e.g. window,menus,compute,plots,dialogs,review,help.
import { chromium } from 'playwright';
import fs from 'node:fs';
const [lang, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const zh = JSON.parse(fs.readFileSync('src/locales/zh-TW.json', 'utf8'));
const T = (s) => (lang === 'en' ? s : zh[s] || (() => { throw new Error('no zh for ' + s); })());
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:4173/?lang=${lang}`); await page.waitForTimeout(1500);
const only = process.argv[4] ? process.argv[4].split(',') : null;
const want = (n) => !only || only.includes(n);
const menu = async (top, ...items) => {
  await page.click(`.menu-top:text-is("${T(top)}")`); await page.waitForTimeout(150);
  for (const it of items) { await page.locator(`.menu-list button:has(> span:text-is("${T(it)}"))`).filter({ visible: true }).first().hover(); await page.waitForTimeout(150); }
};
const click = async (...items) => { for (const it of items) { await page.locator(`.menu-list button:has(> span:text-is("${T(it)}"))`).filter({ visible: true }).first().click(); await page.waitForTimeout(150); } };
// clip from the top-left corner to cover all open menu lists
const shotMenus = async (name, pad = 12) => {
  const box = await page.evaluate(() => {
    let r = 0, bt = 0;
    for (const l of document.querySelectorAll('.menu-list')) { const x = l.getBoundingClientRect(); if (x.width && x.height) { r = Math.max(r, x.right); bt = Math.max(bt, x.bottom); } }
    return { r, bt };
  });
  const left = await page.evaluate(() => Math.max(0, Math.min(...[...document.querySelectorAll('.menu-list')].filter((l) => l.getBoundingClientRect().width).map((l) => l.getBoundingClientRect().left)) - 60));
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: left, y: 0, width: Math.min(1280, box.r + pad) - left, height: Math.min(760, box.bt + pad) } });
  await page.keyboard.press('Escape'); await page.mouse.click(1000, 650); await page.waitForTimeout(100);
};
const shotEl = async (name, sel, pad = 0) => {
  const el = page.locator(sel).first(); await el.waitFor({ state: 'visible' });
  const bb = await el.boundingBox();
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: Math.max(0, bb.x - pad), y: Math.max(0, bb.y - pad), width: bb.width + 2 * pad, height: bb.height + 2 * pad } });
};
const set = (latex) => page.evaluate((l) => window.sw.call('set', { latex: l }), latex);
const closeDialog = async () => { if (await page.isVisible('#dialog')) await page.click('#dialog-cancel'); };
const waitImg = async (n = 1) => { for (let i = 0; i < 120; i++) { if (await page.evaluate((k) => [...document.querySelectorAll('.image img')].filter((im) => im.naturalWidth > 0).length >= k, n)) return; await page.waitForTimeout(500); } throw new Error('no plot'); };

// 1. the window with the math sample
if (want('window')) {
  await menu('File', 'Samples'); await click('A math sample (theorems, matrices, computing)');
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1200);
  await page.locator('#editor .ProseMirror :is(h2,h3)').first().click({ position: { x: 5, y: 10 } }); // cursor in the text
  await page.screenshot({ path: `${out}/window.png` });
}
// 2. menus
if (want('menus')) {
  await menu('File'); await shotMenus('menu-file');
  await menu('Edit'); await shotMenus('menu-edit');
  await menu('Insert'); await shotMenus('menu-insert');
  await menu('View'); await shotMenus('menu-view');
  await menu('Tag'); await shotMenus('menu-tag');
  await menu('Tools'); await shotMenus('menu-tools');
  await set('$\\int_0^1 x^2\\,dx$'); await page.waitForTimeout(300);
  await page.click('.math-inline math-field'); await page.waitForTimeout(200);
  await menu('Compute', 'Calculus'); await shotMenus('menu-compute');
}
// 3. computing: results follow the formulas
const MATH = {
  en: ['Computing', 'Press Ctrl+E in the integral:', 'Solve (exact) on the equation:', 'Plot 2D > Rectangular on', 'Plot 3D > Rectangular on'],
  'zh-TW': ['計算', '在積分裡按 Ctrl+E：', '在方程式上用 解方程（精確）：', '在下面的公式用 繪圖 2D > 直角座標：', '在下面的公式用 繪圖 3D > 直角座標：'],
}[lang];
const inMath = async (k) => { await page.evaluate((i) => document.querySelectorAll('.math-inline')[i]._mathView.enter(false), k); await page.waitForTimeout(200); };
if (want('compute')) {
  await set(`\\section{${MATH[0]}}\n\n${MATH[1]} $\\int_0^{\\pi} x\\sin x\\,dx$\n\n${MATH[2]} $x^2-5x+6=0$\n\n`);
  await page.waitForTimeout(400);
  const docJson = () => page.evaluate(() => JSON.stringify(window.swEditor.state.doc.toJSON()));
  const waitChange = async (before) => { for (let i = 0; i < 180 && (await docJson()) === before; i++) await page.waitForTimeout(500); await page.waitForTimeout(800); };
  let before = await docJson();
  await inMath(0); await page.keyboard.press('Control+e'); await waitChange(before);
  before = await docJson();
  await inMath(1); await menu('Compute'); await click('Solve (exact)'); await waitChange(before);
  await page.locator('#editor .ProseMirror :is(h2,h3)').first().click({ position: { x: 5, y: 10 } });
  const bb = await page.locator('#editor .ProseMirror').boundingBox();
  const last = await page.locator('#editor .ProseMirror > *').last().boundingBox();
  await page.screenshot({ path: `${out}/compute.png`, clip: { x: bb.x - 12, y: bb.y - 12, width: 760, height: last.y + last.height - bb.y + 28 } });
}
if (want('plots')) {
  await set(`${MATH[3]} $y=\\sin x+\\frac{x}{2}$\n\n${MATH[4]} $z=x^2-y^2$\n\n`);
  await page.waitForTimeout(400);
  await inMath(0); await menu('Compute', 'Plot 2D'); await click('Rectangular'); await waitImg(1);
  await inMath(1); await menu('Compute', 'Plot 3D'); await click('Rectangular'); await waitImg(2);
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 1280, height: 1300 }); await page.waitForTimeout(300);
  await page.evaluate(() => { document.querySelector('#scroller').scrollTop = 0; });
  const bb = await page.locator('#editor .ProseMirror').boundingBox();
  const last = await page.locator('#editor .ProseMirror > *').last().boundingBox();
  await page.screenshot({ path: `${out}/plots.png`, clip: { x: bb.x - 12, y: bb.y - 12, width: bb.width + 24, height: last.y + last.height - bb.y + 28 } });
  await page.setViewportSize({ width: 1280, height: 760 }); await page.waitForTimeout(300);
  // the plot's properties
  await page.evaluate(() => { const v = window.swEditor; let p = null; v.state.doc.descendants((n, pos) => { if (n.type.name === 'image' && p === null) p = pos; }); v.dispatch(v.state.tr.setSelection(window.swNodeSelection.create(v.state.doc, p))); });
  await page.keyboard.press('Control+F5'); await page.waitForTimeout(400);
  await shotEl('plot-props', '#dialog .panel', 6); await closeDialog();
}
// 4. formula properties, matrix dialog
if (want('dialogs')) {
  await set(`$\\frac{a+b}{2}\\geq\\sqrt{ab}$\n\n`); await page.waitForTimeout(300);
  await inMath(0); await page.keyboard.press('Control+F5'); await page.waitForTimeout(400);
  await shotEl('props', '#props .panel', 6); await page.click('#props-cancel');
  await inMath(0); await page.keyboard.press('End');
  await menu('Insert'); await click('Matrix...'); await page.waitForTimeout(300);
  await shotEl('matrix', '#matrix .panel', 6); await page.click('#matrix-cancel');
  for (const [name, item] of [['user-setup', 'User Setup...'], ['engine', 'Engine Setup...']]) {
    await menu('Tools'); await click(item); await page.waitForTimeout(500);
    await shotEl(name, '#dialog .panel', 6); await closeDialog();
  }
  await menu('Tag'); await click('Appearance...'); await page.waitForTimeout(400);
  await shotEl('tag-appearance', '#dialog .panel', 6); await closeDialog();
}
// 5. View > Changes and LaTeX source, after an edit
if (want('review')) {
  await menu('File', 'Samples'); await click('A math sample (theorems, matrices, computing)');
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1200);
  const p = page.locator('#editor .ProseMirror > p').nth(0);
  await p.click(); await page.keyboard.press('End');
  await page.keyboard.type(lang === 'en' ? ' This sentence is new.' : '這句是新加的。');
  await page.keyboard.press('Control+Shift+D'); await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/review.png` });
  await page.click('#rv-tabs button[data-tab="source"]'); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/review-source.png` });
  await page.click('#rv-tabs button[data-tab="list"]'); await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/review-list.png` });
  await page.keyboard.press('Control+Shift+D'); await page.waitForTimeout(300);
}
// 6. help: shortcuts (F1) and How to use
if (want('help')) {
  await page.keyboard.press('F1'); await page.waitForTimeout(400);
  await shotEl('shortcuts', '#help'); await page.keyboard.press('F1');
  await menu('Help'); await click('How to use'); await page.waitForTimeout(400);
  await shotEl('guide', '#guide .panel', 6); await page.click('#guide-close');
}
await b.close();
console.log(errs.length ? 'page errors: ' + errs.join('; ') : 'done');
