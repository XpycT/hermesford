import * as THREE from 'three';
import { clamp, smoothstep, hash2, fbm2, bayer4 } from '../../utils/math.js';
import { PixelCanvas, makePixelTexture } from '../../pixel/PixelCanvas.js';
import { TRIM } from './Details.js';
import { FlameSet } from './FlameBatch.js';

/**
 * @import { PropFactory, PropResult } from '../Props.js'
 * @import { Collider } from '../TileMap.js'
 * @import { MeshBuilder } from './MeshBuilder.js'
 * @import { RNG } from '../../utils/math.js'
 */

/**
 * SetPieces.js — the set-piece props of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md
 * §5.3, §6.3; design notes docs/design/SIEGE_AND_FESTIVAL.md): `fire` (a blaze, the festival
 * bonfire, a brazier, embers), `debris` (rubble, an overturned cart, fallen timbers, a broken wall,
 * a torn awning, a dragon's bones, a barricade) and `garland` (pennants, paper lanterns or both on a
 * sagging rope) — the catalog's `setpiece` types; `PropFactory.fire` / `debris` / `garland` call
 * these. Also the siege's shared art, used by props/House.js for ruined and burning houses: the
 * decal atlas (soot plumes, scorch marks, cracks: `siegeDecalMaterial`, `decalQuad`,
 * `scorchDecal`) and the fire-lit window and ember materials. Owner: the siege package.
 *
 * Fires are drawn by the instanced flame batch (FlameBatch.js: a prop's flames, glow cards and
 * rising sparks are instanced meshes, a world merges them all into three); a fire's light is a
 * descriptor with `nightOnly: false` (ObjectBuilder gives `fire` objects priority 0,
 * `LIGHT_PRIORITY.fire`) and its smoke an emitter descriptor of the siege presets
 * (fx/presets/siege.js) — the one particle emitter a fire costs. The shared materials are made once
 * per factory (`f._cachedMaterial`) and freed with it.
 *
 * Every builder reads its options as level data (untrusted): numbers clamped, kinds looked up in
 * own tables, RNG from `f.rng(type, x, z, opts.seed)` only (the same props every build).
 */

/** Ground AO: darker toward the foot of a prop. */
const groundAO = (h = 0.5, k = 0.62) => (px, py) => k + (1 - k) * smoothstep(-0.05, h, py);
/** A number option (anything else: the default), clamped. */
const num = (v, d, lo, hi) => clamp(Number.isFinite(v) ? v : d, lo, hi);
/** Vertex tints: charred wood, soot, bone. */
const CHAR = [0.3, 0.26, 0.25];
const SOOT = [0.42, 0.36, 0.34];
const BONE = [1.22, 1.17, 1.05];
/** The dark of a bone's hollows (eye sockets, nostrils). */
const VOID_BONE = [0.12, 0.1, 0.09];
/** The embers' glow (as the hearth's): emissive day and night. */
const EMBER_GLOW = Object.freeze({ day: 1.3, night: 1.9 });

// ---------------------------------------------------------------------------------------------
// The siege's shared art: the decal atlas, paper lanterns, fire-lit windows, embers
// ---------------------------------------------------------------------------------------------

/** Atlas cells in canvas px: [x, y, w, h] of the 128 × 64 decal atlas (16 px per unit). */
export const DECAL_CELLS = Object.freeze({
  soot: [0, 0, 32, 32],
  soot2: [32, 0, 32, 32],
  scorch: [64, 0, 64, 64],
  cracks: [0, 32, 32, 32],
  scorchSmall: [32, 32, 32, 32],
});
const ATLAS_W = 128;
const ATLAS_H = 64;

/**
 * Paint the decal atlas: soot plumes (the soot a fire left above a window or a door: dense at the
 * opening, fanning up and thinning out), ground scorch marks (char at the heart, ash flecks,
 * a ragged dithered rim), crack clusters with lit lips. Transparent around the shapes (alpha
 * cut-out: the hard pixel edge, softened by ordered dithering).
 * @param {number} seed
 */
function paintDecals(seed) {
  const pc = new PixelCanvas(ATLAS_W, ATLAS_H);
  const SOOTR = ['#1c1512', '#271d18', '#33281f', '#433528', '#544432'];
  // -- soot plumes: dense at the opening, fanning up in licked streaks, thinning out
  for (const { key, sd } of /** @type {{ key: 'soot'|'soot2', sd: number }[]} */ ([{ key: 'soot', sd: 0 }, { key: 'soot2', sd: 1 }])) {
    const [cx0, cy0, cw, ch] = DECAL_CELLS[key];
    for (let v = 0; v < ch; v++) {
      for (let u = 0; u < cw; u++) {
        const up = ch - 1 - v; // 0 at the bottom (the opening's top edge)
        const t = up / ch;
        const n = fbm2(u / 5 + sd * 7.1, up / 6 + seed * 0.01, { octaves: 3, seed: seed + 3 + sd });
        // the fan: as wide as the opening at its foot, wider as it climbs, leaning a little
        const hw = 7 + up * 0.38 + (n - 0.5) * 4;
        const dx = Math.abs(u + 0.5 - cw / 2 - (sd ? 1.5 : -1) * t * t * 4);
        let d = (1 - dx / hw) * Math.pow(Math.max(0, 1 - t), 0.45);
        // tongues: streaks the flames licked up the wall
        const streak = Math.max(0, Math.sin((u + sd * 3.3) * 1.15 + n * 3.5));
        d += 0.22 * streak * (0.4 + t) - 0.12;
        d += (n - 0.5) * 0.3;
        const th = d + (bayer4(u, v) - 0.5) * 0.22;
        if (th < 0.28) continue;
        const k = clamp(Math.floor((1 - clamp(d, 0, 1)) * 5.4 + (hash2(u, v, seed + sd) < 0.15 ? 1 : 0)), 0, 4);
        pc.set(cx0 + u, cy0 + v, SOOTR[k]);
      }
    }
  }
  // -- ground scorch marks
  for (const { key, sd, ring } of /** @type {{ key: 'scorch'|'scorchSmall', sd: number, ring: boolean }[]} */ ([{ key: 'scorch', sd: 0, ring: false }, { key: 'scorchSmall', sd: 1, ring: true }])) {
    const [cx0, cy0, cw, ch] = DECAL_CELLS[key];
    const R = cw / 2;
    for (let v = 0; v < ch; v++) {
      for (let u = 0; u < cw; u++) {
        const dx = u + 0.5 - R;
        const dy = v + 0.5 - R;
        const r = Math.hypot(dx, dy) / R;
        const a = Math.atan2(dy, dx);
        const n = fbm2(Math.cos(a) * 1.6 + sd * 5, Math.sin(a) * 1.6, { octaves: 3, seed: seed + 11 + sd });
        const n2 = fbm2(u / 5, v / 5, { octaves: 2, seed: seed + 13 + sd });
        const edge = 0.68 + (n - 0.5) * 0.5;
        let d = 1 - r / edge;
        if (ring) d = Math.min(d, 0.25 + Math.abs(r - edge * 0.55) * 1.6);
        const t = d + (bayer4(u, v) - 0.5) * 0.28 + (n2 - 0.5) * 0.25;
        if (t < 0.06) continue;
        // burnt earth: char at the heart, brown-grey soot, a warm scorched rim; black char flecks,
        // grey ash, a few ember specks (never a flat black: it would read as a hole)
        const hsh = hash2(u, v, seed + 17 + sd);
        let c;
        if (d > 0.55) c = n2 > 0.7 ? '#4e463e' : hsh < 0.3 ? '#16110e' : '#241c17';
        else if (d > 0.3) c = n2 > 0.78 ? '#5c544a' : hsh < 0.12 ? '#1e1712' : '#352a21';
        else if (d > 0.14) c = hsh < 0.06 ? '#2a2018' : '#4a3a2c';
        else c = '#614c38';
        if (hsh > 0.968) c = '#948c82';
        else if (d > 0.5 && hsh > 0.3 && hsh < 0.312) c = '#a8441a';
        pc.set(cx0 + u, cy0 + v, c);
      }
    }
  }
  // -- crack cluster: three branches from a knot, dark line with a lit lip below-right
  {
    const [cx0, cy0, cw, ch] = DECAL_CELLS.cracks;
    let s = seed;
    const rnd = () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; return s / 4294967296; };
    const paths = [];
    for (let b = 0; b < 3; b++) {
      let x = cw / 2 + (rnd() - 0.5) * 4;
      let y = ch / 2 + (rnd() - 0.5) * 4;
      let ang = (b / 3) * Math.PI * 2 + rnd() * 0.8;
      const len = 9 + Math.floor(rnd() * 7);
      for (let k = 0; k < len; k++) {
        paths.push([Math.round(x), Math.round(y)]);
        ang += (rnd() - 0.5) * 0.9;
        x += Math.cos(ang);
        y += Math.sin(ang);
        if (x < 1 || y < 1 || x > cw - 2 || y > ch - 2) break;
      }
    }
    for (const [x, y] of paths) pc.set(cx0 + x + 1, cy0 + y + 1, '#c8b49a');
    for (const [x, y] of paths) pc.set(cx0 + x, cy0 + y, '#1a1210');
  }
  return pc;
}

