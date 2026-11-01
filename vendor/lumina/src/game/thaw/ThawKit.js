import * as THREE from 'three';
import { snowCover, GROUND_GLSL, FOLIAGE_GLSL } from '../SnowCover.js';
import { globalUniforms } from '../../engine/render/GlobalUniforms.js';
import { frostOf } from '../LevelLook.js';
import { thawField } from '../../engine/world/ThawField.js';
import { CUTOUT_BITS } from './ThawFx.js';

/**
 * The frozen year's kit (docs/contracts/EVERMERE_CAMPAIGN.md §6.1): the thaw patch, the ice on the
 * water, the frozen waterfalls and what a level with `environment.frost` gets when its world is
 * built (`prepareWorld`). A chunk of its own (SnowCover `loadThawKit`): World loads it for a level
 * with a frost, the editor's preview for one it shows; no other level downloads it.
 *
 * **The thaw patch.** A thaw variant of the snow-cover patch (src/game/SnowCover.js) with its own
 * program cache key, chained onto every lit surface of a frozen level's world — terrain, outer
 * ground, ground growth, roofs, walls, rocks, crags, props, tree bark and canopies (`patchMaterial`;
 * a material the texture library shares between levels is cloned first, so no other level's
 * program changes). It reads the shared uniforms (`THAW_UNIFORMS`): up to four rings — the front
 * and ≤ 3 local patches, [x, z, radius, —], a radius < 0 is none — and the frost [how frozen the
 * level is as a whole (1 … 0), its snow cover]. Where a point is frozen: the frost's snow on what
 * faces up (a snow cap on the crowns' upper half: their cards' normals point out of the crown) and
 * every surface drained ≈ 35 % toward a cool luminance. Past the front: a 0.75 u melt edge dithered
 * 4 × 4 at the 1/16-u texel grid, ≈ 4 u of wet ground (albedo × 0.78, a faint blue sheen), then the
 * season's colour back over 4 u; the radius wobbles ± 1.2 u with the place (the thaw field's
 * `thawWobble`, the same noise); water leads by 3 u; a canopy sways once as the front passes
 * (vertex, no work per tree). World positions come from `vViewPosition` (R^T · view + camera). With
 * the frost at 0 every term is skipped: the weather's snow alone, as the plain patch draws it.
 *
 * **Ice.** The water's one program gets the ice layer (`patchWater`): pale teal ice (#cfe8f0 …
 * #1e4a66) in bands by depth and noise, crack lines, snow specks, no motion, a reflection ≤ 0.25;
 * dissolved by the same dithered edge (3 u ahead of the land), dark leads where the water was just
 * freed. `frost.ice: true`: walk surfaces on the water while it is frozen (`iceChunks`, held by
 * World and switched by its `applyStory`).
 *
 * **Frozen falls** (`frost.falls: true`): each fall's sheet and pool get a private still time and
 * the ice's colours (`freezeFalls`); no mist, spray or roar. Thawed, the time runs again from where
 * it stood (no jump) — no program changes either way.
 *
 * **The editor's preview** (`previewFrost`, the editor's 3D view with the atmosphere on): the ice
 * on the water, the frost, no rings, and the thaw field frozen — the one writer of the field outside
 * the game's LevelStates (EVERMERE_CAMPAIGN.md §7.1: written only by the thaw package).
 *
 * @import { World } from '../World.js'
 * @import { Water } from '../../engine/world/Water.js'
 * @import { Weather } from '../Weather.js'
 * @import { Particles } from '../../engine/fx/Particles.js'
 */

/**
 * The shared uniforms of every thaw-patched material (one write updates all): `uThawRing` the four
 * rings, `uThawFrost` [frozen amount, snow cover, 0, 0].
 */
export const THAW_UNIFORMS = Object.freeze({
  uThawRing: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -1, 0)) },
  uThawFrost: { value: new THREE.Vector4(0, 1, 0, 0) },
});

/**
 * Copy the thaw field's rings and the frost into the uniforms (every frame the thaw runs).
 * @param {{ rings: Float32Array }} field
 * @param {number} frozen how frozen the level is as a whole (1 … 0)
 * @param {number} cover the frost's snow cover
 */
export function syncUniforms(field, frozen, cover) {
  const R = field.rings;
  const v = THAW_UNIFORMS.uThawRing.value;
  for (let k = 0; k < 4; k++) v[k].set(R[k * 4], R[k * 4 + 1], R[k * 4 + 2], 0);
  THAW_UNIFORMS.uThawFrost.value.set(frozen, cover, 0, 0);
}

