// 5.5 Compute menu, part "statpoly": Statistics and Polynomials items that ask something first
// (5.5's Fit Curve to Data, Random Numbers, Data Moments, Data Quantile and variable dialogs).
// Each entry is op -> (ctx) => ..., ctx as described in src/c55.js.
import { _t, _tm } from './i18n.js';
import { compute } from './compute.js';
import { schema } from './schema.js';

// what the engine says when a polynomial has several variables and none was given (5.5 then asks)
const NEED_VARIABLE = 'Choose the polynomial variable (there are several)';

// the formula the cursor is in, or a message
function formula(ctx) {
  const mv = ctx.currentMath();
  if (!mv) ctx.toast(_t('Put the cursor in a formula to compute'));
  return mv;
}

// Divide, Roots, Sort, Companion Matrix, Partial Fractions: in the one variable there is; with
// several, 5.5 asks which (Divide first tries the variable of the numerator or denominator that
// has only one, as 5.5's tcidiv does)
async function polynomialOp(ctx, op, title) {
  const mv = formula(ctx);
  if (!mv) return;
  const { variables } = await ctx.formulaInfo(mv.latex).catch(() => ({ variables: [] }));
  if (variables.length > 1) {
    let ask = true;
    if (op === 'divide') {
      try { await compute(op, mv.latex); ask = false; } catch (e) { ask = String(e.message).includes(_tm(NEED_VARIABLE)); }
    }
    if (ask) {
      ctx.askCompute(op, title, `<p>${_t('Variable:')} ${ctx.varField(variables, ctx.guessVariable(variables))}</p>`,
        (d) => [ctx.field(d, '#d-v') || ctx.guessVariable(variables)]);
      return;
    }
  }
  ctx.runCompute(op, undefined, mv);
}

// Polynomials > Collect...: 5.5 always asks the variables to collect in
async function collect(ctx) {
  const mv = formula(ctx);
  if (!mv) return;
  const { variables } = await ctx.formulaInfo(mv.latex).catch(() => ({ variables: [] }));
  ctx.askCompute('collect', _t('Polynomial collect'), `<p>${_t('Variable(s) (separated by commas):')} ${ctx.varField(variables, ctx.guessVariable(variables))}</p>`, (d) => {
    const vs = ctx.field(d, '#d-v').split(',').map((v) => v.trim()).filter(Boolean);
    return vs.length ? vs : null;
  });
}

// Statistics > Fit Curve to Data...
function fitCurve(ctx) {
  if (!formula(ctx)) return;
  const radio = (name, v, label, checked) => `<label><input type="radio" name="${name}" value="${v}"${checked ? ' checked' : ''}> ${label}</label>`;
  ctx.askCompute('fitcurve', _t('Fit Curve to Data'), `<fieldset><legend>${_t('Location of Dependent Variable')}</legend>
      ${radio('d-col', 'first', _t('First Column'))}　${radio('d-col', 'last', _t('Last Column'), true)}</fieldset>
    <p>${radio('d-kind', 'regression', _t('Multiple Regression'), true)}</p>
    <p>${radio('d-kind', 'noconstant', _t('Multiple Regression (No Constant)'))}</p>
    <p>${radio('d-kind', 'polynomial', _t('Polynomial of Degree'))} <input id="d-deg" size="3" value="2"></p>`, (d) => {
    const kind = d.querySelector('input[name="d-kind"]:checked').value;
    const col = d.querySelector('input[name="d-col"]:checked').value;
    const deg = ctx.field(d, '#d-deg');
    if (kind === 'polynomial' && !/^\d+$/.test(deg)) { ctx.toast(_t('The degree must be a whole number')); return null; }
    return [`'${kind}'`, `'${col}'`, ...(kind === 'polynomial' ? [deg] : [])];
  });
}

// Statistics > Moment...: 5.5's Data Moments dialog
function moment(ctx) {
  if (!formula(ctx)) return;
  ctx.askCompute('moment', _t('Data Moments'), `<p>${_t('Moment Number')} <input id="d-r" size="4" value="1"></p>
    <fieldset><legend>${_t('Moment Origin')}</legend>
      <p><label><input type="radio" name="d-o" value="mean" checked> ${_t('About Mean')}</label></p>
      <p><label><input type="radio" name="d-o" value="about"> ${_t('About')}</label> <input id="d-a" size="6" value="0"></p></fieldset>`, (d) => {
    const r = ctx.field(d, '#d-r');
    if (!r) { ctx.toast(_t('Give the moment number')); return null; }
    return d.querySelector('input[name="d-o"]:checked').value === 'mean' ? [r, "'mean'"] : [r, ctx.field(d, '#d-a') || '0'];
  });
}

// Statistics > Quantile...: 5.5's Data Quantile dialog
function quantile(ctx) {
  if (!formula(ctx)) return;
  ctx.askCompute('quantile', _t('Data Quantile'), `<p>${_t('Quantile   q (0 < q < 1)')} <input id="d-q" size="6" value="0.5"></p>`, (d) => {
    const q = ctx.field(d, '#d-q');
    const v = Number(q);
    if (!q || !(v > 0 && v < 1)) { ctx.toast(_t('The quantile must be between 0 and 1')); return null; }
    return [q];
  });
}

