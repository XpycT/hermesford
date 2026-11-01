import { t, registerStrings, hasStrings } from '../i18n/I18n.js';
import STORY_UI from '../i18n/strings/story-ui.js';
import { pal, GEMS } from './art/palette.js';
import { gemGlyph, divider, fade, rgbOf } from './art/pieces.js';
import { roles, txt, txc, measure, textHtml, shadow, grow, FONT, UP, originOf, setOrigin } from './layout/type.js';
import { group, put, key, capW, U } from './layout/layout.js';
import { onScale, currentScale } from './UiScale.js';
import { fontsMissing, loadFonts, wrapLines } from './Journal.js';
import './ui.css';
import './story.css';

/**
 * EndCard — the story's end (story levels only, created by `UI.useStoryUI()`): a card faded in
 * over the scene, which goes on under it (a story's last shot keeps turning, its fireworks and
 * music go on), drawn in mockup G's family (docs/specs/PIXEL_UI.md §5: the death and end screens
 * on a stepped vignette with A's divider) — a veil of G's ink in hard steps, light in the middle
 * and darker toward the edges, a shade of ink behind the words (an ellipse in three hard steps, as
 * the title card's), the title in the heading type at twice its size (once when that would not
 * fit; wrapped when even that does not), A's divider, the subtitle in small gilt capitals, an
 * optional text in the body type and, once the guard has passed, the prompt between two gems,
 * blinking in steps (its key drawn as a keycap: 'story-ui' `end.prompt`, "Press {key} to
 * continue"). While it is up the HUD, its toasts, the prompt, combat labels, bubbles and banners
 * step aside (the root's `lu-root--endcard`, story.css).
 *
 * `show()` resolves when the player dismisses it — `confirm` or `cancel` read in
 * `update(dt, input)` (actions, like DialogBox), or a click on the card — no sooner than `guard`
 * seconds (2) after it was shown; the card then fades out (1 s) by itself. z 7 (the world map's
 * slot, under the fader: a game can fade to black over the fading card). All text is set as
 * escaped text; it arrives translated (StoryRunner). Laid out again on a scale change and when a
 * language's font slices arrive; on a screen under 640 art px wide the content is reflowed to it
 * (16 art px each side, the lines wrap sooner) rather than scaled. Lines are broken by Journal.js
 * `wrapLines` (CJK: Latin runs and Japanese words kept whole) and centred one by one on whole
 * pixels.
 */

/**
 * The veil over the scene: G's ink, a fifth in the middle, up to 0.62 toward the edges and
 * corners, in hard steps; one canvas pixel per two art pixels (a smooth backdrop: no art at that
 * grain).
 */
let VIG = /** @type {{ id: string, c: HTMLCanvasElement }|null} */ (null);
/** @param {number} w @param {number} h canvas pixels */
function vignette(w, h) {
  const id = `${w}x${h}`;
  if (!VIG || VIG.id !== id) {
    const k = pal();
    const c = fade(w, h, rgbOf(k.ink0), (u, v) => {
      const d = Math.hypot((u - 0.5) / 0.62, (v - 0.46) / 0.6);
      return VEIL[0] + (VEIL[1] - VEIL[0]) * Math.min(1, Math.max(0, (d - 0.35) / 0.65));
    }, [0.2, 0.32, 0.44, 0.54, 0.62]);
    VIG = { id, c };
  }
  const copy = document.createElement('canvas');
  copy.width = VIG.c.width; copy.height = VIG.c.height;
  copy.getContext('2d').drawImage(VIG.c, 0, 0);
  return copy;
}

/**
 * A layer inside `parent` (absolute at its top left, no size) whose children are placed in the
 * same frame coordinates as the parent's.
 * @param {Element} parent @param {string} cls
 */
function layer(parent, cls) {
  const d = document.createElement('div');
  d.className = `g ${cls}`;
  d.style.left = '0';
  d.style.top = '0';
  setOrigin(d, originOf(parent));
  parent.append(d);
  return d;
}

/** The veil's alpha in the middle and at the edges (`vignette`). */
const VEIL = [0.2, 0.62];
/** The title's size: twice the heading type (whole font pixels). */
const BIG = 2;
/**
 * The widest the content runs (art px) — the titles and the text — and the content group's width,
 * on G's 640 art px; a narrower screen (1024 × 768: 512) keeps 16 art px each side instead (the
 * lines wrap sooner, nothing is scaled).
 */
const MAX_W = 560, TEXT_W = 400, GROUP_W = 600;

