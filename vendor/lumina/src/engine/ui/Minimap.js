import './ui.css';
import './map.css';
import { t } from '../i18n/I18n.js';
import { onScale, currentScale, fitScale } from './UiScale.js';
import { currentFonts } from './FontLoader.js';
import { pal } from './art/palette.js';
import { art } from './art/painter.js';
import { fade, rgbOf, hairline, gemGlyph } from './art/pieces.js';
import {
  renderPixelMap, resampleMap, mapEdgeColour, arrowSprite, facingOf, wedgeSprite, WEDGE_APEX, vignetteSprite,
  markerSprite, MARKER_HALF, MARKER_REACH, pipSprite, pulseRing, legendKey, KEY_SIZE,
} from './art/minimap.js';
import { measure, fit, txt, txc, UP, cjk, FONT, roles, nameParts, setOrigin, originOf } from './layout/type.js';
import { group, put, win, place, U, keyHints, section, capW } from './layout/layout.js';

/**
 * Map UI (docs/specs/PIXEL_UI.md §5, Maps): the HUD minimap (top-right, under the clock) and
 * the world map overlay, both pixel art at the UI root's --px. The game sets both up on every level
 * (`Game._setupMaps`; `environment.minimap: false` turns the minimap off).
 *
 * - The **minimap** is G's: an M window (76 × 76 art px, gold corner gems, the trio, side studs) at
 *   (554, 50) of the 640 × 360 frame, anchored top-right (pushed down when the clock grows past it),
 *   'N' over its top edge, and a 70 × 70 art-px map 2 art px per world unit (today's view of about
 *   34 world units). The map is G's flat tile colours with the cliff and light rows and the level's
 *   buildings, bridges and trees when the game passes the level (`setMap(map, { level })`;
 *   art/minimap.js `renderPixelMap`), else the painted map turned into art pixels (`resampleMap`).
 *   Over it each frame: the muted wash, the dithered view wedge, the stepped vignette, the markers
 *   as pixel gems and dots (pushed aside from the arrow; foes beyond the window as pips on its edge)
 *   and the player's arrow in eight facings.
 * - The **world map** is an L window like the tactics panel (lattice, beads, the trio, side studs)
 *   on the dimmed scene: WORLD MAP ◆ the title · the subtitle over a dim rule; the whole map in a dim
 *   socket, the painted map drawn at a whole number of art px per world unit; the region names in
 *   the name role (an area's airier, a crowded area's in the small role on two lines) with an ink
 *   outline, each at its centre, just below or just above it where that covers no marker (the
 *   player's arrow and the waystones first), the live markers drawn over them; the legend's keys
 *   the minimap's own markers; the region the player is in; the key hints N · Tab · Esc Close. It is
 *   laid out when it opens (a level's load stores its map only), as large as the screen holds
 *   without scaling it (1024 × 768: a narrower window, every pixel whole).
 *
 * Both draw a pre-rendered map image (e.g. LevelMap.renderLevelMap: `{ canvas, pixelsPerTile,
 * width, depth }`, world (x, z) ↦ canvas (x · ppt, z · ppt)) plus live markers: the player arrow
 * (turned to the facing, with the camera's view wedge), villagers and points of interest.
 *
 * Markers passed to `update()`:
 *   { player: {x, z}, facing: {x, z}, view?: {x, z} (camera look direction on the ground),
 *     npcs?: {x, z}[], markers?: {x, z, kind: 'sign'|'door'|'well'|'fire'|'object'|'waystone'|'chest'|'boss', hidden?}[],
 *     enemies?: {x, z}[] (combat levels: red dots),
 *     party?: {x, z}[] (the party's members, docs/specs/PARTY.md §6.3: teal dots with a light rim,
 *       over the villagers and enemies, under the player's arrow) }
 * `markers`, `enemies` and `party` are read on every draw, so a game may push into / splice those
 * arrays at runtime; a marker whose `hidden` is true is skipped (a live story prop that is absent
 * now — World.mapMarkers gives those a getter). Without `party` (or with an empty one) the maps
 * draw exactly what they drew before.
 *
 * Strings: the 'map' namespace (src/engine/i18n/strings/map.js). The title, subtitle and region
 * names arrive translated from the game (PIXEL_UI.md §8.1).
 */

/**
 * A world-map region name with the layout state kept on the element: `_inside` (fallback anchors,
 * fractions of the map), `_box` (its placed box relative to the map, art px; null = not placed) and
 * `_dim` (faded because it lies over the player arrow).
 * @typedef WorldMapLabel
 * @type {HTMLDivElement & { _inside?: number[][], _dim?: boolean,
 *   _box?: { left: number, right: number, top: number, bottom: number }|null }}
 */

/** @import { PaintedMap } from './art/minimap.js' */

const DEFAULT_FACING = Object.freeze({ x: 0, z: 1 });
/**
 * Fallback anchors of a world-map region name inside its rect (fractions of its width / depth),
 * nearest the centre first: a 5 × 5 grid without the centre itself.
 */
const INSIDE_SPOTS = (() => {
  const f = [0.2, 0.35, 0.5, 0.65, 0.8];
  const out = [];
  for (const u of f) for (const v of f) if (u !== 0.5 || v !== 0.5) out.push([u, v]);
  return out.sort((a, b) => (Math.hypot(a[0] - 0.5, a[1] - 0.5) - Math.hypot(b[0] - 0.5, b[1] - 0.5)) || (a[1] - b[1]) || (a[0] - b[0]));
})();
/** Today's marker kinds → the pixel markers' (art/minimap.js `markerSprite`). */
const KIND = Object.freeze({ fire: 'campfire', door: 'door', sign: 'sign', well: 'well', object: 'object', waystone: 'waystone', chest: 'chest', boss: 'boss' });
/** @param {string} kind */
const kindOf = (kind) => (typeof kind === 'string' && Object.prototype.hasOwnProperty.call(KIND, kind) ? KIND[kind] : 'object');
/** The drawing passes of the markers (G's MARKER_ORDER): points of interest, then waystones and chests, then the boss with the foes. */
const PASS = Object.freeze({ campfire: 0, door: 0, sign: 0, well: 0, object: 0, waystone: 1, chest: 1, boss: 3 });
/** The passes over `markers` (the villagers after pass 1; the foes after pass 3, the party last). */
const PASSES = Object.freeze([0, 1, 3]);

// ---------------------------------------------------------------------------------------------
// The HUD minimap
// ---------------------------------------------------------------------------------------------

/** G's minimap window: x, y (the 640 × 360 frame), size; the map inside it (V × V art px). */
const MM_X = 554, MM_Y = 50, MM_S = 76, MM_V = 70;
/** The minimap's frame (G's `minimap`: gold corners r2 — the M size's default gems —, the trio, side studs). */
const MM_STYLE = Object.freeze({ size: 'M', cornerR: 2, trio: true, sides: true, trioR: 2 });
/** The gap G leaves between the clock and the minimap at least (art px). */
const MM_GAP = 7;

