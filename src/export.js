import { envLabel, PLAIN_ENVS } from './schema.js';
import { standardTeX, dropPlaceholders, columnAligns, stripComments, Parser as Parser55 } from './tex55.js';
import { frameAttrs, includeAttrs } from './graphics.js';
import { TableMap } from 'prosemirror-tables';
import { splitRows } from './numbering.js';
import { _t } from './i18n.js';
import { readDefs, withoutDefs } from './texmacros.js';

// ---------- LaTeX ----------
const SECTION_CMD = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];
const ESC = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '#': '\\#', $: '\\$', '%': '\\%', '&': '\\&',
  _: '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
// special spaces and the soft hyphen typed with 5.x's keys come back as their TeX commands
const SPACES_TEX = { '\u00a0': '~', '\u2009': '\\,', '\u2005': '\\;', '\u00ad': '\\-',
  // dashes and quotes typed the TeX way (-- --- `` '') are read as these characters: write them back the same way,
  // so a 5.x file keeps plain ASCII there and needs no code page for them
  '\u2013': '--', '\u2014': '---', '\u201c': '``', '\u201d': "''" };
const escTex = (s) => s.replace(/[\\{}#$%&_~^]/g, (c) => ESC[c]).replace(/[\u00a0\u2009\u2005\u00ad\u2013\u2014\u201c\u201d]/g, (c) => SPACES_TEX[c]);

// The Chinese font: the first of these the computer has. An older TeX (MiKTeX 2.9, for example)
// has no \IfFontExistsTF; it gets PMingLiU, which Windows has.
// PMingLiU has no bold: headings and \textbf are drawn thicker (AutoFakeBold), as Word does
const CJK_FONT = `\\ifdefined\\IfFontExistsTF
\\IfFontExistsTF{Noto Serif CJK TC}{\\setCJKmainfont{Noto Serif CJK TC}}{%
  \\IfFontExistsTF{PMingLiU}{\\setCJKmainfont[AutoFakeBold=2.5]{PMingLiU}}{\\setCJKmainfont{Microsoft JhengHei}}}
\\else\\setCJKmainfont[AutoFakeBold=2.5]{PMingLiU}\\fi
`;

// packages from the .sci preamble that a normal TeX installation has
const SAFE_PACKAGES = new Set(['amsfonts', 'xcolor', 'ragged2e', 'tabulary', 'bm', 'url', 'longtable', 'multicol',
  'enumitem', 'booktabs', 'array', 'wrapfig', 'boxedminipage', 'fancyhdr', 'geometry', 'setspace', 'float']);

const MARK_TEX = { bold: ['\\textbf{', '}'], italic: ['\\emph{', '}'], code: ['\\texttt{', '}'],
  sup: ['\\textsuperscript{', '}'], sub: ['\\textsubscript{', '}'], smallcaps: ['\\textsc{', '}'],
  sans: ['\\textsf{', '}'], underline: ['\\underline{', '}'] };
// \textcolor needs xcolor; a #rrggbb colour is written with [HTML]
function colorTex(c, s) {
  usedXcolor = true;
  return c.startsWith('#') ? `\\textcolor[HTML]{${c.slice(1).toUpperCase()}}{${s}}` : `\\textcolor{${c}}{${s}}`;
}
let usedXcolor = false;
let usedIndex = false; // \index needs \makeindex (and makeidx for \printindex)

const isFrame = (tex) => tex.startsWith('\\FRAME');

// picture files the TeX run will have: path in the document -> file name for \includegraphics
// (set by toLatex from opts.files; main.js copies those files next to the .tex)
let texFiles = new Map();

// \includegraphics, or an empty box of the picture's size when its file is not at hand
// (so the pages still break as they would with the picture)
function graphicTex(a) {
  const file = texFiles.get(a.path);
  const w = a.texw || (a.width ? (a.width / 96).toFixed(3) + 'in' : null);
  const h = a.texh || (a.height ? (a.height / 96).toFixed(3) + 'in' : null);
  if (!file) {
    const label = '\\small [' + escTex((a.path || 'graphic').split('/').pop()) + ']';
    return w && h ? `\\fbox{\\parbox[c][${h}][c]{${w}}{\\centering${label}}}` : `\\fbox{${label}}`;
  }
  const keepOpts = a.opts && !a.frame && includeAttrs(a.opts, a.path).width === a.width && includeAttrs(a.opts, a.path).height === a.height;
  const opts = keepOpts ? a.opts : [w && `width=${w}`, h && `height=${h}`].filter(Boolean).join(',');
  return `\\includegraphics${opts ? `[${opts}]` : ''}{${file}}`;
}

// A picture: a 5.x frame (kept as written, with \includegraphics added for TeX
// installations other than 5.x's own), or a picture as LaTeX writes it
function imageTex(node) {
  const a = node.attrs;
  if (doc55) {
    const frame = frameTexOf(a);
    if (!texFiles.has(a.path)) return frame;
    // \GRAPHIC raises its content by the height: lower the picture by as much
    doc55.graphicx = true;
    const pic = `\\raisebox{-${a.texh || '0pt'}}{${graphicTex(a)}}`;
    return frame.replace(/\}\s*$/, pic + '}');
  }
  const pic = graphicTex(a);
  if (a.place === 'display') return `\n\\begin{center}\n${pic}\n\\end{center}\n`;
  if (a.place === 'float') {
    const env = a.floattype === 'table' ? 'table' : 'figure';
    return `\n\\begin{${env}}${a.placement ? `[${a.placement}]` : ''}\n\\centering\n${pic}\n\\caption{${a.caption || ''}}${a.label ? `\\label{${a.label}}` : ''}\n\\end{${env}}\n`;
  }
  return pic;
}

// the frame as 5.x wrote it, or a new one when the picture's settings were changed here
function frameTexOf(a) {
  if (a.frame) {
    const args = Parser55.args(a.frame, a.frame.indexOf('{'), 8).args;
    const old = frameAttrs(args, a.frame);
    const same = ['path', 'texw', 'texh', 'place', 'placement', 'caption', 'label'].every((k) => (old[k] || null) === (a[k] || null));
    if (same) return a.frame;
    const flags = (a.place === 'float' ? 'f' : a.place === 'display' ? 'd' : 'i') + (a.placement || 'tbp') + 'F' + (/X/.test(args[0]) ? 'X' : '') + (/U/.test(args[0]) ? 'U' : '');
    const body = old.path === a.path ? args[7] : newSpecial(a);
    return `\\FRAME{${flags}}{${a.texw}}{${a.texh}}{${args[3] || '0pt'}}{${a.caption ? `\\Qcb{${a.caption}}` : ''}}{${a.label ? `\\Qlb{${a.label}}` : ''}}{${args[6] || a.path.split('/').pop()}}{${body}}`;
  }
  const w = a.texw || (a.width ? (a.width / 96).toFixed(4) + 'in' : '2in');
  const h = a.texh || (a.height ? (a.height / 96).toFixed(4) + 'in' : '1.5in');
  const flags = (a.place === 'float' ? 'f' : a.place === 'display' ? 'd' : 'i') + (a.placement || 'tbp') + 'FU';
  return `\\FRAME{${flags}}{${w}}{${h}}{0pt}{${a.caption ? `\\Qcb{${a.caption}}` : ''}}{${a.label ? `\\Qlb{${a.label}}` : ''}}{${a.path.split('/').pop()}}{${newSpecial({ ...a, texw: w, texh: h })}}`;
}
const newSpecial = (a) => `\\special{language "Scientific Word";type "GRAPHIC";maintain-aspect-ratio TRUE;display "USEDEF";valid_file "F";width ${a.texw};height ${a.texh};depth 0pt;filename '${a.path}';file-properties "XNPEU";}`;

// a link: \href / \url to a web address, \hyperref[marker] inside the document;
// a 5.x hypertext link keeps its own command (printed text before and after)
function linkTex(a, s) {
  const inner = a.href.startsWith('#') ? a.href.slice(1) : null;
  if (a.sw5 && doc55) return `\\${a.sw5.cmd}{${s}}{${a.sw5.before}}{${a.sw5.after}}{${inner ?? a.href}}`;
  // a 5.x document has 5.x's own \hyperref (tcilatex), not the hyperref package
  if (doc55 && !doc55.hyperref) return inner != null ? `\\hyperref{${s}}{}{}{${inner}}` : s;
  if (inner != null) return `\\hyperref[${inner}]{${s}}`;
  if (a.kind === 'url') return `\\url{${a.href}}`;
  return `\\href{${a.href.replace(/[#%&_~]/g, '\\$&')}}{${s}}`;
}

function inlineTex(node) {
  let out = '';
  node.forEach((child) => {
    let s;
    if (child.isText) s = escTex(child.text);
    else if (child.type.name === 'math_inline') s = '$' + (doc55 ? formula55(child.attrs.latex) : standardTeX(child.attrs.latex)) + '$';
    else if (child.type.name === 'tex_field') s = child.attrs.tex + (/\\[a-zA-Z]+$/.test(child.attrs.tex) ? '{}' : '');
    else if (child.type.name === 'html_field') s = doc55 ? `%TCIMACRO{\\HTML{${child.attrs.html}}}%\n%BeginExpansion\n%EndExpansion\n` : ''; // TeX does not use it
    else if (child.type.name === 'hard_break') s = '\\\\\n';
    else if (child.type.name === 'marker') s = `\\label{${child.attrs.key}}`;
    else if (child.type.name === 'ref') s = `\\${child.attrs.kind}{${child.attrs.key}}`;
    else if (child.type.name === 'image') s = imageTex(child);
    else if (child.type.name === 'note') s = `\\${{ margin: 'marginpar', thanks: 'thanks' }[child.attrs.kind] || 'footnote'}{${inlineTex(child)}}`;
    else if (child.type.name === 'index_entry') { s = `\\index{${child.attrs.entry}}`; usedIndex = true; }
    else if (child.type.name === 'cite') s = `\\${child.attrs.kind === 'nocite' ? 'nocite' : 'cite'}${child.attrs.note ? `[${child.attrs.note}]` : ''}{${child.attrs.keys}}`;
    else s = '';
    for (const m of child.marks) {
      if (m.type.name === 'link') s = linkTex(m.attrs, s);
      else if (m.type.name === 'size') s = `{\\${m.attrs.size} ${s}}`;
      else if (m.type.name === 'color') s = colorTex(m.attrs.color, s);
      else if (MARK_TEX[m.type.name]) s = MARK_TEX[m.type.name][0] + s + MARK_TEX[m.type.name][1];
    }
    out += s;
  });
  return out;
}

// set while exporting a Scientific Word 5.x document (see toLatex)
// 5.x writes an Exam Builder formula \FORMULA{expr}{value}{operation} as a TCI macro
// (a comment 5.x reads) with the value as its expansion
export function formula55(latex) {
  latex = dropPlaceholders(latex);
  if (!latex.includes('\\FORMULA{')) return latex;
  let out = '';
  let i = 0;
  for (let k; (k = latex.indexOf('\\FORMULA{', i)) >= 0;) {
    const args = [];
    let j = k + '\\FORMULA'.length;
    for (let n = 0; n < 3 && latex[j] === '{'; n++) {
      let depth = 0;
      const start = j;
      for (; j < latex.length; j++) {
        if (latex[j] === '\\') { j++; continue; }
        if (latex[j] === '{') depth++;
        else if (latex[j] === '}' && --depth === 0) break;
      }
      args.push(latex.slice(start + 1, j));
      j++;
    }
    if (args.length < 3) { out += latex.slice(i, j); i = j; continue; }
    out += latex.slice(i, k) + `%\n%TCIMACRO{${latex.slice(k, j)}}%\n%BeginExpansion\n${args[1]}%\n%EndExpansion\n`;
    i = j;
  }
  return out + latex.slice(i);
}

let doc55 = null;

// \tag / \label / \nonumber for one numbered row
const rowMarksTex = (r, envNumbers) => (r.tag != null ? `\\tag{${r.tag}}` : '') + (r.label ? `\\label{${r.label}}` : '')
  + (envNumbers && !r.numbered && r.tag == null ? '\\nonumber' : '');

// A displayed formula with its numbering: \[..\], equation, or its own multi-row environment
function displayTex(node) {
  const a = node.attrs;
  const tex = (x) => (doc55 ? formula55(x) : standardTeX(x));
  const m = a.latex.match(/^\s*\\begin\{(aligned|gathered|array|alignedat)\}(\{[^}]*\})?([^]*)\\end\{\1\}\s*$/);
  if (a.env && m) {
    const env = a.env;
    const envNumbers = !env.endsWith('*');
    const rows = splitRows(m[3]);
    const body = env.startsWith('multline')
      ? rows.join(' \\\\\n') + rowMarksTex({ numbered: a.numbered, label: a.label, tag: a.tag }, envNumbers)
      : rows.map((row, i) => row + rowMarksTex((a.rows && a.rows[i]) || { numbered: envNumbers }, envNumbers)).join(' \\\\\n');
    return `\\begin{${env}}\n${tex(body)}\n\\end{${env}}`;
  }
  const rows = a.rows || [{ numbered: a.numbered, label: a.label, tag: a.tag }];
  const first = rows.find((r) => r.numbered || r.tag != null || r.label) || rows[0];
  if (first.numbered || first.tag != null) return `\\begin{equation}\n${tex(a.latex)}${rowMarksTex(first, true)}\n\\end{equation}`;
  return `\\[\n${tex(a.latex)}${first.label ? `\\label{${first.label}}` : ''}\n\\]`;
}

