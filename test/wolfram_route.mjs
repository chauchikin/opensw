// Tools > Computation Engine > Mathematica in the desktop app, with a stand-in for the
// desktop shell: the Compute menu goes to wolfram_compute (base64 MathJSON in, base64 JSON
// out), plots too, an operation Mathematica leaves to SymPy ({fallback: true}) goes to
// SymPy, and definitions reach both. (The Wolfram side itself: test/wolfram.wls.) Run: node test/wolfram_route.mjs
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.addInitScript(() => {
  const enc = (o) => { let s = ''; for (const x of new TextEncoder().encode(JSON.stringify(o))) s += String.fromCharCode(x); return btoa(s); };
  const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  window.wolframCalls = [];
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd, args) => {
      if (cmd !== 'wolfram_compute') return null;
      window.wolframCalls.push({ kernel: args.kernel, op: args.op, json: dec(args.data) });
      if (args.op === 'byparts' || args.op === 'define') return enc({ fallback: args.op === 'byparts', kind: 'value', latex: 'a=3' });
      if (args.op === 'version') return enc({ kind: 'solutions', solutions: ['Mathematica 14.3'] });
      if (args.op === 'simplify') return enc({ error: '還不能計算：測試' });
      if (args.op === 'plot') return enc({ kind: 'points', x: [0, 1], y: [0, 7] });
      return enc({ kind: 'value', latex: '(x+1)^2' });
    },
  };
  localStorage.setItem('opensw-settings', JSON.stringify({ engine: 'mathematica', wolframKernel: 'C:\\W\\wolfram.exe' }));
});
await page.goto('http://localhost:4173/?lang=zh-TW'); await page.waitForTimeout(800);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(detail ?? '').slice(0, 200)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const calls = () => page.evaluate(() => window.wolframCalls);

let r = await call('compute', { latex: 'x^2+2x+1', op: 'factor' });
let c = (await calls()).at(-1);
check('factor goes to Mathematica', r.ok && r.result.latex === '(x+1)^2' && c.op === 'factor' && c.kernel === 'C:\\W\\wolfram.exe', { r, c });
check('the MathJSON arrives intact', JSON.parse(c.json)[0] === 'Add', c.json);
r = await call('compute', { latex: '\\alpha_1+é', op: 'evaluate' });
c = (await calls()).at(-1);
check('non-ASCII survives the base64 trip', c.json.includes('alpha') && c.json.includes('é'), c.json);
r = await call('compute', { latex: 'x', op: 'simplify' });
check('a Mathematica error is shown', !r.ok && /測試/.test(JSON.stringify(r)), r);
r = await call('compute', { latex: '\\int x e^x dx', op: 'byparts', params: ['x'] });
check('fallback answer comes from SymPy', r.ok && /e\^\{x\}/.test(r.result.latex), r);
r = await call('compute', { latex: 'a=3', op: 'define' });
r = await call('compute', { latex: '\\int a x\\,dx', op: 'byparts', params: ['x'] });
check('a definition also reaches SymPy', r.ok && r.result.latex.includes('3'), r);
// plots go to Mathematica too
const pts = await page.evaluate(() => window.swComputeForTests.plotPoints('x^2', 'x', 0, 1, 1));
c = (await calls()).at(-1);
check('a plot is computed by Mathematica', c.op === 'plot' && pts.y[1] === 7 && JSON.parse(c.json).n === 1, { pts, c });
// the dialog: choosing SymPy sends nothing more to Mathematica
await page.evaluate(() => { localStorage.setItem('opensw-settings', JSON.stringify({ engine: 'sympy' })); });
const before = (await calls()).length;
r = await call('compute', { latex: 'x^2-1', op: 'factor' });
check('SymPy chosen: Mathematica not asked', r.ok && (await calls()).length === before && r.result.latex.includes('x - 1'), r);
// Tools > Computation Engine: choose Mathematica and a kernel path; it then shows the version
await page.click('.menu-top:has-text("工具")');
await page.locator('.menu-list button:has(> span:text-is("計算引擎…"))').filter({ visible: true }).first().click();
await page.check('input[name="d-eng"][value="mathematica"]');
await page.fill('#d-wk', 'D:\\M\\wolfram.exe');
await page.click('#dialog-ok');
await page.waitForTimeout(500);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('opensw-settings')));
c = (await calls()).at(-1);
check('the dialog saves the choice and asks Mathematica for its version', saved.engine === 'mathematica' && saved.wolframKernel === 'D:\\M\\wolfram.exe' && c.op === 'version' && c.kernel === 'D:\\M\\wolfram.exe', { saved, c });
console.log('page errors', errs);
await b.close();
console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
