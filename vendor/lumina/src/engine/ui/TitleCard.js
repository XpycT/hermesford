import { pal } from './art/palette.js';
import { divider, fade, rgbOf } from './art/pieces.js';
import { logoFit, textLogoFit, canLogo, LOGO_FONT } from './art/logo.js';
import { UP, fit, grow, txc, lang as typeLang } from './layout/type.js';
import { group, put } from './layout/layout.js';
import { onScale, currentScale } from './UiScale.js';
import { currentFonts } from './FontLoader.js';
import './ui.css';
import './story.css';

/**
 * TitleCard — the story's cinematic title card (`title <text> [| subtitle]`, set-piece direction:
 * docs/specs/STORY_SCRIPT.md; docs/contracts/DRAGON_CAMPAIGN.md §5.5): a title in the middle of the
 * screen, drawn as the title screen draws a campaign's name (docs/specs/PIXEL_UI.md §5, the title):
 * A's gilded Roman capitals (`logoFit`: scale 3, else 2, else two lines) — in Japanese and Chinese
 * the translated title drawn from the language's logo face (`textLogoFit`) —, A's divider (a gilt
 * rule with its gems) under it, the subtitle in small gilt capitals (the name role, tracked), all on
 * a stepped radial shade of the band's navy so it reads over a bright scene. It comes in over about
 * 0.9 s — the shade, the title rising by three art px, the rule opening from its middle, the
 * subtitle — is held (`hold`, 2.8 s by default) and fades out in 0.8 s, all in hard steps.
 *
 * `show()` resolves when the card is gone. The card waits for its text's fonts first (a language's
 * glyph slices through FontLoader `ensure`, the logo face for a Japanese or Chinese title — at most
 * `FONT_WAIT` s), so its first frame shows the real glyphs. Its clock is `update(dt, input)` (the
 * story runtime ticks it in real time: a slow motion does not stretch it): a `confirm` press after
 * `GUARD` s ends the hold early (the player may skip it), `skip()` takes it off at once (a skipped
 * cutscene), `hide()` starts the fade-out. Laid out again on a scale change. z 8 right after the
 * fader: over it (a title after `fade out` reads on black, as in a film), over the dialog, under
 * the debug panel. Texts arrive translated (StoryRunner).
 *
 * Story levels only: made by the story runtime with the classes of src/game/story/storyUI.js.
 */

/** Seconds the card takes to come in (its CSS: the parts' delays and lengths). */
export const TITLE_IN = 0.9;
/** Seconds the card is held by default. */
export const TITLE_HOLD = 2.8;
/** Seconds of the fade-out (CSS `.lu-titlecard.is-out`). */
export const TITLE_OUT = 0.8;
/** The most seconds a card waits for its fonts before it shows anyway. */
export const FONT_WAIT = 2.5;
/** A press ends the card only this long after it began to come in. */
const GUARD = 0.6;
/** The widest the title and the subtitle run (art px; a narrower screen keeps 16 each side). */
const MAX_W = 560;

/** @typedef {'gone'|'wait'|'in'|'hold'|'out'} TitlePhase */

export class TitleCard {
  /** @param {HTMLElement} parent the UI root */
  constructor(parent) {
    const el = document.createElement('div');
    el.className = 'lu-titlecard is-gone';
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('aria-live', 'polite');
    // (right after the fader, at its z: over it — a title on black after a `fade out`)
    const fader = parent.querySelector(':scope > .lu-fader');
    if (fader) fader.after(el);
    else parent.appendChild(el);
    this.element = el;
    /** @type {TitlePhase} */
    this._phase = 'gone';
    this._t = 0;
    /** Seconds since the card began to come in (the guard of a press). */
    this._shown = 0;
    this._hold = TITLE_HOLD;
    this._texts = { title: '', subtitle: '' };
    this._job = 0;
    /** @type {(() => void)|null} */
    this._resolve = null;
    this._offScale = onScale(parent, () => { if (this.visible) this._layout(); });
  }

