import * as THREE from 'three';
import { globalUniforms } from '../render/GlobalUniforms.js';

/**
 * SpectralBlades — 3D swords for combat effects (the swordmaster's Tempest Edge blades and the giant
 * sword of Skyfall Judgement): one instanced mesh of faceted swords, lit by the scene's sun, ambient
 * and point lights (the lamps and the combat VFX lights), casting real sun shadows. Combat-only
 * (COMBAT_PURE): created by the swordmaster's look (src/game/combat/SwordmasterFx.js `SwordStage`),
 * only where the player's kit is the swordmaster's.
 *
 * API:
 *  - `object`: add to the scene; one draw call (+ the shadow pass); hidden while no sword lives.
 *  - `spawn({ x, y, z, length, width, palette, seed })` → handle (−1: full). (x, y, z) is the
 *    sword's point; `length` the whole sword (point → pommel) and `width` its blade, in world units;
 *    `palette` 0 steel, 1 gold; `seed` varies its brushed streaks and runes.
 *  - `set(h, { x, y, z, ax, ay, az, nx, ny, nz, dissolve, dissolveDir, ghost, glow, runes })`: the point,
 *    the blade's axis (point → pommel; normalised here) and the flat's normal (made perpendicular to
 *    the axis here: the face that shows the fuller); `dissolve` 0 … 1 a cut-out texel threshold
 *    (1: gone) that sweeps from the point (`dissolveDir` +1: the pommel goes last; read backwards it
 *    materialises pommel first), from the pommel (−1) or everywhere at once (0); `ghost` 0 … 0.99
 *    a share of its texels cut out everywhere besides (a see-through sword, still cut-out);
 *    `glow` the spectral light's strength (fuller core, runes, seams, the gem; 1 = normal); `runes`
 *    0 … 1 how much of the fuller's rune band is lit, from the guard toward the point.
 *  - `free(h)`, `update(dt)` once per frame, `count`, `warm()` (one steel and one gold sword far
 *    below the world, for the warm-up, until `unwarm()`), `dispose()`.
 *
 * The look (all in the shaders; per-instance data in instanced attributes, no per-sword material):
 *  - shape (≈ 100 triangles, origin at the point, +Y toward the pommel): a lozenge blade — an edge
 *    bevel, a flat and a fuller groove on each face, six facets a face — tapering over its last part
 *    to the point; a guard whose wings sweep toward the point, a gem on each face; an octagonal grip;
 *    an octahedral pommel. Flat-shaded: every facet is one tone band.
 *  - pixel look: every term snapped to 16 texels per world unit in sword space (u across, v along);
 *    the light quantised as IceCrystals' (half-stop bands, the soft knee, a 4-step shade ramp chosen
 *    by how much of the light is the direct one), each palette a 4-step albedo ramp tuned for that
 *    knee (the lit top stays steel-silver / burnished gold, never white; the gold sword's body is a
 *    blackened steel, its edge bevels and fittings gold, its lines pale gold); a 1-texel seam on each
 *    facet's lit edge (HDR: it blooms), a dark line on its shadowed edge; long brushed streaks on
 *    the flats; the grip's wrap in dark bands.
 *  - spectral: the fuller's core and a band of runes (hashed 3 × 5 glyphs on a wide blade, a lit
 *    line on a narrow one) glow (`glow`, `runes`), the gems too; the dissolve's front burns as a
 *    1-texel bright line; at night (`uNight`: the exposure rises) the self-glow holds back to 0.7.
 *  - shadows: a customDepthMaterial runs the same vertex code and the same dissolve cut.
 *  - fog as every lit material (MeshLambertMaterial's chunks).
 * Programs: `luminati-spectralblades-v1` and `luminati-spectralblades-depth-v1` (compiled by the
 * warm-up).
 */

/** Floats per sword of the instanced attributes. */
const SHAPE = 4; // length, width, seed, palette
const FX = 4; // dissolve, dissolve direction × 4 + ghost, glow, runes

/** Proportions along the sword (fractions of its length from the point). */
const Y_TAPER = 0.135;
const Y_BLADE = 0.74;
const Y_GUARD = 0.775;
const Y_GRIP = 0.94;

