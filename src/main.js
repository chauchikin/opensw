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
import { toLatex, toMarkdown, toTex55File, originalTex55 } from './export.js';
import { encodeFile55 } from './tex55file.js';
import { toHtml } from './html.js';
import { writeSci, sciMathML, blankSci } from './sciwriter.js';
import { readLatex } from './tex55.js';
import { SAMPLES } from './samples.js';
import JSZip from 'jszip';
import { isDesktop, pickAndRead, readPath, writeBytes, typeset, serveApi, onCloseWindow, backupFile, startupPath, fetchUrl } from './desktop.js';
import { setupUI } from './ui55.js';
import { settings, applySettings } from './settings.js';
import { makeApi } from './api.js';
import { numberingPlugin } from './numbering.js';
import { preloadEngine, plotPoints } from './compute.js';
import { parsePlot, drawable, plotSVG, plotSVG3D, plotKind, is3D } from './plots.js';
import { plotData } from './plotdata.js';
import { candidates, TEX_IMAGE, WEB_IMAGE, mimeOf } from './graphics.js';
import './style.css';
import { _t, translatePage } from './i18n.js';

translatePage();

const STORE = 'sw-next-doc-v1';
let meta = {};
// the .sci file the document came from: its other files and <head> are kept on save
let source = null; // { zip, headXML }
let currentPath = null; // desktop app: where the document was opened from / saved to
// a document opened from (or last saved as) a 5.x .tex: its text as on disk. While the
// document is unchanged (doc eq loadedDoc) it is typeset from this text and saving
// leaves the file alone, so 5.5's own layout is kept exactly.
let original55 = null; // { bytes, text }
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
    plugins: [inputRules({ rules: [dollarRule] }), keymap(mathKeys), keymap(keys), keymap(baseKeymap), history(), tableEditing(), numberingPlugin(() => meta)],
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
    view.updateState(view.state.apply(tr));
    if (tr.docChanged) { scheduleSave(); showTitle(); }
    ui?.refresh();
  },
});
window.swEditor = view; // for tests
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

function setDoc(doc, m = {}, src = null, path = null) {
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
const docName = (m, path) => m.name || (path ? path.split(/[\\/]/).pop() : _t('未命名'));
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
  windowMenu.push('-', [_t('下一個文件'), 'Ctrl+F6', nextWindow]);
}
// File > Close: the document on screen goes (asking first if it was changed)
function closeDoc() {
  const close = () => {
    if (others.length) { showRecord(others.pop()); return; }
    opening = false;
    setDoc(schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]));
  };
  if (view.state.doc.eq(loadedDoc)) { close(); return; }
  $('#confirm-text').textContent = _t('這份文件改過還沒存，關掉的話改的內容會不見。要關嗎？');
  $('#confirm-ok').textContent = _t('關閉');
  $('#confirm').hidden = false;
  $('#confirm-ok').onclick = () => { $('#confirm').hidden = true; $('#confirm-ok').textContent = _t('取代'); close(); };
  $('#confirm-cancel').onclick = () => { $('#confirm').hidden = true; $('#confirm-ok').textContent = _t('取代'); };
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'F6' || e.key === 'Tab')) { e.preventDefault(); nextWindow(); }
}, true);

const $ = (s) => document.querySelector(s);

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
      // .tex is the main format: saving writes this file again (a .rap package gets a new .tex)
      setDoc(r.doc, { ...r.meta, name: fileName.replace(/\.(tex|qiz|rap)$/i, '') }, null, /\.(tex|qiz)$/i.test(fileName) ? path : null);
      if (!/\.rap$/i.test(fileName)) original55 = { bytes: raw, text };
      toast(_t('已開啟 {0}（Scientific Word 5 文件）', fileName) + keptAsTeX());
      // its pictures are files next to it (only the desktop app can read them)
      await loadPictures(path ? path.replace(/[\\/][^\\/]*$/, '') : null);
      renderPlots(); // needs the engine: may take a few seconds
    } catch (err) { toast(_t('開啟失敗：') + err.message); }
    return;
  }
  try {
    const r = await readSci(bytes);
    setDoc(r.doc, { ...r.meta, name: fileName.replace(/\.sci$/i, '') }, r, path);
    for (const [p, bytes] of r.files) assets.set(p, bytes);
    toast(_t('已開啟 {0}', fileName) + keptAsTeX());
  } catch (err) { toast(_t('開啟失敗：') + err.message); }
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
      try { await openBytes(await readPath(p), p.split(/[\\/]/).pop(), p); } catch (err) { toast(_t('開啟失敗：') + err); }
    })]);
  }
  if (!recentMenu.length) recentMenu.push([isDesktop ? _t('（還沒有）') : _t('（桌面版才有）'), null, null]);
}
refreshRecent();

