// Opens Scientific Word 5.x documents. They are LaTeX files with SW's own
// comments (%TCIDATA ...) and a few SW macros (from tcilatex.tex). CJK text is
// stored in the Windows code page named in the first line ("CodePage: 950" = Big5).
import { schema, envLabel } from './schema.js';
import { _t } from './i18n.js';
import { splitRows } from './numbering.js';
import { readDefs, expandMacros } from './texmacros.js';
import { frameAttrs, includeAttrs } from './graphics.js';

const CODEPAGES = { 950: 'big5', 936: 'gbk', 932: 'shift_jis', 949: 'euc-kr', 1252: 'windows-1252' };
const FRONT_CMDS = new Set(['address', 'curraddr', 'email', 'urladdr', 'dedicatory', 'keywords', 'subjclass', 'translator']);
const SECTIONS = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
const DISPLAY_ENVS = { equation: '', 'equation*': '', displaymath: '', align: 'aligned', 'align*': 'aligned',
  gather: 'gathered', 'gather*': 'gathered', multline: 'gathered', 'multline*': 'gathered',
  eqnarray: 'array', 'eqnarray*': 'array', alignat: 'alignedat', 'alignat*': 'alignedat' };
const SIZES = new Set(['tiny', 'scriptsize', 'footnotesize', 'small', 'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge']);
const SWITCH_MARKS = { bf: 'bold', bfseries: 'bold', it: 'italic', itshape: 'italic', em: 'italic', sl: 'italic', slshape: 'italic',
  tt: 'code', ttfamily: 'code', sc: 'smallcaps', scshape: 'smallcaps', sf: 'sans', sffamily: 'sans' };
const ARG_MARKS = { textbf: 'bold', emph: 'italic', textit: 'italic', textsl: 'italic', texttt: 'code',
  textsc: 'smallcaps', textsf: 'sans', underline: 'underline', uline: 'underline' };
// a mark added to the marks in force (one of each kind; strings are marks without attributes)
const markName = (m) => (typeof m === 'string' ? m : m.type.name);
const withMark = (marks, m) => [...marks.filter((x) => markName(x) !== markName(m)), m];
const sizeMark = (size) => schema.marks.size.create({ size });
const SKIP_CMDS = new Set(['bigskip', 'medskip', 'smallskip', 'noindent', 'indent', 'newpage', 'clearpage', 'pagebreak',
  'linebreak', 'nolinebreak', 'allowbreak', 'hfill', 'vfill', 'centering', 'raggedright', 'raggedleft', 'protect',
  'normalfont', 'rmfamily', 'sffamily', 'upshape', 'mdseries', 'selectfont', 'relax', 'maketitle',
  'sloppy', 'fussy', 'nopagebreak', 'filbreak', 'goodbreak']);
const SKIP_ARG_CMDS = { vspace: 1, 'vspace*': 1, hspace: 1, 'hspace*': 1, setcounter: 2, addtocounter: 2, thispagestyle: 1, pagestyle: 1,
  Needspace: 1, 'Needspace*': 1, needspace: 1 };
const TEXT_CHARS = { '%': '%', $: '$', '&': '&', '#': '#', _: '_', '{': '{', '}': '}', ' ': '\u00a0', '\n': '\u00a0', '\t': '\u00a0', // "\ ": an extra space after a sentence (also \ at the end of a line)
  ',': ' ', ';': ' ',
  '/': '', '-': '­', '@': '' };
const TEXT_ACCENTS = { "'": '\u0301', '`': '\u0300', '^': '\u0302', '~': '\u0303', '"': '\u0308', '=': '\u0304', c: '\u0327', v: '\u030c' };
const TEXT_SYMBOLS = { ldots: '…', dots: '…', textbackslash: '\\', textless: '<', textgreater: '>', S: '§', P: '¶',
  copyright: '©', pounds: '£', dag: '†', ddag: '‡', textregistered: '®', texttrademark: '™', textdegree: '°',
  LaTeX: 'LaTeX', TeX: 'TeX', today: '', quad: ' ', qquad: '  ', ss: 'ß', ae: 'æ', oe: 'œ', o: 'ø', aa: 'å',
  AE: 'Æ', OE: 'Œ', O: 'Ø', AA: 'Å', i: 'ı', textendash: '–', textemdash: '—', textquotedblleft: '“', textquotedblright: '”' };

export function isSW5(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4000));
  return /%TCIDATA|\\documentclass|\\begin\{document\}/.test(head);
}

export function decode55(bytes) {
  // "CodePage: 950" in the first line, or %TCIDATA{Codepage=1252} further down the preamble
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 8000));
  const cp = (head.match(/CodePage:\s*(\d+)/) || head.match(/%TCIDATA\{Codepage=(\d+)\}/i) || [])[1];
  let enc = 'utf-8';
  if (!bytes.every((b) => b < 128)) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { enc = CODEPAGES[cp] || 'windows-1252'; }
  }
  return new TextDecoder(enc).decode(bytes);
}

// TeX comments: "%" removes the rest of the line, the line break and the next line's leading spaces
// (verbatim environments are left as they are: % is an ordinary character there)
// (a lookbehind, so that comment lines one after another are all removed)
// A comment right after a control word ends that word (5.x writes "\proof%" then
// "Let ..." on a later line): a space keeps them apart, as TeX ignores it there.
const COMMENT = /(?<!\\)((?:\\\\)*)%[^\n]*\n?[ \t]*/g;
const commentRep = (m, bs, at, t) => (!bs && /\\[a-zA-Z]+$/.test(t.slice(Math.max(0, at - 40), at)) ? ' ' : bs);
const VERBATIM = /(\\begin\{verbatim\*?\}[^]*?\\end\{verbatim\*?\})/;
export function stripComments(s) {
  return s.replace(/\r\n?/g, '\n').split(VERBATIM)
    .map((part, k) => (k % 2 ? part : part.replace(COMMENT, commentRep))).join('');
}

// A string that remembers where each of its characters came from in the text it was made
// from (start and end there), so that a part of what the parser read can be found in the
// file as written, comments and all.
class Mapped {
  constructor(s, st, en) { this.s = s; this.st = st; this.en = en; }
  static of(s) { return new Mapped(s, Array.from(s, (c, i) => i), Array.from(s, (c, i) => i + 1)); }
  // as String.replace with a function: a replacement comes from the whole match
  replace(re, fn) {
    let s = '', last = 0;
    const st = [], en = [];
    const copy = (a, b) => { s += this.s.slice(a, b); for (let i = a; i < b; i++) { st.push(this.st[i]); en.push(this.en[i]); } };
    for (const m of this.s.matchAll(re)) {
      copy(last, m.index);
      const rep = fn(...m, m.index, this.s);
      const a = m[0].length ? this.st[m.index] : (m.index ? this.en[m.index - 1] : 0);
      const b = m[0].length ? this.en[m.index + m[0].length - 1] : a;
      for (let i = 0; i < rep.length; i++) { st.push(a); en.push(b); }
      s += rep;
      last = m.index + m[0].length;
    }
    copy(last, this.s.length);
    return new Mapped(s, st, en);
  }
  // stripComments, remembering where things were
  stripComments() {
    const parts = [];
    let last = 0;
    for (const m of this.s.matchAll(new RegExp(VERBATIM.source, 'g'))) {
      parts.push(this.slice(last, m.index).replace(COMMENT, commentRep), this.slice(m.index, m.index + m[0].length));
      last = m.index + m[0].length;
    }
    parts.push(this.slice(last, this.s.length).replace(COMMENT, commentRep));
    return new Mapped(parts.map((p) => p.s).join(''), parts.flatMap((p) => p.st), parts.flatMap((p) => p.en));
  }
  slice(a, b) { return new Mapped(this.s.slice(a, b), this.st.slice(a, b), this.en.slice(a, b)); }
}

