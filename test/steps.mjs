// Derivation steps (steps.js): names kept beside the document, what each step uses, checking,
// "unchecked again" after a change, finding a formula again after it moved or 5.5 saved it.
// node test/steps.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import { statements, zeroTests, canon, nameFormulas, splitTop, rowsOf } from '../src/steps.js';

let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail ?? '').slice(0, 400)); };

// ---------- reading a formula (no browser needed)
check('a row splits at \\qquad', splitTop('a=b,\\qquad c=d', '\\qquad').length === 2);
let st = statements('w_0=\\frac{1}{y},\\qquad A_0=\\frac{\\partial}{\\partial y}w_0=-\\frac{1}{y^{2}}.');
check('two statements, each defines a name', st.length === 2 && st[0].def === 'w_0=\\frac{1}{y}' && st[1].def === 'A_0=-\\frac{1}{y^{2}}', st);
check('the equality between the other sides is the check', st[0].chain.length === 0 && st[1].chain.length === 1 && st[1].chain[0][1] === '-\\frac{1}{y^{2}}', st);
check('an inequality is not a chain of equalities', statements('x^2\\geq 0')[0].chain.length === 0 && statements('a<b=c')[0].chain.length === 0);
const zt = zeroTests('e^{x}', '1+x+O(x^{2})');
check('O(x^2) becomes two tests at 0', zt.tests.length === 2 && zt.tests[1].includes('\\partial x') && zt.tests[0].includes('x=0'), zt);
check("5.5's \\prime and spacing do not count", canon("\\Psi^{\\prime }(y) + \\alpha x") === canon("\\Psi'(y)+\\alpha x") && canon('\\alpha x') !== canon('\\alphax'));

// several rows (align, eqnarray, gather as the editor keeps them)
check('a row that starts with = goes on from the row before', rowsOf('\\begin{array}{rcl}(x+1)^{2} &=& x^{2}+2x+1 \\\\ &=& x(x+2)+1\\end{array}').length === 1 && statements('\\begin{array}{rcl}(x+1)^{2} &=& x^{2}+2x+1 \\\\ &=& x(x+2)+1\\end{array}')[0].chain.length === 2, rowsOf('\\begin{array}{rcl}(x+1)^{2} &=& x^{2}+2x+1 \\\\ &=& x(x+2)+1\\end{array}'));
st = statements('\\begin{aligned}a &= 1 \\\\[2pt] b &= a+1\\end{aligned}');
check('other rows are statements of their own (\\\\[2pt] is spacing)', st.length === 2 && st[0].def === 'a=1' && st[1].def === 'b=a+1', st);
check('a matrix in a row is not split', rowsOf('\\begin{aligned}M &= \\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}\\end{aligned}').length === 1 && rowsOf('\\begin{aligned}M &= \\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix}\\end{aligned}')[0].includes('1 & 2 \\\\ 3 & 4'));
check('a formula of one row is its own row', rowsOf('a=b').join() === 'a=b');

// which formula has which name: moved, new ones around it, rewritten
const lines = { s1: { key: canon('a=1') }, s2: { key: canon('b=2') }, s3: { key: canon('c=3') } };
const F = (...l) => l.map((latex, block) => ({ block, latex, label: null }));
let nf = nameFormulas(F('c=3', 'a=1', 'b=2'), lines);
check('moved formulas keep their names', nf.formulas.map((f) => f.name).join() === 's3,s1,s2' && nf.lost.length === 0, nf);
nf = nameFormulas(F('a=1', 'x=9', 'b=2', 'y=8', 'c=3'), lines);
check('new formulas between them get no name', nf.formulas.map((f) => f.name).join() === 's1,,s2,,s3', nf);
nf = nameFormulas(F('a=1', 'b=22', 'c=3'), lines);
check('a rewritten formula is found by its place', nf.formulas[1].name === 's2' && nf.formulas[1].by === 'position', nf);
nf = nameFormulas(F('a=1', 'b=22', 'z=0', 'c=3'), lines);
check('rewritten and a new one beside it: nothing is guessed', nf.formulas[1].name === null && nf.formulas[2].name === null && nf.lost.join() === 's2', nf);
nf = nameFormulas([{ block: 0, latex: 'a=1', label: 'eq:a' }, { block: 1, latex: 'b=2', label: null }], lines);
check('a \\label is the name', nf.formulas[0].name === 'eq:a' && nf.formulas[0].by === 'label' && nf.formulas[1].name === 's2', nf);