// -------------------------------------------------------------------------------------------------
// GLSL
// -------------------------------------------------------------------------------------------------

/** The rings, the noise and the dither (ThawField.js mirrors `thH`, `thN` and the wobble). */
const THAW_PARS = /* glsl */ `
uniform vec4 uThawRing[4];
uniform vec4 uThawFrost;
float thH(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float thN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(thH(i),thH(i+vec2(1.,0.)),f.x),mix(thH(i+vec2(0.,1.)),thH(i+1.),f.x),f.y);}
float thB2(vec2 a){a=floor(a);return fract(dot(a,vec2(.5,a.y*.75)));}
float thB4(vec2 a){return thB2(.5*a)*.25+thB2(a);}
float thS(vec2 p,float lead){
  float s=(1.-uThawFrost.x)*8.75;
  float w=(thN(p*.21)*.65+thN(p*.53+7.1)*.35-.5)*2.4;
  for(int i=0;i<4;i++){vec4 R=uThawRing[i];if(R.z>=0.)s=max(s,(R.z+lead+w-distance(p,R.xy))*clamp(11.67/max(R.z,.01),1.,6.));}
  return s;
}
float thFrozen(float s,vec2 px){return s<.75?step(s/.75,thB4(px)):0.;}
`;

/**
 * The frozen look of a lit surface at its world point `thW` and texel `thPx`: the colour drained
 * (by `drain`), the wet band, the frost's snow (`snowK` raised to `frost` where frozen). Needs
 * snowL, snowK.
 * @param {string} drain @param {string} frost GLSL expressions
 */
const thawSurface = (drain, frost) => /* glsl */ `
  if(uThawFrost.x>0.){
    float thSn=thS(thW.xz,0.);
    float thF=thFrozen(thSn,thPx);
    float thWet=(1.-thF)*(1.-smoothstep(4.75,8.75,thSn));
    diffuseColor.rgb=mix(diffuseColor.rgb,snowL*vec3(.9,.96,1.12),${drain}*max(thF,thWet));
    diffuseColor.rgb=diffuseColor.rgb*mix(vec3(1.),vec3(.74,.78,.86),thWet)+vec3(0.,.004,.012)*thWet;
    snowK=max(snowK,thF*uThawFrost.y*${frost});
  }
`;
const THAW_SURFACE = thawSurface('.35', '1.');

/** World position of a Lambert fragment (R^T · view position + camera). */
const THAW_WORLD = 'vec3 thW=(vec4(-vViewPosition,0.)*viewMatrix).xyz+cameraPosition;';

/** Lit snow: a cool white, shaded by the texel's own brightness (the pixels still read). */
const THAW_SNOW = 'mix(vec3(.46,.55,.72),vec3(.72,.78,.88),smoothstep(.02,.25,snowL))';

/** Terrain, roofs, walls, rocks, props, bark: snow on what faces up, the texel grid on the face. */
const GROUND_THAW = /* glsl */ `
{
  ${THAW_WORLD}
  vec3 snowN=inverseTransformDirection(normal,viewMatrix);
  float snowUp=smoothstep(.5,.86,snowN.y);
  float snowL=dot(diffuseColor.rgb,vec3(.299,.587,.114));
  float snowK=uSnowCover;
  vec3 thA=abs(snowN);
  vec2 thPx=floor((thA.y>.5?thW.xz:thA.x>thA.z?thW.zy:thW.xy)*16.);
  ${THAW_SURFACE}
  snowK*=snowUp*(.7+.25*smoothstep(.02,.2,snowL));
  diffuseColor.rgb=mix(diffuseColor.rgb,${THAW_SNOW},snowK);
}
`;

/** Tree crowns (camera-facing cards, normals out of the crown): a cap on the lit leaves on top. */
const CANOPY_THAW = /* glsl */ `
{
  ${THAW_WORLD}
  vec3 snowN=inverseTransformDirection(normal,viewMatrix);
  float snowL=dot(diffuseColor.rgb,vec3(.299,.587,.114));
  float snowUp=smoothstep(.1,.62,snowN.y)*smoothstep(.04,.18,snowL);
  float snowK=uSnowCover;
  vec2 thPx=floor(thW.xy*16.);
  ${THAW_SURFACE}
  snowK*=snowUp*.92;
  diffuseColor.rgb=mix(diffuseColor.rgb,${THAW_SNOW},snowK);
}
`;

