// The items of 5.5's menus other than Compute (sw550ENUS.dll menus 10, 23 and 24: File, Edit, Insert,
// View, Go, Tag, Typeset, Tools, Help) that need more than a line in the menu table of src/ui55.js.
// setupMenus55(ctx) -> the actions; ctx gives what src/ui55.js keeps inside setupUI.
import { _t } from './i18n.js';
import { schema } from './schema.js';
import { settings, saveSettings } from './settings.js';
import { isDesktop, writeBytes } from './desktop.js';
import { formulaPng, imagePng } from './copyimage.js';
import { NodeSelection, TextSelection } from 'prosemirror-state';

// Go > Links: 5.5's names and the REL each is kept under (%TCIDATA{<LINK REL="next" HREF="dm1-2.tex">})
export const LINKS55 = () => [['contents', _t('Contents')], ['index', _t('Index')], ['begin', _t('Beginning Document')], ['end', _t('End Document')], ['next', _t('Next Document')],
  ['previous', _t('Previous Document')], ['parent', _t('Parent Document')], ['top', _t('Top Document')], ['bibliography', _t('Bibliography')], ['glossary', _t('Glossary')],
  ['author', _t('Author')], ['copyright', _t('Copyright')], ['disclaimer', _t('Disclaimer')], ['editor', _t('Editor')], ['publisher', _t('Publisher')], ['trademark', _t('Trademark')]];

// the %TCIDATA lines of a 5.x preamble: <META NAME="Title" CONTENT="..">, <LINK REL=".." HREF="..">, Name=value
const TCIDATA = /^%TCIDATA\{(.*)\}[ \t]*$/;
export function docInfo55(preamble) {
  const out = { title: '', links: {}, bib: '' };
  for (const line of (preamble || '').split(/\r?\n/)) {
    const m = line.match(TCIDATA);
    if (!m) continue;
    const meta = m[1].match(/^<META NAME="([^"]*)" CONTENT="([^"]*)">$/);
    const link = m[1].match(/^<LINK REL="([^"]*)" HREF="([^"]*)">$/);
    if (meta && meta[1] === 'Title') out.title = meta[2];
    else if (link) out.links[link[1].toLowerCase()] = link[2];
    else if (m[1].startsWith('BibliographyScheme=')) out.bib = m[1].slice(19);
  }
  return out;
}
// the same preamble with the title, links and bibliography scheme set (lines 5.5 does not know stay)
export function setDocInfo55(preamble, { title, links, bib }) {
  const lines = (preamble || '').split('\n').filter((l) => {
    const m = l.replace(/\r$/, '').match(TCIDATA);
    return !(m && (/^<META NAME="Title"/.test(m[1]) || /^<LINK REL=/.test(m[1]) || (bib != null && m[1].startsWith('BibliographyScheme='))));
  });
  const add = [];
  if (bib) add.push(`%TCIDATA{BibliographyScheme=${bib}}`);
  if (title) add.push(`%TCIDATA{<META NAME="Title" CONTENT="${title.replace(/"/g, "'")}">}`);
  for (const [rel, href] of Object.entries(links || {})) if (href) add.push(`%TCIDATA{<LINK REL="${rel}" HREF="${href.replace(/"/g, '')}">}`);
  if (!add.length) return lines.join('\n');
  // after the last %TCIDATA line, where 5.5 keeps them (or before \input{tcilatex})
  let at = -1;
  lines.forEach((l, i) => { if (TCIDATA.test(l.replace(/\r$/, ''))) at = i; });
  if (at < 0) at = lines.findIndex((l) => /\\input\{tcilatex\}/.test(l)) - 1;
  if (at < -1) at = lines.length - 1;
  lines.splice(at + 1, 0, ...add);
  return lines.join('\n');
}

// a tiny Hunspell reader (affix rules PFX/SFX with conditions, cross products) for Tools > Spelling
export function hunspell(aff, dic) {
  const rules = {};
  const lines = aff.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const p = lines[i].trim().split(/\s+/);
    if ((p[0] === 'PFX' || p[0] === 'SFX') && p.length === 4 && /^[YN]$/.test(p[2])) {
      const r = { prefix: p[0] === 'PFX', cross: p[2] === 'Y', entries: [] };
      for (let k = 0; k < +p[3]; k++) {
        const q = lines[++i].trim().split(/\s+/);
        const cond = q[4] && q[4] !== '.' ? new RegExp(r.prefix ? '^' + q[4] : q[4] + '$') : null;
        r.entries.push({ strip: q[2] === '0' ? '' : q[2], add: q[3] === '0' ? '' : q[3].split('/')[0], cond });
      }
      rules[p[1]] = r;
    }
  }
  const words = new Set();
  const apply = (w, r) => r.entries.filter((e) => !e.cond || e.cond.test(w)).map((e) => (r.prefix
    ? (e.strip && !w.startsWith(e.strip) ? null : e.add + w.slice(e.strip.length))
    : (e.strip && !w.endsWith(e.strip) ? null : w.slice(0, w.length - e.strip.length) + e.add))).filter(Boolean);
  for (const line of dic.split(/\r?\n/).slice(1)) {
    const [w, flags = ''] = line.split('/');
    if (!w) continue;
    words.add(w);
    const pre = []; const suf = [];
    for (const f of flags) { const r = rules[f]; if (r) (r.prefix ? pre : suf).push(r); }
    const sufWords = [];
    for (const r of suf) for (const x of apply(w, r)) { words.add(x); if (r.cross) sufWords.push(x); }
    for (const r of pre) {
      for (const x of apply(w, r)) words.add(x);
      if (r.cross) for (const s of sufWords) for (const x of apply(s, r)) words.add(x);
    }
  }
  return words;
}

