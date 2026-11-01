/**
 * The pixel UI's combat-only art (docs/specs/PIXEL_UI.md §2), ported from mockup G's art: the boss
 * bar and the lock-on brackets, and the pieces the combat HUD keeps live (CombatHUD, BossBar,
 * DeathScreen): the boss bar in layers (its fill and chip band are DOM `scaleX` layers over the
 * painted rims), the skill slots' cooldown veil, the locked slot's level plate, the loot feed's
 * small icons and the death screen's ember vignette. Listed in COMBAT_PURE
 * (vite.config.js): only the combat chunk imports it, a peaceful level never loads it.
 */
import { pal, GEMS } from './palette.js';
import { gem, stamp } from './gilt.js';
import { art } from './painter.js';
import { coin, fade, rgbOf } from './pieces.js';

/** @import { PixelPainter } from './painter.js' */

/**
 * The boss bar's fill, chip and trough colours per row, top to bottom.
 * @returns {[string, string, string][]} [fill, chip, trough]
 */
const bossRows = () => {
  const k = pal();
  return [[k.bs4, k.g5, k.tr0], [k.bs3, k.g5, k.tr1], [k.bs2, k.g4, k.tr1], [k.bs1, k.g3, k.tr1], [k.bs0, k.g2, k.tr1]];
};

/**
 * The boss bar painted into `p`, A's drawn at today's height: w × 11 art pixels. A gold-set ruby
 * at each end, the body between today's double gold rule (lit gilt, ink, the fill, ink, shaded
 * gilt), a 5-row banded fill, the pale chip band, ticks at the phases.
 * @param {PixelPainter} p
 * @param {number} w
 * @param {number} v the health, 0…1
 * @param {number} chip the trailing chip band's end, 0…1 (≥ v)
 * @param {number} [phases]
 */
export function bossBar(p, w, v, chip, phases = 3) {
  const k = pal();
  const H = 11, x0 = 9, x1 = w - 10, cy = 5;
  p.rect(x0 - 1, 0, x1 - x0 + 3, H, k.ink0);
  p.hline(x0, 1, x1 - x0 + 1, k.g4);
  p.hline(x0, H - 2, x1 - x0 + 1, k.g2);
  const iw = x1 - x0 + 1;
  const fw = Math.round(iw * v), cw = Math.round(iw * chip);
  bossRows().forEach(([f, c, t], j) => {
    const y = 3 + j;
    p.hline(x0, y, iw, t);
    if (cw > fw) p.hline(x0 + fw, y, cw - fw, c);
    p.hline(x0, y, fw, f);
  });
  if (fw > 1) p.vline(x0 + fw - 1, 3, 5, k.bs4);
  bossTicks(p, w, phases);
  gem(p, 4, cy, 4, GEMS.ruby(), { open: 'r' });
  gem(p, w - 5, cy, 4, GEMS.ruby(), { open: 'l' });
}

/**
 * The phase ticks of a w-wide boss bar (ink through the fill, a lit pixel on each rule).
 * @param {PixelPainter} p
 * @param {number} w
 * @param {number} phases
 */
function bossTicks(p, w, phases) {
  const k = pal();
  const H = 11, x0 = 9, iw = w - 18;
  for (let i = 1; i < phases; i++) {
    const tx = x0 + Math.round(iw * i / phases);
    p.vline(tx, 3, 5, k.ink0);
    p.px(tx, 1, k.g5); p.px(tx, H - 2, k.g4);
  }
}

/**
 * The boss bar in layers, for a live bar whose fill and chip band move as DOM `scaleX` layers
 * (BossBar): `base` (w × 11: the rims, the trough, the end rubies), `chip` and `fill` (iw × 5, the
 * full bands, laid at (9, 3)), `cap` (1 × 5: the fill's lit last column), `hit` (iw × 5: a hit's
 * pale flash) and `ticks` (w × 11: the phase ticks over everything). `bossBar(p, w, v, chip)` is the
 * same picture in one canvas.
 * @param {number} w
 * @param {number} [phases]
 * @returns {{ base: HTMLCanvasElement, chip: HTMLCanvasElement, fill: HTMLCanvasElement, cap: HTMLCanvasElement,
 *   hit: HTMLCanvasElement, ticks: HTMLCanvasElement, iw: number }}
 */
