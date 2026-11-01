import * as THREE from 'three';
import { globalUniforms } from '../render/GlobalUniforms.js';

/**
 * FxQuads — one instanced batch of textured atlas quads for combat effects (COMBAT.md §11.1):
 * slash arcs, hit stars, dust, projectiles, pickups, stun stars, the level-up pillar and the boss
 * ember wall, all in ONE draw call (`customProgramCacheKey` `luminati-fxquads-v1`, unlit, alpha test
 * 0.5 with a 4 × 4 Bayer dither fade for `a < 1`, fog, HDR colours so bright cores bloom).
 *
 * Handles: `alloc()` → handle (−1 when full), `set(h, p)` every time the quad changes (the caller
 * reuses `p`, nothing is allocated), `free(h)`; `update()` once per frame uploads the dirty ranges
 * and sets the instance count / visibility.
 *
 * `set` parameters: `{ x, y, z, frame, index = 0, scale = 1, rot = 0 (rad, in-plane),
 * mode: 'billboard'|'flat'|'screen', dirX = 0, dirZ = 1, r = 1, g = 1, b = 1, a = 1,
 * flipX = false }` — world size = frame pixels / 16 × scale, centred on (x, y, z); `billboard`
 * upright facing the camera yaw, `flat` horizontal at y with its +V axis along (dirX, dirZ) and +U
 * along (−dirZ, dirX) (seen from above: V = texture up, U = texture right), `screen` facing the
 * camera. `flipX` mirrors the texture along U (e.g. a back-hand slash). `index` wraps modulo the
 * frame count; an unknown frame hides the quad (one console.warn per name).
 *
 * Rendering: the quads are opaque, alpha-tested and depth-writing (sharp in the DOF, sorted by the
 * depth buffer); `a < 1` discards texels by a Bayer threshold in ATLAS-TEXEL space, so a fading
 * slash dissolves in art-sized pixels. Colour = texel × (r, g, b) — linear HDR, a max channel
 * above ~1.4 blooms (Game `_tunePost` threshold 1.05) — written into PostFX's HDR scene target
 * like every other material (tone mapping happens once, in PostFX's OutputPass). The object keeps
 * an identity transform: instance positions are world positions.
 *
 * Soft (`soft` 0 … 1): a radial dither falloff, still cut-out and depth-writing. The quad's own
 * radius r (0 at its centre, 1 at the middle of an edge, frame-local, whatever the rotation or the
 * mirror) keeps the density 1 − smoothstep(1 − soft, 1, r): `soft` is the outer fraction of the
 * radius that thins (0.3: the rim; 1: from the centre out — mist, a cloud), and nothing past r = 1
 * (the frame's corners) is drawn once soft > 0. The density multiplies `a` before the same Bayer
 * test in atlas-texel space, so the thinning comes in art-sized pixels. soft = 0 (the default)
 * draws exactly what it drew before.
 *
 * Halo (opt-in: `enableHalo()`, then a quad's `halo` weight 0 … 1): a second instanced
 * mesh, a child of `object` sharing its geometry and instance data, draws a soft additive glow
 * round the BRIGHT quads that ask for it (max colour channel above ~0.9, full by ~1.8): each
 * fragment of a quad 1.9 × the size averages twelve atlas taps of the frame's shape around it, so
 * the glow follows the shape and fades out softly; × the quad's own colour, × `a` (a smooth fade,
 * while the opaque core dithers), × its `halo` weight. Additive, so it needs no sorting;
 * depth-tested, not depth-writing; no fog; a soft quad's taps weigh by its falloff (the glow thins
 * with the body). A quad with `halo` 0 — the default: every effect that does not ask — is put
 * outside the clip volume by the halo's vertex shader and draws nothing there, and the halo mesh
 * is drawn only while a live quad has a weight (`visible`). Only `enableHalo` makes it (a hero's
 * look package where it can fight — the ice mage's, src/game/party/IceSpellFx.js, and its
 * siblings — each at the one shared `HALO_STRENGTH`, so it does not matter who calls first): one
 * more program (`luminati-fxquads-halo-v1`, compiled at the warm-up by a quad that asks) and one
 * more draw call while it shows; a batch without it has neither.
 */

