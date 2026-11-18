// Open Scientific Word 5.x .tex files: node test/tex55.mjs <out dir> <file.tex>...
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [outDir, ...files] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/');
await page.waitForTimeout(600);
for (const f of files) {
  const name = path.basename(f, '.tex');
  await page.setInputFiles('#file', f);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1500);
  // formulas MathLive could not read show an error box
  const bad = await page.evaluate(() => [...document.querySelectorAll('math-field')].filter((mf) => mf.shadowRoot?.querySelector('.ML__error')).map((mf) => mf.value + ' :: ' + [...mf.shadowRoot.querySelectorAll('.ML__error')].map((e) => e.textContent).join(',')));
  const count = await page.evaluate(() => document.querySelectorAll('math-field').length);
  console.log(name, 'formulas', count, 'with errors', bad.length);
  for (const x of bad.slice(0, 8)) console.log('   ', x.slice(0, 200));
  await page.screenshot({ path: `${outDir}/${name}-screen.png` });
  await page.click('#btn-latex'); await page.waitForTimeout(300);
  fs.writeFileSync(`${outDir}/${name}.tex`, await page.inputValue('#export-text'));
  await page.click('#export-close');
}
console.log('page errors', errs);
await b.close();
