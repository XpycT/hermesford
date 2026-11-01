import { t, isCJK } from '../i18n/I18n.js';
import { pal, GEMS } from './art/palette.js';
import { band, hairline, star, halo, dayBar, fade, rgbOf, BAND_STEPS, gemGlyph, GLYPHS } from './art/pieces.js';
import { icon, PHASE_ICONS } from './art/icons/core.js';
import { measure, inkH, grow, txt, txc, capMid, UP, NAME, fit, FONT, lineCount, setOrigin, originOf } from './layout/type.js';
import { put, win, capW, key, place, U } from './layout/layout.js';
import { onScale, currentScale } from './UiScale.js';
import { currentFonts } from './FontLoader.js';
import './ui.css';
import './hud.css';

/** @import { ToastKind } from './types.js' */
/** @import { PaletteToken } from './art/palette.js' */

/**
 * Heads-up display in mockup G's pixel art (docs/specs/PIXEL_UI.md §5, HUD): the place plate
 * (top-left), the clock (top-right), the controls legend (bottom-left) and the toasts (top, between
 * the corner panels). Each panel is a group anchored to its corner of the 640 × 360 art frame
 * (layout/layout.js), painted from canvases (art/) with its text in the type roles (layout/type.js);
 * a panel is laid out again when its text, the language's fonts or the root's scale change
 * (`onScale`). Keycaps (`createKeycaps`) are A's keycaps drawn in CSS at the root's art pixel.
 *
 * The toasts keep out of the other panels: the stack stays in the span the corner panels beside it
 * leave free (the place plate and what hangs under it on the left, the clock and the minimap on the
 * right) — on the screen's centre line where it fits, moved over where it does not — and wraps to
 * it; a toast that would reach into the area banner's card goes under the card (`Banner` announces
 * its card with a bubbling 'lu-banner' event); where the span beside a long place plate is too
 * narrow the stack starts under the plate. `{Key}` in a toast's text (a key name: `{G}`, `{Esc}`,
 * `{Space}`, `{1}` …) is drawn as G's keycap on a one-line toast.
 */

/** A row of the controls legend: the keys, the label (translated by the caller), a stable id. */
/** @typedef {{ keys: string|string[], label: string, id?: string }} ControlRow */

/**
 * Default legend matching the engine's default Input bindings. The labels are the English source
 * (tests find rows by them); `defaultControls()` gives the rows in the page's language.
 * @type {ReadonlyArray<{ id: string, keys: string, label: string }>}
 */
export const DEFAULT_CONTROLS = [
  { id: 'move', keys: 'WASD', label: 'Move' },
  { id: 'run', keys: 'Shift', label: 'Run' },
  { id: 'talk', keys: 'Space', label: 'Talk / Confirm' },
  { id: 'choose', keys: 'F/Enter', label: 'Choose an answer' },
  { id: 'rotate', keys: 'Q/E', label: 'Rotate camera' },
  { id: 'zoom', keys: 'Z/X', label: 'Zoom (or wheel)' },
  { id: 'map', keys: 'N/Tab', label: 'World map' },
  { id: 'time', keys: 'T', label: 'Time of day' },
  { id: 'weather', keys: 'R', label: 'Weather' },
  { id: 'photo', keys: 'P', label: 'Photo mode' },
  { id: 'music', keys: 'M', label: 'Music' },
  { id: 'debug', keys: '`', label: 'Debug panel' },
];

/**
 * `DEFAULT_CONTROLS` with their labels in the page's language (`hud.control.<id>`).
 * @returns {ControlRow[]}
 */
export const defaultControls = () => DEFAULT_CONTROLS.map((c) => ({ ...c, label: tr(`hud.control.${c.id}`, c.label) }));

/** Phase ids → English display names (the source; `phaseName(id)` is the page's language). */
export const TIME_PHASES = {
  night: 'Night',
  dawn: 'Dawn',
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  golden: 'Golden Hour',
  dusk: 'Dusk',
};
/** @typedef {keyof typeof TIME_PHASES} PhaseId */
const PHASE_IDS = /** @type {PhaseId[]} */ (Object.keys(TIME_PHASES));

/**
 * A phase's name in the page's language (`hud.phase.<id>`).
 * @param {string} id
 */
export const phaseName = (id) => (Object.hasOwn(TIME_PHASES, id) ? tr(`hud.phase.${id}`, TIME_PHASES[/** @type {PhaseId} */ (id)]) : String(id));

/**
 * Time-of-day phase for an hour value.
 * @param {number} h hours in [0, 24)
 * @returns {'night'|'dawn'|'morning'|'midday'|'afternoon'|'golden'|'dusk'}
 */
export function timePhase(h) {
  if (h < 4.75 || h >= 20.5) return 'night';
  if (h < 7) return 'dawn';
  if (h < 11) return 'morning';
  if (h < 14) return 'midday';
  if (h < 16.5) return 'afternoon';
  if (h < 18.75) return 'golden';
  return 'dusk';
}

/** The phase line's colour per phase (today's, ui.css → the clock's phase in the line role). */
const PHASE_COLORS = Object.freeze({
  night: '#a9bff5', dawn: '#f2a7a4', morning: '#f5dc98', midday: '#fbe7a6', afternoon: '#f3cf7c', golden: '#f6b25a', dusk: '#d69ac0',
});

/**
 * `t(key)`, or the English when the key's table is not registered yet (a keycap made before the UI
 * root registered the core strings).
 * @param {string} key
 * @param {string} english
 */
function tr(key, english) {
  const s = t(key);
  return s === key ? english : s;
}

/**
 * The clock's accessible name: `hud.clock` with the time and the phase's name.
 * @param {string} time
 * @param {string} phase
 */
function clockLabel(time, phase) {
  const s = t('hud.clock', { time, phase });
  return s === 'hud.clock' ? `${time}, ${phase}` : s;
}

// ---- keycaps --------------------------------------------------------------------------------

const KEY_LABELS = {
  Space: 'Space', Shift: 'Shift', Enter: 'Enter', Escape: 'Esc', Esc: 'Esc', Backquote: '~', '`': '~', Tab: 'Tab',
  Ctrl: 'Ctrl', Alt: 'Alt', // (arrow keys: ARROW_KEYS)
  // mouse buttons (combat bindings, COMBAT.md §5.2)
  Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB',
};

/**
 * Arrow keycaps are drawn (no pixel face has U+2190–2193): key name or glyph → [A's keycap arrow
 * (GLYPHS kLeft …), its `hud.key.<id>`, the English accessible name].
 */
