// Commands for AI agents (and scripts): window.sw in the page; the desktop app
// passes MCP tool calls to the same functions. Every command takes one plain
// object and returns plain JSON, so it can travel over any channel.
import { Selection, TextSelection } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';
import { schema } from './schema.js';
import { readLatex } from './tex55.js';
import { toLatex, toMarkdown } from './export.js';
import { compute } from './compute.js';

// name -> [description, parameters]; shown by sw.help() and listed as MCP tools
export const COMMANDS = {
  help: ['列出所有指令。', {}],
  get: ['讀出整份文件。format: "latex"（預設）、"markdown"、"json"（編輯器內部格式）。', { format: 'string?' }],
  outline: ['文件的區塊清單：每塊的編號 index、種類、文字開頭、公式。改某一塊前先用這個找編號。', {}],
  set: ['用 LaTeX 取代整份文件（可以是完整文件或只有內文）。', { latex: 'string' }],
  insert: ['在第 index 塊之後插入 LaTeX 內容（段落、公式、清單、定理都可以）；不給 index 就加在文件最後；index = -1 加在最前面。', { latex: 'string', index: 'number?' }],
  replaceBlock: ['用 LaTeX 取代第 index 塊。', { index: 'number', latex: 'string' }],
  deleteBlock: ['刪掉第 index 塊。', { index: 'number' }],
  find: ['找文字（不含公式內），回傳每個位置所在的區塊編號。', { text: 'string' }],
  replace: ['把文字 find 換成 with（不含公式內）；all 為 false 時只換第一個。', { find: 'string', with: 'string', all: 'boolean?' }],
  formulas: ['列出所有公式（行內與獨立）和所在的區塊編號。', {}],
  setFormula: ['把第 n 個公式（formulas 的順序）改成新的 LaTeX。', { n: 'number', latex: 'string' }],
  undo: ['復原上一步。', {}],
  redo: ['重做。', {}],
  open: ['開啟檔案：桌面版給 path（.sci 或 5.x 的 .tex）。', { path: 'string' }],
  save: ['存成 .sci：桌面版給 path，不給就存回原本的檔（5.x 的 .tex 不會被覆蓋）。', { path: 'string?' }],
  typeset: ['排版成 PDF 並打開（桌面版）。回傳 PDF 路徑。', {}],
  info: ['文件名稱、路徑、區塊數、公式數、是否從 5.x 開啟。', {}],
  compute: ['用 SymPy 計算一條公式（不改文件）。op: evaluate（預設）、numeric、simplify、expand、factor、combine、rewrite_exp、rewrite_sincos、solve、numericsolve、ode、check、partialfractions、collect、differentiate、integrate、series、extrema、laplace、inverselaplace、fourier、determinant、inverse、transpose、eigenvalues、rank、rref、nullspace、trace、charpoly、adjugate、mean、median、variance、stddev、implicitdiff。回傳結果的 LaTeX；solve、numericsolve、ode、extrema 回傳解的清單。', { latex: 'string', op: 'string?' }],
  select: ['把游標放到第 block 塊。', { block: 'number' }],
  focusEnd: ['把游標放到文件最後。', {}],
};

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
    if (!b) throw new Error(`沒有第 ${index} 塊（共 ${doc().childCount} 塊）`);
    return b;
  }
  // LaTeX -> block nodes
  function parse(latex) {
    const nodes = [];
    readLatex(String(latex)).doc.forEach((n) => nodes.push(n));
    return nodes;
  }
  function dispatch(tr) { view().dispatch(tr.scrollIntoView()); }
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
      app.setDoc(r.doc, whole ? { name: app.meta().name, ...r.meta } : app.meta());
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
      if (!f) throw new Error(`沒有第 ${n} 個公式`);
      dispatch(view().state.tr.setNodeMarkup(f.pos, null, { ...f.node.attrs, latex: String(latex) }));
      return { ok: true };
    },
    undo: () => ({ done: undo(view().state, view().dispatch) }),
    redo: () => ({ done: redo(view().state, view().dispatch) }),
    open: async ({ path }) => { await app.openPath(path); return api.info(); },
    save: async ({ path } = {}) => ({ path: await app.saveTo(path) }),
    typeset: async () => ({ pdf: await app.typesetNow() }),
    compute: ({ latex, op = 'evaluate' }) => compute(op, String(latex)),
    info: () => ({
      name: app.meta().name || null,
      path: app.path(),
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
    if (!(cmd in api) || cmd === 'call') return { ok: false, error: `沒有這個指令：${cmd}。可用：${Object.keys(COMMANDS).join(', ')}` };
    try { return { ok: true, result: await api[cmd](args || {}) }; } catch (e) { return { ok: false, error: String(e.message || e) }; }
  };
  return api;
}
