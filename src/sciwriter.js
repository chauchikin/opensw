import { standardTeX } from './tex55.js';
import JSZip from 'jszip';
import { convertLatexToMathMl } from 'mathlive';
import { splitMathAlphaString } from './mathalpha.js';

// Write an editor document back to a Scientific Word .sci file.
// The <head> (preamble) and every other file of the original zip (css,
// graphics, plots) are kept as they were; only main.xhtml's body is rebuilt.

const SECTION_TAG = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];
const MARK_TAG = { bold: 'bold', italic: 'italics', code: 'typewriter', sup: 'sup', sub: 'sub',
  smallcaps: 'smallCaps', sans: 'sansSerif', underline: 'underline' };
// paragraph-like environments with tags of their own in Scientific Word 6
const ENV_TAG = { quote: 'shortQuote', quotation: 'longQuotation' };
const FRONT_TAG = { tableofcontents: 'maketoc', listoffigures: 'makelof', listoftables: 'makelot', printindex: 'printindex' };
const json = (o) => escAttr(JSON.stringify(o));

// an index entry as SW 6 keeps it: pri / sec / ter (sort text), enc (page format);
// the entry as LaTeX writes it goes along in data-opensw
function indexXML(entry) {
  const [main, enc] = entry.split(/(?<!")\|/);
  const levels = main.split(/(?<!")!/).map((p) => p.split(/(?<!")@/));
  const at = ['pri', 'sec', 'ter'].map((k, i) => (levels[i] ? ` ${k}="${escAttr(levels[i][0])}"` : '')).join('');
  const specs = ['prispec', 'secspec', 'terspec'].map((k, i) => (levels[i] && levels[i][1] != null ? `<${k}>${esc(levels[i][1])}</${k}>` : '')).join('');
  return `<indexitem${at}${enc ? ` enc="${escAttr(enc)}"` : ''} data-opensw="${escAttr(entry)}">${specs}</indexitem>`;
}
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');
const cdata = (s) => '<![CDATA[' + s.replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';

// MathLive writes HTML entities such as &ne;, which XML does not know:
// turn them into the characters themselves
const XML_ENTITIES = new Set(['lt', 'gt', 'amp', 'quot', 'apos']);
const decoder = document.createElement('textarea');
function xmlEntities(s) {
  return s.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
    if (XML_ENTITIES.has(name)) return m;
    decoder.innerHTML = m;
    return esc(decoder.value);
  });
}

// Presentation MathML for a formula, in the form Scientific Word reads best:
// XML-safe characters, and 𝔹-style letters written as <mi mathvariant="double-struck">B</mi>.
export function sciMathML(latex) {
  let inner;
  try { inner = xmlEntities(convertLatexToMathMl(standardTeX(latex))); } catch (e) { return ''; }
  return inner.replace(/<mi>([^<]+)<\/mi>/g, (m, text) => {
    const r = splitMathAlphaString(text);
    return r ? `<mi mathvariant="${r[0]}">${r[1]}</mi>` : m;
  });
}

// The LaTeX source goes along as an annotation, so this editor gets the exact
// formula back (MathML loses some of it, e.g. \mathcal). sci.js uses the
// annotation only while the MathML still matches it, i.e. nobody edited the
// formula elsewhere since.
function mathml(latex, display) {
  const ann = `<annotation encoding="application/x-tex">${esc(latex)}</annotation>`;
  return `<math xmlns="${MATHML_NS}"${display ? ' display="block"' : ''}><semantics><mrow>${sciMathML(latex)}</mrow>${ann}</semantics></math>`;
}