// ---------- in the editor (desktop app with its files stood in for)
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
// a small derivation of its own: f = x^2 e^x, its derivative, the value at 0, a series
const file = ['%2multibyte Version: 5.50.0.2960 CodePage: 950', '\\documentclass{article}', '%TCIDATA{OutputFilter=LATEX.DLL}',
  '\\input{tcilatex}', '\\begin{document}', '', 'Let', '\\[', 'f(x)=x^{2}e^{x}.', '\\]', 'Then', '\\[', "g(x)=\\frac{d}{dx}f(x)=(x^{2}+2x)e^{x},\\qquad g(0)=0.", '\\]',
  'Near 0', '\\[', 'f(x)=x^{2}+x^{3}+O(x^{4}).', '\\]', 'A wrong one:', '\\begin{equation}', 'g(1)=2e \\label{eq:wrong}', '\\end{equation}',
  'Several rows:', '\\begin{eqnarray*}', 'a &=&1 \\\\', 'b &=&2', '\\end{eqnarray*}', '', '\\end{document}', ''].join('\r\n');
await page.addInitScript((text) => {
  const files = new Map([['C:\\Work\\D.tex', Array.from(new TextEncoder().encode(text))]]);
  window.shell = { files };
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd, args) => {
      if (cmd === 'read_file') { if (files.has(args.path)) return files.get(args.path); throw new Error('no such file'); }
      if (cmd === 'write_file') { files.set(args.path, args.data); return null; }
      if (cmd === 'file_exists') return files.has(args.path);
      return null;
    },
  };
  localStorage.setItem('opensw-settings', JSON.stringify({ aiFolders: ['C:\\Work'], engine: 'sympy' }));
}, file);
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(800);
const call = async (cmd, args) => { const r = await page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]); if (!r.ok) throw new Error(`${cmd}: ${r.error}`); return r.result; };
const side = () => page.evaluate(() => { const d = window.shell.files.get('C:\\Work\\D.steps.json'); return d ? JSON.parse(new TextDecoder().decode(Uint8Array.from(d))) : null; });
const docText = () => page.evaluate(() => new TextDecoder().decode(Uint8Array.from(window.shell.files.get('C:\\Work\\D.tex'))));

await call('open', { path: 'C:\\Work\\D.tex' });
let r = await call('steps');
check('a labelled formula is a step from the start; looking writes no file', r.steps.length === 1 && r.steps[0].name === 'eq:wrong' && r.problems.length === 4 && (await side()) === null, r);
check('formulas and outline give the label', (await call('formulas')).some((f) => f.label === 'eq:wrong') && (await call('outline')).some((o) => o.label === 'eq:wrong'));
r = await call('nameSteps');
check('nameSteps names the others in the file, a formula of several rows too', r.named.map((n) => n.name).join() === 's1,s2,s3,s4' && r.steps.map((s) => s.name).join() === 's1,s2,s3,eq:wrong,s4', r);
check('the document is not changed by it', (await page.evaluate(() => window.sw.get())) && !(await call('get')).includes('\\label{s1}') && Object.keys((await side()).lines).join() === 's1,s2,s3,eq:wrong,s4');

