/**
 * The pixel UI's small pieces (docs/specs/PIXEL_UI.md §2), ported from mockup G's art and the
 * helpers of its screens: bars, glyphs, keycaps, stepped and dithered alpha (fade, band, plate),
 * hairlines, the selection band, the speech bubble, the compass star, the clock's halo and day bar,
 * the coin and the divider. Every piece is a canvas of one canvas pixel per art pixel.
 */
import { pal, GEMS } from './palette.js';
import { gem, stamp, gild } from './gilt.js';
import { art } from './painter.js';

/** @import { PixelPainter } from './painter.js' */

/**
 * Two-tone rows for a fill of ih rows from a ramp [dark2, dark1, light1, light0] (or 3 colours).
 * @param {string[]} ramp
 * @param {number} ih
 * @returns {string[]}
 */
export function rampRows(ramp, ih) {
  const r = ramp.length === 3 ? [ramp[0], ramp[0], ramp[1], ramp[2]] : ramp;
  const [d2, d1, l1, l0] = r;
  if (ih <= 1) return [l1];
  if (ih === 2) return [l0, d1];
  if (ih === 3) return [l0, l1, d1];
  if (ih === 4) return [l0, l1, d1, d2];
  const out = [];
  for (let j = 0; j < ih; j++) out.push(j === 0 ? l0 : j < ih / 2 ? l1 : j < ih - 1 ? d1 : d2);
  return out;
}

/**
 * A bar (HP, MP, SP, XP) painted into `p` at (0, 0): w × h art pixels. A's bar: an ink outline
 * (o.outline), the fill light on top and dark below, the trough, a light line at the fill's end, a
 * pale chip band up to o.chip, ink notches every 1 / o.notch; o.ring: today's gold ring outside the
 * ink (adds 1 px all round).
 * @param {PixelPainter} p
 * @param {number} w
 * @param {number} h
 * @param {number} v the fill, 0…1
 * @param {string[]} ramp [dark2, dark1, light1, light0] (or 3 colours)
 * @param {{ ring?: string, outline?: string, chip?: number|null, notch?: number, trough?: string[] }} [o]
 */
export function bar(p, w, h, v, ramp, o = {}) {
  const k = pal();
  let x0 = 0, y0 = 0;
  if (o.ring) { p.rect(1, 0, w - 2, h, o.ring); p.rect(0, 1, w, h - 2, o.ring); x0 = 1; y0 = 1; w -= 2; h -= 2; }
  p.rect(x0, y0, w, h, o.outline ?? k.ink0);
  const iw = w - 2, ih = h - 2;
  const fw = Math.round(iw * Math.max(0, Math.min(1, v)));
  const cw = o.chip != null ? Math.round(iw * o.chip) : fw;
  const rows = rampRows(ramp, ih);
  const chip = rampRows([k.g3, k.g4, k.g5, k.g5], ih);
  for (let j = 0; j < ih; j++) {
    const Y = y0 + 1 + j;
    p.hline(x0 + 1, Y, iw, j === 0 ? (o.trough?.[0] ?? k.tr0) : (o.trough?.[1] ?? k.tr1));
    if (cw > fw) p.hline(x0 + 1 + fw, Y, cw - fw, chip[j]);
    if (fw > 0) p.hline(x0 + 1, Y, fw, rows[j]);
  }
  if (fw > 1 && fw < iw && ih > 2) p.vline(x0 + fw, y0 + 2, ih - 1, rows[0]);
  if (o.notch) {
    for (let i = 1; i < o.notch; i++) {
      const nx = x0 + 1 + Math.round(iw * i / o.notch);
      p.vline(nx, y0 + 1 + ih - Math.ceil(ih / 2), Math.ceil(ih / 2), k.ink0);
    }
  }
}

