import * as THREE from 'three';
import { globalUniforms } from '../render/GlobalUniforms.js';

/**
 * SpectralBells — 3D bells for combat effects (the bellwarden's Toll bell and Carillon's four
 * bells; docs/contracts/EVERMERE_CAMPAIGN.md §6.5): one instanced mesh of faceted cast bells, lit
 * by the scene's sun, ambient and point lights (the lamps and the combat VFX lights), casting real
 * sun shadows. Combat-only (COMBAT_PURE): created by the bellwarden's look
 * (src/game/combat/BellwardenFx.js `BellStage`), only where the player's kit is the bellwarden's.
 *
 * API (SpectralBlades' shape):
 *  - `object`: add to the scene; one draw call (+ the shadow pass); hidden while no bell lives.
 *  - `spawn({ x, y, z, height, palette, seed })` → handle (−1: full). (x, y, z) is the bell's pivot —
 *    the top of its crown loop, where it hangs from; `height` the whole bell (lip → loop) in world
 *    units (its mouth is ≈ 1.0 × that across); `palette` 0 spectral bronze (gold lines), 1 black
 *    iron (cyan lines: a black bell, if another package wants one); `seed` varies its inscription.
 *  - `set(h, { x, y, z, swing, swingX, swingZ, spin, dissolve, dissolveDir, ghost, glow, strike })`:
 *    the pivot; `swing` the angle (rad) it swings out of plumb about the horizontal axis
 *    perpendicular to (swingX, swingZ) (the mouth moves toward +(swingX, swingZ) for a positive
 *    angle); `spin` its turn about its own axis (rad: the inscription's place); `dissolve` 0 … 1 a
 *    cut-out texel threshold (1: gone) that sweeps from the crown down (`dissolveDir` +1: the lip goes
 *    last; read backwards it materialises lip first), from the lip up (−1) or everywhere at once
 *    (0); `ghost` 0 … 0.99 a share of its texels cut out everywhere besides (a see-through bell,
 *    still cut-out); `glow` the spectral light (the inscription band, the cast lines, the crown; 1 =
 *    normal); `strike` 0 … 1 the ring of a blow — the sound bow and the lip flare, the body washed a
 *    little (decay it yourself, on the frame's own time).
 *  - `free(h)`, `update(dt)` once per frame, `count`, `warm()` (one bell of each palette far below the
 *    world, for the warm-up, until `unwarm()`), `dispose()`.
 *
 * The look (all in the shaders; per-instance data in instanced attributes, no per-bell material):
 *  - shape (≈ 300 triangles, the pivot at the origin, the bell hanging down −Y): a 12-sided lathe of a
 *    cast bell's profile — the flared lip and its thick sound bow, the waist, the rounded shoulder,
 *    the flat crown — inside it the dark bore (its own facets, turned inward), a crown loop (two posts
 *    and a bar) on top, a clapper ball hanging in the mouth. Flat-shaded: every facet is one tone band.
 *  - pixel look: every term snapped to 16 texels per world unit in bell space (u round the body, v
 *    down the profile); the light quantised as SpectralBlades' (half-stop bands, the soft knee, a
 *    4-step ramp chosen by the facet's turn to a painter's light from the upper left, a step down in
 *    a cast shadow); a 1-texel dark line on each facet's trailing edge (the facets read); the two cast
 *    lines (above the sound bow, at the shoulder) and the lip edge lit in the palette's line colour.
 *  - spectral: the inscription band round the waist (hashed 2 × 4 glyphs) and the lines glow
 *    (`glow`); a blow (`strike`) lights the sound bow and flares the lip; the dissolve's front burns
 *    as a 1-texel bright line; at night (`uNight`: the exposure rises) the self-glow holds back to 0.7.
 *    The palettes stay off white: the bronze's lit top is a deep gold, its lines a saturated gold
 *    (≤ 1.3 HDR — no bloom-white on snow, COMBAT_VFX.md §4); the bore stays near black.
 *  - shadows: a customDepthMaterial runs the same vertex code and the same dissolve cut.
 *  - fog as every lit material (MeshLambertMaterial's chunks).
 * Programs: `luminati-spectralbells-v1` and `luminati-spectralbells-depth-v1` (compiled by the
 * warm-up).
 */

/** Floats per bell of the instanced attributes. */
const SHAPE = 4; // height, seed, palette, (spare)
const FX = 4; // dissolve, dissolve direction × 4 + ghost, glow, strike

