// Tools > Exam Builder > online quiz: one version of the exam as a web page to answer in a
// browser, as 5.5's Exam Builder made a quiz to take on screen. The Exam's Setup (5.5's keywords):
//   Title: the page's title (5.5: the title bar); Submit: the button's words
//   Action, Method (post or get), Database, ItemId, Record (Never, Always, Student Choice):
//     the page's form sends the answers to Action, for a grading server of the school's own
//     (5.5 sent them to its own server program, which recorded the score in an Access database);
//   without Action the page grades itself when the button is pressed (the key is in the page,
//     only encoded: for practice, not for a graded test), and shows the score out of the Points.
// A question's choices are radio buttons, or check boxes (Choices: Check; each choice worth the
// points of its item label), or pictures (Images: image-select, graded when one is clicked);
// InputField is a box, compared with GradeProc's givecredit(response = ...) or the Answer;
// a Response section is a text box (Text Area) that is not graded.
// buildExams (exam.js) with a quiz list marks these places in the text; toHtml (html.js) makes
// the page, and the marks become the inputs.
import { QUIZ_MARK } from './exam.js';
import { _t } from './i18n.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// page: the HTML toHtml made of the exam; key: the list buildExams filled;
// settings: examSettings(template): { title, submit, action, method, database, itemid, record }
export function quizHtml(page, key, settings = {}) {
  const M = QUIZ_MARK;
  const byId = new Map(key.map((k) => [k.id, k]));
  const hiddenFor = new Set(); // image-select: one field per question holds the picture clicked
  // a choice: "<mark>Q3:A<mark>(A) " -> a button (or box, or picture) before the label
  let html = page.replace(new RegExp(`${M}Q([0-9a-j]+):([A-Z])${M}`, 'g'), (m, id, letter) => {
    const k = byId.get(id) || {};
    if (k.kind === 'image') {
      const field = hiddenFor.has(id) ? '' : `<input type="hidden" name="q${id}" value="">`;
      hiddenFor.add(id);
      return `${field}<button type="button" class="quiz-image" data-q="${id}" data-v="${letter}"><img src="${esc(k.images[letter.charCodeAt(0) - 65])}" alt="${letter}"></button>`;
    }
    return `<label class="quiz-choice"><input type="${k.kind === 'check' ? 'checkbox' : 'radio'}" name="q${id}" value="${letter}"> </label>`;
  });
  html = html.replace(new RegExp(`${M}I([0-9a-j]+)${M}`, 'g'), (m, id) =>
    `<label class="quiz-blank">${esc(_t('Answer:'))} <input type="text" name="q${id}" size="30"></label>`);
  html = html.replace(new RegExp(`${M}T([0-9a-j]+):(\\d+):(\\d+)${M}`, 'g'), (m, id, rows, cols) =>
    `<textarea name="q${id}" rows="${rows}" cols="${cols}"></textarea>`);
  const action = (settings.action || '').trim();
  const method = /^get$/i.test(settings.method || '') ? 'get' : 'post';
  const record = (settings.record || '').trim().toLowerCase();
  const submit = settings.submit?.trim() || (action ? _t('Send answers') : _t('Check answers'));
  const hidden = (n, v) => (v ? `<input type="hidden" name="${n}" value="${esc(v)}">` : '');
  const form = action
    ? `<form id="quiz" action="${esc(action)}" method="${method}">${hidden('database', settings.database)}${hidden('itemid', settings.itemid)}${record === 'student choice' ? '' : hidden('record', record)}
<p>${esc(_t('Student name'))} <input type="text" name="name" size="24"></p>`
    : '<form id="quiz" onsubmit="return false">';
  const buttons = action
    ? `${record === 'student choice' ? `<p><label><input type="checkbox" name="record" value="always"> ${esc(_t('Record my score'))}</label></p>` : ''}<p><button type="submit">${esc(submit)}</button></p></form>`
    : `<p><button type="button" id="quiz-check">${esc(submit)}</button> <span id="quiz-score"></span></p></form>`;
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(key))));
  const words = { right: _t('correct'), wrong: _t('wrong'), score: _t('Score: {0} of {1} points') };
  const script = `<script>
(function () {
  var key = JSON.parse(decodeURIComponent(escape(atob(${JSON.stringify(encoded)}))));
  var words = ${JSON.stringify(words)};
  var form = document.getElementById('quiz');
  // a typed answer: spaces, braces, \\left \\right and a trailing period do not count; numbers by value
  function norm(s) { return String(s).replace(/\\\\(left|right)/g, '').replace(/[\\s{}$]/g, '').replace(/\\.$/, '').toLowerCase(); }
  function same(a, b) {
    var x = parseFloat(norm(a)), y = parseFloat(norm(b));
    if (/^-?[0-9.]+(e-?[0-9]+)?$/.test(norm(a)) && /^-?[0-9.]+(e-?[0-9]+)?$/.test(norm(b))) return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));
    return norm(a) === norm(b);
  }
  // GradeProc givecredit(response = ...): the typed answer is worth credit when it has the
  // answer's values at the points the page was given (3x+6 for 3(x+2)); it is read as typed:
  // 2x^2, x ln(4x), sqrt(2), pi, sin, cos, tan, ln, log, exp, abs, units by their names (ft)
  var FUNCS = { sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log, exp: Math.exp, sqrt: Math.sqrt, abs: Math.abs,
    arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh };
  function valueAt(text, vars, point) {
    var toks = String(text).replace(/\\u2212/g, '-').replace(/\\u00d7|\\u22c5|\\u00b7/g, '*').match(/\\d+\\.?\\d*(?:e[-+]?\\d+)?|\\.\\d+|[A-Za-z_][A-Za-z_0-9]*|\\*\\*|[-+*\\/^(),]|\\S/g) || [];
    var i = 0;
    function peek() { return toks[i]; }
    function name(n) {
      var at = vars.indexOf(n); if (at < 0) at = vars.indexOf('unit_' + n);
      if (at >= 0) return point[at];
      if (n === 'pi') return Math.PI;
      if (n === 'e') return Math.E;
      return null;
    }
    function primary() {
      var t = toks[i++];
      if (t === undefined) throw 0;
      if (t === '(') { var v = expr(); if (toks[i++] !== ')') throw 0; return v; }
      if (/^[\\d.]/.test(t)) return parseFloat(t);
      if (/^[A-Za-z_]/.test(t)) {
        if (FUNCS[t.toLowerCase()] && name(t) === null) {
          var f = FUNCS[t.toLowerCase()];
          return f(peek() === '(' ? primary() : term());
        }
        var v = name(t);
        if (v !== null) return v;
        // xy: x times y, each a variable
        var p = 1;
        for (var c = 0; c < t.length; c++) { var w = name(t[c]); if (w === null) throw 0; p *= w; }
        return p;
      }
      throw 0;
    }
    function power() { var b = primary(); if (peek() === '^' || peek() === '**') { i++; return Math.pow(b, unary()); } return b; }
    function unary() { if (peek() === '-') { i++; return -unary(); } if (peek() === '+') { i++; return unary(); } return power(); }
    function term() {
      var v = unary();
      for (;;) {
        var t = peek();
        if (t === '*') { i++; v *= unary(); } else if (t === '/') { i++; v /= unary(); }
        else if (t !== undefined && (t === '(' || /^[\\d.A-Za-z_]/.test(t))) v *= unary();
        else return v;
      }
    }
    function expr() { var v = term(); for (;;) { if (peek() === '+') { i++; v += term(); } else if (peek() === '-') { i++; v -= term(); } else return v; } }
    var v = expr();
    if (i !== toks.length) throw 0;
    return v;
  }
  function sameValues(typed, s) {
    try {
      return s.points.every(function (p, k) {
        var v = valueAt(typed, s.vars, p), w = s.values[k];
        return isFinite(v) && Math.abs(w[1]) < 1e-9 && Math.abs(v - w[0]) <= 1e-6 * Math.max(1, Math.abs(w[0]));
      });
    } catch (e) { return null; }
  }
  function show(k, ok) {
    var at = form.querySelector('[data-q="' + k.id + '"]') || form.querySelector('[name="q' + k.id + '"]');
    if (!at) return;
    var place = at.closest('p') || at.parentNode;
    var old = place.querySelector('.quiz-mark'); if (old) old.remove();
    var s = document.createElement('span'); s.className = 'quiz-mark ' + (ok ? 'quiz-right' : 'quiz-wrong');
    s.textContent = ok ? ' \\u2713 ' + words.right : ' \\u2717 ' + words.wrong; place.appendChild(s);
  }
  // the points one question gets
  function grade(k) {
    if (k.kind === 'check') {
      var got = 0, any = false, best = 0;
      form.querySelectorAll('input[name="q' + k.id + '"]:checked').forEach(function (b) { got += k.choicePoints[b.value] || 0; any = true; });
      for (var c in k.choicePoints) if (k.choicePoints[c] > 0) best += k.choicePoints[c];
      return { ok: any && got >= best, points: best ? k.points * Math.max(0, got) / best : 0 };
    }
    var ok;
    if (k.kind === 'radio' || k.kind === 'image') {
      var picked = k.kind === 'image' ? form.querySelector('input[name="q' + k.id + '"]') : form.querySelector('input[name="q' + k.id + '"]:checked');
      ok = !!picked && k.choices.indexOf(picked.value) >= 0;
    } else {
      var box = form.querySelector('input[name="q' + k.id + '"]');
      var byValue = box && box.value.trim() && k.sample ? sameValues(box.value, k.sample) : null;
      ok = !!box && (byValue !== null ? byValue : k.answer != null && same(box.value, k.answer));
    }
    return { ok: ok, points: ok ? k.points : 0 };
  }
  // an image-select question is graded when a picture is clicked (as 5.5)
  form.querySelectorAll('.quiz-image').forEach(function (b) {
    b.onclick = function () {
      var k = key.filter(function (x) { return x.id === b.dataset.q; })[0];
      form.querySelector('input[name="q' + k.id + '"]').value = b.dataset.v;
      form.querySelectorAll('.quiz-image[data-q="' + k.id + '"]').forEach(function (x) { x.classList.toggle('on', x === b); });
      show(k, grade(k).ok);
    };
  });
  var check = document.getElementById('quiz-check');
  if (check) check.onclick = function () {
    var got = 0, all = 0;
    key.forEach(function (k) {
      if (k.kind === 'text') return; // a free-form answer is for the teacher to read
      all += k.points;
      var g = grade(k);
      got += g.points;
      show(k, g.ok);
    });
    var r = function (x) { return Math.round(x * 100) / 100; };
    document.getElementById('quiz-score').textContent = words.score.replace('{0}', r(got)).replace('{1}', r(all));
  };
})();
</script>`;
  const style = '<style>.quiz-right{color:#1a7f37;font-weight:600}.quiz-wrong{color:#c00;font-weight:600}#quiz-score{font-weight:600;margin-left:1em}.quiz-image{border:2px solid transparent;background:none;padding:2px;cursor:pointer}.quiz-image.on{border-color:#3a7bd5}</style>';
  html = html.replace(/<body([^>]*)>/, `<body$1>${style}${form}`);
  html = html.replace(/<\/body>/, `${buttons}${script}</body>`);
  // Title: the page's title
  if (settings.title) html = html.replace(/<title>[^]*?<\/title>/, `<title>${esc(settings.title)}</title>`);
  return html;
}
