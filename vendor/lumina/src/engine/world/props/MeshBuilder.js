import * as THREE from 'three';

/** @import { TextureLibrary } from '../../pixel/Textures.js' */

/**
 * MeshBuilder — accumulates low-poly prop geometry per material and emits one merged
 * mesh per material (few draw calls per prop).
 *
 * Texturing follows the engine rule "16 px per world unit": in the default `'world'` UV mode a
 * face's UVs are its world-space size divided by the texture's repeat size
 * (`textures.meta(name).units`), so a pixel texture keeps the same texel density on every
 * surface regardless of the primitive's size. `'fit'` maps the whole texture across a face
 * (for decals such as doors, windows, crates).
 *
 * Every vertex also carries a colour (tint × optional ambient-occlusion callback) and, for
 * wind-animated materials (`material.userData.wind`), the `aSway` / `aPhase` attributes read by
 * the foliage wind shader.
 *
 * Face conventions for boxes (s → texture u, t → texture v):
 *  - side faces: s runs left → right as seen from outside, t runs bottom → top
 *  - top (+Y):   s = +x, t = -z  (t = 0 at the +Z edge)
 *  - bottom:     s = +x, t = +z
 */

/**
 * Rotation accepted by `trs` / `push` / the `rot` option: a yaw (radians), an Euler
 * `[rx, ry, rz, order?]` (order defaults to 'XYZ') or a quaternion.
 * @typedef {number|(number|THREE.EulerOrder)[]|THREE.Quaternion} Rotation
 */
/**
 * Per-material vertex streams, accumulated until `build()`.
 * @typedef {object} MeshPart
 * @property {THREE.Material} material
 * @property {number[]} pos
 * @property {number[]} nrm
 * @property {number[]} uv
 * @property {number[]} col
 * @property {number[]} sway
 * @property {number[]} phase
 * @property {number[]} ctr
 * @property {number[]} idx
 */
/**
 * UV / tint spec of one planar grid (a `box()` face; `_grid()`). `scale` overrides the world units
 * per texture repeat, `off` is in world units ('world') or repeats ('fit').
 * @typedef {object} FaceSpec
 * @property {string|THREE.Material} [mat]
 * @property {'world'|'fit'} [uv]
 * @property {number[]} [off]
 * @property {number[]} [rep]
 * @property {number[]} [scale]
 * @property {boolean} [rotUV]
 * @property {boolean} [flipU]
 * @property {number[]} [cutsS]
 * @property {number[]} [cutsT]
 * @property {number[]} [color]
 */
/**
 * `lathe()` options (see there).
 * @typedef {object} LatheOptions
 * @property {number} [segments]
 * @property {number} [uRepeat]
 * @property {number} [vScale]
 * @property {number} [vOff]
 * @property {number} [phase]
 * @property {boolean} [smooth]
 * @property {string|THREE.Material|boolean} [capTop]
 * @property {string|THREE.Material|boolean} [capBottom]
 * @property {(ring: number, seg: number, angle: number) => number} [radiusFn]
 * @property {(ring: number, seg: number, angle: number) => number} [yFn]
 * @property {number} [normalUp]
 * @property {number[]} [at]
 * @property {Rotation} [rot]
 * @property {number|number[]} [scale]
 * @property {number[]} [color]
 * @property {(ring: number, seg: number) => number[]} [colorFn]
 */

const FACE_DEFS = {
  pz: { o: [-1, -1, 1], s: [1, 0, 0], t: [0, 1, 0], n: [0, 0, 1], sd: 0, td: 1 },
  nz: { o: [1, -1, -1], s: [-1, 0, 0], t: [0, 1, 0], n: [0, 0, -1], sd: 0, td: 1 },
  px: { o: [1, -1, 1], s: [0, 0, -1], t: [0, 1, 0], n: [1, 0, 0], sd: 2, td: 1 },
  nx: { o: [-1, -1, -1], s: [0, 0, 1], t: [0, 1, 0], n: [-1, 0, 0], sd: 2, td: 1 },
  py: { o: [-1, 1, 1], s: [1, 0, 0], t: [0, 0, -1], n: [0, 1, 0], sd: 0, td: 2 },
  ny: { o: [-1, -1, -1], s: [1, 0, 0], t: [0, 0, 1], n: [0, -1, 0], sd: 0, td: 2 },
};
const FACE_ORDER = ['pz', 'nz', 'px', 'nx', 'py', 'ny'];
const VC = Object.freeze({ vertexColors: true });

