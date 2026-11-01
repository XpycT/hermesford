import { TILE_TYPES, charToLevel } from './LevelFormat.js';
import { fbm2 } from '../utils/math.js';
import { ownValue } from '../utils/own.js';

/** @import { Level } from './types.js' */

/**
 * LevelMap — a painted top-down map of a Luminati level (for the HUD minimap and the world map):
 * tile colours from TILE_TYPES (custom legend chars by their top texture / water flag), relief
 * shading by height (lit from the north-west, darker cliff faces on the south / east drops),
 * water with light shores, the blocked forest as tree crowns, then the level's objects: house
 * and windmill footprints in their roof colours, bridges, fences, trees, crags, wells, market stalls,
 * campfires, and on combat levels the treasure chests (gold squares) and waystones (cyan
 * diamonds). A faint warm wash and paper grain tie it to the gold-and-parchment UI.
 *
 * Rendered once into a canvas (the level data only — no scene, no WebGL); the minimap then just
 * pans / scales that image.
 */

/**
 * The object types `renderLevelMap` paints (keep in step with the object passes at its end): a
 * live story prop of another type coming or going leaves the painted map as it is (World.applyStory
 * → `mapChanged`).
 */
export const LEVEL_MAP_TYPES = new Set(['fence', 'bridge', 'tree', 'rock', 'haystack', 'house', 'windmill', 'marketStall', 'well', 'campfire', 'chest', 'waystone', 'crag', 'belfry', 'ship']);

const ROOF_COLORS = {
  roof_red: '#a4493b', roof_blue: '#4a638c', roof_thatch: '#b89452', roof_slate: '#5b606f',
  // Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §5.3)
  roof_terracotta: '#b65a32', roof_charred: '#3a302a',
};
/** Crown colours by tree kind (an unknown kind: the oak's). */
const TREE_COLORS = {
  oak: '#3e7536', autumn: '#b5652e', pine: '#2d5a36', birch: '#6f9a48',
  juniper: '#4a6a3a', deadwood: '#8a7656', palm: '#5c8c3a', cypress: '#2a4a2e',
  // The Bells of Evermere (EVERMERE_CAMPAIGN.md §5.3)
  blossom: '#e6c4d4', maple: '#b8402a', goldbirch: '#d0a040', snowpine: '#4a6a5e', bare: '#7a6a58',
};
/** A crag's colour by its stone. */
const STONE_COLORS = { sandstone: '#c49a62', redrock: '#a8553a', basalt: '#3c3a42', ice: '#8fd6ea' };
/**
 * Flat colours of the arid tops (DRAGON_CAMPAIGN.md §6.2: textures a level's legend names, no
 * TILE_TYPES of their own).
 */
const ARID_TOP_COLORS = {
  arid_dirt: '#b8894f', cracked_earth: '#a8754a', dry_grass: '#bea052', red_sand: '#c46a36', sandstone: '#c8a46c',
  scree: '#8e7c66', flagstone: '#b49c74', scorched: '#3e342a', basalt: '#34343e', ash: '#6e6a66',
};
const TOP_COLORS = { ...Object.fromEntries(TILE_TYPES.filter((t) => t.def.top && !t.def.water).map((t) => [t.def.top, t.color])), ...ARID_TOP_COLORS };

/**
 * Add flat colours of a lazily registered texture set's tops (the season kit's: props/
 * SeasonTrees.js — EVERMERE_CAMPAIGN.md §6.2). Additive.
 * @param {Record<string, string>} colors top texture → CSS colour
 */
export function registerTopColors(colors) {
  Object.assign(TOP_COLORS, colors);
}
const WATER = '#3b7fa6';
const CLIFF = [74, 60, 50];
const PAPER = [236, 222, 184];

const hex = (c) => {
  const s = String(c).replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/./g, (x) => x + x) : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const clamp8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
/** Tiny deterministic hash → [0, 1). */
const hash = (x, y) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * @param {Level} level a normalised Luminati level
 * @param {{ pixelsPerTile?: number }} [opts] pixelsPerTile: default from the level size
 *   (≈ 768 px for the longer side, 4–12 px per tile)
 * @returns {{ canvas: HTMLCanvasElement, pixelsPerTile: number, width: number, depth: number }}
 *   world (x, z) ↦ canvas (x · pixelsPerTile, z · pixelsPerTile)
 */
