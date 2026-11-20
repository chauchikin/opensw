// An AI saves in the projects folders and nowhere else (desktop app, with the stand-in for the
// desktop shell, test/lib/desktop.mjs). The rule does not ask what is out there: the original a
// document was imported from, that original under another name (a link, a mapped drive), any
// other file, or no file at all — a save by an AI writes none of it, whatever folders the user
// allowed for AI (those are for opening). "In the projects folder" is asked of the disk: a link
// inside a project folder that leads out of it is outside. The user's File > Save As writes a
// copy where the user chose, as before.
// Run: node test/ai_outside.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import { standIn, ROOT, inProject, fileText, filePaths } from './lib/desktop.mjs';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const errs = [];
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail ?? '').slice(0, 700)); };
const paper = '\\documentclass{article}\r\n%TCIDATA{Version=5.50.0.2960}\r\n\\input{tcilatex}\r\n\\begin{document}\r\n\r\nFirst paragraph.\r\n\r\nLast paragraph.\r\n\r\n\\end{document}\r\n';
async function start(options) {
  const page = await b.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await standIn(page, { ...options, settings: { showFolderOnSave: 'never', ...options.settings } });
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
  page.userOpen = async (path) => {
    await page.evaluate((p) => { window.shell.open = p; }, path);
    await page.menu('File', 'Open...');
    await page.waitForTimeout(600);
  };
  return page;
}
// what a refused save must have left alone: nothing written at all
const nothingWritten = async (page, before) => (await page.writes()).length === before.length;
const refused = (r) => !r.ok && /is not in the projects folder/.test(r.error) && /an AI saves nowhere else/.test(r.error) && /File > Save As/.test(r.error);
let page, r, before;

// ================= a document of a project: saved in its project, and nowhere outside =================
// every folder here is allowed for AI, so no question would stop a save: only the rule does.
// D:\Shortcut is D:\Papers under another name (a link)
page = await start({
  files: { 'D:\\Papers\\paper.tex': paper, 'D:\\Papers\\paper.bak': 'the old .bak of 5.5', 'D:\\Out\\taken.tex': 'somebody\'s file' },
  links: { 'D:\\Shortcut': 'D:\\Papers' },
  settings: { aiFolders: ['D:\\Papers', 'D:\\Out', 'D:\\Shortcut'] },
});
r = await page.call('open', { path: 'D:\\Shortcut\\paper.tex' });
check('an AI still opens a file in a folder the user allowed, by either name of the folder', r.ok && r.result.path.startsWith(ROOT + '\\'), r);
const copy = r.result.path;
await page.call('replaceBlock', { index: 0, latex: 'The AI wrote this.' });
r = await page.call('save', {});
check('an AI\'s save without a path writes the copy in the project', r.ok && r.result.path === copy && (await fileText(page, copy)).includes('The AI wrote this.'), r);

await page.call('replaceBlock', { index: 0, latex: 'A second version.' });
before = await page.writes();
r = await page.call('save', { path: 'D:\\Out\\new.tex' });
check('a path outside where there is no file: refused, nothing is written, and no question is asked', refused(r) && await nothingWritten(page, before) && !(await filePaths(page)).includes('D:\\Out\\new.tex') && await page.isHidden('#dialog'), r);
r = await page.call('save', { path: 'D:\\Out\\taken.tex' });
check('a path outside where a file is: refused, the file is as it was', refused(r) && await nothingWritten(page, before) && (await fileText(page, 'D:\\Out\\taken.tex')) === 'somebody\'s file', r);
// (the file was opened as D:\\Shortcut\\paper.tex, so that is the name the project knows its original by)
r = await page.call('save', { path: 'D:\\Shortcut\\paper.tex' });
check('the original under the name it was opened by: refused as an original', !r.ok && /original/.test(r.error) && await nothingWritten(page, before) && (await fileText(page, 'D:\\Papers\\paper.tex')) === paper, r);
r = await page.call('save', { path: 'D:\\Papers\\paper.tex' });
check('the original under its other name, which no project knows: refused all the same, the original and its .bak are as they were', refused(r) && await nothingWritten(page, before)
  && (await fileText(page, 'D:\\Papers\\paper.tex')) === paper && (await fileText(page, 'D:\\Papers\\paper.bak')) === 'the old .bak of 5.5', r);
check('... the unsaved change is still in the editor', (await page.call('get')).result.includes('A second version.') && (await page.call('documents')).result[0].changed === true);

r = await page.call('save', { path: ROOT + '\\notes.tex' });
check('a path in the projects folder gives the document a project folder of its own there', r.ok && new RegExp('\\\\notes_\\d{4}-\\d\\d-\\d\\d\\\\notes\\.tex$').test(r.result.path) && r.result.path.startsWith(ROOT + '\\')
  && (await fileText(page, r.result.path)).includes('A second version.'), r);

