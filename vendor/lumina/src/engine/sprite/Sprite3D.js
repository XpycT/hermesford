import * as THREE from 'three';
import { PPU, DIRECTIONS, RENDER_ORDER } from '../constants.js';
import { globalUniforms } from '../render/GlobalUniforms.js';
import { showValue } from '../utils/own.js';

/** @import { Direction } from '../constants.js' */

/**
 * Animation names `play()` has warned about (once per name for the whole page, whatever sprite
 * asked: a crowd of villagers playing the same missing animation warns once, and a second,
 * different unknown name on one sprite still warns).
 * @type {Set<unknown>}
 */
const WARNED_ANIMATIONS = new Set();

/**
 * Sprite3D — an animated, lit, shadow-casting pixel-art billboard (2.5D character sprite).
 *
 * Structure (all children of this Group, whose origin is the character's feet):
 *   - `mesh`        the visible quad (lit MeshLambertMaterial patched for sprite lighting)
 *   - `shadowProxy` shadow-only quad that turns to face the sun ('sunFacing' shadow mode)
 *   - `blob`        soft contact-shadow ellipse decal on the ground
 *
 * Lighting model (shared with Foliage through `patchSpriteLighting`):
 *   - the shading normal is bent toward a blend of "toward camera" and "world up", plus a small
 *     horizontal "roundness" across the sprite so side lights (lanterns) rim one side;
 *   - wrap diffuse ((N·L + w) / (1 + w)) so sprites never go black when the sun is behind them;
 *   - shadows are received with a self-shadow-free lookup: the lookup position is pushed toward
 *     the sun just past the sprite's own sun-facing proxy plane.
 */

// ---------------------------------------------------------------------------
// Shared GLSL
// ---------------------------------------------------------------------------

/** GLSL: 4x4 ordered-dither threshold in (0, 1) for a (pixel) coordinate. */
export const GLSL_BAYER4 = /* glsl */ `
float luminatiBayer4( vec2 p ) {
	ivec2 q = ivec2( mod( floor( p ), 4.0 ) );
	const float M[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
	return ( M[ q.y * 4 + q.x ] + 0.5 ) / 16.0;
}
`;

/** Replacement for `lights_lambert_pars_fragment` with wrap diffuse. */
const GLSL_WRAP_LAMBERT = /* glsl */ `
varying vec3 vViewPosition;
uniform float uWrap;

struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};

void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = dot( geometryNormal, directLight.direction );
	float wrapped = saturate( ( dotNL + uWrap ) / ( 1.0 + uWrap ) );
	reflectedLight.directDiffuse += wrapped * directLight.color * BRDF_Lambert( material.diffuseColor );
}

void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}

#define RE_Direct RE_Direct_Lambert
#define RE_IndirectDiffuse RE_IndirectDiffuse_Lambert
`;

/** Bent sprite normal in view space (inserted after normal_fragment_maps). */
const GLSL_BENT_NORMAL = /* glsl */ `
	{
		vec3 lnUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
		vec3 lnCam = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
		vec3 lnN = normalize( mix( lnCam, lnUp, uNormalUp ) );
		lnN = normalize( lnN + vec3( ( vQuadUv.x * 2.0 - 1.0 ) * uRoundness, 0.0, 0.0 ) );
		normal = lnN;
		nonPerturbedNormal = lnN;
	}
`;

/**
 * Shadow lookup offset (wraps `shadowmap_vertex`). Pushes the receiver position toward the sun
 * past the vertical plane through `LUMINATI_SHADOW_CENTER` that faces the sun (where the object's
 * own sun-facing shadow proxy lives), so a billboard never shadows itself. The per-vertex value is
 * conservative (the max(0, ·) term is convex, so linear interpolation over-estimates it).
 */
const GLSL_SHADOW_LOOKUP = /* glsl */ `
#ifdef USE_SHADOWMAP
	vec4 luminatiSavedWorldPosition = worldPosition;
	{
		vec3 lsH = vec3( uSunDirection.x, 0.0, uSunDirection.z );
		float lsLen = length( lsH );
		vec3 lsN = lsH / max( lsLen, 1e-4 );
		float lsSd = dot( worldPosition.xyz - ( LUMINATI_SHADOW_CENTER ), lsN );
		float lsSkip = max( 0.0, - lsSd ) / max( lsLen, 0.25 ) * uShadowSkip + uShadowSkipBias;
		worldPosition.xyz += uSunDirection * lsSkip;
	}
#endif
#include <shadowmap_vertex>
#ifdef USE_SHADOWMAP
	worldPosition = luminatiSavedWorldPosition;
#endif
`;

/**
 * Patch a MeshLambertMaterial shader (inside onBeforeCompile) with Luminati sprite lighting:
 * bent normals, wrap diffuse and a self-shadow-free shadow lookup.
 * `uniforms` must contain: uNormalUp, uWrap, uRoundness, uShadowSkip, uShadowSkipBias
 * (uSunDirection is taken from globalUniforms).
 * @param {{ vertexShader: string, fragmentShader: string,
 *   uniforms: Record<string, THREE.IUniform> }} shader
 * @param {Record<string, {value:any}>} uniforms
 * @param {{ shadowCenter?: string }} [opts] GLSL expression for the world-space proxy centre
 */
