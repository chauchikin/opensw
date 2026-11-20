// The rules that keep the original and the records safe (desktop app, with the stand-in for the
// desktop shell, test/lib/desktop.mjs):
// - an AI can never save onto an original, whatever folders it is allowed;
// - a folder is a project only when it has opensw's records (project.json): a file in any other
//   folder of the projects folder is imported like a file from anywhere;
// - nothing in a project's records (the file as it was imported, in Original) is opened in place
//   or saved over;
// - project.json follows the document when it is saved under another name or renamed;
// - names that differ only by letter case are one file on a Windows disk.
// Run: node test/import_rules.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import { standIn, ROOT, DESKTOP, DOCUMENTS, inProject, fileText, filePaths, toasts } from './lib/desktop.mjs';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const errs = [];
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail ?? '').slice(0, 700)); };
const FRAME = (file) => `\\FRAME{dtbpF}{1in}{1in}{0pt}{}{}{${file.split('/').pop()}}{\\special{language "Scientific Word";type "GRAPHIC";display "USEDEF";valid_file "F";width 1in;height 1in;depth 0pt;original-width 1in;original-height 1in;cropleft "0";croptop "1";cropright "1";cropbottom "0";filename '${file}';file-properties "XNPEU";}}`;
const paper = '\\documentclass{article}\r\n%TCIDATA{Version=5.50.0.2960}\r\n\\input{tcilatex}\r\n\\begin{document}\r\n\r\nFirst paragraph.\r\n\r\nSecond $x^{2}$ paragraph.\r\n\r\nLast paragraph.\r\n\r\n\\end{document}\r\n';
const own = ['\\documentclass{article}', '\\usepackage{amsmath}', '\\begin{document}', 'Hello $x^{2}$.', '\\end{document}', ''].join('\n');
async function start(options) {
  const page = await b.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await standIn(page, { ...options, settings: { showFolderOnSave: 'never', ...options.settings } });
  await page.addInitScript(() => { window.__TAURI_INTERNALS__.metadata = { currentWindow: { label: 'main' } }; });
  await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`);
  await page.waitForTimeout(800);
  page.call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
  page.writes = () => page.evaluate(() => window.shell.writes);
  page.menu = async (top, ...items) => {
    await page.click(`.menu-top:has-text("${top}")`);
    for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
  };
  page.question = async () => { await page.waitForSelector('#dialog:not([hidden])', { timeout: 5000 }); return page.textContent('#dialog'); };
  page.answer = async (label) => { await page.locator(`#dialog-body button:text-is("${label}")`).click(); await page.waitForTimeout(400); };
  page.where = async () => (await page.textContent('#status-path')).replace('\u200e', '');
  // the last message shown that is the editor's own (not the engine's start-up message, which comes when it likes)
  page.toast = async () => (await toasts(page)).filter((t) => !/^SymPy/.test(t)).at(-1) || '';
  // the user types at the start of the document
  page.type = (text) => page.evaluate((t) => { const v = window.swEditor; v.dispatch(v.state.tr.insertText(t, 1)); }, text);
  page.userOpen = async (path) => {
    await page.evaluate((p) => { window.shell.open = p; }, path);
    await page.menu('File', 'Open...');
    await page.waitForTimeout(600);
  };
  page.userSave = async () => { await page.click('#btn-save'); await page.waitForTimeout(700); };
  return page;
}
const folderOf = (path) => path.replace(/\\[^\\]*$/, '');
const record = async (page, folder, name) => ((await fileText(page, `${folder}\\opensw records\\${name}`)) || '').replace(/\r\n/g, '\n');
const projectJson = async (page, folder) => JSON.parse((await fileText(page, `${folder}\\opensw records\\project.json`)) || 'null');
let page, r;

// ================= an AI never saves onto an original =================
// the original's own folder is one the user allowed for AI: no question would stop it
page = await start({ files: { 'D:\\Papers\\paper.tex': paper, 'D:\\Papers\\paper.bak': 'the old .bak of 5.5', 'D:\\Papers\\other.tex': paper.replace('First', 'Other') }, settings: { aiFolders: ['D:\\Papers'] } });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
const copy = r.result.path;
await page.call('replaceBlock', { index: 0, latex: 'The AI rewrote this.' });
r = await page.call('save', { path: 'D:\\Papers\\paper.tex' });
check('AI save onto the original the document was imported from: refused, with the reason', !r.ok && /original/.test(r.error) && /File > Save As/.test(r.error) && await page.isHidden('#dialog'), r);
check('... the original and the .bak beside it are as they were', (await fileText(page, 'D:\\Papers\\paper.tex')) === paper && (await fileText(page, 'D:\\Papers\\paper.bak')) === 'the old .bak of 5.5'
  && (await page.writes()).every((p) => p.startsWith(ROOT + '\\')), (await page.writes()).filter((p) => !p.startsWith(ROOT + '\\')));
for (const spelled of ['d:/papers/PAPER.TEX', 'D:\\Papers\\.\\paper.tex', 'D:\\Papers\\sub\\..\\paper.tex', 'D:\\Papers\\\\paper.tex.', '\\\\?\\D:\\Papers\\paper.tex']) {
  r = await page.call('save', { path: spelled });
  check(`... also when the path is spelled ${spelled}`, !r.ok && /original/.test(r.error) && (await fileText(page, 'D:\\Papers\\paper.tex')) === paper, r);
}
check('the open document is still the copy', (await page.call('info')).result.path === copy);
r = await page.call('open', { path: 'D:\\Papers\\other.tex' });
r = await page.call('save', { path: 'D:\\Papers\\paper.tex' });
check('AI save onto the original of another project: refused too', !r.ok && /original/.test(r.error) && (await fileText(page, 'D:\\Papers\\paper.tex')) === paper, r);
r = await page.call('save', { path: 'D:\\Papers\\new-name.tex' });
check('a copy beside the original, under a name no project came from: refused as well (an AI saves in the projects folder only)', !r.ok && /is not in the projects folder/.test(r.error) && !(await filePaths(page)).includes('D:\\Papers\\new-name.tex'), r);
await page.close();

// ================= a folder is a project only when it has opensw's records =================
// the projects folder is set to a folder that already has documents in its folders
page = await start({ files: { 'D:\\Papers\\2024\\thesis.tex': own, 'D:\\Papers\\2024\\thesis.bak': 'old bak' }, settings: { projectsFolder: 'D:\\Papers' } });
await page.userOpen('D:\\Papers\\2024\\thesis.tex');
let q = await page.question().catch(() => '');
let at = await page.where();
check('a file in a folder of the projects folder that is no project is imported like any other', /^D:\\Papers\\thesis_\d{4}-\d\d-\d\d\\thesis\.tex$/.test(at) && q.includes('A copy was made in') && q.includes('The original (D:\\Papers\\2024\\thesis.tex) is not changed'), { at, q });
if (q) await page.answer('OK');
await page.type('Typed. ');
await page.userSave();
check('... saving writes the copy; the author\'s LaTeX file and its .bak are as they were', (await fileText(page, 'D:\\Papers\\2024\\thesis.tex')) === own && (await fileText(page, 'D:\\Papers\\2024\\thesis.bak')) === 'old bak'
  && /tcilatex/.test((await fileText(page, at)) || ''), [await page.toast(), await filePaths(page)]);
