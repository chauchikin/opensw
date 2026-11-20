// The desktop app imports every file it opens (src/projects.js; here with the stand-in for the
// desktop shell, test/lib/desktop.mjs): the file and the files it uses are copied into a project
// folder of their own, the copy is the open document and the original is never written. A file
// imported before opens its copy again (or is imported anew); a file of a project opens as it
// is. Saving writes in the project; a target elsewhere gets a copy. The import and every save are
// written in the project's change log, and its file map is kept up. (What an AI changes, and its
// records and handoff commands: test/records.mjs.)
// Run: node test/import.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import { standIn, ROOT, DOCUMENTS, fileText, filePaths } from './lib/desktop.mjs';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const errs = [];
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail ?? '').slice(0, 700)); };
const FRAME = '\\FRAME{dtbpF}{1in}{1in}{0pt}{}{}{pic.png}{\\special{language "Scientific Word";type "GRAPHIC";display "USEDEF";valid_file "F";width 1in;height 1in;depth 0pt;original-width 1in;original-height 1in;cropleft "0";croptop "1";cropright "1";cropbottom "0";filename \'graphics/pic.png\';file-properties "XNPEU";}}';
const paper = `\\documentclass{article}\r\n%TCIDATA{Version=5.50.0.2960}\r\n\\input{tcilatex}\r\n\\begin{document}\r\n\r\nFirst paragraph.\r\n\r\nSecond $x^{2}$ paragraph. ${FRAME}\r\n\r\n\\input{ch1}\r\n\r\nLast paragraph.\r\n\r\n\\end{document}\r\n`;
const own = ['\\documentclass{article}', '\\usepackage{amsmath}', '\\begin{document}', 'Hello $x^{2}$.', '\\end{document}', ''].join('\n');
const FILES = {
  'D:\\Papers\\paper.tex': paper, 'D:\\Papers\\graphics\\pic.png': 'png', 'D:\\Papers\\ch1.tex': 'Chapter one.', 'D:\\Papers\\ch2.tex': 'Chapter two.',
  'D:\\Papers\\own.tex': own, 'D:\\Papers\\other.tex': paper.replace('First', 'Other'), 'E:\\Far\\far.tex': paper,
};
const DAY = '_\\d{4}-\\d{2}-\\d{2}';
const esc = (s) => s.replace(/[\\.]/g, '\\$&');
const copyOf = (name, more = '') => new RegExp(`^${esc(ROOT)}\\\\${name}${DAY}${more}\\\\${name}\\.tex$`);
async function start(options, lang = 'en') {
  const page = await b.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await standIn(page, options);
  await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=${lang}`);
  await page.waitForTimeout(800);
  page.call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
  page.shell = () => page.evaluate(() => ({ writes: window.shell.writes, shown: window.shell.shown, asked: window.shell.asked }));
  page.menu = async (top, ...items) => {
    await page.click(`.menu-top:has-text("${top}")`);
    for (const it of items) await page.locator(`.menu-list button:has(> span:text-is("${it}"))`).filter({ visible: true }).first().click();
  };
  // the question on screen: its text; answered with the button of that label
  page.question = async () => { await page.waitForSelector('#dialog:not([hidden])'); return page.textContent('#dialog'); };
  page.answer = async (label) => { await page.locator(`#dialog-body button:text-is("${label}")`).click(); await page.waitForTimeout(400); };
  // File > Save by its button, waited for: the last thing a save writes is the file map
  page.save = async () => {
    const n = (await page.shell()).writes.length;
    await page.click('#btn-save');
    await page.waitForFunction((k) => window.shell.writes.length > k && window.shell.writes.at(-1).endsWith('File map.txt'), n);
    await page.waitForTimeout(200);
  };
  page.where = async () => (await page.textContent('#status-path')).replace('\u200e', ''); // (the path is written after a mark that keeps it left to right)
  return page;
}
const outside = (writes) => writes.filter((p) => !p.startsWith(ROOT + '\\'));
// a record of a project as text (as Notepad shows it)
const record = async (page, folder, name) => ((await fileText(page, `${folder}\\opensw records\\${name}`)) || '').replace(/\r\n/g, '\n');