// A picture as Scientific Word 6 keeps it: a frame round an <object>. What SW 6
// has no attribute for (the 5.x frame, TeX sizes) goes in data-opensw.
// pathOf (set by writeSci) gives the picture's file inside the .sci.
let pathOf = (p) => p;
function pictureXML(a) {
  if (a.raw6) return a.raw6.replace(/\sxmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, ''); // an SW 6 plot, as it came
  const p = escAttr(pathOf(a.path || ''));
  if (!p) return '';
  const pos = a.place === 'float' ? 'floating' : a.place === 'display' ? 'center' : 'inline';
  const inches = (px) => (px ? +(px / 96).toFixed(4) : null);
  const size = (a.width ? `width: ${a.width}px;` : '') + (a.height ? ` height: ${a.height}px;` : '');
  const extra = {};
  for (const k of ['frame', 'texw', 'texh', 'name', 'plot', 'opts', 'floattype']) if (a[k]) extra[k] = a[k];
  if (p !== escAttr(a.path)) extra.path = a.path; // the name the document used (a 5.x frame names it)
  const cap = a.place === 'float'
    ? `<imagecaption align="bottom"${a.label ? ` key="${escAttr(a.label)}" id="${escAttr(a.label)}"` : ''}><bodyText>${esc(a.caption || '')}</bodyText></imagecaption>` : '';
  return `<msiframe frametype="image" units="in" pos="${pos}"${a.width ? ` width="${inches(a.width)}"` : ''}${a.height ? ` height="${inches(a.height)}"` : ''}`
    + `${a.placement ? ` placeLocation="${escAttr(a.placement)}"` : ''}${Object.keys(extra).length ? ` data-opensw="${escAttr(JSON.stringify(extra))}"` : ''}>`
    + `<object data="${p}" src="${p}" req="graphics"${size ? ` style="${size.trim()}"` : ''}/>${cap}</msiframe>`;
}

function inline(node) {
  let out = '';
  node.forEach((child) => {
    let s;
    const t = child.type.name;
    if (child.isText) s = esc(child.text);
    else if (t === 'math_inline') s = mathml(child.attrs.latex, false);
    else if (t === 'tex_field') s = `<texb enc="1" name="TeX field">${cdata(child.attrs.tex)}</texb>`;
    else if (t === 'hard_break') s = '<msibr/>';
    else if (t === 'marker') s = `<a name="${escAttr(child.attrs.key)}" key="${escAttr(child.attrs.key)}" id="${escAttr(child.attrs.key)}"/>`;
    else if (t === 'ref') s = `<xref key="${escAttr(child.attrs.key)}" href="${escAttr(child.attrs.key)}" reftype="${child.attrs.kind === 'pageref' ? 'page' : 'obj'}"${child.attrs.kind === 'eqref' ? ' data-opensw="eqref"' : ''}/>`;
    else if (t === 'image') s = pictureXML(child.attrs);
    else if (t === 'note') {
      // a note's text is one paragraph; \thanks is a footnote of the title or author
      const k = child.attrs.kind;
      const type = k === 'margin' ? 'marginnote' : 'footnote';
      s = `<notewrapper${type === 'footnote' ? ' type="footnote"' : ''}${k === 'thanks' ? ' data-opensw="thanks"' : ''}><note type="${type}" hide="false"><bodyText>${inline(child)}</bodyText></note></notewrapper>`;
    } else if (t === 'cite') {
      const a = child.attrs;
      s = `<citation citekey="${escAttr(a.keys)}" hasRemark="${a.note ? 'true' : 'false'}"${a.kind === 'nocite' ? ' nocite="true"' : ''}>${a.note ? `<biblabel class="remark">${esc(a.note)}</biblabel>` : ''}</citation>`;
    } else if (t === 'index_entry') s = indexXML(child.attrs.entry);
    else s = '';
    for (const m of child.marks) {
      if (m.type.name === 'link') {
        const extra = m.attrs.kind || m.attrs.sw5 ? ` data-opensw="${json({ kind: m.attrs.kind, sw5: m.attrs.sw5 })}"` : '';
        s = `<a href="${escAttr(m.attrs.href)}"${extra}>${s}</a>`;
      } else if (m.type.name === 'size') s = `<${m.attrs.size}>${s}</${m.attrs.size}>`;
      else if (m.type.name === 'color') s = `<fontcolor color="${escAttr(m.attrs.color)}">${s}</fontcolor>`;
      else if (MARK_TAG[m.type.name]) s = `<${MARK_TAG[m.type.name]}>${s}</${MARK_TAG[m.type.name]}>`;
    }
    out += s;
  });
  return out;
}

