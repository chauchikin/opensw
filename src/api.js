// Commands for AI agents (and scripts): window.sw in the page; the desktop app
// passes MCP tool calls to the same functions. Every command takes one plain
// object and returns plain JSON, so it can travel over any channel.
import { Selection, TextSelection } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';
import { schema } from './schema.js';
import { readLatex } from './tex55.js';
import { toLatex, toMarkdown } from './export.js';
import { compute, pythonProblem } from './compute.js';
import { settings, saveSettings } from './settings.js';
import { stepCommands } from './steps.js';
import { insideFolder } from './projects.js';

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
  open: ['Opens a file: in the desktop app give path (.sci or a 5.x .tex). The file is not opened where it is: it is imported, that is copied with the files it uses (pictures, sub-documents, .bib) into a project folder of its own in the projects folder (aiFolder in info), and the copy is the open document; the file you named is never written. The answer is as info gives it (path is the copy), with imported: { from, folder, copied, notFound, notCopied }. A file imported before: its existing copy is opened instead, and the note says so and whether the original has changed since; fresh = true imports it again as a new copy. If no earlier import has this path but one has the same file name and the same contents, the file is imported all the same, and alike: { importedFrom, on, copy } with the note tell you of that copy (it may be this file under another path, such as a network drive; then go on in that copy). A file of a project (a folder of the projects folder that has opensw\'s records) is opened as it is; any other file is imported, also one in another folder of the projects folder or in a project\'s records. When it is open in the editor already it is not read again but brought to the screen as it is there, unsaved changes and all (alreadyOpen: true, and the note says so). Without asking only files in the projects folder, the open document\'s folder and the folders the user allowed; anywhere else the user is asked first. It takes the place of the document on screen, unless that one has unsaved changes: then it stays open too (see documents).', { path: 'string', fresh: 'boolean?' }],
  documents: ['The documents open in the editor (its Window menu). For each: doc (its number; 0 is the one on screen, which all the other commands work on), name, path, and changed (true: it has changes that are not saved).', {}],
  switchTo: ['Brings open document doc (its number in documents) to the screen, so that the other commands work on it. The numbers change with it: the answer is the new list, as documents gives it.', { doc: 'number' }],
  close: ['Closes open document doc (its number in documents); without doc, the one on screen. A document with unsaved changes is not closed: save it first, or give discard = true and the user is asked whether its changes may be lost. The answer is the list of the documents still open (when the last one is closed, a new empty one).', { doc: 'number?', discard: 'boolean?' }],
  save: ['Saves (desktop app): the main format is 5.x .tex (5.5 opens it); a path ending in .sci saves as .sci. Without path it saves back to the same file in its project folder (keeping a .bak; an unchanged 5.x file is not rewritten; in an edited one only the edited parts are written again, the rest stays as it was in the file). A LaTeX file 5.x did not write (info: from55 false) is written as a 5.x file over the copy in the project folder; the LaTeX as it was imported stays in the project\'s records. What is edited is always in the projects folder (aiFolder in info), and this command saves there and nowhere else: a path in the document\'s own project folder makes that file the open document; a path anywhere else in the projects folder gives the document a new project folder of its own (the first save of a new document needs such a path). A path outside the projects folder is refused, and so is saving a document that was opened in place outside it: this command writes nothing out there, so the original a document was imported from can never be written by it, under whatever name. A copy outside the projects folder is for the user to make (File > Save As). A project\'s records are never saved to. The answer\'s path is the open document; note says when that is not the file you named. Only .tex and .sci.', { path: 'string?' }],
  records: ['The records of the open document\'s project folder (desktop app); read them before your first edit. Returns folder, files (the paths of the three records), changeLog (the last entries of Change log.txt, about 60 lines: the import, every AI change with the blocks before and after, every save; opensw writes it, and counts blocks from 1 where the commands count from 0), fileMap (File map.txt: what is in the folder, where the document was imported from, what it uses) and handoff (the last three notes of Handoff notes.txt, left by the AI that worked on the document before).', {}],
  handoff: ['Adds a note to Handoff notes.txt in the open document\'s project folder, for whoever goes on with the work (a person or another AI): what you set out to do, what is done, what is left. Plain English, a few lines. Write one before you finish; opensw puts the date and time above it.', { text: 'string' }],
  typeset: ['Typesets to PDF and opens it (desktop app). Returns pdf (its path) and errors (what TeX reported). With errors the PDF still comes out but those parts may be wrong, so fix them (the message gives the line of the TeX).', {}],
  info: ['The document\'s name, path, number of blocks and formulas, from55 (it is a Scientific Word 5.x file; false for other LaTeX, a .sci or a new document), and aiFolder: the projects folder, where the documents are kept (each in a folder of its own) and AI may always open and save without asking. For a document in a project folder also project: { folder, importedFrom (the file it was copied from; never written), records (the folder of its records, see records) } and handoff: the latest handoff note.', {}],
  compute: ['Computes one formula with the computation engine (SymPy with Giac and FriCAS; Mathematica first when it is chosen in Tools > Engine Setup), without changing the document. op: evaluate (default), numeric, simplify, expand, factor, combine, rewrite_exp, rewrite_sincos, solve, numericsolve, ode, odenumeric (Solve ODE > Numeric: a one-column matrix of equations (any order) and initial values y(0) = 1, y\'(0) = 0; defines the solutions as functions, so y(1) can then be evaluated), check, partialfractions (params: [variable], when there are several), collect, differentiate (params: [variable, times]), integrate, series (params: [variable, number of terms, point], in this order; as in 5.5 the terms are counted from the lowest power, default 5: 1/(1-x) ends in O(x^5); point default 0), extrema, laplace, inverselaplace, fourier, determinant, inverse, transpose, eigenvalues, rank, rref, nullspace, trace, charpoly, adjugate, mean, median, variance, stddev, implicitdiff, integersolve, recursion (a one-column matrix: the recurrence and starting values), maximize, minimize, feasible, standardize, dual (simplex method: a one-column matrix, first row the objective, the other rows the constraints, all variables >= 0), gradient, divergence, curl, laplacian, hessian, jacobian, wronskian, potential, vectorpotential (params are the basis variables, default x, y, z), byparts (params: [u]), changevar (params: ["u=g(x)"]), approxint (params: [method, number of subintervals]; method is left, midpoint, right, trapezoid or simpson, in single quotes), iterate (params: [starting value, count]); and the rest of the Compute menu of 5.5, each as ENGINE.md describes its params: cholesky, plu, qr, svd, singularvalues, jordan, hermite, smith, rationalcanonical, ffgauss, gauss, minpoly, eigenvectors, colbasis, rowbasis, concat, stack, reshape, fillmatrix, randommatrix, condition, definiteness, norm, orthogonal, permanent, spectralradius, htranspose, rewrite_rational, rewrite_float, rewrite_factorial, rewrite_gamma, rewrite_log, rewrite_sinhcosh, rewrite_sin, rewrite_cos, rewrite_tan, rewrite_arcsin, rewrite_arccos, rewrite_arctan, rewrite_arccot, rewrite_polar, rewrite_rectangular, rewrite_normal, combine_exp, combine_log, combine_powers, combine_trig, combine_arctan, combine_hyp, eqs_to_matrix, matrix_to_eqs, mode, geomean, harmonicmean, meandev, moment, quantile, correlation, covariance, fitcurve, randomnumbers, divide, roots, sort, companion, interpret, inversefourier, odelaplace, odeseries. Returns the result as LaTeX; solve, numericsolve, integersolve, ode, extrema, maximize, minimize return a list of solutions.', { latex: 'string', op: 'string?', params: 'string[]?' }],
  engine: ['The computation engine of the Compute menu (Tools > Engine Setup). Without engine: which one is chosen, the ones that can be chosen (available: id and name; sympy is SymPy with Giac and FriCAS, which comes with opensw; others, such as mathematica, are programs on this computer, desktop app only) and versions (what the chosen engine reports, loading it first). With engine (an id from available): chooses it for every document, as the dialog does, and answers the same. error: the chosen engine could not be started; notice: the Python that comes with opensw did not start, so SymPy runs in the slower Pyodide.', { engine: 'string?' }],
  steps: ['The derivation steps. Every displayed formula can be a step with a fixed name (of several rows, as in align or eqnarray, a row that starts with = goes on from the row before); the names, what each step uses and its last check are kept in a file beside the document (<document>.steps.json), so the document is not changed (a formula with a \\label is named by the label). Returns for each step: name, block, status (pass, fail, unknown, unchecked: never checked or changed since the check, trusted), why, uses, waitsFor; ready: the open steps that can be worked on now; problems. With name: that one step in full (formula, extra checks, what the engine was asked and what it answered).', { name: 'string?' }],
  nameSteps: ['Gives every displayed formula without a name the next free one (s1, s2 ...), kept in the steps file. inDocument = true also writes each step\'s name into the document as the formula\'s \\label (5.5 shows a label as a marker).', { inDocument: 'boolean?' }],
  setStep: ['Sets what a step is checked with; only the arguments given change. uses: the names of the steps and given groups whose definitions it needs (a step defines the names its formula starts with, as w_0 = ...; only the ones listed are in force, not theirs in turn). note: a few words on what the step says. trust: why it is taken as true without a check ("" removes it). extra: checks for what the formula does not spell out, each { latex, equals, why, op?, params? }: latex (or what the compute operation op makes of it) must equal equals; @1, @2 stand for the last side of the formula\'s 1st, 2nd statement. block: gives this name to the displayed formula in that block (for a name whose formula was rewritten; a name the formula had before goes).', { name: 'string', uses: 'string[]?', note: 'string?', trust: 'string?', extra: 'object[]?', block: 'number?' }],
  setGiven: ['A group of definitions the problem gives, for steps to use by its name: defs such as "a=2", "f(x)=x^2". An empty list removes the group.', { name: 'string', defs: 'string[]', note: 'string?' }],
  checkSteps: ['Checks the steps (all, or only names) with the computation engine and keeps the results in the steps file. Each equality a = b of the formula and each extra check is asked as "a - b simplifies to 0" with only the definitions of what the step uses in force (the user\'s own definitions are set aside and put back); a = b + O(x^n) is asked as: a - b and its first n - 1 derivatives are 0 at x = 0. A name the document defines but the step does not use gives unknown, with the name. Answers as steps does.', { names: 'string[]?' }],
  select: ['Puts the cursor in block block.', { block: 'number' }],
  focusEnd: ['Puts the cursor at the end of the document.', {}],
};

