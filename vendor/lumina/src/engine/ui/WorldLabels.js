import * as THREE from 'three';
import { RNG } from '../utils/math.js';
import { t, registerStrings } from '../i18n/I18n.js';
import worldfxStrings from '../i18n/strings/worldfx.js';
import { artScale, scaleRootOf, onScale } from './UiScale.js';
import { currentFonts } from './FontLoader.js';
import { pal, GEMS } from './art/palette.js';
import { art } from './art/painter.js';
import { gem } from './art/gilt.js';
import { gemGlyph } from './art/pieces.js';
import { bracket } from './art/combat.js';
import { roles, cjk, UP, measure, fit, styleText } from './layout/type.js';
import './ui.css';
import './combat.css';
import './worldfx.css';

/**
 * WorldLabels — world-anchored combat labels in one DOM layer (`.lu-worldfx`, COMBAT.md §13.2),
 * drawn after mockup G (docs/specs/PIXEL_UI.md §5, World labels): floating damage numbers (pool
 * 40), enemy HP bars / aggro pips (32 slots), off-screen edge arrows (8 slots), the '!' alert (pool
 * 8) and the lock-on reticle. Not depth-occluded (by design: 0 draw calls, crisp, not DOF-blurred).
 * Created by `UI.enableCombat()` on combat levels only.
 *
 * The look (G's family, in art pixels of the UI root's `--px`, docs/specs/PIXEL_UI.md §1.2):
 * - numbers in the type roles (layout/type.js) with G's `ol8` outline (eight ways and a drop, one art
 *   px, --g-nol): a hit, a companion's hit, a heal, MP, the player's hurt in `big` (--g-hit, --g-mint,
 *   --g-heal, --g-mp3, --g-hp3), a crit in `numL` (--g-crit); a word (Guard, Perfect!, translated:
 *   the 'worldfx' strings) in `name`. They move in whole art px with steps(): appear two art px low,
 *   hop one up, rest, rise ten art px one at a time, fade in three steps; a crit's and Perfect!'s
 *   pop is two frames at twice the size (an integer pop) then one two art px up; numbers at one
 *   anchor stack, and a word never overlaps another label (STACK_MS below);
 * - the enemy bar a 34 × 4 art-px pixel bar (an ink outline, the trough rows --g-tr0 / --g-tr1, the
 *   fill's ramp rows --g-hp3 / --g-hp1, the pale chip --g-g5 / --g-g4 trailing it), quantised to
 *   whole art px; an elite's gets a gilt ring and the line "Lv 3 BRAMBLE GOBLIN CAPTAIN" — "Lv" in
 *   `tiny`, the level in `num`, the name in tracked `small` capitals (`line` in Japanese and
 *   Chinese); the aggro pip a 7 × 7 ruby, the '!' alert in the ember ramp;
 * - the lock-on reticle G's four `bracket()` L-shapes stepping one art px in and out (0.7 s) round
 *   a ruby heart gem;
 * - edge arrows 8 pre-drawn octant sprites (an ember arrowhead, no free rotation), nudging one art
 *   px toward their enemy, flashing a hot frame in two steps while it winds up.
 * All art is painted once per page with the kit's painter (src/engine/ui/art/) into CSS url()
 * values on the layer.
 *
 * Performance rules: every element is created once in the constructor (pools); `update(dt,
 * camera)` projects the live labels with one view-projection matrix per frame and writes
 * `translate3d` only when the rounded pixel changes; bars fill with `transform: scaleX()` (whole
 * art px) plus a lagging second fill; CSS animations restart by toggling between two identical
 * keyframe names; no layout reads in the frame loop (the viewport size is cached by a
 * ResizeObserver; text is measured with canvas `measureText`, layout/type.js, when it changes).
 *
 * Anchors are read live: `anchor(vec3, offsetY)` / `alert(vec3, offsetY)` / `reticle(vec3,
 * offsetY)` keep the vector (not a copy) and add `offsetY` world units to its y every frame (like
 * `InteractPrompt` and the enemy defs' `labelY`). The art scale is the UI root's (`--px`, `--fpx`:
 * UiScale.js), followed through `onScale`.
 *
 * HUD panels (COMBAT-07): the layer sits under the HUD, so `setPanels()` (called by
 * `UI.enableCombat()` with the location plate, clock, minimap, controls legend, vitals, skill bar
 * and boss bar) makes every label keep out of the panels that are shown (6 px clear; panels less
 * than 48 px apart whose union box is not much bigger than the two — plate + vitals, clock +
 * minimap — count as one zone; the boss bar never merges, `PanelSpec.merge` false, so the open
 * lower middle above it stays free whatever the skill bar or the legend beside it measure): a
 * number, bar, pip,
 * alert or the reticle that would overlap one is moved just outside it (the smallest move that
 * stays on screen and clear of the other zones), and an edge arrow slides inward along its ray
 * until it clears the zone (it still points at its enemy). The labels' boxes are the drawn art and
 * text at every step of their motion (numbers: their role's line box, measured advance, pop and
 * rise). The panel rects are read in a ResizeObserver callback (after layout — re-armed by a class /
 * style change, a transition's end or a viewport resize), never in the frame loop; a panel hidden
 * by CSS (`visibility: hidden`: the controls legend under the boss bar or the death screen) does
 * not count. While it shows, the area banner's card counts as a panel too (an elite's label no
 * longer runs over 'MOSSY GLADE'). Still no depth occlusion (D9).
 *
 * Off-screen edge arrows stay apart along the border: two foes in one direction get two arrows
 * EDGE_SPACE art px apart, not two touching cells that read as one doubled arrow.
 *
 * The roles are the type's at the root's scale (type.js `roles()`: Japanese words in Noto Sans JP
 * at --px 2). A crit is Jersey 10 at twice the half-size font pixel (`_sizeK`): numL's own size at
 * an even --px, and a step over the hit's Jersey 15 at an odd one, where numL's whole art px gave
 * both the same 10-art-px cap at --px 3.
 */

const NUMBER_POOL = 40;
const BAR_POOL = 32;
const EDGE_POOL = 8;
const ALERT_POOL = 8;
/** Lifetimes in ms (wall clock, matching the CSS animations). */
const NUMBER_MS = 800;
const ALERT_MS = 800;
/** Edge arrows sit this far (art px) inside the viewport border. */
const EDGE_INSET = 12;
/** The least distance between two edge arrows' centres along the border (art px): their 17-art-px
 * cells and 2 art px between them. */
const EDGE_SPACE = 19;
/** Clearance (CSS px) between a label and a HUD panel it keeps out of (COMBAT-07). */
const PANEL_GAP = 6;
/**
 * Shown panels closer than this (CSS px) across one axis while overlapping along the other form one
 * keep-out zone (the location plate + vitals, the clock + minimap): a label never bounces between
 * two panels through a gap it does not fit in — but only when their union box is at most
 * ZONE_MERGE_AREA × the two boxes' areas (plate + vitals ≈ 1.2, clock + minimap ≈ 1.1). The union of
 * the controls legend and the boss bar (≈ 3.1) covered the open lower middle of the screen in
 * every boss fight and pushed labels there up beside the player; kept apart, a label between them
 * still clears both (`_clear` only takes a move that is clear of the other zones). The skill bar +
 * boss bar union measured 1.39–1.50 (1024 × 768 in every language, Chinese at 1280 × 720: the
 * boxes overlap or the CJK plate is taller) and merged under this rule, so a panel can opt out of
 * merging altogether (`PanelSpec.merge` false: the boss bar).
 */
const ZONE_MERGE = 48;
const ZONE_MERGE_AREA = 1.5;
/** ± art px of seeded scatter on a new number (12 CSS px at --px 2). */
const SCATTER = 6;
/**
 * Stacking: a number spawned within STACK_MS of another at the same anchor (±0.8 u) — a combo's
 * hits — starts one line (its role's line box) higher per earlier one and alternates sides by
 * STACK_SIDE art px (they used to fuse: "23" + "19" read "2319").
 *
 * Words (Guard, Perfect!) are wider than that side step (the party hitting a guarded boss fused
 * them into "Gu8rd10d", "Guardiard"), so a word never shares a spot: a word stacked on earlier
 * labels starts a full line up, not sideways, and every word is placed on the nearest spot clear of
 * every live label for as long as both are seen — their whole motion, their anchors as the camera
 * sees them now, where the HUD keep-out draws them (`_avoid`); a number keeps its place unless a
 * word is in its way (or the keep-out moves it onto another label: a stack pushed against a panel's
 * edge), then it takes the nearest clear spot the same way. The same word again at the same anchor
 * within STACK_MS of a live one is merged into it (not shown twice: "Guard" once, whoever's hit it
 * was).
 */
const STACK_MS = 520;
const STACK_SIDE = 9;
/** How far a number rises (art px, one at a time over its last 70 %; worldfx.css lu-num-*). */
const NUMBER_RISE = 10;
/**
 * The number's motion in ms (worldfx.css lu-num-* / lu-crit-* over NUMBER_MS 800, hard steps): 2 art
 * px low (a pop: twice the size, centred) until 6 %, 1 up (a pop: 2) until 12 %, at rest until 30 %,
 * then one art px up every 7 %; seen (opacity above 0) until 94 %.
 */
const HOP_MS = 48;
const REST_MS = 96;
const RISE_MS = 240;
const STEP_MS = 56;
const SEEN_MS = 752;
/**
 * Every label's CSS animation counts from its spawn (`_pin` sets its start time), so a frame shows
 * two labels at phases exactly their spawn times apart; the overlap test looks this many ms either
 * side of each sample (one sample step: it sees every step of the other label's motion).
 */
const PHASE_SLOP = 8;
/** Sample step (ms) of the overlap test: every step of the motion starts on it (48, 56 — 8's multiples). */
const PHASE_STEP = 8;
/** Clearance (art px) between a word and another label. */
const LABEL_GAP = 1;

/**
 * A number's lift at `age` ms (art px, up negative): worldfx.css lu-num-*, a pop's lu-crit-*.
 * @param {number} age
 * @param {boolean} pop
 */