/**
 * The marker test of G's `miniMap`: a marker within `need` (Chebyshev) of the arrow moves aside to
 * that distance along its larger axis. Writes the result into `out` (no allocation).
 * @param {number} x
 * @param {number} y
 * @param {number} px
 * @param {number} py
 * @param {string} kind
 * @param {{ x: number, y: number }} out
 */
function aside(x, y, px, py, kind, out) {
  const need = 4 + (MARKER_REACH[kind] ?? 2) + 2, dx = x - px, dy = y - py;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < need) {
    if (Math.abs(dx) >= Math.abs(dy)) x = px + (dx < 0 ? -need : need);
    else y = py + (dy < 0 ? -need : need);
  }
  out.x = x;
  out.y = y;
}

/**
 * HUD minimap: G's gold-framed window onto the map round the player, north up.
 */
export class Minimap {
  /**
   * @param {HTMLElement} parent (the HUD element, so it hides with the HUD; it covers the root)
   * @param {{ anchor?: HTMLElement|null }} [opts] anchor: the minimap sits below this element (the
   *   HUD clock) — at G's place, or lower when the anchor's bottom comes within 7 art px of it
   */
  constructor(parent, { anchor = null } = {}) {
    const k = pal();
    this._parent = parent;
    const el = group(parent, 'tr', MM_X, MM_Y, MM_S, MM_S, 'is-empty');
    // (its own class first: tests and the world labels' keep-out zones name a panel by it)
    el.className = `lu-minimap ${el.className}`;
    el.setAttribute('aria-hidden', 'true');
    win(el, MM_STYLE, MM_X, MM_Y, MM_S, MM_S);
    const canvas = art(MM_V, MM_V, () => {});
    canvas.classList.add('lu-minimap__canvas');
    put(el, canvas, MM_X + 3, MM_Y + 3);
    const north = txt(el, t('map.north'), MM_X + MM_S / 2, MM_Y + 3, { font: 'tiny', color: k.g5, align: 'center', ol: true, cls: 'lu-minimap__north' });
    north.setAttribute('aria-hidden', 'true');
    this.element = el;
    /** @type {HTMLCanvasElement} the map window (MM_V × MM_V art px; redrawn by `update`) */
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    /** @type {PaintedMap|null} */
    this.map = null;
    /** World units across the minimap window (the art px per unit follow: 70 / view, whole). */
    this.view = 34;
    this._enabled = true;
    /** @type {HTMLCanvasElement|null} the map in art pixels (`_ppt` per world unit) */
    this._base = null;
    this._ppt = 2;
    /** @type {string|null} */
    this._edge = null;
    this._y = MM_Y;
    /** A marker's place after `aside` (reused). */
    this._at = { x: 0, y: 0 };
    // below the anchor (the clock): its height depends on the fonts, the language and the scale
    this._anchor = anchor;
    this._place = () => this._placeBelowAnchor();
    this._anchorRo = anchor && typeof ResizeObserver === 'function' ? new ResizeObserver(this._place) : null;
    this._anchorRo?.observe(anchor);
    window.addEventListener('resize', this._place);
    this._offScale = onScale(parent, this._place);
  }

  /** Follow the anchor (the clock): G's y, or its bottom + MM_GAP when that is lower. */
  _placeBelowAnchor() {
    const a = this._anchor;
    let y = MM_Y;
    if (a && a.isConnected && this._parent.isConnected) {
      const ar = a.getBoundingClientRect();
      if (ar.height > 0) {
        const sc = currentScale(this._parent);
        // (the minimap is a corner group: it shrinks with the corners only, below 1024 × 600)
        const unit = (sc?.cssPx ?? 2) * (sc?.cornerShrink ?? 1);
        const bottom = (ar.bottom - this._parent.getBoundingClientRect().top) / unit;
        // (an anchor box far taller than a clock — a whole corner group — tells nothing)
        if (bottom > 0 && bottom < 100) y = Math.max(MM_Y, Math.ceil(bottom + MM_GAP));
      }
    }
    if (y !== this._y) {
      this._y = y;
      this.element.style.top = U(y);
      setOrigin(this.element, [MM_X, y]);
    }
  }

  /**
   * @param {PaintedMap|null} map
   * @param {{ view?: number, level?: { width: number, depth: number, tiles: string[], heights: string[], legend?: Record<string, any>, objects?: any[] }|null }} [opts]
   *   view: world units across the window; level: the level `map` was painted from (as the story has
   *   it now): the minimap then draws G's flat tile map with the level's buildings (art/minimap.js
   *   `renderPixelMap`) instead of the painted map in art pixels
   */
  setMap(map, { view, level = null } = {}) {
    this.map = map;
    if (view) this.view = view;
    this._ppt = Math.max(1, Math.min(6, Math.round(MM_V / this.view)));
    this._base = null;
    this._edge = null;
    if (map) {
      const lv = level && Array.isArray(level.tiles) && level.width === map.width && level.depth === map.depth ? level : null;
      this._base = baseFor(map, lv, this._ppt);
      this._edge = lv ? pal()['m-void'] : mapEdgeColour(map);
    }
    this._apply();
  }

  /** Shown when there is a map and the level allows it (environment.minimap). */
  get enabled() { return this._enabled; }
  set enabled(v) {
    this._enabled = !!v;
    this._apply();
  }

  get visible() { return !!this.map && this._enabled; }

  _apply() {
    this.element.classList.toggle('is-empty', !this.visible);
    if (this.visible) requestAnimationFrame(this._place);
  }

