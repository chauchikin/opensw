// Tools > Exam Builder (5.5): an exam template made into exams with new random values.
// A template is a document whose section headings are keywords: Exam (Quiz, Test, Homework,
// Assignment, Tutorial), Text, Setup, Part, Question, Variant, Statement, Substatement, Response
// (Choices), Answer, Solution, Comment. A Setup holds definitions (a := rand(1, 4) once; b = 1/a
// each time b is used), conditions ("Condition: (a ≠ b)") and keyword paragraphs ("Questions:
// number, permute"). \FORMULA{expr}{value}{operation} in a formula is worked out with the
// values; a choice marked \correctchoice is the right one; "InputField" is a blank to fill in.
// The keyword paragraphs of a Setup (5.5's Exam Builder reference, ebrefkeyword.tex; an Exam's,
// a Part's or a Question's Setup, the nearest one counts):
//   Questions: Number, Permute (No ...)   number the questions (they are not numbered otherwise);
//                        shuffle them
//   Choices: Break | No Break, Permute, Radio Buttons | Check   choices one a line or on one
//                        line; shuffled; one right answer, or check boxes, each choice worth the
//                        points of its item label (\item[-1], \item[1])
//   Choice Space: 2      the space between choices on one line (No Break), in em
//   Question Space: 1    empty lines after each question
//   Print Choices: a, b, c   what a printed exam shows instead of the buttons (default (A), (B) ...)
//   Select: 2            (a Question's) how many of its variants to ask, each a question
//   Points: 6            what the question is worth (the online quiz's score)
//   Text Area: 5, 60     the size of a free-form Response area (lines, characters)
//   Images: a.bmp, b.bmp the pictures an image-select question shows instead of buttons (online)
//   InputField(MATH) and GradeProc: givecredit(response = ...) in Choices: a blank and its answer
//   Title, Submit, Action, Method, Database, ItemId, Record: the online quiz page (examquiz.js)
//   Compute, CSTFile, Errors, OutputTap: about 5.5's own quiz program; read and not used
import { Fragment } from 'prosemirror-model';
import { schema } from './schema.js';
import { latexToMathJson, examFormulas } from './compute.js';
import { _t } from './i18n.js';

const FILE_WORDS = ['exam', 'quiz', 'test', 'homework', 'assignment', 'tutorial'];
const SECTION_WORDS = ['text', 'setup', 'part', 'question', 'variant', 'statement', 'substatement', 'response', 'choices', 'answer', 'solution', 'comment'];
const keyword = (node) => {
  if (node.type.name !== 'heading') return null;
  const w = node.textContent.trim().split(/\s+/)[0].toLowerCase();
  return FILE_WORDS.includes(w) ? 'exam' : SECTION_WORDS.includes(w) ? w : null;
};

// a template is a document with an Exam (Quiz, Test ...) heading and a Question
export function isTemplate(doc) {
  let file = false;
  let question = false;
  doc.forEach((n) => { const k = keyword(n); if (k === 'exam') file = true; if (k === 'question') question = true; });
  return file && question;
}

// GradeProc: givecredit(response = x ln bx - x): the right side is worked out with the question's
// values like a \FORMULA, for the online quiz to compare the answer with
function gradeProcFormula(n) {
  if (n.type.name !== 'paragraph' || !/^\s*GradeProc\s*:/i.test(n.textContent)) return n;
  const kids = [];
  n.forEach((c) => {
    const m = c.type.name === 'math_inline' && c.attrs.latex.match(/^([^]*?response\}?\s*=)([^]*)$/);
    const expr = m && m[2].replace(/\\allowbreak\s*/g, '').trim();
    // its value, and its values at a few points (for the quiz page to compare a typed answer with)
    kids.push(m && !/\\FORMULA/.test(m[2]) ? c.type.create({ ...c.attrs, latex: `${m[1]}\\FORMULA{${expr}}{}{evaluate}\\FORMULA{${expr}}{}{opensw-sample}` }) : c);
  });
  return n.copy(Fragment.from(kids));
}

