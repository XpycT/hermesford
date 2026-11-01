import './ui.css';
import './story.css';

/**
 * ScreenFlash — the story's full-screen flash (`flash [white|gold|red] [seconds] [hold]`, set-piece
 * direction: docs/specs/STORY_SCRIPT.md; docs/contracts/DRAGON_CAMPAIGN.md §5.5), and the faint
 * glare of a big effect near the camera (src/game/story/Effects.js): the screen jumps to a colour of
 * G's palette and fades back over the seconds (a quick ease-out after a short hold at the peak).
 * A **held** flash (`hold`: The Bells of Evermere's memories over white, EVERMERE_CAMPAIGN.md §2.6)
 * comes in over its seconds and stays at its peak until the next flash releases it — fading back
 * from where it stands over that flash's seconds — or `clear()` takes it off.
 * The colours are tokens of G's palette (docs/specs/PIXEL_UI.md §1.3): white `kf0` (ivory, the
 * palette's brightest), gold `kw` (the keyword gold), red `rb2` (the ruby).
 *
 * The flash covers the world and the world-anchored layers (emotes, labels) but not the cutscene's
 * letterbox bars, the HUD, the banner, the title card or the dialog: z 2, placed before the
 * letterbox (the same z: the bars, later in the DOM, paint over it). A new flash replaces the one
 * going on. It runs on CSS (the wall clock): slow motion does not stretch it.
 *
 * Story levels only: made by the story runtime with the classes of src/game/story/storyUI.js (the
 * story chunk), so a level without a story holds none of it or of story.css.
 */

/** The flash colours (StoryScript.js `FLASH_COLORS`) → G's palette tokens. */
export const FLASH_TOKENS = Object.freeze({ white: 'kf0', gold: 'kw', red: 'rb2' });

export class ScreenFlash {
  /** @param {HTMLElement} parent the UI root */
  constructor(parent) {
    const el = document.createElement('div');
    el.className = 'lu-flash';
    el.setAttribute('aria-hidden', 'true');
    // under the letterbox bars (same z, earlier in the DOM), else at the end
    const bars = parent.querySelector(':scope > .lu-letterbox');
    if (bars) parent.insertBefore(el, bars);
    else parent.appendChild(el);
    this.element = el;
    this._timer = 0;
    /** The colour of the flash on screen ('' when none). */
    this.color = '';
    /** True while a held flash (`hold`) is up: it stays until the next `flash` or `clear()`. */
    this.held = false;
  }

  /** True while a flash is on screen. */
  get active() { return this.color !== ''; }

  /**
   * Flash the screen; a held flash is released by it: it fades back from where it stands (its peak,
   * or on its way in) rather than from a new peak.
   * @param {string} [color] 'white' | 'gold' | 'red' (anything else: white)
   * @param {number} [seconds] the fade back (0.05–5; 0.35)
   * @param {number} [strength] the peak's opacity, 0–1 (1: 0.92)
   */
  flash(color = 'white', seconds = 0.35, strength = 1) {
    const s = Math.min(5, Math.max(0.05, Number.isFinite(seconds) ? seconds : 0.35));
    const name = this._paint(color, strength, this.held ? this._opacity() : -1);
    // (a flash going on starts again from its peak)
    this._start('is-on', s);
    this.held = false;
    this.color = name;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.clear(), s * 1000 + 30);
  }

  /**
   * Hold the screen in a colour: it comes in over `seconds` (0: at once; from where a flash going
   * on stands) and stays at its peak until the next `flash` releases it or `clear()` takes it off.
   * @param {string} [color] 'white' | 'gold' | 'red' (anything else: white)
   * @param {number} [seconds] the way in (0–5; 0)
   * @param {number} [strength] the peak's opacity, 0–1 (1: 0.92)
   */
  hold(color = 'white', seconds = 0, strength = 1) {
    const s = Math.min(5, Math.max(0, Number.isFinite(seconds) ? seconds : 0));
    const from = this.active ? this._opacity() : 0;
    const name = this._paint(color, strength);
    this.element.style.setProperty('--lu-flash-from', `${+from.toFixed(3)}`);
    this._start('is-held', s);
    this.held = true;
    this.color = name;
    clearTimeout(this._timer);
  }

  /** Take the flash off at once (a held one too). */
  clear() {
    clearTimeout(this._timer);
    this.element.classList.remove('is-on', 'is-held');
    this.color = '';
    this.held = false;
  }

  /**
   * Set the colour and the peak: 0.92 × the strength, or `from` (≥ 0) — where the screen stands
   * now, for a release.
   * @param {string} color @param {number} strength @param {number} [from]
   * @returns {string} the colour's name
   */
  _paint(color, strength, from = -1) {
    const name = Object.hasOwn(FLASH_TOKENS, color) ? color : 'white';
    const token = FLASH_TOKENS[/** @type {keyof typeof FLASH_TOKENS} */ (name)];
    const k = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 1));
    const el = this.element;
    el.style.setProperty('--lu-flash-color', `var(--g-${token})`);
    el.style.setProperty('--lu-flash-peak', `${+(from >= 0 ? from : 0.92 * k).toFixed(3)}`);
    return name;
  }

  /** Start an animation from its beginning. @param {'is-on'|'is-held'} cls @param {number} seconds */
  _start(cls, seconds) {
    const el = this.element;
    el.style.animationDuration = `${Math.max(0.001, seconds)}s`;
    el.classList.remove('is-on', 'is-held');
    void el.offsetWidth;
    el.classList.add(cls);
  }

  /** The flash's opacity on screen now (0–1). */
  _opacity() {
    const o = Number(getComputedStyle(this.element).opacity);
    return Number.isFinite(o) ? Math.min(1, Math.max(0, o)) : 0;
  }

  dispose() {
    this.clear();
    this.element.remove();
  }
}
