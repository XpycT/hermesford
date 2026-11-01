import { clamp, smoothstep } from '../../utils/math.js';
import { TRIM, centerOff } from './Details.js';
import { SIDES, CHAR, SOOT, VOID, ASHLAR_WALLS } from './House.js';
import { decalQuad, scorchDecal } from './SetPieces.js';

/**
 * HouseSiege.js — the siege's parts of a house (Vanquish the Evil Dragon:
 * docs/contracts/DRAGON_CAMPAIGN.md §5.3, §6.3; docs/design/SIEGE_AND_FESTIVAL.md; owner: the siege
 * package): a gutted house's broken walls (`ruin` 2), a damaged roof (`ruin` 1–2), the flat adobe
 * roof (`flatRoof`) and its balcony, soot, cracks, fallen beams and scorched ground, the flames of a
 * burning one. Part of the set-piece kit's chunk (src/engine/world/SetPieceKit.js): `buildHouse`
 * (./House.js, which documents the options) calls them through the loaded kit with its builder and
 * the siege's own RNG, so a house builds exactly as it did inside House.js.
 */

// ---------------------------------------------------------------------------------------------
// The siege: broken walls, damaged roofs, the flat adobe roof, soot, flames
// ---------------------------------------------------------------------------------------------

/** Wall thickness of a gutted house's broken courses. */
const TW = 0.26;
/** Snap a height to whole art pixels in pairs (1/8 unit): crisp pixel-art breaks. */
const snap = (v) => Math.round(v * 8) / 8;

/**
 * A gutted house's walls (ruin 2): every side built as courses 0.5 wide and TW thick whose tops
 * follow a broken profile — the front (or, with the door there, the stretch of the front away
 * from the door) torn open down to the ground floor, the corner at that end collapsed into both
 * walls that meet there, ragged tops everywhere. The outer faces keep the intact walls' UVs (the
 * same texture phase), the inner faces and the broken tops are sooty; a two-storey house's upper
 * courses wear the upper wall. Returns the profile (`top(side, x)`, `minTop(side, x0, x1)` in
 * face coordinates) and the collapsed end (±1 along the ridge).
 */
