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

// What one change made, in whole top-level blocks (for the project's change log, projects.js):
// [{ index: where, removed: the blocks that went, added: those that came there }]; none when the
// two documents are the same. Blocks before the first and after the last difference are left
// out; when as many blocks came as went, each block that differs is given by itself (a text
// replaced in the first and the last paragraph is two changes, not everything in between).
export function blockDiff(before, after) {
  let start = 0;
  let [endB, endA] = [before.childCount, after.childCount];
  while (start < endB && start < endA && before.child(start).eq(after.child(start))) start++;
  while (endB > start && endA > start && before.child(endB - 1).eq(after.child(endA - 1))) { endB--; endA--; }
  if (endB === start && endA === start) return [];
  const blocks = (doc, to) => Array.from({ length: to - start }, (_, i) => doc.child(start + i));
  const [removed, added] = [blocks(before, endB), blocks(after, endA)];
  if (removed.length !== added.length) return [{ index: start, removed, added }];
  return removed.map((node, i) => ({ index: start + i, removed: [node], added: [added[i]] })).filter((c) => !c.removed[0].eq(c.added[0]));
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
