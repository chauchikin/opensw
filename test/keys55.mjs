// Scientific Word 5.5 keys, toolbars and tag bar. Run: node test/keys55.mjs [url]
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://localhost:4173/?lang=zh-TW';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1024, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(url);
await page.waitForTimeout(600);
let fails = 0;
const check = (name, got, want) => {
  const ok = want instanceof RegExp ? want.test(got) : got === want;
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(got));
};
const maths = () => page.evaluate(() => { const l = []; window.swEditor.state.doc.descendants((n) => { if (n.type.name.startsWith('math')) l.push(n.attrs.latex); }); return l; });
const lastMath = async () => { await page.waitForTimeout(150); return (await maths()).at(-1); };
const blank = async () => {
  await page.click('.menu-top:has-text("檔案")');
  await page.click('.menu-list button:has-text("新增")');
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.click('#editor .ProseMirror');
};

await blank();
await page.keyboard.type('Let ');
await page.keyboard.press('Control+f'); // fraction from text starts a formula
await page.keyboard.type('a');
await page.keyboard.press('Tab');
await page.keyboard.type('b');
check('Ctrl+F fraction', await lastMath(), /^\\frac\{a\}\{b\}$/);
check('status shows math mode', await page.textContent('#status-mode'), '數學');
await page.keyboard.press('Control+m'); // back to text
await page.keyboard.type(' and ');
check('Ctrl+M back to text', await page.textContent('#status-mode'), '文字');
await page.keyboard.press('Control+g'); // Greek prefix from text
await page.keyboard.press('a');
check('Ctrl+G a = alpha', await lastMath(), '\\alpha');
await page.keyboard.press('Control+h');
await page.keyboard.type('2');
check('Ctrl+H superscript', await lastMath(), /^\\alpha\^\{?2\}?$/);
// (MathLive leaves the superscript by itself after one digit)
await page.keyboard.press('Control+s'); // symbol prefix inside a formula
await page.keyboard.press('Shift+I');
check('Ctrl+S I = infinity', await lastMath(), /\\infty$/);
await page.keyboard.press('Control+r');
await page.keyboard.type('x');
check('Ctrl+R radical', await lastMath(), /\\sqrt\{x\}$/);
await page.keyboard.press('ArrowRight');
await page.keyboard.press('Control+0');
await page.keyboard.type('y');
check('Ctrl+0 parentheses', await lastMath(), /\\left\(y\\right\)$/);
await page.keyboard.press('ArrowRight');
await page.keyboard.press('Control+l');
await page.keyboard.type('k');
check('Ctrl+L subscript', await lastMath(), /_\{?k\}?$/);
await page.keyboard.press('ArrowRight');
await page.click('.tb[title^="π"]'); // symbol cache keeps the cursor in the formula
check('symbol cache button', await lastMath(), /\\pi$/);
await page.click('.tb[title^="符號面板 ≤⊂"]');
await page.click('.sym-grid button:text-is("⊆")');
check('symbol panel', await lastMath(), /\\subseteq$/);
await page.keyboard.press('Control+-');
await page.keyboard.type('v');
check('Ctrl+- vector in math', await lastMath(), /\\vec\{v\}$/);
check('zoom unchanged by Ctrl+- in math', await page.textContent('#status-zoom'), '100%');
await page.keyboard.press('Escape');
await page.keyboard.press('Control+i');
check('Ctrl+I in text = integral (as in 5.5)', await lastMath(), '\\int');
await page.keyboard.press('Escape');
await page.keyboard.press('Control+s');
await page.keyboard.press('e');
check('Ctrl+S e in text = element-of', await lastMath(), '\\in');
await page.keyboard.press('Control+n');
check('Ctrl+N negates', await lastMath(), '\\notin');
await page.keyboard.press('Control+F5');
check('Ctrl+F5 shows the TeX', await page.inputValue('#props-text'), '\\notin');
await page.fill('#props-text', '\\notin A');
await page.click('#props-ok');
check('properties edit', await lastMath(), '\\notin A');
await page.keyboard.press('Escape');
await page.keyboard.press('Control+^');
await page.keyboard.type('a');
check('Ctrl+^ a in text = â', await page.evaluate(() => window.swEditor.state.doc.textContent.slice(-1)), 'â');
await page.keyboard.type('=');
await page.keyboard.press('Control+n');
check('Ctrl+N in text', await page.evaluate(() => window.swEditor.state.doc.textContent.slice(-1)), '≠');