const ARROW_KEYS = {
  ArrowLeft: ['kLeft', 'left', 'Left arrow'], '←': ['kLeft', 'left', 'Left arrow'],
  ArrowUp: ['kUp', 'up', 'Up arrow'], '↑': ['kUp', 'up', 'Up arrow'],
  ArrowRight: ['kRight', 'right', 'Right arrow'], '→': ['kRight', 'right', 'Right arrow'],
  ArrowDown: ['kDown', 'down', 'Down arrow'], '↓': ['kDown', 'down', 'Down arrow'],
};

/**
 * Key names drawn as a glyph like the arrows: Tiny5's tilde is a one-row dash at the keycap's size,
 * so '~' (the backquote key) is a drawn wave on the cap's rows 3–4.
 */
const DRAWN_KEYS = Object.freeze({ '~': ['......', '......', '.oo..o', 'o..oo.'] });

/** An A's keycap arrow (7 × 7 glyph rows) as an SVG path of whole pixels. @type {Map<string, string>} */
const ARROW_D = new Map();
/** @param {string} name a GLYPHS name, or a DRAWN_KEYS key */
function arrowPath(name) {
  let d = ARROW_D.get(name);
  if (d) return d;
  d = '';
  const rows = /** @type {readonly string[]} */ (Object.hasOwn(DRAWN_KEYS, name) ? DRAWN_KEYS[/** @type {keyof typeof DRAWN_KEYS} */ (name)] : GLYPHS[name]);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      if (row[x] !== 'o') { x++; continue; }
      let n = 1;
      while (row[x + n] === 'o') n++;
      d += `M${x} ${y}h${n}v1h-${n}z`;
      x += n;
    }
  });
  ARROW_D.set(name, d);
  return d;
}

/**
 * A key spec split into keycaps: 'WASD' one cap, 'Q/E' two, 'Shift+Space' two joined by '+'.
 * @param {string|string[]} keys
 * @returns {{ parts: string[], sep: string|null }}
 */
function keyParts(keys) {
  if (Array.isArray(keys)) return { parts: keys.map(String), sep: null };
  const s = String(keys ?? '');
  if (s.length > 1 && s.includes('+')) return { parts: s.split('+'), sep: '+' };
  if (s.length > 1 && s.includes('/')) return { parts: s.split('/'), sep: null };
  return { parts: [s], sep: null };
}

/** The label a keycap shows for a key name. @param {string} name */
const keyLabel = (name) => (Object.hasOwn(KEY_LABELS, name) ? KEY_LABELS[/** @type {keyof typeof KEY_LABELS} */ (name)] : name);

/**
 * The width of `createKeycaps(keys)` in art px: each cap `capW` wide (its 1 px outline included),
 * 1 art px between caps and around a '+'.
 * @param {string|string[]} keys
 */
export function keycapsWidth(keys) {
  const { parts, sep } = keyParts(keys);
  let w = 0;
  parts.forEach((p, i) => {
    const name = p.trim();
    if (i > 0) w += 1 + (sep ? measure(sep, 'tiny') + 1 : 0);
    w += Object.hasOwn(ARROW_KEYS, name) ? 11 : capW(keyLabel(name));
  });
  return w;
}

/**
 * Build keycap markup for a key spec: `span.lu-keys` holding a `kbd.lu-key` per key — A's keycap
 * (11 art px tall: a notched ink outline, the ivory face, a lit top row, a lip) drawn in CSS at the
 * root's art pixel, the name in Tiny5 (a digit in Jersey 10), an arrow as A's drawn arrow (an SVG
 * path, aria-label 'Left arrow' … in the page's language). Each cap takes `capW` art px in a row
 * (`keycapsWidth`).
 * @param {string|string[]} keys e.g. 'WASD', 'Q/E', 'Shift+Space', ['Q', 'E']
 * @returns {HTMLElement}
 */
export function createKeycaps(keys) {
  const wrap = document.createElement('span');
  wrap.className = 'lu-keys';
  const { parts, sep } = keyParts(keys);
  parts.forEach((p, i) => {
    if (i > 0 && sep) {
      const s = document.createElement('span');
      s.className = 'lu-key-sep';
      s.textContent = sep;
      wrap.appendChild(s);
    }
    const k = document.createElement('kbd');
    const name = p.trim();
    const arrow = Object.hasOwn(ARROW_KEYS, name) ? ARROW_KEYS[/** @type {keyof typeof ARROW_KEYS} */ (name)] : null;
    if (arrow) {
      k.className = 'lu-key lu-key--sym lu-key--arrow';
      k.setAttribute('aria-label', tr(`hud.key.${arrow[1]}`, arrow[2]));
      k.innerHTML = `<svg viewBox="0 0 7 7" aria-hidden="true" shape-rendering="crispEdges"><path d="${arrowPath(arrow[0])}"/></svg>`;
      wrap.appendChild(k);
      return;
    }
    const label = keyLabel(name);
    if (Object.hasOwn(DRAWN_KEYS, label)) {
      k.className = 'lu-key lu-key--sym lu-key--glyph';
      k.setAttribute('aria-label', label);
      k.innerHTML = `<svg viewBox="0 0 6 7" aria-hidden="true" shape-rendering="crispEdges"><path d="${arrowPath(label)}"/></svg>`;
      wrap.appendChild(k);
      return;
    }
    k.className = label.length >= 4 ? 'lu-key lu-key--wide' : /^[A-Za-z0-9]*$/.test(label) ? 'lu-key' : 'lu-key lu-key--sym';
    // no digit is ever set in Tiny5 (docs/specs/PIXEL_UI.md §4): a number key's name in Jersey 10
    if (/^[0-9]+$/.test(label)) k.classList.add('lu-key--num');
    const s = document.createElement('span');
    s.className = 'lu-key__t';
    s.textContent = label;
    k.appendChild(s);
    wrap.appendChild(k);
  });
  return wrap;
}

// ---- pieces ---------------------------------------------------------------------------------

/**
 * Make `el` a HUD group anchored to the root (layout.js `group()` for an element the HUD keeps:
 * other modules hold `.lu-loc` and the clock as their anchors). (x, y, w, h) is its box in the
 * 640 × 360 frame; its children are placed in frame coordinates.
 * @param {HTMLElement} el
 * @param {'tl'|'tr'|'bl'} anchor
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 */
function anchorBox(el, anchor, x, y, w, h) {
  el.classList.add('g', 'grp');
  el.dataset.anchor = anchor;
  setOrigin(el, [x, y]);
  const s = el.style;
  s.width = U(w);
  s.height = U(h);
  s.left = s.right = s.top = s.bottom = '';
  let ox, oy;
  if (anchor[1] === 'l') { s.left = U(x); ox = U(-x); } else { s.right = U(640 - x - w); ox = `calc(100% + ${U(640 - x - w)})`; }
  if (anchor[0] === 't') { s.top = U(y); oy = U(-y); } else { s.bottom = U(360 - y - h); oy = `calc(100% + ${U(360 - y - h)})`; }
  s.transformOrigin = `${ox} ${oy}`;
}

