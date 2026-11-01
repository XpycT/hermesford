import * as THREE from 'three';
import { buildLevelTerrainSteps, LevelObjectBuilder } from '../engine/level/ObjectBuilder.js';
import { mergeTreeSteps, scatterForestSteps, forestKindAreas, makeOuterHeight, outerGroundSteps, sceneryProp } from './Scenery.js';
import { climateDust } from './Climate.js';
import { blazeOf } from './AudioDirector.js';
import { groundDetailSteps } from './GroundDetail.js';
import { addSnowCover, ROOF_MATERIAL, thawKit, loadThawKit } from './SnowCover.js';
import { LightPool, sanitizeLightDescriptors } from '../engine/lighting/LightPool.js';
import { shadowCasterSteps, isProxyCaster } from '../engine/world/ShadowCasters.js';
import { runSteps } from '../engine/utils/steps.js';
import { cullByBox, CollapsibleRanges } from '../engine/world/SpatialSplit.js';
import { waterfallDir } from '../engine/world/Water.js';
import { boxUnion } from '../engine/world/Props.js';
import { levelNeedsSetPieceKit, loadSetPieceKit, setPieceKit } from '../engine/world/SetPieceKit.js';
import { levelNeedsSeasonKit, loadSeasonKit, seasonKit } from '../engine/world/SeasonKit.js';
import { SMOKE, DUST_BOX, SMALL_LEVEL, BIG_FOLIAGE_INSTANCES, waterfallMist, southGap, godRayLayout, groundDetailArgs, forestBorderOn, outerSceneryOn, climateOf, seasonOf, frostOf } from './LevelLook.js';
import { LIVE_STORY_TYPES, hasStoryCondition } from '../engine/level/Travel.js';
import { LEVEL_MAP_TYPES } from '../engine/level/LevelMap.js';
// (the loading screen's step names: namespace 'game', docs/specs/I18N.md §2)
import { t } from '../engine/i18n/I18n.js';
import { textPages, pageKeyOf } from '../engine/i18n/ContentKeys.js';

/**
 * @import { Engine } from '../engine/core/Engine.js'
 * @import { GodRays } from '../engine/fx/GodRays.js'
 * @import { Particles, PARTICLE_PRESETS } from '../engine/fx/Particles.js'
 * @import { Level, LevelEnvironment, LevelObject } from '../engine/level/types.js'
 * @import { LightingSystem } from '../engine/lighting/LightingSystem.js'
 * @import { TextureLibrary } from '../engine/pixel/Textures.js'
 * @import { PropResult } from '../engine/world/Props.js'
 * @import { Game } from './Game.js'
 * @import { BuiltObject } from '../engine/level/ObjectBuilder.js'
 * @import { SolidMesh } from '../engine/render/types.js'
 */

/** Point-light budget (ARCHITECTURE §1): every light is created before the first frame. */
export const MAX_POINT_LIGHTS = 12;

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

/** The words of a story condition (the thaw runtime splits them the same way). */
const NAME_SPLIT = /[^A-Za-z0-9_:.\-]+/;
/**
 * The names a level's frost `until` reads (its words but `and` / `or` / `not`); empty without a frost.
 * @param {Partial<LevelEnvironment>} env
 * @returns {Set<string>}
 */
function frostNames(env) {
  const until = frostOf(env)?.until ?? '';
  return new Set(until.split(NAME_SPLIT).filter((w) => w && !/^(and|or|not)$/i.test(w)));
}

/** Level types World builds in its first pass (props); trees and waterfalls follow separately. */
const LATE_TYPES = new Set(['tree', 'waterfall']);

/**
 * Spatial batching of big levels. Levels up to SMALL_LEVEL tiles on both axes keep one batch per
 * material (the batching they were tuned with). Bigger levels cut every batch into spatially
 * compact pieces (SpatialSplit.kdSplit) of a triangle / instance budget, so the camera and the
 * shadow pass cull what they cannot see while the draw calls stay few:
 *  - terrain: TileMap chunks of `terrainChunk` tiles, then per material merged back into
 *    batches of ≤ `terrainTriangles` over ≤ `terrainExtent` units (a material lighter than
 *    `terrainMinTriangles` in all: one batch) (TileMap.consolidateChunks);
 *  - static props (PropFactory.mergeStatic): per material ≤ `propTriangles`, and batches above
 *    `minTriangles` span ≤ `propExtent` units; trees — map, border and outer forest
 *    (Scenery.mergeTrees) — likewise with `treeTriangles` / `treeExtent`;
 *  - ground foliage: ≤ `foliageInstances` tufts per instanced mesh (GroundDetail);
 *  - shadows of the opaque props and terrain faces: shadow-only proxies merged across materials,
 *    ≤ `casterTriangles` over ≤ `casterExtent` units each (ShadowCasters) — the depth pass needs
 *    no materials, so it costs a few draw calls instead of one per material and region.
 * Every batch is culled by its world bounding box (SpatialSplit.cullByBox). The shadow frustum's
 * depth is limited to `shadowUp` / `shadowDown` units around its centre
 * (LightingSystem.setShadowDepthRange, set by the game), so casters far up-sun are culled too.
 * Measured trade-off (docs/contracts/LEVEL_EDITOR.md §5): finer pieces cut few more triangles but add draw
 * calls; these budgets keep a busy 128 × 128 village under ~300 calls with the shadow pass.
 */
export const BIG_LEVEL_BATCHING = Object.freeze({
  terrainChunk: 32,
  terrainTriangles: 48000,
  terrainExtent: 48,
  terrainMinTriangles: 12000,
  propTriangles: 16000,
  propExtent: 64,
  treeTriangles: 16000,
  treeExtent: 96,
  minTriangles: 3000,
  casterTriangles: 96000,
  casterExtent: 64,
  foliageInstances: BIG_FOLIAGE_INSTANCES,
  shadowUp: 60,
  shadowDown: 45,
  // particle areas, waterfall mist and chimney smoke whose box is farther than this from the camera
  // focus are switched off (one draw call each; that far out — the top corners of a zoomed-out
  // view — they are specks in the tilt-shift blur). The default view reaches ~32 units.
  particleCull: 34,
});

/**
 * Something the player can examine (Game._findInteractable / Game._interact).
 * @typedef {object} Interactable
 * @property {string} id
 * @property {THREE.Vector3} position   where it is examined from (a door: the door-step point)
 * @property {number} radius            reach
 * @property {string} label             the prompt's verb ('Knock', 'Read' …; the combat system
 *                                      relabels chests 'Open' and waystones 'Rest'), in English:
 *                                      the prompt shows it in the page's language
 *                                      (Game.js `promptLabel`, docs/specs/PIXEL_UI.md §8.1)
 * @property {string} kind              'door' | 'sign' | 'well' | 'chest' | 'waystone'
 * @property {THREE.Vector3} prompt     where the prompt is drawn
 * @property {{ a: THREE.Vector3, b: THREE.Vector3 }|null} lookSpan
 *   a segment the player may face instead of `position` (a door's leaf; see `_interact`)
 * @property {{ minX: number, maxX: number, minZ: number, maxZ: number }} [area]
 *   a rectangle (a campaign's Space exit, a story's Space event): standing in it offers this
 *   whichever way the player faces — the player may walk past its centre to its far end
 * @property {InteractText} text       what examining shows (Game._interact), in English
 * @property {LevelObject} [object]     chests and waystones: the level object
 * @property {PropResult['controls']|null} [prop]   chests and waystones: the prop's `controls`
 * @property {boolean} [disabled]       set by the combat system on an opened chest: offers nothing
 * @property {(game: Game, it: Interactable) => unknown} [onInteract]
 *   set by the combat system on chests and waystones (open / rest) instead of showing `text`
 */

/**
 * What examining an interactable shows (Game._interact), as the level holds it — English, translated
 * at display (docs/specs/I18N.md §4.5, §4.8). The pages of a `lines` field carry the text keys their
 * object holds for them (`keys`), so the display shows each page by its key: `loc(keys[k], lines[k])`.
 * @typedef {object} InteractText
 * @property {string} speaker    the name plate, English ('' none): a sign's `speaker` (a term), a
 *   waystone's `name`
 * @property {string[]} lines    the pages, English (one dialog page each)
 * @property {string} [sfx]      a sound played first (a well's splash)
 * @property {string[]} [keys]   each page's text key (ContentKeys.js `pageKeyOf` of the object's
 *   `text` at the page's raw index, `textPages`; '' for a page without one: shown in English, a
 *   `nokey` miss). Absent: the pages are shown as they are (an interactable without level text)
 * @property {string} [speakerDefault] the plate is a code default for a blank one:
 *   `t('game.default.<id>')` (`signpost`, `waystone`)
 * @property {string} [linesDefault]   the page is a code default: `t('game.default.<id>')`
 *   (`chest`, `waystoneText`)
 */

