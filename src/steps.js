// Derivation steps (the AI commands steps, nameSteps, setStep, setGiven, checkSteps).
//
// Every displayed formula can be one step of a derivation, with a fixed name. A file
// beside the document, <document>.steps.json, records for each step which other steps it uses
// and what the computation engine answered when the step was checked. A step whose formula (or
// one it uses) has changed since is "unchecked" again. The names are kept in that file, so the
// document itself is not touched; a formula that has a \label is named by its label instead.
//
// The file:
//   { "doc": "name.tex",
//     "given": { "ex1": { "defs": ["a=2", "f(x)=x^2"], "note": "" } },      what the problem gives
//     "lines": { "s1": { "key": "...", "note": "", "uses": ["ex1"],         one entry for each step
//                        "trust": "the problem's equation",                 (not checked: taken as true)
//                        "extra": [{ "latex": "...", "equals": "...", "why": "...", "op": "series", "params": [] }],
//                        "result": { ... } } } }                            the last check
import { compute as engineCompute, definitionsAside } from './compute.js';

// ---------- reading one displayed formula

// the parts of s at brace depth 0 (\left..\right and \begin..\end counted as braces) split at
// sep: a character ("="), "\\\\" (a row's end) or a command ("\\qquad")
export function splitTop(s, sep) {
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      const w = s.slice(i + 1).match(/^[A-Za-z]+/);
      if (w && (w[0] === 'left' || w[0] === 'begin')) depth++;
      else if (w && (w[0] === 'right' || w[0] === 'end')) depth--;
      else if (w && depth === 0 && sep === '\\' + w[0]) { out.push(s.slice(from, i)); from = i + sep.length; }
      if (!w && s.startsWith(sep, i) && sep === '\\\\' && depth === 0) { out.push(s.slice(from, i)); from = i + 2; i++; continue; }
      i += w ? w[0].length : 1;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth === 0 && s.startsWith(sep, i)) { out.push(s.slice(from, i)); from = i + sep.length; i += sep.length - 1; }
  }
  out.push(s.slice(from));
  return out;
}

// a relation that is not "=": such a formula is not a chain of equalities
export const REL = /\\(?:le|ge|leq|geq|neq|ne|approx|sim|simeq|equiv|cong|propto|to|rightarrow|Rightarrow|Leftarrow|Leftrightarrow|iff|implies|in|notin|subset|subseteq|supset|supseteq|mapsto|longrightarrow|Longrightarrow)(?![A-Za-z])|[<>]/;
// one side of an equality without what only sets it on the page (spacing, a closing remark, the full stop)
export const tidy = (s) => s.replace(/\\(?:quad|qquad|,|;|!)\s*/g, ' ').replace(/\\text\{[^{}]*\}\s*$/, '').replace(/\\(?:nonumber|notag)/g, '').replace(/[.,;]\s*$/, '').trim();

const GREEK = 'alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega';
const LETTER = `(?:\\\\(?:${GREEK})|[A-Za-z])`;
// a name that a formula defines: w_0, A_0, \Psi, w(x,y), p(x,y)
const NAME = new RegExp(`^(${LETTER}(?:_(?:\\{[^{}]+\\}|[A-Za-z0-9]))?)(\\(${LETTER}(?:,${LETTER})*\\))?$`);
const bare = (s) => s.replace(/\\left|\\right/g, '').replace(/\s+/g, '');

// The rows of a displayed formula without their alignment marks: one for a formula of one row;
// for several rows (align, eqnarray, gather, kept as \begin{aligned}, \begin{array}{rcl},
// \begin{gathered}) a row that starts with "=" goes on from the row before
const ROWS = /^\\begin\{(array|aligned|alignedat|gathered)\}((?:\{[^{}]*\})*)([^]*)\\end\{\1\}$/;
export function rowsOf(latex) {
  const m = ROWS.exec(latex.trim());
  if (!m) return [latex];
  const rows = [];
  for (const row of splitTop(m[3], '\\\\')) {
    // (a length after \\, as in \\[2pt], is spacing)
    const text = splitTop(row.replace(/^\s*\[\s*-?[\d.]+\s*(?:pt|em|ex|mm|cm|in)\s*\]/, ''), '&').join(' ').trim();
    if (text && rows.length && text.startsWith('=')) rows[rows.length - 1] += ' ' + text;
    else if (text) rows.push(text);
  }
  return rows;
}

