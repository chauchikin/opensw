// Plots of Scientific Word 5.x. A 5.x plot is a \FRAME whose \special lists the
// plot's settings and its functions, e.g.
//   type "MAPLEPLOT";xviewmin "-3";xviewmax "3";...;axesstyle "normal";
//   var1name \TEXUX{$x$};function \TEXUX{$\sin x$};linecolor "black";var1range "-3,3";
//   num-x-gridlines 100;curveColor "[flat::RGB:0x00ff0000]";function \TEXUX{...};...
// 5.5 kept a picture of the plot in a .wmf file, which neither a browser nor TeX can
// use, and Maple/MuPAD drew it. opensw draws the plot again from these settings:
// the points come from the computation engine (SymPy), the picture is an SVG.

// key/value pairs of the \special, in order (values may contain ";" inside \TEXUX{..})
export function specialPairs(body) {
  const s = body.replace(/^\s*\\special\s*\{/, '').replace(/\}\s*$/, '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /[\s;]/.test(s[i])) i++;
    const km = s.slice(i).match(/^[A-Za-z][\w-]*/);
    if (!km) { i++; continue; }
    const key = km[0];
    i += key.length;
    while (s[i] === ' ' || s[i] === '\n') i++;
    let value = '';
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i];
      const end = s.indexOf(q, i + 1);
      value = s.slice(i + 1, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end + 1;
    } else if (s.startsWith('\\TEXUX', i)) {
      const open = s.indexOf('{', i);
      let depth = 0;
      let j = open;
      for (; j < s.length; j++) {
        if (s[j] === '\\') { j++; continue; }
        if (s[j] === '{') depth++;
        else if (s[j] === '}' && --depth === 0) break;
      }
      value = s.slice(open + 1, j).trim().replace(/^\$|\$$/g, '').trim();
      i = j + 1;
    } else {
      const end = s.indexOf(';', i);
      value = s.slice(i, end < 0 ? s.length : end).trim();
      i = end < 0 ? s.length : end;
    }
    out.push([key, value]);
  }
  return out;
}

const NAMED = { black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', cyan: '#00ffff',
  magenta: '#ff00ff', yellow: '#ffff00', white: '#ffffff', gray: '#808080', grey: '#808080' };

// "[flat::RGB:0x00ff0000]" or "0000000000" -> "#ff0000"
function colorOf(v) {
  const m = String(v).match(/(?:0x)?([0-9a-fA-F]{8,10})\]?\s*$/);
  if (m) return '#' + m[1].slice(-6).toLowerCase();
  return NAMED[String(v).toLowerCase()] || null;
}
const num = (v) => (v == null || v === '' || Number.isNaN(+v) ? null : +v);
// 5.x writes Greek letters in a plot's settings as \U{3b8}: back to \theta
const GREEK_U = ['alpha', 'beta', 'gamma', 'delta', 'varepsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu',
  'nu', 'xi', 'omicron', 'pi', 'rho', 'varsigma', 'sigma', 'tau', 'upsilon', 'varphi', 'chi', 'psi', 'omega'];
const unU = (v) => String(v).replace(/\\U\{([0-9a-fA-F]+)\}\s*/g, (m, h) => {
  const c = parseInt(h, 16);
  return c >= 0x3b1 && c <= 0x3c9 ? `\\${GREEK_U[c - 0x3b1]} ` : String.fromCodePoint(c);
}).trim();
const range = (v) => { const [a, b] = String(v).split(',').map(num); return a != null && b != null ? [a, b] : null; };

