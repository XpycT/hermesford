/**
 * The level checks of the generators, for any level: `tools/make-gildhaven.mjs` runs them on the
 * level it builds (strict, with its routes, street centre lines and scattered trees), and
 * `tools/check-level.mjs` runs them on a level file — an editor-made level gets the same checks.
 *
 *   gridFromLevel(level)       a `createGrid` grid filled from the level's rows (path tiles inferred
 *                              from the tile types: dirt paths, cobbles, stone tiles, decks, stairs)
 *   placerFromLevel(g, level)  a `createPlacer` placer holding the level's objects (colliders
 *                              reserved, bridges with their deck height resolved, waterfalls,
 *                              the object sightlines)
 *   checkLevel(level, { g, P }, options)   → { errors, warnings, info } (with the level's story
 *                              problems, `storyIssues`: scripts and conditions that do not parse …)
 *   addSightlines(P) · sightTargets(objects, doorOf) · cameraPitch(environment)
 *   specIssues(spec) · SPEC_NAMES   a villager's sprite names (hat, hair style, weapon …) the
 *                              character sprites do not know
 *
 * Severity: the checks that find a broken level (an unreachable villager, door, sign or well; a
 * stair, waterfall or bridge that does not work; critters or objects off the map) are errors.
 * The composition rules of the level design guide (nothing hidden behind roofs or crowns, ≤ 3 % of
 * the path tiles behind roofs, flat footprints, no overlaps, no unreachable pockets, every point in
 * a region, every region the current one somewhere …) are warnings, or errors with `strict` — the
 * generators' bar. A villager's `spec` value the sprites do not know (a hat they draw as none,
 * KNOWN_ISSUES EVM-28) is a warning, also with `strict`.
 *
 * Story states (docs/specs/CAMPAIGN_FORMAT.md §9): where the objects' `when` / `unless` apply (a
 * campaign's levels, a level with a story) the level is checked once per story state — each
 * distinct set of objects the conditions let be there (src/engine/level/StoryStates.js: the
 * combinations of independent groups of tests, all of them up to `defaultMaxStoryStates`, else a
 * sample) — and the findings are merged: one in every state where its objects are there reads as
 * without conditions; "reached only with `flag`: …" for what only some states reach (a warning);
 * other findings of some states name them in brackets; two objects never there together do not
 * overlap. From a sample, what no state checked reaches is a warning and states are not named. The
 * first state is checked in full, the others reuse its work where nothing that differs is near. A
 * level without conditions: the same report as before.
 *
 * Content-text keys (docs/specs/I18N.md §4.2, §4.10): every translatable text carries a key in the
 * data; `textKeyIssues` lists a text with no key (`missing`: it stays English in every language) and
 * a key on no text (`stray`) as warnings, or errors with `strict` — the generators' bar — and one
 * key on two texts of the level (`repeated`) as an error. An info line counts the keyed texts.
 *
 * Node-safe: no three.js (the game's rules that live in three.js modules — the bridge deck height,
 * the water surfaces — are mirrored here). Randomness: none (a sample of story states is seeded).
 */
import { OBJECT_TYPES, CHARACTER_PRESET_NAMES, EMITTER_PRESETS, critterStartPoints, levelHasStory } from '../../src/engine/level/ObjectCatalog.js';
import { charToLevel } from '../../src/engine/level/LevelFormat.js';
import { levelEntrances, levelExits, entranceName, travelIssues, hasStoryCondition, storyExclusive } from '../../src/engine/level/Travel.js';
import { storyStates } from '../../src/engine/level/StoryStates.js';
import { storyIssues, formatStoryIssue } from '../../src/engine/level/StoryChecks.js';
import { textKeyIssues, levelTexts } from '../../src/engine/i18n/TextKeys.js';
import { clamp } from '../../src/engine/utils/math.js';
import {
  createGrid, createPlacer, createWalkModel, createOcclusion, roofsOf, scatterForestTop, hitShape, shapeBounds, stairT, walkRectsOf, CARDINAL,
} from './levelgen.mjs';

/**
 * @import { Level, LevelEnvironment, LevelObject, TileDef, XZ } from '../../src/engine/level/types.js'
 * @import { StoryContext } from '../../src/engine/level/StoryChecks.js'
 */

/**
 * The names a villager's `spec` may give that the character sprites resolve without a word when
 * they do not know one (src/engine/pixel/CharacterSprites.js `resolveSpec` and its painters; the
 * kit's hats, CharacterKit.js, included): field → [the names drawn, what an unknown value draws].
 * A mirror — CharacterSprites.js is a three.js module — that `npm run level:test` keeps equal to the
 * sprites' own tables (their `HATS`, `HAIR`, the weapons, styles, builds and crests they draw).
 * Colours (and a `beard` that is no beard name: a full beard in that colour) are not names.
 * @type {Readonly<Record<string, readonly [readonly string[], string]>>}
 */
export const SPEC_NAMES = Object.freeze({
  hat: [['none', 'hood', 'wide', 'cap', 'helmet', 'circlet', 'crown', 'greathelm'], 'no hat'],
  hairStyle: [['short', 'spiky', 'long', 'ponytail', 'bun', 'bald'], 'the short cut'],
  weapon: [['none', 'sword', 'staff', 'bow', 'lute', 'spear', 'cane', 'holystaff', 'icestaff', 'greatshield', 'hammer'], 'no weapon'],
  build: [['normal', 'stout', 'elder', 'child'], 'the normal build'],
  'outfit.style': [['tunic', 'vest', 'robe', 'dress', 'dancer', 'overalls', 'tabard'], 'a plain top without a cut of its own'],
  'cape.style': [['cape', 'cloak', 'short'], 'the long cape'],
  'gear.crest': [['anchor', 'plain'], 'the wyvern crest'],
});

/**
 * The values of a villager's `spec` (untrusted: any shape) that the character sprites do not know
 * (`SPEC_NAMES`): one message each, e.g. `spec hat "straw" is not a name the sprites know — they
 * draw no hat (known: none, hood, …)`. Unset values (`undefined`, `null`, `false`, '') keep the
 * preset's or the default and are not reported.
 * @param {unknown} spec
 * @returns {string[]}
 */
export function specIssues(spec) {
  if (!spec || typeof spec !== 'object') return [];
  const s = /** @type {Record<string, any>} */ (spec);
  /** @type {string[]} */
  const out = [];
  /** @param {string} field @param {unknown} v */
  const one = (field, v) => {
    if (v === undefined || v === null || v === false || v === '') return;
    const [names, falls] = SPEC_NAMES[field];
    if (typeof v === 'string' && names.includes(v)) return;
    out.push(`spec ${field} ${JSON.stringify(v) ?? String(v)} is not a name the sprites know — they draw ${falls} (known: ${names.join(', ')})`);
  };
  /** @param {unknown} o */
  const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? /** @type {Record<string, unknown>} */ (o) : null);
  one('hat', s.hat);
  one('hairStyle', s.hairStyle);
  one('weapon', s.weapon);
  one('build', s.build);
  one('outfit.style', obj(s.outfit)?.style);
  one('cape.style', obj(s.cape)?.style);
  one('gear.crest', obj(s.gear)?.crest);
  return out;
}

/** Top textures of the tiles that count as streets on a level file (dirt is yard ground, not a street). */
const PATH_TOPS = new Set(['dirt_path', 'cobblestone', 'stone_tiles', 'wood_deck', 'flagstone']);
/** Height of one stair step (TileMap STEP_H) and the water depth of a tile without a level (AUTO_WATER_DEPTH). */
const STEP_H = 0.125;
const AUTO_WATER_DEPTH = 0.35;

/**
 * Is a tile definition a street (a walkable path-type top or stairs)?
 * @param {TileDef|undefined} d
 */
export const isPathDef = (d) => !!d && !d.water && !d.void && d.walkable !== false && (!!d.stairs || PATH_TOPS.has(d.top));

/**
 * A `createGrid` grid filled from a level's `tiles` / `heights` rows: water by the legend, the
 * path tiles (`pathMask`) inferred from the tile types (`isPathDef`), no street centre lines.
 * @param {Level} level a normalised level (`parseLevel` / `normalizeLevel`)
 */
export function gridFromLevel(level) {
  const g = createGrid({ width: level.width, depth: level.depth });
  const legend = level.legend;
  for (let j = 0; j < level.depth; j++) {
    for (let i = 0; i < level.width; i++) {
      const k = g.I(i, j);
      g.tiles[k] = level.tiles[j][i];
      g.levels[k] = charToLevel(level.heights[j][i]);
      if (isPathDef(legend[g.tiles[k]])) g.pathMask[k] = 1;
    }
  }
  g.isWater = (i, j) => !!legend[g.T(i, j)]?.water;
  return g;
}

/**
 * Water surface of tile (i, j) as TileMap computes it (legend `waterLevel` / `waterDepth`, else the
 * level's `waterLevel` when it is above the bed, else bed + 0.35).
 * @param {ReturnType<typeof createGrid>} g
 * @param {Level} level
 */
export function waterSurfaceAt(g, level, i, j) {
  const d = level.legend[g.T(i, j)];
  const h = g.L(i, j) * 0.5;
  if (typeof d?.waterLevel === 'number') return d.waterLevel;
  if (typeof d?.waterDepth === 'number') return h + d.waterDepth;
  const global = level.waterLevel ?? 0.4;
  return global > h + 0.02 ? global : h + AUTO_WATER_DEPTH;
}

/**
 * The deck height of a bridge with `deckY: null`, as the game picks it (ObjectBuilder
 * `bridgeDeckHeight`): the bank half a tile beyond either end, never below the water under the
 * span + 0.1; no bank: 0.3 above the water.
 * @param {ReturnType<typeof createGrid>} g
 * @param {Level} level
 * @param {LevelObject} o bridge
 */