// ================= 1. an AI opens, edits and saves =================
let page = await start({ files: FILES, settings: { aiFolders: ['D:\\Papers'] } });
let r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
const copy = r.result?.path || '';
const folder = copy.replace(/\\[^\\]*$/, '');
check('open outside the projects folder: imported, the open document is the copy', r.ok && copyOf('paper').test(copy) && r.result.imported?.from === 'D:\\Papers\\paper.tex' && r.result.imported.folder === folder, r);
check('the reply says what came along', JSON.stringify([...r.result.imported.copied].sort()) === '["ch1.tex","graphics/pic.png"]' && r.result.imported.notFound.length === 0 && r.result.imported.notCopied.length === 0, r.result.imported);
let paths = await filePaths(page);
check('the copy, its picture and sub-document, the original as imported and the records are in the project', [copy, folder + '\\graphics\\pic.png', folder + '\\ch1.tex', folder + '\\opensw records\\Original\\paper.tex',
  folder + '\\opensw records\\Change log.txt', folder + '\\opensw records\\File map.txt', folder + '\\opensw records\\project.json'].every((p) => paths.includes(p)), paths);
check('nothing was written outside the projects folder', outside((await page.shell()).writes).length === 0, outside((await page.shell()).writes));
check('the picture is shown from the copy', await page.evaluate(() => !!window.swPictures.assets.get('graphics/pic.png')));
check('the status bar shows where the document is (the whole path also when the mouse is on it)', (await page.where()) === copy && await page.isVisible('#status-path') && (await page.getAttribute('#status-path', 'title')).startsWith(copy + '\n'));
r = await page.call('info');
check('info: aiFolder is the projects folder', r.result.aiFolder === ROOT && r.result.path === copy && r.result.from55 === true, r);

r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
check('open the same file again: its copy is opened, nothing is imported', r.ok && r.result.path === copy && r.result.alreadyImported?.originalChanged === false && /not changed/.test(r.result.note) && !r.result.imported
  && (await filePaths(page)).length === paths.length, r);
await page.evaluate((t) => window.shell.files.set('D:\\Papers\\paper.tex', Array.from(new TextEncoder().encode(t))), paper.replace('Last', 'Newer last'));
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
check('the original was changed since: still the copy, and the reply says so', r.ok && r.result.path === copy && r.result.alreadyImported.originalChanged === true && /has CHANGED/.test(r.result.note), r);
r = await page.call('open', { path: 'D:\\Papers\\paper.tex', fresh: true });
const copy2 = r.result?.path || '';
check('fresh = true: imported again as _2', r.ok && copyOf('paper', '_2').test(copy2) && r.result.imported && (await fileText(page, copy2)).includes('Newer last') && (await fileText(page, copy)).includes('Last paragraph'), r);
r = await page.call('open', { path: copy });
check('a file of a project is opened as it is (no import, no question)', r.ok && r.result.path === copy && !r.result.imported && !r.result.alreadyImported && !r.result.alreadyOpen && await page.isHidden('#dialog'), r);
// a document that is open already is not opened a second time: it comes to the screen as it is in the editor
const count = async () => (await page.call('documents')).result.length;
await page.call('insert', { latex: 'Not saved yet.' });
let open = await count();
r = await page.call('open', { path: copy });
check('AI: a file that is on screen already is not read again, and the reply says so', r.ok && r.result.alreadyOpen === true && /was open already/.test(r.result.note) && r.result.path === copy && (await count()) === open
  && (await page.call('get')).result.includes('Not saved yet.'), r);
r = await page.call('open', { path: copy2 }); // (the one on screen has changes: it stays open, in the Window menu)
open = await count();
r = await page.call('open', { path: copy.toUpperCase().replace(/\\/g, '/') });
check('AI: a file open in another window is brought to the screen, not opened again (slashes and letter case do not count)', r.ok && r.result.alreadyOpen === true && r.result.path === copy && (await count()) === open
  && (await page.call('get')).result.includes('Not saved yet.'), r);
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
check('AI: so is the copy of a file imported before (the newest copy, _2 here)', r.ok && r.result.alreadyOpen === true && r.result.alreadyImported && r.result.path === copy2 && /was open already/.test(r.result.note) && (await count()) === open, r);
await page.call('open', { path: copy });
await page.call('undo'); // (the line that was not saved: gone again)

