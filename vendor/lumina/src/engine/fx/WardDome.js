import * as THREE from 'three';
import { globalUniforms } from '../render/GlobalUniforms.js';

/**
 * WardDome — a 3D ward dome for combat spells (the greatshield's Bulwark): one hemisphere drawn as
 * a hex lattice of light, cut-out (solid or gone, never blended), depth-writing, unlit, fogged, no
 * shadow. Combat-only (COMBAT_PURE): created by the greatshield's look
 * (src/game/party/EarthSpellFx.js `EarthStage`), only on a level where a greatshield can fight. One
 * dome at a time (a second `show` moves it).
 *
 * API:
 *  - `object`: add to the scene; one draw call while shown, none hidden.
 *  - `show({ x, y, z, radius })`: the dome over (x, z), its base at y, `radius` u wide, 0.8 ×
 *    `radius` tall; it starts unrisen (`rise` 0).
 *  - `set({ rise, dissolve, sweepA, sweepB })`: rise 0 … 1 (it grows up from its base ring with a
 *    lit leading row), dissolve 0 … 1 (it dissolves top-down in a Bayer dither), sweepA / sweepB
 *    the heights (0 … 1 of the dome; < 0: none) of two highlight bands sweeping up it.
 *  - `hide()`, `shown`, `artPx` (screen pixels per art pixel: the lines' minimum width), `warm()` /
 *    `unwarm()` (shown far below the world for the warm-up), `dispose()`.
 *
 * The look (all in the fragment shader):
 *  - a hex lattice in surface texels (16 per u along the base's arc and the meridian), cells about
 *    16 texels (1 u) across (a whole number round the base: no seam), lines 2 texels wide, snapped
 *    to the texel grid and widened where the surface is seen edge-on so they never get thinner than
 *    one art pixel (no shimmer at the silhouette) — the cells read at the 30 u game camera;
 *  - by the fresnel term f = 1 − |n·v| (the view's angle to the surface): f > 0.78 the rim band —
 *    lit lines, and above 1.4 u a 25 % dithered fill —; 0.5 … 0.78 body lines; below 0.5 open, so
 *    the dome's middle and its near base stay clear: the foes and the party inside read through it;
 *  - a 2-texel base ring; on the camera's half of the dome 4 cells in 10 left out whole (a hash per
 *    cell: whole hexes stay, never a dither of loose texels — that broke the near lines into blue
 *    confetti);
 *  - colours: lines `BODY` (0.06, 0.18, 0.55), the rim band, the sweeps and the leading row `LIT`
 *    (0.15, 0.4, 1.25) — azure, under the halo's gate, a little bloom from the lit blue —, both ×
 *    0.55 at night (the exposure rises: an unlit dome would turn white).
 * Program: `luminati-warddome-v1` (compiled by the warm-up).
 */

/** The lattice's cells (texels across, before fitting a whole number round the base). */
const CELL = 16;
/** The share of the cells on the camera's half that stay. */
const NEAR_KEEP = 0.6;
/** The dome's height over its radius. */
const HEIGHT = 0.8;

const VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

varying vec3 vWd;   // world position
varying vec3 vNd;   // world normal (the ellipsoid's)
varying vec3 vPd;   // unit-hemisphere position