/**
 * Facet kinds (`aBlade.w`): the blade's (scaled by the width across) — 0 an edge bevel whose outer
 * edge (the cutting edge) is its left side, 8 one whose outer edge is its right side, 1 a flat, 2 a
 * fuller half whose rim is its left side, 9 one whose rim is its right side —; 3 a guard face whose
 * short side runs along the sword (scaled by the length), 4 a guard face whose short side runs
 * across (width); 5 the grip; 6 the pommel; 7 a gem.
 */
const K = Object.freeze({ BEVEL_L: 0, FLAT: 1, FULLER_L: 2, GUARD_Y: 3, GUARD_Z: 4, GRIP: 5, POMMEL: 6, GEM: 7, BEVEL_R: 8, FULLER_R: 9 });

const GLSL_COMMON = /* glsl */ `
attribute vec4 aBlade;  // part (0 blade, 1 guard, 2 grip, 3 pommel / gem), side (0 / 1 / 0.5 at an apex), facet width (normalised), kind
attribute vec4 iShape;  // length, width, seed, palette
attribute vec4 iFx;     // dissolve, dissolve direction, glow, runes
varying vec2 vBladeTc;  // texel coordinates (16 per world unit): u across from the axis, v along from the point
varying vec4 vBladeFx;  // dissolve, direction, glow, runes
varying vec3 vBladeK;   // seed, palette, the length in texels
varying float vBladeY;  // 0 point … 1 pommel
`;

const GLSL_VERTEX = /* glsl */ `
#ifdef BLADE_COLOR
varying vec2 vBladeEdge; // distance to the facet's left / right seam (world)
varying float vBladeKind;
varying float vBladeW;   // the blade's width in texels
#endif

vec3 bladeVertex() {
	float L = iShape.x, W = iShape.y;
	vec3 q = position;
	vec3 p = vec3( q.x * W, q.y * L, q.z * W );
	vBladeTc = vec2( q.x * W * 16.0, q.y * L * 16.0 );
	vBladeFx = iFx;
	vBladeK = vec3( iShape.z, iShape.w, L * 16.0 );
	vBladeY = q.y;
#ifdef BLADE_COLOR
	float kind = aBlade.w;
	float sc = ( kind > 2.5 && kind < 3.5 ) ? L : W;
	float w = aBlade.z * sc;
	float d = aBlade.y * w;
	vBladeEdge = aBlade.y > 0.25 && aBlade.y < 0.75 ? vec2( 0.0 ) : vec2( d, w - d );
	vBladeKind = kind;
	vBladeW = W * 16.0;
#endif
	return p;
}
`;

/** The dissolve cut, shared by the colour and the depth pass: true where a texel is gone. */
const GLSL_CUT = /* glsl */ `
float bladeHash( vec2 p ) {
	vec3 q = fract( vec3( p.xyx ) * 0.1031 );
	q += dot( q, q.yzx + 33.33 );
	return fract( ( q.x + q.y ) * q.z );
}
// the dissolve's direction and the ghost's share, packed (dir × 4 + ghost)
float bladeDir() { return floor( vBladeFx.y * 0.25 + 0.5 ); }
// the dissolve key of this texel: below the dissolve, it is cut
float bladeKey() {
	vec2 tc = floor( vBladeTc ) + 0.5;
	float h = bladeHash( tc + vBladeK.x * 1.37 );
	float dir = bladeDir();
	float f = clamp( vBladeY, 0.0, 1.0 );
	return dir > 0.5 ? f * 0.82 + h * 0.18 : dir < -0.5 ? ( 1.0 - f ) * 0.82 + h * 0.18 : h;
}
// a texel the ghost takes out (a share of the texels everywhere, hashed apart from the dissolve)
bool bladeGhosted() {
	float g = vBladeFx.y - bladeDir() * 4.0;
	return g > 0.001 && bladeHash( floor( vBladeTc ) + vec2( 17.8, 6.4 ) + vBladeK.x * 0.53 ) < g;
}
`;

