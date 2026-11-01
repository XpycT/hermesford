import './party.css';
import { pal, GEMS, gemRamp } from './art/palette.js';
import { art } from './art/painter.js';
import { bar, gemGlyph, band, hairline } from './art/pieces.js';
import { put } from './layout/layout.js';
import { txt, txc, measure, capMid, cjk, UP, roles, roleFonts, FONT } from './layout/type.js';
import { onScale, currentScale } from './UiScale.js';
import { currentFonts } from './FontLoader.js';
import { t, sep } from '../i18n/I18n.js';

/**
 * @import { PartyFramesLike, PartyFrameEntry } from '../../game/party/types.js'
 */

// ---- colours (a member's colour comes from its level object: untrusted) ----------------------

/** The colour a member without a usable one gets (the name plate's default gold). */
const DEFAULT_COLOR = '#c9a45c';
/** @type {CanvasRenderingContext2D|null|undefined} */
let colorCtx;

/**
 * A CSS colour from level data, safe to put into a style: the canvas parses it (any CSS colour
 * syntax: hex, a name, rgb(), hsl() …) and gives it back as `#rrggbb` (opaque; alpha dropped), so
 * nothing but a colour — no `url()`, no `;` — can reach the CSS. Anything it cannot parse (or a
 * non-string) is `fallback`.
 * @param {unknown} c
 * @param {string} [fallback]
 * @returns {string} '#rrggbb'
 */
export function safeColor(c, fallback = DEFAULT_COLOR) {
  if (typeof c !== 'string') return fallback;
  const s = c.trim();
  if (!s || s.length > 64) return fallback;
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (colorCtx === undefined) colorCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (!colorCtx) return fallback;
  // (an invalid value leaves fillStyle as it was: two sentinels tell "invalid" from a real colour)
  colorCtx.fillStyle = '#010203';
  colorCtx.fillStyle = s;
  const a = colorCtx.fillStyle;
  colorCtx.fillStyle = '#030201';
  colorCtx.fillStyle = s;
  const b = colorCtx.fillStyle;
  if (a !== b || typeof a !== 'string') return fallback;
  if (a[0] === '#') return a.toLowerCase();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(a);
  if (!m) return fallback;
  return `#${[m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('')}`;
}

