import * as THREE from 'three';
import { RENDER_ORDER } from '../constants.js';
import { globalUniforms } from '../render/GlobalUniforms.js';
import { RNG, hashString, clamp, bayer4, fbm2 } from '../utils/math.js';
import { ownValue, ownColor } from '../utils/own.js';
import { PixelCanvas, makePixelTexture } from '../pixel/PixelCanvas.js';
// (the presets of Vanquish the Evil Dragon's packages, docs/contracts/DRAGON_CAMPAIGN.md §4, §8, are
// added at run time by `registerPresets`: the combat packages' — ./presets/hero, party, dragon,
// brutes, swarm — by the combat chunk, ./presets/combat.js; the siege's, ./presets/siege.js, by the
// set-piece kit, src/engine/world/SetPieceKit.js)

/**
 * Particles — GPU particle effects for the 2.5D pixel-art look.
 *
 * Continuous emitters are ONE instanced draw call each, fully stateless on the GPU: every
 * particle's life cycle, spawn position and motion are computed in the vertex shader from its
 * instance id, a per-emitter seed and `globalUniforms.uTime` (no per-frame CPU work besides a
 * few uniforms). Bursts (`burst()`) write a handful of spawn records into a small ring buffer
 * (one per material variant) and the GPU animates them with the same closed-form physics.
 *
 * Motion models:
 *   drift  — slow wandering motes in a box (dust, fireflies)
 *   emit   — spawn around a point with velocity, gravity/buoyancy, linear drag, wind, turbulence
 *            (embers, smoke, mist, sparkle area glints, all bursts)
 *   fall   — tumbling fall from the top of a box (leaves, petals)
 *   precip — wrapped box that can follow the camera (rain streaks, snow)
 *
 * Blending: 'additive' glows (HDR colours > 1 so they bloom; no depth write; fog fades them out),
 * 'normal' alpha blended (smoke, mist, rain, snow, footstep dust; fog mixes toward the fog colour),
 * 'cutout' pixel-art sprites (leaves, petals: alpha-tested, depth-writing, dithered fades).
 */

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Preset parameters (all overridable per emitter / burst):
 *  mode        'area' | 'point' | 'burst'   (default spawn shape; bursts can also run as emitters)
 *  motion      'drift' | 'emit' | 'fall' | 'precip'
 *  texture     'glow' | 'square' | 'leaf' | 'petal' | 'smoke' | 'star' | 'snow' | 'streak'
 *  blending    'additive' | 'normal' | 'cutout'
 *  count, life [min,max] s, size [min,max] world units, sizeEnd (multiplier at end of life),
 *  aspect (height/width), streak (motion-blur seconds for 'streak'),
 *  velocity [x,y,z], velocityVariance [x,y,z], radial (outward speed), gravity (+ = up), drag (1/s),
 *  windInfluence, turbulence [amplitude, frequency], spin [min,max] rad/s, tumble 0..1,
 *  color, colorEnd (over life), colors (palette, up to 4), hdr (colour multiplier), alpha,
 *  fade [in, out] fractions of life, twinkle, blink, nightVisibility (1 = night only,
 *  -k = dims by k at night), lit 0..1 (tinted by sun + ambient), pulse 0..1 (size grows & shrinks),
 *  bounds [x,y,z] default area size, spawnSize [x,y,z] for point/burst spawns,
 *  followCamera, burstSpeed [min,max], burstUp [min,max], ballistic (life ends when back at spawn height).
 * These are the engine's own; `PARTICLE_PRESETS` adds the packages' (./presets/*.js: the siege's
 * here, the combat packages' at run time through `registerPresets`).
 * @satisfies {Record<string, object>}
 */
const BASE_PRESETS = {
  dust: {
    mode: 'area', motion: 'drift', texture: 'glow', blending: 'additive',
    count: 90, life: [5, 10], size: [0.06, 0.12], sizeEnd: 1,
    velocity: [0, 0.05, 0], velocityVariance: [0.07, 0.04, 0.07], windInfluence: 0.12,
    turbulence: [0.3, 0.35], color: '#ffe0a0', hdr: 2.4, alpha: 0.85, fade: [0.25, 0.3],
    twinkle: 1, nightVisibility: -0.85, bounds: [14, 4, 14],
  },
  fireflies: {
    mode: 'area', motion: 'drift', texture: 'glow', blending: 'additive',
    count: 36, life: [8, 14], size: [0.2, 0.3], sizeEnd: 1,
    velocity: [0, 0, 0], velocityVariance: [0.1, 0.04, 0.1], windInfluence: 0.04,
    turbulence: [0.8, 0.3], color: '#b6ff3c', colorEnd: '#ffd23c', hdr: 2.4, alpha: 1, fade: [0.15, 0.2],
    blink: 1, nightVisibility: 1, bounds: [10, 2.2, 10],
  },
  embers: {
    mode: 'point', motion: 'emit', texture: 'square', blending: 'additive',
    count: 34, life: [0.9, 2.2], size: [0.07, 0.11], sizeEnd: 0.35,
    spawnSize: [0.6, 0.15, 0.6], velocity: [0, 1.5, 0], velocityVariance: [0.3, 0.55, 0.3], radial: 0.12,
    gravity: 0.5, drag: 0.7, windInfluence: 0.35, turbulence: [0.3, 5.0],
    // saturated start colour: ACES (exposure ~1.25 at night) turns '#ffb347' x3 into near-white cream;
    // '#ff8a2a' x2.4 tone-maps to warm gold-orange and still crosses the bloom threshold
    color: '#ff8a2a', colorEnd: '#ff3a12', hdr: 2.4, alpha: 1, fade: [0.04, 0.35], twinkle: 0.35,
  },
  smoke: {
    mode: 'point', motion: 'emit', texture: 'smoke', blending: 'normal',
    count: 22, life: [3.5, 6], size: [0.45, 0.7], sizeEnd: 4.2,
    spawnSize: [0.25, 0.1, 0.25], velocity: [0, 0.8, 0], velocityVariance: [0.1, 0.15, 0.1],
    gravity: 0.06, drag: 0.3, windInfluence: 0.22, turbulence: [0.25, 1.2], spin: [0.1, 0.4],
    color: '#d2cdc8', colorEnd: '#8d8b92', alpha: 0.5, fade: [0.12, 0.55], lit: 1,
  },
  leaves: {
    mode: 'area', motion: 'fall', texture: 'leaf', blending: 'cutout',
    count: 24, size: [0.46, 0.54], velocity: [0, -0.75, 0], velocityVariance: [0, 0.3, 0],
    windInfluence: 0.45, turbulence: [0.55, 1.6], spin: [1.2, 3.0], tumble: 1,
    colors: ['#e0752f', '#f2b04a', '#b8462a', '#86ad48'], alpha: 1, fade: [0.06, 0.12], lit: 1,
    bounds: [10, 6, 10],
  },
  petals: {
    mode: 'area', motion: 'fall', texture: 'petal', blending: 'cutout',
    count: 40, size: [0.3, 0.36], velocity: [0, -0.5, 0], velocityVariance: [0, 0.3, 0],
    windInfluence: 0.8, turbulence: [0.75, 1.3], spin: [1.0, 2.6], tumble: 1,
    colors: ['#f7b3c7', '#ffd8e3', '#fff4f6', '#f28fb0'], alpha: 1, fade: [0.06, 0.12], lit: 1,
    bounds: [10, 5, 10],
  },
  rain: {
    mode: 'area', motion: 'precip', texture: 'streak', blending: 'normal', followCamera: true,
    count: 1600, size: [0.035, 0.05], aspect: 12, streak: 0.03,
    velocity: [0, -15, 0], velocityVariance: [0, 0.12, 0], windInfluence: 0.9,
    color: '#c4d8f6', alpha: 0.5, lit: 0.6, bounds: [36, 16, 36],
  },
  snow: {
    mode: 'area', motion: 'precip', texture: 'snow', blending: 'normal', followCamera: true,
    count: 1100, size: [0.08, 0.13], velocity: [0, -1.0, 0], velocityVariance: [0, 0.35, 0],
    windInfluence: 0.45, turbulence: [0.35, 1.1], spin: [0.5, 0.5],
    color: '#ffffff', alpha: 0.95, lit: 0.75, bounds: [34, 14, 34],
  },
  mist: {
    mode: 'point', motion: 'emit', texture: 'smoke', blending: 'normal',
    count: 34, life: [1.6, 3.0], size: [0.6, 0.9], sizeEnd: 3.2,
    spawnSize: [2.0, 0.3, 0.4], velocity: [0, 0.35, 0.45], velocityVariance: [0.45, 0.3, 0.35], radial: 0.5,
    gravity: 0.05, drag: 1.0, windInfluence: 0.2, turbulence: [0.2, 1.5], spin: [0.1, 0.5],
    color: '#eef8ff', colorEnd: '#d2e6f4', alpha: 0.28, fade: [0.15, 0.6], lit: 0.9,
  },
  footstep: {
    mode: 'burst', motion: 'emit', texture: 'smoke', blending: 'normal',
    count: 8, life: [0.35, 0.65], size: [0.14, 0.22], sizeEnd: 2.2,
    spawnSize: [0.3, 0.02, 0.14], burstSpeed: [0.5, 1.1], burstUp: [0.15, 0.45],
    gravity: -0.3, drag: 5, windInfluence: 0.1, spin: [0.5, 2],
    color: '#d6bf98', alpha: 0.7, fade: [0.05, 0.6], lit: 1,
  },
  splash: {
    mode: 'burst', motion: 'emit', texture: 'square', blending: 'normal',
    count: 16, life: [0.45, 0.8], size: [0.07, 0.12], sizeEnd: 0.6,
    spawnSize: [0.3, 0.02, 0.3], burstSpeed: [0.8, 2.2], burstUp: [2.2, 4.2],
    gravity: -9.8, drag: 0.4, ballistic: true,
    color: '#e8f6ff', hdr: 1.4, alpha: 0.95, fade: [0.0, 0.3], lit: 0.5,
  },
  sparkle: {
    mode: 'burst', motion: 'emit', texture: 'star', blending: 'additive',
    count: 10, life: [0.45, 1.0], size: [0.28, 0.5], sizeEnd: 0.9, pulse: 1,
    spawnSize: [0.8, 0.8, 0.8], burstSpeed: [0.2, 0.8], burstUp: [0.2, 0.8],
    velocity: [0, 0.12, 0], gravity: 0.2, drag: 2, spin: [0.5, 2],
    color: '#fff6d0', hdr: 6, alpha: 1, fade: [0.05, 0.3], bounds: [4, 1, 4],
  },

  // ---- combat bursts (COMBAT.md §11.3; combat levels only, NOT catalog emitter presets). Their
  // pool-key fields (texture, variants, blending, lit, pulse, tumble, aspect, streak, fade, twinkle,
  // blink, nightVisibility) are fixed so that all six add exactly ONE new burst pool (the additive
  // streak pool of hitSpark / emberBurst); the others share the footstep and sparkle pools — a
  // shared pool keeps the uniforms of the preset that created it, which is why those fields must
  // match. Only per-particle fields (colours, hdr, life, size, speeds, gravity, drag, spin) may be
  // tuned; sandbox/combat_fx.html asserts the pool growth. Call them override-free with an explicit
  // count (≤ 12 per hit, ≤ 24 per death / level-up).
  hitSpark: {
    mode: 'burst', motion: 'emit', texture: 'streak', blending: 'additive', variants: 1,
    lit: 0, pulse: 0, tumble: 0, aspect: 4, streak: 0.04, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
    count: 8, life: [0.12, 0.25], size: [0.05, 0.08], sizeEnd: 0.6,
    spawnSize: [0.1, 0.1, 0.1], burstSpeed: [3, 7], burstUp: [0.5, 2], gravity: -8, drag: 4,
    color: '#fff2c0', colorEnd: '#ff9a3c', hdr: 4, alpha: 1,
  },
  emberBurst: {
    mode: 'burst', motion: 'emit', texture: 'streak', blending: 'additive', variants: 1,
    lit: 0, pulse: 0, tumble: 0, aspect: 4, streak: 0.04, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
    count: 10, life: [0.4, 0.9], size: [0.05, 0.09], sizeEnd: 0.5,
    spawnSize: [0.4, 0.2, 0.4], burstSpeed: [1, 3], burstUp: [1, 3], gravity: 1.5, drag: 1,
    colors: ['#ff8a2a', '#ff3a12', '#ffd27a'], hdr: 3, alpha: 1,
  },
  deathPoof: {
    mode: 'burst', motion: 'emit', texture: 'smoke', blending: 'normal', variants: 1,
    lit: 1, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.6], twinkle: 0, blink: 0, nightVisibility: 0,
    count: 10, life: [0.4, 0.8], size: [0.5, 0.5], sizeEnd: 2.2,
    spawnSize: [0.5, 0.3, 0.5], burstSpeed: [0.6, 1.4], burstUp: [0.3, 0.8], drag: 4, spin: [0.5, 2],
    color: '#d8d0c0', alpha: 0.7,
  },
  gooPoof: {
    mode: 'burst', motion: 'emit', texture: 'smoke', blending: 'normal', variants: 1,
    lit: 1, pulse: 0, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.6], twinkle: 0, blink: 0, nightVisibility: 0,
    count: 10, life: [0.4, 0.8], size: [0.5, 0.5], sizeEnd: 2.2,
    spawnSize: [0.5, 0.3, 0.5], burstSpeed: [0.6, 1.4], burstUp: [0.3, 0.8], drag: 4, spin: [0.5, 2],
    color: '#5fc7b0', alpha: 0.7,
  },
  healGlow: {
    mode: 'burst', motion: 'emit', texture: 'star', blending: 'additive', variants: 1,
    lit: 0, pulse: 1, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
    count: 8, life: [0.5, 1.0], size: [0.2, 0.35], sizeEnd: 0.8,
    spawnSize: [0.6, 0.8, 0.6], velocity: [0, 1.2, 0], burstSpeed: [0.2, 0.6], burstUp: [0, 0.3], drag: 1,
    color: '#bfe58f', hdr: 2.4, alpha: 1, // hdr 2.4 (not 3): keeps the green through ACES
  },
  magicBurst: {
    mode: 'burst', motion: 'emit', texture: 'star', blending: 'additive', variants: 1,
    lit: 0, pulse: 1, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
    count: 12, life: [0.4, 0.8], size: [0.25, 0.45], sizeEnd: 0.7,
    spawnSize: [0.3, 0.3, 0.3], burstSpeed: [2, 5], burstUp: [-0.5, 0.5], drag: 3,
    colors: ['#8fd0ff', '#f3cf7a'], hdr: 3.5, alpha: 1,
  },
  // the boss-death and level-up variants (COMBAT-16): the same two pools as emberBurst (streak) and
  // healGlow / magicBurst (sparkle), so no new pool or program; dimmer (the brightest colour at
  // about the 1.05 bloom threshold instead of 2–5 × over it), slower and rising, so bursts next
  // to the player glint instead of whiting it out (3 × 24 emberBurst + 24 + 14 hdr-6 sparkles
  // made a ≈ 0.4 s glare over the player at the boss's kill). The two star presets sit at hdr 1.15:
  // #fff0c8 → luminance ≈ 1.01 per star, just under the threshold (1.3 bloomed at head height)
  victoryEmbers: {
    mode: 'burst', motion: 'emit', texture: 'streak', blending: 'additive', variants: 1,
    lit: 0, pulse: 0, tumble: 0, aspect: 4, streak: 0.04, fade: [0, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
    count: 12, life: [0.7, 1.3], size: [0.05, 0.08], sizeEnd: 0.5,
    spawnSize: [1.0, 0.8, 0.6], burstSpeed: [0.3, 1.1], burstUp: [1.6, 3.2], gravity: 1.2, drag: 1.4,
    colors: ['#ff8a2a', '#ff3a12', '#ffd27a'], hdr: 1.5, alpha: 1,
  },
  victorySparkle: {
    mode: 'burst', motion: 'emit', texture: 'star', blending: 'additive', variants: 1,
    lit: 0, pulse: 1, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
    count: 12, life: [0.6, 1.1], size: [0.16, 0.3], sizeEnd: 0.8,
    spawnSize: [1.4, 1.0, 0.8], velocity: [0, 0.5, 0], burstSpeed: [0.15, 0.6], burstUp: [0.2, 0.8], gravity: 0.2, drag: 2, spin: [0.5, 2],
    color: '#fff0c8', hdr: 1.15, alpha: 1,
  },
  levelSparkle: {
    mode: 'burst', motion: 'emit', texture: 'star', blending: 'additive', variants: 1,
    lit: 0, pulse: 1, tumble: 0, aspect: 1, streak: 0, fade: [0.05, 0.3], twinkle: 0, blink: 0, nightVisibility: 0,
    count: 14, life: [0.6, 1.1], size: [0.14, 0.26], sizeEnd: 0.8,
    spawnSize: [1.3, 0.5, 1.3], velocity: [0, 0.9, 0], burstSpeed: [0.3, 0.8], burstUp: [0.1, 0.5], gravity: 0.2, drag: 1.5, spin: [0.5, 2],
    color: '#fff0c8', hdr: 1.15, alpha: 1,
  },
};

