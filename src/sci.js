import JSZip from 'jszip';
import { schema } from './schema.js';
import { mathmlToLatex } from './mathml2latex.js';
import { sciMathML } from './sciwriter.js';
import { mimeOf } from './graphics.js';

// Read a Scientific Word .sci file (a zip with main.xhtml) into an editor document.

const SECTION_LEVEL = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
export const ENV_TAGS = new Set(['theorem', 'lemma', 'corollary', 'proposition', 'definition', 'example', 'remark',
  'proof', 'conjecture', 'exercise', 'notation', 'texnote', 'problem', 'property', 'question', 'summary',
  'acknowledgment', 'algorithm', 'assertion', 'assumption', 'axiom', 'case', 'claim', 'conclusion', 'condition',
  'criterion', 'solution', 'note']);
const LIST_TAGS = { numberedlist: 'ordered_list', bulletlist: 'bullet_list', descriptionlist: 'bullet_list' };
const SKIP = new Set(['head', 'preamble', 'maketitle', 'colist', 'sw-meta', 'sectiontitle', 'bibkey', 'script', 'style', 'envLeadIn', 'biblabel', 'frontmatter', 'mainmatter', 'backmatter']);
const MARK_TAGS = { bold: 'bold', italics: 'italic', emphasized: 'italic', slanted: 'italic', typewriter: 'code', sup: 'sup', sub: 'sub',
  smallCaps: 'smallcaps', sansSerif: 'sans', underline: 'underline' };
const SIZE_TAGS = new Set(['tiny', 'scriptsize', 'footnotesize', 'small', 'large', 'Large', 'LARGE', 'huge', 'Huge']);
const TOC_TAGS = { maketoc: 'tableofcontents', makelof: 'listoffigures', makelot: 'listoftables', printindex: 'printindex' };
const FRONT_TAGS = new Set(['address', 'curraddr', 'email', 'urladdr', 'dedicatory', 'keywords', 'subjclass', 'translator']);
const QUOTE_TAGS = { shortQuote: 'quote', longQuotation: 'quotation', abstract: 'abstract' };
const opensw = (el) => { try { return JSON.parse(el.getAttribute('data-opensw') || 'null'); } catch (e) { return null; } };

export async function readSci(data) {
  const zip = await JSZip.loadAsync(data);
  const file = zip.file('main.xhtml') || zip.file(/\.xhtml$/)[0];
  if (!file) throw new Error('這個 .sci 裡找不到 main.xhtml');
  const xml = await file.async('string');
  const dom = new DOMParser().parseFromString(xml, 'application/xml');
  if (dom.querySelector('parsererror')) throw new Error('main.xhtml 格式錯誤');

  // pictures inside the zip -> blob URLs
  const images = {};
  const pictures = new Map(); // path in the zip -> bytes (kept for saving and typesetting)
  await Promise.all(Object.keys(zip.files)
    .filter((p) => /\.(png|jpe?g|gif|svg|bmp|webp|pdf)$/i.test(p))
    .map(async (p) => {
      const bytes = await zip.file(p).async('uint8array');
      pictures.set(p, bytes);
      images[p] = URL.createObjectURL(new Blob([bytes], { type: mimeOf(p) }));
    }));

  const meta = readPreamble(dom);
  const body = dom.getElementsByTagName('body')[0] || dom.documentElement;
  const out = [];
  new Reader(images).blocks(body, out);
  if (!out.length) out.push(schema.nodes.paragraph.create());
  const head = dom.getElementsByTagName('head')[0];
  const headXML = head ? new XMLSerializer().serializeToString(head) : '<head/>';
  const doc = schema.nodes.doc.create(null, out);
  // the pictures by the name the document uses (a 5.x picture keeps its own name, see sciwriter.js)
  const files = new Map();
  doc.descendants((n) => {
    if (n.type.name === 'image' && n.attrs.src) {
      const p = Object.keys(images).find((k) => images[k] === n.attrs.src);
      if (p) files.set(n.attrs.path, pictures.get(p));
    }
  });
  return { doc, meta, zip, headXML, files };
}