// -> { doc, meta }
export function readTex55(bytes) {
  return readLatex(decode55(bytes));
}

// LaTeX text (a whole document or just a part of one) -> { doc, meta }
// a 5.x HTML field is a TCI macro (a comment): %TCIMACRO{\HTML{..}}% with an empty expansion;
// an Exam Builder formula is %TCIMACRO{\FORMULA{expr}{value}{operation}}% with the value as
// its expansion: kept as \FORMULA{..}{..}{..} in the formula (shown as the value)
const FORMULA_MACRO = /%TCIMACRO\{((?:[^\n]|\r?\n%)*?)\}%[ \t]*\r?\n%BeginExpansion\r?\n[^]*?%EndExpansion/g;
const formulaRep = (all, inner) => { const m = inner.replace(/\r?\n%/g, ''); return /^\\FORMULA\{/.test(m) ? m : all; };
const HTML_MACRO = /%TCIMACRO\{\\HTML\{([^\n]*)\}\s*\}%[ \t]*\r?\n%BeginExpansion\r?\n[^]*?%EndExpansion[^\n]*\n?[ \t]*/g;
const htmlRep = (all, inner) => `\\HTML{${inner}}`;

export function readLatex(text) {
  const input = text;
  text = text.replace(FORMULA_MACRO, formulaRep);
  const src = stripComments(text.replace(HTML_MACRO, htmlRep));
  const b = src.indexOf('\\begin{document}');
  const e = src.lastIndexOf('\\end{document}');
  const preamble = b >= 0 ? src.slice(0, b) : '';
  let body = b >= 0 ? src.slice(b + 16, e > b ? e : undefined) : src;
  // a LaTeX document's own commands are written out (5.x writes its own itself)
  if (!/\\input\{tcilatex\}|%TCIDATA/.test(text)) body = expandMacros(body, readDefs(preamble));
  const theorems = {};
  for (const m of preamble.matchAll(/\\newtheorem\*?\{([^}]+)\}(?:\[[^\]]*\])?\{([^}]*)\}/g)) theorems[m[1]] = m[2];
  const p = new Parser(theorems);
  const head = new Parser(theorems); // \title, \author in the preamble
  head.blocks(preamble.replace(/\\documentclass[^\n]*|\\usepackage[^\n]*|\\input\{tcilatex\}/g, ''));
  p.title = head.title; p.author = head.author;
  const is5x = /\\input\{tcilatex\}|%TCIDATA|^%2multibyte/.test(text);
  if (is5x) p.track = [];
  let blocks = p.blocks(body);
  const spans55 = is5x && blocks.length ? fileParts55(input, src, b, p.track) : null;
  if (!blocks.length) blocks = [schema.nodes.paragraph.create()];
  const cls = (preamble.match(/\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/) || [])[1];
  const packages = [...preamble.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim()));
  // typesetting a 5.x document uses its own preamble (with tcilatex.tex) so the PDF looks as in 5.x
  const preamble55 = preamble.replace(/\n{3,}/g, '\n\n').trim();
  // the preamble as written, comments too (5.x keeps its settings in %TCIDATA lines): for saving back to 5.x
  const rawText = text.replace(/\r\n?/g, '\n');
  const rb = rawText.indexOf('\\begin{document}');
  const preamble55raw = rb >= 0 ? rawText.slice(0, rb) : null;
  const codepage = +((rawText.slice(0, 300).match(/CodePage:\s*(\d+)/) || rawText.match(/%TCIDATA\{Codepage=(\d+)\}/) || [])[1]) || null;
  const keep = [...preamble.matchAll(/\\newtheorem\*?\{[^}]+\}(?:\[[^\]]*\])?\{[^}]*\}(?:\[[^\]]*\])?/g)].map((m) => m[0]);
  if (spans55) spans55.preamble = preamble55raw;
  return { doc: schema.nodes.doc.create(null, blocks), meta: { documentclass: cls, packages, preambleTeX: keep.join('\n'), preamble55, preamble55raw, codepage, author55: p.author ?? null }, spans55 };
}

// Where each top-level block of a 5.x file is in the file as written (line ends as \n):
// blocks with no blank line between them are one part. A part that is not edited is
// saved again as it was (export.js patchTex55), comments and spacing included.
// -> { text, head (end of \begin{document}), segs: [{ to, n }] (a part ends at to and has
// n blocks; it starts where the one before ended, or at head) }, or null when the
// parser's text and the file cannot be matched up.
function fileParts55(input, src, b, track) {
  const text = input.replace(/\r\n?/g, '\n');
  const m = Mapped.of(text).replace(FORMULA_MACRO, formulaRep).replace(HTML_MACRO, htmlRep).stripComments();
  if (m.s !== src || b < 0 || !track) return null;
  const off = b + 16;
  const head = m.en[off - 1];
  const segs = [];
  let cur = null;
  for (const r of track) {
    const from = r.end > r.start ? m.st[off + r.start] : head;
    const to = r.end > r.start ? m.en[off + r.end - 1] : from;
    const prev = cur ? cur.to : head;
    if (cur && (from < cur.to || !/\n[ \t]*\n/.test(text.slice(cur.to, from)))) { cur.to = Math.max(cur.to, to); cur.n++; continue; }
    if (from < prev) return null;
    cur = { to: Math.max(to, prev), n: 1 };
    segs.push(cur);
  }
  return { text, head, segs };
}

// Scientific Word macros MathLive should display and keep as they are
const m = (def, args = 0) => ({ def, args, expand: false, captureSelection: false });
// big operators of tcilatex: \dsum = \sum in display style (limits above and below), \tsum in text style
const BIG_OPS = { int: 'int', iint: 'iint', iiint: 'iiint', oint: 'oint', sum: 'sum', prod: 'prod', coprod: 'coprod',
  bigcap: 'bigcap', bigcup: 'bigcup', bigwedge: 'bigwedge', bigvee: 'bigvee', bigoplus: 'bigoplus', bigodot: 'bigodot',
  bigotimes: 'bigotimes', bigsqcup: 'bigsqcup', biguplus: 'biguplus' };