// the template's parts, questions and texts, in order
function parseTemplate(doc) {
  const exam = { setup: [], items: [] };
  let part = null;
  let q = null; // the question (or variant) being read
  let into = null; // where blocks go
  const newPart = () => { part = { setup: [], items: [] }; exam.items.push({ part }); return part; };
  const newQuestion = () => ({ setup: [], statement: [], subs: [], response: [], answer: [], solution: [], variants: [] });
  doc.forEach((n) => {
    const k = keyword(n);
    if (!k) { if (into) into.push(gradeProcFormula(n)); return; }
    if (k === 'exam' || k === 'comment') { into = null; return; }
    if (k === 'part') { newPart(); q = null; into = null; return; }
    if (k === 'question') { q = newQuestion(); q.top = q; (part || newPart()).items.push({ question: q }); into = q.statement; return; }
    if (k === 'variant' && q) { const v = newQuestion(); q.top.variants.push(v); v.top = q.top; q = v; into = v.statement; return; }
    if (k === 'text') {
      const blocks = [];
      (q || part ? (part || newPart()).items : exam.items).push({ text: blocks });
      q = null;
      into = blocks;
      return;
    }
    if (k === 'setup') { into = q ? q.setup : part ? part.setup : exam.setup; return; }
    if (!q) { into = null; return; }
    if (k === 'statement') into = q.statement;
    else if (k === 'substatement') { const s = { statement: [], response: [] }; q.subs.push(s); into = s.statement; }
    else if (k === 'response' || k === 'choices') {
      const at = q.subs.length ? q.subs[q.subs.length - 1] : q;
      at.kind = k; // Response: a free-form answer area (Text Area); Choices: choices or a blank
      into = at.response;
    }
    else if (k === 'answer') into = q.answer;
    else if (k === 'solution') into = q.solution;
  });
  return exam;
}

// a Setup's paragraphs -> { statements (definitions, conditions), settings { questions: '...' } }
async function readSetup(blocks) {
  const statements = [];
  const settings = {};
  for (const b of blocks) {
    if (b.type.name !== 'paragraph') continue;
    const text = b.textContent.trim();
    const kw = text.match(/^([A-Za-z][A-Za-z ]*?)\s*:/);
    const maths = [];
    b.forEach((c) => { if (c.type.name === 'math_inline') maths.push(c.attrs.latex); });
    if (kw && /^conditions?$/i.test(kw[1])) {
      for (const l of maths) statements.push({ cond: await latexToMathJson(l) });
      continue;
    }
    if (kw && !maths.length) {
      const key = kw[1].trim().toLowerCase().replace(/\s+/g, ' ');
      settings[key] = text.slice(kw[0].length).trim().toLowerCase();
      settings['raw ' + key] = text.slice(kw[0].length).trim(); // as written (an address for Action)
      continue;
    }
    for (const l of maths) {
      // v := ..: its two sides read apart (u_{1} := .. read whole is a subscripted function)
      const set = l.match(/^([^]*?):=([^]*)$/);
      if (set) {
        const [name, expr] = [await latexToMathJson(set[1]), await latexToMathJson(set[2])];
        if (typeof name === 'string') { statements.push({ name, expr }); continue; }
      }
      const j = await latexToMathJson(l);
      if (Array.isArray(j) && j[0] === 'Assign' && typeof j[1] === 'string') statements.push({ name: j[1], expr: j[2] });
      else if (Array.isArray(j) && j[0] === 'Equal' && typeof j[1] === 'string') statements.push({ name: j[1], expr: j[2], delayed: true });
      // a function: f(x, n) = .. (used in the questions' formulas and GradeProc)
      else if (Array.isArray(j) && j[0] === 'Equal' && Array.isArray(j[1]) && typeof j[1][0] === 'string' && j[1].length > 1 && j[1].slice(1).every((x) => typeof x === 'string')) {
        statements.push({ name: j[1][0], params: j[1].slice(1), expr: j[2] });
      }
    }
  }
  return { statements, settings };
}