/**
 * Ground growth (upright sprites): the weather's frost on the upper blade; the frozen level's
 * rime over most of it, the colour drained harder (a frozen meadow reads white, not green).
 */
const FOLIAGE_THAW = /* glsl */ `
{
  ${THAW_WORLD}
  float snowL=dot(diffuseColor.rgb,vec3(.299,.587,.114));
  float snowK=uSnowCover*smoothstep(.2,.95,vQuadUv.y)*.72;
  vec2 thPx=floor(vec2(thW.x+thW.z,thW.y)*16.);
  ${thawSurface('.55', 'smoothstep(-.1,.7,vQuadUv.y)*.86')}
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.72,.78,.88)*(.72+.5*sqrt(snowL)),snowK);
}
`;

/** The crown's sway as the front passes (after the wind, before projection; billboard cards). */
const CANOPY_PULSE = /* glsl */ `
#ifdef FOLIAGE_BILLBOARD
{
  vec4 thR=uThawRing[0];
  vec3 thC=(modelMatrix*vec4(aCenter,1.)).xyz;
  float thSn=thR.z-distance(thC.xz,thR.xy);
  if(thR.z>=0.&&thSn>0.&&thSn<7.){
    vec2 thD=normalize(thC.xz-thR.xy+vec2(1e-3,0.));
    float thK=sin(thSn*1.7)*exp(-thSn*.45)*aSway*.16;
    mat3 thM=mat3(modelMatrix);
    transformed+=(vec3(thD.x,.35,thD.y)*thK*thM)/max(dot(thM[0],thM[0]),1e-6);
  }
}
#endif
#include <project_vertex>
`;

/**
 * The ice on the water (before the water's saturation; `col`, `alpha`, `irrUp`, `sky`, `V` in
 * scope): ice where the front has not reached — 3 u ahead of the land — dissolved by the dithered
 * edge; dark leads in the water just freed.
 */
const WATER_ICE = /* glsl */ `
  if(uThawFrost.x>0.){
    bool thSide=vWorldNormal.y<.5;
    vec2 thIp=thSide?vec2(dot(vWorldPos.xz,vec2(-vWorldNormal.z,vWorldNormal.x)),vWorldPos.y):vWorldPos.xz;
    vec2 thPx=floor(thIp*16.);
    float thSn=thS(vWorldPos.xz,3.);
    float thIce=thFrozen(thSn,thPx);
    if(thIce>0.){
      vec2 thC=(thPx+.5)/16.;
      float thDep=thSide?1.:texture2D(uShore,(thC-uShoreRect.xy)*uShoreRect.zw).g*uMaxDepth;
      float thQ=floor(clamp((thN(thC*.55)*.55+thN(thC*1.7+3.7)*.3+clamp(thDep/.5,0.,1.)*.45)*2.6-.3+(thB4(thPx)-.5)*.5,0.,2.));
      vec3 thA=thQ<.5?vec3(.624,.807,.871):thQ<1.5?vec3(.262,.527,.672):vec3(.068,.246,.392);
      float thCr=abs(thN(thC*1.15+11.)-.5);
      thA=mix(thA,thQ>1.5?vec3(.013,.068,.133):vec3(.068,.246,.392),step(thCr,.018)*step(.4,thN(thC*.5+5.)));
      thA=mix(thA,vec3(.855,.905,.939),step(.955,thH(thPx+17.))*step(thQ,1.5));
      if(thSide)thA=mix(vec3(.068,.246,.392),vec3(.262,.527,.672),step(.5,fract(thPx.y*.25+thH(vec2(thPx.x,3.))*.5)));
      vec3 thCol=thA*irrUp*(thSide?.8:1.);
      thCol=mix(thCol,sky,.1+.15*pow(1.-clamp(V.y,0.,1.),3.));
      col=mix(col,thCol,thIce);
      alpha=mix(alpha,1.,thIce);
    } else col*=mix(vec3(.55,.62,.72),vec3(1.),smoothstep(.75,6.,thSn));
  }
`;

/** The water's line the ice goes before (Water.js WATER_FRAG). */
const WATER_ANCHOR = 'col = lmSaturate(col, mix(uSaturation, 1.0, night));';

// -------------------------------------------------------------------------------------------------
// Patching
// -------------------------------------------------------------------------------------------------

/** @typedef {'ground'|'foliage'|'canopy'} ThawKind */