await page.call('replaceBlock', { index: 0, latex: 'A new first paragraph with $a+b$.' });
await page.call('insert', { latex: 'Put in at the end.' });
let log = await record(page, folder, 'Change log.txt');
check('Change log: the import is its first entry', /==== \d{4}-\d\d-\d\d \d\d:\d\d {2}Imported ====\nFrom: D:\\Papers\\paper\.tex \(\d+ bytes\)/.test(log) && log.includes('the file it was imported from is written only if you choose that very file yourself'), log);
let map = await record(page, folder, 'File map.txt');
check('File map: where the document came from, that opensw does not write the original, what it uses', map.includes('D:\\Papers\\paper.tex') && map.includes('opensw does not write to that file: it works on the copy in this folder.') && map.includes('  graphics/pic.png\n') && map.includes('  ch1.tex\n'), map);

// Save writes in the project only; of a 5.x file only the edited parts are written again
let before = (await page.shell()).writes.length;
r = await page.call('save');
let wrote = (await page.shell()).writes.slice(before);
check('save: back to the copy, the old one kept as .bak; nothing outside the project', r.ok && r.result.path === copy && wrote[0] === folder + '\\paper.bak' && wrote[1] === copy && outside(wrote).length === 0, { r, wrote });
let savedText = await fileText(page, copy);
const linesOf = (t) => t.split('\r\n');
const changed = linesOf(paper).filter((l) => !linesOf(savedText).includes(l));
check('... the parts nobody edited are as they were in the file', changed.length === 1 && changed[0] === 'First paragraph.' && savedText.includes('A new first paragraph') && savedText.includes('%TCIDATA{Version=5.50.0.2960}'), changed);
check('the original is as it was', (await fileText(page, 'D:\\Papers\\paper.tex')) === paper.replace('Last', 'Newer last') && (await fileText(page, folder + '\\opensw records\\Original\\paper.tex')) === paper);
log = await record(page, folder, 'Change log.txt');
check('Change log: the save, by AI', /Saved by AI ====\nFile: paper\.tex\n*$/.test(log), log.slice(-200));
check('File map: written again at the save, with the backup', (await record(page, folder, 'File map.txt')).includes('paper.bak  (the file as it was before the last save)'));

// a path outside: an AI saves in the projects folder and nowhere else (test/ai_outside.mjs has the cases)
before = (await page.shell()).writes.length;
r = await page.call('save', { path: 'D:\\Papers\\out.tex' });
wrote = (await page.shell()).writes.slice(before);
check('save to a path outside: refused, nothing is written, the open document is still the one in the project', !r.ok && /is not in the projects folder/.test(r.error) && /File > Save As/.test(r.error)
  && wrote.length === 0 && !(await filePaths(page)).includes('D:\\Papers\\out.tex') && (await page.call('info')).result.path === copy, { r, wrote });
r = await page.call('save', { path: 'D:\\Papers\\out.sci' });
check('a .sci path outside: refused as well', !r.ok && /is not in the projects folder/.test(r.error) && !(await filePaths(page)).includes('D:\\Papers\\out.sci'), r);
// a path in the projects folder: that file becomes the open document
r = await page.call('save', { path: ROOT + '\\loose.tex' });
check('save to a file lying in the projects folder: it gets a folder of its own, and is the open document', r.ok && copyOf('loose').test(r.result.path) && /project folder of its own/.test(r.result.note) && (await page.call('info')).result.path === r.result.path
  && (await filePaths(page)).includes(r.result.path.replace(/loose\.tex$/, 'opensw records\\project.json')), r);
const loose = r.result.path.replace(/\\[^\\]*$/, '');
r = await page.call('save', { path: loose + '\\second.tex' });
check('save under another name in its own project folder: that file is the open document (as in 5.5)', r.ok && r.result.path === loose + '\\second.tex' && !r.result.copy && !r.result.note && (await page.call('info')).result.path === loose + '\\second.tex', r);
r = await page.call('save', { path: folder + '\\third.tex' });
check('save into the folder of another project: not mixed into it, a project folder of its own', r.ok && copyOf('third').test(r.result.path) && /project folder of its own/.test(r.result.note) && !(await filePaths(page)).includes(folder + '\\third.tex'), r);
check('... whose file map says what the document was before', (await record(page, r.result.path.replace(/\\[^\\]*$/, ''), 'File map.txt')).includes(`Before that it was ${loose}\\second.tex (File > Save As).`));