function block(node) {
  switch (node.type.name) {
    case 'paragraph': return `<bodyText>${inline(node)}</bodyText>\n`;
    case 'title': {
      // form: a 5.x heading line (a centred big line), kept for opensw in data-opensw
      const form = node.attrs.form ? ` data-opensw="${json({ form: node.attrs.form })}"` : '';
      const date = node.attrs.date != null ? `<date data-opensw="${escAttr(node.attrs.date)}">${esc(node.attrs.date)}</date>\n` : '';
      return `<title${form}>${inline(node)}</title>\n${date}`;
    }
    case 'bibliography': {
      let s = '';
      node.forEach((it) => {
        const lab = it.attrs.label != null ? `<biblabel class="bibitemlabel">${esc(it.attrs.label)}</biblabel>` : '';
        s += `<bibitem hasLabel="${it.attrs.label != null}">${lab}<bibkey>${esc(it.attrs.key)}</bibkey><bodyText>${inline(it)}</bodyText></bibitem>\n`;
      });
      return `<bibliography data-opensw="${json({ widest: node.attrs.widest })}">\n${s}</bibliography>\n`;
    }
    case 'bibtex': return `<bodyText><bibtexbibliography databaseFile="${escAttr(node.attrs.files)}" styleFile="${escAttr(node.attrs.style)}"/></bodyText>\n`;
    case 'toc': return `<bodyText><${FRONT_TAG[node.attrs.kind]}/></bodyText>\n`;
    case 'appendix': return '<bodyText><appendix/></bodyText>\n';
    case 'front_field': return `<${node.attrs.cmd}>${inline(node)}</${node.attrs.cmd}>\n`;
    // SW 6 has no subdocument tag a .tex can map to: the command goes as a TeX field
    case 'subdoc': return `<bodyText><texb enc="1" name="TeX field" data-opensw="${json({ subdoc: node.attrs.file })}">${cdata(node.attrs.tex || `\\input{${node.attrs.file}}`)}</texb></bodyText>\n`;
    case 'math_display': {
      // Scientific Word 6 numbers every display unless told numbering="none"
      const a = node.attrs;
      const rows = a.rows || [{ numbered: a.numbered, label: a.label, tag: a.tag }];
      const numbered = rows.some((r) => r.numbered || r.tag != null);
      const label = rows.find((r) => r.label)?.label;
      // what Scientific Word 6 has no attribute for (row numbers, \tag, the LaTeX environment) goes in data-opensw
      const extra = a.rows || a.tag != null || a.env ? ` data-opensw="${escAttr(JSON.stringify({ rows: a.rows, tag: a.tag, env: a.env }))}"` : '';
      const attrs = (numbered ? '' : ' numbering="none"') + (label ? ` marker="${escAttr(label)}" id="${escAttr(label)}"` : '') + extra;
      return `<bodyText><msidisplay${attrs}>${mathml(a.latex, true)}</msidisplay></bodyText>\n`;
    }
    case 'env': {
      const k = node.attrs.kind;
      if (ENV_TAG[k]) return `<${ENV_TAG[k]}>${children(node)}</${ENV_TAG[k]}>\n`;
      if (k === 'verse') return `<environment type="verse">${children(node)}</environment>\n`;
      // SW 6 has a flushleft / flushright tag for one paragraph: one per paragraph
      if (k === 'flushleft' || k === 'flushright') {
        let s = '';
        node.forEach((c) => { s += c.type.name === 'paragraph' ? `<${k}>${inline(c)}</${k}>\n` : block(c); });
        return s;
      }
      // a theorem's title: SW 6's lead-in
      const lead = node.attrs.title ? `<envLeadIn><bodyText>${esc(node.attrs.title)}</bodyText></envLeadIn>` : '';
      return `<${k}${lead ? ' leadInType="custom"' : ''}>${lead}${children(node)}</${k}>\n`;
    }
    case 'table': return tableXML(node);
    case 'float_box': {
      // Scientific Word 6 keeps a table and its caption in a floating frame; how
      // LaTeX placed and centred it, and whether it is a figure, go in data-opensw
      const a = node.attrs;
      const caps = [];
      let inner = '';
      let capAt = null;
      node.forEach((c) => {
        if (c.type.name === 'caption') { caps.push(c); capAt = capAt || (inner ? 'bottom' : 'top'); } else inner += block(c);
      });
      const extra = escAttr(JSON.stringify({ env: a.env, placement: a.placement, centered: a.centered }));
      let cap = '';
      for (const c of caps) {
        const key = c.content.content.find((x) => x.type.name === 'marker')?.attrs.key;
        const parts = [];
        c.forEach((x) => { if (x.type.name !== 'marker') parts.push(x); });
        cap += `<imagecaption align="${capAt}"${key ? ` key="${escAttr(key)}" id="${escAttr(key)}"` : ''}><bodyText>${inline(c.copy(c.content.constructor.from(parts)))}</bodyText></imagecaption>\n`;
      }
      return `<msiframe frametype="table" pos="floating" captionloc="${capAt || 'bottom'}"${a.placement ? ` placeLocation="${escAttr(a.placement)}"` : ''} data-opensw="${extra}">\n${inner}${cap}</msiframe>\n`;
    }
    case 'bullet_list': case 'ordered_list': {
      const desc = node.attrs.kind === 'description';
      const [list, item, labelTag] = node.type.name === 'ordered_list' ? ['numberedlist', 'numberedListItem', 'numberedLabel']
        : desc ? ['descriptionlist', 'descriptionListItem', 'descriptionLabel'] : ['bulletlist', 'bulletListItem', 'bulletLabel'];
      let s = '';
      node.forEach((li) => {
        const lab = li.attrs.label != null ? `<${labelTag} data-opensw="${escAttr(li.attrs.label)}">${esc(li.attrs.label)}</${labelTag}>` : '';
        // a description's term sits at the start of the item's first paragraph
        let inner = children(li);
        if (lab && desc) inner = inner.replace(/^<bodyText>/, '<bodyText>' + lab);
        else inner = lab + inner;
        s += `<${item}>${inner}</${item}>\n`;
      });
      return `<bodyText><${list}>\n${s}</${list}></bodyText>\n`;
    }
    case 'verbatim': return `<verbatim>${esc(node.textContent).replace(/\n/g, '<br/>')}</verbatim>\n`;
    default: return children(node);
  }
}

