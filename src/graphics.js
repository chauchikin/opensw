// Pictures: Scientific Word 5.x frames (\FRAME), LaTeX \includegraphics and the
// pictures of a .sci file all become one `image` node (see schema.js).
//
// A 5.x frame:  \FRAME{flags}{width}{height}{depth}{caption}{label}{name}{body}
//   flags: i in-line, d displayed, f floating; t b p h placement; F figure, T table;
//          X a box drawn round it
//   body:  \special{language "Scientific Word";type "GRAPHIC";...;filename 'pic.png';...}
//          (a plot: type "MAPLEPLOT";...;tempfilename 'SLUEY000.wmf')
// 5.x typesets the picture from the \special, which only its own previewer reads;
// export.js adds \includegraphics so other TeX installations show it too.

const UNIT_PX = { in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72.27, bp: 96 / 72, pc: 12 * 96 / 72.27 };

// "2.5in" -> 240 (CSS pixels), or null when it is not a plain length
export function toPx(dim) {
  const m = String(dim || '').trim().match(/^(-?[\d.]+)\s*(in|cm|mm|pt|bp|pc)$/);
  return m ? Math.round(parseFloat(m[1]) * UNIT_PX[m[2]] * 10) / 10 : null;
}

// file types TeX (xdvipdfmx) can put in a PDF, and a browser can show
export const TEX_IMAGE = /\.(png|jpe?g|pdf|bmp)$/i;
export const WEB_IMAGE = /\.(png|jpe?g|gif|bmp|svg|webp)$/i;

// a value of the 5.x \special: key 'value' or key "value"
function special(body, key) {
  const m = body.match(new RegExp(`(?:^|;|\\s)${key}\\s*['"]([^'"]*)['"]`));
  return m ? m[1] : null;
}

// \Qcb{caption} / \Qct{caption} / \Qlb{label}: the text inside, or ''
const unwrap = (s) => {
  const m = String(s || '').trim().match(/^\\Q(?:cb|ct|lb|lt)\s*(?:\[[^\]]*\])?\s*\{([^]*)\}$/);
  return (m ? m[1] : String(s || '')).trim();
};

// args: the 8 arguments of \FRAME -> attributes of an image node
export function frameAttrs(args, tex) {
  const [flags = '', w, h, , cap, lab, name, body = ''] = args;
  const type = special(body, 'type') || '';
  // a picture keeps its file name; a plot keeps a snapshot made by 5.x (tempfilename)
  const file = special(body, 'filename') || special(body, 'tempfilename') || '';
  const kind = flags.includes('f') ? 'float' : flags.includes('d') ? 'display' : 'inline';
  return {
    src: null,
    path: file.replace(/\\/g, '/'),
    width: toPx(w),
    height: toPx(h),
    texw: w || null,
    texh: h || null,
    place: kind,
    floattype: 'figure', // tcilatex puts every floating frame in a figure environment, F or T
    placement: (flags.match(/[tbph]/g) || []).join('') || null,
    caption: unwrap(cap) || null,
    label: unwrap(lab) || null,
    frame: tex,
    name: name || null,
    plot: /PLOT/i.test(type),
  };
}

// \includegraphics[opts]{file} -> attributes of an image node
export function includeAttrs(opts, file) {
  const o = {};
  for (const part of String(opts || '').split(',')) {
    const [k, v] = part.split('=').map((x) => x && x.trim());
    if (k) o[k] = v ?? true;
  }
  return {
    src: null, path: file.trim(), width: toPx(o.width), height: toPx(o.height),
    texw: o.width || null, texh: o.height || null, opts: opts || null,
  };
}

// Where a picture's file may be, next to the document (5.x keeps plot snapshots
// and copies of pictures in a "graphics" folder)
export function candidates(dir, path) {
  if (!path) return [];
  const sep = dir.includes('\\') ? '\\' : '/';
  const rel = path.replace(/\//g, sep);
  if (/^([a-zA-Z]:|[\\/])/.test(path)) return [path, dir + sep + 'graphics' + sep + rel.split(sep).pop()];
  const base = rel.split(sep).pop();
  return [...new Set([dir + sep + rel, dir + sep + 'graphics' + sep + base, dir + sep + base])];
}

export const mimeOf = (path) => ({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
  svg: 'image/svg+xml', webp: 'image/webp', pdf: 'application/pdf',
}[(path.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase()] || 'application/octet-stream');
