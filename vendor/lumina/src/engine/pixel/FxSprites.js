/**
 * FxSprites.js — the combat FX atlas (COMBAT.md §10.4): slash arcs, hit stars, dust, projectiles,
 * pickups, stun stars, the level-up pillar and the boss ember wall, packed into one 1024 × 1024
 * NEAREST / sRGB / clamp-to-edge texture that `FxQuads` draws (instance colours tint the white /
 * near-white cores; alpha is binary 0 / 255; a 1 px transparent gutter surrounds every frame).
 *
 * The atlas has two parts. The base frames (`BASE_FX_FRAMES`, below) fill its top-left 512 × 512
 * exactly as the 512 × 512 atlas of COMBAT.md §10.4 did — the same layout, byte for byte. The rest
 * of the atlas holds the frames of Vanquish the Evil Dragon's packages
 * (docs/contracts/DRAGON_CAMPAIGN.md §4, §8), one module per package under ./fx/ (heroFx, partyFx,
 * dragonFx, bruteFx, swarmFx), each exporting
 *   `FRAMES`: { [name]: { w, h, n, fps } } — its frames (names unique across the atlas: prefix them),
 *   `paint(name, pen, i, kit)`: paints frame `i` of `name` with the frame pen (`set(x, y, v)` a grey
 *     level 0–255 at 255 alpha, `get`, `lum`, `max`, `rim(v)`, `w`, `h`; clipped to the frame) and
 *     the kit (`FX_KIT`: the grey levels W L MID D S R, `arc`, `stamp`).
 * They are packed (tallest first, then by name) into the right half of the top 512 rows, then the
 * bottom 512 rows; `createFxAtlas` throws when they do not fit. The layout holds still as packages
 * change: frames added to a layout in use say which batch they came in, `late: <generation>`
 * (`true` = 1, the first batch; the next batch says 2, and so on): a generation packs after every
 * frame of a lower one, so no frame moves — an FxQuads dither fade is phased in atlas texels. A
 * retired frame leaves its cells empty under its old name, with its old `late`, in the module's
 * optional `RESERVED` ({ [name]: { w, h, n, late? } }: packed, never painted, no frame of the atlas).
 * A lazy enemy pack (src/game/combat/packs/, The Bells of Evermere's) adds its modules at load with
 * `registerFxModule`, before the combat builds the atlas: generation 3 and later only.
 *
 * `createFxAtlas()` →`{ texture, canvas, frames }`, `frames[name] = { w, h, n, fps, rects }` with
 * one `[u0, v0, u1, v1]` rect per animation frame (texture UVs with three's default flipY:
 * v0 = bottom edge, v1 = top edge of the frame).
 *
 * Art: every frame is painted in grey levels (white-hot cores, light / mid / dark greys for form)
 * so the instance colour of FxQuads tints it; pickups and the boulder carry a dark rim so they read
 * over any ground. Directional frames point along +U (texture right) — `arrow`, `thrust` — or bulge
 * toward +V (texture top: the flat quad's forward axis) — `slash`, `slashBig`, which sweep from
 * the right to the left over their frames (play them reversed for a back-hand). The `spin` ring's
 * bright head circles once over its four frames. RNG-free (closed-form shapes, fixed layouts).
 */
import { PixelCanvas, makePixelTexture } from './PixelCanvas.js';
import * as heroFx from './fx/heroFx.js';
import * as partyFx from './fx/partyFx.js';
import * as dragonFx from './fx/dragonFx.js';
import * as bruteFx from './fx/bruteFx.js';
import * as swarmFx from './fx/swarmFx.js';

/** @import * as THREE from 'three' */

/**
 * An atlas frame: size in px, the number of animation frames and their rate (0 = still).
 * `late`: the batch a frame added to a layout in use came in (`true` = 1, then 2, 3 …): packed after
 * every frame of a lower generation (none of them moves; frames without it are generation 0).
 * @typedef {{ w: number, h: number, n: number, fps: number, late?: boolean | number }} FxFrameSpec
 */
