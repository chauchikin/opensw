// Checks that saving an edited 5.x file changes only the edited part (export.js patchTex55):
// for every .tex file under a folder, each of a few paragraphs in turn gets a word added, the
// file is saved the way opensw saves it, and the saved bytes are compared with the original:
// everything before and after the edited paragraph's part must be the same bytes.
//   node scripts/check-patch55.mjs <folder>   (exits 1 when a file changes elsewhere)
import fs from 'node:fs';
import path from 'node:path';
import { Fragment } from 'prosemirror-model';
import { readLatex, decode55 } from '../src/tex55.js';
import { patchTex55 } from '../src/export.js';
import { encodeFile55 } from '../src/tex55file.js';
import { schema } from '../src/schema.js';

const dir = process.argv[2];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tex$/i.test(e.name) ? [path.join(d, e.name)] : []));
const files = walk(dir).sort();
let ok = 0, bad = 0, skipped = 0, tries = 0;
// as main.js saves: a code page line added only when the file needs a new one, \r\n only when the file had them
const save = (text, meta, raw) => { const b = encodeFile55(text, meta, decode55(raw)); return raw.includes(13) ? b : b.filter((x) => x !== 13); };
const problems = [];

for (const f of files) {
  const raw = fs.readFileSync(f);
  const r = readLatex(decode55(raw));
  if (!r.spans55) { skipped++; problems.push(`${path.relative(dir, f)}: parts not found (saved whole)`); continue; }
  const L = [];
  r.doc.forEach((n) => L.push(n));
  // up to 3 paragraphs with text: the first, the middle and the last one
  const paras = L.map((n, i) => [n, i]).filter(([n]) => n.type.name === 'paragraph' && n.textContent.trim());
  const picks = [...new Set([paras[0], paras[paras.length >> 1], paras.at(-1)].filter(Boolean).map((p) => p[1]))];
  // where each block's part is in the file (spans.segs: parts of n blocks)
  const partOf = [];
  let from = r.spans55.head;
  for (const g of r.spans55.segs) { for (let k = 0; k < g.n; k++) partOf.push([from, g.to]); from = g.to; }
  let fileOk = true;
  for (const i of picks) {
    tries++;
    const C = L.slice();
    C[i] = C[i].copy(C[i].content.append(Fragment.from(schema.text(' EDITED'))));
    const p = patchTex55(r.spans55, r.doc, schema.nodes.doc.create(null, C), r.meta);
    if (!p) { fileOk = false; problems.push(`${path.relative(dir, f)} block ${i}: not patched (saved whole)`); continue; }
    // compared as text (line ends as \n): the first and last character that differ
    const oldT = r.spans55.text, newT = decode55(save(p.text, r.meta, raw)).replace(/\r\n?/g, '\n');
    let s = 0;
    while (s < oldT.length && s < newT.length && oldT[s] === newT[s]) s++;
    let e = 0;
    while (e < oldT.length - s && e < newT.length - s && oldT[oldT.length - 1 - e] === newT[newT.length - 1 - e]) e++;
    const [pf, pt] = partOf[i];
    if (s < pf || oldT.length - e > pt) {
      fileOk = false;
      problems.push(`${path.relative(dir, f)} block ${i}: changed ${s}..${oldT.length - e} outside the part ${pf}..${pt}`
        + ` | old: ${JSON.stringify(oldT.slice(s, Math.min(oldT.length - e, s + 80)))} new: ${JSON.stringify(newT.slice(s, Math.min(newT.length - e, s + 80)))}`);
    }
  }
  // nothing edited: the very same bytes
  const same = patchTex55(r.spans55, r.doc, r.doc, r.meta);
  if (!same || Buffer.compare(Buffer.from(save(same.text, r.meta, raw)), raw) !== 0) { fileOk = false; problems.push(`${path.relative(dir, f)}: saved without edits, the bytes differ`); }
  if (fileOk) ok++; else bad++;
}
console.log(problems.join('\n'));
console.log(`${files.length} files, ${tries} edits: ${ok} files only changed in the edited part, ${bad} not, ${skipped} without parts`);
process.exit(bad || skipped ? 1 : 0);
