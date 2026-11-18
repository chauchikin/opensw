import { MathfieldElement } from 'mathlive';
import 'mathlive/fonts.css';
import { TextSelection, Selection } from 'prosemirror-state';
import { MATH_MACROS } from './tex55.js';

// a formula using one of these macros is read again once the field knows them
const MACRO_RE = new RegExp(`\\\\(${Object.keys(MATH_MACROS).join('|')})(?![a-zA-Z])`);

// fonts come from mathlive/fonts.css (inlined into our CSS at build time), so the
// page needs no separate font files
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;

// One math node (inline or display) shown as a MathLive <math-field>.
// ProseMirror never looks inside it; the two editors hand the cursor to each
// other at the edges (move-out events / arrow-key commands below).
export class MathView {
  constructor(node, view, getPos) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    const mf = new MathfieldElement();
    mf.mathVirtualKeyboardPolicy = 'auto';
    mf.smartFence = true;
    // Scientific Word 5 macros; the field's macro list exists only once it is on the page
    mf.addEventListener('mount', () => {
      mf.macros = { ...mf.macros, ...MATH_MACROS };
      if (MACRO_RE.test(this.latex)) mf.value = this.latex;
    }, { once: true });
    mf.value = node.attrs.latex;
    this.latex = node.attrs.latex;
    this.mf = mf;

    if (node.type.name === 'math_display') {
      this.dom = document.createElement('div');
      this.dom.className = 'math-display';
      this.dom.appendChild(mf);
    } else {
      this.dom = document.createElement('span');
      this.dom.className = 'math-inline';
      this.dom.appendChild(mf);
    }
    this.dom._mathView = this;

    mf.addEventListener('input', () => this.save());
    mf.addEventListener('move-out', (e) => {
      e.preventDefault();
      const d = e.detail.direction;
      this.exit(d === 'forward' || d === 'downward' ? 1 : -1);
    });
    mf.addEventListener('focus', () => this.dom.classList.add('editing'));
    mf.addEventListener('blur', () => { this.dom.classList.remove('editing'); this.save(); });
    // capture phase: runs before MathLive's own key handling
    mf.addEventListener('keydown', (e) => {
      if ((e.key === 'Backspace' || e.key === 'Delete') && mf.value === '') {
        e.preventDefault(); e.stopPropagation();
        this.remove();
      } else if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault(); e.stopPropagation();
        this.exit(1);
      }
    }, true);
  }

  save() {
    const latex = this.mf.getValue('latex-expanded');
    if (latex === this.latex) return;
    this.latex = latex;
    const pos = this.getPos();
    if (pos == null) return;
    const tr = this.view.state.tr.setNodeMarkup(pos, null, { ...this.node.attrs, latex });
    tr.setMeta('addToHistory', true);
    this.view.dispatch(tr);
  }

  // dir = 1: put the text cursor after the math; -1: before it
  exit(dir) {
    this.save();
    const pos = this.getPos();
    const { state } = this.view;
    let tr = state.tr;
    let target = dir > 0 ? pos + this.node.nodeSize : pos;
    if (this.node.type.name === 'math_display') {
      if (dir > 0 && target >= tr.doc.content.size) {
        tr = tr.insert(target, state.schema.nodes.paragraph.create());
      }
      const sel = Selection.near(tr.doc.resolve(dir > 0 ? target + 1 : target), dir);
      tr = tr.setSelection(sel);
    } else {
      tr = tr.setSelection(TextSelection.create(tr.doc, target));
    }
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }

  remove() {
    const pos = this.getPos();
    let tr = this.view.state.tr.delete(pos, pos + this.node.nodeSize);
    if (this.node.type.name === 'math_display' && tr.doc.childCount === 0) {
      tr = tr.insert(0, this.view.state.schema.nodes.paragraph.create());
    }
    tr = tr.setSelection(Selection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size)), -1));
    this.view.dispatch(tr);
    this.view.focus();
  }

  // atStart: true = cursor at the beginning of the formula
  enter(atStart) {
    // focus MathLive's own input element directly: mf.focus() is unreliable
    // when the page itself does not have window focus
    const sink = this.mf.shadowRoot?.querySelector('[part=keyboard-sink]');
    if (sink) sink.focus(); else this.mf.focus();
    this.mf.executeCommand(atStart ? 'moveToMathfieldStart' : 'moveToMathfieldEnd');
  }

  update(node) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (node.attrs.latex !== this.latex) {
      this.latex = node.attrs.latex;
      this.mf.value = node.attrs.latex;
    }
    return true;
  }

  selectNode() { this.enter(false); }
  stopEvent() { return true; }
  ignoreMutation() { return true; }
}