export const MATH_MACROS = {
  allowbreak: m(''),
  // an Exam Builder formula: shows its last value (the expression is worked out when an exam is made)
  FORMULA: m('#2', 3),
  func: m('\\operatorname{#1}', 1),
  limfunc: m('\\operatorname{#1}', 1),
  unit: m('\\,\\mathrm{#1}', 1),
  // tcilatex: \stackunder{below}{op}; \QTR{style}{text} met in a formula; vertical space a formula cannot have
  stackunder: m('\\underset{#1}{#2}', 2),
  QTR: m('\\text{#2}', 2),
  diagdown: m('\\backslash'),
  // \TEXTsymbol{\backslash}: a symbol written in text (5.x, also inside tables in formulas)
  TEXTsymbol: m('{#1}', 1),
  bigskip: m(''), medskip: m(''), smallskip: m(''),
  // fractions of tcilatex: \QATOP{a}{b} (no line), \QABOVE{w}{a}{b} (line width w),
  // \QOVERD(){a}{b} (with brackets), T = text style, D = display style
  QATOP: m('\\genfrac{}{}{0pt}{}{#1}{#2}', 2),
  QTATOP: m('\\genfrac{}{}{0pt}{1}{#1}{#2}', 2),
  QDATOP: m('\\genfrac{}{}{0pt}{0}{#1}{#2}', 2),
  QABOVE: m('\\genfrac{}{}{#1}{}{#2}{#3}', 3),
  QTABOVE: m('\\genfrac{}{}{#1}{1}{#2}{#3}', 3),
  QDABOVE: m('\\genfrac{}{}{#1}{0}{#2}{#3}', 3),
  QOVERD: m('\\genfrac{#1}{#2}{}{}{#3}{#4}', 4),
  QTOVERD: m('\\genfrac{#1}{#2}{}{1}{#3}{#4}', 4),
  QDOVERD: m('\\genfrac{#1}{#2}{}{0}{#3}{#4}', 4),
  QATOPD: m('\\genfrac{#1}{#2}{0pt}{}{#3}{#4}', 4),
  QTATOPD: m('\\genfrac{#1}{#2}{0pt}{1}{#3}{#4}', 4),
  QDATOPD: m('\\genfrac{#1}{#2}{0pt}{0}{#3}{#4}', 4),
  QABOVED: m('\\genfrac{#1}{#2}{#3}{}{#4}{#5}', 5),
  QTABOVED: m('\\genfrac{#1}{#2}{#3}{1}{#4}{#5}', 5),
  QDABOVED: m('\\genfrac{#1}{#2}{#3}{0}{#4}{#5}', 5),
  ...Object.fromEntries(Object.entries(BIG_OPS).flatMap(([k, v]) => [['d' + k, m(`\\${v}\\limits`)], ['t' + k, m(`\\${v}\\nolimits`)]])),
};

// the same formula in plain LaTeX (for MathML, Markdown, computing and documents not
// from 5.x): the 5.x macros above are replaced by what they stand for
const PLAIN_DEFS = { ...Object.fromEntries(Object.entries(MATH_MACROS).map(([k, v]) => [k, v])), limfunc: m('\\operatorname*{#1}', 1) };
// MathLive's empty input boxes (\placeholder[id]{value}) are not LaTeX: an empty box
// becomes {} (as 5.5 writes it) and a filled one keeps its value
export function dropPlaceholders(tex) {
  if (!tex.includes('\\placeholder')) return tex;
  let out = '';
  let i = 0;
  for (let k; (k = tex.indexOf('\\placeholder', i)) >= 0;) {
    out += tex.slice(i, k);
    let j = k + '\\placeholder'.length;
    if (/[a-zA-Z]/.test(tex[j] || '')) { out += tex.slice(k, j); i = j; continue; }
    while (tex[j] === ' ') j++;
    if (tex[j] === '[') { const c = tex.indexOf(']', j); j = c < 0 ? tex.length : c + 1; }
    while (tex[j] === ' ') j++;
    if (tex[j] === '{') {
      const e = Parser.groupEnd(tex, j);
      out += '{' + dropPlaceholders(tex.slice(j + 1, e - 1)) + '}';
      j = e;
    } else out += '{}';
    i = j;
  }
  return out + tex.slice(i);
}

export function standardTeX(tex) {
  tex = dropPlaceholders(tex);
  let out = '';
  let i = 0;
  while (i < tex.length) {
    const c = tex[i];
    if (c !== '\\') { out += c; i++; continue; }
    const name = (tex.slice(i + 1).match(/^[a-zA-Z]+/) || [''])[0];
    const def = PLAIN_DEFS[name];
    if (!name || !def) { const tok = tex.slice(i).match(/^\\([a-zA-Z]+|.)/)[0]; out += tok; i += tok.length; continue; }
    i += 1 + name.length;
    const args = [];
    for (let k = 0; k < def.args; k++) {
      while (tex[i] === ' ') i++;
      if (tex[i] === '{') { const e = Parser.groupEnd(tex, i); args.push(tex.slice(i + 1, e - 1)); i = e; } else {
        const tok = (tex.slice(i).match(/^\\([a-zA-Z]+|.)|^./s) || [''])[0];
        args.push(tok); i += tok.length;
      }
    }
    if (name === 'allowbreak') { while (tex[i] === ' ') i++; }
    out += def.def.replace(/#(\d)/g, (x, n) => standardTeX(args[n - 1] ?? ''));
  }
  return out;
}

// math as MathLive / standard LaTeX understands it
// \allowbreak, \func and \limfunc stay (MathLive shows them through MATH_MACROS):
// typesetting with 5.x's preamble then breaks lines as 5.x did
export function cleanMath(tex) {
  return tex
    .replace(/\\Greekmath/g, '')
    .replace(/\\unit\{([^}]*)\}/g, '\\mathrm{$1}')
    .replace(/\\U\{([0-9a-fA-F]+)\}/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\tciLaplace/g, '\\mathcal{L}').replace(/\\tciFourier/g, '\\mathcal{F}')
    .replace(/\\d(int|iint|iiint|oint|sum|prod|coprod|bigcup|bigcap|bigoplus|bigotimes|bigvee|bigwedge)(?![a-z])/g, '\\displaystyle\\$1')
    .replace(/\\t(int|iint|iiint|oint|sum|prod|coprod|bigcup|bigcap|bigoplus|bigotimes|bigvee|bigwedge)(?![a-z])/g, '\\textstyle\\$1')
    .replace(/\\QATOP\{/g, '\\genfrac{}{}{0pt}{}{').replace(/\\QDATOP\{/g, '\\genfrac{}{}{0pt}{0}{')
    .replace(/\\QTATOP\{/g, '\\genfrac{}{}{0pt}{1}{')
    .replace(/\\QABOVE\{([^}]*)\}\{/g, '\\genfrac{}{}{$1}{}{')
    .replace(/\s+/g, ' ')
    // trim, but keep the space of a closing "\ " (5.x ends formulas with it): without it
    // the formula would end in "\" and "\$" would no longer close it
    .replace(/^ /, '').replace(/(^|[^\\])((?:\\\\)*) $/, '$1$2');
}

// \name{a}{b}.. (n arguments, a single token counts as one) replaced by fn(args)
function replaceCmd(tex, name, n, fn) {
  const re = new RegExp(`\\\\${name}(?![a-zA-Z])`, 'g');
  let out = '';
  let i = 0;
  for (let m; (m = re.exec(tex));) {
    if (m.index < i) continue;
    let j = m.index + m[0].length;
    const args = [];
    for (let k = 0; k < n; k++) {
      while (/\s/.test(tex[j] || '')) j++;
      if (tex[j] === '{') { const e = Parser.groupEnd(tex, j); args.push(tex.slice(j + 1, e - 1)); j = e; } else {
        const tok = (tex.slice(j).match(/^\\([a-zA-Z]+|.)|^./s) || [''])[0];
        args.push(tok); j += tok.length;
      }
    }
    out += tex.slice(i, m.index) + fn(args);
    i = j;
    re.lastIndex = j;
  }
  return out + tex.slice(i);
}

// one tabular cell inside a formula: $..$ parts are math, the rest is text
function cellMath(cell) {
  let out = '';
  let i = 0;
  const text = (t) => { if (t.trim()) out += `\\text{${t}}`; };
  while (i < cell.length) {
    const k = cell.indexOf('$', i);
    if (k < 0) { text(cell.slice(i)); break; }
    if (k > 0 && cell[k - 1] === '\\') { text(cell.slice(i, k + 1)); i = k + 1; continue; }
    text(cell.slice(i, k));
    const e = Parser.mathEnd(cell, k + 1, '$');
    out += cell.slice(k + 1, e);
    i = e + 1;
  }
  return out;
}

// \begin{tabular}{spec} $a$ & b \\ ... \end{tabular} inside a formula -> an array
function tabularsToArrays(tex) {
  for (let guard = 0; guard < 200; guard++) {
    const k = tex.lastIndexOf('\\begin{tabular');
    if (k < 0) break;
    const star = tex.startsWith('\\begin{tabular*}', k);
    const endTag = star ? '\\end{tabular*}' : '\\end{tabular}';
    const e = tex.indexOf(endTag, k);
    if (e < 0) break;
    let rest = tex.slice(k + (star ? 16 : 15), e);
    if (star) rest = rest.replace(/^\s*\{[^}]*\}/, '');
    rest = rest.replace(/^\s*\[[^\]]*\]/, '');
    const { args, end } = Parser.args(rest, 0, 1);
    const spec = (args[0] || 'l').replace(/[@!>]\{[^}]*\}|<\{[^}]*\}/g, '').replace(/[pmb]\{[^}]*\}/g, 'l');
    const rows = splitRows(rest.slice(end)).map((row) => splitCells(takeRules(row).rest).map((c) => cellMath(c.trim())).join(' & '));
    while (rows.length > 1 && !rows[rows.length - 1].trim()) rows.pop();
    tex = tex.slice(0, k) + `\\begin{array}{${spec}}${rows.join(' \\\\ ')}\\end{array}` + tex.slice(e + endTag.length);
  }
  return tex;
}

