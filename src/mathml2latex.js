// MathML (as written by Scientific Word) -> LaTeX for the formula editor.
import { splitMathAlphaString } from './mathalpha.js';

const SYMBOLS = {
  'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ε': '\\epsilon', 'ϵ': '\\epsilon',
  'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ϑ': '\\vartheta', 'ι': '\\iota', 'κ': '\\kappa',
  'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'π': '\\pi', 'ϖ': '\\varpi', 'ρ': '\\rho',
  'ϱ': '\\varrho', 'σ': '\\sigma', 'ς': '\\varsigma', 'τ': '\\tau', 'υ': '\\upsilon', 'φ': '\\phi',
  'ϕ': '\\phi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega', 'Γ': '\\Gamma', 'Δ': '\\Delta',
  'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi', 'Π': '\\Pi', 'Σ': '\\Sigma', 'Υ': '\\Upsilon',
  'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
  '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∬': '\\iint', '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap',
  '≤': '\\le', '≥': '\\ge', '≠': '\\ne', '≈': '\\approx', '≡': '\\equiv', '∼': '\\sim', '≅': '\\cong',
  '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow',
  '⇔': '\\Leftrightarrow', '↦': '\\mapsto', '∈': '\\in', '∉': '\\notin', '∋': '\\ni', '⊂': '\\subset',
  '⊃': '\\supset', '⊆': '\\subseteq', '⊇': '\\supseteq', '∪': '\\cup', '∩': '\\cap', '∅': '\\emptyset',
  '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla', '×': '\\times', '⋅': '\\cdot', '·': '\\cdot',
  '÷': '\\div', '±': '\\pm', '∓': '\\mp', '∘': '\\circ', '∀': '\\forall', '∃': '\\exists', '¬': '\\neg',
  '∧': '\\wedge', '∨': '\\vee', '⊕': '\\oplus', '⊗': '\\otimes', '…': '\\ldots', '⋯': '\\cdots',
  '⋮': '\\vdots', '⋱': '\\ddots', '′': "'", '″': "''", '⟨': '\\langle', '⟩': '\\rangle', '〈': '\\langle',
  '〉': '\\rangle', '|': '|', '‖': '\\|', '−': '-', 'ℓ': '\\ell', 'ℏ': '\\hbar', '∣': '\\mid',
  '{': '\\{', '}': '\\}', '%': '\\%', '#': '\\#', '&': '\\&', '_': '\\_', '$': '\\$',
};
const INVISIBLE = /[⁡⁢⁣⁤​]/g;
const FUNCS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'exp', 'lim', 'max', 'min',
  'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'gcd', 'arg', 'sinh', 'cosh', 'tanh', 'arcsin', 'arccos', 'arctan',
  'limsup', 'liminf', 'Pr', 'hom']);
const VARIANT = { 'double-struck': '\\mathbb', script: '\\mathcal', 'bold-script': '\\mathcal', fraktur: '\\mathfrak',
  'bold-fraktur': '\\mathfrak', bold: '\\mathbf', 'bold-italic': '\\boldsymbol', 'sans-serif': '\\mathsf',
  'bold-sans-serif': '\\mathsf', 'sans-serif-italic': '\\mathsf', 'sans-serif-bold-italic': '\\mathsf',
  monospace: '\\mathtt', italic: '\\mathit', normal: '\\mathrm' };

function sym(text) {
  let out = '';
  for (const ch of text.replace(INVISIBLE, '')) {
    out += SYMBOLS[ch] ? SYMBOLS[ch] + (/[a-zA-Z]$/.test(SYMBOLS[ch]) ? ' ' : '') : ch;
  }
  return out;
}

const kids = (el) => Array.from(el.children);
// a single character, a single command (\sum, \alpha) or one like \mathbb{B} needs no braces;
// braces around \sum would also stop its limits from being placed above/below
const group = (s) => (s.length === 1 || /^\\[a-zA-Z]+ ?$/.test(s) || /^\\[a-zA-Z]+\{[^{}]*\}$/.test(s) ? s.trim() : '{' + s + '}');