// a LaTeX file 5.x did not write: Save writes the 5.x file over the copy; the LaTeX stays in Original
r = await page.call('open', { path: 'D:\\Papers\\own.tex' });
const ownCopy = r.result?.path || '';
check('a LaTeX file 5.x did not write is imported too: from55 is false', r.ok && copyOf('own').test(ownCopy) && r.result.from55 === false, r);
check('its import is in the change log, with what Save will do', (await record(page, ownCopy.replace(/\\[^\\]*$/, ''), 'Change log.txt')).includes('Save will write it as a Scientific Word 5.x file'));
before = (await page.shell()).writes.length;
r = await page.call('save');
wrote = (await page.shell()).writes.slice(before);
check('save without a path: the 5.x file is written over the copy, and the note says where the LaTeX is', r.ok && r.result.path === ownCopy && /saved as a Scientific Word 5\.x file now/.test(r.result.note) && r.result.note.includes('opensw records\\Original')
  && /\\input\{tcilatex\}/.test(await fileText(page, ownCopy)) && outside(wrote).length === 0, { r, wrote });
check('the LaTeX as imported is untouched in Original, and so is the file itself', (await fileText(page, ownCopy.replace(/own\.tex$/, 'opensw records\\Original\\own.tex'))) === own && (await fileText(page, 'D:\\Papers\\own.tex')) === own);
r = await page.call('save');
check('it is a 5.x file now: saving again gives no note', r.ok && !r.result.note && (await page.call('info')).result.from55 === true, r);

// a file lying in the projects folder itself is imported into a folder of its own, like any other
await page.evaluate(([root, t]) => window.shell.files.set(root + '\\stray.tex', Array.from(new TextEncoder().encode(t))), [ROOT, paper]);
r = await page.call('open', { path: ROOT + '\\stray.tex' });
check('a file lying in the projects folder itself is imported into its own folder', r.ok && copyOf('stray').test(r.result.path) && r.result.imported?.from === ROOT + '\\stray.tex', r);
// a picture named with ".." is not copied; it is still shown, from where it is. The steps file comes along
await page.evaluate((t) => {
  const put = (path, text) => window.shell.files.set(path, Array.from(new TextEncoder().encode(text)));
  put('D:\\Papers\\sub\\up.tex', t.replace('graphics/pic.png', '../graphics/pic.png').replace('\\input{ch1}', ''));
  put('D:\\Papers\\sub\\up.steps.json', '{"doc":"up.tex","given":{},"lines":{}}');
}, paper);
r = await page.call('open', { path: 'D:\\Papers\\sub\\up.tex' });
const upFolder = (r.result?.path || '').replace(/\\[^\\]*$/, '');
check('a picture named with "..": not copied, listed, and still shown from where it is', r.ok && JSON.stringify(r.result.imported.notCopied) === '["../graphics/pic.png"]' && !(await filePaths(page)).some((p) => p.startsWith(upFolder) && p.endsWith('pic.png'))
  && await page.evaluate(() => !!window.swPictures.assets.get('../graphics/pic.png')), r);
check('the steps file beside the document comes along', r.result.imported.copied.includes('up.steps.json') && (await filePaths(page)).includes(upFolder + '\\up.steps.json'), r.result.imported);
// a .sci is imported the same way
const sciB64 = await page.evaluate(() => window.swSaveSci());
await page.evaluate((b64) => window.shell.files.set('D:\\Papers\\old.sci', Array.from(atob(b64), (c) => c.charCodeAt(0))), sciB64);
r = await page.call('open', { path: 'D:\\Papers\\old.sci' });
check('a .sci is imported too', r.ok && new RegExp(`^${esc(ROOT)}\\\\old${DAY}\\\\old\\.sci$`).test(r.result.path) && r.result.imported && (await filePaths(page)).includes(r.result.path.replace(/old\.sci$/, 'opensw records\\Original\\old.sci')), r);
r = await page.call('save');
check('... and saved as .sci in its project folder', r.ok && /old\.sci$/.test(r.result.path), r);
// a 5.5 package (.rap): the package is copied; the document is not a file yet, its first save writes the .tex beside it, without asking
await page.evaluate((t) => window.shell.files.set('D:\\Papers\\pack.rap', Array.from(new TextEncoder().encode(t))), paper);
r = await page.call('open', { path: 'D:\\Papers\\pack.rap' });
const packTex = r.result?.path || '';
check('a .rap package: copied into a project folder; the document will be the .tex beside it', r.ok && copyOf('pack').test(packTex) && (await filePaths(page)).includes(packTex.replace(/\.tex$/, '.rap')) && !(await filePaths(page)).includes(packTex), r);
r = await page.call('save');
check('... its first save writes that .tex, without asking', r.ok && r.result.path === packTex && (await filePaths(page)).includes(packTex) && await page.isHidden('#dialog') && (await page.shell()).asked.length === 0, r);
r = await page.call('open', { path: 'D:\\Papers\\pack.rap' });
check('... and opening the package again opens the saved .tex', r.ok && r.result.path === packTex && r.result.alreadyImported, r);