check('... and the LaTeX as it was imported is really in Original, as the message says', (await fileText(page, folderOf(at) + '\\opensw records\\Original\\thesis.tex')) === own && /kept in opensw records\\Original/.test(await page.toast()), await page.toast());
await page.close();
// a LaTeX file 5.x did not write that is in a project without its own copy in Original (a sub-document that came along): not rewritten as 5.x over itself
page = await start({ files: { 'D:\\Papers\\paper.tex': paper.replace('Last paragraph.', '\\input{part}'), 'D:\\Papers\\part.tex': own }, settings: { aiFolders: ['D:\\Papers'] } });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
const partCopy = r.result.project.folder + '\\part.tex';
r = await page.call('open', { path: partCopy });
check('a plain LaTeX sub-document of a project opens as it is', r.ok && r.result.path === partCopy && r.result.from55 === false, r);
await page.call('replaceBlock', { index: 0, latex: 'Changed.' });
r = await page.call('save');
check('... it has no copy in Original, so Save does not write a 5.x file over it: a new name is asked for', !r.ok && /give a new path/.test(r.error) && (await fileText(page, partCopy)) === own, r);
await page.close();

// ================= nothing in a project's records is opened in place or saved over =================
page = await start({ files: { 'D:\\Papers\\own.tex': own }, settings: { aiFolders: ['D:\\Papers'] } });
r = await page.call('open', { path: 'D:\\Papers\\own.tex' });
const folder = r.result.project.folder;
const pristine = folder + '\\opensw records\\Original\\own.tex';
r = await page.call('open', { path: pristine });
check('AI open of the file kept in Original: not opened in place, imported as a new copy', r.ok && r.result.path !== pristine && r.result.imported?.from === pristine && /own_\d{4}-\d\d-\d\d_2\\own\.tex$/.test(r.result.path), r);
await page.call('replaceBlock', { index: 0, latex: 'Changed.' });
r = await page.call('save');
check('... saving it leaves the file in Original as it was', r.ok && (await fileText(page, pristine)) === own, r);
r = await page.call('save', { path: pristine });
check('AI save with a path in a project\'s records: refused', !r.ok && /records/.test(r.error) && (await fileText(page, pristine)) === own, r);
r = await page.call('save', { path: folder + '\\opensw records\\notes.tex' });
check('... any path there', !r.ok && /records/.test(r.error) && !(await filePaths(page)).includes(folder + '\\opensw records\\notes.tex'), r);
await page.userOpen(pristine);
q = await page.question().catch(() => '');
check('the user opening the file in Original: it is a file from outside (here: one imported before, by the AI just now)', /This file was imported on/.test(q) && q.includes(pristine), q);
await page.answer('Import again as a new copy');
q = await page.question().catch(() => '');
check('... and gets a new copy too, never the file itself', q.includes('A copy was made in') && /own_\d{4}-\d\d-\d\d_3\\own\.tex$/.test(await page.where()), { q, at: await page.where() });
if (q) await page.answer('OK');
await page.evaluate((p) => { window.shell.pick = p; }, pristine);
await page.menu('File', 'Save As...'); await page.waitForTimeout(600);
check('the user\'s Save As into a project\'s records: refused with a plain message', /records/.test(await page.toast()) && (await fileText(page, pristine)) === own && await page.isHidden('#dialog'), await page.toast());
await page.close();

// ================= project.json follows the document =================
// saved under another name in its project folder
page = await start({ files: { 'D:\\Papers\\paper.tex': paper, 'D:\\Papers\\other.tex': paper }, settings: { aiFolders: ['D:\\Papers'] } });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
const f1 = r.result.project.folder;
await page.call('replaceBlock', { index: 0, latex: 'Version two.' });
r = await page.call('save', { path: f1 + '\\paper-v2.tex' });
check('save under another name in the project folder: that file is the open document', r.ok && r.result.path === f1 + '\\paper-v2.tex' && !r.result.copy, r);
check('... and project.json names it as the main document', (await projectJson(page, f1)).main === 'paper-v2.tex' && (await projectJson(page, f1)).source === 'D:\\Papers\\paper.tex', await projectJson(page, f1));
await page.call('replaceBlock', { index: 0, latex: 'Version two, more work.' });
await page.call('save');
await page.call('open', { path: 'D:\\Papers\\other.tex' }); // (the document leaves the screen: it is unchanged)
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
check('opening the original again opens the file with the latest work, not the stale first copy', r.ok && r.result.path === f1 + '\\paper-v2.tex' && r.result.alreadyImported && (await page.call('get')).result.includes('more work'), r);
await page.close();
// renamed with Tools > Document Manager
page = await start({ files: { 'D:\\Papers\\paper.tex': paper } });
await page.userOpen('D:\\Papers\\paper.tex'); await page.answer('OK');
const f2 = folderOf(await page.where());
await page.type('My edit. '); await page.userSave();
await page.menu('Tools', 'Document Manager...'); await page.waitForTimeout(200);
await page.click('#d-rename'); await page.fill('#d-name', 'paper-final'); await page.click('#dialog-ok'); await page.waitForTimeout(500);
check('Document Manager > Rename: project.json names the renamed file', (await page.where()) === f2 + '\\paper-final.tex' && (await projectJson(page, f2)).main === 'paper-final.tex', [await page.where(), await projectJson(page, f2)]);
await page.menu('File', 'New...'); await page.waitForTimeout(300);
await page.userOpen('D:\\Papers\\paper.tex');
q = await page.question().catch(() => '');
check('opening the original again: "imported before", not a fresh import', /This file was imported on/.test(q) && q.includes(f2 + '\\paper-final.tex'), q);
if (/Open that copy/.test(q)) await page.answer('Open that copy');
check('... and "Open that copy" is the renamed file with the edit', (await page.where()) === f2 + '\\paper-final.tex' && (await page.call('get')).result.includes('My edit.'), await page.where());
await page.close();

// ================= names that differ only by letter case (a Windows disk) =================
page = await start({ files: { 'D:\\Papers\\paper.tex': paper.replace('Last paragraph.', FRAME('graphics/pic.png') + '\r\n\r\n' + FRAME('Graphics/PIC.png')), 'D:\\Papers\\graphics\\pic.png': 'png' }, settings: { aiFolders: ['D:\\Papers'] }, caseBlind: true });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
check('a document naming one picture twice with other letter case is imported, the picture copied once', r.ok && r.result.imported?.copied.length === 1 && /^graphics\/pic\.png$/i.test(r.result.imported.copied[0]) && r.result.imported.notFound.length === 0, r);
check('... and both namings show the picture', r.ok && await page.evaluate(() => !!window.swPictures.assets.get('graphics/pic.png') && !!window.swPictures.assets.get('Graphics/PIC.png')));
r = await page.call('open', { path: 'd:\\PAPERS\\Paper.tex' });
check('the same original named with other letter case is the one imported before', r.ok && r.result.alreadyImported && (await filePaths(page)).filter((p) => /project\.json$/.test(p)).length === 1, r);
await page.close();

