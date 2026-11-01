import * as THREE from 'three';
import { globalUniforms } from '../render/GlobalUniforms.js';
import { RNG, hash2, smoothstep } from '../utils/math.js';

/**
 * GroundFrost — frost spreading over the ground under a spell, frozen grass rising out of it, and
 * cracks racing across it, as terrain-draped CUT-OUT decals: every texel is solid or gone (a Bayer
 * dither thins the edge), so it writes depth, needs no sorting and stays sharp in the depth of
 * field — no blending. Combat-only (COMBAT_PURE): created by the ice mage's look
 * (src/game/party/IceSpellFx.js `IceStage`), only on a level where an ice mage can fight.
 *
 * API:
 *  - `new GroundFrost({ heightField, capacity, tufts })` — heightField as GroundMarkers'
 *    ({ sample(x, z), minX, minZ, maxX, maxZ }), plus an optional `surface(x, z)` (the rendered,
 *    stepped surface — TileMap's `_surface`: stairs drawn as steps; without it `sample`, whose
 *    stairs are a smooth ramp through the steps); capacity: patches (8; each costs ~0.6 MB of
 *    vertex buffers and 256 KB of texture); tufts: frozen grass tufts on the frost (true). Without
 *    a heightField the frost lies at y 0 (sandboxes).
 *  - `object`: add to the scene (one Mesh, ONE draw call, no shadow cast, receives shadows);
 *    hidden while nothing lives.
 *  - `add({ x, z, radius, seed })` → handle (−1: full): a frost patch centred on (x, z), radius
 *    in u (3; 0.25 … 7), seed (integer; 1).
 *  - `set(h, { spread, fade, cracks, crackFrom, glow })`: spread 0 … 1 (the frost grows from the
 *    centre to `radius`, along crystal veins first, with a ragged noisy edge that dithers in and a
 *    faint glowing front while it moves; the tufts rise out of the ground 0.14 behind it), fade
 *    0 … 1 (it thins away in Bayer dither steps, the edge first, the veins and clefts last), cracks
 *    0 … 1 (crack lines race from `crackFrom` {x, z} — or out from the centre without one — to the
 *    ring (cracks 0 → 0.42), round it both ways (→ 0.82) splintering in and out, and a star breaks
 *    open at the centre (0.8 → 1); a bright tip leads them), crackFrom (read when it moves by more
 *    than a texel: the patch is painted again — keep it fixed while the cracks run), glow (the
 *    emissive strength — sparkle, the front, the cracks' inner light; 1 by default). Missing
 *    fields keep their value.
 *  - `crackTips(h, out)` → n: the leading points of the running cracks (x, y, z into the caller's
 *    objects): a spark or the spell light can ride on them (the grass hides much of the ground);
 *    0 until the patch is painted.
 *  - `free(h)`, `update(dt)` (once per frame: one slice of the paint of a patch added or moved
 *    since — see below — and the draw range), `ready(h)` (painted: drawn from now on),
 *    `painting()`, `warm()` / `unwarm()` (one full patch 500 u below the world, painted at once:
 *    the program compiles at load and the paint's code is warm before the first cast), `dispose()`,
 *    `count` (live patches, the warm one too), `paintMs` / `sliceMs` (the last paint's CPU time,
 *    its slices summed / its longest slice).
 *
 * How it is made. Each patch owns a 256 × 256-texel square of one RGBA8 data texture (16 texels
 * per unit, so the square spans 16 u — a crack from more than 14 − radius u away starts at that
 * distance) and, in one merged BufferGeometry, up to 2 048 ground cells of 0.25 u (4 × 4 texels)
 * and 384 tufts. `update` paints a dirty patch on the CPU in six slices, one a frame — the veins
 * and noise, the frost texels in thirds, the cracks, the cells and tufts — patches one at a time;
 * the patch draws nothing until its last slice (its texels uploaded, its cells counted then).
 * Seeded: sliced or not, the same patch is painted the same. A whole paint costs ≈ 10 – 15 ms of
 * CPU while the JIT is cold (a level's first casts) and ≈ 4 – 5 ms warm; a slice ≈ 1 – 4 ms. What
 * it writes:
 *  - R: the spread at which the texel freezes (255: never) — distance from the centre / radius,
 *    ragged by a value-noise fbm, lowered along the veins (7 – 10 seeded random walks branching
 *    at ±60°, an ice crystal's angle); a solid core, the veins feathered, sparse clumps between
 *    them further out;
 *  - G: tone (2 bits: deep blue-violet, base, light, the pale cyan of a vein; the texel under a
 *    vein's lower right in its shade), a sparkle bit, a 5-bit twinkle phase;
 *  - B: the cracks value at which a crack texel appears (255: none);
 *  - A: the crack class (1 cleft, 2 lit lip — the lower or right neighbour, the wall that faces
 *    the light from the upper left —, 3 rime: frost dithered along the crack).
 * The cells cover the texels that hold anything; each is flat at the height under its centre,
 * a corner following the ground only where it is within 0.12 u of that (a ramp stays a ramp, a
 * step or a riser stays a clean step: no slivers up the walls), lifted 0.012 u plus a polygon
 * offset (−2, −4) over the terrain. The tufts (16 painted variants of 8 × 12 texels in a strip
 * under the squares: 4 – 6 blades, dark teal-blue with a lit left edge and rimed pale-cyan tips,
 * some sparkling) stand on a jittered 0.34 u grid over the frost's inner part, upright and turned
 * to the camera yaw like the foliage, and rise out of the ground (their texels stay put: no
 * squash) as the spread passes them — the grass of a level hides most of a ground decal, the
 * tufts stand among it.
 * The material is a MeshLambertMaterial (lit by the sun, the hemisphere and the point lights —
 * a spell light tints it —, shadowed, fogged; `customProgramCacheKey`
 * `luminati-groundfrost-v1-<capacity>`) whose map stage reads the texel under the fragment with
 * `texelFetch` (world-texel aligned with the terrain) and discards what is not there — cut-out,
 * depth-writing; its emissive adds a cold self-light (frost reads pale in the shade too), the
 * sparkle (HDR, blooms, twinkling on `uTime`), the moving front, the cracks' inner light and their
 * racing tip — all cold blue to cyan, never pure white.
 */

