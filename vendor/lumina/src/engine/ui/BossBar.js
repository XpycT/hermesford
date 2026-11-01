import './ui.css';
import './combat.css';
import { pal, GEMS } from './art/palette.js';
import { fade, rgbOf, gemGlyph } from './art/pieces.js';
import { bossBarLayers } from './art/combat.js';
import { inkH, grow, measure, fit, txc, UP, NAME } from './layout/type.js';
import { put, win } from './layout/layout.js';
import { anchorGroup, box } from './CombatHUD.js';
import { onScale, currentScale } from './UiScale.js';
import { currentFonts } from './FontLoader.js';

/**
 * BossBar — the boss health bar at the bottom centre of the HUD (`.lu-bossbar`, COMBAT.md
 * §13.1–§13.2), drawn after mockup G's `bossPanel` (docs/specs/PIXEL_UI.md §5): no panel, a
 * stepped radial shade; the name in tracked capitals on a ruby-cornered cartouche, the epithet on
 * its baseline (cut to fit before the phase gems), the phase gems (ember for the phases reached,
 * the current one breathing in hard steps, a dark socket for the rest) and A's 11-art-px bar
 * between today's double gold rule, ruby gems at both ends and ticks at the phase boundaries. The
 * fill and the pale chip band are DOM `scaleX` layers over the painted rims, in whole art pixels:
 * the chip trails the fill (0.7 s after 0.45 s) and a hit flashes. Created by `UI.enableCombat()`
 * on combat levels only; hidden with the HUD (title, photo) and while a dialog is open. `set()` is
 * cheap to call every frame (writes on change, never reads layout). Names come in translated (a
 * long one is cut to keep room for the epithet and the gems).
 *
 * On a screen narrower than G's frame the bar narrows (from G's 334 art px, centred) to stay clear
 * of the skill bar in the bottom-right corner.
 *
 * While it is up the UI root carries `lu-root--boss` (from `show()` until the fade-out of `hide()`
 * has ended; at once on `dispose()`): the controls legend steps aside (combat.css), as G's combat
 * screen has none and it ran under the cartouche and the bar.
 */

/** G's layout (art px of the 640 × 360 frame): the bar's left, width and top. */
const X0_G = 154;
const W_G = 334;
const BY = 340;
/**
 * The skill bar's reach from the screen's right edge (CombatHUD: G's slots from x 518, their names
 * a little wider) and the gap the bar keeps from it: on a screen narrower than G's frame
 * (1024 × 768: 512 art px) the bar, centred, ran under the first slot; it narrows instead, to
 * W_MIN at least.
 */
const SKILLS_REACH = 640 - 514;
const SKILLS_GAP = 4;
const W_MIN = 220;
/** Art px a boss name leaves at least for the epithet and the phase gems (a longer name is cut). */
const NAME_ROOM = 60;
/** The bar's fade-out (combat.css `.lu-bossbar`: opacity 0.5 s, translate 0.6 s), in ms. */
const FADE_MS = 600;
/** The root class while the bar is up (combat.css hides the controls legend under it). */
const ROOT_CLASS = 'lu-root--boss';

export class BossBar {
  /** @param {HTMLElement} hudElement the HUD root (`.lu-hud`) */
  constructor(hudElement) {
    this.parent = hudElement;
    const el = document.createElement('div');
    el.className = 'lu-bossbar';
    el.setAttribute('aria-hidden', 'true');
    hudElement.appendChild(el);
    this.element = el;
    /** @type {Element|null} the UI root (its `lu-root--boss` class while the bar is up) */
    this._root = hudElement.closest('.lu-root') ?? hudElement.parentElement;
    this._rootT = 0;
    /** @type {{ name: string, epithet: string, phases: number }} */
    this._opts = { name: '', epithet: '', phases: 1 };
    this._q = -1;
    this._phase = -1;
    this._frac = 1;
    this._visible = false;
    this._flip = false;
    this._snapPending = false;
    this._disposed = false;
    /** @type {HTMLElement[]} */
    this._gems = [];
    this._build();
    this._offScale = onScale(hudElement, () => this._rebuild());
    currentFonts()?.ready.then(() => this._rebuild());
  }

  /** True between show() and hide(). */
  get visible() { return this._visible; }