// A table as a tabular environment. The column spec of the file is kept while the
// table still has that many columns; otherwise it is rebuilt from the cells.
function tableTex(node) {
  const map = TableMap.get(node);
  let spec = node.attrs.colspec;
  if (!spec || columnAligns(spec).length !== map.width) {
    const ruled = /\|/.test(spec || '');
    const aligns = [];
    for (let c = 0; c < map.width; c++) {
      const cell = node.nodeAt(map.map[c]);
      aligns.push((cell.attrs.colspan === 1 && cell.attrs.align) || 'l');
    }
    spec = ruled ? '|' + aligns.join('|') + '|' : aligns.join('');
  }
  const colAligns = columnAligns(spec);
  const paraCols = /[pmbX]\{|X/.test(spec);
  const lines = [];
  node.forEach((row, rowOff, r) => {
    const cells = [];
    for (let c = 0; c < map.width;) {
      const pos = map.map[r * map.width + c];
      const cell = node.nodeAt(pos);
      const { colspan, rowspan } = cell.attrs;
      const top = map.findCell(pos).top === r;
      // several paragraphs in a cell: \par only works in a paragraph column (p{..})
      let s = top ? cell.content.content.map(inlineTex).join(paraCols ? ' \\par ' : ' ') : '';
      if (top && rowspan > 1) s = `\\multirow{${rowspan}}{*}{${s}}`;
      const ownSpec = cell.attrs.spec || (cell.attrs.align && cell.attrs.align !== colAligns[c] ? cell.attrs.align : null);
      if (colspan > 1 || (ownSpec && ownSpec !== colAligns[c])) {
        const inner = cell.attrs.spec || cell.attrs.align || 'c';
        const bars = /\|/.test(spec) && !cell.attrs.spec ? (c === 0 ? '|' : '') + inner + '|' : inner;
        s = `\\multicolumn{${colspan}}{${bars}}{${s}}`;
      }
      cells.push(s);
      c += colspan;
    }
    lines.push((row.attrs.before ? row.attrs.before + '\n' : '') + cells.join(' & ') + ' \\\\' + (row.attrs.space ? `[${row.attrs.space}]` : ''));
  });
  return `\\begin{tabular}${node.attrs.pos ? `[${node.attrs.pos}]` : ''}{${spec}}\n${lines.join('\n')}${node.attrs.after ? '\n' + node.attrs.after : ''}\n\\end{tabular}`;
}

// A table or figure environment; the label goes after \caption
function floatTex(node, envs) {
  const a = node.attrs;
  const capTex = (c) => {
    let label = '';
    const parts = [];
    c.forEach((x) => { if (x.type.name === 'marker') label += `\\label{${x.attrs.key}}`; else parts.push(x); });
    return `\\caption{${inlineTex(c.copy(c.content.constructor.from(parts)))}}${label}\n`;
  };
  let before = '', body = '', after = '';
  node.forEach((c) => {
    if (c.type.name !== 'caption') body += blockTex(c, envs).replace(/\n+$/, '\n');
    else if (body) after += capTex(c);
    else before += capTex(c);
  });
  // a center environment holds the table only; the caption stays outside, as written
  if (a.centered === 'center') body = `\\begin{center}\n${body}\\end{center}\n`;
  let inner = before + body + after;
  if (a.centered === 'centering') inner = '\\centering\n' + inner;
  return `\\begin{${a.env}}${a.placement ? `[${a.placement}]` : ''}\n${inner}\\end{${a.env}}\n\n`;
}

function blockTex(node, envs) {
  switch (node.type.name) {
    case 'paragraph': return inlineTex(node) + '\n\n';
    case 'title':
      if (node.attrs.form) return `\\begin{center}\n{\\${node.attrs.form} ${inlineTex(node)}}\n\\end{center}\n\n`;
      if (doc55) return `\\title{${inlineTex(node)}}\n${doc55.author55 != null ? `\\author{${doc55.author55}}\n` : ''}${node.attrs.date != null ? `\\date{${node.attrs.date}}\n` : ''}\\maketitle\n\n`;
      return `\\title{${inlineTex(node)}}\n\\date{${node.attrs.date ?? ''}}\n\\maketitle\n\n`;
    case 'heading': return `\\${SECTION_CMD[node.attrs.level] || 'section'}${node.attrs.nonum ? '*' : ''}{${inlineTex(node)}}\n\n`;
    case 'math_display': return displayTex(node) + '\n\n';
    case 'table': return tableTex(node) + '\n\n';
    case 'bibliography': {
      let s = `\\begin{thebibliography}{${node.attrs.widest}}\n`;
      node.forEach((it) => { s += `\n\\bibitem${it.attrs.label != null ? `[${it.attrs.label}]` : ''}{${it.attrs.key}} ${inlineTex(it)}\n`; });
      return s + '\n\\end{thebibliography}\n\n';
    }
    case 'toc': return `\\${node.attrs.kind}\n\n`;
    case 'subdoc': return (node.attrs.tex || `\\input{${node.attrs.file}}`) + '\n\n';
    case 'front_field': return `\\${node.attrs.cmd}{${inlineTex(node)}}\n\n`;
    case 'appendix': return '\\appendix\n\n';
    case 'bibtex': return `\\bibliographystyle{${node.attrs.style}}\n\\bibliography{${node.attrs.files}}\n\n`;
    case 'float_box': return floatTex(node, envs);
    case 'env': {
      if (node.attrs.kind === 'centered' && doc55?.skip === node) return '';
      if (node.attrs.kind === 'centered') return `\\begin{center}\n${childrenTex(node, envs).trim()}\n\\end{center}\n\n`;
      if (!PLAIN_ENVS.has(node.attrs.kind)) envs.add(node.attrs.kind);
      const title = node.attrs.title ? `[${node.attrs.title}]` : '';
      return `\\begin{${node.attrs.kind}}${title}\n${childrenTex(node, envs).trim()}\n\\end{${node.attrs.kind}}\n\n`;
    }
    case 'bullet_list': case 'ordered_list': {
      const env = node.type.name === 'ordered_list' ? 'enumerate' : node.attrs.kind === 'description' ? 'description' : 'itemize';
      let s = `\\begin{${env}}\n`;
      node.forEach((li) => { s += '\\item' + (li.attrs.label != null ? `[${li.attrs.label}]` : '') + ' ' + childrenTex(li, envs).trim() + '\n'; });
      return s + `\\end{${env}}\n\n`;
    }
    case 'verbatim': return `\\begin{verbatim}\n${node.textContent}\n\\end{verbatim}\n\n`;
    default: return childrenTex(node, envs);
  }
}

function childrenTex(node, envs) {
  let s = '';
  let prev = null;
  node.forEach((c) => {
    // 5.x: a display formula sits inside its paragraph; text right after it continues
    // that paragraph (no indent), as in the original
    if (doc55 && prev && ((prev.type.name === 'paragraph' && c.type.name === 'math_display')
      || (prev.type.name === 'math_display' && c.type.name === 'paragraph')
      // and displays one after another stay in one paragraph (a blank line between
      // them would add an empty line of space)
      || (prev.type.name === 'math_display' && c.type.name === 'math_display')
      // a table that sat in the text line goes back there
      || (prev.type.name === 'table' && prev.attrs.inline && c.type.name === 'paragraph')
      || (c.type.name === 'table' && c.attrs.inline && prev.type.name === 'paragraph'))) s = s.replace(/\n+$/, '\n');
    s += blockTex(c, envs);
    prev = c;
  });
  return s;
}

// opts.files: Map(picture path -> file name the TeX run has), see texFiles
export function toLatex(doc, meta = {}, opts = {}) {
  texFiles = opts.files || new Map();
  usedXcolor = false;
  usedIndex = false;
  if (meta.preamble55) return toLatex55(doc, meta);
  const envs = new Set();
  const body = childrenTex(doc, envs);
  const hasChapter = (() => { let f = false; doc.descendants((n) => { if (n.type.name === 'heading' && n.attrs.level <= 1) f = true; }); return f; })();
  const cls = meta.documentclass && /^(article|book|report|amsart|amsbook)$/.test(meta.documentclass)
    ? meta.documentclass : (hasChapter ? 'book' : 'article');
  // amsthm already defines proof; older Scientific Word preambles define it again
  const pre = (meta.preambleTeX || '').replace(/\\newenvironment\s*\{proof\}/g, '\\renewenvironment{proof}');
  // commands used in TeX fields that may come from Scientific Word's own style files:
  // define them as empty when this TeX installation does not have them
  const cmds = new Set();
  doc.descendants((n) => {
    if (n.type.name === 'tex_field' && !isFrame(n.attrs.tex)) for (const m of n.attrs.tex.matchAll(/\\([a-zA-Z]+)/g)) cmds.add(m[1]);
  });
  const provide = [...cmds].map((c) => `\\providecommand{\\${c}}{}`).join('\n');
  const theorems = [...envs].filter((k) => !new RegExp('\\\\newtheorem\\s*\\{' + k + '\\}').test(pre))
    .map((k) => `\\newtheorem{${k}}{${envLabel(k)}}`).join('\n');
  const pkgs = (meta.packages || []).filter((p) => SAFE_PACKAGES.has(p));
  for (const p of tablePackages(body, pre)) if (!pkgs.includes(p)) pkgs.push(p);
  if (usedXcolor && !pkgs.includes('xcolor') && !/\{[^}]*\bx?color\b[^}]*\}/.test(pre)) pkgs.push('xcolor');
  const indexSetup = (usedIndex || /\\printindex/.test(body)) && !/\\makeindex/.test(pre) ? '\\usepackage{makeidx}\n\\makeindex\n' : '';
  return `\\documentclass{${cls}}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{graphicx}
\\usepackage{xeCJK}
${CJK_FONT}${pkgs.map((p) => `\\usepackage{${p}}`).join('\n')}
${indexSetup}\\usepackage{hyperref}
\\renewcommand{\\proofname}{${envLabel('proof')}}
${pre}
${theorems}
${provide}

\\begin{document}

${body.trim()}

\\end{document}
`;
}

