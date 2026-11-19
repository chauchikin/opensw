// The Compute menu of Scientific Word 5.5. A formula (LaTeX) is parsed into MathJSON by the
// CortexJS Compute Engine here, then computed by the engines in turn (ENGINE.md): in the
// desktop app first the one chosen in Tools > Computation Engine (Mathematica, or another one
// in engine/engines.json), then SymPy, built in, in a background worker (engine/worker.mjs,
// engine/opensw_compute.py). The Compute menu, plots and the Exam Builder alike.
import { standardTeX } from './tex55.js';
import { settings } from './settings.js';
import { _t, _tm } from './i18n.js';
import { scopeDerivatives, explicitProducts, normalize, definedFunction, definedVector, vectorTeX, parseWithVectors, notation55, naturalLog, definitionOfI, odeRows, withSettings } from './mathjson.js';

let worker = null;
let workerStarted = false; // a new worker: it has none of the definitions yet
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
  if (!worker && !webAssemblyAllowed()) throw new Error(_t('This page does not allow the computation engine to run; please use the desktop app'));
  if (!worker) {
    worker = new Worker(new URL('./engine/worker.mjs', document.baseURI), { type: 'module' });
    workerStarted = true;
    const timer = setTimeout(() => fail(_t('The computation engine took too long to load (this page may not allow it to run; please use the desktop app)')), LOAD_TIMEOUT);
    worker.onmessage = (e) => {
      if (e.data.ready) { clearTimeout(timer); return; }
      if (e.data.fatal) { clearTimeout(timer); fail(_t('The computation engine failed to load: ') + e.data.fatal); return; }
      const { id, result, error } = e.data;
      const w = waiting.get(id);
      waiting.delete(id);
      if (!w) return;
      if (error) w.reject(new Error(error)); else w.resolve(JSON.parse(result));
    };
    worker.onerror = (e) => { clearTimeout(timer); fail(_t('The computation engine failed to load: ') + (e.message || _t('the computation engine may not be allowed to run here'))); };
  }
  return worker;
}

export const isEngineLoaded = () => !!worker;

// start loading the engine in the background (the first load takes a few seconds)
export function preloadEngine() { try { getWorker(); } catch (e) { /* reported when computing */ } }

// LaTeX -> MathJSON (the Compute Engine is loaded the first time it is needed), read as in
// mathematics (mathjson.js): x(a+b) is a product, d/dx acts on the next term, f'(y) is f's derivative,
// a 5.x \left[ array \right] is a matrix, \times and \cdot between vectors the cross and dot product
async function toMathJson(latex, options) {
  if (!ce) {
    const { ComputeEngine } = await import('@cortex-js/compute-engine');
    ce = new ComputeEngine();
  }
  const fns = definedFunctions();
  const vectors = new Set(definitions.map((d) => definedVector(JSON.parse(d))).filter(Boolean));
  const s = settings(); // \log in base 10, the basis variables (Tools > Computation Engine)
  const log = s.logBase10 ? (t) => t : naturalLog;
  const tex = explicitProducts(scopeDerivatives(vectorTeX(log(digits(notation55(standardTeX(latex)))), vectors.size > 0)), fns);
  return withSettings(normalize(parseWithVectors(ce, tex, vectors), fns, { ...options, vectors }), s);
}
// 5.x groups digits with thin spaces (77\,531, 0.170\,06, 3.\,1416): one number, not a product
const digits = (tex) => tex.replace(/(\d\.?)\s*\\,\s*(?=\d)/g, '$1');
// the functions made by Compute > Define (f(x) = ...) and Solve ODE > Numeric: f(x+1) stays f of x+1
function definedFunctions() {
  return new Set([...definitions.map((d) => definedFunction(JSON.parse(d))), ...sympyNames()].filter(Boolean));
}
// the functions of Solve ODE > Numeric (["OdeNumeric", eqs, [[name, x0, value, order] ..]]) and a_n = ..
// with its subscript chosen against the engines' rule ({expr, params}): names read as functions
const sympyNames = () => definitions.flatMap((d) => {
  const j = JSON.parse(d);
  return j[0] === 'OdeNumeric' ? j[2].slice(1).map((r) => r[1]) : j.params ? [j.expr[1]] : [];
});
// the functions of Solve ODE > Numeric and where their initial values are (a number, else 0): Plot 2D > ODE of y
export const numericStarts = () => new Map(definitions.flatMap((d) => {
  const j = JSON.parse(d);
  return j[0] === 'OdeNumeric' ? j[2].slice(1).map((r) => [r[1], typeof r[2] === 'number' ? r[2] : 0]) : [];
}));

