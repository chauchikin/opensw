// View > Changes panel (Ctrl+Shift+D): what changed since the document was opened, without
// touching the document. Closed by default, so the screen stays as in 5.5. When open:
//   left   the document as it was opened (read only); the blocks changed since are tinted
//   right  three tabs: the working document (changed blocks tinted, one colour for what an AI
//          changed and one for the user's own changes), the LaTeX source that saving writes
//          (read only, kept up to date; the parts written again are marked), and a list of the
//          changes (each can be accepted or put back), typesetting errors in plain words and
//          a check of the steps of derivations (a = b = c in displayed formulas).
import { EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import { convertLatexToMarkup } from 'mathlive';
import { schema } from './schema.js';
import { matchBlocks } from './export.js';
import { mathForDisplay, standardTeX } from './tex55.js';
import { _t } from './i18n.js';
import { splitTop, tidy, REL, askEqual, definedNames, mentions, nameKey } from './steps.js';

export const reviewKey = new PluginKey('review');
let shown = false;

// The plugin keeps the document to compare with (base: as opened, or as accepted since) and who
// changed which part: ranges [{from, to, author: 'ai' | 'user'}], mapped along with the document.
export function reviewPlugin(init = null) {
  return new Plugin({
    key: reviewKey,
    state: {
      init: (_, state) => ({ base: init?.base || state.doc, ranges: init?.ranges || [] }),
      apply(tr, v, old, now) {
        const set = tr.getMeta(reviewKey);
        if (set) v = { ...v, ...set };
        if (!tr.docChanged) return v;
        const ranges = v.ranges.map((r) => {
          const from = tr.mapping.map(r.from, -1), to = tr.mapping.map(r.to, 1);
          return { ...r, from, to: Math.max(from, to) };
        });
        const s = old.doc.content.findDiffStart(now.doc.content);
        if (s != null) {
          const e = old.doc.content.findDiffEnd(now.doc.content);
          ranges.push({ from: s, to: Math.max(s, e?.b ?? s), author: tr.getMeta('ai') ? 'ai' : 'user' });
        }
        return { base: v.base, ranges: ranges.slice(-400) };
      },
    },
    props: {
      decorations(state) {
        if (!shown) return null;
        const decos = [];
        for (const h of hunks(state)) {
          const cls = `rv-changed rv-${h.author}`;
          for (const b of h.cur) decos.push(Decoration.node(b.from, b.to, { class: cls }));
          if (!h.cur.length) decos.push(Decoration.widget(h.at, () => deletedMark(h), { side: -1 }));
        }
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

function deletedMark(h) {
  const el = document.createElement('div');
  el.className = `rv-deleted rv-${h.author}`;
  el.textContent = _t('{0} deleted block(s)', h.base.length);
  return el;
}

const blocksOf = (doc) => {
  const out = [];
  doc.forEach((node, offset, index) => out.push({ node, from: offset, to: offset + node.nodeSize, index }));
  return out;
};

// The differences, block by block: [{ base: [blocks of base], cur: [blocks of doc], at, author }]
// (at: where the blocks are, or would be, in the document; baseAt: the same in base, as a block index)
export function hunks(state) {
  const rv = reviewKey.getState(state);
  if (!rv) return [];
  const L = blocksOf(rv.base), C = blocksOf(state.doc);
  const match = matchBlocks(L.map((b) => b.node), C.map((b) => b.node));
  const out = [];
  let li = -1, lj = -1;
  for (let a = 0; a <= L.length; a++) {
    if (a < L.length && match[a] < 0) continue;
    const b = a < L.length ? match[a] : C.length;
    if (a - li > 1 || b - lj > 1) {
      const base = L.slice(li + 1, a), cur = C.slice(lj + 1, b);
      // as many blocks on both sides: each one a change of its own
      const parts = base.length === cur.length ? base.map((x, k) => [[x], [cur[k]], li + 1 + k]) : [[base, cur, li + 1]];
      for (const [bs, cs, baseAt] of parts) {
        const at = cs.length ? cs[0].from : (C[lj]?.to ?? 0);
        const to = cs.length ? cs.at(-1).to : at;
        // who: the latest change that touched these blocks
        const r = [...rv.ranges].reverse().find((x) => x.from <= to && x.to >= at);
        out.push({ base: bs, baseAt, cur: cs, at, author: r?.author || 'user' });
      }
    }
    li = a; lj = b;
  }
  return out;
}

// a formula shown as a picture (the original document cannot be edited)
class StaticMath {
  constructor(node) {
    this.dom = document.createElement(node.type.name === 'math_display' ? 'div' : 'span');
    this.dom.className = node.type.name === 'math_display' ? 'math-display' : 'math-inline';
    try {
      this.dom.innerHTML = convertLatexToMarkup(mathForDisplay(standardTeX(node.attrs.latex)), { defaultMode: node.type.name === 'math_display' ? 'math' : 'inline-math' });
    } catch (e) { this.dom.textContent = node.attrs.latex; }
  }
}

// a short description of a block for the list
function describe(node) {
  if (!node) return '';
  if (node.type.name === 'math_display') return node.attrs.latex.slice(0, 60);
  const t = node.textContent.replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 60) + '…' : t || `[${node.type.name}]`;
}

// ---------- typesetting errors in plain words ----------
const PLAIN = [
  [/^Undefined control sequence/, (c) => _t('A command TeX does not know: {0}', (c.match(/\\[A-Za-z@]+\*?(?=[^A-Za-z@]*$)/) || [''])[0] || '?')],
  [/^Missing \$ inserted/, () => _t('A math symbol outside a formula, or a formula that does not end')],
  [/^Extra \}, or forgotten \$/, () => _t('One } too many, or a formula without its closing $')],
  [/^Missing \} inserted/, () => _t('A { without its }')],
  [/^Missing \{ inserted/, () => _t('A } without its {')],
  [/^Too many \}'s/, () => _t('One } too many')],
  [/^Extra alignment tab has been changed to \\cr/, () => _t('A row of a table or matrix has more columns than it should')],
  [/^Misplaced alignment tab character &/, () => _t('An & outside a table or an aligned formula')],
  [/^(?:LaTeX Error: |Package \S+ Error: )?File `([^']+)' not found/, (c, m) => _t('File not found: {0} (a picture or a package)', m[1])],
  [/^The font "([^"]+)" is not installed on this computer/, (c, m) => _t('The font {0} is not installed on this computer; the default font is used instead', m[1])],
  [/^(?:LaTeX Error: )?Environment (\S+) undefined/, (c, m) => _t('An environment TeX does not know: {0}', m[1])],
  [/^Paragraph ended before (\\\S+) was complete/, (c, m) => _t('The paragraph ends before {0} has all its arguments', m[1])],
  [/^Double subscript/, () => _t('Two subscripts on one symbol (x_1_2): put braces around one')],
  [/^Double superscript/, () => _t('Two superscripts on one symbol (x^2^3): put braces around one')],
  [/^(?:LaTeX Error: )?\\begin\{(\S+)\} on input line \d+ ended by \\end\{(\S+)\}/, (c, m) => _t('\\begin{{0}} is closed by \\end{{1}}', m[1], m[2])],
  [/^Missing number, treated as zero/, () => _t('A number (a length or a count) is missing')],
  [/^Illegal unit of measure/, () => _t('A length without a unit (pt, cm, in)')],
  [/^Display math should end with \$\$/, () => _t('A displayed formula does not end properly')],
  [/^Dimension too large/, () => _t('A size too large for TeX (a picture or a space)')],
];
export function plainError(e) {
  const m0 = e.match(/^(.*?)(?: \[(\d+) times\])?(?: \(l\.(\d+) ?([^]*)\))?$/);
  const msg = m0[1].trim(), context = m0[4] || '';
  // (a message TeX gave many times comes once, with how often and the first place)
  const often = m0[2] ? ' ' + _t('({0} times; the first place is shown)', m0[2]) : '';
  const line = m0[3] ? +m0[3] : null;
  for (const [re, f] of PLAIN) { const m = msg.match(re); if (m) return { text: f(context, m) + often, context, line }; }
  return { text: msg + often, context, line };
}

// ---------- derivations: a = b = c in displayed formulas ----------
const isName = (s) => /^([A-Za-z]|\\[A-Za-z]+)(_\{[^{}]*\}|_\w)?\s*((\\left)?\(\s*[^()]*?\s*(\\right)?\))?$/.test(s.trim());
// -> [{ a, b, pos }]: the steps a = b to check, pos the block they are in
export function derivationSteps(doc) {
  const steps = [];
  let chain = null; // { last, pos, block } the expression a next "= b" continues
  doc.forEach((node, pos, index) => {
    if (node.type.name !== 'math_display') { chain = null; return; }
    let tex = node.attrs.latex.trim();
    const env = tex.match(/^\\begin\{(array|aligned|gathered|split|eqnarray\*?|align\*?)\}(\{[^{}]*\})?([^]*)\\end\{\1\}$/);
    const rows = env ? splitTop(env[3], '\\\\') : [tex];
    if (chain && chain.block !== index - 1) chain = null;
    rows.forEach((row, r) => {
      // a row can hold several statements set apart by \qquad (a = b, \qquad c = d): each its own chain
      splitTop(row.replace(/&/g, ' '), '\\qquad').forEach((statement, q) => {
        if (q > 0) chain = null;
        const parts = splitTop(statement, '=').map(tidy);
        if (parts.length < 2) { if (!(r === 0 && q === 0 && parts[0] === '')) chain = null; return; }
        // "= b" continues the expression before; "a = b" starts again
        if (parts[0] !== '') chain = null;
        parts.forEach((p, k) => {
          if (k === 0 && p === '') return;
          if (!p || REL.test(p)) { chain = null; return; }
          // (the first step of f(x) = .., x = .. or a := .. names something: not checked)
          if (chain && !(chain.first && isName(chain.last)) && !chain.last.endsWith(':')) steps.push({ a: chain.last, b: p, pos });
          chain = { last: p, block: index, first: !chain };
        });
      });
    });
  });
  return steps;
}

// ---------- the panel ----------
// app: { view, toast, compute(op, latex, params), source() -> { text, head, segs } | { text },
//   steps() / checkSteps(): the named steps' table (steps.js; may be absent) }
export function setupReview(app) {
  const { view } = app;
  const $ = (s) => document.querySelector(s);
  let tab = 'doc', timer = null, left = null, errors = [], steps = null, checking = false;
  // the line-by-line check of named steps (steps.js, the file beside the document): its table
  let named = null, namedText = '', checkingNamed = false;

  function leftDecos(state, base) {
    const decos = [];
    if (!shown) return DecorationSet.empty;
    for (const h of hunks(state)) for (const b of h.base) decos.push(Decoration.node(b.from, b.to, { class: `rv-old rv-${h.author}` }));
    return DecorationSet.create(base, decos);
  }
  function drawLeft() {
    const base = reviewKey.getState(view.state)?.base;
    if (!base) return;
    const decos = leftDecos(view.state, base);
    if (!left) {
      left = new EditorView($('#rv-original'), {
        state: EditorState.create({ doc: base, schema }),
        editable: () => false,
        nodeViews: { math_inline: (n) => new StaticMath(n), math_display: (n) => new StaticMath(n) },
        decorations: () => decos,
      });
    } else {
      if (left.state.doc !== base) left.updateState(EditorState.create({ doc: base, schema }));
      left.setProps({ decorations: () => decos });
    }
  }

  function showTab(t) {
    tab = t;
    for (const b of document.querySelectorAll('#rv-tabs button')) b.classList.toggle('on', b.dataset.tab === t);
    $('#scroller').hidden = shown && t !== 'doc';
    $('#rv-source').hidden = !(shown && t === 'source');
    $('#rv-list').hidden = !(shown && t === 'list');
    refresh();
  }

  function toggle(on = !shown) {
    shown = on;
    document.body.classList.toggle('reviewing', shown);
    $('#rv-left').hidden = !shown;
    $('#rv-tabs').hidden = !shown;
    view.dispatch(view.state.tr.setMeta(reviewKey, {})); // draw (or take away) the tints
    showTab(shown ? tab : 'doc');
  }

  function refresh() {
    clearTimeout(timer);
    if (!shown) return;
    timer = setTimeout(() => {
      drawLeft();
      if (tab === 'source') drawSource();
      if (tab === 'list') drawList();
    }, 250);
  }

  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  function drawSource() {
    let src;
    try { src = app.source(); } catch (e) { $('#rv-source').textContent = String(e.message || e); return; }
    const pre = $('#rv-source');
    if (!src.segs) { pre.innerHTML = esc(src.text); return; }
    // the parts written again (not as they were in the file) are marked
    let html = esc(src.text.slice(0, src.head)), from = src.head;
    for (const g of src.segs) {
      const part = esc(src.text.slice(from, g.to));
      html += g.kept === false ? `<mark class="rv-written">${part}</mark>` : part;
      from = g.to;
    }
    pre.innerHTML = html + esc(src.text.slice(from));
  }

  function goTo(pos) {
    showTab('doc');
    const doc = view.state.doc;
    pos = Math.min(pos, doc.content.size);
    view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(pos))).scrollIntoView());
    const dom = view.nodeDOM(pos);
    if (dom?.scrollIntoView) dom.scrollIntoView({ block: 'center' });
  }
  function goLeft(h) {
    const b = h.base[0];
    const dom = b && left?.nodeDOM(b.from);
    if (dom?.scrollIntoView) dom.scrollIntoView({ block: 'center' });
  }

  // accepted: base takes the change, so it is no longer shown
  function accept(i) {
    const h = hunks(view.state)[i];
    if (!h) return;
    const L = [];
    reviewKey.getState(view.state).base.forEach((n) => L.push(n));
    L.splice(h.baseAt, h.base.length, ...h.cur.map((b) => b.node));
    view.dispatch(view.state.tr.setMeta(reviewKey, { base: schema.nodes.doc.create(null, L) }));
    refresh();
  }
  // put back: the document gets base's blocks again
  function putBack(i) {
    const h = hunks(view.state)[i];
    if (!h) return;
    const from = h.cur.length ? h.cur[0].from : h.at;
    const to = h.cur.length ? h.cur.at(-1).to : h.at;
    const nodes = h.base.map((b) => b.node);
    if (!nodes.length && from === 0 && to === view.state.doc.content.size) nodes.push(schema.nodes.paragraph.create());
    view.dispatch(view.state.tr.replaceWith(from, to, nodes).scrollIntoView());
  }

  function drawList() {
    const list = $('#rv-list');
    const hs = hunks(view.state);
    const who = (a) => `<span class="rv-dot rv-${a}"></span>${a === 'ai' ? _t('AI') : _t('You')}`;
    let html = `<h3>${_t('Changes ({0})', hs.length)}</h3>`;
    if (!hs.length) html += `<p class="rv-none">${_t('No changes since the document was opened (or since the last accepted change).')}</p>`;
    hs.forEach((h, i) => {
      const what = !h.base.length ? _t('Added') : !h.cur.length ? _t('Deleted') : _t('Changed');
      const text = describe((h.cur[0] || h.base[0]).node);
      html += `<div class="rv-item" data-hunk="${i}">${who(h.author)} <b>${what}</b> ${_t('block {0}', (h.cur[0]?.index ?? h.base[0].index) + 1)}: <span class="rv-text">${esc(text)}</span>
        <span class="rv-actions"><button data-accept="${i}" title="${_t('Keep this change and stop showing it')}">${_t('Accept')}</button> <button data-back="${i}" title="${_t('Put back what the original had')}">${_t('Undo change')}</button></span></div>`;
    });
    html += `<h3>${_t('Typesetting errors ({0})', errors.length)}</h3>`;
    if (!errors.length) html += `<p class="rv-none">${_t('None (typeset with Typeset > PDF to check).')}</p>`;
    errors.forEach((e, i) => {
      html += `<div class="rv-item rv-error" data-error="${i}">⚠ ${esc(e.text)}${e.block != null ? ` <span class="rv-text">(${_t('block {0}', e.block + 1)})</span>` : ''}${e.context ? ` <code class="rv-context">${esc(e.context)}</code>` : ''}</div>`;
    });
    html += `<h3>${_t('Derivation steps')}</h3><p><button id="rv-check"${checking ? ' disabled' : ''}>${checking ? _t('Checking…') : _t('Check the steps of displayed formulas')}</button></p>`;
    if (steps) {
      const ok = steps.filter((s) => s.result === 'equal').length;
      html += `<p class="rv-none">${_t('{0} steps checked: {1} proved equal.', steps.length, ok)}</p>`;
      steps.forEach((s, i) => {
        if (s.result === 'equal') return;
        const mark = s.result === 'notequal' ? `<span class="rv-bad">✗ ${_t('Not equal')}</span>` : `<span class="rv-unknown">? ${_t('Cannot decide')}</span>`;
        const why = s.result === 'notequal' ? ` — ${_t('at {0}: {1} and {2}', s.point, s.values[0], s.values[1])}`
          : s.missing.length ? ` — ${_t('no definition in force for {0}; define it (Compute > Definitions > New Definition) and check again', s.missing.join(', '))}` : '';
        html += `<div class="rv-item" data-step="${i}">${mark} <code>${esc(s.a)}</code> = <code>${esc(s.b)}</code><span class="rv-text">${esc(why)}</span></div>`;
      });
    }
    html += namedHtml();
    list.innerHTML = html;
    list.querySelectorAll('[data-hunk]').forEach((el) => el.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      const h = hunks(view.state)[+el.dataset.hunk];
      if (h) { goLeft(h); goTo(h.at); }
    }));
    list.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => accept(+b.dataset.accept)));
    list.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => putBack(+b.dataset.back)));
    list.querySelectorAll('[data-error]').forEach((el) => el.addEventListener('click', () => { const e = errors[+el.dataset.error]; if (e?.pos != null) goTo(e.pos); }));
    list.querySelectorAll('[data-step]').forEach((el) => el.addEventListener('click', () => goTo(steps[+el.dataset.step].pos)));
    $('#rv-check')?.addEventListener('click', checkSteps);
    list.querySelectorAll('[data-named]').forEach((el) => el.addEventListener('click', () => { const pos = blockPos(+el.dataset.named); if (pos != null) goTo(pos); }));
    $('#rv-check-named')?.addEventListener('click', checkNamed);
    loadNamed();
  }

  // ---------- the line-by-line check: every named step with its result (Changes and errors tab)
  const STATUS = {
    pass: ['rv-good', '✓', () => _t('Passed')], fail: ['rv-bad', '✗', () => _t('Failed')], trusted: ['rv-trusted', '★', () => _t('Trusted')],
    unknown: ['rv-unknown', '?', () => _t('Cannot decide')], unchecked: ['rv-unchecked', '–', () => _t('Not checked')],
  };
  function blockPos(index) {
    let at = null;
    view.state.doc.forEach((n, pos, i) => { if (i === index) at = pos; });
    return at;
  }
  function namedHtml() {
    let html = `<h3>${_t('Line-by-line check ({0} steps)', named?.counts?.steps ?? 0)}</h3>`;
    if (!app.steps) return html + `<p class="rv-none">${_t('Not available here.')}</p>`;
    html += `<p><button id="rv-check-named"${checkingNamed || !named?.steps?.length ? ' disabled' : ''}>${checkingNamed ? _t('Checking…') : _t('Check all named steps')}</button></p>`;
    if (!named) return html + `<p class="rv-none">${_t('Reading the steps…')}</p>`;
    if (named.error) return html + `<p class="rv-none">${esc(named.error)}</p>`;
    if (!named.steps.length) return html + `<p class="rv-none">${_t('No named steps yet. A displayed formula with a \\label is a step; an AI can name the others (nameSteps).')}</p>`;
    const c = named.counts;
    html += `<p class="rv-none">${_t('Passed {0}, failed {1}, cannot decide {2}, not checked {3}, trusted {4}.', c.pass, c.fail, c.unknown, c.unchecked, c.trusted)}</p>`;
    html += `<table class="rv-steps"><thead><tr><th>${_t('Step')}</th><th>${_t('Block')}</th><th>${_t('Result')}</th><th>${_t('Why')}</th></tr></thead><tbody>`;
    for (const r of named.steps) {
      const [cls, mark, word] = STATUS[r.status] || STATUS.unknown;
      const waits = r.waitsFor?.length ? ` (${_t('waits for {0}', r.waitsFor.join(', '))})` : '';
      html += `<tr class="rv-item" data-named="${r.block}"><td><code>${esc(r.name)}</code></td><td>${r.block + 1}</td><td><span class="${cls}">${mark} ${word()}</span></td><td class="rv-text">${esc(r.why || '')}${esc(waits)}${r.note ? ` — ${esc(r.note)}` : ''}</td></tr>`;
    }
    html += '</tbody></table>';
    if (named.problems?.length) html += `<ul class="rv-problems">${named.problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`;
    return html;
  }
  // the table as the steps file says now (a step changed since its check is unchecked again)
  let loading = false;
  async function loadNamed() {
    if (!app.steps || loading || checkingNamed) return;
    loading = true;
    let t;
    try { t = await app.steps(); } catch (e) { t = { error: String(e.message || e) }; } finally { loading = false; }
    const text = JSON.stringify(t);
    if (text === namedText) return;
    named = t; namedText = text;
    if (shown && tab === 'list') drawList();
  }
  async function checkNamed() {
    checkingNamed = true;
    drawList();
    try { named = await app.checkSteps(); } catch (e) { named = { error: String(e.message || e) }; }
    namedText = JSON.stringify(named);
    checkingNamed = false;
    drawList();
  }

  async function checkSteps() {
    checking = true;
    drawList();
    const found = derivationSteps(view.state.doc);
    // the names the displayed formulas define (w_0 = ..) that have no definition in force
    // (Compute > Definitions): a step with such a name cannot be decided, it is not wrong
    const shown = [];
    view.state.doc.forEach((n, pos, index) => { if (n.type.name === 'math_display') shown.push({ latex: n.attrs.latex, block: index + 1 }); });
    let have = new Set();
    try { have = new Set(((await app.compute('showdefs', '0')).solutions || []).map(nameKey)); } catch (e) { /* no engine: every step comes out unknown below */ }
    const known = definedNames(shown);
    const out = [];
    for (const s of found) {
      const r = await askEqual(app.compute, s.a, s.b);
      const last = r.asked.at(-1);
      const missing = r.result === 'equal' ? [] : [...new Set(known.filter((k) => !have.has(k.key) && mentions(s.a + ' ' + s.b, k.key)).map((k) => k.key.replace(/\($/, '')))];
      out.push({ ...s, result: missing.length || r.result === 'error' ? 'unknown' : r.result, missing, point: last.counterexample?.point, values: last.counterexample?.values });
    }
    steps = out;
    checking = false;
    drawList();
  }

  // Typeset > PDF: the errors TeX gave, in plain words, each with the block it is in when it can be found
  function setErrors(list) {
    errors = list.map((e) => {
      const p = plainError(e);
      // the block whose text and TeX have most of the words and commands TeX showed
      const tokens = p.context.match(/\\[A-Za-z]+|[A-Za-z0-9]{3,}/g) || [];
      let block = null, pos = null, best = 0;
      if (tokens.length) {
        view.state.doc.forEach((n, off, i) => {
          let hay = n.textContent + (n.attrs?.latex || '');
          n.descendants((d) => { hay += (d.attrs?.latex || '') + (d.attrs?.tex || ''); });
          const score = tokens.filter((t) => hay.includes(t)).length;
          if (score > best) { best = score; block = i; pos = off; }
        });
      }
      return { ...p, block, pos };
    });
    if (shown && tab === 'list') drawList();
  }

  document.querySelectorAll('#rv-tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  // Ctrl+Shift+D (Ctrl+Shift+letter is not a 5.5 key)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.key === 'D' || e.key === 'd')) { e.preventDefault(); e.stopPropagation(); toggle(); }
  }, true);

  return { toggle, shown: () => shown, refresh, setErrors, hunks: () => hunks(view.state), checkSteps, steps: () => steps, errors: () => errors, named: () => named, checkNamed, showTab };
}

