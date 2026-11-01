import './ui.css';
import './combat.css';
import { pal, GEMS } from './art/palette.js';
import { art } from './art/painter.js';
import { bar, rampRows, band, fade, rgbOf, ramp, BAND_STEPS, hairline, coin, glyph } from './art/pieces.js';
import { icon as combatIcon, SKILL_ICONS } from './art/icons/combat.js';
import { DUSK_ICON } from './art/icons/core.js';
import { veil, readyFlash, lockPlate, lootIcon, LOOT_KINDS } from './art/combat.js';
import { FONT, capMid, inkH, measure, txt, lines, nameParts, cjk, setOrigin, originOf, typePx } from './layout/type.js';
import { put, win, key, capW, U, setGroupFit } from './layout/layout.js';
import { onScale, currentScale, fpxFor } from './UiScale.js';
import { currentFonts } from './FontLoader.js';

/**
 * CombatHUD — the player's combat readouts inside the HUD (COMBAT.md §13.1–§13.2), drawn after
 * mockup G (docs/specs/PIXEL_UI.md §5, Combat): the vitals under the location plate (`.lu-vitals`:
 * "Lv" over the level numeral, HP / MP / SP in gold-ringed banded bars, the numbers, the thin gilt
 * XP bar, on today's fading band), the skill bar with the draught slot and the purse (`.lu-skills`,
 * bottom-right: 22 × 22 sockets with gold corner gems, the 16 × 16 icons, keycaps across the foot,
 * the name under the slot, the cooldown veil with its gold-dotted edge and the seconds — one
 * decimal under a second —, a locked slot's lock and "Lv N" plate, the draught count) and the loot
 * feed (`.lu-loot`, right edge above the skill bar: pooled rows on fading bands). Created by
 * `UI.enableCombat()` on combat levels only.
 *
 * Every setter is cheap to call every frame: it writes the DOM only on a change and never reads
 * layout (text is measured with canvas `measureText`). The bars' fills and lag fills are DOM
 * `scaleX` layers over the painted tracks, quantized to whole art pixels; the lag trails (CSS).
 * Sizes are art px of G's 640 × 360 frame (`--px`, layout/layout.js); the three panels are HUD
 * groups anchored to their corners and laid out again when the root's scale changes. The vitals
 * sit at a **fixed** place: under G's place plate (top 10, its two rows' ink: 36 art px down in
 * English, 42–43 in Japanese and Chinese) — the region name, subtitle or the plate's `is-empty`
 * state never move them. Strings come in translated (the HUD shows what it is given); HP, MP, SP,
 * Lv, G and key names stay Latin.
 *
 * At an odd --px the half-size type is ⅔ of an art px a font pixel (UiScale.js `fpxFor`: 1.33× G),
 * which the skill bar's art has no room for ('Radiant' ran into 'Healing' at 1920 × 1080, a digit
 * outgrew its keycap): there an English slot name and a keycap's digit take G's 5-art-px cap in a
 * Jersey face at whole device pixels instead (`slotNameFace`, `keyDigitFace`: Jersey 15 at one
 * device px a font pixel at --px 3, as the Japanese and Chinese lines' Latin there), and the slots
 * stand G's 30 art px apart, or as far as their names need to keep 2 art px between them beyond
 * their outlines (a long translated name).
 * While a dialogue is open the bar dims with the HUD (combat.css), or steps aside (`is-tight`) on a
 * screen too narrow for G's dialogue window beside it.
 */

const LOOT_POOL = 8;
/** The loot feed's rows: band height and pitch (art px). */
const LOOT_H = 11;
const LOOT_PITCH = 13;
/** The screen's right margin (art px): the purse, slots and loot rows end here. */
const X1 = 630;
/** G's slot pitch (art px): a 22-art-px socket and an 8-art-px gap. */
const SLOT_PITCH = 30;
/** The least gap between two neighbouring slot names, beyond their outlines (art px). */
const NAME_GAP = 2;
/**
 * G's dialogue window's right edge (DialogBox.js: x 10 + 496, from the bottom-left corner) and the
 * gap the skill bar keeps from it: on a narrower screen the bar steps aside during a dialogue
 * (`is-tight`) instead of dimming under the window.
 */
const DIALOG_RIGHT = 506;
const DIALOG_GAP = 4;

function clamp01(v) { return v > 0 ? (v < 1 ? v : 1) : 0; }

/** n art px as CSS, rounded down to a whole device pixel (layout.js group()'s centre anchors). */
const DPX = (expr) => `round(down, calc(${expr}), var(--lu-dpx, 1px))`;
/** n art px as CSS rounded to a whole device pixel (layout/type.js txt()'s text positions). */
const UR = (n) => `round(nearest, calc(var(--px) * ${n}), var(--lu-dpx, 1px))`;

/**
 * Anchor an element that persists as a HUD group (layout.js `group()`, for an element made once:
 * the world labels keep out of these boxes, UI.js hands them over at enableCombat). Its class list
 * keeps its own class first (`lu-vitals g grp`). A centred group that does not fit the screen is
 * scaled to fit as `group()` scales its own (layout.js `setGroupFit`: the death screen's content
 * could pass 512 art px at 1024 × 768); the components anchor again on every 'scale'.
 * @param {HTMLElement} el
 * @param {'tl'|'tc'|'tr'|'ml'|'mc'|'mr'|'bl'|'bc'|'br'} at
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {Element|null} [sc] an element in the UI root (default `el`: one not in the page yet
 *   reads the last root's scale)
 */
export function anchorGroup(el, at, x, y, w, h, sc = null) {
  w += w % 2; h += h % 2;
  setOrigin(el, [x, y]);
  el.dataset.anchor = at;
  el.classList.add('g', 'grp');
  const s = el.style;
  s.left = ''; s.right = ''; s.top = ''; s.bottom = '';
  s.width = U(w); s.height = U(h);
  const [v, hz] = at.split('');
  let ox, oy;
  if (hz === 'l') { s.left = U(x); ox = U(-x); }
  else if (hz === 'r') { s.right = U(640 - x - w); ox = `calc(100% + ${U(640 - x - w)})`; }
  else { s.left = DPX(`50% - ${U(w / 2)} + ${U(x + w / 2 - 320)}`); ox = `calc(50% - ${U(x + w / 2 - 320)})`; }
  if (v === 't') { s.top = U(y); oy = U(-y); }
  else if (v === 'b') { s.bottom = U(360 - y - h); oy = `calc(100% + ${U(360 - y - h)})`; }
  else { s.top = DPX(`50% - ${U(h / 2)} + ${U(y + h / 2 - 180)}`); oy = `calc(50% - ${U(y + h / 2 - 180)})`; }
  s.transformOrigin = `${ox} ${oy}`;
  setGroupFit(el, at, x, y, w, h, sc);
}

