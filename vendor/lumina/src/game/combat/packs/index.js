/**
 * The lazy enemy packs (docs/contracts/EVERMERE_CAMPAIGN.md §6.4, §7.5): a campaign's own enemy
 * kinds — their stats, brains, sheet painters, FX frames and particle presets — live in a chunk of
 * their own, which `CombatSystem.load` imports before it builds the presets, the sheets, the FX
 * atlas and the enemies, and only where the level's `enemy` objects use one of the pack's kinds (the
 * owner of a kind: src/engine/level/Owners.js `ownerOf('kinds', kind)`). A level of the shipped
 * kinds — Cinderwatch Pass, Vanquish the Evil Dragon — loads none and downloads none of it.
 *
 * A pack is a module whose `register(api)` registers what it brings through the API it is handed
 * (`EnemyPackApi`; the combat's is ./api.js `COMBAT_PACK_API`, the editor's preview ./editorApi.js
 * `EDITOR_PACK_API`). The registries are the page's, so each pack registers once per page:
 * `loadEnemyPacks` remembers it. Import-light on purpose (Owners.js only): the registries come with
 * the API, so the editor can load a pack without the combat's brains.
 *
 * Besides the API's registries a pack gets `registerSystem(name, make)` (COMBAT.md §30.1): a level
 * system of its own — the Hush Bell's toll — that `CombatSystem.load` makes (`make(sys)`; null: not
 * on this level) on a level that loads the pack, after the enemies, and runs with the fight
 * (`CombatPackSystem`: every sub-step, every frame, the warm-up, a reset, the dispose).
 *
 * @import { Brain, CombatPackSystem } from '../types.js'
 * @import { CombatSystem } from '../CombatSystem.js'
 * @import { BaseEnemyKind, PackEnemyKind, EnemyDef } from '../defs.js'
 * @import { EnemySheetKind, MonsterKind, MonsterKit } from '../../../engine/pixel/MonsterSprites.js'
 * @import { FxModule } from '../../../engine/pixel/FxSprites.js'
 * @import { Level } from '../../../engine/level/types.js'
 */
import { ownerOf } from '../../../engine/level/Owners.js';

/**
 * What a pack's `register(api)` gets: the registries, and what a pack may borrow from the kinds
 * that ship.
 * @typedef {object} EnemyPackApi
 * @property {(defs: Readonly<Partial<Record<PackEnemyKind, EnemyDef>>>) => void} registerEnemyDefs
 *   stats into `ENEMY_DEFS` (../defs.js; a kind defined twice throws)
 * @property {(kind: PackEnemyKind, brain: Brain) => void} registerBrain  a brain into `BRAINS`
 *   (../ai/index.js; the editor's API ignores it)
 * @property {(kind: EnemySheetKind, recipe: MonsterKind | ((kit: MonsterKit) => MonsterKind)) => void} registerMonsterKind
 *   a sheet recipe — a painter or a humanoid spec (src/engine/pixel/MonsterSprites.js)
 * @property {(mod: FxModule) => void} registerFxModule  FX atlas frames, generation `late` ≥ 3
 *   (src/engine/pixel/FxSprites.js; the editor's API ignores it)
 * @property {(presets: Readonly<Record<string, object>>) => void} registerPresets  particle presets
 *   (src/engine/fx/presets/combat.js `registerPackPresets`; the editor's API ignores it)
 * @property {(kind: string) => Readonly<MonsterKind>|null} monsterKind  a sheet recipe to borrow
 *   (its painter, columns and aliases; a pack gives its own ramps)
 * @property {MonsterKit} monsterKit  the monster painting kit (materials, columns, ramps, shapes)
 * @property {(kind: BaseEnemyKind) => Brain|null} brain  a shipped kind's brain to borrow (null in
 *   the editor)
 */

/**
 * A pack's level system maker (§30.1): the CombatSystem of a level that loaded the pack → its system,
 * or null where it has nothing to do (no black bell).
 * @typedef {(sys: CombatSystem) => CombatPackSystem|null} CombatPackSystemFactory
 */

/**
 * What a pack's `register` gets: the API's registries, `registerSystem` (one per name and owner; a
 * name given twice throws) and `registerMarkerStyles` (new ground-marker styles: names → ids ≥ 5
 * and their fragment branches — GroundMarkers.js `registerMarkerStyles`, which CombatSystem.load
 * calls with them before it makes its batch, so this module and the editor never import it).
 * @typedef {EnemyPackApi & {
 *   registerSystem(name: string, make: CombatPackSystemFactory): void,
 *   registerMarkerStyles(ids: Readonly<Record<string, number>>, glsl: string): void,
 * }} EnemyPackRegistrar
 */

/**
 * A pack module: registers its kinds' every part (stats first) through the API.
 * @typedef {{ register(api: EnemyPackRegistrar): void }} EnemyPack
 */