  /** What the card is doing: 'gone', 'wait' (its fonts), 'in', 'hold', 'out'. */
  get phase() { return this._phase; }
  /** True while the card is on screen (coming in, held, fading out). */
  get visible() { return this._phase === 'in' || this._phase === 'hold' || this._phase === 'out'; }
  /** True from `show()` until the card is gone. */
  get active() { return this._phase !== 'gone'; }
  /** The texts of the card shown last. */
  get texts() { return { ...this._texts }; }

  /**
   * Show a title card (a card going on is replaced: its `show()` resolves).
   * @param {string} title
   * @param {string} [subtitle]
   * @param {{ hold?: number }} [opts] hold: seconds the card is held (0.5–20; 2.8)
   * @returns {Promise<void>} resolves when it is gone (faded out, skipped or replaced)
   */
  show(title, subtitle = '', { hold = TITLE_HOLD } = {}) {
    this._gone();
    this._texts = { title: String(title ?? ''), subtitle: String(subtitle ?? '') };
    this._hold = Math.min(20, Math.max(0.5, Number.isFinite(hold) ? hold : TITLE_HOLD));
    this._phase = 'wait';
    this._t = 0;
    this._shown = 0;
    const job = ++this._job;
    const done = new Promise((resolve) => { this._resolve = () => resolve(undefined); });
    this._fonts(this._texts.title, this._texts.subtitle).then(() => {
      if (job === this._job && this._phase === 'wait') this._start();
    });
    return /** @type {Promise<void>} */ (done);
  }

  /**
   * The card's clock (real seconds): it comes in, is held, fades out; a `confirm` press after the
   * guard ends the hold. Call every frame while it is active.
   * @param {number} dt
   * @param {{ actionPressed(name: string): boolean }|null} [input]
   */
  update(dt, input = null) {
    if (this._phase === 'gone') return;
    const h = Math.max(0, Number.isFinite(dt) ? dt : 0);
    this._t += h;
    if (this._phase === 'wait') {
      if (this._t >= FONT_WAIT) this._start();
      return;
    }
    this._shown += h;
    const press = !!input && this._shown >= GUARD && this._phase !== 'out' && input.actionPressed('confirm');
    if (this._phase === 'in') {
      if (press) this.hide();
      else if (this._t >= TITLE_IN) {
        this._phase = 'hold';
        this._t = 0;
        this.element.classList.remove('is-in');
        this.element.classList.add('is-held');
      }
    } else if (this._phase === 'hold') {
      if (press || this._t >= this._hold) this.hide();
    } else if (this._phase === 'out' && this._t >= TITLE_OUT) this._gone();
  }

  /** Start the fade-out now (a card still waiting for its fonts is gone at once). */
  hide() {
    if (this._phase === 'wait') {
      this._gone();
      return;
    }
    if (this._phase !== 'in' && this._phase !== 'hold') return;
    this._phase = 'out';
    this._t = 0;
    const c = this.element.classList;
    c.remove('is-in');
    c.add('is-held', 'is-out');
  }

  /** Take the card off at once (a skipped cutscene); its `show()` resolves. */
  skip() {
    this._gone();
  }

  dispose() {
    this._offScale();
    this._gone();
    this.element.remove();
  }

  /** The fonts of the texts: the language's glyph slices, the logo face for a CJK title. Never rejects. */
  async _fonts(title, subtitle) {
    const fl = currentFonts();
    /** @type {Promise<unknown>[]} */
    const waits = [];
    if (fl) waits.push(fl.ensure(`${title}\n${subtitle}`));
    const L = typeLang();
    if (L !== 'en' && Object.hasOwn(LOGO_FONT, L) && !canLogo(title) && typeof document !== 'undefined' && document.fonts) {
      const font = LOGO_FONT[/** @type {'ja'|'zh'} */ (L)][0];
      waits.push((fl?.ready ?? Promise.resolve()).then(() => document.fonts.load(font, title)));
    } else if (fl && !canLogo(title)) waits.push(fl.ready);
    await Promise.all(waits.map((p) => p.catch(() => null)));
  }

