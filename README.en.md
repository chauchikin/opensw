# opensw

An open-source math editor rebuilt after Scientific Word 5.5.

Plenty of people still write their mathematics in 5.5, but it gets harder to run on today's computers.
opensw aims at one thing: open 5.5 files, edit them, typeset them, and work the way 5.5 does.

中文：[README.md](README.md)

## What it does

- Opens Scientific Word 5.x `.tex` files and 6.x `.sci` files
- Saves `.sci`, and can save back to a 5.x-format `.tex` for 5.5 (Chinese in Big5)
- Text and formulas on the same line; menus and keyboard shortcuts as in 5.5
- A Compute menu run by SymPy: simplify, solve, calculus, matrices, ODEs, statistics
- Tables, pictures, footnotes, citations, index entries, cross-references, numbered equations
- 5.5 plots are drawn again from the settings stored in the file
- Typesets to PDF (XeLaTeX, Chinese included); exports LaTeX, HTML and Markdown
- The desktop app has an MCP server, so AI tools can read, edit, compute and typeset

A 5.x command it does not know is kept as a TeX field, so nothing is lost on saving or export.

## Running it

```
npm install
npx vite              # development server (http://localhost:5173)
npx vite build        # web version in dist/
npx tauri build       # desktop app (needs Rust)
```

Tests are in `test/` and run with Playwright's Chromium, for example:

```
npx vite preview --port 4173 &
node test/tables.mjs
```

## License

MIT, see [LICENSE](LICENSE).

Components keep their own licenses: ProseMirror, MathLive, CortexJS Compute Engine (MIT), SymPy, mpmath (BSD), Pyodide (MPL-2.0), Tauri (MIT/Apache-2.0), Tectonic (MIT).

## Acknowledgments

Scientific Word was made by MacKichan Software. For many years it let people write mathematics well, and opensw follows its menus, shortcuts and file formats. Thank you.

opensw's code is written from scratch. It uses no Scientific Word code, icons or sample files.
To typeset 5.x documents it uses 5.x's macro files (tcilatex and others). The ones shipped with opensw are only those whose files say they may be freely copied and distributed; the others are replaced by versions written for opensw. If 5.x is installed on your computer, your own copies are used first.

opensw is not affiliated with MacKichan Software and is not one of its products. Scientific Word is a trademark of MacKichan Software.