// the plot's settings: { type, view: {x, y}, axes, curves: [{ latex, variable, range, n, color, width, dash }] }
export function parsePlot(body) {
  const plot = { type: null, plottype: null, view: { x: null, y: null }, range: null, axes: 'normal', variable: 'x', variable2: 'y', curves: [] };
  const g = {};
  let cur = null;
  for (const [k, v] of specialPairs(body)) {
    if (k === 'function') {
      cur = { latex: unU(v.replace(/\\allowbreak\s*/g, '')), variable: null, range: null, range2: null, range3: null, n: null, grid: [null, null, null], color: null, width: 1, dash: null, style: 'Line' };
      plot.curves.push(cur);
      continue;
    }
    const target = cur || g;
    target[k] = v;
    if (!cur) continue;
    if (k === 'var1name') cur.variable = unU(v);
    if (k === 'var1range') cur.range = range(v) || cur.range;
    if (k === 'var2range') cur.range2 = range(v) || cur.range2;
    if (k === 'var3range') cur.range3 = range(v) || cur.range3;
    if (k === 'num-x-gridlines') { cur.n = num(v); cur.grid[0] = num(v); }
    if (k === 'num-y-gridlines') cur.grid[1] = num(v);
    if (k === 'num-z-gridlines') cur.grid[2] = num(v);
    if (k === 'radius') cur.radius = unU(v);
    if (k === 'numboxes') cur.boxes = num(v);
    if (k === 'approxIntBoxType') cur.boxType = v;
    if (k === 'fillColor') cur.fill = colorOf(v);
    if (k === 'fillColor2') cur.fill2 = colorOf(v);
    if (k === 'curveColor' || (k === 'linecolor' && !cur.color)) cur.color = colorOf(v) || cur.color;
    if (k === 'linethickness') cur.width = num(v) || 1;
    if (k === 'lineAttributes') cur.dash = /dash/i.test(v) ? '6 4' : /dot/i.test(v) ? '1.5 3' : null;
    if (k === 'curveStyle') cur.style = v;
    if (k === 'animationParamRange') cur.animRange = range(v);
    // the 3D colouring, style and mesh, a point plot's marker (Compute > Settings > 2D / 3D Plots)
    if (k === 'surfaceStyle') cur.surfaceStyle = v;
    if (k === 'surfaceMesh') cur.mesh = v;
    if (k === 'pointStyle') cur.marker = v;
    if (k === 'discAdjust') cur.discAdjust = /true/i.test(v);
    if (k === 'surfaceColor') {
      const m = v.match(/^\[linear:(\w+):RGB:0x00([0-9a-f]{6}):0x00([0-9a-f]{6})\]$/i) || v.match(/^\[flat::RGB:0x00([0-9a-f]{6})\]$/i);
      if (m && m.length === 4) Object.assign(cur, { shading: m[1], base: '#' + m[2].toLowerCase(), secondary: '#' + m[3].toLowerCase() });
      else if (m) Object.assign(cur, { shading: 'None', base: '#' + m[1].toLowerCase() });
    }
  }
  plot.type = g.type || null;
  plot.plottype = num(g.plottype);
  plot.axes = g.axesstyle || 'normal';
  plot.variable = unU(g.var1name || 'x');
  plot.variable2 = unU(g.var2name || 'y');
  plot.variable3 = unU(g.var3name || 'z');
  plot.constrained = /true/i.test(g.constrained || '');
  plot.turn = num(g.theta);
  plot.tilt = num(g.phi);
  const xr = [num(g.xmin), num(g.xmax)];
  if (xr[0] != null && xr[1] != null) plot.range = xr;
  const yr = [num(g.ymin), num(g.ymax)];
  plot.range2 = yr[0] != null && yr[1] != null ? yr : null;
  const zr = [num(g.zmin), num(g.zmax)];
  plot.range3 = zr[0] != null && zr[1] != null ? zr : null;
  // viewset "XY": the window was set by hand (otherwise the plot program chose it)
  const xv = [num(g.xviewmin), num(g.xviewmax)];
  const yv = [num(g.yviewmin), num(g.yviewmax)];
  if (xv[0] != null && xv[1] != null && xv[0] < xv[1]) plot.view.x = xv;
  if (yv[0] != null && yv[1] != null && yv[0] < yv[1]) plot.view.y = yv;
  plot.anim = /true/i.test(g.animated || '') ? animOf(g, plot.curves) : null;
  for (const c of plot.curves) {
    c.variable = c.variable || plot.variable;
    c.range = c.range || plot.range || plot.view.x || [-5, 5];
    c.range2 = c.range2 || plot.range2 || [-5, 5];
    c.range3 = c.range3 || plot.range3 || [-5, 5];
    c.grid = c.grid.map((n, k) => n || num(g[`num-${'xyz'[k]}-gridlines`]));
    c.n = Math.min(2000, Math.max(20, c.n || num(g.numpoints) || 100));
    c.color = c.color || '#000000';
  }
  return plot;
}

// 5.5's animated plots (Plot 2D/3D Animated): one more variable, the animation parameter
// (t from 0 to 10 unless set), shown over animationStartTime..animationEndTime seconds at
// animationFramesPerSecond; currentAnimationTime is the frame shown when it is not playing
export const ANIM_DEFAULT = { param: 't', range: [0, 10], start: 0, end: 10, fps: 5, current: null };
function animOf(g, curves) {
  const r = [num(g.animationParamMin), num(g.animationParamMax)];
  const own = curves.find((c) => c.animRange)?.animRange;
  const start = num(g.animationStartTime) ?? 0;
  const end = num(g.animationEndTime) ?? 10;
  return { param: unU(g.animationParam || g.animationParamList || 't'), range: own || (r[0] != null && r[1] != null ? r : [0, 10]),
    start, end: end > start ? end : start + 10, fps: Math.max(1, num(g.animationFramesPerSecond) || 5), current: num(g.currentAnimationTime) };
}
// the settings of an animated plot as 5.5 writes them: [before the ranges, after the variables'
// names, after each function's ranges]
function animParts(plot) {
  const a = plot.anim;
  if (!a) return ['', '', ''];
  return [`animated TRUE;${a.current != null ? `currentAnimationTime "${a.current}";` : ''}animationStartTime "${a.start}";animationEndTime "${a.end}";animationFramesPerSecond "${a.fps}";`
    + `animationParamMin "${a.range[0]}";animationParamMax "${a.range[1]}";`,
  `animationParam \\TEXUX{${a.param}};animationParamList \\TEXUX{$${a.param}$};`,
  `animationParamRange "${a.range.join(',')}";`];
}
export const isAnimated = (plot) => !!plot?.anim;

