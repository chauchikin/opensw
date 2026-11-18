// Edit > Copy as Picture: a formula (or a picture / plot) put on the clipboard as a PNG,
// to paste into Word, PowerPoint, a chat ...
// A formula is laid out by MathLive as static HTML; the HTML with MathLive's styles and the
// math fonts (already inside this page's CSS as data) goes into an SVG <foreignObject>,
// which is drawn on a canvas.
import { convertLatexToMarkup } from 'mathlive';
import staticCss from 'mathlive/static.css?raw';
import { MATH_MACROS } from './tex55.js';

// the page's @font-face rules (the math fonts, as data: URLs)
function fontFaces() {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; } // a sheet from elsewhere
    for (const r of rules) if (r instanceof CSSFontFaceRule && /KaTeX/.test(r.cssText)) out.push(r.cssText);
  }
  return out.join('');
}
const CSS = staticCss.replace(/@font-face\{[^}]*\}/g, '');

async function svgToPng(svg, w, h, scale) {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; // a white background, as a formula copied from 5.5
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.scale(scale, scale);
  g.drawImage(img, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

// LaTeX -> PNG Blob (scale 3: sharp when pasted at its size)
export async function formulaPng(latex, display, scale = 3) {
  const markup = convertLatexToMarkup(latex, { defaultMode: display ? 'math' : 'inline-math', macros: MATH_MACROS });
  // measured in the page first, with the same styles
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:-10000px;top:0;font-size:20px;padding:4px;display:inline-block;color:#000;background:#fff';
  const style = document.createElement('style');
  style.textContent = CSS;
  box.append(style);
  const inner = document.createElement('span');
  inner.innerHTML = markup;
  box.append(inner);
  document.body.append(box);
  await document.fonts.ready;
  const { width, height } = box.getBoundingClientRect();
  box.remove();
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  const xhtml = new XMLSerializer().serializeToString(Object.assign(document.createElement('div'), { innerHTML: markup }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="font-size:20px;padding:4px;display:inline-block;color:#000">`
    + `<style>${fontFaces()}${CSS}</style>${xhtml.replace(/^<div[^>]*>|<\/div>$/g, '')}</div></foreignObject></svg>`;
  return svgToPng(svg, w, h, scale);
}

// a picture shown in the page (<img>) -> PNG Blob at its own size
export async function imagePng(img) {
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export async function copyPng(blob) {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
