// Commands for AI agents (and scripts): window.sw in the page; the desktop app
// passes MCP tool calls to the same functions. Every command takes one plain
// object and returns plain JSON, so it can travel over any channel.
import { Selection, TextSelection } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';
import { schema } from './schema.js';
import { readLatex } from './tex55.js';
import { toLatex, toMarkdown } from './export.js';
import { compute } from './compute.js';
import { settings } from './settings.js';
import { stepCommands } from './steps.js';

// name -> [description, parameters]; shown by sw.help() and listed as MCP tools
export const COMMANDS = {
  help: ['Lists all commands.', {}],
  get: ['Reads the whole document. format: "latex" (default), "markdown", "json" (the editor\'s own format).', { format: 'string?' }],
  outline: ['The document\'s blocks: for each, its number (index), kind, first words and formulas (a displayed formula\'s \\label as label). Use it to find a block\'s number before changing that block.', {}],
  set: ['Replaces the whole document with LaTeX (a full document or just the body).', { latex: 'string' }],
  insert: ['Inserts LaTeX (paragraphs, formulas, lists, theorems...) after block index; without index it goes at the end; index = -1 puts it at the start.', { latex: 'string', index: 'number?' }],
  replaceBlock: ['Replaces block index with LaTeX.', { index: 'number', latex: 'string' }],
  deleteBlock: ['Deletes block index.', { index: 'number' }],
  find: ['Finds text (not inside formulas); returns the block number of each place.', { text: 'string' }],
  replace: ['Replaces the text find with with (not inside formulas); all = false replaces only the first.', { find: 'string', with: 'string', all: 'boolean?' }],
  formulas: ['Lists all formulas (inline and displayed) with their block numbers, and the \\label of a displayed formula that has one.', {}],
  setFormula: ['Changes formula n (in the order formulas gives) to new LaTeX.', { n: 'number', latex: 'string' }],
  undo: ['Undoes the last step.', {}],
  redo: ['Redoes.', {}],
  open: ['Opens a file: in the desktop app give path (.sci or a 5.x .tex). Only files in the open document\'s folder, aiFolder (see info) and the folders the user allowed; anywhere else the user is asked first. It takes the place of the document on screen, unless that one has unsaved changes: then it stays open too (see documents).', { path: 'string' }],
  documents: ['The documents open in the editor (its Window menu). For each: doc (its number; 0 is the one on screen, which all the other commands work on), name, path, and changed (true: it has changes that are not saved).', {}],
  switchTo: ['Brings open document doc (its number in documents) to the screen, so that the other commands work on it. The numbers change with it: the answer is the new list, as documents gives it.', { doc: 'number' }],
  close: ['Closes open document doc (its number in documents); without doc, the one on screen. A document with unsaved changes is not closed: save it first, or give discard = true and the user is asked whether its changes may be lost. The answer is the list of the documents still open (when the last one is closed, a new empty one).', { doc: 'number?', discard: 'boolean?' }],
  save: ['Saves (desktop app): the main format is 5.x .tex (5.5 opens it); a path ending in .sci saves as .sci. Without path it saves back to the same file (keeping a .bak; an unchanged 5.x file is not rewritten; in an edited one only the edited parts are written again, the rest stays as it was in the file). A LaTeX file 5.x did not write (info: from55 false) is never written over: give a new path, the 5.x file goes there and the answer\'s note says so. Only .tex and .sci; saving outside the open document\'s folder, aiFolder (see info) and the folders the user allowed asks the user first.', { path: 'string?' }],
  typeset: ['Typesets to PDF and opens it (desktop app). Returns pdf (its path) and errors (what TeX reported). With errors the PDF still comes out but those parts may be wrong, so fix them (the message gives the line of the TeX).', {}],
  info: ['The document\'s name, path, number of blocks and formulas, from55 (it is a Scientific Word 5.x file; false for other LaTeX, a .sci or a new document), and aiFolder: the folder (Documents\\opensw) where AI may always save, e.g. a new document, without asking.', {}],
  compute: ['Computes one formula with the chosen computation engine (SymPy or Mathematica, see Tools > Computation Engine), without changing the document. op: evaluate (default), numeric, simplify, expand, factor, combine, rewrite_exp, rewrite_sincos, solve, numericsolve, ode, odenumeric (Solve ODE > Numeric: a one-column matrix of equations (any order) and initial values y(0) = 1, y\'(0) = 0; defines the solutions as functions, so y(1) can then be evaluated), check, partialfractions (params: [variable], when there are several), collect, differentiate (params: [variable, times]), integrate, series (params: [variable, number of terms, point], in this order; as in 5.5 the terms are counted from the lowest power, default 5: 1/(1-x) ends in O(x^5); point default 0), extrema, laplace, inverselaplace, fourier, determinant, inverse, transpose, eigenvalues, rank, rref, nullspace, trace, charpoly, adjugate, mean, median, variance, stddev, implicitdiff, integersolve, recursion (a one-column matrix: the recurrence and starting values), maximize, minimize, feasible, standardize, dual (simplex method: a one-column matrix, first row the objective, the other rows the constraints, all variables >= 0), gradient, divergence, curl, laplacian, hessian, jacobian, wronskian, potential, vectorpotential (params are the basis variables, default x, y, z), byparts (params: [u]), changevar (params: ["u=g(x)"]), approxint (params: [method, number of subintervals]; method is left, midpoint, right, trapezoid or simpson, in single quotes), iterate (params: [starting value, count]); and the rest of the Compute menu of 5.5, each as ENGINE.md describes its params: cholesky, plu, qr, svd, singularvalues, jordan, hermite, smith, rationalcanonical, ffgauss, gauss, minpoly, eigenvectors, colbasis, rowbasis, concat, stack, reshape, fillmatrix, randommatrix, condition, definiteness, norm, orthogonal, permanent, spectralradius, htranspose, rewrite_rational, rewrite_float, rewrite_factorial, rewrite_gamma, rewrite_log, rewrite_sinhcosh, rewrite_sin, rewrite_cos, rewrite_tan, rewrite_arcsin, rewrite_arccos, rewrite_arctan, rewrite_arccot, rewrite_polar, rewrite_rectangular, rewrite_normal, combine_exp, combine_log, combine_powers, combine_trig, combine_arctan, combine_hyp, eqs_to_matrix, matrix_to_eqs, mode, geomean, harmonicmean, meandev, moment, quantile, correlation, covariance, fitcurve, randomnumbers, divide, roots, sort, companion, interpret, inversefourier, odelaplace, odeseries. Returns the result as LaTeX; solve, numericsolve, integersolve, ode, extrema, maximize, minimize return a list of solutions.', { latex: 'string', op: 'string?', params: 'string[]?' }],
  steps: ['The derivation steps. Every displayed formula can be a step with a fixed name (of several rows, as in align or eqnarray, a row that starts with = goes on from the row before); the names, what each step uses and its last check are kept in a file beside the document (<document>.steps.json), so the document is not changed (a formula with a \\label is named by the label). Returns for each step: name, block, status (pass, fail, unknown, unchecked: never checked or changed since the check, trusted), why, uses, waitsFor; ready: the open steps that can be worked on now; problems. With name: that one step in full (formula, extra checks, what the engine was asked and what it answered).', { name: 'string?' }],
  nameSteps: ['Gives every displayed formula without a name the next free one (s1, s2 ...), kept in the steps file. inDocument = true also writes each step\'s name into the document as the formula\'s \\label (5.5 shows a label as a marker).', { inDocument: 'boolean?' }],
  setStep: ['Sets what a step is checked with; only the arguments given change. uses: the names of the steps and given groups whose definitions it needs (a step defines the names its formula starts with, as w_0 = ...; only the ones listed are in force, not theirs in turn). note: a few words on what the step says. trust: why it is taken as true without a check ("" removes it). extra: checks for what the formula does not spell out, each { latex, equals, why, op?, params? }: latex (or what the compute operation op makes of it) must equal equals; @1, @2 stand for the last side of the formula\'s 1st, 2nd statement. block: gives this name to the displayed formula in that block (for a name whose formula was rewritten; a name the formula had before goes).', { name: 'string', uses: 'string[]?', note: 'string?', trust: 'string?', extra: 'object[]?', block: 'number?' }],
  setGiven: ['A group of definitions the problem gives, for steps to use by its name: defs such as "a=2", "f(x)=x^2". An empty list removes the group.', { name: 'string', defs: 'string[]', note: 'string?' }],
  checkSteps: ['Checks the steps (all, or only names) with the computation engine and keeps the results in the steps file. Each equality a = b of the formula and each extra check is asked as "a - b simplifies to 0" with only the definitions of what the step uses in force (the user\'s own definitions are set aside and put back); a = b + O(x^n) is asked as: a - b and its first n - 1 derivatives are 0 at x = 0. A name the document defines but the step does not use gives unknown, with the name. Answers as steps does.', { names: 'string[]?' }],
  select: ['Puts the cursor in block block.', { block: 'number' }],
  focusEnd: ['Puts the cursor at the end of the document.', {}],
};