/**
 * A div placed at frame (0, 0) of its parent's origin that holds positioned children in the same
 * frame coordinates (the legend's grid and footer).
 * @param {HTMLElement} parent
 * @param {string} cls
 */
function layer(parent, cls) {
  const d = document.createElement('div');
  d.className = cls;
  setOrigin(d, originOf(parent));
  parent.appendChild(d);
  return d;
}

/**
 * The toast's plate (the title's picker plate, G's `plate()`, with ends of a fixed length): a band
 * fading out over `F` art px at both ends in hard steps between hairlines that fade to dots there.
 * @param {number} w
 * @param {number} h
 * @param {number} F
 * @param {{ band: string, top: string, bot: string }} c colours
 */
function toastPlate(w, h, F, c) {
  const cv = fade(w, h, rgbOf(c.band), (u, v) => {
    if (v * h < 1 || v * h > h - 1) return 0;
    return 0.82 * Math.max(0, Math.min(1, Math.min(u, 1 - u) * w / F));
  }, [...BAND_STEPS]);
  const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  for (let x = 0; x < w; x++) {
    const d = Math.min(x, w - 1 - x);
    if (d < F / 2 && x % 4) continue;
    if (d < F && x % 2) continue;
    ctx.fillStyle = c.top;
    ctx.fillRect(x, 0, 1, 1);
    ctx.fillStyle = c.bot;
    ctx.fillRect(x, h - 1, 1, 1);
  }
  return cv;
}

/**
 * The toast kinds: band colour, hairlines, the end studs, the text colour and the leading icon
 * (art/icons/core.js): quest the scroll on a gilded band, item the chest, error the red pennant in
 * ruby (story script errors, a failed save).
 * @type {Record<''|ToastKind, { band: PaletteToken, top: PaletteToken, bot: PaletteToken, gem: () => string[], color: PaletteToken, icon: string|null, maxW: number }>}
 */
const TOAST_STYLE = {
  '': { band: 'band', top: 'g3', bot: 'g2', gem: GEMS.gold, color: 'tx1', icon: null, maxW: 400 },
  quest: { band: 'xp0', top: 'g4', bot: 'g3', gem: GEMS.gold, color: 'g5', icon: 'scroll', maxW: 400 },
  item: { band: 'band', top: 'g3', bot: 'g2', gem: GEMS.gold, color: 'tx1', icon: 'chest', maxW: 400 },
  error: { band: 'tr1', top: 'rb2', bot: 'rb1', gem: GEMS.ruby, color: 'rb3', icon: 'flag', maxW: 460 },
};

/**
 * The toast stack in art px: its top, the gap between toasts, the air it keeps to a panel beside it
 * (each side) and to the banner's card, and the least text width a toast wraps to beside the place
 * plate (less: the stack starts under the plate).
 */
const TOAST_TOP = 10, TOAST_GAP = 2, TOAST_AIR = 8, TOAST_MIN_TEXT = 140;
/** The banner card's air above and below (art px). */
const BANNER_AIR = 3;

/**
 * A toast's width beside its text (art px): the two fading ends (16 each), the lead (a kind's icon
 * 14, else the stud 5), the gaps either side of the text (5 each) and the right stud (5).
 * @param {{ icon: string|null }} S
 */
const toastChrome = (S) => 16 + (S.icon ? 14 : 5) + 5 + 5 + 5 + 16;

/**
 * A key name in a toast's `{Key}` markup, drawn as G's keycap: a capital letter or a digit, F1–F12,
 * a named key, a mouse button or an arrow. Any other `{word}` stays the keyword markup (`.kw`).
 */
const TOAST_KEY = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|Shift|Enter|Esc|Escape|Tab|Ctrl|Alt|Backspace|Mouse[0-2]|LMB|MMB|RMB|[←↑→↓])$/;
/** The air between a keycap and the text or the keycap beside it (art px). */
const KEY_GAP = 3;

/**
 * A toast's `{Key}` markup split into text runs (trimmed at a key) and keys (their keycap labels);
 * null without a key.
 * @param {string} text
 * @returns {Array<{ text: string, key?: undefined } | { key: string, text?: undefined }>|null}
 */
function toastParts(text) {
  /** @type {Array<{ text: string, key?: undefined } | { key: string, text?: undefined }>} */
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
    if (!TOAST_KEY.test(m[1])) continue;
    const before = text.slice(last, m.index).trim();
    if (before) out.push({ text: before });
    out.push({ key: keyLabel(m[1]) });
    last = (m.index ?? 0) + m[0].length;
  }
  if (!out.length) return null;
  const rest = text.slice(last).trim();
  if (rest) out.push({ text: rest });
  return out;
}

/** The width of `toastParts` laid in a row (art px). @param {NonNullable<ReturnType<typeof toastParts>>} parts */
const partsWidth = (parts) => parts.reduce((w, p, i) => w + (i ? KEY_GAP : 0) + (p.key != null ? capW(p.key) : measure(p.text, 'line')), 0);

/**
 * A toast's size for a text width limit (art px): its text width, lines, box and whether its keys
 * are drawn as keycaps (one line only: wrapped, `{Key}` is the keyword markup).
 * @typedef {{ lim: number, tw: number, lines: number, w: number, h: number, parts: ReturnType<typeof toastParts> }} ToastSize
 */
/**
 * A live toast: its text, kind and, once laid out, its size and place (art px, in the stack's frame).
 * @typedef {{ text: string, kind: ''|ToastKind, size?: ToastSize|null, drawn?: ToastSize|null, x?: number, y?: number }} ToastSpec
 */

/** The legend's row pitch (an 11 art px keycap and 2 of air) and its padding inside the frame. */
const ROW = 13;
const PAD = 7;

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