// ================= the user's own Save As still writes a copy outside =================
await page.evaluate(() => { window.shell.pick = 'D:\\Out\\mine.tex'; });
await page.menu('File', 'Save As...');
const said = await page.question();
check('File > Save As to a path outside writes the copy there (the user chose it)', said.includes('A copy was saved to D:\\Out\\mine.tex') && (await fileText(page, 'D:\\Out\\mine.tex')).includes('A second version.'), said);
await page.answer('OK');
await page.close();

// ================= a new document =================
page = await start({ files: {}, settings: { aiFolders: ['D:\\Out'] } });
await page.call('set', { latex: 'A new document by the AI.' });
before = await page.writes();
r = await page.call('save', { path: 'D:\\Out\\fresh.tex' });
check('a new document with a path outside: refused, and no project folder is made for it either', refused(r) && await nothingWritten(page, before) && (await filePaths(page)).length === 0, r);
r = await page.call('save', { path: ROOT + '\\fresh.tex' });
check('... with a path in the projects folder it is saved in a project folder of its own', r.ok && r.result.path.startsWith(ROOT + '\\fresh_') && (await fileText(page, r.result.path)).includes('A new document by the AI.'), r);
await page.close();

// ================= a document opened in place (its import failed, the user said so) =================
// no project knows this file: the rule alone keeps an AI from writing it
page = await start({ files: { 'D:\\Papers\\paper.tex': paper }, settings: { aiFolders: ['D:\\Papers'] } });
await page.evaluate(() => { window.shell.fail.copy_named = 'disk full'; });
await page.userOpen('D:\\Papers\\paper.tex');
await page.answer('Open the original without importing');
await page.evaluate(() => { window.shell.fail = {}; });
await page.call('replaceBlock', { index: 0, latex: 'This must not reach the file.' });
before = await page.writes();
r = await page.call('save', {});
check('an AI\'s save of a document opened in place outside the projects folder is refused', refused(r) && await nothingWritten(page, before) && (await fileText(page, 'D:\\Papers\\paper.tex')) === paper, r);
r = await page.call('save', { path: 'D:\\Papers\\paper-ai.tex' });
check('... also under a new name beside it', refused(r) && await nothingWritten(page, before) && !(await filePaths(page)).includes('D:\\Papers\\paper-ai.tex'), r);
await page.call('set', { latex: 'A step:\\[ x+x=2x \\]' });
r = await page.call('nameSteps', {});
check('... nor does naming its steps write a steps file beside it', !r.ok && /not in the projects folder/.test(r.error) && await nothingWritten(page, before) && !(await filePaths(page)).some((p) => /steps\.json$/.test(p)), r);
await page.call('set', { latex: 'This must not reach the file.' });
r = await page.call('save', { path: ROOT + '\\paper.tex' });
check('... a path in the projects folder brings it into a project folder, and the file it was opened from stays as it was', r.ok && r.result.path.startsWith(ROOT + '\\paper_')
  && (await fileText(page, r.result.path)).includes('This must not reach the file.') && (await fileText(page, 'D:\\Papers\\paper.tex')) === paper, r);
await page.close();

// ================= a link inside a project folder that leads out of it =================
const linked = ROOT + '\\linked';
page = await start({
  files: { 'D:\\Papers\\paper.tex': paper, ...inProject(linked, 'main.tex'), [linked + '\\main.tex']: paper },
  links: { [linked + '\\out']: 'D:\\Papers' },
});
await page.call('open', { path: linked + '\\main.tex' });
await page.call('replaceBlock', { index: 0, latex: 'Through the link.' });
before = await page.writes();
r = await page.call('save', { path: linked + '\\out\\paper.tex' });
check('a path in the project folder by its name, outside it on the disk: refused, the file there is as it was', refused(r) && await nothingWritten(page, before) && (await fileText(page, 'D:\\Papers\\paper.tex')) === paper, r);
r = await page.call('save', { path: linked + '\\out\\new.tex' });
check('... and no new file is put through the link either', refused(r) && await nothingWritten(page, before), r);
r = await page.call('save', {});
check('... the document in its project is saved as always', r.ok && (await fileText(page, linked + '\\main.tex')).includes('Through the link.'), r);
r = await page.call('save', { path: linked + '\\second.tex' });
check('... and under another name in its own project folder', r.ok && r.result.path === linked + '\\second.tex' && (await fileText(page, linked + '\\second.tex')).includes('Through the link.'), r);
r = await page.call('open', { path: linked + '\\out\\paper.tex' });
check('a file opened through that link is outside: it is imported, not opened where it is', r.ok && r.result.imported && r.result.path.startsWith(ROOT + '\\paper_') && r.result.path !== linked + '\\out\\paper.tex', r);
await page.call('replaceBlock', { index: 0, latex: 'Edited after coming in through the link.' });
await page.click('#btn-save'); await page.waitForTimeout(700);
check('... so the user\'s Save writes the copy and the file out there is as it was', (await fileText(page, r.result.path)).includes('Edited after coming in through the link.') && (await fileText(page, 'D:\\Papers\\paper.tex')) === paper);
await page.close();

