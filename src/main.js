import 'mathlive';
import { EditorState, NodeSelection } from 'prosemirror-state';
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
import { readTex55 } from './tex55.js';
import { toLatex, toMarkdown, toTex55File } from './export.js';
import { encode55, codepageFor } from './tex55file.js';
import { toHtml } from './html.js';
import { writeSci, sciMathML, blankSci } from './sciwriter.js';
import { readLatex } from './tex55.js';
import { SAMPLES } from './samples.js';
import JSZip from 'jszip';
import { isDesktop, pickAndRead, readPath, writeBytes, typeset, serveApi, onCloseWindow, backupFile, startupPath } from './desktop.js';
import { setupUI } from './ui55.js';
import { makeApi } from './api.js';
import { numberingPlugin } from './numbering.js';
import { preloadEngine, plotPoints } from './compute.js';
import { parsePlot, drawable, plotSVG } from './plots.js';
import { candidates, TEX_IMAGE, WEB_IMAGE, mimeOf } from './graphics.js';
import './style.css';

const STORE = 'sw-next-doc-v1';
let meta = {};
// the .sci file the document came from: its other files and <head> are kept on save
let source = null; // { zip, headXML }
let currentPath = null; // desktop app: where the document was opened from / saved to
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
  state: makeState(loadSaved() || demoDoc()),
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
window.swComputeForTests = { plotPoints };
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
  return { state: view.state, meta, source, path: currentPath, loadedDoc, assets, subFiles, scroll: $('#scroller').scrollTop };
}
function showRecord(r) {
  meta = r.meta; source = r.source; currentPath = r.path; loadedDoc = r.loadedDoc; assets = r.assets; subFiles = r.subFiles;
  view.updateState(r.state);
  ui?.refresh();
  $('#scroller').scrollTop = r.scroll || 0;
  showTitle();
  scheduleSave();
}
const docName = (m, path) => m.name || (path ? path.split(/[\\/]/).pop() : '未命名');
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
  windowMenu.push('-', ['下一個文件', 'Ctrl+F6', nextWindow]);
}
// File > Close: the document on screen goes (asking first if it was changed)
function closeDoc() {
  const close = () => {
    if (others.length) { showRecord(others.pop()); return; }
    opening = false;
    setDoc(schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]));
  };
  if (view.state.doc.eq(loadedDoc)) { close(); return; }
  $('#confirm-text').textContent = '這份文件改過還沒存，關掉的話改的內容會不見。要關嗎？';
  $('#confirm-ok').textContent = '關閉';
  $('#confirm').hidden = false;
  $('#confirm-ok').onclick = () => { $('#confirm').hidden = true; $('#confirm-ok').textContent = '取代'; close(); };
  $('#confirm-cancel').onclick = () => { $('#confirm').hidden = true; $('#confirm-ok').textContent = '取代'; };
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
  if (/\.tex$/i.test(fileName)) { // Scientific Word 5.x document
    try {
      const r = readTex55(new Uint8Array(bytes));
      // saving writes a new .sci file; the .tex is never overwritten
      setDoc(r.doc, { ...r.meta, name: fileName.replace(/\.tex$/i, '') }, null, null);
      toast(`已開啟 ${fileName}（Scientific Word 5 文件，存檔會另存成 .sci）` + keptAsTeX());
      // its pictures are files next to it (only the desktop app can read them)
      await loadPictures(path ? path.replace(/[\\/][^\\/]*$/, '') : null);
      renderPlots(); // needs the engine: may take a few seconds
    } catch (err) { toast('開啟失敗：' + err.message); }
    return;
  }
  try {
    const r = await readSci(bytes);
    setDoc(r.doc, { ...r.meta, name: fileName.replace(/\.sci$/i, '') }, r, path);
    for (const [p, bytes] of r.files) assets.set(p, bytes);
    toast(`已開啟 ${fileName}` + keptAsTeX());
  } catch (err) { toast('開啟失敗：' + err.message); }
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
      try { await openBytes(await readPath(p), p.split(/[\\/]/).pop(), p); } catch (err) { toast('開啟失敗：' + err); }
    })]);
  }
  if (!recentMenu.length) recentMenu.push([isDesktop ? '（還沒有）' : '（桌面版才有）', null, null]);
}
refreshRecent();

