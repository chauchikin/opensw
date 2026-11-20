// The records of a project folder, as an AI meets them (desktop app, with the stand-in for the
// desktop shell, test/lib/desktop.mjs): every AI command that changes the document goes into
// Change log.txt with the text before and after, written by opensw; the AI's records command
// reads the three records, its handoff command leaves a note; open and info carry the project
// and the latest note. A document with no project folder yet keeps both in memory until its
// first save. (The texts themselves: test/projects.mjs.)
// Run: node test/records.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
import { standIn, ROOT, fileText, toasts } from './lib/desktop.mjs';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const errs = [];
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail ?? '').slice(0, 900)); };
const paper = '\\documentclass{article}\r\n%TCIDATA{Version=5.50.0.2960}\r\n\\input{tcilatex}\r\n\\begin{document}\r\n\r\nFirst paragraph.\r\n\r\nSecond $x^{2}$ paragraph.\r\n\r\nThird paragraph.\r\n\r\n\\end{document}\r\n';
async function start(files) {
  const page = await b.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await standIn(page, { files, settings: { aiFolders: ['D:\\Papers'] } });
  await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`);
  await page.waitForTimeout(800);
  page.call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
  return page;
}
// the entries of a change log: [heading line, the rest]
const entries = (log) => log.split(/^(?=={4} )/m).filter((e) => e.startsWith('====')).map((e) => e.trim());
const last = (log) => entries(log).at(-1);

let page = await start({ 'D:\\Papers\\paper.tex': paper, 'D:\\Papers\\other.tex': paper.replace('First', 'Other') });
let r = await page.call('open', { path: 'D:\\Papers\\paper.tex' });
const copy = r.result?.path || '';
const folder = copy.replace(/\\[^\\]*$/, '');
check('open: the reply gives the project (folder, where it was imported from, its records); no handoff note yet', r.ok && r.result.project?.folder === folder && r.result.project.importedFrom === 'D:\\Papers\\paper.tex'
  && r.result.project.records === folder + '\\opensw records' && r.result.handoff === null, r);
r = await page.call('records');
check('records: the folder and the three files', r.ok && r.result.folder === folder && JSON.stringify(r.result.files) === JSON.stringify({ changeLog: folder + '\\opensw records\\Change log.txt', fileMap: folder + '\\opensw records\\File map.txt', handoff: folder + '\\opensw records\\Handoff notes.txt' }), r);
check('... the change log starts with the import; the file map; no notes yet', entries(r.result.changeLog).length === 1 && /Imported ====\nFrom: D:\\Papers\\paper\.tex/.test(r.result.changeLog) && r.result.fileMap.includes('opensw does not write to that file') && r.result.handoff.length === 0, r.result);

// every command that changes the document is written down, with the block and the text before and after
await page.call('replaceBlock', { index: 0, latex: 'A new first paragraph with $a+b$.' });
let log = (await page.call('records')).result.changeLog;
check('replaceBlock: the block (counted from 1, as a person counts), the command as a tag, before and after (formulas as LaTeX)', /^==== \d{4}-\d\d-\d\d \d\d:\d\d {2}AI changed block 1 \[command: replaceBlock\] ====\nBefore:\n {2}First paragraph\.\nAfter:\n {2}A new first paragraph with \$a\+b\$\.$/.test(last(log)), last(log));
await page.call('insert', { latex: 'Put in at the end.\n\nAnd one more.' });
log = (await page.call('records')).result.changeLog;
check('insert: what was put in, and where', /AI put in 2 blocks after block 3 \[command: insert\] ====\nBefore:\n {2}\(nothing\)\nAfter:\n {2}Put in at the end\.\n[^]*And one more\.$/.test(last(log)), last(log));
await page.call('deleteBlock', { index: 4 });
log = (await page.call('records')).result.changeLog;
check('deleteBlock: what was taken out', /AI took out block 5 \[command: deleteBlock\] ====\nBefore:\n {2}And one more\.\nAfter:\n {2}\(nothing\)$/.test(last(log)), last(log));
await page.call('setFormula', { n: 1, latex: 'x^{3}' });
log = (await page.call('records')).result.changeLog;
check('setFormula: the paragraph with the formula, before and after', /AI changed block 2 \[command: setFormula\] ====\nBefore:\n {2}Second \$x\^\{2\}\$ paragraph\.\nAfter:\n {2}Second \$x\^\{3\}\$ paragraph\.$/.test(last(log)), last(log));
await page.call('replace', { find: 'paragraph', with: 'part' });
log = (await page.call('records')).result.changeLog;
check('replace: each block that changed, with its own before and after', /AI changed 3 blocks \[command: replace\] ====\nBlock 1\nBefore:\n {2}A new first paragraph with \$a\+b\$\.\nAfter:\n {2}A new first part with \$a\+b\$\.\nBlock 2\n[^]*Block 3\nBefore:\n {2}Third paragraph\.\nAfter:\n {2}Third part\.$/.test(last(log)), last(log));
await page.call('undo');
log = (await page.call('records')).result.changeLog;
check('undo is a change too', /AI changed 3 blocks \[command: undo\] ====\nBlock 1\n/.test(last(log)) && /After:\n {2}Third paragraph\.$/.test(last(log)), last(log));
await page.call('insert', { latex: 'y'.repeat(900), index: -1 });
log = (await page.call('records')).result.changeLog;
check('a long text is cut at 400 characters, with …', last(log).includes('y'.repeat(400) + '…') && !last(log).includes('y'.repeat(401)) && /AI put in one block at the start \[command: insert\]/.test(last(log)), last(log).slice(0, 200));
let n = entries(log).length;
await page.call('outline'); await page.call('find', { text: 'Second' }); await page.call('select', { block: 1 }); await page.call('get'); await page.call('info');
log = (await page.call('records')).result.changeLog;
check('commands that change nothing leave no entry', entries(log).length === n, entries(log).length - n);
await page.call('set', { latex: 'Everything new.' });
log = (await page.call('records')).result.changeLog;
check('set: the whole document, before and after', /AI replaced blocks 1 to 5 by one block \[command: set\] ====\nBefore:\n {2}y+…\nAfter:\n {2}Everything new\.$/.test(last(log)), last(log));
check('the change log is opensw\'s own file, in the project\'s records', (await fileText(page, folder + '\\opensw records\\Change log.txt')).includes('by one block [command: set] ===='));

// the AI app's name, when it gave one (MCP), is in the log
r = await page.evaluate(() => window.shell.send('replaceBlock', { index: 0, latex: 'By a named app.' }, 'Some AI App'));
log = (await page.call('records')).result.changeLog;
check('a command that came from a named AI app says so', r.ok && / {2}AI \(Some AI App\) changed block 1 \[command: replaceBlock\] ====/.test(last(log)), last(log));
r = await page.evaluate(() => window.shell.send('save', {}, 'Some AI App'));
log = (await page.call('records')).result.changeLog;
check('... and so does its save', r.ok && /Saved by AI \(Some AI App\) ====\nFile: paper\.tex$/.test(last(log)), last(log));
r = await page.evaluate(() => window.shell.send('insert', { latex: 'No name.' }));
check('without a name: AI', /  AI put in one block after block 1 \[command: insert\] ====/.test(last((await page.call('records')).result.changeLog)));

// the handoff notes
r = await page.call('handoff', { text: '  ' });
check('handoff needs a text', !r.ok && /Give text/.test(r.error), r);
r = await page.call('handoff', { text: 'Set out to tidy the first paragraph. Done: block 0. Left: the references.' });
check('handoff: the note is written to Handoff notes.txt', r.ok && r.result.written === folder + '\\opensw records\\Handoff notes.txt', r);
for (const k of [2, 3, 4]) await page.call('handoff', { text: `Note ${k}.` });
r = await page.call('records');
check('records: the last three notes, opensw\'s date and time above each', r.result.handoff.length === 3 && /^==== \d{4}-\d\d-\d\d \d\d:\d\d ====\n {2}Note 2\.$/.test(r.result.handoff[0]) && r.result.handoff[2].endsWith('Note 4.'), r.result.handoff);
check('... and all of them are in the file', (await fileText(page, folder + '\\opensw records\\Handoff notes.txt')).includes('Set out to tidy the first paragraph.'));
r = await page.call('info');
check('info and open carry the latest note, for an AI that never asks for the records', /Note 4\.$/.test(r.result.handoff) && r.result.project.folder === folder && /Note 4\.$/.test((await page.call('open', { path: copy })).result.handoff), r);

// the user takes the AI's changes back (Edit > Undo AI Changes, here its button in the status bar): the log says so
// (the whole file: records gives the end of a long log only)
const wholeLog = async () => (await fileText(page, folder + '\\opensw records\\Change log.txt')).replace(/\r\n/g, '\n');
n = entries(await wholeLog()).length;
await page.click('#status-ai-undo'); await page.waitForTimeout(300);
r = await page.call('records');
check('Undo AI Changes: the document is as it was before the AI\'s changes', (await page.call('get')).result.includes('First paragraph.') && !(await page.call('get')).result.includes('Everything new.'));
check('... and the change log says the changes above were taken back', entries(await wholeLog()).length === n + 1
  && /^==== \d{4}-\d\d-\d\d \d\d:\d\d {2}The user undid the AI's changes ====\nThe changes an AI made from \d{4}-\d\d-\d\d \d\d:\d\d on \(the entries above\) were taken back by the user, with Edit > Undo AI Changes\. They are no longer in the document\.$/.test(last(r.result.changeLog)), last(r.result.changeLog));

// each document has its own log
r = await page.call('open', { path: 'D:\\Papers\\other.tex' });
const folder2 = r.result.path.replace(/\\[^\\]*$/, '');
await page.call('replaceBlock', { index: 0, latex: 'Changed in the other one.' });
r = await page.call('records');
check('another document: its own folder, log and (no) notes', r.result.folder === folder2 && folder2 !== folder && entries(r.result.changeLog).length === 2 && r.result.changeLog.includes('Changed in the other one.') && r.result.handoff.length === 0
  && !(await fileText(page, folder + '\\opensw records\\Change log.txt')).includes('Changed in the other one.'), r.result);
await page.close();

// a document with no project folder yet: the change log and the notes wait in memory for its first save
page = await start({});
await page.call('set', { latex: 'A new document.' });
r = await page.call('handoff', { text: 'Wrote the first line.' });
check('a new document: the note is kept in memory, and the reply says so', r.ok && /kept in memory/.test(r.result.kept), r);
r = await page.call('records');
check('... records says so, with what is kept', r.ok && r.result.folder === null && /not saved yet, so it is in no project folder/.test(r.result.note) && r.result.changeLog.includes('[command: set] ====') && r.result.handoff.length === 1, r);
r = await page.call('info');
check('... and info names no project', r.ok && r.result.project === undefined && r.result.aiFolder === ROOT, r);
await page.call('insert', { latex: 'Taken back.' });
await page.click('#status-ai-undo'); await page.waitForTimeout(300);
r = await page.call('records');
check('Undo AI Changes on such a document: kept in memory with the rest', /The user undid the AI's changes ====/.test(last(r.result.changeLog)) && entries(r.result.changeLog).length === 3, r.result.changeLog);
await page.call('set', { latex: 'A new document.' });
r = await page.call('save', { path: ROOT + '\\fresh.tex' });
const fresh = (r.result?.path || '').replace(/\\[^\\]*$/, '');
const freshLog = ((await fileText(page, fresh + '\\opensw records\\Change log.txt')) || '').replace(/\r\n/g, '\n');
check('its first save: the change log gets what was kept, then the save', r.ok && entries(freshLog).length === 5 && /\[command: set\] ====/.test(entries(freshLog)[0]) && /undid the AI's changes/.test(entries(freshLog)[2]) && /Saved by AI ====\nFile: fresh\.tex/.test(entries(freshLog)[4]), freshLog);
check('... the handoff note too', ((await fileText(page, fresh + '\\opensw records\\Handoff notes.txt')) || '').includes('Wrote the first line.'));
await page.call('insert', { latex: 'More.' });
r = await page.call('records');
check('from then on the records are files', r.result.folder === fresh && entries(r.result.changeLog).length === 6 && r.result.handoff.length === 1, r.result);
await page.close();

// blocks that changed far apart: only those are listed, each with its own before and after
const longStart = 'word '.repeat(120).trim();
const many = '\\documentclass{article}\r\n%TCIDATA{Version=5.50.0.2960}\r\n\\input{tcilatex}\r\n\\begin{document}\r\n\r\n'
  + Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${i === 0 ? longStart + ' colour.' : i === 39 ? 'the colour at the end.' : 'filler text.'}`).join('\r\n\r\n') + '\r\n\r\n\\end{document}\r\n';