function readPreamble(dom) {
  const meta = { documentclass: 'article', packages: [] };
  const dc = dom.getElementsByTagName('documentclass')[0];
  if (dc) meta.documentclass = dc.getAttribute('class') || 'article';
  for (const tag of ['usepackage', 'requirespackage']) {
    for (const el of dom.getElementsByTagName(tag)) {
      const p = el.getAttribute('req');
      if (p && !meta.packages.includes(p)) meta.packages.push(p);
    }
  }
  const pt = dom.getElementsByTagName('preambleTeX')[0];
  if (pt) meta.preambleTeX = pt.textContent.trim();
  return meta;
}

// LaTeX for one <math>: the annotation this editor wrote, if the MathML is still
// what that annotation produces (otherwise the formula was edited elsewhere)
// compare MathML as text: no namespace attributes, no spaces between tags, characters
// instead of numeric entities (the writer uses entities, XMLSerializer gives characters)
const norm = (s) => s.replace(/\sxmlns(:\w+)?="[^"]*"/g, '').replace(/>\s+</g, '><')
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d))
  // spacing inside tags (MathLive may write two spaces before an attribute)
  .replace(/<([^>]*)>/g, (m, t) => '<' + t.replace(/\s+/g, ' ').replace(/\s*\/$/, '/').trim() + '>').trim();
function mathLatex(mathEl) {
  const sem = Array.from(mathEl.children).find((c) => c.localName === 'semantics');
  const ann = sem && Array.from(sem.children).find((c) => c.localName === 'annotation' && /tex/i.test(c.getAttribute('encoding') || ''));
  if (ann) {
    const latex = ann.textContent;
    const shown = sem.children[0];
    const inner = shown.localName === 'mrow' ? Array.from(shown.childNodes).map((n) => new XMLSerializer().serializeToString(n)).join('') : '';
    if (norm(inner) === norm(sciMathML(latex))) return latex;
    return mathmlToLatex(shown);
  }
  return mathmlToLatex(mathEl);
}

class Reader {
  constructor(images) { this.images = images; }

  // children of el -> block nodes appended to out
  blocks(el, out) {
    let inline = [];
    const flush = () => {
      const content = trimInline(inline);
      if (content.length) out.push(schema.nodes.paragraph.create(null, content));
      inline = [];
    };
    for (const child of el.childNodes) {
      if (child.nodeType === 3) { this.inline(child, [], inline); continue; }
      if (child.nodeType !== 1) continue;
      if (this.isBlock(child)) { flush(); this.block(child, out); } else this.inline(child, [], inline);
    }
    flush();
  }

  isBlock(el) {
    const t = el.localName;
    if (t === 'math') return el.getAttribute('display') === 'block';
    if (t === 'msiframe') return el.getAttribute('frametype') === 'table';
    if (t === 'imagecaption') return true;
    if (t === 'texb') return !!opensw(el)?.subdoc;
    if (t in TOC_TAGS || FRONT_TAGS.has(t) || t in QUOTE_TAGS) return true;
    if (['bibtexbibliography', 'appendix', 'date', 'environment', 'verbatim', 'flushleft', 'flushright'].includes(t)) return true;
    return t in SECTION_LEVEL || ENV_TAGS.has(t) || t in LIST_TAGS || ['bodyText', 'p', 'title', 'author',
      'msidisplay', 'table', 'bibliography', 'bibitem', 'longQuotation', 'shortQuote', 'centered', 'abstract',
      'numberedListItem', 'bulletListItem', 'descriptionListItem', 'section', 'div', 'body'].includes(t);
  }