const GLSL_FRAGMENT_PARS = /* glsl */ `
uniform float uBladeNight;
uniform vec4 uBladeLook;   // light floor, seams, runes / core, the dissolve front
varying vec2 vBladeTc;
varying vec4 vBladeFx;
varying vec3 vBladeK;
varying float vBladeY;
varying vec2 vBladeEdge;
varying float vBladeKind;
varying float vBladeW;
${GLSL_CUT}
// the palettes (linear albedo, tuned for the light's knee: × ≈ 1.47 at most), 4 steps each: the
// blade's body — slate steel (grey-silver on screen, not lavender); the gold sword's a blackened,
// warm steel, its value apart from a sunlit village's golds — and the gold (the gold sword's edges
// and fittings)
vec3 bladeRamp( float pal, int i ) {
	if ( pal < 0.5 ) {
		return i == 0 ? vec3( 0.045, 0.08, 0.105 ) : i == 1 ? vec3( 0.115, 0.20, 0.25 ) : i == 2 ? vec3( 0.225, 0.385, 0.43 ) : vec3( 0.36, 0.565, 0.59 );
	}
	return i == 0 ? vec3( 0.045, 0.04, 0.045 ) : i == 1 ? vec3( 0.10, 0.09, 0.09 ) : i == 2 ? vec3( 0.19, 0.17, 0.16 ) : vec3( 0.30, 0.27, 0.25 );
}
vec3 bladeGold( int i ) {
	return i == 0 ? vec3( 0.17, 0.08, 0.014 ) : i == 1 ? vec3( 0.36, 0.19, 0.035 ) : i == 2 ? vec3( 0.55, 0.32, 0.065 ) : vec3( 0.68, 0.42, 0.10 );
}
// (the gold's lit lines a pale gold: a saturated one reads as fire under a low sun)
vec3 bladeSeam( float pal ) { return pal < 0.5 ? vec3( 1.0, 1.06, 1.12 ) : vec3( 1.40, 0.92, 0.38 ); }
vec3 bladeRune( float pal ) { return pal < 0.5 ? vec3( 0.75, 0.85, 1.15 ) : vec3( 1.30, 0.90, 0.40 ); }
vec3 bladeCore( float pal ) { return pal < 0.5 ? vec3( 0.18, 0.30, 0.50 ) * 0.3 : vec3( 0.60, 0.30, 0.05 ) * 0.35; }
// the sun mirrored in a facet (metal): silver, burnished gold — under the bloom's linear range
vec3 bladeSpec( float pal ) { return pal < 0.5 ? vec3( 0.55, 0.58, 0.66 ) : vec3( 1.0, 0.68, 0.22 ); }
`;

