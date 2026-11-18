// The Compute menu of Scientific Word 5.5, done with SymPy.
// A formula (LaTeX) is parsed into MathJSON by the CortexJS Compute Engine here,
// then computed by SymPy in a background worker (engine/worker.mjs, engine/opensw_compute.py).
import { standardTeX } from './tex55.js';

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
  if (!worker && !webAssemblyAllowed()) throw new Error('這個網頁不允許執行計算引擎，請用桌面版');
  if (!worker) {
    worker = new Worker(new URL('./engine/worker.mjs', document.baseURI), { type: 'module' });
    const timer = setTimeout(() => fail('計算引擎載入逾時（這個網頁可能不允許執行計算引擎，請用桌面版）'), LOAD_TIMEOUT);
    worker.onmessage = (e) => {
      if (e.data.ready) { clearTimeout(timer); return; }
      if (e.data.fatal) { clearTimeout(timer); fail('計算引擎載入失敗：' + e.data.fatal); return; }
      const { id, result, error } = e.data;
      const w = waiting.get(id);
      waiting.delete(id);
      if (!w) return;
      if (error) w.reject(new Error(error)); else w.resolve(JSON.parse(result));
    };
    worker.onerror = (e) => { clearTimeout(timer); fail('計算引擎載入失敗：' + (e.message || '這裡可能不允許執行計算引擎')); };
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
  const json = JSON.stringify({ expr, var: typeof v === 'string' ? v : 'x', a, b, n });
  const id = nextId++;
  const w = getWorker();
  const result = await new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, op: 'plot', json });
  });
  if (result.error) throw new Error(result.error);
  return result;
}

// op: evaluate | numeric | simplify | expand | factor | solve | check |
//     determinant | inverse | transpose | eigenvalues
// -> { kind: 'value', latex } | { kind: 'solutions', solutions: [latex] } | { kind: 'boolean', value }
export async function compute(op, latex) {
  const json = JSON.stringify(await toMathJson(latex));
  const id = nextId++;
  const w = getWorker();
  const result = await new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    w.postMessage({ id, op, json });
  });
  if (result.error) throw new Error(result.error);
  return result;
}