/**
 * The pen a frame painter gets (`framePen`): clipped to its frame.
 * @typedef {ReturnType<typeof framePen>} FxPen
 */
/** @typedef {typeof FX_KIT} FxKit */
/**
 * A package's FX module (./fx/*.js): its frames and their painter.
 * `RESERVED`: its retired frames' cells, kept empty (no other frame moves).
 * @typedef {{ FRAMES: Readonly<Record<string, FxFrameSpec>>,
 *   paint: (name: string, pen: FxPen, i: number, kit: FxKit) => void,
 *   RESERVED?: Readonly<Record<string, { w: number, h: number, n: number, late?: boolean | number }>> }} FxModule
 */

/** Frame name → { w, h (px), n (frames), fps (0 = still) } of the base atlas (COMBAT.md §10.4). */
export const BASE_FX_FRAMES = Object.freeze({
  slash: Object.freeze({ w: 48, h: 24, n: 4, fps: 30 }),
  slashBig: Object.freeze({ w: 64, h: 32, n: 4, fps: 30 }),
  spin: Object.freeze({ w: 64, h: 64, n: 4, fps: 30 }),
  thrust: Object.freeze({ w: 48, h: 12, n: 3, fps: 30 }),
  impact: Object.freeze({ w: 16, h: 16, n: 4, fps: 30 }),
  crit: Object.freeze({ w: 24, h: 24, n: 4, fps: 30 }),
  dust: Object.freeze({ w: 16, h: 16, n: 3, fps: 20 }),
  arrow: Object.freeze({ w: 16, h: 4, n: 1, fps: 0 }),
  emberBolt: Object.freeze({ w: 16, h: 16, n: 2, fps: 12 }),
  boulder: Object.freeze({ w: 16, h: 16, n: 2, fps: 8 }),
  coin: Object.freeze({ w: 8, h: 8, n: 4, fps: 12 }),
  heart: Object.freeze({ w: 10, h: 10, n: 2, fps: 4 }),
  mana: Object.freeze({ w: 10, h: 10, n: 2, fps: 4 }),
  draught: Object.freeze({ w: 10, h: 12, n: 1, fps: 0 }),
  upgrade: Object.freeze({ w: 12, h: 12, n: 2, fps: 4 }),
  core: Object.freeze({ w: 14, h: 14, n: 2, fps: 4 }),
  stun: Object.freeze({ w: 16, h: 8, n: 4, fps: 10 }),
  pillar: Object.freeze({ w: 24, h: 64, n: 4, fps: 12 }),
  wallFlame: Object.freeze({ w: 16, h: 24, n: 4, fps: 10 }),
});

/** The packages' FX modules (DRAGON_CAMPAIGN.md §4), in packing order. @type {readonly FxModule[]} */
const FX_MODULES = Object.freeze([heroFx, partyFx, dragonFx, bruteFx, swarmFx]);

/** Extension frame name → its module. @type {Map<string, FxModule>} */
const MODULE_OF = new Map();
/** Retired frames' cells (the modules' `RESERVED`): name → size, packed but never painted. @type {Map<string, FxFrameSpec>} */
const RESERVED = new Map();
for (const mod of FX_MODULES) {
  for (const name of Object.keys(mod.FRAMES)) {
    if (Object.hasOwn(BASE_FX_FRAMES, name) || MODULE_OF.has(name)) throw new Error(`FxSprites: the FX frame "${name}" is defined twice`);
    MODULE_OF.set(name, mod);
  }
}
for (const mod of FX_MODULES) {
  for (const [name, r] of Object.entries(mod.RESERVED ?? {})) {
    if (Object.hasOwn(BASE_FX_FRAMES, name) || MODULE_OF.has(name) || RESERVED.has(name)) throw new Error(`FxSprites: the reserved FX cells "${name}" collide with a frame`);
    RESERVED.set(name, Object.freeze({ w: r.w, h: r.h, n: r.n, fps: 0, late: r.late }));
  }
}