  /**
   * Show the bar at full HP, phase 1.
   * @param {{ name?: string, epithet?: string, phases?: number }} [opts] phases: number of phase
   *   gems (1 = none); name defaults to ''
   */
  show({ name = '', epithet = '', phases = 1 } = {}) {
    this._opts = { name: String(name ?? ''), epithet: String(epithet ?? ''), phases: Math.max(1, phases | 0) };
    this._build();
    // a translated name may need font slices (Japanese, Chinese): laid out again once they are in
    const o = this._opts;
    currentFonts()?.ensure([o.name, o.epithet]).then(() => { if (this._opts === o) this._rebuild(); });
    // snap both fills to full (no drain from a previous fight)
    this._lag.classList.add('is-snap');
    this._q = -1;
    this._phase = -1;
    this.set(1, 1);
    this._snapPending = true;
    clearTimeout(this._rootT);
    this._rootT = 0;
    this._root?.classList.add(ROOT_CLASS);
    if (!this._visible) {
      this._visible = true;
      this.element.classList.add('is-on');
    }
  }

  /**
   * Every frame; writes on change.
   * @param {number} hpFrac 0..1
   * @param {number} [phase] current phase (1-based): gems up to it are lit, the current one breathes
   */
  set(hpFrac, phase = 1) {
    if (this._snapPending) {
      this._snapPending = false;
      this._lag.classList.remove('is-snap');
    }
    const f = hpFrac > 0 ? (hpFrac < 1 ? hpFrac : 1) : 0;
    this._frac = f;
    // whole art pixels of the fill
    const q = Math.round(f * this._iw);
    if (q !== this._q) {
      const hit = this._q >= 0 && q < this._q;
      this._q = q;
      const t = `scaleX(${q / this._iw})`;
      this._fill.style.transform = t;
      this._lag.style.transform = t;
      const on = q > 1;
      this._cap.style.visibility = on ? '' : 'hidden';
      if (on) this._cap.style.transform = `translateX(calc(var(--px) * ${q - 1}))`;
      if (hit) {
        this._flip = !this._flip;
        this._track.classList.toggle('is-hit-a', this._flip);
        this._track.classList.toggle('is-hit-b', !this._flip);
      }
    }
    const p = phase | 0;
    if (p !== this._phase) {
      this._phase = p;
      for (let i = 0; i < this._gems.length; i++) {
        this._gems[i].classList.toggle('is-lit', i < p);
        this._gems[i].classList.toggle('is-current', i === p - 1);
      }
    }
  }

  /** Fade the bar out (the legend comes back once it has faded). */
  hide() {
    if (!this._visible) return;
    this._visible = false;
    this.element.classList.remove('is-on');
    clearTimeout(this._rootT);
    this._rootT = setTimeout(() => {
      this._rootT = 0;
      if (!this._visible) this._root?.classList.remove(ROOT_CLASS);
    }, FADE_MS);
  }

  dispose() {
    this._disposed = true;
    this._offScale?.();
    clearTimeout(this._rootT);
    this._rootT = 0;
    this._root?.classList.remove(ROOT_CLASS);
    this.element.remove();
  }

  // ------------------------------------------------------------------------------------------

  /** Lay the bar out again for the root's scale or the fonts, keeping its state. */
  _rebuild() {
    if (this._disposed) return;
    const phase = this._phase, f = this._frac;
    this._build();
    this._lag.classList.add('is-snap');
    this._q = -1;
    this._phase = -1;
    this.set(f, phase < 1 ? 1 : phase);
    this._lag.classList.remove('is-snap');
  }

  /**
   * The bar's width for the root's screen (art px, even): G's 334, or what keeps it SKILLS_GAP
   * clear of the skill bar (which hangs from the bottom-right corner, shrunk with the corners).
   */
  _width() {
    const s = currentScale(this.element);
    if (!s) return W_G;
    // (the bar stands 1 art px right of the middle, as in G)
    const room = s.artW / 2 - 1 - SKILLS_REACH * (s.cornerShrink ?? 1) - SKILLS_GAP;
    return Math.max(W_MIN, Math.min(W_G, 2 * Math.floor(room)));
  }

