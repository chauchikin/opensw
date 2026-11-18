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

// the plot's settings: { type, view: {x, y}, axes, curves: [{ latex, variable, range, n, color, width, dash }] }
export function parsePlot(body) {
  const plot = { type: null, plottype: null, view: { x: null, y: null }, range: null, axes: 'normal', variable: 'x', curves: [] };
  const g = {};
  let cur = null;
  for (const [k, v] of specialPairs(body)) {
    if (k === 'function') {
      cur = { latex: v.replace(/\\allowbreak\s*/g, ''), variable: null, range: null, n: null, color: null, width: 1, dash: null, style: 'Line' };
      plot.curves.push(cur);
      continue;
    }
    const target = cur || g;
    target[k] = v;
    if (!cur) continue;
    if (k === 'var1name') cur.variable = v;
    if (k === 'var1range') { const [a, b] = v.split(',').map(num); if (a != null && b != null) cur.range = [a, b]; }
    if (k === 'num-x-gridlines') cur.n = num(v);
    if (k === 'curveColor' || (k === 'linecolor' && !cur.color)) cur.color = colorOf(v) || cur.color;
    if (k === 'linethickness') cur.width = num(v) || 1;
    if (k === 'lineAttributes') cur.dash = /dash/i.test(v) ? '6 4' : /dot/i.test(v) ? '1.5 3' : null;
    if (k === 'curveStyle') cur.style = v;
  }
  plot.type = g.type || null;
  plot.plottype = num(g.plottype);
  plot.axes = g.axesstyle || 'normal';
  plot.variable = g.var1name || 'x';
  const xr = [num(g.xmin), num(g.xmax)];
  if (xr[0] != null && xr[1] != null) plot.range = xr;
  // viewset "XY": the window was set by hand (otherwise the plot program chose it)
  const xv = [num(g.xviewmin), num(g.xviewmax)];
  const yv = [num(g.yviewmin), num(g.yviewmax)];
  if (xv[0] != null && xv[1] != null && xv[0] < xv[1]) plot.view.x = xv;
  if (yv[0] != null && yv[1] != null && yv[0] < yv[1]) plot.view.y = yv;
  for (const c of plot.curves) {
    c.variable = c.variable || plot.variable;
    c.range = c.range || plot.range || plot.view.x || [-5, 5];
    c.n = Math.min(2000, Math.max(20, c.n || num(g.numpoints) || 100));
    c.color = c.color || '#000000';
  }
  return plot;
}

// a 5.x plot \special for these settings (Compute > Plot 2D and the plot's Properties write it)
export function plotSpecial(plot, { width = '3in', height = '2in', path }) {
  const [x0, x1] = plot.view.x || plot.range || [-5, 5];
  const parts = [`language "Scientific Word";type "MAPLEPLOT";width ${width};height ${height};depth 0pt;display "USEDEF";plot_snapshots TRUE;`,
    `xmin "${x0}";xmax "${x1}";xviewmin "${x0}";xviewmax "${x1}";`,
    plot.view.y ? `yviewmin "${plot.view.y[0]}";yviewmax "${plot.view.y[1]}";viewset"XY";` : 'viewset"X";',
    `rangeset"X";plottype 4;axesstyle "${plot.axes || 'normal'}";numpoints 100;var1name \\TEXUX{$${plot.variable || 'x'}$};`];
  for (const c of plot.curves) {
    const hex = (c.color || '#000000').replace('#', '');
    parts.push(`function \\TEXUX{$${c.latex}$};linestyle 1;linethickness ${c.width || 1};lineAttributes "${c.dash ? 'Dash' : 'Solid'}";`
      + `var1range "${(c.range || [x0, x1]).join(',')}";num-x-gridlines ${c.n || 100};curveColor "[flat::RGB:0x00${hex}]";curveStyle "Line";`);
  }
  parts.push(`valid_file "T";tempfilename '${path}';`);
  return `\\special{${parts.join('')}}`;
}

