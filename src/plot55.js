// Compute > Settings, the plot pages of 5.5 (sw550ENUS.dll dialogs 6370 Plot Layout, 6379 2D Plots,
// 6380 3D Plots, 6381 Plot Behavior, 6387 Default Plot Intervals and Animation): the defaults a new
// plot (Compute > Plot 2D, Plot 3D, the animated ones) gets. Kept for every document in
// settings().plot55, or, with Set Document Values, for one document in its meta.plot55 (opensw's;
// 5.5 does not write these into the .tex). A page a document set for itself replaces that page.
import { _t } from './i18n.js';
import { settings, saveSettings } from './settings.js';

// interval rows: [variable shown, from, to, points sampled] for each kind of plot, as 5.5's
// "Intervals Plotted and Animation" buttons (2D: Rectangular, Parametric, Implicit, Polar, Vector
// Fields, Conformal, Inequality; 3D: Rectangular, Spherical, Implicit, Cylindrical, Vector Fields, Tube)
export const INTERVAL_KINDS = {
  rect: { label: () => _t('Rectangular'), rows: [['x', -5, 5, 100]] },
  param: { label: () => _t('Parametric'), rows: [['t', 0, 6.2832, 200]] },
  implicit: { label: () => _t('Implicit'), rows: [['x', -5, 5, 24], ['y', -5, 5, 24]] },
  polar: { label: () => _t('Polar'), rows: [['theta', -3.1416, 3.1416, 200]] },
  vector: { label: () => _t('Vector Fields'), rows: [['x', -5, 5, 20], ['y', -5, 5, 20]] },
  conformal: { label: () => _t('Conformal'), rows: [['real', 0, 1, 11], ['imaginary', 0, 1, 11]] },
  inequality: { label: () => _t('Inequality'), rows: [['x', -5, 5, 120], ['y', -5, 5, 120]] },
  surface: { label: () => _t('Rectangular'), three: true, rows: [['x', -5, 5, 25], ['y', -5, 5, 25]] },
  spherical: { label: () => _t('Spherical'), three: true, rows: [['theta', -3.1416, 3.1416, 25], ['phi', 0, 3.1416, 25]] },
  implicit3: { label: () => _t('Implicit'), three: true, rows: [['x', -5, 5, 10], ['y', -5, 5, 10], ['z', -5, 5, 10]] },
  cylindrical: { label: () => _t('Cylindrical'), three: true, rows: [['theta', -3.1416, 3.1416, 25], ['z', -5, 5, 25]] },
  vector3: { label: () => _t('Vector Fields'), three: true, rows: [['x', -5, 5, 6], ['y', -5, 5, 6], ['z', -5, 5, 6]] },
  tube: { label: () => _t('Tube'), three: true, rows: [['t', 0, 6.2832, 50]] },
};
// the plot kinds of the Compute menu -> the kind whose intervals they use
const INTERVALS_OF = { rect: 'rect', ode: 'rect', approx: 'rect', param: 'param', implicit: 'implicit', polar: 'polar', vector: 'vector', gradient: 'vector',
  conformal: 'conformal', inequality: 'inequality', surface: 'surface', spherical: 'spherical', implicit3: 'implicit3', cylindrical: 'cylindrical',
  vector3: 'vector3', gradient3: 'vector3', tube: 'tube' };
const intervalDefaults = () => Object.fromEntries(Object.entries(INTERVAL_KINDS).map(([k, v]) => [k, v.rows.map((r) => r.slice(1))]));

