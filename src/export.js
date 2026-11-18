import { envLabel, PLAIN_ENVS } from './schema.js';
import { standardTeX, columnAligns, Parser as Parser55 } from './tex55.js';
import { frameAttrs, includeAttrs } from './graphics.js';
import { TableMap } from 'prosemirror-tables';
import { splitRows } from './numbering.js';

// ---------- LaTeX ----------
const SECTION_CMD = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];
const ESC = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '#': '\\#', $: '\\$', '%': '\\%', '&': '\\&',
  _: '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' };
// special spaces and the soft hyphen typed with 5.x's keys come back as their TeX commands
const SPACES_TEX = { '\u00a0': '~', '\u2009': '\\,', '\u2005': '\\;', '\u00ad': '\\-' };
const escTex = (s) => s.replace(/[\\{}#$%&_~^]/g, (c) => ESC[c]).replace(/[\u00a0\u2009\u2005\u00ad]/g, (c) => SPACES_TEX[c]);

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
    else if (child.type.name === 'math_inline') s = '$' + (doc55 ? child.attrs.latex : standardTeX(child.attrs.latex)) + '$';
    else if (child.type.name === 'tex_field') s = child.attrs.tex + (/\\[a-zA-Z]+$/.test(child.attrs.tex) ? '{}' : '');
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
let doc55 = null;

// \tag / \label / \nonumber for one numbered row
const rowMarksTex = (r, envNumbers) => (r.tag != null ? `\\tag{${r.tag}}` : '') + (r.label ? `\\label{${r.label}}` : '')
  + (envNumbers && !r.numbered && r.tag == null ? '\\nonumber' : '');

// A displayed formula with its numbering: \[..\], equation, or its own multi-row environment
function displayTex(node) {
  const a = node.attrs;
  const tex = (x) => (doc55 ? x : standardTeX(x));
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
    lines.push((row.attrs.before ? row.attrs.before + '\n' : '') + cells.join(' & ') + ' \\\\');
  });
  return `\\begin{tabular}{${spec}}\n${lines.join('\n')}${node.attrs.after ? '\n' + node.attrs.after : ''}\n\\end{tabular}`;
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
      if (doc55) return `\\title{${inlineTex(node)}}\n${doc55.author55 != null ? `\\author{${doc55.author55}}\n` : ''}\\maketitle\n\n`;
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
      || (prev.type.name === 'math_display' && c.type.name === 'paragraph'))) s = s.replace(/\n+$/, '\n');
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
\\IfFontExistsTF{Noto Serif CJK TC}{\\setCJKmainfont{Noto Serif CJK TC}}{%
  \\IfFontExistsTF{PMingLiU}{\\setCJKmainfont{PMingLiU}}{\\setCJKmainfont{Microsoft JhengHei}}}
${pkgs.map((p) => `\\usepackage{${p}}`).join('\n')}
${indexSetup}\\usepackage{hyperref}
\\renewcommand{\\proofname}{證明}
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
    else if (child.type.name === 'hard_break') s = '  \n';
    else if (child.type.name === 'image') s = `![${child.attrs.caption || ''}](${child.attrs.path})`;
    else if (child.type.name === 'note') s = `^[${child.attrs.kind === 'margin' ? '邊註：' : ''}${inlineMd(child)}]`;
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
      let s = '## 參考文獻\n\n';
      node.forEach((it) => { s += `- [${it.attrs.key}] ${inlineMd(it)}\n`; });
      return s + '\n';
    }
    case 'bibtex': return `（參考文獻來自 BibTeX：${node.attrs.files}）\n\n`;
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

