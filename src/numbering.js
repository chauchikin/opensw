// Equation, section and theorem numbers as LaTeX will print them, so the editor can
// show "(3)" next to a numbered formula and resolve cross-references to markers.
// The PDF is numbered by LaTeX itself; this mirrors the usual article/book rules.
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

import { PLAIN_ENVS as UNNUMBERED_ENVS } from './schema.js';
import { _t } from './i18n.js';

// "\\" at the top level of a formula (not inside braces or a nested environment)
export function splitRows(latex) {
  const rows = [];
  let depth = 0;
  let envDepth = 0;
  let start = 0;
  for (let i = 0; i < latex.length; i++) {
    const c = latex[i];
    if (c === '\\') {
      if (latex.startsWith('\\begin{', i)) envDepth++;
      else if (latex.startsWith('\\end{', i)) envDepth--;
      else if (latex[i + 1] === '\\' && depth === 0 && envDepth === 0) {
        rows.push(latex.slice(start, i));
        start = i + 2;
      }
      i++;
    } else if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  rows.push(latex.slice(start));
  return rows;
}

// the rows of a multi-row display: the inside of its \begin{aligned}...\end{aligned}
export function displayRows(latex) {
  const m = latex.match(/^\s*\\begin\{(aligned|gathered|array|alignedat)\}(\{[^}]*\})?([^]*)\\end\{\1\}\s*$/);
  return m ? splitRows(m[3]) : [latex];
}

// meta: the document's settings; numbering by section ("2.3") when the style asks for it
function bySection(meta) {
  const pre = (meta && (meta.preamble55 || meta.preambleTeX)) || '';
  return /\\numberbysection|sw20j(art|rep|ar2)|\\numberwithin\{equation\}\{section\}/.test(pre);
}

// -> { eq: Map(pos -> ["(1)", ...]), envs: Map(pos -> "1"), keys: Map(key -> "1.2") }
export function computeNumbers(doc, meta) {
  const sectionPrefix = bySection(meta);
  let hasChapter = false;
  doc.descendants((n) => { if (n.type.name === 'heading' && n.attrs.level === 1) hasChapter = true; });
  const sec = [0, 0, 0, 0, 0, 0, 0]; // part, chapter, section, subsection, ...
  let eqn = 0;
  let thm = 0;
  const floats = { table: 0, figure: 0 };
  let footnotes = 0;
  const captions = new Map(); // caption pos -> "表 1
  const eq = new Map();
  const envs = new Map();
  const keys = new Map();
  const top = hasChapter ? 1 : 2; // the level whose number starts equation numbers by section
  let appendix = false; // after \appendix the top level counts A, B, C ...
  const sectionNumber = (level) => sec.slice(top, level + 1).map((v, k) => (k === 0 && appendix ? String.fromCharCode(64 + v) : v)).join('.');
  const prefix = () => (sectionPrefix || hasChapter ? sectionNumber(top) + '.' : '');

  function walk(node, pos, context) {
    const t = node.type.name;
    if (t === 'heading') {
      let num = '';
      if (!node.attrs.nonum && node.attrs.level >= 1) {
        const l = node.attrs.level;
        sec[l]++;
        for (let k = l + 1; k < sec.length; k++) sec[k] = 0;
        if (l === top && (sectionPrefix || hasChapter)) { eqn = 0; thm = 0; floats.table = 0; floats.figure = 0; }
        if (l === 1) footnotes = 0;
        num = l >= top ? sectionNumber(l) : String(sec[l]);
      }
      return inside(node, pos, num || context);
    }
    if (t === 'env' && !UNNUMBERED_ENVS.has(node.attrs.kind)) {
      thm++;
      const num = prefix() + thm;
      envs.set(pos, num);
      return inside(node, pos, num);
    }
    if (t === 'float_box') {
      const env = node.attrs.env === 'figure' ? 'figure' : 'table';
      floats[env]++;
      const num = prefix() + floats[env];
      node.forEach((c, off) => { if (c.type.name === 'caption') captions.set(pos + 1 + off, (env === 'figure' ? _t('Figure ') : _t('Table ')) + num); });
      return inside(node, pos, num);
    }
    if (t === 'image' && node.attrs.place === 'float') { // a 5.x floating frame with caption
      const env = node.attrs.floattype === 'table' ? 'table' : 'figure';
      floats[env]++;
      const num = prefix() + floats[env];
      captions.set(pos, (env === 'figure' ? _t('Figure ') : _t('Table ')) + num);
      if (node.attrs.label && !keys.has(node.attrs.label)) keys.set(node.attrs.label, num);
      return undefined;
    }
    if (t === 'ordered_list') {
      let i = 0;
      node.forEach((li, off) => { i++; walk(li, pos + 1 + off, String(i)); });
      return undefined;
    }
    if (t === 'math_display') {
      const a = node.attrs;
      const rows = a.rows || [{ numbered: a.numbered, label: a.label, tag: a.tag }];
      const nums = rows.map((r) => {
        if (r.tag != null) return `(${r.tag})`;
        if (!r.numbered) return null;
        eqn++;
        return `(${prefix()}${eqn})`;
      });
      eq.set(pos, nums);
      rows.forEach((r, i) => { if (r.label && nums[i]) keys.set(r.label, nums[i].slice(1, -1)); });
      return undefined;
    }
    if (t === 'appendix') { appendix = true; sec[top] = 0; return undefined; }
    if (t === 'note') { // footnotes are numbered through the document (chapters restart them)
      if (node.attrs.kind === 'footnote') captions.set(pos, String(++footnotes));
      return undefined;
    }
    if (t === 'marker') {
      if (!keys.has(node.attrs.key)) keys.set(node.attrs.key, context || '');
      return undefined;
    }
    return inside(node, pos, context);
  }
  function inside(node, pos, context) {
    node.forEach((child, off) => walk(child, pos + 1 + off, context));
  }
  doc.forEach((child, off) => walk(child, off, ''));
  // references written in the document: [1], [2] ... or the item's own label
  const bib = new Map();
  doc.descendants((n) => {
    if (n.type.name === 'bibliography') { let k = 0; n.forEach((it) => { k++; bib.set(it.attrs.key, it.attrs.label ?? String(k)); }); return false; }
    return true;
  });
  return { eq, envs, keys, captions, bib };
}