const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Compose a transform matrix.
 * @param {number[]} [pos] [x, y, z]
 * @param {Rotation} [rot] yaw (radians) | [rx, ry, rz, order?] Euler (default order XYZ) | quaternion
 * @param {number|number[]} [scale]
 * @param {THREE.Matrix4} [target]
 */
export function trs(pos = null, rot = null, scale = null, target = new THREE.Matrix4()) {
  _t.set(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0);
  if (rot == null) _q.identity();
  else if (typeof rot === 'number') _q.setFromEuler(_e.set(0, rot, 0));
  else if (/** @type {THREE.Quaternion} */ (rot).isQuaternion) _q.copy(/** @type {THREE.Quaternion} */ (rot));
  else _q.setFromEuler(_e.set(rot[0], rot[1], rot[2], rot[3] || 'XYZ'));
  if (scale == null) _s.set(1, 1, 1);
  else if (typeof scale === 'number') _s.set(scale, scale, scale);
  else _s.set(scale[0], scale[1], scale[2]);
  return target.compose(_t, _q, _s);
}

export class MeshBuilder {
  /**
   * @param {TextureLibrary} textures
   * @param {{ ao?: (x:number, y:number, z:number) => number }} [opts]
   */
  constructor(textures, { ao = null } = {}) {
    this.textures = textures;
    /** @type {Map<THREE.Material, MeshPart>} */
    this.parts = new Map();
    /** Current transform applied to every emitted vertex. */
    this.matrix = new THREE.Matrix4();
    this._stack = [];
    /** Vertex tint [r, g, b] (linear multiplier, may exceed 1). */
    this.color = [1, 1, 1];
    /**
     * Wind sway weight: number or (x, y, z) => number (builder space).
     * @type {number|((x: number, y: number, z: number) => number)}
     */
    this.sway = 0;
    /** Wind phase offset. */
    this.phase = 0;
    /** Optional ambient-occlusion callback (builder-space position) → multiplier. */
    this.ao = ao;
    /** Billboard pivot (local coords, transformed like vertices) for `userData.billboard` materials. */
    this.center = [0, 0, 0];
  }

  /** Resolve a material: a texture name → cached library material with vertex colours. */
  mat(m, extra = null) {
    if (typeof m !== 'string') return m;
    return this.textures.material(m, extra ? { vertexColors: true, ...extra } : VC);
  }

  /** World size of one texture repeat for a material ([1, 1] when unknown). */
  units(material) {
    const u = material.userData.units;
    if (u) return u;
    const t = material.userData.texture;
    return t ? this.textures.meta(t).units : [1, 1];
  }

  /** Push a transform (multiplied onto the current one). */
  push(pos = null, rot = null, scale = null) {
    this._stack.push(this.matrix.clone());
    this.matrix.multiply(trs(pos, rot, scale, _m));
    return this;
  }

  /** Push an explicit matrix. */
  pushMatrix(m) {
    this._stack.push(this.matrix.clone());
    this.matrix.multiply(m);
    return this;
  }

  pop() {
    this.matrix.copy(this._stack.pop());
    return this;
  }