// A table; the LaTeX column spec and rules go in data-opensw
function tableXML(node) {
  const a = node.attrs;
  const extra = a.colspec || a.after ? ` data-opensw="${escAttr(JSON.stringify({ colspec: a.colspec, after: a.after }))}"` : '';
  let rows = '';
  node.forEach((row) => {
    let cells = '';
    row.forEach((cell) => {
      const c = cell.attrs;
      const at = (c.colspan > 1 ? ` colspan="${c.colspan}"` : '') + (c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : '')
        + (c.align ? ` align="${{ l: 'left', c: 'center', r: 'right' }[c.align]}"` : '')
        + (c.spec ? ` data-opensw="${escAttr(c.spec)}"` : '');
      cells += `<td${at}>${children(cell)}</td>`;
    });
    rows += `<tr${row.attrs.before ? ` data-opensw="${escAttr(row.attrs.before)}"` : ''}>${cells}</tr>\n`;
  });
  return `<table cellpadding="4" req="tabulary"${extra}><tbody>\n${rows}</tbody></table>\n`;
}

function children(node) {
  let s = '';
  node.forEach((c) => { s += block(c); });
  return s;
}

// Headings are flat in the editor but nested <section> elements in .sci.
function body(doc) {
  let out = '';
  const open = []; // levels of the sections currently open
  doc.forEach((node) => {
    if (node.type.name === 'heading') {
      const level = node.attrs.level;
      while (open.length && open[open.length - 1] >= level) out += `</${SECTION_TAG[open.pop()]}>\n`;
      out += `<${SECTION_TAG[level]}${node.attrs.nonum ? ' nonum="true"' : ''}>\n<sectiontitle>${inline(node)}</sectiontitle>\n`;
      open.push(level);
    } else out += block(node);
  });
  while (open.length) out += `</${SECTION_TAG[open.pop()]}>\n`;
  return out;
}