page = await start({ 'D:\\Papers\\many.tex': many, 'D:\\Papers\\paper.tex': paper });
r = await page.call('open', { path: 'D:\\Papers\\many.tex' });
const manyFolder = r.result.project.folder;
await page.call('replace', { find: 'colour', with: 'color' });
let e = last((await page.call('records')).result.changeLog);
let lines = e.split('\n');
check('a text replaced in the first and the last of 40 paragraphs: two blocks, not forty', /AI changed 2 blocks \[command: replace\] ====$/.test(lines[0]) && lines[1] === 'Block 1' && lines[6] === 'Block 40' && lines.length === 11, lines.map((l) => l.slice(0, 60)));
check('... the long first block: what is shown of Before and of After has the difference in it', lines[3] !== lines[5] && lines[3].endsWith('colour.') && lines[5].endsWith('color.') && lines[3].startsWith('  …') && lines[3].length < 420, [lines[3].slice(-40), lines[5].slice(-40)]);
check('... the last block: its own before and after', lines[8] === '  Paragraph 39 the colour at the end.' && lines[10] === '  Paragraph 39 the color at the end.', lines.slice(7));
await page.call('replace', { find: 'filler', with: 'FILLER' });
e = last((await page.call('records')).result.changeLog);
check('38 blocks changed: the first 8 are shown, and it says how many more there are', /AI changed 38 blocks \[command: replace\]/.test(e) && e.includes('Block 9\n') && !e.includes('Block 10\n') && e.endsWith('... and 30 more blocks changed, which are not listed here.'), e.slice(-200));
r = await page.call('records');
check('records.changeLog is whole entries: it starts at a heading, also when the log is long', /^==== \d{4}-\d\d-\d\d \d\d:\d\d {2}/.test(r.result.changeLog) && r.result.changeLog.split('\n').length <= 61, r.result.changeLog.slice(0, 80));
// a change of the preamble alone is a change too
const tex = (await page.call('get')).result;
r = await page.call('set', { latex: tex.replace('\\begin{document}', '\\newcommand{\\mine}{x}\n\\begin{document}') });
e = last((await page.call('records')).result.changeLog);
check('set that changes the preamble only: logged as a change of the settings, the text being as it was', r.ok && /AI changed the document's settings, not its text \[command: set\] ====\nWhat changed is what TeX reads before the text/.test(e), e);
r = await page.call('set', { latex: (await page.call('get')).result });
check('set with the very same document: nothing to log', last((await page.call('records')).result.changeLog) === e);
// a note with a line like a heading in it stays one note
await page.call('handoff', { text: 'Done so far:\n==== 2026-01-01 10:00 ====\nthat line is mine' });
r = await page.call('records');
check('a handoff note with a line that looks like a heading is one note', r.result.handoff.length === 1 && r.result.handoff[0].endsWith('  Done so far:\n  ==== 2026-01-01 10:00 ====\n  that line is mine'), r.result.handoff);

// an entry that cannot be written is kept and written with the next; the user is told once
await page.evaluate(() => { window.shell.fail.append_file = 'Cannot write: the file is in use'; window.shell.fail.write_file = 'Cannot write: the file is in use'; window.shell.toasts.length = 0; });
await page.call('replaceBlock', { index: 1, latex: 'First while the log cannot be written.' });
await page.call('replaceBlock', { index: 2, latex: 'Second while the log cannot be written.' });
await page.waitForTimeout(300);
let told = (await toasts(page)).filter((t) => /change log could not be written/.test(t));
check('the change log cannot be written: the user is told, once, with the reason', told.length === 1 && told[0].includes('the file is in use'), await toasts(page));
r = await page.call('records');
check('... records still shows the entries (they are kept)', r.result.changeLog.includes('First while the log cannot be written.') && r.result.changeLog.includes('Second while the log cannot be written.'));
r = await page.call('handoff', { text: 'A note that cannot be written.' });
check('... a handoff note that cannot be written is an error for the AI, not a silent loss', !r.ok && /in use/.test(r.error), r);
await page.evaluate(() => { window.shell.fail = {}; });
await page.call('replaceBlock', { index: 3, latex: 'Third, when it can again.' });
await page.waitForTimeout(300);
const whole = (await fileText(page, manyFolder + '\\opensw records\\Change log.txt')).replace(/\r\n/g, '\n');
check('when it can be written again the kept entries go in first, in order', whole.indexOf('First while the log') > 0 && whole.indexOf('First while the log') < whole.indexOf('Second while the log') && whole.indexOf('Second while the log') < whole.indexOf('Third, when it can again.')
  && whole.split('First while the log cannot be written.').length === 2, whole.slice(-700));
// the kept entries are in the log; the AI's save goes in after them
r = await page.call('save');
e = last((await fileText(page, manyFolder + '\\opensw records\\Change log.txt')).replace(/\r\n/g, '\n'));
check('the save goes in the log after them', r.ok && (await fileText(page, manyFolder + '\\many.tex')).includes('Third, when it can again.') && /Saved by AI ====\nFile: many\.tex$/.test(e), [r, e]);
await page.close();

// a document opened where it is (not imported) has no records, and the AI is told so
page = await start({ 'D:\\Papers\\paper.tex': paper });
await page.evaluate(() => { window.shell.open = 'D:\\Papers\\paper.tex'; window.shell.fail.make_folder = 'Cannot create the folder: access is denied'; });
await page.click('.menu-top:has-text("File")');
await page.locator('.menu-list button:has(> span:text-is("Open..."))').filter({ visible: true }).first().click();
await page.waitForSelector('#dialog:not([hidden])');
await page.locator('#dialog-body button:text-is("Open the original without importing")').click();
await page.waitForTimeout(400);
await page.evaluate(() => { window.shell.fail = {}; });
await page.call('replaceBlock', { index: 0, latex: 'An AI edit in place.' });
r = await page.call('handoff', { text: 'Did half.' });
check('a document opened without importing: handoff says no records are kept, and that the note was not written', !r.ok && /opened where it is, without importing/.test(r.error) && /keeps no records/.test(r.error) && /The note was not written/.test(r.error), r);
r = await page.call('records');
check('... records says the same, and promises nothing', r.ok && r.result.folder === null && r.result.changeLog === '' && r.result.handoff.length === 0 && /keeps no records for such a document/.test(r.result.note) && !/when it is first saved/.test(r.result.note), r);
const allFiles = async () => JSON.stringify((await page.evaluate(() => [...window.shell.files.keys()])).sort());
r = await page.call('save');
check('... an AI cannot save it: it is outside the projects folder, and nothing is written', !r.ok && /is not in the projects folder/.test(r.error) && (await allFiles()) === JSON.stringify(['D:\\Papers\\paper.tex']), [r, await allFiles()]);
await page.click('#btn-save'); await page.waitForTimeout(700);
check('... the user\'s save writes the file itself and nothing beside it but its .bak', (await fileText(page, 'D:\\Papers\\paper.tex')).includes('An AI edit in place.')
  && (await allFiles()) === JSON.stringify(['D:\\Papers\\paper.bak', 'D:\\Papers\\paper.tex']), await allFiles());
await page.close();

// the web page has no files, so no records
page = await b.newPage();
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(800);
r = await page.evaluate(() => window.sw.call('records'));
const r2 = await page.evaluate(() => window.sw.call('handoff', { text: 'x' }));
check('the web version: records and handoff say they are the desktop app\'s', !r.ok && /desktop app/.test(r.error) && !r2.ok && /desktop app/.test(r2.error), [r, r2]);
r = await page.evaluate(async () => { await window.sw.call('insert', { latex: 'Web edit.' }); return window.sw.call('info'); });
check('... and its commands work as before', r.ok && r.result.project === undefined, r);
await page.close();

check('no page errors', errs.length === 0, errs);
await b.close();
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