/** Replaces Lambert's `outgoingLight` line: the quantised light, the palettes, the spectral terms. */
const GLSL_FRAGMENT_SHADE = /* glsl */ `
	float bKey = bladeKey();
	float bDis = vBladeFx.x;
	if ( bKey < bDis || bladeGhosted() ) discard;
	vec3 bEd = reflectedLight.directDiffuse;
	vec3 bEt = bEd + reflectedLight.indirectDiffuse;
	float bIt = max( max( bEt.r, max( bEt.g, bEt.b ) ), 1e-5 );
	// how much of the light is the direct one (0: in a shadow), the light in half-stop bands with
	// the soft knee (a strong light pales the metal, never burns it white)
	float bSh = clamp( max( bEd.r, max( bEd.g, bEd.b ) ) / bIt, 0.0, 1.0 );
	float bIq = exp2( floor( log2( bIt ) * 2.0 + 0.5 ) * 0.5 );
	if ( bIq > 0.7 ) bIq = 0.7 + ( bIq - 0.7 ) / ( 1.0 + ( bIq - 0.7 ) * 1.3 );
	vec3 bHue = mix( vec3( 1.0 ), bEt / bIt, 0.5 );
	// (a floor under the light: metal turned away from the sun still shows the sky)
	float bLight = uBladeLook.x + ( 1.0 - uBladeLook.x ) * bIq;
	float pal = vBladeK.y;
	float kind = vBladeKind;
	float glow = vBladeFx.z;
	bool blade = kind < 2.5 || kind > 7.5;
	bool fuller = ( kind > 1.5 && kind < 2.5 ) || kind > 8.5;
	vec2 tc = floor( vBladeTc ) + 0.5;
	float eL = floor( vBladeEdge.x * 16.0 ), eR = floor( vBladeEdge.y * 16.0 );
	float facetW = ( vBladeEdge.x + vBladeEdge.y ) * 16.0;
	// the facets' tone steps, as a pixel artist lights metal: from the upper left of the view (a
	// high sun lights every facet of an upright blade alike — it would read as one flat tone); the
	// scene's light, its colour and the cast shadows scale them (bLight, bHue)
	float bNl = dot( normal, normalize( vec3( -0.5, 0.55, 0.65 ) ) );
	int bRs = bNl > 0.72 ? 3 : bNl > 0.5 ? 2 : bNl > 0.22 ? 1 : 0;
	if ( bSh < 0.25 ) bRs = max( bRs - 1, 0 );      // in a cast shadow: a step down
	vec3 alb = bladeRamp( pal, bRs );
	if ( kind > 2.5 && kind < 4.5 || kind > 5.5 && kind < 6.5 ) {
		// the fittings: the gold sword's gold a step brighter, the steel's a step darker
		alb = pal > 0.5 ? bladeGold( min( bRs + 1, 3 ) ) : bladeRamp( pal, max( bRs - 1, 0 ) );
	} else if ( kind > 4.5 && kind < 5.5 ) {
		// the grip: a dark wrap in bands
		float band = mod( floor( vBladeTc.y * 0.5 ), 2.0 );
		alb = bladeRamp( pal, band > 0.5 ? 0 : min( bRs, 1 ) ) * 0.8;
	} else if ( blade ) {
		// the gold sword's edge bevels are gold (its edges read at the game camera)
		if ( pal > 0.5 && ( kind < 0.5 || kind > 7.5 && kind < 8.5 ) ) alb = bladeGold( bRs );
		// long brushed streaks along the flats
		float st = bladeHash( vec2( floor( vBladeTc.x ), floor( vBladeTc.y / 7.0 ) ) + vBladeK.x );
		alb *= st > 0.82 ? 1.12 : st < 0.12 ? 0.9 : 1.0;
	}
	vec3 col = alb * bLight * bHue;
	vec3 emis = vec3( 0.0 );
	float seam = 0.0;
	if ( blade ) {
		// the cutting edge — the blade's outline — gleams in a 1-texel line (brighter in the sun),
		// the fuller's rims are engraved dark lines, the point gleams
		float outer = kind < 0.5 ? eL : ( kind > 7.5 && kind < 8.5 ) ? eR : 99.0;
		if ( outer < 0.5 ) seam = 0.45 + 0.55 * bSh;
		float rim = ( kind > 1.5 && kind < 2.5 ) ? eL : kind > 8.5 ? eR : 99.0;
		if ( rim < 0.5 && vBladeW >= 6.0 ) col *= 0.45;
		if ( vBladeY < 0.03 ) seam = max( seam, 0.7 );
	} else {
		// the fittings' facet edges (the lit side bright, the shadowed side dark)
		seam = eL < 0.5 ? 0.12 + 0.88 * bSh * bSh : 0.0;
		if ( facetW < 3.0 ) seam *= 0.5;
		if ( kind > 4.5 && kind < 5.5 ) seam *= 0.25;
		if ( eR < 0.5 && eL >= 0.5 && bSh < 0.5 && facetW >= 3.0 ) col *= 0.6;
	}
	emis += bladeSeam( pal ) * seam * ( 0.4 + 0.45 * glow ) * uBladeLook.y;
#if NUM_DIR_LIGHTS > 0
	// the sun mirrored: a facet turned to send it into the eye flashes, in hard bands (flat facets:
	// the whole facet at once — the turning blades sparkle)
	vec3 bH = normalize( directionalLights[ 0 ].direction + geometryViewDir );
	float bNh = dot( normal, bH );
	float bSpec = bNh > 0.993 ? 1.0 : bNh > 0.975 ? 0.4 : 0.0;
	emis += bladeSpec( pal ) * bSpec * step( 0.55, bSh ) * min( bIq, 1.0 ) * uBladeLook.y;
#endif
	if ( fuller || blade && vBladeW < 6.0 && abs( vBladeTc.x ) < 0.75 ) {
		// the fuller: a faint core and the rune band, lit from the guard toward the point
		emis += bladeCore( pal ) * glow * uBladeLook.z;
		float vTop = ${Y_BLADE.toFixed(3)} * vBladeK.z;
		float fromGuard = vTop - tc.y;
		float lit = step( fromGuard, vBladeFx.w * ( vTop - 4.0 ) ) * step( 2.0, fromGuard );
		float on = 0.0;
		if ( vBladeW >= 6.0 ) {
			float cx = floor( vBladeTc.x + 1.5 );
			float cell = floor( fromGuard / 7.0 );
			float cy = mod( floor( fromGuard ), 7.0 );
			if ( cx >= 0.0 && cx <= 2.0 && cy < 5.0 ) on = step( cx == 1.0 ? 0.25 : 0.55, bladeHash( vec2( cell * 3.0 + cx, cy ) + vBladeK.x * 0.71 ) );
		} else on = mod( floor( fromGuard ), 4.0 ) < 3.0 ? 1.0 : 0.0;
		emis += bladeRune( pal ) * on * lit * ( 0.55 + 0.45 * glow ) * uBladeLook.z;
		if ( on * lit > 0.5 ) col *= 0.5;
	}
	if ( kind > 6.5 && kind < 7.5 ) emis += bladeRune( pal ) * ( 0.25 + 0.4 * glow ) * uBladeLook.z;
	// the dissolve's front burns as a bright line
	if ( bDis > 0.001 && bKey < bDis + 0.035 ) emis += bladeRune( pal ) * 0.8 * uBladeLook.w;
	// the exposure rises at night: the self-glow holds back so the facets keep their shape
	vec3 outgoingLight = col + emis * mix( 1.0, 0.7, uBladeNight );
`;