// the import fails: nothing is opened where it is
await page.evaluate(() => { window.shell.fail.write_file = 'Cannot write: the disk is full'; });
const onScreen = (await page.call('info')).result.path;
r = await page.call('open', { path: 'D:\\Papers\\other.tex' });
check('the import fails: an error, and nothing is opened in place', !r.ok && /Could not import D:\\Papers\\other\.tex/.test(r.error) && /the disk is full/.test(r.error) && /Nothing was opened/.test(r.error)
  && (await page.call('info')).result.path === onScreen, r);
await page.evaluate(() => { window.shell.fail = {}; });

// where AI may open without asking: the projects folder and the allowed folders; elsewhere the user is asked first
const asking = page.call('open', { path: 'E:\\Far\\far.tex' });
const asked = await page.question();
await page.click('#dialog-ok');
r = await asking;
check('a file outside the allowed folders: the user is asked first, then it is imported like any other', asked.includes('E:\\Far\\far.tex') && r.ok && copyOf('far').test(r.result.path) && r.result.imported, { asked, r });
r = await page.call('save', { path: ROOT + '\\far' + r.result.path.match(/_\d{4}-\d\d-\d\d/)[0] + '\\far2.tex' });
check('saving in the projects folder needs no question', r.ok && await page.isHidden('#dialog'), r);
await page.close();

// a new document an AI writes: saved with a path in the projects folder, in a project folder of its own
page = await start({ files: {}, settings: { aiFolders: ['D:\\Papers'] } });
await page.call('set', { latex: 'A new document.' });
r = await page.call('save', { path: 'D:\\Papers\\fresh.tex' });
check('a new document saved to a path outside: refused, and nothing is made for it', !r.ok && /is not in the projects folder/.test(r.error) && (await filePaths(page)).length === 0, r);
r = await page.call('save', { path: ROOT + '\\fresh.tex' });
const fresh = r.result?.path || '';
check('a new document saved to a path in the projects folder: a project folder of its own', r.ok && copyOf('fresh').test(fresh) && (await fileText(page, fresh)).includes('A new document.'), r);
const freshFolder = fresh.replace(/\\[^\\]*$/, '');
check('its change log has the save; its file map says the document was not imported', /Saved by AI ====\nFile: fresh\.tex\n/.test(await record(page, freshFolder, 'Change log.txt'))
  && (await record(page, freshFolder, 'File map.txt')).includes('opensw did not import this document from a file. It was first saved into this folder on'));
check('an AI\'s save does not pop up the folder', (await page.shell()).shown.length === 0);
await page.close();

// ================= 2. the user opens and saves =================
page = await start({ files: FILES });
await page.evaluate(() => { window.shell.open = 'D:\\Papers\\paper.tex'; });
await page.menu('File', 'Open...');
let q = await page.question();
let at = (await page.where());
let dir = at.replace(/\\[^\\]*$/, '');
check('File > Open: the file is imported, and a dialog says where the copy is and that the original is not changed', copyOf('paper').test(at) && q.includes(`A copy was made in ${dir}. You are working on the copy. The original (D:\\Papers\\paper.tex) is not changed by opensw.`)
  && q.includes('Files copied with it: 2'), { at, q });