function openDialog() {
  if (!isDesktop) { $('#file').click(); return; }
  // the desktop app uses the system's open dialog and remembers the path for saving
  confirmReplace(async () => {
    try {
      const picked = await pickAndRead();
      if (picked) await openBytes(picked.bytes, picked.path.split(/[\\/]/).pop(), picked.path);
    } catch (err) { toast('開啟失敗：' + err); }
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
  return n ? `；有 ${n} 段指令這裡不認得，原樣保留成灰底的 TeX 欄位，存檔和匯出不會掉` : '';
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
// finds the pictures' files and shows the ones a browser can draw. dir: the document's folder
async function loadPictures(dir) {
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
    let data;
    try {
      data = [];
      for (const c of plot.curves) data.push(await plotPoints(c.latex, c.variable, c.range[0], c.range[1], c.n));
    } catch (e) { console.warn('繪圖算不出來：', e.message); continue; }
    const w = a.width || 432;
    const h = a.height || 288;
    const svg = new TextEncoder().encode(plotSVG(plot, data, w, h));
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
  try { await img.decode(); } catch (e) { toast('讀不出這張圖片'); return; }
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
async function save(asNew = false) {
  if (inFrame) { toast('試用頁不能下載檔案，桌面版才能存檔'); return false; }
  try {
    const bytes = await sciBytes();
    const name = (meta.name || 'document') + '.sci';
    if (isDesktop) {
      const target = asNew === true ? null : currentPath;
      if (target) await backupFile(target);
      const path = await writeBytes(bytes, target, name);
      if (!path) return false;
      currentPath = path;
      meta.name = path.split(/[\\/]/).pop().replace(/\.sci$/i, '');
      toast('已存檔：' + path);
    } else download(new Blob([bytes], { type: 'application/zip' }), name);
    loadedDoc = view.state.doc;
    return true;
  } catch (err) { toast('存檔失敗：' + (err.message || err)); return false; }
}
// File > Save as 5.x .tex: a file Scientific Word 5.5 opens (its own code page, \FRAMEs, TCI macros)
async function saveAs55() {
  if (inFrame) { toast('試用頁不能下載檔案，桌面版才能存檔'); return; }
  try {
    const text = toTex55File(view.state.doc, meta);
    const bytes = encode55(text, codepageFor(meta, text));
    const name = (meta.name || 'document') + '.tex';
    if (!isDesktop) { download(new Blob([bytes], { type: 'application/x-tex' }), name); return; }
    const { save: pickSave } = await import('@tauri-apps/plugin-dialog');
    const target = await pickSave({ defaultPath: name, filters: [{ name: 'Scientific Word 5.x（.tex）', extensions: ['tex'] }] });
    if (!target) return;
    await backupFile(target);
    await writeBytes(bytes, target, null);
    toast('已存成 5.x 檔案：' + target);
  } catch (err) { toast('存檔失敗：' + (err.message || err)); }
}
// File > Export as HTML: one page with the pictures inside it
function base64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function htmlText() {
  const pics = new Map();
  for (const [p, bytes] of assets) pics.set(p, `data:${isPng(bytes) ? 'image/png' : mimeOf(p)};base64,${base64(bytes)}`);
  return toHtml(view.state.doc, meta, pics);
}
async function exportHtml() {
  if (inFrame) { toast('試用頁不能下載檔案，桌面版才能存檔'); return; }
  try {
    const bytes = new TextEncoder().encode(htmlText());
    const name = (meta.name || 'document') + '.html';
    if (!isDesktop) { download(new Blob([bytes], { type: 'text/html' }), name); return; }
    const path = await writeBytes(bytes, null, name, [{ name: 'HTML', extensions: ['html'] }]);
    if (path) toast('已匯出：' + path);
  } catch (err) { toast('匯出失敗：' + (err.message || err)); }
}
window.swHtmlForTests = htmlText;
// File > Export as Word (the docx library is loaded only when asked for)
async function docxBytes() {
  const { toDocx } = await import('./docx.js');
  return toDocx(view.state.doc, meta, assets);
}
async function exportDocx() {
  if (inFrame) { toast('試用頁不能下載檔案，桌面版才能存檔'); return; }
  try {
    const bytes = await docxBytes();
    const name = (meta.name || 'document') + '.docx';
    if (!isDesktop) { download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), name); return; }
    const path = await writeBytes(bytes, null, name, [{ name: 'Word', extensions: ['docx'] }]);
    if (path) toast('已匯出：' + path);
  } catch (err) { toast('匯出失敗：' + (err.message || err)); }
}
window.swDocxForTests = async () => base64(await docxBytes());
window.swTex55ForTests = () => { const t = toTex55File(view.state.doc, meta); return Array.from(encode55(t, codepageFor(meta, t))); };

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
const exportMd = () => showExport('Markdown（給 AI 讀）', toMarkdown(view.state.doc), (meta.name || 'document') + '.md');

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
      toast('已存檔：' + path + (files.length ? `（和 ${files.length} 個圖檔）` : ''));
    } catch (err) { toast('存檔失敗：' + err); }
  };
  $('#export-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(text); toast('已複製'); }
    catch (e) { $('#export-text').select(); document.execCommand('copy'); toast('已複製'); }
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
let typesetting = false;
async function pdf() {
  if (typesetting) return;
  typesetting = true;
  toast('排版中…第一次使用要下載 LaTeX 套件，會比較久');
  try {
    const pics = await texPictureFiles();
    await typeset(toLatex(view.state.doc, meta, { files: pics.names }), meta.name || 'document', pics.list);
    toast('PDF 已開啟');
  } catch (err) {
    showExport('排版失敗', String(err), 'typeset-log.txt');
  } finally { typesetting = false; }
}

// ---------- the Scientific Word 5.5 menus, toolbars, tag bar and keys ----------
ui = setupUI({
  view, toast, save, exportLatex, exportMd, zoomStep, setZoom, ZOOMS,
  open: openDialog,
  importPicture: pickPicture,
  saveAs55,
  recent: recentMenu,
  path: () => currentPath,
  saveAs: () => save(true),
  meta: () => meta,
  setMeta: (m) => { meta = m; scheduleSave(); },
  renderPlots: () => renderPlots(),
  forgetPicture: (p) => assets.delete(p),
  exportHtml,
  exportDocx,
  pdf: isDesktop ? pdf : null,
  newDoc: () => confirmReplace(() => openSample('blank')),
  closeDoc,
  windows: windowMenu,
  refreshWindows: refreshWindowMenu,
  samples: [['demo', '試用說明'], ['blank', '空白文件'], ...SAMPLES.map((s) => [s.id, s.label])],
  openSample: (id) => confirmReplace(() => openSample(id)),
  help: () => { $('#help').hidden = !$('#help').hidden; },
});
setZoom(zoom);
ui.refresh();

// ---------- commands for AI agents (window.sw; the desktop app's MCP uses the same) ----------
window.sw = makeApi({
  view,
  meta: () => meta,
  path: () => currentPath,
  setDoc: (doc, m) => setDoc(doc, m, source, currentPath),
  openPath: async (path) => {
    if (!isDesktop) throw new Error('網頁版不能用路徑開檔，請用 set 給 LaTeX 內容');
    const bytes = await readPath(path);
    await openBytes(bytes, path.split(/[\\/]/).pop(), path);
  },
  saveTo: async (path) => {
    if (!isDesktop) throw new Error('網頁版不能存到路徑');
    const target = path || (currentPath && /\.sci$/i.test(currentPath) ? currentPath : null);
    if (!target) throw new Error('請給 path（要存成的 .sci 路徑）');
    await writeBytes(await sciBytes(), target, null);
    currentPath = target;
    loadedDoc = view.state.doc;
    return target;
  },
  typesetNow: async () => {
    if (!isDesktop) throw new Error('網頁版不能排版，請用 get 取得 LaTeX');
    const pics = await texPictureFiles();
    return typeset(toLatex(view.state.doc, meta, { files: pics.names }), meta.name || 'document', pics.list);
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
  }).catch((e) => console.error('關閉前詢問沒有設定好：', e));
}
if (isDesktop) setTimeout(preloadEngine, 3000);
// opened by double-clicking a document: show it
if (isDesktop) {
  startupPath().then(async (p) => {
    if (p) await openBytes(await readPath(p), p.split(/[\\/]/).pop(), p);
  }).catch((e) => toast('開啟失敗：' + e));
} // the engine is a local file in the desktop app
if (isDesktop) serveApi((cmd, args) => window.sw.call(cmd, args)).catch((e) => console.error('AI 控制通道沒有開：', e));

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
    schema.nodes.title.create(null, [t('Scientific Word 新版試用')]),
    p(t('這一頁可以直接打字。按 '), t(mod + '+M', bold), t('（或打 '), t('$', bold), t('）開始輸入數學，例如 '),
      m('x^2+y^2=r^2'), t('。在公式裡用方向鍵移動，走到邊緣會自動回到文字。')),
    p(t('打 '), t('x^2', bold), t(' 會變成上標，打 '), t('/', bold), t(' 會變成分數，打 '), t('\\alpha', bold),
      t(' 或 '), t('sqrt', bold), t(' 會變成符號，例如 '), m('\\frac{a}{b}+\\sqrt{2}+\\alpha'), t('。')),
    schema.nodes.heading.create({ level: 2 }, [t('定理與獨立公式')]),
    schema.nodes.env.create({ kind: 'theorem' }, [
      p(t('（畢氏定理）直角三角形的兩股 '), m('a,b'), t(' 和斜邊 '), m('c'), t(' 滿足')),
    ]),
    schema.nodes.math_display.create({ latex: 'a^2+b^2=c^2' }),
    schema.nodes.env.create({ kind: 'proof' }, [p(t('把四個全等三角形排成正方形，比較面積即得。'))]),
    p(t('矩陣也可以：'), m('A=\\begin{pmatrix}1 & 2\\\\ 3 & 4\\end{pmatrix}'), t('，行列式 '), m('\\det A=-2'), t('。')),
    p(t('「檔案 > 範例」可以打開 Scientific Word 的 .sci 檔；「檔案 > 匯出」可以轉成 LaTeX 或給 AI 讀的 Markdown。快捷鍵跟 Scientific Word 5.5 一樣，按 F1 看全部。')),
  ]);
}
