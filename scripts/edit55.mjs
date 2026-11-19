// Edited copies of 5.x files, saved the way opensw saves them (only the edited parts written
// again, export.js patchTex55), for opening in real Scientific Word 5.5 (scripts/open55batch.ps1).
// Each file: text added to every 7th paragraph, one formula changed, a paragraph and a display
// formula added, one block deleted.  node scripts/edit55.mjs <from folder> <to folder> < list of files
import fs from 'node:fs'; import path from 'node:path';
import { readLatex, decode55 } from '../src/tex55.js';
import { patchTex55 } from '../src/export.js';
import { encodeFile55, withCodepage55 } from '../src/tex55file.js';
import { schema } from '../src/schema.js';
import { Fragment } from 'prosemirror-model';
const [src, dst] = process.argv.slice(2);
const files = fs.readFileSync(0, 'utf8').trim().split('\n');
const report = [];
for (const f of files) {
  const raw = fs.readFileSync(f); const t = decode55(raw); const r = readLatex(t);
  const L = []; r.doc.forEach((n) => L.push(n)); const C = L.slice();
  let edits = 0;
  C.forEach((n, i) => { if (n.type.name === 'paragraph' && n.content.size && i % 7 === 3) { C[i] = n.copy(n.content.append(Fragment.from(schema.text(' (edited)')))); edits++; } });
  // a formula changed inside a paragraph
  const fi = C.findIndex((n, i) => i % 7 !== 3 && n.type.name === 'paragraph' && n.content.content.some((c) => c.type.name === 'math_inline'));
  if (fi >= 0) { const n = C[fi]; C[fi] = n.copy(Fragment.from(n.content.content.map((c) => c.type.name === 'math_inline' ? c.type.create({ ...c.attrs, latex: c.attrs.latex + '+1' }) : c))); edits++; }
  // a new paragraph with formulas, and one block deleted
  const at = Math.min(4, C.length);
  C.splice(at, 0, schema.nodes.paragraph.create(null, [schema.text('New paragraph with '), schema.nodes.math_inline.create({ latex: '\\frac{a}{b}+\\sqrt{x}' }), schema.text(' in it.')]),
    schema.nodes.math_display.create({ latex: '\\int_{0}^{1}x^{2}\\,dx=\\frac{1}{3}' }));
  if (C.length > 12) C.splice(10, 1);
  const p = patchTex55(r.spans55, r.doc, schema.nodes.doc.create(null, C), r.meta);
  let bytes = encodeFile55(withCodepage55(p.text, r.meta), r.meta);
  if (!raw.includes(13)) bytes = bytes.filter((x) => x !== 13);
  const out = path.join(dst, path.relative(src, f));
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, bytes);
  report.push(path.relative(src, f));
}
console.log(report.length, 'files');
