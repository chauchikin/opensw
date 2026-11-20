// A stand-in for the desktop shell (the Rust part of the desktop app), for the tests: files kept
// in memory, and the commands the page sends to the shell answered from them.
//
//   import { standIn, ROOT } from './lib/desktop.mjs';
//   await standIn(page, { files: { 'D:\\Papers\\a.tex': '...' }, settings: { ... } });   // before page.goto
//
// In the page, window.shell then has: files (Map: path -> bytes as an array), writes (every path
// written or copied to, in order), folders (made with make_folder), asked (the default paths of
// the save dialogs), pick (what the next save dialog answers), open (what the open dialog
// answers), shown (the paths shown in their folder), typeset (the TeX of each typeset run),
// toasts (every message the editor showed), trashed (what went to the Recycle Bin), fail ({ command: message }: that command fails), on ({ command: (args) => answer }:
// a test's own answer to a command) and send(cmd, args, client): a command sent to the page as
// the MCP channel sends it, client being the AI app's name -> the page's reply.
// The projects folder is ROOT (the Desktop's "opensw projects"): a file in a folder of it is
// opened as it is; a file anywhere else is imported into it.
export const DESKTOP = 'C:\\Users\\prof\\Desktop';
export const DOCUMENTS = 'C:\\Users\\prof\\Documents';
export const ROOT = DESKTOP + '\\opensw projects';

