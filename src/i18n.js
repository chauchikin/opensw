// Interface language.
// The program is written with Traditional Chinese text; _t('檔案') looks the text up in the
// chosen language's file, src/locales/<language>.json ({ "檔案": "File", ... }), and gives the
// Chinese back when there is no translation. {0}, {1}... in the text are filled with the other
// arguments: _t('已開啟 {0}', name).
// To add a language: copy src/locales/en.json to src/locales/<code>.json (for example ja.json),
// translate the values, and add its name to LANGUAGES below. The manual (Help > Full manual) and
// the sample document are src/locales/manual.<code>.tex and sample.<code>.tex; without them the
// Chinese ones are shown. `node scripts/i18n-keys.mjs` lists the texts a language file still lacks.
// The language: ?lang=en in the address, else Tools > User Setup, else the system's language.
import { settings } from './settings.js';

export const LANGUAGES = { 'zh-TW': '繁體中文', en: 'English' };

// Vite puts the language files into the program (import.meta.env is set by Vite); outside Vite
// (tests run in Node) there are none
const FILES = import.meta.env
  ? import.meta.glob('./locales/*.json', { eager: true, import: 'default' }) : {};
const TABLES = Object.fromEntries(Object.entries(FILES).map(([p, t]) => [p.match(/([^/]+)\.json$/)[1], t]));

function chooseLanguage() {
  if (typeof window === 'undefined') return 'zh-TW';
  const asked = new URLSearchParams(window.location.search).get('lang') || settings().lang;
  if (asked && asked !== 'auto') return asked;
  for (const l of navigator.languages || [navigator.language]) {
    if (/^zh\b/i.test(l)) return 'zh-TW';
    const code = TABLES[l] ? l : l.split('-')[0];
    if (TABLES[code]) return code;
  }
  return 'en';
}

export const LANG = chooseLanguage();
const table = TABLES[LANG] || {};

export function _t(text, ...args) {
  const s = table[text] || text;
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (i < args.length ? String(args[i]) : m)) : s;
}

// The fixed text in index.html (dialogs, find bar, status bar): text and title/placeholder
function translateNode(node) {
  if (node.nodeType === 3) {
    const m = node.nodeValue.match(/^(\s*)([^]*?)(\s*)$/);
    if (m[2] && table[m[2]]) node.nodeValue = m[1] + table[m[2]] + m[3];
    return;
  }
  if (node.nodeType !== 1) return;
  for (const a of ['title', 'placeholder']) {
    const v = node.getAttribute(a);
    if (v && table[v]) node.setAttribute(a, table[v]);
  }
  for (const c of node.childNodes) translateNode(c);
}

export function translatePage() {
  document.documentElement.lang = LANG;
  if (LANG !== 'zh-TW') translateNode(document.body);
}