// Is `path` in `folder` (or a folder inside it)? Full paths as Windows or Unix writes them
// (a relative path is not); "." and ".." are worked out first; letter case is ignored on Windows.
export function insideFolder(path, folder) {
  if (!/^([a-z]:)?[\\/]/i.test(path)) return false;
  const parts = (p) => {
    const out = [];
    for (const x of String(p).split(/[\\/]+/)) {
      if (x === '..') out.pop(); else if (x !== '.' && x !== '') out.push(x);
    }
    return /^[a-z]:/i.test(p) ? out.map((x) => x.toLowerCase()) : out;
  };
  const f = parts(folder);
  const p = parts(path);
  return f.length > 0 && f.length < p.length && f.every((x, i) => x === p[i]);
}

// AI may open and save only in the open document's folder, Documents\\opensw and the folders the
// user allowed (Tools > User Setup); elsewhere the user is asked first. It saves only .tex and .sci.
async function checkPath(app, path, action) {
  if (!('__TAURI_INTERNALS__' in window)) return; // the web version opens and saves no paths at all
  if (action === 'save' && !/\.(tex|sci)$/i.test(path)) throw new Error('Can only save as .tex or .sci');
  const current = app.path();
  const home = await app.aiHome?.(); // Documents\\opensw: always allowed
  const folders = [...(current ? [current.replace(/[\\/][^\\/]*$/, '')] : []), ...(home ? [home] : []), ...settings().aiFolders];
  if (folders.some((f) => insideFolder(path, f))) return;
  if (!(await app.askAllow(path, action))) throw new Error(`The user did not allow ${action === 'save' ? 'saving to' : 'opening'} ${path}`);
}