export function renderLevelMap(level, opts = {}) {
  const W = level.width;
  const D = level.depth;
  const ppt = Math.max(2, Math.round(opts.pixelsPerTile ?? Math.min(12, Math.max(4, 768 / Math.max(W, D)))));
  const canvas = document.createElement('canvas');
  canvas.width = W * ppt;
  canvas.height = D * ppt;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  const px = img.data;

  // ---- per-tile colour, height and kind ----
  const legend = level.legend ?? {};
  const kind = new Uint8Array(W * D); // 0 void, 1 ground, 2 water, 3 forest, 4 path, 5 rock
  const lvl = new Int16Array(W * D);
  const col = new Array(W * D);
  const byChar = new Map(TILE_TYPES.map((t) => [t.char, t]));
  const colorOf = new Map();
  for (let j = 0; j < D; j++) {
    const row = level.tiles[j] ?? '';
    const hrow = level.heights?.[j] ?? '';
    for (let i = 0; i < W; i++) {
      const ch = row[i] ?? ' ';
      const def = legend[ch] ?? byChar.get(ch)?.def;
      const k = j * W + i;
      lvl[k] = charToLevel(hrow[i] ?? '0');
      if (!def || def.void) { kind[k] = 0; continue; }
      let c = colorOf.get(ch);
      if (!c) {
        const known = byChar.get(ch);
        c = hex(known && JSON.stringify(known.def) === JSON.stringify(def) ? known.color
          : def.water ? WATER : ownValue(TOP_COLORS, def.top) ?? '#6f8a55');
        colorOf.set(ch, c);
      }
      col[k] = c;
      const cat = byChar.get(ch)?.category;
      kind[k] = def.water ? 2 : ch === 'T' ? 3 : def.walkable === false ? 5 : cat === 'path' || cat === 'stairs' ? 4 : 1;
    }
  }
  const at = (i, j) => (i >= 0 && j >= 0 && i < W && j < D ? j * W + i : -1);
  // low-frequency tint (meadows are never one flat green), sampled at tile corners and blended
  const tint = new Float32Array((W + 1) * (D + 1));
  for (let j = 0; j <= D; j++) for (let i = 0; i <= W; i++) tint[j * (W + 1) + i] = fbm2(i / 6, j / 6, { octaves: 3, seed: 71 });
  const lv = (i, j, d) => { const k = at(i, j); return k < 0 || !kind[k] ? d : lvl[k]; };

  // ---- pixels ----
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const kd = kind[k];
      const h = lvl[k];
      let r;
      let g;
      let b;
      if (!kd) { r = 18; g = 16; b = 24; } else [r, g, b] = col[k];
      // relief: brighter with height, lit from the north-west
      const nw = lv(i - 1, j - 1, h);
      const lit = kd === 2 ? 1 : (0.84 + Math.min(0.3, h * 0.022)) * (1 + Math.max(-0.26, Math.min(0.24, (h - nw) * 0.09)));
      const t00 = tint[j * (W + 1) + i];
      const t10 = tint[j * (W + 1) + i + 1];
      const t01 = tint[(j + 1) * (W + 1) + i];
      const t11 = tint[(j + 1) * (W + 1) + i + 1];
      const dropS = h - lv(i, j + 1, h);
      const dropE = h - lv(i + 1, j, h);
      const dropW = h - lv(i - 1, j, h);
      const wetN = at(i, j - 1) >= 0 && kind[at(i, j - 1)] !== 2;
      for (let y = 0; y < ppt; y++) {
        for (let x = 0; x < ppt; x++) {
          const gx = i * ppt + x;
          const gy = j * ppt + y;
          const n = hash(gx, gy);
          const u = (x + 0.5) / ppt;
          const v = (y + 0.5) / ppt;
          const tn = (t00 * (1 - u) + t10 * u) * (1 - v) + (t01 * (1 - u) + t11 * u) * v;
          let f = lit * (0.95 + n * 0.1) * (kd === 1 || kd === 3 ? 0.84 + tn * 0.32 : 0.94 + tn * 0.12);
          let rr = r;
          let gg = g;
          let bb = b;
          if (kd === 2) {
            // water: ripple dither, lighter shallows along the shores
            const shore = (x === 0 && at(i - 1, j) >= 0 && kind[at(i - 1, j)] !== 2) || (y === 0 && wetN)
              || (x === ppt - 1 && at(i + 1, j) >= 0 && kind[at(i + 1, j)] !== 2) || (y === ppt - 1 && at(i, j + 1) >= 0 && kind[at(i, j + 1)] !== 2);
            f = shore ? 1.28 : ((gx + gy * 3) % 7 === 0 && n > 0.6 ? 1.14 : 0.97 + n * 0.05);
          } else if (kd === 3) {
            // forest: crowded crowns (dark, with a lit north-west rim)
            const cx = (gx % 4) - 1.5;
            const cy = (gy % 4) - 1.5;
            const d = cx * cx + cy * cy;
            f *= d < 1.2 ? (cx + cy < -0.6 ? 1.25 : 1.05) : 0.72;
          } else if (kd === 1 && n > 0.93) f *= 0.84; // grass speckle
          // cliff faces: a dark band along the south / east / west edges above a drop
          if (dropS > 0 && y >= ppt - Math.min(ppt - 1, Math.max(1, Math.round(dropS * ppt * 0.25)))) { rr = CLIFF[0]; gg = CLIFF[1]; bb = CLIFF[2]; f = 0.9 + n * 0.15; }
          else if (dropE > 0 && x === ppt - 1) f *= 0.72;
          else if (dropW > 0 && x === 0) f *= 0.86;
          const o = (gy * canvas.width + gx) * 4;
          // a warm, slightly muted wash toward the parchment tone
          px[o] = clamp8((rr * f) * 0.88 + PAPER[0] * 0.12);
          px[o + 1] = clamp8((gg * f) * 0.88 + PAPER[1] * 0.12);
          px[o + 2] = clamp8((bb * f) * 0.88 + PAPER[2] * 0.12);
          px[o + 3] = kd ? 255 : 0;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  // ---- objects ----
  const S = ppt;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const objs = Array.isArray(level.objects) ? level.objects : [];
  const rect = (o, w, d, fill, edge) => {
    ctx.save();
    ctx.translate(o.x * S, o.z * S);
    ctx.rotate(-(o.rotation ?? 0));
    ctx.fillStyle = 'rgba(20, 14, 10, 0.45)';
    ctx.fillRect((-w / 2) * S + 1, (-d / 2) * S + 1.5, w * S, d * S); // drop shadow
    ctx.fillStyle = fill;
    ctx.fillRect((-w / 2) * S, (-d / 2) * S, w * S, d * S);
    ctx.strokeStyle = edge;
    ctx.lineWidth = Math.max(1, S * 0.22);
    ctx.strokeRect((-w / 2) * S, (-d / 2) * S, w * S, d * S);
    // ridge highlight
    ctx.strokeStyle = 'rgba(255, 236, 196, 0.35)';
    ctx.lineWidth = Math.max(1, S * 0.18);
    ctx.beginPath();
    ctx.moveTo((-w / 2) * S + 1, 0);
    ctx.lineTo((w / 2) * S - 1, 0);
    ctx.stroke();
    ctx.restore();
  };
  const dot = (x, z, r, fill, edge) => {
    ctx.beginPath();
    ctx.arc(x * S, z * S, r * S, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1, S * 0.14); ctx.stroke(); }
  };
  const line = (o, width, color, under) => {
    if (under) {
      ctx.strokeStyle = under;
      ctx.lineWidth = width * S + 2;
      ctx.beginPath(); ctx.moveTo(o.x0 * S, o.z0 * S); ctx.lineTo(o.x1 * S, o.z1 * S); ctx.stroke();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, width * S);
    ctx.beginPath(); ctx.moveTo(o.x0 * S, o.z0 * S); ctx.lineTo(o.x1 * S, o.z1 * S); ctx.stroke();
  };
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  // flat things first, then trees, then buildings on top
  for (const o of objs) {
    if (o.type === 'fence' && [o.x0, o.z0, o.x1, o.z1].every(Number.isFinite)) line(o, 0.14, '#6b4a2e');
    else if (o.type === 'bridge' && [o.x0, o.z0, o.x1, o.z1].every(Number.isFinite)) line(o, num(o.opts?.width, 2), '#a77a48', 'rgba(40, 26, 14, 0.8)');
  }
  for (const o of objs) {
    if (!Number.isFinite(o.x) || !Number.isFinite(o.z)) continue;
    if (o.type === 'tree') {
      const c = ownValue(TREE_COLORS, o.opts?.kind) ?? TREE_COLORS.oak;
      dot(o.x + 0.12, o.z + 0.18, 0.72, 'rgba(16, 24, 12, 0.35)');
      dot(o.x, o.z, 0.7, c, 'rgba(20, 30, 16, 0.7)');
      dot(o.x - 0.2, o.z - 0.22, 0.26, 'rgba(255, 255, 210, 0.22)');
    } else if (o.type === 'rock') dot(o.x, o.z, 0.35 * num(o.opts?.size, 1), '#8a8580', 'rgba(30, 28, 30, 0.6)');
    else if (o.type === 'haystack') dot(o.x, o.z, 0.55, '#d3b25c', 'rgba(60, 44, 16, 0.6)');
    else if (o.type === 'crag') dot(o.x, o.z, Math.max(0.6, num(o.opts?.width, 2.5) * 0.45), ownValue(STONE_COLORS, o.opts?.stone) ?? STONE_COLORS.sandstone, 'rgba(30, 20, 14, 0.8)');
  }
  for (const o of objs) {
    if (!Number.isFinite(o.x) || !Number.isFinite(o.z)) continue;
    switch (o.type) {
      case 'house':
        rect(o, num(o.opts?.width, 4), num(o.opts?.depth, 3), ownValue(ROOF_COLORS, o.opts?.roof) ?? ROOF_COLORS.roof_red, 'rgba(30, 18, 12, 0.9)');
        break;
      case 'windmill':
        dot(o.x, o.z, 1.3, ownValue(ROOF_COLORS, o.opts?.roof) ?? ROOF_COLORS.roof_thatch, 'rgba(30, 18, 12, 0.9)');
        ctx.strokeStyle = 'rgba(245, 232, 200, 0.85)';
        ctx.lineWidth = Math.max(1, S * 0.2);
        ctx.beginPath();
        ctx.moveTo((o.x - 1.6) * S, (o.z - 1.6) * S); ctx.lineTo((o.x + 1.6) * S, (o.z + 1.6) * S);
        ctx.moveTo((o.x + 1.6) * S, (o.z - 1.6) * S); ctx.lineTo((o.x - 1.6) * S, (o.z + 1.6) * S);
        ctx.stroke();
        break;
      case 'marketStall':
        rect(o, num(o.opts?.width, 3), 1.4, '#c8574a', 'rgba(40, 20, 14, 0.85)');
        break;
      // The Bells of Evermere: a belfry's square tower, a ship's hull
      case 'belfry':
        rect(o, 2.2, 2.2, ROOF_COLORS.roof_slate, 'rgba(20, 18, 24, 0.9)');
        break;
      case 'ship':
        rect(o, 2.4, 6.5, '#8a6440', 'rgba(30, 18, 12, 0.9)');
        break;
      case 'well':
        dot(o.x, o.z, 0.75, '#9a948c', 'rgba(30, 26, 26, 0.85)');
        dot(o.x, o.z, 0.35, '#2f5f82');
        break;
      case 'campfire':
        dot(o.x, o.z, 0.55, '#f0913a', 'rgba(60, 20, 8, 0.8)');
        break;
      case 'chest': {
        // a gold square (at least 3 px, turned with the chest)
        const s = Math.max(3, 0.8 * S);
        ctx.save();
        ctx.translate(o.x * S, o.z * S);
        ctx.rotate(-(o.rotation ?? 0));
        ctx.fillStyle = 'rgba(20, 14, 10, 0.5)';
        ctx.fillRect(-s / 2 + 1, -s / 2 + 1.5, s, s);
        ctx.fillStyle = '#e8c35a';
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.strokeStyle = 'rgba(70, 44, 12, 0.95)';
        ctx.lineWidth = Math.max(1, S * 0.14);
        ctx.strokeRect(-s / 2, -s / 2, s, s);
        ctx.restore();
        break;
      }
      case 'waystone': {
        // a cyan diamond with a pale core
        const r = Math.max(2.5, 0.75 * S);
        const diamond = (k) => {
          ctx.beginPath();
          ctx.moveTo(o.x * S, o.z * S - r * k); ctx.lineTo(o.x * S + r * 0.72 * k, o.z * S);
          ctx.lineTo(o.x * S, o.z * S + r * k); ctx.lineTo(o.x * S - r * 0.72 * k, o.z * S);
          ctx.closePath();
        };
        diamond(1);
        ctx.fillStyle = '#5fcbe6';
        ctx.fill();
        ctx.strokeStyle = 'rgba(12, 40, 56, 0.95)';
        ctx.lineWidth = Math.max(1, S * 0.14);
        ctx.stroke();
        diamond(0.42);
        ctx.fillStyle = '#e4fbff';
        ctx.fill();
        break;
      }
      default:
    }
  }
  return { canvas, pixelsPerTile: ppt, width: W, depth: D };
}