/**
 * Small glyph sprites (palette rows): A's cursors, the advance mark, arrows, keycap arrows, the
 * check and the lock. Keys: o ink, L g4, G g3, D g2, B g1, W g5, a b c the sapphire.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const GLYPHS = Object.freeze({
  cursor: [
    'oo......',
    'oLoo....',
    'oLLGoo..',
    'oLWGGDoo',
    'oLGGDDoo',
    'oLGDoo..',
    'oGoo....',
    'oo......',
  ],
  cursorGem: [
    '..oo........',
    '..oLoo......',
    'ooLLGGoo....',
    'oLLWGGDDoo..',
    'oLGcbbaDDDo.',
    'oLGGbaDDoo..',
    'ooGGDDoo....',
    '..oGoo......',
    '..oo........',
  ],
  advance: [
    'ooooooooo',
    'oLLLLLLGo',
    '.oLWGGDo.',
    '.oGGGDDo.',
    '..oGDDo..',
    '..oGDo...',
    '...oDo...',
    '....o....',
  ],
  left: [
    '...oo',
    '..oLo',
    '.oLGo',
    'oLGDo',
    '.oGDo',
    '..oDo',
    '...oo',
  ],
  right: [
    'oo...',
    'oLo..',
    'oGLo.',
    'oGGLo',
    'oGDo.',
    'oDo..',
    'oo...',
  ],
  kUp: ['...o...', '..ooo..', '.ooooo.', 'ooooooo', '..ooo..', '..ooo..', '..ooo..'],
  kDown: ['..ooo..', '..ooo..', '..ooo..', 'ooooooo', '.ooooo.', '..ooo..', '...o...'],
  kLeft: ['...o...', '..oo...', '.oooooo', 'ooooooo', '.oooooo', '..oo...', '...o...'],
  kRight: ['...o...', '...oo..', 'oooooo.', 'ooooooo', 'oooooo.', '...oo..', '...o...'],
  check: [
    '.......oo',
    '......oLo',
    'oo...oLo.',
    'oLo.oLo..',
    '.oLoLo...',
    '..oLo....',
    '...o.....',
  ],
  lock: [
    '..ooo..',
    '.oLLLo.',
    'oLoooLo',
    'oGo.oGo',
    'ooooooo',
    'oLLWLLo',
    'oGGoGGo',
    'oGGoGDo',
    'oDDDDDo',
    'ooooooo',
  ],
});

/**
 * A glyph canvas; `over` maps row characters (defaults: the gold ramp and a sapphire).
 * @param {string} name a GLYPHS key
 * @param {Record<string, string>} [over]
 * @returns {HTMLCanvasElement}
 */
export function glyph(name, over = {}) {
  const k = pal();
  const rows = /** @type {string[]} */ (GLYPHS[name]);
  if (!rows) throw new Error(`glyph: no glyph "${name}" (${Object.keys(GLYPHS).join(', ')})`);
  const map = { o: k.ink0, L: k.g4, G: k.g3, D: k.g2, B: k.g1, W: k.g5, a: k.sa1, b: k.sa2, c: k.sa3, ...over };
  const w = Math.max(...rows.map((r) => r.length));
  return art(w, rows.length, (p) => p.rows(0, 0, rows, map));
}

/**
 * The same glyph in dim gilt (an arrow at the end of its options, an idle row).
 * @param {string} name
 */
export const dimGlyph = (name) => { const k = pal(); return glyph(name, { L: k.dm1, G: k.dm2, D: k.dm3, W: k.dm1, B: k.dm3 }); };

/**
 * A lone gem canvas (radius r) for inline use: ◆. (2r + 3) art px square.
 * @param {number} [r]
 * @param {string[]} [ramp]
 * @param {{ outline?: boolean, open?: string, setting?: string[]|null }} [o]
 */
export function gemGlyph(r = 2, ramp = GEMS.gold(), o = {}) {
  const s = 2 * r + 3;
  return art(s, s, (p) => gem(p, r + 1, r + 1, r, ramp, o));
}

/**
 * A keycap (A's art in today's ivory): a notched ink outline, the face, a lit top line and a lip;
 * w × h art pixels; an arrow glyph painted in (`arrow`: 'kUp' | 'kDown' | 'kLeft' | 'kRight'), or a
 * DOM label laid over it. `dim`: a locked key.
 * @param {number} w
 * @param {number} [h]
 * @param {string|null} [arrow]
 * @param {boolean} [dim]
 */