/**
 * Every preset (see the parameters above): the engine's, then whatever `registerPresets` adds at
 * run time — the combat packages' of Vanquish the Evil Dragon (hero, party, dragon, brutes, swarm:
 * ./presets/combat.js, registered by `CombatSystem.load`) and the siege's (./presets/siege.js:
 * `smokeDark` …, registered by the set-piece kit) — so a level without combat or set pieces never
 * holds their names.
 * @satisfies {Record<string, object>}
 */
export const PARTICLE_PRESETS = {
  ...BASE_PRESETS,
};

/**
 * Add presets to `PARTICLE_PRESETS` at run time (additive: a package's presets come with the chunk
 * that uses them — the combat packages' with the combat chunk, `CombatSystem.load`; the siege's with
 * the set-piece kit). A name already there throws, unless it is the same preset object (registering
 * a module again is harmless: every combat level registers them). Bursts and emitters look their
 * preset up when they are made, so a package registers before its first burst or emitter (the
 * combat warm-up primes them; the kit loads before the world is built).
 * @param {Readonly<Record<string, object>>} presets
 */
export function registerPresets(presets) {
  const table = /** @type {Record<string, object>} */ (PARTICLE_PRESETS);
  for (const [k, v] of Object.entries(presets)) {
    if (Object.hasOwn(table, k)) {
      if (table[k] === v) continue;
      throw new Error(`Particles: the preset "${k}" is defined twice`);
    }
    table[k] = v;
  }
}