/** Texels per world unit (the terrain's). */
const TPU = 16;
/** Texels per side of a patch's square. */
const SLOT = 256;
/** Texels per side of a ground cell. */
const CELL = 4;
/** Cells per side of a patch's square. */
const CELLS_SIDE = SLOT / CELL;
/** Ground cells a patch may use (its texels' blocks beyond these are dropped, with a warning). */
const MAX_CELLS = 2048;
/** Frozen grass tufts a patch may stand up (beyond these: none). */
const MAX_TUFTS = 384;
/** Quads per patch: its cells, then its tufts. */
const SLOT_QUADS = MAX_CELLS + MAX_TUFTS;
/** A tuft sprite's texels (across, up), its variants and the strip that holds them. */
const TUFT_W = 8;
const TUFT_H = 12;
const TUFT_VARIANTS = 16;
const TUFT_ROWS = 16;
/** The tufts' jittered grid (u). */
const TUFT_STEP = 0.34;
/** Lift over the ground (u), besides the polygon offset. */
const LIFT = 0.012;
/** A cell corner follows the ground only within this of the cell centre's height (u). */
const STEP_TOL = 0.12;
/** "Nothing" in the R and B channels. */
const NONE = 255;
/** The crack timeline (cracks value): main crack to the ring, round it, splinters, the centre star. */
const CRACK = Object.freeze({ main: 0.42, ring: 0.82, spoke: 0.12, splinter: 0.06, star0: 0.8, star1: 1.0 });
/** An empty texel (R 255, G 0, B 255, A 0) as one little-endian 32-bit word. */
const EMPTY32 = 0x00ff00ff;
/** Frost density by the distance to a vein (texels 0 … 6). */
const VEIN_DENSITY = Object.freeze([1, 0.82, 0.55, 0.3, 0.16, 0.08, 0.05]);
/** Rime offsets round a cleft (di, dj pairs: the 8 neighbours and four 2 away). */
const RIME = Object.freeze([-1, -1, 0, -1, 1, -1, -1, 0, 1, 0, -1, 1, 0, 1, 1, 1, -2, 0, 2, 0, 0, -2, 0, 2]);
/** Monotonic ms (the paint's timing only). */
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : 0);

const GF_VERTEX_PARS = /* glsl */ `
attribute float aFrostSlot;
attribute vec4 aTuft; // a tuft's corner: across (±0.5), up (0 / 1), threshold, 1 + variant (0: a ground cell)
uniform vec4 uFrostA[ GF_CAP ]; // spread, fade, cracks, glow
uniform vec4 uFrostB[ GF_CAP ]; // origin texel x, z, slot row, 0
uniform float uCameraYaw;
varying vec2 vFrostXZ;
varying vec2 vTuftUV;
flat varying vec2 vTuftInfo; // variant (−1: ground), threshold
flat varying vec4 vFrostA;
flat varying vec4 vFrostB;
`;

const GF_VERTEX_MAIN = /* glsl */ `
	{
		int gfSlot = int( aFrostSlot + 0.5 );
		vFrostA = uFrostA[ gfSlot ];
		vFrostB = uFrostB[ gfSlot ];
		vTuftInfo = vec2( - 1.0, 0.0 );
		vTuftUV = vec2( 0.0 );
		if ( aTuft.w > 0.5 ) {
			// a frozen tuft: upright, turned to the camera yaw, rising out of the ground as the
			// spread passes its threshold (its texels stay put on the quad: no squash)
			float grow = clamp( ( vFrostA.x - aTuft.z ) * ( 1.0 / 0.14 ), 0.0, 1.0 );
			vec3 across = vec3( cos( uCameraYaw ), 0.0, - sin( uCameraYaw ) );
			transformed += across * ( aTuft.x * ${(TUFT_W / TPU).toFixed(4)} ) + vec3( 0.0, ( aTuft.y - 1.0 + grow ) * ${(TUFT_H / TPU).toFixed(4)}, 0.0 );
			vTuftUV = vec2( ( aTuft.x + 0.5 ) * ${TUFT_W.toFixed(1)}, aTuft.y * ${TUFT_H.toFixed(1)} );
			vTuftInfo = vec2( aTuft.w - 1.0, aTuft.z );
		}
		vFrostXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;
	}
`;

const GF_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uFrostTex;
uniform float uTime;
varying vec2 vFrostXZ;
varying vec2 vTuftUV;
flat varying vec2 vTuftInfo;
flat varying vec4 vFrostA;
flat varying vec4 vFrostB;

