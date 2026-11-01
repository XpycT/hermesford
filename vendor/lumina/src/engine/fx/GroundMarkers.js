import * as THREE from 'three';
import { RENDER_ORDER } from '../constants.js';
import { globalUniforms } from '../render/GlobalUniforms.js';

/**
 * GroundMarkers — instanced, terrain-draped telegraph decals for combat (COMBAT.md §11.2): enemy
 * wind-up circles / sectors / lanes / rings, the player's skill areas, the lock-on ring, the boss
 * barrier outline and magma pools, in ONE draw call (`customProgramCacheKey`
 * `luminati-groundmarkers-v1`; renderOrder RENDER_ORDER.DECALS + 1, polygonOffset (−2, −4), no depth
 * write, transparent, fog, no shadows, not frustum-culled; hidden while no marker is live).
 *
 * **Draped.** Every instance is one shared 24 × 24-segment grid (1 152 triangles) spanning the
 * shape's bounding rectangle; the vertex shader samples a height texture at every vertex:
 * `y = height(x, z) + spec.y`. With `heightField` the constructor bakes `heightField.sample(x, z)`
 * at the centres of a `res`-texels-per-unit grid over the bounds into an R16F (HalfFloat) texture
 * (clamp) — always at `res` (4), never lower (COMBAT-09): the bake runs in row slices of ≤ 6 ms
 * (the first in the constructor, then one per macrotask through a `setTimeout(0)` pump, plus a
 * ≤ 2 ms slice per `update()`), and the texture is uploaded once when the last row is done. A
 * level that bakes within the first slices (Cinderwatch, 96 × 120: 10–23 ms cold) is finished
 * long before its loading ends; a slow machine or a big level only takes more slices, never a
 * long task. Should the batch be drawn before the bake is done (the game never does: the pump
 * ends during the scene compile), `onBeforeRender` finishes it first, so a drawn marker is always
 * draped on the full-resolution heights. `heightReady` tells whether the bake is done; `bakeMs`
 * (CPU ms over all slices), `bakeSlices` and `bakeLongestMs` describe it. Without `heightField`
 * a 1 × 1 zero texture is bound (same program) and `spec.y` is the absolute height (sandboxes).
 * The vertex shader reads the texel that CONTAINS the vertex (texel-centre lookup):
 * at res 4 a texel is exactly one stair step, so stair treads, terraces and plateaus come out
 * exact, and a cliff or riser between two grid vertices becomes a steep sliver of ≤ one grid cell.
 *
 * `set(h, spec)` takes a MarkerSpec: `{ shape: 'circle'|'ring'|'sector'|'lane'|'rect', x, y = 0.03,
 * z, r, rInner, dirX, dirZ, halfAngle (deg), len, width, w, d, progress: 0..1,
 * style: 'enemy'|'player'|'lock'|'barrier'|'magma', alpha = 1, flash = 0 }` (COMBAT.md §9.5).
 * - circle: disc of radius r around (x, z); ring: annulus rInner..r; sector: apex (x, z), radius r,
 *   ±halfAngle around (dirX, dirZ); lane: from (x, z) along (dirX, dirZ), `len` × `width`;
 *   rect: centre (x, z), `w` across × `d` along (dirX, dirZ) — outline only.
 * - `progress` grows the fill from the centre / apex / lane start (a ring: from rInner outward)
 *   with a bright 1 px leading edge; at progress 1 an `enemy` rim turns white (0.95, 0.88, 0.78 —
 *   its brightest channel under the 1.05 bloom threshold; the old (3, 3, 3) bloomed) — the caller keeps it 5 f, then
 *   frees it. `flash` (0..1, optional, additive to §9.5) whitens the rim the same way for a lane /
 *   circle that LOCKS before it resolves (§7.3).
 * - A fragment is drawn only where the draped surface lies on the ground: the fragment shader
 *   reads the height texel under it and drops the fragment when the interpolated height differs
 *   by > 0.12 u (a grid triangle spanning a cliff or riser), so a lane across a ledge is a clean
 *   step rather than sawtooth slivers.
 * - The pattern is quantised to 16 texels per unit in WORLD space (aligned with the terrain's
 *   texels), so rims and fills have pixel-art edges at any rotation. The rim pulses on `uTime`.
 * - Styles (linear HDR): `enemy` red-orange rim (2.6, 0.34, 0.12), fill (1.3, 0.13, 0.05) alpha
 *   0.22 → 0.5 with progress (0.12 ahead of the fill front); `player` gold rim (2.2, 1.6, 0.6), fill
 *   (1.25, 0.95, 0.35) alpha 0.14 → 0.34; `lock` thin rotating gold dashes (1.8, 1.4, 0.5), no fill;
 *   `barrier` pulsing outline (1.3, 0.45, 0.15) × 0.7–1.3 with a faint 3-texel inner band; `magma`
 *   a cellular crust (F2 − F1 of a jittered 1.75-per-unit grid, in world texels) — dark basalt
 *   plates (0.105, 0.034, 0.018) × 0.8–1.4 alpha 0.95, ~0.6 u across, with a dark-red cooling
 *   band (0.5, 0.085, 0.02) along glowing cracks (1.3, 0.5, 0.09) × 0.45–1.05 alpha 0.92; one plate
 *   in six molten (0.9, 0.2, 0.035) × 0.55–0.95 alpha 0.85; the crack and molten glow follow a
 *   slowly flowing noise, the plates stay put — and a glowing edge (1.5, 0.36, 0.07) alpha 0.8,
 *   every colour below the 1.05 bloom threshold (COMBAT-15). (Until COMBAT-16 the fill was (1.0, 0.27,
 *   0.05) × 0.55–0.9 alpha 0.5 with a smooth noise and a rare dark crust: a flat orange disc at game
 *   zoom.) The barrier and magma were brighter at first ((2.6, 0.9, 0.3); (1.6, 0.42,
 *   0.08) × 1.25) and hazed the closed arena / the player on a pool with bloom. (COMBAT.md §11.2 gave the enemy
 *   rim (2.4, 0.55, 0.18) and fill (0.9, 0.2, 0.08) 0.18 → 0.42: at Cinderwatch's golden hour those
 *   tone-map to the same orange-gold as the player style and the fill vanishes on lit ground, so
 *   green / blue were lowered and the fill strengthened; magma likewise.)
 * - A lazy enemy pack may add styles (`registerMarkerStyles`, COMBAT.md §30.6: The Bells of
 *   Evermere's `frost` and `crack`, src/game/combat/packs/evermere/core.js) before the combat makes
 *   its batch: their branches are spliced into the fragment shader of the batches made after (still
 *   one program); a page without one keeps this shader's source byte for byte.
 */

