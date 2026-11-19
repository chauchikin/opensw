import 'mathlive';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands } from 'prosemirror-commands';
import { tableEditing, goToNextCell, CellSelection } from 'prosemirror-tables';
import { history, undo, redo } from 'prosemirror-history';
import { inputRules, InputRule } from 'prosemirror-inputrules';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { schema } from './schema.js';
import { MathView, mathKeys } from './mathview.js';
import { NoteView } from './noteview.js';
import { readSci } from './sci.js';
import { readTex55, decode55 } from './tex55.js';
import { toLatex, toMarkdown, toTex55File, originalTex55, patchTex55 } from './export.js';
import { encodeFile55, withCodepage55 } from './tex55file.js';
import { toHtml } from './html.js';
import { writeSci, sciMathML, blankSci } from './sciwriter.js';
import { readLatex } from './tex55.js';
import { SAMPLES } from './samples.js';
import JSZip from 'jszip';
import { isDesktop, pickAndRead, readPath, writeBytes, typeset, serveApi, onCloseWindow, backupFile, startupPath, fetchUrl, aiHome } from './desktop.js';
import { setupUI } from './ui55.js';
import { settings, applySettings } from './settings.js';
import { makeApi } from './api.js';
import { aiChangesPlugin, aiStart, aiEnd, aiEdit, aiBusy } from './aiedits.js';
import { numberingPlugin } from './numbering.js';
import { preloadEngine, plotPoints } from './compute.js';
import { parsePlot, drawable, plotSVG, plotSVG3D, plotKind, is3D } from './plots.js';
import { plotData } from './plotdata.js';
import { candidates, TEX_IMAGE, WEB_IMAGE, mimeOf } from './graphics.js';
import './style.css';
import { _t, _tm, translatePage } from './i18n.js';

translatePage();

const STORE = 'sw-next-doc-v1';
let meta = {};
// the .sci file the document came from: its other files and <head> are kept on save
let source = null; // { zip, headXML }
let currentPath = null; // desktop app: where the document was opened from / saved to
// a document opened from (or last saved as) a 5.x .tex: its text as on disk. While the
// document is unchanged (doc eq loadedDoc) it is typeset from this text and saving
// leaves the file alone, so 5.5's own layout is kept exactly.
let original55 = null; // { bytes, text, is5x, spans (the file's parts, see patchTex55) }
let ui = null; // menus, toolbars and tag bar (set up below)

// typing "$" starts a formula (like Ctrl+M in Scientific Word)
const dollarRule = new InputRule(/\$$/, (state, match, start, end) => {
  const tr = state.tr.replaceWith(start, end, schema.nodes.math_inline.create({ latex: '' }));
  queueMicrotask(() => view.nodeDOM(start)?._mathView?.enter(false));
  return tr;
});

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl';
const keys = {
  'Mod-z': undo, 'Mod-y': redo, // Ctrl+Y is not a 5.5 key but takes nothing from it; 5.5's keys are in ui55.js
  'Shift-Enter': (state, dispatch) => { dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView()); return true; },
  Enter: splitListItem(schema.nodes.list_item),
  // in a table Tab moves to the next cell, as in 5.5
  Tab: chainCommands(goToNextCell(1), sinkListItem(schema.nodes.list_item)),
  'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(schema.nodes.list_item)),
};

function makeState(doc) {
  return EditorState.create({
    doc,
    plugins: [inputRules({ rules: [dollarRule] }), keymap(mathKeys), keymap(keys), keymap(baseKeymap), history(), tableEditing(), numberingPlugin(() => meta), aiChangesPlugin()],
  });
}

const view = new EditorView(document.querySelector('#editor'), {
  // Tools > User Setup: the last document, a blank one, or the introduction
  state: makeState((settings().startup === 'last' && loadSaved()) || (settings().startup === 'blank' ? schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]) : demoDoc())),
  nodeViews: {
    math_inline: (n, v, g) => new MathView(n, v, g),
    math_display: (n, v, g) => new MathView(n, v, g),
    note: (n, v, g) => new NoteView(n, v, g),
  },
  dispatchTransaction(tr) {
    // the person changed the document: the AI's edit is over (aiedits.js)
    if (tr.docChanged && aiEdit() && !tr.getMeta('ai')) aiEnd();
    view.updateState(view.state.apply(tr));
    if (tr.docChanged) { scheduleSave(); showTitle(); }
    showAi();
    ui?.refresh();
  },
});
window.swEditor = view; // for tests
window.swI18n = { _t, _tm }; // for tests
window.swTables = { CellSelection }; // for tests
window.swNodeSelection = NodeSelection; // for tests
window.swTextSelection = TextSelection;
window.swComputeForTests = { plotPoints, plotDataOfFrame: (frame) => plotData(parsePlot(frame.slice(frame.indexOf('\\special')))) };
window.swSciMathML = sciMathML; // for tests

// ---------- saving in this browser ----------
let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ doc: view.state.doc.toJSON(), meta })); } catch (e) { /* storage unavailable */ }
  }, 500);
}
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (!s) return null;
    meta = s.meta || {};
    // pictures were shown from memory (blob: URLs) that is gone after a reload
    const json = JSON.stringify(s.doc).replace(/"src":"blob:[^"]*"/g, '"src":null');
    return schema.nodeFromJSON(JSON.parse(json));
  } catch (e) { return null; }
}

let aiSetting = false; // setDoc for an AI's set command: part of its edit
function setDoc(doc, m = {}, src = null, path = null) {
  if (!aiSetting) aiEnd();
  // a document the user opens goes in a window of its own (5.5's Window menu); the one on
  // screen stays open unless it is an untouched one without a name
  if (opening && (!view.state.doc.eq(loadedDoc) || currentPath || meta.name)) others.push(currentRecord());
  opening = false;
  assets = new Map();
  subFiles = new Map();
  meta = m;
  source = src;
  currentPath = path;
  original55 = null;
  loadedDoc = doc;
  view.updateState(makeState(doc));
  scheduleSave();
  ui?.refresh();
  $('#scroller').scrollTop = 0;
  showTitle();
  showAi();
}