export function brokenWalls(b, T, sr, { W, D, P, H1, E, wall, upperWall, stories, door }) {
  const hw = W / 2;
  const hd = D / 2;
  const yUp = P + H1;
  // the torn front: away from the door when the door is on it
  const torn = door === 'front' && W < 4.6 ? 'back' : 'front';
  const collapseEnd = sr.chance(0.5) ? 1 : -1;
  const L = { front: W, back: W, right: D, left: D };
  // the collapsed corner (internal x = collapseEnd · hw on the torn side) in each face's x — face
  // frames: front x = x, back x = −x, right x = −z, left x = z; null: the side does not meet it
  const tornZ = torn === 'front' ? hd : -hd;
  /** @type {Record<string, number|null>} */
  const cornerX = {
    front: torn === 'front' ? collapseEnd * hw : null,
    back: torn === 'back' ? -collapseEnd * hw : null,
    right: collapseEnd > 0 ? -tornZ : null,
    left: collapseEnd < 0 ? tornZ : null,
  };
  const notchLow = P + sr.range(0.25, 0.8);
  const notchHalf = sr.range(0.36, 0.48) * W;
  const notchC = collapseEnd * (hw - notchHalf * 0.55) * (torn === 'front' ? 1 : -1);
  const noise = new Map();
  /** the profile (absolute top y) at face x of a side */
  const top = (side, fx) => {
    let h = E;
    if (side === torn) {
      const d = Math.abs(fx - notchC) / notchHalf;
      if (d < 1) h = Math.min(h, notchLow + (E - notchLow) * smoothstep(0.35, 1, d));
    }
    const cx = cornerX[side];
    if (cx != null) {
      const d = Math.abs(fx - cx);
      if (d < 1.6) h = Math.min(h, E - (E - (P + H1 * 0.55)) * (1 - d / 1.6));
    }
    return h;
  };
  /** @type {Record<string, number[]>} each side's course tops, left to right */
  const courses = {};
  for (const side of ['front', 'back', 'right', 'left']) {
    const sd = SIDES[side];
    const long = side === 'front' || side === 'back';
    const Ls = L[side];
    // front / back span the corners; the sides fit between them
    const span = long ? Ls : Ls - 2 * TW;
    const n = Math.max(2, Math.round(span / 0.5));
    const cw = span / n;
    const mat = wall;
    // masonry breaks along its block rows (0.5), plaster anywhere (two art pixels)
    const step = ASHLAR_WALLS.has(wall) ? 0.5 : 0.125;
    const Uw = T.meta(mat).units[0];
    const Uu = T.meta(upperWall).units[0];
    b.push([sd.n[0] * hw, 0, sd.n[1] * hd], sd.yaw);
    const tops = [];
    for (let i = 0; i < n; i++) {
      const x0 = -span / 2 + cw * i;
      const xc = x0 + cw / 2;
      const ragged = top(side, xc) < E - 0.01 ? sr.range(-0.45, 0.25) : sr.range(-0.12, 0);
      const h = Math.max(P + 0.25, Math.round((top(side, xc) + ragged - P) / step) * step + P);
      tops.push(h);
      const off = (u) => [centerOff(Ls, u) + x0 + Ls / 2, 0];
      const lowTop = stories > 1 ? Math.min(h, yUp) : h;
      /** a course's piece from y0 to y1 of material m (its texture phase from `base`, as the intact wall's box) */
      const part = (m, U, y0, y1, isTop, base) => {
        if (y1 - y0 < 0.01) return;
        b.box(m, [cw, y1 - y0, TW], {
          at: [xc, (y0 + y1) / 2, -TW / 2],
          faces: {
            pz: { off: [off(U)[0], y0 - base] },
            nz: { mat: m, color: SOOT, off: [Ls / 2 - x0 - cw, 0] },
            py: isTop ? { color: [0.62, 0.56, 0.52] } : false,
            ny: false,
            px: { color: [0.7, 0.64, 0.6] },
            nx: { color: [0.7, 0.64, 0.6] },
          },
        });
      };
      part(mat, Uw, P, lowTop, h <= yUp || stories < 2, P);
      if (stories > 1 && h > yUp) {
        part(upperWall, Uu, yUp, h, true, yUp);
        // the floor band where it still stands
        b.box(TRIM, [cw + 0.01, 0.2, 0.08], { at: [xc, yUp + 0.04, 0.04], faces: { nz: false }, color: CHAR });
      }
    }
    courses[side] = tops;
    b.pop();
  }
  const at = (side, fx) => {
    const long = side === 'front' || side === 'back';
    const span = long ? L[side] : L[side] - 2 * TW;
    const tops = courses[side];
    const i = clamp(Math.floor(((fx + span / 2) / span) * tops.length), 0, tops.length - 1);
    return tops[i];
  };
  return {
    collapseEnd,
    torn,
    top: at,
    minTop: (side, x0, x1) => {
      let m = Infinity;
      for (let t = 0; t <= 4; t++) m = Math.min(m, at(side, x0 + ((x1 - x0) * t) / 4));
      return m;
    },
  };
}

/**
 * A damaged gable roof (ruin 1: holes; ruin 2: a stub at the standing gable end): each slope built
 * as a grid of panels (the intact slab's UVs, panel by panel) with the holes left out, their rims
 * charred (`roof_charred`), the rafters and the ridge beam under them charred, fascia and barge
 * boards only where panels remain; the hole centres go to `roofFires` (where it burns).
 */
