import * as THREE from 'three';
import { PixelCanvas, makePixelTexture } from '../pixel/PixelCanvas.js';
import { RNG, hash2 } from '../utils/math.js';
import { globalUniforms } from '../render/GlobalUniforms.js';

/**
 * RockSpikes — 3D stone spikes for combat spells (the greatshield's Earthshatter): one instanced
 * mesh of craggy rock spikes, lit by the scene's sun, ambient and point lights (the lamps and the
 * combat VFX lights), casting real sun shadows. Matte: no glow at all — stone is lit, it does not
 * shine. Combat-only (COMBAT_PURE): created by the greatshield's look
 * (src/game/party/EarthSpellFx.js `EarthStage`), only on a level where a greatshield can fight.
 * Built the way IceCrystals is (docs/design/COMBAT_VFX.md §4.5, §6.2), with its own geometry,
 * vertex code, palette and programs: nothing is shared with the ice.
 *
 * API:
 *  - `object`: add to the scene; one draw call (+ the shadow pass); hidden while no spike lives.
 *  - `spawn({ x, y, z, height, radius, yaw, tiltX, tiltZ, seed, aspect })` → handle (−1: full).
 *    (x, y, z) is the spike's foot on the ground; height and radius in world units; yaw (rad) turns
 *    it; tiltX / tiltZ lean its tip (world units of offset at the tip); seed varies its shape;
 *    aspect (0.5 … 1) flattens its cross-section into a slab (1: round).
 *  - `set(h, { rise, crack, height, radius })`: rise 0 … 1 the eruption (values above 1 overshoot;
 *    0 sinks it into the ground), crack 0 … 1 (dark fractures in their reveal order before it
 *    crumbles), height / radius changed live (the caster's readability rules ease them; the lean
 *    keeps its angle).
 *  - `free(h)`, `update(dt)` once per frame, `count`, `warm()` (one spike far below the world for
 *    the warm-up until `unwarm()`), `dispose()`.
 *
 * The look (all in the shaders, per-instance data in instanced attributes, no per-spike material):
 *  - shape: a five-sided craggy spike — four stacked rings tapering to a blunt off-centre tip, every
 *    ring's corners jittered and twisted by seed (facet widths, radii, heights), so the faces break
 *    into flat planes of stone and no two spikes are alike; `aspect` squeezes it into a slab.
 *    Flat-shaded: every triangle one tone band. No side shards (a cluster read as crystal).
 *  - a skirt at the foot (cut-out: torn-earth rubble texels, then a dithered contact shadow), so it
 *    sits on the ground; it casts no shadow. It lies 0.05 above the foot (the caster sinks the foot
 *    0.02, never more).
 *  - pixel look: a procedural 32 × 64 data texture (NEAREST, repeating) at 16 texels per world unit
 *    — calm tone blocks, wavy strata every 5–7 texels, dark pits, pale flecks, the crack lines'
 *    reveal order; every term snapped to that grid; the light quantised as the ice's (half-stop
 *    bands with a soft knee, a 4-step shade ramp from violet-brown shadow to warm lit stone); the
 *    faces turned from the sun get a warm bounce of it off the ground (`uSunColor` × 0.33 × the sun's
 *    height, by how far they are from the sun's shade step: ≈ 0.3 at noon) — without it a shaded
 *    face was a black wedge; a fixed bounce paled them to the sunlit ground's value under the low
 *    golden-hour sun (its colour is 1.7 × noon's), so it follows the sun's height.
 *  - stone: albedo from deep umber to pale ochre, torn-earth dust over its lowest 0.25 u and a
 *    darker contact at the very foot; a 1-texel lit seam (× 1.3 albedo, not HDR) on each facet's lit
 *    edge and a dark line on the shadowed side's edges; `crack` darkens the fracture texels (× 0.35)
 *    with a 1-texel pale dust edge beside them. No emissive term: a strong spell light lights it as
 *    it lights the ground, through the knee.
 *  - rise: the spike grows out of the ground (height × rise; thinner while it shoots up and when it
 *    overshoots — squash and stretch); the skirt spreads with it.
 *  - shadows: a customDepthMaterial runs the same vertex code (instancing, rise, the slab).
 *  - fog as every lit material (MeshLambertMaterial's chunks).
 * Programs: `luminati-rockspikes-v1` and `luminati-rockspikes-depth-v1` (compiled by the warm-up).
 */