/**
 * Every atlas frame: the base frames, then the packages' (DRAGON_CAMPAIGN.md §8), then a lazy enemy
 * pack's once it registered its module (`registerFxModule`).
 * @type {Record<string, FxFrameSpec>}
 */
export const FX_FRAMES = {
  ...BASE_FX_FRAMES,
  ...Object.fromEntries([...MODULE_OF].map(([n, mod]) => [n, Object.freeze({ ...mod.FRAMES[n] })])),
};

/**
 * The first generation a module registered at run time may use: every frame shipped in the modules
 * above is of a lower one (≤ 2), so a pack's frames pack after all of them and none of them moves.
 */
const PACK_LATE = 3;

/**
 * Add a lazy enemy pack's FX module (src/game/combat/packs/: registered at load, before the combat
 * builds its atlas; docs/contracts/EVERMERE_CAMPAIGN.md §6.4). Its frames and reserved cells must
 * say `late` ≥ 3 (The Bells of Evermere's batch is generation 3): they pack after every frame of
 * the modules above, so the base region and every shipped generation stay byte for byte. A name
 * already in the atlas, or a frame of a lower generation, throws.
 * @param {FxModule} mod
 */
export function registerFxModule(mod) {
  const names = [...Object.keys(mod.FRAMES), ...Object.keys(mod.RESERVED ?? {})];
  for (const name of names) {
    if (Object.hasOwn(BASE_FX_FRAMES, name) || MODULE_OF.has(name) || RESERVED.has(name) || names.indexOf(name) !== names.lastIndexOf(name)) throw new Error(`FxSprites: the FX frame "${name}" is defined twice`);
    const spec = Object.hasOwn(mod.FRAMES, name) ? mod.FRAMES[name] : mod.RESERVED[name];
    if (!(+(spec.late ?? 0) >= PACK_LATE)) throw new Error(`FxSprites: the pack's FX frame "${name}" must say late ≥ ${PACK_LATE}`);
  }
  for (const name of Object.keys(mod.FRAMES)) {
    MODULE_OF.set(name, mod);
    FX_FRAMES[name] = Object.freeze({ ...mod.FRAMES[name] });
  }
  for (const [name, r] of Object.entries(mod.RESERVED ?? {})) RESERVED.set(name, Object.freeze({ w: r.w, h: r.h, n: r.n, fps: 0, late: r.late }));
}

// ---------------------------------------------------------------------------
// Frame painters (grey levels: instance colours tint them; alpha binary)
// ---------------------------------------------------------------------------

const W = 255, L = 228, MID = 196, D = 158, S = 112, R = 76;

/** Paint helpers bound to one frame's top-left corner, clipped to the frame. */
function framePen(pc, x0, y0, w, h) {
  const set = (x, y, v) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    pc.set(x0 + x, y0 + y, [v, v, v, 255]);
  };
  const get = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : pc.getAlpha(x0 + x, y0 + y));
  const lum = (x, y) => (get(x, y) ? pc.get(x0 + x, y0 + y)[0] : 0);
  /** Keep the brighter of the existing and the new value. */
  const max = (x, y, v) => { if (lum(Math.round(x), Math.round(y)) < v) set(x, y, v); };
  /** Dark rim around everything painted so far (pickups read against any ground). */
  const rim = (v = R) => {
    const pts = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (get(x, y)) continue;
      if (get(x - 1, y) || get(x + 1, y) || get(x, y - 1) || get(x, y + 1)) pts.push([x, y]);
    }
    for (const [x, y] of pts) set(x, y, v);
  };
  return { set, get, lum, max, rim, w, h };
}