/**
 * The profile (fractions of the height; y 0 at the pivot, −1 at the lip; r the outer radius): the lip,
 * the sound bow, the waist, the shoulder, the crown. `kind` of the band above each point.
 */
const PROFILE = [
  [0.5, -1.0], [0.488, -0.955], [0.45, -0.905], [0.39, -0.83], [0.335, -0.72], [0.3, -0.57],
  [0.29, -0.43], [0.285, -0.32], [0.268, -0.245], [0.232, -0.19], [0.17, -0.152], [0.09, -0.132], [0.0, -0.126],
];
/** The bore's wall thickness at the lip (fraction of the height) and how far up it reaches. */
const WALL = 0.045;
const BORE_TOP = -0.3;
/** Sides round the lathe. */
const SIDES = 12;

/**
 * Facet kinds (`aBell.w`): 0 the body, 1 the sound bow and lip band, 2 the bore (inside), 3 the
 * crown loop, 4 the clapper, 5 the lip's rim (the ring between the outer lip and the bore).
 */
const K = Object.freeze({ BODY: 0, BOW: 1, BORE: 2, LOOP: 3, CLAPPER: 4, RIM: 5 });

const GLSL_COMMON = /* glsl */ `
attribute vec4 aBell;   // u round (0..1), v down from the crown (world fraction 0..1), facet width (normalised), kind
attribute vec4 iShape;  // height, seed, palette, spare
attribute vec4 iFx;     // dissolve, dissolve direction × 4 + ghost, glow, strike
varying vec2 vBellTc;   // texel coordinates (16 per world unit): u round the body, v down from the crown
varying vec4 vBellFx;
varying vec3 vBellK;    // seed, palette, height in texels
varying float vBellV;   // 0 crown … 1 lip
`;

const GLSL_VERTEX = /* glsl */ `
#ifdef BELL_COLOR
varying float vBellKind;
varying float vBellU;     // 0..1 round
varying float vBellFacet; // the facet's position across (0 leading edge … 1 trailing edge)
#endif

vec3 bellVertex() {
	float H = iShape.x;
	vec3 p = position * H;
	// u: the arc length round at this radius (texels); v: the height down from the crown (texels)
	float rr = length( position.xz );
	vBellTc = vec2( aBell.x * 6.2832 * max( rr, 0.12 ) * H * 16.0, aBell.y * H * 16.0 );
	vBellFx = iFx;
	vBellK = vec3( iShape.y, iShape.z, H * 16.0 );
	vBellV = aBell.y;
#ifdef BELL_COLOR
	vBellKind = aBell.w;
	vBellU = aBell.x;
	vBellFacet = aBell.z;
#endif
	return p;
}
`;

/** The dissolve cut, shared by the colour and the depth pass. */
const GLSL_CUT = /* glsl */ `
float bellHash( vec2 p ) {
	vec3 q = fract( vec3( p.xyx ) * 0.1031 );
	q += dot( q, q.yzx + 33.33 );
	return fract( ( q.x + q.y ) * q.z );
}
float bellDir() { return floor( vBellFx.y * 0.25 + 0.5 ); }
// the dissolve key of this texel: below the dissolve, it is cut (+1: the crown goes first)
float bellKey() {
	vec2 tc = floor( vBellTc ) + 0.5;
	float h = bellHash( tc + vBellK.x * 1.37 );
	float dir = bellDir();
	float f = clamp( vBellV, 0.0, 1.0 );
	return dir > 0.5 ? f * 0.82 + h * 0.18 : dir < -0.5 ? ( 1.0 - f ) * 0.82 + h * 0.18 : h;
}
bool bellGhosted() {
	float g = vBellFx.y - bellDir() * 4.0;
	return g > 0.001 && bellHash( floor( vBellTc ) + vec2( 11.3, 4.9 ) + vBellK.x * 0.53 ) < g;
}
`;

