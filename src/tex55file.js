// Text -> the bytes of a Scientific Word 5.x .tex file. 5.x reads its files in a
// Windows code page (950 = Big5 for Traditional Chinese, 1252 for Western text),
// named in the file's first line. A character the code page does not have is
// written as 5.x writes it itself: \U{hex} (tcilatex prints a small box for it).
// Browsers can decode these code pages but not encode them, so the table is built
// once from the decoder: every byte sequence the code page has, decoded.

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
      for (let trail = 0x40; trail <= 0xfe; trail++) if (trail !== 0x7f) add([lead, trail]);
    }
  }
  tables.set(cp, map);
  return map;
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
    else for (const b of `\\U{${c.toString(16).toUpperCase()}}`) out.push(b.charCodeAt(0));
  }
  return new Uint8Array(out);
}

// the code page a document is saved in: its own, Big5 when it has Chinese, else Western
export function codepageFor(meta, text) {
  if (meta.codepage) return meta.codepage;
  if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(text)) return 950;
  return /[^\x00-\x7f]/.test(text) ? 1252 : null;
}
