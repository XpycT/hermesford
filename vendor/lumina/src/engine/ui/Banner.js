import { isCJK } from '../i18n/I18n.js';
import { pal, GEMS } from './art/palette.js';
import { art } from './art/painter.js';
import { gem } from './art/gilt.js';
import { fade, rgbOf, hairline } from './art/pieces.js';
import { measure, grow, txt, UP, fit } from './layout/type.js';
import { group, put } from './layout/layout.js';
import { onScale, currentScale } from './UiScale.js';
import { currentFonts } from './FontLoader.js';
import './ui.css';
import './hud.css';

/**
 * The area-entry title card (top-centre), drawn as mockup G's level-up card (docs/specs/PIXEL_UI.md
 * §5, HUD: Banner): no panel, a stepped radial shade, gold hairlines fading at both ends above and
 * below with a gold gem on the top one, the title in the head role in capitals with an ink outline,
 * the subtitle in the line role. The rules open from the gem in steps, the title settles by two art
 * px, the subtitle follows; it fades out rising two art px. Timings as before: shown for
 * `duration`, then a 1.1 s fade-out.
 *
 * The element (`.lu-banner`) covers the root; the card is a 'tc' group in it, built on `show()` and
 * again on a scale change while shown. It renders what it gets: callers pass translated text.
 *
 * While it is on screen (its fade-out included) `box` is the card's keep-out — the gem and the two
 * rules, in the 640 × 360 frame, with the group's fit scale — and every change of it is announced
 * on the element as a bubbling `lu-banner` event (`detail` the box, null once the card is gone):
 * the HUD's toasts go under the card instead of over it.
 */

const FADE_OUT = 1.1; // seconds, matches .lu-banner.is-out animation
/** The widest title / subtitle in art px (longer ones end in an ellipsis). */
const MAX_W = 520;

/**
 * The card's keep-out in the frame (art px): from the gem's top to the lower rule, the rules'
 * width; `fit` the card group's scale about the screen's top (1 where it fits).
 * @typedef {{ x: number, y: number, w: number, h: number, fit: number }} BannerBox
 */

export class Banner {
  /** @param {HTMLElement} parent */
  constructor(parent = document.body) {
    const el = document.createElement('div');
    el.className = 'lu-banner';
    el.setAttribute('aria-live', 'polite');
    parent.appendChild(el);
    this.element = el;
    this._t1 = 0;
    this._t2 = 0;
    this._resolve = null;
    this._visible = false;
    this._titleText = '';
    this._subText = '';
    /** The measured widths of the card on screen (a re-render only when they change). */
    this._key = '';
    /** @type {BannerBox|null} the card's keep-out (see `box`) */
    this._box = null;
    this._unscale = onScale(parent, () => { if (this._visible) this._render(); });
  }

  /** True while the banner is on screen (including its fade-out). */
  get visible() { return this._visible; }

  /**
   * The card's keep-out while the banner is on screen (its fade-out included), else null: the
   * frame box from the gem's top to the lower rule, as wide as the rules, and the group's fit scale
   * (screen art px = fit × frame y; horizontally about the screen's centre).
   * @returns {BannerBox|null}
   */
  get box() { return this._visible && this._box ? { ...this._box } : null; }

  /** Announce the card's keep-out (or null) on the element: a bubbling 'lu-banner' event. */
  _announce() {
    this.element.dispatchEvent(new CustomEvent('lu-banner', { bubbles: true, detail: this.box }));
  }

  /**
   * Show an area title card.
   * @param {string} title
   * @param {string} [subtitle]
   * @param {{ duration?: number }} [opts] `duration`: seconds from show until the fade-out starts
   *   (the fade-out adds ~1.1 s).
   * @returns {Promise<void>} resolves once the banner has fully faded out (or was replaced).
   */
  show(title, subtitle = '', { duration = 3.5 } = {}) {
    this._settle();
    clearTimeout(this._t1);
    clearTimeout(this._t2);
    const el = this.element;
    const ti = String(title ?? '');
    const su = String(subtitle ?? '');
    this._titleText = ti;
    this._subText = su;
    this._render();
    el.classList.remove('is-in', 'is-out');
    void el.offsetWidth; // restart CSS animations
    el.classList.add('is-in');
    this._visible = true;
    this._announce();
    this._t1 = setTimeout(() => this.hide(), Math.max(1.2, duration) * 1000);
    // Japanese and Chinese faces come in slices: measure again once this text's are in
    const fonts = currentFonts();
    if (fonts && isCJK()) {
      fonts.ensure(`${ti}\n${su}`).then(() => {
        if (this._visible && this._titleText === ti && this._subText === su) this._render();
      }, () => {});
    }
    return new Promise((resolve) => { this._resolve = resolve; });
  }