/**
 * The decal material of a factory (made once, freed with it): the atlas, alpha cut-out, polygon
 * offset over the surface under it, lit, receives but casts no shadow — one batch for every
 * decal of a level.
 * @param {PropFactory} f
 * @returns {THREE.MeshLambertMaterial}
 */
export function siegeDecalMaterial(f) {
  return /** @type {THREE.MeshLambertMaterial} */ (f._cachedMaterial('siege:decal', () => {
    const pc = paintDecals(f.seed % 9973);
    const map = makePixelTexture(pc.toCanvas(), { wrap: 'clamp', mipmaps: false, name: 'luminati:siege:decals' });
    const m = new THREE.MeshLambertMaterial({
      map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    m.name = 'luminati:siege:decal';
    m.userData.units = [ATLAS_W / 16, ATLAS_H / 16];
    m.userData.castShadow = false;
    m.addEventListener('dispose', () => map.dispose());
    return m;
  }));
}

/** UVs of an atlas cell: [u0, v0, u1, v1] (canvas row 0 = v 1). @param {keyof typeof DECAL_CELLS} cell */
function cellUV(cell) {
  const [x, y, w, h] = DECAL_CELLS[cell];
  return [x / ATLAS_W, 1 - (y + h) / ATLAS_H, (x + w) / ATLAS_W, 1 - y / ATLAS_H];
}

/**
 * A decal quad on a wall (the builder's current frame: the wall plane z = 0, outward +z): `cell`
 * stretched over [x0, x1] × [y0, y1], 0.03 in front of the wall.
 * @param {MeshBuilder} b @param {THREE.Material} mat
 * @param {keyof typeof DECAL_CELLS} cell
 * @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1
 * @param {{ flip?: boolean, color?: number[], z?: number }} [opts] flip: mirror the cell
 */
export function decalQuad(b, mat, cell, x0, y0, x1, y1, { flip = false, color, z = 0.03 } = {}) {
  const [u0, v0, u1, v1] = cellUV(cell);
  const ua = flip ? u1 : u0;
  const ub = flip ? u0 : u1;
  b.quad(mat, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [[ua, v0], [ub, v0], [ub, v1], [ua, v1]], { color });
}

/**
 * A scorch mark on the ground (the builder's frame: ground y = 0 at the prop's origin), radius r
 * around (cx, cz), turned by `rot`.
 * @param {MeshBuilder} b @param {THREE.Material} mat
 * @param {number} cx @param {number} cz @param {number} r @param {number} rot
 * @param {{ y?: number, small?: boolean }} [opts]
 */
export function scorchDecal(b, mat, cx, cz, r, rot, { y = 0.025, small = false } = {}) {
  const [u0, v0, u1, v1] = cellUV(small ? 'scorchSmall' : 'scorch');
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const P = (lx, lz) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
  b.quad(mat, [P(-r, r), P(r, r), P(r, -r), P(-r, -r)], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
}

/** Paper lantern cells (16 × 16 each): red, gold, cream. */
const LANTERN_COLORS = [
  ['#5a1410', '#8c2418', '#c43c22', '#e8683a', '#ffb070'],
  ['#5a3a10', '#8c5c18', '#c88a22', '#eebc48', '#fff0a0'],
  ['#5a4a3a', '#8c7a62', '#c4b08e', '#ead8b4', '#fff8e4'],
];

/**
 * Paper lanterns of a factory (made once, freed with it): a 48 × 16 atlas of three lantern papers
 * (ribs, dark caps, the candle's bright band in the middle) as both map and emissive map, so a
 * lantern glows its own colour at night (registered as an emissive by the garland: `{ day 0.08,
 * night 1.5 }`).
 * @param {PropFactory} f
 * @returns {THREE.MeshLambertMaterial}
 */
export function lanternPaperMaterial(f) {
  return /** @type {THREE.MeshLambertMaterial} */ (f._cachedMaterial('siege:lantern', () => {
    const pc = new PixelCanvas(48, 16);
    LANTERN_COLORS.forEach((R, ci) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          let k = 3;
          const band = Math.abs(y - 8.5);
          if (band < 3) k = 4;
          else if (band > 6) k = 2;
          if (x % 4 === 0) k -= 1; // ribs
          if (x % 16 === 15 || x % 16 === 1) k -= 1;
          let c = R[clamp(k, 0, 4)];
          if (y < 2 || y > 13) c = y === 1 || y === 14 ? '#3a2418' : '#24160e';
          pc.set(ci * 16 + x, y, c);
        }
      }
    });
    const map = makePixelTexture(pc.toCanvas(), { wrap: 'repeat', mipmaps: false, name: 'luminati:siege:lanterns' });
    const m = new THREE.MeshLambertMaterial({ map, emissiveMap: map, emissive: new THREE.Color(0xffffff), emissiveIntensity: 0, vertexColors: true });
    m.name = 'luminati:siege:lantern';
    m.userData.units = [3, 1];
    m.addEventListener('dispose', () => map.dispose());
    return m;
  }));
}

/**
 * Window glass lit by a fire inside (a burning house): the library's `window` texture with an
 * orange-red emissive (its own cached material: the village's lit windows are untouched),
 * registered day and night (`FIRE_WINDOW_GLOW`).
 * @param {PropFactory} f
 */
export function fireWindowMaterial(f) {
  return f.textures.material('window', { vertexColors: true, emissiveIntensity: 0, emissive: new THREE.Color(0xff5a1e) });
}
/** A fire-lit window's glow: bright by day too. */
export const FIRE_WINDOW_GLOW = Object.freeze({ day: 2.2, night: 2.8 });

/**
 * Glowing coals (the library's `embers` texture, emissive orange as the hearth's; `dim`: the
 * duller red of coals smouldering under ash, with no fire over them).
 * @param {PropFactory} f
 * @param {boolean} [dim]
 */
export function embersMaterial(f, dim = false) {
  return f.textures.material('embers', { vertexColors: true, emissiveIntensity: 0, emissive: new THREE.Color(dim ? 0x9a2c0c : 0xff6a1e) });
}

// ---------------------------------------------------------------------------------------------
// fire
// ---------------------------------------------------------------------------------------------