// a 5.x plot \special for these settings (Compute > Plot 2D and the plot's Properties write it)
export function plotSpecial(plot, { width = '3in', height = '2in', path }) {
  const kind = plotKind(plot);
  if (kind === 'surface' && plot.curves.every((c) => components(c.latex).length === 1)) return surfaceSpecial(plot, { width, height, path });
  if (!['rect', 'log', 'loglog', 'polar', 'param'].includes(kind)) return otherSpecial(plot, kind, { width, height, path });
  const rect = !['polar', 'param'].includes(kind);
  const [x0, x1] = rect ? plot.view.x || plot.range || [-5, 5] : plot.range || plot.curves[0]?.range || [-5, 5];
  const xview = rect ? `xviewmin "${x0}";xviewmax "${x1}";` : plot.view.x ? `xviewmin "${plot.view.x[0]}";xviewmax "${plot.view.x[1]}";` : '';
  const [anim0, anim1, anim2] = animParts(plot);
  const parts = [`language "Scientific Word";type "MAPLEPLOT";width ${width};height ${height};depth 0pt;display "USEDEF";plot_snapshots TRUE;${anim0}`,
    `xmin "${x0}";xmax "${x1}";${xview}`,
    plot.view.y ? `yviewmin "${plot.view.y[0]}";yviewmax "${plot.view.y[1]}";viewset"XY";` : xview ? 'viewset"X";' : '',
    `rangeset"X${plot.anim ? 'A' : ''}";plottype ${plot.plottype || 4};${plot.constrained ? 'constrained TRUE;' : ''}axesstyle "${plot.axes || 'normal'}";numpoints 100;${anim1}var1name \\TEXUX{$${plot.variable || 'x'}$};`];
  for (const c of plot.curves) {
    const hex = (c.color || '#000000').replace('#', '');
    parts.push(`function \\TEXUX{$${c.latex}$};linestyle 1;linethickness ${c.width || 1};lineAttributes "${lineAttr(c.dash)}";`
      + (kind === 'polar' ? 'coordinateSystem "polar";' : '')
      + `var1range "${(c.range || [x0, x1]).join(',')}";${anim2}num-x-gridlines ${c.n || 100};curveColor "[flat::RGB:0x00${hex}]";curveStyle "${c.style || 'Line'}";`
      + (c.style === 'Point' && c.marker ? `pointStyle "${c.marker}";` : '') + (c.discAdjust != null ? `discAdjust ${c.discAdjust ? 'TRUE' : 'FALSE'};` : ''));
  }
  parts.push(`valid_file "T";tempfilename '${path}';`);
  return `\\special{${parts.join('')}}`;
}

// 5.5's plottype numbers (from its help files): 2D 4 rectangular, 20 log, 21 log-log,
// 8 and 22 polar, 19 parametric, 12 implicit, 25 inequality, 9 conformal, 10 gradient,
// 11 vector field, 3 approximate integral; 3D 5 rectangular (z = f(x, y), or a surface
// (x, y, z)(s, t)), 14 cylindrical, 15 spherical, 18 implicit, 13 tube, 16 gradient,
// 17 vector field. 23 is opensw's own: Plot 2D > ODE (5.5 kept that one only as a picture).
const KINDS = { 4: 'rect', 20: 'log', 21: 'loglog', 8: 'polar', 22: 'polar', 19: 'param', 12: 'implicit', 25: 'inequality',
  9: 'conformal', 10: 'gradient', 11: 'vector', 3: 'approx', 23: 'ode',
  5: 'surface', 14: 'cylindrical', 15: 'spherical', 18: 'implicit3', 13: 'tube', 16: 'gradient3', 17: 'vector3' };
export const PLOTTYPE = Object.fromEntries(Object.entries(KINDS).map(([n, k]) => [k, +n]).reverse());
export const plotKind = (plot) => (plot.plottype == null ? 'rect' : KINDS[plot.plottype] || null);
export const is3D = (kind) => ['surface', 'cylindrical', 'spherical', 'implicit3', 'tube', 'gradient3', 'vector3'].includes(kind);
// how many variables each kind of plot runs over
export const DIMS = { rect: 1, log: 1, loglog: 1, polar: 1, param: 1, approx: 1, ode: 1, tube: 1, implicit: 2, inequality: 2,
  conformal: 2, gradient: 2, vector: 2, surface: 2, cylindrical: 2, spherical: 2, implicit3: 3, gradient3: 3, vector3: 3 };

// "\left( \cos t,\sin t\right)" -> ["\cos t", "\sin t"]; a formula that is not a tuple -> [itself]
export function components(latex) {
  const s = latex.trim().replace(/^\\left\s*[([]|^[([]/, '').replace(/\\right\s*[)\]]$|[)\]]$/, '');
  if (s.length === latex.trim().length) return [latex];
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.length > 1 ? out.map((x) => x.trim()) : [latex];
}

// LaTeX "a < b" -> { lhs, rhs, rel } at the first relation outside brackets (null when none)
export function splitRelation(latex) {
  let depth = 0;
  for (let i = 0; i < latex.length; i++) {
    const ch = latex[i];
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    else if (ch === '}' || ch === ')' || ch === ']') depth--;
    else if (depth === 0) {
      const m = latex.slice(i).match(/^(\\leq?(?![a-z])|\\geq?(?![a-z])|\\lt(?![a-z])|\\gt(?![a-z])|<|>|=)/);
      if (m) {
        const rel = { '\\le': '<=', '\\leq': '<=', '\\ge': '>=', '\\geq': '>=', '\\lt': '<', '\\gt': '>' }[m[0]] || m[0];
        return { lhs: latex.slice(0, i).trim(), rhs: latex.slice(i + m[0].length).trim(), rel };
      }
      if (ch === '\\') { const w = latex.slice(i).match(/^\\[a-zA-Z]+/); if (w) i += w[0].length - 1; else i++; }
    }
  }
  return null;
}

// a plot opensw can draw (the parts each kind needs: y = f(x); polar r(t) or (r, angle);
// parametric (x, y); a vector field [P, Q] ...)
export function drawable(plot) {
  const kind = plotKind(plot);
  if (!kind || !plot.curves.length) return false;
  if (['rect', 'log', 'loglog', 'polar', 'param'].includes(kind) && plot.curves.some((c) => c.style === 'Point')) return false;
  const n = (c) => components(c.latex).length;
  const all = (ok) => plot.curves.every((c) => ok(n(c), c));
  switch (kind) {
    case 'polar': return all((k) => k <= 2);
    case 'param': case 'vector': return all((k) => k === 2);
    case 'tube': case 'vector3': return all((k) => k === 3);
    case 'surface': case 'cylindrical': case 'spherical': return all((k) => k === 1 || k === 3);
    case 'implicit': case 'implicit3': return all((k, c) => k === 1 && splitRelation(c.latex)?.rel === '=');
    case 'inequality': return all((k, c) => k === 1 && /[<>]/.test(splitRelation(c.latex)?.rel || ''));
    case 'ode': return true;
    default: return all((k) => k === 1);
  }
}