/** Floats per spike of the instanced attributes. */
const SHAPE = 4; // height, radius, seed, rise
const FX = 4; // crack, aspect, -, -

/** The texture tile (texels): u around the spike, v along its height (row 0 at the foot). */
const TEX_W = 32, TEX_H = 64;

/**
 * Geometry parts (`aRock.x`): 0 the spike, 1 the skirt. Sides and rings (y, radius in part units)
 * — the same table as the shader's `rockRing`; the spike's tip is ring 4.
 */
const BODY = { part: 0, sides: 5, rings: [[-0.06, 1.0], [0.3, 0.88], [0.6, 0.62], [0.84, 0.36]] };
const SKIRT = { part: 1, sides: 12, rings: [[0, 0.8], [0, 2.2]] };

const GLSL_COMMON = /* glsl */ `
attribute vec4 aRock;   // part, ring (4 = the tip), facet k, side (0: corner k, 1: corner k + 1)
attribute vec4 iShape;  // height, radius, seed, rise
attribute vec4 iFx;     // crack, aspect, -, -

float rockHash( vec3 p ) {
	p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
	p += dot( p, p.yxz + 33.33 );
	return fract( ( p.x + p.y ) * p.z );
}

// a ring of a part: ( y, radius ) in part units
vec2 rockRing( float part, float ring ) {
	if ( part < 0.5 ) return ring < 0.5 ? vec2( -0.06, 1.0 ) : ring < 1.5 ? vec2( 0.3, 0.88 ) : ring < 2.5 ? vec2( 0.6, 0.62 ) : vec2( 0.84, 0.36 );
	return ring < 0.5 ? vec2( 0.0, 0.8 ) : vec2( 0.0, 2.2 );
}

// a corner in part units: the spike's jittered by the seed (facet widths, a twist per ring, radii,
// ring heights) so its faces break into planes; the skirt is regular
vec3 rockCorner( float part, float ring, float k, float seed ) {
	float n = part < 0.5 ? 5.0 : 12.0;
	float kk = mod( k, n );
	float sk = part < 0.5 ? 1.0 : 0.0;
	float jit = ( rockHash( vec3( seed, 1.0, kk ) ) - 0.5 ) * 0.62 * sk;
	float twist = ( rockHash( vec3( seed, 5.0 + ring, kk ) ) - 0.5 ) * 0.34 * sk;
	float a = ( k + jit + twist ) * 6.2831853 / n + rockHash( vec3( seed, 3.0, 91.0 ) ) * 6.2831853 * sk;
	vec2 yr = rockRing( part, ring );
	float rj = 1.0 + ( rockHash( vec3( seed, 7.0 + ring, kk + 17.0 ) ) - 0.5 ) * 0.42 * sk;
	float yj = ring > 0.5 ? ( rockHash( vec3( seed, ring + 40.0, kk ) ) - 0.5 ) * 0.1 * sk : 0.0;
	return vec3( cos( a ) * yr.y * rj, yr.x + yj, sin( a ) * yr.y * rj );
}

// the blunt tip, off the axis by seed
vec3 rockTip( float seed ) {
	vec2 o = vec2( rockHash( vec3( seed, 9.0, 31.0 ) ), rockHash( vec3( seed, 9.0, 37.0 ) ) ) - 0.5;
	return vec3( o.x * 0.36, 1.0, o.y * 0.36 );
}

// thinner while it shoots up and when it overshoots (squash and stretch; stone gives less than ice)
float rockWidth( float rise ) {
	return mix( 0.6, 1.0, smoothstep( 0.0, 0.85, rise ) ) * inversesqrt( max( rise, 1.0 ) );
}

// part units → spike-local world units (relative to the foot, before the instance matrix)
vec3 rockPlace( float part, vec3 q, float h, float r, float rise, float aspect ) {
	if ( part > 0.5 ) {
		float s = r * smoothstep( 0.0, 0.6, rise );
		return vec3( q.x * s, 0.05, q.z * s );
	}
	float w = r * rockWidth( rise );
	return vec3( q.x * w, q.y * h * rise, q.z * w * aspect );
}
`;

