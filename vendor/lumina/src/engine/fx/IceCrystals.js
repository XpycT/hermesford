import * as THREE from 'three';
import { PixelCanvas, makePixelTexture } from '../pixel/PixelCanvas.js';
import { RNG, hash2 } from '../utils/math.js';
import { globalUniforms } from '../render/GlobalUniforms.js';

/**
 * IceCrystals — 3D ice spikes for combat spells (Glacial Tomb): one instanced mesh of faceted
 * crystals, lit by the scene's sun, ambient and point lights, casting real sun shadows. Combat-only
 * (COMBAT_PURE): created by the ice mage's look (src/game/party/IceSpellFx.js `IceStage`), only on
 * a level where an ice mage can fight.
 *
 * API:
 *  - `object`: add to the scene; one draw call (+ the shadow pass); hidden while no crystal lives.
 *  - `spawn({ x, y, z, height, radius, yaw, tiltX, tiltZ, seed })` → handle (−1: full). (x, y, z)
 *    is the crystal's foot on the ground; height and radius in world units; yaw (rad) turns its
 *    facets; tiltX / tiltZ lean its tip (world units of offset at the tip); seed varies its shape.
 *  - `set(h, { rise, crack, glint, glow })`: rise 0 … 1 the eruption (values above 1 overshoot,
 *    IceSpellFx animates 0 → 1.15 → 1), crack 0 … 1 (fractures before the shatter), glint 0 … 1 (a
 *    highlight sliding down the crystal), glow (the cold core's strength, 1 = normal).
 *  - `free(h)`, `update(dt)` once per frame, `count`, `warm()` (make it drawable for the warm-up:
 *    one crystal far below the world until `unwarm()`), `dispose()`.
 *
 * The look (all in the vertex / fragment shader, per-instance data in instanced attributes, no
 * per-crystal material):
 *  - shape: a six-sided shard (a frosted foot sunk into the ground, a body that tapers to a
 *    shoulder, a pointed and slightly off-centre tip) plus, by seed, up to two smaller five-sided
 *    shards leaning out of its flank (a cluster); the corners are jittered by seed (facet widths,
 *    radii), so no two crystals are alike. Flat-shaded: every facet is one tone band.
 *  - a dark frosted skirt at the foot (cut-out: frost rubble texels, then a dithered contact
 *    shadow fading out), so it sits on the ground; it casts no shadow. It lies 0.05 above the foot,
 *    so a foot sunk up to 0.05 into the ground (IceSpellFx sinks it 0.02) still shows it.
 *  - pixel look: a procedural 32 × 64 pixel texture (NEAREST, repeating) mapped at 16 texels per
 *    world unit — calm tone blocks, slanted light streaks, dark inclusions, inner fracture lines,
 *    sparkle texels, the crack lines' reveal order; every shader term is snapped to that texel
 *    grid; the light is quantised (half-stop intensity bands with a soft knee — a strong spell light
 *    pales the ice toward cyan, never burns it white —, a 4-step shade ramp that hue-shifts shadows
 *    toward blue-violet and lit facets toward cyan).
 *  - ice: a cold bright core (the view ray's distance to the shard's axis: brightest through the
 *    middle, dithered bands), a fresnel rim on grazing facets, a 1-texel seam on each facet's lit
 *    edge in HDR icy cyan (they bloom) and a dark line on the shadowed side's edges, the glint band
 *    sliding down (`glint`), crack lines lighting up in their reveal order (the newest texels
 *    flaring) while the body clouds over and dims (`crack`), `glow` scaling the core, rim and seams.
 *    At night (`uNight`, the exposure rises) the self-glow holds back to 0.7.
 *  - rise: the shard grows out of the ground (height × rise; thinner while it shoots up and when it
 *    overshoots — squash and stretch); the side shards follow a little later; the skirt spreads.
 *  - shadows: a customDepthMaterial runs the same vertex code (instancing, rise, the cluster).
 *  - fog as every lit material (MeshLambertMaterial's chunks).
 * Programs: `luminati-icecrystals-v1` and `luminati-icecrystals-depth-v1` (compiled by the warm-up).
 */

/** Floats per crystal of the instanced attributes. */
const SHAPE = 4; // height, radius, seed, rise
const FX = 4; // crack, glint, glow, -

/** The texture tile (texels): u around the shard, v along its height. */
const TEX_W = 32, TEX_H = 64;

/**
 * Geometry parts (`aIce.x`): 0 the main shard, 1 and 2 the side shards, 3 the skirt.
 * Sides and rings (y, radius in part units) — the same table as the shader's `iceRing`.
 */