// ================= the user's own Save As onto the original =================
page = await start({ files: { 'D:\\Papers\\paper.tex': paper } });
await page.userOpen('D:\\Papers\\paper.tex'); await page.answer('OK');
at = await page.where();
await page.type('My edit. ');
await page.evaluate(() => { window.shell.pick = 'D:\\Papers\\paper.tex'; });
await page.menu('File', 'Save As...');
q = await page.question();
check('the user may save a copy onto the original; the message says plainly that this file is the original, and that it was written over', q.includes('A copy was saved to D:\\Papers\\paper.tex.') && q.includes('D:\\Papers\\paper.tex is the original this document was imported from. You chose it yourself, so it was written over')
  && q.includes('kept beside it, as .bak') && (await fileText(page, 'D:\\Papers\\paper.tex')).includes('My edit.') && (await fileText(page, 'D:\\Papers\\paper.bak')) === paper, q);
await page.answer('OK');
check('... the document is still the copy in the project', (await page.where()) === at);
check('... the change log says it is the original, and who chose it', /Saved by the user ====\nFile: paper\.tex\nA copy was also saved to: D:\\Papers\\paper\.tex\n[^\n]*\nThat file is the original this document was imported from\. It was written over because the user chose it in File > Save As\.\n/.test(await record(page, folderOf(at), 'Change log.txt')), await record(page, folderOf(at), 'Change log.txt'));
let map = await record(page, folderOf(at), 'File map.txt');
check('... and the file map no longer says opensw does not write to that file', /that file was written over with this document, because the user chose it/.test(map) && !map.includes('opensw does not write to that file:') && typeof (await projectJson(page, folderOf(at))).originalWritten === 'string', map);
await page.close();

// ================= Tools > Document Manager on a document of a project =================
page = await start({ files: { 'D:\\Papers\\paper.tex': paper.replace('Last paragraph.', FRAME('pic.png')), 'D:\\Papers\\pic.png': 'png', 'D:\\Papers\\paper.aux': 'the original\'s aux', 'D:\\Papers\\paper.log': 'the original\'s log' } });
await page.userOpen('D:\\Papers\\paper.tex'); await page.answer('OK');
at = await page.where();
const dmFolder = folderOf(at);
await page.type('Edited. '); await page.userSave();
await page.evaluate((f) => { window.shell.write(f + '\\paper.aux', 'aux'); window.shell.write(f + '\\paper.log', 'log'); }, dmFolder);
const dm = async (button) => { await page.menu('Tools', 'Document Manager...'); await page.waitForTimeout(200); await page.click(button); await page.waitForTimeout(300); };
await dm('#d-clean');
await page.click('#dialog-ok'); await page.waitForTimeout(300);
const trashedNow = await page.evaluate(() => window.shell.trashed.slice());
check('Clean Up takes the auxiliary files of the project, not those beside the original', [dmFolder + '\\paper.aux', dmFolder + '\\paper.log'].every((p) => trashedNow.includes(p)) && trashedNow.every((p) => p.startsWith(dmFolder + '\\'))
  && (await fileText(page, 'D:\\Papers\\paper.aux')) === 'the original\'s aux' && (await fileText(page, 'D:\\Papers\\paper.log')) === 'the original\'s log', trashedNow);
await page.evaluate(() => { window.shell.open = 'D:\\Papers'; }); // Copy: into the original's folder
await dm('#d-copy');
await page.click('#dialog-ok'); await page.waitForTimeout(300);
q = await page.textContent('#dialog');
check('Copy into the original\'s folder: the question names the original', /Replace files\?/.test(q) && q.includes('D:\\Papers\\paper.tex is the original this document was imported from. Replacing it puts the document as last saved in its place.'), q);
await page.click('#dialog-ok'); await page.waitForTimeout(500);
check('... confirmed: the original is replaced, and the records say so', (await fileText(page, 'D:\\Papers\\paper.tex')).includes('Edited.') && /The user copied the document over the original ====\nWith Tools > Document Manager > Copy the document as last saved was copied to D:\\Papers\\paper\.tex/.test(await record(page, dmFolder, 'Change log.txt'))
  && /that file was written over with this document/.test(await record(page, dmFolder, 'File map.txt')), await record(page, dmFolder, 'File map.txt'));
await dm('#d-delete');
await page.click('#dialog-ok'); await page.waitForTimeout(400);
r = await page.evaluate(() => window.shell.trashed);
check('Delete takes the copy and its picture in the project, never the original or its files', r.includes(at) && r.includes(dmFolder + '\\pic.png') && !r.some((p) => p.startsWith('D:\\')) && (await filePaths(page)).includes('D:\\Papers\\paper.tex') && (await filePaths(page)).includes('D:\\Papers\\pic.png'), r);
await page.type('After the delete. ');
await page.evaluate((root) => { window.shell.pick = root + '\\paper.tex'; }, ROOT);
await page.userSave();
check('... the document left on screen is a new one: saved, it gets a project folder of its own', /paper_\d{4}-\d\d-\d\d_2\\paper\.tex$/.test(await page.where()) && (await projectJson(page, folderOf(await page.where()))).source === null, await page.where());
await page.close();

// ================= a document keeps its project while it is open =================
// the projects folder is changed in Tools > User Setup meanwhile
page = await start({ files: { 'D:\\Papers\\paper.tex': paper }, settings: { aiFolders: ['D:\\Papers'] } });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
const kept = r.result.path;
await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('opensw-settings')); s.projectsFolder = 'E:\\New projects'; localStorage.setItem('opensw-settings', JSON.stringify(s)); });
await page.call('replaceBlock', { index: 0, latex: 'After the setting changed.' });
r = await page.call('save');
let log = await record(page, folderOf(kept), 'Change log.txt');
check('the projects folder changed while a document is open: it is saved where it was, and its records go on', r.ok && r.result.path === kept && log.includes('After the setting changed.') && /Saved by AI ====\nFile: paper\.tex\n*$/.test(log), [r, log.slice(-300)]);
r = await page.call('records');
check('... records and info still name its project', r.result.folder === folderOf(kept) && (await page.call('info')).result.project?.importedFrom === 'D:\\Papers\\paper.tex' && (await page.call('info')).result.aiFolder === 'E:\\New projects', r.result.folder);
r = await page.call('save', { path: 'D:\\Papers\\paper.tex' });
check('... the AI still cannot save onto its original', !r.ok && /original/.test(r.error) && (await fileText(page, 'D:\\Papers\\paper.tex')) === paper && (await page.call('info')).result.path === kept, r);
r = await page.call('save', { path: 'D:\\Papers\\copy.tex' });
check('... a save outside is refused, naming the projects folder in use now; the document stays', !r.ok && r.error.includes('is not in the projects folder (E:\\New projects)') && (await page.call('info')).result.path === kept && !(await filePaths(page)).includes('D:\\Papers\\copy.tex'), r);
// project.json cannot be read for a moment at a save; then it is damaged
await page.evaluate(() => { const s = window.shell; s.on.read_file = (a) => { if (/project\.json$/.test(a.path) && !s.once) { s.once = 1; throw 'Cannot read: the network name is no longer available'; } return s.read(a.path); }; });
const jsonBefore = await fileText(page, folderOf(kept) + '\\opensw records\\project.json');
await page.call('replaceBlock', { index: 1, latex: 'While project.json could not be read.' });
r = await page.call('save');
check('project.json cannot be read at a save: the document is saved, project.json is as it was (not "made in opensw")', r.ok && (await fileText(page, folderOf(kept) + '\\opensw records\\project.json')) === jsonBefore && (await fileText(page, kept)).includes('could not be read'), r);
await page.evaluate((f) => { window.shell.files.set(f + '\\opensw records\\project.json', Array.from(new TextEncoder().encode('{ damaged'))); }, folderOf(kept));
await page.call('replaceBlock', { index: 1, latex: 'While project.json was damaged.' });
r = await page.call('save');
check('project.json damaged: left as it is; the open document still knows where it came from', r.ok && (await fileText(page, folderOf(kept) + '\\opensw records\\project.json')) === '{ damaged' && (await page.call('info')).result.project?.importedFrom === 'D:\\Papers\\paper.tex'
  && !(await page.call('save', { path: 'D:\\Papers\\paper.tex' })).ok, r);
