import * as THREE from 'three';
import { PPU } from '../constants.js';
import { globalUniforms } from '../render/GlobalUniforms.js';
import { RNG } from '../utils/math.js';
import { patchSpriteLighting, cloneSharedTexture } from './Sprite3D.js';

/**
 * Foliage — thousands of instanced pixel-art billboards (grass tufts, flowers, reeds …) in ONE
 * draw call. Each instance is billboarded around Y by `globalUniforms.uCameraYaw` in the vertex
 * shader (anchored at its root), sways with `uTime` / `uWind` / `uWindStrength` (top vertices only,
 * per-instance phase + travelling gust waves) and is lit like Sprite3D (bent normals + wrap diffuse).
 *
 * If the sprite has several horizontal frames (`sprite.frames`), each instance may pick a frame
 * (`instances[i].frame`, or random with `randomFrames: true`) — variety in a single draw call.
 */

// Shared vertex GLSL: yaw billboard + wind sway. `LUMINATI_FACE_SUN` switches the facing to the sun
// azimuth (used by the depth material so cast shadows are full silhouettes).
const GLSL_FOLIAGE_PARS = /* glsl */ `
uniform float uTime;
uniform float uCameraYaw;
uniform vec2 uWind;
uniform float uWindStrength;
uniform float uFoliageWind;
uniform float uAnchorY;
uniform float uQuadHeight;
uniform float uFrameU;
#ifdef LUMINATI_FACE_SUN
uniform vec3 uSunDirection;
#endif
attribute float aFrame;

float luminatiFoliageYaw() {
#ifdef LUMINATI_FACE_SUN
	vec2 sh = uSunDirection.xz;
	return dot( sh, sh ) > 1e-8 ? atan( sh.x, sh.y ) : uCameraYaw;
#else
	return uCameraYaw;
#endif
}

vec3 luminatiYawRotate( vec3 v, float yaw ) {
	float c = cos( yaw );
	float s = sin( yaw );
	return vec3( v.x * c + v.z * s, v.y, - v.x * s + v.z * c );
}
`;

const GLSL_FOLIAGE_BEGIN = /* glsl */ `
	vec3 transformed = luminatiYawRotate( vec3( position ), luminatiFoliageYaw() );
	{
		vec3 lfPos = vec3( 0.0 );
		float lfScale = 1.0;
		#ifdef USE_INSTANCING
			lfPos = instanceMatrix[ 3 ].xyz;
			lfScale = max( length( instanceMatrix[ 0 ].xyz ), 1e-4 );
		#endif
		float lfW = clamp( ( uv.y - uAnchorY ) / max( 1.0 - uAnchorY, 1e-3 ), 0.0, 1.0 );
		float lfWindLen = length( uWind );
		vec2 lfDir = lfWindLen > 1e-4 ? uWind / lfWindLen : vec2( 1.0, 0.0 );
		float lfHash = fract( sin( dot( lfPos.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
		float lfWave = dot( lfPos.xz, lfDir ) * 0.42 - uTime * ( 1.25 + lfWindLen * 0.55 );
		float lfGust = 0.5 + 0.5 * sin( lfWave ) + 0.25 * sin( lfWave * 0.37 + 1.7 );
		lfGust = lfGust * lfGust;
		float lfFlutter = sin( uTime * ( 2.1 + lfHash * 1.9 ) + lfHash * 6.2831 );
		float lfAmt = uWindStrength * uFoliageWind * ( 0.03 + 0.06 * lfWindLen ) * uQuadHeight * lfScale;
		vec2 lfSway = lfDir * lfAmt * ( 0.3 + lfGust * 1.1 + lfFlutter * 0.25 )
			+ vec2( - lfDir.y, lfDir.x ) * lfAmt * lfFlutter * 0.3;
		transformed.xz += lfSway * lfW / lfScale;
		transformed.y -= dot( lfSway, lfSway ) * lfW / ( lfScale * max( uQuadHeight * lfScale, 0.2 ) ) * 0.5;
	}
`;

