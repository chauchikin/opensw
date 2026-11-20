// Tools > Exam Builder and Insert > Formula: a 5.x exam template (.qiz) read and saved back with
// its \FORMULA macros; exams made from it with new random values, checked against the template.
// Also two reading fixes found with it: comment lines one after another, and \{..\} in a list item.
// node test/exam.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { stripComments } from '../src/tex55.js';
import { formula55 } from '../src/export.js';
let fails = 0;
const check = (ok, what) => { console.log(ok ? 'ok  ' : 'FAIL', what); if (!ok) fails++; };

// 1. no browser
check(stripComments('a $%\n%X{1}%\n%BeginExpansion\nb%\n%EndExpansion\n$ 50\\% c') === 'a $b$ 50\\% c', 'comment lines one after another all removed, \\% kept');
check(formula55('2\\FORMULA{a+b}{a+b}{evaluate}') === '2%\n%TCIMACRO{\\FORMULA{a+b}{a+b}{evaluate}}%\n%BeginExpansion\na+b%\n%EndExpansion\n', '\\FORMULA written as 5.x writes it');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1200, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(600);
const menu = async (top, ...items) => {
  await page.click(`.menu-top:has-text("${top}")`);
  for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
};
const maths = () => page.evaluate(() => { const l = []; window.swEditor.state.doc.descendants((n) => { if (n.type.name.startsWith('math')) l.push(n.attrs.latex); }); return l; });
// the document as lines: each block's text with its formulas as $..$
const lines = () => page.evaluate(() => { const l = []; window.swEditor.state.doc.forEach((n) => { let s = ''; n.descendants((c) => { if (c.isText) s += c.text; if (c.type.name.startsWith('math')) s += '$' + c.attrs.latex + '$'; }); l.push(s); }); return l; });
const open = async (file) => {
  await page.setInputFiles('#file', file);
  if (await page.isVisible('#confirm')) await page.click('#confirm-ok');
  await page.waitForTimeout(1000);
};

// 2. reading the template
await open('test/fixtures/exam/drill.qiz');
let m = await maths();
check(m.includes('\\FORMULA{a+b}{a+b}{evaluate}') && m.includes('\\FORMULA{(x+c)^{2}}{x^{2}+2cx+c^{2}}{expand}'), 'formulas kept as \\FORMULA{expr}{value}{operation}');
const items = await page.evaluate(() => { const l = []; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'list_item') l.push(n.textContent + '|' + n.childCount); }); return l; });
check(items.length === 8, `each \\item its own item (${items.length})`);
// saved back as 5.x: the TCI macros again, and read back the same
const t55 = Buffer.from(await page.evaluate(() => window.swTex55ForTests())).toString('latin1').replace(/\r\n/g, '\n');
check(/\$%\n%TCIMACRO\{\\FORMULA\{a\+b\}\{a\+b\}\{evaluate\}\}%\n%BeginExpansion\na\+b%\n%EndExpansion\n\$\\correctchoice\{\}/.test(t55), 'saved as 5.x: TCI macro, then \\correctchoice');
fs.writeFileSync('/tmp/drill-back.qiz', t55);
const before = m;
await open('/tmp/drill-back.qiz');
check(JSON.stringify(await maths()) === JSON.stringify(before), 'read back: the same formulas');