function liftAt(age, pop) {
  if (age < HOP_MS) return pop ? 0 : 2;
  if (age < REST_MS) return pop ? -2 : -1;
  if (age < RISE_MS) return 0;
  return -Math.min(NUMBER_RISE, Math.floor((age - RISE_MS) / STEP_MS));
}

/**
 * The lowest and highest lift (art px) between the ages `a0` and `a1` ms (every step of the
 * motion starts on a multiple of PHASE_STEP: those and the ends are all its values).
 * @param {number} a0
 * @param {number} a1
 * @param {boolean} pop
 * @param {{ lo: number, hi: number }} out
 */
function liftSpan(a0, a1, pop, out) {
  let lo = liftAt(a0, pop);
  let hi = lo;
  for (let a = Math.ceil(a0 / PHASE_STEP) * PHASE_STEP; a <= a1; a += PHASE_STEP) {
    const l = liftAt(a, pop);
    if (l < lo) lo = l;
    else if (l > hi) hi = l;
  }
  out.lo = lo;
  out.hi = hi;
  return out;
}
const NUMBER_KINDS = new Set(['dmg', 'crit', 'hurt', 'heal', 'mp', 'guard', 'perfect', 'ally']);
/**
 * Kinds with a fixed text: the key of their word in the 'worldfx' strings (en 'Guard', 'Perfect!';
 * src/engine/i18n/strings/worldfx.js). The caller's text is ignored for them.
 */
const NUMBER_TEXT = Object.freeze({ guard: 'guard', perfect: 'perfect' });
/**
 * The same words when a caller passes them as the text of another kind (a companion's blocked
 * swing is `number(…, 'Guard', 'ally')`): shown translated, in the word role, in the kind's colour.
 */
const WORD_OF = Object.freeze({ Guard: 'guard', 'Perfect!': 'perfect' });
/** Kinds whose first two frames are an integer pop (twice the size). */
const POP_KINDS = new Set(['crit', 'perfect']);
/** A number's text that is a number (digits, a sign, a decimal point): else it is a word. */
const NUMERIC = /^[+\-−]?[0-9][0-9.,]*%?$/;
/** The longest elite name (art px) before it is cut with an ellipsis. */
const NAME_MAX = 150;

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---- pixel art ------------------------------------------------------------------------------

/**
 * Pixel-art SVG from a char map (one `<rect>` per horizontal run of a colour; '.' = empty), like the
 * interaction prompt's bubble. `shape-rendering: crispEdges`, so integer scales stay sharp.
 * (Kept for other modules; the layer's own art is painted with the kit's canvas painter.)
 * @param {string[]} rows
 * @param {Record<string, string>} colors
 * @returns {string} SVG markup
 */