// LaTeX -> MathJSON as written, not simplified (1/2+1/3 stays a sum): for Check with Lean
export async function formulaJson(latex) {
  await toMathJson('0');
  return ce.parse(digits(standardTeX(latex)), { canonical: false }).json;
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

// Plot 2D > ODE: equations y' = f(x, y) (LaTeX) and initial values [[name, x0, value, order]]
// -> { x: [...], y: { name: [...] }, var }
export async function odePoints(equations, inits, a, b, n) {
  const eqs = [];
  for (const l of equations) eqs.push(await toMathJson(l, { derivatives: false }));
  const iv = [];
  for (const [name, x0, v, k] of inits) iv.push([name, await toMathJson(x0), await toMathJson(v), k]);
  return run('odeplot', { eqs, inits: iv, a, b, n });
}

// Tools > Exam Builder: LaTeX -> MathJSON (exam.js builds the request), and one version's values
export const latexToMathJson = (latex) => toMathJson(latex);

// the variables of a formula (as one would type them: x, w_0, \\alpha) and how many equations it has
// (a column of them is a system): for the dialogs that ask which variable or unknowns, as 5.5 does
const NOT_VARIABLES = new Set(['Pi', 'ExponentialE', 'ImaginaryUnit', 'PositiveInfinity', 'NegativeInfinity', 'ComplexInfinity', 'True', 'False', 'Nothing']);
export async function formulaInfo(latex) {
  const json = await toMathJson(latex);
  const names = new Set();
  const functions = new Set(sympyNames()); // y of Solve ODE > Numeric is a function, not a variable
  const walk = (j) => {
    if (typeof j === 'string') { if (!j.startsWith("'") && !j.startsWith('opensw_') && !NOT_VARIABLES.has(j) && !functions.has(j)) names.add(j); return; }
    if (Array.isArray(j)) j.slice(1).forEach(walk);
  };
  walk(json);
  const show = (n) => n.replace(/^([A-Za-z]{2,})(?=_|$)/, '\\$1');
  const rows = Array.isArray(json) && json[0] === 'Matrix' && Array.isArray(json[1]) ? json[1].length - 1 : 1;
  return { variables: [...names].sort().map(show), equations: rows };
}
export const examFormulas = (payload) => run('exam', payload);

// op: evaluate | numeric | simplify | expand | factor | solve | check |
//     determinant | inverse | transpose | eigenvalues ... (all of them: ENGINE.md)
// params: more input some operations ask for (byparts: the part u; iterate: start, count ...),
//   each LaTeX, or a word written as 'word'
// -> { kind: 'value', latex } | { kind: 'solutions', solutions: [latex], label? } | { kind: 'boolean', value }
//    | { kind: 'text', text }
export async function compute(op, latex, params) {
  // Interpret Subscript (5.5 asks on defining a_i = ..): 'argument' (a_2 is a value, and i on the right
  // is the argument, not the imaginary unit) or 'name'
  let subscript = null;
  if (op === 'define' && params?.length === 1 && /^'(argument|name)'$/.test(params[0])) [subscript, params] = [params[0], undefined];
  // Solve ODE > Numeric: the equations and initial values of a column; the engine keeps the
  // solutions as functions (a definition), and answers ", Functions defined: y" as 5.5
  if (op === 'odenumeric') {
    const { equations, inits } = odeRows(latex);
    const eqs = [];
    for (const l of equations) eqs.push(await toMathJson(l, { derivatives: false }));
    const iv = [];
    for (const [name, x0, v, k] of inits) iv.push(['List', name, await toMathJson(x0), await toMathJson(v), k]);
    return ask('define', JSON.stringify(['OdeNumeric', ['List', ...eqs], ['List', ...iv]]));
  }
  // the ODE operation reads y' itself; in a definition of g(i), i is g's variable
  const expr = await toMathJson(op === 'define' ? definitionOfI(latex, subscript === "'argument'") : latex, { derivatives: op !== 'ode' });
  // the engines take a subscript for an argument when its letter is on the right (a_n = n^2); a choice
  // against that goes with the definition, which then only SymPy has
  if (subscript && Array.isArray(expr) && expr[0] === 'Equal' && typeof expr[1] === 'string' && expr[1].includes('_')) {
    const onRight = JSON.stringify(expr[2]).includes(JSON.stringify(expr[1].split('_')[1]));
    if ((subscript === "'argument'") !== onRight) params = [subscript];
  }
  // assume(real), assume(x, positive) ... are kept like definitions (every engine gets them, again after a restart)
  if (op === 'evaluate' && !params && Array.isArray(expr) && ASSUMPTIONS.has(expr[0])) op = 'define';
  // Principal Value Only (Tools > Computation Engine): one solution, asked for with the word 'principal'
  if (op === 'solve' && settings().solvePrincipal) params = [...(params || []), "'principal'"];
  const json = JSON.stringify(params ? { expr, params: await Promise.all(params.map((p) => (p.startsWith("'") ? p : toMathJson(p)))) } : expr);
  return ask(op, json);
}

const ASSUMPTIONS = new Set(['assume', 'additionally', 'unassume']);

// Compute > Definitions: the requests that made them (MathJSON text), in order. This is the
// one record of them; each engine is sent the ones it has not had (engine.sent) before it is
// asked anything, so an engine started later, or again, has them too.
const definitions = [];

// an engine: { run(op, json) -> { answer, started }, sent: how many definitions it has }
const sympyEngine = {
  sent: 0,
  async run(op, json) {
    const id = nextId++;
    const w = getWorker();
    const started = workerStarted;
    workerStarted = false;
    if (started) this.sent = 0;
    const answer = await new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      w.postMessage({ id, op, json });
    });
    return { answer, started };
  },
};