export function bossBarLayers(w, phases = 3) {
  const k = pal();
  const H = 11, x0 = 9, x1 = w - 10, iw = x1 - x0 + 1;
  const rows = bossRows();
  const base = art(w, H, (p) => {
    p.rect(x0 - 1, 0, x1 - x0 + 3, H, k.ink0);
    p.hline(x0, 1, iw, k.g4);
    p.hline(x0, H - 2, iw, k.g2);
    rows.forEach(([, , t], j) => p.hline(x0, 3 + j, iw, t));
    gem(p, 4, 5, 4, GEMS.ruby(), { open: 'r' });
    gem(p, w - 5, 5, 4, GEMS.ruby(), { open: 'l' });
  });
  const band = (j) => art(iw, 5, (p) => rows.forEach((r, y) => p.hline(0, y, iw, r[j])));
  return {
    base,
    fill: band(0),
    chip: band(1),
    cap: art(1, 5, (p) => p.vline(0, 0, 5, k.bs4)),
    hit: art(iw, 5, (p) => { p.rect(0, 0, iw, 5, k.hit); p.hline(0, 4, iw, k.g5); }),
    ticks: art(w, H, (p) => bossTicks(p, w, phases)),
    iw,
  };
}

/**
 * One lock-on bracket (A's reticle cut in four): an L of gilt two pixels thick, (L + 3) art px
 * square; (sx, sy) its direction (1 or -1 each: [1, 1] the top-left corner). The ruby heart is its
 * own canvas (`gemGlyph(2, GEMS.ruby())`).
 * @param {number} sx
 * @param {number} sy
 * @param {number} [L] the arms' length
 */
export function bracket(sx, sy, L = 11) {
  const k = pal();
  const S = L + 3;
  return art(S, S, (p) => {
    const ox = sx > 0 ? 2 : S - 3, oy = sy > 0 ? 2 : S - 3;
    /** @type {[number, number, string][]} */
    const pts = [];
    for (let i = 0; i < L; i++) {
      pts.push([ox + sx * i, oy, i < 4 ? k.g5 : k.g4]);
      pts.push([ox, oy + sy * i, i < 4 ? k.g5 : k.g4]);
      if (i > 0) { pts.push([ox + sx * i, oy + sy, k.g2]); pts.push([ox + sx, oy + sy * i, k.g2]); }
    }
    stamp(p, pts);
  });
}

// ---------------------------------------------------------------------------------------------
// The skill slots
// ---------------------------------------------------------------------------------------------

/**
 * The cooldown veil of a skill slot (G's `skillSlot`): s × s art px of dark ink whose top row is
 * lit gold every other pixel. The HUD slides it down inside the 16 × 16 glass (`translateY`), so
 * the lit edge is always the veil's top.
 * @param {number} [s]
 */
export function veil(s = 16) {
  const k = pal();
  return art(s, s, (p) => {
    p.rect(0, 0, s, s, k.veil);
    for (let i = 0; i < s; i += 2) p.px(i, 0, k.g4);
  });
}

/**
 * A slot's "ready again" flash: the 16 × 16 glass washed pale gold, a lit rim (it fades in hard
 * steps, combat.css).
 * @param {number} [s]
 */
export function readyFlash(s = 16) {
  const k = pal();
  return art(s, s, (p) => {
    p.dither(0, 0, s, s, k.g5, k.g4, 'check');
    p.box(0, 0, s, s, k.sel);
  });
}

/**
 * The plate a locked skill slot carries on its top rim (G's `skillSlot`): bw × 10 art px, an ink
 * outline with clipped corners, plate1, a dim lit line; "Lv" and the level are DOM text over it.
 * @param {number} bw
 */
export function lockPlate(bw) {
  const k = pal();
  return art(bw, 10, (p) => { p.rect(1, 0, bw - 2, 10, k.ink0); p.rect(0, 1, bw, 8, k.ink0); p.rect(1, 1, bw - 2, 8, k.plate1); p.hline(2, 1, bw - 4, k.dm1); });
}