  /** Redraw round the player (cheap: one drawImage of the art-pixel map, the cached sprites). */
  update(s) {
    if (!this.visible || !s?.player || !this._base) return;
    const { ctx } = this;
    const V = MM_V, ppt = this._ppt, base = this._base;
    const k = pal();
    // the window stays over the map — no empty strip past the level edge (the 3D view shows the
    // forest and meadows continuing there); near an edge the arrow moves off the centre instead. A
    // map smaller than the window is centred in the colour of its edge.
    const wx = s.player.x * ppt, wz = s.player.z * ppt;
    const x0 = base.width > V ? Math.max(0, Math.min(base.width - V, Math.round(wx - V / 2))) : Math.round((base.width - V) / 2);
    const y0 = base.height > V ? Math.max(0, Math.min(base.height - V, Math.round(wz - V / 2))) : Math.round((base.height - V) / 2);
    if (base.width < V || base.height < V) {
      ctx.fillStyle = this._edge ?? k['m-void'];
      ctx.fillRect(0, 0, V, V);
    } else ctx.clearRect(0, 0, V, V);
    ctx.drawImage(base, -x0, -y0);
    // muted toward today's tone: one flat ink wash over the tiles
    ctx.fillStyle = k['m-mute'];
    ctx.fillRect(0, 0, V, V);
    const px = Math.floor(wx) - x0, py = Math.floor(wz) - y0;
    if (s.view && (s.view.x || s.view.z)) ctx.drawImage(wedgeSprite(Math.atan2(s.view.x, -s.view.z), px, py), px - WEDGE_APEX, py - WEDGE_APEX);
    ctx.drawImage(vignetteSprite(V), 0, 0);
    // the markers in G's order: points of interest and campfires, waystones and chests, villagers,
    // the boss and the foes, the party (indexed loops: no per-frame allocation)
    const marks = s.markers;
    for (const pass of PASSES) {
      if (marks) {
        for (let i = 0; i < marks.length; i++) {
          const m = marks[i];
          if (m.hidden) continue;
          const kind = kindOf(m.kind);
          if (PASS[kind] !== pass) continue;
          this._mark(kind, Math.floor(m.x * ppt) - x0, Math.floor(m.z * ppt) - y0, px, py);
        }
      }
      if (pass === 1) {
        const np = s.npcs;
        if (np) for (let i = 0; i < np.length; i++) this._mark('npc', Math.floor(np[i].x * ppt) - x0, Math.floor(np[i].z * ppt) - y0, px, py);
      }
    }
    const en = s.enemies;
    if (en) for (let i = 0; i < en.length; i++) this._mark('enemy', Math.floor(en[i].x * ppt) - x0, Math.floor(en[i].z * ppt) - y0, px, py);
    const pa = s.party;
    if (pa) for (let i = 0; i < pa.length; i++) this._mark('party', Math.floor(pa[i].x * ppt) - x0, Math.floor(pa[i].z * ppt) - y0, px, py);
    const f = s.facing ?? DEFAULT_FACING;
    ctx.drawImage(arrowSprite(facingOf(f.x, f.z)), px - 4, py - 4);
  }

  /**
   * One marker at window pixel (x, y): moved aside from the arrow at (px, py); outside the window
   * a foe becomes a pip on its edge, anything else is skipped (G's `miniMap`).
   * @param {string} kind
   * @param {number} x
   * @param {number} y
   * @param {number} px
   * @param {number} py
   */
  _mark(kind, x, y, px, py) {
    const V = MM_V, at = this._at;
    // (far outside: nothing to move aside, no pip unless a foe)
    if (kind !== 'enemy' && (x < -8 || y < -8 || x > V + 8 || y > V + 8)) return;
    aside(x, y, px, py, kind, at);
    if (at.x < 3 || at.y < 3 || at.x > V - 4 || at.y > V - 4) {
      if (kind !== 'enemy') return;
      const ex = Math.max(2, Math.min(V - 3, at.x)), ey = Math.max(2, Math.min(V - 3, at.y));
      this.ctx.drawImage(pipSprite(), ex - 1, ey - 1);
      return;
    }
    this.ctx.drawImage(markerSprite(kind), at.x - MARKER_HALF, at.y - MARKER_HALF);
  }

  dispose() {
    this._anchorRo?.disconnect();
    window.removeEventListener('resize', this._place);
    this._offScale();
    this.element.remove();
  }
}

/** The minimap's art-pixel maps by painted canvas: the level's flat map or the resampled one. @type {WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>} */
const BASES = new WeakMap();
/**
 * The minimap's map in art pixels for a painted map: G's flat tile map with the objects when the
 * level is known, else the painted map resampled. Cached per painted canvas (a kept level's map
 * comes back on every return), `ppt` and source.
 * @param {PaintedMap} map
 * @param {any} level
 * @param {number} ppt
 */