const grid = (c, i) => (c.grid && c.grid[i]) || 25;
// a 3D rectangular plot's \special (Compute > Plot 3D > Rectangular)
function surfaceSpecial(plot, { width, height, path }) {
  const c = plot.curves[0];
  const [x0, x1] = c.range;
  const [y0, y1] = c.range2;
  const [anim0, anim1, anim2] = animParts(plot);
  return `\\special{language "Scientific Word";type "MAPLEPLOT";width ${width};height ${height};depth 0pt;display "USEDEF";plot_snapshots TRUE;${anim0}`
    + `xmin "${x0}";xmax "${x1}";ymin "${y0}";ymax "${y1}";${turnTilt(plot)}plottype 5;num-x-gridlines ${grid(c, 0)};num-y-gridlines ${grid(c, 1)};plotstyle "patch";axesstyle "${plot.axes || 'normal'}";`
    + `plotshading "${c.shading && c.shading !== 'None' ? c.shading : 'XYZ'}";${anim1}var1name \\TEXUX{$${plot.variable}$};var2name \\TEXUX{$${plot.variable2}$};`
    + plot.curves.map((k) => `function \\TEXUX{$${k.latex}$};var1range "${k.range.join(',')}";var2range "${k.range2.join(',')}";${anim2}`
      + surfaceAttrs(k).replace('surfaceMesh', `num-x-gridlines ${grid(k, 0)};num-y-gridlines ${grid(k, 1)};surfaceMesh`)).join('')
    + `valid_file "T";tempfilename '${path}';}`;
}

// a 3D plot's view as 5.5 writes it (phi: tilt, theta: turn), when it was read from the file
const turnTilt = (plot) => (plot.tilt != null && plot.turn != null ? `phi ${plot.tilt};theta ${plot.turn};` : '');

// the \special of the other kinds: the settings 5.5 writes for them (see its help files)
function otherSpecial(plot, kind, { width, height, path }) {
  const dims = DIMS[kind];
  const c0 = plot.curves[0];
  const rs = [c0.range, c0.range2, c0.range3].slice(0, dims);
  const vars = [plot.variable, plot.variable2, plot.variable3];
  const three = is3D(kind);
  const hex = (c) => (c || '#000000').replace('#', '');
  const [anim0, anim1, anim2] = animParts(plot);
  const parts = [`language "Scientific Word";type "MAPLEPLOT";width ${width};height ${height};depth 0pt;display "USEDEF";plot_snapshots TRUE;${anim0}`,
    ['xmin', 'ymin', 'zmin'].slice(0, dims).map((k, i) => `${k} "${rs[i][0]}";${k.replace('min', 'max')} "${rs[i][1]}";`).join(''),
    plot.view.x ? `xviewmin "${plot.view.x[0]}";xviewmax "${plot.view.x[1]}";` : '',
    plot.view.y ? `yviewmin "${plot.view.y[0]}";yviewmax "${plot.view.y[1]}";viewset"XY";` : '',
    `${three ? turnTilt(plot) : ''}plottype ${PLOTTYPE[kind]};${plot.constrained ? 'constrained TRUE;' : ''}axesstyle "${plot.axes || (three ? 'boxed' : 'normal')}";${anim1}`,
    (dims > 1 || three ? vars : vars.slice(0, 1)).map((v, i) => `var${i + 1}name \\TEXUX{$${v}$};`).join('')];
  for (const c of plot.curves) {
    const g = c.grid || [];
    const coords = kind === 'cylindrical' || kind === 'spherical' ? `coordinateSystem "${kind}";` : '';
    parts.push(`function \\TEXUX{$${c.latex}$};`
      + (kind === 'tube' ? `radius \\TEXUX{$${c.radius || '0.2'}$};` : '')
      + (kind === 'approx' ? `numboxes ${c.boxes || 10};approxIntBoxType "${c.boxType || 'left'}";` : '')
      + coords
      + [c.range, c.range2, c.range3].slice(0, dims).map((r, i) => `var${i + 1}range "${r.join(',')}";`).join('') + anim2
      + [0, 1, 2].slice(0, kind === 'tube' ? 2 : dims).map((i) => (g[i] ? `num-${'xyz'[i]}-gridlines ${g[i]};` : '')).join('')
      + (three ? surfaceAttrs(c)
        : `curveColor "[flat::RGB:0x00${hex(c.color)}]";curveStyle "${kind === 'vector' || kind === 'gradient' ? 'Point' : 'Line'}";`)
      + (c.fill ? `fillColor "[flat::RGB:0x00${hex(c.fill)}]";` : '') + (c.fill2 ? `fillColor2 "[flat::RGB:0x00${hex(c.fill2)}]";` : ''));
  }
  parts.push(`valid_file "T";tempfilename '${path}';`);
  return `\\special{${parts.join('')}}`;
}

// 5.5's lineAttributes for a dash pattern; a 3D item's colouring, style and mesh (Compute > Settings > 3D Plots)
const lineAttr = (dash) => (!dash ? 'Solid' : dash === '1.5 3' ? 'Dots' : dash === '6 3 1.5 3' ? 'DashDot' : 'Dash');
const rgb = (c) => (c || '#000000').replace('#', '').toLowerCase();
function surfaceAttrs(c) {
  const shade = c.shading || 'XYZ';
  const color = shade === 'None' ? `[flat::RGB:0x00${rgb(c.base || '#ff0000')}]` : `[linear:${shade}:RGB:0x00${rgb(c.base || '#ff0000')}:0x00${rgb(c.secondary || '#0000ff')}]`;
  return `surfaceColor "${color}";surfaceStyle "${c.surfaceStyle || 'Color Patch'}";surfaceMesh "${c.mesh || 'Mesh'}";`;
}