// ---------- Window: several documents open ----------
// The documents not on screen, each with everything that belongs to it.
const others = [];
let opening = false; // set by the user's File > New / Open: the next setDoc keeps the current one
function currentRecord() {
  return { state: view.state, meta, source, path: currentPath, original55, loadedDoc, assets, subFiles, scroll: $('#scroller').scrollTop };
}
function showRecord(r) {
  meta = r.meta; source = r.source; currentPath = r.path; original55 = r.original55 || null; loadedDoc = r.loadedDoc; assets = r.assets; subFiles = r.subFiles;
  view.updateState(r.state);
  ui?.refresh();
  $('#scroller').scrollTop = r.scroll || 0;
  showTitle();
  scheduleSave();
}
const docName = (m, path) => m.name || (path ? path.split(/[\\/]/).pop() : _t('Untitled'));
// what an AI changed (aiedits.js): the status bar says so and offers to take it back
function showAi() {
  const box = document.querySelector('#status-ai');
  if (!box) return;
  const edit = aiEdit();
  box.hidden = !edit;
  clearTimeout(showAi.timer);
  if (!edit) return;
  document.querySelector('#status-ai-text').textContent = aiBusy() ? _t('AI is editing…') : _t('AI changed this document (tinted)');
  if (aiBusy()) showAi.timer = setTimeout(showAi, 3100);
}
function undoAiChanges() {
  const edit = aiEdit();
  if (!edit) { toast(_t('There are no AI changes to undo')); return; }
  aiEnd();
  // the same document settings: one step that Ctrl+Z can take back; else the whole document as it was
  if (JSON.stringify(meta || {}) === edit.metaText) view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, edit.doc.content).scrollIntoView());
  else setDoc(edit.doc, edit.meta, source, currentPath);
  toast(_t('The AI\'s changes were undone'));
  showAi();
}
function showTitle() { document.title = `${docName(meta, currentPath)}${view.state.doc.eq(loadedDoc) ? '' : ' *'} - opensw`; }
// Window > (a document): bring it to the screen
function switchTo(i) {
  if (i < 0 || i >= others.length) return;
  const r = others.splice(i, 1)[0];
  others.push(currentRecord());
  showRecord(r);
}
// Ctrl+F6 / Ctrl+Tab: the next document
function nextWindow() { if (others.length) switchTo(0); }
// the Window menu, rebuilt each time it opens
const windowMenu = [];
function refreshWindowMenu() {
  windowMenu.length = 0;
  windowMenu.push([`✓ ${docName(meta, currentPath)}${view.state.doc.eq(loadedDoc) ? '' : ' *'}`, null, () => {}]);
  others.forEach((r, i) => windowMenu.push([`　${docName(r.meta, r.path)}${r.state.doc.eq(r.loadedDoc) ? '' : ' *'}`, null, () => switchTo(i)]));
  windowMenu.push('-', [_t('Next document'), 'Ctrl+F6', nextWindow]);
}
// File > Close: the document on screen goes (asking first if it was changed)
function closeDoc() {
  const close = () => {
    if (others.length) { showRecord(others.pop()); return; }
    opening = false;
    setDoc(schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]));
  };
  if (view.state.doc.eq(loadedDoc)) { close(); return; }
  $('#confirm-text').textContent = _t('This document has unsaved changes, which will be lost if you close it. Close it?');
  $('#confirm-ok').textContent = _t('Close');
  $('#confirm').hidden = false;
  $('#confirm-ok').onclick = () => { $('#confirm').hidden = true; $('#confirm-ok').textContent = _t('Replace'); close(); };
  $('#confirm-cancel').onclick = () => { $('#confirm').hidden = true; $('#confirm-ok').textContent = _t('Replace'); };
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'F6' || e.key === 'Tab')) { e.preventDefault(); nextWindow(); }
}, true);

const $ = (s) => document.querySelector(s);
$('#status-ai-undo').onclick = undoAiChanges;

// ---------- open ----------
$('#file').onchange = (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) confirmReplace(() => openFile(f));
};
async function openFile(f) {
  await openBytes(await f.arrayBuffer(), f.name, null);
}
async function openBytes(bytes, fileName, path) {
  if (path) refreshRecent(path);
  if (/\.(tex|qiz|rap)$/i.test(fileName)) { // Scientific Word 5.x document (an exam template is a .qiz)
    try {
      const raw = new Uint8Array(bytes);
      const text = decode55(raw);
      const r = readLatex(text);
      // a LaTeX file 5.x did not write: Save asks for a new name, so the author's own file is kept (latexKept)
      const is5x = /\\input\{tcilatex\}|%TCIDATA|^%2multibyte/.test(text) || /\.qiz$/i.test(fileName);
      // .tex is the main format: saving writes this file again (a .rap package gets a new .tex)
      setDoc(r.doc, { ...r.meta, name: fileName.replace(/\.(tex|qiz|rap)$/i, '') }, null, /\.(tex|qiz)$/i.test(fileName) ? path : null);
      if (!/\.rap$/i.test(fileName)) original55 = { bytes: raw, text, is5x, spans: r.spans55 };
      toast((is5x ? _t('Opened {0} (Scientific Word 5 document)', fileName) : _t('Opened {0} (LaTeX document; Save makes a new 5.x file and keeps this one)', fileName)) + keptAsTeX());
      // its pictures are files next to it (only the desktop app can read them)
      await loadPictures(path ? path.replace(/[\\/][^\\/]*$/, '') : null);
      renderPlots(); // needs the engine: may take a few seconds
    } catch (err) { toast(_t('Could not open: ') + err.message); }
    return;
  }
  try {
    const r = await readSci(bytes);
    setDoc(r.doc, { ...r.meta, name: fileName.replace(/\.sci$/i, '') }, r, path);
    for (const [p, bytes] of r.files) assets.set(p, bytes);
    toast(_t('Opened {0}', fileName) + keptAsTeX());
  } catch (err) { toast(_t('Could not open: ') + err.message); }
}
// File > Recent Files (desktop app): the menu items, kept up to date in place
const recentMenu = [];
function refreshRecent(path) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem('opensw-recent') || '[]'); } catch (e) { /* none */ }
  if (path) list = [path, ...list.filter((p) => p !== path)].slice(0, 8);
  try { localStorage.setItem('opensw-recent', JSON.stringify(list)); } catch (e) { /* storage off */ }
  recentMenu.length = 0;
  for (const p of list) {
    recentMenu.push([p.split(/[\\/]/).pop(), null, () => confirmReplace(async () => {
      try { await openBytes(await readPath(p), p.split(/[\\/]/).pop(), p); } catch (err) { toast(_t('Could not open: ') + err); }
    })]);
  }
  if (!recentMenu.length) recentMenu.push([isDesktop ? _t('(none yet)') : _t('(desktop app only)'), null, null]);
}
refreshRecent();

