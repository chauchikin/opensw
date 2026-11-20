// Compares opensw's menus with Scientific Word 5.5's, item by item.
//   python scripts/menus55-dump.py C:\sw55\sw550ENUS.dll > menus55.txt
//   npx vite build && npx vite preview --port 4173      (in another window)
//   node scripts/menus55-compare.mjs menus55.txt [--all]
// Lists, for each 5.5 menu (the main menus 10, Compute 21, Typeset 23, Insert > Typeset Object 24), the items opensw does not have
// (in English, with the path) and how many it has. Words are compared without &, the shortcut,
// case, "..." / "…" and a trailing "?". Items of 5.5's own (Register, License ...) are listed
// apart: NOT_OURS below. --all also lists opensw's items 5.5 does not have.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/menus55-compare.mjs menus55.txt [--all]'); process.exit(2); }
const all = process.argv.includes('--all');

const SEP = '\u0001'; // between the words of a path (a label can have a /)
const norm = (s) => s.replace(/&/g, '').replace(/\s+(Ctrl|Alt|Shift|F\d+|Del|Esc)\b.*$/, '').replace(/(\.\.\.|…)$/, '').replace(/\?$/, '')
  .replace(/^[✓　]\s*/, '').trim().toLowerCase();

// 5.5's items that are about 5.5 itself, its windows or its DVI output: opensw does not have them
const NOT_OURS = new Set(['Window/New Window', 'Window/Cascade', 'Window/Tile Horizontally', 'Window/Tile Vertically', 'Window/Arrange Icons',
  'File/Send', 'Help/Register', 'Help/System Features', 'Help/License Information', 'Tools/Style Editor', 'Tools/External Lookup Settings',
  'Typeset/Preview', 'Typeset/Print', 'Typeset/Compile', 'File/Recent File' /* the list of recent files, not an item */].map((p) => p.split('/').map((w) => norm(w)).join('/')));

// menus55.txt -> the paths of 5.5's items (5.5's words, without &), the words joined by SEP
function read55(text) {
  const paths = [];
  const stack = [];
  let menu = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^=== MENU (\d+)/);
    if (m) { menu = +m[1]; stack.length = 0; continue; }
    if (![10, 21, 23, 24].includes(menu) || !line.trim()) continue;
    const depth = (line.length - line.trimStart().length) / 2;
    const sub = line.trim().startsWith('[M] ');
    const label = line.trim().replace(/^\[M\] /, '').replace(/&/g, '').replace(/\s+(Ctrl|Alt|Shift|F\d+|Del|Esc)\b.*$/, '');
    if (label === '----') continue;
    stack.length = depth;
    if (!sub) paths.push([...(menu === 24 ? ['Insert', 'Typeset Object'] : []), ...stack, label].join(SEP)); // 24: Insert > Typeset Object
    if (sub) stack.push(label);
  }
  return paths;
}

const want = read55(readFileSync(file, 'utf8'));
// PLAYWRIGHT_CHROMIUM: a Chromium of your own (the tests here use one under /opt/pw-browsers)
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`);
await page.waitForSelector('.menu-top');
// every menu, opened one after another; its whole tree is in the page (submenus are hidden lists)
const have = new Set();
const shown = [];
for (const name of await page.$$eval('.menu-top', (bs) => bs.map((b) => b.textContent))) {
  await page.click(`.menu-top:text-is("${name}")`);
  const items = await page.$eval('#popup > .menu-list', (root) => {
    const out = [];
    const walk = (list, path) => {
      for (const b of list.querySelectorAll(':scope > button')) {
        const label = b.querySelector(':scope > span').textContent;
        const sub = b.querySelector(':scope > .menu-list');
        if (sub) walk(sub, [...path, label]);
        else out.push([...path, label]);
      }
    };
    walk(root, []);
    return out;
  });
  for (const p of items) { have.add([name, ...p].map(norm).join(SEP)); shown.push([name, ...p].join(' > ')); }
  await page.keyboard.press('Escape');
  await page.click('body', { position: { x: 700, y: 600 } }).catch(() => {});
}
await browser.close();

const missing = [];
const notOurs = [];
for (const p of want) {
  const words = p.split(SEP);
  if (have.has(words.map(norm).join(SEP))) continue;
  (NOT_OURS.has(words.slice(0, 2).map(norm).join('/')) ? notOurs : missing).push(words.join(' > '));
}
console.log(`5.5: ${want.length} items; opensw has ${want.length - missing.length - notOurs.length}; missing ${missing.length}; 5.5's own, not done: ${notOurs.length}`);
for (const p of missing) console.log('  missing  ' + p);
for (const p of notOurs) console.log('  not ours ' + p);
if (all) {
  const wanted = new Set(want.map((p) => p.split(SEP).map(norm).join(SEP)));
  for (const s of shown) if (!wanted.has(s.split(' > ').map(norm).join(SEP))) console.log('  opensw   ' + s);
}
process.exit(missing.length ? 1 : 0);
