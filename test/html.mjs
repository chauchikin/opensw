// HTML export (A20): open several test documents, export, check the page.  node test/html.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(600);
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };
const open = async (file) => {
  await page.setInputFiles('#file', file);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1200);
};
const viewer = await b.newPage({ viewport: { width: 1000, height: 1200 } });
const show = async (name) => {
  const html = await page.evaluate(() => window.swHtmlForTests());
  fs.writeFileSync(`/tmp/${name}.html`, html);
  await viewer.goto(`file:///tmp/${name}.html`);
  return html;
};

await open('test/fixtures/tables.tex');
let html = await show('h-tables');
check(await viewer.evaluate(() => document.querySelectorAll('table').length) === 3 && await viewer.evaluate(() => document.querySelector('td[colspan="2"]')?.textContent) === 'merged', 'tables with merged cell');
check(await viewer.evaluate(() => [...document.querySelectorAll('figcaption')].map((f) => f.textContent).join('|')) === '表 1：Results of x2|圖 1：A figure', 'captions numbered: ' + await viewer.evaluate(() => [...document.querySelectorAll('figcaption')].map((f) => f.textContent).join('|')));
check(await viewer.evaluate(() => [...document.querySelectorAll('a[href^="#"]')].map((a) => a.textContent).join()) === '1,1', 'references');

await open('test/fixtures/notes.tex');
html = await show('h-notes');
check(await viewer.evaluate(() => document.querySelectorAll('ol.footnotes li').length) === 2 && /math/.test(await viewer.evaluate(() => document.querySelector('ol.footnotes').innerHTML)), 'footnotes at the end, with their formula');
await open('test/fixtures/cites.tex');
html = await show('h-cites');
check(/\[<a href="#bib-knuth">1<\/a>\]/.test(html) && await viewer.evaluate(() => document.querySelectorAll('ul.bibliography li').length) === 2, 'citations link to the list');
await open('test/fixtures/sw6/SW_Book_1.sci');
html = await show('h-book');
check(await viewer.evaluate(() => document.querySelectorAll('math').length) > 50 && await viewer.evaluate(() => document.querySelectorAll('.eqno').length) > 3, 'SW_Book_1: formulas as MathML, equation numbers');
await viewer.screenshot({ path: '/tmp/h-book.png' });
await open('test/fixtures/pictures/frame55.tex');
await page.evaluate((data) => window.swPictures.assets.set('dot.png', new Uint8Array(data)), [...fs.readFileSync('test/fixtures/pictures/graphics/dot.png')]);
html = await show('h-pics');
check(await viewer.evaluate(() => [...document.images].filter((i) => i.naturalWidth > 0).length) === 2, 'pictures inside the page');
check(!errs.length, 'no page errors ' + errs);
await b.close();
process.exit(fails ? 1 : 0);