const MODES = { billboard: 0, flat: 1, screen: 2 };

/**
 * `FxQuads#set` parameters (see the class comment for their meaning and defaults). A missing or
 * unknown `frame` hides the quad; `mode` is 'billboard' | 'flat' | 'screen' (any other value
 * draws a billboard).
 * @typedef {object} FxQuadParams
 * @property {number} [x]
 * @property {number} [y]
 * @property {number} [z]
 * @property {string} [frame]
 * @property {number} [index]
 * @property {number} [scale]
 * @property {number} [rot]
 * @property {string} [mode]
 * @property {number} [dirX]
 * @property {number} [dirZ]
 * @property {number} [r]
 * @property {number} [g]
 * @property {number} [b]
 * @property {number} [a]
 * @property {boolean} [flipX]
 * @property {number} [soft] 0 … 1: a radial dither falloff from the quad's centre — its outer
 *   part thins away in atlas-texel dither steps (a soft-looking edge, still cut-out and
 *   depth-writing; see the class comment). 0 (default): as before.
 * @property {number} [halo] 0 … 1: the weight of the additive halo round the quad (drawn only
 *   after `enableHalo`; see the class comment). 0 (default): none.
 */

const GLSL_BAYER4 = /* glsl */ `
float fxqBayer4( vec2 p ) {
	ivec2 q = ivec2( mod( floor( p ), 4.0 ) );
	const float M[ 16 ] = float[ 16 ]( 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 );
	return ( M[ q.y * 4 + q.x ] + 0.5 ) / 16.0;
}
`;

/** The soft falloff: density at frame-local `f` (0 … 1) for softness `s` (> 0). */
const GLSL_SOFT = /* glsl */ `
float fxqSoft( vec2 f, float s ) {
	float r = length( f - 0.5 ) * 2.0;
	return 1.0 - smoothstep( 1.0 - min( s, 1.0 ), 1.0, r );
}
`;

const FXQ_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>

uniform float uCameraYaw;

attribute vec4 iPos;   // xyz centre (world), w in-plane rotation (rad)
attribute vec4 iAxis;  // x width, y height (world units, x < 0 = mirrored), zw flat-mode direction
attribute vec4 iUv;    // atlas rect u0, v0, u1, v1
attribute vec4 iColor; // linear HDR rgb, a (dither fade)
attribute vec3 iMode;  // x: 0 billboard, 1 flat, 2 screen; y: soft (0 … 1); z: halo weight (0 … 1)

varying vec2 vUv;
varying vec4 vColor;
varying vec2 vFrame; // frame-local position (0 … 1 across the quad)
varying float vSoft;

void main() {
	vec2 q = position.xy * iAxis.xy;
	float cr = cos( iPos.w );
	float sr = sin( iPos.w );
	q = vec2( q.x * cr - q.y * sr, q.x * sr + q.y * cr );
	vUv = mix( iUv.xy, iUv.zw, uv );
	vColor = iColor;
	vFrame = uv;
	vSoft = iMode.y;

	vec4 mvPosition;
	if ( iMode.x > 1.5 ) {
		// screen: faces the camera fully
		mvPosition = viewMatrix * vec4( iPos.xyz, 1.0 );
		mvPosition.xy += q;
	} else {
		vec3 wp;
		if ( iMode.x > 0.5 ) {
			// flat: horizontal, +V along ( dirX, dirZ ), +U along ( -dirZ, dirX )
			vec2 d = iAxis.zw;
			float l = length( d );
			d = l > 1e-6 ? d / l : vec2( 0.0, 1.0 );
			wp = iPos.xyz + vec3( - d.y, 0.0, d.x ) * q.x + vec3( d.x, 0.0, d.y ) * q.y;
		} else {
			// billboard: upright, turned to the camera yaw (like the cylindrical Sprite3D)
			wp = iPos.xyz + vec3( cos( uCameraYaw ), 0.0, - sin( uCameraYaw ) ) * q.x + vec3( 0.0, q.y, 0.0 );
		}
		mvPosition = viewMatrix * vec4( wp, 1.0 );
	}
	gl_Position = projectionMatrix * mvPosition;

	#include <fog_vertex>
}
`;

const FXQ_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>

uniform sampler2D uMap;
uniform vec2 uAtlasSize;

varying vec2 vUv;
varying vec4 vColor;
varying vec2 vFrame;
varying float vSoft;

${GLSL_BAYER4}
${GLSL_SOFT}

void main() {
	vec4 tex = texture2D( uMap, vUv );
	if ( tex.a < 0.5 ) discard;
	// dither fade in atlas-texel space: dissolves in art-sized pixels, stays depth-writing; a soft
	// quad's outer part thins by its radial falloff the same way (soft 0: a stays as it is)
	float fade = vColor.a;
	if ( vSoft > 0.0 ) fade *= fxqSoft( vFrame, vSoft );
	if ( fade < 0.999 && fade <= fxqBayer4( vUv * uAtlasSize ) ) discard;
	gl_FragColor = vec4( tex.rgb * vColor.rgb, 1.0 );

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}
`;