export class HUD {
  /** @param {HTMLElement} parent */
  constructor(parent = document.body) {
    const el = document.createElement('div');
    el.className = 'lu-hud';
    parent.appendChild(el);
    this.element = el;
    // the toasts are the HUD's but sit beside it in `parent` (#luminati-ui): inside `.lu-hud`, whose
    // z-index makes it a stacking context, they painted under the banner and the dialog (UI-06);
    // here their z-index 5 counts against those (banner 3, dialog 4)
    const toasts = document.createElement('div');
    toasts.className = 'lu-toasts';
    toasts.setAttribute('aria-live', 'polite');
    parent.appendChild(toasts);
    /** The toast container (`.lu-toasts`, a sibling of `element`). */
    this.toastElement = toasts;

    /** @type {HTMLElement} the place plate (`.lu-loc`): a group at (10, 10), as tall as two lines */
    this._loc = document.createElement('div');
    this._loc.className = 'lu-loc is-empty';
    /** @type {HTMLElement} the clock (`.lu-clock[data-phase]`): a group whose right edge is at 630 */
    this._clock = document.createElement('div');
    this._clock.className = 'lu-clock';
    this._clock.dataset.phase = 'golden';
    this._clock.setAttribute('role', 'img');
    /** @type {HTMLElement} the controls legend (`.lu-help`): a group at the bottom left */
    this._help = document.createElement('div');
    this._help.className = 'lu-help is-empty';
    /** @type {HTMLElement} the folded legend's tab (`.lu-help-tab`): [H] Show controls, at the bottom left while the legend is hidden */
    this._helpTab = document.createElement('div');
    this._helpTab.className = 'lu-help-tab is-empty is-hidden';
    el.append(this._loc, this._clock, this._help, this._helpTab);
    this._toasts = toasts;

    /** Key shown in the legend footer as the help toggle ('' hides the footer). */
    this.helpKey = 'H';
    /** Maximum toasts stacked at once. */
    this.maxToasts = 3;

    this._visible = true;
    this._helpVisible = true;
    this._hours = -1;
    this._minute = -1;
    this._phase = '';
    this._timeText = '00:00';
    this._locationName = '';
    this._locationSub = '';
    /** @type {ControlRow[]} */
    this._rows = [];
    this._timers = new Set();
    /** @type {Map<HTMLElement, ToastSpec>} the live toasts */
    this._toastSpecs = new Map();
    /** @type {[number, number, number, number]|null} the place plate's box in the frame (x, y, w, h) */
    this._locBox = null;
    /** @type {[number, number, number, number]|null} the clock's box in the frame */
    this._clockBox = null;
    /**
     * The area banner's card while it is on screen (its 'lu-banner' event): the keep-out band in
     * the frame and the card's fit scale.
     * @type {{ x: number, y: number, w: number, h: number, fit: number }|null}
     */
    this._banner = null;
    /** @param {Event} e */
    this._onBanner = (e) => {
      const d = /** @type {CustomEvent} */ (e).detail;
      this._banner = d && Number.isFinite(d.y) && Number.isFinite(d.h) ? { x: +d.x || 0, y: +d.y, w: +d.w || 0, h: +d.h, fit: +d.fit || 1 } : null;
      this._layoutToasts();
    };
    parent.addEventListener('lu-banner', this._onBanner);
    this._parent = parent;
    /** @type {{ x0: number, y: number, gl: number, textW: number, tx: number }|null} the clock's layout */
    this._ck = null;
    /** @type {HTMLElement|null} */ this._timeEl = null;
    /** @type {HTMLElement|null} */ this._phaseEl = null;
    /** @type {HTMLCanvasElement|null} */ this._iconEl = null;
    /** @type {HTMLCanvasElement|null} */ this._barEl = null;
    this._barMx = -1;
    this._disposed = false;

    // lay out again when the root's scale changes (its 'scale' event comes once the fonts follow)
    // and once the language's fonts are in (text is measured: before, the fallback face's widths)
    this._unscale = onScale(parent, () => this.relayout());
    currentFonts()?.ready.then(() => { if (!this._disposed) this.relayout(); });

    this._renderLoc();
    this._renderClock();
    this.setTime(17.2);
    this.setControls(defaultControls());
  }

  /** Whole-HUD visibility (fades), the toasts included. */
  get visible() { return this._visible; }
  set visible(v) {
    this._visible = !!v;
    this.element.classList.toggle('is-hidden', !this._visible);
    this._toasts.classList.toggle('is-hidden', !this._visible);
  }

  /** The clock panel element (used to place the debug panel and the minimap below it). */
  get clockElement() { return this._clock; }
  /** The location plate element (`.lu-loc`). */
  get locationElement() { return this._loc; }
  /** The controls legend panel element (`.lu-help`). */
  get helpElement() { return this._help; }
  /** The folded legend's tab (`.lu-help-tab`: [H] Show controls while the legend is hidden). */
  get helpTabElement() { return this._helpTab; }
  /** Current hours value last passed to setTime. */
  get hours() { return this._hours; }
  /** Current phase id (see TIME_PHASES). */
  get phase() { return this._phase; }
  get helpVisible() { return this._helpVisible; }

  /**
   * Lay every panel out again (the language's fonts came in, the scale changed). Cheap enough for
   * those events; never per frame.
   */
  relayout() {
    if (this._disposed) return;
    // the toasts measured again in the new fonts / scale (laid out again beside the new panels)
    for (const spec of this._toastSpecs.values()) spec.size = spec.drawn = null;
    this._renderLoc();
    this._renderClock();
    this._renderHelp();
    this._layoutToasts();
  }

  /**
   * Update the clock. Cheap to call every frame: the DOM only changes when the minute changes.
   * @param {number} hours 0..24 (wraps)
   */
  setTime(hours) {
    if (!Number.isFinite(hours)) return;
    const h = ((hours % 24) + 24) % 24;
    this._hours = h;
    const minute = Math.floor(h * 60) % 1440;
    if (minute === this._minute) return;
    this._minute = minute;
    const hh = Math.floor(minute / 60);
    const mm = minute % 60;
    this._timeText = `${DIGITS[(hh / 10) | 0]}${DIGITS[hh % 10]}:${DIGITS[(mm / 10) | 0]}${DIGITS[mm % 10]}`;
    const node = this._timeEl?.firstChild;
    if (node) node.nodeValue = this._timeText;
    this._applyBar();
    const phase = timePhase(h);
    if (phase !== this._phase) {
      const prevIcon = PHASE_ICONS[this._phase];
      this._phase = phase;
      this._clock.dataset.phase = phase;
      this._applyPhase(PHASE_ICONS[phase] !== prevIcon);
    } else this._clock.setAttribute('aria-label', clockLabel(this._timeText, phaseName(phase)));
  }

  /**
   * Set the location plate text (callers pass it translated: docs/specs/PIXEL_UI.md §8.1).
   * @param {string} name
   * @param {string} [subtitle] optional second line (region, district…)
   */
  setLocation(name, subtitle = '') {
    const n = String(name ?? '');
    const s = String(subtitle ?? '');
    if (n === this._locationName && s === this._locationSub) return;
    const had = !!this._locationName;
    this._locationName = n;
    this._locationSub = s;
    this._renderLoc();
    this._loc.classList.toggle('is-empty', !n);
    if (n && had) {
      this._loc.classList.add('is-swap');
      void this._loc.offsetWidth;
      this._loc.classList.remove('is-swap');
    }
    this._ensure([UP(n), s], () => n === this._locationName && s === this._locationSub, () => this._renderLoc());
  }