/**
 * The objects of a live story group (docs/specs/STORY_SCRIPT.md §9.5): props — houses, windmills,
 * wells and waterfalls among them — and particle areas that share a `when` / `unless` pair, shown
 * and hidden together as the story changes (`World.applyStory`). Their meshes are merged into the
 * level's own batches (and, on a big level, its shadow proxies) like any prop's; the group owns
 * vertex ranges there (`World.storyRanges`), collapsed while it is absent.
 * @typedef {object} StoryGroup
 * @property {string} key       `<when>\u0000<unless>`
 * @property {LevelObject} sample   one of its objects (their conditions are the same)
 * @property {boolean} present
 * @property {THREE.Object3D[]} objects   the props' own roots in the scene: what the merge leaves
 *   there (flame billboards and glows, wind-swayed, animated — a windmill's sails — or mirrored
 *   meshes; a waterfall's sheet and foam pool)
 * @property {any[]} colliders
 * @property {any[]} walkRects
 * @property {Interactable[]} interactables
 * @property {any[]} emitters   chimney smoke, campfire embers, waterfall mist, particle areas
 * @property {any[]} lights     light descriptors (as built; the pool's sanitised copies in `poolLights`)
 * @property {any[]} poolLights
 * @property {THREE.Vector3[]} fires   its campfires' anchors (World.fires holds them while present)
 * @property {object[]} falls   its waterfalls (World.falls entries; `fallAnchors` holds the roaring
 *   ones while present)
 * @property {boolean} mapped   it has an object the level map paints (LEVEL_MAP_TYPES)
 */

/**
 * World — builds a Luminati level (docs/contracts/LEVEL_EDITOR.md) into the scene: terrain and water via
 * `buildLevelTerrain`, every prop through `LevelObjectBuilder`, then the diorama polish — static
 * mesh batching (PropFactory.mergeStatic), tree merging (Scenery.mergeTrees), the forest border
 * and the fogged outer scenery, ground foliage, snow cover, the ≤ 12 point lights by priority,
 * particle areas and god rays.
 *
 * Every BuiltObject is wired: lights → LightingSystem.addPointLight, emissives → registerEmissive,
 * emitters → Particles.createEmitter, colliders → TileMap.addCollider, walkRects →
 * TileMap.addWalkSurface, update() → per frame.
 *
 * Game-facing results: `interactables` (door / sign / well texts; chests and waystones with their
 * level `object` and prop `controls`), `fires` and `fallAnchors` (the ambience's crackle and roar:
 * what is there now), `falls` (spray anchors), `areaEmitters` (particle areas the weather drives),
 * `lights`, `emissiveEntries`.
 *
 * Built ahead (a campaign's next level, KNOWN_ISSUES CMP-01): a world made with `defer: true` is
 * built by `buildSteps({ paced: true })` in time slices while the player still plays the level
 * before it, and touches nothing of the running game meanwhile — its root waits outside the scene,
 * and what goes into the engine's shared systems (the emissive registrations, the props' and
 * waterfalls' emitters, the lights and the atmosphere) waits in `_pending` until `attach()`, which
 * the travel calls where `build()` would have run, in the same order.
 *
 * Set aside (a campaign's level the player will come back to: the town while they are in a room,
 * the last room — docs/specs/CAMPAIGN_FORMAT.md §6.3): `detach()` takes an attached world out of
 * the running game again — its root out of the scene, its emissive registrations, emitters and
 * god-ray shafts out of the lighting, the particles and the god rays, the prompts others added to
 * `interactables` dropped — without disposing anything, so every material, geometry and program
 * stays; `attach()` puts it all back (the lights handed to the shared pool again). Only a world
 * that uses a campaign's shared light pool can be detached.
 */
export class World {
  /**
   * @param {{ engine: Engine, textures: TextureLibrary, lighting: LightingSystem, particles: Particles,
   *           godRays: GodRays, level: Level, lightPool?: LightPool|null,
   *           story?: { present: (o: LevelObject) => boolean }|null, defer?: boolean }} ctx  level: a normalised
   *   Luminati level; lightPool: a `fixed` pool the game keeps across levels (a campaign: the next
   *   level hands it its descriptors, so the light count — and every lit program — stays; the
   *   world does not dispose it). Without one the world makes its own (a single level).
   *   story: a level played with a story — whether an object is there as the story stands; the
   *   props of `LIVE_STORY_TYPES` with a condition are built as live groups (`applyStory`). null:
   *   every object as built (a level without a story; nothing changes for it).
   *   defer: built ahead of a travel (see the class notes): nothing reaches the running game
   *   before `attach()`
   */
  constructor({ engine, textures, lighting, particles, godRays, level, lightPool = null, story = null, defer = false }) {
    this.engine = engine;
    this.scene = engine.scene;
    this.textures = textures;
    this.lighting = lighting;
    this.particles = particles;
    this.godRays = godRays;
    this.level = level;
    /** The game's shared light pool (campaigns), or null: `_wireLights` makes the world's own. */
    this._sharedPool = lightPool;
    /**
     * The game's combat VFX lights (Game `vfxLights`, set by `_buildLevel` while this world is the
     * running one), or null: what `acquireSpellLight` hands out. Never the world's own — the lamps'
     * pool lends nothing.
     * @type {import('../engine/lighting/VfxLights.js').VfxLights|null}
     */
    this.vfxLights = null;
    /** The story's presence test (see the constructor), or null. */
    this.story = story;
    /** @type {Map<string, StoryGroup>} live story groups by condition pair */
    this.storyGroups = new Map();
    /** @type {Map<any, StoryGroup>} emitter → its story group (the big-level particle cull) */
    this._emitterGroup = new Map();
    /** @type {Map<PropResult, StoryGroup>} a live story prop's result → its group (the merges' `tags`) */
    this._storyTags = new Map();
    /**
     * The live story groups' vertex ranges in the merged batches and shadow proxies (tag = the
     * StoryGroup): an absent group's are collapsed (`applyStory`).
     */
    this.storyRanges = new CollapsibleRanges();
    /** @type {Partial<LevelEnvironment>} ({} without one) */
    this.env = level.environment ?? {};
    /**
     * A world built ahead (`defer`): what goes into the running game, in build order, until
     * `attach()` (null: done at once).
     * @type {(() => void)[]|null}
     */
    this._pending = defer ? [] : null;
    /**
     * In the running game (built there, or `attach()`ed); false while built ahead or set aside
     * (`detach()`).
     */
    this.attached = !defer;
    /** The god-ray shafts this world populated (`_buildAtmosphere`): its own, disposed with it. */
    this.shafts = [];
    /**
     * How many of `interactables` the world made itself (the rest — a campaign's Space exits, a
     * story's Space events — are added by others after the build and dropped by `detach()`).
     */
    this._ownInteractables = 0;
    this.root = new THREE.Group();
    this.root.name = 'World';
    this._defer(() => this.scene.add(this.root));

    this.tileMap = null;
    this.water = null;
    this.terrain = null;
    this.builder = null;
    this.factory = null;
    /** Every BuiltObject (props, trees, waterfalls) in build order. */
    this.built = [];
    /** PropResults batched by mergeStatic. */
    this.results = [];
    this.updaters = [];
    /** Waterfall BuiltObjects (their update runs every frame). */
    this.waterfalls = [];
    /**
     * Doors, signs, wells, chests and waystones.
     * @type {Interactable[]}
     */
    this.interactables = [];
    /**
     * Named emitters: `dust` (follows the camera, driven by the game) + particle areas by object id
     * (prototype-less: the ids are level data).
     */
    this.emitters = Object.create(null);
    /** Particle areas from `emitter` objects: { id, preset, emitter }. */
    this.areaEmitters = [];
    /** Emitters created from prop descriptors (smoke, embers, mist). */
    this.propEmitters = [];
    this.lights = [];
    /** registerEmissive entries (+ `baseDay`), so the weather can light windows on grey days. */
    this.emissiveEntries = [];
    /** The shared lantern-glass material (its albedo is dimmed while the lamps are unlit). */
    this.glassMaterial = null;
    /**
     * The positions of the campfires there now (ambience). One array for the world's life: a live
     * story group's fires are added and removed in place as it comes and goes (`applyStory`), so
     * the AudioDirector, which holds it, follows.
     * @type {THREE.Vector3[]}
     */
    this.fires = [];
    /**
     * Every campfire, present or not, in build order, with its live story group (or null).
     * @type {{ position: THREE.Vector3, group: StoryGroup|null }[]}
     */
    this._fireList = [];
    /**
     * The big fires (`fire` objects, burning houses) with their live story group: the `blaze`
     * ambience (AudioDirector).
     * @type {import('./AudioDirector.js').Blaze[]}
     */
    this.blazes = [];
    /**
     * The bells of the level's belfries and wayside chimes (`PropResult.bell`, EVERMERE_CAMPAIGN.md
     * §7.2) with their live story group (or null): `bells` lists those there now.
     * @type {{ id: string, bell: import('../engine/world/Props.js').Bell, group: StoryGroup|null }[]}
     */
    this._bells = [];
    /**
     * The warm braziers' safe zones (`PropResult.warmth`) with their live story group (or null):
     * `warmth` lists those there now.
     * @type {{ zone: { at: [number, number], r: number }, group: StoryGroup|null }[]}
     */
    this._warmth = [];
    /**
     * Waterfalls: { id, x, z, width, dir: [fx, fz], anchor (foot of the fall, in the pool), top,
     * splash (spray bursts + the roar in the ambience) } — every one, there or not: a live story
     * fall also has `hidden` (a getter, true while its group is absent: no spray bursts).
     */
    this.falls = [];
    /**
     * The feet (`anchor`) of the roaring waterfalls there now (splash, not hidden): the ambience's
     * roar. One array for the world's life, changed in place as story falls come and go (the
     * AudioDirector holds it, as it holds `fires`).
     * @type {THREE.Vector3[]}
     */
    this.fallAnchors = [];
    /** Legacy named anchors (first campfire / first splashing waterfall). */
    this.anchors = {};
    this.stats = {};
    /**
     * The water's brightness and glint as built (Weather.setWorld reads them once: the weather
     * scales the live uniforms every frame, so a world set aside and attached again must not read
     * its base from them).
     * @type {{ brightness: number, glint: number }|null}
     */
    this.waterBase = null;
  }

