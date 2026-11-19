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

// name -> [description, parameters]; shown by sw.help() and listed as MCP tools
export const COMMANDS = {
  help: ['Lists all commands.', {}],
  get: ['Reads the whole document. format: "latex" (default), "markdown", "json" (the editor\'s own format).', { format: 'string?' }],
  outline: ['The document\'s blocks: for each, its number (index), kind, first words and formulas. Use it to find a block\'s number before changing that block.', {}],
  set: ['Replaces the whole document with LaTeX (a full document or just the body).', { latex: 'string' }],
  insert: ['Inserts LaTeX (paragraphs, formulas, lists, theorems...) after block index; without index it goes at the end; index = -1 puts it at the start.', { latex: 'string', index: 'number?' }],
  replaceBlock: ['Replaces block index with LaTeX.', { index: 'number', latex: 'string' }],
  deleteBlock: ['Deletes block index.', { index: 'number' }],
  find: ['Finds text (not inside formulas); returns the block number of each place.', { text: 'string' }],
  replace: ['Replaces the text find with with (not inside formulas); all = false replaces only the first.', { find: 'string', with: 'string', all: 'boolean?' }],
  formulas: ['Lists all formulas (inline and displayed) with their block numbers.', {}],
  setFormula: ['Changes formula n (in the order formulas gives) to new LaTeX.', { n: 'number', latex: 'string' }],
  undo: ['Undoes the last step.', {}],
  redo: ['Redoes.', {}],
  open: ['Opens a file: in the desktop app give path (.sci or a 5.x .tex). Only files in the open document\'s folder, aiFolder (see info) and the folders the user allowed; anywhere else the user is asked first.', { path: 'string' }],
  save: ['Saves (desktop app): the main format is 5.x .tex (5.5 opens it); a path ending in .sci saves as .sci. Without path it saves back to the same file (keeping a .bak; an unchanged 5.x file is not rewritten; in an edited one only the edited parts are written again, the rest stays as it was in the file). Only .tex and .sci; saving outside the open document\'s folder, aiFolder (see info) and the folders the user allowed asks the user first.', { path: 'string?' }],
  typeset: ['Typesets to PDF and opens it (desktop app). Returns pdf (its path) and errors (what TeX reported). With errors the PDF still comes out but those parts may be wrong, so fix them (the message gives the line of the TeX).', {}],
  info: ['The document\'s name, path, number of blocks and formulas, whether it was opened from 5.x, and aiFolder: the folder (Documents\\opensw) where AI may always save, e.g. a new document, without asking.', {}],
  compute: ['Computes one formula with the chosen computation engine (SymPy or Mathematica, see Tools > Computation Engine), without changing the document. op: evaluate (default), numeric, simplify, expand, factor, combine, rewrite_exp, rewrite_sincos, solve, numericsolve, ode, odenumeric (Solve ODE > Numeric: a one-column matrix of equations (any order) and initial values y(0) = 1, y\'(0) = 0; defines the solutions as functions, so y(1) can then be evaluated), check, partialfractions (params: [variable], when there are several), collect, differentiate (params: [variable, times]), integrate, series (params: [variable, number of terms, point], in this order; as in 5.5 the terms are counted from the lowest power, default 5: 1/(1-x) ends in O(x^5); point default 0), extrema, laplace, inverselaplace, fourier, determinant, inverse, transpose, eigenvalues, rank, rref, nullspace, trace, charpoly, adjugate, mean, median, variance, stddev, implicitdiff, integersolve, recursion (a one-column matrix: the recurrence and starting values), maximize, minimize, feasible, standardize, dual (simplex method: a one-column matrix, first row the objective, the other rows the constraints, all variables >= 0), gradient, divergence, curl, laplacian, hessian, jacobian, wronskian, potential, vectorpotential (params are the basis variables, default x, y, z), byparts (params: [u]), changevar (params: ["u=g(x)"]), approxint (params: [method, number of subintervals]; method is left, midpoint, right, trapezoid or simpson, in single quotes), iterate (params: [starting value, count]). Returns the result as LaTeX; solve, numericsolve, integersolve, ode, extrema, maximize, minimize return a list of solutions.', { latex: 'string', op: 'string?', params: 'string[]?' }],
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
    formulas: () => allFormulas().map((f, n) => ({ n, block: f.block, display: f.node.type.name === 'math_display', latex: f.node.attrs.latex })),
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
      return { path: await app.saveTo(path) };
    },
    typeset: async () => app.typesetNow(),
    compute: ({ latex, op = 'evaluate', params }) => compute(op, String(latex), Array.isArray(params) ? params.map(String) : undefined),
    info: async () => ({
      name: app.meta().name || null,
      path: app.path(),
      aiFolder: (await app.aiHome?.()) || null,
      blocks: doc().childCount,
      formulas: allFormulas().length,
      from55: !!app.meta().preamble55,
    }),
  };

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