/** Grid segments per side of the shared, draped instance grid (binding, §11.2). */
export const MARKER_GRID = 24;

const SHAPES = { circle: 0, ring: 1, sector: 2, lane: 3, rect: 4 };
const STYLES = { enemy: 0, player: 1, lock: 2, barrier: 3, magma: 4 };
/** The styles' fragment branches a pack added (`registerMarkerStyles`), spliced in before magma's. */
let PACK_GLSL = '';
const MAGMA_BRANCH = '\t} else { // magma';

/**
 * Add a lazy enemy pack's marker styles (COMBAT.md §30.6): `ids` maps each new name to its style
 * id (5 and up), `glsl` holds their fragment branches — `} else if ( style == <id> ) { … }` each,
 * written against the shader's locals (shape, prog, p0, p1, sd, front, dash, ang, dist, along,
 * across, pq, pulse, rim, filled, lead, flash; they set col and a). Call it before the batch is
 * made. The same names and ids again (a pack registered twice) change nothing; another name or id
 * already taken throws.
 * @param {Readonly<Record<string, number>>} ids
 * @param {string} glsl
 */
export function registerMarkerStyles(ids, glsl) {
  const names = Object.keys(ids);
  if (names.every((n) => STYLES[n] === ids[n])) return;
  const taken = Object.values(STYLES);
  for (const n of names) {
    if (Object.hasOwn(STYLES, n) || !(ids[n] >= 5) || taken.includes(ids[n])) throw new Error(`registerMarkerStyles: the style "${n}" (${ids[n]}) is taken`);
  }
  Object.assign(STYLES, ids);
  PACK_GLSL += glsl;
}

/**
 * What `GroundMarkers#set` reads: a MarkerSpec (COMBAT.md §9.5; the combat code's `MarkerSpec` in
 * src/game/combat/types.d.ts is assignable to it) + optional `flash`. Every field but `shape` has a
 * default (see the class comment); `shape` is 'circle' | 'ring' | 'sector' | 'lane' | 'rect' and
 * `style` 'enemy' | 'player' | 'lock' | 'barrier' | 'magma' — any other value hides the marker
 * (one console.warn per name).
 * @typedef {object} GroundMarkerSpec
 * @property {string} shape
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [z]
 * @property {number} [r]
 * @property {number} [rInner]
 * @property {number} [dirX]
 * @property {number} [dirZ]
 * @property {number} [halfAngle]
 * @property {number} [len]
 * @property {number} [width]
 * @property {number} [w]
 * @property {number} [d]
 * @property {number} [progress]
 * @property {string} [style]
 * @property {number} [alpha]
 * @property {number} [flash]
 */