  /** Transform a local point by the current matrix (returns a new Vector3). */
  point(x, y, z) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.matrix);
  }

  /** Run `fn` with a temporary tint. */
  tinted(color, fn) {
    const prev = this.color;
    this.color = color;
    fn();
    this.color = prev;
    return this;
  }

  _part(material) {
    let p = this.parts.get(material);
    if (!p) {
      p = { material, pos: [], nrm: [], uv: [], col: [], sway: [], phase: [], ctr: [], idx: [] };
      this.parts.set(material, p);
    }
    return p;
  }

  _local(opts) {
    if (!opts || (!opts.at && opts.rot == null && opts.scale == null)) return this.matrix;
    return new THREE.Matrix4().multiplyMatrices(this.matrix, trs(opts.at, opts.rot, opts.scale));
  }

  /** Emit one vertex (local coords transformed by M). Returns its index within the part. */
  _vert(part, M, NM, x, y, z, nx, ny, nz, u, v, color) {
    _p.set(x, y, z).applyMatrix4(M);
    _n.set(nx, ny, nz).applyMatrix3(NM).normalize();
    const i = part.pos.length / 3;
    part.pos.push(_p.x, _p.y, _p.z);
    part.nrm.push(_n.x, _n.y, _n.z);
    part.uv.push(u, v);
    const c = color || this.color;
    const ao = this.ao ? this.ao(_p.x, _p.y, _p.z) : 1;
    part.col.push(c[0] * ao, c[1] * ao, c[2] * ao);
    const sw = typeof this.sway === 'function' ? this.sway(_p.x, _p.y, _p.z) : this.sway;
    part.sway.push(sw);
    part.phase.push(this.phase);
    if (part.material.userData.billboard) {
      _a.fromArray(this.center).applyMatrix4(M);
      part.ctr.push(_a.x, _a.y, _a.z);
    }
    return i;
  }

  /**
   * A (possibly subdivided) planar rectangle spanned by sDir·sLen and tDir·tLen from origin.
   * spec: { uv:'world'|'fit', off:[u,v] (world units, or repeats for fit), rep:[ru,rv] (fit),
   *         scale:[uu,vu] (world units per repeat override), rotUV, flipU, cutsS, cutsT, color }
   */
  _grid(material, M, NM, origin, sDir, tDir, sLen, tLen, n, spec = {}) {
    const part = this._part(material);
    const cut = (arr, len) => {
      const out = [0];
      if (arr) for (const c of arr) if (c > 1e-4 && c < len - 1e-4) out.push(c);
      out.push(len);
      return out.sort((a, b) => a - b);
    };
    const sc = cut(spec.cutsS, sLen);
    const tc = cut(spec.cutsT, tLen);
    const fit = spec.uv === 'fit';
    const units = spec.scale || this.units(material);
    const off = spec.off || [0, 0];
    const rep = spec.rep || [1, 1];
    const base = part.pos.length / 3;
    for (let b = 0; b < tc.length; b++) {
      for (let a = 0; a < sc.length; a++) {
        const s = sc[a];
        const t = tc[b];
        const x = origin[0] + sDir[0] * s + tDir[0] * t;
        const y = origin[1] + sDir[1] * s + tDir[1] * t;
        const z = origin[2] + sDir[2] * s + tDir[2] * t;
        let u;
        let v;
        if (fit) {
          u = (s / sLen) * rep[0] + off[0];
          v = (t / tLen) * rep[1] + off[1];
        } else if (spec.rotUV) {
          u = (t + off[0]) / units[0];
          v = (s + off[1]) / units[1];
        } else {
          u = (s + off[0]) / units[0];
          v = (t + off[1]) / units[1];
        }
        if (spec.flipU) u = -u;
        this._vert(part, M, NM, x, y, z, n[0], n[1], n[2], u, v, spec.color);
      }
    }
    const W = sc.length;
    for (let b = 0; b < tc.length - 1; b++) {
      for (let a = 0; a < W - 1; a++) {
        const i0 = base + b * W + a;
        part.idx.push(i0, i0 + 1, i0 + W + 1, i0, i0 + W + 1, i0 + W);
      }
    }
  }

  /**
   * Axis-aligned box centred at `opts.at` (then rotated by `opts.rot`), in the current transform.
   * @param {string|THREE.Material} material default material for every face
   * @param {number[]} size [sx, sy, sz]
   * @param {{ at?:number[], rot?:Rotation,
   *           faces?:Record<string, boolean|string|THREE.Material|FaceSpec>,
   *           uv?:'world'|'fit', off?:number[], rep?:number[], rotUV?:boolean, color?:number[],
   *           cutsT?:number[], cutsS?:number[], scale?:number[] }} [opts]
   *   faces: per face key (pz,nz,px,nx,py,ny) → false (skip) | true / missing (defaults) |
   *   material | FaceSpec {mat, uv, off, …}. `scale` is read twice: as the transform scale
   *   (`_local`) and as every face's UV `scale` (units per repeat); no caller sets it.
   */
  box(material, size, opts = {}) {
    const M = this._local(opts);
    const NM = new THREE.Matrix3().getNormalMatrix(M);
    const h = [size[0] / 2, size[1] / 2, size[2] / 2];
    for (const key of FACE_ORDER) {
      let f = opts.faces ? opts.faces[key] : undefined;
      if (f === false) continue;
      if (f === undefined || f === true) f = {};
      else if (typeof f === 'string' || /** @type {THREE.Material} */ (f).isMaterial) f = { mat: /** @type {string|THREE.Material} */ (f) };
      const spec = { uv: opts.uv, off: opts.off, rep: opts.rep, rotUV: opts.rotUV, color: opts.color, scale: opts.scale, .../** @type {FaceSpec} */ (f) };
      const d = FACE_DEFS[key];
      if (spec.cutsT === undefined && d.td === 1) spec.cutsT = opts.cutsT;
      const mat = this.mat(spec.mat || material);
      const origin = [d.o[0] * h[0], d.o[1] * h[1], d.o[2] * h[2]];
      this._grid(mat, M, NM, origin, d.s, d.t, size[d.sd], size[d.td], d.n, spec);
    }
    return this;
  }

  /**
   * Planar convex polygon (fan triangulated). UVs are projected onto uAxis / vAxis from `origin`
   * (world units / texture units, plus `off`).
   * @param {string|THREE.Material} material
   * @param {number[][]} pts local points [[x,y,z], …] (counter-clockwise seen from the front)
   * @param {{ uAxis:number[], vAxis:number[], origin?:number[], off?:number[], scale?:number[], color?:number[], normal?:number[] }} opts
   */
  poly(material, pts, opts) {
    const mat = this.mat(material);
    const part = this._part(mat);
    const M = this._local(opts);
    const NM = new THREE.Matrix3().getNormalMatrix(M);
    const units = opts.scale || this.units(mat);
    const o = opts.origin || [0, 0, 0];
    const off = opts.off || [0, 0];
    let nrm = opts.normal;
    if (!nrm) {
      _a.fromArray(pts[0]);
      _b.fromArray(pts[1]).sub(_a);
      _c.fromArray(pts[2]).sub(_a);
      _b.cross(_c).normalize();
      nrm = [_b.x, _b.y, _b.z];
    }
    const base = part.pos.length / 3;
    for (const p of pts) {
      const dx = p[0] - o[0];
      const dy = p[1] - o[1];
      const dz = p[2] - o[2];
      const u = (dx * opts.uAxis[0] + dy * opts.uAxis[1] + dz * opts.uAxis[2] + off[0]) / units[0];
      const v = (dx * opts.vAxis[0] + dy * opts.vAxis[1] + dz * opts.vAxis[2] + off[1]) / units[1];
      this._vert(part, M, NM, p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], u, v, opts.color);
    }
    for (let i = 1; i < pts.length - 1; i++) part.idx.push(base, base + i, base + i + 1);
    return this;
  }

  /**
   * Quad with explicit UVs per corner (p0..p3 counter-clockwise from the front).
   * @param {string|THREE.Material} material
   * @param {number[][]} pts 4 points
   * @param {number[][]} uvs 4 [u, v]
   * @param {{ normals?: number[][], color?: number[], colors?: number[][], at?: number[],
   *           rot?: Rotation, scale?: number|number[] }} [opts]
   */
  quad(material, pts, uvs, opts = {}) {
    const mat = this.mat(material);
    const part = this._part(mat);
    const M = this._local(opts);
    const NM = new THREE.Matrix3().getNormalMatrix(M);
    let fn = null;
    if (!opts.normals) {
      _a.fromArray(pts[0]);
      _b.fromArray(pts[1]).sub(_a);
      _c.fromArray(pts[3]).sub(_a);
      _b.cross(_c).normalize();
      fn = [_b.x, _b.y, _b.z];
    }
    const base = part.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      const n = opts.normals ? opts.normals[i] : fn;
      const col = opts.colors ? opts.colors[i] : opts.color;
      this._vert(part, M, NM, pts[i][0], pts[i][1], pts[i][2], n[0], n[1], n[2], uvs[i][0], uvs[i][1], col);
    }
    part.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }

  /** Single triangle with explicit uvs (and optional explicit normal). */
  tri(material, a, b, c, uva, uvb, uvc, opts = {}) {
    const mat = this.mat(material);
    const part = this._part(mat);
    const M = this._local(opts);
    const NM = new THREE.Matrix3().getNormalMatrix(M);
    let n = opts.normal;
    if (!n) {
      _a.fromArray(a);
      _b.fromArray(b).sub(_a);
      _c.fromArray(c).sub(_a);
      _b.cross(_c).normalize();
      n = [_b.x, _b.y, _b.z];
    }
    const base = part.pos.length / 3;
    this._vert(part, M, NM, a[0], a[1], a[2], n[0], n[1], n[2], uva[0], uva[1], opts.color);
    this._vert(part, M, NM, b[0], b[1], b[2], n[0], n[1], n[2], uvb[0], uvb[1], opts.color);
    this._vert(part, M, NM, c[0], c[1], c[2], n[0], n[1], n[2], uvc[0], uvc[1], opts.color);
    part.idx.push(base, base + 1, base + 2);
    return this;
  }

  /**
   * Surface of revolution around local +Y through a list of rings (bottom → top).
   * @param {string|THREE.Material} material
   * @param {{y:number, r:number, cx?:number, cz?:number}[]} rings
   * @param {LatheOptions} [opts]
   *   uRepeat: texture repeats around (default: circumference of the widest ring / texture width,
   *   rounded to a whole number so the seam tiles). normalUp biases smooth normals upward.
   *   capTop / capBottom: a material caps that end (`true` = the side material).
   */
  lathe(material, rings, opts = {}) {
    const mat = this.mat(material);
    const segs = opts.segments || 8;
    const M = this._local(opts);
    const NM = new THREE.Matrix3().getNormalMatrix(M);
    const units = this.units(mat);
    let maxR = 0;
    for (const r of rings) maxR = Math.max(maxR, r.r);
    const uRep = opts.uRepeat ?? Math.max(1, Math.round((Math.PI * 2 * maxR) / units[0]));
    const vScale = opts.vScale ?? units[1];
    const phase = opts.phase || 0;
    const smooth = opts.smooth !== false;
    // positions per ring/segment
    const P = [];
    for (let i = 0; i < rings.length; i++) {
      const rg = rings[i];
      const row = [];
      for (let j = 0; j <= segs; j++) {
        const jj = j % segs;
        const ang = phase + (jj / segs) * Math.PI * 2;
        const rr = rg.r * (opts.radiusFn ? opts.radiusFn(i, jj, ang) : 1);
        const yy = rg.y + (opts.yFn ? opts.yFn(i, jj, ang) : 0);
        row.push([(rg.cx || 0) + Math.cos(ang) * rr, yy, (rg.cz || 0) - Math.sin(ang) * rr]);
      }
      P.push(row);
    }
    // cumulative slant length along the profile (for v)
    const V = [0];
    for (let i = 1; i < rings.length; i++) {
      const a = rings[i - 1];
      const b = rings[i];
      V.push(V[i - 1] + Math.hypot(b.r - a.r, b.y - a.y, (b.cx || 0) - (a.cx || 0), (b.cz || 0) - (a.cz || 0)));
    }
    const vOff = opts.vOff || 0;
    const part = this._part(mat);
    const up = opts.normalUp || 0;
    if (smooth) {
      const base = part.pos.length / 3;
      for (let i = 0; i < rings.length; i++) {
        const lo = rings[Math.max(0, i - 1)];
        const hi = rings[Math.min(rings.length - 1, i + 1)];
        const dr = hi.r - lo.r;
        const dy = hi.y - lo.y;
        const len = Math.hypot(dr, dy) || 1;
        let nr = dy / len;
        let ny = -dr / len + up;
        const nl = Math.hypot(nr, ny) || 1;
        nr /= nl;
        ny /= nl;
        for (let j = 0; j <= segs; j++) {
          const ang = phase + ((j % segs) / segs) * Math.PI * 2;
          const p = P[i][j];
          const col = opts.colorFn ? opts.colorFn(i, j % segs) : opts.color;
          this._vert(part, M, NM, p[0], p[1], p[2], Math.cos(ang) * nr, ny, -Math.sin(ang) * nr,
            (j / segs) * uRep, (V[i] + vOff) / vScale, col);
        }
      }
      const W = segs + 1;
      for (let i = 0; i < rings.length - 1; i++) {
        for (let j = 0; j < segs; j++) {
          const i0 = base + i * W + j;
          part.idx.push(i0, i0 + 1, i0 + W + 1, i0, i0 + W + 1, i0 + W);
        }
      }
    } else {
      for (let i = 0; i < rings.length - 1; i++) {
        for (let j = 0; j < segs; j++) {
          const a = P[i][j];
          const b = P[i][j + 1];
          const c = P[i + 1][j + 1];
          const d = P[i + 1][j];
          const u0 = (j / segs) * uRep;
          const u1 = ((j + 1) / segs) * uRep;
          const v0 = (V[i] + vOff) / vScale;
          const v1 = (V[i + 1] + vOff) / vScale;
          _a.fromArray(a);
          _b.fromArray(b).sub(_a);
          _c.fromArray(d).sub(_a);
          if (_c.lengthSq() < 1e-10) _c.fromArray(c).sub(_a);
          _b.cross(_c).normalize();
          if (up) { _b.y += up; _b.normalize(); }
          const n = [_b.x, _b.y, _b.z];
          const col = opts.colorFn ? opts.colorFn(i, j) : opts.color;
          const base = part.pos.length / 3;
          this._vert(part, M, NM, a[0], a[1], a[2], n[0], n[1], n[2], u0, v0, col);
          this._vert(part, M, NM, b[0], b[1], b[2], n[0], n[1], n[2], u1, v0, col);
          this._vert(part, M, NM, c[0], c[1], c[2], n[0], n[1], n[2], u1, v1, col);
          this._vert(part, M, NM, d[0], d[1], d[2], n[0], n[1], n[2], u0, v1, col);
          part.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
    const cap = (ringIdx, top, capMat) => {
      const cm = this.mat(capMat);
      const cu = this.units(cm);
      const cp = this._part(cm);
      const rg = rings[ringIdx];
      const cy = rg.y;
      const base = cp.pos.length / 3;
      const ny = top ? 1 : -1;
      this._vert(cp, M, NM, rg.cx || 0, cy, rg.cz || 0, 0, ny, 0, (rg.cx || 0) / cu[0], -(rg.cz || 0) / cu[1], opts.color);
      for (let j = 0; j < segs; j++) {
        const p = P[ringIdx][j];
        this._vert(cp, M, NM, p[0], p[1], p[2], 0, ny, 0, p[0] / cu[0], -p[2] / cu[1], opts.color);
      }
      for (let j = 0; j < segs; j++) {
        const a = base + 1 + j;
        const b = base + 1 + ((j + 1) % segs);
        if (top) cp.idx.push(base, a, b);
        else cp.idx.push(base, b, a);
      }
    };
    if (opts.capTop) cap(rings.length - 1, true, opts.capTop === true ? mat : opts.capTop);
    if (opts.capBottom) cap(0, false, opts.capBottom === true ? mat : opts.capBottom);
    return this;
  }

  /**
   * Cylinder-like lathe between two points (e.g. a branch or log): builds the rings along +Y and
   * orients them from `a` to `b`.
   * @param {string|THREE.Material} material
   * @param {number[]} a start [x,y,z]
   * @param {number[]} b end [x,y,z]
   * @param {number} r0 radius at a
   * @param {number} r1 radius at b
   * @param {LatheOptions & { rings?: number, twist?: number }} [opts] lathe options (+ `rings` count,
   *   `twist` about the axis in radians)
   */
  tube(material, a, b, r0, r1, opts = {}) {
    const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = dir.length();
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    if (opts.twist) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.twist));
    const n = opts.rings || 2;
    const rings = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      rings.push({ y: t * len, r: r0 + (r1 - r0) * t });
    }
    this.pushMatrix(new THREE.Matrix4().compose(new THREE.Vector3(a[0], a[1], a[2]), q, new THREE.Vector3(1, 1, 1)));
    this.lathe(material, rings, opts);
    this.pop();
    return this;
  }

  /** Number of vertices emitted so far (all materials). */
  get vertexCount() {
    let n = 0;
    for (const p of this.parts.values()) n += p.pos.length / 3;
    return n;
  }

  /**
   * Create the merged meshes (one per material).
   * @param {string} [name]
   * @param {{ castShadow?: boolean, receiveShadow?: boolean }} [opts]
   * @returns {{ group: THREE.Group, meshes: THREE.Mesh[], geometries: THREE.BufferGeometry[] }}
   */
  build(name = 'prop', { castShadow = true, receiveShadow = true } = {}) {
    const group = new THREE.Group();
    group.name = name;
    const meshes = [];
    const geometries = [];
    for (const part of this.parts.values()) {
      if (!part.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(part.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(part.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(part.col, 3));
      if (part.material.userData.wind) {
        g.setAttribute('aSway', new THREE.Float32BufferAttribute(part.sway, 1));
        g.setAttribute('aPhase', new THREE.Float32BufferAttribute(part.phase, 1));
      }
      if (part.material.userData.billboard) g.setAttribute('aCenter', new THREE.Float32BufferAttribute(part.ctr, 3));
      g.setIndex(part.idx);
      g.computeBoundingSphere();
      g.computeBoundingBox();
      // billboards (and wind) move vertices on the GPU: pad the culling bounds
      const pad = (part.material.userData.billboard ? 1.5 : 0) + (part.material.userData.wind ? 0.3 : 0);
      if (pad) {
        g.boundingSphere.radius += pad;
        g.boundingBox.expandByScalar(pad);
      }
      const mesh = new THREE.Mesh(g, part.material);
      // vertices are baked in group space: the mesh itself never moves (skip per-frame matrix composes)
      mesh.matrixAutoUpdate = false;
      const ud = part.material.userData;
      mesh.castShadow = ud.castShadow ?? castShadow;
      mesh.receiveShadow = ud.receiveShadow ?? receiveShadow;
      if (ud.depthMaterial) mesh.customDepthMaterial = ud.depthMaterial;
      mesh.name = `${name}:${ud.texture || part.material.name || 'mat'}`;
      group.add(mesh);
      meshes.push(mesh);
      geometries.push(g);
    }
    this.parts.clear();
    return { group, meshes, geometries };
  }
}