/**
 * A Jersey face at a whole number `k` of device px per font pixel (its pixels whole at any --px).
 * @typedef {{ family: string, face: string, em: number, L: number, mid: number, cap: number, k: number }} JerseyFace
 */
/**
 * The Jersey faces on their own pixel grids: the CSS stack (with the pixel glyphs: type.js
 * `fontTokens`), the face, em, line box, ink centre and cap in font pixels (type.js's 'num' / 'big').
 */
const JERSEY_FACES = Object.freeze([
  Object.freeze({ family: 'var(--lu-font-j10)', face: 'Jersey 10', em: 56 / 3, L: 18, mid: 9, cap: 10 }),
  Object.freeze({ family: 'var(--lu-font-j15)', face: 'Jersey 15', em: 27, L: 23, mid: 11.5, cap: 15 }),
]);

/**
 * The Jersey face and `k` for a cap of `want` device px: the largest cap at most `want` (`fit`:
 * text that must stay inside a drawn shape), else the nearest in proportion (a tie: the first).
 * @param {number} want
 * @param {boolean} fit
 * @returns {JerseyFace|null}
 */
function jerseyAt(want, fit) {
  /** @type {JerseyFace|null} */
  let best = null;
  let bd = Infinity;
  for (const f of JERSEY_FACES) {
    for (let k = 1; k <= 16; k++) {
      const cap = f.cap * k;
      if (fit && cap > want) break;
      const d = fit ? want - cap : Math.abs(Math.log(cap / want));
      if (d < bd - 1e-9) { bd = d; best = { ...f, k }; }
    }
  }
  return best;
}

/**
 * At an odd --px the half-size roles' font pixel is ⅔ of an art px (`fpxFor`), so G's 5-art-px
 * Latin cap (Jersey 10 at --fpx) grows to 6⅔ there. Where that does not fit the art, these give
 * the Jersey face and whole device-pixel size of G's cap instead (null: the role is G's: even --px):
 * - `keyDigitFace`: a keycap's digit (layout.js `key()` sets it in 'num' on the cap's face rows
 *   2–6): the largest cap at most 5 art px — --px 3: Jersey 15 at k 1 (15 device px, the height of
 *   Tiny5's letters beside it); --px 5: Jersey 10 at k 2;
 * - `slotNameFace`: a skill slot's name (the 'line' role, English) under G's 30-art-px pitch: the
 *   cap nearest 5 art px — --px 3: Jersey 15 at k 1, G's proportion exactly (as the Japanese and
 *   Chinese lines' Latin there: type.js `aliasSpecs`); --px 5: the role itself.
 * @param {number} px device px per art px
 * @returns {JerseyFace|null}
 */
export function keyDigitFace(px) {
  const P = Math.max(1, Math.round(px));
  return 10 * fpxFor(P) === 5 * P ? null : jerseyAt(5 * P, true);
}

/**
 * @param {number} px device px per art px
 * @returns {JerseyFace|null}
 */
export function slotNameFace(px) {
  const P = Math.max(1, Math.round(px));
  if (10 * fpxFor(P) === 5 * P) return null;
  const f = jerseyAt(5 * P, false);
  return f && !(f.face === 'Jersey 10' && f.k === fpxFor(P)) ? f : null;
}

/** @type {CanvasRenderingContext2D|null} */
let fctx = null;

/**
 * A string's advance in a Jersey face, in device px (canvas measureText, no kerning).
 * @param {string} str
 * @param {JerseyFace} f
 */
function faceAdvance(str, f) {
  if (!fctx) fctx = document.createElement('canvas').getContext('2d');
  fctx.font = `400 ${+(f.em * f.k).toFixed(4)}px "${f.face}"`;
  if ('fontKerning' in fctx) fctx.fontKerning = 'none';
  return Math.round(fctx.measureText(str).width);
}

/**
 * Set a `txt` element in a Jersey face (`keyDigitFace`, `slotNameFace`): its font, size and line
 * box in whole device px, its advance centred on cx and its cap on cy (art px of the frame), and
 * with `ol` an ink outline and drop of one font pixel (the 'line' role's `ol` + `drop`).
 * @param {HTMLElement} el
 * @param {string} str its text
 * @param {JerseyFace} f
 * @param {number} cx
 * @param {number} cy
 * @param {Element} parent the element it is in (its frame origin)
 * @param {boolean} [ol]
 */
function setFace(el, str, f, cx, cy, parent, ol = false) {
  const px = typePx();
  const adv = faceAdvance(str, f);
  const [ox, oy] = originOf(parent);
  // device px from the parent's origin: the advance's middle, the cap's top
  const left = Math.round((cx - ox) * px - adv / 2);
  const capTop = Math.round((cy - oy) * px - (f.cap * f.k) / 2);
  const top = capTop - Math.round((f.mid - f.cap / 2) * f.k);
  const D = (n) => (n === 0 ? '0' : `calc(var(--lu-dpx, 1px) * ${n})`);
  const s = el.style;
  s.fontFamily = f.family;
  s.fontSize = D(+(f.em * f.k).toFixed(4));
  s.lineHeight = D(f.L * f.k);
  s.left = D(left);
  s.top = D(top);
  if (ol) {
    const offs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 2], [1, 1], [-1, 1]];
    s.textShadow = offs.map(([dx, dy]) => `${D(dx * f.k)} ${D(dy * f.k)} 0 var(--g-ink0)`).join(', ');
  }
  el.classList.add('lu-jersey');
}

/**
 * A slot name's lines in a Jersey face (`slotNameFace`), broken between words to `maxW` art px.
 * @param {string} text
 * @param {JerseyFace} f
 * @param {number} maxW
 * @returns {string[]}
 */