// packages the tables need that the preamble does not load
function tablePackages(body, pre) {
  const out = [];
  const loads = (p) => new RegExp('\\\\usepackage(\\[[^\\]]*\\])?\\{[^}]*\\b' + p + '\\b').test(pre || '');
  if (body.includes('\\multirow') && !loads('multirow')) out.push('multirow');
  if (/\\(toprule|midrule|bottomrule)/.test(body) && !loads('booktabs')) out.push('booktabs');
  return out;
}

// ---------- Markdown (for AI tools) ----------
const MARK_MD = { bold: '**', italic: '*', code: '`' };

function inlineMd(node) {
  let out = '';
  node.forEach((child) => {
    let s;
    if (child.isText) s = child.text;
    else if (child.type.name === 'math_inline') s = '$' + standardTeX(child.attrs.latex) + '$';
    else if (child.type.name === 'ref') s = `[→${child.attrs.key}]`;
    else if (child.type.name === 'tex_field') s = '`' + child.attrs.tex + '`';
    else if (child.type.name === 'html_field') s = child.attrs.html;
    else if (child.type.name === 'hard_break') s = '  \n';
    else if (child.type.name === 'image') s = `![${child.attrs.caption || ''}](${child.attrs.path})`;
    else if (child.type.name === 'note') s = `^[${child.attrs.kind === 'margin' ? _t('Margin note: ') : ''}${inlineMd(child)}]`;
    else if (child.type.name === 'cite') s = child.attrs.kind === 'nocite' ? '' : `[${child.attrs.keys.split(',').map((k) => '@' + k).join('; ')}${child.attrs.note ? ', ' + child.attrs.note : ''}]`;
    else s = '';
    for (const m of child.marks) {
      if (m.type.name === 'link') s = `[${s}](${m.attrs.href})`;
      else if (m.type.name === 'sup') s = `<sup>${s}</sup>`;
      else if (m.type.name === 'sub') s = `<sub>${s}</sub>`;
      else if (MARK_MD[m.type.name]) s = MARK_MD[m.type.name] + s + MARK_MD[m.type.name];
    }
    out += s;
  });
  return out;
}