/**
 * @typedef {object} FoliageSprite
 * @property {THREE.Texture} texture
 * @property {number} width
 * @property {number} height
 * @property {number} [pixelsPerUnit]
 * @property {[number, number]} [anchor]
 * @property {number} [frames]
 */

export class Foliage {
  /**
   * @param {{ sprite: FoliageSprite, instances: {x:number, y:number, z:number, scale?:number,
   *           tint?:THREE.ColorRepresentation, frame?:number}[], wind?: number, castShadow?: boolean,
   *           receiveShadow?: boolean, alphaTest?: number, normalUp?: number, wrap?: number,
   *           roundness?: number, rootDarken?: number, randomFrames?: boolean, variance?: number,
   *           seed?: number, name?: string }} opts
   *   Extras: `alphaTest` (0.5), `normalUp` (0.8 — foliage shades almost like the ground under it),
   *   `wrap` (0.5), `roundness` (0.25), `rootDarken` (0.35, darkens the base of each tuft),
   *   `randomFrames` (false), `variance` (0.08 seeded brightness jitter), `seed`, `name`.
   */
  constructor(opts) {
    const {
      sprite,
      instances,
      wind = 1,
      castShadow = false,
      receiveShadow = true,
      alphaTest = 0.5,
      normalUp = 0.8,
      wrap = 0.5,
      roundness = 0.25,
      rootDarken = 0.35,
      randomFrames = false,
      variance = 0.08,
      seed = 1,
      name = 'Foliage',
    } = opts;

    const ppu = sprite.pixelsPerUnit || PPU;
    const frames = Math.max(1, sprite.frames | 0 || 1);
    const img = sprite.texture.image;
    // `width` may be the frame width or the whole strip width — detect from the image when possible.
    let frameW = sprite.width;
    if (frames > 1 && img && img.width && Math.abs(img.width - sprite.width) < 0.5) frameW = sprite.width / frames;
    const frameH = sprite.height;
    const [ax, ay] = sprite.anchor || [0.5, 0];
    const w = frameW / ppu;
    const h = frameH / ppu;

    const count = instances.length;
    const geometry = new THREE.PlaneGeometry(w, h);
    geometry.translate(w * (0.5 - ax), h * (0.5 - ay), 0);
    const frameAttr = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count)), 1);
    geometry.setAttribute('aFrame', frameAttr);

    // texture: shared as-is unless we need a per-frame repeat
    this._ownsTexture = frames > 1;
    this.texture = frames > 1 ? cloneSharedTexture(sprite.texture) : sprite.texture;
    if (frames > 1) {
      this.texture.repeat.set(1 / frames, 1);
      this.texture.offset.set(0, 0);
    }

    this._uniforms = {
      uTime: globalUniforms.uTime,
      uCameraYaw: globalUniforms.uCameraYaw,
      uWind: globalUniforms.uWind,
      uWindStrength: globalUniforms.uWindStrength,
      uFoliageWind: { value: wind },
      uAnchorY: { value: ay },
      uQuadHeight: { value: h },
      uFrameU: { value: 1 / frames },
      uRootDarken: { value: rootDarken },
      // lighting
      uNormalUp: { value: normalUp },
      uWrap: { value: wrap },
      uRoundness: { value: roundness },
      uShadowSkip: { value: castShadow ? 1 : 0 },
      uShadowSkipBias: { value: castShadow ? 0.03 : 0 },
    };
    const u = this._uniforms;

    const material = new THREE.MeshLambertMaterial({
      map: this.texture,
      alphaTest,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      patchSpriteLighting(shader, u, {
        shadowCenter: '( modelMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).xyz',
      });
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GLSL_FOLIAGE_PARS}`)
        .replace(
          '#include <beginnormal_vertex>',
          '#include <beginnormal_vertex>\n\tobjectNormal = luminatiYawRotate( objectNormal, luminatiFoliageYaw() );',
        )
        .replace('#include <begin_vertex>', GLSL_FOLIAGE_BEGIN)
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv.x += aFrame * uFrameU;\n#endif');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uRootDarken;')
        .replace(
          '#include <map_fragment>',
          '#include <map_fragment>\n\tdiffuseColor.rgb *= mix( 1.0 - uRootDarken, 1.0, smoothstep( 0.0, 0.6, vQuadUv.y ) );',
        );
    };
    material.customProgramCacheKey = () => 'luminati-foliage-lit-v1';
    this.material = material;

    const depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: this.texture,
      alphaTest,
      side: THREE.DoubleSide,
    });
    depthMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.uniforms.uSunDirection = globalUniforms.uSunDirection;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n#define LUMINATI_FACE_SUN\n${GLSL_FOLIAGE_PARS}`)
        .replace('#include <begin_vertex>', GLSL_FOLIAGE_BEGIN)
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv.x += aFrame * uFrameU;\n#endif');
    };
    depthMaterial.customProgramCacheKey = () => 'luminati-foliage-depth-v1';
    this.depthMaterial = depthMaterial;

    /** @type {THREE.InstancedMesh} */
    this.object = new THREE.InstancedMesh(geometry, material, Math.max(1, count));
    this.object.name = name;
    this.object.count = count;
    this.object.customDepthMaterial = depthMaterial;
    this.object.castShadow = castShadow;
    this.object.receiveShadow = receiveShadow;

    // instances
    const rng = new RNG(seed);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let maxScale = 0;
    for (let i = 0; i < count; i++) {
      const it = instances[i];
      const s = it.scale ?? 1;
      maxScale = Math.max(maxScale, s);
      m.makeScale(s, s, s);
      m.setPosition(it.x, it.y ?? 0, it.z);
      this.object.setMatrixAt(i, m);
      if (it.tint != null) c.set(it.tint);
      else c.setRGB(1, 1, 1);
      if (variance > 0) c.multiplyScalar(1 + (rng.next() * 2 - 1) * variance);
      this.object.setColorAt(i, c);
      let f = it.frame;
      if (f == null) f = randomFrames ? Math.floor(rng.next() * frames) : 0;
      frameAttr.array[i] = Math.min(frames - 1, Math.max(0, f | 0));
    }
    this.object.instanceMatrix.needsUpdate = true;
    if (this.object.instanceColor) this.object.instanceColor.needsUpdate = true;
    frameAttr.needsUpdate = true;

    // bounds: instance centres + the quad extent + sway margin
    if (count > 0) {
      this.object.computeBoundingSphere();
      this.object.boundingSphere.radius += Math.hypot(w, h) * Math.max(1, maxScale) + 0.5;
    }
    this.count = count;
  }

  /**
   * Cast silhouette shadows (the depth pass billboards each tuft toward the sun). Keeps the
   * receiver-side self-shadow skip in sync; prefer this over toggling `object.castShadow`.
   */
  get castShadow() { return this.object.castShadow; }
  set castShadow(v) {
    this.object.castShadow = !!v;
    this._uniforms.uShadowSkip.value = v ? 1 : 0;
    this._uniforms.uShadowSkipBias.value = v ? 0.03 : 0;
  }

  /** Whether tufts receive shadows. */
  get receiveShadow() { return this.object.receiveShadow; }
  set receiveShadow(v) { this.object.receiveShadow = !!v; }

  /** Per-field wind multiplier (live). */
  get wind() { return this._uniforms.uFoliageWind.value; }
  set wind(v) { this._uniforms.uFoliageWind.value = v; }

  /**
   * Uniform-driven; nothing to do per frame. Kept for system compatibility (called with `dt`).
   * @type {(dt?: number) => void}
   */
  update(/* dt */) {}

  dispose() {
    if (this.object.parent) this.object.parent.remove(this.object);
    this.object.geometry.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    if (this._ownsTexture) this.texture.dispose();
    this.object.dispose();
  }
}
