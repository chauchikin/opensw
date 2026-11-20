// Reading a formula for the Compute menu the way it is meant in mathematics, where the
// CortexJS Compute Engine reads it otherwise (compute.js uses both before asking an engine):
//
// vectorTeX(tex): 5.x matrices \left[ \begin{array}..\end{array}\right] as matrices, \times and \cdot
//   between vectors as the cross and dot product, ∇f, ∇·F, ∇×F, ∇^2 f (see there).
// scopeDerivatives(tex): d/dx and ∂/∂x act on the term that follows, up to the next + or −:
//   \frac{d}{dy}f(y)+aw is f'(y)+aw, not the derivative of f(y)+aw; d/dx (...) acts on the brackets.
// normalize(json, functions): after parsing,
//   x(a+b), b(\beta+y)      a letter before parentheses is a product, unless it is a function:
//                           f, g, h, a capital Greek letter (\Psi(y)), a defined function, a name
//                           used with a prime or with two or more arguments, or one whose
//                           argument is a single name or number (u(x), y(0))
//   f'(y), f''(0)           the derivative of f, at y or at 0
//   \frac{\partial}{\partial y}w_0   the derivative of w_0 (the parser wraps w_0 in a Function)
//   (1,2)\times(3,4)       Cross, Dot when a side is a vector (vectorTeX)
// notation55(tex): before all that, 5.5's notation the parser does not read, in forms it does
//   (see there): layout commands dropped, a mod n, evaluation bars, Bessel functions J_n(x) ..,
//   D_{xy}(f), \mathcal{L} and \mathcal{F} transforms, units (\unit{ft}) and angle units.

// ---------- 5.5's notation ----------

// a formula as a tree: a token is a string, a group { open, items, close } ({..}, \left..\right..,
// (..) or [..]; a ( may close with ] and the other way round, as in intervals)
const OPENERS = { '{': '}', '(': ')]', '[': '])' };
function tokens(s) {
  const out = [];
  for (let i = 0; i < s.length;) {
    let m;
    if (s.startsWith('\\left', i) && !/[A-Za-z]/.test(s[i + 5] || '') && (m = s.slice(i).match(/^\\left\s*(\\[A-Za-z]+|\\.|.)/))) { out.push({ left: m[0] }); i += m[0].length; continue; }
    if (s.startsWith('\\right', i) && !/[A-Za-z]/.test(s[i + 6] || '') && (m = s.slice(i).match(/^\\right\s*(\\[A-Za-z]+|\\.|.)/))) { out.push({ right: m[0] }); i += m[0].length; continue; }
    // \begin{pmatrix} .. \end{pmatrix} is a group as \left( .. \right) is
    if ((m = s.slice(i).match(/^\\begin\s*\{[^{}]*\}/))) { out.push({ left: m[0] }); i += m[0].length; continue; }
    if ((m = s.slice(i).match(/^\\end\s*\{[^{}]*\}/))) { out.push({ right: m[0] }); i += m[0].length; continue; }
    m = s.slice(i).match(/^(\\[A-Za-z]+|\\.|\s+|.)/s);
    out.push(m[0]);
    i += m[0].length;
  }
  return out;
}
function tree(toks) {
  let k = 0;
  const seq = (close) => { // -> items up to the closing token (consumed), or null when it is missing
    const items = [];
    while (k < toks.length) {
      const t = toks[k];
      if (close === 'right' ? typeof t === 'object' && t.right : typeof t === 'string' && close && close.includes(t)) { k++; return { items, close: t.right || t }; }
      if (typeof t === 'object' && t.right) return null; // a \right without its \left
      if (close === '}' && (t === ')' || t === ']')) { items.push(t); k++; continue; }
      if (close && close !== '}' && close !== 'right' && t === '}') return null;
      k++;
      const opener = typeof t === 'object' ? t.left : OPENERS[t] && t;
      if (!opener) { items.push(t); continue; }
      const back = k;
      const g = seq(typeof t === 'object' ? 'right' : OPENERS[t]);
      if (g) items.push({ open: opener, items: g.items, close: g.close });
      else if (t === '{' || typeof t === 'object') return null;
      else { k = back; items.push(t); } // an unmatched ( or [ is a token
    }
    return close ? null : { items };
  };
  const all = seq(null);
  return all ? all.items : null;
}
const text = (items) => items.map((t) => (typeof t === 'string' ? t : t.open + text(t.items) + t.close)).join('');

// ---------- how 5.5 reads a formula (Compute > Interpret shows it) ----------
// From 5.5's help (trigarg.tex, dm1-3.tex), written out here as brackets the parser reads the same way:
// 1. A trigtype function (sin .. csc, sinh .. csch, arcsin .. arccsch, log, ln) without brackets takes as
//    its argument what follows while it is multiplied: up to a + or −, a relation, a comma, and also up
//    to another function (sin x cos x, sin x e^x, sin x/cos x are products and quotients of two):
//    sin x(a+b) is sin(x(a+b)), sin x(cos(ax+b)) is sin(x cos(ax+b)), sin x/2 is sin(x/2),
//    sin xy/2 is sin(xy/2).
// 2. Brackets right after it are its argument: sin(x)(a+cos b) is (sin x)(a+cos b), sin(x)/2 is (sin x)/2,
//    except when a letter or number follows them: sin(a+b)x is sin((a+b)x).
// 3. / divides by the one factor after it only: 1/3x+4 is (1/3)x+4, 1/3(x+4) is (1/3)(x+4), 1/(3x)+4 is
//    1/(3x)+4 (the parser would read 1/(3x)).
const TRIGTYPE_NAMES = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'coth', 'sech', 'csch',
  'arcsin', 'arccos', 'arctan', 'arccot', 'arcsec', 'arccsc', 'arcsinh', 'arccosh', 'arctanh', 'arccoth', 'arcsech', 'arccsch', 'log', 'ln']);