// zip: the opened .sci (or the blank template); headXML: its <head> element
// files: Map(path in the document -> bytes) of pictures that are not in zip yet
// (pictures of a 5.x document); they go in the .sci's graphics folder
export async function writeSci(doc, zip, headXML, files = new Map()) {
  const added = new Map(); // path -> { name in the zip, bytes, new: not in the zip yet }
  const same = async (name, bytes) => {
    const old = await zip.file(name).async('uint8array');
    return old.length === bytes.length && old.every((b, i) => b === bytes[i]);
  };
  for (const [path, bytes] of files) {
    if (zip.file(path)) continue;
    let base = 'graphics/' + path.split(/[\\/]/).pop();
    // a 5.x plot drawn here is a PNG kept under the plot's .wmf name
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && !/\.png$/i.test(base)) base += '.png';
    let name = base;
    for (let k = 2; ; k++) {
      if (zip.file(name) && (await same(name, bytes))) { added.set(path, { name, bytes, new: false }); break; }
      if (!zip.file(name) && ![...added.values()].some((v) => v.name === name)) { added.set(path, { name, bytes, new: true }); break; }
      name = base.replace(/(\.[^./]*)?$/, `-${k}$1`);
    }
  }
  pathOf = (p) => added.get(p)?.name || p;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet href="css/my.css" type="text/css"?>
<?sw-tagdefs href="resource://app/res/tagdefs/latexdefs.xml" type="text/xml" ?>
<html xmlns="http://www.w3.org/1999/xhtml">
${headXML}
<body>
${body(doc)}</body>
</html>
`;
  const out = new JSZip();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (path === 'main.xhtml') continue;
    if (entry.dir) out.folder(path);
    else out.file(path, await entry.async('uint8array'));
  }
  for (const f of added.values()) if (f.new) out.file(f.name, f.bytes);
  out.file('main.xhtml', xml);
  return out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

// A new document's .sci container: written by opensw, with the head a Scientific
// Word 6 document needs (document class, packages, theorem environments).
const THEOREMS = ['theorem', 'lemma', 'corollary', 'proposition', 'conjecture', 'definition', 'example', 'exercise',
  'remark', 'notation', 'problem', 'axiom', 'case', 'claim', 'conclusion', 'condition', 'criterion', 'solution', 'summary'];
export function blankSci() {
  const now = new Date().toString();
  const pre = THEOREMS.map((t, i) => `\\newtheorem{${t}}${i ? '[theorem]' : ''}{${t[0].toUpperCase()}${t.slice(1)}}`).join('\n');
  const headXML = `<head><sw-meta id="sw-meta" product="opensw" created="${esc(now)}" lastrevised="${esc(now)}"/>
    <preamble hide="true">
      <documentclass class="article"/>
      <requirespackage req="amsfonts" pri="010"/>
      <requirespackage req="amsmath" pri="010"/>
      <preambleTeX>${cdata(pre)}</preambleTeX>
    </preamble>
  </head>`;
  const zip = new JSZip();
  zip.file('css/my.css', '/* opensw */\n');
  return { zip, headXML };
}
