import { readableColor, safeColor, memberRamp, fontsMissing, loadFonts, inkNow } from './PartyFrames.js';
import { pal, GEMS } from './art/palette.js';
import { art } from './art/painter.js';
import { glyph, dimGlyph, gemGlyph, selBand, hairline, fade, rgbOf } from './art/pieces.js';
import { portraitCanvas, spriteCrop, PORTRAIT_CROPS } from './art/portrait.js';
import { GOLD_ICON, DUSK_ICON } from './art/icons/core.js';
import { icon, FIELD_ICONS, PRESET_ICONS, CLASS_ICONS } from './art/icons/party.js';
import { pips } from './art/party.js';
import { group, put, win, keyHints } from './layout/layout.js';
import { txt, txc, measure, fit, capMid, grow, lineCount, FONT, cjk, UP, setOrigin } from './layout/type.js';
import { onScale, currentScale } from './UiScale.js';
import { t, sep, getLang } from '../i18n/I18n.js';
import { MAX_PARTY } from '../level/PartyRules.js';
import './party.css';

/**
 * @import { PartyPanelLike, PartyPanelOpts, PartyRule } from '../../game/party/types.js'
 * @import { PartySound } from './types.js'
 * @import { FrameStyle } from './art/frames.js'
 */

/**
 * PartyPanel — the party's tactics panel (`.lu-party`, docs/specs/PARTY.md §6.1, docs/specs/
 * PIXEL_UI.md §5), created by `UI.usePartyUI()` once someone joins: mockup G's `tactics` screen in
 * A's arrangement — a large window (A's frame with the crown, the lattice and the beads) nearly
 * the whole screen (608 × 328 art px, centred; the HUD hidden under it). The header: PARTY ◆
 * TACTICS at the left, the key hints at the right. The left column: the member shown — its
 * portrait (frame (0, 0) of its character sheet ×2), NAME in its colour, its class with the class
 * icon, role · weapon, the class's help —, the party's slots (a tab per member: its sprite; EMPTY
 * up to three) and a note box with the focused row's help. The right column: the presets as
 * 2 × 3 cards (icon, NAME, help; the member's own marked, gold-framed, ✓) and the rule's fields as
 * rows `icon LABEL ◀ value ▶ hint`, the value's place among its options as pips under it, the
 * focused row on A's selection band with the cursor.
 *
 * Everything it shows comes in as data (`open(opts)`: the members, the presets and the fields,
 * translated by the caller — Party.openMenu passes `localPresets()` / `localFields()`); its own
 * chrome is the 'party' namespace (`t('party.panel.*')`, src/game/party/strings.js, registered by
 * the party when it starts). All text goes through the type's `txt` (escaped); a member's colour is
 * checked (`safeColor`) and lightened for its name where it would be too dark on the panel.
 *
 * Input as the Journal's (it binds no key, UI-01): `update(dt, input)` — `UI.update` calls it while
 * it is open — reads `input.consumeAction?.(name) ?? input.actionPressed(name)`:
 *   - `up` / `down`: the focus moves between the rows (the preset grid's rows, then the fields;
 *     wrapping); on the preset grid it keeps its column. When the window is too short for the body
 *     (it scrolls), the focused card or row is scrolled into view.
 *   - `left` / `right`: on a preset row the focus moves between the cards (all of them, in order);
 *     on a field row the value changes (wrapping) — at once: `onRule(id, rule)`.
 *   - `confirm`: picks the focused preset card (its rule, at once), or on a field row the next value.
 *   - `camLeft` / `camRight` (Q / E): the previous / next member (wrapping).
 *   - `cancel` (Esc): closes — `update` returns true.
 * Mouse: a click on a member's slot shows it, on a card picks it, on ◀ / ▶ changes the value, on a
 * row focuses it; a click outside the window closes (reported by the next `update`). The overlay
 * has `data-input-ignore` (the wheel does not zoom the camera). `close()` — by the panel or the
 * game — calls `onClose` (the contract: "the panel closed, any way").
 *
 * Sounds (`onSound(name)`, `PartySound`): `menuOpen` / `menuClose` (open, close), `menuMove` (the
 * focus moved: a row, a card), `menuSelect` (a change: a value, a preset picked, another member).
 * The game maps them to its SFX (`open`, `close`, `blip`, `confirm` of AudioSystem).
 *
 * Laid out in art px of G's 640 × 360 frame (layout/layout.js): a centred group, reflowed to the
 * screen rather than scaled while it can be — narrower than G's 608 on a screen under 640 art px
 * wide (1024 × 768: 480; the cards wrap more, the rules' hints move into the note box), shorter on
 * one under 360 art px tall (the body scrolls) —, and scaled to fit (`fitScale`) only below that;
 * laid out again on a scale change ('scale' of the UI root) and once a CJK font slice it needs has
 * come in (`loadFonts`). Each row of preset cards is as tall as its longest help at the scale's
 * line pitch (the half-size help is ⅔ of an art px per font pixel at --px 3); a rule's hint cut
 * to its column is shown whole in the note box while its row has the focus.
 */

/** Preset cards per row of the grid (A's arrangement: two columns). */
const COLS = 2;

/**
 * G's window: x, width (the widest; a screen under 640 art px wide gets a narrower window, down to
 * WW_MIN — below that it is scaled to fit), the content's inset from its sides; the left column's
 * width; a rule row's pitch.
 */
const WX0 = 16;
const WW0 = 608;
const WW_MIN = 480;
const INSET = 26;
const LW = 140;
const RP = 19;
/** G's window height and top; the most it grows to on G's 360 art px (taller content: the body scrolls). */
const WH0 = 328;
const WY0 = 20;
const WH_MAX = 342;
/** The least room under the content, over the window's bottom ornaments (art px). */
const BOT_PAD = 12;
/** A rule's hint column narrower than this (art px) is dropped: the note box shows the hint. */
const HINT_MIN = 96;

/** @param {unknown} v @returns {string} */
const str = (v) => {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  try { return String(v); } catch { return ''; }
};

/**
 * `table[key]` for an own key only (data from levels and story files: "constructor" is no key).
 * @param {unknown} table @param {string} key @returns {unknown}
 */
const own = (table, key) => (table && typeof table === 'object' && Object.hasOwn(table, key) ? table[key] : undefined);
/** An own key's value of a frozen icon map, else null. @param {Readonly<Record<string, string>>} map @param {string} key */
const iconOf = (map, key) => (Object.hasOwn(map, key) ? map[key] : null);

/**
 * `t('party.<key>')`: the panel's own words (the 'party' namespace, src/game/party/strings.js —
 * `partyUIClasses()` registers it with the classes, so wherever the panel is made it has them).
 * @param {string} key @param {Record<string, any>} [vars]
 */
const tr = (key, vars) => t(`party.${key}`, vars);

/** @param {string} tag @param {string} className */
function make(tag, className) {
  const el = document.createElement(tag);
  el.className = className;
  return el;
}

/** n art px as CSS. @param {number} n */
const U = (n) => `calc(var(--px) * ${n})`;
/** n art px as CSS, on a whole device pixel (text positions). @param {number} n */
const UR = (n) => `round(nearest, calc(var(--px) * ${n}), var(--lu-dpx, 1px))`;

/**
 * An absolutely placed box (a hit target, a scroll body) at (x, y) w × h in the frame coordinates
 * of `parent` (whose origin is `po`); its children are placed in frame coordinates too.
 * @param {HTMLElement} el @param {[number, number]} po @param {number} x @param {number} y @param {number} w @param {number} h
 */
function box(el, po, x, y, w, h) {
  el.style.left = U(x - po[0]);
  el.style.top = U(y - po[1]);
  el.style.width = U(w);
  el.style.height = U(h);
  setOrigin(el, [x, y]);
  return el;
}

/** Text in capitals: the class that makes it so (English; CJK has no case). */
const caps = () => (cjk() ? '' : ' lu-party-caps');

