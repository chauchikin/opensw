// Writes THIRD-PARTY-NOTICES.txt: the licence texts of everything opensw ships that other people wrote.
// Run after `npm ci` (needs cargo and internet for the standard licence texts):
//   node scripts/licenses.mjs
// What goes in: the JavaScript packages bundled into the program, the Rust crates compiled into
// opensw.exe (Windows), the Python engine (Pyodide, CPython, SymPy, mpmath), Tectonic and the KaTeX fonts.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import JSZip from 'jszip';

const SPDX = 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/';
const spdxText = async (id) => {
  const r = await fetch(SPDX + id + '.txt');
  if (!r.ok) throw new Error(`no SPDX text for ${id}`);
  return (await r.text()).trim();
};
const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)/i;
// When a package may be used under MIT or another licence, opensw takes MIT: only the MIT file is kept.
const readLicenseFiles = (dir, expr = '') => {
  let files = fs.readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
  const mit = files.filter((f) => /mit/i.test(f));
  if (/\bOR\b|\//.test(expr) && /\bMIT\b/.test(expr) && mit.length) files = mit;
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim());
};
// "MIT OR Apache-2.0" with no file: the first licence named, MIT when it is one of the choices.
const pickId = (expr) => {
  const ids = expr.replace(/[()]/g, ' ').split(/\s+OR\s+|\//).map((s) => s.trim().split(/\s+AND\s+/)[0]);
  return ids.includes('MIT') ? 'MIT' : ids[0];
};

const sections = []; // { title, entries: [{ name, version, license, url, texts: [] }] }

// 1. JavaScript packages that end up in the program (production dependencies only)
{
  const dirs = execSync('npm ls --omit=dev --all --parseable', { encoding: 'utf8' })
    .trim().split('\n').slice(1); // the first line is opensw itself
  const entries = [];
  for (const dir of [...new Set(dirs)]) {
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (pj.name.startsWith('@types/') || pj.name === 'undici-types') continue; // type definitions, not shipped
    if (pj.name === 'pyodide') continue; // listed with the computation engine below
    const license = typeof pj.license === 'string' ? pj.license : pj.license?.type || '?';
    let texts = readLicenseFiles(dir, license);
    if (!texts.length) texts = [await spdxText(pickId(license))];
    const url = typeof pj.repository === 'string' ? pj.repository : pj.repository?.url || pj.homepage || '';
    entries.push({ name: pj.name, version: pj.version, license, url, texts });
  }
  sections.push({ title: 'JavaScript packages (bundled into the program)', entries });
}

// 2. Rust crates compiled into opensw.exe for Windows (normal and build dependencies)
{
  const meta = JSON.parse(execSync('cargo metadata --format-version 1 --filter-platform x86_64-pc-windows-msvc',
    { cwd: 'src-tauri', encoding: 'utf8', maxBuffer: 1 << 28 }));
  const pkgs = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const todo = [meta.resolve.root];
  while (todo.length) {
    const id = todo.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of nodes.get(id).deps) {
      if (d.dep_kinds.some((k) => k.kind === null || k.kind === 'build')) todo.push(d.pkg);
    }
  }
  seen.delete(meta.resolve.root);
  const entries = [];
  for (const id of seen) {
    const p = pkgs.get(id);
    let texts = readLicenseFiles(path.dirname(p.manifest_path), p.license || '');
    if (!texts.length) texts = [await spdxText(pickId(p.license || 'MIT'))];
    entries.push({ name: p.name, version: p.version, license: p.license, url: p.repository || '', texts });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  sections.push({ title: 'Rust crates (compiled into opensw.exe)', entries });
}

// 3. The computation engine: Pyodide (Python in WebAssembly, with CPython inside), SymPy, mpmath
{
  const pyo = JSON.parse(fs.readFileSync('node_modules/pyodide/package.json', 'utf8'));
  const entries = [
    { name: 'Pyodide', version: pyo.version, license: 'MPL-2.0', url: 'https://github.com/pyodide/pyodide',
      texts: ['Source code: https://github.com/pyodide/pyodide (opensw ships it unchanged).\n\n' + await spdxText('MPL-2.0')] },
    { name: 'CPython (inside Pyodide)', version: '', license: 'Python-2.0', url: 'https://github.com/python/cpython',
      texts: [await spdxText('Python-2.0')] },
  ];
  for (const w of fs.readdirSync('engine/wheels').filter((f) => f.endsWith('.whl')).sort()) {
    const [name, version] = w.split('-');
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join('engine/wheels', w)));
    const files = Object.keys(zip.files).filter((f) => /\.dist-info\/(licenses\/)?LICENSE/i.test(f));
    const texts = await Promise.all(files.map(async (f) => (await zip.file(f).async('string')).trim()));
    entries.push({ name, version, license: 'BSD-3-Clause', url: `https://pypi.org/project/${name}/`, texts });
  }
  sections.push({ title: 'Computation engine (Python)', entries });
}

