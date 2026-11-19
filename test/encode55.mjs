// Saving a 5.x .tex in code page 950 (src/tex55file.js): only what 5.5's Big5 has.
// Run: node test/encode55.mjs
import { encode55 } from '../src/tex55file.js';
import { readTex55 } from '../src/tex55.js';

let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : detail); };
const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, '0')).join(' ');

check('都 is B3A3, not Hong Kong\'s 906D (5.5 showed a blank)', hex(encode55('都', 950)) === 'b3 a3', hex(encode55('都', 950)));
check('許功蓋 (second byte 5C) stay Big5', hex(encode55('許功蓋', 950)) === 'b3 5c a5 5c bb 5c', hex(encode55('許功蓋', 950)));
check('é in a Big5 file is \\\'{e} (it was 886D, a blank in 5.5)', new TextDecoder().decode(encode55('Padé', 950)) === "Pad\\'{e}");
check('a character Big5 lacks is \\U{...}', new TextDecoder().decode(encode55('𠮷', 950)) === '\\U{20BB7}');
check('é in a Western file stays one byte', hex(encode55('é', 1252)) === 'e9');
// and back: opensw reads what it wrote
const file = encode55('%2multibyte Version: 5.50.0.2960 CodePage: 950\n\\documentclass{article}\n\\begin{document}\n都是 Padé 近似\n\\end{document}\n', 950);
const doc = readTex55(file).doc;
check('read back: 都是 Padé 近似', doc.textContent.includes('都是 Padé 近似'), doc.textContent);
process.exit(fails ? 1 : 0);