export function patchSpriteLighting(shader, uniforms, { shadowCenter = 'modelMatrix[ 3 ].xyz' } = {}) {
  Object.assign(shader.uniforms, uniforms);
  shader.uniforms.uSunDirection = globalUniforms.uSunDirection;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec2 vQuadUv;
uniform vec3 uSunDirection;
uniform float uShadowSkip;
uniform float uShadowSkipBias;
#define LUMINATI_SHADOW_CENTER ${shadowCenter}`,
    )
    .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvQuadUv = uv;')
    .replace('#include <shadowmap_vertex>', GLSL_SHADOW_LOOKUP);
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec2 vQuadUv;
uniform float uNormalUp;
uniform float uRoundness;`,
    )
    .replace('#include <lights_lambert_pars_fragment>', GLSL_WRAP_LAMBERT)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${GLSL_BENT_NORMAL}`);
}

/** three's light loop with each point light × (1 − the hit flash) (`patchCombatFx`). */
const POINT_LIGHT_INFO = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
if (!THREE.ShaderChunk.lights_fragment_begin.includes(POINT_LIGHT_INFO)) throw new Error('Sprite3D: three\'s lights_fragment_begin changed (the point lights under a hit flash)');
const LIGHTS_UNDER_FLASH = THREE.ShaderChunk.lights_fragment_begin
  .replace(POINT_LIGHT_INFO, `${POINT_LIGHT_INFO}\n\t\tdirectLight.color *= 1.0 - uFlash.a;`);

/**
 * Combat fx additions to the lit sprite shader (program `luminati-sprite3d-lit-fx-v1`, COMBAT.md §10.1),
 * applied after the regular lit patch:
 *   - selective glow: texels painted with alpha 204 (< 0.98 after the 0.5 alpha test) add
 *     `uGlow.rgb * uGlow.a` × their own colour as emissive (eyes, magma cracks, staff gems);
 *   - highlight (wind-up pulse, elite shimmer): after `opaque_fragment` the lit colour `c` becomes
 *     `c + (c · uHighlight.rgb · k + uHighlight.rgb · 0.035) · uHighlight.a` — it brightens and
 *     colours the texel's **own** shading instead of replacing it, so the pose keeps its detail
 *     (a mix toward an HDR colour flattens sprites whose linear colours are 0.05–0.3 into a flat
 *     silhouette, KNOWN_ISSUES COMBAT-03); `k` fades out above luminance 0.45 so glow texels and
 *     sunlit highlights do not bloom into a glare;
 *   - hit flash: then the colour is mixed toward `uFlash.rgb` by `uFlash.a` (a short silhouette
 *     flash; linear HDR, before fog; tone mapping happens later in PostFX). While it is up the
 *     point lights (the lamps and the combat VFX lights) reach the sprite × (1 − `uFlash.a`): a
 *     spell's light over a struck foe no longer lifts the part the flash leaves, so the flash does
 *     not bloom wider under it (KNOWN_ISSUES COMBAT-27).
 * @param {{fragmentShader:string, uniforms:Record<string, THREE.IUniform>}} shader
 * @param {Record<string, {value:any}>} u sprite uniforms holding `uFlash`, `uGlow` and `uHighlight` (THREE.Vector4)
 */