function openDialog() {
  if (!isDesktop) { $('#file').click(); return; }
  // the desktop app uses the system's open dialog and remembers the path for saving
  confirmReplace(async () => {
    try {
      const picked = await pickAndRead();
      if (picked) await openBytes(picked.bytes, picked.path.split(/[\\/]/).pop(), picked.path);
    } catch (err) { toast(_t('Could not open: ') + err); }
  });
}
async function openSample(v) {
  if (v === 'demo') { setDoc(demoDoc()); return; }
  if (v === 'blank') { setDoc(schema.nodes.doc.create(null, [schema.nodes.paragraph.create()])); return; }
  const sample = SAMPLES.find((s) => s.id === v); // written in LaTeX (src/samples.js)
  if (sample) setDoc(readLatex(sample.latex).doc, { name: sample.id });
}

// what this editor keeps as raw TeX (shown in grey): said once when a file opens
function keptAsTeX() {
  let n = 0;
  view.state.doc.descendants((x) => { if (x.type.name === 'tex_field' && !/^\\(big|med|small)skip$|^\\(newpage|pagebreak)$/.test(x.attrs.tex.trim())) n++; });
  return n ? _t('; {0} commands are not recognised here and are kept as they are in grey TeX fields, so saving and exporting keep them', n) : '';
}