export function bridgeDeckY(g, level, o) {
  const dx = o.x1 - o.x0; const dz = o.z1 - o.z0; const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len; const uz = dz / len;
  const groundAt = (x, z) => {
    const i = Math.floor(x); const j = Math.floor(z);
    const d = g.inMap(i, j) ? level.legend[g.T(i, j)] : null;
    if (!d || d.water || d.void) return null;
    const h = g.L(i, j) * 0.5;
    return d.stairs ? clamp(h + STEP_H * 0.5 + stairT(d.stairs, x - i, z - j) * 0.5, h, h + 0.5) : h;
  };
  const a = groundAt(o.x0 - ux * 0.5, o.z0 - uz * 0.5);
  const b = groundAt(o.x1 + ux * 0.5, o.z1 + uz * 0.5);
  let water = -Infinity;
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const i = Math.floor(o.x0 + dx * t); const j = Math.floor(o.z0 + dz * t);
    if (g.isWater(i, j)) water = Math.max(water, waterSurfaceAt(g, level, i, j));
  }
  const bankY = a ?? b;
  if (bankY != null) return water > -Infinity ? Math.max(bankY, water + 0.1) : bankY;
  if (water > -Infinity) return water + 0.3;
  return g.L(Math.floor(o.x0), Math.floor(o.z0)) * 0.5;
}

/**
 * Sightline corridors south of everything the camera must see (villagers 3 × 9, door fronts
 * 2.5 × 8.5, wells, campfires and signs 2 × 4.5): the scatter keeps trunks out of them and the
 * checks fail a hand-placed tree inside one.
 * @param {ReturnType<typeof createPlacer>} P
 */
export function addSightlines(P) {
  for (const o of P.objects) {
    if (o.type === 'npc') P.view(o.x, o.z, 3, 9);
    else if (o.type === 'house') { const d = P.doorOf(o); P.view(d.x, d.z - 1, 2.5, 8.5); }
    else if (o.type === 'well' || o.type === 'campfire' || o.type === 'signpost') P.view(o.x, o.z, 2, 4.5);
  }
}

/**
 * A placer holding a level's objects: their colliders reserved, the bridges (a pier — one end
 * over water — listed with that end last; a `deckY: null` deck resolved with `bridgeDeckY`), the
 * waterfalls and the object sightlines.
 * @param {ReturnType<typeof createGrid>} g
 * @param {Level} level
 */
export function placerFromLevel(g, level) {
  const P = createPlacer(g);
  const onBank = (x, z) => {
    const i = Math.floor(x); const j = Math.floor(z);
    const d = g.inMap(i, j) ? level.legend[g.T(i, j)] : null;
    return !!d && !d.water && !d.void && d.walkable !== false;
  };
  for (let o of level.objects) {
    if (o.type === 'bridge') {
      if (o.deckY == null) o = { ...o, deckY: bridgeDeckY(g, level, o) };
      const dx = o.x1 - o.x0; const dz = o.z1 - o.z0; const len = Math.hypot(dx, dz) || 1;
      const a = onBank(o.x0 - (dx / len) * 0.5, o.z0 - (dz / len) * 0.5);
      const b = onBank(o.x1 + (dx / len) * 0.5, o.z1 + (dz / len) * 0.5);
      // a pier: one end on a bank, the other over water (checked from the bank end)
      const pier = a !== b;
      const span = !a && b ? { ...o, x0: o.x1, z0: o.z1, x1: o.x0, z1: o.z0 } : o;
      P.BRIDGES.push({ o: span, pier, name: o.id });
    }
    P.objects.push(o);
    P.usedIds.add(o.id);
    const def = OBJECT_TYPES[o.type];
    if (def.kind === 'prop' || o.type === 'npc') P.reserve(o);
    if (o.type === 'waterfall') P.FALLS.push(o);
  }
  addSightlines(P);
  return P;
}

/**
 * The camera pitch where a figure stands: `highGround.pitch` above `highGround.minY`, else the
 * camera pitch (default 32°).
 * @param {Partial<LevelEnvironment>} env
 * @returns {(y: number) => number}
 */
export function cameraPitch(env) {
  const base = Number.isFinite(env?.camera?.pitch) ? env.camera.pitch : 32;
  const hg = env?.highGround;
  if (!hg || !Number.isFinite(hg.minY)) return () => base;
  const high = Number.isFinite(hg.pitch) ? hg.pitch : base;
  return (y) => (y > hg.minY ? high : base);
}

/**
 * What the camera must see past the tree crowns (yaw 0): villagers and the spot south of them,
 * door fronts, signs and their reading spots, campfires, wells (`o`: the object each belongs to).
 * @param {LevelObject[]} objects
 * @param {(o: LevelObject) => { x: number, z: number }} doorOf
 */
export function sightTargets(objects, doorOf) {
  const out = [];
  for (const o of objects) {
    if (o.type === 'npc') {
      out.push({ what: `villager ${o.id}`, x: o.x, z: o.z, h0: 0.25, h1: 1.6, o });
      out.push({ what: `the talk spot south of ${o.id}`, x: o.x, z: o.z + 1.1, h0: 0.25, h1: 1.6, o });
    } else if (o.type === 'house') { const d = doorOf(o); out.push({ what: `the door of ${o.id}`, x: d.x, z: d.z, h0: 0.25, h1: 1.6, o }); }
    else if (o.type === 'signpost') {
      out.push({ what: `signpost ${o.id}`, x: o.x, z: o.z, h0: 0.4, h1: 1.8, o });
      out.push({ what: `the reading spot of ${o.id}`, x: o.x, z: o.z + 0.9, h0: 0.25, h1: 1.6, o });
    } else if (o.type === 'campfire') out.push({ what: `campfire ${o.id}`, x: o.x, z: o.z, h0: 0.1, h1: 0.8, o });
    else if (o.type === 'well') out.push({ what: `well ${o.id}`, x: o.x, z: o.z, h0: 0.2, h1: 1.4, o });
  }
  return out;
}