/**
 * Per fire kind: the light (intensity, range at size 1.5), the collider radius per unit of size
 * (0: none), the sparks (count at size 1.5, rise per unit of size, life), the smoke emitter (preset,
 * rate; null: none) and the scorch mark's radius per unit of size (0: none).
 */
const FIRE_KINDS = {
  blaze: { light: [14, 10], collide: 0.36, sparks: [12, 2.2, 2.0], smoke: ['smokeDark', 1.6], scorch: 1.05 },
  bonfire: { light: [22, 14], collide: 0.62, sparks: [22, 3.2, 2.6], smoke: ['bonfireSmoke', 2.4], scorch: 1.15 },
  brazier: { light: [10, 8], collide: 0.3, sparks: [5, 1.4, 1.6], smoke: null, scorch: 0 },
  embers: { light: [6, 6], collide: 0, sparks: [6, 0.9, 1.8], smoke: ['smokeWisp', 1.2], scorch: 0.8 },
};

/**
 * A set-piece fire: its base by kind (a blaze: a heap of charred timbers on an ash bed and a scorch
 * mark; the bonfire: a tall teepee of logs in a ring of stones over glowing coals; a brazier: a
 * stone pedestal with an iron bowl of coals; embers: a smouldering mound), a cluster of batched
 * flames and rising sparks (FlameBatch) scaled by `size`, one light day and night, smoke.
 * @param {PropFactory} f
 * @param {number} x @param {number} y ground height @param {number} z
 * @param {{ kind?: string, size?: number, smoke?: boolean, light?: boolean, seed?: number,
 *   intensity?: number, distance?: number, id?: string }} [opts]
 * @returns {PropResult}
 */
export function buildFire(f, x, y, z, opts = {}) {
  const kind = Object.hasOwn(FIRE_KINDS, opts.kind) ? opts.kind : 'blaze';
  const K = FIRE_KINDS[kind];
  const s = num(opts.size, 1.5, 0.3, 6);
  const rng = f.rng('fire', x, z, opts.seed);
  const b = f.builder(groundAO(0.4 * s));
  const ash = f.extra.material('ash');
  const coal = embersMaterial(f, kind === 'embers');
  const decal = siegeDecalMaterial(f);
  const flames = new FlameSet();
  const seed = () => rng.range(0, 100);
  /** the flames' base height and the cluster's top */
  let base = 0.05;
  let top = 0;
  const flame = (fx, fz, w, h, glow = 0, glowIntensity = 0.6) => {
    flames.add({ x: fx, y: base, z: fz, width: w, height: h, seed: seed(), glow, glowIntensity, speed: rng.range(0.85, 1.15) });
    top = Math.max(top, base + h);
  };
  switch (kind) {
    case 'bonfire': {
      // ring of stones, a bed of coals, a tall teepee of logs (bark, charred where they burn)
      b.lathe(ash, [{ y: 0.012, r: 0.95 * s }, { y: 0.04, r: 0.75 * s }, { y: 0.05, r: 0.01 }], { segments: 12, smooth: true, normalUp: 2 });
      b.lathe(coal, [{ y: 0.03, r: 0.6 * s }, { y: 0.1 * s, r: 0.35 * s }, { y: 0.12 * s, r: 0.01 }], { segments: 10, smooth: true, normalUp: 1.5 });
      const nStones = 14;
      for (let i = 0; i < nStones; i++) {
        const a = (i / nStones) * Math.PI * 2 + rng.range(-0.08, 0.08);
        const r = 0.92 * s;
        const st = rng.range(0.13, 0.18) * s;
        f.rockGeom(b, Math.cos(a) * r, 0, Math.sin(a) * r, [st * 1.2, st * 0.8, st], rng, { top: 'sandstone_brick', side: 'sandstone_brick', detail: 0, yaw: -a, tint: [0.78, 0.72, 0.68] });
      }
      const logs = 9;
      for (let i = 0; i < logs; i++) {
        const a = (i / logs) * Math.PI * 2 + rng.range(-0.15, 0.15);
        const ex = Math.cos(a);
        const ez = Math.sin(a);
        const r0 = rng.range(0.55, 0.68) * s;
        b.tube('bark', [ex * r0, 0.04, ez * r0], [-ex * 0.06 * s, rng.range(1.15, 1.35) * s, -ez * 0.06 * s], 0.075 * s, 0.05 * s, {
          segments: 6, capBottom: 'wood_planks', twist: i, rings: 3,
          colorFn: (ri) => (ri === 0 ? [0.9, 0.86, 0.84] : ri === 1 ? [0.55, 0.46, 0.44] : CHAR),
        });
      }
      // a few spare logs laid beside it
      for (let i = 0; i < 2; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = 1.35 * s;
        const tx = -Math.sin(a) * 0.45 * s;
        const tz = Math.cos(a) * 0.45 * s;
        b.tube('bark', [Math.cos(a) * d - tx, 0.09 * s, Math.sin(a) * d - tz], [Math.cos(a) * d + tx, 0.09 * s, Math.sin(a) * d + tz], 0.09 * s, 0.085 * s, { segments: 6, capTop: 'wood_planks', capBottom: 'wood_planks', twist: a });
      }
      base = 0.08 * s;
      flame(0, 0, 0.95 * s, 1.75 * s, 2.3, 0.7);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3);
        flame(Math.cos(a) * 0.32 * s, Math.sin(a) * 0.32 * s, rng.range(0.42, 0.55) * s, rng.range(0.8, 1.15) * s);
      }
      break;
    }
    case 'brazier': {
      // a carved sandstone pedestal (base, shaft, capital) holding an iron bowl of coals on three lion feet
      b.lathe('sandstone_brick', [{ y: 0, r: 0.3 * s }, { y: 0.1 * s, r: 0.3 * s }, { y: 0.14 * s, r: 0.24 * s }, { y: 0.5 * s, r: 0.18 * s }, { y: 0.56 * s, r: 0.26 * s }, { y: 0.62 * s, r: 0.26 * s }, { y: 0.63 * s, r: 0.01 }], { segments: 8, smooth: false });
      const bowl = [{ y: 0.64 * s, r: 0.12 * s }, { y: 0.7 * s, r: 0.3 * s }, { y: 0.84 * s, r: 0.42 * s }, { y: 0.88 * s, r: 0.46 * s }, { y: 0.9 * s, r: 0.4 * s }];
      b.lathe('metal', bowl, { segments: 10, smooth: true, color: [0.55, 0.5, 0.48] });
      b.lathe(coal, [{ y: 0.86 * s, r: 0.4 * s }, { y: 0.92 * s, r: 0.25 * s }, { y: 0.94 * s, r: 0.01 }], { segments: 10, smooth: true, normalUp: 1 });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.3;
        b.box('metal', [0.06 * s, 0.12 * s, 0.06 * s], { at: [Math.cos(a) * 0.3 * s, 0.68 * s, Math.sin(a) * 0.3 * s], rot: [0, -a, 0.4], color: [0.6, 0.55, 0.5] });
      }
      // two ring handles
      for (const sx of [-1, 1]) b.box('metal', [0.04 * s, 0.1 * s, 0.14 * s], { at: [sx * 0.47 * s, 0.84 * s, 0], color: [0.5, 0.46, 0.44] });
      base = 0.9 * s;
      flame(0, 0, 0.46 * s, 0.7 * s, 2.0, 0.45);
      flame(rng.range(-0.12, 0.12) * s, rng.range(-0.08, 0.08) * s, 0.3 * s, 0.42 * s);
      break;
    }
    case 'embers': {
      // a smouldering mound: ash, coals glowing through it, charred stubs
      b.lathe(ash, [{ y: 0.012, r: 0.7 * s }, { y: 0.06 * s, r: 0.5 * s }, { y: 0.08 * s, r: 0.01 }], { segments: 10, smooth: true, normalUp: 2 });
      b.lathe(coal, [{ y: 0.04, r: 0.42 * s }, { y: 0.11 * s, r: 0.26 * s }, { y: 0.13 * s, r: 0.01 }], { segments: 9, smooth: true, normalUp: 1.5 });
      for (let i = 0; i < 4; i++) {
        const a = rng.range(0, Math.PI * 2);
        const l = rng.range(0.25, 0.45) * s;
        const cx = Math.cos(a) * 0.2 * s;
        const cz = Math.sin(a) * 0.2 * s;
        b.tube('bark', [cx - Math.cos(a + 1.3) * l, 0.05 * s, cz - Math.sin(a + 1.3) * l], [cx + Math.cos(a + 1.3) * l, 0.09 * s, cz + Math.sin(a + 1.3) * l], 0.05 * s, 0.045 * s, { segments: 5, capTop: coal, capBottom: coal, twist: a, colorFn: () => CHAR });
      }
      base = 0.06 * s;
      flame(0, 0, 0.26 * s, 0.3 * s, 1.8, 0.3);
      flame(0.16 * s, -0.1 * s, 0.2 * s, 0.22 * s);
      flame(-0.14 * s, 0.12 * s, 0.18 * s, 0.18 * s);
      break;
    }
    default: {
      // blaze: charred beams heaped across each other on an ash bed, broken stones, glowing ends
      b.lathe(ash, [{ y: 0.012, r: 0.75 * s }, { y: 0.05, r: 0.55 * s }, { y: 0.06, r: 0.01 }], { segments: 10, smooth: true, normalUp: 2 });
      b.lathe(coal, [{ y: 0.03, r: 0.42 * s }, { y: 0.08 * s, r: 0.28 * s }, { y: 0.1 * s, r: 0.01 }], { segments: 9, smooth: true, normalUp: 1.5 });
      const n = 5;
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI);
        const l = rng.range(0.45, 0.7) * s;
        const h0 = 0.06 * s + i * 0.07 * s;
        const tilt = rng.range(-0.25, 0.25) * s;
        b.tube('wood_planks_dark', [-Math.cos(a) * l, h0 - tilt * 0.4, -Math.sin(a) * l], [Math.cos(a) * l, h0 + tilt * 0.4, Math.sin(a) * l], 0.075 * s, 0.07 * s, {
          segments: 4, capTop: coal, capBottom: coal, twist: rng.range(0, 1), colorFn: () => CHAR,
        });
      }
      for (let i = 0; i < 4; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0.5, 0.75) * s;
        const st = rng.range(0.1, 0.18) * s;
        f.rockGeom(b, Math.cos(a) * d, 0, Math.sin(a) * d, [st * 1.3, st * 0.7, st], rng, { top: 'sandstone_brick', side: 'sandstone_brick', detail: 0, yaw: a, tint: SOOT });
      }
      base = 0.1 * s;
      flame(0, 0, 0.82 * s, 1.15 * s, 2.2, 0.65);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rng.range(-0.4, 0.4);
        flame(Math.cos(a) * 0.3 * s, Math.sin(a) * 0.3 * s, rng.range(0.38, 0.52) * s, rng.range(0.55, 0.8) * s);
      }
    }
  }
  if (K.scorch) scorchDecal(b, decal, 0, 0, K.scorch * s, rng.range(0, Math.PI * 2), { small: kind === 'embers' });
  const k = Math.sqrt(s / 1.5);
  // the sparks rise from the heart of the fire (batched with the flames: no emitter)
  flames.spark({ x: 0, y: base + (top - base) * 0.3, z: 0, spread: 0.3 * s, height: K.sparks[1] * s, count: Math.round(K.sparks[0] * k), seed: rng.range(0, 100), life: K.sparks[2], size: kind === 'bonfire' ? 0.09 : 0.075 });
  const group = f.finish(b, 'fire', x, y, z, rng.range(0, Math.PI * 2));
  const fl = flames.build(f);
  if (fl) {
    group.add(fl);
    group.updateMatrixWorld(true);
  }
  /** @type {Collider[]} */
  const colliders = K.collide ? [{ type: 'circle', x, z, r: K.collide * s + 0.2 }] : [];
  const emitters = [];
  if (opts.smoke !== false && K.smoke) emitters.push({ preset: K.smoke[0], position: new THREE.Vector3(x, y + top + 0.15, z), rate: K.smoke[1] * k });
  return f.result(group, {
    colliders,
    lights: opts.light === false ? [] : [{
      position: new THREE.Vector3(x, y + base + (top - base) * 0.6, z), color: 0xff7a2e,
      intensity: num(opts.intensity, K.light[0] * k, 0, 60), distance: num(opts.distance, K.light[1] * k, 2, 30),
      flicker: 0.55, nightOnly: false,
    }],
    emissives: [{ material: coal, ...EMBER_GLOW }],
    emitters,
  });
}

