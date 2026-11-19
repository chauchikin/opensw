// File > Samples > the demos (src/demos.js): each opens in English and Chinese with every problem
// and answer as formulas, no TeX fields, every menu command written in it exists in the menus,
// and each problem computed in the page (SymPy) gives the answer the demo shows. The plots are made.
// node test/demos.mjs  (needs `npx vite preview --port 4173`; SymPy in the page)
import fs from 'node:fs';
import { chromium } from 'playwright';
import { DEMOS } from '../src/demos.js';
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const alike = (s) => s.replace(/\\left|\\right|\\,|\\ |\s/g, '').replace(/\(\\begin\{matrix\}/g, '\\begin{pmatrix}')
  .replace(/\\end\{matrix\}\)/g, '\\end{pmatrix}').replace(/([\^_])\{(\w)\}/g, '$1$2');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });

for (const lang of ['en', 'zh-TW']) {
  const page = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:4173/?lang=${lang}`); await page.waitForTimeout(700);
  const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
  // the words as shown (English: the text itself)
  const words = lang === 'en' ? null : JSON.parse(fs.readFileSync(`src/locales/${lang}.json`, 'utf8'));
  const label = (s) => (words && words[s]) || s;
  const fileMenu = label('File');
  const openMenu = async (path) => { // opens the menus along path; true when the last item is there
    await page.keyboard.press('Escape');
    await page.click(`.menu-top:has-text("${path[0]}")`);
    for (const [i, it] of path.slice(1).entries()) {
      const item = page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first();
      if (!(await item.count())) { await page.keyboard.press('Escape'); return false; }
      if (i < path.length - 2) await item.click(); else { await page.keyboard.press('Escape'); return true; }
    }
    return true;
  };

  for (const demo of DEMOS) {
    const name = `${lang} ${demo.id}`;
    // open it from File > Samples
    await page.keyboard.press('Escape');
    await page.click(`.menu-top:has-text("${fileMenu}")`);
    await page.locator(`.menu-list button:has(> span:text-is("${label('Samples')}"))`).filter({ visible: true }).first().click();
    await page.locator(`.menu-list button:has(> span:text-is("${label(demo.label)}"))`).filter({ visible: true }).first().click();
    await page.waitForTimeout(500);
    const dialog = page.locator('dialog[open] button, .dialog button').filter({ visible: true }).first(); // "the content will be replaced"
    if (await dialog.count()) { await dialog.click(); await page.waitForTimeout(300); }
    const doc = await page.evaluate(() => {
      const heads = []; let tex = 0;
      window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'heading') heads.push(n.textContent); if (n.type.name === 'tex_field') tex++; });
      return { heads, tex, text: window.swEditor.state.doc.textContent };
    });
    const formulas = (await call('formulas', {})).result.map((f) => alike(f.latex ?? f));
    check(doc.heads.length === demo.sections.length && doc.heads.every((h, i) => h.includes(label(demo.sections[i].title))), `${name}: opens with its ${demo.sections.length} sections`);
    check(doc.tex === 0, `${name}: no TeX fields`);
    const problems = demo.sections.flatMap((s) => s.problems);
    const lost = problems.filter((p) => !formulas.includes(alike(p.latex)) || (p.answer && !formulas.includes(alike(p.answer))));
    check(!lost.length, `${name}: all ${problems.length} problems and their answers are formulas ${lost.map((p) => p.latex).join(' | ')}`);
    const how = [...new Set(problems.map((p) => p.how.map(label).join(' > ')))];
    check(doc.text.includes(label('Answer:')) && how.every((h) => doc.text.includes(h)), `${name}: menu commands written in the text`);
    const missing = [];
    for (const p of problems) if (!(await openMenu(p.how.map(label)))) missing.push(p.how.join(' > '));
    check(!missing.length, `${name}: every menu command exists ${missing.join(', ')}`);
    if (lang !== 'en') continue;
    // computed in the page
    await call('compute', { latex: '0', op: 'cleardefs' });
    const wrong = [];
    for (const p of problems.filter((x) => x.op)) {
      const r = await call('compute', { latex: p.latex, op: p.op, params: p.params });
      const res = r.ok ? r.result : { error: r.error };
      const got = alike(res.latex ?? (res.solutions || []).join(';'));
      const ok = !res.error && (p.expect == null || [p.expect].flat().some((e) => got.includes(alike(e))));
      if (!ok) wrong.push(`${p.op} ${p.latex} -> ${JSON.stringify(res).slice(0, 120)}`);
    }
    check(!wrong.length, `${name}: every problem computes to its answer in the page ${wrong.join(' | ')}`);
    // the plots
    for (const p of problems.filter((x) => !x.op)) {
      await call('set', { latex: `Plot $${p.latex}$.` });
      await page.evaluate(() => document.querySelectorAll('.math-inline')[0]._mathView.enter(false));
      await page.click(`.menu-top:has-text("${p.how[0]}")`);
      for (const it of p.how.slice(1)) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
      const made = await page.waitForFunction(() => [...document.querySelectorAll('.image img')].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 90000 })
        .then(() => true, () => false);
      check(made, `${name}: ${p.how.slice(1).join(' > ')} of ${p.latex} makes a plot`);
    }
  }
  check(!errs.length, `${lang}: no page errors ${errs.join(' | ')}`);
  await page.close();
}
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
