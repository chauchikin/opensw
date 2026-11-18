// File > Export as Word: a .docx with Word's own equations (they stay editable in
// Word), headings, lists, tables, pictures and footnotes. Formulas go
// LaTeX -> MathML (MathLive) -> Word equation objects (the docx library).
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ExternalHyperlink, ImageRun,
  Table, TableRow, TableCell, WidthType, BorderStyle, FootnoteReferenceRun, LevelFormat, TabStopType,
  Math as OMath, MathRun, MathFraction, MathRadical, MathSuperScript, MathSubScript, MathSubSuperScript,
  MathSum, MathIntegral, MathLimitLower, MathLimitUpper,
} from 'docx';
import { convertLatexToMathMl } from 'mathlive';
import { TableMap } from 'prosemirror-tables';
import { computeNumbers } from './numbering.js';
import { standardTeX, mathForDisplay } from './tex55.js';
import { envLabel, PLAIN_ENVS, FRONT_LABELS } from './schema.js';
import { _t } from './i18n.js';

// ---------- formulas ----------
const SUM_OPS = new Set(['∑']);
const INT_OPS = new Set(['∫', '∬', '∭', '∮']);

function mathmlElement(latex) {
  let ml;
  try { ml = convertLatexToMathMl(mathForDisplay(standardTeX(latex))); } catch (e) { return null; }
  const doc = new DOMParser().parseFromString(`<math>${ml}</math>`, 'text/html');
  return doc.querySelector('math');
}

// the text of a token element (mi, mn, mo, mtext)
// (a missing element, as in an msub with one child from an odd formula, is empty)
const tokenText = (el) => (el ? el.textContent.replace(/⁡|⁢|⁣/g, '') : ''); // invisible operators

// MathML element -> list of docx math components
function omml(el) {
  const kids = () => Array.from(el.children);
  const one = (e) => (e ? omml(e) : []);
  switch (el.localName) {
    case 'mi': case 'mn': case 'mo': case 'mtext': case 'ms': {
      const t = tokenText(el);
      return t ? [new MathRun(t)] : [];
    }
    case 'mspace': return [new MathRun(' ')];
    case 'mfrac': return [new MathFraction({ numerator: one(el.children[0]), denominator: one(el.children[1]) })];
    case 'msqrt': return [new MathRadical({ children: row(kids()) })];
    case 'mroot': return [new MathRadical({ children: one(el.children[0]), degree: one(el.children[1]) })];
    case 'msup': return [new MathSuperScript({ children: one(el.children[0]), superScript: one(el.children[1]) })];
    case 'msub': return [new MathSubScript({ children: one(el.children[0]), subScript: one(el.children[1]) })];
    case 'msubsup': return [new MathSubSuperScript({ children: one(el.children[0]), subScript: one(el.children[1]), superScript: one(el.children[2]) })];
    case 'munder': {
      const base = tokenText(el.children[0]);
      if (/^(lim|max|min|sup|inf|limsup|liminf)$/.test(base)) return [new MathLimitLower({ children: [new MathRun(base)], limit: one(el.children[1]) })];
      return [new MathSubScript({ children: one(el.children[0]), subScript: one(el.children[1]) })];
    }
    case 'mover': {
      const acc = tokenText(el.children[1]);
      if (acc.length === 1 && /[̀-ͯ¯^~˙¨→]/.test(acc)) return [...one(el.children[0]), new MathRun(acc)];
      return [new MathLimitUpper({ children: one(el.children[0]), limit: one(el.children[1]) })];
    }
    case 'munderover': return [new MathSubSuperScript({ children: one(el.children[0]), subScript: one(el.children[1]), superScript: one(el.children[2]) })];
    case 'mtable': {
      // Word equations here have no matrix object: rows written as (a, b; c, d)
      const rows = Array.from(el.children).map((tr) => Array.from(tr.children).map((td) => row(Array.from(td.children))));
      const out = [];
      rows.forEach((r, i) => {
        if (i) out.push(new MathRun('; '));
        r.forEach((cell, j) => { if (j) out.push(new MathRun(', ')); out.push(...cell); });
      });
      return out;
    }
    default: return row(kids());
  }
}

