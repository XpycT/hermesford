import * as THREE from 'three';
import { runSteps } from '../utils/steps.js';

/**
 * Spatial batching helpers for big levels: cut a set of items (mesh pieces, instances, chunks)
 * into spatially compact groups that are each worth one draw call — small enough for the camera
 * and the shadow pass to cull what they can't see, big enough that the draw calls stay few.
 *
 * Also, for batches of any level: tagged vertex ranges of a merged geometry (`groupByTag`,
 * `taggedRanges`) that `CollapsibleRanges` hides and shows per tag without a draw call of their
 * own (the game's live story groups).
 */

/**
 * k-d partition of `items` into groups whose total weight stays ≤ `maxWeight` and — for groups
 * heavier than `minWeight` — whose positions span at most `maxExtent` world units: such a group is
 * halved along the longer axis of its items' positions at the weighted median, recursively.
 * Deterministic (ties keep the input order); a single item heavier than `maxWeight` forms its own
 * group. With the defaults (no limits) the result is one group with every item, in order.
 * @template T
 * @param {T[]} items
 * @param {{ x: (item: T) => number, z: (item: T) => number, weight?: (item: T) => number,
 *           maxWeight?: number, maxExtent?: number, minWeight?: number }} opts
 *   minWeight (0): groups this light are never split for their extent (a cheap draw call that
 *   spans the map costs less than several)
 * @returns {T[][]} groups, in a stable spatial order
 */
export function kdSplit(items, opts) {
  return runSteps(kdSplitSteps(items, opts));
}

/**
 * {@link kdSplit} as a step generator (src/engine/utils/steps.js): a step per group halved and per
 * group finished. Run to its end it returns what kdSplit returns.
 * @template T
 * @param {T[]} items
 * @param {{ x: (item: T) => number, z: (item: T) => number, weight?: (item: T) => number,
 *           maxWeight?: number, maxExtent?: number, minWeight?: number }} opts
 * @returns {Generator<undefined, T[][]>}
 */
export function* kdSplitSteps(items, { x, z, weight = () => 1, maxWeight = Infinity, maxExtent = Infinity, minWeight = 0 }) {
  if (!items.length) return [];
  const n = items.length;
  const px = new Float64Array(n);
  const pz = new Float64Array(n);
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    px[i] = x(items[i]);
    pz[i] = z(items[i]);
    w[i] = Math.max(0, weight(items[i]) || 0);
  }
  const all = new Array(n);
  for (let i = 0; i < n; i++) all[i] = i;
  yield;
  const out = [];
  // depth first, the lower half before the upper one (a stack: the upper half is pushed first)
  const stack = [all];
  while (stack.length) {
    const idx = stack.pop();
    let total = 0;
    for (const i of idx) total += w[i];
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const i of idx) {
      if (px[i] < x0) x0 = px[i];
      if (px[i] > x1) x1 = px[i];
      if (pz[i] < z0) z0 = pz[i];
      if (pz[i] > z1) z1 = pz[i];
    }
    const wide = Math.max(x1 - x0, z1 - z0) > maxExtent && total > minWeight;
    if (idx.length < 2 || !(total > maxWeight || wide)) {
      out.push(idx);
      continue;
    }
    const sorted = sortByKey(idx, x1 - x0 >= z1 - z0 ? px : pz);
    // weighted median: the first cut where the left half reaches half the weight (never empty)
    let acc = 0;
    let cut = 1;
    for (let k = 0; k < sorted.length - 1; k++) {
      acc += w[sorted[k]];
      cut = k + 1;
      if (acc >= total / 2) break;
    }
    stack.push(sorted.slice(cut), sorted.slice(0, cut));
    yield;
  }
  const groups = [];
  for (const g of out) {
    // (ascending indices: a numeric typed-array sort)
    groups.push(Array.from(Int32Array.from(g).sort(), (i) => items[i]));
    yield;
  }
  return groups;
}

