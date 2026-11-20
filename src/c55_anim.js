// 5.5 Compute menu, part "anim": Plot 2D Animated, Plot 3D Animated and Calculus > Plot
// Approximate Integral Animated. Each makes the same plot as the one without "Animated", with
// one more variable, the animation parameter (t from 0 to 10, 5 frames a second for 10 seconds,
// as 5.5); plots.js writes it as 5.5 does, animview.js plays it.
// eslint-disable-next-line no-unused-vars
import { _t } from './i18n.js';

// op -> the kind of plot (ui55.js plotOther)
const KINDS = {
  anim_rect: 'rect', anim_polar: 'polar', anim_implicit: 'implicit', anim_inequality: 'inequality', anim_param: 'param',
  anim_conformal: 'conformal', anim_gradient: 'gradient', anim_vector: 'vector',
  anim_surface: 'surface', anim_cylindrical: 'cylindrical', anim_spherical: 'spherical', anim_implicit3: 'implicit3',
  anim_tube: 'tube', anim_gradient3: 'gradient3', anim_vector3: 'vector3',
};

export const ACTIONS = {
  ...Object.fromEntries(Object.entries(KINDS).map(([op, kind]) => [op, (ctx) => ctx.plotOther(kind, { anim: true })])),
  // 5.5: "An animated middle-boxes plot will appear with default interval settings" (-5 to 5, 10 boxes)
  plotapproxint_anim: (ctx) => ctx.plotOther('approx', { range: [-5, 5], boxes: 10, boxType: 'middle', anim: true }),
};