  /**
   * Show / hide the controls legend. Folded, it leaves a small tab at the bottom left — [H] Show
   * controls (`.lu-help-tab`) — so the player knows how to open it again; `tab: false` folds it
   * without one (the game while it starts: `Game.enterGameplay` then opens the legend or the tab).
   * @param {boolean} show
   * @param {{ tab?: boolean }} [opts]
   */
  showHelp(show, { tab = true } = {}) {
    this._helpVisible = !!show;
    this._help.classList.toggle('is-hidden', !this._helpVisible);
    this._helpTab.classList.toggle('is-hidden', this._helpVisible || !tab);
  }

  toggleHelp() { this.showHelp(!this._helpVisible); return this._helpVisible; }

  /**
   * Replace the controls legend. Callers pass translated labels; a row's `id` is stable across
   * languages (the label element carries it as `data-id`).
   * @param {ControlRow[]} list
   */
  setControls(list = []) {
    this._rows = Array.isArray(list) ? list.slice() : [];
    this._renderHelp();
    const want = this._rows.map((r) => r.label ?? '');
    this._ensure([...want, t('hud.controls'), t('hud.hide'), t('hud.show')], () => this._rows.every((r, i) => (r.label ?? '') === want[i]), () => this._renderHelp());
  }

  /**
   * Show a short message at the top: the title's plate band with a gold stud at each end, the text
   * in the line role. The stack is centred between the corner panels beside it and wraps to that
   * span (at most ~400 art px of text, 460 for an error); a toast that would reach into the area
   * banner's card goes under it (see the class comment). `{Key}` in the text (`{G}`, `{Esc}`,
   * `{Space}` …: `TOAST_KEY`) is drawn as a keycap on a one-line toast; any other `{word}` is the
   * keyword markup.
   * @param {string} text
   * @param {number} [seconds]
   * @param {{ kind?: ToastKind }} [opts] kind (additive, story levels): 'quest' the scroll on a
   *   gilded band, 'item' the chest, 'error' ruby (story script errors in development; it wraps
   *   instead of running off screen; its braces are never keycaps). Without a kind (or an unknown
   *   one) the toast is the plain one.
   */
  toast(text, seconds = 2.5, { kind } = {}) {
    const k = kind === 'quest' || kind === 'item' || kind === 'error' ? kind : '';
    const el = document.createElement('div');
    el.className = k ? `lu-toast lu-toast--${k}` : 'lu-toast';
    /** @type {ToastSpec} */
    const spec = { text: String(text ?? ''), kind: /** @type {''|ToastKind} */ (k) };
    // placed with its transitions off (the layout reads the page): it fades in where it stands
    // instead of stepping over from the stack's corner
    el.style.transition = 'none';
    this._toasts.appendChild(el);
    this._toastSpecs.set(el, spec);
    while (this._toasts.children.length > this.maxToasts) {
      const first = /** @type {HTMLElement} */ (this._toasts.firstElementChild);
      this._toastSpecs.delete(first);
      first.remove();
    }
    this._layoutToasts();
    void el.offsetWidth;
    el.style.transition = '';
    el.classList.add('is-on');
    const t1 = setTimeout(() => {
      this._timers.delete(t1);
      el.classList.add('is-off');
      const t2 = setTimeout(() => {
        this._timers.delete(t2);
        this._toastSpecs.delete(el);
        el.remove();
        this._layoutToasts();
      }, 520);
      this._timers.add(t2);
    }, Math.max(0.5, seconds) * 1000);
    this._timers.add(t1);
    this._ensure([spec.text], () => el.isConnected, () => { spec.size = spec.drawn = null; this._layoutToasts(); });
    return el;
  }

  /**
   * Per-frame hook (reserved; the HUD is event driven). UI.update passes `dt`, unused so far.
   * @type {(dt?: number) => void}
   */
  update() {}

  dispose() {
    this._disposed = true;
    this._unscale();
    this._parent.removeEventListener('lu-banner', this._onBanner);
    for (const tm of this._timers) clearTimeout(tm);
    this._timers.clear();
    this._toastSpecs.clear();
    this._toasts.remove();
    this.element.remove();
  }

  // ---- layout -------------------------------------------------------------------------------

  /**
   * Japanese and Chinese faces come in unicode-range slices: load the ones `texts` need and lay
   * the panel out again (`redo`) once they are in, if it still shows them (`still`).
   * @param {string[]} texts
   * @param {() => boolean} still
   * @param {() => void} redo
   */
  _ensure(texts, still, redo) {
    const fonts = currentFonts();
    if (!fonts || !isCJK()) return;
    fonts.ensure(texts.join('\n')).then(() => { if (!this._disposed && still()) redo(); }, () => {});
  }

  /**
   * The place plate (G's placePlate): a compass star, the name in the name role (capitals, one art
   * px of tracking), the region in the line role, on today's band fading right in hard steps between
   * gold hairlines. Its box is always the two-line height (22 art px in English, the CJK ink taller:
   * 28 / 29), so what hangs under it (the vitals, the party frames) does not move with the region.
   */
  _renderLoc() {
    const k = pal();
    const el = this._loc;
    el.replaceChildren();
    const X = 10, Y = 10;
    const name = fit(UP(this._locationName), 'name', 236, 1);
    const region = fit(this._locationSub, 'line', 236);
    const nw = measure(name, 'name', 1), rw = measure(region, 'line');
    const w = Math.max(123, Math.ceil((23 + Math.max(nw, rw)) / 0.72));
    const ni = inkH('name'), li = inkH('line'), top = 3.5, gap = 2.5;
    const h = Math.round(top + ni + gap + li + 3.5);
    anchorBox(el, 'tl', X, Y, w, h);
    this._locBox = [X, Y, w, h];
    put(el, band(w, h), X, Y, 1, 'lu-loc__band').setAttribute('aria-hidden', 'true');
    put(el, hairline(Math.round(w * 0.88)), X, Y).setAttribute('aria-hidden', 'true');
    put(el, hairline(Math.round(w * 0.88)), X, Y + h - 1).setAttribute('aria-hidden', 'true');
    put(el, star(11), X + 4, Y + Math.floor((h - 13) / 2), 1, 'lu-loc__icon').setAttribute('aria-hidden', 'true');
    // with no region the name sits in the middle of the band
    txc(el, name, X + 23, region ? Y + top + ni / 2 : Y + h / 2, { ...NAME, color: k.tx1, drop: true, cls: 'lu-loc__name' });
    txc(el, region, X + 23, Y + top + ni + gap + li / 2, { font: 'line', color: k.g4, drop: true, cls: 'lu-loc__sub' });
    // the toasts keep beside (or under) the plate
    this._layoutToasts();
  }