/** Margin around a shape's bounding rectangle (u): the 2-texel rim plus one texel. */
const MARGIN = 3 / 16;
/**
 * Height-texture bake slices (COMBAT-09): the constructor and each pump task bake rows for up to
 * BAKE_SLICE_MS, each `update()` for up to BAKE_FRAME_SLICE_MS (at least one row per slice).
 */
const BAKE_SLICE_MS = 6;
const BAKE_FRAME_SLICE_MS = 2;
/** Largest height-texture side (texels): `res` drops below 4 only for a level wider than 1024 u. */
const MAX_HEIGHT_TEXELS = 4096;

const GM_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

uniform sampler2D uHeight;
uniform vec4 uHeightRect; // minX, minZ, width (u), depth (u)
uniform vec2 uHeightSize; // texels

attribute vec4 iOrigin; // xz shape origin, zw direction (V axis)
attribute vec4 iRect;   // local bounding rect: u0, u1 (across), v0, v1 (along)
attribute vec4 iShape;  // shape id, style id, progress, alpha
attribute vec4 iParams; // p0, p1 (shape parameters), y lift, flash

varying vec2 vWorld;
varying vec2 vOrigin;
varying vec2 vDir;
varying vec4 vShape;
varying vec4 vParams;
varying float vY;

void main() {
	vec2 d = iOrigin.zw;
	float l = length( d );
	d = l > 1e-6 ? d / l : vec2( 0.0, 1.0 );
	vec2 across = vec2( - d.y, d.x );
	vec2 g = position.xy + 0.5; // PlaneGeometry(1, 1, 24, 24): 0..1
	float lu = mix( iRect.x, iRect.y, g.x );
	float lv = mix( iRect.z, iRect.w, g.y );
	vec2 xz = iOrigin.xy + across * lu + d * lv;

	// texel-centre height lookup (the texel containing the vertex)
	vec2 hc = clamp( ( xz - uHeightRect.xy ) / uHeightRect.zw, 0.0, 1.0 ) * uHeightSize;
	hc = ( min( floor( hc ), uHeightSize - 1.0 ) + 0.5 ) / uHeightSize;
	float y = texture2D( uHeight, hc ).r + iParams.z;

	vWorld = xz;
	vY = y;
	vOrigin = iOrigin.xy;
	vDir = d;
	vShape = iShape;
	vParams = iParams;

	vec4 mvPosition = viewMatrix * vec4( xz.x, y, xz.y, 1.0 );
	gl_Position = projectionMatrix * mvPosition;

	#include <fog_vertex>
}
`;

const GM_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>

uniform float uTime;
uniform sampler2D uHeight;
uniform vec4 uHeightRect;
uniform vec2 uHeightSize;

varying vec2 vWorld;
varying vec2 vOrigin;
varying vec2 vDir;
varying vec4 vShape;
varying vec4 vParams;
varying float vY;

const float TX = 1.0 / 16.0; // one texel (16 per unit)

float gmHash( vec2 p ) {
	return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}
float gmNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( gmHash( i ), gmHash( i + vec2( 1.0, 0.0 ) ), f.x ),
		mix( gmHash( i + vec2( 0.0, 1.0 ) ), gmHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}

void main() {
	// draped only where it lies on the ground: a grid triangle that spans a cliff or riser (its
	// interpolated height is not the height of the texel under the fragment) is dropped, so a lane
	// across a ledge shows a clean step instead of a row of sloped sawtooth slivers
	vec2 hc = clamp( ( vWorld - uHeightRect.xy ) / uHeightRect.zw, 0.0, 1.0 ) * uHeightSize;
	hc = ( min( floor( hc ), uHeightSize - 1.0 ) + 0.5 ) / uHeightSize;
	if ( abs( vY - ( texture2D( uHeight, hc ).r + vParams.z ) ) > 0.12 ) discard;

	// world-quantised texel centre: pixel-art edges aligned with the terrain texels
	vec2 pq = ( floor( vWorld * 16.0 ) + 0.5 ) * TX;
	vec2 rel = pq - vOrigin;
	float along = dot( rel, vDir );
	float across = dot( rel, vec2( - vDir.y, vDir.x ) );
	float dist = length( rel );

	int shape = int( vShape.x + 0.5 );
	int style = int( vShape.y + 0.5 );
	float prog = vShape.z >= 0.9995 ? 1.0 : clamp( vShape.z, 0.0, 1.0 );
	float p0 = vParams.x;
	float p1 = vParams.y;

	// sd: signed distance to the outline (< 0 inside); front: the progress fill's leading edge
	// coordinate minus its current extent (< 0 = already filled); dash: perimeter parameter
	float sd;
	float front;
	float dash;
	float ang = atan( across, along );
	if ( shape == 0 ) { // circle
		sd = dist - p0;
		front = dist - p0 * prog;
		dash = ang / 6.2831853 * 8.0;
	} else if ( shape == 1 ) { // ring rInner (p1) .. r (p0)
		sd = max( dist - p0, p1 - dist );
		front = dist - ( p1 + ( p0 - p1 ) * prog );
		dash = ang / 6.2831853 * 8.0;
	} else if ( shape == 2 ) { // sector: radius p0, half angle p1 (rad)
		float off = abs( ang ) - p1;
		float edge = p1 >= 3.1415 ? - 1e3 : dist * sin( clamp( off, - 1.5707963, 1.5707963 ) );
		sd = max( dist - p0, edge );
		front = dist - p0 * prog;
		dash = ang / 6.2831853 * 8.0 + dist;
	} else if ( shape == 3 ) { // lane: len p0 along, width p1 across
		sd = max( max( - along, along - p0 ), abs( across ) - p1 * 0.5 );
		front = along - p0 * prog;
		dash = ( along + abs( across ) ) * 1.5;
	} else { // rect: w p0 across, d p1 along (outline only)
		sd = max( abs( across ) - p0 * 0.5, abs( along ) - p1 * 0.5 );
		front = 1.0;
		dash = ( along + across ) * 1.5;
	}
	if ( sd > 0.0 ) discard;

	float pulse = 0.5 + 0.5 * sin( uTime * 6.2831853 * 2.5 );
	float rimW = ( style == 2 ) ? TX : 2.0 * TX;
	bool rim = sd > - rimW;
	if ( shape == 4 && ! rim && style != 3 ) discard; // rect: outline only (barrier keeps its glow band)
	bool filled = front <= 0.0;
	bool lead = prog > 0.0 && prog < 1.0 && front <= 0.0 && front > - TX && shape != 4;
	// (0.9995: an instance's progress of exactly 1 can interpolate to 0.99999994 across a triangle;
	// step( 1.0, … ) then dropped the white on part of a rim, leaving the brighter red there)
	float flash = max( vParams.w, step( 0.9995, vShape.z ) );

	vec3 col = vec3( 0.0 );
	float a = 0.0;

	if ( style == 0 ) { // enemy: red-orange (stays red through ACES at golden hour), white at progress 1
		// (luminance kept ≤ ~1.05, the bloom threshold: the phase-3 shockwave rings — white at
		// progress 1 for their whole life — bloomed the player standing on them into a smear)
		vec3 rimC = vec3( 2.6, 0.34, 0.12 ) * ( 0.85 + 0.25 * prog + 0.1 * pulse );
		vec3 fillC = vec3( 1.3, 0.13, 0.05 );
		if ( rim ) { col = mix( rimC, vec3( 0.95, 0.88, 0.78 ), flash ); a = 0.92; }
		else if ( lead ) { col = vec3( 2.6, 0.45, 0.14 ); a = 0.8; }
		else if ( shape != 4 ) { col = fillC; a = filled ? mix( 0.22, 0.5, prog ) : 0.12; }
	} else if ( style == 1 ) { // player: gold
		vec3 rimC = vec3( 2.2, 1.6, 0.6 ) * ( 0.9 + 0.2 * pulse );
		if ( rim ) { col = mix( rimC, vec3( 0.95, 0.88, 0.78 ), vParams.w ); a = 0.9; }
		else if ( lead ) { col = vec3( 2.4, 1.9, 0.9 ); a = 0.75; }
		else if ( shape != 4 ) { col = vec3( 1.25, 0.95, 0.35 ); a = filled ? mix( 0.14, 0.34, prog ) : 0.07; }
	} else if ( style == 2 ) { // lock: thin rotating dashes, no fill
		float t = fract( dash - uTime * 0.35 );
		if ( rim && t < 0.55 ) { col = vec3( 1.8, 1.4, 0.5 ); a = 0.95; }
	} else if ( style == 3 ) { // barrier: pulsing outline + a faint inner band, below the bloom
		// threshold (the whole outline used to haze the closed arena orange)
		float bp = 0.7 + 0.6 * ( 0.5 + 0.5 * sin( uTime * 6.2831853 * 1.2 ) );
		if ( rim ) { col = vec3( 1.3, 0.45, 0.15 ) * bp; a = 0.95; }
		else if ( sd > - 3.0 * TX ) { col = vec3( 0.9, 0.28, 0.08 ); a = 0.1 * bp; }
	} else { // magma: dark basalt plates split by glowing cracks, a glowing edge (below bloom)
		if ( ! filled && shape != 4 ) discard;
		// cellular crust (COMBAT-16): plates ~0.6 u across (a smooth noise fill read as a flat
		// orange disc at game zoom) — F2 − F1 of a jittered grid in world texels; the cracks' glow
		// flows with a slow noise, the plates stay put (no shimmer on the pixel grid)
		vec2 cp = pq * 1.75;
		vec2 ci = floor( cp );
		vec2 cf = fract( cp );
		float f1 = 8.0;
		float f2 = 8.0;
		float cellH = 0.0;
		for ( int y = - 1; y <= 1; y ++ ) {
			for ( int x = - 1; x <= 1; x ++ ) {
				vec2 o = vec2( float( x ), float( y ) );
				vec2 c = ci + o;
				vec2 r = o + 0.15 + 0.7 * vec2( gmHash( c ), gmHash( c + vec2( 17.3, 5.1 ) ) ) - cf;
				float d = dot( r, r );
				if ( d < f1 ) { f2 = f1; f1 = d; cellH = gmHash( c + vec2( 3.7, 9.2 ) ); }
				else if ( d < f2 ) f2 = d;
			}
		}
		float crack = sqrt( f2 ) - sqrt( f1 ); // 0 on a crack, ~0.5 in a plate's middle
		float flow = gmNoise( pq * 2.2 + vec2( uTime * 0.35, - uTime * 0.27 ) );
		if ( rim ) { col = vec3( 1.5, 0.36, 0.07 ) * ( 0.8 + 0.3 * pulse ); a = 0.8; }
		else if ( crack < 0.08 ) { col = vec3( 1.3, 0.5, 0.09 ) * ( 0.45 + 0.6 * flow ); a = 0.92; }
		else if ( cellH < 0.17 ) { col = vec3( 0.9, 0.2, 0.035 ) * ( 0.55 + 0.4 * flow ); a = 0.85; } // a molten plate
		else if ( crack < 0.17 ) { col = vec3( 0.5, 0.085, 0.02 ) * ( 0.7 + 0.4 * flow ); a = 0.86; }
		// (a warm floor and 0.95 alpha: at 0.88 the blue night fill showed through and the plates
		// read purple-grey, like cold stone)
		else { col = vec3( 0.105, 0.034, 0.018 ) * ( 0.8 + 0.6 * cellH ); a = 0.95; }
	}

	a *= clamp( vShape.w, 0.0, 1.0 );
	if ( a <= 0.004 ) discard;
	gl_FragColor = vec4( col, a );

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}
`;

