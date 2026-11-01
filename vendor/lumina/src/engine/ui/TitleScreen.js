import { RNG } from '../utils/math.js';
import { t, getLang } from '../i18n/I18n.js';
import { pal, GEMS } from './art/palette.js';
import { art, copyCanvas } from './art/painter.js';
import { glyph, dimGlyph, gemGlyph, plate, star, divider } from './art/pieces.js';
import { logo, logoFit, canLogo, textLogoFit, LOGO_FONT } from './art/logo.js';
import { group, put, place, key, capW, keyHints, setGroupFit } from './layout/layout.js';
import { txt, txc, measure, fit, grow, UP, FONT, lang as typeLang, typePx, originOf, setOrigin } from './layout/type.js';
import { onScale, currentScale, fpxFor } from './UiScale.js';
import { currentFonts } from './FontLoader.js';
import './ui.css';
import './title.css';

/**
 * The title card over the live 3D scene, after mockup G (docs/specs/PIXEL_UI.md §5, Title and
 * loading screen): today's smooth vignette, pixel embers rising in whole art pixels, the compass
 * star, the title as A's gilded Roman capitals (`logoFit`: scale 3, else 2, else two lines) — in
 * Japanese and Chinese the translated name drawn from the language's face (`textLogoFit`) with the
 * English name as a small wordmark under it —, the divider, the tagline, and under it one of:
 * - "Press any key" blinking in steps between two gems (no destinations);
 * - the level chooser: the prompt, a plate with ◀ ▶ (ArrowLeft / ArrowRight, the glyphs) and its
 *   key hint (`destinations`);
 * - a vertical menu (`menu: true`): the selected entry on a plate fading at both ends with a
 *   nudging cursor gem, each entry's detail line under it, the key hints (↑ ↓ Choose · Space Start).
 * The footer runs in capitals along the bottom; with `onLanguage` a language row (EN · 日本語 · 中文
 * as small plates, the current one lit) sits in the bottom-right corner: L gives it the focus on the
 * current language (pressed again, moves it on), ← → choose, Enter switches (the caller saves the
 * choice and reloads), Esc goes back; a click on a plate switches at once.
 *
 * Everything is placed in art pixels of G's 640 × 360 frame (layout/layout.js `group`), drawn on
 * canvases (src/engine/ui/art/) or set in the type roles (layout/type.js), and laid out again when
 * the scale's px or the screen's width changes and once the fonts for the texts are in (FontLoader
 * `ensure`; the CJK logo once `document.fonts.load` has its characters). On a screen narrower than
 * G's frame (1024 × 768: 512 art px) the logo and the tagline fit its room instead of the whole
 * title being scaled down; the centred groups are scaled only when the art itself does not fit
 * (`_fitGroups`). Dismissed by any key or a click / tap; a menu takes only its own keys.
 */

/** Deterministic rising embers: CSS animations stepped in whole art pixels (compositor-only). */
function motesHtml(count = 22, seed = 2024) {
  const rng = new RNG(seed);
  let html = '';
  for (let i = 0; i < count; i++) {
    const k = rng.range(0, 1) < 0.3 ? 2 : 1;
    const x = rng.range(4, 96).toFixed(1);
    const dur = rng.range(11, 22).toFixed(1);
    const delay = (-rng.range(0, 22)).toFixed(1);
    const sway = Math.round(rng.range(-20, 20));
    const alpha = rng.range(0.45, 0.95).toFixed(2);
    html += `<span class="lu-mote" style="--x:${x}%;--k:${k};--d:${dur}s;--dl:${delay}s;--sw:${sway};--n:${Math.max(1, Math.abs(sway))};--a:${alpha}"><i></i></span>`;
  }
  return html;
}

const IGNORED_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight', 'F5', 'F11', 'F12', 'CapsLock', 'Tab']);

/** Keys that travel to a changed destination (the confirm keys). */
const CONFIRM_KEYS = new Set(['Enter', 'NumpadEnter', 'Space']);
/** Keys that leave the language row without switching. */
const BACK_KEYS = new Set(['Escape', 'Backspace']);
/** The key that moves the language row's focus. */
const LANG_KEY = 'KeyL';

/** The language row's default entries (show()'s `languages`): the codes and their own names. */
export const TITLE_LANGUAGES = Object.freeze([
  Object.freeze({ code: 'en', label: 'EN' }),
  Object.freeze({ code: 'ja', label: '日本語' }),
  Object.freeze({ code: 'zh', label: '中文' }),
]);

/**
 * The language names in their own scripts as 12-dot bitmaps ('#' ink; the capitals on the CJK
 * glyphs' baseline, 9 dots tall), drawn in whole device pixels at the line role's size (`langDot`):
 * the same on every page, whatever CJK face the page has loaded (an English page loads none). A
 * label with another character is set as text instead.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const LANG_GLYPHS = Object.freeze({
  E: ['......', '......', '......', '######', '#.....', '#.....', '#.....', '#####.', '#.....', '#.....', '#.....', '######'],
  N: ['.......', '.......', '.......', '#.....#', '##....#', '#.#...#', '#.#...#', '#..#..#', '#...#.#', '#...#.#', '#....##', '#.....#'],
  日: ['#########', '#.......#', '#.......#', '#.......#', '#.......#', '#########', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '#########'],
  本: ['......#......', '......#......', '#############', '.....###.....', '....#.#.#....', '...#..#..#...', '..#...#...#..', '.#....#....#.', '#...#####...#', '......#......', '......#......', '......#......'],
  語: ['..#...#######', '#####...#....', '........#....', '.###...#####.', '...........#.', '.###..#######', '.............', '#####..#####.', '#...#..#...#.', '#...#..#...#.', '#...#..#...#.', '#####..#####.'],
  中: ['.....#.....', '.....#.....', '###########', '#....#....#', '#....#....#', '#....#....#', '###########', '.....#.....', '.....#.....', '.....#.....', '.....#.....', '.....#.....'],
  文: ['......#......', '......#......', '#############', '..#.......#..', '...#.....#...', '....#...#....', '.....#.#.....', '......#......', '.....#.#.....', '....#...#....', '..##.....##..', '##.........##'],
});

/**
 * A language label drawn from LANG_GLYPHS in `col` with a one-dot ink outline (one canvas pixel per
 * font pixel), or null when a character has no bitmap.
 * @param {string} label
 * @param {string} col
 * @returns {HTMLCanvasElement|null}
 */