const DEFAULTS = {
  mode: 'point', motion: 'emit', texture: 'glow', blending: 'additive',
  count: 32, life: [1, 2], size: [0.1, 0.1], sizeEnd: 1, aspect: 1, streak: 0,
  velocity: [0, 0, 0], velocityVariance: [0, 0, 0], radial: 0, gravity: 0, drag: 0, windInfluence: 0,
  turbulence: [0, 1], spin: [0, 0], tumble: 0,
  color: '#ffffff', colorEnd: null, colors: null, hdr: 1, alpha: 1, fade: [0.1, 0.3],
  twinkle: 0, blink: 0, nightVisibility: 0, lit: 0, pulse: 0,
  bounds: [6, 3, 6], spawnSize: [0.2, 0.2, 0.2], followCamera: false, followDistance: 20,
  burstSpeed: [0.5, 1.5], burstUp: [0.5, 1.5], ballistic: false, map: null, variants: 1,
};

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

const GLSL_BAYER = /* glsl */ `
float lpBayer4( vec2 p ) {
	ivec2 q = ivec2( mod( floor( p ), 4.0 ) );
	const float M[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
	return ( M[ q.y * 4 + q.x ] + 0.5 ) / 16.0;
}
`;

const PARTICLE_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

uniform float uTime;
uniform float uNight;
uniform vec2 uWind;
uniform float uWindStrength;
uniform vec3 uSunColor;

uniform vec3 uOrigin;
uniform vec3 uBox;
uniform float uSeed;
uniform float uCount;
uniform float uIntensity;
uniform vec2 uLife;
uniform vec2 uSize;
uniform float uSizeEnd;
uniform vec2 uStretch;
uniform vec3 uVel;
uniform vec3 uVelVar;
uniform float uRadial;
uniform float uGravity;
uniform float uDrag;
uniform float uWindInfluence;
uniform vec2 uTurb;
uniform vec2 uSpin;
uniform float uTumble;
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec3 uPalette[ 4 ];
uniform float uPaletteSize;
uniform float uAlpha;
uniform vec2 uFade;
uniform float uVariants;
uniform float uTwinkle;
uniform float uBlink;
uniform float uNightVis;
uniform float uLit;
uniform float uPulse;

#ifdef BURST
attribute vec4 aOrigin; // xyz spawn, w birth time
attribute vec4 aVel;    // xyz initial velocity, w life
attribute vec4 aSize;   // x size, y end multiplier, z rotation, w spin
attribute vec4 aColor;  // rgb (linear, HDR), a alpha
attribute vec4 aPhys;   // x gravity, y drag, z wind influence, w seed
#endif

varying vec2 vUv;
varying vec4 vColor;
varying float vVariant;

uvec4 lpPcg4( uvec4 v ) {
	v = v * 1664525u + 1013904223u;
	v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
	v ^= v >> 16u;
	v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
	return v;
}

vec4 lpHash( float a, float b, float c ) {
	uvec4 h = lpPcg4( uvec4( uint( a ), uint( b ), uint( c ), 2654435769u ) );
	return vec4( h >> 8u ) / 16777216.0;
}

