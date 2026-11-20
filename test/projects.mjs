// The projects folder (src/projects.js), on files kept in memory: how paths are compared, what a
// project is, how a project folder is named, what an import copies and what it leaves, finding
// an earlier import, where a save goes, how project.json follows the document, and the text of
// the three records.
// Run: node test/projects.mjs  (needs no browser)
import { memoryFiles } from './lib/desktop.mjs';
import * as P from '../src/projects.js';

let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail ?? '').slice(0, 900)); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// projects.js is given the file system: the one in memory, as the desktop app gives the disk
const filesOf = (mem) => ({
  read: async (p) => Uint8Array.from(mem.read(p)), write: async (p, b) => mem.write(p, b), append: async (p, b) => mem.append(p, b), exists: async (p) => mem.exists(p),
  list: async (p) => mem.list(p), makeFolder: async (p, fresh) => mem.makeFolder(p, fresh), copy: async (a, b) => mem.copy(a, b), copyNamed: async (t, a, b) => mem.copyNamed(t, a, b),
  trash: async (paths) => mem.trash(paths),
});
const text = (mem, path) => (mem.exists(path) ? new TextDecoder().decode(Uint8Array.from(mem.read(path))) : null);
const record = (mem, folder, name) => (text(mem, `${folder}\\opensw records\\${name}`) || '').replace(/\r\n/g, '\n');
const bytes = (s) => new TextEncoder().encode(s);
// what a sub-document names, read from its text as the editor does from the document it parses
// (pictures as pic:name; here: like the file name in a 5.x \FRAME, not a {name} the shell would copy)
const usesOf = (b) => { const t = new TextDecoder().decode(b); return { pictures: [...t.matchAll(/pic:([^;]*);/g)].map((m) => m[1]), others: [...t.matchAll(/\\input\{([^}]*)\}/g)].map((m) => m[1] + '.tex') }; };
const ROOT = 'C:\\Users\\prof\\Desktop\\opensw projects';
const day = new Date(2026, 0, 2, 9, 5); // 2026-01-02 09:05, this computer's time
const later = new Date(2026, 0, 2, 15, 30);

// ---- one way of comparing paths
const A = 'D:\\Papers\\a.tex';
check('the same file: slashes, letter case, ".", "..", doubled slashes', ['d:/papers/A.TEX', 'D:\\Papers\\.\\a.tex', 'D:\\Papers\\\\a.tex', 'D:\\Papers\\sub\\..\\a.tex'].every((p) => P.samePath(A, p)));
check('... the dots and spaces a name ends with, and \\\\?\\ in front (Windows drops them)', ['D:\\Papers\\a.tex.', 'D:\\Papers\\a.tex ', 'D:\\Papers .\\a.tex', '\\\\?\\D:\\Papers\\a.tex'].every((p) => P.samePath(A, p)));
check('... a \\\\server path too, also as \\\\?\\UNC\\', P.samePath('\\\\server\\share\\Papers\\a.tex', '//SERVER/Share/papers/A.tex') && P.samePath('\\\\server\\share\\a.tex', '\\\\?\\UNC\\server\\share\\a.tex'));
check('other files are other files', !P.samePath(A, 'D:\\Papers\\b.tex') && !P.samePath(A, 'E:\\Papers\\a.tex') && !P.samePath(A, 'D:\\Papers\\a.tex.bak') && !P.samePath('D:\\Papers\\a b.tex', 'D:\\Papers\\ab.tex'));
check('on a Unix disk letter case and a dot at the end do count', !P.samePath('/home/prof/a.tex', '/home/prof/A.tex') && !P.samePath('/home/prof/a.tex', '/home/prof/a.tex.') && P.samePath('/home/prof/./x/../a.tex', '/home/prof/a.tex'));
check('a mapped drive and its \\\\server name cannot be told to be one file by their paths', !P.samePath('Z:\\Papers\\a.tex', '\\\\server\\share\\Papers\\a.tex'));
check('in a folder: by the same comparing', P.insideFolder('d:/PAPERS/sub/a.tex', 'D:\\Papers') && P.insideFolder('\\\\?\\D:\\Papers.\\a.tex', 'D:\\Papers') && !P.insideFolder('D:\\Papers\\..\\a.tex', 'D:\\Papers')
  && !P.insideFolder('D:\\Papersx\\a.tex', 'D:\\Papers') && !P.insideFolder('a.tex', 'D:\\Papers') && P.insideFolder('\\\\SERVER\\share\\Desktop\\x\\a.tex', '\\\\server\\Share\\desktop'));

// ---- names and places
check('folder name: the file\'s name first, then the day', P.folderName('paper', '2026-01-02', []) === 'paper_2026-01-02');
check('the same name on the same day: _2, _3 (letter case does not count)', P.folderName('paper', '2026-01-02', ['Paper_2026-01-02']) === 'paper_2026-01-02_2'
  && P.folderName('paper', '2026-01-02', ['paper_2026-01-02', 'paper_2026-01-02_2']) === 'paper_2026-01-02_3');
check('the day is this computer\'s, as YYYY-MM-DD', P.dateOf(day) === '2026-01-02' && P.timeOf(day) === '2026-01-02 09:05');
check('the folder of the projects folder a file is in, by its path', P.projectOf(ROOT + '\\paper_2026-01-02\\graphics\\a.png', ROOT) === ROOT + '\\paper_2026-01-02'
  && P.projectOf('c:/users/prof/desktop/opensw projects/x_1/x.tex', ROOT) === ROOT + '\\x_1' && P.projectOf('\\\\?\\' + ROOT + '\\x_1\\x.tex', ROOT) === ROOT + '\\x_1');
check('none for a file lying in the projects folder itself, one elsewhere, one reached with ".."', P.projectOf(ROOT + '\\loose.tex', ROOT) === null
  && P.projectOf('D:\\Papers\\a.tex', ROOT) === null && P.projectOf(ROOT + '\\x_1\\..\\..\\a.tex', ROOT) === null && P.projectOf(null, ROOT) === null && P.projectOf(ROOT + '\\x\\a.tex', null) === null && P.projectOf(ROOT + 'x\\a_1\\a.tex', ROOT) === null);