  /**
   * The clock (G's clock): an XS window with gold corner gems, the phase's icon in a gilt halo, the
   * time in the big role, the phase in the line role in the phase's colour, today's day bar. Its
   * width fits the longest phase name of the language, so it never jumps with the hour.
   */
  _renderClock() {
    const el = this._clock;
    el.replaceChildren();
    const k = pal();
    const x1 = 630, Y = 10;
    const tw = measure('00:00', 'big', 1);
    const pw = Math.max(...PHASE_IDS.map((id) => measure(phaseName(id), 'line')));
    const textW = Math.max(tw, pw, 40);
    const gl = Math.ceil(grow('line'));
    const w = 3 + 22 + 3 + textW + 7, x0 = x1 - w, h = 31 + gl;
    anchorBox(el, 'tr', x0, Y, w, h);
    this._clockBox = [x0, Y, w, h];
    win(el, { size: 'XS', corners: GEMS.gold(), cornerR: 2 }, x0, Y, w, h);
    put(el, halo(22), x0 + 3, Y + 4 + gl / 2, 1, 'lu-clock__halo');
    const tx = x0 + 28;
    this._ck = { x0, y: Y, gl, textW, tx };
    this._timeEl = txt(el, this._timeText, tx, Y + 1.5, { font: 'big', track: 1, color: k.g5, drop: true, cls: 'lu-clock__time' });
    this._phaseEl = txt(el, '', tx, Y + 11.5 + gl / 2, { font: 'line', drop: true, cls: 'lu-clock__phase' });
    this._iconEl = null;
    this._barEl = null;
    this._barMx = -1;
    for (const c of el.querySelectorAll('canvas')) c.setAttribute('aria-hidden', 'true');
    if (this._phase) this._applyPhase(true);
    if (this._minute >= 0) this._applyBar();
    const fonts = currentFonts();
    if (fonts && isCJK()) {
      const names = PHASE_IDS.map(phaseName);
      fonts.ensure(names.join('\n')).then(() => {
        if (this._disposed) return;
        if (Math.max(...names.map((n) => measure(n, 'line'))) !== pw) this._renderClock();
      }, () => {});
    }
  }

  /**
   * The phase's name, colour and accessible name; its icon too when `withIcon`.
   * @param {boolean} withIcon
   */
  _applyPhase(withIcon) {
    const ck = this._ck;
    const id = this._phase;
    if (!ck || !id) return;
    const name = phaseName(id);
    if (this._phaseEl) {
      this._phaseEl.textContent = name;
      this._phaseEl.style.color = PHASE_COLORS[/** @type {PhaseId} */ (id)] ?? pal().phase;
    }
    this._clock.setAttribute('aria-label', clockLabel(this._timeText, name));
    if (withIcon || !this._iconEl) {
      this._iconEl?.remove();
      const ic = icon(PHASE_ICONS[id] ?? 'sun');
      ic.setAttribute('aria-hidden', 'true');
      this._iconEl = put(this._clock, ic, ck.x0 + 6, ck.y + 7 + ck.gl / 2, 1, 'lu-clock__icon');
    }
  }

  /** The day bar's ◆ at the minute: repainted only when it moves by an art pixel. */
  _applyBar() {
    const ck = this._ck;
    if (!ck || this._minute < 0) return;
    const bw = ck.textW - 2;
    const frac = this._minute / 1440;
    const mx = Math.round(frac * (bw - 1));
    if (mx === this._barMx && this._barEl) return;
    this._barMx = mx;
    this._barEl?.remove();
    const bar = dayBar(bw, frac);
    bar.setAttribute('aria-hidden', 'true');
    this._barEl = put(this._clock, bar, ck.tx - 2, ck.y + 20 + ck.gl, 1, 'lu-clock__track');
  }

  /**
   * The controls legend: an XS window with gold corner gems, the CONTROLS heading (small, tracked,
   * a gilt rule running right), the rows (A's keycaps right-aligned, the labels in the line role),
   * the footer ([H] Hide controls) under a dim rule. One column of rows; two side by side when one
   * would reach into the top-left panels (short windows, long legends).
   */
  _renderHelp() {
    this._renderHelpTab();
    const el = this._help;
    el.replaceChildren();
    const rows = this._rows;
    el.classList.toggle('is-empty', rows.length === 0);
    if (!rows.length) return;
    const k = pal();
    const heading = UP(tr('hud.controls', 'Controls'));
    const hw = measure(heading, 'small', 1);
    const items = rows.map((r) => ({ r, kw: keycapsWidth(r.keys), lw: measure(r.label ?? '', 'line') }));
    const foot = this.helpKey ? { kw: keycapsWidth(this.helpKey), label: tr('hud.hide', 'Hide controls') } : null;
    const fw = foot ? foot.kw + 4 + measure(foot.label, 'line') : 0;
    const gs = 2 * Math.ceil(grow('small') / 2);
    const R0 = 15 + gs;
    const height = (n) => R0 + (n - 1) * ROW + 11 + (foot ? 3 + 1 + 3 + 11 + 5 : 6);
    // two columns when one would come within 160 art px of the top (the plate, the vitals and three
    // party frames take the top left down to ~142 in English; the CJK ink makes the plate and each
    // frame taller: twice the plate's growth more, ~155), in the corner groups' frame: the screen's
    // art px over their shrink (1 from 1024 × 600 up, so a 1024 × 768 screen has 384)
    const sc = currentScale(this.element);
    const artH = sc ? sc.artH / (sc.cornerShrink || 1) : 360;
    const top = 160 + 2 * Math.max(0, (this._locBox?.[3] ?? 22) - 22);
    const two = rows.length > 3 && height(rows.length) > artH - top;
    const cols = two ? [items.slice(0, Math.ceil(items.length / 2)), items.slice(Math.ceil(items.length / 2))] : [items];
    const colW = cols.map((c) => {
      const kw = Math.max(...c.map((it) => it.kw)), lw = Math.max(...c.map((it) => it.lw));
      return { kw, lw, w: kw + 5 + lw };
    });
    const rowsW = colW.reduce((a, c) => a + c.w, 0) + (cols.length - 1) * 14;
    const w = PAD + Math.max(rowsW, hw + 24, fw) + PAD + 1;
    const h = height(cols[0].length);
    const x0 = 10, y0 = 350 - h;
    anchorBox(el, 'bl', x0, y0, w, h);
    win(el, { size: 'XS', corners: GEMS.gold(), cornerR: 2 }, x0, y0, w, h);
    // the heading: CONTROLS and a gilt rule running right
    const cy = y0 + 8 + gs / 2;
    txc(el, heading, x0 + PAD, cy, { font: 'small', track: 1, color: k.g4, drop: true, cls: 'lu-help__title' });
    put(el, hairline(w - PAD * 2 - hw - 5, 'r'), x0 + PAD + hw + 5, Math.round(cy)).setAttribute('aria-hidden', 'true');
    // the rows
    const grid = layer(el, 'lu-help__grid');
    let cx = x0 + PAD;
    cols.forEach((col, ci) => {
      const { kw } = colW[ci];
      col.forEach((it, i) => {
        const ry = y0 + R0 + i * ROW;
        const keys = createKeycaps(it.r.keys);
        keys.classList.add('lu-help__keys');
        place(keys, cx - x0, ry - y0, kw, 11);
        grid.appendChild(keys);
        const lab = txc(grid, it.r.label ?? '', cx + kw + 5, ry + 5.5, { font: 'line', color: k.tx1, drop: true, cls: 'lu-help__label' });
        if (it.r.id) { lab.dataset.id = String(it.r.id); keys.dataset.id = String(it.r.id); }
      });
      cx += colW[ci].w + 14;
    });
    // the footer: a dim rule, [H] Hide controls
    if (foot) {
      const fy = y0 + R0 + (cols[0].length - 1) * ROW + 11 + 3;
      put(el, hairline(w - PAD * 2, 'r', k.dm1), x0 + PAD, fy).setAttribute('aria-hidden', 'true');
      this._keyRow(layer(el, 'lu-help__foot'), x0, y0, fy + 4, foot.kw, foot.label, 'lu-help__foot-keys', 'lu-help__hint');
    }
  }