export class EndCard {
  /** @param {HTMLElement} parent the UI root */
  constructor(parent) {
    if (!hasStrings('story-ui')) registerStrings('story-ui', STORY_UI);
    /** @type {((name: 'confirm') => void) | null} sound hook (AudioSystem.playSfx names) */
    this.onSound = null;
    /** Seconds of the fade-out after the dismissal (CSS `.lu-endcard.is-off`). */
    this.outSeconds = 1.0;

    const el = document.createElement('div');
    el.className = 'lu-endcard is-gone';
    el.setAttribute('aria-hidden', 'true');
    parent.appendChild(el);
    this.element = el;
    /** @type {HTMLCanvasElement|null} */
    this._vig = null;
    this._vigId = '';
    /** @type {HTMLElement|null} the content (a group, laid out per show and scale) */
    this._inner = null;
    /** @type {HTMLElement|null} the shade behind the content (a group, laid out with it) */
    this._shade = null;
    this._root = parent;
    /** @type {{ title: string, subtitle: string, text: string, prompt: string|null }} */
    this._opts = { title: '', subtitle: '', text: '', prompt: null };
    this._fontJob = 0;

    this._visible = false;
    this._active = false;
    this._guard = 0;
    this._clickQueued = false;
    this._goneTimer = 0;
    /** @type {(() => void) | null} */
    this._resolve = null;
    this._onPointer = (e) => {
      if (!this._active) return;
      e.preventDefault();
      this._clickQueued = true;
    };
    el.addEventListener('pointerdown', this._onPointer);
    this._offScale = onScale(parent, () => { if (this._visible) this._layout(); });
  }

  /** True from show() until the fade-out has ended. */
  get visible() { return this._visible; }
  /** True from show() until it is dismissed or hidden (it takes input meanwhile). */
  get active() { return this._active; }

  /**
   * Show the end card (fades in over ~1.6 s).
   * @param {{ title?: string, subtitle?: string, text?: string, prompt?: string, guard?: number }} [opts]
   *   text: paragraphs split at line breaks; prompt: shown once input is accepted (default 'story-ui'
   *   `end.prompt`, "Press {key} to continue", with Space as a keycap; a string given is shown as
   *   it is, `{key}` in it drawn as Space's keycap); guard: seconds before input is accepted (2)
   * @returns {Promise<void>} resolves when the player dismisses it (or on hide() / a new show())
   */
  show({ title = '', subtitle = '', text = '', prompt = undefined, guard = 2 } = {}) {
    this._settle();
    clearTimeout(this._goneTimer);
    this._opts = {
      title: String(title ?? ''), subtitle: String(subtitle ?? ''), text: String(text ?? ''),
      prompt: prompt === undefined ? null : String(prompt ?? ''),
    };
    const el = this.element;
    el.classList.remove('is-gone', 'is-off', 'is-armed');
    this._layout();
    // restart the fade-in animations on a reused card
    el.classList.remove('is-on');
    void el.offsetWidth;
    el.classList.add('is-on');
    el.setAttribute('aria-hidden', 'false');
    this._root.classList.add('lu-root--endcard');
    this._visible = true;
    this._active = true;
    this._guard = Math.max(0, Number.isFinite(guard) ? guard : 2);
    this._clickQueued = false;
    const all = `${this._opts.title}${this._opts.subtitle}${this._opts.text}${this._promptText()}`;
    if (fontsMissing(all)) {
      const job = ++this._fontJob;
      loadFonts(all).then(() => { if (job === this._fontJob && this._visible) this._layout(); });
    }
    return new Promise((resolve) => { this._resolve = resolve; });
  }

  /**
   * Read the input. Call once per frame while shown (`UI.update` does).
   * @param {number} dt seconds
   * @param {{ actionPressed(name: string): boolean, consumeAction?(name: string): boolean }} [input]
   * @returns {boolean} true when the card was dismissed this update
   */
  update(dt, input) {
    if (!this._active) return false;
    const pressed = (name) => !!input && (typeof input.consumeAction === 'function' ? input.consumeAction(name) : input.actionPressed(name));
    // read (and swallow) the actions even during the guard, so a held key does not leak to the game
    const go = pressed('confirm') || pressed('cancel') || this._clickQueued;
    this._clickQueued = false;
    if (this._guard > 0) {
      this._guard -= Math.max(0, dt || 0);
      if (this._guard <= 0) this.element.classList.add('is-armed');
      return false;
    }
    if (!go) return false;
    if (this.onSound) this.onSound('confirm');
    this.hide();
    return true;
  }