check('none for anything in a folder\'s records: nothing there is a document', P.projectOf(ROOT + '\\a_1\\opensw records\\Original\\a.tex', ROOT) === null && P.projectOf(ROOT + '\\a_1\\OPENSW RECORDS\\x.tex', ROOT) === null
  && P.inRecords(ROOT + '\\a_1\\opensw records\\Original\\a.tex', ROOT) && P.inRecords(ROOT.toUpperCase() + '\\a_1\\Opensw Records\\project.json', ROOT) && !P.inRecords(ROOT + '\\a_1\\a.tex', ROOT) && P.inRecords('D:\\x\\opensw records\\a.tex', ROOT));
check('records anywhere: the folder itself, descendants and mixed case, but not a similar name', ['E:\\moved\\opensw records', 'E:\\moved\\OPENSW RECORDS\\Original\\a.tex', '/moved/Opensw Records/a.tex'].every((p) => P.inRecords(p))
  && !P.inRecords('E:\\moved\\opensw records extra\\a.tex') && !P.inRecords('E:\\moved\\opensw records\\..\\a.tex'));
check('Unix paths too', P.projectOf('/home/prof/Desktop/opensw projects/a_1/a.tex', '/home/prof/Desktop/opensw projects') === '/home/prof/Desktop/opensw projects/a_1'
  && P.joinPath('/home/prof', 'graphics\\a.png') === '/home/prof/graphics/a.png');
check('a projects folder on a \\\\server (a redirected Desktop), named with other letter case', P.projectOf('\\\\SERVER\\Share\\prof\\desktop\\opensw projects\\a_1\\a.tex', '\\\\server\\share\\prof\\Desktop\\opensw projects') === '\\\\server\\share\\prof\\Desktop\\opensw projects\\a_1');

// ---- where a save goes
const PF = ROOT + '\\paper_2026-01-02';
const inProject = PF + '\\paper.tex';
const plan = (current, target, project = current ? PF : null) => P.savePlan({ root: ROOT, project, current, target });
check('save: back to its own file', same(plan(inProject, inProject), { write: inProject }));
check('save: under another name in its own project folder, also in a folder of it: that file', same(plan(inProject, PF + '\\paper-v2.tex'), { write: PF + '\\paper-v2.tex' }) && same(plan(inProject, PF.toUpperCase() + '\\parts\\x.tex'), { write: PF.toUpperCase() + '\\parts\\x.tex' }));
check('save: anywhere else in the projects folder (in it, in another project, in a folder that is none): a project folder of its own',
  same(plan(inProject, ROOT + '\\loose.tex'), { folder: 'loose', name: 'loose.tex' }) && same(plan(inProject, ROOT + '\\other_1\\b.tex'), { folder: 'b', name: 'b.tex' }) && same(plan(inProject, ROOT + '\\deep\\er\\n.sci'), { folder: 'n', name: 'n.sci' }));
check('save: a target outside is a copy; the document stays in its project', same(plan(inProject, 'E:\\usb\\paper.tex'), { write: inProject, copy: 'E:\\usb\\paper.tex' }));
check('save: a new document always gets a folder of its own: pointed outside (with the copy there), into the projects folder, into a project',
  same(plan(null, 'E:\\usb\\new.sci'), { folder: 'new', name: 'new.sci', copy: 'E:\\usb\\new.sci' }) && same(plan(null, ROOT + '\\n.tex'), { folder: 'n', name: 'n.tex' }) && same(plan(null, PF + '\\n.tex'), { folder: 'n', name: 'n.tex' }));
check('save: nothing goes into a project\'s records', same(plan(inProject, PF + '\\opensw records\\Original\\paper.tex'), { refuse: 'records' }) && same(plan(null, ROOT + '\\other_1\\opensw records\\x.tex'), { refuse: 'records' })
  && same(plan('D:\\Papers\\a.tex', PF + '\\Opensw Records\\x.tex', null), { refuse: 'records' }));
check('save: a document opened in place (not imported) is saved where the user says; into the projects folder it becomes a project', same(plan('D:\\Papers\\a.tex', 'D:\\Papers\\b.tex', null), { write: 'D:\\Papers\\b.tex' })
  && same(plan('D:\\Papers\\a.tex', ROOT + '\\b.tex', null), { folder: 'b', name: 'b.tex' }));
check('save: a document keeps its project when the projects folder is another one now', same(P.savePlan({ root: 'E:\\New projects', project: PF, current: inProject, target: inProject }), { write: inProject })
  && same(P.savePlan({ root: 'E:\\New projects', project: PF, current: inProject, target: 'D:\\Papers\\x.tex' }), { write: inProject, copy: 'D:\\Papers\\x.tex' })
  && same(P.savePlan({ root: 'E:\\New projects', project: PF, current: inProject, target: PF + '\\opensw records\\x.tex' }), { refuse: 'records' }));
check('save: with no projects folder at all a file is written where it is asked', same(P.savePlan({ root: null, current: null, target: 'D:\\a.tex' }), { write: 'D:\\a.tex' }));

// ---- importing
const main = '\\documentclass{article}\\begin{document}\\input{ch1} \\lstinputlisting{prog.py} \\bibliography{refs}\\end{document}';
const mem = memoryFiles({
  'D:\\Papers\\paper.tex': main,
  'D:\\Papers\\ch1.tex': 'Chapter \\input{parts/deep} pic:graphics/subpic.png; pic:figs/plot; pic:nowhere.png;',
  'D:\\Papers\\parts\\deep.tex': 'deep pic:deeper.png; \\input{parts/deepest}',
  'D:\\Papers\\parts\\deepest.tex': 'pic:too-deep.png;',
  'D:\\Papers\\prog.py': 'print(1)',
  'D:\\Papers\\refs.bib': '@book{a}',
  'D:\\Papers\\graphics\\plot1.wmf': 'wmf',
  'D:\\Papers\\graphics\\subpic.png': 'png',
  'D:\\Papers\\figs\\a.png': 'png',
  'D:\\Papers\\figs\\plot.pdf': 'pdf',
  'D:\\Papers\\deeper.png': 'png',
  'D:\\Papers\\too-deep.png': 'png',
  'D:\\Papers\\paper.steps.json': '{"doc":"paper.tex"}',
  'D:\\Papers\\unrelated.txt': 'not named',
  'D:\\Shared\\logo.png': 'logo',
  'D:\\up.png': 'up',
});
const files = filesOf(mem);
const uses = { pictures: ['figs/a.png', 'plot1.wmf', 'D:\\Shared\\logo.png', '../up.png', 'missing.png'], others: ['ch1.tex', 'refs.bib', 'gone.tex', '..\\secret.tex'] };
const report = await P.importDocument(files, { root: ROOT, source: 'D:\\Papers\\paper.tex', bytes: bytes(main), tex: main, ...uses, usesOf, facts: { texFields: 2, latex: true }, now: day });
const F = ROOT + '\\paper_2026-01-02';
check('import: a folder named after the file and the day; the main file keeps its name', report.folder === F && report.path === F + '\\paper.tex' && text(mem, F + '\\paper.tex') === main, report);
check('import: pictures (where they are found), sub-documents, .bib and the steps file come along, in the same places',
  ['figs\\a.png', 'graphics\\plot1.wmf', 'ch1.tex', 'refs.bib', 'paper.steps.json'].every((f) => mem.exists(F + '\\' + f)), [...mem.files.keys()]);
