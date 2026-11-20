import 'mathlive';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { Fragment, Slice } from 'prosemirror-model';
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
import { isDesktop, pickAndRead, readPath, writeBytes, typeset, serveApi, onCloseWindow, backupFile, bakOf, startupPath, fetchUrl, aiHome, fileExists, pickSavePath, realPath, projectsRoot, listFolder, makeFolder, copyFile, copyNamed, appendBytes, trashFiles, showInFolder } from './desktop.js';
import { RECORDS, RECORD_FILES, ORIGINAL, joinPath, folderOf, nameOf, samePath, insideFolder, inRecords, sha256, timeOf, projectAt, projectState, isOriginal, findImports, importDocument, makeProjectFolder, savePlan, recordSave, recordRename, recordOriginalWritten, changeEntry, undoEntry, closedEntry, noteEntry, appendChange, appendNote, readRecords, projectFacts } from './projects.js';
import { setupUI } from './ui55.js';
import { definitionsOnOpen, definitionsOnSave } from './c55_defsmisc.js';
import { settings, applySettings } from './settings.js';
import { inTurn } from './dialogs.js';
import { makeApi } from './api.js';
import { stepsFollow } from './steps.js';
import { aiChangesPlugin, aiStart, aiEnd, aiEdit, aiBusy, blockDiff } from './aiedits.js';
import { reviewPlugin, reviewKey, setupReview } from './review.js';
import { numberingPlugin } from './numbering.js';
import { preloadEngine, plotPoints, compute, definitionsNow, setDefinitions, setEngineNotice } from './compute.js';
import { parsePlot, drawable, plotSVG, plotSVG3D, plotKind, is3D, steadyFrames, animFrames } from './plots.js';
import { plotData, plotFrames } from './plotdata.js';
import { ImageView, framesOf, setFrames, isAnimatedFrame } from './animview.js';
import { candidates, TEX_IMAGE, WEB_IMAGE, mimeOf } from './graphics.js';
import './style.css';
import { _t, _tm, translatePage } from './i18n.js';
import PACKAGE from '../package.json';

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
// The project the open document is in (projects.js): { folder, data: what its project.json said
// when the document was opened or last saved }; null: it is in none. A document keeps its
// project while it is open, whatever is changed in Tools > User Setup meanwhile.
let project = null;
// what the document's change log and handoff notes still have to get, as text: of a document
// that has no project folder yet (new, not saved) at its first save; of one in a project what
// could not be written (with the next entry)
let pending = { log: '', notes: '' };
let ui = null; // menus, toolbars and tag bar (set up below)
let review = null; // View > Changes panel (review.js, set up below)

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

// review: what View > Changes compares with (review.js), kept when an AI replaces the document
function makeState(doc, review = null) {
  return EditorState.create({
    doc,
    plugins: [inputRules({ rules: [dollarRule] }), keymap(mathKeys), keymap(keys), keymap(baseKeymap), history(), tableEditing(), numberingPlugin(() => meta), aiChangesPlugin(), reviewPlugin(review)],
  });
}

const view = new EditorView(document.querySelector('#editor'), {
  // Tools > User Setup: the last document, a blank one, or the introduction
  state: makeState((settings().startup === 'last' && loadSaved()) || (settings().startup === 'blank' ? schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]) : demoDoc())),
  nodeViews: {
    math_inline: (n, v, g) => new MathView(n, v, g),
    math_display: (n, v, g) => new MathView(n, v, g),
    note: (n, v, g) => new NoteView(n, v, g),
    image: (n) => new ImageView(n), // an animated plot gets a bar to play it (animview.js)
  },
  dispatchTransaction(tr) {
    // the person changed the document: the AI's edit is over (aiedits.js)
    if (tr.docChanged && aiEdit() && !tr.getMeta('ai')) aiEnd();
    view.updateState(view.state.apply(tr));
    if (tr.docChanged) { scheduleSave(); showTitle(); review?.refresh(); }
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

// Compare saved document settings as well as the body, including for documents off screen.
function settingsText(m) {
  // (a setting without a value is one that is not set: a dialog closed with OK leaves such keys)
  return JSON.stringify(Object.keys(m || {}).filter((k) => k !== 'name' && m[k] != null).sort().map((k) => [k, m[k]]));
}
function documentChanged(r = { state: view.state, meta, loadedDoc, loadedSettings }) {
  return !r.state.doc.eq(r.loadedDoc) || settingsText(r.meta) !== r.loadedSettings;
}
let aiSetting = false; // setDoc for an AI's set command: part of its edit
function setDoc(doc, m = {}, src = null, path = null) {
  if (!aiSetting) aiEnd();
  // a document the user opens goes in a window of its own (5.5's Window menu); the one on
  // screen stays open unless it is an untouched one without a name
  if (opening && (documentChanged() || currentPath || meta.name)) others.push(currentRecord());
  if (opening) setDefinitions(null); // a document opened or new: its own definitions (5.5), none yet
  opening = false;
  assets = new Map();
  subFiles = new Map();
  meta = m;
  source = src;
  currentPath = path;
  // an AI replacing the whole document (its set command) edits this one: the file it came from,
  // and what the Changes panel compares with, stay
  const rv = aiSetting ? reviewKey.getState(view.state) : null;
  if (!aiSetting) { original55 = null; loadedDoc = doc; loadedSettings = settingsText(meta); project = null; pending = { log: '', notes: '' }; }
  view.updateState(makeState(doc, rv && { base: rv.base, ranges: [{ from: 0, to: doc.content.size, author: 'ai' }] }));
  review?.refresh();
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
  return { state: view.state, meta, source, path: currentPath, original55, loadedDoc, loadedSettings, assets, subFiles, project, pending, scroll: $('#scroller').scrollTop, defs: definitionsNow() };
}
function showRecord(r) {
  aiEnd(); // what an AI changed was in the document that leaves the screen
  meta = r.meta; source = r.source; currentPath = r.path; original55 = r.original55 || null; loadedDoc = r.loadedDoc; loadedSettings = r.loadedSettings; assets = r.assets; subFiles = r.subFiles; project = r.project; pending = r.pending;
  setDefinitions(r.defs); // its own Compute definitions (5.5: each document has its own)
  view.updateState(r.state);
  ui?.refresh();
  review?.refresh();
  $('#scroller').scrollTop = r.scroll || 0;
  showTitle();
  showAi();
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
  else {
    // the same document: its project and its log go on, and so does what it is compared with
    // (the file as opened or last saved: what the user changed before the AI is still unsaved)
    const kept = [project, pending, loadedDoc, loadedSettings, original55];
    setDoc(edit.doc, edit.meta, source, currentPath);
    [project, pending, loadedDoc, loadedSettings, original55] = kept;
    showTitle();
  }
  // (the change log has those changes: it gets a line saying they were taken back)
  if (aiLogged.has(edit)) writeLog(undoEntry(aiLogged.get(edit), new Date()));
  toast(_t('The AI\'s changes were undone'));
  showAi();
}
function showTitle() {
  document.title = `${docName(meta, currentPath)}${documentChanged() ? ' *' : ''} - opensw`;
  // where the document is, always in sight (the status bar; of a long path the end is shown)
  const at = document.querySelector('#status-path');
  at.dataset.hint ??= at.title; // (index.html: what a click does)
  at.textContent = currentPath ? '\u200e' + currentPath : '';
  at.title = `${currentPath || ''}\n${at.dataset.hint}`;
  at.hidden = !currentPath;
}
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
  // 5.5's order: Close All, then the open documents (5.5's window-arranging items are not needed: one document is shown at a time)
  windowMenu.push([_t('Close All'), null, closeAll], '-');
  windowMenu.push([`✓ ${docName(meta, currentPath)}${documentChanged() ? ' *' : ''}`, null, () => {}]);
  others.forEach((r, i) => windowMenu.push([`　${docName(r.meta, r.path)}${documentChanged(r) ? ' *' : ''}`, null, () => switchTo(i)]));
  windowMenu.push('-', [_t('Next document'), 'Ctrl+F6', nextWindow]);
}
// The document on screen has unsaved changes: save it, lose them, or stay? -> 'saved' | 'discard' | 'cancel'
const askSave = () => new Promise((resolve) => {
  $('#closeask').hidden = false;
  const done = (v) => { $('#closeask').hidden = true; resolve(v); };
  $('#closeask-cancel').onclick = () => done('cancel');
  $('#closeask-discard').onclick = () => done('discard');
  $('#closeask-save').onclick = async () => done((await save()) ? 'saved' : 'cancel');
});
// every changed document is shown and asked about in turn -> false when the user chose to stay
async function askSaveAll() {
  const skipped = new Set();
  for (;;) {
    if (documentChanged() && !skipped.has(view.state)) {
      const a = await askSave();
      if (a === 'cancel') return false;
      if (a === 'discard') skipped.add(view.state);
      continue;
    }
    const i = others.findIndex((r) => documentChanged(r) && !skipped.has(r.state));
    if (i < 0) return true;
    switchTo(i);
  }
}
// A document goes while it has changes that are not saved (the user said so): when an AI made
// some of them, the project's change log has entries for what is not in the file. It gets one
// more entry that says so. r: the document's record (see currentRecord)
function logDiscarded(r) {
  if (!r.project || !r.pending.unsaved || !documentChanged(r)) return;
  const text = r.pending.log + closedEntry(r.pending.unsaved, new Date());
  logged(() => appendChange(projectFiles, r.project.folder, r.project.data.main, text)).catch(() => {});
}
// the document on screen goes: another open one takes its place, or an empty one
function dropCurrent() {
  logDiscarded(currentRecord());
  if (others.length) { showRecord(others.pop()); return; }
  opening = false;
  setDefinitions(null); // the definitions went with the document
  setDoc(schema.nodes.doc.create(null, [schema.nodes.paragraph.create()]));
}
// File > Close, and the × at the end of the menu bar: the document on screen goes (asking first if it was changed)
async function closeDoc() {
  if (!documentChanged() || (await askSave()) !== 'cancel') dropCurrent();
}
// Window > Close All
async function closeAll() {
  if (!(await askSaveAll())) return;
  others.forEach(logDiscarded);
  others.length = 0;
  dropCurrent();
}
// File > Save All: every open document with unsaved changes is saved (one without a file asks where)
async function saveAll() {
  const start = view.state;
  let saved = 0;
  if (documentChanged()) { if (!(await save())) return; saved++; }
  for (const r of others.filter((x) => documentChanged(x))) {
    const i = others.indexOf(r);
    if (i < 0) continue;
    switchTo(i);
    if (!(await save())) break;
    saved++;
  }
  const back = others.findIndex((r) => r.state === start);
  if (back >= 0) switchTo(back);
  toast(saved ? _t('Saved {0} documents', saved) : _t('No open document has unsaved changes'));
}
// File > Exit: the window closes (each changed document is asked about first)
async function exitApp() {
  if (!(await askSaveAll())) return;
  if (isDesktop) { await logAllDiscarded(); const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().destroy(); return; }
  window.close();
  toast(_t('Close this browser tab to leave opensw'));
}
// for an AI (api.js): the open documents, the one on screen first, then in the Window menu's order
const openDocuments = () => [{ meta, path: currentPath, state: view.state, loadedDoc, loadedSettings }, ...others]
  .map((r, doc) => ({ doc, name: r.meta.name || null, path: r.path || null, changed: documentChanged(r) }));
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'F6' || e.key === 'Tab')) { e.preventDefault(); nextWindow(); }
}, true);

