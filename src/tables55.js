// Text tables as in Scientific Word 5.5: Insert > Table, the row and column commands
// of the Edit menu, and table properties (column alignment and lines).
// prosemirror-tables does the cell work; this file turns 5.5's dialogs into it.
import { TextSelection } from 'prosemirror-state';
import {
  addRowAfter, addRowBefore, addColumnAfter, addColumnBefore, deleteRow, deleteColumn, deleteTable,
  mergeCells, splitCell, isInTable, selectedRect, TableMap,
} from 'prosemirror-tables';
import { schema } from './schema.js';
import { columnAligns } from './tex55.js';

const RULE_ROW = /\\(hline|toprule|midrule|bottomrule)/;

// Line styles of the Lines choice. colspec bars and the \hline rules carry them.
export const LINE_STYLES = [
  ['none', '無格線'],
  ['all', '全部格線'],
  ['box', '只有外框'],
  ['rows', '只有橫線'],
  ['booktabs', '三線表'],
];

export function makeTable(rows, cols, align = 'l', lines = 'none') {
  const cell = () => schema.nodes.table_cell.create({ align }, [schema.nodes.paragraph.create()]);
  const trs = Array.from({ length: rows }, () => schema.nodes.table_row.create(null, Array.from({ length: cols }, cell)));
  const table = schema.nodes.table.create({ colspec: align.repeat(cols) }, trs);
  return withLines(table, Array(cols).fill(align), lines);
}

// the table with its rules redone in one of LINE_STYLES (alignments: one per column)
export function withLines(table, aligns, style) {
  let colspec = aligns.join('');
  if (style === 'all') colspec = '|' + aligns.join('|') + '|';
  if (style === 'box') colspec = '|' + aligns.join('') + '|';
  const n = table.childCount;
  const rows = [];
  table.forEach((row, off, i) => {
    let before = '';
    if (style === 'all' || style === 'rows') before = '\\hline';
    if (style === 'box' && i === 0) before = '\\hline';
    if (style === 'booktabs') before = i === 0 ? '\\toprule' : i === 1 ? '\\midrule' : '';
    // a \cline written for one row stays with it
    const cline = (row.attrs.before.match(/\\cline\s*\{[^}]*\}/g) || []).join(' ');
    rows.push(row.type.create({ before: [before, cline].filter(Boolean).join(' ') }, row.content));
  });
  const after = style === 'none' ? '' : style === 'booktabs' ? '\\bottomrule' : '\\hline';
  return table.type.create({ ...table.attrs, colspec, after: n ? after : '' }, rows);
}

// which LINE_STYLES entry a table's rules look like (null: written by hand)
export function lineStyleOf(table) {
  const spec = table.attrs.colspec || '';
  const bars = (spec.match(/\|/g) || []).length;
  const width = columnAligns(spec).length || TableMap.get(table).width;
  const befores = [];
  table.forEach((r) => befores.push(r.attrs.before.replace(/\\cline\s*\{[^}]*\}/g, '').trim()));
  const after = table.attrs.after.trim();
  if (/toprule/.test(befores[0] || '') && /bottomrule/.test(after)) return 'booktabs';
  if (!bars && befores.every((b) => !b) && !after) return 'none';
  if (bars === width + 1 && befores.every((b) => RULE_ROW.test(b)) && after) return 'all';
  if (bars === 2 && RULE_ROW.test(befores[0] || '') && befores.slice(1).every((b) => !b) && after) return 'box';
  if (!bars && befores.every((b) => RULE_ROW.test(b)) && after) return 'rows';
  return null;
}

// the table node around the cursor and its position
function tableAt(state) {
  const $p = state.selection.$from;
  for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === 'table') return { node: $p.node(d), pos: $p.before(d) };
  return null;
}