/**
 * The halo's vertex shader: the quad's own, scaled by `uHalo`, with its corner and atlas rect; a
 * quad without a halo weight (`iMode.z` 0) is put outside the clip volume (no fragment).
 */
const HALO_VERTEX = FXQ_VERTEX
  .replace('uniform float uCameraYaw;', `uniform float uCameraYaw;
uniform float uHalo;
varying vec2 vLocal;
varying vec4 vRect;
varying float vWeight;`)
  .replace('vec2 q = position.xy * iAxis.xy;', `if ( iMode.z <= 0.0 ) {
		gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
		return;
	}
	vWeight = iMode.z;
	vec2 q = position.xy * iAxis.xy * uHalo;
	vLocal = uv;
	vRect = iUv;`);

const HALO_FRAGMENT = /* glsl */ `
#include <common>

uniform sampler2D uMap;
uniform float uHalo;
uniform float uStrength;

varying vec2 vUv;
varying vec4 vColor;
varying vec2 vFrame;
varying float vSoft;
varying vec2 vLocal;
varying vec4 vRect;
varying float vWeight;

${GLSL_SOFT}

// two rings of six taps (frame-local units)
const vec2 TAPS[ 12 ] = vec2[ 12 ](
	vec2( 0.12, 0.0 ), vec2( 0.06, 0.104 ), vec2( -0.06, 0.104 ), vec2( -0.12, 0.0 ), vec2( -0.06, -0.104 ), vec2( 0.06, -0.104 ),
	vec2( 0.0, 0.26 ), vec2( 0.225, 0.13 ), vec2( 0.225, -0.13 ), vec2( 0.0, -0.26 ), vec2( -0.225, -0.13 ), vec2( -0.225, 0.13 )
);

void main() {
	float bright = max( vColor.r, max( vColor.g, vColor.b ) );
	float w = smoothstep( 0.9, 1.8, bright ) * clamp( vColor.a, 0.0, 1.0 ) * vWeight;
	if ( w <= 0.001 ) discard;
	vec2 l = ( vLocal - 0.5 ) * uHalo + 0.5;
	vec3 acc = vec3( 0.0 );
	float n = 0.0;
	for ( int i = 0; i < 12; i ++ ) {
		vec2 s = l + TAPS[ i ];
		if ( s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0 ) continue;
		vec4 t = texture2D( uMap, mix( vRect.xy, vRect.zw, s ) );
		if ( t.a >= 0.5 ) {
			// (a soft quad's taps weigh by its falloff there: the glow thins with the body)
			float k = vSoft > 0.0 ? fxqSoft( s, vSoft ) : 1.0;
			acc += t.rgb * k;
			n += k;
		}
	}
	if ( n < ( vSoft > 0.0 ? 0.05 : 0.5 ) ) discard;
	float c = n / 12.0;
	c = c * c * ( 3.0 - 2.0 * c );
	gl_FragColor = vec4( ( acc / n ) * vColor.rgb * ( c * w * uStrength ), 1.0 );

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;

/** Floats per instance in each attribute. */
const STRIDES = { iPos: 4, iAxis: 4, iUv: 4, iColor: 4, iMode: 3 };

/** The halo's strength (`enableHalo`), one for every look package that asks for it. */
export const HALO_STRENGTH = 0.7;

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

export class FxQuads {
  /**
   * @param {{ atlas?: { texture: THREE.Texture,
   *             frames: Record<string, { w: number, h: number, n: number, rects: number[][] }> } | null,
   *           capacity?: number, name?: string }} [opts]
   *   atlas: the `createFxAtlas()` result (without one every quad stays hidden); capacity:
   *   instances (256); name: object name ('fx:quads')
   */
  constructor({ atlas = null, capacity = 256, name = 'fx:quads' } = {}) {
    this.atlas = atlas;
    this.capacity = Math.max(1, capacity | 0);
    const cap = this.capacity;

    const base = new THREE.PlaneGeometry(1, 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(base.index);
    geometry.setAttribute('position', base.getAttribute('position'));
    geometry.setAttribute('uv', base.getAttribute('uv'));
    base.dispose();
    /** @type {Record<string, THREE.InstancedBufferAttribute>} */
    this._attrs = {};
    /** @type {THREE.InstancedBufferAttribute[]} the same attributes as a list (no per-frame Object.entries) */
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

    const texture = atlas?.texture ?? null;
    const img = texture?.image;
    this.material = new THREE.ShaderMaterial({
      name: 'FxQuads',
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uFogStart: globalUniforms.uFogStart,
        uMap: { value: texture },
        uAtlasSize: { value: new THREE.Vector2(img?.width || 512, img?.height || 512) },
        uCameraYaw: globalUniforms.uCameraYaw,
      },
      vertexShader: FXQ_VERTEX,
      fragmentShader: FXQ_FRAGMENT,
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      fog: true,
    });
    this.material.customProgramCacheKey = () => 'luminati-fxquads-v1';

    /** Add to the scene: one draw call, hidden while no quad is live. */
    this.object = new THREE.InstancedMesh(geometry, this.material, cap);
    this.object.name = name;
    this.object.count = 0;
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.castShadow = false;
    this.object.receiveShadow = false;
    this.object.matrixAutoUpdate = false;

    /** The additive glow round the quads that ask for it (`enableHalo`; a child of `object`), or null. */
    this.halo = null;
    /** @type {THREE.ShaderMaterial|null} */
    this.haloMaterial = null;
    /** Live quads with a halo weight (the halo mesh is drawn while there is one). */
    this._haloN = 0;

    // dense packing: live quads occupy slots [0, count); free() moves the last slot into the hole
    this._slotOf = new Int32Array(cap).fill(-1); // handle → slot
    this._handleAt = new Int32Array(cap); // slot → handle
    this._freeStack = new Int32Array(cap); // free handles (top = next to hand out)
    for (let i = 0; i < cap; i++) this._freeStack[i] = cap - 1 - i;
    this._freeTop = cap;
    this._count = 0;
    this._dirtyMin = Infinity;
    this._dirtyMax = -1;
    this._countDirty = false;
    this._warned = null;
  }

  /** @returns {number} a handle, or −1 when the batch is full */
  alloc() {
    if (this._freeTop <= 0) return -1;
    const h = this._freeStack[--this._freeTop];
    const slot = this._count++;
    this._slotOf[h] = slot;
    this._handleAt[slot] = h;
    // a fresh quad is invisible (a = 0) until the first set()
    const c = this._attrs.iColor.array;
    c[slot * 4 + 3] = 0;
    // (and no halo: the slot may still hold a freed quad's weight)
    this._attrs.iMode.array[slot * 3 + 2] = 0;
    this._dirty(slot);
    this._countDirty = true;
    return h;
  }

  /**
   * Update a quad (see the class comment for `p`). Allocation-free.
   * @param {number} h handle
   * @param {FxQuadParams} p
   */
  set(h, p) {
    const slot = h >= 0 && h < this.capacity ? this._slotOf[h] : -1;
    if (slot < 0) return;
    const A = this._attrs;
    const fr = this.atlas?.frames?.[p.frame];
    const col = A.iColor.array;
    const o4 = slot * 4;
    if (!fr) {
      col[o4 + 3] = 0;
      this._dirty(slot);
      if (p.frame != null && !this._warned?.has(p.frame)) {
        (this._warned ??= new Set()).add(p.frame);
        console.warn(`[FxQuads] unknown atlas frame "${p.frame}"`);
      }
      return;
    }
    const n = fr.rects.length;
    let idx = (p.index ?? 0) | 0;
    idx = ((idx % n) + n) % n;
    const rect = fr.rects[idx];
    const scale = p.scale ?? 1;
    const pos = A.iPos.array;
    pos[o4] = p.x ?? 0;
    pos[o4 + 1] = p.y ?? 0;
    pos[o4 + 2] = p.z ?? 0;
    pos[o4 + 3] = p.rot ?? 0;
    const ax = A.iAxis.array;
    const w = (fr.w / 16) * scale;
    ax[o4] = p.flipX ? -w : w;
    ax[o4 + 1] = (fr.h / 16) * scale;
    ax[o4 + 2] = p.dirX ?? 0;
    ax[o4 + 3] = p.dirZ ?? 1;
    const uv = A.iUv.array;
    uv[o4] = rect[0];
    uv[o4 + 1] = rect[1];
    uv[o4 + 2] = rect[2];
    uv[o4 + 3] = rect[3];
    col[o4] = p.r ?? 1;
    col[o4 + 1] = p.g ?? 1;
    col[o4 + 2] = p.b ?? 1;
    col[o4 + 3] = p.a ?? 1;
    const md = A.iMode.array;
    const o3 = slot * 3;
    md[o3] = MODES[p.mode] ?? 0;
    const soft = p.soft ?? 0;
    md[o3 + 1] = soft > 0 ? Math.min(1, soft) : 0;
    const halo = p.halo ?? 0;
    const had = md[o3 + 2] > 0;
    md[o3 + 2] = halo > 0 ? Math.min(1, halo) : 0;
    if (had !== halo > 0) this._haloN += had ? -1 : 1;
    this._dirty(slot);
  }

  /**
   * Make the halo (see the class comment) — once; a later call only sets its strength. The caller
   * draws a quad with a weight at the warm-up, so the halo's program compiles at load. Every look
   * package calls it with no argument: the strength belongs to the batch (the last caller's wins).
   * @param {number} [strength] the glow's strength (`HALO_STRENGTH`)
   */
  enableHalo(strength = HALO_STRENGTH) {
    if (this.halo) {
      this.haloMaterial.uniforms.uStrength.value = strength;
      return;
    }
    this.haloMaterial = new THREE.ShaderMaterial({
      name: 'FxQuadsHalo',
      uniforms: {
        uMap: { value: this.material.uniforms.uMap.value },
        uHalo: { value: 1.9 },
        uStrength: { value: strength },
        uCameraYaw: globalUniforms.uCameraYaw,
      },
      vertexShader: HALO_VERTEX,
      fragmentShader: HALO_FRAGMENT,
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    this.haloMaterial.customProgramCacheKey = () => 'luminati-fxquads-halo-v1';
    const halo = new THREE.InstancedMesh(this.geometry, this.haloMaterial, this.capacity);
    halo.name = `${this.object.name}:halo`;
    halo.count = this._count;
    halo.visible = this._haloN > 0;
    halo.frustumCulled = false;
    halo.castShadow = false;
    halo.receiveShadow = false;
    halo.matrixAutoUpdate = false;
    halo.renderOrder = 1;
    this.object.add(halo);
    this.halo = halo;
  }

  /** @param {number} h handle to release (ignored when already free) */
  free(h) {
    const slot = h >= 0 && h < this.capacity ? this._slotOf[h] : -1;
    if (slot < 0) return;
    if (this._attrs.iMode.array[slot * 3 + 2] > 0) this._haloN--;
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
    this._haloN = 0;
    this._countDirty = true;
  }

  /** Once per frame: upload dirty ranges, set the draw count and `object.visible` (count > 0). */
  update() {
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
    if (this.halo) {
      this.halo.count = this._count;
      this.halo.visible = this._haloN > 0;
    }
  }

  /** Live quads. */
  get count() { return this._count; }

  dispose() {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.haloMaterial?.dispose();
    this.halo?.dispose?.();
    this.object.dispose?.();
  }

  /** @internal extend the dirty slot range */
  _dirty(slot) {
    if (slot < this._dirtyMin) this._dirtyMin = slot;
    if (slot > this._dirtyMax) this._dirtyMax = slot;
  }
}