const outside = new Map(); // engine id -> the engine on this computer (desktop app)
function outsideEngine(id) {
  if (!outside.has(id)) {
    outside.set(id, {
      sent: 0,
      lacks: new Set(), // the names whose definition it does not do (it answered fallback)
      async run(op, json) {
        const { engineCompute } = await import('./desktop.js');
        const r = await engineCompute(id, settings().enginePrograms[id], op, json);
        if (r.started) { this.sent = 0; this.lacks.clear(); }
        return r;
      },
    });
  }
  return outside.get(id);
}

// the engines to ask, in turn; SymPy does every operation, so it comes last
// (plotdata.js, which uses this file, is also loaded by tests outside a browser).
// A formula with a name the chosen engine could not define (it answered fallback) goes to SymPy alone.
function engines(op, json) {
  const chosen = settings().engine;
  const desktop = '__TAURI_INTERNALS__' in globalThis;
  if (!desktop || chosen === 'sympy') return [sympyEngine];
  const other = outsideEngine(chosen);
  return [...other.lacks].some((n) => json.includes(JSON.stringify(n))) ? [sympyEngine] : [other, sympyEngine];
}

// the names a definition makes: x = .., f(x) = .., a_n = .. ({expr, params}), the functions of Solve ODE > Numeric
function definedNames(json) {
  const j = JSON.parse(json);
  if (j[0] === 'OdeNumeric') return j[2].slice(1).map((r) => r[1]);
  const e = j.params ? j.expr : j;
  return Array.isArray(e) && typeof e[1] === 'string' ? [e[1]] : [definedFunction(e)].filter(Boolean);
}
// what an engine answered to a definition: names it could not define are kept from it (engine.lacks)
function noteDefinition(engine, json, answer) {
  if (!engine.lacks) return;
  for (const n of definedNames(json)) answer.fallback ? engine.lacks.add(n) : engine.lacks.delete(n);
}

async function sendDefinitions(engine) {
  while (engine.sent < definitions.length) {
    const { answer, started } = await engine.run('define', definitions[engine.sent]);
    if (!started) noteDefinition(engine, definitions[engine.sent], answer);
    engine.sent = started ? 0 : engine.sent + 1; // started again: it lost the earlier ones
  }
}

// one operation: the first engine that does it answers ({fallback: true}: it does not)
async function ask(op, json) {
  if (op === 'cleardefs') {
    definitions.length = 0;
    for (const engine of [sympyEngine, ...outside.values()]) {
      engine.lacks?.clear();
      if (engine.sent) { engine.sent = 0; await engine.run(op, json).catch(() => {}); }
    }
    return { kind: 'solutions', solutions: [] };
  }
  for (const engine of engines(op, json)) {
    await sendDefinitions(engine);
    let { answer, started } = await engine.run(op, json);
    if (started && definitions.length) {
      await sendDefinitions(engine); // it was started just now, without them
      ({ answer } = await engine.run(op, json));
    }
    if (op === 'define' && !answer.error) noteDefinition(engine, json, answer);
    if (answer.fallback) continue;
    if (answer.error) throw new Error(_tm(answer.error));
    if (op === 'define') { definitions.push(json); engine.sent = definitions.length; }
    return localize(answer);
  }
  throw new Error(_tm('Cannot compute this yet: ' + op));
}

// The engines answer in English ("Cannot compute this yet: Needs an equals sign", ", standard form: ",
// \text{minimum}=7/5); put their words into the interface language.
// (only the engines' own words: other \text{...} in an answer is mathematics)
const inText = (latex) => latex.replace(/\\text\{(maximum|minimum|\(cannot compute: [^{}]*\))\}/g, (m, w) => `\\text{${_tm(w)}}`);
function localize(answer) {
  const a = { ...answer };
  if (typeof a.text === 'string') a.text = _tm(a.text);
  if (typeof a.label === 'string') a.label = _tm(a.label);
  if (typeof a.latex === 'string') a.latex = inText(a.latex);
  if (Array.isArray(a.solutions)) a.solutions = a.solutions.map((s) => (typeof s === 'string' ? inText(s) : s));
  return a;
}