// One displayed formula can hold several statements: its rows, and in a row those set apart by
// \qquad; each is a chain a = b = c. A chain that starts with a bare name defines it (as its
// last side), and the equalities to check are those between the other sides.
export function statements(latex) {
  return rowsOf(latex).flatMap((row) => splitTop(row, '\\qquad')).map((part) => {
    const sides = splitTop(part, '=').map(tidy);
    const plain = sides.every((x) => x && !REL.test(x));
    const named = plain && sides.length > 1 && NAME.test(bare(sides[0]));
    const exprs = named ? sides.slice(1) : sides;
    return {
      sides,
      def: named ? sides[0] + '=' + sides.at(-1) : null,
      chain: plain ? exprs.slice(1).map((b, i) => [exprs[i], b]) : [],
    };
  });
}

// what a definition names, in a form to look for in other formulas: "w_0", or "w(" for a function
export function nameKey(def) {
  const m = NAME.exec(bare(splitTop(def, '=')[0]));
  return m ? m[1].replace(/_\{(.)\}/, '_$1') + (m[2] ? '(' : '') : null;
}
export function mentions(text, key) {
  const t = text.replace(/\\left|\\right/g, '').replace(/\s+\(/g, '(').replace(/_\{(.)\}/g, '_$1');
  const esc = key.replace(/[\\()]/g, '\\$&');
  // not the tail of a command (\beta is not "a"), and a plain letter not when it goes on as w_0 or w(x)
  return new RegExp(`(?<!\\\\[A-Za-z]*)${esc}` + (/[_(]/.test(key) ? '' : '(?![_(])')).test(t);
}

// a = b is asked as "a - b is 0". a = b + O(x^n) cannot be asked that way; for sides that are
// n times continuously differentiable near x = 0 it says the same as: a - b and its
// derivatives in x up to order n-1 are 0 at x = 0 (Taylor's theorem), which can.
const BIG_O = /\+?\s*O\\left\(\s*([A-Za-z])(?:\^\{?(\d+)\}?)?\s*\\right\)|\+?\s*O\(\s*([A-Za-z])(?:\^\{?(\d+)\}?)?\s*\)/;
export function zeroTests(a, b) {
  if (BIG_O.test(a) && !BIG_O.test(b)) [a, b] = [b, a];
  const m = BIG_O.exec(b);
  if (!m) return { tests: [`\\left(${a}\\right)-\\left(${b}\\right)`] };
  const v = m[1] || m[3];
  const n = +(m[2] || m[4] || 1);
  const rest = (b.slice(0, m.index) + b.slice(m.index + m[0].length)).trim() || '0';
  const diff = `\\left(\\left(${a}\\right)-\\left(${rest}\\right)\\right)`;
  const d = (k) => (k === 0 ? '' : k === 1 ? `\\frac{\\partial}{\\partial ${v}}` : `\\frac{\\partial^${k}}{\\partial ${v}^${k}}`);
  return {
    tests: Array.from({ length: n }, (_, k) => `\\left.${d(k)}${diff}\\right|_{${v}=0}`),
    how: `O(${v}^${n}) asked as: left - right and its derivatives in ${v} up to order ${n - 1} are 0 at ${v} = 0 (Taylor; the sides must be ${n} times continuously differentiable near ${v} = 0)`,
  };
}

// ---------- asking the engine

// Is this expression 0? The chosen engine simplifies it first, so that derivatives, integrals
// and substitutions are carried out; what is left is compared with 0 (stepcheck: proved equal,
// or a point where it is not 0, or unknown).
async function isZero(compute, latex) {
  let s;
  try { s = await compute('simplify', latex); } catch (e) { return { asked: latex, result: 'error', error: String(e.message || e) }; }
  if (s.kind !== 'value') return { asked: latex, result: 'error', error: `the answer is not one formula (${s.kind})` };
  if (s.latex.trim() === '0') return { asked: latex, simplified: '0', result: 'equal' };
  let r;
  try { r = await compute('stepcheck', s.latex, ['0']); } catch (e) { return { asked: latex, simplified: s.latex, result: 'error', error: String(e.message || e) }; }
  const t = { asked: latex, simplified: s.latex, result: r.kind === 'step' ? r.result : 'error' };
  if (r.result === 'notequal') t.counterexample = { point: r.point, values: r.values };
  return t;
}

// Is a = b? -> { result: 'equal' | 'notequal' | 'unknown' | 'error', asked: [what the engine was asked], how?, error? }
// compute(op, latex, params): the Compute menu's function (compute.js)
export async function askEqual(compute, a, b) {
  const { tests, how } = zeroTests(a, b);
  const asked = [];
  for (const t of tests) { asked.push(await isZero(compute, t)); if (asked.at(-1).result !== 'equal') break; }
  const out = { result: asked.at(-1).result, asked };
  if (how) out.how = how;
  if (asked.at(-1).error) out.error = asked.at(-1).error;
  return out;
}

// ---------- which formula has which name

// A formula as it is compared: spacing does not count, nor what Scientific Word 5.5 writes
// differently when it saves (f' as f^{\prime }).
export function canon(latex) {
  return String(latex)
    .replace(/\^\{((?:\s*\\prime\s*)+)\}/g, (m, p) => "'".repeat(p.match(/\\prime/g).length))
    .replace(/\\ /g, '\\\u0001')
    .replace(/\s+/g, ' ')
    .replace(/(\\[A-Za-z]+) (?=[A-Za-z])/g, '$1\u0000')
    .replace(/ /g, '')
    .replace(/\u0000/g, ' ')
    .replace(/\u0001/g, ' ');
}

// a short print of a text (two 32-bit FNV-1a sums): to see that something has changed, no more
function print(text) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x811c9dc5) + 0x9e3779b9;
  }
  return ((a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')).slice(0, 12);
}

// shown: the displayed formulas, in document order ({ block, latex, label, .. });
// lines: the steps of the file, in the order of the document when it was last written.
// -> { formulas: shown with name (null: none) and by ('label', 'file': the same formula as in the
//      file, 'position': a formula rewritten since, taken to be the step that stood there),
//      lost: the names no formula has now }
// A formula that was moved, or has new formulas around it, is found by its text. A formula that
// was rewritten is found by its place: between the same named formulas there must be as many
// rewritten formulas as names left over; otherwise nothing is guessed (the names are "lost").
export function nameFormulas(shown, lines) {
  const out = shown.map((f) => ({ ...f, name: f.label || null, by: f.label ? 'label' : null }));
  const labels = new Set(out.map((f) => f.name).filter(Boolean));
  const order = Object.keys(lines);
  const waiting = new Map(); // a formula's text -> the names of the file with it, in order
  for (const n of order) {
    if (labels.has(n) || lines[n].key == null) continue;
    if (!waiting.has(lines[n].key)) waiting.set(lines[n].key, []);
    waiting.get(lines[n].key).push(n);
  }
  for (const f of out) {
    const q = f.name ? null : waiting.get(canon(f.latex));
    if (q?.length) { f.name = q.shift(); f.by = 'file'; }
  }
  const found = new Set(out.map((f) => f.name).filter(Boolean));
  const inDoc = out.map((f) => f.name);
  const before = (names, i) => { for (let k = i - 1; k >= 0; k--) if (found.has(names[k])) return names[k]; return null; };
  const gaps = new Map(); // the found name before -> what is left over after it
  const gap = (a) => { if (!gaps.has(a)) gaps.set(a, { formulas: [], names: [] }); return gaps.get(a); };
  out.forEach((f, i) => { if (!f.name) gap(before(inDoc, i)).formulas.push(f); });
  order.forEach((n, i) => { if (!found.has(n)) gap(before(order, i)).names.push(n); });
  for (const g of gaps.values()) {
    if (g.formulas.length === g.names.length) g.formulas.forEach((f, i) => { f.name = g.names[i]; f.by = 'position'; });
  }
  const named = new Set(out.map((f) => f.name).filter(Boolean));
  return { formulas: out, lost: order.filter((n) => !named.has(n)) };
}

// the file's steps put in the order of the document (a lost name stays after the name it followed),
// each with the text of its formula: what nameFormulas goes by the next time
function reorder(side, formulas, lost) {
  const old = Object.keys(side.lines);
  const names = formulas.map((f) => f.name).filter(Boolean);
  for (const n of lost) {
    const prev = old[old.indexOf(n) - 1];
    names.splice(prev === undefined ? 0 : names.indexOf(prev) + 1, 0, n);
  }
  const lines = {};
  for (const n of names) lines[n] = side.lines[n] || { note: '', uses: [] };
  for (const f of formulas) if (f.name) { const { key, ...rest } = lines[f.name]; lines[f.name] = { key: canon(f.latex), ...rest }; }
  side.lines = lines;
}

// ---------- what a step may use

// the names the things a step uses give it (as nameKey writes them)
function usedKeys(spec, side, byName) {
  const keys = new Set();
  for (const u of spec?.uses || []) {
    for (const tex of side.given?.[u]?.defs || []) keys.add(nameKey(tex));
    if (byName.has(u)) for (const st of statements(byName.get(u).latex)) if (st.def) keys.add(nameKey(st.def));
  }
  return keys;
}
// what a step's formula defines: the names its statements start with, but not a name the step
// uses (f(x) = x^2 + O(x^3) in a step that uses the definition of f says something about f)
function ownDefs(f, spec, side, byName) {
  const used = usedKeys(spec, side, byName);
  return statements(f.latex).filter((st) => st.def && !used.has(nameKey(st.def))).map((st) => st.def);
}
// the definitions a step is checked with: those of the steps and the "given" groups it uses (not theirs in turn)
function scopeOf(spec, side, byName) {
  const defs = [];
  const problems = [];
  for (const u of spec.uses || []) {
    if (side.given?.[u]) for (const tex of side.given[u].defs || []) defs.push({ from: u, tex });
    else if (byName.has(u)) { for (const tex of ownDefs(byName.get(u), side.lines[u], side, byName)) defs.push({ from: u, tex }); }
    else problems.push(`uses "${u}", which is neither a step nor a given group`);
  }
  const seen = new Map();
  for (const x of defs) {
    const k = nameKey(x.tex);
    if (seen.has(k) && canon(seen.get(k).tex) !== canon(x.tex)) problems.push(`"${k}" is defined differently in ${seen.get(k).from} and ${x.from}`);
    seen.set(k, x);
  }
  return { defs, problems };
}
const printOf = (f, spec, scope) => print(JSON.stringify([canon(f.latex), spec.trust || null, spec.uses || [], spec.extra || [], scope.defs.map((x) => canon(x.tex))]));

// every name the formulas define, and where: to say "w_0 (defined in s5) is not among what this step uses"
// formulas: [{ latex, name or block }]
export function definedNames(formulas, given = {}) {
  const all = [];
  for (const f of formulas) for (const st of statements(f.latex)) if (st.def) all.push({ from: f.name ?? `block ${f.block}`, key: nameKey(st.def) });
  for (const [g, v] of Object.entries(given)) for (const tex of v.defs || []) all.push({ from: g, key: nameKey(tex) });
  return all.filter((x) => x.key);
}
// of those names, the ones a formula mentions without having them (have: the keys it has)
export const missingNames = (known, have, text) => [...new Set(known.filter((k) => !have.has(k.key) && mentions(text, k.key)).map((k) => `${k.key.replace(/\($/, '')} (defined in ${k.from})`))];

// ---------- checking one step

async function checkStep(compute, f, spec, side, byName, known) {
  const scope = scopeOf(spec, side, byName);
  const out = { print: printOf(f, spec, scope), at: new Date().toISOString(), scope: [], checks: [], problems: [...scope.problems] };
  if (scope.problems.length) return { ...out, status: 'unknown' };
  await compute('cleardefs', '0');
  const inScope = new Set();
  const define = async (from, tex) => {
    let r;
    try { r = await compute('define', tex); } catch (e) { r = { error: String(e.message || e) }; }
    out.scope.push({ from, tex, ...(r.error ? { error: r.error } : { readAs: r.latex }) });
    if (r.error) out.problems.push(`could not define ${tex}: ${r.error}`);
    inScope.add(nameKey(tex));
  };
  for (const x of scope.defs) await define(x.from, x.tex);

  const ask = async (what, a, b) => {
    const check = { what, ...(await askEqual(compute, a, b)) };
    if (check.result !== 'equal') {
      // a name defined in the document but not among what this step uses was a free letter here:
      // "not equal" then only means the definition was missing
      const missing = missingNames(known, inScope, a + ' ' + b);
      if (missing.length) {
        check.notInScope = missing;
        if (check.result === 'notequal') check.result = 'unknown';
      }
    }
    out.checks.push(check);
  };

  const parts = statements(f.latex);
  for (const st of parts) {
    // a statement that starts with a name the step uses says something about it: every side is compared
    const claim = st.def && inScope.has(nameKey(st.def));
    const chain = claim ? st.sides.slice(1).map((b, i) => [st.sides[i], b]) : st.chain;
    for (const [a, b] of chain) await ask(`${a} = ${b}`, a, b);
    if (st.def && !claim) await define(f.name, st.def);
  }
  // checks written by a person or an AI for what the formula itself does not spell out;
  // @1, @2 ... stand for the last side of the formula's 1st, 2nd ... statement
  const fill = (s) => String(s).replace(/@(\d)/g, (m, k) => parts[k - 1]?.sides.at(-1) ?? m);
  for (const e of spec.extra || []) {
    let a = fill(e.latex);
    if (e.op) {
      let r;
      try { r = await compute(e.op, a, e.params); } catch (x) { r = { error: String(x.message || x) }; }
      if (r.kind !== 'value') { out.checks.push({ what: e.why || '', extra: true, computed: { op: e.op, latex: a, params: e.params }, result: 'error', error: r.error || `the answer is not one formula (${r.kind})` }); continue; }
      a = r.latex;
    }
    await ask(e.why || '', a, fill(e.equals));
    Object.assign(out.checks.at(-1), { extra: true }, e.op ? { computed: { op: e.op, latex: fill(e.latex), params: e.params, answer: a } } : {});
  }

  const results = out.checks.map((c) => c.result);
  if (!results.length) out.problems.push('nothing to check: the formula only defines names; add an "extra" check that says where they come from, or "trust" it');
  out.status = !results.length ? 'unchecked' : results.includes('notequal') ? 'fail' : results.every((r) => r === 'equal') && !out.problems.length ? 'pass' : 'unknown';
  return out;
}

// ---------- the table

// what the last results say now: a step whose formula (or what it uses) has changed since is unchecked again
function table(formulas, side, lost, unnamed) {
  const steps = formulas.filter((f) => f.name);
  const byName = new Map(steps.map((f) => [f.name, f]));
  const rows = steps.map((f) => {
    const spec = side.lines[f.name];
    const r = spec.result;
    let status = 'unchecked';
    let why = 'never checked';
    if (spec.trust) [status, why] = ['trusted', spec.trust];
    else if (r && r.print !== printOf(f, spec, scopeOf(spec, side, byName))) why = 'changed since the last check';
    else if (r) {
      status = r.status;
      const bad = r.checks.filter((c) => c.result !== 'equal');
      why = [...r.problems, ...bad.map((c) => `${c.result}: ${c.what}` + (c.notInScope ? ` [not among what it uses: ${c.notInScope.join(', ')}]` : '') + (c.error ? ` [${c.error}]` : ''))].join('; ')
        || `${r.checks.length} check${r.checks.length > 1 ? 's' : ''}` + (r.checks.some((c) => c.extra) ? `, ${r.checks.filter((c) => c.extra).length} written by hand` : '');
    }
    return { name: f.name, block: f.block, namedBy: f.by, status, why, uses: spec.uses || [], note: spec.note || '' };
  });
  const by = new Map(rows.map((r) => [r.name, r]));
  for (const r of rows) r.waitsFor = r.uses.filter((u) => by.has(u) && !['pass', 'trusted'].includes(by.get(u).status));
  const problems = [];
  for (const f of unnamed) problems.push(`block ${f.block}: a displayed formula without a name (nameSteps gives it one)`);
  for (const f of steps) if (f.by === 'position') problems.push(`${f.name}: its formula was rewritten; taken to be the one now in block ${f.block}, by its place (setStep with block puts the name elsewhere)`);
  for (const n of lost) problems.push(`${n}: in the steps file, but its formula is not found any more (setStep with block gives the name to a formula)`);
  // a step that uses itself through others
  const reach = (n, seen = new Set()) => { for (const u of by.get(n)?.uses || []) if (by.has(u) && !seen.has(u)) { seen.add(u); reach(u, seen); } return seen; };
  for (const r of rows) if (reach(r.name).has(r.name)) problems.push(`${r.name}: uses itself (through ${r.uses.join(', ')})`);
  const count = (s) => rows.filter((r) => r.status === s).length;
  const open = rows.filter((r) => !['pass', 'trusted'].includes(r.status));
  return {
    steps: rows,
    counts: { steps: rows.length, pass: count('pass'), fail: count('fail'), unknown: count('unknown'), unchecked: count('unchecked'), trusted: count('trusted') },
    ready: open.filter((r) => !r.waitsFor.length).map((r) => r.name),
    waiting: open.filter((r) => r.waitsFor.length).map((r) => r.name),
    given: Object.keys(side.given || {}),
    problems,
  };
}

// ---------- the commands

const memory = new Map(); // the steps of documents not saved anywhere (and of the web version)
const sideOf = (path) => path.replace(/\.[^.\\/]+$/, '') + '.steps.json';

// The document was saved under another name (File > Save As, or for the first time): its steps
// go with it, into the file beside the new name, unless that name has a steps file already.
// files: { read, write } as for stepCommands; from: the path before (null: not saved anywhere)
export async function stepsFollow(files, from, to) {
  if (!files || !to || (from && sideOf(from) === sideOf(to))) return;
  const text = from ? await files.read(sideOf(from)) : memory.get('') ?? null;
  if (text == null || (await files.read(sideOf(to))) != null) return;
  let moved = text;
  try { moved = JSON.stringify({ ...JSON.parse(text), doc: to.split(/[\\/]/).pop() }, null, 2) + '\n'; } catch (e) { /* not a steps file any more: copied as it is */ }
  await files.write(sideOf(to), moved);
  if (!from) memory.delete('');
}

// app: { path(): the document's path or null, shown(): the displayed formulas in document order
//        ({ block, pos, latex, label: its \label, of several rows the first that has one }),
//        setLabel(pos, label), files: { read(path) ->
//        text or null, write(path, text) } or null (the web version) }
export function stepCommands(app) {
  const sidePath = () => (app.path() && app.files ? sideOf(app.path()) : null);

  async function load() {
    const path = sidePath();
    const text = path ? await app.files.read(path) : memory.get(app.path() || '') ?? null;
    let side;
    try { side = text ? JSON.parse(text) : null; } catch (e) { throw new Error(`${path} is not a steps file any more (${e.message}); correct it or remove it`); }
    side = { doc: app.path() ? app.path().split(/[\\/]/).pop() : null, given: {}, lines: {}, ...side };
    const all = app.shown();
    // a formula with a \label is a step from the start
    for (const f of all) if (f.label && !side.lines[f.label]) side.lines[f.label] = { note: '', uses: [] };
    const { formulas, lost } = nameFormulas(all, side.lines);
    reorder(side, formulas, lost);
    return { path, text, side, formulas, lost, unnamed: formulas.filter((f) => !f.name) };
  }
  // written when it differs from what is there; only looking (create = false) starts no file
  async function store(d, create = true) {
    const text = JSON.stringify(d.side, null, 2) + '\n';
    if (text === d.text || (!d.text && !create)) return;
    if (d.path) await app.files.write(d.path, text); else memory.set(app.path() || '', text);
    d.text = text;
  }
  const answer = (d) => ({
    file: d.path || 'not saved: kept until the editor closes (save the document to keep the steps beside it)',
    ...table(d.formulas, d.side, d.lost, d.unnamed),
  });
  const stepOf = (d, name) => {
    const f = d.formulas.find((x) => x.name === name);
    if (!f && !d.side.lines[name]) throw new Error(`There is no step ${name}. Steps: ${Object.keys(d.side.lines).join(', ') || 'none (nameSteps names the displayed formulas)'}`);
    return f;
  };

  return {
    steps: async ({ name } = {}) => {
      const d = await load();
      await store(d, false);
      if (name == null) return answer(d);
      const f = stepOf(d, name);
      const row = answer(d).steps.find((r) => r.name === name);
      return { name, ...(f ? { block: f.block, latex: f.latex } : { lost: true }), ...row, ...d.side.lines[name] };
    },

    nameSteps: async ({ inDocument = false } = {}) => {
      const d = await load();
      const used = new Set([...Object.keys(d.side.lines), ...Object.keys(d.side.given)]);
      const named = [];
      let k = 1;
      for (const f of d.formulas) {
        if (f.name) continue;
        while (used.has('s' + k)) k++;
        f.name = 's' + k;
        f.by = 'file';
        used.add(f.name);
        d.side.lines[f.name] = { note: '', uses: [] };
        named.push({ block: f.block, name: f.name });
      }
      reorder(d.side, d.formulas, d.lost);
      d.unnamed = [];
      const labelled = [];
      if (inDocument) {
        // from the last one back: each change leaves the positions before it as they were
        for (const f of [...d.formulas].reverse()) if (!f.label) { app.setLabel(f.pos, f.name); f.label = f.name; f.by = 'label'; labelled.push(f.name); }
      }
      await store(d);
      return { named, ...(inDocument ? { labelled: labelled.reverse(), note: 'The labels are in the editor; save the document to keep them.' } : {}), ...answer(d) };
    },

    setStep: async ({ name, block, uses, note, trust, extra }) => {
      const d = await load();
      if (block != null) {
        const f = d.formulas.find((x) => x.block === block);
        if (!f) throw new Error(`Block ${block} is not a displayed formula`);
        if (f.label && f.label !== name) throw new Error(`The formula in block ${block} is named by its \\label: ${f.label}`);
        if (d.side.given[name]) throw new Error(`${name} is a given group`);
        const other = d.formulas.find((x) => x.name === name && x !== f);
        if (other?.label) throw new Error(`${name} is the \\label of the formula in block ${other.block}`);
        if (other) other.name = other.by = null; // the name moves here
        if (f.name && f.name !== name) delete d.side.lines[f.name]; // one name for a formula: the old one's record goes
        d.side.lines[name] = d.side.lines[name] || { note: '', uses: [] };
        f.name = name;
        f.by = 'file';
        d.lost = d.lost.filter((n) => n !== name && d.side.lines[n]);
        reorder(d.side, d.formulas, d.lost);
        d.unnamed = d.formulas.filter((x) => !x.name);
      }
      stepOf(d, name);
      const spec = d.side.lines[name];
      if (uses !== undefined) spec.uses = uses.map(String);
      if (note !== undefined) spec.note = String(note);
      if (trust !== undefined) { if (trust) spec.trust = String(trust); else delete spec.trust; }
      if (extra !== undefined) {
        for (const e of extra) if (typeof e?.latex !== 'string' || typeof e?.equals !== 'string') throw new Error('Each extra check is { latex, equals, why?, op?, params? }: latex (or what op makes of it) must equal equals');
        if (extra.length) spec.extra = extra; else delete spec.extra;
      }
      await store(d);
      const row = answer(d).steps.find((r) => r.name === name);
      return { name, ...row, ...spec };
    },

    setGiven: async ({ name, defs, note }) => {
      const d = await load();
      if (d.side.lines[name]) throw new Error(`${name} is a step`);
      for (const tex of defs) if (!nameKey(tex)) throw new Error(`Not a definition (name = value, such as a=2 or f(x)=x^2): ${tex}`);
      if (defs.length) d.side.given[name] = { defs: defs.map(String), note: String(note ?? d.side.given[name]?.note ?? '') };
      else delete d.side.given[name];
      await store(d);
      return { given: d.side.given };
    },

    checkSteps: async ({ names } = {}) => {
      const d = await load();
      for (const n of names || []) stepOf(d, n);
      const steps = d.formulas.filter((f) => f.name);
      const byName = new Map(steps.map((f) => [f.name, f]));
      const known = definedNames(steps, d.side.given);
      // each step is checked with only the definitions of what it uses; the user's own
      // (Compute > Definitions) are set aside meanwhile and put back
      await definitionsAside(async () => {
        for (const f of steps) {
          if (names?.length && !names.includes(f.name)) continue;
          const spec = d.side.lines[f.name];
          if (spec.trust) { delete spec.result; continue; }
          spec.result = await checkStep(engineCompute, f, spec, d.side, byName, known);
        }
      });
      await store(d);
      return answer(d);
    },
  };
}
