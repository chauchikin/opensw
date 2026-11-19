// Text -> the bytes of a Scientific Word 5.x .tex file. 5.x reads its files in a
// Windows code page (950 = Big5 for Traditional Chinese, 1252 for Western text),
// named in the file's first line. A character the code page does not have is
// written as 5.x writes it itself: \U{hex} (tcilatex prints a small box for it).
// Browsers can decode these code pages but not encode them, so the table is built
// once from the decoder: every byte sequence the code page has, decoded.

// The browser's Big5 decoder also knows Hong Kong's extension (HKSCS), which 5.x's code page 950
// does not: 都 is there twice, as B3A3 and as 906D, and é as 886D; 5.5 shows the extension ones as
// blanks. So for 950 only Big5 itself: lead bytes A1-F9, without C6A1-C8FE (no characters in 950).
const big5Lead = (lead) => lead >= 0xa1 && lead <= 0xf9 && lead !== 0xc7 && lead !== 0xc8;

const CODEPAGE_LABEL = { 950: 'big5', 936: 'gbk', 932: 'shift_jis', 949: 'euc-kr', 1252: 'windows-1252' };
const tables = new Map();

function tableFor(cp) {
  if (tables.has(cp)) return tables.get(cp);
  const label = CODEPAGE_LABEL[cp];
  const dec = new TextDecoder(label);
  const map = new Map();
  const add = (bytes) => {
    const ch = dec.decode(new Uint8Array(bytes));
    // one character that maps back here (skip replacement characters and characters already given)
    if ([...ch].length === 1 && ch !== '�' && !map.has(ch)) map.set(ch, bytes);
  };
  for (let b = 0x80; b <= 0xff; b++) add([b]); // single-byte code pages, and their upper half
  if (cp !== 1252) {
    for (let lead = 0x81; lead <= 0xfe; lead++) {
      if (cp === 950 && !big5Lead(lead)) continue;
      for (let trail = 0x40; trail <= 0xfe; trail++) if (trail !== 0x7f && !(cp === 950 && lead === 0xc6 && trail >= 0xa1)) add([lead, trail]);
    }
  }
  tables.set(cp, map);
  return map;
}

// A letter with an accent the code page lacks (é in a Big5 file): as TeX writes it, \\'{e}
const ACCENTS = { '\u0300': '`', '\u0301': "'", '\u0302': '^', '\u0303': '~', '\u0308': '"', '\u0304': '=', '\u0327': 'c', '\u030c': 'v' };
function accented(ch) {
  const [base, mark, more] = [...ch.normalize('NFD')];
  if (more || !mark || !/^[A-Za-z]$/.test(base) || !ACCENTS[mark]) return null;
  return `\\${ACCENTS[mark]}{${base}}`;
}

// codepage: 950, 1252, ... or null for UTF-8
export function encode55(text, codepage) {
  if (!codepage || !CODEPAGE_LABEL[codepage]) return new TextEncoder().encode(text);
  const map = tableFor(codepage);
  const out = [];
  for (const ch of text.replace(/\n/g, '\r\n')) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (map.has(ch)) out.push(...map.get(ch));
    else for (const b of accented(ch) || `\\U{${c.toString(16).toUpperCase()}}`) out.push(b.charCodeAt(0));
  }
  return new Uint8Array(out);
}

// the code page a document is saved in: its own, Big5 when it has Chinese, else Western
export function codepageFor(meta, text) {
  if (meta.codepage) return meta.codepage;
  if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(text)) return 950;
  return /[^\x00-\x7f]/.test(text) ? 1252 : null;
}

// the bytes of a 5.x file: in its code page, and saying which one when the preamble
// does not (an old file that had only ASCII, given Chinese or accents since), so it
// opens again the same: multibyte pages in the first line as 5.5 writes them,
// others as %TCIDATA{Codepage=..}
export function encodeFile55(text, meta) {
  return encode55(withCodepage55(text, meta), codepageFor(meta, text));
}
// the text with that line added when needed (always before \begin{document})
export function withCodepage55(text, meta) {
  const cp = codepageFor(meta, text);
  if (cp && !/CodePage:\s*\d+|%TCIDATA\{Codepage=\d+\}/i.test(text.slice(0, Math.max(0, text.indexOf('\\begin{document}')) || 8000))) {
    if (cp !== 1252) text = `%2multibyte Version: 5.50.0.2960 CodePage: ${cp}\n` + text;
    else text = text.replace(/\\begin\{document\}/, `%TCIDATA{Codepage=${cp}}\n\n$&`);
  }
  return text;
}