function blockMd(node, indent = '') {
  switch (node.type.name) {
    case 'paragraph': return indent + inlineMd(node) + '\n\n';
    case 'title': return '# ' + inlineMd(node) + '\n\n';
    case 'heading': return '#'.repeat(Math.min(6, node.attrs.level + 1)) + ' ' + inlineMd(node) + '\n\n';
    case 'math_display': return `$$\n${standardTeX(node.attrs.latex)}\n$$\n\n`;
    case 'table': {
      const rows = [];
      node.forEach((row) => { const cells = []; row.forEach((c) => { cells.push(c.content.content.map(inlineMd).join(' ').replace(/\|/g, '\\|')); for (let k = 1; k < c.attrs.colspan; k++) cells.push(''); }); rows.push('| ' + cells.join(' | ') + ' |'); });
      rows.splice(1, 0, '|' + ' --- |'.repeat(node.firstChild ? node.firstChild.childCount : 1));
      return indent + rows.join('\n' + indent) + '\n\n';
    }
    case 'caption': return indent + '*' + inlineMd(node) + '*\n\n';
    case 'verbatim': return '```\n' + node.textContent + '\n```\n\n';
    case 'bibliography': {
      let s = _t('## References\n\n');
      node.forEach((it) => { s += `- [${it.attrs.key}] ${inlineMd(it)}\n`; });
      return s + '\n';
    }
    case 'bibtex': return _t('(References come from BibTeX: {0})\n\n', node.attrs.files);
    case 'env': {
      let inner = '';
      node.forEach((c) => { inner += blockMd(c); });
      return PLAIN_ENVS.has(node.attrs.kind) && node.attrs.kind !== 'proof' ? inner : `**${envLabel(node.attrs.kind)}.** ` + inner.trimStart();
    }
    case 'bullet_list': case 'ordered_list': {
      let s = '', i = 1;
      node.forEach((li) => {
        const mark = (node.type.name === 'bullet_list' ? '- ' : `${i++}. `) + (li.attrs.label != null ? `**${li.attrs.label}** ` : '');
        let inner = '';
        li.forEach((c) => { inner += blockMd(c, '   '); });
        s += mark + inner.trim() + '\n';
      });
      return s + '\n';
    }
    default: {
      let s = '';
      node.forEach((c) => { s += blockMd(c, indent); });
      return s;
    }
  }
}

