// 5.5 Compute menu, part "rewrite": the items of this part that need more than runCompute(op)
// (a dialog, a picture ...). Each entry is op -> (ctx) => ..., ctx as described in src/c55.js.
import { _t } from './i18n.js';

// Rewrite > Equations as Matrix / Matrix as Equations: 5.5 asks the variables first
// (SW6: computeVariables.xul, "Variable(s):"), then answers ", Corresponding matrix: ..."
async function askVariables(ctx, op, title) {
  const mv = ctx.currentMath();
  if (!mv) { ctx.toast(_t('Put the cursor in a formula to compute')); return; }
  let guess = '';
  if (op === 'eqs_to_matrix') {
    const { variables } = await ctx.formulaInfo(mv.latex).catch(() => ({ variables: [] }));
    guess = variables.join(', ');
  } else {
    // the columns of the matrix but the last: x, y, z
    const cols = (mv.latex.split(/\\\\/)[0].match(/&/g) || []).length;
    guess = cols >= 1 && cols <= 3 ? ['x', 'y', 'z'].slice(0, cols).join(', ') : '';
  }
  ctx.askCompute(op, title, `<p>${_t('Variable(s):')} <input id="d-vars" size="24" value="${ctx.escHtml(guess)}"></p>`, (d) => {
    const vs = ctx.field(d, '#d-vars').split(',').map((v) => v.trim()).filter(Boolean);
    if (!vs.length) { ctx.toast(_t('Write the variables, separated by commas')); return null; }
    return vs;
  });
}

export const ACTIONS = {
  eqs_to_matrix: (ctx) => askVariables(ctx, 'eqs_to_matrix', _t('Rewrite equations as matrix')),
  matrix_to_eqs: (ctx) => askVariables(ctx, 'matrix_to_eqs', _t('Rewrite matrix as equations')),
};