await page.answer('Show folder');
check('Show folder: the copy is shown in its folder', JSON.stringify((await page.shell()).shown) === JSON.stringify([at]), (await page.shell()).shown);
check('the title names the document', /^paper - opensw$/.test(await page.title()), await page.title());
// typing and File > Save: written in the project; the folder is shown at the first save only
await page.click('.ProseMirror p'); await page.keyboard.type('Typed here');
await page.save();
let sh = await page.shell();
check('Save: written in the project (.bak first), nothing outside; the folder is shown at the first save', sh.writes.includes(dir + '\\paper.bak') && outside(sh.writes).length === 0 && (await fileText(page, at)).includes('Typed here')
  && sh.shown.length === 2 && sh.shown[1] === at && /^Saved: /.test(await page.textContent('#toast')), sh);
check('Change log: saved by the user', /Saved by the user ====\nFile: paper\.tex/.test(await record(page, dir, 'Change log.txt')));
await page.keyboard.type('And more');
await page.save();
check('... not at the next one', (await page.shell()).shown.length === 2 && (await fileText(page, at)).includes('And more'));
// File > Save As to a place outside: a copy
await page.evaluate(() => { window.shell.pick = 'E:\\usb\\paper.tex'; });
await page.menu('File', 'Save As...');
q = await page.question();
sh = await page.shell();
check('Save As starts in the document\'s project folder', sh.asked.at(-1) === dir + '\\paper.tex', sh.asked);
check('Save As outside: a copy is written there; a dialog says the document is still the one in the project, and that only the document file was copied', q.includes(`A copy was saved to E:\\usb\\paper.tex. You are still working on ${at}.`)
  && q.includes('Only the document file was copied, not the pictures and sub-documents it uses. Tools > Document Manager > Copy takes those along.') && !(await filePaths(page)).some((p) => p.startsWith('E:\\usb\\') && p !== 'E:\\usb\\paper.tex')
  && (await fileText(page, 'E:\\usb\\paper.tex')) === (await fileText(page, at)) && (await page.where()) === at, q);
await page.answer('OK');
check('... and the change log says where the copy went, and that it is the document file alone', /Saved by the user ====\nFile: paper\.tex\nA copy was also saved to: E:\\usb\\paper\.tex\nOnly the document file was copied, not the pictures and sub-documents it uses\. Tools > Document Manager > Copy takes those along\.\n/.test(await record(page, dir, 'Change log.txt')));
await page.evaluate(() => { window.shell.pick = 'E:\\usb\\paper.sci'; });
await page.menu('File', 'Save as .sci…');
q = await page.question();
check('a .sci copy outside: the document in the project stays the .tex; the dialog says its pictures are inside it', q.includes('The copy is one .sci file, with its pictures inside it.')
  && (await page.evaluate(() => window.shell.files.get('E:\\usb\\paper.sci').slice(0, 2).join())) === '80,75' && (await page.where()) === at, q);
await page.answer('OK');
check('every Save As shows the project folder, where the work goes on', (await page.shell()).shown.at(-1) === at && !(await page.shell()).shown.includes('E:\\usb\\paper.tex'), (await page.shell()).shown);
// ... which is true: Tools > Document Manager > Copy copies the document with its picture and sub-document
await page.evaluate(() => { window.shell.open = 'E:\\dm'; });
await page.menu('Tools', 'Document Manager...'); await page.waitForTimeout(200);
await page.click('#d-copy'); await page.waitForTimeout(300);
await page.click('#dialog-ok'); await page.waitForTimeout(400);
check('Document Manager > Copy takes the pictures and sub-documents along, as the message says', (await filePaths(page)).filter((p) => p.startsWith('E:\\dm\\')).sort().join() === 'E:\\dm\\ch1.tex,E:\\dm\\graphics\\pic.png,E:\\dm\\paper.tex', (await filePaths(page)).filter((p) => p.startsWith('E:\\dm')));
await page.evaluate(() => { window.shell.open = 'D:\\Papers\\paper.tex'; });
// File > Open Document Folder
await page.menu('File', 'Open Document Folder'); await page.waitForTimeout(300);
check('File > Open Document Folder shows the document in its folder', (await page.shell()).shown.at(-1) === at);