/** The depth pass's cut (the shadow follows the dissolve). */
const GLSL_DEPTH_PARS = /* glsl */ `
varying vec2 vBladeTc;
varying vec4 vBladeFx;
varying vec3 vBladeK;
varying float vBladeY;
${GLSL_CUT}
`;

/**
 * The shared geometry: every facet as separate triangles (flat shading); positions in sword units
 * (x, z in blade widths, y in lengths from the point), scaled per instance in the shader.
 * @returns {THREE.BufferGeometry}
 */
function swordGeometry() {
  /** @type {number[]} */ const pos = [];
  /** @type {number[]} */ const att = [];
  /**
   * One triangle, wound counter-clockwise seen from `out`; each vertex [x, y, z, side].
   * @param {number[][]} vs @param {number[]} out @param {number} part @param {number} width @param {number} kind
   */
  const tri = (vs, out, part, width, kind) => {
    const [a, b, c] = vs;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const order = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? [a, c, b] : [a, b, c];
    for (const v of order) {
      pos.push(v[0], v[1], v[2]);
      att.push(part, v[3], width, kind);
    }
  };
  /** A quad (l0, r0 at one end, l1, r1 at the other; side 0 on the l edge, 1 on the r edge). */
  const quad = (l0, r0, r1, l1, out, part, width, kind) => {
    tri([[...l0, 0], [...r0, 1], [...l1, 0]], out, part, width, kind);
    tri([[...r0, 1], [...r1, 1], [...l1, 0]], out, part, width, kind);
  };
  // ---- the blade: a lozenge with an edge bevel, a flat and a fuller on each face ----
  // (a bold profile: the bevels tilt ≈ 30°, the fuller's halves ≈ 17°, so the facets of a face
  // catch the light differently — a sword reads by that split)
  const PX = [-0.5, -0.36, -0.13, 0, 0.13, 0.36, 0.5];
  const PZ = [0, 0.085, 0.115, 0.075, 0.115, 0.085, 0];
  const KIND = [K.BEVEL_L, K.FLAT, K.FULLER_L, K.FULLER_R, K.FLAT, K.BEVEL_R];
  /** @type {(y: number, s: number, i: number, zs: number) => number[]} */
  const ring = (y, s, i, zs) => [PX[i] * s, y, PZ[i] * s * zs];
  for (const zs of [1, -1]) {
    for (let i = 0; i < 6; i++) {
      const mx = (PX[i] + PX[i + 1]) / 2;
      const out = [mx * 2, 0, zs];
      const tl = ring(Y_TAPER, 0.9, i, zs), tr = ring(Y_TAPER, 0.9, i + 1, zs);
      const bl = ring(Y_BLADE, 1, i, zs), br = ring(Y_BLADE, 1, i + 1, zs);
      const wT = Math.hypot(tr[0] - tl[0], tr[2] - tl[2]);
      const wB = Math.hypot(br[0] - bl[0], br[2] - bl[2]);
      // the point: the facets converge (the seams meet at the tip)
      tri([[...tl, 0], [...tr, 1], [0, 0, 0, 0.5]], [mx * 2, -0.6, zs], 0, wT, KIND[i]);
      // the body (the width is the facet's at each end: the seam's distance follows the taper)
      const ww = (wT + wB) / 2;
      quad(tl, tr, br, bl, out, 0, ww, KIND[i]);
    }
  }
  // ---- the guard: a bar whose wings sweep toward the point ----
  const GX = [-1.05, -0.5, 0.5, 1.05];
  const droop = (x) => (Math.abs(x) > 0.5 ? ((Math.abs(x) - 0.5) / 0.55) * 0.03 : 0);
  const gz = (x) => (Math.abs(x) > 0.5 ? 0.12 - ((Math.abs(x) - 0.5) / 0.55) * 0.04 : 0.12);
  const gy0 = (x) => Y_BLADE - droop(x);
  const gy1 = (x) => Y_GUARD - droop(x);
  for (let s = 0; s < 3; s++) {
    const xa = GX[s], xb = GX[s + 1];
    const v = (x, top, front) => [x, top ? gy1(x) : gy0(x), front ? gz(x) : -gz(x)];
    const dy = Y_GUARD - Y_BLADE;
    // front / back faces: their short side runs along the sword
    quad(v(xa, false, true), v(xb, false, true), v(xb, true, true), v(xa, true, true), [0, 0, 1], 1, dy, K.GUARD_Y);
    quad(v(xa, false, false), v(xb, false, false), v(xb, true, false), v(xa, true, false), [0, 0, -1], 1, dy, K.GUARD_Y);
    // top / bottom faces: their short side runs across
    const w = (gz(xa) + gz(xb));
    quad(v(xa, true, false), v(xb, true, false), v(xb, true, true), v(xa, true, true), [0, 1, 0], 1, w, K.GUARD_Z);
    quad(v(xa, false, false), v(xb, false, false), v(xb, false, true), v(xa, false, true), [0, -1, 0], 1, w, K.GUARD_Z);
  }
  for (const x of [GX[0], GX[3]]) {
    const sx = Math.sign(x);
    const a = [x, gy0(x), -gz(x)], b = [x, gy0(x), gz(x)], c = [x, gy1(x), gz(x)], d = [x, gy1(x), -gz(x)];
    quad(a, b, c, d, [sx, 0, 0], 1, gz(x) * 2, K.GUARD_Z);
  }
  // ---- a gem on each face of the guard ----
  const gemY = (Y_BLADE + Y_GUARD) / 2;
  for (const zs of [1, -1]) {
    const c = [0, gemY, 0.12 * zs];
    const apex = [0, gemY, (0.12 + 0.1) * zs];
    const rim = [[-0.11, gemY, c[2]], [0, gemY + 0.016, c[2]], [0.11, gemY, c[2]], [0, gemY - 0.016, c[2]]];
    for (let k = 0; k < 4; k++) {
      const p0 = rim[k], p1 = rim[(k + 1) % 4];
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2 - gemY;
      tri([[...p0, 0], [...p1, 1], [...apex, 0.5]], [mx * 4, my * 40, zs], 3, 0.15, K.GEM);
    }
  }
  // ---- the grip: an octagonal prism ----
  const GR = 0.12;
  const chord = 2 * GR * Math.sin(Math.PI / 8);
  for (let k = 0; k < 8; k++) {
    const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2, am = (a0 + a1) / 2;
    const l0 = [Math.cos(a0) * GR, Y_GUARD, Math.sin(a0) * GR], r0 = [Math.cos(a1) * GR, Y_GUARD, Math.sin(a1) * GR];
    const l1 = [Math.cos(a0) * GR, Y_GRIP, Math.sin(a0) * GR], r1 = [Math.cos(a1) * GR, Y_GRIP, Math.sin(a1) * GR];
    quad(l0, r0, r1, l1, [Math.cos(am), 0, Math.sin(am)], 2, chord, K.GRIP);
  }
  // ---- the pommel: an octahedron ----
  const pc = (Y_GRIP + 1) / 2, ph = (1 - Y_GRIP) / 2, pr = 0.2;
  const eq = [[pr, pc, 0], [0, pc, pr], [-pr, pc, 0], [0, pc, -pr]];
  for (let k = 0; k < 4; k++) {
    const p0 = eq[k], p1 = eq[(k + 1) % 4];
    const mx = (p0[0] + p1[0]) / 2, mz = (p0[2] + p1[2]) / 2;
    const w = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    tri([[...p0, 0], [...p1, 1], [0, pc + ph, 0, 0.5]], [mx, 0.5, mz], 3, w, K.POMMEL);
    tri([[...p0, 0], [...p1, 1], [0, pc - ph, 0, 0.5]], [mx, -0.5, mz], 3, w, K.POMMEL);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aBlade', new THREE.Float32BufferAttribute(att, 4));
  geo.computeVertexNormals();
  return geo;
}

/**
 * @typedef {object} BladeItem
 * @property {number} x @property {number} y @property {number} z
 * @property {number} ax @property {number} ay @property {number} az
 * @property {number} nx @property {number} ny @property {number} nz
 * @property {number} length @property {number} width @property {number} seed @property {number} palette
 * @property {number} dissolve @property {number} dissolveDir @property {number} ghost @property {number} glow @property {number} runes
 */

/**
 * @typedef {object} BladeParams
 * @property {number} [x] @property {number} [y] @property {number} [z]
 * @property {number} [ax] @property {number} [ay] @property {number} [az]
 * @property {number} [nx] @property {number} [ny] @property {number} [nz]
 * @property {number} [dissolve] @property {number} [dissolveDir] @property {number} [ghost] @property {number} [glow] @property {number} [runes]
 */

export class SpectralBlades {
  /** @param {{ capacity?: number }} [opts] */
  constructor({ capacity = 16 } = {}) {
    this.capacity = capacity;
    const geo = swordGeometry();
    /** Triangles of one sword (tests). */
    this.triangles = geo.getAttribute('position').count / 3;
    this._shape = new THREE.InstancedBufferAttribute(new Float32Array(capacity * SHAPE), SHAPE);
    this._fx = new THREE.InstancedBufferAttribute(new Float32Array(capacity * FX), FX);
    this._shape.setUsage(THREE.DynamicDrawUsage);
    this._fx.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iShape', this._shape);
    geo.setAttribute('iFx', this._fx);
    /**
     * Shader uniforms; `uBladeLook` (the light's floor, seams, runes and core, the dissolve's front —
     * as designed: 0.45, 1, 1, 1) may be tuned.
     * @type {Record<string, THREE.IUniform>}
     */
    this.uniforms = {
      uBladeNight: globalUniforms.uNight,
      uBladeLook: { value: new THREE.Vector4(0.45, 1, 1, 1) },
    };
    const u = this.uniforms;
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n#define BLADE_COLOR\n${GLSL_COMMON}\n${GLSL_VERTEX}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = bladeVertex();');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL_FRAGMENT_PARS}`)
        .replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', GLSL_FRAGMENT_SHADE);
    };
    this.material.customProgramCacheKey = () => 'luminati-spectralblades-v1';

    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depthMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${GLSL_VERTEX}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = bladeVertex();');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL_DEPTH_PARS}`)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n\tif ( bladeKey() < vBladeFx.x || bladeGhosted() ) discard;');
    };
    this.depthMaterial.customProgramCacheKey = () => 'luminati-spectralblades-depth-v1';

    this.object = new THREE.InstancedMesh(geo, this.material, capacity);
    this.object.name = 'fx:spectralBlades';
    this.object.count = 0;
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.castShadow = true;
    this.object.receiveShadow = true;
    this.object.customDepthMaterial = this.depthMaterial;
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    /** @type {Array<BladeItem | null>} */
    this._items = new Array(capacity).fill(null);
    this._live = 0;
    this._m = new THREE.Matrix4();
    /** @type {number[]} the warm-up's swords (−1: none) */
    this._warm = [];
  }

  /**
   * @param {{ x?: number, y?: number, z?: number, length?: number, width?: number, palette?: number, seed?: number }} o
   * @returns {number} a handle, or −1 when full
   */
  spawn(o) {
    const h = this._items.indexOf(null);
    if (h < 0) return -1;
    this._items[h] = {
      x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 0, ax: 0, ay: 1, az: 0, nx: 0, ny: 0, nz: 1,
      length: Math.max(0.1, o.length ?? 2), width: Math.max(0.02, o.width ?? 0.25), seed: ((o.seed ?? h) >>> 0) % 4096,
      palette: o.palette === 1 ? 1 : 0, dissolve: 0, dissolveDir: 0, ghost: 0, glow: 1, runes: 0,
    };
    this._live++;
    return h;
  }

  /**
   * @param {number} h
   * @param {BladeParams} p
   */
  set(h, p) {
    const it = h >= 0 && h < this.capacity ? this._items[h] : null;
    if (!it) return;
    if (p.x !== undefined) it.x = p.x;
    if (p.y !== undefined) it.y = p.y;
    if (p.z !== undefined) it.z = p.z;
    if (p.ax !== undefined) { it.ax = p.ax; it.ay = p.ay ?? 0; it.az = p.az ?? 0; }
    if (p.nx !== undefined) { it.nx = p.nx; it.ny = p.ny ?? 0; it.nz = p.nz ?? 0; }
    if (p.dissolve !== undefined) it.dissolve = p.dissolve;
    if (p.dissolveDir !== undefined) it.dissolveDir = p.dissolveDir;
    if (p.ghost !== undefined) it.ghost = p.ghost;
    if (p.glow !== undefined) it.glow = p.glow;
    if (p.runes !== undefined) it.runes = p.runes;
  }

  /** @param {number} h */
  free(h) {
    if (h >= 0 && h < this.capacity && this._items[h]) {
      this._items[h] = null;
      this._live--;
    }
  }

  /** Live swords. */
  get count() { return this._live; }

  /** One steel and one gold sword far below the world (the warm-up draws and compiles them). */
  warm() {
    if (this._warm.length) return;
    for (const palette of [0, 1]) {
      const h = this.spawn({ x: palette * 3, y: -500, z: 0, length: 2, width: 0.3, palette, seed: 1 });
      if (h >= 0) {
        this.set(h, { dissolve: 0.3, dissolveDir: 1, runes: 0.5 });
        this._warm.push(h);
      }
    }
    this.update(0);
  }

  /** End the warm-up swords. */
  unwarm() {
    for (const h of this._warm) this.free(h);
    this._warm.length = 0;
    this.update(0);
  }

  /** Write the live swords into the instance rows. @param {number} dt */
  update(dt) {
    void dt;
    const S = this._shape.array, F = this._fx.array, m = this._m.elements;
    let n = 0;
    for (const it of this._items) {
      if (!it || it.dissolve >= 1) continue;
      // the basis: Y the axis (point → pommel), Z the flat's normal made perpendicular, X = Y × Z
      let ax = it.ax, ay = it.ay, az = it.az;
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al; ay /= al; az /= al;
      const d = it.nx * ax + it.ny * ay + it.nz * az;
      let nx = it.nx - d * ax, ny = it.ny - d * ay, nz = it.nz - d * az;
      let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-4) {
        // (a normal along the axis: any perpendicular)
        nx = Math.abs(ay) < 0.9 ? -az : 0; ny = Math.abs(ay) < 0.9 ? 0 : az; nz = Math.abs(ay) < 0.9 ? ax : -ay;
        nl = Math.hypot(nx, ny, nz) || 1;
      }
      nx /= nl; ny /= nl; nz /= nl;
      const xx = ay * nz - az * ny, xy = az * nx - ax * nz, xz = ax * ny - ay * nx;
      m[0] = xx; m[1] = xy; m[2] = xz; m[3] = 0;
      m[4] = ax; m[5] = ay; m[6] = az; m[7] = 0;
      m[8] = nx; m[9] = ny; m[10] = nz; m[11] = 0;
      m[12] = it.x; m[13] = it.y; m[14] = it.z; m[15] = 1;
      this.object.setMatrixAt(n, this._m);
      S[n * SHAPE] = it.length; S[n * SHAPE + 1] = it.width; S[n * SHAPE + 2] = it.seed; S[n * SHAPE + 3] = it.palette;
      F[n * FX] = it.dissolve; F[n * FX + 1] = Math.sign(it.dissolveDir) * 4 + Math.min(0.99, Math.max(0, it.ghost));
      F[n * FX + 2] = it.glow; F[n * FX + 3] = it.runes;
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