/**
 * `idx` (indices into `key`) sorted by (key[i], i) ascending — exactly what
 * `idx.slice().sort((a, b) => key[a] - key[b] || a - b)` gives (the order is strict: every index
 * differs), a few times faster: a quicksort over typed arrays, no comparator call. Keys that are
 * NaN take that comparator sort (it has no strict order to reproduce otherwise).
 * @param {number[]} idx
 * @param {Float64Array} key
 * @returns {number[]}
 */
export function sortByKey(idx, key) {
  const n = idx.length;
  const ids = Int32Array.from(idx);
  const keys = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const v = key[ids[k]];
    if (v !== v) return idx.slice().sort((a, b) => key[a] - key[b] || a - b);
    keys[k] = v;
  }
  // (comparisons and swaps written out: this is the hot loop of a big level's batching)
  const stack = [0, n - 1];
  while (stack.length) {
    let hi = stack.pop();
    let lo = stack.pop();
    while (hi - lo > 12) {
      // median of three (lo, mid, hi put in order) as the pivot, Hoare partition
      const mid = (lo + hi) >>> 1;
      let tk;
      let ti;
      if (keys[mid] < keys[lo] || (keys[mid] === keys[lo] && ids[mid] < ids[lo])) {
        tk = keys[mid]; keys[mid] = keys[lo]; keys[lo] = tk;
        ti = ids[mid]; ids[mid] = ids[lo]; ids[lo] = ti;
      }
      if (keys[hi] < keys[lo] || (keys[hi] === keys[lo] && ids[hi] < ids[lo])) {
        tk = keys[hi]; keys[hi] = keys[lo]; keys[lo] = tk;
        ti = ids[hi]; ids[hi] = ids[lo]; ids[lo] = ti;
      }
      if (keys[hi] < keys[mid] || (keys[hi] === keys[mid] && ids[hi] < ids[mid])) {
        tk = keys[hi]; keys[hi] = keys[mid]; keys[mid] = tk;
        ti = ids[hi]; ids[hi] = ids[mid]; ids[mid] = ti;
      }
      const pk = keys[mid];
      const pi = ids[mid];
      let i = lo;
      let j = hi;
      while (i <= j) {
        while (keys[i] < pk || (keys[i] === pk && ids[i] < pi)) i++;
        while (keys[j] > pk || (keys[j] === pk && ids[j] > pi)) j--;
        if (i <= j) {
          tk = keys[i]; keys[i] = keys[j]; keys[j] = tk;
          ti = ids[i]; ids[i] = ids[j]; ids[j] = ti;
          i++;
          j--;
        }
      }
      // the smaller side later, the larger one now
      if (j - lo < hi - i) {
        stack.push(i, hi);
        hi = j;
      } else {
        stack.push(lo, j);
        lo = i;
      }
    }
    for (let a = lo + 1; a <= hi; a++) {
      const kv = keys[a];
      const iv = ids[a];
      let b = a - 1;
      while (b >= lo && (keys[b] > kv || (keys[b] === kv && ids[b] > iv))) {
        keys[b + 1] = keys[b];
        ids[b + 1] = ids[b];
        b--;
      }
      keys[b + 1] = kv;
      ids[b + 1] = iv;
    }
  }
  return Array.from(ids);
}

/**
 * Order `items` so that the items of each tag are adjacent: the untagged ones (tag `null` or
 * `undefined`) first in their order, then each tag's in the order the tags first appear (stable).
 * Without any tag the same items in the same order. Used before merging a batch whose pieces
 * carry tags (`taggedRanges`): each tag then owns one vertex range of the merged geometry.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => any} tagOf
 * @returns {T[]}
 */
export function groupByTag(items, tagOf) {
  /** @type {Map<any, T[]>} */
  const byTag = new Map();
  const out = [];
  for (const it of items) {
    const tag = tagOf(it);
    if (tag == null) { out.push(it); continue; }
    let list = byTag.get(tag);
    if (!list) byTag.set(tag, (list = []));
    list.push(it);
  }
  for (const list of byTag.values()) out.push(...list);
  return out;
}

