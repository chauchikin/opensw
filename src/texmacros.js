// A LaTeX document's own commands (\newcommand in its preamble), written out where
// they are used, so the editor and Scientific Word 5.5 see ordinary LaTeX.
//
// - A command that makes a heading (a paragraph break and bold text) becomes
//   \section*{..} (large type) or \subsection*{..}.
// - \refstepcounter{c}\label{#1} in a command (a numbered caption such as
//   \tbl{tb:x}{text}) is numbered here: \thec becomes the number, the label is
//   dropped and each \ref to it becomes the number. 5.5 cannot read a \label inside
//   the document's own command (it stops reading the file there).
// - Any other command is replaced by its definition.
// Font names from \newfontfamily (\sans) are dropped: they only choose a font.
// A 5.x document is read as it is (5.x writes its commands itself).

const NAME = '([a-zA-Z]+)';

function groupEnd(s, i) { // s[i] === '{'
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j + 1;
  }
  return s.length;
}

function skipSpace(s, i) {
  while (i < s.length && /[ \t]/.test(s[i])) i++;
  if (s[i] === '\n' && !/^\n[ \t]*\n/.test(s.slice(i))) { i++; while (i < s.length && /[ \t]/.test(s[i])) i++; }
  return i;
}

// \newcommand{\x}[2][d]{body}, \newcommand\x{body}, \providecommand ... ->
// { defs: Map(name -> {n, opt, body}), counters: Set, fonts: Set, spans: [[start, end]] }
export function readDefs(preamble) {
  const defs = new Map();
  const counters = new Set();
  const fonts = new Set();
  const spans = [];
  const re = new RegExp(String.raw`\\(newcommand|providecommand|DeclareRobustCommand)\*?\s*(?:\{\s*\\${NAME}\s*\}|\\${NAME})`, 'g');
  for (let m; (m = re.exec(preamble));) {
    const name = m[2] || m[3];
    let i = m.index + m[0].length;
    let n = 0;
    let opt = null;
    let k = skipSpace(preamble, i);
    if (preamble[k] === '[') { const c = preamble.indexOf(']', k); n = +preamble.slice(k + 1, c) || 0; i = c + 1; k = skipSpace(preamble, i); }
    if (preamble[k] === '[') { const c = preamble.indexOf(']', k); opt = preamble.slice(k + 1, c); i = c + 1; k = skipSpace(preamble, i); }
    if (preamble[k] !== '{') continue;
    const e = groupEnd(preamble, k);
    defs.set(name, { n, opt, body: preamble.slice(k + 1, e - 1) });
    spans.push([m.index, e]);
    re.lastIndex = e;
  }
  for (const m of preamble.matchAll(/\\newcounter\s*\{([^}]+)\}/g)) counters.add(m[1].trim());
  for (const m of preamble.matchAll(new RegExp(String.raw`\\newfontfamily\s*\{?\\${NAME}`, 'g'))) fonts.add(m[1]);
  return { defs, counters, fonts, spans };
}

// what a command's definition makes: 'section', 'subsection' or null
function headingKind(body) {
  if (!/#1/.test(body) || /#2/.test(body)) return null;
  if (!/\\par\b/.test(body) || !/\\(bfseries|bf|textbf)(?![a-zA-Z])/.test(body)) return null;
  return /\\(large|Large|LARGE|huge|Huge)(?![a-zA-Z])/.test(body) ? 'section' : 'subsection';
}

// arguments after position i: n of them, the first optional when opt !== null
function takeArgs(s, i, n, opt) {
  const args = [];
  let j = i;
  if (opt !== null) {
    const k = skipSpace(s, j);
    if (s[k] === '[') { const c = s.indexOf(']', k); args.push(s.slice(k + 1, c)); j = c + 1; } else args.push(opt);
  }
  while (args.length < n) {
    const k = skipSpace(s, j);
    if (s[k] === '{') { const e = groupEnd(s, k); args.push(s.slice(k + 1, e - 1)); j = e; }
    else if (s[k] === '\\') { const t = s.slice(k).match(/^\\([a-zA-Z]+|.)/); args.push(t[0]); j = k + t[0].length; }
    else if (k < s.length) { args.push(s[k]); j = k + 1; }
    else break;
  }
  return { args, end: j };
}

// the body of a document (text after \begin{document}) with its own commands written out
export function expandMacros(body, { defs, counters, fonts }) {
  if (!defs.size && !fonts.size) return body;
  const values = Object.fromEntries([...counters].map((c) => [c, 0]));
  const refs = new Map();
  const names = [...defs.keys(), ...fonts].sort((a, b) => b.length - a.length);
  const re = new RegExp(String.raw`\\(${names.join('|')})(?![a-zA-Z])`, 'g');
  let s = body;
  let guard = 0;
  for (let i = 0; ;) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) break;
    // a verbatim part is left as it is
    const verb = s.lastIndexOf('\\begin{verbatim', m.index);
    if (verb >= 0 && s.indexOf('\\end{verbatim', verb) > m.index) { i = s.indexOf('\\end{verbatim', verb) + 5; continue; }
    if (++guard > 20000) break;
    const name = m[1];
    if (fonts.has(name) && !defs.has(name)) { s = s.slice(0, m.index) + s.slice(skipSpace(s, m.index + m[0].length)); i = m.index; continue; }
    const d = defs.get(name);
    const { args, end } = takeArgs(s, m.index + m[0].length, d.n, d.opt);
    let out;
    const kind = headingKind(d.body);
    if (kind) out = `\\${kind}*{${args[0] ?? ''}}`;
    else {
      out = d.body.replace(/#(\d)/g, (x, k) => args[k - 1] ?? '');
      // a numbered caption: \refstepcounter{c} ... \label{key}
      out = out.replace(/\\refstepcounter\s*\{([^}]+)\}([^]*?)\\label\s*\{([^}]*)\}/, (x, c, mid, key) => {
        if (!(c in values)) return x;
        values[c]++;
        refs.set(key.trim(), String(values[c]));
        return mid;
      });
      out = out.replace(/\\(?:stepcounter|refstepcounter)\s*\{([^}]+)\}/g, (x, c) => (c in values ? (values[c]++, '') : x));
      out = out.replace(new RegExp(String.raw`\\the(${Object.keys(values).join('|') || '(?!)'})(?![a-zA-Z])`, 'g'), (x, c) => String(values[c]));
      // a definition that ends with a command name keeps the space after it
      if (/\\[a-zA-Z]+$/.test(out) && /^[a-zA-Z]/.test(s[end] || '')) out += ' ';
    }
    s = s.slice(0, m.index) + out + s.slice(end);
    // a heading: rescan after it; anything else: its text may use more commands
    i = kind ? m.index + kind.length + 3 : m.index;
  }
  if (refs.size) s = s.replace(/\\ref\s*\{([^}]*)\}/g, (x, k) => refs.get(k.trim()) ?? x);
  return s;
}

// the preamble without the definitions read here (they are written out in the text)
export function withoutDefs(preamble, spans) {
  let out = '';
  let i = 0;
  for (const [a, b] of spans) { out += preamble.slice(i, a); i = b; }
  return out + preamble.slice(i);
}