// ---------------------------------------------------------------------------------------------
// debris
// ---------------------------------------------------------------------------------------------

/**
 * A spoked cart wheel in the builder's frame: centred at (cx, cy, cz), its axle along `axis`
 * ('x' | 'z' | 'y': lying flat).
 */
function wheelGeom(b, cx, cy, cz, r, axis, tint, rng) {
  const rot = axis === 'y' ? [0, 0, 0] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2];
  b.push([cx, cy, cz], rot);
  b.lathe('wood_planks_dark', [{ y: -0.05, r }, { y: 0.05, r }], { segments: 12, smooth: false, color: tint });
  b.lathe('metal', [{ y: -0.055, r: r + 0.02 }, { y: 0.055, r: r + 0.02 }], { segments: 12, smooth: false, color: [0.6, 0.56, 0.54] });
  b.lathe('wood_planks_dark', [{ y: -0.05, r: r - 0.06 }, { y: 0.05, r: r - 0.06 }], { segments: 12, smooth: false, color: [0.6, 0.55, 0.52] });
  b.lathe(TRIM, [{ y: -0.1, r: 0.07 }, { y: 0.1, r: 0.07 }], { segments: 6, capTop: true, capBottom: true, color: tint });
  const spokes = 8;
  const off = rng.range(0, 1);
  for (let i = 0; i < spokes; i++) {
    const a = ((i + off) / spokes) * Math.PI * 2;
    b.box(TRIM, [0.035, 0.035, r - 0.06], { at: [Math.cos(a) * (r - 0.06) / 2, 0, Math.sin(a) * (r - 0.06) / 2], rot: [0, -a + Math.PI / 2, 0], color: tint });
  }
  b.pop();
}

/**
 * Set-piece wreckage, scaled by `size`, `charred` blackens it: `rubble` (a heap of broken stone
 * and tiles), `cart` (an overturned cart, a wheel off), `timbers` (fallen beams), `wall` (a broken
 * wall stub), `tent` (a torn market awning), `bones` (a dragon's ribcage and skull — huge with a big
 * size), `barricade` (stakes, crates and barrels). Colliders round what blocks the way (the
 * awning's posts, the skeleton's spine, skull and rib tips — the ground under the ribs stays open).
 * @param {PropFactory} f
 * @param {number} x @param {number} y ground height @param {number} z
 * @param {{ kind?: string, size?: number, charred?: boolean, seed?: number, rotation?: number, id?: string }} [opts]
 * @returns {PropResult}
 */
