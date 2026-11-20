import { _t } from './i18n.js';
// Scientific Word 5.5 keyboard shortcuts (from its Help > Keyboard Shortcuts page).
// The same keys work in text and in a formula: in text, a math key first starts a
// formula, as in 5.5.

// Ctrl+G, then a letter
export const GREEK = {
  a: '\\alpha', b: '\\beta', g: '\\gamma', G: '\\Gamma', d: '\\delta', D: '\\Delta', e: '\\varepsilon',
  E: '\\epsilon', z: '\\zeta', h: '\\eta', y: '\\theta', Z: '\\vartheta', Y: '\\Theta', i: '\\iota',
  k: '\\kappa', K: '\\varkappa', l: '\\lambda', L: '\\Lambda', m: '\\mu', n: '\\nu', x: '\\xi', X: '\\Xi',
  p: '\\pi', P: '\\Pi', v: '\\varpi', r: '\\rho', R: '\\varrho', s: '\\sigma', S: '\\Sigma', T: '\\varsigma',
  t: '\\tau', u: '\\upsilon', U: '\\Upsilon', f: '\\phi', F: '\\Phi', j: '\\varphi', q: '\\chi', c: '\\psi',
  C: '\\Psi', w: '\\omega', W: '\\Omega', I: '\\digamma',
};

// Ctrl+S, then a key (5.5 "key prefixes"). Values are LaTeX, or a template action name.
export const SYMBOL_PREFIX = {
  1: '\\rightarrow', 2: '\\uparrow', 3: '\\leftarrow', 4: '\\downarrow', 5: '\\supseteq', 6: '\\cap',
  7: '\\subseteq', 8: '\\cup', 9: 'paren', 0: 'paren', '(': 'paren', ')': 'paren', '-': '\\equiv',
  '=': '\\neq', w: '\\approx', e: '\\in', r: 'radical', R: 'radical', t: '\\bigotimes', T: '\\bigotimes',
  i: '\\int', o: '\\emptyset', p: '\\prod', '[': 'bracket', ']': 'bracket', a: '\\angle', s: '\\sum',
  d: '\\partial', f: 'fraction', F: 'fraction', h: 'superscript', H: 'superscript', l: 'subscript',
  L: 'subscript', x: '\\times', c: '\\subset', '&': '\\subset', v: '\\vee', b: '\\bullet', n: '\\nabla',
  $: '\\Downarrow', '!': '\\Rightarrow', '@': '\\Uparrow', '#': '\\Leftarrow', '%': '\\supset', _: '\\cong',
  '+': '\\pm', W: '\\aleph', E: '\\notin', I: '\\infty', P: '\\wp', '{': 'brace', '}': 'brace', A: '\\forall',
  S: '\\bigoplus', D: '\\diamond', X: '\\div', C: '\\cdot', V: '\\wedge', N: '\\neg', '<': '\\leq',
  '>': '\\geq', z: '\\exists', m: 'lastmatrix', M: 'matrix',
};

// What each template action inserts. #0 = the current selection, #? = an empty box.
export const TEMPLATES = {
  fraction: '\\frac{#0}{#?}',
  radical: '\\sqrt{#0}',
  integral: '\\int',
  sum: '\\sum',
  paren: '\\left(#0\\right)',
  bracket: '\\left\\lbrack #0\\right\\rbrack',
  brace: '\\left\\lbrace #0\\right\\rbrace',
  angle: '\\left\\langle #0\\right\\rangle',
  abs: '\\left|#0\\right|',
  norm: '\\left\\Vert #0\\right\\Vert',
  binomial: '\\binom{#?}{#?}',
  hat: '\\hat{#0}', tilde: '\\tilde{#0}', acute: '\\acute{#0}', grave: '\\grave{#0}', dot: '\\dot{#0}',
  ddot: '\\ddot{#0}', bar: '\\bar{#0}', vec: '\\vec{#0}',
  thinspace: '\\,', thickspace: '\\;', nbsp: '~',
};

// key name as 5.5's help writes it -> action
const CTRL = {
  f: 'fraction', '/': 'fraction', 1: 'fraction',
  r: 'radical', 2: 'radical',
  h: 'superscript', ArrowUp: 'superscript', 3: 'superscript',
  l: 'subscript', ArrowDown: 'subscript', 4: 'subscript',
  i: 'integral', 8: 'integral', 7: 'sum',
  9: 'paren', 0: 'paren', '(': 'paren', ')': 'paren',
  '[': 'bracket', ']': 'bracket', 6: 'bracket',
  '{': 'brace', '}': 'brace', 5: 'brace',
  '<': 'angle', '\\': 'abs', '|': 'norm',
  d: 'display', m: 'toggle', t: 'toggle', g: 'greek', s: 'symbol',
  ',': 'thinspace', ' ': 'nbsp',
  o: 'open', p: 'print', q: 'find', w: 'replace', n: 'negate', F5: 'properties', F4: 'close', e: 'evaluate',
  '^': 'hat', '~': 'tilde', "'": 'acute', '`': 'grave', '.': 'dot', '"': 'ddot', _: 'bar', '-': 'vec',
};

