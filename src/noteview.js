// Footnotes and margin notes. In the text a note is a small mark (its number, or
// a margin sign); clicking it opens a small editor under it for the note's text,
// which may hold formulas. The note's text lives inside the note node, so undo,
// saving and export see it like any other text.
import { EditorView } from 'prosemirror-view';
import { EditorState } from 'prosemirror-state';
import { keymap } from 'prosemirror-keymap';
import { StepMap } from 'prosemirror-transform';
import { baseKeymap } from 'prosemirror-commands';
import { undo, redo } from 'prosemirror-history';
import { MathView } from './mathview.js';

export class NoteView {
  constructor(node, outer, getPos) {
    this.node = node;
    this.outer = outer;
    this.getPos = getPos;
    this.dom = document.createElement('span');
    this.dom.className = 'note note-' + node.attrs.kind;
    this.dom.title = node.textContent;
    this.inner = null;
  }

  // the number comes from the numbering plugin as a decoration (data-num)
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); if (!this.inner) this.open(); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); if (this.inner) this.close(); }

  open() {
    const box = this.dom.appendChild(document.createElement('span'));
    box.className = 'note-editor';
    box.contentEditable = 'false';
    this.inner = new EditorView(box, {
      state: EditorState.create({
        doc: this.node,
        plugins: [keymap({
          'Mod-z': () => undo(this.outer.state, this.outer.dispatch),
          'Mod-y': () => redo(this.outer.state, this.outer.dispatch),
          // Escape or Enter goes back to the text after the note
          Escape: () => { this.outer.focus(); return true; },
        }), keymap(baseKeymap)],
      }),
      nodeViews: {
        math_inline: (n, v, g) => new MathView(n, v, g),
      },
      dispatchTransaction: this.dispatchInner.bind(this),
      handleDOMEvents: {
        // a click inside the note's editor must not select the note node again
        mousedown: () => { if (this.outer.hasFocus()) this.inner.focus(); return false; },
      },
    });
    this.inner.focus();
  }

  close() {
    this.inner.destroy();
    this.inner = null;
    this.dom.querySelector('.note-editor')?.remove();
  }

  // changes in the note's editor are copied into the outer document
  dispatchInner(tr) {
    const { state, transactions } = this.inner.state.applyTransaction(tr);
    this.inner.updateState(state);
    if (!tr.getMeta('fromOutside')) {
      const outerTr = this.outer.state.tr;
      const offset = this.getPos() + 1;
      for (const t of transactions) {
        for (const step of t.steps) outerTr.step(step.map(StepMap.offset(offset)));
      }
      if (outerTr.docChanged) this.outer.dispatch(outerTr);
    }
  }

  update(node) {
    if (!node.sameMarkup(this.node)) return false;
    this.node = node;
    this.dom.title = node.textContent;
    if (this.inner) {
      const { state } = this.inner;
      const start = node.content.findDiffStart(state.doc.content);
      if (start != null) {
        let { a: endA, b: endB } = node.content.findDiffEnd(state.doc.content);
        const overlap = start - Math.min(endA, endB);
        if (overlap > 0) { endA += overlap; endB += overlap; }
        this.inner.dispatch(state.tr.replace(start, endB, node.slice(start, endA)).setMeta('fromOutside', true));
      }
    }
    return true;
  }

  destroy() { if (this.inner) this.close(); }
  stopEvent(event) { return !!(this.inner && this.inner.dom.contains(event.target)); }
  ignoreMutation() { return true; }
}
