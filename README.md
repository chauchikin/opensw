# opensw

**English** | [繁體中文](README.zh-TW.md)

An open-source math editor rebuilt after Scientific Word 5.5.

Plenty of people still write their mathematics in 5.5, but it gets harder to run on today's computers.
opensw aims at one thing: open 5.5 files, edit them, typeset them, and work the way 5.5 does.

## What it does

- Opens Scientific Word 5.x `.tex` files and 6.x `.sci` files
- 5.x `.tex` is the main format: saves back to the file it opened (keeping a `.bak`; Chinese in Big5) writing only the edited paragraphs again and leaving the rest exactly as it was, typesets from that same text, and can also save `.sci`
- Text and formulas on the same line; menus and keyboard shortcuts as in 5.5
- A Compute menu run by SymPy: simplify, solve, calculus, matrices, ODEs, statistics; with Mathematica installed, Tools > Computation Engine can switch it to Mathematica (desktop app). To connect another engine: [ENGINE.en.md](ENGINE.en.md). Computing is opensw's own (5.5 used MuPAD), so answers may be written differently from 5.5's
- Tables, pictures, footnotes, citations, index entries, cross-references, numbered equations
- 5.5 plots are drawn again from the settings stored in the file (all the 2D and 3D kinds)
- Demo problems: File > Samples has three demo documents (calculus, algebra and matrices, vectors and statistics and more); each problem names its menu command and gives the answer, to try the Compute menu on
- Exam Builder: exams and answer keys made from a 5.5 exam template (.qiz)
- Fragments, Open Location, Document Manager (pack into a .zip, open 5.5's wrapped .rap)
- A manual for every menu: Help > Manual (source in `src/helpdoc.js`)
- Typesets to PDF (XeLaTeX, Chinese included; the Windows version bundles Tectonic and the usual TeX files, so it works offline); exports LaTeX, HTML and Markdown
- Interface in English and Traditional Chinese (Tools > User Setup). The program is written in English; Chinese is the translation file `src/locales/zh-TW.json`; to add a language, see the top of `src/i18n.js`
- In the desktop app, Claude or ChatGPT can work on the document: Tools > Connect AI sets it up in one step; what the AI changed is tinted, and Edit > Undo AI Changes takes it back in one step
- The desktop app has an MCP server, so AI tools can read, edit, compute and typeset; the same commands work from a terminal with `opensw-cli` (see docs/AI.md)

A 5.x command it does not know is kept as a TeX field, so nothing is lost on saving or export.

## Download

Windows 10 and 11: download from the [Releases page](https://github.com/chauchikin/opensw/releases).

- `opensw_<version>_x64-setup.exe`: the installer. It installs into your own user folder and needs no administrator rights.
- `opensw_<version>_x64-portable.zip`: the portable version. Unzip it first (right-click it, then Extract All; opensw.exe does not run from inside the zip), then run `opensw.exe` in the folder; it can live on a USB stick.

The installer is not signed, so the first time Windows may say "Windows protected your PC". Click "More info", then "Run anyway".

There are no installers for macOS and Linux; you can build it yourself as described under "Running it".

## Running it

```
npm install
npx vite              # development server (http://localhost:5173)
npx vite build        # web version in dist/
npx tauri build       # desktop app (needs Rust)
```

Tests are in `test/` and run with Playwright's Chromium. Build, start the preview, then run all of them or a few:

```
npx vite build
npx vite preview --port 4173 &
npm test              # all
npm test tables       # only test/tables.mjs
```

## License

MIT, see [LICENSE](LICENSE).

Components keep their own licenses: ProseMirror, MathLive, CortexJS Compute Engine (MIT), SymPy, mpmath (BSD), Pyodide (MPL-2.0), Tauri (MIT/Apache-2.0), Tectonic (MIT). The full texts are in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt), which also ships with the installer. Regenerate it with `node scripts/licenses.mjs` after changing dependencies.

## Acknowledgments

Scientific Word was made by MacKichan Software. For many years it let people write mathematics well, and opensw follows its menus, shortcuts and file formats. Thank you.

opensw's code is written from scratch. It uses no Scientific Word code, icons or sample files.
To typeset 5.x documents it uses 5.x's macro files (tcilatex and others). The ones shipped with opensw are only those whose files say they may be freely copied and distributed; the others are replaced by versions written for opensw. If 5.x is installed on your computer, your own copies are used first.

opensw is not affiliated with MacKichan Software and is not one of its products. Scientific Word is a trademark of MacKichan Software.