  block(el, out) {
    const t = el.localName;
    if (SKIP.has(t)) return;
    if (t in SECTION_LEVEL) {
      const st = Array.from(el.children).find((c) => c.localName === 'sectiontitle');
      if (st) out.push(schema.nodes.heading.create({ level: SECTION_LEVEL[t], nonum: el.getAttribute('nonum') === 'true' }, this.inlineOf(st)));
      this.blocks(el, out);
    } else if (t === 'title') {
      out.push(schema.nodes.title.create({ form: opensw(el)?.form ?? null }, this.inlineOf(el)));
    } else if (t === 'date') { // the date of the title above
      const prev = out[out.length - 1];
      const d = el.hasAttribute('data-opensw') ? el.getAttribute('data-opensw') : el.textContent.trim();
      if (prev && prev.type.name === 'title') out[out.length - 1] = prev.type.create({ ...prev.attrs, date: d }, prev.content);
      else out.push(schema.nodes.front_field.create({ cmd: 'date' }, d ? [schema.text(d)] : []));
    } else if (t in TOC_TAGS) {
      out.push(schema.nodes.toc.create({ kind: TOC_TAGS[t] }));
    } else if (t === 'appendix') {
      out.push(schema.nodes.appendix.create());
    } else if (FRONT_TAGS.has(t)) {
      out.push(schema.nodes.front_field.create({ cmd: t }, this.inlineOf(el)));
    } else if (t === 'bibtexbibliography') {
      out.push(schema.nodes.bibtex.create({ style: el.getAttribute('styleFile') || 'plain', files: el.getAttribute('databaseFile') || '' }));
    } else if (t === 'texb') { // a subdocument written by opensw
      out.push(schema.nodes.subdoc.create({ file: opensw(el).subdoc, tex: el.textContent }));
    } else if (t in QUOTE_TAGS || t === 'environment') {
      const inner = [];
      this.blocks(el, inner);
      if (!inner.length) inner.push(schema.nodes.paragraph.create());
      out.push(schema.nodes.env.create({ kind: QUOTE_TAGS[t] || el.getAttribute('type') || 'quote' }, inner));
    } else if (t === 'author') {
      out.push(schema.nodes.paragraph.create(null, this.inlineOf(el, ['italic'])));
    } else if (ENV_TAGS.has(t)) {
      const inner = [];
      this.blocks(el, inner);
      if (!inner.length) inner.push(schema.nodes.paragraph.create());
      // a custom lead-in is the theorem's title: \begin{theorem}[title]
      const lead = el.getAttribute('leadInType') === 'custom' ? Array.from(el.children).find((c) => c.localName === 'envLeadIn') : null;
      out.push(schema.nodes.env.create({ kind: t, title: lead ? lead.textContent.trim() || null : null }, inner));
    } else if (t in LIST_TAGS) {
      const items = [];
      for (const li of el.children) {
        // the item's own label: <numberedLabel>/<bulletLabel> in the item, <descriptionLabel> in its first paragraph
        const first = Array.from(li.children).find((c) => c.localName === 'bodyText');
        const labEl = Array.from(li.children).find((c) => c.localName === 'numberedLabel' || c.localName === 'bulletLabel')
          || (first && Array.from(first.children).find((c) => c.localName === 'descriptionLabel'));
        let label = null;
        if (labEl) {
          label = labEl.hasAttribute('data-opensw') ? labEl.getAttribute('data-opensw') : labEl.textContent.trim();
          labEl.remove();
        }
        const inner = [];
        this.blocks(li, inner);
        if (!inner.length || inner[0].type.name !== 'paragraph') inner.unshift(schema.nodes.paragraph.create());
        items.push(schema.nodes.list_item.create({ label }, inner));
      }
      if (items.length) out.push(t === 'descriptionlist' ? schema.nodes.bullet_list.create({ kind: 'description' }, items) : schema.nodes[LIST_TAGS[t]].create(null, items));
    } else if (t === 'verbatim') {
      const text = Array.from(el.childNodes).map((c) => (c.nodeType === 1 && c.localName === 'br' ? '\n' : c.nodeType === 1 ? c.textContent : c.nodeValue)).join('');
      out.push(schema.nodes.verbatim.create(null, text ? [schema.text(text)] : []));
    } else if (t === 'flushleft' || t === 'flushright') {
      // one tag per paragraph in SW 6: next to each other they are one environment here
      const para = schema.nodes.paragraph.create(null, this.inlineOf(el));
      const prev = out[out.length - 1];
      if (prev && prev.type.name === 'env' && prev.attrs.kind === t) out[out.length - 1] = prev.copy(prev.content.addToEnd(para));
      else out.push(schema.nodes.env.create({ kind: t }, [para]));
    } else if (t === 'msidisplay' || t === 'math') {
      const maths = t === 'math' ? [el] : Array.from(el.getElementsByTagNameNS('*', 'math'));
      // Scientific Word 6 numbers a display unless numbering="none"; marker is its \label
      const disp = t === 'msidisplay' ? el : null;
      const numbered = !!disp && disp.getAttribute('numbering') !== 'none';
      const label = disp?.getAttribute('marker') || null;
      let extra = {};
      try { extra = JSON.parse(disp?.getAttribute('data-opensw') || '{}'); } catch (e) { /* written by another program */ }
      for (const m of maths) {
        out.push(schema.nodes.math_display.create({ latex: mathLatex(m), numbered, label, rows: extra.rows ?? null, tag: extra.tag ?? null, env: extra.env ?? null }));
      }
    } else if (t === 'table') {
      out.push(this.table(el));
    } else if (t === 'msiframe') { // a table with its caption
      let extra = {};
      try { extra = JSON.parse(el.getAttribute('data-opensw') || '{}'); } catch (e) { /* written by another program */ }
      const inner = [];
      const caps = [];
      for (const c of el.children) {
        if (c.localName === 'imagecaption') {
          const content = [];
          for (const b of c.childNodes) this.inline(b, [], content);
          const key = c.getAttribute('key');
          const capContent = trimInline(content);
          if (key) capContent.push(schema.nodes.marker.create({ key }));
          caps.push(schema.nodes.caption.create(null, capContent));
        } else if (c.localName === 'table') inner.push(this.table(c));
        else this.blocks(c, inner);
      }
      if (!inner.length) inner.push(schema.nodes.paragraph.create());
      const top = el.getAttribute('captionloc') === 'top';
      const content = top ? [...caps.slice(0, 1), ...inner] : [...inner, ...caps.slice(0, 1)];
      out.push(schema.nodes.float_box.create({
        env: extra.env || 'table', placement: extra.placement ?? el.getAttribute('placeLocation') ?? null, centered: extra.centered ?? 'centering',
      }, content));
    } else if (t === 'centered') {
      const inner = [];
      this.blocks(el, inner);
      if (inner.length) out.push(schema.nodes.env.create({ kind: 'centered' }, inner));
    } else if (t === 'bibliography') {
      const items = [];
      for (const it of el.children) {
        if (it.localName !== 'bibitem') continue;
        const key = Array.from(it.children).find((c) => c.localName === 'bibkey');
        const lab = Array.from(it.children).find((c) => c.localName === 'biblabel');
        const content = [];
        for (const c of it.children) if (c.localName !== 'bibkey' && c.localName !== 'biblabel') { if (content.length) content.push(schema.text(' ')); content.push(...this.inlineOf(c)); }
        const label = lab ? lab.textContent.trim().replace(/^\[([^]*)\]$/, '$1') : null;
        items.push(schema.nodes.bib_item.create({ key: key ? key.textContent.trim() : '', label }, trimInline(content)));
      }
      if (items.length) out.push(schema.nodes.bibliography.create({ widest: opensw(el)?.widest ?? '99' }, items));
    } else {
      this.blocks(el, out); // bodyText, p, quotations, list items ...
    }
  }