export function keycapArt(w, h = 11, arrow = null, dim = false) {
  const k = pal();
  const face = dim ? k.dm2 : k.kf1, top = dim ? k.dm1 : k.kf0, lip = dim ? k.dm3 : k.kf2, shade = dim ? k.ink2 : k.kf3;
  return art(w, h, (p) => {
    p.rect(1, 0, w - 2, h, k.ink0); p.rect(0, 1, w, h - 2, k.ink0);
    p.rect(1, 1, w - 2, h - 3, face);
    p.hline(2, h - 2, w - 4, shade); p.px(1, h - 2, k.ink0); p.px(w - 2, h - 2, k.ink0);
    p.hline(2, h - 3, w - 4, lip);
    p.hline(2, 1, w - 4, top);
    if (arrow) p.rows(Math.floor((w - GLYPHS[arrow][0].length) / 2), 1, /** @type {string[]} */ (GLYPHS[arrow]), { o: k.kink });
  });
}

/** A 4 × 4 ordered-dither threshold (Bayer). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/**
 * An alpha ramp drawn as pixel art in colour `rgb` ("r, g, b"): `alpha(u, v)` (u, v in [0, 1]
 * across the canvas) is snapped to hard steps — `levels` is the step values themselves (0 is always
 * one) or a count of even steps — so a flat area is one exact level, and only the seam where the
 * ramp crosses the midpoint between two steps is ordered-dithered, about `seam` art px wide.
 * @param {number} w
 * @param {number} h
 * @param {string} rgb "r, g, b" (rgbOf)
 * @param {(u: number, v: number) => number} alpha
 * @param {readonly number[]|number} [levels]
 * @param {number} [seam]
 */
export function fade(w, h, rgb, alpha, levels = 6, seam = 3) {
  const [r, g, b] = rgb.split(',').map((v) => parseInt(v, 10));
  const L = (typeof levels === 'number' ? Array.from({ length: levels }, (_, i) => (i + 1) / levels) : [...levels]).sort((a1, a2) => a1 - a2);
  if (L[0] > 0) L.unshift(0);
  // the ramp sampled with a one-pixel border, for its slope
  const W = w + 2;
  const A = new Float32Array(W * (h + 2));
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) A[(y + 1) * W + x + 1] = Math.max(0, Math.min(1, alpha((x + 0.5) / w, (y + 0.5) / h)));
  const at = (x, y) => A[(y + 1) * W + x + 1];
  return art(w, h, (p) => {
    if (!w || !h) return;
    const img = p.ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = at(x, y);
        let q = L[L.length - 1];
        if (a < q) {
          let s = 0;
          while (a >= L[s + 1]) s++;
          const lo = L[s], hi = L[s + 1], t = (a - lo) / (hi - lo);
          const slope = Math.max(Math.abs(at(x + 1, y) - at(x - 1, y)), Math.abs(at(x, y + 1) - at(x, y - 1))) / 2 / (hi - lo);
          const half = (seam / 2) * slope;
          if (half < 1e-6) q = t >= 0.5 ? hi : lo;
          else if (t <= 0.5 - half) q = lo;
          else if (t >= 0.5 + half) q = hi;
          else q = (t - 0.5 + half) / (2 * half) > BAYER[(y % 4) * 4 + (x % 4)] ? hi : lo;
        }
        if (q < 0.001) continue;
        const i = (y * w + x) * 4;
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = Math.round(q * 255);
      }
    }
    p.ctx.putImageData(img, 0, 0);
  });
}

/**
 * The colour of a CSS hex as "r, g, b".
 * @param {string} hex
 */
export const rgbOf = (hex) => {
  const s = hex.replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/./g, (c) => c + c) : s, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

/**
 * Piecewise-linear stops [[t, v], …] → v(t).
 * @param {[number, number][]} stops
 * @returns {(t: number) => number}
 */
