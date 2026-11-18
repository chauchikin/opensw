import { _t } from './i18n.js';
// Compute > Check with Lean: an equation of the document (a = b, with numbers and
// variables) becomes a Lean 4 theorem over the real numbers, which the desktop app
// gives to the Lean installed on the computer (with Mathlib). Lean either proves it
// (norm_num for numbers, ring / field_simp for identities with variables) or says
// it could not.

class Unsupported extends Error {}

const BIN = { Add: '+', Multiply: '*', Subtract: '-' };

// MathJSON -> Lean term; vars collects the variables
// nonzero collects denominators that contain variables (they become hypotheses x ≠ 0)
function term(j, vars, nonzero) {
  if (typeof j === 'number') return String(j);
  if (typeof j === 'string') {
    if (/^[a-zA-Z]$/.test(j)) { vars.add(j); return j; }
    if (j === 'Pi') return 'Real.pi';
    if (j === 'ExponentialE') return 'Real.exp 1';
    if (j === 'Half') return '(1/2 : ℝ)';
    throw new Unsupported(_t('不認得的符號 {0}', j));
  }
  if (!Array.isArray(j)) {
    if (j && typeof j === 'object' && 'num' in j) return String(j.num);
    throw new Unsupported(_t('不認得的寫法'));
  }
  const [h, ...a] = j;
  const t = (x) => term(x, vars, nonzero);
  if (h === 'Number') return t(+a[0]);
  if (BIN[h]) return `(${a.map(t).join(` ${BIN[h]} `)})`;
  if (h === 'InvisibleOperator') return `(${a.map(t).join(' * ')})`;
  if (h === 'Negate') return `(-${t(a[0])})`;
  if (h === 'Divide' || h === 'Rational') {
    nonzeroFactors(a[1], t, nonzero);
    return `(${t(a[0])} / ${t(a[1])})`;
  }
  if (h === 'Power') {
    const e = Array.isArray(a[1]) && a[1][0] === 'Negate' && Number.isInteger(a[1][1]) ? -a[1][1] : a[1];
    if (Number.isInteger(e) && e >= 0) return `(${t(a[0])} ^ ${e})`;
    if (Number.isInteger(e) && e < 0) return t(['Divide', 1, ['Power', a[0], -e]]);
    throw new Unsupported(_t('只認得整數次方'));
  }
  if (h === 'Square') return `(${t(a[0])} ^ 2)`;
  if (h === 'Sqrt') return `(Real.sqrt ${t(a[0])})`;
  if (h === 'Delimiter') return t(a[0]);
  throw new Unsupported(_t('還不能檢查 {0}', h));
}

// a denominator x·(y+1)² is nonzero when x ≠ 0 and y+1 ≠ 0: one hypothesis per factor
function nonzeroFactors(j, t, nonzero) {
  const h = Array.isArray(j) ? j[0] : null;
  if (h === 'Multiply' || h === 'InvisibleOperator') return j.slice(1).forEach((f) => nonzeroFactors(f, t, nonzero));
  if ((h === 'Power' && Number.isInteger(j[2]) && j[2] > 0) || h === 'Square' || h === 'Delimiter') return nonzeroFactors(j[1], t, nonzero);
  const s = t(j);
  if (/[a-zA-Z]/.test(s.replace(/Real\.\w+/g, ''))) nonzero.add(s);
}

// a formula "a = b" (or "a = b = c": every pair) -> { code, statement } or throws
export function leanTheorem(mathjson, latex) {
  if (!Array.isArray(mathjson) || mathjson[0] !== 'Equal' || mathjson.length < 3) throw new Unsupported(_t('要寫成等式 a = b'));
  const vars = new Set(), nonzero = new Set();
  const sides = mathjson.slice(1).map((x) => term(x, vars, nonzero));
  // every side is a real number (otherwise Lean would read 1/2 as a natural number, 0)
  const goals = [];
  for (let i = 0; i + 1 < sides.length; i++) goals.push(`(${sides[i]} : ℝ) = ${sides[i + 1]}`);
  const binders = vars.size ? `(${[...vars].sort().join(' ')} : ℝ) ` : '';
  const hyps = [...nonzero].map((d, i) => `(h${i + 1} : ${d} ≠ 0) `).join('');
  const statement = `theorem opensw_check ${binders}${hyps}: ${goals.join(' ∧ ')}`;
  // a proof: arithmetic, then polynomial identities, then identities with fractions.
  // ring leaves a goal open instead of failing (it falls back to ring_nf), hence the "done"s
  const tactic = goals.length > 1 ? `refine ⟨${goals.map(() => '?_').join(', ')}⟩ <;> ` : '';
  const code = [
    'import Mathlib',
    '',
    `-- opensw: ${latex.replace(/\n/g, ' ')}`,
    `${statement} := by`,
    `  ${tactic}first | (norm_num; done) | (ring; done) | (field_simp; done) | (field_simp; ring; done)`,
    '',
    '#print axioms opensw_check',
    '',
  ].join('\n');
  return { code, statement };
}

// Lean's output -> { ok, message }: proved, with only the standard axioms
export function leanVerdict(output, exitOk) {
  const errors = output.split('\n').filter((l) => /error/.test(l));
  if (!exitOk || errors.length) return { ok: false, message: _t('Lean 沒有證出來：可能不成立，或自動證明的方法不夠用。') };
  const axioms = (output.match(/depends on axioms: \[([^\]]*)\]/) || [, ''])[1].split(',').map((s) => s.trim()).filter(Boolean);
  const extra = axioms.filter((a) => !['propext', 'Classical.choice', 'Quot.sound'].includes(a));
  if (extra.length) return { ok: false, message: _t('用到了不標準的公理：') + extra.join(_t('、')) };
  return { ok: true, message: _t('Lean 4 檢查通過') };
}

export { Unsupported };