/** @param {string} hex '#rrggbb' @returns {[number, number, number]} */
function rgbOf(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance (WCAG) of an sRGB colour. @param {[number, number, number]} c */
function luminance(c) {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * A member's colour for text on the panels' dark navy: as it is when it reads well (luminance ≥
 * 0.22: a contrast of about 5 : 1 on the panel), else mixed toward the UI's cream until it does.
 * @param {string} hex '#rrggbb' (from `safeColor`)
 * @returns {string} 'rgb(r, g, b)' or the colour as given
 */
export function readableColor(hex) {
  const c = rgbOf(hex);
  if (luminance(c) >= 0.22) return hex;
  const cream = [243, 234, 215];
  for (let k = 0.1; k <= 1.0001; k += 0.1) {
    const m = /** @type {[number, number, number]} */ (c.map((v, i) => Math.round(v + (cream[i] - v) * k)));
    if (luminance(m) >= 0.22) return `rgb(${m[0]}, ${m[1]}, ${m[2]})`;
  }
  return 'rgb(243, 234, 215)';
}

/**
 * A member's gem ramp [dark, mid, light] from its (checked) colour: the colour as the mid tone.
 * @param {string} hex '#rrggbb'
 */
export const memberRamp = (hex) => gemRamp(hex);

/** A FontFace's unicode-range as [lo, hi] pairs (parsed once per face). @type {WeakMap<FontFace, [number, number][]>} */
const RANGES = new WeakMap();
/** @param {FontFace} face */
function rangesOf(face) {
  let r = RANGES.get(face);
  if (!r) {
    r = [];
    for (const part of String(face.unicodeRange || 'U+0-10FFFF').split(',')) {
      const m = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part.trim());
      if (!m) continue;
      const lo = parseInt(m[1].replace(/\?/g, '0'), 16);
      const hi = parseInt(m[2] ?? m[1].replace(/\?/g, 'f'), 16);
      if (Number.isFinite(lo) && Number.isFinite(hi)) r.push([lo, hi]);
    }
    RANGES.set(face, r);
  }
  return r;
}
/** A CSS font-weight (or a variable face's range "100 900") holds one of `ws`. @param {string} w @param {Set<number>} ws */
function weightIn(w, ws) {
  const n = String(w).trim().split(/\s+/).map((x) => (x === 'normal' ? 400 : x === 'bold' ? 700 : Number(x)));
  const lo = n[0], hi = n[1] ?? n[0];
  if (!Number.isFinite(lo)) return true;
  for (const v of ws) if (v >= lo && v <= hi) return true;
  return false;
}

/**
 * The fonts a text needs are not all in yet (a CJK slice not loaded): measure again once
 * `ensure()` has them. Reads the faces themselves — a FontFace of a type role's family and weight
 * whose unicode-range covers a character of `text` past Latin-1 (the pixel faces and their Jersey
 * aliases, loaded at the start, hold those) and is not loaded — since `document.fonts.check()`
 * answers true for slices still unloaded where the face is also installed on the system (Noto Sans
 * SC). A face that failed to load counts as in (nothing more to wait for). False without a font
 * API. (FontLoader's `fontsIn` does the same per font once it is there; the story UI has its own
 * copy: Journal.js `fontsMissing`.)
 * @param {string} text
 */
export function fontsMissing(text) {
  if (!text || typeof document === 'undefined' || !document.fonts) return false;
  /** @type {Set<number>} */
  const cps = new Set();
  for (const ch of text) {
    const c = /** @type {number} */ (ch.codePointAt(0));
    if (c > 0xff) cps.add(c);
  }
  if (!cps.size) return false;
  /** @type {Map<string, Set<number>>} family → weights the roles set it in */
  const want = new Map();
  for (const r of Object.values(roles())) {
    for (const fam of r.family.split(',')) {
      const name = fam.trim().replace(/^["']|["']$/g, '');
      if (!want.has(name)) want.set(name, new Set());
      want.get(name).add(Number(r.w) || 400);
    }
  }
  try {
    for (const face of document.fonts) {
      if (face.status === 'loaded' || face.status === 'error') continue;
      const ws = want.get(face.family.replace(/^["']|["']$/g, ''));
      if (!ws || !weightIn(face.weight, ws)) continue;
      for (const [lo, hi] of rangesOf(face)) for (const c of cps) if (c >= lo && c <= hi) return true;
    }
  } catch { return false; }
  return false;
}

/**
 * Load the faces `text` needs (`fontsMissing`): FontLoader's `ensure`, and each role's font asked
 * for the text itself (`document.fonts.load`: it loads a matching slice whatever `check()` says).
 * Never rejects.
 * @param {string} text
 * @returns {Promise<void>}
 */
export function loadFonts(text) {
  /** @type {Promise<unknown>[]} */
  const jobs = [currentFonts()?.ensure(text) ?? Promise.resolve()];
  if (typeof document !== 'undefined' && document.fonts) {
    for (const f of roleFonts()) jobs.push(document.fonts.load(f, text).catch(() => []));
  }
  return Promise.all(jobs).then(() => {}, () => {});
}

/** A role's ink height (cap height; 回 for CJK) in art px at the type's scale now (`inkH` is --px 2's). @param {import('./layout/type.js').RoleId} font */
export const inkNow = (font) => { roles(); return FONT[font].ink * FONT[font].unit; };

/**
 * A member's name as the strip shows it: whole when its capitals fit `max` art px (the small role,
 * tracked), else cut with an ellipsis (the text keeps its own case: capitals by CSS).
 * @param {string} name @param {number} max
 */
function cutName(name, max) {
  if (measure(UP(name), 'small', 1) <= max) return name;
  let a = [...name];
  while (a.length > 1 && measure(UP(`${a.join('').trimEnd()}…`), 'small', 1) > max) a = a.slice(0, -1);
  return `${a.join('').trimEnd()}…`;
}

// ---- the frames --------------------------------------------------------------------------------

/** @param {unknown} v @returns {string} */
const str = (v) => {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  try { return String(v); } catch { return ''; }
};
/** @param {number} v */
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);

/** Short or wide windows, where the controls legend (bottom-left, growing up) reaches the frames. */
const COMPACT = '(max-height: 680px), (min-aspect-ratio: 2/1)';

/** The strip's columns (art px, G's partyFrame): the text and bars from TX, the numbers from NX. */
const TX = 13;
const BW = 48;
const NX = TX + BW + 3;
/**
 * The name and what follows it on the strip's line (Lv, · class · tactic) take at most NAME_LINE
 * art px together; a name longer than that leaves is cut (NAME_MIN of it at least).
 */
const NAME_LINE = 155;
const NAME_MIN = 40;
/** Art px between two members' strips, and under the anchor. */
const GAP = 2;
const UNDER = 4;
/** The chip (HP just lost, pale) holds this long (s), then drains at CHIP_RATE of the bar per s. */
const CHIP_HOLD = 0.35;
const CHIP_RATE = 0.9;

/**
 * What a frame shows that sets its layout (a change re-lays out every strip: they share a width).
 * @typedef {{ name: string, cls: string, tactic: string, level: string, color: string, bars: boolean, hpMax: number, mpMax: number }} FrameLook
 */

/**
 * One member's frame and what it shows now (each write happens only on a change).
 * @typedef {object} Frame
 * @property {string} id
 * @property {HTMLElement} el
 * @property {FrameLook} look
 * @property {number} hp shown HP (rounded up)
 * @property {number} mp shown MP
 * @property {number} hv HP fraction now
 * @property {number} chip the chip's fraction (≥ hv)
 * @property {number} hold the time (s) the chip starts to drain
 * @property {number} hpx HP fill in bar pixels (-1: not painted)
 * @property {number} cpx chip in bar pixels
 * @property {number} mpx MP fill in bar pixels
 * @property {boolean} down
 * @property {boolean} low
 * @property {boolean} fighting
 * @property {HTMLCanvasElement|null} hpBar
 * @property {HTMLCanvasElement|null} lowBar
 * @property {HTMLCanvasElement|null} mpBar
 * @property {Text|null} hpText
 * @property {Text|null} mpText
 * @property {HTMLElement|null} hpNum
 */

/** @param {number} n art px as CSS */
const U = (n) => `calc(var(--px) * ${n})`;

/**
 * PartyFrames — the party's HUD (`.lu-pframes`, docs/specs/PARTY.md §6.2, docs/specs/PIXEL_UI.md
 * §5), created by `UI.usePartyUI()`: one slim strip per member after mockup G's `partyFrame` — no
 * portrait: on today's dark band fading out to the right, the member's gem (its colour), its NAME
 * in small capitals in its colour, `Lv` and the level, then `· class · tactic`; on combat levels (an
 * entry with `hp`) under that line the HP bar (48 × 4 art px) over the MP bar (48 × 3) with both
 * numbers side by side (MP in blue). Down: *DOWN* in small red in place of class · tactic, the gem
 * dusk, the bars dim. Low HP (≤ 25 %): the HP numbers red, the bar's empty part blinking red.
 * Fighting: the gem blinks bright. Inside the HUD (`.lu-hud`), so it hides with it; dims to 0.55
 * during a dialog like the vitals.
 *
 * Placement: under the player's vitals on a combat level (the UI root has `lu-root--combat`), else
 * under the location plate — its left edge, 4 art px under its bottom; measured when the frames
 * first show, when the combat comes or goes, on a resize or a scale change and when the anchor's
 * size changes (a ResizeObserver: after layout, no forced layout per frame). It shrinks with the
 * HUD's corner groups under 1024 × 600 device px (a 'tl' group: `--shrink-corner`, UiScale.js
 * `cornerShrink`). A strip is 22 art px tall in English at --px 2 (CJK: 24; at --px 3, where the
 * half-size text is ⅔ of an art px per font pixel, 24), 13 without bars (15), 2 apart: the rows
 * follow the text's ink at the scale. Short or wide windows (≤ 680 px tall or 2 : 1): compact —
 * the HP bar alone, 16 art px (18), 1 apart, so three members clear the controls legend. A long
 * name is cut with an ellipsis (`NAME_LINE`: the name and the rest of its line at most 155 art px).
 *
 * `update(list)` is cheap every frame: it compares with what it shows and writes the DOM only on a
 * change (a member joined or left, a name, a tactic, a state; a new HP / MP number). The bars are
 * canvases repainted in place (no DOM write), the chip of HP just lost draining in whole bar pixels.
 *
 * @implements {PartyFramesLike}
 */
export class PartyFrames {
  /**
   * @param {HTMLElement} root the UI root (`#luminati-ui`; the frames go into its HUD) or the HUD
   *   element itself
   */
  constructor(root) {
    const hud = /** @type {HTMLElement|null} */ (root.querySelector?.(':scope > .lu-hud')) ?? root;
    const el = document.createElement('div');
    // (a 'tl' group of the pixel UI: base.css shrinks it below 1280 × 720 about the root's corner)
    el.className = 'lu-pframes is-empty g grp';
    el.dataset.anchor = 'tl';
    el.setAttribute('aria-hidden', 'true');
    hud.appendChild(el);
    this.element = el;
    this._hud = hud;
    /** @type {HTMLElement|null} the UI root (its `lu-root--combat` class says where the frames sit) */
    this._ui = /** @type {HTMLElement|null} */ (hud.closest?.('.lu-root')) ?? null;
    /** @type {Frame[]} */
    this._frames = [];
    this._visible = true;
    this._empty = true;
    this._combat = false;
    /** the frames need a new layout (a look changed, the scale, the fonts, compact) */
    this._dirty = true;
    /** @type {HTMLElement|null} */
    this._anchor = null;
    this._mq = typeof matchMedia === 'function' ? matchMedia(COMPACT) : null;
    this._compact = !!this._mq?.matches;
    /** the last update's time (s), for the chip */
    this._now = 0;
    /** @type {Set<string>} texts whose fonts were asked for (`FontLoader.ensure`) */
    this._ensured = new Set();
    this._place = () => {
      const c = !!this._mq?.matches;
      if (c !== this._compact) { this._compact = c; this._dirty = true; this._layout(); }
      this._measure();
    };
    window.addEventListener('resize', this._place);
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this._measure()) : null;
    this._offScale = onScale(hud, () => { this._dirty = true; this._layout(); this._measure(); });
    // the fonts in (the first frames can come before them): measure again
    currentFonts()?.ready.then(() => { if (this._frames.length) { this._dirty = true; this._layout(); this._measure(); } });
  }

  /** Shown now: it has members and is not hidden (`setVisible`). */
  get visible() { return this._visible && !this._empty; }

  /**
   * Show these members, in order ([] hides the frames). Cheap to call every frame.
   * @param {PartyFrameEntry[]} list
   */
  update(list) {
    const arr = Array.isArray(list) ? list : [];
    const combat = !!this._ui && this._ui.classList.contains('lu-root--combat');
    let moved = false;
    if (combat !== this._combat) {
      this._combat = combat;
      this.element.classList.toggle('is-combat', combat);
      moved = true;
    }
    // the members (by id, in order): frames kept, made, removed only when that changes
    let same = arr.length === this._frames.length;
    for (let i = 0; same && i < arr.length; i++) if (this._frames[i].id !== str(arr[i]?.id)) same = false;
    if (!same) { this._rebuild(arr); this._dirty = true; }
    // what sets the layout first (one new layout for every strip), then the values
    for (let i = 0; i < arr.length; i++) if (this._look(this._frames[i], arr[i])) this._dirty = true;
    if (this._dirty) { this._layout(); moved = true; }
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const dt = this._now ? Math.min(0.25, Math.max(0, now - this._now)) : 0;
    this._now = now;
    for (let i = 0; i < arr.length; i++) this._set(this._frames[i], arr[i], now, dt);
    const empty = this._frames.length === 0;
    if (empty !== this._empty) {
      this._empty = empty;
      this.element.classList.toggle('is-empty', empty);
      if (!empty) moved = true;
    }
    if (moved && !empty) this._retarget();
  }

  /**
   * Hide (photo mode, cutscenes, the title) / show again (fades).
   * @param {boolean} on
   */
  setVisible(on) {
    const v = !!on;
    if (v === this._visible) return;
    this._visible = v;
    this.element.classList.toggle('is-hidden', !v);
  }

  dispose() {
    window.removeEventListener('resize', this._place);
    this._ro?.disconnect();
    this._ro = null;
    this._offScale();
    this._frames = [];
    this.element.remove();
  }

  // ------------------------------------------------------------------------------------------

  /** @param {PartyFrameEntry[]} arr */
  _rebuild(arr) {
    /** @type {Map<string, Frame>} */
    const old = new Map(this._frames.map((f) => [f.id, f]));
    /** @type {Frame[]} */
    const next = [];
    for (const e of arr) {
      const id = str(e?.id);
      let f = old.get(id);
      if (f) old.delete(id);
      else f = this._make(id);
      next.push(f);
    }
    for (const f of old.values()) f.el.remove();
    // (in order: appendChild moves a frame that is already there)
    for (const f of next) this.element.appendChild(f.el);
    this._frames = next;
  }

  /** @param {string} id @returns {Frame} */
  _make(id) {
    const el = document.createElement('div');
    el.className = 'lu-pframe';
    return {
      id, el,
      look: { name: '', cls: '', tactic: '', level: '', color: '', bars: false, hpMax: 0, mpMax: 0 },
      hp: -1, mp: -1, hv: 1, chip: 1, hold: 0, hpx: -1, cpx: -1, mpx: -1,
      down: false, low: false, fighting: false,
      hpBar: null, lowBar: null, mpBar: null, hpText: null, mpText: null, hpNum: null,
    };
  }

  /**
   * Take what sets a frame's layout from its entry; true when that changed.
   * @param {Frame} f @param {PartyFrameEntry} e
   */
  _look(f, e) {
    const L = f.look;
    const name = str(e?.name) || f.id;
    const cls = str(e?.cls);
    const tactic = str(e?.tactic);
    const lv = Number(e?.level);
    const level = Number.isFinite(lv) ? String(Math.max(0, Math.round(lv))) : '';
    const color = str(e?.color);
    const hp = Number(e?.hp);
    const hpMaxN = Number(e?.hpMax);
    const bars = Number.isFinite(hp) && Number.isFinite(hpMaxN);
    const hpMax = bars ? Math.max(0, Math.round(hpMaxN)) : 0;
    const mpMaxN = Number(e?.mpMax);
    const mpMax = bars && Number.isFinite(mpMaxN) ? Math.max(0, Math.round(mpMaxN)) : 0;
    if (name === L.name && cls === L.cls && tactic === L.tactic && level === L.level && color === L.color && bars === L.bars && hpMax === L.hpMax && mpMax === L.mpMax) return false;
    f.look = { name, cls, tactic, level, color, bars, hpMax, mpMax };
    return true;
  }

  /**
   * Lay every strip out again (G's `partyFrame`), all as wide as the widest: a member's look, the
   * scale, the language's fonts or the compact mode changed. The strips' own class lists (their
   * states) are kept; only their children are made again.
   */
  _layout() {
    this._dirty = false;
    const frames = this._frames;
    if (!frames.length) return;
    const k = pal();
    const compact = this._compact;
    const up = !cjk();
    const sp = sep();
    const lvTxt = t('party.frame.lv');
    const downTxt = t('party.frame.down');
    // the text line from its ink at this scale (5 art px in English at --px 2, 6⅔ at --px 3 where
    // the half-size line is ⅔ of an art px per font pixel; 7 in CJK), the bars 3 art px under it
    const ri = Math.max(5, inkNow('small'), inkNow('line'));
    // (compact: tighter — the line 3 art px from the top, the bar 2 under it, 1 between strips)
    const top = compact ? 3 : 4;
    const rc = top + ri / 2;
    const hb = Math.round(top + ri + (compact ? 2 : 3));
    const gap = compact ? 1 : GAP;
    // the widths: the line (name, level, separator, class · tactic or DOWN) and the bars' row
    const rows = frames.map((f) => {
      const L = f.look;
      const lvw = L.level ? measure(lvTxt, 'tiny') : 0;
      const lnw = L.level ? measure(L.level, 'num') : 0;
      const lvPart = L.level ? 4 + lvw + 2 + lnw : 0;
      const sepw = measure(sp, 'line');
      const sub = [L.cls, L.tactic].filter(Boolean).join(sp);
      const subw = sub ? measure(sub, 'line') : 0;
      const dw = L.bars ? measure(up ? UP(downTxt) : downTxt, 'small', 1) : 0;
      const rest = lvPart + (sub || L.bars ? sepw + Math.max(subw, dw) : 0);
      // the name: as long as the line leaves it (NAME_LINE in all; NAME_MIN at least), else cut
      const shownName = cutName(L.name, Math.max(NAME_MIN, NAME_LINE - rest));
      const nmw = measure(UP(shownName), 'small', 1);
      const sx = TX + nmw + lvPart;
      const hpw = L.bars ? measure(`${L.hpMax}/${L.hpMax}`, 'num') : 0;
      const mpw = L.bars && !compact ? measure(`${L.mpMax}/${L.mpMax}`, 'num') : 0;
      const line = sx + (sub || L.bars ? sepw + Math.max(subw, dw) : 0);
      const bars = L.bars ? NX + hpw + (compact ? 0 : 5 + mpw) : 0;
      const h = L.bars ? (compact ? hb + 4 + 2 : hb + 6 + 4) : Math.round(4 + ri + 4);
      return { name: shownName, nmw, lvw, sx, sepw, sub, hpw, h, w: Math.max(line, bars) + 16 };
    });
    const w = Math.max(96, ...rows.map((r) => r.w));
    let y = 0;
    frames.forEach((f, i) => {
      const L = f.look;
      const R = rows[i];
      const el = f.el;
      el.textContent = '';
      el.style.top = U(y);
      el.style.width = U(w);
      el.style.height = U(R.h);
      const safe = safeColor(L.color);
      const text = readableColor(safe);
      el.style.setProperty('--lu-member', safe);
      el.style.setProperty('--lu-member-text', text);
      // today's dark band, fading out over the last part of the strip, a gilt hairline under it
      put(el, band(w, R.h, 0.82, 0.68, 0.6), 0, 0, 1, 'lu-pframe__band');
      put(el, hairline(Math.round(w * 0.84)), 0, R.h - 1, 1, 'lu-pframe__rule');
      // the member's gem; dusk while down; a bright one blinking over it while it fights
      const ramp = memberRamp(safe);
      const gy = Math.round(rc - 3.5);
      put(el, gemGlyph(2, ramp), 4, gy, 1, 'lu-pframe__chip');
      put(el, gemGlyph(2, GEMS.dusk(), { setting: [k.dm1, k.dm2, k.dm3] }), 4, gy, 1, 'lu-pframe__chip lu-pframe__chip--down');
      put(el, gemGlyph(2, [ramp[1], ramp[2], k.tx1], { setting: [k.g5, k.g5, k.g4] }), 4, gy, 1, 'lu-pframe__glow breathe');
      // NAME Lv 7 · Warden · Balanced (or · DOWN); a name cut to fit keeps its whole self as the
      // element's title (the text shown is the cut one; capitals by CSS)
      const nameEl = txc(el, R.name, TX, rc, { font: 'small', track: 1, color: text, drop: true, cls: `lu-pframe__name${up ? ' lu-party-caps' : ''}` });
      if (R.name !== L.name) nameEl.title = L.name;
      if (L.level) {
        const lx = TX + R.nmw + 4;
        txc(el, lvTxt, lx, rc, { font: 'tiny', color: k.g4, drop: true, cls: 'lu-pframe__lv' });
        txc(el, L.level, lx + R.lvw + 2, rc, { font: 'num', color: k.g5, drop: true, cls: 'lu-pframe__lvn' });
      }
      if (R.sub || L.bars) txc(el, sp, R.sx, rc, { font: 'line', color: k.tx2, drop: true, cls: 'lu-pframe__sep pre' });
      txc(el, R.sub, R.sx + R.sepw, rc, { font: 'line', color: k.tx2, drop: true, cls: 'lu-pframe__sub' });
      txc(el, downTxt, R.sx + R.sepw, rc, { font: 'small', track: 1, color: k.hp3, drop: true, cls: `lu-pframe__down${up ? ' lu-party-caps' : ''}` });
      // the bars: HP (4 rows) over MP (3), sharing the ink row between them; the numbers side by side
      f.hpBar = f.lowBar = f.mpBar = null;
      f.hpText = f.mpText = null;
      f.hpNum = null;
      f.hpx = f.cpx = f.mpx = -1;
      f.hp = f.mp = -1;
      if (L.bars) {
        const bars = document.createElement('span');
        bars.className = 'lu-pframe__bars';
        el.appendChild(bars);
        f.hpBar = put(bars, art(BW, 4, () => {}), TX, hb, 1, 'lu-pframe__bar lu-pframe__bar--hp');
        f.lowBar = put(bars, art(BW, 4, () => {}), TX, hb, 1, 'lu-pframe__low breathe');
        if (!compact) f.mpBar = put(bars, art(BW, 3, () => {}), TX, hb + 3, 1, 'lu-pframe__bar lu-pframe__bar--mp');
        const ny = (compact ? hb + 2 : hb + 3) - capMid('num');
        const hpEl = txcPair(bars, '0', L.hpMax, NX, ny, k.tx1, 'lu-pframe__num lu-pframe__num--hp');
        f.hpNum = hpEl;
        f.hpText = /** @type {Text} */ (hpEl.firstChild);
        if (!compact) {
          const mpEl = txcPair(bars, '0', L.mpMax, NX + R.hpw + 5, ny, k.mp3, 'lu-pframe__num lu-pframe__num--mp');
          f.mpText = /** @type {Text} */ (mpEl.firstChild);
        }
      }
      y += R.h + gap;
    });
    this.element.style.width = U(w);
    this.element.style.height = U(Math.max(0, y - gap));
    // the fonts of what is shown now: lay out again once a missing CJK slice is in
    // (once per text: a face that failed to load stays "missing")
    const all = frames.map((f) => `${f.look.name}${f.look.cls}${f.look.tactic}`).join('') + downTxt;
    if (!this._ensured.has(all) && fontsMissing(all)) {
      this._ensured.add(all);
      loadFonts(all).then(() => { this._dirty = true; this._layout(); this._measure(); });
    }
  }

  /**
   * The values of a frame: states, numbers, bars (the DOM only where they changed).
   * @param {Frame} f @param {PartyFrameEntry} e @param {number} now @param {number} dt
   */
  _set(f, e, now, dt) {
    const L = f.look;
    const el = f.el;
    if (L.bars !== el.classList.contains('has-bars')) el.classList.toggle('has-bars', L.bars);
    const down = !!e?.down;
    if (down !== f.down) { f.down = down; el.classList.toggle('is-down', down); }
    const fighting = !!e?.fighting && !down;
    if (fighting !== f.fighting) { f.fighting = fighting; el.classList.toggle('is-fighting', fighting); }
    let low = false;
    if (L.bars) {
      const hpN = Number(e?.hp);
      const frac = L.hpMax > 0 ? clamp01(hpN / L.hpMax) : 0;
      // the chip: what was lost stays pale for a moment, then drains (healing: the fill jumps up)
      if (frac >= f.chip || f.hpx < 0) { f.chip = frac; f.hold = 0; }
      else if (frac < f.hv) { f.chip = Math.max(f.chip, f.hv); f.hold = now + CHIP_HOLD; }
      else if (now >= f.hold) f.chip = Math.max(frac, f.chip - CHIP_RATE * dt);
      f.hv = frac;
      const iw = BW - 2;
      const hpx = Math.round(iw * frac);
      const cpx = Math.round(iw * f.chip);
      if ((hpx !== f.hpx || cpx !== f.cpx) && f.hpBar) {
        f.hpx = hpx; f.cpx = cpx;
        paintHp(f, frac);
      }
      const hpShown = down ? 0 : Math.max(0, Math.ceil(Number.isFinite(hpN) ? hpN : 0));
      if (hpShown !== f.hp && f.hpText) { f.hp = hpShown; f.hpText.data = String(hpShown); }
      const mpN = Number(e?.mp);
      const mpFrac = Number.isFinite(mpN) && L.mpMax > 0 ? clamp01(mpN / L.mpMax) : 0;
      const mpx = Math.round(iw * mpFrac);
      if (mpx !== f.mpx && f.mpBar) { f.mpx = mpx; paintBar(f.mpBar, BW, 3, mpFrac, 'mp'); }
      const mpShown = Math.max(0, Math.ceil(Number.isFinite(mpN) ? mpN : 0));
      if (mpShown !== f.mp && f.mpText) { f.mp = mpShown; f.mpText.data = String(mpShown); }
      low = !down && hpN > 0 && frac <= 0.25;
    }
    if (low !== f.low) {
      f.low = low;
      el.classList.toggle('is-low', low);
      if (f.hpNum) f.hpNum.style.color = low ? pal().hp3 : pal().tx1;
    }
  }

  /** The anchor the frames sit under: the vitals on a combat level, else the location plate. */
  _retarget() {
    const vitals = this._combat ? /** @type {HTMLElement|null} */ (this._hud.querySelector(':scope > .lu-vitals')) : null;
    const anchor = vitals ?? /** @type {HTMLElement|null} */ (this._hud.querySelector(':scope > .lu-loc'));
    if (anchor !== this._anchor) {
      if (this._anchor) this._ro?.unobserve(this._anchor);
      this._anchor = anchor;
      if (anchor) this._ro?.observe(anchor);
    }
    this._measure();
  }

  /**
   * Put the frames under their anchor: its left edge, UNDER art px under its bottom (the bottom of
   * the anchor's box or of anything drawn inside it, whichever is lower). The element hangs from
   * the root's top-left corner, so it shrinks with the HUD's corner groups (`--shrink-corner`:
   * only under 1024 × 600 device px); its position is given unshrunk and snapped to whole device
   * pixels.
   */
  _measure() {
    const a = this._anchor;
    if (this._empty || !a || !a.isConnected) return;
    // the anchor's layout box (offsets up to the HUD: no transform of its own counts — a plate
    // sliding in on a new place, as today's `is-swap`, measures where it comes to rest) and the
    // bottom of anything laid out inside it
    const at = layoutBox(a, this._hud);
    if (!at) return;
    let bottom = at.y + a.offsetHeight;
    for (const c of a.querySelectorAll('*')) {
      const h = /** @type {HTMLElement} */ (c).offsetHeight;
      if (!h) continue;
      const b = layoutBox(/** @type {HTMLElement} */ (c), this._hud);
      if (b && b.y + h > bottom) bottom = b.y + h;
    }
    // the anchor's scale (a corner group of the pixel HUD shrinks about the root's corner; today's
    // plate does not): the frames land where it is drawn, under their own shrink
    const ar = a.getBoundingClientRect();
    const ratio = a.offsetWidth > 0 && ar.width > 0 ? ar.width / a.offsetWidth : 1;
    const s = currentScale(this._hud) ?? null;
    // (a 'tl' group: it follows the corner groups' scale, `cornerShrink` — 1 from 1024 × 600 up)
    const cs = s ? (s.cornerShrink ?? s.shrink) : 1;
    const shrink = this._ui?.getAttribute('data-lu-scale') === 'shrunk' && cs > 0 && cs < 1 ? cs : 1;
    const cssPx = s?.cssPx ?? 2;
    const dpr = s?.dpr ?? (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    const snap = (/** @type {number} */ v, /** @type {(n: number) => number} */ fn) => (shrink === 1 ? fn(v * dpr) / dpr : v);
    const left = snap((at.x * ratio) / shrink, Math.round);
    const top = snap((bottom * ratio) / shrink + UNDER * cssPx, Math.ceil);
    const st = this.element.style;
    const l = `${left}px`, tp = `${top}px`, o = `${-left}px ${-top}px`;
    if (st.left !== l) st.left = l;
    if (st.top !== tp) st.top = tp;
    if (st.transformOrigin !== o) st.transformOrigin = o;
  }
}

/**
 * An element's layout position (CSS px, before any transform or scale) relative to `root`: its
 * offsets summed up the offset parents; null when it is not laid out or not inside `root`.
 * @param {HTMLElement} el @param {HTMLElement} root
 * @returns {{ x: number, y: number }|null}
 */
function layoutBox(el, root) {
  let x = 0, y = 0;
  /** @type {Element|null} */
  let e = el;
  while (e && e !== root) {
    if (!(e instanceof HTMLElement) || (e.offsetParent === null && e !== root)) return null;
    x += e.offsetLeft;
    y += e.offsetTop;
    const p = /** @type {Element|null} */ (e.offsetParent);
    // (an offset parent outside the root: the root is not positioned — measure from it)
    if (p && p !== root && !root.contains(p)) {
      const rr = root.getBoundingClientRect(), pr = p.getBoundingClientRect();
      return { x: x + pr.left - rr.left, y: y + pr.top - rr.top };
    }
    e = p;
  }
  return e === root ? { x, y } : null;
}

/**
 * A value / max pair in the num role (G's numPair): the value one text node (written in place),
 * '/max' dimmer. Returns the element.
 * @param {HTMLElement} parent @param {string} a @param {number} b @param {number} x @param {number} y
 * @param {string} color @param {string} cls
 */
function txcPair(parent, a, b, x, y, color, cls) {
  return txt(parent, `${a}{/${b}}`, x, y, { font: 'num', color, kw: pal().tx2, drop: true, cls });
}

/** The bars' ramps (G's): HP's reds, MP's blues. */
const RAMPS = {
  hp: () => { const k = pal(); return [k.hp0, k.hp1, k.hp2, k.hp3]; },
  mp: () => { const k = pal(); return [k.mp0, k.mp1, k.mp2, k.mp3]; },
};

/**
 * Repaint a bar canvas in place (no DOM write).
 * @param {HTMLCanvasElement} c @param {number} w @param {number} h @param {number} v @param {'hp'|'mp'} kind
 * @param {number|null} [chip]
 */
function paintBar(c, w, h, v, kind, chip = null) {
  const src = art(w, h, (p) => bar(p, w, h, v, RAMPS[kind](), chip != null && chip > v ? { chip } : {}));
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0);
}

/** The HP bar (with its chip) and the low-HP overlay (deep red over the empty part). @param {Frame} f @param {number} frac */
function paintHp(f, frac) {
  if (!f.hpBar) return;
  paintBar(f.hpBar, BW, 4, frac, 'hp', f.chip);
  if (!f.lowBar) return;
  const ctx = f.lowBar.getContext('2d');
  ctx.clearRect(0, 0, BW, 4);
  const from = 1 + f.cpx;
  if (from < BW - 1) {
    ctx.fillStyle = '#7a1530';
    ctx.fillRect(from, 1, BW - 1 - from, 1);
    ctx.fillStyle = '#a8233a';
    ctx.fillRect(from, 2, BW - 1 - from, 1);
  }
}