void main() {
	vec4 wp = modelMatrix * vec4( position, 1.0 );
	vWd = wp.xyz;
	vPd = position;
	vNd = normalize( normal * vec3( 1.0, 1.0 / ${HEIGHT.toFixed(2)}, 1.0 ) );
	vec4 mvPosition = viewMatrix * wp;
	gl_Position = projectionMatrix * mvPosition;
	#include <fog_vertex>
}
`;

const FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>

uniform float uRadius;
uniform vec2 uCell;      // the cell's width in texels (fitted round the base), the meridian's texels per radian
uniform float uCells;    // cells round the base (a whole number)
uniform float uRise;
uniform float uDissolve;
uniform vec2 uSweep;     // two highlight bands' heights (0 … 1; < 0 none)
uniform float uArtPx;
uniform float uNight;
uniform vec3 uCentre;

varying vec3 vWd;
varying vec3 vNd;
varying vec3 vPd;

const vec3 WARD_BODY = vec3( 0.06, 0.18, 0.55 );
const vec3 WARD_LIT = vec3( 0.15, 0.40, 1.25 );

float wdBayer( vec2 p ) {
	ivec2 q = ivec2( mod( floor( p ), 4.0 ) );
	const float M[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
	return ( M[ q.y * 4 + q.x ] + 0.5 ) / 16.0;
}

// the distance (cell units) from a point to its nearest hex cell's edge (flat sides left / right);
// cell: that cell's id (whole numbers: twice its centre's x, its row)
float wdHexEdge( vec2 uv, out vec2 cell ) {
	const vec2 r = vec2( 1.0, 1.7320508 );
	const vec2 hh = r * 0.5;
	vec2 a = mod( uv, r ) - hh;
	vec2 b = mod( uv - hh, r ) - hh;
	vec2 g = dot( a, a ) < dot( b, b ) ? a : b;
	vec2 c = uv - g;
	cell = floor( vec2( c.x * 2.0, c.y / 0.8660254 ) + 0.5 );
	float d = max( dot( abs( g ), normalize( r ) ), abs( g.x ) );
	return 0.5 - d;
}

float wdHash( vec2 id ) {
	return fract( sin( dot( id, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
}

void main() {
	// surface texels: along the base's arc (the azimuth × the radius) and up the meridian
	float az = atan( vPd.z, vPd.x );
	float el = asin( clamp( vPd.y, 0.0, 1.0 ) );
	vec2 s = vec2( az * uRadius * 16.0, el * uCell.y );
	vec2 tc = floor( s ) + 0.5;
	float h = vWd.y - uCentre.y;                 // height above the base (u)
	float top = uRadius * ${HEIGHT.toFixed(2)};
	float hn = h / top;
	// the rise: nothing above it; its leading row lit
	float riseH = uRise * top;
	if ( h > riseH ) discard;
	bool lead = uRise < 0.999 && riseH - h < 1.5 / 16.0;
	// the view's angle to the surface
	vec3 vd = normalize( cameraPosition - vWd );
	float f = 1.0 - abs( dot( vNd, vd ) );
	// texels per screen pixel here (world derivative: no seam), the lines' width in texels
	float tp = length( fwidth( vWd ) ) * 16.0;
	float lineW = max( 2.0, uArtPx * tp );
	vec2 cell;
	float edge = wdHexEdge( tc / uCell.x, cell ) * uCell.x;
	bool line = edge < 0.5 * lineW;
	// (round the base the ids wrap: the cells on the azimuth's seam are one)
	cell.x = mod( cell.x, 2.0 * uCells );
	bool base = h * 16.0 < 2.0;
	float bay = wdBayer( tc );
	// the sweeps: lines inside a band light up, and the band shows a little further in
	float band = min( abs( hn - uSweep.x ), abs( hn - uSweep.y ) ) * top * 16.0;
	bool swept = band < 1.6;
	vec3 col;
	if ( base ) col = WARD_BODY;
	else if ( lead && f > 0.35 ) col = WARD_LIT;
	else if ( f > 0.78 ) {
		if ( line ) col = WARD_LIT;
		else if ( h > 1.4 && bay < 0.25 ) col = WARD_BODY;
		else discard;
	} else if ( f > 0.5 || ( swept && f > 0.4 ) ) {
		if ( !line ) discard;
		col = swept ? WARD_LIT : WARD_BODY;
	} else discard;
	// the camera's half of the dome: whole cells left out by a hash, so whole hexes stay
	vec2 toCam = cameraPosition.xz - uCentre.xz;
	if ( dot( vNd.xz, toCam ) > 0.0 && wdHash( cell ) >= ${NEAR_KEEP.toFixed(2)} ) discard;
	// the dissolve, top-down
	float gone = clamp( ( hn - ( 1.0 - uDissolve * 1.35 ) ) / 0.3, 0.0, 1.0 );
	if ( gone > 0.0 && bay < gone ) discard;
	col *= mix( 1.0, 0.55, uNight );
	gl_FragColor = vec4( col, 1.0 );

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}
`;