// A formula as MathLive and MathML can show it. The stored formula keeps what 5.x
// wrote; only what is shown changes: tables in formulas become arrays, and what
// MathLive does not know (\newline, \dots, rules, \multicolumn, \substack, a picture)
// is shown its nearest way. MathLive also reads \longrightarrow x as an arrow over x.
export function mathForDisplay(tex) {
  if (!/\\(begin\{tabular|begin\{array|hline|cline|toprule|midrule|bottomrule|newline|dots|long(left|right|leftright)arrow|multicolumn|substack|FRAME|ref|pageref|eqref|symbol)(?![a-zA-Z])/.test(tex)) return tex;
  let t = tabularsToArrays(tex);
  t = replaceCmd(t, 'multicolumn', 3, (a) => a[2]);
  t = replaceCmd(t, 'substack', 1, (a) => `\\begin{smallmatrix}${a[0]}\\end{smallmatrix}`);
  t = replaceCmd(t, 'FRAME', 8, () => `\\boxed{\\text{${_t('Picture')}}}`);
  t = replaceCmd(t, '(?:page|eq)?ref', 1, (a) => `\\text{${a[0]}}`);
  // \symbol{126} (a character by its number; 5.x puts the tilde over letters this way)
  t = replaceCmd(t, 'symbol', 1, (a) => { const c = /^\d+$/.test(a[0]) ? String.fromCharCode(+a[0]) : ''; return c === '~' ? '\\sim' : /[\\{}$&#^_%]/.test(c) ? '' : `\\text{${c}}`; });
  return t
    .replace(/\\(hline|toprule|midrule|bottomrule)(?![a-zA-Z])\s*/g, '')
    .replace(/\\cline\s*\{[^}]*\}\s*/g, '')
    .replace(/\\newline(?![a-zA-Z])\s*/g, ' ')
    .replace(/\\dots(?![a-zA-Z])/g, '\\ldots')
    .replace(/\\(longrightarrow|longleftarrow|longleftrightarrow)(?![a-zA-Z])/g, '\\$1{}')
    // an empty array stops MathLive
    .replace(/(\\begin\{array\}\{[^}]*\})\s*(\\end\{array\})/g, '$1{}$2');
}

// \label, \tag, \nonumber of one formula row -> the row without them, and what they said
function rowMarks(tex) {
  let label = null;
  let tag = null;
  let nonumber = false;
  const latex = tex
    .replace(/\\label\s*\{([^}]*)\}/g, (m, k) => { label = k; return ''; })
    .replace(/\\tag\*?\s*\{([^}]*)\}/g, (m, t) => { tag = t; return ''; })
    .replace(/\\(nonumber|notag)\b/g, () => { nonumber = true; return ''; })
    .trim();
  return { latex, label, tag, nonumber };
}

// equation, align, eqnarray, gather, multline (starred or not) -> a math_display node
function displayNode(name, inner) {
  const wrap = DISPLAY_ENVS[name];
  const numberedEnv = !name.endsWith('*') && name !== 'displaymath';
  const tex = cleanMath(inner);
  if (!wrap) {
    const r = rowMarks(tex);
    return schema.nodes.math_display.create({ latex: r.latex, numbered: numberedEnv && !r.nonumber, label: r.label, tag: r.tag });
  }
  let rows = splitRows(tex).map(rowMarks);
  if (rows.length > 1 && !rows[rows.length - 1].latex) rows = rows.slice(0, -1); // a final \\
  const open = wrap === 'array' ? '\\begin{array}{rcl}' : `\\begin{${wrap}}`;
  const latex = `${open}${rows.map((r) => r.latex).join('\\\\ ')}\\end{${wrap}}`;
  if (name.startsWith('multline')) { // one number for the whole formula
    const label = rows.find((r) => r.label)?.label ?? null;
    const tag = rows.find((r) => r.tag != null)?.tag ?? null;
    return schema.nodes.math_display.create({ latex, numbered: numberedEnv && !rows.some((r) => r.nonumber), label, tag, env: name });
  }
  return schema.nodes.math_display.create({
    latex, env: name,
    rows: rows.map((r) => ({ numbered: numberedEnv && !r.nonumber, label: r.label, tag: r.tag })),
  });
}

// "|l|c|p{3cm}|" -> ['l', 'c', 'l'] (one entry per column)
export function columnAligns(spec) {
  const out = [];
  const s = spec.replace(/[@!>]\{[^}]*\}|<\{[^}]*\}/g, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('lcr'.includes(c)) out.push(c);
    else if ('pmbX'.includes(c)) { out.push('l'); if (s[i + 1] === '{') i = s.indexOf('}', i); }
    else if (c === '*') { // *{3}{c}
      const m = s.slice(i).match(/^\*\{(\d+)\}\{([^}]*)\}/);
      if (m) { for (let k = 0; k < +m[1]; k++) out.push(...columnAligns(m[2])); i += m[0].length - 1; }
    }
  }
  return out;
}

// rules written before a row (\hline \cline{..} \toprule ...) -> { rules, rest }
function takeRules(row) {
  const m = row.match(/^(\s*(?:\\(?:hline|toprule|midrule|bottomrule|cline\s*\{[^}]*\}|hhline\s*\{[^}]*\})\s*)*)/);
  return { rules: m[1].trim(), rest: row.slice(m[1].length) };
}

// cells of one row: split at & outside braces, math and nested environments
function splitCells(row) {
  const cells = [];
  let depth = 0;
  let env = 0;
  let math = false;
  let start = 0;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '\\') {
      if (row.startsWith('\\begin{', i)) env++;
      else if (row.startsWith('\\end{', i)) env--;
      i++;
    } else if (c === '$') math = !math;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '&' && !depth && !env && !math) { cells.push(row.slice(start, i)); start = i + 1; }
  }
  cells.push(row.slice(start));
  return cells;
}