export const ramp = (stops) => (t) => {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [t1, v1] = stops[i], [t0, v0] = stops[i - 1];
    if (t <= t1) return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
  }
  return stops[stops.length - 1][1];
};

/** The full-screen veils painted so far by size (`veilCanvas`; the newest few kept). @type {Map<string, HTMLCanvasElement>} */
const VEILS = new Map();
/** How many veil sizes `veilCanvas` keeps (a resize paints a new one; the journal, the world map and the tactics panel share them). */
const VEILS_MAX = 3;

/**
 * The scene's dim veil behind a full-screen window (G's tactics screen: the journal, the world map,
 * the tactics panel): the dim colour at 0.6 in the middle growing to 0.88 toward the corners,
 * in four hard steps (dithered seams), w × h art px. Painted once per size and shared (the newest
 * `VEILS_MAX` sizes kept); every call returns a copy of its own.
 * @param {number} w
 * @param {number} h
 * @returns {HTMLCanvasElement}
 */
export function veilCanvas(w, h) {
  const W = Math.max(0, Math.round(w)), H = Math.max(0, Math.round(h));
  const id = `${W}x${H}`;
  let c = VEILS.get(id);
  if (c) VEILS.delete(id);
  else c = fade(W, H, rgbOf(pal().dim), (u, v) => 0.6 + 0.28 * Math.min(1, Math.hypot((u - 0.5) / 0.5, (v - 0.5) / 0.5) ** 1.6), [0.6, 0.7, 0.8, 0.88]);
  VEILS.set(id, c);
  while (VEILS.size > VEILS_MAX) VEILS.delete(VEILS.keys().next().value);
  const src = c;
  return art(W, H, (p) => { if (W && H) p.ctx.drawImage(src, 0, 0); });
}

/** The steps of today's dark bands and plates: flat at .82, then two steps out (narrow dithered seams). */
export const BAND_STEPS = Object.freeze([0.27, 0.55, 0.82]);

/**
 * Today's fading band (no frame, G's `band()`): dark navy fading out to the right in hard steps —
 * a0 at the left, a1 at `at`, 0 at the right end.
 * @param {number} w
 * @param {number} h
 * @param {number} [a0]
 * @param {number} [a1]
 * @param {number} [at]
 */
export const band = (w, h, a0 = 0.86, a1 = 0.72, at = 0.55) => fade(w, h, rgbOf(pal().band), ramp([[0, a0], [at, a1], [1, 0]]), [...BAND_STEPS]);

/**
 * A gold hairline one art pixel tall (today's 1 px gold rules), solid, then fading to dots like A's
 * rules toward the right end (`ends` 'r') or both ends ('both'); w art px.
 * @param {number} w
 * @param {'r'|'both'} [ends]
 * @param {string|null} [col] (g3)
 */
export function hairline(w, ends = 'r', col = null) {
  const k = pal();
  return art(w, 1, (p) => {
    for (let x = 0; x < w; x++) {
      const t = ends === 'both' ? Math.abs((x + 0.5) / w - 0.5) * 2 : (x + 0.5) / w;
      if (t > 0.72 && x % 2) continue;
      if (t > 0.88 && x % 4) continue;
      p.px(x, 0, col ?? k.g3);
    }
  });
}

/**
 * Today's picker plate (the title's menu, G's `plate()`): a navy band fading at both ends between
 * gold hairlines that fade too; w × h art px.
 * @param {number} w
 * @param {number} h
 */
export function plate(w, h) {
  const k = pal();
  const c = fade(w, h, rgbOf(k.band), (u, v) => (v * h < 1 || v * h > h - 1 ? 0 : ramp([[0, 0], [0.22, 0.82], [0.78, 0.82], [1, 0]])(u)), [...BAND_STEPS]);
  const ctx = c.getContext('2d');
  ctx.drawImage(hairline(w, 'both'), 0, 0);
  ctx.drawImage(hairline(w, 'both', k.g2), 0, h - 1);
  return c;
}