// other names applied to what follows (they end a trigtype function's argument)
const OTHER_FUNCTIONS = new Set(['exp', 'det', 'gcd', 'lim', 'max', 'min', 'sup', 'inf', 'Pr', 'arg', 'deg', 'dim', 'hom', 'ker', 'lg',
  'liminf', 'limsup', 'sum', 'prod', 'int', 'iint', 'iiint', 'oint', 'coprod', 'bigcup', 'bigcap', 'Re', 'Im']);
const NAME_COMMANDS = /^\\(operatorname|mathrm|func|text|textrm|mathit|mbox)$/;
const BRACE_ARGS = { '\\frac': 2, '\\dfrac': 2, '\\tfrac': 2, '\\binom': 2, '\\dbinom': 2, '\\tbinom': 2, '\\sqrt': 1, '\\overline': 1, '\\bar': 1,
  '\\hat': 1, '\\tilde': 1, '\\vec': 1, '\\dot': 1, '\\ddot': 1, '\\mathbf': 1, '\\boldsymbol': 1, '\\mathcal': 1, '\\mathbb': 1 };
const SPACING = /^\\(,|;|:|!| |quad|qquad|enspace|thinspace)$/;
const MULTIPLY = /^(\\cdot|\\times|\*|\\ast)$/;
const isSpace = (t) => typeof t === 'string' && /^\s+$/.test(t);
const isBracket = (t) => t && typeof t === 'object' && t.open !== '{' && !/^\\begin/.test(t.open);
const nameOf = (items, i) => { // the function's name at items[i] (\sin, \operatorname{arcsinh}), or null
  const t = items[i];
  if (typeof t !== 'string') return null;
  if (/^\\[A-Za-z]+$/.test(t) && !NAME_COMMANDS.test(t)) return t.slice(1);
  if (NAME_COMMANDS.test(t) && items[i + 1] && typeof items[i + 1] === 'object' && items[i + 1].open === '{') return text(items[i + 1].items).replace(/\\_/g, '_').trim();
  return null;
};
const isTrigtype = (items, i) => TRIGTYPE_NAMES.has(nameOf(items, i));
// the factor starting at i (spaces skipped before it) -> { start, end, kind } with kind 'function',
// 'bracket', 'e' (e^x: the exponential function), 'atom', or null at an operator, a relation, the end
function factorAt(items, i) {
  while (isSpace(items[i])) i++;
  const start = i;
  const t = items[i];
  if (t === undefined) return null;
  let kind;
  if (isBracket(t)) { kind = 'bracket'; i++; } else if (typeof t === 'object') { kind = 'atom'; i++; } else if (/^\d$|^\.$/.test(t)) {
    kind = 'atom';
    while (/^[\d.]$/.test(items[i] || '')) i++;
  } else if (/^[A-Za-z]$/.test(t)) { kind = t === 'e' && /^\s*\^/.test(text(items.slice(i + 1, i + 3))) ? 'e' : 'atom'; i++; } else if (NAME_COMMANDS.test(t)) {
    const name = nameOf(items, i);
    i += 2;
    kind = name && (TRIGTYPE_NAMES.has(name) || OTHER_FUNCTIONS.has(name)) ? 'function'
      : name && !/^unit_/.test(name) && (() => { let k = i; while (isSpace(items[k])) k++; return isBracket(items[k]); })() ? 'function' : 'atom';
  } else if (/^\\[A-Za-z]+$/.test(t)) {
    const name = t.slice(1);
    if (TRIGTYPE_NAMES.has(name) || OTHER_FUNCTIONS.has(name)) kind = 'function';
    else if (SPACING.test(t) || MULTIPLY.test(t) || /^\\(div|left|right|le|leq|ge|geq|ne|neq|pm|mp|to|quad|qquad|infty|partial|nabla)$/.test(t) && !/^\\(infty)$/.test(t)) return t === '\\infty' ? { start, end: i + 1, kind: 'atom' } : null;
    else kind = 'atom';
    i++;
    for (let n = BRACE_ARGS[t] || 0; n > 0; n--) {
      while (isSpace(items[i])) i++;
      if (items[i] === '[' && t === '\\sqrt') { while (i < items.length && items[i] !== ']') i++; i++; n++; continue; }
      if (items[i] !== undefined) i++;
    }
  } else return null;
  // ^.. _.. ' ! after it
  for (;;) {
    let k = i;
    while (isSpace(items[k])) k++;
    if ((items[k] === '^' || items[k] === '_') && items[k + 1] !== undefined) { i = k + 2; while (isSpace(items[i - 1]) && items[i] !== undefined) i++; continue; }
    if (items[k] === "'" || items[k] === '!') { i = k + 1; continue; }
    break;
  }
  return { start, end: i, kind };
}
// a function at i with its ^.. _.. -> the index after them
function afterFunction(items, i) {
  const f = factorAt(items, i);
  return f ? f.end : i + 1;
}
const wrap = (items) => ({ open: '\\left(', items, close: '\\right)' });
function trigArguments(items, inIntegral) {
  items = items.map((t) => (typeof t === 'string' ? t : { ...t, items: trigArguments(t.items, inIntegral) }));
  const out = [];
  for (let i = 0; i < items.length;) {
    const f = factorAt(items, i);
    if (!f || f.kind !== 'function' || !isTrigtype(items, f.start)) {
      const end = f ? f.end : i + 1;
      out.push(...items.slice(i, end));
      i = end;
      continue;
    }
    out.push(...items.slice(i, f.end));
    let k = f.end;
    const first = factorAt(items, k);
    if (!first || first.kind === 'function') { i = k; continue; } // sin e^x: e^x is its argument (the first factor always is)
    // the argument: first .. end
    let end = first.end;
    const allowed = (g) => g && (g.kind === 'atom' || g.kind === 'bracket') && !(inIntegral && items[g.start] === 'd' && /^[A-Za-z]$|^\\[A-Za-z]+$/.test(items[g.start + 1] || ''));
    if (first.kind === 'bracket') {
      const next = factorAt(items, end);
      if (!(next && next.kind === 'atom' && !(inIntegral && items[next.start] === 'd'))) { out.push(...items.slice(k, end)); i = end; continue; } // 2.
    }
    for (;;) {
      let j = end;
      while (isSpace(items[j])) j++;
      const op = typeof items[j] === 'string' && (MULTIPLY.test(items[j]) || items[j] === '/' || items[j] === '\\div') ? j + 1 : j;
      const g = factorAt(items, op);
      if (!allowed(g)) break;
      end = g.end;
    }
    const arg = items.slice(first.start, end);
    out.push(...items.slice(k, first.start), arg.length === 1 && isBracket(arg[0]) ? arg[0] : wrap(arg));
    i = end;
  }
  return out;
}
// 3.: a / b c -> \frac{a}{b} c, a being the factors before the / back to a + − relation or comma
const ENDS_LEFT = (t) => typeof t === 'string' && (/^[+\-=<>,;&]$/.test(t) || /^\\(\\|le|leq|ge|geq|ne|neq|pm|mp|to|quad|qquad|equiv|approx|sim|in|subset|cup|cap|wedge|vee|rightarrow|Rightarrow|leftrightarrow|mid)$/.test(t));
function slashes(items) {
  items = items.map((t) => (typeof t === 'string' ? t : { ...t, items: slashes(t.items) }));
  if (!items.includes('/') && !items.includes('\\div')) return items;
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const t = items[i];
    if (t !== '/' && t !== '\\div') { out.push(t); continue; }
    // the right side: one factor (d/dx: dx), a function with its argument
    const r = factorAt(items, i + 1);
    if (!r) { out.push(t); continue; }
    let end = r.end;
    if (r.kind === 'function') { const a = factorAt(items, end); if (a) end = a.end; } else if (items[r.start] === 'd' || items[r.start] === '\\partial') {
      const v = factorAt(items, end);
      if (v && v.kind === 'atom' && v.start === end) end = v.end;
    }
    let s = out.length;
    while (s > 0 && !ENDS_LEFT(out[s - 1])) s--;
    while (s < out.length && isSpace(out[s])) s++;
    const left = out.splice(s);
    if (!left.length) { out.push(...left, t); continue; }
    const right = items.slice(r.start, end);
    out.push('\\frac', { open: '{', items: left, close: '}' }, { open: '{', items: right, close: '}' });
    i = end - 1;
  }
  return out;
}
export function reading55(tex) {
  if (!/\\(sin|cos|tan|cot|sec|csc|arc|sinh|cosh|tanh|coth|log|ln|operatorname)|\/|\\div/.test(tex)) return tex;
  const t = tree(tokens(tex.replace(/(\d\.?)\s*\\,\s*(?=\d)/g, '$1')));
  if (!t) return tex;
  return text(slashes(trigArguments(t, /\\i*int|\\oint/.test(tex))));
}