check('import: so do the files the text names (a listing, what a sub-document reads in)', mem.exists(F + '\\prog.py') && mem.exists(F + '\\parts\\deep.tex'), [...mem.files.keys()]);
check('import: the pictures a sub-document names come along, also one named without its ending, and those of the sub-documents it reads in', mem.exists(F + '\\graphics\\subpic.png') && mem.exists(F + '\\figs\\plot.pdf') && mem.exists(F + '\\deeper.png'), report.copied);
check('import: ... two levels down, no further (that sub-document itself is copied, as a file the text names)', !mem.exists(F + '\\too-deep.png') && mem.exists(F + '\\parts\\deepest.tex'));
check('import: a file nothing names stays', !mem.exists(F + '\\unrelated.txt'));
check('import: files named with a full path or ".." are not copied, and are listed', same(report.notCopied, ['D:\\Shared\\logo.png', '../up.png', '..\\secret.tex'])
  && ![...mem.files.keys()].some((p) => p.startsWith(ROOT) && /logo|up\.png|secret/.test(p)), report);
check('import: files not found are listed, a sub-document\'s too', same(report.notFound, ['missing.png', 'gone.tex', 'nowhere.png']), report);
check('import: the report lists what was copied', same([...report.copied].sort(), ['ch1.tex', 'deeper.png', 'figs/a.png', 'figs/plot.pdf', 'graphics/plot1.wmf', 'graphics/subpic.png', 'paper.steps.json', 'parts/deep.tex', 'parts/deepest.tex', 'prog.py', 'refs.bib']), report.copied);
check('import: nothing is written outside the projects folder', mem.writes.every((p) => p.startsWith(ROOT + '\\')), mem.writes);
check('import: the main file as it was imported is kept in the records', text(mem, F + '\\opensw records\\Original\\paper.tex') === main);
const project = JSON.parse(text(mem, F + '\\opensw records\\project.json'));
check('project.json: where from, its SHA-256, when, the main file', project.source === 'D:\\Papers\\paper.tex' && project.sourceSha256 === await P.sha256(bytes(main)) && /^[0-9a-f]{64}$/.test(project.sourceSha256)
  && project.imported === day.toISOString() && project.main === 'paper.tex' && same(report.project, project), project);
const log = text(mem, F + '\\opensw records\\Change log.txt');
check('Change log: the import, where from and how big, what came along and what did not', /==== 2026-01-02 09:05 {2}Imported ====/.test(log) && log.includes(`From: D:\\Papers\\paper.tex (${main.length} bytes)`)
  && log.includes('Files copied with it (11): ') && log.includes('Named in the document but not found (3): missing.png, gone.tex, nowhere.png')
  && log.includes('Not copied because they are outside the document\'s folder (3): ') && log.includes('grey TeX fields: 2')
  && log.includes('Save will write it as a Scientific Word 5.x file'), log);
check('Change log: what it says of the original stays true whatever the user does later', log.includes('Saving writes the copy; the file it was imported from is written only if you choose that very file yourself (in File > Save As, or as the place for Tools > Document Manager > Copy).')
  && !/never writes/.test(log) && !/counted from 0/.test(log));
check('the records open in Notepad: UTF-8 with its mark, \\r\\n lines', same(mem.read(F + '\\opensw records\\Change log.txt').slice(0, 3), [0xef, 0xbb, 0xbf]) && /[^\r]\r\n/.test(log) && !/[^\r]\n/.test(log));
const map = record(mem, F, 'File map.txt');
check('File map: the folder, the main document, where it came from', map.includes(`This folder\n  ${F}`) && map.includes('The main document\n  paper.tex') && map.includes('Imported on 2026-01-02 09:05 from\n  D:\\Papers\\paper.tex')
  && map.includes('opensw does not write to that file: it works on the copy in this folder.\n  (It is written only if you choose that very file yourself, in File > Save As or as the place for Tools > Document Manager > Copy.)'), map);
check('File map: the files it uses, those not found, those left outside, the steps file, the records, the PDF', ['  figs/a.png', '  graphics/plot1.wmf', '  ch1.tex', '  refs.bib', '  prog.py', '  parts/deep.tex', '  graphics/subpic.png'].every((l) => map.includes(l + '\n'))
  && /not found\n {2}missing\.png\n {2}gone\.tex/.test(map) && /left where they are\)\n {2}D:\\Shared\\logo\.png/.test(map) && map.includes('paper.steps.json  (the names of the derivation steps')
  && map.includes('Change log.txt') && map.includes('Handoff notes.txt') && map.includes('Original\\          the file exactly as it was imported; opensw does not open it or write it again') && map.includes('(none yet: when opensw saves over a file') && map.includes('The PDF is not kept in this folder'), map);