function patchCombatFx(shader, u) {
  shader.uniforms.uFlash = u.uFlash;
  shader.uniforms.uGlow = u.uGlow;
  shader.uniforms.uHighlight = u.uHighlight;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec4 uFlash;\nuniform vec4 uGlow;\nuniform vec4 uHighlight;')
    .replace('#include <lights_fragment_begin>', LIGHTS_UNDER_FLASH)
    .replace(
      'totalEmissiveRadiance *= diffuseColor.rgb;',
      'totalEmissiveRadiance *= diffuseColor.rgb;\n\tif ( diffuseColor.a < 0.98 ) totalEmissiveRadiance += uGlow.rgb * uGlow.a * diffuseColor.rgb;',
    )
    .replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
	if ( uHighlight.a > 0.0 ) {
		vec3 hlBase = gl_FragColor.rgb;
		float hlLum = dot( hlBase, vec3( 0.2126, 0.7152, 0.0722 ) );
		gl_FragColor.rgb += ( hlBase * uHighlight.rgb * ( 1.0 - smoothstep( 0.45, 1.2, hlLum ) ) + uHighlight.rgb * 0.035 ) * uHighlight.a;
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, uFlash.rgb, uFlash.a );`,
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clone a texture so it shares the GPU upload of the original (same TextureSource) without
 * scheduling a re-upload. `Texture.copy()` sets `needsUpdate = true`, which bumps the shared
 * source version and would re-upload the image once per clone; we restore the source version.
 * @param {THREE.Texture} src
 * @returns {THREE.Texture}
 */
export function cloneSharedTexture(src) {
  const sourceVersion = src.source.version;
  const tex = src.clone();
  tex.source.version = sourceVersion;
  return tex;
}

// Shared blob-shadow resources (refcounted).
let _blob = null;
let _blobRefs = 0;
function acquireBlobResources() {
  if (!_blob) {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5) / size * 2 - 1;
        const dy = (y + 0.5) / size * 2 - 1;
        const d = Math.sqrt(dx * dx + dy * dy);
        // solid-ish core with a soft rim
        const a = 1 - smooth(0.2, 1.0, d);
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    _blob = { texture, geometry };
  }
  _blobRefs++;
  return _blob;
}
function releaseBlobResources() {
  if (--_blobRefs <= 0 && _blob) {
    _blob.texture.dispose();
    _blob.geometry.dispose();
    _blob = null;
    _blobRefs = 0;
  }
}
function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

const DIR_SUFFIX = /_(down|left|right|up)$/;
const _camQuat = new THREE.Quaternion();

/**
 * Adapt a PropSprites result (`{ texture, canvas, width, height, pixelsPerUnit, anchor, frames?, fps? }`,
 * animated frames laid out horizontally) to the SpriteSheet shape Sprite3D expects. Animated props
 * get a looping `idle` animation over all frames. SpriteSheets are returned unchanged.
 * @param {Partial<SpriteSheet> & Partial<PropSheet>} prop a SpriteSheet (has `frameWidth`) or a
 *   PropSheet (a legacy PropSprites result: `width` / `height` / `frames`)
 * @returns {SpriteSheet}
 */
export function spriteSheetFromProp(prop) {
  if (!prop || prop.frameWidth) return /** @type {SpriteSheet} */ (prop);
  const frames = Math.max(1, (prop.frames | 0) || 1);
  const img = prop.texture && prop.texture.image;
  // `width` may be the frame width or the whole strip width — detect from the image when possible
  let fw = prop.width;
  if (frames > 1 && img && img.width && Math.abs(img.width - prop.width) < 0.5) fw = prop.width / frames;
  const animations = {};
  if (frames > 1) {
    const list = [];
    for (let i = 0; i < frames; i++) list.push({ col: i, row: 0 });
    animations.idle = { frames: list, fps: prop.fps || 8, loop: true };
  }
  return {
    texture: prop.texture,
    canvas: prop.canvas,
    frameWidth: fw,
    frameHeight: prop.height,
    columns: frames,
    rows: 1,
    pixelsPerUnit: prop.pixelsPerUnit || PPU,
    anchor: prop.anchor || [0.5, 0],
    animations,
  };
}

// ---------------------------------------------------------------------------
// Sprite3D
// ---------------------------------------------------------------------------

/** @typedef {{ frames: {col:number,row:number}[], fps: number, loop: boolean }} SpriteAnimation */
/**
 * @typedef {object} SpriteSheet
 * @property {THREE.Texture} texture
 * @property {HTMLCanvasElement} [canvas]
 * @property {number} frameWidth
 * @property {number} frameHeight
 * @property {number} columns
 * @property {number} rows
 * @property {number} [pixelsPerUnit]
 * @property {[number, number]} [anchor]
 * @property {Record<string, SpriteAnimation>} animations
 */

/**
 * A PropSprites result (animated frames laid out horizontally; `width` is the frame width or the
 * whole strip width), accepted by Sprite3D in place of a SpriteSheet (see spriteSheetFromProp).
 * @typedef {object} PropSheet
 * @property {THREE.Texture} texture
 * @property {HTMLCanvasElement|null} [canvas]
 * @property {number} width
 * @property {number} height
 * @property {number} [pixelsPerUnit]
 * @property {[number, number]} [anchor]
 * @property {number} [frames]
 * @property {number} [fps]
 */

export class Sprite3D extends THREE.Group {
  /**
   * @param {SpriteSheet | PropSheet} sheet a SpriteSheet, or a PropSprites result (converted by
   *   spriteSheetFromProp)
   * @param {{ billboard?: 'cylindrical'|'spherical'|'none', tilt?: number, castShadow?: boolean,
   *           shadowMode?: 'sunFacing'|'billboard', blobShadow?: boolean, lit?: boolean, alphaTest?: number,
   *           emissive?: THREE.ColorRepresentation, emissiveIntensity?: number, scale?: number,
   *           renderOrder?: number,
   *           receiveShadow?: boolean, normalUp?: number, wrap?: number, roundness?: number,
   *           ditherMode?: 'screen'|'texel', blobSize?: [number, number], blobOpacity?: number,
   *           tint?: THREE.ColorRepresentation, animation?: string, direction?: string,
   *           combatFx?: boolean }} [opts]
   *   Extra options (beyond the contract): `receiveShadow` (true), `normalUp` (0.55, how much the
   *   shading normal leans to world-up), `wrap` (0.6, wrap-diffuse amount), `roundness` (0.8,
   *   horizontal normal bend across the frame), `ditherMode` ('screen' — or 'texel' for chunky
   *   pixel-art fades), `blobSize` ([w, d] world units), `blobOpacity` (0.5), `tint`,
   *   initial `animation` / `direction`, `combatFx` (false; combat levels only: per-sprite hit
   *   flash, glow and highlight through `setFlash` / `setGlow` / `setHighlight`, COMBAT.md §10.1).
   */
  constructor(sheet, opts = {}) {
    super();
    // also accept a PropSprites result (width/height/frames) — see spriteSheetFromProp
    sheet = spriteSheetFromProp(sheet);
    const o = {
      billboard: 'cylindrical',
      tilt: 0,
      castShadow: true,
      shadowMode: 'sunFacing',
      blobShadow: true,
      lit: true,
      alphaTest: 0.5,
      emissive: null,
      emissiveIntensity: 1,
      scale: 1,
      renderOrder: 0,
      receiveShadow: true,
      normalUp: 0.55,
      wrap: 0.6,
      roundness: 0.8,
      ditherMode: 'screen',
      blobSize: null,
      blobOpacity: 0.5,
      tint: null,
      animation: null,
      direction: 'down',
      combatFx: false,
      ...opts,
    };

    this.type = 'Sprite3D';
    this.isSprite3D = true;
    this._opts = o;
    /** @type {SpriteSheet} */
    this.sheet = sheet;
    /** name → direction → _resolve() result (play() is called every frame by game code). */
    this._resolveCache = new Map();
    /** 'cylindrical' | 'spherical' | 'none' */
    this.billboard = o.billboard;
    /** 0..1 — fraction of the camera pitch the quad leans back toward the camera. */
    this.tilt = o.tilt;
    /** Animation playback speed multiplier. */
    this.speed = 1;
    /** Whether the animation advances in update(). */
    this.playing = true;
    /** Current animation name (e.g. 'walk_left'), or null. */
    this.animation = null;
    /**
     * Facing direction (the includes() test narrows it; the option is any string, so DIRECTIONS
     * is read as string[] for the test).
     * @type {Direction}
     */
    this.direction = /** @type {Direction} */ (/** @type {string[]} */ (DIRECTIONS).includes(o.direction) ? o.direction : 'down');
    /** True once a non-looping animation reached its last frame. */
    this.finished = false;
    /** Optional callback(frameIndex, animationName) whenever the displayed animation frame changes. */
    this.onFrameChange = null;
    /** Optional callback(animationName) when a non-looping animation finishes. */
    this.onAnimationEnd = null;

    this._anim = null; // resolved animation object
    this._animKey = null; // actual key in sheet.animations
    this._autoFlip = false; // mirrored fallback (e.g. left from right)
    this._flipX = false;
    this._frame = 0;
    this._time = 0;
    this._col = 0;
    this._row = 0;
    this._opacity = 1;
    this._bodyOpacity = 1;
    this._shadowMode = o.shadowMode === 'billboard' ? 'billboard' : 'sunFacing';

    // ----- texture (per-instance clone sharing the GPU image) -----
    const ppu = sheet.pixelsPerUnit || PPU;
    const img = sheet.texture.image;
    const texW = (img && img.width) || (sheet.canvas && sheet.canvas.width) || sheet.columns * sheet.frameWidth;
    const texH = (img && img.height) || (sheet.canvas && sheet.canvas.height) || sheet.rows * sheet.frameHeight;
    this._frameU = sheet.frameWidth / texW;
    this._frameV = sheet.frameHeight / texH;
    /** Per-instance texture clone (animated through offset/repeat). */
    this.texture = cloneSharedTexture(sheet.texture);
    this.texture.matrixAutoUpdate = true;

    // ----- geometry: frame-sized quad with the pivot at sheet.anchor -----
    const [ax, ay] = sheet.anchor || [0.5, 0];
    const w = sheet.frameWidth / ppu;
    const h = sheet.frameHeight / ppu;
    this._size = new THREE.Vector2(w, h);
    const geometry = new THREE.PlaneGeometry(w, h);
    geometry.translate(w * (0.5 - ax), h * (0.5 - ay), 0);

    // ----- uniforms (per sprite) -----
    this._uniforms = {
      uNormalUp: { value: o.normalUp },
      uWrap: { value: o.wrap },
      uRoundness: { value: o.roundness },
      uShadowSkip: { value: 0 },
      uShadowSkipBias: { value: 0.04 },
      uDitherOpacity: { value: 1 },
      // the shadow caster's dither (the depth material's `uDitherOpacity`): `opacity` alone, so
      // `bodyOpacity` fades the visible quad without its shadow (same GLSL, same program)
      uShadowDither: { value: 1 },
      uDitherTexel: { value: o.ditherMode === 'texel' ? 1 : 0 },
      uFrameSize: { value: new THREE.Vector2(sheet.frameWidth, sheet.frameHeight) },
    };
    /** True when the lit material is the combat fx variant (hit flash + selective glow). */
    this._fx = !!(o.combatFx && o.lit);
    if (this._fx) {
      // per-sprite flash (rgb, mix amount), glow (rgb, strength) and highlight (rgb, strength);
      // they must exist before the material
      this._uniforms.uFlash = { value: new THREE.Vector4(0, 0, 0, 0) };
      this._uniforms.uGlow = { value: new THREE.Vector4(0, 0, 0, 0) };
      this._uniforms.uHighlight = { value: new THREE.Vector4(0, 0, 0, 0) };
    }

    // ----- visible material -----
    /**
     * Lit (MeshLambertMaterial) or unlit (MeshBasicMaterial, which has no `emissive`).
     * @type {THREE.MeshLambertMaterial
     *   | (THREE.MeshBasicMaterial & { emissive?: undefined, emissiveIntensity?: undefined })}
     */
    this.material = o.lit ? this._createLitMaterial(o) : this._createUnlitMaterial(o);
    if (o.tint != null) this.material.color.set(o.tint);

    /** The visible quad. */
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'Sprite3D.mesh';
    this.mesh.rotation.order = 'YXZ';
    this.mesh.renderOrder = o.renderOrder;
    this.mesh.customDepthMaterial = this._createDepthMaterial();
    this.add(this.mesh);

    // ----- sun-facing shadow proxy -----
    this._proxyMaterial = new THREE.MeshBasicMaterial({
      map: this.texture,
      alphaTest: o.alphaTest,
      side: THREE.DoubleSide,
      colorWrite: false,
      depthWrite: false,
      fog: false,
    });
    /** Shadow-only quad rotated about Y to face the sun (renders nothing in the colour pass). */
    this.shadowProxy = new THREE.Mesh(geometry, this._proxyMaterial);
    this.shadowProxy.name = 'Sprite3D.shadowProxy';
    this.shadowProxy.castShadow = true;
    this.shadowProxy.receiveShadow = false;
    this.shadowProxy.customDepthMaterial = this.mesh.customDepthMaterial;
    this.add(this.shadowProxy);

    // ----- blob contact shadow -----
    this.blob = null;
    this._blobOpacity = o.blobOpacity;
    if (o.blobShadow) {
      const res = acquireBlobResources();
      this._blobMaterial = new THREE.MeshBasicMaterial({
        color: 0x0c0812,
        map: res.texture,
        transparent: true,
        opacity: o.blobOpacity,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      });
      const bs = o.blobSize || [Math.max(0.7, w * 0.52), Math.max(0.36, w * 0.26)];
      this.blob = new THREE.Mesh(res.geometry, this._blobMaterial);
      this.blob.name = 'Sprite3D.blob';
      this.blob.scale.set(bs[0], 1, bs[1]);
      this.blob.position.y = 0.012;
      this.blob.renderOrder = RENDER_ORDER.DECALS;
      this.blob.castShadow = false;
      this.blob.receiveShadow = false;
      this.add(this.blob);
    }

    this.scale.setScalar(o.scale);

    this._ready = true;
    this.castShadow = o.castShadow;
    this.receiveShadow = o.receiveShadow;

    // initial frame / animation
    const initial = o.animation || (this._resolve('idle') ? 'idle' : null);
    if (initial && this._resolve(initial)) this.play(initial);
    else this._applyFrame();
  }

  // -------------------------------------------------------------------------
  // Materials
  // -------------------------------------------------------------------------

  _createLitMaterial(o) {
    const u = this._uniforms;
    const mat = new THREE.MeshLambertMaterial({
      map: this.texture,
      alphaTest: o.alphaTest,
      side: THREE.DoubleSide,
    });
    if (o.emissive != null) {
      mat.emissive.set(o.emissive);
      mat.emissiveIntensity = o.emissiveIntensity ?? 1;
    }
    mat.onBeforeCompile = (shader) => {
      patchSpriteLighting(shader, u);
      shader.uniforms.uDitherOpacity = u.uDitherOpacity;
      shader.uniforms.uDitherTexel = u.uDitherTexel;
      shader.uniforms.uFrameSize = u.uFrameSize;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uDitherOpacity;
uniform float uDitherTexel;
uniform vec2 uFrameSize;
${GLSL_BAYER4}`,
        )
        .replace(
          '#include <alphatest_fragment>',
          `#include <alphatest_fragment>
	if ( uDitherOpacity < 0.999 ) {
		vec2 ldp = mix( gl_FragCoord.xy, vQuadUv * uFrameSize, uDitherTexel );
		if ( uDitherOpacity <= luminatiBayer4( ldp ) ) discard;
	}`,
        )
        // emissive glows with the sprite's own colours rather than as a flat silhouette
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= diffuseColor.rgb;');
      if (u.uFlash) patchCombatFx(shader, u);
    };
    mat.customProgramCacheKey = u.uFlash ? () => 'luminati-sprite3d-lit-fx-v1' : () => 'luminati-sprite3d-lit-v1';
    return mat;
  }

  _createUnlitMaterial(o) {
    const u = this._uniforms;
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      alphaTest: o.alphaTest,
      side: THREE.DoubleSide,
    });
    if (o.emissive != null) mat.color.set(o.emissive).multiplyScalar(o.emissiveIntensity ?? 1);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDitherOpacity = u.uDitherOpacity;
      shader.uniforms.uDitherTexel = u.uDitherTexel;
      shader.uniforms.uFrameSize = u.uFrameSize;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vQuadUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvQuadUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vQuadUv;