/**
 * Chain the thaw patch onto a lit (Lambert) material: in place of its plain snow patch if it has
 * one, else before its emissive. Its program cache key gains `|luminati-thaw-<kind>`. Idempotent.
 * @param {THREE.Material} material
 * @param {ThawKind} kind
 */
export function patchMaterial(material, kind) {
  if (!material || material.userData.luminatiThaw) return;
  material.userData.luminatiThaw = kind;
  // (the plain patch's block, if it carries one: replaced by the thaw variant)
  const plain = material.userData.luminatiSnow === 'foliage' ? FOLIAGE_GLSL : material.userData.luminatiSnow ? GROUND_GLSL : null;
  material.userData.luminatiSnow = `thaw-${kind}`;
  const prev = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey();
  const block = kind === 'foliage' ? FOLIAGE_THAW : kind === 'canopy' ? CANOPY_THAW : GROUND_THAW;
  material.onBeforeCompile = function onBeforeCompileThaw(shader, renderer) {
    prev.call(this, shader, renderer);
    shader.uniforms.uSnowCover = snowCover;
    shader.uniforms.uThawRing = THAW_UNIFORMS.uThawRing;
    shader.uniforms.uThawFrost = THAW_UNIFORMS.uThawFrost;
    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', `#include <common>\n${fs.includes('uniform float uSnowCover;') ? '' : 'uniform float uSnowCover;\n'}${THAW_PARS}`);
    fs = plain && fs.includes(plain) ? fs.replace(plain, block) : fs.replace('#include <emissivemap_fragment>', `${block}\n#include <emissivemap_fragment>`);
    shader.fragmentShader = fs;
    if (kind === 'canopy') {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uThawRing[4];')
        .replace('#include <project_vertex>', CANOPY_PULSE);
    }
  };
  material.customProgramCacheKey = () => `${baseKey}|luminati-thaw-${kind}`;
  material.needsUpdate = true;
}

/**
 * Chain the ice layer onto a water surface's material (one program still; at frost 0 the layer is
 * skipped). Idempotent.
 * @param {Water|null|undefined} water
 */
