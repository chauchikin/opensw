// The points of a plot, for plots.js to draw: the values come from the computation engine
// (compute.js), the shapes (contour lines, surfaces, arrows ...) are made here.
import { plotPoints, plotGrid, plotValues, odePoints, nameOf } from './compute.js';
import { plotKind, components, splitRelation } from './plots.js';
import { odeRows } from './mathjson.js';
import { _t } from './i18n.js';

const cap = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(n)));
const PALETTE = ['#ff0000', '#0000ff', '#008000', '#ff00ff', '#808080', '#000000'];

// -> one item per curve, as plotSVG / plotSVG3D take them
export async function plotData(plot) {
  const kind = plotKind(plot);
  const out = [];
  for (const c of plot.curves) out.push(await curveData(kind, plot, c));
  return out;
}

// F = lhs - rhs of "lhs = rhs" (or of an inequality), and the relation
function difference(latex) {
  const s = splitRelation(latex);
  return { f: `\\left(${s.lhs}\\right)-\\left(${s.rhs}\\right)`, rel: s.rel };
}

// the grid's values as rows: v[i][j] at axes[0][i], axes[1][j] (the engine gives them flat)
const rows = (flat, n, m) => Array.from({ length: n }, (_, i) => flat.slice(i * m, (i + 1) * m));

