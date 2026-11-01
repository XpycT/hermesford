/**
 * The building textures of Vanquish the Evil Dragon's village (docs/contracts/DRAGON_CAMPAIGN.md
 * §5.3, §6.3; the design notes: docs/design/SIEGE_AND_FESTIVAL.md): walls `adobe`,
 * `sandstone_brick`, `whitewash`, `charred_wall` (ObjectCatalog WALL_TEXTURES) and roofs
 * `roof_terracotta`, `roof_charred` (ROOF_TEXTURES; their names start with `roof_`, so the snow
 * cover applies to them as to every roof). Registered by name in the TextureLibrary's definitions
 * (../Textures.js), painted on demand — none is in TEXTURE_NAMES, so a level without them paints
 * nothing new. Owner: the siege package.
 *
 * Layout (the notes at the top of ../Textures.js): canvas up = world up on walls; roofs: canvas up =
 * toward the ridge, two tile courses per unit (8 px each). Sizes: the plaster-like walls (adobe,
 * whitewash) are 64 × 64 px (4 × 4 units) like `plaster`, so a long wall does not repeat visibly;
 * the masonry (sandstone_brick, charred_wall) 32 × 32 (2 × 2 units) in 8 px block rows, which line
 * up with LEVEL_HEIGHT and the house plinth like `stone_brick`; the roofs 32 × 32.
 *
 * Every painter works like the library's own: colour from hue-shifted ramps (cool, saturated
 * shadows, warm highlights), a height field painted alongside (→ the normal map, so the relief
 * answers the sun and the fires), the key light from the upper left baked subtly into the forms,
 * seeded from the texture's own seed (`ctx.rng`, `ctx.seed`) only — the same pixels every run.
 * `roof_charred` carries an emissive mask (a few ember-red cracks glow faintly).
 *
 * @import { TextureKit, TexDef } from '../Textures.js'
 */

const mod = (a, n) => ((a % n) + n) % n;

/**
 * Rows of blocks in running bond, rasterised into an id map and an inner distance (px from the
 * block border; the mortar gap of 1 px sits at each block's right and bottom). The joints of
 * neighbouring rows are kept apart. Periodic (the texture tiles).
 * @param {number} w @param {number} h
 * @param {number} rowH block row height (px)
 * @param {number} minW @param {number} maxW block widths
 * @param {import('../../utils/math.js').RNG} rng
 * @param {(b: { x: number, y: number, w: number, h: number }) => number[]} [corner] per-corner
 *   rounding radii [tl, tr, bl, br]
 */
function masonry(w, h, rowH, minW, maxW, rng, corner = null) {
  const id = new Int32Array(w * h).fill(-1);
  const dist = new Float32Array(w * h);
  /** @type {{ x: number, y: number, w: number, h: number, index: number }[]} */
  const blocks = [];
  let prev = [];
  for (let y0 = 0; y0 < h; y0 += rowH) {
    // widths that sum to w exactly
    const widths = [];
    let rem = w;
    while (rem > 0) {
      if (rem <= maxW) {
        if (rem < minW && widths.length) widths[widths.length - 1] += rem;
        else widths.push(rem);
        break;
      }
      const bw = rng.int(minW, Math.min(maxW, rem - minW));
      widths.push(bw);
      rem -= bw;
    }
    // the offset whose joints are farthest from the previous row's
    let best = 0;
    let bestD = -1;
    for (let t = 0; t < 16; t++) {
      const off = rng.int(0, w - 1);
      const joints = [];
      let x = off;
      for (const bw of widths) { joints.push(mod(x, w)); x += bw; }
      let d = 99;
      for (const p of joints) for (const q of prev) { const a = Math.abs(p - q); d = Math.min(d, a, w - a); }
      if (d > bestD) { bestD = d; best = off; }
      if (d >= 4) break;
    }
    let x = best;
    const joints = [];
    for (const bw of widths) {
      joints.push(mod(x, w));
      const b = { x, y: y0, w: bw, h: rowH, index: blocks.length };
      blocks.push(b);
      const iw = bw - 1;
      const ih = rowH - 1;
      const rr = corner ? corner(b) : [0, 0, 0, 0];
      for (let v = 0; v < ih; v++) {
        for (let u = 0; u < iw; u++) {
          const fx = u + 0.5;
          const fy = v + 0.5;
          let d = Math.min(fx, fy, iw - fx, ih - fy);
          const left = fx < iw / 2;
          const top = fy < ih / 2;
          const r = rr[(top ? 0 : 2) + (left ? 0 : 1)];
          if (r > 0) {
            const ccx = left ? r : iw - r;
            const ccy = top ? r : ih - r;
            if ((left ? fx < ccx : fx > ccx) && (top ? fy < ccy : fy > ccy)) {
              const e = Math.hypot(fx - ccx, fy - ccy);
              if (e > r) continue;
              d = Math.min(d, r - e + 0.5);
            }
          }
          const i = mod(y0 + v, h) * w + mod(x + u, w);
          id[i] = b.index;
          dist[i] = d;
        }
      }
      x += bw;
    }
    prev = joints;
  }
  return { id, dist, blocks };
}