export const PLOT55_DEFAULTS = {
  layout: { width: 3, height: 2, units: 'in', screen: 'frame', print: 'frame', placement: 'display', here: false, floats: true, top: true, bottom: true, offset: 0 },
  p2: { style: 'line', lineStyle: 'solid', thickness: 'thin', marker: 'dot', axes: 'normal', color: '#ff0000', discontinuity: false, adjust: 'always' },
  p3: { lineStyle: 'solid', thickness: 'thin', marker: 'dot', axes: 'boxed', surface: 'Color Patch', mesh: 'Mesh', shading: 'XYZ', base: '#ff0000', secondary: '#0000ff' },
  behavior: { snapshots: true, recompute: true, dialogFirst: false },
  intervals: intervalDefaults(),
  animation: { start: 0, end: 10, fps: 5 },
};
const PAGES = ['layout', 'p2', 'p3', 'behavior', 'intervals', 'animation'];
const copy = (x) => JSON.parse(JSON.stringify(x));
const merged = (page, ...over) => {
  const base = copy(PLOT55_DEFAULTS[page]);
  for (const o of over) if (o) Object.assign(base, copy(o));
  return base;
};
// the plot settings in force for a document (its own pages, else this computer's)
export function plot55For(meta = {}) {
  const mine = settings().plot55 || {};
  const doc = meta.plot55 || {};
  return Object.fromEntries(PAGES.map((p) => [p, merged(p, mine[p], doc[p])]));
}

const THICK = { thin: 1, medium: 2, thick: 3 };
const DASH = { solid: null, dash: '6 4', dot: '1.5 3', dashdot: '6 3 1.5 3' };
// a new plot of this kind made with these settings: ranges and points sampled, colour, line,
// axes, 3D surface, the animation's times (the parts its caller set itself, kept)
export function applyPlot55(plot, kind, s, keep = {}) {
  const rows = s.intervals[INTERVALS_OF[kind]];
  const three = INTERVAL_KINDS[INTERVALS_OF[kind]]?.three;
  for (const c of plot.curves || []) {
    if (rows && !keep.range) {
      const [r1, r2, r3] = rows;
      if (r1) { c.range = [r1[0], r1[1]]; if (kind !== 'tube') c.n = r1[2]; }
      if (r2 && 'range2' in c) c.range2 = [r2[0], r2[1]];
      if (r3 && 'range3' in c) c.range3 = [r3[0], r3[1]];
      // (Gradient has no intervals of its own in 5.5: the Vector Fields ranges, its own grid)
      if (c.grid && kind !== 'gradient' && kind !== 'gradient3') c.grid = c.grid.map((g, i) => (kind === 'tube' ? (i === 0 ? r1[2] : g) : rows[i] ? rows[i][2] : g));
    }
    if (three) Object.assign(c, { surfaceStyle: s.p3.surface, mesh: s.p3.mesh, shading: s.p3.shading, base: s.p3.base, secondary: s.p3.secondary,
      width: THICK[s.p3.thickness] || 1, dash: DASH[s.p3.lineStyle] ?? null });
    else if (kind !== 'inequality' && kind !== 'conformal' && kind !== 'vector' && kind !== 'gradient' && kind !== 'approx') {
      Object.assign(c, { color: s.p2.color, width: THICK[s.p2.thickness] || 1, dash: DASH[s.p2.lineStyle] ?? null, style: s.p2.style === 'point' ? 'Point' : 'Line' });
      if (s.p2.style === 'point') c.marker = s.p2.marker;
    }
    if (!three && s.p2.discontinuity) c.discAdjust = s.p2.adjust === 'always';
  }
  if (rows && !keep.range && plot.range && plot.curves?.[0]?.range) plot.range = [...plot.curves[0].range];
  if (rows && !keep.range && plot.view?.x && kind === 'rect') plot.view.x = [...plot.curves[0].range];
  // the axes when they were changed here (a new plot keeps each kind's own otherwise: boxed for most 3D ones)
  const axes = three ? s.p3.axes : s.p2.axes;
  if (axes !== (three ? PLOT55_DEFAULTS.p3.axes : PLOT55_DEFAULTS.p2.axes)) plot.axes = axes;
  if (plot.anim) Object.assign(plot.anim, { start: s.animation.start, end: s.animation.end, fps: s.animation.fps });
  return plot;
}
// the \FRAME's size and placement for a new plot (Plot Layout)
export function frameOf(s) {
  const l = s.layout;
  const unit = { in: 'in', cm: 'cm', mm: 'mm', pt: 'pt' }[l.units] || 'in';
  const px = { in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72 }[unit];
  const where = (l.here ? 'h' : '') + (l.top ? 't' : '') + (l.bottom ? 'b' : '') + (l.floats ? 'p' : '');
  const flag = { inline: 'i', display: 'd', float: 'f' }[l.placement] || 'd';
  return { texw: `${l.width}${unit}`, texh: `${l.height}${unit}`, width: Math.round(l.width * px), height: Math.round(l.height * px),
    place: l.placement === 'inline' ? 'inline' : l.placement === 'float' ? 'float' : 'display', flags: `${flag}${where || 'tbp'}F${flag === 'd' ? 'X' : ''}`,
    depth: l.placement === 'inline' ? `${l.offset}${unit}` : '0pt' };
}

