// The Scientific Word 5.5 look: menu bar, toolbars with the 6.1 open-source icons,
// symbol cache and symbol panels, the tag bar at the bottom, the status bar, and
// 5.5's keyboard shortcuts.
import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { undo, redo } from 'prosemirror-history';
import { Selection, AllSelection, TextSelection, NodeSelection } from 'prosemirror-state';
import { toPx } from './graphics.js';
import { parsePlot, drawable, plotSpecial } from './plots.js';
import { stripComments, readLatex } from './tex55.js';
import { Slice } from 'prosemirror-model';
import { schema } from './schema.js';
import { insertMath } from './mathview.js';
import { compute, isEngineLoaded, formulaJson } from './compute.js';
import { leanTheorem, leanVerdict } from './lean.js';
import { isDesktop, leanCheck } from './desktop.js';
import { ICONS } from './icons.js';
import { setupTables } from './tables55.js';
import { GREEK, SYMBOL_PREFIX, TEMPLATES, actionFor, HELP_ROWS, FKEYS, COMBINING, NEGATE, NEGATE_TEXT } from './keys55.js';


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
const SPACES = [['細空格', 'thinspace'], ['粗空格', 'thickspace'], ['不斷行空格', 'nbsp'], ['1em 空格', '\\quad'], ['2em 空格', '\\qquad']];

// ---------- tags (bottom bar) ----------
const ITEM_TAGS = [['', '（項目標籤）'], ['axiom', '公理'], ['bullet', '項目清單'], ['case', '情形'], ['claim', '斷言'],
  ['conclusion', '結論'], ['condition', '條件'], ['conjecture', '猜想'], ['corollary', '推論'], ['criterion', '準則'],
  ['definition', '定義'], ['example', '例'], ['exercise', '習題'], ['lemma', '引理'], ['notation', '記號'],
  ['numbered', '編號清單'], ['problem', '問題'], ['proof', '證明'], ['proposition', '命題'], ['remark', '注'],
  ['solution', '解'], ['summary', '摘要'], ['theorem', '定理']];