await call('setStep', { name: 's1', trust: 'the definition of f' });
await call('setStep', { name: 's2', uses: ['s1'], note: 'the derivative of f, and its value at 0' });
await call('setStep', { name: 's3', uses: ['s1'] });
await call('setStep', { name: 'eq:wrong', uses: [] });
let t = Date.now();
r = await call('checkSteps');
const row = (n) => r.steps.find((s) => s.name === n);
check(`checkSteps: the derivative and f = .. + O(x^4) (a statement about a name it uses) pass, the trusted one is not checked (${((Date.now() - t) / 1000).toFixed(1)}s)`, row('s1').status === 'trusted' && row('s2').status === 'pass' && row('s3').status === 'pass', r.steps);
check('a name the step does not use: unknown, with the name', row('eq:wrong').status === 'unknown' && /g \(defined in s2\)/.test(row('eq:wrong').why), row('eq:wrong'));
await call('setStep', { name: 'eq:wrong', uses: ['s2'] });
r = await call('checkSteps', { names: ['eq:wrong'] });
check('with what it uses: g(1) = 2e fails (it is 3e)', row('eq:wrong').status === 'fail', row('eq:wrong'));
let one = await call('steps', { name: 's2' });
check('one step in full: what was asked', one.result.checks.length === 2 && one.result.checks[0].asked[0].result === 'equal' && one.result.scope.some((x) => x.from === 's1'), one);
check('the user\'s definitions are put back after a check', (await call('compute', { op: 'showdefs', latex: '0' })).solutions.length === 0);
await call('compute', { op: 'define', latex: 'q=7' });
await call('checkSteps', { names: ['s3'] });
check('... also when there was one', (await call('compute', { latex: 'q+1' })).latex === '8');
await call('compute', { op: 'cleardefs', latex: '0' });

// a change puts the step, and the steps using it, back to unchecked
await call('replaceBlock', { index: 1, latex: '\\[ f(x)=x^{3}e^{x}. \\]' });
r = await call('steps');
check('a rewritten formula keeps its name (by its place); the steps using it are unchecked again', row('s1').namedBy === 'position' && row('s2').status === 'unchecked' && row('s3').status === 'unchecked' && row('eq:wrong').status === 'fail', r.steps);
await call('undo');
r = await call('steps');
check('undone: as before', row('s2').status === 'pass' && row('s3').status === 'pass', r.steps);
// a new formula in front, and one moved
await call('insert', { index: -1, latex: '\\[ h=1 \\]' });
r = await call('steps');
check('a new formula in front: the names stay with their formulas', row('s2').status === 'pass' && row('s2').block === 4 && r.problems.some((p) => p.startsWith('block 0')), r);
await call('undo');

// what 5.5 writes differently when it saves does not count
await call('replaceBlock', { index: 3, latex: "\\[ g(x)=\\frac{d}{dx}f(x)=(x^{2}+2x)e^{x},\\qquad g(0)=0. \\]" });
await call('insert', { latex: "\\[ g^{\\prime }(x)=\\frac{d}{dx}g(x) \\]" });
r = await call('nameSteps');
const sNew = r.named[0].name;
await call('setStep', { name: sNew, trust: 'notation' });
await call('setFormula', { n: (await call('formulas')).findLast((f) => f.display).n, latex: "g'(x)=\\frac{d}{dx}g(x)" });
r = await call('steps');
check("f' for f^{\\prime}: the same formula", row(sNew).namedBy === 'file' && r.problems.every((p) => !p.includes('rewritten')), r);

// a lost name is given to a formula with setStep block
await call('deleteBlock', { index: 1 });
r = await call('steps');
check('a deleted formula: its name is lost, said so', r.problems.some((p) => p.startsWith('s1:')) && !row('s1'), r);
await call('undo');