// the parts of a formula that end at a relation, a comma or a column: the extent of a mod
const SEPARATOR = /^(=|<|>|,|;|&|\\\\|\\(le|leq|ge|geq|ne|neq|equiv|quad|qquad))$/;
const MOD = '\\OPENSWMOD';
// a mod n, a mod n mod m, written in a part: \operatorname{Modulo}(a, n) (5.5 reads mod after
// everything else in its part: x^2+1 mod 5 reduces the whole polynomial)
function modulo(items) {
  items = items.map((t) => (typeof t === 'string' ? t : { ...t, items: modulo(t.items) }));
  if (!items.includes(MOD)) return items;
  const out = [];
  let part = [];
  const flush = () => {
    let pieces = [[]];
    for (const t of part) if (t === MOD) pieces.push([]); else pieces[pieces.length - 1].push(t);
    let acc = pieces[0];
    for (const p of pieces.slice(1)) acc = ['\\operatorname{Modulo}', { open: '\\left(', items: [...acc, ',', ...p], close: '\\right)' }];
    out.push(...acc);
    part = [];
  };
  for (const t of items) {
    if (typeof t === 'string' && SEPARATOR.test(t)) { flush(); out.push(t); } else part.push(t);
  }
  flush();
  return out;
}

// \mathcal{L}(f), \mathcal{L}^{-1}(F, s, t), \mathcal{F}(f, x, w): 5.5's Laplace and Fourier transforms
const TRANSFORMS = { L: 'LaplaceTransform', F: 'FourierTransform' };
// J_n(x), Y_n(x), I_n(x), K_n(x): Bessel functions, as in 5.5 -> \operatorname{BesselJ}(n, x);
// [f(x)]_{x=a}^{x=b} and \left. f(x)\right\vert_{x=a}: evaluation bars, written as the parser reads them
const BESSEL = { J: 'BesselJ', Y: 'BesselY', I: 'BesselI', K: 'BesselK' };
function besselAndBars(items) {
  items = items.map((t) => (typeof t === 'string' ? t : { ...t, items: besselAndBars(t.items) }));
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const t = items[i];
    let j = i + 2;
    while (/^\s+$/.test(items[j + 1] || '')) j++;
    const arg = items[j + 1];
    if (BESSEL[t] && items[i + 1] === '_' && items[i + 2] && arg && typeof arg === 'object' && /^(\\left\s*)?\($/.test(arg.open)) {
      const order = typeof items[i + 2] === 'string' ? [items[i + 2]] : items[i + 2].items;
      out.push(`\\operatorname{${BESSEL[t]}}`, { open: '\\left(', items: [...order, ',', ...arg.items], close: '\\right)' });
      i = j + 1;
      continue;
    }
    // D_{x^5y^2}(f), D_x[f]: 5.5's partial derivatives -> \frac{\partial^7}{\partial x^5\partial y^2}(f)
    const sub = t === 'D' && items[i + 1] === '_' && items[i + 2] && (typeof items[i + 2] === 'string' ? items[i + 2] : text(items[i + 2].items));
    // D_x z(x,y): of the function applied (as D_x(z(x,y)))
    let applied = null;
    if (sub && typeof arg === 'string' && /^[A-Za-z]$/.test(arg)) {
      let k = j + 2;
      while (/^\s+$/.test(items[k] || '')) k++;
      if (items[k] && typeof items[k] === 'object' && /^(\\left\s*)?\($/.test(items[k].open)) applied = k;
    }
    if (sub && applied && /^(\s*,?\s*(\\[A-Za-z]+|[A-Za-z])(\s*\^\s*(\{\s*\d+\s*\}|\d))?)+\s*$/.test(sub)) {
      items = [...items.slice(0, j + 1), { open: '\\left(', items: [arg, items[applied]], close: '\\right)' }, ...items.slice(applied + 1)];
      i--;
      continue;
    }
    if (sub && /^(\s*,?\s*(\\[A-Za-z]+|[A-Za-z])(\s*\^\s*(\{\s*\d+\s*\}|\d))?)+\s*$/.test(sub) && arg && typeof arg === 'object' && /^(\\left\s*)?[([]$/.test(arg.open)) {
      let n = 0;
      const below = [...sub.matchAll(/(\\[A-Za-z]+|[A-Za-z])(?:\s*\^\s*(?:\{\s*(\d+)\s*\}|(\d)))?/g)].map((m) => {
        const k = Number(m[2] || m[3] || 1);
        n += k;
        return `\\partial ${m[1]}${k > 1 ? `^{${k}}` : ''}`;
      });
      out.push(`\\frac{\\partial${n > 1 ? `^{${n}}` : ''}}{${below.join(' ')}}`, { open: '\\left(', items: arg.items, close: '\\right)' });
      i = j + 1;
      continue;
    }
    if (t === '\\mathcal' && typeof items[i + 1] === 'object' && TRANSFORMS[text(items[i + 1].items).trim()]) {
      let k = i + 2;
      const skip = () => { while (/^\s+$/.test(items[k] || '')) k++; };
      skip();
      const inverse = items[k] === '^' && /^\s*-\s*1\s*$/.test(typeof items[k + 1] === 'string' ? items[k + 1] : text(items[k + 1].items));
      if (inverse) { k += 2; skip(); }
      const g = items[k];
      if (g && typeof g === 'object' && /^(\\left\s*)?\($/.test(g.open)) {
        const name = text(items[i + 1].items).trim();
        // the variables when not given (5.5's): \mathcal{L}(f) is from t to s, \mathcal{F}(f) from x to w
        const [from, to] = { L: ['t', 's'], F: ['x', 'w'] }[name];
        const vars = g.items.includes(',') ? [] : inverse ? [',', to, ',', from] : [',', from, ',', to];
        out.push(`\\operatorname{${inverse ? 'Inverse' : ''}${TRANSFORMS[name]}}`, { open: '\\left(', items: [...g.items, ...vars], close: '\\right)' });
        i = k;
        continue;
      }
    }
    if (typeof t === 'object' && /^\\left/.test(t.open)) {
      let k = i + 1;
      while (/^\s+$/.test(items[k] || '')) k++;
      const sub = items[k] === '_' && items[k + 1];
      const bar = sub && ((/\[$/.test(t.open) && /\]$/.test(t.close) && typeof sub === 'object' && text(sub.items).includes('='))
        || (/\.$/.test(t.open) && /(\\vert|\|)$/.test(t.close)));
      if (bar) { out.push({ open: '\\left.', items: t.items, close: '\\right|' }); continue; }
    }
    out.push(t);
  }
  return out;
}

// units 5.5 knows (\unit{ft} is \mathrm{ft} here) -> the names unit_ft the engine knows
const UNIT_NAMES = new Set(('m s kg g A K mol cd h min d y ft in yd mi acre hectare gal qt pint l L lb lbf oz ozf slug ton '
  + 'N J W Pa C V F S T H Wb Hz Bq Ci Gy Sv lm lx sr rad hp cal kcal Btu eV erg dyn bar atm torr mmHg psi G sb phot u '
  + 'nmi au ly pc Angstrom').split(' '));
const PREFIXED = /^(a|f|p|n|mu|m|c|d|k|M|G|T|P|E)(m|s|g|A|K|mol|N|J|W|Pa|C|V|F|S|T|H|Wb|Hz|l|L|eV|bar|rad|Ohm)$/;
const isUnit = (u) => UNIT_NAMES.has(u) || PREFIXED.test(u) || u === 'Ohm';
// 5.x's angle units (\unit{\U{b0}}, read as \mathrm{{{}^\circ}}): degrees, minutes, seconds of arc
const ANGLES = { '^\\circ': '^{\\circ}', '\u00b0': '^{\\circ}', '^\\prime': '\\cdot\\frac{\\pi}{10800}', '\u2032': '\\cdot\\frac{\\pi}{10800}',
  '^\\prime\\prime': '\\cdot\\frac{\\pi}{648000}', '\u2033': '\\cdot\\frac{\\pi}{648000}' };
function units(tex) {
  tex = tex.replace(/\\mathrm\s*\{((?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*)\}/g, (m, u) => ANGLES[u.replace(/[{}\s]/g, '')] || m);
  return tex.replace(/(\^\s*\{?\s*)?\\mathrm\s*\{\s*((?:\\mu\s*|\u03bc)?[A-Za-z]*(?:\\Omega)?)\s*\}/g, (m, sup, u) => {
    const name = u.replace(/\\Omega/, 'Ohm').replace(/^(\\mu\s*|\u03bc)/, 'mu');
    // ^{\mathrm{T}} is a transpose; \mathrm{d} is a day only after a number (else d of dx)
    return sup || !isUnit(name) || name === 'd' ? m : `\\operatorname{unit\\_${name}}`;
  }).replace(/(\d\s*(?:\\,|\\ |\s)*)\\mathrm\s*\{\s*d\s*\}(?!\s*\\?[A-Za-z])/g, '$1\\operatorname{unit\\_d}');
}

// a ( left open inside a group, as in 5.x's \left( \func{Heaviside}(t\right): closed at the group's end
function closeBrackets(items) {
  items = items.map((t) => (typeof t === 'string' ? t : { ...t, items: closeBrackets(t.items) }));
  let open = 0;
  for (const t of items) if (t === '(') open++; else if (t === ')' && open) open--;
  return open ? [...items, ...Array(open).fill(')')] : items;
}

export function notation55(tex) {
  return reading55(notationParts(tex));
}
function notationParts(tex) {
  // layout only: no meaning for computing
  tex = tex.replace(/\\(displaystyle|textstyle|scriptstyle|scriptscriptstyle|limits|nolimits|bigskip|medskip|smallskip)(?![A-Za-z])/g, '')
    .replace(/\\[vh]space\*?\s*\{[^{}]*\}/g, '');
  tex = units(tex).replace(/\\tciLaplace(?![A-Za-z])/g, '\\mathcal{L}').replace(/\\tciFourier(?![A-Za-z])/g, '\\mathcal{F}');
  // 5.x's i\ast 10^{-2} is a product (z^{\ast} stays the conjugate); "x & if & x<0" in cases is the word if
  tex = tex.replace(/(?<!\^\s*\{?\s*)\\ast(?![A-Za-z])/g, '\\cdot ').replace(/&\s*if\s*&/g, '&\\text{if}&');
  // MuPAD's AiryAi(z, 1) is the derivative: a name the parser does not keep to one argument
  tex = tex.replace(/\\operatorname\s*\{Airy(Ai|Bi)\}/g, '\\operatorname{Airy\\_$1}');
  // D(x) is a function named D (5.5's Define MuPAD Name D(x) = divisors), not the parser's derivative D
  // (the engines name it D again)
  tex = tex.replace(/(?<![A-Za-z\\])D(?=\s*(?:\\left\s*)?\()/g, '\\operatorname{opensw\\_D}');
  // (-0.008)^{1/3}: 5.5 computes a power of a decimal, the principal value 0.1 + 0.17321i, where
  // \sqrt[3]{-0.008} is the real root -0.2; a decimal exponent keeps it a power (the parser would make
  // it the root)
  tex = tex.replace(/((?:\\left\s*)?\(\s*-\s*(?:\d+\.\d*|\.\d+)\s*(?:\\right\s*)?\)\s*\^\s*)(?:\{\s*\\[dt]?frac\s*\{\s*1\s*\}\s*\{\s*(\d+)\s*\}\s*\}|\{\s*1\s*\/\s*(\d+)\s*\}|\\[dt]?frac\s*1\s*(\d))/g,
    (m, base, a, b, c) => `${base}{\\frac{1.0}{${a || b || c}}}`);
  if (!/\\(operatorname\s*\{mod\}|bmod(?![A-Za-z])|mod(?![A-Za-z]))|[DJYIK]\s*_|\\right|\\mathcal/.test(tex)) return tex;
  const t = tree(tokens(tex.replace(/\\operatorname\s*\{mod\}|\\bmod(?![A-Za-z])|\\mod(?![A-Za-z])/g, MOD + ' ')));
  if (!t) return tex;
  return text(besselAndBars(modulo(closeBrackets(t))));
}

const FUNCTION_LETTERS = new Set(['f', 'g', 'h']);
const CAPITAL_GREEK = new Set(['Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega']);
const SMALL_GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota',
  'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega']);

// a variable name: one letter or a small Greek letter, maybe with a subscript (x, w_0, alpha, p_1)
const isVariableName = (s) => typeof s === 'string' && /^([A-Za-z]|[a-z]+)(_.+)?$/.test(s) && (s.length === 1 || /^[A-Za-z]_/.test(s) || SMALL_GREEK.has(s.split('_')[0]));
const isAtom = (j) => typeof j === 'number' || (typeof j === 'string' && !j.startsWith("'")) || (j && typeof j === 'object' && !Array.isArray(j) && ('num' in j || 'sym' in j));

// ---------- d/dx: wrap the term that follows in \left( \right) ----------

const OPERATOR = /\\[dt]?frac\s*\{\s*(?:d|\\partial)(?:\s*\^\s*(?:\{[^{}]*\}|\d))?\s*\}\s*\{(?:\s*(?:d|\\partial)\s*(?:\\[A-Za-z]+|[A-Za-z])(?:_\{[^{}]*\}|_[A-Za-z0-9])?(?:\s*\^\s*(?:\{[^{}]*\}|\d))?)+\s*\}/g;

// the end of the term that starts at i: the next +, −, =, comma or relation outside brackets,
// or the end of the enclosing group
function termEnd(s, i) {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (s.startsWith('\\left', k) && !/[A-Za-z]/.test(s[k + 5] || '')) { depth++; k += 4; continue; }
    if (s.startsWith('\\right', k) && !/[A-Za-z]/.test(s[k + 6] || '')) { if (depth === 0) return k; depth--; k += 5; continue; }
    if (c === '\\') { const m = s.slice(k).match(/^\\([A-Za-z]+|.)/); if (m[0] === '\\begin') depth++; else if (m[0] === '\\end') depth--; if (depth === 0 && /^\\(qquad|quad|le|leq|ge|geq|neq|ne|cdots|ldots)$/.test(m[0]) && k > i) return k; k += m[0].length - 1; continue; }
    if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') { if (depth === 0) return k; depth--; }
    else if (depth === 0 && k > i && /[+\-=,<>&]/.test(c)) return k;
  }
  return s.length;
}

export function scopeDerivatives(tex) {
  let out = '';
  let last = 0;
  OPERATOR.lastIndex = 0;
  for (let m; (m = OPERATOR.exec(tex));) {
    let start = m.index + m[0].length;
    while (tex[start] === ' ') start++;
    // d/dx (x^2) y: the derivative of the bracket, as the parser reads it
    if (/^(\\left\s*)?\(/.test(tex.slice(start))) continue;
    const end = termEnd(tex, start);
    if (end <= start) continue;
    let operand = tex.slice(start, end);
    // d/dx \left[ .. \right]: brackets, as d/dx ( .. ) (the parser would read a list)
    const t = operand.trimEnd();
    if (/^\\left\s*\[/.test(t) && closing(t, 0) === t.length) operand = `\\left(${t.replace(/^\\left\s*\[/, '').replace(/\\right\s*\]$/, '')}\\right)`;
    out += tex.slice(last, m.index) + m[0] + '\\left(' + scopeDerivatives(operand) + '\\right)';
    last = end;
    OPERATOR.lastIndex = end;
  }
  return out + tex.slice(last);
}

// ---------- g(i) = 0.1i: i as a function's variable ----------
// In a definition of a function of i (g(i), f(i,j), as 5.5's pages use for Fill Matrix), i is the
// variable on both sides, not the imaginary unit: renamed here so the parser keeps it a name
// (normalize() names it i again).
const I_NAME = '\\operatorname{opensw\\_i}';
// subscript: a_i = 3i with the subscript a function argument (5.5's Interpret Subscript), i too.
export function definitionOfI(tex, subscript = false) {
  const m = tex.match(/^\s*(\\[A-Za-z]+|[A-Za-z])(\s*_\s*(\{[^{}]*\}|[A-Za-z0-9]))?\s*(\\left\s*)?\(([^()]*?)(\\right\s*)?\)\s*:?=/);
  const sub = subscript && /^\s*[A-Za-z]\s*_\s*(\{\s*i\s*\}|i)\s*:?=/.test(tex);
  if (!sub && (!m || !m[5].split(',').some((a) => a.trim() === 'i'))) return tex;
  return tex.replace(/\\(?:text|func|operatorname|mathrm|textrm|mbox)\s*\{[^{}]*\}|\\[A-Za-z]+|\\.|i/g, (t) => (t === 'i' ? I_NAME + ' ' : t));
}

// ---------- \\log is the natural logarithm, as in 5.5 ----------
// (\\log_b is base b; the parser would read a plain \\log as base 10)
export const naturalLog = (tex) => tex.replace(/\\log(?![A-Za-z])(?!\s*_)/g, '\\ln');

// ---------- the Compute settings that change what a formula means (Tools > Engine Setup) ----------
// \\log in base 10 (5.5's Base for Log Function, Change from e to 10; naturalLog() is not used then):
// written Log10, which the engine shows as \\log_{10}, as 5.5 does then. ∇, grad, div, curl in other
// basis variables than x, y, z (5.5's Set Basis Variables): the variables follow the formula.
const NABLA_HEADS = new Set(['Gradient', 'Divergence', 'Curl', 'Laplacian']);
export function withSettings(json, { logBase10 = false, basis = ['x', 'y', 'z'] } = {}) {
  const other = basis.join() !== 'x,y,z';
  const walk = (j) => {
    if (!Array.isArray(j)) return j;
    const k = j.map(walk);
    if (logBase10 && k[0] === 'Log' && k.length === 2) return ['Log10', k[1]];
    if (other && NABLA_HEADS.has(k[0]) && k.length === 2) return [...k, ...basis];
    return k;
  };
  return walk(json);
}

// ---------- x(a+b): \\cdot before the bracket ----------
// The parser takes x(...) for a function of x, and then x elsewhere in the formula clashes with
// that; so a letter that is not a function gets \\cdot before brackets holding more than one name
// or number: x(a+b), b\\left(\\beta+y\\right), \\xi(1+t). (normalize() below handles what remains.)
const GREEK_COMMAND = /^\\(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|rho|varrho|sigma|tau|upsilon|phi|varphi|chi|psi|omega)$/;
function closing(s, open) { // s[open] is '(' or the start of \\left( -> the index after the matching ) or \\right)
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s.startsWith('\\left', k)) { depth++; k += 5; continue; }
    if (s.startsWith('\\right', k)) { depth--; k += 6; if (depth === 0) return k + 1; continue; }
    if (s[k] === '\\') { k++; continue; }
    if (s[k] === '(' || s[k] === '{' || s[k] === '[') depth++;
    else if (s[k] === ')' || s[k] === '}' || s[k] === ']') { depth--; if (depth === 0) return k + 1; }
  }
  return -1;
}
export function explicitProducts(tex, functions = new Set()) {
  let out = '';
  for (let i = 0; i < tex.length;) {
    let name = null;
    let end = i;
    if (tex[i] === '\\') {
      const m = tex.slice(i).match(/^\\([A-Za-z]+)/);
      if (!m) { out += tex.slice(i, i + 2); i += 2; continue; }
      if (GREEK_COMMAND.test(m[0])) name = m[1];
      end = i + m[0].length;
    } else if (/[A-Za-z]/.test(tex[i])) { name = tex[i]; end = i + 1; }
    else { out += tex[i]; i++; continue; }
    out += tex.slice(i, end);
    i = end;
    if (!name || FUNCTION_LETTERS.has(name) || functions.has(name)) continue;
    const m = tex.slice(i).match(/^\s*(\\left\s*)?\(/);
    if (!m) continue;
    const open = i + m[0].length - 1 - (m[1] ? m[1].length : 0);
    const close = closing(tex, open);
    if (close < 0) continue;
    const inner = tex.slice(i + m[0].length, close).replace(/\\right\s*\)$|\)$/, '');
    // one name or number, or a list (w(0,y)): a function's arguments
    if (/^\s*(\\?[A-Za-z]+|[0-9.]+)(_\{?[A-Za-z0-9]+\}?)?\s*$/.test(inner) || /,/.test(inner)) continue;
    out += '\\cdot ';
  }
  return out;
}

// ---------- matrices and vectors, as 5.x writes them ----------
// \left[ \begin{array}{cc}..\end{array}\right] -> bmatrix (the parser reads \left[ as a list and
// x\left[..\right] as indexing); \left( ( ), \left\vert | | (a determinant), \left\Vert ‖ ‖ (a norm).
// Then, in a formula with a matrix or a list, \times and \cdot are kept apart (cross and dot
// product; the parser reads both as a product): normalize() turns them back into a product
// unless one side is a vector. (always: also without one written, when vectors have been defined)
const MATRIX_DELIMS = [[/^\\left\s*\[/, /^\\right\s*\]/, 'bmatrix'], [/^\\left\s*\(/, /^\\right\s*\)/, 'pmatrix'],
  [/^\\left\s*(\\Vert|\\\|)/, /^\\right\s*(\\Vert|\\\|)/, 'Vmatrix'], [/^\\left\s*(\\vert|\|)/, /^\\right\s*(\\vert|\|)/, 'vmatrix']];
function arrayEnd(s, from) { // the index of the \end{array} matching the \begin{array} before from
  const re = /\\(begin|end)\{array\}/g;
  re.lastIndex = from;
  for (let depth = 1, m; (m = re.exec(s));) if ((depth += m[1] === 'begin' ? 1 : -1) === 0) return m.index;
  return -1;
}
// 5.5's ∇ on the term that follows (as d/dx): ∇·F, ∇×F, ∇^2 f or ∇·∇f, ∇f
const NABLA = /\\nabla\s*(\\cdot\s*\\nabla(?![A-Za-z])|\\cdot(?![A-Za-z])|\\times(?![A-Za-z])|\^\s*(\{\s*2\s*\}|2))?\s*/;
function nabla(tex) {
  const m = tex.match(NABLA);
  if (!m) return tex;
  const start = m.index + m[0].length;
  const end = termEnd(tex, start);
  const op = !m[1] ? 'Gradient' : m[1].startsWith('\\times') ? 'Curl' : m[1].startsWith('\\cdot') && !/nabla/.test(m[1]) ? 'Divergence' : 'Laplacian';
  return tex.slice(0, m.index) + `\\operatorname{${op}}\\left(${nabla(tex.slice(start, end))}\\right)` + nabla(tex.slice(end));
}
export function vectorTeX(tex, always = false) {
  let out = '';
  for (let i = 0; i < tex.length;) {
    const rest = tex.slice(i);
    const d = rest.startsWith('\\left') && MATRIX_DELIMS.find(([open]) => open.test(rest));
    const m = d && rest.slice(rest.match(d[0])[0].length).match(/^\s*\\begin\{array\}(\{[^{}]*\})?/);
    if (m) {
      const body = i + rest.match(d[0])[0].length + m[0].length;
      const end = arrayEnd(tex, body);
      const close = end >= 0 && tex.slice(end + 11).match(/^\s*/)[0].length + end + 11;
      const r = close && tex.slice(close).match(d[1]);
      if (r) {
        const cells = vectorTeX(tex.slice(body, end)).replace(/\\vspace\*?\{[^{}]*\}/g, '');
        out += `\\begin{${d[2]}}${cells}\\end{${d[2]}}`;
        i = close + r[0].length;
        continue;
      }
    }
    out += tex[i++];
  }
  out = nabla(out);
  if (always || /\\begin\{[bpvV]?matrix\}|,/.test(out)) out = out.replace(/\\times(?![A-Za-z])/g, '\\otimes').replace(/\\cdot(?![A-Za-z])/g, '\\star');
  return out;
}

// ---------- MathJSON ----------

// names used as functions anywhere in the formula: with a prime, or with two or more arguments
function functionUses(j, found = new Set()) {
  if (!Array.isArray(j)) return found;
  const [head, ...args] = j;
  if (head === 'Apply' && Array.isArray(args[0]) && args[0][0] === 'Derivative') found.add(args[0][1]);
  if (head === 'D' && Array.isArray(args[0]) && typeof args[0][0] === 'string' && args[0].slice(1).every(isAtom)) found.add(args[0][0]);
  if (typeof head === 'string' && isVariableName(head) && args.length > 1) found.add(head);
  for (const a of args) functionUses(a, found);
  return found;
}

// names that also stand alone as a variable somewhere in the formula
function plainNames(j, found = new Set()) {
  if (typeof j === 'string') found.add(j);
  else if (Array.isArray(j)) for (const a of j.slice(1)) plainNames(a, found);
  return found;
}

const FRESH = 'opensw_t';
// where the parser reports a wrong type: ["Error", ["ErrorCode", "'incompatible-type'", wanted, found], x] -> [wanted, found]
const typeError = (j) => (Array.isArray(j) && j[0] === 'Error' && Array.isArray(j[1]) && j[1][1] === "'incompatible-type'" && j.length === 3 ? [j[1][2], String(j[1][3])] : [null, '']);

const NABLA_OPS = new Set(['Gradient', 'Divergence', 'Curl', 'Laplacian']);
// a matrix or list written out, or arithmetic with one
const VECTORS = new Set(['Matrix', 'List', 'Tuple', 'Cross', 'Gradient', 'Curl']);
const ARITHMETIC = new Set(['Add', 'Subtract', 'Negate', 'Multiply', 'Divide', 'Transpose', 'ConjugateTranspose', 'Inverse', 'Delimiter']);
const isVector = (j) => Array.isArray(j) && (VECTORS.has(j[0]) || (ARITHMETIC.has(j[0]) && j.slice(1).some(isVector)));

// derivatives: false leaves f'(y) and the parser's d/dx forms as they are (the ODE operations read them)
// vectors: the names defined as vectors (a \times b is their cross product)
export function normalize(json, functions = new Set(), { derivatives = true, vectors = new Set() } = {}) {
  const used = functionUses(json);
  const plain = plainNames(json);
  // f_a(y) defined: f_3 is only a subscripted name (5.5), f_3(5) a product
  const otherSubscript = (name) => /_/.test(name) && [...functions].some((f) => f !== name && f.split('_')[0] === name.split('_')[0] && /_/.test(f));
  const isFunction = (name, args) => FUNCTION_LETTERS.has(name) || CAPITAL_GREEK.has(name) || functions.has(name) || used.has(name)
    || (!plain.has(name) && args.length === 1 && isAtom(args[0]) && !otherSubscript(name));
  const walk = (j) => {
    if (typeof j === 'string' && j.includes('opensw_i')) return j.replace(/opensw_i/g, 'i'); // definitionOfI()
    if (!Array.isArray(j)) return j;
    const [head, ...rest] = j;
    const args = rest.map(walk);
    // f'(y) -> D(f(y), y); f'(0) -> (D(f(t), t) at t = 0)
    if (derivatives && head === 'Apply' && Array.isArray(args[0]) && args[0][0] === 'Derivative' && args.length === 2) {
      const [, name, n = 1] = args[0];
      const times = Number(typeof n === 'object' ? n.num : n) || 1;
      const at = args[1];
      if (typeof at === 'string' && !at.startsWith("'")) return ['D', [name, at], ...Array(times).fill(at)];
      return ['EvaluateAt', ['Function', ['Block', ['D', [name, FRESH], ...Array(times).fill(FRESH)]], FRESH], at];
    }
    // ∂/∂y w_0: the parser wraps the operand in a Function of y
    if (derivatives && head === 'D' && Array.isArray(args[0]) && args[0][0] === 'Function') {
      const body = Array.isArray(args[0][1]) && args[0][1][0] === 'Block' ? args[0][1][args[0][1].length - 1] : args[0][1];
      return ['D', body, ...args.slice(1)];
    }
    // \times and \cdot (vectorTeX): the cross and dot product of vectors, otherwise a product
    if (head === 'CircleTimes' || head === 'Star') {
      if (args.some((a) => isVector(a) || vectors.has(a))) return args.reduce((a, b) => [head === 'Star' ? 'Dot' : 'Cross', a, b]); // left to right, as 5.5
      return ['Multiply', ...args.flatMap((a) => (Array.isArray(a) && a[0] === 'Multiply' ? a.slice(1) : [a]))];
    }
    // f\left(\begin{pmatrix}..\end{pmatrix}\right), Curl of one: the parser makes it a product
    if (head === 'Multiply' && args.length === 2 && (NABLA_OPS.has(args[0]) || FUNCTION_LETTERS.has(args[0]) || functions.has(args[0]))
      && Array.isArray(args[1]) && args[1][0] === 'Matrix') return [args[0], args[1]];
    if (head === 'Airy_Ai' || head === 'Airy_Bi') return [head.replace('_', ''), ...args]; // notation55()
    // Heaviside(i): the parser wants a real argument (the engine answers undefined, as 5.5)
    if (head === 'Heaviside' && args.length === 1 && typeError(args[0])[0]) return [head, args[0][2]];
    // 5.5's 27 \vee 31, 27 \wedge 31 of numbers: the larger, the smaller
    if ((head === 'Or' || head === 'And') && args.length > 1 && args.every((x) => typeError(x)[0] === "'boolean'")) {
      return [head === 'Or' ? 'Max' : 'Min', ...args.map((x) => x[2])];
    }
    // \func{erf}x, \func{Re}z: a function name the parser did not apply to what follows
    if (head === 'Multiply' && args.some((x) => /->/.test(typeError(x)[1]))) {
      const out = [];
      for (let i = 0; i < args.length; i++) {
        const f = /->/.test(typeError(args[i])[1]) && typeof args[i][2] === 'string' && i + 1 < args.length;
        out.push(f ? [args[i][2], args[++i]] : args[i]);
      }
      return out.length === 1 ? out[0] : ['Multiply', ...out];
    }
    // 5.5's \func{seq}_{n=1..4}(f): ["Seq", f, n, 1, 4]
    const seq = head !== 'Multiply' ? -1 : args.findIndex((x) => Array.isArray(x) && x[0] === 'Subscript' && x[1] === 'seq'
      && Array.isArray(x[2]) && x[2][0] === 'Equal' && Array.isArray(x[2][2]) && x[2][2][0] === 'Range');
    if (seq >= 0 && args.length > 1) {
      const [, , [, v, [, lo, hi]]] = args[seq];
      const rest = args.filter((x, i) => i !== seq);
      return ['Seq', rest.length === 1 ? rest[0] : ['Multiply', ...rest], v, lo, hi];
    }
    // x(a+b): a product
    if (typeof head === 'string' && isVariableName(head) && args.length === 1 && !isFunction(head, args)) {
      return ['Multiply', head, args[0]];
    }
    return [head, ...args];
  };
  return walk(json);
}

// ce.parse(tex).json, with the names defined as matrices or vectors declared as matrices: the
// parser then keeps their order in a product (BA is not AB), reads A^{-1} as the inverse, A_{2,3}
// as an entry, and D as a matrix, not the derivative
export function parseWithVectors(ce, tex, vectors) {
  if (!vectors.size) return ce.parse(tex).json;
  ce.pushScope();
  try {
    for (const v of vectors) {
      try { ce.declare(v, 'matrix'); } catch (e) { /* a name the parser keeps for itself */ }
    }
    return ce.parse(tex).json;
  } finally {
    ce.popScope();
  }
}

// the vector or matrix a definition makes: a = (1, 2, 3) -> a
export function definedVector(json) {
  return Array.isArray(json) && json[0] === 'Equal' && typeof json[1] === 'string' && isVector(json[2]) ? json[1] : null;
}

// the functions a definition makes: f(x) = ... -> f
export function definedFunction(json) {
  const lhs = Array.isArray(json) && json[0] === 'Equal' ? json[1] : null;
  return Array.isArray(lhs) && typeof lhs[0] === 'string' ? lhs[0] : null;
}

// the rows of an ODE system typed as a column (array, matrix or one per line):
// equations y' = f(x, y), y'' = f(x, y, y') and initial values y(x0) = a, y'(x0) = b
// ([name, x0, value, order of the derivative]): an initial value's point has no letters
export function odeRows(latex) {
  const body = latex.replace(/\\begin\{[a-zA-Z]*\}(\{[^}]*\})?|\\end\{[a-zA-Z]*\}/g, '').replace(/^\s*\\left\s*[([]|\\right\s*[)\]]\s*$/g, '');
  const equations = [];
  const inits = [];
  for (const row of body.split(/\\\\|,(?![^{(]*[})])/).map((r) => r.replace(/&/g, '').trim()).filter(Boolean)) {
    const m = !/\\frac\s*\{\s*d/.test(row) && row.match(/^([a-zA-Z])\s*((?:'|\^\s*\{?(?:\s*\\prime\s*)+\}?)*)\s*(?:\\left\s*)?\(\s*(.+?)\s*(?:\\right\s*)?\)\s*=\s*(.+)$/);
    const order = m ? (m[2].match(/'|\\prime/g) || []).length : 0;
    if (m && !(order && /[a-zA-Z]/.test(m[3].replace(/\\[a-zA-Z]+/g, '')))) inits.push([m[1], m[3], m[4], order]);
    else equations.push(row);
  }
  return { equations, inits };
}
