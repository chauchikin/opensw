import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const srv = spawn('python3', ['test/csp_server.py', '5192'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://localhost:5192/');
await page.waitForTimeout(1000);
async function openSample(v) {
  if (v.endsWith('.sci')) { // Scientific Word 6 files used as test input (not shipped with opensw)
    await page.setInputFiles('#file', 'test/fixtures/sw6/' + v);
  } else {
    await page.click('.menu-top:has-text("檔案")');
    await page.click('.menu-list button.has-sub:has-text("範例")');
    await page.click(`.submenu button:has-text("${{ demo: '試用說明', blank: '空白文件' }[v] || v}")`);
  }
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(800);
}
const summary = () => page.evaluate(() => {
  const out = [];
  window.swEditor.state.doc.descendants((n) => {
    if (n.isTextblock || n.type.name === 'math_display' || n.type.name === 'env' || n.type.name.endsWith('list'))
      out.push(n.type.name + (n.attrs.level != null ? n.attrs.level : '') + (n.attrs.nonum ? '*' : '') + (n.attrs.kind ? ':' + n.attrs.kind : ''));
    if (n.type.name.startsWith('math')) out.push('  math ' + n.attrs.latex);
    if (n.isTextblock) out.push('  text ' + n.textContent.replace(/\s+/g, ' ').trim().slice(0, 60));
  });
  return out;
});
for (const s of ['demo', 'SW_Book_1.sci']) {
  await openSample(s);
  const before = await summary();
  const b64 = await page.evaluate(() => window.swSaveSci());
  const file = `test-out/rt-${s.replace('.sci', '')}.sci`;
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  await openSample('blank'); // so a failed reopen cannot look like a perfect one
  await page.setInputFiles('#file', file);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1000);
  const after = await summary();
  const toastText = await page.textContent('#toast');
  if (toastText.includes('失敗')) console.log('  REOPEN FAILED:', toastText);
  // the saved main.xhtml must be well-formed XML (Scientific Word refuses anything else)
  const xmlOk = await page.evaluate(async (b64) => {
    const zip = await window.JSZipForTests.loadAsync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const x = await zip.file('main.xhtml').async('string');
    const d = new DOMParser().parseFromString(x, 'application/xml');
    return !d.querySelector('parsererror');
  }, b64);
  console.log('  main.xhtml well-formed:', xmlOk);
  let diff = 0;
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) if (before[i] !== after[i]) { if (diff < 12) console.log(`  [${i}] ${before[i]}  =>  ${after[i]}`); diff++; }
  console.log(s, 'lines', before.length, after.length, 'differences', diff);
}
console.log('errors', errors);
await browser.close(); srv.kill();

// A formula edited in Scientific Word keeps our old TeX annotation but new MathML:
// the reader must then trust the MathML.
{
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(fs.readFileSync('test-out/rt-demo.sci'));
  let x = await zip.file('main.xhtml').async('string');
  x = x.replace('<mi>x</mi><mn>2</mn>', '<mi>x</mi><mn>3</mn>'); // "edit" x^2 -> x^3, annotation still says x^2
  x = x.replace('<mi>r</mi>', '<mi>𝔹</mi>');                      // and a double-struck letter
  zip.file('main.xhtml', x);
  fs.writeFileSync('test-out/rt-edited.sci', await zip.generateAsync({ type: 'nodebuffer' }));
  const b2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  const srv2 = spawn('python3', ['test/csp_server.py', '5191'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const p2 = await b2.newPage();
  await p2.goto('http://localhost:5191/');
  await p2.waitForTimeout(800);
  await p2.setInputFiles('#file', 'test-out/rt-edited.sci');
  if (await p2.isVisible('#confirm')) await p2.click('#confirm-ok');
  await p2.waitForTimeout(800);
  const first = await p2.evaluate(() => { let l = null; window.swEditor.state.doc.descendants((n) => { if (!l && n.type.name === 'math_inline') l = n.attrs.latex; }); return l; });
  console.log('edited-elsewhere formula reads as:', first, first === 'x^3+y^2=\\mathbb{B}^2' ? 'OK' : 'UNEXPECTED');
  await b2.close(); srv2.kill();
}