const $ = (s) => document.querySelector(s);
$('#status-ai-undo').onclick = undoAiChanges;
$('#status-path').onclick = () => showFolder();

// ---------- open ----------
$('#file').onchange = (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) confirmReplace(() => openFile(f));
};
async function openFile(f) {
  await openBytes(await f.arrayBuffer(), f.name, null);
}
// A file's bytes read as a document; nothing on the screen changes yet.
// -> { kind: 'tex' (5.x .tex, .qiz, .rap), raw, text, r (what readLatex made of it), is5x } | { kind: 'sci', r }
async function parseFile(bytes, fileName) {
  if (!/\.(tex|qiz|rap)$/i.test(fileName)) return { kind: 'sci', r: await readSci(bytes) };
  const raw = new Uint8Array(bytes);
  const text = decode55(raw);
  // a LaTeX file 5.x did not write: its first Save makes a 5.x file of it (see save)
  const is5x = /\\input\{tcilatex\}|%TCIDATA|^%2multibyte/.test(text) || /\.qiz$/i.test(fileName);
  return { kind: 'tex', raw, text, r: readLatex(text), is5x };
}
// ... and put on the screen. path: the file it is (null: none, as in the web page); home: the
// project it is in ({ folder, data }, see `project`; null: none)
async function showFile(file, fileName, path, home = null) {
  if (path) refreshRecent(path);
  const { r } = file;
  if (file.kind === 'tex') { // Scientific Word 5.x document (an exam template is a .qiz)
    const rap = /\.rap$/i.test(fileName);
    // .tex is the main format: saving writes this file again. A .rap package gets a new .tex:
    // in a project folder beside the package, without asking; elsewhere Save asks where
    setDoc(r.doc, { ...r.meta, name: fileName.replace(/\.(tex|qiz|rap)$/i, '') }, null, !rap ? path : home ? path.replace(/\.rap$/i, '.tex') : null);
    project = home;
    if (!rap) original55 = { bytes: file.raw, text: file.text, is5x: file.is5x, spans: r.spans55 };
    toast((file.is5x ? _t('Opened {0} (Scientific Word 5 document)', fileName)
      : !home || (await latexKept()) ? _t('Opened {0} (LaTeX document; Save makes a new 5.x file and keeps this one)', fileName)
        : _t('Opened {0} (LaTeX document; Save writes it as a Scientific Word 5.x file)', fileName)) + keptAsTeX());
    // its pictures are files next to it (only the desktop app can read them); one named with ".."
    // was not copied into the project: it is where it was, seen from the file that was imported
    const from = home?.data.source;
    await loadPictures(path ? folderOf(path) : null, null, from ? folderOf(from) : null);
    renderPlots(); // needs the engine: may take a few seconds
    definitionsOnOpen(); // Compute > Settings > Definition Options: its definitions restored
    return;
  }
  setDoc(r.doc, { ...r.meta, name: fileName.replace(/\.sci$/i, '') }, r, path);
  project = home;
  for (const [p, bytes] of r.files) assets.set(p, bytes);
  toast(_t('Opened {0}', fileName) + keptAsTeX());
  definitionsOnOpen();
}
async function openBytes(bytes, fileName, path) {
  try { await showFile(await parseFile(bytes, fileName), fileName, path); } catch (err) { toast(_t('Could not open: ') + err.message); }
}