// 4. Tectonic (the TeX engine in the Windows build) and the KaTeX fonts used by MathLive
{
  const r = await fetch('https://raw.githubusercontent.com/tectonic-typesetting/tectonic/master/LICENSE');
  const tectonic = (await r.text()).trim();
  sections.push({ title: 'Other programs and fonts', entries: [
    { name: 'Tectonic', version: '', license: 'MIT', url: 'https://github.com/tectonic-typesetting/tectonic', texts: [tectonic] },
    { name: 'KaTeX fonts (shipped with MathLive)', version: '', license: 'OFL-1.1', url: 'https://github.com/KaTeX/katex-fonts',
      texts: ['Copyright (c) 2009-2010, Design Science, Inc. (<www.mathjax.org>)\n'
        + 'Copyright (c) 2014-2018 Khan Academy (<www.khanacademy.org>),\n'
        + 'with Reserved Font Name KaTeX_AMS, KaTeX_Caligraphic, KaTeX_Fraktur, KaTeX_Main, KaTeX_Math,\n'
        + 'KaTeX_SansSerif, KaTeX_Script, KaTeX_Size1-4, KaTeX_Typewriter.\n\n' + await spdxText('OFL-1.1')] },
  ] });
}

// Write: each section lists its packages; packages with the very same licence text share one copy.
const line = '='.repeat(78);
let out = `opensw — third-party software notices

opensw is MIT licensed (see LICENSE). It ships software written by other people,
each under its own licence. Those licences are reproduced below.
opensw 用了別人寫的開源軟體，以下是它們的授權全文。

The TeX files Tectonic uses come from TeX Live; each file keeps the licence written in it
(mostly the LaTeX Project Public License and the SIL Open Font License).
The Scientific Word 5.x macro files in tex55/ are listed in tex55/README.md.

Generated by scripts/licenses.mjs.
`;
for (const s of sections) {
  out += `\n\n${line}\n${s.title}\n${line}\n`;
  const groups = new Map();
  for (const e of s.entries) {
    const key = e.texts.join('\n\n---\n\n');
    const same = [...groups.keys()].find((k) => k.replace(/\s+/g, ' ') === key.replace(/\s+/g, ' '));
    if (same) { groups.get(same).push(e); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const [text, es] of groups) {
    out += '\n' + '-'.repeat(78) + '\n';
    for (const e of es) out += `${e.name}${e.version ? ' ' + e.version : ''} (${e.license})${e.url ? ' ' + e.url : ''}\n`;
    out += '\n' + text + '\n';
  }
}
fs.writeFileSync('THIRD-PARTY-NOTICES.txt', out);
const n = sections.reduce((a, s) => a + s.entries.length, 0);
console.log(`THIRD-PARTY-NOTICES.txt: ${n} components, ${(out.length / 1024).toFixed(0)} KB`);