async function curveData(kind, plot, c) {
  const v1 = c.variable || plot.variable || 'x';
  const v2 = plot.variable2 || 'y';
  const v3 = plot.variable3 || 'z';
  const at = (latex) => plotPoints(latex, v1, c.range[0], c.range[1], c.n, c.subs);
  const parts = components(c.latex);
  switch (kind) {
    case 'rect': case 'log': case 'loglog': return at(c.latex);
    case 'polar': case 'param': {
      const [f, g] = parts;
      const one = await at(f);
      const two = g == null ? { y: one.x } : await at(g); // polar without an angle: the angle is the variable
      const ok = (i) => one.y[i] != null && two.y[i] != null;
      if (kind === 'param') return { x: one.x.map((_, i) => (ok(i) ? one.y[i] : null)), y: one.x.map((_, i) => (ok(i) ? two.y[i] : null)) };
      return { x: one.x.map((_, i) => (ok(i) ? one.y[i] * Math.cos(two.y[i]) : null)), y: one.x.map((_, i) => (ok(i) ? one.y[i] * Math.sin(two.y[i]) : null)) };
    }
    case 'approx': return approxBoxes(c, v1, await at(c.latex));
    case 'implicit': {
      const { f } = difference(c.latex);
      const n = cap(Math.max(c.grid[0] || 0, 80), 20, 120);
      const r = await plotValues([f], [v1, v2], [c.range, c.range2], [n, n], { subs: c.subs });
      return { segs: contour(r.axes, rows(r.values[0], n + 1, n + 1)) };
    }
    case 'inequality': {
      const { f, rel } = difference(c.latex);
      const n = cap(c.grid[0] || 120, 20, 120);
      const r = await plotValues([f], [v1, v2], [c.range, c.range2], [n, n], { subs: c.subs });
      const holds = (v) => v != null && (rel === '<' ? v < 0 : rel === '<=' ? v <= 0 : rel === '>' ? v > 0 : v >= 0);
      return { cells: region(r.axes, rows(r.values[0], n + 1, n + 1), holds, c.range, c.range2) };
    }
    case 'vector': case 'gradient': {
      const n = cap(c.grid[0] || (kind === 'vector' ? 20 : 10), 2, 40);
      const r = await plotValues(kind === 'vector' ? parts : [c.latex], [v1, v2], [c.range, c.range2], [n - 1, n - 1], { subs: c.subs, grad: kind === 'gradient' });
      const arrows = [];
      r.axes[0].forEach((x, i) => r.axes[1].forEach((y, j) => {
        const k = i * n + j;
        if (r.values[0][k] != null && r.values[1][k] != null) arrows.push([x, y, r.values[0][k], r.values[1][k]]);
      }));
      return { arrows, cell: [(c.range[1] - c.range[0]) / (n - 1), (c.range2[1] - c.range2[0]) / (n - 1)] };
    }
    case 'conformal': {
      // the grid lines of the rectangle Re z in range, Im z in range2, carried by w = f(z)
      const [re, im] = /^[xy]$/.test(v1) ? ['u', 'v'] : ['x', 'y'];
      const lines = cap(c.grid[0] || 11, 2, 40);
      const pts = 40;
      const paths = [];
      const across = await plotValues([c.latex], [re, im], [c.range, c.range2], [lines - 1, pts - 1], { subs: c.subs, complex: v1 });
      for (let i = 0; i < lines; i++) paths.push({ x: across.values[0].slice(i * pts, (i + 1) * pts), y: across.values[1].slice(i * pts, (i + 1) * pts) });
      const along = await plotValues([c.latex], [re, im], [c.range, c.range2], [pts - 1, lines - 1], { subs: c.subs, complex: v1 });
      for (let j = 0; j < lines; j++) {
        const idx = Array.from({ length: pts }, (_, i) => i * lines + j);
        paths.push({ x: idx.map((k) => along.values[0][k]), y: idx.map((k) => along.values[1][k]) });
      }
      return { paths };
    }
    case 'ode': {
      const { equations, inits } = odeRows(c.latex);
      const r = await odePoints(equations, inits, c.range[0], c.range[1], c.n);
      return { paths: Object.keys(r.y).sort().map((name, k) => ({ x: r.x, y: r.y[name], color: k ? PALETTE[k % PALETTE.length] : null })) };
    }
    case 'surface': {
      if (parts.length === 1) return plotGrid(c.latex, [plot.variable, plot.variable2], c.range, c.range2, 24, 24, c.subs);
      return { mesh: await mesh(parts, [v1, v2], c, (p) => p) };
    }
    case 'cylindrical': case 'spherical': {
      // r = f(θ, z), or (r, θ, z) in the two variables; spherical ρ = f(θ, φ), or (ρ, θ, φ)
      const three = parts.length === 3 ? parts : [parts[0], v1, v2];
      const to = kind === 'cylindrical'
        ? ([r, t, z]) => [r * Math.cos(t), r * Math.sin(t), z]
        : ([r, t, f]) => [r * Math.sin(f) * Math.cos(t), r * Math.sin(f) * Math.sin(t), r * Math.cos(f)];
      return { mesh: await mesh(three, [v1, v2], c, to) };
    }
    case 'tube': return { mesh: await tube(parts, c.radius || '0.2', v1, c) };
    case 'implicit3': {
      const { f } = difference(c.latex);
      const n = cap(Math.max(c.grid[0] || 0, 16), 4, 22);
      const r = await plotValues([f], [v1, v2, v3], [c.range, c.range2, c.range3], [n, n, n], { subs: c.subs });
      return { tris: marchingTetrahedra(r.axes, r.values[0]), box: [c.range, c.range2, c.range3] };
    }
    case 'vector3': case 'gradient3': {
      const n = cap(c.grid[0] || 6, 2, 10);
      const r = await plotValues(kind === 'vector3' ? parts : [c.latex], [v1, v2, v3], [c.range, c.range2, c.range3], [n - 1, n - 1, n - 1], { subs: c.subs, grad: kind === 'gradient3' });
      const arrows = [];
      let k = 0;
      for (const x of r.axes[0]) {
        for (const y of r.axes[1]) {
          for (const z of r.axes[2]) {
            const v = r.values.map((a) => a[k]);
            if (v.every((u) => u != null)) arrows.push([[x, y, z], v]);
            k++;
          }
        }
      }
      return { arrows, cell: [c.range, c.range2, c.range3].map(([a, b]) => (b - a) / (n - 1)), box: [c.range, c.range2, c.range3] };
    }
    default: throw new Error(_t('This kind of plot cannot be drawn yet'));
  }
}