await page.evaluate((text) => { window.shell.write('D:\\Papers\\copy.tex', text); }, paper);
r = await page.call('open', { path: 'D:\\Papers\\copy.tex' });
check('a file imported after the change goes into the new projects folder', r.ok && /^E:\\New projects\\copy_\d{4}-\d\d-\d\d\\copy\.tex$/.test(r.result.path), r);
await page.close();

// the project folder is renamed (or moved, or deleted) while the document is open
page = await start({ files: { 'D:\\Papers\\paper.tex': paper } });
await page.userOpen('D:\\Papers\\paper.tex'); await page.answer('OK');
at = await page.where();
const gone = folderOf(at);
await page.evaluate((f) => { const s = window.shell; for (const k of [...s.files.keys()]) if (k.startsWith(f + '\\')) { s.files.set(k.replace(f, f + ' (renamed)'), s.files.get(k)); s.files.delete(k); } }, gone);
await page.type('After the rename. ');
await page.click('#btn-save');
q = await page.question().catch(() => '');
check('the project folder is gone at a save: the user is asked, nothing is made again silently', q.includes('The project folder is not there any more') && q.includes(gone) && q.includes('Save there again') && !(await filePaths(page)).some((p) => p.startsWith(gone + '\\')), q);
await page.answer('Cancel');
check('Cancel: nothing is written, the document keeps its changes', !(await filePaths(page)).some((p) => p.startsWith(gone + '\\')) && / \* - opensw$/.test(await page.title()), await page.title());
r = await page.call('save');
check('an AI cannot make the folder again: an error that says what happened', !r.ok && /is not there any more/.test(r.error) && /Nothing was saved/.test(r.error) && !(await filePaths(page)).some((p) => p.startsWith(gone + '\\')), r);
await page.click('#btn-save');
await page.question();
await page.answer('Save there again');
await page.waitForTimeout(500);
const again = await projectJson(page, gone);
map = await record(page, gone, 'File map.txt');
check('Save there again: the folder is made again with the document, and records that still say where it came from', (await fileText(page, at)).includes('After the rename.') && again?.source === 'D:\\Papers\\paper.tex' && typeof again.recordsRemade === 'string'
  && map.includes('Imported on') && !map.includes('did not import') && !map.includes('Original\\') && map.includes('These records were made again'), [again, map]);
check('... the new change log begins by saying so', /These records were made again ====\nAt this save the records of [^\n]* were not found/.test(await record(page, gone, 'Change log.txt')));
await page.close();

// ================= a sub-document of a project =================
// (a sub-document as 5.x writes one: with its %TCIDATA lines)
const sub = '%TCIDATA{LaTeXparent=0,0,paper.tex}\r\n\r\nChapter one. ' + FRAME('graphics/subpic.png') + ' \\includegraphics{figs/plot}';
page = await start({ files: { 'D:\\Papers\\paper.tex': paper.replace('Last paragraph.', '\\input{ch1}'), 'D:\\Papers\\ch1.tex': sub, 'D:\\Papers\\graphics\\subpic.png': 'png', 'D:\\Papers\\figs\\plot.pdf': 'pdf' }, settings: { aiFolders: ['D:\\Papers'] } });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
const subFolder = r.result.project.folder;
check('the pictures a sub-document names come along with the import (one in a 5.x frame, one named without its ending)', JSON.stringify([...r.result.imported.copied].sort()) === JSON.stringify(['ch1.tex', 'figs/plot.pdf', 'graphics/subpic.png'])
  && (await filePaths(page)).includes(subFolder + '\\graphics\\subpic.png') && (await filePaths(page)).includes(subFolder + '\\figs\\plot.pdf'), r.result.imported);
r = await page.call('open', { path: subFolder + '\\ch1.tex' });
check('the sub-document opens as a file of the project', r.ok && r.result.path === subFolder + '\\ch1.tex' && r.result.project?.folder === subFolder, r);
await page.call('replaceBlock', { index: 0, latex: 'Chapter one, edited.' });
r = await page.call('save');
map = await record(page, subFolder, 'File map.txt');
check('saving it: the file map is still about the main document, and so is project.json', r.ok && map.startsWith('File map for paper.tex\n') && map.includes('The main document\n  paper.tex') && map.includes('  ch1.tex\n') && (await projectJson(page, subFolder)).main === 'paper.tex', map.slice(0, 400));
check('... the change log says which file was saved', /Saved by AI ====\nFile: ch1\.tex\n*$/.test(await record(page, subFolder, 'Change log.txt')));
await page.close();

// ================= the same original under another name; other spellings (a Windows disk) =================
page = await start({ files: { 'Z:\\Papers\\paper.tex': paper, '\\\\server\\share\\Papers\\paper.tex': paper, '\\\\server\\share\\Papers\\other.tex': paper }, settings: { aiFolders: ['Z:\\Papers', '\\\\server\\share\\Papers'] }, caseBlind: true });
await page.userOpen('Z:\\Papers\\paper.tex'); await page.answer('OK');
at = await page.where();
await page.menu('File', 'New...'); await page.waitForTimeout(300);
for (const spelled of ['z:/papers/./PAPER.tex', 'Z:\\Papers\\sub\\..\\paper.tex.', '\\\\?\\Z:\\Papers\\paper.tex']) {
  r = await page.call('open', { path: spelled });
  check(`the original spelled ${spelled} is the one imported before: its copy is opened`, r.ok && r.result.path === at && r.result.alreadyImported && !r.result.imported, r);
  await page.menu('File', 'New...'); await page.waitForTimeout(200);
}
// a mapped drive and its \\server name cannot be told to be one file: offered by name and contents, in honest words
await page.userOpen('\\\\server\\share\\Papers\\paper.tex');
q = await page.question().catch(() => '');
check('the same name and contents under a path that cannot be compared: said as what it is, with the choice', /A file with the same name and the same contents was imported on \d{4}-\d\d-\d\d \d\d:\d\d from Z:\\Papers\\paper\.tex\./.test(q) && q.includes('Open that copy') && q.includes('Import this file as a new copy') && !/This file was imported on/.test(q), q);
await page.answer('Open that copy');
check('... Open that copy: the copy made then', (await page.where()) === at && (await filePaths(page)).filter((p) => /project\.json$/.test(p)).length === 1, await page.where());
await page.menu('File', 'New...'); await page.waitForTimeout(300);
r = await page.call('open', { path: '\\\\server\\share\\Papers\\paper.tex' });
check('an AI, which cannot be asked, gets a copy of the file it named, and is told of the one that looks the same', r.ok && r.result.imported?.from === '\\\\server\\share\\Papers\\paper.tex' && r.result.path !== at && r.result.alike?.importedFrom === 'Z:\\Papers\\paper.tex' && r.result.alike.copy === at
  && /same name and the same contents/.test(r.result.note), r);
