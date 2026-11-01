/**
 * The pixel UI's placement helpers (docs/specs/PIXEL_UI.md §2), ported from mockup G's UI code and
 * the helpers of its screens. Everything is placed in art pixels of G's 640 × 360 frame and written
 * to CSS as `calc(var(--px) * n)`, so the UI follows the root's one whole-number --px. HUD pieces
 * live in groups anchored to a corner or an edge of the root (`group`); their children are placed in
 * the same frame coordinates and land relative to the group, so a component's recipe
 * (docs/specs/PIXEL_UI.md §5) can be followed literally.
 *
 * The type (roles, `txt`, `measure` …) is ./type.js; the art is ../art/.
 */
import './base.css';
import { txt, txc, measure, capMid, originOf, setOrigin } from './type.js';
import { frameCanvas, FRAME_MARGIN } from '../art/frames.js';
import { keycapArt, hairline } from '../art/pieces.js';
import { pal } from '../art/palette.js';
import { currentScale, fitScale } from '../UiScale.js';

export { setMeasureHost, measureHost, lineCount } from './type.js';

/** @import { FrameStyle } from '../art/frames.js' */
/** @import { RoleId } from './type.js' */

/** n art pixels as CSS: `calc(var(--px) * n)`. @param {number} n */
export const U = (n) => `calc(var(--px) * ${n})`;
/**
 * A CSS length expression rounded down to a whole device pixel (`--lu-dpx`, the root sets it): a
 * centre anchor at an odd root size would otherwise land on half a device pixel.
 * @param {string} expr
 */
const DPX = (expr) => `round(down, calc(${expr}), var(--lu-dpx, 1px))`;

/**
 * Set an element's left / top (and width / height) in art px.
 * @param {HTMLElement|SVGElement} el
 * @param {number} x
 * @param {number} y
 * @param {number|null} [w]
 * @param {number|null} [h]
 */
export function place(el, x, y, w = null, h = null) {
  el.style.left = U(x);
  el.style.top = U(y);
  if (w != null) el.style.width = U(w);
  if (h != null) el.style.height = U(h);
}

/**
 * Where a group is anchored: vertical (t | m | b) + horizontal (l | c | r), or 'stage' (a world
 * point; never shrunk).
 * @typedef {'tl'|'tc'|'tr'|'ml'|'mc'|'mr'|'bl'|'bc'|'br'|'stage'} Anchor
 */

/**
 * A HUD group anchored to the root: (x, y, w, h) is where it sits in the 640 × 360 frame (w and h
 * rounded up to even), measured from the edges it is anchored to — `right` is 640 − x − w, `bottom`
 * 360 − y − h, a centre anchor follows the root's middle (rounded down to a whole device pixel) —
 * so the same numbers hold at any root size. Children are placed in the same frame coordinates
 * (`put`, `txt`, `win` …) and land relative to the group. No group is scaled while it fits
 * (UiScale.js): a corner group (tl tr bl br) shrinks about the root's corner only on a screen under
 * G's corner footprint (`--shrink-corner`; the root's `data-lu-scale="shrunk"`), a centred group
 * (tc bc mc ml mr) only when it does not fit the root itself — about the root's middle or edge it
 * is anchored to, by `fitScale` (its `data-fit="shrunk"` and `--lu-fit`, written here from the
 * root's scale when the group is made: a component lays itself out again on 'scale'). Both are the
 * CSS `scale` property, which composes with a `transform` of the group's own (base.css).
 *
 * `sc` must cover the whole root — the root itself, or a component's element positioned absolute
 * with inset 0 (class `lu-stage`, base.css; `.lu-hud` is one): the anchors and the shrink's origin
 * are measured from its box, so in a smaller box a right, bottom or centre anchor lands wrong.
 * @param {Element} sc the parent (a component's element covering the root, or the UI root)
 * @param {Anchor} anchor
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {string} [cls]
 * @returns {HTMLDivElement}
 */
export function group(sc, anchor, x, y, w, h, cls = '') {
  const g = document.createElement('div');
  g.className = `g grp${cls ? ` ${cls}` : ''}`;
  anchorEl(g, anchor, x, y, w, h, sc);
  sc.append(g);
  return g;
}

/**
 * Anchor an element of a component's own as a group (what `group()` does to the div it makes, for
 * an element the component keeps and re-anchors — a panel that changes size, a box placed again on
 * every layout): the classes `g grp`, its frame origin (children placed in frame coordinates land
 * relative to it), `data-anchor`, its box in art px from the edges it is anchored to (w and h
 * rounded up to even; the left / right / top / bottom it does not use cleared), the shrink's
 * origin, and the fit of a centred group (`setGroupFit`). Returns the element.
 * @template {HTMLElement} E
 * @param {E} el
 * @param {Anchor} anchor
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {Element|null} [sc] an element in the root (default: `el`, which must be in it already
 *   for a centred group to be fitted)
 * @returns {E}
 */