// a row of elements; a big operator (∑, ∫) takes the element after it as its body
function row(elements) {
  const out = [];
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const lim = (k) => (el.children[k] ? omml(el.children[k]) : []);
    const op = /^(munderover|msubsup|munder|msub|mover|msup|mo)$/.test(el.localName)
      ? tokenText(el.localName === 'mo' ? el : el.children[0]) : '';
    if (SUM_OPS.has(op) || INT_OPS.has(op)) {
      const body = elements[i + 1] ? omml(elements[++i]) : [];
      const sub = /under|sub/.test(el.localName) ? lim(1) : [];
      const sup = el.localName === 'munderover' || el.localName === 'msubsup' ? lim(2) : /over|sup/.test(el.localName) ? lim(1) : [];
      const Obj = SUM_OPS.has(op) ? MathSum : MathIntegral;
      out.push(new Obj({ children: body, ...(sub.length ? { subScript: sub } : {}), ...(sup.length ? { superScript: sup } : {}) }));
      continue;
    }
    out.push(...omml(el));
  }
  return out;
}

function equation(latex) {
  const m = mathmlElement(latex);
  const children = m ? omml(m) : [new MathRun(latex)];
  return new OMath({ children: children.length ? children : [new MathRun(' ')] });
}

// ---------- the document ----------
const SIZE_HALFPT = { tiny: 10, scriptsize: 14, footnotesize: 16, small: 18, large: 28, Large: 34, LARGE: 40, huge: 48, Huge: 58 };
const HEADING = [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5];
const imageType = (b) => (b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b[0] === 0x47 && b[1] === 0x49 ? 'gif' : b[0] === 0x42 && b[1] === 0x4d ? 'bmp' : null);
const TEXT_WIDTH = 9000; // twips, A4 with 1in margins (a little less than 6.5in)

