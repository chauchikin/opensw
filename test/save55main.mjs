// 5.x .tex is the main format (desktop app, with the stand-in for its shell, test/lib/desktop.mjs;
// the document is in a project folder, so it is opened and saved as it is):
// an opened .tex is saved back to itself (old file kept as .bak), an unchanged one is
// not written at all and is typeset from its own text; once edited, the editor's text
// is the file's own with only the edited part written again; a .sci path still gives a .sci.  node test/save55main.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { standIn, ROOT, inProject } from './lib/desktop.mjs';
const original = fs.readFileSync('test/fixtures/real55.tex');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const DIR = ROOT + '\\Teacher';
await standIn(page, { files: { [DIR + '\\Ch1.tex']: original, ...inProject(DIR, 'Ch1.tex') } });
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=zh-TW`); await page.waitForTimeout(800);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail ?? '').slice(0, 300)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
// the files written (the project's records, which opensw keeps beside the document, apart) and the TeX typeset
const shell = () => page.evaluate(() => ({ writes: window.shell.writes.filter((p) => !p.includes('\\opensw records\\')), typeset: window.shell.typeset }));
const bytesOf = async (path) => Buffer.from(await page.evaluate((p) => window.shell.files.get(p) || [], path));

let r = await call('open', { path: DIR + '\\Ch1.tex' });
check('opens the .tex', r.ok, r);
await page.waitForTimeout(1500);
r = await call('save');
let s = await shell();
check('unchanged: saving leaves the file alone', r.ok && s.writes.length === 0, { r, s: s.writes });

r = await call('typeset');
s = await shell();
const t1 = s.typeset.at(-1) || '';
const origText = original.toString('latin1').replace(/\r\n?/g, '\n');
const origBody = origText.slice(origText.indexOf('\\begin{document}'));
check('unchanged: typeset from its own text', r.ok && t1.endsWith(origBody) && t1.includes('%TCIDATA{Codepage=950}'), t1.slice(-300));
check('…with this TeX\'s paper size added', /\\pdfpagewidth=\\paperwidth/.test(t1));

r = await call('setFormula', { n: 0, latex: 'x^{3}+4x^{2}-11=0' });
r = await call('typeset');
s = await shell();
const t2 = s.typeset.at(-1) || '';
// only the edited paragraph is written again: every other line is the file's own
const changedLines = (x, y) => { const keep = new Set(y.split('\n')); return x.split('\n').filter((l) => !keep.has(l)); };
check('edited: typeset from the file\'s text, only the edited part written again', t2.includes('x^{3}+4x^{2}-11=0') && t2.includes('%TCIDATA{Version')
  && changedLines(t1, t2).every((l) => l.includes('10=0')) && changedLines(t2, t1).every((l) => l.includes('11=0')), [changedLines(t1, t2), changedLines(t2, t1)]);

r = await call('save');
s = await shell();
const paths = s.writes;
check('edited: old file kept as .bak, then the .tex written back', r.ok && r.result.path === DIR + '\\Ch1.tex' && paths[0] === DIR + '\\Ch1.bak' && paths[1] === DIR + '\\Ch1.tex' && paths.length === 2, paths);
const saved = (await bytesOf(DIR + '\\Ch1.tex')).toString('latin1');
check('the file written is a 5.x .tex with the change', saved.includes('x^{3}+4x^{2}-11=0') && saved.includes('%TCIDATA{OutputFilter=LATEX.DLL}'), saved.slice(0, 200));
const savedLines = saved.split('\n');
const origLines = original.toString('latin1').split('\n');
check('…and every other line is as it was, byte for byte', changedLines(origLines.join('\n'), savedLines.join('\n')).every((l) => l.includes('10=0'))
  && savedLines.length === origLines.length && saved.includes('\r') === original.includes(13), [savedLines.length, origLines.length, changedLines(origLines.join('\n'), savedLines.join('\n'))]);
check('the .bak is the old file', (await bytesOf(DIR + '\\Ch1.bak')).equals(original));

r = await call('save');
s = await shell();
check('saved again without changes: nothing written', s.writes.length === 2, s.writes);
r = await call('typeset');
s = await shell();
check('after saving: typeset from the saved text', (s.typeset.at(-1) || '').includes('x^{3}+4x^{2}-11=0') && s.typeset.at(-1).includes('%TCIDATA{Version'), (s.typeset.at(-1) || '').slice(0, 200));

r = await call('save', { path: DIR + '\\copy.sci' });
s = await shell();
const sci = await bytesOf(DIR + '\\copy.sci');
check('a .sci path still gives a .sci (a zip)', r.ok && s.writes.at(-1) === DIR + '\\copy.sci' && sci[0] === 0x50 && sci[1] === 0x4b, r);

check('no page errors', !errs.length, errs);
await b.close();
process.exit(fails ? 1 : 0);