// opening the same file again: the user chooses
const n = (await filePaths(page)).length;
await page.menu('File', 'Open...');
q = await page.question();
check('opened again: "imported on ...", with the choice', /This file was imported on \d{4}-\d\d-\d\d \d\d:\d\d\./.test(q) && q.includes('Open that copy') && q.includes('Import again as a new copy') && q.includes('Cancel'), q);
await page.answer('Cancel');
check('Cancel: nothing happens', (await filePaths(page)).length === n && await page.isHidden('#dialog'));
await page.menu('File', 'Open...');
await page.question();
const windows = (await page.call('documents')).result.length;
await page.answer('Open that copy');
check('Open that copy: the copy, with what was saved in it', (await page.where()) === at && (await page.call('get')).result.includes('Typed here') && (await filePaths(page)).length === n);
check('... it was open already: it is not opened a second time, and a message says so', (await page.call('documents')).result.length === windows && /paper\.tex is open already/.test(await page.textContent('#toast')), await page.textContent('#toast'));
await page.evaluate((t) => window.shell.files.set('D:\\Papers\\paper.tex', Array.from(new TextEncoder().encode(t))), paper.replace('Last', 'Newer last'));
await page.menu('File', 'Open...');
q = await page.question();
check('the original changed since: said plainly', /The original has changed since it was imported on \d{4}/.test(q) && q.includes('Open the copy you worked on') && q.includes('Import the changed original as a new copy'), q);
await page.answer('Import the changed original as a new copy');
q = await page.question();
const at2 = (await page.where());
check('... a new copy: _2', copyOf('paper', '_2').test(at2) && q.includes('A copy was made in') && (await page.call('get')).result.includes('Newer last'), at2);
await page.answer('OK');
// File > Open on a file of a project that is open in another window: that window comes to the screen
const windows2 = (await page.call('documents')).result.length;
for (const file of [at, at2]) {
  await page.evaluate((p) => { window.shell.open = p; }, file);
  await page.menu('File', 'Open...'); await page.waitForTimeout(400);
  check(`File > Open on ${file === at ? 'the first copy' : 'the second'}, open already: brought to the screen, no second window`, (await page.where()) === file && (await page.call('documents')).result.length === windows2 && await page.isHidden('#dialog'), await page.where());
}
await page.evaluate(() => { window.shell.open = 'D:\\Papers\\paper.tex'; });

// Tools > Action on a sub-document: the file of the project; one that is not there is looked for next to the original, and imported
const selectSub = () => page.evaluate(() => {
  const v = window.swEditor; let pos = -1;
  v.state.doc.descendants((node, p) => { if (node.type.name === 'subdoc') pos = p; });
  v.dispatch(v.state.tr.setSelection(window.swNodeSelection.create(v.state.doc, pos)));
});
await selectSub();
await page.menu('Tools', 'Action');
await page.waitForFunction((p) => document.querySelector('#status-path').textContent.includes(p), 'ch1.tex').catch(() => {});
check('a sub-document of the project opens as it is', (await page.where()) === at2.replace(/paper\.tex$/, 'ch1.tex') && await page.isHidden('#dialog'), await page.where());
await page.call('switchTo', { doc: (await page.call('documents')).result.findIndex((d) => d.path === at2) });
await page.evaluate((p) => window.shell.files.delete(p), at2.replace(/paper\.tex$/, 'ch1.tex'));
await selectSub();
await page.menu('Tools', 'Action');
q = await page.question();
const sub = (await page.where());
check('one that is not in the project: the file next to the original, imported in its turn', copyOf('ch1').test(sub) && q.includes('The original (D:\\Papers\\ch1.tex) is not changed'), { sub, q });
await page.answer('OK');

// the import fails: the user is asked; the original can be opened where it is
await page.evaluate(() => { window.shell.open = 'D:\\Papers\\other.tex'; window.shell.fail.make_folder = 'Cannot create the folder: access is denied'; });
await page.menu('File', 'Open...');
q = await page.question();
check('the import fails: a dialog with the reason and the choice', q.includes('could not make a copy of D:\\Papers\\other.tex') && q.includes('access is denied') && q.includes('Open the original without importing'), q);
await page.answer('Cancel');
check('Cancel: nothing is opened', (await page.where()) === sub);
await page.menu('File', 'Open...');
await page.question();
await page.answer('Open the original without importing');
check('Open the original without importing: the file itself is the document, as before', (await page.where()) === 'D:\\Papers\\other.tex' && (await page.call('info')).result.path === 'D:\\Papers\\other.tex');
await page.evaluate(() => { window.shell.fail = {}; });
await page.close();