export function pixelSvg(rows, colors) {
  const w = rows[0].length;
  const h = rows.length;
  let body = '';
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      if (ch !== '.' && colors[ch]) body += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${colors[ch]}"/>`;
      x += run;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${body}</svg>`;
}

/** CSS `url()` value of an SVG string (for background images set through custom properties). */
export function svgUrl(svg) {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// '!' alert, 7 × 12 art px: O ink, Y ember, H ember light, D ember dark
const ALERT = [
  '..OOO..',
  '.OHYYO.',
  '.OYYYO.',
  '.OYYDO.',
  '..OYO..',
  '..OYO..',
  '..ODO..',
  '...O...',
  '..OOO..',
  '.OHYYO.',
  '.ODDDO.',
  '..OOO..',
];

/** Edge-arrow sprite cell (art px): the arrowhead, its ink outline and the hot frame's halo. */
const EDGE_CELL = 17;
/**
 * The arrowhead pointing east (7 × 13, a right-angled tip) and north-east (9 × 9, the same area);
 * the other octants are their quarter turns.
 */
const ARROW_E = ['#......', '##.....', '###....', '####...', '#####..', '######.', '#######', '######.', '#####..', '####...', '###....', '##.....', '#......'];
const ARROW_NE = ['#########', '.########', '..#######', '...######', '....#####', '.....####', '......###', '.......##', '........#'];
/** Each octant's nudge (art px toward the enemy): 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE (screen y down). */
const OCT_DIR = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** A mask turned a quarter clockwise. @param {string[]} m */
function quarter(m) {
  const H = m.length;
  const W = m[0].length;
  const out = [];
  for (let y = 0; y < W; y++) {
    let r = '';
    for (let x = 0; x < H; x++) r += m[H - 1 - x][y];
    out.push(r);
  }
  return out;
}

/** The eight octant masks, index = octant (0 E, 1 SE … 7 NE). */
function octantMasks() {
  const e = ARROW_E, s = quarter(e), w = quarter(s), n = quarter(w);
  const ne = ARROW_NE, se = quarter(ne), sw = quarter(se), nw = quarter(sw);
  return [e, se, s, sw, w, nw, n, ne];
}

/**
 * One arrowhead into its sprite cell: lit from above (light along its top edges, shade along its
 * bottom ones, in every octant alike), an ink outline; `hot`: the bright frame with a ruby halo one
 * more pixel out.
 * @param {import('./art/painter.js').PixelPainter} p
 * @param {number} ox
 * @param {number} oy
 * @param {string[]} m
 * @param {boolean} hot
 */
function paintArrow(p, ox, oy, m, hot) {
  const k = pal();
  const H = m.length;
  const W = m[0].length;
  const x0 = ox + ((EDGE_CELL - W) >> 1);
  const y0 = oy + ((EDGE_CELL - H) >> 1);
  const on = (x, y) => y >= 0 && y < H && x >= 0 && x < W && m[y][x] === '#';
  const rim = (x, y) => !on(x, y) && (on(x + 1, y) || on(x - 1, y) || on(x, y + 1) || on(x, y - 1));
  const [lit, mid, dark] = hot ? [k.sel, k.em3, k.em2] : [k.em3, k.em2, k.em1];
  for (let y = -2; y < H + 2; y++) {
    for (let x = -2; x < W + 2; x++) {
      let col = null;
      if (on(x, y)) col = !on(x, y - 1) ? lit : !on(x, y + 1) ? dark : mid;
      else if (rim(x, y)) col = k.ink0;
      else if (hot && (rim(x + 1, y) || rim(x - 1, y) || rim(x, y + 1) || rim(x, y - 1))) col = k.rb2;
      if (col) p.px(x0 + x, y0 + y, col);
    }
  }
}

/** @param {HTMLCanvasElement} c */
const urlOf = (c) => `url("${c.toDataURL('image/png')}")`;

/** @type {Record<string, string>|null} the layer's art as CSS url() values (painted once per page) */
let ART = null;

/**
 * The layer's art, painted once with the kit (G's palette): custom property → url().
 * @returns {Record<string, string>}
 */
function layerArt() {
  if (ART) return ART;
  const k = pal();
  /** @type {Record<string, string>} */
  const a = {};
  // the enemy bar, 34 × 4: an ink outline round the trough rows (the fill and the chip are DOM
  // elements over it, scaled in whole art px)
  a['--lu-wf-bar'] = urlOf(art(34, 4, (p) => {
    p.rect(0, 0, 34, 4, k.ink0);
    p.hline(1, 1, 32, k.tr0);
    p.hline(1, 2, 32, k.tr1);
  }));
  // an elite's ring round it, 38 × 8: gilt (lit on top, shaded below) with cut corners, inked
  a['--lu-wf-ring'] = urlOf(art(38, 8, (p) => {
    p.hline(2, 0, 34, k.ink0); p.hline(2, 7, 34, k.ink0); p.vline(0, 2, 4, k.ink0); p.vline(37, 2, 4, k.ink0);
    p.px(1, 1, k.ink0); p.px(36, 1, k.ink0); p.px(1, 6, k.ink0); p.px(36, 6, k.ink0);
    p.hline(2, 1, 34, k.g5); p.hline(2, 6, 34, k.g2); p.vline(1, 2, 4, k.g4); p.vline(36, 2, 4, k.g3);
  }));
  // the aggro pip: a ruby, 7 × 7, set in ruby (lit top left)
  a['--lu-wf-pip'] = urlOf(art(7, 7, (p) => gem(p, 3, 3, 2, GEMS.ruby(), { setting: [k.rb3, k.rb2, k.rb1] })));
  // the '!' in the ember ramp
  a['--lu-wf-alert'] = urlOf(art(7, 12, (p) => p.rows(0, 0, ALERT, { O: k.ink0, Y: k.em2, H: k.em3, D: k.em1 })));
  // the lock-on: G's four brackets (14 × 14 each; [1, 1] the top-left one) and the ruby heart (7 × 7)
  a['--lu-wf-ret-tl'] = urlOf(bracket(1, 1));
  a['--lu-wf-ret-tr'] = urlOf(bracket(-1, 1));
  a['--lu-wf-ret-bl'] = urlOf(bracket(1, -1));
  a['--lu-wf-ret-br'] = urlOf(bracket(-1, -1));
  a['--lu-wf-heart'] = urlOf(gemGlyph(2, GEMS.ruby()));
  // the edge arrows: 8 octants side by side, the plain frames on top, the hot ones under them
  const masks = octantMasks();
  a['--lu-wf-edge'] = urlOf(art(EDGE_CELL * 8, EDGE_CELL * 2, (p) => {
    masks.forEach((m, o) => {
      paintArrow(p, o * EDGE_CELL, 0, m, false);
      paintArrow(p, o * EDGE_CELL, EDGE_CELL, m, true);
    });
  }));
  ART = a;
  return a;
}

/** Handle returned for an out-of-range slot (does nothing). */
const NOOP_HANDLE = Object.freeze({
  anchor() { return this; },
  set() { return this; },
  show() { return this; },
  hide() { return this; },
});

// ---- slot handles -----------------------------------------------------------------------------

/** One enemy bar slot (bar or aggro pip). */
class BarSlot {
  /**
   * @param {HTMLElement} layer
   * @param {WorldLabels} owner
   */
  constructor(layer, owner) {
    this._owner = owner;
    const el = document.createElement('div');
    el.className = 'lu-ebar';
    el.innerHTML = '<div class="lu-ebar__in"><div class="lu-ebar__name"><span class="lu-ebar__lv"></span>'
      + '<span class="lu-ebar__lvn"></span><span class="lu-ebar__nm"></span></div>'
      + '<div class="lu-ebar__frame"><i class="lu-ebar__lag"></i><i class="lu-ebar__fill"></i></div>'
      + '<i class="lu-ebar__pip"></i></div>';
    layer.appendChild(el);
    this.el = el;
    /** @type {HTMLElement} */
    this._fill = el.querySelector('.lu-ebar__fill');
    /** @type {HTMLElement} */
    this._lag = el.querySelector('.lu-ebar__lag');
    /** @type {HTMLElement} */
    this._nameEl = el.querySelector('.lu-ebar__name');
    /** The name line's parts: "Lv" (tiny), the level (num), the name (small; line in CJK). */
    /** @type {HTMLElement[]} */
    this._parts = [el.querySelector('.lu-ebar__lv'), el.querySelector('.lu-ebar__lvn'), el.querySelector('.lu-ebar__nm')];
    this._partText = this._parts.map((p) => {
      const tn = document.createTextNode('');
      p.appendChild(tn);
      return tn;
    });
    owner._styleNameParts(this._parts);
    /** @type {{ x: number, y: number, z: number }|null} anchor, read live (Vector3 or any xyz) */
    this.ref = null;
    this.oy = 0;
    this.on = false;
    this.out = false;
    this.x = NaN;
    this.y = NaN;
    this._q = -1;
    this._pip = false;
    this._elite = false;
    this._lv = -1;
    this._name = '';
    this._snap = true;
    this._snapClass = false;
    /** The name line as laid out (`_owner._layoutName`): width and left (art px), top (CSS px). */
    this._nameW = 0;
    this._nameL = 0;
    this._nameT = 0;
    /** The name the line was last laid out for after its font slices came in. */
    this._laidFor = '';
    /** The keep-out box (CSS px): half width, above and below the anchor (`_owner._barBox`). */
    this._bw = 0;
    this._bu = 0;
    this._bd = 0;
    owner._barBox(this);
  }

  /**
   * Follow a world point (read live every frame) plus `offsetY` world units.
   * @param {THREE.Vector3|{x:number,y:number,z:number}|null} vec3
   * @param {number} [offsetY]
   */
  anchor(vec3, offsetY = 0) {
    if (vec3 !== this.ref) { this.ref = vec3 ?? null; this._snap = true; this.x = NaN; }
    this.oy = +offsetY || 0;
    return this;
  }

  /**
   * @param {number} frac HP fraction 0..1
   * @param {{ elite?: boolean, level?: number, name?: string, pip?: boolean }} [opts]
   *   pip: only the small ruby (aggroed, undamaged); elite: the gilt ring + "Lv N NAME" (the name is
   *   shown as given: callers pass it translated, I18N.md §4.3)
   */
  set(frac, opts) {
    // a slot that just changed enemy (or was hidden) jumps its lag fill instead of draining it
    if (this._snap) {
      this._snap = false;
      if (!this._snapClass) { this._snapClass = true; this._lag.classList.add('is-snap'); }
    } else if (this._snapClass) {
      this._snapClass = false;
      this._lag.classList.remove('is-snap');
    }
    // whole art px of the 32 inside the frame: never empty above 0, never full below 1
    const f = frac > 0 ? (frac < 1 ? frac : 1) : 0;
    let q = Math.round(f * 32);
    if (f > 0 && q === 0) q = 1;
    else if (f < 1 && q === 32) q = 31;
    if (q !== this._q) {
      this._q = q;
      const s = `scaleX(${q / 32})`;
      this._fill.style.transform = s;
      this._lag.style.transform = s;
    }
    let box = false;
    let relayout = false;
    const pip = !!(opts && opts.pip);
    if (pip !== this._pip) { this._pip = pip; this.el.classList.toggle('is-pip', pip); box = true; }
    const elite = !!(opts && opts.elite);
    if (elite !== this._elite) {
      this._elite = elite;
      this.el.classList.toggle('is-elite', elite);
      box = true;
      // (laid out again: the scale may have changed while the slot showed a plain bar)
      relayout = elite;
    }
    if (elite) {
      const lv = opts.level | 0;
      const name = opts.name ? String(opts.name) : '';
      if (lv !== this._lv || name !== this._name) {
        this._lv = lv;
        this._name = name;
        relayout = true;
      }
    }
    // only on a change: set() runs every frame for every bar
    if (relayout) this._owner._layoutName(this);
    else if (box) this._owner._barBox(this);
    return this;
  }

  show() {
    if (!this.on) {
      this.on = true;
      this._snap = true;
      this.x = NaN;
      this.el.classList.add('is-on');
    }
    return this;
  }

  hide() {
    if (this.on) { this.on = false; this.el.classList.remove('is-on'); }
    return this;
  }
}

/** One off-screen edge-arrow slot. */
class EdgeSlot {
  constructor(layer) {
    const el = document.createElement('div');
    el.className = 'lu-edge';
    el.innerHTML = '<i class="lu-edge__glow"></i><i class="lu-edge__a"></i>';
    layer.appendChild(el);
    this.el = el;
    /** @type {{ x: number, y: number, z: number }|null} anchor, read live (Vector3 or any xyz) */
    this.ref = null;
    this.oy = 0;
    this.on = false;
    this.inside = false;
    this.x = NaN;
    this.y = NaN;
    /** This frame's place on the border before it is written (CSS px; `_spreadEdges` may move it). */
    this.tx = 0;
    this.ty = 0;
    /** On the top or bottom border (it gives room along x), else on a side (along y). */
    this.horiz = false;
    /** The octant shown (0 E, 1 SE … 7 NE), -1 before the first. */
    this.o = -1;
    this._windup = false;
  }

  /**
   * @param {THREE.Vector3|{x:number,y:number,z:number}|null} vec3 read live
   * @param {number} [offsetY] world units
   */
  anchor(vec3, offsetY = 0) {
    this.ref = vec3 ?? null;
    this.oy = +offsetY || 0;
    return this;
  }

  /** @param {{ windup?: boolean }} [opts] windup: the enemy telegraphs an attack (the arrow flashes) */
  set(opts) {
    const w = !!(opts && opts.windup);
    if (w !== this._windup) { this._windup = w; this.el.classList.toggle('is-windup', w); }
    return this;
  }

  show() {
    if (!this.on) { this.on = true; this.x = NaN; this.el.classList.add('is-on'); }
    return this;
  }

  hide() {
    if (this.on) { this.on = false; this.el.classList.remove('is-on'); }
    return this;
  }
}

// ---- component ------------------------------------------------------------------------------

/**
 * A HUD panel given to `setPanels` as a wrapper: `shown` says whether it counts right now; `box`
 * the element whose rect is the panel (default `el`: a component whose element covers the root and
 * whose drawn card is a child, the banner; additive); `merge` false keeps its keep-out zone apart
 * from every near panel's (default true: near panels with a compact union count as one zone; the
 * boss bar passes false; additive).
 * @typedef {{ el: HTMLElement, shown?: () => boolean, box?: () => (Element|null), merge?: boolean }} PanelSpec
 */
/**
 * A type role's box in CSS px at the current scale: `mid` the ink centre below the line box top
 * (whole device px), `L` the line box, `ink` the ink height.
 * @typedef {{ mid: number, L: number, ink: number }} RoleBox
 */
/**
 * A pooled floating number.
 * @typedef {object} NumberRec
 * @property {HTMLDivElement} el `.lu-num` (moved with translate3d)
 * @property {HTMLSpanElement} t `.lu-num__t` (the moving box: steps, fade, colour)
 * @property {HTMLSpanElement} x$ `.lu-num__x` (the text, styled in its role; the pop's size)
 * @property {Text} text
 * @property {string} str the text shown
 * @property {import('./layout/type.js').RoleId|''} role
 * @property {string} sk the role and size the text is styled in (`_styleNumber`)
 * @property {number} k its size factor (`_sizeK`)
 * @property {boolean} word a word (Guard, Perfect!: the `name` role), not a number
 * @property {boolean} pop
 * @property {boolean} live
 * @property {number} end its spawn time + NUMBER_MS (performance.now(); its motion's start pinned
 *   to the spawn: `_pin`)
 * @property {boolean} flip
 * @property {number} wx world anchor
 * @property {number} wy
 * @property {number} wz
 * @property {number} dx scatter / stack offset (CSS px)
 * @property {number} dy
 * @property {boolean} out
 * @property {number} x the drawn anchor (CSS px, rounded)
 * @property {number} y
 * @property {number} hw half the text's advance (CSS px, whole device px)
 * @property {number} mid the ink centre below the text's line box top (CSS px)
 * @property {number} mb the line box below the ink centre (CSS px)
 */

export class WorldLabels {
  /** @param {HTMLElement} root the UI root (`#luminati-ui`) */
  constructor(root) {
    this.root = root;
    registerStrings('worldfx', worldfxStrings);
    // the art scale: the UI root's (--px / --fpx, UiScale.js), else the window's
    this._sroot = scaleRootOf(root);
    this._scale = null;
    this._px = 2;
    this._fpx = 1;
    this._dpx = 1;
    /** @type {Map<string, RoleBox>} */
    this._roleBoxes = new Map();
    this._applyScale(this._sroot?.scale ?? null);

    const el = document.createElement('div');
    el.className = 'lu-worldfx';
    el.setAttribute('aria-hidden', 'true');
    for (const [prop, url] of Object.entries(layerArt())) el.style.setProperty(prop, url);
    // under the interaction prompt (same z-index, earlier in the DOM)
    root.insertBefore(el, root.querySelector(':scope > .lu-prompt') ?? root.firstChild);
    this.element = el;

    // paint order inside the layer: bars, edge arrows, alerts, reticle, numbers on top
    /** @type {BarSlot[]} */
    this._bars = [];
    for (let i = 0; i < BAR_POOL; i++) this._bars.push(new BarSlot(el, this));
    /** @type {EdgeSlot[]} */
    this._edges = [];
    for (let i = 0; i < EDGE_POOL; i++) this._edges.push(new EdgeSlot(el));

    this._alerts = [];
    for (let i = 0; i < ALERT_POOL; i++) {
      const a = document.createElement('div');
      a.className = 'lu-alert';
      a.innerHTML = '<i class="lu-alert__i"></i>';
      el.appendChild(a);
      this._alerts.push({ el: a, ref: null, oy: 0, end: 0, live: false, flip: false, out: false, x: NaN, y: NaN });
    }
    this._alertNext = 0;

    const ret = document.createElement('div');
    ret.className = 'lu-reticle';
    ret.innerHTML = '<i class="lu-reticle__c lu-reticle__c--tl"></i><i class="lu-reticle__c lu-reticle__c--tr"></i>'
      + '<i class="lu-reticle__c lu-reticle__c--bl"></i><i class="lu-reticle__c lu-reticle__c--br"></i>'
      + '<i class="lu-reticle__h"></i>';
    el.appendChild(ret);
    this._reticle = { el: ret, ref: null, oy: 0, on: false, out: false, x: NaN, y: NaN };

    /** @type {NumberRec[]} */
    this._nums = [];
    for (let i = 0; i < NUMBER_POOL; i++) {
      const n = document.createElement('div');
      n.className = 'lu-num';
      // the moving box (its own compositor layer: whole art px steps) round the styled text (its
      // edge filter painted into that layer on the device-pixel grid)
      const tEl = document.createElement('span');
      tEl.className = 'lu-num__t';
      const xEl = document.createElement('span');
      xEl.className = 'lu-num__x';
      const text = document.createTextNode('');
      xEl.appendChild(text);
      tEl.appendChild(xEl);
      n.appendChild(tEl);
      el.appendChild(n);
      this._nums.push({
        el: n, t: tEl, x$: xEl, text, str: '', role: '', sk: '', k: 1, word: false, pop: false, live: false, end: 0, flip: false,
        wx: 0, wy: 0, wz: 0, dx: 0, dy: 0, out: false, x: NaN, y: NaN, hw: NaN, mid: NaN, mb: 0,
      });
    }
    this._numNext = 0;
    /** Visual-only scatter RNG (never the combat RNG). */
    this._rng = new RNG(0x6d6e);
    /** The heights a new label must not take (`_forbid`): open intervals, flat [lo, hi, …] (CSS px). */
    /** @type {number[]} */
    this._iv = [];
    /** Label boxes about the ink centre (`_labelBox`): half width, up, down (CSS px). */
    this._boxN = { w: 0, u: 0, d: 0 };
    this._boxNp = { w: 0, u: 0, d: 0 };
    this._boxO = { w: 0, u: 0, d: 0 };
    this._boxOp = { w: 0, u: 0, d: 0 };
    this._span = { lo: 0, hi: 0 };
    /** A number's keep-out box (`_keepBox`): half width, up, down (CSS px). */
    this._keep = { w: 0, u: 0, d: 0 };
    /** @type {NumberRec[]} numbers spawned since the last `update`, which pins their motion (`_pin`) */
    this._pins = [];
    /** @type {Map<Element, NumberRec>} `_pin`'s animated elements → their numbers */
    this._pinEls = new Map();

    // the words a number can be: their font slices in before one is measured (CJK fonts come in
    // unicode-range slices; FontLoader.ensure)
    currentFonts()?.ensure(Object.values(NUMBER_TEXT).map((k) => t(`worldfx.${k}`)).concat(t('worldfx.lv')));

    this._vp = new THREE.Matrix4();
    this._m = this._vp.elements;
    this._ready = false;
    this._cx = 0;
    this._cy = 0;
    this._cw = 1;
    this._sx = 0;
    this._sy = 0;
    this._w = root.clientWidth || window.innerWidth;
    this._h = root.clientHeight || window.innerHeight;
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      this._w = root.clientWidth || window.innerWidth;
      this._h = root.clientHeight || window.innerHeight;
      if (this._applyScale(this._sroot?.scale ?? null)) this._refit();
      this._invalidate();
    }) : null;
    this._ro?.observe(root);
    // the root's 'scale' comes once the fonts follow the new --px (a CJK page's Jersey aliases
    // rebuilt): measure the text again then
    this._offScale = onScale(root, (s) => {
      this._applyScale(s);
      this._refit();
      this._invalidate();
    });

    /**
     * HUD panels the labels keep out of (`setPanels`): { el, shown, boxOf, solo, on, has, l, t, r, b }
     * — rect in root pixels, measured after layout; `solo`: never merged with another (merge false).
     */
    this._panels = [];
    this._panelOn = 0;
    /** Keep-out zones of this frame: the shown panels' rects grown by PANEL_GAP, near ones merged
     * (`solo`: a panel that never merges). */
    this._zones = [];
    for (let i = 0; i < 8; i++) this._zones.push({ l: 0, t: 0, r: 0, b: 0, solo: false });
    this._zoneN = 0;
    this._panelRo = null;
    this._panelMo = null;
    this._onPanelEnd = (e) => {
      for (const p of this._panels) {
        if (e.target === p.el) { this._remeasurePanels(); return; }
      }
    };
  }

  /**
   * HUD panels the labels stay out of (COMBAT-07; `UI.enableCombat()` passes the HUD's). A number,
   * bar, pip, alert or the reticle that would overlap a shown panel is moved just outside it (the
   * smallest move that stays on screen); an edge arrow slides inward along its ray until it clears
   * it. Replaces the previous list; `[]` turns it off. A non-empty list also keeps the labels out
   * of the area banner's card while it shows (the root's `.lu-banner`, found here).
   * @param {(HTMLElement | PanelSpec)[]} list shown: whether the panel counts right now (read
   *   once per frame, no DOM reads; default: while it has a box); box: the element measured; merge:
   *   false keeps its zone apart from near panels' (default true)
   */
  setPanels(list) {
    this._disconnectPanels();
    this._panels = [];
    const items = [...(list ?? [])];
    const banner = items.length ? this.root.querySelector(':scope > .lu-banner') : null;
    if (banner instanceof HTMLElement) {
      items.push({
        el: banner,
        box: () => banner.querySelector(':scope > .grp'),
        shown: () => banner.classList.contains('is-in') || banner.classList.contains('is-out'),
      });
    }
    for (const item of items) {
      // casts: the `typeof Element` guard keeps TS from narrowing `item` to the wrapper
      const el = typeof Element !== 'undefined' && item instanceof Element ? item : /** @type {PanelSpec} */ (item)?.el;
      if (!el) continue;
      const shown = el === item ? null : /** @type {PanelSpec} */ (item).shown ?? null;
      const boxOf = el === item ? null : /** @type {PanelSpec} */ (item).box ?? null;
      const solo = el !== item && /** @type {PanelSpec} */ (item).merge === false;
      this._panels.push({ el, shown, boxOf, solo, on: false, has: false, l: 0, t: 0, r: 0, b: 0 });
    }
    if (!this._panels.length || typeof ResizeObserver !== 'function') return;
    // measured in the observer's callback (after layout: no forced layout); observing the root too
    // gives a callback to re-arm (an element's first observation always reports while it renders)
    this._panelRo = new ResizeObserver(() => this._measurePanels());
    this._panelRo.observe(this.root);
    this._panelMo = typeof MutationObserver === 'function' ? new MutationObserver(() => this._remeasurePanels()) : null;
    for (const p of this._panels) {
      this._panelRo.observe(p.el);
      this._panelMo?.observe(p.el, { attributes: true, attributeFilter: ['class', 'style'] });
      p.el.addEventListener('transitionend', this._onPanelEnd);
      p.el.addEventListener('animationend', this._onPanelEnd);
    }
  }

  /**
   * A floating number at a world point (rises 10 art px in whole steps and fades over 0.8 s; seeded
   * ±6 art px scatter; numbers spawned in quick succession at the same anchor stack upward,
   * alternating sides). A word (Guard, Perfect!) never overlaps another label: it takes the nearest
   * clear spot (a stacked one a full line up), a number in a word's way moves off it, and the same
   * word again at the same anchor within 0.52 s of a live one is merged into it. The oldest number
   * is reused when all 40 are live.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {string|number} text ignored for 'guard' ('Guard') and 'perfect' ('Perfect!'), which show
   *   their word in the page's language; the text 'Guard' or 'Perfect!' of another kind is shown
   *   translated too
   * @param {'dmg'|'crit'|'hurt'|'heal'|'mp'|'guard'|'perfect'|'ally'} [kind] ('ally': a party
   *   companion's hit, PARTY.md §5.2)
   */
  number(x, y, z, text, kind = 'dmg') {
    const k = NUMBER_KINDS.has(kind) ? kind : 'dmg';
    const now = performance.now();
    // the text and its role: a word (translated) in `name`, a crit in `numL`, other numbers in `big`
    const wordKey = hasOwn(NUMBER_TEXT, k) ? NUMBER_TEXT[k] : typeof text === 'string' && hasOwn(WORD_OF, text) ? WORD_OF[text] : null;
    const str = wordKey ? t(`worldfx.${wordKey}`) : String(text ?? '');
    /** @type {import('./layout/type.js').RoleId} */
    const role = k === 'crit' && !wordKey ? 'numL' : wordKey || (str && !NUMERIC.test(str)) ? 'name' : 'big';
    const word = role === 'name';
    const near = (o) => Math.abs(o.wx - x) < 0.8 && Math.abs(o.wz - z) < 0.8 && Math.abs(o.wy - y) < 1.2;
    // the same word at this anchor, still young: it stands for this one too (whatever the kind)
    if (word) {
      for (let i = 0; i < NUMBER_POOL; i++) {
        const o = this._nums[i];
        if (o.live && o.word && o.str === str && o.end - now >= NUMBER_MS - STACK_MS && near(o)) return;
      }
    }
    const n = this._nums[this._numNext];
    this._numNext = (this._numNext + 1) % NUMBER_POOL;
    const pop = POP_KINDS.has(k);
    const size = this._sizeK(role);
    // earlier numbers at the same anchor that are still young: stack above them
    let stack = 0;
    for (let i = 0; i < NUMBER_POOL; i++) {
      const o = this._nums[i];
      if (o === n || !o.live || o.end - now < NUMBER_MS - STACK_MS) continue;
      if (near(o)) stack++;
    }
    n.wx = x;
    n.wy = y;
    n.wz = z;
    const px = this._px;
    const sx = this._rng.range(-SCATTER, SCATTER) * px;
    const sy = this._rng.range(-SCATTER, SCATTER) * px;
    if (stack === 0) {
      n.dx = sx;
      n.dy = sy;
    } else {
      // one line per earlier number: the role's line box and its outline and drop (a pop's half again);
      // a word a full line up over the middle (sideways it would cover the numbers either side)
      const line = (this._roleBox(role, size).L + 3 * px) * (pop ? 1.5 : 1);
      n.dx = word ? sx * 0.25 : (stack % 2 ? STACK_SIDE : -STACK_SIDE) * px + sx * 0.25;
      n.dy = -stack * line + sy * 0.2;
    }
    n.end = now + NUMBER_MS;
    n.live = true;
    n.word = word;
    n.pop = pop;
    this._styleNumber(n, role);
    if (str !== n.str) { n.str = str; n.text.nodeValue = str; }
    this._fitNumber(n);
    // (a word clear of every label; a number clear of the words)
    this._avoid(n, now);
    n.flip = !n.flip;
    n.el.className = `lu-num lu-num--${k} ${n.flip ? 'is-a' : 'is-b'}`;
    // its motion counts from now, not from the frame it is first drawn in (`update` pins it)
    this._pins.push(n);
    n.out = false;
    n.x = NaN;
    if (this._ready) this._placeNumber(n);
  }

  /**
   * Enemy bar slot (0..31): `{ anchor(vec3, offsetY), set(frac, { elite, level, name, pip }), show(), hide() }`.
   * The handle is persistent (same object for the same slot); an out-of-range slot returns a no-op handle.
   * @param {number} slot
   */
  bar(slot) {
    return this._bars[slot] ?? NOOP_HANDLE;
  }

  /**
   * Off-screen edge-arrow slot (0..7): `{ anchor(vec3, offsetY), set({ windup }), show(), hide() }`.
   * The arrow sits on the viewport border (inset 12 art px) on the line from the screen centre to
   * the anchor and points at it (the nearest of 8 octants); it hides itself while the anchor is
   * inside that inset rectangle.
   * @param {number} slot
   */
  edge(slot) {
    return this._edges[slot] ?? NOOP_HANDLE;
  }

  /**
   * '!' above a world point for 0.8 s, following it (pool 8; the oldest is reused).
   * @param {THREE.Vector3|{x:number,y:number,z:number}} vec3 read live
   * @param {number} [offsetY] world units
   */
  alert(vec3, offsetY = 0) {
    if (!vec3) return;
    const a = this._alerts[this._alertNext];
    this._alertNext = (this._alertNext + 1) % ALERT_POOL;
    a.ref = vec3;
    a.oy = +offsetY || 0;
    a.end = performance.now() + ALERT_MS;
    a.live = true;
    a.flip = !a.flip;
    a.out = false;
    a.x = NaN;
    a.el.className = `lu-alert ${a.flip ? 'is-a' : 'is-b'}`;
    if (this._ready) this._placeAlert(a);
  }

  /**
   * Lock-on reticle on a world point (read live), or null to hide it.
   * @param {THREE.Vector3|{x:number,y:number,z:number}|null} vec3
   * @param {number} [offsetY] world units
   */
  reticle(vec3, offsetY = 0) {
    const r = this._reticle;
    r.oy = +offsetY || 0;
    const on = !!vec3;
    if (vec3 !== r.ref) { r.ref = vec3 ?? null; r.x = NaN; }
    if (on !== r.on) { r.on = on; r.el.classList.toggle('is-on', on); }
  }

  /**
   * Project every live label (one `camera.updateMatrixWorld()` and one matrix multiply per frame).
   * `UI.update` calls it after the interaction prompt.
   * @param {number} dt
   * @param {THREE.Camera} camera
   */
  update(dt, camera) {
    if (!camera) return;
    camera.updateMatrixWorld();
    this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._ready = true;
    const now = performance.now();

    // the keep-out zones of this frame (panel rects are cached; `shown` reads JS / class state)
    const on = this._buildZones();

    const bars = this._bars;
    for (let i = 0; i < BAR_POOL; i++) {
      const b = bars[i];
      if (!b.on) continue;
      const r = b.ref;
      const vis = !!r && this._screen(r.x, r.y + b.oy, r.z);
      this._setOut(b, !vis);
      if (!vis) continue;
      // the bar hangs above its anchor (its box: `_barBox`)
      if (on) this._clear(this._sx, this._sy, b._bw, b._bu, b._bd);
      this._move(b, this._sx, this._sy);
    }

    const edges = this._edges;
    let shownEdges = 0;
    for (let i = 0; i < EDGE_POOL; i++) {
      const e = edges[i];
      if (e.on && this._placeEdge(e)) shownEdges++;
    }
    if (shownEdges > 1) this._spreadEdges();
    for (let i = 0; i < EDGE_POOL; i++) {
      const e = edges[i];
      if (e.on && !e.inside) this._moveEdge(e);
    }

    const alerts = this._alerts;
    for (let i = 0; i < ALERT_POOL; i++) {
      const a = alerts[i];
      if (!a.live) continue;
      if (now >= a.end) {
        a.live = false;
        a.ref = null;
        a.el.className = 'lu-alert';
        continue;
      }
      this._placeAlert(a);
    }

    const r = this._reticle;
    if (r.on) {
      const p = r.ref;
      const vis = this._screen(p.x, p.y + r.oy, p.z);
      this._setOut(r, !vis);
      if (vis) {
        // G's brackets reach 17 art px out from the heart (they step inward)
        const half = 17 * this._px + 1;
        if (on) this._clear(this._sx, this._sy, half, half, half);
        this._move(r, this._sx, this._sy);
      }
    }

    const nums = this._nums;
    for (let i = 0; i < NUMBER_POOL; i++) {
      const n = nums[i];
      if (!n.live) continue;
      if (now >= n.end) {
        n.live = false;
        n.el.className = 'lu-num';
        continue;
      }
      this._placeNumber(n);
    }
    if (this._pins.length) this._pin();
  }

  /**
   * Pin the motion of the numbers spawned since the last frame to their spawn times (their CSS
   * animations' start): a frame that comes late — after a long task, a stepped test's second of
   * play — shows every label at its age, as `_avoid` reads it, not fresh from that frame on. One
   * style update for all of them (`getAnimations`; no layout), once a frame with new numbers.
   */
  _pin() {
    const els = this._pinEls;
    for (const n of this._pins) {
      if (!n.live) continue;
      els.set(n.t, n);
      els.set(n.x$, n);
    }
    this._pins.length = 0;
    if (!els.size) return;
    for (const a of this.element.getAnimations({ subtree: true })) {
      const n = els.get(/** @type {KeyframeEffect|null} */ (a.effect)?.target);
      if (n) a.startTime = n.end - NUMBER_MS;
    }
    els.clear();
  }

  /** Hide every label (numbers, bars, pips, edge arrows, alerts and the reticle). */
  clear() {
    for (const n of this._nums) {
      if (!n.live) continue;
      n.live = false;
      n.el.className = 'lu-num';
    }
    for (const b of this._bars) b.hide();
    for (const e of this._edges) e.hide();
    for (const a of this._alerts) {
      if (!a.live) continue;
      a.live = false;
      a.ref = null;
      a.el.className = 'lu-alert';
    }
    this.reticle(null);
  }

  /** Number of live floating numbers (tests). */
  get liveNumbers() {
    let c = 0;
    for (const n of this._nums) if (n.live) c++;
    return c;
  }

  dispose() {
    this._ro?.disconnect();
    this._offScale?.();
    this._disconnectPanels();
    this._panels = [];
    this.element.remove();
  }

  // ------------------------------------------------------------------------------------------

  /**
   * Follow an art scale (the root's, else the window's): one art px in CSS px (`_px`), one font px
   * (`_fpx`), one device px (`_dpx`). Returns true when it changed.
   * @param {import('./UiScale.js').ArtScale|null} s
   */
  _applyScale(s) {
    const sc = s ?? artScale({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });
    const dpx = 1 / sc.dpr;
    if (sc.cssPx === this._px && sc.cssFpx === this._fpx && dpx === this._dpx && this._scale) return false;
    this._scale = sc;
    this._px = sc.cssPx;
    this._fpx = sc.cssFpx;
    this._dpx = dpx;
    this._roleBoxes.clear();
    return true;
  }

  /** A length in CSS px rounded to whole device px. @param {number} v */
  _snapPx(v) {
    return Math.round(v / this._dpx) * this._dpx;
  }

  /**
   * A role's box in CSS px at the current scale and language (cached until the scale changes), its
   * text `k` times the role's size.
   * @param {import('./layout/type.js').RoleId} role
   * @param {number} [k]
   * @returns {RoleBox}
   */
  _roleBox(role, k = 1) {
    const key = k === 1 ? role : `${role}*${k}`;
    let b = this._roleBoxes.get(key);
    if (!b) {
      const f = roles()[role];
      const u = (f.u === 'fpx' ? this._fpx : this._px) * k;
      b = { mid: this._snapPx(f.mid * u), L: f.L * u, ink: f.ink * u };
      this._roleBoxes.set(key, b);
    }
    return b;
  }

  /**
   * A number's size over its role's: a crit ('numL', Jersey 10 at one font pixel an art px) at
   * twice the half-size font pixel — 1 at an even --px; ⁴⁄₃ at --px 3 (4 device px a font pixel, a
   * 13⅓-art-px cap over the hit's 10, G's 4 : 3), ⁶⁄₅ at 5.
   * @param {import('./layout/type.js').RoleId} role
   */
  _sizeK(role) {
    const s = this._scale;
    return role === 'numL' && s ? (2 * s.fpx) / s.px : 1;
  }

  /**
   * Style a number's text in its role (once per role and size: pooled elements keep theirs).
   * @param {NumberRec} n
   * @param {import('./layout/type.js').RoleId} role
   */
  _styleNumber(n, role) {
    const k = this._sizeK(role);
    const sk = k === 1 ? role : `${role}*${k}`;
    n.role = role;
    n.k = k;
    if (sk === n.sk) return;
    n.sk = sk;
    const ts = n.x$.style;
    styleText(n.x$, role, { ol8: true });
    if (k !== 1) {
      // (a 'px' role at k: its font pixel is 2·--fpx, a whole number of device px)
      const f = roles()[role];
      const u = f.u === 'fpx' ? 'fpx' : 'px';
      ts.fontSize = `calc(var(--${u}) * ${+(f.em * k).toFixed(4)})`;
      ts.lineHeight = `calc(var(--${u}) * ${+(f.L * k).toFixed(4)})`;
    }
    // the pop's keyframes double the text's size (worldfx.css lu-pop-*)
    ts.setProperty('--lu-fs', ts.fontSize);
    ts.setProperty('--lu-lh', ts.lineHeight);
  }

  /**
   * Place a number's text so its ink is centred on the `.lu-num` anchor, on whole device px: its
   * measured half advance left, its ink centre up (the pop's keyframes read both).
   * @param {NumberRec} n
   */
  _fitNumber(n) {
    if (!n.role) return;
    const rb = this._roleBox(n.role, n.k);
    const hw = this._snapPx((measure(n.str, n.role) * this._px * n.k) / 2);
    const s = n.t.style;
    if (hw !== n.hw) {
      n.hw = hw;
      s.left = `${-hw}px`;
      s.setProperty('--lu-hw', `${hw}px`);
    }
    if (rb.mid !== n.mid) {
      n.mid = rb.mid;
      s.top = `${-rb.mid}px`;
      s.setProperty('--lu-mid', `${rb.mid}px`);
    }
    n.mb = rb.L - rb.mid;
  }

  /**
   * A label's box about its ink centre (CSS px): `w` half its width, `u` above, `d` below — its ink
   * at `k` times the size (a pop) and G's ol8 outline (one art px; the drop two below), one device px
   * more across (a CJK bold's copy, rounding).
   * @param {NumberRec} n
   * @param {number} k
   * @param {{ w: number, u: number, d: number }} out
   */
  _labelBox(n, k, out) {
    const px = this._px;
    const half = (this._roleBox(n.role || 'big', n.k).ink * k) / 2;
    out.w = (n.hw || 0) * k + px + 1;
    out.u = half + px;
    out.d = half + 2 * px;
    return out;
  }

  /**
   * Keep a new label off the others (`number`): a word off every live label, a number off the live
   * words (and, when the HUD keep-out moves it, off every live label) — where it would be drawn (its
   * spot, moved out of the HUD panels as `_placeNumber` moves it) unless one is in its way, else at
   * the nearest clear height (up on a tie) above or below that, across where it would be drawn:
   * clear of the others as they are drawn, out of the panels and on screen, so the keep-out never
   * moves it onto another (the boss's title card pushed the labels stacked into it down onto one
   * line: "Gu8rd10d"). Clear of another label means: for as long as both are seen, at every step of
   * both motions (each label's phase ± PHASE_SLOP ms), their boxes apart by LABEL_GAP art px; the
   * anchors and panels as they are now (a camera move after the spawn can still bring two labels of
   * different anchors together, or push one against a panel: the keep-out moves each label alone).
   * Only `n.dy` changes (and `n.dx` to where the keep-out moved it across). No layout reads (spawn
   * time, not the frame loop).
   * @param {NumberRec} n
   * @param {number} now performance.now() (a label's age counts from `end` − NUMBER_MS)
   */
  _avoid(n, now) {
    if (!this._ready || !this._screen(n.wx, n.wy, n.wz)) return;
    const ax = this._sx;
    const ay = this._sy;
    // the frame that draws n first samples the motions at its own time, the document timeline's —
    // behind `now` by the time this frame has run (a long task: much): n on its first step then,
    // the others younger than they are now
    const tl = document.timeline?.currentTime;
    const lag = typeof tl === 'number' ? Math.max(0, now - tl) : 0;
    // its spot, and where it would be drawn (moved out of the panels)
    this._numberSpot(n, ax, ay, false);
    const xs = this._sx;
    const ys = this._sy;
    this._numberSpot(n, ax, ay, true);
    const x0 = this._sx;
    const y0 = this._sy;
    // (a number moved by the keep-out has left its stack's row: kept off every label then, else
    // the keep-out piles a stack onto one line at the panel's edge)
    const moved = x0 !== xs || y0 !== ys;
    if (!n.word && !this._blocked(y0, this._forbid(n, now, lag, x0, false, !moved))) return;
    // the height clear of the others, the panels and the screen's edges, across where it is drawn
    const m = this._forbid(n, now, lag, x0, true, false);
    if (!m) return;
    if (x0 !== xs) n.dx = x0 - ax;
    n.dy = this._nearest(y0, m) - ay;
  }

  /**
   * Fill `_iv` with the heights (open intervals of the drawn anchor's y, CSS px) at which `n`, drawn
   * at `x` across, would overlap a live label (`wordsOnly`: a live word) as it is drawn, at some step
   * of the time both are seen — from `lag` ms before now (n held on its first step, as a frame drawn
   * at that time shows it) on; `edges`: also where its motion's box would reach into a HUD panel's
   * keep-out zone or off the screen's top or bottom. Returns the array's length.
   * @param {NumberRec} n
   * @param {number} now performance.now()
   * @param {number} lag how far the current frame's time is behind `now` (ms)
   * @param {number} x n's drawn anchor across (CSS px)
   * @param {boolean} edges
   * @param {boolean} wordsOnly
   */
  _forbid(n, now, lag, x, edges, wordsOnly) {
    const iv = this._iv;
    let m = 0;
    const px = this._px;
    const gap = LABEL_GAP * px;
    const bN = this._labelBox(n, 1, this._boxN);
    const bNp = n.pop ? this._labelBox(n, 2, this._boxNp) : bN;
    for (let i = 0; i < NUMBER_POOL; i++) {
      const o = this._nums[i];
      if (o === n || !o.live || (wordsOnly && !o.word)) continue;
      const ageO = now - (o.end - NUMBER_MS);
      // the time both are seen (o's phase up to PHASE_SLOP late)
      const shared = Math.min(SEEN_MS, SEEN_MS + PHASE_SLOP - ageO);
      if (shared <= 0 || !this._screen(o.wx, o.wy, o.wz)) continue;
      // where o is drawn: its centre across from n's, its anchor's height
      this._numberSpot(o, this._sx, this._sy, true);
      const ox = this._sx - x;
      const oy = this._sy;
      const bO = this._labelBox(o, 1, this._boxO);
      const bOp = o.pop ? this._labelBox(o, 2, this._boxOp) : bO;
      if (Math.abs(ox) >= bNp.w + bOp.w + gap) continue;
      let lastLo = NaN;
      let lastHi = NaN;
      // (n's age t: below 0 it shows its first step; o's then from its own first step on)
      for (let t = -Math.min(lag, ageO); t < shared; t = t < 0 ? Math.min(0, t + PHASE_STEP) : t + PHASE_STEP) {
        const a0 = Math.max(0, ageO + t - PHASE_SLOP);
        if (a0 >= SEEN_MS) break;
        const a1 = Math.min(ageO + t + PHASE_SLOP, SEEN_MS - 1);
        const nb = n.pop && t < HOP_MS ? bNp : bN;
        const ob = o.pop && a0 < HOP_MS ? bOp : bO;
        if (Math.abs(ox) >= nb.w + ob.w + gap) continue;
        const lift = liftAt(t, n.pop) * px;
        // o's lift over its phase window
        const span = liftSpan(a0, a1, o.pop, this._span);
        const lo = oy + span.lo * px - ob.u - gap - lift - nb.d;
        const hi = oy + span.hi * px + ob.d + gap - lift + nb.u;
        if (lo === lastLo && hi === lastHi) continue;
        lastLo = lo;
        lastHi = hi;
        iv[m++] = lo;
        iv[m++] = hi;
      }
    }
    if (edges) {
      // the box `_placeNumber` keeps out of the panels (its whole motion), and the screen
      const k = this._keepBox(n);
      if (this._panelOn) {
        for (let i = 0; i < this._zoneN; i++) {
          const z = this._zones[i];
          if (x + k.w <= z.l || x - k.w >= z.r) continue;
          iv[m++] = z.t - k.d;
          iv[m++] = z.b + k.u;
        }
      }
      iv[m++] = -Infinity;
      iv[m++] = k.u;
      iv[m++] = this._h - k.d;
      iv[m++] = Infinity;
    }
    iv.length = m;
    return m;
  }

  /**
   * Whether `y` lies inside one of the first `m / 2` intervals of `_iv`.
   * @param {number} y
   * @param {number} m
   */
  _blocked(y, m) {
    const iv = this._iv;
    for (let i = 0; i < m; i += 2) if (iv[i] < y && y < iv[i + 1]) return true;
    return false;
  }

  /**
   * The height nearest `y0` outside every interval of `_iv` (the one up on a tie; `y0` when none
   * is clear: a screen too full).
   * @param {number} y0
   * @param {number} m
   */
  _nearest(y0, m) {
    const iv = this._iv;
    let up = y0;
    for (let moved = true; moved;) {
      moved = false;
      for (let i = 0; i < m; i += 2) {
        if (iv[i] < up && up < iv[i + 1]) { up = iv[i]; moved = true; }
      }
    }
    let dn = y0;
    for (let moved = true; moved;) {
      moved = false;
      for (let i = 0; i < m; i += 2) {
        if (iv[i] < dn && dn < iv[i + 1]) { dn = iv[i + 1]; moved = true; }
      }
    }
    const okUp = up > -Infinity;
    const okDn = dn < Infinity;
    if (okUp && (!okDn || y0 - up <= dn - y0)) return up;
    return okDn ? dn : y0;
  }

  /** Measure the live text again (a new scale, the fonts in). */
  _refit() {
    for (const n of this._nums) {
      if (!n.role) continue;
      this._styleNumber(n, n.role);
      this._fitNumber(n);
    }
    for (const b of this._bars) {
      if (b._elite) this._layoutName(b);
      else this._barBox(b);
    }
  }

  /**
   * Style the name line's three parts in their roles (once: the language is the page's).
   * @param {HTMLElement[]} parts "Lv", the level, the name
   */
  _styleNameParts(parts) {
    const c = cjk();
    styleText(parts[0], 'tiny', { ol: true, drop: true });
    styleText(parts[1], 'num', { ol: true, drop: true });
    // a CJK name (anti-aliased, its outline a font px) gets the numbers' art-px outline over the world
    styleText(parts[2], c ? 'line' : 'small', c ? { ol8: true } : { ol: true, drop: true, track: 1 });
  }

  /**
   * Lay out an elite's name line (on a change of its level, name or the scale): "Lv" + 2 + the level
   * + 4 + the name, each part's ink centred on one line 3 art px over the ring's top, the line centred
   * over the bar on whole art px; then its keep-out box.
   * @param {BarSlot} b
   */
  _layoutName(b) {
    const c = cjk();
    const nameRole = c ? 'line' : 'small';
    const track = c ? 0 : 1;
    const hasLv = b._lv > 0;
    const lvText = hasLv ? t('worldfx.lv') : '';
    const lvNum = hasLv ? String(b._lv) : '';
    const name = b._name ? fit(c ? b._name : UP(b._name), nameRole, NAME_MAX, track) : '';
    const texts = [lvText, lvNum, name];
    const roles = /** @type {import('./layout/type.js').RoleId[]} */ (['tiny', 'num', nameRole]);
    const widths = [hasLv ? measure(lvText, 'tiny') : 0, hasLv ? measure(lvNum, 'num') : 0, name ? measure(name, nameRole, track) : 0];
    const gaps = [hasLv ? 2 : 0, hasLv && name ? 4 : 0, 0];
    const W = widths[0] + gaps[0] + widths[1] + gaps[1] + widths[2];
    const px = this._px;
    const left0 = -Math.round(W / 2);
    // the line's ink centre: its tallest ink's bottom 3 art px over the ring's top (6 art px up)
    let ink = 0;
    for (let i = 0; i < 3; i++) if (texts[i]) ink = Math.max(ink, this._roleBox(roles[i]).ink);
    const rc = -9 * px - ink / 2;
    let top = Infinity;
    let bottom = -Infinity;
    const tops = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const rb = this._roleBox(roles[i]);
      tops[i] = this._snapPx(rc - rb.mid);
      if (!texts[i]) continue;
      top = Math.min(top, tops[i]);
      bottom = Math.max(bottom, tops[i] + rb.L);
    }
    if (!(top < bottom)) { top = rc; bottom = rc; }
    const ns = b._nameEl.style;
    ns.left = `${left0 * px}px`;
    ns.top = `${top}px`;
    ns.width = `${W * px}px`;
    ns.height = `${bottom - top}px`;
    let x = 0;
    for (let i = 0; i < 3; i++) {
      if (b._partText[i].nodeValue !== texts[i]) b._partText[i].nodeValue = texts[i];
      const s = b._parts[i].style;
      s.left = `${x * px}px`;
      s.top = `${tops[i] - top}px`;
      x += widths[i] + gaps[i];
    }
    b._nameW = W;
    b._nameL = left0;
    b._nameT = top;
    this._barBox(b);
    // a new name's font slices (Japanese, Chinese): measure again once they are in
    if (name) {
      const key = b._name;
      const lv = b._lv;
      currentFonts()?.ensure(name).then(() => {
        if (b._elite && b._name === key && b._lv === lv && b._laidFor !== key) {
          b._laidFor = key;
          this._layoutName(b);
        }
      });
    }
  }

  /**
   * A bar slot's keep-out box (CSS px from its anchor): the 34 × 4 bar over the anchor; an elite's
   * ring 2 art px round it and its name line over it; a pip's 7 × 7 ruby.
   * @param {BarSlot} b
   */
  _barBox(b) {
    const px = this._px;
    if (b._pip) {
      b._bw = 4 * px + 1;
      b._bu = 7 * px + 1;
      b._bd = 2;
    } else if (b._elite) {
      const nl = b._nameL;
      const nw = b._nameW;
      const nameHalf = nw > 0 ? Math.max(-nl, nl + nw) * px + px : 0;
      b._bw = Math.max(19 * px, nameHalf) + 1;
      b._bu = Math.max(6 * px, nw > 0 ? -b._nameT + px : 0) + 2;
      b._bd = 2 * px + 2;
    } else {
      b._bw = 17 * px + 1;
      b._bu = 4 * px + 2;
      b._bd = 2;
    }
  }

  /** Clip coordinates of a world point with the cached view-projection matrix. */
  _clip(x, y, z) {
    const m = this._m;
    this._cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    this._cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    this._cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  }

  /**
   * Screen position (CSS px) into `_sx`, `_sy`.
   * @returns {boolean} false when behind the camera or well outside the view
   */
  _screen(x, y, z) {
    this._clip(x, y, z);
    const w = this._cw;
    if (!(w > 1e-4)) return false;
    const nx = this._cx / w;
    const ny = this._cy / w;
    if (nx < -1.25 || nx > 1.25 || ny < -1.25 || ny > 1.35) return false;
    this._sx = (nx * 0.5 + 0.5) * this._w;
    this._sy = (0.5 - ny * 0.5) * this._h;
    return true;
  }

  _move(rec, x, y) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    if (rx !== rec.x || ry !== rec.y) {
      rec.x = rx;
      rec.y = ry;
      rec.el.style.transform = `translate3d(${rx}px,${ry}px,0)`;
    }
  }

  _setOut(rec, out) {
    if (out !== rec.out) {
      rec.out = out;
      rec.el.classList.toggle('is-out', out);
    }
  }

  /** @param {NumberRec} n */
  _placeNumber(n) {
    const vis = this._screen(n.wx, n.wy, n.wz);
    this._setOut(n, !vis);
    if (!vis) return;
    this._numberSpot(n, this._sx, this._sy, true);
    this._move(n, this._sx, this._sy);
  }

  /**
   * A number's box at every step of its motion, as the keep-out moves it (CSS px about its drawn
   * anchor): its line box round the ink centre (twice the size in a pop's first frames), the
   * outline, the start 2 art px low, the 10 art px rise. Shared object (`_keep`).
   * @param {NumberRec} n
   */
  _keepBox(n) {
    const px = this._px;
    const k = n.pop ? 2 : 1;
    const b = this._keep;
    b.w = (n.hw || 0) * k + px + 2;
    b.u = Math.max(n.mid * k, n.mid + (NUMBER_RISE + 2) * px) + px + 2;
    b.d = Math.max(n.mb * k, n.mb + 2 * px) + 2 * px + 2;
    return b;
  }

  /**
   * Where a number whose anchor is on screen at (sx, sy) is drawn, into `_sx`, `_sy`: its offset, the
   * whole text on screen across (an enemy at the screen's edge) and, `zones`, moved out of the HUD
   * panels' keep-out (`_clear`).
   * @param {NumberRec} n
   * @param {number} sx
   * @param {number} sy
   * @param {boolean} zones
   */
  _numberSpot(n, sx, sy, zones) {
    let x = sx + n.dx;
    const y = sy + n.dy;
    const k = this._keepBox(n);
    if (x - k.w < 0) x = k.w;
    else if (x + k.w > this._w) x = this._w - k.w;
    if (zones && this._panelOn) {
      this._clear(x, y, k.w, k.u, k.d);
      return;
    }
    this._sx = x;
    this._sy = y;
  }

  _placeAlert(a) {
    const p = a.ref;
    const vis = this._screen(p.x, p.y + a.oy, p.z);
    this._setOut(a, !vis);
    if (!vis) return;
    // the '!' (7 × 12 art px over its anchor) appears 3 art px low and hops 2 up
    if (this._panelOn) this._clear(this._sx, this._sy, 4.5 * this._px + 1, 15 * this._px, 4 * this._px + 1);
    this._move(a, this._sx, this._sy);
  }

  /**
   * Build this frame's keep-out zones from the shown panels (grown by PANEL_GAP; panels within
   * ZONE_MERGE of each other merged when their union is compact, ZONE_MERGE_AREA, and neither is
   * `solo`). Returns the number of shown panels.
   */
  _buildZones() {
    const P = this._panels;
    const Z = this._zones;
    let on = 0;
    let n = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.on = p.has && (!p.shown || !!p.shown());
      if (!p.on) continue;
      on++;
      if (n >= Z.length) Z.push({ l: 0, t: 0, r: 0, b: 0, solo: false });
      const z = Z[n++];
      z.solo = p.solo;
      z.l = p.l - PANEL_GAP;
      z.t = p.t - PANEL_GAP;
      z.r = p.r + PANEL_GAP;
      z.b = p.b + PANEL_GAP;
    }
    // merge near neighbours (≤ 7 panels: a few passes of a tiny pairwise loop)
    for (let merged = true; merged;) {
      merged = false;
      for (let a = 0; a < n && !merged; a++) {
        for (let b = a + 1; b < n; b++) {
          const A = Z[a];
          const B = Z[b];
          if (A.solo || B.solo) continue;
          const gapX = Math.max(A.l, B.l) - Math.min(A.r, B.r);
          const gapY = Math.max(A.t, B.t) - Math.min(A.b, B.b);
          if (!((gapX < 0 && gapY < ZONE_MERGE) || (gapY < 0 && gapX < ZONE_MERGE))) continue;
          const union = (Math.max(A.r, B.r) - Math.min(A.l, B.l)) * (Math.max(A.b, B.b) - Math.min(A.t, B.t));
          if (union > ZONE_MERGE_AREA * ((A.r - A.l) * (A.b - A.t) + (B.r - B.l) * (B.b - B.t))) continue;
          A.l = Math.min(A.l, B.l);
          A.t = Math.min(A.t, B.t);
          A.r = Math.max(A.r, B.r);
          A.b = Math.max(A.b, B.b);
          const last = Z[--n];
          Z[n] = B;
          Z[b] = last;
          merged = true;
          break;
        }
      }
    }
    this._zoneN = n;
    this._panelOn = on;
    return on;
  }

  /** Does the box overlap a keep-out zone other than `skip`? */
  _hitsZone(x, y, hw, up, down, skip) {
    const Z = this._zones;
    for (let i = 0; i < this._zoneN; i++) {
      if (i === skip) continue;
      const z = Z[i];
      if (x + hw > z.l && x - hw < z.r && y + down > z.t && y - up < z.b) return true;
    }
    return false;
  }

  /**
   * Move a label box (anchor x, y; half width `hw`, `up` above and `down` below the anchor, CSS px)
   * out of the keep-out zones into `_sx`, `_sy`: for an overlapped zone the smallest of the four
   * moves (left, right, above, below) that keeps the box on screen along that axis and clear of the
   * other zones (else the smallest on-screen one). Three passes at most.
   */
  _clear(x, y, hw, up, down) {
    const Z = this._zones;
    const W = this._w;
    const H = this._h;
    for (let pass = 0; pass < 3; pass++) {
      let k = -1;
      for (let i = 0; i < this._zoneN; i++) {
        const z = Z[i];
        if (x + hw > z.l && x - hw < z.r && y + down > z.t && y - up < z.b) { k = i; break; }
      }
      if (k < 0) break;
      const z = Z[k];
      let best = Infinity;
      let fall = Infinity;
      let bx = x;
      let by = y;
      let fx = x;
      let fy = y;
      for (let c = 0; c < 4; c++) {
        let nx = x;
        let ny = y;
        if (c === 0) { nx = z.l - hw; if (nx - hw < 0) continue; } else if (c === 1) { nx = z.r + hw; if (nx + hw > W) continue; } else if (c === 2) { ny = z.t - down; if (ny - up < 0) continue; } else { ny = z.b + up; if (ny + down > H) continue; }
        const d = Math.abs(nx - x) + Math.abs(ny - y);
        if (d < fall) { fall = d; fx = nx; fy = ny; }
        if (d < best && !this._hitsZone(nx, ny, hw, up, down, k)) { best = d; bx = nx; by = ny; }
      }
      if (best < Infinity) { x = bx; y = by; } else if (fall < Infinity) { x = fx; y = fy; } else break;
    }
    this._sx = x;
    this._sy = y;
  }

  /** Measure the panels (ResizeObserver callback: after layout, so no forced layout). */
  _measurePanels() {
    const root = this.root.getBoundingClientRect();
    for (const p of this._panels) {
      const el = p.boxOf ? p.boxOf() : p.el;
      const r = el ? el.getBoundingClientRect() : null;
      // a panel CSS hides (the legend under the boss bar) leaves its place to the labels
      p.has = !!r && r.width > 0 && r.height > 0 && p.el.isConnected && getComputedStyle(p.el).visibility !== 'hidden';
      if (!r) continue;
      p.l = r.left - root.left;
      p.t = r.top - root.top;
      p.r = r.right - root.left;
      p.b = r.bottom - root.top;
    }
    for (const n of this._nums) n.x = NaN;
    for (const b of this._bars) b.x = NaN;
    for (const e of this._edges) e.x = NaN;
    for (const a of this._alerts) a.x = NaN;
    this._reticle.x = NaN;
  }

  /** Ask for a new measurement after the next layout (re-observing the root reports it once). */
  _remeasurePanels() {
    const ro = this._panelRo;
    if (!ro) return;
    ro.unobserve(this.root);
    ro.observe(this.root);
  }

  _disconnectPanels() {
    this._panelRo?.disconnect();
    this._panelMo?.disconnect();
    this._panelRo = null;
    this._panelMo = null;
    for (const p of this._panels) {
      p.el.removeEventListener('transitionend', this._onPanelEnd);
      p.el.removeEventListener('animationend', this._onPanelEnd);
      p.on = false;
    }
    this._panelOn = 0;
    this._zoneN = 0;
  }

  /**
   * An edge arrow's place on the inset border (into `e.tx`, `e.ty`; written by `_moveEdge`) and its
   * octant. Returns whether it shows (its enemy is off screen).
   * @param {EdgeSlot} e
   * @returns {boolean}
   */
  _placeEdge(e) {
    const p = e.ref;
    if (!p) { this._setInside(e, true); return false; }
    this._clip(p.x, p.y + e.oy, p.z);
    const W = this._w;
    const H = this._h;
    const cx = W * 0.5;
    const cy = H * 0.5;
    const inset = EDGE_INSET * this._px;
    const hw = Math.max(1, cx - inset);
    const hh = Math.max(1, cy - inset);
    const w = this._cw;
    let dx;
    let dy;
    if (w > 1e-4) {
      dx = (this._cx / w) * cx;
      dy = -(this._cy / w) * cy;
      // on screen (inside the inset rectangle): no arrow
      if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) { this._setInside(e, true); return false; }
    } else {
      // behind the camera: the clip x / y keep the lateral direction (symmetric frustum)
      dx = this._cx * cx;
      dy = -this._cy * cy;
      if (dx === 0 && dy === 0) dy = 1;
    }
    this._setInside(e, false);
    let t = Math.min(hw / (Math.abs(dx) || 1e-9), hh / (Math.abs(dy) || 1e-9));
    // the sprite reaches 8.5 art px from its centre, and nudges 1 more toward the enemy
    if (this._panelOn) t = this._edgeClear(cx, cy, dx, dy, t, 10 * this._px + 1);
    e.tx = Math.round(cx + dx * t);
    e.ty = Math.round(cy + dy * t);
    // along the top or bottom border (else a side): the way it gives room to a neighbour
    e.horiz = Math.abs(dy) * hw >= Math.abs(dx) * hh;
    // the nearest of the 8 pre-drawn octants (screen y down: 1 is south-east)
    const o = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
    if (o !== e.o) {
      e.o = o;
      const s = e.el.style;
      s.setProperty('--o', String(o));
      s.setProperty('--nx', String(OCT_DIR[o][0]));
      s.setProperty('--ny', String(OCT_DIR[o][1]));
    }
    return true;
  }

  /** @param {EdgeSlot} e */
  _moveEdge(e) {
    const x = Math.round(e.tx);
    const y = Math.round(e.ty);
    if (x !== e.x || y !== e.y) {
      e.x = x;
      e.y = y;
      e.el.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
  }

  /**
   * Keep the shown edge arrows EDGE_SPACE art px apart: two whose cells come closer along both axes
   * are pushed apart along their border (half each; a few passes for three or more), staying within
   * the inset border.
   */
  _spreadEdges() {
    const E = this._edges;
    const D = Math.ceil(EDGE_SPACE * this._px);
    const inset = Math.round(EDGE_INSET * this._px);
    const W = Math.round(this._w);
    const H = Math.round(this._h);
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let i = 0; i < EDGE_POOL; i++) {
        const a = E[i];
        if (!a.on || a.inside) continue;
        for (let j = i + 1; j < EDGE_POOL; j++) {
          const b = E[j];
          if (!b.on || b.inside) continue;
          const ddx = b.tx - a.tx;
          const ddy = b.ty - a.ty;
          if (Math.abs(ddx) >= D || Math.abs(ddy) >= D) continue;
          // along the border they share (a corner pair: the axis they are further apart on)
          const horiz = a.horiz === b.horiz ? a.horiz : Math.abs(ddx) >= Math.abs(ddy);
          const d = horiz ? ddx : ddy;
          const sgn = d > 0 || (d === 0 && i < j) ? 1 : -1;
          const push = Math.ceil((D - Math.abs(d)) / 2);
          if (horiz) {
            a.tx = Math.min(W - inset, Math.max(inset, a.tx - sgn * push));
            b.tx = Math.min(W - inset, Math.max(inset, b.tx + sgn * push));
          } else {
            a.ty = Math.min(H - inset, Math.max(inset, a.ty - sgn * push));
            b.ty = Math.min(H - inset, Math.max(inset, b.ty + sgn * push));
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  /**
   * Slide an edge arrow (radius `rad`) inward along its ray from the screen centre (cx, cy) in
   * direction (dx, dy) until it clears every shown HUD panel: returns the new ray parameter.
   */
  _edgeClear(cx, cy, dx, dy, t, rad) {
    const Z = this._zones;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let i = 0; i < this._zoneN; i++) {
        const z = Z[i];
        // slab test of the ray against the zone grown by the arrow's radius: [s0, s1] inside
        let s0 = 0;
        let s1 = Infinity;
        if (Math.abs(dx) < 1e-9) {
          if (cx < z.l - rad || cx > z.r + rad) continue;
        } else {
          const a = (z.l - rad - cx) / dx;
          const b = (z.r + rad - cx) / dx;
          s0 = Math.max(s0, Math.min(a, b));
          s1 = Math.min(s1, Math.max(a, b));
        }
        if (Math.abs(dy) < 1e-9) {
          if (cy < z.t - rad || cy > z.b + rad) continue;
        } else {
          const a = (z.t - rad - cy) / dy;
          const b = (z.b + rad - cy) / dy;
          s0 = Math.max(s0, Math.min(a, b));
          s1 = Math.min(s1, Math.max(a, b));
        }
        if (s0 > s1 || t < s0 || t > s1 || s0 <= 0) continue;
        t = s0 - 1e-3;
        moved = true;
      }
      if (!moved) break;
    }
    return t;
  }

  _setInside(e, inside) {
    if (inside !== e.inside) {
      e.inside = inside;
      e.el.classList.toggle('is-in', inside);
    }
  }

  /** Force a transform write for everything on the next update (after a resize). */
  _invalidate() {
    for (const n of this._nums) n.x = NaN;
    for (const b of this._bars) b.x = NaN;
    for (const e of this._edges) e.x = NaN;
    for (const a of this._alerts) a.x = NaN;
    this._reticle.x = NaN;
  }
}
