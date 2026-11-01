import './ui.css';
import './combat.css';
import { pal, GEMS } from './art/palette.js';
import { divider, gemGlyph } from './art/pieces.js';
import { emberVignette } from './art/combat.js';
import { FONT, measure, txt, txc, UP, originOf } from './layout/type.js';
import { put, U } from './layout/layout.js';
import { anchorGroup, box } from './CombatHUD.js';
import { onScale, currentScale } from './UiScale.js';
import { currentFonts } from './FontLoader.js';

/**
 * DeathScreen — the full-screen defeat overlay (`.lu-death`, COMBAT.md §13.1–§13.2), drawn in the
 * pixel UI's family (docs/specs/PIXEL_UI.md §5): an ember vignette in hard steps with dithered
 * seams over the scene, the title in the heading type at twice its size (whole font pixels), A's
 * divider with ruby gems, a subtitle and the prompt in tracked capitals between ember gems, which
 * appears once input is accepted and blinks in hard steps. `show()` resolves with the device that
 * dismissed it ('key' | 'pointer') once `armDelay` seconds have passed: keys through a window
 * capture-phase listener (the dismissing key is `stopPropagation`ed so it does not also act in the
 * game) or a pointer press on the overlay. The screen stays up until `hide()` (the game fades to
 * black first). z 7 (the world map's slot); not hidden by photo mode. While shown, the root gets
 * `lu-root--death` (the world labels, the interaction prompt, the announcer and the banner step
 * aside). `prime()` pre-renders it once while
 * hidden (COMBAT-02), so the first show is as cheap as any later one; UI.enableCombat() primes it
 * with the translated texts once the fonts are in. Texts come in translated.
 */

const IGNORED_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight', 'F5', 'F11', 'F12', 'CapsLock', 'Tab']);

/** Where the content stands (art px of the 640 × 360 frame, centred): the title's ink centre. */
const TITLE_Y = 136;

export class DeathScreen {
  /** @param {HTMLElement} root the UI root (`#luminati-ui`) */
  constructor(root) {
    this.root = root;
    const el = document.createElement('div');
    el.className = 'lu-death is-gone';
    el.setAttribute('aria-hidden', 'true');
    // the world map's slot (z 7), above the HUD; the fader (z 8) covers it for the respawn
    root.appendChild(el);
    this.element = el;
    /** @type {HTMLCanvasElement|null} the vignette (repainted when the screen's art size changes) */
    this._vig = null;
    this._vigKey = '';
    /** @type {HTMLElement|null} */
    this._inner = null;
    /** @type {HTMLElement} */
    this._title = document.createElement('div');
    /** @type {HTMLElement} */
    this._sub = document.createElement('div');
    /** @type {HTMLElement} */
    this._prompt = document.createElement('div');
    /** The texts laid out now. */
    this._texts = { title: '\u0000', subtitle: '', prompt: '' };

    this._visible = false;
    this._accept = false;
    this._armedAt = 0;
    this._armTimer = 0;
    this._goneTimer = 0;
    this._resolve = null;
    this._primeRaf = 0;
    this._primed = false;
    this._disposed = false;

    this._onKey = (e) => {
      if (!this._accepting() || e.repeat || IGNORED_KEYS.has(e.code)) return;
      e.preventDefault();
      e.stopPropagation();
      this._dismiss('key');
    };
    this._onPointer = (e) => {
      if (!this._accepting()) return;
      e.preventDefault();
      e.stopPropagation();
      this._dismiss('pointer');
    };
    // the root's scale changed: the vignette and the texts again
    this._offScale = onScale(root, () => this._relayout());
  }

  /** True from show() until hide(). */
  get visible() { return this._visible; }

  /** True once `prime()` has pre-rendered the screen. */
  get primed() { return this._primed; }

  /**
   * Pre-render the hidden screen (COMBAT-02; `UI.enableCombat()` calls it once the fonts are in):
   * for 3 frames the overlay is laid out and painted at a near-zero opacity with these texts, the
   * title, divider and prompt on their own layers as during the real fade-in, then it goes back to
   * `display: none`. The first real `show()` then no longer pays for the first style resolution,
   * glyph rasterisation and the vignette's upload. Ignored while shown; `show()` during the
   * priming takes over.
   * @param {{ title?: string, subtitle?: string, prompt?: string }} [opts]
   */
  prime({ title = '', subtitle = '', prompt = '' } = {}) {
    if (this._visible || this._primeRaf || typeof requestAnimationFrame !== 'function') return;
    this._layout(String(title ?? ''), String(subtitle ?? ''), String(prompt ?? ''));
    const el = this.element;
    el.classList.remove('is-gone');
    el.classList.add('is-prime');
    let frames = 0;
    const tick = () => {
      this._primeRaf = 0;
      if (this._visible || !el.classList.contains('is-prime')) return;
      if (++frames < 3) {
        this._primeRaf = requestAnimationFrame(tick);
        return;
      }
      el.classList.remove('is-prime');
      el.classList.add('is-gone');
      this._primed = true;
    };
    this._primeRaf = requestAnimationFrame(tick);
  }