/** Floats per instance in each attribute. */
const STRIDES = { iOrigin: 4, iRect: 4, iShape: 4, iParams: 4 };

/** Monotonic milliseconds (the bake slices only — never affects the baked content). */
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : 0);

/**
 * Mark `count` floats from `start` of attribute `a` for upload through ONE reusable range object
 * (`addUpdateRange` pushes a new `{ start, count }` every call — a per-frame allocation). A range
 * still waiting for its upload (the batch was not drawn yet) is widened to cover both.
 * @param {THREE.BufferAttribute} a
 * @param {{ start: number, count: number }} range this attribute's own range object
 * @param {number} start
 * @param {number} count
 */
function markRange(a, range, start, count) {
  const R = a.updateRanges;
  if (R.length === 0) {
    range.start = start;
    range.count = count;
    R.push(range);
  } else if (R.length === 1 && R[0] === range) {
    const end = Math.max(range.start + range.count, start + count);
    range.start = Math.min(range.start, start);
    range.count = end - range.start;
  } else a.clearUpdateRanges(); // unknown ranges: upload the whole buffer
  a.needsUpdate = true;
}

export class GroundMarkers {
  /**
   * @param {{ capacity?: number, name?: string,
   *           heightField?: { sample: (x: number, z: number) => number, minX: number, minZ: number,
   *                           maxX: number, maxZ: number, res?: number } | null }} [opts]
   *   capacity: instances (48); name: object name ('fx:markers'); heightField: the terrain to drape
   *   over (the game passes `tileMap.getHeight` and the level bounds)
   */
  constructor({ capacity = 48, name = 'fx:markers', heightField = null } = {}) {
    this.capacity = Math.max(1, capacity | 0);
    this.heightField = heightField;
    const cap = this.capacity;

    const base = new THREE.PlaneGeometry(1, 1, MARKER_GRID, MARKER_GRID);
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(base.index);
    geometry.setAttribute('position', base.getAttribute('position'));
    base.dispose();
    this._attrs = {};
    this._attrList = [];
    for (const [key, size] of Object.entries(STRIDES)) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(key, a);
      this._attrs[key] = a;
      this._attrList.push(a);
    }
    /** One reusable upload range per attribute (see markRange). */
    this._ranges = this._attrList.map(() => ({ start: 0, count: 0 }));
    this.geometry = geometry;