export function setupMenus55(c) {
  const { app, view, dialog, escHtml } = c;
  const $ = (s) => document.querySelector(s);
  const field = (d, id) => d.querySelector(id).value.trim();
  const opt = (v, l, cur) => `<option value="${escHtml(v)}"${v === cur ? ' selected' : ''}>${escHtml(l)}</option>`;
  const radios = (name, items, cur) => items.map(([v, l]) => `<p><label><input type="radio" name="${name}" value="${escHtml(v)}"${v === cur ? ' checked' : ''}> ${l}</label></p>`).join('');
  const picked = (d, name) => d.querySelector(`input[name="${name}"]:checked`)?.value;
  const noEnter = () => { $('#dialog-body').onkeydown = null; };
  // the dialog's own buttons (OK, Cancel) are replaced by the given ones while it is open
  function buttonsDialog(title, html, buttons) {
    dialog(title, html, () => {});
    const ok = $('#dialog-ok');
    const cancel = $('#dialog-cancel');
    ok.hidden = true;
    cancel.textContent = _t('Close');
    const extra = buttons.map(([label, act]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dialog-extra';
      b.textContent = label;
      b.onclick = act;
      ok.before(b);
      return b;
    });
    const close = () => { extra.forEach((b) => b.remove()); ok.hidden = false; cancel.textContent = _t('Cancel'); $('#dialog').hidden = true; view.focus(); };
    cancel.onclick = close;
    $('#dialog-body').onkeydown = null;
    return close;
  }
  // a file the user keeps: the desktop app asks where, the web page downloads it
  async function saveFile(bytes, name, ext, kind) {
    try {
      if (isDesktop) {
        const path = await writeBytes(bytes, null, name, [{ name: kind, extensions: [ext] }]);
        if (path) app.toast(_t('Saved: ') + path);
        return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes]));
      a.download = name;
      a.click();
    } catch (e) { app.toast(_t('Could not save: ') + (e.message || e)); }
  }
  // a web address: the system's browser (desktop app) or a new tab
  async function openExternal(href) {
    if (isDesktop) { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(href); } else window.open(href, '_blank', 'noopener');
  }
  const pickFile = (accept) => new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => { const f = input.files[0]; resolve(f ? { name: f.name, text: await f.text() } : null); };
    input.click();
  });

  // ---------- File ----------
  // File > Export Document: the document in another format
  function exportDocument() {
    const kinds = [['latex', _t('LaTeX (.tex) for other LaTeX programs')], ['html', _t('Web page (.html)')], ['docx', _t('Word (.docx)')], ['md', _t('Markdown, for AI (.md)')],
      ['sci', _t('Scientific Word 6 (.sci)')], ...(isDesktop ? [['pdf', _t('PDF (typeset)')]] : [])];
    dialog(_t('Export document'), `<p>${_t('Export as')}</p>${radios('d-as', kinds, 'latex')}`, (d) => {
      const as = picked(d, 'd-as');
      ({ latex: app.exportLatex, html: app.exportHtml, docx: app.exportDocx, md: app.exportMd, sci: app.saveAsSci, pdf: () => app.typesetAs('none') })[as]?.();
    });
  }
  // File > Export as Picture: the formula at the cursor (or selected), or the selected picture or plot, as a PNG file
  async function exportPicture() {
    const mv = c.currentMath();
    const sel = view.state.selection;
    const node = sel.node;
    try {
      let blob;
      if (mv) { mv.save(); blob = await formulaPng(mv.latex, mv.node.type.name === 'math_display', settings().pictureScale); }
      else if (node && (node.type.name === 'math_inline' || node.type.name === 'math_display')) blob = await formulaPng(node.attrs.latex, node.type.name === 'math_display', settings().pictureScale);
      else if (node?.type.name === 'image') {
        const img = view.nodeDOM(sel.from)?.querySelector('img');
        if (!img) { app.toast(_t('This picture is not shown yet, so it cannot be exported')); return; }
        blob = await imagePng(img);
      } else { app.toast(_t('Put the cursor in a formula, or select a picture')); return; }
      await saveFile(new Uint8Array(await blob.arrayBuffer()), (app.meta().name || 'picture') + '.png', 'png', 'PNG');
    } catch (e) { app.toast(_t('Could not export: ') + (e.message || e)); }
  }
  // the class and its options, and the packages, of the document (a 5.x one: in its preamble)
  const PKG = /^\\usepackage(?:\[([^\]]*)\])?\{([^}]*)\}[ \t]*$/;
  function readStyle() {
    const meta = app.meta();
    if (meta.preamble55 != null) {
      const pre = meta.preamble55raw ?? meta.preamble55;
      const dc = pre.match(/\\documentclass(?:\[([^\]]*)\])?\{([^}]*)\}/) || [];
      const pkgs = pre.split('\n').map((l) => l.replace(/\r$/, '').match(PKG)).filter(Boolean).map((m) => (m[1] != null ? `[${m[1]}]${m[2]}` : m[2]));
      return { is55: true, cls: dc[2] || 'article', options: dc[1] || '', packages: pkgs };
    }
    return { is55: false, cls: meta.documentclass || 'article', options: meta.classOptions || '', packages: meta.userPackages || [] };
  }
  function writeStyle({ cls, options, packages }) {
    const meta = app.meta();
    const st = readStyle();
    if (st.is55) {
      let pre = meta.preamble55raw ?? meta.preamble55;
      pre = pre.replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]*\}/, `\\documentclass${options ? `[${options}]` : ''}{${cls}}`);
      if (packages) {
        const lines = pre.split('\n');
        const first = lines.findIndex((l) => PKG.test(l.replace(/\r$/, '')));
        const rest = lines.filter((l) => !PKG.test(l.replace(/\r$/, '')));
        const at = first >= 0 ? first : rest.findIndex((l) => /\\documentclass/.test(l)) + 1;
        rest.splice(at, 0, ...packages.map((p) => { const m = p.match(/^\[([^\]]*)\](.*)$/); return m ? `\\usepackage[${m[1]}]{${m[2]}}` : `\\usepackage{${p}}`; }));
        pre = rest.join('\n');
      }
      app.setMeta({ ...meta, preamble55raw: pre, preamble55: c.stripComments(pre).replace(/\n{3,}/g, '\n\n').trim() });
    } else {
      app.setMeta({ ...meta, documentclass: cls, classOptions: options || undefined, ...(packages ? { userPackages: packages } : {}) });
    }
  }
  const CLASSES = ['article', 'report', 'book', 'amsart', 'amsbook'];
  // File > Style: the document's style (its LaTeX class)
  function styleDialog() {
    const st = readStyle();
    const classes = [...new Set([...CLASSES, st.cls])];
    dialog(_t('Style'), `<p>${_t('Document class (the style used when typesetting)')} <select id="d-class">${classes.map((k) => opt(k, k, st.cls)).join('')}</select></p>
      <p>${_t('Another class')} <input id="d-other" size="16" placeholder="${_t('e.g. amsproc')}"></p>`, (d) => {
      const cls = field(d, '#d-other').replace(/[^A-Za-z0-9-]/g, '') || d.querySelector('#d-class').value;
      writeStyle({ cls, options: st.options });
      app.toast(_t('Document class changed to ') + cls);
    });
  }
  // File > Document Info: what the document holds, and its title and links (5.5 keeps them in %TCIDATA lines)
  function documentInfo() {
    const meta = app.meta();
    const info = meta.preamble55 != null ? docInfo55(meta.preamble55raw ?? meta.preamble55) : { title: meta.docTitle || '', links: { ...(meta.links || {}) } };
    const doc = view.state.doc;
    const count = {};
    doc.descendants((n) => { count[n.type.name] = (count[n.type.name] || 0) + 1; });
    const words = (doc.textContent.match(/[A-Za-z0-9]+|[㐀-鿿]/g) || []).length;
    const rows = [[_t('File name'), meta.name || _t('(untitled)')], [_t('Source'), meta.preamble55 ? _t('Scientific Word 5.x (.tex)') : app.path() && /\.sci$/i.test(app.path()) ? _t('Scientific Word 6 (.sci)') : _t('New document')],
      [_t('Document class'), readStyle().cls], [_t('Words (Chinese counted by character, English by word)'), words], [_t('Paragraphs'), count.paragraph || 0], [_t('Section titles'), count.heading || 0],
      [_t('Formula'), (count.math_inline || 0) + (count.math_display || 0)], [_t('Table'), count.table || 0], [_t('Pictures and plots'), count.image || 0],
      [_t('Footnote'), count.note || 0], [_t('TeX field'), count.tex_field || 0]];
    dialog(_t('Document info'), '<table class="info">' + rows.map(([k, v]) => `<tr><td>${k}</td><td>${escHtml(String(v))}</td></tr>`).join('') + '</table>'
      + `<p>${_t('Title')} <input id="d-title" size="34" value="${escHtml(info.title)}"></p>
      <details><summary>${_t('Links (Go > Links): a file name, a marker, or a web address')}</summary><table class="info">${LINKS55().map(([rel, l]) => `<tr><td>${l}</td><td><input id="d-l-${rel}" size="24" value="${escHtml(info.links[rel] || (rel === 'begin' ? info.links.first || '' : ''))}"></td></tr>`).join('')}</table></details>`, (d) => {
      const links = {};
      for (const [rel] of LINKS55()) { const v = field(d, '#d-l-' + rel); if (v) links[rel] = v; }
      const title = field(d, '#d-title');
      const now = app.meta();
      if (now.preamble55 != null) {
        const pre = setDocInfo55(now.preamble55raw ?? now.preamble55, { title, links });
        if (pre !== (now.preamble55raw ?? now.preamble55)) app.setMeta({ ...now, preamble55raw: pre, preamble55: c.stripComments(pre).replace(/\n{3,}/g, '\n\n').trim() });
      } else app.setMeta({ ...now, docTitle: title || undefined, links: Object.keys(links).length ? links : undefined });
    });
  }
  // File > Preview: the pages as they print, in a window of their own (Print there, or Close)
  function previewWindow() {
    let box = $('#preview55');
    if (!box) {
      box = document.createElement('div');
      box.id = 'preview55';
      box.className = 'overlay';
      box.innerHTML = `<div class="preview55-bar"><b>${_t('Preview')}</b> <button type="button" id="preview55-print">${_t('Print...')}</button> <button type="button" id="preview55-close">${_t('Close')}</button></div><iframe id="preview55-frame" title="${_t('Preview')}"></iframe>`;
      document.body.append(box);
      $('#preview55-close').onclick = () => { box.hidden = true; view.focus(); };
      $('#preview55-print').onclick = () => { $('#preview55-frame').contentWindow.focus(); $('#preview55-frame').contentWindow.print(); };
    }
    $('#preview55-frame').srcdoc = app.printHtml();
    box.hidden = false;
  }

  // ---------- Edit ----------
  function deleteSelection() {
    const mv = c.currentMath();
    if (mv) { mv.mf.executeCommand('deleteForward'); mv.changed(); return; }
    const { state } = view;
    view.dispatch(state.selection.empty ? state.tr.delete(state.selection.from, Math.min(state.selection.from + 1, state.doc.content.size - 1)) : state.tr.deleteSelection());
    view.focus();
  }
  // Edit > Copy as Internal Format: the selection as 5.x writes it (its LaTeX), for pasting into 5.5 or a .tex
  async function copyInternal() {
    const mv = c.currentMath();
    let tex = mv ? (mv.save(), `$${mv.latex}$`) : app.selectionTex55();
    if (!tex) { app.toast(_t('First select what to copy')); return; }
    try { await navigator.clipboard.writeText(tex); app.toast(_t('Copied in the internal format (5.x LaTeX)')); } catch (e) { app.toast(_t('Could not copy: ') + (e.message || e)); }
  }

  // ---------- Insert ----------
  // a dialog takes the focus: what it inserts goes back into the formula the cursor was in
  const inFormula = (insert) => { const mv = c.currentMath(); return (...a) => { if (mv) mv.enter(false); insert(...a); }; };
  // a 5.5 picker: buttons for the symbols of a list (5.5's Operator, Brackets, Decoration dialogs)
  function pickDialog(title, items, act0, extraHtml = '', onOk0 = null) {
    const act = inFormula(act0);
    const onOk = onOk0 && inFormula(onOk0);
    dialog(title, `<div class="pick55">${items.map(([s, v], i) => `<button type="button" data-i="${i}" title="${escHtml(v)}">${escHtml(s)}</button>`).join('')}</div>${extraHtml}`, (d) => onOk?.(d));
    $('#dialog-body').querySelectorAll('.pick55 button').forEach((b) => {
      b.onclick = () => { $('#dialog').hidden = true; act(items[+b.dataset.i][1]); };
    });
  }
  const operatorDialog = () => pickDialog(_t('Operator'), c.OPERATORS, (l) => c.mathInsert(l));
  const bracketsDialog = () => pickDialog(_t('Brackets'), c.BRACKETS, (a) => c.mathAction(a));
  const decorationDialog = () => pickDialog(_t('Decoration'), c.DECORATIONS, (a) => c.mathAction(a));
  // Insert > Math Name: a name from the list, or one typed (5.5: Name, as an operator; set in upright type)
  function mathNameDialog() {
    pickDialog(_t('Math name'), c.NAMES, (l) => c.mathInsert(l), `<p>${_t('Name')} <input id="d-name" size="14" placeholder="${_t('e.g. sgn')}"> ${_t('(not in the list: OK inserts it)')}</p>`, (d) => {
      const n = field(d, '#d-name').replace(/[^A-Za-z]/g, '');
      if (n) c.mathInsert(`\\func{${n}}`); // 5.x's math name
    });
  }
  // Insert > Unit Name: the unit's symbol in upright type (\unit{..}, as 5.x writes it)
  function unitNameDialog() {
    const back = inFormula((d) => c.mathInsert(`\\unit{${d.querySelector('#d-unit').value}}`));
    dialog(_t('Unit name'), `<p><select id="d-unit" size="12" style="min-width:16em">${c.UNITS.map(([l, u]) => opt(u, l, 'm')).join('')}</select></p>`, back);
    $('#d-unit').ondblclick = () => $('#dialog-ok').click();
  }
  // Insert > Binomial: the brackets around it and the line between (5.5's Binomial dialog)
  function binomialDialog() {
    const back = inFormula((f) => f());
    const fences = [['()', '( )'], ['[]', '[ ]'], ['\\{\\}', '{ }'], ['\\langle\\rangle', '⟨ ⟩'], ['', _t('none')]];
    dialog(_t('Binomial'), `<p>${_t('Brackets')} <select id="d-f">${fences.map(([v, l]) => opt(v, l, '()')).join('')}</select></p>
      <p>${_t('Line')} <select id="d-line">${opt('0pt', _t('none'), '0pt')}${opt('', _t('thin'), '0pt')}${opt('1pt', _t('thick'), '0pt')}</select></p>`, (d) => {
      const f = d.querySelector('#d-f').value;
      const line = d.querySelector('#d-line').value;
      if (f === '()' && line === '0pt') { back(() => c.mathAction('binomial')); return; }
      const [l, r] = f === '()' ? ['(', ')'] : f === '[]' ? ['[', ']'] : f === '\\{\\}' ? ['\\{', '\\}'] : f ? ['\\langle', '\\rangle'] : ['', ''];
      back(() => c.mathInsert(`\\genfrac{${l}}{${r}}{${line}}{}{#?}{#?}`));
    });
  }
  // Insert > Label: a label above or below the formula's selected part (with a brace, or without)
  function labelDialog() {
    const back = inFormula((t) => c.mathInsert(t));
    dialog(_t('Label'), `<p>${_t('Position')} <select id="d-pos">${opt('above', _t('Above'), 'below')}${opt('below', _t('Below'), 'below')}</select></p>
      <p>${_t('Type')} <select id="d-type">${opt('none', _t('No brace'), 'brace')}${opt('brace', _t('Horizontal brace'), 'brace')}</select></p>`, (d) => {
      const above = d.querySelector('#d-pos').value === 'above';
      const brace = d.querySelector('#d-type').value === 'brace';
      back(brace ? (above ? '\\overbrace{#0}^{#?}' : '\\underbrace{#0}_{#?}') : (above ? '\\overset{#?}{#0}' : '\\underset{#?}{#0}'));
    });
  }
  // a TeX field on a line of its own (vertical space, a page break) or in the line
  function insertTex(tex, block) {
    const mv = c.currentMath();
    if (mv) mv.exit(1);
    const f = schema.nodes.tex_field.create({ tex });
    view.dispatch(view.state.tr.replaceSelectionWith(block ? schema.nodes.paragraph.create(null, [f]) : f).scrollIntoView());
    view.focus();
  }
  const length = (s) => (/^-?\d*\.?\d+\s*(pt|in|cm|mm|em|ex|pc|bp)$/.test(s.trim()) ? s.replace(/\s+/g, '') : null);
  // Insert > Spacing > Horizontal Space
  function hspaceDialog() {
    const mv0 = c.currentMath();
    const kinds = [['normal', _t('Normal space')], ['required', _t('Required space')], ['nbsp', _t('Nonbreaking space')], ['quad', _t('Em space')], ['qquad', _t('2-em space')],
      ['thinspace', _t('Thin space')], ['thickspace', _t('Thick space')], ['negthin', _t('Negative thin space')], ['italic', _t('Italic correction')], ['zero', _t('Zero space')], ['custom', _t('Custom')]];
    dialog(_t('Horizontal space'), radios('d-sp', kinds, 'quad') + `<p>${_t('Width')} <input id="d-w" size="8" placeholder="1cm"></p>`, (d) => {
      const k = picked(d, 'd-sp');
      const inMath = !!mv0;
      if (mv0) mv0.enter(false);
      if (k === 'custom') { const w = length(field(d, '#d-w')); if (!w) { app.toast(_t('Give a length such as 1cm, 0.5in, 12pt')); return; } if (inMath) c.mathInsert(`\\hspace{${w}}`); else insertTex(`\\hspace{${w}}`); return; }
      const math = { normal: '\\ ', required: '\\ ', nbsp: '~', quad: '\\quad', qquad: '\\qquad', thinspace: '\\,', thickspace: '\\;', negthin: '\\!', italic: '\\/', zero: '{}' }[k];
      if (inMath) { c.mathInsert(math); return; }
      if (k === 'thinspace' || k === 'thickspace' || k === 'nbsp') { c.space(k); return; }
      if (k === 'normal') { view.dispatch(view.state.tr.insertText(' ')); view.focus(); return; }
      insertTex({ required: '\\ ', quad: '\\quad', qquad: '\\qquad', negthin: '\\!', italic: '\\/', zero: '\\hspace{0pt}' }[k]);
    });
  }
  // Insert > Spacing > Vertical Space (a line of its own, as 5.x writes \bigskip)
  function vspaceDialog() {
    const kinds = [['smallskip', _t('Small skip')], ['medskip', _t('Medium skip')], ['bigskip', _t('Big skip')], ['strut', _t('Strut')], ['mathstrut', _t('Math strut')], ['custom', _t('Custom')]];
    dialog(_t('Vertical space'), radios('d-sp', kinds, 'bigskip') + `<p>${_t('Height')} <input id="d-h" size="8" placeholder="1cm"></p>`, (d) => {
      const k = picked(d, 'd-sp');
      if (k === 'custom') { const h = length(field(d, '#d-h')); if (!h) { app.toast(_t('Give a length such as 1cm, 0.5in, 12pt')); return; } insertTex(`\\vspace{${h}}`, true); return; }
      if (k === 'strut' || k === 'mathstrut') { insertTex('\\' + k); return; }
      insertTex('\\' + k, true);
    });
  }
  // Insert > Spacing > Rule: \rule[lift]{width}{height}
  function ruleDialog() {
    dialog(_t('Rule'), `<p>${_t('Lift')} <input id="d-l" size="8" value="0pt"></p><p>${_t('Width')} <input id="d-w" size="8" value="1in"></p><p>${_t('Height')} <input id="d-h" size="8" value="0.4pt"></p>`, (d) => {
      const [l, w, h] = ['#d-l', '#d-w', '#d-h'].map((id) => length(field(d, id) || '0pt'));
      if (!w || !h || !l) { app.toast(_t('Give lengths such as 1cm, 0.5in, 12pt')); return; }
      insertTex(`\\rule${l !== '0pt' ? `[${l}]` : ''}{${w}}{${h}}`);
    });
  }
  // Insert > Spacing > Break
  function breakDialog() {
    const kinds = [['allowbreak', _t('Allow break')], ['discretionary', _t('Discretionary hyphen')], ['nolinebreak', _t('No break')], ['pagebreak', _t('Page break')],
      ['newpage', _t('New page')], ['linebreak', _t('Line break')], ['newline', _t('New line')]];
    dialog(_t('Break'), radios('d-br', kinds, 'newline'), (d) => {
      const k = picked(d, 'd-br');
      if (k === 'newline') { const mv = c.currentMath(); if (mv) mv.exit(1); view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView()); view.focus(); return; }
      if (k === 'discretionary') { view.dispatch(view.state.tr.insertText('­')); view.focus(); return; }
      insertTex('\\' + k, k === 'newpage' || k === 'pagebreak');
    });
  }
  // a block (bibliography, subdocument) where the cursor is
  function insertBlock(node) {
    const mv = c.currentMath();
    if (mv) mv.exit(1);
    view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    view.focus();
  }
  // Insert > Typeset Object > Bibliography: references from BibTeX files (Typeset > Bibliography Choice: Manual -> a list written here)
  function bibliographyDialog() {
    if (bibScheme() === 'Manual') {
      insertBlock(schema.nodes.bibliography.create({ widest: '9' }, [schema.nodes.bib_item.create({ key: 'ref1' }, [schema.nodes.paragraph.create()])]));
      app.toast(_t('A list of references (Typeset > Bibliography Choice is Manual)'));
      return;
    }
    dialog(_t('Bibliography'), `<p>${_t('BibTeX files (without .bib, separated by commas)')} <input id="d-files" size="24"></p>
      <p>${_t('Style')} <select id="d-style">${['plain', 'unsrt', 'alpha', 'abbrv', 'amsplain', 'amsalpha', 'apalike', 'siam'].map((s) => opt(s, s, 'plain')).join('')}</select></p>`, (d) => {
      const files = field(d, '#d-files').split(',').map((x) => x.trim().replace(/\.bib$/i, '')).filter(Boolean).join(',');
      if (!files) { app.toast(_t('Give the BibTeX file name')); return; }
      insertBlock(schema.nodes.bibtex.create({ files, style: d.querySelector('#d-style').value }));
    });
  }
  // Insert > Typeset Object > Subdocument: another file typeset as part of this one (5.x: \QSubDoc)
  function subdocDialog() {
    dialog(_t('Subdocument'), `<p>${_t('File name (in the document\'s folder)')} <input id="d-file" size="24" placeholder="chapter1.tex"></p>`, (d) => {
      const file = field(d, '#d-file').replace(/\\/g, '/');
      if (!file) return;
      const stem = file.replace(/\.tex$/i, '');
      insertBlock(schema.nodes.subdoc.create({ file: stem, tex: `\\QSubDoc{Include ${stem}}{\\input{${stem}}}` }));
    });
  }
  // Insert > Typeset Object > Hypertext Target: a place a hypertext reference (or another PDF) jumps to
  function hypertargetDialog() {
    dialog(_t('Hypertext target'), `<p>${_t('Name')} <input id="d-key" size="18"></p><p>${_t('Text (may be empty)')} <input id="d-text" size="24"></p>`, (d) => {
      const key = field(d, '#d-key').replace(/[{}\\]/g, '');
      if (key) insertTex(`\\hypertarget{${key}}{${field(d, '#d-text').replace(/[{}\\]/g, '')}}`);
    });
  }
  // Insert > Typeset Object > Hypertext Reference: text that jumps to a marker (5.x: \hyperref{text}{}{}{marker})
  function hyperrefDialog() {
    const keys = c.markerKeys();
    if (!keys.length) { app.toast(_t('The document has no markers yet; use Insert > Marker first')); return; }
    const sel = view.state.selection;
    const text0 = sel.empty ? '' : view.state.doc.textBetween(sel.from, sel.to, ' ');
    dialog(_t('Hypertext reference'), `<p>${_t('Text')} <input id="d-text" size="24" value="${escHtml(text0)}"></p><p>${_t('Marker')} <select id="d-key">${keys.map((k) => opt(k, k, '')).join('')}</select></p>`, (d) => {
      const text = d.querySelector('#d-text').value;
      if (!text) return;
      const mark = schema.marks.link.create({ href: '#' + d.querySelector('#d-key').value, sw5: { cmd: 'hyperref', before: '', after: '' } });
      const tr = sel.empty || text !== text0 ? view.state.tr.replaceSelectionWith(schema.text(text, [mark]), false) : view.state.tr.addMark(sel.from, sel.to, mark);
      view.dispatch(tr.scrollIntoView());
      view.focus();
    });
  }

  // ---------- View ----------
  // shown on the page or not, remembered between sessions (Invisibles, Input Boxes, Status Bar)
  const SHOW_KEY = 'opensw-view55';
  const shown = () => { try { return { inputboxes: true, statusbar: true, ...JSON.parse(localStorage.getItem(SHOW_KEY) || '{}') }; } catch (e) { return { inputboxes: true, statusbar: true }; } };
  function applyShown() {
    const s = shown();
    $('#editor')?.classList.toggle('show-invisibles', !!s.invisibles);
    $('#editor')?.classList.toggle('hide-inputboxes', !s.inputboxes);
    const bar = $('#statusbar');
    if (bar) bar.hidden = !s.statusbar;
  }
  function toggleShown(k) {
    const s = shown();
    s[k] = !s[k];
    try { localStorage.setItem(SHOW_KEY, JSON.stringify(s)); } catch (e) { /* storage off */ }
    applyShown();
  }
  applyShown();
  // View > Custom: any zoom
  function customZoom() {
    dialog(_t('Zoom'), `<p>${_t('Zoom factor')} <input id="d-z" size="5" value="${Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--zoom') || '1') * 100)}">%</p>`, (d) => {
      const z = parseFloat(field(d, '#d-z'));
      if (!(z >= 67 && z <= 300)) { app.toast(_t('Give a number from 67 to 300')); return; }
      app.setZoom(z / 100);
    });
  }
  // View > Refresh: the page drawn again (and its plots)
  function refreshView() {
    applyShown();
    c.applyView?.();
    view.dispatch(view.state.tr.setMeta('addToHistory', false));
    app.renderPlots?.();
  }

  // ---------- Go ----------
  // Go > Links: the document the link names (Document Info's Links), a marker, or a web address
  function goLink(rel) {
    const meta = app.meta();
    const links = meta.preamble55 != null ? docInfo55(meta.preamble55raw ?? meta.preamble55).links : (meta.links || {});
    const href = links[rel] || (rel === 'begin' ? links.first : '');
    const name = (LINKS55().find(([r]) => r === rel) || [])[1] || rel;
    if (!href) { app.toast(_t('This document has no "{0}" link (File > Document Info sets the links)', name)); return; }
    if (/^#/.test(href) || c.markerKeys().includes(href)) {
      const at = c.markerPos(href.replace(/^#/, ''));
      if (at == null) app.toast(_t('Marker not found: ') + href); else c.jumpTo(at);
      return;
    }
    if (/^[a-z]+:\/\//i.test(href)) { openExternal(href); return; }
    app.openRelative(href);
  }
  // Go > To Paragraph: the n-th paragraph (or other block) of the document
  function toParagraph() {
    const tops = [];
    view.state.doc.forEach((n, pos) => tops.push(pos));
    dialog(_t('Go to paragraph'), `<p>${_t('Paragraph number (1 to {0})', tops.length)} <input id="d-n" size="6" value="1"></p>`, (d) => {
      const n = Math.round(+field(d, '#d-n'));
      if (!(n >= 1 && n <= tops.length)) { app.toast(_t('Give a number from 1 to {0}', tops.length)); return; }
      c.jumpTo(tops[n - 1] + 1);
    });
  }
  // Go > View History: the places jumped from; choosing one goes back there
  function viewHistory() {
    const back = c.history().back;
    if (!back.length) { app.toast(_t('No previous position')); return; }
    const doc = view.state.doc;
    const at = (p) => { const q = Math.min(p, doc.content.size); const r = doc.resolve(q); const t = r.parent.textContent; return t.slice(0, 40) || _t('(position {0})', q); };
    dialog(_t('History'), `<p><select id="d-h" size="10" style="min-width:24em">${[...back].reverse().map((p, i) => opt(String(i), at(p), '0')).join('')}</select></p>`, (d) => {
      const i = +d.querySelector('#d-h').value;
      for (let k = 0; k <= i; k++) c.goHistory(-1);
    });
    $('#d-h').ondblclick = () => $('#dialog-ok').click();
  }

  // ---------- Tag ----------
  // Tag > Apply: every tag in one list
  function applyTag() {
    dialog(_t('Apply tag'), `<p><select id="d-tag" size="14" style="min-width:20em">${c.ALL_TAGS.map(([code, l]) => opt(code, l, 'block:paragraph')).join('')}</select></p>`, (d) => c.functionKey(d.querySelector('#d-tag').value));
    $('#d-tag').ondblclick = () => $('#dialog-ok').click();
  }

  // ---------- Typeset ----------
  const bibScheme = () => {
    const meta = app.meta();
    return (meta.preamble55 != null ? docInfo55(meta.preamble55raw ?? meta.preamble55).bib : meta.bibScheme) || 'BibTeX';
  };
  // Typeset > Front Matter: the title, author and date at the top, and the front matter fields (address, keywords ...)
  function frontMatter() {
    const doc = view.state.doc;
    let title = null; let titlePos = -1; let author = null; let authorPos = -1;
    const fields = {};
    doc.forEach((n, pos, i) => {
      if (n.type.name === 'title' && title == null) { title = n; titlePos = pos; const next = doc.maybeChild(i + 1); if (next?.type.name === 'env' && next.attrs.kind === 'centered') { author = next; authorPos = pos + n.nodeSize; } }
      if (n.type.name === 'front_field' && !(n.attrs.cmd in fields)) fields[n.attrs.cmd] = n.textContent;
    });
    const FIELDS = [['address', _t('Address')], ['email', _t('Email')], ['urladdr', _t('Web address')], ['keywords', _t('Keywords')], ['subjclass', _t('Subject classification')], ['dedicatory', _t('Dedication')]];
    dialog(_t('Front matter'), `<p>${_t('Title')} <input id="d-title" size="40" value="${escHtml(title?.textContent || '')}"></p>
      <p>${_t('Author')} <input id="d-author" size="40" value="${escHtml(author?.textContent || '')}"></p>
      <p>${_t('Date')} <input id="d-date" size="20" value="${escHtml(title?.attrs.date ?? '')}" placeholder="${_t('empty: no date; \\today: the day it is typeset')}"></p>
      <table class="info">${FIELDS.map(([k, l]) => `<tr><td>${l}</td><td><input id="d-f-${k}" size="30" value="${escHtml(fields[k] || '')}"></td></tr>`).join('')}</table>`, (d) => {
      const t = field(d, '#d-title'); const a = field(d, '#d-author'); const date = field(d, '#d-date');
      let tr = view.state.tr;
      const text = (s) => (s ? [schema.text(s)] : []);
      const blocks = [];
      if (t) blocks.push(schema.nodes.title.create({ ...(title?.attrs || {}), date: date || null }, text(t)));
      if (a && t) blocks.push(schema.nodes.env.create({ kind: 'centered' }, [schema.nodes.paragraph.create(null, text(a))]));
      // the old title and author go; the new ones take their place (or the top of the document)
      const from = titlePos >= 0 ? titlePos : 0;
      const to = titlePos >= 0 ? (authorPos >= 0 ? authorPos + author.nodeSize : titlePos + title.nodeSize) : 0;
      tr = tr.replaceWith(from, to, blocks);
      // the front matter fields: changed in place, new ones after the title
      let after = from + blocks.reduce((s, b) => s + b.nodeSize, 0);
      for (const [k] of FIELDS) {
        const v = field(d, '#d-f-' + k);
        let found = -1; let node = null;
        tr.doc.forEach((n, pos) => { if (found < 0 && n.type.name === 'front_field' && n.attrs.cmd === k) { found = pos; node = n; } });
        if (found >= 0) { tr = v ? tr.replaceWith(found, found + node.nodeSize, schema.nodes.front_field.create({ cmd: k }, text(v))) : tr.delete(found, found + node.nodeSize); }
        else if (v) { const f = schema.nodes.front_field.create({ cmd: k }, text(v)); tr = tr.insert(after, f); after += f.nodeSize; }
      }
      view.dispatch(tr.scrollIntoView());
      // the author line is written as 5.x's \author (5.5 shows front matter only in this dialog)
      app.setMeta({ ...app.meta(), author55: a && t ? a : null });
      view.focus();
    });
  }
  // Typeset > Bibliography Choice: BibTeX files, or references written in the document (5.x: %TCIDATA{BibliographyScheme=..})
  function bibliographyChoice() {
    const cur = bibScheme();
    dialog(_t('Bibliography choice'), radios('d-b', [['BibTeX', _t('BibTeX bibliography (references from .bib files)')], ['Manual', _t('Manual entry (the references written in the document)')]], cur), (d) => {
      const bib = picked(d, 'd-b');
      const meta = app.meta();
      if (meta.preamble55 != null) {
        const pre0 = meta.preamble55raw ?? meta.preamble55;
        const info = docInfo55(pre0);
        const pre = setDocInfo55(pre0, { title: info.title, links: info.links, bib });
        app.setMeta({ ...meta, preamble55raw: pre, preamble55: c.stripComments(pre).replace(/\n{3,}/g, '\n\n').trim() });
      } else app.setMeta({ ...meta, bibScheme: bib });
      app.toast(_t('Bibliography: ') + (bib === 'Manual' ? _t('Manual entry') : 'BibTeX'));
    });
  }
  // Typeset > Options and Packages: the class's options, and the packages
  function optionsPackages() {
    const st = readStyle();
    dialog(_t('Options and packages'), `<p>${_t('Document class')} <b>${escHtml(st.cls)}</b></p>
      <p>${_t('Class options (separated by commas)')} <input id="d-o" size="30" value="${escHtml(st.options)}" placeholder="12pt,a4paper"></p>
      <p>${_t('Packages, one on a line ([options]name)')}</p><p><textarea id="d-p" rows="8" cols="40" spellcheck="false"></textarea></p>`, (d) => {
      const options = field(d, '#d-o').replace(/\s+/g, '');
      const packages = d.querySelector('#d-p').value.split('\n').map((x) => x.trim()).filter((x) => /^(\[[^\]]*\])?[A-Za-z0-9-]+(,[A-Za-z0-9-]+)*$/.test(x));
      writeStyle({ cls: st.cls, options, packages });
      app.toast(_t('Options and packages changed'));
    });
    $('#d-p').value = st.packages.join('\n');
    noEnter();
  }
  // Typeset > Output Choice: what typesetting makes
  function outputChoice() {
    const s = settings();
    dialog(_t('Output choice'), radios('d-o', [['pdf', _t('PDF (XeLaTeX; the built-in TeX when XeLaTeX is not installed)')]], 'pdf')
      + `<p><label><input id="d-open" type="checkbox"${s.openAfterCompile !== false ? ' checked' : ''}> ${_t('Open the PDF after Compile PDF')}</label></p>`, (d) => {
      saveSettings({ ...settings(), openAfterCompile: d.querySelector('#d-open').checked });
    });
  }
  // Typeset > General Settings, Expert Settings
  function generalSettings() {
    const s = settings();
    dialog(_t('General settings'), `<p><label><input id="d-err" type="checkbox"${s.showTexErrors !== false ? ' checked' : ''}> ${_t('Show what TeX reported when there are errors')}</label></p>
      <p><label><input id="d-open" type="checkbox"${s.openAfterCompile !== false ? ' checked' : ''}> ${_t('Open the PDF after Compile PDF')}</label></p>
      <p>${_t('BibTeX and MakeIndex run by themselves when the document needs them.')}</p>`, (d) => {
      saveSettings({ ...settings(), showTexErrors: d.querySelector('#d-err').checked, openAfterCompile: d.querySelector('#d-open').checked });
    });
  }
  function expertSettings() {
    dialog(_t('Expert settings'), `<table class="info"><tr><td>${_t('TeX program')}</td><td>xelatex ${_t('(the built-in Tectonic when it is not installed)')}</td></tr>
      <tr><td>${_t('Bibliography')}</td><td>bibtex</td></tr><tr><td>${_t('Index')}</td><td>makeindex</td></tr>
      <tr><td>${_t('Files')}</td><td>${_t('the document\'s folder; 5.x macro files (tcilatex) from 5.x when installed')}</td></tr></table>
      <p>${_t('LaTeX of your own before \\begin{document}: Typeset > Preamble.')}</p>`, () => {});
  }

  // ---------- Tools ----------
  // Tools > Spelling: the words not in the dictionary (5.5's en-US dictionary), one by one
  let dict = null;
  const USER_DICT = 'opensw-userdict';
  const userDict = () => { try { return new Set(JSON.parse(localStorage.getItem(USER_DICT) || '[]')); } catch (e) { return new Set(); } };
  async function loadDict() {
    if (dict) return dict;
    const [aff, dic] = await Promise.all(['en-US.aff', 'en-US.dic'].map(async (f) => {
      const r = await fetch(new URL('./dict/' + f, document.baseURI));
      if (!r.ok) throw new Error(f);
      return new TextDecoder('iso-8859-1').decode(await r.arrayBuffer());
    }));
    dict = hunspell(aff, dic);
    return dict;
  }
  const known = (w, words, own) => own.has(w) || words.has(w) || words.has(w.toLowerCase()) || (w === w.toUpperCase() && w.length < 5) || /\d/.test(w)
    || words.has(w[0].toUpperCase() + w.slice(1).toLowerCase()) || (/'s$/.test(w) && known(w.slice(0, -2), words, own));
  function suggestions(w, words) {
    const a = 'abcdefghijklmnopqrstuvwxyz';
    const lw = w.toLowerCase();
    const out = new Set();
    for (let i = 0; i <= lw.length; i++) {
      for (const ch of a) { out.add(lw.slice(0, i) + ch + lw.slice(i)); if (i < lw.length) out.add(lw.slice(0, i) + ch + lw.slice(i + 1)); }
      if (i < lw.length) out.add(lw.slice(0, i) + lw.slice(i + 1));
      if (i < lw.length - 1) out.add(lw.slice(0, i) + lw[i + 1] + lw[i] + lw.slice(i + 2));
    }
    const fit = (s) => (w[0] === w[0].toUpperCase() ? s[0].toUpperCase() + s.slice(1) : s);
    return [...out].filter((s) => s !== lw && (words.has(s) || words.has(s[0].toUpperCase() + s.slice(1)))).slice(0, 8).map(fit);
  }
  async function spelling() {
    let words;
    try { words = await loadDict(); } catch (e) { app.toast(_t('The dictionary could not be loaded')); return; }
    const ignored = new Set();
    let from = view.state.selection.from;
    const next = () => {
      const own = userDict();
      let hit = null;
      view.state.doc.nodesBetween(from, view.state.doc.content.size, (n, pos) => {
        if (hit) return false;
        if (n.type.name === 'math_inline' || n.type.name === 'math_display' || n.type.name === 'tex_field' || n.type.name === 'verbatim') return false;
        if (!n.isText || n.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return true;
        for (const m of n.text.matchAll(/[A-Za-z][A-Za-z']*[A-Za-z]|[A-Za-z]/g)) {
          const at = pos + m.index;
          if (at < from) continue;
          if (!ignored.has(m[0]) && !known(m[0], words, own)) { hit = { at, word: m[0] }; return false; }
        }
        return false;
      });
      return hit;
    };
    let cur = next();
    if (!cur) { app.toast(_t('Spelling check finished: no words outside the dictionary')); return; }
    const show = () => {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cur.at, cur.at + cur.word.length)).scrollIntoView());
      const sug = suggestions(cur.word, words);
      $('#d-word').textContent = cur.word;
      $('#d-new').value = sug[0] || cur.word;
      $('#d-sug').innerHTML = sug.map((s) => opt(s, s, sug[0])).join('');
    };
    const advance = (pos) => { from = pos; cur = next(); if (!cur) { close(); app.toast(_t('Spelling check finished')); return; } show(); };
    const close = buttonsDialog(_t('Spelling'), `<p>${_t('Not in the dictionary:')} <b id="d-word"></b></p>
      <p>${_t('Change to')} <input id="d-new" size="20"></p><p><select id="d-sug" size="6" style="min-width:14em"></select></p>`, [
      [_t('Change'), () => { const w = $('#d-new').value; view.dispatch(view.state.tr.insertText(w, cur.at, cur.at + cur.word.length)); advance(cur.at + w.length); }],
      [_t('Change all'), () => {
        const w = $('#d-new').value; const old = cur.word; let tr = view.state.tr; const hits = [];
        tr.doc.descendants((n, pos) => { if (n.isText) for (const m of n.text.matchAll(new RegExp(`\\b${old}\\b`, 'g'))) hits.push(pos + m.index); });
        for (const p of hits.reverse()) tr = tr.insertText(w, p, p + old.length);
        view.dispatch(tr); advance(cur.at + w.length);
      }],
      [_t('Ignore'), () => advance(cur.at + cur.word.length)],
      [_t('Ignore all'), () => { ignored.add(cur.word); advance(cur.at + cur.word.length); }],
      [_t('Add to dictionary'), () => { const own = userDict(); own.add(cur.word); try { localStorage.setItem(USER_DICT, JSON.stringify([...own])); } catch (e) { /* storage off */ } advance(cur.at + cur.word.length); }],
    ]);
    $('#d-sug').onchange = () => { $('#d-new').value = $('#d-sug').value; };
    show();
  }
  // Tools > Save User Preferences / Restore Saved Preferences: every setting of this program as one file
  const PREF = /^(opensw|sw-next)/;
  function savePreferences() {
    const all = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (PREF.test(k)) all[k] = localStorage.getItem(k); }
    saveFile(new TextEncoder().encode(JSON.stringify({ opensw: 'preferences', saved: new Date().toISOString(), settings: all }, null, 1)), 'opensw-preferences.json', 'json', 'JSON');
  }
  async function restorePreferences() {
    const f = await pickFile('.json');
    if (!f) return;
    try {
      const p = JSON.parse(f.text);
      if (p.opensw !== 'preferences' || typeof p.settings !== 'object') throw new Error(_t('not a preferences file of opensw'));
      for (const [k, v] of Object.entries(p.settings)) if (PREF.test(k) && typeof v === 'string') localStorage.setItem(k, v);
      app.applySettings?.();
      c.applyView?.();
      c.applyLooks?.();
      applyShown();
      app.toast(_t('Preferences restored (some take effect when opensw starts again)'));
    } catch (e) { app.toast(_t('Could not restore: ') + (e.message || e)); }
  }
  // Tools > Action: what the object at the cursor does (a hypertext link: go there)
  function action() {
    const { $from } = view.state.selection;
    const link = [...$from.marks(), ...($from.nodeAfter?.marks || [])].find((m) => m.type.name === 'link');
    const node = view.state.selection instanceof NodeSelection ? view.state.selection.node : null;
    if (link) { c.followLink(); return; }
    if (node?.type.name === 'subdoc') { app.openRelative(node.attrs.file.replace(/\.tex$/i, '') + '.tex'); return; }
    app.toast(_t('Put the cursor on a hypertext link, or select a subdocument'));
  }

  // ---------- Help ----------
  // Help > Search: the manual, opened at the first place the words are
  async function helpSearch() {
    dialog(_t('Search help'), `<p>${_t('Words to find')} <input id="d-q" size="24"></p>`, async (d) => {
      const q = field(d, '#d-q');
      if (!q) return;
      await c.openManual();
      c.findText(q);
    });
  }
  // Help > Index: the manual at the part each of 5.5's help books covers
  const HELP_PARTS = { computing: ['Compute', '計算'], general: ['Getting started', 'How', '開始', '基本'], reference: ['shortcut', 'Keyboard', '快捷鍵', '參考'] };
  async function helpIndex(kind) {
    await c.openManual();
    const words = HELP_PARTS[kind];
    let at = null;
    view.state.doc.descendants((n, pos) => { if (at == null && n.type.name === 'heading' && words.some((w) => n.textContent.toLowerCase().includes(w.toLowerCase()))) at = pos; return at == null; });
    if (at != null) c.jumpTo(at + 1);
  }
  function website() { openExternal('https://www.mackichan.com'); }
  function about() {
    dialog(_t('About opensw'), `<p><b>opensw</b> ${escHtml(app.version || '')}</p>
      <p>${_t('An open-source math editor modelled on Scientific Word 5.5 (MPL 2.0).')}</p>
      <p>${_t('Scientific Word is a product of MacKichan Software; its open-source version 6 (MPL 2.0) is the base of this work.')}</p>
      <p>${_t('Computation: SymPy (built in), or Mathematica on this computer.')}</p>`, () => {});
  }

  return {
    exportDocument, exportPicture, styleDialog, documentInfo, previewWindow,
    deleteSelection, copyInternal,
    operatorDialog, bracketsDialog, mathNameDialog, binomialDialog, labelDialog, decorationDialog, unitNameDialog,
    hspaceDialog, vspaceDialog, ruleDialog, breakDialog, bibliographyDialog, subdocDialog, hypertargetDialog, hyperrefDialog,
    isShown: (k) => !!shown()[k], toggleShown, customZoom, refreshView,
    goLink, toParagraph, viewHistory, applyTag,
    frontMatter, bibliographyChoice, optionsPackages, outputChoice, generalSettings, expertSettings,
    spelling, savePreferences, restorePreferences, action,
    helpSearch, helpIndex, website, about,
  };
}