const PARTS = [
  { part: 0, sides: 6, rings: [[-0.06, 1.0], [0.24, 0.92], [0.66, 0.56]], tip: 1 },
  { part: 1, sides: 5, rings: [[-0.15, 1.0], [0.52, 0.64]], tip: 1 },
  { part: 2, sides: 5, rings: [[-0.15, 1.0], [0.52, 0.64]], tip: 1 },
];
const SKIRT = { part: 3, sides: 12, rings: [[0, 0.8], [0, 2.3]] };

const GLSL_COMMON = /* glsl */ `
attribute vec4 aIce;    // part, ring (= tip ring for the tip), facet k, side (0: corner k, 1: corner k + 1)
attribute vec4 iShape;  // height, radius, seed, rise
attribute vec4 iFx;     // crack, glint, glow, -

float iceHash( vec3 p ) {
	p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
	p += dot( p, p.yxz + 33.33 );
	return fract( ( p.x + p.y ) * p.z );
}

float iceSides( float part ) { return part < 0.5 ? 6.0 : part < 2.5 ? 5.0 : 12.0; }
float iceTipRing( float part ) { return part < 0.5 ? 3.0 : 2.0; }

// a ring of a part: ( y, radius ) in part units
vec2 iceRing( float part, float ring ) {
	if ( part < 0.5 ) return ring < 0.5 ? vec2( -0.06, 1.0 ) : ring < 1.5 ? vec2( 0.24, 0.92 ) : vec2( 0.66, 0.56 );
	if ( part < 2.5 ) return ring < 0.5 ? vec2( -0.15, 1.0 ) : vec2( 0.52, 0.64 );
	return ring < 0.5 ? vec2( 0.0, 0.8 ) : vec2( 0.0, 2.3 );
}

// a corner in part units, jittered by the seed (facet widths, radii); the skirt is regular
vec3 iceCorner( float part, float ring, float k, float seed ) {
	float n = iceSides( part );
	float kk = mod( k, n );
	float sk = part > 2.5 ? 0.0 : 1.0;
	float jit = ( iceHash( vec3( seed, part * 13.0 + 1.0, kk ) ) - 0.5 ) * 0.55 * sk;
	float a = ( k + jit ) * 6.2831853 / n + iceHash( vec3( seed, part + 3.0, 91.0 ) ) * 6.2831853 * sk;
	vec2 yr = iceRing( part, ring );
	float rj = 1.0 + ( iceHash( vec3( seed, part * 7.0 + ring, kk + 17.0 ) ) - 0.5 ) * 0.24 * sk;
	return vec3( cos( a ) * yr.y * rj, yr.x, sin( a ) * yr.y * rj );
}

// thinner while it shoots up and when it overshoots (squash and stretch)
float iceWidth( float rise ) {
	return mix( 0.5, 1.0, smoothstep( 0.0, 0.85, rise ) ) * inversesqrt( max( rise, 1.0 ) );
}

// one side shard (part 1 or 2) of a crystal: on (0 / 1), length, radius (world), angle, lean, foot height (world)
void iceSub( float part, float seed, float h, float r, out float on, out float len, out float rad, out float phi, out float lean, out float hb ) {
	float j = part - 1.0;
	on = step( iceHash( vec3( seed, 5.0 + j, 2.0 ) ), j < 0.5 ? 0.72 : 0.42 );
	len = h * mix( j < 0.5 ? 0.3 : 0.2, j < 0.5 ? 0.48 : 0.34, iceHash( vec3( seed, 6.0 + j, 3.0 ) ) );
	rad = r * mix( 0.5, 0.7, iceHash( vec3( seed, 7.0 + j, 4.0 ) ) );
	float p0 = iceHash( vec3( seed, 8.0, 5.0 ) ) * 6.2831853;
	phi = j < 0.5 ? p0 : p0 + 3.14159 * mix( 0.6, 1.4, iceHash( vec3( seed, 9.0, 6.0 ) ) );
	lean = mix( 0.42, 0.78, iceHash( vec3( seed, 10.0 + j, 7.0 ) ) );
	hb = h * mix( 0.0, 0.12, iceHash( vec3( seed, 11.0 + j, 8.0 ) ) );
}

// part units → crystal-local world units (relative to the foot, before the instance matrix)
vec3 icePlace( float part, vec3 q, float seed, float h, float r, float rise ) {
	if ( part < 0.5 ) {
		float w = r * iceWidth( rise );
		return vec3( q.x * w, q.y * h * rise, q.z * w );
	}
	if ( part > 2.5 ) {
		float s = r * smoothstep( 0.0, 0.6, rise );
		return vec3( q.x * s, 0.05, q.z * s );
	}
	float on, len, rad, phi, lean, hb;
	iceSub( part, seed, h, r, on, len, rad, phi, lean, hb );
	float g = clamp( ( rise - 0.2 ) / 0.8, 0.0, 1.2 ) * on;
	float w = rad * iceWidth( g ) * step( 0.001, g );
	vec3 s = vec3( q.x * w, q.y * len * g, q.z * w );
	float cl = cos( lean ), sl = sin( lean );
	s = vec3( s.x * cl + s.y * sl, - s.x * sl + s.y * cl, s.z );
	float cp = cos( phi ), sp = sin( phi );
	s = vec3( s.x * cp - s.z * sp, s.y, s.x * sp + s.z * cp );
	float wm = r * iceWidth( rise );
	return s + vec3( cp * 0.5 * wm, hb * min( rise, 1.0 ), sp * 0.5 * wm );
}

vec3 iceTip( float part, float seed ) {
	vec2 o = vec2( iceHash( vec3( seed, part, 31.0 ) ), iceHash( vec3( seed, part, 37.0 ) ) ) - 0.5;
	return vec3( o.x * 0.35, 1.0, o.y * 0.35 );
}
`;