// Shows the numbers in the editor: formula numbers at the right, theorem numbers in
// their label, and the referenced number in each cross-reference.
export function numberingPlugin(getMeta) {
  const build = (doc) => {
    const { eq, envs, keys, captions, bib } = computeNumbers(doc, getMeta());
    const decos = [];
    for (const [pos, nums] of eq) {
      const shown = nums.filter(Boolean);
      if (!shown.length) continue;
      const node = doc.nodeAt(pos);
      decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-eqno': shown.length === 1 ? shown[0] : shown.join(' ') }));
    }
    for (const [pos, num] of envs) {
      const node = doc.nodeAt(pos);
      decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-num': num }));
    }
    for (const [pos, label] of captions) {
      const node = doc.nodeAt(pos);
      decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-num': label }));
    }
    const hasBibtex = (() => { let f = false; doc.descendants((n) => { if (n.type.name === 'bibtex') f = true; }); return f; })();
    doc.descendants((n, pos) => {
      if (n.type.name === 'bib_item') {
        decos.push(Decoration.node(pos, pos + n.nodeSize, { 'data-num': bib.get(n.attrs.key) || '?' }));
        return;
      }
      if (n.type.name === 'cite' && n.attrs.kind === 'cite') {
        // a key the document's own list does not have: with BibTeX the number comes when typesetting
        const shown = n.attrs.keys.split(',').map((k) => bib.get(k) || (hasBibtex ? k : '?')).join(', ');
        decos.push(Decoration.node(pos, pos + n.nodeSize, { 'data-num': `[${shown}${n.attrs.note ? ', ' + n.attrs.note.replace(/~/g, ' ') : ''}]`,
          class: n.attrs.keys.split(',').some((k) => !bib.has(k)) && !hasBibtex ? 'xref-missing' : '' }));
        return;
      }
      if (n.type.name !== 'ref') return;
      const num = keys.get(n.attrs.key);
      let text = num == null ? '??' : num;
      if (n.attrs.kind === 'eqref' && num != null) text = `(${num})`;
      if (n.attrs.kind === 'pageref') text = _t('page');
      decos.push(Decoration.node(pos, pos + n.nodeSize, { 'data-num': text, class: num == null && n.attrs.kind !== 'pageref' ? 'xref-missing' : '' }));
    });
    return DecorationSet.create(doc, decos);
  };
  return new Plugin({
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, old, _, state) => (tr.docChanged || tr.getMeta('numbering') ? build(state.doc) : old),
    },
    props: { decorations(state) { return this.getState(state); } },
  });
}