// The 5.x file as it was opened, ready for this TeX: a document nobody changed is
// typeset from its own text, so the pages come out as 5.5 makes them. Only what this
// TeX needs is added: the paper size, Chinese fonts, and the picture inside each \FRAME
// (tcilatex leaves only a \special for 5.x's own TeX). opts.files as for toLatex.
export function originalTex55(text, opts = {}) {
  texFiles = opts.files || new Map();
  const s = text.replace(/\r\n?/g, '\n');
  const b = s.indexOf('\\begin{document}');
  if (b < 0) return null;
  const pre = s.slice(0, b);
  let body = '';
  let graphicx = false;
  let i = b;
  for (let k; (k = s.indexOf('\\FRAME', i)) >= 0;) {
    const lineStart = s.lastIndexOf('\n', k) + 1;
    const commented = /(^|[^\\])(\\\\)*%/.test(s.slice(lineStart, k));
    if (commented || /[a-zA-Z]/.test(s[k + 6] || '')) { body += s.slice(i, k + 6); i = k + 6; continue; }
    const { args, end } = Parser55.args(s, k + 6, 8);
    let frame = s.slice(k, end);
    // (5.x breaks long \FRAMEs with "%" line ends: the sizes are read without them)
    const a = frameAttrs(args.map((x) => stripComments(x)), stripComments(frame));
    if (texFiles.has(a.path)) {
      graphicx = true;
      frame = frame.replace(/\}\s*$/, `\\raisebox{-${a.texh || '0pt'}}{${graphicTex(a)}}}`);
    }
    body += s.slice(i, k) + frame;
    i = end;
  }
  body += s.slice(i);
  const cjk = /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(stripComments(body))
    ? `\\usepackage{xeCJK}\n${CJK_FONT}` : '';
  const gfx = graphicx && !/\\usepackage(\[[^\]]*\])?\{[^}]*\bgraphicx\b/.test(pre) ? '\\usepackage{graphicx}\n' : '';
  return `${pre.trimEnd()}\n${gfx}\\ifdefined\\XeTeXversion\\pdfpagewidth=\\paperwidth \\pdfpageheight=\\paperheight\\fi\n${cjk}\n${body}`;
}