  // <msiframe frametype="image"> -> an image node: the picture, how it is placed, its caption
  picture(frame) {
    // a plot's frame has the plot file and a snapshot picture: take the picture
    const objs = Array.from(frame.getElementsByTagNameNS('*', 'object'));
    const obj = objs.find((o) => o.getAttribute('msisnap') === 'true') || objs.find((o) => /\.(png|jpe?g|gif|svg|bmp)$/i.test(o.getAttribute('data') || o.getAttribute('src') || '')) || objs[0];
    const p = obj.getAttribute('data') || obj.getAttribute('src') || '';
    let extra = {};
    try { extra = JSON.parse(frame.getAttribute('data-opensw') || '{}'); } catch (e) { /* written by another program */ }
    const pos = frame.getAttribute('pos') || 'inline';
    const capEl = Array.from(frame.children).find((c) => c.localName === 'imagecaption');
    const units = frame.getAttribute('units') || 'in';
    const dim = (v) => (v && !Number.isNaN(parseFloat(v)) ? `${+parseFloat(v).toFixed(4)}${units}` : null);
    return schema.nodes.image.create({
      src: this.images[p] || null,
      path: p,
      ...pxSize(obj),
      texw: dim(frame.getAttribute('width')),
      texh: dim(frame.getAttribute('height')),
      place: pos === 'floating' ? 'float' : pos === 'inline' ? 'inline' : 'display',
      caption: capEl ? capEl.textContent.trim() || null : null,
      label: capEl?.getAttribute('key') || null,
      placement: frame.getAttribute('placeLocation') || null,
      ...extra, // what opensw wrote itself: the 5.x frame and TeX sizes
    });
  }

