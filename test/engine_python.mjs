// SymPy in the desktop app, with a stand-in for the desktop shell and for the Python that
// comes with it (the engine "python" of engine/engines.json): with nothing chosen in Tools >
// Engine Setup the Compute menu goes to that Python and Pyodide is not loaded; what it
// leaves ({fallback: true}) goes to the SymPy in Pyodide; definitions and the Compute settings
// reach it, again after it was started again; when it cannot be started the SymPy in Pyodide
// answers and the user is told once; with Mathematica chosen it comes after Mathematica.
// (The real Python against the cases: node scripts/engine-check.mjs sympy [python.exe].)
// Run: node test/engine_python.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => {
  const enc = (o) => { let s = ''; for (const x of new TextEncoder().encode(JSON.stringify(o))) s += String.fromCharCode(x); return btoa(s); };
  const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  window.engineCalls = [];
  // the stand-in Python: the definitions and settings it has; running: false, the next call
  // starts it; broken: it cannot be started (the desktop shell answers with an error)
  window.py = { defs: [], options: '', running: false, broken: false };
  window.workers = 0; // how many times Pyodide was started
  const RealWorker = window.Worker;
  window.Worker = class extends RealWorker { constructor(...a) { super(...a); window.workers++; } };
  const python = (op, json) => {
    const py = window.py;
    if (op === 'version') return { kind: 'solutions', solutions: ['SymPy 1.14.0', 'Python 3.13'] };
    if (op === 'define') { py.defs.push(json); return { kind: 'value', latex: 'a=3' }; }
    if (op === 'cleardefs') { py.defs = []; return { kind: 'solutions', solutions: [] }; }
    if (op === 'setoptions') { py.options = json; return { kind: 'text', text: '' }; }
    if (op === 'byparts') return { fallback: true };
    if (op === 'evaluate') return { kind: 'value', latex: `defs:${py.defs.join('|')} digits:${py.options ? JSON.parse(py.options).digits : 5}` };
    if (op === 'simplify') return { error: 'Cannot compute this yet: test' };
    return { kind: 'value', latex: '\\text{python}' };
  };
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd, args) => {
      if (cmd === 'engine_list') return [{ id: 'python', name: 'SymPy', example: 'C:\\Python313\\python.exe' }, { id: 'mathematica', name: 'Mathematica', example: 'C:\\W\\14.3\\wolfram.exe' }];
      if (cmd !== 'engine_compute') return null;
      const json = dec(args.data);
      window.engineCalls.push({ engine: args.engine, program: args.program, op: args.op, json });
      if (args.engine === 'mathematica') return { data: enc(args.op === 'factor' ? { kind: 'value', latex: '\\text{mathematica}' } : { fallback: true }), started: false };
      const py = window.py;
      if (py.broken) { py.running = false; throw `Cannot find SymPy (${args.program || 'C:\\opensw\\engine\\python\\python.exe'}): program not found. Its location can be set in Tools > Engine Setup`; }
      const started = !py.running;
      if (started) Object.assign(py, { running: true, defs: [], options: '' });
      return { data: enc(python(args.op, json)), started };
    },
  };
});
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(800);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 300)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const calls = () => page.evaluate(() => window.engineCalls);
const ops = (list) => list.map((c) => `${c.engine} ${c.op}`).join(', ');
const workers = () => page.evaluate(() => window.workers);
const toast = () => page.textContent('#toast');

// nothing chosen: the Python is asked first (its version, to see that it starts), Pyodide not at all
let r = await call('compute', { latex: 'x^2+2x+1', op: 'factor' });
let c = await calls();
check('nothing chosen: factor goes to the Python', r.ok && r.result.latex === '\\text{python}' && ops(c) === 'python version, python factor' && c[1].program === null, { r, c: ops(c) });
check('the MathJSON arrives intact', JSON.parse(c[1].json)[0] === 'Add', c[1].json);
check('Pyodide is not loaded for it', (await workers()) === 0, await workers());
r = await call('compute', { latex: 'x', op: 'simplify' });
check('an error of the Python is shown, Pyodide is not asked', !r.ok && /測試|test/.test(JSON.stringify(r)) && (await workers()) === 0, r);
// what the Python leaves goes to the SymPy in Pyodide
r = await call('compute', { latex: '\\int x e^x dx', op: 'byparts', params: ['x'] });
check('a fallback answer comes from the SymPy in Pyodide', r.ok && /e\^\{x\}/.test(r.result.latex) && (await workers()) === 1, r);

