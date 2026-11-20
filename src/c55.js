// The items of 5.5's Compute menu (sw550ENUS.dll, menu 21) that need more than "compute this
// formula with op": a dialog first, a picture, a file. src/ui55.js builds the menu in 5.5's order
// and, for an item whose op has an entry here, calls it with ctx instead of runCompute(op).
// ctx: { app, _t, dialog(title, html, onOk(d)), askCompute(op, title, html, read(d) -> params|null),
//   runCompute(op, params?, mv?), currentMath() -> the math field or null, formulaInfo(latex) ->
//   { variables, equations }, varField(vars, cur) -> html of a variable input #d-v, guessVariable(vars),
//   field(d, '#id') -> trimmed value, escHtml, settings(), saveSettings(s), plotOther(kind, extra),
//   plot2d(), plotApproxIntegral(), definitions(op), engineInfo(), status(text), toast(text) }
import { ACTIONS as matdecomp } from './c55_matdecomp.js';
import { ACTIONS as matmisc } from './c55_matmisc.js';
import { ACTIONS as rewrite } from './c55_rewrite.js';
import { ACTIONS as statpoly } from './c55_statpoly.js';
import { ACTIONS as defsmisc } from './c55_defsmisc.js';
import { ACTIONS as anim } from './c55_anim.js';

export const ACTIONS55 = { ...matdecomp, ...matmisc, ...rewrite, ...statpoly, ...defsmisc, ...anim };