// ---- a project is a folder with opensw's records
check('a file of a folder that has project.json is in a project', same(await P.projectAt(files, F + '\\ch1.tex', ROOT), { folder: F, data: project }));
mem.write(ROOT + '\\2024\\thesis.tex', 'x');
mem.write(ROOT + '\\broken_1\\b.tex', 'x'); mem.write(ROOT + '\\broken_1\\opensw records\\project.json', '{ not json');
mem.write(ROOT + '\\other_1\\o.tex', 'x'); mem.write(ROOT + '\\other_1\\opensw records\\project.json', '{"something":"else"}');
check('a file of a folder without it is outside; so with a project.json that does not read, or is not opensw\'s', (await P.projectAt(files, ROOT + '\\2024\\thesis.tex', ROOT)) === null && (await P.projectAt(files, ROOT + '\\broken_1\\b.tex', ROOT)) === null
  && (await P.projectAt(files, ROOT + '\\other_1\\o.tex', ROOT)) === null && same(await P.projectState(files, ROOT + '\\broken_1'), { exists: true, data: null }) && same(await P.projectState(files, ROOT + '\\2024'), { exists: false, data: null }));
check('a file in a project\'s records is outside too', (await P.projectAt(files, F + '\\opensw records\\Original\\paper.tex', ROOT)) === null);
// The closest readable project counts wherever it is, including after a move.
const movedHome = 'E:\\moved\\paper_2026-01-02';
const nestedHome = movedHome + '\\chapters';
const movedMem = memoryFiles({
  [movedHome + '\\opensw records\\project.json']: JSON.stringify(project),
  [movedHome + '\\paper.tex']: main,
  [nestedHome + '\\opensw records\\project.json']: JSON.stringify({ source: 'D:\\Papers\\chapter.tex', imported: day.toISOString(), main: 'chapter.tex' }),
  [nestedHome + '\\chapter.tex']: 'Chapter one.',
}, { caseBlind: true });
const movedFiles = filesOf(movedMem);
check('a moved project is found without any projects folder, including through normalized paths', (await P.projectAt(movedFiles, movedHome + '\\part\\..\\paper.tex'))?.folder === movedHome
  && (await P.projectAt(movedFiles, '\\\\?\\' + movedHome + '\\paper.tex'))?.folder === movedHome);
check('the nearest readable project wins; an unreadable nearer one leaves the parent available', (await P.projectAt(movedFiles, nestedHome + '\\sections\\one.tex'))?.folder === nestedHome
  && (await P.projectAt({ ...movedFiles, read: async (p) => { if (p.startsWith(nestedHome)) throw new Error('Cannot read'); return movedFiles.read(p); } }, nestedHome + '\\sections\\one.tex'))?.folder === movedHome);
check('records in a moved project are outside, and cannot be save targets', (await P.projectAt(movedFiles, movedHome + '\\opensw records\\Original\\paper.tex')) === null
  && same(P.savePlan({ root: ROOT, current: inProject, project: PF, target: movedHome + '\\opensw records\\paper.tex' }), { refuse: 'records' }));
const roots = ['E:\\New projects', 'E:\\Unavailable projects', ROOT, ROOT.toUpperCase()];
const pastFiles = { ...files, list: async (p) => { if (p === roots[1]) throw new Error('Cannot list'); return files.list(p); } };
check('past projects folders are searched once and unavailable ones are skipped', await P.isOriginal(pastFiles, roots, project.source)
  && (await P.findImports(pastFiles, roots, project.source)).length === 1);
const movedOwn = { folder: movedHome, data: project };
check('the open project counts outside every known projects folder', await P.isOriginal(movedFiles, ['E:\\New projects'], project.source, project)
  && (await P.findImports(movedFiles, ['E:\\New projects'], project.source, null, movedOwn))[0]?.path === movedHome + '\\paper.tex');
const nestedOwn = { folder: nestedHome, data: await P.readProject(movedFiles, nestedHome) };
const listedRoots = [];
const shallowFiles = { ...movedFiles, list: async (p) => { listedRoots.push(p); return movedFiles.list(p); } };
check('only direct projects below a known root are searched; an open nested project is still protected', !(await P.isOriginal(shallowFiles, ['E:\\moved'], 'D:\\Papers\\chapter.tex'))
  && (await P.findImports(shallowFiles, ['E:\\moved'], 'D:\\Papers\\chapter.tex')).length === 0
  && listedRoots.every((p) => p === 'E:\\moved')
  && await P.isOriginal(movedFiles, ['E:\\moved'], 'D:\\Papers\\chapter.tex', nestedOwn.data)
  && (await P.findImports(movedFiles, ['E:\\moved'], 'D:\\Papers\\chapter.tex', null, nestedOwn))[0]?.path === nestedHome + '\\chapter.tex');
const strayFiles = filesOf(memoryFiles({
  'D:\\opensw records\\project.json': JSON.stringify({ main: 'missing.tex' }),
  'D:\\Papers\\paper.tex': main,
}));
check('a stray readable project.json without its main document is not a project', await P.projectAt(strayFiles, 'D:\\Papers\\paper.tex') === null);
const missingNear = { ...movedFiles, exists: async (p) => p === nestedHome + '\\chapter.tex' ? false : movedFiles.exists(p) };
check('a nearer project missing its main document leaves the parent available', (await P.projectAt(missingNear, nestedHome + '\\sections\\one.tex'))?.folder === movedHome);
const rootProjectFiles = filesOf(memoryFiles({ '/opensw records/project.json': JSON.stringify({ main: 'main.tex' }), '/main.tex': main,
  '/stray/opensw records/project.json': JSON.stringify({ main: '../main.tex' }), '/stray/file.tex': main }));
check('a Unix root project is recognised, but a nearer record pointing outside its folder is skipped', (await P.projectAt(rootProjectFiles, '/stray/file.tex'))?.folder === '/');
check('which files are originals: the ones projects were imported from, however spelled', await P.isOriginal(files, ROOT, 'd:/papers/./PAPER.tex.') && !(await P.isOriginal(files, ROOT, 'D:\\Papers\\ch1.tex'))
  && await P.isOriginal(files, 'E:\\Another root', 'E:\\Old\\x.tex', { source: 'E:\\Old\\x.tex' }) && !(await P.isOriginal(files, null, 'D:\\Papers\\paper.tex')));

// ---- an earlier import
let earlier = await P.findImports(files, ROOT, 'd:/papers/PAPER.tex');
check('an earlier import is found by the original\'s path, however it is spelled', earlier.length === 1 && earlier[0].path === F + '\\paper.tex' && earlier[0].folder === F && earlier[0].how === 'path'
  && (await P.findImports(files, ROOT, '\\\\?\\D:\\Papers\\sub\\..\\paper.tex.')).length === 1, earlier);