void main() {

	vec3 wind3 = vec3( uWind.x, 0.0, uWind.y ) * uWindStrength;
	vec3 wpos = vec3( 0.0 );
	vec3 vel = vec3( 0.0, - 1.0, 0.0 );
	float t = 0.5;
	float age = 0.0;
	float size = 0.1;
	float angle = 0.0;
	float tumble = 1.0;
	float gate = 1.0;
	vec3 col = uColor0;
	float alpha = uAlpha;
	vec4 s = vec4( 0.5 );

#ifdef BURST

	age = uTime - aOrigin.w;
	float life = max( aVel.w, 1e-3 );
	t = age / life;
	gate = ( age >= 0.0 && t < 1.0 ) ? 1.0 : 0.0;
	s = fract( vec4( aPhys.w, aPhys.w * 7.31, aPhys.w * 13.17, aPhys.w * 3.73 ) );
	float k = max( aPhys.y, 1e-3 );
	vec3 g = vec3( 0.0, aPhys.x, 0.0 ) + wind3 * aPhys.z;
	float ek = exp( - k * max( age, 0.0 ) );
	float E = ( 1.0 - ek ) / k;
	wpos = aOrigin.xyz + aVel.xyz * E + g / k * ( age - E );
	vel = aVel.xyz * ek + g / k * ( 1.0 - ek );
	size = aSize.x * mix( 1.0, aSize.y, clamp( t, 0.0, 1.0 ) );
	angle = aSize.z + aSize.w * age;
	col = aColor.rgb;
	alpha = aColor.a;
	tumble = mix( 1.0, cos( age * aSize.w * 1.3 + s.y * 6.2831 ), uTumble );

#else

	float id = float( gl_InstanceID );
	s = lpHash( id, 0.0, uSeed );
	gate = clamp( uIntensity * uCount - id, 0.0, 1.0 ) * clamp( uIntensity * 3.0, 0.0, 1.0 );

	#ifdef MOTION_PRECIP

		vec4 r = lpHash( id, 1.0, uSeed );
		vec3 box = max( uBox, vec3( 1e-3 ) );
		float speed = abs( uVel.y ) * mix( 1.0 - uVelVar.y, 1.0 + uVelVar.y, r.w );
		vel = vec3( uVel.x, - speed, uVel.z ) + wind3 * uWindInfluence;
		vec3 p = r.xyz * box + vel * uTime;
		p.x += sin( uTime * uTurb.y + r.x * 43.0 ) * uTurb.x;
		p.z += cos( uTime * uTurb.y * 0.83 + r.z * 37.0 ) * uTurb.x;
		vec3 bmin = uOrigin - box * 0.5;
		vec3 rel = mod( p - bmin, box );
		wpos = bmin + rel;
		vec3 rn = rel / box;
		alpha *= smoothstep( 0.0, 0.05, rn.y ) * ( 1.0 - smoothstep( 0.8, 1.0, rn.y ) )
			* smoothstep( 0.0, 0.12, rn.x ) * ( 1.0 - smoothstep( 0.88, 1.0, rn.x ) )
			* smoothstep( 0.0, 0.12, rn.z ) * ( 1.0 - smoothstep( 0.88, 1.0, rn.z ) );
		size = mix( uSize.x, uSize.y, s.y );
		angle = s.w * 6.2831 + uSpin.x * uTime * ( s.x < 0.5 ? - 1.0 : 1.0 );
		age = uTime;
		t = 0.5;

	#else

		float life = max( mix( uLife.x, uLife.y, s.y ), 0.05 );
		#ifdef MOTION_FALL
			float fallSpeed = max( abs( uVel.y ) * mix( 1.0 - uVelVar.y, 1.0 + uVelVar.y, s.y ), 0.05 );
			life = max( uBox.y / fallSpeed, 0.05 );
		#endif
		float tt = uTime + s.z * life;
		float cycle = floor( tt / life );
		age = tt - cycle * life;
		t = age / life;
		vec4 r = lpHash( id, cycle + 2.0, uSeed + 17.0 );
		vec4 r2 = lpHash( id, cycle + 2.0, uSeed + 91.0 );
		vec3 spawn = uOrigin + ( r.xyz - 0.5 ) * uBox;

		#if defined( MOTION_DRIFT )

			float f = uTurb.y;
			vec3 wob = vec3(
				sin( uTime * f * ( 0.7 + r.w * 0.6 ) + r.x * 6.2831 ),
				sin( uTime * f * ( 0.5 + r2.x * 0.5 ) + r.y * 6.2831 ) * 0.5,
				cos( uTime * f * ( 0.6 + r2.y * 0.5 ) + r.z * 6.2831 ) ) * uTurb.x;
			vel = uVel + ( r2.xyz - 0.5 ) * 2.0 * uVelVar + wind3 * uWindInfluence;
			wpos = spawn + vel * age + wob;

		#elif defined( MOTION_FALL )

			spawn.y = uOrigin.y + uBox.y * 0.5;
			float sf = uTurb.y * ( 0.7 + 0.6 * r.w );
			wpos = spawn + vec3( 0.0, - fallSpeed * age, 0.0 ) + wind3 * uWindInfluence * age
				+ vec3( sin( age * sf + r.x * 6.2831 ), 0.0, cos( age * sf * 0.7 + r.z * 6.2831 ) * 0.6 ) * uTurb.x;
			vel = vec3( 0.0, - fallSpeed, 0.0 );
			tumble = mix( 1.0, cos( age * mix( uSpin.x, uSpin.y, r2.x ) * 1.3 + r2.y * 6.2831 ), uTumble );

		#else

			float ang = r.w * 6.2831;
			vec3 v0 = uVel + ( r2.xyz - 0.5 ) * 2.0 * uVelVar + vec3( cos( ang ), 0.0, sin( ang ) ) * uRadial * ( 0.4 + 0.6 * r2.w );
			float k = max( uDrag, 1e-3 );
			vec3 g = vec3( 0.0, uGravity, 0.0 ) + wind3 * uWindInfluence;
			float ek = exp( - k * age );
			float E = ( 1.0 - ek ) / k;
			wpos = spawn + v0 * E + g / k * ( age - E );
			vel = v0 * ek + g / k * ( 1.0 - ek );
			wpos += vec3( sin( age * uTurb.y + r.x * 6.2831 ), 0.0, cos( age * uTurb.y * 1.3 + r.y * 6.2831 ) ) * uTurb.x * t;
			tumble = mix( 1.0, cos( age * uSpin.y * 1.3 + r2.y * 6.2831 ), uTumble );

		#endif

		size = mix( uSize.x, uSize.y, r2.z ) * mix( 1.0, uSizeEnd, t );
		angle = r2.w * 6.2831 + mix( uSpin.x, uSpin.y, r.w ) * age * ( r2.x < 0.5 ? - 1.0 : 1.0 );
		col = mix( uColor0, uColor1, t );
		if ( uPaletteSize > 0.5 ) {
			int pIdx = int( min( floor( r2.z * uPaletteSize ), uPaletteSize - 1.0 ) );
			col = uPalette[ pIdx ];
		}
		s = r;

	#endif

#endif

	// life envelope
	float fadeIn = smoothstep( 0.0, max( uFade.x, 1e-4 ), t );
	float fadeOut = 1.0 - smoothstep( 1.0 - max( uFade.y, 1e-4 ), 1.0, t );
	alpha *= fadeIn * fadeOut;
	size *= mix( 1.0, sin( PI * clamp( t, 0.0, 1.0 ) ), uPulse );

	if ( uTwinkle > 0.0 ) {
		// max(): GPU sin() may overshoot -1 slightly; pow() of a negative base is NaN, and a NaN in the
		// HDR target spreads through bloom as black/white blocks
		float tw = pow( max( 0.5 + 0.5 * sin( uTime * ( 1.1 + s.x * 2.3 ) + s.z * 6.2831 ), 0.0 ), 14.0 );
		col *= 1.0 + uTwinkle * tw * 3.0;
		size *= 1.0 + uTwinkle * tw * 0.5;
	}
	if ( uBlink > 0.0 ) {
		float bl = smoothstep( 0.1, 0.95, sin( uTime * ( 0.8 + s.y * 1.3 ) + s.w * 6.2831 ) );
		alpha *= mix( 1.0, bl, uBlink );
		size *= mix( 1.0, 0.55 + 0.45 * bl, uBlink );
	}
	if ( uNightVis > 0.0 ) alpha *= smoothstep( 0.3, 0.85, uNight ) * uNightVis;
	else if ( uNightVis < 0.0 ) alpha *= 1.0 - uNight * ( - uNightVis );
	if ( uLit > 0.0 ) {
		vec3 amb = mix( vec3( 0.42, 0.45, 0.52 ), vec3( 0.06, 0.08, 0.15 ), uNight );
		col *= mix( vec3( 1.0 ), amb + uSunColor * 0.75, uLit );
	}
	if ( tumble < 0.0 ) col *= 0.78; // back side of a tumbling leaf
	alpha *= gate;

	vec4 mv = viewMatrix * vec4( wpos, 1.0 );
	vec2 corner = position.xy;
	vUv = uv;

#ifdef STREAK
	vec3 vv = ( viewMatrix * vec4( vel, 0.0 ) ).xyz;
	float vl = length( vv.xy );
	vec2 dir = vl > 1e-4 ? vv.xy / vl : vec2( 0.0, - 1.0 );
	vec2 side = vec2( - dir.y, dir.x );
	float len = size * uStretch.x + vl * uStretch.y;
	mv.xy += side * corner.x * size + dir * corner.y * len;
#else
	float tf = ( tumble >= 0.0 ? 1.0 : - 1.0 ) * max( abs( tumble ), 0.18 );
	corner.x *= tf;
	corner.y *= uStretch.x;
	float ca = cos( angle );
	float sa = sin( angle );
	mv.xy += vec2( corner.x * ca - corner.y * sa, corner.x * sa + corner.y * ca ) * size;
#endif

	gl_Position = projectionMatrix * mv;
	if ( alpha <= 0.002 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 ); // cull dead / hidden particles

	vColor = vec4( col, alpha );
	vVariant = floor( s.x * uVariants );

	#ifdef USE_FOG
		// the standard chunk (vFogDepth = -mvPosition.z), so a game that patches it — e.g. to start
		// the fog some distance in front of the camera — fogs particles like every other material
		vec4 mvPosition = mv;
		#include <fog_vertex>
	#endif
}
`;

const PARTICLE_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>

uniform sampler2D uMap;
uniform float uVariants;

varying vec2 vUv;
varying vec4 vColor;
varying float vVariant;

${GLSL_BAYER}

void main() {

#ifdef USE_PMAP
	vec4 tex = texture2D( uMap, vec2( ( min( vVariant, uVariants - 1.0 ) + vUv.x ) / uVariants, vUv.y ) );
#else
	float across = 1.0 - abs( vUv.x * 2.0 - 1.0 );
	vec4 tex = vec4( 1.0, 1.0, 1.0, smoothstep( 0.0, 1.0, vUv.y ) * smoothstep( 0.0, 0.7, across ) );
#endif

	vec4 outColor = vec4( vColor.rgb * tex.rgb, vColor.a * tex.a );

#ifdef CUTOUT
	if ( tex.a < 0.5 ) discard;
	if ( vColor.a < 0.999 && vColor.a <= lpBayer4( gl_FragCoord.xy ) ) discard;
	outColor.a = 1.0;
#else
	if ( outColor.a < 0.004 ) discard;
#endif

	gl_FragColor = outColor;

	#include <tonemapping_fragment>
	#include <colorspace_fragment>

	#ifdef USE_FOG
		#ifdef FOG_EXP2
			float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
		#else
			float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		#endif
		#ifdef ADDITIVE
			gl_FragColor.rgb *= 1.0 - fogFactor;
		#else
			gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
		#endif
	#endif
}
`;

