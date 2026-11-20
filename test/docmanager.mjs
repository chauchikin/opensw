// Tools > Document Manager's Copy, Rename, Delete and Clean Up (with the stand-in for the desktop
// shell's file commands, test/lib/desktop.mjs), and Ctrl + a fragment's name (5.5).
// Run: node test/docmanager.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import { standIn, ROOT, inProject } from './lib/desktop.mjs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail ?? '').slice(0, 300)); };

// 1. Ctrl + a fragment's name, in the web page
let page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('opensw-fragments', JSON.stringify({ pq7: '$x^{2}+1$', fq: '$y$' })));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(800);
let call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const latex = async () => (await call('get', { format: 'latex' })).result?.latex ?? JSON.stringify(await call('get', { format: 'latex' }));
await call('set', { latex: 'Start.' });
await call('focusEnd');
await page.keyboard.down('Control');
for (const k of ['p', 'q', '7']) await page.keyboard.press(k);
await page.keyboard.up('Control');
await page.waitForTimeout(300);
let t = await latex();
check('Ctrl held, p q 7, let go: fragment pq7 goes in (no Print)', /x\^\{?2\}?\s*\+\s*1/.test(t), t);
// f begins fq; f alone is not a name: on letting go, Ctrl+F (fraction) as usual
await call('set', { latex: 'Start.' });
await call('focusEnd');
await page.keyboard.down('Control');
await page.keyboard.press('f');
await page.keyboard.up('Control');
await page.waitForTimeout(300);
t = await latex();
check('Ctrl+F alone (f begins a name): a fraction once Ctrl is let go', /\\frac/.test(t), t);
// Ctrl+C stays copy (a name cannot begin with c)
check('no page errors', !errs.length, errs);
await page.close();

// 2. the Document Manager in the desktop app (a stand-in for its file commands)
page = await b.newPage();
page.on('pageerror', (e) => errs.push(e.message));
// (the document is in a project folder, D: it is opened as it is)
const D = ROOT + '\\d';
const tex = '\\documentclass{article}\n%TCIDATA{Version=5.50.0.2960}\n\\input{tcilatex}\n\\begin{document}\nText \\FRAME{dtbpF}{1in}{1in}{0pt}{}{}{pic.png}{\\special{language "Scientific Word";type "GRAPHIC";display "USEDEF";valid_file "F";width 1in;height 1in;depth 0pt;original-width 1in;original-height 1in;cropleft "0";croptop "1";cropright "1";cropbottom "0";filename \'pic.png\';file-properties "XNPEU";}}\n\\end{document}\n';
await standIn(page, { files: { [D + '\\paper.tex']: tex, [D + '\\pic.png']: 'png', [D + '\\paper.log']: 'log', [D + '\\paper.aux']: 'aux', 'C:\\e\\paper.tex': 'old', ...inProject(D, 'paper.tex') }, startup: D + '\\paper.tex' }); // opened by double-clicking it
await page.addInitScript(() => { window.shell.open = 'C:\\e'; }); // the folder chosen for Copy
const allFiles = () => page.evaluate(() => Object.fromEntries([...window.shell.files].map(([p, d]) => [p, new TextDecoder().decode(Uint8Array.from(d))])));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(800);
call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const dm = async () => { await menu('工具', '文件管理…'); await page.waitForTimeout(200); };
// Clean up: .log and .aux, to the Recycle Bin
await dm();
await page.click('#d-clean'); await page.waitForTimeout(300);
const cleanRows = await page.locator('#dialog-body .d-dm').count();
await page.click('#dialog-ok'); await page.waitForTimeout(300);
let trashed = await page.evaluate(() => window.shell.trashed.slice());
check('Clean Up: the .aux and .log go to the Recycle Bin', cleanRows === 2 && trashed.sort().join() === `${D}\\paper.aux,${D}\\paper.log`, { cleanRows, trashed });
// Copy to C:\e: paper.tex is there already, so it asks; the picture goes too
await dm();
await page.click('#d-copy'); await page.waitForTimeout(300);
await page.click('#dialog-ok'); await page.waitForTimeout(300);
const asked = await page.textContent('#dialog-body');
await page.click('#dialog-ok'); await page.waitForTimeout(300);
let files = await allFiles();
check('Copy: asks before replacing, then copies the document and its picture', /paper\.tex/.test(asked) && files['C:\\e\\paper.tex'] === files[D + '\\paper.tex'] && files['C:\\e\\pic.png'] === 'png', { asked, files });
// Rename: paper.tex -> notes.tex; the window now has that file
await dm();
await page.click('#d-rename'); await page.waitForTimeout(300);
await page.fill('#d-name', 'notes');
await page.click('#dialog-ok'); await page.waitForTimeout(300);
files = await allFiles();
const title = await page.title();
check('Rename: the file and the window', files[D + '\\notes.tex']?.includes('documentclass') && !((D + '\\paper.tex') in files) && /notes/.test(title), { files, title });
// Delete, leaving out the picture
await dm();
await page.click('#d-delete'); await page.waitForTimeout(300);
await page.uncheck('#dialog-body .d-dm');
await page.click('#dialog-ok'); await page.waitForTimeout(300);
trashed = await page.evaluate(() => window.shell.trashed.slice());
files = await allFiles();
check('Delete: the document to the Recycle Bin, the picture left as chosen', trashed.includes(D + '\\notes.tex') && (D + '\\pic.png') in files, { trashed, files });
await dm();
check('after Delete the document is on screen only (no file buttons)', (await page.locator('#d-copy').count()) === 0);
check('no page errors', !errs.length, errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
