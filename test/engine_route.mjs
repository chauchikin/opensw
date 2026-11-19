// Tools > Computation Engine in the desktop app, with a stand-in for the desktop shell and an
// engine on the computer (Mathematica): the Compute menu goes to engine_compute (base64
// MathJSON in, base64 JSON out), plots too, an operation the engine leaves to SymPy
// ({fallback: true}) goes to SymPy, definitions reach both, an engine started again gets
// them again, and Clear Definitions clears both. (Engines themselves: scripts/engine-check.mjs.)
// Run: node test/engine_route.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => {
  const enc = (o) => { let s = ''; for (const x of new TextEncoder().encode(JSON.stringify(o))) s += String.fromCharCode(x); return btoa(s); };
  const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  window.engineCalls = [];
  window.mDefs = []; // the definitions the stand-in Mathematica has
  window.mRunning = false; // its program is running (false: the next call starts it)
  const answer = (op) => {
    if (op === 'define' && window.mNoOde && /^\["OdeNumeric"/.test(window.lastJson)) return { fallback: true };
    if (op === 'define') return { kind: 'value', latex: 'a=3' };
    if (op === 'cleardefs') return { kind: 'solutions', solutions: [] };
    if (op === 'byparts') return { fallback: true };
    if (op === 'version') return { kind: 'solutions', solutions: ['Mathematica 14.3'] };
    if (op === 'simplify') return { error: '還不能計算：測試' };
    if (op === 'plot') return { kind: 'points', x: [0, 1], y: [0, 7] };
    if (op === 'evaluate') return { kind: 'value', latex: 'defs:' + window.mDefs.join('|') };
    return { kind: 'value', latex: '(x+1)^2' };
  };
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd, args) => {
      if (cmd === 'engine_list') return [{ id: 'mathematica', name: 'Mathematica', example: 'C:\\W\\14.3\\wolfram.exe' }];
      if (cmd !== 'engine_compute') return null;
      const json = dec(args.data);
      window.engineCalls.push({ engine: args.engine, program: args.program, op: args.op, json });
      window.lastJson = json;
      const started = !window.mRunning;
      if (started) { window.mRunning = true; window.mDefs = []; }
      if (args.op === 'define') window.mDefs.push(json);
      if (args.op === 'cleardefs') window.mDefs = [];
      return { data: enc(answer(args.op)), started };
    },
  };
  // the setting as 0.5.0 kept it
  if (!sessionStorage.getItem('set')) {
    localStorage.setItem('opensw-settings', JSON.stringify({ engine: 'mathematica', wolframKernel: 'C:\\W\\wolfram.exe' }));
    sessionStorage.setItem('set', '1');
  }
});
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(800);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 200)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const calls = () => page.evaluate(() => window.engineCalls);