function langGlyphs(label, col) {
  const chars = [...label];
  if (!chars.length || !chars.every((c) => Object.prototype.hasOwnProperty.call(LANG_GLYPHS, c))) return null;
  const rows = chars.map((c) => LANG_GLYPHS[c]);
  // two dots between CJK glyphs, one between capitals
  const latin = chars.map((c) => /[A-Z]/.test(c));
  const gapAt = (/** @type {number} */ i) => (latin[i] && latin[i + 1] ? 1 : 2);
  const H = 12;
  const W = rows.reduce((s, r, i) => s + r[0].length + (i < rows.length - 1 ? gapAt(i) : 0), 0);
  const k = pal();
  return art(W + 2, H + 2, (p) => {
    /** @type {[number, number][]} */
    const on = [];
    let x0 = 1;
    rows.forEach((r, j) => {
      r.forEach((row, y) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') on.push([x0 + i, 1 + y]); });
      x0 += r[0].length + gapAt(j);
    });
    const set = new Set(on.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of on) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!set.has(`${x + dx},${y + dy}`)) p.px(x + dx, y + dy, k.ink0);
    }
    for (const [x, y] of on) p.px(x, y, col);
  });
}

/**
 * Art px per dot of the language glyphs, in whole device pixels: one half-size font pixel (--fpx,
 * UiScale.js `fpxFor`: ⌈px / 2⌉ device px) on every page, the line role's font pixel beside them —
 * 1 device px at px 2, 2 at px 3 and 4 (never the hairlines one device pixel would draw beside a
 * 33-px keycap).
 */
const langDot = () => { const px = typePx(); return fpxFor(px) / px; };

/** G's title group ('mc' 40, 50, 560 × 300) and the widest its art (the logo) may be, in art px. */
const TITLE_W = 560;
/** The widest the tagline may be (art px): G's frame less 20 a side. */
const SUB_W = 600;
/**
 * The art's clearance from the screen's sides (art px): a centred group keeps 16 clear of each side
 * unscaled (UiScale.js `fitScale`).
 */
const SIDE = 16;

/**
 * A positioned box (a `.g` div) at (x, y), w × h art px of the 640 × 360 frame, inside `parent`
 * (a group or another box); its own children are placed in the same frame coordinates.
 * @param {Element} parent
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} cls
 * @returns {HTMLDivElement}
 */
function box(parent, x, y, w, h, cls) {
  const d = document.createElement('div');
  d.className = `g ${cls}`;
  const [ox, oy] = originOf(parent);
  place(d, Math.round(x - ox), Math.round(y - oy), w, h);
  setOrigin(d, [Math.round(x), Math.round(y)]);
  parent.append(d);
  return d;
}

/**
 * A destination of the chooser / menu.
 * @typedef {{ value: string, label: string, detail: string }} Dest
 */