// a "nice" step near span/target: 1, 2, 2.5 or 5 times a power of ten
function niceStep(span, target) {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return p * (m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10);
}
const fmt = (v, step) => {
  const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return (Math.abs(v) < step / 1e6 ? 0 : v).toFixed(Math.min(d + (step * 10 ** d % 1 ? 1 : 0), 8)).replace('-', '−');
};

// -> SVG text. data: one item per curve, in the order of plot.curves:
//   { x: [...], y: [... or null] }   a curve
//   { paths: [{ x, y }] }            several curves in the curve's colour (conformal, ODE)
//   { segs: [x1, y1, x2, y2, ...] }  separate line pieces (implicit)
//   { arrows: [[x, y, dx, dy]], cell: [dx, dy] }  a field; the longest arrow is 0.9 cell long
//   { cells: [[x0, y0, x1, y1]], window }        filled boxes (inequality), on fill2
//   { boxes: [[x0, x1, height]] or polys: [[[x, y], ...]] } approximating boxes, filled
// w, h in CSS px
export function plotSVG(plot, data, w, h) {
  const pad = 4;
  const kind = plotKind(plot);
  // log scales: the plot is drawn in log10 of the values, the labels are powers of ten
  const lx = kind === 'loglog';
  const ly = kind === 'log' || kind === 'loglog';
  const tx = (v) => (v == null ? null : lx ? (v > 0 ? Math.log10(v) : null) : v);
  const ty = (v) => (v == null ? null : ly ? (v > 0 ? Math.log10(v) : null) : v);
  const curves = [];
  for (const d of data) {
    if (d.x) curves.push({ x: d.x.map(tx), y: d.y.map(ty) });
    for (const q of d.paths || []) curves.push(q);
  }
  // the window: set by hand; the ranges of a grid; the curves' ranges; or the points
  const grid = ['implicit', 'inequality', 'vector', 'gradient'].includes(kind);
  const fromPoints = !['rect', 'log', 'loglog', 'approx'].includes(kind) && !grid;
  let [x0, x1] = plot.view.x ? plot.view.x.map(tx)
    : grid ? [Math.min(...plot.curves.map((c) => c.range[0])), Math.max(...plot.curves.map((c) => c.range[1]))]
      : fromPoints ? [Infinity, -Infinity] : [tx(Math.min(...plot.curves.map((c) => c.range[0]))), tx(Math.max(...plot.curves.map((c) => c.range[1])))];
  if (lx && !(x0 < x1)) [x0, x1] = [Math.log10(Math.max(1e-6, plot.curves[0].range[1] / 1000)), Math.log10(Math.max(1e-6, plot.curves[0].range[1]))];
  if (fromPoints && !plot.view.x) {
    for (const d of curves) for (let i = 0; i < d.x.length; i++) if (d.y[i] != null && d.x[i] != null) { x0 = Math.min(x0, d.x[i]); x1 = Math.max(x1, d.x[i]); }
    if (!(x0 < x1)) { x0 = (Number.isFinite(x0) ? x0 : 0) - 1; x1 = x0 + 2; }
  }
  let [y0, y1] = plot.view.y ? plot.view.y.map(ty) : grid ? [Math.min(...plot.curves.map((c) => c.range2[0])), Math.max(...plot.curves.map((c) => c.range2[1]))] : [Infinity, -Infinity];
  if (!plot.view.y && !grid) {
    for (const d of curves) for (let i = 0; i < d.x.length; i++) if (d.y[i] != null && d.x[i] != null && d.x[i] >= x0 && d.x[i] <= x1) { y0 = Math.min(y0, d.y[i]); y1 = Math.max(y1, d.y[i]); }
    for (const d of data) for (const b of d.boxes || []) { y0 = Math.min(y0, 0, b[2]); y1 = Math.max(y1, 0, b[2]); }
    if (!(y0 < y1)) { y0 = (Number.isFinite(y0) ? y0 : 0) - 1; y1 = y0 + 2; }
  }
  if (!(x0 < x1)) { x0 -= 1; x1 += 1; }
  if (plot.constrained) { // one unit is as long on both axes (a circle looks round)
    const per = Math.max((x1 - x0) / (w - 20), (y1 - y0) / (h - 30));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    [x0, x1] = [cx - (per * (w - 20)) / 2, cx + (per * (w - 20)) / 2];
    [y0, y1] = [cy - (per * (h - 30)) / 2, cy + (per * (h - 30)) / 2];
  }
  const font = 11;
  const left = pad + 6;
  const right = w - pad - 6;
  const top = pad + 6;
  const bottom = h - pad - font - 4;
  const X = (v) => left + ((v - x0) / (x1 - x0)) * (right - left);
  const Y = (v) => bottom - ((v - y0) / (y1 - y0)) * (bottom - top);
  const r = (v) => Math.round(v * 100) / 100;
  const parts = [];
  // axes: through the origin when it is in view (axesstyle "normal"), a box when "boxed"/"frame"
  // (on a log scale the axis is at the window's edge)
  const ax = !lx && x0 <= 0 && 0 <= x1 ? X(0) : left;
  const ay = !ly && y0 <= 0 && 0 <= y1 ? Y(0) : bottom;
  // ticks: on a log scale at whole powers of ten when the window spans one or more
  const step = (span, target, log) => (log && span >= 1 ? Math.max(1, Math.round(niceStep(span, target))) : niceStep(span, target));
  const sx = step(x1 - x0, Math.max(2, (right - left) / 70), lx);
  const sy = step(y1 - y0, Math.max(2, (bottom - top) / 40), ly);
  const label = (v, st, log) => (!log ? fmt(v, st) : st >= 1 ? `10<tspan dy="-4" font-size="8">${fmt(v, st)}</tspan>` : String(+(10 ** v).toPrecision(3)));
  if (plot.axes !== 'none') {
    const boxed = /box|frame/i.test(plot.axes);
    const xAxisY = boxed ? bottom : ay;
    const yAxisX = boxed ? left : ax;
    if (boxed) parts.push(`<rect x="${r(left)}" y="${r(top)}" width="${r(right - left)}" height="${r(bottom - top)}" fill="none" stroke="#000" stroke-width="0.8"/>`);
    else parts.push(`<path d="M${r(left)} ${r(xAxisY)}H${r(right)}M${r(yAxisX)} ${r(top)}V${r(bottom)}" stroke="#000" stroke-width="0.8"/>`);
    for (let v = Math.ceil(x0 / sx) * sx; v <= x1 + sx * 1e-9; v += sx) {
      if (Math.abs(v) < sx / 1e6 && !boxed && !lx && x0 < 0) continue; // the origin is not labelled twice
      const px = X(v);
      parts.push(`<path d="M${r(px)} ${r(xAxisY)}v3" stroke="#000" stroke-width="0.8"/><text x="${r(px)}" y="${r(Math.min(xAxisY + 3 + font, h - 2))}" text-anchor="middle">${label(v, sx, lx)}</text>`);
    }
    for (let v = Math.ceil(y0 / sy) * sy; v <= y1 + sy * 1e-9; v += sy) {
      if (Math.abs(v) < sy / 1e6 && !boxed && !ly) continue;
      const py = Y(v);
      parts.push(`<path d="M${r(yAxisX)} ${r(py)}h-3" stroke="#000" stroke-width="0.8"/><text x="${r(yAxisX - 5)}" y="${r(py + font * 0.35)}" text-anchor="end">${label(v, sy, ly)}</text>`);
    }
  }
  const far = (px, py) => Math.abs(px) > 1e5 || Math.abs(py) > 1e5;
  const line = (d) => {
    let path = '';
    let pen = false;
    for (let i = 0; i < d.x.length; i++) {
      const y = d.y[i];
      if (y == null || d.x[i] == null || far(X(d.x[i]), Y(y))) { pen = false; continue; }
      path += `${pen ? 'L' : 'M'}${r(X(d.x[i]))} ${r(Y(y))}`;
      pen = true;
    }
    return path;
  };
  const stroke = (c) => `fill="none" stroke="${c.color}" stroke-width="${c.width}"${c.dash ? ` stroke-dasharray="${c.dash}"` : ''} stroke-linejoin="round"`;
  const fills = [];
  const lines = data.map((d, k) => {
    const c = plot.curves[k];
    let out = '';
    if (d.cells) {
      if (c.fill2 && c.fill2 !== '#ffffff') fills.push(`<rect x="${r(left)}" y="${r(top)}" width="${r(right - left)}" height="${r(bottom - top)}" fill="${c.fill2}"/>`);
      const p = d.cells.map(([a, b, cc, dd]) => `M${r(X(a))} ${r(Y(b))}H${r(X(cc))}V${r(Y(dd))}H${r(X(a))}Z`).join('');
      if (p) fills.push(`<path d="${p}" fill="${c.fill || '#ffcd99'}"/>`);
    }
    if (d.boxes || d.polys) {
      const polys = d.polys || d.boxes.map(([a, b, v]) => [[a, 0], [a, v], [b, v], [b, 0]]);
      const p = polys.map((q) => 'M' + q.map(([u, v]) => `${r(X(u))} ${r(Y(v))}`).join('L') + 'Z').join('');
      fills.push(`<path d="${p}" fill="${c.fill || '#ffcd99'}" stroke="#000" stroke-width="0.5"/>`);
    }
    if (d.x) { const p = line({ x: d.x.map(tx), y: d.y.map(ty) }); if (p) out += `<path d="${p}" ${stroke(c)}/>`; }
    for (const q of d.paths || []) { const p = line(q); if (p) out += `<path d="${p}" ${stroke({ ...c, color: q.color || c.color })}/>`; }
    if (d.segs?.length) {
      let p = '';
      for (let i = 0; i + 3 < d.segs.length; i += 4) p += `M${r(X(d.segs[i]))} ${r(Y(d.segs[i + 1]))}L${r(X(d.segs[i + 2]))} ${r(Y(d.segs[i + 3]))}`;
      out += `<path d="${p}" ${stroke(c)}/>`;
    }
    if (d.arrows?.length) {
      // the arrows keep their directions and relative lengths; the longest is 0.9 of a grid cell
      const kx = (right - left) / (x1 - x0);
      const ky = (bottom - top) / (y1 - y0);
      const long = Math.max(...d.arrows.map(([, , u, v]) => Math.hypot(u * kx, v * ky)), 1e-12);
      const f = (0.9 * Math.min(d.cell[0] * kx, d.cell[1] * ky)) / long;
      let p = '';
      for (const [a, b, u, v] of d.arrows) {
        const px = X(a); const py = Y(b);
        const qx = px + u * kx * f; const qy = py - v * ky * f;
        const len = Math.hypot(qx - px, qy - py);
        if (!(len > 0.3)) continue;
        const hx = ((qx - px) / len) * Math.min(4, len * 0.4); const hy = ((qy - py) / len) * Math.min(4, len * 0.4);
        p += `M${r(px)} ${r(py)}L${r(qx)} ${r(qy)}M${r(qx - hx - hy * 0.5)} ${r(qy - hy + hx * 0.5)}L${r(qx)} ${r(qy)}L${r(qx - hx + hy * 0.5)} ${r(qy - hy - hx * 0.5)}`;
      }
      out += `<path d="${p}" fill="none" stroke="${c.color}" stroke-width="${c.width}"/>`;
    }
    return out;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Times New Roman, Times, serif" font-size="${font}">`
    // no background: a frame 5.x draws round the plot (flag X) stays visible
    + `<defs><clipPath id="c"><rect x="${r(left)}" y="${r(top)}" width="${r(right - left)}" height="${r(bottom - top)}"/></clipPath></defs>`
    + `<g clip-path="url(#c)">${fills.join('')}</g>` + parts.join('') + `<g clip-path="url(#c)">${lines.join('')}</g></svg>`;
}

// 3D plot -> SVG text: shaded patches drawn back to front, and arrows, seen from turn/tilt
// (5.5's defaults 45 and 45 when the plot has none). items, one per curve:
//   { x: [...], y: [...], z: [[...]] }  z = f(x, y) on a grid (z[i][j] at x[i], y[j])
//   { mesh: [[[x, y, z] or null]] }      a surface as a grid of points (parametric, cylindrical ...)
//   { tris: [[p, p, p]] }                triangles (implicit)
//   { arrows: [[p, v]], cell }           a field: arrows from p along v; the longest is 0.9 cell long
//   { box: [[x0, x1], [y0, y1], [z0, z1]] } the window (fields, implicit), when the points do not set it

// every patch of a 3D plot's items as its corner points
function patches(items) {
  const polys = [];
  for (const g of items) {
    if (g.z) {
      for (let i = 0; i + 1 < g.x.length; i++) {
        for (let j = 0; j + 1 < g.y.length; j++) {
          const zs = [g.z[i][j], g.z[i + 1][j], g.z[i + 1][j + 1], g.z[i][j + 1]];
          if (zs.some((z) => z == null)) continue;
          polys.push([[g.x[i], g.y[j], zs[0]], [g.x[i + 1], g.y[j], zs[1]], [g.x[i + 1], g.y[j + 1], zs[2]], [g.x[i], g.y[j + 1], zs[3]]]);
        }
      }
    }
    for (let i = 0; g.mesh && i + 1 < g.mesh.length; i++) {
      for (let j = 0; j + 1 < g.mesh[i].length; j++) {
        const q = [g.mesh[i][j], g.mesh[i + 1][j], g.mesh[i + 1][j + 1], g.mesh[i][j + 1]];
        if (q.every(Boolean)) polys.push(q);
      }
    }
    for (const t of g.tris || []) polys.push(t);
  }
  return polys;
}

// the box round a 3D plot's items
export function bounds3D(items, polys = patches(items)) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const grow = (p) => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } };
  for (const q of polys) q.forEach(grow);
  for (const g of items) {
    if (g.box) { grow(g.box.map((b) => b[0])); grow(g.box.map((b) => b[1])); }
    for (const [p] of g.arrows || []) grow(p);
  }
  return [lo, hi];
}

