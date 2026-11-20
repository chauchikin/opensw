// 5.5 Compute menu, part "matdecomp": the items of this part that need more than runCompute(op)
// (a dialog, a picture ...). Each entry is op -> (ctx) => ..., ctx as described in src/c55.js.
import { _t } from './i18n.js';

export const ACTIONS = {
  // Matrices > Minimum Polynomial: the polynomial is in X; for a matrix with X in it 5.5 asks
  // for another variable first
  async minpoly(ctx) {
    const mv = ctx.currentMath();
    if (!mv) { ctx.toast(_t('Put the cursor in a formula to compute')); return; }
    const { variables } = await ctx.formulaInfo(mv.latex).catch(() => ({ variables: [] }));
    if (!variables.some((v) => v.includes('X'))) { ctx.runCompute('minpoly', undefined, mv); return; }
    ctx.askCompute('minpoly', _t('Minimum Polynomial'), `<p>${_t('Polynomial variable')} <input id="d-v" size="8" value="\\lambda"></p>`,
      (d) => [ctx.field(d, '#d-v') || '\\lambda']);
  },
};