  /**
   * The folded legend's tab: the legend's footer turned round — [H] Show controls — in an XS window
   * with the legend's gold corner gems, anchored `bl` at x 10 with its bottom at 350 like the legend,
   * 21 tall (5 art px above and below the keycap, as the footer row). Empty without rows or a help key.
   */
  _renderHelpTab() {
    const el = this._helpTab;
    el.replaceChildren();
    const on = this._rows.length > 0 && !!this.helpKey;
    el.classList.toggle('is-empty', !on);
    if (!on) return;
    const kw = keycapsWidth(this.helpKey);
    const label = tr('hud.show', 'Show controls');
    const w = PAD + kw + 4 + measure(label, 'line') + PAD + 1;
    const y0 = 329;
    anchorBox(el, 'bl', 10, y0, w, 21);
    win(el, { size: 'XS', corners: GEMS.gold(), cornerR: 2 }, 10, y0, w, 21);
    this._keyRow(el, 10, y0, y0 + 5, kw, label, 'lu-help-tab__keys', 'lu-help-tab__label');
  }

  /**
   * The help key's row — its keycap, 4 art px, then `label` in the line role (`tx2`) — with its
   * top at frame y `y`, `PAD` in from `parent`'s box at (x0, y0): the legend's footer and its tab.
   * @param {HTMLElement} parent @param {number} x0 @param {number} y0 @param {number} y
   * @param {number} kw the keycaps' width @param {string} label @param {string} keysCls @param {string} labelCls
   */
  _keyRow(parent, x0, y0, y, kw, label, keysCls, labelCls) {
    const keys = createKeycaps(this.helpKey);
    keys.classList.add(keysCls);
    place(keys, PAD, y - y0, kw, 11);
    parent.appendChild(keys);
    txc(parent, label, x0 + PAD + kw + 4, y + 5.5, { font: 'line', color: pal().tx2, drop: true, cls: labelCls });
  }

  // ---- toasts --------------------------------------------------------------------------------

  /**
   * A toast's size with its text wrapped at `lim` art px (cached on the spec for that limit): the
   * title's plate 16 art px tall, 20 with a kind's icon, taller with CJK ink and with each wrapped
   * line; `{Key}` markup drawn as keycaps when the toast is one line (not on an error).
   * @param {ToastSpec} spec
   * @param {number} lim the text's width limit
   * @returns {ToastSize}
   */
  _toastSize(spec, lim) {
    const S = TOAST_STYLE[spec.kind] ?? TOAST_STYLE[''];
    const L = Math.max(48, Math.min(S.maxW, Math.floor(lim)));
    const z = spec.size;
    if (z && z.lim === L) return z;
    const keyed = spec.kind === 'error' ? null : toastParts(spec.text);
    const kw = keyed ? partsWidth(keyed) : 0;
    let parts = null, tw, lines = 1;
    if (keyed && kw <= L) { parts = keyed; tw = kw; }
    else {
      tw = measure(spec.text, 'line');
      if (tw > L) { lines = lineCount(null, spec.text, 'line', L); tw = L; }
    }
    const gl = 2 * Math.ceil(grow('line') / 2);
    const h = Math.round((S.icon ? 20 : 16) + gl + (lines - 1) * FONT.line.L);
    let w = toastChrome(S) + tw;
    w += w % 2;
    spec.size = { lim: L, tw, lines, w, h, parts };
    return spec.size;
  }

  /**
   * The corner panels the toasts keep out of, in the screen's art px (x from the root's left, y
   * from its top): the HUD's own corner groups (the place plate and the clock from their frame
   * boxes; the legend) and the groups other components hang in it at a corner (the vitals, the
   * party frames, the minimap, the skill bar), read from the page, each on its side of the screen.
   * Panels that are empty or hidden are left out.
   * @param {import('./UiScale.js').ArtScale|null} sc
   * @param {number} s the corner groups' shrink
   * @returns {{ l: number, t: number, r: number, b: number, side: 'l'|'r', plate?: boolean }[]}
   */
  _panels(sc, s) {
    const artW = sc?.artW ?? 640;
    /** @type {{ l: number, t: number, r: number, b: number, side: 'l'|'r', plate?: boolean }[]} */
    const out = [];
    const root = this._toasts.parentElement;
    const rr = sc && root ? root.getBoundingClientRect() : null;
    for (const el of /** @type {HTMLElement[]} */ ([...this.element.children])) {
      const a = el.dataset?.anchor;
      if (!a || !/^[tb][lr]$/.test(a)) continue;
      const c = el.classList;
      if (c.contains('is-empty') || c.contains('is-hidden')) continue;
      const side = a[1] === 'l' ? 'l' : 'r';
      const box = el === this._loc ? this._locBox : el === this._clock ? this._clockBox : null;
      if (box) {
        // (the frame box, not the page: a new place slides in from 6 art px to the left)
        const [x, y, w, h] = box;
        const l = side === 'l' ? x * s : artW - (640 - x) * s;
        out.push({ l, t: y * s, r: l + w * s, b: (y + h) * s, side, plate: el === this._loc });
        continue;
      }
      if (!rr || !sc) continue;
      const b = el.getBoundingClientRect();
      if (!(b.width > 0 && b.height > 0)) continue;
      const k = sc.cssPx;
      out.push({ l: (b.left - rr.left) / k, t: (b.top - rr.top) / k, r: (b.right - rr.left) / k, b: (b.bottom - rr.top) / k, side });
    }
    return out;
  }

