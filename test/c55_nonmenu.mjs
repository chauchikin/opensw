// Gaps that are not menu items: the built-in SymPy's time limit, Power Series of a Taylor series
// in good time, a ctex document keeping its own Chinese fonts, the table of the line-by-line check
// in the Changes panel, and the Exam Builder's Points, Select, Print Choices, pictures and online quiz.
// node test/c55_nonmenu.mjs  (needs `npx vite build` and `npx vite preview --port $OPENSW_PORT`)
import { chromium } from 'playwright';
import { schema } from '../src/schema.js';
import { toLatex, originalTex55 } from '../src/export.js';
import { readLatex } from '../src/tex55.js';

let fails = 0;
const check = (ok, what, detail) => { console.log(ok ? 'ok  ' : 'FAIL', what, ok || detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)); if (!ok) fails++; };

// ---------- 3. ctex chooses its own Chinese fonts (no browser)
const ours = 'Noto Serif CJK TC';
const body = '\\begin{document}\n中文段落\n\\end{document}\n';
check(!originalTex55('\\documentclass{ctexart}\n' + body).includes(ours), 'ctexart: no Chinese font of ours added');
check(!originalTex55('\\documentclass{article}\n\\usepackage[UTF8]{ctex}\n' + body).includes(ours), '\\usepackage[UTF8]{ctex}: none added');
check(originalTex55('\\documentclass{article}\n%\\usepackage{ctex}\n' + body).includes(ours), 'ctex only in a comment: ours added as before');
check(originalTex55('\\documentclass{article}\n' + body).includes(ours), 'no ctex: ours added as before');
const zh = schema.nodes.doc.create(null, [schema.nodes.paragraph.create(null, schema.text('中文'))]);
const withCtex = toLatex(zh, { preambleTeX: '\\usepackage{ctex}' });
check(!withCtex.includes(ours) && !withCtex.includes('\\usepackage{xeCJK}'), 'a LaTeX document with ctex: neither xeCJK nor our font before it', withCtex.slice(0, 300));
check(toLatex(zh, {}).includes(ours), 'without ctex: xeCJK and our font as before');

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage({ viewport: { width: 1300, height: 950 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(800);
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);

// ---------- 2. Power Series of e^{sin x} (was slow: SymPy was asked for 8 more powers)
let t = Date.now();
let r = await call('compute', { latex: 'e^{\\sin x}', op: 'series', params: ['x', '6', '0'] });
const secs = (Date.now() - t) / 1000;
check(r.ok && /1\+x\+\\frac\{1\}\{2\}x\^\{2\}-\\frac\{1\}\{8\}x\^\{4\}-\\frac\{1\}\{15\}x\^\{5\}\+O\\left\(x\^\{6\}\\right\)/.test(r.result.latex.replace(/\s/g, '')), `Power Series of e^{sin x}, 6 terms (${secs.toFixed(1)} s with loading)`, r);
t = Date.now();
r = await call('compute', { latex: '\\tan x\\, e^{\\sin x}', op: 'series', params: ['x', '7', '0'] });
check(r.ok && (Date.now() - t) < 20000, `tan x e^{sin x}, 7 terms, in the page within 20 s (${((Date.now() - t) / 1000).toFixed(1)} s)`, r);

// ---------- 1. the built-in SymPy's time limit: stopped, started again, the definitions sent again
await call('compute', { latex: 'a=3', op: 'define' });
await page.evaluate(() => { window.OPENSW_TIME_LIMIT_MS = 1500; });
t = Date.now();
r = await call('compute', { latex: 'x^{2001}-y^{2001}', op: 'factor' });
check(!r.ok && /SymPy did not answer within 2 seconds and was stopped/.test(r.error) && Date.now() - t < 15000, `a computation over the limit is stopped (${((Date.now() - t) / 1000).toFixed(1)} s)`, r);
await page.evaluate(() => { delete window.OPENSW_TIME_LIMIT_MS; });
r = await call('compute', { latex: 'a+1' });
check(r.ok && r.result.latex === '4', 'the next computation works, with the definition a = 3 again', r);

// ---------- 4. the Changes panel: a table of the named steps (line-by-line check)
await call('compute', { op: 'cleardefs', latex: '0' });
await call('set', { latex: '\\documentclass{article}\\begin{document}\nLet\n\\[ f(x)=x^{2}e^{x}. \\]\nThen\n\\[ g(x)=\\frac{d}{dx}f(x)=(x^{2}+2x)e^{x}. \\]\nWrong:\n\\[ g(1)=2e \\]\nAnd\n\\[ h=1 \\]\n\\end{document}' });
await call('nameSteps');
await call('setStep', { name: 's1', trust: 'the definition of f' });
await call('setStep', { name: 's2', uses: ['s1'] });
await call('setStep', { name: 's3', uses: ['s2'] });
await page.keyboard.press('Control+Shift+D');
await page.click('#rv-tabs button[data-tab="list"]');
await page.waitForSelector('#rv-list table.rv-steps', { timeout: 10000 });
let rows = await page.$$eval('#rv-list table.rv-steps tbody tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())));
check(rows.length === 4 && rows[0][0] === 's1' && /Trusted/.test(rows[0][2]) && /Not checked/.test(rows[1][2]), 'the table lists every named step: s1 trusted, the others not checked', rows);
await page.click('#rv-check-named');
await page.waitForFunction(() => { const b = document.querySelector('#rv-check-named'); return b && !b.disabled; }, null, { timeout: 180000 });
rows = await page.$$eval('#rv-list table.rv-steps tbody tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent.trim())));
check(/Passed/.test(rows[1][2]) && /Failed/.test(rows[2][2]) && /Passed 1, failed 1/.test(await page.textContent('#rv-list')), 'Check all named steps: g passes, g(1) = 2e fails, the counts above', rows);
const before = await page.evaluate(() => window.swEditor.state.selection.from);
await page.click('#rv-list table.rv-steps tbody tr:nth-child(3)');
const at = await page.evaluate(() => { const s = window.swEditor.state; const $p = s.doc.resolve(s.selection.from); return $p.index(0); });
check(at === 5 && before !== await page.evaluate(() => window.swEditor.state.selection.from), 'a row takes the cursor to its formula (block 6)', at);
await page.keyboard.press('Control+Shift+D');

// ---------- 5. the Exam Builder, its keywords as 5.5's reference (ebrefkeyword.tex) gives them
const formula = (expr, op = 'evaluate') => `$%\n%TCIMACRO{\\FORMULA{${expr}}{${expr}}{${op}}}%\n%BeginExpansion\n${expr}%\n%EndExpansion\n$`;
const choices = (right, wrong) => `\\subsection{Choices}\n\n\\begin{itemize}\n\\item ${right}\\correctchoice{}\n\n\\item ${wrong}\n\\end{itemize}\n\n`;
const q = (n, setup = '') => `\\section{Question}\n\n\\subsection{Setup}\n\n${setup}$a${n}:=\\func{rand}(2,9)$\n\n\\subsection{Statement}\n\nQ${n}: what is ${formula(`a${n}+1`)}?\n\n${choices(formula(`a${n}+1`), formula(`a${n}+2`))}`;
const template = (setup, questions) => `\\documentclass{article}\n\\begin{document}\n\\section{Exam}\n\n\\section{Setup}\n\n${setup}\n\n${questions}\\end{document}\n`;
const lines = () => page.evaluate(() => { const l = []; window.swEditor.state.doc.forEach((n) => { let s = ''; n.descendants((c) => { if (c.isText) s += c.text; if (c.type.name.startsWith('math')) s += '$' + c.attrs.latex + '$'; }); l.push(s); }); return l; });
const builder = async (quiz) => {
  await page.click('.menu-top:text-is("Tools")');
  await page.locator('.menu-list button:has(> span:text-is("Exam Builder..."))').filter({ visible: true }).first().click();
  await page.fill('#d-seed', '7');
  if (quiz) await page.check('#d-quiz');
  await page.click('#dialog-ok');
  await page.waitForFunction(() => window.swEditor.state.doc.textContent.includes('Answers'), null, { timeout: 120000 });
};
const build = async (tex, { quiz = false } = {}) => { await call('set', { latex: tex }); await builder(quiz); return lines(); };
// a long formula 5.x breaks across lines ("%TCIMACRO{%" then "%\FORMULA{..")
const broken = readLatex('\\begin{document}\n$%\n%TCIMACRO{%\n%\\FORMULA{a+1}{a+1}{evaluate}}%\n%BeginExpansion\na+1%\n%EndExpansion\n$\n\\end{document}').doc;
let fl = null; broken.descendants((n) => { if (n.type.name.startsWith('math')) fl = n.attrs.latex; });
check(fl === '\\FORMULA{a+1}{a+1}{evaluate}', 'a \\FORMULA broken across lines is read as one', fl);
// Questions: Number numbers them; without it they are not numbered; Points is not printed
let L = await build(template('Questions: Number\n\nPoints: 2', q(1, 'Points: 5\n\n') + q(2)));
check(L.some((l) => /^1\. Q1/.test(l)) && L.some((l) => /^2\. Q2/.test(l)) && !L.some((l) => /points/.test(l)), 'Questions: Number numbers the questions; Points is not printed', L);
L = await build(template('', q(1)));
check(L.some((l) => /^Q1/.test(l)), 'without Questions: Number, no number', L);
// Select (a Question's Setup): how many of its variants, each a question
const variant = (n) => `\\section{Variant}\n\n\\subsection{Statement}\n\nV${n}?\n\n${choices('yes', 'no')}`;
L = await build(template('Questions: Number', '\\section{Question}\n\n\\subsection{Setup}\n\nSelect: 2\n\n' + variant(1) + variant(2) + variant(3)));
const vs = L.filter((l) => /^\d\. V\d\?/.test(l));
check(vs.length === 2 && vs[0].startsWith('1.') && vs[1].startsWith('2.'), 'Select: 2 of the 3 variants, each a question', L);
// Print Choices: what a printed exam shows instead of the buttons; Choices: No Break and Choice Space
L = await build(template('Print Choices: a, b, c\n\nChoices: No Break\n\nChoice Space: 3', q(1)));
const one = L.find((l) => /^a \$.*\u2003\u2003\u2003b \$/.test(l));
check(!!one && L.at(-1).endsWith(')a'), 'Print Choices: a, b; No Break puts them on one line, Choice Space 3 em apart; the key says a', L);
// Question Space: empty lines after each question
L = await build(template('Question Space: 2', q(1) + q(2)));
const after = L.indexOf(L.find((l) => /^\(B\)/.test(l)));
check(L[after + 1] === '' && L[after + 2] === '' && /^Q2/.test(L[after + 3]), 'Question Space: 2 empty lines after a question', L);
// a free-form Response, Text Area lines high
L = await build(template('Text Area: 4, 50', '\\section{Question}\n\n\\subsection{Statement}\n\nProve it.\n\n\\subsection{Response}\n\n'));
const proveAt = L.indexOf('Prove it.');
check(L.slice(proveAt + 1, proveAt + 5).every((l) => l === '') && L[proveAt + 5] === 'Answers', 'a Response section: an empty area, Text Area 4 lines', L);
// functions defined in a Setup (\limfunc too), distinct(), gcd of random numbers, u_{1} := .., e a variable
const fns = `$\\limfunc{Area}(x)=x^{2}$\n\n$\\func{nplaces}(x,n)=1.0\\cdot \\left\\lfloor 10^{n}x+.5\\right\\rfloor /10^{n}$`;
const q5 = `\\section{Question}\n\n\\subsection{Setup}\n\n$u_{1}:=\\func{rand}(2,9)$\n\n$u_{2}:=\\func{rand}(2,9)$\n\n$e:=\\gcd (u_{1},u_{2})$\n\nCondition: $e\\neq 1\\wedge \\func{distinct}(u_{1},u_{2})$\n\n\\subsection{Statement}\n\nS ${formula('\\limfunc{Area}(u_{1})')} ${formula('\\func{nplaces}(\\pi ,3)')} ${formula('e')} ${formula('u_{1}')} ${formula('u_{2}')}\n\n${choices('yes', 'no')}`;
L = await build(template(fns, q5));
const nums = (L.find((l) => l.startsWith('S ')) || '').match(/\$\{?([^$}]*)\}?\$/g)?.map((x) => x.replace(/[${}\s]/g, ''));
const [area, pi3, e, u1, u2] = nums || [];
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
check(nums?.length === 5 && +area === u1 * u1 && pi3 === '3.142' && +e === gcd(+u1, +u2) && +e !== 1 && u1 !== u2, 'Setup functions (\\limfunc, nplaces), distinct, gcd of the random u_1, u_2, e as a variable', nums);
// Choices: Check, each choice worth its item label's points
L = await build(template('', `\\section{Question}\n\n\\subsection{Setup}\n\nChoices: Check\n\n\\subsection{Statement}\n\nPrimes?\n\n\\subsection{Choices}\n\n\\begin{itemize}\n\\item[-1] 1\n\n\\item[1] 2\n\n\\item[1] 3\n\n\\item[-1] 9\n\\end{itemize}\n\n`), { quiz: true });
check(L.at(-1).endsWith('(B) (C)'), 'Choices: Check: the right ones are those worth points, (B) (C)', L);
let html = await page.evaluate(() => window.swQuizHtmlForTests);
const quiz = await b.newPage();
await quiz.setContent(html);
check((await quiz.$$('input[type="checkbox"][name="q1"]')).length === 4, 'the quiz page has check boxes');
await quiz.check('input[value="B"]'); await quiz.check('input[value="C"]');
await quiz.click('#quiz-check');
check(/Score: 1 of 1 points/.test(await quiz.textContent('#quiz-score')), 'both right ones checked: full points', await quiz.textContent('#quiz-score'));
await quiz.check('input[value="A"]');
await quiz.click('#quiz-check');
check(/Score: 0.5 of 1 points/.test(await quiz.textContent('#quiz-score')), 'one wrong one too: its -1 taken off (1 of 2 points worth)', await quiz.textContent('#quiz-score'));
// InputField(MATH) and GradeProc: givecredit(response = ..): a typed answer with the same values is right
const short = `\\section{Question}\n\n\\subsection{Setup}\n\n$b:=\\func{rand}(2,5)$\n\nPoints: 4\n\n\\subsection{Statement}\n\nExpand ${formula('(x+b)^{2}')}; b is ${formula('b')}\n\n\\subsection{Choices}\n\nInputField(MATH)\n\nGradeProc: givecredit($\\limfunc{response}=(x+b)^{2}$)\n\n`;
L = await build(template('Title: Practice Drill\n\nSubmit: Click to Grade', short), { quiz: true });
check(!L.some((l) => /GradeProc/.test(l)) && L.some((l) => /Answer: _+/.test(l)), 'GradeProc is not printed; the blank is', L);
html = await page.evaluate(() => window.swQuizHtmlForTests);
const bv = +(L.find((l) => l.startsWith('Expand')) || '').match(/b is \$\{?(\d)\}?\$/)?.[1];
await quiz.setContent(html);
check(/<title>Practice Drill<\/title>/.test(html) && (await quiz.textContent('#quiz-check')) === 'Click to Grade', 'Title is the page title, Submit the button', html.slice(0, 200));
await quiz.fill('input[name="q1"]', `x^2 + ${2 * bv}x + ${bv * bv}`);
await quiz.click('#quiz-check');
check(/Score: 4 of 4 points/.test(await quiz.textContent('#quiz-score')), `x^2+${2 * bv}x+${bv * bv} is (x+${bv})^2: 4 of 4 points (Points: 4)`, await quiz.textContent('#quiz-score'));
await quiz.fill('input[name="q1"]', `x^2 + ${bv * bv}`);
await quiz.click('#quiz-check');
check(/Score: 0 of 4 points/.test(await quiz.textContent('#quiz-score')), 'a wrong one: 0 points', await quiz.textContent('#quiz-score'));
// Images: an image-select question, graded when a picture is clicked
await build(template('Images: first.bmp, next.bmp', q(1)), { quiz: true });
html = await page.evaluate(() => window.swQuizHtmlForTests);
await quiz.setContent(html);
check((await quiz.$$('button.quiz-image img[src="first.bmp"]')).length === 1 && (await quiz.$$('button.quiz-image img[src="next.bmp"]')).length === 1, 'Images: the choices are the pictures named', html.match(/<button[^]*?<\/button>/)?.[0]);
await quiz.click('button.quiz-image[data-v="A"]');
check((await quiz.$$('.quiz-right')).length === 1, 'clicking the right picture grades it at once');
// Action, Method, Database, ItemId, Record: a form that sends the answers there
await build(template('Action: https://example.edu/grade\n\nMethod: get\n\nDatabase: calc101\n\nItemId: FRACTIONS\n\nRecord: Student Choice', q(1)), { quiz: true });
const sent = await page.evaluate(() => window.swQuizHtmlForTests);
check(/<form id="quiz" action="https:\/\/example.edu\/grade" method="get">/.test(sent) && /name="database" value="calc101"/.test(sent) && /name="itemid" value="FRACTIONS"/.test(sent)
  && /type="checkbox" name="record"/.test(sent) && !/id="quiz-check"/.test(sent), 'Action, Method, Database, ItemId, Record: Student Choice', sent.slice(sent.indexOf('<form'), sent.indexOf('<form') + 300));
// the template's pictures go with the exams
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
await call('set', { latex: template('', q(1).replace('?\n\n\\subsection{Choices}', '?\n\n\\includegraphics{dot.png}\n\n\\subsection{Choices}')) });
await page.evaluate(async (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); await window.swPictures.loadPictures(null, new Map([['dot.png', bytes]])); }, png);
await builder(false);
await page.waitForTimeout(500);
const pic = await page.evaluate(() => { let p = null; window.swEditor.state.doc.descendants((n) => { if (n.type.name === 'image') p = n.attrs.path; }); return [p, window.swPictures.assets.has('dot.png')]; });
check(pic[0] === 'dot.png' && pic[1], 'a picture in a question is in the exams, its file too', pic);

check(!errs.length, 'no page errors', errs);
await b.close();
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