/**
 * The selection band (A's selBand with today's gold wash): one flat wash, checker-dithered only in
 * its last 14 px; hairlines top and bottom fading to dots in their last 36 px — gilt, or dim gilt
 * (`lines: 'dim'`, a quieter focus like today's rules row).
 * @param {number} w
 * @param {number} h
 * @param {{ lines?: 'gilt'|'dim', wash?: string|null }} [o]
 */
export function selBand(w, h, { lines = 'gilt', wash = null } = {}) {
  const k = pal();
  const [top, bot, topF, botF] = lines === 'dim' ? [k.dm1, k.dm2, k.dm2, k.dm3] : [k.g3, k.g2, k.g2, k.g1];
  return art(w, h, (p) => {
    for (let x = 0; x < w - 6; x++) {
      for (let y = 1; y < h - 1; y++) {
        if (x > w - 14 && (x + y) % 2) continue;
        p.px(x, y, wash ?? k.wash);
      }
    }
    for (let x = 3; x < w - 10; x++) {
      const f = x > w - 36;
      if (!f || x % 2) { p.px(x, 0, f ? topF : top); p.px(x, h - 1, f ? botF : bot); }
    }
  });
}

/** Today's speech bubble over a villager (24 × 18): cream with an ink outline, three dots, a tail. */
export function bubble() {
  const k = pal();
  const rows = [
    '..oooooooooooooooooooo..',
    '.oWWWWWWWWWWWWWWWWWWWWo.',
    'oWWFFFFFFFFFFFFFFFFFFFFo',
    'oWFFFFFFFFFFFFFFFFFFFFFo',
    'oWFFFFFFFFFFFFFFFFFFFFFo',
    'oWFFFFFFFFFFFFFFFFFFFFFo',
    'oWFFFFooFFFFooFFFFooFFFo',
    'oWFFFFooFFFFooFFFFooFFFo',
    'oWFFFFFFFFFFFFFFFFFFFFFo',
    'oWFFFFFFFFFFFFFFFFFFFFFo',
    'oFFFFFFFFFFFFFFFFFFFFFLo',
    'oLFFFFFFFFFFFFFFFFFFFLLo',
    '.oLLLLLLLLLLLLLLLLLLLLo.',
    '..ooooooooFFFFoooooooo..',
    '.........oFFLo..........',
    '..........oFLo..........',
    '...........oLo..........',
    '............o...........',
  ];
  return art(24, 18, (p) => p.rows(0, 0, rows, { o: k.ink0, W: k.kf0, F: k.kf1, L: k.kf2 }));
}

/**
 * The compass star of today's place plate and title crest, as gilded pixel art: four long points,
 * four short diagonal ones, an ink outline, a gem at the heart. (s + 2) × (s + 2) art pixels (s odd).
 * @param {number} [s]
 * @param {string[]} [heart] the heart gem (s ≥ 15)
 */
export function star(s = 11, heart = GEMS.sapphire()) {
  const k = pal();
  const c = (s - 1) / 2, R = c, w = Math.max(1.2, s / 9);
  const R2 = R * 0.62, w2 = Math.max(0.9, s / 13);
  const bits = new Uint8Array(s * s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = Math.abs(x - c), dy = Math.abs(y - c);
      const u = Math.abs((x - c) + (y - c)) / Math.SQRT2, v = Math.abs((x - c) - (y - c)) / Math.SQRT2;
      const long = dx / w + dy / R <= 1.0001 || dy / w + dx / R <= 1.0001;
      const diag = u / w2 + v / R2 <= 1.0001 || v / w2 + u / R2 <= 1.0001;
      if (long || diag) bits[y * s + x] = 1;
    }
  }
  return art(s + 2, s + 2, (p) => {
    stamp(p, gild(bits, s, s, 1, 1));
    if (s >= 15) gem(p, c + 1, c + 1, 2, heart);
    else p.px(c + 1, c + 1, k.sa2);
  });
}

/**
 * The clock's sun halo (d art px across): two opaque gilt rings, the outer one a checker edge.
 * @param {number} d
 */