/**
 * Crescent arc (slash / slashBig): the band between two ellipses bulging toward the frame top (the
 * flat quad's forward axis), revealed between angles a0..a1 (0 = texture right, π/2 = top), the
 * leading edge brightest, thinning into a dim tail.
 */
function arc(pen, { cx, cy, rx, ry, thick, a0, a1, lead }) {
  const { w, h } = pen;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (cy - (y + 0.5)) / ry;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (a < a0 || a > a1 || dy < -0.05) continue;
      // band thickness tapers toward the tail end (away from `lead`)
      const u = (a - a0) / Math.max(1e-6, a1 - a0);
      const toLead = lead === 'right' ? 1 - u : u;
      const t = thick * (0.35 + 0.65 * (1 - toLead));
      if (r > 1 || r < 1 - t) continue;
      const edge = r > 1 - t * 0.35;
      pen.set(x, y, edge ? (toLead < 0.3 ? W : L) : toLead < 0.5 ? MID : D);
    }
  }
}

const PAINT = {
  slash(pen, i) {
    // sweep: right segment → right+centre → full arc with a thin left tail → left wisps
    const P = [
      { a0: 0.15, a1: 1.2, lead: 'left', thick: 0.28 },
      { a0: 0.1, a1: 2.2, lead: 'left', thick: 0.34 },
      { a0: 0.35, a1: 3.0, lead: 'left', thick: 0.3 },
      { a0: 1.7, a1: 3.05, lead: 'left', thick: 0.18 },
    ][i];
    arc(pen, { cx: 24, cy: 22.5, rx: 22.5, ry: 21, ...P });
    if (i === 3) for (let x = 3; x < 20; x += 3) pen.set(x, 20 - (x % 2), D); // breaking up
  },
  slashBig(pen, i) {
    const P = [
      { a0: 0.12, a1: 1.3, lead: 'left', thick: 0.3 },
      { a0: 0.08, a1: 2.4, lead: 'left', thick: 0.38 },
      { a0: 0.3, a1: 3.05, lead: 'left', thick: 0.34 },
      { a0: 1.6, a1: 3.08, lead: 'left', thick: 0.2 },
    ][i];
    arc(pen, { cx: 32, cy: 30.5, rx: 31, ry: 29, ...P });
    if (i >= 2) for (let k = 0; k < 6; k++) pen.set(6 + k * 9, 4 + ((k * 7) % 5) + (i === 3 ? 6 : 0), W); // sparks off the edge
  },
  spin(pen, i) {
    // whirl ring: a full ring with a bright head sweeping around it and a fading trail
    const { w } = pen, c = w / 2;
    const head = (i / 4) * Math.PI * 2;
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      if (r > 30.5 || r < 24.5) continue;
      let d = (head - Math.atan2(-dy, dx)) % (Math.PI * 2);
      if (d < 0) d += Math.PI * 2;
      if (d > 4.6) continue; // gap ahead of the head
      const outer = r > 28.5;
      const v = d < 0.6 ? (outer ? W : L) : d < 2 ? (outer ? L : MID) : d < 3.4 ? MID : D;
      if (d > 3.4 && ((x + y) & 1)) continue; // tail breaks up
      pen.set(x, y, v);
    }
  },
  thrust(pen, i) {
    // lance streak along +U (texture right = forward): a bright spear core, tapering tail
    const len = [26, 44, 40][i], x0 = [20, 3, 7][i];
    for (let x = 0; x < len; x++) {
      const t = x / len; // 0 tail … 1 tip
      const half = Math.max(0, (t < 0.85 ? 1 + Math.round(3 * t) : Math.round(4 * (1 - t) / 0.15)) - (i === 2 ? 1 : 0));
      if (i === 2 && t < 0.35 && x % 4 === 1) continue; // the spent tail breaks up
      for (let dy = -half; dy <= half; dy++) {
        const core = Math.abs(dy) <= Math.max(0, half - 2);
        pen.set(x0 + x, 6 + dy, core ? W : Math.abs(dy) === half ? D : L);
      }
    }
  },
  impact(pen, i) {
    const c = 7.5;
    const len = [3, 6, 7, 7][i];
    // four-point star with diagonal glints; a ring on frame 2, sparks on frame 3
    if (i < 3) {
      for (let k = -len; k <= len; k++) {
        const v = Math.abs(k) < 2 ? W : Math.abs(k) < len - 1 ? L : MID;
        pen.set(c + k, c, v); pen.set(c, c + k, v);
      }
      if (i >= 1) for (let k = -Math.floor(len / 2); k <= Math.floor(len / 2); k++) { pen.max(c + k, c + k, MID); pen.max(c + k, c - k, MID); }
      if (i === 0) for (const [x, y] of [[c - 1, c - 1], [c + 1, c - 1], [c - 1, c + 1], [c + 1, c + 1]]) pen.set(x, y, W);
    }
    if (i === 2) for (let a = 0; a < 16; a++) { const t = (a / 16) * Math.PI * 2; pen.max(c + Math.cos(t) * 6.5, c + Math.sin(t) * 6.5, D); }
    if (i === 3) for (const [x, y] of [[1, 3], [13, 2], [2, 12], [14, 13], [7, 0], [8, 15], [0, 8], [15, 7]]) pen.set(x, y, L);
  },
  crit(pen, i) {
    const c = 11.5;
    const len = [4, 10, 11, 9][i];
    for (let a = 0; a < 8; a++) {
      const t = (a / 8) * Math.PI * 2;
      const l = a % 2 ? len * 0.62 : len;
      for (let k = 0; k <= l; k += 0.5) {
        const v = k < 2.5 ? W : k < l - 2 ? L : MID;
        if (i === 3 && k > 3 && Math.floor(k) % 2) continue;
        pen.max(c + Math.cos(t) * k, c + Math.sin(t) * k, v);
      }
    }
    for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= (i === 0 ? 2 : 5)) pen.set(c + x, c + y, W);
    if (i >= 2) for (let a = 0; a < 20; a++) { const t = (a / 20) * Math.PI * 2 + 0.1; pen.max(c + Math.cos(t) * (i === 2 ? 8 : 10), c + Math.sin(t) * (i === 2 ? 8 : 10), D); }
  },
  dust(pen, i) {
    // puff: overlapping round lumps, lit from the upper left, dissolving on the last frame
    const lumps = [
      [[8, 10, 3.2], [5.5, 11, 2.2], [10.5, 11, 2.2]],
      [[8, 9, 4.2], [4.5, 10.5, 3], [11.5, 10.5, 3], [8, 6, 2.6]],
      [[8, 8, 4.8], [3.5, 10, 3.2], [12.5, 10, 3.2], [7, 4.5, 3]],
    ][i];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let best = null;
      for (const [cx, cy, r] of lumps) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) { const l = (-dx - dy) / r; best = best === null ? l : Math.max(best, l); }
      }
      if (best === null) continue;
      if (i === 2 && ((x * 3 + y * 5) % 4 === 0)) continue;
      pen.set(x, y, best > 0.7 ? W : best > -0.1 ? L : best > -0.8 ? MID : D);
    }
  },
  arrow(pen) {
    // pointing +U (texture right = flight direction): fletching, shaft, bright head
    for (let x = 3; x <= 12; x++) pen.set(x, 1, x < 5 ? L : MID), pen.set(x, 2, x < 5 ? MID : D);
    pen.set(0, 0, L); pen.set(1, 0, L); pen.set(2, 1, L); pen.set(0, 3, MID); pen.set(1, 3, MID); pen.set(2, 2, MID); // fletching
    pen.set(13, 0, L); pen.set(13, 1, W); pen.set(14, 1, W); pen.set(15, 1, W); pen.set(13, 2, W); pen.set(14, 2, L); pen.set(13, 3, MID); // head
  },
  emberBolt(pen, i) {
    // fireball: round white-hot core, flame tongues licking back (frames flicker)
    const cx = 9.5, cy = 8;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      const flick = i ? Math.sin((y + 1) * 1.7) : Math.sin(y * 1.3 + 1);
      const tail = dx < 0 ? Math.max(0, -dx) * 0.55 : 0;
      const edge = 4.2 + tail * 0.9 + flick * 0.9 * (dx < 0 ? 1 : 0.3);
      if (r > edge || (dx < 0 && Math.abs(dy) > 5 - tail * 0.45)) continue;
      pen.set(x, y, r < 2.2 ? W : r < 3.6 ? L : r < edge - 1 ? MID : D);
    }
  },
  boulder(pen, i) {
    // rough rock, lit from the upper left; the second frame is turned (crack moves)
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8;
      const a = Math.atan2(dy, dx) + i * 0.8;
      const rr = 6.2 + Math.sin(a * 3) * 0.7 + Math.cos(a * 5) * 0.4;
      const r = Math.hypot(dx, dy);
      if (r > rr) continue;
      const l = (-dx - dy) / rr;
      pen.set(x, y, l > 0.55 ? W : l > 0 ? L : l > -0.55 ? MID : D);
    }
    const k = i ? [[5, 9], [6, 8], [7, 8], [8, 7], [9, 6]] : [[9, 4], [8, 5], [8, 6], [7, 7], [6, 9]];
    for (const [x, y] of k) pen.set(x, y, S);
    pen.rim(S);
  },
  coin(pen, i) {
    // spinning coin: face, three-quarter, edge, three-quarter
    const half = [2.9, 2, 0.8, 2][i];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const dx = (x + 0.5 - 4) / half, dy = (y + 0.5 - 4) / 3.4;
      if (dx * dx + dy * dy > 1) continue;
      const rimP = dx * dx + dy * dy > 0.5;
      pen.set(x, y, i === 2 ? (y < 4 ? L : MID) : rimP ? (dx + dy < 0 ? L : D) : (dx - dy < 0 ? W : MID));
    }
    if (i === 0) pen.set(3, 3, W);
    pen.rim(R);
  },
  heart(pen, i) {
    const rows = i
      ? ['..........', '.WW...WW..', 'WLLW.WLLW.', 'WLLLWLLMM.', 'LLLLLLLMD.', '.LLLLLMD..', '..LLLMD...', '...LMD....', '....D.....', '..........']
      : ['..........', '..........', '.WW..WW...', 'WLLWWLMM..', 'LLLLLLMD..', '.LLLLMD...', '..LLMD....', '...MD.....', '..........', '..........'];
    stamp(pen, rows);
    pen.rim(R);
  },
  mana(pen, i) {
    // four-pointed mote: a bright diamond with a halo cross; frame 2 flares
    const c = 4.5, r = i ? 4 : 3;
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const d = Math.abs(x + 0.5 - (c + 0.5)) + Math.abs(y + 0.5 - (c + 0.5));
      if (d > r) continue;
      pen.set(x, y, d < 1.2 ? W : d < r - 1 ? L : MID);
    }
    if (i) { pen.set(c, 0, L); pen.set(c, 9, MID); pen.set(0, c, L); pen.set(9, c, MID); }
    pen.rim(R);
  },
  draught(pen) {
    stamp(pen, [
      '...DD.....', '...LM.....', '...WL.....', '..LWLM....', '.LWLLMD...',
      '.WLLLMD...', '.LLLMMD...', '.LMMMDD...', '..MDDD....', '..........', '..........', '..........',
    ], 1, 0);
    pen.rim(R);
  },
  upgrade(pen, i) {
    // faceted crystal with a glint
    stamp(pen, [
      '............', '.....W......', '....WLM.....', '...WLLMD....', '..WLLLMMD...', '..LLLWMMD...',
      '..LLLLMDD...', '...LLMMD....', '....LMD.....', '.....D......', '............', '............',
    ], 0, 1);
    if (i) { pen.set(9, 1, W); pen.set(10, 2, W); pen.set(8, 2, L); pen.set(9, 3, L); }
    pen.rim(R);
  },
  core(pen, i) {
    // Cinderheart Core: a glowing orb inside a basalt claw
    const c = 6.5;
    for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
      const r = Math.hypot(x + 0.5 - (c + 0.5), y + 0.5 - (c + 0.5));
      if (r > 5.2) continue;
      pen.set(x, y, r < (i ? 2.4 : 1.8) ? W : r < 3.6 ? L : r < 4.4 ? MID : S);
    }
    for (const [x, y] of [[2, 3], [3, 2], [10, 2], [11, 3], [2, 10], [11, 10], [6, 12], [7, 12]]) pen.set(x, y, S);
    pen.rim(R);
  },
  stun(pen, i) {
    // three small stars orbiting on an ellipse
    for (let k = 0; k < 3; k++) {
      const t = (i / 4 + k / 3) * Math.PI * 2;
      const x = 7.5 + Math.cos(t) * 6, y = 3.5 + Math.sin(t) * 2;
      const v = Math.sin(t) > 0 ? W : MID; // front stars brighter
      pen.set(x, y, v); pen.set(x - 1, y, v - 30); pen.set(x + 1, y, v - 30); pen.set(x, y - 1, v - 30); pen.set(x, y + 1, v - 30);
    }
  },
  pillar(pen, i) {
    // level-up column: a bright beam with a soft edge and rising sparkles
    for (let y = 0; y < 64; y++) {
      const flare = 1 + (y > 52 ? (y - 52) * 0.35 : 0);
      for (let x = 0; x < 24; x++) {
        const d = Math.abs(x + 0.5 - 12);
        if (d < 2.2 * flare) pen.set(x, y, W);
        else if (d < 4 * flare) pen.set(x, y, L);
        else if (d < 5.5 * flare && ((x + y + i) & 1)) pen.set(x, y, MID);
      }
    }
    for (let k = 0; k < 7; k++) {
      const x = 2 + ((k * 7) % 20), y = (60 - ((k * 11 + i * 16) % 64) + 64) % 64;
      pen.set(x, y, W); pen.set(x, y - 1, L);
    }
  },
  wallFlame(pen, i) {
    // flame tongue: wide base, flickering tip, white-hot core low in the flame
    for (let y = 0; y < 24; y++) {
      const t = 1 - y / 23; // 0 base … 1 tip
      const sway = Math.sin(t * 5 + i * 1.6) * t * 2.2;
      const half = 6.5 * Math.sqrt(1 - t) * (1 - 0.25 * t) + (i % 2 ? 0.4 : 0);
      for (let x = 0; x < 16; x++) {
        const d = Math.abs(x + 0.5 - 8 - sway);
        if (d > half) continue;
        const core = d < half * 0.45 && t < 0.6;
        pen.set(x, y, core ? W : d < half * 0.75 ? L : MID);
      }
    }
    // a detached ember above the tip
    pen.set(8 + (i % 2 ? 2 : -1), 1 + i, L);
  },
};