// matrix dialog
await page.click('.tb[title="矩陣"]');
await page.fill('#matrix-rows', '2'); await page.fill('#matrix-cols', '3');
await page.selectOption('#matrix-fence', 'bmatrix');
await page.click('#matrix-ok');
await page.keyboard.type('1');
check('matrix 2x3', await lastMath(), /^\\begin\{bmatrix\}1\s*&.*\\end\{bmatrix\}$/);
await page.keyboard.press('Escape');
await page.keyboard.press('Control+s');
await page.keyboard.press('m');
check('Ctrl+S m = last matrix', await lastMath(), /^\\begin\{bmatrix\}.*\\end\{bmatrix\}$/);
await page.keyboard.press('Escape');

// tag bar
await page.keyboard.press('Enter');
await page.keyboard.type('Theorem text');
await page.selectOption('#item-tag', 'theorem');
check('item tag theorem', await page.evaluate(() => window.swEditor.state.selection.$from.node(1).type.name + ':' + window.swEditor.state.selection.$from.node(1).attrs.kind), 'env:theorem');
await page.click('#btn-untag');
check('remove item tag', await page.evaluate(() => window.swEditor.state.selection.$from.depth), 1);
await page.selectOption('#block-type', 'h2');
check('section tag', await page.evaluate(() => { const p = window.swEditor.state.selection.$from.parent; return p.type.name + p.attrs.level; }), 'heading2');
check('tag bar follows cursor', await page.inputValue('#block-type'), 'h2');

// function keys
await page.keyboard.press('F3');
check('F3 body text', await page.inputValue('#block-type'), 'paragraph');
await page.keyboard.press('F11');
check('F11 section', await page.inputValue('#block-type'), 'h2');
await page.keyboard.press('F12');
check('F12 subsection', await page.inputValue('#block-type'), 'h3');
await page.keyboard.press('F3');
await page.keyboard.press('F8');
check('F8 bullet list', await page.inputValue('#item-tag'), 'bullet');
await page.keyboard.press('F2');
check('F2 remove item tag', await page.inputValue('#item-tag'), '');
await page.keyboard.press('F5');
await page.keyboard.type('B');
check('F5 bold', await page.evaluate(() => { const s = window.swEditor.state; return s.doc.rangeHasMark(s.selection.from - 1, s.selection.from, s.schema.marks.bold); }), true);
// find / replace
await page.keyboard.press('Control+w');
await page.fill('#find-text', 'Theorem');
await page.fill('#replace-text', '定理');
await page.click('#replace-all');
check('Ctrl+W replace all', await page.evaluate(() => window.swEditor.state.doc.textContent.includes('定理 text')), true);
await page.click('#find-close');
// find and replace inside formulas
await page.evaluate(() => window.sw.call('set', { latex: 'Let $x^2+y$ and $\\alpha x+\\exp x$ here.' }));
await page.waitForTimeout(300);
await page.keyboard.press('Control+q');
await page.fill('#find-text', 'x');
await page.click('#find-next');
check('Ctrl+Q finds a formula', await page.evaluate(() => window.swEditor.state.selection.node?.attrs.latex), 'x^2+y');
await page.keyboard.press('Control+w');
await page.fill('#find-text', 'x');
await page.fill('#replace-text', 't');
await page.click('#replace-all');
check('replace all inside formulas', await page.evaluate(() => window.sw.call('formulas').then((r) => r.result.map((f) => f.latex).join('|'))), 't^2+y|\\alpha t+\\exp t');
await page.click('#find-close');

// Ctrl+= zooms, F1 help
await page.keyboard.press('Control+=');
check('Ctrl+= zoom in', await page.textContent('#status-zoom'), '110%');
await page.keyboard.press('F1');
check('F1 help', await page.isVisible('#help'), true);

console.log('page errors:', errs);
console.log(fails ? `${fails} FAILED` : 'all passed');
await b.close();
process.exit(fails ? 1 : 0);