/** The vertex: a corner or the tip, placed; the colour pass also writes its varyings. */
const GLSL_VERTEX = /* glsl */ `
#ifdef ROCK_COLOR
varying vec2 vRockTc;    // texel coordinates (16 per world unit)
varying vec2 vRockEdge;  // distance to the facet's left / right seam (world)
varying vec2 vRockY;     // height above the foot in texels (pre-rise), the spike's height in texels
varying vec2 vRockFx;    // crack, seed
varying float vRockPart;
varying vec3 vRockW;     // world position
varying vec3 vRockA;     // the foot (world)
varying float vRockR;    // the spike's radius (world)
#endif

vec3 rockVertex() {
	float part = aRock.x, ring = aRock.y, k = aRock.z, side = aRock.w;
	float h = iShape.x, r = iShape.y, seed = iShape.z, rise = iShape.w;
	float aspect = iFx.y;
	bool tip = part < 0.5 && ring > 3.5;
	vec3 qL = rockCorner( part, ring, k, seed );
	vec3 qR = rockCorner( part, ring, k + 1.0, seed );
	vec3 q = tip ? rockTip( seed ) : ( side > 0.5 ? qR : qL );
	vec3 p = rockPlace( part, q, h, r, rise, aspect );
#ifdef ROCK_DEPTH
	if ( part > 0.5 ) p = vec3( 0.0 );  // the skirt casts no shadow
#endif
#ifdef ROCK_COLOR
	vec3 pL = rockPlace( part, qL, h, r, rise, aspect );
	vec3 pR = rockPlace( part, qR, h, r, rise, aspect );
	float w = tip ? 0.0 : length( pR - pL );
	float d = tip ? 0.0 : side * w;
	vRockEdge = vec2( d, w - d );
	float yq = clamp( q.y, 0.0, 1.0 );
	vRockY = vec2( yq * h * 16.0, h * 16.0 );
	// u: the seam distance plus a facet offset (neighbouring facets show other texels)
	float u0 = k * 9.0 + floor( rockHash( vec3( seed, 0.0, 41.0 ) ) * 32.0 );
	vRockTc = vec2( u0 + ( tip ? 0.0 : d * 16.0 ), q.y * h * 16.0 );
	vRockFx = vec2( iFx.x, seed );
	vRockPart = part;
	mat4 rockM = modelMatrix * instanceMatrix;
	vRockW = ( rockM * vec4( p, 1.0 ) ).xyz;
	vRockA = ( rockM * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
	vRockR = r;
#endif
	return p;
}
`;

const GLSL_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uRockMap;
uniform vec2 uRockMapSize;
uniform vec3 uRockSun;
uniform vec3 uRockSunDir;
varying vec2 vRockTc;
varying vec2 vRockEdge;
varying vec2 vRockY;
varying vec2 vRockFx;
varying float vRockPart;
varying vec3 vRockW;
varying vec3 vRockA;
varying float vRockR;

