import { clamp } from '../utils/math.js';

/** @import { Collider } from './TileMap.js' */

/**
 * WaterShore — the shore / depth / flow texture bake of Water.js as a pure function of typed
 * arrays (no three.js, no TileMap), so it runs unchanged on the main thread (Water) or in a Web
 * Worker (the level editor re-bakes edited areas off the main thread). Byte-identical either way.
 *
 * @typedef {object} ShoreInput
 * @property {number} width      map width in tiles
 * @property {number} depth      map depth in tiles
 * @property {number} R          texels per tile
 * @property {Float32Array} surf per-tile water surface (NaN = no water), width × depth
 * @property {Float32Array} flow per-tile flow (x, z), width × depth × 2
 * @property {Float64Array} bed  per-tile bed height of the water tiles (TileMap tile.h)
 * @property {Collider[]} colliders TileMap colliders
 * @property {number} maxDistance @property {number} maxDepth @property {number} maxFlow
 */

/**
 * Bake distance-to-shore (R), depth (G) and flow (BA) for the texel window
 * [a0, a0 + W) × [b0, b0 + H), with the window edges treated as the texture edges (the whole
 * texture is the window (0, 0, width × R, depth × R)).
 * @param {ShoreInput} input
 * @param {number} a0 first texel column of the window
 * @param {number} b0 first texel row of the window
 * @param {number} W window width in texels
 * @param {number} H window height in texels
 * @returns {Uint8Array} RGBA bytes of the window
 */