const GLSL_FRAGMENT_PARS = /* glsl */ `
uniform float uBellNight;
uniform vec4 uBellLook;   // light floor, lines, glyphs, the dissolve front
varying vec2 vBellTc;
varying vec4 vBellFx;
varying vec3 vBellK;
varying float vBellV;
varying float vBellKind;
varying float vBellU;
varying float vBellFacet;
${GLSL_CUT}
// the palettes (linear albedo for the light's knee), 4 steps: the spectral bronze — a dark umber
// bronze to a warm gold top, never white —, the black iron (blue-black)
vec3 bellRamp( float pal, int i ) {
	if ( pal < 0.5 ) {
		return i == 0 ? vec3( 0.04, 0.018, 0.005 ) : i == 1 ? vec3( 0.11, 0.052, 0.012 ) : i == 2 ? vec3( 0.24, 0.125, 0.026 ) : vec3( 0.42, 0.245, 0.05 );
	}
	return i == 0 ? vec3( 0.012, 0.012, 0.02 ) : i == 1 ? vec3( 0.03, 0.032, 0.05 ) : i == 2 ? vec3( 0.07, 0.075, 0.105 ) : vec3( 0.13, 0.14, 0.18 );
}
// the lines and glyphs (HDR, pale: they bloom a little, never white)
vec3 bellLine( float pal ) { return pal < 0.5 ? vec3( 1.30, 0.76, 0.18 ) : vec3( 0.30, 0.78, 0.92 ); }
vec3 bellStrike( float pal ) { return pal < 0.5 ? vec3( 1.30, 0.74, 0.18 ) : vec3( 0.35, 0.90, 1.05 ); }
// the sun mirrored in a facet (cast metal)
vec3 bellSpec( float pal ) { return pal < 0.5 ? vec3( 0.9, 0.62, 0.22 ) : vec3( 0.35, 0.45, 0.6 ); }
`;

/** Replaces Lambert's `outgoingLight` line: the quantised light, the palettes, the spectral terms. */
const GLSL_FRAGMENT_SHADE = /* glsl */ `
	float bKey = bellKey();
	float bDis = vBellFx.x;
	if ( bKey < bDis || bellGhosted() ) discard;
	vec3 bEd = reflectedLight.directDiffuse;
	vec3 bEt = bEd + reflectedLight.indirectDiffuse;
	float bIt = max( max( bEt.r, max( bEt.g, bEt.b ) ), 1e-5 );
	float bSh = clamp( max( bEd.r, max( bEd.g, bEd.b ) ) / bIt, 0.0, 1.0 );
	float bIq = exp2( floor( log2( bIt ) * 2.0 + 0.5 ) * 0.5 );
	if ( bIq > 0.7 ) bIq = 0.7 + ( bIq - 0.7 ) / ( 1.0 + ( bIq - 0.7 ) * 1.3 );
	vec3 bHue = mix( vec3( 1.0 ), bEt / bIt, 0.5 );
	float bLight = uBellLook.x + ( 1.0 - uBellLook.x ) * bIq;
	float pal = vBellK.y;
	float kind = vBellKind;
	float glow = vBellFx.z;
	float strike = vBellFx.w;
	vec2 tc = floor( vBellTc ) + 0.5;
	// a painter's light from the upper left of the view: the facets step through the ramp
	float bNl = dot( normal, normalize( vec3( -0.55, 0.5, 0.67 ) ) );
	int bRs = bNl > 0.7 ? 3 : bNl > 0.42 ? 2 : bNl > 0.1 ? 1 : 0;
	if ( bSh < 0.25 ) bRs = max( bRs - 1, 0 );
	vec3 alb = bellRamp( pal, bRs );
	vec3 emis = vec3( 0.0 );
	float vt = vBellV * vBellK.z;          // texels down from the crown
	float lipT = vBellK.z;                  // the lip's row
	if ( kind > 1.5 && kind < 2.5 ) {
		// the bore: near black, its deepest step
		alb = bellRamp( pal, 0 ) * 0.7;
	} else if ( kind > 3.5 && kind < 4.5 ) {
		alb = bellRamp( pal, max( bRs - 1, 0 ) );
	} else {
		// the facets read: a dark texel line on each facet's trailing edge (the bore's rim excepted)
		if ( kind < 1.5 && vBellFacet > 0.9 ) alb *= 0.62;
		// the cast lines: one above the sound bow, one at the shoulder (raised: lit, a dark line under)
		float bowLine = lipT * 0.17;
		float shLine = lipT * 0.42;
		float dl = min( abs( vt - bowLine ), abs( vt - shLine ) );
		if ( kind < 1.5 && dl < 0.75 ) emis += bellLine( pal ) * ( 0.25 + 0.35 * glow ) * uBellLook.y;
		else if ( kind < 1.5 && ( abs( vt - bowLine - 1.0 ) < 0.5 || abs( vt - shLine - 1.0 ) < 0.5 ) ) alb *= 0.55;
		// the inscription band round the waist: 2 × 4 glyph cells, hashed per bell
		float b0 = lipT * 0.47, b1 = b0 + 4.0;
		if ( kind < 0.5 && vt > b0 && vt < b1 ) {
			float cx = mod( floor( vBellTc.x ), 3.0 );
			float cell = floor( vBellTc.x / 3.0 );
			float cy = floor( vt - b0 );
			float on = cx < 1.5 ? step( 0.48, bellHash( vec2( cell * 2.0 + cx, cy ) + vBellK.x * 0.71 ) ) : 0.0;
			emis += bellLine( pal ) * on * ( 0.15 + 0.6 * glow ) * uBellLook.z;
			if ( on > 0.5 ) alb *= 0.5;
		}
		// the lip: its edge lit; the sound bow lit by a blow
		if ( kind > 0.5 && kind < 1.5 ) {
			if ( vt > lipT - 1.0 ) emis += bellLine( pal ) * ( 0.35 + 0.4 * glow ) * uBellLook.y;
			emis += bellStrike( pal ) * strike * 0.9;
		}
		if ( kind > 4.5 ) emis += bellStrike( pal ) * strike * 0.6 + bellLine( pal ) * 0.2 * uBellLook.y;
		// the crown loop: its lit side catches the line colour
		if ( kind > 2.5 && kind < 3.5 ) emis += bellLine( pal ) * 0.18 * glow * step( 0.42, bNl );
		// a blow washes the body a little
		emis += bellStrike( pal ) * strike * 0.12;
	}
	vec3 col = alb * bLight * bHue;
#if NUM_DIR_LIGHTS > 0
	vec3 bH = normalize( directionalLights[ 0 ].direction + geometryViewDir );
	float bNh = dot( normal, bH );
	float bSpec = bNh > 0.99 ? 1.0 : bNh > 0.965 ? 0.35 : 0.0;
	if ( kind < 1.5 ) emis += bellSpec( pal ) * bSpec * step( 0.55, bSh ) * min( bIq, 1.0 ) * uBellLook.y;
#endif
	if ( bDis > 0.001 && bKey < bDis + 0.035 ) emis += bellLine( pal ) * 0.8 * uBellLook.w;
	vec3 outgoingLight = col + emis * mix( 1.0, 0.7, uBellNight );
`;