const inRect = (x, z, r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

/**
 * Object types whose presence changes no other object's checks — no collider, deck, roof, crown,
 * sight target, walk start or goal, region: their `when` / `unless` do not split a level into story
 * states (they are checked as if always there).
 */
const SELF_CONTAINED = new Set(['event', 'marker', 'light', 'emitter', 'critters', 'wallTorch', 'waterfall', 'enemy', 'rug', 'wallWindow']);

/**
 * A frozen level's walkable ice (The Bells of Evermere, docs/contracts/EVERMERE_CAMPAIGN.md §5.2:
 * `environment.frost` with `ice: true` — the game lays walk surfaces on its water while it is
 * frozen, src/game/thaw/ThawKit.js): checked as a conditioned object of its own, there `unless` the
 * frost's `until` holds (a level without a story: always), whose story states walk on the water.
 */
const ICE_ID = '\u0000frost-ice';

/**
 * The frost's walkable ice: its `until`, or null (no frost, no `ice`).
 * @param {Level} level
 * @returns {{ until: string }|null}
 */
function frostIce(level) {
  const f = /** @type {any} */ (level.environment)?.frost;
  return f && typeof f === 'object' && f.ice === true && typeof f.until === 'string' && f.until.trim() ? { until: f.until } : null;
}

/**
 * The grid and level the walk model reads where the water is frozen: every water tile walkable at
 * its water surface (as the game's ice walk surfaces), nothing else changed.
 * @param {ReturnType<typeof createGrid>} g
 * @param {Level} level
 */
function icedWalk(g, level) {
  const ICE = '\u0001';
  const wet = (ch) => ch != null && !!level.legend[ch]?.water;
  const T = (i, j) => (wet(g.T(i, j)) ? ICE : g.T(i, j));
  const L = (i, j) => (wet(g.T(i, j)) ? waterSurfaceAt(g, level, i, j) * 2 : g.L(i, j));
  return { g: { ...g, T, L }, level: { ...level, legend: { ...level.legend, [ICE]: { top: 'ice', walkable: true } } } };
}

/**
 * The box round every water tile (where the walk model's nodes change with the ice), or null.
 * @param {ReturnType<typeof createGrid>} g
 * @param {Level} level
 */
function waterBox(g, level) {
  let b = null;
  for (let j = 0; j < g.D; j++) {
    for (let i = 0; i < g.W; i++) {
      if (!level.legend[g.T(i, j)]?.water) continue;
      b = b ? { minX: Math.min(b.minX, i), maxX: Math.max(b.maxX, i + 1), minZ: Math.min(b.minZ, j), maxZ: Math.max(b.maxZ, j + 1) } : { minX: i, maxX: i + 1, minZ: j, maxZ: j + 1 };
    }
  }
  return b;
}
/** Below this many nodes an unreachable (or sometimes unreachable) patch of ground is not reported. */
const POCKET_MIN = 48;

/**
 * @typedef {object} CheckOptions
 * @property {boolean} [strict] the composition rules are errors (the generators' bar), not warnings
 * @property {[name: string, from: XZ, to: XZ][]} [routes] walks that must stay direct
 *   (≤ 1.5 × the straight line + 3 on the walk grid)
 * @property {{ name: string, points: XZ[], width: number }[]} [paths] street centre lines that no
 *   prop may block (default `g.PATHS`; a level file has none)
 * @property {Set<LevelObject>} [scattered] trees placed by a scatter (exempt from the
 *   hand-placed-tree sightline rule; on a level file every tree counts as hand-placed)
 * @property {(y: number) => number} [pitchAt] camera pitch by ground height (default from the environment)
 * @property {number} [hiddenShareMax] most path tiles behind roofs (0.03)
 * @property {number} [minVillagers] warn below this many villagers
 * @property {StoryContext|false} [story] what the campaign's story files declare, for the level's
 *   story checks (`storyIssues`; default {}: nothing declared is known); false: skip them (the
 *   campaign check runs them itself, with its story)
 * @property {boolean} [storyStates] judge the level in each of its **story states** — what the
 *   objects' `when` / `unless` let be there (default: when the level has a story, `levelHasStory`:
 *   the game applies conditions only then; a campaign's levels always have one — `checkCampaign`
 *   and `check-level.mjs` on a file in a campaign folder pass true). With it, two objects the story
 *   never has there together do not overlap, and what is reached only in some states is a warning
 *   that names them.
 * @property {number} [maxStoryTests] every combination of up to this many tests that depend on
 *   each other (one object's condition makes them, or they read one value) is tried (12); past that
 *   only all of them off, all on and each one alone flipped from either
 * @property {number} [maxStoryStates] at most this many story states are checked (default: 64 on a
 *   128 × 128 level, more on a smaller one — `defaultMaxStoryStates`, up to 256); with more, a
 *   sample of them, and the report says so
 * @property {boolean} [reuseStates] false: every story state is checked from scratch, nothing
 *   reused from another (the same report, slower — the self-test compares the two)
 */

/**
 * The most story states `checkLevel` checks by default: 64 on a 128 × 128 level (a story state
 * costs about a walk over the level's walk grid), as many more on a smaller one as its walk grid is
 * smaller — at most 256.
 * @param {{ W: number, D: number }} g
 */
export function defaultMaxStoryStates(g) {
  const nodes = (g.W * 4 + 1) * (g.D * 4 + 1);
  return Math.max(64, Math.min(256, Math.floor((64 * 513 * 513) / nodes)));
}

/**
 * One result of the checks in one story state.
 * @typedef {object} Finding
 * @property {'error'|'warning'|'info'|''} sev  '' a check run once over all story states (`key`
 *   names it: `#walk-grid`, `#travel-issues`, `#story`, `#pockets`, `#overlaps`)
 * @property {string} text
 * @property {string} key  the check and what it is about, the same in every state (default: the text)
 * @property {string[]} of  ids of the objects it is about: it applies in the states that have them all
 * @property {string} [reach]  a "cannot be reached" check: what is reached ("reached only …" when it
 *   is in some states)
 * @property {(when: string) => string} [only]  another reach check: its message when it fails in some
 *   states only (`when`: the states where it passes)
 */

/**
 * Check a level against the generators' rules — in each of its story states when its objects carry
 * `when` / `unless` (`storyStates` option): a finding that holds in every state where what it is
 * about is there is reported as without conditions; something reached only in some states is one
 * warning per set of states ("reached only with `bridge-mended`: exit exit_east …"); any other finding
 * that holds only in some states names them ("… (without `bridge-mended`)"). When not every state
 * could be checked (too many), what none of those checked reaches is a warning that says so, and
 * the states of other findings are not named. A level without conditions gets the same report as
 * before story states existed.
 *
 * The first story state is checked in full; the others reuse what it worked out wherever nothing
 * that differs between them is near (the walk grid's node heights, the camera's view rays past roofs
 * and crowns), and the checks that do not depend on what is there (stairs, waterfalls, environment
 * areas) run once.
 * @param {Level} level a normalised level
 * @param {{ g: ReturnType<typeof createGrid>, P: ReturnType<typeof createPlacer> }} ctx its grid and
 *   placer (`gridFromLevel` / `placerFromLevel`, or a generator's own; each story state's placer is
 *   made from it: its objects that are there, their bridges as it resolved them, the sightlines)
 * @param {CheckOptions} [options]
 * @returns {{ errors: string[], warnings: string[], info: string[] }}
 */
export function checkLevel(level, { g, P }, options = {}) {
  const { strict = false, story = {} } = options;
  const perState = options.storyStates ?? levelHasStory(level);
  const report = { errors: [], warnings: [], info: [] };
  /** @param {Finding['sev']} sev @param {string} m */
  const out = (sev, m) => (sev === 'error' ? report.errors : sev === 'warning' ? report.warnings : report.info).push(m);
  const conditioned = perState ? level.objects.filter((o) => !SELF_CONTAINED.has(o.type) && hasStoryCondition(o)) : [];
  // (a frozen level's walkable ice: there while its frost holds — `frostIce`)
  const ice = perState ? frostIce(level) : null;
  if (ice) conditioned.push(/** @type {any} */ ({ id: ICE_ID, type: ICE_ID, unless: ice.until }));
  if (!conditioned.length) {
    if (!perState) {
      const n = level.objects.filter(hasStoryCondition).length;
      if (n) out('info', `story conditions on ${n} object${n === 1 ? '' : 's'} are not applied: a level without a story (no event, no villager with a talk script or an actor) shows everything — checked so`);
    }
    for (const f of checkState(level, g, P, options, null).findings) out(f.sev, f.text);
    return report;
  }

  // ---- story states: what is there under each combination of what the conditions test ----
  const maxStates = options.maxStoryStates ?? defaultMaxStoryStates(g);
  const ss = storyStates(conditioned, { maxTests: options.maxStoryTests ?? 12, maxStates });
  const N = ss.states.length;
  const sampled = !ss.exhaustive;
  const condIds = new Set(conditioned.map((o) => o.id));
  const presentIds = ss.states.map((st) => new Set([...st.present].map((o) => o.id)));
  const isThere = (s, id) => !condIds.has(id) || presentIds[s].has(id);
  const n = ss.tests.length;
  const tests = ss.tests.map((t) => `\`${t.label}\``).join(', ');
  let how = n > 1 ? ' (every combination checked)' : '';
  if (sampled) {
    const why = [];
    for (const gr of ss.groups) {
      if (!gr.exhaustive) why.push(`${gr.tests.length} tests that depend on each other (${gr.tests.map((i) => `\`${ss.tests[i].label}\``).join(', ')}) are too many for every combination: all of them off, all on and each one alone flipped from either were tried`);
    }
    if (ss.capped) why.push(`there are ${ss.groups.every((gr) => gr.exhaustive) ? '' : 'at least '}${ss.total} states, more than the ${maxStates} checked`);
    how = `; not every combination was tried (${why.join('; ')}) — what none of the states checked reaches is a warning, and findings of some states do not say which`;
  }
  out('info', `story states: ${N}${sampled ? ' checked' : ''} — what is there depends on ${tests || 'no test'}${how}`);
  const acc = walkAccumulator(N);
  // (the placer's own objects: a bridge's deck height resolved — for what a state changes)
  const placed = new Map(P.objects.map((o) => [o.id, o]));
  const fresh = options.reuseStates === false;
  const shared = stateCache(conditioned.map((o) => placed.get(o.id) ?? o));
  /** @type {Finding[][]} */
  const runs = ss.states.map((_, s) => {
    const keep = (o) => isThere(s, o.id);
    const cache = fresh ? stateCache(shared.conditioned) : shared;
    const differs = s && !fresh ? cache.conditioned.filter((o) => isThere(s, o.id) !== isThere(0, o.id)) : [];
    const { findings, walk } = checkState({ ...level, objects: level.objects.filter(keep) }, g, statePlacer(g, P, keep), options, { cache, first: fresh || s === 0, differs, there: (id) => isThere(s, id) });
    acc.add(walk, s);
    return findings;
  });
  /** @param {Set<number>} on @param {Set<number>} off */
  const when = (on, off) => describeStates(ss, on, off);
  const notAll = `${N} story states checked (not every combination was tried)`;

  /** findings by key: per state, the finding there */
  /** @type {Map<string, { first: Finding, per: Map<number, Finding> }>} */
  const keys = new Map();
  /** the keys in the checks' order (a key first met in a later state goes after the one before it there) */
  const order = [];
  runs.forEach((list, s) => {
    let at = -1;
    for (const f of list) {
      let e = keys.get(f.key);
      if (!e) {
        keys.set(f.key, (e = { first: f, per: new Map() }));
        order.splice(++at, 0, f.key);
      } else at = order.indexOf(f.key);
      e.per.set(s, f);
    }
  });
  /** @type {([Finding['sev'], string] | { words: string, items: string[] })[]} */
  const emitted = [];
  /** @type {Map<string, { words: string, items: string[] }>} "reached only" groups by their states */
  const groups = new Map();
  const reachedOnly = (words, item) => {
    let gr = groups.get(words);
    if (!gr) { groups.set(words, (gr = { words, items: [] })); emitted.push(gr); }
    gr.items.push(item);
  };
  const softSev = strict ? 'error' : 'warning';
  const entrances = levelEntrances(level).length;
  for (const key of order) {
    const e = keys.get(key);
    if (key === '#walk-grid') {
      emitted.push(['info', `walk grid: ${acc.reachedSome} of ${acc.standableSome} standable nodes reachable from the spawn${entrances ? ` and ${entrances} entrance${entrances === 1 ? '' : 's'}` : ''}${N > 1 ? ` in some story state, ${acc.reachedAll} in all ${N}` : ''}`]);
    } else if (key === '#travel-issues') {
      for (const m of travelIssues(level)) emitted.push(['error', m]);
    } else if (key === '#story') {
      if (story !== false) for (const i of storyIssues(level, story)) emitted.push([i.severity === 'error' ? 'error' : 'warning', `story: ${formatStoryIssue(i, level)}`]);
    } else if (key === '#text-keys') {
      for (const [sev, m] of textKeyFindings(level, strict)) emitted.push([sev, m]);
    } else if (key === '#overlaps') {
      overlapChecks(P, (m) => emitted.push([softSev, m]), true);
    } else if (key === '#pockets') {
      // ground no state reaches: the old pockets; ground some states reach: "reached only …"
      for (const p of acc.patches()) {
        const where = `round (${p.x}, ${p.z}) — box x ${p.box[0]}–${p.box[1]}, z ${p.box[2]}–${p.box[3]}`;
        if (p.seen.size) reachedOnly(when(p.seen, p.fail), `the walkable ground ${where} (${p.nodes} nodes)`);
        // (a sample of the states: some other state may reach it — never an error)
        else if (sampled) emitted.push(['warning', `a walkable pocket of ${p.nodes} nodes ${where} is reached in none of the ${notAll}`]);
        else emitted.push([softSev, `an unreachable walkable pocket of ${p.nodes} nodes ${where}`]);
      }
    } else {
      const E = new Set();
      for (let s = 0; s < N; s++) if (e.first.of.every((id) => isThere(s, id))) E.add(s);
      /** @type {Map<string, number[]>} */
      const texts = new Map();
      for (const [s, f] of e.per) texts.set(f.text, [...(texts.get(f.text) ?? []), s]);
      const passing = new Set([...E].filter((s) => !e.per.has(s)));
      const failing = new Set(e.per.keys());
      if (!passing.size && texts.size === 1) {
        // (a sample of the states: what none of them reaches may be reached in another — a warning)
        if (sampled && (e.first.reach || e.first.only)) emitted.push(['warning', `${e.first.text} in any of the ${notAll}`]);
        else emitted.push([e.first.sev, e.first.text]);
      } else if (passing.size && e.first.reach) reachedOnly(when(passing, failing), e.first.reach);
      else if (passing.size && e.first.only) emitted.push(['warning', e.first.only(when(passing, failing))]);
      else {
        for (const [t, list] of texts) {
          const on = new Set(list);
          emitted.push([e.per.get(list[0]).sev, `${t} (${when(on, new Set([...E].filter((s) => !on.has(s))))})`]);
        }
      }
    }
  }
  for (const x of emitted) {
    if (Array.isArray(x)) out(x[0], x[1]);
    else out('warning', `reached only ${x.words}: ${x.items.join(', ')}`);
  }
  return report;
}

/**
 * The content-text key findings of a level (docs/specs/I18N.md §4.2): an info line counting the
 * keyed texts; the texts with no key (`missing`) one finding — a level from before keys has
 * hundreds; `npm run i18n:keys` lists them one by one — and each key on no text (`stray`) a
 * warning, or an error with `strict`; one key on two texts (`repeated`) an error.
 * @param {Level} level
 * @param {boolean} strict
 * @returns {[Finding['sev'], string][]}
 */
export function textKeyFindings(level, strict) {
  /** @type {[Finding['sev'], string][]} */
  const out = [];
  const soft = strict ? 'error' : 'warning';
  const texts = levelTexts(level);
  if (texts.length) out.push(['info', `text keys: ${texts.filter((t) => t.key).length} of ${texts.length} texts keyed`]);
  const issues = textKeyIssues(level);
  const missing = issues.filter((i) => i.kind === 'missing').length;
  if (missing) {
    out.push([soft, `text keys: ${missing} text${missing === 1 ? ' has' : 's have'} no key — ${missing === 1 ? 'it stays' : 'they stay'} English in every language (\`npm run i18n:keys -- <file>\` lists them, \`npm run i18n:keys -- --assign <file>\` gives them keys)`]);
  }
  for (const i of issues) {
    if (i.kind === 'missing') continue;
    out.push([i.severity === 'error' ? 'error' : soft, `text keys: ${i.where}: ${i.msg}`]);
  }
  return out;
}

