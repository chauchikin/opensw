// Writes THIRD-PARTY-NOTICES.txt: the licence texts of everything opensw ships that other people wrote.
// Run after `npm ci` (needs cargo and internet for the standard licence texts):
//   node scripts/licenses.mjs
// What goes in: the JavaScript packages bundled into the program, the Rust crates compiled into
// opensw.exe (Windows), the Python engine (Pyodide, CPython, SymPy, mpmath; in the Windows desktop app
// also the Python of scripts/bundle-python.mjs with giacpy, Giac and the libraries in giacpy's wheel, and
// python-flint with FLINT and the libraries in its wheel),
// Tectonic and the KaTeX fonts.
// FriCAS, with the SBCL inside it (the Windows desktop app, scripts/bundle-fricas.mjs), is listed too.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import JSZip from 'jszip';

const SPDX = 'https://raw.githubusercontent.com/spdx/license-list-data/main/text/';
const spdxText = async (id) => {
  const r = await fetch(SPDX + id + '.txt');
  if (!r.ok) throw new Error(`no SPDX text for ${id}`);
  return (await r.text()).trim();
};
// a text file from where its project keeps it
const raw = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
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
  // The Windows desktop app's own Python (scripts/bundle-python.mjs: engine/python in the installer and
  // the portable zip): CPython from python.org, the wheels above, giacpy with Giac, and python-flint.
  const bundle = fs.readFileSync('scripts/bundle-python.mjs', 'utf8');
  const python = bundle.match(/python-([\d.]+)-embed-amd64\.zip/)[1];
  const giacpy = bundle.match(/giacpy-([\d.]+)-cp/)[1];
  const GH = 'https://raw.githubusercontent.com/';
  // a text with the line ends of this file (git diff --check): no CR, no blanks at the end of a line, no space before a tab that indents
  const tidy = (text) => text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/^ +(?=\t)/gm, '').trim();
  // a licence's text, or a project's own notice, under a line that says which it is
  const licence = async (id) => `Licence text: ${id}\n\n${tidy(await spdxText(id))}`;
  const notice = async (what, url) => `Notice of ${what}\n\n${tidy(await raw(url))}`;
  // a library in two lines: name and version, licence and files; who holds the copyright and where it comes from
  const list = (libs) => libs.map(([lib, license, files, copyright, url]) => `${lib} (${license}): ${files}\n    ${copyright} (${url})`).join('\n');
  const FSF = 'Copyright Free Software Foundation, Inc.';

  // LICENSE.txt of that Python (the conditions for the Microsoft runtime and the notices of bzip2, libffi
  // and OpenSSL are in it), out of the zip bundle-python.mjs downloads: the copy that script keeps in
  // src-tauri/python-dl when there is one, else downloaded here.
  const [, pyUrl, pySha] = bundle.match(/url: '(\S+-embed-amd64\.zip)',\s*sha256: '(\w+)'/);
  const pyKept = path.join('src-tauri', 'python-dl', pyUrl.split('/').pop());
  const pyZip = fs.existsSync(pyKept) ? fs.readFileSync(pyKept) : Buffer.from(await (await fetch(pyUrl)).arrayBuffer());
  if (crypto.createHash('sha256').update(pyZip).digest('hex') !== pySha) throw new Error(`${pyUrl}: not the SHA-256 written in bundle-python.mjs`);
  const pyLicense = tidy(await (await JSZip.loadAsync(pyZip)).file('LICENSE.txt').async('string'));
  // What else is in that zip, told from the files' version information and the text in them
  // (python-3.13.17-embed-amd64.zip; look again when the version changes). No Tcl/Tk in it.
  const pyLibs = [
    ['OpenSSL 3.5.9', 'Apache-2.0', 'libcrypto-3.dll, libssl-3.dll', 'Copyright 1998-2026 The OpenSSL Authors', 'https://www.openssl.org/'],
    ['libffi (version not confirmed)', 'MIT', 'libffi-8.dll', 'Copyright (c) 1996-2022 Anthony Green, Red Hat, Inc and others', 'https://github.com/libffi/libffi'],
    ['SQLite 3.50.4', 'public domain', 'sqlite3.dll', 'No copyright: its authors gave it to the public domain', 'https://www.sqlite.org/'],
    ['bzip2 1.0.8', 'bzip2-1.0.6', 'inside _bz2.pyd', 'Copyright (C) 1996-2019 Julian R Seward', 'https://sourceware.org/bzip2/'],
    ['Expat 2.8.5', 'MIT', 'inside pyexpat.pyd', 'Copyright Thai Open Source Software Center Ltd, Clark Cooper and the Expat maintainers', 'https://libexpat.github.io/'],
    ['libmpdec 4.0.0', 'BSD-2-Clause', 'inside _decimal.pyd', 'Copyright Stefan Krah', 'https://www.bytereef.org/mpdecimal/'],
    ['XZ Utils liblzma (version not confirmed)', 'public domain to 5.4, 0BSD from 5.6', 'inside _lzma.pyd', 'Written by Lasse Collin and others', 'https://tukaani.org/xz/'],
    ['zlib 1.3.1', 'Zlib', 'inside python313.dll', 'Copyright Jean-loup Gailly and Mark Adler', 'https://zlib.net/'],
    ['Microsoft Visual C++ runtime 14.51.36247.0', 'Microsoft Distributable Code, not open source', 'vcruntime140.dll, vcruntime140_1.dll',
      '(c) Microsoft Corporation; python.org ships it with Python, under the "Additional Conditions for this Windows binary build" of LICENSE.txt above', 'https://visualstudio.microsoft.com/'],
  ];

  // giacpy's Windows wheel (giacpy-0.7.5-cp313-cp313-win_amd64.whl) carries no notices of the libraries in
  // it (only the GPL-2 text). What each file is was told from its version information, the text in it
  // (version strings, source paths, the compiler's notes) and what it loads; "not confirmed" where
  // those do not say. Look again when giacpy's version changes.
  const giacVersion = '2.0.0-7'; // the version text in giacxcas.dll; giacpy's README says the same for 0.7.4 and later
  const giacSource = `https://www-fourier.univ-grenoble-alpes.fr/~parisse/debian/dists/stable/main/source/giac_${giacVersion}.tar.gz`;
  const giacDlls = [
    ['libao (version not confirmed)', 'GPL-2.0-or-later', 'libao-4.dll', 'Copyright Aaron Holtzman, Stan Seibert, the Xiph.Org Foundation and others', 'https://xiph.org/ao/'],
    ['Reference BLAS and LAPACK 3.9.0', 'BSD-3-Clause', 'libblas.dll, liblapack.dll', 'Copyright as in its notice below', 'https://github.com/Reference-LAPACK/lapack'],
    ['Brotli (version not confirmed)', 'MIT', 'libbrotlicommon.dll, libbrotlidec.dll', 'Copyright as in its notice below', 'https://github.com/google/brotli'],
    ['OpenSSL 1.1.1i', 'OpenSSL', 'libcrypto-1_1-x64.dll, libssl-1_1-x64.dll', 'Copyright 1998-2020 The OpenSSL Authors', 'https://www.openssl.org/'],
    ['curl 7.73.0', 'curl', 'libcurl-4.dll', 'Copyright as in its notice below', 'https://curl.se/'],
    ['dlfcn-win32 (version not confirmed)', 'LGPL-2.1-or-later to 1.2.0, MIT from 1.3.0', 'libdl.dll', 'Copyright Ramiro Polla and others', 'https://github.com/dlfcn-win32/dlfcn-win32'],
    ['FLTK 1.3 (release not confirmed)', 'LGPL-2.0-or-later WITH FLTK-exception',
      'libfltk.dll, libfltk_forms.dll, libfltk_gl.dll, libfltk_images.dll, mgwfltknox-1.3.dll, mgwfltknox_gl-1.3.dll, mgwfltknox_images-1.3.dll',
      'Copyright Bill Spitzak and others', 'https://www.fltk.org/'],
    ['GCC runtime libraries (libgcc and libgfortran 10.2.0; libssp from GCC 11; libstdc++ version not confirmed)', 'GPL-3.0-or-later WITH GCC-exception-3.1',
      'libgcc_s_seh-1.dll, libgfortran-5.dll, libssp-0.dll, libstdc++-6.dll', FSF, 'https://gcc.gnu.org/'],
    ['GCC libquadmath 10.2.0', 'LGPL-2.1-or-later', 'libquadmath-0.dll', FSF, 'https://gcc.gnu.org/'],
    ['GLPK 4.65 (with zlib 1.2.5 inside)', 'GPL-3.0-or-later', 'libglpk-40.dll', 'Copyright Andrew Makhorin, Department for Applied Informatics, Moscow Aviation Institute', 'https://www.gnu.org/software/glpk/'],
    ['GMP 6.2.0', 'LGPL-3.0-or-later OR GPL-2.0-or-later', 'libgmp-10.dll', FSF, 'https://gmplib.org/'],
    ['GSL 2.7.1', 'GPL-3.0-or-later', 'libgsl-27.dll, libgslcblas-0.dll', 'Copyright the GSL Team (M. Galassi and others)', 'https://www.gnu.org/software/gsl/'],
    ['libiconv 1.16', 'LGPL-2.0-or-later', 'libiconv-2.dll', 'Copyright (C) 1999-2019 Free Software Foundation, Inc.', 'https://www.gnu.org/software/libiconv/'],
    ['Libidn2 2.3.0', 'LGPL-3.0-or-later OR GPL-2.0-or-later', 'libidn2-0.dll', 'Copyright (C) 2011-2016 Simon Josefsson and others', 'https://www.gnu.org/software/libidn/#libidn2'],
    ['gettext libintl 0.19.8.1', 'LGPL-2.1-or-later', 'libintl-8.dll', 'Copyright (C) 1995-2010 Free Software Foundation, Inc.', 'https://www.gnu.org/software/gettext/'],
    ['libjpeg-turbo 2.0.5', 'IJG AND BSD-3-Clause AND Zlib', 'libjpeg-8.dll', 'Copyright (C) 1991-2020 The libjpeg-turbo Project and many others', 'https://libjpeg-turbo.org/'],
    ['nghttp2 1.41.0', 'MIT', 'libnghttp2-14.dll', 'Copyright as in its notice below', 'https://nghttp2.org/'],
    ['libpng 1.6.37', 'libpng-2.0', 'libpng16-16.dll', 'Copyright as in its notice below', 'http://www.libpng.org/pub/png/libpng.html'],
    ['libpsl 0.21.1', 'MIT', 'libpsl-5.dll', 'Copyright as in its notice below', 'https://github.com/rockdaboot/libpsl'],
    ['GNU Readline 8.0', 'GPL-3.0-or-later', 'libreadline8.dll', FSF, 'https://tiswww.case.edu/php/chet/readline/rltop.html'],
    ['libsamplerate 0.1.9', 'BSD-2-Clause', 'libsamplerate-0.dll', 'Copyright as in its notice below', 'https://github.com/libsndfile/libsamplerate'],
    ['libssh2 1.9.0', 'BSD-3-Clause', 'libssh2-1.dll', 'Copyright as in its notice below', 'https://libssh2.org/'],
    ['GNU termcap 1.3.1', 'GPL-2.0-or-later', 'libtermcap-0.dll', FSF, 'https://ftp.gnu.org/gnu/termcap/'],
    ['libunistring 0.9.10', 'LGPL-3.0-or-later OR GPL-2.0-or-later', 'libunistring-2.dll', 'Copyright (C) 2001-2011 Free Software Foundation, Inc.', 'https://www.gnu.org/software/libunistring/'],
    ['libusb 1.0.23', 'LGPL-2.1-or-later', 'libusb-1.0.dll', 'Copyright the libusb authors', 'https://libusb.info/'],
    ['mingw-w64 winpthreads (version not confirmed)', 'MIT AND BSD-3-Clause', 'libwinpthread-1.dll', 'Copyright as in its notice below', 'https://www.mingw-w64.org/'],
    ['Zstandard 1.4.5', 'BSD-3-Clause OR GPL-2.0-only', 'libzstd.dll', 'Copyright as in its notice below', 'https://github.com/facebook/zstd'],
    ['MSYS2 runtime 3.1.7 (Cygwin, with newlib)', 'LGPL-3.0-or-later, with Cygwin\'s linking exception and BSD-style parts', 'msys-2.0.dll', 'Copyright Cygwin Authors 1996-2020',
      'https://github.com/msys2/msys2-runtime'],
    ['zlib 1.2.11', 'Zlib', 'zlib1.dll', 'Copyright 1995-2017 Jean-loup Gailly and Mark Adler', 'https://zlib.net/'],
  ];
  // compiled into giacxcas.dll (it loads no DLL of theirs): found by the version texts, source paths and names in it
  const giacInside = [
    ['PARI/GP 2.13.0', 'GPL-2.0-or-later', 'inside giacxcas.dll', 'Copyright The PARI Group', 'https://pari.math.u-bordeaux.fr/'],
    ['MPFR 4.1.0', 'LGPL-3.0-or-later', 'inside giacxcas.dll', FSF, 'https://www.mpfr.org/'],
    ['NTL (version not confirmed)', 'LGPL-2.1-or-later', 'inside giacxcas.dll', 'Copyright Victor Shoup', 'https://libntl.org/'],
    ['MPFI (version not confirmed)', 'GNU LGPL, version not confirmed', 'inside giacxcas.dll', 'Copyright its authors at INRIA', 'https://gitlab.inria.fr/mpfi/mpfi'],
    ['GMP-ECM (version not confirmed)', 'LGPL-3.0-or-later', 'inside giacxcas.dll', 'Copyright Paul Zimmermann, Alexander Kruppa and others', 'https://gitlab.inria.fr/zimmerma/ecm'],
    ['nauty (version not confirmed)', 'Apache-2.0 from nauty 2.6', 'inside giacxcas.dll', 'Copyright Brendan McKay and others', 'https://pallini.di.uniroma1.it/'],
    ['QuickJS 2020-11-08 (with libbf)', 'MIT', 'inside giacxcas.dll', 'Copyright (c) 2017-2020 Fabrice Bellard and Charlie Gordon', 'https://bellard.org/quickjs/'],
    ['MicroPython 1.12', 'MIT', 'inside giacxcas.dll', 'Copyright (c) 2013-2019 Damien P. George', 'https://micropython.org/'],
    ['ulab (version not confirmed)', 'MIT', 'inside giacxcas.dll', 'Copyright as in its notice below', 'https://github.com/v923z/micropython-ulab'],
    ['GL2PS (version not confirmed)', 'LGPL-2.0-or-later OR GL2PS', 'inside giacxcas.dll', '(C) 1999-2009 C. Geuzaine', 'https://www.geuz.org/gl2ps/'],
    ['TinyMT (version not confirmed)', 'BSD-3-Clause', 'inside giacxcas.dll', 'Copyright as in its notice below', 'https://github.com/MersenneTwister-Lab/TinyMT'],
    ['QR Code generator (version not confirmed)', 'MIT', 'inside giacxcas.dll', 'Copyright (c) Project Nayuki', 'https://github.com/nayuki/QR-Code-generator'],
  ];
  entries.push(
    { name: 'CPython (the Windows desktop app\'s Python, from python.org; this LICENSE.txt is also in engine/python)',
      version: python, license: 'Python-2.0', url: 'https://www.python.org/',
      texts: [pyLicense, await notice(`what CPython includes (Doc/license.rst of CPython ${python})`, `${GH}python/cpython/v${python}/Doc/license.rst`)] },
    { name: 'Libraries inside that Python (Windows desktop app)', version: python, license: 'various', url: '',
      texts: ['The DLLs of python.org\'s embeddable Python and the libraries compiled into its modules, the licence of each,\n'
        + 'who holds the copyright and where it comes from. opensw ships the files unchanged, in engine/python.\n'
        + 'Their notices are in the two texts of CPython above (SQLite and liblzma have none).\n\n' + list(pyLibs)] },
    { name: 'giacpy (Windows desktop app)', version: giacpy, license: 'GPL-2.0-or-later', url: 'https://pypi.org/project/giacpy/',
      texts: [`Copyright 2012 Frederic Han. opensw ships the wheel giacpy-${giacpy}-cp313-cp313-win_amd64.whl from PyPI unchanged, unpacked into engine/python.\n`
        + `Source code: giacpy-${giacpy}.tar.gz at https://pypi.org/project/giacpy/${giacpy}/#files\n\n` + await spdxText('GPL-2.0-or-later')] },
    { name: 'Giac (giacxcas.dll, inside giacpy)', version: giacVersion, license: 'GPL-3.0-or-later', url: 'https://www-fourier.univ-grenoble-alpes.fr/~parisse/giac.html',
      texts: ['(c) B. Parisse and R. De Graeve, Institut Fourier, Universite Grenoble Alpes. opensw ships the giacxcas.dll of giacpy\'s wheel, unchanged.\n'
        + `Source code: ${giacSource} (from https://www-fourier.univ-grenoble-alpes.fr/~parisse/giac.html)\n\n` + await spdxText('GPL-3.0-or-later')] },
    { name: 'Libraries inside giacpy (Windows desktop app)', version: giacpy, license: 'various', url: '',
      texts: ['The other files of giacpy\'s Windows wheel (in engine/python/Lib/site-packages/giacpy): the library each belongs to and its\n'
        + 'version, its licence, who holds the copyright and where it and its source code come from. opensw ships the files unchanged.\n'
        + 'The wheel has no notices of theirs; the version is told from the file\'s version information or the text in it, and\n'
        + '"not confirmed" is written where those do not say. Most of the files were built by the MSYS2 project (the compiler\'s\n'
        + 'notes in them say so), which keeps how it builds each at https://github.com/msys2/MINGW-packages.\n\n'
        + list(giacDlls)
        + '\n\nCompiled into giacxcas.dll, as far as the text and the names in the file tell (Giac\'s source code, above, has them all):\n\n'
        + list(giacInside)
        + '\n\nThe GPL-2.0 and GPL-3.0 texts are above, with giacpy and Giac. The other licence texts and the projects\' notices follow.',
      await licence('LGPL-3.0-or-later'), await licence('LGPL-2.1-or-later'), await licence('LGPL-2.0-or-later'),
      await licence('GCC-exception-3.1'), await licence('FLTK-exception'), await licence('Apache-2.0'),
      await licence('IJG'), await licence('Zlib'), await licence('GL2PS'),
      await notice('OpenSSL 1.1.1i (LICENSE: the OpenSSL licence and the SSLeay licence)', GH + 'openssl/openssl/OpenSSL_1_1_1i/LICENSE'),
      await notice('the MSYS2 runtime 3.1.7, Cygwin (winsup/CYGWIN_LICENSE)', GH + 'msys2/msys2-runtime/msys2-3_1_7-release/winsup/CYGWIN_LICENSE'),
      await notice('newlib, in the MSYS2 runtime 3.1.7 (COPYING.NEWLIB)', GH + 'msys2/msys2-runtime/msys2-3_1_7-release/COPYING.NEWLIB'),
      await notice('curl 7.73.0 (COPYING)', GH + 'curl/curl/curl-7_73_0/COPYING'),
      await notice('Brotli (LICENSE)', GH + 'google/brotli/v1.0.9/LICENSE'),
      await notice('dlfcn-win32 from 1.3.0 (COPYING)', GH + 'dlfcn-win32/dlfcn-win32/v1.3.0/COPYING'),
      await notice('libjpeg-turbo 2.0.5 (LICENSE.md)', GH + 'libjpeg-turbo/libjpeg-turbo/2.0.5/LICENSE.md'),
      await notice('LAPACK 3.9.0 (LICENSE)', GH + 'Reference-LAPACK/lapack/v3.9.0/LICENSE'),
      await notice('nghttp2 1.41.0 (COPYING)', GH + 'nghttp2/nghttp2/v1.41.0/COPYING'),
      await notice('libpng 1.6.37 (LICENSE)', GH + 'pnggroup/libpng/v1.6.37/LICENSE'),
      await notice('libpsl 0.21.1 (COPYING)', GH + 'rockdaboot/libpsl/0.21.1/COPYING'),
      await notice('libsamplerate 0.1.9 (COPYING)', GH + 'libsndfile/libsamplerate/0.1.9/COPYING'),
      await notice('libssh2 1.9.0 (COPYING)', GH + 'libssh2/libssh2/libssh2-1.9.0/COPYING'),
      await notice('mingw-w64 winpthreads (COPYING)', GH + 'mingw-w64/mingw-w64/master/mingw-w64-libraries/winpthreads/COPYING'),
      await notice('Zstandard 1.4.5 (LICENSE)', GH + 'facebook/zstd/v1.4.5/LICENSE'),
      await notice('QuickJS (LICENSE)', GH + 'bellard/quickjs/master/LICENSE'),
      await notice('MicroPython 1.12 (LICENSE)', GH + 'micropython/micropython/v1.12/LICENSE'),
      await notice('ulab (LICENSE)', GH + 'v923z/micropython-ulab/master/LICENSE'),
      await notice('TinyMT (LICENSE.txt)', GH + 'MersenneTwister-Lab/TinyMT/master/LICENSE.txt'),
      'Notice of QR Code generator\n\n' + (await spdxText('MIT')).replace('<year> <copyright holders>', 'Project Nayuki')] },
  );
  // python-flint, in the same Python: its Windows wheel holds FLINT and what FLINT needs, with the
  // notices of each in python_flint-<version>.dist-info/licenses (unpacked into engine/python as well).
  const flint = bundle.match(/python_flint-([\d.]+)-cp/)[1];
  const flintDlls = [
    ['FLINT 3.6.0', 'LGPL-3.0-or-later', 'libflint.24.0.0-*.dll', 'Copyright the FLINT authors', 'https://flintlib.org/'],
    ['GMP 6.3.0', 'LGPL-3.0-or-later OR GPL-2.0-or-later', 'libgmp-10-*.dll', FSF, 'https://gmplib.org/'],
    ['MPFR 4.2.2', 'LGPL-3.0-or-later', 'libmpfr-6-*.dll', FSF, 'https://www.mpfr.org/'],
    ['GCC runtime library (version not confirmed)', 'GPL-3.0-or-later WITH GCC-exception-3.1 AND LGPL-2.1-or-later', 'libgcc_s_seh-1-*.dll', FSF, 'https://gcc.gnu.org/'],
    ['mingw-w64 winpthreads (version not confirmed)', 'MIT AND BSD-3-Clause-Clear', 'libwinpthread-1-*.dll', 'Copyright (c) 2011 mingw-w64 project', 'https://www.mingw-w64.org/'],
  ];
  entries.push(
    { name: 'python-flint (Windows desktop app)', version: flint, license: 'MIT', url: 'https://pypi.org/project/python-flint/',
      texts: [(await spdxText('MIT')).replace('<year> <copyright holders>', '2014-2016 Fredrik Johansson')] },
    { name: 'FLINT (inside python-flint)', version: '3.6.0', license: 'LGPL-3.0-or-later', url: 'https://flintlib.org/',
      texts: ['Copyright the FLINT authors. Source code: https://flintlib.org/ (opensw ships python-flint\'s wheel unchanged, in engine/python).\n\n'
        + await spdxText('LGPL-3.0-or-later')] },
    { name: 'Libraries inside python-flint (DLLs, Windows desktop app)', version: flint, license: 'various', url: '',
      texts: ['The DLLs of python-flint\'s Windows wheel (python_flint.libs), the library each belongs to, its licence,\n'
        + 'who holds the copyright and where it and its source code come from. opensw ships the files unchanged.\n'
        + `The notices of each are in engine/python/Lib/site-packages/python_flint-${flint}.dist-info/licenses;\n`
        + 'the GPL and LGPL texts, the GCC runtime exception and the notice of winpthreads are in this section too.\n\n'
        + list(flintDlls)] },
  );
  sections.push({ title: 'Computation engine (Python)', entries });
}

