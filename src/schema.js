import { Schema } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

// Tables (prosemirror-tables gives cell spans and editing commands). A cell's align
// is l, c or r; spec is the column spec of a \multicolumn as written in the file.
const TABLE = tableNodes({
  tableGroup: 'block',
  cellContent: 'paragraph+',
  cellAttributes: {
    align: {
      default: null,
      getFromDOM: (dom) => ({ left: 'l', center: 'c', right: 'r' }[dom.style.textAlign] || null),
      setDOMAttr: (v, attrs) => { if (v) attrs.style = (attrs.style || '') + `text-align:${{ l: 'left', c: 'center', r: 'right' }[v] || 'left'};`; },
    },
    spec: { default: null },
  },
});
// colspec: LaTeX column spec ("|l|c|r|"); after: rules under the last row ("\hline")
TABLE.table.attrs = { colspec: { default: null }, after: { default: '' } };
TABLE.table.toDOM = (n) => ['table', { class: 'sw-table' + (/\|/.test(n.attrs.colspec || '') ? ' ruled-v' : '') + (/hline|rule/.test(n.attrs.after) ? ' ruled-bottom' : '') }, ['tbody', 0]];
// before: rules above this row (\hline, \cline{2-3}) as written
TABLE.table_row.attrs = { before: { default: '' } };
TABLE.table_row.toDOM = (n) => ['tr', /hline|rule|cline/.test(n.attrs.before) ? { class: 'ruled-top' } : {}, 0];

