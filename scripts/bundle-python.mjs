// The Python that comes with the Windows desktop app: the official embeddable Python with
// SymPy and mpmath (engine/wheels), giacpy (Giac) and python-flint (FLINT) unpacked into it. The app runs
// engine/opensw_stdio.py with it (engine/engines.json, "python"); .github/workflows/windows.yml
// puts the folder into the installer and the portable zip as engine/python.
//   node scripts/bundle-python.mjs [folder]     (after `npm ci`; folder: src-tauri/python)
// What is downloaded (python.org, PyPI) is checked against the SHA-256 written here and kept
// in <folder>-dl, so a second run downloads nothing. On Windows the result is also tried:
// the modules are compiled and imported with it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';

const PYTHON = {
  url: 'https://www.python.org/ftp/python/3.13.17/python-3.13.17-embed-amd64.zip',
  sha256: '9e35319bffedab8b36ad44d8f377cb4f1733bcec257a0b6d04d94f01486ddb38',
};
const GIACPY = {
  url: 'https://files.pythonhosted.org/packages/ed/5a/e1b4a04ead7ce1e91fc699737a5ace60cc978e4ded765835a00d970cdcdc/giacpy-0.7.5-cp313-cp313-win_amd64.whl',
  sha256: '0008cd0b8f099c40d1de5ecbd5652403ad6a1e3f096e09e748a1e411d5e3b8b7',
};
// FLINT for SymPy's integers, rationals and polynomials: SymPy uses it by itself when it is
// there and its version is one SymPy knows (sympy/external/gmpy.py: 0.6 to 0.10 for SymPy 1.14),
// and factors large polynomials many times faster. The answers are the same with and without
// it (the browser version, in Pyodide, has none), which is what the 605 cases were run for
// before it was put here; check that again when this version or SymPy's changes.
const FLINT = {
  url: 'https://files.pythonhosted.org/packages/e1/3d/8fa26b07514d7c433d14d338df9df4c57ad6875ef7a01fb578d79be8a449/python_flint-0.9.0-cp313-cp313-win_amd64.whl',
  sha256: '1f3a3672d589e376d47288dcebcb712997dc719880a4dbf1779bf0f2b20d0293',
};
// the wheels kept in the repository (the same ones Pyodide loads)
const WHEELS = ['sympy-1.14.0-py3-none-any.whl', 'mpmath-1.3.0-py3-none-any.whl'].map((w) => path.join('engine', 'wheels', w));

const out = path.resolve(process.argv[2] || 'src-tauri/python');
const kept = out + '-dl';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// the file of a download, from <folder>-dl when it is there and right
async function download({ url, sha256: expected }) {
  const file = path.join(kept, url.split('/').pop());
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === expected) return file;
  console.log(`downloading ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (sha256(bytes) !== expected) throw new Error(`${url}: SHA-256 is ${sha256(bytes)}, expected ${expected}`);
  fs.mkdirSync(kept, { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

// a zip's files into a folder; skip(name): the ones left out
async function unpack(file, to, skip = () => false) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  for (const f of Object.values(zip.files)) {
    if (f.dir || skip(f.name)) continue;
    const target = path.join(to, f.name);
    if (!target.startsWith(to + path.sep)) throw new Error(`${file}: ${f.name} is outside the folder`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await f.async('nodebuffer'));
  }
}

fs.rmSync(out, { recursive: true, force: true });
await unpack(await download(PYTHON), out);
// A wheel is a zip of the package's folders; an embeddable Python has no pip, so they are
// unpacked as pip would (name.data/ holds a manual page and the like: not needed).
const site = path.join(out, 'Lib', 'site-packages');
for (const wheel of [...WHEELS, await download(GIACPY), await download(FLINT)]) await unpack(wheel, site, (name) => /^[^/]+\.data\//.test(name));
// python313._pth lists where this Python finds modules, and nothing else is looked at (no
// PYTHONPATH, no registry, no user folder): its own library, its folder, and the packages
const pth = fs.readdirSync(out).find((f) => /^python\d+\._pth$/.test(f));
if (!pth) throw new Error('the embeddable Python has no python*._pth');
fs.writeFileSync(path.join(out, pth), `${pth.replace('._pth', '.zip')}\r\n.\r\nLib\\site-packages\r\n`);

if (process.platform === 'win32') {
  const python = (...args) => {
    const r = spawnSync(path.join(out, 'python.exe'), args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`python ${args.join(' ')} failed: ${r.error || r.stderr || r.stdout}`);
    return r.stdout.trim();
  };
  // compiled now, since the app's folder may not be writable (Program Files) and compiling
  // SymPy on every start takes seconds; unchecked-hash: valid whatever dates the files get
  python('-m', 'compileall', '-q', '--invalidation-mode', 'unchecked-hash', site);
  console.log(python('-c', 'import sys, sympy, mpmath, giacpy; print("Python", sys.version.split()[0], "SymPy", sympy.__version__, "mpmath", mpmath.__version__, "Giac int(x^2,x) =", giacpy.giac("int(x^2,x)"))'));
  // SymPy must have taken FLINT (it takes Python's own numbers without a word when it cannot)
  const ground = python('-c', 'import flint; from sympy.external.gmpy import GROUND_TYPES; print(GROUND_TYPES, flint.__version__)');
  if (!ground.startsWith('flint ')) throw new Error(`SymPy's ground types are "${ground}", not flint`);
  console.log('SymPy ground types:', ground);
} else {
  console.log('not on Windows: the modules are not compiled and the result is not tried');
}
const files = fs.readdirSync(out, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
const bytes = files.reduce((n, f) => n + fs.statSync(path.join(f.parentPath, f.name)).size, 0);
console.log(`${out}: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