  /** Fade the card out (1 s); a pending show() resolves. */
  hide() {
    this._active = false;
    this._settle();
    if (!this._visible) return;
    const el = this.element;
    el.classList.remove('is-on');
    el.classList.add('is-off');
    el.setAttribute('aria-hidden', 'true');
    clearTimeout(this._goneTimer);
    this._goneTimer = setTimeout(() => {
      this._visible = false;
      el.classList.remove('is-off', 'is-armed');
      el.classList.add('is-gone');
      this._root.classList.remove('lu-root--endcard');
    }, this.outSeconds * 1000);
  }

  dispose() {
    clearTimeout(this._goneTimer);
    this._offScale();
    this._fontJob++;
    this._active = false;
    this._settle();
    this.element.removeEventListener('pointerdown', this._onPointer);
    this.element.remove();
    this._root.classList.remove('lu-root--endcard');
  }

  _settle() {
    const r = this._resolve;
    this._resolve = null;
    if (r) r();
  }

  /** The prompt's text: the caller's, else the default template ('' for none). */
  _promptText() {
    return this._opts.prompt ?? t('story-ui.end.prompt');
  }

  /** Paint the veil for the screen and lay the content out (centred) on its shade. */
  _layout() {
    const el = this.element;
    const k = pal();
    const sc = currentScale(el);
    const px = sc?.px ?? 2;
    const aw = Math.ceil((sc?.W ?? 1280) / px), ah = Math.ceil((sc?.H ?? 720) / px);
    const vid = `${aw}x${ah}`;
    if (!this._vig || this._vigId !== vid) {
      this._vig?.remove();
      const c = vignette(Math.ceil(aw / 2), Math.ceil(ah / 2));
      c.className = 'lu-endcard__vignette';
      c.setAttribute('aria-hidden', 'true');
      c.style.width = U(Math.ceil(aw / 2) * 2);
      c.style.height = U(Math.ceil(ah / 2) * 2);
      el.prepend(c);
      this._vig = c;
      this._vigId = vid;
    }
    this._inner?.remove();
    this._shade?.remove();
    const { title, subtitle, text } = this._opts;
    const prompt = this._promptText();
    const paras = text.split(/\n+/).filter((p) => p.trim());

    // the widths: G's, or what a narrower screen leaves (16 art px each side)
    const gw = Math.min(GROUP_W, Math.max(240, (sc?.artW ?? 640) - 32));
    const maxW = Math.min(MAX_W, gw - 8), textW = Math.min(TEXT_W, gw - 16);
    // the heights first (the group is placed round them)
    const T = roles().head;
    const titleUp = UP(title);
    const tw1 = title ? measure(titleUp, 'head', 1) : 0;
    const big = tw1 * BIG <= maxW;
    const tLines = !title ? [] : big ? [titleUp] : wrapLines(titleUp, 'head', maxW, 1);
    const tL = T.L * (big ? BIG : 1);
    const titleH = tLines.length * tL;
    const subLines = subtitle ? wrapLines(UP(subtitle), 'name', maxW, 1) : [];
    const gn = Math.ceil(grow('name'));
    const subL = 12 + gn;
    const subH = subLines.length * subL;
    const bodyL = FONT.body.L;
    const pLines = paras.map((p) => wrapLines(p, 'body', textW));
    const textH = pLines.reduce((a, ls) => a + ls.length * bodyL + 5, paras.length ? -5 : 0);
    const promptH = prompt ? 11 : 0;
    const gaps = { div: title ? 5 : 0, sub: subtitle ? 6 : 0, text: paras.length ? 14 : 0, prompt: prompt ? 26 : 0 };
    const H = Math.ceil(titleH + gaps.div + 13 + gaps.sub + subH + gaps.text + textH + gaps.prompt + promptH);
    const y0 = Math.round(176 - H / 2);
    const gx = 320 - gw / 2;
    // the shade (behind the words): an ellipse of G's ink in three hard steps (it only darkens, a
    // night scene too), 100 art px wider than the widest line each side and 40 taller above and
    // below
    const wide = Math.max(219, title ? (big ? tw1 * BIG : maxW) : 0, subLines.length ? maxW * 0.7 : 0, paras.length ? textW : 0);
    let sw = Math.min(2 * Math.floor((sc?.artW ?? 640) / 2), Math.ceil(wide) + 200);
    sw += sw % 2;
    const sh = H + 80 + ((H + 80) % 2);
    const shade = fade(sw, sh, rgbOf(k.ink0), (u, v) => Math.max(0, 1 - Math.hypot((u - 0.5) / 0.5, (v - 0.5) / 0.5)) * 1.45 * 0.6, [0.22, 0.42, 0.6]);
    shade.setAttribute('aria-hidden', 'true');
    const gs = group(el, 'mc', 320 - sw / 2, y0 - 40, sw, sh, 'lu-endcard__shade');
    put(gs, shade, 320 - sw / 2, y0 - 40, 1);
    this._shade = gs;
    const g = group(el, 'mc', gx, y0, gw, Math.max(2, H), 'lu-endcard__inner');
    this._inner = g;
    let y = y0;

    // the title: the heading type at twice its size (a CJK heading keeps its bitmap bold, doubled)
    if (title) {
      if (big) {
        const d = document.createElement('div');
        d.className = `g tx fx-${T.fx}${T.cjk ? ' cjk' : ''} lu-endcard__title`;
        d.innerHTML = textHtml(titleUp, 'head');
        const st = d.style;
        st.fontFamily = T.family;
        st.fontWeight = String(T.w);
        st.fontSize = U(T.em * BIG);
        st.lineHeight = U(T.L * BIG);
        if (!T.cjk) st.letterSpacing = U(BIG);
        st.color = k.g5;
        st.textShadow = shadow({ ol: true, drop: true }, { ...T, bold: T.bold ? U(BIG) : undefined });
        const w = tw1 * BIG;
        st.left = U(320 - Math.floor(w / 2) - gx);
        st.top = U(0);
        g.append(d);
      } else {
        const box = layer(g, 'lu-endcard__title');
        tLines.forEach((ln, i) => txt(box, ln, 320, y + i * tL, { font: 'head', track: 1, color: k.g5, ol: true, drop: true, align: 'center' }));
      }
      y += titleH + gaps.div;
    }
    // A's divider (sapphires), the subtitle in small gilt capitals
    put(g, divider(219), 211, Math.round(y), 1, 'lu-endcard__divider');
    y += 13 + gaps.sub;
    if (subLines.length) {
      const box = layer(g, 'lu-endcard__sub');
      subLines.forEach((ln, i) => txc(box, ln, 320, y + i * subL + 6 + gn / 2, { font: 'name', track: 1, color: k.g4, align: 'center', ol: true }));
      y += subH;
    }
    // the text: paragraphs in the body type, centred
    if (paras.length) {
      y += gaps.text;
      const box = layer(g, 'lu-endcard__text');
      pLines.forEach((ls) => {
        for (const ln of ls) {
          txt(box, ln, 320, y, { font: 'body', color: k.tx2, drop: true, align: 'center', cls: 'lu-endcard__para' });
          y += bodyL;
        }
        y += 5;
      });
      y -= 5;
    }
    // the prompt: ◆ PRESS [Space] TO CONTINUE ◆, blinking in steps once armed
    if (prompt) {
      y += gaps.prompt;
      const pr = layer(g, 'lu-endcard__prompt');
      const [before, after] = prompt.includes('{key}') ? prompt.split('{key}', 2).map((s) => s.trim()) : [prompt.trim(), null];
      const KEY = 'Space';
      const parts = [UP(before), after === null ? null : KEY, after === null ? '' : UP(after)];
      const pw = (s) => (s ? measure(s, 'name', 1) : 0);
      const kw = after === null ? 0 : capW(KEY);
      const inner = pw(parts[0]) + (parts[0] && kw ? 4 : 0) + kw + (parts[2] && kw ? 4 : 0) + pw(parts[2]);
      const total = 7 + 8 + inner + 8 + 7;
      let x = 320 - Math.floor(total / 2);
      const cy = y + 5.5;
      put(pr, gemGlyph(2, GEMS.gold()), x, Math.round(cy - 3.5), 1, 'lu-endcard__gem');
      x += 7 + 8;
      const blink = layer(pr, 'lu-endcard__blink');
      if (parts[0]) {
        txc(blink, parts[0], x, cy, { font: 'name', track: 1, color: k.tx1, ol: true, cls: 'lu-endcard__prompt-text' });
        x += pw(parts[0]) + (kw ? 4 : 0);
      }
      if (kw) {
        key(blink, KEY, x, y);
        x += kw + (parts[2] ? 4 : 0);
      }
      if (parts[2]) {
        txc(blink, parts[2], x, cy, { font: 'name', track: 1, color: k.tx1, ol: true, cls: 'lu-endcard__prompt-text' });
        x += pw(parts[2]);
      }
      put(pr, gemGlyph(2, GEMS.gold()), x + 8, Math.round(cy - 3.5), 1, 'lu-endcard__gem');
    }
  }
}