  /** Ground height (walk surfaces included). */
  groundAt(x, z) {
    return this.tileMap.getHeight(x, z);
  }

  /** Level objects of one type, in level order. */
  objectsOf(type) {
    return this.level.objects.filter((o) => o.type === type);
  }

  /** Is (x, z) inside the map rectangle? */
  inMap(x, z) {
    return x >= 0 && z >= 0 && x <= this.level.width && z <= this.level.depth;
  }

  /**
   * Build everything (async so a loading screen can breathe between steps): `buildSteps` run to
   * its end, a frame drawn as each phase begins.
   * @param {(fraction:number, label:string) => void} [onProgress]
   */
  async build(onProgress = () => {}) {
    const steps = this.buildSteps();
    for (let r = steps.next(); !r.done; r = steps.next()) {
      const y = r.value;
      // (a slice point: a whole build goes straight on)
      if (!y) continue;
      if ('wait' in y) await y.wait;
      else {
        onProgress(y.at, y.label);
        await nextFrame();
      }
    }
  }

  /**
   * The build as a step generator (src/engine/utils/steps.js). It yields `{ at, label }` as a
   * phase begins (`build` shows it and lets the page draw a frame), `{ wait }` for a promise to
   * settle (the shore bake in its worker) and, `paced`, nothing at the slice points — after every
   * object, tile, tree, batch and field — where a caller with a time budget may pause until a
   * later frame (a campaign's next level built ahead, KNOWN_ISSUES CMP-01: the inner builders run
   * as steps and the shore bakes in its worker on any level; the result is the same).
   * `stats.phases` counts the CPU milliseconds of each phase (the pauses excluded).
   * @param {{ paced?: boolean }} [opts]
   * @returns {Generator<{ at: number, label: string }|{ wait: Promise<unknown> }|undefined, void>}
   */
  * buildSteps({ paced = false } = {}) {
    const t0 = performance.now();
    // per-phase CPU milliseconds (the yields to the loading screen are not counted)
    const phases = {};
    const raw = {};
    this.stats.phases = phases;
    let tp = t0;
    const mark = (name) => {
      const now = performance.now();
      raw[name] = (raw[name] ?? 0) + now - tp;
      phases[name] = Math.round(raw[name]);
      tp = now;
    };
    /** A phase begins. */
    const step = function* (at, label) {
      yield { at, label };
      tp = performance.now();
    };
    /**
     * An inner step generator: in one go, or (paced) with a slice point after each of its steps.
     * @template T
     * @param {Generator<unknown, T>} steps
     * @param {string} phase
     * @returns {Generator<undefined, T>}
     */
    const run = function* (steps, phase) {
      if (!paced) return runSteps(steps);
      let r = steps.next();
      while (!r.done) {
        mark(phase);
        yield;
        tp = performance.now();
        r = steps.next();
      }
      return r.value;
    };
    const level = this.level;
    /** Spatial batching budgets of a big level (null: one batch per material, see SMALL_LEVEL). */
    this.batching = World.isBigLevel(level) ? { ...BIG_LEVEL_BATCHING } : null;
    const B = this.batching;

    // the set-piece kit of Vanquish the Evil Dragon (fires, debris, crags, garlands, the siege's
    // houses, the arid trees, textures, ground and border: src/engine/world/SetPieceKit.js), a chunk
    // of its own, loaded before anything is built for a level that needs it
    if (!setPieceKit() && levelNeedsSetPieceKit(level)) yield { wait: loadSetPieceKit() };
    // The Bells of Evermere's season kit (belfries, ships, monuments, the smithy, its tree kinds and
    // textures: src/engine/world/SeasonKit.js), likewise
    if (!seasonKit() && levelNeedsSeasonKit(level)) yield { wait: loadSeasonKit() };

    yield* step(0.08, t('game.load.textures'));
    this.textures.preload();
    mark('textures');

    yield* step(0.18, t('game.load.land'));
    // (the shore texture is baked once, below, when the props standing in the water exist)
    this.terrain = yield* run(buildLevelTerrainSteps(level, { textures: this.textures, chunkSize: B ? B.terrainChunk : 64, deferShore: true }), 'terrain');
    this.tileMap = this.terrain.tileMap;
    if (B) {
      // terrain shadows: shadow-only proxies of the opaque casting faces (cliffs, walls)
      // (isProxyCaster passes single-material meshes only)
      const casters = /** @type {SolidMesh[]} */ (this.tileMap.object.children.filter(isProxyCaster));
      this.terrainCasters = yield* run(shadowCasterSteps(casters.map((m) => ({ geometry: m.geometry, side: m.material.side })), {
        lights: [this.lighting.sun], maxTriangles: B.casterTriangles, maxExtent: B.casterExtent, name: 'terrain:shadow',
      }), 'terrain');
      for (const m of casters) m.castShadow = false;
      this.root.add(this.terrainCasters.object);
    }
    if (B && B.terrainTriangles > 0) {
      const n = this.tileMap.object.children.length;
      const fewer = yield* run(this.tileMap.consolidateChunkSteps({ maxTriangles: B.terrainTriangles, maxExtent: B.terrainExtent, minTriangles: B.terrainMinTriangles }), 'terrain');
      this.stats.terrainMeshes = [n, n - fewer];
    }
    this.water = this.terrain.water;
    this.root.add(this.terrain.object);
    mark('terrain');

    yield* step(0.3, t('game.load.village'));
    this.builder = new LevelObjectBuilder({ textures: this.textures, seed: 42 });
    this.factory = this.builder.factory;
    this.glassMaterial = this.factory.glassMaterial();
    // (paced: a slice point before every object)
    for (const f of this._buildProps(paced ? 0 : 12)) {
      mark('props');
      if (paced) {
        yield;
        tp = performance.now();
      } else yield* step(0.3 + 0.14 * f, t('game.load.village'));
    }
    mark('props');

    yield* step(0.45, t('game.load.forest'));
    const village = yield* run(this._levelTreeSteps(), 'trees');
    // every collider exists now (the forest border and outer trees have none): colliders standing
    // in water (bridge posts, rocks, trees) shape the shore texture — a big level (and any level
    // built ahead) bakes it in a worker while the forest, foliage and batches build
    const shore = (B || paced) && this.water ? this.water.refreshAsync() : null;
    yield* run(this._treeSteps(village, { paced }), 'trees');
    mark('trees');

    yield* step(0.58, t('game.load.water'));
    this._buildWaterfalls();
    // colliders standing in water (bridge posts, rocks) shape the shore texture
    if (!shore) this.water?.refresh();
    mark('water');

    yield* step(0.68, t('game.load.meadow'));
    yield* run(this._groundDetailSteps(), 'foliage');
    mark('foliage');

    yield* step(0.8, t('game.load.lights'));
    // (built ahead: when the world is attached)
    this._defer(() => {
      this._wireLights();
      this._buildAtmosphere();
    });
    mark('lights');

    yield* step(0.88, t('game.load.merge'));
    this.merged = yield* run(this._mergeSteps(), 'merge');
    mark('merge');
    if (shore) {
      yield { wait: shore };
      // (paced: the frames spent waiting for the worker are no work)
      if (paced) tp = performance.now();
      // (guard: a collider added in the water since the bake started)
      if (this.water._waterColliderSignature() !== this.water._colliderSig) this.water.refresh();
      mark('shoreWait');
    }

    // snow cover (driven by Weather): terrain tops & the outer hills, the ground sprites, the roofs
    this.tileMap.object.traverse((/** @type {SolidMesh} */ o) => { if (o.isMesh) addSnowCover(o.material, 'ground'); });
    if (this.outerGround) addSnowCover(this.outerGround.material, 'ground');
    for (const f of this.groundDetail.fields) addSnowCover(f.material, 'foliage');
    this.merged.object.traverse((/** @type {SolidMesh} */ o) => { if (o.isMesh && ROOF_MATERIAL.test(o.material?.name ?? '')) addSnowCover(o.material, 'ground'); });
    // a frozen level (`environment.frost`, The Bells of Evermere): the thaw patch on every lit
    // surface, ice on the water, walkable ice (src/game/thaw/ThawKit.js, a chunk of its own)
    if (this.env.frost) {
      if (!thawKit()) yield { wait: loadThawKit() };
      thawKit().prepareWorld(this);
    }
    mark('snow');

    // big level: cull the static batches by their boxes (far tighter than spheres for flat,
    // spread-out batches under the tilted camera and the long shadow frustum)
    if (B) {
      const meshes = [
        ...(/** @type {THREE.Mesh[]} */ (this.tileMap.object.children)).filter((m) => m.isMesh),
        ...this.merged.meshes,
        ...this.treeGroups.flatMap((t) => t.meshes),
      ];
      const fields = this.groundDetail.fields;
      yield* run((function* () {
        for (const m of meshes) {
          cullByBox(m);
          yield;
        }
        for (const f of fields) {
          cullByBox(f.object, { pad: 0.8 });
          yield;
        }
      }()), 'culling');
      mark('culling');
    }

    // (the prompts others add — a campaign's exits, a story's events — come after these)
    this._ownInteractables = this.interactables.length;
    // (paced: the CPU time, without the frames between the slices)
    this.stats.buildMs = Math.round(paced ? Object.values(raw).reduce((a, b) => a + b, 0) : performance.now() - t0);
    this.stats.colliders = this.tileMap.colliders.length;
    this.stats.pointLights = this.lights.length;
    this.stats.objects = level.objects.length;
    this.stats.batching = !!B;
  }