/**
 * @typedef {{ key: string, label: string, help: string, values: string[], labels: Record<string, string>, hints: Record<string, string> }} PanelField
 * @typedef {{ name: string, label: string, help: string, rule: Record<string, string> }} PanelPreset
 * @typedef {{ id: string, name: string, color: string, text: string, cls: string, clsId: string, clsHelp: string, role: string, weapon: string, portrait: HTMLCanvasElement|null, rule: Record<string, string> }} PanelMember
 * @typedef {{ el: HTMLElement, sub: Text }} PanelTab
 * @typedef {{ el: HTMLElement, flip: boolean }} PanelCard
 * @typedef {{ el: HTMLElement, value: HTMLElement, valueText: Text, valueAt: number, hint: HTMLElement, hintText: Text, hintW: number, hintFull: string, hintCut: boolean, pips: HTMLCanvasElement, pipsKey: string, flip: boolean, origin: [number, number] }} PanelRow
 *   hintW the hint column (0: none — the note box shows the hint); hintFull the value's hint, hintCut: not shown whole in the row
 * @typedef {{ WX: number, WW: number, WY: number, WH: number, L: number, R: number, RX: number, CY: number, HY: number, CW: number, CHs: number[], CYs: number[], HW: number, RH: number, RY0: number, BOT: number, la: number, vc: number, ra: number, hx: number, hints: boolean, BY: number, SH: number, SY: number, NY: number, NH: number, gs: number }} PanelGeom
 *   WX, WW the window's x and width (G's 16, 608; narrower on a screen under 640 art px); CHs the
 *   preset grid's row heights (as G all the same, else each row its own longest help), CYs their
 *   tops; hints: the rows have their hint column (else the note box shows the focused row's hint)
 */

/** The tactics panel (see the top of this file). @implements {PartyPanelLike} */
export class PartyPanel {
  /** @param {HTMLElement} parent the UI root */
  constructor(parent) {
    /** @type {((id: string, rule: PartyRule) => void) | null} a member's rule changed by the player (a full rule) */
    this.onRule = null;
    /** @type {(() => void) | null} the panel closed (any way: Esc, a click outside, `close()`) */
    this.onClose = null;
    /** @type {((name: PartySound) => void) | null} 'menuOpen' | 'menuClose' | 'menuMove' | 'menuSelect' */
    this.onSound = null;

    const el = document.createElement('div');
    el.className = 'lu-party';
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('data-input-ignore', '');
    parent.appendChild(el);
    this.element = el;

    /** @type {HTMLCanvasElement|null} the dim layer over the scene */
    this._veil = null;
    /** @type {HTMLElement|null} the window (`.lu-party__window`: a centred group) */
    this._window = null;
    /** @type {HTMLElement|null} */ this._memberEl = null;
    /** @type {HTMLElement|null} */ this._presetsEl = null;
    /** @type {HTMLElement|null} */ this._rulesEl = null;
    /** @type {HTMLElement|null} */ this._body = null;
    /** @type {HTMLElement|null} */ this._desc = null;
    /** @type {HTMLElement|null} the presets heading and the rules heading (their right words change) */
    this._subP = null;
    this._subR = null;
    /** @type {HTMLElement|null} */ this._currentEl = null;
    /** @type {PanelGeom|null} */
    this._geom = null;

    this._open = false;
    this._closeQueued = false;
    /** @type {PanelMember[]} */
    this._members = [];
    /** @type {PanelPreset[]} */
    this._presets = [];
    /** @type {PanelField[]} */
    this._fields = [];
    this._closeKey = '';
    /** the member shown (index) */
    this._m = 0;
    /** the focused row: the preset grid's rows first, then one per field */
    this._row = 0;
    /** the focused card's column on the preset grid */
    this._col = 0;
    /** @type {PanelTab[]} */
    this._tabs = [];
    /** @type {PanelCard[]} */
    this._cards = [];
    /** @type {PanelRow[]} */
    this._rows = [];
    /** the right word of the headings now ('' before the first) */
    this._rightWord = '';
    /** the note box's text now (its key) */
    this._descKey = '';
    /** the art size the veil was painted for */
    this._veilKey = '';
    /** the panel's data changed since it was laid out (a scale change while closed) */
    this._stale = false;
    /** @type {Map<string, { font: 'body'|'line', lines: number, extra: number }>} the note box's text (and hint): the text's font and lines, the hint's lines */
    this._noteFit = new Map();
    /** the layout the window was built for (`_layoutKey`; '' none) */
    this._builtKey = '';
    /** the panel's words whose fonts were last looked at (`_ensureFonts`; '' none) */
    this._ensuredText = '';

    this._onClick = (/** @type {MouseEvent} */ e) => {
      if (!this._open) return;
      const tg = /** @type {HTMLElement} */ (e.target);
      if (tg === el || tg === this._veil) { this._closeQueued = true; return; }
      const tab = tg.closest?.('.lu-party__tab');
      if (tab) {
        const i = this._tabs.findIndex((x) => x.el === tab);
        if (i >= 0 && i !== this._m) { this._showMember(i); this._sound('menuSelect'); }
        return;
      }
      const card = tg.closest?.('.lu-party__card');
      if (card) {
        const i = this._cards.findIndex((x) => x.el === card);
        if (i >= 0) {
          this._focusCard(i);
          this._pick(i);
        }
        return;
      }
      const row = tg.closest?.('.lu-party__row');
      if (row) {
        const i = this._rows.findIndex((x) => x.el === row);
        if (i < 0) return;
        const r = this._presetRows + i;
        const arrow = tg.closest?.('.lu-party__arrow');
        if (arrow) {
          this._focus(r);
          this._step(i, arrow.classList.contains('lu-party__arrow--l') ? -1 : 1);
        } else if (r !== this._row) {
          this._focus(r);
          this._sound('menuMove');
        }
      }
    };
    el.addEventListener('click', this._onClick);
    // (no focus moves, no text selection: the panel is driven by the game's actions, not the DOM's)
    this._onDown = (/** @type {MouseEvent} */ e) => { if (e.target !== el && e.target !== this._veil) e.preventDefault(); };
    el.addEventListener('mousedown', this._onDown);
    // a new scale: laid out again (now when open, else at the next open)
    this._offScale = onScale(parent, () => {
      if (this._open) this._relayout();
      else this._stale = true;
    });
  }

  /** True between open() and close(). */
  get isOpen() { return this._open; }
  /** The id of the member shown ('' before the first open). */
  get memberId() { return this._members[this._m]?.id ?? ''; }
  /** The focused row: 'presets' (the preset grid) or a field's key. */
  get focus() { return this._row < this._presetRows ? 'presets' : this._fields[this._row - this._presetRows]?.key ?? ''; }
  /** The focused preset card's name ('' when a field row has the focus). */
  get focusedPreset() { return this._row < this._presetRows ? this._presets[this._cardIndex()]?.name ?? '' : ''; }
  /** A copy of the shown member's rule (null before the first open). @returns {PartyRule|null} */
  get rule() {
    const m = this._members[this._m];
    return m ? /** @type {PartyRule} */ ({ ...m.rule }) : null;
  }

  /**
   * Open the panel (fades in) on `opts.focus` (else the first member), the focus on its current
   * preset's card. While open, a new `open()` shows the new data — the focus row kept, and the
   * member shown kept too when `opts.focus` names none that is there (and it still is). Nothing
   * opens without a member.
   * @param {PartyPanelOpts} opts
   */
  open(opts) {
    this._closeQueued = false;
    const o = opts && typeof opts === 'object' ? opts : /** @type {PartyPanelOpts} */ ({});
    // (while open: the member shown before the new data)
    const shown = this._open ? this.memberId : '';
    this._fields = cleanFields(o.fields);
    this._presets = cleanPresets(o.presets, this._fields);
    this._members = cleanMembers(o.members, this._fields, this._presets);
    if (!this._members.length || !this._fields.length) { this.close(); return; }
    this._closeKey = str(o.closeKey).trim();
    let f = o.focus === undefined ? -1 : this._members.findIndex((m) => m.id === o.focus);
    if (f < 0 && shown) f = this._members.findIndex((m) => m.id === shown);
    this._m = f >= 0 ? f : 0;
    const wasOpen = this._open;
    // the same layout as the last open (the same words, members and scale): the window is kept and
    // only refilled (an open costs the frames' and texts' layout only when something changed)
    if (this._stale || this._layoutKey() !== this._builtKey) this._build();
    else this._members.forEach((_, i) => this._refreshTab(i));
    if (!wasOpen) {
      // the focus starts on the member's current preset (the first card when it is Custom)
      const p = this._presets.findIndex((x) => x.name === presetName(this._members[this._m].rule, this._presets, this._fields));
      this._row = 0;
      this._col = 0;
      if (this._presets.length) this._focusCard(Math.max(0, p));
    }
    this._row = Math.min(this._row, this._rowCount - 1);
    this._showMember(this._m);
    if (!wasOpen) {
      this._open = true;
      this.element.classList.add('is-open');
      this.element.setAttribute('aria-hidden', 'false');
      this._sound('menuOpen');
    }
    this._ensureFonts();
  }