// ---------- pictures ----------
// The picture files of the document: path (as the document names it) -> bytes.
// 5.x pictures are read from the disk next to the .tex (desktop app), a .sci's
// from its zip, imported pictures from where the user picked them.
let assets = new Map();
// subdocuments (\input, \include) next to a 5.x document: file name -> bytes, for typesetting
let subFiles = new Map();
const imagePaths = () => {
  const s = new Set();
  view.state.doc.descendants((n) => { if (n.type.name === 'image' && n.attrs.path) s.add(n.attrs.path); });
  return s;
};
const blobURL = (bytes, path) => URL.createObjectURL(new Blob([bytes], { type: mimeOf(path) }));
// finds the pictures' files and shows the ones a browser can draw. dir: the document's folder;
// files: name -> bytes when the document came in a package (Tools > Document Manager)
async function loadPictures(dir, files = null) {
  if (isDesktop && dir) {
    const sep = dir.includes('\\') ? '\\' : '/';
    const subs = [];
    view.state.doc.descendants((n) => {
      if (n.type.name === 'subdoc' && n.attrs.file) subs.push(n.attrs.file);
      // BibTeX databases next to the document, for typesetting
      if (n.type.name === 'bibtex') for (const f of n.attrs.files.split(',')) if (f.trim()) subs.push(f.trim().replace(/(\.bib)?$/, '.bib'));
    });
    for (const f of subs) {
      const name = /\.[a-z]+$/i.test(f) ? f : f + '.tex';
      if (/^([a-zA-Z]:|[\\/])|\.\./.test(name)) continue; // only files beside the document
      try { subFiles.set(name.replace(/\\/g, '/'), await readPath(dir + sep + name.replace(/\//g, sep))); } catch (e) { /* missing */ }
    }
  }
  for (const path of imagePaths()) {
    if (assets.has(path)) continue;
    let bytes = null;
    if (isDesktop && dir) {
      for (const c of candidates(dir, path)) {
        try { bytes = await readPath(c); break; } catch (e) { /* not there */ }
      }
    }
    if (files) {
      const rel = path.replace(/\\/g, '/');
      const base = rel.split('/').pop();
      bytes = files.get(rel) || files.get(base) || files.get('graphics/' + base) || null;
    }
    if (bytes) assets.set(path, bytes);
  }
  const tr = view.state.tr;
  view.state.doc.descendants((n, pos) => {
    if (n.type.name === 'image' && !n.attrs.src && assets.has(n.attrs.path) && WEB_IMAGE.test(n.attrs.path)) {
      tr.setNodeMarkup(pos, null, { ...n.attrs, src: blobURL(assets.get(n.attrs.path), n.attrs.path) });
    }
  });
  if (tr.docChanged) {
    const unchanged = view.state.doc.eq(loadedDoc);
    view.dispatch(tr.setMeta('addToHistory', false));
    if (unchanged) loadedDoc = view.state.doc;
  }
}
// 5.x plots: drawn again from their settings (plots.js); the points come from the
// engine. The picture is kept as PNG (for TeX and .sci) and shown as SVG.
async function renderPlots() {
  const todo = [];
  view.state.doc.descendants((n) => { if (n.type.name === 'image' && n.attrs.plot && n.attrs.frame && !n.attrs.src) todo.push(n.attrs); });
  for (const a of todo) {
    if (assets.has(a.path)) continue;
    const plot = parsePlot(a.frame.slice(a.frame.indexOf('\\special')));
    if (!drawable(plot)) continue;
    const kind = plotKind(plot);
    let data;
    try { data = await plotData(plot); } catch (e) { console.warn(_t('Could not compute the plot: '), e.message); continue; }
    const w = a.width || 432;
    const h = a.height || 288;
    const svg = new TextEncoder().encode(is3D(kind) ? plotSVG3D(plot, data, w, h) : plotSVG(plot, data, w, h));
    let png;
    try { png = await toPng(svg, 'plot.svg', 3); } catch (e) { continue; }
    assets.set(a.path, png);
    const src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const tr = view.state.tr;
    view.state.doc.descendants((n, pos) => {
      if (n.type.name === 'image' && n.attrs.path === a.path && !n.attrs.src) tr.setNodeMarkup(pos, null, { ...n.attrs, src });
    });
    const unchanged = view.state.doc.eq(loadedDoc);
    view.dispatch(tr.setMeta('addToHistory', false));
    if (unchanged) loadedDoc = view.state.doc;
  }
}
const isPng = (b) => b && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

// File > Import Picture: the picture goes in at its own size (at most the text width)
async function importPicture(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let path = file.name;
  for (let k = 2; assets.has(path) && !sameBytes(assets.get(path), bytes); k++) path = file.name.replace(/(\.[^.]*)?$/, `-${k}$1`);
  assets.set(path, bytes);
  const src = blobURL(bytes, path);
  const img = new Image();
  img.src = src;
  try { await img.decode(); } catch (e) { toast(_t('Could not read this picture')); return; }
  const scale = Math.min(1, 624 / img.naturalWidth); // 6.5in of text
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const node = schema.nodes.image.create({ src, path, width, height, texw: (width / 96).toFixed(4) + 'in', texh: (height / 96).toFixed(4) + 'in' });
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  view.focus();
}
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
function pickPicture() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/bmp,image/svg+xml,image/webp';
  input.onchange = () => { if (input.files[0]) importPicture(input.files[0]); };
  input.click();
}
// files for a TeX run: Map(path -> name) for toLatex, and [{ name, data }] to write.
// Pictures TeX cannot read (gif, svg, webp) go as PNG.
async function texPictureFiles() {
  const names = new Map();
  const list = [];
  const used = imagePaths();
  for (const [path, bytes] of assets) {
    if (!used.has(path)) continue;
    // a name relative to the .tex: absolute paths and ".." lose their folders
    let name = /^([a-zA-Z]:|[\\/])|(^|[\\/])\.\.([\\/]|$)/.test(path) ? path.split(/[\\/]/).pop() : path.replace(/\\/g, '/');
    let data = bytes;
    if (!TEX_IMAGE.test(path) && isPng(bytes)) name += '.png'; // a 5.x plot, drawn here as PNG
    else if (!TEX_IMAGE.test(path)) {
      if (!WEB_IMAGE.test(path)) continue; // e.g. a 5.x plot snapshot (.wmf)
      try { data = await toPng(bytes, path); } catch (e) { continue; }
      name += '.png';
    }
    names.set(path, name);
    list.push({ name, data });
  }
  for (const [name, data] of subFiles) list.push({ name, data });
  return { names, list };
}
async function toPng(bytes, path, scale = 1) {
  const img = new Image();
  img.src = blobURL(bytes, path);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.round((img.naturalWidth || 300) * scale);
  c.height = Math.round((img.naturalHeight || 150) * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
window.swPictures = { texPictureFiles, importPicture, loadPictures, renderPlots }; // for tests
Object.defineProperty(window.swPictures, 'assets', { get: () => assets });

// ---------- save as .sci ----------
async function sciBytes() {
  let src = source;
  if (!src) src = blankSci(); // a new document
  const files = new Map([...assets].filter(([p]) => imagePaths().has(p)));
  return writeSci(view.state.doc, src.zip, src.headXML, files);
}
window.JSZipForTests = JSZip;
window.swSaveSci = async () => { // for tests
  const bytes = await sciBytes();
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
// asNew: File > Save As (always asks where)
// File > Save: a 5.x .tex is the main format (Scientific Word 5.5 opens it); a document
// opened from a .sci is saved as .sci again. asNew: true = Save As (.tex), 'sci' = Save As .sci.
// The old file is kept as .bak first. An unchanged 5.x document is not written again.
// the open file is LaTeX that 5.x did not write: saving over it would replace the author's file
const latexKept = (target) => !!target && /\.tex$/i.test(target) && target === currentPath && original55?.is5x === false;
async function save(asNew = false) {
  if (inFrame) { toast(_t('The demo page cannot download files; saving needs the desktop app')); return false; }
  const kind = asNew === 'sci' || (!asNew && currentPath && /\.sci$/i.test(currentPath)) ? 'sci' : 'tex';
  try {
    const target = asNew || latexKept(currentPath) ? null : currentPath;
    const path = await writeDocument(kind, target);
    if (!path) return false;
    toast(path === true ? _t('No changes; the file is as it was') : _t('Saved: ') + path);
    return true;
  } catch (err) { toast(_t('Could not save: ') + (err.message || err)); return false; }
}
// writes the document as kind ('tex' or 'sci') to target (null: ask, or download in the
// web page) -> the path written, true when nothing needed writing, null when cancelled
async function writeDocument(kind, target) {
  if (kind === 'sci') {
    const bytes = await sciBytes();
    const name = (meta.name || 'document') + '.sci';
    if (!isDesktop) { download(new Blob([bytes], { type: 'application/zip' }), name); loadedDoc = view.state.doc; return name; }
    if (target && settings().backup) await backupFile(target);
    const path = await writeBytes(bytes, target, name);
    if (!path) return null;
    currentPath = path;
    original55 = null;
    meta.name = path.split(/[\\/]/).pop().replace(/\.sci$/i, '');
    loadedDoc = view.state.doc;
    return path;
  }
  // an unchanged 5.x file is copied as it was; an edited one keeps the parts nobody edited
  // as they were in the file; other LaTeX is always written for 5.x
  const unchanged = original55 && original55.is5x !== false && view.state.doc.eq(loadedDoc) && !preambleEdited();
  if (unchanged && target && target === currentPath) return true;
  let text, bytes, spans = null;
  if (unchanged) ({ text, bytes, spans } = original55);
  else {
    const p = original55?.is5x !== false ? patchTex55(original55?.spans, loadedDoc, view.state.doc, meta) : null;
    text = p ? p.text : toTex55File(view.state.doc, meta);
    spans = p?.spans || null;
    // the code page line, when the file did not have one (it goes before \begin{document})
    const full = withCodepage55(text, meta);
    if (spans && full.length !== text.length) {
      const d = full.length - text.length;
      spans = { ...spans, text: full, head: spans.head + d, segs: spans.segs.map((g) => ({ to: g.to + d, n: g.n })) };
    }
    text = full;
    if (!spans) { // written whole: its parts, for the next save (when they read back as the same blocks)
      const r = readLatex(text);
      const doc = view.state.doc;
      if (r.doc.childCount === doc.childCount && r.doc.content.content.every((n, i) => n.type === doc.child(i).type)) spans = r.spans55;
    }
    bytes = encodeFile55(text, meta);
    // a file with \n line ends (not 5.x's \r\n) keeps them (a Big5 trail byte is never \r)
    if (original55?.bytes?.length && !original55.bytes.includes(13)) bytes = bytes.filter((x) => x !== 13);
  }
  const name = (meta.name || 'document') + '.tex';
  if (!isDesktop) { download(new Blob([bytes], { type: 'application/x-tex' }), name); loadedDoc = view.state.doc; return name; }
  if (target && settings().backup) await backupFile(target);
  const path = await writeBytes(bytes, target, name, TEX55_FILTERS);
  if (!path) return null;
  currentPath = path;
  original55 = { bytes, text, is5x: true, spans };
  meta.name = path.split(/[\\/]/).pop().replace(/\.(tex|qiz)$/i, '');
  loadedDoc = view.state.doc;
  showTitle();
  return path;
}
const TEX55_FILTERS = [{ name: _t('Scientific Word 5.x (.tex)'), extensions: ['tex'] }];
// File > Export as HTML: one page with the pictures inside it
function base64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function htmlText() {
  const pics = new Map();
  for (const [p, bytes] of assets) pics.set(p, `data:${isPng(bytes) ? 'image/png' : mimeOf(p)};base64,${base64(bytes)}`);
  return toHtml(view.state.doc, meta, pics, { math: settings().htmlMath });
}
async function exportHtml() {
  if (inFrame) { toast(_t('The demo page cannot download files; saving needs the desktop app')); return; }
  try {
    const bytes = new TextEncoder().encode(htmlText());
    const name = (meta.name || 'document') + '.html';
    if (!isDesktop) { download(new Blob([bytes], { type: 'text/html' }), name); return; }
    const path = await writeBytes(bytes, null, name, [{ name: 'HTML', extensions: ['html'] }]);
    if (path) toast(_t('Exported: ') + path);
  } catch (err) { toast(_t('Could not export: ') + (err.message || err)); }
}
window.swHtmlForTests = htmlText;

// File > Open Location: a document at a web address (.tex, .sci, or "address as .tex" for one
// without that ending, as in 5.5) opens in the editor; any other address opens in the browser
const URLS_KEY = 'opensw-urls';
const recentUrls = () => { try { return JSON.parse(localStorage.getItem(URLS_KEY) || '[]'); } catch (e) { return []; } };
async function openUrl(input) {
  const m = String(input).trim().match(/^(\S+?)(?:\s+as\s+\.?(tex|sci|qiz|rap))?$/i);
  if (!m || !/^https?:\/\//i.test(m[1])) { toast(_t('The address must start with http:// or https://')); return; }
  const url = m[1];
  try { localStorage.setItem(URLS_KEY, JSON.stringify([url, ...recentUrls().filter((u) => u !== url)].slice(0, 10))); } catch (e) { /* storage off */ }
  const file = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || '') || 'document';
  const ext = (m[2] || (file.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
  if (!['tex', 'sci', 'qiz', 'rap'].includes(ext)) {
    if (isDesktop) { const { openUrl: open } = await import('@tauri-apps/plugin-opener'); await open(url); } else window.open(url, '_blank', 'noopener');
    return;
  }
  toast(_t('Downloading…'));
  let bytes;
  try {
    if (isDesktop) bytes = await fetchUrl(url);
    else {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      bytes = await r.arrayBuffer();
    }
  } catch (err) { toast(_t('Could not read this address: ') + (err.message || err) + (isDesktop ? '' : _t('(the site may not allow web pages to read it; the desktop app can)'))); return; }
  // a .qiz (exam) or .rap file is a 5.x document too
  confirmReplace(() => openBytes(bytes, file.replace(/\.[^.]*$/, '') + (ext === 'sci' ? '.sci' : '.tex'), null));
}

// File > Page Setup (kept on this computer) and File > Preview: the document as on screen,
// on pages with these margins, header, footer and page number, in the system's print preview
// (from there it can be printed or saved as PDF). Typeset > PDF is the typeset version.
const PAGE_KEY = 'opensw-page-setup';
const PAGE_DEFAULT = { top: 1, bottom: 1, left: 1, right: 1, header: '', footer: '', number: 'bottom-center', style: 'decimal' };
function pageSetup() {
  try { return { ...PAGE_DEFAULT, ...JSON.parse(localStorage.getItem(PAGE_KEY) || '{}') }; } catch (e) { return { ...PAGE_DEFAULT }; }
}
function setPageSetup(p) { try { localStorage.setItem(PAGE_KEY, JSON.stringify(p)); } catch (e) { /* storage off */ } }
function printHtml() {
  const p = pageSetup();
  const str = (t) => `"${String(t).replace(/["\\]/g, '\\$&').replace(/\n/g, ' ')}"`;
  // what each margin box shows: the header (top centre), the footer (bottom centre), the page number
  const boxes = {};
  if (p.header) boxes['top-center'] = str(p.header);
  if (p.footer) boxes['bottom-center'] = str(p.footer);
  if (p.number !== 'none') boxes[p.number] = (boxes[p.number] ? boxes[p.number] + ' "  " ' : '') + `counter(page, ${p.style})`;
  const css = `@page { size: letter; margin: ${+p.top}in ${+p.right}in ${+p.bottom}in ${+p.left}in;`
    + Object.entries(boxes).map(([k, v]) => ` @${k} { content: ${v}; font: 11pt "Times New Roman", serif; }`).join('') + ' }\n'
    + '@media print { body { max-width: none; margin: 0; padding: 0; } }\n';
  return htmlText().replace('</style>', css + '</style>');
}
function preview() {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-10px';
  frame.srcdoc = printHtml();
  frame.onload = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1000);
  };
  document.body.append(frame);
}
window.swPrintHtmlForTests = printHtml;

// Tools > Document Manager: the files that belong to the document; a package of them (a .zip
// with the document as .sci and as 5.x .tex, and its pictures and subdocuments); opening a
// package, or a file 5.5 wrapped (.rap: the files one after another as text)
function docFiles() {
  const list = [];
  view.state.doc.descendants((n) => {
    if (n.type.name === 'image' && n.attrs.path) list.push({ path: n.attrs.path, kind: n.attrs.plot ? _t('Plot') : _t('Picture'), found: assets.has(n.attrs.path) });
    if (n.type.name === 'subdoc' && n.attrs.file) {
      const name = /\.[a-z]+$/i.test(n.attrs.file) ? n.attrs.file : n.attrs.file + '.tex';
      list.push({ path: name, kind: _t('Subdocument'), found: subFiles.has(name.replace(/\\/g, '/')) });
    }
  });
  return list;
}
async function packDoc() {
  const name = (meta.name || 'document').replace(/[\\/:*?"<>|]/g, '_');
  const zip = new JSZip();
  zip.file(name + '.sci', await sciBytes());
  const t = toTex55File(view.state.doc, meta);
  zip.file(name + '.tex', encodeFile55(t, meta));
  const used = imagePaths();
  for (const [path, bytes] of assets) {
    if (!used.has(path)) continue;
    // as the .tex names it, relative to the document (an absolute path keeps only the name)
    zip.file(/^([a-zA-Z]:|[\\/])|(^|[\\/])\.\.([\\/]|$)/.test(path) ? path.split(/[\\/]/).pop() : path.replace(/\\/g, '/'), bytes);
  }
  for (const [file, bytes] of subFiles) zip.file(file, bytes);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  if (!isDesktop) { download(new Blob([bytes], { type: 'application/zip' }), name + '.zip'); return; }
  const path = await writeBytes(bytes, null, name + '.zip', [{ name: 'ZIP', extensions: ['zip'] }]);
  if (path) toast(_t('Packed: ') + path);
}
// a 5.5 wrapped file -> name -> text (text files, as they were) or bytes (pictures); pictures were written as
// text for e-mail: uuencoded, base64 or hex is turned back into bytes (others are left out)
function unwrapRap(text) {
  const files = new Map();
  const types = new Map([...text.matchAll(/^% "\/document\/([^"]+)", (\w+),/gm)].map((m) => [m[1], m[2]]));
  const re = /^%+ Start \/document\/(.+?) %+\r?\n([^]*?)\r?\n%+ End \/document\/\1 %+\s*$/gm;
  for (const m of text.matchAll(re)) {
    const [, name, body] = m;
    const type = types.get(name) || 'Document';
    if (!/^(Graphic|PastedPict|PlotPict)$/i.test(type)) { files.set(name, body.replace(/^\n+/, '')); continue; }
    const s = body.trim();
    let bytes = null;
    try {
      if (/^begin \d+ /.test(s)) bytes = uudecode(s);
      else if (/^[0-9a-fA-F\s]+$/.test(s)) bytes = Uint8Array.from(s.replace(/\s+/g, '').match(/../g).map((h) => parseInt(h, 16)));
      else if (/^[A-Za-z0-9+/=\s]+$/.test(s)) bytes = Uint8Array.from(atob(s.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    } catch (e) { bytes = null; }
    if (bytes) files.set(name, bytes);
  }
  return files;
}
function uudecode(s) {
  const out = [];
  for (const line of s.split(/\r?\n/).slice(1)) {
    if (/^end/.test(line)) break;
    const n = (line.charCodeAt(0) - 32) & 63;
    const q = [];
    for (let i = 1; i < line.length; i++) q.push((line.charCodeAt(i) - 32) & 63);
    for (let i = 0, k = 0; k < n; i += 4) {
      const [a, b, c, d] = [q[i] || 0, q[i + 1] || 0, q[i + 2] || 0, q[i + 3] || 0];
      for (const v of [(a << 2) | (b >> 4), ((b & 15) << 4) | (c >> 2), ((c & 3) << 6) | d]) if (k++ < n) out.push(v & 255);
    }
  }
  return Uint8Array.from(out);
}
async function openPackage(bytes, fileName) {
  let files;
  if (/\.rap$/i.test(fileName)) files = unwrapRap(decode55(new Uint8Array(bytes)));
  else {
    const zip = await JSZip.loadAsync(bytes);
    files = new Map();
    for (const f of Object.values(zip.files)) if (!f.dir) files.set(f.name, await f.async('uint8array'));
  }
  const names = [...files.keys()];
  const doc = names.find((n) => /\.sci$/i.test(n)) || names.find((n) => /\.(tex|qiz)$/i.test(n) && !/[\\/]/.test(n)) || names.find((n) => /\.(tex|qiz)$/i.test(n));
  if (!doc) { toast(_t('The package has no document (.sci or .tex)')); return; }
  const docName = doc.split('/').pop();
  if (/\.sci$/i.test(doc)) { await openBytes(files.get(doc).buffer, docName, null); return; }
  const content = files.get(doc);
  const r = typeof content === 'string' ? readLatex(content) : readTex55(content);
  setDoc(r.doc, { ...r.meta, name: docName.replace(/\.(tex|qiz)$/i, '') }, null, null);
  for (const [n, b] of files) if (n !== doc && /\.(tex|bib)$/i.test(n)) subFiles.set(n, typeof b === 'string' ? new TextEncoder().encode(b) : b);
  await loadPictures(null, files);
  const missing = docFiles().filter((f) => !f.found && f.kind === _t('Picture')).length;
  toast(_t('Opened {0} (from the package)', docName) + (missing ? _t(', {0} pictures were not found in the package', missing) : ''));
  renderPlots();
}

// File > Save Fragment: the selection as a piece of a 5.x document (what 5.5 keeps in a .frg file)
function selectionTex55() {
  const { from, to, empty } = view.state.selection;
  if (empty) return null;
  let content = view.state.doc.slice(from, to).content;
  if (content.firstChild?.isInline) content = Fragment.from(schema.nodes.paragraph.create(null, content));
  let doc;
  try { doc = schema.nodes.doc.create(null, content); doc.check(); } catch (e) {
    doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text(view.state.doc.textBetween(from, to, ' ') || ' ')));
  }
  const tex = toTex55File(doc, {});
  return tex.slice(tex.indexOf('\\begin{document}') + '\\begin{document}'.length, tex.lastIndexOf('\\end{document}')).trim();
}
// File > Export as Word (the docx library is loaded only when asked for)
async function docxBytes() {
  const { toDocx } = await import('./docx.js');
  return toDocx(view.state.doc, meta, assets);
}
async function exportDocx() {
  if (inFrame) { toast(_t('The demo page cannot download files; saving needs the desktop app')); return; }
  try {
    const bytes = await docxBytes();
    const name = (meta.name || 'document') + '.docx';
    if (!isDesktop) { download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), name); return; }
    const path = await writeBytes(bytes, null, name, [{ name: 'Word', extensions: ['docx'] }]);
    if (path) toast(_t('Exported: ') + path);
  } catch (err) { toast(_t('Could not export: ') + (err.message || err)); }
}
window.swDocxForTests = async () => base64(await docxBytes());
window.swTex55ForTests = () => { const t = toTex55File(view.state.doc, meta); return Array.from(encodeFile55(t, meta)); };

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

// opening another document: it gets a window of its own, the current one stays in the Window menu
let loadedDoc = view.state.doc;
function confirmReplace(action) {
  opening = true;
  const r = action();
  // the action may finish later (reading a file); a cancelled one opens nothing
  Promise.resolve(r).finally(() => setTimeout(() => { opening = false; }, 0));
}

// ---------- export ----------
// the pictures go next to the saved .tex (desktop app)
const exportLatex = async () => {
  const pics = await texPictureFiles();
  showExport('LaTeX', toLatex(view.state.doc, meta, { files: pics.names }), (meta.name || 'document') + '.tex', pics.list);
};
const exportMd = () => showExport(_t('Markdown (for AI)'), toMarkdown(view.state.doc), (meta.name || 'document') + '.md');

function showExport(title, text, filename, files = []) {
  $('#export-title').textContent = title;
  $('#export-text').value = text;
  $('#export').hidden = false;
  $('#export-download').onclick = async () => {
    if (!isDesktop) { download(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename); return; }
    try {
      const ext = filename.split('.').pop();
      const path = await writeBytes(new TextEncoder().encode(text), null, filename, [{ name: ext.toUpperCase(), extensions: [ext] }]);
      if (!path) return;
      const dir = path.replace(/[\\/][^\\/]*$/, '');
      const sep = path.includes('\\') ? '\\' : '/';
      for (const f of files) await writeBytes(f.data, dir + sep + f.name.replace(/\//g, sep), null);
      toast(_t('Saved: ') + path + (files.length ? _t(' (and {0} picture files)', files.length) : ''));
    } catch (err) { toast(_t('Could not save: ') + err); }
  };
  $('#export-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast(_t('Copied')); }
    catch (e) { $('#export-text').select(); document.execCommand('copy'); toast(_t('Copied')); }
  };
}
// inside the claude.ai preview frame downloads are blocked: offer Copy only
const inFrame = window.self !== window.top;
if (inFrame) $('#export-download').hidden = true;
$('#export-close').onclick = () => { $('#export').hidden = true; };

// ---------- zoom (the desktop app has no browser zoom of its own) ----------
const ZOOM_KEY = 'sw-next-zoom';
const ZOOMS = [0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
let zoom = 1;
try { zoom = Number(localStorage.getItem(ZOOM_KEY)) || 1; } catch (e) { /* storage unavailable */ }
function setZoom(z) {
  zoom = Math.min(3, Math.max(0.67, z));
  document.documentElement.style.setProperty('--zoom', zoom);
  $('#status-zoom').textContent = Math.round(zoom * 100) + '%';
  const sel = $('#zoom-select');
  if (sel) { if (![...sel.options].some((o) => +o.value === zoom)) sel.append(new Option(Math.round(zoom * 100) + '%', zoom)); sel.value = String(zoom); }
  try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch (e) { /* storage unavailable */ }
}
const zoomStep = (dir) => setZoom(dir > 0 ? (ZOOMS.find((z) => z > zoom + 0.001) ?? 3) : ([...ZOOMS].reverse().find((z) => z < zoom - 0.001) ?? 0.67));

// ---------- typeset PDF (desktop app only) ----------
// an unchanged 5.x document: its own text (so the pages are 5.5's); otherwise written from the editor
// (an edited one: the file's text with only the edited parts written again, as saving does)
function texForTypesetting(pics) {
  let own = null;
  if (original55 && view.state.doc.eq(loadedDoc) && !preambleEdited()) own = originalTex55(original55.text, { files: pics.names });
  else if (original55?.is5x !== false) {
    const p = patchTex55(original55?.spans, loadedDoc, view.state.doc, meta);
    if (p) own = originalTex55(p.text, { files: pics.names });
  }
  return own ?? toLatex(view.state.doc, meta, { files: pics.names });
}
// Typeset > Preamble changed the preamble of the file that was opened
const preambleEdited = () => !!original55?.spans && meta.preamble55raw != null && meta.preamble55raw !== original55.spans.preamble;
window.swTypesetTexForTests = () => texForTypesetting({ names: new Map(), list: [] });
let typesetting = false;
async function pdf() {
  if (typesetting) return;
  typesetting = true;
  toast(_t('Typesetting…'));
  try {
    const pics = await texPictureFiles();
    const { errors } = await typeset(texForTypesetting(pics), meta.name || 'document', pics.list);
    if (errors.length) showExport(_t('PDF opened, but TeX reported {0} errors; those parts may look wrong', errors.length), errors.join('\n'), 'typeset-errors.txt');
    else toast(_t('PDF opened'));
  } catch (err) {
    showExport(_t('Typesetting failed'), String(err), 'typeset-log.txt');
  } finally { typesetting = false; }
}

// ---------- the Scientific Word 5.5 menus, toolbars, tag bar and keys ----------
ui = setupUI({
  view, toast, save, exportLatex, exportMd, zoomStep, setZoom, ZOOMS,
  open: openDialog,
  importPicture: pickPicture,
  saveAsSci: () => save('sci'),
  recent: recentMenu,
  path: () => currentPath,
  // Tools > Document Manager moved or deleted the file (null: the document is on screen only)
  setPath: (p) => { currentPath = p; if (p) meta.name = p.split(/[\\/]/).pop().replace(/\.(tex|qiz|sci)$/i, ''); showTitle(); },
  saveAs: () => save(true),
  meta: () => meta,
  setMeta: (m) => { meta = m; scheduleSave(); },
  renderPlots: () => renderPlots(),
  forgetPicture: (p) => assets.delete(p),
  exportHtml,
  exportDocx,
  openUrl,
  recentUrls,
  pageSetup,
  setPageSetup,
  preview,
  selectionTex55,
  docFiles,
  packDoc,
  openPackage: (bytes, name) => confirmReplace(() => openPackage(bytes, name).catch((err) => toast(_t('Could not open the package: ') + (err.message || err)))),
  // a document made here (Tools > Exam Builder) opens in a window of its own
  newDocument: (doc, m) => { opening = true; setDoc(doc, m); },
  pdf: isDesktop ? pdf : null,
  newDoc: () => confirmReplace(() => openSample('blank')),
  closeDoc,
  windows: windowMenu,
  refreshWindows: refreshWindowMenu,
  samples: [['demo', _t('Getting started')], ['blank', _t('Blank document')], ...SAMPLES.map((s) => [s.id, s.label])],
  openSample: (id) => confirmReplace(() => openSample(id)),
  help: () => { $('#help').hidden = !$('#help').hidden; },
  undoAi: undoAiChanges,
});
setZoom(zoom);
ui.refresh();
applySettings();

// ---------- commands for AI agents (window.sw; the desktop app's MCP uses the same) ----------
window.sw = makeApi({
  view,
  meta: () => meta,
  path: () => currentPath,
  setDoc: (doc, m) => { aiSetting = true; try { setDoc(doc, m, source, currentPath); } finally { aiSetting = false; } },
  aiStart: () => aiStart(view.state.doc, meta),
  aiHome: isDesktop ? aiHome : null,
  openPath: async (path) => {
    if (!isDesktop) throw new Error(_t('The web version cannot open files by path; give LaTeX with set'));
    const bytes = await readPath(path);
    await openBytes(bytes, path.split(/[\\/]/).pop(), path);
  },
  saveTo: async (path) => {
    if (!isDesktop) throw new Error(_t('The web version cannot save to a path'));
    if (!path && latexKept(currentPath)) throw new Error(_t('This is a LaTeX file 5.x did not write: give a new path, so it is kept as it is'));
    const target = path || currentPath;
    if (!target) throw new Error(_t('Give a path (the .tex file to save to; ending in .sci saves a .sci)'));
    const written = await writeDocument(/\.sci$/i.test(target) ? 'sci' : 'tex', target);
    return written === true ? target : written;
  },
  // an AI asks to open or save outside the allowed folders (api.js): the user decides;
  // no answer within 4 minutes is no (the AI app stops waiting after 5)
  askAllow: (path, action) => new Promise((resolve) => {
    $('#dialog-title').textContent = action === 'save' ? _t('AI wants to save to this file') : _t('AI wants to open this file');
    $('#dialog-body').innerHTML = '<p></p><p></p>';
    const [where, how] = $('#dialog-body').querySelectorAll('p');
    where.textContent = path;
    how.textContent = _t('It is not in the open document\'s folder nor in a folder allowed for AI in Tools > User Setup. OK allows it this once.');
    $('#dialog').hidden = false;
    const done = (yes) => { clearTimeout(timer); $('#dialog').hidden = true; resolve(yes); };
    const timer = setTimeout(() => done(false), 240000);
    $('#dialog-cancel').onclick = () => done(false);
    $('#dialog-ok').onclick = () => done(true);
    $('#dialog-body').onkeydown = null;
    $('#dialog-ok').focus();
  }),
  typesetNow: async () => {
    if (!isDesktop) throw new Error(_t('The web version cannot typeset; get the LaTeX with get'));
    const pics = await texPictureFiles();
    return typeset(texForTypesetting(pics), meta.name || 'document', pics.list);
  },
});
// closing the window with unsaved changes asks first: save, discard, or stay
if (isDesktop) {
  // every changed document is shown and asked about in turn
  const askOne = () => new Promise((resolve) => {
    $('#closeask').hidden = false;
    const done = (v) => { $('#closeask').hidden = true; resolve(v); };
    $('#closeask-cancel').onclick = () => done('cancel');
    $('#closeask-discard').onclick = () => done('discard');
    $('#closeask-save').onclick = async () => done((await save()) ? 'saved' : 'cancel');
  });
  onCloseWindow(async () => {
    const skipped = new Set();
    for (;;) {
      if (!view.state.doc.eq(loadedDoc) && !skipped.has(view.state)) {
        const a = await askOne();
        if (a === 'cancel') return false;
        if (a === 'discard') skipped.add(view.state);
        continue;
      }
      const i = others.findIndex((r) => !r.state.doc.eq(r.loadedDoc) && !skipped.has(r.state));
      if (i < 0) return true;
      switchTo(i);
    }
  }).catch((e) => console.error(_t('Asking before closing is not set up: '), e));
}
if (isDesktop) setTimeout(preloadEngine, 3000);
// opened by double-clicking a document: show it
if (isDesktop) {
  startupPath().then(async (p) => {
    if (p) await openBytes(await readPath(p), p.split(/[\\/]/).pop(), p);
  }).catch((e) => toast(_t('Could not open: ') + e));
} // the engine is a local file in the desktop app
if (isDesktop) serveApi((cmd, args) => window.sw.call(cmd, args)).catch((e) => console.error(_t('The AI control channel is not open: '), e));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 2500);
}

// ---------- starting document ----------
function demoDoc() {
  const t = (s, marks) => schema.text(s, marks);
  const m = (latex) => schema.nodes.math_inline.create({ latex });
  const p = (...c) => schema.nodes.paragraph.create(null, c);
  const bold = [schema.marks.bold.create()];
  return schema.nodes.doc.create(null, [
    schema.nodes.title.create(null, [t(_t('Try opensw'))]),
    p(t(_t('You can type on this page. Press ')), t(mod + '+M', bold), t(_t(' (or type ')), t('$', bold), t(_t(') to start typing math, for example ')),
      m('x^2+y^2=r^2'), t(_t('. In a formula, move with the arrow keys; at the edge you are back in the text.'))),
    p(t(_t('Type ')), t('x^2', bold), t(_t(' for a superscript, ')), t('/', bold), t(_t(' for a fraction, ')), t('\\alpha', bold),
      t(_t(' or ')), t('sqrt', bold), t(_t(' for a symbol, for example ')), m('\\frac{a}{b}+\\sqrt{2}+\\alpha'), t(_t('.'))),
    schema.nodes.heading.create({ level: 2 }, [t(_t('Theorems and displayed formulas'))]),
    schema.nodes.env.create({ kind: 'theorem' }, [
      p(t(_t('(Pythagoras) The legs ')), m('a,b'), t(_t(' and hypotenuse ')), m('c'), t(_t(' of a right triangle satisfy'))),
    ]),
    schema.nodes.math_display.create({ latex: 'a^2+b^2=c^2' }),
    schema.nodes.env.create({ kind: 'proof' }, [p(t(_t('Arrange four congruent triangles into a square and compare the areas.')))]),
    p(t(_t('Matrices too: ')), m('A=\\begin{pmatrix}1 & 2\\\\ 3 & 4\\end{pmatrix}'), t(_t(', determinant ')), m('\\det A=-2'), t(_t('.'))),
    p(t(_t('File > Samples opens Scientific Word .sci files; File > Export turns the document into LaTeX, or Markdown for AI. The shortcuts are those of Scientific Word 5.5; press F1 to see them all.'))),
  ]);
}