export function ruinedRoof(b, T, sr, { W, hw, hs, E, R, O, Ts, pitch, roof, ruin, collapseEnd, roofFires }) {
  const Ur = T.meta(roof).units[0];
  const c = Math.cos(pitch);
  const sn = Math.sin(pitch);
  const tn = Math.tan(pitch);
  const Lx = W + 2 * O;
  const Ls = (hs + O) / c + Ts * tn;
  const cS = ((hs + O) / c - Ts * tn) / 2;
  const ridgeY = E + R;
  const nx = Math.max(3, Math.round(Lx / 0.95));
  const nz = Math.max(3, Math.round(Ls / 0.75));
  const cw = Lx / nx;
  const ch = Ls / nz;
  const charred = 'roof_charred';
  for (const side of [1, -1]) {
    // which panels remain
    const keep = [];
    for (let i = 0; i < nx; i++) keep.push(new Array(nz).fill(true));
    if (ruin === 1) {
      const holes = side > 0 ? sr.int(1, 2) : sr.int(0, 2);
      for (let h = 0; h < holes; h++) {
        const hi = sr.int(1, nx - 2);
        const hj = sr.int(1, nz - 2);
        keep[hi][hj] = false;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1]]) {
          const i = hi + di;
          const j = hj + dj;
          if (i > 0 && i < nx - 1 && j >= 0 && j < nz && sr.chance(0.45)) keep[i][j] = false;
        }
        // where it burns: the hole's middle (builder space)
        roofFires.push({ ...slopePoint(side, (hi + 0.5) * cw - Lx / 2, (hj + 0.5) * ch - Ls / 2, { ridgeY, sn, c, cS, Ts }), size: 1.2 });
      }
    } else {
      // ruin 2: a stub of the roof at the standing end, its edge ragged
      for (let i = 0; i < nx; i++) {
        const fromEnd = collapseEnd > 0 ? i : nx - 1 - i; // 0 at the standing end
        for (let j = 0; j < nz; j++) {
          const reach = 1.4 + (j / nz) * 1.2 + sr.range(-0.8, 0.6);
          keep[i][j] = fromEnd < reach && !(j === 0 && sr.chance(0.5));
        }
      }
      // where it burns: the stub's broken edge and the open middle
      roofFires.push({ ...slopePoint(side, (collapseEnd > 0 ? 2.2 : nx - 2.2) * cw - Lx / 2, 0, { ridgeY, sn, c, cS, Ts }), size: 1 });
    }
    const isHole = (i, j) => i >= 0 && i < nx && j >= 0 && j < nz && !keep[i][j];
    const center = [0, ridgeY - sn * cS + (c * Ts) / 2, side * (c * cS + (sn * Ts) / 2)];
    b.push(center, side > 0 ? [pitch, 0, 0] : [pitch, Math.PI, 0, 'YXZ']);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (!keep[i][j]) continue;
        const x0 = -Lx / 2 + i * cw;
        const z0 = -Ls / 2 + j * ch;
        const rim = isHole(i - 1, j) || isHole(i + 1, j) || isHole(i, j - 1) || isHole(i, j + 1) || (ruin === 2 && (i === 0 || i === nx - 1 || isHole(i, j - 1)));
        const mat = rim && (ruin === 2 || sr.chance(0.8)) ? charred : roof;
        const edge = (hole) => (hole ? { mat: TRIM, color: CHAR } : false);
        b.box(mat, [cw, Ts, ch], {
          at: [x0 + cw / 2, 0, z0 + ch / 2],
          faces: {
            py: { off: [centerOff(Lx, Ur) + x0 + Lx / 2, Ls / 2 - z0 - ch] },
            ny: { mat: TRIM, color: [0.5, 0.45, 0.45] },
            pz: j === nz - 1 ? { mat: TRIM } : edge(isHole(i, j + 1)),
            nz: j === 0 ? false : edge(isHole(i, j - 1)),
            px: i === nx - 1 ? { mat: TRIM } : edge(isHole(i + 1, j)),
            nx: i === 0 ? { mat: TRIM } : edge(isHole(i - 1, j)),
          },
        });
        // the fascia under a remaining eave panel, the barge board along a gable-end one
        if (j === nz - 1) b.box(TRIM, [cw + 0.01, Ts + 0.16, 0.09], { at: [x0 + cw / 2, -0.06, Ls / 2 + 0.03], faces: { nz: false } });
        if (i === 0 || i === nx - 1) b.box(TRIM, [0.09, Ts + 0.16, ch + 0.01], { at: [(i === 0 ? -1 : 1) * (Lx / 2 + 0.035), -0.06, z0 + ch / 2], faces: { nz: false } });
      }
    }
    // charred rafters (and, gutted, only near the standing end, some broken short)
    const nr = Math.max(3, Math.round((W - 0.2) / 0.6) + 1);
    for (let k = 0; k < nr; k++) {
      const rx = -hw + 0.1 + (k * (W - 0.2)) / (nr - 1);
      let z0 = -Ls / 2 + 0.05;
      let z1 = Ls / 2 - 0.1;
      if (ruin === 2) {
        const fromEnd = (collapseEnd > 0 ? rx + hw : hw - rx) / 0.6;
        if (fromEnd > 4.5 + sr.range(-1, 1)) continue;
        if (fromEnd > 2.2) z0 += sr.range(0.2, 0.6) * Ls;
      }
      b.box(TRIM, [0.1, 0.14, z1 - z0], { at: [rx, -Ts / 2 - 0.07, (z0 + z1) / 2], color: CHAR });
    }
    b.pop();
  }
  // the ridge beam (a gutted house: a broken stub of it)
  const rl = ruin === 2 ? Math.min(W, sr.range(1.6, 2.6)) : W + 0.2;
  const rc = ruin === 2 ? collapseEnd * (hw - rl / 2) : 0;
  b.box(TRIM, [rl, 0.18, 0.18], { at: [rc, ridgeY - 0.04, 0], color: CHAR });
  if (ruin === 1) {
    // the ridge cap still lies along the top
    b.box(roof, [Lx + 0.14, 0.3, 0.3], { at: [0, ridgeY + Ts / c - 0.05, 0], rot: [Math.PI / 4, 0, 0], faces: { px: TRIM, nx: TRIM }, color: [0.82, 0.8, 0.82] });
    // the dark attic seen through the holes
    b.box(TRIM, [W - 0.05, 0.04, 2 * hs - 0.05], { at: [0, E + 0.03, 0], faces: { ny: false, px: false, nx: false, pz: false, nz: false }, color: VOID.map((v) => v * 2.5) });
  }
}