  /** Close the panel (fades out); `onClose` runs when it was open. */
  close() {
    this._closeQueued = false;
    if (!this._open) return;
    this._open = false;
    this.element.classList.remove('is-open');
    this.element.setAttribute('aria-hidden', 'true');
    this._sound('menuClose');
    if (this.onClose) this.onClose();
  }

  /**
   * Read the panel's actions; once per frame while open (`UI.update` does).
   * @param {number} dt seconds (unused)
   * @param {{ actionPressed(name: string): boolean, consumeAction?(name: string): boolean }} [input]
   * @returns {boolean} true when the panel closed itself this update (cancel, a click outside)
   */
  update(dt, input) {
    if (!this._open) return false;
    const pressed = (/** @type {string} */ name) => !!input && (typeof input.consumeAction === 'function' ? input.consumeAction(name) : input.actionPressed(name));
    if (pressed('cancel') || this._closeQueued) {
      this.close();
      return true;
    }
    if (pressed('camLeft')) this._cycleMember(-1);
    else if (pressed('camRight')) this._cycleMember(1);
    if (pressed('up')) this._moveRow(-1);
    else if (pressed('down')) this._moveRow(1);
    if (pressed('left')) this._horizontal(-1);
    else if (pressed('right')) this._horizontal(1);
    if (pressed('confirm')) this._confirm();
    return false;
  }

  /**
   * Show a member's new rule (the story changed it while the panel is open; or before the next
   * open, which brings its own data anyway). Does not call `onRule`.
   * @param {string} id
   * @param {PartyRule} rule
   */
  setRule(id, rule) {
    const i = this._members.findIndex((m) => m.id === id);
    if (i < 0) return;
    this._members[i].rule = cleanRule(rule, this._fields, this._presets, this._members[i].rule);
    this._refreshTab(i);
    if (i === this._m) this._refreshRule(0);
  }

  dispose() {
    this.element.removeEventListener('click', this._onClick);
    this.element.removeEventListener('mousedown', this._onDown);
    this._offScale();
    this._open = false;
    this.element.remove();
  }

  // ------------------------------------------------------------------------------------------

  /** @param {PartySound} name */
  _sound(name) { if (this.onSound) this.onSound(name); }

  /** Rows of the preset grid. */
  get _presetRows() { return Math.ceil(this._presets.length / COLS); }
  get _rowCount() { return this._presetRows + this._fields.length; }

  /** The focused card's index (on a preset row). */
  _cardIndex() {
    const r = Math.min(this._row, this._presetRows - 1);
    return Math.min(this._presets.length - 1, r * COLS + this._col);
  }

  /** Lay the panel out again for the data it shows (a new scale, the fonts in): the member and the focus kept. */
  _relayout() {
    if (!this._members.length) return;
    this._stale = false;
    this._build();
    this._showMember(this._m);
  }

  /**
   * What the window's layout depends on: the language, the scale, the fields' and presets' words,
   * the members (their words, colours and sheets) and the close key — not the rules (refilled).
   */
  _layoutKey() {
    const s = currentScale(this.element);
    return JSON.stringify([
      getLang(), s ? [s.px, s.shrink, s.artW, s.artH] : null, this._closeKey,
      this._fields.map((f) => [f.key, f.label, f.help, f.values, f.labels, f.hints]),
      this._presets.map((p) => [p.name, p.label, p.help, p.rule]),
      this._members.map((m) => [m.id, m.name, m.color, m.cls, m.clsId, m.clsHelp, m.role, m.weapon, sheetId(m.portrait)]),
    ]);
  }

  /** Every string the panel shows (for `FontLoader.ensure`). */
  _texts() {
    const chrome = ['panel.party', 'panel.tactics', 'panel.presets', 'panel.rules', 'panel.custom', 'panel.empty', 'panel.presetsHelp',
      'panel.choose', 'panel.change', 'panel.pick', 'panel.member', 'panel.close'].map((k) => t(`party.${k}`));
    return JSON.stringify([chrome, this._fields, this._presets.map((p) => [p.label, p.help]),
      this._members.map((m) => [m.name, m.cls, m.clsHelp, m.role, m.weapon])]);
  }

  /**
   * CJK text needs font slices that are not in yet: load them, then lay out again. Once per text:
   * an open with the same words as one already looked at checks nothing (`_ensuredText`).
   */
  _ensureFonts() {
    const s = this._texts();
    if (s === this._ensuredText) return;
    this._ensuredText = s;
    if (!fontsMissing(s)) return;
    // (closed by then: laid out again at the next open)
    loadFonts(s).then(() => { if (this._open) this._relayout(); else this._stale = true; });
  }

  /**
   * The geometry of this data (G's `tactics`, art px of the 640 × 360 frame): the preset cards as
   * tall as the longest help needs (at the scale's line pitch: the half-size help is ⅔ of an art px
   * per font pixel at --px 3, taller than G's ½) — every card, as G, where the window holds that
   * without scrolling, else each row of cards its own longest —, the rows' columns from the longest
   * label and value, the left column from the longest class help; the window as G's, taller
   * (centred) when the content needs it — at most WH_MAX art px on G's 360 (more on a taller
   * screen, less on a shorter one: never more than the screen holds), beyond that the body scrolls.
   * On a screen under 640 art px wide (1024 × 768: 512) the window is as wide as the screen leaves
   * (WW_MIN at least) instead of scaled down, so its pixels stay whole: the cards are narrower (more
   * lines), and where the rules' hint column would be too narrow it is dropped and the note box
   * shows the focused row's hint.
   * @returns {PanelGeom}
   */
  _measureGeom() {
    const s = currentScale(this.element);
    const artW = s?.artW ?? 640, artH = s?.artH ?? 360;
    const WW = Math.max(WW_MIN, Math.min(WW0, (artW - 32) - ((artW - 32) % 2)));
    const WX = 320 - WW / 2;
    const L = WX + INSET, R = WX + WW - INSET, RX = L + LW + 12;
    const nP = this._presets.length;
    const CW = Math.floor((R - RX - 8) / COLS), cg = 3, HW = CW - 27 - 8;
    // the help's line pitch: the role's own in CJK, else G's 8 art px at --px 2 (16 font px)
    const hp = cjk() ? FONT.line.L : 16 * FONT.line.unit;
    const gs = Math.ceil(grow('small'));
    const lines = (/** @type {PanelPreset} */ q) => (q.help ? lineCount(null, q.help, 'line', HW, { lineH: cjk() ? null : 8 }) : 1);
    const rowsP = Math.ceil(nP / COLS);
    const cardH = (/** @type {number} */ hn) => Math.max(35, Math.ceil(15 + gs + capMid('line') + (hn - 1) * hp + inkNow('line') / 2 + 4));
    // each row of cards as tall as its own longest help …
    /** @type {number[]} */
    let CHs = [];
    for (let r = 0; r < rowsP; r++) CHs.push(cardH(Math.max(1, ...this._presets.slice(r * COLS, r * COLS + COLS).map(lines))));
    const gridOf = (/** @type {number[]} */ hs) => (rowsP ? hs.reduce((a, h) => a + h, 0) + (rowsP - 1) * cg : 0);
    const rulesH = 38 + 9 + 8 + 6 + this._fields.length * RP;
    // … or, as G, all as tall as the longest where the window holds that without scrolling
    const uniform = CHs.map(() => Math.max(35, ...CHs));
    // (the most the window grows to: G's WH_MAX on 360 art px, up to 24 more on a taller screen; on
    // a shorter one what keeps the window's margins on it — the body scrolls)
    const most = artH >= 360 ? Math.min(WH_MAX + 24, WH_MAX + (artH - 360)) : Math.max(200, artH - 32);
    if (rulesH + gridOf(uniform) + BOT_PAD <= most) CHs = uniform;
    const gridH = gridOf(CHs);
    const RHr = 38 + 9 + gridH + 8;
    const RY0r = RHr + 6;
    const BOTr = RY0r + this._fields.length * RP;
    // the left column: the longest class help, the party's slots, a note box of 40 at least
    const bl = Math.max(1, ...this._members.map((m) => (m.clsHelp ? lineCount(null, m.clsHelp, 'body', LW) : 1)));
    const SHr = 38 + 74 + bl * FONT.body.L + 8;
    const slotRows = Math.max(1, Math.ceil(Math.max(MAX_PARTY, this._members.length) / 3));
    const SYr = SHr + 7;
    const NYr = SYr + slotRows * 40 + (slotRows - 1) * 6 + 8;
    const leftBot = NYr + 40 + 2;
    // (G's window keeps 23 art px under the rules in English and 13 in Japanese: it grows only when
    // less than BOT_PAD would be left over the frame's bottom ornaments), up to `most` — but never
    // less than the left column needs
    const WH = Math.max(Math.min(most, Math.max(WH0, BOTr + BOT_PAD)), Math.min(WH_MAX, leftBot + BOT_PAD));
    const WY = artH >= 360 && WH <= WH_MAX ? Math.max(12, Math.round(184 - WH / 2)) : Math.round(180 - WH / 2);
    const CY = WY + 38;
    const labW = Math.max(0, ...this._fields.map((f) => measure(UP(f.label), 'small', 1)));
    const valW = Math.max(0, ...this._fields.flatMap((f) => f.values.map((v) => measure(f.labels[v], 'val'))));
    const la = RX + 20 + labW + 8;
    let vc = la + 9 + Math.ceil(valW / 2), ra = vc + Math.ceil(valW / 2) + 4;
    const hx = ra + 13;
    const hints = R - hx >= HINT_MIN;
    // (no hint column: the value centred between its arrows across the row)
    if (!hints) { ra = R - 9; vc = la + 9 + Math.floor((ra - 4 - la - 9) / 2); }
    const BOT = WY + BOTr;
    const NY = WY + NYr;
    let y = CY + 9;
    const CYs = CHs.map((h) => { const top = y; y += h + cg; return top; });
    return {
      WX, WW, WY, WH, L, R, RX, CY, HY: WY + 17, CW, CHs, CYs, HW, RH: WY + RHr, RY0: WY + RY0r, BOT, la, vc, ra, hx, hints,
      BY: CY + 74, SH: WY + SHr, SY: WY + SYr, NY, NH: Math.max(40, Math.min(WY + WH - BOT_PAD, Math.max(BOT, WY + leftBot - 2)) - 2 - NY), gs,
    };
  }

