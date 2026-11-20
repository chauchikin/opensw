// A LaTeX file that Scientific Word 5.x did not write is never written over: saving makes a new
// 5.x file somewhere else and says the file that was opened is unchanged (File > Save and the AI's
// save alike). info.from55 tells the two kinds apart. A group that starts with several switches
// ({\LARGE\bfseries Title}) keeps them inside it. With a stand-in for the desktop shell.
// node test/latexkept.mjs  (needs `npx vite preview --port 4173`)
import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
const page = await b.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(e.message));
const own = ['\\documentclass{article}', '\\usepackage{fontspec}', '\\setmainfont{Some Font}', '\\begin{document}', '\\begin{center}', '{\\LARGE\\bfseries A Title}\\\\[4pt]', '{\\large second line}\\\\', 'third line', '\\end{center}', 'Hello $x^{2}$.', '\\end{document}', ''].join('\n');
await page.addInitScript((text) => {
  const files = new Map([['C:\\Work\\own.tex', Array.from(new TextEncoder().encode(text))]]);
  window.shell = { files, pick: null, asked: [] };
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 0,
    invoke: async (cmd, args) => {
      if (cmd === 'read_file') { if (files.has(args.path)) return files.get(args.path); throw new Error('no such file'); }
      if (cmd === 'write_file') { files.set(args.path, args.data); return null; }
      if (cmd === 'file_exists') return files.has(args.path);
      if (cmd === 'plugin:dialog|save') { window.shell.asked.push(args.options?.defaultPath); return window.shell.pick; }
      return null;
    },
  };
  localStorage.setItem('opensw-settings', JSON.stringify({ aiFolders: ['C:\\Work'] }));
}, own);
await page.goto(`http://localhost:${process.env.OPENSW_PORT || 4173}/?lang=en`); await page.waitForTimeout(800);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : JSON.stringify(detail ?? '').slice(0, 400)); };
const call = (cmd, args) => page.evaluate(([c, a]) => window.sw.call(c, a), [cmd, args]);
const fileText = (path) => page.evaluate((p) => { const d = window.shell.files.get(p); return d ? new TextDecoder().decode(Uint8Array.from(d)) : null; }, path);
const toast = () => page.textContent('#toast');

let r = await call('open', { path: 'C:\\Work\\own.tex' });
check('a LaTeX file 5.x did not write: from55 is false', r.ok && r.result.from55 === false, r);
const tex = (await call('get')).result;
check('{\\LARGE\\bfseries Title}: bold stays in the title\'s group', /\{\\LARGE \\textbf\{A Title\}\}\\\\/.test(tex) && !/\\bfseries/.test(tex), tex.slice(tex.indexOf('\\begin{document}'), tex.indexOf('\\begin{document}') + 200));

r = await call('save');
check('AI save without a path is refused', !r.ok && /give a new path/.test(r.error), r);
r = await call('save', { path: 'c:/work/OWN.tex' });
check('AI save onto the same file (other letter case and slashes) is refused', !r.ok && /give a new path/.test(r.error), r);
check('... and the file is as it was', (await fileText('C:\\Work\\own.tex')) === own);

// File > Save: asks where; the same file is refused, another name is saved as 5.x
await page.evaluate(() => { window.shell.pick = 'C:\\Work\\own.tex'; });
await page.click('#btn-save'); await page.waitForTimeout(400);
check('Save asks where, with another name ready', (await page.evaluate(() => window.shell.asked.at(-1))) === 'own_5x.tex', await page.evaluate(() => window.shell.asked));
check('choosing the opened file is refused, with the reason', /Choose another name: own\.tex is the LaTeX file you opened/.test(await toast()) && (await fileText('C:\\Work\\own.tex')) === own, await toast());
await page.evaluate(() => { window.shell.pick = 'C:\\Work\\own_5x.tex'; });
await page.click('#btn-save'); await page.waitForTimeout(600);
const saved = await fileText('C:\\Work\\own_5x.tex');
check('another name: saved as a 5.x file, the message says the LaTeX file is unchanged', /Saved as a Scientific Word 5\.x file: C:\\Work\\own_5x\.tex\. The LaTeX file you opened \(own\.tex\) is unchanged\./.test(await toast()) && /\\input\{tcilatex\}/.test(saved || ''), [await toast(), (saved || '').slice(0, 200)]);
check('the opened file is still as it was', (await fileText('C:\\Work\\own.tex')) === own);
r = await call('info');
check('the open document is the new 5.x file now: from55 is true', r.result.path === 'C:\\Work\\own_5x.tex' && r.result.from55 === true, r);

// the AI's save to a new path says what happened
await call('open', { path: 'C:\\Work\\own.tex' });
r = await call('save', { path: 'C:\\Work\\copy.tex' });
check('AI save to a new path: the note says the opened file is unchanged', r.ok && r.result.path === 'C:\\Work\\copy.tex' && /own\.tex\) is unchanged/.test(r.result.note) && (await fileText('C:\\Work\\own.tex')) === own, r);
r = await call('save');
check('... and saving again (a 5.x file now) needs no path and gives no note', r.ok && r.result.path === 'C:\\Work\\copy.tex' && !r.result.note, r);

// typesetting an unchanged LaTeX file that chooses its Chinese font: the usual Chinese font is
// only what a font this computer lacks falls back to, not set again after the file's own
const zh = (font) => ['\\documentclass{article}', '\\usepackage{xeCJK}', font, '\\begin{document}', '\u4e2d\u6587', '\\end{document}', ''].join('\n');
const preambleFor = async (text) => {
  await page.evaluate((t) => window.shell.files.set('C:\\Work\\zh.tex', Array.from(new TextEncoder().encode(t))), text);
  await call('open', { path: 'C:\\Work\\zh.tex' });
  const tex = await page.evaluate(() => window.swTypesetTexForTests());
  return tex.slice(0, tex.indexOf('\\begin{document}'));
};
let pre = await preambleFor(zh('\\setCJKmainfont{DFKai-SB}'));
check('a file\'s own \\setCJKmainfont is the last one set', pre.split('\\usepackage{xeCJK}').length === 2 && pre.includes('\\IfFontExistsTF{DFKai-SB}{\\setCJKmainfont{DFKai-SB}}{\\typeout{opensw-no-font: DFKai-SB}\\ifdefined\\IfFontExistsTF\n\\IfFontExistsTF{Noto Serif CJK TC}'), pre);
pre = await preambleFor(zh(''));
check('a file that names no Chinese font gets the usual one', /\\usepackage\{xeCJK\}\n\\ifdefined\\IfFontExistsTF\n\\IfFontExistsTF\{Noto Serif CJK TC\}/.test(pre) && !pre.includes('opensw-no-font'), pre);

check('no page errors', errs.length === 0, errs);
await b.close();
process.exit(fails ? 1 : 0);