function mathViewAt(view, pos) {
  const dom = view.nodeDOM(pos);
  return dom && dom._mathView;
}

// Arrow keys / Backspace that step from text into a neighbouring formula.
export const mathKeys = {
  ArrowRight: (state, dispatch, view) => horizontal(state, dispatch, view, 1),
  ArrowLeft: (state, dispatch, view) => horizontal(state, dispatch, view, -1),
  Backspace: (state, dispatch, view) => {
    const { $head, empty } = state.selection;
    if (!empty) return false;
    if ($head.nodeBefore && $head.nodeBefore.type.name === 'math_inline') {
      const mv = mathViewAt(view, $head.pos - $head.nodeBefore.nodeSize);
      mv.enter(false);
      mv.mf.executeCommand('deleteBackward');
      mv.save();
      return true;
    }
    // at the start of a paragraph right after a display formula: go into it
    if ($head.parentOffset === 0 && $head.depth >= 1) {
      const before = state.doc.resolve($head.before());
      const prev = before.nodeBefore;
      if (prev && prev.type.name === 'math_display') {
        mathViewAt(view, before.pos - prev.nodeSize).enter(false);
        return true;
      }
    }
    return false;
  },
  ArrowDown: (state, dispatch, view) => verticalEnter(state, view, 1),
  ArrowUp: (state, dispatch, view) => verticalEnter(state, view, -1),
};

// Left/right inside a paragraph are handled here instead of by the browser:
// the browser's own caret often gets stuck next to an embedded formula.
function horizontal(state, dispatch, view, dir) {
  const { $head, empty } = state.selection;
  if (!empty || !$head.parent.isTextblock) return false;
  const next = dir > 0 ? $head.nodeAfter : $head.nodeBefore;
  if (!next) return false; // edge of the paragraph: let the browser go to the next line/block
  if (next.type.name === 'math_inline') {
    mathViewAt(view, dir > 0 ? $head.pos : $head.pos - next.nodeSize).enter(dir > 0);
    return true;
  }
  let step = 1;
  if (next.isText) {
    const text = next.text;
    const code = dir > 0 ? text.charCodeAt(0) : text.charCodeAt(text.length - 1);
    if (code >= 0xd800 && code <= 0xdfff) step = 2; // surrogate pair (emoji etc.)
  }
  dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, $head.pos + dir * step)).scrollIntoView());
  return true;
}

function verticalEnter(state, view, dir) {
  const { $head, empty } = state.selection;
  if (!empty || !view.endOfTextblock(dir > 0 ? 'down' : 'up')) return false;
  const edge = dir > 0 ? $head.after() : $head.before();
  const $edge = state.doc.resolve(edge);
  const next = dir > 0 ? $edge.nodeAfter : $edge.nodeBefore;
  if (!next || next.type.name !== 'math_display') return false;
  mathViewAt(view, dir > 0 ? edge : edge - next.nodeSize).enter(dir > 0);
  return true;
}

// Insert a new formula at the cursor and start editing it.
export function insertMath(display) {
  return (state, dispatch, view) => {
    const { schema } = state;
    let tr = state.tr;
    let pos;
    if (display) {
      const node = schema.nodes.math_display.create({ latex: '' });
      const $from = state.selection.$from;
      const insertAt = $from.depth ? $from.after(1) : $from.pos;
      tr = tr.insert(insertAt, node);
      pos = insertAt;
      if (insertAt + node.nodeSize >= tr.doc.content.size) {
        tr = tr.insert(insertAt + node.nodeSize, schema.nodes.paragraph.create());
      }
    } else {
      const sel = state.selection;
      const text = sel.empty ? '' : state.doc.textBetween(sel.from, sel.to);
      tr = tr.replaceSelectionWith(schema.nodes.math_inline.create({ latex: text }), false);
      pos = tr.selection.from - 1;
    }
    if (dispatch) {
      dispatch(tr);
      const mv = mathViewAt(view, pos);
      if (mv) mv.enter(false); else requestAnimationFrame(() => mathViewAt(view, pos)?.enter(false));
    }
    return true;
  };
}