check('the original is unchanged: the same SHA-256', earlier[0].project.sourceSha256 === await P.sha256(bytes(main)));
check('the original has changed: another SHA-256', earlier[0].project.sourceSha256 !== await P.sha256(bytes(main + ' edited')));
check('another file has no earlier import', (await P.findImports(files, ROOT, 'D:\\Papers\\ch1.tex')).length === 0 && (await P.findImports(files, 'C:\\none', 'D:\\Papers\\paper.tex')).length === 0);
const sha = await P.sha256(bytes(main));
earlier = await P.findImports(files, ROOT, '\\\\server\\share\\Papers\\Paper.tex', sha);
check('a file of the same name and contents under a path that cannot be compared (a \\\\server name of a mapped drive): offered as such', earlier.length === 1 && earlier[0].how === 'contents' && earlier[0].project.source === 'D:\\Papers\\paper.tex', earlier);
check('... not when the name or the contents differ', (await P.findImports(files, ROOT, '\\\\server\\share\\Papers\\other.tex', sha)).length === 0 && (await P.findImports(files, ROOT, '\\\\server\\share\\Papers\\paper.tex', await P.sha256(bytes('x')))).length === 0);
const again = await P.importDocument(files, { root: ROOT, source: 'D:\\Papers\\paper.tex', bytes: bytes(main), tex: main, ...uses, now: later });
check('imported again on the same day: _2', again.folder === F + '_2' && mem.exists(F + '_2\\paper.tex') && mem.exists(F + '_2\\figs\\a.png'), again);
earlier = await P.findImports(files, ROOT, 'D:\\Papers\\paper.tex', sha);
check('of several imports the newest is first; a match by path leaves those by contents out', earlier.length === 2 && earlier[0].folder === F + '_2' && earlier.every((e) => e.how === 'path'), earlier.map((e) => e.folder));
mem.files.delete(F + '_2\\paper.tex');
earlier = await P.findImports(files, ROOT, 'D:\\Papers\\paper.tex');
check('an import whose copy is gone does not count', earlier.length === 1 && earlier[0].folder === F, earlier.map((e) => e.folder));
// a file on a network share (the only copy there is of it): imported like any other, nothing written there
const net = memoryFiles({ '\\\\server\\share\\Papers\\a.tex': 'x \\input{ch1}', '\\\\server\\share\\Papers\\graphics\\p.png': 'png', '\\\\server\\share\\Papers\\ch1.tex': 'c' });
const fromNet = await P.importDocument(filesOf(net), { root: ROOT, source: '\\\\server\\share\\Papers\\a.tex', bytes: bytes('x \\input{ch1}'), tex: 'x \\input{ch1}', pictures: ['p.png'], others: ['ch1.tex'], now: day });
check('a file on a network share: copied with its files, nothing written on the share', fromNet.path === ROOT + '\\a_2026-01-02\\a.tex' && same(fromNet.copied, ['graphics/p.png', 'ch1.tex'])
  && net.writes.every((p) => p.startsWith(ROOT + '\\')) && (await P.findImports(filesOf(net), ROOT, '//SERVER/share/papers/A.tex')).length === 1, fromNet);

// ---- a Windows disk: names that differ by letter case only are one file
const win = memoryFiles({ 'D:\\Papers\\paper.tex': 'x', 'D:\\Papers\\graphics\\pic.png': 'png' }, { caseBlind: true });
const twice = await P.importDocument(filesOf(win), { root: ROOT, source: 'D:\\Papers\\paper.tex', bytes: bytes('x'), tex: 'x', pictures: ['graphics/pic.png', 'Graphics/PIC.png'], others: [], now: day });
check('a picture named twice with other letter case is copied once, and the import goes through', same(twice.copied, ['graphics/pic.png']) && twice.notFound.length === 0 && win.exists(ROOT + '\\paper_2026-01-02\\GRAPHICS\\pic.PNG'), twice);
check('... on such a disk a second import still gets a folder of its own', (await P.importDocument(filesOf(win), { root: ROOT, source: 'D:\\PAPERS\\Paper.tex', bytes: bytes('x'), tex: 'x', now: day })).folder === ROOT + '\\Paper_2026-01-02_2');

// ---- two imports at the same moment; an import that fails
const busy = memoryFiles({ 'D:\\A\\paper.tex': 'from A', 'E:\\B\\paper.tex': 'from B' });
const both = await Promise.all([['D:\\A\\paper.tex', 'from A'], ['E:\\B\\paper.tex', 'from B']].map(([source, t]) => P.importDocument(filesOf(busy), { root: ROOT, source, bytes: bytes(t), tex: t, now: day })));
check('two files of one name imported at the same moment get a folder each', both[0].folder !== both[1].folder && text(busy, both[0].path) === 'from A' && text(busy, both[1].path) === 'from B'
  && same(both.map((r) => r.folder).sort(), [ROOT + '\\paper_2026-01-02', ROOT + '\\paper_2026-01-02_2']), both.map((r) => r.folder));
const full = memoryFiles({ 'D:\\Papers\\paper.tex': 'x', 'D:\\Papers\\fig.png': 'png' });
const failing = { ...filesOf(full), copy: async () => { throw new Error('Cannot copy: the disk is full'); } };
let failed = await P.importDocument(failing, { root: ROOT, source: 'D:\\Papers\\paper.tex', bytes: bytes('x'), tex: 'x', pictures: ['fig.png'], now: day }).catch((e) => e);
check('an import that fails leaves nothing behind: the folder it began goes to the Recycle Bin', failed instanceof Error && /disk is full/.test(failed.message) && !failed.left && same(full.trashed, [ROOT + '\\paper_2026-01-02'])
  && ![...full.files.keys()].some((p) => p.startsWith(ROOT)), [String(failed), full.trashed, [...full.files.keys()]]);