  /**
   * Lay the toast stack out (on a new or expired toast, the banner's card coming or going, a new
   * place, the scale, the fonts): the toasts share one centre line in the span the corner panels
   * beside the stack leave free — the screen's (the banner's) where the widest toast keeps
   * `TOAST_AIR` from the panels, else moved toward the span's middle as far as it needs — and wrap
   * their text to that span less `TOAST_AIR` each side (at most their kind's maxW); top-down from
   * y 10 with 2 art px between toasts, a toast that would reach into the banner's card placed
   * under it. The span is the one for the whole stack's height (found in a few passes: a taller
   * stack meets more panels); a side with no panel mirrors the other's margin. Beside a long place
   * plate, where a toast's text would have less than `TOAST_MIN_TEXT` art px, the stack starts
   * under the plate instead. In the shrunk HUD (below 1024 × 600) the toasts shrink with the
   * corner groups.
   */
  _layoutToasts() {
    if (this._disposed || !this._toastSpecs.size) return;
    const els = /** @type {HTMLElement[]} */ ([...this._toasts.children]).filter((el) => this._toastSpecs.has(el));
    if (!els.length) return;
    const specs = els.map((el) => /** @type {ToastSpec} */ (this._toastSpecs.get(el)));
    const sc = currentScale(this.element);
    const s = sc?.cornerShrink || 1;
    const artW = sc?.artW ?? 640;
    const panels = this._panels(sc, s);
    const bn = this._banner;
    // the banner's card in screen art px (a 'tc' group: its fit scales it about the screen's top)
    const card = bn ? { t: bn.fit * bn.y - BANNER_AIR * s, b: bn.fit * (bn.y + bn.h) + BANNER_AIR * s } : null;
    /** @param {number} t @param {number} b the band's top and bottom */
    const span = (t, b) => {
      let L = 0, R = artW, l = false, r = false;
      for (const p of panels) {
        if (p.t >= b || p.b <= t) continue;
        if (p.side === 'l') { L = Math.max(L, p.r); l = true; } else { R = Math.min(R, p.l); r = true; }
      }
      if (l && !r) R = Math.max(L + 1, artW - L);
      else if (r && !l) L = Math.min(R - 1, artW - R);
      return [L, R];
    };
    /** @param {number} y0 the stack's top (screen art px) */
    const stack = (y0) => {
      let bot = y0 + 16 * s;
      /** @type {{ L: number, R: number, room: number, sizes: ToastSize[], ys: number[], bot: number }} */
      let res = { L: 0, R: artW, room: 0, sizes: [], ys: [], bot };
      for (let pass = 0; pass < 4; pass++) {
        const [L, R] = span(y0, bot);
        // the room for a toast, in its own (shrunk) art px
        const room = (R - L) / s - 2 * TOAST_AIR;
        const sizes = specs.map((sp) => this._toastSize(sp, room - toastChrome(TOAST_STYLE[sp.kind] ?? TOAST_STYLE[''])));
        const ys = [];
        let y = y0;
        for (const z of sizes) {
          if (card && y < card.b && y + z.h * s > card.t) y = card.b;
          ys.push(y);
          y += (z.h + TOAST_GAP) * s;
        }
        const nb = y - TOAST_GAP * s;
        res = { L, R, room, sizes, ys, bot: nb };
        if (nb <= bot + 1e-6) break;
        bot = nb;
      }
      return res;
    };
    let res = stack(TOAST_TOP * s);
    const plate = panels.find((p) => p.plate);
    if (plate && res.room - toastChrome(TOAST_STYLE.quest) < TOAST_MIN_TEXT && plate.r >= res.L - 1e-6) {
      const under = stack(plate.b + 4 * s);
      if (under.room > res.room) res = under;
    }
    // on the screen's centre line (the banner's) where the widest toast clears the panels by
    // TOAST_AIR; else moved toward the span's middle only as far as it needs
    const half = (Math.max(...res.sizes.map((z) => z.w)) * s) / 2 + TOAST_AIR * s;
    const lo = res.L + half, hi = res.R - half;
    const cx = lo > hi ? (res.L + res.R) / 2 : Math.min(Math.max(artW / 2, lo), hi);
    els.forEach((el, i) => {
      const spec = specs[i], z = res.sizes[i];
      if (spec.drawn !== z) this._renderToast(el, spec, z);
      // the stack's frame: screen art px over the shrink (.lu-toasts scales by it about the root's corner)
      const x = Math.round(cx / s - z.w / 2), y = Math.round(res.ys[i] / s);
      if (spec.x !== x) { el.style.left = U(x); spec.x = x; }
      if (spec.y !== y) { el.style.top = U(y); spec.y = y; }
    });
  }

  /**
   * One toast's art and text at its size (`_toastSize`).
   * @param {HTMLElement} el
   * @param {ToastSpec} spec
   * @param {ToastSize} z
   */
  _renderToast(el, spec, z) {
    const k = pal();
    const S = TOAST_STYLE[spec.kind] ?? TOAST_STYLE[''];
    el.replaceChildren();
    spec.drawn = z;
    const { w, h, tw, lines } = z;
    // the lead: a kind's 16 art px icon (2 of it over the band's fading end) or the left stud
    const F = 16, GAP = 5, lead = S.icon ? 14 : 5;
    el.style.width = U(w);
    el.style.height = U(h);
    const c = { band: k[S.band], top: k[S.top], bot: k[S.bot] };
    put(el, toastPlate(w, h, F, c), 0, 0, 1, 'lu-toast__plate').setAttribute('aria-hidden', 'true');
    const ramp = S.gem();
    if (S.icon) put(el, icon(S.icon), F - 2, Math.round((h - 16) / 2), 1, 'lu-toast__glyph').setAttribute('aria-hidden', 'true');
    else put(el, gemGlyph(1, ramp), F, Math.round(h / 2 - 2.5), 1, 'lu-toast__gem').setAttribute('aria-hidden', 'true');
    put(el, gemGlyph(1, ramp), w - F - 5, Math.round(h / 2 - 2.5), 1, 'lu-toast__gem').setAttribute('aria-hidden', 'true');
    let x = F + lead + GAP;
    const o = { font: /** @type {'line'} */ ('line'), color: k[S.color], drop: true, cls: 'lu-toast__text' };
    if (z.parts) {
      // text runs and G's keycaps (11 art px, centred on the band) in a row
      const ky = Math.round(h / 2 - 5.5);
      z.parts.forEach((p, i) => {
        if (i) x += KEY_GAP;
        if (p.key != null) x += key(el, p.key, x, ky, { cls: 'lu-toast__key' });
        else { txc(el, p.text, x, h / 2, o); x += measure(p.text, 'line'); }
      });
    } else if (lines > 1) {
      const lh = FONT.line.L;
      txt(el, spec.text, x, h / 2 - ((lines - 1) * lh) / 2 - capMid('line'), { ...o, maxW: tw });
    } else txc(el, spec.text, x, h / 2, o);
  }
}
