/**
 * SkyDragon — the evil dragon as a shadow in the sky (a `skyDragon` level object; set-piece of
 * Vanquish the Evil Dragon: docs/contracts/DRAGON_CAMPAIGN.md §5.3, §6.5): a top-down dragon
 * silhouette draped on the terrain, flying loops over its rect, hurling fireballs — telegraphed at
 * the party in a fight, a harmless spectacle on the village and the land in view outside one; it
 * cannot be attacked. When the story takes it away (presence) it **escapes** where the player sees
 * it: at 12 u/s it first sweeps over what the camera looks at — the story's shot or the player;
 * from out of view behind the look point when it is far or already level with the point or past
 * it along its leave, and following a shot that moves the camera — then flies off
 * toward `leave`, its shadow dark 2.5 s more, then fading over 5 s (`ESCAPE`). When the same story
 * change brought a boss down (a boss whose intro on appearing, `introOnSpawn`, starts at the next
 * step: the dragon's descent) it banks hard instead and dives at 22 u/s to the boss's landing
 * point, fading within 7 u of it as the boss's own descent shadow darkens there (at the latest
 * 2.6–3.8 s into the dive; no level data needed). In combat's *ambient* step (a story scene holds
 * the player) it keeps flying and its fireballs fall without damage.
 *
 * Created by `CombatSystem.load` — one per `skyDragon` object, present or not — warmed with the
 * level (`warmup`), updated every frame combat runs (`update(dt, false)`) and in the ambient step
 * (`update(dt, true)`), shown / sent away by `applyPresence`, released by `dispose`; its
 * `state()` is a row of `state().combat.sky`.
 *
 * **Flight.** ≈ 9 u/s, turning at most 50°/s toward a target: a seeded point of its rect, or —
 * one target in three — a low pass straight over the player. Wing-beats at 1.4 Hz, now and then a
 * glide; a `wingbeat` whoosh on a downstroke within 11 u of the player, a distant `roarFar` every
 * 14–28 s.
 *
 * **Volleys.** Every `interval` s (seeded in [least, most]) `volley` fireballs, 0.22 s apart — only
 * while the player is within its rect grown by 6 u (it harries what lies under its flight):
 * - **in a fight** (`sys.engaged`: a boss fight or a foe aggroed near the player): *armed*, at a
 *   point near the player (≤ 2.5 u off), a companion, or a house within 24 u; each with its own
 *   telegraph circle (core's marker API, `radius`, one spec per ball) filling over 1.3 s, and at the
 *   impact `sys.strike`: within 60 % of the radius ATK `SKY_ATK` × `power`, knockdown, kb 2.5; the
 *   rest of the circle × 0.7, kb 1.5 (one hit per target: a shared tag). A ball hurts because it is
 *   armed, whether or not its circle got a marker slot;
 * - **outside a fight and in a scene** (the ambient step): a *spectacle* — harmless, no circle, no
 *   strike — on a house or open ground in the camera's view, never within 5.5 u of the party
 *   (`SPECTACLE`): the village burns around the party, the party is not worn down between fights.
 * Each fireball streaks down from 15 u above, out of the shadow's head, along a slanted line (an
 * atlas quad turned along its flight, sparks and smoke shed behind); the impact — a flash, the
 * blast's frames, flames, smoke, debris, a shockwave ring, a scorch mark with glowing embers fading
 * over 9 s, a shake by distance, `explosion`. A ball that starts to fall in a scene is disarmed.
 *
 * Its randomness is its own seeded RNG (`hashString(obj.id)`), never `Math.random`, never the
 * combat's (the bot's digest stays unchanged on levels without one). Everything it draws is made in
 * the constructor — the shadow mesh (one ShaderMaterial, `luminati-dragonshadow-v1`, compiled by
 * the level's warm-up), the FX quads come from the combat batch, the bursts from the pools the
 * combat warm-up makes (src/engine/fx/presets/dragon.js) — and no light is added.
 *
 * `DragonShadow` (exported) is the draped silhouette itself; the boss (ai/dragon.js) flies with one
 * too.
 *
 * @import { CombatSystem } from './CombatSystem.js'
 * @import { LevelObjectOf } from '../../engine/level/types.js'
 * @import { SkyDragonState } from './types.js'
 * @import { FxQuadParams } from '../../engine/fx/FxQuads.js'
 */
import * as THREE from 'three';
import { RNG, clamp } from '../../engine/utils/math.js';
import { globalUniforms } from '../../engine/render/GlobalUniforms.js';
import { RENDER_ORDER } from '../../engine/constants.js';

const TAU = Math.PI * 2;

/**
 * Flight: cruise speed (u/s), the most it turns (rad/s), a target counts as reached within (u); the
 * leave (speed, fade s); the dive to a landing boss (speed, turn ×: a hard bank, fading within
 * `diveNear` u of the point; past `diveFade` s it fades anyway over `diveLate` s).
 */
const FLY = Object.freeze({
  speed: 9, turn: 50 * (Math.PI / 180), reach: 5, comeFade: 2,
  diveSpeed: 22, diveTurn: 4.8, diveNear: 7, diveFade: 2.6, diveLate: 1.2,
});
/**
 * The escape (presence: absent, no boss coming down): 12 u/s, first over what the camera looks at —
 * aiming `ahead` u past the look point along `leave` (live: a story shot moving the camera takes it
 * along, the dragon keeping pace with a look point that moves faster, up to `pace` u/s: a crane to
 * the pass follows its shadow), turning × `turn`; one farther than `far` u from it — or less than
 * `ahead` u behind it along `leave` (level with it or past it: it would never cross the look) —
 * starts `from` u behind it, out of view; the sweep ends past the point or after `sweepMax` s. Then
 * away toward `leave` at 12 u/s: the shadow dark `hold` s, then fading over `fade` s.
 */
const ESCAPE = Object.freeze({ speed: 12, ahead: 5, turn: 2.6, far: 30, from: 20, sweepMax: 8, hold: 2.5, fade: 5, pace: 26 });
/**
 * A spectacle fireball (outside a fight, in a scene): in the camera's view — `behind` u behind its
 * look point to `ahead` u ahead (open ground from `near` u), `side` u either side — at least `clear`
 * u from every party member (a fireball's radius and a margin); a house there one time in
 * 1 / `houseShare`; `tries` seeded tries for open ground.
 */