/**
 * owner (Owners.js) → the loader of its pack (a dynamic import: a chunk of its own).
 * @type {Record<string, () => Promise<EnemyPack>>}
 */
export const ENEMY_PACKS = {
  // the pack, and the core's part of it registered first (./evermere/core.js, COMBAT.md §30: the
  // ice gate's frames, the marker styles, the release's words, the pulse and the marks' look)
  evermere: () => Promise.all([import('./evermere/core.js'), import('./evermere/index.js')])
    .then(([core, pack]) => ({ register(api) { core.register(api); pack.register(api); } })),
};

/**
 * Add the pack of an owner (a campaign) — one per owner; an owner given twice throws.
 * @param {string} owner
 * @param {() => Promise<EnemyPack>} loader
 */
export function registerEnemyPack(owner, loader) {
  if (Object.hasOwn(ENEMY_PACKS, owner)) throw new Error(`registerEnemyPack: "${owner}" has a pack already`);
  ENEMY_PACKS[owner] = loader;
}

/**
 * The owners whose packs a level needs: those of the kinds its `enemy` objects use (level order).
 * A level of the shipped kinds needs none.
 * @param {Pick<Level, 'objects'>|null|undefined} level
 * @returns {string[]}
 */
export function packsFor(level) {
  /** @type {string[]} */
  const owners = [];
  for (const o of level?.objects ?? []) {
    if (o?.type !== 'enemy' || typeof o.kind !== 'string') continue;
    const owner = ownerOf('kinds', o.kind);
    if (owner !== null && Object.hasOwn(ENEMY_PACKS, owner) && !owners.includes(owner)) owners.push(owner);
  }
  return owners;
}

/** owner → its pack's registration (once per page). @type {Map<string, Promise<void>>} */
const loaded = new Map();

/** owner → its pack's level systems, in registration order. @type {Map<string, Map<string, CombatPackSystemFactory>>} */
const SYSTEMS = new Map();
/** owner → its pack's marker styles. @type {Map<string, { ids: Readonly<Record<string, number>>, glsl: string }[]>} */
const STYLES = new Map();

/**
 * The API a pack's `register` gets: `api` and its owner's `registerSystem`.
 * @param {EnemyPackApi} api
 * @param {string} owner
 * @returns {Readonly<EnemyPackRegistrar>}
 */
function registrar(api, owner) {
  return Object.freeze({
    ...api,
    registerSystem(name, make) {
      let m = SYSTEMS.get(owner);
      if (!m) SYSTEMS.set(owner, (m = new Map()));
      if (m.has(name)) throw new Error(`registerSystem: "${name}" twice`);
      m.set(name, make);
    },
    registerMarkerStyles(ids, glsl) {
      const list = STYLES.get(owner) ?? [];
      list.push({ ids, glsl: String(glsl) });
      STYLES.set(owner, list);
    },
  });
}

/**
 * The marker styles of the packs of `owners` (CombatSystem.load hands them to GroundMarkers before
 * it makes its batch).
 * @param {readonly string[]} owners
 * @returns {{ ids: Readonly<Record<string, number>>, glsl: string }[]}
 */
export function packMarkerStyles(owners) {
  return owners.flatMap((o) => STYLES.get(o) ?? []);
}

/**
 * The level-system makers of the packs of `owners` (owner order, then registration order) — those
 * registered on this page (`loadEnemyPacks` first).
 * @param {readonly string[]} owners
 * @returns {CombatPackSystemFactory[]}
 */
export function packSystems(owners) {
  const out = [];
  for (const owner of owners) for (const make of SYSTEMS.get(owner)?.values() ?? []) out.push(make);
  return out;
}

/**
 * Import and register the packs of `owners` (each once per page; a failed fetch may be tried again,
 * a registration that throws stays failed). Resolves when every one has registered.
 * @param {readonly string[]} owners
 * @param {EnemyPackApi} api
 * @returns {Promise<void>}
 */
export function loadEnemyPacks(owners, api) {
  return Promise.all(owners.map((owner) => {
    let p = loaded.get(owner);
    if (!p) {
      if (!Object.hasOwn(ENEMY_PACKS, owner)) return Promise.reject(new Error(`loadEnemyPacks: no pack for "${owner}"`));
      p = ENEMY_PACKS[owner]()
        .catch((err) => { loaded.delete(owner); throw err; })
        .then((mod) => mod.register(registrar(api, owner)));
      loaded.set(owner, p);
    }
    return p;
  })).then(() => undefined);
}

/**
 * The owners whose packs registered on this page (tests: `packs` in the fixture's checks).
 * @returns {string[]}
 */
export function loadedEnemyPacks() {
  return [...loaded.keys()];
}
