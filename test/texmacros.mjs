// A LaTeX document's own commands (src/texmacros.js), and saving such a document for 5.5.
// Run: node test/texmacros.mjs
import { readLatex } from '../src/tex55.js';
import { toTex55File } from '../src/export.js';
import { readDefs, expandMacros } from '../src/texmacros.js';

let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : detail); };

const pre = String.raw`\documentclass[11pt]{article}
\usepackage{fontspec}\setmainfont{Noto Serif CJK TC}\newfontfamily\sans{Noto Sans CJK TC}[Ligatures=TeX]
\XeTeXlinebreaklocale "zh"\XeTeXlinebreakskip=0pt plus 1pt
\usepackage{amsmath,amssymb,amsthm,booktabs}
\newtheorem{lem}{引理}
\renewcommand{\proofname}{證明}
\newcommand{\sect}[1]{\par\Needspace{5\baselineskip}\bigskip{\sans\large\bfseries #1}\par\smallskip}
\newcommand{\subsect}[1]{\par\Needspace{4\baselineskip}\medskip{\sans\bfseries #1}\par\smallskip}
\newcounter{tb}
\newcommand{\tbl}[2]{\refstepcounter{tb}\label{#1}{\small\textbf{表 \thetb}　#2}\par\nopagebreak\smallskip}
\newcommand{\tU}{\tilde U}\newcommand{\tb}{\tilde\beta}
\newcommand{\ck}[1]{〔#1〕}
`;
const body = String.raw`\begin{document}\sloppy
{\sans\LARGE\bfseries Title}
\sect{1. 開頭}
見表 \ref{tb:b}，$\tU(x)+\tb$，附錄 B\ck{7}。
\tbl{tb:a}{第一個}
\begin{center}\begin{tabular}{@{}ll@{}}\toprule
a & b\\[9pt]
c & d\\\bottomrule
\end{tabular}\end{center}
\Needspace{12\baselineskip} \subsect{1.1 小節}
\tbl{tb:b}{第二個 $\tb$}
\end{document}
`;
const info = readDefs(pre);
check('reads the commands', [...info.defs.keys()].join(',') === 'sect,subsect,tbl,tU,tb,ck', [...info.defs.keys()]);
check('the font name from \\newfontfamily', info.fonts.has('sans'));
const ex = expandMacros(body, info);
check('\\sect becomes \\section*', ex.includes('\\section*{1. 開頭}'), ex);
check('\\subsect becomes \\subsection*', ex.includes('\\subsection*{1.1 小節}'), ex);
check('\\tb is not taken for \\tbl, and \\tU \\tb are written out', ex.includes('$\\tilde U(x)+\\tilde\\beta$'), ex);
check('\\ck{7}', ex.includes('B〔7〕'));
check('captions numbered, no \\label left', ex.includes('表 1}') && ex.includes('表 2}') && !/\\label/.test(ex), ex);
check('\\ref to a caption is its number', ex.includes('見表 2，'), ex);
check('\\sans dropped', !/\\sans/.test(ex), ex);

const { doc, meta } = readLatex(pre + body);
const text = doc.textContent;
check('read: no \\Needspace or \\sloppy fields', !/Needspace|sloppy|sans/.test(JSON.stringify(doc.toJSON())), JSON.stringify(doc.toJSON()).slice(0, 400));
check('read: heading', doc.content.content.some((n) => n.type.name === 'section' || /heading|section/.test(n.type.name)), doc.content.content.map((n) => n.type.name));
check('read: [9pt] is not text in the next row', !text.includes('[9pt]'), text);
let space = null;
doc.descendants((n) => { if (n.type.name === 'table_row' && n.attrs.space) space = n.attrs.space; });
check('read: the row keeps its 9pt', space === '9pt', space);

const out = toTex55File(doc, meta);
check('5.x file: \\\\[9pt] written back', /b \\\\\[9pt\]\n/.test(out), out);
check('5.x file: 5.x preamble with \\input{tcilatex}', out.startsWith('%2multibyte Version: 5.50.0.2960 CodePage: 950') && out.includes('\\input{tcilatex}'), out.slice(0, 300));
check('5.x file: class options kept', out.includes('\\documentclass[11pt]{article}'), out.slice(0, 300));
check('5.x file: no XeTeX font commands', !/fontspec|setmainfont|newfontfamily|XeTeX|Noto/.test(out), out.slice(0, 600));
check('5.x file: packages and theorems kept', out.includes('\\usepackage{amsmath,amssymb,amsthm,booktabs}') && out.includes('\\newtheorem{lem}{引理}') && out.includes('\\renewcommand{\\proofname}{證明}'), out.slice(0, 600));
check('5.x file: the written-out commands are not defined again', !/\\newcommand\{\\(tbl|sect)\}/.test(out), out.slice(0, 600));
check('5.x file: no \\label from a caption', !/\\label\{tb:/.test(out), out);

// a 5.x document is read as it is
const f55 = '%2multibyte Version: 5.50.0.2960 CodePage: 950\n\\documentclass{article}\n\\newcommand{\\R}{\\mathbb{R}}\n%TCIDATA{Codepage=950}\n\\input{tcilatex}\n\\begin{document}\n$x\\in\\R$\n\\end{document}\n';
const r55 = readLatex(f55);
check('5.x document: its commands stay', JSON.stringify(r55.doc.toJSON()).includes('\\\\R'), JSON.stringify(r55.doc.toJSON()));
check('5.x document: its own preamble is saved', toTex55File(r55.doc, r55.meta).includes('\\newcommand{\\R}{\\mathbb{R}}'));
process.exit(fails ? 1 : 0);
