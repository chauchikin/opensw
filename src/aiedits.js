// What an AI changed (MCP / window.sw, see api.js), so a person can see it and take it back.
// The first change an AI makes keeps a copy of the document as it was; more AI changes add to the
// same "AI edit". The blocks that differ from that copy are tinted, the status bar says so, and
// Edit > Undo AI Changes (or the button in the status bar) puts the copy back in one step.
// The AI edit ends when the person changes the document themselves or opens another one.
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

let before = null; // { doc, meta, metaText } before the AI's first change, or null
let lastAt = 0; // when the AI last changed something (ms)

export const aiEdit = () => before;
export const aiBusy = () => Date.now() - lastAt < 3000;

// called just before an AI changes the document
export function aiStart(doc, meta) {
  if (!before) { const metaText = JSON.stringify(meta || {}); before = { doc, meta: JSON.parse(metaText), metaText }; }
  lastAt = Date.now();
}

export function aiEnd() { before = null; }

// the top-level blocks that differ from the copy: one range from the first to the last difference
export function changedBlocks(doc) {
  if (!before) return [];
  const start = before.doc.content.findDiffStart(doc.content);
  if (start == null) return [];
  const end = Math.max(before.doc.content.findDiffEnd(doc.content)?.b ?? start, start);
  const out = [];
  doc.forEach((node, offset, index) => {
    if (offset + node.nodeSize > start && (offset < end || (offset === start && end === start))) out.push({ index, from: offset, to: offset + node.nodeSize });
  });
  return out;
}

export function aiChangesPlugin() {
  let cache = null;
  return new Plugin({
    props: {
      decorations(state) {
        if (!before) return null;
        if (cache?.doc !== state.doc || cache.before !== before) {
          const decos = changedBlocks(state.doc).map((b) => Decoration.node(b.from, b.to, { class: 'ai-changed' }));
          cache = { doc: state.doc, before, set: DecorationSet.create(state.doc, decos) };
        }
        return cache.set;
      },
    },
  });
}