// A Scientific Word 5.x document keeps its own preamble, which loads SW's macro
// files (tcilatex.tex and its style); the desktop app has those files.
const AMS_ONLY = /\\(dfrac|tfrac|dbinom|tbinom|binom|text|operatorname|boldsymbol|eqref|tag|substack|overset|underset|xrightarrow|xleftarrow|iint|iiint|genfrac|intertext)(?![a-zA-Z])|\\begin\{(align|gather|multline|flalign|alignat|split|cases|pmatrix|bmatrix|vmatrix|Vmatrix|Bmatrix|smallmatrix)\*?\}/;
// the 5.x writer's state for doc: the author line shown under the title is \author, not a separate block
function start55(doc, meta) {
  doc55 = { author55: meta.author55, skip: null, graphicx: false,
    hyperref: /\\usepackage(\[[^\]]*\])?\{[^}]*\bhyperref\b/.test(meta.preamble55) };
  doc.forEach((n, off, i) => {
    if (n.type.name === 'title' && !n.attrs.form && meta.author55) { // an empty \author{} has no block
      const next = i + 1 < doc.childCount ? doc.child(i + 1) : null;
      if (next && next.type.name === 'env' && next.attrs.kind === 'centered') doc55.skip = next;
    }
  });
  if (doc55.skip) doc55.author55 = inlineTex(doc55.skip.firstChild); // the author line as edited
}
function toLatex55(doc, meta, opts = {}) {
  const envs = new Set();
  let body;
  let graphicx = false;
  start55(doc, meta);
  try { body = childrenTex(doc, envs); graphicx = doc55.graphicx; } finally { doc55 = null; }
  // Chinese anywhere in the text, formulas included ($\mathsf{李}$)
  const cjk = /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(body)
    ? `\\usepackage{xeCJK}\n${CJK_FONT}` : '';
  const { tablePkgs, theorems } = additions55(body, envs, meta.preamble55, graphicx);
  // a file for 5.x itself gets neither: 5.x typesets with its own TeX
  if (opts.file55) return `${meta.preamble55.trimEnd()}\n${tablePkgs}${theorems}${theorems ? '\n' : ''}\n\\begin{document}\n\n${body.trim()}\n\n\\end{document}\n`;
  const paper = tablePkgs + '\\ifdefined\\XeTeXversion\\pdfpagewidth=\\paperwidth \\pdfpageheight=\\paperheight\\fi\n';
  return `${meta.preamble55}\n${paper}${cjk}${theorems}\n\n\\begin{document}\n\n${body.trim()}\n\n\\end{document}\n`;
}