// Document model. Block and inline kinds follow the tags Scientific Word uses
// in .sci files (bodyText, section, theorem, numberedlist, math, msidisplay...).
export const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    title: {
      group: 'block',
      content: 'inline*',
      defining: true,
      // form: null = \title + \maketitle; 'huge', 'Large'...: a Scientific Word 5 heading (centered line in that size)
      // date: \date{..} as written (null: none given)
      attrs: { form: { default: null }, date: { default: null } },
      toDOM: () => ['h1', { class: 'doc-title' }, 0],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 2 }, nonum: { default: false } }, // nonum: unnumbered (\section*)
      defining: true,
      toDOM: (n) => ['h' + Math.min(6, n.attrs.level + 1), 0],
    },
    // theorem, definition, proof, lemma ... (kind = the .sci tag name)
    env: {
      group: 'block',
      content: 'block+',
      attrs: { kind: { default: 'theorem' }, title: { default: null } }, // title: \begin{theorem}[title]
      defining: true,
      toDOM: (n) => ['div', { class: 'env env-' + n.attrs.kind, 'data-label': envLabel(n.attrs.kind), 'data-title': n.attrs.title ? `（${n.attrs.title}）` : '' }, 0],
    },
    // kind: itemize, or description (items with a term as label)
    bullet_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { kind: { default: 'itemize' } },
      toDOM: (n) => ['ul', n.attrs.kind === 'description' ? { class: 'description' } : {}, 0],
    },
    ordered_list: {
      group: 'block',
      content: 'list_item+',
      toDOM: () => ['ol', 0],
    },
    // label: the item's own label, \item[label] (a description term, or "(a)")
    list_item: {
      content: 'paragraph block*',
      attrs: { label: { default: null } },
      defining: true,
      toDOM: (n) => ['li', n.attrs.label != null ? { class: 'labelled', 'data-label': n.attrs.label } : {}, 0],
    },
    // verbatim text: kept exactly, shown in a typewriter font
    verbatim: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      defining: true,
      toDOM: () => ['pre', { class: 'verbatim' }, ['code', 0]],
    },
    // A displayed formula. numbered: gets an equation number; label: its marker
    // (\label) for cross-references; tag: a fixed number text (\tag). A formula of
    // several rows (align, eqnarray, gather) has rows: [{ numbered, label, tag }]
    // and env: the LaTeX environment it came from.
    math_display: {
      group: 'block',
      atom: true,
      attrs: {
        latex: { default: '' }, numbered: { default: false }, label: { default: null },
        tag: { default: null }, rows: { default: null }, env: { default: null },
      },
      toDOM: (n) => ['div', { class: 'math-display' }, n.attrs.latex],
    },
    text: { group: 'inline' },
    math_inline: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { latex: { default: '' } },
      toDOM: (n) => ['span', { class: 'math-inline' }, n.attrs.latex],
    },
    // A picture (see graphics.js). src: what the editor shows (null: file not found);
    // path: the file as the document names it; width/height in CSS px, texw/texh as
    // written in TeX; place: inline | display | float (a floating figure or table with
    // caption and label); frame: the 5.x \FRAME it came from; opts: \includegraphics options.
    image: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: {
        src: { default: null }, path: { default: '' }, width: { default: null }, height: { default: null },
        texw: { default: null }, texh: { default: null }, place: { default: 'inline' }, floattype: { default: 'figure' },
        placement: { default: null }, caption: { default: null }, label: { default: null },
        frame: { default: null }, name: { default: null }, plot: { default: false }, opts: { default: null },
        raw6: { default: null }, // an SW 6 plot (<graph>) as it was in the file
      },
      toDOM: (n) => {
        const a = n.attrs;
        const size = (a.width ? `width:${a.width}px;` : '') + (a.height ? `height:${a.height}px;` : '');
        const pic = a.src
          ? ['img', { src: a.src, style: size, alt: a.path }]
          : ['span', { class: 'image-missing', style: size || 'width:120px;height:80px;' },
            (a.plot ? '圖形（5.5 的繪圖）' : '圖片') + (a.path ? '：' + a.path.split('/').pop() : '')];
        const cap = a.place === 'float' && a.caption ? [['span', { class: 'image-caption' }, a.caption]] : [];
        return ['span', { class: 'image place-' + a.place, title: a.path || '' }, ['span', { class: 'image-pic' }, pic], ...cap];
      },
    },
    // \cite[note]{keys} (kind cite) or \nocite{keys}; keys: "a,b"
    cite: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { keys: { default: '' }, note: { default: null }, kind: { default: 'cite' } },
      // a citation shows its numbers from numbering.js (data-num)
      toDOM: (n) => (n.attrs.kind === 'nocite'
        ? ['span', { class: 'cite cite-nocite', title: n.attrs.keys }, `［不顯示的引用：${n.attrs.keys}］`]
        : ['span', { class: 'cite cite-cite', title: n.attrs.keys }]),
    },
    // A list of references written in the document (thebibliography); widest: the
    // widest label, as LaTeX wants it
    bibliography: {
      group: 'block',
      content: 'bib_item+',
      attrs: { widest: { default: '9' } },
      toDOM: () => ['div', { class: 'bibliography' }, 0],
    },
    // \bibitem[label]{key} text
    bib_item: {
      content: 'inline*',
      attrs: { key: { default: '' }, label: { default: null } },
      defining: true,
      toDOM: (n) => ['div', { class: 'bib-item', 'data-key': n.attrs.key }, 0],
    },
    // references from BibTeX files: \bibliographystyle{style} \bibliography{files}
    bibtex: {
      group: 'block',
      atom: true,
      attrs: { style: { default: 'plain' }, files: { default: '' } },
      toDOM: (n) => ['div', { class: 'bibtex' }, `參考文獻（BibTeX：${n.attrs.files}，樣式 ${n.attrs.style}）`],
    },
    // \index{entry}: an index entry (entry as written: "sub!subsub@sorted|see{..}")
    index_entry: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { entry: { default: '' } },
      toDOM: (n) => ['span', { class: 'index-entry', title: '索引：' + n.attrs.entry }],
    },
    // A footnote or margin note (\footnote, \marginpar). Its text is inside it; the
    // editor shows only a mark and opens the text on click (noteview.js).
    note: {
      group: 'inline',
      inline: true,
      atom: true,
      content: '(text | math_inline | hard_break | marker | ref | cite | tex_field | image)*',
      attrs: { kind: { default: 'footnote' } }, // footnote | margin | thanks (\thanks in the title or author)
      toDOM: (n) => ['span', { class: 'note note-' + n.attrs.kind }, 0],
    },
    // raw TeX field from Scientific Word (<texb>): passed through on export
    tex_field: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { tex: { default: '' } },
      toDOM: (n) => (n.attrs.tex.startsWith('\\FRAME')
        ? ['span', { class: 'tex-field frame', title: n.attrs.tex.slice(0, 300) }, '［5.5 的圖，這裡還不能顯示］']
        : SKIPS[n.attrs.tex.trim()] // vertical space as 5.5 shows it
          ? ['span', { class: 'tex-field vspace', title: n.attrs.tex }, SKIPS[n.attrs.tex.trim()]]
          : ['span', { class: 'tex-field', title: 'TeX 原始碼欄位' }, n.attrs.tex]),
    },
    ...TABLE,
    // front matter written as a command with text: \address{..} \email{..} \keywords{..} ...
    front_field: {
      group: 'block',
      content: 'inline*',
      attrs: { cmd: { default: 'address' } },
      defining: true,
      toDOM: (n) => ['div', { class: 'front-field', 'data-label': FRONT_LABELS[n.attrs.cmd] || n.attrs.cmd }, 0],
    },
    // a subdocument: \input{file}, \include{file}, or 5.x's \QSubDoc{Include file}{\input{file}};
    // tex: the command as written
    subdoc: {
      group: 'block',
      atom: true,
      attrs: { file: { default: '' }, tex: { default: '' } },
      toDOM: (n) => ['div', { class: 'subdoc' }, '子文件：' + n.attrs.file],
    },
    // \tableofcontents, \listoffigures, \listoftables: made when typesetting
    toc: {
      group: 'block',
      atom: true,
      attrs: { kind: { default: 'tableofcontents' } },
      toDOM: (n) => ['div', { class: 'toc' }, { tableofcontents: '目錄', listoffigures: '圖目錄', listoftables: '表目錄', printindex: '索引' }[n.attrs.kind] + '（排版時產生）'],
    },
    // \appendix: the chapters or sections after it are numbered A, B, ...
    appendix: {
      group: 'block',
      atom: true,
      toDOM: () => ['div', { class: 'appendix-mark' }, '附錄（以下各節編號 A、B…）'],
    },
    // A table or figure that LaTeX places where it fits (table/figure environment),
    // with an optional caption. env: table | figure; placement: [htbp]; centered: how
    // the original centred it (\centering or a center environment).
    float_box: {
      group: 'block',
      content: 'caption? block+ caption?',
      attrs: { env: { default: 'table' }, placement: { default: null }, centered: { default: 'centering' } },
      defining: true,
      toDOM: (n) => ['div', { class: 'float-box float-' + n.attrs.env }, 0],
    },
    caption: {
      content: 'inline*',
      defining: true,
      toDOM: () => ['div', { class: 'caption' }, 0],
    },
    // A marker (\label): a name other places refer to; it stands for the number of
    // what it is in (section, theorem, list item, equation).
    marker: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { key: {} },
      toDOM: (n) => ['span', { class: 'marker', title: '標記：' + n.attrs.key, 'data-key': n.attrs.key }],
    },
    // A cross-reference to a marker. kind: ref (the number), eqref (number in
    // parentheses) or pageref (the page, known only after typesetting).
    ref: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { key: {}, kind: { default: 'ref' } },
      toDOM: (n) => ['span', { class: 'xref xref-' + n.attrs.kind, title: '交叉引用：' + n.attrs.key, 'data-key': n.attrs.key }],
    },
    hard_break: {
      group: 'inline',
      inline: true,
      selectable: false,
      toDOM: () => ['br'],
    },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }, { tag: 'b' }] },
    italic: { toDOM: () => ['em', 0], parseDOM: [{ tag: 'em' }, { tag: 'i' }] },
    code: { toDOM: () => ['code', 0], parseDOM: [{ tag: 'code' }] },
    sup: { excludes: 'sub', toDOM: () => ['sup', 0] },
    smallcaps: { toDOM: () => ['span', { class: 'm-sc' }, 0] },
    sans: { toDOM: () => ['span', { class: 'm-sf' }, 0] },
    underline: { toDOM: () => ['u', 0] },
    // size: tiny scriptsize footnotesize small large Large LARGE huge Huge
    size: { attrs: { size: {} }, toDOM: (m) => ['span', { class: 'm-size m-size-' + m.attrs.size }, 0] },
    // color: a LaTeX colour name or "#rrggbb" (from \textcolor or \color)
    color: { attrs: { color: {} }, toDOM: (m) => ['span', { style: 'color:' + (m.attrs.color.startsWith('#') ? m.attrs.color : m.attrs.color.replace(/[^a-zA-Z]/g, '')) }, 0] },
    sub: { excludes: 'sup', toDOM: () => ['sub', 0] },
    // href: a web address, or "#marker" for a place in the document. kind: url (\url),
    // or null. sw5: a 5.x hypertext link's printed text { cmd, before, after }
    link: {
      attrs: { href: {}, kind: { default: null }, sw5: { default: null } },
      inclusive: false,
      toDOM: (m) => ['a', { href: m.attrs.href, ...(m.attrs.href.startsWith('#') ? { class: 'inner-link' } : { target: '_blank', rel: 'noopener' }) }, 0],
    },
  },
});