// \FORMULA{expr}{value}{operation} in a formula's LaTeX: -> [{ start, end, expr, op }]
function formulasIn(latex) {
  const out = [];
  for (let k = latex.indexOf('\\FORMULA{'); k >= 0; k = latex.indexOf('\\FORMULA{', k + 1)) {
    const args = [];
    let j = k + 8;
    for (let n = 0; n < 3 && latex[j] === '{'; n++) {
      let depth = 0;
      const start = j;
      for (; j < latex.length; j++) {
        if (latex[j] === '\\') { j++; continue; }
        if (latex[j] === '{') depth++;
        else if (latex[j] === '}' && --depth === 0) break;
      }
      args.push(latex.slice(start + 1, j));
      j++;
    }
    if (args.length === 3) out.push({ start: k, end: j, expr: args[0], op: args[2] });
  }
  return out;
}

// the \FORMULAs in these blocks, in reading order; with next(): the blocks with each one
// replaced by next() (the values in the same order)
function mapFormulas(blocks, next) {
  const found = [];
  const fix = (node) => {
    if (node.type.name === 'math_inline' || node.type.name === 'math_display') {
      const fs = formulasIn(node.attrs.latex);
      if (!fs.length) return node;
      found.push(...fs);
      if (!next) return node;
      const values = fs.map(() => next());
      let latex = node.attrs.latex;
      for (let i = fs.length - 1; i >= 0; i--) latex = latex.slice(0, fs[i].start) + `{${values[i]}}` + latex.slice(fs[i].end);
      return node.type.create({ ...node.attrs, latex }, node.content, node.marks);
    }
    if (node.isText || !node.content.size) return node;
    const kids = [];
    node.forEach((c) => kids.push(fix(c)));
    return next ? node.copy(Fragment.from(kids)) : node;
  };
  const out = blocks.map(fix);
  return next ? out : found;
}

// seeded random numbers (the same seed gives the same exam)
function randomFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffle = (list, rnd) => { const l = [...list]; for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; };
const has = (setting, word) => new RegExp(`(^|,)\\s*${word}\\s*(,|$)`).test(setting || '');
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const pointsOf = (settings) => { const p = Number(String(settings.points ?? '').trim()); return settings.points != null && Number.isFinite(p) && p >= 0 ? p : null; };
const numbers = (setting) => String(setting || '').split(/[\s,x×]+/).map(Number).filter((x) => Number.isFinite(x) && x > 0);
// Print Choices: a, b, c -> the labels; none: (A), (B) ...
const choiceLabels = (settings) => (settings['raw print choices'] || '').split(',').map((x) => x.trim()).filter(Boolean);
// an invisible mark in the text for the online quiz: a choice (Q<id>:<letter>) or a blank (I<id>)
export const QUIZ_MARK = '\u2063';

// a Choices or Response section's blocks -> { choices: [{ blocks, correct, fixed, points }], input,
// grade (GradeProc's answer, LaTeX), other: [blocks] }. A choice is right when it has \correctchoice
// (a TeX field, or in a formula), or an item label that is a positive number (Choices: Check)
function readResponse(blocks) {
  const choices = [];
  const other = [];
  let input = false;
  let grade = null;
  let sample = null; // GradeProc's answer at a few points: { vars, points, values }
  for (const b of blocks) {
    if (b.type.name === 'bullet_list' || b.type.name === 'ordered_list') {
      b.forEach((item) => {
        let correct = false;
        const kept = [];
        item.forEach((p) => {
          if (p.type.name !== 'paragraph') { kept.push(p); return; }
          const inl = [];
          p.forEach((c) => {
            if (c.type.name === 'tex_field' && /^\\correctchoice\b/.test(c.attrs.tex)) correct = true;
            else if (c.type.name === 'math_inline' && /\\correctchoice\b/.test(c.attrs.latex)) {
              correct = true;
              const rest = c.attrs.latex.replace(/\\correctchoice\s*(\{\s*\})?/g, '').trim();
              if (rest) inl.push(c.type.create({ ...c.attrs, latex: rest }));
            } else inl.push(c);
          });
          if (inl.some((c) => !(c.isText && !c.text.trim()))) kept.push(p.copy(Fragment.from(inl)));
        });
        const label = (item.attrs.label || '').trim();
        const points = /^[-+]?\d+(\.\d+)?$/.test(label) ? Number(label) : null;
        if (points != null && points > 0) correct = true;
        choices.push({ blocks: kept, correct, fixed: /^fixed\b/i.test(label), points });
      });
    } else if (b.type.name === 'paragraph' && /^input\s*field\s*(\(\s*\w*\s*\))?$/i.test(b.textContent.trim())) input = true;
    else if (b.type.name === 'paragraph' && /^\s*GradeProc\s*:/i.test(b.textContent)) {
      b.forEach((c) => {
        const m = c.type.name === 'math_inline' && c.attrs.latex.match(/response\}?\s*=\s*\{([^]*)\}\{SAMPLE:([^]*)\}\s*$/);
        if (m) { grade = m[1].trim(); try { sample = JSON.parse(m[2]); } catch (e) { /* only the text then */ } } else {
          const t = c.type.name === 'math_inline' && c.attrs.latex.match(/response\}?\s*=([^]*)$/);
          if (t) grade = t[1].trim();
        }
      });
    } else other.push(b);
  }
  return { choices, input, grade, sample, other };
}