// Files in memory, as the shell's file commands see them (also used without a browser, by
// test/projects.mjs). initial: { path: text or bytes }. caseBlind: letter case does not tell two
// names apart, as on a Windows disk (a file keeps the case it was first written with). links:
// { folder: the folder it really is }: a second name for a folder (a junction, a mapped drive)
export function memoryFiles(initial = {}, { caseBlind = false, links = {} } = {}) {
  const bytes = (v) => (typeof v === 'string' ? Array.from(new TextEncoder().encode(v)) : Array.from(v));
  const sep = (p) => (p.includes('\\') ? '\\' : '/');
  // a path as the disk sees it: "." and ".." worked out; on a case-blind (Windows) disk also
  // \\?\ in front left out and the dots and spaces a name ends with dropped, and \ for /
  const real = (given) => {
    const path = caseBlind ? given.replace(/^\\\\\?\\/, '').replace(/\//g, '\\') : given;
    const out = [];
    for (const x of path.split(/[\\/]/)) { if (x === '..') out.pop(); else if (x !== '.') out.push(caseBlind && out.length ? x.replace(/[. ]+$/, '') : x); }
    let at = out.join(sep(path));
    const same = (a, b) => (caseBlind ? a.toLowerCase() === b.toLowerCase() : a === b);
    for (const [from, to] of Object.entries(links)) {
      if (same(at, from)) at = to;
      else if (same(at.slice(0, from.length + 1), from + sep(from))) at = to + at.slice(from.length);
    }
    return at;
  };
  const low = (path) => (caseBlind ? path.toLowerCase() : path);
  const files = new Map(Object.entries(initial).map(([path, v]) => [real(path), bytes(v)]));
  const folders = new Set();
  const writes = [];
  const trashed = [];
  // the name a file has on the disk (on a case-blind disk: the one it was written with)
  const find = (path) => {
    const r = real(path);
    if (files.has(r) || !caseBlind) return r;
    for (const k of files.keys()) if (k.toLowerCase() === r.toLowerCase()) return k;
    return r;
  };
  const under = (path, folder) => low(path).startsWith(low(folder) + sep(folder));
  const m = {
    files, folders, writes, trashed, real,
    exists: (path) => files.has(find(path)),
    folderExists: (path) => [...folders].some((f) => low(f) === low(real(path)) || under(f, real(path))) || [...files.keys()].some((k) => under(k, real(path))),
    read: (path) => { if (!m.exists(path)) throw new Error(`Cannot read ${path}: no such file`); return files.get(find(path)); },
    write: (path, data) => { files.set(find(path), bytes(data)); writes.push(find(path)); },
    append: (path, data) => { files.set(find(path), [...(files.get(find(path)) || []), ...bytes(data)]); writes.push(find(path)); },
    // fresh: a folder that is there already is an error (the shell makes the last folder itself)
    makeFolder: (path, fresh = false) => {
      if (fresh && m.folderExists(path)) throw new Error(`${path} already exists`);
      folders.add(real(path));
    },
    copy: (from, to) => {
      if (m.exists(to)) throw new Error(`${to} already exists`);
      m.write(to, m.read(from));
    },
    // to the Recycle Bin: files, and folders with what is in them
    trash: (paths) => {
      for (const p of paths.map(real)) {
        trashed.push(p);
        for (const k of [...files.keys()]) if (low(k) === low(p) || under(k, p)) files.delete(k);
        for (const f of [...folders]) if (low(f) === low(p) || under(f, p)) folders.delete(f);
      }
    },
    // what is directly in a folder: [{ name, dir }]
    list: (at) => {
      const folder = real(at);
      const found = new Map();
      for (const path of [...files.keys(), ...folders]) {
        if (!under(path, folder)) continue;
        const rest = path.slice(folder.length + 1).split(/[\\/]/);
        found.set(rest[0], found.get(rest[0]) || rest.length > 1 || folders.has(path));
      }
      return [...found].map(([name, dir]) => ({ name, dir }));
    },
    // as the shell's copy_named_files, in short: every {name} of the text that is a file in
    // `from` (also with .tex or .bib added) is copied into `to` unless it is there; the .tex
    // files found are looked through too -> the names copied
    copyNamed: (tex, from, to) => {
      const copied = [];
      const tried = new Set();
      const texts = [tex];
      while (texts.length) {
        for (const [, group] of texts.pop().matchAll(/\{([^{}\\\s]*)\}/g)) {
          for (const name of group.split(',')) {
            for (const ext of ['', '.tex', '.bib']) {
              const rel = name + ext;
              if (!name || tried.has(rel) || /^\/|\.\.|[:\\]/.test(rel)) continue;
              tried.add(rel);
              const [source, target] = [from, to].map((dir) => dir + sep(dir) + rel.replace(/\//g, sep(dir)));
              if (!m.exists(source)) continue;
              if (!m.exists(target)) { m.write(target, m.read(source)); copied.push(rel); }
              if (rel.endsWith('.tex')) texts.push(new TextDecoder().decode(Uint8Array.from(m.read(source))));
            }
          }
        }
      }
      return copied;
    },
  };
  return m;
}

// runs in the page (with memoryFiles), before the page's own scripts
function install(o) {
  // eslint-disable-next-line no-undef
  const mem = memoryFiles(o.files, { caseBlind: o.caseBlind, links: o.links });
  const shell = { ...mem, asked: [], pick: null, open: null, shown: [], typeset: [], fail: {}, on: {} };
  window.shell = shell;
  const commands = {
    read_file: (a) => mem.read(a.path),
    write_file: (a) => { mem.write(a.path, a.data); return null; },
    append_file: (a) => { mem.append(a.path, a.data); return null; },
    folder_exists: (a) => mem.folderExists(a.path),
    file_exists: (a) => mem.exists(a.path),
    real_path: (a) => mem.real(a.path),
    list_folder: (a) => mem.list(a.path),
    make_folder: (a) => { mem.makeFolder(a.path, a.fresh); return null; },
    copy_file: (a) => { mem.copy(a.from, a.to); return null; },
    copy_named: (a) => mem.copyNamed(a.tex, a.from, a.to),
    rename_file: (a) => { if (mem.exists(a.to)) throw new Error(`${a.to} already exists`); const old = mem.read(a.from); mem.trash([a.from]); mem.trashed.pop(); mem.write(a.to, old); return null; },
    trash_files: (a) => { mem.trash(a.paths); return null; },
    startup_path: () => o.startup || null,
    typeset: (a) => { shell.typeset.push(a.tex); return 'C:\\cache\\doc.pdf'; },
    'plugin:path|resolve_directory': (a) => {
      const dir = { 18: o.desktop, 6: o.documents }[a.directory];
      if (!dir) throw new Error('no such folder on this computer');
      return dir;
    },
    'plugin:path|join': (a) => a.paths.join('\\'),
    'plugin:dialog|save': (a) => { shell.asked.push(a.options?.defaultPath); return shell.pick; },
    'plugin:dialog|open': () => shell.open,
    'plugin:opener|reveal_item_in_dir': (a) => { shell.shown.push(a.paths[0]); return null; },
  };
  // the page listens for the AI's commands (the event sw-api) and answers with api_reply
  const callbacks = [];
  const waiting = new Map();
  commands['plugin:event|listen'] = (a) => { shell.listeners[a.event] = callbacks[a.handler - 1]; return a.handler; };
  commands.api_reply = (a) => { waiting.get(a.id)?.(JSON.parse(a.reply)); waiting.delete(a.id); return null; };
  shell.listeners = {};
  shell.send = (cmd, args = {}, client = null) => new Promise((resolve) => {
    const id = waiting.size + 1;
    waiting.set(id, resolve);
    shell.listeners['sw-api']({ event: 'sw-api', id: 0, payload: { id, cmd, args, client } });
  });
  window.__TAURI_INTERNALS__ = {
    transformCallback: (callback) => callbacks.push(callback),
    invoke: async (cmd, args) => {
      if (shell.fail[cmd]) throw `${shell.fail[cmd]}`; // (the shell's errors are plain texts)
      if (shell.on[cmd]) return shell.on[cmd](args);
      try { return commands[cmd] ? commands[cmd](args) : null; } catch (e) { throw String(e.message); }
    },
  };
  if (o.settings) localStorage.setItem('opensw-settings', JSON.stringify(o.settings));
  // every message the editor shows (a later one takes the place of the one on screen)
  shell.toasts = [];
  document.addEventListener('DOMContentLoaded', () => {
    const toast = document.querySelector('#toast');
    new MutationObserver(() => { if (!toast.hidden && toast.textContent && shell.toasts.at(-1) !== toast.textContent) shell.toasts.push(toast.textContent); }).observe(toast, { childList: true, characterData: true, subtree: true, attributes: true });
  });
}

// files: { path: text or bytes }; settings: Tools > User Setup's, as stored; startup: the file the
// program is started with; desktop: null for a computer without a Desktop folder; caseBlind: a disk
// that does not tell names apart by letter case (Windows); links: { folder: the folder it really
// is } (a junction, a mapped drive: a second name for a folder)
export function standIn(page, { files = {}, settings = null, startup = null, desktop = DESKTOP, documents = DOCUMENTS, caseBlind = false, links = {} } = {}) {
  const given = Object.fromEntries(Object.entries(files).map(([p, v]) => [p, typeof v === 'string' ? v : Array.from(v)]));
  return page.addInitScript({ content: `${memoryFiles.toString()}\n(${install.toString()})(${JSON.stringify({ files: given, settings, startup, desktop, documents, caseBlind, links })});` });
}

// The records that make a folder a project (its project.json), for a test whose document is to
// be opened and saved where it is: { ...inProject(folder, 'a.tex'), [folder + '\\a.tex']: text }
export const inProject = (folder, main, source = null) => ({
  [`${folder}\\opensw records\\project.json`]: JSON.stringify(source ? { source, sourceSha256: '', imported: '2026-01-02T01:05:00.000Z', main } : { source: null, created: '2026-01-02T01:05:00.000Z', main }),
});
// a file of the stand-in as text (null: there is none), and all its paths
export const fileText = (page, path) => page.evaluate((p) => { const d = window.shell.files.get(p); return d ? new TextDecoder().decode(Uint8Array.from(d)) : null; }, path);
export const filePaths = (page) => page.evaluate(() => [...window.shell.files.keys()]);
// the messages the editor showed so far (the engine's start-up message can take the place of one on screen)
export const toasts = (page) => page.evaluate(() => window.shell.toasts);