/** A point on a roof slope (builder space): slope-frame (lx, lz) of side ±1 → its top surface. */
function slopePoint(side, lx, lz, { ridgeY, sn, c, cS, Ts }) {
  // the slab's centre and its frame: +z down the slope, the top face Ts/2 above the centre
  const cy = ridgeY - sn * cS + (c * Ts) / 2;
  const cz = side * (c * cS + (sn * Ts) / 2);
  return { x: side > 0 ? lx : -lx, y: cy - sn * lz + c * (Ts / 2 - 0.15), z: cz + side * (c * lz + sn * (Ts / 2 - 0.15)) };
}

/**
 * The flat adobe roof: a deck at the eave (the wall's own plaster, darker), a parapet round it
 * (its top lit), vigas jutting from the long walls just under the deck, a wooden water spout
 * (canale), a squat rounded chimney, and — on a one-storey house — a ladder leaning against a side
 * wall. Damaged: the deck has holes (charred rims, the dark room under it), the parapet lost
 * courses. Fires go on the deck (`roofFires`).
 */
export function flatRoofGeom(b, T, sr, { W, D, E, wall, ruin, stories, chimney, anchors, roofFires, decal }) {
  const hw = W / 2;
  const hd = D / 2;
  const Hp = 0.55;
  const tp = 0.22;
  const Uw = T.meta(wall).units[0];
  const deck = [0.66, 0.6, 0.56];
  // the deck (panels when damaged: holes with charred rims)
  const nx = Math.max(2, Math.round(W / 1.0));
  const nz = Math.max(2, Math.round(D / 1.0));
  const cw = W / nx;
  const ch = D / nz;
  const hole = [];
  for (let i = 0; i < nx; i++) hole.push(new Array(nz).fill(false));
  if (ruin) {
    const n = ruin === 2 ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const hi = sr.int(0, nx - 1);
      const hj = sr.int(0, nz - 1);
      hole[hi][hj] = true;
      if (ruin === 2 && hi + 1 < nx) hole[hi + 1][hj] = true;
      roofFires.push({ x: -hw + (hi + 0.5) * cw, y: E - 0.25, z: -hd + (hj + 0.5) * ch, size: 1.1 });
    }
  } else {
    roofFires.push({ x: sr.range(-0.3, 0.3) * W, y: E + 0.05, z: sr.range(-0.25, 0.25) * D, size: 1 });
  }
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      if (hole[i][j]) continue;
      const x0 = -hw + i * cw;
      const z0 = -hd + j * ch;
      const rim = ruin && ((i > 0 && hole[i - 1][j]) || (i < nx - 1 && hole[i + 1][j]) || (j > 0 && hole[i][j - 1]) || (j < nz - 1 && hole[i][j + 1]));
      b.box(wall, [cw, 0.12, ch], {
        at: [x0 + cw / 2, E + 0.06, z0 + ch / 2],
        faces: { py: { off: [x0 + hw, hd - z0 - ch], color: rim ? CHAR : deck }, ny: false, pz: rim ? { mat: TRIM, color: CHAR } : false, nz: rim ? { mat: TRIM, color: CHAR } : false, px: rim ? { mat: TRIM, color: CHAR } : false, nx: rim ? { mat: TRIM, color: CHAR } : false },
      });
    }
  }
  if (ruin) {
    // the dark room under the holes
    b.box(TRIM, [W - 0.1, 0.04, D - 0.1], { at: [0, E - 0.9, 0], faces: { ny: false, px: false, nx: false, pz: false, nz: false }, color: VOID.map((v) => v * 2.5) });
  }
  // the parapet: front / back full width, the ends between them; a damaged one lost a few courses
  const seg = (L, cx, cz, alongX, outward) => {
    const n = Math.max(2, Math.round(L / 0.5));
    const sl = L / n;
    for (let i = 0; i < n; i++) {
      let h = Hp + (i % 3 === 1 ? 0.06 : 0);
      if (ruin && sr.chance(ruin === 2 ? 0.45 : 0.2)) h = snap(sr.range(0, Hp * 0.5));
      if (h < 0.06) continue;
      const p = -L / 2 + sl * (i + 0.5);
      const at = alongX ? [cx + p, E + h / 2, cz] : [cx, E + h / 2, cz + p];
      const size = alongX ? [sl, h, tp] : [tp, h, sl];
      const offU = (alongX ? p - sl / 2 + L / 2 : p - sl / 2 + L / 2) + centerOff(L, Uw);
      b.box(wall, size, {
        at,
        faces: {
          ny: false,
          py: { color: [1.06, 1.04, 1.0] },
          pz: { off: [alongX ? (outward > 0 ? offU : offU) : 0, 0.12] },
          nz: { off: [alongX ? offU : 0, 0.12] },
        },
      });
    }
  };
  seg(W, 0, hd - tp / 2, true, 1);
  seg(W, 0, -hd + tp / 2, true, -1);
  seg(D - 2 * tp, hw - tp / 2, 0, false, 1);
  seg(D - 2 * tp, -hw + tp / 2, 0, false, -1);
  // vigas: round beam ends jutting from the long walls just under the deck
  const nv = Math.max(3, Math.round((W - 0.6) / 0.72) + 1);
  for (const s of [1, -1]) {
    for (let k = 0; k < nv; k++) {
      const vx = -hw + 0.3 + (k * (W - 0.6)) / (nv - 1);
      if (ruin && sr.chance(0.25)) continue;
      const out = sr.range(0.38, 0.55);
      b.tube('bark', [vx, E - 0.22, s * (hd - 0.05)], [vx, E - 0.22 + sr.range(-0.02, 0.02), s * (hd + out)], 0.1, 0.095, { segments: 6, capTop: 'wood_planks', twist: k, color: ruin ? CHAR : [1.3, 1.2, 1.05] });
    }
  }
  // a canale: a wooden spout through the parapet on one end wall
  const cs = sr.chance(0.5) ? 1 : -1;
  b.box(TRIM, [0.6, 0.1, 0.16], { at: [cs * (hw + 0.18), E + 0.12, sr.range(-0.3, 0.3) * D], color: ruin ? CHAR : undefined });
  // a squat, rounded adobe chimney
  if (chimney) {
    const cx = sr.range(0.15, 0.3) * W * (sr.chance(0.5) ? 1 : -1);
    const cz = -hd * 0.45;
    const h = ruin === 2 ? 0.45 : 0.95;
    b.box(wall, [0.62, h, 0.62], { at: [cx, E + h / 2, cz], faces: { ny: false, py: false } });
    b.box(wall, [0.72, 0.12, 0.72], { at: [cx, E + h + 0.06, cz], faces: { ny: false }, color: [1.05, 1.03, 1.0] });
    b.box(TRIM, [0.36, 0.02, 0.36], { at: [cx, E + h + 0.125, cz], faces: { ny: false }, color: VOID });
    if (!ruin) anchors.smoke = b.point(cx, E + h + 0.5, cz);
  }
  // a one-storey house's roof is reached by a ladder against an end wall
  if (stories === 1 && sr.chance(ruin ? 0.3 : 0.7)) {
    const s = sr.chance(0.5) ? 1 : -1;
    const lz = sr.range(-0.25, 0.25) * D;
    const len = E + 0.9;
    const lean = 0.55;
    const tint = ruin ? CHAR : [0.95, 0.9, 0.85];
    for (const dz of [-0.24, 0.24]) b.tube('bark', [s * (hw + lean), 0, lz + dz], [s * (hw + 0.05), len, lz + dz], 0.045, 0.04, { segments: 5, color: tint });
    const rungs = Math.floor(len / 0.42);
    for (let k = 1; k < rungs; k++) {
      const t = k / rungs;
      const rx = s * (hw + lean + (0.05 - lean) * t);
      b.box(TRIM, [0.05, 0.05, 0.5], { at: [rx, len * t, lz], color: tint });
    }
  }
  void decal;
}