// ---------- the pages of Compute > Settings ----------
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sel = (id, cur, options) => `<select id="${id}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
const radio = (name, v, cur, label) => `<label><input type="radio" name="${name}" value="${v}"${v === cur ? ' checked' : ''}> ${label}</label>`;
const chk = (id, on, label) => `<label><input type="checkbox" id="${id}"${on ? ' checked' : ''}> ${label}</label>`;
const num = (id, v, size = 5) => `<input id="${id}" size="${size}" value="${esc(v)}">`;
const docOrMine = (name, isDoc) => `<p>${radio(name, 'default', isDoc ? 'doc' : 'default', _t('Use Defaults'))}　${radio(name, 'doc', isDoc ? 'doc' : 'default', _t('Set Document Values'))}</p>`;
const COLORS = () => [['#000000', _t('Black')], ['#ff0000', _t('Red')], ['#008000', _t('Green')], ['#0000ff', _t('Blue')], ['#ff00ff', _t('Magenta')],
  ['#00ffff', _t('Cyan')], ['#ffff00', _t('Yellow')], ['#808080', _t('Gray')], ['#800080', _t('Purple')], ['#ffa500', _t('Orange')]];
const LINE_STYLES = () => [['solid', _t('Solid')], ['dash', _t('Dash')], ['dot', _t('Dot')], ['dashdot', _t('Dash Dot')]];
const THICKNESS = () => [['thin', _t('Thin')], ['medium', _t('Medium')], ['thick', _t('Thick')]];
const MARKERS = () => [['dot', _t('Dot')], ['circle', _t('Circle')], ['cross', _t('Cross')], ['diamond', _t('Diamond')], ['box', _t('Box')]];
const AXES = () => [['normal', _t('Normal')], ['boxed', _t('Boxed')], ['frame', _t('Frame')], ['none', _t('None')]];
const ROW_NAMES = { theta: 'θ', phi: 'φ', real: () => _t('real'), imaginary: () => _t('imaginary') };
const rowName = (v) => (typeof ROW_NAMES[v] === 'function' ? ROW_NAMES[v]() : ROW_NAMES[v] || v);

// -> [[page title, html]] for the settings dialog (meta: the document's)
export function plotPages(meta = {}) {
  const s = plot55For(meta);
  const doc = meta.plot55 || {};
  const l = s.layout;
  const layout = `${docOrMine('p55-layout', !!doc.layout)}
    <p>${_t('Width:')} ${num('p55-w', l.width)}　${_t('Height:')} ${num('p55-h', l.height)}　${_t('Units:')} ${sel('p55-u', l.units, [['in', 'in'], ['cm', 'cm'], ['mm', 'mm'], ['pt', 'pt']])}</p>
    <p>${_t('Screen Display Attributes')}: ${[['frame', _t('Plot in Frame')], ['plot', _t('Plot Only')], ['frameonly', _t('Frame Only')], ['icon', _t('Iconified')]].map(([v, t]) => radio('p55-scr', v, l.screen, t)).join(' ')}</p>
    <p>${_t('Print Attributes')}: ${[['frame', _t('Plot in Frame')], ['plot', _t('Plot Only')], ['frameonly', _t('Frame Only')], ['icon', _t('Iconified')]].map(([v, t]) => radio('p55-prn', v, l.print, t)).join(' ')}</p>
    <p>${_t('Placement')}: ${[['inline', _t('In Line')], ['display', _t('Displayed')], ['float', _t('Floating')]].map(([v, t]) => radio('p55-pl', v, l.placement, t)).join(' ')}</p>
    <p>${_t('Offset from Bottom of Frame:')} ${num('p55-off', l.offset)}　${chk('p55-here', l.here, _t('Here'))} ${chk('p55-fl', l.floats, _t('On a Page of Floats'))} ${chk('p55-top', l.top, _t('Top of Page'))} ${chk('p55-bot', l.bottom, _t('Bottom of Page'))}</p>`;
  const p2 = s.p2;
  const twoD = `${docOrMine('p55-2d', !!doc.p2)}
    <p>${_t('Default Plot Style')}: ${radio('p55-2st', 'line', p2.style, _t('Line'))} ${radio('p55-2st', 'point', p2.style, _t('Point'))}</p>
    <p>${_t('Line Style:')} ${sel('p55-2ls', p2.lineStyle, LINE_STYLES())}　${_t('Line Thickness:')} ${sel('p55-2th', p2.thickness, THICKNESS())}　${_t('Point Marker:')} ${sel('p55-2pm', p2.marker, MARKERS())}</p>
    <p>${_t('Axes Type:')} ${sel('p55-2ax', p2.axes, AXES())}　${_t('Plot Color:')} ${sel('p55-2c', p2.color, COLORS())}</p>
    <p>${chk('p55-2dis', p2.discontinuity, _t('Specify Discontinuity Behavior'))}: ${radio('p55-2adj', 'always', p2.adjust, _t('Always adjust for discontinuities'))} ${radio('p55-2adj', 'never', p2.adjust, _t('Never adjust for discontinuities'))}</p>`;
  const p3 = s.p3;
  const threeD = `${docOrMine('p55-3d', !!doc.p3)}
    <p>${_t('Line Style:')} ${sel('p55-3ls', p3.lineStyle, LINE_STYLES())}　${_t('Line Thickness:')} ${sel('p55-3th', p3.thickness, THICKNESS())}　${_t('Point Marker:')} ${sel('p55-3pm', p3.marker, MARKERS())}</p>
    <p>${_t('Axes Type:')} ${sel('p55-3ax', p3.axes, AXES())}　${_t('Surface Style:')} ${sel('p55-3ss', p3.surface, [['Color Patch', _t('Color Patch')], ['Wire Frame', _t('Wire Frame')], ['Hidden Line', _t('Hidden Line')], ['Patch and Contour', _t('Patch and Contour')], ['Contour', _t('Contour')], ['Point', _t('Point')]])}
      ${_t('Surface Mesh:')} ${sel('p55-3sm', p3.mesh, [['Mesh', _t('Mesh')], ['None', _t('None')], ['Hidden Line', _t('Hidden Line')]])}</p>
    <p>${_t('Item Coloring')}: ${_t('Directional Shading:')} ${sel('p55-3dsh', p3.shading, [['XYZ', 'XYZ'], ['XY', 'XY'], ['Z', 'Z'], ['None', _t('None')]])}　${_t('Base Color:')} ${sel('p55-3b', p3.base, COLORS())}　${_t('Secondary Color:')} ${sel('p55-3s', p3.secondary, COLORS())}</p>`;
  const b = s.behavior;
  const behavior = `${docOrMine('p55-beh', !!doc.behavior)}
    <p>${chk('p55-snap', b.snapshots, _t('Generate Plot Snapshots Automatically'))}</p>
    <p>${chk('p55-rec', b.recompute, _t('Recompute Plot When Definitions Change'))}</p>
    <p>${chk('p55-dlg', b.dialogFirst, _t('Display Plot Properties Dialog Before Plotting'))}</p>`;
  const rows = (kind) => INTERVAL_KINDS[kind].rows.map(([v], i) => {
    const [a, z, n] = s.intervals[kind][i];
    return `${rowName(v)}: ${num(`p55-i-${kind}-${i}-a`, a, 6)} ${_t('to')} ${num(`p55-i-${kind}-${i}-b`, z, 6)} ${_t('Points Sampled:')} ${num(`p55-i-${kind}-${i}-n`, n, 4)}`;
  }).join('　');
  const intervals = `${docOrMine('p55-int', !!doc.intervals || !!doc.animation)}
    <p><b>${_t('2D Plots')}</b></p>${Object.keys(INTERVAL_KINDS).filter((k) => !INTERVAL_KINDS[k].three).map((k) => `<p>${INTERVAL_KINDS[k].label()}: ${rows(k)}</p>`).join('')}
    <p><b>${_t('3D Plots')}</b></p>${Object.keys(INTERVAL_KINDS).filter((k) => INTERVAL_KINDS[k].three).map((k) => `<p>${INTERVAL_KINDS[k].label()}: ${rows(k)}</p>`).join('')}
    <p><b>${_t('Animation time settings')}</b>: ${_t('Animation start (seconds):')} ${num('p55-as', s.animation.start)} ${_t('Animation end:')} ${num('p55-ae', s.animation.end)} ${_t('Frames per second:')} ${num('p55-af', s.animation.fps)}</p>`;
  return [[_t('Plot Layout'), layout], [_t('2D Plots'), twoD], [_t('3D Plots'), threeD], [_t('Plot Behavior'), behavior], [_t('Default Plot Intervals and Animation'), intervals]];
}

// the plot pages read back from the dialog -> saved (this computer, or the document); an error text or null
export function savePlotPages(d, app) {
  const v = (id) => d.querySelector('#' + id).value.trim();
  const n = (id) => Number(v(id));
  const on = (id) => d.querySelector('#' + id).checked;
  const pick = (name) => d.querySelector(`input[name="${name}"]:checked`)?.value;
  const layout = { width: n('p55-w'), height: n('p55-h'), units: v('p55-u'), screen: pick('p55-scr'), print: pick('p55-prn'), placement: pick('p55-pl'),
    offset: n('p55-off'), here: on('p55-here'), floats: on('p55-fl'), top: on('p55-top'), bottom: on('p55-bot') };
  if (!(layout.width > 0 && layout.height > 0) || !Number.isFinite(layout.offset)) return _t('The width and height must be numbers above 0');
  const p2 = { style: pick('p55-2st'), lineStyle: v('p55-2ls'), thickness: v('p55-2th'), marker: v('p55-2pm'), axes: v('p55-2ax'), color: v('p55-2c'),
    discontinuity: on('p55-2dis'), adjust: pick('p55-2adj') };
  const p3 = { lineStyle: v('p55-3ls'), thickness: v('p55-3th'), marker: v('p55-3pm'), axes: v('p55-3ax'), surface: v('p55-3ss'), mesh: v('p55-3sm'),
    shading: v('p55-3dsh'), base: v('p55-3b'), secondary: v('p55-3s') };
  const behavior = { snapshots: on('p55-snap'), recompute: on('p55-rec'), dialogFirst: on('p55-dlg') };
  const intervals = {};
  for (const [k, def] of Object.entries(INTERVAL_KINDS)) {
    intervals[k] = def.rows.map((r, i) => [n(`p55-i-${k}-${i}-a`), n(`p55-i-${k}-${i}-b`), Math.round(n(`p55-i-${k}-${i}-n`))]);
    for (const [a, b, m] of intervals[k]) {
      if (![a, b].every(Number.isFinite)) return _t('Invalid characters in range!');
      if (!(a < b)) return _t('Start of range must be less than end of range');
      if (!(m >= 2)) return _t('Points sampled must be 2 or more');
    }
  }
  const animation = { start: n('p55-as'), end: n('p55-ae'), fps: Math.round(n('p55-af')) };
  if (![animation.start, animation.end].every(Number.isFinite) || !(animation.start < animation.end) || !(animation.fps >= 1)) return _t('Start of range must be less than end of range');
  const pages = { layout, p2, p3, behavior, intervals, animation };
  const which = { layout: 'p55-layout', p2: 'p55-2d', p3: 'p55-3d', behavior: 'p55-beh', intervals: 'p55-int', animation: 'p55-int' };
  const mine = { ...(settings().plot55 || {}) };
  const doc = { ...(app.meta().plot55 || {}) };
  for (const [page, name] of Object.entries(which)) {
    if (pick(name) === 'doc') doc[page] = pages[page];
    else { mine[page] = pages[page]; delete doc[page]; }
  }
  saveSettings({ ...settings(), plot55: mine });
  const meta = { ...app.meta() };
  if (Object.keys(doc).length) meta.plot55 = doc; else delete meta.plot55;
  app.setMeta(meta);
  return null;
}

export const resetPlot55 = () => saveSettings({ ...settings(), plot55: {} });
