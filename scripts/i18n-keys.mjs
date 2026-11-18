// Keeps the language files in step with the program.
//   node scripts/i18n-keys.mjs            -> lists, for each src/locales/*.json, the texts still to translate
//   node scripts/i18n-keys.mjs --update   -> also adds them (with "" as the value) and drops texts no longer used
// The texts are the Chinese in _t('...') in src/*.js, in index.html, and the computation engines' messages.
import fs from 'node:fs';
import path from 'node:path';

const CJK = /[、-〿一-鿿＀-￯]/;
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
const html = fs.readFileSync('index.html', 'utf8').replace(/<script[^]*?<\/script>|<style[^]*?<\/style>/g, '');
for (const m of html.matchAll(/>([^<]+)</g)) {
  const t = entities(m[1]).trim();
  if (CJK.test(t)) keys.add(t);
}
for (const m of html.matchAll(/\s(?:title|placeholder)="([^"]*)"/g)) {
  if (CJK.test(m[1])) keys.add(entities(m[1]));
}

// the engines' messages: "..." with Chinese in engine/*.py and engine/*.wl
for (const f of ['engine/opensw_compute.py', 'engine/opensw_compute.wl']) {
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/"([^"\n]*)"/g)) {
    if (CJK.test(m[1]) && !/[{}]/.test(m[1])) keys.add(m[1].replace(/：$/, '') === '還不能計算' ? '還不能計算：{0}' : m[1]);
  }
}

const update = process.argv.includes('--update');
for (const f of fs.readdirSync('src/locales').filter((f) => f.endsWith('.json'))) {
  const file = path.join('src/locales', f);
  const table = JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = [...keys].filter((k) => !table[k]);
  const unused = Object.keys(table).filter((k) => !keys.has(k));
  console.log(`${f}: ${keys.size} texts, ${missing.length} to translate, ${unused.length} no longer used`);
  for (const k of missing.slice(0, 20)) console.log('  ' + JSON.stringify(k));
  if (update) {
    const out = {};
    for (const k of keys) out[k] = table[k] || '';
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  }
}