/**
 * A timber balcony on a flat-roofed house's upper floor (the front face's frame): a plank floor on
 * beam ends, corner posts, a rail with balusters and a striped rug thrown over it.
 */
export function balconyGeom(b, sr, L, yUp) {
  const bl = Math.min(L - 0.8, sr.range(2.2, 3.2));
  const bx = sr.range(-0.3, 0.3) * (L - bl);
  const dp = 0.85;
  const y0 = yUp - 0.05;
  b.box('wood_planks', [bl, 0.1, dp], { at: [bx, y0, dp / 2], faces: { py: { rotUV: true } } });
  const nb = Math.max(3, Math.round(bl / 0.6) + 1);
  for (let k = 0; k < nb; k++) {
    const cx = bx - bl / 2 + 0.12 + (k * (bl - 0.24)) / (nb - 1);
    b.tube('bark', [cx, y0 - 0.12, -0.05], [cx, y0 - 0.12, dp + 0.15], 0.07, 0.065, { segments: 6, capTop: 'wood_planks' });
  }
  const railY = y0 + 0.95;
  for (const s of [-1, 1]) b.box(TRIM, [0.1, 1.0, 0.1], { at: [bx + s * (bl / 2 - 0.05), y0 + 0.5, dp - 0.05] });
  b.box(TRIM, [bl, 0.08, 0.1], { at: [bx, railY, dp - 0.05] });
  for (const s of [-1, 1]) b.box(TRIM, [0.08, 0.08, dp], { at: [bx + s * (bl / 2 - 0.05), railY, dp / 2] });
  const nbal = Math.round(bl / 0.22);
  for (let k = 1; k < nbal; k++) {
    const px = bx - bl / 2 + (k * bl) / nbal;
    b.box('wood_planks', [0.05, 0.85, 0.05], { at: [px, y0 + 0.47, dp - 0.05] });
  }
  // a rug hung out over the rail
  const rw = sr.range(0.8, 1.2);
  const rx = bx + sr.range(-0.3, 0.3) * (bl - rw);
  b.box('cloth_stripe', [rw, 0.6, 0.03], { at: [rx, railY - 0.3, dp + 0.02], faces: { py: false, ny: false }, color: [1, 0.92, 0.85] });
  b.box('cloth_stripe', [rw, 0.03, 0.14], { at: [rx, railY + 0.05, dp - 0.05], faces: { ny: false } });
}

