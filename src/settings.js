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
  engine: 'sympy', // Tools > Engine Setup: sympy, or the id of an engine in engine/engines.json (desktop app)
  enginePrograms: {}, // engine id -> its program on this computer (wolfram.exe ...); none: found automatically
  solvePrincipal: false, // Solve > Exact gives one solution, not every one (5.5: Engine Setup, Solve Options, Principal Value Only)
  logBase10: false, // \log is base 10, not e (5.5: Computation Setup, General, Base for Log Function, Change from e to 10)
  basis: ['x', 'y', 'z'], // the variables of grad, div, curl, ∇ (5.5: Compute > Vector Calculus > Set Basis Variables)
  aiFolders: [], // folders where AI (MCP) may open files, besides the open document's and the projects folder (it saves only in the projects folder)
  projectsFolder: '', // where the desktop app keeps the documents, each in a folder of its own (projects.js); '': "opensw projects" on the Desktop
  pastProjectsFolders: [], // previous locations, so their imports and originals can still be found
  showFolderOnSave: 'first', // after a save the document is shown in its folder: first (the first save of a document, and every Save As), always, never
  lang: 'en', // the interface language (src/locales); auto: the system's language
};

export function settings() {
  let s, basis;
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
    s = { ...DEFAULTS, ...stored };
    basis = !stored.basis && localStorage.getItem('opensw-basis'); // 0.6.0 and before kept the basis variables apart
  } catch (e) { return { ...DEFAULTS }; }
  if (basis) s.basis = basis.split(',');
  // 0.5.0 and before kept the Mathematica kernel as wolframKernel
  if (s.wolframKernel !== undefined) {
    s.enginePrograms = { mathematica: s.wolframKernel, ...s.enginePrograms };
    delete s.wolframKernel;
  }
  // (an AI may save in these folders: whatever was stored, only a list of folders is taken)
  s.pastProjectsFolders = Array.isArray(s.pastProjectsFolders) ? s.pastProjectsFolders.filter((f) => typeof f === 'string' && f) : [];
  return s;
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