// AI may open files only in the projects folder, the open document's folder and the folders the
// user allowed (Tools > User Setup); elsewhere the user is asked first. (Documents\\opensw, where
// 0.11.0 and before let it save, is one of them.) Saving needs no such list: an AI saves in the
// projects folder and nowhere else (main.js saveTo).
async function checkOpen(app, path) {
  if (!('__TAURI_INTERNALS__' in window)) return; // the web version opens no paths at all
  const current = app.path();
  const folders = [await app.aiHome?.(), current && current.replace(/[\\/][^\\/]*$/, ''), await app.oldAiHome?.(), ...settings().aiFolders].filter(Boolean);
  if (folders.some((f) => insideFolder(path, f))) return;
  if (!(await app.askAllow(path))) throw new Error(`The user did not allow opening ${path}`);
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
  // every change goes through here (or set): it belongs to the AI's edit (aiedits.js).
  // command: the command that makes it, for the project's change log
  function dispatch(tr, command) {
    const before = doc();
    if (tr.docChanged) app.aiStart?.();
    view().dispatch(tr.setMeta('ai', true).scrollIntoView());
    if (tr.docChanged) app.logChange?.(command, before, doc());
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
      const [before, metaBefore] = [doc(), app.meta()];
      // a whole new document not saved anywhere yet has no name (the old one's would stay on the PDF)
      app.setDoc(r.doc, whole ? { name: app.path() ? app.meta().name : undefined, ...r.meta } : app.meta());
      app.logChange?.('set', before, doc(), metaBefore); // (a change of the preamble alone is one too)
      return { blocks: r.doc.childCount };
    },
    insert: ({ latex, index }) => {
      const nodes = parse(latex);
      let pos = doc().content.size;
      if (index === -1) pos = 0;
      else if (index != null) { const b = block(index); pos = b.pos + b.node.nodeSize; }
      dispatch(view().state.tr.insert(pos, nodes), 'insert');
      return { inserted: nodes.length, at: index == null ? doc().childCount - nodes.length : index + 1 };
    },
    replaceBlock: ({ index, latex }) => {
      const b = block(index);
      const nodes = parse(latex);
      dispatch(view().state.tr.replaceWith(b.pos, b.pos + b.node.nodeSize, nodes), 'replaceBlock');
      return { replacedWith: nodes.length };
    },
    deleteBlock: ({ index }) => {
      const b = block(index);
      let tr = view().state.tr.delete(b.pos, b.pos + b.node.nodeSize);
      if (tr.doc.childCount === 0) tr = tr.insert(0, schema.nodes.paragraph.create());
      dispatch(tr, 'deleteBlock');
      return { blocks: doc().childCount };
    },
    find: ({ text }) => textMatches(text).map((pos) => ({ block: blockAt(pos) })),
    replace: ({ find, with: by = '', all = true }) => {
      let hits = textMatches(find);
      if (!all) hits = hits.slice(0, 1);
      let tr = view().state.tr;
      for (const p of [...hits].reverse()) tr = tr.insertText(by, p, p + find.length);
      if (hits.length) dispatch(tr, 'replace');
      return { replaced: hits.length };
    },
    formulas: () => allFormulas().map((f, n) => ({ n, block: f.block, display: f.node.type.name === 'math_display', latex: f.node.attrs.latex, ...(f.node.attrs.label ? { label: f.node.attrs.label } : {}) })),
    setFormula: ({ n, latex }) => {
      const f = allFormulas()[n];
      if (!f) throw new Error(`There is no formula ${n}`);
      dispatch(view().state.tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, latex: String(latex) }), 'setFormula');
      return { ok: true };
    },
    undo: () => ({ done: undo(view().state, (tr) => dispatch(tr, 'undo')) }),
    redo: () => ({ done: redo(view().state, (tr) => dispatch(tr, 'redo')) }),
    open: async ({ path, fresh = false }) => {
      await checkOpen(app, String(path));
      const told = await app.openPath(String(path), !!fresh); // { imported }, { alreadyImported, note } or { alreadyOpen, note }
      return { ...(await api.info()), ...told };
    },
    save: async ({ path } = {}) => {
      // (a project's records, and an original, are never saved to: said as what they are)
      const target = path || app.path();
      if (target) await app.refuseSave?.(String(target));
      if (path && '__TAURI_INTERNALS__' in window && !/\.(tex|sci)$/i.test(String(path))) throw new Error('Can only save as .tex or .sci');
      const saved = await app.saveTo(path); // a path, or { path, note }
      return typeof saved === 'string' ? { path: saved } : saved;
    },
    records: () => app.records(),
    handoff: ({ text }) => {
      if (!String(text ?? '').trim()) throw new Error('Give text: what you set out to do, what is done, what is left');
      return app.handoff(String(text));
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
    // Tools > Engine Setup for AI: the same choice as the dialog's radio buttons (SymPy, or an
    // engine of engine/engines.json other than the Python SymPy runs in); the program locations
    // are left to the dialog, so that an AI cannot make opensw start a program of its choice
    engine: async ({ engine } = {}) => {
      const list = '__TAURI_INTERNALS__' in window ? await (await import('./desktop.js')).engineList().catch(() => []) : [];
      const available = [{ id: 'sympy', name: 'SymPy' }, ...list.filter((e) => e.id !== 'python').map((e) => ({ id: e.id, name: e.name }))];
      if (engine !== undefined) {
        if (!available.some((e) => e.id === engine)) throw new Error(`No engine ${engine}. Available: ${available.map((e) => e.id).join(', ')}`);
        saveSettings({ ...settings(), engine });
      }
      const out = { engine: settings().engine, available, versions: [] };
      try {
        out.versions = (await compute('version', '0')).solutions;
        if (pythonProblem()) out.notice = pythonProblem(); // SymPy runs in Pyodide: its Python did not start
      } catch (e) { out.error = String(e.message || e); }
      return out;
    },
    info: async () => ({
      name: app.meta().name || null,
      path: app.path(),
      aiFolder: (await app.aiHome?.()) || null,
      blocks: doc().childCount,
      formulas: allFormulas().length,
      from55: app.from55(),
      ...(await app.projectFacts?.()), // project and handoff, for a document in a project folder
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
      dispatch(view().state.tr.setNodeMarkup(pos, null, a.rows ? { ...a, rows: a.rows.map((r, i) => (i ? r : { ...r, label })) } : { ...a, label }), 'nameSteps');
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