  /**
   * Start the fade-out now (no-op when hidden); `immediate`: gone at once, a fade-out under way
   * included (a story's `cutscene` takes a just-raised area banner off its first shot).
   * @param {boolean} [immediate]
   */
  hide(immediate = false) {
    const el = this.element;
    if (immediate) {
      if (!this._visible) return;
      clearTimeout(this._t1);
      clearTimeout(this._t2);
      el.classList.remove('is-in', 'is-out');
      this._visible = false;
      this._announce();
      this._settle();
      return;
    }
    if (!this._visible || el.classList.contains('is-out')) return;
    clearTimeout(this._t1);
    el.classList.remove('is-in');
    el.classList.add('is-out');
    this._t2 = setTimeout(() => {
      el.classList.remove('is-out');
      this._visible = false;
      this._announce();
      this._settle();
    }, FADE_OUT * 1000);
  }

  dispose() {
    clearTimeout(this._t1);
    clearTimeout(this._t2);
    this._unscale();
    if (this._visible) {
      this._visible = false;
      this._announce();
    }
    this._settle();
    this.element.remove();
  }

  _settle() {
    const r = this._resolve;
    this._resolve = null;
    if (r) r();
  }

  /**
   * Build the card (G's levelUp): the rules lw art px wide (at least 102, 40 more than the title,
   * 30 more than the subtitle), the shade 24 art px wider each side, centred at x 320 from y 48. A
   * CJK title's or subtitle's taller ink moves what is under it down; without a subtitle the lower
   * rule closes under the title. Unchanged widths on an unchanged screen keep the card (no
   * restarted animations); a new screen size builds it again (its fit to the screen).
   */
  _render() {
    const k = pal();
    const title = fit(UP(this._titleText), 'head', MAX_W, 1);
    const sub = fit(this._subText, 'line', MAX_W);
    const tw = measure(title, 'head', 1), gw = sub ? measure(sub, 'line') : 0;
    const gh = 2 * Math.ceil(grow('head') / 2), gs = sub ? 2 * Math.ceil(grow('line') / 2) : 0;
    const sc = currentScale(this.element);
    const key = `${title}\n${sub}\n${tw}\n${gw}\n${gh}\n${gs}\n${sc?.artW}x${sc?.artH}`;
    if (key === this._key && this.element.firstChild) return;
    this._key = key;
    const el = this.element;
    el.replaceChildren();
    let lw = Math.max(102, tw + 40, gw + 30);
    lw += lw % 2;
    const yTop = 57, yTitle = 60 + gh / 2, ySub = 81 + gh;
    const yBot = sub ? 93 + gh + gs : 84 + gh;
    const sx = 320 - lw / 2 - 24, sw = lw + 48, sh = yBot + 7 - 50;
    const g = group(el, 'tc', sx, 48, sw, sh + 2);
    const shade = fade(sw, sh, rgbOf(k.band), (u, v) => Math.max(0, 1 - Math.hypot((u - 0.5) / 0.5, (v - 0.5) / 0.5)) * 1.4 * 0.7, [0.25, 0.5, 0.7]);
    for (const [c, x, y, cls] of /** @type {[HTMLCanvasElement, number, number, string][]} */ ([
      [shade, sx, 50, 'lu-banner__shade'],
      [hairline(lw, 'both'), 320 - lw / 2, yTop, 'lu-banner__rule'],
      [hairline(lw, 'both'), 320 - lw / 2, yBot, 'lu-banner__rule'],
      [art(9, 5, (p) => gem(p, 4, 2, 1, GEMS.gold(), { setting: [k.g5, k.g4, k.g3] })), 316, 55, 'lu-banner__gem'],
    ])) put(g, c, x, y, 1, cls).setAttribute('aria-hidden', 'true');
    const te = txt(g, title, 320, yTitle, { font: 'head', track: 1, color: k.g5, align: 'center', ol: true, cls: 'lu-banner__title' });
    te.setAttribute('role', 'heading');
    te.setAttribute('aria-level', '2');
    txt(g, sub, 320, ySub, { font: 'line', color: k.g4, align: 'center', ol: true, cls: 'lu-banner__sub' });
    // the keep-out: the gem's top (y 55) to the lower rule, the rules' width
    const fitK = g.dataset.fit === 'shrunk' ? Number(g.style.getPropertyValue('--lu-fit')) || 1 : 1;
    this._box = { x: 320 - lw / 2, y: yTop - 2, w: lw, h: yBot + 1 - (yTop - 2), fit: fitK };
    if (this._visible) this._announce();
  }
}
