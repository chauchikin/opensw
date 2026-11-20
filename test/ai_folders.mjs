// AI (MCP, window.sw) may open without asking only in the projects folder, the open
// document's folder and the folders allowed in Tools > User Setup; elsewhere the user is asked
// (OK: this once). It saves only in the projects folder, whatever is allowed (test/ai_outside.mjs),
// and only .tex and .sci. A file it opens outside the projects folder is
// imported like any other (test/import.mjs). With the stand-in for the desktop shell
// (test/lib/desktop.mjs). Run: node test/ai_folders.mjs
import { chromium } from 'playwright';
import { standIn, ROOT, DOCUMENTS, filePaths } from './lib/desktop.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const tex = '\\documentclass{article}\\input{tcilatex}\\begin{document}Hello\\end{document}';
await standIn(page, {
  files: { 'D:\\Allowed\\sub\\a.tex': tex, 'd:\\allowed\\sub\\b.tex': tex, 'C:\\Users\\prof\\secret.tex': tex, 'D:\\Allowed\\..\\Other\\c.tex': tex, [DOCUMENTS + '\\opensw\\old.tex']: tex },
  settings: { aiFolders: ['D:\\Allowed'] },
});
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(800);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 300)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
// a call that makes the editor ask: answer with the button, then the result
async function asked(cmd, args, button) {
  const r = page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
  await page.waitForSelector('#dialog:not([hidden])');
  const text = await page.textContent('#dialog');
  await page.click(button);
  return { r: await r, text };
}
const inProjects = (name) => new RegExp(`^${ROOT.replace(/\\/g, '\\\\')}\\\\${name}_\\d{4}-\\d\\d-\\d\\d\\\\${name}\\.tex$`);

let r = await call('open', { path: 'D:\\Allowed\\sub\\a.tex' });
const copy = r.result?.path || '';
check('opens in an allowed folder without asking (and works on a copy in the projects folder)', r.ok && inProjects('a').test(copy) && r.result.imported.from === 'D:\\Allowed\\sub\\a.tex' && await page.isHidden('#dialog'), r);
r = await call('open', { path: 'd:\\allowed\\sub\\b.tex' });
check('letter case is ignored', r.ok && await page.isHidden('#dialog'), r);
r = await call('open', { path: copy });
check('the projects folder is allowed', r.ok && r.result.path === copy && r.result.aiFolder === ROOT && await page.isHidden('#dialog'), r);
r = await call('open', { path: DOCUMENTS + '\\opensw\\old.tex' });
check('Documents\\opensw (where earlier versions let AI save) is still allowed for opening', r.ok && inProjects('old').test(r.result.path) && await page.isHidden('#dialog'), r);
let a = await asked('open', { path: 'C:\\Users\\prof\\secret.tex' }, '#dialog-cancel');
check('elsewhere the user is asked; No: refused', !a.r.ok && /did not allow/.test(a.r.error) && a.text.includes('C:\\Users\\prof\\secret.tex'), a);
a = await asked('open', { path: 'D:\\Allowed\\..\\Other\\c.tex' }, '#dialog-ok');
check('".." does not get out unasked; OK: opened this once', a.r.ok && inProjects('c').test(a.r.result.path), a);
const here = a.r.result.path.replace(/\\[^\\]*$/, '');
r = await call('save', { path: 'D:\\Other\\notes.docx' });
check('saves only .tex and .sci', !r.ok && /\.tex/.test(r.error), r);
r = await call('save', { path: here + '\\d.sci' });
check('saving in the open document\'s folder is allowed', r.ok && (await filePaths(page)).includes(here + '\\d.sci') && await page.isHidden('#dialog'), r);
r = await call('save', { path: 'E:\\x.tex' });
check('saving outside the projects folder is refused without a question; nothing is written', !r.ok && /is not in the projects folder/.test(r.error) && !(await filePaths(page)).includes('E:\\x.tex') && await page.isHidden('#dialog'), r);
r = await call('save', { path: 'D:\\Allowed\\x.tex' });
check('... also in a folder allowed for AI: that is for opening', !r.ok && /is not in the projects folder/.test(r.error) && !(await filePaths(page)).includes('D:\\Allowed\\x.tex') && await page.isHidden('#dialog'), r);
r = await call('save', { path: DOCUMENTS + '\\opensw\\new.tex' });
check('... and in Documents\\opensw', !r.ok && /is not in the projects folder/.test(r.error) && await page.isHidden('#dialog'), r);
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