const SPECTACLE = Object.freeze({ behind: 4, ahead: 18, near: 7, side: 12, clear: 5.5, houseShare: 0.7, tries: 8 });
/** Wing-beats per second; a glide holds the spread wings 1.5–3 s, one beat cycle in five. */
const BEAT_HZ = 1.4;
/** Fireballs: the fall (s), the height they fall from (u), the spacing within a volley (s). */
const FALL = Object.freeze({ time: 1.3, height: 15, stagger: 0.22, head: 5 });
/**
 * The ATK a fireball's `power` multiplies: 26 × 1.6 = 41.6 → about 25 damage to a level-10 hero
 * (DEF 13), an eighth of the 208 HP; 60 % of the radius knocks down.
 */
export const SKY_ATK = 26;
/** Live fireballs at most (a volley is ≤ 10). */
const MAX_BALLS = 12;
/** Live impact effects at most (each fireball leaves four quads). */
const MAX_FX = 48;

// =================================================================================================
// the draped shadow
// =================================================================================================

/** The silhouette atlas: 4 wing-beat frames of FRAME_W × FRAME_H texels, 8 per unit. */
const FRAME_W = 112;
const FRAME_H = 96;
const TEXELS = 8;
/** The footprint (u) of one frame: 14 × 12. */
const FOOT_W = FRAME_W / TEXELS;
const FOOT_L = FRAME_H / TEXELS;
/** The draped grid: vertices across × along (≈ 0.5 u apart). */
const GRID_X = 29;
const GRID_Z = 25;

const SHADOW_VERTEX = /* glsl */ `
varying vec2 vUv;

void main() {
	vUv = uv;
	// positions are world positions (the CPU drapes the grid every frame): no model matrix
	gl_Position = projectionMatrix * viewMatrix * vec4( position, 1.0 );
}
`;

/**
 * A multiply: the colour written is how much of each channel the shadow takes away, the blending
 * keeps `dst × (1 − src)` — the ground under it darkened as it is, fog and all (a shadow colour
 * blended over fogged ground washed out to nothing). The strength is perceptual: `uAlpha` 0.45
 * keeps (1 − 0.45)⁴ ≈ 9 % of the linear light, which after the grade and the tone map reads like
 * the sun's own shadows of the scene (a × 0.55 multiply did not show at all).
 */
const SHADOW_FRAGMENT = /* glsl */ `
uniform sampler2D uMask;
uniform float uFrame;
uniform float uAlpha;
uniform vec3 uShade;

varying vec2 vUv;

void main() {
	// the wing-beat: two neighbouring frames cross-faded
	float f0 = floor( uFrame );
	float t = uFrame - f0;
	float f1 = mod( f0 + 1.0, 4.0 );
	float a0 = texture2D( uMask, vec2( ( vUv.x + f0 ) * 0.25, vUv.y ) ).a;
	float a1 = texture2D( uMask, vec2( ( vUv.x + f1 ) * 0.25, vUv.y ) ).a;
	float a = mix( a0, a1, t ) * uAlpha;
	if ( a < 0.004 ) discard;
	float k = 1.0 - pow( 1.0 - min( a, 0.99 ), 4.0 );
	gl_FragColor = vec4( uShade * k, 1.0 );
}
`;

/** The shared silhouette atlas (refcounted: made by the first shadow, freed with the last). */
let maskTexture = /** @type {THREE.DataTexture|null} */ (null);
let maskUsers = 0;

/**
 * Paint the 4 frames of the top-down silhouette: head and horns, neck, body, the tail with its
 * blade, and the wings at four points of a beat (spread, rising, raised: narrow, sweeping down),
 * then soften the edge (two box blurs: the shadow of a body high in the sky).
 * @returns {THREE.DataTexture}
 */
function makeMask() {
  const W = FRAME_W * 4;
  const H = FRAME_H;
  const a = new Float32Array(W * H);
  /** @type {(f: number, x: number, y: number) => void} */
  const dot = (f, x, y) => {
    const px = Math.round(f * FRAME_W + FRAME_W / 2 + x);
    const py = Math.round(FRAME_H / 2 - y);
    if (px < f * FRAME_W + 2 || px >= (f + 1) * FRAME_W - 2 || py < 2 || py >= H - 2) return;
    a[py * W + px] = 1;
  };
  /** Fill an ellipse (centre, radii) of frame f. @type {(f: number, cx: number, cy: number, rx: number, ry: number) => void} */
  const ellipse = (f, cx, cy, rx, ry) => {
    for (let y = -ry; y <= ry; y += 0.5) for (let x = -rx; x <= rx; x += 0.5) if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) dot(f, cx + x, cy + y);
  };
  /** Fill a polygon of frame f. @type {(f: number, pts: number[][]) => void} */
  const poly = (f, pts) => {
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    for (let y = y0; y <= y1; y += 0.5) {
      for (let x = x0; x <= x1; x += 0.5) {
        let inside = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i];
          const [xj, yj] = pts[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        if (inside) dot(f, x, y);
      }
    }
  };
  /** A tapered stroke of frame f. @type {(f: number, ax: number, ay: number, bx: number, by: number, ra: number, rb: number) => void} */
  const stroke = (f, ax, ay, bx, by, ra, rb) => {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const r = ra + (rb - ra) * t;
      ellipse(f, ax + (bx - ax) * t, ay + (by - ay) * t, r, r);
    }
  };
  // the wing per frame: its span (× the spread wing) and sweep (rad, + = forward)
  const SPAN = [1, 0.8, 0.56, 0.86];
  const SWEEP = [0, 0.08, 0.14, -0.14];
  const TAIL = [0, 3, 5, 2];
  for (let f = 0; f < 4; f++) {
    // body, neck, head, horns
    ellipse(f, 0, 2, 7, 17);
    stroke(f, 0, 14, 0, 30, 5, 3.4);
    ellipse(f, 0, 35, 4.2, 6.2);
    stroke(f, -2, 33, -6, 27, 1.4, 0.6);
    stroke(f, 2, 33, 6, 27, 1.4, 0.6);
    // the tail, swaying, and its blade
    const sw = TAIL[f];
    stroke(f, 0, -14, sw * 0.4, -28, 5, 3.4);
    stroke(f, sw * 0.4, -28, sw, -40, 3.4, 1.6);
    poly(f, [[sw - 4, -40], [sw, -46.5], [sw + 4, -40], [sw, -42]]);
    // the wings: leading edge to the wrist and the tip, fingers fanning back, scalloped trailing edge
    for (const s of [-1, 1]) {
      const k = SPAN[f];
      const c = Math.cos(SWEEP[f]);
      const sn = Math.sin(SWEEP[f]);
      /** @type {(x: number, y: number) => number[]} a wing point (the near wing's coordinates) turned by the sweep and scaled to the span */
      const P = (x, y) => [s * (x * c) * k, y + x * sn * k];
      const pts = [P(5, 12), P(22, 19), P(36, 17), P(51, 6), P(44, 2), P(46, -6), P(37, -6), P(36, -14), P(26, -10), P(20, -17), P(13, -10), P(6, -12)];
      poly(f, pts);
    }
  }
  // soften: two 3 × 3 box blurs
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(a.length);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        let s = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += a[(y + j) * W + x + i];
        b[y * W + x] = s / 9;
      }
    }
    a.set(b);
  }
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = 255;
    data[i * 4 + 1] = 255;
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = Math.round(clamp(a[i], 0, 1) * 255);
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.name = 'dragon:shadow';
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A dragon's shadow on the ground: the top-down silhouette (4 wing-beat frames, cross-faded, a
 * soft edge) on a 29 × 25 grid the CPU drapes over the terrain every frame it shows (`set`: the
 * ground under every vertex, + 0.08): a multiply of the ground under it, as strong as the
 * scene's sun shadows at `alpha` 0.45 (the blue taken away a little less: a cool shadow; see
 * SHADOW_FRAGMENT). One draw call; hidden while `alpha` is 0. Its material is made
 * at construction: put the mesh in the scene before the level's warm-up and the program compiles
 * with the level.
 */