export function makeApi(app) {
  const view = () => app.view;
  const doc = () => app.view.state.doc;

  // top-level blocks with their positions
  function blocks() {
    const out = [];
    doc().forEach((node, offset, index) => out.push({ node, pos: offset, index }));
    return out;
  }
  function block(index) {
    const b = blocks()[index];
    if (!b) throw new Error(`There is no block ${index} (the document has ${doc().childCount} blocks)`);
    return b;
  }
  // LaTeX -> block nodes
  function parse(latex) {
    const nodes = [];
    readLatex(String(latex)).doc.forEach((n) => nodes.push(n));
    return nodes;
  }
  // every change goes through here (or set): it belongs to the AI's edit (aiedits.js)
  function dispatch(tr) {
    if (tr.docChanged) app.aiStart?.();
    view().dispatch(tr.setMeta('ai', true).scrollIntoView());
  }
  const summary = (node) => {
    const maths = node.type.name.startsWith('math') ? [node.attrs.latex] : [];
    node.descendants((n) => { if (n.type.name.startsWith('math')) maths.push(n.attrs.latex); });
    return {
      type: node.type.name + (node.attrs.level != null ? node.attrs.level : '') + (node.attrs.kind ? ':' + node.attrs.kind : ''),
      text: node.textContent.slice(0, 120),
      ...(maths.length ? { math: maths.slice(0, 5) } : {}),
      ...(node.type.name === 'math_display' && node.attrs.label ? { label: node.attrs.label } : {}),
    };
  };
  function allFormulas() {
    const out = [];
    doc().forEach((top, offset, index) => {
      if (top.type.name.startsWith('math')) out.push({ pos: offset, node: top, block: index });
      top.descendants((n, p) => { if (n.type.name.startsWith('math')) out.push({ pos: offset + 1 + p, node: n, block: index }); });
    });
    return out;
  }
  function textMatches(needle) {
    const out = [];
    if (!needle) return out;
    doc().descendants((n, pos) => {
      if (!n.isText) return;
      let i = n.text.indexOf(needle);
      while (i >= 0) { out.push(pos + i); i = n.text.indexOf(needle, i + needle.length); }
    });
    return out;
  }
  const blockAt = (pos) => doc().resolve(pos).index(0);
  // one of the open documents, by its number in documents
  function openDoc(n) {
    const all = app.documents();
    if (!all[n]) throw new Error(`There is no document ${n} (${all.length} open, numbered from 0; see documents)`);
    return all[n];
  }

  const api = {
    help: () => Object.entries(COMMANDS).map(([name, [desc, params]]) => ({ name, desc, params })),
    get: ({ format = 'latex' } = {}) => {
      if (format === 'markdown') return toMarkdown(doc());
      if (format === 'json') return doc().toJSON();
      return toLatex(doc(), app.meta());
    },
    outline: () => blocks().map(({ node, index }) => ({ index, ...summary(node) })),
    set: ({ latex }) => {
      const r = readLatex(String(latex));
      // a whole document brings its own preamble; a body keeps the current one
      const whole = /\\begin\{document\}/.test(latex);
      app.aiStart?.();
      // a whole new document not saved anywhere yet has no name (the old one's would stay on the PDF)
      app.setDoc(r.doc, whole ? { name: app.path() ? app.meta().name : undefined, ...r.meta } : app.meta());
      return { blocks: r.doc.childCount };
    },
    insert: ({ latex, index }) => {
      const nodes = parse(latex);
      let pos = doc().content.size;
      if (index === -1) pos = 0;
      else if (index != null) { const b = block(index); pos = b.pos + b.node.nodeSize; }
      dispatch(view().state.tr.insert(pos, nodes));
      return { inserted: nodes.length, at: index == null ? doc().childCount - nodes.length : index + 1 };
    },
    replaceBlock: ({ index, latex }) => {
      const b = block(index);
      const nodes = parse(latex);
      dispatch(view().state.tr.replaceWith(b.pos, b.pos + b.node.nodeSize, nodes));
      return { replacedWith: nodes.length };
    },
    deleteBlock: ({ index }) => {
      const b = block(index);
      let tr = view().state.tr.delete(b.pos, b.pos + b.node.nodeSize);
      if (tr.doc.childCount === 0) tr = tr.insert(0, schema.nodes.paragraph.create());
      dispatch(tr);
      return { blocks: doc().childCount };
    },
    find: ({ text }) => textMatches(text).map((pos) => ({ block: blockAt(pos) })),
    replace: ({ find, with: by = '', all = true }) => {
      let hits = textMatches(find);
      if (!all) hits = hits.slice(0, 1);
      let tr = view().state.tr;
      for (const p of [...hits].reverse()) tr = tr.insertText(by, p, p + find.length);
      if (hits.length) dispatch(tr);
      return { replaced: hits.length };
    },
    formulas: () => allFormulas().map((f, n) => ({ n, block: f.block, display: f.node.type.name === 'math_display', latex: f.node.attrs.latex, ...(f.node.attrs.label ? { label: f.node.attrs.label } : {}) })),
    setFormula: ({ n, latex }) => {
      const f = allFormulas()[n];
      if (!f) throw new Error(`There is no formula ${n}`);
      dispatch(view().state.tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, latex: String(latex) }));
      return { ok: true };
    },
    undo: () => ({ done: undo(view().state, dispatch) }),
    redo: () => ({ done: redo(view().state, dispatch) }),
    open: async ({ path }) => { await checkPath(app, String(path), 'open'); await app.openPath(path); return api.info(); },
    save: async ({ path } = {}) => {
      if (path) await checkPath(app, String(path), 'save');
      const saved = await app.saveTo(path); // a path, or { path, note }
      return typeof saved === 'string' ? { path: saved } : saved;
    },
    documents: () => app.documents(),
    switchTo: ({ doc: n }) => { openDoc(n); if (n) app.showDocument(n); return app.documents(); },
    close: async ({ doc: n = 0, discard = false } = {}) => {
      const d = openDoc(n);
      const called = `Document ${n}${d.name ? ` (${d.name})` : ''}`;
      if (d.changed && !discard) throw new Error(`${called} has unsaved changes: save it first, or close it with discard = true (the user is then asked)`);
      if (d.changed && !(await app.askDiscard(d.path || d.name || called))) throw new Error(`The user did not allow closing ${called} without saving it`);
      app.dropDocument(n);
      return app.documents();
    },
    typeset: async () => app.typesetNow(),
    compute: ({ latex, op = 'evaluate', params }) => compute(op, String(latex), Array.isArray(params) ? params.map(String) : undefined),
    info: async () => ({
      name: app.meta().name || null,
      path: app.path(),
      aiFolder: (await app.aiHome?.()) || null,
      blocks: doc().childCount,
      formulas: allFormulas().length,
      from55: app.from55(),
    }),
  };

  // the derivation steps (steps.js): the displayed formulas in document order, and the file beside the document
  Object.assign(api, stepCommands({
    path: () => app.path(),
    files: app.stepFiles || null,
    // (a formula of several rows keeps a \label with each row: it goes by the first one, and gets one on its first row)
    shown: () => allFormulas().filter((f) => f.node.type.name === 'math_display').map((f) => ({ pos: f.pos, block: f.block, latex: f.node.attrs.latex, label: f.node.attrs.label ?? f.node.attrs.rows?.find((r) => r.label)?.label ?? null })),
    setLabel: (pos, label) => {
      const a = doc().nodeAt(pos).attrs;
      dispatch(view().state.tr.setNodeMarkup(pos, null, a.rows ? { ...a, rows: a.rows.map((r, i) => (i ? r : { ...r, label })) } : { ...a, label }));
    },
  }));

  // put the cursor at the end, so a person typing after an AI edit starts there
  api.focusEnd = () => { dispatch(view().state.tr.setSelection(Selection.atEnd(doc()))); view().focus(); return { ok: true }; };
  api.select = ({ block: index }) => {
    const b = block(index);
    dispatch(view().state.tr.setSelection(TextSelection.near(doc().resolve(b.pos + 1))));
    view().focus();
    return { ok: true };
  };

  // one entry point for remote callers: { cmd, args } -> { ok, result } | { ok: false, error }
  api.call = async (cmd, args = {}) => {
    if (!(cmd in api) || cmd === 'call') return { ok: false, error: `No such command: ${cmd}. Available: ${Object.keys(COMMANDS).join(', ')}` };
    try { return { ok: true, result: await api[cmd](args || {}) }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
  };
  return api;
}