let r = await call('compute', { latex: 'x^2+2x+1', op: 'factor' });
let c = (await calls()).at(-1);
check('factor goes to Mathematica (the 0.5.0 kernel setting kept)', r.ok && r.result.latex === '(x+1)^2' && c.op === 'factor' && c.engine === 'mathematica' && c.program === 'C:\\W\\wolfram.exe', { r, c });
check('the MathJSON arrives intact', JSON.parse(c.json)[0] === 'Add', c.json);
r = await call('compute', { latex: '\\alpha_1+é', op: 'factor' });
c = (await calls()).at(-1);
check('non-ASCII survives the base64 trip', c.json.includes('alpha') && c.json.includes('é'), c.json);
r = await call('compute', { latex: 'x', op: 'simplify' });
check('a Mathematica error is shown', !r.ok && /測試/.test(JSON.stringify(r)), r);
r = await call('compute', { latex: '\\int x e^x dx', op: 'byparts', params: ['x'] });
check('fallback answer comes from SymPy', r.ok && /e\^\{x\}/.test(r.result.latex), r);
r = await call('compute', { latex: 'a=3', op: 'define' });
r = await call('compute', { latex: '\\int a x\\,dx', op: 'byparts', params: ['x'] });
check('a definition also reaches SymPy', r.ok && r.result.latex.includes('3'), r);
r = await call('compute', { latex: 'a', op: 'evaluate' });
check('Mathematica has the definition once', r.ok && r.result.latex.split('|').length === 1 && r.result.latex.includes('Equal'), r);
// Mathematica stops; the next computation starts it again: it gets the definition again first
await page.evaluate(() => { window.mRunning = false; });
r = await call('compute', { latex: 'a', op: 'evaluate' });
check('an engine started again gets the definitions again', r.ok && r.result.latex.split('|').length === 1 && r.result.latex.includes('Equal'), r);
await page.evaluate(() => { window.mRunning = false; });
await call('compute', { latex: 'b=4', op: 'define' });
r = await call('compute', { latex: 'a', op: 'evaluate' });
check('... also when the computation that started it was a definition', r.ok && /"a"/.test(r.result.latex) && /"b"/.test(r.result.latex), r);
r = await call('compute', { latex: '0', op: 'cleardefs' });
r = await call('compute', { latex: 'a', op: 'evaluate' });
const r2 = await call('compute', { latex: '\\int a x\\,dx', op: 'byparts', params: ['x'] });
check('Clear Definitions clears both engines', r.result.latex === 'defs:' && r2.ok && !r2.result.latex.includes('3'), { r, r2 });
// Solve ODE > Numeric: an engine that does it keeps y, so y(1) goes to it; one that answers
// fallback leaves y to SymPy, and a formula with y goes to SymPy alone
const ode = "\\begin{pmatrix}y'=y\\\\y(0)=1\\end{pmatrix}";
r = await call('compute', { latex: ode, op: 'odenumeric' });
let n = (await calls()).length;
const r3 = await call('compute', { latex: 'y(1)', op: 'evaluate' });
c = (await calls()).slice(n);
check('Solve ODE > Numeric done by Mathematica: y(1) is asked of it', r.ok && c.length === 1 && c[0].op === 'evaluate' && /OdeNumeric/.test(r3.result.latex), { r, c });
await call('compute', { latex: '0', op: 'cleardefs' });
await page.evaluate(() => { window.mNoOde = true; });
r = await call('compute', { latex: ode, op: 'odenumeric' });
n = (await calls()).length;
const r4 = await call('compute', { latex: 'y(1)', op: 'evaluate' });
c = (await calls()).slice(n);
check('... and when Mathematica cannot, by SymPy, y(1) too', r.ok && r.result.solutions[0] === 'y' && r4.ok && r4.result.latex === '2.7183' && c.length === 0, { r, r4, c });
await call('compute', { latex: '0', op: 'cleardefs' });
await page.evaluate(() => { window.mNoOde = false; });
// plots go to Mathematica too
const pts = await page.evaluate(() => window.swComputeForTests.plotPoints('x^2', 'x', 0, 1, 1));
c = (await calls()).at(-1);
check('a plot is computed by Mathematica', c.op === 'plot' && pts.y[1] === 7 && JSON.parse(c.json).n === 1, { pts, c });
// the dialog: choosing SymPy sends nothing more to Mathematica
await page.evaluate(() => { localStorage.setItem('opensw-settings', JSON.stringify({ engine: 'sympy' })); });
const before = (await calls()).length;
r = await call('compute', { latex: 'x^2-1', op: 'factor' });
check('SymPy chosen: Mathematica not asked', r.ok && (await calls()).length === before && r.result.latex.includes('x - 1'), r);
// Tools > Computation Engine: the engines on the computer are listed; choose Mathematica and
// its program; it then shows the version
await page.click('.menu-top:has-text("工具")');
await page.locator('.menu-list button:has(> span:text-is("計算引擎…"))').filter({ visible: true }).first().click();
await page.check('input[name="d-eng"][value="mathematica"]');
await page.fill('input[data-eng="mathematica"]', 'D:\\M\\wolfram.exe');
await page.click('#dialog-ok');
await page.waitForTimeout(500);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('opensw-settings')));
c = (await calls()).at(-1);
check('the dialog saves the choice and asks Mathematica for its version', saved.engine === 'mathematica' && saved.enginePrograms.mathematica === 'D:\\M\\wolfram.exe' && c.op === 'version' && c.program === 'D:\\M\\wolfram.exe', { saved, c });
console.log('page errors', errs);
await b.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