/**
 * Words for the story states `on`, against those in `off`: "with `a`", "without `a`",
 * "when `item:plank >= 3`", "when `a and not b`", "when `(a and b) or c`" — a cover of `on` that
 * takes in none of `off`: by the groups of tests that depend on each other (`storyStates`), each
 * cube as wide as it can be (greedy), each group's part as short as it can be (over the group's
 * combinations; those that cannot happen or whose states belong to neither are free). From a
 * sample of the states (not every one checked) no words are made: "in some of the story states
 * checked".
 * @param {ReturnType<typeof storyStates>} ss
 * @param {Set<number>} on
 * @param {Set<number>} off
 */
export function describeStates(ss, on, off) {
  if (!on.size) return 'in no story state';
  if (!ss.exhaustive) return 'in some of the story states checked';
  const onP = [...on].map((s) => ss.states[s].pick);
  const offP = [...off].map((s) => ss.states[s].pick);
  /** @param {(Set<number>|null)[]} cube (null: the group is free) @param {number[]} pick */
  const covers = (cube, pick) => cube.every((A, gi) => !A || A.has(pick[gi]));
  const clean = (cube) => !offP.some((x) => covers(cube, x));
  /** @type {(Set<number>|null)[][]} */
  const cubes = [];
  let rest = onP;
  while (rest.length) {
    /** @type {(Set<number>|null)[]} */
    const cube = rest[0].map((p) => new Set([p]));
    cube.forEach((A, gi) => {
      cube[gi] = null;
      if (clean(cube)) return;
      cube[gi] = A;
      for (let p = 0; p < ss.groups[gi].patterns.length; p++) {
        if (A.has(p)) continue;
        A.add(p);
        if (!clean(cube)) A.delete(p);
      }
      if (A.size === ss.groups[gi].patterns.length) cube[gi] = null;
    });
    cubes.push(cube);
    rest = rest.filter((x) => !covers(cube, x));
  }
  if (cubes.some((c) => c.every((A) => !A))) return 'in every story state';
  /** @param {[number, number]} l */
  const lit = ([i, v]) => (v ? ss.tests[i].label : ss.tests[i].notLabel);
  /** @param {[number, number][]} c */
  const conj = (c) => c.map(lit).join(' and ');
  /** @param {[number, number][][]} d */
  const disj = (d) => d.map((c) => (d.length > 1 && c.length > 1 ? `(${conj(c)})` : conj(c))).join(' or ');
  // each cube: the literals of the groups one conjunction describes, and the groups a disjunction does
  const parts = cubes.map((cube) => {
    /** @type {[number, number][]} */
    const lits = [];
    /** @type {[number, number][][][]} */
    const ors = [];
    cube.forEach((A, gi) => {
      if (!A) return;
      const d = groupCover(ss.groups[gi], A);
      if (d.length === 1) lits.push(...d[0]);
      else ors.push(d);
    });
    lits.sort((a, b) => a[0] - b[0]);
    return { lits, ors };
  });
  if (parts.length === 1 && !parts[0].ors.length && parts[0].lits.length === 1) {
    const [i, v] = parts[0].lits[0];
    if (ss.tests[i].bare) return `${v ? 'with' : 'without'} \`${ss.tests[i].label}\``;
  }
  /** @param {{ lits: [number, number][], ors: [number, number][][][] }} p */
  const conjText = (p) => {
    if (!p.lits.length && p.ors.length === 1) return disj(p.ors[0]);
    const items = [
      ...p.lits.map((l) => ({ at: l[0], s: lit(l) })),
      ...p.ors.map((d) => ({ at: Math.min(...d.flat().map((l) => l[0])), s: `(${disj(d)})` })),
    ].sort((a, b) => a.at - b.at);
    return items.map((x) => x.s).join(' and ');
  };
  if (parts.length === 1) return `when \`${conjText(parts[0])}\``;
  return `when \`${parts.map((p) => {
    const t = conjText(p);
    return p.lits.length + p.ors.length * 2 > 1 ? `(${t})` : t;
  }).join(' or ')}\``;
}

/**
 * A short cover of one group's combinations whose patterns are in `A`, taking in none of the
 * others' (greedy: each cube drops what literals it can, as written first) — the literals as
 * [test index, value].
 * @param {import('../../src/engine/level/StoryStates.js').StoryGroup} gr
 * @param {Set<number>} A
 * @returns {[number, number][][]}
 */
function groupCover(gr, A) {
  const num = (b) => b.reduce((m, v, j) => m + v * 2 ** j, 0);
  const onBits = gr.patterns.flatMap((p, k) => (A.has(k) ? p.combos : [])).sort((a, b) => num(a) - num(b));
  const offBits = gr.patterns.flatMap((p, k) => (A.has(k) ? [] : p.combos));
  /** @type {[number, number][][]} */
  const cubes = [];
  let rest = onBits;
  while (rest.length) {
    const a = rest[0];
    const covers = (lits, x) => lits.every((j) => x[j] === a[j]);
    let lits = gr.tests.map((_, j) => j);
    for (const j of [...lits]) {
      const fewer = lits.filter((k) => k !== j);
      if (!offBits.some((x) => covers(fewer, x))) lits = fewer;
    }
    cubes.push(lits.map((j) => /** @type {[number, number]} */ ([gr.tests[j], a[j]])));
    rest = rest.filter((x) => !covers(lits, x));
  }
  return cubes;
}

/**
 * The placer of one story state: `P`'s objects that are there (`keep`) with their colliders, the
 * bridges as `P` resolved them, the waterfalls and the object sightlines.
 * @param {ReturnType<typeof createGrid>} g
 * @param {ReturnType<typeof createPlacer>} P
 * @param {(o: LevelObject) => boolean} keep
 */
function statePlacer(g, P, keep) {
  const Q = createPlacer(g);
  for (const o of P.objects) {
    if (!keep(o)) continue;
    Q.objects.push(o);
    Q.usedIds.add(o.id);
    const def = OBJECT_TYPES[o.type];
    if (def.kind === 'prop' || o.type === 'npc') Q.reserve(o);
  }
  for (const b of P.BRIDGES) if (keep(b.o)) Q.BRIDGES.push(b);
  for (const f of P.FALLS) if (keep(f)) Q.FALLS.push(f);
  addSightlines(Q);
  return Q;
}

/**
 * What one story state works out that the others reuse (`checkState`). From the first state —
 * reused where nothing that differs from it is near: its walk model (the node heights), the ground
 * heights at the spots the camera rules look from (`y0`, `stand`). From any state, by what decides
 * them: the view rays past roofs (`hidden`) and past crowns and roofs (`cover`) by spot, height and
 * which of the conditioned roofs and trees near the rays are there (`near`: those, by spot); the
 * terrain march of the "wall or cliff hides a walker" rule by tile and height (`walled`). And the
 * findings of the checks that do not depend on what is there (`once`).
 * @param {LevelObject[]} conditioned the objects whose presence differs between states (the
 *   placer's own: a bridge's deck height resolved)
 */
function stateCache(conditioned) {
  return {
    conditioned,
    /** the conditioned roofs, wells, windmills and trees: what can stop a view ray in some states only */
    occluders: conditioned.filter((o) => o.type === 'house' || o.type === 'well' || o.type === 'windmill' || o.type === 'tree'),
    /** @type {ReturnType<typeof createWalkModel>|null} */
    walk: null,
    /** @type {Map<string, [Finding['sev'], string, any][]>} */
    once: new Map(),
    /** @type {Map<string, number>} */
    y0: new Map(),
    /** @type {Map<string, number>} */
    stand: new Map(),
    /** @type {Map<string, LevelObject[]>} */
    near: new Map(),
    /** @type {Map<string, LevelObject|null>} */
    hidden: new Map(),
    /** @type {Map<string, { share: number, by: Map<any, number> }>} */
    cover: new Map(),
    /** @type {Map<string, boolean>} */
    walled: new Map(),
  };
}

/**
 * The checks' story-state context: the cache, whether this is the first state, the objects whose
 * presence differs from the first state's (the placer's own) and whether an object is there.
 * @typedef {{ cache: ReturnType<typeof stateCache>, first: boolean, differs: LevelObject[], there: (id: string) => boolean }} StateRun
 */

