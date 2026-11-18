// The Scientific Word 5.5 look: menu bar, toolbars with the 6.1 open-source icons,
// symbol cache and symbol panels, the tag bar at the bottom, the status bar, and
// 5.5's keyboard shortcuts.
import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { undo, redo } from 'prosemirror-history';
import { Selection, AllSelection, TextSelection, NodeSelection } from 'prosemirror-state';
import { toPx } from './graphics.js';
import { parsePlot, drawable, plotSpecial, plotKind, components, splitRelation, PLOTTYPE, DIMS } from './plots.js';
import { odeRows } from './plotdata.js';
import { isTemplate, buildExams } from './exam.js';
import { settings, saveSettings } from './settings.js';
import { MANUAL } from './helpdoc.js';
import { stripComments, readLatex, decode55 } from './tex55.js';
import { Slice } from 'prosemirror-model';
import { schema } from './schema.js';
import { insertMath } from './mathview.js';
import { compute, isEngineLoaded, formulaJson } from './compute.js';
import { leanTheorem, leanVerdict } from './lean.js';
import { isDesktop, leanCheck } from './desktop.js';
import { formulaPng, imagePng, copyPng } from './copyimage.js';
import { ICONS } from './icons.js';
import { setupTables } from './tables55.js';
import { GREEK, SYMBOL_PREFIX, TEMPLATES, actionFor, HELP_ROWS, FKEYS, COMBINING, NEGATE, NEGATE_TEXT } from './keys55.js';
import { _t, LANGUAGES } from './i18n.js';


// ---------- symbols ([shown, LaTeX]) ----------
const S = (s) => s.trim().split(/\s+/).map((pair) => { const i = pair.indexOf('='); return [pair.slice(0, i), pair.slice(i + 1)]; });
const CACHE = S(`π=\\pi θ=\\theta ∞=\\infty ∈=\\in →=\\rightarrow ℓ=\\ell ∇=\\nabla ∂=\\partial ≤=\\leq ≥=\\geq
  ⊂=\\subset ∩=\\cap ∪=\\cup ×=\\times ÷=\\div ±=\\pm ∘=\\circ ·=\\cdot`);
const PANELS = {
  'αβ': S(`α=\\alpha β=\\beta γ=\\gamma δ=\\delta ϵ=\\epsilon ε=\\varepsilon ζ=\\zeta η=\\eta θ=\\theta ϑ=\\vartheta
    ι=\\iota κ=\\kappa λ=\\lambda μ=\\mu ν=\\nu ξ=\\xi π=\\pi ϖ=\\varpi ρ=\\rho ϱ=\\varrho σ=\\sigma ς=\\varsigma
    τ=\\tau υ=\\upsilon ϕ=\\phi φ=\\varphi χ=\\chi ψ=\\psi ω=\\omega`),
  'ΦΨ': S(`Γ=\\Gamma Δ=\\Delta Θ=\\Theta Λ=\\Lambda Ξ=\\Xi Π=\\Pi Σ=\\Sigma Υ=\\Upsilon Φ=\\Phi Ψ=\\Psi Ω=\\Omega`),
  '±÷': S(`±=\\pm ∓=\\mp ×=\\times ÷=\\div ·=\\cdot ∘=\\circ ∗=\\ast ⋆=\\star †=\\dagger ‡=\\ddagger ∩=\\cap ∪=\\cup
    ⊎=\\uplus ⊓=\\sqcap ⊔=\\sqcup ∧=\\wedge ∨=\\vee ⊕=\\oplus ⊖=\\ominus ⊗=\\otimes ⊘=\\oslash ⊙=\\odot
    ⋄=\\diamond △=\\bigtriangleup ▽=\\bigtriangledown ∖=\\setminus ≀=\\wr`),
  '≤⊂': S(`≤=\\leq ≥=\\geq ≪=\\ll ≫=\\gg ⊂=\\subset ⊃=\\supset ⊆=\\subseteq ⊇=\\supseteq ⊑=\\sqsubseteq
    ⊒=\\sqsupseteq ∈=\\in ∋=\\ni ≺=\\prec ≻=\\succ ⪯=\\preceq ⪰=\\succeq ⊢=\\vdash ⊣=\\dashv ∣=\\mid ∥=\\parallel
    ≡=\\equiv ∼=\\sim ≃=\\simeq ≈=\\approx ≅=\\cong ∝=\\propto ⊥=\\perp ⌣=\\smile ⌢=\\frown ⊨=\\models ≐=\\doteq`),
  '≠∉': S(`≠=\\neq ∉=\\notin ≰=\\nleq ≱=\\ngeq ≮=\\nless ≯=\\ngtr ⊄=\\not\\subset ⊅=\\not\\supset ⊈=\\nsubseteq
    ⊉=\\nsupseteq ≁=\\nsim ≇=\\ncong ∤=\\nmid ∦=\\nparallel ⊀=\\nprec ⊁=\\nsucc`),
  '↔↑': S(`←=\\leftarrow →=\\rightarrow ↔=\\leftrightarrow ⇐=\\Leftarrow ⇒=\\Rightarrow ⇔=\\Leftrightarrow
    ↑=\\uparrow ↓=\\downarrow ↕=\\updownarrow ⇑=\\Uparrow ⇓=\\Downarrow ⇕=\\Updownarrow ↦=\\mapsto
    ↩=\\hookleftarrow ↪=\\hookrightarrow ⇌=\\rightleftharpoons ↗=\\nearrow ↘=\\searrow ↙=\\swarrow ↖=\\nwarrow
    ⟵=\\longleftarrow ⟶=\\longrightarrow ⟷=\\longleftrightarrow ⟸=\\Longleftarrow ⟹=\\Longrightarrow
    ⟺=\\Longleftrightarrow ⟼=\\longmapsto`),
  '∞∂': S(`∞=\\infty ∂=\\partial ∇=\\nabla ℓ=\\ell ℏ=\\hbar ℘=\\wp ℜ=\\Re ℑ=\\Im ℵ=\\aleph ∅=\\emptyset ∀=\\forall
    ∃=\\exists ¬=\\neg ′=\\prime ⊤=\\top ⊥=\\bot ∠=\\angle △=\\triangle □=\\square ♭=\\flat ♮=\\natural ♯=\\sharp
    ♣=\\clubsuit ♢=\\diamondsuit ♡=\\heartsuit ♠=\\spadesuit ⋯=\\cdots …=\\ldots ⋮=\\vdots ⋱=\\ddots`),
};
const OPERATORS = S(`∑=\\sum ∏=\\prod ∐=\\coprod ∫=\\int ∬=\\iint ∭=\\iiint ∮=\\oint ⋃=\\bigcup ⋂=\\bigcap
  ⨁=\\bigoplus ⨂=\\bigotimes ⋁=\\bigvee ⋀=\\bigwedge ⨆=\\bigsqcup ⨄=\\biguplus`);
const BRACKETS = [['( )', 'paren'], ['[ ]', 'bracket'], ['{ }', 'brace'], ['⟨ ⟩', 'angle'], ['| |', 'abs'], ['‖ ‖', 'norm'],
  ['⌊ ⌋', '\\left\\lfloor #0\\right\\rfloor'], ['⌈ ⌉', '\\left\\lceil #0\\right\\rceil']];
const NAMES = 'sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh log ln lg exp lim limsup liminf max min sup inf det dim ker deg gcd arg Pr hom'
  .split(' ').map((n) => [n, '\\' + n]);
const DECORATIONS = [['x̂', 'hat'], ['x̃', 'tilde'], ['x̄', 'bar'], ['x⃗', 'vec'], ['ẋ', 'dot'], ['ẍ', 'ddot'], ['x́', 'acute'],
  ['x̀', 'grave'], ['x̆', '\\breve{#0}'], ['x̌', '\\check{#0}'], ['x̅', '\\overline{#0}'], ['x̲', '\\underline{#0}'],
  ['⏞', '\\overbrace{#0}'], ['⏟', '\\underbrace{#0}'], ['x̂̂', '\\widehat{#0}'], ['x⃡', '\\overleftrightarrow{#0}'],
  ['x⃖', '\\overleftarrow{#0}'], ['x⃗⃗', '\\overrightarrow{#0}']];
const SPACES = [[_t('細空格'), 'thinspace'], [_t('粗空格'), 'thickspace'], [_t('不斷行空格'), 'nbsp'], [_t('1em 空格'), '\\quad'], [_t('2em 空格'), '\\qquad']];

// ---------- tags (bottom bar) ----------
const ITEM_TAGS = [['', _t('（項目標籤）')], ['axiom', _t('公理')], ['bullet', _t('項目清單')], ['case', _t('情形')], ['claim', _t('斷言')],
  ['conclusion', _t('結論')], ['condition', _t('條件')], ['conjecture', _t('猜想')], ['corollary', _t('推論')], ['criterion', _t('準則')],
  ['definition', _t('定義')], ['example', _t('例')], ['exercise', _t('習題')], ['lemma', _t('引理')], ['notation', _t('記號')],
  ['numbered', _t('編號清單')], ['problem', _t('問題')], ['proof', _t('證明')], ['proposition', _t('命題')], ['remark', _t('注')],
  ['solution', _t('解')], ['summary', _t('摘要')], ['theorem', _t('定理')]];
const BLOCK_TAGS = [['paragraph', _t('本文')], ['title', _t('文件標題')], ['h0', _t('部')], ['h1', _t('章')], ['h2', _t('節')], ['h3', _t('小節')], ['h4', _t('小小節')]];
// text tags; "size:large" is the size mark with that size
const TEXT_TAGS = [['', _t('（一般）')], ['bold', _t('粗體')], ['italic', _t('強調')], ['code', _t('打字機')], ['smallcaps', _t('小型大寫')],
  ['sans', _t('無襯線')], ['underline', _t('底線')], ['size:tiny', _t('極小')], ['size:scriptsize', _t('很小')], ['size:footnotesize', _t('註腳大小')],
  ['size:small', _t('小')], ['size:large', _t('大')], ['size:Large', _t('較大')], ['size:LARGE', _t('更大')], ['size:huge', _t('巨大')], ['size:Huge', _t('最巨大')]];