  /**
   * @param {{ title?: string, subtitle?: string, prompt?: string, armDelay?: number }} [opts]
   *   armDelay: seconds before input is accepted (1.0); the prompt appears then
   * @returns {Promise<'key'|'pointer'|undefined>} undefined when hide() / a new show() came first
   */
  show({ title = '', subtitle = '', prompt = '', armDelay = 1.0 } = {}) {
    this._settle(undefined);
    this._detach();
    clearTimeout(this._goneTimer);
    clearTimeout(this._armTimer);
    this._cancelPrime();
    const texts = [String(title ?? ''), String(subtitle ?? ''), String(prompt ?? '')];
    this._layout(texts[0], texts[1], texts[2]);
    // a translated text may need font slices (Japanese, Chinese): laid out again once they are in
    currentFonts()?.ensure(texts).then(() => this._relayout());
    const el = this.element;
    // fade in with a CSS animation (it starts from display: none without a forced layout)
    el.classList.remove('is-gone', 'is-armed', 'is-done', 'is-off');
    el.classList.add('is-on');
    el.setAttribute('aria-hidden', 'false');
    this.root.classList.add('lu-root--death');
    this._visible = true;
    const delay = Math.max(0, Number.isFinite(armDelay) ? armDelay : 1);
    this._armedAt = performance.now() + delay * 1000;
    this._armTimer = setTimeout(() => { this._armTimer = 0; el.classList.add('is-armed'); }, delay * 1000);
    this._accept = true;
    window.addEventListener('keydown', this._onKey, true);
    el.addEventListener('pointerdown', this._onPointer);
    return new Promise((resolve) => { this._resolve = resolve; });
  }

  /** Remove the screen (fades out 0.35 s; a pending show() resolves with undefined). */
  hide() {
    this._detach();
    this._settle(undefined);
    clearTimeout(this._armTimer);
    this._armTimer = 0;
    if (!this._visible) return;
    this._visible = false;
    const el = this.element;
    el.classList.remove('is-on');
    el.classList.add('is-off');
    el.setAttribute('aria-hidden', 'true');
    this.root.classList.remove('lu-root--death');
    clearTimeout(this._goneTimer);
    this._goneTimer = setTimeout(() => {
      if (!this._visible) { el.classList.remove('is-off'); el.classList.add('is-gone'); }
    }, 400);
  }

  dispose() {
    this._disposed = true;
    this._offScale?.();
    this._detach();
    this._settle(undefined);
    clearTimeout(this._armTimer);
    clearTimeout(this._goneTimer);
    this._cancelPrime();
    this.root.classList.remove('lu-root--death');
    this.element.remove();
  }

  // ------------------------------------------------------------------------------------------
  // Layout
  // ------------------------------------------------------------------------------------------

  /** Lay the screen out again with the texts it shows (the scale or the fonts changed). */
  _relayout() {
    if (this._disposed || this._texts.title === '\u0000') return;
    const { title, subtitle, prompt } = this._texts;
    this._texts.title = '\u0000';
    this._layout(title, subtitle, prompt);
  }

  /**
   * The vignette for the screen's art size (painted once per size) and the texts (laid out when
   * they change).
   * @param {string} title
   * @param {string} subtitle
   * @param {string} prompt
   */
  _layout(title, subtitle, prompt) {
    const el = this.element;
    const s = currentScale(this.root);
    // (two art px per vignette pixel: a backdrop in chunky steps, a quarter of the painting)
    const cw = Math.ceil(((s?.artW ?? 640) + 1) / 2), ch = Math.ceil(((s?.artH ?? 360) + 1) / 2);
    const vkey = `${cw}x${ch}`;
    if (vkey !== this._vigKey || !this._vig) {
      this._vigKey = vkey;
      const c = emberVignette(cw, ch);
      c.classList.add('px', 'lu-death__vignette');
      c.style.width = U(cw * 2);
      c.style.height = U(ch * 2);
      if (this._vig) this._vig.replaceWith(c);
      else el.prepend(c);
      this._vig = c;
    }
    const t = this._texts;
    if (t.title === title && t.subtitle === subtitle && t.prompt === prompt && this._inner) return;
    this._texts = { title, subtitle, prompt };
    this._inner?.remove();
    this._build(title, subtitle, prompt);
  }