/** The vertex: a part's corner or tip, placed; the colour pass also writes its varyings. */
const GLSL_VERTEX = /* glsl */ `
#ifdef ICE_COLOR
varying vec2 vIceTc;     // texel coordinates (16 per world unit)
varying vec2 vIceEdge;   // distance to the facet's left / right seam (world)
varying vec2 vIceY;      // height above the part's foot in texels (pre-rise), the part's height in texels
varying vec4 vIceFx;     // crack, glint, glow, seed
varying float vIcePart;
varying vec3 vIceW;      // world position
varying vec3 vIceA;      // the part's foot (world)
varying vec3 vIceU;      // the part's axis (world, unit)
varying float vIceR;     // the crystal's radius (world)
#endif

vec3 iceVertex() {
	float part = aIce.x, ring = aIce.y, k = aIce.z, side = aIce.w;
	float h = iShape.x, r = iShape.y, seed = iShape.z, rise = iShape.w;
	float tipRing = iceTipRing( part );
	bool tip = part < 2.5 && ring > tipRing - 0.5;
	vec3 qL = iceCorner( part, ring, k, seed );
	vec3 qR = iceCorner( part, ring, k + 1.0, seed );
	vec3 q = tip ? iceTip( part, seed ) : ( side > 0.5 ? qR : qL );
	vec3 p = icePlace( part, q, seed, h, r, rise );
#ifdef ICE_DEPTH
	if ( part > 2.5 ) p = vec3( 0.0 );  // the skirt casts no shadow
#endif
#ifdef ICE_COLOR
	vec3 pL = icePlace( part, qL, seed, h, r, rise );
	vec3 pR = icePlace( part, qR, seed, h, r, rise );
	float w = tip ? 0.0 : length( pR - pL );
	float d = tip ? 0.0 : side * w;
	vIceEdge = vec2( d, w - d );
	// the part's own height (pre-rise) and this vertex's height along it, in texels
	float ph = h;
	if ( part > 0.5 && part < 2.5 ) {
		float on, len, rad, phi, lean, hb;
		iceSub( part, seed, h, r, on, len, rad, phi, lean, hb );
		ph = len;
	}
	float yq = clamp( q.y, 0.0, 1.0 );
	vIceY = vec2( yq * ph * 16.0, ph * 16.0 );
	// u: the seam distance plus a facet offset (neighbouring facets show other texels)
	float u0 = k * 9.0 + floor( iceHash( vec3( seed, part, 41.0 ) ) * 32.0 );
	vIceTc = vec2( u0 + ( tip ? 0.0 : d * 16.0 ), q.y * ph * 16.0 + part * 23.0 );
	vIceFx = vec4( iFx.xyz, seed );
	vIcePart = part;
	mat4 iceM = modelMatrix * instanceMatrix;
	vIceW = ( iceM * vec4( p, 1.0 ) ).xyz;
	vec3 a0 = icePlace( part, vec3( 0.0 ), seed, h, r, rise );
	vec3 a1 = icePlace( part, vec3( 0.0, 1.0, 0.0 ), seed, h, r, rise );
	vIceA = ( iceM * vec4( part > 2.5 ? vec3( 0.0 ) : a0, 1.0 ) ).xyz;
	vec3 ax = ( iceM * vec4( a1, 1.0 ) ).xyz - ( iceM * vec4( a0, 1.0 ) ).xyz;
	vIceU = length( ax ) > 1e-5 ? normalize( ax ) : vec3( 0.0, 1.0, 0.0 );
	vIceR = r;
#endif
	return p;
}
`;