/**
 * The vertices one tag owns in a merged geometry (CollapsibleRanges).
 * @typedef {object} TaggedRange
 * @property {any} tag
 * @property {THREE.BufferGeometry} geometry the merged geometry
 * @property {number} start first vertex
 * @property {number} count vertices
 * @property {string[]} attributes the attributes that place a vertex in the vertex shader (what
 *   a collapse writes: `position`, plus e.g. the wind attributes of a tree batch)
 */

/**
 * The tagged vertex ranges of a geometry merged (mergeGeometries: vertices appended in order) from
 * pieces of `counts[k]` vertices tagged `tags[k]` (null: untagged): consecutive pieces of one tag
 * form one range.
 * @param {THREE.BufferGeometry} geometry
 * @param {number[]} counts
 * @param {any[]} tags
 * @param {string[]} attributes see TaggedRange (names the geometry lacks are left out)
 * @returns {TaggedRange[]}
 */
export function taggedRanges(geometry, counts, tags, attributes) {
  const names = attributes.filter((n) => geometry.getAttribute(n));
  /** @type {TaggedRange[]} */
  const out = [];
  let at = 0;
  /** @type {TaggedRange|null} */
  let last = null;
  for (let k = 0; k < counts.length; k++) {
    const tag = tags[k] ?? null;
    if (tag !== null) {
      if (last && last.tag === tag && last.start + last.count === at) last.count += counts[k];
      else out.push((last = { tag, geometry, start: at, count: counts[k], attributes: names }));
    }
    at += counts[k];
  }
  return out;
}

/**
 * Vertex ranges of merged batches that are hidden and shown again per tag, without a mesh, a
 * material or a draw call added or removed — the live story groups of a level (World,
 * docs/specs/STORY_SCRIPT.md §9.5) are merged into the level's own batches this way.
 *
 * Hiding a tag collapses each of its ranges: every vertex takes the values of the range's first
 * vertex in the attributes that place it (TaggedRange.attributes), so every triangle of the range
 * is degenerate and nothing of it is rasterised — in the colour pass and in the shadow pass, which
 * draws the same geometry (shadow-only proxies are merged geometries of their own: their ranges
 * are registered too). Showing it copies the values saved at `add` back. Either way only the
 * range is uploaded (`BufferAttribute.addUpdateRange`). A collapsed vertex is one of the range's
 * own, so the geometry's bounding sphere / box (and a `cullByBox` box) stay valid.
 */
export class CollapsibleRanges {
  constructor() {
    /**
     * @type {Map<any, { start: number, count: number,
     *   attrs: { attr: THREE.BufferAttribute, saved: THREE.TypedArray }[] }[]>}
     */
    this._byTag = new Map();
    /** @type {Set<any>} the tags hidden now */
    this._hidden = new Set();
  }

  /**
   * Register ranges (their values now are what showing them restores). Call before the tag is
   * first hidden; a tag hidden already gets its new ranges collapsed at once.
   * @param {TaggedRange[]} ranges
   */
  add(ranges) {
    for (const r of ranges ?? []) {
      if (!(r.count > 1)) continue; // (one vertex draws no triangle)
      const attrs = [];
      for (const name of r.attributes) {
        const attr = r.geometry.getAttribute(name);
        if (!(attr instanceof THREE.BufferAttribute)) continue; // (merged batches hold no interleaved ones)
        const s = attr.itemSize;
        attrs.push({ attr, saved: attr.array.slice(r.start * s, (r.start + r.count) * s) });
      }
      if (!attrs.length) continue;
      let list = this._byTag.get(r.tag);
      if (!list) this._byTag.set(r.tag, (list = []));
      const entry = { start: r.start, count: r.count, attrs };
      list.push(entry);
      // (with its update range even before the first upload — three ignores ranges then; on a
      // geometry already on the GPU another range waiting in the same frame would else be the only
      // one sent, and this collapse would never reach it)
      if (this._hidden.has(r.tag)) this._write(entry, true, true);
    }
  }

  /** Is `tag` hidden now? */
  isHidden(tag) {
    return this._hidden.has(tag);
  }