export class TitleScreen {
  /** @param {HTMLElement} parent */
  constructor(parent = document.body) {
    const el = document.createElement('div');
    // `is-gone` = display:none while fully hidden, so the embers' and the cursor's animations don't
    // keep running for the rest of the game.
    el.className = 'lu-title is-gone';
    el.innerHTML = `
      <div class="lu-title__motes" aria-hidden="true">${motesHtml()}</div>
      <h1 class="lu-title__name"></h1>
      <div class="lu-title__part lu-title__part--crest" aria-hidden="true"></div>
      <div class="lu-title__part lu-title__part--logo" aria-hidden="true"></div>
      <div class="lu-title__part lu-title__part--rule" aria-hidden="true"></div>
      <div class="lu-title__part lu-title__part--sub"></div>
      <div class="lu-title__part lu-title__part--menu"></div>
      <div class="lu-title__part lu-title__part--foot"></div>
      <div class="lu-title__part lu-title__part--lang"></div>`;
    parent.appendChild(el);
    this.element = el;
    /** @type {HTMLElement} the title's text (the logo canvases are aria-hidden) */
    this._name = el.querySelector('.lu-title__name');
    const part = (/** @type {string} */ n) => /** @type {HTMLElement} */ (el.querySelector(`.lu-title__part--${n}`));
    /** The layers, each animated in on its own (they persist; their content is laid out again). */
    this._parts = { crest: part('crest'), logo: part('logo'), rule: part('rule'), sub: part('sub'), menu: part('menu'), foot: part('foot'), lang: part('lang') };

    /** Seconds after show() before input is accepted (avoids accidental instant dismissal). */
    this.armDelay = 0.45;
    /**
     * @type {((source: 'key'|'pointer') => void) | null}
     * Called synchronously inside the dismissing event handler — the place to unlock WebAudio.
     */
    this.onDismiss = null;

    this._visible = false;
    this._leaving = false;
    this._armedAt = 0;
    this._resolve = null;
    this._hideTimer = 0;
    this._promptText = '';
    /** show()'s texts. */
    this._o = { title: '', subtitle: '', credit: '', titleSource: '' };
    /** @type {HTMLElement|null} the destination row / menu (exists only while `show()` was given `destinations`) */
    this._destEl = null;
    /** @type {HTMLElement|null} the selected entry's label */
    this._destLabel = null;
    /** @type {HTMLElement|null} the hint under the destination row */
    this._destHint = null;
    /** The label after the chooser's arrow keycaps (show()'s `destinationHint`). */
    this._destHintText = '';
    /** The verb of a changed destination's prompt (show()'s legacy `destinationVerb`). */
    this._destVerb = null;
    /** The prompt template of a changed destination (`{label}`; show()'s `destinationPrompt`). */
    this._destPrompt = null;
    /** @type {Dest[] | null} */
    this._dests = null;
    this._menu = false;
    this._destIndex = 0;
    this._curIndex = 0;
    this._current = null;
    /** @type {{ code: string, label: string }[] | null} the language row (show()'s `languages` with `onLanguage`) */
    this._langs = null;
    this._langCur = 0;
    this._langSel = 0;
    this._langFocus = false;
    /** @type {((code: string) => void) | null} */
    this._onLanguage = null;
    /** The art layout's state: the px and the screen width (art px) it was laid out at, the bottom of the tagline. */
    this._laidPx = 0;
    this._laidW = 0;
    this._headBottom = 0;
    /**
     * The art's extents in G's frame (art px; `_fitGroups`): the head's (star, logo, divider,
     * tagline) and the menu's (prompt, chooser or menu with their hints) half width about x 320,
     * top and bottom.
     */
    this._headBox = { half: 0, top: 180, bottom: 180 };
    this._menuBox = { half: 0, top: 180, bottom: 180 };
    /** Logo canvases by text and size (only once their font is in). @type {Map<string, HTMLCanvasElement>} */
    this._logos = new Map();
    /** Canvas fonts loaded for a text (`_fontLoaded`: font|text). @type {Set<string>} */
    this._loaded = new Set();
    /** Their loads in flight. @type {Set<string>} */
    this._loading = new Set();
    this._showId = 0;
    this._fontsIn = false;

    this._onKey = (/** @type {KeyboardEvent} */ e) => {
      if (!this._accepting() || e.repeat || IGNORED_KEYS.has(e.code)) return;
      e.preventDefault();
      e.stopPropagation(); // don't let the dismissing key leak into gameplay input
      // L: the first press gives the row the focus on the current language, the next ones move on
      if (this._langs && e.code === LANG_KEY) { if (this._langFocus) this._stepLang(1); else this._focusLang(); return; }
      if (this._langFocus) {
        // the language row has the focus: ← → choose, a confirm key switches, anything else goes back
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') this._stepLang(e.code === 'ArrowLeft' ? -1 : 1);
        else if (CONFIRM_KEYS.has(e.code)) this._applyLang(this._langSel);
        else this._blurLang();
        return;
      }
      if (this._menu) {
        // a menu: the arrows (and W / S) move, a confirm key starts, other keys do nothing
        if (e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'KeyW') this._cycle(-1);
        else if (e.code === 'ArrowDown' || e.code === 'ArrowRight' || e.code === 'KeyS') this._cycle(1);
        else if (CONFIRM_KEYS.has(e.code)) this._dismiss('key');
        return;
      }
      if (this._dests) {
        // only the arrows cycle; only a confirm key travels; any other key resets and dismisses
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') { this._cycle(e.code === 'ArrowLeft' ? -1 : 1); return; }
        if (!CONFIRM_KEYS.has(e.code)) this._resetDest();
      }
      this._dismiss('key');
    };
    this._onPointer = (/** @type {PointerEvent} */ e) => {
      if (!this._accepting()) return;
      const tg = /** @type {Element|null} */ (e.target);
      const opt = /** @type {HTMLElement|null} */ (tg?.closest?.('.lu-title__lang-opt'));
      if (opt && this._langs) {
        // a language plate switches at once (the current one does nothing); never dismisses
        e.preventDefault();
        e.stopPropagation();
        this._applyLang(Number(opt.dataset.index));
        return;
      }
      const arrow = tg?.closest?.('.lu-title__dest-arrow');
      if (arrow && this._dests) {
        // the glyphs cycle and never dismiss
        e.preventDefault();
        e.stopPropagation();
        this._cycle(arrow.classList.contains('lu-title__dest-arrow--prev') ? -1 : 1);
        return;
      }
      if (this._langFocus) { e.preventDefault(); this._blurLang(); return; }
      if (this._menu) {
        // a menu entry: chosen and confirmed; anywhere else: nothing
        const item = /** @type {HTMLElement|null} */ (tg?.closest?.('.lu-title__menu-item'));
        if (!item) return;
        e.preventDefault();
        this._destIndex = Number(item.dataset.index) || 0;
        this._renderMenu();
        this._dismiss('pointer');
        return;
      }
      e.preventDefault();
      // a click on the destination label confirms it; anywhere else resets it first
      if (this._dests && !tg?.closest?.('.lu-title__dest-label')) this._resetDest();
      this._dismiss('pointer');
    };
    // lay out again when the art scale's px changes (the half-size fonts' metrics follow it) or the
    // screen's width does (the logo and the tagline fit its room); a new height only refits
    this._offScale = onScale(parent, (s) => {
      if (!this._visible || this._leaving) return;
      if (s.px !== this._laidPx || s.artW !== this._laidW) this._layout();
      else this._fitGroups();
    });
  }

  /** True from show() until the fade-out has completed. */
  get visible() { return this._visible; }

  /**
   * The selected destination `value` (read it once `show()` has resolved): the `current` value
   * unless the player cycled to another entry and confirmed it. null without `destinations`.
   * @returns {string|null}
   */
  get destination() {
    if (!this._dests) return null;
    return this._destIndex === this._curIndex ? this._current : this._dests[this._destIndex].value;
  }

  /**
   * The language row's state (null without one): the current language, the one chosen in the row
   * and whether the row has the keyboard focus.
   * @returns {{ current: string, selected: string, focused: boolean } | null}
   */
  get language() {
    if (!this._langs) return null;
    return { current: this._langs[this._langCur].code, selected: this._langs[this._langSel].code, focused: this._langFocus };
  }