export class DragonShadow {
  /** @param {THREE.Object3D} parent where the mesh goes (the scene, or a sprite: the grid is in world space) */
  constructor(parent) {
    maskUsers++;
    maskTexture ??= makeMask();
    const n = GRID_X * GRID_Z;
    const geometry = new THREE.BufferGeometry();
    /** World positions, rewritten by `set`. */
    this._pos = new Float32Array(n * 3);
    // the leading row (j = 0, ahead along the heading: `set`) samples the mask's first rows, the
    // head (flipY false: v 0 is the data's row 0, the top of makeMask's frames); the last, the tail
    const uv = new Float32Array(n * 2);
    for (let j = 0; j < GRID_Z; j++) {
      for (let i = 0; i < GRID_X; i++) {
        const k = j * GRID_X + i;
        uv[k * 2] = i / (GRID_X - 1);
        uv[k * 2 + 1] = j / (GRID_Z - 1);
      }
    }
    const index = [];
    for (let j = 0; j + 1 < GRID_Z; j++) {
      for (let i = 0; i + 1 < GRID_X; i++) {
        const a = j * GRID_X + i;
        index.push(a, a + GRID_X, a + 1, a + 1, a + GRID_X, a + GRID_X + 1);
      }
    }
    const pa = new THREE.BufferAttribute(this._pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', pa);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(index);
    this.geometry = geometry;
    this.material = new THREE.ShaderMaterial({
      name: 'DragonShadow',
      uniforms: {
        uMask: { value: maskTexture },
        uFrame: { value: 0 },
        uAlpha: { value: 0 },
        // (a cool shadow: the blue taken away a little less)
        uShade: { value: new THREE.Vector3(1, 1, 0.93) },
      },
      vertexShader: SHADOW_VERTEX,
      fragmentShader: SHADOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
      fog: false,
    });
    this.material.customProgramCacheKey = () => 'luminati-dragonshadow-v1';
    /** The mesh (one draw call; frustum culling off — its vertices move every frame). */
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'DragonShadow';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = RENDER_ORDER.DECALS;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  /** The mask texture (to upload at warm-up). */
  get texture() { return maskTexture; }

  /**
   * Show it at (x, z) heading `heading` (rad: 0 = +X, π/2 = +Z), wing-beat `frame` (0..4, cross-
   * faded), `alpha` (0 hides it), `scale` (× the 14 × 12 u footprint), draped by `groundAt`.
   * @param {number} x @param {number} z @param {number} heading @param {number} frame
   * @param {number} alpha @param {number} scale @param {(x: number, z: number) => number} groundAt
   */
  set(x, z, heading, frame, alpha, scale, groundAt) {
    const on = alpha > 0.004;
    this.mesh.visible = on;
    if (!on) return;
    const u = this.material.uniforms;
    u.uFrame.value = ((frame % 4) + 4) % 4;
    u.uAlpha.value = alpha;
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    const p = this._pos;
    for (let j = 0; j < GRID_Z; j++) {
      // along: the texture's top (j = 0) is the head
      const along = (0.5 - j / (GRID_Z - 1)) * FOOT_L * scale;
      for (let i = 0; i < GRID_X; i++) {
        const across = (i / (GRID_X - 1) - 0.5) * FOOT_W * scale;
        const wx = x + fx * along - fz * across;
        const wz = z + fz * along + fx * across;
        const k = (j * GRID_X + i) * 3;
        p[k] = wx;
        p[k + 1] = groundAt(wx, wz) + 0.08;
        p[k + 2] = wz;
      }
    }
    const attr = /** @type {THREE.BufferAttribute} */ (this.geometry.getAttribute('position'));
    attr.needsUpdate = true;
  }

  /** Hide it. */
  hide() { this.mesh.visible = false; }

  /** Free the mesh, its material and (with the last shadow) the mask. */
  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    maskUsers = Math.max(0, maskUsers - 1);
    if (maskUsers === 0 && maskTexture) {
      maskTexture.dispose();
      maskTexture = null;
    }
  }
}

// =================================================================================================
// the sky dragon
// =================================================================================================

/**
 * A fireball in flight (pooled).
 * @typedef {object} Fireball
 * @property {boolean} on
 * @property {number} t      seconds since launch (< 0: waiting in the volley)
 * @property {number} sx     where it starts (in the sky)
 * @property {number} sy
 * @property {number} sz
 * @property {number} tx     where it lands
 * @property {number} ty
 * @property {number} tz
 * @property {boolean} harmless  thrown outside a fight or in a scene: no marker, no strike
 * @property {boolean} armed  it hurts where it lands (decided at launch, disarmed when it starts
 *   to fall in a scene) — whether or not its telegraph got a marker slot
 * @property {Partial<import('./types.js').MarkerSpec>} m  its own telegraph spec (core copies a
 *   spec at every `setMarker`: one shared spec moved every circle onto the last ball's target)
 * @property {number} marker the telegraph's handle (−1: none)
 * @property {number} quad   the fireball's FX quad (−1: none)
 * @property {number} flash  seconds the white rim is still shown after the impact (≤ 0: done)
 * @property {boolean} started  it began to fall (its quad, telegraph and sound)
 */

/**
 * An impact effect (pooled FX quad).
 * @typedef {object} ImpactFx
 * @property {boolean} on
 * @property {number} h
 * @property {'blast'|'ring'|'scorch'|'embers'} kind
 * @property {number} t
 * @property {number} dur
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} scale
 * @property {number} dirX
 * @property {number} dirZ
 */

/** Unit vector of a leave direction (N = −Z). @type {Record<string, [number, number]>} */
const LEAVE = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };

export class SkyDragon {
  /**
   * @param {{ sys: CombatSystem, obj: LevelObjectOf<'skyDragon'>, seed: number }} init
   *   sys: the combat; obj: its level object (untrusted data: read numbers with care); seed: its
   *   RNG seed (`hashString(obj.id)`)
   */
  constructor({ sys, obj, seed }) {
    /** The combat it flies in. */
    this.sys = sys;
    /** Its level object (the rect it flies over, `interval`, `volley`, `radius`, `power`, `leave`, `ambient`). */
    this.obj = obj;
    /** Its id (the level object's). */
    this.id = typeof obj.id === 'string' ? obj.id : '';
    /** Its own seeded RNG. */
    this.rng = new RNG(seed >>> 0);
    /** There as the story stands (`applyPresence`; a dragon taken away flies off). */
    this.present = true;
    /** Fireballs thrown so far. */
    this.volleys = 0;

    // ---- its data, clamped (level data is untrusted) ----
    const tm = sys.tileMap;
    const W = tm?.width ?? 64;
    const D = tm?.depth ?? 64;
    const num = (v, d, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
    const x0 = num(obj.minX, 0, 0, W);
    const x1 = num(obj.maxX, W, 0, W);
    const z0 = num(obj.minZ, 0, 0, D);
    const z1 = num(obj.maxZ, D, 0, D);
    /** The rect it flies over (world). */
    this.rect = { minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) };
    const iv = Array.isArray(obj.interval) ? obj.interval : [];
    const lo = num(iv[0], 5, 1, 60);
    const hi = num(iv[1], 9, 1, 60);
    /** Seconds between volleys [least, most]. */
    this.interval = [Math.min(lo, hi), Math.max(lo, hi)];
    /** Fireballs per volley (0–10). */
    this.volley = Math.round(num(obj.volley, 2, 0, 10));
    /** A fireball's radius (u). */
    this.radius = num(obj.radius, 2.4, 0.5, 6);
    /** A fireball's power (the motion value of `SKY_ATK`). */
    this.power = num(obj.power, 1.6, 0, 6);
    /** Where it leaves toward ('N' | 'S' | 'E' | 'W'). */
    this.leave = Object.hasOwn(LEAVE, obj.leave) ? obj.leave : 'N';
    /** It flies (harmlessly) in the ambient step. */
    this.ambient = obj.ambient !== false;

    /** Where its shadow is (world x, z): the rect's centre until it flies. */
    this.x = (this.rect.minX + this.rect.maxX) / 2;
    this.z = (this.rect.minZ + this.rect.maxZ) / 2;
    /** Its heading (rad: 0 = +X, π/2 = +Z). */
    this.heading = this.rng.next() * TAU;
    this.speed = FLY.speed;
    /** Its shadow's opacity factor (presence fades it). */
    this.alpha = 1;
    /** Flying off (presence: absent) until it has faded. */
    this.leaving = false;
    /**
     * Where it dives instead of leaving: the landing point of a boss that came down with the same
     * story change (`_landing`); null otherwise.
     * @type {{ x: number, z: number } | null}
     */
    this.goal = null;
    /** Seconds into the dive. */
    this._diveT = 0;
    this._tx = this.x;
    this._tz = this.z;
    this._targetT = 0;
    this._beat = 0;
    this._glide = 0;
    this._lastFrame = 0;
    this._wingCd = 0;
    this._roarT = 14 + this.rng.next() * 14;
    this._volleyT = this._nextInterval() * 0.6;
    /** @type {Fireball[]} */
    this._balls = [];
    for (let i = 0; i < MAX_BALLS; i++) {
      this._balls.push({
        on: false, t: 0, sx: 0, sy: 0, sz: 0, tx: 0, ty: 0, tz: 0, harmless: false, armed: false,
        m: { shape: 'circle', x: 0, y: 0.03, z: 0, r: this.radius, progress: 0, style: 'enemy', alpha: 1, flash: 0 },
        marker: -1, quad: -1, flash: 0, started: false,
      });
    }
    /** @type {ImpactFx[]} */
    this._fx = [];
    for (let i = 0; i < MAX_FX; i++) this._fx.push({ on: false, h: -1, kind: 'blast', t: 0, dur: 1, x: 0, y: 0, z: 0, scale: 1, dirX: 0, dirZ: 1 });
    /** @type {FxQuadParams} scratch quad parameters */
    this._q = { x: 0, y: 0, z: 0, frame: '', index: 0, scale: 1, rot: 0, mode: 'billboard', dirX: 0, dirZ: 1, r: 1, g: 1, b: 1, a: 1 };
    /** The escape's leg (`applyPresence(false)`): over the camera's look first, then away. @type {'sweep'|'away'} */
    this._leg = 'away';
    /** Seconds into the escape's leg. */
    this._legT = 0;
    /** The camera's look point at the last frame and its speed (u/s; the escape keeps pace). */
    this._lookX = NaN;
    this._lookZ = NaN;
    this._lookV = 0;
    /** The houses it may aim at (level objects of type `house`: their centres). */
    this._houses = [];
    for (const o of sys.level?.objects ?? []) {
      if (o.type === 'house' && Number.isFinite(o.x) && Number.isFinite(o.z)) this._houses.push({ x: o.x, z: o.z });
    }
    /** Its shadow on the ground. */
    this.shadow = new DragonShadow(sys.scene);
    this._pickTarget();
  }