  // <table> -> a table node; cells hold paragraphs
  table(el) {
    let extra = {};
    try { extra = JSON.parse(el.getAttribute('data-opensw') || '{}'); } catch (e) { /* written by another program */ }
    const rows = [];
    for (const tr of el.getElementsByTagNameNS('*', 'tr')) {
      if (tr.closest('table') !== el) continue; // a table inside a cell
      const cells = [];
      for (const td of tr.children) {
        if (td.localName !== 'td' && td.localName !== 'th') continue;
        const inner = [];
        this.blocks(td, inner);
        const paras = inner.filter((n) => n.type.name === 'paragraph');
        if (!paras.length) paras.push(schema.nodes.paragraph.create());
        const align = { left: 'l', center: 'c', right: 'r' }[td.getAttribute('align') || ''] || null;
        cells.push(schema.nodes.table_cell.create({
          colspan: +td.getAttribute('colspan') || 1, rowspan: +td.getAttribute('rowspan') || 1,
          align, spec: td.getAttribute('data-opensw') || null,
        }, paras));
      }
      if (cells.length) rows.push(schema.nodes.table_row.create({ before: tr.getAttribute('data-opensw') || '' }, cells));
    }
    if (!rows.length) rows.push(schema.nodes.table_row.create(null, [schema.nodes.table_cell.create(null, [schema.nodes.paragraph.create()])]));
    return schema.nodes.table.create({ colspec: extra.colspec ?? null, after: extra.after ?? '' }, rows);
  }

  inlineOf(el, marks = []) {
    const arr = [];
    for (const c of el.childNodes) {
      if (c.nodeType === 1 && this.isBlock(c) && c.localName !== 'math') continue;
      this.inline(c, marks, arr);
    }
    return trimInline(arr);
  }

