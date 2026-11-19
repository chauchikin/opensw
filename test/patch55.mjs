// Saving an edited 5.x file (export.js patchTex55): the parts nobody edited are written
// as they were in the file, comments and spacing included; only edited parts are
// written from the editor, and the file reads back as the edited document.  node test/patch55.mjs
import fs from 'node:fs';
import { Fragment } from 'prosemirror-model';
import { readLatex, decode55 } from '../src/tex55.js';
import { patchTex55 } from '../src/export.js';
import { schema } from '../src/schema.js';

let fails = 0;
const check = (ok, what, detail) => { console.log(ok ? 'ok  ' : 'FAIL', what, ok || detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)); if (!ok) fails++; };
const kids = (doc) => { const l = []; doc.forEach((n) => l.push(n)); return l; };
const docOf = (l) => schema.nodes.doc.create(null, l);
const addText = (n, t) => n.copy(n.content.append(Fragment.from(schema.text(t))));
const lost = (a, b) => { const keep = new Set(b.split('\n')); return a.split('\n').filter((l) => !keep.has(l)); };

// a 5.x file with comments, a TCI macro, a verbatim block and \r\n line ends
const file = [
  '%2multibyte Version: 5.50.0.2960 CodePage: 950', '\\documentclass{article}', '%TCIDATA{OutputFilter=LATEX.DLL}',
  '\\input{tcilatex}', '\\begin{document}', '', 'First   paragraph,  odd   spacing. % a comment', 'goes on here.', '',
  '%TCIMACRO{\\HTML{<b>x</b>}}%', '%BeginExpansion', '%EndExpansion', 'Second $x^{2}$ paragraph.', '',
  '\\begin{verbatim}', '100% kept', '\\end{verbatim}', '', 'Third paragraph.', '\\[', 'a+b', '\\]', 'and after.', '',
  '\\section{Last}', 'Fourth.', '', '\\end{document}', ''].join('\r\n');
const t = decode55(new TextEncoder().encode(file));
const r = readLatex(t);
const norm = t.replace(/\r\n?/g, '\n');
check(!!r.spans55, 'a 5.x file: its parts are found');
const same = patchTex55(r.spans55, r.doc, r.doc, r.meta);
check(same.text === norm, 'nothing edited: the same text', same.text);

const L = kids(r.doc);
const i3 = L.findIndex((n) => n.textContent.startsWith('Third'));
const i1 = L.findIndex((n) => n.textContent.startsWith('First'));
let C = L.slice(); C[i3] = addText(C[i3], ' EDITED');
let p = patchTex55(r.spans55, r.doc, docOf(C), r.meta);
check(p.text.includes('First   paragraph,  odd   spacing. % a comment') && p.text.includes('%TCIMACRO{\\HTML{<b>x</b>}}%') && p.text.includes('100% kept'),
  'the other parts keep their comments, spacing and TCI macro', p.text);
check(lost(norm, p.text).every((l) => /^Third/.test(l)) && lost(p.text, norm).every((l) => /EDITED/.test(l)), 'only the edited part changed', [lost(norm, p.text), lost(p.text, norm)]);
check(readLatex(p.text).doc.eq(docOf(C)), 'reads back as the edited document');
// the part a display formula sits in is written together with it
check(/Third paragraph\. EDITED\n\\\[\na\+b\n\\\]\nand after\./.test(p.text), 'a display stays in its paragraph (no blank line around it)', p.text);

// delete one block, insert a new one
C = L.slice(); C.splice(i1, 1); C.splice(2, 0, schema.nodes.paragraph.create(null, [schema.text('A new one.')]));
p = patchTex55(r.spans55, r.doc, docOf(C), r.meta);
check(!p.text.includes('First') && p.text.includes('A new one.') && p.text.includes('100% kept'), 'deleted and inserted blocks', p.text);
check(readLatex(p.text).doc.eq(docOf(C)), '…reads back as the edited document');

// saved again: the new parts are known, so an edit elsewhere leaves them as written
const p2 = patchTex55(p.spans, docOf(C), docOf(C), r.meta);
check(p2.text === p.text, 'after saving: nothing edited gives the same text');
const C2 = C.slice(); const iLast = C2.findIndex((n) => n.textContent.startsWith('Fourth')); C2[iLast] = addText(C2[iLast], '!');
const p3 = patchTex55(p.spans, docOf(C), docOf(C2), r.meta);
check(lost(p.text, p3.text).every((l) => /Fourth/.test(l)), 'after saving: the next edit changes only its own part', lost(p.text, p3.text));

// a new theorem kind: the preamble gets what it needs, the rest of the preamble stays
C = L.slice(); C.push(schema.nodes.env.create({ kind: 'conjecture' }, [schema.nodes.paragraph.create(null, [schema.text('Maybe.')])]));
p = patchTex55(r.spans55, r.doc, docOf(C), r.meta);
const pre = p.text.slice(0, p.text.indexOf('\\begin{document}'));
check(pre.startsWith(norm.slice(0, norm.indexOf('\\begin{document}')).trimEnd()) && /\\newtheorem\{conjecture\}/.test(pre), 'a new theorem kind is defined in the preamble', pre);

// Typeset > Preamble edited: the user's preamble is used
p = patchTex55(r.spans55, r.doc, r.doc, { ...r.meta, preamble55raw: '%2multibyte Version: 5.50.0.2960 CodePage: 950\n\\documentclass{book}\n\\input{tcilatex}\n' });
check(p.text.includes('\\documentclass{book}') && p.text.endsWith(norm.slice(norm.indexOf('\\begin{document}'))), 'an edited preamble replaces the file\'s', p.text.slice(0, 200));

// a real lecture-note pattern file: identity and an edit
const rt = decode55(fs.readFileSync('test/fixtures/real55.tex'));
const rr = readLatex(rt);
check(patchTex55(rr.spans55, rr.doc, rr.doc, rr.meta)?.text === rt.replace(/\r\n?/g, '\n'), 'real55.tex: nothing edited gives the same text');
const RL = kids(rr.doc); const k = RL.findIndex((n) => n.textContent.startsWith('Find the root'));
const RC = RL.slice(); RC[k] = addText(RC[k], ' Z');
const rp = patchTex55(rr.spans55, rr.doc, docOf(RC), rr.meta);
check(lost(rt.replace(/\r\n?/g, '\n'), rp.text).every((l) => l.startsWith('Find the root')), 'real55.tex: an edit changes only its own line', lost(rt.replace(/\r\n?/g, '\n'), rp.text));

// blocks the parts do not fit (another document): no patch, the whole file is written
check(patchTex55(r.spans55, rr.doc, rr.doc, r.meta) === null, 'parts that do not fit the document: not used');
// a LaTeX file 5.x did not write has no parts (it is always written for 5.x)
check(!readLatex('\\documentclass{article}\n\\begin{document}\nHi.\n\\end{document}\n').spans55, 'other LaTeX: no parts');

process.exit(fails ? 1 : 0);