function faceLines(text, f, maxW) {
  const px = typePx();
  const out = [];
  let cur = '';
  for (const w of String(text ?? '').split(/[ \u200b]+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && faceAdvance(next, f) / px > maxW) { out.push(cur); cur = w; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * A box at (x, y) art px of the frame inside `parent` (w × h, or no size), its children placed in
 * frame coordinates like a group's. `lu-flat`: no stacking context of its own (its pieces keep the
 * layers of layout/base.css: frame 0, art 1, text 2, gems 3, keycaps 4–5).
 * @param {Element} parent
 * @param {number} x
 * @param {number} y
 * @param {number|null} w
 * @param {number|null} h
 * @param {string} cls
 * @returns {HTMLDivElement}
 */
export function box(parent, x, y, w, h, cls) {
  const d = document.createElement('div');
  d.className = `${cls} g lu-flat`;
  const [ox, oy] = originOf(parent);
  d.style.left = U(x - ox);
  d.style.top = U(y - oy);
  if (w != null) d.style.width = U(w);
  if (h != null) d.style.height = U(h);
  setOrigin(d, [x, y]);
  parent.append(d);
  return d;
}

/**
 * A text kept and refilled (a number, the cooldown seconds): made with txt() at (x, y) — its role,
 * top and style fixed —, then `set(text)` writes the text and keeps it aligned about x (measured
 * with canvas measureText: no layout read).
 * @param {Element} parent
 * @param {number} x
 * @param {number} y
 * @param {import('./layout/type.js').TextOptions} o
 */
export function liveText(parent, x, y, o) {
  const el = txt(parent, '', x, y, o);
  const [ox] = originOf(parent);
  const font = o.font ?? 'body', track = o.track ?? 0, align = o.align ?? 'left';
  let cur = '';
  return {
    el,
    /** @param {unknown} text */
    set(text) {
      const s = String(text ?? '');
      if (s === cur) return;
      cur = s;
      el.textContent = s;
      if (align === 'left') return;
      const w = measure(s, font, track);
      const left = align === 'right' ? x - w : x - Math.floor(w / 2);
      el.style.left = UR(Math.round((left - ox) * 2) / 2);
    },
    get text() { return cur; },
  };
}

/**
 * Put `c` where `old` is (same layer, same place in the DOM) at (x, y) of `parent`.
 * @param {Element} parent
 * @param {Element|null} old
 * @param {HTMLCanvasElement} c
 * @param {number} x
 * @param {number} y
 * @param {string} cls
 */
function swap(parent, old, c, x, y, cls) {
  put(parent, c, x, y, 1, cls);
  if (old && old.parentNode === parent) old.replaceWith(c);
  return c;
}

/**
 * The keycaps of a slot: 'U/1' (either key: two caps) or one key.
 * @param {string|string[]} keys
 * @returns {string[]}
 */
function parseKeys(keys) {
  if (Array.isArray(keys)) return keys.map(String);
  const s = String(keys ?? '');
  if (s.length > 1 && s.includes('/')) return s.split('/').map((p) => p.trim()).filter(Boolean);
  return s ? [s] : [];
}

/**
 * A vitals bar (fill, lag fill, the fill's lit end, number): `q` the fill in whole art px (−1: not
 * written yet).
 * @typedef {object} VitalBar
 * @property {HTMLElement} row
 * @property {HTMLElement|null} fill
 * @property {HTMLElement|null} lag
 * @property {HTMLElement|null} cap
 * @property {number} iw  the fill's width (art px)
 * @property {number} q
 * @property {number} n
 * @property {number} max
 * @property {boolean} low
 * @property {Text|null} numText
 * @property {Text|null} maxText
 * @property {boolean} clip  a clip (the XP bar's gradient) instead of scaleX
 */

/**
 * One skill-bar slot built by configureSkills: `vh` (veil height), `s` (seconds text), `cd`,
 * `locked` and `poor` cache the last written state; `flip` / `nope` alternate the two identical
 * keyframes that restart the ready flash / refuse shake.
 * @typedef {object} SkillSlot
 * @property {HTMLDivElement} el
 * @property {Element} box
 * @property {HTMLElement} veil  the veil's window (`.lu-skill__veil`)
 * @property {HTMLElement} veilArt  the veil itself, slid down inside it
 * @property {ReturnType<typeof liveText>} secs
 * @property {ReturnType<typeof liveText>} count
 * @property {boolean} draught
 * @property {number} vh
 * @property {number} s  the seconds shown, as a code (whole seconds × 10, or tenths; 0: none; −1: not written)
 * @property {boolean} cd
 * @property {boolean} locked
 * @property {boolean} poor
 * @property {boolean} flip
 * @property {boolean} nope
 */

/**
 * The last state of a slot (re-applied after a re-layout).
 * @typedef {{ cooldown: number, seconds: number, left: number|null, locked: boolean, affordable: boolean }} SlotState
 */

/**
 * A skill slot's definition (`configureSkills`).
 * @typedef {object} SkillDef
 * @property {string} id
 * @property {string} label the name under the slot (translated by the caller)
 * @property {string|string[]} keys keycaps ('U/1')
 * @property {'whirl'|'bolt'|'nova'|'tempest'|'dragonfang'|'skyfall'|'peal'|'toll'|'carillon'|'draught'} icon the
 *   traveler's skills, the swordmaster's (DRAGON_CAMPAIGN.md §6.8), the bellwarden's
 *   (EVERMERE_CAMPAIGN.md §5.5) or the draught (icons/combat.js `SKILL_ICONS`)
 * @property {number} [unlock] the level it opens at: a locked slot's "Lv N" plate (additive)
 */

export class CombatHUD {
  /**
   * @param {HTMLElement} hudElement the HUD root (`.lu-hud`)
   * @param {{ anchor?: HTMLElement | null }} [opts] anchor: the location plate (`.lu-loc`); kept for
   *   the API — the vitals' place follows G's plate (`_vitalsTop`)
   */
  constructor(hudElement, { anchor = null } = {}) {
    this.parent = hudElement;
    this.anchor = anchor;
    this._disposed = false;

    /** @type {HTMLDivElement} the vitals (top-left) */
    this._vitals = document.createElement('div');
    this._vitals.className = 'lu-vitals';
    /** @type {HTMLDivElement} the skill bar and the purse (bottom-right) */
    this._skillsEl = document.createElement('div');
    this._skillsEl.className = 'lu-skills';
    /** @type {HTMLDivElement} the loot feed (right edge, above the skill bar) */
    this._lootEl = document.createElement('div');
    this._lootEl.className = 'lu-loot';
    hudElement.append(this._vitals, this._skillsEl, this._lootEl);

    // ---- state (re-applied after every layout) ----
    /** @type {{ hp: number, hpMax: number, mp: number, mpMax: number, sp: number, spMax: number, level: number, xp: number, xpNext: number, winded: boolean }} */
    this._vit = { hp: 0, hpMax: 0, mp: 0, mpMax: 0, sp: 0, spMax: 0, level: 0, xp: 0, xpNext: 1, winded: false };
    this._vitSet = false;
    this._vHpMax = -1;
    this._vMpMax = -1;
    this._level = -1;
    this._winded = false;
    this._calm = false;
    /** @type {SkillDef[]} */
    this._defs = [];
    /** @type {SlotState[]} */
    this._state = [];
    /** @type {SkillSlot[]} */
    this._slots = [];
    this._potions = -1;
    this._potionsMax = -1;
    this._gold = 0;
    this._goldSet = false;
    this._goldFlip = false;
    this._purseW = -1;
    /** @type {{ el: HTMLElement, inner: HTMLElement, band: HTMLCanvasElement, ico: HTMLCanvasElement, t: HTMLElement, i: number, flip: boolean }[]} */
    this._loot = [];
    this._lootNext = 0;

    /**
     * Called with the slot index when a skill slot is clicked / tapped (primary button). The slots
     * catch the pointer (a click on one never reaches the canvas as an attack); null: a click
     * does nothing. (Additive to COMBAT.md §13.2.)
     * @type {((index: number) => void) | null}
     */
    this.onSlotPress = null;
    // one delegated listener for every slot (slots are rebuilt by configureSkills and re-layouts)
    this._skillsEl.addEventListener('pointerdown', (e) => {
      const el = e.target instanceof Element ? e.target.closest('.lu-skill__box') : null;
      if (!el) return;
      e.preventDefault();
      if (e.button !== 0) return;
      const i = this._slots.findIndex((sl) => sl.box === el);
      if (i >= 0) this.onSlotPress?.(i);
    });
    this._skillsEl.addEventListener('contextmenu', (e) => e.preventDefault());

    this._build();
    // laid out again when the root's scale changes (the type follows it) and once the fonts are in
    this._offScale = onScale(hudElement, () => this._build());
    currentFonts()?.ready.then(() => { if (!this._disposed) this._build(); });
  }

  /**
   * Every frame; writes on change.
   * @param {{ hp: number, hpMax: number, mp: number, mpMax: number, sp: number, spMax: number,
   *           level: number, xp: number, xpNext: number, winded: boolean }} v
   */
  setVitals(v) {
    if (!v) return;
    const s = this._vit;
    s.hp = v.hp; s.hpMax = v.hpMax; s.mp = v.mp; s.mpMax = v.mpMax; s.sp = v.sp; s.spMax = v.spMax;
    s.level = v.level; s.xp = v.xp; s.xpNext = v.xpNext; s.winded = !!v.winded;
    this._vitSet = true;
    // the band is as wide as the widest max pair: laid out again only when a max changes
    if (v.hpMax !== this._vHpMax || v.mpMax !== this._vMpMax) {
      this._vHpMax = v.hpMax;
      this._vMpMax = v.mpMax;
      if (this._vitalsWidth() !== this._vw) this._buildVitals();
    }
    this._applyVitals();
  }

  /**
   * Define the skill slots (three skills + the draught), in order.
   * @param {SkillDef[]} slots keys: keycaps (e.g. 'U/1'); unlock: the level a locked slot shows on
   *   its plate (additive)
   */
  configureSkills(slots = []) {
    this._defs = slots.map((d) => ({ ...d }));
    this._state = this._defs.map(() => ({ cooldown: 0, seconds: 0, left: null, locked: false, affordable: true }));
    this._buildSkills();
    // the slots' labels may need font slices (Japanese, Chinese): laid out again once they are in
    const fonts = currentFonts();
    if (fonts && this._defs.length) {
      const defs = this._defs;
      fonts.ensure(defs.map((d) => d.label)).then(() => { if (!this._disposed && this._defs === defs) this._buildSkills(); });
    }
  }

  /**
   * Every frame; writes on change.
   * @param {number} i slot index
   * @param {{ cooldown?: number, seconds?: number, left?: number, locked?: boolean, affordable?: boolean }} s
   *   cooldown: remaining fraction 0..1 (the veil); seconds: the seconds left, shown while cooling
   *   down (rounded up); left: the exact seconds left (additive: under one second the slot shows
   *   one decimal, "0.8"; default `seconds`)
   */
  setSkill(i, s) {
    const slot = this._slots[i];
    const st = this._state[i];
    if (!slot || !st || !s) return;
    st.cooldown = s.cooldown ?? 0;
    st.seconds = s.seconds ?? 0;
    st.left = Number.isFinite(s.left) ? s.left : null;
    st.locked = !!s.locked;
    st.affordable = s.affordable !== false;
    this._applySkill(slot, st);
  }

  /**
   * A refused press (locked, cooling down, not enough MP, no draught left): the slot shakes once
   * with a red rim (restarted by toggling two identical keyframes, like the ready flash).
   * @param {number} i slot index
   */
  refuse(i) {
    const slot = this._slots[i];
    if (!slot) return;
    slot.nope = !slot.nope;
    slot.el.classList.toggle('is-refuse-a', slot.nope);
    slot.el.classList.toggle('is-refuse-b', !slot.nope);
  }

  /**
   * @param {number} n draughts carried
   * @param {number} max carry cap
   */
  setPotions(n, max) {
    const c = Math.max(0, n | 0);
    const m = max | 0;
    if (c === this._potions && m === this._potionsMax) return;
    this._potions = c;
    this._potionsMax = m;
    this._applyPotions();
  }

  /** @param {number} n gold (the coin pops when it rises; not on the first call) */
  setGold(n) {
    const g = Math.max(0, Math.floor(n || 0));
    if (g === this._gold) { this._goldSet = true; return; }
    const up = g > this._gold && this._goldSet;
    this._goldSet = true;
    this._gold = g;
    this._layoutPurse();
    if (up && this._goldEl) {
      this._goldFlip = !this._goldFlip;
      this._goldEl.classList.toggle('is-up-a', this._goldFlip);
      this._goldEl.classList.toggle('is-up-b', !this._goldFlip);
    }
  }

  /**
   * Calm (5 s at full HP / MP, set by combat): the vitals dim to 35 %.
   * @param {boolean} on
   */
  setCalm(on) {
    const c = !!on;
    if (c === this._calm) return;
    this._calm = c;
    this._vitals.classList.toggle('is-calm', c);
  }

  /**
   * One loot-feed row (8 pooled rows; the newest at the bottom, older rows slide up and fade).
   * @param {string} text
   * @param {'gold'|'heart'|'mana'|'draught'|'upgrade'|'core'} kind
   */
  loot(text, kind = 'gold') {
    const k = LOOT_KINDS.includes(kind) ? kind : 'gold';
    const row = this._loot[this._lootNext];
    if (!row) return;
    this._lootNext = (this._lootNext + 1) % LOOT_POOL;
    for (const r of this._loot) {
      if (r === row || r.i >= LOOT_POOL) continue;
      r.i++;
      if (r.i === 1) r.el.classList.remove('is-new');
      r.el.style.setProperty('--i', String(r.i));
    }
    row.i = 0;
    row.flip = !row.flip;
    this._fillLoot(row, String(text ?? ''), k);
    // is-new: jump to the bottom slot without the slide transition
    row.el.className = `lu-loot__row lu-loot__row--${k} g lu-flat is-new ${row.flip ? 'is-a' : 'is-b'}`;
    row.el.style.setProperty('--i', '0');
  }

  /** The vitals element (tests: its position must not change with the location plate). */
  get vitalsElement() { return this._vitals; }
  /** The skill bar + gold counter element (`.lu-skills`). */
  get skillsElement() { return this._skillsEl; }

  dispose() {
    this._disposed = true;
    this._offScale?.();
    this._vitals.remove();
    this._skillsEl.remove();
    this._lootEl.remove();
  }

  // ------------------------------------------------------------------------------------------
  // Layout (G's recipes; art px of the 640 × 360 frame)
  // ------------------------------------------------------------------------------------------

  _build() {
    if (this._disposed) return;
    this._buildVitals();
    this._buildSkills();
    this._buildLoot();
  }

  /**
   * The vitals' top: under G's place plate (HUD.js), which stands at y 10 and is as tall as its two
   * rows' ink (22 art px round English capitals, taller round CJK), plus a 4 art px gap — fixed for
   * the language, whatever the plate shows.
   */
  _vitalsTop() {
    const plate = Math.round(3.5 + inkH('name') + 2.5 + inkH('line') + 3.5);
    return 10 + plate + 4;
  }

  /** The vitals band's width for the current max HP / MP (G: 155 art px at least). */
  _vitalsWidth() {
    const v = this._vit;
    const pair = (m) => { const n = Math.max(0, Math.round(m)); return measure(`${n}/${n}`, 'num'); };
    return Math.max(155, 107 + Math.max(pair(v.hpMax), pair(v.mpMax)) + 16);
  }

  _buildVitals() {
    const k = pal();
    const el = this._vitals;
    el.textContent = '';
    const x = 10, y = this._vitalsTop();
    const w = this._vitalsWidth();
    this._vw = w;
    anchorGroup(el, 'tl', x, y, w, 32);
    put(el, band(w, 32, 0.84, 0.7, 0.58), x, y, 1, 'lu-vitals__band');
    put(el, hairline(Math.round(w * 0.86)), x, y + 31);
    // the level: a tiny gilt "Lv" over a big numeral
    const lv = box(el, x, y, 22, 26, 'lu-vitals__lv');
    txt(lv, 'Lv', x + 11, y + 1, { font: 'tiny', color: k.g4, align: 'center', drop: true, cls: 'lu-vitals__lvk' });
    this._lvn = liveText(lv, x + 11, y + 9, { font: 'numL', color: k.g5, align: 'center', drop: true, cls: 'lu-vitals__lvn' });
    // HP / MP / SP: today's gold-ringed tracks with A's banded fills
    const bars = box(el, x, y, null, null, 'lu-vitals__bars');
    const RAMP = { hp: [k.hp0, k.hp1, k.hp2, k.hp3], mp: [k.mp0, k.mp1, k.mp2, k.mp3], sp: [k.sp0, k.sp1, k.sp1, k.sp2] };
    /** @type {[ 'hp'|'mp'|'sp', number, number ][]} */
    const rows = [['hp', 7, 2], ['mp', 7, 10], ['sp', 6, 18]];
    /** @type {Record<string, VitalBar>} */
    const made = {};
    for (const [id, h, dy] of rows) {
      const by = y + dy;
      const capTop = Math.round(by + 2 + (h - 4) / 2 - 2.5);
      const row = box(bars, x, by, null, null, `lu-vbar lu-vbar--${id}`);
      txt(row, id.toUpperCase(), x + 22, capTop - 2, { font: 'tiny', drop: true, cls: 'lu-vbar__k' });
      const tr = box(row, x + 33, by, 71, h, 'lu-vbar__track');
      const rp = RAMP[id];
      put(tr, art(71, h, (p) => bar(p, 71, h, 0, rp, { ring: k.dm1 })), x + 33, by);
      const iw = 67, ih = h - 4;
      const fillRows = rampRows(rp, ih);
      const chipRows = rampRows([k.g3, k.g4, k.g5, k.g5], ih);
      const strip = (cols) => art(iw, ih, (p) => cols.forEach((c, j) => p.hline(0, j, iw, c)));
      const lag = id !== 'sp' ? put(tr, strip(chipRows), x + 35, by + 2, 1, 'lu-vbar__lag') : null;
      const fill = put(tr, strip(fillRows), x + 35, by + 2, 1, 'lu-vbar__fill');
      const cap = ih > 2 ? put(tr, art(1, ih - 1, (p) => p.vline(0, 0, ih - 1, fillRows[0])), x + 35, by + 3, 1, 'lu-vbar__cap') : null;
      if (id === 'hp') {
        put(tr, art(iw, ih, (p) => {
          for (let i = 1; i < 4; i++) p.vline(Math.round(iw * i / 4), ih - Math.ceil(ih / 2), Math.ceil(ih / 2), k.ink0);
        }), x + 35, by + 2, 1, 'lu-vbar__notch');
      }
      /** @type {Text|null} */
      let numText = null;
      /** @type {Text|null} */
      let maxText = null;
      if (id !== 'sp') {
        const num = txt(row, '', x + 107, capTop - 2, { font: 'num', drop: true, cls: 'lu-vbar__num' });
        const b = document.createElement('b');
        const mx = document.createElement('span');
        mx.className = 'lu-vbar__max';
        numText = document.createTextNode('');
        maxText = document.createTextNode('');
        b.append(numText);
        mx.append(maxText);
        num.append(b, mx);
      }
      made[id] = { row, fill, lag, cap, iw, q: -1, n: -1, max: -1, low: false, numText, maxText, clip: false };
    }
    this._hp = made.hp;
    this._mp = made.mp;
    this._sp = made.sp;
    // experience: a thin gilt bar along the foot of the band
    const xw = w - 22;
    const xpBox = box(el, x + 5, y + 26, xw, 2, 'lu-vitals__xp');
    put(xpBox, art(xw, 2, (p) => { p.hline(0, 0, xw, k.xp0); p.hline(0, 1, xw, k.ink1); }), x + 5, y + 26);
    const xf = put(xpBox, art(xw, 2, (p) => {
      for (let i = 0; i < xw; i++) { const t = i / xw; p.px(i, 0, t < 0.33 ? k.g2 : t < 0.66 ? k.g3 : k.g4); p.px(i, 1, t < 0.33 ? k.g1 : k.g2); }
    }), x + 5, y + 26, 1, 'lu-vbar__fill');
    this._xp = { row: xpBox, fill: xf, lag: null, cap: null, iw: xw, q: -1, n: -1, max: -1, low: false, numText: null, maxText: null, clip: true };
    this._level = -1;
    this._winded = false;
    if (this._vitSet) this._applyVitals();
  }

  _applyVitals() {
    const v = this._vit;
    this._setBar(this._hp, v.hp, v.hpMax, true);
    this._setBar(this._mp, v.mp, v.mpMax, true);
    this._setBar(this._sp, v.sp, v.spMax, false);
    this._setBar(this._xp, v.xp, v.xpNext, false);
    const low = v.hpMax > 0 && v.hp > 0 && v.hp / v.hpMax <= 0.25;
    if (low !== this._hp.low) { this._hp.low = low; this._hp.row.classList.toggle('is-low', low); }
    const lv = v.level | 0;
    if (lv !== this._level) { this._level = lv; this._lvn.set(String(lv)); }
    const w = !!v.winded;
    if (w !== this._winded) { this._winded = w; this._sp.row.classList.toggle('is-winded', w); }
  }

  /**
   * @param {VitalBar} b
   * @param {number} val
   * @param {number} max
   * @param {boolean} withNumber
   */
  _setBar(b, val, max, withNumber) {
    const m = max > 0 ? max : 1;
    const v = Number.isFinite(val) ? val : 0;
    // whole art pixels: the fill ends on the grid
    const q = Math.round(clamp01(v / m) * b.iw);
    if (q !== b.q) {
      b.q = q;
      if (b.clip) b.fill.style.clipPath = `inset(0 calc(var(--px) * ${b.iw - q}) 0 0)`;
      else {
        const t = `scaleX(${q / b.iw})`;
        b.fill.style.transform = t;
        if (b.lag) b.lag.style.transform = t;
      }
      if (b.cap) {
        const on = q > 1 && q < b.iw;
        b.cap.style.visibility = on ? '' : 'hidden';
        if (on) b.cap.style.transform = `translateX(calc(var(--px) * ${q - 1}))`;
      }
    }
    if (withNumber && b.numText) {
      const n = v > 0 ? Math.ceil(v - 1e-6) : 0;
      if (n !== b.n) { b.n = n; b.numText.nodeValue = String(n); }
      const mx = Math.round(max > 0 ? max : 0);
      if (mx !== b.max) { b.max = mx; b.maxText.nodeValue = `/${mx}`; }
    }
  }

  _buildSkills() {
    const el = this._skillsEl;
    el.textContent = '';
    // the names under the slots, a line at a time; English breaks at 56 font px (alike at every
    // --px), a CJK name at the translator's hints (U+200B), three characters to a line at most; at
    // an odd --px English names take G's cap in a Jersey face (`slotNameFace`), broken at G's 28.
    // A line may always run as wide as the bar's widest word, which it shows unbroken anyway: a name
    // no wider breaks no more than that word does ("鐘声の波" beside "カリヨン" stays on one line)
    const u = FONT.line.unit;
    const px = typePx();
    const face = cjk() ? null : slotNameFace(px);
    this._nameFace = face;
    /** A line's width in the names' type (art px). @param {string} s */
    const lineW = (s) => (face ? Math.ceil(faceAdvance(s, face) / px) : measure(s, 'line'));
    let widest = 0;
    for (const def of this._defs) for (const w of nameParts(def.label ?? '')) widest = Math.max(widest, lineW(w));
    const maxW = Math.max(face ? 28 : cjk() ? 25 : 56 * u, widest);
    const names = this._defs.map((def) => (face ? faceLines(def.label ?? '', face, maxW) : lines(def.label ?? '', 'line', maxW)));
    const widths = names.map((ls) => ls.reduce((m, ln) => Math.max(m, lineW(ln)), 0));
    // the pitch: G's 30, or what keeps neighbouring names NAME_GAP apart beyond their outlines (one
    // font pixel: ⅔ of an art px for a half-size role at --px 3)
    const ol = Math.ceil(2 * (face ? face.k / px : u));
    const n = this._defs.length;
    let pitch = SLOT_PITCH;
    for (let i = 0; i + 1 < n; i++) pitch = Math.max(pitch, Math.ceil(widths[i] / 2) + Math.floor(widths[i + 1] / 2) + ol + NAME_GAP);
    this._pitch = pitch;
    const xs = this._defs.map((_, i) => X1 - (n - i) * pitch + 8);
    // the leftmost the slots and their names reach; the group's box covers them (the world labels
    // keep out of it)
    const reach = Math.min(X1, ...xs.map((x, i) => Math.min(x, x + 11 - Math.ceil(widths[i] / 2) - 1)));
    const left = Math.min(500, reach);
    anchorGroup(el, 'br', left, 284, 640 - left, 76);
    // too narrow for G's dialogue window beside the bar (1024 × 768): it steps aside in a dialogue
    const sc = currentScale(this.parent);
    const k = sc?.cornerShrink ?? 1;
    el.classList.toggle('is-tight', !!sc && sc.artW - (640 - reach) * k < (DIALOG_RIGHT + DIALOG_GAP) * k);
    /** @type {HTMLElement} */
    this._goldEl = box(el, left, 284, null, null, 'lu-skills__gold');
    this._purse = null;
    this._purseW = -1;
    this._layoutPurse();
    /** @type {HTMLElement} */
    this._row = box(el, left, 284, null, null, 'lu-skills__row');
    this._slots = this._defs.map((def, i) => this._buildSlot(def, xs[i], 306, names[i]));
    this._slots.forEach((slot, i) => this._applySkill(slot, this._state[i]));
    if (this._potions >= 0) this._applyPotions();
  }

  /**
   * One slot (G's `skillSlot`): a compact socket, the icon, two keycaps on its foot, the name
   * under it; its states drawn once and shown by class (no DOM churn per frame).
   * @param {SkillDef} def
   * @param {number} x
   * @param {number} y
   * @param {string[]} name the name's lines (`_buildSkills`)
   * @returns {SkillSlot}
   */
  _buildSlot(def, x, y, name) {
    const k = pal();
    const draught = def.icon === 'draught';
    const el = box(this._row, x, y, 22, 22, draught ? 'lu-skill lu-skill--draught' : 'lu-skill');
    el.dataset.skill = String(def.id ?? '');
    const bx = box(el, x, y, 22, 22, 'lu-skill__box');
    const caps = parseKeys(def.keys ?? '');
    // the socket: gold corner gems, or dim gilt while locked (CSS shows one)
    for (const [cls, o] of /** @type {[string, import('./art/frames.js').FrameStyle][]} */ ([
      ['lu-skill__frame', { size: 'XS', socket: true, corners: GEMS.gold(), cornerR: 1, fill: k.ink1 }],
      ['lu-skill__frame lu-skill__frame--locked', { size: 'XS', socket: true, corners: null, cornerR: 1, tone: 'dim', fill: k.ink1 }],
    ])) {
      const f = win(bx, o, x, y, 22, 22);
      f.base.classList.add(...cls.split(' '));
      f.orn?.classList.add(...cls.split(' '));
    }
    const ico = box(bx, x + 3, y + 3, 16, 16, 'lu-skill__icon');
    // (G: the icon names the slot and its key; the name under it is the same words, unbroken)
    ico.setAttribute('role', 'img');
    ico.setAttribute('aria-label', `${nameParts(def.label ?? '').join(cjk() ? '' : ' ')}${caps.length ? ` [${caps.join(' / ')}]` : ''}`);
    if (Object.prototype.hasOwnProperty.call(SKILL_ICONS, def.icon)) {
      put(ico, combatIcon(SKILL_ICONS[def.icon]), x + 3, y + 3, 1, 'lu-skill__ico');
      put(ico, combatIcon(SKILL_ICONS[def.icon], DUSK_ICON()), x + 3, y + 3, 1, 'lu-skill__ico lu-skill__ico--dusk');
    }
    // the veil: dark ink filling the glass from the bottom, its top edge lit gold
    const vw = box(bx, x + 3, y + 3, 16, 16, 'lu-skill__veil');
    const va = put(vw, veil(16), x + 3, y + 3, 1, 'lu-skill__veil-art');
    put(bx, readyFlash(16), x + 3, y + 3, 1, 'lu-skill__flash');
    // the seconds in Jersey 15 (half), centred on the glass above the keys, ringed in ink
    const secs = liveText(bx, x + 11, y + 10 - capMid('big'), { font: 'big', color: k.tx1, align: 'center', olx: true, cls: 'lu-skill__secs' });
    const count = liveText(bx, x + 19, y + 2, { font: 'num', align: 'right', ol: true, cls: 'lu-skill__count' });
    // locked: the lock, and the level it opens at on a small plate over the top rim
    const lock = box(bx, x, y, null, null, 'lu-skill__lock');
    put(lock, glyph('lock'), x + 8, y + 6);
    if (Number.isFinite(def.unlock)) {
      const n = String(def.unlock);
      const lw = measure('Lv', 'tiny'), nw = measure(n, 'num');
      const bw = lw + 2 + nw + 8, px0 = x + 11 - Math.floor(bw / 2), py0 = y - 5;
      put(lock, lockPlate(bw), px0, py0);
      txt(lock, 'Lv', px0 + 4, py0, { font: 'tiny', color: k.g4 });
      txt(lock, n, px0 + 4 + lw + 2, py0, { font: 'num', color: k.g5 });
    }
    // the keys (U and 1 …), straddling the slot's foot
    this._keys(bx, caps, x, y, 'lu-skill__keys');
    // the name under it, a line at a time (each centred on whole art px), outlined over the world,
    // with a 16 font px pitch (a CJK name: its line box less one; a Jersey face: G's 8 art px)
    const lab = box(el, x, y + 22, null, null, 'lu-skill__label');
    lab.setAttribute('aria-hidden', 'true');
    const face = this._nameFace;
    const pitch = face ? 8 : cjk() ? FONT.line.L - 1 : 16 * FONT.line.unit;
    name.forEach((ln, j) => {
      const t = txt(lab, ln, x + 11, y + 29 + j * pitch, { font: 'line', color: k.tx2, align: 'center', ol: true, drop: true });
      // (the role's cap centre: its line box top + capMid('line'))
      if (face) setFace(t, ln, face, x + 11, y + 29 + j * pitch + capMid('line'), lab, true);
    });
    return {
      el, box: bx, veil: vw, veilArt: va, secs, count, draught,
      vh: -1, s: -1, cd: false, locked: false, poor: false, flip: false, nope: false,
    };
  }

  /**
   * A slot's keycaps centred under it at y + 17, side by side ('U/1').
   * @param {Element} parent
   * @param {string[]} caps the keys (`parseKeys`)
   * @param {number} x
   * @param {number} y
   * @param {string} cls
   */
  _keys(parent, caps, x, y, cls) {
    const wrap = box(parent, x, y, null, null, cls);
    const total = caps.reduce((a, c) => a + capW(c), 0) + Math.max(0, caps.length - 1);
    let cx = x + 11 - Math.floor(total / 2);
    caps.forEach((c) => {
      const w = key(wrap, c, cx, y + 17);
      // a digit's face on the cap's face rows 2–6 where 'num' outgrows them (odd --px)
      const f = /^[0-9]$/.test(c) ? keyDigitFace(typePx()) : null;
      const lab = f ? wrap.lastElementChild : null;
      if (lab instanceof HTMLElement && lab.classList.contains('keylab')) setFace(lab, c, f, cx + Math.floor(w / 2), y + 17 + 4.5, wrap);
      cx += w + 1;
    });
    return wrap;
  }

  /**
   * @param {SkillSlot} slot
   * @param {SlotState} s
   */
  _applySkill(slot, s) {
    const f = clamp01(s.cooldown);
    const cd = f > 0;
    // the veil in whole art pixels (2 at least while it runs)
    const vh = cd ? Math.max(2, Math.round(16 * f)) : 0;
    if (vh !== slot.vh) {
      slot.vh = vh;
      slot.veilArt.style.transform = `translateY(calc(var(--px) * ${16 - vh}))`;
    }
    if (cd !== slot.cd) {
      slot.cd = cd;
      slot.el.classList.toggle('is-cd', cd);
      // ready again: a short gold flash (restarted by toggling two identical keyframes)
      if (!cd) {
        slot.flip = !slot.flip;
        slot.el.classList.toggle('is-ready-a', slot.flip);
        slot.el.classList.toggle('is-ready-b', !slot.flip);
      }
    }
    // the seconds: whole seconds rounded up, one decimal under a second ('0.8'); a number code
    // (whole seconds × 10, or the tenths) so a frame without a change builds no string
    let code = 0;
    if (cd) {
      const left = s.left ?? s.seconds ?? 0;
      if (left >= 1) code = Math.ceil(left - 1e-6) * 10;
      else if (left > 0) code = Math.min(10, Math.max(1, Math.ceil(left * 10 - 1e-6)));
    }
    if (code !== slot.s) {
      slot.s = code;
      slot.secs.set(code === 0 ? '' : code >= 10 ? String(code / 10) : `0.${code}`);
    }
    if (s.locked !== slot.locked) { slot.locked = s.locked; slot.el.classList.toggle('is-locked', s.locked); }
    const poor = !s.affordable;
    if (poor !== slot.poor) { slot.poor = poor; slot.el.classList.toggle('is-poor', poor); }
  }

  _applyPotions() {
    const c = this._potions;
    const m = this._potionsMax;
    for (const slot of this._slots) {
      if (!slot.draught) continue;
      slot.count.set(`×${c}`);
      slot.el.classList.toggle('is-empty', c === 0);
      slot.el.classList.toggle('is-full', m > 0 && c >= m);
    }
  }

  /**
   * The purse (G's `purse`): a coin and the gold ("G" in Tiny5) on today's band, fading in from the
   * left; laid out again when the number's width changes (no layout read).
   */
  _layoutPurse() {
    const g = this._goldEl;
    if (!g) return;
    const k = pal();
    const y = 290;
    const s = String(this._gold);
    const nw = measure(s, 'num'), gw = measure('G', 'tiny');
    const w = 6 + 9 + 3 + nw + 2 + gw + 4;
    if (!this._purse) {
      g.textContent = '';
      const num = liveText(g, X1 - 4 - gw, y - 0.5, { font: 'num', color: k.kw, align: 'right', drop: true, cls: 'lu-skills__goldn' });
      txt(g, 'G', X1 - 2 - gw, y - 1, { font: 'tiny', color: k.g3, drop: true, cls: 'lu-skills__g' });
      this._purse = { band: null, coin: null, num };
    }
    const P = this._purse;
    if (w !== this._purseW) {
      this._purseW = w;
      P.band = swap(g, P.band, fade(w + 14, 10, rgbOf(k.band), ramp([[0, 0], [0.35, 0.82], [1, 0.82]]), [...BAND_STEPS]), X1 - w - 12, y, 'lu-skills__band');
      if (!P.coin) {
        P.coin = put(g, coin(), X1 - w + 2, y + 1, 1, 'lu-skills__coin');
      } else {
        const [ox, oy] = originOf(g);
        P.coin.style.left = U(X1 - w + 2 - ox);
        P.coin.style.top = U(y + 1 - oy);
      }
    }
    P.num.set(s);
  }

  _buildLoot() {
    const el = this._lootEl;
    el.textContent = '';
    // the newest row's band ends 3 art px over the purse's
    const y0 = 290 - 3 - LOOT_H;
    anchorGroup(el, 'br', 480, y0 - (LOOT_POOL - 1) * LOOT_PITCH, 160, LOOT_POOL * LOOT_PITCH);
    const old = this._loot;
    this._loot = [];
    for (let i = 0; i < LOOT_POOL; i++) {
      const row = box(el, X1, y0, null, null, 'lu-loot__row');
      const inner = box(row, X1, y0, null, null, 'lu-loot__in');
      const bandC = put(inner, art(1, LOOT_H, () => {}), X1, y0, 1, 'lu-loot__band');
      const ico = put(inner, art(9, 9, () => {}), X1, y0 + 1, 1, 'lu-loot__ico');
      const t = txt(inner, '', X1, y0 + LOOT_H / 2 - capMid('line'), { font: 'line', drop: true, cls: 'lu-loot__t' });
      const r = { el: row, inner, band: bandC, ico, t, i: LOOT_POOL, flip: false, text: '', kind: 'gold', y0 };
      // a re-layout keeps what the feed shows (the rows' text, kind and place)
      const prev = /** @type {any} */ (old[i]);
      if (prev && prev.i < LOOT_POOL) {
        r.i = prev.i;
        r.flip = prev.flip;
        this._fillLoot(r, prev.text, prev.kind);
        row.className = prev.el.className;
        row.style.setProperty('--i', String(r.i));
      }
      this._loot.push(r);
    }
  }

  /**
   * A loot row's band, icon and text for `text` (G's purse family: a band fading in from the left,
   * the 9 × 9 icon, the text in the line type), ending at the screen's right margin.
   * @param {any} row
   * @param {string} text
   * @param {string} kind
   */
  _fillLoot(row, text, kind) {
    const k = pal();
    row.text = text;
    row.kind = kind;
    const y0 = row.y0;
    const tw = measure(text, 'line');
    const rw = 5 + 9 + 3 + tw + 5;
    row.band = swap(row.inner, row.band, fade(rw + 14, LOOT_H, rgbOf(k.band), ramp([[0, 0], [0.3, 0.82], [1, 0.82]]), [...BAND_STEPS]), X1 - rw - 12, y0, 'lu-loot__band');
    const ctx = row.ico.getContext('2d');
    ctx.clearRect(0, 0, 9, 9);
    ctx.drawImage(lootIcon(kind), 0, 0);
    const [ox] = originOf(row.inner);
    row.ico.style.left = U(X1 - rw + 5 - ox);
    row.t.textContent = text;
    row.t.style.left = UR(X1 - 5 - tw - ox);
  }
}