const GLSL_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uIceMap;
uniform vec2 uIceMapSize;
uniform float uIceTime;
uniform float uIceNight;
uniform vec4 uIceLook;   // core, rim, seams, glint strengths
varying vec2 vIceTc;
varying vec2 vIceEdge;
varying vec2 vIceY;
varying vec4 vIceFx;
varying float vIcePart;
varying vec3 vIceW;
varying vec3 vIceA;
varying vec3 vIceU;
varying float vIceR;

float iceBayer( vec2 p ) {
	ivec2 q = ivec2( mod( floor( p ), 4.0 ) );
	const float M[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
	return ( M[ q.y * 4 + q.x ] + 0.5 ) / 16.0;
}
float iceHash2( vec2 p ) {
	vec3 q = fract( vec3( p.xyx ) * 0.1031 );
	q += dot( q, q.yzx + 33.33 );
	return fract( ( q.x + q.y ) * q.z );
}

// the ice ramp (linear): albedo, the light's hue shift, the HDR glow terms
const vec3 ICE_DEEP = vec3( 0.05, 0.11, 0.30 );
const vec3 ICE_PALE = vec3( 0.22, 0.42, 0.68 );
const vec3 ICE_FROST = vec3( 0.52, 0.66, 0.84 );
const vec3 ICE_HIGH = vec3( 0.42, 0.70, 0.86 );
const vec3 ICE_SHADE = vec3( 0.66, 0.56, 1.16 );   // shadowed facets lean blue-violet
const vec3 ICE_LIT = vec3( 0.90, 1.04, 1.10 );     // lit facets lean cyan
const vec3 ICE_CORE = vec3( 0.04, 0.22, 0.62 );
const vec3 ICE_RIM = vec3( 0.30, 0.90, 1.40 );
const vec3 ICE_SEAM = vec3( 0.40, 1.00, 1.50 );
const vec3 ICE_GLINT = vec3( 0.80, 1.60, 2.00 );
const vec3 ICE_CRACK = vec3( 0.55, 1.35, 1.95 );
const vec3 ICE_SHADOW = vec3( 0.05, 0.055, 0.12 );
const vec3 ICE_LUMA = vec3( 0.2126, 0.7152, 0.0722 );
`;

/** Replaces Lambert's `outgoingLight` line: the quantised light, the ice terms, the skirt. */
const GLSL_FRAGMENT_SHADE = /* glsl */ `
	vec3 iceEd = reflectedLight.directDiffuse;
	vec3 iceEt = iceEd + reflectedLight.indirectDiffuse;
	// the light's strength by its brightest channel (a blue night light does not inflate the blue)
	float iceIt = max( max( iceEt.r, max( iceEt.g, iceEt.b ) ), 1e-5 );
	// the shade ramp: 4 steps from shadowed (ambient only) to fully sunlit
	float iceSh = floor( clamp( max( iceEd.r, max( iceEd.g, iceEd.b ) ) / iceIt, 0.0, 1.0 ) * 4.0 + 0.5 ) / 4.0;
	// the light in half-stop bands, its hue kept in part
	float iceIq = exp2( floor( log2( iceIt ) * 2.0 + 0.5 ) * 0.5 );
	// a soft knee: a strong light (the spell's flash, a lamp at arm's length) pales the ice toward
	// cyan instead of burning it white
	if ( iceIq > 0.7 ) iceIq = 0.7 + ( iceIq - 0.7 ) / ( 1.0 + ( iceIq - 0.7 ) * 1.3 );
	vec3 iceHue = mix( vec3( 1.0 ), iceEt / iceIt, 0.6 );
	vec3 iceL = iceIq * iceHue * mix( ICE_SHADE, ICE_LIT, iceSh );
	float iceGlow = vIceFx.z;
	vec3 outgoingLight;
	if ( vIcePart > 2.5 ) {
		// the skirt: frost rubble texels, then a dithered contact shadow (world texel grid)
		vec2 g = floor( vIceW.xz * 16.0 ) + 0.5;
		float dr = length( g / 16.0 - vIceA.xz ) / max( vIceR, 1e-3 );
		float hr = iceHash2( g + vIceFx.w * 7.13 );
		float rubble = ( 1.0 - smoothstep( 0.8, 1.35, dr ) ) * 0.7;
		float shade = 1.0 - smoothstep( 1.1, 1.75, dr );
		if ( hr < rubble ) {
			vec3 alb = mix( ICE_PALE, ICE_FROST, step( 0.5, iceHash2( g * 1.7 ) ) );
			outgoingLight = alb * iceL + ICE_CORE * 0.12 * iceGlow;
		} else if ( iceBayer( g ) < shade ) {
			outgoingLight = ICE_SHADOW * iceL;
		} else discard;
	} else {
		vec2 tc = floor( vIceTc ) + 0.5;
		vec4 tx = texture2D( uIceMap, tc / uIceMapSize );
		float bay = iceBayer( tc );
		float crack = vIceFx.x;
		float yT = floor( vIceY.x ) + 0.5;               // texel row above the part's foot
		float yF = yT / max( vIceY.y, 1.0 );             // 0 foot … 1 tip
		float yW = yT / 16.0;                            // world units above the foot (pre-rise)
		// albedo: tone streaks, a frosted foot, darker at the very foot (contact), darker when cracked
		vec3 alb = mix( ICE_DEEP, ICE_PALE, tx.r );
		// facets turned to the light pale toward cyan (the ramp's highlight hue)
		alb = mix( alb, ICE_HIGH, 0.45 * smoothstep( 0.5, 1.0, iceSh ) );
		float frost = 1.0 - smoothstep( 0.03, 0.4, yW );
		if ( iceHash2( tc + 3.1 ) < frost * 0.9 ) alb = ICE_FROST;
		alb *= mix( 0.55, 1.0, smoothstep( 0.0, 0.18, yW ) );
		// fractured ice clouds over and dims (greyer, darker) as it is about to shatter, so the
		// bright crack lines stand out
		alb = mix( alb, vec3( dot( alb, ICE_LUMA ) ) * vec3( 0.8, 0.92, 1.12 ), 0.55 * crack ) * ( 1.0 - 0.35 * crack );
		vec3 col = alb * iceL;
		// view terms (flat facet normal)
		vec3 nw = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
		vec3 vd = normalize( vIceW - cameraPosition );
		float ndv = clamp( abs( dot( nw, vd ) ), 0.0, 1.0 );
		float rim = 1.0 - ndv;
		rim = rim > 0.82 ? 1.0 : rim > 0.66 ? 0.45 : 0.0;
		// the core: how close the view ray passes to the shard's axis here
		vec3 w = vIceW - vIceA;
		float along = dot( w, vIceU );
		float radial = length( w - along * vIceU );
		vec3 nn = cross( vd, vIceU );
		float nl = length( nn );
		float dist = nl > 1e-3 ? abs( dot( w, nn ) ) / nl : radial;
		float core = clamp( 1.0 - dist / max( radial, 1e-3 ), 0.0, 1.0 ) + ( bay - 0.5 ) * 0.22;
		float coreQ = core > 0.64 ? 1.0 : core > 0.32 ? 0.5 : 0.16;
		coreQ *= smoothstep( 0.0, 0.18, yF ) * mix( 1.0, 0.4, yF ) * ( 1.0 - 0.55 * crack );
		vec3 emis = ICE_CORE * coreQ * iceGlow * uIceLook.x;
		emis += ICE_RIM * rim * ( 0.5 + 0.5 * iceGlow ) * uIceLook.y;
		// inner fracture lines (seen through the core) and sparkle texels
		if ( abs( tx.g - 0.5 ) < 0.12 ) emis += ICE_CORE * 0.55 * clamp( core, 0.0, 1.0 ) * iceGlow;
		if ( tx.g > 0.9 ) emis += ICE_GLINT * 0.6 * iceGlow * step( 0.55, fract( uIceTime * 0.9 + tx.b * 7.0 + vIceFx.w * 0.013 ) );
		// seams: the facet edges as 1-texel lines (the lit side brighter), the tip's last texels
		float eL = floor( vIceEdge.x * 16.0 ), eR = floor( vIceEdge.y * 16.0 );
		float seam = eL < 0.5 ? 0.15 + 0.85 * iceSh * iceSh : eR < 0.5 ? 0.08 : 0.0;
		// a facet under 3 texels wide is all seam: only its lit edge then, and softer
		if ( ( vIceEdge.x + vIceEdge.y ) * 16.0 < 3.0 ) seam *= eL < 0.5 ? 0.6 : 0.0;
		if ( yF > 0.93 ) seam = max( seam, 0.8 );
		emis += ICE_SEAM * seam * ( 0.55 + 0.45 * iceGlow ) * uIceLook.z;
		// the shadowed side's edge as a dark line (the facet's turn, as a pixel artist draws it)
		if ( eR < 0.5 && eL >= 0.5 && iceSh < 0.5 && ( vIceEdge.x + vIceEdge.y ) * 16.0 >= 3.0 ) col *= 0.6;
		// the glint: a diagonal band sliding from the tip down to the foot
		float across = vIceEdge.x / max( vIceEdge.x + vIceEdge.y, 1e-3 );
		float gb = abs( yT - ( mix( 1.12, -0.12, vIceFx.y ) + ( across - 0.5 ) * 0.14 ) * vIceY.y );
		float gl = gb < 1.0 ? 1.0 : gb < 2.5 ? 0.3 : 0.0;
		emis += ICE_GLINT * gl * uIceLook.w;
		// cracks: lines lighting up in their reveal order
		if ( tx.b < crack ) {
			// the crack's newest texels flare, older ones settle to a cold line
			float fresh = 1.0 - smoothstep( 0.0, 0.18, crack - tx.b );
			col *= 0.35;
			emis = emis * 0.4 + ICE_CRACK * ( 0.45 + 0.9 * fresh );
		}
		// the exposure rises at night: the self-glow holds back so the facets keep their shape
		outgoingLight = col + emis * mix( 1.0, 0.7, uIceNight );
	}
`;

/**
 * The texture tile (data, not colour): r tone streaks, g fracture lines (0.5) and sparkle texels
 * (1), b the crack lines' reveal order (0.04 … 0.95; 1 = no crack). Deterministic (seeded RNG).
 * @returns {PixelCanvas}
 */
function iceTexture() {
  const pc = new PixelCanvas(TEX_W, TEX_H);
  const rng = new RNG(0x1ce5);
  const R = new Float32Array(TEX_W * TEX_H), G = new Float32Array(TEX_W * TEX_H), B = new Float32Array(TEX_W * TEX_H).fill(1);
  const at = (x, y) => (((y % TEX_H) + TEX_H) % TEX_H) * TEX_W + (((x % TEX_W) + TEX_W) % TEX_W);
  // tone: broad calm blocks (a facet reads as one colour), long slanted light streaks along the
  // grain, a few dark inclusions
  for (let x = 0; x < TEX_W; x++) {
    for (let y = 0; y < TEX_H; y++) R[at(x, y)] = 0.42 + 0.16 * hash2(x >> 2, y >> 3, 11) + 0.05 * hash2(x, y >> 2, 12);
  }
  for (let i = 0; i < 12; i++) {
    let x = rng.int(0, TEX_W - 1);
    const y = rng.int(0, TEX_H - 1), len = rng.int(9, 22), slant = rng.chance(0.5) ? 1 : -1, every = rng.int(3, 5);
    for (let k = 0; k < len; k++) {
      R[at(x, y + k)] = 0.95;
      if (k % every === every - 1) x += slant;
    }
  }
  for (let i = 0; i < 7; i++) {
    const x = rng.int(0, TEX_W - 1), y = rng.int(0, TEX_H - 1), len = rng.int(3, 8);
    for (let k = 0; k < len; k++) R[at(x + (k > len / 2 ? 1 : 0), y + k)] = 0.1;
  }
  // fracture lines: a few long diagonal lines, inside the ice
  for (let i = 0; i < 5; i++) {
    let x = rng.int(0, TEX_W - 1), y = rng.int(0, TEX_H - 1);
    const dx = rng.chance(0.5) ? 1 : -1, len = rng.int(8, 18), slope = rng.range(0.4, 1.6);
    for (let k = 0; k < len; k++) {
      G[at(Math.round(x), Math.round(y))] = 0.5;
      x += dx * (slope < 1 ? 1 : 1 / slope);
      y += slope < 1 ? slope : 1;
    }
  }
  // sparkle texels
  for (let i = 0; i < 22; i++) G[at(rng.int(0, TEX_W - 1), rng.int(0, TEX_H - 1))] = 1;
  // cracks: zig-zag diagonal walks up from the foot that branch, revealed in walk order (b = order)
  /** @param {number} x @param {number} y @param {number} dir @param {number} t0 @param {number} t1 @param {number} len @param {number} depth */
  const walk = (x, y, dir, t0, t1, len, depth) => {
    for (let k = 0; k < len; k++) {
      const i = at(x, y);
      B[i] = Math.min(B[i], Math.max(0.03, t0 + (k / len) * (t1 - t0)));
      y += 1;
      if (rng.chance(0.7)) x += dir;
      if (rng.chance(0.14)) dir = -dir;
      if (depth < 2 && rng.chance(0.08)) walk(x - dir, y, -dir, t0 + (k / len) * (t1 - t0), t1, Math.floor((len - k) * 0.5), depth + 1);
    }
  };
  for (let i = 0; i < 7; i++) walk(Math.floor((i * TEX_W) / 7 + rng.int(0, 2)), rng.int(0, 8), rng.chance(0.5) ? 1 : -1, rng.range(0.02, 0.14), rng.range(0.5, 0.8), rng.int(34, 60), 0);
  for (let y = 0; y < TEX_H; y++) {
    for (let x = 0; x < TEX_W; x++) {
      const i = at(x, y);
      pc.set(x, y, [Math.round(Math.min(1, Math.max(0, R[i])) * 255), Math.round(G[i] * 255), Math.round(B[i] * 255), 255]);
    }
  }
  return pc;
}

/**
 * The shared geometry: every part's facets as separate triangles (flat shading); positions are
 * computed in the shader from `aIce`, the `position` attribute holds a nominal crystal (bounds).
 * @returns {THREE.BufferGeometry}
 */
function crystalGeometry() {
  /** @type {number[]} */ const pos = [];
  /** @type {number[]} */ const ice = [];
  /** @param {{part:number, sides:number, rings:number[][]}} P @param {number} ring @param {number} k @param {number} side @param {boolean} tip */
  const nominal = (P, ring, k, side, tip) => {
    if (tip) return [0, 1, 0];
    const [y, r] = P.rings[ring];
    const a = ((k + side) * Math.PI * 2) / P.sides;
    return [Math.cos(a) * r, P.part === 3 ? 0 : y, Math.sin(a) * r];
  };
  /** One triangle, wound counter-clockwise seen from `out`. @param {any[]} vs [P, ring, k, side, tip] × 3 @param {number[]} out */
  const tri = (vs, out) => {
    const p = vs.map((v) => nominal(v[0], v[1], v[2], v[3], v[4]));
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const order = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? [0, 2, 1] : [0, 1, 2];
    for (const i of order) {
      pos.push(...p[i]);
      const v = vs[i];
      ice.push(v[0].part, v[4] ? v[0].rings.length : v[1], v[2], v[3]);
    }
  };
  for (const P of PARTS) {
    for (let k = 0; k < P.sides; k++) {
      const am = ((k + 0.5) * Math.PI * 2) / P.sides;
      const out = [Math.cos(am), 0.25, Math.sin(am)];
      for (let ring = 0; ring < P.rings.length - 1; ring++) {
        tri([[P, ring, k, 0, false], [P, ring, k, 1, false], [P, ring + 1, k, 0, false]], out);
        tri([[P, ring, k, 1, false], [P, ring + 1, k, 1, false], [P, ring + 1, k, 0, false]], out);
      }
      const top = P.rings.length - 1;
      tri([[P, top, k, 0, false], [P, top, k, 1, false], [P, top, k, 0, true]], [out[0], 0.6, out[2]]);
    }
  }
  for (let k = 0; k < SKIRT.sides; k++) {
    tri([[SKIRT, 0, k, 0, false], [SKIRT, 0, k, 1, false], [SKIRT, 1, k, 0, false]], [0, 1, 0]);
    tri([[SKIRT, 0, k, 1, false], [SKIRT, 1, k, 1, false], [SKIRT, 1, k, 0, false]], [0, 1, 0]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aIce', new THREE.Float32BufferAttribute(ice, 4));
  geo.computeVertexNormals();
  return geo;
}

/**
 * @typedef {object} CrystalItem
 * @property {number} x @property {number} y @property {number} z
 * @property {number} height @property {number} radius @property {number} yaw
 * @property {number} tiltX @property {number} tiltZ @property {number} seed
 * @property {number} rise @property {number} crack @property {number} glint @property {number} glow
 */

export class IceCrystals {
  /** @param {{ capacity?: number }} [opts] */
  constructor({ capacity = 64 } = {}) {
    this.capacity = capacity;
    const geo = crystalGeometry();
    this._shape = new THREE.InstancedBufferAttribute(new Float32Array(capacity * SHAPE), SHAPE);
    this._fx = new THREE.InstancedBufferAttribute(new Float32Array(capacity * FX), FX);
    this._shape.setUsage(THREE.DynamicDrawUsage);
    this._fx.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iShape', this._shape);
    geo.setAttribute('iFx', this._fx);

    this.texture = makePixelTexture(iceTexture().toCanvas(), { wrap: 'repeat', srgb: false, name: 'fx:iceCrystals' });
    /**
     * Shader uniforms; `uIceLook` (core, rim, seams, glint strengths — 1 = as designed) may be tuned.
     * @type {Record<string, THREE.IUniform>}
     */
    this.uniforms = {
      uIceMap: { value: this.texture },
      uIceMapSize: { value: new THREE.Vector2(TEX_W, TEX_H) },
      uIceTime: globalUniforms.uTime,
      uIceNight: globalUniforms.uNight,
      uIceLook: { value: new THREE.Vector4(1, 1, 1, 1) },
    };
    const u = this.uniforms;
    this.material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n#define ICE_COLOR\n${GLSL_COMMON}\n${GLSL_VERTEX}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = iceVertex();');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GLSL_FRAGMENT_PARS}`)
        .replace('vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;', GLSL_FRAGMENT_SHADE);
    };
    this.material.customProgramCacheKey = () => 'luminati-icecrystals-v1';

    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depthMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n#define ICE_DEPTH\n${GLSL_COMMON}\n${GLSL_VERTEX}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = iceVertex();');
    };
    this.depthMaterial.customProgramCacheKey = () => 'luminati-icecrystals-depth-v1';

    this.object = new THREE.InstancedMesh(geo, this.material, capacity);
    this.object.name = 'fx:iceCrystals';
    this.object.count = 0;
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.castShadow = true;
    this.object.receiveShadow = true;
    this.object.customDepthMaterial = this.depthMaterial;
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    /** @type {Array<CrystalItem | null>} */
    this._items = new Array(capacity).fill(null);
    this._live = 0;
    this._m = new THREE.Matrix4();
    this._warm = -1;
  }

  /**
   * @param {{ x: number, y: number, z: number, height?: number, radius?: number, yaw?: number, tiltX?: number, tiltZ?: number, seed?: number }} o
   * @returns {number} a handle, or −1 when full
   */
  spawn(o) {
    const h = this._items.indexOf(null);
    if (h < 0) return -1;
    this._items[h] = {
      x: o.x, y: o.y, z: o.z, height: Math.max(0.05, o.height ?? 1.6), radius: Math.max(0.02, o.radius ?? 0.25),
      yaw: o.yaw ?? 0, tiltX: o.tiltX ?? 0, tiltZ: o.tiltZ ?? 0, seed: ((o.seed ?? h) >>> 0) % 8192,
      rise: 0, crack: 0, glint: 0, glow: 1,
    };
    this._live++;
    return h;
  }

  /**
   * @param {number} h
   * @param {{ rise?: number, crack?: number, glint?: number, glow?: number }} p
   */
  set(h, p) {
    const it = this._items[h];
    if (!it) return;
    if (p.rise !== undefined) it.rise = p.rise;
    if (p.crack !== undefined) it.crack = p.crack;
    if (p.glint !== undefined) it.glint = p.glint;
    if (p.glow !== undefined) it.glow = p.glow;
  }

  /** @param {number} h */
  free(h) {
    if (h >= 0 && h < this.capacity && this._items[h]) {
      this._items[h] = null;
      this._live--;
    }
  }

  /** Live crystals. */
  get count() { return this._live; }

  /** One crystal far below the world (the warm-up draws and compiles it). */
  warm() {
    if (this._warm < 0) {
      this._warm = this.spawn({ x: 0, y: -500, z: 0, seed: 1 });
      this.set(this._warm, { rise: 1 });
      this.update(0);
    }
  }

  /** End the warm-up crystal. */
  unwarm() {
    if (this._warm >= 0) {
      this.free(this._warm);
      this._warm = -1;
      this.update(0);
    }
  }

  /** Write the live crystals into the instance rows. @param {number} dt */
  update(dt) {
    void dt;
    const S = this._shape.array, F = this._fx.array, m = this._m.elements;
    let n = 0;
    for (const it of this._items) {
      if (!it || it.rise <= 0.001) continue;
      // foot × tilt shear (the tip leans tiltX / tiltZ at the full height) × yaw
      const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
      m[0] = c; m[1] = 0; m[2] = -s; m[3] = 0;
      m[4] = it.tiltX / it.height; m[5] = 1; m[6] = it.tiltZ / it.height; m[7] = 0;
      m[8] = s; m[9] = 0; m[10] = c; m[11] = 0;
      m[12] = it.x; m[13] = it.y; m[14] = it.z; m[15] = 1;
      this.object.setMatrixAt(n, this._m);
      S[n * SHAPE] = it.height; S[n * SHAPE + 1] = it.radius; S[n * SHAPE + 2] = it.seed; S[n * SHAPE + 3] = it.rise;
      F[n * FX] = it.crack; F[n * FX + 1] = it.glint; F[n * FX + 2] = it.glow; F[n * FX + 3] = 0;
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