/**
 * The walk grids of every story state together (`add` each state's walk model): how much is reached
 * in some state and in all, and the patches of standable ground that no state reaches or only some
 * do. Each node keeps its history over the states as an id (the same history, the same id).
 * @param {number} N the number of states
 */
function walkAccumulator(N) {
  let G = 4; let GW = 0; let GD = 0;
  /** height of each node where some state can stand there (NaN: none) */
  let hgt = new Float32Array(0);
  /** each node's history: an index into the arrays below (0: no state can stand there yet) */
  let hist = new Uint32Array(0);
  let seenCount = new Uint16Array(0);
  /** histories: the one before, the state added, whether that state reaches the node; any state that does not */
  const before = [0]; const stateOf = [-1]; const reached = [0]; const anyFail = [0];
  /** @param {number} h @returns {{ seen: Set<number>, fail: Set<number> }} */
  const statesOf = (h) => {
    const seen = new Set(); const fail = new Set();
    for (let x = h; x; x = before[x]) (reached[x] ? seen : fail).add(stateOf[x]);
    return { seen: new Set([...seen].sort((a, b) => a - b)), fail: new Set([...fail].sort((a, b) => a - b)) };
  };
  let counts = null;
  const acc = {
    get standableSome() { return (counts ??= tally()).standableSome; },
    get reachedSome() { return (counts ??= tally()).reachedSome; },
    get reachedAll() { return (counts ??= tally()).reachedAll; },
    /** @param {ReturnType<typeof createWalkModel>} walk @param {number} s */
    add(walk, s) {
      counts = null;
      if (!hgt.length) {
        ({ G, GW, GD } = walk);
        hgt = new Float32Array(walk.hgt.length).fill(NaN);
        hist = new Uint32Array(hgt.length);
        seenCount = new Uint16Array(hgt.length);
      }
      /** @type {Map<number, number>} (history × 2 + reached) → the history with this state added */
      const next = new Map();
      let lastKey = -1; let lastId = 0;
      for (let k = 0; k < hgt.length; k++) {
        const h = walk.hgt[k];
        if (h !== h) continue;
        if (hgt[k] !== hgt[k]) hgt[k] = h;
        const r = walk.seen[k] ? 1 : 0;
        const key = hist[k] * 2 + r;
        // (neighbouring nodes mostly share their history: the last one first)
        let id = key === lastKey ? lastId : next.get(key);
        if (id === undefined) {
          id = before.length;
          before.push(hist[k]); stateOf.push(s); reached.push(r); anyFail.push(anyFail[hist[k]] || !r ? 1 : 0);
          next.set(key, id);
        }
        lastKey = key; lastId = id;
        hist[k] = id;
        if (r) seenCount[k]++;
      }
    },
    /**
     * Connected patches (≥ POCKET_MIN nodes; the walk grid's steps) of standable ground that some
     * state does not reach, alike in which states reach it (`seen`, empty: none) and which do not
     * (`fail`), largest first.
     * @returns {{ nodes: number, x: number, z: number, box: number[], seen: Set<number>, fail: Set<number> }[]}
     */
    patches() {
      const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      const done = new Uint8Array(hgt.length);
      const out = [];
      for (let k = 0; k < hgt.length; k++) {
        if (done[k] || !anyFail[hist[k]]) continue;
        const q = [k]; done[k] = 1;
        let sx = 0; let sz = 0; let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
        for (let h = 0; h < q.length; h++) {
          const c = q[h]; const gx = c % GW; const gz = (c - gx) / GW;
          sx += gx; sz += gz; x0 = Math.min(x0, gx); x1 = Math.max(x1, gx); z0 = Math.min(z0, gz); z1 = Math.max(z1, gz);
          for (const [dx, dz] of NB) {
            const nx = gx + dx; const nz = gz + dz;
            if (nx < 0 || nz < 0 || nx >= GW || nz >= GD) continue;
            const m = nz * GW + nx;
            if (done[m] || hist[m] !== hist[k] || Math.abs(hgt[m] - hgt[c]) > 0.55) continue;
            done[m] = 1;
            q.push(m);
          }
        }
        if (q.length >= POCKET_MIN) {
          out.push({ nodes: q.length, x: +(sx / q.length / G).toFixed(1), z: +(sz / q.length / G).toFixed(1), box: [x0 / G, x1 / G, z0 / G, z1 / G], ...statesOf(hist[k]) });
        }
      }
      return out.sort((a, b) => b.nodes - a.nodes);
    },
  };
  function tally() {
    let standableSome = 0; let reachedSome = 0; let reachedAll = 0;
    for (let k = 0; k < hgt.length; k++) {
      if (hgt[k] === hgt[k]) standableSome++;
      if (seenCount[k]) reachedSome++;
      if (seenCount[k] === N) reachedAll++;
    }
    return { standableSome, reachedSome, reachedAll };
  }
  return acc;
}

/**
 * No two props overlap (approximate colliders) — unless the story never has them there together
 * (`storyExclusive`, when `exclusive`: the level's conditions apply).
 * @param {ReturnType<typeof createPlacer>} P
 * @param {(m: string) => void} soft
 * @param {boolean} exclusive
 */
