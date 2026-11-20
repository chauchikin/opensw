// The Scientific Word 5.5 look: menu bar, toolbars with the 6.1 open-source icons,
// symbol cache and symbol panels, the tag bar at the bottom, the status bar, and
// 5.5's keyboard shortcuts.
import { toggleMark, setBlockType, wrapIn, lift } from 'prosemirror-commands';
import { wrapInList, liftListItem } from 'prosemirror-schema-list';
import { undo, redo } from 'prosemirror-history';
import { Selection, AllSelection, TextSelection, NodeSelection } from 'prosemirror-state';
import { toPx } from './graphics.js';
import { parsePlot, drawable, plotSpecial, plotKind, components, splitRelation, PLOTTYPE, DIMS, ANIM_DEFAULT } from './plots.js';
import { odeRows } from './mathjson.js';
import { isTemplate, buildExams, examSettings } from './exam.js';
import { settings, saveSettings } from './settings.js';
import { MANUAL } from './helpdoc.js';
import { stripComments, readLatex, decode55 } from './tex55.js';
import { Slice } from 'prosemirror-model';
import { schema } from './schema.js';
import { insertMath } from './mathview.js';
import { compute, isEngineLoaded, formulaJson, formulaInfo, numericStarts, pythonProblem } from './compute.js';
import { leanTheorem, leanVerdict } from './lean.js';
import { isDesktop, leanCheck } from './desktop.js';
import { formulaPng, imagePng, copyPng } from './copyimage.js';
import { ICONS } from './icons.js';
import { setupTables } from './tables55.js';
import { GREEK, SYMBOL_PREFIX, TEMPLATES, actionFor, HELP_ROWS, FKEYS, COMBINING, NEGATE, NEGATE_TEXT } from './keys55.js';
import { _t, LANGUAGES } from './i18n.js';
import { ACTIONS55 } from './c55.js';
import { plot55For, applyPlot55, frameOf } from './plot55.js';
import { setupMenus55 } from './menus55.js';


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
const SPACES = [[_t('Thin space'), 'thinspace'], [_t('Thick space'), 'thickspace'], [_t('Nonbreaking space'), 'nbsp'], [_t('1em space'), '\\quad'], [_t('2em space'), '\\qquad']];

// ---------- tags (bottom bar) ----------
const ITEM_TAGS = [['', _t('(item tag)')], ['axiom', _t('Axiom')], ['bullet', _t('Bullet list')], ['case', _t('Case')], ['claim', _t('Claim')],
  ['conclusion', _t('Conclusion')], ['condition', _t('Condition')], ['conjecture', _t('Conjecture')], ['corollary', _t('Corollary')], ['criterion', _t('Criterion')],
  ['definition', _t('Definition')], ['example', _t('Example')], ['exercise', _t('Exercise')], ['lemma', _t('Lemma')], ['notation', _t('Notation')],
  ['numbered', _t('Numbered list')], ['problem', _t('Problem')], ['proof', _t('Proof')], ['proposition', _t('Proposition')], ['remark', _t('Remark')],
  ['solution', _t('Solution')], ['summary', _t('Summary')], ['theorem', _t('Theorem')]];