const para = (...inline) => schema.nodes.paragraph.create(null, inline.flat().filter(Boolean));
const text = (s) => (s ? schema.text(s) : null);
// a label in front of the first paragraph of these blocks ("3. ", "(B) ")
function labelled(label, blocks) {
  if (!label) return blocks;
  if (!blocks.length) return [para(text(label))];
  const [first, ...rest] = blocks;
  if (first.type.name !== 'paragraph') return [para(text(label)), ...blocks];
  return [first.copy(Fragment.from(schema.text(label)).append(first.content)), ...rest];
}

// the Exam's own Setup settings for the online quiz (Title, Submit, Action, Method, Database,
// ItemId, Record), as written
export function examSettings(doc) {
  const out = {};
  let inSetup = false, before = true;
  doc.forEach((n) => {
    const k = keyword(n);
    if (k) { inSetup = k === 'setup' && before; if (k === 'question' || k === 'part') before = false; return; }
    if (!inSetup || n.type.name !== 'paragraph') return;
    const m = n.textContent.trim().match(/^(Title|Submit|Action|Method|Database|ItemId|Record)\s*:\s*(.*)$/i);
    if (m) out[m[1].toLowerCase()] = m[2].trim();
  });
  return out;
}

// -> { doc } the exams (versions) and their answers
// quiz: an array to fill with the online quiz's key (one version, no answers; the choices and
// blanks are marked in the text, see examquiz.js)
export async function buildExams(doc, { versions = 1, seed = null, answers = true, quiz = null } = {}) {
  if (quiz) { versions = 1; answers = false; }
  const t = parseTemplate(doc);
  const top = await readSetup(t.setup);
  const baseSeed = seed ?? (Number(top.settings.seed) || Math.floor(Math.random() * 2 ** 31));
  const out = [];
  const key = [];
  for (let v = 0; v < versions; v++) {
    key.length = 0;
    const rnd = randomFrom(baseSeed + v * 7919);
    if (versions > 1) out.push(schema.nodes.heading.create({ level: 1, nonum: true }, text(_t('Version {0}', v + 1))));
    // the parts and questions of this version (a question with variants: one of them, at random)
    const plan = { texts: [], parts: [] };
    const payload = { seed: baseSeed + v * 7919, setup: top.statements, formulas: [], parts: [] };
    for (const item of t.items) {
      if (item.text) { plan.texts.push(item.text); payload.formulas.push(...(await formulaList(item.text))); continue; }
      const p = item.part;
      const ps = await readSetup(p.setup);
      const part = { settings: { ...top.settings, ...ps.settings }, items: [] };
      const pp = { setup: ps.statements, formulas: [], questions: [] };
      for (const it of p.items) {
        if (it.text) { part.items.push({ text: it.text }); pp.formulas.push(...(await formulaList(it.text))); continue; }
        // a question with variants: one of them at random, or as many as its Select says (each a
        // question); a Question whose own text is empty (only a Setup, then Variants) is not one
        const top = it.question;
        const ts = await readSetup(top.setup);
        const own = [top.statement, top.response, ...top.subs.map((x) => x.statement)].some((b) => b.length);
        const forms = [...(own || !top.variants.length ? [top] : []), ...top.variants];
        const select = Math.round(Number({ ...part.settings, ...ts.settings }.select)) || 1;
        const picked = select <= 1 ? [forms[Math.floor(rnd() * forms.length)]] : shuffle(forms, rnd).slice(0, select).sort((a, b) => forms.indexOf(a) - forms.indexOf(b));
        for (const q of picked) {
          const qs = q === top ? ts : await readSetup(q.setup);
          const blocks = [q.statement, ...q.subs.flatMap((x) => [x.statement, x.response]), q.response, q.answer, q.solution];
          part.items.push({ question: q, settings: { ...part.settings, ...ts.settings, ...qs.settings } });
          pp.questions.push({ setup: q === top ? ts.statements : [...ts.statements, ...qs.statements], formulas: (await Promise.all(blocks.map(formulaList))).flat() });
        }
      }
      plan.parts.push(part);
      payload.parts.push(pp);
    }
    globalThis.swExamPayloadForTests = payload; // (for tests)
    const values = await examFormulas(payload);
    // the exam, the formulas replaced by their values
    let n = 0;
    const take = (list) => { let i = 0; return () => list[i++]; };
    const textValues = take(values.formulas);
    let textIndex = 0;
    for (const item of t.items) {
      if (!item.text) continue;
      out.push(...mapFormulas(plan.texts[textIndex++], textValues));
    }
    plan.parts.forEach((part, pi) => {
      const pv = values.parts[pi];
      const partText = take(pv.formulas);
      let qi = 0;
      const items = part.items.map((it) => (it.question ? { ...it, values: pv.questions[qi++].formulas } : it));
      const questions = items.filter((it) => it.question);
      const permute = has(part.settings.questions, 'permute') && !has(part.settings.questions, 'no permute');
      const order = permute ? shuffle(questions, rnd) : questions;
      let k = 0;
      for (const it of items) {
        if (it.text) { out.push(...mapFormulas(it.text, partText)); continue; }
        const one = order[k++];
        // Questions: Number numbers them (5.5: not numbered without it)
        const numbered = has(one.settings.questions, 'number') && !has(one.settings.questions, 'no number');
        n++;
        const points = pointsOf(one.settings) ?? 1;
        const [qOut, answer] = renderQuestion(one.question, take(one.values), one.settings, rnd, numbered ? `${n}. ` : '', quiz && { list: quiz, id: n, points });
        out.push(...qOut);
        // Question Space: empty lines after it
        for (let i = 0; i < Math.min(50, Math.round(numbers(one.settings['question space'])[0] || 0)); i++) out.push(para());
        // the answers: by the question's number (an unnumbered question with an answer: by its place)
        if (numbered || answer.length) key.push(...labelled(numbered ? `${n}. ` : _t('(Question {0}, no number)', n), answer.length ? answer : [para(text(_t('(no model answer)')))]));
      }
    });
    if (answers) {
      out.push(schema.nodes.heading.create({ level: 2, nonum: true }, text(versions > 1 ? _t('Answers for version {0}', v + 1) : _t('Answers'))), ...key.splice(0));
    }
  }
  return schema.nodes.doc.create(null, out.length ? out : [para()]);
}