  /**
   * A world built ahead (`defer`), its `buildSteps` run to the end: into the running game now —
   * its root into the scene, then in build order the emissive registrations, the props' and
   * waterfalls' emitters, the lights (`_wireLights`) and the atmosphere. Called where `build()`
   * would have run (Game._buildLevel), so the scene, the registrations and the particle seeds are
   * those of a world built there. A world built by `build()` has done all this already.
   */
  attach() {
    if (this.attached) return;
    this.attached = true;
    const pending = this._pending;
    if (pending) {
      this._pending = null;
      for (const fn of pending) fn();
    } else this._relink();
    this.stats.pointLights = this.lights.length;
  }

  /**
   * Take an attached world out of the running game without disposing anything (a campaign sets
   * the level aside: the town while the player is in a room, the last room — CAMPAIGN_FORMAT.md
   * §6.3): its root leaves the scene, its emissive registrations the lighting, its emitters (prop
   * smoke and mist, particle areas, the dust) the particles, its god-ray shafts the god rays, and
   * the prompts others added to `interactables` (a campaign's Space exits, a story's Space events —
   * they add them again when the level is attached) are dropped. The lights need nothing: the next
   * world hands the shared pool its own descriptors, `attach()` hands it these again. Every
   * material, geometry, texture and program stays; `attach()` puts it back, `dispose()` releases
   * it. A world with a light pool of its own (a single level) cannot be detached.
   */
  detach() {
    if (!this.attached) return;
    if (!this._sharedPool) throw new Error('World.detach: only a world with a shared light pool (a campaign) can be detached');
    this.attached = false;
    this.root.removeFromParent();
    // the warm fill of the windows and lanterns: registered again on attach (from `baseDay`)
    for (const e of this.emissiveEntries) e.dispose();
    for (const e of this._ownEmitters()) this._emitterOut(e);
    const G = this.godRays;
    for (const s of this.shafts) {
      const i = G.shafts.indexOf(s);
      if (i >= 0) G.shafts.splice(i, 1);
      s.mesh.removeFromParent();
    }
    this.interactables.length = this._ownInteractables;
    // (the big-level particle cull lists the emitters again when attached)
    this._cullList = null;
  }

  /** A detached world back into the running game (`attach`): what `detach()` took out, in build order. */
  _relink() {
    this.scene.add(this.root);
    for (let k = 0; k < this.emissiveEntries.length; k++) {
      const e = this.emissiveEntries[k];
      // (the material it was registered with when the world was built)
      /** @type {ReturnType<LightingSystem['registerEmissive']> & { baseDay?: number }} */
      const entry = this.lighting.registerEmissive(/** @type {Parameters<LightingSystem['registerEmissive']>[0]} */ (e.material), { day: e.baseDay ?? 0, night: e.night });
      entry.baseDay = entry.day;
      this.emissiveEntries[k] = entry;
    }
    for (const e of this._ownEmitters()) this._emitterIn(e);
    this._wireLights();
    const G = this.godRays;
    for (const s of this.shafts) {
      if (!G.shafts.includes(s)) G.shafts.push(s);
      G.object.add(s.mesh);
    }
  }

  /** Every emitter this world made (the props', the waterfalls', the particle areas, the dust), once each. */
  _ownEmitters() {
    return [...new Set([...this.propEmitters, ...this.areaEmitters.map((a) => a.emitter), ...Object.values(this.emitters)])].filter(Boolean);
  }

  /** An emitter of this world out of the particle system (kept, not disposed). @param {any} e */
  _emitterOut(e) {
    const list = this.particles.emitters;
    const i = list.indexOf(e);
    if (i >= 0) list.splice(i, 1);
    e.object.removeFromParent();
  }

  /** An emitter of this world back into the particle system. @param {any} e */
  _emitterIn(e) {
    if (!this.particles.emitters.includes(e)) this.particles.emitters.push(e);
    this.particles.object.add(e.object);
  }

  /**
   * Something that goes into the running game (the scene, the lighting, the particles): now, or —
   * a world built ahead — at `attach()`, in this order.
   * @param {() => void} fn
   */
  _defer(fn) {
    if (this._pending) this._pending.push(fn);
    else fn();
  }

  /** mergeStatic / mergeTrees split options of a big level ({} = one batch per material). */
  _splitOpts(kind) {
    const B = this.batching;
    if (!B) return {};
    return kind === 'tree'
      ? { maxTriangles: B.treeTriangles, maxExtent: B.treeExtent, minTriangles: B.minTriangles }
      : { maxTriangles: B.propTriangles, maxExtent: B.propExtent, minTriangles: B.minTriangles };
  }

  /**
   * The bells there now — the belfries' and the wayside chimes' (`PropResult.bell`) whose story
   * group is present — by object id (EVERMERE_CAMPAIGN.md §7.2): the story's `toll <id>` and the
   * king's toll call `ring`. A new map each read (a level has a handful).
   * @returns {Map<string, import('../engine/world/Props.js').Bell>}
   */
  get bells() {
    const m = new Map();
    for (const b of this._bells) if (!b.group || b.group.present) m.set(b.id, b.bell);
    return m;
  }

  /**
   * The warm braziers' safe zones there now (`PropResult.warmth` of a present story group): the
   * Hush Bell's toll harms no one inside one (EVERMERE_CAMPAIGN.md §3, §7.2). A new list each read.
   * @returns {{ at: [number, number], r: number }[]}
   */
  get warmth() {
    const out = [];
    for (const w of this._warmth) if (!w.group || w.group.present) out.push(w.zone);
    return out;
  }

  /** Does this level get the big-level spatial batching (BIG_LEVEL_BATCHING)? */
  static isBigLevel(level) {
    return Math.max(level.width, level.depth) > SMALL_LEVEL;
  }

  /**
   * Batch the static prop meshes (PropFactory.mergeStatic): one mesh per material, cut into
   * spatially compact pieces on a big level. The live story props are among them (`tags`): their
   * groups' vertex ranges go to `storyRanges`.
   * @returns {{ object: THREE.Object3D, meshes: THREE.Mesh[], dispose(): void }}
   */
  _mergeProps() {
    return runSteps(this._mergeSteps());
  }

  /**
   * `_mergeProps` as a step generator.
   * @returns {Generator<undefined, ReturnType<World['_mergeProps']>>}
   */
  * _mergeSteps() {
    const B = this.batching;
    const merged = yield* this.factory.mergeStaticSteps(this.results, {
      name: 'village:static',
      ...this._splitOpts('prop'),
      shadowCasters: B ? { lights: [this.lighting.sun], maxTriangles: B.casterTriangles, maxExtent: B.casterExtent } : null,
      tags: this._storyTags.size ? this._storyTags : null,
    });
    this.storyRanges.add(merged.ranges);
    this.root.add(merged.object);
    // every set-piece flame of the level (burning houses, fires; The Bells of Evermere's braziers and
    // forge) in one instanced batch (FlameBatch.js) — the set-piece kit's or the season kit's: a level
    // with neither has no batched flame
    const merge = (setPieceKit() ?? seasonKit())?.mergeFlames;
    this.flames = merge ? merge(this.factory, this.results, { name: 'village:flames' }) : null;
    if (this.flames) this.root.add(this.flames.object);
    return merged;
  }

  // ---------------------------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------------------------

  /**
   * The live story group of a level object, or null (no story, no condition, a type the story
   * applies on entering only — LIVE_STORY_TYPES —, or one World does not build: villagers,
   * critters and markers come and go elsewhere; particle areas are World's).
   * @param {LevelObject} obj
   * @returns {StoryGroup|null}
   */
  _storyGroupOf(obj) {
    if (!this.story || !hasStoryCondition(obj) || !LIVE_STORY_TYPES.has(obj.type)) return null;
    if (!LevelObjectBuilder.isBuildable(obj.type) && obj.type !== 'emitter') return null;
    const key = `${String(obj.when ?? '').trim()}\u0000${String(obj.unless ?? '').trim()}${this._frostCell(obj)}`;
    let g = this.storyGroups.get(key);
    if (!g) {
      g = {
        key, sample: obj, present: !!this.story.present(obj), objects: [],
        colliders: [], walkRects: [], interactables: [], emitters: [], lights: [], poolLights: [], fires: [], falls: [], mapped: false,
      };
      this.storyGroups.set(key, g);
      // absent: its vertex ranges are collapsed as the merges register them (before any upload)
      if (!g.present) this.storyRanges.setHidden(g, true, { upload: false });
    }
    return g;
  }