// Plot Approximate Integral: the curve and the boxes (5.5's approxIntBoxType: left, right,
// midpoint, upper, lower; trapezoid)
async function approxBoxes(c, v1, curve) {
  const n = cap(c.boxes || 10, 1, 200);
  const k = 8;
  const s = await plotPoints(c.latex, v1, c.range[0], c.range[1], n * k, c.subs);
  const type = String(c.boxType || 'left').toLowerCase();
  const boxes = [];
  const polys = [];
  for (let i = 0; i < n; i++) {
    const ys = s.y.slice(i * k, (i + 1) * k + 1);
    if (ys.some((y) => y == null)) continue;
    const a = s.x[i * k];
    const b = s.x[(i + 1) * k];
    if (type.startsWith('trap')) { polys.push([[a, 0], [a, ys[0]], [b, ys[k]], [b, 0]]); continue; }
    const h = type.startsWith('right') ? ys[k] : type.startsWith('mid') ? ys[k / 2] : type.startsWith('upper') ? Math.max(...ys)
      : type.startsWith('lower') ? Math.min(...ys) : ys[0];
    boxes.push([a, b, h]);
  }
  return type.startsWith('trap') ? { ...curve, polys } : { ...curve, boxes };
}

// contour F = 0 on a grid (marching squares) -> [x1, y1, x2, y2, ...]
function contour([xs, ys], F) {
  const segs = [];
  const cut = (xa, ya, fa, xb, yb, fb) => { const t = fa / (fa - fb); return [xa + t * (xb - xa), ya + t * (yb - ya)]; };
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const c = [[xs[i], ys[j], F[i][j]], [xs[i + 1], ys[j], F[i + 1][j]], [xs[i + 1], ys[j + 1], F[i + 1][j + 1]], [xs[i], ys[j + 1], F[i][j + 1]]];
      if (c.some((p) => p[2] == null)) continue;
      const pts = [];
      for (let e = 0; e < 4; e++) {
        const [xa, ya, fa] = c[e];
        const [xb, yb, fb] = c[(e + 1) % 4];
        if ((fa > 0) !== (fb > 0)) pts.push(cut(xa, ya, fa, xb, yb, fb));
      }
      if (pts.length >= 2) segs.push(...pts[0], ...pts[1]);
      if (pts.length === 4) segs.push(...pts[2], ...pts[3]);
    }
  }
  return segs;
}

// where the inequality holds, as boxes round the grid points (joined along each column)
function region([xs, ys], F, holds, [xa, xb], [ya, yb]) {
  const hx = (xs[1] - xs[0]) / 2;
  const hy = (ys[1] - ys[0]) / 2;
  const cells = [];
  for (let i = 0; i < xs.length; i++) {
    let start = null;
    for (let j = 0; j <= ys.length; j++) {
      const on = j < ys.length && holds(F[i][j]);
      if (on && start == null) start = j;
      if (!on && start != null) {
        cells.push([Math.max(xa, xs[i] - hx), Math.max(ya, ys[start] - hy), Math.min(xb, xs[i] + hx), Math.min(yb, ys[j - 1] + hy)]);
        start = null;
      }
    }
  }
  return cells;
}

// a surface given by three formulas in two variables -> grid of points (to: the coordinate system)
async function mesh(three, vars, c, to) {
  const n = cap(c.grid[0] || 25, 4, 40) - 1;
  const m = cap(c.grid[1] || 25, 4, 40) - 1;
  const r = await plotValues(three, vars, [c.range, c.range2], [n, m], { subs: c.subs });
  return Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => {
    const p = r.values.map((a) => a[i * (m + 1) + j]);
    return p.every((v) => v != null) ? to(p) : null;
  }));
}

