// 5.5 Compute menu, part "matmisc": the items of this part that need more than runCompute(op)
// (a dialog, a picture ...). Each entry is op -> (ctx) => ..., ctx as described in src/c55.js.
// Matrices > Reshape asks the number of columns; Fill Matrix and Random Matrix make a new matrix
// where the insertion point is (in the brackets typed for it, as 5.5 asks; in text: a new formula).
import { _t } from './i18n.js';
import { compute } from './compute.js';
import { insertMath } from './mathview.js';

const num = (d, id, dflt) => d.querySelector(id).value.trim() || dflt;

// put a new matrix (\begin{matrix}..\end{matrix}) where the insertion point was before the dialog
function insertMatrix(ctx, mv, sel, latex) {
  if (mv) {
    const sink = mv.mf.shadowRoot?.querySelector('[part=keyboard-sink]');
    if (sink) sink.focus(); else mv.mf.focus();
    if (sel) mv.mf.selection = sel;
    mv.mf.insert(latex, { format: 'latex', selectionMode: 'after' });
    mv.changed();
    return;
  }
  // in text: a new formula with the matrix in parentheses
  const { view } = ctx.app;
  insertMath(false)(view.state, view.dispatch, view);
  const m = view.nodeDOM(view.state.selection.from - 1)?._mathView || ctx.currentMath();
  if (!m) return;
  m.mf.insert('\\left(' + latex + '\\right)', { format: 'latex', selectionMode: 'after' });
  m.changed();
}

// a dialog, then the engine makes the matrix (random entries, a function f(i, j) defined earlier ...)
function newMatrix(ctx, op, title, html, read, setup) {
  const mv = ctx.currentMath();
  const sel = mv?.mf.selection;
  ctx.dialog(title, html, async (d) => {
    const params = read(d);
    if (!params) return;
    try {
      const r = await compute(op, '0', params);
      insertMatrix(ctx, mv, sel, r.latex);
    } catch (e) {
      ctx.toast(_t('Could not compute: ') + e.message);
    }
  });
  setup?.(document.querySelector('#dialog-body'));
}

const sizeFields = (rows, cols) => `<p>${_t('Dimensions')}　${_t('Rows')} <input id="d-r" size="3" value="${rows}">　${_t('Columns')} <input id="d-c" size="3" value="${cols}"></p>`;

// 5.5's Fill Matrix: Zero, Identity, Random, Jordan block, Defined by function, Band
const FILL_LABELS = { zero: () => _t('Zero'), identity: () => _t('Identity'), random: () => _t('Random'), jordan: () => _t('Jordan block'), function: () => _t('Defined by function'), band: () => _t('Band') };
let lastFill = { rows: '3', cols: '3', kind: 'zero', item: '' };

function fillMatrix(ctx) {
  const radios = Object.keys(FILL_LABELS).map((v) => `<label><input type="radio" name="d-fill" value="${v}"${v === lastFill.kind ? ' checked' : ''}> ${FILL_LABELS[v]()}</label>`).join('<br>');
  newMatrix(ctx, 'fillmatrix', _t('Fill Matrix'), `${sizeFields(lastFill.rows, lastFill.cols)}
    <p>${_t('Fill with')}<br>${radios}</p>
    <p>${_t('Item/Function/List:')} <input id="d-item" size="20" value="${ctx.escHtml(lastFill.item)}" placeholder="${_t('e.g. f, or a, b, c')}"></p>`, (d) => {
    const kind = d.querySelector('input[name=d-fill]:checked')?.value || 'zero';
    const item = d.querySelector('#d-item').value.trim();
    lastFill = { rows: num(d, '#d-r', '3'), cols: num(d, '#d-c', '3'), kind, item };
    const needsItem = ['jordan', 'function', 'band'].includes(kind);
    if (needsItem && !item) { ctx.toast(_t('Fill in the entry')); return null; }
    return [`'${kind}'`, lastFill.rows, lastFill.cols, ...(needsItem ? [item] : [])];
  }, (body) => {
    // the entry box is for Jordan block, Defined by function and Band only, as in 5.5
    const sync = () => { body.querySelector('#d-item').disabled = !['jordan', 'function', 'band'].includes(body.querySelector('input[name=d-fill]:checked')?.value); };
    body.querySelectorAll('input[name=d-fill]').forEach((r) => r.addEventListener('change', sync));
    sync();
  });
}

// 5.5's Random Matrix: size, range of the random entries, Unrestricted / Symmetric / Antisymmetric / Triangular
const TYPES = [['unrestricted', () => _t('Unrestricted')], ['symmetric', () => _t('Symmetric')], ['antisymmetric', () => _t('Antisymmetric')], ['triangular', () => _t('Triangular')]];
let lastRandom = { rows: '3', cols: '3', min: '-9', max: '9', kind: 'unrestricted' };

function randomMatrix(ctx) {
  const radios = TYPES.map(([v, l]) => `<label><input type="radio" name="d-type" value="${v}"${v === lastRandom.kind ? ' checked' : ''}> ${l()}</label>`).join('<br>');
  newMatrix(ctx, 'randommatrix', _t('Random Matrix'), `${sizeFields(lastRandom.rows, lastRandom.cols)}
    <p>${_t('Range of random entries')} <input id="d-min" size="5" value="${lastRandom.min}"> ${_t('to')} <input id="d-max" size="5" value="${lastRandom.max}"></p>
    <p>${_t('Matrix types')}<br>${radios}</p>`, (d) => {
    lastRandom = { rows: num(d, '#d-r', '3'), cols: num(d, '#d-c', '3'), min: num(d, '#d-min', '-9'), max: num(d, '#d-max', '9'),
      kind: d.querySelector('input[name=d-type]:checked')?.value || 'unrestricted' };
    return [`'${lastRandom.kind}'`, lastRandom.rows, lastRandom.cols, lastRandom.min, lastRandom.max];
  });
}

let lastColumns = '2';
const reshape = (ctx) => ctx.askCompute('reshape', _t('Reshape'), `<p>${_t('Columns')} <input id="d-n" size="4" value="${lastColumns}"></p>`, (d) => {
  lastColumns = num(d, '#d-n', '2');
  return [lastColumns];
});

export const ACTIONS = {
  reshape,
  fillmatrix: fillMatrix,
  randommatrix: randomMatrix,
};