  /**
   * The content group (centred): the title at twice the heading size, the divider, the subtitle,
   * the prompt between two gems.
   * @param {string} title
   * @param {string} subtitle
   * @param {string} prompt
   */
  _build(title, subtitle, prompt) {
    const k = pal();
    const up = UP(title), pup = UP(prompt);
    const tw = 2 * measure(up, 'head', 1);
    const pw = prompt ? measure(pup, 'name', 1) : 0;
    const sw = subtitle ? measure(subtitle, 'body') : 0;
    const head = FONT.head;
    const dw = Math.max(219, Math.round(tw * 0.62)) | 1;
    const W0 = Math.max(tw, dw, pw + 40, sw) + 24;
    const W = W0 + (W0 % 2);
    const top = TITLE_Y - head.mid * 2 - 6;
    const g = document.createElement('div');
    g.className = 'lu-death__inner';
    anchorGroup(g, 'mc', 320 - W / 2, top, W, 248 - top, this.root);
    this.element.append(g);
    this._inner = g;
    // the title: the heading type at twice its size, its ink centred on TITLE_Y
    const tt = txt(g, up, 320, TITLE_Y - head.mid * 2, { font: 'head', track: 1, color: k.g4, cls: 'lu-death__title' });
    if (up !== title) { tt.textContent = title; tt.classList.add('lu-caps'); }
    const s = tt.style;
    s.fontSize = `calc(var(--px) * ${head.size * 2})`;
    s.lineHeight = `calc(var(--px) * ${head.L * 2})`;
    if (!head.cjk) s.letterSpacing = U(2);
    s.textShadow = bigShadow(head.bold);
    s.left = U(320 - Math.floor(tw / 2) - (originOf(g)[0]));
    s.top = U(TITLE_Y - head.mid * 2 - originOf(g)[1]);
    this._title = tt;
    // A's divider with ruby gems
    const dy = TITLE_Y + Math.ceil(head.ink) + 6;
    put(g, divider(dw, GEMS.ruby()), 320 - (dw - 1) / 2, dy, 1, 'lu-death__divider');
    // the subtitle (often none)
    this._sub = txt(g, subtitle, 320, dy + 17, { font: 'body', color: k.tx1, align: 'center', ol: true, drop: true, cls: 'lu-death__sub' });
    // the prompt between two ember gems, in tracked capitals
    const pr = box(g, 0, 0, null, null, 'lu-death__prompt');
    const pc = 228;
    const pt = txc(pr, pup, 320, pc, { font: 'name', track: 1, color: k.tx1, align: 'center', ol: true, drop: true, cls: 'lu-death__prompt-text' });
    if (pup !== prompt) { pt.textContent = prompt; pt.classList.add('lu-caps'); }
    this._prompt = pt;
    if (prompt) {
      put(pr, gemGlyph(2, GEMS.ember()), 320 - Math.floor(pw / 2) - 14, pc - 3, 1, 'lu-death__gem');
      put(pr, gemGlyph(2, GEMS.ember()), 320 + Math.ceil(pw / 2) + 7, pc - 3, 1, 'lu-death__gem');
    }
  }

  // ------------------------------------------------------------------------------------------

  _cancelPrime() {
    if (this._primeRaf) cancelAnimationFrame(this._primeRaf);
    this._primeRaf = 0;
    this.element.classList.remove('is-prime');
  }

  _accepting() { return this._accept && performance.now() >= this._armedAt; }

  /** @param {'key'|'pointer'} source */
  _dismiss(source) {
    this._detach();
    this.element.classList.add('is-done');
    this._settle(source);
  }

  _detach() {
    this._accept = false;
    window.removeEventListener('keydown', this._onKey, true);
    this.element.removeEventListener('pointerdown', this._onPointer);
  }

  _settle(value) {
    const r = this._resolve;
    this._resolve = null;
    if (r) r(value);
  }
}

/**
 * The title's shadow at twice the heading size: an ink outline two art px wide and a drop in
 * ember; a bitmap bold (the Japanese heading's: half a DotGothic16 dot, type.js) doubled with the
 * size — still half a dot, so a dakuten's gap stays open —, its outline following.
 * @param {string|null|undefined} bold the heading role's bold offset (a CSS length), or none
 */
function bigShadow(bold) {
  const P = (n) => (n === 0 ? '0' : `calc(var(--px) * ${n})`);
  const B = bold ? `calc(${bold} * 2)` : null;
  /** n art px plus the bold's offset */
  const PB = (n) => (n === 0 ? B : `calc(var(--px) * ${n} + ${B})`);
  const offs = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, 2], [2, -2], [-2, -2]];
  const out = [];
  if (B) out.push(`${B} 0 0 currentColor`);
  for (const [dx, dy] of offs) {
    out.push(`${P(dx)} ${P(dy)} 0 var(--g-ink0)`);
    if (B) out.push(`${PB(dx)} ${P(dy)} 0 var(--g-ink0)`);
  }
  out.push(`0 ${P(4)} 0 var(--g-em1)`);
  if (B) out.push(`${B} ${P(4)} 0 var(--g-em1)`);
  return out.join(', ');
}