export function halo(d) {
  const k = pal();
  const c = (d - 1) / 2;
  return art(d, d, (p) => {
    for (let y = 0; y < d; y++) {
      for (let x = 0; x < d; x++) {
        const r = Math.hypot(x - c, y - c);
        if (r > c - 0.5 && r <= c + 0.5) { if ((x + y) % 2 === 0) p.px(x, y, k.g1); }
        else if (r > c - 1.5 && r <= c - 0.5) p.px(x, y, k.g2);
      }
    }
  });
}

/**
 * Today's day bar ((w + 4) × 7): the sky's colours across the day in hard bands, a cream ◆ at
 * `frac` (0…1 of the day).
 * @param {number} w
 * @param {number} frac
 */
export function dayBar(w, frac) {
  const k = pal();
  const cols = [k.day0, k.day1, k.day2, k.day3, k.day4, k.day5, k.day6, k.day7];
  return art(w + 4, 7, (p) => {
    p.rect(1, 2, w + 2, 4, k.ink0);
    for (let x = 0; x < w; x++) { const c = cols[Math.min(cols.length - 1, Math.floor((x / w) * cols.length))]; p.px(2 + x, 3, c); p.px(2 + x, 4, c); }
    const mx = 2 + Math.round(frac * (w - 1));
    stamp(p, [[mx, 2, k.tx1], [mx - 1, 3, k.tx1], [mx, 3, k.g5], [mx + 1, 3, k.tx1], [mx - 1, 4, k.kf2], [mx, 4, k.tx1], [mx + 1, 4, k.kf2], [mx, 5, k.kf2], [mx, 1, k.tx1]]);
  });
}

/**
 * A small gold coin (9 × 9) like A's: an ink outline, a g4 face, a g2 inner ring, the rim lit top
 * left (g5) and shaded bottom right (g1), a struck mark in g2.
 */
export function coin() {
  const k = pal();
  const rows = [
    '..ooooo..',
    '.oWWLLGo.',
    'oWLDDDLGo',
    'oWDLLLDGo',
    'oLDLDLDBo',
    'oLDLLLDBo',
    'oGLDDDGBo',
    '.oGGBBBo.',
    '..ooooo..',
  ];
  return art(9, 9, (p) => p.rows(0, 0, rows, { o: k.ink0, W: k.g5, L: k.g4, G: k.g3, D: k.g2, B: k.g1 }));
}

/**
 * A's divider with today's composition: a 2 px gold rule fading to dots at both ends, pearls, two
 * scroll curls and small sapphires, the centre gem; w × 13 art pixels (w odd).
 * @param {number} w
 * @param {string[]} [ramp] the gems
 */
export function divider(w, ramp = GEMS.sapphire()) {
  const k = pal();
  const h = 13, cx = Math.floor(w / 2), cy = 6;
  return art(w, h, (p) => {
    for (let x = 1; x < w - 1; x++) {
      const d = Math.abs(x - cx) / (w / 2);
      if (Math.abs(x - cx) < 8) continue;
      if (d > 0.7 && (x - cx) % 2) continue;
      if (d > 0.86 && (x - cx) % 4) continue;
      p.px(x, cy - 1, k.ink0); p.px(x, cy + 2, k.ink0);
      p.px(x, cy, d < 0.5 ? k.g4 : k.g3); p.px(x, cy + 1, d < 0.5 ? k.g2 : k.g1);
    }
    // today's scroll curls either side of the centre gem
    const curl = ['.LGG.', 'L...D', 'G.G.D', 'G..D.', '.DD..'];
    for (const s of [1, -1]) {
      /** @type {[number, number, string][]} */
      const pts = [];
      curl.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') pts.push([cx + s * (8 + i), cy - 2 + j, { L: k.g4, G: k.g3, D: k.g2 }[row[i]]]); });
      stamp(p, pts);
      for (const dx of [18, 22]) stamp(p, [[cx + s * dx, cy, k.tx1], [cx + s * dx, cy + 1, k.tx3]]);
      gem(p, cx + s * Math.round(w * 0.32), cy, 1, ramp, { setting: [k.g5, k.g4, k.g3] });
    }
    gem(p, cx, cy, 4, ramp);
  });
}