  /** Build the window for the data of this open: the frame, the header, the slots, the note box, the cards and the rows. */
  _build() {
    const el = this.element;
    const k = pal();
    el.textContent = '';
    this._stale = false;
    this._noteFit.clear();
    this._builtKey = this._layoutKey();
    const G = this._measureGeom();
    this._geom = G;
    const { WX, WW, WY, WH, L, R, RX, CY, HY } = G;
    const many = this._members.length > 1;

    // today's dim layer over the scene (a radial in hard steps), the root's size
    this._paintVeil();

    // A's window, nearly the whole screen; the content keeps 26 art px from its sides
    const w = group(el, 'mc', WX, WY, WW, WH, 'over lu-party__window');
    w.setAttribute('role', 'dialog');
    w.setAttribute('aria-label', tr('panel.aria'));
    this._window = w;
    win(w, { size: 'L', lattice: true, beads: 6, crown: true, trio: true, sides: true }, WX, WY, WW, WH);

    // the header: PARTY ◆ TACTICS at the left, the key hints at the right, a dim rule under both
    const head = wrap(w, 'header', 'lu-party__head', [WX, WY]);
    const party = tr('panel.party');
    txc(head, party, L, HY, { font: 'head', track: 1, color: k.tx1, drop: true, cls: `lu-party__kicker${caps()}` });
    const pw = measure(UP(party), 'head', 1);
    put(head, gemGlyph(2), L + pw + 6, HY - 3);
    txc(head, tr('panel.tactics'), L + pw + 16, HY, { font: 'small', track: 1, color: k.g4, drop: true, cls: `lu-party__kicker-sub${caps()}` });
    const foot = wrap(w, 'footer', 'lu-party__foot', [WX, WY]);
    /** @type {{ keys: string[], label: string }[]} */
    const hints = [
      { keys: ['↑', '↓'], label: tr('panel.choose') },
      { keys: ['←', '→'], label: tr('panel.change') },
      { keys: ['Space'], label: tr('panel.pick') },
      ...(many ? [{ keys: ['Q', 'E'], label: tr('panel.member') }] : []),
      { keys: this._closeKey && this._closeKey.toLowerCase() !== 'esc' ? ['Esc', this._closeKey] : ['Esc'], label: tr('panel.close') },
    ];
    keyHints(foot, hints, R, HY - 5.5, { align: 'right', color: k.tx2, drop: true, cls: 'lu-party__hint-key' });
    put(w, hairline(R - L, 'both', k.dm1), L, WY + 29);

    // the left column: the member (filled by _showMember), the party's slots, the note box
    this._memberEl = wrap(w, 'section', 'lu-party__member', [WX, WY]);
    this._buildSlots(w, G);
    this._buildNote(w, G);

    // the right column (scrolls only when the window is too short): presets, then the rules
    const bx = RX - 14, by = CY - 8;
    const body = box(make('div', 'lu-party__body'), [WX, WY], bx, by, R + 10 - bx, WY + WH - 8 - by);
    w.appendChild(body);
    this._body = body;
    this._subP = wrap(body, 'h3', 'lu-party__sub', [bx, by]);
    this._presetsEl = wrap(body, 'div', 'lu-party__presets', [bx, by]);
    this._presetsEl.setAttribute('role', 'listbox');
    this._presetsEl.setAttribute('aria-label', tr('panel.presets'));
    this._buildCards(G);
    this._subR = wrap(body, 'h3', 'lu-party__sub', [bx, by]);
    this._rulesEl = wrap(body, 'ul', 'lu-party__rules', [bx, by]);
    this._buildRows(G);
    this._rightWord = '';
    this._descKey = '';
  }

  /** The dim layer over the scene: G's radial in hard steps, as large as the root (in art px). */
  _paintVeil() {
    const s = currentScale(this.element);
    const W = (s?.artW ?? 640) + 1, H = (s?.artH ?? 360) + 1;
    const k = pal();
    const key = `${W}x${H}`;
    let v = this._veil;
    if (!v || this._veilKey !== key) {
      v = fade(W, H, rgbOf(k.dim), (u, q) => 0.6 + 0.28 * Math.min(1, Math.hypot((u - 0.5) / 0.5, (q - 0.5) / 0.5) ** 1.6), [0.6, 0.7, 0.8, 0.88]);
      v.setAttribute('aria-hidden', 'true');
      this._veil = v;
      this._veilKey = key;
    }
    put(this.element, v, 0, 0, 1, 'veil lu-party__veil');
  }