  /**
   * On a frozen level (`environment.frost`, The Bells of Evermere), the 8-u cell of an object whose
   * `when` / `unless` reads a name of the frost's `until` — '\u0000<i>,<j>' — else '': its live
   * story group is split by space, so the thaw's front switches each cell as it reaches it
   * (src/game/thaw/LevelStates.js `_groupMay`). Cells only add vertex ranges, never draw calls; every
   * other level and object keys its group by the condition pair alone, as before.
   * @param {LevelObject} obj
   */
  _frostCell(obj) {
    const names = (this._frostNames ??= frostNames(this.env));
    if (!names.size) return '';
    const o = /** @type {any} */ (obj);
    if (![o.when, o.unless].some((c) => c && String(c).split(NAME_SPLIT).some((w) => names.has(w)))) return '';
    const x = Number.isFinite(o.x) ? o.x : (o.x0 + o.x1) / 2;
    const z = Number.isFinite(o.z) ? o.z : (o.z0 + o.z1) / 2;
    return Number.isFinite(x) && Number.isFinite(z) ? `\u0000${Math.floor(x / 8)},${Math.floor(z / 8)}` : '';
  }

  /**
   * Build one level object and wire everything it returns. A live story object (`_storyGroupOf`)
   * is merged into the level's batches like any other, tagged with its group (`_storyTags`); its
   * own root, which keeps what the merge leaves (a flame, a windmill's sails, a waterfall), goes
   * into its group, hidden with it; while its group is absent its colliders and walk surfaces wait
   * outside the TileMap and its animation (`update`: the sails) stands still.
   * @returns {BuiltObject|null}
   */
  _build(obj, { addToScene = true, merge = true } = {}) {
    let b = null;
    try {
      b = this.builder.build(obj, this.tileMap);
    } catch (err) {
      console.warn(`[Luminati] could not build ${obj.type} "${obj.id}":`, err);
      return null;
    }
    if (!b) return null;
    const g = this._storyGroupOf(obj);
    this.built.push(b);
    if (addToScene) this.root.add(b.object);
    if (g) {
      if (b.propResult) this._storyTags.set(b.propResult, g);
      if (addToScene) {
        g.objects.push(b.object);
        b.object.visible = g.present;
      }
      if (LEVEL_MAP_TYPES.has(obj.type)) g.mapped = true;
      g.colliders.push(...b.colliders);
      g.walkRects.push(...b.walkRects);
      g.lights.push(...b.lights);
    }
    if (merge && b.propResult) this.results.push(b.propResult);
    if (!g || g.present) {
      for (const c of b.colliders) this.tileMap.addCollider(c);
      for (const r of b.walkRects) this.tileMap.addWalkSurface(r);
    }
    for (const e of b.emissives) this._registerEmissive(e);
    for (const l of b.lights) this._lightDescs.push(l);
    if (b.update) {
      const update = b.update;
      this.updaters.push(g ? (dt) => { if (g.present) update(dt); } : update);
    }
    return b;
  }

  _createEmitter(e) {
    const em = this.particles.createEmitter(e.preset === 'smoke' ? { ...e, ...SMOKE } : e);
    this.propEmitters.push(em);
    return em;
  }

  /**
   * A live story object's emitter (smoke, embers, mist, a particle area) joins its group: on only
   * while the group is there (`applyStory`; the big-level particle cull asks `_emitterGroup`).
   * @param {any} em the emitter
   * @param {StoryGroup|null} g
   */
  _groupEmitter(em, g) {
    if (!g) return;
    g.emitters.push(em);
    this._emitterGroup.set(em, g);
    if (!g.present) em.enabled = false;
  }