failed = await P.importDocument({ ...failing, trash: async () => { throw new Error('no Recycle Bin'); } }, { root: ROOT, source: 'D:\\Papers\\paper.tex', bytes: bytes('x'), tex: 'x', pictures: ['fig.png'], now: day }).catch((e) => e);
check('... when that cannot be done either, the error names the folder that is left; it has no project.json, so it is no project', failed.left === ROOT + '\\paper_2026-01-02' && (await P.findImports(filesOf(full), ROOT, 'D:\\Papers\\paper.tex')).length === 0
  && (await P.projectAt(filesOf(full), ROOT + '\\paper_2026-01-02\\paper.tex', ROOT)) === null, failed.left);

check('import creates a handoff header without a real note', record(mem, F, 'Handoff notes.txt').replace(/^\ufeff/, '').startsWith('Handoff notes for paper.tex\n')
  && (await P.readRecords(files, F)).handoff.length === 0 && (await P.projectFacts(files, { folder: F, data: project })).handoff === null);

// ---- the change log
const long = 'x'.repeat(900);
const entry = P.changeEntry({ who: 'AI (Some App)', command: 'replaceBlock', changes: [{ at: 13, removed: 1, added: 1, before: 'Old $a^2$ text', after: long }] }, day);
check('an AI change: when, who, the block counted from 1, the command as a tag at the end; before and after', entry.startsWith('==== 2026-01-02 09:05  AI (Some App) changed block 13 [command: replaceBlock] ====\nBefore:\n  Old $a^2$ text\nAfter:\n  xxx'), entry.slice(0, 200));
check('a long text is cut at 400 characters, with …', entry.includes('x'.repeat(400) + '…\n') && !entry.includes('x'.repeat(401)));
const head = (changes) => P.changeEntry({ who: 'AI', command: 'c', changes }, day).split('\n')[0].replace(/^==== \S+ \S+ {2}AI /, '').replace(' [command: c] ====', '');
const one = (at, removed, added) => [{ at, removed, added, before: 'b', after: 'a' }];
check('what was done, in the heading: put in, taken out, changed, replaced', same([head(one(3, 0, 1)), head(one(1, 0, 2)), head(one(3, 2, 0)), head(one(3, 1, 3)), head(one(3, 3, 3)), head([...one(1, 1, 1), ...one(40, 1, 1)])],
  ['put in one block after block 2', 'put in 2 blocks at the start', 'took out blocks 3 to 4', 'replaced block 3 by 3 blocks', 'changed blocks 3 to 5', 'changed 2 blocks']), [head(one(3, 0, 1)), head(one(1, 0, 2)), head(one(3, 2, 0)), head(one(3, 1, 3)), head(one(3, 3, 3))]);
check('nothing before (an insert) is said so', P.changeEntry({ who: 'AI', command: 'insert', changes: [{ at: 1, removed: 0, added: 1, before: '', after: 'New' }] }, day).includes('Before:\n  (nothing)\nAfter:\n  New\n'));
// blocks far apart: each with its own before and after, and the difference is in what is shown
const lead = 'word '.repeat(120);
const far = P.changeEntry({ who: 'AI', command: 'replace', changes: [{ at: 1, removed: 1, added: 1, before: lead + 'colour.', after: lead + 'color.' }, { at: 40, removed: 1, added: 1, before: 'the colour at the end.', after: 'the color at the end.' }] }, day);
check('blocks far apart: only those that differ, each with its own before and after', /changed 2 blocks \[command: replace\] ====\nBlock 1\nBefore:\n {2}…[^\n]*colour\.\nAfter:\n {2}…[^\n]*color\.\nBlock 40\nBefore:\n {2}the colour at the end\.\nAfter:\n {2}the color at the end\.\n\n$/.test(far), far);
const [b1, a1] = [far.split('\n')[3], far.split('\n')[5]];
check('... a long block that differs at its end: Before and After are not the same 400 characters', b1 !== a1 && b1.length < 420 && b1.endsWith('colour.') && a1.endsWith('color.'), [b1.slice(-30), a1.slice(-30)]);
const lots = P.changeEntry({ who: 'AI', command: 'replace', changes: Array.from({ length: 12 }, (_, i) => ({ at: i + 1, removed: 1, added: 1, before: `old ${i}`, after: `new ${i}` })) }, day);
check('many blocks: the first 8 are shown, and how many more there are is said', lots.includes('changed 12 blocks') && lots.includes('Block 8\n') && !lots.includes('Block 9\n') && lots.includes('... and 4 more blocks changed, which are not listed here.'), lots);
check('a change of the document\'s settings alone (the preamble) is an entry too', P.changeEntry({ who: 'AI', command: 'set', changes: [], settings: true }, day)
  === '==== 2026-01-02 09:05  AI changed the document\'s settings, not its text [command: set] ====\nWhat changed is what TeX reads before the text (the preamble, the title page). The text is as it was.\n\n');
check('the user undid the AI\'s changes: one entry saying from when', P.undoEntry('2026-01-02 09:05', later) === '==== 2026-01-02 15:30  The user undid the AI\'s changes ====\nThe changes an AI made from 2026-01-02 09:05 on (the entries above) were taken back by the user, with Edit > Undo AI Changes. They are no longer in the document.\n\n');
check('a .sci copy has its pictures inside it, and the log says that', P.saveEntry({ by: 'the user', name: 'a.tex', copy: 'E:\\usb\\a.sci' }, day).endsWith('A copy was also saved to: E:\\usb\\a.sci\nThe copy is one .sci file, with its pictures inside it.\n\n'));

// ---- a save: the log, the file map, project.json
await P.appendChange(files, F, 'paper.tex', entry);
await P.appendNote(files, F, P.noteEntry('First note.\nTwo lines.', day));
for (const n of [2, 3, 4]) await P.appendNote(files, F, P.noteEntry(`Note ${n}`, later));
let saved = await P.recordSave(files, { folder: F, name: 'paper.tex', by: 'AI (Some App)', copy: 'E:\\usb\\paper.tex', pictures: ['figs/a.png'], others: ['ch1.tex'], shown: true, now: later });
check('a save: the first one says so, and is remembered', saved.first === true && saved.project.folderShown === true && saved.project.source === 'D:\\Papers\\paper.tex', saved);
saved = await P.recordSave(files, { folder: F, name: 'paper.tex', by: 'the user', shown: true, now: later });
check('... the next is not the first', saved.first === false);
let records = await P.readRecords(files, F);
check('records: the folder and the three files', records.folder === F && same(records.files, { changeLog: F + '\\opensw records\\Change log.txt', fileMap: F + '\\opensw records\\File map.txt', handoff: F + '\\opensw records\\Handoff notes.txt' }), records.files);
check('records: the change log has the import, the AI change and the saves, in order', records.changeLog.indexOf('Imported ====') < records.changeLog.indexOf('changed block 13 [command: replaceBlock]')
  && records.changeLog.indexOf('replaceBlock') < records.changeLog.indexOf('Saved by AI (Some App) ====\nFile: paper.tex\nA copy was also saved to: E:\\usb\\paper.tex\nOnly the document file was copied, not the pictures and sub-documents it uses. Tools > Document Manager > Copy takes those along.\n')
  && records.changeLog.trimEnd().endsWith('Saved by the user ====\nFile: paper.tex'), records.changeLog);