r = await page.call('open', { path: '\\\\server\\share\\Papers\\other.tex' });
check('another name with the same contents is simply another file', r.ok && r.result.imported && !r.result.alike, r);
await page.close();
// a projects folder on a \\server (a redirected Desktop), named with other letter case
const NET = '\\\\server\\share\\prof\\Desktop\\opensw projects';
page = await start({ files: { [NET + '\\paper_2026-01-02\\paper.tex']: paper, [NET + '\\paper_2026-01-02\\opensw records\\project.json']: JSON.stringify({ source: 'D:\\Papers\\paper.tex', sourceSha256: '', imported: '2026-01-02T01:05:00.000Z', main: 'paper.tex' }) },
  settings: { projectsFolder: NET }, caseBlind: true });
r = await page.call('open', { path: '\\\\SERVER\\Share\\prof\\desktop\\Opensw Projects\\paper_2026-01-02\\Paper.tex' });
check('a file of a project on a \\\\server, named with other letter case, is opened as it is', r.ok && !r.result.imported && r.result.project?.importedFrom === 'D:\\Papers\\paper.tex' && (await filePaths(page)).length === 2, r);
await page.close();

// ================= the Desktop cannot be written: the projects are in Documents, the next day too =================
const DOCROOT = DOCUMENTS + '\\opensw projects';
const noDesktop = `window.shell.on.make_folder = (a) => { if (a.path.startsWith(${JSON.stringify(DESKTOP)})) throw 'Cannot create the folder: access is denied'; window.shell.makeFolder(a.path, a.fresh); return null; };`;
page = await start({ files: { 'D:\\Papers\\paper.tex': paper }, settings: { aiFolders: ['D:\\Papers'] } });
await page.evaluate(noDesktop);
r = await page.call('info');
check('before anything is made the projects folder is the Desktop\'s', r.result.aiFolder === ROOT, r.result.aiFolder);
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
check('the Desktop cannot be written: the file is imported into Documents', r.ok && r.result.path.startsWith(DOCROOT + '\\paper_') && r.result.aiFolder === DOCROOT, r);
const yesterday = Object.fromEntries(await page.evaluate(() => [...window.shell.files].map(([k, v]) => [k, new TextDecoder().decode(Uint8Array.from(v))])));
await page.close();
page = await start({ files: yesterday, settings: { aiFolders: ['D:\\Papers'] } });
await page.evaluate(noDesktop);
r = await page.call('info');
check('the next session: the projects folder is the one that is there, in Documents', r.result.aiFolder === DOCROOT, r.result.aiFolder);
const inDocs = Object.keys(yesterday).find((p) => p.startsWith(DOCROOT) && /paper\.tex$/.test(p) && !/Original/.test(p));
await page.userOpen(inDocs);
check('... and a document kept there is opened as it is, not copied again', await page.isHidden('#dialog') && (await page.where()) === inDocs && (await filePaths(page)).length === Object.keys(yesterday).length, await page.where());
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
check('... and its original is known to have been imported', r.ok && r.result.alreadyImported && r.result.path === inDocs, r);
await page.close();

// ================= two imports at the same moment; what a failed import leaves =================
page = await start({ files: { 'D:\\A\\paper.tex': paper.replace('First', 'FROM A'), 'E:\\B\\paper.tex': paper.replace('First', 'FROM B') }, settings: { aiFolders: ['D:\\A', 'E:\\B'] } });
r = await page.evaluate(() => Promise.all([window.sw.call('open', { path: 'D:\\A\\paper.tex' }), window.sw.call('open', { path: 'E:\\B\\paper.tex' })]));
const folders = r.map((x) => x.result?.imported?.folder);
check('two files of one name imported at the same moment: a folder each, each with its own file and project.json', r.every((x) => x.ok) && folders[0] !== folders[1]
  && (await fileText(page, folders[0] + '\\paper.tex')).includes('FROM A') && (await fileText(page, folders[1] + '\\paper.tex')).includes('FROM B')
  && (await projectJson(page, folders[0])).source === 'D:\\A\\paper.tex' && (await projectJson(page, folders[1])).source === 'E:\\B\\paper.tex', [folders, r.map((x) => x.error)]);
await page.close();
page = await start({ files: { 'D:\\Papers\\paper.tex': paper.replace('Last paragraph.', FRAME('graphics/pic.png')), 'D:\\Papers\\graphics\\pic.png': 'png' }, settings: { aiFolders: ['D:\\Papers'] } });
await page.evaluate(() => { window.shell.fail.copy_file = 'Cannot copy: the disk is full'; });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
check('an import that fails half way leaves nothing in the projects folder (what it began is in the Recycle Bin)', !r.ok && /disk is full/.test(r.error) && /Nothing was opened/.test(r.error) && !(await filePaths(page)).some((p) => p.startsWith(ROOT + '\\'))
  && (await page.evaluate(() => window.shell.trashed)).length === 1, [r, await filePaths(page)]);
await page.evaluate(() => { window.shell.fail = {}; });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
check('... so the next try is an import like the first, in the first folder name', r.ok && r.result.imported && !/_2\\paper\.tex$/.test(r.result.path), r);
await page.close();

// ================= a new document always gets a folder of its own =================
page = await start({ files: { 'D:\\Papers\\paper.tex': paper }, settings: { aiFolders: ['D:\\Papers'] } });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
const there = r.result.project.folder;
await page.menu('File', 'New...'); await page.waitForTimeout(300);
await page.type('A new note.');
await page.evaluate((p) => { window.shell.pick = p + '\\note.tex'; }, there);
await page.userSave();
at = await page.where();
check('a new document saved into the folder of another project: not mixed into it, a folder of its own', new RegExp(`^${ROOT.replace(/\\/g, '\\\\')}\\\\note_\\d{4}-\\d\\d-\\d\\d\\\\note\\.tex$`).test(at) && !(await filePaths(page)).includes(there + '\\note.tex')
  && (await projectJson(page, folderOf(at))).source === null, at);

// ================= Save All, and closing, with a document of a project and a new one =================
await page.call('switchTo', { doc: 1 }); // the imported paper
await page.call('replaceBlock', { index: 0, latex: 'Changed by an AI, never saved.' });
await page.type('Typed in the paper. ');
await page.menu('File', 'New...'); await page.waitForTimeout(300);
await page.type('A second note.');
await page.evaluate((root) => { window.shell.pick = root + '\\second.tex'; }, ROOT);
await page.menu('File', 'Save All'); await page.waitForTimeout(1200);
r = (await page.call('documents')).result;
check('Save All: the paper is saved in its project, the new document gets a project folder; nothing is left changed', r.every((d) => !d.changed) && r.some((d) => /second_\d{4}-\d\d-\d\d\\second\.tex$/.test(d.path || '')) && (await fileText(page, there + '\\paper.tex')).includes('Typed in the paper.')
  && /Saved by the user ====\nFile: paper\.tex\n*$/.test(await record(page, there, 'Change log.txt')), r);
// closing: the paper is changed by an AI and then closed without saving
await page.call('switchTo', { doc: r.findIndex((d) => /paper\.tex$/.test(d.path || '')) });
await page.call('replaceBlock', { index: 0, latex: 'An AI change that is thrown away.' });
await page.call('insert', { latex: 'And another.' });
await page.menu('Window', 'Close All');
await page.waitForSelector('#closeask:not([hidden])');
await page.click('#closeask-discard'); await page.waitForTimeout(500);
log = await record(page, there, 'Change log.txt');
check('closed without saving after an AI changed it: the log says those changes are not in the file', /Closed without saving ====\nThe document was closed and the user chose not to save it\. What was changed since the last save is not in the file: that goes for the last 2 entries above about changes an AI made\.\n*$/.test(log)
  && !(await fileText(page, there + '\\paper.tex')).includes('thrown away'), log.slice(-500));