export function buildDebris(f, x, y, z, opts = {}) {
  const kinds = ['rubble', 'cart', 'timbers', 'wall', 'tent', 'bones', 'barricade'];
  const kind = kinds.includes(opts.kind) ? opts.kind : 'rubble';
  const s = num(opts.size, 1, 0.3, 8);
  const rng = f.rng('debris', x, z, opts.seed);
  const charred = opts.charred === true;
  const tint = charred ? CHAR : [1, 1, 1];
  const stone = charred ? 'charred_wall' : 'sandstone_brick';
  const b = f.builder(groundAO(0.5 * s));
  const decal = siegeDecalMaterial(f);
  /** @type {Collider[]} */
  const colliders = [];
  const ring = (r) => colliders.push({ type: 'circle', x, z, r });
  /** local rectangles [minX, maxX, minZ, maxZ] made into box colliders once the prop is placed */
  const boxes = [];
  /** local points [x, z, r] made into circle colliders once the prop is placed */
  const circles = [];
  /** @type {{ material: THREE.Material, day?: number, night?: number }[]} */
  const emissives = [];
  switch (kind) {
    case 'cart': {
      // a cart turned over: the bed upside down on the ground, the axle and one wheel in the air,
      // the other wheel torn off and lying in the dust, the shafts jutting up, the load spilled
      const L = 1.8 * s;
      const Wd = 1.05 * s;
      const H = 0.42 * s;
      // the bed: floor on top (its underside up), the side boards down to the ground
      b.box('wood_planks', [L, 0.08 * s, Wd], { at: [0, H, 0], color: tint, faces: { py: { rotUV: true, color: tint.map((c) => c * 0.82) } } });
      for (const sz of [-1, 1]) b.box('wood_planks', [L, H, 0.07 * s], { at: [0, H / 2, sz * (Wd / 2 - 0.035 * s)], color: tint, faces: { ny: false } });
      for (const sx of [-1, 1]) b.box('wood_planks', [0.07 * s, H, Wd - 0.14 * s], { at: [sx * (L / 2 - 0.035 * s), H / 2, 0], color: tint, faces: { ny: false } });
      // cross beams and the axle on the upturned floor
      for (const bx of [-0.55, 0.55]) b.box(TRIM, [0.12 * s, 0.1 * s, Wd + 0.06 * s], { at: [bx * s, H + 0.09 * s, 0], color: tint });
      b.tube(TRIM, [0.15 * s, H + 0.2 * s, -Wd / 2 - 0.2 * s], [0.15 * s, H + 0.2 * s, Wd / 2 + 0.2 * s], 0.05 * s, 0.05 * s, { segments: 6, capTop: true, capBottom: true, color: tint });
      // the wheel still on the axle, standing up in the air; the other one in the dust
      wheelGeom(b, 0.15 * s, H + 0.2 * s, -Wd / 2 - 0.16 * s, 0.44 * s, 'z', tint, rng);
      wheelGeom(b, 1.25 * s, 0.07 * s, 0.95 * s, 0.44 * s, 'y', tint, rng);
      // the shafts: one jutting up at an angle, one snapped off on the ground
      b.tube(TRIM, [-L / 2 + 0.1 * s, H + 0.05 * s, 0.3 * s], [-L / 2 - 1.0 * s, 1.15 * s, 0.45 * s], 0.05 * s, 0.04 * s, { segments: 5, capTop: 'wood_planks', color: tint });
      b.tube(TRIM, [-L / 2 + 0.1 * s, 0.08 * s, -0.3 * s], [-L / 2 - 0.7 * s, 0.05 * s, -0.55 * s], 0.05 * s, 0.045 * s, { segments: 5, capTop: 'wood_planks', color: tint });
      // the spilled load: sacks, a split crate, a cask rolled away
      b.lathe('burlap', [{ y: 0, r: 0.18 * s }, { y: 0.12 * s, r: 0.26 * s }, { y: 0.26 * s, r: 0.2 * s }, { y: 0.3 * s, r: 0.06 * s }], { segments: 8, at: [0.3 * s, 0, 0.9 * s], scale: [1.2, 0.8, 1], color: tint });
      b.lathe('burlap', [{ y: 0, r: 0.15 * s }, { y: 0.1 * s, r: 0.22 * s }, { y: 0.22 * s, r: 0.17 * s }, { y: 0.26 * s, r: 0.05 * s }], { segments: 8, at: [-0.25 * s, 0, 0.95 * s], rot: [0, 0.8, 1.2], color: tint });
      b.box('crate', [0.42 * s, 0.38 * s, 0.42 * s], { at: [-1.0 * s, 0.19 * s, -0.95 * s], rot: [0, 0.6, 0.12], uv: 'fit', color: tint });
      b.lathe('barrel', [{ y: -0.32 * s, r: 0.2 * s }, { y: 0, r: 0.24 * s }, { y: 0.32 * s, r: 0.2 * s }], { segments: 10, capTop: 'wood_planks', capBottom: 'wood_planks', at: [1.3 * s, 0.22 * s, -0.4 * s], rot: [0, 0.4, Math.PI / 2], color: tint });
      boxes.push([-L / 2, L / 2, -Wd / 2 - 0.25 * s, Wd / 2]);
      break;
    }
    case 'timbers':
    case 'barricade': {
      if (kind === 'timbers') {
        // fallen roof beams crossing each other, ends burnt to coals
        const coal = embersMaterial(f);
        let glowing = false;
        for (let i = 0; i < 5; i++) {
          const a = rng.range(-0.7, 0.7) + (i % 2 ? Math.PI / 2 : 0) * 0.6;
          const len = rng.range(1.6, 2.6) * s;
          const cz = (i - 2) * 0.22 * s + rng.range(-0.1, 0.1) * s;
          const h = 0.1 * s + (i % 3) * 0.12 * s;
          const lift = rng.range(0, 0.35) * s;
          const ends = charred && rng.chance(0.5) ? coal : 'wood_planks';
          if (ends === coal) glowing = true;
          b.push([0, h, cz], [0, a, 0]);
          b.tube('wood_planks_dark', [-len / 2, 0, 0], [len / 2, lift, 0], 0.11 * s, 0.1 * s, { segments: 4, capTop: ends, capBottom: ends, twist: 0.78, colorFn: () => tint });
          b.pop();
        }
        if (glowing) emissives.push({ material: coal, ...EMBER_GLOW });
        ring(0.95 * s);
      } else {
        // a barricade: a cheval-de-frise of sharpened stakes, a crate and a barrel heaped against it
        const L = 2.6 * s;
        b.tube('bark', [-L / 2, 0.45 * s, 0], [L / 2, 0.45 * s, 0], 0.13 * s, 0.13 * s, { segments: 7, capTop: 'wood_planks', capBottom: 'wood_planks', color: tint });
        const n = 5;
        for (let i = 0; i < n; i++) {
          const px = -L / 2 + 0.25 * s + (i * (L - 0.5 * s)) / (n - 1);
          for (const d of [-1, 1]) {
            const tipZ = d * 0.85 * s;
            b.tube('bark', [px, 0.02, -tipZ * 0.6], [px + rng.range(-0.05, 0.05) * s, 1.0 * s, tipZ], 0.08 * s, 0.02 * s, { segments: 5, color: tint });
          }
        }
        b.box('crate', [0.6 * s, 0.6 * s, 0.6 * s], { at: [-0.7 * s, 0.3 * s, 0.55 * s], rot: [0, 0.3, 0], uv: 'fit', color: tint });
        b.lathe('barrel', [{ y: 0, r: 0.24 * s }, { y: 0.35 * s, r: 0.29 * s }, { y: 0.7 * s, r: 0.24 * s }], { segments: 10, capTop: 'wood_planks', at: [0.8 * s, 0, 0.6 * s], color: tint });
        b.box('wood_planks', [1.4 * s, 0.06 * s, 0.3 * s], { at: [0.1 * s, 0.75 * s, -0.4 * s], rot: [0.9, 0.2, 0.1], color: tint });
        boxes.push([-L / 2, L / 2, -0.5 * s, 0.5 * s]);
      }
      break;
    }
    case 'wall': {
      // a stub of masonry: a ragged top stepping down, the broken courses showing, rubble below
      const T = 0.45 * s;
      const W = 2.6 * s;
      const cols = Math.max(4, Math.round(W / (0.5 * s)));
      const cw = W / cols;
      const U = f.textures.meta(stone).units[0];
      const peak = rng.int(0, cols - 1);
      for (let i = 0; i < cols; i++) {
        const d = Math.abs(i - peak) / cols;
        const h = Math.max(0.3 * s, (2.2 - d * 2.6 + rng.range(-0.25, 0.25)) * s);
        const cx = -W / 2 + cw * (i + 0.5);
        const off = [-W / 2 + cw * i + U * 0.25, 0];
        b.box(stone, [cw, h, T], { at: [cx, h / 2, 0], faces: { ny: false, pz: { off }, nz: { off: [W / 2 - cw * (i + 1), 0] }, py: { color: [0.82, 0.78, 0.74] } }, color: tint });
      }
      for (let i = 0; i < 7; i++) {
        const a = rng.range(-1.2, 1.2);
        const sz = rng.range(0.18, 0.34) * s;
        f.rockGeom(b, rng.range(-1, 1) * W * 0.45, 0, rng.range(0.35, 0.8) * s * (rng.chance(0.5) ? 1 : -1), [sz * 1.3, sz * 0.75, sz], rng, { top: stone, side: stone, detail: 0, yaw: a, tint });
      }
      decalQuad(b, decal, 'cracks', -0.6 * s, 0.3 * s, 0.4 * s, 1.3 * s, { z: T / 2 + 0.02 });
      boxes.push([-W / 2, W / 2, -T / 2 - 0.1, T / 2 + 0.1]);
      break;
    }
    case 'tent': {
      // a market awning torn down: the back posts still stand, the front ones broke — one snapped
      // off, its top in the dust — and the striped cloth slid down off them in a sagging sheet,
      // its free edge torn; a crate tipped over and the fruit rolled out
      const W2 = 1.1 * s;
      const post = (px, pz, h, lean = 0) => b.tube('wood_planks_dark', [px, 0, pz], [px + lean, h, pz], 0.055 * s, 0.05 * s, { segments: 5, capTop: 'wood_planks', color: tint });
      post(-W2, -0.55 * s, 2.15 * s);
      post(W2, -0.55 * s, 2.15 * s, -0.08 * s);
      post(-W2, 0.65 * s, 1.75 * s, 0.1 * s);
      post(W2, 0.65 * s, 0.7 * s);
      b.tube('wood_planks_dark', [W2 + 0.1 * s, 0.05 * s, 0.9 * s], [W2 + 0.9 * s, 0.05 * s, 1.5 * s], 0.05 * s, 0.05 * s, { segments: 5, capTop: 'wood_planks', color: tint });
      b.box(TRIM, [2 * W2 + 0.1 * s, 0.07 * s, 0.07 * s], { at: [0, 2.1 * s, -0.55 * s], color: tint });
      // the sheet: a 4 × 3 grid hung from the back rail, its front corners falling to the
      // standing front post (left) and to the ground (right)
      const cloth = 'cloth_stripe';
      const nu = 4;
      const nv = 3;
      const P = (u, v) => {
        const x = -W2 + 2 * W2 * u;
        const back = [x, 2.08 * s, -0.55 * s];
        const frontY = (1.7 - 1.6 * u) * s;
        const front = [x + 0.15 * s * u, Math.max(0.04, frontY) + 0.25 * s * Math.sin(u * Math.PI) * 0, 0.7 * s + 0.6 * s * u];
        const sag = 0.28 * s * Math.sin(v * Math.PI) * (0.6 + 0.4 * u);
        return [back[0] + (front[0] - back[0]) * v, back[1] + (front[1] - back[1]) * v - sag, back[2] + (front[2] - back[2]) * v];
      };
      for (let i = 0; i < nu; i++) {
        for (let j = 0; j < nv; j++) {
          // (the last row is torn: some cells are gone)
          if (j === nv - 1 && (i === 1 || (i === 3 && rng.chance(0.5)))) continue;
          const u0 = i / nu;
          const u1 = (i + 1) / nu;
          const v0 = j / nv;
          const v1 = (j + 1) / nv;
          const A = P(u0, v0);
          const B = P(u1, v0);
          const C = P(u1, v1);
          const D = P(u0, v1);
          const uv = [[u0 * 2, 1 - v0], [u1 * 2, 1 - v0], [u1 * 2, 1 - v1], [u0 * 2, 1 - v1]];
          b.quad(cloth, [D, C, B, A], [uv[3], uv[2], uv[1], uv[0]], { color: tint });
          b.quad(cloth, [A, B, C, D], uv, { color: tint.map((c) => c * 0.62) });
        }
      }
      // ragged tongues along the torn edge
      for (let i = 0; i < nu * 2; i++) {
        const u = (i + 0.5) / (nu * 2);
        if (Math.floor(u * nu) === 1) continue;
        const e = P(u - 0.05, 1);
        const f2 = P(u + 0.05, 1);
        const tip = P(u, 1);
        tip[2] += 0.18 * s;
        tip[1] = Math.max(0.03, tip[1] - 0.15 * s);
        b.tri(cloth, e, tip, f2, [0, 0], [0.5, 0.3], [1, 0], { color: tint });
        b.tri(cloth, e, f2, tip, [0, 0], [1, 0], [0.5, 0.3], { color: tint.map((c) => c * 0.62) });
      }
      // a crate tipped on its side, fruit rolled out, an upturned basket
      b.box('crate', [0.5 * s, 0.45 * s, 0.45 * s], { at: [-0.35 * s, 0.25 * s, 1.3 * s], rot: [0, 0.5, Math.PI / 2], uv: 'fit', color: tint });
      b.box(f.extra.material('produce'), [0.6 * s, 0.02, 0.35 * s], { at: [0.25 * s, 0.012, 1.45 * s], rot: [0, 0.3, 0], faces: { ny: false } });
      b.lathe('wood_planks', [{ y: 0, r: 0.2 * s }, { y: 0.24 * s, r: 0.26 * s }, { y: 0.26 * s, r: 0.01 }], { segments: 8, at: [1.0 * s, 0, 0.1 * s], color: tint });
      circles.push([-W2, -0.55 * s, 0.2], [W2, -0.55 * s, 0.2], [-W2, 0.65 * s, 0.2], [W2, 0.65 * s, 0.2]);
      break;
    }
    case 'bones': {
      // a dragon's skeleton lying on its side, bleached by the sun: the spine along the ground (x),
      // vertebrae with their spines, the ribs of the upper side arching up and over the ground
      // behind (−z) like the beams of a fallen hall — some snapped —, a horned skull at the head
      // end, its jaw fallen apart, loose bones round it
      const L = 7.2 * s;
      const bone = BONE.map((c, k) => c * tint[k]);
      const boneDark = bone.map((c) => c * 0.78);
      const B2 = 'whitewash';
      const n = 15;
      /** the spine: tail (−x) to the neck (+x), sinking into the ground at the tail */
      const spine = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const y = (0.12 + 0.42 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.85)) * s;
        spine.push([-L / 2 + L * t, y, (Math.sin(t * 3.1) * 0.35 - (t > 0.82 ? (t - 0.82) * 2.6 : 0)) * s]);
      }
      for (let i = 0; i < n; i++) {
        const [vx, vy, vz] = spine[i];
        const t = i / (n - 1);
        const r = (0.09 + 0.15 * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.8)) * s;
        // the centrum (a spool along the spine) and the dorsal spine pointing to the back (+z, up)
        b.lathe(B2, [{ y: -r * 1.1, r: r * 0.8 }, { y: -r * 0.6, r }, { y: r * 0.6, r }, { y: r * 1.1, r: r * 0.8 }], { segments: 7, at: [vx, vy, vz], rot: [0, 0, Math.PI / 2], color: bone, capTop: true, capBottom: true });
        b.tube(B2, [vx, vy + r * 0.4, vz + r * 0.5], [vx - r * 0.6, vy + r * 1.6, vz + r * 2.6], r * 0.32, r * 0.12, { segments: 5, color: boneDark });
      }
      // the ribs: from the chest's vertebrae, up and over toward −z, the tips sunk in the ground
      for (let i = 4; i < n - 3; i++) {
        const [vx, vy, vz] = spine[i];
        const t = (i - 4) / (n - 8);
        const bell = Math.sin(t * Math.PI);
        const H = (1.3 + 1.5 * bell) * s;
        const R = (1.2 + 0.6 * bell) * s;
        const w = (0.09 + 0.06 * bell) * s;
        const broken = i === 6 || (i === n - 5 && rng.chance(0.6));
        const segs = 9;
        const end = broken ? 0.55 : 1;
        let prev = [vx, vy, vz];
        for (let k = 1; k <= segs; k++) {
          const th = (k / segs) * Math.PI * end;
          const sweep = -0.22 * s * Math.sin(th);
          const p = [vx + sweep, vy + H * Math.sin(th) - (k === segs && !broken ? 0.15 * s : 0), vz - R * (1 - Math.cos(th))];
          const tw = w * (1 - 0.55 * (k / segs));
          b.tube(B2, prev, p, w * (1 - 0.55 * ((k - 1) / segs)), tw, { segments: 5, color: k > segs * 0.6 ? boneDark : bone });
          prev = p;
        }
        if (!broken) circles.push([prev[0], prev[2], 0.32 * s]);
      }
      // the skull at the head end: cranium and a long snout (a lathe along +x), brow ridges, dark
      // sockets, horns swept back, teeth; the lower jaw lying apart
      const [hx, hy, hz] = spine[n - 1];
      const sx = hx + 0.75 * s;
      const sz = hz - 0.15 * s;
      b.push([sx, 0.42 * s, sz], [0, 0.18, 0.08]);
      b.lathe(B2, [{ y: -0.62 * s, r: 0.06 * s }, { y: -0.52 * s, r: 0.4 * s }, { y: -0.1 * s, r: 0.5 * s }, { y: 0.3 * s, r: 0.36 * s }, { y: 0.95 * s, r: 0.24 * s }, { y: 1.35 * s, r: 0.14 * s }, { y: 1.45 * s, r: 0.02 * s }], { segments: 8, rot: [0, 0, -Math.PI / 2], scale: [1, 0.78, 1], color: bone });
      for (const side of [-1, 1]) {
        b.box(TRIM, [0.3 * s, 0.18 * s, 0.06 * s], { at: [0.18 * s, 0.14 * s, side * 0.33 * s], rot: [0, 0, -0.2], color: VOID_BONE });
        b.box(B2, [0.42 * s, 0.08 * s, 0.12 * s], { at: [0.16 * s, 0.27 * s, side * 0.3 * s], rot: [0, side * 0.2, -0.15], color: boneDark });
        // horns: three pieces sweeping back and up, tapering to a point
        const h0 = [-0.35 * s, 0.32 * s, side * 0.25 * s];
        const h1 = [-1.05 * s, 0.75 * s, side * 0.55 * s];
        const h2 = [-1.6 * s, 0.68 * s, side * 0.7 * s];
        const h3 = [-1.95 * s, 0.38 * s, side * 0.72 * s];
        b.tube(B2, h0, h1, 0.16 * s, 0.1 * s, { segments: 6, color: boneDark });
        b.tube(B2, h1, h2, 0.1 * s, 0.05 * s, { segments: 6, color: boneDark });
        b.tube(B2, h2, h3, 0.05 * s, 0.008 * s, { segments: 5, color: boneDark });
        // nostril
        b.box(TRIM, [0.08 * s, 0.05 * s, 0.05 * s], { at: [1.25 * s, 0.06 * s, side * 0.08 * s], color: VOID_BONE });
      }
      for (let k = 0; k < 7; k++) {
        for (const side of [-1, 1]) {
          const tx = 0.35 * s + k * 0.13 * s;
          b.tube(B2, [tx, -0.12 * s, side * (0.24 - k * 0.012) * s], [tx + 0.02 * s, -0.3 * s + (k % 2) * 0.04 * s, side * (0.23 - k * 0.012) * s], 0.035 * s, 0.006 * s, { segments: 4, color: bone });
        }
      }
      b.pop();
      // the lower jaw, fallen apart: two long bones in a V on the ground
      for (const side of [-1, 1]) {
        b.tube(B2, [sx - 0.2 * s, 0.1 * s, sz + 0.7 * s + side * 0.25 * s], [sx + 1.3 * s, 0.06 * s, sz + 1.1 * s + side * 0.08 * s], 0.13 * s, 0.05 * s, { segments: 6, color: bone });
      }
      // loose bones and a claw scattered round
      for (let k = 0; k < 6; k++) {
        const ax = rng.range(-0.5, 0.5) * L;
        const az = rng.range(0.5, 1.4) * s * (rng.chance(0.7) ? 1 : -2.2);
        const a = rng.range(0, Math.PI);
        const l = rng.range(0.4, 0.9) * s;
        b.tube(B2, [ax - Math.cos(a) * l / 2, 0.06 * s, az - Math.sin(a) * l / 2], [ax + Math.cos(a) * l / 2, 0.05 * s, az + Math.sin(a) * l / 2], 0.06 * s, 0.05 * s, { segments: 5, capTop: true, capBottom: true, color: boneDark });
      }
      // the spine and the skull block the way; under the ribs it is open
      for (let i = 1; i < n; i += 3) circles.push([spine[i][0], spine[i][2], 0.42 * s]);
      circles.push([sx + 0.3 * s, sz, 0.75 * s]);
      break;
    }
    default: {
      // rubble: a heap of broken masonry, smaller stones on top, a few roof tiles and a plank
      for (let i = 0; i < 12; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * 0.75 * s;
        const big = 1 - d / (0.85 * s);
        const sz = (0.14 + 0.24 * big * rng.range(0.6, 1)) * s;
        const yy = big * 0.18 * s;
        f.rockGeom(b, Math.cos(a) * d, yy, Math.sin(a) * d, [sz * 1.25, sz * 0.8, sz], rng, { top: stone, side: stone, detail: 0, yaw: a, tint });
      }
      for (let i = 0; i < 4; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0.4, 0.9) * s;
        b.box(charred ? 'roof_charred' : 'roof_terracotta', [0.32 * s, 0.05 * s, 0.22 * s], { at: [Math.cos(a) * d, 0.05 * s + rng.range(0, 0.15) * s, Math.sin(a) * d], rot: [rng.range(-0.4, 0.4), a, rng.range(-0.3, 0.3)], color: tint });
      }
      b.tube('wood_planks_dark', [-0.6 * s, 0.05 * s, 0.4 * s], [0.4 * s, 0.55 * s, -0.1 * s], 0.06 * s, 0.05 * s, { segments: 4, capTop: 'wood_planks', twist: 0.78, colorFn: () => (charred ? CHAR : [0.8, 0.75, 0.72]) });
      ring(0.75 * s);
    }
  }
  if (charred && kind !== 'tent' && kind !== 'bones') scorchDecal(b, decal, 0, 0, 1.25 * s, rng.range(0, Math.PI * 2));
  const group = f.finish(b, 'debris', x, y, z, Number.isFinite(opts.rotation) ? opts.rotation : rng.range(0, Math.PI * 2));
  for (const [x0, x1, z0, z1] of boxes) colliders.push(...f.boxColliders(group, x0, x1, z0, z1));
  for (const [cx, cz, r] of circles) {
    const p = f.world(group, new THREE.Vector3(cx, 0, cz));
    colliders.push({ type: 'circle', x: p.x, z: p.z, r });
  }
  return f.result(group, { colliders, emissives });
}

