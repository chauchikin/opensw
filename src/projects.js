// Projects: where the desktop app keeps the documents it works on.
//
// Opening a file imports it: the file and the files it uses are copied into a folder of their own,
//   <Desktop>\opensw projects\<file name>_<date>\
// and the editor works on that copy. The file that was opened is not written (only the user can
// have it written, by choosing that very file in File > Save As; an AI never can). Each such
// folder has a folder of records, "opensw records":
//   Change log.txt     what was done to the document and when (written here, never left to an AI)
//   File map.txt       what is in the folder and where the document came from (rewritten at each save)
//   Handoff notes.txt  what an AI leaves for whoever goes on with the work (its handoff command)
//   project.json       the same facts for the program: { source, sourceSha256, imported, main, copied ... }
//   Original\          the main file exactly as it was imported; never written again
// The three .txt records are for a person to read: plain English, whatever the interface language is.
//
// A folder is a project only when it has that project.json and its main file: any other folder of the
// projects folder is outside, and imported like a file from anywhere. Nothing in a project's
// records is opened in place or saved over.
//
// Nothing here touches the disk itself. Every function that needs files is given `files`:
//   read(path) -> bytes (an error when there is no such file)     write(path, bytes) (makes the folders)
//   append(path, bytes) (to the end of the file; makes it when there is none)
//   exists(path) -> is there such a file     list(folder) -> [{ name, dir }] ([] when there is no such folder)
//   makeFolder(path, fresh) (fresh: an error when it is there already)
//   copy(from, to) (never over a file that is there)     trash(paths) (to the Recycle Bin, folders too)
//   copyNamed(tex, from, to) -> the files a TeX text names in folder `from`, copied into `to`
//     (the desktop shell's copy_named_files, which typesetting uses too)
// so the tests run all of it on files kept in memory (test/projects.mjs).
import { candidates } from './graphics.js';

// the names, in this one place
export const PROJECTS_FOLDER = 'opensw projects';
export const RECORDS = 'opensw records';
export const RECORD_FILES = { changeLog: 'Change log.txt', fileMap: 'File map.txt', handoff: 'Handoff notes.txt' };
export const ORIGINAL = 'Original';
const PROJECT_JSON = 'project.json';

// ---------- paths (as Windows or Unix writes them)

const sepOf = (p) => (p.includes('\\') ? '\\' : '/');
export const joinPath = (dir, ...names) => [dir.replace(/[\\/]+$/, ''), ...names.map((n) => n.replace(/[\\/]/g, sepOf(dir)))].join(sepOf(dir));
export const folderOf = (p) => p.replace(/[\\/][^\\/]*$/, '');
export const nameOf = (p) => p.split(/[\\/]/).pop();
export const stemOf = (p) => nameOf(p).replace(/\.[^.]*$/, '');
// a file named with a full path, or with ".." in it: not in the document's own folder
const outside = (name) => /^([a-zA-Z]:|[\\/])|(^|[\\/])\.\.([\\/]|$)/.test(name);

// The folders and the name of a full path as the disk takes them: "." and ".." worked out, and
// for a Windows path (a drive letter or \\server) the \\?\ in front left out and the dots and
// spaces a name ends with dropped, as Windows drops them. same: for comparing two paths, so
// in small letters too, for on Windows letter case tells no two files apart.
// (A mapped drive against its \\server name, and 8.3 short names, cannot be told from here.)
function parts(path, same = false) {
  const p = String(path).replace(/^[\\/]{2}\?[\\/]UNC[\\/]/i, '\\\\').replace(/^[\\/]{2}\?[\\/]/, '');
  const windows = /^[a-z]:|^[\\/]{2}/i.test(p);
  const out = [];
  for (let x of p.split(/[\\/]+/)) {
    if (x === '..') { out.pop(); continue; }
    if (windows && x !== '.') x = x.replace(/[. ]+$/, '');
    if (x === '.' || x === '') continue;
    out.push(same && windows ? x.toLowerCase() : x);
  }
  return out;
}
// the same file, however its path is spelled
export const samePath = (a, b) => parts(a, true).join('/') === parts(b, true).join('/');
// Is `path` in `folder` (or a folder inside it)? Full paths (a relative path is not)
export function insideFolder(path, folder) {
  if (!/^([a-z]:)?[\\/]/i.test(path)) return false;
  const f = parts(folder, true);
  const p = parts(path, true);
  return f.length > 0 && f.length < p.length && f.every((x, i) => x === p[i]);
}
// Records are recognised by folder name wherever the project was moved, including the folder itself.
export function inRecords(path) {
  return parts(path).some((p) => p.toLowerCase() === RECORDS.toLowerCase());
}
// The folder directly under the projects folder `root` that a file is in, going by its path
// alone: null for a file anywhere else, for one lying in the projects folder itself and for one
// in a folder's records. Whether that folder is a project is another matter: see projectAt.
export function projectOf(path, root) {
  if (!path || !root || !insideFolder(path, root) || inRecords(path, root)) return null;
  const p = parts(path);
  const n = parts(root).length;
  return p.length >= n + 2 ? joinPath(root, p[n]) : null;
}