// what the preamble must add for body (5.x text the editor wrote): packages, \makeindex, theorems
function additions55(body, envs, preamble, graphicx) {
  // only where the document's style has not made it already: 5.x's thmsa option (sw20*
  // styles) defines theorem, remark, definition, example ... itself
  const theorems = [...envs].filter((k) => !new RegExp('\\\\newtheorem\\s*\\{' + k + '\\}').test(preamble))
    .map((k) => `\\expandafter\\ifx\\csname ${k}\\endcsname\\relax\\newtheorem{${k}}{${envLabel(k)}}\\fi`).join('\n');
  // XeTeX would use its own default paper; use the document's (letter for most 5.x documents)
  const pkgs = tablePackages(body, preamble);
  // \dfrac, \text, align ... need amsmath; a preamble without it (a document set as LaTeX
  // by AI, or an old file) would leave them as errors in the PDF
  // (5.x's tcilatex.tex defines them itself when amsmath is not loaded)
  if (AMS_ONLY.test(body) && !/\\input\{tcilatex\}/.test(preamble) && !/\\usepackage(\[[^\]]*\])?\{[^}]*\bamsmath\b|\\documentclass(\[[^\]]*\])?\{ams/.test(preamble)) pkgs.unshift('amsmath');
  if (graphicx && !/\\usepackage(\[[^\]]*\])?\{[^}]*\bgraphicx\b/.test(preamble)) pkgs.push('graphicx');
  if (usedXcolor && !/\\usepackage(\[[^\]]*\])?\{[^}]*\bx?color\b/.test(preamble)) pkgs.push('xcolor');
  // index entries: makeidx and \makeindex (5.x writes \makeindex itself when TCIMAKEINDEX is set)
  const index55 = (usedIndex || /\\printindex/.test(body)) && !/\\makeindex|TCIMAKEINDEX/.test(preamble);
  if (index55) pkgs.push('makeidx');
  const tablePkgs = pkgs.map((p) => `\\usepackage{${p}}\n`).join('') + (index55 ? '\\makeindex\n' : '');
  return { tablePkgs, theorems };
}

// Saving an edited 5.x file: the parts nobody edited are written as they were in the file
// (spans: tex55.js fileParts55, made when it was opened or last saved, for loadedDoc);
// only the edited parts are written from the editor. The preamble is the file's, with
// what the new parts need added; one the user edited (Typeset > Preamble) replaces it.
// -> { text, spans } for doc, or null (no parts known, or they do not fit loadedDoc)
export function patchTex55(spans, loadedDoc, doc, meta) {
  if (!spans || spans.segs.reduce((a, g) => a + g.n, 0) !== loadedDoc.childCount) return null;
  const L = [], C = [];
  loadedDoc.forEach((n) => L.push(n));
  doc.forEach((n) => C.push(n));
  const match = matchBlocks(L, C);
  // a part is kept when all its blocks are still there, one after another
  const keptAt = new Map(); // index in C -> part
  let a = 0;
  let from = spans.head;
  spans.segs.forEach((g) => {
    const j = match[a];
    let ok = j >= 0;
    for (let t = 1; ok && t < g.n; t++) ok = match[a + t] === j + t;
    if (ok) keptAt.set(j, { from, to: g.to, n: g.n });
    a += g.n;
    from = g.to;
  });
  const text = spans.text;
  const tail = text.slice(from);
  texFiles = new Map(); // pictures stay \FRAMEs: 5.x shows them itself
  usedXcolor = false;
  usedIndex = false;
  const envs = new Set();
  const pieces = []; // [text, blocks, kept]
  let made = '';
  let graphicx = false;
  start55(doc, meta);
  try {
    for (let j = 0; j < C.length;) {
      const k = keptAt.get(j);
      if (k) { pieces.push([text.slice(k.from, k.to), k.n, true]); j += k.n; continue; }
      const run = [];
      while (j < C.length && !keptAt.has(j)) run.push(C[j++]);
      const t = childrenTex({ forEach: (f) => run.forEach((n, i) => f(n, 0, i)) }, envs).trim();
      made += t + '\n\n';
      pieces.push(['\n\n' + t, run.length, false]);
    }
    graphicx = doc55.graphicx;
  } finally { doc55 = null; }
  // the preamble: the user's own edit, or the file's
  const b = text.lastIndexOf('\\begin{document}', spans.head);
  let pre = meta.preamble55raw != null && meta.preamble55raw !== spans.preamble ? meta.preamble55raw : text.slice(0, b);
  if (made) {
    const { tablePkgs, theorems } = additions55(made, envs, pre, graphicx);
    if (tablePkgs || theorems) pre = `${pre.trimEnd()}\n${tablePkgs}${theorems}${theorems ? '\n' : ''}\n`;
  }
  let out = pre + text.slice(b, spans.head);
  const head = out.length;
  const segs = [];
  pieces.forEach(([t, n, kept], i) => {
    // a kept part after a written one starts a new paragraph (the first part may not have a blank line)
    if (kept && i && !pieces[i - 1][2] && !/^[ \t]*\n[ \t]*\n/.test(t)) out += '\n\n';
    out += t;
    segs.push({ to: out.length, n });
  });
  if (pieces.length && !pieces.at(-1)[2] && !/^[ \t]*\n/.test(tail)) out += '\n\n';
  out += tail;
  return { text: out, spans: { text: out, head, segs, preamble: meta.preamble55raw ?? spans.preamble } };
}