/**
 * The damage a fire left: soot over every opening, cracks, a fallen beam leaning on a wall, the
 * rubble and beams inside a gutted house, scorched ground round the walls.
 */
export function siegeDetails(b, T, sr, { W, D, P, E, hw, hd, J, stories, ruin, burning, flat, gableR, broken, decal, openings, faceInfo, pushFace, wall }) {
  // soot over the openings (the windows' and the door's tops) and a few cracks
  for (const op of openings) {
    if (!ruin && burning < 0.15) break;
    const fi = faceInfo(op.side, op.upper);
    pushFace(fi);
    // (from the lintel up: below it the frame would hide it)
    const w = op.w * sr.range(1.6, 2.1);
    const h = sr.range(1.6, 2.3) * (op.door ? 1.1 : 1);
    const yb = op.y + op.h + 0.06;
    const topMax = broken ? broken.top(op.side, op.x) : op.upper ? E : stories > 1 ? P + 3.0 : E;
    decalQuad(b, decal, sr.chance(0.5) ? 'soot' : 'soot2', op.x - w / 2, yb, op.x + w / 2, Math.min(yb + h, topMax - 0.05), { flip: sr.chance(0.5), z: 0.035 });
    b.pop();
  }
  // a gabled house: soot up each standing gable too (under the eaves the wall is too short to show it)
  if (!flat && (ruin || burning >= 0.15)) {
    for (const s of [1, -1]) {
      if (broken && s === broken.collapseEnd) continue;
      b.push([s * (hw + 0.005), 0, 0], s > 0 ? Math.PI / 2 : -Math.PI / 2);
      const w = (hd + J) * sr.range(1.1, 1.5);
      decalQuad(b, decal, sr.chance(0.5) ? 'soot' : 'soot2', -w / 2 + sr.range(-0.2, 0.2), E - 0.35, w / 2, E + gableR * sr.range(0.7, 0.95), { flip: sr.chance(0.5), z: 0.035 });
      b.pop();
    }
  }
  if (ruin) {
    for (const side of ['front', 'back', 'right', 'left']) {
      if (!sr.chance(0.55)) continue;
      const fi = faceInfo(side, false);
      pushFace(fi);
      const cx = sr.range(-0.4, 0.4) * fi.L;
      const cy = P + sr.range(0.4, 1.6);
      const s = sr.range(0.7, 1.1);
      if (!broken || broken.top(side, cx) > cy + s) decalQuad(b, decal, 'cracks', cx - s, cy - s * 0.2, cx + s, cy + s * 1.8, { flip: sr.chance(0.5), z: 0.03 });
      b.pop();
    }
    // a fallen beam leaning against a side wall
    if (sr.chance(0.6)) {
      const side = sr.chance(0.5) ? 'right' : 'left';
      const fi = faceInfo(side, false);
      pushFace(fi);
      const bx = sr.range(-0.3, 0.3) * fi.L;
      b.tube('wood_planks_dark', [bx - 0.9, 0.02, 1.2], [bx + 0.4, P + 1.9, 0.12], 0.11, 0.1, { segments: 4, capTop: 'wood_planks', capBottom: 'wood_planks', twist: 0.78, color: CHAR });
      b.pop();
    }
  }
  if (ruin === 2) {
    // inside: an ash floor, rubble heaps, beams fallen from the roof
    b.box(TRIM, [W - 2 * TW, 0.05, D - 2 * TW], { at: [0, P + 0.025, 0], faces: { ny: false }, color: [0.32, 0.27, 0.25] });
    b.tube('wood_planks_dark', [-hw * 0.7, P + 0.05, -hd * 0.4], [hw * 0.5, P + 1.4, hd * 0.2], 0.11, 0.1, { segments: 4, capTop: 'wood_planks', capBottom: 'wood_planks', twist: 0.78, color: CHAR });
    b.tube('wood_planks_dark', [hw * 0.6, P + 0.05, -hd * 0.5], [-hw * 0.1, P + 0.3, hd * 0.55], 0.1, 0.1, { segments: 4, capTop: 'wood_planks', twist: 0.4, color: CHAR });
    const stone = ASHLAR_WALLS.has(wall) ? wall : 'sandstone_brick';
    for (let k = 0; k < 9; k++) {
      const rx = sr.range(-0.8, 0.8) * (hw - TW);
      const rz = sr.range(-0.8, 0.8) * (hd - TW);
      const sz = sr.range(0.16, 0.3);
      rockLump(b, stone, rx, P, rz, sz, sr);
    }
    // the rubble the torn wall dropped outside
    const fi = faceInfo(broken.torn, false);
    pushFace(fi);
    for (let k = 0; k < 8; k++) {
      const rx = sr.range(-0.45, 0.45) * fi.L;
      const sz = sr.range(0.18, 0.34);
      rockLump(b, stone, rx, 0, sr.range(0.25, 0.9), sz, sr);
    }
    b.pop();
  }
  // scorched ground at the foot of the walls: a mark or two where the fire fell out of the house
  for (const side of ['front', 'back', 'right', 'left']) {
    if (!sr.chance(side === 'front' ? 0.85 : 0.5)) continue;
    const fi = faceInfo(side, false);
    pushFace(fi);
    const n = fi.L > 4.5 && sr.chance(0.5) ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const cx = (k - (n - 1) / 2) * fi.L * 0.45 + sr.range(-0.4, 0.4);
      scorchDecal(b, decal, cx, sr.range(0.55, 0.9), sr.range(0.7, 1.15), sr.range(0, Math.PI * 2), { y: 0.03, small: sr.chance(0.5) });
    }
    b.pop();
  }
}

