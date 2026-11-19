// Tools > Exam Builder (5.5): an exam template made into exams with new random values.
// A template is a document whose section headings are keywords: Exam (Quiz, Test, Homework,
// Assignment, Tutorial), Text, Setup, Part, Question, Variant, Statement, Substatement, Response
// (Choices), Answer, Solution, Comment. A Setup holds definitions (a := rand(1, 4) once; b = 1/a
// each time b is used), conditions ("Condition: (a ≠ b)") and keyword paragraphs ("Questions:
// number, permute"). \FORMULA{expr}{value}{operation} in a formula is worked out with the
// values; a choice marked \correctchoice is the right one; "InputField" is a blank to fill in.
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
    if (!k) { if (into) into.push(n); return; }
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
    else if (k === 'response' || k === 'choices') into = q.subs.length ? q.subs[q.subs.length - 1].response : q.response;
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
    if (kw && !maths.length) { settings[kw[1].toLowerCase()] = text.slice(kw[0].length).trim().toLowerCase(); continue; }
    for (const l of maths) {
      const j = await latexToMathJson(l);
      if (Array.isArray(j) && j[0] === 'Assign' && typeof j[1] === 'string') statements.push({ name: j[1], expr: j[2] });
      else if (Array.isArray(j) && j[0] === 'Equal' && typeof j[1] === 'string') statements.push({ name: j[1], expr: j[2], delayed: true });
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

// a Response's blocks -> { choices: [{ blocks, correct, fixed }], input, other: [blocks] }
function readResponse(blocks) {
  const choices = [];
  const other = [];
  let input = false;
  for (const b of blocks) {
    if (b.type.name === 'bullet_list' || b.type.name === 'ordered_list') {
      b.forEach((item) => {
        let correct = false;
        const kept = [];
        item.forEach((p) => {
          if (p.type.name !== 'paragraph') { kept.push(p); return; }
          const inl = [];
          p.forEach((c) => { if (c.type.name === 'tex_field' && /^\\correctchoice\b/.test(c.attrs.tex)) correct = true; else inl.push(c); });
          if (inl.some((c) => !(c.isText && !c.text.trim()))) kept.push(p.copy(Fragment.from(inl)));
        });
        choices.push({ blocks: kept, correct, fixed: /^fixed$/i.test(item.attrs.label || '') });
      });
    } else if (b.type.name === 'paragraph' && /^input\s*field$/i.test(b.textContent.trim())) input = true;
    else other.push(b);
  }
  return { choices, input, other };
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

// -> { doc } the exams (versions) and their answers
export async function buildExams(doc, { versions = 1, seed = null, answers = true } = {}) {
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
        const forms = [it.question, ...it.question.variants];
        const q = forms[Math.floor(rnd() * forms.length)];
        const qs = await readSetup(q.setup);
        const blocks = [q.statement, ...q.subs.flatMap((s) => [s.statement, s.response]), q.response, q.answer, q.solution];
        part.items.push({ question: q, settings: { ...part.settings, ...qs.settings } });
        pp.questions.push({ setup: qs.statements, formulas: (await Promise.all(blocks.map(formulaList))).flat() });
      }
      plan.parts.push(part);
      payload.parts.push(pp);
    }
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
        const numbered = !has(one.settings.questions, 'no number');
        n++;
        const [qOut, answer] = renderQuestion(one.question, take(one.values), one.settings, rnd, numbered ? `${n}. ` : '');
        out.push(...qOut);
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
function renderQuestion(q, next, settings, rnd, number) {
  const out = [];
  const answer = [];
  const statement = mapFormulas(q.statement, next);
  out.push(...labelled(number, statement));
  const responses = [...q.subs.map((s) => ({ statement: s.statement, response: s.response })), { statement: null, response: q.response }];
  const many = q.subs.length > 0;
  let sub = 0;
  const keyLine = [];
  for (const r of responses) {
    if (r.statement) out.push(...labelled(`(${'abcdefghij'[sub]}) `, mapFormulas(r.statement, next)));
    const res = readResponse(mapFormulas(r.response, next));
    if (!r.statement && !res.choices.length && !res.input && !res.other.length) continue;
    out.push(...res.other);
    const permute = has(settings.choices, 'permute') && !has(settings.choices, 'no permute');
    const free = res.choices.filter((c) => !c.fixed);
    const chosen = [...(permute ? shuffle(free, rnd) : free), ...res.choices.filter((c) => c.fixed)];
    const right = [];
    chosen.forEach((c, i) => {
      out.push(...labelled(`(${LETTERS[i]}) `, c.blocks));
      if (c.correct) right.push(LETTERS[i]);
    });
    if (res.input) out.push(para(text(_t('Answer: __________'))));
    if (right.length) keyLine.push((many && r.statement ? `(${'abcdefghij'[sub]}) ` : '') + right.map((x) => `(${x})`).join(' '));
    if (r.statement) sub++;
  }
  if (keyLine.length) answer.push(para(text(keyLine.join('　'))));
  answer.push(...mapFormulas(q.answer, next), ...mapFormulas(q.solution, next));
  return [out, answer];
}