function openDialog() {
  if (!isDesktop) { $('#file').click(); return; }
  // the desktop app uses the system's open dialog and remembers the path for saving
  confirmReplace(async () => {
    try {
      const picked = await pickAndRead();
      if (picked) await openBytes(picked.bytes, picked.path.split(/[\\/]/).pop(), picked.path);
    } catch (err) { toast(_t('開啟失敗：') + err); }
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
  return n ? _t('；有 {0} 段指令這裡不認得，原樣保留成灰底的 TeX 欄位，存檔和匯出不會掉', n) : '';
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
    try { data = await plotData(plot); } catch (e) { console.warn(_t('繪圖算不出來：'), e.message); continue; }
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
  try { await img.decode(); } catch (e) { toast(_t('讀不出這張圖片')); return; }
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
async function save(asNew = false) {
  if (inFrame) { toast(_t('試用頁不能下載檔案，桌面版才能存檔')); return false; }
  const kind = asNew === 'sci' || (!asNew && currentPath && /\.sci$/i.test(currentPath)) ? 'sci' : 'tex';
  try {
    const target = asNew ? null : currentPath;
    const path = await writeDocument(kind, target);
    if (!path) return false;
    toast(path === true ? _t('沒有改動，原檔照舊') : _t('已存檔：') + path);
    return true;
  } catch (err) { toast(_t('存檔失敗：') + (err.message || err)); return false; }
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
  const unchanged = original55 && view.state.doc.eq(loadedDoc);
  if (unchanged && target && target === currentPath) return true;
  const text = unchanged ? original55.text : toTex55File(view.state.doc, meta);
  const bytes = unchanged ? original55.bytes : encodeFile55(text, meta);
  const name = (meta.name || 'document') + '.tex';
  if (!isDesktop) { download(new Blob([bytes], { type: 'application/x-tex' }), name); loadedDoc = view.state.doc; return name; }
  if (target && settings().backup) await backupFile(target);
  const path = await writeBytes(bytes, target, name, TEX55_FILTERS);
  if (!path) return null;
  currentPath = path;
  original55 = { bytes, text };
  meta.name = path.split(/[\\/]/).pop().replace(/\.(tex|qiz)$/i, '');
  loadedDoc = view.state.doc;
  showTitle();
  return path;
}
const TEX55_FILTERS = [{ name: _t('Scientific Word 5.x（.tex）'), extensions: ['tex'] }];
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
  if (inFrame) { toast(_t('試用頁不能下載檔案，桌面版才能存檔')); return; }
  try {
    const bytes = new TextEncoder().encode(htmlText());
    const name = (meta.name || 'document') + '.html';
    if (!isDesktop) { download(new Blob([bytes], { type: 'text/html' }), name); return; }
    const path = await writeBytes(bytes, null, name, [{ name: 'HTML', extensions: ['html'] }]);
    if (path) toast(_t('已匯出：') + path);
  } catch (err) { toast(_t('匯出失敗：') + (err.message || err)); }
}
window.swHtmlForTests = htmlText;

// File > Open Location: a document at a web address (.tex, .sci, or "address as .tex" for one
// without that ending, as in 5.5) opens in the editor; any other address opens in the browser
const URLS_KEY = 'opensw-urls';
const recentUrls = () => { try { return JSON.parse(localStorage.getItem(URLS_KEY) || '[]'); } catch (e) { return []; } };
async function openUrl(input) {
  const m = String(input).trim().match(/^(\S+?)(?:\s+as\s+\.?(tex|sci|qiz|rap))?$/i);
  if (!m || !/^https?:\/\//i.test(m[1])) { toast(_t('網址要以 http:// 或 https:// 開頭')); return; }
  const url = m[1];
  try { localStorage.setItem(URLS_KEY, JSON.stringify([url, ...recentUrls().filter((u) => u !== url)].slice(0, 10))); } catch (e) { /* storage off */ }
  const file = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || '') || 'document';
  const ext = (m[2] || (file.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toLowerCase();
  if (!['tex', 'sci', 'qiz', 'rap'].includes(ext)) {
    if (isDesktop) { const { openUrl: open } = await import('@tauri-apps/plugin-opener'); await open(url); } else window.open(url, '_blank', 'noopener');
    return;
  }
  toast(_t('下載中…'));
  let bytes;
  try {
    if (isDesktop) bytes = await fetchUrl(url);
    else {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      bytes = await r.arrayBuffer();
    }
  } catch (err) { toast(_t('讀不到這個網址：') + (err.message || err) + (isDesktop ? '' : _t('（網站可能不允許網頁讀取，桌面版可以）'))); return; }
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
    if (n.type.name === 'image' && n.attrs.path) list.push({ path: n.attrs.path, kind: n.attrs.plot ? _t('繪圖') : _t('圖片'), found: assets.has(n.attrs.path) });
    if (n.type.name === 'subdoc' && n.attrs.file) {
      const name = /\.[a-z]+$/i.test(n.attrs.file) ? n.attrs.file : n.attrs.file + '.tex';
      list.push({ path: name, kind: _t('子文件'), found: subFiles.has(name.replace(/\\/g, '/')) });
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
  if (path) toast(_t('已打包：') + path);
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
  if (!doc) { toast(_t('打包檔裡沒有文件（.sci 或 .tex）')); return; }
  const docName = doc.split('/').pop();
  if (/\.sci$/i.test(doc)) { await openBytes(files.get(doc).buffer, docName, null); return; }
  const content = files.get(doc);
  const r = typeof content === 'string' ? readLatex(content) : readTex55(content);
  setDoc(r.doc, { ...r.meta, name: docName.replace(/\.(tex|qiz)$/i, '') }, null, null);
  for (const [n, b] of files) if (n !== doc && /\.(tex|bib)$/i.test(n)) subFiles.set(n, typeof b === 'string' ? new TextEncoder().encode(b) : b);
  await loadPictures(null, files);
  const missing = docFiles().filter((f) => !f.found && f.kind === _t('圖片')).length;
  toast(_t('已開啟 {0}（從打包檔）', docName) + (missing ? _t('，{0} 張圖片在打包檔裡找不到', missing) : ''));
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
  if (inFrame) { toast(_t('試用頁不能下載檔案，桌面版才能存檔')); return; }
  try {
    const bytes = await docxBytes();
    const name = (meta.name || 'document') + '.docx';
    if (!isDesktop) { download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), name); return; }
    const path = await writeBytes(bytes, null, name, [{ name: 'Word', extensions: ['docx'] }]);
    if (path) toast(_t('已匯出：') + path);
  } catch (err) { toast(_t('匯出失敗：') + (err.message || err)); }
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
const exportMd = () => showExport(_t('Markdown（給 AI 讀）'), toMarkdown(view.state.doc), (meta.name || 'document') + '.md');

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
      toast(_t('已存檔：') + path + (files.length ? _t('（和 {0} 個圖檔）', files.length) : ''));
    } catch (err) { toast(_t('存檔失敗：') + err); }
  };
  $('#export-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast(_t('已複製')); }
    catch (e) { $('#export-text').select(); document.execCommand('copy'); toast(_t('已複製')); }
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
function texForTypesetting(pics) {
  const own = original55 && view.state.doc.eq(loadedDoc) ? originalTex55(original55.text, { files: pics.names }) : null;
  return own ?? toLatex(view.state.doc, meta, { files: pics.names });
}
window.swTypesetTexForTests = () => texForTypesetting({ names: new Map(), list: [] });
let typesetting = false;
async function pdf() {
  if (typesetting) return;
  typesetting = true;
  toast(_t('排版中…'));
  try {
    const pics = await texPictureFiles();
    await typeset(texForTypesetting(pics), meta.name || 'document', pics.list);
    toast(_t('PDF 已開啟'));
  } catch (err) {
    showExport(_t('排版失敗'), String(err), 'typeset-log.txt');
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
  openPackage: (bytes, name) => confirmReplace(() => openPackage(bytes, name).catch((err) => toast(_t('打開打包檔失敗：') + (err.message || err)))),
  // a document made here (Tools > Exam Builder) opens in a window of its own
  newDocument: (doc, m) => { opening = true; setDoc(doc, m); },
  pdf: isDesktop ? pdf : null,
  newDoc: () => confirmReplace(() => openSample('blank')),
  closeDoc,
  windows: windowMenu,
  refreshWindows: refreshWindowMenu,
  samples: [['demo', _t('試用說明')], ['blank', _t('空白文件')], ...SAMPLES.map((s) => [s.id, s.label])],
  openSample: (id) => confirmReplace(() => openSample(id)),
  help: () => { $('#help').hidden = !$('#help').hidden; },
});
setZoom(zoom);
ui.refresh();
applySettings();

// ---------- commands for AI agents (window.sw; the desktop app's MCP uses the same) ----------
window.sw = makeApi({
  view,
  meta: () => meta,
  path: () => currentPath,
  setDoc: (doc, m) => setDoc(doc, m, source, currentPath),
  openPath: async (path) => {
    if (!isDesktop) throw new Error(_t('網頁版不能用路徑開檔，請用 set 給 LaTeX 內容'));
    const bytes = await readPath(path);
    await openBytes(bytes, path.split(/[\\/]/).pop(), path);
  },
  saveTo: async (path) => {
    if (!isDesktop) throw new Error(_t('網頁版不能存到路徑'));
    const target = path || currentPath;
    if (!target) throw new Error(_t('請給 path（要存成的 .tex 路徑；.sci 結尾就存成 .sci）'));
    const written = await writeDocument(/\.sci$/i.test(target) ? 'sci' : 'tex', target);
    return written === true ? target : written;
  },
  typesetNow: async () => {
    if (!isDesktop) throw new Error(_t('網頁版不能排版，請用 get 取得 LaTeX'));
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
  }).catch((e) => console.error(_t('關閉前詢問沒有設定好：'), e));
}
if (isDesktop) setTimeout(preloadEngine, 3000);
// opened by double-clicking a document: show it
if (isDesktop) {
  startupPath().then(async (p) => {
    if (p) await openBytes(await readPath(p), p.split(/[\\/]/).pop(), p);
  }).catch((e) => toast(_t('開啟失敗：') + e));
} // the engine is a local file in the desktop app
if (isDesktop) serveApi((cmd, args) => window.sw.call(cmd, args)).catch((e) => console.error(_t('AI 控制通道沒有開：'), e));

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
    schema.nodes.title.create(null, [t(_t('opensw 試用'))]),
    p(t(_t('這一頁可以直接打字。按 ')), t(mod + '+M', bold), t(_t('（或打 ')), t('$', bold), t(_t('）開始輸入數學，例如 ')),
      m('x^2+y^2=r^2'), t(_t('。在公式裡用方向鍵移動，走到邊緣會自動回到文字。'))),
    p(t(_t('打 ')), t('x^2', bold), t(_t(' 會變成上標，打 ')), t('/', bold), t(_t(' 會變成分數，打 ')), t('\\alpha', bold),
      t(_t(' 或 ')), t('sqrt', bold), t(_t(' 會變成符號，例如 ')), m('\\frac{a}{b}+\\sqrt{2}+\\alpha'), t(_t('。'))),
    schema.nodes.heading.create({ level: 2 }, [t(_t('定理與獨立公式'))]),
    schema.nodes.env.create({ kind: 'theorem' }, [
      p(t(_t('（畢氏定理）直角三角形的兩股 ')), m('a,b'), t(_t(' 和斜邊 ')), m('c'), t(_t(' 滿足'))),
    ]),
    schema.nodes.math_display.create({ latex: 'a^2+b^2=c^2' }),
    schema.nodes.env.create({ kind: 'proof' }, [p(t(_t('把四個全等三角形排成正方形，比較面積即得。')))]),
    p(t(_t('矩陣也可以：')), m('A=\\begin{pmatrix}1 & 2\\\\ 3 & 4\\end{pmatrix}'), t(_t('，行列式 ')), m('\\det A=-2'), t(_t('。'))),
    p(t(_t('「檔案 > 範例」可以打開 Scientific Word 的 .sci 檔；「檔案 > 匯出」可以轉成 LaTeX 或給 AI 讀的 Markdown。快捷鍵跟 Scientific Word 5.5 一樣，按 F1 看全部。'))),
  ]);
}