// ---------------------------------------------------------------------------------------------
// garland
// ---------------------------------------------------------------------------------------------

/** Lantern profile: [y (from its top, down), radius] rings. */
const LANTERN_RINGS = [[0, 0.07], [-0.06, 0.15], [-0.2, 0.18], [-0.34, 0.15], [-0.4, 0.07]];

/**
 * A ribbed paper lantern hanging from (cx, top, cz): 8 sides of quads with explicit UVs into its
 * paper cell (`cell` 0–2 of the 3 × 1 lantern atlas: u runs once around, v from the bottom cap to
 * the top), dark wooden caps.
 */
function lanternGeom(b, paper, cx, top, cz, cell) {
  const segs = 8;
  const R = LANTERN_RINGS;
  const v = (k) => 1 - (14 / 16) * (-R[k][0] / 0.4) - 1 / 16;
  for (let k = 0; k < R.length - 1; k++) {
    const [ya, ra] = R[k];
    const [yb, rb] = R[k + 1];
    for (let j = 0; j < segs; j++) {
      const a0 = (j / segs) * Math.PI * 2;
      const a1 = ((j + 1) / segs) * Math.PI * 2;
      const P = (a, y, r) => [cx + Math.cos(a) * r, top + y, cz - Math.sin(a) * r];
      const u0 = (cell + j / segs) / 3;
      const u1 = (cell + (j + 1) / segs) / 3;
      b.quad(paper, [P(a0, yb, rb), P(a1, yb, rb), P(a1, ya, ra), P(a0, ya, ra)], [[u0, v(k + 1)], [u1, v(k + 1)], [u1, v(k)], [u0, v(k)]]);
    }
  }
  b.lathe(TRIM, [{ y: top - 0.43, r: 0.06 }, { y: top - 0.4, r: 0.075 }], { segments: 6, capBottom: true });
  b.lathe(TRIM, [{ y: top, r: 0.075 }, { y: top + 0.03, r: 0.05 }], { segments: 6, capTop: true });
}