// ---------- dates and text files

const two = (n) => String(n).padStart(2, '0');
export const dateOf = (d) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
export const timeOf = (d) => `${dateOf(d)} ${two(d.getHours())}:${two(d.getMinutes())}`;

// The records open in Notepad on any Windows: UTF-8 with its mark at the start, lines ending \r\n
const crlf = (text) => text.replace(/\r?\n/g, '\r\n');
const toText = (bytes) => new TextDecoder().decode(bytes).replace(/^\ufeff/, '').replace(/\r\n/g, '\n');
const readText = async (files, path) => ((await files.exists(path)) ? toText(await files.read(path)) : '');
const writeText = (files, path, text) => files.write(path, new TextEncoder().encode('\ufeff' + crlf(text)));
// to the end of a record; head: what a new file starts with
async function appendText(files, path, text, head = '') {
  if (await files.exists(path)) await files.append(path, new TextEncoder().encode(crlf(text)));
  else await writeText(files, path, head + text);
}

export async function sha256(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- the folders

// <name>_<date>; when there is one already (the same name imported twice on one day) _2, _3 ...
export function folderName(stem, date, taken) {
  const have = new Set(taken.map((n) => n.toLowerCase()));
  let name = `${stem}_${date}`;
  for (let k = 2; have.has(name.toLowerCase()); k++) name = `${stem}_${date}_${k}`;
  return name;
}
// A new folder for a document. The disk says whether a name is free (making a folder that is
// there fails), so two documents of one name saved at the same moment get a folder each.
export async function makeProjectFolder(files, root, stem, now) {
  await files.makeFolder(root);
  const taken = (await files.list(root)).map((e) => e.name);
  for (let tries = 0; ; tries++) {
    const name = folderName(stem, dateOf(now), taken);
    try { await files.makeFolder(joinPath(root, name), true); return joinPath(root, name); } catch (e) {
      if (tries > 20) throw e;
      taken.push(name);
    }
  }
}

const jsonPath = (folder) => joinPath(folder, RECORDS, PROJECT_JSON);
// A folder's project.json. -> { exists: there is such a file, data: what it says (null: there is
// none, or it cannot be read just now, or it is not what opensw wrote) }
export async function projectState(files, folder) {
  let exists = false;
  try {
    exists = await files.exists(jsonPath(folder));
    const data = exists ? JSON.parse(new TextDecoder().decode(await files.read(jsonPath(folder)))) : null;
    return { exists, data: data && typeof data === 'object' && typeof data.main === 'string' ? data : null };
  } catch (e) { return { exists, data: null }; }
}
export const readProject = async (files, folder) => (await projectState(files, folder)).data;
const writeProject = (files, folder, project) => files.write(jsonPath(folder), new TextEncoder().encode(JSON.stringify(project, null, 2) + '\n'));
// The nearest ancestor with readable records and its main document, wherever the file is.
export async function projectAt(files, path) {
  if (!path || inRecords(path) || !/^([a-z]:)?[\\/]/i.test(path)) return null;
  const sep = sepOf(path);
  const names = parts(path);
  const drive = /^[a-z]:$/i.test(names[0]);
  const prefix = drive ? '' : /^[\\/]{2}/.test(path) ? sep + sep : sep;
  const min = drive ? 1 : prefix.length === 2 ? 2 : 0; // stop at the drive, share or Unix root
  names.pop();
  while (names.length >= min) {
    const folder = prefix + names.join(sep) + (drive && names.length === 1 ? sep : '');
    const data = await readProject(files, folder);
    if (data && (folder === sep || insideFolder(joinPath(folder, data.main), folder)) && (await files.exists(joinPath(folder, data.main)).catch(() => false))) return { folder, data };
    if (names.length === min) break;
    names.pop();
  }
  return null;
}
// Direct child projects in the current and past projects folders; unavailable roots are skipped.
async function allProjects(files, roots) {
  const out = [];
  const seen = [];
  for (const root of (Array.isArray(roots) ? roots : [roots]).filter(Boolean)) {
    if (inRecords(root) || seen.some((p) => samePath(p, root))) continue;
    seen.push(root);
    let entries;
    try { entries = await files.list(root); } catch (e) { continue; }
    for (const e of entries) {
      if (!e.dir) continue;
      const folder = joinPath(root, e.name);
      if (inRecords(folder)) continue;
      const data = await readProject(files, folder);
      if (out.some((p) => samePath(p.folder, folder))) continue;
      if (data) out.push({ folder, data });
    }
  }
  return out;
}
// Is `path` the file some project was imported from (an original)? `own`: the open document's
// project data, which counts also when its folder is not in any of `root` (one folder or a list).
export async function isOriginal(files, root, path, own = null) {
  if (own?.source && samePath(own.source, path)) return true;
  return (await allProjects(files, root)).some((p) => p.data.source && samePath(p.data.source, path));
}

// The earlier imports of the file `source` whose copy is still there, the newest first:
// [{ folder, path (the copy: the project's main document), project (its project.json), how }]
// how 'path': the same file. When there is none of those, how 'contents': a file of the same
// name and the same contents (sha: its SHA-256) that was imported from another path, which may be
// this file under another name (a mapped drive and its \\server name) or may be another file.
// own: the open document's project, which counts outside every current or past projects folder.
export async function findImports(files, root, source, sha = null, own = null) {
  const found = [];
  const projects = await allProjects(files, root);
  if (own && !projects.some((p) => samePath(p.folder, own.folder))) projects.push(own);
  for (const { folder, data: project } of projects) {
    if (!project.source) continue;
    const how = samePath(project.source, source) ? 'path'
      : sha && project.sourceSha256 === sha && nameOf(project.source).toLowerCase() === nameOf(source).toLowerCase() ? 'contents' : null;
    const path = joinPath(folder, project.main);
    if (how && (await files.exists(path).catch(() => false))) found.push({ folder, path, project, how });
  }
  const best = found.some((f) => f.how === 'path') ? 'path' : 'contents';
  return found.filter((f) => f.how === best).sort((a, b) => (a.project.imported < b.project.imported ? 1 : -1));
}

// Where a save goes. root: the projects folder; project: the folder of the project the open
// document is in (null: it is in none); current: its file (null: it has none yet); target: the
// file asked for. What is being edited is always in the projects folder:
// -> { refuse: 'records' }: a project's records are no place for a document
//  | { write: the file that is (or stays) the open document }
//  | { folder, name }: a new project folder is made for this name, with this file in it
//  and with the last two, copy: a copy is also written there (a target outside the projects folder).
// A new document always gets a folder of its own, wherever the user pointed. A document in a
// project stays there, or goes on under another name in its own folder; saved anywhere else in
// the projects folder it becomes a project of its own. A document that was opened in place (its
// import failed and the user said so) is saved as opensw 0.11.0 did: outside the projects folder
// the target becomes the open document.
export function savePlan({ root, project = null, current = null, target }) {
  if (inRecords(target)) return { refuse: 'records' };
  if (project && insideFolder(target, project)) return { write: target };
  const own = { folder: stemOf(target), name: nameOf(target) };
  if (root && insideFolder(target, root)) return own;
  if (project) return { write: current, copy: target };
  return !current && root ? { ...own, copy: target } : { write: target };
}

// ---------- the files a document uses

// what a picture named without its ending may be (\includegraphics{figs/plot})
const PICTURE_ENDINGS = ['.pdf', '.png', '.jpg', '.jpeg', '.eps', '.bmp', '.gif', '.svg', '.wmf'];
// Where the files a document names are, looked for in its folder `dir`. pictures: as the document
// names them, found where loadPictures looks (graphics.js candidates); others: sub-documents and
// .bib files. -> { found: [[name, its full path]], notFound: [names], outside: [names] (a full
// path or "..": such a file is not looked for in the folder, except a picture 5.x also kept there)
export async function locate(files, dir, pictures, others) {
  const out = { found: [], notFound: [], outside: [] };
  for (const name of new Set(pictures)) {
    let at = null;
    const endings = /\.[a-z0-9]+$/i.test(nameOf(name)) ? [''] : ['', ...PICTURE_ENDINGS];
    for (const c of candidates(dir, name).flatMap((c) => endings.map((e) => c + e))) {
      if (insideFolder(c, dir) && (await files.exists(c))) { at = c; break; }
    }
    if (at) out.found.push([name, at]); else (outside(name) ? out.outside : out.notFound).push(name);
  }
  for (const name of new Set(others)) {
    const at = joinPath(dir, name);
    if (outside(name)) out.outside.push(name);
    else if (await files.exists(at)) out.found.push([name, at]); else out.notFound.push(name);
  }
  return out;
}
// a file's path as seen from the folder it is in or under, with / between the parts
const relative = (path, dir) => parts(path).slice(parts(dir).length).join('/');
// the steps file that belongs to a document (steps.js)
const stepsName = (name) => name.replace(/\.[^.]+$/, '') + '.steps.json';

// ---------- importing

// Copies the file `source` (its bytes; tex: its text when it is a TeX file) and the files it uses
// into a new folder in the projects folder `root`, with the first records.
// pictures, others: what the document names (see locate); usesOf(bytes) -> { pictures, others }:
// what a sub-document names in its turn (its pictures come along too, and those of the
// sub-documents it reads in: two levels); facts: { texFields, latex } for the report.
// -> the report { from, folder, path (the copy), size, copied, notFound, notCopied, texFields, latex,
//    project (what its project.json says) }
// project.json is written last: a folder without it is no project. When the import fails the
// folder it began goes to the Recycle Bin; the error says so (error.left: the folder, when it
// could not be taken away).
export async function importDocument(files, { root, source, bytes, tex = null, pictures = [], others = [], usesOf = null, facts = {}, now }) {
  const name = nameOf(source);
  const from = folderOf(source);
  const folder = await makeProjectFolder(files, root, stemOf(source), now);
  try {
    const path = joinPath(folder, name);
    await files.write(path, bytes);
    await files.write(joinPath(folder, RECORDS, ORIGINAL, name), bytes);
    const where = await locate(files, from, pictures, others);
    // what the sub-documents name: found like the document's own, from the document's folder
    let subs = where.found.filter(([n]) => others.includes(n) && /\.tex$/i.test(n));
    const asked = new Set([...pictures, ...others]);
    for (let level = 0; usesOf && subs.length && level < 2; level++) {
      const named = { pictures: [], others: [] };
      for (const [, at] of subs) {
        const uses = await usesOf(await files.read(at));
        for (const kind of ['pictures', 'others']) for (const n of uses[kind]) if (!asked.has(n)) { asked.add(n); named[kind].push(n); }
      }
      const more = await locate(files, from, named.pictures, named.others);
      for (const kind of ['found', 'notFound', 'outside']) where[kind].push(...more[kind]);
      subs = more.found.filter(([n]) => named.others.includes(n) && /\.tex$/i.test(n));
    }
    const copied = [];
    // (on a Windows disk Graphics/PIC.png and graphics/pic.png are one file: copied once)
    const have = new Set();
    for (const at of [...where.found.map((f) => f[1]), joinPath(from, stepsName(name))]) {
      const rel = relative(at, from);
      if (have.has(rel.toLowerCase()) || !(await files.exists(at)) || (await files.exists(joinPath(folder, rel)))) continue;
      await files.copy(at, joinPath(folder, rel));
      have.add(rel.toLowerCase());
      copied.push(rel);
    }
    // what else the text names in its folder: a program listing, the files a sub-document reads in ...
    if (tex != null) for (const rel of await files.copyNamed(tex, from, folder)) if (!have.has(rel.toLowerCase())) { have.add(rel.toLowerCase()); copied.push(rel); }
    const project = { source, sourceSha256: await sha256(bytes), imported: now.toISOString(), main: name, copied, notFound: where.notFound, notCopied: where.outside };
    const report = { from: source, folder, path, size: bytes.length, copied, notFound: where.notFound, notCopied: where.outside, texFields: facts.texFields || 0, latex: !!facts.latex };
    await appendText(files, joinPath(folder, RECORDS, RECORD_FILES.changeLog), importEntry(report, now), logHead(name));
    await ensureNotes(files, folder, name);
    await writeFileMap(files, { folder, project, pictures, others, now });
    await writeProject(files, folder, project);
    return { ...report, project };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    try { await files.trash([folder]); } catch (kept) { error.left = folder; }
    throw error;
  }
}

// ---------- the records

const heading = (now, what) => `==== ${timeOf(now)}  ${what} ====\n`;
const logHead = (name) => `Change log for ${name}\nWritten by opensw. Each entry says what was done to the document and when; the newest is at the end.\n\n`;
const notesHead = (name) => `Handoff notes for ${name}\nNotes an AI assistant leaves for whoever goes on with the work; the newest is at the end. There are no notes yet when this file is created.\n\n`;
async function ensureNotes(files, folder, main) {
  const path = joinPath(folder, RECORDS, RECORD_FILES.handoff);
  if (!(await files.exists(path))) await writeText(files, path, notesHead(main));
}
const listed = (names) => `(${names.length}): ${names.join(', ')}`;
const CUT = 400; // a long text in the change log is cut here
export const cut = (text) => (text.length > CUT ? text.slice(0, CUT) + '…' : text);
const indented = (text) => (text.trim() ? text.trim().split('\n').map((l) => '  ' + l).join('\n') : '  (nothing)');
// Two texts that are to be compared by eye, each cut to CUT characters: when they begin alike,
// the cut starts shortly before the first difference, so that the difference is in what is shown
function excerpts(before, after) {
  let same = 0;
  while (same < before.length && same < after.length && before[same] === after[same]) same++;
  const from = same > CUT / 2 ? Math.max(0, before.lastIndexOf(' ', same - 60)) : 0;
  const part = (t) => (from ? '…' : '') + t.slice(from, from + CUT).trim() + (t.length > from + CUT ? '…' : '');
  return [part(before.trim() ? before : ''), part(after.trim() ? after : '')];
}

export function importEntry(r, now) {
  return heading(now, 'Imported')
    + `From: ${r.from} (${r.size} bytes)\n`
    + `Copied into: ${r.folder}\n`
    + 'opensw works on this copy. Saving writes the copy; the file it was imported from is written only if you choose that very file yourself (in File > Save As, or as the place for Tools > Document Manager > Copy).\n'
    + `Files copied with it ${r.copied.length ? listed(r.copied) : '(0)'}\n`
    + (r.notFound.length ? `Named in the document but not found ${listed(r.notFound)}\n` : '')
    + (r.notCopied.length ? `Not copied because they are outside the document's folder ${listed(r.notCopied)}\n` : '')
    + (r.texFields ? `Commands opensw does not know, kept as they are in grey TeX fields: ${r.texFields}\n` : '')
    + (r.latex ? `This is a LaTeX file that Scientific Word 5.x did not write. Save will write it as a Scientific Word 5.x file; the LaTeX as imported stays in ${RECORDS}\\${ORIGINAL}.\n` : '')
    + '\n';
}
const LISTED = 8; // at most so many changed blocks are shown in one entry
// One AI command that changed the document. changes: what differs, each
// { at: the block's number counted from 1, removed, added: how many blocks went and came there,
//   before, after: their text }; settings: what is not text changed too (the preamble ...).
// Blocks are numbered as a person counts them, from 1 (the AI's commands count from 0).
export function changeEntry({ who, command, changes, settings = false }, now) {
  const one = changes.length === 1 ? changes[0] : null;
  const span = (c) => (c.removed > 1 ? `blocks ${c.at} to ${c.at + c.removed - 1}` : `block ${c.at}`);
  const many = (n) => (n > 1 ? `${n} blocks` : 'one block');
  const what = !changes.length ? 'changed the document\'s settings, not its text'
    : !one ? `changed ${changes.length} blocks`
      : !one.removed ? `put in ${many(one.added)} ${one.at > 1 ? `after block ${one.at - 1}` : 'at the start'}`
        : !one.added ? `took out ${span(one)}`
          : one.removed === one.added ? `changed ${span(one)}` : `replaced ${span(one)} by ${many(one.added)}`;
  let text = heading(now, `${who} ${what} [command: ${command}]`);
  for (const c of changes.slice(0, LISTED)) {
    const [before, after] = excerpts(c.before, c.after);
    text += (one ? '' : `Block ${c.at}\n`) + `Before:\n${indented(before)}\nAfter:\n${indented(after)}\n`;
  }
  if (changes.length > LISTED) text += `... and ${changes.length - LISTED} more blocks changed, which are not listed here.\n`;
  if (settings) text += changes.length ? 'The document\'s settings changed too (what TeX reads before the text: the preamble, the title page).\n' : 'What changed is what TeX reads before the text (the preamble, the title page). The text is as it was.\n';
  return text + '\n';
}
// The user took the AI's changes back (Edit > Undo AI Changes), so the entries above no longer
// say what is in the document. since: when the first of those changes was logged
export function undoEntry(since, now) {
  return heading(now, 'The user undid the AI\'s changes')
    + `The changes an AI made from ${since} on (the entries above) were taken back by the user, with Edit > Undo AI Changes. They are no longer in the document.\n\n`;
}
// What a copy saved outside the project is: one file. Said in the change log and to an AI (the
// user is told the same in the interface's language, main.js). A .tex names its pictures and
// sub-documents as files beside it, and those are not copied with it; Tools > Document Manager >
// Copy copies the document with the pictures and sub-documents of its folder.
export const copyNote = (copy) => (/\.sci$/i.test(copy) ? 'The copy is one .sci file, with its pictures inside it.'
  : 'Only the document file was copied, not the pictures and sub-documents it uses. Tools > Document Manager > Copy takes those along.');
// name: the file saved; copy: where a copy went too; onto: that copy took the place of the
// original the document was imported from (only the user can do that)
export function saveEntry({ by, name, copy, onto = false }, now) {
  return heading(now, `Saved by ${by}`) + `File: ${name}\n`
    + (copy ? `A copy was also saved to: ${copy}\n${copyNote(copy)}\n` : '')
    + (onto ? 'That file is the original this document was imported from. It was written over because the user chose it in File > Save As.\n' : '')
    + '\n';
}
// The user had the original written over in the other way there is: Tools > Document Manager >
// Copy, into the original's folder. The log and project.json get it, so that no record goes on
// saying the original is not written. -> the project's data (null: not readable, left alone)
// pictures, others: what the open document names (for the file map, written again)
export async function recordOriginalWritten(files, folder, { pictures = [], others = [], now }) {
  const { data } = await projectState(files, folder);
  if (!data?.source) return null;
  const next = { ...data, originalWritten: now.toISOString() };
  await writeProject(files, folder, next);
  await appendText(files, joinPath(folder, RECORDS, RECORD_FILES.changeLog), heading(now, 'The user copied the document over the original')
    + `With Tools > Document Manager > Copy the document as last saved was copied to ${data.source}, the file it was imported from, and took its place.\n\n`, logHead(data.main));
  await writeFileMap(files, { folder, project: next, pictures, others, now });
  return next;
}
// A document was closed with changes that were not saved (the user chose so), after an AI
// changed it: n entries above are for changes that are not in the file
export const closedEntry = (n, now) => heading(now, 'Closed without saving')
  + `The document was closed and the user chose not to save it. What was changed since the last save is not in the file: that goes for the last ${n > 1 ? `${n} entries above about changes an AI made` : 'entry above about a change an AI made'}.\n\n`;
// the records of a project were not there at a save (see recordSave) and were made again
const remadeEntry = (folder, now) => heading(now, 'These records were made again')
  + `At this save the records of ${folder} were not found: the folder was renamed, moved or deleted while the document was open. The user chose to save here again, and opensw made the folder and these records again. What was recorded before is in the old records, if they still exist.\n\n`;
// (the note's lines are set in: a line of it can never be taken for a heading)
export const noteEntry = (text, now) => `==== ${timeOf(now)} ====\n${indented(text.replace(/\r\n?/g, '\n'))}\n\n`;

// the entries of a record (each from its ==== heading on), and the end of a record: its last
// whole entries, as many as fit in `lines` lines (one at least)
const entriesOf = (text) => text.split(/^(?=={4} \d{4}-)/m).map((t) => t.trim()).filter((t) => t.startsWith('===='));
export function lastEntries(text, lines) {
  const out = [];
  let n = 0;
  for (const e of entriesOf(text).reverse()) {
    n += e.split('\n').length + 1;
    if (out.length && n > lines) break;
    out.unshift(e);
  }
  return out.join('\n\n');
}
export const lastNotes = (text, n) => entriesOf(text).slice(-n);

// The file map as text. project: the project's data; used: the files in the folder that belong
// to the document; backups: the .bak files; steps: the steps file's name or null; original:
// the file as it was imported is in the records
export function fileMapText({ folder, project, used, notFound, outside: left, backups, steps, original, now }) {
  const lines = (names, none) => (names.length ? names.map((n) => '  ' + n) : ['  ' + none]).join('\n');
  const when = (iso) => timeOf(new Date(iso));
  const came = project.source
    ? `  Imported on ${when(project.imported)} from\n  ${project.source}\n`
      + (project.originalWritten
        ? `  On ${when(project.originalWritten)} that file was written over with this document, because the user chose it (in File > Save As, or as the place for Tools > Document Manager > Copy).\n  Apart from that opensw does not write to it: it works on the copy in this folder.`
        : '  opensw does not write to that file: it works on the copy in this folder.\n  (It is written only if you choose that very file yourself, in File > Save As or as the place for Tools > Document Manager > Copy.)')
    : `  opensw did not import this document from a file. It was first saved into this folder on ${when(project.created)}.`
      + (project.savedFrom ? `\n  Before that it was ${project.savedFrom} (File > Save As).` : '');
  return `File map for ${project.main}\n`
    + `Written by opensw on ${timeOf(now)}. It is written again at every save.\n\n`
    + `This folder\n  ${folder}\n\n`
    + `The main document\n  ${project.main}  (the file opensw opens and saves)\n\n`
    + `Where it came from\n${came}\n\n`
    + `Files the document uses (in this folder)\n${lines(used, '(none)')}\n\n`
    + (notFound.length ? `Files the document names that were not found\n${lines(notFound)}\n\n` : '')
    + (left.length ? `Files the document names outside this folder (left where they are)\n${lines(left)}\n\n` : '')
    + `Backups\n${lines(backups.map((b) => `${b}  (the file as it was before the last save)`), '(none yet: when opensw saves over a file it first keeps the old one as .bak)')}\n\n`
    + `Records (in the folder "${RECORDS}")\n`
    + `  ${RECORD_FILES.changeLog}     what was done to the document and when; written by opensw\n`
    + `  ${RECORD_FILES.fileMap}       this file\n`
    + `  ${RECORD_FILES.handoff}  notes an AI assistant leaves for whoever goes on with the work: what it set out to do, what is done, what is left\n`
    + `  ${PROJECT_JSON}       the same facts for the program\n`
    + (original ? `  ${ORIGINAL}\\          the file exactly as it was imported; opensw does not open it or write it again\n` : '')
    + (project.recordsRemade ? `  (These records were made again on ${when(project.recordsRemade)}: the ones before were not found then.)\n` : '')
    + '\n'
    + `Steps file\n  ${steps ? `${steps}  (the names of the derivation steps and their checks)` : '(none)'}\n\n`
    + 'Typeset PDF\n  The PDF is not kept in this folder. Typeset > Preview PDF makes it in the program\'s own working folder\n'
    + '  on this computer and opens it; Typeset > Compile PDF asks where to keep it.\n';
}
// project: the project's data (its main document is the one the map is about, whichever file of
// the folder is being saved); pictures, others: what the open document names now (see locate)
export async function writeFileMap(files, { folder, project, pictures, others, now }) {
  const where = await locate(files, folder, pictures, others);
  const used = where.found.map(([, at]) => relative(at, folder)).filter((rel) => rel.toLowerCase() !== project.main.toLowerCase());
  const have = new Set(used.map((u) => u.toLowerCase()));
  for (const rel of project.copied || []) {
    if (!have.has(rel.toLowerCase()) && rel !== stepsName(project.main) && (await files.exists(joinPath(folder, rel)))) used.push(rel);
  }
  const here = await files.list(folder);
  const backups = here.filter((e) => !e.dir && /\.bak$/i.test(e.name)).map((e) => e.name);
  const steps = here.some((e) => e.name === stepsName(project.main)) ? stepsName(project.main) : null;
  const original = !!project.source && (await files.list(joinPath(folder, RECORDS, ORIGINAL))).length > 0;
  await writeText(files, joinPath(folder, RECORDS, RECORD_FILES.fileMap), fileMapText({ folder, project, used, notFound: where.notFound, outside: where.outside, backups, steps, original, now }));
}

// A save of the file `name` in the project folder `folder`. The change log gets what was kept
// while it could not be written (pending: { log, notes } as text) and the save itself, and the
// file map is written again. project.json follows the document:
// - there is none: it is made. From `known` (what it said when the document was opened) when the
//   records were lost while the document was open; else as a document saved here for the first
//   time (savedFrom: the file it was before, for a Save As into a new project folder);
// - it cannot be read just now: it is left alone, and so is the file map;
// - else it is kept up: main (asMain: the main document is now this file: saved under another
//   name, or renamed), originalWritten (onto: the copy took the original's place), folderShown
//   (shown: the folder is shown to the user after this save; Tools > User Setup can ask for that
//   at the first save only).
// -> { project: its data (null: not readable), first: the folder was never shown before }
export async function recordSave(files, { folder, name, by, copy = null, onto = false, asMain = false, known = null, savedFrom = null, pending = null, pictures = [], others = [], shown = false, now }) {
  const state = await projectState(files, folder);
  const stamp = now.toISOString();
  let project = state.data;
  let entry = '';
  if (!state.exists) {
    project = known ? { ...known, recordsRemade: stamp } : { source: null, created: stamp, main: name, ...(savedFrom ? { savedFrom } : {}) };
    if (known) entry = remadeEntry(folder, now);
  }
  const first = !project?.folderShown;
  if (project) {
    const next = { ...project, ...(asMain ? { main: name } : {}), ...(onto ? { originalWritten: stamp } : {}), ...(shown ? { folderShown: true } : {}) };
    if (!state.exists || JSON.stringify(next) !== JSON.stringify(project)) await writeProject(files, folder, next);
    project = next;
  }
  await appendText(files, joinPath(folder, RECORDS, RECORD_FILES.changeLog), entry + (pending?.log || '') + saveEntry({ by, name, copy, onto }, now), logHead(project?.main || name));
  await ensureNotes(files, folder, project?.main || name);
  if (pending?.notes) await appendText(files, joinPath(folder, RECORDS, RECORD_FILES.handoff), pending.notes);
  if (project) await writeFileMap(files, { folder, project, pictures, others, now });
  return { project, first };
}
// The main document of a project was renamed (Tools > Document Manager): project.json says so.
// -> the project's data (null: it could not be read, and was left alone)
export async function recordRename(files, folder, name) {
  const { data } = await projectState(files, folder);
  if (data && data.main !== name) await writeProject(files, folder, { ...data, main: name });
  return data && { ...data, main: name };
}
export const appendChange = (files, folder, main, entry) => appendText(files, joinPath(folder, RECORDS, RECORD_FILES.changeLog), entry, logHead(main));
export const appendNote = (files, folder, entry) => appendText(files, joinPath(folder, RECORDS, RECORD_FILES.handoff), entry);

// What the AI's records command answers: where the records are, the end of the change log (whole
// entries), the file map and the last three handoff notes. folder null: the document is in no
// project, and `none` says why in a few words; pending: what is kept in memory for a document
// that is not saved yet.
export async function readRecords(files, folder, pending = null, none = '') {
  if (!folder) return { folder: null, files: null, changeLog: lastEntries(pending?.log || '', 60), fileMap: '', handoff: lastNotes(pending?.notes || '', 3), note: none };
  const at = (name) => joinPath(folder, RECORDS, name);
  return {
    folder,
    files: { changeLog: at(RECORD_FILES.changeLog), fileMap: at(RECORD_FILES.fileMap), handoff: at(RECORD_FILES.handoff) },
    changeLog: lastEntries((await readText(files, at(RECORD_FILES.changeLog))) + (pending?.log || ''), 60),
    fileMap: await readText(files, at(RECORD_FILES.fileMap)),
    handoff: lastNotes(await readText(files, at(RECORD_FILES.handoff)), 3),
  };
}
// For the AI's open and info: the project the open document is in ({ folder, data }) and the
// latest handoff note, so that an AI that never asks for the records still sees them.
export async function projectFacts(files, { folder, data }) {
  const notes = lastNotes(await readText(files, joinPath(folder, RECORDS, RECORD_FILES.handoff)), 1);
  return { project: { folder, importedFrom: data.source || null, records: joinPath(folder, RECORDS) }, handoff: notes[0] || null };
}