  inline(node, marks, arr) {
    if (node.nodeType === 3 || node.nodeType === 4) {
      const text = node.nodeValue.replace(/[ \t\n\r]+/g, ' '); // only ASCII white space: no-break and thin spaces stay
      if (text) arr.push(schema.text(text, marks.map((m) => (typeof m === 'string' ? schema.marks[m].create() : m))));
      return;
    }
    if (node.nodeType !== 1) return;
    const t = node.localName;
    if (SKIP.has(t)) return;
    if (t === 'math') { arr.push(schema.nodes.math_inline.create({ latex: mathLatex(node) })); return; }
    if (t in MARK_TAGS) { for (const c of node.childNodes) this.inline(c, [...marks, MARK_TAGS[t]], arr); return; }
    if (SIZE_TAGS.has(t) || t === 'fontcolor') {
      const m = t === 'fontcolor' ? schema.marks.color.create({ color: node.getAttribute('color') || 'black' }) : schema.marks.size.create({ size: t });
      for (const c of node.childNodes) this.inline(c, [...marks.filter((x) => typeof x === 'string' || x.type !== m.type), m], arr);
      return;
    }
    if (t === 'notewrapper' || t === 'note') {
      const note = t === 'note' ? node : Array.from(node.children).find((c) => c.localName === 'note');
      if (!note) return;
      const kind = node.getAttribute('data-opensw') === 'thanks' ? 'thanks' : note.getAttribute('type') === 'footnote' ? 'footnote' : 'margin';
      const content = [];
      for (const c of note.children) { if (content.length) content.push(schema.nodes.hard_break.create()); this.inline(c, [], content); }
      const ok = trimInline(content).filter((n) => schema.nodes.note.contentMatch.matchType(n.type) || n.isText);
      arr.push(schema.nodes.note.create({ kind }, ok));
      return;
    }
    if (t === 'citation') {
      const remark = node.getAttribute('hasRemark') === 'true' ? Array.from(node.children).find((c) => c.localName === 'biblabel')?.textContent.trim() || null : null;
      arr.push(schema.nodes.cite.create({ keys: node.getAttribute('citekey') || '', note: remark, kind: node.getAttribute('nocite') === 'true' ? 'nocite' : 'cite' }));
      return;
    }
    if (t === 'indexitem') {
      let entry = node.getAttribute('data-opensw');
      if (entry == null) { // written by SW 6: rebuild the LaTeX entry
        const spec = (k) => Array.from(node.children).find((c) => c.localName === k)?.textContent;
        entry = ['pri', 'sec', 'ter'].map((k) => [node.getAttribute(k), spec(k + 'spec')]).filter(([v]) => v)
          .map(([v, sp]) => (sp != null ? `${v}@${sp}` : v)).join('!') + (node.getAttribute('enc') ? '|' + node.getAttribute('enc') : '');
      }
      arr.push(schema.nodes.index_entry.create({ entry }));
      return;
    }
    if (t === 'a' && !node.getAttribute('href') && (node.getAttribute('key') || node.getAttribute('name'))) { // a marker
      arr.push(schema.nodes.marker.create({ key: node.getAttribute('key') || node.getAttribute('name') }));
      return;
    }
    if (t === 'a') {
      const extra = opensw(node) || {};
      const link = schema.marks.link.create({ href: node.getAttribute('href') || '', kind: extra.kind ?? null, sw5: extra.sw5 ?? null });
      for (const c of node.childNodes) this.inline(c, [...marks, link], arr);
      return;
    }
    if (t === 'texb') { arr.push(schema.nodes.tex_field.create({ tex: node.textContent.trim() })); return; }
    if (t === 'texlogo') { arr.push(schema.text(node.getAttribute('name') === 'latex' ? 'LaTeX' : 'TeX', mk(marks))); return; }
    if (t === 'br' && node.getAttribute('type') === '_moz') return; // SW 6's cursor placeholder
    if (t === 'msibr' || t === 'br') {
      // the kinds of break SW 6 has; a plain new line is a line break here
      const type = node.getAttribute('type') || '';
      const tex = { pageBreak: '\\pagebreak', newPage: '\\newpage', lineBreak: '\\linebreak', noBreak: '\\nolinebreak' }[type];
      if (type === 'allowBreak') return;
      if (type === 'discretionaryHyphen') { arr.push(schema.text('­', mk(marks))); return; }
      arr.push(tex ? schema.nodes.tex_field.create({ tex }) : schema.nodes.hard_break.create());
      return;
    }
    if (t === 'hspace') {
      const type = node.getAttribute('type') || '';
      const ch = { requiredSpace: ' ', thinSpace: ' ', medSpace: ' ', emSpace: ' ', twoEmSpace: '  ', zeroSpace: '' }[type];
      if (ch != null) { if (ch) arr.push(schema.text(ch, mk(marks))); return; }
      const dim = node.getAttribute('dim');
      arr.push(dim ? schema.nodes.tex_field.create({ tex: `\\hspace*{${dim}}` }) : schema.text(' ', mk(marks)));
      return;
    }
    if (t === 'vspace') {
      const type = node.getAttribute('type') || '';
      const tex = { smallSkip: '\\smallskip', mediumSkip: '\\medskip', bigSkip: '\\bigskip', strut: '\\strut', mathStrut: '\\mathstrut' }[type]
        || (node.getAttribute('dim') ? `\\vspace*{${node.getAttribute('dim')}}` : '\\bigskip');
      arr.push(schema.nodes.tex_field.create({ tex }));
      return;
    }
    if (t === 'rawTeX') { arr.push(schema.nodes.tex_field.create({ tex: (node.getAttribute('tex') || '') + '{' + node.textContent + '}' + (node.getAttribute('post') || '') })); return; }
    if (t === 'verb' || t === 'verbstar') { arr.push(schema.text(node.textContent || ' ', [...mk(marks), schema.marks.code.create()])); return; }
    if (t === 'QTR') { // a 5.5 text tag kept by SW 6
      const tag = node.getAttribute('type') || '';
      const m = { bf: 'bold', textbf: 'bold', it: 'italic', em: 'italic', emph: 'italic', textit: 'italic', tt: 'code', texttt: 'code', sc: 'smallcaps', textsc: 'smallcaps', sf: 'sans', textsf: 'sans' }[tag];
      for (const c of node.childNodes) this.inline(c, m ? [...marks, m] : marks, arr);
      return;
    }
    if (t === 'graph') { // an SW 6 plot: its snapshot picture; the plot itself goes back unchanged
      const frame = node.getElementsByTagNameNS('*', 'msiframe')[0];
      if (frame) {
        const img = this.picture(frame);
        arr.push(img.type.create({ ...img.attrs, plot: true, raw6: new XMLSerializer().serializeToString(node) }));
      }
      return;
    }
    if (t === 'citation') { arr.push(schema.text(`[${node.getAttribute('citekey')}]`, mk(marks))); return; }
    if (t === 'xref') {
      const kind = node.getAttribute('reftype') === 'page' ? 'pageref' : node.getAttribute('data-opensw') === 'eqref' ? 'eqref' : 'ref';
      arr.push(schema.nodes.ref.create({ key: node.getAttribute('key') || '', kind }));
      return;
    }
    if (t === 'descriptionLabel') { for (const c of node.childNodes) this.inline(c, [...marks, 'bold'], arr); arr.push(schema.text(' ')); return; }
    if (t === 'msiframe' && node.getAttribute('frametype') !== 'table' && node.getElementsByTagNameNS('*', 'object').length) {
      arr.push(this.picture(node));
      return;
    }
    if (t === 'object' || t === 'img') {
      const p = node.getAttribute('data') || node.getAttribute('src');
      if (p) arr.push(schema.nodes.image.create({ src: this.images[p] || null, path: p, ...pxSize(node) }));
      return;
    }
    for (const c of node.childNodes) this.inline(c, marks, arr);
  }
}

