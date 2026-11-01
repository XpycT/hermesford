import './ui.css';
import './hud.css';

/**
 * Full-screen colour fades for scene transitions. Promises resolve on a timer matching the
 * duration, so they settle even if `transitionend` never fires (hidden tab, display:none, …).
 * A new fade interrupts the previous one (its promise resolves immediately) and continues from
 * the current opacity — and from the current colour: a fade out to another colour while the screen
 * is (partly) covered crossfades the colour over the same time (a story's `fade out … white`
 * followed by a travel's fade to black goes from white to black, not in a cut); while it is clear
 * the new colour is taken at once. `color` is the colour of the last fade out (a travel under a
 * covered screen fades out in it: white stays white into the next level's fade in).
 */
export class Fader {
  /** @param {HTMLElement} parent */
  constructor(parent = document.body) {
    const el = document.createElement('div');
    el.className = 'lu-fader';
    // (the colour moves with the opacity: hud.css times both)
    el.style.transitionProperty = 'opacity, background-color';
    parent.appendChild(el);
    this.element = el;
    this._opacity = 0;
    /** The colour asked for last (`fadeOut`, `set`; hud.css's black before any). */
    this._color = '#000';
    this._timer = 0;
    /** @type {(() => void)|null} resolver of the running fade's promise */
    this._resolve = null;
  }

  /** Target opacity of the current / last fade (0 = clear, 1 = covered). */
  get opacity() { return this._opacity; }
  /** True while fading. */
  get busy() { return !!this._resolve; }
  /** The colour of the last fade out (or `set` with one): what covers the screen when it is covered. */
  get color() { return this._color; }

  /**
   * Fade to a solid colour.
   * @param {number} [seconds]
   * @param {string} [color] any CSS colour (a palette token as `var(--g-kf0)` too: the fader is in
   *   the UI root)
   * @returns {Promise<void>}
   */
  fadeOut(seconds = 0.6, color = '#000') {
    return this._fadeTo(1, seconds, color);
  }

  /**
   * Fade back to the scene.
   * @param {number} [seconds]
   * @returns {Promise<void>}
   */
  fadeIn(seconds = 0.6) {
    return this._fadeTo(0, seconds, null);
  }

  /**
   * Jump to an opacity instantly.
   * @param {number} opacity 0..1
   * @param {string} [color]
   */
  set(opacity, color) {
    this._settle();
    clearTimeout(this._timer);
    this._opacity = opacity;
    const el = this.element;
    el.style.transitionDuration = '0s';
    if (color) {
      el.style.backgroundColor = color;
      this._color = color;
    }
    el.style.opacity = String(opacity);
    void el.offsetWidth;
  }

  dispose() {
    clearTimeout(this._timer);
    this._settle();
    this.element.remove();
  }

  /** @param {number} target @param {number} seconds @param {string|null} color @returns {Promise<void>} */
  _fadeTo(target, seconds, color) {
    this._settle();
    clearTimeout(this._timer);
    const el = this.element;
    const s = Math.max(0, Number(seconds) || 0);
    // lock in the current (possibly mid-transition) opacity and colour before starting the new
    // transition; a colour asked for while the screen is clear is taken at once
    const cs = getComputedStyle(el);
    const current = cs.opacity;
    const bg = cs.backgroundColor;
    const clear = !(parseFloat(current) >= 0.01);
    el.style.transitionDuration = '0s';
    el.style.opacity = current;
    if (color) el.style.backgroundColor = clear ? color : bg;
    void el.offsetWidth;
    el.style.transitionDuration = `${s}s`;
    if (color && !clear) el.style.backgroundColor = color;
    el.style.opacity = String(target);
    this._opacity = target;
    if (color) this._color = color;
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._timer = setTimeout(() => this._settle(), s * 1000 + 20);
    });
  }

  _settle() {
    const r = this._resolve;
    this._resolve = null;
    if (r) r();
  }
}
