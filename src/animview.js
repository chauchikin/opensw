// Animated plots (5.5's Plot 2D Animated and Plot 3D Animated): the frames main.js draws, and
// the bar under the plot to play, pause and drag through them (5.5's VCam toolbar did this).
// Pictures of every other kind are shown exactly as the schema's toDOM makes them.
import { DOMSerializer } from 'prosemirror-model';
import { _t } from './i18n.js';

// path -> { urls: [SVG blob URL of each frame], values: [the parameter's value], delay (ms), param, index }
const FRAMES = new Map();
export const framesOf = (path) => FRAMES.get(path);
export function setFrames(path, f) {
  const old = FRAMES.get(path);
  FRAMES.set(path, f);
  if (old) setTimeout(() => old.urls.forEach((u) => URL.revokeObjectURL(u)), 5000); // a picture may still show one
}
export const isAnimatedFrame = (frame) => /(^|[;{\s])animated\s+TRUE/i.test(frame || '');

const GREEK = { '\\theta': 'θ', '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\phi': 'φ', '\\varphi': 'φ', '\\tau': 'τ', '\\lambda': 'λ', '\\omega': 'ω', '\\mu': 'μ', '\\sigma': 'σ', '\\rho': 'ρ' };
const shown = (v) => String(+v.toPrecision(4));

export class ImageView {
  constructor(node) {
    this.node = node;
    this.dom = DOMSerializer.renderSpec(document, node.type.spec.toDOM(node)).dom;
    this.timer = null;
    if (node.attrs.plot && isAnimatedFrame(node.attrs.frame)) this.bar(FRAMES.get(node.attrs.path));
  }

  bar(f) {
    const bar = document.createElement('span');
    bar.className = 'anim-ctl';
    bar.contentEditable = 'false';
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'anim-play';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'anim-frame';
    const label = document.createElement('span');
    label.className = 'anim-value';
    bar.append(play, slider, label);
    (this.dom.querySelector('.image-pic') || this.dom).after(bar);
    this.play = play;
    if (!f || !f.urls.length) {
      play.textContent = '▶';
      play.disabled = true;
      slider.disabled = true;
      label.textContent = _t('Drawing the frames…');
      return;
    }
    this.f = f;
    this.slider = slider;
    this.label = label;
    slider.min = 0;
    slider.max = f.urls.length - 1;
    slider.step = 1;
    play.textContent = '▶';
    play.title = _t('Play or pause the animation');
    slider.title = _t('Drag to see the frames');
    play.onclick = () => (this.timer ? this.pause() : this.start());
    slider.oninput = () => { this.pause(); this.show(+slider.value); };
    this.show(f.index ?? 0);
  }

  show(i) {
    const f = this.f;
    f.index = i;
    const img = this.dom.querySelector('img');
    if (img) img.src = f.urls[i];
    this.slider.value = i;
    this.label.textContent = `${GREEK[f.param] || f.param} = ${shown(f.values[i])}`;
  }

  start() {
    const f = this.f;
    if (f.index >= f.urls.length - 1) this.show(0);
    this.play.textContent = '❚❚';
    this.timer = setInterval(() => this.show((f.index + 1) % f.urls.length), f.delay);
  }

  pause() {
    clearInterval(this.timer);
    this.timer = null;
    this.play.textContent = '▶';
  }

  // the bar's buttons and slider are not editing
  stopEvent(e) { return !!e.target.closest?.('.anim-ctl'); }

  ignoreMutation() { return true; }

  update(node) {
    if (node.type !== this.node.type || node.attrs !== this.node.attrs) return false;
    this.node = node;
    return true;
  }

  destroy() { clearInterval(this.timer); }
}
