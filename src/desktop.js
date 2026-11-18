// File dialogs, file access and typesetting when the editor runs inside the
// desktop app (Tauri). In a browser none of this is loaded.
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { _t } from './i18n.js';

export const isDesktop = '__TAURI_INTERNALS__' in window;

// Tools > Computation Engine > Mathematica: one Compute-menu operation by the Wolfram kernel
// (src-tauri/src/wolfram.rs). json: the MathJSON text -> the answer object (see opensw_compute.wl)
const toBase64 = (text) => { let s = ''; for (const b of new TextEncoder().encode(text)) s += String.fromCharCode(b); return btoa(s); };
const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
export async function wolframCompute(kernel, op, json) {
  return JSON.parse(fromBase64(await invoke('wolfram_compute', { kernel: kernel || null, op, data: toBase64(json) })));
}

const SCI = [{ name: 'Scientific Word', extensions: ['sci'] }];

// -> { path, bytes } or null when the user cancels
export async function pickAndRead() {
  const path = await open({ multiple: false, filters: [{ name: _t('Scientific Word（.sci、5.x 的 .tex、考卷範本 .qiz）'), extensions: ['sci', 'tex', 'qiz'] }, ...SCI] });
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
// .tex names, written next to it. -> the PDF's path
export function typeset(tex, name, files = []) {
  return invoke('typeset', { tex, name, files: files.map((f) => ({ name: f.name, data: Array.from(f.data) })) });
}

// Lean 4 checks a file in a Lean project with Mathlib (the folder the user chose)
// -> [no errors, Lean's output]
export function leanCheck(project, code) {
  return invoke('lean_check', { project, code });
}
