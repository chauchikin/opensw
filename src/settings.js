// Tools > User Setup, Automatic Substitution and Export Settings: this computer's settings,
// kept in the browser's storage (the desktop app's too)
const KEY = 'opensw-settings';
export const DEFAULTS = {
  autoSub: true, // Automatic Substitution in formulas (5.5: Enable Automatic Substitution)
  substitutions: {}, // keystrokes -> LaTeX, e.g. sum10 -> \sum_{n=1}^{10}
  matrix: [2, 2], // Insert > Matrix: rows, columns
  table: [3, 3], // Insert > Table: rows, columns
  startup: 'last', // the document shown when the editor starts: last, blank, demo
  backup: true, // keep the old file as .bak when saving over it
  mathColor: '#c00000', // formulas on screen (5.5: red)
  htmlMath: 'mathml', // File > Export HTML: formulas as MathML, or LaTeX for MathJax
  pictureScale: 3, // Edit > Copy as Picture: pixels per screen pixel
  engine: 'sympy', // Tools > Computation Engine: sympy, or mathematica (desktop app, Mathematica installed)
  wolframKernel: '', // the console kernel (wolfram.exe); empty: found automatically
  lang: 'auto', // the interface language (src/locales); auto: the system's language
};

export function settings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) { return { ...DEFAULTS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage off: this session only */ }
  applySettings();
}

// MathLive's own shortcuts (alpha -> α, sqrt ...) and the user's substitutions; none when off.
// A shortcut replaces the letters as soon as they are typed, so one that starts a user's
// keystrokes (sum, for sum10) is left out
let builtIn = null;
export function applyShortcuts(mf) {
  if (!builtIn) builtIn = { ...mf.inlineShortcuts };
  const s = settings();
  const mine = Object.keys(s.substitutions);
  const kept = Object.fromEntries(Object.entries(builtIn).filter(([k]) => !mine.some((m) => m !== k && m.startsWith(k))));
  mf.inlineShortcuts = s.autoSub ? { ...kept, ...s.substitutions } : {};
}

export function applySettings() {
  const s = settings();
  document.documentElement.style.setProperty('--math-color', s.mathColor);
  for (const mf of document.querySelectorAll('math-field')) applyShortcuts(mf);
}