// pictures: Map(path -> bytes) of the pictures the caller has
export async function toDocx(doc, meta = {}, pictures = new Map()) {
  const nums = computeNumbers(doc, meta);
  const posOf = new Map();
  doc.descendants((n, pos) => { posOf.set(n, pos); });
  const footnotes = {};
  let fnId = 0;
  let listInstance = 0;

  function runs(node, base = {}) {
    const out = [];
    node.forEach((c) => {
      const t = c.type.name;
      const style = { ...base };
      let link = null;
      for (const m of c.marks) {
        const n = m.type.name;
        if (n === 'bold') style.bold = true;
        else if (n === 'italic') style.italics = true;
        else if (n === 'underline') style.underline = {};
        else if (n === 'smallcaps') style.smallCaps = true;
        else if (n === 'code') style.font = 'Courier New';
        else if (n === 'sup') style.superScript = true;
        else if (n === 'sub') style.subScript = true;
        else if (n === 'size') style.size = SIZE_HALFPT[m.attrs.size];
        else if (n === 'color' && /^#?[0-9a-fA-F]{6}$/.test(m.attrs.color)) style.color = m.attrs.color.replace('#', '');
        else if (n === 'color') style.color = { red: 'FF0000', blue: '0000FF', green: '008000', black: '000000' }[m.attrs.color] || undefined;
        else if (n === 'link') link = m.attrs.href;
      }
      let r = null;
      if (c.isText) r = new TextRun({ text: c.text, ...style, ...(link ? { style: 'Hyperlink' } : {}) });
      else if (t === 'math_inline') r = equation(c.attrs.latex);
      else if (t === 'hard_break') r = new TextRun({ break: 1 });
      else if (t === 'ref') {
        const v = nums.keys.get(c.attrs.key);
        r = new TextRun({ text: c.attrs.kind === 'pageref' ? '?' : v == null ? '??' : c.attrs.kind === 'eqref' ? `(${v})` : v, ...style });
      } else if (t === 'cite' && c.attrs.kind !== 'nocite') {
        const shown = c.attrs.keys.split(',').map((k) => nums.bib.get(k) || k).join(', ');
        r = new TextRun({ text: `[${shown}${c.attrs.note ? ', ' + c.attrs.note.replace(/~/g, ' ') : ''}]`, ...style });
      } else if (t === 'note') {
        fnId++;
        footnotes[fnId] = { children: [new Paragraph({ children: runs(c) })] };
        r = new FootnoteReferenceRun(fnId);
      } else if (t === 'image') r = picture(c);
      else if (t === 'tex_field' && !/^\\(big|med|small)skip/.test(c.attrs.tex.trim())) r = new TextRun({ text: c.attrs.tex, font: 'Courier New', color: '666666' });
      if (!r) return;
      // a web address becomes a Word link; a place in the document stays plain text
      out.push(link && c.isText && !link.startsWith('#') ? new ExternalHyperlink({ link, children: [r] }) : r);
    });
    return out;
  }

  function picture(c) {
    const a = c.attrs;
    const bytes = pictures.get(a.path);
    const type = bytes && imageType(bytes);
    if (!type) return new TextRun({ text: `[${(a.path || _t('圖片')).split('/').pop()}]`, color: '666666' });
    return new ImageRun({ type, data: bytes, transformation: { width: Math.round(a.width || 300), height: Math.round(a.height || 200) } });
  }

  const para = (children, opts = {}) => new Paragraph({ children, ...opts });

  function blocks(node, ctx = {}) {
    const out = [];
    node.forEach((c) => out.push(...block(c, ctx)));
    return out;
  }

  function block(node, ctx) {
    const t = node.type.name;
    switch (t) {
      case 'paragraph': {
        const kids = runs(node);
        const lone = node.childCount === 1 && node.firstChild.type.name === 'image' && node.firstChild.attrs.place !== 'inline';
        const out = [para(kids, { ...(lone || ctx.center ? { alignment: AlignmentType.CENTER } : {}),
          ...(ctx.right ? { alignment: AlignmentType.RIGHT } : {}), ...(ctx.indent ? { indent: { left: 720, right: 720 } } : {}) })];
        // a floating picture's caption
        node.forEach((im) => {
          if (im.type.name === 'image' && im.attrs.place === 'float') {
            out.push(para([new TextRun({ text: `${nums.captions.get(posOf.get(im)) || ''}${im.attrs.caption ? _t('：') + im.attrs.caption : ''}`, italics: true })], { alignment: AlignmentType.CENTER }));
          }
        });
        return out;
      }
      case 'title': return [para(runs(node), { heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER })];
      case 'heading': return [para(runs(node), { heading: HEADING[node.attrs.level] || HeadingLevel.HEADING_6 })];
      case 'math_display': {
        const shown = (nums.eq.get(posOf.get(node)) || []).filter(Boolean);
        // centred, its number at the right margin (a centre tab and a right tab, as Word does it)
        if (!shown.length) return [para([equation(node.attrs.latex)], { alignment: AlignmentType.CENTER })];
        return [para([new TextRun('\t'), equation(node.attrs.latex), new TextRun('\t' + shown.join(' '))], {
          tabStops: [{ type: TabStopType.CENTER, position: TEXT_WIDTH / 2 }, { type: TabStopType.RIGHT, position: TEXT_WIDTH }] })];
      }
      case 'env': {
        const k = node.attrs.kind;
        const inner = blocks(node, { ...ctx, center: k === 'centered', right: k === 'flushright', indent: /quote|quotation|verse|abstract/.test(k) });
        const plain = PLAIN_ENVS.has(k) && k !== 'proof' && k !== 'abstract';
        if (!plain && inner.length) {
          const num = nums.envs.get(posOf.get(node));
          const label = `${envLabel(k)}${num ? ' ' + num : ''}${node.attrs.title ? _t('（{0}）', node.attrs.title) : ''}. `;
          // the label goes in front of the first paragraph
          const first = node.firstChild?.type.name === 'paragraph' ? node.firstChild : null;
          if (first) inner[0] = para([new TextRun({ text: label, bold: k !== 'proof', italics: k === 'proof' }), ...runs(first)]);
          else inner.unshift(para([new TextRun({ text: label, bold: true })]));
        }
        return inner;
      }
      case 'bullet_list': case 'ordered_list': {
        const level = ctx.level ?? 0;
        const instance = ++listInstance;
        const out = [];
        node.forEach((li) => {
          li.forEach((c, off, i) => {
            if (c.type.name === 'bullet_list' || c.type.name === 'ordered_list') { out.push(...block(c, { ...ctx, level: level + 1 })); return; }
            if (i === 0 && c.type.name === 'paragraph') {
              const label = li.attrs.label != null ? [new TextRun({ text: li.attrs.label + ' ', bold: node.attrs.kind === 'description' })] : [];
              const ref = li.attrs.label != null ? null : { reference: node.type.name === 'ordered_list' ? 'numbers' : 'bullets', level: Math.min(level, 8), instance };
              out.push(para([...label, ...runs(c)], ref ? { numbering: ref } : { indent: { left: 360 * (level + 1) } }));
            } else out.push(...block(c, { ...ctx, level: level + 1 }));
          });
        });
        return out;
      }
      case 'verbatim': return node.textContent.split('\n').map((l) => para([new TextRun({ text: l, font: 'Courier New' })]));
      case 'table': return [table(node)];
      case 'float_box': {
        const out = [];
        node.forEach((c, off) => {
          if (c.type.name === 'caption') {
            out.push(para([new TextRun({ text: _t('{0}：', nums.captions.get(posOf.get(node) + 1 + off) || ''), italics: true }), ...runs(c, { italics: true })], { alignment: AlignmentType.CENTER }));
          } else out.push(...block(c, { ...ctx, center: true }));
        });
        return out;
      }
      case 'bibliography': {
        const out = [para([new TextRun(_t('參考文獻'))], { heading: HeadingLevel.HEADING_1 })];
        node.forEach((it) => out.push(para([new TextRun(`[${nums.bib.get(it.attrs.key) || it.attrs.key}] `), ...runs(it)])));
        return out;
      }
      case 'front_field': return [para([new TextRun({ text: (FRONT_LABELS[node.attrs.cmd] || node.attrs.cmd) + _t('：'), color: '666666' }), ...runs(node)])];
      case 'bibtex': return [para([new TextRun({ text: _t('（參考文獻來自 BibTeX：{0}）', node.attrs.files), color: '666666' })])];
      case 'toc': case 'appendix': case 'subdoc': return [];
      default: return blocks(node, ctx);
    }
  }

  function table(node) {
    const map = TableMap.get(node);
    const colW = Math.floor(TEXT_WIDTH / map.width);
    const ruled = /\||hline|rule/.test((node.attrs.colspec || '') + node.attrs.after + (node.firstChild?.attrs.before || ''));
    const border = ruled ? { style: BorderStyle.SINGLE, size: 4, color: '000000' } : { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const rows = [];
    node.forEach((r) => {
      const cells = [];
      r.forEach((c) => {
        const align = { l: AlignmentType.LEFT, c: AlignmentType.CENTER, r: AlignmentType.RIGHT }[c.attrs.align];
        const ps = [];
        c.forEach((p) => ps.push(para(runs(p), align ? { alignment: align } : {})));
        cells.push(new TableCell({ children: ps.length ? ps : [para([])], columnSpan: c.attrs.colspan, rowSpan: c.attrs.rowspan,
          width: { size: colW * c.attrs.colspan, type: WidthType.DXA } }));
      });
      rows.push(new TableRow({ children: cells }));
    });
    return new Table({ rows, columnWidths: Array(map.width).fill(colW), width: { size: colW * map.width, type: WidthType.DXA },
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border } });
  }

  const body = blocks(doc);
  const levels = (fmt, text) => Array.from({ length: 9 }, (_, i) => ({ level: i, format: fmt, text: text(i), alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 360 * (i + 1), hanging: 360 } } } }));
  const font = { ascii: 'Times New Roman', hAnsi: 'Times New Roman', eastAsia: 'PMingLiU' };
  const heading = (size) => ({ run: { font, size, bold: true }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } });
  const file = new Document({
    creator: 'opensw',
    title: meta.name || 'document',
    styles: {
      default: {
        document: { run: { font, size: 24 } },
        title: { run: { font, size: 40, bold: true }, paragraph: { spacing: { before: 0, after: 240 }, keepNext: true } },
        heading1: heading(32), heading2: heading(28), heading3: heading(26), heading4: heading(24), heading5: heading(24), heading6: heading(24),
      },
    },
    numbering: { config: [
      { reference: 'bullets', levels: levels(LevelFormat.BULLET, (i) => ['•', '–', '∗'][i % 3]) },
      { reference: 'numbers', levels: levels(LevelFormat.DECIMAL, (i) => `%${i + 1}.`) },
    ] },
    footnotes,
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: body }],
  });
  return new Uint8Array(await (await Packer.toBlob(file)).arrayBuffer());
}