// ================= single files in a project folder that are links to files outside =================
// the .bak a save keeps: the AI's save would write the old file through it
page = await start({
  files: { 'D:\\Papers\\orig.tex': 'the original', ...inProject(linked, 'main.tex'), [linked + '\\main.tex']: paper, [linked + '\\a.rap']: paper },
  links: { [linked + '\\main.bak']: 'D:\\Papers\\orig.tex', [linked + '\\a.tex']: 'D:\\Papers\\orig.tex' },
});
await page.call('open', { path: linked + '\\main.tex' });
await page.call('replaceBlock', { index: 0, latex: 'Its backup would leave the folder.' });
await page.waitForTimeout(300);
before = await page.writes();
r = await page.call('save', {});
check('an AI\'s save whose .bak is a link out of the project folder is refused: nothing is written', refused(r) && await nothingWritten(page, before) && (await fileText(page, 'D:\\Papers\\orig.tex')) === 'the original', r);
// a 5.x package whose .tex beside it is a link out: the package is imported, the .tex is not opened where it is
r = await page.call('open', { path: linked + '\\a.rap' });
check('a package whose document beside it is a link out of the project folder is imported', r.ok && r.result.path.startsWith(ROOT + '\\a_') && r.result.path !== linked + '\\a.tex' && (await fileText(page, 'D:\\Papers\\orig.tex')) === 'the original', r);
await page.close();

// ================= a projects folder used before that is not there now (a drive that is off) =================
// the document's project was moved out of the projects folder: it is ours by its own folder
const moved = 'E:\\moved\\p1';
page = await start({ files: { ...inProject(moved, 'main.tex'), [moved + '\\main.tex']: paper }, settings: { pastProjectsFolders: ['Z:\\gone'], aiFolders: ['E:\\moved'] } });
await page.evaluate(() => { const s = window.shell; s.on.real_path = (a) => { if (a.path.startsWith('Z:')) throw 'Cannot find where it is on the disk'; return s.real(a.path); }; });
r = await page.call('open', { path: moved + '\\main.tex' });
await page.call('replaceBlock', { index: 0, latex: 'With an old folder gone.' });
r = await page.call('save', {});
check('an old projects folder that cannot be reached does not stop a save in the document\'s own project', r.ok && r.result.path === moved + '\\main.tex' && (await fileText(page, moved + '\\main.tex')).includes('With an old folder gone.'), r);
await page.close();

// ================= a drive where the disk cannot say where a file really is =================
page = await start({ files: { ...inProject(linked, 'main.tex'), [linked + '\\main.tex']: paper } });
await page.evaluate(() => { window.shell.fail.real_path = 'Cannot find where it is on the disk'; });
before = await page.writes();
r = await page.call('open', { path: linked + '\\main.tex' });
check('a project\'s file is still opened where it is, not imported once more', r.ok && r.result.path === linked + '\\main.tex' && !r.result.imported && await nothingWritten(page, before), r);
await page.call('replaceBlock', { index: 0, latex: 'Where the disk cannot say.' });
await page.waitForTimeout(300);
before = await page.writes(); // (the change is in the project's change log by now)
r = await page.call('save', {});
check('... but an AI does not save where the disk cannot say the file is in the projects folder', refused(r) && await nothingWritten(page, before) && (await fileText(page, linked + '\\main.tex')) === paper, r);
await page.click('#btn-save'); await page.waitForTimeout(700);
check('... the user\'s Save writes it as always', (await fileText(page, linked + '\\main.tex')).includes('Where the disk cannot say.'));
await page.close();

// ================= settings that hold something else than a list of folders =================
// (taken letter by letter, the text would give the folder "\\", which on Windows is the whole drive)
page = await start({ files: { 'D:\\Papers\\paper.tex': paper }, settings: { pastProjectsFolders: 'D:\\Papers', aiFolders: ['D:\\Papers'] } });
await page.evaluate(() => { const s = window.shell; s.fail.copy_named = 'disk full'; s.on.real_path = (a) => (a.path === '\\' ? 'D:\\' : s.real(a.path)); });
await page.userOpen('D:\\Papers\\paper.tex');
await page.answer('Open the original without importing');
await page.call('replaceBlock', { index: 0, latex: 'This must not reach the file.' });
r = await page.call('save', {});
check('a text where the list of old projects folders should be is not taken for folders', refused(r) && (await fileText(page, 'D:\\Papers\\paper.tex')) === paper, r);
await page.close();

check('no page errors', errs.length === 0, errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