// definitions and the Compute settings
r = await call('compute', { latex: 'a=3', op: 'define' });
r = await call('compute', { latex: 'a', op: 'evaluate' });
check('the Python has a definition once', r.ok && /^defs:\["Equal","a",3\] /.test(r.result.latex), r);
r = await call('compute', { latex: '\\int a x\\,dx', op: 'byparts', params: ['x'] });
check('... and the SymPy in Pyodide has it too', r.ok && r.result.latex.includes('3'), r);
await page.evaluate(() => { localStorage.setItem('opensw-settings', JSON.stringify({ compute55: { digits: 8 } })); });
r = await call('compute', { latex: 'a', op: 'evaluate' });
check('a Compute setting reaches the Python', r.ok && r.result.latex.endsWith('digits:8'), r);
// the Python stops; the next computation starts it again: definitions and settings first
await page.evaluate(() => { window.py.running = false; });
r = await call('compute', { latex: 'a', op: 'evaluate' });
check('a Python started again gets the definitions and settings again', r.ok && r.result.latex === 'defs:["Equal","a",3] digits:8', r);
await page.evaluate(() => { window.py.running = false; });
await call('compute', { latex: 'b=4', op: 'define' });
r = await call('compute', { latex: 'a', op: 'evaluate' });
check('... also when the computation that started it was a definition', r.ok && /"a",3\]\|\["Equal","b",4\] digits:8/.test(r.result.latex), r);
r = await call('compute', { latex: '0', op: 'cleardefs' });
r = await call('compute', { latex: 'a', op: 'evaluate' });
const r2 = await call('compute', { latex: '\\int a x\\,dx', op: 'byparts', params: ['x'] });
check('Clear Definitions clears the Python and Pyodide', r.result.latex === 'defs: digits:8' && r2.ok && !r2.result.latex.includes('3'), { r, r2 });

// the Python stops and does not start again: the same computation is answered by the SymPy in
// Pyodide (with the definitions), the user is told once, and the Python is not tried again
await call('compute', { latex: 'a=3', op: 'define' });
await page.evaluate(() => { window.py.broken = true; document.querySelector('#toast').textContent = ''; });
r = await call('compute', { latex: 'a+a', op: 'evaluate' });
check('the Python cannot be started: the SymPy in Pyodide answers, with the definition', r.ok && r.result.latex === '6', r);
let line = await toast();
check('the user is told, in the interface language', /SymPy 改在 Pyodide 裡跑/.test(line) && /找不到 SymPy（C:\\opensw\\engine\\python\\python\.exe）/.test(line), line);
let n = (await calls()).length;
await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
r = await call('compute', { latex: 'x^2-1', op: 'factor' });
check('... once, and the Python is not tried again', r.ok && r.result.latex.includes('x - 1') && (await calls()).length === n && (await toast()) === '', { r, toast: await toast() });

// Tools > Engine Setup says so under SymPy, and takes another Python: that one is tried
await page.click('.menu-top:has-text("工具")');
await page.locator('.menu-list button:has(> span:text-is("計算引擎…"))').filter({ visible: true }).first().click();
const dlg = await page.textContent('#dialog');
check('the dialog shows the line and no engine named Python to choose', /SymPy 改在 Pyodide 裡跑/.test(dlg) && (await page.locator('input[name="d-eng"]').count()) === 2 && /Python 的位置/.test(dlg), dlg);
await page.evaluate(() => { window.py.broken = false; });
await page.fill('input[data-eng="python"]', 'D:\\py\\python.exe');
await page.click('#dialog-ok');
await page.waitForTimeout(500);
c = (await calls()).at(-1);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('opensw-settings')));
check('another Python set in the dialog is started and shows its version', saved.engine === 'sympy' && saved.enginePrograms.python === 'D:\\py\\python.exe' && c.op === 'version' && c.program === 'D:\\py\\python.exe' && /Python 3\.13/.test(await toast()), { saved, c, toast: await toast() });
r = await call('compute', { latex: 'a', op: 'evaluate' });
check('... and has the definitions', r.ok && r.result.latex.startsWith('defs:["Equal","a",3]'), r);

// a Python that cannot be started from the beginning (a new page): told once, Pyodide answers
await page.evaluate(() => { localStorage.setItem('opensw-settings', JSON.stringify({ engine: 'mathematica' })); });
await page.reload(); await page.waitForTimeout(800);
// Mathematica chosen: Mathematica, then the Python, then Pyodide
r = await call('compute', { latex: 'x^2+2x+1', op: 'factor' });
c = await calls();
check('Mathematica chosen: it answers first, the Python is not started', r.ok && r.result.latex === '\\text{mathematica}' && ops(c) === 'mathematica factor', { r, c: ops(c) });
n = c.length;
r = await call('compute', { latex: 'x^2+2x+1', op: 'expand' });
c = (await calls()).slice(n);
check('... what it leaves goes to the Python', r.ok && r.result.latex === '\\text{python}' && ops(c) === 'mathematica expand, python version, python expand' && (await workers()) === 0, { r, c: ops(c) });
r = await call('compute', { latex: '\\int x e^x dx', op: 'byparts', params: ['x'] });
check('... and what both leave to the SymPy in Pyodide', r.ok && /e\^\{x\}/.test(r.result.latex) && (await workers()) === 1, r);
await page.evaluate(() => { localStorage.setItem('opensw-settings', '{}'); window.py.broken = true; });
await page.reload(); await page.waitForTimeout(800);
await page.evaluate(() => { window.py.broken = true; });
r = await call('compute', { latex: 'x^2-1', op: 'factor' });
line = await toast();
check('no Python from the start: the SymPy in Pyodide answers and the user is told', r.ok && r.result.latex.includes('x - 1') && /SymPy 改在 Pyodide 裡跑/.test(line), { r, line });
console.log('page errors', errs);
await b.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