float gfBayer4( vec2 p ) {
	ivec2 q = ivec2( mod( p, 4.0 ) );
	const float M[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
	return ( M[ q.y * 4 + q.x ] + 0.5 ) / 16.0;
}
float gfHash( vec2 p ) {
	return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
`;

/** Replaces the Lambert map stage: the frost texel under the fragment, or a discard. */
const GF_FRAGMENT_MAP = /* glsl */ `
	vec3 gfEmissive = vec3( 0.0 );
	{
		bool tuft = vTuftInfo.x >= 0.0;
		vec2 tw;
		ivec2 at;
		if ( tuft ) {
			// a tuft's texel in the sprite strip
			tw = floor( vTuftUV );
			if ( tw.x < 0.0 || tw.y < 0.0 || tw.x >= ${TUFT_W.toFixed(1)} || tw.y >= ${TUFT_H.toFixed(1)} ) discard;
			at = ivec2( tw ) + ivec2( int( vTuftInfo.x + 0.5 ) * ${TUFT_W}, GF_STRIP );
		} else {
			tw = floor( vFrostXZ * ${TPU.toFixed(1)} );
			ivec2 tl = ivec2( tw - vFrostB.xy );
			if ( tl.x < 0 || tl.y < 0 || tl.x >= ${SLOT} || tl.y >= ${SLOT} ) discard;
			at = ivec2( tl.x, tl.y + int( vFrostB.z ) );
		}
		ivec4 v = ivec4( texelFetch( uFrostTex, at, 0 ) * 255.0 + 0.5 );
		float spread = vFrostA.x;
		float fade = vFrostA.y;
		float cracks = vFrostA.z;
		float glow = vFrostA.w;
		float bay = gfBayer4( tw );
		float th = tuft ? vTuftInfo.y : float( v.r ) / 254.0;
		float arr = float( v.b ) / 254.0;
		int cls = v.a;

		// frost: frozen once the spread passes the texel's threshold; the newest band dithers in
		// (a tuft rises instead)
		bool frost = v.r < ${NONE} && spread > 0.0 && th <= spread;
		float behind = spread - th;
		if ( frost && ! tuft && behind < 0.07 && behind * ( 1.0 / 0.07 ) <= bay ) frost = false;
		// cracks: the cleft and its lit lip as the run passes; the rime a moment later, dithered
		bool crack = cls > 0 && v.b < ${NONE} && cracks > 0.0 && arr <= cracks;
		if ( crack && cls == 3 && ( cracks - arr ) * ( 1.0 / 0.08 ) <= bay ) crack = false;
		// fade: the edge (late threshold) first, in Bayer steps; the veins and the clefts last
		if ( fade > 0.0 ) {
			float k = frost ? 1.0 - th : 1.0 - arr * 0.5;
			if ( fade >= 0.999 || 0.5 * bay + 0.5 * k < fade ) { frost = false; crack = false; }
		}
		if ( ! frost && ! crack ) discard;

		int tone = v.g & 3;
		bool sparkle = ( v.g & 4 ) != 0;
		float phase = float( v.g >> 3 ) * ( 6.2831853 / 32.0 );
		vec3 alb;
		if ( crack && cls == 1 ) {
			// the cleft: dark, lit from inside — a cold blue core, a bright tip racing ahead
			alb = vec3( 0.03, 0.04, 0.1 );
			float pulse = 0.7 + 0.3 * sin( uTime * 3.1 + arr * 23.0 );
			gfEmissive = vec3( 0.05, 0.19, 0.5 ) * pulse;
			float tip = ( 1.0 - smoothstep( 0.0, 0.06, cracks - arr ) ) * step( cracks, 0.999 );
			gfEmissive += vec3( 0.55, 1.7, 3.2 ) * tip;
		} else if ( crack && cls == 2 ) {
			// the lit lip: pale ice catching the light
			alb = vec3( 0.48, 0.66, 0.92 );
			float tip = ( 1.0 - smoothstep( 0.0, 0.06, cracks - arr ) ) * step( cracks, 0.999 );
			gfEmissive = vec3( 0.04, 0.1, 0.22 ) + vec3( 0.3, 0.8, 1.4 ) * tip;
		} else {
			// frost (or rime): four tones from deep blue-violet to the pale cyan of a vein
			alb = tone == 0 ? vec3( 0.15, 0.19, 0.44 ) : tone == 1 ? vec3( 0.33, 0.44, 0.63 ) : tone == 2 ? vec3( 0.45, 0.6, 0.79 ) : vec3( 0.58, 0.8, 0.93 );
			if ( ! frost ) alb = vec3( 0.45, 0.6, 0.79 );
			// a tuft: frozen grass — dark teal-blue blades, rimed pale-cyan tips
			if ( tuft ) alb = tone == 0 ? vec3( 0.06, 0.1, 0.16 ) : tone == 1 ? vec3( 0.14, 0.24, 0.36 ) : tone == 2 ? vec3( 0.3, 0.46, 0.64 ) : vec3( 0.55, 0.78, 0.93 );
			gfEmissive = alb * ( tone == 3 ? vec3( 0.2, 0.36, 0.5 ) : vec3( 0.09, 0.13, 0.2 ) );
			if ( frost && sparkle ) {
				float s = max( 0.0, sin( uTime * 2.2 + phase * 3.0 + gfHash( tw + vTuftInfo.y * 917.0 ) * 6.2831853 ) );
				s *= s; s *= s; s *= s;
				gfEmissive += vec3( 1.5, 2.3, 3.1 ) * ( 0.12 + s );
			}
			// the moving front glows faintly
			if ( frost && ! tuft && spread < 0.999 && behind < 0.035 ) gfEmissive += vec3( 0.3, 0.62, 1.0 ) * ( 1.0 - behind * ( 1.0 / 0.035 ) );
		}
		gfEmissive *= glow;
		diffuseColor.rgb = alb;
	}
`;

/**
 * Walk a line in texel space (float endpoints) 4-connected (no diagonal-only step): `fn(tx, tz, u)`
 * for each texel, u 0 … 1 along it.
 * @param {number} ax @param {number} az @param {number} bx @param {number} bz
 * @param {(tx: number, tz: number, u: number) => void} fn
 */
function walkLine(ax, az, bx, bz, fn) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2));
  let px = Math.floor(ax);
  let pz = Math.floor(az);
  fn(px, pz, 0);
  for (let k = 1; k <= n; k++) {
    const u = k / n;
    const x = Math.floor(ax + (bx - ax) * u);
    const z = Math.floor(az + (bz - az) * u);
    if (x === px && z === pz) continue;
    if (x !== px && z !== pz) fn(x, pz, u); // the corner texel: 4-connected
    fn(x, z, u);
    px = x;
    pz = z;
  }
}

/**
 * Paint the tufts' sprite strip at row `row0` of the texture data: TUFT_VARIANTS frozen grass
 * tufts of TUFT_W × TUFT_H texels side by side (bottom row first), 3 – 5 blades each — a deep
 * root, the body, a pale cyan top, a sparkle on some tips — in the frost's texel code (R 0: there;
 * the threshold is the tuft's own).
 * @param {Uint8Array} data @param {number} row0
 */
function paintTufts(data, row0) {
  for (let i = row0 * SLOT * 4, n = (row0 + TUFT_ROWS) * SLOT * 4; i < n; i += 4) {
    data[i] = NONE; data[i + 1] = 0; data[i + 2] = NONE; data[i + 3] = 0;
  }
  const put = (v, x, y, tone, sparkle, phase) => {
    if (x < 0 || x >= TUFT_W || y < 0 || y >= TUFT_H) return;
    const o = ((row0 + y) * SLOT + v * TUFT_W + x) * 4;
    // (a later blade's body never paints over an earlier one's lit edge with a darker tone)
    if (data[o] === 0 && (data[o + 1] & 3) > tone) return;
    data[o] = 0;
    data[o + 1] = tone | (sparkle ? 4 : 0) | (phase << 3);
  };
  for (let v = 0; v < TUFT_VARIANTS; v++) {
    const rng = new RNG(0x7f4a7c15 + v * 977);
    const blades = 4 + rng.int(0, 2);
    for (let b = 0; b < blades; b++) {
      const x0 = 1 + rng.next() * (TUFT_W - 3);
      const top = Math.min(TUFT_H - 1, Math.round(4 + rng.next() * (TUFT_H - 5)));
      const lean = (rng.next() - 0.5) * 3 + (x0 - TUFT_W / 2 + 0.5) * 0.6;
      const curve = (rng.next() - 0.5) * 2.5;
      const thick = Math.round(top * (0.35 + rng.next() * 0.25));
      const phase = rng.int(0, 31);
      for (let y = 0; y <= top; y++) {
        const f = y / top;
        const x = Math.floor(x0 + lean * f + curve * f * f);
        if (y < 2) { put(v, x, y, 0, false, phase); put(v, x + 1, y, 0, false, phase); continue; }
        if (y === top) { put(v, x, y, 3, rng.next() < 0.5, phase); continue; }
        // a lit left edge, a shaded right one while the blade is two texels wide
        put(v, x, y, y > top - 3 ? 3 : 2, false, phase);
        if (y < thick) put(v, x + 1, y, 1, false, phase);
      }
    }
  }
}

/**
 * Value-noise fbm at the points of a regular grid (x0 + a·step, z0 + b·step), a < bw, b < bh, into
 * `out[b·bw + a]` (0 … 1): each octave's lattice hashed once (`lat` scratch), then smoothly
 * interpolated — as math.js fbm2, many times cheaper over a grid.
 * @param {Float32Array} out @param {number} bw @param {number} bh @param {number} x0 @param {number} z0
 * @param {number} step @param {number} freq @param {number} octaves @param {number} seed
 * @param {Float32Array} lat
 */
function gridFbm(out, bw, bh, x0, z0, step, freq, octaves, seed, lat) {
  out.fill(0, 0, bw * bh);
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = freq * (1 << o);
    const gx0 = Math.floor(x0 * f);
    const gz0 = Math.floor(z0 * f);
    const gw = Math.floor((x0 + (bw - 1) * step) * f) - gx0 + 2;
    const gh = Math.floor((z0 + (bh - 1) * step) * f) - gz0 + 2;
    if (gw * gh > lat.length) continue;
    const s = seed + o * 101;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) lat[j * gw + i] = hash2(gx0 + i, gz0 + j, s);
    for (let b = 0; b < bh; b++) {
      const fz = (z0 + b * step) * f - gz0;
      const iz = Math.floor(fz);
      let tz = fz - iz;
      tz = tz * tz * (3 - 2 * tz);
      for (let a = 0; a < bw; a++) {
        const fx = (x0 + a * step) * f - gx0;
        const ix = Math.floor(fx);
        let tx = fx - ix;
        tx = tx * tx * (3 - 2 * tx);
        const k = iz * gw + ix;
        const top = lat[k] + (lat[k + 1] - lat[k]) * tx;
        const bot = lat[k + gw] + (lat[k + gw + 1] - lat[k + gw]) * tx;
        out[b * bw + a] += amp * (top + (bot - top) * tz);
      }
    }
    norm += amp;
    amp *= 0.5;
  }
  if (norm > 0) for (let q = 0, n = bw * bh; q < n; q++) out[q] /= norm;
}

/**
 * A jagged polyline from a to b by midpoint displacement (world u).
 * @param {RNG} rng @param {number} ax @param {number} az @param {number} bx @param {number} bz
 * @param {number} rough displacement / length at the first level
 * @param {number} levels
 * @returns {number[]} x, z pairs
 */
function jag(rng, ax, az, bx, bz, rough, levels) {
  let pts = [ax, az, bx, bz];
  let amp = rough;
  for (let l = 0; l < levels; l++) {
    const out = [pts[0], pts[1]];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i], z0 = pts[i + 1], x1 = pts[i + 2], z1 = pts[i + 3];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const o = (rng.next() * 2 - 1) * amp * len;
      const nx = len > 1e-6 ? -(z1 - z0) / len : 0;
      const nz = len > 1e-6 ? (x1 - x0) / len : 0;
      out.push((x0 + x1) / 2 + nx * o, (z0 + z1) / 2 + nz * o, x1, z1);
    }
    pts = out;
    amp *= 0.6;
  }
  return pts;
}

export class GroundFrost {
  /**
   * @param {{ heightField?: { sample: (x: number, z: number) => number, surface?: (x: number, z: number) => number, minX: number, minZ: number, maxX: number, maxZ: number } | null, capacity?: number, tufts?: boolean }} [opts]
   */
  constructor({ heightField = null, capacity = 8, tufts = true } = {}) {
    this.heightField = heightField;
    this.capacity = Math.max(1, capacity | 0);
    /** Whether patches stand frozen tufts up (read at each paint). */
    this.tufts = tufts;
    const cap = this.capacity;

    /** Last paint's CPU time (ms, its slices summed). */
    this.paintMs = 0;
    /** Last paint's longest slice (ms: what one frame paid). */
    this.sliceMs = 0;

    // ---- the texture: one 256 × 256 square per patch, stacked, then the tufts' sprite strip
    this._data = new Uint8Array(SLOT * (SLOT * cap + TUFT_ROWS) * 4);
    this.texture = new THREE.DataTexture(this._data, SLOT, SLOT * cap + TUFT_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    paintTufts(this._data, SLOT * cap);
    this.texture.name = 'fx:groundFrost';
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;

    // ---- the quads: per patch MAX_CELLS ground cells then MAX_TUFTS tufts, 4 vertices each,
    // degenerate while unused
    const verts = cap * SLOT_QUADS * 4;
    const geometry = new THREE.BufferGeometry();
    this._pos = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this._nrm = new THREE.BufferAttribute(new Float32Array(verts * 3), 3);
    this._tuft = new THREE.BufferAttribute(new Float32Array(verts * 4), 4);
    for (const a of [this._pos, this._nrm, this._tuft]) a.setUsage(THREE.DynamicDrawUsage);
    const slotArr = new Float32Array(verts);
    for (let s = 0; s < cap; s++) slotArr.fill(s, s * SLOT_QUADS * 4, (s + 1) * SLOT_QUADS * 4);
    const index = new Uint32Array(cap * SLOT_QUADS * 6);
    for (let c = 0, n = cap * SLOT_QUADS; c < n; c++) {
      const v = c * 4;
      index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], c * 6);
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.setAttribute('position', this._pos);
    geometry.setAttribute('normal', this._nrm);
    geometry.setAttribute('aTuft', this._tuft);
    geometry.setAttribute('aFrostSlot', new THREE.BufferAttribute(slotArr, 1));
    geometry.setDrawRange(0, 0);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = geometry;

    // ---- per-patch parameters (uniform arrays, read in the vertex shader)
    /** @type {THREE.Vector4[]} spread, fade, cracks, glow */
    this._uA = Array.from({ length: cap }, () => new THREE.Vector4(0, 0, 0, 1));
    /** @type {THREE.Vector4[]} origin texel x, z, slot row, 0 */
    this._uB = Array.from({ length: cap }, (_, s) => new THREE.Vector4(0, 0, s * SLOT, 0));

    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    material.name = 'GroundFrost';
    const uniforms = {
      uFrostTex: { value: this.texture },
      uFrostA: { value: this._uA },
      uFrostB: { value: this._uB },
      uTime: globalUniforms.uTime,
      uCameraYaw: globalUniforms.uCameraYaw,
    };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n#define GF_CAP ${cap}\n${GF_VERTEX_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GF_VERTEX_MAIN}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n#define GF_STRIP ${SLOT * cap}\n${GF_FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', GF_FRAGMENT_MAP)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += gfEmissive;');
    };
    material.customProgramCacheKey = () => `luminati-groundfrost-v1-${cap}`;
    this.material = material;

    /** Add to the scene: one draw call, hidden while no patch lives. */
    this.object = new THREE.Mesh(geometry, material);
    this.object.name = 'fx:groundFrost';
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.castShadow = false;
    this.object.receiveShadow = true;
    this.object.matrixAutoUpdate = false;

    /**
     * @type {Array<{ x: number, z: number, radius: number, seed: number, from: { x: number, z: number } | null,
     *   cells: number, tufts: number, dirty: boolean, warm: boolean, paths: number[][][],
     *   painter: Generator<void, void, void> | null } | null>}
     */
    this._items = new Array(cap).fill(null);
    this._warm = -1;
    this._rangeDirty = false;
    this._warnedCells = false;
    /** The texture's words (an empty slot is one fill). */
    this._data32 = new Uint32Array(this._data.buffer);
    /** Scratch of a paint: the distance to a vein (texels), the cells in use, the noise, the clefts. */
    this._vein = new Uint8Array(SLOT * SLOT);
    this._used = new Uint8Array(CELLS_SIDE * CELLS_SIDE);
    this._noise = new Float32Array((SLOT / 2 + 1) * (SLOT / 2 + 1));
    this._clump = new Float32Array((SLOT / 2 + 1) * (SLOT / 2 + 1));
    this._lattice = new Float32Array(160 * 160);
    this._clefts = new Int32Array(16384);
  }

  /** Live patches (the warm-up's too). */
  get count() { return this._items.reduce((n, it) => n + (it ? 1 : 0), 0); }

  /** @param {{ x: number, z: number, radius?: number, seed?: number }} o @returns {number} */
  add(o) {
    const h = this._items.indexOf(null);
    if (h < 0) return -1;
    this._items[h] = {
      x: o.x, z: o.z, radius: Math.max(0.25, Math.min(7, o.radius ?? 3)), seed: (o.seed ?? 1) | 0,
      from: null, cells: 0, tufts: 0, dirty: true, warm: false, paths: [], painter: null,
    };
    this._uA[h].set(0, 0, 0, 1);
    this._rangeDirty = true;
    return h;
  }

  /**
   * @param {number} h
   * @param {{ spread?: number, fade?: number, cracks?: number, crackFrom?: { x: number, z: number } | null, glow?: number }} p
   */
  set(h, p) {
    const it = h >= 0 && h < this.capacity ? this._items[h] : null;
    if (!it) return;
    const u = this._uA[h];
    if (p.spread !== undefined) u.x = Math.max(0, Math.min(1, p.spread));
    if (p.fade !== undefined) u.y = Math.max(0, Math.min(1, p.fade));
    if (p.cracks !== undefined) u.z = Math.max(0, Math.min(1, p.cracks));
    if (p.glow !== undefined) u.w = Math.max(0, p.glow);
    if (p.crackFrom !== undefined) {
      const f = p.crackFrom;
      const was = it.from;
      const moved = f ? !was || Math.abs(f.x - was.x) > 1 / TPU || Math.abs(f.z - was.z) > 1 / TPU : !!was;
      if (moved) {
        it.from = f ? { x: f.x, z: f.z } : null;
        it.dirty = true;
        // (a paint under way starts again with the new start; one done is painted again)
        it.painter = null;
      }
    }
  }

  /**
   * The leading points of the cracks now running on patch h — the run from `crackFrom`, then the
   * two round the ring — written into `out` (objects the caller owns; x, y on the ground, z):
   * a spell's look may ride a spark or its spell light on them. Allocation-free.
   * @param {number} h
   * @param {{ x: number, y: number, z: number }[]} out
   * @returns {number} how many were written (0: no crack running, or not painted yet)
   */
  crackTips(h, out) {
    const it = h >= 0 && h < this.capacity ? this._items[h] : null;
    if (!it || it.dirty) return 0;
    const c = this._uA[h].z;
    let n = 0;
    for (let p = 0; p < it.paths.length && n < out.length; p++) {
      const path = it.paths[p];
      for (let k = 0; k < path.length; k++) {
        const g = path[k];
        if (c < g[4] || c >= g[5]) continue;
        const u = g[5] > g[4] ? (c - g[4]) / (g[5] - g[4]) : 0;
        const o = out[n++];
        o.x = g[0] + (g[2] - g[0]) * u;
        o.z = g[1] + (g[3] - g[1]) * u;
        o.y = this._height(it, o.x, o.z);
        break;
      }
    }
    return n;
  }

  /** @param {number} h */
  free(h) {
    const it = h >= 0 && h < this.capacity ? this._items[h] : null;
    if (!it) return;
    this._clearQuads(h, 0, it.cells);
    this._clearQuads(h, MAX_CELLS, MAX_CELLS + it.tufts);
    this._items[h] = null;
    this._uA[h].set(0, 0, 0, 1);
    this._rangeDirty = true;
  }

  /** One patch 500 u below the world, frozen and cracked: the program compiles with the scene, the paint's code is warm. */
  warm() {
    if (this._warm >= 0) return;
    // (a full-size patch with a crack from afar: the paint's every path runs once at load, so the
    // first cast does not pay the JIT)
    const h = this.add({ x: 0, z: 0, radius: 3.5, seed: 1 });
    if (h < 0) return;
    const it = /** @type {NonNullable<GroundFrost['_items'][number]>} */ (this._items[h]);
    it.warm = true;
    it.from = { x: 0, z: 7 };
    this._uA[h].set(1, 0, 1, 1);
    this._warm = h;
    // (three paints: the JIT has optimised the painter by the third; ~15 ms at load)
    for (let k = 0; k < 3; k++) {
      it.seed = 1 + k;
      this._paint(h);
    }
    this._applyRange();
  }

  unwarm() {
    if (this._warm < 0) return;
    this.free(this._warm);
    this._warm = -1;
    this._applyRange();
  }

  /**
   * Once a frame: one slice of the paint of the first patch waiting for one (patches paint one at
   * a time: they share the paint's scratch), then the draw range.
   * @param {number} dt
   */
  update(dt) {
    void dt;
    for (let h = 0; h < this.capacity; h++) {
      const it = this._items[h];
      if (!it || !it.dirty) continue;
      it.painter ??= this._painter(h);
      if (it.painter.next().done) it.painter = null;
      break;
    }
    if (this._rangeDirty) this._applyRange();
  }

  /** A patch is still being painted (it draws nothing yet; `crackTips` → 0). */
  painting() {
    return this._items.some((it) => !!it && it.dirty);
  }

  /** Patch h is painted (drawn from now on). @param {number} h @returns {boolean} */
  ready(h) {
    const it = h >= 0 && h < this.capacity ? this._items[h] : null;
    return !!it && !it.dirty;
  }

  dispose() {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }

  // -------------------------------------------------------------------------------------------

  /** @internal draw range up to the last live patch; visibility */
  _applyRange() {
    this._rangeDirty = false;
    let last = -1;
    for (let h = 0; h < this.capacity; h++) if (this._items[h] && this._items[h].cells > 0) last = h;
    const live = this._items.some(Boolean);
    if (last < 0) {
      this.geometry.setDrawRange(0, 0);
      this.object.visible = false;
      return;
    }
    const it = /** @type {NonNullable<GroundFrost['_items'][number]>} */ (this._items[last]);
    this.geometry.setDrawRange(0, (last * SLOT_QUADS + (it.tufts > 0 ? MAX_CELLS + it.tufts : it.cells)) * 6);
    this.object.visible = live;
  }

  /** @internal collapse quads [from, to) of patch h (patch-local; degenerate: nothing drawn) */
  _clearQuads(h, from, to) {
    if (to <= from) return;
    const a = h * SLOT_QUADS + from;
    const b = h * SLOT_QUADS + to;
    this._pos.array.fill(0, a * 12, b * 12);
    this._nrm.array.fill(0, a * 12, b * 12);
    this._tuft.array.fill(0, a * 16, b * 16);
    this._mark(a, b - a);
  }

  /** @internal upload the vertex data of `count` quads from global quad `start` */
  _mark(start, count) {
    if (count <= 0) return;
    for (const attr of [this._pos, this._nrm, this._tuft]) {
      attr.addUpdateRange(start * attr.itemSize * 4, count * attr.itemSize * 4);
      attr.needsUpdate = true;
    }
  }

  /** @internal the ground height for the cells */
  _height(it, x, z) {
    if (it.warm) return -500;
    const hf = this.heightField;
    if (!hf) return 0;
    const y = hf.surface ? hf.surface(x, z) : hf.sample(x, z);
    return Number.isFinite(y) ? y : 0;
  }

  /**
   * @internal Paint patch h at once (the warm-up): every slice of `_painter`.
   * @param {number} h
   */
  _paint(h) {
    const it = this._items[h];
    if (!it) return;
    it.painter = null;
    const g = this._painter(h);
    while (!g.next().done);
  }

  /**
   * @internal The paint of patch h — its square's texels (frost, veins, cracks), its cells and
   * tufts — in slices (`update` runs one a frame; seeded: sliced or not, the same patch). The patch
   * draws nothing until the last slice (its old quads are cleared first, its texels uploaded last).
   * @param {number} h
   * @returns {Generator<void, void, void>}
   */
  *_painter(h) {
    let t0 = nowMs();
    let total = 0;
    let worst = 0;
    /** Ends a slice's timing (before a yield; the next slice restarts `t0` when resumed). */
    const lap = () => {
      const t = nowMs();
      total += t - t0;
      worst = Math.max(worst, t - t0);
      t0 = t;
    };
    const it = /** @type {NonNullable<GroundFrost['_items'][number]>} */ (this._items[h]);
    // (a repaint: nothing of the old patch is drawn while the new one is painted)
    this._clearQuads(h, 0, it.cells);
    this._clearQuads(h, MAX_CELLS, MAX_CELLS + it.tufts);
    it.cells = 0;
    it.tufts = 0;
    it.paths = [];
    this._rangeDirty = true;
    const R = it.radius;
    const seed = it.seed | 0;
    const rng = new RNG(((seed * 0x9e3779b1) ^ 0x51ed27) >>> 0);

    // ---- the square: the ring's box and the crack's start (pulled in to fit), centred
    let from = it.from;
    if (from) {
      const lim = SLOT / TPU - R - 2; // the box stays within 16 u
      const dx = from.x - it.x;
      const dz = from.z - it.z;
      const m = Math.max(Math.abs(dx), Math.abs(dz));
      if (m > lim) from = { x: it.x + (dx * lim) / m, z: it.z + (dz * lim) / m };
    }
    let minX = it.x - R - 1;
    let minZ = it.z - R - 1;
    let maxX = it.x + R + 1;
    let maxZ = it.z + R + 1;
    if (from) {
      minX = Math.min(minX, from.x - 0.5);
      minZ = Math.min(minZ, from.z - 0.5);
      maxX = Math.max(maxX, from.x + 0.5);
      maxZ = Math.max(maxZ, from.z + 0.5);
    }
    const ox = Math.floor(((minX + maxX) / 2) * TPU) - SLOT / 2;
    const oz = Math.floor(((minZ + maxZ) / 2) * TPU) - SLOT / 2;
    this._uB[h].set(ox, oz, h * SLOT, 0);

    const D = this._data;
    const base = h * SLOT * SLOT * 4;
    this._data32.fill(EMPTY32, h * SLOT * SLOT, (h + 1) * SLOT * SLOT);
    const used = this._used;
    used.fill(0);
    const inSq = (i, j) => i >= 0 && j >= 0 && i < SLOT && j < SLOT;

    // ---- the frost's box (texels) and its veins: seeded random walks from the centre that
    // branch at ±60° (an ice crystal's angle); `vein` = the chessboard distance to one (≤ 6)
    const cxT = it.x * TPU - ox;
    const czT = it.z * TPU - oz;
    const ext = (R * 1.15 + 0.1) * TPU;
    const i0 = Math.max(0, Math.floor(cxT - ext));
    const i1 = Math.min(SLOT - 1, Math.ceil(cxT + ext));
    const j0 = Math.max(0, Math.floor(czT - ext));
    const j1 = Math.min(SLOT - 1, Math.ceil(czT + ext));
    const vein = this._vein;
    for (let j = j0; j <= j1; j++) vein.fill(6, j * SLOT + i0, j * SLOT + i1 + 1);
    const inBox = (i, j) => i >= i0 && j >= j0 && i <= i1 && j <= j1;
    const drawVein = (x0, z0, ang, len, depth) => {
      let x = x0;
      let z = z0;
      let a = ang;
      const n = Math.floor(len * 2); // half-texel steps
      let nextBranch = 4 + rng.next() * 7;
      let side = rng.next() < 0.5 ? 1 : -1;
      for (let k = 0; k < n; k++) {
        a += (rng.next() - 0.5) * 0.2;
        x += Math.cos(a) * 0.5;
        z += Math.sin(a) * 0.5;
        const i = Math.floor(x);
        const j = Math.floor(z);
        if (inBox(i, j)) vein[j * SLOT + i] = 0;
        if (depth < 2 && k * 0.5 >= nextBranch) {
          nextBranch = k * 0.5 + (depth ? 3 : 4) + rng.next() * (depth ? 4 : 6);
          drawVein(x, z, a + side * (Math.PI / 3) * (0.85 + rng.next() * 0.3), (len - k * 0.5) * (0.3 + rng.next() * 0.25), depth + 1);
          side = -side;
        }
      }
    };
    {
      const nRays = 7 + rng.int(0, 3);
      const a0 = rng.next() * Math.PI * 2;
      for (let r = 0; r < nRays; r++) {
        const ang = a0 + (r / nRays) * Math.PI * 2 + (rng.next() - 0.5) * 0.4;
        drawVein(cxT, czT, ang, R * TPU * (0.75 + rng.next() * 0.35), 0);
      }
    }
    // chessboard distance, two passes over the box
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * SLOT + i;
        let v = vein[k];
        if (v === 0) continue;
        if (i > i0) v = Math.min(v, vein[k - 1] + 1);
        if (j > j0) {
          v = Math.min(v, vein[k - SLOT] + 1);
          if (i > i0) v = Math.min(v, vein[k - SLOT - 1] + 1);
          if (i < i1) v = Math.min(v, vein[k - SLOT + 1] + 1);
        }
        vein[k] = v;
      }
    }
    for (let j = j1; j >= j0; j--) {
      for (let i = i1; i >= i0; i--) {
        const k = j * SLOT + i;
        let v = vein[k];
        if (v === 0) continue;
        if (i < i1) v = Math.min(v, vein[k + 1] + 1);
        if (j < j1) {
          v = Math.min(v, vein[k + SLOT] + 1);
          if (i < i1) v = Math.min(v, vein[k + SLOT + 1] + 1);
          if (i > i0) v = Math.min(v, vein[k + SLOT - 1] + 1);
        }
        vein[k] = v;
      }
    }

    // ---- noise, per 2 × 2 texels: the ragged edge (0.9 per u, 3 octaves) and the clumps (3.2
    // per u, 2 octaves)
    const bw = ((i1 - i0) >> 1) + 1;
    const bh = ((j1 - j0) >> 1) + 1;
    const noise = this._noise;
    const clump = this._clump;
    const bx0 = (ox + i0 + 1) / TPU;
    const bz0 = (oz + j0 + 1) / TPU;
    gridFbm(noise, bw, bh, bx0, bz0, 2 / TPU, 0.9, 3, seed * 31 + 7, this._lattice);
    gridFbm(clump, bw, bh, bx0, bz0, 2 / TPU, 3.2, 2, seed * 31 + 19, this._lattice);
    for (let q = 0, n = bw * bh; q < n; q++) clump[q] = Math.min(1, Math.max(0, (clump[q] - 0.5) * 1.9 + 0.5));
    lap();
    yield;
    t0 = nowMs();

    // ---- frost texels: R threshold, G tone | sparkle | phase (three slices: a third of the rows each)
    const invR = 1 / (R * TPU);
    const rows = Math.ceil((j1 - j0 + 1) / 3);
    for (let j = j0; j <= j1; j++) {
      if (j > j0 && (j - j0) % rows === 0) {
        lap();
        yield;
        t0 = nowMs();
      }
      const dz = (j + 0.5 - czT) * invR;
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5 - cxT) * invR;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 1.15) continue;
        const k = j * SLOT + i;
        const vd = vein[k];
        const bi = ((j - j0) >> 1) * bw + ((i - i0) >> 1);
        const n = noise[bi];
        const u = (hash2(ox + i, oz + j, seed) * 4294967296) >>> 0;
        const h1 = (u & 255) / 256;
        const h2 = ((u >>> 8) & 255) / 256;
        const h3 = ((u >>> 16) & 255) / 256;
        // density: a solid core, the veins and their feathering, sparse between them outside
        const core = 1 - smoothstep(0.2, 0.6, d);
        const near = VEIN_DENSITY[vd] * (1 - smoothstep(0.92, 1.12, d));
        const dens = Math.max(core, near) + (n - 0.5) * 0.3;
        if (vd > 0 && 0.65 * clump[bi] + 0.35 * h2 > dens) continue;
        let T = d * 0.85 + (n - 0.5) * 0.3 + (h1 - 0.5) * 0.05 - (vd <= 1 ? 0.1 : 0);
        if (T > 0.995) continue;
        if (T < 0) T = 0;
        let tone;
        if (vd === 0) tone = 3;
        else if (i > 0 && j > 0 && vein[k - SLOT - 1] === 0 && vein[k - SLOT] !== 0) tone = 0; // under a vein's lower-right
        else if (vd === 1) tone = h3 < 0.75 ? 2 : 1;
        else if (d > 0.7 && vd > 2 && h3 < 0.4) tone = 0;
        else tone = n > 0.57 ? 2 : 1;
        const sparkle = vd === 0 ? h3 < 0.1 : h3 > 0.975;
        const o = base + k * 4;
        D[o] = Math.round(T * 254);
        D[o + 1] = tone | (sparkle ? 4 : 0) | ((u >>> 27) << 3);
        used[(j >> 2) * CELLS_SIDE + (i >> 2)] = 1;
      }
    }
    lap();
    yield;
    t0 = nowMs();

    // ---- cracks: segments with arrival times (world u)
    /** @type {number[][]} [x0, z0, x1, z1, t0, t1] */
    const segs = [];
    /** @type {number[][][]} the main run and the two runs round the ring (their segments) */
    const paths = [[], [], []];
    const track = (path, from0) => { for (let k = from0; k < segs.length; k++) path.push(segs[k]); };
    const poly = (pts, ta0, ta1) => {
      let total = 0;
      for (let i = 0; i + 3 < pts.length; i += 2) total += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
      let acc = 0;
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const l = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
        const ta = ta0 + ((ta1 - ta0) * acc) / (total || 1);
        acc += l;
        segs.push([pts[i], pts[i + 1], pts[i + 2], pts[i + 3], ta, ta0 + ((ta1 - ta0) * acc) / (total || 1)]);
      }
    };
    const crng = new RNG(((seed * 0x85ebca6b) ^ 0x2c1b3c6d) >>> 0);
    let ringA;
    if (from) {
      ringA = Math.atan2(from.z - it.z, from.x - it.x);
      const qx = it.x + Math.cos(ringA) * R * 0.97;
      const qz = it.z + Math.sin(ringA) * R * 0.97;
      const main = jag(crng, from.x, from.z, qx, qz, 0.16, 4);
      poly(main, 0, CRACK.main);
      track(paths[0], 0);
      for (let b = 0; b < 3; b++) { // splinters off the main crack
        const k = 2 * Math.floor((0.2 + 0.6 * crng.next()) * (main.length / 2 - 1));
        const bx = main[k];
        const bz = main[k + 1];
        const dir = Math.atan2(qz - from.z, qx - from.x) + (crng.next() < 0.5 ? 1 : -1) * (0.6 + crng.next() * 0.5);
        const len = 0.3 + crng.next() * 0.5;
        const ta = (CRACK.main * k) / Math.max(1, main.length - 2);
        poly(jag(crng, bx, bz, bx + Math.cos(dir) * len, bz + Math.sin(dir) * len, 0.2, 2), ta, ta + CRACK.splinter);
      }
    } else {
      ringA = crng.next() * Math.PI * 2;
      poly(jag(crng, it.x, it.z, it.x + Math.cos(ringA) * R * 0.97, it.z + Math.sin(ringA) * R * 0.97, 0.16, 3), 0, CRACK.main);
      track(paths[0], 0);
    }
    // round the ring both ways, meeting on the far side; splinters in and out as they go
    const nArc = Math.ceil(Math.PI / 0.2);
    for (const sign of [1, -1]) {
      const arcPath = paths[sign > 0 ? 1 : 2];
      let px = it.x + Math.cos(ringA) * R * 0.97;
      let pz = it.z + Math.sin(ringA) * R * 0.97;
      for (let k = 1; k <= nArc; k++) {
        const a = ringA + sign * (k / nArc) * Math.PI;
        const rr = R * (0.97 + (k === nArc ? 0 : (crng.next() - 0.5) * 0.06));
        const qx = it.x + Math.cos(a) * rr;
        const qz = it.z + Math.sin(a) * rr;
        const ta = CRACK.main + ((CRACK.ring - CRACK.main) * (k - 1)) / nArc;
        const tb = CRACK.main + ((CRACK.ring - CRACK.main) * k) / nArc;
        const k0 = segs.length;
        poly(jag(crng, px, pz, qx, qz, 0.12, 1), ta, tb);
        track(arcPath, k0);
        if (k < nArc && crng.next() < 0.42) {
          if (crng.next() < 0.7) { // inward
            const len = R * (0.22 + crng.next() * 0.33);
            const b = a + (crng.next() - 0.5) * 0.5;
            poly(jag(crng, qx, qz, qx - Math.cos(b) * len, qz - Math.sin(b) * len, 0.18, 2), tb, Math.min(1, tb + CRACK.spoke));
          } else { // outward
            const len = 0.2 + crng.next() * 0.3;
            poly(jag(crng, qx, qz, qx + Math.cos(a) * len, qz + Math.sin(a) * len, 0.2, 1), tb, Math.min(1, tb + CRACK.splinter));
          }
        }
        px = qx;
        pz = qz;
      }
    }
    const nStar = 4 + crng.int(0, 2); // the star at the centre
    for (let s = 0; s < nStar; s++) {
      const a = crng.next() * Math.PI * 2;
      const len = R * (0.15 + crng.next() * 0.22);
      poly(jag(crng, it.x, it.z, it.x + Math.cos(a) * len, it.z + Math.sin(a) * len, 0.2, 2), CRACK.star0, CRACK.star1);
    }


    // clefts (class 1), the earliest arrival kept
    const clefts = this._clefts;
    let nc = 0;
    for (const [x0, z0, x1, z1, ta, tb] of segs) {
      walkLine(x0 * TPU - ox, z0 * TPU - oz, x1 * TPU - ox, z1 * TPU - oz, (i, j, u) => {
        if (!inSq(i, j)) return;
        const k = j * SLOT + i;
        const o = base + k * 4;
        const t = Math.min(253, Math.round((ta + (tb - ta) * u) * 254));
        if (D[o + 3] !== 1) {
          D[o + 3] = 1;
          D[o + 2] = t;
          if (nc < clefts.length) clefts[nc++] = k;
          used[(j >> 2) * CELLS_SIDE + (i >> 2)] = 1;
        } else if (t < D[o + 2]) D[o + 2] = t;
      });
    }
    // lips (class 2: the lower or the right neighbour, the wall that faces the light) and rime (3)
    for (let c = 0; c < nc; c++) {
      const k = clefts[c];
      const i = k % SLOT;
      const j = (k - i) / SLOT;
      const o = base + k * 4;
      const t = D[o + 2];
      const below = j + 1 < SLOT ? o + SLOT * 4 : -1;
      const right = i + 1 < SLOT ? o + 4 : -1;
      const lip = below >= 0 && D[below + 3] !== 1 ? below : right >= 0 && D[right + 3] !== 1 ? right : -1;
      if (lip >= 0 && (D[lip + 3] !== 2 || t < D[lip + 2])) {
        D[lip + 2] = t;
        D[lip + 3] = 2;
        const lk = (lip - base) >> 2;
        used[((lk / SLOT) >> 2) * CELLS_SIDE + ((lk % SLOT) >> 2)] = 1;
      }
      for (let n = 0; n < RIME.length; n += 2) {
        const ii = i + RIME[n];
        const jj = j + RIME[n + 1];
        if (!inSq(ii, jj)) continue;
        const q = base + (jj * SLOT + ii) * 4;
        if (D[q + 3] !== 0 || hash2(ox + ii, oz + jj, seed + 404) >= 0.24) continue;
        D[q + 2] = Math.min(253, t + 6);
        D[q + 3] = 3;
        used[(jj >> 2) * CELLS_SIDE + (ii >> 2)] = 1;
      }
    }
    lap();
    yield;
    t0 = nowMs();

    // ---- the cells over the texels that hold anything
    const P = this._pos.array;
    const N = this._nrm.array;
    const TF = this._tuft.array;
    const cbase = h * SLOT_QUADS;
    let c = 0;
    for (let q = 0; q < CELLS_SIDE * CELLS_SIDE; q++) {
      if (!used[q]) continue;
      if (c >= MAX_CELLS) {
        if (!this._warnedCells) {
          this._warnedCells = true;
          console.warn(`[GroundFrost] a patch needs more than ${MAX_CELLS} cells: the rest is dropped`);
        }
        break;
      }
      const ci = q % CELLS_SIDE;
      const cj = (q - ci) / CELLS_SIDE;
      const x0 = (ox + ci * CELL) / TPU;
      const z0 = (oz + cj * CELL) / TPU;
      const x1 = x0 + CELL / TPU;
      const z1 = z0 + CELL / TPU;
      const hc = this._height(it, (x0 + x1) / 2, (z0 + z1) / 2);
      const e = 1e-4; // corners sampled just inside the cell
      let h00 = this._height(it, x0 + e, z0 + e);
      let h10 = this._height(it, x1 - e, z0 + e);
      let h01 = this._height(it, x0 + e, z1 - e);
      let h11 = this._height(it, x1 - e, z1 - e);
      if (Math.abs(h00 - hc) > STEP_TOL) h00 = hc;
      if (Math.abs(h10 - hc) > STEP_TOL) h10 = hc;
      if (Math.abs(h01 - hc) > STEP_TOL) h01 = hc;
      if (Math.abs(h11 - hc) > STEP_TOL) h11 = hc;
      const v = (cbase + c) * 12;
      P[v] = x0; P[v + 1] = h00 + LIFT; P[v + 2] = z0;
      P[v + 3] = x1; P[v + 4] = h10 + LIFT; P[v + 5] = z0;
      P[v + 6] = x0; P[v + 7] = h01 + LIFT; P[v + 8] = z1;
      P[v + 9] = x1; P[v + 10] = h11 + LIFT; P[v + 11] = z1;
      // the cell's normal from its corners
      const sx = (h10 + h11 - h00 - h01) / (2 * (x1 - x0));
      const sz = (h01 + h11 - h00 - h10) / (2 * (z1 - z0));
      const l = Math.hypot(sx, 1, sz);
      for (let k = 0; k < 12; k += 3) {
        N[v + k] = -sx / l;
        N[v + k + 1] = 1 / l;
        N[v + k + 2] = -sz / l;
      }
      TF.fill(0, (cbase + c) * 16, (cbase + c + 1) * 16);
      c++;
    }
    // (written now, uploaded and counted at the end: the patch draws nothing before its last slice)
    const cells = c;

    // ---- frozen tufts: on a jittered grid where the frost is, rising as it passes them
    let nt = 0;
    if (this.tufts) {
      const g0x = Math.floor((ox + i0) / TPU / TUFT_STEP);
      const g1x = Math.ceil((ox + i1) / TPU / TUFT_STEP);
      const g0z = Math.floor((oz + j0) / TPU / TUFT_STEP);
      const g1z = Math.ceil((oz + j1) / TPU / TUFT_STEP);
      for (let gz = g0z; gz <= g1z && nt < MAX_TUFTS; gz++) {
        for (let gx = g0x; gx <= g1x && nt < MAX_TUFTS; gx++) {
          const u = (hash2(gx, gz, seed + 505) * 4294967296) >>> 0;
          if ((u & 255) / 256 > 0.24) continue;
          const x = (gx + 0.15 + (((u >>> 8) & 255) / 256) * 0.7) * TUFT_STEP;
          const z = (gz + 0.15 + (((u >>> 16) & 255) / 256) * 0.7) * TUFT_STEP;
          const i = Math.floor(x * TPU) - ox;
          const j = Math.floor(z * TPU) - oz;
          if (!inSq(i, j)) continue;
          const o = base + (j * SLOT + i) * 4;
          // only on the frost's inner part, never in a cleft
          if (D[o] === NONE || D[o] > 0.75 * 254 || D[o + 3] === 1) continue;
          const T = Math.min(0.995, D[o] / 254 + 0.03);
          const y = this._height(it, x, z);
          const q = cbase + MAX_CELLS + nt;
          const v = q * 12;
          const w = q * 16;
          const variant = 1 + ((u >>> 24) % TUFT_VARIANTS);
          for (let k = 0; k < 4; k++) {
            P[v + k * 3] = x; P[v + k * 3 + 1] = y; P[v + k * 3 + 2] = z;
            // (half up, half toward the default camera — south, +z: a blade is lit less than the ground)
            N[v + k * 3] = 0; N[v + k * 3 + 1] = 0.55; N[v + k * 3 + 2] = 0.835;
            // corners: (+½, 0) (−½, 0) (+½, 1) (−½, 1) — front-facing toward the camera
            TF[w + k * 4] = k & 1 ? -0.5 : 0.5;
            TF[w + k * 4 + 1] = k >> 1;
            TF[w + k * 4 + 2] = T;
            TF[w + k * 4 + 3] = variant;
          }
          nt++;
        }
      }
    }
    this._mark(cbase, cells);
    this._mark(cbase + MAX_CELLS, nt);
    // the patch is ready: its counts, its crack runs, its texels uploaded, the draw range
    it.cells = cells;
    it.tufts = nt;
    it.paths = paths;
    it.dirty = false;
    this.texture.needsUpdate = true;
    this._rangeDirty = true;
    lap();
    this.paintMs = Math.round(total * 100) / 100;
    this.sliceMs = Math.round(worst * 100) / 100;
  }
}