// ---------- projects (desktop app): a file that is opened is imported ----------
// The rules are in projects.js; here is the disk, and what the user is asked and told.
const projectFiles = isDesktop ? {
  read: readPath, write: (path, bytes) => writeBytes(bytes, path), append: (path, bytes) => appendBytes(bytes, path), exists: fileExists,
  list: listFolder, makeFolder, copy: copyFile, copyNamed, trash: trashFiles,
} : null;
// the dialog's usual buttons (Cancel, OK)
const usualButtons = () => $('#dialog .panel > .panel-actions');
// A question with buttons of its own, shown in its turn (dialogs.js). lines: the text, one
// paragraph each; buttons: [[key, label]], the last one is the usual choice
// -> the key of the button clicked ('' when the dialog was closed some other way)
function ask(title, lines, buttons) {
  return inTurn((answer) => {
    $('#dialog-title').textContent = title;
    const body = $('#dialog-body');
    body.innerHTML = '';
    for (const line of lines) {
      const p = document.createElement('p');
      p.style.overflowWrap = 'anywhere'; // a long path
      p.textContent = line;
      body.append(p);
    }
    const row = document.createElement('div');
    row.className = 'panel-actions';
    for (const [key, label] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.key = key;
      b.onclick = () => { usualButtons().hidden = false; body.innerHTML = ''; answer(key); };
      row.append(b, ' ');
    }
    row.lastElementChild.className = 'accent';
    body.append(row);
    body.onkeydown = null;
    usualButtons().hidden = true; // Cancel and OK are not for this question
    $('#dialog').hidden = false;
    row.lastElementChild.focus();
  }, '').finally(() => { usualButtons().hidden = false; });
}
// An AI asks the user to allow something (api.js): OK or Cancel -> true or false. It is shown in
// its turn; no answer within 4 minutes of the asking is no (the AI app stops waiting after 5)
function askForAi(title, what, how) {
  return new Promise((resolve) => {
    let close = null;
    let over = false;
    const timer = setTimeout(() => { over = true; resolve(false); close?.(false); }, 240000);
    inTurn((answer) => {
      if (over) { answer(false); return; } // (its turn came too late)
      close = answer;
      $('#dialog-title').textContent = title;
      $('#dialog-body').innerHTML = '<p></p><p></p>';
      const [first, second] = $('#dialog-body').querySelectorAll('p');
      first.textContent = what;
      second.textContent = how;
      usualButtons().hidden = false;
      $('#dialog').hidden = false;
      $('#dialog-cancel').onclick = () => answer(false);
      $('#dialog-ok').onclick = () => answer(true);
      $('#dialog-body').onkeydown = null;
      $('#dialog-ok').focus();
    }, false).then((yes) => { clearTimeout(timer); resolve(yes); });
  });
}
// File > Open Document Folder, and the path in the status bar: the document's file shown in its folder
async function showFolder(path = currentPath) {
  if (!isDesktop) { toast(_t('Showing the document\'s folder needs the desktop app')); return; }
  if (!path) { toast(_t('This document is not saved yet: it is in no folder')); return; }
  try { await showInFolder((await fileExists(path)) ? path : folderOf(path)); } catch (err) { toast(_t('Could not show the folder: ') + (err.message || err)); }
}
// A file of a project that is open already (the document on screen, or one in the Window menu)
// is brought to the screen -> false when it is not open
function bringToScreen(path) {
  if (project && currentPath && samePath(currentPath, path)) return true;
  const i = others.findIndex((r) => r.project && r.path && samePath(r.path, path));
  if (i >= 0) switchTo(i);
  return i >= 0;
}
// Every way of opening a file by its path comes here: File > Open, Recent File, a document the
// program is started with, Go > Links, an AI's open. Only a file of a project (a folder that
// has opensw's records, wherever it is) is opened where it is. Any other file is imported:
// copied, with the files it uses, into a project folder of its own, and the copy is opened; the
// file itself is not written. That goes for a file in any other folder of the projects folder,
// and for the files in a project's records, too. A file that was imported before: the user
// chooses that copy or a new one; an AI gets that copy (fresh: a new one).
// bytes: the file's, when they were read already.
// -> for the AI's answer: {} (a file of a project, opened as it is), { alreadyOpen, note } (it was
//    open: brought to the screen), { alreadyImported, note }, { imported }; null: the user
//    cancelled. An error: nothing was opened.
async function openPath(path, { ai = false, fresh = false, bytes = null } = {}) {
  let name = nameOf(path);
  const show = async (file, at, home = null) => {
    // an AI opening: a document with unsaved changes is not lost, it stays open (the Window menu)
    if (ai) opening = documentChanged();
    try { await showFile(file, name, at, home); } finally { if (ai) opening = false; }
  };
  // (the document of a 5.5 package, .rap, is the .tex beside it)
  const saved = path.replace(/\.rap$/i, '.tex');
  // open already: that document comes to the screen as it is, with what was changed in it
  // (opened once more, the same file would be in two windows that know nothing of each other)
  if (bringToScreen(saved)) {
    if (!ai) toast(_t('{0} is open already', nameOf(saved)));
    return { alreadyOpen: true, note: `${saved} was open already: it is the document on screen now, as it is in the editor (with any changes that are not saved yet); it was not read from the disk again.` };
  }
  const root = await projectsRoot().catch(() => null);
  let home = await projectAt(projectFiles, path).catch(() => null);
  // (a link in a project folder can lead out of it: the file is outside then, and imported.
  // On a drive where the disk cannot say where a file really is, the path is gone by, as
  // before: a project's own file must not be imported anew each time it is opened)
  // (a package whose document was saved since: that .tex is the file opened, and the one asked about)
  const opened = home && saved !== path && (await fileExists(saved)) ? saved : path;
  if (home && !(await reallyIn(opened, home.folder, true))) home = null;
  if (home) {
    if (opened !== path) { path = opened; name = nameOf(path); bytes = null; }
    await show(await parseFile(bytes || await readPath(path), name), path, home);
    return {};
  }
  if (!bytes) bytes = await readPath(path);
  const hash = await sha256(bytes);
  const earlier = !fresh ? await findImports(projectFiles, [root, ...settings().pastProjectsFolders], path, hash, project).catch(() => []) : [];
  let alike = null; // (for the AI) a file of the same name and contents was imported from another path
  if (earlier.length) {
    const { project: was, path: copy, how } = earlier[0];
    const changed = was.sourceSha256 !== hash;
    const when = timeOf(new Date(was.imported));
    // the same name and contents, another path: it may be this file under another name (a
    // network drive and its \\server name), or another file. The user is asked, in those words;
    // an AI, which cannot be asked, gets a copy of the file it named
    const choice = how === 'contents'
      ? (ai ? 'new' : await ask(_t('A file like this one was imported before'),
        [_t('A file with the same name and the same contents was imported on {0} from {1}.', when, was.source), _t('This one is {0}.', path), _t('If it is the same file, you can go on with the copy made then: {0}', copy)],
        [['', _t('Cancel')], ['new', _t('Import this file as a new copy')], ['copy', _t('Open that copy')]]))
      : ai ? 'copy' : await ask(_t('This file was imported before'),
        [changed ? _t('The original has changed since it was imported on {0}.', when) : _t('This file was imported on {0}.', when), path, _t('The copy: {0}', copy)],
        [['', _t('Cancel')], ['new', changed ? _t('Import the changed original as a new copy') : _t('Import again as a new copy')], ['copy', changed ? _t('Open the copy you worked on') : _t('Open that copy')]]);
    if (!choice) return null;
    if (choice === 'copy') {
      const there = await openPath(copy, { ai });
      // (said to the AI, in English)
      return {
        alreadyImported: { from: path, on: when, originalChanged: changed },
        ...(there.alreadyOpen ? { alreadyOpen: true } : {}),
        note: `${path} was imported on ${when}; that copy was opened, not the original. The original has ${changed ? 'CHANGED' : 'not changed'} since then. To import the original again as a new copy, open it with fresh = true.${there.alreadyOpen ? ' ' + there.note : ''}`,
      };
    }
    if (how === 'contents') alike = { importedFrom: was.source, on: when, copy };
  }
  const file = await parseFile(bytes, name);
  let report;
  try {
    const made = await projectsRoot(true);
    if (!made) throw new Error('no place for the projects folder was found');
    const tex = file.kind === 'tex' && !/\.rap$/i.test(name); // (a package has its files inside it)
    report = await importDocument(projectFiles, {
      root: made, source: path, bytes: new Uint8Array(bytes), now: new Date(), tex: tex ? file.text : null,
      pictures: tex ? [...imagePaths(file.r.doc)] : [], others: tex ? subFileNames(file.r.doc) : [],
      // (a sub-document that cannot be read as TeX names nothing)
      usesOf: (sub) => { try { const d = readLatex(decode55(new Uint8Array(sub))).doc; return { pictures: [...imagePaths(d)], others: subFileNames(d) }; } catch (e) { return { pictures: [], others: [] }; } },
      facts: { texFields: texFields(file.r.doc), latex: tex && !file.is5x },
    });
  } catch (err) {
    const why = String(err.message || err);
    if (ai) throw new Error(`Could not import ${path} into the projects folder (${why}). Nothing was opened.${err.left ? ` The folder that was begun for it could not be taken away: ${err.left}` : ''}`);
    const open = await ask(_t('This file could not be imported'),
      [_t('opensw could not make a copy of {0} in the projects folder ({1}).', path, root || '?'), why,
        ...(err.left ? [_t('The folder that was begun for it could not be taken away: {0}', err.left)] : []),
        _t('You can open the original itself; saving then writes into that very file.')],
      [['open', _t('Open the original without importing')], ['', _t('Cancel')]]);
    if (open) await show(file, path);
    return null;
  }
  await show(file, report.path, { folder: report.folder, data: report.project });
  const told = {
    imported: { from: path, folder: report.folder, copied: report.copied, notFound: report.notFound, notCopied: report.notCopied },
    ...(alike ? { alike, note: `A file with the same name and the same contents was imported on ${alike.on} from ${alike.importedFrom}; its copy is ${alike.copy}. If that is this same file under another path, the work done on it is in that copy: open that copy instead. The file you named was imported as a new copy.` } : {}),
  };
  if (ai) { toast(_t('AI opened {0}: it works on a copy in {1}', name, report.folder)); return told; }
  const shown = await ask(_t('A copy was made'), [
    _t('A copy was made in {0}. You are working on the copy. The original ({1}) is not changed by opensw.', report.folder, path),
    _t('Files copied with it: {0}', report.copied.length)
      + (report.notFound.length ? _t('; named in the document but not found: {0}', report.notFound.join(', ')) : '')
      + (report.notCopied.length ? _t('; not copied because they are outside the document\'s folder: {0}', report.notCopied.join(', ')) : '')
      + (report.texFields ? _t('; commands kept as grey TeX fields: {0}', report.texFields) : ''),
    ...(report.latex ? [_t('Scientific Word 5.x did not write this LaTeX file: Save will write it as a Scientific Word 5.x file. The LaTeX as imported stays in {0}.', `${RECORDS}\\${ORIGINAL}`)] : []),
  ], [['folder', _t('Show folder')], ['ok', _t('OK')]]);
  if (shown === 'folder') showFolder();
  return told;
}
// File > Import Contents: the body of another document (5.x .tex or .sci) put in at the cursor
async function importContents() {
  let picked;
  if (isDesktop) {
    try { picked = await pickAndRead(); } catch (err) { toast(_t('Could not open: ') + err); return; }
  } else {
    picked = await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.tex,.sci,.qiz';
      input.onchange = async () => { const f = input.files[0]; resolve(f ? { path: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null); };
      input.click();
    });
  }
  if (!picked) return;
  const name = picked.path.split(/[\\/]/).pop();
  try {
    let doc;
    if (/\.sci$/i.test(name)) {
      const r = await readSci(picked.bytes);
      doc = r.doc;
      for (const [p, bytes] of r.files) assets.set(p, bytes);
    } else doc = readLatex(decode55(picked.bytes)).doc;
    view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView());
    toast(_t('Imported the contents of {0}', name));
    if (isDesktop && !/\.sci$/i.test(name)) await loadPictures(picked.path.replace(/[\\/][^\\/]*$/, ''));
    renderPlots();
  } catch (err) { toast(_t('Could not import: ') + (err.message || err)); }
}
// Go > Links, Tools > Action: a file the document names, next to it (desktop app), opened.
// From a document in a project: the file of that name in the project folder; when there is
// none, the one next to the file the document was imported from (it is imported in its turn)
async function openRelative(file) {
  if (!isDesktop) { toast(_t('Opening another file needs the desktop app')); return; }
  const full = (dir) => (/^([a-zA-Z]:)?[\\/]/.test(file) || !dir ? file : joinPath(dir, file));
  const tex = (path) => (/\.(tex|sci|qiz)$/i.test(path) ? path : path + '.tex');
  let named = tex(full(currentPath ? folderOf(currentPath) : null));
  if (project?.data.source && !(await fileExists(named))) named = tex(full(folderOf(project.data.source)));
  confirmReplace(async () => {
    try { await openPath(named); } catch (err) { toast(_t('Could not open: ') + named); }
  });
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
      try { await openPath(p); } catch (err) { toast(_t('Could not open: ') + (err.message || err)); }
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
      if (picked) await openPath(picked.path, { bytes: picked.bytes });
    } catch (err) { toast(_t('Could not open: ') + (err.message || err)); }
  });
}
async function openSample(v) {
  if (v === 'demo') { setDoc(demoDoc()); return; }
  if (v === 'blank') { setDoc(schema.nodes.doc.create(null, [schema.nodes.paragraph.create()])); return; }
  const sample = SAMPLES.find((s) => s.id === v); // written in LaTeX (src/samples.js)
  if (sample) setDoc(readLatex(sample.latex).doc, { name: sample.id });
}