  /**
   * The party's slots (G: three, A's arrangement): a tab per member (its sprite on the gold card,
   * the shown one bright; its name and class · tactic as hidden text: the tab's text), EMPTY up to
   * MAX_PARTY; the PARTY n / 3 heading over them.
   * @param {HTMLElement} w @param {PanelGeom} G
   */
  _buildSlots(w, G) {
    const k = pal();
    const { L, SH, SY } = G;
    const tabs = wrap(w, 'nav', 'lu-party__tabs', [G.WX, G.WY]);
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', tr('panel.members'));
    const n = this._members.length;
    const slots = Math.max(MAX_PARTY, n);
    section(tabs, tr('panel.party'), L, L + LW, SH, tr('panel.count', { n: Math.min(n, slots), max: slots }), 'num');
    const SW = 40, sgap = Math.floor((LW - 3 * SW) / 2);
    this._tabs = [];
    for (let i = 0; i < slots; i++) {
      const x = L + (i % 3) * (SW + sgap), y = SY + Math.floor(i / 3) * (SW + 6);
      const m = this._members[i];
      if (!m) {
        const s = box(make('div', 'lu-party__slot lu-party__slot--empty'), [G.WX, G.WY], x, y, SW, SW);
        tabs.appendChild(s);
        win(s, { size: 'XS', tone: 'dim', corners: null, fill: k['slot-glass'], sheen: false, orn: false }, x, y, SW, SW);
        put(s, gemGlyph(3, GEMS.dusk(), { setting: [k.dm1, k.dm2, k.dm3] }), x + 16, y + 9);
        // (centred as G: the label's left at the slot's x + ⌊(40 − w) / 2⌋)
        const empty = tr('panel.empty');
        txt(s, empty, x + Math.floor((SW - measure(UP(empty), 'small', 1)) / 2), y + 29 - capMid('small'), { font: 'small', track: 1, color: k.tx3, cls: `lu-party__slot-label${caps()}` });
        continue;
      }
      const tab = box(make('div', 'lu-party__tab'), [G.WX, G.WY], x, y, SW, SW);
      tab.setAttribute('role', 'tab');
      tab.style.setProperty('--lu-member', m.color);
      tab.style.setProperty('--lu-member-text', m.text);
      tabs.appendChild(tab);
      const ramp = memberRamp(m.color);
      /** @type {FrameStyle} */
      const card = { size: 'S', notch: 3, corners: ramp, cornerR: 1, bands: [k['card-sel0'], k['card-sel1'], k['card-sel2']], stops: [0, 0.35, 0.7], sheen: false };
      tagFrame(win(tab, card, x, y, SW, SW), 'lu-party__tab-frame lu-party__tab-frame--off');
      tagFrame(win(tab, { ...card, sel: true }, x, y, SW, SW), 'lu-party__tab-frame lu-party__tab-frame--on');
      if (m.portrait) put(tab, spriteCrop(m.portrait, PORTRAIT_CROPS.slot.crop), x + 4, y + 4, 2, 'lu-party__tab-sprite');
      else put(tab, gemGlyph(6, ramp), x + 13, y + 13, 1, 'lu-party__tab-sprite');
      // the tab's text (for the tests' and a screen reader's reading; not drawn: the sprite is)
      const top = make('span', 'lu-party__tab-top lu-party__vh');
      top.appendChild(make('span', 'lu-party__chip'));
      const nm = make('span', 'lu-party__tab-name');
      nm.textContent = m.name;
      top.appendChild(nm);
      tab.appendChild(top);
      const subEl = make('span', 'lu-party__tab-sub lu-party__vh');
      const sub = document.createTextNode('');
      subEl.appendChild(sub);
      tab.appendChild(subEl);
      this._tabs.push({ el: tab, sub });
    }
    this._members.forEach((_, i) => this._refreshTab(i));
  }

  /** The note box (`.lu-party__desc`): the focused row's help, down to the rules' last row. @param {HTMLElement} w @param {PanelGeom} G */
  _buildNote(w, G) {
    const k = pal();
    const { L, NY, NH } = G;
    const d = box(make('div', 'lu-party__desc'), [G.WX, G.WY], L, NY, LW, NH);
    w.appendChild(d);
    win(d, { size: 'XS', tone: 'dim', corners: null, fill: k['card-glass'], sheen: false, orn: false }, L, NY, LW, NH);
    put(d, art(2, NH - 8, (p) => { p.vline(0, 0, NH - 8, k.g4); p.vline(1, 0, NH - 8, k.g2); }), L + 4, NY + 4);
    this._desc = d;
  }

  /** The preset cards: 2 columns (A's), each card a dim one, a focused one and the chosen one stacked. @param {PanelGeom} G */
  _buildCards(G) {
    const k = pal();
    const { RX, CY, CW, CHs, CYs, HW, gs } = G;
    const host = /** @type {HTMLElement} */ (this._presetsEl);
    const po = /** @type {[number, number]} */ ([RX - 14, CY - 8]);
    this._cards = this._presets.map((q, i) => {
      // (each row of cards as tall as its longest help: `_measureGeom`)
      const x = RX + (i % COLS) * (CW + 8), y = CYs[Math.floor(i / COLS)], CH = CHs[Math.floor(i / COLS)];
      const c = box(make('div', 'lu-party__card'), po, x, y, CW, CH);
      c.setAttribute('role', 'option');
      c.dataset.preset = q.name;
      host.appendChild(c);
      tagFrame(win(c, { size: 'XS', tone: 'dim', corners: null, fill: k['card-glass'], sheen: false, orn: false }, x, y, CW, CH), 'lu-party__card-frame lu-party__card-frame--dim');
      tagFrame(win(c, { size: 'XS', corners: GEMS.gold(), cornerR: 1, fill: k['card-glass'], sheen: false }, x, y, CW, CH), 'lu-party__card-frame lu-party__card-frame--focus');
      tagFrame(win(c, { size: 'S', notch: 3, sel: true, corners: GEMS.gold(), cornerR: 1, bands: [k['card-sel0'], k['card-sel1'], k['card-sel2']], stops: [0, 0.35, 0.7], sheen: false }, x, y, CW, CH), 'lu-party__card-frame lu-party__card-frame--sel');
      const ic = iconOf(PRESET_ICONS, q.name);
      if (ic) {
        put(c, icon(ic), x + 6, y + 4, 1, 'lu-party__card-icon lu-party__card-icon--on');
        put(c, icon(ic, DUSK_ICON()), x + 6, y + 4, 1, 'lu-party__card-icon lu-party__card-icon--off');
      }
      txc(c, q.label, x + 27, y + 9 + gs / 2, { font: 'small', track: 1, drop: true, cls: `lu-party__card-label${caps()}` });
      put(c, glyph('check'), x + CW - 15, y + 4, 1, 'lu-party__card-mark');
      if (q.help) txt(c, q.help, x + 27, y + 15 + gs, { font: 'line', maxW: HW, lineH: cjk() ? null : 8, drop: true, cls: 'lu-party__card-help' });
      put(c, art(CW, CH, (p) => p.rect(1, 1, CW - 2, CH - 2, 'rgba(244, 227, 179, 0.32)')), x, y, 1, 'lu-party__card-flash');
      put(c, glyph('cursor'), x - 9, y + Math.round(CH / 2) - 4, 1, 'lu-party__card-cursor nudge');
      return { el: c, flip: false };
    });
    host.classList.toggle('is-empty', !this._presets.length);
  }

  /** The rule rows: icon, LABEL, ◀ value ▶ with the pips under the value, the hint. @param {PanelGeom} G */
  _buildRows(G) {
    const k = pal();
    const { RX, R, RY0, la, vc, ra, hx } = G;
    const host = /** @type {HTMLElement} */ (this._rulesEl);
    const po = /** @type {[number, number]} */ ([RX - 14, G.CY - 8]);
    this._rows = this._fields.map((f, i) => {
      const ry = RY0 + i * RP;
      const x0 = RX - 4;
      const li = box(make('li', 'lu-party__row'), po, x0, ry, R + 4 - x0, RP);
      li.dataset.field = f.key;
      host.appendChild(li);
      put(li, selBand(R + 4 - x0, RP, { lines: 'dim' }), x0, ry, 1, 'lu-party__band');
      put(li, glyph('cursor'), RX - 11, ry + 6, 1, 'lu-party__cursor nudge');
      const ic = iconOf(FIELD_ICONS, f.key);
      if (ic) {
        put(li, icon(ic), RX, ry + 1, 1, 'lu-party__icon lu-party__icon--on');
        put(li, icon(ic, GOLD_ICON()), RX, ry + 1, 1, 'lu-party__icon lu-party__icon--off');
      }
      txt(li, f.label, RX + 20, ry + 9.5 - capMid('small'), { font: 'small', track: 1, drop: true, cls: `lu-party__label${caps()}` });
      const ctl = wrap(li, 'span', 'lu-party__control', [x0, ry]);
      const arrow = (/** @type {'l'|'r'} */ side, /** @type {number} */ ax) => {
        const a = box(make('span', `lu-party__arrow lu-party__arrow--${side}`), [x0, ry], ax - 3, ry + 1, 11, RP - 2);
        a.setAttribute('role', 'button');
        a.setAttribute('aria-label', side === 'l' ? tr('panel.prev', { field: f.label }) : tr('panel.next', { field: f.label }));
        const gname = side === 'l' ? 'left' : 'right';
        put(a, glyph(gname), ax, ry + 5, 1, 'lu-party__arrow-on');
        put(a, dimGlyph(gname), ax, ry + 5, 1, 'lu-party__arrow-off');
        return a;
      };
      ctl.appendChild(arrow('l', la));
      const valueWrap = wrap(ctl, 'span', 'lu-party__value', [x0, ry]);
      const value = txc(valueWrap, '', vc, ry + 7.5, { font: 'val', drop: true, cls: 'lu-party__value-t' });
      const valueText = document.createTextNode('');
      value.appendChild(valueText);
      const pp = pips(Math.max(1, f.values.length), 0, false);
      put(valueWrap, pp, vc - Math.floor(pp.width / 2), ry + 14, 1, 'lu-party__pips');
      ctl.appendChild(arrow('r', ra));
      const hint = txt(li, '', hx, ry + 9.5 - capMid('line'), { font: 'line', drop: true, cls: 'lu-party__hint' });
      const hintText = document.createTextNode('');
      hint.appendChild(hintText);
      return { el: li, value, valueText, valueAt: vc, hint, hintText, hintW: G.hints ? Math.max(20, R - hx) : 0, hintFull: '', hintCut: false, pips: pp, pipsKey: '', flip: false, origin: [x0, ry] };
    });
  }