function baseFor(map, level, ppt) {
  let byKey = BASES.get(map.canvas);
  if (!byKey) { byKey = new Map(); BASES.set(map.canvas, byKey); }
  const key = `${level ? 'level' : 'painted'}|${ppt}`;
  let c = byKey.get(key);
  if (!c) {
    c = level ? renderPixelMap(level, ppt, { objects: true }) : resampleMap(map, ppt);
    byKey.set(key, c);
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// The world map
// ---------------------------------------------------------------------------------------------

/** The world map window's metrics (art px): content inset from the sides (clear of the signature corners), the header's cap centre and rule, the content's top, the bottom inset. */
const WM = Object.freeze({ padX: 26, headY: 17, ruleY: 29, top: 38, padB: 20, margin: 12, gap: 14, sock: 4, rowH: 13, keyGap: 4, maxScale: 8 });
/** The world map's frame (the tactics panel's family: lattice, beads, the trio, side studs). */
const WM_STYLE = Object.freeze({ size: 'L', lattice: true, beads: 6, trio: true, sides: true });
/**
 * The map's socket: a dim recessed box.
 * @returns {import('./art/frames.js').FrameStyle}
 */
const SOCKET = () => ({ size: 'XS', socket: true, tone: 'dim', corners: null, fill: pal().ink1, sheen: false });

/**
 * The region names' role: the name role (English capitals, 7.5 art px of ink); in Japanese and
 * Chinese the small role, whose bold 7 art px glyphs stand as tall as the English capitals (the CJK
 * name role's 11 would bury the map under its names).
 * @returns {'name'|'small'}
 */
const labelRole = () => (cjk() ? 'small' : 'name');

/**
 * A compact region name's role (two lines where the full name finds no room): the small role; in
 * English at an even --px (2, 4: the half-size roles at G's size) the line role instead — Jersey 10
 * on its finer half-size grid with a font-pixel outline, as tall as Tiny5's capitals (5 art px).
 * Tiny5 under its one-art-px outline read 'GINDERWATGH PASS' (the outline filled the C's mouth).
 * Japanese and Chinese keep the small role (Noto Sans, anti-aliased); at an odd --px the line role
 * would grow 1.33× (px 3) or 2× (px 1), where a compact name must stay small.
 * @returns {'line'|'small'}
 */
const compactRole = () => { roles(); return !cjk() && FONT.line.unit === 0.5 ? 'line' : 'small'; };

/**
 * A role's ink height (cap height; 回 for CJK) in art px at the current scale: a half-size role's
 * grows with --fpx (⌈px / 2⌉: 1.33× G's at px 3), where `inkH` gives the --px 2 layout's.
 * @param {import('./layout/type.js').RoleId} role
 */
const inkNow = (role) => { roles(); return FONT[role].ink * FONT[role].unit; };

/**
 * A name in at most `maxLines` lines of `maxW` art px in `role` (one art px of tracking), broken at
 * spaces (kept between the words of a line: an English name, or one left untranslated on a Japanese
 * or Chinese page) and at the translators' break hints (U+200B: the pieces join without a space);
 * the last line takes what is left (the caller cuts it to fit).
 * @param {string} text
 * @param {'name'|'small'|'line'} role
 * @param {number} maxW
 * @param {number} maxLines
 * @returns {string[]}
 */
function breakName(text, role, maxW, maxLines) {
  /** @type {string[]} */
  const out = [];
  let sep = '';
  for (const piece of String(text).split(/( |​)/)) {
    if (piece === ' ' || piece === '​') { sep = piece === ' ' ? ' ' : sep; continue; }
    if (!piece) continue;
    const cur = out[out.length - 1];
    if (cur != null && (measure(`${cur}${sep}${piece}`, role, 1) <= maxW || out.length >= maxLines)) out[out.length - 1] = `${cur}${sep}${piece}`;
    else out.push(piece);
    sep = '';
  }
  return out.length ? out : [String(text)];
}

/** @type {Map<string, HTMLCanvasElement>} the backdrop dims by size */
const VEILS = new Map();
/**
 * The tactics panel's dim layer over the scene (a radial in hard steps), w × h art px; a copy of
 * the one painted per size.
 * @param {number} w
 * @param {number} h
 */
function veilCanvas(w, h) {
  const key = `${w}x${h}`;
  let c = VEILS.get(key);
  if (!c) {
    const k = pal();
    c = fade(w, h, rgbOf(k.dim), (u, v) => 0.6 + 0.28 * Math.min(1, Math.hypot((u - 0.5) / 0.5, (v - 0.5) / 0.5) ** 1.6), [0.6, 0.7, 0.8, 0.88]);
    if (VEILS.size > 4) VEILS.delete(VEILS.keys().next().value);
    VEILS.set(key, c);
  }
  return art(c.width, c.height, (p) => p.ctx.drawImage(c, 0, 0));
}

/**
 * A container element for a part of a group (head, legend, foot …): no box of its own, its
 * children placed in the group's frame coordinates.
 * @param {Element} parent
 * @param {string} tag
 * @param {string} cls
 */
function part(parent, tag, cls) {
  const el = document.createElement(tag);
  el.className = cls;
  setOrigin(el, originOf(parent));
  parent.append(el);
  return el;
}

/**
 * How much a marker matters to a region name over it (`_layoutLabels`): the player's arrow, the
 * waystones and the boss 2, every other static marker 1. A name takes the first of its centre, just
 * below and just above that covers no marker, else the first that covers none of weight 2.
 * @type {Readonly<Record<string, number>>}
 */
const KEEP_CLEAR = Object.freeze({ player: 2, waystone: 2, boss: 2 });
/** The player's arrow's reach from its point (art px: the 9 × 9 arrow and its outline). */
const PLAYER_REACH = 5;

/**
 * A box on the world map (art px, relative to the map; right / bottom exclusive) with the weight of
 * what it holds (`KEEP_CLEAR`).
 * @typedef {{ left: number, right: number, top: number, bottom: number, w: number }} MapObstacle
 */

/**
 * Full-screen world map: the whole level, region names, the player, villagers and points of
 * interest, with a legend. `open()` / `close()` fade it in / out; the game pauses gameplay input
 * while `isOpen`.
 *
 * The window is laid out only when it is shown: `setMap`, `setRegion`, the legend's rows and a new
 * scale mark it out of date, and `open()` lays it out (`_build`) — a level's load or a return to a
 * kept level never paints the L window for a map nobody opened. While it is open those lay it out
 * at once. Its layers, bottom to top: the map (`.lu-worldmap__base`), the region names
 * (`.lu-worldmap__labels`), the live markers with the player's ring and arrow (`canvas`).
 */
export class WorldMap {
  /** @param {HTMLElement} parent (the UI root) */
  constructor(parent) {
    const el = document.createElement('div');
    el.className = 'lu-worldmap';
    el.setAttribute('aria-hidden', 'true');
    parent.appendChild(el);
    this.element = el;
    /**
     * @type {HTMLCanvasElement} the live markers, the player's ring and arrow (art px, the map's
     * size; redrawn by `update`), over the map and its region names
     */
    this.canvas = art(1, 1, () => {});
    this.canvas.classList.add('lu-worldmap__canvas');
    this.ctx = this.canvas.getContext('2d');
    /** @type {HTMLCanvasElement} the map itself under the region names (art px) */
    this._baseCanvas = art(1, 1, () => {});
    this._baseCtx = this._baseCanvas.getContext('2d');
    /** @type {PaintedMap|null} */
    this.map = null;
    /** Where the level's (0, 0) lies on the map (a campaign's overview: the level's corner). */
    this._origin = [0, 0];
    this._title = '';
    this._sub = '';
    /** @type {{ name: string, minX: number, maxX: number, minZ: number, maxZ: number }[]} */
    this._regions = [];
    this._region = '';
    this._combat = false;
    /** The "Companion" legend row is shown (only while `update` gets a party). */
    this._party = false;
    this._open = false;
    this._pulse = 0;
    /** Art px per world unit of the shown map, and the map's size on screen (art px). */
    this._scale = 1;
    this._mw = 1;
    this._md = 1;
    /** @type {HTMLCanvasElement|null} the map in art px (`resampleMap`) */
    this._base = null;
    /** @type {WorldMapLabel[]} */
    this._labelList = [];
    /** @type {HTMLElement|null} the labels' box over the map */
    this._labels = null;
    /** Strings whose font slices `ensure` has loaded (a new set lays the window out again once they are in). */
    this._ensured = new Set();
    /** @type {string|null} the strings of the last layout (`_ensureFonts`) */
    this._lastStrings = null;
    /** @type {HTMLElement|null} the map's box (`.lu-worldmap__map`) */
    this._mapBox = null;
    /** @type {HTMLElement|null} the region's name under the legend (`.lu-worldmap__region`) */
    this._regionEl = null;
    /** The window has been laid out once. */
    this._built = false;
    /** The window is out of date (laid out again by `open()`, or at once while open). */
    this._dirty = true;
    /** @type {MapObstacle[]} what the region names keep clear of (`update`: the player, the static markers) */
    this._obstacles = [];
    /** The player's map pixel and the static markers' count the names were last placed for (`update`). */
    this._sigX = NaN;
    this._sigY = NaN;
    this._sigN = -1;
    this._disposed = false;
    this._offScale = onScale(parent, () => this._invalidate());
  }

  get isOpen() { return this._open; }

  /** The window is out of date: laid out again now while it is open, else by the next `open()`. */
  _invalidate() {
    this._dirty = true;
    if (this._open) this._build();
  }

  /**
   * @param {PaintedMap|null} map
   * @param {{ title?: string, subtitle?: string, regions?: {name: string, minX: number, maxX: number, minZ: number, maxZ: number}[],
   *           combat?: boolean, origin?: [number, number] }} [info] combat: extra legend rows (Enemy,
   *   Waystone, Chest); without it the legend is unchanged. origin ([0, 0]): where world (0, 0) of
   *   the level lies on `map` (a campaign's overview of several levels: the player, villagers and
   *   markers are drawn shifted by it; `regions` are in map units). Title, subtitle and region names
   *   come translated (the game's `term()` / `loc()`, docs/specs/I18N.md §4.8); the title is set in
   *   capitals in English. Stored only: the window is laid out when it opens.
   */
  setMap(map, { title = '', subtitle = '', regions = [], combat = false, origin = [0, 0] } = {}) {
    this.map = map;
    this._origin = [Number(origin?.[0]) || 0, Number(origin?.[1]) || 0];
    this._combat = !!combat;
    this._title = String(title ?? '');
    this._sub = String(subtitle ?? '');
    this._regions = Array.isArray(regions) ? regions : [];
    // (the markers' boxes were the old map's: the next update places the names for this one)
    this._obstacles = [];
    this._invalidate();
  }

  /** Add / remove the combat legend rows (Enemy, Waystone, Chest; after "Campfire"). */
  _setCombatLegend(on) {
    if (!!on === this._combat) return;
    this._combat = !!on;
    this._invalidate();
  }

  /**
   * Add / remove the "Companion" legend row (after "Villager"). Only while the map shows a party:
   * without one the legend is as it was.
   * @param {boolean} on
   */
  _setPartyLegend(on) {
    if (!!on === this._party) return;
    this._party = !!on;
    this._invalidate();
  }

  /** The region name shown under the legend (hidden when there is none). */
  setRegion(name) {
    const n = String(name || '');
    if (n === this._region) return;
    this._region = n;
    this._invalidate();
  }

  /** The legend's rows: [key kind, CSS key class, label]. */
  _legendRows() {
    /** @type {[string, string, string][]} */
    const rows = [['player', 'player', t('map.legend.you')], ['npc', 'npc', t('map.legend.villager')]];
    if (this._party) rows.push(['party', 'party', t('map.legend.companion')]);
    rows.push(['poi', 'poi', t('map.legend.poi')], ['fire', 'fire', t('map.legend.campfire')]);
    if (this._combat) rows.push(['enemy', 'enemy', t('map.legend.enemy')], ['waystone', 'waystone', t('map.legend.waystone')], ['chest', 'chest', t('map.legend.chest')]);
    rows.push(['house', 'house', t('map.legend.building')], ['road', 'road', t('map.legend.road')], ['water', 'water', t('map.legend.water')], ['forest', 'forest', t('map.legend.forest')]);
    return rows;
  }

  /**
   * Lay the whole window out again (the map, its title, regions, legend or region changed, or the
   * scale): everything in art px, sized from the measured text and the map — the map at the
   * largest whole number of art px per world unit the screen allows (up to 8), the window round it.
   * The window takes no more room than the screen holds unscaled (the 'mc' group inside
   * `fitScale`'s margins): a narrow screen (1024 × 768) gets a smaller window, never a fractional
   * art pixel.
   */
  _build() {
    if (this._disposed) return;
    const el = this.element;
    el.replaceChildren();
    this._labelList = [];
    this._labels = null;
    this._built = true;
    this._dirty = false;
    // (the region names are placed for the player and the markers again at the next update)
    this._sigX = NaN;
    const map = this.map;
    if (!map) return;
    const k = pal();
    const sc = currentScale(el);
    const artW = sc?.artW ?? 640, artH = sc?.artH ?? 360;
    // the room the window may fill: the screen less the margins, and no more than the 'mc' group —
    // the window and its ornaments, 20 art px round it — holds unscaled (UiScale.js fitScale)
    let maxWW = artW - 2 * WM.margin, maxWH = artH - 2 * WM.margin;
    while (maxWW > 200 && fitScale('mc', 320 - Math.floor(maxWW / 2) - 20, 170, maxWW + 40, 20, artW, artH) < 1) maxWW -= 2;
    while (maxWH > 120 && fitScale('mc', 300, 180 - Math.floor(maxWH / 2) - 20, 40, maxWH + 40, artW, artH) < 1) maxWH -= 2;

    // the strings
    const kicker = UP(t('map.title'));
    const rows = this._legendRows();
    const legendTitle = UP(t('map.legend'));
    const hereTitle = UP(t('map.here'));
    const close = t('map.close');
    const strings = [kicker, this._title, this._sub, legendTitle, hereTitle, close, this._region, ...rows.map((r) => r[2]), ...this._regions.map((r) => r?.name ?? '')];
    this._ensureFonts(strings);

    // the legend column: as wide as its widest line, the key hints and the region's name need
    const hints = [{ keys: ['N', 'Tab', 'Esc'], label: close }];
    const hintsW = hints[0].keys.reduce((a, key) => a + capW(key) + 2, 0) + 2 + measure(close, 'line');
    const rowW = Math.max(...rows.map((r) => KEY_SIZE + WM.keyGap + measure(r[2], 'line')));
    const headW = Math.max(measure(legendTitle, 'small', 1), measure(hereTitle, 'small', 1)) + 24;
    // (as wide as the region name's longest word too, up to 180: a name in the half-size name role
    // grows with --fpx and is never cut inside a word it could hold)
    const regionUp = this._region ? UP(this._region) : '';
    const wordW = regionUp ? Math.max(0, ...nameParts(regionUp).map((w) => measure(w, 'name', 1))) : 0;
    const LW = Math.min(180, Math.max(Math.min(150, Math.max(92, rowW, hintsW, headW)), wordW));
    const region = regionUp ? this._regionLines(regionUp, LW) : [];
    // the name role's line pitch: 10 art px in English at --px 2 (G's), following --fpx
    const nameL = cjk() ? FONT.name.L : Math.ceil(20 * FONT.name.unit);
    const LH = 9 + rows.length * WM.rowH + (region.length ? 10 + region.length * nameL : 0) + 10 + 11;

    // the map: the largest whole art px per world unit that fits (a fraction only for a map larger than the screen)
    const availW = maxWW - 2 * WM.padX - WM.gap - LW - 2 * WM.sock;
    const availH = maxWH - WM.top - WM.padB - 2 * WM.sock;
    const fitS = Math.max(0.05, Math.min(availW / map.width, availH / map.depth));
    const S = fitS >= 1 ? Math.min(WM.maxScale, Math.floor(fitS)) : fitS;
    const mw = Math.max(1, Math.round(map.width * S)), md = Math.max(1, Math.round(map.depth * S));
    this._scale = S;
    this._mw = mw;
    this._md = md;
    this._base = resampleMap(map, S);

    // the header's width (WORLD MAP ◆ TITLE subtitle), fitted into the widest window
    const kw = measure(kicker, 'small', 1);
    let title = this._title ? UP(this._title) : '';
    let sub = this._sub;
    const sockW = mw + 2 * WM.sock, sockH = md + 2 * WM.sock;
    let WW = 2 * WM.padX + sockW + WM.gap + LW;
    const headRoom = (titleS, subS) => kw + 16 + (titleS ? measure(titleS, 'head', 1) : 0) + (subS ? 8 + measure(subS, 'line') : 0);
    const need = headRoom(title, sub) + 2 * WM.padX;
    if (need > WW) WW = Math.min(maxWW, need);
    const room = WW - 2 * WM.padX;
    if (headRoom(title, sub) > room && sub) sub = fit(sub, 'line', Math.max(24, room - headRoom(title, '') - 8));
    if (headRoom(title, sub) > room && title) title = fit(title, 'head', Math.max(24, room - kw - 16 - (sub ? 8 + measure(sub, 'line') : 0)), 1);
    const colH = Math.max(sockH, LH);
    const WH = WM.top + colH + WM.padB;

    // the backdrop and the window (centred; the group covers the ornaments round it)
    const veil = put(el, veilCanvas(artW, artH), 0, 0, 1, 'veil lu-worldmap__veil');
    veil.setAttribute('aria-hidden', 'true');
    const WX = 320 - Math.floor(WW / 2), WY = 180 - Math.floor(WH / 2);
    const g = group(el, 'mc', WX - 20, WY - 20, WW + 40, WH + 40, 'over lu-worldmap__window');
    g.setAttribute('role', 'dialog');
    g.setAttribute('aria-label', t('map.aria'));
    win(g, WM_STYLE, WX, WY, WW, WH);
    const L = WX + WM.padX, R = WX + WW - WM.padX;

    // the header: WORLD MAP ◆ TITLE subtitle, a dim rule under it
    const head = part(g, 'header', 'lu-worldmap__head');
    const HY = WY + WM.headY;
    txc(head, kicker, L, HY, { font: 'small', track: 1, color: k.g4, drop: true, cls: 'lu-worldmap__kicker' });
    let hx = L + kw + 5;
    if (title || sub) {
      put(head, gemGlyph(2), hx, HY - 3);
      hx += 11;
    }
    if (title) {
      const te = txc(head, title, hx, HY, { font: 'head', track: 1, color: k.tx1, drop: true, cls: 'lu-worldmap__title' });
      hx += te.tw + 8;
    }
    if (sub) {
      // on the title's baseline
      const base = title ? HY + (inkNow('head') - inkNow('line')) / 2 : HY;
      txc(head, sub, hx, base, { font: 'line', color: k.g4, drop: true, cls: 'lu-worldmap__sub' });
    }
    put(head, hairline(R - L, 'both', k.dm1), L, WY + WM.ruleY);

    // the map in its socket: centred down the column when the legend is taller, and across the room
    // left of the legend when the header made the window wider
    const body = part(g, 'div', 'lu-worldmap__body');
    const CY = WY + WM.top;
    const SX = L + Math.max(0, Math.floor((R - LW - WM.gap - L - sockW) / 2)), SY = CY + Math.floor((colH - sockH) / 2);
    const frameEl = part(body, 'div', 'lu-worldmap__frame');
    win(frameEl, SOCKET(), SX, SY, sockW, sockH);
    const MX = SX + WM.sock, MY = SY + WM.sock;
    const mapEl = document.createElement('div');
    mapEl.className = 'g lu-worldmap__map';
    place(mapEl, MX - originOf(g)[0], MY - originOf(g)[1], mw, md);
    setOrigin(mapEl, [MX, MY]);
    body.append(mapEl);
    this._mapBox = mapEl;
    // the layers: the map, the region names over it, the live markers over both
    const baseC = this._baseCanvas;
    baseC.width = mw;
    baseC.height = md;
    put(mapEl, baseC, MX, MY, 1, 'lu-worldmap__base');
    const labels = document.createElement('div');
    labels.className = 'lu-worldmap__labels';
    mapEl.append(labels);
    this._labels = labels;
    const canvas = this.canvas;
    canvas.width = mw;
    canvas.height = md;
    put(mapEl, canvas, MX, MY);
    this._drawBase();
    this._layoutLabels();

    // the legend column: LEGEND, the rows, YOU ARE IN and the region, the key hints at its foot
    const LX = R - LW;
    const legend = part(body, 'aside', 'lu-worldmap__legend');
    const lt = txc(legend, legendTitle, LX, CY + 2, { font: 'small', track: 1, color: k.g4, drop: true, cls: 'lu-worldmap__legend-title' });
    put(legend, hairline(LW - lt.tw - 6, 'r'), LX + lt.tw + 5, CY + 2);
    const ul = part(legend, 'ul', 'lu-worldmap__keys');
    let ry = CY + 9;
    for (const [kind, cls, label] of rows) {
      const li = document.createElement('li');
      li.className = 'g lu-worldmap__row';
      place(li, LX - originOf(ul)[0], ry - originOf(ul)[1]);
      setOrigin(li, [LX, ry]);
      const key = document.createElement('i');
      key.className = `g lu-wm-key lu-wm-key--${cls}`;
      place(key, 0, 0, KEY_SIZE, KEY_SIZE);
      const kc = legendKey(kind);
      kc.classList.add('lu-wm-key__art');
      key.append(kc);
      li.append(key);
      txc(li, label, LX + KEY_SIZE + WM.keyGap, ry + KEY_SIZE / 2, { font: 'line', color: k.tx1, drop: true });
      ul.append(li);
      ry += WM.rowH;
    }
    const here = part(legend, 'div', 'lu-worldmap__here');
    if (region.length) {
      const hy = ry + 4;
      section(here, hereTitle, LX, LX + LW, hy);
      let ny = hy + 6;
      const name = document.createElement('b');
      name.className = 'lu-worldmap__region';
      setOrigin(name, originOf(here));
      here.append(name);
      for (const line of region) {
        txt(name, line, LX, ny, { font: 'name', track: 1, color: k.g5, drop: true });
        ny += nameL;
      }
    } else {
      here.style.display = 'none';
      // (the region element stays, empty: setRegion fills it)
      const name = document.createElement('b');
      name.className = 'lu-worldmap__region';
      here.append(name);
    }
    const foot = part(g, 'footer', 'lu-worldmap__foot');
    keyHints(foot, hints, R, CY + colH - 11, { align: 'right', color: k.tx2, drop: true });
    this._regionEl = here.querySelector('.lu-worldmap__region');
  }

  /**
   * The region's name in lines of at most `maxW` art px (name role, one art px of tracking): at
   * spaces in English, at the translator's break hints (U+200B) in Japanese and Chinese, a word too
   * long for a line cut with an ellipsis.
   * @param {string} text
   * @param {number} maxW
   */
  _regionLines(text, maxW) {
    return breakName(text, 'name', maxW, 3).map((l) => fit(l, 'name', maxW, 1));
  }

  /**
   * Load the font slices of the window's strings (CJK fonts come in unicode-range slices); when a
   * new set comes in, lay the window out again once (measure() was then measuring a fallback face).
   * @param {string[]} strings
   */
  _ensureFonts(strings) {
    const key = strings.join('\u0001');
    if (this._ensured.has(key)) return;
    const fonts = currentFonts();
    if (!fonts) return;
    this._ensured.add(key);
    fonts.ensure(strings).then(() => {
      if (this._disposed || !this._lastStrings || this._lastStrings !== key) return;
      this._invalidate();
    }, () => {});
    this._lastStrings = key;
  }

  /**
   * What the region names keep clear of, as boxes on the map (art px, `MapObstacle`): the player's
   * arrow at (px, py) and the static markers — points of interest, campfires, waystones, chests, the
   * boss. Villagers, foes and the party move while the map is open: they are drawn over the names.
   * @param {any} s the state `update` got
   * @param {number} px
   * @param {number} py
   * @returns {MapObstacle[]}
   */
  _obstaclesFor(s, px, py) {
    const S = this._scale;
    const [ox, oz] = this._origin;
    /** @type {MapObstacle[]} */
    const out = [{ left: px - PLAYER_REACH, right: px + PLAYER_REACH + 1, top: py - PLAYER_REACH, bottom: py + PLAYER_REACH + 1, w: KEEP_CLEAR.player }];
    const marks = s?.markers;
    if (marks) {
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        if (!m || m.hidden || !Number.isFinite(m.x) || !Number.isFinite(m.z)) continue;
        const kind = kindOf(m.kind);
        const r = MARKER_REACH[kind] ?? 2;
        const x = Math.floor((m.x + ox) * S), y = Math.floor((m.z + oz) * S);
        out.push({ left: x - r, right: x + r + 1, top: y - r, bottom: y + r + 1, w: Object.prototype.hasOwnProperty.call(KEEP_CLEAR, kind) ? KEEP_CLEAR[kind] : 1 });
      }
    }
    return out;
  }

  /**
   * Place the region names over the map (art px, no layout reads): in priority order (places
   * smallest first, then areas largest first), each label takes the first spot, of its centre, just
   * below and just above it, that no other name holds and that covers no marker (`_obstacles`: the
   * player and the static markers), else the first of those three clear of the player and the
   * waystones (and the boss), else the first of them free (the markers then drawn over it); when
   * other names hold all three, the first further spot — a little to the side, further up or down,
   * then a few other spots inside its region rect — clear of the player and the waystones, else the
   * first free one. A name that finds no free spot, or only a further one over the player or a
   * waystone, tries again set compact (the small role, on two lines) and takes that where it is
   * clear of them; a label with no free spot at all is hidden. Each shown label keeps its box (`_box`,
   * relative to the map) for `update()`.
   */
  _layoutLabels() {
    const map = this.map, box = this._labels;
    if (!map || !box) return;
    box.replaceChildren();
    this._labelList = [];
    const k = pal();
    const S = this._scale, mw = this._mw, md = this._md;
    const obs = this._obstacles;
    // one label per region name; a region that holds another region's centre is an "area"
    // (airier type, placed after the places inside it)
    const list = [];
    const seen = new Set();
    for (const r of this._regions) {
      const name = String(r?.name ?? '').trim();
      if (!name || seen.has(name) || ![r.minX, r.maxX, r.minZ, r.maxZ].every(Number.isFinite)) continue;
      seen.add(name);
      list.push({ name, r, x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2, size: Math.abs((r.maxX - r.minX) * (r.maxZ - r.minZ)), area: false });
    }
    for (const a of list) {
      a.area = list.some((b) => b !== a && b.size < a.size && b.x > a.r.minX && b.x < a.r.maxX && b.z > a.r.minZ && b.z < a.r.maxZ);
    }
    // placement priority: places (smallest first), then areas (largest first)
    list.sort((a, b) => (Number(a.area) - Number(b.area)) || (a.area ? b.size - a.size : a.size - b.size));
    /** @type {{ left: number, right: number, top: number, bottom: number }[]} */
    const placed = [];
    const pad = 2;
    const hits = (q) => placed.some((p) => q.left < p.right + pad && q.right > p.left - pad && q.top < p.bottom + pad && q.bottom > p.top - pad);
    /** the weight of the most important marker a box covers (0: none) */
    const covers = (q) => {
      let w = 0;
      for (const o of obs) if (q.left < o.right && q.right > o.left && q.top < o.bottom && q.bottom > o.top && o.w > w) w = o.w;
      return w;
    };
    /** the near spots (the centre, just below, just above) keep clear of the markers */
    const NEAR = 3;
    /**
     * Try a label's spots; returns the one to take (the caller places it), or null.
     * @param {number} cx @param {number} cy its anchor (art px on the map)
     * @param {number} w @param {number} h its ink box (with the outline)
     * @param {number[][]} inside the other spots, as offsets in art px
     */
    const spot = (cx, cy, w, h, inside) => {
      const tries = [[0, 0], [0, h * 0.95], [0, -h * 0.95], [w * 0.35, -h * 0.5], [-w * 0.35, h * 0.5], [0, -h * 1.9], [0, h * 1.9], ...inside];
      /** @type {{ x: number, y: number, q: { left: number, right: number, top: number, bottom: number }, near: boolean, w: number }[]} */
      const free = [];
      for (let i = 0; i < tries.length; i++) {
        const [dx, dy] = tries[i];
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        const q = { left: x - Math.floor(w / 2), right: x - Math.floor(w / 2) + w, top: y - Math.ceil(h / 2), bottom: y - Math.ceil(h / 2) + h };
        // inside the map
        if (q.left < -2 || q.right > mw + 2 || q.top < -2 || q.bottom > md + 2) continue;
        if (hits(q)) continue;
        free.push({ x, y, q, near: i < NEAR, w: covers(q) });
      }
      // a near spot clear of every marker, else of the player and the waystones, else the first
      // free near spot (the centre: the markers draw over it); with every near spot taken by other
      // names, the first far spot clear of the player and the waystones, else the first free one
      return free.find((f) => f.near && f.w === 0) ?? free.find((f) => f.near && f.w < 2) ?? free.find((f) => f.near)
        ?? free.find((f) => f.w < 2) ?? free[0] ?? null;
    };
    for (const it of list) {
      /** @type {WorldMapLabel} */
      const label = /** @type {any} */ (document.createElement('div'));
      label.className = `g lu-worldmap__label${it.area ? ' lu-worldmap__label--area' : ''}`;
      label._dim = false;
      label._box = null;
      box.append(label);
      this._labelList.push(label);
      const x = Math.min(Math.max(it.x, 0), map.width) * S;
      const z = Math.min(Math.max(it.z, 0), map.depth) * S;
      // other anchors inside the region (art px from the centre), tried when every spot round
      // the centre is taken — a big area whose centre holds a smaller place's name still gets one
      label._inside = INSIDE_SPOTS.map(([u, v]) => [
        (Math.min(Math.max(it.r.minX + (it.r.maxX - it.r.minX) * u, 0), map.width) * S - x) / mw,
        (Math.min(Math.max(it.r.minZ + (it.r.maxZ - it.r.minZ) * v, 0), map.depth) * S - z) / md,
      ]);
      const inside = label._inside.map(([fx, fz]) => [fx * mw, fz * md]);
      const text = UP(it.name);
      const track = it.area && !cjk() ? 3 : 1;
      const color = it.area ? k.g4 : k.tx1;
      const role = labelRole();
      const ink = Math.ceil(inkNow(role)) + 2;
      const w = measure(text, role, track) + 2;
      const got = spot(x, z, w, ink, inside);
      if (got && (got.near || got.w < 2)) {
        placed.push(got.q);
        txc(label, text, got.x, got.y, { font: role, track, color, ol: true, align: 'center' });
        label._box = got.q;
        continue;
      }
      // no room for it, or only away from its centre over the player or a waystone: set compact and
      // try again — a big area's name (the farms round a windmill and an orchard), or any name where
      // the half-size name role has grown with --fpx (px 3: 1.33× G's on the same map) and crowds its
      // neighbours; the full name where it was when compact finds no better spot
      const cr = compactRole();
      const lines = this._compactLines(text, 64, cr);
      const lh = cjk() ? FONT.small.L : 8;
      const cw = Math.max(...lines.map((l) => measure(l, cr, 1))) + 2;
      const ch = (lines.length - 1) * lh + Math.ceil(inkNow(cr)) + 2;
      const c2 = spot(x, z, cw, ch, inside);
      if (got && !(c2 && c2.w < 2)) {
        placed.push(got.q);
        txc(label, text, got.x, got.y, { font: role, track, color, ol: true, align: 'center' });
        label._box = got.q;
        continue;
      }
      if (c2) {
        placed.push(c2.q);
        label.classList.add('lu-worldmap__label--compact');
        const top = c2.y - ((lines.length - 1) * lh) / 2;
        lines.forEach((l, i) => txc(label, l, c2.x, top + i * lh, { font: cr, track: 1, color, ol: true, align: 'center' }));
        label._box = c2.q;
        continue;
      }
      label.style.visibility = 'hidden';
    }
  }

  /**
   * A compact region name in at most two lines of `maxW` art px (`compactRole`).
   * @param {string} text
   * @param {number} maxW
   * @param {'small'|'line'} [role]
   */
  _compactLines(text, maxW, role = compactRole()) {
    return breakName(text, role, maxW, 2);
  }

  /** The map alone (the markers' layer cleared: the window opens with it before the first update). */
  _drawBase() {
    const b = this._baseCanvas, bc = this._baseCtx;
    bc.imageSmoothingEnabled = false;
    bc.clearRect(0, 0, b.width, b.height);
    if (this._base) bc.drawImage(this._base, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  open() {
    if (!this.map || this._open) return this._open;
    this._open = true;
    // (laid out only now that it shows: setMap, setRegion, the legend and the scale only mark it)
    if (this._dirty || !this._built) this._build();
    this.element.classList.add('is-open');
    this.element.setAttribute('aria-hidden', 'false');
    return true;
  }

  close() {
    if (!this._open) return false;
    this._open = false;
    this.element.classList.remove('is-open');
    this.element.setAttribute('aria-hidden', 'true');
    return false;
  }

  toggle() {
    return this._open ? this.close() : this.open();
  }

  /** Redraw while open (villagers move, the player's ring pulses); nothing while closed. */
  update(dt, s) {
    if (!this._open || !this.map || !this._base) return;
    this._pulse = (this._pulse + dt) % 1.6;
    const ctx = this.ctx;
    if (!s?.player) { ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); return; }
    // the party (PARTY.md §6.3): a legend row while it has members (the window is laid out again)
    const pa = s.party;
    const pn = pa ? pa.length : 0;
    if ((pn > 0) !== this._party) this._setPartyLegend(pn > 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const S = this._scale;
    // (a campaign overview: the level's own coordinates shifted to its place on the map)
    const [ox, oz] = this._origin;
    const px = Math.floor((s.player.x + ox) * S), py = Math.floor((s.player.z + oz) * S);
    const marks = s.markers;
    // the region names keep clear of the player and the static markers: placed again when the
    // player stands elsewhere or a marker came or went (once per opening: play is paused)
    let nm = 0;
    if (marks) for (let i = 0; i < marks.length; i++) if (!marks[i].hidden) nm++;
    if (px !== this._sigX || py !== this._sigY || nm !== this._sigN) {
      this._sigX = px;
      this._sigY = py;
      this._sigN = nm;
      this._obstacles = this._obstaclesFor(s, px, py);
      this._layoutLabels();
    }
    const dot = (/** @type {string} */ kind, /** @type {number} */ x, /** @type {number} */ z) => {
      ctx.drawImage(markerSprite(kind), Math.floor((x + ox) * S) - MARKER_HALF, Math.floor((z + oz) * S) - MARKER_HALF);
    };
    for (const pass of PASSES) {
      if (marks) {
        for (let i = 0; i < marks.length; i++) {
          const m = marks[i];
          if (m.hidden) continue;
          const kind = kindOf(m.kind);
          if (PASS[kind] === pass) dot(kind, m.x, m.z);
        }
      }
      if (pass === 1) { const np = s.npcs; if (np) for (let i = 0; i < np.length; i++) dot('npc', np[i].x, np[i].z); }
    }
    const en = s.enemies;
    if (en) for (let i = 0; i < en.length; i++) dot('enemy', en[i].x, en[i].z);
    // the party: over villagers and enemies, under the player's ring and arrow
    for (let i = 0; i < pn; i++) dot('party', pa[i].x, pa[i].z);
    // a region name left over the "you are here" arrow fades back (the markers draw over it too)
    const near = 6;
    for (const el of this._labelList) {
      const b = el._box;
      const over = !!b && px > b.left - near && px < b.right + near && py > b.top - near && py < b.bottom + near;
      if (over !== el._dim) {
        el._dim = over;
        el.style.opacity = over ? '0.3' : '';
      }
    }
    // the ring: grows in whole pixels and fades in steps over 1.6 s
    const tt = this._pulse / 1.6;
    const step = Math.min(4, Math.floor(tt * 5));
    const ring = pulseRing(5 + step * 2);
    ctx.globalAlpha = [0.9, 0.7, 0.5, 0.32, 0.16][step];
    ctx.drawImage(ring, px - (ring.width >> 1), py - (ring.height >> 1));
    ctx.globalAlpha = 1;
    const f = s.facing ?? DEFAULT_FACING;
    ctx.drawImage(arrowSprite(facingOf(f.x, f.z)), px - 4, py - 4);
  }

  dispose() {
    this._disposed = true;
    this._offScale();
    this.element.remove();
  }
}
