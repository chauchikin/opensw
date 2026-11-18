// Toolbar icons of opensw, drawn for this project (20×20 SVG). They follow the
// layout of a classic math editor's toolbar but share no artwork with any other program.
// Colours: placeholders (input boxes) are dashed blue squares, math is red.

const box = (x, y, s = 6) => `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="#fff" stroke="#2a62c9" stroke-dasharray="1.5 1"/>`;
const svg = (body) => `<svg viewBox="0 0 20 20" width="20" height="20" xmlns="http://www.w3.org/2000/svg" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
const page = '<path d="M4 2.5h8l4 4v11h-12z" fill="#fff" stroke="#555"/><path d="M12 2.5v4h4" fill="#e8e8e8" stroke="#555"/>';
const RED = '#c00000';

export const ICONS = {
  new: svg(page),
  open: svg('<path d="M2 6h6l1.5 1.5h7.5v9h-15z" fill="#f2c94c" stroke="#9a7a1c"/><path d="M2 16.5l2.5-6.5h14l-2.5 6.5z" fill="#f8dc7a" stroke="#9a7a1c"/>'),
  save: svg('<rect x="2.5" y="2.5" width="15" height="15" rx="1" fill="#3d6fb6" stroke="#22426e"/><rect x="5.5" y="2.5" width="9" height="5.5" fill="#e9eef6" stroke="#22426e"/><rect x="11" y="3.5" width="2" height="3.5" fill="#22426e"/><rect x="5" y="11" width="10" height="6.5" fill="#fff" stroke="#22426e"/>'),
  print: svg('<rect x="5.5" y="2.5" width="9" height="5" fill="#fff" stroke="#555"/><rect x="2.5" y="7.5" width="15" height="7" rx="1" fill="#bfbfbf" stroke="#555"/><rect x="5.5" y="12" width="9" height="5.5" fill="#fff" stroke="#555"/><circle cx="15" cy="10" r=".8" fill="#2e8b2e"/>'),
  exporttex: svg(`${page}<text x="10" y="15" font-size="6.5" font-family="serif" text-anchor="middle" fill="#22426e" font-weight="bold">TeX</text>`),
  cut: svg('<circle cx="6" cy="15" r="2.5" fill="none" stroke="#333" stroke-width="1.3"/><circle cx="14" cy="15" r="2.5" fill="none" stroke="#333" stroke-width="1.3"/><path d="M7.5 13l6-10.5M12.5 13l-6-10.5" stroke="#555" stroke-width="1.3"/>'),
  copy: svg('<path d="M3 2.5h7l2.5 2.5v9h-9.5z" fill="#fff" stroke="#555"/><path d="M7.5 6.5h7l2.5 2.5v8.5h-9.5z" fill="#fff" stroke="#555"/>'),
  paste: svg('<rect x="3" y="3.5" width="11" height="14" rx="1" fill="#c8a165" stroke="#7a5a2a"/><rect x="6" y="2" width="5" height="3" rx=".8" fill="#ddd" stroke="#555"/><path d="M9 8h8v9.5h-8z" fill="#fff" stroke="#555"/>'),
  undo: svg('<path d="M6 8.5h6.5a4 4 0 0 1 0 8h-4" fill="none" stroke="#22426e" stroke-width="1.8"/><path d="M7.5 4.5l-4 4 4 4z" fill="#22426e"/>'),
  redo: svg('<path d="M14 8.5h-6.5a4 4 0 0 0 0 8h4" fill="none" stroke="#22426e" stroke-width="1.8"/><path d="M12.5 4.5l4 4-4 4z" fill="#22426e"/>'),
  math_mathtext: svg('<rect x="2.5" y="2.5" width="15" height="15" rx="2" fill="#fff" stroke="#888"/><text x="10" y="15.5" font-size="13" font-family="serif" text-anchor="middle" fill="#222">T</text>'),
  math_fraction: svg(`${box(7, 2)}<path d="M4 10h12" stroke="${RED}" stroke-width="1.4"/>${box(7, 12)}`),
  math_radical: svg(`<path d="M2.5 11l2-1 3 6.5 3.5-13h7" fill="none" stroke="${RED}" stroke-width="1.4"/>${box(10.5, 7)}`),
  math_superscript: svg(`<text x="2" y="17" font-size="13" font-family="serif" font-style="italic" fill="${RED}">x</text>${box(11.5, 2.5)}`),
  math_subscript: svg(`<text x="2" y="12" font-size="13" font-family="serif" font-style="italic" fill="${RED}">x</text>${box(11.5, 11.5)}`),
  math_parentheses: svg(`<path d="M6 2.5q-4 7.5 0 15M14 2.5q4 7.5 0 15" fill="none" stroke="${RED}" stroke-width="1.4"/>${box(7, 7)}`),
  math_squarebrackets: svg(`<path d="M6.5 2.5h-3v15h3M13.5 2.5h3v15h-3" fill="none" stroke="${RED}" stroke-width="1.4"/>${box(7, 7)}`),
  math_sum: svg(`<path d="M14 3.5h-9.5l5 6.5-5 6.5h9.5" fill="none" stroke="${RED}" stroke-width="1.5"/>`),
  math_integral: svg(`<path d="M13 3.5c-1.5-1.5-3.5-1-4 1.5l-1.8 10.5c-.5 2.5-2.5 3-4 1.5" fill="none" stroke="${RED}" stroke-width="1.5"/>${box(13, 9, 5)}`),
  math_bigop: svg(`<path d="M8 3.5h-6l3 4.5-3 4.5h6" fill="none" stroke="${RED}" stroke-width="1.3"/><path d="M17 3c-1-1-2.5-.7-2.8 1l-1.3 9c-.3 1.7-1.8 2-2.8 1" fill="none" stroke="${RED}" stroke-width="1.3"/><path d="M3 17.5h14" stroke="#888"/>`),
  math_brackets: svg(`<path d="M5 2.5q-3 3.5 0 7M7 10.5h-2.5v7h2.5M15 2.5q3 3.5 0 7M13 10.5h2.5v7h-2.5" fill="none" stroke="${RED}" stroke-width="1.3"/>`),
  math_matrix: svg(`<path d="M4 2.5q-2.5 7.5 0 15M16 2.5q2.5 7.5 0 15" fill="none" stroke="${RED}" stroke-width="1.2"/>${box(5, 4, 4.5)}${box(10.5, 4, 4.5)}${box(5, 11.5, 4.5)}${box(10.5, 11.5, 4.5)}`),
  math_mathname: svg(`<text x="10" y="9" font-size="7" font-family="serif" text-anchor="middle" fill="${RED}">sin</text><text x="10" y="17.5" font-size="7" font-family="serif" text-anchor="middle" fill="${RED}">lim</text>`),
  math_binomial: svg(`<path d="M5.5 2.5q-4 7.5 0 15M14.5 2.5q4 7.5 0 15" fill="none" stroke="${RED}" stroke-width="1.3"/>${box(7, 3)}${box(7, 11)}`),
  math_decoration: svg(`<path d="M5 6l5-3.5 5 3.5" fill="none" stroke="${RED}" stroke-width="1.4"/>${box(6, 8.5, 8)}`),
  display: svg(`<path d="M2.5 4.5h15M2.5 15.5h15" stroke="#999"/><rect x="5" y="7" width="10" height="6" fill="#fff" stroke="${RED}"/><path d="M7 10h6" stroke="${RED}"/>`),
  bold: svg('<text x="10" y="15.5" font-size="14" font-family="serif" font-weight="bold" text-anchor="middle" fill="#222">B</text>'),
  italic: svg('<text x="10" y="15.5" font-size="14" font-family="serif" font-style="italic" text-anchor="middle" fill="#222">I</text>'),
};