export class WardDome {
  constructor() {
    const geo = new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    /** Shader uniforms. @type {Record<string, THREE.IUniform>} */
    this.uniforms = {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uFogStart: globalUniforms.uFogStart,
      uNight: globalUniforms.uNight,
      uRadius: { value: 3 },
      uCell: { value: new THREE.Vector2(CELL, 16 * 3 * 0.9) },
      uCells: { value: 18 },
      uRise: { value: 0 },
      uDissolve: { value: 0 },
      uSweep: { value: new THREE.Vector2(-9, -9) },
      uArtPx: { value: 2 },
      uCentre: { value: new THREE.Vector3() },
    };
    this.material = new THREE.ShaderMaterial({
      name: 'WardDome',
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      fog: true,
    });
    this.material.customProgramCacheKey = () => 'luminati-warddome-v1';
    this.object = new THREE.Mesh(geo, this.material);
    this.object.name = 'fx:wardDome';
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.castShadow = false;
    this.object.receiveShadow = false;
    this._warm = false;
  }

  /** Shown now. */
  get shown() { return this.object.visible; }

  /** Screen pixels per art pixel (the lines' minimum width). */
  get artPx() { return this.uniforms.uArtPx.value; }
  set artPx(v) { this.uniforms.uArtPx.value = Math.max(1, v | 0); }

  /**
   * The dome over (x, z), its base at y, `radius` u (0.8 × as tall), unrisen.
   * @param {{ x: number, y: number, z: number, radius: number }} o
   */
  show(o) {
    const R = Math.max(0.5, o.radius);
    const u = this.uniforms;
    u.uRadius.value = R;
    // a whole number of cells round the base (the azimuth's seam stays invisible)
    const around = Math.PI * 2 * R * 16;
    const cells = Math.max(6, Math.round(around / CELL));
    u.uCell.value.set(around / cells, 16 * R * (0.5 + 0.5 * HEIGHT));
    u.uCells.value = cells;
    u.uCentre.value.set(o.x, o.y, o.z);
    u.uRise.value = 0;
    u.uDissolve.value = 0;
    u.uSweep.value.set(-9, -9);
    this.object.position.set(o.x, o.y, o.z);
    this.object.scale.set(R, R * HEIGHT, R);
    this.object.updateMatrix();
    this.object.updateMatrixWorld(true);
    this.object.visible = true;
  }

  /** @param {{ rise?: number, dissolve?: number, sweepA?: number, sweepB?: number }} p */
  set(p) {
    const u = this.uniforms;
    if (p.rise !== undefined) u.uRise.value = Math.max(0, Math.min(1, p.rise));
    if (p.dissolve !== undefined) u.uDissolve.value = Math.max(0, Math.min(1, p.dissolve));
    if (p.sweepA !== undefined) u.uSweep.value.x = p.sweepA;
    if (p.sweepB !== undefined) u.uSweep.value.y = p.sweepB;
  }

  /** Gone (no draw call). */
  hide() {
    this.object.visible = false;
  }

  /** Shown far below the world, fully risen (the warm-up draws and compiles it). */
  warm() {
    this.show({ x: 0, y: -500, z: 0, radius: 3 });
    this.set({ rise: 1 });
    this._warm = true;
  }

  /** End the warm-up dome. */
  unwarm() {
    if (!this._warm) return;
    this._warm = false;
    this.hide();
  }

  dispose() {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.material.dispose();
  }
}