// a new document: the save dialog starts in the projects folder; whatever is chosen it gets a project folder
page = await start({ files: {} });
await page.menu('File', 'New...'); await page.waitForTimeout(300);
await page.click('.ProseMirror p'); await page.keyboard.type('My notes.');
await page.evaluate(() => { window.shell.pick = 'D:\\Else\\notes.tex'; });
await page.click('#btn-save');
q = await page.question();
at = (await page.where());
sh = await page.shell();
check('a new document: the save dialog starts in the projects folder, which is made then', sh.asked[0].startsWith(ROOT + '\\') && await page.evaluate((root) => window.shell.folders.has(root), ROOT), sh.asked);
check('a place outside was chosen: the document gets a project folder, and a copy goes to that place', copyOf('notes').test(at) && (await fileText(page, at)).includes('My notes.') && (await fileText(page, 'D:\\Else\\notes.tex')) === (await fileText(page, at))
  && q.includes('A copy was saved to D:\\Else\\notes.tex.'), { at, q });
await page.answer('OK');
// Tools > User Setup: the projects folder and when the folder is shown
await page.menu('Tools', 'User Setup...');
check('User Setup has the projects folder and "show the folder after saving"', (await page.inputValue('#d-projects')) === '' && (await page.inputValue('#d-showfolder')) === 'first' && (await page.getAttribute('#d-projects', 'placeholder')).includes('opensw projects'));
await page.fill('#d-projects', 'My projects');
await page.click('#dialog-ok');
check('a projects folder that is not a full path is refused', /full path/.test(await page.textContent('#toast')) && !JSON.parse(await page.evaluate(() => localStorage.getItem('opensw-settings')) || '{}').projectsFolder);
await page.menu('Tools', 'User Setup...');
await page.fill('#d-projects', 'D:\\My projects');
await page.selectOption('#d-showfolder', 'never');
await page.click('#dialog-ok');
r = await page.evaluate(() => JSON.parse(localStorage.getItem('opensw-settings')));
check('... and keeps them', r.projectsFolder === 'D:\\My projects' && r.showFolderOnSave === 'never', r);
await page.evaluate((t) => { window.shell.files.set('D:\\Papers\\paper.tex', Array.from(new TextEncoder().encode(t))); window.shell.open = 'D:\\Papers\\paper.tex'; }, paper);
await page.menu('File', 'Open...');
await page.question();
await page.answer('OK');
at = (await page.where());
check('the projects folder set by the user is where files are imported to', /^D:\\My projects\\paper_\d{4}-\d\d-\d\d\\paper\.tex$/.test(at) && (await page.call('info')).result.aiFolder === 'D:\\My projects', at);
const shownBefore = (await page.shell()).shown.length;
await page.click('.ProseMirror p'); await page.keyboard.type('Typed here');
await page.save();
check('"never": saving does not show the folder', (await page.shell()).shown.length === shownBefore && (await fileText(page, at)).includes('Typed here'));
await page.close();

// a document the program is started with (double-clicked) is imported too; Chinese interface
page = await start({ files: FILES, startup: 'D:\\Papers\\paper.tex' }, 'zh-TW');
q = await page.question();
at = (await page.where());
check('started with a file: imported, with the dialog (in Chinese)', copyOf('paper').test(at) && /[\u4e00-\u9fff]/.test(q) && q.includes('D:\\Papers\\paper.tex') && !/A copy was made/.test(q), { at, q });
check('the records are English whatever the interface language', (await fileText(page, at.replace(/paper\.tex$/, 'opensw records\\Change log.txt'))).includes('Imported ====') && !/[\u4e00-\u9fff]/.test(await fileText(page, at.replace(/paper\.tex$/, 'opensw records\\File map.txt'))));
await page.close();

// a computer without a Desktop folder: the projects folder is in Documents
page = await start({ files: FILES, desktop: null, settings: { aiFolders: ['D:\\Papers'] } });
r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
check('no Desktop: the projects folder is in Documents', r.ok && r.result.path.startsWith(DOCUMENTS + '\\opensw projects\\paper_') && r.result.aiFolder === DOCUMENTS + '\\opensw projects', r);
await page.close();

check('no page errors', errs.length === 0, errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