  /**
   * Show the title screen.
   *
   * With `destinations` a `◂ label ▸` row under the prompt offers other levels: ArrowLeft /
   * ArrowRight and clicks on the ◂ ▸ glyphs cycle it (A / D never do); while the selection differs
   * from `current` the prompt reads "[Enter] Travel to <label>", and only a confirm (Enter, Space
   * or a click on the label) resolves with it selected; any other key or click first resets the
   * selection to `current` and dismisses as usual. Read the choice from `destination`. Without
   * `destinations` nothing changes.
   * `destinationHint` ('Choose a level') follows the arrow keycaps under the row; the prompt of a
   * changed selection is `destinationPrompt` ('Travel to {label}'), or the legacy
   * `destinationVerb` + the label.
   *
   * With `menu: true` the destinations are a vertical menu instead (mockup G's Continue / New
   * Journey): ↑ ↓ (also ← →, W / S) move, a confirm key (Enter, Space) or a click on an entry
   * resolves with it selected; other keys do nothing. An entry's `detail`
   * is a line under it (the save line). No prompt shows.
   *
   * `titleSource`: the title in English when `title` is a translation (Japanese, Chinese): the
   * logo is drawn from the translated name and the English one is the small wordmark under it.
   *
   * With `onLanguage` the language row shows (`languages`, default `TITLE_LANGUAGES`; `lang` the
   * current one, default the page's): L focuses it on the current language (pressed again, moves
   * on), ← → choose, Enter / Space switch — `onLanguage(code)` (the caller saves the choice and
   * reloads) —, Esc / Backspace or any other key go back; a click on a plate switches at once. The
   * row never dismisses the title.
   * @param {{ title?: string, subtitle?: string, prompt?: string, credit?: string,
   *           destinations?: { value: string, label: string, detail?: string }[], current?: string,
   *           destinationHint?: string, destinationVerb?: string, destinationPrompt?: string,
   *           menu?: boolean, titleSource?: string,
   *           languages?: { code: string, label: string }[], lang?: string,
   *           onLanguage?: ((code: string) => void) | null }} [opts]
   * @returns {Promise<'key'|'pointer'|undefined>} resolves as soon as the player presses a key /
   *   clicks (the screen then fades out over ~1.1 s), or with undefined when hide() is called
   *   programmatically.
   */
  show({ title = t('title.name'), subtitle = '', prompt = t('title.pressAnyKey'), credit = t('title.credit'),
    destinations, current, destinationHint, destinationVerb, destinationPrompt, menu = false, titleSource,
    languages, lang, onLanguage } = {}) {
    this._settle(undefined);
    clearTimeout(this._hideTimer);
    const str = (/** @type {unknown} */ v) => (v == null ? '' : String(v));
    this._o = { title: str(title), subtitle: str(subtitle), credit: str(credit), titleSource: str(titleSource) };
    this._name.textContent = this._o.title;
    this._promptText = str(prompt);
    this._destVerb = destinationVerb == null ? null : str(destinationVerb).trim();
    this._destPrompt = destinationPrompt == null ? null : str(destinationPrompt);
    // (a legacy hint carries the gap after the keycaps as a leading space: the layout's now)
    this._destHintText = destinationHint == null ? t('title.chooseLevel') : str(destinationHint).trim();
    this._setDestinations(destinations, current, !!menu);
    this._setLanguages(languages, lang, onLanguage);
    const el = this.element;
    el.classList.remove('is-on', 'is-leaving', 'is-gone');
    el.classList.toggle('is-menu', this._menu);
    void el.offsetWidth; // establish the hidden (opacity 0) style so the fade-in transition runs
    el.classList.add('is-on');
    this._visible = true;
    this._leaving = false;
    // the layout now with the fonts there are; again once the fonts for these texts are in (a CJK
    // face comes in slices: the logo's characters are drawn from it)
    const id = ++this._showId;
    this._fontsIn = false;
    this._layout();
    const fonts = currentFonts();
    const texts = this._texts();
    const relayout = () => { if (this._visible && !this._leaving && id === this._showId) { this._fontsIn = true; this._layout(); } };
    if (fonts) fonts.ensure(texts).then(relayout, relayout);
    else document.fonts?.ready.then(relayout, relayout);
    this._armedAt = performance.now() + this.armDelay * 1000;
    window.addEventListener('keydown', this._onKey, true);
    el.addEventListener('pointerdown', this._onPointer);
    return new Promise((resolve) => { this._resolve = resolve; });
  }

  /** Fade the title screen out (resolves a pending show() promise with undefined). */
  hide() {
    if (!this._visible || this._leaving) return;
    this._leave();
    this._settle(undefined);
  }

  dispose() {
    this._detach();
    clearTimeout(this._hideTimer);
    this._settle(undefined);
    this._offScale();
    this.element.remove();
  }

  // ------------------------------------------------------------------------------------------

  _accepting() { return this._visible && !this._leaving && performance.now() >= this._armedAt; }

  /** @param {'key'|'pointer'} source */
  _dismiss(source) {
    this._leave();
    if (this.onDismiss) this.onDismiss(source);
    this._settle(source);
  }

