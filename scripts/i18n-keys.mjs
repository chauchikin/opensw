// Keeps the language files in step with the program.
//   node scripts/i18n-keys.mjs            -> lists, for each src/locales/*.json, the texts still to translate
//   node scripts/i18n-keys.mjs --update   -> also adds them (with "" as the value) and drops texts no longer used
// The texts (the keys) are the English in _t('...') in src/*.js, in index.html (text with a letter in it,
// except inside translate="no"), the computation engines' messages and the Rust part's messages.
import fs from 'node:fs';
import path from 'node:path';
import { demoPhrases } from '../src/demos.js';

const WORD = /[A-Za-z]/;
const keys = new Set();

// _t('...') in the program (the first argument is always a plain '...' string)
for (const f of fs.readdirSync('src').filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join('src', f), 'utf8');
  for (const m of src.matchAll(/(?<![.\w])_t\(('(?:[^'\\\n]|\\.)*')/g)) {
    keys.add(Function('return ' + m[1])());
  }
}

// index.html: text between tags, and title / placeholder
const entities = (s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const html = fs.readFileSync('index.html', 'utf8').replace(/<head>[^]*?<\/head>|<script[^]*?<\/script>|<style[^]*?<\/style>|<!--[^]*?-->/g, '')
  .replace(/<(\w+)[^>]*translate="no"[^>]*>[^]*?<\/\1>/g, '');
for (const m of html.matchAll(/>([^<]+)</g)) {
  const t = entities(m[1]).trim();
  if (WORD.test(t)) keys.add(t);
}
for (const m of html.matchAll(/\s(?:title|placeholder)="([^"]*)"/g)) {
  if (WORD.test(m[1])) keys.add(entities(m[1]));
}

// the engines' messages: the "..." on lines that raise Unsupported / call unsupported or give a
// text, label or error (an f"...{x}..." or "..." + x becomes "...{0}..."), and the \\text{maximum}-like
// words in answers
const NOT_TEXT = new Set(['kind', 'text', 'label', 'error', 'solutions', 'simpson', 'standardize', 'Integrate']);
for (const f of ['engine/opensw_compute.py', 'engine/opensw_compute.wl']) {
  // comments: (* .. *) in Mathematica, docstrings in Python (where (*args) is not a comment)
  const code = fs.readFileSync(f, 'utf8').replace(f.endsWith('.wl') ? /\(\*[^]*?\*\)/g : /"""[^]*?"""/g, '')
    .split('\n').map((l) => l.replace(/^\s*#.*$|\s#\s.*$/, ''))
    .map((l) => l.replace(/"\s*<>\s*[^"]*?\s*<>\s*"/g, '{0}')); // "a " <> ToString[n] <> " b"
  for (const line of code) {
    if (!/Unsupported\(|unsupported\[|"(?:text|label|error)"|\blabel =/.test(line)) continue;
    for (const m of line.matchAll(/(Unsupported\(|unsupported\[)?(f?)"((?:[^"\\]|\\.)*)"(\s*(?:\+|<>))?/g)) {
      let t = m[3].replace(/\\\\/g, '\\');
      if (NOT_TEXT.has(t) || /^\\text\{/.test(t) || !/[A-Za-z]{2}/.test(t) || (!m[1] && !/\s/.test(t))) continue;
      if (m[2]) t = t.replace(/\{[^{}]*\}/g, '{0}');
      if (m[4]) t += '{0}';
      if (/[A-Za-z]{2}/.test(t.replace(/\{\d\}/g, ''))) keys.add(t);
    }
  }
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/"\\\\text\{([^{}"(]+)\}"/g)) keys.add(m[1]);
}
// the demo documents (src/demos.js): their titles, texts and menu paths
for (const t of demoPhrases()) keys.add(t);
keys.add('Cannot compute this yet: {0}');
keys.add('(cannot compute: {0})');

// the Rust part's error messages that reach the screen (engine.rs, lib.rs, aiconnect.rs; mcp.rs and remote.rs only
// answer AI): the "..." on lines with Err( / map_err / ok_or / gone(, {...} becoming {0}, {1}...
for (const f of ['engine.rs', 'lib.rs', 'aiconnect.rs']) {
  const src = fs.readFileSync(path.join('src-tauri/src', f), 'utf8').split('#[cfg(test)]')[0];
  for (const line of src.split('\n')) {
    if (/^\s*\/\//.test(line) || !/Err\(|map_err|ok_or|gone\(/.test(line)) continue;
    for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      let i = 0;
      const t = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\{[^{}]*\}/g, () => `{${i++}}`);
      if (/[A-Za-z]{2}.*\s/.test(t)) keys.add(t);
    }
  }
}

const update = process.argv.includes('--update');
for (const f of fs.readdirSync('src/locales').filter((f) => f.endsWith('.json'))) {
  const file = path.join('src/locales', f);
  const table = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = [...keys].filter((k) => !table[k]);
  const unused = Object.keys(table).filter((k) => !keys.has(k));
  if (process.argv.includes("--unused")) console.log(Object.keys(table).filter((k) => !keys.has(k)));
  console.log(`${f}: ${keys.size} texts, ${missing.length} to translate, ${unused.length} no longer used`);
  for (const k of missing.slice(0, 20)) console.log('  ' + JSON.stringify(k));
  if (update) {
    const out = {};
    for (const k of keys) out[k] = table[k] || '';
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  }
}