// Statistics > Random Numbers...: the distributions of 5.5's dialog and what each asks
const DISTRIBUTIONS = [
  ['beta', 'Beta', ['Order', 'Order']],
  ['binomial', 'Binomial', ['Number of Trials', 'Probability of Success']],
  ['cauchy', 'Cauchy', ['Median', 'Shape Parameter']],
  ['chisquare', 'Chi-Square', ['Degrees of Freedom']],
  ['exponential', 'Exponential', ['Mean Time Between Arrivals']],
  ['f', 'F', ['Degrees of Freedom', 'Degrees of Freedom']],
  ['gamma', 'Gamma', ['Shape Parameter', 'Scale Parameter']],
  ['normal', 'Normal', ['Mean', 'Standard Deviation']],
  ['poisson', 'Poisson', ['Mean Number of Occurrences']],
  ['t', "Student's t", ['Degrees of Freedom']],
  ['uniform', 'Uniform', ['Lower End of Range', 'Upper End of Range']],
  ['weibull', 'Weibull', ['Shape Parameter', 'Scale Parameter']],
];
// the words for the translation table (the list above holds them as data)
const WORDS = () => [_t('Beta'), _t('Binomial'), _t('Cauchy'), _t('Chi-Square'), _t('Exponential'), _t('F'), _t('Gamma'), _t('Normal'), _t('Poisson'),
  _t("Student's t"), _t('Uniform'), _t('Weibull'), _t('Order'), _t('Number of Trials'), _t('Probability of Success'), _t('Median'), _t('Shape Parameter'),
  _t('Degrees of Freedom'), _t('Mean Time Between Arrivals'), _t('Scale Parameter'), _t('Mean'), _t('Standard Deviation'), _t('Mean Number of Occurrences'),
  _t('Lower End of Range'), _t('Upper End of Range')];
let lastRandom = { dist: 'normal', n: '10', p: ['', ''] };

function randomNumbers(ctx) {
  WORDS();
  const opts = DISTRIBUTIONS.map(([v, l]) => `<option value="${v}"${v === lastRandom.dist ? ' selected' : ''}>${_t(l)}</option>`).join('');
  ctx.dialog(_t('Random Numbers'), `<p>${_t('How Many?')} <input id="d-n" size="5" value="${ctx.escHtml(lastRandom.n)}"></p>
    <p><select id="d-dist" size="6">${opts}</select></p>
    <fieldset><legend>${_t('Parameters')}</legend>
      <p id="d-p1row"><span id="d-l1"></span> <input id="d-p1" size="8" value="${ctx.escHtml(lastRandom.p[0])}"></p>
      <p id="d-p2row"><span id="d-l2"></span> <input id="d-p2" size="8" value="${ctx.escHtml(lastRandom.p[1])}"></p></fieldset>`, async (d) => {
    const dist = d.querySelector('#d-dist').value;
    const n = ctx.field(d, '#d-n');
    const need = DISTRIBUTIONS.find((x) => x[0] === dist)[2].length;
    const p = [ctx.field(d, '#d-p1'), ctx.field(d, '#d-p2')].slice(0, need);
    lastRandom = { dist, n, p: [ctx.field(d, '#d-p1'), ctx.field(d, '#d-p2')] };
    if (!/^\d+$/.test(n) || +n < 1) { ctx.toast(_t('How many: a whole number from 1 on')); return; }
    if (p.some((x) => !x)) { ctx.toast(_t('Give the parameters of the distribution')); return; }
    try {
      const r = await compute('randomnumbers', '0', [`'${dist}'`, n, ...p]);
      insertAtCursor(ctx, r.latex);
    } catch (e) { ctx.toast(_t('Could not compute: ') + e.message); }
  });
  const body = document.querySelector('#dialog-body');
  const show = () => {
    const labels = DISTRIBUTIONS.find((x) => x[0] === body.querySelector('#d-dist').value)[2];
    body.querySelector('#d-l1').textContent = _t(labels[0]);
    body.querySelector('#d-l2').textContent = labels[1] ? _t(labels[1]) : '';
    body.querySelector('#d-p2row').style.visibility = labels[1] ? 'visible' : 'hidden';
  };
  body.querySelector('#d-dist').onchange = show;
  show();
}

// the random numbers go where the cursor is: into the formula it is in, or as a new formula
function insertAtCursor(ctx, latex) {
  const mv = ctx.currentMath();
  if (mv) {
    mv.enter(false);
    mv.mf.insert(latex, { format: 'latex', selectionMode: 'after' });
    mv.changed();
    return;
  }
  const { view } = ctx.app;
  view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.math_inline.create({ latex })).scrollIntoView());
  view.focus();
}

export const ACTIONS = {
  collect,
  divide: (ctx) => polynomialOp(ctx, 'divide', _t('Polynomial divide')),
  partialfractions: (ctx) => polynomialOp(ctx, 'partialfractions', _t('Partial fractions')),
  roots: (ctx) => polynomialOp(ctx, 'roots', _t('Polynomial roots')),
  sort: (ctx) => polynomialOp(ctx, 'sort', _t('Polynomial sort')),
  companion: (ctx) => polynomialOp(ctx, 'companion', _t('Companion matrix')),
  fitcurve: fitCurve,
  randomnumbers: randomNumbers,
  moment,
  quantile,
};