// ---------------------------------------------------------------------------
// Procedural particle textures
// ---------------------------------------------------------------------------

function artRows(pc, ox, oy, rows, shades) {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const s = shades[row[x]];
      if (s) pc.set(ox + x, oy + y, [s[0] * 255, s[0] * 255, s[0] * 255, s[1] * 255]);
    }
  }
}

/** Pixel-art leaf / petal: rotated ellipse with shading, midrib and outline (greyscale, tinted in shader). */
function drawLeaf(pc, ox, cell, { angle, a, b, midrib, shades, stem }) {
  const cx = cell / 2 - 0.5;
  const cy = cell / 2 - 0.5;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const tmp = new PixelCanvas(cell, cell);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const u = dx * ca + dy * sa; // along
      const w = -dx * sa + dy * ca; // across
      // slightly pointed tip: narrower toward +u
      const bb = b * (1 - Math.max(0, u / a) * 0.35);
      const e = (u * u) / (a * a) + (w * w) / (bb * bb);
      if (e > 1) continue;
      let g = w < -0.35 ? shades.light : shades.mid;
      if (e > 0.62 && w > 0.2) g = shades.dark;
      if (midrib && Math.abs(w) < 0.45 && u > -a * 0.8 && u < a * 0.75) g = shades.rib;
      tmp.set(x, y, [g * 255, g * 255, g * 255, 255]);
    }
  }
  if (stem) {
    const sx = Math.round(cx - ca * (a + 0.6));
    const sy = Math.round(cy - sa * (a + 0.6));
    tmp.set(sx, sy, [shades.outline * 255, shades.outline * 255, shades.outline * 255, 255]);
  }
  const o = shades.outline * 255;
  tmp.outline([o, o, o, 255]);
  pc.blit(tmp, ox, 0);
}

/**
 * Build a procedural particle texture.
 * @param {string} kind
 * @returns {{ texture: THREE.Texture, variants: number }}
 */
function buildParticleTexture(kind) {
  switch (kind) {
    case 'glow': {
      const n = 32;
      const pc = new PixelCanvas(n, n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
          // wide soft halo + tight hot core (gaussians); ~0 at the quad edge so no square shows
          const a = clamp(0.8 * Math.exp(-d * d * 4.5) + 0.2 * Math.exp(-d * d * 40) - 0.009 * d, 0, 1);
          pc.set(x, y, [255, 255, 255, a * 255]);
        }
      }
      const texture = makePixelTexture(pc.toCanvas(), { wrap: 'clamp', mipmaps: true, srgb: true, name: 'particle_glow' });
      texture.magFilter = THREE.LinearFilter;
      return { texture, variants: 1 };
    }
    case 'square': {
      const pc = new PixelCanvas(8, 4);
      const sh = { b: [1, 0.55], d: [1, 1] };
      artRows(pc, 0, 0, ['.bb.', 'bddb', 'bddb', '.bb.'], sh);
      artRows(pc, 4, 0, ['....', '.dd.', '.dd.', '....'], sh);
      return { texture: makePixelTexture(pc.toCanvas(), { wrap: 'clamp', name: 'particle_square' }), variants: 2 };
    }
    case 'snow': {
      const pc = new PixelCanvas(8, 4);
      const sh = { a: [1, 0.4], b: [1, 0.8], d: [1, 1] };
      artRows(pc, 0, 0, ['.aa.', 'abba', 'abda', '.aa.'], sh);
      artRows(pc, 4, 0, ['....', '.bd.', '.db.', '....'], sh);
      return { texture: makePixelTexture(pc.toCanvas(), { wrap: 'clamp', name: 'particle_snow' }), variants: 2 };
    }
    case 'star': {
      const pc = new PixelCanvas(18, 9);
      const sh = { a: [1, 0.3], b: [1, 0.6], c: [1, 0.85], d: [1, 1] };
      artRows(pc, 0, 0, [
        '....a....',
        '....b....',
        '....c....',
        '...bdb...',
        'abcdddcba',
        '...bdb...',
        '....c....',
        '....b....',
        '....a....',
      ], sh);
      artRows(pc, 9, 0, [
        '.........',
        '.........',
        '..a...a..',
        '...bcb...',
        '...cdc...',
        '...bcb...',
        '..a...a..',
        '.........',
        '.........',
      ], sh);
      return { texture: makePixelTexture(pc.toCanvas(), { wrap: 'clamp', name: 'particle_star' }), variants: 2 };
    }
    case 'leaf': {
      const cell = 8;
      const pc = new PixelCanvas(cell * 4, cell);
      const shades = { light: 1.0, mid: 0.8, dark: 0.62, rib: 0.66, outline: 0.3 };
      drawLeaf(pc, 0, cell, { angle: -0.75, a: 3.1, b: 1.55, midrib: true, shades, stem: true });
      drawLeaf(pc, cell, cell, { angle: 0.6, a: 2.7, b: 1.7, midrib: true, shades, stem: true });
      drawLeaf(pc, cell * 2, cell, { angle: -1.35, a: 3.0, b: 1.35, midrib: false, shades, stem: true });
      drawLeaf(pc, cell * 3, cell, { angle: 2.3, a: 2.6, b: 1.9, midrib: true, shades, stem: false });
      return { texture: makePixelTexture(pc.toCanvas(), { wrap: 'clamp', name: 'particle_leaf' }), variants: 4 };
    }
    case 'petal': {
      const cell = 8;
      const pc = new PixelCanvas(cell * 4, cell);
      const shades = { light: 1.0, mid: 0.92, dark: 0.8, rib: 0.9, outline: 0.66 };
      drawLeaf(pc, 0, cell, { angle: -0.5, a: 2.2, b: 1.6, midrib: false, shades, stem: false });
      drawLeaf(pc, cell, cell, { angle: 0.9, a: 2.0, b: 1.4, midrib: false, shades, stem: false });
      drawLeaf(pc, cell * 2, cell, { angle: 2.0, a: 2.4, b: 1.3, midrib: false, shades, stem: false });
      drawLeaf(pc, cell * 3, cell, { angle: -1.8, a: 1.8, b: 1.5, midrib: false, shades, stem: false });
      return { texture: makePixelTexture(pc.toCanvas(), { wrap: 'clamp', name: 'particle_petal' }), variants: 4 };
    }
    case 'smoke': {
      const n = 32;
      const variants = 4;
      const pc = new PixelCanvas(n * variants, n);
      for (let v = 0; v < variants; v++) {
        const ox = v * n;
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            const dx = (x + 0.5 - n / 2) / (n / 2);
            const dy = (y + 0.5 - n / 2) / (n / 2);
            const nz = fbm2(x / 9 + v * 7.3, y / 9 + v * 3.1, { octaves: 3, seed: 71 + v });
            const d = Math.hypot(dx, dy) * 1.08 + (nz - 0.5) * 0.55;
            let a = clamp((0.95 - d) / 0.55, 0, 1);
            a = a * a * (3 - 2 * a);
            // quantise alpha into 5 dithered steps for a painterly pixel puff
            const q = clamp(Math.floor(a * 5 + bayer4(x, y) - 0.25), 0, 5) / 5;
            if (q <= 0) continue;
            // lit from above-left: lighter top, cooler/darker bottom
            const lightT = clamp(0.5 - dy * 0.35 - dx * 0.15 + (nz - 0.5) * 0.5, 0, 1);
            const g = 0.74 + Math.round(lightT * 3) / 3 * 0.26;
            pc.set(ox + x, y, [g * 255, g * 255, Math.min(1, g * 1.03) * 255, q * 255]);
          }
        }
      }
      const texture = makePixelTexture(pc.toCanvas(), { wrap: 'clamp', mipmaps: true, name: 'particle_smoke' });
      return { texture, variants };
    }
    default:
      return null; // 'streak' and unknown kinds are procedural in the shader
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