const BLOCK_TAGS = [['paragraph', _t('Body text')], ['title', _t('Document title')], ['h0', _t('Part')], ['h1', _t('Chapter')], ['h2', _t('Section')], ['h3', _t('Subsection')], ['h4', _t('Subsubsection')]];
// text tags; "size:large" is the size mark with that size
const TEXT_TAGS = [['', _t('(normal)')], ['bold', _t('Bold')], ['italic', _t('Emphasized')], ['code', _t('Typewriter')], ['smallcaps', _t('Small caps')],
  ['sans', _t('Sans serif')], ['underline', _t('Underline')], ['size:tiny', _t('Tiny')], ['size:scriptsize', _t('Script size')], ['size:footnotesize', _t('Footnote size')],
  ['size:small', _t('Small')], ['size:large', _t('Large')], ['size:Large', _t('Larger')], ['size:LARGE', _t('Largest')], ['size:huge', _t('Huge')], ['size:Huge', _t('Hugest')]];

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
      if (!NEGATE[left]) { app.toast(_t('The symbol on the left has no negated form')); return; }
      mv.mf.executeCommand('deleteBackward');
      mv.mf.insert(NEGATE[left], { format: 'latex', selectionMode: 'after' });
      mv.changed();
      return;
    }
    const { $head, empty } = view.state.selection;
    const ch = empty && $head.parent.textBetween(Math.max(0, $head.parentOffset - 1), $head.parentOffset);
    if (!ch || !NEGATE_TEXT[ch]) { app.toast(_t('The symbol on the left has no negated form')); return; }
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
    if (!mv) { app.toast(_t('Put the cursor in a formula or a table, or select a picture, then press Ctrl+F5')); return; }
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
    dialog(_t('Picture properties'), `<p>${_t('File: {0}{1}', escHtml(a.path || _t('(no file name)')), a.src ? '' : _t(' (file not found)'))}</p>
      <p>${_t('Width')} <input id="d-w" size="8" value="${escHtml(inches(a.width, a.texw))}"> ${_t('Height')} <input id="d-h" size="8" value="${escHtml(inches(a.height, a.texh))}">
        <label><input id="d-keep" type="checkbox" checked> ${_t('Keep proportions')}</label></p>
      <p>${_t('Position')} <select id="d-place">${opt('inline', _t('In line'), a.place)}${opt('display', _t('On its own line'), a.place)}${opt('float', _t('Floating (with caption)'), a.place)}</select></p>
      <p>${_t('Caption')} <input id="d-cap" size="30" value="${escHtml(a.caption || '')}"></p>
      <p>${_t('Marker')} <input id="d-key" size="18" value="${escHtml(a.label || '')}"></p>`, (d) => {
      const w = d.querySelector('#d-w').value.trim();
      let h = d.querySelector('#d-h').value.trim();
      const wpx = toPx(w);
      let hpx = toPx(h);
      if (!wpx || !hpx) { app.toast(_t('Width and height must be lengths such as 3in, 5cm, 100pt')); return; }
      // keep the shape: a new width sets the height
      if (d.querySelector('#d-keep').checked && w !== inches(a.width, a.texw) && h === inches(a.height, a.texh) && a.width && a.height) {
        hpx = Math.round(wpx * a.height / a.width * 10) / 10;
        h = (hpx / 96).toFixed(4) + 'in';
      }
      const key = d.querySelector('#d-key').value.trim() || null;
      if (key && key !== a.label && markerKeys().includes(key)) { app.toast(_t('There is already a marker "{0}"', key)); return; }
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
    dialog(_t('Marker'), _t('<p>Name <input id="d-key" size="18" placeholder="e.g. thm:main"></p>'), (d) => {
      const key = d.querySelector('#d-key').value.trim();
      if (!key) return;
      if (markerKeys().includes(key)) { app.toast(_t('There is already a marker "{0}"', key)); return; }
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
    dialog(_t('Citation'), `<p>${_t('Keys')} <input id="d-keys" size="22" list="d-bibkeys" placeholder="${_t('separate several with commas')}">
      <datalist id="d-bibkeys">${keys.map((k) => `<option value="${escHtml(k)}">`).join('')}</datalist></p>
      <p>${_t('Annotation')} <input id="d-note" size="16" placeholder="${_t('e.g. p.~5 (may be empty)')}"></p>`, (d) => {
      const k = d.querySelector('#d-keys').value.split(',').map((x) => x.trim()).filter(Boolean).join(',');
      if (!k) return;
      insertInline(schema.nodes.cite.create({ keys: k, note: d.querySelector('#d-note').value.trim() || null }));
    });
  }
  // Insert > Index Entry
  function insertIndexEntry() {
    const sel = view.state.selection;
    const picked = sel.empty ? '' : view.state.doc.textBetween(sel.from, sel.to, ' ');
    dialog(_t('Index entry'), `<p>${_t('Entry')} <input id="d-entry" size="24" value="${escHtml(picked)}" placeholder="${_t('main!sub')}"></p>`, (d) => {
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
    dialog(_t('Hypertext link'), `<p>${_t('Text')} <input id="d-text" size="24" value="${escHtml(picked)}"></p>
      <p>${_t('Target')} <input id="d-href" size="28" list="d-markers" placeholder="${_t('https://… or a marker name')}">
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
    dialog(_t('Footnote or margin note'), `<p>${_t('Type')} <select id="d-kind"><option value="footnote">${_t('Footnote')}</option><option value="margin">${_t('Margin note')}</option></select></p>`, (d) => {
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
    if (!keys.length) { app.toast(_t('The document has no markers yet; use Insert > Marker first')); return; }
    const mv = currentMath();
    dialog(_t('Cross reference'), `<p>${_t('Marker')} <select id="d-key">${keys.map((k) => `<option>${escHtml(k)}</option>`).join('')}</select></p>
      <p>${_t('Show')} <select id="d-kind"><option value="ref">${_t('Number')}</option><option value="eqref">${_t('(number)')}</option><option value="pageref">${_t('page')}</option></select></p>`, (d) => {
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
    if (!all.length) { app.toast(_t('Not found')); return false; }
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
    app.toast(_t('Replaced {0} times', all.length));
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
  const ALL_TAGS = [['untag', _t('Remove item tag')], ...BLOCK_TAGS.map(([v, l]) => ['block:' + v, l]), ...ITEM_TAGS.slice(1).map(([v, l]) => ['item:' + v, l]),
    ...TEXT_TAGS.map(([v, l]) => ['text:' + v, v ? l : _t('Normal')])];
  const tagName = (code) => (ALL_TAGS.find(([c]) => c === code) || [null, code])[1];
  function functionKeysDialog() {
    const now = fkeys();
    const sel = (k) => `<select id="d-${k}">${ALL_TAGS.map(([c, l]) => `<option value="${c}"${c === now[k] ? ' selected' : ''}>${escHtml(l)}</option>`).join('')}</select>`;
    dialog(_t('Function keys'), `<table class="info">${FKEY_NAMES.map((k) => `<tr><td>${k}</td><td>${sel(k)}</td></tr>`).join('')}</table>
      <p><label><input id="d-reset" type="checkbox"> ${_t('Restore the 5.5 defaults')}</label></p>`, (d) => {
      const out = d.querySelector('#d-reset').checked ? {} : Object.fromEntries(FKEY_NAMES.map((k) => [k, d.querySelector('#d-' + k).value]));
      try { localStorage.setItem(FKEY_STORE, JSON.stringify(out)); } catch (e) { app.toast(_t('Could not save the settings')); return; }
      app.toast(_t('Function keys updated'));
    });
  }
  // Tag > Appearance: how a tag looks on the screen (font, size, colour); the PDF is not changed,
  // as in 5.5. Kept between sessions.
  const LOOK_STORE = 'opensw-tag-looks';
  const LOOK_TAGS = [['block:paragraph', _t('Body text'), 'p'], ['block:title', _t('Document title'), 'h1.doc-title'], ['block:h0', _t('Part'), 'h1:not(.doc-title)'],
    ['block:h1', _t('Chapter'), 'h2'], ['block:h2', _t('Section'), 'h3'], ['block:h3', _t('Subsection'), 'h4'], ['block:h4', _t('Subsubsection'), 'h5'],
    ...ITEM_TAGS.slice(1).map(([v, l]) => ['item:' + v, l, v === 'numbered' ? 'ol' : v === 'bullet' ? 'ul' : '.env-' + v]),
    ['text:bold', _t('Bold'), 'strong'], ['text:italic', _t('Emphasized'), 'em'], ['text:code', _t('Typewriter'), 'code'], ['text:smallcaps', _t('Small caps'), '.m-sc'],
    ['text:sans', _t('Sans serif'), '.m-sf'], ['text:underline', _t('Underline'), 'u']];
  const FONTS = [['', _t('(unchanged)')], ['serif', _t('Serif (Times)')], ['sans', _t('Sans serif')], ['mono', _t('Monospace')], ['kai', _t('Kai (Chinese script)')]];
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
      const tri = (id, v, label) => `<select id="${id}"><option value=""${v == null ? ' selected' : ''}>${_t('{0} (unchanged)', label)}</option><option value="1"${v === true ? ' selected' : ''}>${_t('Yes')}</option><option value="0"${v === false ? ' selected' : ''}>${_t('No')}</option></select>`;
      $('#d-look').innerHTML = `<p>${_t('Font')} <select id="d-font">${FONTS.map(([v, t]) => `<option value="${v}"${(l.font || '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></p>
        <p>${_t('Size')} <input id="d-size" size="4" value="${l.size || ''}">${_t('% (empty = unchanged)')}</p>
        <p><label><input id="d-hascolor" type="checkbox"${l.color ? ' checked' : ''}> ${_t('Color')}</label> <input id="d-color" type="color" value="${l.color || '#000000'}"></p>
        <p>${tri('d-bold', l.bold, _t('Bold'))} ${tri('d-italic', l.italic, _t('Italic'))}</p>`;
    };
    const read = (code) => {
      const size = +$('#d-size').value.trim();
      const tri = (id) => ($(id).value === '' ? undefined : $(id).value === '1');
      const l = { font: $('#d-font').value || undefined, size: size > 0 ? size : undefined, color: $('#d-hascolor').checked ? $('#d-color').value : undefined, bold: tri('#d-bold'), italic: tri('#d-italic') };
      if (Object.values(l).every((v) => v === undefined)) delete all[code]; else all[code] = JSON.parse(JSON.stringify(l));
    };
    dialog(_t('Tag appearance'), `<p>${_t('Tag')} <select id="d-tag">${LOOK_TAGS.map(([c, l]) => `<option value="${c}">${escHtml(l)}</option>`).join('')}</select>${_t('(changes only how it looks on screen, not the typesetting)')}</p>
      <div id="d-look"></div><p><label><input id="d-clear" type="checkbox"> ${_t('Restore all')}</label></p>`, () => {
      read($('#d-tag').value);
      const out = $('#d-clear').checked ? {} : all;
      try { localStorage.setItem(LOOK_STORE, JSON.stringify(out)); } catch (e) { app.toast(_t('Could not save the settings')); return; }
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
    if (!from.length) { app.toast(dir < 0 ? _t('No previous position') : _t('No next position')); return; }
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
    if (!link) { app.toast(_t('Put the cursor on a hypertext link')); return; }
    const href = link.attrs.href;
    if (href.startsWith('#')) {
      const at = markerPos(href.slice(1));
      if (at == null) app.toast(_t('Marker not found: ') + href.slice(1)); else jumpTo(at);
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
    if (!keys.length) { app.toast(_t('The document has no markers')); return; }
    dialog(_t('Go to marker'), `<p>${_t('Marker')} <select id="d-key">${keys.map((k) => `<option>${escHtml(k)}</option>`).join('')}</select></p>`, (d) => {
      const at = markerPos(d.querySelector('#d-key').value);
      if (at != null) jumpTo(at);
    });
  }
  // Insert > TeX Field: LaTeX passed through as written
  function insertTexField() {
    dialog(_t('TeX field'), _t('<p><textarea id="d-tex" rows="4" cols="40" placeholder="e.g. \\vspace{1cm}"></textarea></p>'), (d) => {
      const tex = d.querySelector('#d-tex').value.trim();
      if (tex) insertInline(schema.nodes.tex_field.create({ tex }));
    });
    $('#dialog-body').onkeydown = null; // Enter makes a new line in the TeX
  }
  // Insert > HTML Field: HTML put into the page when the document is exported as HTML (TeX skips it)
  function insertHtmlField() {
    dialog(_t('HTML field'), _t('<p>Used only when exporting HTML; skipped when typesetting PDF.</p><p><textarea id="d-html" rows="4" cols="40" placeholder="e.g. <iframe src=…></iframe>"></textarea></p>'), (d) => {
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
    dialog(_t('Preamble'), `<p>${is55 ? _t('The Scientific Word 5 document\'s preamble (from \\documentclass to just before \\begin{document})') : _t('LaTeX added before \\begin{document} (e.g. \\newtheorem, \\usepackage)')}</p>
      <p><textarea id="d-pre" rows="16" cols="70" spellcheck="false"></textarea></p>`, (d) => {
      const v = d.querySelector('#d-pre').value;
      if (is55) app.setMeta({ ...meta, preamble55raw: v, preamble55: stripComments(v).replace(/\n{3,}/g, '\n\n').trim() });
      else app.setMeta({ ...meta, preambleTeX: v });
      app.toast(_t('Preamble updated'));
    });
    $('#d-pre').value = text;
    $('#dialog-body').onkeydown = null;
  }
  // an animated plot's own settings (5.5: Plot Properties > Variables, Intervals, and Animation)
  const animRows = (plot) => (!plot.anim ? '' : `<p>${_t('Animation variable')} <input id="d-av" size="4" value="${escHtml(plot.anim.param)}"> ${_t('from')} <input id="d-aa" size="5" value="${plot.anim.range[0]}"> ${_t('to')} <input id="d-ab" size="5" value="${plot.anim.range[1]}"></p>
    <p>${_t('Frames per second')} <input id="d-fps" size="3" value="${plot.anim.fps}">　${_t('Time from')} <input id="d-ts" size="3" value="${plot.anim.start}"> ${_t('to')} <input id="d-te" size="3" value="${plot.anim.end}"> ${_t('seconds')}</p>`);
  function readAnim(d, plot) {
    if (!plot.anim) return true;
    const v = (id) => +d.querySelector(id).value;
    const name = d.querySelector('#d-av').value.trim();
    const [a, b, fps, t0, t1] = [v('#d-aa'), v('#d-ab'), v('#d-fps'), v('#d-ts'), v('#d-te')];
    if (!name || !(a < b) || !(t0 < t1)) { app.toast(_t('Ranges must go from small to large')); return false; }
    if (!(fps >= 1)) { app.toast(_t('At least 1 frame per second')); return false; }
    plot.anim = { ...plot.anim, param: name, range: [a, b], fps: Math.round(fps), start: t0, end: t1 };
    return true;
  }
  // Properties of the other kinds of plot: the formulas, the variables' ranges, the grid,
  // and what the kind has of its own (a tube's radius, the boxes of an approximate integral)
  function otherPlotProperties(pos, node, plot, kind) {
    const a = node.attrs;
    const dims = DIMS[kind];
    const c0 = plot.curves[0];
    const names = kind === 'conformal' ? ['Re ' + plot.variable, 'Im ' + plot.variable] : kind === 'ode' ? [plot.variable] : [c0.variable || plot.variable, plot.variable2, plot.variable3];
    const ranges = [c0.range, c0.range2, c0.range3];
    const rows = plot.curves.map((c, k) => `<p>${kind === 'ode' ? _t('System of equations') : _t('Formula')} ${plot.curves.length > 1 ? k + 1 : ''} <input id="d-f${k}" size="30" value="${escHtml(c.latex)}"></p>`).join('');
    const rangeRows = Array.from({ length: dims }, (_, i) => `<p>${_t('{0} from', escHtml(names[i] || 'xyz'[i]))} <input id="d-a${i}" size="6" value="${ranges[i][0]}"> ${_t('to')} <input id="d-b${i}" size="6" value="${ranges[i][1]}"></p>`).join('');
    const gridRow = ['implicit', 'inequality', 'vector', 'gradient', 'conformal', 'implicit3', 'vector3', 'gradient3', 'cylindrical', 'spherical', 'surface', 'tube'].includes(kind)
      ? `<p>${_t('Grid lines')} <input id="d-g" size="4" value="${c0.grid[0] || ''}"></p>` : '';
    const own = kind === 'tube' ? `<p>${_t('Radius')} <input id="d-r" size="10" value="${escHtml(c0.radius || '0.2')}"></p>`
      : kind === 'approx' ? `<p>${_t('Method')} <select id="d-m">${[['left', _t('Left endpoints')], ['midpoint', _t('Midpoints')], ['right', _t('Right endpoints')], ['upper', _t('Upper sum')], ['lower', _t('Lower sum')], ['trapezoid', _t('Trapezoid')]]
        .map(([v, l]) => `<option value="${v}"${String(c0.boxType || 'left').toLowerCase().startsWith(v.slice(0, 3)) ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${_t('Subintervals')} <input id="d-n" size="4" value="${c0.boxes || 10}"></p>` : '';
    dialog(_t('Plot properties'), rows + rangeRows + gridRow + own + animRows(plot), (d) => {
      if (!readAnim(d, plot)) return;
      const rs = [];
      for (let i = 0; i < dims; i++) {
        const lo = +d.querySelector(`#d-a${i}`).value; const hi = +d.querySelector(`#d-b${i}`).value;
        if (!(lo < hi)) { app.toast(_t('Ranges must go from small to large')); return; }
        rs.push([lo, hi]);
      }
      const g = d.querySelector('#d-g') ? Math.round(+d.querySelector('#d-g').value) : null;
      if (g != null && !(g >= 2)) { app.toast(_t('At least 2 grid lines')); return; }
      plot.curves.forEach((c, k) => {
        c.latex = d.querySelector(`#d-f${k}`).value.trim() || c.latex;
        [c.range, c.range2, c.range3] = [rs[0] || c.range, rs[1] || c.range2, rs[2] || c.range3];
        if (g) c.grid = c.grid.map((x, i) => (i < Math.max(dims, 2) ? (kind === 'tube' && i === 1 ? x : g) : x));
        if (kind === 'tube') c.radius = d.querySelector('#d-r').value.trim() || c.radius;
        if (kind === 'approx') { c.boxType = d.querySelector('#d-m').value; c.boxes = Math.max(1, Math.round(+d.querySelector('#d-n').value) || 10); }
      });
      if (!drawable(plot)) { app.toast(_t('This formula does not fit this kind of plot')); return; }
      plot.range = rs[0];
      const special = plotSpecial(plot, { width: a.texw || '3in', height: a.texh || '2in', path: a.path });
      const head = a.frame.slice(0, a.frame.indexOf('\\special'));
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...a, frame: head + special + '}', src: null }));
      app.forgetPicture(a.path);
      status(_t('Plotting…'));
      app.renderPlots().finally(() => status(''));
    });
  }
  // Properties of a 5.x-style plot: the window, and each function with its colour
  function plotProperties(pos, node) {
    const a = node.attrs;
    const plot = parsePlot(a.frame.slice(a.frame.indexOf('\\special')));
    if (!drawable(plot)) { app.toast(_t('opensw cannot draw this plot\'s formula, so it cannot be changed here')); return; }
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
    const colors = [['#ff0000', _t('Red')], ['#0000ff', _t('Blue')], ['#008000', _t('Green')], ['#000000', _t('Black')], ['#ff00ff', _t('Magenta')], ['#808080', _t('Gray')]];
    const colorSel = (k, cur) => (kind === 'surface' ? '' : `<select id="d-c${k}">${colors.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')}</select>`);
    const rows = plot.curves.map((c, k) => `<p>${_t('Function {0}', k + 1)} <input id="d-f${k}" size="26" value="${escHtml(c.latex)}"> ${colorSel(k, c.color)}</p>`).join('');
    const hint = kind === 'param' ? _t('e.g. (\\cos t, \\sin t)') : kind === 'polar' ? _t('e.g. 1+\\cos\\theta') : _t('e.g. \\cos x');
    dialog(_t('Plot properties'), `${rows}<p>${_t('Add function')} <input id="d-fnew" size="26" placeholder="${escHtml(_t('{0} (may be empty)', hint))}"></p>
      <p>${_t('{0} from', rect ? 'x' : escHtml(v1))} <input id="d-x0" size="5" value="${x0}"> ${_t('to')} <input id="d-x1" size="5" value="${x1}"></p>
      ${kind === 'polar' || kind === 'param' ? '' : `<p>${_t('{0} from', kind === 'surface' ? escHtml(v2) : 'y')} <input id="d-y0" size="5" value="${y0}"> ${_t('to')} <input id="d-y1" size="5" value="${y1}">${rect ? _t('(empty = automatic)') : ''}</p>`}
      ${rect ? `<p>${_t('Axis scale')} <select id="d-scale">${[['rect', _t('Normal')], ['log', _t('Logarithmic (y)')], ['loglog', _t('Log-log')]].map(([v, l]) => `<option value="${v}"${v === kind ? ' selected' : ''}>${l}</option>`).join('')}</select></p>` : ''}${animRows(plot)}`, (d) => {
      if (!readAnim(d, plot)) return;
      const num = (id) => { const v = d.querySelector(id)?.value.trim(); return v == null || v === '' ? null : +v; };
      const nx0 = num('#d-x0'); const nx1 = num('#d-x1'); const ny0 = num('#d-y0'); const ny1 = num('#d-y1');
      if (!(nx0 < nx1)) { app.toast(_t('Ranges must go from small to large')); return; }
      if (kind === 'surface' && !(ny0 < ny1)) { app.toast(_t('Ranges must go from small to large')); return; }
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
        if (plot.plottype !== 4 && ((ny0 != null && ny0 <= 0) || (plot.plottype === 21 && nx0 <= 0))) { app.toast(_t('A logarithmic range must be above 0')); return; }
        plot.view.x = [nx0, nx1];
        plot.view.y = ny0 != null && ny1 != null && ny0 < ny1 ? [ny0, ny1] : null;
      }
      const special = plotSpecial(plot, { width: a.texw || '3in', height: a.texh || '2in', path: a.path });
      // the frame keeps its own flags and size; its \special is the new one
      const head = a.frame.slice(0, a.frame.indexOf('\\special'));
      view.dispatch(view.state.tr.setNodeMarkup(pos, null, { ...a, frame: head + special + '}', src: null }));
      app.forgetPicture(a.path);
      status(_t('Plotting…'));
      app.renderPlots().finally(() => status(''));
    });
  }
  // Compute > Plot 2D > Rectangular: a plot of the formula, as 5.5 makes it (a frame
  // with the plot's settings, drawn by plots.js)
  let plotCount = 0;
  function plot2d() {
    const mv = currentMath();
    if (!mv) { app.toast(_t('Put the cursor in the formula to plot')); return; }
    mv.save();
    let f = mv.latex.trim();
    const eq = f.split(/(?<![<>\\])=/);
    if (eq.length > 1) f = eq[eq.length - 1].trim(); // y = f(x): draw the right side
    const v = (f.match(/(?<![\\a-zA-Z])([a-zA-Z])(?![a-zA-Z])/) || [])[1] || 'x';
    let path;
    const used = new Set();
    view.state.doc.descendants((n) => { if (n.type.name === 'image') used.add(n.attrs.path); });
    do path = `opensw-plot-${++plotCount}.wmf`; while (used.has(path));
    // the defaults of Compute > Settings (Plot Layout, 2D Plots, the Rectangular intervals)
    const s55 = plot55For(app.meta());
    const fr = frameOf(s55);
    const [a, b, n] = s55.intervals.rect[0];
    const p2 = s55.p2;
    const hex = p2.color.replace('#', '');
    const thick = { thin: 1, medium: 2, thick: 3 }[p2.thickness] || 1;
    const attr = { solid: 'Solid', dash: 'Dash', dot: 'Dots', dashdot: 'DashDot' }[p2.lineStyle] || 'Solid';
    const named = { ff0000: 'red', '000000': 'black', '0000ff': 'blue', '008000': 'green' }[hex];
    const special = `\\special{language "Scientific Word";type "MAPLEPLOT";width ${fr.texw};height ${fr.texh};depth ${fr.depth};display "USEDEF";plot_snapshots ${s55.behavior.snapshots ? 'TRUE' : 'FALSE'};`
      + `xmin "${a}";xmax "${b}";xviewmin "${a}";xviewmax "${b}";viewset"X";rangeset"X";plottype 4;axesstyle "${p2.axes}";numpoints 100;`
      + `var1name \\TEXUX{$${v}$};function \\TEXUX{$${f}$};${named ? `linecolor "${named}";` : ''}linestyle 1;linethickness ${thick};lineAttributes "${attr}";`
      + `var1range "${a},${b}";num-x-gridlines ${n};curveColor "[flat::RGB:0x00${hex}]";curveStyle "${p2.style === 'point' ? 'Point' : 'Line'}";`
      + `${p2.style === 'point' ? `pointStyle "${p2.marker}";` : ''}${p2.discontinuity ? `discAdjust ${p2.adjust === 'always' ? 'TRUE' : 'FALSE'};` : ''}valid_file "T";tempfilename '${path}';}`;
    const frame = `\\FRAME{${fr.flags}}{${fr.texw}}{${fr.texh}}{${fr.depth}}{}{}{Plot}{${special}}`;
    const node = schema.nodes.image.create({ path, width: fr.width, height: fr.height, texw: fr.texw, texh: fr.texh, place: fr.place, frame, name: 'Plot', plot: true });
    mv.exit(1);
    view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    view.focus();
    if (s55.behavior.dialogFirst) { propertiesFirst(path); return; }
    status(_t('Plotting… (the first time loads the computation engine, which takes a few seconds)'));
    app.renderPlots().finally(() => status(''));
  }
  // Plot Behavior, Display Plot Properties Dialog Before Plotting: the new plot's Properties first
  function propertiesFirst(path) {
    let at = null;
    view.state.doc.descendants((n, pos) => { if (at == null && n.type.name === 'image' && n.attrs.path === path) at = pos; });
    if (at != null) plotProperties(at, view.state.doc.nodeAt(at));
  }
  // the variables of a formula: single letters (not e, i) and Greek letters (not \pi)
  const varsOf = (f) => [...new Set([...f.matchAll(/\\(alpha|beta|gamma|theta|vartheta|phi|varphi|rho|psi|omega|tau|sigma|lambda|mu|xi|eta|zeta)(?![a-zA-Z])|(?<![\\a-zA-Z])([a-zA-Z])(?![a-zA-Z])/g)]
    .map((m) => (m[1] ? '\\' + m[1] : m[2])).filter((v) => v !== 'e' && v !== 'i'))];
  // Compute > Plot 2D / Plot 3D (except Plot 2D > Rectangular): a frame with the plot's
  // settings as 5.5 writes them (plots.js), drawn by plotdata.js
  function plotOther(kind, extra = {}) {
    const mv = extra.mv || currentMath();
    if (!mv) { app.toast(_t('Put the cursor in the formula to plot')); return; }
    mv.save();
    const whole = mv.latex.trim();
    let f = whole;
    const eq = f.split(/(?<![<>\\])=/);
    // r = f(θ), z = f(x, y): draw the right side (an implicit plot, an inequality and an ODE keep it all)
    if (eq.length > 1 && !['implicit', 'implicit3', 'ode'].includes(kind)) f = eq[eq.length - 1].trim();
    const parts = components(f).length;
    // Plot 2D/3D Animated: the animation parameter (t) is not one of the plot's variables
    const anim = extra.anim ? { ...ANIM_DEFAULT, range: [...ANIM_DEFAULT.range] } : null;
    const vs = varsOf(f).filter((v) => !anim || v !== anim.param).sort();
    const two = (d1, d2) => (vs.length >= 2 ? vs.slice(0, 2) : vs[0] === d2 ? [d1, d2] : [vs[0] || d1, d2]);
    const red = '#ff0000';
    const five = [-5, 5];
    const need = (ok, msg) => { if (!ok) app.toast(msg); return ok; };
    let plot;
    switch (kind) {
      case 'rect': { // (Plot 2D > Rectangular itself is plot2d)
        const v = vs.includes('x') ? 'x' : vs[0] || 'x';
        plot = { plottype: 4, axes: 'normal', variable: v, view: { x: five, y: null }, range: five, curves: [{ latex: f, color: red, width: 1, range: five, n: 100 }] };
        break;
      }
      case 'surface': {
        const [v1, v2] = two('x', 'y');
        if (!need(parts === 1 || parts === 3, _t('A 3D rectangular plot needs one formula f(x, y), or a parametric (x(s,t), y(s,t), z(s,t))'))) return;
        plot = { plottype: 5, axes: 'normal', variable: v1, variable2: v2, view: {}, curves: [{ latex: f, range: five, range2: five, grid: [25, 25] }] };
        break;
      }
      case 'polar': case 'param': {
        if (!need(kind === 'polar' || parts === 2, _t('Write a parametric curve as (x(t), y(t)), e.g. (\\cos t, \\sin t)'))) return;
        const v = /\\theta/.test(f) ? '\\theta' : vs.includes('t') ? 't' : vs[0] || 't';
        const range = kind === 'polar' ? [-3.1416, 3.1416] : [0, 6.2832];
        plot = { plottype: kind === 'polar' ? 8 : 19, axes: 'normal', variable: v, constrained: kind === 'polar', view: { x: null, y: null }, range,
          curves: [{ latex: f, color: red, width: 1, range, n: 200 }] };
        break;
      }
      case 'implicit': case 'inequality': {
        const rel = splitRelation(f)?.rel || '';
        if (kind === 'implicit' && !need(rel === '=', _t('Write an implicit plot as an equation, e.g. x^2+y^2=1'))) return;
        if (kind === 'inequality' && !need(/[<>]/.test(rel), _t('Write it as an inequality, e.g. x+y^2<5'))) return;
        const [v1, v2] = two('x', 'y');
        plot = { plottype: PLOTTYPE[kind], variable: v1, variable2: v2, view: {},
          curves: [{ latex: f, color: kind === 'implicit' ? red : '#000000', width: 1, range: five, range2: five, grid: kind === 'implicit' ? [24, 24] : [120, 120],
            ...(kind === 'inequality' ? { fill: '#ffcd99', fill2: '#ffffff' } : {}) }] };
        break;
      }
      case 'gradient': case 'vector': case 'conformal': {
        if (kind === 'vector' && !need(parts === 2, _t('Write a vector field as [P(x,y), Q(x,y)], e.g. [x+y, x-y]'))) return;
        if (kind !== 'vector' && !need(parts === 1, _t('Needs one formula'))) return;
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
        // y (or x, y) defined by Solve ODE > Numeric: drawn as a function from its initial point, as 5.5
        const starts = numericStarts();
        const names = whole.split(',').map((n) => n.trim());
        if (names.every((n) => starts.has(n))) {
          const x0 = starts.get(names[0]);
          const range = [x0, x0 + 5];
          plot = { plottype: 4, variable: 'x', view: {}, range,
            curves: names.map((n, k) => ({ latex: n, color: ['#ff0000', '#0000ff', '#008000', '#800080'][k % 4], width: 1, range, n: 200 })) };
          break;
        }
        const { equations, inits } = odeRows(whole);
        if (!need(equations.length && inits.length, _t('Type the equation and the initial value as a one-row matrix, e.g. y\'=\\sin(xy) and y(0)=3'))) return;
        const x0 = Number(inits[0][1]);
        const range = Number.isFinite(x0) ? [x0, x0 + 5] : [0, 5];
        const v = (whole.match(/\\frac\{d[a-zA-Z]\}\{d([a-zA-Z])\}/) || [])[1] || (inits[0][1].match(/^[a-zA-Z]$/) ? 't' : 'x');
        plot = { plottype: 23, variable: v, view: {}, range, curves: [{ latex: whole, color: red, width: 1, range, n: 200 }] };
        break;
      }
      case 'cylindrical': case 'spherical': {
        if (!need(parts === 1 || parts === 3, kind === 'cylindrical' ? _t('Write it as r = f(θ, z) or (r, θ, z)') : _t('Write it as ρ = f(θ, φ) or (ρ, θ, φ)'))) return;
        const cyl = kind === 'cylindrical';
        const [v1, v2] = cyl ? ['\\theta', 'z'] : ['\\theta', vs.includes('\\phi') ? '\\phi' : '\\varphi'];
        plot = { plottype: PLOTTYPE[kind], variable: v1, variable2: v2, variable3: cyl ? 'r' : '\\rho', constrained: !cyl, view: {},
          curves: [{ latex: f, range: [-3.1416, 3.1416], range2: cyl ? five : [0, 3.1416], grid: [25, 25] }] };
        break;
      }
      case 'implicit3': case 'gradient3': case 'vector3': {
        if (kind === 'implicit3' && !need(splitRelation(f)?.rel === '=', _t('Write it as an equation, e.g. x^2+y^2+z^2=9'))) return;
        if (kind === 'vector3' && !need(parts === 3, _t('Write it as [P, Q, R], e.g. [-y, x, z]'))) return;
        plot = { plottype: PLOTTYPE[kind], variable: 'x', variable2: 'y', variable3: 'z', view: {},
          curves: [{ latex: f, range: five, range2: five, range3: five, grid: kind === 'implicit3' ? [10, 10, 10] : [6, 6, 6] }] };
        break;
      }
      case 'tube': {
        if (!need(parts === 3, _t('Write a tube as (x(t), y(t), z(t)), e.g. (\\cos t, \\sin t, t/5)'))) return;
        const v = vs.includes('t') ? 't' : vs[0] || 't';
        plot = { plottype: 13, variable: v, view: {}, curves: [{ latex: f, radius: '0.2', range: [0, 6.2832], grid: [50, 8] }] };
        break;
      }
      default: return;
    }
    if (anim) plot.anim = anim;
    // the defaults of Compute > Settings (Plot Layout, 2D/3D Plots, the intervals and animation times)
    const s55 = plot55For(app.meta());
    applyPlot55(plot, kind, s55, { range: kind === 'approx' || kind === 'ode' });
    const fr = frameOf(s55);
    let path;
    const used = new Set();
    view.state.doc.descendants((n) => { if (n.type.name === 'image') used.add(n.attrs.path); });
    do path = `opensw-plot-${++plotCount}.wmf`; while (used.has(path));
    let special = plotSpecial(plot, { width: fr.texw, height: fr.texh, path });
    if (!s55.behavior.snapshots) special = special.replace('plot_snapshots TRUE;', 'plot_snapshots FALSE;');
    const frame = `\\FRAME{${fr.flags}}{${fr.texw}}{${fr.texh}}{${fr.depth}}{}{}{Plot}{${special}}`;
    const node = schema.nodes.image.create({ path, width: fr.width, height: fr.height, texw: fr.texw, texh: fr.texh, place: fr.place, frame, name: 'Plot', plot: true });
    mv.exit(1);
    view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    view.focus();
    if (s55.behavior.dialogFirst) { propertiesFirst(path); return; }
    status(_t('Plotting… (the first time loads the computation engine, which takes a few seconds)'));
    app.renderPlots().finally(() => status(''));
  }
  // Compute > Calculus > Plot Approximate Integral: the boxes of a Riemann sum under the curve
  function plotApproxIntegral() {
    const mv = currentMath();
    if (!mv) { app.toast(_t('Put the cursor in the formula to plot')); return; }
    dialog(_t('Plot approximate integral'), `<p>${_t('Method')} <select id="d-m">${[['left', _t('Left endpoints')], ['midpoint', _t('Midpoints')], ['right', _t('Right endpoints')], ['upper', _t('Upper sum')], ['lower', _t('Lower sum')],
      ['trapezoid', _t('Trapezoid')]].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></p>
      <p>${_t('Subintervals')} <input id="d-n" size="5" value="10"></p><p>${_t('From')} <input id="d-a" size="5" value="0"> ${_t('to')} <input id="d-b" size="5" value="1"></p>`, (d) => {
      const a = +field(d, '#d-a'); const b = +field(d, '#d-b'); const n = Math.round(+field(d, '#d-n'));
      if (!(a < b) || !(n >= 1)) { app.toast(_t('The interval must go from small to large, with at least 1 subinterval')); return; }
      plotOther('approx', { mv, range: [a, b], boxes: n, boxType: d.querySelector('#d-m').value });
    });
  }
  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      view.dispatch(view.state.tr.insertText(text).scrollIntoView());
    } catch (e) { app.toast(_t('Please press Ctrl+V to paste')); }
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
        if (!img) { app.toast(_t('This picture is not shown yet, so it cannot be copied')); return; }
        blob = await imagePng(img);
      } else { app.toast(_t('Put the cursor in a formula, or select a picture')); return; }
      await copyPng(blob);
      app.toast(_t('Copied as a picture; you can paste it into other programs'));
    } catch (e) { app.toast(_t('Could not copy: ') + (e.message || e)); }
  }
  // Edit > Paste Special: the clipboard's text as plain text, as LaTeX (formulas, sections ...),
  // or as one formula
  async function pasteSpecial() {
    let text;
    try { text = await navigator.clipboard.readText(); } catch (e) { app.toast(_t('Cannot read the clipboard; please press Ctrl+V to paste')); return; }
    dialog(_t('Paste special'), `<p><label><input type="radio" name="d-as" value="text" checked> ${_t('Plain text')}</label></p>
      <p><label><input type="radio" name="d-as" value="latex"> ${_t('LaTeX (formulas, section titles and so on read as LaTeX)')}</label></p>
      <p><label><input type="radio" name="d-as" value="math"> ${_t('One formula')}</label></p>`, (d) => {
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
    [_t('Constants/Speed of light')]: '$c=2.99792458\\times 10^{8}\\unit{m}\\unit{s}^{-1}$',
    [_t('Constants/Planck constant')]: '$h=6.62607015\\times 10^{-34}\\unit{J}\\unit{s}$',
    [_t('Constants/Elementary charge')]: '$e=1.602176634\\times 10^{-19}\\unit{C}$',
    [_t('Constants/Boltzmann constant')]: '$k=1.380649\\times 10^{-23}\\unit{J}\\unit{K}^{-1}$',
    [_t('Constants/Avogadro constant')]: '$N_{A}=6.02214076\\times 10^{23}\\unit{mol}^{-1}$',
    [_t('Constants/Gravitational constant')]: '$G=6.67430\\times 10^{-11}\\unit{m}^{3}\\unit{kg}^{-1}\\unit{s}^{-2}$',
    [_t('Constants/Electron mass')]: '$m_{e}=9.1093837015\\times 10^{-31}\\unit{kg}$',
    [_t('Constants/Proton mass')]: '$m_{p}=1.67262192369\\times 10^{-27}\\unit{kg}$',
  };
  const userFragments = () => { try { return JSON.parse(localStorage.getItem(FRAG_KEY) || '{}'); } catch (e) { return {}; } };
  const allFragments = () => ({ ...userFragments(), ...BUILTIN_FRAGMENTS });
  function storeFragments(f) {
    try { localStorage.setItem(FRAG_KEY, JSON.stringify(f)); } catch (e) { app.toast(_t('Cannot save fragments (the browser does not allow storage)')); }
    refreshFragmentList();
  }
  // the names in 5.5's order: your own first, then the folders (here: 常數), sorted
  const fragmentNames = () => Object.keys(allFragments()).sort((a, b) => (a.includes('/') - b.includes('/')) || a.localeCompare(b, 'zh-Hant'));
  function importFragment() {
    const names = fragmentNames();
    const mine = userFragments();
    dialog(_t('Import fragment'), `<p><select id="d-frag" size="12" style="min-width:22em">${names.map((n) => `<option value="${escHtml(n)}">${escHtml(n.includes('/') ? '　' + n.split('/').pop() + _t(' (') + n.split('/')[0] + _t(')') : n)}</option>`).join('')}</select></p>
      <p><button type="button" id="d-frag-del">${_t('Delete the selected fragment')}</button> <button type="button" id="d-frag-file">${_t('Add from a .frg file…')}</button></p>`, (d) => {
      const n = d.querySelector('#d-frag').value;
      if (n) insertLatex(allFragments()[n]);
    });
    const sel = $('#d-frag');
    if (sel.options.length) sel.selectedIndex = 0;
    sel.ondblclick = () => $('#dialog-ok').click();
    $('#d-frag-del').onclick = () => {
      const n = sel.value;
      if (!(n in mine)) { app.toast(_t('Built-in fragments cannot be deleted')); return; }
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
    if (!tex) { app.toast(_t('First select what to save as a fragment')); return; }
    dialog(_t('Save as fragment'), _t('<p>Fragment name <input id="d-name" size="24"></p>'), (d) => {
      const n = d.querySelector('#d-name').value.trim().replace(/[\\/]/g, '-');
      if (!n) { app.toast(_t('A name is needed')); return; }
      storeFragments({ ...userFragments(), [n]: tex });
      app.toast(_t('Saved as fragment "{0}"', n));
    });
  }
  // the Fragments toolbar: a list to insert from, and Save Fragment
  const fragSel = document.createElement('select');
  fragSel.id = 'frag-select';
  fragSel.title = _t('Fragments');
  function refreshFragmentList() {
    fragSel.replaceChildren(new Option(_t('Fragments…'), ''));
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
  const FORMULA_OPS = [['evaluate', _t('Compute')], ['numeric', _t('Numeric')], ['simplify', _t('Simplify')], ['expand', _t('Expand')], ['factor', _t('Factor')]];
  function insertFormula() {
    const mv = currentMath();
    if (mv) mv.save();
    dialog(_t('Exam formula (computed when the exams are made)'), `<p>${_t('Formula')} <input id="d-expr" size="30" placeholder="${_t('e.g. a x^2 + b x + c')}"></p>
      <p>${_t('Operation')} <select id="d-op">${FORMULA_OPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></p>`, (d) => {
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
      app.toast(_t('This document is not an exam template: it needs section titles such as "Exam" (or Quiz, Test) and "Question" (see Help > Getting started)'));
      return;
    }
    dialog(_t('Exam builder'), `<p>${_t('Number of versions')} <input id="d-n" size="4" value="1"></p>
      <p>${_t('Random seed')} <input id="d-seed" size="10" placeholder="${_t('empty = different every time')}"></p>
      <p><label><input id="d-key" type="checkbox" checked> ${_t('With answers')}</label></p>
      <p><label><input id="d-quiz" type="checkbox"> ${_t('Online quiz: one version as a web page (.html) to answer in a browser')}</label></p>`, async (d) => {
      const versions = Math.round(+d.querySelector('#d-n').value);
      if (!(versions >= 1 && versions <= 50)) { app.toast(_t('The number of versions must be 1 to 50')); return; }
      const sv = d.querySelector('#d-seed').value.trim();
      const seed = sv === '' ? null : Math.round(+sv) || 0;
      status(isEngineLoaded() ? _t('Making exams…') : _t('Making exams… (the first time loads the computation engine, which takes a few seconds)'));
      try {
        const template = view.state.doc;
        const name = app.meta().name || _t('Exam');
        if (d.querySelector('#d-quiz').checked) { // (before the template leaves the screen: its pictures go into the page)
          const key = [];
          const quizDoc = await buildExams(template, { seed, quiz: key });
          await app.saveQuizHtml(quizDoc, key, examSettings(template), name + _t('(online quiz)'));
        }
        const exams = await buildExams(template, { versions, seed, answers: d.querySelector('#d-key').checked });
        app.newDocument(exams, { name: name + _t('(generated exams)') }, { keepPictures: true });
        app.toast(_t('Made {0} exams (a new document; the template is still in the Window menu)', versions));
      } catch (err) { app.toast(_t('Could not make them: ') + (err.message || err)); } finally { status(''); }
    });
  }

  // Tools > Document Manager: the document's files; package them, or open a package (.zip, 5.5's .rap)
  function documentManager() {
    const files = app.docFiles();
    const rows = files.length ? files.map((f) => `<tr><td>${escHtml(f.kind)}</td><td>${escHtml(f.path)}</td><td>${f.found ? _t('Found') : _t('<b style="color:#c00000">Not found</b>')}</td></tr>`).join('')
      : _t('<tr><td colspan="3">(no pictures or subdocuments)</td></tr>');
    dialog(_t('Document manager'), `<p>${_t('Document: {0}{1}', escHtml(app.meta().name || _t('Untitled')), app.path() ? _t(' (') + escHtml(app.path()) + _t(')') : '')}</p>
      <table class="dm-files" style="font-size:.9em;border-collapse:collapse"><tr><th>${_t('Type')}</th><th>${_t('File')}</th><th>${_t('Status')}</th></tr>${rows}</table>
      <p><button type="button" id="d-pack">${_t('Pack as .zip (document + pictures, to give to others)')}</button></p>
      <p><button type="button" id="d-unpack">${_t('Open a package (.zip, 5.5 .rap)…')}</button></p>
      ${isDesktop && app.path() ? `<p><button type="button" id="d-copy">${_t('Copy…')}</button> <button type="button" id="d-rename">${_t('Rename…')}</button>
        <button type="button" id="d-delete">${_t('Delete…')}</button> <button type="button" id="d-clean">${_t('Clean up auxiliary files…')}</button></p>` : ''}`, () => {});
    for (const [id, f] of [['#d-copy', dmCopy], ['#d-rename', dmRename], ['#d-delete', dmDelete], ['#d-clean', dmCleanUp]]) {
      const b = $(id);
      if (b) b.onclick = () => { $('#dialog').hidden = true; f().catch((e) => app.toast(String(e.message || e))); };
    }
    $('#d-pack').onclick = () => { $('#dialog').hidden = true; app.packDoc().catch((e) => app.toast(_t('Could not pack: ') + (e.message || e))); };
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
  // Tools > Document Manager > Copy, Rename, Delete, Clean Up (5.5's), on the file as last saved:
  // the document and the pictures and subdocuments it names in its own folder (each can be left out)
  const sepOf = (p) => (p.includes('\\') ? '\\' : '/');
  const folderOf = (p) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')));
  const fileName = (p) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
  function besideFiles() { // -> [[path as the document names it, full path]]
    const s = sepOf(app.path());
    return app.docFiles().filter((f) => f.found && !/^([a-zA-Z]:|[\\/])|(^|[\\/])\.\.([\\/]|$)/.test(f.path))
      .map((f) => [f.path, folderOf(app.path()) + s + f.path.replace(/[\\/]/g, s)]);
  }
  const fileChecks = (list) => list.map(([name], i) => `<label><input type="checkbox" class="d-dm" data-i="${i}" checked> ${escHtml(name)}</label><br>`).join('');
  const safely = (f) => (d) => f(d).catch((e) => app.toast(String(e.message || e)));
  const checkedFiles = (d, list) => list.filter((_, i) => d.querySelector(`.d-dm[data-i="${i}"]`)?.checked);
  async function dmCopy() {
    const dk = await import('./desktop.js');
    const to = await dk.pickFolder();
    if (!to) return;
    const list = besideFiles();
    dialog(_t('Copy to {0}', to), `<p>${_t('Copies the document as last saved: {0}', escHtml(fileName(app.path())))}</p>${list.length ? `<p>${_t('With these files:')}</p>${fileChecks(list)}` : ''}`, safely(async (d) => {
      const s = sepOf(to);
      const items = [[fileName(app.path()), app.path()], ...checkedFiles(d, list)].map(([name, from]) => [from, to + s + name.replace(/[\\/]/g, s)]);
      const there = [];
      for (const [, t] of items) if (await dk.fileExists(t)) there.push(fileName(t));
      const go = async () => {
        for (const [f, t] of items) await dk.writeBytes(await dk.readPath(f), t);
        app.toast(_t('Copied {0} files to {1}', items.length, to));
      };
      if (!there.length) { await go(); return; }
      dialog(_t('Replace files?'), `<p>${_t('These are already there and will be replaced:')}</p><p>${there.map(escHtml).join('<br>')}</p>`, safely(go));
    }));
  }
  async function dmRename() {
    const dk = await import('./desktop.js');
    const old = app.path();
    const ext = (old.match(/\.[^.\\/]*$/) || [''])[0];
    dialog(_t('Rename the document'), `<p>${_t('New name')} <input id="d-name" size="28" value="${escHtml(fileName(old).slice(0, fileName(old).length - ext.length))}">${escHtml(ext)}</p>`, safely(async (d) => {
      const n = d.querySelector('#d-name').value.trim();
      if (!n || /[\\/:*?"<>|]/.test(n)) { app.toast(_t('A name without \\ / : * ? " < > |')); return; }
      const to = folderOf(old) + sepOf(old) + n + ext;
      if (to === old) return;
      await dk.renameFile(old, to);
      app.setPath(to);
      app.toast(_t('Renamed to {0}', fileName(to)));
    }));
  }
  async function dmDelete() {
    const dk = await import('./desktop.js');
    const list = besideFiles();
    dialog(_t('Delete the document'), `<p>${_t('Moves {0} to the Recycle Bin (it can be restored from there).', escHtml(fileName(app.path())))}</p>${list.length ? `<p>${_t('With these files:')}</p>${fileChecks(list)}` : ''}`, safely(async (d) => {
      await dk.trashFiles([app.path(), ...checkedFiles(d, list).map(([, p]) => p)]);
      app.setPath(null);
      app.toast(_t('Moved to the Recycle Bin. The document is still on screen: Save keeps it again'));
    }));
  }
  // the files TeX leaves beside a document (5.5's list: .aux, .bak, .bbl, .blg, .cdx, .dvi, .idx, .lof, .log, .lot, .toc)
  const AUXILIARY = ['aux', 'bak', 'bbl', 'blg', 'cdx', 'dvi', 'idx', 'lof', 'log', 'lot', 'toc'];
  async function dmCleanUp() {
    const dk = await import('./desktop.js');
    const base = app.path().replace(/\.[^.\\/]*$/, '');
    const list = [];
    for (const e of AUXILIARY) if (await dk.fileExists(base + '.' + e)) list.push([fileName(base) + '.' + e, base + '.' + e]);
    if (!list.length) { app.toast(_t('There are no auxiliary files to clean up')); return; }
    dialog(_t('Clean up auxiliary files'), `<p>${_t('Moves these to the Recycle Bin:')}</p>${fileChecks(list)}`, safely(async (d) => {
      const out = checkedFiles(d, list).map(([, p]) => p);
      if (out.length) await dk.trashFiles(out);
      app.toast(_t('Cleaned up {0} files', out.length));
    }));
  }
  // Tools > Automatic Substitution: in a formula, typing the keystrokes puts in the formula
  // (5.5: sum10 -> \sum_{n=1}^{10}); MathLive's own (alpha -> α ...) stay unless it is turned off
  function autoSubstitution() {
    const s = settings();
    const subs = { ...s.substitutions };
    const listHtml = () => Object.entries(subs).map(([k, v]) => `<option value="${escHtml(k)}">${escHtml(k)}　→　${escHtml(v)}</option>`).join('');
    dialog(_t('Automatic substitution (letters typed in a formula become a formula)'), `<p><label><input id="d-on" type="checkbox"${s.autoSub ? ' checked' : ''}> ${_t('Turn on automatic substitution')}</label></p>
      <p><select id="d-list" size="8" style="min-width:24em">${listHtml()}</select></p>
      <p>${_t('Keystrokes')} <input id="d-keys" size="10" placeholder="sum10"> ${_t('become')} <input id="d-latex" size="22" placeholder="\\sum_{n=1}^{10}"></p>
      <p><button type="button" id="d-sub-save">${_t('Save this one')}</button> <button type="button" id="d-sub-del">${_t('Delete the selected')}</button></p>`, (d) => {
      saveSettings({ ...settings(), autoSub: d.querySelector('#d-on').checked, substitutions: subs });
      app.toast(_t('Automatic substitution updated'));
    });
    const list = $('#d-list');
    list.onchange = () => { $('#d-keys').value = list.value; $('#d-latex').value = subs[list.value] || ''; };
    $('#d-sub-save').onclick = () => {
      const k = $('#d-keys').value.trim();
      const v = $('#d-latex').value.trim();
      if (!/^[A-Za-z0-9]+$/.test(k)) { app.toast(_t('Keystrokes can only be English letters and digits (case matters)')); return; }
      if (!v) { app.toast(_t('Write the formula to substitute (LaTeX)')); return; }
      subs[k] = v;
      list.innerHTML = listHtml();
      list.value = k;
    };
    $('#d-sub-del').onclick = () => { delete subs[list.value]; list.innerHTML = listHtml(); };
  }
  // Tools > User Setup: editing, the start-up document, files, formulas
  async function userSetup() {
    const s = settings();
    const aiHomeFolder = isDesktop ? await (await import('./desktop.js')).aiHome() : null;
    const opt = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    dialog(_t('User setup (this computer)'), `<p><b>${_t('Edit')}</b>　<label><input id="d-auto" type="checkbox"${s.autoSub ? ' checked' : ''}> ${_t('Automatic substitution in formulas')}</label></p>
      <p>${_t('Default matrix')} <input id="d-mr" size="2" value="${s.matrix[0]}"> ${_t('rows ×')} <input id="d-mc" size="2" value="${s.matrix[1]}"> ${_t('columns')}　
        ${_t('Default table')} <input id="d-tr" size="2" value="${s.table[0]}"> ${_t('rows ×')} <input id="d-tc" size="2" value="${s.table[1]}"> ${_t('columns')}</p>
      <p><b>${_t('Start document')}</b>　${_t('When the program opens')} <select id="d-start">${opt('last', _t('Continue the last document'), s.startup)}${opt('blank', _t('Blank document'), s.startup)}${opt('demo', _t('Getting started'), s.startup)}</select></p>
      <p><b>${_t('File')}</b>　<label><input id="d-bak" type="checkbox"${s.backup ? ' checked' : ''}> ${_t('Keep the old file as .bak before saving over it')}</label></p>
      <p><b>${_t('Math')}</b>　${_t('Formula color')} <select id="d-color">${opt('#c00000', _t('Red (5.5 default)'), s.mathColor)}${opt('#000000', _t('Black'), s.mathColor)}${opt('#1a4fa0', _t('Blue'), s.mathColor)}</select></p>
      <p><b>AI</b>　${_t('Folders where AI may open and save files (separate them with a semicolon; the open document\'s folder and {0} are always allowed)', escHtml(aiHomeFolder || _t('Documents\\opensw')))}<br>
        <input id="d-aifolders" size="56" value="${escHtml(s.aiFolders.join('; '))}" placeholder="${_t('e.g. D:\\Papers; D:\\Notes')}"></p>
      <p><b>${_t('Interface language')}</b>　<select id="d-lang">${opt('auto', _t('Same as the system'), s.lang)}${Object.entries(LANGUAGES).map(([v, l]) => opt(v, l, s.lang)).join('')}</select> ${_t('(takes effect when the program is opened again)')}</p>`, (d) => {
      const n = (id) => Math.round(+d.querySelector(id).value);
      const sizes = [n('#d-mr'), n('#d-mc'), n('#d-tr'), n('#d-tc')];
      if (sizes.some((x) => !(x >= 1 && x <= 20))) { app.toast(_t('Matrix and table sizes must be 1 to 20')); return; }
      saveSettings({ ...settings(), autoSub: d.querySelector('#d-auto').checked, matrix: sizes.slice(0, 2), table: sizes.slice(2),
        startup: d.querySelector('#d-start').value, backup: d.querySelector('#d-bak').checked, mathColor: d.querySelector('#d-color').value,
        lang: d.querySelector('#d-lang').value, aiFolders: d.querySelector('#d-aifolders').value.split(';').map((f) => f.trim()).filter(Boolean) });
      if (!lastMatrix) [$('#matrix-rows').value, $('#matrix-cols').value] = sizes.slice(0, 2);
      app.toast(_t('User setup saved'));
    });
  }
  // Tools > Export Settings: formulas in exported HTML, the size of copied pictures
  function exportSettings() {
    const s = settings();
    const opt = (v, l, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`;
    dialog(_t('Export settings'), `<p>${_t('Formulas in exported HTML')} <select id="d-hm">${opt('mathml', _t('MathML (drawn by the browser, no internet needed)'), s.htmlMath)}${opt('mathjax', _t('LaTeX + MathJax (needs internet when the page is opened)'), s.htmlMath)}</select></p>
      <p>${_t('Resolution of Copy as Picture')} <select id="d-scale">${[1, 2, 3, 4].map((k) => opt(k, _t('{0}×', k), s.pictureScale)).join('')}</select></p>`, (d) => {
      saveSettings({ ...settings(), htmlMath: d.querySelector('#d-hm').value, pictureScale: +d.querySelector('#d-scale').value });
      app.toast(_t('Export settings saved'));
    });
  }

  // File > Open Location: a 5.x or .sci document on the web opens here (5.5: "address as .tex"
  // opens one without that ending); other addresses open in the browser
  function openLocation() {
    const urls = app.recentUrls();
    dialog(_t('Open location'), `<p>${_t('URL')} <input id="d-url" size="40" list="d-urls" placeholder="${_t('https://…/document.tex')}"></p>
      <datalist id="d-urls">${urls.map((u) => `<option value="${escHtml(u)}">`).join('')}</datalist>
      <p style="font-size:.9em;color:#555">${_t('.tex and .sci open here; other addresses open in the browser. Add " as .tex" after an address to open a file without a .tex ending as a document.')}</p>`,
    (d) => { const u = d.querySelector('#d-url').value.trim(); if (u) app.openUrl(u); });
  }
  // File > Page Setup: margins, header, footer and page number for File > Preview
  function pageSetupDialog() {
    const p = app.pageSetup();
    const opt = (v, l, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    dialog(_t('Page setup (for preview and printing; typesetting PDF is not affected)'), `<p>${_t('Margins (inches) top')} <input id="d-t" size="4" value="${p.top}"> ${_t('bottom')} <input id="d-b" size="4" value="${p.bottom}">
      ${_t('left')} <input id="d-l" size="4" value="${p.left}"> ${_t('right')} <input id="d-r" size="4" value="${p.right}"></p>
      <p>${_t('Header')} <input id="d-head" size="30" value="${escHtml(p.header)}"></p><p>${_t('Footer')} <input id="d-foot" size="30" value="${escHtml(p.footer)}"></p>
      <p>${_t('page')} <select id="d-num">${[['none', _t('Hidden')], ['top-left', _t('Header left')], ['top-center', _t('Header center')], ['top-right', _t('Header right')], ['bottom-left', _t('Footer left')],
        ['bottom-center', _t('Footer center')], ['bottom-right', _t('Footer right')]].map(([v, l]) => opt(v, l, p.number)).join('')}</select>
      ${_t('Style')} <select id="d-style">${[['decimal', '1, 2, 3'], ['lower-roman', 'i, ii, iii'], ['upper-roman', 'I, II, III'], ['lower-alpha', 'a, b, c'],
        ['upper-alpha', 'A, B, C']].map(([v, l]) => opt(v, l, p.style)).join('')}</select></p>`, (d) => {
      const m = ['#d-t', '#d-b', '#d-l', '#d-r'].map((id) => +d.querySelector(id).value);
      if (m.some((x) => !(x >= 0 && x < 4))) { app.toast(_t('Margins must be 0 to 4 inches')); return; }
      app.setPageSetup({ top: m[0], bottom: m[1], left: m[2], right: m[3], header: d.querySelector('#d-head').value, footer: d.querySelector('#d-foot').value,
        number: d.querySelector('#d-num').value, style: d.querySelector('#d-style').value });
      app.toast(_t('Page setup saved (used for all documents on this computer)'));
    });
  }

  // ---------- Compute menu (SymPy) ----------
  let computing = false;
  async function runCompute(op, params, mv0) {
    const mv = mv0 || currentMath();
    if (!mv) { app.toast(_t('Put the cursor in a formula to compute')); return; }
    if (computing) return;
    computing = true;
    mv.save();
    status(isEngineLoaded() ? _t('Computing…') : _t('Computing… (the first time loads the computation engine, which takes a few seconds)'));
    try {
      const r = await compute(op, mv.latex, params);
      if (op === 'define') {
        status(''); app.toast(_t('Defined: later computations will use it'));
        if (plot55For(app.meta()).behavior.recompute) app.redrawPlots?.(); // Compute > Settings > Plot Behavior
        return;
      }
      if (r.kind === 'value') {
        mv.enter(false);
        mv.mf.insert(' = ' + r.latex, { format: 'latex', selectionMode: 'after' });
        mv.changed();
      } else {
        // the answer is text after the formula: "，解為：x=1、x=2" / "（成立）"
        mv.exit(1);
        const { tr } = view.state;
        const nodes = [];
        if (r.kind === 'boolean') nodes.push(schema.text(r.value ? _t(' (true)') : _t(' (false)')));
        else if (r.kind === 'text') nodes.push(schema.text(r.text));
        else if (!r.solutions.length) nodes.push(schema.text(_t(', no solution')));
        else {
          nodes.push(schema.text(r.label || _t(', solution: ')));
          r.solutions.forEach((s, i) => {
            if (i) nodes.push(schema.text(_t('; ')));
            nodes.push(schema.nodes.math_inline.create({ latex: s }));
          });
        }
        view.dispatch(tr.insert(view.state.selection.from, nodes).scrollIntoView());
      }
      status('');
    } catch (e) {
      app.toast(_t('Could not compute: ') + e.message);
      status('');
    } finally { computing = false; }
  }
  // Insert > Unit Name: 5.x writes units as \unit{..} (upright, a thin space before)
  const UNITS = [[_t('meter m'), 'm'], [_t('centimeter cm'), 'cm'], [_t('kilometer km'), 'km'], [_t('second s'), 's'], [_t('minute min'), 'min'], [_t('hour h'), 'h'], [_t('gram g'), 'g'],
    [_t('kilogram kg'), 'kg'], [_t('newton N'), 'N'], [_t('joule J'), 'J'], [_t('watt W'), 'W'], [_t('pascal Pa'), 'Pa'], [_t('hertz Hz'), 'Hz'], [_t('ampere A'), 'A'],
    [_t('volt V'), 'V'], [_t('ohm Ω'), '\\Omega'], [_t('kelvin K'), 'K'], [_t('mole mol'), 'mol'], [_t('liter L'), 'L']];
  // operations that ask for more than the formula (5.5 asks in a dialog too)
  function askCompute(op, title, fields, read) {
    const mv = currentMath();
    if (!mv) { app.toast(_t('Put the cursor in a formula to compute')); return; }
    dialog(title, fields, (d) => {
      const params = read(d);
      if (params) runCompute(op, params, mv);
    });
  }
  const field = (d, id) => d.querySelector(id).value.trim();
  const byParts = () => askCompute('byparts', _t('Integrate by parts'), _t('<p>Part to differentiate, u <input id="d-u" size="20" placeholder="e.g. x"></p>'),
    (d) => (field(d, '#d-u') ? [field(d, '#d-u')] : null));
  const changeVariable = () => askCompute('changevar', _t('Change variable'), _t('<p>Substitution <input id="d-u" size="24" placeholder="u = x^2-1 or x = \\sin u"></p>'),
    (d) => (field(d, '#d-u') ? [field(d, '#d-u')] : null));
  const approxIntegral = () => askCompute('approxint', _t('Approximate integral'), `<p>${_t('Method')} <select id="d-m">${[['left', _t('Left endpoints')], ['midpoint', _t('Midpoints')], ['right', _t('Right endpoints')],
    ['trapezoid', _t('Trapezoid')], ['simpson', 'Simpson']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></p>
    <p>${_t('Subintervals')} <input id="d-n" size="5" value="10"></p>`, (d) => [`'${d.querySelector('#d-m').value}'`, field(d, '#d-n') || '10']);
  const iterateDialog = () => askCompute('iterate', _t('Iterate'), _t('<p>Starting value <input id="d-x0" size="8" value="1"></p><p>Steps <input id="d-n" size="5" value="5"></p>'),
    (d) => [field(d, '#d-x0') || '0', field(d, '#d-n') || '5']);
  // What 5.5 asks before some operations: the variable, the order, the unknowns (params, see ENGINE.md)
  const guessVariable = (vars) => ['x', 't', 's', 'z', 'y'].find((v) => vars.includes(v)) || vars[0] || 'x';
  const varField = (vars, cur) => `<input id="d-v" size="8" value="${escHtml(cur)}" list="d-vars"><datalist id="d-vars">${vars.map((v) => `<option value="${escHtml(v)}">`).join('')}</datalist>`;
  async function seriesDialog() {
    const mv = currentMath();
    if (!mv) { app.toast(_t('Put the cursor in a formula to compute')); return; }
    const { variables } = await formulaInfo(mv.latex).catch(() => ({ variables: [] }));
    askCompute('series', _t('Power series'), `<p>${_t('Expand in powers of')} ${varField(variables, guessVariable(variables))} ${_t('about')} <input id="d-a" size="5" value="0"></p>
      <p>${_t('Number of terms')} <input id="d-n" size="4" value="5"></p>`, (d) => [field(d, '#d-v') || 'x', field(d, '#d-n') || '5', field(d, '#d-a') || '0']);
  }
  // 5.5 asks the differentiation variable; the other letters are functions of it
  async function implicitDialog() {
    const mv = currentMath();
    if (!mv) { app.toast(_t('Put the cursor in a formula to compute')); return; }
    const { variables } = await formulaInfo(mv.latex).catch(() => ({ variables: [] }));
    askCompute('implicitdiff', _t('Implicit differentiation'), `<p>${_t('Differentiation variable')} ${varField(variables, guessVariable(variables))}</p>`,
      (d) => [field(d, '#d-v') || 'x']);
  }
  async function padeDialog() {
    const mv = currentMath();
    if (!mv) { app.toast(_t('Put the cursor in a formula to compute')); return; }
    const { variables } = await formulaInfo(mv.latex).catch(() => ({ variables: [] }));
    askCompute('pade', _t('Padé approximant'), `<p>${_t('Degree of the numerator m')} <input id="d-m" size="3" value="2">　${_t('Degree of the denominator n')} <input id="d-n" size="3" value="2"></p>
      <p>${_t('Variable')} ${varField(variables, guessVariable(variables))} ${_t('about')} <input id="d-a" size="5" value="0"></p>`,
    (d) => [field(d, '#d-m') || '2', field(d, '#d-n') || '2', field(d, '#d-v') || 'x', field(d, '#d-a') || '0']);
  }
  // Differentiate, Integrate: with more than one variable, which one
  async function calculusOp(op, title) {
    const mv = currentMath();
    if (!mv) { app.toast(_t('Put the cursor in a formula to compute')); return; }
    const { variables } = await formulaInfo(mv.latex).catch(() => ({ variables: [] }));
    if (variables.length < 2) { runCompute(op, undefined, mv); return; }
    askCompute(op, title, `<p>${_t('Variable')} ${varField(variables, guessVariable(variables))}</p>`, (d) => [field(d, '#d-v') || 'x']);
  }
  // Solve: more unknowns than equations -> which to solve for
  async function solveOp(op) {
    const mv = currentMath();
    if (!mv) { app.toast(_t('Put the cursor in a formula to compute')); return; }
    const { variables, equations } = await formulaInfo(mv.latex).catch(() => ({ variables: [], equations: 1 }));
    if (variables.length <= equations) { runCompute(op, undefined, mv); return; }
    askCompute(op, _t('Solve for'), `<p>${_t('Unknowns (separated by commas)')} <input id="d-u" size="24" value="${escHtml(variables.slice(0, equations).join(', '))}"></p>
      <p>${_t('Variables: {0}', escHtml(variables.join(', ')))}</p>`, (d) => {
      const u = field(d, '#d-u').split(',').map((x) => x.trim()).filter(Boolean);
      return u.length ? u : null;
    });
  }
  // Vector Calculus and ∇ work in the basis variables (x, y, z unless set otherwise), a setting
  const basis = () => settings().basis;
  function readBasis(text) {
    const v = text.split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z]$/.test(x));
    if (!v.length) app.toast(_t('Write single letters such as x, y, z'));
    return v.length ? v : null;
  }
  function setBasis() {
    dialog(_t('Set basis variables'), `<p>${_t('Variables (separated by commas)')} <input id="d-b" size="16" value="${escHtml(basis().join(', '))}"></p>`, (d) => {
      const v = readBasis(field(d, '#d-b'));
      if (!v) return;
      saveSettings({ ...settings(), basis: v });
      app.toast(_t('Basis variables: ') + v.join(', '));
    });
  }
  // Compute > Matrices, as 5.5 lists them
  const MATRICES55 = [[_t('Adjugate'), 'adjugate'], [_t('Characteristic Polynomial'), 'charpoly'], [_t('Cholesky Decomposition'), 'cholesky'], [_t('Column Basis'), 'colbasis'],
    [_t('Concatenate'), 'concat'], [_t('Condition Number'), 'condition'], [_t('Definiteness Tests'), 'definiteness'], [_t('Determinant'), 'determinant'], [_t('Eigenvalues'), 'eigenvalues'],
    [_t('Eigenvectors'), 'eigenvectors'], [_t('Fill Matrix...'), 'fillmatrix'], [_t('Fraction-Free Gaussian Elimination'), 'ffgauss'], [_t('Gaussian Elimination'), 'gauss'],
    [_t('Hermite Normal Form'), 'hermite'], [_t('Hermitian Transpose'), 'htranspose'], [_t('Inverse'), 'inverse'], [_t('Jordan Form'), 'jordan'], [_t('Minimum Polynomial'), 'minpoly'],
    [_t('Norm'), 'norm'], [_t('Nullspace Basis'), 'nullspace'], [_t('Orthogonality Test'), 'orthogonal'], [_t('Permanent'), 'permanent'], [_t('PLU Decomposition'), 'plu'],
    [_t('QR Decomposition'), 'qr'], [_t('Random Matrix...'), 'randommatrix'], [_t('Rank'), 'rank'], [_t('Rational Canonical Form'), 'rationalcanonical'], [_t('Reduced Row Echelon Form'), 'rref'],
    [_t('Reshape...'), 'reshape'], [_t('Row Basis'), 'rowbasis'], [_t('Singular Values'), 'singularvalues'], [_t('Smith Normal Form'), 'smith'], [_t('Spectral Radius'), 'spectralradius'],
    [_t('Stack'), 'stack'], [_t('SVD'), 'svd'], [_t('Trace'), 'trace'], [_t('Transpose'), 'transpose']];
  // an item of src/c55*.js (a dialog first, a picture ...) or else compute the formula with op
  const ctx55 = () => ({ app, _t, dialog, askCompute, runCompute, currentMath, formulaInfo, varField, guessVariable, field, escHtml, settings, saveSettings,
    plotOther, plot2d, plotApproxIntegral, definitions, engineInfo, status, toast: (t) => app.toast(t) });
  const act55 = (op, otherwise) => () => (ACTIONS55[op] ? ACTIONS55[op](ctx55()) : otherwise ? otherwise() : runCompute(op));
  setTimeout(() => ACTIONS55.__init?.(ctx55())); // the parts' own setup (src/c55_defsmisc.js: Compute > Settings, definitions kept with a document)
  const VECTOR_OPS = new Set(['gradient', 'divergence', 'curl', 'laplacian', 'hessian', 'jacobian', 'wronskian', 'potential', 'vectorpotential']);
  const computeAction = (op) => (typeof op === 'function' ? op : () => runCompute(op, VECTOR_OPS.has(op) ? basis() : undefined));
  // Compute > Definitions: x = 3 or f(x) = x^2 is used by every later computation
  async function definitions(op) {
    if (op === 'define') {
      // a_i = ..: 5.5's Interpret Subscript asks whether i is a function argument (a_2 then has a value) or
      // part of the name; checked first: an argument when i is on the right
      const mv = currentMath();
      const m = mv?.latex.match(/^\s*[A-Za-z]\s*_\s*(?:\{\s*([A-Za-z])\s*\}|([A-Za-z]))\s*:?=/);
      if (!m) { await runCompute('define'); return; }
      const arg = new RegExp(`(?<![\\\\A-Za-z])${m[1] || m[2]}(?![A-Za-z])`).test(mv.latex.slice(m[0].length));
      const radio = (v, label, on) => `<p><label><input type="radio" name="d-sub" value="${v}"${on ? ' checked' : ''}> ${label}</label></p>`;
      dialog(_t('Interpret subscript'), radio('argument', _t('A function argument'), arg) + radio('name', _t('Part of the name'), !arg),
        (d) => runCompute('define', [`'${d.querySelector('input[name="d-sub"]:checked').value}'`], mv));
      return;
    }
    try {
      const r = await compute(op, '0');
      if (op === 'cleardefs') { app.toast(_t('All definitions cleared')); if (plot55For(app.meta()).behavior.recompute) app.redrawPlots?.(); }
      else app.toast(r.solutions.length ? _t('Current definitions: ') + r.solutions.join(_t('; ')) : _t('No definitions yet'));
    } catch (e) { app.toast(e.message); }
  }
  app.compute = runCompute;

  // View: what the page shows besides the text (5.5's View menu); remembered between sessions
  const VIEW_TOGGLES = [['markers', _t('Marker')], ['index', _t('Index entry')], ['helpers', _t('Helper lines (table grid, environment boxes)')], ['texfields', _t('TeX field')]];
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
  // Tools > Computation Engine: SymPy (built in) or an engine on this computer (desktop app;
  // engine/engines.json, e.g. Mathematica). Choosing loads the engine and shows its version.
  // In the desktop app SymPy is run by the Python that comes with it (the engine "python";
  // in Pyodide when that cannot be started: the dialog then says so), or by another Python.
  async function engineInfo() {
    const s = settings();
    const list = isDesktop ? await (await import('./desktop.js')).engineList().catch(() => []) : [];
    const radio = (v, label, off) => `<p><label><input type="radio" name="d-eng" value="${v}"${s.engine === v ? ' checked' : ''}${off ? ' disabled' : ''}> ${label}</label></p>`;
    const location = (e, label) => `<p style="margin-left:2em">${label}<br><input data-eng="${escHtml(e.id)}" size="46"
        value="${escHtml(s.enginePrograms[e.id] || '')}" placeholder="${escHtml(e.example ? _t('e.g. {0}', e.example) : '')}"></p>`;
    const python = list.filter((e) => e.id === 'python').map((e) => location(e, _t('Python location (empty: the one that comes with opensw)'))
      + (pythonProblem() ? `<p style="margin-left:2em">${escHtml(pythonProblem())}</p>` : '')).join('');
    const outside = list.filter((e) => e.id !== 'python').map((e) => radio(escHtml(e.id), _t('{0} (must be installed on this computer)', escHtml(e.name)))
      + location(e, _t('Program location (empty: found automatically)'))).join('');
    dialog(_t('Computation engine'), `${radio('sympy', isDesktop ? _t('SymPy (built in, no internet needed)') : _t('SymPy (built in, runs in Pyodide, no internet needed)'))}
      ${isDesktop ? python + outside : radio('mathematica', _t('Mathematica (desktop app only)'), true)}
      <p>${_t('With another engine chosen, the Compute menu, plots and the Exam Builder use it first, and SymPy for what it cannot do. The first computation waits a few seconds for it to load.')}</p>
      <p><label><input id="d-pv" type="checkbox"${s.solvePrincipal ? ' checked' : ''}> ${_t('Solve: principal value only (one solution, not every solution)')}</label></p>
      <p><label><input id="d-log" type="checkbox"${s.logBase10 ? ' checked' : ''}> ${_t('Base for log function: change from e to 10 (log x is the logarithm to base 10)')}</label></p>
      <p>${_t('Basis variables (vector calculus, separated by commas)')} <input id="d-b" size="12" value="${escHtml(s.basis.join(', '))}"></p>`, async (d) => {
      const engine = d.querySelector('input[name="d-eng"]:checked')?.value || 'sympy';
      const solvePrincipal = d.querySelector('#d-pv').checked;
      const logBase10 = d.querySelector('#d-log').checked;
      const basis = readBasis(field(d, '#d-b'));
      if (!basis) return;
      const enginePrograms = { ...s.enginePrograms };
      for (const i of d.querySelectorAll('input[data-eng]')) enginePrograms[i.dataset.eng] = i.value.trim();
      saveSettings({ ...settings(), engine, enginePrograms, solvePrincipal, logBase10, basis });
      status(_t('Loading the computation engine…'));
      try {
        const r = await compute('version', '0');
        app.toast(pythonProblem() || _t('Computation engine: ') + r.solutions.join(_t(', ')));
      } catch (e) { app.toast(e.message); } finally { status(''); }
    });
  }
  // Tools > Connect AI: adds opensw to the Claude / ChatGPT desktop app's settings on this computer
  // (src-tauri/src/aiconnect.rs), for someone who has never set up an AI tool
  async function connectAi() {
    if (!isDesktop) { dialog(_t('Connect AI'), `<p>${_t('Connecting an AI app is done in the desktop app.')}</p>`, () => {}); return; }
    const { aiApps, aiConnect } = await import('./desktop.js');
    const apps = await aiApps().catch(() => []);
    const state = (a) => (a.connected ? _t('connected') : a.found ? _t('not connected yet') : _t('not on this computer'));
    const row = (a) => `<p><label><input type="checkbox" data-ai="${escHtml(a.id)}"${!a.found ? ' disabled' : a.connected ? '' : ' checked'}> <b>${escHtml(a.name)}</b></label>: ${state(a)}</p>`;
    dialog(_t('Connect AI'), `<p>${_t('Lets the AI app on this computer read and change the document open in opensw. Tick the apps to connect and press OK.')}</p>
      ${apps.map(row).join('')}
      <p>${_t('Their settings files only get opensw added; a copy of each is kept first (.opensw-backup).')}</p>
      <p>${_t('AI can open and save only in the open document\'s folder, Documents\\opensw and the folders allowed in Tools > User Setup; anywhere else you are asked. What it changes is tinted, and Edit > Undo AI Changes takes it back.')}</p>`, async (d) => {
      const ids = [...d.querySelectorAll('input[data-ai]:checked')].map((i) => i.dataset.ai);
      if (!ids.length) return;
      try {
        for (const id of ids) await aiConnect(id);
        const names = apps.filter((a) => ids.includes(a.id)).map((a) => a.name).join(_t(', '));
        dialog(_t('Connect AI'), `<p>${escHtml(_t('Connected: {0}.', names))}</p>
          <p>${_t('Quit the AI app completely and open it again (on Windows, also quit it from its icon next to the clock). Then try, for example:')}</p>
          <p><i>${escHtml(AI_EXAMPLES[0])}</i></p><p>${_t('Help > Talking to AI has more examples.')}</p>`, () => {});
      } catch (e) { app.toast(_t('Could not connect: ') + (e.message || e)); }
    });
  }
  // Help > Talking to AI: what one can ask, for people new to AI
  const AI_EXAMPLES = [
    _t('Read the document open in opensw and tell me what it is about.'),
    _t('Fix the typos in this document, but do not change the formulas.'),
    _t('After section 2, add the mean value theorem with a proof.'),
    _t('Compute the integral in the third formula and write the answer after it.'),
    _t('Add five exercises like problem 3 at the end, with answers.'),
    _t('Open hw3.tex in the same folder, check every computation and tell me which are wrong.'),
    _t('Save this document as hw4.tex in the same folder and typeset it.'),
    _t('Undo everything you just changed.'),
  ];
  function talkingToAi() {
    dialog(_t('Talking to AI'), `<p>${_t('Once an AI app is connected (Tools > Connect AI), ask it in your own words, in English or Chinese. For example:')}</p>
      <ul>${AI_EXAMPLES.map((t) => `<li>${escHtml(t)}</li>`).join('')}</ul>
      <p>${_t('While the AI works, the status bar says so, and what it changed is tinted. Edit > Undo AI Changes (or the button in the status bar) puts the document back as it was, in one step.')}</p>
      <p>${_t('The AI works on the document open in opensw. It can save only in the document\'s folder, Documents\\opensw and the folders you allowed.')}</p>`, () => {});
  }
  // Compute > Check with Lean: Lean 4 proves the equation at the cursor (over the real
  // numbers) or says it could not. Needs Lean with Mathlib on the computer.
  const LEAN_KEY = 'opensw-lean-project';
  function leanSettings(then) {
    const now = localStorage.getItem(LEAN_KEY) || '';
    dialog(_t('Lean setup'), `<p>${_t('Lean project folder (a Lake project with Mathlib, containing a lakefile):')}</p>
      <p><input id="d-lean" size="40" value="${escHtml(now)}" placeholder="${_t('e.g. D:\\lean\\myproof')}"></p>`, (d) => {
      const v = d.querySelector('#d-lean').value.trim();
      try { localStorage.setItem(LEAN_KEY, v); } catch (e) { /* storage off */ }
      if (v && then) then();
    });
  }
  async function leanCheckFormula() {
    const mv = currentMath();
    if (!mv) { app.toast(_t('Put the cursor in an equation to check')); return; }
    mv.save();
    let thm;
    try { thm = leanTheorem(await formulaJson(mv.latex), mv.latex); } catch (e) { app.toast(_t('Cannot check with Lean: ') + e.message); return; }
    const shown = `<pre class="lean-code">${escHtml(thm.statement)}</pre>`;
    if (!isDesktop) { dialog(_t('Check with Lean'), `<p>${_t('Lean runs only in the desktop app. The statement to check:')}</p>${shown}`, () => {}); return; }
    const project = localStorage.getItem(LEAN_KEY);
    if (!project) { leanSettings(leanCheckFormula); return; }
    status(_t('Checking with Lean… (the first time loads Mathlib, which may take a few minutes)'));
    try {
      const [ok, out] = await leanCheck(project, thm.code);
      const v = leanVerdict(out, ok);
      dialog(_t('Check with Lean'), `<p>${v.ok ? '✓ ' : ''}${escHtml(v.message)}</p><p>${_t('The statement checked (x, y and so on are any real numbers):')}</p>${shown}`, () => {});
    } catch (e) { app.toast(String(e.message || e)); } finally { status(''); }
  }
  // Typeset > Options: the document class of a document not from 5.x
  function typesetOptions() {
    const meta = app.meta();
    if (meta.preamble55) { app.toast(_t('A 5.x document\'s class is in its preamble: change it with Typeset > Preamble…')); return; }
    const opt = (v) => `<option${(meta.documentclass || 'article') === v ? ' selected' : ''}>${v}</option>`;
    dialog(_t('Typeset options'), `<p>${_t('Document class')} <select id="d-class">${['article', 'report', 'book', 'amsart', 'amsbook'].map(opt).join('')}</select></p>`, (d) => {
      app.setMeta({ ...meta, documentclass: d.querySelector('#d-class').value });
      app.toast(_t('Document class changed to ') + d.querySelector('#d-class').value);
    });
  }

  // ---------- menus ----------
  // [label, shortcut, action] ; '-' = separator ; [label, null, [submenu...]]
  const sym = (list) => list.map(([s, l]) => [s, null, () => mathInsert(l)]);
  // Help > Contents: the manual
  const openManual = () => app.openManual(MANUAL, { name: _t('opensw manual') });
  // the items of 5.5's menus (other than Compute) that need more than a line here: src/menus55.js
  const m55 = setupMenus55({ app, view, dialog, escHtml, currentMath, mathInsert, mathAction, space, markerKeys, markerPos, jumpTo, followLink,
    history: () => ({ back: goneBack, forward: goneForward }), goHistory, functionKey: (code) => functionKey(code), ALL_TAGS, stripComments,
    OPERATORS, BRACKETS, NAMES, DECORATIONS, UNITS, applyView, applyLooks, openManual,
    findText: (q) => { $('#find-text').value = q; findNext(); } });
  const MENUS = [
    // 5.5's menus in its order and words (sw550ENUS.dll menu 10); what opensw adds comes after a line at the end
    [_t('File'), [
      [_t('New...'), null, app.newDoc], [_t('Open...'), 'Ctrl+O', app.open], [_t('Open Location...'), null, openLocation], [_t('Close'), 'Ctrl+F4', app.closeDoc], '-',
      [_t('Save'), null, app.save], [_t('Save As...'), null, app.saveAs], [_t('Save All'), null, app.saveAll], [_t('Export Document...'), null, m55.exportDocument], '-',
      [_t('Import Fragment...'), null, importFragment], [_t('Import Picture...'), null, app.importPicture], [_t('Import Contents...'), null, app.importContents], [_t('Import Non-SWP/SW LaTeX...'), null, app.open], '-',
      [_t('Save Fragment...'), null, saveFragment], [_t('Export as Picture...'), null, m55.exportPicture], '-',
      [_t('Document Info...'), null, m55.documentInfo], [_t('Style...'), null, m55.styleDialog], '-',
      [_t('Page Setup...'), null, pageSetupDialog], [_t('Preview...'), null, m55.previewWindow], [_t('Print...'), null, app.preview], '-',
      [_t('Recent File'), null, app.recent], '-',
      [_t('Exit'), 'Alt+F4', app.exit], '-',
      [_t('Save as .sci…'), null, app.saveAsSci], [_t('Export LaTeX…'), null, app.exportLatex], [_t('Export HTML…'), null, app.exportHtml], [_t('Export Word (.docx)…'), null, app.exportDocx], [_t('Export for AI (Markdown)…'), null, app.exportMd],
      [_t('Samples'), null, app.samples.map(([id, label]) => [label, null, () => app.openSample(id)])], [_t('Typeset PDF'), 'Ctrl+P', app.pdf],
    ]],
    [_t('Edit'), [
      [_t('Undo'), 'Ctrl+Z', () => run(undo)], [_t('Properties...'), 'Ctrl+F5', properties], '-',
      [_t('Cut'), 'Ctrl+X', () => document.execCommand('cut')], [_t('Copy'), 'Ctrl+C', () => document.execCommand('copy')], [_t('Paste'), 'Ctrl+V', paste], [_t('Paste Special...'), null, pasteSpecial], '-',
      [_t('Delete'), 'Del', m55.deleteSelection], [_t('Select All'), 'Ctrl+A', () => run((s, d) => { d(s.tr.setSelection(new AllSelection(s.doc))); return true; })], '-',
      [_t('Copy Picture'), null, copyAsPicture], [_t('Copy as Internal Format'), null, m55.copyInternal], '-',
      [_t('Find...'), 'Ctrl+Q', () => openFind(false)], [_t('Replace...'), 'Ctrl+W', () => openFind(true)], '-',
      [_t('Redo'), null, () => run(redo)], [_t('Undo AI Changes'), null, () => app.undoAi()], '-',
      [_t('Insert row…'), null, tables.insertRows], [_t('Insert column…'), null, tables.insertColumns],
      [_t('Delete row'), null, tables.deleteRow], [_t('Delete column'), null, tables.deleteColumn], [_t('Delete table'), null, tables.deleteTable],
      [_t('Merge cells'), null, tables.mergeCells], [_t('Split cell'), null, tables.splitCell],
    ]],
    [_t('Insert'), [
      [_t('Math'), 'Ctrl+M', toggleMath], '-',
      [_t('Fraction'), 'Ctrl+F', () => mathAction('fraction')], [_t('Radical'), 'Ctrl+R', () => mathAction('radical')],
      [_t('Superscript'), 'Ctrl+H', () => mathAction('superscript')], [_t('Subscript'), 'Ctrl+L', () => mathAction('subscript')], [_t('Display'), 'Ctrl+D', display], '-',
      [_t('Operator...'), null, m55.operatorDialog], [_t('Brackets...'), null, m55.bracketsDialog], [_t('Matrix...'), null, insertMatrix], [_t('Math Name...'), null, m55.mathNameDialog],
      [_t('Binomial...'), null, m55.binomialDialog], [_t('Label...'), null, m55.labelDialog], [_t('Decoration...'), null, m55.decorationDialog], [_t('Unit Name...'), null, m55.unitNameDialog], '-',
      [_t('Spacing'), null, [[_t('Horizontal Space...'), null, m55.hspaceDialog], [_t('Vertical Space...'), null, m55.vspaceDialog], [_t('Rule...'), null, m55.ruleDialog], [_t('Break...'), null, m55.breakDialog]]],
      [_t('Table...'), null, tables.insertTable], '-',
      [_t('Note...'), null, insertNote], [_t('Formula...'), null, insertFormula], '-',
      [_t('Hypertext Link...'), null, insertLink], [_t('Marker...'), null, insertMarker], '-',
      [_t('HTML Field...'), null, insertHtmlField],
      [_t('Typeset Object'), null, [[_t('Index Entry...'), null, insertIndexEntry], [_t('Cross Reference...'), null, insertRef], [_t('Citation...'), null, insertCitation],
        [_t('Bibliography...'), null, m55.bibliographyDialog], [_t('TeX Field...'), null, insertTexField], [_t('Subdocument...'), null, m55.subdocDialog],
        [_t('Hypertext Target...'), null, m55.hypertargetDialog], [_t('Hypertext Reference...'), null, m55.hyperrefDialog]]], '-',
      [_t('Table caption'), null, tables.addCaption],
      [_t('Operators'), null, sym(OPERATORS)], [_t('Brackets'), null, BRACKETS.map(([sy, ac]) => [sy, null, () => mathAction(ac)])], [_t('Math name'), null, sym(NAMES)],
      [_t('Decoration'), null, DECORATIONS.map(([sy, ac]) => [sy, null, () => mathAction(ac)])],
      [_t('Unit name'), null, UNITS.map(([l, u]) => [l, null, () => mathInsert(`\\unit{${u}}`)])],
    ]],
    [_t('View'), [
      [() => (m55.isShown('invisibles') ? '✓ ' : '　') + _t('Invisibles'), null, () => m55.toggleShown('invisibles')],
      [() => (isShown('helpers') ? '✓ ' : '　') + _t('Helper Lines'), null, () => toggleView('helpers')],
      [() => (m55.isShown('inputboxes') ? '✓ ' : '　') + _t('Input Boxes'), null, () => m55.toggleShown('inputboxes')],
      [() => (isShown('index') ? '✓ ' : '　') + _t('Index Entries'), null, () => toggleView('index')],
      [() => (isShown('markers') ? '✓ ' : '　') + _t('Markers'), null, () => toggleView('markers')], '-',
      [() => (m55.isShown('statusbar') ? '✓ ' : '　') + _t('Status Bar'), null, () => m55.toggleShown('statusbar')], [_t('Toolbars...'), null, () => toolbarsDialog()], '-',
      ['200%', null, () => app.setZoom(2)], ['100%', null, () => app.setZoom(1)], [_t('Custom...'), null, m55.customZoom], '-',
      [_t('Refresh'), 'Esc', m55.refreshView], '-',
      [_t('Zoom in'), 'Ctrl+=', () => app.zoomStep(1)], [_t('Zoom out'), null, () => app.zoomStep(-1)],
      [() => (isShown('texfields') ? '✓ ' : '　') + _t('TeX field'), null, () => toggleView('texfields')],
      [() => (app.reviewShown?.() ? '✓ ' : '　') + _t('Changes and LaTeX source'), 'Ctrl+Shift+D', () => app.toggleReview?.()],
    ]],
    [_t('Go'), [[_t('Previous Section'), null, () => goSection(-1)], [_t('Next Section'), null, () => goSection(1)],
      [_t('Links'), null, [[_t('Contents'), null, () => m55.goLink('contents')], [_t('Index'), null, () => m55.goLink('index')], [_t('Beginning Document'), null, () => m55.goLink('begin')],
        [_t('End Document'), null, () => m55.goLink('end')], [_t('Next Document'), null, () => m55.goLink('next')], [_t('Previous Document'), null, () => m55.goLink('previous')],
        [_t('Parent Document'), null, () => m55.goLink('parent')], [_t('Top Document'), null, () => m55.goLink('top')], [_t('Bibliography'), null, () => m55.goLink('bibliography')],
        [_t('Glossary'), null, () => m55.goLink('glossary')], [_t('Author'), null, () => m55.goLink('author')], [_t('Copyright'), null, () => m55.goLink('copyright')],
        [_t('Disclaimer'), null, () => m55.goLink('disclaimer')], [_t('Editor'), null, () => m55.goLink('editor')], [_t('Publisher'), null, () => m55.goLink('publisher')],
        [_t('Trademark'), null, () => m55.goLink('trademark')]]], '-',
      [_t('To Marker...'), null, goMarker], [_t('To Paragraph...'), null, m55.toParagraph], '-',
      [_t('View History...'), null, m55.viewHistory], [_t('History Back'), null, () => goHistory(-1)], [_t('History Forward'), null, () => goHistory(1)], '-',
      [_t('Link'), null, followLink]]],
    [_t('Tag'), [
      [_t('Appearance...'), null, appearanceDialog], [_t('Function Keys...'), null, functionKeysDialog], [_t('Apply...'), null, m55.applyTag], '-',
      ...FKEY_NAMES.map((k) => [() => tagName(fkeys()[k]), k, () => functionKey(fkeys()[k])]), '-',
      [_t('Item tag'), null, ITEM_TAGS.slice(1).map(([v, l]) => [l, null, () => setItemTag(v)])],
      [_t('Section/body tag'), null, BLOCK_TAGS.map(([v, l]) => [l, null, () => setBlockTag(v)])],
      [_t('Text tag'), null, TEXT_TAGS.map(([v, l]) => [l, null, () => setTextTag(v)])],
    ]],
    // 5.5's Compute menu item by item, in 5.5's order and words (sw550ENUS.dll, menu 21);
    // what opensw adds comes after a line at the end of a submenu
    [_t('Compute'), [
      [_t('Evaluate'), 'Ctrl+E', () => runCompute('evaluate')], [_t('Evaluate Numerically'), null, () => runCompute('numeric')], [_t('Simplify'), null, () => runCompute('simplify')],
      [_t('Combine'), null, [[_t('Exponentials'), null, act55('combine_exp')], [_t('Logs'), null, act55('combine_log')], [_t('Powers'), null, act55('combine_powers')],
        [_t('Trig Functions'), null, act55('combine_trig')], [_t('Arctan'), null, act55('combine_arctan')], [_t('Hyperbolic Trig Functions'), null, act55('combine_hyp')], '-',
        [_t('All of them (opensw)'), null, () => runCompute('combine')]]],
      [_t('Factor'), null, () => runCompute('factor')], [_t('Expand'), null, () => runCompute('expand')],
      [_t('Rewrite'), null, [[_t('Rational'), null, act55('rewrite_rational')], [_t('Float'), null, act55('rewrite_float')], '-',
        [_t('Exponential'), null, act55('rewrite_exp')], [_t('Factorial'), null, act55('rewrite_factorial')], [_t('Gamma'), null, act55('rewrite_gamma')], [_t('Logarithm'), null, act55('rewrite_log')], '-',
        [_t('Sin and Cos'), null, act55('rewrite_sincos')], [_t('Sinh and Cosh'), null, act55('rewrite_sinhcosh')], [_t('Sin'), null, act55('rewrite_sin')], [_t('Cos'), null, act55('rewrite_cos')], [_t('Tan'), null, act55('rewrite_tan')], '-',
        [_t('Arcsin'), null, act55('rewrite_arcsin')], [_t('Arccos'), null, act55('rewrite_arccos')], [_t('Arctan'), null, act55('rewrite_arctan')], [_t('Arccot'), null, act55('rewrite_arccot')], '-',
        [_t('Polar'), null, act55('rewrite_polar')], [_t('Rectangular'), null, act55('rewrite_rectangular')], '-', [_t('Normal Form'), null, act55('rewrite_normal')], '-',
        [_t('Equations as Matrix'), null, act55('eqs_to_matrix')], [_t('Matrix as Equations'), null, act55('matrix_to_eqs')]]],
      [_t('Check Equality'), null, () => runCompute('check')],
      [_t('Solve'), null, [[_t('Exact'), null, () => solveOp('solve')], [_t('Integer'), null, () => runCompute('integersolve')], [_t('Numeric'), null, () => solveOp('numericsolve')], [_t('Recursion'), null, () => runCompute('recursion')]]],
      [_t('Polynomials'), null, [[_t('Collect...'), null, act55('collect')], [_t('Divide'), null, act55('divide')], [_t('Partial Fractions'), null, act55('partialfractions')],
        [_t('Roots'), null, act55('roots')], [_t('Sort'), null, act55('sort')], [_t('Companion Matrix'), null, act55('companion')]]], '-',
      [_t('Calculus'), null, [[_t('Integrate by Parts...'), null, byParts], [_t('Change Variable...'), null, changeVariable], [_t('Partial Fractions'), null, act55('partialfractions')], '-',
        [_t('Approximate Integral...'), null, approxIntegral], [_t('Plot Approximate Integral'), null, plotApproxIntegral], [_t('Plot Approximate Integral Animated'), null, act55('plotapproxint_anim')], '-',
        [_t('Find Extrema'), null, () => runCompute('extrema')], [_t('Iterate...'), null, iterateDialog], [_t('Implicit Differentiation...'), null, implicitDialog], '-',
        [_t('Differentiate'), null, () => calculusOp('differentiate', _t('Differentiate'))], [_t('Integrate (indefinite)'), null, () => calculusOp('integrate', _t('Integrate (indefinite)'))], [_t('Padé approximant…'), null, padeDialog]]],
      [_t('Power Series...'), null, seriesDialog],
      [_t('Solve ODE'), null, [[_t('Exact'), null, () => runCompute('ode')], [_t('Laplace'), null, act55('odelaplace')], [_t('Numeric'), null, () => runCompute('odenumeric')], [_t('Series'), null, act55('odeseries')]]],
      [_t('Transforms'), null, [[_t('Fourier'), null, () => runCompute('fourier')], [_t('Inverse Fourier'), null, act55('inversefourier')], [_t('Laplace'), null, () => runCompute('laplace')], [_t('Inverse Laplace'), null, () => runCompute('inverselaplace')]]],
      [_t('Vector Calculus'), null, [[_t('Gradient'), null, computeAction('gradient')], [_t('Divergence'), null, computeAction('divergence')], [_t('Curl'), null, computeAction('curl')], [_t('Laplacian'), null, computeAction('laplacian')], '-',
        [_t('Jacobian'), null, computeAction('jacobian')], [_t('Hessian'), null, computeAction('hessian')], '-', [_t('Wronskian'), null, computeAction('wronskian')], '-',
        [_t('Scalar Potential'), null, computeAction('potential')], [_t('Vector Potential'), null, computeAction('vectorpotential')], '-', [_t('Set Basis Variables...'), null, setBasis]]], '-',
      [_t('Matrices'), null, MATRICES55.map(([l, op]) => [l, null, act55(op)])],
      [_t('Simplex'), null, [[_t('Dual'), null, () => runCompute('dual')], [_t('Feasible?'), null, () => runCompute('feasible')], [_t('Maximize'), null, () => runCompute('maximize')],
        [_t('Minimize'), null, () => runCompute('minimize')], [_t('Standardize'), null, () => runCompute('standardize')]]], '-',
      [_t('Statistics'), null, [[_t('Fit Curve to Data...'), null, act55('fitcurve')], [_t('Random Numbers...'), null, act55('randomnumbers')], '-',
        [_t('Mean'), null, act55('mean')], [_t('Median'), null, act55('median')], [_t('Mode'), null, act55('mode')], '-',
        [_t('Correlation'), null, act55('correlation')], [_t('Covariance'), null, act55('covariance')], [_t('Geometric Mean'), null, act55('geomean')], [_t('Harmonic Mean'), null, act55('harmonicmean')],
        [_t('Mean Deviation'), null, act55('meandev')], [_t('Moment...'), null, act55('moment')], [_t('Quantile...'), null, act55('quantile')], [_t('Standard Deviation'), null, act55('stddev')], [_t('Variance'), null, act55('variance')]]], '-',
      [_t('Plot 2D'), null, [[_t('Rectangular'), null, plot2d], [_t('Polar'), null, () => plotOther('polar')], [_t('Implicit'), null, () => plotOther('implicit')], [_t('Inequality'), null, () => plotOther('inequality')],
        [_t('Parametric'), null, () => plotOther('param')], '-', [_t('Conformal'), null, () => plotOther('conformal')], [_t('Gradient'), null, () => plotOther('gradient')], [_t('Vector Field'), null, () => plotOther('vector')], '-',
        [_t('ODE'), null, () => plotOther('ode')]]],
      [_t('Plot 3D'), null, [[_t('Rectangular'), null, () => plotOther('surface')], [_t('Cylindrical'), null, () => plotOther('cylindrical')], [_t('Spherical'), null, () => plotOther('spherical')],
        [_t('Implicit'), null, () => plotOther('implicit3')], [_t('Tube'), null, () => plotOther('tube')], '-', [_t('Gradient'), null, () => plotOther('gradient3')], [_t('Vector Field'), null, () => plotOther('vector3')]]], '-',
      [_t('Plot 2D Animated'), null, [[_t('Rectangular'), null, act55('anim_rect')], [_t('Polar'), null, act55('anim_polar')], [_t('Implicit'), null, act55('anim_implicit')], [_t('Inequality'), null, act55('anim_inequality')],
        [_t('Parametric'), null, act55('anim_param')], '-', [_t('Conformal'), null, act55('anim_conformal')], [_t('Gradient'), null, act55('anim_gradient')], [_t('Vector Field'), null, act55('anim_vector')]]],
      [_t('Plot 3D Animated'), null, [[_t('Rectangular'), null, act55('anim_surface')], [_t('Cylindrical'), null, act55('anim_cylindrical')], [_t('Spherical'), null, act55('anim_spherical')],
        [_t('Implicit'), null, act55('anim_implicit3')], [_t('Tube'), null, act55('anim_tube')], '-', [_t('Gradient'), null, act55('anim_gradient3')], [_t('Vector Field'), null, act55('anim_vector3')]]], '-',
      [_t('Definitions'), null, [[_t('New Definition'), 'Ctrl+=', () => definitions('define')], [_t('Undefine'), null, act55('undefine')], [_t('Show Definitions...'), null, () => definitions('showdefs')],
        [_t('Clear Definitions'), null, () => definitions('cleardefs')], [_t('Save Definitions'), null, act55('savedefs')], [_t('Restore Definitions'), null, act55('restoredefs')], [_t('Define MuPAD Name...'), null, act55('mupadname')]]], '-',
      [_t('Settings...'), null, act55('settings55', engineInfo)], '-',
      [_t('Interpret'), 'Ctrl+?', act55('interpret')], '-',
      [_t('Check with Lean'), null, leanCheckFormula],
    ]],
    // Typeset (sw550ENUS.dll menu 23; the DVI items are not here: opensw makes PDF only)
    [_t('Typeset'), [
      [_t('Front Matter...'), null, m55.frontMatter], [_t('Preamble...'), null, editPreamble], [_t('Bibliography Choice...'), null, m55.bibliographyChoice],
      [_t('Options and Packages...'), null, m55.optionsPackages], [_t('Output Choice...'), null, m55.outputChoice], '-',
      [_t('Preview PDF...'), 'Ctrl+P', app.pdf], [_t('Print PDF...'), null, app.pdf && (() => app.typesetAs('print'))], [_t('Compile PDF...'), null, app.pdf && (() => app.typesetAs('none'))], '-',
      [_t('Tools'), null, [[_t('Run BibTeX'), null, app.pdf && (() => app.typesetAs('none', _t('BibTeX ran while compiling')))], [_t('Run MakeIndex'), null, app.pdf && (() => app.typesetAs('none', _t('MakeIndex ran while compiling')))]]],
      [_t('General Settings...'), null, m55.generalSettings], [_t('Expert Settings...'), null, m55.expertSettings], '-',
      [_t('Options…'), null, typesetOptions], [_t('Export LaTeX…'), null, app.exportLatex],
    ]],
    [_t('Tools'), [
      [_t('Action'), null, m55.action], [_t('Spelling...'), null, m55.spelling], '-',
      [_t('Document Manager...'), null, documentManager], [_t('Exam Builder...'), null, examBuilder], '-',
      [_t('User Setup...'), null, userSetup], [_t('Export Settings...'), null, exportSettings], [_t('Computation Setup...'), null, act55('settings55', engineInfo)], [_t('Engine Setup...'), null, engineInfo], '-',
      [_t('Automatic Substitution...'), null, autoSubstitution], '-',
      [_t('Save User Preferences...'), null, m55.savePreferences], [_t('Restore Saved Preferences...'), null, m55.restorePreferences], '-',
      [() => (view.dom.spellcheck ? '✓ ' : '　') + _t('Spell check (English, built into the browser)'), null, toggleSpell],
      [_t('Lean setup…'), null, () => leanSettings()], [_t('Connect AI…'), null, connectAi],
    ]],
    [_t('Window'), app.windows],
    [_t('Help'), [[_t('Contents'), null, openManual], [_t('Search...'), null, m55.helpSearch],
      [_t('Index'), null, [[_t('Computing Techniques'), null, () => m55.helpIndex('computing')], [_t('General Information'), null, () => m55.helpIndex('general')], [_t('Reference Library'), null, () => m55.helpIndex('reference')]]], '-',
      [_t('MacKichan Software Website'), null, m55.website], '-',
      [_t('About SW...'), null, m55.about], '-',
      [_t('Keyboard shortcuts'), 'F1', app.help], [_t('How to use'), null, () => { $('#guide').hidden = false; $('#guide-close').onclick = () => { $('#guide').hidden = true; view.focus(); }; }], [_t('Talking to AI…'), null, talkingToAi]]],
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
      if (!act) { b.disabled = true; b.title = _t('Desktop app only'); }
      noFocus(b);
      if (Array.isArray(act)) {
        const sub = buildMenu(act);
        sub.classList.add('submenu');
        b.classList.add('has-sub');
        b.append(sub);
        b.addEventListener('mouseenter', () => placeSubmenu(b, sub));
        b.onclick = (e) => { e.stopPropagation(); b.classList.toggle('sub-open'); placeSubmenu(b, sub); };
      } else if (act) b.onclick = (e) => { e.stopPropagation(); closePopups(); act(); };
      box.append(b);
    }
    return box;
  }
  // a submenu beside its item, moved up or to the left when it would go past the window's edge
  function placeSubmenu(b, sub) {
    const r = b.getBoundingClientRect();
    sub.style.left = r.right + 'px'; sub.style.top = (r.top - 3) + 'px';
    requestAnimationFrame(() => {
      const h = sub.offsetHeight, w = sub.offsetWidth;
      if (!h) return;
      sub.style.top = Math.max(4, Math.min(r.top - 3, innerHeight - h - 4)) + 'px';
      sub.style.left = (r.right + w > innerWidth ? Math.max(0, r.left - w) : r.right) + 'px';
    });
  }
  function showPopup(anchor, content) {
    popup.replaceChildren(content);
    popup.hidden = false;
    const r = anchor.getBoundingClientRect();
    popup.style.left = Math.max(0, Math.min(r.left, innerWidth - popup.offsetWidth - 4)) + 'px';
    popup.style.top = r.bottom + 'px';
    popup.style.setProperty('--popup-top', r.bottom + 'px');
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
      if (name === _t('Window')) app.refreshWindows(); // the open documents right now
      b.classList.add('open');
      openMenu = name;
      showPopup(b, buildMenu(items));
    };
    b.onmouseenter = () => { if (openMenu && openMenu !== name) b.click(); };
    $('#menubar').append(b);
  }
  // as in 5.5, the × at the right end of the menu bar closes the document on screen
  const docClose = document.createElement('button');
  docClose.id = 'doc-close';
  docClose.textContent = '×';
  docClose.title = _t('Close this document');
  noFocus(docClose);
  docClose.onclick = () => { closePopups(); app.closeDoc(); };
  $('#menubar').append(docClose);
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
  zoomSel.title = _t('Zoom');
  for (const z of app.ZOOMS) zoomSel.append(new Option(Math.round(z * 100) + '%', z));
  zoomSel.onchange = () => { app.setZoom(+zoomSel.value); view.focus(); };

  const GROUPS = [
    [ // Standard
      tbtn('new', _t('New document'), app.newDoc), tbtn('open', _t('Open a .sci or 5.x .tex file (Ctrl+O)'), app.open, 'btn-open'),
      tbtn('save', _t('Save (5.x .tex)'), app.save, 'btn-save'),
      tbtn('print', _t('Typeset and open the PDF (Ctrl+P, desktop app)'), app.pdf || (() => app.toast(_t('Typesetting PDF needs the desktop app'))), 'btn-pdf'),
      tbtn('exporttex', _t('Export LaTeX'), app.exportLatex, 'btn-latex'), tbtn('AI', _t('Export for AI (Markdown)'), app.exportMd, 'btn-md'),
    ],
    [ // Typeset
      tbtn('PDF', _t('Typeset PDF (Ctrl+P, desktop app)'), app.pdf || (() => app.toast(_t('Typesetting PDF needs the desktop app')))), tbtn(_t('Preview'), _t('Preview (no typesetting, printable)'), app.preview),
      tbtn(_t('Preamble'), _t('Preamble (the LaTeX preamble used for typesetting)'), editPreamble), tbtn(_t('Options'), _t('Typeset options and packages'), typesetOptions),
    ],
    [
      tbtn('cut', _t('Cut (Ctrl+X)'), () => document.execCommand('cut')), tbtn('copy', _t('Copy (Ctrl+C)'), () => document.execCommand('copy')),
      tbtn('paste', _t('Paste (Ctrl+V)'), paste),
      tbtn('undo', _t('Undo (Ctrl+Z)'), () => run(undo), 'btn-undo'), tbtn('redo', _t('Redo'), () => run(redo), 'btn-redo'),
      tbtn('math_mathtext', _t('Toggle math/text (Ctrl+M or Ctrl+T)'), toggleMath, 'btn-math'), zoomSel,
    ],
    [ // Math Templates
      tbtn('math_fraction', _t('Fraction (Ctrl+F)'), () => mathAction('fraction')), tbtn('math_radical', _t('Radical (Ctrl+R)'), () => mathAction('radical')),
      tbtn('math_superscript', _t('Superscript (Ctrl+H)'), () => mathAction('superscript')), tbtn('math_subscript', _t('Subscript (Ctrl+L)'), () => mathAction('subscript')),
      tbtn('math_parentheses', _t('Parentheses (Ctrl+9)'), () => mathAction('paren')), tbtn('math_squarebrackets', _t('Square brackets (Ctrl+[)'), () => mathAction('bracket')),
      tbtn('math_sum', _t('Sum (Ctrl+7)'), () => mathAction('sum')), tbtn('math_integral', _t('Integral (Ctrl+I)'), () => mathAction('integral')),
    ],
    [ // Math Objects
      tbtn('display', _t('Display (Ctrl+D)'), display, 'btn-display'), tbtn('math_bigop', _t('Operators'), panel(OPERATORS, 'big')),
      tbtn('math_brackets', _t('Brackets'), panel(BRACKETS, 'wide', mathAction)), tbtn('math_matrix', _t('Matrices'), insertMatrix),
      tbtn('math_mathname', _t('Math name'), panel(NAMES, 'names')), tbtn('math_binomial', _t('Binomial'), () => mathAction('binomial')),
      tbtn('math_decoration', _t('Decoration'), panel(DECORATIONS, '', mathAction)),
    ],
    [ // Compute
      tbtn('=', _t('Compute (Ctrl+E)'), () => runCompute('evaluate'), 'btn-evaluate'), tbtn('≐', _t('Evaluate numerically'), () => runCompute('numeric')),
      tbtn(_t('Simplify'), _t('Simplify'), () => runCompute('simplify')), tbtn(_t('Expand'), _t('Expand'), () => runCompute('expand')),
      tbtn(_t('Factor'), _t('Factor'), () => runCompute('factor')), tbtn(_t('Solution'), _t('Solve (exact)'), () => solveOp('solve')),
    ],
    CACHE.map(([s, l]) => tbtn(s, `${s}　${l}`, () => mathInsert(l))), // Symbol Cache
    Object.entries(PANELS).map(([name, list]) => tbtn(name, _t('Symbol panel ') + name, panel(list))), // Symbol Panels
    [fragSel, tbtn('save_fragment', _t('Save as fragment (the selection)'), saveFragment, 'btn-save-frag')], // Fragments
    [ // Editing
      tbtn('N', _t('Normal text (F4)'), () => setTextTag('')),
      tbtn('bold', _t('Bold (F5)'), () => run(toggleMark(schema.marks.bold)), 'btn-bold'),
      tbtn('italic', _t('Emphasized (F6)'), () => run(toggleMark(schema.marks.italic)), 'btn-italic'),
      tbtn('?', _t('Keyboard shortcuts (F1)'), app.help, 'btn-help'),
    ],
  ];
  const GROUP_NAMES = [_t('Standard'), _t('Typeset'), _t('Edit'), _t('Math templates'), _t('Math objects'), _t('Compute'), _t('Symbol cache'), _t('Symbol panels'), _t('Fragments'), _t('Text styles')];
  // 5.5's other toolbars, docked on the right one above another
  const RIGHT_GROUPS = [
    [_t('Typeset objects'), [tbtn('[1]', _t('Citation'), insertCitation), tbtn('→#', _t('Cross reference'), insertRef), tbtn(_t('Notes'), _t('Note (footnote, margin note)'), insertNote),
      tbtn(_t('Index'), _t('Index entry'), insertIndexEntry), tbtn('TeX', _t('TeX field'), insertTexField)]],
    [_t('Go'), [tbtn('⇑', _t('Previous section'), () => goSection(-1)), tbtn('⇓', _t('Next section'), () => goSection(1)), tbtn(_t('Marker'), _t('Go to marker'), goMarker)]],
    [_t('History'), [tbtn('◀', _t('Previous position'), () => goHistory(-1)), tbtn('▶', _t('Next position'), () => goHistory(1))]],
    [_t('Link'), [tbtn('URL', _t('Insert hypertext link'), insertLink), tbtn('↗', _t('Go to link (cursor on a link)'), followLink)]],
    [_t('Fields'), [tbtn('HTML', _t('HTML field'), insertHtmlField), tbtn('F( )', _t('Exam formula'), insertFormula)]],
    [_t('Exam'), [tbtn(_t('Exam'), _t('Exam builder (the current document as the template)'), examBuilder)]],
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
    dialog(_t('Toolbars'), `<p>${_t('Top:')}<br>${GROUP_NAMES.map(box).join(' ')}</p><p>${_t('Right:')}<br>${RIGHT_GROUPS.map(([n]) => box(n)).join(' ')}</p>
      <p><button type="button" id="d-tb-reset">${_t('Reset (show all)')}</button></p>`, (d) => {
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
  function status(msg) { $('#status-text').textContent = msg || pendingMsg || _t('For help, press F1'); }
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
    $('#status-mode').textContent = math ? _t('Math') : _t('Text');
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
    pendingMsg = p === 'greek' ? _t('Ctrl+G: press a letter for a Greek letter (a→α, b→β, y→θ…)')
      : p === 'symbol' ? _t('Ctrl+S: press a key for a symbol (I→∞, e→∈, =→≠, <→≤…)')
        : p?.startsWith('accent:') ? _t('Press a letter to add the accent') : p === 'dash' ? _t('Press Ctrl+- again for a discretionary hyphen') : '';
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
  // Ctrl + a fragment's name (5.5: names of two or more characters; here letters and digits, the
  // name without its folder). Copy, paste, cut, select all, undo and redo keep their keys: a name
  // cannot begin with those letters.
  const NATIVE_CTRL = ['c', 'v', 'x', 'a', 'z', 'y'];
  let ctrlTyped = '';
  const fragmentKeys = () => Object.fromEntries(fragmentNames().map((n) => [n.split('/').pop().toLowerCase(), n])
    .filter(([k]) => /^[a-z0-9]{2,}$/.test(k)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); app.help(); return; }
    if (e.key === 'Escape') { // closes a menu; otherwise View > Refresh (5.5: Esc)
      const menuWasOpen = !!openMenu;
      closePopups();
      if (!menuWasOpen && !pending && !isField(e.target) && !currentMath() && $('#dialog').hidden) m55.refreshView();
    }
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
    // Ctrl held while typing a fragment's name (5.5): the letters wait while they can begin one
    if (/^[a-z0-9]$/i.test(e.key) && !e.shiftKey) {
      const typed = ctrlTyped + e.key.toLowerCase();
      if (!(ctrlTyped === '' && NATIVE_CTRL.includes(typed)) && Object.keys(fragmentKeys()).some((n) => n.startsWith(typed))) {
        take(); ctrlTyped = typed; return;
      }
      if (ctrlTyped) replayCtrl();
    }
    if (e.key === '=' && mv) { take(); definitions('define'); return; } // 5.5: Ctrl+= New Definition
    if (e.key === '?') { take(); act55('interpret')(); return; } // 5.5: Ctrl+? Interpret
    if (e.key === '=' || e.key === '+') { take(); app.zoomStep(1); return; } // zoom (not in 5.5): Ctrl+= outside a formula, Ctrl++
    const a = actionFor(e);
    if (!a) return;
    take();
    ctrlAction(a, mv);
  }, true);
  document.addEventListener('keyup', (e) => {
    if ((e.key === 'Control' || e.key === 'Meta') && ctrlTyped) {
      const name = fragmentKeys()[ctrlTyped];
      if (name) { ctrlTyped = ''; insertLatex(allFragments()[name]); } else replayCtrl();
    }
  }, true);
  window.addEventListener('blur', () => { ctrlTyped = ''; });
  // the letters held back for a fragment's name were not one: their shortcuts, in turn
  function replayCtrl() {
    const keys = ctrlTyped;
    ctrlTyped = '';
    for (const key of keys) {
      const a = actionFor({ key, ctrlKey: true });
      if (a) ctrlAction(a, currentMath());
    }
  }
  function ctrlAction(a, mv) {
    if (a === 'open') app.open();
    else if (a === 'print') app.pdf ? app.pdf() : app.toast(_t('Typesetting PDF needs the desktop app'));
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
  }

  // ---------- help ----------
  $('#help').innerHTML = _t('<b>Scientific Word 5.5 keyboard shortcuts</b> (on a Mac, Cmd instead of Ctrl)<table>')
    + HELP_ROWS.map(([a, b]) => `<tr><td>${a}</td><td>${b.replace(/</g, '&lt;')}</td></tr>`).join('')
    + _t('</table>In a formula you can also type: ^ superscript, _ subscript, / fraction, \\alpha Greek letters, sqrt radical; the arrow keys at the edge of a formula take you back to the text.');

  return { refresh };
}