  /** Lay the card out and bring it in. */
  _start() {
    const el = this.element;
    this._layout();
    el.classList.remove('is-gone', 'is-out', 'is-held', 'is-in');
    void el.offsetWidth; // restart the parts' animations on a reused card
    el.classList.add('is-in');
    el.setAttribute('aria-hidden', 'false');
    this._phase = 'in';
    this._t = 0;
    this._shown = 0;
  }

  /** Off the screen; the waiting `show()` resolves. */
  _gone() {
    this._job++;
    const el = this.element;
    el.classList.remove('is-in', 'is-held', 'is-out');
    el.classList.add('is-gone');
    el.setAttribute('aria-hidden', 'true');
    el.replaceChildren();
    this._phase = 'gone';
    const r = this._resolve;
    this._resolve = null;
    if (r) r();
  }

  /**
   * Build the card in G's 640 × 360 frame, centred a little above the middle (y 178): the logo
   * within 560 art px (the screen's width less 16 a side when that is less), A's divider 4 under it,
   * the subtitle 6 under the divider; the shade an ellipse 100 art px wider than the widest part
   * each side and 32 taller above and below, the navy in three hard steps.
   */
  _layout() {
    const el = this.element;
    el.replaceChildren();
    const { title, subtitle } = this._texts;
    const k = pal();
    const sc = currentScale(el);
    const artW = sc?.artW ?? 640;
    const room = Math.max(200, Math.min(MAX_W, 2 * Math.floor((artW - 32) / 2)));
    const L = typeLang();
    const roman = L === 'en' || canLogo(title) || !Object.hasOwn(LOGO_FONT, L);
    const logo = roman ? logoFit(UP(title), { maxW: room }).canvas : textLogoFit(title, L, { maxW: room }).canvas;
    logo.setAttribute('aria-hidden', 'true');
    const sub = subtitle.trim() ? fit(UP(subtitle.trim()), 'name', room, 1) : '';
    const gn = Math.ceil(grow('name'));
    const subL = 12 + gn;
    const H = logo.height + 4 + 13 + (sub ? 6 + subL : 0);
    const y0 = Math.round(178 - H / 2);
    // the shade (behind everything): an ellipse of the band's navy in three hard steps
    let sw = Math.min(2 * Math.floor(artW / 2), Math.max(logo.width, 219) + 200);
    sw += sw % 2;
    const sh = H + 64 + ((H + 64) % 2);
    const shade = fade(sw, sh, rgbOf(k.band), (u, v) => Math.max(0, 1 - Math.hypot((u - 0.5) / 0.5, (v - 0.5) / 0.5)) * 1.45 * 0.66, [0.22, 0.44, 0.66]);
    shade.setAttribute('aria-hidden', 'true');
    const gs = group(el, 'mc', 320 - sw / 2, y0 - 32, sw, sh);
    put(gs, shade, 320 - sw / 2, y0 - 32, 1, 'lu-titlecard__shade');
    // the title, the rule, the subtitle
    const g = group(el, 'mc', 320 - room / 2, y0, room, H, 'lu-titlecard__inner');
    put(g, logo, 320 - Math.floor(logo.width / 2), y0, 1, 'lu-titlecard__logo');
    const rule = divider(219);
    rule.setAttribute('aria-hidden', 'true');
    put(g, rule, 211, y0 + logo.height + 4, 1, 'lu-titlecard__rule');
    if (sub) {
      const te = txc(g, sub, 320, y0 + logo.height + 4 + 13 + 6 + subL / 2, { font: 'name', track: 1, color: k.g4, align: 'center', ol: true, drop: true, cls: 'lu-titlecard__sub' });
      te.setAttribute('aria-label', subtitle);
    }
    // the title for assistive tech (the logo is a picture)
    el.setAttribute('aria-label', sub ? `${title} — ${subtitle}` : title);
  }
}