// width and height from an element's style (CSS px)
function pxSize(el) {
  const st = el.getAttribute('style') || '';
  const w = parseFloat(st.match(/(?:^|;|\s)width:\s*([\d.]+)px/)?.[1]);
  const h = parseFloat(st.match(/(?:^|;|\s)height:\s*([\d.]+)px/)?.[1]);
  return { width: w || null, height: h || null };
}

const mk = (marks) => marks.map((m) => (typeof m === 'string' ? schema.marks[m].create() : m));

// collapse spaces between pieces and trim the ends of a paragraph
function trimInline(arr) {
  const out = [];
  for (const n of arr) {
    if (n.isText) {
      let text = n.text;
      const prev = out[out.length - 1];
      if ((!prev || prev.type.name === 'hard_break' || (prev.isText && prev.text.endsWith(' '))) ) text = text.replace(/^ +/, '');
      if (!text) continue;
      if (prev && prev.isText && prev.sameMarkup(n)) { out[out.length - 1] = schema.text(prev.text + text, prev.marks); continue; }
      out.push(text === n.text ? n : schema.text(text, n.marks));
    } else out.push(n);
  }
  const last = out[out.length - 1];
  if (last && last.isText) {
    const t = last.text.replace(/ +$/, '');
    if (t) out[out.length - 1] = schema.text(t, last.marks); else out.pop();
  }
  return out;
}