// 3. making exams
const make = async (n, seed, key = true) => {
  await menu('工具', '考卷產生器…');
  await page.fill('#d-n', String(n));
  await page.fill('#d-seed', seed == null ? '' : String(seed));
  if (!key) await page.uncheck('#d-key');
  await page.click('#dialog-ok');
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(500);
    const t = await page.textContent('#toast');
    if (/已產生|失敗/.test(t)) return t;
  }
  return 'timeout';
};
await open('test/fixtures/exam/drill.qiz');
let msg = await make(3, 42);
check(/已產生 3 份/.test(msg), msg);
const L = await lines();
const num = (s) => +s.replace(/[{}$]/g, '');
let good = 0;
for (let v = 1; v <= 3; v++) {
  const start = L.indexOf(`第 ${v} 份`);
  const ans = L.indexOf(`第 ${v} 份的答案`);
  const ex = L.slice(start, ans);
  const key = L.slice(ans, v < 3 ? L.indexOf(`第 ${v + 1} 份`) : undefined);
  // the text: p < q from {2, 3, 5, 7, 11}
  const [p, q] = (ex[1].match(/\$\{(\d+)\}\$/g) || []).map(num);
  const textOk = [2, 3, 5, 7, 11].includes(p) && [2, 3, 5, 7, 11].includes(q) && p < q;
  // question 1: a + b, a ≠ b in 2..9, the right choice in the key is a + b
  const q1 = ex.find((s) => s.startsWith('1. What is'));
  const [a, bb] = (q1.match(/\{(\d+)\}/g) || []).map(num);
  const choices = ex.slice(ex.indexOf(q1) + 1, ex.indexOf(q1) + 5);
  const right = (key.find((s) => s.startsWith('1. ')) || '').match(/\(([A-D])\)/)?.[1];
  const picked = choices.find((s) => s.startsWith(`(${right})`));
  const q1Ok = a >= 2 && a <= 9 && bb >= 2 && bb <= 9 && a !== bb && picked && num(picked.slice(4)) === a + bb && choices[3] === '(D) None of these';
  // question 2: (x + c)^2 expanded, d = c^2 in the key; or its variant: half of m
  const q2 = ex.find((s) => s.startsWith('2. '));
  let q2Ok;
  if (/Expand/.test(q2)) {
    const c = +q2.match(/x \+ (\d+)/)[1];
    q2Ok = ex.some((s) => s === `(A) \${x^{2} + ${2 * c} x + ${c * c}}$`) && key.includes(`$d={${c * c}}$`) && ex.includes('答：＿＿＿＿＿＿＿＿＿＿');
  } else {
    const mm = num(q2.match(/\{(\d+)\}/)[0]);
    q2Ok = [4, 6, 8].includes(mm) && ex.some((s) => s === `(A) \${${mm / 2}}$`);
  }
  // part 2: not numbered
  const p2Ok = ex.includes('Write a sentence about primes.');
  if (textOk && q1Ok && q2Ok && p2Ok) good++;
  else console.log('  version', v, { textOk, q1Ok, q2Ok, p2Ok }, ex, key);
}
check(good === 3, `3 exams: values follow the setups and conditions, the answers are right (${good}/3)`);
check(!L.some((s) => /Setup|Condition|rand|FORMULA|correctchoice|InputField/.test(s)), 'no template keywords or macros left in the exams');
const first = JSON.stringify(L);
// the same seed: the same exams; the template is still open in the Window menu
await menu('視窗', '下一個文件');
await page.waitForTimeout(300);
check((await maths()).some((x) => x.includes('\\FORMULA')), 'the template is the other document');
await make(3, 42);
check(JSON.stringify(await lines()) === first, 'the same seed makes the same exams');
await menu('視窗', '下一個文件');
await page.waitForTimeout(300);
// the template's own Seed (12345) when the box is empty: still the same each time
await make(1, null, false);
const s1 = JSON.stringify(await lines());
await menu('視窗', '下一個文件'); await page.waitForTimeout(300);
await make(1, null, false);
check(JSON.stringify(await lines()) === s1 && !s1.includes('答案'), 'the template\'s Seed keyword; no answers when unchecked');

// 4. a formula shows its value; Insert > Formula; a document that is no template
await page.evaluate(() => window.sw.call('set', { latex: 'X $\\FORMULA{p}{17}{evaluate}$.' }));
await page.waitForTimeout(400);
check(await page.evaluate(() => { const t = document.querySelector('.math-inline math-field').shadowRoot.textContent; return t.includes('17') && !t.includes('p'); }), 'a formula shows its value');
await page.evaluate(() => window.sw.call('set', { latex: 'Value: ' }));
await page.evaluate(() => { const v = window.swEditor; v.dispatch(v.state.tr.setSelection(window.swTextSelection.atEnd(v.state.doc))); v.focus(); });
await menu('插入', '考卷公式…');
await page.fill('#d-expr', 'a+b');
await page.selectOption('#d-op', 'expand');
await page.click('#dialog-ok');
check((await maths()).includes('\\FORMULA{a+b}{a+b}{expand}'), 'Insert > Formula');
await menu('工具', '考卷產生器…');
check(/不是考卷範本/.test(await page.textContent('#toast')) && !(await page.isVisible('#dialog')), 'a document that is no template: message');

check(!errs.length, 'no page errors ' + errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