  _leave() {
    this._leaving = true;
    this._detach();
    const el = this.element;
    el.classList.add('is-leaving');
    el.classList.remove('is-on');
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      el.classList.remove('is-leaving');
      el.classList.add('is-gone');
      this._visible = false;
      this._leaving = false;
    }, 1150);
  }

  _detach() {
    window.removeEventListener('keydown', this._onKey, true);
    this.element.removeEventListener('pointerdown', this._onPointer);
  }

  _settle(value) {
    const r = this._resolve;
    this._resolve = null;
    if (r) r(value);
  }

  /** Every text the title sets (FontLoader.ensure loads their slices before they are measured). */
  _texts() {
    const o = this._o;
    const out = [o.title, o.subtitle, o.credit, o.titleSource, this._promptText, this._destHintText,
      t('title.choose'), t('title.start'), t('title.language'), t('title.langSwitch'), t('title.langBack')];
    for (const d of this._dests ?? []) out.push(d.label, d.detail, this._changedPrompt(d.label));
    for (const l of this._langs ?? []) out.push(l.label);
    return out.filter(Boolean).join('\n');
  }

  /** Build the destination list for a show() call. */
  _setDestinations(destinations, current, menu) {
    const list = Array.isArray(destinations)
      ? destinations.filter((d) => d && d.value != null).map((d) => ({
        value: String(d.value), label: String(d.label ?? d.value), detail: d.detail == null ? '' : String(d.detail),
      }))
      : [];
    if (!list.length) {
      this._dests = null;
      this._current = null;
      this._menu = false;
      return;
    }
    this._dests = list;
    this._menu = menu;
    this._current = current != null ? String(current) : list[0].value;
    // a current value missing from the list stays the result unless the player picks an entry
    this._curIndex = Math.max(0, list.findIndex((d) => d.value === this._current));
    this._destIndex = this._curIndex;
  }

  /** The language row of a show() call (none without `onLanguage`). */
  _setLanguages(languages, lang, onLanguage) {
    this._onLanguage = typeof onLanguage === 'function' ? onLanguage : null;
    const src = Array.isArray(languages) && languages.length ? languages : TITLE_LANGUAGES;
    const list = this._onLanguage
      ? src.filter((l) => l && l.code != null).map((l) => ({ code: String(l.code), label: String(l.label ?? l.code) }))
      : [];
    this._langs = list.length ? list : null;
    if (!this._langs) { this._langFocus = false; return; }
    const cur = String(lang ?? getLang());
    this._langCur = Math.max(0, this._langs.findIndex((l) => l.code === cur));
    this._langSel = this._langCur;
    this._langFocus = false;
  }

  _cycle(dir) {
    const n = this._dests.length;
    this._destIndex = (this._destIndex + dir + n) % n;
    this._renderMenu();
  }

  _resetDest() {
    if (!this._dests || this._destIndex === this._curIndex) return;
    this._destIndex = this._curIndex;
    this._renderMenu();
  }

  /** The prompt of a changed destination (after the Enter / A keycaps). @param {string} label */
  _changedPrompt(label) {
    if (this._destPrompt != null) return this._destPrompt.replace(/\{label\}/g, label);
    if (this._destVerb) return `${this._destVerb} ${label}`;
    return t('title.travelTo', { label });
  }

  /** Give the language row the focus, on the current language (nothing chosen yet). */
  _focusLang() {
    if (!this._langs) return;
    this._langFocus = true;
    this._langSel = this._langCur;
    this._renderLang();
  }

  /** Move the language row's choice (giving the row the focus). @param {number} dir */
  _stepLang(dir) {
    if (!this._langs) return;
    if (!this._langFocus) { this._langFocus = true; this._langSel = this._langCur; }
    const n = this._langs.length;
    this._langSel = (this._langSel + dir + n) % n;
    this._renderLang();
  }

  /** Leave the language row without switching. */
  _blurLang() {
    this._langFocus = false;
    if (this._langs) this._langSel = this._langCur;
    this._renderLang();
  }

  /** Switch to the language at `i` (the current one: just leave the row). @param {number} i */
  _applyLang(i) {
    const L = this._langs?.[i];
    if (!L) return;
    if (i === this._langCur) { this._blurLang(); return; }
    this._langCur = i;
    this._langSel = i;
    this._langFocus = false;
    this._renderLang();
    this._onLanguage?.(L.code);
  }

  // ------------------------------------------------------------------------------------------
  // Layout (art px of G's 640 × 360 frame; G's title group is 'mc' 40, 50, 560 × 300)
  // ------------------------------------------------------------------------------------------

  _layout() {
    this._laidPx = typePx();
    this._laidW = currentScale(this.element)?.artW ?? 640;
    this._renderHead();
    this._renderMenu();
    this._renderFoot();
    this._renderLang();
  }

  /**
   * The room the title's art has across (art px, even): the screen less `SIDE` a side — G's 560
   * and more from 640 art px (1280 px at px 2) up, 480 at 1024 × 768.
   */
  _room() {
    const w = currentScale(this.element)?.artW ?? 640;
    return Math.max(160, 2 * Math.floor((w - 2 * SIDE) / 2));
  }

  /**
   * A logo canvas (a copy of a cached one): 'roman' the title in A's capitals fitted to `maxW`,
   * 'text' the title drawn from the page language's logo face (null while that face is not in for
   * its characters), 'mark' the small English wordmark.
   * @param {'roman'|'text'|'mark'} kind
   * @param {string} text
   * @param {number} [maxW] art px (G's 560; less on a narrow screen)
   * @returns {HTMLCanvasElement|null}
   */
  _logo(kind, text, maxW = TITLE_W) {
    const L = typeLang();
    const id = `${kind}|${L}|${maxW}|${text}`;
    let c = this._logos.get(id);
    if (!c) {
      // a face the canvas draws from must be in first: the CJK logo's for its characters (not drawn
      // until it is), and Jersey 10 for a title outside A's capitals (drawn now, again once the
      // fonts are in); A's capitals are bits
      const needsFont = kind === 'text' || !canLogo(text);
      const ready = !needsFont || (kind === 'text' ? this._fontLoaded(LOGO_FONT[L === 'zh' ? 'zh' : 'ja'][0], text) : this._fontsIn);
      if (kind === 'text' && !ready) return null;
      if (kind === 'text') c = textLogoFit(text, L, { maxW }).canvas;
      else if (kind === 'mark') c = logo(UP(text), 1);
      else c = logoFit(UP(text), { maxW }).canvas;
      if (ready) {
        if (this._logos.size > 16) this._logos.clear();
        this._logos.set(id, c);
      }
    }
    const out = copyCanvas(c);
    out.setAttribute('aria-hidden', 'true');
    return out;
  }

  /**
   * True once `font` (a canvas font shorthand) is declared and `document.fonts.load(font, text)`
   * has settled — never `document.fonts.check()`, which reports a CJK face's slices as in while they
   * are still unloaded when a face of the family's name is installed on the system (Noto Sans SC).
   * The first call for a text starts its load and lays the title out again once it settles.
   * @param {string|null} font
   * @param {string} text
   */
  _fontLoaded(font, text) {
    if (!font || typeof document === 'undefined' || !document.fonts) return false;
    const id = `${font}|${text}`;
    if (this._loaded.has(id)) return true;
    if (this._loading.has(id)) return false;
    const fam = /"([^"]+)"|([A-Za-z0-9]+)\s*$/.exec(font);
    const name = (fam?.[1] ?? fam?.[2] ?? '').toLowerCase();
    let declared = false;
    for (const f of /** @type {Iterable<FontFace>} */ (/** @type {unknown} */ (document.fonts))) {
      if (f.family.replace(/["']/g, '').toLowerCase() === name) { declared = true; break; }
    }
    // (not declared yet: the font set's stylesheet is still on its way; the layout after
    // FontLoader.ensure asks again)
    if (!declared) return false;
    this._loading.add(id);
    const show = this._showId;
    const settled = () => {
      this._loading.delete(id);
      this._loaded.add(id);
      if (this._visible && !this._leaving && show === this._showId) this._layout();
    };
    document.fonts.load(font, text).then(settled, settled);
    return false;
  }

  /** The star, the logo (and the wordmark), the divider and the tagline. */
  _renderHead() {
    const { crest, logo: lp, rule, sub } = this._parts;
    for (const p of [crest, lp, rule, sub]) p.replaceChildren();
    const k = pal();
    const o = this._o;
    const L = typeLang();
    const box = (/** @type {Element} */ p) => group(p, 'mc', 40, 50, TITLE_W, 300);
    const gC = box(crest), gL = box(lp), gR = box(rule), gS = box(sub);
    const name = o.title;
    // the logo within G's 560, or the screen's room when that is less (1024 × 768: 480)
    const room = this._room();
    const maxW = Math.min(TITLE_W, room);
    // (the art's half width: the divider's at least)
    let half = 110;
    let starY, divY;
    if (canLogo(name) || !Object.prototype.hasOwnProperty.call(LOGO_FONT, L)) {
      // G's English title: A's Roman capitals (scale 3 at y 98, 42 tall), the star 2 px over them;
      // a smaller fit keeps the logo's foot on G's (the divider stays at 150)
      const c = this._logo('roman', name, maxW);
      const top = 140 - c.height;
      starY = top - 29;
      put(gL, c, 320 - Math.floor(c.width / 2), top, 1, 'lu-title__logo');
      half = Math.max(half, Math.ceil(c.width / 2));
      divY = 150;
    } else {
      // G's Japanese / Chinese title: the translated name drawn from the language's face at y 86
      // (a long name on two lines, taller than 90, rises by the rest; the menu moves down for the
      // remainder), the English wordmark under it
      const c = this._logo('text', name, maxW);
      const h = c ? c.height : (L === 'zh' ? 70 : 54);
      const ly = Math.max(42, 86 - Math.max(0, h - 90));
      starY = ly - 34;
      if (c) {
        put(gL, c, 320 - Math.floor(c.width / 2), ly, 1, 'lu-title__logo');
        half = Math.max(half, Math.ceil(c.width / 2));
      }
      let y = ly + h + 2;
      const src = o.titleSource.trim();
      if (src && src !== name) {
        const wm = this._logo('mark', src);
        if (wm && wm.width <= maxW) {
          put(gL, wm, 320 - Math.floor(wm.width / 2), y, 1, 'lu-title__wordmark');
          half = Math.max(half, Math.ceil(wm.width / 2));
          y += wm.height;
        }
      }
      divY = y + 2;
    }
    put(gC, star(25), 307, starY, 1, 'lu-title__crest');
    put(gR, divider(219), 211, divY, 1, 'lu-title__divider');
    this._headBottom = divY + 13;
    if (o.subtitle) {
      // the tagline small and quiet under the divider, as today's (2 art px tracking), on one line:
      // cut with an ellipsis past G's 600 art px or the screen's room
      const s = fit(o.subtitle, 'line', Math.min(SUB_W, room), 2);
      const te = txt(gS, s, 320, divY + 18, { font: 'line', track: 2, color: k.tx2, align: 'center', ol: true, cls: 'lu-title__sub' });
      half = Math.max(half, Math.ceil(te.tw / 2) + 1);
      this._headBottom = divY + 18 + FONT.line.L;
    }
    this._headBox = { half, top: starY, bottom: this._headBottom };
  }

  /** The prompt, the level chooser or the menu, where G's menu stands (y 222 on). */
  _renderMenu() {
    const part = this._parts.menu;
    part.replaceChildren();
    this._destEl = null;
    this._destLabel = null;
    this._destHint = null;
    const g = group(part, 'mc', 40, 50, TITLE_W, 300);
    // G's menu at y 222, lower under a taller head (a two-line logo)
    const dy = Math.max(0, Math.ceil(this._headBottom + 14) - 222);
    if (this._menu && this._dests) {
      this._menuBox = this._renderList(g, 222 + dy);
      // the prompt stays in the DOM for scripts (hidden: a menu needs none)
      const hidden = box(g, 40, 222 + dy, 560, 16, 'lu-title__prompt is-hidden');
      const d = this._dests[this._destIndex];
      const tx = document.createElement('span');
      tx.className = 'lu-title__prompt-text';
      tx.textContent = this._destIndex !== this._curIndex ? this._changedPrompt(d.label) : this._promptText;
      hidden.append(tx);
    } else if (this._dests) {
      const a = this._renderPrompt(g, 230 + dy);
      const b = this._renderChooser(g, 244 + dy);
      this._menuBox = { half: Math.max(a.half, b.half), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) };
    } else this._menuBox = this._renderPrompt(g, 244 + dy);
    this._fitGroups();
  }

  /**
   * Scale the title's centred groups (the star, the logo, the divider, the tagline, the menu) only
   * when its art does not fit the screen: `setGroupFit` on the art's own extents (`_headBox`,
   * `_menuBox`), not G's 560 × 300 box. The logo and the tagline are fitted to the screen's room
   * (`_room`), so a narrow screen (1024 × 768: 512 art px) keeps every pixel whole, and a short one
   * (under 360 art px) is scaled only when the art itself would run off it. All five take the same
   * scale about the screen's middle (G's (320, 180)).
   */
  _fitGroups() {
    const h = this._headBox, m = this._menuBox;
    const half = Math.ceil(Math.max(h.half, m.half, 1));
    const top = Math.floor(Math.min(h.top, m.top)), bottom = Math.ceil(Math.max(h.bottom, m.bottom));
    for (const n of /** @type {const} */ (['crest', 'logo', 'rule', 'sub', 'menu'])) {
      const g = /** @type {HTMLElement|null} */ (this._parts[n].firstElementChild);
      if (g) setGroupFit(g, 'mc', 320 - half, top, 2 * half, Math.max(1, bottom - top));
    }
  }

  /**
   * The prompt line, its ink centred on cy: "Press any key" blinking in steps between two gems, or
   * once another level is chosen, [Enter] and "Travel to <label>" in gold. Returns its extents.
   * @param {Element} g
   * @param {number} cy
   * @returns {{ half: number, top: number, bottom: number }}
   */
  _renderPrompt(g, cy) {
    const k = pal();
    const row = box(g, 40, cy - 9, 560, 18, 'lu-title__prompt');
    const ext = { half: 0, top: cy - 9, bottom: cy + 9 };
    const d = this._dests?.[this._destIndex];
    if (d && this._destIndex !== this._curIndex) {
      const text = this._changedPrompt(d.label);
      const tw = measure(text, 'name');
      const total = capW('Enter') + 6 + tw;
      let x = 320 - Math.floor(total / 2);
      x += key(row, 'Enter', x, Math.round(cy - 5.5)) + 6;
      txc(row, text, x, cy, { font: 'name', color: k.g4, ol: true, cls: 'lu-title__prompt-text' });
      ext.half = Math.ceil(total / 2) + 1;
      return ext;
    }
    const text = this._promptText;
    if (!text) return ext;
    const tw = measure(text, 'name');
    const x0 = 320 - Math.floor(tw / 2);
    put(row, gemGlyph(2, GEMS.gold()), x0 - 15, Math.round(cy - 3.5), 1, 'lu-title__gem');
    put(row, gemGlyph(2, GEMS.gold()), x0 + tw + 8, Math.round(cy - 3.5), 1, 'lu-title__gem');
    txc(row, text, 320, cy, { font: 'name', color: k.tx1, align: 'center', ol: true, cls: 'lu-title__prompt-text is-blink' });
    ext.half = Math.ceil(tw / 2) + 15;
    return ext;
  }

  /**
   * The level chooser at y (G's Continue plate as the row): ◀ the label ▶ on a plate fading at both
   * ends, as wide as the longest label; the key hint under it. Returns its extents.
   * @param {Element} g
   * @param {number} y the plate's top (English; a CJK plate grows about its middle)
   * @returns {{ half: number, top: number, bottom: number }}
   */
  _renderChooser(g, y) {
    const k = pal();
    const gn = 2 * Math.ceil(grow('name') / 2);
    const d = this._dests[this._destIndex];
    const changed = this._destIndex !== this._curIndex;
    const lw = Math.max(...this._dests.map((e) => measure(e.label, 'name')));
    const pw = Math.max(110, lw + 50);
    const x0 = 320 - Math.floor(pw / 2);
    const row = box(g, x0, y - gn / 2, pw, 16 + gn + 22, `lu-title__dest${changed ? ' is-changed' : ''}`);
    const lab = box(row, x0, y - gn / 2, pw, 16 + gn, 'lu-title__dest-label');
    put(lab, plate(pw, 16 + gn), x0, y - gn / 2);
    txc(lab, d.label, 320, y + 8, { font: 'name', color: changed ? k.g5 : k.g4, align: 'center', ol: true });
    const one = this._dests.length < 2;
    for (const [dir, gx] of /** @type {[number, number][]} */ ([[-1, x0 + 6], [1, x0 + pw - 11]])) {
      const a = box(row, gx - 5, y - gn / 2, 15, 16 + gn, `lu-title__dest-arrow lu-title__dest-arrow--${dir < 0 ? 'prev' : 'next'}`);
      a.setAttribute('role', 'button');
      a.setAttribute('aria-label', t(dir < 0 ? 'title.prevLevel' : 'title.nextLevel'));
      const name = dir < 0 ? 'left' : 'right';
      put(a, one ? dimGlyph(name) : glyph(name), gx, y + 5);
    }
    const hy = y + 16 + gn / 2 + 6;
    const hint = box(row, x0, hy, pw, 11, 'lu-title__dest-hint');
    const hw = keyHints(hint, [{ keys: ['←', '→'], label: this._destHintText }], 320, hy, { align: 'center', color: k.tx2, ol: true });
    this._destEl = row;
    this._destLabel = lab;
    this._destHint = hint;
    return { half: Math.ceil(Math.max(pw, hw + 2) / 2), top: y - gn / 2, bottom: hy + 11 };
  }

  /**
   * G's menu from y: the selected entry on the plate (16 art px round English capitals, taller round
   * a CJK label) with the nudging cursor gem, the others dim, each entry's detail under it, then
   * the key hints (↑ ↓ Choose · Space Start). Returns its extents.
   * @param {Element} g
   * @param {number} y0
   * @returns {{ half: number, top: number, bottom: number }}
   */
  _renderList(g, y0) {
    const k = pal();
    const gn = 2 * Math.ceil(grow('name') / 2);
    const PW = Math.max(110, ...this._dests.map((e) => measure(e.label, 'name') + 50));
    const list = box(g, 320 - Math.floor(PW / 2) - 10, y0 - gn / 2, PW + 20, 80, 'lu-title__dest is-menu');
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', t('title.menu'));
    let y = y0;
    let last = y0;
    let lastDetail = false;
    let half = PW / 2 + 10;
    this._dests.forEach((m, i) => {
      const on = i === this._destIndex;
      const ih = 16 + gn + (m.detail ? 12 : 0);
      const item = box(list, 320 - Math.floor(PW / 2), y - gn / 2, PW, ih, 'lu-title__menu-item');
      item.dataset.index = String(i);
      item.setAttribute('role', 'menuitem');
      if (on) item.setAttribute('aria-current', 'true');
      if (on) {
        const pw = Math.max(110, measure(m.label, 'name') + 50);
        put(item, plate(pw, 16 + gn), 320 - pw / 2, y - gn / 2);
        put(item, glyph('cursorGem'), 320 - pw / 2 - 6, y + 4, 1, 'nudge');
      }
      const lab = txc(item, m.label, 320, y + 8, { font: 'name', color: on ? k.g4 : k.tx2, align: 'center', ol: true, cls: on ? 'lu-title__dest-label' : 'lu-title__menu-label' });
      if (on) this._destLabel = lab;
      if (m.detail) {
        const de = txt(item, m.detail, 320, y + 18 + gn / 2, { font: 'line', color: k.tx2, align: 'center', ol: true, cls: 'lu-title__menu-detail' });
        half = Math.max(half, de.tw / 2 + 1);
      }
      last = y;
      lastDetail = !!m.detail;
      y += m.detail ? 30 + gn / 2 : 22 + gn / 2;
    });
    const hy = last + 24 - gn / 2 + (lastDetail ? 10 + gn / 2 : 0);
    const hint = box(list, 40, hy, 560, 11, 'lu-title__dest-hint');
    const hw = keyHints(hint, [{ keys: ['↑', '↓'], label: t('title.choose') }, { keys: ['Space'], label: t('title.start') }], 320, hy, { align: 'center', color: k.tx2, ol: true });
    this._destEl = list;
    this._destHint = hint;
    return { half: Math.ceil(Math.max(half, hw / 2 + 1)), top: y0 - gn / 2, bottom: hy + 11 };
  }

  /** The footer in capitals along the bottom (G's 'bc' group). */
  _renderFoot() {
    const part = this._parts.foot;
    part.replaceChildren();
    const credit = this._o.credit;
    if (!credit) return;
    const k = pal();
    const f = group(part, 'bc', 160, 334, 320, 20);
    txt(f, fit(UP(credit), 'line', 600, 1), 320, 338, { font: 'line', track: 1, color: k.tx3, align: 'center', ol: true, cls: 'lu-title__credit' });
  }

  /**
   * The language row in the bottom-right corner, on the footer's line: the L keycap, then each
   * language in its own script — the current one on a small plate, lit —, gold pips between; while
   * it has the focus the chosen one carries the nudging cursor gem and the hints run above it.
   */
  _renderLang() {
    const part = this._parts.lang;
    part.replaceChildren();
    if (!this._langs) return;
    const k = pal();
    const cy = 342.5; // the footer's ink centre (y 338 + the line role's)
    const ph = 13;
    const unit = langDot(); // art px per dot of the language glyphs
    const lit = this._langFocus ? this._langSel : this._langCur;
    /** @type {{ w: number, pw: number, draw: (g: Element, x: number, col: string) => void }[]} */
    const items = this._langs.map((l) => {
      const probe = langGlyphs(l.label, k.g4);
      if (probe) {
        const w = Math.ceil(probe.width * unit);
        return {
          w, pw: Math.max(w + 18, Math.ceil(w / 0.56)),
          draw: (g, x, col) => put(g, /** @type {HTMLCanvasElement} */ (langGlyphs(l.label, col)), x, Math.round(cy - (probe.height * unit) / 2), unit, 'lu-title__lang-glyphs'),
        };
      }
      const w = measure(l.label, 'line');
      return { w, pw: Math.max(w + 18, Math.ceil(w / 0.56)), draw: (g, x, col) => { txc(g, l.label, x, cy, { font: 'line', color: col, ol: true }); } };
    });
    const kw = capW('L');
    // 12 art px between two languages: a gold pip in the middle, or the cursor gem of the next one;
    // 15 after the keycap (the first language's cursor gem clear of it)
    const GAP = 12, KEY_GAP = 15;
    const total = kw + KEY_GAP + items.reduce((s, it) => s + it.pw + GAP, -GAP);
    const x1 = 630;
    let x = x1 - total;
    const g = group(part, 'br', x - 16, 318, total + 18, 32, 'lu-title__lang');
    g.setAttribute('role', 'radiogroup');
    g.setAttribute('aria-label', t('title.language'));
    key(g, 'L', x, Math.round(cy - 5.5));
    x += kw + KEY_GAP;
    items.forEach((it, i) => {
      const on = i === lit;
      const opt = box(g, x, cy - ph / 2, it.pw, ph, `lu-title__lang-opt${on ? ' is-lit' : ''}${i === this._langCur ? ' is-current' : ''}`);
      opt.dataset.index = String(i);
      opt.dataset.lang = this._langs[i].code;
      opt.setAttribute('role', 'radio');
      opt.setAttribute('aria-checked', String(i === this._langCur));
      opt.setAttribute('aria-label', this._langs[i].label);
      if (on) put(opt, plate(it.pw, ph), x, Math.round(cy - ph / 2));
      const col = on ? (this._langFocus ? k.g5 : k.g4) : i === this._langCur ? k.g3 : k.tx3;
      it.draw(opt, x + Math.floor((it.pw - it.w) / 2), col);
      if (on && this._langFocus) put(opt, glyph('cursorGem'), x - 12, Math.round(cy - 4.5), 1, 'nudge');
      x += it.pw;
      if (i < items.length - 1) {
        if (!(this._langFocus && i + 1 === lit)) put(g, art(3, 3, (p) => { p.px(1, 0, k.ink0); p.px(0, 1, k.ink0); p.px(2, 1, k.ink0); p.px(1, 2, k.ink0); p.px(1, 1, k.g3); }), x + 4, Math.round(cy - 1.5));
        x += GAP;
      }
    });
    if (this._langFocus) {
      keyHints(g, [{ keys: ['←', '→'], label: t('title.language') }, { keys: ['Enter'], label: t('title.langSwitch') }, { keys: ['Esc'], label: t('title.langBack') }],
        x1, Math.round(cy - 21), { align: 'right', color: k.tx2, ol: true });
    }
  }
}
