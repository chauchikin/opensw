// The Compute menu of Scientific Word 5.5, done with SymPy (or Mathematica, if chosen).
// A formula (LaTeX) is parsed into MathJSON by the CortexJS Compute Engine here,
// then computed by SymPy in a background worker (engine/worker.mjs, engine/opensw_compute.py)
// or, in the desktop app with Tools > Computation Engine set to Mathematica, by a Wolfram
// kernel (engine/opensw_compute.wl): the Compute menu, plots and the Exam Builder alike.
import { standardTeX } from './tex55.js';
import { settings } from './settings.js';
import { _t } from './i18n.js';

let worker = null;
let nextId = 0;
const waiting = new Map();
let ce = null;
const LOAD_TIMEOUT = 60000; // the engine has to finish loading within this time

function fail(message) {
  for (const w of waiting.values()) w.reject(new Error(message));
  waiting.clear();
  worker?.terminate();
  worker = null;
}

// some pages (e.g. a hosted preview) forbid WebAssembly; the engine needs it
function webAssemblyAllowed() {
  try { new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); return true; } catch (e) { return false; }
}

function getWorker() {
  if (!worker && !webAssemblyAllowed()) throw new Error(_t('這個網頁不允許執行計算引擎，請用桌面版'));
  if (!worker) {
    worker = new Worker(new URL('./engine/worker.mjs', document.baseURI), { type: 'module' });
    const timer = setTimeout(() => fail(_t('計算引擎載入逾時（這個網頁可能不允許執行計算引擎，請用桌面版）')), LOAD_TIMEOUT);
    worker.onmessage = (e) => {
      if (e.data.ready) { clearTimeout(timer); return; }
      if (e.data.fatal) { clearTimeout(timer); fail(_t('計算引擎載入失敗：') + e.data.fatal); return; }
      const { id, result, error } = e.data;
      const w = waiting.get(id);
      waiting.delete(id);
      if (!w) return;
      if (error) w.reject(new Error(error)); else w.resolve(JSON.parse(result));
    };
    worker.onerror = (e) => { clearTimeout(timer); fail(_t('計算引擎載入失敗：') + (e.message || _t('這裡可能不允許執行計算引擎'))); };
  }
  return worker;
}

export const isEngineLoaded = () => !!worker;

// start loading the engine in the background (the first load takes a few seconds)
export function preloadEngine() { try { getWorker(); } catch (e) { /* reported when computing */ } }

// LaTeX -> MathJSON (the Compute Engine is loaded the first time it is needed)
async function toMathJson(latex) {
  if (!ce) {
    const { ComputeEngine } = await import('@cortex-js/compute-engine');
    ce = new ComputeEngine();
  }
  return ce.parse(standardTeX(latex)).json;
}

// LaTeX -> MathJSON as written, not simplified (1/2+1/3 stays a sum): for Check with Lean
export async function formulaJson(latex) {
  await toMathJson('0');
  return ce.parse(standardTeX(latex), { canonical: false }).json;
}

// y values of a function of one variable for a plot:
// -> { x: [...], y: [number or null] } at n+1 points from a to b
export async function plotPoints(latex, variable, a, b, n) {
  const expr = await toMathJson(latex);
  const v = (await toMathJson(variable || 'x'));
  return ask('plot', JSON.stringify({ expr, var: typeof v === 'string' ? v : 'x', a, b, n }));
}

// z values of a function of two variables for a 3D plot:
// -> { x: [...], y: [...], z: [[number or null]] } (z[i][j] at x[i], y[j])
export async function plotGrid(latex, vars, [a, b], [c, d], n, m) {
  const expr = await toMathJson(latex);
  const names = [];
  for (const v of vars) { const j = await toMathJson(v); names.push(typeof j === 'string' ? j : names.length ? 'y' : 'x'); }
  return ask('plot3d', JSON.stringify({ expr, vars: names, a, b, c, d, n, m }));
}

const run = (op, payload) => ask(op, JSON.stringify(payload));
const nameOf = async (v, fallback) => { const j = await toMathJson(v); return typeof j === 'string' ? j : fallback; };

// values of formulas on a grid of the variables (n+1 points over each range, the last
// variable running fastest) -> { axes: [[...]], values: [[number or null]] }.
// grad: the partial derivatives of the one formula instead; complex: the name of a complex
// variable z = x + iy (vars are x, y), giving the real and imaginary parts.
export async function plotValues(latexes, vars, ranges, ns, { grad = false, complex = null } = {}) {
  const exprs = [];
  for (const l of latexes) exprs.push(await toMathJson(l));
  const names = [];
  for (const v of vars) names.push(await nameOf(v, 'xyz'[names.length]));
  return run('plotn', { exprs, vars: names, ranges, ns, grad, complex: complex && (await nameOf(complex, 'z')) });
}

// Plot 2D > ODE: equations y' = f(x, y) (LaTeX) and initial values [[name, x0, value]]
// -> { x: [...], y: { name: [...] }, var }
export async function odePoints(equations, inits, a, b, n) {
  const eqs = [];
  for (const l of equations) eqs.push(await toMathJson(l));
  const iv = [];
  for (const [name, x0, v] of inits) iv.push([name, await toMathJson(x0), await toMathJson(v)]);
  return run('odeplot', { eqs, inits: iv, a, b, n });
}

// Tools > Exam Builder: LaTeX -> MathJSON (exam.js builds the request), and one version's values
export const latexToMathJson = (latex) => toMathJson(latex);
export const examFormulas = (payload) => run('exam', payload);

// op: evaluate | numeric | simplify | expand | factor | solve | check |
//     determinant | inverse | transpose | eigenvalues ... (see opensw_compute.py)
// params: more input some operations ask for (byparts: the part u; iterate: start, count ...),
//   each LaTeX, or a word written as 'word'
// -> { kind: 'value', latex } | { kind: 'solutions', solutions: [latex], label? } | { kind: 'boolean', value }
//    | { kind: 'text', text }
export async function compute(op, latex, params) {
  const expr = await toMathJson(latex);
  const json = JSON.stringify(params ? { expr, params: await Promise.all(params.map((p) => (p.startsWith("'") ? p : toMathJson(p)))) } : expr);
  // with Mathematica, definitions go to SymPy too, for anything Mathematica leaves to it
  if (useMathematica() && (op === 'define' || op === 'cleardefs')) sympy(op, json).catch(() => {});
  return ask(op, json);
}

// (plotdata.js, which uses this file, is also loaded by tests outside a browser)
const useMathematica = () => '__TAURI_INTERNALS__' in globalThis && settings().engine === 'mathematica';

// one operation by the chosen engine; Mathematica answers {fallback: true} for an
// operation it does not know, which SymPy then does
async function ask(op, json) {
  if (useMathematica()) {
    const { wolframCompute } = await import('./desktop.js');
    const r = await wolframCompute(settings().wolframKernel, op, json);
    if (!r.fallback) {
      if (r.error) throw new Error(engineMessage(r.error));
      return r;
    }
  }
  return sympy(op, json);
}

async function sympy(op, json) {
  const id = nextId++;
  const w = getWorker();
  const result = await new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, op, json });
  });
  if (result.error) throw new Error(engineMessage(result.error));
  return result;
}

// the engines answer in Chinese: "還不能計算：<why>"
function engineMessage(m) {
  const why = m.match(/^還不能計算：([^]*)$/);
  return why ? _t('還不能計算：{0}', _t(why[1])) : _t(m);
}