function toPair(v, fallback) {
  if (v == null) return fallback;
  if (Array.isArray(v)) return [v[0], v.length > 1 ? v[1] : v[0]];
  return [v, v];
}
function toVec3(v, fallback) {
  if (v == null) return new THREE.Vector3().fromArray(fallback);
  if (v.isVector3) return v.clone();
  if (Array.isArray(v)) return new THREE.Vector3(v[0], v[1], v[2]);
  return new THREE.Vector3(v, v, v);
}
/**
 * A colour parameter (preset or a particle area's `params`) as a linear THREE.Color × hdr. A name
 * three.js would resolve through Object.prototype ("constructor", "__proto__": black, KNOWN_ISSUES
 * LVL-19) acts like any unknown name: the target keeps its colour (white when new), with a warning.
 */
function linearColor(c, hdr = 1, target = new THREE.Color()) {
  return target.set(ownColor(c, THREE.Color.NAMES)).multiplyScalar(hdr);
}
const rangeRand = (rng, r) => r[0] + (r[1] - r[0]) * rng.next();

/** Merge preset + overrides into a resolved config. */
function resolveConfig(preset, overrides) {
  const base = ownValue(PARTICLE_PRESETS, preset);
  if (!base) throw new Error(`Particles: unknown preset "${preset}"`);
  const cfg = { ...DEFAULTS, ...base, ...overrides, preset };
  // `color` may be a pair [start, end]
  if (Array.isArray(overrides.color) && overrides.color.length === 2 && typeof overrides.color[0] !== 'number') {
    cfg.color = overrides.color[0];
    cfg.colorEnd = overrides.color[1];
  } else if (overrides.color != null && overrides.colorEnd === undefined) {
    cfg.colorEnd = null;
    if (overrides.colors === undefined) cfg.colors = null;
  }
  cfg.size = toPair(cfg.size, [0.1, 0.1]);
  cfg.life = toPair(cfg.life, [1, 2]);
  cfg.spin = toPair(cfg.spin, [0, 0]);
  cfg.fade = toPair(cfg.fade, [0.1, 0.3]);
  cfg.turbulence = toPair(cfg.turbulence, [0, 1]);
  cfg.burstSpeed = toPair(cfg.burstSpeed, [0.5, 1.5]);
  cfg.burstUp = toPair(cfg.burstUp, [0.5, 1.5]);
  return cfg;
}

function makeUniforms(cfg, texInfo) {
  const palette = [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()];
  let paletteSize = 0;
  if (Array.isArray(cfg.colors) && cfg.colors.length) {
    paletteSize = Math.min(4, cfg.colors.length);
    for (let i = 0; i < 4; i++) linearColor(cfg.colors[Math.min(i, paletteSize - 1)], cfg.hdr, palette[i]);
  }
  const c0 = linearColor(cfg.color, cfg.hdr);
  const c1 = cfg.colorEnd != null ? linearColor(cfg.colorEnd, cfg.hdr) : c0.clone();
  return {
    uTime: globalUniforms.uTime,
    uNight: globalUniforms.uNight,
    uWind: globalUniforms.uWind,
    uWindStrength: globalUniforms.uWindStrength,
    uSunColor: globalUniforms.uSunColor,
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uFogStart: globalUniforms.uFogStart,
    uMap: { value: texInfo ? texInfo.texture : null },
    uVariants: { value: texInfo ? texInfo.variants : 1 },
    uOrigin: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(1, 1, 1) },
    uSeed: { value: 1 },
    uCount: { value: 1 },
    uIntensity: { value: 1 },
    uLife: { value: new THREE.Vector2(cfg.life[0], cfg.life[1]) },
    uSize: { value: new THREE.Vector2(cfg.size[0], cfg.size[1]) },
    uSizeEnd: { value: cfg.sizeEnd },
    uStretch: { value: new THREE.Vector2(cfg.aspect, cfg.streak) },
    uVel: { value: toVec3(cfg.velocity, [0, 0, 0]) },
    uVelVar: { value: toVec3(cfg.velocityVariance, [0, 0, 0]) },
    uRadial: { value: cfg.radial },
    uGravity: { value: cfg.gravity },
    uDrag: { value: cfg.drag },
    uWindInfluence: { value: cfg.windInfluence },
    uTurb: { value: new THREE.Vector2(cfg.turbulence[0], cfg.turbulence[1]) },
    uSpin: { value: new THREE.Vector2(cfg.spin[0], cfg.spin[1]) },
    uTumble: { value: cfg.tumble },
    uColor0: { value: c0 },
    uColor1: { value: c1 },
    uPalette: { value: palette },
    uPaletteSize: { value: paletteSize },
    uAlpha: { value: cfg.alpha },
    uFade: { value: new THREE.Vector2(cfg.fade[0], cfg.fade[1]) },
    uTwinkle: { value: cfg.twinkle },
    uBlink: { value: cfg.blink },
    uNightVis: { value: cfg.nightVisibility },
    uLit: { value: typeof cfg.lit === 'boolean' ? (cfg.lit ? 1 : 0) : cfg.lit },
    uPulse: { value: cfg.pulse },
  };
}

function makeMaterial(cfg, uniforms, burst) {
  const defines = {};
  defines[`MOTION_${String(burst ? 'emit' : cfg.motion).toUpperCase()}`] = '';
  if (burst) defines.BURST = '';
  if (cfg.texture === 'streak' && !cfg.map) defines.STREAK = '';
  else defines.USE_PMAP = '';
  if (cfg.blending === 'additive') defines.ADDITIVE = '';
  if (cfg.blending === 'cutout') defines.CUTOUT = '';
  const cutout = cfg.blending === 'cutout';
  return new THREE.ShaderMaterial({
    name: `Particles.${cfg.preset}${burst ? '.burst' : ''}`,
    uniforms,
    defines,
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    transparent: !cutout,
    depthWrite: cutout,
    blending: cfg.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    fog: true,
  });
}

function makeQuadGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  g.setIndex(base.index);
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('uv', base.getAttribute('uv'));
  base.dispose();
  return g;
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

/**
 * A continuous GPU emitter (one draw call). Created with `Particles#createEmitter`.
 * Contract: `{ object, enabled, intensity, position, dispose() }`.
 */
class Emitter {
  constructor(system, config) {
    const cfg = resolveConfig(config.preset, config);
    this.system = system;
    /** Resolved configuration (preset + overrides). */
    this.config = cfg;
    this.preset = cfg.preset;
    this.followCamera = !!cfg.followCamera;
    this.followDistance = cfg.followDistance;

    // spawn shape
    const isArea = !!config.bounds || cfg.mode === 'area' || cfg.motion === 'precip';
    this.mode = isArea ? 'area' : 'point';
    const center = config.bounds?.center ?? config.position ?? new THREE.Vector3();
    /** Emitter origin (area centre for area emitters). Mutating it moves the emitter live. */
    this.position = center.isVector3
      ? center.clone()
      : Array.isArray(center)
        ? new THREE.Vector3().fromArray(center)
        : new THREE.Vector3(center.x ?? 0, center.y ?? 0, center.z ?? 0);
    const size = isArea ? (config.bounds?.size ?? cfg.bounds) : cfg.spawnSize;
    this.boxSize = toVec3(size, [1, 1, 1]);
    const hasCenter = !!config.bounds?.center;
    const originY = this.position.y;
    if (isArea && !hasCenter && config.position && cfg.motion !== 'precip') {
      // an area given only by `position` sits on that point (box bottom at position.y)
      this.position.y += this.boxSize.y * 0.5;
    }
    /** Ground height the camera-following box is anchored to. */
    this.followBaseY = hasCenter ? originY - this.boxSize.y * 0.5 : config.position ? originY : 0;

    // count
    let count = cfg.count;
    if (config.rate != null && cfg.motion !== 'precip') count = Math.ceil(config.rate * (cfg.life[0] + cfg.life[1]) * 0.5);
    this.count = Math.max(1, Math.round(count));

    // texture
    let texInfo = null;
    if (cfg.map) texInfo = { texture: cfg.map, variants: cfg.variants || 1 };
    else if (cfg.texture !== 'streak') texInfo = system._texture(cfg.texture);

    this.uniforms = makeUniforms(cfg, texInfo);
    this.uniforms.uOrigin.value = this.position;
    this.uniforms.uBox.value.copy(this.boxSize);
    this.uniforms.uSeed.value = config.seed ?? system._nextSeed(cfg.preset);
    this.uniforms.uCount.value = this.count;

    this.geometry = makeQuadGeometry();
    this.geometry.instanceCount = this.count;
    this.material = makeMaterial(cfg, this.uniforms, false);

    /** @type {THREE.Mesh} */
    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.name = `Emitter.${cfg.preset}`;
    this.object.renderOrder = RENDER_ORDER.PARTICLES + (cfg.blending === 'additive' ? 2 : 0);
    this.object.matrixAutoUpdate = false;
    this.object.castShadow = false;
    this.object.receiveShadow = false;
    this.object.frustumCulled = !this.followCamera;
    this._windKey = this._windStrength();
    this.geometry.boundingSphere = new THREE.Sphere(this.position.clone(), this._estimateRadius());
    this.geometry.boundingBox = null;

    this._enabled = true;
    this._intensity = 1;
    this.enabled = config.enabled ?? true;
    this.intensity = config.intensity ?? 1;
  }