/** A seeded random-walk crack (dark line, an optional lit lip below-right). */
function crack(s, x, y, len, rng, { dark, light = null, depth = 0.25, idMap = null, idv = -1, down = false }) {
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  let d = down ? 2 : rng.int(0, 7);
  const path = [];
  for (let k = 0; k < len; k++) {
    const i = s.ix(x, y);
    if (i < 0 || (idMap && idMap[i] !== idv)) break;
    path.push([x, y]);
    const r = rng.next();
    const dd = r < 0.55 ? 0 : r < 0.78 ? 1 : -1;
    const [dx, dy] = dirs[mod(d + dd, 8)];
    if (down) d = 2;
    x += dx;
    y += dy;
  }
  if (light) {
    for (const [px, py] of path) {
      const i = s.ix(px + 1, py + 1);
      if (i >= 0 && (!idMap || idMap[i] === idv)) s.set(px + 1, py + 1, light);
    }
  }
  for (const [px, py] of path) { s.set(px, py, dark); s.setH(px, py, s.H(px, py) - depth); }
  return path;
}

/**
 * @param {TextureKit} K
 * @returns {Record<string, TexDef>}
 */
export function buildingTextures(K) {
  const { parseColor, mixColor: mix, extRamp, clamp, smoothstep, hash2, field, stepOf } = K;
  /** Ramp lookup, clamped. */
  const ri = (R, i) => R[i < 0 ? 0 : i >= R.length ? R.length - 1 : i | 0];
  /** 1 px emboss of a level map lit from the upper left (+1 lit rim, −1 shadowed rim). */
  const emboss = (lv, w, h, x, y) => {
    const L = lv[y * w + x];
    const up = lv[mod(y - 1, h) * w + x];
    const left = lv[y * w + mod(x - 1, w)];
    if (up > L || left > L) return -1;
    if (up < L || left < L) return 1;
    return 0;
  };

  // ---- ramps (dark → light, hue-shifted: cool deep shadows, warm light) ----
  const ADOBE = ['#3e2618', '#5a3822', '#7a4e30', '#98663e', '#b27e4e', '#c8965e', '#dbad74', '#e9c38e'].map(parseColor);
  const MUD = ['#2e1a12', '#4a2a1a', '#663a24', '#82502e', '#9c6638', '#b47c46'].map(parseColor);
  const WASH = ['#6a6460', '#8a8580', '#a9a49c', '#c3beb2', '#d8d3c5', '#e6e1d2', '#f0ecdf', '#f7f4ea'].map(parseColor);
  const SAND = {
    cream: ['#4a3424', '#6c5034', '#8e6e48', '#ad8c5c', '#c6a672', '#dabe8c', '#ead3a8'].map(parseColor),
    ochre: ['#46301c', '#664626', '#886032', '#a67a40', '#c09452', '#d4ac68', '#e4c284'].map(parseColor),
    rose: ['#44301f', '#644630', '#845e40', '#a27852', '#bb9266', '#d0aa7e', '#e2c29a'].map(parseColor),
  };
  const SAND_MORTAR = ['#3a2a1e', '#5a4632', '#7a6448', '#94805e'].map(parseColor);
  const CHAR = ['#0b0909', '#141010', '#1e1816', '#2a221e', '#382e28', '#4a3e34', '#5e5044'].map(parseColor);
  const ASH = ['#4a4644', '#666260', '#85807a', '#a39d94'].map(parseColor);
  const TERRA = ['#2c0e08', '#4a1a0e', '#6c2a14', '#8e3c1c', '#ac5024', '#c4682e', '#d8843e', '#e8a35a'].map(parseColor);
  const EMBER = ['#ff4a10', '#ff7a1c', '#ffb040'].map(parseColor);

  /**
   * A sun-baked plaster wall (adobe; whitewash wears through to adobe): trowel patches (2 levels
   * with an emboss), pores, straw flecks, hairline cracks and fallen patches showing the mud
   * bricks underneath; `worn` (whitewash) lets the ochre adobe show where the wash wore thin.
   */
  function plasterWall(s, ctx, { R, base, straw, cracks, chips, worn = 0, drips = 0 }) {
    const { w, h } = s;
    const { rng, seed } = ctx;
    // trowel patches (2 levels, 1 step apart), a broad tone drift (dithered), fine pores
    const A = field(w, h, w / 16, h / 16, seed + 1, { oct: 3 });
    const D = field(w, h, 2, 2, seed + 7, { oct: 2 });
    const B = field(w, h, w / 8, h / 8, seed + 2, { oct: 2 });
    const Wn = worn ? field(w, h, 3, 3, seed + 5, { oct: 4, gain: 0.6 }) : null;
    const lv = new Int8Array(w * h);
    for (let i = 0; i < w * h; i++) lv[i] = base + (A[i] > 0.5 ? 1 : 0);
    s.each((x, y, i) => {
      const e = emboss(lv, w, h, x, y);
      let k = lv[i];
      if (e > 0 && hash2(x, y, seed) < 0.45) k += 1;
      else if (e < 0 && hash2(x, y, seed + 1) < 0.6) k -= 1;
      // the broad drift: ± one step in soft-edged blots (a few loose pixels at their rims)
      const drift = (D[i] - 0.5) * 2.2 + (hash2(x, y, seed + 6) - 0.5) * 0.35;
      k += drift > 0.8 ? 1 : drift < -0.8 ? -1 : 0;
      // fine sand grain and pores
      const g = hash2(x, y, seed + 2);
      if (g < 0.025) k -= 1;
      else if (g > 0.99) k += 1;
      if (B[i] < 0.04) k -= 1;
      let c = ri(R, k);
      if (Wn && Wn[i] < worn) {
        // the wash worn thin: the adobe beneath, a ragged darker rim where the lime still holds
        const edge = Wn[i] > worn - 0.025 || (Wn[i] > worn - 0.05 && hash2(x, y, seed + 3) < 0.5);
        c = edge ? mix(ri(R, k - 2), ADOBE[5], 0.25) : ri(ADOBE, 4 + (k - base) + (B[i] > 0.7 ? 1 : 0));
        s.hf[i] = 0.28;
        s.set(x, y, c);
        return;
      }
      s.set(x, y, c);
      s.hf[i] = 0.35 + (lv[i] - base) * 0.04 + e * 0.03;
    });
    // straw in the mud: short pale strokes, mostly horizontal
    for (let n = 0; n < straw; n++) {
      const x = rng.int(0, w - 1);
      const y = rng.int(0, h - 1);
      const len = rng.int(2, 3);
      const diag = rng.chance(0.3) ? 1 : 0;
      for (let k = 0; k < len; k++) s.tint(x + k, y + (diag ? -k : 0) * (k & 1), '#efd79a', 0.45);
    }
    for (let c = 0; c < cracks; c++) {
      crack(s, rng.int(0, w - 1), rng.int(0, h - 1), rng.int(3, 7), rng, { dark: ri(R, base - 1), light: ri(R, base + 2), depth: 0.08, down: rng.chance(0.5) });
    }
    // fallen plaster: the mud bricks show through, the broken lip catches the light
    for (let c = 0; c < chips; c++) {
      const x0 = rng.int(0, w - 1);
      const y0 = rng.int(0, h - 1);
      const cw = rng.int(13, 19);
      const ch = rng.int(8, 11);
      const off = rng.int(0, 5);
      const inside = (u, v) => {
        const e = ((u + 0.5 - cw / 2) ** 2) / ((cw / 2) ** 2) + ((v + 0.5 - ch / 2) ** 2) / ((ch / 2) ** 2);
        return e <= 1 + (hash2(u >> 1, v >> 1, seed + 17 + c) - 0.5) * 0.55;
      };
      for (let v = -1; v <= ch; v++) {
        for (let u = -1; u <= cw; u++) {
          const x = x0 + u;
          const y = y0 + v;
          if (inside(u, v)) {
            // adobe bricks 8 × 4 in running bond, dark mud mortar; the top of each brick lit
            const row = Math.floor(v / 4);
            const bx = u + off + (row & 1) * 4;
            const mortar = mod(v, 4) === 3 || mod(bx, 8) === 7;
            const top = mod(v, 4) === 0;
            const left = mod(bx, 8) === 0;
            const k = 3 + (top || left ? 1 : 0) - (hash2(Math.floor(bx / 8), row, seed + 9) < 0.35 ? 1 : 0);
            s.set(x, y, mortar ? MUD[1] : ri(MUD, k));
            s.setH(x, y, mortar ? 0.05 : 0.18);
          } else if (inside(u - 1, v) || inside(u, v - 1)) {
            s.set(x, y, ri(R, base + 2));
            s.setH(x, y, 0.45);
          } else if (inside(u + 1, v) || inside(u, v + 1)) {
            s.set(x, y, ri(R, base - 2));
          }
        }
      }
    }
    // drips: the lime ran down from the roof once (a few long streaks, slightly greyer)
    for (let d = 0; d < drips; d++) {
      const x = rng.int(0, w - 1);
      const y = rng.int(0, h - 1);
      const len = rng.int(6, 16);
      for (let k = 0; k < len; k++) s.tint(x, y + k, ri(R, base - 2), 0.18 * (1 - k / len));
    }
  }

  /** Sandstone ashlar in 8 px rows: per-block tone, bevelled edges, tooling, tafoni pits, iron stains. */
  function sandstoneBlocks(s, ctx) {
    const { w, h } = s;
    const { rng, seed } = ctx;
    const L = masonry(w, h, 8, 9, 16, rng, () => [0, 1, 2, 3].map(() => rng.range(0.6, 1.8)));
    const kinds = ['cream', 'cream', 'ochre', 'ochre', 'rose'];
    const info = L.blocks.map(() => ({
      R: SAND[rng.pick(kinds)], base: rng.pick([2, 3, 3, 3, 4]), pits: rng.chance(0.22), stain: rng.chance(0.12), tool: rng.chance(0.55),
    }));
    const N = field(w, h, 8, 8, seed + 3, { oct: 2 });
    const P = field(w, h, 16, 16, seed + 4, { oct: 2 });
    s.each((x, y, i) => {
      const b = L.id[i];
      s.hf[i] = b < 0 ? 0 : 0.3 + 0.7 * smoothstep(0, 1.9, L.dist[i]) + (N[i] - 0.5) * 0.14;
      if (b >= 0 && info[b].pits && P[i] > 0.82 && L.dist[i] > 1.5) s.hf[i] -= 0.35;
    });
    s.each((x, y, i) => {
      const b = L.id[i];
      if (b < 0) {
        const shadowed = L.id[s.ix(x, y - 1)] >= 0 || L.id[s.ix(x - 1, y)] >= 0;
        s.set(x, y, shadowed ? SAND_MORTAR[1] : SAND_MORTAR[2 + (hash2(x, y, seed) < 0.3 ? 1 : 0)]);
        return;
      }
      const st = info[b];
      let k = st.base + 1 + clamp(stepOf(s.slope(x, y), 0.3, 1.1), -2, 2);
      if (N[i] > 0.94) k += 1;
      else if (N[i] < 0.05) k -= 1;
      let c = ri(st.R, k);
      if (st.pits && P[i] > 0.82 && L.dist[i] > 1.5) c = ri(st.R, st.base - 1 + (P[i] > 0.9 ? 0 : 1));
      if (st.stain) c = mix(c, '#8a4a28', 0.22 * smoothstep(0.2, 0.9, N[i]));
      s.set(x, y, c);
    });
    for (const b of L.blocks) {
      const st = info[b.index];
      // tooling: rows of diagonal chisel dots
      if (st.tool) {
        for (let y = b.y + 2; y < b.y + b.h - 2; y += 2) {
          for (let x = b.x + 2 + (y & 2 ? 1 : 0); x < b.x + b.w - 2; x += 3) {
            if (L.id[s.ix(x, y)] === b.index && hash2(x, y, seed + 6) < 0.35) s.set(x, y, ri(st.R, st.base + 1));
          }
        }
      }
      if (rng.chance(0.18)) crack(s, b.x + rng.int(2, Math.max(2, b.w - 4)), b.y + 1, rng.int(3, 5), rng, { dark: ri(st.R, st.base - 1), light: ri(st.R, st.base + 3), idMap: L.id, idv: b.index });
    }
    return L;
  }

  return {
    adobe: {
      px: [64, 64],
      gen: (s, ctx) => {
        plasterWall(s, ctx, { R: ADOBE, base: 4, straw: 70, cracks: 7, chips: 2 });
        return { normal: 1.4 };
      },
      normalScale: 0.55,
    },
    whitewash: {
      px: [64, 64],
      gen: (s, ctx) => {
        plasterWall(s, ctx, { R: WASH, base: 5, straw: 0, cracks: 5, chips: 1, worn: 0.07, drips: 0 });
        return { normal: 1.2 };
      },
      normalScale: 0.5,
    },
    sandstone_brick: {
      px: [32, 32],
      gen: (s, ctx) => {
        sandstoneBlocks(s, ctx);
        return { normal: 2.2 };
      },
      normalScale: 0.6,
    },
    charred_wall: {
      px: [32, 32],
      gen: (s, ctx) => {
        const { w, h } = s;
        const { rng, seed } = ctx;
        const L = sandstoneBlocks(s, ctx);
        // soot: tongues of flame licked up the wall (a field stretched vertically), char in the joints
        const F = field(w, h, 5, 1, seed + 11, { oct: 3 });
        const G = field(w, h, 4, 4, seed + 12, { oct: 3 });
        // heat spalling: on a few blocks a rounded flake of the face came off
        const spall = L.blocks.map((b) => (b.w >= 11 && rng.chance(0.28)
          ? { cx: b.x + rng.range(b.w * 0.35, b.w * 0.6), cy: b.y + rng.range(2.8, 3.6), rx: rng.range(2.6, Math.min(5, b.w / 2 - 1.5)), ry: rng.range(1.6, 2.4) }
          : null));
        const inSpall = (b, x, y) => {
          const sp = spall[b];
          if (!sp) return false;
          // (block-local, the block's own wrap: x may lie past the texture edge)
          let dx = x + 0.5 - sp.cx;
          if (dx < -w / 2) dx += w;
          else if (dx > w / 2) dx -= w;
          const e = (dx / sp.rx) ** 2 + ((y + 0.5 - sp.cy) / sp.ry) ** 2;
          return e <= 1 + (hash2(x, y, seed + 15) - 0.5) * 0.35;
        };
        s.each((x, y, i) => {
          const b = L.id[i];
          const c = s.get(x, y);
          const lum = (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255;
          const soot = clamp(0.55 + (F[i] - 0.5) * 1.1 + (G[i] - 0.5) * 0.5, 0, 1);
          if (b < 0) { s.set(x, y, CHAR[soot > 0.5 ? 0 : 1]); return; }
          if (inSpall(b, x, y)) {
            // the fresh stone beneath: pale, rough, a little ash in it
            const k = 3 + (hash2(x, y, seed + 13) < 0.22 ? -1 : 0) + (hash2(x, y, seed + 16) > 0.9 ? 1 : 0);
            s.set(x, y, mix(ri(SAND.cream, k), ASH[2], 0.3));
            s.hf[i] -= 0.22;
            return;
          }
          let k = Math.round(lum * 6 * (1 - soot * 0.5));
          if (soot > 0.82 && hash2(x, y, seed + 14) < 0.5) k -= 1;
          let col = ri(CHAR, k);
          // the stone's warmth shows where the soot is thin
          col = mix(col, c, clamp(0.55 - soot * 0.6, 0, 0.45));
          if (G[i] > 0.9 && soot < 0.6) col = mix(col, ASH[3], 0.3);
          s.set(x, y, col);
        });
        // spalled rims: a dark lip above-left (the broken face's shadow), a lit edge below-right
        s.each((x, y, i) => {
          const b = L.id[i];
          if (b < 0 || !spall[b] || inSpall(b, x, y)) return;
          const at = (xx, yy) => { const j = s.ix(xx, yy); return L.id[j] === b && inSpall(b, xx, yy); };
          if (at(x + 1, y) || at(x, y + 1)) s.set(x, y, CHAR[0]);
          else if (at(x - 1, y) || at(x, y - 1)) s.set(x, y, ASH[2]);
        });
        return { normal: 2.2 };
      },
      normalScale: 0.6,
    },
    roof_terracotta: {
      px: [32, 32],
      gen: (s, ctx) => {
        barrelRoof(s, ctx, { R: TERRA, charred: false });
        return { normal: 2.6 };
      },
      normalScale: 0.75,
    },
    roof_charred: {
      px: [32, 32],
      emissive: true,
      gen: (s, ctx) => {
        barrelRoof(s, ctx, { R: CHAR, charred: true });
        return { normal: 2.4 };
      },
      normalScale: 0.7,
    },
  };

  /**
   * Mission barrel tiles: columns of convex caps (5 px) over concave pans (3 px), 8 px courses, the
   * lip of each cap catching the light and casting a shadow on the course below. Canvas up = toward
   * the ridge. `charred`: soot-black tiles with ash on the lips, a few broken ones showing the dark
   * battens, and ember cracks (the emissive mask).
   */
  function barrelRoof(s, ctx, { R, charred }) {
    const { w, h } = s;
    const { rng, seed } = ctx;
    const period = 8;
    const capW = 5;
    const rowH = 8;
    const cols = w / period;
    const rows = h / rowH;
    // per tile: tone, sun-fade, lichen, broken (charred)
    const tiles = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols * 2; c++) {
        tiles.push({
          base: charred ? rng.pick([3, 4, 4, 4, 5]) : rng.pick([4, 4, 5, 5, 5]),
          faded: !charred && rng.chance(0.14),
          dark: rng.chance(0.12),
          lichen: !charred && rng.chance(0.1),
          broken: charred && rng.chance(0.16),
          ash: charred && rng.chance(0.5),
        });
      }
    }
    const N = field(w, h, 4, 4, seed + 3, { oct: 2 });
    const em = charred ? s.emissive() : null;
    s.each((x, y, i) => {
      const r = Math.floor(y / rowH);
      const v = y % rowH;
      const px = mod(x, period);
      // the caps taper toward the ridge: 4 px wide in the top three rows of a course, 5 below
      const cw = v < 3 ? capW - 1 : capW;
      const cap = px < cw;
      const col = Math.floor(x / period);
      const t = tiles[(r * cols + col) * 2 + (cap ? 0 : 1)];
      // relief: caps a half cylinder, pans a shallow trough under the caps' edges; each course
      // rises toward its lower lip (the tile overlaps the one below)
      let H;
      if (cap) {
        const u = (px + 0.5) / cw;
        H = 0.45 + 0.5 * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2)) + v * 0.025;
      } else {
        const u = (px - cw + 0.5) / (period - cw);
        H = 0.12 + 0.1 * Math.abs(2 * u - 1) + v * 0.02;
      }
      if (v === 0) H -= 0.15;
      s.hf[i] = H;
      if (t.broken && cap && v >= 2) {
        // a broken cap: the dark batten and the void under it
        s.hf[i] = 0.02;
        const batten = v === 4 || v === 5;
        s.set(x, y, batten ? ri(CHAR, v === 4 ? 3 : 2) : CHAR[0]);
        if (batten && px > 0 && px < cw - 1 && hash2(x, y, seed + 8) < 0.3 && em) {
          s.set(x, y, EMBER[0]);
          em.set(x, y, EMBER[0]);
        }
        return;
      }
      let k = t.base;
      if (cap) {
        // cylinder lit from the left; the right edge in shadow
        if (px <= 1) k += 1;
        else if (px === cw - 1) k -= 2;
        else if (px === cw - 2) k -= 1;
        // the rounded lip at the bottom of the course catches the light, its corner is dark
        if (v === rowH - 1) k += px === cw - 1 ? -1 : 1;
        // in the shade of the course above
        if (v === 0) k -= 3;
        else if (v === 1) k -= 1;
      } else {
        // the pan: in the caps' shade, lit a little on its right flank
        k -= 2;
        if (px === cw) k -= 1;
        if (px === period - 1) k += 1;
        if (v === 0) k -= 2;
        else if (v === 1) k -= 1;
      }
      if (t.dark) k -= 1;
      if (N[i] > 0.93) k += 1;
      else if (N[i] < 0.05) k -= 1;
      let c = ri(R, k);
      if (t.faded) c = mix(c, '#d9b48c', 0.3);
      if (t.lichen && cap && v >= 2 && v <= 5 && hash2(x, y, seed + 4) < 0.45) c = mix(c, '#9a9446', 0.45);
      if (!charred && !cap && hash2(x, y, seed + 5) < 0.1) c = mix(c, '#c8a878', 0.5); // sand in the pans
      if (charred) {
        if (t.ash && v === rowH - 1 && cap) c = mix(c, ASH[2], 0.55);
        else if (t.ash && v >= rowH - 3 && cap && hash2(x, y, seed + 6) < 0.4) c = mix(c, ASH[1], 0.4);
        // the clay's last warmth under the soot on a few tiles
        if (t.base === 5 && cap && v > 1 && v < rowH - 1) c = mix(c, TERRA[2], 0.35);
      }
      s.set(x, y, c);
    });
    if (charred) {
      // ember cracks: a few short glowing hairlines down a cap (the emissive mask holds the glow):
      // a bright pixel, a dimmer one below-right, sometimes a third
      for (let n = 0; n < 4; n++) {
        const col = rng.int(0, cols - 1);
        const r = rng.int(0, rows - 1);
        const t = tiles[(r * cols + col) * 2];
        if (t.broken) continue;
        let x = col * period + rng.int(1, 2);
        let y = r * rowH + rng.int(3, 4);
        const len = rng.int(2, 3);
        for (let k = 0; k < len; k++) {
          const c = EMBER[k === 0 ? 1 : 0];
          s.set(x, y, c);
          em.set(x, y, k === 0 ? EMBER[1] : EMBER[0]);
          y += 1;
          if (k === 0) x += 1;
        }
      }
    } else {
      // a few chipped lips
      for (let c = 0; c < 4; c++) {
        const x = rng.int(0, w - 1);
        if (mod(x, period) >= capW) continue;
        const y = rng.int(0, rows - 1) * rowH + rowH - 1;
        s.set(x, y, R[1]);
        s.setH(x, y, 0.2);
      }
    }
  }
}