// the \FORMULAs of these blocks as [MathJSON, operation] for the engine
async function formulaList(blocks) {
  const out = [];
  for (const f of mapFormulas(blocks)) out.push([await latexToMathJson(f.expr), f.op]);
  return out;
}

// one question -> [its blocks in the exam, its answer (correct choices, Answer, Solution)]
// quiz: { list, id, points }: marks the choices, blanks and answer areas, and puts the key in list
function renderQuestion(q, next, settings, rnd, number, quiz = null) {
  const out = [];
  const answer = [];
  const statement = mapFormulas(q.statement, next);
  out.push(...labelled(number, statement));
  const responses = [...q.subs.map((s) => ({ statement: s.statement, response: s.response, kind: s.kind })), { statement: null, response: q.response, kind: q.kind }];
  const many = q.subs.length > 0;
  let sub = 0;
  const keyLine = [];
  const parts = []; // the online quiz's key for this question
  const printed = choiceLabels(settings);
  const check = has(settings.choices, 'check');
  const oneLine = has(settings.choices, 'no break');
  const gap = '\u2003'.repeat(Math.max(1, Math.min(20, Math.round(numbers(settings['choice space'])[0] || 1))));
  for (const r of responses) {
    if (r.statement) out.push(...labelled(`(${'abcdefghij'[sub]}) `, mapFormulas(r.statement, next)));
    const res = readResponse(mapFormulas(r.response, next));
    const freeForm = r.kind === 'response' && !res.choices.length && !res.input;
    if (!r.statement && !res.choices.length && !res.input && !res.other.length && !freeForm) continue;
    out.push(...res.other);
    const permute = has(settings.choices, 'permute') && !has(settings.choices, 'no permute');
    const free = res.choices.filter((c) => !c.fixed);
    const chosen = [...(permute ? shuffle(free, rnd) : free), ...res.choices.filter((c) => c.fixed)];
    const qid = quiz ? `${quiz.id}${many && r.statement ? 'abcdefghij'[sub] : ''}` : '';
    const mark = (s) => (quiz ? `${QUIZ_MARK}${s}${QUIZ_MARK}` : '');
    // what a printed exam shows instead of a button: Print Choices' items, else (A), (B) ...
    const labelOf = (i) => printed[i] ?? `(${LETTERS[i]})`;
    const right = [];
    const line = [];
    chosen.forEach((c, i) => {
      const l = `${mark(`Q${qid}:${LETTERS[i]}`)}${labelOf(i)} `;
      // Choices: No Break: on one line, Choice Space apart (a choice of one paragraph)
      if (oneLine && c.blocks.length <= 1 && (!c.blocks[0] || c.blocks[0].type.name === 'paragraph')) {
        line.push(schema.text((i ? gap : '') + l), ...(c.blocks[0] ? c.blocks[0].content.content : []));
      } else out.push(...labelled(l, c.blocks));
      if (c.correct) right.push(i);
    });
    if (line.length) out.push(para(line));
    if (res.input) out.push(para(text(quiz ? mark(`I${qid}`) : _t('Answer: __________'))));
    // a Response section: a free-form answer area, Text Area lines high
    const [rows, cols] = numbers(settings['text area']);
    if (freeForm) {
      if (quiz) out.push(para(text(mark(`T${qid}:${rows || 3}:${cols || 60}`))));
      else for (let i = 0; i < Math.min(60, rows || 3); i++) out.push(para());
    }
    if (quiz && (chosen.length || res.input || freeForm)) {
      const images = (settings['raw images'] || '').split(',').map((x) => x.trim()).filter(Boolean);
      parts.push(chosen.length
        ? { id: qid, kind: images.length ? 'image' : check ? 'check' : 'radio', choices: right.map((i) => LETTERS[i]),
          ...(check && { choicePoints: Object.fromEntries(chosen.map((c, i) => [LETTERS[i], c.points ?? (c.correct ? 1 : 0)])) }),
          ...(images.length && { images: chosen.map((c, i) => images[i % images.length]) }) }
        : res.input ? { id: qid, kind: 'input', grade: res.grade, sample: res.sample } : { id: qid, kind: 'text' });
    }
    if (right.length) keyLine.push((many && r.statement ? `(${'abcdefghij'[sub]}) ` : '') + right.map((i) => labelOf(i)).join(' '));
    if (r.statement) sub++;
  }
  if (keyLine.length) answer.push(para(text(keyLine.join('　'))));
  const model = mapFormulas(q.answer, next);
  answer.push(...model, ...mapFormulas(q.solution, next));
  // (a question with several parts: its points shared among them; a free-form one is not graded)
  if (quiz) {
    const graded = parts.filter((x) => x.kind !== 'text');
    for (const x of parts) {
      quiz.list.push({ ...x, points: x.kind === 'text' ? 0 : quiz.points / graded.length,
        ...(x.kind === 'input' && { answer: x.grade ? x.grade.replace(/^\{([^]*)\}$/, '$1') : plainAnswer(model) }) });
      delete quiz.list.at(-1).grade;
    }
  }
  return [out, answer];
}

// the model answer of a blank (InputField) as plain text for the online quiz to compare with:
// its text and formulas (their LaTeX, the \FORMULAs with their values)
function plainAnswer(blocks) {
  let s = '';
  for (const b of blocks) b.descendants((c) => { if (c.isText) s += c.text; else if (c.type.name.startsWith('math')) s += c.attrs.latex; });
  return s.trim();
}