export function anchorEl(el, anchor, x, y, w, h, sc = null) {
  w += w % 2; h += h % 2;
  el.classList.add('g', 'grp');
  setOrigin(el, [x, y]);
  el.dataset.anchor = anchor;
  const s = el.style;
  s.left = ''; s.right = ''; s.top = ''; s.bottom = '';
  s.width = U(w); s.height = U(h);
  const [v, hz] = anchor === 'stage' ? ['t', 'l'] : anchor.split('');
  let ox, oy;
  if (hz === 'l') { s.left = U(x); ox = U(-x); }
  else if (hz === 'r') { s.right = U(640 - x - w); ox = `calc(100% + ${U(640 - x - w)})`; }
  else { s.left = DPX(`50% - ${U(w / 2)} + ${U(x + w / 2 - 320)}`); ox = `calc(50% - ${U(x + w / 2 - 320)})`; }
  if (v === 't') { s.top = U(y); oy = U(-y); }
  else if (v === 'b') { s.bottom = U(360 - y - h); oy = `calc(100% + ${U(360 - y - h)})`; }
  else { s.top = DPX(`50% - ${U(h / 2)} + ${U(y + h / 2 - 180)}`); oy = `calc(50% - ${U(y + h / 2 - 180)})`; }
  // the shrink's origin: the root's corner / edge the group hangs from, in the group's own box
  if (anchor !== 'stage') s.transformOrigin = `${ox} ${oy}`;
  else s.removeProperty('transform-origin');
  setGroupFit(el, anchor, x, y, w, h, sc);
  return el;
}

/**
 * A plain box at (x, y) art px of the frame (w × h when given), its children placed in the same
 * frame coordinates (its frame origin is where it lands): an element `tag` with the classes
 * `g` + cls, at whole art px relative to `parent` (a canvas inside lands on the art grid at every
 * --px), appended to it. The four components' private helpers in one (TitleScreen, Journal,
 * PartyPanel: a section of a window, a row, a card).
 * @param {Element} parent
 * @param {number} x
 * @param {number} y
 * @param {number|null} [w]
 * @param {number|null} [h]
 * @param {string} [cls]
 * @param {string} [tag] 'div'
 * @returns {HTMLElement}
 */
export function box(parent, x, y, w = null, h = null, cls = '', tag = 'div') {
  const el = document.createElement(tag);
  el.className = cls ? `g ${cls}` : 'g';
  const [ox, oy] = originOf(parent);
  const rx = Math.round(x - ox), ry = Math.round(y - oy);
  place(el, rx, ry, w, h);
  setOrigin(el, [ox + rx, oy + ry]);
  parent.append(el);
  return el;
}

/**
 * Scale a centred group to fit the root only when it does not fit (UiScale.js `fitScale`): sets or
 * clears its `data-fit="shrunk"` and `--lu-fit` (base.css) from the current scale of the root `sc`
 * is in. `group()` calls it; a component that anchors an element of its own the same way (a group
 * it keeps and re-anchors) calls it after each re-anchor. Corner anchors and 'stage' are left
 * unscaled (the corners follow the root's `--shrink-corner`). Returns the scale (1: none).
 * @param {HTMLElement} g
 * @param {Anchor} anchor
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {Element|null} [sc] an element in the root (default: `g`)
 */
export function setGroupFit(g, anchor, x, y, w, h, sc = null) {
  const r = currentScale(sc ?? g);
  const f = r ? fitScale(anchor, x, y, w, h, r.artW, r.artH) : 1;
  if (f < 1) {
    g.dataset.fit = 'shrunk';
    g.style.setProperty('--lu-fit', `${+f.toFixed(6)}`);
  } else if (g.dataset.fit) {
    delete g.dataset.fit;
    g.style.removeProperty('--lu-fit');
  }
  return f;
}

/**
 * Show a canvas at (x, y) art px, `k` art px per canvas px (classes `px g` + cls).
 * @param {Element} parent
 * @param {HTMLCanvasElement} c
 * @param {number} x
 * @param {number} y
 * @param {number} [k]
 * @param {string} [cls]
 * @returns {HTMLCanvasElement}
 */
export function put(parent, c, x, y, k = 1, cls = '') {
  const [ox, oy] = originOf(parent);
  c.classList.add('px', 'g');
  if (cls) c.classList.add(...cls.split(' ').filter(Boolean));
  place(c, Math.round(x - ox), Math.round(y - oy), c.width * k, c.height * k);
  parent.append(c);
  return c;
}

/**
 * A framed box (A's frame family) at (x, y), w × h art px: the rim and glass on one canvas under
 * the content (`frame`), the ornaments (gems, scrolls, the crown) on one above it (`orn`; none with
 * `o.orn === false`). Painted once per style and size (frames.js `frameCanvas`).
 * @param {Element} parent
 * @param {FrameStyle} o
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {{ base: HTMLCanvasElement, orn: HTMLCanvasElement|null }}
 */
export function win(parent, o, x, y, w, h) {
  const M = FRAME_MARGIN;
  const { base, orn } = frameCanvas(o, w, h);
  put(parent, base, x - M, y - M, 1, 'frame');
  if (orn) put(parent, orn, x - M, y - M, 1, 'orn');
  return { base, orn };
}