export function setupUI(app) {
  const { view } = app;
  const $ = (s) => document.querySelector(s);
  const run = (cmd) => { cmd(view.state, view.dispatch, view); view.focus(); };

  // ---------- math actions ----------
  const currentMath = () => document.activeElement?.closest?.('.math-inline, .math-display')?._mathView || null;
  function startMath() {
    insertMath(false)(view.state, view.dispatch, view);
    return view.nodeDOM(view.state.selection.from - 1)?._mathView || currentMath();
  }
  // insert LaTeX (a template with #0/#? or a symbol); in text this starts a formula first
  function mathInsert(latex) {
    const mv = currentMath() || startMath();
    if (!mv) return;
    mv.mf.insert(latex, { format: 'latex', selectionMode: /#[0?]/.test(latex) ? 'placeholder' : 'after', focus: true });
    mv.changed();
  }
  function mathAction(name) {
    if (name === 'superscript' || name === 'subscript') {
      const mv = currentMath() || startMath();
      if (!mv) return;
      mv.mf.executeCommand(name === 'superscript' ? 'moveToSuperscript' : 'moveToSubscript');
      mv.save();
    } else mathInsert(TEMPLATES[name] ?? name);
  }
  function toggleMath() {
    const mv = currentMath();
    if (mv) mv.exit(1); else startMath();
  }
  function display() {
    const mv = currentMath();
    if (mv) mv.exit(1);
    insertMath(true)(view.state, view.dispatch, view);
  }
  let lastMatrix = null;
  function insertMatrix() {
    if (!lastMatrix) { [$('#matrix-rows').value, $('#matrix-cols').value] = settings().matrix; }
    $('#matrix').hidden = false;
    const mv = currentMath();
    $('#matrix-rows').focus();
    $('#matrix-cancel').onclick = () => { $('#matrix').hidden = true; mv?.enter(false); };
    $('#matrix-ok').onclick = () => {
      $('#matrix').hidden = true;
      const r = Math.min(20, Math.max(1, +$('#matrix-rows').value || 1));
      const c = Math.min(20, Math.max(1, +$('#matrix-cols').value || 1));
      const env = $('#matrix-fence').value;
      lastMatrix = { r, c, env };
      mv?.enter(false);
      insertMatrixOf(lastMatrix);
    };
  }
  function insertMatrixOf({ r, c, env }) {
    const rows = Array.from({ length: r }, () => Array(c).fill('#?').join(' & ')).join('\\\\ ');
    mathInsert(`\\begin{${env}}${rows}\\end{${env}}`);
  }
  // Ctrl+N: negate the symbol left of the cursor
  function negate() {
    const mv = currentMath();
    if (mv) {
      const p = mv.mf.position;
      const left = p > 0 ? mv.mf.getValue(p - 1, p, 'latex').trim() : '';
      if (!NEGATE[left]) { app.toast(_t('左邊的符號沒有否定的寫法')); return; }
      mv.mf.executeCommand('deleteBackward');
      mv.mf.insert(NEGATE[left], { format: 'latex', selectionMode: 'after' });
      mv.changed();
      return;
    }
    const { $head, empty } = view.state.selection;
    const ch = empty && $head.parent.textBetween(Math.max(0, $head.parentOffset - 1), $head.parentOffset);
    if (!ch || !NEGATE_TEXT[ch]) { app.toast(_t('左邊的符號沒有否定的寫法')); return; }
    view.dispatch(view.state.tr.insertText(NEGATE_TEXT[ch], $head.pos - 1, $head.pos));
  }
  // Ctrl+F5: edit the formula's TeX
  function properties() {
    const mv = currentMath();
    const sel = view.state.selection;
    if (!mv && sel instanceof NodeSelection && sel.node.type.name === 'image') {
      if (sel.node.attrs.plot && sel.node.attrs.frame) plotProperties(sel.from, sel.node);
      else pictureProperties(sel.from, sel.node);
      return;
    }
    if (!mv && tables.inTable()) { tables.tableProperties(); return; }
    if (!mv) { app.toast(_t('先把游標放在公式或表格裡，或選取圖片，再按 Ctrl+F5')); return; }
    mv.save();
    const a = mv.node.attrs;
    // a displayed formula also has its number and marker (a multi-row one keeps them per row)
    const display = mv.node.type.name === 'math_display' && !a.rows;
    $('#props-display').hidden = !display;
    $('#props-text').value = mv.latex;
    $('#props-numbered').checked = !!a.numbered;
    $('#props-label').value = a.label || '';
    $('#props').hidden = false;
    $('#props-text').focus();
    $('#props-cancel').onclick = () => { $('#props').hidden = true; mv.enter(false); };
    $('#props-ok').onclick = () => {
      $('#props').hidden = true;
      const pos = mv.getPos();
      const attrs = { ...a, latex: $('#props-text').value };
      if (display) Object.assign(attrs, { numbered: $('#props-numbered').checked, label: $('#props-label').value.trim() || null });
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, attrs));
      view.nodeDOM(pos)?._mathView?.enter(false);
    };
  }

  // a small dialog: fields is HTML; onOk gets the dialog element
  function dialog(title, fields, onOk) {
    $('#dialog-title').textContent = title;
    $('#dialog-body').innerHTML = fields;
    $('#dialog').hidden = false;
    $('#dialog-body').querySelector('input, select')?.focus();
    $('#dialog-cancel').onclick = () => { $('#dialog').hidden = true; view.focus(); };
    $('#dialog-ok').onclick = () => { $('#dialog').hidden = true; onOk($('#dialog-body')); };
    $('#dialog-body').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#dialog-ok').click(); } };
  }
  const tables = setupTables({ view, dialog, toast: app.toast, run });
  // Edit > Properties on a picture: size, placement (in line, displayed, floating), caption and marker
  function pictureProperties(pos, node) {
    const a = node.attrs;
    const inches = (px, tex) => tex || (px ? (px / 96).toFixed(2) + 'in' : '');
    const opt = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    dialog(_t('圖片屬性'), `<p>${_t('檔案：{0}{1}', escHtml(a.path || _t('（沒有檔名）')), a.src ? '' : _t('（找不到檔案）'))}</p>
      <p>${_t('寬')} <input id="d-w" size="8" value="${escHtml(inches(a.width, a.texw))}"> ${_t('高')} <input id="d-h" size="8" value="${escHtml(inches(a.height, a.texh))}">
        <label><input id="d-keep" type="checkbox" checked> ${_t('保持比例')}</label></p>
      <p>${_t('位置')} <select id="d-place">${opt('inline', _t('在行內'), a.place)}${opt('display', _t('單獨一行'), a.place)}${opt('float', _t('浮動（有標題）'), a.place)}</select></p>
      <p>${_t('標題')} <input id="d-cap" size="30" value="${escHtml(a.caption || '')}"></p>
      <p>${_t('標記')} <input id="d-key" size="18" value="${escHtml(a.label || '')}"></p>`, (d) => {
      const w = d.querySelector('#d-w').value.trim();
      let h = d.querySelector('#d-h').value.trim();
      const wpx = toPx(w);
      let hpx = toPx(h);
      if (!wpx || !hpx) { app.toast(_t('寬和高要寫成 3in、5cm、100pt 這種長度')); return; }
      // keep the shape: a new width sets the height
      if (d.querySelector('#d-keep').checked && w !== inches(a.width, a.texw) && h === inches(a.height, a.texh) && a.width && a.height) {
        hpx = Math.round(wpx * a.height / a.width * 10) / 10;
        h = (hpx / 96).toFixed(4) + 'in';
      }
      const key = d.querySelector('#d-key').value.trim() || null;
      if (key && key !== a.label && markerKeys().includes(key)) { app.toast(_t('已經有標記「{0}」', key)); return; }
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, {
        ...a, width: wpx, height: hpx, texw: w, texh: h, place: d.querySelector('#d-place').value,
        caption: d.querySelector('#d-cap').value.trim() || null, label: key,
      }));
      view.focus();
    });
  }
  const markerKeys = () => {
    const keys = [];
    view.state.doc.descendants((n) => {
      if (n.type.name === 'marker') keys.push(n.attrs.key);
      if (n.type.name === 'image' && n.attrs.label) keys.push(n.attrs.label);
      if (n.type.name === 'math_display') for (const r of n.attrs.rows || [n.attrs]) if (r.label) keys.push(r.label);
    });
    return keys;
  };
  const escHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Insert > Marker: a name other places can refer to (in a displayed formula: the formula's marker)
  function insertMarker() {
    const mv = currentMath();
    dialog(_t('標記'), _t('<p>名稱 <input id="d-key" size="18" placeholder="例如 thm:main"></p>'), (d) => {
      const key = d.querySelector('#d-key').value.trim();
      if (!key) return;
      if (markerKeys().includes(key)) { app.toast(_t('已經有標記「{0}」', key)); return; }
      if (mv && mv.node.type.name === 'math_display' && !mv.node.attrs.rows) {
        view.dispatch(view.state.tr.setNodeMarkup(mv.getPos(), null, { ...mv.node.attrs, label: key, numbered: true }));
        return;
      }
      if (mv) mv.exit(1);
      view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.marker.create({ key })).scrollIntoView());
      view.focus();
    });
  }
  // an inline node at the cursor (out of a formula first)
  function insertInline(node) {
    const mv = currentMath();
    if (mv) mv.exit(1);
    view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    view.focus();
  }
  // Insert > Citation: keys from the document's list of references (or typed), and a note such as "p. 5"
  function insertCitation() {
    const keys = [];
    view.state.doc.descendants((n) => { if (n.type.name === 'bib_item') keys.push(n.attrs.key); });
    dialog(_t('引用文獻'), `<p>${_t('文獻代號')} <input id="d-keys" size="22" list="d-bibkeys" placeholder="${_t('多個用逗號分開')}">
      <datalist id="d-bibkeys">${keys.map((k) => `<option value="${escHtml(k)}">`).join('')}</datalist></p>
      <p>${_t('附註')} <input id="d-note" size="16" placeholder="${_t('例如 p.~5（可空白）')}"></p>`, (d) => {
      const k = d.querySelector('#d-keys').value.split(',').map((x) => x.trim()).filter(Boolean).join(',');
      if (!k) return;
      insertInline(schema.nodes.cite.create({ keys: k, note: d.querySelector('#d-note').value.trim() || null }));
    });
  }
  // Insert > Index Entry
  function insertIndexEntry() {
    const sel = view.state.selection;
    const picked = sel.empty ? '' : view.state.doc.textBetween(sel.from, sel.to, ' ');
    dialog(_t('索引項目'), `<p>${_t('項目')} <input id="d-entry" size="24" value="${escHtml(picked)}" placeholder="${_t('主項!子項')}"></p>`, (d) => {
      const entry = d.querySelector('#d-entry').value.trim();
      if (!entry) return;
      if (!sel.empty) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, sel.to)));
      insertInline(schema.nodes.index_entry.create({ entry }));
    });
  }
  // Insert > Hypertext Link: the selected text (or a new text) links to an address or a marker
  function insertLink() {
    const sel = view.state.selection;
    const picked = sel.empty ? '' : view.state.doc.textBetween(sel.from, sel.to, ' ');
    const keys = markerKeys();
    dialog(_t('超連結'), `<p>${_t('文字')} <input id="d-text" size="24" value="${escHtml(picked)}"></p>
      <p>${_t('連到')} <input id="d-href" size="28" list="d-markers" placeholder="${_t('https://… 或標記名稱')}">
      <datalist id="d-markers">${keys.map((k) => `<option value="${escHtml(k)}">`).join('')}</datalist></p>`, (d) => {
      const text = d.querySelector('#d-text').value;
      let href = d.querySelector('#d-href').value.trim();
      if (!text || !href) return;
      if (keys.includes(href)) href = '#' + href;
      const mark = schema.marks.link.create({ href });
      const tr = sel.empty || text !== picked
        ? view.state.tr.replaceSelectionWith(schema.text(text, [mark]), false)
        : view.state.tr.addMark(sel.from, sel.to, mark);
      view.dispatch(tr.scrollIntoView());
      view.focus();
    });
  }
  // Insert > Note: a footnote or margin note; its little editor opens at once
  function insertNote() {
    const mv = currentMath();
    dialog(_t('註解'), `<p>${_t('種類')} <select id="d-kind"><option value="footnote">${_t('註腳')}</option><option value="margin">${_t('邊註')}</option></select></p>`, (d) => {
      if (mv) mv.exit(1);
      const note = schema.nodes.note.create({ kind: d.querySelector('#d-kind').value });
      const { state } = view;
      const pos = state.selection.from;
      const tr = state.tr.replaceSelectionWith(note);
      const at = tr.mapping.map(pos, -1);
      view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, at)).scrollIntoView());
      view.dom.querySelector('.note-editor .ProseMirror')?.focus();
    });
  }
  // Insert > Cross Reference: the number (or page) of a marker
  function insertRef() {
    const keys = markerKeys();
    if (!keys.length) { app.toast(_t('文件裡還沒有標記，先用「插入 > 標記」')); return; }
    const mv = currentMath();
    dialog(_t('交叉引用'), `<p>${_t('標記')} <select id="d-key">${keys.map((k) => `<option>${escHtml(k)}</option>`).join('')}</select></p>
      <p>${_t('顯示')} <select id="d-kind"><option value="ref">${_t('編號')}</option><option value="eqref">${_t('（編號）')}</option><option value="pageref">${_t('頁碼')}</option></select></p>`, (d) => {
      if (mv) mv.exit(1);
      const node = schema.nodes.ref.create({ key: d.querySelector('#d-key').value, kind: d.querySelector('#d-kind').value });
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
      view.focus();
    });
  }

  // ---------- find / replace (Ctrl+Q / Ctrl+W), text only ----------
  function openFind(replace) {
    $('#findbar').hidden = false;
    $('#findbar').classList.toggle('with-replace', replace);
    const sel = view.state.selection;
    if (!sel.empty && sel.from !== sel.to) $('#find-text').value = view.state.doc.textBetween(sel.from, sel.to);
    $('#find-text').focus();
    $('#find-text').select();
  }
  // text, and formulas whose LaTeX has the text (a formula is found as a whole)
  const isMath = (n) => n.type.name === 'math_inline' || n.type.name === 'math_display';
  // the LaTeX outside command names (so "x" does not hit \exp)
  const noCmds = (latex) => latex.replace(/\\[a-zA-Z]+/g, ' ');
  const mathHas = (n, needle) => noCmds(n.attrs.latex).includes(needle);
  function matches(needle) {
    const out = [];
    if (!needle) return out;
    view.state.doc.descendants((n, pos) => {
      if (isMath(n)) { if (mathHas(n, needle)) out.push({ pos, math: true }); return false; }
      if (!n.isText) return true;
      let i = n.text.indexOf(needle);
      while (i >= 0) { out.push({ pos: pos + i }); i = n.text.indexOf(needle, i + needle.length); }
      return false;
    });
    return out;
  }
  function findNext() {
    const needle = $('#find-text').value;
    const all = matches(needle);
    if (!all.length) { app.toast(_t('找不到')); return false; }
    const sel = view.state.selection;
    const at = sel instanceof NodeSelection ? sel.from + 1 : sel.to;
    const m = all.find((x) => x.pos >= at) ?? all[0];
    const s = m.math ? NodeSelection.create(view.state.doc, m.pos) : TextSelection.create(view.state.doc, m.pos, m.pos + needle.length);
    view.dispatch(view.state.tr.setSelection(s).scrollIntoView());
    return true;
  }
  // in a formula, every place of the text in its LaTeX is replaced
  const replaceInMath = (tr, pos, node, needle, by) => tr.setNodeMarkup(pos, null, {
    ...node.attrs, latex: node.attrs.latex.replace(/(\\[a-zA-Z]+)|[^\\]+|\\./g, (m, cmd) => (cmd ? m : m.split(needle).join(by))),
  });
  function replaceOne() {
    const needle = $('#find-text').value;
    const sel = view.state.selection;
    if (needle && sel instanceof NodeSelection && isMath(sel.node) && mathHas(sel.node, needle)) {
      view.dispatch(replaceInMath(view.state.tr, sel.from, sel.node, needle, $('#replace-text').value));
    } else if (needle && view.state.doc.textBetween(sel.from, sel.to) === needle) {
      view.dispatch(view.state.tr.insertText($('#replace-text').value, sel.from, sel.to));
    }
    findNext();
  }
  function replaceAll() {
    const needle = $('#find-text').value;
    const all = matches(needle);
    let tr = view.state.tr;
    for (const m of all.reverse()) {
      tr = m.math ? replaceInMath(tr, m.pos, tr.doc.nodeAt(m.pos), needle, $('#replace-text').value) : tr.insertText($('#replace-text').value, m.pos, m.pos + needle.length);
    }
    if (all.length) view.dispatch(tr);
    app.toast(_t('取代了 {0} 處', all.length));
  }
  $('#find-next').onclick = findNext;
  $('#replace-one').onclick = replaceOne;
  $('#replace-all').onclick = replaceAll;
  $('#find-close').onclick = () => { $('#findbar').hidden = true; view.focus(); };
  $('#find-text').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(); } };
  // text-mode versions of the space keys
  const TEXT_SPACE = { thinspace: ' ', thickspace: ' ', nbsp: ' ' };
  function space(name) {
    if (currentMath()) { mathAction(name); return; }
    view.dispatch(view.state.tr.insertText(TEXT_SPACE[name]).scrollIntoView());
  }

  // ---------- text actions ----------
  const MARKS = ['bold', 'italic', 'code', 'smallcaps', 'sans', 'underline', 'size'];
  const tagMark = (v) => (v.startsWith('size:') ? schema.marks.size.create({ size: v.slice(5) }) : schema.marks[v].create());
  const tagOf = (m) => (m.type.name === 'size' ? 'size:' + m.attrs.size : m.type.name);
  function setTextTag(name) {
    const { from, to, empty } = view.state.selection;
    let tr = view.state.tr;
    if (empty) {
      for (const m of MARKS) tr = tr.removeStoredMark(schema.marks[m]);
      if (name) tr = tr.addStoredMark(tagMark(name));
    } else {
      for (const m of MARKS) tr = tr.removeMark(from, to, schema.marks[m]);
      if (name) tr = tr.addMark(from, to, tagMark(name));
    }
    view.dispatch(tr);
    view.focus();
  }
  function setItemTag(v) {
    if (!v) return;
    if (v === 'bullet') run(wrapInList(schema.nodes.bullet_list));
    else if (v === 'numbered') run(wrapInList(schema.nodes.ordered_list));
    else run(wrapIn(schema.nodes.env, { kind: v }));
  }
  function untag() {
    if (!liftListItem(schema.nodes.list_item)(view.state, view.dispatch)) lift(view.state, view.dispatch);
    view.focus();
  }
  function setBlockTag(v) {
    if (v === 'paragraph') run(setBlockType(schema.nodes.paragraph));
    else if (v === 'title') run(setBlockType(schema.nodes.title));
    else run(setBlockType(schema.nodes.heading, { level: +v.slice(1) }));
  }
  // Tag > Function Keys: which tag F2 … F12 apply (F10 opens the menus), kept between sessions
  const FKEY_NAMES = ['F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F11', 'F12'];
  const FKEY_STORE = 'opensw-fkeys';
  const OLD_CODE = { untag: 'untag', body: 'block:paragraph', normal: 'text:', bold: 'text:bold', italic: 'text:italic', code: 'text:code',
    numbered: 'item:numbered', bullet: 'item:bullet', menu: 'menu', h2: 'block:h2', h3: 'block:h3' };
  const DEFAULT_FKEYS = Object.fromEntries(Object.entries(FKEYS).map(([k, f]) => [k, OLD_CODE[f]]));
  function fkeys() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(FKEY_STORE) || '{}'); } catch (e) { /* storage off or damaged */ }
    return { ...DEFAULT_FKEYS, ...saved, F10: 'menu' };
  }
  const ALL_TAGS = [['untag', _t('移除項目標籤')], ...BLOCK_TAGS.map(([v, l]) => ['block:' + v, l]), ...ITEM_TAGS.slice(1).map(([v, l]) => ['item:' + v, l]),
    ...TEXT_TAGS.map(([v, l]) => ['text:' + v, v ? l : _t('一般')])];
  const tagName = (code) => (ALL_TAGS.find(([c]) => c === code) || [null, code])[1];
  function functionKeysDialog() {
    const now = fkeys();
    const sel = (k) => `<select id="d-${k}">${ALL_TAGS.map(([c, l]) => `<option value="${c}"${c === now[k] ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}</select>`;
    dialog(_t('功能鍵'), `<table class="info">${FKEY_NAMES.map((k) => `<tr><td>${k}</td><td>${sel(k)}</td></tr>`).join('')}</table>
      <p><label><input id="d-reset" type="checkbox"> ${_t('還原 5.5 的預設')}</label></p>`, (d) => {
      const out = d.querySelector('#d-reset').checked ? {} : Object.fromEntries(FKEY_NAMES.map((k) => [k, d.querySelector('#d-' + k).value]));
      try { localStorage.setItem(FKEY_STORE, JSON.stringify(out)); } catch (e) { app.toast(_t('存不了設定')); return; }
      app.toast(_t('功能鍵已更新'));
    });
  }
  // Tag > Appearance: how a tag looks on the screen (font, size, colour); the PDF is not changed,
  // as in 5.5. Kept between sessions.
  const LOOK_STORE = 'opensw-tag-looks';
  const LOOK_TAGS = [['block:paragraph', _t('本文'), 'p'], ['block:title', _t('文件標題'), 'h1.doc-title'], ['block:h0', _t('部'), 'h1:not(.doc-title)'],
    ['block:h1', _t('章'), 'h2'], ['block:h2', _t('節'), 'h3'], ['block:h3', _t('小節'), 'h4'], ['block:h4', _t('小小節'), 'h5'],
    ...ITEM_TAGS.slice(1).map(([v, l]) => ['item:' + v, l, v === 'numbered' ? 'ol' : v === 'bullet' ? 'ul' : '.env-' + v]),
    ['text:bold', _t('粗體'), 'strong'], ['text:italic', _t('強調'), 'em'], ['text:code', _t('打字機'), 'code'], ['text:smallcaps', _t('小型大寫'), '.m-sc'],
    ['text:sans', _t('無襯線'), '.m-sf'], ['text:underline', _t('底線'), 'u']];
  const FONTS = [['', _t('（不變）')], ['serif', _t('襯線（Times）')], ['sans', _t('無襯線')], ['mono', _t('等寬')], ['kai', _t('楷書')]];
  const FONT_CSS = { serif: '"Times New Roman", Times, serif', sans: 'Arial, "Microsoft JhengHei", sans-serif', mono: 'Consolas, "Courier New", monospace', kai: 'DFKai-SB, BiauKai, KaiTi, serif' };
  function looks() { try { return JSON.parse(localStorage.getItem(LOOK_STORE) || '{}'); } catch (e) { return {}; } }
  function applyLooks() {
    let style = document.querySelector('#tag-looks');
    if (!style) { style = document.createElement('style'); style.id = 'tag-looks'; document.head.append(style); }
    const all = looks();
    style.textContent = LOOK_TAGS.filter(([c]) => all[c]).map(([c, , sel]) => {
      const l = all[c];
      const rules = [l.font && `font-family:${FONT_CSS[l.font]}`, l.size && `font-size:${l.size}%`, l.color && `color:${l.color}`,
        l.bold != null && `font-weight:${l.bold ? 'bold' : 'normal'}`, l.italic != null && `font-style:${l.italic ? 'italic' : 'normal'}`].filter(Boolean);
      return `#editor .ProseMirror ${sel}{${rules.join(';')}}`;
    }).join('\n');
  }
  applyLooks();
  function appearanceDialog() {
    const all = looks();
    const show = (code) => {
      const l = all[code] || {};
      const tri = (id, v, label) => `<select id="${id}"><option value=""${v == null ? ' selected' : ''}>${_t('{0}（不變）', label)}</option><option value="1"${v === true ? ' selected' : ''}>${_t('是')}</option><option value="0"${v === false ? ' selected' : ''}>${_t('否')}</option></select>`;
      $('#d-look').innerHTML = `<p>${_t('字型')} <select id="d-font">${FONTS.map(([v, t]) => `<option value="${v}"${(l.font || '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></p>
        <p>${_t('大小')} <input id="d-size" size="4" value="${l.size || ''}">${_t('%（空白＝不變）')}</p>
        <p><label><input id="d-hascolor" type="checkbox"${l.color ? ' checked' : ''}> ${_t('顏色')}</label> <input id="d-color" type="color" value="${l.color || '#000000'}"></p>
        <p>${tri('d-bold', l.bold, _t('粗體'))} ${tri('d-italic', l.italic, _t('斜體'))}</p>`;
    };
    const read = (code) => {
      const size = +$('#d-size').value.trim();
      const tri = (id) => ($(id).value === '' ? undefined : $(id).value === '1');
      const l = { font: $('#d-font').value || undefined, size: size > 0 ? size : undefined, color: $('#d-hascolor').checked ? $('#d-color').value : undefined, bold: tri('#d-bold'), italic: tri('#d-italic') };
      if (Object.values(l).every((v) => v === undefined)) delete all[code]; else all[code] = JSON.parse(JSON.stringify(l));
    };
    dialog(_t('標籤外觀'), `<p>${_t('標籤')} <select id="d-tag">${LOOK_TAGS.map(([c, l]) => `<option value="${c}">${escHtml(l)}</option>`).join('')}</select>${_t('（只改螢幕上的樣子，不改排版）')}</p>
      <div id="d-look"></div><p><label><input id="d-clear" type="checkbox"> ${_t('全部還原')}</label></p>`, () => {
      read($('#d-tag').value);
      const out = $('#d-clear').checked ? {} : all;
      try { localStorage.setItem(LOOK_STORE, JSON.stringify(out)); } catch (e) { app.toast(_t('存不了設定')); return; }
      applyLooks();
      view.focus();
    });
    let cur = $('#d-tag').value;
    show(cur);
    $('#d-tag').onchange = () => { read(cur); cur = $('#d-tag').value; show(cur); };
  }
  // Go > Back / Forward: the places jumped from (Go menu, links, markers), as in 5.5
  const goneBack = [];
  const goneForward = [];
  function jumpTo(pos, { record = true } = {}) {
    if (record) { goneBack.push(view.state.selection.from); goneForward.length = 0; }
    const at = Math.min(pos, view.state.doc.content.size);
    view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at))).scrollIntoView());
    view.focus();
    const dom = view.nodeDOM(at) || view.domAtPos(at).node;
    (dom?.nodeType === 1 ? dom : dom?.parentElement)?.scrollIntoView?.({ block: 'center' });
  }
  function goHistory(dir) {
    const from = dir < 0 ? goneBack : goneForward;
    if (!from.length) { app.toast(dir < 0 ? _t('沒有上一個位置') : _t('沒有下一個位置')); return; }
    (dir < 0 ? goneForward : goneBack).push(view.state.selection.from);
    jumpTo(from.pop(), { record: false });
  }
  // where a marker is: a \label in text, a formula, a picture or a caption
  function markerPos(key) {
    let at = null;
    view.state.doc.descendants((n, pos) => {
      if (at != null) return false;
      if ((n.type.name === 'marker' && n.attrs.key === key) || (n.type.name === 'image' && n.attrs.label === key)
        || (n.type.name === 'math_display' && (n.attrs.rows || [n.attrs]).some((r) => r.label === key))) at = pos;
      return true;
    });
    return at;
  }
  // Go > Follow Link: the link at the cursor (a marker in the document, or a web address)
  async function followLink() {
    const { $from } = view.state.selection;
    const link = [...$from.marks(), ...($from.nodeAfter?.marks || [])].find((m) => m.type.name === 'link');
    if (!link) { app.toast(_t('游標要在超連結上')); return; }
    const href = link.attrs.href;
    if (href.startsWith('#')) {
      const at = markerPos(href.slice(1));
      if (at == null) app.toast(_t('找不到標記 ') + href.slice(1)); else jumpTo(at);
      return;
    }
    if (isDesktop) { const { openUrl } = await import('@tauri-apps/plugin-opener'); await openUrl(href); } else window.open(href, '_blank', 'noopener');
  }
  function goSection(dir) {
    const here = view.state.selection.from;
    const heads = [];
    view.state.doc.descendants((n, pos) => { if (n.type.name === 'heading' || n.type.name === 'title') heads.push(pos); });
    const target = dir > 0 ? heads.find((p) => p > here) : heads.reverse().find((p) => p + 1 < here);
    if (target == null) return;
    goneBack.push(here);
    goneForward.length = 0;
    const tr = view.state.tr.setSelection(Selection.near(view.state.doc.resolve(target + 1)));
    view.dispatch(tr.scrollIntoView());
    view.focus();
    view.domAtPos(target + 1).node?.scrollIntoView?.({ block: 'start' });
  }
  // Go > Marker: the place a marker names (a \label in text, a formula, a picture or a caption)
  function goMarker() {
    const keys = markerKeys();
    if (!keys.length) { app.toast(_t('文件裡沒有標記')); return; }
    dialog(_t('前往標記'), `<p>${_t('標記')} <select id="d-key">${keys.map((k) => `<option>${escHtml(k)}</option>`).join('')}</select></p>`, (d) => {
      const at = markerPos(d.querySelector('#d-key').value);
      if (at != null) jumpTo(at);
    });
  }
  // Insert > TeX Field: LaTeX passed through as written
  function insertTexField() {
    dialog(_t('TeX 欄位'), _t('<p><textarea id="d-tex" rows="4" cols="40" placeholder="例如 \\vspace{1cm}"></textarea></p>'), (d) => {
      const tex = d.querySelector('#d-tex').value.trim();
      if (tex) insertInline(schema.nodes.tex_field.create({ tex }));
    });
    $('#dialog-body').onkeydown = null; // Enter makes a new line in the TeX
  }
  // Insert > HTML Field: HTML put into the page when the document is exported as HTML (TeX skips it)
  function insertHtmlField() {
    dialog(_t('HTML 欄位'), _t('<p>只在匯出 HTML 時使用，排版 PDF 時略過。</p><p><textarea id="d-html" rows="4" cols="40" placeholder="例如 <iframe src=…></iframe>"></textarea></p>'), (d) => {
      const html = d.querySelector('#d-html').value.trim();
      if (html) insertInline(schema.nodes.html_field.create({ html }));
    });
    $('#dialog-body').onkeydown = null; // Enter makes a new line
  }
  // Typeset > Preamble: the LaTeX before \begin{document}
  function editPreamble() {
    const meta = app.meta();
    const is55 = !!meta.preamble55;
    const text = is55 ? (meta.preamble55raw ?? meta.preamble55) : (meta.preambleTeX || '');
    dialog(_t('導言'), `<p>${is55 ? _t('Scientific Word 5 文件的導言（\\documentclass 到 \\begin{document} 之前）') : _t('加在 \\begin{document} 之前的 LaTeX（例如 \\newtheorem、\\usepackage）')}</p>
      <p><textarea id="d-pre" rows="16" cols="70" spellcheck="false"></textarea></p>`, (d) => {
      const v = d.querySelector('#d-pre').value;
      if (is55) app.setMeta({ ...meta, preamble55raw: v, preamble55: stripComments(v).replace(/\n{3,}/g, '\n\n').trim() });
      else app.setMeta({ ...meta, preambleTeX: v });
      app.toast(_t('導言已更新'));
    });
    $('#d-pre').value = text;
    $('#dialog-body').onkeydown = null;
  }
  // Properties of the other kinds of plot: the formulas, the variables' ranges, the grid,
  // and what the kind has of its own (a tube's radius, the boxes of an approximate integral)
  function otherPlotProperties(pos, node, plot, kind) {
    const a = node.attrs;
    const dims = DIMS[kind];
    const c0 = plot.curves[0];
    const names = kind === 'conformal' ? ['Re ' + plot.variable, 'Im ' + plot.variable] : kind === 'ode' ? [plot.variable] : [c0.variable || plot.variable, plot.variable2, plot.variable3];
    const ranges = [c0.range, c0.range2, c0.range3];
    const rows = plot.curves.map((c, k) => `<p>${kind === 'ode' ? _t('方程組') : _t('公式')} ${plot.curves.length > 1 ? k + 1 : ''} <input id="d-f${k}" size="30" value="${escHtml(c.latex)}"></p>`).join('');
    const rangeRows = Array.from({ length: dims }, (_, i) => `<p>${_t('{0} 從', escHtml(names[i] || 'xyz'[i]))} <input id="d-a${i}" size="6" value="${ranges[i][0]}"> ${_t('到')} <input id="d-b${i}" size="6" value="${ranges[i][1]}"></p>`).join('');
    const gridRow = ['implicit', 'inequality', 'vector', 'gradient', 'conformal', 'implicit3', 'vector3', 'gradient3', 'cylindrical', 'spherical', 'surface', 'tube'].includes(kind)
      ? `<p>${_t('格線數')} <input id="d-g" size="4" value="${c0.grid[0] || ''}"></p>` : '';
    const own = kind === 'tube' ? `<p>${_t('半徑')} <input id="d-r" size="10" value="${escHtml(c0.radius || '0.2')}"></p>`
      : kind === 'approx' ? `<p>${_t('方法')} <select id="d-m">${[['left', _t('左端點')], ['midpoint', _t('中點')], ['right', _t('右端點')], ['upper', _t('上和')], ['lower', _t('下和')], ['trapezoid', _t('梯形')]]
        .map(([v, l]) => `<option value="${v}"${String(c0.boxType || 'left').toLowerCase().startsWith(v.slice(0, 3)) ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${_t('區間數')} <input id="d-n" size="4" value="${c0.boxes || 10}"></p>` : '';
    dialog(_t('繪圖屬性'), rows + rangeRows + gridRow + own, (d) => {
      const rs = [];
      for (let i = 0; i < dims; i++) {
        const lo = +d.querySelector(`#d-a${i}`).value; const hi = +d.querySelector(`#d-b${i}`).value;
        if (!(lo < hi)) { app.toast(_t('範圍要從小到大')); return; }
        rs.push([lo, hi]);
      }
      const g = d.querySelector('#d-g') ? Math.round(+d.querySelector('#d-g').value) : null;
      if (g != null && !(g >= 2)) { app.toast(_t('格線數至少 2')); return; }
      plot.curves.forEach((c, k) => {
        c.latex = d.querySelector(`#d-f${k}`).value.trim() || c.latex;
        [c.range, c.range2, c.range3] = [rs[0] || c.range, rs[1] || c.range2, rs[2] || c.range3];
        if (g) c.grid = c.grid.map((x, i) => (i < Math.max(dims, 2) ? (kind === 'tube' && i === 1 ? x : g) : x));
        if (kind === 'tube') c.radius = d.querySelector('#d-r').value.trim() || c.radius;
        if (kind === 'approx') { c.boxType = d.querySelector('#d-m').value; c.boxes = Math.max(1, Math.round(+d.querySelector('#d-n').value) || 10); }
      });
      if (!drawable(plot)) { app.toast(_t('這個公式不合這種繪圖')); return; }
      plot.range = rs[0];
      const special = plotSpecial(plot, { width: a.texw || '3in', height: a.texh || '2in', path: a.path });
      const head = a.frame.slice(0, a.frame.indexOf('\\special'));
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...a, frame: head + special + '}', src: null }));
      app.forgetPicture(a.path);
      status(_t('繪圖中…'));
      app.renderPlots().finally(() => status(''));
    });
  }
  // Properties of a 5.x-style plot: the window, and each function with its colour
  function plotProperties(pos, node) {
    const a = node.attrs;
    const plot = parsePlot(a.frame.slice(a.frame.indexOf('\\special')));
    if (!drawable(plot)) { app.toast(_t('這個繪圖的公式 opensw 畫不出來，不能在這裡改')); return; }
    const kind = plotKind(plot);
    if (!['rect', 'log', 'loglog', 'polar', 'param'].includes(kind) && !(kind === 'surface' && components(plot.curves[0].latex).length === 1)) {
      otherPlotProperties(pos, node, plot, kind);
      return;
    }
    const rect = ['rect', 'log', 'loglog'].includes(kind);
    // y = f(x): x is the window; polar and parametric: the parameter's range; 3D: x and y ranges
    const [x0, x1] = rect ? plot.view.x || plot.range || [-5, 5] : plot.curves[0].range;
    const [y0, y1] = kind === 'surface' ? plot.curves[0].range2 : plot.view.y || ['', ''];
    const v1 = plot.variable || 'x';
    const v2 = kind === 'surface' ? plot.variable2 || 'y' : 'y';
    const colors = [['#ff0000', _t('紅')], ['#0000ff', _t('藍')], ['#008000', _t('綠')], ['#000000', _t('黑')], ['#ff00ff', _t('洋紅')], ['#808080', _t('灰')]];
    const colorSel = (k, cur) => (kind === 'surface' ? '' : `<select id="d-c${k}">${colors.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`);
    const rows = plot.curves.map((c, k) => `<p>${_t('函數 {0}', k + 1)} <input id="d-f${k}" size="26" value="${escHtml(c.latex)}"> ${colorSel(k, c.color)}</p>`).join('');
    const hint = kind === 'param' ? _t('例如 (\\cos t, \\sin t)') : kind === 'polar' ? _t('例如 1+\\cos\\theta') : _t('例如 \\cos x');
    dialog(_t('繪圖屬性'), `${rows}<p>${_t('新增函數')} <input id="d-fnew" size="26" placeholder="${escHtml(hint)}（可空白）"></p>
      <p>${_t('{0} 從', rect ? 'x' : escHtml(v1))} <input id="d-x0" size="5" value="${x0}"> ${_t('到')} <input id="d-x1" size="5" value="${x1}"></p>
      ${kind === 'polar' || kind === 'param' ? '' : `<p>${_t('{0} 從', kind === 'surface' ? escHtml(v2) : 'y')} <input id="d-y0" size="5" value="${y0}"> ${_t('到')} <input id="d-y1" size="5" value="${y1}">${rect ? _t('（空白＝自動）') : ''}</p>`}
      ${rect ? `<p>${_t('座標軸刻度')} <select id="d-scale">${[['rect', _t('一般')], ['log', _t('對數（y）')], ['loglog', _t('雙對數')]].map(([v, l]) => `<option value="${v}"${v === kind ? ' selected' : ''}>${l}</option>`).join('')}</select></p>` : ''}`, (d) => {
      const num = (id) => { const v = d.querySelector(id)?.value.trim(); return v == null || v === '' ? null : +v; };
      const nx0 = num('#d-x0'); const nx1 = num('#d-x1'); const ny0 = num('#d-y0'); const ny1 = num('#d-y1');
      if (!(nx0 < nx1)) { app.toast(_t('範圍要從小到大')); return; }
      if (kind === 'surface' && !(ny0 < ny1)) { app.toast(_t('範圍要從小到大')); return; }
      plot.curves.forEach((c, k) => {
        c.latex = d.querySelector(`#d-f${k}`).value.trim() || c.latex;
        if (kind !== 'surface') c.color = d.querySelector(`#d-c${k}`).value;
        c.range = [nx0, nx1];
        if (kind === 'surface') c.range2 = [ny0, ny1];
      });
      const extra = d.querySelector('#d-fnew').value.trim();
      if (extra) plot.curves.push({ latex: extra, color: colors[plot.curves.length % colors.length][0], width: 1, range: [nx0, nx1], range2: [ny0, ny1], n: 100 });
      plot.range = [nx0, nx1];
      if (rect) {
        plot.plottype = PLOTTYPE[d.querySelector('#d-scale').value];
        if (plot.plottype !== 4 && ((ny0 != null && ny0 <= 0) || (plot.plottype === 21 && nx0 <= 0))) { app.toast(_t('對數刻度的範圍要大於 0')); return; }
        plot.view.x = [nx0, nx1];
        plot.view.y = ny0 != null && ny1 != null && ny0 < ny1 ? [ny0, ny1] : null;
      }
      const special = plotSpecial(plot, { width: a.texw || '3in', height: a.texh || '2in', path: a.path });
      // the frame keeps its own flags and size; its \special is the new one
      const head = a.frame.slice(0, a.frame.indexOf('\\special'));
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...a, frame: head + special + '}', src: null }));
      app.forgetPicture(a.path);
      status(_t('繪圖中…'));
      app.renderPlots().finally(() => status(''));
    });
  }
  // Compute > Plot 2D > Rectangular: a plot of the formula, as 5.5 makes it (a frame
  // with the plot's settings, drawn by plots.js)
  let plotCount = 0;
  function plot2d() {
    const mv = currentMath();
    if (!mv) { app.toast(_t('把游標放在要畫的公式裡')); return; }
    mv.save();
    let f = mv.latex.trim();
    const eq = f.split(/(?<![<>\\])=/);
    if (eq.length > 1) f = eq[eq.length - 1].trim(); // y = f(x): draw the right side
    const v = (f.match(/(?<![\\a-zA-Z])([a-zA-Z])(?![a-zA-Z])/) || [])[1] || 'x';
    let path;
    const used = new Set();
    view.state.doc.descendants((n) => { if (n.type.name === 'image') used.add(n.attrs.path); });
    do path = `opensw-plot-${++plotCount}.wmf`; while (used.has(path));
    const special = `\\special{language "Scientific Word";type "MAPLEPLOT";width 3in;height 2in;depth 0pt;display "USEDEF";plot_snapshots TRUE;`
      + `xmin "-5";xmax "5";xviewmin "-5";xviewmax "5";viewset"X";rangeset"X";plottype 4;axesstyle "normal";numpoints 100;`
      + `var1name \\TEXUX{$${v}$};function \\TEXUX{$${f}$};linecolor "red";linestyle 1;linethickness 1;lineAttributes "Solid";`
      + `var1range "-5,5";num-x-gridlines 100;curveColor "[flat::RGB:0x00ff0000]";curveStyle "Line";valid_file "T";tempfilename '${path}';}`;
    const frame = `\\FRAME{dtbpFX}{3in}{2in}{0pt}{}{}{Plot}{${special}}`;
    const node = schema.nodes.image.create({ path, width: 288, height: 192, texw: '3in', texh: '2in', place: 'display', frame, name: 'Plot', plot: true });
    mv.exit(1);
    view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    view.focus();
    status(_t('繪圖中…（第一次要載入計算引擎，要幾秒）'));
    app.renderPlots().finally(() => status(''));
  }
  // the variables of a formula: single letters (not e, i) and Greek letters (not \pi)
  const varsOf = (f) => [...new Set([...f.matchAll(/\\(alpha|beta|gamma|theta|vartheta|phi|varphi|rho|psi|omega|tau|sigma|lambda|mu|xi|eta|zeta)(?![a-zA-Z])|(?<![\\a-zA-Z])([a-zA-Z])(?![a-zA-Z])/g)]
    .map((m) => (m[1] ? '\\' + m[1] : m[2])).filter((v) => v !== 'e' && v !== 'i'))];
  // Compute > Plot 2D / Plot 3D (except Plot 2D > Rectangular): a frame with the plot's
  // settings as 5.5 writes them (plots.js), drawn by plotdata.js
  function plotOther(kind, extra = {}) {
    const mv = extra.mv || currentMath();
    if (!mv) { app.toast(_t('把游標放在要畫的公式裡')); return; }
    mv.save();
    const whole = mv.latex.trim();
    let f = whole;
    const eq = f.split(/(?<![<>\\])=/);
    // r = f(θ), z = f(x, y): draw the right side (an implicit plot, an inequality and an ODE keep it all)
    if (eq.length > 1 && !['implicit', 'implicit3', 'ode'].includes(kind)) f = eq[eq.length - 1].trim();
    const parts = components(f).length;
    const vs = varsOf(f).sort();
    const two = (d1, d2) => (vs.length >= 2 ? vs.slice(0, 2) : vs[0] === d2 ? [d1, d2] : [vs[0] || d1, d2]);
    const red = '#ff0000';
    const five = [-5, 5];
    const need = (ok, msg) => { if (!ok) app.toast(msg); return ok; };
    let plot;
    switch (kind) {
      case 'surface': {
        const [v1, v2] = two('x', 'y');
        if (!need(parts === 1 || parts === 3, _t('3D 直角座標要一條公式 f(x, y)，或參數式 (x(s,t), y(s,t), z(s,t))'))) return;
        plot = { plottype: 5, axes: 'normal', variable: v1, variable2: v2, view: {}, curves: [{ latex: f, range: five, range2: five, grid: [25, 25] }] };
        break;
      }
      case 'polar': case 'param': {
        if (!need(kind === 'polar' || parts === 2, _t('參數式要寫成 (x(t), y(t))，例如 (\\cos t, \\sin t)'))) return;
        const v = /\\theta/.test(f) ? '\\theta' : vs.includes('t') ? 't' : vs[0] || 't';
        const range = kind === 'polar' ? [-3.1416, 3.1416] : [0, 6.2832];
        plot = { plottype: kind === 'polar' ? 8 : 19, axes: 'normal', variable: v, constrained: kind === 'polar', view: { x: null, y: null }, range,
          curves: [{ latex: f, color: red, width: 1, range, n: 200 }] };
        break;
      }
      case 'implicit': case 'inequality': {
        const rel = splitRelation(f)?.rel || '';
        if (kind === 'implicit' && !need(rel === '=', _t('隱函數要寫成等式，例如 x^2+y^2=1'))) return;
        if (kind === 'inequality' && !need(/[<>]/.test(rel), _t('要寫成不等式，例如 x+y^2<5'))) return;
        const [v1, v2] = two('x', 'y');
        plot = { plottype: PLOTTYPE[kind], variable: v1, variable2: v2, view: {},
          curves: [{ latex: f, color: kind === 'implicit' ? red : '#000000', width: 1, range: five, range2: five, grid: kind === 'implicit' ? [24, 24] : [120, 120],
            ...(kind === 'inequality' ? { fill: '#ffcd99', fill2: '#ffffff' } : {}) }] };
        break;
      }
      case 'gradient': case 'vector': case 'conformal': {
        if (kind === 'vector' && !need(parts === 2, _t('向量場要寫成 [P(x,y), Q(x,y)]，例如 [x+y, x-y]'))) return;
        if (kind !== 'vector' && !need(parts === 1, _t('要一條公式'))) return;
        const [v1, v2] = kind === 'conformal' ? [vs[0] || 'z', 'w'] : two('x', 'y');
        const r = kind === 'conformal' ? [0, 1] : five;
        plot = { plottype: PLOTTYPE[kind], variable: v1, variable2: v2, view: {},
          curves: [{ latex: f, color: kind === 'conformal' ? '#000080' : kind === 'vector' ? '#008000' : '#0000ff', width: 1, range: r, range2: r,
            grid: kind === 'vector' ? [20, 20] : kind === 'gradient' ? [10, 10] : [11, 11] }] };
        break;
      }
      case 'approx': {
        const v = vs[0] || 'x';
        plot = { plottype: 3, variable: v, view: {}, range: extra.range,
          curves: [{ latex: f, color: '#000000', width: 1, range: extra.range, n: 100, boxes: extra.boxes, boxType: extra.boxType, fill: '#ffcd99' }] };
        break;
      }
      case 'ode': {
        const { equations, inits } = odeRows(whole);
        if (!need(equations.length && inits.length, _t('把方程和起始值打成一行矩陣，例如 y\'=\\sin(xy) 和 y(0)=3'))) return;
        const x0 = Number(inits[0][1]);
        const range = Number.isFinite(x0) ? [x0, x0 + 5] : [0, 5];
        const v = (whole.match(/\\frac\{d[a-zA-Z]\}\{d([a-zA-Z])\}/) || [])[1] || (inits[0][1].match(/^[a-zA-Z]$/) ? 't' : 'x');
        plot = { plottype: 23, variable: v, view: {}, range, curves: [{ latex: whole, color: red, width: 1, range, n: 200 }] };
        break;
      }
      case 'cylindrical': case 'spherical': {
        if (!need(parts === 1 || parts === 3, kind === 'cylindrical' ? _t('要寫成 r = f(θ, z) 或 (r, θ, z)') : _t('要寫成 ρ = f(θ, φ) 或 (ρ, θ, φ)'))) return;
        const cyl = kind === 'cylindrical';
        const [v1, v2] = cyl ? ['\\theta', 'z'] : ['\\theta', vs.includes('\\phi') ? '\\phi' : '\\varphi'];
        plot = { plottype: PLOTTYPE[kind], variable: v1, variable2: v2, variable3: cyl ? 'r' : '\\rho', constrained: !cyl, view: {},
          curves: [{ latex: f, range: [-3.1416, 3.1416], range2: cyl ? five : [0, 3.1416], grid: [25, 25] }] };
        break;
      }
      case 'implicit3': case 'gradient3': case 'vector3': {
        if (kind === 'implicit3' && !need(splitRelation(f)?.rel === '=', _t('要寫成等式，例如 x^2+y^2+z^2=9'))) return;
        if (kind === 'vector3' && !need(parts === 3, _t('要寫成 [P, Q, R]，例如 [-y, x, z]'))) return;
        plot = { plottype: PLOTTYPE[kind], variable: 'x', variable2: 'y', variable3: 'z', view: {},
          curves: [{ latex: f, range: five, range2: five, range3: five, grid: kind === 'implicit3' ? [10, 10, 10] : [6, 6, 6] }] };
        break;
      }
      case 'tube': {
        if (!need(parts === 3, _t('管狀要寫成 (x(t), y(t), z(t))，例如 (\\cos t, \\sin t, t/5)'))) return;
        const v = vs.includes('t') ? 't' : vs[0] || 't';
        plot = { plottype: 13, variable: v, view: {}, curves: [{ latex: f, radius: '0.2', range: [0, 6.2832], grid: [50, 8] }] };
        break;
      }
      default: return;
    }
    let path;
    const used = new Set();
    view.state.doc.descendants((n) => { if (n.type.name === 'image') used.add(n.attrs.path); });
    do path = `opensw-plot-${++plotCount}.wmf`; while (used.has(path));
    const frame = `\\FRAME{dtbpFX}{3in}{2in}{0pt}{}{}{Plot}{${plotSpecial(plot, { width: '3in', height: '2in', path })}}`;
    const node = schema.nodes.image.create({ path, width: 288, height: 192, texw: '3in', texh: '2in', place: 'display', frame, name: 'Plot', plot: true });
    mv.exit(1);
    view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    view.focus();
    status(_t('繪圖中…（第一次要載入計算引擎，要幾秒）'));
    app.renderPlots().finally(() => status(''));
  }
  // Compute > Calculus > Plot Approximate Integral: the boxes of a Riemann sum under the curve
  function plotApproxIntegral() {
    const mv = currentMath();
    if (!mv) { app.toast(_t('把游標放在要畫的公式裡')); return; }
    dialog(_t('畫近似積分圖'), `<p>${_t('方法')} <select id="d-m">${[['left', _t('左端點')], ['midpoint', _t('中點')], ['right', _t('右端點')], ['upper', _t('上和')], ['lower', _t('下和')],
      ['trapezoid', _t('梯形')]].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></p>
      <p>${_t('區間數')} <input id="d-n" size="5" value="10"></p><p>${_t('從')} <input id="d-a" size="5" value="0"> ${_t('到')} <input id="d-b" size="5" value="1"></p>`, (d) => {
      const a = +field(d, '#d-a'); const b = +field(d, '#d-b'); const n = Math.round(+field(d, '#d-n'));
      if (!(a < b) || !(n >= 1)) { app.toast(_t('區間要從小到大，區間數至少 1')); return; }
      plotOther('approx', { mv, range: [a, b], boxes: n, boxType: d.querySelector('#d-m').value });
    });
  }
  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      view.dispatch(view.state.tr.insertText(text).scrollIntoView());
    } catch (e) { app.toast(_t('請按 Ctrl+V 貼上')); }
  }

  // Edit > Copy as Picture: the formula at the cursor, or the selected picture or plot, as a PNG
  async function copyAsPicture() {
    const mv = currentMath();
    const sel = view.state.selection;
    const node = sel.node;
    try {
      let blob;
      if (mv) { mv.save(); blob = await formulaPng(mv.latex, mv.node.type.name === 'math_display', settings().pictureScale); } else if (node && (node.type.name === 'math_inline' || node.type.name === 'math_display')) blob = await formulaPng(node.attrs.latex, node.type.name === 'math_display', settings().pictureScale);
      else if (node?.type.name === 'image') {
        const img = view.nodeDOM(sel.from)?.querySelector('img');
        if (!img) { app.toast(_t('這張圖還沒顯示出來，不能複製')); return; }
        blob = await imagePng(img);
      } else { app.toast(_t('把游標放在公式裡，或選取一張圖')); return; }
      await copyPng(blob);
      app.toast(_t('已複製成圖片，可以貼到其他程式'));
    } catch (e) { app.toast(_t('複製失敗：') + (e.message || e)); }
  }
  // Edit > Paste Special: the clipboard's text as plain text, as LaTeX (formulas, sections ...),
  // or as one formula
  async function pasteSpecial() {
    let text;
    try { text = await navigator.clipboard.readText(); } catch (e) { app.toast(_t('讀不到剪貼簿，請按 Ctrl+V 貼上')); return; }
    dialog(_t('選擇性貼上'), `<p><label><input type="radio" name="d-as" value="text" checked> ${_t('純文字')}</label></p>
      <p><label><input type="radio" name="d-as" value="latex"> ${_t('LaTeX（公式、節標題等照 LaTeX 讀）')}</label></p>
      <p><label><input type="radio" name="d-as" value="math"> ${_t('一條公式')}</label></p>`, (d) => {
      const as = d.querySelector('input[name="d-as"]:checked').value;
      let tr = view.state.tr;
      if (as === 'text') tr = tr.insertText(text);
      else if (as === 'math') tr = tr.replaceSelectionWith(schema.nodes.math_inline.create({ latex: text.trim().replace(/^\$+|\$+$/g, '') }));
      else { insertLatex(text); return; }
      view.dispatch(tr.scrollIntoView());
      view.focus();
    });
  }
  // LaTeX (5.x's too) read as a document and put at the cursor; one paragraph goes in line
  function insertLatex(text) {
    const doc = readLatex(text).doc;
    const one = doc.childCount === 1 && doc.firstChild.type.name === 'paragraph';
    const tr = view.state.tr;
    view.dispatch((one ? tr.replaceSelection(new Slice(doc.firstChild.content, 0, 0)) : tr.replaceSelection(new Slice(doc.content, 0, 0))).scrollIntoView());
    view.focus();
  }

  // ---------- fragments: pieces of 5.x documents kept for later (5.5's .frg files) ----------
  // kept on this computer; .frg files (from 5.5's Frags folder) can be added from File > Import Fragment
  const FRAG_KEY = 'opensw-fragments';
  // a few constants, as 5.5's Constants fragments (CODATA 2018 values)
  const BUILTIN_FRAGMENTS = {
    [_t('常數/光速')]: '$c=2.99792458\\times 10^{8}\\unit{m}\\unit{s}^{-1}$',
    [_t('常數/普朗克常數')]: '$h=6.62607015\\times 10^{-34}\\unit{J}\\unit{s}$',
    [_t('常數/基本電荷')]: '$e=1.602176634\\times 10^{-19}\\unit{C}$',
    [_t('常數/波茲曼常數')]: '$k=1.380649\\times 10^{-23}\\unit{J}\\unit{K}^{-1}$',
    [_t('常數/亞佛加厥數')]: '$N_{A}=6.02214076\\times 10^{23}\\unit{mol}^{-1}$',
    [_t('常數/萬有引力常數')]: '$G=6.67430\\times 10^{-11}\\unit{m}^{3}\\unit{kg}^{-1}\\unit{s}^{-2}$',
    [_t('常數/電子質量')]: '$m_{e}=9.1093837015\\times 10^{-31}\\unit{kg}$',
    [_t('常數/質子質量')]: '$m_{p}=1.67262192369\\times 10^{-27}\\unit{kg}$',
  };
  const userFragments = () => { try { return JSON.parse(localStorage.getItem(FRAG_KEY) || '{}'); } catch (e) { return {}; } };
  const allFragments = () => ({ ...userFragments(), ...BUILTIN_FRAGMENTS });
  function storeFragments(f) {
    try { localStorage.setItem(FRAG_KEY, JSON.stringify(f)); } catch (e) { app.toast(_t('存不了片段（瀏覽器不允許儲存）')); }
    refreshFragmentList();
  }
  // the names in 5.5's order: your own first, then the folders (here: 常數), sorted
  const fragmentNames = () => Object.keys(allFragments()).sort((a, b) => (a.includes('/') - b.includes('/')) || a.localeCompare(b, 'zh-Hant'));
  function importFragment() {
    const names = fragmentNames();
    const mine = userFragments();
    dialog(_t('匯入片段'), `<p><select id="d-frag" size="12" style="min-width:22em">${names.map((n) => `<option value="${escHtml(n)}">${escHtml(n.includes('/') ? '　' + n.split('/').pop() + _t('（') + n.split('/')[0] + _t('）') : n)}</option>`).join('')}</select></p>
      <p><button type="button" id="d-frag-del">${_t('刪除選取的片段')}</button> <button type="button" id="d-frag-file">${_t('從 .frg 檔加入…')}</button></p>`, (d) => {
      const n = d.querySelector('#d-frag').value;
      if (n) insertLatex(allFragments()[n]);
    });
    const sel = $('#d-frag');
    if (sel.options.length) sel.selectedIndex = 0;
    sel.ondblclick = () => $('#dialog-ok').click();
    $('#d-frag-del').onclick = () => {
      const n = sel.value;
      if (!(n in mine)) { app.toast(_t('內建的片段不能刪')); return; }
      delete mine[n];
      storeFragments(mine);
      sel.querySelector(`option[value="${CSS.escape(n)}"]`)?.remove();
    };
    $('#d-frag-file').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.frg';
      input.onchange = async () => {
        for (const f of input.files) mine[f.name.replace(/\.frg$/i, '')] = decode55(new Uint8Array(await f.arrayBuffer())).trim();
        storeFragments(mine);
        $('#dialog').hidden = true;
        importFragment();
      };
      input.click();
    };
  }
  function saveFragment() {
    const tex = app.selectionTex55();
    if (!tex) { app.toast(_t('先選取要存成片段的內容')); return; }
    dialog(_t('存成片段'), _t('<p>片段名稱 <input id="d-name" size="24"></p>'), (d) => {
      const n = d.querySelector('#d-name').value.trim().replace(/[\\/]/g, '-');
      if (!n) { app.toast(_t('要有名稱')); return; }
      storeFragments({ ...userFragments(), [n]: tex });
      app.toast(_t('已存成片段「{0}」', n));
    });
  }
  // the Fragments toolbar: a list to insert from, and Save Fragment
  const fragSel = document.createElement('select');
  fragSel.id = 'frag-select';
  fragSel.title = _t('片段');
  function refreshFragmentList() {
    fragSel.replaceChildren(new Option(_t('片段…'), ''));
    for (const n of fragmentNames()) fragSel.append(new Option(n.includes('/') ? '　' + n.split('/').pop() : n, n));
  }
  refreshFragmentList();
  fragSel.onchange = () => {
    const n = fragSel.value;
    fragSel.value = '';
    if (n) insertLatex(allFragments()[n]);
  };

  // Insert > Formula (5.5's Exam Builder): an expression worked out when an exam is made,
  // written \FORMULA{expression}{value}{operation} (5.x's TCI macro)
  const FORMULA_OPS = [['evaluate', _t('計算')], ['numeric', _t('數值')], ['simplify', _t('化簡')], ['expand', _t('展開')], ['factor', _t('因式分解')]];
  function insertFormula() {
    const mv = currentMath();
    if (mv) mv.save();
    dialog(_t('考卷公式（產生考卷時才算）'), `<p>${_t('公式')} <input id="d-expr" size="30" placeholder="${_t('例如 a x^2 + b x + c')}"></p>
      <p>${_t('運算')} <select id="d-op">${FORMULA_OPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></p>`, (d) => {
      const e = d.querySelector('#d-expr').value.trim();
      if (!e) return;
      const latex = `\\FORMULA{${e}}{${e}}{${d.querySelector('#d-op').value}}`;
      if (mv) { mv.enter(false); mv.mf.insert(latex, { format: 'latex', selectionMode: 'after' }); mv.changed(); return; }
      view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.math_inline.create({ latex })).scrollIntoView());
      view.focus();
    });
  }
  // Tools > Exam Builder: the document on screen is the template; the exams open as a new document
  function examBuilder() {
    if (!isTemplate(view.state.doc)) {
      app.toast(_t('這份文件不是考卷範本：要有「Exam」（或 Quiz、Test）和「Question」這些節標題（見 說明 > 使用說明）'));
      return;
    }
    dialog(_t('考卷產生器'), `<p>${_t('份數')} <input id="d-n" size="4" value="1"></p>
      <p>${_t('亂數種子')} <input id="d-seed" size="10" placeholder="${_t('空白＝每次不同')}"></p>
      <p><label><input id="d-key" type="checkbox" checked> ${_t('附答案')}</label></p>`, async (d) => {
      const versions = Math.round(+d.querySelector('#d-n').value);
      if (!(versions >= 1 && versions <= 50)) { app.toast(_t('份數要是 1 到 50')); return; }
      const sv = d.querySelector('#d-seed').value.trim();
      status(isEngineLoaded() ? _t('產生考卷中…') : _t('產生考卷中…（第一次要載入計算引擎，要幾秒）'));
      try {
        const exams = await buildExams(view.state.doc, { versions, seed: sv === '' ? null : Math.round(+sv) || 0, answers: d.querySelector('#d-key').checked });
        app.newDocument(exams, { name: (app.meta().name || _t('考卷')) + _t('（產生的考卷）') });
        app.toast(_t('已產生 {0} 份考卷（新的文件，原本的範本還在 視窗 選單）', versions));
      } catch (err) { app.toast(_t('產生失敗：') + (err.message || err)); } finally { status(''); }
    });
  }

  // Tools > Document Manager: the document's files; package them, or open a package (.zip, 5.5's .rap)
  function documentManager() {
    const files = app.docFiles();
    const rows = files.length ? files.map((f) => `<tr><td>${escHtml(f.kind)}</td><td>${escHtml(f.path)}</td><td>${f.found ? _t('有') : _t('<b style="color:#c00000">找不到</b>')}</td></tr>`).join('')
      : _t('<tr><td colspan="3">（沒有圖片或子文件）</td></tr>');
    dialog(_t('文件管理'), `<p>${_t('文件：{0}{1}', escHtml(app.meta().name || _t('未命名')), app.path() ? _t('（') + escHtml(app.path()) + _t('）') : '')}</p>
      <table class="dm-files" style="font-size:.9em;border-collapse:collapse"><tr><th>${_t('種類')}</th><th>${_t('檔案')}</th><th>${_t('狀態')}</th></tr>${rows}</table>
      <p><button type="button" id="d-pack">${_t('打包成 .zip（文件＋圖片，給別人）')}</button></p>
      <p><button type="button" id="d-unpack">${_t('開啟打包檔（.zip、5.5 的 .rap）…')}</button></p>`, () => {});
    $('#d-pack').onclick = () => { $('#dialog').hidden = true; app.packDoc().catch((e) => app.toast(_t('打包失敗：') + (e.message || e))); };
    $('#d-unpack').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip,.rap';
      input.onchange = async () => {
        const f = input.files[0];
        if (!f) return;
        $('#dialog').hidden = true;
        app.openPackage(await f.arrayBuffer(), f.name);
      };
      input.click();
    };
  }
  // Tools > Automatic Substitution: in a formula, typing the keystrokes puts in the formula
  // (5.5: sum10 -> \sum_{n=1}^{10}); MathLive's own (alpha -> α ...) stay unless it is turned off
  function autoSubstitution() {
    const s = settings();
    const subs = { ...s.substitutions };
    const listHtml = () => Object.entries(subs).map(([k, v]) => `<option value="${escHtml(k)}">${escHtml(k)}　→　${escHtml(v)}</option>`).join('');
    dialog(_t('自動替換（在公式裡打字母就換成公式）'), `<p><label><input id="d-on" type="checkbox"${s.autoSub ? ' checked' : ''}> ${_t('開啟自動替換')}</label></p>
      <p><select id="d-list" size="8" style="min-width:24em">${listHtml()}</select></p>
      <p>${_t('按鍵')} <input id="d-keys" size="10" placeholder="sum10"> ${_t('換成')} <input id="d-latex" size="22" placeholder="\\sum_{n=1}^{10}"></p>
      <p><button type="button" id="d-sub-save">${_t('存這一個')}</button> <button type="button" id="d-sub-del">${_t('刪除選取的')}</button></p>`, (d) => {
      saveSettings({ ...settings(), autoSub: d.querySelector('#d-on').checked, substitutions: subs });
      app.toast(_t('自動替換已更新'));
    });
    const list = $('#d-list');
    list.onchange = () => { $('#d-keys').value = list.value; $('#d-latex').value = subs[list.value] || ''; };
    $('#d-sub-save').onclick = () => {
      const k = $('#d-keys').value.trim();
      const v = $('#d-latex').value.trim();
      if (!/^[A-Za-z0-9]+$/.test(k)) { app.toast(_t('按鍵只能用英文字母和數字（分大小寫）')); return; }
      if (!v) { app.toast(_t('要寫換成的公式（LaTeX）')); return; }
      subs[k] = v;
      list.innerHTML = listHtml();
      list.value = k;
    };
    $('#d-sub-del').onclick = () => { delete subs[list.value]; list.innerHTML = listHtml(); };
  }
  // Tools > User Setup: editing, the start-up document, files, formulas
  function userSetup() {
    const s = settings();
    const opt = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    dialog(_t('使用者設定（這台電腦）'), `<p><b>${_t('編輯')}</b>　<label><input id="d-auto" type="checkbox"${s.autoSub ? ' checked' : ''}> ${_t('公式裡自動替換')}</label></p>
      <p>${_t('矩陣預設')} <input id="d-mr" size="2" value="${s.matrix[0]}"> ${_t('列 ×')} <input id="d-mc" size="2" value="${s.matrix[1]}"> ${_t('行')}　
        ${_t('表格預設')} <input id="d-tr" size="2" value="${s.table[0]}"> ${_t('列 ×')} <input id="d-tc" size="2" value="${s.table[1]}"> ${_t('欄')}</p>
      <p><b>${_t('開始文件')}</b>　${_t('打開程式時')} <select id="d-start">${opt('last', _t('接著上次的文件'), s.startup)}${opt('blank', _t('空白文件'), s.startup)}${opt('demo', _t('試用說明'), s.startup)}</select></p>
      <p><b>${_t('檔案')}</b>　<label><input id="d-bak" type="checkbox"${s.backup ? ' checked' : ''}> ${_t('存檔蓋過舊檔前，舊檔留一份 .bak')}</label></p>
      <p><b>${_t('數學')}</b>　${_t('公式顏色')} <select id="d-color">${opt('#c00000', _t('紅（5.5 預設）'), s.mathColor)}${opt('#000000', _t('黑'), s.mathColor)}${opt('#1a4fa0', _t('藍'), s.mathColor)}</select></p>
      <p><b>${_t('介面語言')}</b>　<select id="d-lang">${opt('auto', _t('跟系統一樣'), s.lang)}${Object.entries(LANGUAGES).map(([v, l]) => opt(v, l, s.lang)).join('')}</select> ${_t('（重新開啟程式後生效）')}</p>`, (d) => {
      const n = (id) => Math.round(+d.querySelector(id).value);
      const sizes = [n('#d-mr'), n('#d-mc'), n('#d-tr'), n('#d-tc')];
      if (sizes.some((x) => !(x >= 1 && x <= 20))) { app.toast(_t('矩陣、表格的大小要是 1 到 20')); return; }
      saveSettings({ ...settings(), autoSub: d.querySelector('#d-auto').checked, matrix: sizes.slice(0, 2), table: sizes.slice(2),
        startup: d.querySelector('#d-start').value, backup: d.querySelector('#d-bak').checked, mathColor: d.querySelector('#d-color').value,
        lang: d.querySelector('#d-lang').value });
      if (!lastMatrix) [$('#matrix-rows').value, $('#matrix-cols').value] = sizes.slice(0, 2);
      app.toast(_t('使用者設定已存'));
    });
  }
  // Tools > Export Settings: formulas in exported HTML, the size of copied pictures
  function exportSettings() {
    const s = settings();
    const opt = (v, l, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`;
    dialog(_t('匯出設定'), `<p>${_t('匯出 HTML 的公式')} <select id="d-hm">${opt('mathml', _t('MathML（瀏覽器自己畫，不用網路）'), s.htmlMath)}${opt('mathjax', _t('LaTeX＋MathJax（開網頁時要網路）'), s.htmlMath)}</select></p>
      <p>${_t('複製成圖片的解析度')} <select id="d-scale">${[1, 2, 3, 4].map((k) => opt(k, _t('{0} 倍', k), s.pictureScale)).join('')}</select></p>`, (d) => {
      saveSettings({ ...settings(), htmlMath: d.querySelector('#d-hm').value, pictureScale: +d.querySelector('#d-scale').value });
      app.toast(_t('匯出設定已存'));
    });
  }

  // File > Open Location: a 5.x or .sci document on the web opens here (5.5: "address as .tex"
  // opens one without that ending); other addresses open in the browser
  function openLocation() {
    const urls = app.recentUrls();
    dialog(_t('開啟網址'), `<p>${_t('網址')} <input id="d-url" size="40" list="d-urls" placeholder="${_t('https://…/文件.tex')}"></p>
      <datalist id="d-urls">${urls.map((u) => `<option value="${escHtml(u)}">`).join('')}</datalist>
      <p style="font-size:.9em;color:#555">${_t('.tex、.sci 會在這裡開啟；其他網址用瀏覽器開。網址後面加「 as .tex」可以把沒有 .tex 結尾的檔當成文件開。')}</p>`,
    (d) => { const u = d.querySelector('#d-url').value.trim(); if (u) app.openUrl(u); });
  }
  // File > Page Setup: margins, header, footer and page number for File > Preview
  function pageSetupDialog() {
    const p = app.pageSetup();
    const opt = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    dialog(_t('版面設定（預覽、列印用；排版 PDF 不受影響）'), `<p>${_t('邊界（英吋） 上')} <input id="d-t" size="4" value="${p.top}"> ${_t('下')} <input id="d-b" size="4" value="${p.bottom}">
      ${_t('左')} <input id="d-l" size="4" value="${p.left}"> ${_t('右')} <input id="d-r" size="4" value="${p.right}"></p>
      <p>${_t('頁首')} <input id="d-head" size="30" value="${escHtml(p.header)}"></p><p>${_t('頁尾')} <input id="d-foot" size="30" value="${escHtml(p.footer)}"></p>
      <p>${_t('頁碼')} <select id="d-num">${[['none', _t('不顯示')], ['top-left', _t('頁首靠左')], ['top-center', _t('頁首置中')], ['top-right', _t('頁首靠右')], ['bottom-left', _t('頁尾靠左')],
        ['bottom-center', _t('頁尾置中')], ['bottom-right', _t('頁尾靠右')]].map(([v, l]) => opt(v, l, p.number)).join('')}</select>
      ${_t('樣式')} <select id="d-style">${[['decimal', '1, 2, 3'], ['lower-roman', 'i, ii, iii'], ['upper-roman', 'I, II, III'], ['lower-alpha', 'a, b, c'],
        ['upper-alpha', 'A, B, C']].map(([v, l]) => opt(v, l, p.style)).join('')}</select></p>`, (d) => {
      const m = ['#d-t', '#d-b', '#d-l', '#d-r'].map((id) => +d.querySelector(id).value);
      if (m.some((x) => !(x >= 0 && x < 4))) { app.toast(_t('邊界要是 0 到 4 英吋')); return; }
      app.setPageSetup({ top: m[0], bottom: m[1], left: m[2], right: m[3], header: d.querySelector('#d-head').value, footer: d.querySelector('#d-foot').value,
        number: d.querySelector('#d-num').value, style: d.querySelector('#d-style').value });
      app.toast(_t('版面設定已存（這台電腦的所有文件都用）'));
    });
  }

  // ---------- Compute menu (SymPy) ----------
  let computing = false;
  async function runCompute(op, params, mv0) {
    const mv = mv0 || currentMath();
    if (!mv) { app.toast(_t('把游標放在公式裡再計算')); return; }
    if (computing) return;
    computing = true;
    mv.save();
    status(isEngineLoaded() ? _t('計算中…') : _t('計算中…（第一次要載入計算引擎，要幾秒）'));
    try {
      const r = await compute(op, mv.latex, params);
      if (op === 'define') { status(''); app.toast(_t('已定義：之後的計算都會用它')); return; }
      if (r.kind === 'value') {
        mv.enter(false);
        mv.mf.insert(' = ' + r.latex, { format: 'latex', selectionMode: 'after' });
        mv.changed();
      } else {
        // the answer is text after the formula: "，解為：x=1、x=2" / "（成立）"
        mv.exit(1);
        const { tr } = view.state;
        const nodes = [];
        if (r.kind === 'boolean') nodes.push(schema.text(r.value ? _t('（成立）') : _t('（不成立）')));
        else if (r.kind === 'text') nodes.push(schema.text(r.text));
        else if (!r.solutions.length) nodes.push(schema.text(_t('，沒有解')));
        else {
          nodes.push(schema.text(r.label || _t('，解為：')));
          r.solutions.forEach((s, i) => {
            if (i) nodes.push(schema.text(_t('；')));
            nodes.push(schema.nodes.math_inline.create({ latex: s }));
          });
        }
        view.dispatch(tr.insert(view.state.selection.from, nodes).scrollIntoView());
      }
      status('');
    } catch (e) {
      app.toast(_t('計算失敗：') + e.message);
      status('');
    } finally { computing = false; }
  }
  const COMPUTE_ITEMS = [[_t('計算'), 'Ctrl+E', 'evaluate'], [_t('數值計算'), null, 'numeric'], [_t('化簡'), null, 'simplify'],
    [_t('因式分解'), null, 'factor'], [_t('展開'), null, 'expand'], '-', [_t('解方程（精確）'), null, 'solve'], [_t('檢查是否相等'), null, 'check']];
  const MATRIX_ITEMS = [[_t('行列式'), 'determinant'], [_t('反矩陣'), 'inverse'], [_t('轉置'), 'transpose'], [_t('特徵值'), 'eigenvalues'],
    [_t('秩'), 'rank'], [_t('列簡化（RREF）'), 'rref'], [_t('零空間'), 'nullspace'], [_t('跡'), 'trace'], [_t('特徵多項式'), 'charpoly'], [_t('伴隨矩陣'), 'adjugate']];
  // Insert > Unit Name: 5.x writes units as \unit{..} (upright, a thin space before)
  const UNITS = [[_t('公尺 m'), 'm'], [_t('公分 cm'), 'cm'], [_t('公里 km'), 'km'], [_t('秒 s'), 's'], [_t('分 min'), 'min'], [_t('小時 h'), 'h'], [_t('公克 g'), 'g'],
    [_t('公斤 kg'), 'kg'], [_t('牛頓 N'), 'N'], [_t('焦耳 J'), 'J'], [_t('瓦特 W'), 'W'], [_t('帕 Pa'), 'Pa'], [_t('赫茲 Hz'), 'Hz'], [_t('安培 A'), 'A'],
    [_t('伏特 V'), 'V'], [_t('歐姆 Ω'), '\\Omega'], [_t('克耳文 K'), 'K'], [_t('莫耳 mol'), 'mol'], [_t('公升 L'), 'L']];
  // operations that ask for more than the formula (5.5 asks in a dialog too)
  function askCompute(op, title, fields, read) {
    const mv = currentMath();
    if (!mv) { app.toast(_t('把游標放在公式裡再計算')); return; }
    dialog(title, fields, (d) => {
      const params = read(d);
      if (params) runCompute(op, params, mv);
    });
  }
  const field = (d, id) => d.querySelector(id).value.trim();
  const byParts = () => askCompute('byparts', _t('分部積分'), _t('<p>要微分的部分 u <input id="d-u" size="20" placeholder="例如 x"></p>'),
    (d) => (field(d, '#d-u') ? [field(d, '#d-u')] : null));
  const changeVariable = () => askCompute('changevar', _t('換變數'), _t('<p>代換 <input id="d-u" size="24" placeholder="u = x^2-1 或 x = \\sin u"></p>'),
    (d) => (field(d, '#d-u') ? [field(d, '#d-u')] : null));
  const approxIntegral = () => askCompute('approxint', _t('近似積分'), `<p>${_t('方法')} <select id="d-m">${[['left', _t('左端點')], ['midpoint', _t('中點')], ['right', _t('右端點')],
    ['trapezoid', _t('梯形')], ['simpson', 'Simpson']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></p>
    <p>${_t('區間數')} <input id="d-n" size="5" value="10"></p>`, (d) => [`'${d.querySelector('#d-m').value}'`, field(d, '#d-n') || '10']);
  const iterateDialog = () => askCompute('iterate', _t('迭代'), _t('<p>起始值 <input id="d-x0" size="8" value="1"></p><p>次數 <input id="d-n" size="5" value="5"></p>'),
    (d) => [field(d, '#d-x0') || '0', field(d, '#d-n') || '5']);
  // Vector Calculus works in the basis variables (x, y, z unless set otherwise), kept between sessions
  const BASIS_KEY = 'opensw-basis';
  const basis = () => (localStorage.getItem(BASIS_KEY) || 'x,y,z').split(',').map((v) => v.trim()).filter(Boolean);
  function setBasis() {
    dialog(_t('設定基底變數'), `<p>${_t('變數（用逗號分開）')} <input id="d-b" size="16" value="${escHtml(basis().join(', '))}"></p>`, (d) => {
      const v = field(d, '#d-b').split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z]$/.test(x));
      if (!v.length) { app.toast(_t('要寫成 x, y, z 這種單一字母')); return; }
      try { localStorage.setItem(BASIS_KEY, v.join(',')); } catch (e) { /* storage off */ }
      app.toast(_t('基底變數：') + v.join(', '));
    });
  }
  // the rest of 5.5's Compute menu: [submenu, [[item, op or action], ...]]
  const COMPUTE_SUBMENUS = [
    [_t('改寫'), [[_t('成指數'), 'rewrite_exp'], [_t('成正弦餘弦'), 'rewrite_sincos']]],
    [_t('解'), [[_t('精確'), 'solve'], [_t('數值'), 'numericsolve'], [_t('整數'), 'integersolve'], [_t('遞迴'), 'recursion']]],
    [_t('解常微分方程'), [[_t('精確'), 'ode']]],
    [_t('多項式'), [[_t('部分分式'), 'partialfractions'], [_t('依變數整理'), 'collect']]],
    [_t('微積分'), [[_t('微分'), 'differentiate'], [_t('不定積分'), 'integrate'], [_t('分部積分…'), byParts], [_t('換變數…'), changeVariable],
      [_t('近似積分…'), approxIntegral], [_t('畫近似積分圖…'), plotApproxIntegral], [_t('冪級數'), 'series'], [_t('求極值'), 'extrema'], [_t('迭代…'), iterateDialog], [_t('隱函數微分'), 'implicitdiff']]],
    [_t('向量微積分'), [[_t('梯度'), 'gradient'], [_t('散度'), 'divergence'], [_t('旋度'), 'curl'], [_t('拉普拉斯'), 'laplacian'], [_t('黑塞矩陣'), 'hessian'],
      [_t('雅可比矩陣'), 'jacobian'], [_t('朗斯基行列式'), 'wronskian'], [_t('位勢'), 'potential'], [_t('向量位勢'), 'vectorpotential'], [_t('設定基底變數…'), setBasis]]],
    [_t('單形法'), [[_t('最大化'), 'maximize'], [_t('最小化'), 'minimize'], [_t('可行性'), 'feasible'], [_t('標準化'), 'standardize'], [_t('對偶'), 'dual']]],
    [_t('統計'), [[_t('平均數'), 'mean'], [_t('中位數'), 'median'], [_t('變異數'), 'variance'], [_t('標準差'), 'stddev']]],
    [_t('轉換'), [[_t('拉氏轉換'), 'laplace'], [_t('反拉氏轉換'), 'inverselaplace'], [_t('傅立葉轉換'), 'fourier']]],
  ];
  const VECTOR_OPS = new Set(['gradient', 'divergence', 'curl', 'laplacian', 'hessian', 'jacobian', 'wronskian', 'potential', 'vectorpotential']);
  const computeAction = (op) => (typeof op === 'function' ? op : () => runCompute(op, VECTOR_OPS.has(op) ? basis() : undefined));
  // Compute > Definitions: x = 3 or f(x) = x^2 is used by every later computation
  async function definitions(op) {
    if (op === 'define') { await runCompute('define'); return; }
    try {
      const r = await compute(op, '0');
      if (op === 'cleardefs') app.toast(_t('定義都清除了'));
      else app.toast(r.solutions.length ? _t('目前的定義：') + r.solutions.join(_t('；')) : _t('還沒有定義'));
    } catch (e) { app.toast(e.message); }
  }
  app.compute = runCompute;

  // View: what the page shows besides the text (5.5's View menu); remembered between sessions
  const VIEW_TOGGLES = [['markers', _t('標記')], ['index', _t('索引項目')], ['helpers', _t('輔助線（表格格線、環境框）')], ['texfields', _t('TeX 欄位')]];
  const hidden = new Set(JSON.parse(localStorage.getItem('opensw-view-hidden') || '[]'));
  const isShown = (cls) => !hidden.has(cls);
  function applyView() { for (const [cls] of VIEW_TOGGLES) document.querySelector('#editor').classList.toggle('hide-' + cls, hidden.has(cls)); }
  function toggleView(cls) {
    if (hidden.has(cls)) hidden.delete(cls); else hidden.add(cls);
    try { localStorage.setItem('opensw-view-hidden', JSON.stringify([...hidden])); } catch (e) { /* storage off */ }
    applyView();
  }
  applyView();
  // Tools > Spelling: the browser's own checker underlines English words it does not know
  function toggleSpell() {
    const on = !view.dom.spellcheck;
    view.dom.spellcheck = on;
    try { localStorage.setItem('opensw-spell', on ? '1' : '0'); } catch (e) { /* storage off */ }
  }
  view.dom.spellcheck = localStorage.getItem('opensw-spell') === '1';
  // Tools > Computation Engine: SymPy (built in) or Mathematica (installed on this computer;
  // desktop app). Choosing loads the engine and shows its version.
  function engineInfo() {
    const s = settings();
    const radio = (v, label, off) => `<p><label><input type="radio" name="d-eng" value="${v}"${s.engine === v ? ' checked' : ''}${off ? ' disabled' : ''}> ${label}</label></p>`;
    dialog(_t('計算引擎'), `${radio('sympy', _t('SymPy（內建，在 Pyodide 裡跑，不用連網路）'))}
      ${radio('mathematica', _t('Mathematica（這台電腦要有裝') + (isDesktop ? _t('）') : _t('，桌面版才能用）')), !isDesktop)}
      <p>${_t('Mathematica 的核心 wolfram.exe（空白＝自動找）')}<br><input id="d-wk" size="46" value="${escHtml(s.wolframKernel)}"
        placeholder="${_t('例如 C:\\Program Files\\Wolfram Research\\Wolfram\\14.3\\wolfram.exe')}"></p>
      <p>${_t('選 Mathematica 時，計算選單、繪圖、考卷產生器都用它算。第一次計算要等幾秒載入。')}</p>`, async (d) => {
      const engine = d.querySelector('input[name="d-eng"]:checked')?.value || 'sympy';
      saveSettings({ ...settings(), engine, wolframKernel: d.querySelector('#d-wk').value.trim() });
      status(_t('載入計算引擎中…'));
      try {
        const r = await compute('version', '0');
        app.toast(_t('計算引擎：') + r.solutions.join(_t('、')));
      } catch (e) { app.toast(e.message); } finally { status(''); }
    });
  }
  // Compute > Check with Lean: Lean 4 proves the equation at the cursor (over the real
  // numbers) or says it could not. Needs Lean with Mathlib on the computer.
  const LEAN_KEY = 'opensw-lean-project';
  function leanSettings(then) {
    const now = localStorage.getItem(LEAN_KEY) || '';
    dialog(_t('Lean 設定'), `<p>${_t('Lean 專案資料夾（裝好 Mathlib 的 Lake 專案，裡面有 lakefile）：')}</p>
      <p><input id="d-lean" size="40" value="${escHtml(now)}" placeholder="${_t('例如 D:\\lean\\myproof')}"></p>`, (d) => {
      const v = d.querySelector('#d-lean').value.trim();
      try { localStorage.setItem(LEAN_KEY, v); } catch (e) { /* storage off */ }
      if (v && then) then();
    });
  }
  async function leanCheckFormula() {
    const mv = currentMath();
    if (!mv) { app.toast(_t('把游標放在等式裡再檢查')); return; }
    mv.save();
    let thm;
    try { thm = leanTheorem(await formulaJson(mv.latex), mv.latex); } catch (e) { app.toast(_t('不能用 Lean 檢查：') + e.message); return; }
    const shown = `<pre class="lean-code">${escHtml(thm.statement)}</pre>`;
    if (!isDesktop) { dialog(_t('用 Lean 檢查'), `<p>${_t('要在電腦版才能執行 Lean。要檢查的敘述：')}</p>${shown}`, () => {}); return; }
    const project = localStorage.getItem(LEAN_KEY);
    if (!project) { leanSettings(leanCheckFormula); return; }
    status(_t('Lean 檢查中…（第一次要載入 Mathlib，可能要幾分鐘）'));
    try {
      const [ok, out] = await leanCheck(project, thm.code);
      const v = leanVerdict(out, ok);
      dialog(_t('用 Lean 檢查'), `<p>${v.ok ? '✓ ' : ''}${escHtml(v.message)}</p><p>${_t('檢查的敘述（x、y 這些是任意實數）：')}</p>${shown}`, () => {});
    } catch (e) { app.toast(String(e.message || e)); } finally { status(''); }
  }
  // File > Document Info
  function documentInfo() {
    const doc = view.state.doc;
    const count = {};
    doc.descendants((n) => { count[n.type.name] = (count[n.type.name] || 0) + 1; });
    const words = (doc.textContent.match(/[A-Za-z0-9]+|[\u3400-\u9fff]/g) || []).length;
    const meta = app.meta();
    const rows = [[_t('檔名'), meta.name || _t('（未命名）')], [_t('來源'), meta.preamble55 ? _t('Scientific Word 5.x（.tex）') : app.path() && /\.sci$/i.test(app.path()) ? _t('Scientific Word 6（.sci）') : _t('新文件')],
      [_t('文件類別'), meta.documentclass || 'article'], [_t('字數（中文算字、英文算詞）'), words], [_t('段落'), count.paragraph || 0], [_t('節標題'), count.heading || 0],
      [_t('公式'), (count.math_inline || 0) + (count.math_display || 0)], [_t('表格'), count.table || 0], [_t('圖片和繪圖'), count.image || 0],
      [_t('註腳'), count.note || 0], [_t('TeX 欄位'), count.tex_field || 0]];
    dialog(_t('文件資訊'), '<table class="info">' + rows.map(([k, v]) => `<tr><td>${k}</td><td>${escHtml(String(v))}</td></tr>`).join('') + '</table>', () => {});
  }
  // Typeset > Options: the document class of a document not from 5.x
  function typesetOptions() {
    const meta = app.meta();
    if (meta.preamble55) { app.toast(_t('5.x 文件的類別在導言裡：用「排版 > 導言…」修改')); return; }
    const opt = (v) => `<option${(meta.documentclass || 'article') === v ? ' selected' : ''}>${v}</option>`;
    dialog(_t('排版選項'), `<p>${_t('文件類別')} <select id="d-class">${['article', 'report', 'book', 'amsart', 'amsbook'].map(opt).join('')}</select></p>`, (d) => {
      app.setMeta({ ...meta, documentclass: d.querySelector('#d-class').value });
      app.toast(_t('文件類別已改成 ') + d.querySelector('#d-class').value);
    });
  }

  // ---------- menus ----------
  // [label, shortcut, action] ; '-' = separator ; [label, null, [submenu...]]
  const sym = (list) => list.map(([s, l]) => [s, null, () => mathInsert(l)]);
  const MENUS = [
    [_t('檔案'), [
      [_t('新增'), null, app.newDoc], [_t('開啟…'), 'Ctrl+O', app.open], [_t('開啟網址…'), null, openLocation], [_t('關閉'), 'Ctrl+F4', app.closeDoc], [_t('儲存'), null, app.save], [_t('另存新檔…'), null, app.saveAs], [_t('另存成 .sci…'), null, app.saveAsSci], '-',
      [_t('匯入片段…'), null, importFragment], [_t('存成片段…'), null, saveFragment], [_t('匯入圖片…'), null, app.importPicture], '-',
      [_t('匯出 LaTeX…'), null, app.exportLatex], [_t('匯出 HTML…'), null, app.exportHtml], [_t('匯出 Word（.docx）…'), null, app.exportDocx], [_t('匯出給 AI（Markdown）…'), null, app.exportMd], '-',
      [_t('最近的檔案'), null, app.recent],
      [_t('範例'), null, app.samples.map(([id, label]) => [label, null, () => app.openSample(id)])], [_t('文件資訊'), null, documentInfo], '-',
      [_t('版面設定…'), null, pageSetupDialog], [_t('預覽（不排版，可列印）'), null, app.preview], [_t('排版 PDF'), 'Ctrl+P', app.pdf],
    ]],
    [_t('編輯'), [
      [_t('復原'), 'Ctrl+Z', () => run(undo)], [_t('重做'), null, () => run(redo)], '-',
      [_t('剪下'), 'Ctrl+X', () => document.execCommand('cut')], [_t('複製'), 'Ctrl+C', () => document.execCommand('copy')],
      [_t('貼上'), 'Ctrl+V', paste], [_t('選擇性貼上…'), null, pasteSpecial], [_t('複製成圖片'), null, copyAsPicture], '-', [_t('屬性（公式、表格、圖片）…'), 'Ctrl+F5', properties], '-',
      [_t('插入列…'), null, tables.insertRows], [_t('插入欄…'), null, tables.insertColumns],
      [_t('刪除列'), null, tables.deleteRow], [_t('刪除欄'), null, tables.deleteColumn], [_t('刪除表格'), null, tables.deleteTable],
      [_t('合併儲存格'), null, tables.mergeCells], [_t('分割儲存格'), null, tables.splitCell], '-',
      [_t('尋找…'), 'Ctrl+Q', () => openFind(false)], [_t('取代…'), 'Ctrl+W', () => openFind(true)], '-', [_t('全選'), 'Ctrl+A', () => run((s, d) => { d(s.tr.setSelection(new AllSelection(s.doc))); return true; })],
    ]],
    [_t('插入'), [
      [_t('數學'), 'Ctrl+M', toggleMath], '-',
      [_t('分數'), 'Ctrl+F', () => mathAction('fraction')], [_t('根號'), 'Ctrl+R', () => mathAction('radical')],
      [_t('上標'), 'Ctrl+H', () => mathAction('superscript')], [_t('下標'), 'Ctrl+L', () => mathAction('subscript')],
      [_t('獨立公式'), 'Ctrl+D', display], '-',
      [_t('運算子'), null, sym(OPERATORS)], [_t('括號'), null, BRACKETS.map(([s, a]) => [s, null, () => mathAction(a)])],
      [_t('矩陣…'), null, insertMatrix], [_t('表格…'), null, tables.insertTable], [_t('函數名稱'), null, sym(NAMES)], [_t('二項式'), null, () => mathAction('binomial')],
      [_t('裝飾'), null, DECORATIONS.map(([s, a]) => [s, null, () => mathAction(a)])], '-',
      [_t('標記…'), null, insertMarker], [_t('交叉引用…'), null, insertRef], [_t('表格標題'), null, tables.addCaption], [_t('註解…'), null, insertNote], '-',
      [_t('考卷公式…'), null, insertFormula], [_t('引用文獻…'), null, insertCitation], [_t('索引項目…'), null, insertIndexEntry], [_t('超連結…'), null, insertLink], [_t('TeX 欄位…'), null, insertTexField], [_t('HTML 欄位…'), null, insertHtmlField], '-',
      [_t('間距'), null, SPACES.map(([s, a]) => [s, null, () => (a.startsWith('\\') ? mathInsert(a) : space(a))])],
      [_t('單位名稱'), null, UNITS.map(([l, u]) => [l, null, () => mathInsert(`\\unit{${u}}`)])],
    ]],
    [_t('檢視'), [
      [_t('放大'), 'Ctrl+=', () => app.zoomStep(1)], [_t('縮小'), null, () => app.zoomStep(-1)], '-',
      ['200%', null, () => app.setZoom(2)], ['100%', null, () => app.setZoom(1)], '-',
      ...VIEW_TOGGLES.map(([cls, l]) => [() => (isShown(cls) ? '✓ ' : '　') + l, null, () => toggleView(cls)]), '-',
      [_t('工具列…'), null, () => toolbarsDialog()],
    ]],
    [_t('前往'), [[_t('上一節'), null, () => goSection(-1)], [_t('下一節'), null, () => goSection(1)], '-', [_t('標記…'), null, goMarker], [_t('連結'), null, followLink], '-',
      [_t('上一個位置'), null, () => goHistory(-1)], [_t('下一個位置'), null, () => goHistory(1)]]],
    [_t('標籤'), [
      ...FKEY_NAMES.map((k) => [() => tagName(fkeys()[k]), k, () => functionKey(fkeys()[k])]), '-',
      [_t('項目標籤'), null, ITEM_TAGS.slice(1).map(([v, l]) => [l, null, () => setItemTag(v)])],
      [_t('段落標籤'), null, BLOCK_TAGS.map(([v, l]) => [l, null, () => setBlockTag(v)])],
      [_t('文字標籤'), null, TEXT_TAGS.map(([v, l]) => [l, null, () => setTextTag(v)])], '-',
      [_t('功能鍵…'), null, functionKeysDialog], [_t('外觀…'), null, appearanceDialog],
    ]],
    [_t('計算'), [
      ...COMPUTE_ITEMS.map((it) => (it === '-' ? it : [it[0], it[1], () => runCompute(it[2])])), [_t('合併'), null, () => runCompute('combine')], '-',
      ...COMPUTE_SUBMENUS.map(([label, items]) => [label, null, items.map(([l, op]) => [l, null, computeAction(op)])]),
      [_t('矩陣'), null, MATRIX_ITEMS.map(([l, op]) => [l, null, () => runCompute(op)])], '-',
      [_t('定義'), null, [[_t('新定義'), null, () => definitions('define')], [_t('顯示定義'), null, () => definitions('showdefs')], [_t('清除定義'), null, () => definitions('cleardefs')]]],
      [_t('繪圖 2D'), null, [[_t('直角座標'), null, plot2d], [_t('極座標'), null, () => plotOther('polar')], [_t('隱函數'), null, () => plotOther('implicit')],
        [_t('參數式'), null, () => plotOther('param')], [_t('保角'), null, () => plotOther('conformal')], [_t('梯度'), null, () => plotOther('gradient')],
        [_t('向量場'), null, () => plotOther('vector')], [_t('不等式'), null, () => plotOther('inequality')], [_t('常微分方程'), null, () => plotOther('ode')]]],
      [_t('繪圖 3D'), null, [[_t('直角座標'), null, () => plotOther('surface')], [_t('柱座標'), null, () => plotOther('cylindrical')], [_t('球座標'), null, () => plotOther('spherical')],
        [_t('隱函數'), null, () => plotOther('implicit3')], [_t('管狀'), null, () => plotOther('tube')], [_t('梯度'), null, () => plotOther('gradient3')],
        [_t('向量場'), null, () => plotOther('vector3')]]], '-',
      [_t('用 Lean 檢查'), null, leanCheckFormula],
    ]],
    [_t('排版'), [[_t('排版 PDF'), 'Ctrl+P', app.pdf], [_t('導言…'), null, editPreamble], [_t('選項…'), null, typesetOptions], [_t('匯出 LaTeX…'), null, app.exportLatex]]],
    [_t('工具'), [
      [() => (view.dom.spellcheck ? '✓ ' : '　') + _t('拼字檢查（英文，瀏覽器內建）'), null, toggleSpell],
      [_t('考卷產生器…'), null, examBuilder], '-',
      [_t('文件管理…'), null, documentManager], [_t('自動替換…'), null, autoSubstitution], [_t('使用者設定…'), null, userSetup], [_t('匯出設定…'), null, exportSettings], '-',
      [_t('計算引擎…'), null, engineInfo], [_t('Lean 設定…'), null, () => leanSettings()],
    ]],
    [_t('視窗'), app.windows],
    [_t('說明'), [[_t('快捷鍵'), 'F1', app.help], [_t('完整說明文件'), null, () => app.newDocument(readLatex(MANUAL).doc, { name: _t('opensw 說明文件') })], [_t('使用說明'), null, () => { $('#guide').hidden = false; $('#guide-close').onclick = () => { $('#guide').hidden = true; view.focus(); }; }]]],
  ];

  const popup = $('#popup');
  let openMenu = null;
  function closePopups() { popup.hidden = true; popup.replaceChildren(); document.querySelectorAll('.menu-top.open').forEach((b) => b.classList.remove('open')); openMenu = null; }
  function buildMenu(items) {
    const box = document.createElement('div');
    box.className = 'menu-list';
    for (const it of items) {
      if (it === '-') { box.append(Object.assign(document.createElement('hr'))); continue; }
      const [lab, key, act] = it;
      const label = typeof lab === 'function' ? lab() : lab; // a label that shows a state (✓)
      const b = document.createElement('button');
      b.innerHTML = `<span>${label}</span><kbd>${key || (Array.isArray(act) ? '▸' : '')}</kbd>`;
      if (!act) { b.disabled = true; b.title = _t('只有桌面版有'); }
      noFocus(b);
      if (Array.isArray(act)) {
        const sub = buildMenu(act);
        sub.classList.add('submenu');
        b.classList.add('has-sub');
        b.append(sub);
        b.onclick = (e) => { e.stopPropagation(); b.classList.toggle('sub-open'); };
      } else if (act) b.onclick = (e) => { e.stopPropagation(); closePopups(); act(); };
      box.append(b);
    }
    return box;
  }
  function showPopup(anchor, content) {
    popup.replaceChildren(content);
    popup.hidden = false;
    const r = anchor.getBoundingClientRect();
    popup.style.left = Math.max(0, Math.min(r.left, innerWidth - popup.offsetWidth - 4)) + 'px';
    popup.style.top = r.bottom + 'px';
  }
  for (const [name, items] of MENUS) {
    const b = document.createElement('button');
    b.className = 'menu-top';
    b.textContent = name;
    noFocus(b);
    b.onclick = (e) => {
      e.stopPropagation();
      if (openMenu === name) { closePopups(); return; }
      closePopups();
      if (name === _t('視窗')) app.refreshWindows(); // the open documents right now
      b.classList.add('open');
      openMenu = name;
      showPopup(b, buildMenu(items));
    };
    b.onmouseenter = () => { if (openMenu && openMenu !== name) b.click(); };
    $('#menubar').append(b);
  }
  document.addEventListener('click', (e) => { if (!popup.contains(e.target)) closePopups(); });
  popup.addEventListener('click', (e) => e.stopPropagation());

  // ---------- toolbars ----------
  function noFocus(el) { el.addEventListener('mousedown', (e) => e.preventDefault()); } // keep the cursor where it is
  function tbtn(icon, tip, act, id) {
    const b = document.createElement('button');
    b.className = 'tb';
    if (id) b.id = id;
    b.title = tip;
    if (ICONS[icon]) b.innerHTML = ICONS[icon]; else b.textContent = icon;
    if (!ICONS[icon]) b.classList.add('tb-text');
    noFocus(b);
    b.onclick = (e) => { e.stopPropagation(); closePopups(); act(b); };
    b.onmouseenter = () => status(tip);
    b.onmouseleave = () => status('');
    return b;
  }
  function grid(list, cls, act) {
    const g = document.createElement('div');
    g.className = 'sym-grid ' + (cls || '');
    for (const [s, l] of list) {
      const b = document.createElement('button');
      b.textContent = s;
      b.title = l;
      noFocus(b);
      b.onclick = () => { closePopups(); act(l); };
      g.append(b);
    }
    return g;
  }
  const panel = (list, cls, act = mathInsert) => (b) => showPopup(b, grid(list, cls, act));
  const zoomSel = document.createElement('select');
  zoomSel.id = 'zoom-select';
  zoomSel.title = _t('縮放');
  for (const z of app.ZOOMS) zoomSel.append(new Option(Math.round(z * 100) + '%', z));
  zoomSel.onchange = () => { app.setZoom(+zoomSel.value); view.focus(); };

  const GROUPS = [
    [ // Standard
      tbtn('new', _t('新增文件'), app.newDoc), tbtn('open', _t('開啟 .sci 或 5.x 的 .tex 檔（Ctrl+O）'), app.open, 'btn-open'),
      tbtn('save', _t('儲存（5.x 的 .tex）'), app.save, 'btn-save'),
      tbtn('print', _t('排版並開啟 PDF（Ctrl+P，桌面版）'), app.pdf || (() => app.toast(_t('桌面版才能排版 PDF'))), 'btn-pdf'),
      tbtn('exporttex', _t('匯出 LaTeX'), app.exportLatex, 'btn-latex'), tbtn('AI', _t('匯出給 AI 讀（Markdown）'), app.exportMd, 'btn-md'),
    ],
    [ // Typeset
      tbtn('PDF', _t('排版 PDF（Ctrl+P，桌面版）'), app.pdf || (() => app.toast(_t('桌面版才能排版 PDF')))), tbtn(_t('預覽'), _t('預覽（不排版，可列印）'), app.preview),
      tbtn(_t('導言'), _t('導言（排版用的 LaTeX 前言）'), editPreamble), tbtn(_t('選項'), _t('排版選項與套件'), typesetOptions),
    ],
    [
      tbtn('cut', _t('剪下（Ctrl+X）'), () => document.execCommand('cut')), tbtn('copy', _t('複製（Ctrl+C）'), () => document.execCommand('copy')),
      tbtn('paste', _t('貼上（Ctrl+V）'), paste),
      tbtn('undo', _t('復原（Ctrl+Z）'), () => run(undo), 'btn-undo'), tbtn('redo', _t('重做'), () => run(redo), 'btn-redo'),
      tbtn('math_mathtext', _t('數學／文字切換（Ctrl+M 或 Ctrl+T）'), toggleMath, 'btn-math'), zoomSel,
    ],
    [ // Math Templates
      tbtn('math_fraction', _t('分數（Ctrl+F）'), () => mathAction('fraction')), tbtn('math_radical', _t('根號（Ctrl+R）'), () => mathAction('radical')),
      tbtn('math_superscript', _t('上標（Ctrl+H）'), () => mathAction('superscript')), tbtn('math_subscript', _t('下標（Ctrl+L）'), () => mathAction('subscript')),
      tbtn('math_parentheses', _t('圓括號（Ctrl+9）'), () => mathAction('paren')), tbtn('math_squarebrackets', _t('方括號（Ctrl+[）'), () => mathAction('bracket')),
      tbtn('math_sum', _t('總和（Ctrl+7）'), () => mathAction('sum')), tbtn('math_integral', _t('積分（Ctrl+I）'), () => mathAction('integral')),
    ],
    [ // Math Objects
      tbtn('display', _t('獨立公式（Ctrl+D）'), display, 'btn-display'), tbtn('math_bigop', _t('運算子'), panel(OPERATORS, 'big')),
      tbtn('math_brackets', _t('括號'), panel(BRACKETS, 'wide', mathAction)), tbtn('math_matrix', _t('矩陣'), insertMatrix),
      tbtn('math_mathname', _t('函數名稱'), panel(NAMES, 'names')), tbtn('math_binomial', _t('二項式'), () => mathAction('binomial')),
      tbtn('math_decoration', _t('裝飾'), panel(DECORATIONS, '', mathAction)),
    ],
    [ // Compute
      tbtn('=', _t('計算（Ctrl+E）'), () => runCompute('evaluate'), 'btn-evaluate'), tbtn('≐', _t('數值計算'), () => runCompute('numeric')),
      tbtn(_t('化簡'), _t('化簡'), () => runCompute('simplify')), tbtn(_t('展開'), _t('展開'), () => runCompute('expand')),
      tbtn(_t('因式'), _t('因式分解'), () => runCompute('factor')), tbtn(_t('解'), _t('解方程（精確）'), () => runCompute('solve')),
    ],
    CACHE.map(([s, l]) => tbtn(s, `${s}　${l}`, () => mathInsert(l))), // Symbol Cache
    Object.entries(PANELS).map(([name, list]) => tbtn(name, _t('符號面板 ') + name, panel(list))), // Symbol Panels
    [fragSel, tbtn('save_fragment', _t('存成片段（選取的內容）'), saveFragment, 'btn-save-frag')], // Fragments
    [ // Editing
      tbtn('N', _t('一般文字（F4）'), () => setTextTag('')),
      tbtn('bold', _t('粗體（F5）'), () => run(toggleMark(schema.marks.bold)), 'btn-bold'),
      tbtn('italic', _t('強調（F6）'), () => run(toggleMark(schema.marks.italic)), 'btn-italic'),
      tbtn('?', _t('快捷鍵（F1）'), app.help, 'btn-help'),
    ],
  ];
  const GROUP_NAMES = [_t('標準'), _t('排版'), _t('編輯'), _t('數學樣板'), _t('數學物件'), _t('計算'), _t('符號快取'), _t('符號面板'), _t('片段'), _t('文字樣式')];
  // 5.5's other toolbars, docked on the right one above another
  const RIGHT_GROUPS = [
    [_t('排版物件'), [tbtn('[1]', _t('引用文獻'), insertCitation), tbtn('→#', _t('交叉引用'), insertRef), tbtn(_t('註'), _t('註解（註腳、邊註）'), insertNote),
      tbtn(_t('索引'), _t('索引項目'), insertIndexEntry), tbtn('TeX', _t('TeX 欄位'), insertTexField)]],
    [_t('前往'), [tbtn('⇑', _t('上一節'), () => goSection(-1)), tbtn('⇓', _t('下一節'), () => goSection(1)), tbtn(_t('標記'), _t('前往標記'), goMarker)]],
    [_t('歷史'), [tbtn('◀', _t('上一個位置'), () => goHistory(-1)), tbtn('▶', _t('下一個位置'), () => goHistory(1))]],
    [_t('連結'), [tbtn('URL', _t('插入超連結'), insertLink), tbtn('↗', _t('前往連結（游標在連結上）'), followLink)]],
    [_t('欄位'), [tbtn('HTML', _t('HTML 欄位'), insertHtmlField), tbtn('F( )', _t('考卷公式'), insertFormula)]],
    [_t('考卷'), [tbtn(_t('卷'), _t('考卷產生器（目前文件當範本）'), examBuilder)]],
  ];
  // View > Toolbars: the ones hidden are remembered on this computer
  const TB_KEY = 'opensw-toolbars-hidden';
  const hiddenBars = new Set((() => { try { return JSON.parse(localStorage.getItem(TB_KEY) || '[]'); } catch (e) { return []; } })());
  const groupEls = new Map();
  const addGroup = (name, buttons, where) => {
    const div = document.createElement('div');
    div.className = 'tb-group';
    div.dataset.name = name;
    div.title = name;
    div.append(...buttons);
    div.hidden = hiddenBars.has(name);
    $(where).append(div);
    groupEls.set(name, div);
  };
  GROUPS.forEach((g, i) => addGroup(GROUP_NAMES[i], g, '#toolbar'));
  for (const [name, buttons] of RIGHT_GROUPS) addGroup(name, buttons, '#toolbar-right');
  const rightColumn = () => { $('#toolbar-right').hidden = RIGHT_GROUPS.every(([n]) => hiddenBars.has(n)); };
  rightColumn();
  function toolbarsDialog() {
    const box = (name) => `<label style="display:inline-block;min-width:7em"><input type="checkbox" data-bar="${escHtml(name)}"${hiddenBars.has(name) ? '' : ' checked'}> ${escHtml(name)}</label>`;
    dialog(_t('工具列'), `<p>${_t('上面：')}<br>${GROUP_NAMES.map(box).join(' ')}</p><p>${_t('右邊：')}<br>${RIGHT_GROUPS.map(([n]) => box(n)).join(' ')}</p>
      <p><button type="button" id="d-tb-reset">${_t('重設（全部顯示）')}</button></p>`, (d) => {
      hiddenBars.clear();
      for (const c of d.querySelectorAll('input[data-bar]')) if (!c.checked) hiddenBars.add(c.dataset.bar);
      try { localStorage.setItem(TB_KEY, JSON.stringify([...hiddenBars])); } catch (e) { /* storage off */ }
      for (const [name, el] of groupEls) el.hidden = hiddenBars.has(name);
      rightColumn();
    });
    $('#d-tb-reset').onclick = () => { for (const c of $('#dialog-body').querySelectorAll('input[data-bar]')) c.checked = true; };
  }

  // ---------- tag bar ----------
  const fill = (sel, list) => { for (const [v, l] of list) sel.append(new Option(l, v)); };
  fill($('#item-tag'), ITEM_TAGS);
  fill($('#block-type'), BLOCK_TAGS);
  fill($('#text-tag'), TEXT_TAGS);
  $('#item-tag').onchange = (e) => { setItemTag(e.target.value); refresh(); };
  $('#block-type').onchange = (e) => { setBlockTag(e.target.value); refresh(); };
  $('#text-tag').onchange = (e) => { setTextTag(e.target.value); refresh(); };
  noFocus($('#btn-untag'));
  $('#btn-untag').onclick = () => { untag(); refresh(); };

  // ---------- status bar ----------
  function status(msg) { $('#status-text').textContent = msg || pendingMsg || _t('要說明請按 F1'); }
  function refresh() {
    const { $from, from, to, empty } = view.state.selection;
    const p = $from.parent;
    let block = 'paragraph';
    if (p.type.name === 'title') block = 'title';
    else if (p.type.name === 'heading') block = 'h' + p.attrs.level;
    $('#block-type').value = BLOCK_TAGS.some(([v]) => v === block) ? block : 'paragraph';
    let item = '';
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d).type.name;
      if (n === 'env') { item = $from.node(d).attrs.kind; break; }
      if (n === 'bullet_list') { item = 'bullet'; break; }
      if (n === 'ordered_list') { item = 'numbered'; break; }
    }
    $('#item-tag').value = ITEM_TAGS.some(([v]) => v === item) ? item : '';
    const marks = empty ? (view.state.storedMarks || $from.marks()) : [];
    let text = '';
    const inRange = empty ? marks : (() => { const l = []; view.state.doc.nodesBetween(from, to, (n) => { l.push(...n.marks); }); return l; })();
    for (const m of MARKS) {
      const hit = inRange.find((x) => x.type.name === m);
      if (hit) { text = tagOf(hit); break; }
    }
    $('#text-tag').value = text;
    refreshMode();
  }
  function refreshMode() {
    const math = !!currentMath();
    $('#status-mode').textContent = math ? _t('數學') : _t('文字');
    $('#status-mode').classList.toggle('math', math);
  }
  document.addEventListener('focusin', refreshMode);
  document.addEventListener('focusout', () => setTimeout(refreshMode));

  // ---------- 5.5 keyboard shortcuts ----------
  // pending: the next key finishes a two-key shortcut
  //   'greek' / 'symbol' (Ctrl+G / Ctrl+S), 'accent:<name>' (accent key in text), 'dash' (Ctrl+- in text)
  let pending = null;
  let pendingMsg = '';
  function setPending(p) {
    pending = p;
    pendingMsg = p === 'greek' ? _t('Ctrl+G：再按一個字母輸入希臘字母（a→α、b→β、y→θ…）')
      : p === 'symbol' ? _t('Ctrl+S：再按一個鍵輸入符號（I→∞、e→∈、=→≠、<→≤…）')
        : p?.startsWith('accent:') ? _t('再按一個字母加上重音') : p === 'dash' ? _t('再按一次 Ctrl+- 插入可斷字的連字號') : '';
    status('');
  }
  function finishPending(e) {
    const p = pending;
    setPending(null);
    if (p === 'greek' || p === 'symbol') {
      const v = (p === 'greek' ? GREEK : SYMBOL_PREFIX)[e.key];
      if (!v) return;
      if (v === 'matrix') insertMatrix();
      else if (v === 'lastmatrix') lastMatrix ? insertMatrixOf(lastMatrix) : insertMatrix();
      else if (v.startsWith('\\')) mathInsert(v); else mathAction(v);
    } else if (p === 'dash') {
      if ((e.ctrlKey || e.metaKey) && e.key === '-') view.dispatch(view.state.tr.insertText('\u00ad'));
    } else if (p.startsWith('accent:') && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      view.dispatch(view.state.tr.insertText((e.key + COMBINING[p.slice(7)]).normalize('NFC')));
    }
  }
  // a function key's tag: 'untag', 'menu', 'item:theorem', 'block:h2', 'text:bold' ...
  function functionKey(f) {
    const [kind, v] = f.split(':');
    if (f === 'untag') untag();
    else if (f === 'menu') document.querySelector('.menu-top').click();
    else if (kind === 'item') setItemTag(v);
    else if (kind === 'text') setTextTag(f.slice(5)); // 'text:size:large' -> 'size:large'
    else setBlockTag(v);
    refresh();
  }
  const isField = (t) => t instanceof HTMLElement && t.matches('input, textarea, select');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); app.help(); return; }
    if (e.key === 'Escape') closePopups();
    if (isField(e.target)) return; // typing in a dialog or the find bar
    if (pending) {
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      finishPending(e);
      return;
    }
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    if (plain && fkeys()[e.key]) { e.preventDefault(); e.stopPropagation(); functionKey(fkeys()[e.key]); return; }
    const mv = currentMath();
    if (mv && e.key === ' ' && e.shiftKey && !e.ctrlKey && !e.metaKey) { // required space
      e.preventDefault(); e.stopPropagation(); mathInsert('\\ '); return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === '=' || e.key === '+') { take(); app.zoomStep(1); return; } // not in 5.5, no conflict
    const a = actionFor(e);
    if (!a) return;
    take();
    if (a === 'open') app.open();
    else if (a === 'print') app.pdf ? app.pdf() : app.toast(_t('桌面版才能排版 PDF'));
    else if (a === 'close') app.closeDoc();
    else if (a === 'find' || a === 'replace') openFind(a === 'replace');
    else if (a === 'negate') negate();
    else if (a === 'properties') properties();
    else if (a === 'evaluate') runCompute('evaluate');
    else if (a === 'toggle') toggleMath();
    else if (a === 'display') display();
    else if (a === 'greek' || a === 'symbol') setPending(a);
    else if (a in TEXT_SPACE) space(a);
    else if (!mv && a === 'vec') setPending('dash');
    else if (!mv && COMBINING[a]) setPending('accent:' + a);
    else mathAction(a);
  }, true);

  // ---------- help ----------
  $('#help').innerHTML = _t('<b>Scientific Word 5.5 的快捷鍵</b>（Mac 上 Ctrl 換成 Cmd）<table>')
    + HELP_ROWS.map(([a, b]) => `<tr><td>${a}</td><td>${b.replace(/</g, '&lt;')}</td></tr>`).join('')
    + _t('</table>公式裡也可以直接打：^ 上標、_ 下標、/ 分數、\\alpha 希臘字母、sqrt 根號；方向鍵走到公式邊緣會回到文字。');

  return { refresh };
}