export function setupTables({ view, dialog, toast, run }) {
  const inTable = () => isInTable(view.state);
  const need = (fn) => () => { if (!inTable()) { toast('把游標放在表格裡'); return; } fn(); };

  // Insert > Table: rows, columns, column alignment and lines, as 5.5 asks
  function insertTable() {
    dialog('表格', `<p>列數 <input id="d-rows" type="number" min="1" max="50" value="3" size="3">
      欄數 <input id="d-cols" type="number" min="1" max="20" value="3" size="3"></p>
      <p>欄對齊 <select id="d-align"><option value="l">靠左</option><option value="c">置中</option><option value="r">靠右</option></select></p>
      <p>格線 <select id="d-lines">${LINE_STYLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></p>`, (d) => {
      const r = Math.min(50, Math.max(1, +d.querySelector('#d-rows').value || 1));
      const c = Math.min(20, Math.max(1, +d.querySelector('#d-cols').value || 1));
      const table = makeTable(r, c, d.querySelector('#d-align').value, d.querySelector('#d-lines').value);
      const { state } = view;
      let tr = state.tr.replaceSelectionWith(table);
      // the cursor goes into the first cell
      const start = tr.mapping.map(state.selection.from, -1);
      let first = null;
      tr.doc.nodesBetween(start, tr.doc.content.size, (n, pos) => {
        if (first == null && n.type.name === 'table_cell') first = pos;
        return first == null;
      });
      if (first != null) tr = tr.setSelection(TextSelection.create(tr.doc, first + 2));
      view.dispatch(tr.scrollIntoView());
      view.focus();
    });
  }

  // Edit > Insert Row(s) / Insert Column(s): how many and where, as 5.5 asks
  function insertRows() {
    dialog('插入列', `<p>列數 <input id="d-n" type="number" min="1" max="50" value="1" size="3"></p>
      <p>位置 <select id="d-where"><option value="after">游標所在列的下面</option><option value="before">上面</option></select></p>`, (d) => {
      const n = Math.min(50, Math.max(1, +d.querySelector('#d-n').value || 1));
      const cmd = d.querySelector('#d-where').value === 'before' ? addRowBefore : addRowAfter;
      for (let i = 0; i < n; i++) cmd(view.state, view.dispatch);
      view.focus();
    });
  }
  function insertColumns() {
    dialog('插入欄', `<p>欄數 <input id="d-n" type="number" min="1" max="20" value="1" size="3"></p>
      <p>位置 <select id="d-where"><option value="after">游標所在欄的右邊</option><option value="before">左邊</option></select></p>`, (d) => {
      const n = Math.min(20, Math.max(1, +d.querySelector('#d-n').value || 1));
      const cmd = d.querySelector('#d-where').value === 'before' ? addColumnBefore : addColumnAfter;
      for (let i = 0; i < n; i++) cmd(view.state, view.dispatch);
      view.focus();
    });
  }

  // Edit > Properties in a table: alignment of the selected columns, and the lines
  function tableProperties() {
    const t = tableAt(view.state);
    if (!t) { toast('把游標放在表格裡'); return; }
    const rect = selectedRect(view.state);
    const style = lineStyleOf(t.node);
    const map = TableMap.get(t.node);
    const cellAt = (c) => t.node.nodeAt(map.map[rect.top * map.width + c]);
    const cur = cellAt(rect.left).attrs.align || columnAligns(t.node.attrs.colspec || '')[rect.left] || 'l';
    const opt = (v, l, sel) => `<option value="${v}"${v === sel ? ' selected' : ''}>${l}</option>`;
    dialog('表格屬性', `<p>第 ${rect.left + 1}${rect.right - rect.left > 1 ? `–${rect.right}` : ''} 欄對齊
      <select id="d-align">${opt('l', '靠左', cur)}${opt('c', '置中', cur)}${opt('r', '靠右', cur)}</select></p>
      <p>格線 <select id="d-lines">${style ? '' : '<option value="">照原本（手寫的格線）</option>'}${LINE_STYLES.map(([v, l]) => opt(v, l, style)).join('')}</select></p>`, (d) => {
      const align = d.querySelector('#d-align').value;
      const lines = d.querySelector('#d-lines').value;
      let table = t.node;
      // the columns' alignment: every cell that starts in them, and the column spec
      const aligns = [];
      for (let c = 0; c < map.width; c++) aligns.push(c >= rect.left && c < rect.right ? align : (columnAligns(table.attrs.colspec || '')[c] || 'l'));
      const rows = [];
      table.forEach((row, off, r) => {
        const cells = [];
        row.forEach((cell, coff) => {
          const c = map.colCount(off + 1 + coff);
          const inside = c >= rect.left && c < rect.right && cell.attrs.colspan === 1;
          cells.push(inside ? cell.type.create({ ...cell.attrs, align, spec: null }, cell.content) : cell);
        });
        rows.push(row.type.create(row.attrs, cells));
      });
      let spec = table.attrs.colspec || aligns.join('');
      // replace the letters of the chosen columns in the written spec, keeping its bars
      let col = 0;
      spec = spec.replace(/[lcr]|[pmb]\{[^}]*\}|X/g, (m) => (col++ >= rect.left && col <= rect.right ? align : m));
      table = table.type.create({ ...table.attrs, colspec: spec }, rows);
      if (lines) table = withLines(table, aligns, lines);
      const tr = view.state.tr.replaceWith(t.pos, t.pos + t.node.nodeSize, table);
      view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(view.state.selection.from, tr.doc.content.size)))));
      view.focus();
    });
  }

  // Insert > Caption: puts the table in a floating table with a caption (LaTeX's table environment)
  function addCaption() {
    const t = tableAt(view.state);
    if (!t) { toast('把游標放在表格裡'); return; }
    const $t = view.state.doc.resolve(t.pos);
    if ($t.parent.type.name === 'float_box') { toast('這個表格已經有標題'); return; }
    const cap = schema.nodes.caption.create(null, [schema.text('標題')]);
    const box = schema.nodes.float_box.create({ env: 'table', placement: 'htbp', centered: 'centering' }, [cap, t.node]);
    let tr = view.state.tr.replaceWith(t.pos, t.pos + t.node.nodeSize, box);
    tr = tr.setSelection(TextSelection.create(tr.doc, t.pos + 2, t.pos + 2 + 2));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  return {
    insertTable,
    insertRows: need(insertRows),
    insertColumns: need(insertColumns),
    deleteRow: need(() => run(deleteRow)),
    deleteColumn: need(() => run(deleteColumn)),
    deleteTable: need(() => run(deleteTable)),
    mergeCells: need(() => { if (!mergeCells(view.state, view.dispatch)) toast('先拖曳選取要合併的幾格'); view.focus(); }),
    splitCell: need(() => { if (!splitCell(view.state, view.dispatch)) toast('這一格沒有合併過'); view.focus(); }),
    tableProperties,
    addCaption: need(addCaption),
    inTable,
  };
}