  /**
   * The member shown: its portrait, name, class, role · weapon and the class's help (the left
   * column's top), its slot lit, its rule.
   * @param {number} i member index
   */
  _showMember(i) {
    this._m = Math.max(0, Math.min(this._members.length - 1, i));
    const m = this._members[this._m];
    this._tabs.forEach((tb, j) => {
      const on = j === this._m;
      tb.el.classList.toggle('is-on', on);
      tb.el.setAttribute('aria-selected', String(on));
    });
    const me = this._memberEl;
    const G = this._geom;
    if (me && G) {
      const k = pal();
      me.textContent = '';
      me.style.setProperty('--lu-member', m.color);
      me.style.setProperty('--lu-member-text', m.text);
      const { L, CY } = G;
      // the portrait: the member's sheet ×2 in a gilt frame on a glow of its colour
      if (m.portrait) put(me, portraitCanvas(m.portrait, { size: PORTRAIT_CROPS.tactics.size, crop: PORTRAIT_CROPS.tactics.crop, k: PORTRAIT_CROPS.tactics.k, glow: memberRamp(m.color)[0] }), L - 1, CY - 1, 1, 'lu-party__portrait');
      else {
        win(me, { size: 'XS', fill: k.ink1, sheen: false, corners: null, orn: false }, L, CY, 68, 68);
        put(me, gemGlyph(6, memberRamp(m.color)), L + 26, CY + 26, 1, 'lu-party__portrait');
      }
      // the name: the heading type when it fits beside the portrait, else the name type (two lines at most)
      const NX = L + 76, avail = G.RX - 8 - NX;
      const nm = UP(m.name);
      /** @type {'head'|'name'} */
      const nf = measure(nm, 'head', 1) <= avail ? 'head' : 'name';
      let wide = nf === 'name' && measure(nm, 'name', 1) > avail;
      let nl = wide ? lineCount(null, m.name, 'name', avail, { track: 1, cls: 'lu-party__name' }) : 1;
      // (more than two lines: one, cut with an ellipsis)
      const name = nl > 2 ? fit(m.name, 'name', avail, 1) : m.name;
      if (nl > 2) { wide = false; nl = 1; }
      const lh = FONT[nf].L;
      txt(me, name, NX, CY + 12 - capMid(nf) - ((nl - 1) * lh) / 2, { font: nf, track: 1, color: m.text, drop: true, maxW: wide ? avail : null, cls: `lu-party__name${caps()}` });
      // the class: its icon and its name; role · weapon under it
      const cls = make('span', `lu-party__class lu-party__wrap${m.cls ? '' : ' is-empty'}`);
      setOrigin(cls, [G.WX, G.WY]);
      me.appendChild(cls);
      if (m.cls) {
        const ic = iconOf(CLASS_ICONS, m.clsId);
        if (ic) put(cls, icon(ic), NX - 1, CY + 25, 1, 'lu-party__class-icon');
        // (a long class name — GREATSHIELD — loses its tracking, then shrinks to the column)
        const cx = ic ? NX + 18 : NX;
        const cw = G.RX - 8 - cx;
        // (tracked only while it stays clear of the presets' focus marker at RX − 14)
        const tr = measure(UP(m.cls), 'small', 1) <= cw - 8 ? 1 : 0;
        txt(cls, fit(UP(m.cls), 'small', cw, tr), cx, CY + 33 - capMid('small'), { font: 'small', track: tr, color: k.g4, drop: true, cls: `lu-party__class-t${caps()}` });
      }
      const rw = [m.role, m.weapon].filter(Boolean).join(sep());
      if (rw) txt(me, fit(rw, 'line', G.RX - 8 - NX), NX, CY + 50 - capMid('line'), { font: 'line', color: k.tx2, drop: true, cls: 'lu-party__role' });
      if (m.clsHelp) txt(me, m.clsHelp, L, G.BY, { font: 'body', color: k.tx2, maxW: LW, drop: true, cls: 'lu-party__class-help' });
    }
    this.element.dataset.member = m.id;
    this._refreshRule(0);
    this._focus(this._row);
  }

  /** @param {number} dir */
  _cycleMember(dir) {
    const n = this._members.length;
    if (n < 2) return;
    this._showMember((this._m + dir + n) % n);
    this._sound('menuSelect');
  }

  /** @param {number} i member index */
  _refreshTab(i) {
    const m = this._members[i];
    const tb = this._tabs[i];
    if (!m || !tb) return;
    const label = presetLabel(m.rule, this._presets, this._fields);
    const text = m.cls ? `${m.cls}${sep()}${label}` : label;
    if (tb.sub.nodeValue !== text) tb.sub.nodeValue = text;
  }

  /**
   * Show the shown member's rule: values, hints, pips, the current preset.
   * @param {number} dir the direction a value just changed in (-1 / 1; 0: none) — its text slides in
   * @param {number} [field] the row whose value changed
   */
  _refreshRule(dir, field = -1) {
    const m = this._members[this._m];
    if (!m) return;
    const fi = this._row - this._presetRows;
    this._fields.forEach((f, k) => {
      const row = this._rows[k];
      if (!row) return;
      const v = m.rule[f.key];
      const label = str(own(f.labels, v) ?? v);
      if (row.valueText.nodeValue !== label) {
        row.valueText.nodeValue = label;
        row.value.style.left = UR(row.valueAt - Math.floor(measure(label, 'val') / 2) - row.origin[0]);
      }
      // the hint in its column, cut to fit (none without the column: the note box shows it)
      const full = str(own(f.hints, v));
      const hint = row.hintW > 0 ? fit(full, 'line', row.hintW) : '';
      row.hintFull = full;
      row.hintCut = !!full && hint !== full;
      if (row.hintText.nodeValue !== hint) row.hintText.nodeValue = hint;
      this._paintPips(k, k === fi);
      if (k === field && dir) {
        // restart the slide-in by switching between two identical keyframes
        row.flip = !row.flip;
        row.value.classList.remove('is-in-l', 'is-in-r', 'is-in-l2', 'is-in-r2');
        row.value.classList.add(`is-in-${dir < 0 ? 'l' : 'r'}${row.flip ? '' : '2'}`);
      }
    });
    const cur = presetName(m.rule, this._presets, this._fields);
    this._cards.forEach((c, k) => {
      const on = this._presets[k].name === cur;
      c.el.classList.toggle('is-current', on);
      c.el.setAttribute('aria-selected', String(on));
    });
    this._headings(presetLabel(m.rule, this._presets, this._fields), cur === 'custom');
    this._refreshTab(this._m);
    // (the focused row's hint may have changed: the note box follows)
    if (this._geom) this._noteFocus();
  }