export function bakeShore(input, a0, b0, W, H) {
  const { width, R, colliders: cols, maxDistance, maxDepth, maxFlow } = input;
  const surfT = input.surf;
  const flowT = input.flow;
  const bedT = input.bed;
  const N = W * H;
  const surf = new Float32Array(N).fill(NaN);
  const depth = new Float32Array(N);
  const fx = new Float32Array(N);
  const fz = new Float32Array(N);
  const tilesDeep = input.depth;
  const surfAt = (i, j) => (i < 0 || j < 0 || i >= width || j >= tilesDeep ? NaN : surfT[j * width + i]);
  // colliders per wet tile of the window (a texel is blocked when any collider contains its
  // centre — the per-tile lists give the same answer without testing every collider per texel)
  const ti0 = Math.floor(a0 / R);
  const tj0 = Math.floor(b0 / R);
  const tw = Math.floor((a0 + W - 1) / R) - ti0 + 1;
  const th = Math.floor((b0 + H - 1) / R) - tj0 + 1;
  const tileCols = new Array(Math.max(0, tw * th)).fill(null);
  for (let k = 0; k < cols.length; k++) {
    const c = cols[k];
    const circ = c.type === 'circle';
    const x0 = circ ? c.x - c.r : c.minX;
    const x1 = circ ? c.x + c.r : c.maxX;
    const z0 = circ ? c.z - c.r : c.minZ;
    const z1 = circ ? c.z + c.r : c.maxZ;
    if (!(x1 > x0 && z1 > z0)) continue; // (also skips NaN / parked colliders: they contain nothing)
    const i0 = Math.max(ti0, Math.floor(x0));
    const i1 = Math.min(ti0 + tw - 1, Math.floor(x1));
    const j0 = Math.max(tj0, Math.floor(z0));
    const j1 = Math.min(tj0 + th - 1, Math.floor(z1));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const s = surfAt(i, j);
        if (s !== s) continue;
        const t = (j - tj0) * tw + (i - ti0);
        (tileCols[t] ??= []).push(c);
      }
    }
  }
  for (let lb = 0; lb < H; lb++) {
    const b = b0 + lb;
    const j = Math.floor(b / R);
    const z = (b + 0.5) / R;
    for (let la = 0; la < W; la++) {
      const a = a0 + la;
      const i = Math.floor(a / R);
      const s = surfAt(i, j);
      if (s !== s) continue;
      const x = (a + 0.5) / R;
      let blocked = false;
      const tc = tileCols[(j - tj0) * tw + (i - ti0)] ?? EMPTY;
      for (let k = 0; k < tc.length && !blocked; k++) {
        const c = tc[k];
        if (c.type === 'circle') blocked = (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r;
        else blocked = x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ;
      }
      if (blocked) continue;
      const p = lb * W + la;
      const k = j * width + i;
      surf[p] = s;
      depth[p] = Math.max(0, s - bedT[k]);
      fx[p] = flowT[k * 2];
      fz[p] = flowT[k * 2 + 1];
    }
  }
  // Chamfer distance transform (texels) from dry texels and water-level boundaries.
  const INF = 1e9;
  const dist = new Float32Array(N);
  for (let b = 0; b < H; b++) {
    for (let a = 0; a < W; a++) {
      const p = b * W + a;
      const s = surf[p];
      if (s !== s) { dist[p] = 0; continue; }
      let seed = false;
      if (a > 0) { const q = surf[p - 1]; if (q === q && Math.abs(q - s) > 0.01) seed = true; }
      if (a < W - 1) { const q = surf[p + 1]; if (q === q && Math.abs(q - s) > 0.01) seed = true; }
      if (b > 0) { const q = surf[p - W]; if (q === q && Math.abs(q - s) > 0.01) seed = true; }
      if (b < H - 1) { const q = surf[p + W]; if (q === q && Math.abs(q - s) > 0.01) seed = true; }
      dist[p] = seed ? 0.5 : INF;
    }
  }
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let b = 0; b < H; b++) {
    for (let a = 0; a < W; a++) {
      const p = b * W + a;
      let d = dist[p];
      if (d === 0) continue;
      if (a > 0) d = Math.min(d, dist[p - 1] + D1);
      if (b > 0) {
        d = Math.min(d, dist[p - W] + D1);
        if (a > 0) d = Math.min(d, dist[p - W - 1] + D2);
        if (a < W - 1) d = Math.min(d, dist[p - W + 1] + D2);
      }
      dist[p] = d;
    }
  }
  for (let b = H - 1; b >= 0; b--) {
    for (let a = W - 1; a >= 0; a--) {
      const p = b * W + a;
      let d = dist[p];
      if (d === 0) continue;
      if (a < W - 1) d = Math.min(d, dist[p + 1] + D1);
      if (b < H - 1) {
        d = Math.min(d, dist[p + W] + D1);
        if (a < W - 1) d = Math.min(d, dist[p + W + 1] + D2);
        if (a > 0) d = Math.min(d, dist[p + W - 1] + D2);
      }
      dist[p] = d;
    }
  }
  for (let p = 0; p < N; p++) dist[p] = Math.min(dist[p] / R, maxDistance);
  const wet = (p) => surf[p] === surf[p];
  blur(dist, W, H, 1, 2, wet);
  blur(depth, W, H, Math.max(1, R >> 1), 2, null);
  blur(fx, W, H, Math.max(1, R >> 1), 2, null);
  blur(fz, W, H, Math.max(1, R >> 1), 2, null);

  const data = new Uint8Array(N * 4);
  const mf = maxFlow;
  for (let p = 0; p < N; p++) {
    data[p * 4] = Math.round(clamp(dist[p] / maxDistance) * 255);
    data[p * 4 + 1] = Math.round(clamp(depth[p] / maxDepth) * 255);
    data[p * 4 + 2] = Math.round(clamp(fx[p] / mf * 0.5 + 0.5) * 255);
    data[p * 4 + 3] = Math.round(clamp(fz[p] / mf * 0.5 + 0.5) * 255);
  }
  return data;
}

const EMPTY = [];

/**
 * Separable box blur in place. With `keep` given, only texels where keep(p) is true are
 * written (dry texels keep their value so the shore stays at distance 0).
 */
function blur(f, W, H, r, passes, keep) {
  const tmp = new Float32Array(f.length);
  for (let it = 0; it < passes; it++) {
    for (let b = 0; b < H; b++) {
      for (let a = 0; a < W; a++) {
        let s = 0;
        let c = 0;
        for (let k = -r; k <= r; k++) {
          const x = a + k;
          if (x < 0 || x >= W) continue;
          s += f[b * W + x];
          c++;
        }
        tmp[b * W + a] = s / c;
      }
    }
    for (let b = 0; b < H; b++) {
      for (let a = 0; a < W; a++) {
        const p = b * W + a;
        if (keep && !keep(p)) continue;
        let s = 0;
        let c = 0;
        for (let k = -r; k <= r; k++) {
          const y = b + k;
          if (y < 0 || y >= H) continue;
          s += tmp[y * W + a];
          c++;
        }
        f[p] = s / c;
      }
    }
  }
}
