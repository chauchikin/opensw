// File dialogs, file access and typesetting when the editor runs inside the
// desktop app (Tauri). In a browser none of this is loaded.
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { _t, _tm } from './i18n.js';

// The Rust part's error messages are English; show them in the interface language.
const invoke = (cmd, args) => tauriInvoke(cmd, args).catch((e) => { throw typeof e === 'string' ? _tm(e) : e; });

export const isDesktop = '__TAURI_INTERNALS__' in window;

// Tools > Computation Engine: the engines on this computer (engine/engines.json), and one
// Compute-menu operation by one of them (src-tauri/src/engine.rs). json: the MathJSON text
// -> { answer: the answer object (see ENGINE.md), started: the engine's program was (re)started }
const toBase64 = (text) => { let s = ''; for (const b of new TextEncoder().encode(text)) s += String.fromCharCode(b); return btoa(s); };
const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
export const engineList = () => invoke('engine_list');

// The folder AI may always open and save in without asking (besides the open document's and the
// ones allowed in Tools > User Setup): Documents\\opensw. So a new document an AI writes can be
// saved when nobody is at the computer. null when it cannot be found.
let aiHomeFolder;
export async function aiHome() {
  if (aiHomeFolder === undefined) {
    try {
      const { documentDir, join } = await import('@tauri-apps/api/path');
      aiHomeFolder = (await join(await documentDir(), 'opensw')) || null;
    } catch (e) { aiHomeFolder = null; }
  }
  return aiHomeFolder;
}

// Tools > Connect AI (src-tauri/src/aiconnect.rs): the AI apps on this computer, and adding opensw to one
export const aiApps = () => invoke('ai_apps');
export const aiConnect = (id) => invoke('ai_connect', { id });
export async function engineCompute(engine, program, op, json) {
  const r = await invoke('engine_compute', { engine, program: program || null, op, data: toBase64(json) });
  return { answer: JSON.parse(fromBase64(r.data)), started: r.started };
}

const SCI = [{ name: 'Scientific Word', extensions: ['sci'] }];

// -> { path, bytes } or null when the user cancels
export async function pickAndRead() {
  const path = await open({ multiple: false, filters: [{ name: _t('Scientific Word (.sci, 5.x .tex, exam templates .qiz)'), extensions: ['sci', 'tex', 'qiz'] }, ...SCI] });
  if (!path) return null;
  return { path, bytes: new Uint8Array(await invoke('read_file', { path })) };
}

export async function readPath(path) {
  return new Uint8Array(await invoke('read_file', { path }));
}

// Writes bytes to `path`, or asks where when path is null. -> the path, or null when cancelled
export async function writeBytes(bytes, path, defaultName, filters = SCI) {
  const target = path || (await save({ defaultPath: defaultName, filters }));
  if (!target) return null;
  await invoke('write_file', { path: target, data: Array.from(bytes) });
  return target;
}

// asks where to save (nothing is written) -> the path, or null when cancelled
export const pickSavePath = (defaultName, filters = SCI) => save({ defaultPath: defaultName, filters });

// Tools > Document Manager: whether a file is there; renaming (never over another file); deleting
// (into the Recycle Bin); a folder to copy into (null when cancelled)
export const fileExists = (path) => invoke('file_exists', { path });
export const renameFile = (from, to) => invoke('rename_file', { from, to });
export const trashFiles = (paths) => invoke('trash_files', { paths });
export const pickFolder = () => open({ directory: true, multiple: false });

// File > Open Location: the bytes at a web address (fetched by the desktop shell)
export async function fetchUrl(url) {
  return new Uint8Array(await invoke('fetch_url', { url }));
}

// the document the app was started with (a double-clicked .sci), or null
export function startupPath() {
  return invoke('startup_path');
}

// Closing the window: handler() -> true to close (it may ask the user first)
export async function onCloseWindow(handler) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  await w.onCloseRequested(async (e) => {
    e.preventDefault();
    if (await handler()) await w.destroy();
  });
}

// Before a file is overwritten its old version is kept as name.bak (as 5.5 does)
export async function backupFile(path) {
  let old;
  try { old = await invoke('read_file', { path }); } catch (e) { return; } // a new file
  await invoke('write_file', { path: path.replace(/\.[^.\\/]*$/, '') + '.bak', data: old });
}

// AI agents' commands arrive from the desktop shell (remote.rs) and go to handler(cmd, args)
export async function serveApi(handler) {
  const { listen } = await import('@tauri-apps/api/event');
  await listen('sw-api', async (e) => {
    const { id, cmd, args } = e.payload;
    const reply = await handler(cmd, args);
    await invoke('api_reply', { id, reply: JSON.stringify(reply) });
  });
  await invoke('api_ready');
}

// LaTeX -> PDF, opened in the system PDF viewer. files: [{ name, data }] pictures the
// .tex names, written next to it; folder: the document's own folder (null: not saved), where
// the other files it names are (a program listing, a part read in with \input, a .bib).
// -> { pdf: its path, errors: what TeX reported (the PDF comes out anyway, as in 5.5, but
// those parts may be wrong) }. mode: 'open' (the default), 'print' (sent to the printer) or 'none'
export async function typeset(tex, name, files = [], folder = null, mode = 'open') {
  const r = await invoke('typeset', { tex, name, files: files.map((f) => ({ name: f.name, data: Array.from(f.data) })), folder, mode });
  return typeof r === 'string' ? { pdf: r, errors: [] } : r;
}

// Lean 4 checks a file in a Lean project with Mathlib (the folder the user chose)
// -> [no errors, Lean's output]
export function leanCheck(project, code) {
  return invoke('lean_check', { project, code });
}