  /**
   * The ranges and vertices `tag` owns (all registered geometries together).
   * @returns {{ ranges: number, vertices: number }}
   */
  info(tag) {
    const list = this._byTag.get(tag) ?? [];
    return { ranges: list.length, vertices: list.reduce((n, e) => n + e.count, 0) };
  }

  /**
   * Hide (collapse) or show (restore) every range of `tag`.
   * @param {any} tag
   * @param {boolean} hidden
   * @param {{ upload?: boolean }} [opts] upload (true): upload only the ranges written
   *   (`addUpdateRange`); false: a geometry not yet on the GPU (being built) — its first upload
   *   takes the whole array
   * @returns {number} vertices written (0: no change)
   */
  setHidden(tag, hidden, { upload = true } = {}) {
    if (this._hidden.has(tag) === hidden) return 0;
    if (hidden) this._hidden.add(tag);
    else this._hidden.delete(tag);
    let n = 0;
    for (const e of this._byTag.get(tag) ?? []) {
      this._write(e, hidden, upload);
      n += e.count;
    }
    return n;
  }

  /**
   * @param {{ start: number, count: number, attrs: { attr: THREE.BufferAttribute,
   *   saved: THREE.TypedArray }[] }} e
   * @param {boolean} hidden
   * @param {boolean} upload
   */
  _write(e, hidden, upload) {
    for (const { attr, saved } of e.attrs) {
      const a = attr.array;
      const s = attr.itemSize;
      const from = e.start * s;
      const end = from + e.count * s;
      if (hidden) {
        // every vertex onto the first: the filled span doubles with each copyWithin (a few memmoves)
        for (let filled = s; filled < end - from;) {
          const n = Math.min(filled, end - from - filled);
          a.copyWithin(from + filled, from, from + n);
          filled += n;
        }
      } else a.set(saved, from);
      if (upload) attr.addUpdateRange(from, end - from);
      attr.needsUpdate = true;
    }
  }

  /** Forget every range (the geometries belong to their batches). */
  clear() {
    this._byTag.clear();
    this._hidden.clear();
  }
}

/** Triangle count of a BufferGeometry (indexed or not). */
export function triangleCount(geometry) {
  if (!geometry) return 0;
  const n = geometry.index ? geometry.index.count : (geometry.attributes.position?.count ?? 0);
  return n / 3;
}

/**
 * Frustum-cull a static mesh by its world-space bounding **box** instead of three.js' bounding
 * sphere. A batch of flat, wide terrain or a row of houses has a sphere far bigger than the
 * geometry — it stays "visible" long after it left the view, above all for the tilted diorama
 * camera and the long shadow frustum. The box is computed once (the mesh must not move; call
 * again after moving it).
 * @param {(THREE.Mesh & { isInstancedMesh?: false })|THREE.InstancedMesh} mesh
 * @param {{ pad?: number,
 *   only?: ((frustum: THREE.Frustum|THREE.FrustumArray) => boolean)|null }} [opts]
 *   pad: world units added on every side (vertex animation: wind sway, billboards);
 *   only: frustums the mesh may be drawn in at all (e.g. shadow frustums), others cull it
 * @returns {THREE.Mesh|THREE.InstancedMesh} the mesh
 */
export function cullByBox(mesh, { pad = 0, only = null } = {}) {
  mesh.updateWorldMatrix(true, false);
  let local;
  if (mesh.isInstancedMesh) {
    if (!mesh.boundingBox) mesh.computeBoundingBox();
    local = mesh.boundingBox;
  } else {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    local = mesh.geometry.boundingBox;
  }
  const box = local.clone().applyMatrix4(mesh.matrixWorld);
  if (pad) box.expandByScalar(pad);
  mesh.userData.cullBox = box;
  mesh.frustumCulled = true;
  mesh.intersectsFrustum = function intersectsFrustumByBox(frustum) {
    if (only && !only(frustum)) return false;
    return frustum.intersectsBox(this.userData.cullBox);
  };
  return mesh;
}