float rockBayer( vec2 p ) {
	ivec2 q = ivec2( mod( floor( p ), 4.0 ) );
	const float M[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
	return ( M[ q.y * 4 + q.x ] + 0.5 ) / 16.0;
}
float rockHash2( vec2 p ) {
	vec3 q = fract( vec3( p.xyx ) * 0.1031 );
	q += dot( q, q.yzx + 33.33 );
	return fract( ( q.x + q.y ) * q.z );
}

// the stone ramp (linear): albedo and the light's hue shift; nothing emissive
const vec3 ROCK_DEEP = vec3( 0.12, 0.075, 0.05 );
const vec3 ROCK_PALE = vec3( 0.55, 0.38, 0.23 );
const vec3 ROCK_FLECK = vec3( 0.66, 0.52, 0.34 );
const vec3 ROCK_DUST = vec3( 0.52, 0.40, 0.27 );
const vec3 ROCK_EDGE = vec3( 0.58, 0.46, 0.32 );
const vec3 ROCK_SHADE = vec3( 0.62, 0.54, 0.72 );  // shadowed faces lean violet-brown
const vec3 ROCK_LIT = vec3( 1.08, 0.98, 0.82 );    // lit faces lean warm
const vec3 ROCK_SHADOW = vec3( 0.05, 0.045, 0.04 );
const vec3 ROCK_BOUNCE = vec3( 1.0, 0.82, 0.62 );  // the sun thrown back off the ground: warm
`;

/** Replaces Lambert's `outgoingLight` line: the quantised light, the stone, the skirt. */
const GLSL_FRAGMENT_SHADE = /* glsl */ `
	vec3 rkEd = reflectedLight.directDiffuse;
	vec3 rkEt = rkEd + reflectedLight.indirectDiffuse;
	// the light's strength by its brightest channel
	float rkIt = max( max( rkEt.r, max( rkEt.g, rkEt.b ) ), 1e-5 );
	// the shade ramp: 4 steps from shadowed (ambient only) to fully sunlit
	float rkSh = floor( clamp( max( rkEd.r, max( rkEd.g, rkEd.b ) ) / rkIt, 0.0, 1.0 ) * 4.0 + 0.5 ) / 4.0;
	// the light in half-stop bands, its hue kept in part, with the ice's soft knee: a strong light
	// (the slam's flash, the noon sun) pales the stone, never burns it white
	float rkIq = exp2( floor( log2( rkIt ) * 2.0 + 0.5 ) * 0.5 );
	if ( rkIq > 0.7 ) rkIq = 0.7 + ( rkIq - 0.7 ) / ( 1.0 + ( rkIq - 0.7 ) * 1.3 );
	vec3 rkHue = mix( vec3( 1.0 ), rkEt / rkIt, 0.6 );
	vec3 rkL = rkIq * rkHue * mix( ROCK_SHADE, ROCK_LIT, rkSh );
	// the faces turned from the sun catch its bounce off the ground (stone in shade is never black),
	// as strong as the ground is lit — the sun's colour × its height: a low sun (golden hour) throws
	// little back, so the shaded side stays dark and the silhouette reads against the sunlit ground
	rkL += uRockSun * ( 0.33 * max( uRockSunDir.y, 0.0 ) ) * ROCK_BOUNCE * ( 1.0 - rkSh );
	vec3 outgoingLight;
	if ( vRockPart > 0.5 ) {
		// the skirt: torn-earth rubble texels, then a dithered contact shadow (world texel grid)
		vec2 g = floor( vRockW.xz * 16.0 ) + 0.5;
		float dr = length( g / 16.0 - vRockA.xz ) / max( vRockR, 1e-3 );
		float hr = rockHash2( g + vRockFx.y * 7.13 );
		float rubble = ( 1.0 - smoothstep( 0.8, 1.4, dr ) ) * 0.75;
		float shade = 1.0 - smoothstep( 1.05, 1.8, dr );
		if ( hr < rubble ) {
			vec3 alb = mix( ROCK_DEEP * 1.8, ROCK_DUST, step( 0.45, rockHash2( g * 1.7 ) ) );
			outgoingLight = alb * rkL;
		} else if ( rockBayer( g ) < shade * 0.85 ) {
			outgoingLight = ROCK_SHADOW * rkL;
		} else discard;
	} else {
		vec2 tc = floor( vRockTc ) + 0.5;
		vec4 tx = texture2D( uRockMap, tc / uRockMapSize );
		float crack = vRockFx.x;
		float yW = ( floor( vRockY.x ) + 0.5 ) / 16.0;   // world units above the foot (pre-rise)
		// albedo: tone blocks, strata, pits, flecks; each spike a little lighter or darker
		vec3 alb = mix( ROCK_DEEP, ROCK_PALE, tx.r ) * ( 0.94 + 0.12 * rockHash2( vec2( vRockFx.y, 5.0 ) ) );
		float feat = tx.g;
		if ( feat > 0.2 && feat < 0.45 ) alb *= 0.72;
		else if ( feat > 0.55 && feat < 0.8 ) alb *= 0.5;
		else if ( feat > 0.9 ) alb = ROCK_FLECK;
		// torn earth over the lowest 0.25 u, the very foot darker (the contact)
		float dust = 1.0 - smoothstep( 0.05, 0.25, yW );
		if ( rockHash2( tc + 3.1 ) < dust * 0.95 ) alb = ROCK_DUST * mix( 0.78, 1.0, rockHash2( tc * 1.3 + 0.7 ) );
		alb *= mix( 0.55, 1.0, smoothstep( 0.0, 0.18, yW ) );
		vec3 col = alb * rkL;
		// the facets' edges as a pixel artist draws them: a lit seam on the lit side, a dark line
		// where the face turns away (only on facets at least 3 texels wide)
		float eL = floor( vRockEdge.x * 16.0 ), eR = floor( vRockEdge.y * 16.0 );
		bool wide = ( vRockEdge.x + vRockEdge.y ) * 16.0 >= 3.0;
		if ( eL < 0.5 && wide ) col *= mix( 1.0, 1.3, rkSh );
		else if ( eR < 0.5 && wide && rkSh < 0.5 ) col *= 0.6;
		// cracks: dark lines in their reveal order, a 1-texel pale dust edge beside them
		if ( tx.b < crack ) col *= 0.35;
		else if ( crack > 0.0 ) {
			float nb = min( min( texture2D( uRockMap, ( tc + vec2( 1.0, 0.0 ) ) / uRockMapSize ).b, texture2D( uRockMap, ( tc - vec2( 1.0, 0.0 ) ) / uRockMapSize ).b ),
				texture2D( uRockMap, ( tc + vec2( 0.0, 1.0 ) ) / uRockMapSize ).b );
			if ( nb < crack ) col = ROCK_EDGE * rkL;
		}
		outgoingLight = col;
	}
`;

/**
 * The texture tile (data, not colour): r tone blocks, g features (0 none, 0.33 a stratum, 0.67 a
 * pit, 1 a fleck), b the crack lines' reveal order (0.03 … 0.9; 1 = no crack). Row 0 is the foot.
 * Deterministic (seeded RNG).
 * @returns {PixelCanvas}
 */
function rockTexture() {
  const pc = new PixelCanvas(TEX_W, TEX_H);
  const rng = new RNG(0x5703e);
  const n = TEX_W * TEX_H;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n).fill(1);
  const at = (x, y) => (((y % TEX_H) + TEX_H) % TEX_H) * TEX_W + (((x % TEX_W) + TEX_W) % TEX_W);
  // tone: broad calm blocks (a face reads as one colour), a little grain
  for (let x = 0; x < TEX_W; x++) {
    for (let y = 0; y < TEX_H; y++) R[at(x, y)] = 0.38 + 0.3 * hash2(x >> 3, y >> 3, 21) + 0.08 * hash2(x >> 1, y, 22);
  }
  // strata: wavy darker rows every 5–7 texels, broken here and there
  let y0 = rng.int(1, 4);
  while (y0 < TEX_H) {
    const ph = rng.range(0, Math.PI * 2);
    const amp = rng.range(0.6, 1.4);
    for (let x = 0; x < TEX_W; x++) {
      if (hash2(x >> 2, y0, 23) < 0.18) continue;
      G[at(x, y0 + Math.round(Math.sin(x * 0.39 + ph) * amp))] = 1 / 3;
    }
    y0 += rng.int(5, 7);
  }
  // pits (1–2 texels) and pale flecks
  for (let i = 0; i < 16; i++) {
    const x = rng.int(0, TEX_W - 1), y = rng.int(0, TEX_H - 1);
    G[at(x, y)] = 2 / 3;
    if (rng.chance(0.5)) G[at(x + 1, y)] = 2 / 3;
  }
  for (let i = 0; i < 26; i++) G[at(rng.int(0, TEX_W - 1), rng.int(0, TEX_H - 1))] = 1;
  // cracks: zig-zag walks up from the foot that branch, revealed in walk order (b = order)
  /** @param {number} x @param {number} y @param {number} dir @param {number} t0 @param {number} t1 @param {number} len @param {number} depth */
  const walk = (x, y, dir, t0, t1, len, depth) => {
    for (let k = 0; k < len; k++) {
      const i = at(x, y);
      B[i] = Math.min(B[i], Math.max(0.03, t0 + (k / len) * (t1 - t0)));
      y += 1;
      if (rng.chance(0.35)) x += dir;
      if (rng.chance(0.12)) dir = -dir;
      if (depth < 1 && rng.chance(0.06)) walk(x - dir, y, -dir, t0 + (k / len) * (t1 - t0), t1, Math.floor((len - k) * 0.5), depth + 1);
    }
  };
  for (let i = 0; i < 4; i++) walk(Math.floor((i * TEX_W) / 4 + rng.int(0, 3)), rng.int(0, 6), rng.chance(0.5) ? 1 : -1, rng.range(0.03, 0.2), rng.range(0.6, 0.95), rng.int(24, 44), 0);
  for (let y = 0; y < TEX_H; y++) {
    for (let x = 0; x < TEX_W; x++) {
      const i = at(x, y);
      pc.set(x, y, [Math.round(Math.min(1, Math.max(0, R[i])) * 255), Math.round(G[i] * 255), Math.round(B[i] * 255), 255]);
    }
  }
  return pc;
}

/**
 * The shared geometry: every facet as separate triangles (flat shading); positions are computed in
 * the shader from `aRock`, the `position` attribute holds a nominal spike (bounds).
 * @returns {THREE.BufferGeometry}
 */
function spikeGeometry() {
  /** @type {number[]} */ const pos = [];
  /** @type {number[]} */ const rock = [];
  /** @param {{part:number, sides:number, rings:number[][]}} P @param {number} ring @param {number} k @param {number} side @param {boolean} tip */
  const nominal = (P, ring, k, side, tip) => {
    if (tip) return [0, 1, 0];
    const [y, r] = P.rings[ring];
    const a = ((k + side) * Math.PI * 2) / P.sides;
    return [Math.cos(a) * r, P.part === 1 ? 0 : y, Math.sin(a) * r];
  };
  /** One triangle, wound counter-clockwise seen from `out`. @param {any[]} vs [P, ring, k, side, tip] × 3 @param {number[]} out */
  const tri = (vs, out) => {
    const p = vs.map((v) => nominal(v[0], v[1], v[2], v[3], v[4]));
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const nrm = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const order = nrm[0] * out[0] + nrm[1] * out[1] + nrm[2] * out[2] < 0 ? [0, 2, 1] : [0, 1, 2];
    for (const i of order) {
      pos.push(...p[i]);
      const v = vs[i];
      rock.push(v[0].part, v[4] ? v[0].rings.length : v[1], v[2], v[3]);
    }
  };
  const P = BODY;
  for (let k = 0; k < P.sides; k++) {
    const am = ((k + 0.5) * Math.PI * 2) / P.sides;
    const out = [Math.cos(am), 0.3, Math.sin(am)];
    for (let ring = 0; ring < P.rings.length - 1; ring++) {
      tri([[P, ring, k, 0, false], [P, ring, k, 1, false], [P, ring + 1, k, 0, false]], out);
      tri([[P, ring, k, 1, false], [P, ring + 1, k, 1, false], [P, ring + 1, k, 0, false]], out);
    }
    const top = P.rings.length - 1;
    tri([[P, top, k, 0, false], [P, top, k, 1, false], [P, top, k, 0, true]], [out[0], 0.7, out[2]]);
  }
  for (let k = 0; k < SKIRT.sides; k++) {
    tri([[SKIRT, 0, k, 0, false], [SKIRT, 0, k, 1, false], [SKIRT, 1, k, 0, false]], [0, 1, 0]);
    tri([[SKIRT, 0, k, 1, false], [SKIRT, 1, k, 1, false], [SKIRT, 1, k, 0, false]], [0, 1, 0]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aRock', new THREE.Float32BufferAttribute(rock, 4));
  geo.computeVertexNormals();
  return geo;
}

/**
 * @typedef {object} SpikeItem
 * @property {number} x @property {number} y @property {number} z
 * @property {number} height @property {number} radius @property {number} yaw
 * @property {number} leanX @property {number} leanZ the tip's lean per unit of height (a spike made
 *   lower keeps its angle) @property {number} seed @property {number} aspect
 * @property {number} rise @property {number} crack
 */

export class RockSpikes {
  /** @param {{ capacity?: number }} [opts] */
  constructor({ capacity = 24 } = {}) {
    this.capacity = capacity;
    const geo = spikeGeometry();
    this._shape = new THREE.InstancedBufferAttribute(new Float32Array(capacity * SHAPE), SHAPE);
    this._fx = new THREE.InstancedBufferAttribute(new Float32Array(capacity * FX), FX);
    this._shape.setUsage(THREE.DynamicDrawUsage);
    this._fx.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iShape', this._shape);
    geo.setAttribute('iFx', this._fx);

    this.texture = makePixelTexture(rockTexture().toCanvas(), { wrap: 'repeat', srgb: false, name: 'fx:rockSpikes' });
    // (row 0 of the tile is the foot: v runs up the spike)
    this.texture.flipY = false;
    /** Shader uniforms. @type {Record<string, THREE.IUniform>} */
    this.uniforms = {
      uRockMap: { value: this.texture },
      uRockMapSize: { value: new THREE.Vector2(TEX_W, TEX_H) },
      uRockSun: globalUniforms.uSunColor,
      uRockSunDir: globalUniforms.uSunDirection,
    };
    const u = this.uniforms;
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n#define ROCK_COLOR\n${GLSL_COMMON}\n${GLSL_VERTEX}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = rockVertex();');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL_FRAGMENT_PARS}`)
        .replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', GLSL_FRAGMENT_SHADE);
    };
    this.material.customProgramCacheKey = () => 'luminati-rockspikes-v1';

    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depthMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n#define ROCK_DEPTH\n${GLSL_COMMON}\n${GLSL_VERTEX}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = rockVertex();');
    };
    this.depthMaterial.customProgramCacheKey = () => 'luminati-rockspikes-depth-v1';

    this.object = new THREE.InstancedMesh(geo, this.material, capacity);
    this.object.name = 'fx:rockSpikes';
    this.object.count = 0;
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.castShadow = true;
    this.object.receiveShadow = true;
    this.object.customDepthMaterial = this.depthMaterial;
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    /** @type {Array<SpikeItem | null>} */
    this._items = new Array(capacity).fill(null);
    this._live = 0;
    this._m = new THREE.Matrix4();
    this._warm = -1;
  }

  /**
   * @param {{ x: number, y: number, z: number, height?: number, radius?: number, yaw?: number, tiltX?: number, tiltZ?: number, seed?: number, aspect?: number }} o
   * @returns {number} a handle, or −1 when full
   */
  spawn(o) {
    const h = this._items.indexOf(null);
    if (h < 0) return -1;
    const height = Math.max(0.05, o.height ?? 1.2);
    this._items[h] = {
      x: o.x, y: o.y, z: o.z, height, radius: Math.max(0.02, o.radius ?? 0.35),
      yaw: o.yaw ?? 0, leanX: (o.tiltX ?? 0) / height, leanZ: (o.tiltZ ?? 0) / height, seed: ((o.seed ?? h) >>> 0) % 8192,
      aspect: Math.min(1, Math.max(0.3, o.aspect ?? 1)), rise: 0, crack: 0,
    };
    this._live++;
    return h;
  }

  /**
   * @param {number} h
   * @param {{ rise?: number, crack?: number, height?: number, radius?: number }} p
   */
  set(h, p) {
    const it = this._items[h];
    if (!it) return;
    if (p.rise !== undefined) it.rise = p.rise;
    if (p.crack !== undefined) it.crack = p.crack;
    if (p.height !== undefined) it.height = Math.max(0.05, p.height);
    if (p.radius !== undefined) it.radius = Math.max(0.02, p.radius);
  }

  /** @param {number} h */
  free(h) {
    if (h >= 0 && h < this.capacity && this._items[h]) {
      this._items[h] = null;
      this._live--;
    }
  }

  /** Live spikes. */
  get count() { return this._live; }

  /** One spike far below the world (the warm-up draws and compiles it and its shadow). */
  warm() {
    if (this._warm < 0) {
      this._warm = this.spawn({ x: 0, y: -500, z: 0, seed: 1 });
      this.set(this._warm, { rise: 1 });
      this.update(0);
    }
  }

  /** End the warm-up spike. */
  unwarm() {
    if (this._warm >= 0) {
      this.free(this._warm);
      this._warm = -1;
      this.update(0);
    }
  }

  /** Write the live spikes into the instance rows. @param {number} dt */
  update(dt) {
    void dt;
    const S = this._shape.array, F = this._fx.array, m = this._m.elements;
    let n = 0;
    for (const it of this._items) {
      if (!it || it.rise <= 0.001) continue;
      // foot × tilt shear (the tip leans tiltX / tiltZ at its spawned height) × yaw
      const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
      m[0] = c; m[1] = 0; m[2] = -s; m[3] = 0;
      m[4] = it.leanX; m[5] = 1; m[6] = it.leanZ; m[7] = 0;
      m[8] = s; m[9] = 0; m[10] = c; m[11] = 0;
      m[12] = it.x; m[13] = it.y; m[14] = it.z; m[15] = 1;
      this.object.setMatrixAt(n, this._m);
      S[n * SHAPE] = it.height; S[n * SHAPE + 1] = it.radius; S[n * SHAPE + 2] = it.seed; S[n * SHAPE + 3] = it.rise;
      F[n * FX] = it.crack; F[n * FX + 1] = it.aspect; F[n * FX + 2] = 0; F[n * FX + 3] = 0;
      n++;
    }
    this.object.count = n;
    this.object.visible = n > 0;
    if (n > 0) {
      this.object.instanceMatrix.needsUpdate = true;
      this._shape.needsUpdate = true;
      this._fx.needsUpdate = true;
    }
  }

  dispose() {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.texture.dispose();
    this.object.dispose?.();
  }
}