// a plot opensw can draw: two-dimensional, each function y = f(x)
export function drawable(plot) {
  return plot.curves.length > 0 && (plot.plottype == null || plot.plottype === 4)
    && plot.curves.every((c) => !/,/.test(c.latex.replace(/\\[,;:!]/g, '').replace(/\{[^{}]*\}/g, '')) && c.style !== 'Point');
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

// -> SVG text. data: [{ x: [...], y: [... or null] }] in the order of plot.curves; w, h in CSS px
export function plotSVG(plot, data, w, h) {
  const pad = 4;
  let [x0, x1] = plot.view.x || [Math.min(...plot.curves.map((c) => c.range[0])), Math.max(...plot.curves.map((c) => c.range[1]))];
  let [y0, y1] = plot.view.y || [Infinity, -Infinity];
  if (!plot.view.y) {
    for (const d of data) for (let i = 0; i < d.x.length; i++) if (d.y[i] != null && d.x[i] >= x0 && d.x[i] <= x1) { y0 = Math.min(y0, d.y[i]); y1 = Math.max(y1, d.y[i]); }
    if (!(y0 < y1)) { y0 = (Number.isFinite(y0) ? y0 : 0) - 1; y1 = y0 + 2; }
  }
  if (!(x0 < x1)) { x0 -= 1; x1 += 1; }
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
  const ax = x0 <= 0 && 0 <= x1 ? X(0) : left;
  const ay = y0 <= 0 && 0 <= y1 ? Y(0) : bottom;
  const sx = niceStep(x1 - x0, Math.max(2, (right - left) / 70));
  const sy = niceStep(y1 - y0, Math.max(2, (bottom - top) / 40));
  if (plot.axes !== 'none') {
    const boxed = /box|frame/i.test(plot.axes);
    const xAxisY = boxed ? bottom : ay;
    const yAxisX = boxed ? left : ax;
    if (boxed) parts.push(`<rect x="${r(left)}" y="${r(top)}" width="${r(right - left)}" height="${r(bottom - top)}" fill="none" stroke="#000" stroke-width="0.8"/>`);
    else parts.push(`<path d="M${r(left)} ${r(xAxisY)}H${r(right)}M${r(yAxisX)} ${r(top)}V${r(bottom)}" stroke="#000" stroke-width="0.8"/>`);
    for (let v = Math.ceil(x0 / sx) * sx; v <= x1 + sx * 1e-9; v += sx) {
      if (Math.abs(v) < sx / 1e6 && !boxed && x0 < 0) continue; // the origin is not labelled twice
      const px = X(v);
      parts.push(`<path d="M${r(px)} ${r(xAxisY)}v3" stroke="#000" stroke-width="0.8"/><text x="${r(px)}" y="${r(Math.min(xAxisY + 3 + font, h - 2))}" text-anchor="middle">${fmt(v, sx)}</text>`);
    }
    for (let v = Math.ceil(y0 / sy) * sy; v <= y1 + sy * 1e-9; v += sy) {
      if (Math.abs(v) < sy / 1e6 && !boxed) continue;
      const py = Y(v);
      parts.push(`<path d="M${r(yAxisX)} ${r(py)}h-3" stroke="#000" stroke-width="0.8"/><text x="${r(yAxisX - 5)}" y="${r(py + font * 0.35)}" text-anchor="end">${fmt(v, sy)}</text>`);
    }
  }
  // the curves, cut where a function has no value or leaves the window far
  const lines = data.map((d, k) => {
    const c = plot.curves[k];
    let path = '';
    let pen = false;
    for (let i = 0; i < d.x.length; i++) {
      const y = d.y[i];
      if (y == null || Math.abs(Y(y)) > 1e5) { pen = false; continue; }
      path += `${pen ? 'L' : 'M'}${r(X(d.x[i]))} ${r(Y(y))}`;
      pen = true;
    }
    return path ? `<path d="${path}" fill="none" stroke="${c.color}" stroke-width="${c.width}"${c.dash ? ` stroke-dasharray="${c.dash}"` : ''} stroke-linejoin="round"/>` : '';
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Times New Roman, Times, serif" font-size="${font}">`
    // no background: a frame 5.x draws round the plot (flag X) stays visible
    + `<defs><clipPath id="c"><rect x="${r(left)}" y="${r(top)}" width="${r(right - left)}" height="${r(bottom - top)}"/></clipPath></defs>`
    + parts.join('') + `<g clip-path="url(#c)">${lines.join('')}</g></svg>`;
}