// names into the document as \label
r = await call('nameSteps', { inDocument: true });
check('inDocument writes the names as labels', r.labelled.join() === `s1,s2,s3,s4,${sNew}` && r.steps.every((s) => s.namedBy === 'label'), r);
const tex = await call('get');
check('the labels are in the LaTeX, the formulas not numbered', /x\^\{2\}e\^\{x\}\.?\s*\\label\{s1\}/.test(tex) && !/\\begin\{equation\}[^]*\\label\{s1\}/.test(tex), tex.slice(0, 600));
check('several rows: the label is on the first row', /a\s*&\s*=\s*&\s*1\s*\\label\{s4\}\s*\\\\/.test(tex) && tex.split('\\label{s4}').length === 2, tex.slice(tex.indexOf('Several rows'), tex.indexOf('Several rows') + 300));
r = await call('checkSteps');
check('and the checks are as before', row('s2').status === 'pass' && row('s3').status === 'pass' && row('eq:wrong').status === 'fail', r.steps);

// given groups
await call('insert', { latex: '\\[ p=a^{2}-4 \\]' });
r = await call('nameSteps');
const sP = r.named[0].name;
await call('setGiven', { name: 'ex1', defs: ['a=2'] });
await call('setStep', { name: sP, uses: ['ex1'], extra: [{ latex: 'p', equals: '0', why: 'with a = 2' }] });
r = await call('checkSteps', { names: [sP] });
check('a given group is used', row(sP).status === 'pass' && r.given.join() === 'ex1', row(sP));
let bad = await page.evaluate(() => window.sw.call('setGiven', { name: 'ex2', defs: ['a+b'] }));
check('a given that is not a definition is refused', !bad.ok && /Not a definition/.test(bad.error), bad);
bad = await page.evaluate(() => window.sw.call('setStep', { name: 'nope', note: 'x' }));
check('an unknown step is refused, with the names', !bad.ok && /There is no step nope/.test(bad.error), bad);

// a formula of several rows is one step: its rows are checked as one chain
await call('insert', { latex: '\\begin{eqnarray*} (x+1)^{2} &=& x^{2}+2x+1 \\\\ &=& x(x+2)+1 \\end{eqnarray*}' });
r = await call('nameSteps');
const sRows = r.named[0].name;
r = await call('checkSteps', { names: [sRows] });
one = await call('steps', { name: sRows });
check('several rows: both equalities of the chain are checked and pass', row(sRows).status === 'pass' && one.result.checks.length === 2, one);
await call('setFormula', { n: (await call('formulas')).findLast((f) => f.display).n, latex: '\\begin{array}{rcl}(x+1)^{2} &=& x^{2}+2x+1 \\\\ &=& x(x+2)+2\\end{array}' });
r = await call('checkSteps', { names: [sRows] });
check('... and a wrong row fails', row(sRows).status === 'fail' && /x\(x\+2\)\+2/.test(row(sRows).why), row(sRows));

// saved under another name: the steps file goes with the document, and replaces none that is there
const stepsOf = (name) => page.evaluate((n) => { const d = window.shell.files.get(`C:\\Work\\${n}.steps.json`); return d ? JSON.parse(new TextDecoder().decode(Uint8Array.from(d))) : null; }, name);
await call('save', { path: 'C:\\Work\\E.tex' });
let moved = await stepsOf('E');
check('Save As: the steps are beside the new file', moved && moved.doc === 'E.tex' && Object.keys(moved.lines).join() === Object.keys((await side()).lines).join() && moved.lines.s2.result.status === 'pass', moved && Object.keys(moved.lines));
r = await call('steps');
check('... and the open document has them', r.file === 'C:\\Work\\E.steps.json' && row('s2').status === 'pass', r);
await call('setStep', { name: 's1', note: 'changed in E' });
await call('save', { path: 'C:\\Work\\D.tex' });
check('a steps file already beside the name saved to is kept', (await side()).lines.s1.note === '' && (await stepsOf('E')).lines.s1.note === 'changed in E', (await side()).lines.s1);

check('no page errors', errs.length === 0, errs);
await b.close();
process.exit(fails ? 1 : 0);