export function patchWater(water) {
  const m = water?.material;
  if (!m || m.userData.luminatiThaw) return;
  m.userData.luminatiThaw = 'water';
  const prev = m.onBeforeCompile;
  const baseKey = m.customProgramCacheKey();
  m.onBeforeCompile = function onBeforeCompileIce(shader, renderer) {
    prev.call(this, shader, renderer);
    shader.uniforms.uThawRing = THAW_UNIFORMS.uThawRing;
    shader.uniforms.uThawFrost = THAW_UNIFORMS.uThawFrost;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${THAW_PARS}\nvoid main() {`)
      .replace(WATER_ANCHOR, `${WATER_ICE}\n  ${WATER_ANCHOR}`);
  };
  m.customProgramCacheKey = () => `${baseKey}|luminati-ice`;
  m.needsUpdate = true;
}

/**
 * The thaw patch on every lit surface of a world: Lambert materials under its root (not the
 * shadow-only proxies, the windows and lantern glass the lighting drives, or anything unlit), the
 * texture library's shared ones cloned for this world (the clones go with its prop factory). The
 * water gets the ice.
 * @param {World} world
 */
function patchWorld(world) {
  /** @type {Set<THREE.Material>} */
  const library = new Set(world.textures._materials.values());
  // (the lighting holds these: their emissive is driven by registration — left as they are)
  /** @type {Set<THREE.Material>} */
  const keep = new Set(world.emissiveEntries.map((e) => e.material));
  if (world.glassMaterial) keep.add(world.glassMaterial);
  /** @type {Set<THREE.Material>} */
  const fields = new Set(world.groundDetail?.fields.map((f) => f.material) ?? []);
  /** @type {Map<THREE.Material, THREE.Material>} a shared material → this world's clone */
  const clones = new Map();
  world.root.traverse((/** @type {THREE.Mesh} */ o) => {
    const m = o.isMesh ? o.material : null;
    if (!m || Array.isArray(m) || !(/** @type {THREE.MeshLambertMaterial} */ (m)).isMeshLambertMaterial || !m.colorWrite || keep.has(m)) return;
    const kind = fields.has(m) ? 'foliage' : m.userData.billboard ? 'canopy' : 'ground';
    if (!library.has(m)) {
      patchMaterial(m, kind);
      return;
    }
    let c = clones.get(m);
    if (!c) {
      c = m.clone();
      c.onBeforeCompile = m.onBeforeCompile;
      c.customProgramCacheKey = m.customProgramCacheKey;
      c.userData = { ...m.userData };
      patchMaterial(c, kind);
      clones.set(m, c);
      world.factory._ownMaterials.add(c);
    }
    o.material = c;
  });
  patchWater(world.water);
}

// -------------------------------------------------------------------------------------------------
// Ice to walk on
// -------------------------------------------------------------------------------------------------

/**
 * One piece of walkable ice (≤ 8 × 8 tiles of one water surface): its walk surface and whether
 * it is there now.
 * @typedef {{ rect: { minX: number, maxX: number, minZ: number, maxZ: number, y: number }, on: boolean }} IceChunk
 */

/**
 * The level's water tiles as walk rectangles: runs of one surface height, at most 8 × 8 tiles
 * each (few rectangles: TileMap scans them on every height query), in row order.
 * @param {World['tileMap']} tm
 * @returns {IceChunk[]}
 */
export function iceChunks(tm) {
  const W = tm.width;
  const D = tm.depth;
  const surf = new Float32Array(W * D).fill(NaN);
  tm.forEachTile((i, j, t) => { if (t.water) surf[j * W + i] = t.waterSurface; });
  const used = new Uint8Array(W * D);
  const free = (i, j, y) => i < W && j < D && !used[j * W + i] && surf[j * W + i] === y;
  /** @type {IceChunk[]} */
  const out = [];
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < W; i++) {
      const y = surf[j * W + i];
      if (y !== y || used[j * W + i]) continue;
      let w = 1;
      while (w < 8 && free(i + w, j, y)) w++;
      let d = 1;
      while (d < 8) {
        let row = true;
        for (let k = 0; k < w && row; k++) row = free(i + k, j + d, y);
        if (!row) break;
        d++;
      }
      for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) used[(j + b) * W + i + a] = 1;
      out.push({ rect: { minX: i, maxX: i + w, minZ: j, maxZ: j + d, y: y + 0.02 }, on: false });
    }
  }
  return out;
}

// -------------------------------------------------------------------------------------------------
// Frozen falls
// -------------------------------------------------------------------------------------------------

/** The ice's colours (linear): pale, body, deep, dark, snow. */
const ICE = [[0.624, 0.807, 0.871], [0.262, 0.527, 0.672], [0.068, 0.246, 0.392], [0.013, 0.068, 0.133], [0.855, 0.905, 0.939]];
/** A frozen fall's sheet / pool uniform → the ice colour it takes (ICE index). */
const FALL_ICE = { sheet: { uC0: 1, uC1: 2, uC2: 3, uC3: 0, uFoam: 4 }, pool: { uFoam: 4, uC0: 0 } };

/**
 * A waterfall's materials and what freezing changes in them.
 * @param {THREE.Object3D} root its BuiltObject's object
 * @returns {{ m: THREE.ShaderMaterial, kind: 'sheet'|'pool' }[]}
 */
function fallMaterials(root) {
  const out = [];
  root.traverse((/** @type {THREE.Mesh} */ o) => {
    const m = /** @type {THREE.ShaderMaterial} */ (o.isMesh ? o.material : null);
    if (m?.name === 'Luminati:Waterfall') out.push({ m, kind: 'sheet' });
    else if (m?.name === 'Luminati:WaterfallPool') out.push({ m, kind: 'pool' });
  });
  return out;
}

/**
 * Freeze or thaw a world's waterfalls (`frost.falls`): a still sheet in the ice's colours, no
 * mist, spray or roar — or running again from where its time stood. The fall `k` of `world.falls`
 * only (`k` omitted: every one). Returns the falls that changed.
 * @param {World} world
 * @param {Weather} weather
 * @param {boolean} frozen
 * @param {number} [only]
 * @returns {number[]}
 */
export function freezeFalls(world, weather, frozen, only = -1) {
  const changed = [];
  const now = globalUniforms.uTime.value;
  world.falls.forEach((f, k) => {
    if (only >= 0 && k !== only) return;
    const fall = /** @type {typeof f & { thaw?: { frozen: boolean, splash: boolean, at: number, mist: object[] } }} */ (f);
    const b = world.waterfalls[k];
    if (!b) return;
    fall.thaw ??= { frozen: false, splash: f.splash, at: now, mist: world.propEmitters.filter((e) => e.config?.preset === 'mist' && Math.hypot(e.position.x - f.anchor.x, e.position.z - f.anchor.z) < 2.5) };
    const st = fall.thaw;
    // (the weather forgets a world's mist when the next one is set: told again on every call)
    for (const e of st.mist) {
      if (frozen) weather.frozenMist.add(e);
      else weather.frozenMist.delete(e);
    }
    if (st.frozen === frozen) return;
    st.frozen = frozen;
    changed.push(k);
    for (const { m, kind } of fallMaterials(b.object)) {
      const u = m.uniforms;
      const saved = (m.userData.thawSaved ??= Object.fromEntries(Object.keys(FALL_ICE[kind]).map((n) => [n, u[n].value.clone()])));
      for (const [n, i] of Object.entries(FALL_ICE[kind])) {
        if (frozen) u[n].value.setRGB(ICE[i][0], ICE[i][1], ICE[i][2]);
        else u[n].value.copy(saved[n]);
      }
    }
    if (frozen) st.at = now;
    // the time: still while frozen; thawed, it runs on from where it stood (the pattern never jumps)
    const off = now - st.at;
    const time = frozen ? { value: st.at } : { get value() { return globalUniforms.uTime.value - off; } };
    for (const { m } of fallMaterials(b.object)) m.uniforms.uTime = time;
    f.splash = frozen ? false : st.splash;
  });
  if (changed.length) {
    world.fallAnchors.length = 0;
    for (const f of world.falls) if (f.splash && !f.hidden) world.fallAnchors.push(f.anchor);
  }
  return changed;
}

// -------------------------------------------------------------------------------------------------
// The world of a frozen level
// -------------------------------------------------------------------------------------------------

/**
 * The particle styles the thaw bursts (the front's steam, glints and snow clumps, the petals and
 * leaves, the cut-out bits of the toll and the frost foes' shatter, the falls' spray): one burst
 * each far below the world, so their pools — and programs — exist before the warm-up.
 * @param {Particles} particles
 */
export function primeThawPools(particles) {
  const far = { x: 0, y: -1000, z: 0 };
  const one = { life: [0.05, 0.05], size: [0.1, 0.1] };
  for (const p of ['smoke', 'sparkle', 'snow', 'petals', 'leaves', 'splash']) particles.burst(p, far, 1, one);
  particles.burst('splash', far, 1, { ...one, ...CUTOUT_BITS });
}

/**
 * Prepare a frozen level's world as it is built (World's snow-cover step, for a level with
 * `environment.frost`): the thaw patch on its surfaces, the ice on its water, its walkable ice
 * (`frost.ice`: `world.thawIce`, laid while the level is frozen as the story stands — World
 * `applyStory` switches it later), its pools primed when it goes into the running game.
 * @param {World} world
 */
export function prepareWorld(world) {
  const frost = frostOf(world.env);
  if (!frost) return;
  patchWorld(world);
  // frozen as the story stands (a world without a story: always) — `present` of a test object
  const test = /** @type {any} */ ({ unless: frost.until });
  const frozen = !world.story || !!world.story.present(test);
  if (frost.ice && world.water) {
    const chunks = iceChunks(world.tileMap);
    for (const c of chunks) {
      c.on = frozen;
      if (frozen) world.tileMap.addWalkSurface(c.rect);
    }
    world.thawIce = { chunks, test, at: null };
  }
  world._defer(() => primeThawPools(world.particles));
}

// -------------------------------------------------------------------------------------------------
// The editor's preview
// -------------------------------------------------------------------------------------------------

/**
 * The editor shows a frozen level frozen (Viewport3D, the atmosphere on): the ice on its water
 * (patched once), the frost at `frozen` (0 / 1), no rings — and the thaw field frozen (`active`,
 * `frozen`, `melt` 0, no rings: `at` reads 0 everywhere), so the props that read it show their
 * frozen state, as the game shows them before the bell (icicles, the ice on belfries, crags and
 * rocks, the ships' ice collars, the windmills still); `frozen` 0 leaves the field inactive (`at` →
 * 1), as on a level without a frost. Called every frame; the field is reset only when it changes
 * (a prop eases between its states over its own times, ≈ 1.5–4 s).
 * @param {Water|null} water
 * @param {number} frozen
 */
export function previewFrost(water, frozen) {
  if (water && frozen > 0) patchWater(water);
  for (const v of THAW_UNIFORMS.uThawRing.value) v.set(0, 0, -1, 0);
  THAW_UNIFORMS.uThawFrost.value.set(frozen, 1, 0, 0);
  const on = frozen > 0;
  if (thawField.active !== on || thawField.frozen !== on) thawField.reset(on, on);
}