// L[i] is C[match[i]] (the same block, unchanged), or -1: the longest such pairing in order
function matchBlocks(L, C) {
  const match = new Array(L.length).fill(-1);
  let p = 0;
  while (p < L.length && p < C.length && L[p].eq(C[p])) { match[p] = p; p++; }
  let qL = L.length, qC = C.length;
  while (qL > p && qC > p && L[qL - 1].eq(C[qC - 1])) { qL--; qC--; match[qL] = qC; }
  const n = qL - p, m = qC - p;
  if (!n || !m || n * m > 4e6) return match;
  // longest common subsequence of the middle
  const w = m + 1;
  const len = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      len[i * w + j] = L[p + i].eq(C[p + j]) ? len[(i + 1) * w + j + 1] + 1 : Math.max(len[(i + 1) * w + j], len[i * w + j + 1]);
    }
  }
  for (let i = 0, j = 0; i < n && j < m;) {
    if (L[p + i].eq(C[p + j]) && len[i * w + j] === len[(i + 1) * w + j + 1] + 1) { match[p + i] = p + j; i++; j++; }
    else if (len[(i + 1) * w + j] >= len[i * w + j + 1]) i++;
    else j++;
  }
  return match;
}

const is5xPreamble = (p) => /\\input\{tcilatex\}|%TCIDATA/.test(p);

// packages and commands only XeTeX or LuaTeX have (5.5 typesets with pdfLaTeX)
const XE_PACKAGES = new Set(['fontspec', 'xeCJK', 'xunicode', 'xltxtra', 'polyglossia', 'unicode-math', 'ctex', 'luatexja', 'luatexja-fontspec']);
const XE_CMDS = /\\(setmainfont|setsansfont|setmonofont|setmathfont|setCJKmainfont|setCJKsansfont|setCJKmonofont|setCJKfamilyfont|newfontfamily|newCJKfontfamily|defaultfontfeatures|XeTeXlinebreaklocale|XeTeXlinebreakskip)(?![a-zA-Z])/;

// A LaTeX document's own preamble (not one 5.x wrote), as lines a 5.x file can keep: what
// 5.5's pdfLaTeX has, without the definitions written out in the text (texmacros.js)
// and without XeTeX's font commands
function latexPreambleFor55(pre) {
  let p = pre.replace(/\\documentclass(\[[^\]]*\])?\{[^}]*\}/, '');
  p = withoutDefs(p, readDefs(p).spans);
  // \usepackage[..]{a,b}: only the packages pdfLaTeX has
  p = p.replace(/\\usepackage(\[[^\]]*\])?\{([^}]*)\}/g, (all, opt, list) => {
    const keep = list.split(',').map((x) => x.trim()).filter((x) => x && !XE_PACKAGES.has(x));
    return keep.length ? `\\usepackage${keep.length === list.split(',').length ? opt || '' : ''}{${keep.join(',')}}` : '';
  });
  // a font command with its arguments: \newfontfamily\sans{Noto Sans}[Ligatures=TeX], \XeTeXlinebreakskip=0pt plus 1pt
  for (let m; (m = p.match(XE_CMDS));) {
    let j = m.index + m[0].length;
    if (/^XeTeX/.test(m[1])) { const e = p.slice(j).search(/\\|\n/); j = e < 0 ? p.length : j + e; }
    else {
      for (;;) {
        const k = j + (p.slice(j).match(/^\s*/)[0].length);
        if (p[k] === '\\' && m[1].startsWith('new') && j === m.index + m[0].length) { j = k + p.slice(k).match(/^\\[a-zA-Z]+/)[0].length; continue; }
        if (p[k] === '{') { j = Parser55.groupEnd(p, k); continue; }
        if (p[k] === '[') { j = p.indexOf(']', k) + 1; continue; }
        break;
      }
    }
    p = p.slice(0, m.index) + p.slice(j);
  }
  return p.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).join('\n');
}

// A document as a Scientific Word 5.x .tex file (text; tex55file.js encodes it).
// A document opened from 5.x keeps its own preamble, comments included; any other
// gets the preamble 5.x writes for a new article.
export function toTex55File(doc, meta = {}) {
  texFiles = new Map(); // pictures stay \FRAMEs: 5.x shows them itself
  usedXcolor = false;
  usedIndex = false;
  const cjk = /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(doc.textContent);
  const cls = meta.documentclass && /^(article|book|report|amsart|amsbook)$/.test(meta.documentclass) ? meta.documentclass : 'article';
  const own = meta.preamble55raw || meta.preamble55;
  const clsOpt = (own && !is5xPreamble(own) && (stripComments(own).match(/\\documentclass(\[[^\]]*\])/) || [])[1]) || '';
  const preamble = (own && is5xPreamble(own) ? own : null) || [
    cjk ? '%2multibyte Version: 5.50.0.2960 CodePage: 950' : '%% This document created by opensw',
    '', `\\documentclass${clsOpt}{${cls}}`, '\\usepackage{amsmath}',
    // a LaTeX document's packages and settings go where 5.x writes its \usepackage lines
    own ? latexPreambleFor55(meta.preamble55 || own) : '', '',
    '%TCIDATA{OutputFilter=LATEX.DLL}', '%TCIDATA{Version=5.50.0.2960}', cjk ? '%TCIDATA{Codepage=950}' : '%TCIDATA{Codepage=1252}',
    `%TCIDATA{CSTFile=40 LaTeX ${cls}.cst}`, '', '\\input{tcilatex}', own ? '' : meta.preambleTeX || '',
  ].join('\n').replace(/\n{3,}/g, '\n\n');
  return toLatex55(doc, { ...meta, preamble55: preamble, author55: meta.preamble55 ? meta.author55 : null }, { file55: true });
}

export function toMarkdown(doc) {
  let s = '';
  doc.forEach((c) => { s += blockMd(c); });
  return s.trim() + '\n';
}