check('records: the last three handoff notes, each with its date and time', same(records.handoff, ['==== 2026-01-02 15:30 ====\n  Note 2', '==== 2026-01-02 15:30 ====\n  Note 3', '==== 2026-01-02 15:30 ====\n  Note 4']), records.handoff);
check('records: the file map, written again at the save', records.fileMap.includes('Written by opensw on 2026-01-02 15:30') && records.fileMap.includes('  figs/a.png\n'), records.fileMap.slice(0, 300));
// a note with a line that looks like a heading stays one note
const tricky = memoryFiles({});
await P.appendNote(filesOf(tricky), F, P.noteEntry('Done:\n==== 2026-01-01 10:00 ====\nstill my note', day));
await P.appendNote(filesOf(tricky), F, P.noteEntry('Second.', later));
check('a handoff note with a line like a heading in it is still one note', same((await P.readRecords(filesOf(tricky), F)).handoff, ['==== 2026-01-02 09:05 ====\n  Done:\n  ==== 2026-01-01 10:00 ====\n  still my note', '==== 2026-01-02 15:30 ====\n  Second.']));
const crNote = P.noteEntry('One\r==== 2026-01-01 ====> forged\r\nThree\nFour', day);
check('CR, CRLF and LF in a handoff note stay indented in one real entry', same(P.lastNotes(crNote, 3), ['==== 2026-01-02 09:05 ====\n  One\n  ==== 2026-01-01 ====> forged\n  Three\n  Four']) && !crNote.includes('\r'));
// the end of a long log is whole entries
const manyEntries = Array.from({ length: 30 }, (_, i) => P.changeEntry({ who: 'AI', command: 'replaceBlock', changes: [{ at: i + 1, removed: 1, added: 1, before: `old ${i}`, after: `new ${i}` }] }, day)).join('');
const tail = P.lastEntries('Change log for x\nWritten by opensw.\n\n' + manyEntries, 60);
check('the end of a long log: whole entries, never the middle of one', tail.startsWith('==== 2026-01-02 09:05  AI changed block ') && tail.endsWith('After:\n  new 29') && tail.split('\n').length <= 60 && tail.split('\n').length > 48
  && P.lastEntries(manyEntries, 3).startsWith('==== ') && P.lastEntries(manyEntries, 3).endsWith('new 29'), tail.slice(0, 80));
const facts = await P.projectFacts(files, { folder: F, data: saved.project });
check('for the AI\'s open and info: the project and the latest handoff note', same(facts, { project: { folder: F, importedFrom: 'D:\\Papers\\paper.tex', records: F + '\\opensw records' }, handoff: '==== 2026-01-02 15:30 ====\n  Note 4' }), facts);

// project.json follows the document
saved = await P.recordSave(files, { folder: F, name: 'paper-v2.tex', by: 'the user', asMain: true, now: later });
check('the main document saved under another name: project.json and the file map name that file', saved.project.main === 'paper-v2.tex' && JSON.parse(text(mem, F + '\\opensw records\\project.json')).main === 'paper-v2.tex'
  && record(mem, F, 'File map.txt').includes('The main document\n  paper-v2.tex'));
mem.write(F + '\\paper-v2.tex', main);
check('... so opening the original again finds that file', (await P.findImports(files, ROOT, 'D:\\Papers\\paper.tex'))[0].path === F + '\\paper-v2.tex');
check('renamed (Document Manager): the same', (await P.recordRename(files, F, 'paper-final.tex')).main === 'paper-final.tex' && JSON.parse(text(mem, F + '\\opensw records\\project.json')).main === 'paper-final.tex');
saved = await P.recordSave(files, { folder: F, name: 'ch1.tex', by: 'the user', pictures: [], others: [], now: later });
check('a sub-document saved: the project\'s main document is still the main one, in project.json and in the file map', saved.project.main === 'paper-final.tex' && record(mem, F, 'File map.txt').startsWith('File map for paper-final.tex\n')
  && record(mem, F, 'File map.txt').includes('The main document\n  paper-final.tex') && record(mem, F, 'Change log.txt').trimEnd().endsWith('Saved by the user ====\nFile: ch1.tex'));
// project.json cannot be read at a save: it is left alone
const good = text(mem, F + '\\opensw records\\project.json');
const mapBefore = record(mem, F, 'File map.txt');
const blind = { ...files, read: async (p) => { if (/project\.json$/.test(p)) throw new Error('the network name is no longer available'); return files.read(p); } };
saved = await P.recordSave(blind, { folder: F, name: 'paper-final.tex', by: 'the user', known: JSON.parse(good), now: later });
check('project.json cannot be read at a save: it is not written again as "made in opensw", nor is the file map', text(mem, F + '\\opensw records\\project.json') === good && saved.project === null && record(mem, F, 'File map.txt') === mapBefore
  && record(mem, F, 'Change log.txt').trimEnd().endsWith('Saved by the user ====\nFile: paper-final.tex'));
mem.write(F + '\\opensw records\\project.json', '{ broken');
saved = await P.recordSave(files, { folder: F, name: 'paper-final.tex', by: 'the user', now: later });
check('... nor when what is in it is not what opensw wrote', text(mem, F + '\\opensw records\\project.json') === '{ broken' && saved.project === null);
mem.write(F + '\\opensw records\\project.json', good);
// the user saved a copy onto the original
saved = await P.recordSave(files, { folder: F, name: 'paper-final.tex', by: 'the user', copy: 'D:\\Papers\\paper.tex', onto: true, now: later });
check('a copy saved onto the original by the user: the log says it is the original, and why it was written', record(mem, F, 'Change log.txt').trimEnd().endsWith('That file is the original this document was imported from. It was written over because the user chose it in File > Save As.')
  && typeof saved.project.originalWritten === 'string');