const GLSL_DEPTH_PARS = /* glsl */ `
varying vec2 vBellTc;
varying vec4 vBellFx;
varying vec3 vBellK;
varying float vBellV;
${GLSL_CUT}
`;

/**
 * The shared geometry: every facet as separate triangles (flat shading); positions in bell units
 * (the height 1, the pivot at the origin, hanging down −Y), scaled per instance in the shader.
 * @returns {THREE.BufferGeometry}
 */
function bellGeometry() {
  /** @type {number[]} */ const pos = [];
  /** @type {number[]} */ const att = [];
  /**
   * One triangle wound counter-clockwise seen from `out`; vertex [x, y, z, u, facetSide].
   * @param {number[][]} vs @param {number[]} out @param {number} kind
   */
  const tri = (vs, out, kind) => {
    const [a, b, c] = vs;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const order = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? [a, c, b] : [a, b, c];
    for (const v of order) {
      pos.push(v[0], v[1], v[2]);
      // v down from the crown (0 … 1 at the lip)
      att.push(v[3], Math.min(1, Math.max(0, -v[1])), v[4], kind);
    }
  };
  /** A quad (a0, b0 at one ring, a1, b1 at the next; a the leading side). */
  const quad = (a0, b0, b1, a1, out, kind) => {
    tri([a0, b0, a1], out, kind);
    tri([b0, b1, a1], out, kind);
  };
  /** A point of the lathe: [x, y, z, u, side]. @param {number} r @param {number} y @param {number} k sector index @param {number} side 0 leading, 1 trailing */
  const lp = (r, y, k, side) => {
    const a = (k / SIDES) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r, k / SIDES, side];
  };
  // ---- the outer body: the profile's bands round the lathe ----
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const [r0, y0] = PROFILE[i];
    const [r1, y1] = PROFILE[i + 1];
    const kind = i < 2 ? K.BOW : K.BODY;
    for (let k = 0; k < SIDES; k++) {
      const am = ((k + 0.5) / SIDES) * Math.PI * 2;
      // (the outward normal of the band's middle: radial, tilted by the profile's slope)
      const dr = r1 - r0;
      const dy = y1 - y0;
      const out = [Math.cos(am) * dy, -dr, Math.sin(am) * dy];
      if (r1 < 1e-4) {
        // the crown's centre: a fan
        tri([lp(r0, y0, k, 0), lp(r0, y0, k + 1, 1), [0, y1, 0, (k + 0.5) / SIDES, 0.5]], [0, 1, 0], kind);
      } else quad(lp(r0, y0, k, 0), lp(r0, y0, k + 1, 1), lp(r1, y1, k + 1, 1), lp(r1, y1, k, 0), out, kind);
    }
  }
  // ---- the lip's rim: the ring between the outer lip and the bore ----
  const rIn = PROFILE[0][0] - WALL;
  for (let k = 0; k < SIDES; k++) {
    quad(lp(PROFILE[0][0], -1, k, 0), lp(PROFILE[0][0], -1, k + 1, 1), lp(rIn, -1, k + 1, 1), lp(rIn, -1, k, 0), [0, -1, 0], K.RIM);
  }
  // ---- the bore: the inside, turned inward (seen up the swinging mouth) ----
  const BORE = [[rIn, -1.0], [PROFILE[2][0] - WALL, PROFILE[2][1]], [PROFILE[4][0] - WALL * 0.8, PROFILE[4][1]], [PROFILE[6][0] - WALL * 0.7, BORE_TOP], [0, BORE_TOP + 0.02]];
  for (let i = 0; i < BORE.length - 1; i++) {
    const [r0, y0] = BORE[i];
    const [r1, y1] = BORE[i + 1];
    for (let k = 0; k < SIDES; k++) {
      const am = ((k + 0.5) / SIDES) * Math.PI * 2;
      const out = [-Math.cos(am), -0.2, -Math.sin(am)];
      if (r1 < 1e-4) tri([lp(r0, y0, k, 0), lp(r0, y0, k + 1, 1), [0, y1, 0, (k + 0.5) / SIDES, 0.5]], [0, -1, 0], K.BORE);
      else quad(lp(r0, y0, k, 0), lp(r0, y0, k + 1, 1), lp(r1, y1, k + 1, 1), lp(r1, y1, k, 0), out, K.BORE);
    }
  }
  // ---- the crown loop: two posts and a bar across the top (a box of quads) ----
  const box = (x0, x1, y0, y1, z0, z1, kind) => {
    const c = (x, y, z, side) => [x, y, z, 0.5 + x, side];
    quad(c(x0, y0, z1, 0), c(x1, y0, z1, 1), c(x1, y1, z1, 1), c(x0, y1, z1, 0), [0, 0, 1], kind);
    quad(c(x0, y0, z0, 0), c(x1, y0, z0, 1), c(x1, y1, z0, 1), c(x0, y1, z0, 0), [0, 0, -1], kind);
    quad(c(x1, y0, z0, 0), c(x1, y0, z1, 1), c(x1, y1, z1, 1), c(x1, y1, z0, 0), [1, 0, 0], kind);
    quad(c(x0, y0, z0, 0), c(x0, y0, z1, 1), c(x0, y1, z1, 1), c(x0, y1, z0, 0), [-1, 0, 0], kind);
    quad(c(x0, y1, z0, 0), c(x1, y1, z0, 1), c(x1, y1, z1, 1), c(x0, y1, z1, 0), [0, 1, 0], kind);
  };
  const yT = PROFILE[PROFILE.length - 1][1];
  box(-0.13, -0.07, yT, -0.03, -0.035, 0.035, K.LOOP);
  box(0.07, 0.13, yT, -0.03, -0.035, 0.035, K.LOOP);
  box(-0.13, 0.13, -0.03, 0, -0.035, 0.035, K.LOOP);
  // ---- the clapper: an octahedral ball on its rod, in the mouth ----
  const cy = -0.86;
  const cr = 0.075;
  const eq = [[cr, cy, 0], [0, cy, cr], [-cr, cy, 0], [0, cy, -cr]];
  for (let k = 0; k < 4; k++) {
    const p0 = eq[k], p1 = eq[(k + 1) % 4];
    const mx = (p0[0] + p1[0]) / 2, mz = (p0[2] + p1[2]) / 2;
    tri([[...p0, 0.25 * k, 0], [...p1, 0.25 * (k + 1), 1], [0, cy + cr * 1.2, 0, 0.25 * k + 0.125, 0.5]], [mx, 0.5, mz], K.CLAPPER);
    tri([[...p0, 0.25 * k, 0], [...p1, 0.25 * (k + 1), 1], [0, cy - cr * 1.2, 0, 0.25 * k + 0.125, 0.5]], [mx, -0.5, mz], K.CLAPPER);
  }
  box(-0.015, 0.015, cy + cr, BORE_TOP + 0.02, -0.015, 0.015, K.CLAPPER);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aBell', new THREE.Float32BufferAttribute(att, 4));
  geo.computeVertexNormals();
  return geo;
}