/** Stamp a template of grey-level letters (W L M D S R) at (ox, oy). */
function stamp(pen, rows, ox = 0, oy = 0) {
  const V = { W, L, M: MID, D, S, R };
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (V[ch]) pen.set(ox + x, oy + y, V[ch]); }));
}

/**
 * What a package's frame painter gets besides its pen: the grey levels (white-hot core, light, mid,
 * dark, shadow, rim) and the base painters' `arc` (a crescent band) and `stamp` (a letter template).
 */
const FX_KIT = Object.freeze({ W, L, MID, D, S, R, arc, stamp });

/** The atlas side (px). */
const ATLAS = 1024;
/** The side of the base region, top left (the former 512 × 512 atlas). */
const BASE = 512;
const GUTTER = 1;

/**
 * Shelf-pack frames into regions (by `late` generation, then tallest first, then by name, so the
 * layout is stable): a frame's cells go into the current region, the next one when it is full.
 * @param {Readonly<Record<string, FxFrameSpec>>} specs
 * @param {{ x: number, y: number, w: number, h: number }[]} regions
 * @returns {Record<string, {x:number, y:number}[]>} pixel position of each frame's top-left texel
 */
function packFrames(specs, regions) {
  const names = Object.keys(specs).sort((a, b) => (+(specs[a].late ?? 0) - +(specs[b].late ?? 0)) || (specs[b].h - specs[a].h) || (a < b ? -1 : 1));
  const out = {};
  let r = 0;
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const name of names) {
    const { w, h, n } = specs[name];
    const cw = w + GUTTER * 2;
    const ch = h + GUTTER * 2;
    out[name] = [];
    for (let i = 0; i < n; i++) {
      for (;;) {
        const reg = regions[r];
        if (!reg) throw new Error(`FxSprites: the FX atlas does not fit in ${ATLAS} × ${ATLAS} (at "${name}")`);
        if (x + cw > reg.w) { x = 0; y += shelf; shelf = 0; }
        if (cw <= reg.w && y + ch <= reg.h) break;
        r++; x = 0; y = 0; shelf = 0;
      }
      out[name].push({ x: regions[r].x + x + GUTTER, y: regions[r].y + y + GUTTER });
      x += cw;
      shelf = Math.max(shelf, ch);
    }
  }
  return out;
}