const BLOCK_TAGS = [['paragraph', '本文'], ['title', '文件標題'], ['h0', '部'], ['h1', '章'], ['h2', '節'], ['h3', '小節'], ['h4', '小小節']];
// text tags; "size:large" is the size mark with that size
const TEXT_TAGS = [['', '（一般）'], ['bold', '粗體'], ['italic', '強調'], ['code', '打字機'], ['smallcaps', '小型大寫'],
  ['sans', '無襯線'], ['underline', '底線'], ['size:tiny', '極小'], ['size:scriptsize', '很小'], ['size:footnotesize', '註腳大小'],
  ['size:small', '小'], ['size:large', '大'], ['size:Large', '較大'], ['size:LARGE', '更大'], ['size:huge', '巨大'], ['size:Huge', '最巨大']];

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
    mv.save();
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
      if (!NEGATE[left]) { app.toast('左邊的符號沒有否定的寫法'); return; }
      mv.mf.executeCommand('deleteBackward');
      mv.mf.insert(NEGATE[left], { format: 'latex', selectionMode: 'after' });
      mv.save();
      return;
    }
    const { $head, empty } = view.state.selection;
    const ch = empty && $head.parent.textBetween(Math.max(0, $head.parentOffset - 1), $head.parentOffset);
    if (!ch || !NEGATE_TEXT[ch]) { app.toast('左邊的符號沒有否定的寫法'); return; }
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
    if (!mv) { app.toast('先把游標放在公式或表格裡，或選取圖片，再按 Ctrl+F5'); return; }
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
    dialog('圖片屬性', `<p>檔案：${escHtml(a.path || '（沒有檔名）')}${a.src ? '' : '（找不到檔案）'}</p>
      <p>寬 <input id="d-w" size="8" value="${escHtml(inches(a.width, a.texw))}"> 高 <input id="d-h" size="8" value="${escHtml(inches(a.height, a.texh))}">
        <label><input id="d-keep" type="checkbox" checked> 保持比例</label></p>
      <p>位置 <select id="d-place">${opt('inline', '在行內', a.place)}${opt('display', '單獨一行', a.place)}${opt('float', '浮動（有標題）', a.place)}</select></p>
      <p>標題 <input id="d-cap" size="30" value="${escHtml(a.caption || '')}"></p>
      <p>標記 <input id="d-key" size="18" value="${escHtml(a.label || '')}"></p>`, (d) => {
      const w = d.querySelector('#d-w').value.trim();
      let h = d.querySelector('#d-h').value.trim();
      const wpx = toPx(w);
      let hpx = toPx(h);
      if (!wpx || !hpx) { app.toast('寬和高要寫成 3in、5cm、100pt 這種長度'); return; }
      // keep the shape: a new width sets the height
      if (d.querySelector('#d-keep').checked && w !== inches(a.width, a.texw) && h === inches(a.height, a.texh) && a.width && a.height) {
        hpx = Math.round(wpx * a.height / a.width * 10) / 10;
        h = (hpx / 96).toFixed(4) + 'in';
      }
      const key = d.querySelector('#d-key').value.trim() || null;
      if (key && key !== a.label && markerKeys().includes(key)) { app.toast(`已經有標記「${key}」`); return; }
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
    dialog('標記', '<p>名稱 <input id="d-key" size="18" placeholder="例如 thm:main"></p>', (d) => {
      const key = d.querySelector('#d-key').value.trim();
      if (!key) return;
      if (markerKeys().includes(key)) { app.toast(`已經有標記「${key}」`); return; }
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
    dialog('引用文獻', `<p>文獻代號 <input id="d-keys" size="22" list="d-bibkeys" placeholder="多個用逗號分開">
      <datalist id="d-bibkeys">${keys.map((k) => `<option value="${escHtml(k)}">`).join('')}</datalist></p>
      <p>附註 <input id="d-note" size="16" placeholder="例如 p.~5（可空白）"></p>`, (d) => {
      const k = d.querySelector('#d-keys').value.split(',').map((x) => x.trim()).filter(Boolean).join(',');
      if (!k) return;
      insertInline(schema.nodes.cite.create({ keys: k, note: d.querySelector('#d-note').value.trim() || null }));
    });
  }
  // Insert > Index Entry
  function insertIndexEntry() {
    const sel = view.state.selection;
    const picked = sel.empty ? '' : view.state.doc.textBetween(sel.from, sel.to, ' ');
    dialog('索引項目', `<p>項目 <input id="d-entry" size="24" value="${escHtml(picked)}" placeholder="主項!子項"></p>`, (d) => {
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
    dialog('超連結', `<p>文字 <input id="d-text" size="24" value="${escHtml(picked)}"></p>
      <p>連到 <input id="d-href" size="28" list="d-markers" placeholder="https://… 或標記名稱">
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
    dialog('註解', `<p>種類 <select id="d-kind"><option value="footnote">註腳</option><option value="margin">邊註</option></select></p>`, (d) => {
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
    if (!keys.length) { app.toast('文件裡還沒有標記，先用「插入 > 標記」'); return; }
    const mv = currentMath();
    dialog('交叉引用', `<p>標記 <select id="d-key">${keys.map((k) => `<option>${escHtml(k)}</option>`).join('')}</select></p>
      <p>顯示 <select id="d-kind"><option value="ref">編號</option><option value="eqref">（編號）</option><option value="pageref">頁碼</option></select></p>`, (d) => {
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
    if (!all.length) { app.toast('找不到'); return false; }
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
    app.toast(`取代了 ${all.length} 處`);
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
  function goSection(dir) {
    const here = view.state.selection.from;
    const heads = [];
    view.state.doc.descendants((n, pos) => { if (n.type.name === 'heading' || n.type.name === 'title') heads.push(pos); });
    const target = dir > 0 ? heads.find((p) => p > here) : heads.reverse().find((p) => p + 1 < here);
    if (target == null) return;
    const tr = view.state.tr.setSelection(Selection.near(view.state.doc.resolve(target + 1)));
    view.dispatch(tr.scrollIntoView());
    view.focus();
    view.domAtPos(target + 1).node?.scrollIntoView?.({ block: 'start' });
  }
  // Go > Marker: the place a marker names (a \label in text, a formula, a picture or a caption)
  function goMarker() {
    const keys = markerKeys();
    if (!keys.length) { app.toast('文件裡沒有標記'); return; }
    dialog('前往標記', `<p>標記 <select id="d-key">${keys.map((k) => `<option>${escHtml(k)}</option>`).join('')}</select></p>`, (d) => {
      const key = d.querySelector('#d-key').value;
      let at = null;
      view.state.doc.descendants((n, pos) => {
        if (at != null) return false;
        if ((n.type.name === 'marker' && n.attrs.key === key) || (n.type.name === 'image' && n.attrs.label === key)
          || (n.type.name === 'math_display' && (n.attrs.rows || [n.attrs]).some((r) => r.label === key))) at = pos;
        return true;
      });
      if (at == null) return;
      view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(at))).scrollIntoView());
      view.focus();
      view.nodeDOM(at)?.scrollIntoView?.({ block: 'center' });
    });
  }
  // Insert > TeX Field: LaTeX passed through as written
  function insertTexField() {
    dialog('TeX 欄位', '<p><textarea id="d-tex" rows="4" cols="40" placeholder="例如 \\vspace{1cm}"></textarea></p>', (d) => {
      const tex = d.querySelector('#d-tex').value.trim();
      if (tex) insertInline(schema.nodes.tex_field.create({ tex }));
    });
    $('#dialog-body').onkeydown = null; // Enter makes a new line in the TeX
  }
  // Typeset > Preamble: the LaTeX before \begin{document}
  function editPreamble() {
    const meta = app.meta();
    const is55 = !!meta.preamble55;
    const text = is55 ? (meta.preamble55raw ?? meta.preamble55) : (meta.preambleTeX || '');
    dialog('導言', `<p>${is55 ? 'Scientific Word 5 文件的導言（\\documentclass 到 \\begin{document} 之前）' : '加在 \\begin{document} 之前的 LaTeX（例如 \\newtheorem、\\usepackage）'}</p>
      <p><textarea id="d-pre" rows="16" cols="70" spellcheck="false"></textarea></p>`, (d) => {
      const v = d.querySelector('#d-pre').value;
      if (is55) app.setMeta({ ...meta, preamble55raw: v, preamble55: stripComments(v).replace(/\n{3,}/g, '\n\n').trim() });
      else app.setMeta({ ...meta, preambleTeX: v });
      app.toast('導言已更新');
    });
    $('#d-pre').value = text;
    $('#dialog-body').onkeydown = null;
  }
  // Properties of a 5.x-style plot: the window, and each function with its colour
  function plotProperties(pos, node) {
    const a = node.attrs;
    const plot = parsePlot(a.frame.slice(a.frame.indexOf('\\special')));
    if (!drawable(plot)) { app.toast('這種繪圖（3D、參數式…）還不能在這裡改'); return; }
    const [x0, x1] = plot.view.x || plot.range || [-5, 5];
    const [y0, y1] = plot.view.y || ['', ''];
    const colors = [['#ff0000', '紅'], ['#0000ff', '藍'], ['#008000', '綠'], ['#000000', '黑'], ['#ff00ff', '洋紅'], ['#808080', '灰']];
    const colorSel = (k, cur) => `<select id="d-c${k}">${colors.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const rows = plot.curves.map((c, k) => `<p>函數 ${k + 1} <input id="d-f${k}" size="26" value="${escHtml(c.latex)}"> ${colorSel(k, c.color)}</p>`).join('');
    dialog('繪圖屬性', `${rows}<p>新增函數 <input id="d-fnew" size="26" placeholder="例如 \\cos x（可空白）"></p>
      <p>x 從 <input id="d-x0" size="5" value="${x0}"> 到 <input id="d-x1" size="5" value="${x1}"></p>
      <p>y 從 <input id="d-y0" size="5" value="${y0}"> 到 <input id="d-y1" size="5" value="${y1}">（空白＝自動）</p>`, (d) => {
      const num = (id) => { const v = d.querySelector(id).value.trim(); return v === '' ? null : +v; };
      const nx0 = num('#d-x0'); const nx1 = num('#d-x1'); const ny0 = num('#d-y0'); const ny1 = num('#d-y1');
      if (!(nx0 < nx1)) { app.toast('x 的範圍要從小到大'); return; }
      plot.curves.forEach((c, k) => { c.latex = d.querySelector(`#d-f${k}`).value.trim() || c.latex; c.color = d.querySelector(`#d-c${k}`).value; c.range = [nx0, nx1]; });
      const extra = d.querySelector('#d-fnew').value.trim();
      if (extra) plot.curves.push({ latex: extra, color: colors[plot.curves.length % colors.length][0], width: 1, range: [nx0, nx1], n: 100 });
      plot.view.x = [nx0, nx1];
      plot.range = [nx0, nx1];
      plot.view.y = ny0 != null && ny1 != null && ny0 < ny1 ? [ny0, ny1] : null;
      const special = plotSpecial(plot, { width: a.texw || '3in', height: a.texh || '2in', path: a.path });
      // the frame keeps its own flags and size; its \special is the new one
      const head = a.frame.slice(0, a.frame.indexOf('\\special'));
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...a, frame: head + special + '}', src: null }));
      app.forgetPicture(a.path);
      status('繪圖中…');
      app.renderPlots().finally(() => status(''));
    });
  }
  // Compute > Plot 2D > Rectangular: a plot of the formula, as 5.5 makes it (a frame
  // with the plot's settings, drawn by plots.js)
  let plotCount = 0;
  function plot2d() {
    const mv = currentMath();
    if (!mv) { app.toast('把游標放在要畫的公式裡'); return; }
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
    status('繪圖中…（第一次要載入計算引擎，要幾秒）');
    app.renderPlots().finally(() => status(''));
  }
  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      view.dispatch(view.state.tr.insertText(text).scrollIntoView());
    } catch (e) { app.toast('請按 Ctrl+V 貼上'); }
  }

  // Edit > Paste Special: the clipboard's text as plain text, as LaTeX (formulas, sections ...),
  // or as one formula
  async function pasteSpecial() {
    let text;
    try { text = await navigator.clipboard.readText(); } catch (e) { app.toast('讀不到剪貼簿，請按 Ctrl+V 貼上'); return; }
    dialog('選擇性貼上', `<p><label><input type="radio" name="d-as" value="text" checked> 純文字</label></p>
      <p><label><input type="radio" name="d-as" value="latex"> LaTeX（公式、節標題等照 LaTeX 讀）</label></p>
      <p><label><input type="radio" name="d-as" value="math"> 一條公式</label></p>`, (d) => {
      const as = d.querySelector('input[name="d-as"]:checked').value;
      let tr = view.state.tr;
      if (as === 'text') tr = tr.insertText(text);
      else if (as === 'math') tr = tr.replaceSelectionWith(schema.nodes.math_inline.create({ latex: text.trim().replace(/^\$+|\$+$/g, '') }));
      else {
        const doc = readLatex(text).doc;
        const one = doc.childCount === 1 && doc.firstChild.type.name === 'paragraph';
        tr = one ? tr.replaceSelection(new Slice(doc.firstChild.content, 0, 0)) : tr.replaceSelection(new Slice(doc.content, 0, 0));
      }
      view.dispatch(tr.scrollIntoView());
      view.focus();
    });
  }

  // ---------- Compute menu (SymPy) ----------
  let computing = false;
  async function runCompute(op) {
    const mv = currentMath();
    if (!mv) { app.toast('把游標放在公式裡再計算'); return; }
    if (computing) return;
    computing = true;
    mv.save();
    status(isEngineLoaded() ? '計算中…' : '計算中…（第一次要載入計算引擎，要幾秒）');
    try {
      const r = await compute(op, mv.latex);
      if (op === 'define') { status(''); app.toast('已定義：之後的計算都會用它'); return; }
      if (r.kind === 'value') {
        mv.enter(false);
        mv.mf.insert(' = ' + r.latex, { format: 'latex', selectionMode: 'after' });
        mv.save();
      } else {
        // the answer is text after the formula: "，解為：x=1、x=2" / "（成立）"
        mv.exit(1);
        const { tr } = view.state;
        const nodes = [];
        if (r.kind === 'boolean') nodes.push(schema.text(r.value ? '（成立）' : '（不成立）'));
        else if (!r.solutions.length) nodes.push(schema.text('，沒有解'));
        else {
          nodes.push(schema.text('，解為：'));
          r.solutions.forEach((s, i) => {
            if (i) nodes.push(schema.text('；'));
            nodes.push(schema.nodes.math_inline.create({ latex: s }));
          });
        }
        view.dispatch(tr.insert(view.state.selection.from, nodes).scrollIntoView());
      }
      status('');
    } catch (e) {
      app.toast('計算失敗：' + e.message);
      status('');
    } finally { computing = false; }
  }
  const COMPUTE_ITEMS = [['計算', 'Ctrl+E', 'evaluate'], ['數值計算', null, 'numeric'], ['化簡', null, 'simplify'],
    ['因式分解', null, 'factor'], ['展開', null, 'expand'], '-', ['解方程（精確）', null, 'solve'], ['檢查是否相等', null, 'check']];
  const MATRIX_ITEMS = [['行列式', 'determinant'], ['反矩陣', 'inverse'], ['轉置', 'transpose'], ['特徵值', 'eigenvalues'],
    ['秩', 'rank'], ['列簡化（RREF）', 'rref'], ['零空間', 'nullspace'], ['跡', 'trace'], ['特徵多項式', 'charpoly'], ['伴隨矩陣', 'adjugate']];
  // Insert > Unit Name: 5.x writes units as \unit{..} (upright, a thin space before)
  const UNITS = [['公尺 m', 'm'], ['公分 cm', 'cm'], ['公里 km', 'km'], ['秒 s', 's'], ['分 min', 'min'], ['小時 h', 'h'], ['公克 g', 'g'],
    ['公斤 kg', 'kg'], ['牛頓 N', 'N'], ['焦耳 J', 'J'], ['瓦特 W', 'W'], ['帕 Pa', 'Pa'], ['赫茲 Hz', 'Hz'], ['安培 A', 'A'],
    ['伏特 V', 'V'], ['歐姆 Ω', '\\Omega'], ['克耳文 K', 'K'], ['莫耳 mol', 'mol'], ['公升 L', 'L']];
  // the rest of 5.5's Compute menu: [submenu, [[item, op], ...]]
  const COMPUTE_SUBMENUS = [
    ['改寫', [['成指數', 'rewrite_exp'], ['成正弦餘弦', 'rewrite_sincos']]],
    ['解', [['精確', 'solve'], ['數值', 'numericsolve']]],
    ['解常微分方程', [['精確', 'ode']]],
    ['多項式', [['部分分式', 'partialfractions'], ['依變數整理', 'collect']]],
    ['微積分', [['微分', 'differentiate'], ['不定積分', 'integrate'], ['冪級數', 'series'], ['求極值', 'extrema'], ['隱函數微分', 'implicitdiff']]],
    ['統計', [['平均數', 'mean'], ['中位數', 'median'], ['變異數', 'variance'], ['標準差', 'stddev']]],
    ['轉換', [['拉氏轉換', 'laplace'], ['反拉氏轉換', 'inverselaplace'], ['傅立葉轉換', 'fourier']]],
  ];
  // Compute > Definitions: x = 3 or f(x) = x^2 is used by every later computation
  async function definitions(op) {
    if (op === 'define') { await runCompute('define'); return; }
    try {
      const r = await compute(op, '0');
      if (op === 'cleardefs') app.toast('定義都清除了');
      else app.toast(r.solutions.length ? '目前的定義：' + r.solutions.join('；') : '還沒有定義');
    } catch (e) { app.toast(e.message); }
  }
  app.compute = runCompute;

  // View: what the page shows besides the text (5.5's View menu); remembered between sessions
  const VIEW_TOGGLES = [['markers', '標記'], ['index', '索引項目'], ['helpers', '輔助線（表格格線、環境框）'], ['texfields', 'TeX 欄位']];
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
  // Tools > Computation Engine: what computes, and loading it now
  async function engineInfo() {
    status('載入計算引擎中…');
    try {
      const r = await compute('version', '0');
      dialog('計算引擎', `<p>計算用的是 ${escHtml(r.solutions.join('、'))}，在 Pyodide（瀏覽器裡的 Python）裡跑，不用連網路。</p>
        <p>計算選單的每一項都用它；第一次用要載入幾秒，之後就快了。</p>`, () => {});
    } catch (e) { app.toast(e.message); } finally { status(''); }
  }
  // Compute > Check with Lean: Lean 4 proves the equation at the cursor (over the real
  // numbers) or says it could not. Needs Lean with Mathlib on the computer.
  const LEAN_KEY = 'opensw-lean-project';
  function leanSettings(then) {
    const now = localStorage.getItem(LEAN_KEY) || '';
    dialog('Lean 設定', `<p>Lean 專案資料夾（裝好 Mathlib 的 Lake 專案，裡面有 lakefile）：</p>
      <p><input id="d-lean" size="40" value="${escHtml(now)}" placeholder="例如 D:\\lean\\myproof"></p>`, (d) => {
      const v = d.querySelector('#d-lean').value.trim();
      try { localStorage.setItem(LEAN_KEY, v); } catch (e) { /* storage off */ }
      if (v && then) then();
    });
  }
  async function leanCheckFormula() {
    const mv = currentMath();
    if (!mv) { app.toast('把游標放在等式裡再檢查'); return; }
    mv.save();
    let thm;
    try { thm = leanTheorem(await formulaJson(mv.latex), mv.latex); } catch (e) { app.toast('不能用 Lean 檢查：' + e.message); return; }
    const shown = `<pre class="lean-code">${escHtml(thm.statement)}</pre>`;
    if (!isDesktop) { dialog('用 Lean 檢查', `<p>要在電腦版才能執行 Lean。要檢查的敘述：</p>${shown}`, () => {}); return; }
    const project = localStorage.getItem(LEAN_KEY);
    if (!project) { leanSettings(leanCheckFormula); return; }
    status('Lean 檢查中…（第一次要載入 Mathlib，可能要幾分鐘）');
    try {
      const [ok, out] = await leanCheck(project, thm.code);
      const v = leanVerdict(out, ok);
      dialog('用 Lean 檢查', `<p>${v.ok ? '✓ ' : ''}${escHtml(v.message)}</p><p>檢查的敘述（x、y 這些是任意實數）：</p>${shown}`, () => {});
    } catch (e) { app.toast(String(e.message || e)); } finally { status(''); }
  }
  // File > Document Info
  function documentInfo() {
    const doc = view.state.doc;
    const count = {};
    doc.descendants((n) => { count[n.type.name] = (count[n.type.name] || 0) + 1; });
    const words = (doc.textContent.match(/[A-Za-z0-9]+|[\u3400-\u9fff]/g) || []).length;
    const meta = app.meta();
    const rows = [['檔名', meta.name || '（未命名）'], ['來源', meta.preamble55 ? 'Scientific Word 5.x（.tex）' : app.path() ? 'Scientific Word 6（.sci）' : '新文件'],
      ['文件類別', meta.documentclass || 'article'], ['字數（中文算字、英文算詞）', words], ['段落', count.paragraph || 0], ['節標題', count.heading || 0],
      ['公式', (count.math_inline || 0) + (count.math_display || 0)], ['表格', count.table || 0], ['圖片和繪圖', count.image || 0],
      ['註腳', count.note || 0], ['TeX 欄位', count.tex_field || 0]];
    dialog('文件資訊', '<table class="info">' + rows.map(([k, v]) => `<tr><td>${k}</td><td>${escHtml(String(v))}</td></tr>`).join('') + '</table>', () => {});
  }
  // Typeset > Options: the document class of a document not from 5.x
  function typesetOptions() {
    const meta = app.meta();
    if (meta.preamble55) { app.toast('5.x 文件的類別在導言裡：用「排版 > 導言…」修改'); return; }
    const opt = (v) => `<option${(meta.documentclass || 'article') === v ? ' selected' : ''}>${v}</option>`;
    dialog('排版選項', `<p>文件類別 <select id="d-class">${['article', 'report', 'book', 'amsart', 'amsbook'].map(opt).join('')}</select></p>`, (d) => {
      app.setMeta({ ...meta, documentclass: d.querySelector('#d-class').value });
      app.toast('文件類別已改成 ' + d.querySelector('#d-class').value);
    });
  }

  // ---------- menus ----------
  // [label, shortcut, action] ; '-' = separator ; [label, null, [submenu...]]
  const sym = (list) => list.map(([s, l]) => [s, null, () => mathInsert(l)]);
  const MENUS = [
    ['檔案', [
      ['新增', null, app.newDoc], ['開啟…', 'Ctrl+O', app.open], ['關閉', 'Ctrl+F4', app.closeDoc], ['儲存', null, app.save], ['另存新檔…', null, app.saveAs], ['另存成 5.x 的 .tex…', null, app.saveAs55], '-',
      ['匯入圖片…', null, app.importPicture], '-',
      ['匯出 LaTeX…', null, app.exportLatex], ['匯出 HTML…', null, app.exportHtml], ['匯出 Word（.docx）…', null, app.exportDocx], ['匯出給 AI（Markdown）…', null, app.exportMd], '-',
      ['最近的檔案', null, app.recent],
      ['範例', null, app.samples.map(([id, label]) => [label, null, () => app.openSample(id)])], ['文件資訊', null, documentInfo], '-',
      ['排版 PDF', 'Ctrl+P', app.pdf],
    ]],
    ['編輯', [
      ['復原', 'Ctrl+Z', () => run(undo)], ['重做', null, () => run(redo)], '-',
      ['剪下', 'Ctrl+X', () => document.execCommand('cut')], ['複製', 'Ctrl+C', () => document.execCommand('copy')],
      ['貼上', 'Ctrl+V', paste], ['選擇性貼上…', null, pasteSpecial], '-', ['屬性（公式、表格、圖片）…', 'Ctrl+F5', properties], '-',
      ['插入列…', null, tables.insertRows], ['插入欄…', null, tables.insertColumns],
      ['刪除列', null, tables.deleteRow], ['刪除欄', null, tables.deleteColumn], ['刪除表格', null, tables.deleteTable],
      ['合併儲存格', null, tables.mergeCells], ['分割儲存格', null, tables.splitCell], '-',
      ['尋找…', 'Ctrl+Q', () => openFind(false)], ['取代…', 'Ctrl+W', () => openFind(true)], '-', ['全選', 'Ctrl+A', () => run((s, d) => { d(s.tr.setSelection(new AllSelection(s.doc))); return true; })],
    ]],
    ['插入', [
      ['數學', 'Ctrl+M', toggleMath], '-',
      ['分數', 'Ctrl+F', () => mathAction('fraction')], ['根號', 'Ctrl+R', () => mathAction('radical')],
      ['上標', 'Ctrl+H', () => mathAction('superscript')], ['下標', 'Ctrl+L', () => mathAction('subscript')],
      ['獨立公式', 'Ctrl+D', display], '-',
      ['運算子', null, sym(OPERATORS)], ['括號', null, BRACKETS.map(([s, a]) => [s, null, () => mathAction(a)])],
      ['矩陣…', null, insertMatrix], ['表格…', null, tables.insertTable], ['函數名稱', null, sym(NAMES)], ['二項式', null, () => mathAction('binomial')],
      ['裝飾', null, DECORATIONS.map(([s, a]) => [s, null, () => mathAction(a)])], '-',
      ['標記…', null, insertMarker], ['交叉引用…', null, insertRef], ['表格標題', null, tables.addCaption], ['註解…', null, insertNote], '-',
      ['引用文獻…', null, insertCitation], ['索引項目…', null, insertIndexEntry], ['超連結…', null, insertLink], ['TeX 欄位…', null, insertTexField], '-',
      ['間距', null, SPACES.map(([s, a]) => [s, null, () => (a.startsWith('\\') ? mathInsert(a) : space(a))])],
      ['單位名稱', null, UNITS.map(([l, u]) => [l, null, () => mathInsert(`\\unit{${u}}`)])],
    ]],
    ['檢視', [
      ['放大', 'Ctrl+=', () => app.zoomStep(1)], ['縮小', null, () => app.zoomStep(-1)], '-',
      ['200%', null, () => app.setZoom(2)], ['100%', null, () => app.setZoom(1)], '-',
      ...VIEW_TOGGLES.map(([cls, l]) => [() => (isShown(cls) ? '✓ ' : '　') + l, null, () => toggleView(cls)]),
    ]],
    ['前往', [['上一節', null, () => goSection(-1)], ['下一節', null, () => goSection(1)], '-', ['標記…', null, goMarker]]],
    ['標籤', [
      ['移除項目標籤', 'F2', untag], ['本文', 'F3', () => setBlockTag('paragraph')], ['一般', 'F4', () => setTextTag('')],
      ['粗體', 'F5', () => setTextTag('bold')], ['強調', 'F6', () => setTextTag('italic')], ['編號清單', 'F7', () => setItemTag('numbered')],
      ['項目清單', 'F8', () => setItemTag('bullet')], ['打字機', 'F9', () => setTextTag('code')], ['節', 'F11', () => setBlockTag('h2')],
      ['小節', 'F12', () => setBlockTag('h3')], '-',
      ['項目標籤', null, ITEM_TAGS.slice(1).map(([v, l]) => [l, null, () => setItemTag(v)])],
      ['段落標籤', null, BLOCK_TAGS.map(([v, l]) => [l, null, () => setBlockTag(v)])],
      ['文字標籤', null, TEXT_TAGS.map(([v, l]) => [l, null, () => setTextTag(v)])],
    ]],
    ['計算', [
      ...COMPUTE_ITEMS.map((it) => (it === '-' ? it : [it[0], it[1], () => runCompute(it[2])])), ['合併', null, () => runCompute('combine')], '-',
      ...COMPUTE_SUBMENUS.map(([label, items]) => [label, null, items.map(([l, op]) => [l, null, () => runCompute(op)])]),
      ['矩陣', null, MATRIX_ITEMS.map(([l, op]) => [l, null, () => runCompute(op)])], '-',
      ['定義', null, [['新定義', null, () => definitions('define')], ['顯示定義', null, () => definitions('showdefs')], ['清除定義', null, () => definitions('cleardefs')]]],
      ['繪圖 2D', null, [['直角座標', null, plot2d]]], '-',
      ['用 Lean 檢查', null, leanCheckFormula],
    ]],
    ['排版', [['排版 PDF', 'Ctrl+P', app.pdf], ['導言…', null, editPreamble], ['選項…', null, typesetOptions], ['匯出 LaTeX…', null, app.exportLatex]]],
    ['工具', [
      [() => (view.dom.spellcheck ? '✓ ' : '　') + '拼字檢查（英文，瀏覽器內建）', null, toggleSpell],
      ['計算引擎…', null, engineInfo], ['Lean 設定…', null, () => leanSettings()],
    ]],
    ['視窗', app.windows],
    ['說明', [['快捷鍵', 'F1', app.help], ['使用說明', null, () => { $('#guide').hidden = false; $('#guide-close').onclick = () => { $('#guide').hidden = true; view.focus(); }; }]]],
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
      if (!act) { b.disabled = true; b.title = '只有桌面版有'; }
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
      if (name === '視窗') app.refreshWindows(); // the open documents right now
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
  zoomSel.title = '縮放';
  for (const z of app.ZOOMS) zoomSel.append(new Option(Math.round(z * 100) + '%', z));
  zoomSel.onchange = () => { app.setZoom(+zoomSel.value); view.focus(); };

  const GROUPS = [
    [ // Standard
      tbtn('new', '新增文件', app.newDoc), tbtn('open', '開啟 .sci 或 5.x 的 .tex 檔（Ctrl+O）', app.open, 'btn-open'),
      tbtn('save', '儲存成 .sci 檔', app.save, 'btn-save'),
      tbtn('print', '排版並開啟 PDF（Ctrl+P，桌面版）', app.pdf || (() => app.toast('桌面版才能排版 PDF')), 'btn-pdf'),
      tbtn('exporttex', '匯出 LaTeX', app.exportLatex, 'btn-latex'), tbtn('AI', '匯出給 AI 讀（Markdown）', app.exportMd, 'btn-md'),
    ],
    [
      tbtn('cut', '剪下（Ctrl+X）', () => document.execCommand('cut')), tbtn('copy', '複製（Ctrl+C）', () => document.execCommand('copy')),
      tbtn('paste', '貼上（Ctrl+V）', paste),
      tbtn('undo', '復原（Ctrl+Z）', () => run(undo), 'btn-undo'), tbtn('redo', '重做', () => run(redo), 'btn-redo'),
      tbtn('math_mathtext', '數學／文字切換（Ctrl+M 或 Ctrl+T）', toggleMath, 'btn-math'), zoomSel,
    ],
    [ // Math Templates
      tbtn('math_fraction', '分數（Ctrl+F）', () => mathAction('fraction')), tbtn('math_radical', '根號（Ctrl+R）', () => mathAction('radical')),
      tbtn('math_superscript', '上標（Ctrl+H）', () => mathAction('superscript')), tbtn('math_subscript', '下標（Ctrl+L）', () => mathAction('subscript')),
      tbtn('math_parentheses', '圓括號（Ctrl+9）', () => mathAction('paren')), tbtn('math_squarebrackets', '方括號（Ctrl+[）', () => mathAction('bracket')),
      tbtn('math_sum', '總和（Ctrl+7）', () => mathAction('sum')), tbtn('math_integral', '積分（Ctrl+I）', () => mathAction('integral')),
    ],
    [ // Math Objects
      tbtn('display', '獨立公式（Ctrl+D）', display, 'btn-display'), tbtn('math_bigop', '運算子', panel(OPERATORS, 'big')),
      tbtn('math_brackets', '括號', panel(BRACKETS, 'wide', mathAction)), tbtn('math_matrix', '矩陣', insertMatrix),
      tbtn('math_mathname', '函數名稱', panel(NAMES, 'names')), tbtn('math_binomial', '二項式', () => mathAction('binomial')),
      tbtn('math_decoration', '裝飾', panel(DECORATIONS, '', mathAction)),
    ],
    [ // Compute
      tbtn('=', '計算（Ctrl+E）', () => runCompute('evaluate'), 'btn-evaluate'), tbtn('≐', '數值計算', () => runCompute('numeric')),
      tbtn('化簡', '化簡', () => runCompute('simplify')), tbtn('展開', '展開', () => runCompute('expand')),
      tbtn('因式', '因式分解', () => runCompute('factor')), tbtn('解', '解方程（精確）', () => runCompute('solve')),
    ],
    CACHE.map(([s, l]) => tbtn(s, `${s}　${l}`, () => mathInsert(l))), // Symbol Cache
    Object.entries(PANELS).map(([name, list]) => tbtn(name, '符號面板 ' + name, panel(list))), // Symbol Panels
    [ // Editing
      tbtn('N', '一般文字（F4）', () => setTextTag('')),
      tbtn('bold', '粗體（F5）', () => run(toggleMark(schema.marks.bold)), 'btn-bold'),
      tbtn('italic', '強調（F6）', () => run(toggleMark(schema.marks.italic)), 'btn-italic'),
      tbtn('?', '快捷鍵（F1）', app.help, 'btn-help'),
    ],
  ];
  for (const g of GROUPS) {
    const div = document.createElement('div');
    div.className = 'tb-group';
    div.append(...g);
    $('#toolbar').append(div);
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
  function status(msg) { $('#status-text').textContent = msg || pendingMsg || '要說明請按 F1'; }
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
    $('#status-mode').textContent = math ? '數學' : '文字';
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
    pendingMsg = p === 'greek' ? 'Ctrl+G：再按一個字母輸入希臘字母（a→α、b→β、y→θ…）'
      : p === 'symbol' ? 'Ctrl+S：再按一個鍵輸入符號（I→∞、e→∈、=→≠、<→≤…）'
        : p?.startsWith('accent:') ? '再按一個字母加上重音' : p === 'dash' ? '再按一次 Ctrl+- 插入可斷字的連字號' : '';
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
  function functionKey(f) {
    if (f === 'untag') untag();
    else if (f === 'body') setBlockTag('paragraph');
    else if (f === 'normal') setTextTag('');
    else if (f === 'bold' || f === 'italic' || f === 'code') setTextTag(f);
    else if (f === 'numbered' || f === 'bullet') setItemTag(f);
    else if (f === 'menu') document.querySelector('.menu-top').click();
    else setBlockTag(f);
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
    if (plain && FKEYS[e.key]) { e.preventDefault(); e.stopPropagation(); functionKey(FKEYS[e.key]); return; }
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
    else if (a === 'print') app.pdf ? app.pdf() : app.toast('桌面版才能排版 PDF');
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
  $('#help').innerHTML = '<b>Scientific Word 5.5 的快捷鍵</b>（Mac 上 Ctrl 換成 Cmd）<table>'
    + HELP_ROWS.map(([a, b]) => `<tr><td>${a}</td><td>${b.replace(/</g, '&lt;')}</td></tr>`).join('')
    + '</table>公式裡也可以直接打：^ 上標、_ 下標、/ 分數、\\alpha 希臘字母、sqrt 根號；方向鍵走到公式邊緣會回到文字。';

  return { refresh };
}