/** Pennant colours (vertex tints over the `linen` weave): crimson, saffron, sky, sage, cream. */
const PENNANT_TINTS = [[1.05, 0.28, 0.24], [1.15, 0.8, 0.22], [0.36, 0.58, 1.05], [0.42, 0.82, 0.4], [1.12, 1.06, 0.92]];

/**
 * A garland: a sagging rope between (x0, z0) and (x1, z1) at `height` above the ground (3.4) with
 * pennants (two-sided triangles and swallow-tails in five festival colours), paper lanterns (they
 * glow their own colours at night) or both, on two posts with a cross-arm unless `posts` is false.
 * No collider but the posts'.
 * @param {PropFactory} f
 * @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1
 * @param {number} y ground height (at the midpoint)
 * @param {{ kind?: string, sag?: number, posts?: boolean, height?: number, seed?: number, id?: string }} [opts]
 * @returns {PropResult}
 */
export function buildGarland(f, x0, z0, x1, z1, y, opts = {}) {
  const kind = ['pennants', 'lanterns', 'both'].includes(opts.kind) ? opts.kind : 'pennants';
  const sag = num(opts.sag, 0.5, 0, 2);
  const H = num(opts.height, 3.4, 1, 12);
  const rng = f.rng('garland', (x0 + x1) / 2, (z0 + z1) / 2, opts.seed);
  const dx = Number.isFinite(x1 - x0) ? x1 - x0 : 0;
  const dz = Number.isFinite(z1 - z0) ? z1 - z0 : 0;
  const L = clamp(Math.hypot(dx, dz), 0.01, 60);
  const yaw = -Math.atan2(dz, dx); // local +X = the run
  const b = f.builder();
  const at = (t) => [-L / 2 + L * t, H - sag * 4 * t * (1 - t)];
  // the rope, a little thicker toward the posts
  const segs = Math.max(2, Math.round(L / 0.6));
  for (let i = 0; i < segs; i++) {
    const [ax, ay] = at(i / segs);
    const [bx, by] = at((i + 1) / segs);
    b.tube('rope', [ax, ay, 0], [bx, by, 0], 0.028, 0.028, { segments: 4 });
  }
  if (opts.posts !== false) {
    for (const px of [-L / 2, L / 2]) {
      b.box('wood_planks_dark', [0.16, H + 0.3, 0.16], { at: [px, (H + 0.3) / 2, 0], rotUV: true });
      b.box('wood_planks_dark', [0.5, 0.1, 0.1], { at: [px, H + 0.05, 0], rot: [0, Math.PI / 2, 0] });
      b.box('stone_brick', [0.34, 0.2, 0.34], { at: [px, 0.1, 0], faces: { ny: false } });
    }
  }
  const lanterns = kind !== 'pennants';
  const paper = lanterns ? lanternPaperMaterial(f) : null;
  const n = Math.max(1, Math.round(L / (kind === 'lanterns' ? 1.1 : 0.55)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const [px, py] = at(t);
    const lantern = kind === 'lanterns' || (kind === 'both' && i % 3 === 0);
    if (lantern) {
      // a paper lantern on a short cord, its paper picked per lantern (one of three atlas cells)
      b.box('rope', [0.02, 0.12, 0.02], { at: [px, py - 0.06, 0] });
      lanternGeom(b, paper, px, py - 0.12, 0, rng.int(0, 2));
    } else {
      // a pennant hanging from the rope (both faces), every fourth a swallow-tail
      const c = PENNANT_TINTS[(i + rng.int(0, 4)) % PENNANT_TINTS.length];
      const w = 0.19;
      const len = rng.range(0.38, 0.48);
      const sw = rng.range(-0.05, 0.05);
      const A = [px - w, py - 0.02, 0];
      const B = [px + w, py - 0.02, 0];
      if (i % 4 === 2) {
        const C1 = [px - w * 0.7 + sw, py - len, 0];
        const M = [px + sw, py - len * 0.6, 0];
        const C2 = [px + w * 0.7 + sw, py - len, 0];
        for (const back of [false, true]) {
          const col = back ? c.map((v) => v * 0.78) : c;
          if (back) b.quad('linen', [A, B, C2, C1], [[0, 1], [1, 1], [0.85, 0], [0.15, 0]], { color: col });
          else b.quad('linen', [A, C1, C2, B], [[0, 1], [0.15, 0], [0.85, 0], [1, 1]], { color: col });
          if (back) b.tri('linen', C1, C2, M, [0.15, 0], [0.85, 0], [0.5, 0.4], { color: col.map((v) => v * 0.6) });
        }
      } else {
        const C = [px + sw, py - len, 0];
        b.tri('linen', A, C, B, [0, 1], [0.5, 0], [1, 1], { color: c });
        b.tri('linen', A, B, C, [0, 1], [1, 1], [0.5, 0], { color: c.map((v) => v * 0.78) });
      }
    }
  }
  const group = f.finish(b, 'garland', (x0 + x1) / 2, y, (z0 + z1) / 2, yaw);
  /** @type {Collider[]} */
  const colliders = [];
  if (opts.posts !== false) for (const px of [-L / 2, L / 2]) { const p = f.world(group, new THREE.Vector3(px, 0, 0)); colliders.push({ type: 'circle', x: p.x, z: p.z, r: 0.18 }); }
  return f.result(group, { colliders, emissives: paper ? [{ material: paper, day: 0.08, night: 1.5 }] : [] });
}