const ARROWS = Object.freeze({ '↑': 'kUp', '↓': 'kDown', '←': 'kLeft', '→': 'kRight' });
/** @param {string} k */
const isDigit = (k) => /^[0-9]$/.test(k);

/**
 * The keycap's width for a key name (art px): 11 for an arrow, else the name's width + 6 (11 at least).
 * @param {string} k a key name ('Space', 'Esc', 'G', '1') or an arrow (↑ ↓ ← →)
 */
export const capW = (k) => (ARROWS[k] ? 11 : Math.max(11, measure(k, isDigit(k) ? 'num' : 'tiny') + 6));

/**
 * A keycap at (x, y): A's key painted on canvas (11 tall), its name DOM text over it — Tiny5 for
 * letters, Jersey 10 (half) for a digit, both with their cap on the face's rows 2–6, in every
 * language (key names stay Latin). The canvas has role img and the key name as its aria-label.
 * Returns its width.
 * @param {Element} parent
 * @param {string} k
 * @param {number} x
 * @param {number} y
 * @param {{ dim?: boolean, cls?: string }} [o]
 */
export function key(parent, k, x, y, o = {}) {
  const w = capW(k);
  const cap = keycapArt(w, 11, ARROWS[k] ?? null, o.dim);
  cap.setAttribute('role', 'img');
  cap.setAttribute('aria-label', k);
  put(parent, cap, x, y, 1, `key${o.cls ? ` ${o.cls}` : ''}`);
  if (!ARROWS[k]) {
    const k0 = pal();
    const font = isDigit(k) ? 'num' : 'tiny';
    // E's centring: whole art pixels, so Tiny5 stays on the art grid; the cap centred on the face's rows 2–6
    txt(parent, k, x + Math.floor(w / 2) - Math.floor(measure(k, font) / 2), y + 4.5 - capMid(font), { font, color: o.dim ? k0.ink1 : k0.kink, cls: `keylab${o.cls ? ` ${o.cls}` : ''}` });
  }
  return w;
}

/**
 * Key hints: keycaps and their labels in a row from x (align 'right' / 'center' about x); returns
 * the width.
 * @param {Element} parent
 * @param {{ keys: string[], label: string }[]} hints
 * @param {number} x
 * @param {number} y
 * @param {{ font?: RoleId, gap?: number, align?: 'left'|'right'|'center', color?: string, ol?: boolean, drop?: boolean, cls?: string }} [o]
 */
export function keyHints(parent, hints, x, y, o = {}) {
  const font = o.font ?? 'line';
  const gap = o.gap ?? 10;
  const items = hints.map((h) => ({ keys: h.keys, label: h.label, lw: measure(h.label, font) }));
  const total = items.reduce((a, it) => a + it.keys.reduce((b, k) => b + capW(k) + 2, 0) + 2 + it.lw + gap, -gap);
  let cx = o.align === 'right' ? x - total : o.align === 'center' ? x - Math.floor(total / 2) : x;
  const ty = y + 5.5 - capMid(font);
  for (const it of items) {
    for (const k of it.keys) cx += key(parent, k, cx, y) + 2;
    txt(parent, it.label, cx + 2, ty, { font, color: o.color, ol: o.ol, drop: o.drop, cls: o.cls });
    cx += 2 + it.lw + gap;
  }
  return total;
}

/**
 * A section heading (G's `section`): the label (small, tracked, g4), a gilt rule running right, a
 * word (or a count, `rf` 'num') at the right end x1; its ink centred on cy.
 * @param {Element} g
 * @param {string} label
 * @param {number} x0
 * @param {number} x1
 * @param {number} cy
 * @param {string|null} [right]
 * @param {RoleId} [rf]
 */
export function section(g, label, x0, x1, cy, right = null, rf = 'line') {
  const k = pal();
  txc(g, label, x0, cy, { font: 'small', track: 1, color: k.g4, drop: true });
  const lw = measure(label, 'small', 1);
  const rw = right ? measure(right, rf) + 6 : 0;
  put(g, hairline(x1 - x0 - lw - 6 - rw, 'r'), x0 + lw + 5, Math.round(cy));
  if (right) txc(g, right, x1, cy, { font: rf, color: k.g4, align: 'right', drop: true });
}

/**
 * A value / max pair in Jersey 10 (half; G's `numPair`): the value in cream (or o.color, or hp3
 * when `low`), '/max' dimmer — one text element, so the two never part by a rounded-up width at
 * another --px. Returns its width.
 * @param {Element} g
 * @param {[number|string, number|string]} pair
 * @param {number} x
 * @param {number} y
 * @param {{ low?: boolean, color?: string }} [o]
 */
export function numPair(g, [a, b], x, y, o = {}) {
  const k = pal();
  return txt(g, `${a}{/${b}}`, x, y, { font: 'num', color: o.low ? k.hp3 : o.color ?? k.tx1, kw: k.tx2, drop: true }).tw;
}