  /**
   * One frame (real seconds).
   * @param {number} dt
   * @param {boolean} ambient the ambient step: a story scene holds the player — fly, throw, hurt nobody
   */
  update(dt, ambient) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    const flying = this.present || this.leaving;
    if (ambient && !this.ambient) {
      this._updateBalls(dt, true);
      this._updateFx(dt);
      this._drawShadow(this.present ? this.alpha : 0);
      return;
    }
    if (flying) this._fly(dt);
    // volleys: only while there (and in the ambient step only when it flies in cutscenes)
    if (this.present && !this.leaving && this.volley > 0) {
      this._volleyT -= dt;
      if (this._volleyT <= 0) {
        this._volleyT = this._nextInterval();
        this._throwVolley(ambient);
      }
    }
    this._updateBalls(dt, ambient);
    this._updateFx(dt);
    this._sounds(dt);
    this._drawShadow(this.alpha);
  }

  /**
   * There as the story stands, or not: absent, it leaves toward `leave` and fades — or, when the
   * same story change brought a boss down (`_landing`: the dragon's descent), it dives at the
   * landing point and fades there as the boss's own shadow darkens; present again, it comes back.
   * Called by `CombatSystem.applyPresence` on every story change (after the groups') and when the
   * level is entered (`instant`: the story applied as it stands — no flight away, no fade: it is
   * simply there or not). A level without a story never calls it (present).
   * @param {boolean} present
   * @param {boolean} [instant]
   */
  applyPresence(present, instant = false) {
    const on = !!present;
    if (instant) {
      this.present = on;
      this.leaving = false;
      this.goal = null;
      this.alpha = on ? 1 : 0;
      this.speed = FLY.speed;
      if (!on) this._clearAll();
      this._drawShadow(this.alpha);
      return;
    }
    if (on === this.present && !(on && this.leaving)) return;
    this.present = on;
    if (!on) {
      // the escape — or the dive at a landing boss
      this.leaving = true;
      this.goal = this._landing();
      if (this.goal) {
        this._diveT = 0;
        this._tx = this.goal.x;
        this._tz = this.goal.z;
        return;
      }
      // over what the camera looks at first, then away: from out of view behind the look point
      // when it is far — or already level with the look point or past it along `leave` (it would
      // fly off the other way, never over the shot: the shadow is put back behind the look, where
      // a story's cut on the same frame hides the move)
      this._leg = 'sweep';
      this._legT = 0;
      this._lookX = NaN;
      this._lookV = 0;
      this.alpha = Math.max(this.alpha, 0.6);
      const F = this._look();
      const [lx, lz] = LEAVE[this.leave];
      if (F && (Math.hypot(F.x - this.x, F.z - this.z) > ESCAPE.far || (this.x - F.x) * lx + (this.z - F.z) * lz > -ESCAPE.ahead)) {
        const side = (this.rng.next() - 0.5) * 6;
        this.x = F.x - lx * ESCAPE.from - lz * side;
        this.z = F.z - lz * ESCAPE.from + lx * side;
        this.heading = Math.atan2(lz, lx);
        this.alpha = 1;
      }
      this._aim();
      return;
    }
    // back: in from the side it left by, fading in
    this.leaving = false;
    this.goal = null;
    const [lx, lz] = LEAVE[this.leave];
    const r = this.rect;
    this.x = clamp((r.minX + r.maxX) / 2 + lx * (r.maxX - r.minX) * 0.5, r.minX, r.maxX);
    this.z = clamp((r.minZ + r.maxZ) / 2 + lz * (r.maxZ - r.minZ) * 0.5, r.minZ, r.maxZ);
    this.heading = Math.atan2(-lz, -lx);
    this.speed = FLY.speed;
    this.alpha = 0;
    this._pickTarget();
  }

  /**
   * The level's warm-up: the mask uploaded; the shadow mesh is in the scene (its program compiles
   * with the level's), the quads and bursts it uses are the combat's (warmed by core).
   * @param {THREE.Vector3} far
   */
  warmup(far) {
    void far;
    try { this.sys.engine.renderer.initTexture(this.shadow.texture); } catch { /* not a texture */ }
  }

  /**
   * Its row of `state().combat.sky` (with `heading`, `alpha`, `leaving`, `diving` — its dive at a
   * landing boss — and the fireballs in flight).
   * @returns {SkyDragonState}
   */
  state() {
    let live = 0;
    for (const b of this._balls) if (b.on) live++;
    const row = {
      id: this.id, present: this.present, x: +this.x.toFixed(3), z: +this.z.toFixed(3), volleys: this.volleys,
      heading: +this.heading.toFixed(3), alpha: +this.alpha.toFixed(3), leaving: this.leaving, diving: this.goal !== null, live,
    };
    return row;
  }

  /**
   * Throw one fireball now at (x, z) (sandbox checks; `harmless`: no marker, no strike).
   * @param {number} x @param {number} z @param {boolean} [harmless]
   * @returns {boolean} false when every fireball is in flight
   */
  fireAt(x, z, harmless = false) {
    return this._launch(x, z, harmless, 0);
  }

  /** Release everything it made (meshes, materials, markers, quads). */
  dispose() {
    this._clearAll();
    this.shadow.dispose();
  }

  // ---------------------------------------------------------------------------------------------
  // flight
  // ---------------------------------------------------------------------------------------------

  /**
   * The landing point of a boss that the same story change has brought (`CombatSystem.applyPresence`
   * shows the groups first): the nearest boss of the level, alive and there as the story stands,
   * whose intro on appearing starts at the next step (`_introPending`).
   * @returns {{ x: number, z: number } | null}
   */
  _landing() {
    const sys = this.sys;
    let best = null;
    let bd = Infinity;
    for (const b of sys._bosses) {
      if (!b.alive || sys._hidden.has(b) || !sys._introPending.includes(b)) continue;
      const d = Math.hypot(b.position.x - this.x, b.position.z - this.z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best ? { x: best.position.x, z: best.position.z } : null;
  }

  /** Where the camera looks (the story's shot or the game's: the rig's focus), else the player. */
  _look() {
    const sys = this.sys;
    return sys.rig?.focusPoint ?? sys.player?.position ?? null;
  }

  /**
   * The escape's target: over the sweep, `ESCAPE.ahead` u past the camera's look point along
   * `leave` (it moves with a story shot); away, far along `leave`.
   */
  _aim() {
    const [lx, lz] = LEAVE[this.leave];
    const F = this._look();
    if (this._leg === 'sweep' && F) {
      this._tx = F.x + lx * ESCAPE.ahead;
      this._tz = F.z + lz * ESCAPE.ahead;
      return;
    }
    this._tx = this.x + lx * 400;
    this._tz = this.z + lz * 400;
  }

  /** @param {number} dt */
  _fly(dt) {
    const dive = this.leaving && this.goal !== null;
    const escape = this.leaving && !dive;
    let pace = ESCAPE.speed;
    if (escape) {
      this._legT += dt;
      const F = this._look();
      if (F) {
        // the look point's speed (smoothed; a cut is a jump, not a speed)
        const v = Number.isFinite(this._lookX) ? Math.hypot(F.x - this._lookX, F.z - this._lookZ) / dt : 0;
        if (v < 60) this._lookV += (v - this._lookV) * Math.min(1, dt * 6);
        this._lookX = F.x;
        this._lookZ = F.z;
      }
      if (this._leg === 'sweep') {
        // past the look point along `leave` (or too long at it): away
        const [lx, lz] = LEAVE[this.leave];
        const past = !F || (this.x - F.x) * lx + (this.z - F.z) * lz >= ESCAPE.ahead - 1;
        if (past || this._legT >= ESCAPE.sweepMax) {
          this._leg = 'away';
          this._legT = 0;
        } else pace = clamp(this._lookV * 1.15, ESCAPE.speed, ESCAPE.pace);
      }
      this._aim();
    }
    const wantSpeed = dive ? FLY.diveSpeed : escape ? pace : FLY.speed;
    this.speed += (wantSpeed - this.speed) * Math.min(1, dt * 2);
    const want = Math.atan2(this._tz - this.z, this._tx - this.x);
    let d = want - this.heading;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    const turn = FLY.turn * (dive ? FLY.diveTurn : escape ? ESCAPE.turn : 1) * dt;
    this.heading += clamp(d, -turn, turn);
    this.x += Math.cos(this.heading) * this.speed * dt;
    this.z += Math.sin(this.heading) * this.speed * dt;
    // the wing-beat (a glide now and then)
    if (this._glide > 0) this._glide -= dt;
    else {
      const before = Math.floor(this._beat);
      this._beat += dt * BEAT_HZ;
      if (Math.floor(this._beat) !== before && this.rng.next() < 0.2) this._glide = 1.5 + this.rng.next() * 1.5;
    }
    if (this.leaving) {
      if (dive) {
        // the dive: dark until it is over the landing point (the boss's own shadow darkens there)
        this._diveT += dt;
        let a = Math.min(1, Math.hypot(this._tx - this.x, this._tz - this.z) / FLY.diveNear);
        if (this._diveT > FLY.diveFade) a = Math.min(a, 1 - (this._diveT - FLY.diveFade) / FLY.diveLate);
        this.alpha = Math.min(this.alpha, a);
        if (this.alpha < 0.03) this.alpha = 0;
      } else if (this._leg === 'sweep' || this._legT < ESCAPE.hold) {
        // dark over the camera's look and for a while after (a shadow still fading in comes up)
        this.alpha = Math.min(1, this.alpha + dt / FLY.comeFade);
      } else this.alpha = Math.max(0, this.alpha - dt / ESCAPE.fade);
      if (this.alpha <= 0) {
        this.alpha = 0;
        this.leaving = false;
        this.goal = null;
      }
      return;
    }
    if (this.alpha < 1) this.alpha = Math.min(1, this.alpha + dt / FLY.comeFade);
    this._targetT -= dt;
    if (Math.hypot(this._tx - this.x, this._tz - this.z) < FLY.reach || this._targetT <= 0) this._pickTarget();
  }

  /** The next point to fly to: a seeded point of its rect, or (one in three) a pass over the player. */
  _pickTarget() {
    const r = this.rect;
    const P = this.sys.player?.position;
    this._targetT = 9;
    if (P && this.rng.next() < 0.34) {
      // over the player and on: a point 9 u beyond it on the line from here
      const dx = P.x - this.x;
      const dz = P.z - this.z;
      const d = Math.hypot(dx, dz) || 1;
      this._tx = clamp(P.x + (dx / d) * 9, r.minX - 6, r.maxX + 6);
      this._tz = clamp(P.z + (dz / d) * 9, r.minZ - 6, r.maxZ + 6);
      return;
    }
    const inset = Math.min(4, (r.maxX - r.minX) / 4, (r.maxZ - r.minZ) / 4);
    this._tx = r.minX + inset + this.rng.next() * Math.max(0, r.maxX - r.minX - inset * 2);
    this._tz = r.minZ + inset + this.rng.next() * Math.max(0, r.maxZ - r.minZ - inset * 2);
  }

  /** @returns {number} seconds to the next volley */
  _nextInterval() {
    const [lo, hi] = this.interval;
    return lo + this.rng.next() * (hi - lo);
  }

  /** The beat frame shown (0..4; a glide holds the spread wings). */
  _frame() {
    return this._glide > 0 ? 0 : (this._beat * 4) % 4;
  }

  /** @param {number} alpha */
  _drawShadow(alpha) {
    this.shadow.set(this.x, this.z, this.heading, this._frame(), 0.45 * alpha, 1, (x, z) => this.sys.groundAt(x, z));
  }

  /** @param {number} dt */
  _sounds(dt) {
    if (!this.present || this.alpha < 0.3) return;
    const sys = this.sys;
    const P = sys.player?.position;
    // a whoosh on each downstroke while it passes near the player
    const fr = Math.floor(this._frame());
    this._wingCd -= dt;
    if (P && fr === 3 && this._lastFrame !== 3 && this._wingCd <= 0 && Math.hypot(P.x - this.x, P.z - this.z) < 11) {
      this._wingCd = 0.6;
      sys.sfxAt('wingbeat', this.x, this.z, { volume: 0.9 });
    }
    this._lastFrame = fr;
    this._roarT -= dt;
    if (this._roarT <= 0) {
      this._roarT = 14 + this.rng.next() * 14;
      sys.audio?.playSfx('roarFar', { volume: 0.55 });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // fireballs
  // ---------------------------------------------------------------------------------------------

  /** @param {boolean} ambient */
  _throwVolley(ambient) {
    const sys = this.sys;
    const P = sys.player?.position;
    if (!P) return;
    // it harries what lies under its flight: a player far outside its rect draws no fire
    const r = this.rect;
    if (P.x < r.minX - 6 || P.x > r.maxX + 6 || P.z < r.minZ - 6 || P.z > r.maxZ + 6) return;
    // only a fight draws its fire onto the party; outside one (and in a scene) the volley is a
    // spectacle: harmless, on the houses and the land in the camera's view, never on the party
    const fight = !ambient && !!sys.engaged;
    for (let k = 0; k < this.volley; k++) {
      const t0 = -k * FALL.stagger;
      if (!fight) {
        const at = this._spectacleTarget();
        if (at) this._launch(at.x, at.z, true, t0);
        continue;
      }
      let x = P.x;
      let z = P.z;
      const roll = this.rng.next();
      const allies = sys.allies ?? [];
      const house = roll > 0.85 ? this._houseNear(P.x, P.z, 24) : null;
      if (roll < 0.25 && allies.length) {
        const a = allies[Math.floor(this.rng.next() * allies.length)];
        x = a.position.x;
        z = a.position.z;
      } else if (house) {
        x = house.x + (this.rng.next() - 0.5) * 3;
        z = house.z + (this.rng.next() - 0.5) * 3;
      } else {
        const a = this.rng.next() * TAU;
        const d = Math.sqrt(this.rng.next()) * 2.5;
        x = P.x + Math.cos(a) * d;
        z = P.z + Math.sin(a) * d;
      }
      this._launch(x, z, false, t0);
    }
  }

  /**
   * Where a spectacle fireball falls: in the camera's view (from 4 u behind its look point to
   * 18 u ahead, 12 u either side), at least `SPECTACLE.clear` u from the player and every
   * companion — a house there (seeded pick), else open ground ahead; null when nothing qualifies.
   * @returns {{ x: number, z: number } | null}
   */
  _spectacleTarget() {
    const sys = this.sys;
    const F = sys.rig?.focusPoint ?? sys.player?.position;
    if (!F) return null;
    // the camera's forward and right on the ground (yaw 0: forward −Z)
    const yaw = globalUniforms.uCameraYaw.value;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const S = SPECTACLE;
    /** @type {(x: number, z: number) => boolean} */
    const ok = (x, z) => {
      const dx = x - F.x;
      const dz = z - F.z;
      const along = dx * fx + dz * fz;
      const across = Math.abs(dx * -fz + dz * fx);
      return along >= -S.behind && along <= S.ahead && across <= S.side && this._clearOfParty(x, z);
    };
    let n = 0;
    for (const h of this._houses) if (ok(h.x, h.z)) n++;
    if (n && this.rng.next() < S.houseShare) {
      let pick = Math.floor(this.rng.next() * n);
      for (const h of this._houses) {
        if (!ok(h.x, h.z) || pick-- !== 0) continue;
        const x = h.x + (this.rng.next() - 0.5) * 3;
        const z = h.z + (this.rng.next() - 0.5) * 3;
        if (this._clearOfParty(x, z)) return { x, z };
      }
    }
    for (let i = 0; i < S.tries; i++) {
      const along = S.near + this.rng.next() * (S.ahead - S.near);
      const across = (this.rng.next() - 0.5) * 2 * S.side;
      const x = F.x + fx * along - fz * across;
      const z = F.z + fz * along + fx * across;
      if (ok(x, z) && sys.standable?.(x, z) !== false) return { x, z };
    }
    return null;
  }

  /** (x, z) at least `SPECTACLE.clear` u from the player and every companion. @param {number} x @param {number} z */
  _clearOfParty(x, z) {
    const sys = this.sys;
    const c = SPECTACLE.clear;
    const P = sys.player?.position;
    if (P && Math.hypot(P.x - x, P.z - z) < c) return false;
    for (const a of sys.allies ?? []) {
      if (a.gone || !a.present) continue;
      if (Math.hypot(a.position.x - x, a.position.z - z) < c) return false;
    }
    return true;
  }

  /**
   * A house within `r` of (x, z) (a seeded pick), or null.
   * @param {number} x @param {number} z @param {number} r
   */
  _houseNear(x, z, r) {
    let n = 0;
    for (const h of this._houses) if (Math.hypot(h.x - x, h.z - z) <= r) n++;
    if (!n) return null;
    let pick = Math.floor(this.rng.next() * n);
    for (const h of this._houses) {
      if (Math.hypot(h.x - x, h.z - z) > r) continue;
      if (pick-- === 0) return h;
    }
    return null;
  }

  /**
   * @param {number} x @param {number} z @param {boolean} harmless
   * @param {number} t0 its start time (≤ 0: it waits −t0 s)
   * @returns {boolean}
   */
  _launch(x, z, harmless, t0) {
    const b = this._balls.find((f) => !f.on);
    if (!b) return false;
    const sys = this.sys;
    const tm = sys.tileMap;
    b.on = true;
    b.t = t0;
    b.tx = clamp(x, 0.5, (tm?.width ?? 1e4) - 0.5);
    b.tz = clamp(z, 0.5, (tm?.depth ?? 1e4) - 0.5);
    b.ty = sys.groundAt(b.tx, b.tz);
    // out of the shadow's head, high above
    b.sx = this.x + Math.cos(this.heading) * FALL.head;
    b.sz = this.z + Math.sin(this.heading) * FALL.head;
    b.sy = b.ty + FALL.height;
    b.harmless = harmless;
    b.armed = !harmless;
    b.marker = -1;
    b.quad = -1;
    b.flash = 0;
    b.started = false;
    this.volleys++;
    return true;
  }

  /** @param {number} dt @param {boolean} [ambient] */
  _updateBalls(dt, ambient = false) {
    for (const b of this._balls) {
      if (!b.on) continue;
      if (b.flash > 0) {
        // the impact's white rim, then the marker goes
        b.flash -= dt;
        if (b.flash <= 0) this._endBall(b);
        continue;
      }
      b.t += dt;
      if (b.t < 0) continue;
      if (!b.started) this._startBall(b, ambient);
      else if (ambient && b.armed) {
        // a scene began while it fell: it can hurt no one now (core's strike), so no circle either
        b.armed = false;
        if (b.marker >= 0) this.sys.freeMarker(b.marker);
        b.marker = -1;
      }
      const u = Math.min(1, b.t / FALL.time);
      if (u >= 1) {
        this._impact(b);
        continue;
      }
      // accelerating down the slanted line
      const e = Math.pow(u, 1.5);
      const x = b.sx + (b.tx - b.sx) * e;
      const y = b.sy + (b.ty - b.sy) * e;
      const z = b.sz + (b.tz - b.sz) * e;
      if (b.marker >= 0) {
        b.m.progress = u;
        this.sys.setMarker(b.marker, b.m);
      }
      if (b.quad >= 0) {
        const q = this._q;
        q.x = x; q.y = y; q.z = z;
        q.frame = 'dragonFireball';
        q.index = Math.floor(b.t * 14);
        q.scale = 1.6;
        q.mode = 'billboard';
        // the head along the flight: its direction in the billboard's plane
        const yaw = globalUniforms.uCameraYaw.value;
        const vx = b.tx - b.sx;
        const vz = b.tz - b.sz;
        const across = vx * Math.cos(yaw) - vz * Math.sin(yaw);
        q.rot = Math.atan2(b.ty - b.sy, across);
        q.r = 1.8; q.g = 0.8; q.b = 0.26; q.a = 1;
        this.sys.quads.set(b.quad, q);
      }
      const sys = this.sys;
      sys.burst('dragonTrail', x, y, z, 2);
      if (Math.floor(b.t * 20) % 3 === 0) sys.burst('dragonSmoke', x, y, z, 1);
    }
  }

  /**
   * The fireball begins to fall: its quad, its telegraph (an armed ball's own circle), its sound. A
   * ball that starts to fall in a scene is disarmed (it lands in the scene: core's strike hurts no
   * one there, so it shows no circle either).
   * @param {Fireball} b @param {boolean} ambient
   */
  _startBall(b, ambient) {
    const sys = this.sys;
    b.started = true;
    b.quad = sys.quads.alloc();
    if (ambient) b.armed = false;
    if (b.armed && b.marker < 0) {
      const m = b.m;
      m.shape = 'circle';
      m.x = b.tx;
      m.z = b.tz;
      m.r = this.radius;
      m.progress = 0;
      m.style = 'enemy';
      m.flash = 0;
      // (no free slot: no circle, and it hurts all the same)
      b.marker = sys.marker(m);
    }
    sys.sfxAt('fireballFall', b.tx, b.tz, { volume: 0.8 });
  }

  /** @param {Fireball} b */
  _impact(b) {
    const sys = this.sys;
    if (b.quad >= 0) sys.quads.free(b.quad);
    b.quad = -1;
    const { tx: x, ty: y, tz: z } = b;
    // the blast, the ring, the scorch and its embers
    this._addFx('blast', x, y + 1.1, z, 1.25 * (this.radius / 2.4), 0.375);
    this._addFx('ring', x, y + 0.06, z, this.radius / 1.6, 0.3);
    this._addFx('scorch', x, y + 0.035, z, this.radius / 1.15, 9);
    this._addFx('embers', x, y + 0.045, z, this.radius / 1.15, 4);
    sys.burst('dragonFlare', x, y + 0.9, z, 4);
    sys.burst('dragonFireBurst', x, y + 0.4, z, 18);
    sys.burst('dragonSmoke', x, y + 0.6, z, 8);
    sys.burst('dragonDebris', x, y + 0.2, z, 10);
    sys.burst('dragonEmbers', x, y + 0.3, z, 8);
    sys.sfxAt('explosion', x, z, { volume: 1 });
    const P = sys.player?.position;
    if (P) {
      const amp = 0.55 * Math.max(0, 1 - Math.hypot(P.x - x, P.z - z) / 16);
      if (amp > 0.03) sys.shake(amp, 0.45);
    }
    if (b.armed) {
      // the strike: the inner 60 % knocks down, the rest of the circle hurts less (one tag)
      const tag = sys.tags.next();
      const atk = SKY_ATK;
      sys.strike({ shape: 'circle', x, z, y, r: this.radius * 0.6, atk, mv: this.power, kb: 2.5, knockdown: true, tag });
      sys.strike({ shape: 'circle', x, z, y, r: this.radius, atk, mv: this.power * 0.7, kb: 1.5, tag });
      if (b.marker >= 0) {
        b.m.progress = 1;
        sys.setMarker(b.marker, b.m);
        b.flash = 5 / 60;
        return;
      }
    }
    this._endBall(b);
  }

  /** @param {Fireball} b */
  _endBall(b) {
    if (b.marker >= 0) this.sys.freeMarker(b.marker);
    if (b.quad >= 0) this.sys.quads.free(b.quad);
    b.marker = -1;
    b.quad = -1;
    b.on = false;
    b.flash = 0;
  }

  // ---------------------------------------------------------------------------------------------
  // impact effects (FX quads of the combat batch)
  // ---------------------------------------------------------------------------------------------

  /**
   * @param {'blast'|'ring'|'scorch'|'embers'} kind @param {number} x @param {number} y @param {number} z
   * @param {number} scale @param {number} dur seconds
   */
  _addFx(kind, x, y, z, scale, dur) {
    const f = this._fx.find((e) => !e.on);
    if (!f) return;
    const h = this.sys.quads.alloc();
    if (h < 0) return;
    const a = this.rng.next() * TAU;
    Object.assign(f, { on: true, h, kind, t: 0, dur, x, y, z, scale, dirX: Math.cos(a), dirZ: Math.sin(a) });
    this._writeFx(f);
  }

  /** @param {number} dt */
  _updateFx(dt) {
    for (const f of this._fx) {
      if (!f.on) continue;
      f.t += dt;
      if (f.t >= f.dur) {
        this.sys.quads.free(f.h);
        f.on = false;
        f.h = -1;
        continue;
      }
      this._writeFx(f);
    }
  }

  /** @param {ImpactFx} f */
  _writeFx(f) {
    const q = this._q;
    const u = f.t / f.dur;
    q.x = f.x; q.y = f.y; q.z = f.z;
    q.scale = f.scale;
    q.rot = 0;
    q.dirX = f.dirX;
    q.dirZ = f.dirZ;
    q.a = 1;
    if (f.kind === 'blast') {
      q.frame = 'dragonBlast'; q.mode = 'billboard'; q.index = Math.min(5, Math.floor(u * 6));
      q.r = 1.5; q.g = 0.72; q.b = 0.28;
    } else if (f.kind === 'ring') {
      q.frame = 'dragonRing'; q.mode = 'flat'; q.index = Math.min(3, Math.floor(u * 4));
      q.r = 1.9; q.g = 1.1; q.b = 0.55; q.a = 1.4 - u;
    } else if (f.kind === 'scorch') {
      // charred ground, fading through the dither over its last 4 s
      q.frame = 'dragonScorch'; q.mode = 'flat'; q.index = f.h & 1;
      q.r = 0.1; q.g = 0.08; q.b = 0.075; q.a = Math.min(1, (f.dur - f.t) / 4);
    } else {
      // the embers dim from a hot orange to nothing
      const k = 1 - u;
      q.frame = 'dragonEmbers'; q.mode = 'flat'; q.index = Math.floor(f.t * 3) & 1;
      q.r = 2.4 * k; q.g = 0.85 * k * k; q.b = 0.25 * k * k; q.a = Math.min(1, k * 2.2);
    }
    this.sys.quads.set(f.h, q);
  }

  /** Free every fireball, marker and effect (absent at once, dispose). */
  _clearAll() {
    for (const b of this._balls) if (b.on) this._endBall(b);
    for (const f of this._fx) {
      if (!f.on) continue;
      this.sys.quads.free(f.h);
      f.on = false;
      f.h = -1;
    }
  }
}