uniform float uDitherOpacity;
uniform float uDitherTexel;
uniform vec2 uFrameSize;
${GLSL_BAYER4}`,
        )
        .replace(
          '#include <alphatest_fragment>',
          `#include <alphatest_fragment>
	if ( uDitherOpacity < 0.999 ) {
		vec2 ldp = mix( gl_FragCoord.xy, vQuadUv * uFrameSize, uDitherTexel );
		if ( uDitherOpacity <= luminatiBayer4( ldp ) ) discard;
	}`,
        );
    };
    mat.customProgramCacheKey = () => 'luminati-sprite3d-unlit-v1';
    return mat;
  }

  /** Depth material used by the shadow proxy / billboard caster: map + alphaTest + dithered opacity. */
  _createDepthMaterial() {
    const u = this._uniforms;
    const mat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: this.texture,
      alphaTest: this.material.alphaTest,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDitherOpacity = u.uShadowDither;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uDitherOpacity;\n${GLSL_BAYER4}`)
        .replace(
          '#include <alphatest_fragment>',
          `#include <alphatest_fragment>
	if ( uDitherOpacity < 0.999 && uDitherOpacity <= luminatiBayer4( gl_FragCoord.xy ) ) discard;`,
        );
    };
    mat.customProgramCacheKey = () => 'luminati-sprite3d-depth-v1';
    return mat;
  }

  // -------------------------------------------------------------------------
  // Properties
  // -------------------------------------------------------------------------

  /** Multiply colour (the material colour). Assigning accepts any THREE.ColorRepresentation. */
  get tint() { return this.material.color; }
  set tint(c) { this.material.color.set(c); }

  /** 0..1 — ordered-dither fade (compatible with alphaTest; shadows and blob fade too). */
  get opacity() { return this._opacity; }
  set opacity(v) {
    this._opacity = v < 0 ? 0 : v > 1 ? 1 : v;
    this._applyOpacity();
  }

  /**
   * 0..1 (default 1) — an extra dither fade of the visible quad only: the shadow (proxy or
   * billboard caster) and the contact blob keep following `opacity`. A see-through without losing
   * the ground contact (the combat boss while the player stands behind it). Uniform writes only.
   */
  get bodyOpacity() { return this._bodyOpacity; }
  set bodyOpacity(v) {
    this._bodyOpacity = v < 0 ? 0 : v > 1 ? 1 : v;
    this._applyOpacity();
  }

  _applyOpacity() {
    const v = this._opacity;
    const body = v * this._bodyOpacity;
    this._uniforms.uDitherOpacity.value = body;
    this._uniforms.uShadowDither.value = v;
    const vis = v > 0.001;
    // (a billboard-shadow sprite keeps its quad while the shadow stays: it casts it)
    this.mesh.visible = this._shadowMode === 'billboard' ? vis : body > 0.001;
    if (this.blob) {
      this._blobMaterial.opacity = this._blobOpacity * v;
      this.blob.visible = vis;
    }
    this._applyShadowFlags();
  }

  /** Mirror the sprite horizontally. */
  get flipX() { return this._flipX; }
  set flipX(v) {
    v = !!v;
    if (v === this._flipX) return;
    this._flipX = v;
    this._applyFrame();
  }

  /** Whether the sprite casts a shadow (sun-facing proxy or the billboard itself). */
  // @ts-expect-error TS2611: Object3D's castShadow field, overridden to route it to the proxy
  get castShadow() { return !!this._castShadow; }
  set castShadow(v) {
    this._castShadow = !!v;
    if (this._ready) this._applyShadowFlags();
  }

  /** Whether the visible quad receives shadows (with self-shadow-free lookup). */
  // @ts-expect-error TS2611: Object3D's receiveShadow field, overridden to route it to the mesh
  get receiveShadow() { return !!this._receiveShadow; }
  set receiveShadow(v) {
    this._receiveShadow = !!v;
    if (this._ready) this._applyShadowFlags();
  }

  /** 'sunFacing' | 'billboard' */
  get shadowMode() { return this._shadowMode; }
  set shadowMode(v) {
    this._shadowMode = v === 'billboard' ? 'billboard' : 'sunFacing';
    if (this._ready) this._applyOpacity();
  }

  /** Index of the current frame within the current animation. */
  get frame() { return this._frame; }

  /**
   * Hit flash: mix the lit colour toward (r, g, b) (linear HDR) by `a` (0 = off). Only lit sprites
   * created with `combatFx: true` show it; a no-op otherwise (COMBAT.md §10.1). A uniform write:
   * safe to call every frame, never recompiles.
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @param {number} a mix amount 0..1
   * @returns {this}
   */
  setFlash(r, g, b, a) {
    if (this._fx) this._uniforms.uFlash.value.set(r, g, b, a);
    return this;
  }

  /**
   * Selective glow: additive emissive (r, g, b) × a on the sheet's glow texels (alpha 204), in the
   * texels' own colour. Only lit sprites with `combatFx: true`; a no-op otherwise (a uniform write).
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @param {number} a strength (0 = off)
   * @returns {this}
   */
  setGlow(r, g, b, a) {
    if (this._fx) this._uniforms.uGlow.value.set(r, g, b, a);
    return this;
  }

  /**
   * Highlight: brighten and colour the lit texels by (r, g, b) × a while keeping their own shading
   * (`c += (c·rgb + rgb·0.035)·a`, spared above luminance ≈ 0.45) — the wind-up pulse and the
   * elite shimmer, which must not flatten the pose. Applied before the hit flash. Only lit sprites
   * with `combatFx: true`; a no-op otherwise (a uniform write).
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @param {number} a strength (0 = off)
   * @returns {this}
   */
  setHighlight(r, g, b, a) {
    if (this._fx) this._uniforms.uHighlight.value.set(r, g, b, a);
    return this;
  }

  /** Current flash `[r, g, b, a]` (zeros without `combatFx`). */
  get flash() { return this._fx ? this._uniforms.uFlash.value.toArray() : [0, 0, 0, 0]; }

  /** Current highlight `[r, g, b, a]` (zeros without `combatFx`). */
  get highlight() { return this._fx ? this._uniforms.uHighlight.value.toArray() : [0, 0, 0, 0]; }

  /** Current glow `[r, g, b, a]` (zeros without `combatFx`). */
  get glow() { return this._fx ? this._uniforms.uGlow.value.toArray() : [0, 0, 0, 0]; }

  /** World size of the sprite quad (units, before group scale). */
  get size() { return this._size; }

  _applyShadowFlags() {
    const cast = this._castShadow && this._opacity > 0.001;
    const sunFacing = this._shadowMode === 'sunFacing';
    this.shadowProxy.visible = cast && sunFacing;
    this.mesh.castShadow = cast && !sunFacing;
    this.mesh.receiveShadow = !!this._receiveShadow;
    this._uniforms.uShadowSkip.value = cast && sunFacing ? 1 : 0;
  }

  // -------------------------------------------------------------------------
  // Animation
  // -------------------------------------------------------------------------

  /**
   * Resolve an animation name. Accepts exact keys ('walk_left'), base names resolved with the
   * current direction ('walk' → 'walk_left') and mirrors a missing left/right from its opposite.
   * @returns {{key:string, name:string, base:string|null, anim:object, flip:boolean}|null}
   *   (cached per name and direction: treat it as read-only)
   */
  _resolve(name, dir = this.direction) {
    let byDir = this._resolveCache.get(name);
    if (!byDir) {
      byDir = new Map();
      this._resolveCache.set(name, byDir);
    }
    let r = byDir.get(dir);
    if (r === undefined) {
      r = this._resolveUncached(name, dir);
      byDir.set(dir, r);
    }
    return r;
  }

  _resolveUncached(name, dir) {
    const anims = this.sheet.animations || {};
    const m = DIR_SUFFIX.exec(name);
    let base = m ? name.slice(0, -m[0].length) : name;
    let d = m ? m[1] : dir;
    if (!m && anims[name]) return { key: name, name, base: null, anim: anims[name], flip: false };
    const full = `${base}_${d}`;
    if (anims[full]) return { key: full, name: full, base, anim: anims[full], flip: false };
    const mirror = d === 'left' ? 'right' : d === 'right' ? 'left' : null;
    if (mirror && anims[`${base}_${mirror}`]) {
      return { key: `${base}_${mirror}`, name: full, base, anim: anims[`${base}_${mirror}`], flip: true };
    }
    if (m && anims[name]) return { key: name, name, base, anim: anims[name], flip: false };
    return null;
  }

  /**
   * Play an animation. No-op if it is already playing (unless `restart`; a finished one-shot
   * animation restarts). Starting an animation sets `speed` (default 1, as in the contract); on
   * the no-op path the speed only changes when passed explicitly, so calling `play()` every frame
   * is safe. `keepPhase` keeps the current frame/time (e.g. walk → run with the same frames).
   * @param {string} name e.g. 'walk_down', or a base name ('walk') resolved with the current direction
   * @param {{restart?: boolean, speed?: number, keepPhase?: boolean}} [opts]
   * @returns {this}
   */
  play(name, opts = {}) {
    const { restart = false, speed, keepPhase = false } = opts;
    const r = this._resolve(name);
    if (!r) {
      if (!WARNED_ANIMATIONS.has(name)) {
        WARNED_ANIMATIONS.add(name);
        console.warn(`Sprite3D: unknown animation "${showValue(name)}"`);
      }
      return this;
    }
    if (r.name === this.animation && !restart && !this.finished) {
      // already running: no-op (an explicit speed is still honoured; resumes if paused)
      if (speed !== undefined) this.speed = speed;
      this.playing = true;
      return this;
    }
    // starting an animation: contract default speed = 1
    this.speed = speed !== undefined ? speed : 1;
    this._setAnimation(r, !keepPhase || restart || this.finished);
    this.playing = true;
    return this;
  }

  _setAnimation(r, reset) {
    this._anim = r.anim;
    this._animKey = r.key;
    this._autoFlip = r.flip;
    this.animation = r.name;
    if (r.base !== null) {
      const m = DIR_SUFFIX.exec(r.name);
      if (m) this.direction = /** @type {Direction} */ (m[1]); // DIR_SUFFIX group
    }
    const n = Math.max(1, r.anim.frames.length);
    if (reset) {
      this._frame = 0;
      this._time = 0;
      this.finished = false;
    } else {
      this._frame %= n;
    }
    const f = r.anim.frames[this._frame] || r.anim.frames[0];
    if (f) {
      this._col = f.col;
      this._row = f.row;
    }
    this._applyFrame();
  }

  /**
   * Change facing direction. The current directional animation switches to the matching one
   * (walk_down → walk_left) keeping its frame phase.
   * @param {Direction} dir
   * @returns {this}
   */
  setDirection(dir) {
    if (dir === this.direction || !DIRECTIONS.includes(dir)) return this;
    this.direction = dir;
    if (this.animation) {
      const m = DIR_SUFFIX.exec(this.animation);
      if (m) {
        const r = this._resolve(`${this.animation.slice(0, -m[0].length)}_${dir}`, dir);
        if (r) this._setAnimation(r, false);
      }
    }
    return this;
  }

  /**
   * Face a world-space movement vector, relative to the camera yaw (screen-down = toward camera).
   * @param {number} dx
   * @param {number} dz
   * @param {number} [yaw] camera yaw (defaults to globalUniforms.uCameraYaw)
   * @returns {this}
   */
  faceVector(dx, dz, yaw = globalUniforms.uCameraYaw.value) {
    const d = Sprite3D.directionFromVector(dx, dz, yaw, this.direction);
    return this.setDirection(d);
  }

  /**
   * Show a specific sheet cell (manual frame mode). Stops the current animation: `animation`
   * becomes null and `playing` false; any later `play()` starts cleanly.
   * @param {number} col
   * @param {number} row
   * @returns {this}
   */
  setFrame(col, row) {
    this._col = col;
    this._row = row;
    this._autoFlip = false;
    this._anim = null;
    this._animKey = null;
    this.animation = null;
    this.finished = false;
    this._frame = 0;
    this._time = 0;
    this.playing = false;
    this._applyFrame();
    return this;
  }

  _applyFrame() {
    const t = this.texture;
    const fu = this._frameU;
    const fv = this._frameV;
    const flip = this._flipX !== this._autoFlip;
    t.repeat.set(flip ? -fu : fu, fv);
    t.offset.set((this._col + (flip ? 1 : 0)) * fu, 1 - (this._row + 1) * fv);
  }

  // -------------------------------------------------------------------------
  // Per-frame
  // -------------------------------------------------------------------------

  /**
   * Advance the animation, orient the billboard, turn the shadow proxy toward the sun.
   * Cylindrical mode needs no camera (it uses `globalUniforms.uCameraYaw`); `tilt` and
   * 'spherical' use the camera's world matrix. For 'spherical', keep the sprite's ancestors unrotated.
   * @param {number} dt seconds
   * @param {THREE.Camera} [camera]
   */
  update(dt, camera) {
    // animation
    const anim = this._anim;
    if (this.playing && anim && anim.frames.length > 0) {
      const fps = anim.fps > 0 ? anim.fps : 8;
      this._time += dt * this.speed;
      const dur = 1 / fps;
      if (this._time >= dur) {
        const steps = Math.floor(this._time / dur);
        this._time -= steps * dur;
        const n = anim.frames.length;
        let f = this._frame + steps;
        if (f >= n) {
          if (anim.loop !== false) f %= n;
          else {
            f = n - 1;
            this.playing = false;
            if (!this.finished) {
              this.finished = true;
              if (this.onAnimationEnd) this.onAnimationEnd(this.animation);
            }
          }
        }
        if (f !== this._frame) {
          this._frame = f;
          const fr = anim.frames[f];
          this._col = fr.col;
          this._row = fr.row;
          this._applyFrame();
          if (this.onFrameChange) this.onFrameChange(f, this.animation);
        }
      }
    }

    // billboard (the group's own Y rotation is compensated; keep parents unrotated)
    const yaw = globalUniforms.uCameraYaw.value;
    const ownYaw = this.rotation.y;
    if (this.billboard === 'cylindrical' || (this.billboard === 'spherical' && !camera)) {
      let pitch = 0;
      if (camera && this.tilt !== 0) {
        const e9 = camera.matrixWorld.elements[9];
        pitch = Math.asin(e9 < -1 ? -1 : e9 > 1 ? 1 : e9);
      }
      this.mesh.rotation.set(-pitch * this.tilt, yaw - ownYaw, 0);
    } else if (this.billboard === 'spherical') {
      // camera orientation expressed in the group's frame (own rotation compensated)
      _camQuat.setFromRotationMatrix(camera.matrixWorld);
      this.mesh.quaternion.copy(this.quaternion).invert().multiply(_camQuat);
    }

    // shadow proxy faces the sun (rotation about Y only)
    if (this.shadowProxy.visible) {
      const s = globalUniforms.uSunDirection.value;
      if (s.x * s.x + s.z * s.z > 1e-8) this.shadowProxy.rotation.y = Math.atan2(s.x, s.z) - ownYaw;
    }
    if (this.blob) this.blob.rotation.y = yaw - ownYaw;
  }

  /**
   * Pick a sprite direction for a world-space movement vector as seen from a camera yaw.
   * @param {number} dx
   * @param {number} dz
   * @param {number} [yaw]
   * @param {Direction} [current] current direction, used as a tie-breaker
   *   (hysteresis)
   * @returns {Direction}
   */
  static directionFromVector(dx, dz, yaw = 0, current = 'down') {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const rx = dx * c - dz * s; // screen right
    const rz = dx * s + dz * c; // screen down (toward camera)
    const ax = Math.abs(rx);
    const az = Math.abs(rz);
    if (ax < 1e-6 && az < 1e-6) return current;
    // slight hysteresis so diagonal movement doesn't flicker between directions
    const horizontalNow = current === 'left' || current === 'right';
    const bias = 1.15;
    const horizontal = horizontalNow ? ax * bias >= az : ax > az * bias;
    if (horizontal) return rx > 0 ? 'right' : 'left';
    return rz > 0 ? 'down' : 'up';
  }

  /**
   * A new Sprite3D with the same sheet, options and current state (transform, tint, opacity,
   * flip, shadow flags, animation). Extra children added by the user are not cloned.
   * (Object3D#clone would call the constructor without a sheet.)
   * @returns {this}
   */
  clone() {
    const s = new (/** @type {new (sheet: SpriteSheet, opts?: object) => this} */ (this.constructor))(this.sheet, { ...this._opts, animation: null, direction: this.direction });
    s.name = this.name;
    s.visible = this.visible;
    s.position.copy(this.position);
    s.quaternion.copy(this.quaternion);
    s.scale.copy(this.scale);
    s.billboard = this.billboard;
    s.tilt = this.tilt;
    s.tint.copy(this.tint);
    if (this.material.emissive && s.material.emissive) {
      s.material.emissive.copy(this.material.emissive);
      s.material.emissiveIntensity = this.material.emissiveIntensity;
    }
    s.flipX = this.flipX;
    s.opacity = this.opacity;
    s.bodyOpacity = this.bodyOpacity;
    s.shadowMode = this.shadowMode;
    s.castShadow = this.castShadow;
    s.receiveShadow = this.receiveShadow;
    if (this._fx) {
      s._uniforms.uFlash.value.copy(this._uniforms.uFlash.value);
      s._uniforms.uGlow.value.copy(this._uniforms.uGlow.value);
      s._uniforms.uHighlight.value.copy(this._uniforms.uHighlight.value);
    }
    if (this.animation) s.play(this.animation, { speed: this.speed });
    else s.setFrame(this._col, this._row);
    s.playing = this.playing;
    return s;
  }

  /** Release GPU resources (the sheet texture's image is shared and not disposed). */
  dispose() {
    if (this.parent) this.parent.remove(this);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.customDepthMaterial.dispose();
    this._proxyMaterial.dispose();
    this.texture.dispose();
    if (this.blob) {
      this._blobMaterial.dispose();
      this.blob = null;
      releaseBlobResources();
    }
    this._anim = null;
    this.onFrameChange = null;
    this.onAnimationEnd = null;
  }
}