const SKIPS = { '\\bigskip': '↕ 大間距', '\\medskip': '↕ 中間距', '\\smallskip': '↕ 小間距', '\\newpage': '⤓ 換頁', '\\pagebreak': '⤓ 換頁' };
export const FRONT_LABELS = { address: '地址', curraddr: '現職地址', email: '電子郵件', urladdr: '網址', dedicatory: '獻詞',
  keywords: '關鍵詞', subjclass: '分類', translator: '譯者', date: '日期' };

const LABELS = {
  theorem: '定理', lemma: '引理', corollary: '推論', proposition: '命題',
  definition: '定義', example: '例', remark: '注', proof: '證明',
  conjecture: '猜想', exercise: '習題', note: '注意',
  axiom: '公理', case: '情形', claim: '斷言', conclusion: '結論', condition: '條件', criterion: '準則',
  notation: '記號', problem: '問題', solution: '解', summary: '摘要', centered: '置中',
  abstract: '摘要', quote: '引文', quotation: '引文', verse: '詩', flushleft: '靠左', flushright: '靠右',
};
// LaTeX's own environments (not theorems): no \newtheorem, no number
export const PLAIN_ENVS = new Set(['proof', 'centered', 'abstract', 'quote', 'quotation', 'verse', 'flushleft', 'flushright']);
export function envLabel(kind) {
  return LABELS[kind] || kind;
}