// Plot 3D > Tube: a tube of the radius round the curve (x(t), y(t), z(t))
async function tube(three, radius, v, c) {
  const n = cap(c.grid[0] || 50, 8, 120);
  const around = cap(c.grid[1] || 8, 6, 24);
  const r = await plotValues([...three, radius], [v], [c.range], [n], { subs: c.subs });
  const C = r.axes[0].map((_, i) => [r.values[0][i], r.values[1][i], r.values[2][i]]);
  const R = r.values[3];
  const sub = (a, b) => a.map((x, k) => x - b[k]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const l = Math.hypot(...a); return l > 1e-12 ? a.map((x) => x / l) : null; };
  const ok = (p) => p.every((x) => x != null);
  let N = null;
  return C.map((p, i) => {
    if (!ok(p) || R[i] == null) { N = null; return Array(around + 1).fill(null); }
    const q = C[Math.min(i + 1, C.length - 1)];
    const o = C[Math.max(i - 1, 0)];
    const T = unit(sub(ok(q) ? q : p, ok(o) ? o : p));
    if (!T) return Array(around + 1).fill(null);
    // the ring's directions follow the curve without twisting
    N = N && unit(sub(N, T.map((x) => x * (N[0] * T[0] + N[1] * T[1] + N[2] * T[2]))));
    if (!N) { const ax = Math.abs(T[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; N = unit(cross(T, ax)); }
    const B = cross(T, N);
    return Array.from({ length: around + 1 }, (_, j) => {
      const a = (2 * Math.PI * j) / around;
      return p.map((x, k) => x + R[i] * (Math.cos(a) * N[k] + Math.sin(a) * B[k]));
    });
  });
}

// F = 0 on a 3D grid (flat, the last axis fastest) -> triangles (marching tetrahedra)
function marchingTetrahedra([xs, ys, zs], F) {
  const nx = xs.length; const ny = ys.length; const nz = zs.length;
  const val = (i, j, k) => F[(i * ny + j) * nz + k];
  const corners = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const tets = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];
  const tris = [];
  for (let i = 0; i + 1 < nx; i++) {
    for (let j = 0; j + 1 < ny; j++) {
      for (let k = 0; k + 1 < nz; k++) {
        const P = corners.map(([a, b, c]) => [xs[i + a], ys[j + b], zs[k + c], val(i + a, j + b, k + c)]);
        if (P.some((p) => p[3] == null)) continue;
        for (const t of tets) {
          const q = t.map((n) => P[n]);
          const inside = q.filter((p) => p[3] > 0);
          const outside = q.filter((p) => !(p[3] > 0));
          if (!inside.length || !outside.length) continue;
          const cut = (a, b) => { const s = a[3] / (a[3] - b[3]); return [0, 1, 2].map((m) => a[m] + s * (b[m] - a[m])); };
          if (inside.length === 1 || outside.length === 1) {
            const [lone, others] = inside.length === 1 ? [inside[0], outside] : [outside[0], inside];
            tris.push(others.map((o) => cut(lone, o)));
          } else {
            const [a, b] = inside;
            const [c, d] = outside;
            const ac = cut(a, c); const ad = cut(a, d); const bd = cut(b, d); const bc = cut(b, c);
            tris.push([ac, ad, bd], [ac, bd, bc]);
          }
        }
      }
    }
  }
  return tris;
}


// An animated plot (5.5's Plot 2D/3D Animated): the plot at each frame's value of the animation
// parameter (plots.js animFrames says how many), put in for the parameter's symbol after the
// formula is read, so \sin tx stays sin(t x) -> [{ value, data }]
export async function plotFrames(plot, count, onFrame) {
  const a = plot.anim;
  const name = await nameOf(a.param, 't');
  const frames = [];
  for (let k = 0; k < count; k++) {
    const value = a.range[0] + ((a.range[1] - a.range[0]) * k) / Math.max(1, count - 1);
    const at = { ...plot, curves: plot.curves.map((c) => ({ ...c, subs: { [name]: value } })) };
    frames.push({ value, data: await plotData(at) });
    onFrame?.(k + 1, count);
  }
  return frames;
}