/**
 * Paint the FX atlas. Call once at load (combat levels only) and share the result.
 * @returns {{ texture: THREE.Texture, canvas: HTMLCanvasElement,
 *   frames: Record<string, { w: number, h: number, n: number, fps: number, rects: [number, number, number, number][] }> }}
 */
export function createFxAtlas() {
  const pc = new PixelCanvas(ATLAS, ATLAS);
  const placed = fxAtlasLayout();
  const frames = {};
  for (const [name, spec] of Object.entries(FX_FRAMES)) {
    const rects = [];
    const mod = MODULE_OF.get(name);
    placed[name].forEach(({ x, y }, i) => {
      const { w, h } = spec;
      const pen = framePen(pc, x, y, w, h);
      if (mod) mod.paint(name, pen, i, FX_KIT);
      else PAINT[name](pen, i);
      rects.push([x / ATLAS, 1 - (y + h) / ATLAS, (x + w) / ATLAS, 1 - y / ATLAS]);
    });
    frames[name] = { w: spec.w, h: spec.h, n: spec.n, fps: spec.fps, rects };
  }
  const canvas = pc.toCanvas();
  const texture = makePixelTexture(canvas, { wrap: 'clamp', mipmaps: false, srgb: true, name: 'fx:atlas' });
  return { texture, canvas, frames };
}

/**
 * Where every frame's cells lie in the atlas (px of each cell's top-left texel; the reserved cells
 * of retired frames too): the base frames where the 512 × 512 atlas had them, the packages' in
 * the rest. Pure (no canvas): tests compare it between versions.
 * @returns {Record<string, { x: number, y: number }[]>}
 */
export function fxAtlasLayout() {
  const extension = {
    ...Object.fromEntries([...MODULE_OF.keys()].map((n) => [n, FX_FRAMES[n]])),
    ...Object.fromEntries(RESERVED),
  };
  return {
    ...packFrames(BASE_FX_FRAMES, [{ x: 0, y: 0, w: BASE, h: BASE }]),
    ...packFrames(extension, [{ x: BASE, y: 0, w: ATLAS - BASE, h: BASE }, { x: 0, y: BASE, w: ATLAS, h: ATLAS - BASE }]),
  };
}