/**
 * @typedef {object} BellItem
 * @property {number} x @property {number} y @property {number} z
 * @property {number} swing @property {number} swingX @property {number} swingZ @property {number} spin
 * @property {number} height @property {number} seed @property {number} palette
 * @property {number} dissolve @property {number} dissolveDir @property {number} ghost @property {number} glow @property {number} strike
 */

/**
 * @typedef {object} BellParams
 * @property {number} [x] @property {number} [y] @property {number} [z]
 * @property {number} [swing] @property {number} [swingX] @property {number} [swingZ] @property {number} [spin]
 * @property {number} [dissolve] @property {number} [dissolveDir] @property {number} [ghost] @property {number} [glow] @property {number} [strike]
 */

export class SpectralBells {
  /** @param {{ capacity?: number }} [opts] */
  constructor({ capacity = 8 } = {}) {
    this.capacity = capacity;
    const geo = bellGeometry();
    /** Triangles of one bell (tests). */
    this.triangles = geo.getAttribute('position').count / 3;
    this._shape = new THREE.InstancedBufferAttribute(new Float32Array(capacity * SHAPE), SHAPE);
    this._fx = new THREE.InstancedBufferAttribute(new Float32Array(capacity * FX), FX);
    this._shape.setUsage(THREE.DynamicDrawUsage);
    this._fx.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iShape', this._shape);
    geo.setAttribute('iFx', this._fx);
    /**
     * Shader uniforms; `uBellLook` (the light's floor, the lines, the glyphs, the dissolve's front —
     * as designed: 0.42, 1, 1, 1) may be tuned.
     * @type {Record<string, THREE.IUniform>}
     */
    this.uniforms = {
      uBellNight: globalUniforms.uNight,
      uBellLook: { value: new THREE.Vector4(0.42, 1, 1, 1) },
    };
    const u = this.uniforms;
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n#define BELL_COLOR\n${GLSL_COMMON}\n${GLSL_VERTEX}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = bellVertex();');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL_FRAGMENT_PARS}`)
        .replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', GLSL_FRAGMENT_SHADE);
    };
    this.material.customProgramCacheKey = () => 'luminati-spectralbells-v1';

    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depthMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${GLSL_VERTEX}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = bellVertex();');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL_DEPTH_PARS}`)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n\tif ( bellKey() < vBellFx.x || bellGhosted() ) discard;');
    };
    this.depthMaterial.customProgramCacheKey = () => 'luminati-spectralbells-depth-v1';

    this.object = new THREE.InstancedMesh(geo, this.material, capacity);
    this.object.name = 'fx:spectralBells';
    this.object.count = 0;
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.castShadow = true;
    this.object.receiveShadow = true;
    this.object.customDepthMaterial = this.depthMaterial;
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    /** @type {Array<BellItem | null>} */
    this._items = new Array(capacity).fill(null);
    this._live = 0;
    this._m = new THREE.Matrix4();
    /** @type {number[]} the warm-up's bells (−1: none) */
    this._warm = [];
  }

  /**
   * @param {{ x?: number, y?: number, z?: number, height?: number, palette?: number, seed?: number }} o
   * @returns {number} a handle, or −1 when full
   */
  spawn(o) {
    const h = this._items.indexOf(null);
    if (h < 0) return -1;
    this._items[h] = {
      x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 0, swing: 0, swingX: 1, swingZ: 0, spin: 0,
      height: Math.max(0.1, o.height ?? 1.6), seed: ((o.seed ?? h) >>> 0) % 4096, palette: o.palette === 1 ? 1 : 0,
      dissolve: 0, dissolveDir: 0, ghost: 0, glow: 1, strike: 0,
    };
    this._live++;
    return h;
  }

  /**
   * @param {number} h
   * @param {BellParams} p
   */
  set(h, p) {
    const it = h >= 0 && h < this.capacity ? this._items[h] : null;
    if (!it) return;
    if (p.x !== undefined) it.x = p.x;
    if (p.y !== undefined) it.y = p.y;
    if (p.z !== undefined) it.z = p.z;
    if (p.swing !== undefined) it.swing = p.swing;
    if (p.swingX !== undefined) { it.swingX = p.swingX; it.swingZ = p.swingZ ?? 0; }
    if (p.spin !== undefined) it.spin = p.spin;
    if (p.dissolve !== undefined) it.dissolve = p.dissolve;
    if (p.dissolveDir !== undefined) it.dissolveDir = p.dissolveDir;
    if (p.ghost !== undefined) it.ghost = p.ghost;
    if (p.glow !== undefined) it.glow = p.glow;
    if (p.strike !== undefined) it.strike = p.strike;
  }

  /** @param {number} h */
  free(h) {
    if (h >= 0 && h < this.capacity && this._items[h]) {
      this._items[h] = null;
      this._live--;
    }
  }

  /** Live bells. */
  get count() { return this._live; }

  /** One bell of each palette far below the world (the warm-up draws and compiles them). */
  warm() {
    if (this._warm.length) return;
    for (const palette of [0, 1]) {
      const h = this.spawn({ x: palette * 3, y: -500, z: 0, height: 1.6, palette, seed: 1 });
      if (h >= 0) {
        this.set(h, { dissolve: 0.3, dissolveDir: 1, strike: 0.5, swing: 0.2 });
        this._warm.push(h);
      }
    }
    this.update(0);
  }

  /** End the warm-up bells. */
  unwarm() {
    for (const h of this._warm) this.free(h);
    this._warm.length = 0;
    this.update(0);
  }

  /** Write the live bells into the instance rows. @param {number} dt */
  update(dt) {
    void dt;
    const S = this._shape.array, F = this._fx.array, m = this._m.elements;
    let n = 0;
    for (const it of this._items) {
      if (!it || it.dissolve >= 1) continue;
      // the basis: the bell's own axis tipped by `swing` about the horizontal axis ⟂ (swingX, swingZ),
      // turned by `spin` about itself
      let sx = it.swingX, sz = it.swingZ;
      const sl = Math.hypot(sx, sz) || 1;
      sx /= sl; sz /= sl;
      const ca = Math.cos(it.swing), sa = Math.sin(it.swing);
      // the bell's up (pivot → crown direction is +Y at rest; the mouth hangs along −up): tipping the
      // mouth toward +(sx, sz) tips up toward −(sx, sz)
      const ux = -sx * sa, uy = ca, uz = -sz * sa;
      // a horizontal reference turned by `spin`, made ⟂ up
      const cs = Math.cos(it.spin), ss = Math.sin(it.spin);
      let rx = cs, ry = 0, rz = ss;
      const d = rx * ux + ry * uy + rz * uz;
      rx -= d * ux; ry -= d * uy; rz -= d * uz;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;
      // Z = X × Y
      const zx = ry * uz - rz * uy, zy = rz * ux - rx * uz, zz = rx * uy - ry * ux;
      m[0] = rx; m[1] = ry; m[2] = rz; m[3] = 0;
      m[4] = ux; m[5] = uy; m[6] = uz; m[7] = 0;
      m[8] = zx; m[9] = zy; m[10] = zz; m[11] = 0;
      m[12] = it.x; m[13] = it.y; m[14] = it.z; m[15] = 1;
      this.object.setMatrixAt(n, this._m);
      S[n * SHAPE] = it.height; S[n * SHAPE + 1] = it.seed; S[n * SHAPE + 2] = it.palette; S[n * SHAPE + 3] = 0;
      F[n * FX] = it.dissolve; F[n * FX + 1] = Math.sign(it.dissolveDir) * 4 + Math.min(0.99, Math.max(0, it.ghost));
      F[n * FX + 2] = it.glow; F[n * FX + 3] = Math.min(1, Math.max(0, it.strike));
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
    this.object.dispose?.();
  }
}
