/**
 * Small reusable geometry details shared by several props (lanterns, flower boxes, UV centring).
 * All functions emit into a MeshBuilder in its current transform.
 */

/**
 * @import { FaceSpec, MeshBuilder } from './MeshBuilder.js'
 * @import { Material } from 'three'
 */

export const TRIM = 'wood_planks_dark';

/**
 * World-UV offset that centres a tiling texture on a face of length L (texture repeat U):
 * either a seam or a panel centre lands on the face centre, whichever puts seams closer to the
 * corners. Use as `off[0]` (u = (s + off) / U).
 */
export function centerOff(L, U) {
  const half = L / 2 / U;
  const gA = Math.abs(half - Math.round(half));
  const gB = Math.abs(half - 0.5 - Math.round(half - 0.5));
  return gA <= gB + 1e-6 ? -L / 2 : -L / 2 + U / 2;
}

/**
 * Side-face spec for a box with centred u offsets on all four sides.
 * @param {number} sx box width (x) @param {number} sz box depth (z) @param {number} U texture repeat width
 * @param {FaceSpec & { vOff?: number }} [extra] merged into each side
 *   face spec; `vOff` (world units) becomes each face's `off[1]` (and is copied along, unused)
 * @returns {Record<'pz'|'nz'|'px'|'nx', FaceSpec>}
 */
export function centeredSides(sx, sz, U, extra = {}) {
  return {
    pz: { off: [centerOff(sx, U), extra.vOff || 0], ...extra },
    nz: { off: [centerOff(sx, U), extra.vOff || 0], ...extra },
    px: { off: [centerOff(sz, U), extra.vOff || 0], ...extra },
    nx: { off: [centerOff(sz, U), extra.vOff || 0], ...extra },
  };
}

/**
 * A square pixel lantern: 4 glowing glass panes, iron corner posts, base plate and pyramid cap.
 * (cx, cy, cz) = centre of the glass body.
 * @param {MeshBuilder} b
 * @param {Material} glass emissive lantern_glass material
 * @param {number} cx
 * @param {number} cy
 * @param {number} cz
 * @param {{ w?:number, h?:number, metal?:string }} [o]
 */
export function lanternGeom(b, glass, cx, cy, cz, { w = 0.24, h = 0.32, metal = 'metal' } = {}) {
  b.box(glass, [w, h, w], { at: [cx, cy, cz], faces: { py: false, ny: false }, uv: 'fit' });
  const hw = w / 2 + 0.012;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.box(metal, [0.045, h + 0.03, 0.045], { at: [cx + sx * hw, cy, cz + sz * hw] });
    }
  }
  const bw = w + 0.08;
  b.box(metal, [bw, 0.05, bw], { at: [cx, cy - h / 2 - 0.02, cz] });
  b.box(metal, [bw * 0.55, 0.05, bw * 0.55], { at: [cx, cy - h / 2 - 0.065, cz] });
  // pyramid cap
  const top = cy + h / 2;
  const e = bw / 2 + 0.02;
  const ay = top + 0.17;
  const A = [cx, ay, cz];
  const C = [[cx - e, top, cz + e], [cx + e, top, cz + e], [cx + e, top, cz - e], [cx - e, top, cz - e]];
  for (let i = 0; i < 4; i++) {
    const p = C[i];
    const q = C[(i + 1) % 4];
    b.tri(metal, p, q, A, [0, 0], [0.5, 0], [0.25, 0.3]);
  }
  b.box(metal, [bw, 0.04, bw], { at: [cx, top + 0.01, cz] });
  b.box(metal, [0.06, 0.1, 0.06], { at: [cx, ay + 0.03, cz] });
  b.box(metal, [0.1, 0.03, 0.1], { at: [cx, ay + 0.09, cz] });
}

/**
 * A planter box with flowers (uses the `flowerbox` alpha texture: planter in the lower
 * 7/16 of the canvas, flowers above). Front face at z = zFront, extends `depth` toward -z.
 * @param {MeshBuilder} b
 */
export function flowerBoxGeom(b, cx, bottomY, zFront, len = 1, depth = 0.28, uShift = 0) {
  const x0 = cx - len / 2;
  const x1 = cx + len / 2;
  const PL = 7 / 16;
  const fb = 'flowerbox';
  // front & back cards (full texture height → flowers stick up)
  b.quad(fb, [[x0, bottomY, zFront], [x1, bottomY, zFront], [x1, bottomY + 1, zFront], [x0, bottomY + 1, zFront]],
    [[uShift, 0], [uShift + len, 0], [uShift + len, 1], [uShift, 1]]);
  const zb = zFront - depth;
  b.quad(fb, [[x1, bottomY, zb], [x0, bottomY, zb], [x0, bottomY + 1, zb], [x1, bottomY + 1, zb]],
    [[uShift + 0.43, 0], [uShift + 0.43 + len, 0], [uShift + 0.43 + len, 1], [uShift + 0.43, 1]]);
  // a middle row of flowers only (cropped above the planter)
  const zm = zFront - depth * 0.5;
  b.quad(fb, [[x0, bottomY + PL - 0.05, zm], [x1, bottomY + PL - 0.05, zm], [x1, bottomY + 1, zm], [x0, bottomY + 1, zm]],
    [[uShift + 0.21, PL - 0.05], [uShift + 0.21 + len, PL - 0.05], [uShift + 0.21 + len, 1], [uShift + 0.21, 1]]);
  // planter ends
  b.quad(fb, [[x1, bottomY, zFront], [x1, bottomY, zb], [x1, bottomY + PL, zb], [x1, bottomY + PL, zFront]],
    [[0, 0], [depth, 0], [depth, PL], [0, PL]]);
  b.quad(fb, [[x0, bottomY, zb], [x0, bottomY, zFront], [x0, bottomY + PL, zFront], [x0, bottomY + PL, zb]],
    [[0, 0], [depth, 0], [depth, PL], [0, PL]]);
  // soil + bottom
  b.box(TRIM, [len - 0.02, 0.04, depth - 0.02], { at: [cx, bottomY + PL - 0.06, zFront - depth / 2], faces: { ny: false }, color: [0.42, 0.34, 0.3] });
  b.box(TRIM, [len, 0.03, depth], { at: [cx, bottomY + 0.015, zFront - depth / 2], faces: { py: false } });
}
