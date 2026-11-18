// File > Export as HTML: one web page that any browser shows, formulas as MathML
// (browsers draw MathML themselves), pictures inside the page, footnotes at the end.
import { convertLatexToMathMl } from 'mathlive';
import { computeNumbers } from './numbering.js';
import { standardTeX, mathForDisplay } from './tex55.js';
import { envLabel, PLAIN_ENVS, FRONT_LABELS } from './schema.js';
import { _t } from './i18n.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let mathMode = 'mathml';
const mathml = (latex, display) => {
  // Tools > Export Settings: LaTeX for MathJax instead of MathML
  if (mathMode === 'mathjax') return display ? `\\[${esc(mathForDisplay(standardTeX(latex)))}\\]` : `\\(${esc(mathForDisplay(standardTeX(latex)))}\\)`;
  let inner;
  try { inner = convertLatexToMathMl(mathForDisplay(standardTeX(latex))); } catch (e) { inner = `<mtext>${esc(latex)}</mtext>`; }
  return `<math${display ? ' display="block"' : ''}>${inner}</math>`;
};
const MARK_HTML = { bold: 'strong', italic: 'em', code: 'code', sup: 'sup', sub: 'sub', underline: 'u' };
const SIZE_EM = { tiny: 0.5, scriptsize: 0.7, footnotesize: 0.8, small: 0.9, large: 1.2, Large: 1.44, LARGE: 1.73, huge: 2.07, Huge: 2.49 };
const SECTION_TAG = ['h1', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

// pictures: path -> data: URL (given by the caller, who has the files)
export function toHtml(doc, meta = {}, pictures = new Map(), opts = {}) {
  mathMode = opts.math || 'mathml';
  const nums = computeNumbers(doc, meta);
  const notes = [];
  const anchors = new Set();
  const posOf = new Map(); // node -> position, for the numbers computed by position
  doc.descendants((n, pos) => { posOf.set(n, pos); });

  function inline(node) {
    let out = '';
    node.forEach((c) => {
      let s;
      const t = c.type.name;
      if (c.isText) s = esc(c.text);
      else if (t === 'math_inline') s = mathml(c.attrs.latex, false);
      else if (t === 'hard_break') s = '<br>';
      else if (t === 'marker') { anchors.add(c.attrs.key); s = `<a id="${esc(c.attrs.key)}"></a>`; }
      else if (t === 'ref') {
        const v = nums.keys.get(c.attrs.key);
        const text = c.attrs.kind === 'pageref' ? '↑' : v == null ? '??' : c.attrs.kind === 'eqref' ? `(${v})` : v;
        s = `<a href="#${esc(c.attrs.key)}">${esc(text)}</a>`;
      } else if (t === 'cite') {
        if (c.attrs.kind === 'nocite') s = '';
        else {
          const shown = c.attrs.keys.split(',').map((k) => `<a href="#bib-${esc(k)}">${esc(nums.bib.get(k) || k)}</a>`).join(', ');
          s = `[${shown}${c.attrs.note ? ', ' + esc(c.attrs.note.replace(/~/g, ' ')) : ''}]`;
        }
      } else if (t === 'note') {
        if (c.attrs.kind === 'margin') s = `<span class="margin-note">${inline(c)}</span>`;
        else {
          notes.push(inline(c));
          const k = notes.length;
          s = `<sup class="fn"><a id="fnref${k}" href="#fn${k}">${c.attrs.kind === 'thanks' ? '*' : k}</a></sup>`;
        }
      } else if (t === 'image') s = picture(c);
      else if (t === 'html_field') s = c.attrs.html;
      else if (t === 'tex_field') s = /^\\(big|med|small)skip/.test(c.attrs.tex.trim()) ? '<span class="vskip"></span>' : `<code class="tex">${esc(c.attrs.tex)}</code>`;
      else s = '';
      for (const m of c.marks) {
        const n = m.type.name;
        if (n === 'link') s = `<a href="${esc(m.attrs.href)}">${s}</a>`;
        else if (n === 'size') s = `<span style="font-size:${SIZE_EM[m.attrs.size] || 1}em">${s}</span>`;
        else if (n === 'color') s = `<span style="color:${esc(m.attrs.color)}">${s}</span>`;
        else if (n === 'smallcaps') s = `<span style="font-variant:small-caps">${s}</span>`;
        else if (n === 'sans') s = `<span style="font-family:sans-serif">${s}</span>`;
        else if (MARK_HTML[n]) s = `<${MARK_HTML[n]}>${s}</${MARK_HTML[n]}>`;
      }
      out += s;
    });
    return out;
  }

  function picture(c) {
    const a = c.attrs;
    const src = pictures.get(a.path);
    const size = (a.width ? `width:${a.width}px;` : '') + (a.height ? `height:${a.height}px;` : '');
    const img = src ? `<img src="${src}" alt="${esc(a.caption || a.path)}" style="${size}">`
      : `<span class="missing" style="${size}">${esc(a.path || _t('圖片'))}</span>`;
    if (a.place === 'inline') return img;
    if (a.label) anchors.add(a.label);
    const cap = a.place === 'float' ? `<figcaption>${esc(nums.captions.get(posOf.get(c)) || '')}${a.caption ? _t('：') + esc(a.caption) : ''}</figcaption>` : '';
    return `<figure${a.label ? ` id="${esc(a.label)}"` : ''}>${img}${cap}</figure>`;
  }

  function cell(c) {
    const a = c.attrs;
    const at = (a.colspan > 1 ? ` colspan="${a.colspan}"` : '') + (a.rowspan > 1 ? ` rowspan="${a.rowspan}"` : '')
      + (a.align ? ` style="text-align:${{ l: 'left', c: 'center', r: 'right' }[a.align]}"` : '');
    const parts = [];
    c.forEach((p) => parts.push(inline(p)));
    return `<td${at}>${parts.join('<br>')}</td>`;
  }

  function block(node) {
    const t = node.type.name;
    switch (t) {
      case 'paragraph': return `<p>${inline(node)}</p>\n`;
      case 'title': return `<h1 class="title">${inline(node)}</h1>\n${node.attrs.date && node.attrs.date !== '\\today' ? `<p class="date">${esc(node.attrs.date)}</p>\n` : ''}`;
      case 'heading': return `<${SECTION_TAG[node.attrs.level] || 'h6'}>${inline(node)}</${SECTION_TAG[node.attrs.level] || 'h6'}>\n`;
      case 'math_display': {
        const shown = (nums.eq.get(posOf.get(node)) || []).filter(Boolean);
        const a = node.attrs;
        for (const r of a.rows || [a]) if (r.label) anchors.add(r.label);
        const id = (a.rows || [a]).find((r) => r.label)?.label;
        return `<div class="display"${id ? ` id="${esc(id)}"` : ''}>${mathml(a.latex, true)}${shown.length ? `<span class="eqno">${esc(shown.join(' '))}</span>` : ''}</div>\n`;
      }
      case 'env': {
        const k = node.attrs.kind;
        const num = nums.envs.get(posOf.get(node));
        const head = PLAIN_ENVS.has(k) && k !== 'proof' && k !== 'abstract' ? '' : `<span class="env-label">${esc(envLabel(k))}${num ? ' ' + esc(num) : ''}${node.attrs.title ? _t('（{0}）', esc(node.attrs.title)) : ''}.</span> `;
        let inner = '';
        node.forEach((c) => { inner += block(c); });
        if (head) inner = inner.replace(/^<p>/, '<p>' + head);
        return `<div class="env env-${esc(k)}">${inner}</div>\n`;
      }
      case 'bullet_list': case 'ordered_list': {
        const tag = t === 'ordered_list' ? 'ol' : node.attrs.kind === 'description' ? 'dl' : 'ul';
        let s = '';
        node.forEach((li) => {
          let inner = '';
          li.forEach((c) => { inner += block(c); });
          if (tag === 'dl') s += `<dt>${esc(li.attrs.label ?? '')}</dt><dd>${inner}</dd>`;
          else s += `<li${li.attrs.label != null ? ` data-label="${esc(li.attrs.label)}" class="labelled"` : ''}>${inner}</li>`;
        });
        return `<${tag}>${s}</${tag}>\n`;
      }
      case 'verbatim': return `<pre>${esc(node.textContent)}</pre>\n`;
      case 'table': {
        let rows = '';
        node.forEach((r) => { let cs = ''; r.forEach((c) => { cs += cell(c); }); rows += `<tr>${cs}</tr>`; });
        return `<table${/hline|\|/.test((node.attrs.colspec || '') + node.attrs.after) ? ' class="ruled"' : ''}>${rows}</table>\n`;
      }
      case 'float_box': {
        let inner = '';
        let cap = '';
        node.forEach((c, off) => {
          if (c.type.name === 'caption') {
            c.forEach((x) => { if (x.type.name === 'marker') anchors.add(x.attrs.key); });
            cap = `<figcaption>${_t('{0}：{1}', esc(nums.captions.get(posOf.get(node) + 1 + off) || ''), inline(c))}</figcaption>`;
          } else inner += block(c);
        });
        return `<figure>${inner}${cap}</figure>\n`;
      }
      case 'bibliography': {
        let s = '';
        node.forEach((it) => { s += `<li id="bib-${esc(it.attrs.key)}"><span class="biblabel">[${esc(nums.bib.get(it.attrs.key) || it.attrs.key)}]</span> ${inline(it)}</li>`; });
        return `<h2>${_t('參考文獻')}</h2>\n<ul class="bibliography">${s}</ul>\n`;
      }
      case 'bibtex': return `<p class="note">${_t('（參考文獻來自 BibTeX：{0}）', esc(node.attrs.files))}</p>\n`;
      case 'front_field': return `<p class="front"><span>${_t('{0}：', esc(FRONT_LABELS[node.attrs.cmd] || node.attrs.cmd))}</span>${inline(node)}</p>\n`;
      case 'toc': case 'appendix': case 'subdoc': return '';
      default: {
        let s = '';
        node.forEach((c) => { s += block(c); });
        return s;
      }
    }
  }

  let body = '';
  doc.forEach((c) => { body += block(c); });
  if (notes.length) {
    body += '<hr>\n<ol class="footnotes">' + notes.map((n, i) => `<li id="fn${i + 1}">${n} <a href="#fnref${i + 1}">↩</a></li>`).join('') + '</ol>\n';
  }
  const title = esc(doc.firstChild?.type.name === 'title' ? doc.firstChild.textContent : meta.name || 'document');
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="opensw">
<title>${title}</title>
${mathMode === 'mathjax' ? '<script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script>\n' : ''}<style>
body { max-width: 46em; margin: 2em auto; padding: 0 1em; font: 17px/1.6 "Times New Roman", "Noto Serif TC", "PMingLiU", serif; color: #111; }
h1.title { text-align: center; } p.date { text-align: center; }
.display { position: relative; margin: .8em 0; text-align: center; } .eqno { position: absolute; right: 0; top: 50%; transform: translateY(-50%); }
.env { margin: .8em 0; } .env-label { font-weight: bold; } .env-proof .env-label { font-weight: normal; font-style: italic; }
.env-quote, .env-quotation, .env-verse, .env-abstract { margin-left: 2em; margin-right: 2em; } .env-centered { text-align: center; }
.env-flushright { text-align: right; }
table { border-collapse: collapse; margin: .6em auto; } td { padding: 2px 8px; } table.ruled td { border: 1px solid #333; }
figure { text-align: center; margin: 1em 0; } img { max-width: 100%; } .missing { display: inline-block; border: 1px dashed #999; color: #666; font-size: .8em; }
.margin-note { float: right; width: 10em; margin-right: -12em; font-size: .85em; color: #444; }
li.labelled { list-style: none; } li.labelled::before { content: attr(data-label) " "; margin-left: -1.5em; }
.footnotes { font-size: .9em; } .vskip { display: block; height: 1em; } code.tex { color: #555; }
</style>
</head>
<body>
${body}</body>
</html>
`;
}