export function plotSVG3D(plot, items, w, h) {
  const deg = Math.PI / 180;
  const turn = (plot.turn ?? 45) * deg;
  const tilt = (plot.tilt ?? 45) * deg;
  const polys = patches(items);
  const [lo, hi] = bounds3D(items, polys);
  for (let k = 0; k < 3; k++) if (!(lo[k] < hi[k])) { lo[k] = (Number.isFinite(lo[k]) ? lo[k] : 0) - 1; hi[k] = lo[k] + 2; }
  // each axis scaled to [-1, 1] (the box 5.5 draws is a cube), or all by the same factor when constrained
  const span = hi.map((v, k) => v - lo[k]);
  const big = Math.max(...span);
  const mid = hi.map((v, k) => (v + lo[k]) / 2);
  const U = (p) => p.map((v, k) => ((v - mid[k]) * 2) / (plot.constrained ? big : span[k]));
  const e1 = [-Math.sin(turn), Math.cos(turn), 0];
  const e2 = [-Math.cos(turn) * Math.cos(tilt), -Math.sin(turn) * Math.cos(tilt), Math.sin(tilt)];
  const dv = [Math.cos(turn) * Math.sin(tilt), Math.sin(turn) * Math.sin(tilt), Math.cos(tilt)];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const s = Math.min(w, h) / 4.3;
  const P = (p) => [w / 2 + s * dot(p, e1), h / 2 + 6 - s * dot(p, e2)];
  const r = (v) => Math.round(v * 100) / 100;
  const pt = (p) => P(p).map(r).join(' ');
  // color from the lowest (red) to the highest (blue) z, like surfaceColor "[linear:..:red:blue]"
  const shade = (t) => `hsl(${Math.round(240 * Math.min(1, Math.max(0, t)))},75%,55%)`;
  const drawn = [];
  for (const q of polys) {
    const c = q.map(U);
    const depth = c.reduce((a, p) => a + dot(p, dv), 0) / c.length;
    const t = (q.reduce((a, p) => a + p[2], 0) / q.length - lo[2]) / span[2];
    drawn.push([depth, `<path d="M${c.map(pt).join('L')}Z" fill="${shade(t)}" stroke="#000" stroke-opacity="0.35" stroke-width="0.4"/>`]);
  }
  for (const g of items) {
    if (!g.arrows?.length) continue;
    const scale = (v) => v.map((x, k) => (x * 2) / (plot.constrained ? big : span[k]));
    const long = Math.max(...g.arrows.map(([, v]) => Math.hypot(...scale(v))), 1e-12);
    const cell = Math.min(...g.cell.map((x, k) => (x * 2) / (plot.constrained ? big : span[k])));
    const f = (0.9 * cell) / long;
    for (const [p, v] of g.arrows) {
      const a = U(p);
      const b = a.map((x, k) => x + scale(v)[k] * f);
      const [ax, ay] = P(a); const [bx, by] = P(b);
      const len = Math.hypot(bx - ax, by - ay);
      if (!(len > 0.3)) continue;
      const hx = ((bx - ax) / len) * Math.min(4, len * 0.4); const hy = ((by - ay) / len) * Math.min(4, len * 0.4);
      const t = Math.hypot(...scale(v)) / long; // longer arrows bluer
      drawn.push([(dot(a, dv) + dot(b, dv)) / 2, `<path d="M${r(ax)} ${r(ay)}L${r(bx)} ${r(by)}M${r(bx - hx - hy * 0.5)} ${r(by - hy + hx * 0.5)}L${r(bx)} ${r(by)}L${r(bx - hx + hy * 0.5)} ${r(by - hy - hx * 0.5)}" fill="none" stroke="${shade(t)}" stroke-width="1"/>`]);
    }
  }
  drawn.sort((a, b) => a[0] - b[0]);
  const parts = [];
  const corner = (a, b, c) => [a, b, c];
  if (/box|frame/i.test(plot.axes)) {
    const edges = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) edges.push([corner(-1, a, b), corner(1, a, b)], [corner(a, -1, b), corner(a, 1, b)], [corner(a, b, -1), corner(a, b, 1)]);
    parts.push(`<path d="${edges.map(([p, q]) => `M${pt(p)}L${pt(q)}`).join('')}" stroke="#000" stroke-width="0.6" fill="none"/>`);
  }
  if (plot.axes !== 'none') { // three axes from the low corner, with their names and ranges
    const fmt3 = (v) => String(Math.round(v * 100) / 100).replace('-', '−');
    const ends = U(hi).map((v) => v * 1.25);
    const base = U(lo);
    const names = ['x', 'y', 'z'];
    if (plotKind(plot) === 'surface' || plotKind(plot) === 'rect') { names[0] = plot.variable || 'x'; names[1] = plot.variable2 || 'y'; }
    const axes = [[[ends[0], base[1], base[2]], names[0], lo[0], hi[0]], [[base[0], ends[1], base[2]], names[1], lo[1], hi[1]], [[base[0], base[1], ends[2]], names[2], lo[2], hi[2]]];
    for (const [end, name, a, b] of axes) {
      const [ex, ey] = P(end);
      parts.push(`<path d="M${pt(base)}L${r(ex)} ${r(ey)}" stroke="#000" stroke-width="0.8"/>`
        + `<text x="${r(ex)}" y="${r(ey - 3)}" text-anchor="middle" font-style="italic">${name}</text>`
        + `<text x="${r(ex)}" y="${r(ey + 11)}" text-anchor="middle" font-size="9">${fmt3(a)}…${fmt3(b)}</text>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Times New Roman, Times, serif" font-size="11">`
    + drawn.map((q) => q[1]).join('') + parts.join('') + '</svg>';
}

// The frames of an animated plot drawn in one window (the one that holds every frame), so the
// axes stay still while it plays, as in 5.5: frames [{ value, data }] -> [[plot, data]]
export function steadyFrames(plot, frames) {
  const kind = plotKind(plot);
  if (is3D(kind)) {
    const all = frames.flatMap((f) => f.data);
    const [lo, hi] = bounds3D(all);
    if (!lo.every(Number.isFinite) || !hi.every(Number.isFinite)) return frames.map((f) => [plot, f.data]);
    const box = { box: [0, 1, 2].map((k) => [lo[k], hi[k]]) };
    return frames.map((f) => [plot, [...f.data, box]]);
  }
  if (['implicit', 'inequality', 'vector', 'gradient', 'log', 'loglog'].includes(kind)) return frames.map((f) => [plot, f.data]); // the ranges are the window (log: as drawn)
  const fromPoints = !['rect', 'log', 'loglog', 'approx'].includes(kind);
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  const xr = plot.view.x || (fromPoints ? null : [Math.min(...plot.curves.map((c) => c.range[0])), Math.max(...plot.curves.map((c) => c.range[1]))]);
  for (const f of frames) {
    for (const d of f.data) {
      for (const q of [d, ...(d.paths || [])]) {
        if (!q.x) continue;
        for (let i = 0; i < q.x.length; i++) {
          const x = q.x[i];
          const y = q.y[i];
          if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
          if (xr && (x < xr[0] || x > xr[1])) continue;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
      }
      for (const b of d.boxes || []) { y0 = Math.min(y0, 0, b[2]); y1 = Math.max(y1, 0, b[2]); }
      for (const p of d.polys || []) for (const [, y] of p) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
  }
  if (!(y0 < y1)) return frames.map((f) => [plot, f.data]);
  const view = { x: plot.view.x || (fromPoints && x0 < x1 ? [x0, x1] : null), y: plot.view.y || [y0, y1] };
  const fixed = { ...plot, view };
  return frames.map((f) => [fixed, f.data]);
}

// how many frames an animated plot is drawn with: 5.5 shows (end - start) x frames per second;
// opensw draws at most this many and shows each a little longer (a frame of a surface takes the
// computation engine much longer than a frame of a curve)
export function animFrames(plot) {
  const kind = plotKind(plot);
  const a = plot.anim;
  const want = Math.round((a.end - a.start) * a.fps) + 1;
  const most = is3D(kind) ? 21 : ['implicit', 'inequality', 'vector', 'gradient', 'conformal'].includes(kind) ? 26 : 51;
  return Math.max(2, Math.min(want, most));
}