function overlapChecks(P, soft, exclusive) {
  const pairs = new Set();
  const overlap = (a, b) => {
    if (a.c === 'seg' || b.c === 'seg') {
      const s = a.c === 'seg' ? a : b; const o = s === a ? b : a;
      if (o.c === 'seg') return false;
      const n = Math.max(2, Math.ceil(Math.hypot(s.x1 - s.x0, s.z1 - s.z0) / 0.2));
      for (let k = 0; k <= n; k++) if (hitShape(o, s.x0 + ((s.x1 - s.x0) * k) / n, s.z0 + ((s.z1 - s.z0) * k) / n, s.h - 0.02)) return true;
      return false;
    }
    if (a.c === 'circle' && b.c === 'circle') return (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < (a.r + b.r - 0.02) ** 2;
    if (a.c === 'box' && b.c === 'box') return a.minX < b.maxX - 0.02 && b.minX < a.maxX - 0.02 && a.minZ < b.maxZ - 0.02 && b.minZ < a.maxZ - 0.02;
    const c = a.c === 'circle' ? a : b; const bx = c === a ? b : a;
    return hitShape(bx, c.x, c.z, c.r - 0.02);
  };
  for (const a of P.allShapes) {
    const ab = shapeBounds(a);
    for (const b of P.shapesNear((ab.minX + ab.maxX) / 2, (ab.minZ + ab.maxZ) / 2)) {
      if (a === b || a.owner === b.owner) continue;
      const key = a.owner.id < b.owner.id ? `${a.owner.id}|${b.owner.id}` : `${b.owner.id}|${a.owner.id}`;
      if (pairs.has(key)) continue;
      if (a.owner.type === 'npc' || b.owner.type === 'npc') continue;
      if (overlap(a, b)) {
        pairs.add(key);
        // (a bridge and the wreckage it replaces: never there together)
        if (!(exclusive && storyExclusive(a.owner, b.owner))) soft(`overlap: ${a.owner.id} × ${b.owner.id}`);
      }
    }
  }
}

/**
 * The checks in one story state (or of a level without one).
 * @param {Level} level a normalised level (in a story state: its objects that are there)
 * @param {ReturnType<typeof createGrid>} g
 * @param {ReturnType<typeof createPlacer>} P
 * @param {CheckOptions} options
 * @param {StateRun|null} multi one of several story states: the checks that look at every state at
 *   once (the walk-grid summary, `travelIssues`, the story, pockets, overlaps) are left as
 *   placeholders; what the first state worked out is reused where nothing that differs is near
 * @returns {{ findings: Finding[], walk: ReturnType<typeof createWalkModel> }}
 */
function checkState(level, g, P, options, multi) {
  const { strict = false, routes = [], paths = g.PATHS, scattered = new Set(), hiddenShareMax = 0.03, minVillagers = null, story = {} } = options;
  const pitchAt = options.pitchAt ?? cameraPitch(level.environment);
  const { W, D, T, L, I, inMap } = g;
  const legend = level.legend;
  // (by id: a generator's normalised level holds copies of the objects it placed)
  const scatteredIds = new Set([...scattered].map((t) => t.id));
  const stairDir = (ch) => legend[ch]?.stairs;
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Map<string, number>} */
  const keyCount = new Map();
  /** @type {[Finding['sev'], string, any][]|null} what `add` is given while a check's findings are kept for the other states */
  let recording = null;
  /**
   * @param {Finding['sev']} sev
   * @param {string} text
   * @param {{ key?: string, of?: (string|undefined)[], reach?: string, only?: (when: string) => string }} [meta]
   */
  const add = (sev, text, meta = {}) => {
    if (recording) recording.push([sev, text, meta]);
    let key = meta.key ?? text;
    const k = keyCount.get(key) ?? 0;
    keyCount.set(key, k + 1);
    if (k) key = `${key}#${k}`;
    findings.push({ sev, text, key, of: (meta.of ?? []).filter((id) => id != null), reach: meta.reach, only: meta.only });
  };
  const err = (m, meta = undefined) => add('error', m, meta);
  const warn = (m, meta = undefined) => add('warning', m, meta);
  const soft = (m, meta = undefined) => add(strict ? 'error' : 'warning', m, meta);
  const info = (m, meta = undefined) => add('info', m, meta);
  const once = (key) => add('', '', { key });
  /**
   * A check that does not depend on what is there: run in the first story state, its findings
   * replayed in the others.
   * @param {string} name
   * @param {() => void} run
   */
  const stateFree = (name, run) => {
    const kept = multi?.cache.once.get(name);
    if (kept) { for (const [sev, text, meta] of kept) add(sev, text, meta); return; }
    if (multi) recording = [];
    run();
    if (multi) { multi.cache.once.set(name, recording); recording = null; }
  };
  // what differs from the first story state, and where (the walk grid: colliders and decks grown by
  // more than the player's radius; the view rays: roofs, wells, windmills and tree crowns)
  const differs = multi && !multi.first ? multi.differs : [];
  const grow = (b, m) => ({ minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m });
  const dirty = differs.flatMap((o) => (o.id === ICE_ID ? [waterBox(g, level)].filter(Boolean) : [...P.collidersOf(o).map(shapeBounds), ...(o.type === 'bridge' ? walkRectsOf(o) : [])]).map((b) => grow(b, 0.5)));
  // a frozen level's water is walked on while its frost holds (`frostIce`; without a story: always)
  const iced = !!frostIce(level) && (multi ? multi.there(ICE_ID) : true);
  const inDirty = (x, z) => dirty.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
  /**
   * A value at (x, z) the first story state worked out, unless something that differs is near.
   * @param {Map<string, number>|undefined} memo @param {number} x @param {number} z @param {() => number} work
   */
  const firstOr = (memo, x, z, work) => {
    if (!multi) return work();
    const k = `${x},${z}`;
    if (multi.first) { const v = work(); memo.set(k, v); return v; }
    const v = memo.get(k);
    return v === undefined || inDirty(x, z) ? work() : v;
  };
  /**
   * The conditioned roofs, wells, windmills (and trees, with `crowns`) that may stop a view ray from
   * (x, z) toward the camera (yaw 0: +z), up to `far` along z, and which of them are there: a key
   * for what the rays can meet (a roof reaches hypot(half width, half depth + 0.25) + 1 from its
   * centre, a well's or windmill's top 1.65, a crown less than half the tree's height + 3 across
   * the ray; each + 0.5).
   * @param {string} key the spot @param {number} x @param {number} z @param {number} far @param {boolean} crowns
   */
  const nearKey = (key, x, z, far, crowns) => {
    if (!multi) return '';
    let near = multi.cache.near.get(key);
    if (!near) {
      near = multi.cache.occluders.filter((o) => {
        let r;
        if (o.type === 'tree') { if (!crowns) return false; r = 0.5 * (o.opts?.height ?? 4.5) + 3; }
        else if (o.type === 'house') { const half = Math.max(o.opts?.width ?? 4, o.opts?.depth ?? 3) / 2; r = Math.hypot(half, half + 0.25) + 1; }
        else r = 1.65;
        r += 0.5;
        return Math.abs(o.x - x) <= r && o.z >= z - r && o.z <= z + far + r;
      });
      multi.cache.near.set(key, near);
    }
    return near.map((o) => (multi.there(o.id) ? '1' : '0')).join('');
  };
  // a campaign level is entered at its entrances too (docs/specs/CAMPAIGN_FORMAT.md)
  const entrances = levelEntrances(level);
  const exits = levelExits(level);
  /** @type {[number, number][]|null} */
  const starts = entrances.length ? [[level.spawn.x, level.spawn.z], ...entrances.map((o) => /** @type {[number, number]} */ ([o.x, o.z]))] : null;
  // (a later story state: the first one's node heights, worked out again only where something differs)
  const reuse = multi?.cache.walk ? { hgt: multi.cache.walk.hgt, rects: dirty } : null;
  const ice = iced ? icedWalk(g, level) : null;
  const walk = createWalkModel(ice?.g ?? g, P, ice?.level ?? level, { starts, reuse });
  if (multi && !multi.cache.walk) multi.cache.walk = walk;
  const { reachNear, surfaceAt, standable, walkLength, tileDef, walkRects } = walk;
  const objects = level.objects;
  if (multi) once('#walk-grid');
  else info(`walk grid: ${walk.reached} of ${walk.standableCount} standable nodes reachable from the spawn${entrances.length ? ` and ${entrances.length} entrance${entrances.length === 1 ? '' : 's'}` : ''}`);
  // campaign travel: exits reachable, entrances standable and on a way to an exit
  if (exits.length || entrances.length) {
    if (multi) once('#travel-issues');
    else for (const m of travelIssues(level)) err(m);
    const reachableIn = (r) => {
      for (let z = Math.ceil(r.minZ * 4) / 4; z < r.maxZ; z += 0.25) for (let x = Math.ceil(r.minX * 4) / 4; x < r.maxX; x += 0.25) if (walk.reachableAt(x, z)) return true;
      return false;
    };
    for (const o of exits) {
      const what = `exit ${o.id} (→ ${o.to || '?'})`;
      if (!reachableIn(o)) err(`${what} cannot be reached from the spawn or an entrance`, { key: `exit-reach:${o.id}`, of: [o.id], reach: what });
    }
    for (const o of entrances) {
      const name = entranceName(o);
      let near = standable(o.x, o.z) === standable(o.x, o.z);
      for (let k = 0; k < 16 && !near; k++) {
        const a = (k / 16) * Math.PI * 2;
        near = standable(o.x + Math.cos(a) * 0.75, o.z + Math.sin(a) * 0.75) === standable(o.x + Math.cos(a) * 0.75, o.z + Math.sin(a) * 0.75);
      }
      if (!near) err(`entrance ${name}: the player cannot stand there (nothing standable within 0.75 u)`, { key: `entrance-stand:${o.id}`, of: [o.id] });
      const c = walk.componentAt(o.x, o.z);
      if (exits.length && c && !exits.some((e) => walk.componentsIn(e).has(c))) {
        warn(`entrance ${name}: a player arriving there cannot walk to any exit`, { key: `entrance-exit:${o.id}`, of: [o.id], only: (w) => `entrance ${name}: a player arriving there can walk to an exit only ${w}` });
      }
    }
    info(`travel: ${exits.length} exit${exits.length === 1 ? '' : 's'} (${[...new Set(exits.map((o) => o.to || '?'))].join(', ') || '—'}), ${entrances.length} entrance${entrances.length === 1 ? '' : 's'}`);
  }
  // the story: scripts and conditions that do not parse, events without what their trigger needs,
  // names the level does not have (StoryChecks.js) — errors stay errors, also without `strict`
  if (story !== false) {
    if (multi) once('#story');
    else for (const i of storyIssues(level, story)) (i.severity === 'error' ? err : warn)(`story: ${formatStoryIssue(i, level)}`);
  }
  // the content-text keys: a text with no key, a key on no text, one key on two texts
  if (multi) once('#text-keys');
  else for (const [sev, m] of textKeyFindings(level, strict)) add(sev, m);
  // unreachable walkable pockets
  if (multi) once('#pockets');
  else for (const p of walk.pockets(POCKET_MIN)) soft(`an unreachable walkable pocket of ${p.nodes} nodes round (${p.x}, ${p.z}) — box x ${p.box[0]}–${p.box[1]}, z ${p.box[2]}–${p.box[3]}`);
  // routes
  for (const [name, [ax, az], [bx, bz]] of routes) {
    const straight = Math.hypot(bx - ax, bz - az);
    const len = walkLength(ax, az, bx, bz);
    const limit = straight * 1.5 + 3;
    if (!(len <= limit)) err(`route "${name}" is a long detour: ${len === Infinity ? 'no walk' : `${len.toFixed(1)} u`} for ${straight.toFixed(1)} u as the crow flies (limit ${limit.toFixed(1)})`, { key: `route:${name}` });
    else info(`route ${name}: ${len.toFixed(1)} u (${straight.toFixed(1)} straight)`, { key: `route-info:${name}` });
  }
  // interactions: villagers, doors, signs, wells — and every region
  for (const o of objects) {
    const y = P.groundY(o.x, o.z);
    if (o.type === 'npc') {
      const tp = o.talkOffset ? [o.x + o.talkOffset[0], o.z + o.talkOffset[1]] : [o.x, o.z];
      const ys = surfaceAt(o.x, o.z);
      const who = `NPC ${o.id} (${o.name})`;
      if (!reachNear(tp[0], tp[1], (o.talkRadius ?? 1.6) - 0.15, ys === ys ? ys : y)) err(`${who} cannot be reached to talk`, { key: `npc-talk:${o.id}`, of: [o.id], reach: who });
      if (ys !== ys) err(`NPC ${o.id} stands on unwalkable ground`, { of: [o.id] });
      const blocker = P.allShapes.find((c) => c.owner.id !== o.id && c.owner.type !== 'npc' && hitShape(c, o.x, o.z, 0.3));
      // (a stall keeper among the stall's crates is a design choice: soft)
      if (blocker) soft(`NPC ${o.id} stands inside ${blocker.owner.id}`, { of: [o.id, blocker.owner.id] });
      if (o.behaviour === 'chase' && o.area) {
        const a = o.area; let ok = 0; let n = 0;
        for (let z = o.z + a.minZ; z <= o.z + a.maxZ; z += 0.5) for (let x = o.x + a.minX; x <= o.x + a.maxX; x += 0.5) { n++; if (standable(x, z, true) === standable(x, z, true)) ok++; }
        if (n && ok / n < 0.5) err(`chase area of ${o.id} is only ${Math.round((100 * ok) / n)} % walkable`, { key: `chase:${o.id}`, of: [o.id] });
      }
    } else if (o.type === 'house') {
      const d = P.doorOf(o);
      const what = `the door of ${o.id} (${o.name})`;
      if (!reachNear(d.x, d.z, 0.85, y)) err(`door of ${o.id} (${o.name}) is not reachable`, { key: `door-reach:${o.id}`, of: [o.id], reach: what });
    } else if (o.type === 'signpost') {
      if (!reachNear(o.x, o.z, 1.2, y)) err(`signpost ${o.id} is not reachable`, { key: `sign-reach:${o.id}`, of: [o.id], reach: `signpost ${o.id}` });
    } else if (o.type === 'well') {
      if (!reachNear(o.x, o.z, 1.6, y)) err(`well ${o.id} is not reachable`, { key: `well-reach:${o.id}`, of: [o.id], reach: `well ${o.id}` });
    } else if (o.type === 'region') {
      let ok = false;
      for (let z = Math.ceil(o.minZ * 2) / 2; z < o.maxZ && !ok; z += 0.5) for (let x = Math.ceil(o.minX * 2) / 2; x < o.maxX; x += 0.5) {
        if (walk.reachableAt(x, z) && (o.minY == null || surfaceAt(x, z) > o.minY)) { ok = true; break; }
      }
      if (!ok) soft(`region ${o.id} (${o.name}) has no reachable ground`, { key: `region-reach:${o.id}`, of: [o.id], reach: `region ${o.id} (${o.name})` });
    }
  }
  // paths not blocked by props
  for (const p of paths) {
    if (p.width < 1.5) continue;
    for (let k = 0; k < p.points.length - 1; k++) {
      const [ax, az] = p.points[k]; const [bx, bz] = p.points[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5));
      for (let s = 0; s <= n; s++) {
        const x = ax + ((bx - ax) * s) / n; const z = az + ((bz - az) * s) / n;
        const i = Math.floor(x); const j = Math.floor(z);
        if (!inMap(i, j)) continue;
        if (g.isWater(i, j)) {
          if (standable(x, z, true) !== standable(x, z, true)) { err(`path "${p.name}" crosses water without a bridge at (${x.toFixed(1)}, ${z.toFixed(1)})`); s = n; }
          continue;
        }
        if (!g.pathMask[I(i, j)]) continue;
        const b = P.blockedAt(x, z, 0.29, (ow) => ow.type === 'npc');
        if (b) { err(`path "${p.name}" is blocked at (${x.toFixed(1)}, ${z.toFixed(1)}) by ${b.id}`, { of: [b.id] }); s = n; }
      }
    }
  }
  // stairs rise toward their direction, one level per tile
  stateFree('stairs', () => { for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    const ch = T(i, j);
    const dir = stairDir(ch);
    if (!dir) continue;
    const [fx, fz] = CARDINAL[dir];
    const l = L(i, j);
    const ahead = T(i + fx, j + fz); const behind = T(i - fx, j - fz);
    const flat = (c) => c && legend[c]?.walkable !== false && !legend[c]?.water && !legend[c]?.void && !stairDir(c);
    const okA = (ahead === ch && L(i + fx, j + fz) === l + 1) || (flat(ahead) && L(i + fx, j + fz) === l + 1);
    const okB = (behind === ch && L(i - fx, j - fz) === l - 1) || (flat(behind) && L(i - fx, j - fz) === l);
    if (!okA || !okB) err(`stairs ${ch} at (${i}, ${j}) level ${l}: ${okA ? '' : `the high side (${ahead}${L(i + fx, j + fz)}) is not level ${l + 1}`} ${okB ? '' : `the low side (${behind}${L(i - fx, j - fz)}) is not level ${l}`}`);
  } });
  // waterfalls: on a tile edge between a higher and a lower water tile, a real drop (the same in
  // every story state: their conditions split nothing)
  stateFree('waterfalls', () => { for (const f of P.FALLS) {
    const [fx, fz] = CARDINAL[f.facing];
    const onEdge = fz ? Number.isInteger(f.z) : Number.isInteger(f.x);
    const ti = Math.floor(f.x - fx * 0.5 + 0.01); const tj = Math.floor(f.z - fz * 0.5 + 0.01);
    const bi = Math.floor(f.x + fx * 0.5 + 0.01); const bj = Math.floor(f.z + fz * 0.5 + 0.01);
    const of = { of: [f.id] };
    if (!onEdge) err(`waterfall ${f.id} is not on a tile edge`, of);
    if (!g.isWater(ti, tj) || !g.isWater(bi, bj)) { err(`waterfall ${f.id}: no water above / below`, of); continue; }
    const drop = waterSurfaceAt(g, level, ti, tj) - waterSurfaceAt(g, level, bi, bj);
    if (drop < 0.5) err(`waterfall ${f.id}: drop ${drop.toFixed(2)} is too small`, of);
    for (let k = 0; k < Math.round(f.width); k++) {
      const ci = fz ? Math.floor(f.x - f.width / 2 + k + 0.5) : ti; const cj = fz ? tj : Math.floor(f.z - f.width / 2 + k + 0.5);
      if (!g.isWater(ci, cj)) err(`waterfall ${f.id}: the lip is not water across its width`, of);
    }
    info(`waterfall ${f.id}: drop ${drop.toFixed(2)}`, of);
  } });
  // bridges span water bank to bank, and can be walked end to end
  for (const { o, pier, name } of P.BRIDGES) {
    const dx = o.x1 - o.x0; const dz = o.z1 - o.z0; const len = Math.hypot(dx, dz); const ux = dx / len; const uz = dz / len;
    const bank = (x, z) => { const d = tileDef(Math.floor(x), Math.floor(z)); return d && !d.water && !d.void && d.walkable !== false ? L(Math.floor(x), Math.floor(z)) * 0.5 : null; };
    const a = bank(o.x0 - ux * 0.5, o.z0 - uz * 0.5); const b = bank(o.x1 + ux * 0.5, o.z1 + uz * 0.5);
    const of = { of: [o.id] };
    let wetN = 0;
    for (let t = 0.05; t < 1; t += 0.05) if (g.isWater(Math.floor(o.x0 + dx * t), Math.floor(o.z0 + dz * t))) wetN++;
    if (!wetN) err(`bridge ${o.id} does not cross water`, of);
    if (a == null || (!pier && b == null)) err(`bridge ${o.id}: an end is not on a bank`, of);
    if (a != null && Math.abs(a - o.deckY) > 0.5) err(`bridge ${o.id}: deck ${o.deckY} vs bank ${a}`, of);
    if (!pier && b != null && Math.abs(b - o.deckY) > 0.5) err(`bridge ${o.id}: deck ${o.deckY} vs far bank ${b}`, of);
    let prev = null; let bad = null;
    for (let t = -0.9; t <= (pier ? len - 0.4 : len + 0.9) + 1e-6; t += 0.2) {
      const x = o.x0 + ux * t; const z = o.z0 + uz * t;
      const h = standable(x, z, true);
      if (h !== h) { bad = `not standable at (${x.toFixed(2)}, ${z.toFixed(2)})`; break; }
      if (prev != null && Math.abs(h - prev) > 0.55) { bad = `a ${Math.abs(h - prev).toFixed(2)} step at (${x.toFixed(2)}, ${z.toFixed(2)})`; break; }
      prev = h;
    }
    if (bad) err(`bridge ${o.id} cannot be walked end to end: ${bad}`, { key: `bridge-walk:${o.id}`, of: [o.id] });
    info(`bridge ${name}: ${len.toFixed(1)} long, deck ${+o.deckY.toFixed(3)}`, of);
  }
  // props stand on proper ground (trees and rocks may stand on forest or rock, rocks in water);
  // buildings on flat, dry footprints
  const FLAT = new Set(['house', 'marketStall', 'well', 'campfire', 'bench', 'windmill']);
  for (const o of objects) {
    const def = OBJECT_TYPES[o.type];
    if (def.kind !== 'prop' || def.placement !== 'point' || o.type === 'wallTorch' || o.type === 'wallWindow' || o.type === 'light' || o.type === 'waterfall') continue;
    const i = Math.floor(o.x); const j = Math.floor(o.z);
    if (!inMap(i, j)) continue; // (reported below as outside the map)
    const d = tileDef(i, j);
    const onDeck = walkRects.some((r) => o.x >= r.minX && o.x <= r.maxX && o.z >= r.minZ && o.z <= r.maxZ);
    const natural = o.type === 'tree' || o.type === 'rock';
    const ground = !!d && !d.void && (d.water ? o.type === 'rock' || o.type === 'ship' : d.walkable !== false || natural);
    if (!onDeck && !ground) soft(`${o.id} stands on ${JSON.stringify(T(i, j))} at (${o.x}, ${o.z})`, { of: [o.id] });
    if (FLAT.has(o.type)) {
      const b = P.collidersOf(o)[0];
      const bb = b ? shapeBounds(b) : { minX: o.x - 0.5, maxX: o.x + 0.5, minZ: o.z - 0.5, maxZ: o.z + 0.5 };
      const l0 = L(i, j);
      for (let jj = Math.floor(bb.minZ + 0.15); jj <= Math.floor(bb.maxZ - 0.15); jj++) for (let ii = Math.floor(bb.minX + 0.15); ii <= Math.floor(bb.maxX - 0.15); ii++) {
        const dd = tileDef(ii, jj);
        if (!dd || dd.water || dd.stairs || dd.walkable === false || L(ii, jj) !== l0) { soft(`${o.id} footprint is uneven or wet at tile (${ii}, ${jj})`, { of: [o.id] }); ii = 1e9; jj = 1e9; }
      }
    }
  }
  // no two props overlap (approximate colliders)
  if (multi) once('#overlaps');
  else overlapChecks(P, soft, options.storyStates ?? levelHasStory(level));
  for (const o of objects) {
    if (o.type !== 'house') continue;
    const d = P.doorOf(o);
    const b = P.blockedAt(d.x, d.z, 0.35, (ow) => ow.id === o.id || ow.type === 'npc');
    if (b) soft(`door of ${o.id} is blocked by ${b.id}`, { of: [o.id, b.id] });
  }
  // the camera (yaw 0) sees every villager, talk spot, door, sign, well and campfire past the roofs
  const { roofAt } = roofsOf(objects, P.groundY);
  /** @param {number} x @param {number} z @param {number} hh @param {LevelObject|null} [skip] @returns {LevelObject|null} */
  const hiddenBy = (x, z, hh, skip = null) => {
    const y0 = firstOr(multi?.cache.y0, x, z, () => surfaceAt(x, z));
    // (story states: once per spot, height and which roofs near the ray — 18 u at most — are there)
    const key = multi ? `${x},${z},${hh},${skip?.id ?? ''},${y0},${nearKey(`${x},${z}`, x, z, 18, false)}` : '';
    if (multi?.cache.hidden.has(key)) return multi.cache.hidden.get(key);
    const y = (y0 === y0 ? y0 : P.groundY(x, z)) + hh;
    const p = (pitchAt(y0 === y0 ? y0 : P.groundY(x, z)) * Math.PI) / 180;
    let hit = null;
    for (let t = 0.1; t < 18 && !hit; t += 0.1) hit = roofAt(x, y + Math.sin(p) * t, z + Math.cos(p) * t, skip);
    multi?.cache.hidden.set(key, hit);
    return hit;
  };
  for (const o of objects) {
    const spots = [];
    if (o.type === 'npc') {
      spots.push([`villager ${o.id}`, o.x, o.z, 1.0]);
      spots.push([`the talk spot south of ${o.id}`, o.x, o.z + 1.1, 1.0]);
    } else if (o.type === 'house') { const d = P.doorOf(o); spots.push([`the door of ${o.id}`, d.x, d.z, 1.0]); }
    else if (o.type === 'signpost') spots.push([`signpost ${o.id}`, o.x, o.z, 1.6]);
    else if (o.type === 'well') spots.push([`well ${o.id}`, o.x, o.z, 1.2]);
    else if (o.type === 'campfire') spots.push([`campfire ${o.id}`, o.x, o.z, 0.6]);
    for (const [what, x, z, hh] of spots) {
      const h = hiddenBy(x, z, hh, o.type === 'house' || o.type === 'well' ? o : null);
      if (h) soft(`${what} at (${x.toFixed(1)}, ${z.toFixed(1)}) is hidden from the camera behind ${h.id}`, { of: [o.id, h.id] });
    }
  }
  // walkers on the streets: the share hidden behind roofs (chest height)
  let pathTiles = 0; let hiddenTiles = 0; const hiders = {};
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    if (!g.pathMask[I(i, j)] || g.isWater(i, j)) continue;
    pathTiles++;
    const h = hiddenBy(i + 0.5, j + 0.5, 1.0);
    if (h) { hiddenTiles++; (hiders[h.id] ??= []).push(`${i},${j}`); }
  }
  const share = hiddenTiles / Math.max(1, pathTiles);
  const byHider = Object.entries(hiders).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k} ${v.length} (${v[0]}…)`).join(', ');
  info(`camera: a walker is behind a roof on ${hiddenTiles} of ${pathTiles} path tiles (${(100 * share).toFixed(1)} %)${byHider ? `: ${byHider}` : ''}`, { key: 'camera-roofs' });
  if (share > hiddenShareMax) soft(`${(100 * share).toFixed(1)} % of the path tiles are hidden behind roofs (at most ${Math.round(hiddenShareMax * 100)} %)`, { key: 'camera-share' });
  // … and past the terrain: no wall or cliff hides a walker to the waist at a path tile's centre
  const walled = [];
  for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
    if (!g.pathMask[I(i, j)] || g.isWater(i, j)) continue;
    const y0 = firstOr(multi?.cache.stand, i + 0.5, j + 0.5, () => standable(i + 0.5, j + 0.5, true));
    if (y0 !== y0) continue;
    // (the terrain alone, from that height: in story states once per tile and height)
    const memo = `${i},${j},${y0}`;
    let hit = multi?.cache.walled.get(memo);
    if (hit === undefined) {
      hit = false;
      const p = (pitchAt(y0) * Math.PI) / 180;
      for (let t = 0.1; t < 12; t += 0.1) {
        const ii = i; const jj = Math.floor(j + 0.5 + Math.cos(p) * t);
        if (!inMap(ii, jj)) break;
        const top = L(ii, jj) * 0.5 + (stairDir(T(ii, jj)) ? 0.25 : 0);
        if (top >= y0 + 1 && y0 + 0.5 + Math.sin(p) * t < top - 0.02) { hit = true; break; }
      }
      multi?.cache.walled.set(memo, hit);
    }
    if (hit) walled.push(`${i},${j}`);
  }
  if (walled.length) soft(`a wall or cliff hides a walker to the waist at the centre of ${walled.length} path tiles: ${walled.slice(0, 12).join(' ')}`, { key: 'walled' });
  // hand-placed trees keep the sightlines; no crown hides half of a sight target
  for (const t of objects) {
    if (t.type !== 'tree' || scatteredIds.has(t.id)) continue;
    const v = P.VIEWS.find((q) => t.z > q.z && t.z < q.z + q.depth && Math.abs(t.x - q.x) < q.w);
    if (v) soft(`hand-placed ${t.id} at (${t.x}, ${t.z}) stands in the sightline of (${v.x}, ${v.z})`, { of: [t.id] });
  }
  /** @type {ReturnType<typeof createOcclusion>|null} */
  let occl = null;
  for (const s of sightTargets(objects, P.doorOf)) {
    // (story states: once per target and which crowns and roofs near its view rays — 26 u along them,
    // the crowns 8 more — are there)
    const key = multi ? `${s.what}|${s.x}|${s.z}|${nearKey(`c${s.x},${s.z}`, s.x, s.z, 36, true)}` : '';
    let r = multi?.cache.cover.get(key);
    if (!r) {
      occl ??= createOcclusion({ g, objects, groundY: P.groundY, forestTop: scatterForestTop(g) });
      r = occl.cover(s.x, s.z, { yaw: 0, pitch: pitchAt(P.groundY(s.x, s.z)), h0: s.h0, h1: s.h1, terrain: false });
      multi?.cache.cover.set(key, r);
    }
    if (r.share >= 0.5) soft(`${s.what} at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) is ${Math.round(r.share * 100)} % hidden behind ${[...r.by.keys()].map((k) => k.id ?? k).join(', ')}`, { of: [s.o.id, ...[...r.by.keys()].map((k) => k.id)] });
  }
  // critters on walkable ground, wall torches on a wall, everything on the map, env rects overlap it
  const walkableAt = (x, z) => { const h = surfaceAt(x, z); return h === h; };
  for (const o of objects) {
    const def = OBJECT_TYPES[o.type];
    const of = { of: [o.id] };
    if (def.placement === 'point' && !(o.x >= 0 && o.z >= 0 && o.x <= W && o.z <= D)) soft(`${o.id} lies outside the map`, of);
    if (o.type === 'critters') {
      const bad = critterStartPoints(o, walkableAt).filter(([x, z]) => !walkableAt(x, z));
      if (bad.length) err(`critters ${o.id}: ${bad.length} animal(s) start off walkable ground`, { key: `critters:${o.id}`, of: [o.id] });
    } else if (o.type === 'wallTorch' || o.type === 'wallWindow') {
      // (a window sits on a wall face too: one standing in the open floats)
      const i = Math.floor(o.x); const j = Math.floor(o.z);
      let onWall = P.allShapes.some((c) => c.owner.type === 'house' && hitShape(c, o.x, o.z, 1.0));
      for (let dj = -1; dj <= 1 && !onWall; dj++) for (let di = -1; di <= 1; di++) if (inMap(i + di, j + dj) && Math.abs(L(i + di, j + dj) - L(i, j)) >= 2) { onWall = true; break; }
      if (!onWall) soft(`${o.type === 'wallTorch' ? 'wall torch' : 'wall window'} ${o.id} has no wall to hang on`, of);
    } else if (o.type === 'npc') {
      if (!CHARACTER_PRESET_NAMES.includes(o.preset)) err(`NPC ${o.id}: unknown preset ${o.preset}`, of);
      // (a name the sprites do not know draws its default without a word: a warning, never an error)
      for (const m of specIssues(/** @type {any} */ (o).spec)) warn(`NPC ${o.id}: ${m}`, of);
    } else if (o.type === 'emitter' && !EMITTER_PRESETS.includes(o.preset)) err(`emitter ${o.id}: unknown preset ${o.preset}`, of);
  }
  const env = level.environment;
  stateFree('env-areas', () => {
    for (const a of [...(env.godRayAreas ?? []), ...(env.foliage?.flowerAreas ?? []), ...(env.foliage?.shrubAreas ?? []), ...(env.forest?.areas ?? [])]) {
      if (!(a.maxX > a.minX && a.maxZ > a.minZ && a.maxX > 0 && a.minX < W && a.maxZ > 0 && a.minZ < D)) soft(`an environment area ${a.minX}–${a.maxX} × ${a.minZ}–${a.maxZ} does not overlap the map`);
    }
  });
  // every point the player can reach inside some region (else the HUD keeps a stale place name)
  const regionless = [];
  const regions = objects.filter((o) => o.type === 'region');
  for (let z = 0.5; z < D; z += 2) for (let x = 0.5; x < W; x += 2) {
    if (walk.reachableAt(x, z) && !regions.some((o) => inRect(x, z, o))) regionless.push(`(${x}, ${z})`);
  }
  if (regionless.length) soft(`${regionless.length} reachable point(s) lie in no region: ${regionless.slice(0, 8).join(' ')}${regionless.length > 8 ? ' …' : ''}`, { key: 'regionless' });
  // every region the current one somewhere: the HUD takes the first region that holds the player
  // (Game._updateRegion), so one whose reachable ground all lies in earlier regions never shows —
  // but for a region over the whole map: the level's fallback (Cinderwatch Pass, Gildhaven)
  /** @type {(o: any, x: number, z: number) => boolean} the game's test (half-open, `minY`) */
  const holds = (o, x, z) => x >= o.minX && x < o.maxX && z >= o.minZ && z < o.maxZ && (o.minY == null || surfaceAt(x, z) > o.minY);
  regions.forEach((o, k) => {
    if (o.minX <= 0 && o.maxX >= W && o.minZ <= 0 && o.maxZ >= D && o.minY == null) return;
    let ground = false;
    let wins = false;
    /** @type {Set<string>} */
    const before = new Set();
    for (let z = Math.ceil(o.minZ * 2) / 2; z < o.maxZ && !wins; z += 0.5) for (let x = Math.ceil(o.minX * 2) / 2; x < o.maxX; x += 0.5) {
      if (!walk.reachableAt(x, z) || !holds(o, x, z)) continue;
      ground = true;
      const first = regions.slice(0, k).find((a) => holds(a, x, z));
      if (!first) { wins = true; break; }
      before.add(`${first.id} (${first.name})`);
    }
    if (ground && !wins) soft(`region ${o.id} (${o.name}) is never the current region: ${[...before].join(', ')} come${before.size > 1 ? '' : 's'} first in the objects and hold${before.size > 1 ? '' : 's'} all its reachable ground — move it before ${before.size > 1 ? 'them' : 'it'}`, { key: `region-shadow:${o.id}`, of: [o.id] });
  });
  const npcs = objects.filter((o) => o.type === 'npc').length;
  if (minVillagers != null && npcs < minVillagers) warn(`only ${npcs} villagers — a bustling town wants ${minVillagers} or more`, { key: 'villagers' });
  return { findings, walk };
}