  /**
   * The two headings of the right column (PRESETS and RULES, G's `section`), their right word the
   * member's preset (or Custom); laid out again only when that word changes.
   * @param {string} word @param {boolean} custom
   */
  _headings(word, custom) {
    const G = this._geom;
    if (!G || !this._subP || !this._subR) return;
    if (word !== this._rightWord) {
      this._rightWord = word;
      this._subP.textContent = '';
      this._subR.textContent = '';
      this._currentEl = section(this._subP, tr('panel.presets'), G.RX, G.R, G.CY + 2, word, 'line', 'lu-party__current');
      section(this._subR, tr('panel.rules'), G.RX, G.R, G.RH, word, 'line', 'lu-party__current lu-party__current--rules');
    }
    this._currentEl?.classList.toggle('is-custom', custom);
    this._subR.querySelector('.lu-party__current--rules')?.classList.toggle('is-custom', custom);
  }

  /**
   * A row's pips (the value's place among its options; brighter on the focused row), repainted
   * only when that changes.
   * @param {number} k field index @param {boolean} focus
   */
  _paintPips(k, focus) {
    const row = this._rows[k];
    const f = this._fields[k];
    const m = this._members[this._m];
    if (!row || !f || !m) return;
    const n = Math.max(1, f.values.length);
    const at = Math.max(0, f.values.indexOf(m.rule[f.key]));
    const key = `${n}|${at}|${focus}`;
    if (row.pipsKey === key) return;
    row.pipsKey = key;
    const pp = pips(n, at, focus);
    pp.setAttribute('role', 'img');
    pp.setAttribute('aria-label', tr('panel.of', { i: at + 1, n }));
    pp.className = row.pips.className;
    pp.style.cssText = row.pips.style.cssText;
    row.pips.replaceWith(pp);
    row.pips = pp;
  }

  /**
   * The note box: the presets' note while the grid has the focus, else the focused field's label
   * and help — in the body type where it fits the box, else the line type (G's footer rule) — and,
   * when the row cannot show its value's hint whole (cut to its column, or no hint column on a
   * narrow window), that hint under the help after a small gem (the line type; the help gives way
   * to it where the box holds only one of them).
   * @param {string} label @param {string} text @param {string} [extra] the value's hint
   */
  _note(label, text, extra = '') {
    const d = this._desc;
    const G = this._geom;
    const key = `${label}\n${text}\n${extra}`;
    if (!d || !G || key === this._descKey) return;
    this._descKey = key;
    for (const e of [...d.querySelectorAll('.lu-party__desc-k, .lu-party__desc-t, .lu-party__desc-x')]) e.remove();
    const k = pal();
    const { L, NY, NH } = G;
    const fw = LW - 18, room = NH - 15 - 5;
    // (the line type's pitch: the role's own in CJK, else G's 9 art px at --px 2 — 18 font px)
    const lineP = cjk() ? FONT.line.L : 18 * FONT.line.unit;
    const lineOpt = { lineH: cjk() ? null : 9 };
    const fitKey = `${text}\n${extra}`;
    let fitted = this._noteFit.get(fitKey);
    if (!fitted) {
      const xl = extra ? lineCount(null, extra, 'line', fw - 8, lineOpt) : 0;
      const xh = xl ? 3 + xl * lineP : 0;
      const nb = text ? lineCount(null, text, 'body', fw) : 0;
      if (nb * FONT.body.L + xh <= room) fitted = { font: 'body', lines: nb, extra: xl };
      else {
        const nl = text ? lineCount(null, text, 'line', fw, lineOpt) : 0;
        fitted = nl * lineP + xh <= room || !xl ? { font: 'line', lines: nl, extra: xl } : { font: 'line', lines: 0, extra: xl };
      }
      this._noteFit.set(fitKey, fitted);
    }
    const ff = fitted.font;
    const fl = (ff === 'body' ? fitted.lines * FONT.body.L : fitted.lines * lineP) + (fitted.extra ? (fitted.lines ? 3 : 0) + fitted.extra * lineP : 0);
    const off = Math.max(0, Math.floor((room - fl) / 2));
    txc(d, label, L + 10, NY + 9 + off, { font: 'small', track: 1, color: k.g4, drop: true, cls: `lu-party__desc-k${caps()}` });
    let y = NY + 15 + off;
    if (fitted.lines) {
      const tx = txt(d, text, L + 10, y, { font: ff, color: k.tx2, maxW: fw, lineH: cjk() || ff === 'body' ? null : 9, drop: true, cls: 'lu-party__desc-t' });
      y += tx.lines * tx.lh + 3;
    }
    if (fitted.extra) {
      // (placed in the note box's own frame coordinates: its origin)
      const x = make('div', 'lu-party__desc-x lu-party__wrap');
      setOrigin(x, [L, NY]);
      d.appendChild(x);
      put(x, gemGlyph(1, GEMS.gold()), L + 10, Math.round(y + capMid('line') - 2.5));
      txt(x, extra, L + 18, y, { font: 'line', color: k.tx1, maxW: fw - 8, ...lineOpt, drop: true, cls: 'lu-party__desc-hint' });
    }
  }

  /** The note box for the focus now: the presets' note, or the focused row's label, help and (cut) hint. */
  _noteFocus() {
    if (this._row < this._presetRows) { this._note(tr('panel.presets'), tr('panel.presetsHelp')); return; }
    const fi = this._row - this._presetRows;
    const f = this._fields[fi];
    const row = this._rows[fi];
    if (f) this._note(f.label, f.help, row && row.hintCut ? row.hintFull : '');
  }

  /**
   * Move the focus to a row (and show its help); no sound.
   * @param {number} r
   */
  _focus(r) {
    const before = this._row - this._presetRows;
    this._row = Math.max(0, Math.min(this._rowCount - 1, r));
    const onPresets = this._row < this._presetRows;
    const ci = onPresets ? this._cardIndex() : -1;
    if (onPresets) this._col = ci - Math.floor(ci / COLS) * COLS;
    this._cards.forEach((c, k) => c.el.classList.toggle('is-focus', k === ci));
    this._presetsEl?.classList.toggle('is-focus', onPresets);
    const fi = this._row - this._presetRows;
    this._rows.forEach((row, k) => row.el.classList.toggle('is-sel', k === fi));
    if (before !== fi) { this._paintPips(before, false); this._paintPips(fi, true); }
    this._noteFocus();
    this._scrollToFocus();
  }

  /**
   * Scroll the body (only; it scrolls when the window is too short) so the focused card or row is
   * in view — the first row of the grid with the top of the body, the first field row with the
   * *Rules* heading. (The body is the offset parent of the cards and rows.)
   */
  _scrollToFocus() {
    const body = this._body;
    if (!body || body.scrollHeight <= body.clientHeight) return;
    const onPresets = this._row < this._presetRows;
    const el = onPresets ? this._cards[this._cardIndex()]?.el : this._rows[this._row - this._presetRows]?.el;
    if (!el) return;
    const head = !onPresets && this._row === this._presetRows ? /** @type {HTMLElement|null} */ (this._subR?.querySelector('.lu-party__sub-t') ?? null) : null;
    const top = onPresets && this._row === 0 ? 0 : head ? Math.min(el.offsetTop, head.offsetTop) : el.offsetTop;
    const bottom = el.offsetTop + el.offsetHeight;
    if (top < body.scrollTop) body.scrollTop = top;
    // (a card taller than the body keeps its top in view)
    else if (bottom > body.scrollTop + body.clientHeight) body.scrollTop = Math.min(top, bottom - body.clientHeight);
  }

  /** @param {number} i preset card index */
  _focusCard(i) {
    const k = Math.max(0, Math.min(this._presets.length - 1, i));
    this._row = Math.floor(k / COLS);
    this._col = k - this._row * COLS;
    this._focus(this._row);
  }

  /** @param {number} dir */
  _moveRow(dir) {
    const n = this._rowCount;
    if (n < 2) return;
    this._focus((this._row + dir + n) % n);
    this._sound('menuMove');
  }

  /** @param {number} dir */
  _horizontal(dir) {
    if (this._row < this._presetRows) {
      const n = this._presets.length;
      if (n < 2) return;
      this._focusCard((this._cardIndex() + dir + n) % n);
      this._sound('menuMove');
    } else this._step(this._row - this._presetRows, dir);
  }

  _confirm() {
    if (this._row < this._presetRows) this._pick(this._cardIndex());
    else this._step(this._row - this._presetRows, 1);
  }