function conv(el) {
  const tag = el.localName;
  const text = () => el.textContent.trim();
  switch (tag) {
    case 'math': case 'mrow': case 'mstyle': case 'mpadded': case 'semantics': case 'menclose':
    case 'mphantom': case 'merror':
      return row(el);
    case 'annotation': case 'annotation-xml': case 'none': case 'mprescripts':
      return '';
    case 'mi': {
      let t = text();
      let v = el.getAttribute('mathvariant');
      if (t === '∣') return '|';
      const alpha = splitMathAlphaString(t); // 𝔹 -> \mathbb{B}
      if (alpha) { [v, t] = alpha; if (v === 'italic') return t; }
      if (v === 'normal' && t.length === 1 && /[A-Za-z]/.test(t)) return '\\mathrm{' + t + '}';
      if (v === 'normal') v = null;
      if (v && VARIANT[v]) return VARIANT[v] + '{' + sym(t) + '}';
      if (FUNCS.has(t)) return '\\' + t + ' ';
      if (t.length > 1 && /^[A-Za-z]+$/.test(t)) return '\\operatorname{' + t + '}';
      return sym(t);
    }
    case 'mn': return sym(text());
    case 'mo': {
      const t = text().replace(INVISIBLE, '');
      if (!t) return '';
      if (FUNCS.has(t)) return '\\' + t + ' ';
      return sym(t);
    }
    case 'mtext': {
      const t = el.textContent;
      if (!t.trim()) return '\\ ';
      return '\\text{' + t.replace(/([{}\\])/g, '\\$1') + '}';
    }
    case 'mspace': return '\\,';
    case 'msup': { const [a, b] = kids(el); return group(conv(a)) + '^' + group(conv(b)); }
    case 'msub': { const [a, b] = kids(el); return group(conv(a)) + '_' + group(conv(b)); }
    case 'msubsup': { const [a, b, c] = kids(el); return group(conv(a)) + '_' + group(conv(b)) + '^' + group(conv(c)); }
    case 'munder': { const [a, b] = kids(el); return accentUnder(a, b); }
    case 'mover': { const [a, b] = kids(el); return accentOver(a, b); }
    case 'munderover': { const [a, b, c] = kids(el); return group(conv(a)) + '_' + group(conv(b)) + '^' + group(conv(c)); }
    case 'mfrac': {
      const [a, b] = kids(el);
      if (el.getAttribute('linethickness') === '0') return '\\binom{' + conv(a) + '}{' + conv(b) + '}';
      return '\\frac{' + conv(a) + '}{' + conv(b) + '}';
    }
    case 'msqrt': return '\\sqrt{' + row(el) + '}';
    case 'mroot': { const [a, b] = kids(el); return '\\sqrt[' + conv(b) + ']{' + conv(a) + '}'; }
    case 'mfenced': {
      const open = el.getAttribute('open') ?? '(';
      const close = el.getAttribute('close') ?? ')';
      const sep = el.getAttribute('separators') ?? ',';
      const parts = kids(el).map(conv);
      return '\\left' + delim(open) + parts.join(sep.trim()[0] || '') + '\\right' + delim(close);
    }
    case 'mtable': {
      const rows = kids(el).filter((r) => r.localName === 'mtr' || r.localName === 'mlabeledtr')
        .map((r) => kids(r).filter((c) => c.localName === 'mtd').map(conv).join(' & '));
      return '\\begin{matrix}' + rows.join('\\\\') + '\\end{matrix}';
    }
    case 'mtd': case 'mtr': return row(el);
    case 'mmultiscripts': return row(el);
    default:
      return row(el);
  }
}

const MATRIX_ENV = { '()': 'pmatrix', '[]': 'bmatrix', '{}': 'Bmatrix', '||': 'vmatrix', '‖‖': 'Vmatrix' };

// "( table )" written as three siblings -> pmatrix (and the other bracket kinds)
function matrixAt(ks, i) {
  const [a, t, b] = [ks[i], ks[i + 1], ks[i + 2]];
  if (!a || !t || !b || a.localName !== 'mo' || t.localName !== 'mtable' || b.localName !== 'mo') return null;
  const env = MATRIX_ENV[a.textContent.trim() + b.textContent.trim()];
  return env ? conv(t).replace(/^\\begin\{matrix\}/, `\\begin{${env}}`).replace(/\\end\{matrix\}$/, `\\end{${env}}`) : null;
}

function row(el) {
  let out = '';
  const ks = kids(el);
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i];
    let s = matrixAt(ks, i);
    if (s != null) i += 2; else s = conv(k);
    if (out && /\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z]/.test(s)) out += ' ';
    out += s;
  }
  return out;
}

function delim(d) {
  if (!d) return '.';
  return { '{': '\\{', '}': '\\}', '⟨': '\\langle', '⟩': '\\rangle', '〈': '\\langle', '〉': '\\rangle', '‖': '\\|' }[d] || d;
}

const OVER = { '¯': '\\overline', '‾': '\\overline', '^': '\\hat', 'ˆ': '\\hat', '˜': '\\tilde', '~': '\\tilde',
  '→': '\\vec', '⃗': '\\vec', '˙': '\\dot', '¨': '\\ddot', '⏞': '\\overbrace', '︷': '\\overbrace' };
const UNDER = { '¯': '\\underline', '_': '\\underline', '⏟': '\\underbrace', '︸': '\\underbrace' };

function accentOver(a, b) {
  const t = b.textContent.trim();
  if (b.localName === 'mo' && OVER[t]) return OVER[t] + '{' + conv(a) + '}';
  return group(conv(a)) + '^' + group(conv(b));
}
function accentUnder(a, b) {
  const t = b.textContent.trim();
  if (b.localName === 'mo' && UNDER[t]) return UNDER[t] + '{' + conv(a) + '}';
  return group(conv(a)) + '_' + group(conv(b));
}

export function mathmlToLatex(mathEl) {
  return conv(mathEl).replace(/\s+/g, ' ').trim();
}