export class Parser {
  constructor(theorems) {
    this.theorems = theorems;
    this.title = null;
    this.author = null;
    this.started = false; // any visible block yet (for the 5.5 "big centered line = title" convention)
  }

  // ---------- scanning helpers ----------
  // s[i] === '{' -> index after the matching '}'
  static groupEnd(s, i) {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (c === '\\') { j++; continue; }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return j + 1;
    }
    return s.length;
  }
  static skipSpace(s, i) { while (i < s.length && /[ \t\n]/.test(s[i]) && !/\n[ \t]*\n/.test(s.slice(i, i + 3))) i++; return i; }
  // n mandatory {..} arguments after i (optional [..] skipped) -> { args, end }
  static args(s, i, n) {
    const args = [];
    let j = i;
    let opt = null;
    for (;;) {
      const k = Parser.skipSpace(s, j);
      if (s[k] === '[' && args.length === 0 && opt === null) {
        const close = s.indexOf(']', k);
        opt = s.slice(k + 1, close); j = close + 1; continue;
      }
      if (args.length >= n) break;
      if (s[k] === '{') { const g = Parser.groupEnd(s, k); args.push(s.slice(k + 1, g - 1)); j = g; }
      else if (k < s.length && s[k] !== '}') { // a single token as argument
        if (s[k] === '\\') { const m = s.slice(k).match(/^\\([a-zA-Z]+|.)/); args.push(m[0]); j = k + m[0].length; }
        else { args.push(s[k]); j = k + 1; }
      } else break;
    }
    return { args, opt, end: j };
  }
  static cmdAt(s, i) { const m = s.slice(i).match(/^\\([a-zA-Z]+\*?|[^])/); return m ? m[1] : ''; }
  // \begin{name} at i -> { name, inner, end } using nesting of the same name
  static env(s, i) {
    const name = s.slice(i).match(/^\\begin\s*\{([^}]+)\}/)[1];
    const open = '\\begin{' + name + '}';
    const close = '\\end{' + name + '}';
    let depth = 0;
    let j = i;
    for (;;) {
      const a = s.indexOf(open, j);
      const b = s.indexOf(close, j);
      if (b < 0) return { name, inner: s.slice(i + open.length), end: s.length };
      if (a >= 0 && a < b) { depth++; j = a + open.length; continue; }
      depth--;
      if (depth === 0) return { name, inner: s.slice(i + open.length, b), end: b + close.length };
      j = b + close.length;
    }
  }
  // end of math starting at i with delimiter d -> index of the closing delimiter
  // 5.x puts tables in formulas as \begin{tabular} with $..$ cells, and text with
  // $..$ inside braces (\text{for $x$}): a close inside those does not end the formula.
  // If braces never balance, the first close counts (as before).
  static mathEnd(s, i, close) {
    let depth = 0;
    let tab = 0;
    let first = -1;
    for (let j = i; j < s.length; j++) {
      const at = s.startsWith(close, j);
      if (at && first < 0 && !tab) first = j;
      if (at && !depth && !tab) return j;
      if (s[j] === '\\') {
        if (s.startsWith('\\begin{tabular', j)) tab++;
        else if (s.startsWith('\\end{tabular', j) && tab) tab--;
        j++;
        continue;
      }
      if (s[j] === '{') depth++;
      else if (s[j] === '}' && depth) depth--;
    }
    return first >= 0 ? first : s.length;
  }

  // ---------- blocks ----------
  blocks(s) {
    const out = [];
    let para = '';
    // the top level of a 5.x document: where each block is in s (this.track, see fileParts55)
    const track = this.track && !this.depth ? this.track : null;
    this.depth = (this.depth || 0) + 1;
    let paraFrom = 0, stepFrom = 0;
    // blocks made in the step that started at stepFrom end where the next step starts
    const note = (at) => { if (track) { while (track.length < out.length) track.push({ start: stepFrom, end: at }); stepFrom = at; if (!para) paraFrom = at; } };
    const flush = () => {
      const inl = this.inline(para);
      para = '';
      if (inl.length) { out.push(schema.nodes.paragraph.create(null, inl)); this.started = true; if (track) track.push({ start: paraFrom, end: i }); }
    };
    let i = 0;
    while (i < s.length) {
      note(i);
      const c = s[i];
      if (c === '\n' && /^\n[ \t]*\n/.test(s.slice(i))) { flush(); i = s.slice(i).match(/^\n[ \t\n]*/)[0].length + i; continue; }
      // a line break \\ (maybe \\[2pt]): not the start of a display \[ .. \]
      if (s.startsWith('\\\\', i)) { para += '\\\\'; i += 2; continue; }
      if (s.startsWith('$$', i) || s.startsWith('\\[', i)) {
        const close = s[i] === '$' ? '$$' : '\\]';
        const end = Parser.mathEnd(s, i + 2, close);
        flush();
        const r = rowMarks(cleanMath(s.slice(i + 2, end)));
        out.push(schema.nodes.math_display.create({ latex: r.latex, label: r.label, tag: r.tag }));
        this.started = true;
        i = end + 2;
        continue;
      }
      if (c === '$' || s.startsWith('\\(', i)) { // inline math: keep it in the paragraph text whole
        const close = c === '$' ? '$' : '\\)';
        const end = Parser.mathEnd(s, i + (c === '$' ? 1 : 2), close);
        para += s.slice(i, end + close.length);
        i = end + close.length;
        continue;
      }
      if (c === '{') { const g = Parser.groupEnd(s, i); para += s.slice(i, g); i = g; continue; }
      if (c === '\\') {
        const cmd = Parser.cmdAt(s, i);
        if (cmd === 'begin') {
          const env = Parser.env(s, i);
          let blocks = this.environment(env);
          // a table with text before or after it in the same paragraph sits in the text line
          if (blocks && blocks.length === 1 && blocks[0].type.name === 'table' && /^tabular/.test(env.name)
            && (para.trim() || !/^[ \t]*(\n[ \t]*\n|\n?[ \t]*$)/.test(s.slice(env.end)))) {
            blocks = [schema.nodes.table.create({ ...blocks[0].attrs, inline: true }, blocks[0].content)];
          }
          if (blocks) { flush(); out.push(...blocks); if (blocks.length) this.started = true; } else para += s.slice(i, env.end);
          i = env.end;
          continue;
        }
        const name = cmd.replace(/\*$/, '');
        if (cmd === 'input' || cmd === 'include' || cmd === 'QSubDoc') {
          const { args, end } = Parser.args(s, i + cmd.length + 1, cmd === 'QSubDoc' ? 2 : 1);
          const inner = cmd === 'QSubDoc' ? (args[1] || '').match(/\\(?:input|include)\s*\{([^}]*)\}/) : null;
          const file = (cmd === 'QSubDoc' ? (inner ? inner[1] : (args[0] || '').replace(/^\s*Include\s+/, '')) : args[0] || '').trim();
          flush();
          out.push(schema.nodes.subdoc.create({ file, tex: s.slice(i, end) }));
          i = end;
          continue;
        }
        if (cmd === 'bibliographystyle') { // remembered for \bibliography
          const { args, end } = Parser.args(s, i + cmd.length + 1, 1);
          this.bibStyle = (args[0] || 'plain').trim();
          i = end;
          continue;
        }
        if (cmd === 'bibliography') {
          const { args, end } = Parser.args(s, i + cmd.length + 1, 1);
          flush();
          out.push(schema.nodes.bibtex.create({ style: this.bibStyle || 'plain', files: (args[0] || '').trim() }));
          i = end;
          continue;
        }
        if (name in SECTIONS) {
          const { args, end } = Parser.args(s, i + cmd.length + 1, 1);
          flush();
          // a \label right after the heading names the section: keep it inside the heading
          const lab = s.slice(end).match(/^\s*\\label\s*\{([^}]*)\}/);
          const content = this.inline(args[0] || '');
          if (lab) content.push(schema.nodes.marker.create({ key: lab[1] }));
          out.push(schema.nodes.heading.create({ level: SECTIONS[name], nonum: cmd.endsWith('*') }, content));
          this.started = true;
          i = end + (lab ? lab[0].length : 0);
          continue;
        }
        if (FRONT_CMDS.has(name)) {
          const { args, end } = Parser.args(s, i + cmd.length + 1, 1);
          flush();
          out.push(schema.nodes.front_field.create({ cmd: name }, this.inline(args[0] || '')));
          i = end;
          continue;
        }
        if (name === 'title' || name === 'author' || name === 'date') {
          const { args, end } = Parser.args(s, i + cmd.length + 1, 1);
          this[name] = args[0] || '';
          i = end;
          continue;
        }
        if (name === 'maketitle') {
          flush();
          if (this.title != null) out.push(schema.nodes.title.create({ date: this.date ?? null }, this.inline(this.title)));
          if (this.author) out.push(schema.nodes.env.create({ kind: 'centered' }, [schema.nodes.paragraph.create(null, this.inline(this.author))]));
          this.started = true;
          i += cmd.length + 1;
          continue;
        }
        if (name === 'par') { flush(); i += 4; continue; }
        if (name === 'tableofcontents' || name === 'listoffigures' || name === 'listoftables' || name === 'printindex' || name === 'appendix') {
          flush();
          out.push(name === 'appendix' ? schema.nodes.appendix.create() : schema.nodes.toc.create({ kind: name }));
          i += cmd.length + 1;
          continue;
        }
        if (name === 'caption') { // inside a table or figure
          const { args, end } = Parser.args(s, i + cmd.length + 1, 1);
          flush();
          const content = this.inline(args[0] || '');
          const lab = s.slice(end).match(/^\s*\\label\s*\{([^}]*)\}/);
          if (lab) content.push(schema.nodes.marker.create({ key: lab[1] }));
          out.push(schema.nodes.caption.create(null, content));
          i = end + (lab ? lab[0].length : 0);
          continue;
        }
        if (['bigskip', 'medskip', 'smallskip', 'newpage', 'clearpage'].includes(name)) {
          // kept as a TeX field on its own line, so the PDF keeps 5.x's spacing
          flush();
          out.push(schema.nodes.paragraph.create(null, [schema.nodes.tex_field.create({ tex: '\\' + name })]));
          i += cmd.length + 1;
          continue;
        }
      }
      para += c;
      i++;
    }
    note(i);
    flush();
    this.depth--;
    return out;
  }

  // -> array of blocks, or null to keep the environment as raw TeX inside the paragraph
  environment({ name, inner }) {
    if (name in DISPLAY_ENVS) return [displayNode(name, inner)];
    if (name === 'center' || name === 'flushleft' || name === 'flushright') {
      // 5.5 makes a document's heading as a centered line in a big font
      // (one {\huge ...} group: "{\huge A}\n\n{\Large B}" is two lines, not one heading)
      const whole = inner.trim();
      const big = whole.startsWith('{') && Parser.groupEnd(whole, 0) === whole.length ? whole.match(/^\{\\(LARGE|Large|large|huge|Huge)\s+([^]*)\}$/) : null;
      if (big && !this.started) return [schema.nodes.title.create({ form: big[1] }, this.inline(big[2]))];
      const inside = this.blocks(inner);
      if (!inside.length) return [];
      return [schema.nodes.env.create({ kind: name === 'center' ? 'centered' : name }, inside)];
    }
    if (name === 'itemize' || name === 'enumerate' || name === 'description') {
      const items = this.splitItems(inner).map((it) => {
        const content = this.blocks(it.text);
        if (!content.length || content[0].type.name !== 'paragraph') content.unshift(schema.nodes.paragraph.create());
        return schema.nodes.list_item.create({ label: it.label }, content);
      });
      if (!items.length) return [];
      if (name === 'enumerate') return [schema.nodes.ordered_list.create(null, items)];
      return [schema.nodes.bullet_list.create({ kind: name === 'description' ? 'description' : 'itemize' }, items)];
    }
    if (name === 'verbatim' || name === 'verbatim*') {
      const text = inner.replace(/^\n/, '').replace(/\n$/, '');
      return [schema.nodes.verbatim.create(null, text ? [schema.text(text)] : [])];
    }
    if (name in this.theorems || name === 'proof' || envLabel(name) !== name) {
      // \begin{theorem}[Title]\label{key} ...
      const head = inner.match(/^\s*(?:\[([^\]]*)\])?\s*(?:\\label\s*\{([^}]*)\})?/);
      const inside = this.blocks(inner.slice(head[0].length));
      if (!inside.length || inside[0].type.name !== 'paragraph') inside.unshift(schema.nodes.paragraph.create());
      if (head[2]) inside[0] = inside[0].copy(inside[0].content.addToStart(schema.nodes.marker.create({ key: head[2] })));
      return [schema.nodes.env.create({ kind: name, title: head[1] ?? null }, inside)];
    }
    if (name === 'quote' || name === 'quotation' || name === 'abstract' || name === 'verse') {
      const inside = this.blocks(inner);
      return inside.length ? [schema.nodes.env.create({ kind: name }, inside)] : [];
    }
    if (name === 'thebibliography') {
      const { args, end } = Parser.args(inner, 0, 1);
      const items = [];
      const body = inner.slice(end);
      const re = /\\bibitem\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
      const found = [...body.matchAll(re)];
      found.forEach((m, k) => {
        const text = body.slice(m.index + m[0].length, k + 1 < found.length ? found[k + 1].index : body.length).trim();
        items.push(schema.nodes.bib_item.create({ key: m[2].trim(), label: m[1] ?? null }, this.inline(text.replace(/\s*\n\s*\n\s*/g, ' '))));
      });
      if (!items.length) return [];
      return [schema.nodes.bibliography.create({ widest: args[0] ?? '9' }, items)];
    }
    if (name === 'tabular' || name === 'tabular*' || name === 'tabularx') return [this.tabular(name, inner)];
    if (name === 'table' || name === 'table*' || name === 'figure' || name === 'figure*') {
      const opt = inner.match(/^\s*\[([^\]]*)\]/);
      const body = opt ? inner.slice(opt[0].length) : inner;
      let centered = null;
      let inside = this.blocks(body.replace(/\\centering\b\s*/, () => { centered = 'centering'; return ''; }));
      // a center environment holding the content: keep its content, remember how it was centred
      const blocks = inside.filter((n) => n.type.name !== 'caption');
      if (!centered && blocks.length === 1 && blocks[0].type.name === 'env' && blocks[0].attrs.kind === 'centered') {
        centered = 'center';
        inside = inside.flatMap((n) => (n === blocks[0] ? n.content.content : [n]));
      }
      const caps = inside.filter((n) => n.type.name === 'caption');
      const rest = inside.filter((n) => n.type.name !== 'caption');
      if (!rest.length) rest.push(schema.nodes.paragraph.create());
      const capFirst = caps.length && inside.indexOf(caps[0]) < inside.indexOf(rest[0]);
      const content = capFirst ? [caps[0], ...rest] : [...rest, ...caps.slice(0, 1)];
      return [schema.nodes.float_box.create({ env: name.replace('*', ''), placement: opt ? opt[1] : null, centered }, content)];
    }
    return null; // unknown: kept as a TeX field
  }

  // \begin{tabular}[pos]{colspec} rows \end{tabular} -> a table node
  tabular(name, inner) {
    let rest = inner;
    if (name === 'tabular*' || name === 'tabularx') rest = rest.replace(/^\s*\{[^}]*\}/, ''); // width
    const posM = rest.match(/^\s*\[([^\]]*)\]/); // vertical position
    if (posM) rest = rest.slice(posM[0].length);
    const { args, end } = Parser.args(rest, 0, 1);
    const colspec = args[0] || '';
    const aligns = columnAligns(colspec);
    const rows = splitRows(rest.slice(end));
    // \\[9pt]: extra space below a row, written at the start of the next one's text
    const spaces = rows.map(() => '');
    for (let r = 1; r < rows.length; r++) {
      const sp = rows[r].match(/^\s*\[([^\]]*)\]/);
      if (sp) { spaces[r - 1] = sp[1].trim(); rows[r] = rows[r].slice(sp[0].length); }
    }
    // the text after the last \\ holds only the closing rules
    let after = '';
    const last = rows[rows.length - 1];
    if (!/&/.test(last) && takeRules(last).rest.trim() === '') { after = takeRules(rows.pop()).rules; }
    const tableRows = rows.map((row, r) => {
      const { rules, rest: cellsText } = takeRules(row);
      let col = 0;
      const cells = splitCells(cellsText).map((cellText) => {
        const mc = cellText.trim().match(/^\\multicolumn\s*\{(\d+)\}\s*\{([^}]*)\}\s*\{([^]*)\}\s*$/);
        const colspan = mc ? +mc[1] : 1;
        const align = mc ? columnAligns(mc[2])[0] : aligns[col];
        const content = this.inline(mc ? mc[3] : cellText);
        col += colspan;
        return schema.nodes.table_cell.create({ colspan, align: align || null, spec: mc ? mc[2] : null },
          [schema.nodes.paragraph.create(null, content)]);
      });
      // short rows get empty cells, so every row has the same width
      for (; col < Math.max(aligns.length, 1); col++) cells.push(schema.nodes.table_cell.create({ align: aligns[col] || null }, [schema.nodes.paragraph.create()]));
      return schema.nodes.table_row.create({ before: rules, space: spaces[r] }, cells);
    });
    if (!tableRows.length) tableRows.push(schema.nodes.table_row.create(null, [schema.nodes.table_cell.create(null, [schema.nodes.paragraph.create()])]));
    return schema.nodes.table.create({ colspec, after, pos: posM ? posM[1].trim() || null : null }, tableRows);
  }

  splitItems(s) {
    const items = [];
    let depth = 0;
    let cur = null;
    let i = 0;
    while (i < s.length) {
      if (s.startsWith('\\begin{', i)) depth++;
      else if (s.startsWith('\\end{', i)) depth--;
      // \\, \{, \} ... are not groups (a set \{-1,0\} in an item)
      if (s[i] === '\\' && s[i + 1] && !/[a-zA-Z]/.test(s[i + 1])) { if (cur) cur.text += s.slice(i, i + 2); i += 2; continue; }
      if (s[i] === '{') { const g = Parser.groupEnd(s, i); if (cur) cur.text += s.slice(i, g); i = g; continue; }
      if (depth === 0 && s.startsWith('\\item', i) && !/[a-zA-Z]/.test(s[i + 5] || '')) {
        cur = { text: '', label: null };
        items.push(cur);
        i += 5;
        const k = Parser.skipSpace(s, i);
        if (s[k] === '[') { const close = s.indexOf(']', k); cur.label = s.slice(k + 1, close); i = close + 1; }
        continue;
      }
      if (cur) cur.text += s[i];
      i++;
    }
    return items;
  }

  // ---------- inline ----------
  inline(s, marks = []) {
    const out = [];
    let text = '';
    const flush = () => { if (text) out.push(schema.text(text, marks.map((m) => (typeof m === 'string' ? schema.marks[m].create() : m)))); text = ''; };
    const push = (nodes) => { flush(); out.push(...nodes); };
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '$' || s.startsWith('\\(', i)) {
        const close = c === '$' ? '$' : '\\)';
        const start = i + (c === '$' ? 1 : 2);
        const end = Parser.mathEnd(s, start, close);
        const latex = cleanMath(s.slice(start, end));
        if (latex) push([schema.nodes.math_inline.create({ latex })]);
        i = end + close.length;
        continue;
      }
      if (c === '{') {
        const g = Parser.groupEnd(s, i);
        const inner = s.slice(i + 1, g - 1);
        const sw = inner.match(/^\s*\\([a-zA-Z]+)\b\s*/);
        let m = marks;
        let body = inner;
        const col = inner.match(/^\s*\\color\s*\{([^}]*)\}\s*/);
        if (sw && (SWITCH_MARKS[sw[1]] || SIZES.has(sw[1]))) {
          m = SWITCH_MARKS[sw[1]] ? withMark(marks, SWITCH_MARKS[sw[1]]) : sw[1] === 'normalsize' ? marks : withMark(marks, sizeMark(sw[1]));
          body = inner.slice(sw[0].length);
        } else if (col) {
          m = withMark(marks, schema.marks.color.create({ color: col[1].trim() }));
          body = inner.slice(col[0].length);
        }
        push(this.inline(body, m));
        i = g;
        continue;
      }
      if (c === '\\') {
        const cmd = Parser.cmdAt(s, i);
        const after = i + 1 + cmd.length;
        if (cmd === '\\') { // line break, optional [length]
          const k = s.slice(after).match(/^\*?\s*(\[[^\]]*\])?\s*/); // TeX skips the spaces after it
          push([schema.nodes.hard_break.create()]);
          i = after + k[0].length;
          continue;
        }
        if (cmd in TEXT_CHARS) { text += TEXT_CHARS[cmd]; i = after; continue; }
        if (cmd in TEXT_SYMBOLS) { text += TEXT_SYMBOLS[cmd]; i = after; if (s[i] === ' ' || (s[i] === '{' && s[i + 1] === '}')) i += s[i] === ' ' ? 1 : 2; continue; }
        if (SKIP_CMDS.has(cmd)) { i = Parser.skipSpace(s, after); continue; }
        if (cmd in SKIP_ARG_CMDS) { i = Parser.args(s, after, SKIP_ARG_CMDS[cmd]).end; continue; }
        if (cmd in ARG_MARKS) {
          const { args, end } = Parser.args(s, after, 1);
          push(this.inline(args[0] || '', withMark(marks, ARG_MARKS[cmd])));
          i = end;
          continue;
        }
        if (cmd === 'U') { const { args, end } = Parser.args(s, after, 1); text += String.fromCodePoint(parseInt(args[0], 16) || 63); i = end; continue; }
        // an accent on a letter, \'{e} or \'e: é (a Big5 file writes é so, see tex55file.js)
        if (cmd in TEXT_ACCENTS && /^(\{[A-Za-z]\}|[A-Za-z])/.test(s.slice(after))) {
          const two = s[after] === '{';
          text += (s[after + (two ? 1 : 0)] + TEXT_ACCENTS[cmd]).normalize('NFC');
          i = after + (two ? 3 : 1);
          continue;
        }
        if (cmd === 'TEXTsymbol') { const { args, end } = Parser.args(s, after, 1); text += args[0].replace(/^\\backslash$/, '\\'); i = end; continue; }
        if (cmd === 'QTR') { // 5.x text tag: \QTR{tag}{text}
          const { args, end } = Parser.args(s, after, 2);
          const tag = (args[0] || '').trim();
          const mk = ARG_MARKS[tag] || SWITCH_MARKS[tag] || (SIZES.has(tag) && tag !== 'normalsize' ? sizeMark(tag) : null);
          push(this.inline(args[1] || '', mk ? withMark(marks, mk) : marks));
          i = end;
          continue;
        }
        if (cmd === 'textcolor') {
          const { args, end } = Parser.args(s, after, 2);
          push(this.inline(args[1] || '', withMark(marks, schema.marks.color.create({ color: (args[0] || '').trim() }))));
          i = end;
          continue;
        }
        if (cmd === 'hyperref' && /^\s*\[/.test(s.slice(after))) { // hyperref package: \hyperref[label]{text}
          const { args, opt, end } = Parser.args(s, after, 1);
          push(this.inline(args[0] || '', [...marks, schema.marks.link.create({ href: '#' + (opt || '').trim() })]));
          i = end;
          continue;
        }
        if (cmd === 'msihyperref' || cmd === 'hyperref') { // 5.x: {shown text}{printed before}{printed after}{marker or address}
          const { args, end } = Parser.args(s, after, 4);
          const target = (args[3] || '').trim();
          const href = /^[a-z]+:|^www\./i.test(target) ? target : '#' + target;
          push(this.inline(args[0] || '', [...marks, schema.marks.link.create({ href, sw5: { cmd, before: args[1] || '', after: args[2] || '' } })]));
          i = end;
          continue;
        }
        if (cmd === 'href') {
          const { args, end } = Parser.args(s, after, 2);
          push(this.inline(args[1] || '', [...marks, schema.marks.link.create({ href: (args[0] || '').replace(/\\([#%&_~])/g, '$1') })]));
          i = end;
          continue;
        }
        if (cmd === 'url' || cmd === 'hyperlink') {
          const { args, end } = Parser.args(s, after, cmd === 'url' ? 1 : 2);
          const link = cmd === 'url' ? schema.marks.link.create({ href: args[0] || '', kind: 'url' }) : schema.marks.link.create({ href: '#' + (args[0] || '') });
          push(cmd === 'url' ? [schema.text(args[0] || ' ', [...marks.map((m) => (typeof m === 'string' ? schema.marks[m].create() : m)), link])] : this.inline(args[1] || '', [...marks, link]));
          i = end;
          continue;
        }
        if (cmd === 'text' || cmd === 'mbox' || cmd === 'textrm' || cmd === 'textnormal' || cmd === 'textup') {
          const { args, end } = Parser.args(s, after, 1); push(this.inline(args[0] || '', marks)); i = end; continue;
        }
        if (cmd === 'label') { const { args, end } = Parser.args(s, after, 1); push([schema.nodes.marker.create({ key: args[0] || '' })]); i = end; continue; }
        if (cmd === 'ref' || cmd === 'eqref' || cmd === 'pageref') {
          const { args, end } = Parser.args(s, after, 1);
          push([schema.nodes.ref.create({ key: args[0] || '', kind: cmd })]);
          i = end;
          continue;
        }
        if (/^(no)?cite[tp]?\*?$/.test(cmd)) {
          const { args, opt, end } = Parser.args(s, after, 1);
          push([schema.nodes.cite.create({ keys: (args[0] || '').split(',').map((k) => k.trim()).join(','), note: opt, kind: cmd === 'nocite' ? 'nocite' : 'cite' })]);
          i = end;
          continue;
        }
        if (cmd === 'index') {
          const { args, end } = Parser.args(s, after, 1);
          push([schema.nodes.index_entry.create({ entry: args[0] || '' })]);
          i = end;
          continue;
        }
        if (cmd === 'footnote' || cmd === 'marginpar' || cmd === 'thanks') {
          const { args, end } = Parser.args(s, after, 1);
          const inner = this.inline(args[0] || '').filter((n) => schema.nodes.note.contentMatch.matchType(n.type) || n.isText);
          push([schema.nodes.note.create({ kind: { footnote: 'footnote', marginpar: 'margin', thanks: 'thanks' }[cmd] }, inner)]);
          i = end;
          continue;
        }
        if (cmd === 'FRAME') { // a 5.x picture or plot (graphics.js)
          const { args, end } = Parser.args(s, after, 8);
          push([schema.nodes.image.create(frameAttrs(args, s.slice(i, end)))]);
          i = end;
          continue;
        }
        if (cmd === 'includegraphics' || cmd === 'includegraphics*') {
          const { args, opt, end } = Parser.args(s, after, 1);
          push([schema.nodes.image.create(includeAttrs(opt, args[0] || ''))]);
          i = end;
          continue;
        }
        if (cmd === 'HTML') { const { args, end } = Parser.args(s, after, 1); push([schema.nodes.html_field.create({ html: args[0] || '' })]); i = end; continue; }
        if (cmd === 'begin') { const env = Parser.env(s, i); push([schema.nodes.tex_field.create({ tex: s.slice(i, env.end) })]); i = env.end; continue; }
        // anything else: keep the command and its arguments as a TeX field (a control
        // word eats the spaces after it, as in TeX)
        let end = /^[a-zA-Z]/.test(cmd) ? after + s.slice(after).match(/^[ \t]*/)[0].length : after;
        while (s[end] === '{' || (s[end] === '[' && end === after)) end = s[end] === '{' ? Parser.groupEnd(s, end) : s.indexOf(']', end) + 1;
        // \newline{} is \newline (the {} only stops it eating a following letter; saving adds it again)
        push([schema.nodes.tex_field.create({ tex: s.slice(i, end).replace(/[ \t]+$/, '').replace(/^(\\[a-zA-Z]+)\{\}$/, '$1') })]);
        i = end;
        continue;
      }
      if (c === '~') { text += ' '; i++; continue; }
      if (c === '`' && s[i + 1] === '`') { text += '“'; i += 2; continue; }
      if (c === "'" && s[i + 1] === "'") { text += '”'; i += 2; continue; }
      if (c === '-' && s.startsWith('---', i)) { text += '—'; i += 3; continue; }
      if (c === '-' && s[i + 1] === '-') { text += '–'; i += 2; continue; }
      if (c === '}') { i++; continue; }
      if (/\s/.test(c)) { if (!text.endsWith(' ') && (text || out.length)) text += ' '; i++; continue; }
      text += c;
      i++;
    }
    flush();
    // trim the paragraph's outer spaces
    if (out.length && out[out.length - 1].isText) {
      const t = out[out.length - 1].text.replace(/\s+$/, '');
      out[out.length - 1] = t ? out[out.length - 1].withText(t) : null;
      if (!out[out.length - 1]) out.pop();
    }
    return out;
  }
}