  /**
   * The next / previous value of a field (wrapping), applied at once.
   * @param {number} k field index @param {number} dir
   */
  _step(k, dir) {
    const m = this._members[this._m];
    const f = this._fields[k];
    if (!m || !f || f.values.length < 2) return;
    const i = f.values.indexOf(m.rule[f.key]);
    const n = f.values.length;
    m.rule = { ...m.rule, [f.key]: f.values[(Math.max(0, i) + dir + n) % n] };
    this._refreshRule(dir, k);
    this._sound('menuSelect');
    this._emit(m);
  }

  /** @param {number} i preset index: its rule for the member shown */
  _pick(i) {
    const m = this._members[this._m];
    const p = this._presets[i];
    if (!m || !p) return;
    const same = this._fields.every((f) => m.rule[f.key] === p.rule[f.key]);
    this._sound('menuSelect');
    if (same) return;
    m.rule = { ...p.rule };
    this._refreshRule(0);
    // the picked card flashes once (in steps); restarted by switching between two identical keyframes
    const c = this._cards[i];
    c.flip = !c.flip;
    c.el.classList.toggle('is-picked-a', c.flip);
    c.el.classList.toggle('is-picked-b', !c.flip);
    this._emit(m);
  }

  /** @param {PanelMember} m */
  _emit(m) {
    if (this.onRule) this.onRule(m.id, /** @type {PartyRule} */ ({ ...m.rule }));
  }
}

// ---- layout helpers ---------------------------------------------------------------------------

/** A sheet canvas's id for the layout key (the same canvas, the same id). */
const SHEET_IDS = new WeakMap();
let sheetSeq = 0;
/** @param {HTMLCanvasElement|null} c */
function sheetId(c) {
  if (!c) return 0;
  let id = SHEET_IDS.get(c);
  if (!id) { id = ++sheetSeq; SHEET_IDS.set(c, id); }
  return id;
}

/**
 * A structural element that lays nothing out itself (display: contents): its children are placed
 * in the frame coordinates of `origin` (the positioned box it sits in).
 * @param {Element} parent @param {string} tag @param {string} cls @param {[number, number]} origin
 */
function wrap(parent, tag, cls, origin) {
  const e = make(tag, `${cls} lu-party__wrap`);
  setOrigin(e, origin);
  parent.appendChild(e);
  return e;
}

/** The canvases of a framed box tagged (the base and the ornaments). @param {{ base: HTMLCanvasElement, orn: HTMLCanvasElement|null }} f @param {string} cls */
function tagFrame(f, cls) {
  const c = cls.split(' ');
  f.base.classList.add(...c);
  f.orn?.classList.add(...c);
  return f;
}

/**
 * A section heading (G's `section`): the label (small, tracked, gilt), a gilt rule running right,
 * a word (or a count, `rf` 'num') at the right end x1; its ink centred on cy. Returns the word's
 * element (class `rightCls`).
 * @param {Element} g @param {string} label @param {number} x0 @param {number} x1 @param {number} cy
 * @param {string|null} right @param {'line'|'num'} rf @param {string} [rightCls]
 */
function section(g, label, x0, x1, cy, right, rf, rightCls = '') {
  const k = pal();
  txc(g, label, x0, cy, { font: 'small', track: 1, color: k.g4, drop: true, cls: `lu-party__sub-t${caps()}` });
  const lw = measure(UP(label), 'small', 1);
  const rw = right ? measure(right, rf) + 6 : 0;
  put(g, hairline(Math.max(4, x1 - x0 - lw - 6 - rw), 'r'), x0 + lw + 5, Math.round(cy));
  return right ? txc(g, right, x1, cy, { font: rf, color: k.g4, align: 'right', drop: true, cls: rightCls }) : null;
}

// ---- data (untrusted: names from level files and story files) -------------------------------

/**
 * The fields in order (`RULE_FIELDS`): each with at least one value (strings).
 * @param {unknown} fields @returns {PanelField[]}
 */
function cleanFields(fields) {
  if (!fields || typeof fields !== 'object') return [];
  /** @type {PanelField[]} */
  const out = [];
  for (const key of Object.keys(fields)) {
    const f = own(fields, key);
    if (!f || typeof f !== 'object') continue;
    const vals = own(f, 'values');
    const values = Array.isArray(vals) ? [...new Set(vals.filter((v) => typeof v === 'string' && v))] : [];
    if (!values.length) continue;
    /** @type {Record<string, string>} */
    const labels = Object.create(null);
    /** @type {Record<string, string>} */
    const hints = Object.create(null);
    for (const v of values) {
      labels[v] = str(own(own(f, 'labels'), v)) || v;
      hints[v] = str(own(own(f, 'hints'), v));
    }
    out.push({ key, label: str(own(f, 'label')) || key, help: str(own(f, 'help')), values, labels, hints });
  }
  return out;
}

/**
 * The presets in order (`PARTY_PRESETS`), their rules made full against the fields.
 * @param {unknown} presets @param {PanelField[]} fields @returns {PanelPreset[]}
 */
function cleanPresets(presets, fields) {
  if (!presets || typeof presets !== 'object') return [];
  /** @type {PanelPreset[]} */
  const out = [];
  for (const name of Object.keys(presets)) {
    const p = own(presets, name);
    if (!p || typeof p !== 'object') continue;
    const src = own(p, 'rule');
    /** @type {Record<string, string>} */
    const rule = {};
    for (const f of fields) {
      const v = own(src, f.key);
      rule[f.key] = typeof v === 'string' && f.values.includes(v) ? v : f.values[0];
    }
    out.push({ name, label: str(own(p, 'label')) || name, help: str(own(p, 'help')), rule });
  }
  return out;
}

/**
 * A full rule: each field's value when valid, else `prev`'s, else the first preset's, else the
 * field's first value.
 * @param {unknown} rule @param {PanelField[]} fields @param {PanelPreset[]} presets
 * @param {Record<string, string>} [prev]
 * @returns {Record<string, string>}
 */
function cleanRule(rule, fields, presets, prev) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of fields) {
    const v = own(rule, f.key);
    const ok = (/** @type {unknown} */ x) => typeof x === 'string' && f.values.includes(x);
    out[f.key] = ok(v) ? /** @type {string} */ (v)
      : ok(prev?.[f.key]) ? prev[f.key]
        : ok(presets[0]?.rule[f.key]) ? presets[0].rule[f.key] : f.values[0];
  }
  return out;
}

/**
 * @param {unknown} members @param {PanelField[]} fields @param {PanelPreset[]} presets
 * @returns {PanelMember[]}
 */
function cleanMembers(members, fields, presets) {
  if (!Array.isArray(members)) return [];
  /** @type {PanelMember[]} */
  const out = [];
  for (const m of members) {
    if (!m || typeof m !== 'object') continue;
    const id = str(own(m, 'id'));
    if (!id || out.some((x) => x.id === id)) continue;
    const color = safeColor(own(m, 'color'));
    const portrait = own(m, 'portrait');
    out.push({
      id,
      name: str(own(m, 'name')) || id,
      color,
      text: readableColor(color),
      cls: str(own(m, 'cls')),
      clsId: str(own(m, 'clsId')),
      clsHelp: str(own(m, 'clsHelp')),
      role: str(own(m, 'role')),
      weapon: str(own(m, 'weapon')),
      portrait: typeof HTMLCanvasElement !== 'undefined' && portrait instanceof HTMLCanvasElement && portrait.width >= 32 && portrait.height >= 32 ? portrait : null,
      rule: cleanRule(own(m, 'rule'), fields, presets),
    });
  }
  return out;
}

/**
 * The preset a rule matches field for field, or 'custom'.
 * @param {Record<string, string>} rule @param {PanelPreset[]} presets @param {PanelField[]} fields
 */
function presetName(rule, presets, fields) {
  for (const p of presets) if (fields.every((f) => p.rule[f.key] === rule[f.key])) return p.name;
  return 'custom';
}

/** @param {Record<string, string>} rule @param {PanelPreset[]} presets @param {PanelField[]} fields */
function presetLabel(rule, presets, fields) {
  const n = presetName(rule, presets, fields);
  return n === 'custom' ? tr('panel.custom') : presets.find((p) => p.name === n)?.label ?? n;
}