// what this editor keeps as raw TeX (shown in grey): said once when a file opens
function texFields(doc) {
  let n = 0;
  doc.descendants((x) => { if (x.type.name === 'tex_field' && !/^\\(big|med|small)skip$|^\\(newpage|pagebreak)$/.test(x.attrs.tex.trim())) n++; });
  return n;
}
function keptAsTeX() {
  const n = texFields(view.state.doc);
  return n ? _t('; {0} commands are not recognised here and are kept as they are in grey TeX fields, so saving and exporting keep them', n) : '';
}

// ---------- pictures ----------
// The picture files of the document: path (as the document names it) -> bytes.
// 5.x pictures are read from the disk next to the .tex (desktop app), a .sci's
// from its zip, imported pictures from where the user picked them.
let assets = new Map();
// subdocuments (\input, \include) next to a 5.x document: file name -> bytes, for typesetting
let subFiles = new Map();
const imagePaths = (doc = view.state.doc) => {
  const s = new Set();
  doc.descendants((n) => { if (n.type.name === 'image' && n.attrs.path) s.add(n.attrs.path); });
  return s;
};
// the other files a document names next to it: subdocuments, and BibTeX databases (for typesetting)
function subFileNames(doc = view.state.doc) {
  const subs = [];
  doc.descendants((n) => {
    if (n.type.name === 'subdoc' && n.attrs.file) subs.push(n.attrs.file);
    if (n.type.name === 'bibtex') for (const f of n.attrs.files.split(',')) if (f.trim()) subs.push(f.trim().replace(/(\.bib)?$/, '.bib'));
  });
  return subs.map((f) => (/\.[a-z]+$/i.test(f) ? f : f + '.tex'));
}
const blobURL = (bytes, path) => URL.createObjectURL(new Blob([bytes], { type: mimeOf(path) }));
// finds the pictures' files and shows the ones a browser can draw. dir: the document's folder;
// files: name -> bytes when the document came in a package (Tools > Document Manager);
// from: the folder the document was imported from (a picture named with ".." is still there)
async function loadPictures(dir, files = null, from = null) {
  if (isDesktop && dir) {
    const sep = dir.includes('\\') ? '\\' : '/';
    for (const name of subFileNames()) {
      if (/^([a-zA-Z]:|[\\/])|\.\./.test(name)) continue; // only files beside the document
      try { subFiles.set(name.replace(/\\/g, '/'), await readPath(dir + sep + name.replace(/\//g, sep))); } catch (e) { /* missing */ }
    }
  }
  for (const path of imagePaths()) {
    if (assets.has(path)) continue;
    let bytes = null;
    if (isDesktop && dir) {
      for (const c of [...candidates(dir, path), ...(from && /\.\./.test(path) ? candidates(from, path).slice(0, 1) : [])]) {
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
    if (unchanged) { loadedDoc = view.state.doc; showTitle(); } // still unchanged: no * in the title
  }
}
// 5.x plots: drawn again from their settings (plots.js); the points come from the
// engine. The picture is kept as PNG (for TeX and .sci) and shown as SVG.
async function renderPlots() {
  const todo = [];
  // an animated plot also when its frames are not drawn yet (it may have a picture from the file)
  const unplayed = (a) => isAnimatedFrame(a.frame) && !framesOf(a.path) && !animFailed.has(a.frame);
  view.state.doc.descendants((n) => { if (n.type.name === 'image' && n.attrs.plot && n.attrs.frame && (!n.attrs.src || unplayed(n.attrs))) todo.push(n.attrs); });
  for (const a of todo) {
    if (assets.has(a.path) && !unplayed(a)) continue;
    const plot = parsePlot(a.frame.slice(a.frame.indexOf('\\special')));
    if (!drawable(plot)) continue;
    const kind = plotKind(plot);
    if (plot.anim) { await renderAnimated(a, plot, kind); continue; }
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
    if (unchanged) { loadedDoc = view.state.doc; showTitle(); } // still unchanged: no * in the title
  }
}
// Compute > Settings > Plot Behavior, Recompute Plot When Definitions Change: every plot drawn again
// (its formula may use what was defined)
async function redrawPlots() {
  const tr = view.state.tr;
  view.state.doc.descendants((n, pos) => {
    if (n.type.name === 'image' && n.attrs.plot && n.attrs.frame && n.attrs.src) {
      assets.delete(n.attrs.path);
      setFrames(n.attrs.path, null);
      tr.setNodeMarkup(pos, null, { ...n.attrs, src: null });
    }
  });
  if (!tr.docChanged) return;
  const unchanged = view.state.doc.eq(loadedDoc);
  view.dispatch(tr.setMeta('addToHistory', false));
  if (unchanged) loadedDoc = view.state.doc;
  await renderPlots();
}
// 5.5's animated plots: every frame drawn in one window; the picture kept for TeX and .sci is
// the frame at currentAnimationTime (the first when not set), animview.js plays the rest
const animFailed = new Set();
async function renderAnimated(a, plot, kind) {
  const w = a.width || 432;
  const h = a.height || 288;
  const count = animFrames(plot);
  let frames;
  try {
    frames = await plotFrames(plot, count);
  } catch (e) { console.warn(_t('Could not compute the plot: '), e.message); animFailed.add(a.frame); return; }
  const svgs = steadyFrames(plot, frames).map(([p, d]) => (is3D(kind) ? plotSVG3D(p, d, w, h) : plotSVG(p, d, w, h)));
  const an = plot.anim;
  const at = an.current == null ? 0 : Math.round(((an.current - an.start) / (an.end - an.start)) * (count - 1));
  const index = Math.min(count - 1, Math.max(0, at || 0));
  const urls = svgs.map((svg) => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })));
  let png;
  try { png = await toPng(new TextEncoder().encode(svgs[index]), 'plot.svg', 3); } catch (e) { animFailed.add(a.frame); return; }
  assets.set(a.path, png);
  setFrames(a.path, { urls, values: frames.map((f) => f.value), delay: Math.max(40, ((an.end - an.start) * 1000) / (count - 1)), param: an.param, index });
  const tr = view.state.tr;
  view.state.doc.descendants((n, pos) => {
    if (n.type.name === 'image' && n.attrs.path === a.path && n.attrs.frame === a.frame) tr.setNodeMarkup(pos, null, { ...n.attrs, src: urls[index] });
  });
  const unchanged = view.state.doc.eq(loadedDoc);
  view.dispatch(tr.setMeta('addToHistory', false));
  if (unchanged) { loadedDoc = view.state.doc; showTitle(); }
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
// The open file is LaTeX that 5.x did not write, and it is the author's only copy of it: saving
// the 5.x file over it would lose that. So it is for a file opened where it is (not imported),
// and for a file of a project that is not the one whose LaTeX the records keep in Original (a
// sub-document that came along with the import).
async function latexKept() {
  if (!currentPath || !/\.tex$/i.test(currentPath) || original55?.is5x !== false) return false;
  if (!project?.data.source || !samePath(currentPath, joinPath(project.folder, project.data.main))) return true;
  return !(await listFolder(joinPath(project.folder, RECORDS, ORIGINAL)).catch(() => [])).length;
}
async function save(asNew = false) {
  if (inFrame) { toast(_t('The demo page cannot download files; saving needs the desktop app')); return false; }
  if (asNew !== true && asNew !== 'sci') asNew = false; // (the toolbar's button calls this with itself)
  const kind = asNew === 'sci' || (!asNew && currentPath && /\.sci$/i.test(currentPath)) ? 'sci' : 'tex';
  try {
    if (isDesktop) return await saveOnDesktop(asNew, kind);
    await definitionsOnSave(); // the definitions in force kept with the document (Definition Options)
    const name = await writeDocument(kind, null); // the web page: a download
    toast(_t('Saved: ') + name);
    return true;
  } catch (err) { toast(_t('Could not save: ') + (err.message || err)); return false; }
}
// File > Save and Save As in the desktop app. A document is saved in its project folder
// (projects.js); a new one gets a folder there, whatever place is chosen
async function saveOnDesktop(asNew, kind) {
  const root = await projectsRoot(true).catch(() => null);
  // a LaTeX file that is the author's only copy: where to is asked first, the new 5.x file may
  // not take its place. (The main document of a project is written over as a 5.x file: the
  // LaTeX as it was imported is in the project's records)
  const kept = kind === 'tex' && (await latexKept()) ? currentPath : null;
  let target = asNew || kept ? null : currentPath;
  if (!target) {
    // the dialog starts where the document is kept: its project folder, else the projects folder
    const name = `${meta.name || 'document'}${kept ? '_5x' : ''}.${kind}`;
    const start = project?.folder || (kept ? null : root);
    target = await pickSavePath(start ? joinPath(start, name) : name, kind === 'sci' ? undefined : TEX55_FILTERS);
    if (!target) return false;
    if (kept && samePath(target, kept)) { toast(_t('Choose another name: {0} is the LaTeX file you opened, and it is kept as it is', nameOf(kept))); return false; }
  }
  await definitionsOnSave(); // the definitions in force kept with the document (Definition Options)
  const r = await saveTo(target, 'the user', asNew ? 'as' : 'user');
  if (!r) return false; // (the user did not want it saved there after all)
  if (r.copyFailed) {
    await ask(_t('The copy was not saved'), [_t('The document was saved in its project folder: {0}', r.path), _t('But the copy could not be written to {0}: {1}', r.copyFailed.to, r.copyFailed.why)], [['ok', _t('OK')]]);
  } else if (r.copy) {
    // (a .tex copy is the document file alone: said plainly, with the command that copies the rest
    // too; and when the file chosen is the original itself, that it was written over)
    await ask(_t('A copy was saved'), [_t('A copy was saved to {0}. You are still working on {1}.', r.copy, r.path),
      kindOf(r.copy) === 'sci' ? _t('The copy is one .sci file, with its pictures inside it.')
        : _t('Only the document file was copied, not the pictures and sub-documents it uses. Tools > Document Manager > Copy takes those along.'),
      ...(r.onto ? [_t('{0} is the original this document was imported from. You chose it yourself, so it was written over with the document as it is now.', r.copy)
        + (settings().backup ? _t(' The file as it was is kept beside it, as .bak.') : '')] : [])], [['ok', _t('OK')]]);
  } else {
    toast(!r.written ? _t('No changes; the file is as it was')
      : kept ? _t('Saved as a Scientific Word 5.x file: {0}. The LaTeX file you opened ({1}) is unchanged.', r.path, nameOf(kept))
        : r.to55 ? _t('Saved as a Scientific Word 5.x file: {0}. The LaTeX as it was imported is kept in {1}.', r.path, `${RECORDS}\\${ORIGINAL}`)
          : _t('Saved: ') + r.path);
  }
  return true;
}
const kindOf = (path) => (/\.sci$/i.test(path) ? 'sci' : 'tex');
// Is this file really in a projects folder (the one in use, one used before, or the open
// document's project)? Asked of the disk, not read off the path: a link in a project folder can
// lead out of it. When the disk cannot say, the answer is no.
async function inOurFolders(path) {
  const folders = [await projectsRoot().catch(() => null), ...settings().pastProjectsFolders, project?.folder].filter(Boolean);
  for (const folder of folders) if (await reallyIn(path, folder)) return true; // (a folder that is not there now: not that one)
  return false;
}
// Is `path` in `folder` on the disk itself? unknown: the answer when the disk cannot say
// (no, for a file an AI is about to write)
async function reallyIn(path, folder, unknown = false) {
  try { return insideFolder(await realPath(path), await realPath(folder)); } catch (e) { return unknown; }
}
// The document saved (desktop app) to `target`, as projects.js savePlan says: in a project folder,
// with a copy at the target when that is somewhere else. The change log, the file map and
// project.json are kept up (by: who saves, for the log). show: 'user' (File > Save), 'as' (Save
// As), null (an AI): whether the project folder is then shown to the user (Tools > User Setup:
// at the first save, always, never).
// -> { path: the open document's file, copy: where a copy went or null, onto: the copy took the
//      place of the original the document was imported from, copyFailed: { to, why } (the
//      document was saved, the copy was not), written: false when nothing needed writing,
//      to55: a LaTeX file 5.x did not write became a 5.x file }; null: the user cancelled
async function saveTo(target, by, show = null) {
  const root = await projectsRoot(true).catch(() => null);
  const plan = savePlan({ root, project: project?.folder, current: currentPath, target });
  if (plan.refuse) {
    throw new Error(show ? _t('{0} is in the records of a project (the folder "{1}"), which opensw keeps itself: a document cannot be saved there', target, RECORDS)
      : `${target} is in the records of a project (the folder "${RECORDS}"), which opensw keeps itself: a document cannot be saved there`);
  }
  // An AI (no `show`: it is not the user saving) saves in the projects folders and nowhere else:
  // no copy outside them, and no document that was opened in place outside them. Whatever is out
  // there (the original a document was imported from, under any name) it cannot write. Putting a
  // copy somewhere is the user's File > Save As.
  const bak = plan.write && settings().backup ? bakOf(plan.write) : null; // (written too: a link by that name could lead out)
  if (!show && (plan.copy || (plan.write && !(await inOurFolders(plan.write))) || (bak && !(await inOurFolders(bak))))) {
    throw new Error(`${target} is not in the projects folder (${root}), and an AI saves nowhere else. Without a path the open document is saved where it is in the projects folder; a path in the projects folder gives the document a project folder of its own there. A copy anywhere else is for the user to make (File > Save As).`);
  }
  const [was, before] = [project, currentPath];
  const stays = !!was && !!plan.write && insideFolder(plan.write, was.folder); // it stays in its project
  // the project folder was renamed, moved or deleted while the document was open: saving would
  // quietly make it again, with nothing but the document in it. The user decides; an AI may not
  if (stays && !(await projectState(projectFiles, was.folder)).exists) {
    if (!show) throw new Error(`The project folder ${was.folder} is not there any more (it was renamed, moved or deleted while the document was open). Nothing was saved. The user can save the document there again with File > Save; or save it under a path directly in the projects folder, which makes a new project folder for it.`);
    const again = await ask(_t('The project folder is not there any more'),
      [_t('{0} was renamed, moved or deleted while this document was open.', was.folder),
        _t('Saving makes that folder again, with this document and new records in it. The pictures and other files that were in it are not made again.')],
      [['', _t('Cancel')], ['save', _t('Save there again')]]);
    if (!again) return null;
  }
  const latex = original55?.is5x === false;
  const place = plan.write || joinPath(await makeProjectFolder(projectFiles, root, plan.folder, new Date()), plan.name);
  const done = await writeDocument(kindOf(place), place);
  // (the document is saved: a copy that cannot be written does not undo that, but it is said)
  let copyFailed = null;
  if (plan.copy) {
    try {
      if (settings().backup) await backupFile(plan.copy);
      await writeBytes(kindOf(plan.copy) === 'sci' ? await sciBytes() : texFile().bytes, plan.copy);
    } catch (err) { copyFailed = { to: plan.copy, why: String(err.message || err) }; }
  }
  const copy = plan.copy && !copyFailed ? plan.copy : null;
  const r = {
    path: place, copy, copyFailed, onto: !!copy && !!was?.data.source && samePath(copy, was.data.source),
    written: done !== true || !!plan.copy, to55: latex && done !== true && kindOf(place) === 'tex',
  };
  if (!r.written) return r;
  // the project the document is in now, and its file as the project names it
  const folder = plan.folder ? folderOf(place) : stays ? was.folder : null;
  if (!folder) return r; // (saved where it was opened in place: no project, no records)
  const name = place.slice(folder.length + 1);
  const how = show && settings().showFolderOnSave;
  // (the document is saved either way: a record that cannot be written does not undo that)
  const record = await logged(() => recordSave(projectFiles, {
    folder, name, by, copy, onto: r.onto, pending, pictures: [...imagePaths()], others: subFileNames(), shown: !!how && how !== 'never', now: new Date(),
    known: stays ? was.data : null, savedFrom: plan.folder ? before : null,
    // the main document saved under another name in its folder: it is the main document still
    asMain: stays && !!before && samePath(before, joinPath(folder, was.data.main)) && !samePath(place, before),
  })).catch(() => null);
  project = { folder, data: record?.project || (stays ? was.data : { source: null, main: name }) };
  if (record) pending = { log: '', notes: '' };
  else pending.unsaved = 0; // (saved all the same: what the log has is in the file)
  if (how === 'always' || (how && how !== 'never' && (show === 'as' || record?.first))) showFolder(place);
  return r;
}
// the steps file beside the document (steps.js): its text (null: there is none), and writing it
const stepFiles = isDesktop ? {
  read: async (path) => ((await fileExists(path)) ? new TextDecoder().decode(await readPath(path)) : null),
  // (beside a document that was opened in place outside the projects folders nothing is written)
  write: async (path, text) => {
    if (!(await inOurFolders(path))) throw new Error(_t('The steps are kept in a file beside the document, and this document is not in the projects folder: nothing is written beside it. Save it in the projects folder first.'));
    return writeBytes(new TextEncoder().encode(text), path);
  },
} : null;
// writes the document as kind ('tex' or 'sci') to target (null: ask, or download in the
// web page) -> the path written, true when nothing needed writing, null when cancelled.
// Under another name than before, the steps file goes with it (steps.js)
async function writeDocument(kind, target) {
  const before = currentPath;
  const path = await writeAs(kind, target);
  if (typeof path === 'string') await stepsFollow(stepFiles, before, path).catch(() => {}); // the document is saved either way
  return path;
}
async function writeAs(kind, target) {
  if (kind === 'sci') {
    const bytes = await sciBytes();
    const name = (meta.name || 'document') + '.sci';
    if (!isDesktop) { download(new Blob([bytes], { type: 'application/zip' }), name); loadedDoc = view.state.doc; loadedSettings = settingsText(meta); return name; }
    if (target && settings().backup) await backupFile(target);
    const path = await writeBytes(bytes, target, name);
    if (!path) return null;
    currentPath = path;
    original55 = null;
    meta.name = path.split(/[\\/]/).pop().replace(/\.sci$/i, '');
    loadedDoc = view.state.doc;
    loadedSettings = settingsText(meta);
    return path;
  }
  if (unchanged55() && target && target === currentPath) return true;
  const { text, bytes, spans } = texFile();
  const name = (meta.name || 'document') + '.tex';
  if (!isDesktop) { download(new Blob([bytes], { type: 'application/x-tex' }), name); loadedDoc = view.state.doc; loadedSettings = settingsText(meta); return name; }
  if (target && settings().backup) await backupFile(target);
  const path = await writeBytes(bytes, target, name, TEX55_FILTERS);
  if (!path) return null;
  currentPath = path;
  original55 = { bytes, text, is5x: true, spans };
  meta.name = path.split(/[\\/]/).pop().replace(/\.(tex|qiz)$/i, '');
  loadedDoc = view.state.doc;
  loadedSettings = settingsText(meta);
  showTitle();
  return path;
}
// The document as a 5.x .tex file: { text, bytes, spans (its parts, see patchTex55) }.
// An unchanged 5.x file is copied as it was; an edited one keeps the parts nobody edited
// as they were in the file; other LaTeX is always written for 5.x
const unchanged55 = () => !!original55 && original55.is5x !== false && !documentChanged();
function texFile() {
  if (unchanged55()) return original55;
  const p = original55?.is5x !== false ? patchTex55(original55?.spans, loadedDoc, view.state.doc, meta) : null;
  let text = p ? p.text : toTex55File(view.state.doc, meta);
  let spans = p?.spans || null;
  // the code page line, when the file did not have one (it goes before \begin{document})
  const full = withCodepage55(text, meta, original55?.text);
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
  let bytes = encodeFile55(text, meta, original55?.text);
  // a file with \n line ends (not 5.x's \r\n) keeps them (a Big5 trail byte is never \r)
  if (original55?.bytes?.length && !original55.bytes.includes(13)) bytes = bytes.filter((x) => x !== 13);
  return { text, bytes, spans };
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
let loadedSettings = settingsText(meta);
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
  if (original55 && !documentChanged()) own = originalTex55(original55.text, { files: pics.names });
  else if (original55?.is5x !== false) {
    const p = patchTex55(original55?.spans, loadedDoc, view.state.doc, meta);
    if (p) own = originalTex55(p.text, { files: pics.names });
  }
  return own ?? toLatex(view.state.doc, meta, { files: pics.names });
}
window.swTypesetTexForTests = () => texForTypesetting({ names: new Map(), list: [] });
// the folder the open document is in (null: not saved anywhere): the files it names are there
const documentFolder = () => (currentPath ? currentPath.replace(/[\\/][^\\/]*$/, '') : null);
let typesetting = false;
// mode: 'open' (Typeset > Preview PDF), 'print' (Print PDF: sent to the printer), 'none' (Compile PDF:
// saved where the user says); done: what to say when it worked (Typeset > Tools > Run BibTeX ...)
async function pdf(mode = 'open', done = null) {
  if (typeof mode !== 'string') mode = 'open';
  if (typesetting) return;
  typesetting = true;
  toast(_t('Typesetting…'));
  try {
    const pics = await texPictureFiles();
    const opens = mode === 'open' || (mode === 'none' && settings().openAfterCompile !== false);
    const r = await typeset(texForTypesetting(pics), meta.name || 'document', pics.list, documentFolder(), opens ? 'open' : mode);
    const { errors } = r;
    review.setErrors(errors);
    if (mode === 'none') {
      const target = await writeBytes(await readPath(r.pdf), null, (meta.name || 'document') + '.pdf', [{ name: 'PDF', extensions: ['pdf'] }]);
      if (target) toast(done || _t('Saved: ') + target);
    }
    if (errors.length && settings().showTexErrors !== false) showExport(_t('PDF made, but TeX reported {0} errors; those parts may look wrong', errors.length), errors.join('\n'), 'typeset-errors.txt');
    else if (mode === 'print') toast(_t('PDF sent to the printer'));
    else if (mode === 'open') toast(done || _t('PDF opened'));
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
  showFolder,
  // Tools > Document Manager moved or deleted the file (null: the document is on screen only)
  setPath: (p) => {
    const [was, home] = [currentPath, project];
    currentPath = p;
    if (p) meta.name = p.split(/[\\/]/).pop().replace(/\.(tex|qiz|sci)$/i, '');
    // the main document of a project renamed: its project.json follows, so that opening the
    // original again finds this file. Deleted: the document on screen is in no project any more
    if (!p) project = null;
    else if (home && was && samePath(was, joinPath(home.folder, home.data.main)) && insideFolder(p, home.folder)) {
      logged(() => recordRename(projectFiles, home.folder, p.slice(home.folder.length + 1))).then((data) => { if (data) home.data = data; }).catch(() => {});
    }
    showTitle();
  },
  // the file the open document was imported from (null: none); and Tools > Document Manager >
  // Copy put the document in its place: the project's records say so
  original: () => project?.data.source || null,
  originalWritten: () => {
    const home = project;
    if (home) logged(() => recordOriginalWritten(projectFiles, home.folder, { pictures: [...imagePaths()], others: subFileNames(), now: new Date() })).then((data) => { if (data) home.data = data; }).catch(() => {});
  },
  saveAs: () => save(true),
  meta: () => meta,
  setMeta: (m) => { meta = m; scheduleSave(); showTitle(); review?.refresh(); },
  renderPlots: () => renderPlots(),
  redrawPlots: () => redrawPlots(),
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
  // keepPictures: the pictures of the document on screen go with it (Exam Builder: the template's)
  newDocument: async (doc, m, { keepPictures = false } = {}) => {
    const kept = keepPictures ? new Map(assets) : null;
    opening = true;
    setDoc(doc, m);
    if (!kept) return;
    const want = imagePaths();
    const files = new Map([...kept].filter(([p]) => want.has(p)));
    if (files.size) await loadPictures(null, files);
  },
  // Exam Builder > online quiz: the page (examquiz.js), with the pictures of the document on screen
  saveQuizHtml: async (doc, key, quizSettings, name) => {
    const pics = new Map();
    for (const [p, bytes] of assets) pics.set(p, `data:${isPng(bytes) ? 'image/png' : mimeOf(p)};base64,${base64(bytes)}`);
    const { quizHtml } = await import('./examquiz.js');
    const text = quizHtml(toHtml(doc, { ...meta, name }, pics, { math: settings().htmlMath }), key, quizSettings);
    window.swQuizHtmlForTests = text;
    if (inFrame) return;
    const bytes = new TextEncoder().encode(text);
    if (!isDesktop) { download(new Blob([bytes], { type: 'text/html' }), name + '.html'); return; }
    const path = await writeBytes(bytes, null, name + '.html', [{ name: 'HTML', extensions: ['html'] }]);
    if (path) toast(_t('Exported: ') + path);
  },
  // Help > Full manual: its pictures (manual/<language>/*.png) are files of the program (public/manual)
  openManual: async (latex, m) => {
    opening = true;
    setDoc(readLatex(latex).doc, m);
    const files = new Map();
    for (const path of imagePaths()) {
      if (!path.startsWith('manual/')) continue;
      try { const r = await fetch('./' + path); if (r.ok) files.set(path, new Uint8Array(await r.arrayBuffer())); } catch (e) { /* not shipped */ }
    }
    if (files.size) await loadPictures(null, files);
  },
  pdf: isDesktop ? () => pdf() : null,
  typesetAs: (mode, done) => (isDesktop ? pdf(mode, done) : toast(_t('Typesetting PDF needs the desktop app'))),
  saveAll,
  importContents,
  openRelative,
  exit: exitApp,
  printHtml,
  applySettings,
  version: PACKAGE.version,
  newDoc: () => confirmReplace(() => openSample('blank')),
  closeDoc,
  closeAll,
  windows: windowMenu,
  refreshWindows: refreshWindowMenu,
  samples: [['demo', _t('Getting started')], ['blank', _t('Blank document')], ...SAMPLES.map((s) => [s.id, s.label])],
  openSample: (id) => confirmReplace(() => openSample(id)),
  help: () => { $('#help').hidden = !$('#help').hidden; },
  undoAi: undoAiChanges,
  toggleReview: () => review.toggle(),
  reviewShown: () => review.shown(),
});
// View > Changes: the LaTeX that saving as .tex writes (a 5.x file: its own text, the edited parts
// written again and marked)
function reviewSource() {
  const doc = view.state.doc;
  if (original55 && original55.is5x !== false) {
    const sp = original55.spans;
    if (!documentChanged()) return sp ? { text: sp.text, head: sp.head, segs: sp.segs.map(({ to, n }) => ({ to, n })) } : { text: original55.text.replace(/\r\n?/g, '\n') };
    const p = patchTex55(sp, loadedDoc, doc, meta);
    if (p) return { text: p.text, head: p.spans.head, segs: p.spans.segs };
  }
  return { text: toTex55File(doc, meta) };
}
review = setupReview({ view, toast, compute, source: reviewSource, steps: () => window.sw.steps(), checkSteps: () => window.sw.checkSteps() });
setZoom(zoom);
ui.refresh();
applySettings();

// ---------- the records of a project (projects.js): the change log, the handoff notes ----------
let aiClient = null; // the AI app's name, when it gave one (MCP)
const aiName = () => (aiClient ? `AI (${aiClient})` : 'AI');
// the records are written one after another -> the job's result (the next job waits either way)
let logging = Promise.resolve();
function logged(job) {
  const run = logging.then(job);
  logging = run.catch((e) => console.warn('opensw records:', e));
  return run;
}
// An entry for the change log of the document on screen. A document that is not saved yet keeps
// it until its first save; one that was opened where it is (not imported) has no records. An
// entry that cannot be written is not lost: it is kept and written with the next one (the user
// is told once).
function writeLog(entry) {
  const [home, mine] = [project, pending];
  if (!isDesktop || (!home && currentPath)) return;
  logged(async () => {
    if (!home) { mine.log += entry; return; }
    const text = mine.log + entry;
    try {
      await appendChange(projectFiles, home.folder, home.data.main, text);
      Object.assign(mine, { log: '', failed: false });
    } catch (e) {
      if (!mine.failed) toast(_t('The change log could not be written just now ({0}). The entry is kept and written with the next one.', e.message || e));
      Object.assign(mine, { log: text, failed: true });
    }
  }).catch(() => {});
}
// the program closes with documents the user chose not to save: their logs first (see logDiscarded)
async function logAllDiscarded() {
  [currentRecord(), ...others].forEach(logDiscarded);
  await logging;
}
// the AI's edit under way (aiedits.js) -> when the first of its changes was logged
const aiLogged = new WeakMap();
// An AI command changed the document: the change log gets the blocks that differ, each before
// and after as text (formulas as LaTeX). metaWas: the document's settings before (given by a
// command that can change them: set), so that a change of those alone is logged too
function logAiChange(command, before, after, metaWas = null) {
  if (!isDesktop) return;
  const text = (nodes) => (nodes.length ? toMarkdown(schema.nodes.doc.create(null, nodes)) : '');
  const changes = blockDiff(before, after).map((c) => ({ at: c.index + 1, removed: c.removed.length, added: c.added.length, before: text(c.removed), after: text(c.added) }));
  const changed = metaWas != null && settingsText(metaWas) !== settingsText(meta);
  if (!changes.length && !changed) return;
  const now = new Date();
  if (aiEdit() && !aiLogged.has(aiEdit())) aiLogged.set(aiEdit(), timeOf(now));
  pending.unsaved = (pending.unsaved || 0) + 1; // (entries for what is not in the file yet: see logDiscarded)
  writeLog(changeEntry({ who: aiName(), command, changes, settings: changed }, now));
}
// (said to an AI that asks for the records of a document that has none)
const NO_RECORDS = 'This document is not in a project folder: it was opened where it is, without importing (the user chose that when it could not be imported). opensw keeps no records for such a document: no change log, no file map, no handoff notes.';
const NOT_SAVED = 'This document is not saved yet, so it is in no project folder. Its change log and handoff notes are kept in memory and written when it is first saved.';

// ---------- commands for AI agents (window.sw; the desktop app's MCP uses the same) ----------
window.sw = makeApi({
  view,
  meta: () => meta,
  path: () => currentPath,
  setDoc: (doc, m) => { aiSetting = true; try { setDoc(doc, m, source, currentPath); } finally { aiSetting = false; } },
  aiStart: () => aiStart(view.state.doc, meta),
  // where AI may open and save without asking: the projects folder; and, to open what 0.11.0
  // and before saved there, Documents\\opensw
  aiHome: isDesktop ? () => projectsRoot().catch(() => null) : null,
  oldAiHome: isDesktop ? aiHome : null,
  stepFiles,
  // (the file is imported like any other: see openPath)
  openPath: (path, fresh) => {
    if (!isDesktop) throw new Error(_t('The web version cannot open files by path; give LaTeX with set'));
    return openPath(path, { ai: true, fresh });
  },
  logChange: logAiChange,
  // the project the open document is in and its latest handoff note (null: it is in none)
  projectFacts: async () => (project ? projectFacts(projectFiles, project) : null),
  records: async () => {
    if (!isDesktop) throw new Error('The web version keeps no records (they are files of the desktop app)');
    await logging; // what is being written is in the answer
    return readRecords(projectFiles, project?.folder || null, pending, currentPath ? NO_RECORDS : NOT_SAVED);
  },
  handoff: async (text) => {
    if (!isDesktop) throw new Error('The web version keeps no records (they are files of the desktop app)');
    const entry = noteEntry(text, new Date());
    const [home, mine] = [project, pending];
    if (!home && currentPath) throw new Error(`${NO_RECORDS} The note was not written.`);
    if (!home) { mine.notes += entry; return { kept: 'This document is not in a project folder yet: the note is kept in memory and written when the document is first saved.' }; }
    await logged(() => appendNote(projectFiles, home.folder, entry));
    return { written: joinPath(home.folder, RECORDS, RECORD_FILES.handoff) };
  },
  // Where an AI may never save, whoever allowed the folder: in the records of a project, and
  // onto an original (the file a document of the projects folder was imported from)
  refuseSave: async (path) => {
    if (!isDesktop) return;
    const root = await projectsRoot().catch(() => null);
    if (inRecords(path)) {
      throw new Error(`${path} is in the records of a project (the folder "${RECORDS}"), which opensw keeps itself: a document cannot be saved there`);
    }
    if (await isOriginal(projectFiles, [root, ...settings().pastProjectsFolders], path, project?.data)) {
      throw new Error(`${path} is the original a document was imported from. opensw does not write an original for an AI, in whatever folder it is: the work is in the copy in the projects folder. Ask the user to use File > Save As to save under a new name, or reopen the file so it can be imported into a project.`);
    }
  },
  documents: openDocuments,
  showDocument: (n) => switchTo(n - 1),
  dropDocument: (n) => { if (n) logDiscarded(others.splice(n - 1, 1)[0]); else dropCurrent(); },
  // an AI asks to close a document without saving it: the user decides
  askDiscard: (name) => askForAi(_t('AI wants to close this document without saving'), name, _t('Its unsaved changes will be lost. OK closes it; Cancel keeps it open.')),
  saveTo: async (path) => {
    if (!isDesktop) throw new Error(_t('The web version cannot save to a path'));
    // a LaTeX file that is the author's only copy is kept as it is, as for File > Save
    const kept = (await latexKept()) ? currentPath : null;
    if (kept && (!path || samePath(path, kept))) throw new Error(_t('This is a LaTeX file 5.x did not write: give a new path, so it is kept as it is'));
    const target = path || currentPath;
    if (!target) throw new Error(_t('Give a path (the .tex file to save to; ending in .sci saves a .sci)'));
    const r = await saveTo(target, aiName());
    // (said to the AI, in English: what was saved is not always the file it named)
    const note = kept ? `The LaTeX file that was open (${kept}) is unchanged; ${r.path} is a new ${kindOf(r.path) === 'sci' ? '.sci' : 'Scientific Word 5.x'} file, and it is the open document now.`
      : !samePath(r.path, target) ? `The document was saved in a project folder of its own: ${r.path}.`
        : r.to55 ? `This was a LaTeX file 5.x did not write; it is saved as a Scientific Word 5.x file now. The LaTeX as it was imported is kept in ${joinPath(project.folder, RECORDS, ORIGINAL)}.` : null;
    return note ? { path: r.path, note } : r.path;
  },
  // was the open document written by Scientific Word 5.x (or is it a 5.x file now, after saving)?
  from55: () => (original55 ? original55.is5x !== false : /\\input\{tcilatex\}/.test(meta.preamble55 || '')),
  // an AI asks to open a file outside the allowed folders (api.js): the user decides
  askAllow: (path) => askForAi(_t('AI wants to open this file'), path,
    _t('It is not in the projects folder, the open document\'s folder or a folder allowed for AI in Tools > User Setup. OK allows it this once.')),
  typesetNow: async () => {
    if (!isDesktop) throw new Error(_t('The web version cannot typeset; get the LaTeX with get'));
    const pics = await texPictureFiles();
    const r = await typeset(texForTypesetting(pics), meta.name || 'document', pics.list, documentFolder());
    review.setErrors(r.errors || []);
    return r;
  },
});
// closing the window with unsaved changes asks first: save, discard, or stay
if (isDesktop) {
  onCloseWindow(async () => (await askSaveAll()) && (await logAllDiscarded(), true)).catch((e) => console.error(_t('Asking before closing is not set up: '), e));
}
setEngineNotice((line) => { console.warn(line); toast(line); });
if (isDesktop) setTimeout(preloadEngine, 3000);
// opened by double-clicking a document: show it
if (isDesktop) {
  startupPath().then(async (p) => {
    if (p) await openPath(p);
  }).catch((e) => toast(_t('Could not open: ') + (e.message || e)));
} // the engine is a local file in the desktop app
if (isDesktop) serveApi((cmd, args, client) => { aiClient = client ? String(client).replace(/[^\x20-\x7e]/g, '').slice(0, 40) : null; return window.sw.call(cmd, args); }).catch((e) => console.error(_t('The AI control channel is not open: '), e));

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
    p(t(_t('File > Samples has demo problems to try the Compute menu on; File > Export turns the document into LaTeX, or Markdown for AI. The shortcuts are those of Scientific Word 5.5; press F1 to see them all.'))),
  ]);
}
