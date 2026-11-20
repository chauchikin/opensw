// 5.5 Compute menu, part "defsmisc": Definitions > Undefine, Save Definitions, Restore Definitions,
// Define MuPAD Name; Compute > Settings; Interpret (Ctrl+?); Solve ODE > Laplace and Series.
// Each entry is op -> (ctx) => ..., ctx as described in src/c55.js.
//
// As in 5.5, a document keeps its definitions in its preamble (Save Definitions; restored when it
// is opened, as Compute > Settings > Definition Options says):
//   %TCIDATA{ComputeDefs=          one definition per $..$, each line after a %
//   %$x_{0}=3$
//   %}
//   %TCIDATA{MuPadMappings=        Define MuPAD Name: name <-> MuPAD name
//   %$n\left( x\right) \leftrightarrow$ nextprime(x)
//   %}
//   %TCIDATA{ComputeGeneralSettings=1,5,5,0,0,0,0}   Compute > Settings > General, Set Document Values
// A document that is not a 5.x file keeps the same lines in meta.tcidata55 (written into the
// preamble when it is saved as 5.x, src/export.js).
import { _t } from './i18n.js';
import { compute, definitionList, undefineNames, mapName, setOptionsProvider, definedNameOf } from './compute.js';
import { settings, saveSettings } from './settings.js';
import { odeRows } from './mathjson.js';
import { plotPages, savePlotPages } from './plot55.js';

