// The FriCAS that comes with the Windows desktop app: the FriCAS team's own Windows build,
// without the parts opensw has no use for. engine/opensw_fricas.py asks it for the indefinite
// integrals Giac does not find; .github/workflows/windows.yml puts the folder into the installer and
// the portable zip as engine/fricas.
//   node scripts/bundle-fricas.mjs [folder]     (after `npm ci`; folder: src-tauri/fricas)
// What is downloaded (the release on github.com/fricas/fricas) is checked against the SHA-256
// written here and kept in <folder>-dl, so a second run downloads nothing. On Windows the
// result is also tried: it is started as opensw_fricas.py starts it and asked one integral.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import JSZip from 'jszip';

const FRICAS = {
  url: 'https://github.com/fricas/fricas/releases/download/1.4.0/fricas-1.4.0-windows-x86-64.zip',
  sha256: 'bbac0555aed7aa58f0f5f3471f9fcdd52e7cebb8d47464d0bf486c78e9ac8c4b',
};
// Left out (the zip's one folder, FRICAS-windows-x86-64, holds bin, algebra, lib, share, src):
// - lib/libspad.so, lib/gmp_wrap.so, lib/libgmp-10.dll: the native libraries. FriCAS (SBCL)
//   cannot load them from a folder with other than ASCII letters in its name (a user name in
//   Chinese) and stops there; without them it starts everywhere and computes the same, with
//   SBCL's own big numbers in place of GMP's. libspad is for HyperDoc and the graphics.
// - src (the algebra's source text), share (help pages, HyperDoc), lib/SPADEDIT, lib/summary,
//   algebra/USERS.DAASE and DEPENDENTS.DAASE (for )show and the browser): not read when computing.
// Kept: bin/FRICASsys.exe, algebra/*.fasl and *.daase (browse.daase too: FriCAS does not start
// without it), lib/copyright and lib/credits.
const LEFT_OUT = /^(src\/|share\/|lib\/(libspad\.so|gmp_wrap\.so|libgmp-10\.dll|SPADEDIT|summary)$|algebra\/(USERS|DEPENDENTS)\.DAASE\/)/;

const out = path.resolve(process.argv[2] || 'src-tauri/fricas');
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

fs.rmSync(out, { recursive: true, force: true });
const file = await download(FRICAS);
const zip = await JSZip.loadAsync(fs.readFileSync(file));
for (const f of Object.values(zip.files)) {
  const name = f.name.replace(/^[^/]+\//, ''); // without the zip's one top folder
  if (f.dir || !name || LEFT_OUT.test(name)) continue;
  const target = path.join(out, name);
  if (!target.startsWith(out + path.sep)) throw new Error(`${file}: ${f.name} is outside the folder`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, await f.async('nodebuffer'));
}
if (!fs.existsSync(path.join(out, 'bin', 'FRICASsys.exe'))) throw new Error(`${file}: no bin/FRICASsys.exe in it`);

if (process.platform === 'win32') {
  // "\n" ends a line (FriCAS takes "\r" as part of it); TERPRI ends the line of the first
  // prompt, written before the settings are read; the answer is the line that starts with "@@a "
  const input = [')set messages prompt none', ')set output algebra off', ')set history off', ')set quit unprotected', 'TERPRI()$Lisp',
    'PRINC(concat(["@", "@a ", unparse(integrate(sqrt(tan(x)), x)::InputForm)]))$Lisp; TERPRI()$Lisp', ')quit', ''].join('\n');
  const r = spawnSync(path.join(out, 'bin', 'FRICASsys.exe'), [], { input, cwd: out, env: { ...process.env, FRICAS: out }, encoding: 'utf8', timeout: 120000, windowsHide: true });
  const answer = (r.stdout || '').split(/\r?\n/).find((line) => line.startsWith('@@a '));
  if (r.status !== 0 || !answer || !answer.includes('atan(')) throw new Error(`FriCAS did not answer: ${r.error || (r.stdout || '').slice(-600)}`);
  console.log(`${(r.stdout.match(/Version: (FriCAS [^\r\n]*)/) || [])[1]}: integrate(sqrt(tan(x)), x) = ${answer.slice(4, 84)}...`);
} else {
  console.log('not on Windows: the result is not tried');
}
const files = fs.readdirSync(out, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
const bytes = files.reduce((n, f) => n + fs.statSync(path.join(f.parentPath, f.name)).size, 0);
console.log(`${out}: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
