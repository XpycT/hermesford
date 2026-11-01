/**
 * The thaw field — the shared state of the frozen year (docs/contracts/EVERMERE_CAMPAIGN.md §7.1):
 * whether the level is frozen and how thawed each point is, for the props that react to it
 * (windmill sails, ships, icicles), the music and ambience (the `frozen` sections, the iced water,
 * the crackle bed at the front) and the season look. Written only by the thaw package
 * (src/game/thaw/*); everyone else reads. On a level without `environment.frost`: `frozen` false,
 * `at` → 1.
 *
 * How thawed a point is comes from the same numbers the thaw patch draws with (src/game/thaw/
 * ThawKit.js): up to four rings — the front and ≤ 3 local patches — whose radius wobbles ± 1.2 u
 * with the place, and the level-wide melt (`melt`, 0 … 1). `inside(x, z)` is how far (u) a point
 * lies inside the thawed area: < 0 frozen, 0 … 0.75 the dithered melt edge, then ≈ 4 u of wet
 * ground, the season's colour back from 8.75 u on (a ring smaller than 11.7 u draws its zones in,
 * up to 6 ×, so a patch's middle is thawed).
 *
 * In the game chunk: kept tiny (no three.js).
 */

/** @typedef {(x: number, z: number, kind?: string) => void} ThawPassListener */

/** How far inside the thawed area the colour is fully back (u): edge 0.75 + wet 4 + colour 4. */
export const THAW_DEPTH = 8.75;
/** How far inside (u) a point is when the front has reached it: half way through the melt edge. */
export const THAW_REACHED = 0.375;

/** The patch's hash and value noise (ThawKit's GLSL `thH` / `thN`, in doubles). */
const fr = (v) => v - Math.floor(v);
function hash(x, y) {
  let a = fr(x * 0.1031);
  let b = fr(y * 0.1031);
  let c = a;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fr((a + b) * c);
}
function noise(x, y) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  let u = x - i;
  let v = y - j;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  const a = hash(i, j);
  const b = hash(i + 1, j);
  return a + (b - a) * u + (hash(i, j + 1) - a + (a - b + hash(i + 1, j + 1) - hash(i, j + 1)) * u) * v;
}

/**
 * The ring's wobble at a world point (u, ± 1.2): ThawKit's `thS` adds the same.
 * @param {number} x @param {number} z
 */
export function thawWobble(x, z) {
  return (noise(x * 0.21, z * 0.21) * 0.65 + noise(x * 0.53 + 7.1, z * 0.53 + 7.1) * 0.35 - 0.5) * 2.4;
}

export class ThawField {
  constructor() {
    /** The level is frozen (its `frost.until` does not hold). */
    this.frozen = false;
    /** The level has a frost at all (`at` is 1 everywhere without one). */
    this.active = false;
    /** Bumps whenever the field changes (cheap polling). */
    this.version = 0;
    /**
     * The rings: [x, z, radius, —] × 4 — 0 the front, 1–3 the patches; a radius < 0 is no ring.
     * Written by the thaw package every frame a ring moves.
     */
    this.rings = new Float32Array([0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0, 0, 0, -1, 0]);
    /** The level-wide melt: 0 frozen … 1 thawed (a release without a front melts it so). */
    this.melt = 1;
    /**
     * How much of the level's water is iced: 1 frozen … 0 open (the composer scales the `water`
     * ambience by it; `1 - at(x, z)` near a listener for a local value).
     */
    this.ice = 0;
    /**
     * The running front (centre and radius, u), or null: the crackle-and-drip bed is panned to
     * its nearest point (`nearest`).
     * @type {{ x: number, z: number, r: number }|null}
     */
    this.front = null;
    /** @type {Set<ThawPassListener>} */
    this._pass = new Set();
    /** @type {{ id: number, x: number, z: number, kind: string, passed: boolean }[]} */
    this.points = [];
    this._ids = 0;
  }

  /**
   * How far (u) a point lies inside the thawed area: < 0 frozen, ≥ THAW_DEPTH fully thawed.
   * @param {number} x @param {number} z
   * @param {number} [lead] added to every ring's radius (water runs 3 u ahead)
   */
  inside(x, z, lead = 0) {
    if (!this.active) return THAW_DEPTH;
    let s = this.melt * THAW_DEPTH;
    const R = this.rings;
    let w = NaN;
    for (let k = 0; k < 16; k += 4) {
      const r = R[k + 2];
      if (r < 0) continue;
      if (w !== w) w = thawWobble(x, z);
      // (a small ring — a patch, the front's first moments — has its zones drawn in, so its middle
      // is thawed: ThawKit's `thS` does the same)
      s = Math.max(s, (r + lead + w - Math.hypot(x - R[k], z - R[k + 1])) * Math.min(6, Math.max(1, (THAW_DEPTH / 0.75) / Math.max(r, 0.01))));
    }
    return s;
  }

  /**
   * How thawed a point is: 0 frozen … 1 thawed (through the melt edge and the wet band).
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  at(x, z) {
    const s = this.inside(x, z);
    return s <= 0 ? 0 : s >= 4.75 ? 1 : s / 4.75;
  }

  /**
   * The nearest point of the running front to (x, z), into `out` (null without a front).
   * @param {number} x @param {number} z @param {{ x: number, z: number }} [out]
   */
  nearest(x, z, out = { x: 0, z: 0 }) {
    const f = this.front;
    if (!f) return null;
    const d = Math.hypot(x - f.x, z - f.z) || 1;
    out.x = f.x + ((x - f.x) / d) * f.r;
    out.z = f.z + ((z - f.z) / d) * f.r;
    return out;
  }

  /**
   * Has the thaw reached (x, z) — the melt edge half past it?
   * @param {number} x @param {number} z @param {number} [lead]
   */
  reached(x, z, lead = 0) {
    return this.inside(x, z, lead) >= THAW_REACHED;
  }

  /**
   * Called with (x, z, kind) when the front crosses a registered point.
   * @param {ThawPassListener} fn
   * @returns {() => void} unsubscribe
   */
  onPass(fn) {
    this._pass.add(fn);
    return () => this._pass.delete(fn);
  }

  /**
   * A point that reacts to the front (a tree, a roof, a mill, a ship, a fall): `onPass` listeners
   * hear of it when the front crosses it. Registrations belong to the level (`reset`).
   * @param {number} x
   * @param {number} z
   * @param {string} [kind]
   * @returns {number} its id
   */
  register(x, z, kind = '') {
    const id = ++this._ids;
    this.points.push({ id, x, z, kind, passed: this.inside(x, z) >= THAW_REACHED });
    return id;
  }

  /** The front crossed a registered point: its listeners hear of it (the thaw package). @param {{ x: number, z: number, kind: string, passed: boolean }} p */
  pass(p) {
    p.passed = true;
    for (const fn of this._pass) fn(p.x, p.z, p.kind);
  }

  /** A new level: no rings, no points; frozen and active as given. @param {boolean} active @param {boolean} frozen */
  reset(active, frozen) {
    this.active = active;
    this.frozen = active && frozen;
    this.rings.fill(0);
    for (let k = 2; k < 16; k += 4) this.rings[k] = -1;
    this.melt = this.frozen ? 0 : 1;
    this.front = null;
    this.points.length = 0;
    this.version++;
  }
}

/** The one thaw field of the page (the running level's). */
export const thawField = new ThawField();