// ---------- %TCIDATA{key=...} in a preamble ----------
const is5x = (p) => p != null && /\\input\s*\{?tcilatex|%TCIDATA/.test(p);
// the value of a %TCIDATA{key=..} (a block over several % lines: its lines without the %), or null
export function readTci(text, key) {
  const lines = (text || '').split('\n');
  const at = lines.findIndex((l) => l.startsWith(`%TCIDATA{${key}=`));
  if (at < 0) return null;
  const first = lines[at].slice(`%TCIDATA{${key}=`.length);
  if (first.trimEnd().endsWith('}') && first.trim() !== '') return first.trimEnd().slice(0, -1);
  const out = first ? [first] : [];
  for (let i = at + 1; i < lines.length && lines[i].trimEnd() !== '%}'; i++) out.push(lines[i].replace(/^%/, ''));
  return out.join('\n');
}
// text with %TCIDATA{key=value} put in (in place of the old one; else after the other %TCIDATA
// lines, as 5.5 writes it, else before \input tcilatex, else at the end); value null takes it out;
// a value with a line end is written as a block
export function writeTci(text, key, value) {
  const lines = (text || '').split('\n');
  const at = lines.findIndex((l) => l.startsWith(`%TCIDATA{${key}=`));
  let n = 0;
  if (at >= 0) {
    const first = lines[at].slice(`%TCIDATA{${key}=`.length);
    if (first.trimEnd().endsWith('}') && first.trim() !== '') n = 1;
    else { n = 1; while (at + n < lines.length && lines[at + n - 1].trimEnd() !== '%}') n++; }
  }
  const put = value == null ? [] : value.includes('\n') || key === 'ComputeDefs' || key === 'MuPadMappings'
    ? [`%TCIDATA{${key}=`, ...value.split('\n').filter((l) => l !== '').map((l) => '%' + l), '%}']
    : [`%TCIDATA{${key}=${value}}`];
  if (at >= 0) lines.splice(at, n, ...put);
  else if (put.length) {
    let last = -1;
    lines.forEach((l, i) => { if (/^%TCIDATA\{/.test(l)) last = i; });
    // after the last %TCIDATA line (and the block it opens)
    if (last >= 0 && !/\}\s*$/.test(lines[last])) while (last + 1 < lines.length && lines[last].trimEnd() !== '%}') last++;
    const input = lines.findIndex((l) => /^\\input\s*\{?tcilatex/.test(l));
    const where = last >= 0 ? last + 1 : input >= 0 ? input : lines.length;
    lines.splice(where, 0, ...put);
  }
  return lines.join('\n');
}
const tciOf = (meta) => (is5x(meta.preamble55raw) ? meta.preamble55raw : meta.tcidata55 || '');
function setTci(app, key, value) {
  const meta = app.meta();
  if (is5x(meta.preamble55raw)) {
    const v = writeTci(meta.preamble55raw, key, value);
    if (v !== meta.preamble55raw) app.setMeta({ ...meta, preamble55raw: v });
  } else {
    const v = writeTci(meta.tcidata55 || '', key, value).replace(/^\n+|\n+$/g, '');
    if (v !== (meta.tcidata55 || '')) app.setMeta({ ...meta, tcidata55: v || undefined });
  }
}
// the $..$ formulas of a ComputeDefs block; the mappings of a MuPadMappings block
const dollars = (text) => [...(text || '').matchAll(/\$([^$]+)\$/g)].map((m) => m[1].replace(/\n/g, ' ').trim());
const mappings = (text) => [...(text || '').matchAll(/\$([^$]+?)\\leftrightarrow\s*\$\s*([^\n$]*)/g)].map((m) => [m[1].trim(), m[2].trim()]);

// ---------- Compute > Settings ----------
// this computer's defaults (5.5: Tools > Computation Setup); Principal Value and the log base are
// the ones of Tools > Computation Engine
const DEFAULTS = { digits: 5, threshold: 5, trig_ordinary: false, imaginary_j: false, bessel_subscripts: false,
  comp_digits: 10, ode_series_order: 6, max_degree: 3, ignore_special: false, defs_open: 'always', defs_save: 'always' };
const mine = () => ({ ...DEFAULTS, ...(settings().compute55 || {}) });
// ComputeGeneralSettings=a,digits,threshold,trigtype to ordinary,i to j,e to 10,Bessel with subscripts
// (as 5.5 writes them; a is kept as it was)
function docGeneral(meta) {
  const v = readTci(tciOf(meta), 'ComputeGeneralSettings');
  if (!v) return null;
  const n = v.split(',').map((x) => parseInt(x, 10));
  if (n.length < 7 || n.some((x) => Number.isNaN(x))) return null;
  return { first: n[0], digits: n[1], threshold: n[2], trig_ordinary: !!n[3], imaginary_j: !!n[4], log10: !!n[5], bessel_subscripts: !!n[6] };
}
// Definition Options a document set for itself (kept with the document by opensw)
const docDefOptions = (meta) => meta.defOptions55 || null;
// what the engines follow now (src/compute.js asks for it before each computation)
export function optionsFor(meta) {
  const m = mine();
  const d = docGeneral(meta || {});
  const o = { digits: m.digits, threshold: m.threshold, comp_digits: m.comp_digits, imaginary_j: m.imaginary_j,
    bessel_subscripts: m.bessel_subscripts, ode_series_order: m.ode_series_order, trig_ordinary: m.trig_ordinary,
    max_degree: m.max_degree, ignore_special: m.ignore_special }; // Solve Options: the engines solve with them
  if (d) Object.assign(o, { digits: d.digits, threshold: d.threshold, trig_ordinary: d.trig_ordinary, imaginary_j: d.imaginary_j, bessel_subscripts: d.bessel_subscripts, log10: d.log10 });
  o.digits = Math.max(1, Math.min(o.digits, o.comp_digits));
  return o;
}

function settings55(ctx) {
  const { app, dialog, escHtml } = ctx;
  const m = mine();
  const meta = app.meta();
  const d = docGeneral(meta);
  const g = d || { ...m, log10: settings().logBase10 };
  const dd = docDefOptions(meta);
  const df = dd || { open: m.defs_open, save: m.defs_save };
  const chk = (id, on, label) => `<label><input type="checkbox" id="${id}"${on ? ' checked' : ''}> ${label}</label>`;
  const radio = (name, v, cur, label) => `<label><input type="radio" name="${name}" value="${v}"${v === cur ? ' checked' : ''}> ${label}</label>`;
  const num = (id, v) => `<input id="${id}" size="4" value="${escHtml(String(v))}">`;
  // 5.5's pages, one shown at a time (a row of tabs): General, Definition Options, Engine Setup, and the plot pages
  const plots = plotPages(meta);
  const tabs = [_t('General'), _t('Definition Options'), _t('Engine Setup'), ...plots.map(([t]) => t)];
  dialog(_t('Compute settings'), `<div class="tabs55">${tabs.map((t, i) => `<button type="button" data-page="${i}"${i ? '' : ' class="on"'}>${t}</button>`).join('')}</div>
    <div class="page55" data-page="0">
    <fieldset><legend>${_t('General')}</legend>
      <p>${radio('d-gs', 'default', d ? 'doc' : 'default', _t('Use Defaults'))}　${radio('d-gs', 'doc', d ? 'doc' : 'default', _t('Set Document Values'))}</p>
      <p>${_t('Digits Shown in Results:')} ${num('d-dig', g.digits)}　${_t('Threshold for Scientific Notation:')} ${num('d-thr', g.threshold)}</p>
      <p>${_t('Function-Argument Selection Method')}: ${chk('d-trig', g.trig_ordinary, _t('Convert Trigtype to Ordinary'))}</p>
      <p>${_t('Imaginary Unit')}: ${chk('d-ij', g.imaginary_j, _t('Change from i to j'))}</p>
      <p>${_t('Base for log function')}: ${chk('d-log', g.log10, _t('Change from e to 10'))}</p>
      <p>${_t('Bessel Function Notation')}: ${chk('d-bes', g.bessel_subscripts, _t('Use I, J, K, and Y with Subscripts'))}</p>
      <p class="d-note">${_t('Use Defaults: these are the values for every document (changed here). Set Document Values: this document keeps its own, saved with it.')}</p>
    </fieldset></div>
    <div class="page55" data-page="1" hidden><fieldset><legend>${_t('Definition Options')}</legend>
      <p>${radio('d-ds', 'default', dd ? 'doc' : 'default', _t('Use Defaults'))}　${radio('d-ds', 'doc', dd ? 'doc' : 'default', _t('Set Document Values'))}</p>
      <p>${_t('On Document Open')}: ${radio('d-open', 'never', df.open, _t('Do Not Restore'))} ${radio('d-open', 'ask', df.open, _t('Ask for Confirmation'))} ${radio('d-open', 'always', df.open, _t('Always Restore'))}</p>
      <p>${_t('On Document Save')}: ${radio('d-save', 'never', df.save, _t('Do Not Save'))} ${radio('d-save', 'ask', df.save, _t('Ask for Confirmation'))} ${radio('d-save', 'always', df.save, _t('Always Save'))}</p>
    </fieldset></div>
    <div class="page55" data-page="2" hidden><fieldset><legend>${_t('Engine Setup (all documents)')}</legend>
      <p>${_t('Digits Used in Computations:')} ${num('d-cdig', m.comp_digits)}　${_t('Series Order for ODE Solutions:')} ${num('d-ser', m.ode_series_order)}</p>
      <p>${_t('Solve Options')}: ${_t('Maximum Degree:')} ${num('d-deg', m.max_degree)}　${chk('d-pv', settings().solvePrincipal, _t('Principal Value Only'))}　${chk('d-isc', m.ignore_special, _t('Ignore Special Cases'))}</p>
      <p class="d-note">${_t('The engine itself is chosen in Tools > Computation Engine.')}</p>
    </fieldset></div>
    ${plots.map(([t, html], i) => `<div class="page55" data-page="${i + 3}" hidden><fieldset><legend>${t}</legend>${html}</fieldset></div>`).join('')}`, (b) => {
    const plotError = savePlotPages(b, app);
    if (plotError) { app.toast(plotError); return; }
    const int = (id, lo, hi) => { const v = parseInt(b.querySelector(id).value, 10); return Number.isInteger(v) && v >= lo && v <= hi ? v : null; };
    const val = (name) => b.querySelector(`input[name="${name}"]:checked`).value;
    const on = (id) => b.querySelector(id).checked;
    const digits = int('#d-dig', 1, 100); const threshold = int('#d-thr', 1, 100);
    const compDigits = int('#d-cdig', 1, 1000); const order = int('#d-ser', 1, 100); const degree = int('#d-deg', 1, 100);
    if ([digits, threshold, compDigits, order, degree].includes(null)) { app.toast(_t('Write whole numbers, 1 or more')); return; }
    if (digits > compDigits) { app.toast(_t('Digits shown cannot exceed the digits used in computations')); return; }
    const general = { digits, threshold, trig_ordinary: on('#d-trig'), imaginary_j: on('#d-ij'), bessel_subscripts: on('#d-bes') };
    const defs = { open: val('d-open'), save: val('d-save') };
    const s = settings();
    const c55 = { ...mine(), comp_digits: compDigits, ode_series_order: order, max_degree: degree, ignore_special: on('#d-isc') };
    let logBase10 = s.logBase10;
    if (val('d-gs') === 'doc') {
      const first = d ? d.first : 1;
      setTci(app, 'ComputeGeneralSettings', [first, digits, threshold, +general.trig_ordinary, +general.imaginary_j, +on('#d-log'), +general.bessel_subscripts].join(','));
    } else {
      if (d) setTci(app, 'ComputeGeneralSettings', null);
      Object.assign(c55, general);
      logBase10 = on('#d-log');
    }
    if (val('d-ds') === 'doc') app.setMeta({ ...app.meta(), defOptions55: defs });
    else {
      if (dd) { const m2 = { ...app.meta() }; delete m2.defOptions55; app.setMeta(m2); }
      c55.defs_open = defs.open; c55.defs_save = defs.save;
    }
    saveSettings({ ...settings(), compute55: c55, solvePrincipal: on('#d-pv'), logBase10 });
    app.toast(_t('Compute settings saved'));
  });
  const body = document.querySelector('#dialog-body');
  body?.querySelectorAll('.tabs55 button').forEach((t) => {
    t.onclick = () => {
      body.querySelectorAll('.tabs55 button').forEach((x) => x.classList.toggle('on', x === t));
      body.querySelectorAll('.page55').forEach((pg) => { pg.hidden = pg.dataset.page !== t.dataset.page; });
    };
  });
}

// ---------- Definitions ----------
const quote = (s) => s.replace(/\$/g, '\\$');
// the definitions in force as 5.5 writes them in the document
function blocksNow() {
  const list = definitionList().filter((d) => d.latex);
  const defs = list.filter((d) => !d.mapping).map((d) => `$${quote(d.latex)}$`);
  const maps = list.filter((d) => d.mapping).map((d) => {
    const [name, mupad] = d.latex.split(/\s*\\leftrightarrow\s*/);
    return `$${quote(name)} \\leftrightarrow$ ${mupad}`;
  });
  return { defs: defs.length ? defs.join('\n') : null, maps: maps.length ? maps.join('\n') : null };
}
function saveDefinitions(app) {
  const { defs, maps } = blocksNow();
  setTci(app, 'ComputeDefs', defs);
  setTci(app, 'MuPadMappings', maps);
  return (defs ? defs.split('\n').length : 0) + (maps ? maps.split('\n').length : 0);
}
async function restoreDefinitions(app) {
  const text = tciOf(app.meta());
  let n = 0;
  const failed = [];
  for (const [name, mupad] of mappings(readTci(text, 'MuPadMappings'))) {
    const fn = mupad.match(/^([^()\s]+)\s*(\(.*\))?$/);
    try { await mapName(name, fn ? fn[1] : mupad, /\(/.test(name)); n++; } catch (e) { failed.push(name); }
  }
  for (const f of dollars(readTci(text, 'ComputeDefs'))) {
    try { await compute('define', f); n++; } catch (e) { failed.push(f); }
  }
  return { n, failed };
}
// a yes/no question (Definition Options: Ask for Confirmation)
function ask(ctx, title, text) {
  return new Promise((resolve) => {
    ctx.dialog(title, `<p>${text}</p>`, () => resolve(true));
    const cancel = document.querySelector('#dialog-cancel');
    const before = cancel.onclick;
    cancel.onclick = (e) => { before?.(e); resolve(false); };
  });
}
const whenTo = (meta, which) => (docDefOptions(meta) || {})[which] || mine()[which === 'open' ? 'defs_open' : 'defs_save'];

// opening a document: its definitions are restored (Definition Options, On Document Open)
async function onOpen(ctx) {
  const meta = ctx.app.meta();
  const text = tciOf(meta);
  if (!readTci(text, 'ComputeDefs') && !readTci(text, 'MuPadMappings')) return;
  const mode = whenTo(meta, 'open');
  if (mode === 'never') return;
  if (mode === 'ask' && !(await ask(ctx, _t('Restore Definitions'), _t('This document has saved definitions. Restore them?')))) return;
  const { n, failed } = await restoreDefinitions(ctx.app);
  if (n || failed.length) ctx.app.toast(_t('Definitions restored: {0}', n) + (failed.length ? _t(' (could not: {0})', failed.join(_t('; '))) : ''));
}
// saving: the definitions in force go into the document (On Document Save)
async function onSave(ctx) {
  const meta = ctx.app.meta();
  const had = readTci(tciOf(meta), 'ComputeDefs') != null || readTci(tciOf(meta), 'MuPadMappings') != null;
  if (!definitionList().some((d) => d.latex) && !had) return;
  const mode = whenTo(meta, 'save');
  if (mode === 'never') return;
  if (mode === 'ask' && !(await ask(ctx, _t('Save Definitions'), _t('Save the definitions in force with this document?')))) return;
  saveDefinitions(ctx.app);
}

async function undefine(ctx) {
  const mv = ctx.currentMath();
  if (!mv) { ctx.toast(_t('Put the cursor in a definition or the name it defines')); return; }
  try {
    const name = await definedNameOf(mv.latex);
    const n = name ? await undefineNames([name]) : 0;
    ctx.toast(n ? _t('Undefined: {0}', name.replace(/^opensw_/, '')) : _t('Not defined: {0}', mv.latex));
  } catch (e) { ctx.toast(e.message); }
}

function mupadName(ctx) {
  const { dialog, escHtml, app } = ctx;
  const mv = ctx.currentMath();
  const cur = mv ? mv.latex.split(/\\leftrightarrow|=/)[0].trim() : '';
  dialog(_t('Map MuPAD Name'), `
    <p>${_t('MuPAD Name:')} <input id="d-mu" size="24" placeholder="${escHtml(_t('e.g. nextprime or numlib::divisors'))}"></p>
    <p>${_t('Scientific Word Name:')} <input id="d-sw" size="24" value="${escHtml(cur)}" placeholder="${escHtml(_t('e.g. n(x)'))}"></p>
    <p><label><input type="checkbox" id="d-proc" checked> ${_t('The MuPAD Name is a procedure')}</label></p>
    <p><label><input type="radio" name="d-where" value="built" checked> ${_t('That is built in to MuPAD or is automatically loaded.')}</label></p>
    <p><label><input type="radio" name="d-where" value="file" disabled> ${_t('In MuPAD format file (.mu file)')}</label>
      <span class="d-note">${_t('(opensw has no MuPAD to load a .mu file into)')}</span></p>
    <p class="d-note">${_t('The MuPAD names opensw knows are worked out by its computation engine (nextprime, numlib::divisors, linalg::swapRow, isprime, ifactor ...; also any SymPy function such as totient).')}</p>`, async (d) => {
    const mu = d.querySelector('#d-mu').value.trim();
    const sw = d.querySelector('#d-sw').value.trim();
    if (!mu || !sw) { app.toast(_t('Fill in both names')); return; }
    try {
      const r = await mapName(sw, mu.replace(/\s*\(.*$/, ''), d.querySelector('#d-proc').checked);
      app.toast(_t('Defined: later computations will use it') + (r.latex ? ' ' : ''));
    } catch (e) { app.toast(_t('Could not compute: ') + e.message); }
  });
}

// Solve ODE > Laplace, Series: 5.5 asks the independent variable when the equations do not say it
async function solveOde(ctx, op) {
  const mv = ctx.currentMath();
  if (!mv) { ctx.toast(_t('Put the cursor in a formula to compute')); return; }
  const { equations, inits } = odeRows(mv.latex);
  const funcs = new Set([...inits.map((i) => i[0]), ...equations.flatMap((e) => [...e.matchAll(/([A-Za-z](?:_\{?[A-Za-z0-9]+\}?)?)\s*(?:\^\s*\{\s*(?:\\prime\s*)+\}|')/g)].map((m) => m[1].replace(/[{}]/g, '')))]);
  // the letters of the equations (not in a command such as \\sin, not e or i): the unknowns and the variable
  const variables = [...new Set([...equations.join(' ').replace(/\\(operatorname|mathrm|text)\s*\{[^{}]*\}|\\[A-Za-z]+/g, ' ')
    .matchAll(/(?<![A-Za-z])([A-Za-z])(?:\s*_\s*(\{[^{}]*\}|[A-Za-z0-9]))?/g)].map((m) => m[1] + (m[2] ? '_' + m[2].replace(/[{}]/g, '') : '')))]
    .filter((v) => v !== 'e' && v !== 'i' && v !== 'D' && v !== 'd');
  const derivVar = equations.map((e) => e.match(/\\frac\s*\{\s*d[^}]*\}\s*\{\s*d\s*([A-Za-z])\s*\}|D_\s*\{?([a-z])/)).find(Boolean);
  const others = variables.filter((v) => !funcs.has(v.replace(/[{}]/g, '')));
  if (derivVar || others.length === 1) { ctx.runCompute(op, ['', derivVar ? derivVar[1] || derivVar[2] : others[0]], mv); return; }
  const guess = funcs.has('x') ? 't' : others[0] || 'x';
  ctx.askCompute(op, _t('ODE Independent Variable'), `<p>${_t('Independent Variable:')} ${ctx.varField(others, guess)}</p>`,
    (d) => ['', ctx.field(d, '#d-v') || guess]);
}

export const ACTIONS = {
  undefine,
  savedefs: (ctx) => { const n = saveDefinitions(ctx.app); ctx.toast(n ? _t('Definitions saved with the document: {0} (they are written when the document is saved)', n) : _t('No definitions yet')); },
  restoredefs: async (ctx) => {
    const { n, failed } = await restoreDefinitions(ctx.app);
    ctx.toast(n || failed.length ? _t('Definitions restored: {0}', n) + (failed.length ? _t(' (could not: {0})', failed.join(_t('; '))) : '') : _t('This document has no saved definitions'));
  },
  mupadname: mupadName,
  interpret: (ctx) => ctx.runCompute('interpret'),
  settings55,
  odelaplace: (ctx) => solveOde(ctx, 'odelaplace'),
  odeseries: (ctx) => solveOde(ctx, 'odeseries'),
  // set up once (src/ui55.js): the engines follow the settings of the document on screen, and its
  // definitions are restored on opening and saved on saving (src/main.js)
  __init: (ctx) => {
    setOptionsProvider(() => optionsFor(ctx.app.meta()));
    hooks.open = () => onOpen(ctx).catch((e) => ctx.toast(e.message));
    hooks.save = () => onSave(ctx).catch(() => {});
  },
};
const hooks = { open: null, save: null };
export const definitionsOnOpen = () => hooks.open?.();
export const definitionsOnSave = () => hooks.save?.();