  /** The global wind the culling radius depends on (|uWind| × max(1, uWindStrength)). */
  _windStrength() {
    return globalUniforms.uWind.value.length() * Math.max(1, globalUniforms.uWindStrength.value);
  }

  _estimateRadius() {
    const c = this.config;
    const L = c.life[1];
    const u = this.uniforms;
    const v0 = u.uVel.value.length() + u.uVelVar.value.length() + c.radial;
    const k = Math.max(c.drag, 1e-3);
    const wind = globalUniforms.uWind.value.length() * Math.max(1, globalUniforms.uWindStrength.value) * c.windInfluence;
    const acc = Math.abs(c.gravity) + wind;
    let travel = Math.min(v0 * L, v0 / k) + Math.min(0.5 * acc * L * L, (acc / k) * L);
    if (this.config.motion === 'fall') travel = wind * (this.boxSize.y / Math.max(0.05, Math.abs(u.uVel.value.y))) + c.turbulence[0];
    if (this.config.motion === 'drift') travel = (v0 + wind) * L + c.turbulence[0];
    const sizeMax = c.size[1] * Math.max(1, c.sizeEnd) * Math.max(1, c.aspect);
    return this.boxSize.length() * 0.5 + travel + sizeMax + 0.5;
  }

  /** Visibility toggle (the object stays in the scene). */
  get enabled() { return this._enabled; }
  set enabled(v) {
    this._enabled = !!v;
    this._refresh();
  }

  /** 0..1 multiplier: scales the live particle count (and fades alpha in over the lowest third). */
  get intensity() { return this._intensity; }
  set intensity(v) {
    this._intensity = Math.max(0, +v || 0);
    this.uniforms.uIntensity.value = this._intensity;
    this._refresh();
  }

  _refresh() {
    const n = Math.min(this.count, Math.ceil(this.count * Math.min(1, this._intensity)));
    this.geometry.instanceCount = n;
    this.object.visible = this._enabled && n > 0;
  }

  /** @internal per-frame (called by Particles#update) */
  _update(camera, cam) {
    if (this.followCamera && camera) {
      const baseY = this.followBaseY;
      let d = this.followDistance;
      if (cam.fy < -0.05) d = clamp((baseY - cam.py) / cam.fy, 2, 120);
      this.position.set(cam.px + cam.fx * d, baseY + this.boxSize.y * 0.5, cam.pz + cam.fz * d);
    }
    const bs = this.geometry.boundingSphere;
    bs.center.copy(this.position);
    // the wind carries leaves, petals, smoke and embers further than at creation (rain and snow
    // blow 2–5× harder): keep the culling sphere around everything the wind can reach, so a
    // frustum-culled emitter never pops at the screen edge
    if (this.object.frustumCulled) {
      const w = this._windStrength();
      if (Math.abs(w - this._windKey) > 0.02 * Math.max(1, this._windKey)) {
        this._windKey = w;
        bs.radius = this._estimateRadius();
      }
    }
  }

