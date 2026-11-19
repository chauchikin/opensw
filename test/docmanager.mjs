// Tools > Document Manager's Copy, Rename, Delete and Clean Up (with a stand-in for the desktop
// shell's file commands), and Ctrl + a fragment's name (5.5).
// Run: node test/docmanager.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail ?? '').slice(0, 300)); };

// 1. Ctrl + a fragment's name, in the web page
let page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => localStorage.setItem('opensw-fragments', JSON.stringify({ pq7: '$x^{2}+1$', fq: '$y$' })));
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(800);
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
await page.addInitScript(() => {
  const tex = '\\documentclass{article}\n%TCIDATA{Version=5.50.0.2960}\n\\input{tcilatex}\n\\begin{document}\nText \\FRAME{dtbpF}{1in}{1in}{0pt}{}{}{pic.png}{\\special{language "Scientific Word";type "GRAPHIC";display "USEDEF";valid_file "F";width 1in;height 1in;depth 0pt;original-width 1in;original-height 1in;cropleft "0";croptop "1";cropright "1";cropbottom "0";filename \'pic.png\';file-properties "XNPEU";}}\n\\end{document}\n';
  window.files = { 'C:\\d\\paper.tex': tex, 'C:\\d\\pic.png': 'png', 'C:\\d\\paper.log': 'log', 'C:\\d\\paper.aux': 'aux', 'C:\\e\\paper.tex': 'old' };
  window.trashed = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd, args) => {
      if (cmd === 'file_exists') return args.path in window.files;
      if (cmd === 'read_file') { if (!(args.path in window.files)) throw `Cannot read ${args.path}`; return Array.from(new TextEncoder().encode(window.files[args.path])); }
      if (cmd === 'write_file') { window.files[args.path] = new TextDecoder().decode(new Uint8Array(args.data)); return null; }
      if (cmd === 'rename_file') { if (args.to in window.files) throw `${args.to} already exists`; window.files[args.to] = window.files[args.from]; delete window.files[args.from]; return null; }
      if (cmd === 'trash_files') { for (const p of args.paths) { window.trashed.push(p); delete window.files[p]; } return null; }
      if (cmd === 'plugin:dialog|open') return 'C:\\e';
      if (cmd === 'startup_path') return 'C:\\d\\paper.tex'; // opened by double-clicking it
      return null;
    },
  };
});
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(800);
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
let trashed = await page.evaluate(() => window.trashed.slice());
check('Clean Up: the .aux and .log go to the Recycle Bin', cleanRows === 2 && trashed.sort().join() === 'C:\\d\\paper.aux,C:\\d\\paper.log', { cleanRows, trashed });
// Copy to C:\e: paper.tex is there already, so it asks; the picture goes too
await dm();
await page.click('#d-copy'); await page.waitForTimeout(300);
await page.click('#dialog-ok'); await page.waitForTimeout(300);
const asked = await page.textContent('#dialog-body');
await page.click('#dialog-ok'); await page.waitForTimeout(300);
let files = await page.evaluate(() => window.files);
check('Copy: asks before replacing, then copies the document and its picture', /paper\.tex/.test(asked) && files['C:\\e\\paper.tex'] === files['C:\\d\\paper.tex'] && files['C:\\e\\pic.png'] === 'png', { asked, files });
// Rename: paper.tex -> notes.tex; the window now has that file
await dm();
await page.click('#d-rename'); await page.waitForTimeout(300);
await page.fill('#d-name', 'notes');
await page.click('#dialog-ok'); await page.waitForTimeout(300);
files = await page.evaluate(() => window.files);
const title = await page.title();
check('Rename: the file and the window', files['C:\\d\\notes.tex']?.includes('documentclass') && !('C:\\d\\paper.tex' in files) && /notes/.test(title), { files, title });
// Delete, leaving out the picture
await dm();
await page.click('#d-delete'); await page.waitForTimeout(300);
await page.uncheck('#dialog-body .d-dm');
await page.click('#dialog-ok'); await page.waitForTimeout(300);
trashed = await page.evaluate(() => window.trashed.slice());
files = await page.evaluate(() => window.files);
check('Delete: the document to the Recycle Bin, the picture left as chosen', trashed.includes('C:\\d\\notes.tex') && 'C:\\d\\pic.png' in files, { trashed, files });
await dm();
check('after Delete the document is on screen only (no file buttons)', (await page.locator('#d-copy').count()) === 0);
check('no page errors', !errs.length, errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
