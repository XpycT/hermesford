/**
 * The pixel UI's scale (docs/specs/PIXEL_UI.md §1.2): one art pixel is `px` whole **device**
 * pixels, `px = max(2, ⌊min(W / 640, H / 360)⌋)` for a W × H device-pixel screen (2 up to 1919 px
 * wide, 3 at 1920 × 1080, 4 at 2560 × 1440), and a half-size font pixel is `fpx = ⌈px / 2⌉`
 * (`fpxFor`): 1 at px 2, 2 at px 3 and 4, 3 at px 5 and 6.
 *
 * Why ⌈px / 2⌉: G's half-size roles (Jersey at one font pixel per device pixel beside 2-px art
 * pixels) are half an art pixel per font pixel. At an odd px no whole number of device pixels is
 * half of it; ⌈px / 2⌉ is always the nearer one in proportion (px 3: 2/3 of an art px, 1.33× G,
 * against ⌊px / 2⌋'s 1/3, 0.67×; px 5: 1.2× against 0.8×), and it keeps the type hierarchy the
 * floor inverted (a 'HP' label over a shorter '100/100', a keycap taller than its label, Latin in
 * a CJK line at half the kanji's height). The CJK lines' Jersey aliases pick their own whole-pixel
 * size (layout/type.js `aliasSpecs`).
 *
 * Small screens keep px 2 — never a fractional art pixel:
 * - The corner groups (anchors tl tr bl br: the HUD, the dialogue, the skill bar) hang from their
 *   corners unscaled while the screen holds G's corner footprint, 512 × 300 art px (1024 × 600
 *   device px): `cornerShrink` is 1 there. Below it they shrink about their corners by
 *   `min(artW / 512, artH / 300)` (the root's `data-lu-scale="shrunk"`, base.css) — the one
 *   fractional scale left, for windows too small for the HUD at px 2.
 * - A centred group (tc bc mc ml mr: the banner, the boss bar, the L windows, the title) is scaled
 *   only when it does not fit the screen (layout.js `group()` → `fitScale`): it keeps its place and
 *   size where it fits, and a component may reflow to `artW` / `artH` instead.
 * `shrink` is `cornerShrink` (the corner groups' scale: what a component that places itself beside
 * a corner group compensates for).
 *
 * `artScale` is pure (no DOM): UI.js feeds it the root's size and the device pixel ratio and writes
 * the result onto the root as `--px` / `--fpx` (CSS px: px / dpr), `--shrink` and `--shrink-corner`.
 *
 * The roots' scale for components (`onScale`, `currentScale`, `scaleRootOf`): every UI root
 * registers itself here (`bindScaleRoot`, UI.js), so a component made with only its parent element
 * (`new HUD(root)`) follows the scale of the root it lives in without a reference to the UI:
 * `this._offScale = onScale(parent, (s) => this._layout())` and `this._offScale()` in `dispose()`.
 */

/**
 * The art scale of a screen.
 * @typedef {object} ArtScale
 * @property {number} px one art pixel in device pixels (whole, ≥ 2)
 * @property {number} fpx one half-size font pixel in device pixels (whole, ≥ 1: `fpxFor(px)`)
 * @property {number} shrink the corner groups' scale: `cornerShrink` (1 from 1024 × 600 device px
 *   up at px 2, less below)
 * @property {number} cornerShrink the corner groups' scale (the same value as `shrink`): 1 while
 *   the screen holds `CORNER_W` × `CORNER_H` art px, else `min(artW / CORNER_W, artH / CORNER_H)`
 * @property {number} artW the screen's width in art pixels (whole, rounded down)
 * @property {number} artH the screen's height in art pixels (whole, rounded down)
 * @property {number} dpr the device pixel ratio it was computed for
 * @property {number} W the screen's width in device pixels
 * @property {number} H the screen's height in device pixels
 * @property {number} cssPx one art pixel in CSS pixels (px / dpr: the root's `--px`)
 * @property {number} cssFpx one half-size font pixel in CSS pixels (fpx / dpr: `--fpx`)
 */

/**
 * A centred group's fit at or above this is 1 (`fitScale`: a group a few pixels short of its
 * margins keeps its crisp, unscaled pixels).
 */
export const SHRINK_SNAP = 0.97;
/** G's corner footprint in art px: the dialogue (10 + 496 + 6) wide, the HUD's corner stacks tall. */
export const CORNER_W = 512;
export const CORNER_H = 300;

/**
 * The half-size font pixel for an art pixel of `px` device pixels: `⌈px / 2⌉` (≥ 1).
 * @param {number} px
 */
export const fpxFor = (px) => Math.max(1, Math.ceil(Math.max(1, Math.round(px)) / 2));

/**
 * The art scale for a w × h CSS-pixel screen at device pixel ratio `dpr`.
 * @param {{ w: number, h: number, dpr?: number }} size
 * @returns {ArtScale}
 */
