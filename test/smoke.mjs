import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const srv = spawn('python3', ['test/csp_server.py', '5199'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const out = (n) => `test-out/${n}`;
const docJSON = () => page.evaluate(() => window.swEditor.state.doc.toJSON());
const maths = async () => { const d = await docJSON(); const r = []; JSON.stringify(d, (k, v) => { if (v && v.type && v.type.startsWith('math')) r.push(v.attrs.latex); return v; }); return r; };

async function openSample(v) {
  if (v.endsWith('.sci')) { // Scientific Word 6 files used as test input (not shipped with opensw)
    await page.setInputFiles('#file', 'test/fixtures/sw6/' + v);
  } else {
    await page.click('.menu-top:has-text("檔案")');
    await page.click('.menu-list button.has-sub:has-text("範例")');
    await page.click(`.submenu button:has-text("${{ demo: '試用說明', blank: '空白文件' }[v] || v}")`);
  }
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(300);
}
await page.goto('http://localhost:5199/');
await page.waitForTimeout(1500);
await page.screenshot({ path: out('1-demo.png'), fullPage: true });

// fresh blank doc, type Chinese + math via keyboard
await openSample('blank');
await page.click('.ProseMirror');
await page.keyboard.insertText('勾股定理：');
await page.keyboard.press('Control+m');
await page.waitForTimeout(300);
await page.keyboard.type('x^2+y^2=1', { delay: 30 });
await page.keyboard.press('ArrowRight'); // at end of formula -> back to text
await page.keyboard.insertText('，是圓。');
let d = await docJSON();
console.log('T1 paragraph:', JSON.stringify(d.content[0].content));

// ArrowLeft back into the formula from text
for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft'); // over '，是圓。' (5 chars) then into math
await page.keyboard.type('0', { delay: 30 });
console.log('T2 math after edit:', await maths());

// $ shortcut, fraction
await page.keyboard.press('End');
await page.keyboard.press('Escape');
await page.click('.ProseMirror p:last-child', { position: { x: 400, y: 10 } });
await page.keyboard.press('End');
await page.keyboard.insertText('另一式 ');
await page.keyboard.type('$');
await page.waitForTimeout(200);
await page.keyboard.type('1/2', { delay: 30 });
await page.keyboard.press('Escape');
await page.keyboard.insertText(' 完。');
console.log('T3 maths:', await maths());

// display math
await page.keyboard.press('Control+Shift+m');
await page.waitForTimeout(200);
await page.keyboard.type('\\int_0^1 f(x)dx', { delay: 20 });
await page.keyboard.press('Enter');
await page.keyboard.insertText('公式後的文字');
d = await docJSON();
console.log('T4 blocks:', d.content.map((b) => b.type + (b.attrs?.latex ? ':' + b.attrs.latex : '')).join(' | '));

// Backspace into formula from text right after it
await openSample('blank');
await page.click('.ProseMirror');
await page.keyboard.insertText('a');
await page.keyboard.press('Control+m');
await page.keyboard.type('xy');  // no pause: must still land in the formula
await page.keyboard.press('Escape');
await page.keyboard.press('Backspace');
console.log('T5 after backspace:', await maths());
await page.keyboard.press('Backspace');
await page.keyboard.press('Backspace'); // now empty -> removes node
d = await docJSON();
console.log('T5 doc:', JSON.stringify(d.content[0]));
await page.screenshot({ path: out('2-typed.png') });

// open samples
for (const s of ['swwelcome.sci', 'SW_Book_1.sci']) {
  await openSample(s);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out('3-' + s + '.png'), fullPage: false });
  const n = await page.evaluate(() => { let c = 0; window.swEditor.state.doc.descendants((x) => { if (x.type.name.startsWith('math')) c++; }); return c; });
  console.log('T6', s, 'math nodes', n, 'blocks', (await docJSON()).content.length);
}
// export latex of the book sample
await page.click('#btn-latex'); await page.waitForTimeout(300);
const tex = await page.inputValue('#export-text');
fs.writeFileSync(out('book.tex'), tex);
await page.click('#export-close');
await page.click('#btn-md');
fs.writeFileSync(out('book.md'), await page.inputValue('#export-text'));
await page.click('#export-close');
await openSample('demo');
await page.waitForTimeout(1000);
await page.click('#btn-latex'); await page.waitForTimeout(300);
fs.writeFileSync(out('demo.tex'), await page.inputValue('#export-text'));
console.log('errors:', errors);
await browser.close();
srv.kill();