check('... and every document is closed', (await page.call('documents')).result.length === 1 && !(await page.call('documents')).result[0].path);
await page.close();

// ================= past projects folders survive User Setup and a new session =================
page = await start({ files: { 'D:\\Papers\\paper.tex': paper }, settings: { aiFolders: ['D:\\Papers'] } });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
const oldCopy = r.result.path;
const oldProject = r.result.project.folder;
const oldJson = await projectJson(page, oldProject);
const setupRoot = async (next) => {
  await page.menu('Tools', 'User Setup...');
  await page.fill('#d-projects', next); await page.click('#dialog-ok'); await page.waitForTimeout(400);
};
await setupRoot('E:\\New projects');
let stored = await page.evaluate(() => JSON.parse(localStorage.getItem('opensw-settings')));
check('User Setup remembers the actual previous projects folder', JSON.stringify(stored.pastProjectsFolders) === JSON.stringify([ROOT]), stored);
await setupRoot('E:\\New projects');
await setupRoot(ROOT);
await setupRoot('E:\\New projects');
stored = await page.evaluate(() => JSON.parse(localStorage.getItem('opensw-settings')));
check('User Setup keeps past projects folders unique and adds nothing for an unchanged location', JSON.stringify(stored.pastProjectsFolders) === JSON.stringify([ROOT, 'E:\\New projects']), stored.pastProjectsFolders);
// A new session has no open project to supply the old source through `own`.
const pastSessionFiles = Object.fromEntries(await page.evaluate(() => [...window.shell.files]));
await page.close();
page = await start({ files: pastSessionFiles, settings: stored });
const foldersBeforeReopen = await page.evaluate(() => [...window.shell.folders]);
const pathsBeforeReopen = await filePaths(page);
await page.userOpen(oldCopy);
check('after changing the projects folder and restarting, the old main document opens directly without another folder', await page.isHidden('#dialog') && (await page.where()) === oldCopy
  && JSON.stringify(await filePaths(page)) === JSON.stringify(pathsBeforeReopen) && JSON.stringify(await page.evaluate(() => [...window.shell.folders])) === JSON.stringify(foldersBeforeReopen), await page.where());
await page.type('Saved back in the old project. '); await page.userSave();
const afterOldSave = await projectJson(page, oldProject);
check('saving the reopened old project writes its own copy and preserves project.json', (await fileText(page, oldCopy)).includes('Saved back in the old project.') && (await fileText(page, 'D:\\Papers\\paper.tex')) === paper
  && afterOldSave.source === oldJson.source && afterOldSave.sourceSha256 === oldJson.sourceSha256 && afterOldSave.imported === oldJson.imported && afterOldSave.main === oldJson.main, afterOldSave);
await page.menu('File', 'Close'); await page.waitForTimeout(300);
await page.type('A separate new document.');
r = await page.call('save', { path: 'D:\\Papers\\paper.tex' });
check('after changing the projects folder, AI cannot overwrite an old project source even when its folder is allowed and the project is closed', !r.ok && /original/.test(r.error)
  && (await fileText(page, 'D:\\Papers\\paper.tex')) === paper, r);
await page.userOpen('D:\\Papers\\paper.tex');
q = await page.question();
check('after changing the projects folder, opening the original offers the copy in the old folder', q.includes('This file was imported before') && q.includes(oldCopy), q);
await page.answer('Open that copy');
check('Open that copy returns to the old project and its saved edits', (await page.where()) === oldCopy && (await page.call('get')).result.includes('Saved back in the old project.'), await page.where());
await page.close();

// An empty setting can use Documents when Desktop could not be written: remember that actual folder.
page = await start({ files: { 'D:\\Papers\\paper.tex': paper }, settings: { aiFolders: ['D:\\Papers'] } });
await page.evaluate(noDesktop);
await page.call('open', { path: 'D:\\Papers\\paper.tex' });
await setupRoot('E:\\New projects');
stored = await page.evaluate(() => JSON.parse(localStorage.getItem('opensw-settings')));
check('User Setup remembers the actual Documents fallback, rather than the empty setting or the Desktop candidate', JSON.stringify(stored.pastProjectsFolders) === JSON.stringify([DOCROOT]), stored.pastProjectsFolders);
await page.close();

// ================= a moved project and records outside every projects folder =================
const movedFolder = 'E:\\moved\\paper_2026-01-02';
const movedMain = movedFolder + '\\paper.tex';
const movedOriginal = movedFolder + '\\opensw records\\Original\\paper.tex';
page = await start({ files: { ...inProject(movedFolder, 'paper.tex', 'D:\\Papers\\paper.tex'), [movedMain]: paper, [movedOriginal]: paper, 'D:\\Papers\\paper.tex': paper },
  settings: { projectsFolder: 'E:\\New projects', aiFolders: ['E:\\moved', 'D:\\Papers'] } });
await page.userOpen(movedMain);
check('a project moved outside every projects folder opens directly', await page.isHidden('#dialog') && (await page.where()) === movedMain && (await filePaths(page)).length === 4, await page.where());
// Its source is found through the currently open project, despite not being in any root list.
await page.userOpen('D:\\Papers\\paper.tex');
q = await page.question();
check('the open moved project still counts when looking for earlier imports of its source', q.includes('This file was imported before') && q.includes(movedMain), q);
await page.answer('Open the copy you worked on');
await page.userOpen(movedOriginal);
q = await page.question();
check('opening Original in a moved project imports a new copy and leaves its bytes unchanged', q.includes('A copy was made in') && (await page.where()) !== movedOriginal
  && (await page.where()).startsWith('E:\\New projects\\paper_') && (await fileText(page, movedOriginal)) === paper, q);
await page.answer('OK');
r = await page.call('save', { path: movedOriginal });
check('AI cannot save in the records of a moved project', !r.ok && /records/.test(r.error) && (await fileText(page, movedOriginal)) === paper, r);
await page.evaluate((p) => { window.shell.pick = p; }, movedOriginal);
await page.menu('File', 'Save As...'); await page.waitForTimeout(400);
check('File > Save As cannot save in the records of a moved project', /records/.test(await page.toast()) && (await fileText(page, movedOriginal)) === paper, await page.toast());
await page.close();

// ================= Document Manager Copy refuses records wherever they are =================
page = await start({ files: { ...inProject(movedFolder, 'paper.tex'), [movedMain]: paper,
  'E:\\archive\\opensw records\\paper.tex': 'record bytes', 'E:\\archive\\opensw records\\Original\\paper.tex': 'original bytes',
  'E:\\archive\\opensw records\\Original\\deeper\\paper.tex': 'nested bytes', 'E:\\archive\\OPENSW RECORDS\\paper.tex': 'mixed case bytes' } });
