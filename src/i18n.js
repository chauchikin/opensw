// Interface language.
// The program is written in English; _t('File') looks the text up in the chosen language's file,
// src/locales/<language>.json ({ "File": "檔案", ... }), and gives the English back when there is
// no translation. {0}, {1}... in the text are filled with the other arguments: _t('Opened {0}', name).
// Messages that come from elsewhere (the computation engines, the desktop app's Rust part) go
// through _tm(message): it also finds texts with {0} in them, so "Variables without a value: x, y"
// is translated with the "Variables without a value: {0}" entry.
// To add a language: copy src/locales/zh-TW.json to src/locales/<code>.json (for example ja.json),
// translate the values (the keys are the English), and add its name to LANGUAGES below. The manual
// (Help > Full manual) and the sample document are src/locales/manual.<code>.tex and
// sample.<code>.tex; without them the English ones are shown.
// `node scripts/i18n-keys.mjs` lists the texts a language file still lacks.
// The language: ?lang=en in the address, else Tools > User Setup (English until changed; auto: the system's language).
import { settings } from './settings.js';

export const LANGUAGES = { en: 'English', 'zh-TW': '\u7e41\u9ad4\u4e2d\u6587' }; // 繁體中文

// Vite puts the language files into the program (import.meta.env is set by Vite); outside Vite
// (tests run in Node) there are none
const FILES = import.meta.env
  ? import.meta.glob('./locales/*.json', { eager: true, import: 'default' }) : {};
const TABLES = Object.fromEntries(Object.entries(FILES).map(([p, t]) => [p.match(/([^/]+)\.json$/)[1], t]));

function chooseLanguage() {
  if (typeof window === 'undefined') return 'en';
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

const fill = (s, args) => (args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (i < args.length ? String(args[i]) : m)) : s);

export function _t(text, ...args) {
  return fill(table[text] || text, args);
}

// A finished message from outside the program: the whole text, else a text with {0}, {1}...
// whose fixed parts match ("Cannot compute this yet: {0}" also translates what fills {0}).
let patterns;
export function _tm(message) {
  if (!message || LANG === 'en') return message;
  if (table[message]) return table[message];
  if (!patterns) {
    const esc = (s) => s.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
    patterns = Object.keys(table).filter((k) => /\{\d\}/.test(k) && /[A-Za-z]/.test(k.replace(/\{\d\}/g, ''))).map((k) => {
      const names = [...k.matchAll(/\{(\d)\}/g)].map((m) => +m[1]);
      const re = new RegExp('^' + k.split(/\{\d\}/).map(esc).join('([^]*?)') + '$');
      return { re, names, to: table[k] };
    }).sort((a, b) => b.re.source.length - a.re.source.length);
  }
  for (const p of patterns) {
    const m = message.match(p.re);
    if (!m) continue;
    const args = [];
    p.names.forEach((n, i) => { args[n] = _tm(m[i + 1]); });
    return fill(p.to, args);
  }
  return message;
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
  // headings drawn by style.css
  for (const [name, text] of [['references', _t('References')], ['abstract', _t('Abstract')]]) {
    document.documentElement.style.setProperty('--t-' + name, JSON.stringify(text));
  }
  if (LANG !== 'en') translateNode(document.body);
}