export function artScale({ w, h, dpr = 1 }) {
  const r = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const W = Math.max(1, Math.round((Number.isFinite(w) ? w : 0) * r));
  const H = Math.max(1, Math.round((Number.isFinite(h) ? h : 0) * r));
  const fit = Math.floor(Math.min(W / 640, H / 360) + 1e-6);
  const px = Math.max(2, fit);
  const fpx = fpxFor(px);
  const artW = Math.floor(W / px), artH = Math.floor(H / px);
  const shrink = artW >= CORNER_W && artH >= CORNER_H ? 1 : Math.min(1, artW / CORNER_W, artH / CORNER_H);
  return {
    px, fpx, shrink, cornerShrink: shrink,
    artW, artH,
    dpr: r, W, H,
    cssPx: px / r, cssFpx: fpx / r,
  };
}

// ---------------------------------------------------------------------------------------------
// The roots' scale, for components
// ---------------------------------------------------------------------------------------------

/**
 * What a UI root offers its components here (UI.js: the `UI` itself).
 * @typedef {object} ScaleRoot
 * @property {HTMLElement} root the root element (`.lu-root`)
 * @property {ArtScale} scale the current scale
 * @property {(event: 'scale', fn: (s: ArtScale) => void) => () => void} on subscribe → unsubscribe
 */

/** Root element → its UI. @type {WeakMap<Element, ScaleRoot>} */
const ROOTS = new WeakMap();
/** The roots made, newest last (for a lookup without an element, or outside every root). @type {ScaleRoot[]} */
const ORDER = [];

/**
 * Register a UI root (UI.js, in its constructor).
 * @param {ScaleRoot} src
 */
export function bindScaleRoot(src) {
  ROOTS.set(src.root, src);
  ORDER.push(src);
}

/**
 * Forget a UI root (UI.js `dispose`).
 * @param {ScaleRoot} src
 */
export function unbindScaleRoot(src) {
  ROOTS.delete(src.root);
  const i = ORDER.indexOf(src);
  if (i >= 0) ORDER.splice(i, 1);
}

/**
 * The UI root an element lives in (its nearest `.lu-root` ancestor, itself included); for null or
 * an element outside every root (not yet appended), the newest root of the page; null without one.
 * @param {Element|null} [el]
 * @returns {ScaleRoot|null}
 */
export function scaleRootOf(el = null) {
  const r = el?.closest?.('.lu-root');
  return (r && ROOTS.get(r)) ?? ORDER[ORDER.length - 1] ?? null;
}

/**
 * The current art scale of the root `el` lives in (see `scaleRootOf`); null without a root.
 * @param {Element|null} [el]
 * @returns {ArtScale|null}
 */
export const currentScale = (el = null) => scaleRootOf(el)?.scale ?? null;

/**
 * Follow the scale of the root `el` lives in (see `scaleRootOf`): `fn` runs on every 'scale' event
 * of that root — after the type and the fonts follow the new scale (the CJK Jersey aliases rebuilt:
 * `measure()` is right inside `fn`). Returns the unsubscribe (call it in the component's
 * `dispose()`); a no-op without a root.
 * @param {Element|null} el the component's parent or element
 * @param {(s: ArtScale) => void} fn
 * @returns {() => void}
 */
export function onScale(el, fn) {
  const src = scaleRootOf(el);
  return src ? src.on('scale', fn) : () => {};
}

/**
 * The scale a centred group (anchors tc bc mc ml mr) needs to fit a screen of `artW` × `artH` art
 * px: 1 where it fits with its margins (its own distance to G's frame edges, at most 16 art px),
 * else the largest scale about its anchor (the root's middle or edge, as `group()` sets the
 * origin) that keeps it inside them; 1 from `SHRINK_SNAP` up. Corner anchors and 'stage' get 1
 * (the corners follow `cornerShrink`). (x, y, w, h) are the group's art px in G's 640 × 360 frame.
 * @param {string} anchor
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} artW
 * @param {number} artH
 */
export function fitScale(anchor, x, y, w, h, artW, artH) {
  if (anchor === 'stage' || !/^[tmb][lcr]$/.test(anchor) || /^[tb][lr]$/.test(anchor)) return 1;
  const [v, hz] = anchor;
  const m = (a) => Math.max(0, Math.min(16, a));
  /** the scale that keeps [lo, hi] (frame px, about the frame point o, mapped to o') inside [mlo, size − mhi] */
  const axis = (lo, hi, o, o2, size, mlo, mhi) => {
    let s = Infinity;
    if (hi > o) s = Math.min(s, (size - mhi - o2) / (hi - o));
    if (lo < o) s = Math.min(s, (o2 - mlo) / (o - lo));
    return s;
  };
  let s = 1;
  if (hz === 'c') s = Math.min(s, axis(x, x + w, 320, artW / 2, artW, m(x), m(640 - x - w)));
  if (v === 'm') s = Math.min(s, axis(y, y + h, 180, artH / 2, artH, m(y), m(360 - y - h)));
  else if (v === 't') s = Math.min(s, axis(y, y + h, 0, 0, artH, 0, m(360 - y - h)));
  else if (v === 'b') s = Math.min(s, axis(y, y + h, 360, artH, artH, m(y), 0));
  if (!(s > 0)) s = 0.25;
  return s >= SHRINK_SNAP ? 1 : s;
}