// keydown -> action name for Ctrl/Cmd combinations, or null
export function actionFor(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === ' ' && e.shiftKey) return 'thickspace';
  if (e.key === 'F5' || e.key === 'F4') return e.shiftKey ? null : CTRL[e.key];
  const k = e.key.length === 1 ? (/[a-z]/i.test(e.key) ? e.key.toLowerCase() : e.key) : e.key;
  if (/[a-z]/.test(k) && e.shiftKey) return null; // Ctrl+Shift+letter: not a 5.5 key
  return CTRL[k] || null;
}

// 5.5's default function-key tags (Tag > Function Keys)
export const FKEYS = {
  F2: 'untag', F3: 'body', F4: 'normal', F5: 'bold', F6: 'italic', F7: 'numbered', F8: 'bullet', F9: 'code',
  F10: 'menu', F11: 'h2', F12: 'h3',
};

// accent keys as combining marks, for accents typed in text
export const COMBINING = { hat: '\u0302', tilde: '\u0303', acute: '\u0301', grave: '\u0300', dot: '\u0307', ddot: '\u0308', bar: '\u0304' };

// Ctrl+N: the negated form of the symbol to the left
export const NEGATE = {
  '=': '\\neq', '<': '\\nless', '>': '\\ngtr', '\\le': '\\nleq', '\\leq': '\\nleq', '\\ge': '\\ngeq', '\\geq': '\\ngeq',
  '\\in': '\\notin', '\\ni': '\\not\\ni', '\\subset': '\\not\\subset', '\\supset': '\\not\\supset', '\\subseteq': '\\nsubseteq',
  '\\supseteq': '\\nsupseteq', '\\sim': '\\nsim', '\\cong': '\\ncong', '\\mid': '\\nmid', '\\parallel': '\\nparallel',
  '\\equiv': '\\not\\equiv', '\\approx': '\\not\\approx', '\\exists': '\\nexists', '\\prec': '\\nprec', '\\succ': '\\nsucc',
  '\\rightarrow': '\\nrightarrow', '\\to': '\\nrightarrow', '\\leftarrow': '\\nleftarrow', '\\Rightarrow': '\\nRightarrow',
  '\\Leftarrow': '\\nLeftarrow', '\\leftrightarrow': '\\nleftrightarrow', '\\Leftrightarrow': '\\nLeftrightarrow',
};
export const NEGATE_TEXT = { '=': '≠', '<': '≮', '>': '≯', '∈': '∉', '⊂': '⊄', '⊃': '⊅', '≤': '≰', '≥': '≱', '∼': '≁', '≡': '≢' };

// The table shown in Help, in the order of 5.5's help page.
export const HELP_ROWS = [
  [_t('Toggle math/text'), _t('Ctrl+M or Ctrl+T')],
  [_t('Fraction'), _t('Ctrl+F, Ctrl+/, Ctrl+1')],
  [_t('Radical'), _t('Ctrl+R, Ctrl+2')],
  [_t('Superscript'), _t('Ctrl+H, Ctrl+↑, Ctrl+3')],
  [_t('Subscript'), _t('Ctrl+L, Ctrl+↓, Ctrl+4')],
  [_t('Integral'), _t('Ctrl+I, Ctrl+8')],
  [_t('Sum'), 'Ctrl+7'],
  [_t('Parentheses'), _t('Ctrl+9, Ctrl+0, Ctrl+(, Ctrl+)')],
  [_t('Square brackets'), _t('Ctrl+[, Ctrl+], Ctrl+6')],
  [_t('Braces'), _t('Ctrl+{, Ctrl+}, Ctrl+5')],
  [_t('Angle brackets'), 'Ctrl+<'],
  [_t('Absolute value / norm'), _t('Ctrl+\\ / Ctrl+|')],
  [_t('Display'), 'Ctrl+D'],
  [_t('Greek letters'), _t('Ctrl+G then a letter (a→α, b→β, y→θ, f→φ…)')],
  [_t('Symbols'), _t('Ctrl+S then a key (I→∞, e→∈, =→≠, <→≤, 1→→, m→last matrix, M→matrix…)')],
  [_t('Required space / nonbreaking space / thin space / thick space'), _t('Shift+Space / Ctrl+Space / Ctrl+, / Ctrl+Shift+Space')],
  [_t('Accents'), _t('Ctrl+^ â, Ctrl+~ ã, Ctrl+\' á, Ctrl+` à, Ctrl+. ȧ, Ctrl+" ä, Ctrl+_ ā, Ctrl+- vector (in text: the accent key first, then the letter)')],
  [_t('Discretionary hyphen'), _t('Ctrl+- twice in text')],
  [_t('Negate the symbol on the left'), _t('Ctrl+N (= becomes ≠, ∈ becomes ∉…)')],
  [_t('Find / Replace'), _t('Ctrl+Q / Ctrl+W')],
  [_t('Compute (cursor in a formula)'), 'Ctrl+E'],
  [_t('New definition / Interpret (cursor in a formula)'), _t('Ctrl+= / Ctrl+?')],
  [_t('Formula properties (edit the TeX)'), 'Ctrl+F5'],
  [_t('Open / Close / Print (typeset PDF)'), _t('Ctrl+O / Ctrl+F4 / Ctrl+P')],
  [_t('Undo'), 'Ctrl+Z'],
  [_t('Function keys'), _t('F1 Help, F2 Remove item tag, F3 Body text, F4 Normal, F5 Bold, F6 Emphasized, F7 Numbered list, F8 Bullet list, F9 Typewriter, F10 Menu, F11 Section, F12 Subsection')],
];
