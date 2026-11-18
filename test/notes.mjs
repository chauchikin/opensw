// Footnotes and margin notes (A5).  node test/notes.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const open = async (file) => {
  await page.setInputFiles('#file', file);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1200);
};
const notes = () => page.evaluate(() => { const l = []; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'note') l.push([n.attrs.kind, n.textContent, n.childCount]); }); return l; });
const exportTex = async () => { await page.click('#btn-latex'); await page.waitForTimeout(300); const t = await page.inputValue('#export-text'); await page.click('#export-close'); return t; };
const menu = async (top, item) => { await page.click(`.menu-top:has-text("${top}")`); await page.click(`.menu-list button:has(> span:text-is("${item}"))`); };

await open('test/fixtures/notes.tex');
let n = await notes();
check(n.length === 3 && n[0][0] === 'footnote' && n[1][0] === 'margin' && /The note has math/.test(n[0][1]), 'two footnotes and a margin note read');
check(await page.evaluate(() => [...document.querySelectorAll('.note-footnote')].map((e) => e.getAttribute('data-num')).join()) === '1,2', 'footnotes numbered 1, 2');
const tex = await exportTex();
check(/\\footnote\{The note has math \$x\^2\$ and \\textbf\{bold\}\.\}/.test(tex) && /\\marginpar\{See also page 3\.\}/.test(tex), 'written back as \\footnote and \\marginpar');

// click a note: its editor opens; typing changes the note
await page.click('.note-footnote >> nth=1');
await page.waitForTimeout(200);
check(await page.isVisible('.note-editor'), 'clicking the mark opens the note');
await page.click('.note-editor .ProseMirror');
await page.keyboard.press('End');
await page.keyboard.type(' More');
n = await notes();
check(n[2][1] === 'Two. More', 'typing in the note edits it: ' + n[2][1]);
await page.keyboard.press('Control+z');
n = await notes();
check(n[2][1] === 'Two.', 'undo works on the note');

// Insert > Note
await page.click('#editor .ProseMirror > p'); await page.keyboard.press('End');
await menu('插入', '註解…');
await page.click('#dialog-ok');
await page.waitForTimeout(200);
await page.keyboard.type('New note');
n = await notes();
check(n.length === 4 && n.some((x) => x[1] === 'New note'), 'Insert > Note adds a footnote and its editor takes the typing');

// .sci round trip
const before = JSON.stringify(await notes());
fs.writeFileSync('/tmp/notes.sci', Buffer.from(await page.evaluate(() => window.swSaveSci()), 'base64'));
await open('/tmp/notes.sci');
check(JSON.stringify(await notes()) === before, 'same notes after .sci round trip');

check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