  dispose() {
    if (this.object.parent) this.object.parent.remove(this.object);
    this.geometry.dispose();
    this.material.dispose();
    const list = this.system.emitters;
    const i = list.indexOf(this);
    if (i >= 0) list.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Burst pool (ring buffer, GPU-animated)
// ---------------------------------------------------------------------------

class BurstPool {
  constructor(system, cfg, capacity = 512) {
    this.capacity = capacity;
    this.head = 0;
    this.used = 0;
    this.aliveUntil = -Infinity;

    let texInfo = null;
    if (cfg.map) texInfo = { texture: cfg.map, variants: cfg.variants || 1 };
    else if (cfg.texture !== 'streak') texInfo = system._texture(cfg.texture);
    this.uniforms = makeUniforms(cfg, texInfo);

    const g = makeQuadGeometry();
    const mk = () => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aOrigin = mk();
    this.aVel = mk();
    this.aSize = mk();
    this.aColor = mk();
    this.aPhys = mk();
    // birth far in the past → all dead
    for (let i = 0; i < capacity; i++) this.aOrigin.array[i * 4 + 3] = -1e6;
    g.setAttribute('aOrigin', this.aOrigin);
    g.setAttribute('aVel', this.aVel);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aColor', this.aColor);
    g.setAttribute('aPhys', this.aPhys);
    g.instanceCount = 0;
    this.geometry = g;
    this.material = makeMaterial(cfg, this.uniforms, true);
    this.object = new THREE.Mesh(g, this.material);
    this.object.name = `Particles.burst.${cfg.texture}.${cfg.blending}`;
    this.object.frustumCulled = false;
    this.object.matrixAutoUpdate = false;
    this.object.renderOrder = RENDER_ORDER.PARTICLES + (cfg.blending === 'additive' ? 3 : 1);
    this.object.visible = false;
    this._dirtyStart = Infinity;
    this._dirtyEnd = -1;
  }

  write(ox, oy, oz, birth, vx, vy, vz, life, size, sizeEnd, rot, spin, r, g, b, a, grav, drag, wind, seed) {
    const i = this.head;
    const j = i * 4;
    let arr = this.aOrigin.array; arr[j] = ox; arr[j + 1] = oy; arr[j + 2] = oz; arr[j + 3] = birth;
    arr = this.aVel.array; arr[j] = vx; arr[j + 1] = vy; arr[j + 2] = vz; arr[j + 3] = life;
    arr = this.aSize.array; arr[j] = size; arr[j + 1] = sizeEnd; arr[j + 2] = rot; arr[j + 3] = spin;
    arr = this.aColor.array; arr[j] = r; arr[j + 1] = g; arr[j + 2] = b; arr[j + 3] = a;
    arr = this.aPhys.array; arr[j] = grav; arr[j + 1] = drag; arr[j + 2] = wind; arr[j + 3] = seed;
    if (i < this._dirtyStart) this._dirtyStart = i;
    if (i + 1 > this._dirtyEnd) this._dirtyEnd = i + 1;
    this.head = (i + 1) % this.capacity;
    this.used = Math.max(this.used, i + 1);
    if (birth + life > this.aliveUntil) this.aliveUntil = birth + life;
  }

  flush() {
    if (this._dirtyEnd < 0) return;
    const start = this._dirtyStart * 4;
    const count = (this._dirtyEnd - this._dirtyStart) * 4;
    for (const attr of [this.aOrigin, this.aVel, this.aSize, this.aColor, this.aPhys]) {
      attr.addUpdateRange(start, count);
      attr.needsUpdate = true;
    }
    this._dirtyStart = Infinity;
    this._dirtyEnd = -1;
    this.geometry.instanceCount = this.used;
    this.object.visible = true;
  }

  dispose() {
    if (this.object.parent) this.object.parent.remove(this.object);
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

export class Particles {
  /** @param {THREE.Scene|THREE.Object3D} scene parent for all particle objects */
  constructor(scene) {
    this.scene = scene;
    /** Group holding every emitter / burst mesh. */
    this.object = new THREE.Group();
    this.object.name = 'Particles';
    if (scene) scene.add(this.object);
    /** @type {Emitter[]} */
    this.emitters = [];
    this._pools = new Map();
    this._poolList = [];
    this._burstConfigs = new Map();
    this._textures = new Map();
    this._rng = new RNG(0x51a7);
    this._emitterCounter = 0;
    this._cam = { px: 0, py: 0, pz: 0, fx: 0, fy: -1, fz: 0 };
  }

  /** @internal cached procedural texture by kind */
  _texture(kind) {
    let t = this._textures.get(kind);
    if (t === undefined) {
      t = buildParticleTexture(kind);
      this._textures.set(kind, t);
    }
    return t;
  }

  /** @internal deterministic per-emitter seed */
  _nextSeed(preset) {
    this._emitterCounter++;
    return (hashString(preset) + this._emitterCounter * 7919) % 1000003;
  }

  /**
   * Create a continuous emitter. `bounds` makes it an area emitter: `{ center, size }` (a missing
   * centre falls back to `position`, a missing size to the preset's box), or an array `[x, y, z]`,
   * the box size alone, which resolveConfig merges over the preset's `bounds`.
   * @param {{ preset: keyof typeof PARTICLE_PRESETS, position?: THREE.Vector3,
   *           bounds?: {center?: THREE.Vector3, size?: THREE.Vector3|number[]}|number[],
   *           count?: number, rate?: number, color?: THREE.ColorRepresentation|THREE.ColorRepresentation[],
   *           size?: number|number[], followCamera?: boolean, intensity?: number, enabled?: boolean,
   *           map?: THREE.Texture, variants?: number, seed?: number }
   *   & Omit<Partial<typeof DEFAULTS>, 'bounds' | 'color' | 'size'>} config
   *   (preset overrides: any DEFAULTS key)
   * @returns {Emitter} `{ object, enabled, intensity, position, dispose() }`
   */
  createEmitter(config) {
    const e = new Emitter(this, config);
    this.emitters.push(e);
    this.object.add(e.object);
    return e;
  }

  /** @internal ring-buffer pool shared by bursts with the same material state */
  _pool(cfg) {
    // every uniform the BURST shader path reads must be part of the key (the pool's uniforms come
    // from the first config that created it)
    const key = `${cfg.map ? cfg.map.uuid : cfg.texture}|${cfg.variants}|${cfg.blending}|${+cfg.lit}|${cfg.pulse}|${cfg.tumble}|${cfg.aspect}|${cfg.streak}|${cfg.fade[0]}|${cfg.fade[1]}|${cfg.twinkle}|${cfg.blink}|${cfg.nightVisibility}`;
    let pool = this._pools.get(key);
    if (!pool) {
      pool = new BurstPool(this, cfg);
      this._pools.set(key, pool);
      this._poolList.push(pool);
      this.object.add(pool.object);
    }
    return pool;
  }

  /** @internal resolved burst config (cached for override-free calls, so footsteps allocate nothing) */
  _burstConfig(preset, overrides) {
    let hasOverrides = false;
    for (const k in overrides) { hasOverrides = true; break; } // eslint-disable-line no-unused-vars
    if (!hasOverrides) {
      const cached = this._burstConfigs.get(preset);
      if (cached) return cached;
    }
    const cfg = resolveConfig(preset, overrides);
    cfg._spawn = toVec3(cfg.spawnSize, [0.2, 0.2, 0.2]);
    cfg._vel = toVec3(cfg.velocity, [0, 0, 0]);
    cfg._velVar = toVec3(cfg.velocityVariance, [0, 0, 0]);
    cfg._color = linearColor(cfg.color, cfg.hdr);
    cfg._palette = Array.isArray(cfg.colors) && cfg.colors.length ? cfg.colors.map((c) => linearColor(c, cfg.hdr)) : null;
    cfg._lit = typeof cfg.lit === 'boolean' ? (cfg.lit ? 1 : 0) : cfg.lit;
    cfg._pool = this._pool(cfg);
    if (!hasOverrides) this._burstConfigs.set(preset, cfg);
    return cfg;
  }

  /**
   * One-shot burst (e.g. 'footstep', 'splash', 'sparkle'; any preset works).
   * @param {string} preset
   * @param {THREE.Vector3|{x:number,y:number,z:number}} position
   * @param {number} [count=12]
   * @param {object} [overrides] any preset parameter (color, size, burstSpeed, life, …)
   */
  burst(preset, position, count = 12, overrides = {}) {
    const cfg = this._burstConfig(preset, overrides);
    const pool = cfg._pool;
    const rng = this._rng;
    const now = globalUniforms.uTime.value;
    const vel = cfg._vel;
    const vv = cfg._velVar;
    const ss = cfg._spawn;
    const palette = cfg._palette;
    const c0 = cfg._color;
    const n = Math.max(0, Math.min(pool.capacity, count | 0));
    for (let i = 0; i < n; i++) {
      const ang = rng.next() * Math.PI * 2;
      const sp = rangeRand(rng, cfg.burstSpeed);
      const up = rangeRand(rng, cfg.burstUp);
      const vx = Math.cos(ang) * sp + vel.x + (rng.next() * 2 - 1) * vv.x;
      const vy = up + vel.y + (rng.next() * 2 - 1) * vv.y;
      const vz = Math.sin(ang) * sp + vel.z + (rng.next() * 2 - 1) * vv.z;
      let life = rangeRand(rng, cfg.life);
      if (cfg.ballistic && cfg.gravity < 0 && vy > 0) life = Math.min(life, (2 * vy) / -cfg.gravity * 0.95);
      const col = palette ? palette[Math.floor(rng.next() * palette.length)] : c0;
      const spin = rangeRand(rng, cfg.spin) * (rng.next() < 0.5 ? -1 : 1);
      pool.write(
        position.x + (rng.next() - 0.5) * ss.x,
        position.y + (rng.next() - 0.5) * ss.y,
        position.z + (rng.next() - 0.5) * ss.z,
        now,
        vx, vy, vz, life,
        rangeRand(rng, cfg.size), cfg.sizeEnd, rng.next() * Math.PI * 2, spin,
        col.r, col.g, col.b, cfg.alpha,
        cfg.gravity, cfg.drag, cfg.windInfluence, rng.next(),
      );
    }
    pool.flush();
  }

  /**
   * The burst pools created so far, in creation order (a copy: opaque handles for
   * `releaseBurstPools`).
   * @returns {BurstPool[]}
   */
  burstPools() {
    return this._poolList.slice();
  }

  /**
   * Dispose burst pools (handles from `burstPools`): their meshes leave the scene, their geometry and
   * material are freed — a program no other material uses goes with them — and the resolved burst
   * configs that pointed at them are forgotten, so the next burst of such a preset creates its pool
   * anew. A combat level's own pools are released when combat is disposed (a campaign's next,
   * peaceful level keeps its own program count: KNOWN_ISSUES CMP-05).
   * @param {Iterable<BurstPool>} pools
   */
  releaseBurstPools(pools) {
    const drop = new Set(pools);
    if (!drop.size) return;
    // (deleting from a Map while iterating it is safe: entries not reached yet are skipped)
    for (const [key, pool] of this._pools) if (drop.has(pool)) this._pools.delete(key);
    for (const [key, cfg] of this._burstConfigs) if (drop.has(cfg._pool)) this._burstConfigs.delete(key);
    for (let i = this._poolList.length - 1; i >= 0; i--) if (drop.has(this._poolList[i])) this._poolList.splice(i, 1);
    for (const pool of drop) pool.dispose();
  }

  /**
   * Per-frame: camera-following emitters, culling spheres, burst pool visibility.
   * @param {number} dt
   * @param {THREE.Camera} [camera]
   */
  update(dt, camera) {
    const cam = this._cam;
    if (camera) {
      const e = camera.matrixWorld.elements;
      cam.px = e[12]; cam.py = e[13]; cam.pz = e[14];
      cam.fx = -e[8]; cam.fy = -e[9]; cam.fz = -e[10];
    }
    for (let i = 0; i < this.emitters.length; i++) this.emitters[i]._update(camera, cam);
    const now = globalUniforms.uTime.value;
    const pools = this._poolList;
    for (let i = 0; i < pools.length; i++) {
      const pool = pools[i];
      if (pool.object.visible && now > pool.aliveUntil + 0.05) pool.object.visible = false;
    }
  }

  dispose() {
    for (const e of this.emitters.slice()) e.dispose();
    this.emitters.length = 0;
    for (const p of this._poolList) p.dispose();
    this._pools.clear();
    this._poolList.length = 0;
    this._burstConfigs.clear();
    for (const t of this._textures.values()) if (t) t.texture.dispose();
    this._textures.clear();
    if (this.object.parent) this.object.parent.remove(this.object);
  }
}

export { Emitter };