  /** G's `bossPanel`, sized from the measured name (a longer or CJK name grows the cartouche). */
  _build() {
    const k = pal();
    const el = this.element;
    el.textContent = '';
    const { name, epithet, phases } = this._opts;
    // (G's bar stands at x 154 — its middle 321 — and its shade at 130: narrowed about the same middle)
    const W = this._width(), X0 = X0_G + (W_G - W) / 2;
    // the name in tracked capitals, cut so that the epithet and the gems keep NAME_ROOM art px
    const up = name ? fit(UP(name), 'name', W - 2 - 9 - 9 - NAME_ROOM, 1) : '';
    const nw = measure(up, 'name', 1);
    // the cartouche: 16 art px round English capitals, taller round a CJK name (rising off the bar)
    const ph = 16 + 2 * Math.ceil(grow('name') / 2);
    const pw = 9 + nw + 9, py0 = 336 - ph, nc = py0 + ph / 2 + 0.25;
    // the group is the cartouche and the bar (the world labels keep out of this box); the shade
    // reaches past it
    const top = py0 - 1;
    anchorGroup(el, 'bc', X0, top, W, BY + 11 - top);
    put(el, fade(W + 46, 52, rgbOf(k.band), (u, v) => Math.max(0, 1 - Math.hypot((u - 0.5) / 0.5, (v - 0.62) / 0.62)) * 1.3 * 0.74, [0.25, 0.5, 0.74]), X0 - 24, 306, 1, 'lu-bossbar__shade');
    const head = box(el, X0, py0, null, null, 'lu-bossbar__head');
    if (name) {
      win(head, { size: 'S', notch: 3, corners: GEMS.ruby(), cornerR: 1, bands: [k.plate0, k.plate1], stops: [0, 0.5], sheen: false }, X0 + 2, py0, pw, ph);
      txc(head, up, X0 + 2 + 9, nc, { ...NAME, color: k.g4, drop: true, cls: 'lu-bossbar__name' });
    }
    // the epithet on the name's baseline, cut to end 6 art px before the first phase gem
    const ex = name ? X0 + 2 + pw + 7 : X0 + 4;
    const pipsX = X0 + W - 13 - (phases - 1) * 9;
    if (epithet) {
      txc(head, fit(epithet, 'line', Math.max(0, pipsX - 6 - ex)), ex, nc + inkH('name') / 2 - inkH('line') / 2, { font: 'line', color: k.tx2, ol: true, cls: 'lu-bossbar__epithet' });
    }
    // the phases: lit gems for the phases reached (the current one breathes), dark sockets after
    const gems = box(head, X0, py0, null, null, 'lu-bossbar__gems');
    this._gems = [];
    if (phases > 1) {
      for (let i = 1; i <= phases; i++) {
        const gx = X0 + W - 6 - (phases - i) * 9 - 7, gy = py0 + ph / 2 - 4;
        const g = box(gems, gx, gy, 7, 7, 'lu-bossbar__gem');
        put(g, gemGlyph(2, [k.sock0, k.sock1, k.sock2], { setting: [k.dm1, k.dm2, k.dm3] }), gx, gy, 1, 'lu-bossbar__gem-off');
        put(g, gemGlyph(2, GEMS.ember()), gx, gy, 1, 'lu-bossbar__gem-on');
        put(g, gemGlyph(2, [k.em2, k.em3, k.tx1], { setting: [k.g5, k.g5, k.g4] }), gx, gy, 1, 'lu-bossbar__gem-glow');
        this._gems.push(g);
      }
    }
    // A's bar: the rims painted, the chip and the fill as DOM layers, the ticks over them
    const L = bossBarLayers(W, phases);
    this._iw = L.iw;
    const frame = box(el, X0, BY, W, 11, 'lu-bossbar__frame');
    const track = box(frame, X0, BY, W, 11, 'lu-bossbar__track');
    put(track, L.base, X0, BY);
    this._lag = put(track, L.chip, X0 + 9, BY + 3, 1, 'lu-bossbar__lag');
    this._fill = put(track, L.fill, X0 + 9, BY + 3, 1, 'lu-bossbar__fill');
    this._cap = put(track, L.cap, X0 + 9, BY + 3, 1, 'lu-bossbar__cap');
    put(track, L.hit, X0 + 9, BY + 3, 1, 'lu-bossbar__hit');
    put(track, L.ticks, X0, BY, 1, 'lu-bossbar__ticks');
    this._track = track;
  }
}
