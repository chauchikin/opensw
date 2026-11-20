// AI (MCP, window.sw) may open and save only in the open document's folder and the folders
// allowed in Tools > User Setup; elsewhere the user is asked (OK: this once); it saves only
// .tex and .sci. With a stand-in for the desktop shell. Run: node test/ai_folders.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => {
  const tex = Array.from(new TextEncoder().encode('\\documentclass{article}\\input{tcilatex}\\begin{document}Hello\\end{document}'));
  window.written = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd, args) => {
      if (cmd === 'read_file') { if (args.path.endsWith('.bak') || window.written.some((w) => w === args.path)) throw new Error('none'); return tex; }
      if (cmd === 'write_file') { window.written.push(args.path); return null; }
      return null;
    },
  };
  localStorage.setItem('opensw-settings', JSON.stringify({ aiFolders: ['D:\\Allowed'] }));
});
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(800);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 200)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
// a call that makes the editor ask: answer with the button, then the result
async function asked(cmd, args, button) {
  const r = page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
  await page.waitForSelector('#dialog:not([hidden])');
  const text = await page.textContent('#dialog');
  await page.click(button);
  return { r: await r, text };
}

let r = await call('open', { path: 'D:\\Allowed\\sub\\a.tex' });
check('opens in an allowed folder without asking', r.ok && r.result.path === 'D:\\Allowed\\sub\\a.tex' && await page.isHidden('#dialog'), r);
r = await call('open', { path: 'd:\\allowed\\sub\\b.tex' });
check('the open document\'s folder is allowed (letter case ignored)', r.ok, r);
let a = await asked('open', { path: 'C:\\Users\\prof\\secret.tex' }, '#dialog-cancel');
check('elsewhere the user is asked; No: refused', !a.r.ok && /did not allow/.test(a.r.error) && a.text.includes('C:\\Users\\prof\\secret.tex'), a);
a = await asked('open', { path: 'D:\\Allowed\\..\\Other\\c.tex' }, '#dialog-ok');
check('".." does not get out unasked; OK: opened this once', a.r.ok && a.r.result.path === 'D:\\Allowed\\..\\Other\\c.tex', a);
r = await call('save', { path: 'D:\\Other\\notes.docx' });
check('saves only .tex and .sci', !r.ok && /\.tex/.test(r.error), r);
r = await call('save', { path: 'D:\\Other\\d.sci' });
check('saving in the open document\'s folder is allowed', r.ok && (await page.evaluate(() => window.written)).includes('D:\\Other\\d.sci'), r);
a = await asked('save', { path: 'E:\\x.tex' }, '#dialog-cancel');
check('saving elsewhere asks first; No: nothing written', !a.r.ok && !(await page.evaluate(() => window.written)).includes('E:\\x.tex'), a);
r = await call('save', {});
check('saving back to the open file needs no path', r.ok, r);
// Tools > User Setup keeps the allowed folders
await page.click('.menu-top:has-text("工具")');
await page.locator('.menu-list button:has(> span:text-is("使用者設定…"))').filter({ visible: true }).first().click();
check('User Setup shows the allowed folders', (await page.inputValue('#d-aifolders')) === 'D:\\Allowed');
await page.fill('#d-aifolders', 'D:\\A; E:\\B ;');
await page.click('#dialog-ok');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('opensw-settings')).aiFolders);
check('... and saves them', JSON.stringify(saved) === JSON.stringify(['D:\\A', 'E:\\B']), saved);
console.log('page errors', errs);
await b.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