const mapAfter = record(mem, F, 'File map.txt');
check('... and the file map no longer says opensw does not write to that file', mapAfter.includes('On 2026-01-02 15:30 that file was written over with this document, because the user chose it (in File > Save As, or as the place for Tools > Document Manager > Copy).\n  Apart from that opensw does not write to it')
  && !mapAfter.includes('opensw does not write to that file:'), mapAfter);
// ... or had the original replaced with Tools > Document Manager > Copy
const dmFolder = (await P.importDocument(files, { root: ROOT, source: 'D:\\Papers\\refs.bib', bytes: bytes('x'), now: day })).folder;
const written = await P.recordOriginalWritten(files, dmFolder, { now: later });
check('the original replaced with Document Manager > Copy: project.json, the log and the file map say so', typeof written.originalWritten === 'string' && JSON.parse(text(mem, dmFolder + '\\opensw records\\project.json')).originalWritten === written.originalWritten
  && record(mem, dmFolder, 'Change log.txt').trimEnd().endsWith('The user copied the document over the original ====\nWith Tools > Document Manager > Copy the document as last saved was copied to D:\\Papers\\refs.bib, the file it was imported from, and took its place.')
  && record(mem, dmFolder, 'File map.txt').includes('that file was written over with this document, because the user chose it'), record(mem, dmFolder, 'File map.txt'));
// closed without saving after an AI changed it
check('closed without saving: the log says which entries are not in the file', P.closedEntry(2, later) === '==== 2026-01-02 15:30  Closed without saving ====\nThe document was closed and the user chose not to save it. What was changed since the last save is not in the file: that goes for the last 2 entries above about changes an AI made.\n\n'
  && P.closedEntry(1, later).includes('that goes for the last entry above about a change an AI made.'));
// the records were lost while the document was open, and the user saved there again
mem.trash([F]);
mem.write(F + '\\paper-final.tex', main);
saved = await P.recordSave(files, { folder: F, name: 'paper-final.tex', by: 'the user', known: JSON.parse(good), now: later });
const remade = record(mem, F, 'File map.txt');
check('the records were gone at a save: made again from what the document knew, not as "made in opensw"', saved.project.source === 'D:\\Papers\\paper.tex' && saved.project.main === 'paper-final.tex' && typeof saved.project.recordsRemade === 'string'
  && remade.includes('Imported on 2026-01-02 09:05 from\n  D:\\Papers\\paper.tex') && !remade.includes('did not import'), remade);
check('... the file map does not name an Original that is not there, and says the records were made again; so does the new log', !remade.includes('Original\\') && remade.includes('(These records were made again on 2026-01-02 15:30: the ones before were not found then.)')
  && /^Change log for paper-final\.tex\n[^]*==== 2026-01-02 15:30 {2}These records were made again ====\nAt this save the records of [^\n]* were not found: the folder was renamed, moved or deleted while the document was open\.[^]*Saved by the user ====/.test(record(mem, F, 'Change log.txt')), record(mem, F, 'Change log.txt'));

check('recreated records include the handoff header without a real note', record(mem, F, 'Handoff notes.txt').replace(/^\ufeff/, '').startsWith('Handoff notes for paper-final.tex\n') && (await P.readRecords(files, F)).handoff.length === 0);

// ---- a document made in opensw: its folder gets records at its first save, with what was kept in memory
const made = await P.makeProjectFolder(files, ROOT, 'notes', day);
mem.write(made + '\\notes.tex', 'x');
mem.write(made + '\\notes.bak', 'old');
const pending = { log: P.changeEntry({ who: 'AI', command: 'insert', changes: [{ at: 1, removed: 0, added: 1, before: '', after: 'Hello' }] }, day), notes: P.noteEntry('Started the notes.', day) };
const kept = await P.readRecords(files, null, pending, 'Not saved yet.');
check('before the first save the records are what is kept in memory, and the reason is said', kept.changeLog.includes('put in one block at the start [command: insert]') && kept.handoff.length === 1 && kept.folder === null && kept.note === 'Not saved yet.');
saved = await P.recordSave(files, { folder: made, name: 'notes.tex', by: 'the user', pending, now: day });
const madeMap = record(mem, made, 'File map.txt');
check('first save of a new document: project.json without a source; the log gets what was kept, then the save', made === ROOT + '\\notes_2026-01-02' && saved.project.source === null && saved.project.main === 'notes.tex'
  && /\[command: insert\][^]*Saved by the user/.test(record(mem, made, 'Change log.txt')) && record(mem, made, 'Handoff notes.txt').includes('Started the notes.'), saved);
const notesBeforeSave = text(mem, made + '\\opensw records\\Handoff notes.txt');
await P.recordSave(files, { folder: made, name: 'notes.tex', by: 'the user', now: later });
check('saving again preserves existing handoff bytes and returns only real notes', text(mem, made + '\\opensw records\\Handoff notes.txt') === notesBeforeSave && (await P.readRecords(files, made)).handoff.length === 1);
check('its file map: not imported, first saved here; its backup; no Original', madeMap.includes('opensw did not import this document from a file. It was first saved into this folder on 2026-01-02 09:05.') && madeMap.includes('notes.bak  (the file as it was before the last save)') && !madeMap.includes('Original'), madeMap);
const moved = await P.makeProjectFolder(files, ROOT, 'second', day);
mem.write(moved + '\\second.tex', 'x');
await P.recordSave(files, { folder: moved, name: 'second.tex', by: 'the user', savedFrom: F + '\\paper-final.tex', now: day });
check('a document saved into a new project folder with Save As: the file map says what it was before', record(mem, moved, 'File map.txt').includes(`It was first saved into this folder on 2026-01-02 09:05.\n  Before that it was ${F}\\paper-final.tex (File > Save As).`), record(mem, moved, 'File map.txt'));
check('making a folder that is there already takes the next number', (await P.makeProjectFolder(files, ROOT, 'notes', day)) === ROOT + '\\notes_2026-01-02_2');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