// FriCAS in the Windows desktop app (scripts/bundle-fricas.mjs: engine/fricas in the installer and the
// portable zip). Its one program, bin/FRICASsys.exe, is FriCAS compiled by SBCL together with SBCL's
// runtime (the version FriCAS prints when it starts), built with MinGW-w64 (told from the compiler's
// notes in the file). The native libraries of the download (libspad, GMP) are left out of engine/fricas.
{
  const version = fs.readFileSync('scripts/bundle-fricas.mjs', 'utf8').match(/fricas-([\d.]+)-windows/)[1];
  sections.push({ title: 'FriCAS (asked for integrals in the Windows desktop app)', entries: [
    { name: 'FriCAS (its notice is also in engine/fricas/lib/copyright, the people who wrote it in engine/fricas/lib/credits)',
      version, license: 'BSD-3-Clause', url: 'https://github.com/fricas/fricas',
      texts: [await raw(`https://raw.githubusercontent.com/fricas/fricas/${version}/LICENSE.txt`)] },
    { name: 'SBCL (inside bin/FRICASsys.exe)', version: '2.3.2', license: 'public domain, with BSD-style and MIT-style parts', url: 'https://www.sbcl.org/',
      texts: [await raw('https://raw.githubusercontent.com/sbcl/sbcl/sbcl-2.3.2/COPYING')] },
    { name: 'MinGW-w64 runtime (linked into bin/FRICASsys.exe)', version: '', license: 'ZPL-2.1, with public-domain parts', url: 'https://www.mingw-w64.org/',
      texts: [await spdxText('ZPL-2.1')] },
  ] });
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
    { name: 'en-US spelling dictionary (Tools > Spelling; public/dict)', version: '', license: 'LGPL-2.1 / BSD', url: 'http://wordlist.aspell.net/',
      texts: [fs.readFileSync('public/dict/README.txt', 'utf8').trim()] },
  ] });
}

// Write: each section lists its packages; packages with the very same licence text share one copy.
const line = '='.repeat(78);
let out = `opensw — third-party software notices

opensw is licensed under the Mozilla Public License 2.0 (see LICENSE). It ships software
written by other people, each under its own licence. Those licences are reproduced below.
opensw 用了別人寫的開源軟體，以下是它們的授權全文。

The TeX files Tectonic uses come from TeX Live; each file keeps the licence written in it
(mostly the LaTeX Project Public License and the SIL Open Font License).
The Scientific Word 5.x macro files in tex55/ are listed in tex55/README.md.

The Windows desktop app comes with programs under the GNU GPL and LGPL: giacpy, Giac and the
libraries in giacpy's wheel, FLINT and the libraries in python-flint's wheel. They are listed
under "Computation engine (Python)", each with where its source code is. opensw ships them as
the binary files their projects published (the wheels on PyPI), unchanged, in engine/python.
opensw.exe does not link with them: it starts that Python as a separate process, and Giac runs
in one more Python process of its own (engine/opensw_giac_worker.py). Their licences stay
theirs; opensw's own files stay under the MPL 2.0.

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