await page.userOpen(movedMain);
const bytesBeforeCopy = await page.evaluate(() => [...window.shell.files]);
for (const destination of ['E:\\archive\\opensw records\\Original', 'E:\\archive\\opensw records', 'E:\\archive\\opensw records\\Original\\deeper', 'E:\\archive\\OPENSW RECORDS']) {
  await page.evaluate((p) => { window.shell.open = p; }, destination);
  await dm('#d-copy');
  check(`Document Manager Copy refuses ${destination} without writing any bytes`, /records/.test(await page.toast())
    && await page.isHidden('#dialog') && JSON.stringify(await page.evaluate(() => [...window.shell.files])) === JSON.stringify(bytesBeforeCopy) && (await page.writes()).length === 0, await page.toast());
}
await page.evaluate(() => { window.shell.open = 'E:\\ordinary'; });
await dm('#d-copy'); await page.click('#dialog-ok'); await page.waitForTimeout(300);
check('Document Manager Copy still writes to an ordinary folder', (await fileText(page, 'E:\\ordinary\\paper.tex')) === paper && /Copied 1 files/.test(await page.toast()), await page.toast());
await page.close();

// ================= a failed outside copy is reported honestly on the user route =================
page = await start({ files: { 'D:\\Papers\\paper.tex': paper } });
await page.userOpen('D:\\Papers\\paper.tex'); await page.answer('OK');
const savedBeforeCopyFailure = await page.where();
await page.type('Saved despite the copy failure. ');
await page.evaluate(() => {
  window.shell.pick = 'E:\\usb\\failed-copy.tex';
  window.shell.on.write_file = (a) => { if (a.path === 'E:\\usb\\failed-copy.tex') throw 'Cannot write: the disk is full'; window.shell.write(a.path, a.data); return null; };
});
await page.menu('File', 'Save As...');
q = await page.question();
check('File > Save As outside failure: the project is saved and the dialog names the failed copy and the real error', q.includes('The copy was not saved')
  && q.includes('The document was saved in its project folder: ' + savedBeforeCopyFailure) && q.includes('But the copy could not be written to E:\\usb\\failed-copy.tex: Cannot write: the disk is full')
  && (await page.where()) === savedBeforeCopyFailure && (await fileText(page, savedBeforeCopyFailure)).includes('Saved despite the copy failure.') && !(await filePaths(page)).includes('E:\\usb\\failed-copy.tex'), q);
log = await record(page, folderOf(savedBeforeCopyFailure), 'Change log.txt');
check('a failed outside copy is never claimed as saved in Change log', /Saved by the user ====\nFile: paper\.tex\n*$/.test(log) && !log.includes('A copy was also saved to:') && !log.includes('E:\\usb\\failed-copy.tex'), log.slice(-400));
await page.answer('OK'); await page.close();

// ================= failed import cleanup when the Recycle Bin fails too =================
page = await start({ files: { 'D:\\Papers\\paper.tex': paper.replace('Last paragraph.', FRAME('pic.png')), 'D:\\Papers\\pic.png': 'png' } });
const beforeFailedImport = await fileText(page, 'D:\\Papers\\paper.tex');
await page.evaluate(() => { window.shell.fail.copy_file = 'Cannot copy: the disk is full'; window.shell.fail.trash_files = 'The Recycle Bin is unavailable'; });
await page.userOpen('D:\\Papers\\paper.tex');
q = await page.question();
const halfMadeMain = (await filePaths(page)).find((p) => p.startsWith(ROOT + '\\') && /\\paper\.tex$/.test(p) && !/Original/.test(p));
check('failed import and failed Recycle Bin: the user is told the real error and the exact folder left behind; the original is not opened', q.includes('This file could not be imported')
  && q.includes('Cannot copy: the disk is full') && !!halfMadeMain && q.includes('The folder that was begun for it could not be taken away: ' + folderOf(halfMadeMain))
  && q.includes('Open the original without importing') && !(await page.call('info')).result.path && !(await filePaths(page)).some((p) => /project\.json$/.test(p))
  && (await fileText(page, 'D:\\Papers\\paper.tex')) === beforeFailedImport && (await fileText(page, 'D:\\Papers\\pic.png')) === 'png', q);
await page.answer('Cancel');
check('Cancel after failed cleanup leaves the original bytes untouched and no original open', !(await page.call('info')).result.path && (await fileText(page, 'D:\\Papers\\paper.tex')) === beforeFailedImport
  && (await page.writes()).every((p) => p.startsWith(ROOT + '\\')), await page.writes());
await page.close();

// ================= stray records do not turn an entire drive into a project =================
page = await start({ files: { 'D:\\Papers\\paper.tex': paper, ...inProject('D:', 'missing.tex') }, settings: { aiFolders: ['D:\\Papers'] } });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
check('a file below stray records without the main document is still imported', r.ok && r.result.imported?.from === 'D:\\Papers\\paper.tex' && r.result.path !== 'D:\\Papers\\paper.tex', r);
await page.close();

// ================= an implicit AI save cannot inherit permission to write an original =================
const implicitHome = ROOT + '\\already';
page = await start({ files: { 'D:\\Papers\\paper.tex': paper, 'D:\\Papers\\paper.bak': 'old backup bytes', ...inProject(implicitHome, 'work.tex', 'D:\\Papers\\paper.tex'), [implicitHome + '\\work.tex']: paper }, settings: { aiFolders: ['D:\\Papers'] } });
await page.evaluate(() => { window.shell.fail.copy_named = 'disk full'; });
await page.userOpen('D:\\Papers\\paper.tex');
await page.answer('Import the changed original as a new copy');
await page.answer('Open the original without importing');
await page.call('replaceBlock', { index: 0, latex: 'This must never overwrite the original.' });
const writesBeforeImplicitSave = await page.writes();
r = await page.call('save', {});
check('implicit AI save after failed reimport and Open the original is refused with recovery instructions', !r.ok && /original/.test(r.error) && /File > Save As/.test(r.error) && /reopen/.test(r.error) && (await page.call('info')).result.path === 'D:\\Papers\\paper.tex', r);
check('implicit AI save leaves the original bytes and its existing backup unchanged', (await fileText(page, 'D:\\Papers\\paper.tex')) === paper && (await fileText(page, 'D:\\Papers\\paper.bak')) === 'old backup bytes' && JSON.stringify(await page.writes()) === JSON.stringify(writesBeforeImplicitSave));
await page.close();

