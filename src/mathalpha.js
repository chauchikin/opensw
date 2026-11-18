// Unicode "mathematical alphanumeric symbols" (𝔹, 𝔣, 𝐱 ...) <-> plain letter + MathML mathvariant.
// Each style is a block of 52 code points: A–Z then a–z. A few letters live in the
// older "letterlike symbols" block instead (ℝ, ℭ, ℬ ...).

const STYLES = [
  ['bold', 0x1d400], ['italic', 0x1d434], ['bold-italic', 0x1d468], ['script', 0x1d49c],
  ['bold-script', 0x1d4d0], ['fraktur', 0x1d504], ['double-struck', 0x1d538], ['bold-fraktur', 0x1d56c],
  ['sans-serif', 0x1d5a0], ['bold-sans-serif', 0x1d5d4], ['sans-serif-italic', 0x1d608],
  ['sans-serif-bold-italic', 0x1d63c], ['monospace', 0x1d670],
];
const HOLES = { // letters the main blocks leave out
  'ℎ': ['italic', 'h'], 'ℬ': ['script', 'B'], 'ℰ': ['script', 'E'], 'ℱ': ['script', 'F'], 'ℋ': ['script', 'H'],
  'ℐ': ['script', 'I'], 'ℒ': ['script', 'L'], 'ℳ': ['script', 'M'], 'ℛ': ['script', 'R'], 'ℯ': ['script', 'e'],
  'ℊ': ['script', 'g'], 'ℴ': ['script', 'o'], 'ℭ': ['fraktur', 'C'], 'ℌ': ['fraktur', 'H'], 'ℑ': ['fraktur', 'I'],
  'ℜ': ['fraktur', 'R'], 'ℨ': ['fraktur', 'Z'], 'ℂ': ['double-struck', 'C'], 'ℍ': ['double-struck', 'H'],
  'ℕ': ['double-struck', 'N'], 'ℙ': ['double-struck', 'P'], 'ℚ': ['double-struck', 'Q'], 'ℝ': ['double-struck', 'R'],
  'ℤ': ['double-struck', 'Z'],
};
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// one character -> [variant, plain letter] or null
export function splitMathAlpha(ch) {
  if (HOLES[ch]) return HOLES[ch];
  const cp = ch.codePointAt(0);
  for (const [name, start] of STYLES) {
    if (cp >= start && cp < start + 52) return [name, LETTERS[cp - start]];
  }
  return null;
}

// a whole string of such characters in one style -> [variant, plain text] or null
export function splitMathAlphaString(text) {
  let variant = null;
  let plain = '';
  for (const ch of text) {
    const r = splitMathAlpha(ch);
    if (!r || (variant && r[0] !== variant)) return null;
    variant = r[0];
    plain += r[1];
  }
  return variant ? [variant, plain] : null;
}