  /**
   * Re-check the live story groups (the story changed): a group that came or went shows or hides
   * its meshes (its vertex ranges in the level's merged batches and shadow proxies are collapsed
   * or restored — `storyRanges`: no draw call is added or removed — and what the merge left in
   * the props' own roots, flames and glows, a windmill's sails, a waterfall's sheet and pool, is
   * hidden or shown), adds or removes its colliders and walk surfaces, enables its prompts (doors,
   * wells, signs), particles (smoke, mist, particle areas), campfires (`fires`: the ambience),
   * waterfalls (`fallAnchors`: the roar; `falls[].hidden`: no spray) and lights (the pool fades
   * them; no light is created or removed); its map markers follow by themselves (`mapMarkers`),
   * its animations stand still while it is absent (`_build`). The shore re-bakes only around
   * the colliders standing in water (nothing else shapes it), one window per cluster of them —
   * a big level in a worker (`Water.rebakeShoreAsync`: the texels follow a frame or so later).
   * Returns the groups that changed, the tile rectangle their colliders and walk surfaces cover
   * (actors standing there must be moved to standable ground) and whether the painted level map
   * shows any of them (`mapChanged`: a group with an object of LEVEL_MAP_TYPES — the maps need a
   * repaint; a lamp, a crate or a sign do not).
   * @param {{ instant?: boolean }} [opts] instant: lights without a fade (a level being built)
   * @returns {{ changed: StoryGroup[], rect: { minX: number, maxX: number, minZ: number, maxZ: number }|null,
   *   mapChanged: boolean }}
   */
  applyStory({ instant = false } = {}) {
    const changed = [];
    let rect = null;
    let mapChanged = false;
    if (!this.story) return { changed, rect, mapChanged };
    const grow = (x0, x1, z0, z1) => {
      rect = rect ? { minX: Math.min(rect.minX, x0), maxX: Math.max(rect.maxX, x1), minZ: Math.min(rect.minZ, z0), maxZ: Math.max(rect.maxZ, z1) } : { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
    };
    /** tile rects of the changed colliders standing in water */
    const wet = [];
    let fires = false;
    let falls = false;
    for (const g of this.storyGroups.values()) {
      const on = !!this.story.present(g.sample);
      if (on === g.present) continue;
      // (a thaw front stages what a change of the frost brings or takes: not before it reaches the
      // group — `thawGate`, src/game/thaw/LevelStates.js)
      if (!instant && this.thawGate && !this.thawGate(g)) continue;
      g.present = on;
      changed.push(g);
      if (g.mapped) mapChanged = true;
      this.storyRanges.setHidden(g, !on);
      for (const o of g.objects) o.visible = on;
      for (const c of g.colliders) {
        if (on) this.tileMap.addCollider(c);
        else this.tileMap.removeCollider(c);
        if (c.type === 'circle') grow(c.x - c.r, c.x + c.r, c.z - c.r, c.z + c.r);
        else grow(c.minX, c.maxX, c.minZ, c.maxZ);
        const w = this.water && this._wetTiles(c);
        if (w) wet.push(w);
      }
      for (const r of g.walkRects) {
        if (on) this.tileMap.addWalkSurface(r);
        else this.tileMap.removeWalkSurface(r);
        grow(r.minX, r.maxX, r.minZ, r.maxZ);
      }
      for (const it of g.interactables) it.disabled = !on;
      for (const e of g.emitters) e.enabled = on;
      for (const d of g.poolLights) this.lightPool?.setHidden(d, !on, { instant });
      if (g.fires.length) fires = true;
      if (g.falls.length) falls = true;
    }
    if (fires) {
      this.fires.length = 0;
      for (const f of this._fireList) if (!f.group || f.group.present) this.fires.push(f.position);
    }
    if (falls) {
      this.fallAnchors.length = 0;
      for (const f of this.falls) if (f.splash && !f.hidden) this.fallAnchors.push(f.anchor);
    }
    // a frozen level's ice to walk on (`frost.ice`, ThawKit `iceChunks`): there while the water
    // under it is frozen — as the thaw has it (`at`), or as the story stands
    const ice = this.thawIce;
    if (ice) {
      for (const c of ice.chunks) {
        const on = ice.at ? ice.at(c) : !!this.story.present(ice.test);
        if (on === c.on) continue;
        c.on = on;
        if (on) this.tileMap.addWalkSurface(c.rect);
        else this.tileMap.removeWalkSurface(c.rect);
        grow(c.rect.minX, c.rect.maxX, c.rect.minZ, c.rect.maxZ);
      }
    }
    if (wet.length) {
      for (const r of World._clusterRects(wet, 2 * this.water.shoreReach)) {
        if (this.batching) this.water.rebakeShoreAsync(r);
        else this.water.rebakeShore(r);
      }
    }
    return { changed, rect, mapChanged };
  }

  /**
   * The tiles (inclusive TileRect) a collider covers if any of them is water, else null: only
   * colliders standing in water shape the shore texture (WaterShore.bakeShore; the same test as
   * Water._waterColliderSignature).
   * @param {any} c a TileMap collider
   * @returns {{ minI: number, maxI: number, minJ: number, maxJ: number }|null}
   */
  _wetTiles(c) {
    const tm = this.tileMap;
    const circ = c.type === 'circle';
    const x0 = circ ? c.x - c.r : c.minX;
    const x1 = circ ? c.x + c.r : c.maxX;
    const z0 = circ ? c.z - c.r : c.minZ;
    const z1 = circ ? c.z + c.r : c.maxZ;
    if (!(x1 > x0 && z1 > z0)) return null;
    const i0 = Math.max(0, Math.floor(x0));
    const i1 = Math.min(tm.width - 1, Math.floor(x1));
    const j0 = Math.max(0, Math.floor(z0));
    const j1 = Math.min(tm.depth - 1, Math.floor(z1));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) if (tm.tileAt(i, j)?.water) return { minI: i0, maxI: i1, minJ: j0, maxJ: j1 };
    }
    return null;
  }

  /**
   * Join tile rects into the windows to re-bake: two rects become one when the re-bake window of
   * their union (the rect ± `pad` tiles) is no bigger than their two windows together — near
   * colliders (a bridge's posts) share one bake, far ones (two corners of the map) get their own.
   * @param {{ minI: number, maxI: number, minJ: number, maxJ: number }[]} rects
   * @param {number} pad
   */
  static _clusterRects(rects, pad) {
    const area = (r) => (r.maxI - r.minI + 1 + 2 * pad) * (r.maxJ - r.minJ + 1 + 2 * pad);
    const out = rects.map((r) => ({ ...r }));
    for (let merged = true; merged;) {
      merged = false;
      for (let a = 0; a < out.length && !merged; a++) {
        for (let b = a + 1; b < out.length; b++) {
          const A = out[a];
          const B = out[b];
          const U = { minI: Math.min(A.minI, B.minI), maxI: Math.max(A.maxI, B.maxI), minJ: Math.min(A.minJ, B.minJ), maxJ: Math.max(A.maxJ, B.maxJ) };
          if (area(U) > area(A) + area(B)) continue;
          out[a] = U;
          out.splice(b, 1);
          merged = true;
          break;
        }
      }
    }
    return out;
  }

  /**
   * The points of interest the maps draw (Game._setupMaps): one marker per interactable (doors,
   * signs, wells, chests, waystones, a campaign's Space exits …) and per campfire, in that order. A
   * live story prop's marker reads `hidden` from its group (true while the group is absent: the
   * minimap and the world map skip it), so it comes and goes with the story without a repaint.
   * @returns {{ x: number, z: number, kind: string, hidden?: boolean }[]}
   */
  mapMarkers() {
    /** @type {Map<Interactable, StoryGroup>} */
    const groupOf = new Map();
    for (const g of this.storyGroups.values()) for (const it of g.interactables) groupOf.set(it, g);
    /** @type {{ x: number, z: number, kind: string, hidden?: boolean }[]} */
    const out = [];
    const mark = (x, z, kind, g) => {
      const m = { x, z, kind };
      if (g) Object.defineProperty(m, 'hidden', { get: () => !g.present, enumerable: true });
      out.push(m);
    };
    for (const it of this.interactables) mark(it.position.x, it.position.z, it.kind, groupOf.get(it));
    for (const f of this._fireList) mark(f.position.x, f.position.z, 'fire', f.group);
    return out;
  }

  _registerEmissive(e) {
    this._emissiveSet ??= new Set();
    if (this._emissiveSet.has(e.material)) return;
    this._emissiveSet.add(e.material);
    // (built ahead: when the world is attached)
    this._defer(() => {
      /** @type {ReturnType<LightingSystem['registerEmissive']> & { baseDay?: number }} */
      const entry = this.lighting.registerEmissive(e.material, { day: e.day ?? 0, night: e.night ?? 1.6 });
      entry.baseDay = entry.day;
      this.emissiveEntries.push(entry);
    });
  }

  /**
   * `lookSpan` (optional) `{ a, b }`: a horizontal segment the player may face instead of
   * `position` — a door's leaf, edge to edge, while `position` is the door-step point in front of
   * it (see Game._findInteractable). `object` / `prop` (optional, chests and waystones — COMBAT.md
   * §9.8): the level object and the prop's `controls`, copied onto the item for the combat system.
   * @param {string} id
   * @param {THREE.Vector3} position
   * @param {{ radius?: number, label?: string, kind?: string, prompt?: THREE.Vector3|null,
   *   lookSpan?: { a: THREE.Vector3, b: THREE.Vector3 }|null, text: Interactable['text'],
   *   object?: LevelObject, prop?: Interactable['prop'] }} opts
   *   radius 1.2, label 'Examine', kind 'object', prompt 1.6 above `position`
   * @returns {Interactable}
   */
  _interact(id, position, { radius = 1.2, label = 'Examine', kind = 'object', prompt = null, lookSpan = null, text, object, prop }) {
    const span = lookSpan ? { a: lookSpan.a.clone(), b: lookSpan.b.clone() } : null;
    const it = { id, position: position.clone(), radius, label, kind, prompt: prompt ?? position.clone().setY(position.y + 1.6), lookSpan: span, text };
    if (object !== undefined) it.object = object;
    if (prop !== undefined) it.prop = prop;
    this.interactables.push(it);
    return it;
  }

  /**
   * An object's `text` field as examining shows it (a house's door, a sign, a well): one page per
   * non-blank entry — ContentKeys.js `textPages`, the paging the content tools use too — with the
   * text key the object holds for each page (`pageKeyOf` at its raw index; '' none), so the display
   * shows it by its key (`InteractText`; docs/specs/I18N.md §4.2, §4.8).
   * @param {LevelObject} obj
   * @returns {{ lines: string[], keys: string[] }}
   */
  static textPagesOf(obj) {
    const pages = textPages(/** @type {{ text?: unknown }} */ (obj).text);
    return { lines: pages.map((p) => p.text), keys: pages.map((p) => pageKeyOf(obj, 'text', p.i)) };
  }

  /**
   * Build every prop-kind object but trees and waterfalls. A generator: it yields the fraction
   * done about every `sliceMs` ms (12) so the loading screen keeps animating on big levels.
   * @param {number} [sliceMs]
   */
  *_buildProps(sliceMs = 12) {
    this._lightDescs = [];
    this.houseFootprints = [];
    const objects = this.level.objects;
    let slice = performance.now();
    for (let n = 0; n < objects.length; n++) {
      const obj = objects[n];
      if (performance.now() - slice > sliceMs) {
        yield n / objects.length;
        slice = performance.now();
      }
      if (!LevelObjectBuilder.isBuildable(obj.type) || LATE_TYPES.has(obj.type)) continue;
      const b = this._build(obj);
      if (!b) continue;
      const g = this._storyGroupOf(obj);
      const blaze = blazeOf(obj, g);
      if (blaze) this.blazes.push(blaze);
      // (The Bells of Evermere: the bells the story and the king toll, the braziers' warmth)
      const bell = b.propResult?.bell;
      if (bell) this._bells.push({ id: obj.id, bell, group: g });
      const warmth = b.propResult?.warmth;
      if (warmth) this._warmth.push({ zone: warmth, group: g });
      const prompts = this.interactables.length;
      // (built ahead: when the world is attached)
      this._defer(() => {
        for (const e of b.emitters) this._groupEmitter(this._createEmitter(e), g);
      });
      // (a house's, a sign's, a well's pages, with the keys the object holds for them)
      const pages = World.textPagesOf(obj);
      const lines = pages.lines;
      switch (obj.type) {
        case 'house': {
          const door = b.interact?.position?.clone() ?? null;
          // (its box colliders together: one box, or the strips of a house turned by other than a
          // quarter turn)
          const box = boxUnion(b.colliders);
          if (box) this.houseFootprints.push({ ...box, door });
          if (door && lines.length) {
            this._interact(`door:${obj.id}`, door, { radius: 1.0, label: 'Knock', kind: 'door', lookSpan: b.interact.lookSpan, text: { speaker: '', ...pages } });
          }
          break;
        }
        case 'signpost':
          if (lines.length) {
            // (the plate: the sign's `speaker` — '' none —, else the code default 'Signpost')
            const sp = /** @type {unknown} */ (obj.speaker);
            const plate = sp == null ? { speaker: 'Signpost', speakerDefault: 'signpost' }
              : { speaker: typeof sp === 'string' ? sp : typeof sp === 'number' || typeof sp === 'boolean' ? String(sp) : '' };
            this._interact(obj.id, b.anchor, { radius: 1.35, label: 'Read', kind: 'sign', text: { ...plate, ...pages } });
          }
          break;
        case 'well': {
          if (!lines.length) break;
          const y = b.anchor.y;
          const pos = b.interact?.position ?? new THREE.Vector3(obj.x, y, obj.z);
          // prompt well above the roof (and a touch north): a player standing behind the well
          // projects just above the roof line, so a lower prompt would sit on their head
          const prompt = new THREE.Vector3(obj.x, y + 4.2, obj.z - 0.3);
          this._interact(obj.id, pos, { radius: 1.75, label: 'Look', kind: 'well', prompt, text: { speaker: '', ...pages, sfx: obj.sfx ?? 'splash' } });
          break;
        }
        case 'hearth':
          // a lit hearth crackles like a campfire (the ambience) and is a fire on the maps
          if (/** @type {any} */ (obj).opts?.lit === false) break;
        // falls through
        case 'campfire': {
          // (a live story fire: in `fires` — the ambience's crackle — only while its group is there)
          const position = b.anchor.clone();
          this._fireList.push({ position, group: g });
          if (g) g.fires.push(position);
          if (!g || g.present) this.fires.push(position);
          if (obj.type === 'campfire') this.anchors.campfire ??= position;
          break;
        }
        case 'chest':
        case 'waystone': {
          // examined on a peaceful level; on a combat level the combat system sets `onInteract`
          // and the label ('Open' / 'Rest') at load (COMBAT.md §9.8, §6.12)
          const chest = obj.type === 'chest';
          const y = b.anchor.y;
          this._interact(obj.id, b.interact?.position ?? b.anchor, {
            kind: obj.type,
            label: 'Examine',
            radius: chest ? 1.2 : 1.5,
            prompt: new THREE.Vector3(obj.x, y + (chest ? 1.2 : 2.4), obj.z),
            // (the code defaults: UI strings, shown as `t('game.default.<id>')`; a waystone's name is data)
            text: chest ? { speaker: '', lines: ['The chest is locked tight.'], linesDefault: 'chest' }
              : { ...(obj.name ? { speaker: String(obj.name) } : { speaker: 'Waystone', speakerDefault: 'waystone' }), lines: ['An old waystone hums quietly.'], linesDefault: 'waystoneText' },
            object: obj,
            prop: b.propResult?.controls ?? null,
          });
          break;
        }
        default:
      }
      // a live story prop's prompts (a signpost's, a house's door, a well's) come and go with its group
      if (g) {
        for (let k = prompts; k < this.interactables.length; k++) {
          g.interactables.push(this.interactables[k]);
          if (!g.present) this.interactables[k].disabled = true;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Trees: level trees (trunk colliders unless `collider: false`), forest border, outer world —
  // all merged
  // ---------------------------------------------------------------------------------------------

  /** The level's own trees (with their trunk colliders); merged by _buildTrees. */
  _buildLevelTrees() {
    return runSteps(this._levelTreeSteps());
  }

  /**
   * `_buildLevelTrees` as a step generator (a step per tree).
   * @returns {Generator<undefined, PropResult[]>}
   */
  * _levelTreeSteps() {
    const village = [];
    for (const obj of this.objectsOf('tree')) {
      const b = this._build(obj, { addToScene: false, merge: false });
      // (a live story tree too: merged with the others, tagged with its group)
      if (b?.propResult) village.push(b.propResult);
      yield;
    }
    return village;
  }

  _buildTrees(village = this._buildLevelTrees()) {
    runSteps(this._treeSteps(village));
  }

  /**
   * `_buildTrees` as a step generator: steps of the scatter, a step per tree made and per batch
   * merged, the outer ground in rows (paced: two rows a step).
   * @param {PropResult[]} village the level's own trees
   * @param {{ paced?: boolean }} [opts]
   * @returns {Generator<undefined, void>}
   */
  * _treeSteps(village, { paced = false } = {}) {
    const f = this.factory;
    const tm = this.tileMap;
    const env = this.env;
    const trees = this.objectsOf('tree');
    this.stats.trees = { village: village.length, border: 0, outer: 0 };

    // (never in a room: LevelLook.isInterior)
    const forest = forestBorderOn(env);
    const outerOn = outerSceneryOn(env);
    let border = [];
    let outer = [];
    // (the level's climate: an arid border, outer ground and peaks — Scenery.js, DRAGON_CAMPAIGN.md §6.2)
    const climate = climateOf(env);
    // (and its season: the forest mix, relief and outer ground — Scenery.js, EVERMERE_CAMPAIGN.md §6.2)
    const season = seasonOf(env);
    if (forest || outerOn) {
      this.outerHeight = makeOuterHeight(tm, { climate, season });
      // keep the scatter away from the hand-placed trees (big ones beyond the map edge need more room)
      const avoid = trees.map((o) => ({ x: o.x, z: o.z, r: this.inMap(o.x, o.z) ? 1.2 : 1.8 }));
      const gap = southGap(env);
      ({ border, outer } = yield* scatterForestSteps({ tileMap: tm, heightAt: this.outerHeight, avoid, southGap: gap, kindAreas: forestKindAreas(env), climate, season }));
      if (!forest) border = [];
      if (!outerOn) outer = [];
    }
    const borderTrees = [];
    // (a tree, or an arid border's rock spire: `crag:<stone>` entries)
    for (const e of border) {
      borderTrees.push(sceneryProp(f, e));
      yield;
    }
    const outerTrees = [];
    for (const e of outer) {
      outerTrees.push(sceneryProp(f, e));
      yield;
    }
    const split = this._splitOpts('tree');

    const a = yield* mergeTreeSteps([...village, ...borderTrees], { name: 'trees:map', ...split, tags: this._storyTags.size ? this._storyTags : null });
    this.storyRanges.add(a.ranges);
    this.root.add(a.object);
    this.treeGroups = [a];
    // outer trees: split into four quadrants so frustum culling can skip what the camera can't
    // see (a big level: into compact pieces of the tree budget instead)
    const W = tm.width;
    const D = tm.depth;
    const quads = this.batching ? { all: outerTrees } : { n: [], s: [], e: [], w: [] };
    if (!this.batching) {
      outerTrees.forEach((r, i) => {
        const [, x, , z] = outer[i];
        const q = z < 0 ? 'n' : z > D ? 's' : x < W / 2 ? 'w' : 'e';
        quads[q].push(r);
      });
    }
    for (const [q, list] of Object.entries(quads)) {
      if (!list.length) continue;
      const name = this.batching ? 'trees:outer' : `trees:outer:${q}`;
      const m = yield* mergeTreeSteps(list, { name, castShadow: false, ...split });
      this.root.add(m.object);
      this.treeGroups.push(m);
    }
    this.stats.trees = { village: village.length, border: border.length, outer: outer.length };

    if (outerOn) {
      const ground = yield* outerGroundSteps({ textures: this.textures, tileMap: tm, heightAt: this.outerHeight, climate, season, ...(paced ? { rowsPerStep: 2 } : {}) });
      this.root.add(ground);
      this.outerGround = ground;
    } else this.outerGround = null;
  }

  // ---------------------------------------------------------------------------------------------
  // Waterfalls (the river / pond / stream surfaces come with the terrain)
  // ---------------------------------------------------------------------------------------------

  /**
   * The waterfalls: the sheet and its foam pool (the object), the mist, `falls` (spray bursts) and
   * `fallAnchors` (the roar). A live story fall (`_storyGroupOf`) hides all of it while its group
   * is absent; the water it falls between is terrain and stays (tiles, the water's step face, the
   * shore — no waterfall shapes those).
   */
  _buildWaterfalls() {
    for (const obj of this.objectsOf('waterfall')) {
      const b = this._build(obj, { merge: false });
      if (!b) continue;
      this.waterfalls.push(b);
      const g = this._storyGroupOf(obj);
      // thin spray (LevelLook.MIST); `mist: { count, alpha }` tunes it per waterfall
      const width = obj.width ?? 2;
      const mist = waterfallMist(obj);
      // (built ahead: when the world is attached)
      this._defer(() => {
        for (const e of b.emitters) this._groupEmitter(this._createEmitter({ ...e, count: mist.count, alpha: mist.alpha }), g);
      });
      const dir = waterfallDir(obj.facing);
      const bottom = b.anchor.y;
      const fall = {
        id: obj.id,
        x: obj.x,
        z: obj.z,
        width,
        dir,
        anchor: new THREE.Vector3(obj.x + dir[0] * 0.6, bottom, obj.z + dir[1] * 0.6),
        splash: obj.splash !== false,
      };
      if (g) {
        Object.defineProperty(fall, 'hidden', { get: () => !g.present, enumerable: true });
        g.falls.push(fall);
      }
      this.falls.push(fall);
      if (fall.splash && (!g || g.present)) this.fallAnchors.push(fall.anchor);
      if (fall.splash) this.anchors.waterfall ??= fall.anchor;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Ground foliage
  // ---------------------------------------------------------------------------------------------

  _buildGroundDetail() {
    runSteps(this._groundDetailSteps());
  }

  /**
   * `_buildGroundDetail` as a step generator (GroundDetail.groundDetailSteps).
   * @returns {Generator<undefined, void>}
   */
  * _groundDetailSteps() {
    // (the trees' ferns, the villagers' clearings, the seed and the sanitised areas: LevelLook,
    // shared with the editor's preview)
    const detail = yield* groundDetailSteps({
      tileMap: this.tileMap,
      isFree: (x, z) => this._isFreeForFoliage(x, z),
      houses: this.houseFootprints,
      ...groundDetailArgs(this.level),
      maxInstances: this.batching?.foliageInstances ?? Infinity,
    });
    this.groundDetail = detail;
    this.root.add(detail.object);
    this.stats.foliage = detail.stats;
  }

  // ---------------------------------------------------------------------------------------------
  // Lights (≤ 12, all created now) and atmosphere
  // ---------------------------------------------------------------------------------------------

  /**
   * A light for a combat effect (the ice mage's spells, src/game/party/IceSpellFx.js): one of the
   * game's combat VFX lights (`vfxLights`, VfxLights.js — `VFX_LIGHT_COUNT` point lights beside
   * the lamps, made by Game.init before the first level; the lamps are never touched), or null when
   * none is free (or on a world that is not the running one). A `minor` request (a short spark)
   * takes a free light only; any other takes a minor one's light when none is free.
   * `set(x, y, z, o)` moves and colours it at once, `off()` darkens it (still held), `release()`
   * gives it back — see `VfxLights.acquire` for the options and defaults.
   * @param {{ minor?: boolean }} [opts]
   * @returns {import('../engine/lighting/VfxLights.js').SpellLight | null}
   */
  acquireSpellLight({ minor = false } = {}) {
    return this.vfxLights?.acquire({ minor }) ?? null;
  }

  /**
   * Point lights through a LightPool of MAX_POINT_LIGHTS: a level with ≤ 12 light descriptors
   * gets one permanent light each (by LIGHT_PRIORITY — campfire, torches / point lights,
   * lampposts, house door lanterns — ties broken by level object order); a bigger level shares
   * the 12 lights among the lanterns around the camera focus (World.update re-ranks them, with
   * crossfades).
   */
  _wireLights() {
    // sorted by priority, present-but-invalid numbers sanitised (a NaN intensity from a
    // hand-edited `light` object would poison every lit pixel — and the bloom); the editor's 3D
    // preview builds its list with the same function
    const cache = this.storyGroups.size ? new Map() : null;
    const descs = sanitizeLightDescriptors(this._lightDescs, { cache });
    if (this._sharedPool) this._sharedPool.setDescriptors(descs, { snap: true });
    this.lightPool = this._sharedPool ?? new LightPool(this.lighting, descs, { size: MAX_POINT_LIGHTS });
    // live story lamps: the pool keeps every descriptor and switches the absent ones off
    for (const g of this.storyGroups.values()) {
      g.poolLights = g.lights.map((d) => cache.get(d)).filter(Boolean);
      for (const d of g.poolLights) this.lightPool.setHidden(d, !g.present, { instant: true });
    }
    this.lights = this.lightPool.handles;
    this.stats.lightDescriptors = this._lightDescs.length;
    this.stats.lightsPooled = this.lightPool.pooled;
  }

  _buildAtmosphere() {
    const P = this.particles;
    const env = this.env;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const W = this.level.width;
    const D = this.level.depth;
    // dust motes that follow the camera focus (moved every frame by the game)
    if (env.dust !== false) {
      this.emitters.dust = P.createEmitter({ preset: 'dust', bounds: { center: V(W / 2, 2.5, D / 2), size: V(DUST_BOX.x, DUST_BOX.y, DUST_BOX.z) }, count: 120, ...climateDust(env) });
    }
    // particle areas: fireflies (the preset only shows them at night), leaves, petals, glints… —
    // with a story condition, switched on and off by the story (`_groupEmitter`, `applyStory`)
    // (hand-edited files: sizes / counts are sanitised so a typo can't allocate millions of
    // particles or poison the bounds with NaN)
    const num = (v, d, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d));
    for (const obj of this.objectsOf('emitter')) {
      const size = Array.isArray(obj.size) ? obj.size : [];
      const y = this.groundAt(obj.x, obj.z) + num(obj.dy, 1.2, -5, 30);
      const params = obj.params && typeof obj.params === 'object' && !Array.isArray(obj.params) ? obj.params : {};
      let emitter;
      try {
        emitter = P.createEmitter({
          ...params,
          // (level data: an unknown preset name throws, caught below)
          preset: /** @type {keyof typeof PARTICLE_PRESETS} */ (obj.preset),
          bounds: { center: V(obj.x, y, obj.z), size: V(num(size[0], 8, 0.1, 200), num(size[1], 2.4, 0.1, 60), num(size[2], 8, 0.1, 200)) },
          count: Math.round(num(obj.count, 30, 1, 1000)),
        });
      } catch (err) {
        console.warn(`[Luminati] could not create particle area "${obj.id}" (${obj.preset}):`, err);
        continue;
      }
      this.areaEmitters.push({ id: obj.id, preset: obj.preset, emitter });
      if (obj.id !== 'dust') this.emitters[obj.id] = emitter;
      // a live story area: on only while its group is there (the weather sets its intensity, never
      // `enabled`)
      this._groupEmitter(emitter, this._storyGroupOf(obj));
    }

    // god rays over the playable area (or the level's own areas; LevelLook.godRayLayout) — the
    // world's own shafts (disposed with it; out of the god rays while it is set aside)
    for (const a of godRayLayout(env, this.level, this.tileMap)) this.shafts.push(...this.godRays.populate(a.bounds, a.count, a.seed));
  }

  // ---------------------------------------------------------------------------------------------

  _isFreeForFoliage(x, z) {
    // candidates from the TileMap's collider grid (a superset; tested exactly below)
    const cs = this.tileMap.queryColliders(x - 0.2, z - 0.2, x + 0.2, z + 0.2, (this._freeTmp ??= []));
    for (let k = 0; k < cs.length; k++) if (World._covers(cs[k], x, z)) return false;
    // the colliders of live story props absent now: no grass where they may stand later (so a
    // story house, windmill or well leaves a bare footprint while it is absent — and a house the
    // bushes GroundDetail sets along its walls: the foliage is scattered once)
    if (this.storyGroups.size) {
      for (const g of this.storyGroups.values()) {
        if (g.present) continue;
        for (const c of g.colliders) if (World._covers(c, x, z)) return false;
      }
    }
    return true;
  }

  /** Does collider `c` (grown by the foliage margin) cover (x, z)? */
  static _covers(c, x, z) {
    if (c.type === 'circle') {
      const r = c.r + 0.1;
      return (x - c.x) ** 2 + (z - c.z) ** 2 < r * r;
    }
    return x > c.minX - 0.15 && x < c.maxX + 0.15 && z > c.minZ - 0.15 && z < c.maxZ + 0.15;
  }

  /**
   * Per-frame: animated props (windmill sails, waterfalls), water shore refresh and the point-light
   * pool (ranked around `view.focus`, limited to what `view.camera` sees).
   * @param {number} dt
   * @param {{ focus?: THREE.Vector3, camera?: THREE.Camera }} [view]
   */
  update(dt, view = {}) {
    for (let i = 0; i < this.updaters.length; i++) this.updaters[i](dt);
    this.water?.update(dt);
    if (!view.camera) view = { focus: view.focus ?? null, camera: this.engine.camera };
    this.lightPool?.update(dt, view);
    if (this.batching && view.focus) this._cullParticles(view.focus);
  }

  /** Big levels: switch off the particle areas / smoke far from the focus (BIG_LEVEL_BATCHING.particleCull). */
  _cullParticles(f) {
    if (!this._cullList) {
      const named = new Set([this.emitters.dust].filter(Boolean)); // (the dust follows the camera)
      this._cullList = [...this.areaEmitters.map((a) => a.emitter), ...this.propEmitters]
        .filter((e) => e && !named.has(e) && !e.followCamera)
        .map((e) => ({ e, x: e.position.x, z: e.position.z, hx: e.boxSize.x / 2, hz: e.boxSize.z / 2 }));
    }
    const R2 = this.batching.particleCull ** 2;
    for (const c of this._cullList) {
      const dx = Math.max(0, Math.abs(c.x - f.x) - c.hx);
      const dz = Math.max(0, Math.abs(c.z - f.z) - c.hz);
      // (a live story prop's smoke stays off while its group is absent)
      const g = this._emitterGroup.size ? this._emitterGroup.get(c.e) : null;
      const on = dx * dx + dz * dz < R2 && (!g || g.present);
      if (c.e.enabled !== on) c.e.enabled = on;
    }
  }

  dispose() {
    // (a shared pool belongs to the game; its lights move on to the next level)
    if (this.lightPool !== this._sharedPool) this.lightPool?.dispose();
    for (const e of this.emissiveEntries) e.dispose?.();
    this.emissiveEntries.length = 0;
    // its god-ray shafts (in the god rays or, set aside, out of them)
    for (const s of this.shafts) s.dispose();
    this.shafts.length = 0;
    this.attached = false;
    this.terrainCasters?.dispose();
    this.groundDetail?.dispose();
    for (const e of this.propEmitters) e.dispose();
    // the dust + every particle area, once each (an area whose id is 'dust' is only in areaEmitters)
    const named = new Set([...Object.values(this.emitters), ...this.areaEmitters.map((a) => a.emitter)]);
    for (const e of named) e?.dispose?.();
    for (const t of this.treeGroups ?? []) t.dispose();
    this.storyRanges.clear();
    this.flames?.dispose();
    this.merged?.dispose();
    for (const b of this.built) b.dispose();
    this.terrain?.dispose();
    this.builder?.dispose();
    this.outerGround?.geometry.dispose();
    this.root.removeFromParent();
  }
}