// ---------------------------------------------------------------------------------------------
// The loot feed's icons (9 × 9, the purse's coin in the same hand)
// ---------------------------------------------------------------------------------------------

/** 9 × 9 palette rows per loot kind: o ink, then each kind's dark → light (a b c), w a highlight. */
const LOOT_ROWS = Object.freeze({
  heart: ['.oo...oo.', 'obbo.obco', 'obbbobbco', 'obbbbbbbo', 'oabbbbbbo', '.oabbbbo.', '..oabbo..', '...oao...', '....o....'],
  mana: ['....o....', '...oco...', '..obcwo..', '.obbccbo.', 'oabbcbbbo', '.oabbbbo.', '..oabbo..', '...oao...', '....o....'],
  draught: ['...ooo...', '...owo...', '...oco...', '..obcbo..', '.obbcbbo.', 'oaabbbbbo', 'oaaaabbbo', '.oaaaabo.', '..ooooo..'],
  upgrade: ['....o....', '...owo...', '..owcwo..', '.oocbcoo.', '...ocbo..', '...ocbo..', '...obao..', '...oaao..', '...oooo..'],
  core: ['....o....', '...oco...', '..obwco..', '.obcwcbo.', 'oabcwcbao', '.oabcbao.', '..oabao..', '...oao...', '....o....'],
});

/** The ramps per kind [a dark, b mid, c light, w highlight]. */
const lootRamp = (kind) => {
  const k = pal();
  return ({
    heart: [k.hp0, k.hp2, k.hp3, k.tx1],
    mana: [k.mp0, k.mp1, k.mp3, k.tx1],
    draught: [k.ink3, k['m-g'], k.heal, k.tx1],
    upgrade: [k.g1, k.g3, k.g4, k.g5],
    core: [k.em1, k.em2, k.em3, k.tx1],
  })[kind];
};

/** The loot kinds the feed knows. */
export const LOOT_KINDS = Object.freeze(['gold', 'heart', 'mana', 'draught', 'upgrade', 'core']);

/** @type {Map<string, HTMLCanvasElement>} */
const lootCache = new Map();
/**
 * A loot kind's 9 × 9 icon (gold: the purse's coin): a shared canvas — draw it, do not put it.
 * @param {string} kind
 * @returns {HTMLCanvasElement}
 */
export function lootIcon(kind) {
  const id = LOOT_KINDS.includes(kind) ? kind : 'gold';
  let c = lootCache.get(id);
  if (!c) {
    if (id === 'gold') c = coin();
    else {
      const [a, b, cc, w] = lootRamp(id);
      c = art(9, 9, (p) => p.rows(0, 0, [...LOOT_ROWS[id]], { o: pal().ink0, a, b, c: cc, w }));
    }
    lootCache.set(id, c);
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// The death screen
// ---------------------------------------------------------------------------------------------

/**
 * The death screen's ember vignette: w × h pixels (DeathScreen shows one per 2 × 2 art px) of a
 * dark ember wash, thin in the middle (where the title stands) and near opaque at the edges, in
 * fine hard steps with dithered seams (`fade`), a warmer core behind the title.
 * @param {number} w
 * @param {number} h
 * @returns {HTMLCanvasElement}
 */
export function emberVignette(w, h) {
  const shade = fade(w, h, rgbOf('#0a0204'), (u, v) => {
    const r = Math.hypot((u - 0.5) / 0.62, (v - 0.46) / 0.6);
    return Math.min(0.95, 0.46 + 0.49 * Math.max(0, Math.min(1, (r - 0.2) / 0.8)) ** 1.2);
  }, [0.46, 0.52, 0.58, 0.64, 0.7, 0.76, 0.82, 0.88, 0.95], 4);
  const ember = fade(w, h, rgbOf('#3a0a0c'), (u, v) => {
    const r = Math.hypot((u - 0.5) / 0.36, (v - 0.42) / 0.22);
    return Math.max(0, 1 - r) * 0.55;
  }, [0.2, 0.38, 0.55], 3);
  const ctx = shade.getContext('2d');
  ctx.drawImage(ember, 0, 0);
  return shade;
}