    /** Height texture: baked from `heightField` in slices (see the class comment), or a 1 × 1 zero texel. */
    const bake = heightField ? this._startBake(heightField) : null;
    /** @internal the running bake (null once done, or without a heightField) */
    this._bake = bake;
    this._bakeTimer = 0;
    /** Texels per unit of the height texture (4; 0 without a heightField). */
    this.heightRes = bake ? bake.res : 0;
    /** CPU time of the whole bake (ms, summed over its slices; 0 until it is done). */
    this.bakeMs = 0;
    /** Slices the bake took (1: it finished in the constructor). */
    this.bakeSlices = 0;
    /** Longest single slice (ms). */
    this.bakeLongestMs = 0;
    const w = bake ? bake.w : 1;
    const h = bake ? bake.h : 1;
    const data = bake ? bake.data : new Uint16Array(1);
    this.heightTexture = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.HalfFloatType);
    this.heightTexture.name = `${name}:height`;
    this.heightTexture.magFilter = THREE.LinearFilter;
    this.heightTexture.minFilter = THREE.LinearFilter;
    this.heightTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.heightTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTexture.generateMipmaps = false;
    this.heightTexture.colorSpace = THREE.NoColorSpace;
    this.heightTexture.needsUpdate = true;
    const rect = bake ? [bake.minX, bake.minZ, w / bake.res, h / bake.res] : [0, 0, 1, 1];

    this.material = new THREE.ShaderMaterial({
      name: 'GroundMarkers',
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uFogStart: globalUniforms.uFogStart,
        uHeight: { value: this.heightTexture },
        uHeightRect: { value: new THREE.Vector4(...rect) },
        uHeightSize: { value: new THREE.Vector2(w, h) },
        uTime: globalUniforms.uTime,
      },
      vertexShader: GM_VERTEX,
      fragmentShader: PACK_GLSL ? GM_FRAGMENT.replace(MAGMA_BRANCH, `${PACK_GLSL}\n${MAGMA_BRANCH}`) : GM_FRAGMENT,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.material.customProgramCacheKey = () => 'luminati-groundmarkers-v1';

    /** Add to the scene: one draw call, hidden while no marker is live. */
    this.object = new THREE.InstancedMesh(geometry, this.material, cap);
    this.object.name = name;
    this.object.count = 0;
    this.object.visible = false;
    this.object.renderOrder = RENDER_ORDER.DECALS + 1;
    this.object.frustumCulled = false;
    this.object.castShadow = false;
    this.object.receiveShadow = false;
    this.object.matrixAutoUpdate = false;

    this._slotOf = new Int32Array(cap).fill(-1);
    this._handleAt = new Int32Array(cap);
    this._freeStack = new Int32Array(cap);
    for (let i = 0; i < cap; i++) this._freeStack[i] = cap - 1 - i;
    this._freeTop = cap;
    this._count = 0;
    this._dirtyMin = Infinity;
    this._dirtyMax = -1;
    this._countDirty = false;
    this._warned = null;

    // the height bake: a first slice now, the rest through the pump (and update()); a draw before
    // it is done finishes it first
    if (bake) {
      this._pump = () => {
        this._bakeTimer = 0;
        if (!this._bake) return;
        this._bakeSlice(BAKE_SLICE_MS);
        if (this._bake) this._bakeTimer = setTimeout(this._pump, 0);
      };
      this.object.onBeforeRender = () => { if (this._bake) this._bakeSlice(Infinity); };
      this._bakeSlice(BAKE_SLICE_MS);
      if (this._bake) this._bakeTimer = setTimeout(this._pump, 0);
    }
  }

  /** True once the height texture is fully baked (always true without a heightField). */
  get heightReady() { return this._bake === null; }

  /** @returns {number} a handle, or −1 when the batch is full */
  alloc() {
    if (this._freeTop <= 0) return -1;
    const h = this._freeStack[--this._freeTop];
    const slot = this._count++;
    this._slotOf[h] = slot;
    this._handleAt[slot] = h;
    this._attrs.iShape.array[slot * 4 + 3] = 0; // invisible (alpha 0) until the first set()
    this._dirty(slot);
    this._countDirty = true;
    return h;
  }

  /**
   * Update a marker (every field of the MarkerSpec is read; the caller may reuse `spec`).
   * Allocation-free.
   * @param {number} h handle
   * @param {GroundMarkerSpec} spec MarkerSpec (COMBAT.md §9.5) + optional `flash`
   */
  set(h, spec) {
    const slot = h >= 0 && h < this.capacity ? this._slotOf[h] : -1;
    if (slot < 0) return;
    const o = slot * 4;
    const A = this._attrs;
    const shape = SHAPES[spec.shape];
    const style = STYLES[spec.style ?? 'enemy'];
    if (shape === undefined || style === undefined) {
      A.iShape.array[o + 3] = 0;
      this._dirty(slot);
      const bad = shape === undefined ? `shape "${spec.shape}"` : `style "${spec.style}"`;
      if (!this._warned?.has(bad)) {
        (this._warned ??= new Set()).add(bad);
        console.warn(`[GroundMarkers] unknown ${bad}`);
      }
      return;
    }
    let dx = spec.dirX ?? 0;
    let dz = spec.dirZ ?? 1;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-6) { dx /= dl; dz /= dl; } else { dx = 0; dz = 1; }

    // shape parameters and the bounding rectangle in the (across, along) frame
    const m = MARGIN;
    let p0 = 0;
    let p1 = 0;
    let u0;
    let u1;
    let v0;
    let v1;
    if (shape === 0 || shape === 1) { // circle / ring
      p0 = Math.max(0, spec.r ?? 1);
      p1 = shape === 1 ? Math.min(p0, Math.max(0, spec.rInner ?? 0)) : 0;
      u0 = v0 = -p0 - m;
      u1 = v1 = p0 + m;
    } else if (shape === 2) { // sector
      p0 = Math.max(0, spec.r ?? 1);
      const half = Math.min(180, Math.max(0, spec.halfAngle ?? 60)) * (Math.PI / 180);
      p1 = half;
      const umax = half >= Math.PI / 2 ? p0 : p0 * Math.sin(half);
      u0 = -umax - m;
      u1 = umax + m;
      v0 = Math.min(0, p0 * Math.cos(half)) - m;
      v1 = p0 + m;
    } else if (shape === 3) { // lane
      p0 = Math.max(0, spec.len ?? 1);
      p1 = Math.max(0, spec.width ?? 1);
      u0 = -p1 * 0.5 - m;
      u1 = p1 * 0.5 + m;
      v0 = -m;
      v1 = p0 + m;
    } else { // rect
      p0 = Math.max(0, spec.w ?? 1);
      p1 = Math.max(0, spec.d ?? 1);
      u0 = -p0 * 0.5 - m;
      u1 = p0 * 0.5 + m;
      v0 = -p1 * 0.5 - m;
      v1 = p1 * 0.5 + m;
    }

    const org = A.iOrigin.array;
    org[o] = spec.x ?? 0;
    org[o + 1] = spec.z ?? 0;
    org[o + 2] = dx;
    org[o + 3] = dz;
    const rc = A.iRect.array;
    rc[o] = u0;
    rc[o + 1] = u1;
    rc[o + 2] = v0;
    rc[o + 3] = v1;
    const sh = A.iShape.array;
    sh[o] = shape;
    sh[o + 1] = style;
    sh[o + 2] = spec.progress ?? 0;
    sh[o + 3] = spec.alpha ?? 1;
    const pr = A.iParams.array;
    pr[o] = p0;
    pr[o + 1] = p1;
    pr[o + 2] = spec.y ?? 0.03;
    pr[o + 3] = spec.flash ?? 0;
    this._dirty(slot);
  }

  /** @param {number} h handle to release (ignored when already free) */
  free(h) {
    const slot = h >= 0 && h < this.capacity ? this._slotOf[h] : -1;
    if (slot < 0) return;
    const last = --this._count;
    if (slot !== last) {
      const list = this._attrList;
      for (let i = 0; i < list.length; i++) {
        const size = list[i].itemSize;
        list[i].array.copyWithin(slot * size, last * size, last * size + size);
      }
      const moved = this._handleAt[last];
      this._slotOf[moved] = slot;
      this._handleAt[slot] = moved;
      this._dirty(slot);
    }
    this._slotOf[h] = -1;
    this._freeStack[this._freeTop++] = h;
    this._countDirty = true;
  }

  /** Release every handle. */
  clear() {
    for (let s = 0; s < this._count; s++) this._slotOf[this._handleAt[s]] = -1;
    const cap = this.capacity;
    for (let i = 0; i < cap; i++) this._freeStack[i] = cap - 1 - i;
    this._freeTop = cap;
    this._count = 0;
    this._countDirty = true;
  }

  /**
   * Once per frame: upload dirty ranges, set the draw count and `object.visible` (count > 0); while
   * the height bake runs, one ≤ 2 ms slice of it.
   */
  update() {
    if (this._bake) this._bakeSlice(BAKE_FRAME_SLICE_MS);
    if (this._dirtyMax >= 0) {
      const lo = this._dirtyMin;
      const n = this._dirtyMax - lo + 1;
      const list = this._attrList;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const size = a.itemSize;
        // one range per attribute, widened until the batch is next drawn (three uploads and
        // clears it then)
        markRange(a, this._ranges[i], lo * size, n * size);
      }
      this._dirtyMin = Infinity;
      this._dirtyMax = -1;
    }
    if (this._countDirty) {
      this._countDirty = false;
      this.object.count = this._count;
      this.object.visible = this._count > 0;
    }
  }

  /** Live markers. */
  get count() { return this._count; }

  dispose() {
    clearTimeout(this._bakeTimer);
    this._bakeTimer = 0;
    this._bake = null;
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.heightTexture.dispose();
    this.object.dispose?.();
  }

  /** @internal extend the dirty slot range */
  _dirty(slot) {
    if (slot < this._dirtyMin) this._dirtyMin = slot;
    if (slot > this._dirtyMax) this._dirtyMax = slot;
  }

  /**
   * @internal Set up the bake of `hf.sample` at texel centres into half floats: `hf.res` (4) texels
   * per unit, lowered only when a side would exceed MAX_HEIGHT_TEXELS.
   */
  _startBake(hf) {
    const minX = hf.minX;
    const minZ = hf.minZ;
    const spanX = Math.max(1e-3, hf.maxX - minX);
    const spanZ = Math.max(1e-3, hf.maxZ - minZ);
    let res = Math.max(1, hf.res ?? 4);
    const fit = Math.floor(MAX_HEIGHT_TEXELS / Math.max(spanX, spanZ));
    if (fit >= 1 && fit < res) res = fit;
    const w = Math.max(1, Math.ceil(spanX * res));
    const h = Math.max(1, Math.ceil(spanZ * res));
    return { sample: hf.sample, minX, minZ, res, w, h, data: new Uint16Array(w * h), row: 0, ms: 0, slices: 0, longest: 0 };
  }

  /**
   * @internal Bake rows for up to `budget` ms (at least one row); after the last row the texture is
   * uploaded (once: same size, so no new storage and no program change).
   * @param {number} budget ms (Infinity: finish now)
   */
  _bakeSlice(budget) {
    const b = this._bake;
    if (!b) return;
    const t0 = nowMs();
    const { sample, minX, minZ, res, w, h, data } = b;
    const toHalf = THREE.DataUtils.toHalfFloat;
    let j = b.row;
    while (j < h) {
      const z = minZ + (j + 0.5) / res;
      const row = j * w;
      for (let i = 0; i < w; i++) {
        const y = sample(minX + (i + 0.5) / res, z);
        data[row + i] = toHalf(Number.isFinite(y) ? y : 0);
      }
      j++;
      if (nowMs() - t0 >= budget) break;
    }
    b.row = j;
    const ms = nowMs() - t0;
    b.ms += ms;
    b.slices++;
    if (ms > b.longest) b.longest = ms;
    if (j < h) return;
    this._bake = null;
    clearTimeout(this._bakeTimer);
    this._bakeTimer = 0;
    this.bakeMs = Math.round(b.ms * 10) / 10;
    this.bakeSlices = b.slices;
    this.bakeLongestMs = Math.round(b.longest * 10) / 10;
    this.heightTexture.needsUpdate = true;
  }
}