// A Scientific Word 5.x document keeps its own preamble, which loads SW's macro
// files (tcilatex.tex and its style); the desktop app has those files.
function toLatex55(doc, meta, opts = {}) {
  doc55 = { author55: meta.author55, skip: null, graphicx: false,
    hyperref: /\\usepackage(\[[^\]]*\])?\{[^}]*\bhyperref\b/.test(meta.preamble55) };
  // the author line shown under the title is \author, not a separate block
  doc.forEach((n, off, i) => {
    if (n.type.name === 'title' && !n.attrs.form && meta.author55 != null) {
      const next = i + 1 < doc.childCount ? doc.child(i + 1) : null;
      if (next && next.type.name === 'env' && next.attrs.kind === 'centered') doc55.skip = next;
    }
  });
  if (doc55.skip) doc55.author55 = inlineTex(doc55.skip.firstChild); // the author line as edited
  const envs = new Set();
  let body;
  let graphicx = false;
  try { body = childrenTex(doc, envs); graphicx = doc55.graphicx; } finally { doc55 = null; }
  const theorems = [...envs].filter((k) => !new RegExp('\\\\newtheorem\\s*\\{' + k + '\\}').test(meta.preamble55))
    .map((k) => `\\newtheorem{${k}}{${envLabel(k)}}`).join('\n');
  const cjk = /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(doc.textContent)
    ? `\\usepackage{xeCJK}\n\\IfFontExistsTF{Noto Serif CJK TC}{\\setCJKmainfont{Noto Serif CJK TC}}{%\n  \\IfFontExistsTF{PMingLiU}{\\setCJKmainfont{PMingLiU}}{\\setCJKmainfont{Microsoft JhengHei}}}\n` : '';
  // XeTeX would use its own default paper; use the document's (letter for most 5.x documents)
  const pkgs = tablePackages(body, meta.preamble55);
  if (graphicx && !/\\usepackage(\[[^\]]*\])?\{[^}]*\bgraphicx\b/.test(meta.preamble55)) pkgs.push('graphicx');
  if (usedXcolor && !/\\usepackage(\[[^\]]*\])?\{[^}]*\bx?color\b/.test(meta.preamble55)) pkgs.push('xcolor');
  // index entries: makeidx and \makeindex (5.x writes \makeindex itself when TCIMAKEINDEX is set)
  const index55 = (usedIndex || /\\printindex/.test(body)) && !/\\makeindex|TCIMAKEINDEX/.test(meta.preamble55);
  if (index55) pkgs.push('makeidx');
  const tablePkgs = pkgs.map((p) => `\\usepackage{${p}}\n`).join('') + (index55 ? '\\makeindex\n' : '');
  // a file for 5.x itself gets neither: 5.x typesets with its own TeX
  if (opts.file55) return `${meta.preamble55.trimEnd()}\n${tablePkgs}${theorems}${theorems ? '\n' : ''}\n\\begin{document}\n\n${body.trim()}\n\n\\end{document}\n`;
  const paper = tablePkgs + '\\ifdefined\\XeTeXversion\\pdfpagewidth=\\paperwidth \\pdfpageheight=\\paperheight\\fi\n';
  return `${meta.preamble55}\n${paper}${cjk}${theorems}\n\n\\begin{document}\n\n${body.trim()}\n\n\\end{document}\n`;
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
  const preamble = meta.preamble55raw || meta.preamble55 || [
    cjk ? '%2multibyte Version: 5.50.0.2960 CodePage: 950' : '%% This document created by opensw',
    '', `\\documentclass{${cls}}`, '\\usepackage{amsmath}', '',
    '%TCIDATA{OutputFilter=LATEX.DLL}', '%TCIDATA{Version=5.50.0.2960}', cjk ? '%TCIDATA{Codepage=950}' : '%TCIDATA{Codepage=1252}',
    `%TCIDATA{CSTFile=40 LaTeX ${cls}.cst}`, '', '\\input{tcilatex}', meta.preambleTeX || '',
  ].join('\n');
  return toLatex55(doc, { ...meta, preamble55: preamble, author55: meta.preamble55 ? meta.author55 : null }, { file55: true });
}

export function toMarkdown(doc) {
  let s = '';
  doc.forEach((c) => { s += blockMd(c); });
  return s.trim() + '\n';
}