// ================= document settings count as unsaved changes everywhere =================
page = await start({ files: { 'D:\\Papers\\paper.tex': paper, 'D:\\Papers\\other.tex': paper }, settings: { aiFolders: ['D:\\Papers'] } });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
const settingsPath = r.result.path, settingsFolder = folderOf(settingsPath);
const reportPaper = paper.replace('\\documentclass{article}', '\\documentclass{report}');
await page.call('set', { latex: reportPaper });
check('preamble-only AI set makes documents.changed true', (await page.call('documents')).result[0].changed && / \* - opensw$/.test(await page.title()));
await page.menu('File', 'Save All'); await page.waitForTimeout(500);
check('Save All persists a preamble-only change and clears documents.changed', (await fileText(page, settingsPath)).includes('documentclass{report}') && !(await page.call('documents')).result[0].changed);
await page.call('set', { latex: paper });
await page.menu('File', 'Close'); await page.waitForTimeout(200);
check('Close asks before losing a preamble-only change', await page.isVisible('#closeask'));
await page.click('#closeask-discard'); await page.waitForTimeout(300);
check('discarding a preamble-only AI change records Closed without saving', /Closed without saving ====/.test(await record(page, settingsFolder, 'Change log.txt')) && (await fileText(page, settingsPath)).includes('documentclass{report}'));
await page.call('open', { path: settingsPath });
await page.menu('Typeset', 'Preamble...');
await page.locator('#d-pre').fill((await page.locator('#d-pre').inputValue()).replace('documentclass{report}', 'documentclass{book}'));
await page.click('#dialog-ok'); await page.waitForTimeout(100);
check('user Preamble menu changes documents.changed and the title without editing the body', (await page.call('documents')).result[0].changed && / \* - opensw$/.test(await page.title()));
await page.menu('File', 'Save All'); await page.waitForTimeout(500);
check('Save All persists a user Preamble menu change and clears its changed flag', (await fileText(page, settingsPath)).includes('documentclass{book}') && !(await page.call('documents')).result[0].changed);
await page.call('set', { latex: reportPaper });
await page.call('open', { path: 'D:\\Papers\\other.tex' });
r = await page.call('documents');
const settingsDoc = r.result.find((d) => d.path === settingsPath);
check('AI open retains a document with only metadata changed in its own window', !!settingsDoc && settingsDoc.doc > 0 && settingsDoc.changed, r);
r = await page.call('close', { doc: settingsDoc.doc });
check('AI close refuses an off-screen document with only metadata changed', !r.ok && /unsaved changes/.test(r.error), r);
await page.menu('File', 'Save All'); await page.waitForTimeout(500);
check('Save All also saves metadata changes in an off-screen document', (await fileText(page, settingsPath)).includes('documentclass{report}') && (await page.call('documents')).result.every((d) => !d.changed));
await page.call('switchTo', { doc: (await page.call('documents')).result.find((d) => d.path === settingsPath).doc });
await page.call('set', { latex: paper });
await page.menu('Window', 'Close All'); await page.waitForTimeout(150);
check('Close All asks about a preamble-only change', await page.isVisible('#closeask'));
await page.click('#closeask-cancel');
await page.evaluate(() => { window.shell.listeners['tauri://close-requested']({ event: 'tauri://close-requested', id: 0, payload: null }); });
await page.waitForTimeout(150);
check('the desktop window close handler asks about a preamble-only change', await page.isVisible('#closeask'));
await page.click('#closeask-cancel');
const aiCloseSettings = page.call('close', { discard: true });
await page.waitForSelector('#dialog:not([hidden])'); await page.click('#dialog-ok');
r = await aiCloseSettings;
await page.call('records');
check('AI close with user-approved discard logs a preamble-only change', r.ok && (await record(page, settingsFolder, 'Change log.txt')).split('Closed without saving ====').length === 3, r);
await page.close();

// ================= Document Manager checks both source records and every destination =================
// On Unix a trailing dot belongs to a folder name; on Windows it is dropped.
const unixHome = '/work', unixMain = unixHome + '/paper.tex';
const unixPaper = paper.replace('First paragraph.', 'First paragraph.\n\\input{opensw records./piece}');
page = await start({ files: { [unixMain]: unixPaper, '/work/opensw records/project.json': JSON.stringify({ main: 'paper.tex' }), '/work/opensw records./piece.tex': 'a sub-document', 'E:\\ordinary\\opensw records.\\piece.tex': 'protected destination' } });
await page.userOpen(unixMain);
await page.evaluate(() => { window.shell.open = 'E:\\ordinary'; });
await dm('#d-copy');
const bytesBeforeTargets = await page.evaluate(() => [...window.shell.files]);
await page.click('#dialog-ok'); await page.waitForTimeout(200);
check('Document Manager Copy refuses the whole operation when one file target is in records', /records/.test(await page.toast()) && JSON.stringify(await page.evaluate(() => [...window.shell.files])) === JSON.stringify(bytesBeforeTargets) && !(await filePaths(page)).includes('E:\\ordinary\\paper.tex'), await page.toast());
await page.close();
page = await start({ files: { ...inProject(movedFolder, 'paper.tex'), [movedMain]: paper.replace('First paragraph.', 'First paragraph.\n\\input{opensw records/Original/piece}'), [movedFolder + '\\opensw records\\Original\\piece.tex']: 'protected record' } });
await page.userOpen(movedMain); await dm('#d-delete');
const deleteList = await page.locator('#dialog-body .d-dm').count();
await page.click('#dialog-ok'); await page.waitForTimeout(200);
check('Document Manager Delete excludes files in records from its list and Recycle Bin', deleteList === 0 && (await fileText(page, movedFolder + '\\opensw records\\Original\\piece.tex')) === 'protected record' && (await page.evaluate(() => window.shell.trashed)).every((p) => !/opensw records/i.test(p)));
await page.close();

// ================= closing a changed new document with Save =================
page = await start({});
await page.menu('File', 'New...'); await page.waitForTimeout(300);
await page.type('A new document saved while closing.');
await page.evaluate((root) => { window.shell.pick = root + '\\closing-note.tex'; }, ROOT);
await page.menu('File', 'Close'); await page.waitForSelector('#closeask:not([hidden])');
await page.click('#closeask-save'); await page.waitForTimeout(600);
const closeSavedPaths = await filePaths(page);
const closeSavedMain = closeSavedPaths.find((p) => /\\closing-note_\d{4}-\d\d-\d\d\\closing-note\.tex$/.test(p));
const closeSavedFolder = closeSavedMain && folderOf(closeSavedMain);
check('closing a changed new document with Save creates its own project, project.json and all three records, then closes it', !!closeSavedMain
  && (await fileText(page, closeSavedMain)).includes('A new document saved while closing.') && (await projectJson(page, closeSavedFolder))?.main === 'closing-note.tex'
  && (await projectJson(page, closeSavedFolder))?.source === null && ['Change log.txt', 'File map.txt', 'Handoff notes.txt'].every((n) => closeSavedPaths.includes(closeSavedFolder + '\\opensw records\\' + n))
  && await page.isHidden('#closeask') && (await page.call('documents')).result.length === 1 && !(await page.call('info')).result.path && !(await page.call('get')).result.includes('saved while closing'), closeSavedPaths);
await page.close();

// ================= Undo AI Changes keeps what the user had not saved =================
// the AI's set changed the settings too (the document class), so the whole document is put back
page = await start({ files: { 'D:\\Papers\\paper.tex': paper } });
await page.userOpen('D:\\Papers\\paper.tex'); await page.answer('OK');
await page.type('The user wrote this and did not save it. ');
await page.call('set', { latex: paper.replace('\\documentclass{article}', '\\documentclass{report}').replace('First paragraph.', 'The AI replaced it all.') });
await page.click('#status-ai-undo'); await page.waitForTimeout(300);
r = await page.call('get');
check('Undo AI Changes after an AI changed the settings too: the user\'s unsaved words are back, and the document still counts as changed', r.result.includes('The user wrote this and did not save it.') && !r.result.includes('The AI replaced it all.')
  && (await page.call('documents')).result[0].changed === true, [r, (await page.call('documents')).result]);
await page.menu('File', 'Close'); await page.waitForTimeout(300);
check('... so closing it asks first', await page.isVisible('#closeask'));
await page.click('#closeask-save'); await page.waitForTimeout(600);
check('... and saving writes only what the user changed: the rest of the 5.x file is as it was', (await fileText(page, (await filePaths(page)).find((p) => /\\paper_\d{4}-\d\d-\d\d\\paper\.tex$/.test(p)))).replace('The user wrote this and did not save it. ', '') === paper);
await page.close();

check('no page errors', errs.length === 0, errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