/** A broken block of masonry (a rough box, turned) on the ground at (x, y0, z). */
function rockLump(b, stone, x, y0, z, sz, sr) {
  b.box(stone, [sz * 1.3, sz * 0.8, sz], { at: [x, y0 + sz * 0.35, z], rot: [sr.range(-0.3, 0.3), sr.range(0, Math.PI), sr.range(-0.3, 0.3)], color: SOOT, faces: { ny: false } });
}

/**
 * The flames of a burning house (`burning` 0–1 scales how many and how big): at the roof's fires
 * (its holes, along the ridge, on the deck), out of the tops of the windows, and up from the floor
 * of a gutted house; the biggest carry a glow card. Builder space → the FlameSet's group frame via
 * `b.point` (the builder's matrix holds the gable-front turn).
 */
export function burnFlames(b, sr, flames, { burning, ruin, flat, openings, faceInfo, pushFace, roofFires, P, E, W, D, broken }) {
  const k = 0.55 + 0.45 * burning;
  const add = (p, w, h, glow = 0) => flames.add({ x: p.x, y: p.y, z: p.z, width: w, height: h, seed: sr.range(0, 100), speed: sr.range(0.85, 1.2), glow, glowIntensity: 0.6 });
  // the roof's fires: a big tongue at each, smaller ones round it, a shower of sparks above
  for (const rf of roofFires) {
    const s = rf.size * k;
    const at = b.point(rf.x, rf.y, rf.z);
    add(at, sr.range(1.0, 1.35) * s, sr.range(1.8, 2.4) * s, 2.0);
    const n = 1 + Math.round(burning * 2);
    for (let i = 0; i < n; i++) {
      add(b.point(rf.x + sr.range(-0.7, 0.7), rf.y - 0.05, rf.z + sr.range(-0.4, 0.4)), sr.range(0.55, 0.85) * s, sr.range(0.9, 1.4) * s);
    }
    flames.spark({ x: at.x, y: at.y + 0.6 * s, z: at.z, spread: 0.8, height: (4 + 2.5 * burning) * s, count: Math.round(8 + 12 * burning), seed: sr.range(0, 100), life: 2.8, size: 0.085 });
  }
  // out of the windows (the upper ones first), a share growing with the fire
  const wins = openings.filter((op) => !op.door).sort((a, z) => Number(z.upper) - Number(a.upper));
  const nw = Math.round(wins.length * (0.25 + 0.6 * burning));
  for (let i = 0; i < nw; i++) {
    const op = wins[i];
    const fi = faceInfo(op.side, op.upper);
    pushFace(fi);
    const at = b.point(op.x + sr.range(-0.12, 0.12), op.y + op.h * 0.45, 0.16);
    add(at, sr.range(0.62, 0.8), sr.range(0.95, 1.35) * k, i % 2 === 0 ? 1.6 : 0);
    flames.spark({ x: at.x, y: at.y + 0.5, z: at.z, spread: 0.35, height: 2.2, count: 3, seed: sr.range(0, 100), life: 1.8, size: 0.07 });
    b.pop();
  }
  // a gutted house burns inside, the flames rising over its broken walls
  if (ruin === 2) {
    const n = 2 + Math.round(burning * 2);
    for (let i = 0; i < n; i++) {
      add(b.point(sr.range(-0.3, 0.3) * W, P + 0.05, sr.range(-0.25, 0.25) * D), sr.range(1.1, 1.6) * k, sr.range(2.4, 3.4) * k, i === 0 ? 2.2 : 0);
    }
    const at = b.point(0, P + 1.5, 0);
    flames.spark({ x: at.x, y: at.y, z: at.z, spread: Math.min(W, D) * 0.3, height: 5 + 2 * burning, count: Math.round(10 + 10 * burning), seed: sr.range(0, 100), life: 2.8, size: 0.085 });
  }
  void flat; void E; void broken;
}
