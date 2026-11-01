/**
 * Catalog of every object type a Luminati level can contain: defaults, placement style, editor
 * metadata (category, palette glyph/colour) and a field schema that drives the editor inspector.
 *
 * Object shapes (all have `id` and `type`):
 *   point  { id, type, x, z, rotation?, opts?, ...fields }                   (tile centre = i + 0.5)
 *   line   { id, type, x0, z0, x1, z1, opts?, ...fields }                    (fence, bridge)
 *   rect   { id, type, minX, maxX, minZ, maxZ, ...fields }                   (region)
 * `opts` is passed straight to the matching PropFactory method (see src/engine/world/Props.js).
 *
 * Field schema entries: { key, label, type, min?, max?, step?, nullable?, options?, help?, i18n? } where
 * `key` is a dotted path into the object ('opts.width'), `nullable` lets a number be left blank
 * (stored as null: bridge.deckY, region.minY) and `type` is one of:
 *   'number' | 'int' | 'angle' (radians stored, degrees shown) | 'bool' | 'select' | 'text' |
 *   'textarea' | 'lines' (string[], one entry per paragraph) | 'dialogue' (see NPC) | 'color' |
 *   'script' (string[], one line of a story script per entry — docs/specs/STORY_SCRIPT.md) |
 *   'condition' (text, a story condition).
 * `i18n: true` marks a field players read (a name, a text, dialogue, a script): the content-text
 * tools extract it for translation (src/engine/i18n/ContentStrings.js, docs/specs/I18N.md §4);
 * identity fields (ids, flags, entrance / marker names, `to`, `actor` …) never carry it.
 */
import { RNG, hashString } from '../utils/math.js';
import { isOwnKey, showValue, toText, toNumber, stripUnconvertible } from '../utils/own.js';
// (the small condition module, not the script parser StoryScript.js: every level loads this file)
import { hasScript } from './StoryCondition.js';
import { cleanTextKeysOf } from '../i18n/ContentKeys.js';

/**
 * @import { Level, LevelEnvironment, LevelObject, LevelObjectOf, ObjectType, ObjectOverrides,
 *   DialoguePage, Rect, XZ, ObjectTypeDef, FieldDef } from './types.js'
 */

// (the last four walls, the last two roofs and the last four tree kinds: the arid village and
// mountain of Vanquish the Evil Dragon, docs/contracts/DRAGON_CAMPAIGN.md §5.3)
export const WALL_TEXTURES = ['timber_frame', 'plaster', 'brick', 'stone_brick', 'log_wall', 'wood_planks', 'wood_planks_dark', 'adobe', 'sandstone_brick', 'whitewash', 'charred_wall'];
export const ROOF_TEXTURES = ['roof_red', 'roof_blue', 'roof_thatch', 'roof_slate', 'roof_terracotta', 'roof_charred'];
// (the last five: The Bells of Evermere's, owned in ./Owners.js — EVERMERE_CAMPAIGN.md §5.3)
export const TREE_KINDS = ['oak', 'autumn', 'pine', 'birch', 'juniper', 'deadwood', 'palm', 'cypress', 'blossom', 'maple', 'goldbirch', 'snowpine', 'bare'];
export const CLOTH_TEXTURES = ['cloth_stripe', 'cloth_red'];
export const FACINGS = ['down', 'left', 'right', 'up'];
export const CARDINALS = ['N', 'S', 'E', 'W'];
export const CHARACTER_PRESET_NAMES = [
  'traveler', 'swordsman', 'merchant', 'cleric', 'scholar', 'dancer', 'hunter',
  'villager', 'farmer', 'elder', 'child', 'guard', 'innkeeper', 'bard',
];
export const CRITTER_KINDS = ['chicken', 'cat', 'bird', 'dog'];
export const EMITTER_PRESETS = ['fireflies', 'leaves', 'petals', 'dust', 'embers', 'smoke', 'mist', 'sparkle', 'snow', 'rain'];

/** Built-in NPC behaviours a level can attach to an NPC (implemented by the game). */
export const NPC_ACTIONS = [
  { value: 'none', label: 'Just talk' },
  { value: 'rest', label: 'Innkeeper: offer rest until morning' },
  { value: 'shop', label: 'Merchant: sell an item' },
  { value: 'music', label: 'Bard: play music (offers quiet when playing)' },
];

/**
 * How an NPC moves (implemented by the game's Npc): wander around home, stand at a post and look
 * around, perform (face the audience), chase the chickens; and the set-piece behaviours
 * (`SETPIECE_BEHAVIOURS`).
 */
export const NPC_BEHAVIOURS = ['wander', 'post', 'perform', 'chase', 'panic', 'dance', 'cheer', 'cower', 'still'];

/**
 * The set-piece villager behaviours of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md
 * §5.3): `panic` (runs between random points of its wander radius, cowers, flees foes and
 * fireballs, cries out), `dance`, `cheer`, `cower`. Starfall Vale's coverage skips them; the dragon
 * campaign's generator places them.
 */
export const SETPIECE_BEHAVIOURS = ['panic', 'dance', 'cheer', 'cower'];

/**
 * Hand-written conversations (implemented in src/game/dialogue.js). '' = use `dialogue`.
 * 'drillmaster' is the combat tutorial guard and 'shopkeeper' the combat shop's menu (draughts and
 * one-time wares for gold) — both combat levels only (COMBAT.md §6.12); on a peaceful level they
 * play the NPC's own dialogue and action.
 */
export const NPC_SCRIPTS = ['', 'elder', 'innkeeper', 'merchant', 'guard', 'farmer', 'child', 'bard', 'scholar', 'drillmaster', 'shopkeeper'];

/** How an `exit` is used: walked into (a road at the map edge) or with Space (a door, a cave mouth). */
export const EXIT_MODES = [
  { value: 'walk', label: 'Walk into it' },
  { value: 'use', label: 'Press Space (a door, a cave mouth)' },
];

/**
 * Story conditions every object type has (optional, no default — absent from every file that does
 * not use them): the object is there only while `when` holds, and gone while `unless` holds. Each
 * is a story condition (docs/specs/STORY_SCRIPT.md §2) — a bare flag name, as before, or e.g.
 * `bridge-mended and not flood`. They apply in a campaign and on a level with a story (events or
 * talk scripts); the game re-checks them whenever the story changes (docs/specs/CAMPAIGN_FORMAT.md).
 * @type {FieldDef[]}
 */
export const STORY_FIELDS = [
  { key: 'when', label: 'Story: only when', type: 'condition', help: 'The object is there only while this story condition holds (a flag name, or e.g. "bridge-mended and not flood"). Blank = always.' },
  { key: 'unless', label: 'Story: gone when', type: 'condition', help: 'The object is gone while this story condition holds. Blank = never.' },
];

/**
 * When an `event` object runs its script (docs/specs/STORY_SCRIPT.md §4): Space in its rectangle,
 * stepping in / out, arriving in the level, its condition becoming true, the clock passing an hour,
 * the last foe of an enemy group falling.
 */
export const EVENT_TRIGGERS = [
  { value: 'use', label: 'Space inside it (prompt: Label)' },
  { value: 'enter', label: 'The player walks in' },
  { value: 'leave', label: 'The player walks out' },
  { value: 'arrive', label: 'The player arrives in the level' },
  { value: 'change', label: 'Its condition becomes true' },
  { value: 'time', label: 'The clock reaches an hour (At hour)' },
  { value: 'cleared', label: 'An enemy group is defeated (Group)' },
];

/**
 * Editor palette categories, in display order ('Interior': the furniture of rooms, `interior: true`;
 * 'Combat': the combat-only types, COMBAT.md §14).
 */
export const OBJECT_CATEGORIES = ['Buildings', 'Nature', 'Lights', 'Props', 'Interior', 'Structures', 'Water', 'Characters', 'Markers', 'Combat'];

/** Quilt colours of a `bed` (`opts.blanket`; the texture `quilt_<colour>`, props/Furniture.js BLANKETS). */
export const BLANKET_COLORS = ['red', 'blue', 'green', 'ochre', 'plum'];
/** Rug colours (`opts.color`; the texture `rug_<colour>`, props/Furniture.js RUGS). */
export const RUG_COLORS = ['red', 'blue', 'green'];

/**
 * Hostile kinds an `enemy` group can spawn (COMBAT.md §7.1); the game's stats are in
 * src/game/combat/defs.js. The last seven are the set-piece kinds of Vanquish the Evil Dragon
 * (`ENEMY_INFO[k].setpiece`, docs/contracts/DRAGON_CAMPAIGN.md §5.3): Cinderwatch Pass's coverage
 * skips them.
 */
export const ENEMY_KINDS = ['slime', 'goblin', 'archer', 'shaman', 'bat', 'boar', 'dummy', 'golem',
  'drakeborn', 'ashhound', 'wyrmcaller', 'kobold', 'whelp', 'emberimp', 'dragon',
  'hushguard', 'frostwolf', 'rimecrow', 'cantor', 'rimehart', 'mawkin', 'gullet', 'hushedking'];

/** The traits of a kind of The Bells of Evermere (set-piece kinds it owns). @returns {{ label: string, flier: boolean, boss: boolean, passive: boolean, humanoid: boolean, setpiece: boolean, owner: string }} */
const evermere = (label, boss = 0, flier = 0, humanoid = 0) => ({ label, flier: !!flier, boss: !!boss, passive: false, humanoid: !!humanoid, setpiece: true, owner: 'evermere' });
/**
 * Node-safe traits of every enemy kind, for the editor and the level generators. `boss`: the kind
 * is a boss (one per group, an arena and a gate, the boss bar); `setpiece`: the kind runs the
 * ambient step (COMBAT.md §29); `owner`: the campaign whose generator covers it (./Owners.js; absent:
 * the dragon campaign's for a set-piece kind, else Cinderwatch Pass's).
 * @type {Readonly<Record<string, { label: string, flier: boolean, boss: boolean, passive: boolean,
 *   humanoid: boolean, setpiece?: boolean, owner?: string }>>}
 */
export const ENEMY_INFO = Object.freeze({
  slime:  { label: 'Moss Slime',     flier: false, boss: false, passive: false, humanoid: false },
  goblin: { label: 'Bramble Goblin', flier: false, boss: false, passive: false, humanoid: true },
  archer: { label: 'Thorn Archer',   flier: false, boss: false, passive: false, humanoid: true },
  shaman: { label: 'Hex Shaman',     flier: false, boss: false, passive: false, humanoid: true },
  bat:    { label: 'Cinder Bat',     flier: true,  boss: false, passive: false, humanoid: false },
  boar:   { label: 'Ironhide Boar',  flier: false, boss: false, passive: false, humanoid: false },
  dummy:  { label: 'Straw Dummy',    flier: false, boss: false, passive: true,  humanoid: false },
  golem:  { label: 'Cinderheart (boss)', flier: false, boss: true, passive: false, humanoid: false },
  // Vanquish the Evil Dragon (DRAGON_CAMPAIGN.md §5.3)
  drakeborn:  { label: 'Drakeborn Ravager',    flier: false, boss: false, passive: false, humanoid: false, setpiece: true },
  ashhound:   { label: 'Ashen Hellhound',      flier: false, boss: false, passive: false, humanoid: false, setpiece: true },
  wyrmcaller: { label: 'Wyrmcult Pyromancer',  flier: false, boss: false, passive: false, humanoid: false, setpiece: true },
  kobold:     { label: 'Scalekin Skirmisher',  flier: false, boss: false, passive: false, humanoid: false, setpiece: true },
  whelp:      { label: 'Ashwing Whelp',        flier: false, boss: false, passive: false, humanoid: false, setpiece: true },
  emberimp:   { label: 'Ember Imp',            flier: true,  boss: false, passive: false, humanoid: false, setpiece: true },
  dragon:     { label: 'Vorthrax (boss)',      flier: false, boss: true,  passive: false, humanoid: false, setpiece: true },
  // The Bells of Evermere (EVERMERE_CAMPAIGN.md §5.4: `evermere`: label, boss, flier, humanoid)
  hushguard: evermere('Hushguard', 0, 0, 1),
  frostwolf: evermere('Frost Wolf'),
  rimecrow: evermere('Rime Crow', 0, 1),
  cantor: evermere('Hush Cantor', 0, 0, 1),
  rimehart: evermere('Rimehart (boss)', 1),
  mawkin: evermere('Harvest Mawkin (boss)', 1),
  gullet: evermere('Old Gullet (boss)', 1),
  hushedking: evermere('Hushed King (boss)', 1, 0, 1),
});

/** What a `chest` can hold besides gold and draughts (COMBAT.md §6.1: +20 max HP, +10 max MP, +3 attack). */
export const CHEST_UPGRADES = ['none', 'maxHp', 'maxMp', 'attack'];
/** Inspector labels of the chest upgrades (the stored values stay `CHEST_UPGRADES`; amounts from the game's rules). */
const CHEST_UPGRADE_LABELS = { none: 'None', maxHp: 'Max HP +20', maxMp: 'Max MP +10', attack: 'Attack +3' };

// ---- the set-piece types of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §5.3):
// `setpiece: true`, covered by the dragon campaign's generator, skipped by Starfall Vale's and
// Cinderwatch Pass's coverage (`isSetpieceType`)

/** `fire` kinds (`opts.kind`): a blaze on rubble or a roof edge, the festival's great bonfire, a stone brazier, glowing coals. */
export const FIRE_KINDS = ['blaze', 'bonfire', 'brazier', 'embers'];
/** `debris` kinds (`opts.kind`). */
export const DEBRIS_KINDS = ['rubble', 'cart', 'timbers', 'wall', 'tent', 'bones', 'barricade'];
/** `crag` kinds (`opts.kind`). */
export const CRAG_KINDS = ['spire', 'mesa', 'arch', 'pillar', 'boulders', 'hoodoo'];
/**
 * Stones of a `crag` and of a `rock` (`opts.stone`; a rock without one is the mossy grey of old);
 * `ice` is The Bells of Evermere's (./Owners.js), and so is the rock-only `snow` (`ROCK_STONES`).
 */
export const CRAG_STONES = ['sandstone', 'redrock', 'basalt', 'ice'];
/** Stones of a `rock` (`opts.stone`): every crag stone and the drifts of snow. */
export const ROCK_STONES = [...CRAG_STONES, 'snow'];
/** `belfry` kinds (`opts.kind`; EVERMERE_CAMPAIGN.md §5.3). */
export const BELFRY_KINDS = ['town', 'shrine', 'lighthouse', 'abbey', 'citadel', 'hush'];
/** `ship` kinds (`opts.kind`). */
export const SHIP_KINDS = ['cog', 'sloop', 'rowboat'];
/** `monument` kinds (`opts.kind`): a brazier's fire is `opts.fire`, a lantern's glow `opts.lit`. */
export const MONUMENT_KINDS = ['grave', 'statue', 'cairn', 'chime', 'brazier', 'lantern'];
/** A brazier monument's fire (`opts.fire`; absent: warm): a fire with warmth, a cold cyan fire, out. */
export const BRAZIER_FIRES = ['warm', 'cold', 'out'];
/** `smithy` kinds (`opts.kind`): the Halloway forge's furniture. */
export const SMITHY_KINDS = ['forge', 'anvil', 'bellows', 'mould', 'rack', 'bellblank'];
/** `garland` kinds (`opts.kind`): pennants, lanterns (glow at night) or both. */
export const GARLAND_KINDS = ['pennants', 'lanterns', 'both'];

/** @type {FieldDef} */
const ROT = { key: 'rotation', label: 'Rotation', type: 'angle', step: 15 };
/** @param {any[]} options @returns {FieldDef} */
const KIND = (options) => ({ key: 'opts.kind', label: 'Kind', type: 'select', options });
/** @type {FieldDef} */
const SEED = { key: 'opts.seed', label: 'Variation seed', type: 'int', min: 0, max: 9999 };
/** @type {FieldDef} */
const TEXT = { key: 'text', label: 'Text when examined', type: 'lines', i18n: true, help: 'One paragraph per dialog page. {word} is shown in gold.' };

/**
 * Checked with `satisfies`, not typed as a Record: each entry keeps its literal placement and the
 * shape of its defaults, from which ./types.d.ts derives the level object types (`LevelObject`,
 * `ObjectType`). A read with a plain string key (`OBJECT_TYPES[name]`) is untyped; with an
 * `ObjectType` it is the union of the entries, so declare the result as an `ObjectTypeDef` to
 * read the optional members (rotatable, snap, help, combat).
 * @satisfies {Record<string, ObjectTypeDef>}
 */
export const OBJECT_TYPES = {
  // ------------------------------------------------------------------ Buildings
  house: {
    label: 'House', category: 'Buildings', placement: 'point', kind: 'prop', glyph: '⌂', color: '#d9824b', radius: 2.2, rotatable: true, snap: 0.5,
    help: 'Windows glow at night, the chimney smokes. The door is interactive once “Text when knocking” is filled in.',
    defaults: { rotation: 0, name: '', light: false, text: [], opts: { width: 4, depth: 3, stories: 1, wall: 'timber_frame', upperWall: '', roof: 'roof_red', chimney: true, shutters: true, sign: false, doorHood: false, woodpile: false, gableFront: false, seed: 1 } },
    fields: [
      { key: 'name', label: 'Name', type: 'text' },
      ROT,
      { key: 'opts.width', label: 'Width', type: 'number', min: 3, max: 8, step: 0.5 },
      { key: 'opts.depth', label: 'Depth', type: 'number', min: 2.5, max: 6, step: 0.5 },
      { key: 'opts.stories', label: 'Stories', type: 'int', min: 1, max: 2 },
      { key: 'opts.wall', label: 'Walls', type: 'select', options: WALL_TEXTURES },
      { key: 'opts.upperWall', label: 'Upper walls', type: 'select', options: ['', ...WALL_TEXTURES] },
      { key: 'opts.roof', label: 'Roof', type: 'select', options: ROOF_TEXTURES },
      { key: 'opts.chimney', label: 'Chimney', type: 'bool' },
      { key: 'opts.shutters', label: 'Shutters', type: 'bool' },
      { key: 'opts.sign', label: 'Hanging sign', type: 'bool' },
      { key: 'opts.doorHood', label: 'Door hood', type: 'bool' },
      { key: 'opts.woodpile', label: 'Woodpile', type: 'bool' },
      { key: 'opts.gableFront', label: 'Gable faces front', type: 'bool' },
      // (the set-piece options of Vanquish the Evil Dragon, DRAGON_CAMPAIGN.md §5.3; no defaults:
      // absent from every file that does not use them)
      { key: 'opts.flatRoof', label: 'Flat roof (adobe)', type: 'bool', help: 'A flat adobe roof with a parapet and roof beams instead of the gable.' },
      { key: 'opts.ruin', label: 'Damage', type: 'int', min: 0, max: 2, help: '0 intact, 1 damaged (roof holes, cracked and charred walls), 2 gutted (roof mostly gone, a wall broken).' },
      { key: 'opts.burning', label: 'Burning', type: 'number', min: 0, max: 1, step: 0.05, help: 'Fire on the roof and in the windows, a dark smoke column, embers and a fire light (0 = none).' },
      // (The Bells of Evermere, EVERMERE_CAMPAIGN.md §5.3; no default)
      { key: 'opts.icicles', label: 'Icicles (while frozen)', type: 'bool' },
      { key: 'light', label: 'Door lantern casts light', type: 'bool', help: 'A real light while near the camera (the game shares 12 point lights among all lights).' },
      { ...TEXT, label: 'Text when knocking', help: 'One paragraph per dialog page. Blank = the door is not interactive. {word} is shown in gold.' },
      SEED,
    ],
  },
  windmill: {
    label: 'Windmill', category: 'Buildings', placement: 'point', kind: 'prop', glyph: '✢', color: '#e0c68e', radius: 1.8, rotatable: true,
    defaults: { rotation: 0, opts: { height: 6, roof: 'roof_thatch' } },
    fields: [ROT, { key: 'opts.height', label: 'Height', type: 'number', min: 4, max: 9, step: 0.2 }, { key: 'opts.roof', label: 'Roof', type: 'select', options: ROOF_TEXTURES }, SEED],
  },
  well: {
    label: 'Well', category: 'Buildings', placement: 'point', kind: 'prop', glyph: '◎', color: '#9aa0a8', radius: 1.0, rotatable: true,
    defaults: { rotation: 0, text: ['The well is deep and cold. You make a small wish.'], opts: { roof: 'wood_planks' } },
    fields: [ROT, { key: 'opts.roof', label: 'Roof', type: 'select', options: ['wood_planks', ...ROOF_TEXTURES] }, TEXT],
  },
  marketStall: {
    label: 'Market stall', category: 'Buildings', placement: 'point', kind: 'prop', glyph: '▤', color: '#d24b4b', radius: 1.6, rotatable: true, snap: 0.5,
    defaults: { rotation: 0, opts: { cloth: 'cloth_stripe', width: 3 } },
    fields: [
      ROT,
      { key: 'opts.cloth', label: 'Awning', type: 'select', options: CLOTH_TEXTURES },
      { key: 'opts.width', label: 'Width', type: 'number', min: 2, max: 4, step: 0.25 },
      { key: 'opts.crates', label: 'Side crates', type: 'select', options: [{ value: '', label: '(by seed)' }, 'left', 'right', 'none'] },
      SEED,
    ],
  },
  // ---- The Bells of Evermere's types (`owner`: covered by its generator only, ./Owners.js;
  // built by the season kit, src/engine/world/SeasonKit.js — EVERMERE_CAMPAIGN.md §5.3)
  belfry: {
    label: 'Belfry', category: 'Buildings', placement: 'point', kind: 'prop', owner: 'evermere', glyph: '♮', color: '#c9a45c', radius: 2,
    help: 'A bell tower; the story rings its bell (toll <id>).',
    defaults: { opts: { kind: 'town', height: 9, bell: 'bronze', lantern: false, seed: 1 } },
    fields: [
      KIND(BELFRY_KINDS),
      { key: 'opts.height', label: 'Height', type: 'number', min: 4, max: 24, step: 0.5 },
      { key: 'opts.bell', label: 'Bell', type: 'select', options: ['bronze', 'black'] },
      { key: 'opts.lantern', label: 'Lantern', type: 'bool' },
      SEED,
    ],
  },

  // ------------------------------------------------------------------ Nature
  tree: {
    label: 'Tree', category: 'Nature', placement: 'point', kind: 'prop', glyph: '♣', color: '#3f8f45', radius: 0.6,
    defaults: { collider: true, opts: { kind: 'oak', height: 4.5, seed: 1 } },
    fields: [
      { key: 'opts.kind', label: 'Kind', type: 'select', options: TREE_KINDS },
      { key: 'opts.height', label: 'Height', type: 'number', min: 2.5, max: 8, step: 0.1 },
      { key: 'collider', label: 'Blocks the player', type: 'bool' },
      // (no default: absent from every file that does not use it)
      { key: 'opts.charred', label: 'Charred', type: 'bool', help: 'Burnt black (dead wood, junipers).' },
      SEED,
    ],
  },
  rock: {
    label: 'Rock', category: 'Nature', placement: 'point', kind: 'prop', glyph: '●', color: '#8a8a92', radius: 0.5,
    defaults: { opts: { size: 1, seed: 1 } },
    fields: [
      { key: 'opts.size', label: 'Size', type: 'number', min: 0.3, max: 2.5, step: 0.05 },
      // (no default: absent from every file that does not use it)
      { key: 'opts.stone', label: 'Stone', type: 'select', options: [{ value: '', label: 'Mossy grey' }, { value: 'sandstone', label: 'Sandstone' }, { value: 'redrock', label: 'Red rock' }, { value: 'basalt', label: 'Basalt' }, { value: 'ice', label: 'Ice' }, { value: 'snow', label: 'Snow drift' }] },
      SEED,
    ],
  },
  haystack: {
    label: 'Haystack', category: 'Nature', placement: 'point', kind: 'prop', glyph: '▲', color: '#d8b453', radius: 0.9,
    defaults: { opts: { size: 1 } },
    fields: [{ key: 'opts.size', label: 'Size', type: 'number', min: 0.5, max: 1.6, step: 0.05 }, SEED],
  },
  crag: {
    label: 'Crag', category: 'Nature', placement: 'point', kind: 'prop', setpiece: true, glyph: '◭', color: '#c48a52', radius: 1.25, rotatable: true,
    help: 'A set-piece rock formation (Vanquish the Evil Dragon): a spire, mesa, arch, pillar, boulder pile or hoodoo of sandstone, red rock or basalt. Blocks the player and casts shadows.',
    defaults: { opts: { kind: 'spire', stone: 'sandstone', height: 6, width: 2.5, seed: 1 } },
    fields: [
      ROT,
      { key: 'opts.kind', label: 'Kind', type: 'select', options: [{ value: 'spire', label: 'Spire' }, { value: 'mesa', label: 'Mesa' }, { value: 'arch', label: 'Arch' }, { value: 'pillar', label: 'Pillar' }, { value: 'boulders', label: 'Boulders' }, { value: 'hoodoo', label: 'Hoodoo' }] },
      { key: 'opts.stone', label: 'Stone', type: 'select', options: [{ value: 'sandstone', label: 'Sandstone' }, { value: 'redrock', label: 'Red rock' }, { value: 'basalt', label: 'Basalt' }, { value: 'ice', label: 'Ice' }] },
      { key: 'opts.height', label: 'Height', type: 'number', min: 1, max: 24, step: 0.25 },
      { key: 'opts.width', label: 'Width', type: 'number', min: 0.8, max: 14, step: 0.1 },
      SEED,
    ],
  },

  // ------------------------------------------------------------------ Lights
  lamppost: {
    label: 'Lamppost', category: 'Lights', placement: 'point', kind: 'prop', glyph: '☀', color: '#ffc46b', radius: 0.3, rotatable: true,
    help: 'A street lantern; a real light while near the camera (the game shares 12 point lights).',
    defaults: { rotation: 0, opts: { style: 'arm' } },
    fields: [ROT, { key: 'opts.style', label: 'Style', type: 'select', options: ['arm', 'top'] }],
  },
  wallTorch: {
    label: 'Wall torch', category: 'Lights', placement: 'point', kind: 'prop', glyph: '♨', color: '#ff8a3d', radius: 0.25, rotatable: true,
    help: 'Mount against a wall: rotation points the flame away from the wall. Uses one point light.',
    defaults: { rotation: 0, dy: 2.1, opts: { embers: false } },
    fields: [ROT, { key: 'dy', label: 'Height above ground', type: 'number', min: 0.5, max: 4, step: 0.05 }, { key: 'opts.embers', label: 'Embers', type: 'bool' }],
  },
  campfire: {
    label: 'Campfire', category: 'Lights', placement: 'point', kind: 'prop', glyph: '✹', color: '#ff6a2a', radius: 0.8, rotatable: true,
    help: 'Fire, embers and smoke; burns day and night. Uses one point light.',
    defaults: { rotation: 0.8, opts: { seat: false } },
    fields: [ROT, { key: 'opts.seat', label: 'Log seats', type: 'bool' }],
  },
  light: {
    label: 'Point light', category: 'Lights', placement: 'point', kind: 'prop', glyph: '✦', color: '#ffe08a', radius: 0.25,
    help: 'An invisible light (e.g. a glow in a window); a real light while near the camera (the game shares 12 point lights).',
    defaults: { dy: 1.5, color: '#ffb46b', intensity: 8, distance: 8, flicker: 0.2, nightOnly: true },
    fields: [
      { key: 'dy', label: 'Height above ground', type: 'number', min: 0, max: 6, step: 0.1 },
      { key: 'color', label: 'Colour', type: 'color' },
      { key: 'intensity', label: 'Intensity', type: 'number', min: 0, max: 40, step: 0.5 },
      { key: 'distance', label: 'Range', type: 'number', min: 2, max: 20, step: 0.5 },
      { key: 'flicker', label: 'Flicker', type: 'number', min: 0, max: 1, step: 0.05 },
      { key: 'nightOnly', label: 'Only at night', type: 'bool' },
    ],
  },
  fire: {
    label: 'Fire', category: 'Lights', placement: 'point', kind: 'prop', setpiece: true, glyph: '✺', color: '#ff5a1f', radius: 0.8,
    help: 'A set-piece fire (Vanquish the Evil Dragon): a blaze on rubble or a roof edge, the festival bonfire (blocks the player), a stone brazier or glowing embers. Flames, smoke and embers; one point light, day and night (the game shares 12 point lights).',
    defaults: { opts: { kind: 'blaze', size: 1.5, smoke: true, light: true, seed: 1 } },
    fields: [
      { key: 'opts.kind', label: 'Kind', type: 'select', options: [{ value: 'blaze', label: 'Blaze' }, { value: 'bonfire', label: 'Bonfire' }, { value: 'brazier', label: 'Brazier' }, { value: 'embers', label: 'Embers' }] },
      { key: 'opts.size', label: 'Size', type: 'number', min: 0.3, max: 6, step: 0.1 },
      { key: 'opts.smoke', label: 'Smoke', type: 'bool' },
      { key: 'opts.light', label: 'Casts light', type: 'bool', help: 'A real light while near the camera (the game shares 12 point lights among all lights).' },
      SEED,
    ],
  },

  // ------------------------------------------------------------------ Props
  bench: {
    label: 'Bench', category: 'Props', placement: 'point', kind: 'prop', glyph: '▭', color: '#a0703f', radius: 0.9, rotatable: true,
    defaults: { rotation: 0, opts: { length: 1.8, back: true } },
    fields: [ROT, { key: 'opts.length', label: 'Length', type: 'number', min: 1, max: 3, step: 0.1 }, { key: 'opts.back', label: 'Backrest', type: 'bool' }],
  },
  barrel: {
    label: 'Barrel', category: 'Props', placement: 'point', kind: 'prop', glyph: '◍', color: '#8e5a2e', radius: 0.45, rotatable: true,
    defaults: { rotation: 0, opts: { height: 1.0, lying: false } },
    fields: [ROT, { key: 'opts.height', label: 'Height', type: 'number', min: 0.6, max: 1.4, step: 0.05 }, { key: 'opts.lying', label: 'Lying down', type: 'bool' }],
  },
  crate: {
    label: 'Crate', category: 'Props', placement: 'point', kind: 'prop', glyph: '■', color: '#b07b44', radius: 0.5, rotatable: true,
    defaults: { rotation: 0, opts: { size: 0.9 } },
    fields: [ROT, { key: 'opts.size', label: 'Size', type: 'number', min: 0.4, max: 1.4, step: 0.05 }],
  },
  crateStack: {
    label: 'Crate stack', category: 'Props', placement: 'point', kind: 'prop', glyph: '▦', color: '#b07b44', radius: 0.8, rotatable: true,
    defaults: { rotation: 0, opts: { count: 3, size: 0.85 } },
    fields: [ROT, { key: 'opts.count', label: 'Crates on the ground', type: 'int', min: 1, max: 4, help: 'One more crate sits on top (one or two from 3 on).' }, { key: 'opts.size', label: 'Crate size', type: 'number', min: 0.5, max: 1.2, step: 0.05 }, SEED],
  },
  flowerbox: {
    label: 'Flower box', category: 'Props', placement: 'point', kind: 'prop', glyph: '✿', color: '#e27aa8', radius: 0.6, rotatable: true,
    defaults: { rotation: 0, opts: { length: 1.2 } },
    fields: [ROT, { key: 'opts.length', label: 'Length', type: 'number', min: 0.6, max: 2.4, step: 0.1 }],
  },
  signpost: {
    label: 'Signpost', category: 'Props', placement: 'point', kind: 'prop', glyph: '⚑', color: '#c9a45c', radius: 0.3, rotatable: true,
    defaults: { rotation: 0, speaker: 'Signpost', text: ['↑ Somewhere nice'], opts: { boards: 2 } },
    fields: [ROT, { key: 'opts.boards', label: 'Boards', type: 'int', min: 1, max: 3 }, { key: 'speaker', label: 'Speaker', type: 'text', i18n: true }, { ...TEXT, label: 'Sign text' }],
  },
  debris: {
    label: 'Debris', category: 'Props', placement: 'point', kind: 'prop', setpiece: true, glyph: '▚', color: '#8a6a4a', radius: 0.8, rotatable: true,
    help: 'Set-piece wreckage (Vanquish the Evil Dragon): rubble, an overturned cart, fallen timbers, a broken wall stub, a torn awning, a dragon\'s bones (huge with Size) or a barricade.',
    defaults: { opts: { kind: 'rubble', size: 1, charred: false, seed: 1 } },
    fields: [
      ROT,
      { key: 'opts.kind', label: 'Kind', type: 'select', options: [{ value: 'rubble', label: 'Rubble' }, { value: 'cart', label: 'Overturned cart' }, { value: 'timbers', label: 'Fallen timbers' }, { value: 'wall', label: 'Broken wall' }, { value: 'tent', label: 'Torn awning' }, { value: 'bones', label: 'Bones' }, { value: 'barricade', label: 'Barricade' }] },
      { key: 'opts.size', label: 'Size', type: 'number', min: 0.3, max: 8, step: 0.1 },
      { key: 'opts.charred', label: 'Charred', type: 'bool' },
      SEED,
    ],
  },
  monument: {
    label: 'Monument', category: 'Props', placement: 'point', kind: 'prop', owner: 'evermere', glyph: '⊓', color: '#a8a8b4', radius: 0.6,
    help: 'A grave, statue, cairn, wayside chime, brazier or bell-lantern.',
    defaults: { opts: { kind: 'grave', seed: 1 } },
    fields: [
      KIND(MONUMENT_KINDS),
      // (no defaults: a brazier's fire — absent: warm —, a lantern's glow)
      { key: 'opts.fire', label: 'Fire (brazier)', type: 'select', options: BRAZIER_FIRES },
      { key: 'opts.lit', label: 'Lit (lantern)', type: 'bool' },
      SEED,
    ],
  },

  // ------------------------------------------------------------------ Interior (furniture of rooms)
  // `interior: true` (props/Furniture.js): (x, z) is the footprint's centre (a wall window: the wall
  // face); rotation 0 turns the front toward +Z (the camera) and a wall piece's back to the north.
  // Footprints: `interiorFootprint`. Covered by the interiors demo, not by Starfall Vale.
  bed: {
    label: 'Bed', category: 'Interior', placement: 'point', kind: 'prop', interior: true, glyph: '▬', color: '#d86a5a', radius: 1.1, rotatable: true, snap: 0.25,
    help: 'Head against a wall (local −Z; rotation 0: a north wall), the foot toward the room. Width 1.2 is a single bed, from 1.6 a double with two pillows.',
    defaults: { rotation: 0, opts: { width: 1.2, length: 2.2, blanket: 'red' } },
    fields: [
      ROT,
      { key: 'opts.width', label: 'Width', type: 'number', min: 0.8, max: 2.4, step: 0.1 },
      { key: 'opts.length', label: 'Length', type: 'number', min: 1.6, max: 2.8, step: 0.1 },
      { key: 'opts.blanket', label: 'Quilt', type: 'select', options: BLANKET_COLORS },
      SEED,
    ],
  },
  table: {
    label: 'Table', category: 'Interior', placement: 'point', kind: 'prop', interior: true, glyph: '◫', color: '#b98653', radius: 0.8, rotatable: true, snap: 0.25,
    help: 'Rect on four legs or round on a pedestal, 0.82 high, with seeded tableware. A candle adds a small flame (add a Point light for its glow).',
    defaults: { rotation: 0, opts: { shape: 'rect', width: 1.6, depth: 0.9, cloth: false, items: true, candle: false } },
    fields: [
      ROT,
      { key: 'opts.shape', label: 'Shape', type: 'select', options: ['rect', 'round'] },
      { key: 'opts.width', label: 'Width (round: diameter)', type: 'number', min: 0.6, max: 3.2, step: 0.1 },
      { key: 'opts.depth', label: 'Depth (rect)', type: 'number', min: 0.6, max: 2, step: 0.1 },
      { key: 'opts.cloth', label: 'Table cloth', type: 'bool' },
      { key: 'opts.items', label: 'Tableware', type: 'bool' },
      { key: 'opts.candle', label: 'Candle', type: 'bool' },
      SEED,
    ],
  },
  chair: {
    label: 'Chair', category: 'Interior', placement: 'point', kind: 'prop', interior: true, glyph: '◳', color: '#9a6840', radius: 0.3, rotatable: true, snap: 0.25,
    help: 'Rotation 0: the seat faces +Z (the camera), the back to the north. Turn it to face its table.',
    defaults: { rotation: 0, opts: { style: 'chair' } },
    fields: [ROT, { key: 'opts.style', label: 'Style', type: 'select', options: ['chair', 'stool'] }, SEED],
  },
  shelf: {
    label: 'Shelf', category: 'Interior', placement: 'point', kind: 'prop', interior: true, glyph: '▥', color: '#7c4f31', radius: 0.8, rotatable: true, snap: 0.25,
    help: 'An open shelf 0.5 deep, its back on a wall (rotation 0: a north wall): a bookshelf or a pantry of jars, bottles and sacks.',
    defaults: { rotation: 0, opts: { kind: 'books', width: 1.6, height: 2.2 } },
    fields: [
      ROT,
      { key: 'opts.kind', label: 'Holds', type: 'select', options: [{ value: 'books', label: 'Books' }, { value: 'pantry', label: 'Pantry stores' }] },
      { key: 'opts.width', label: 'Width', type: 'number', min: 0.8, max: 3.2, step: 0.1 },
      { key: 'opts.height', label: 'Height', type: 'number', min: 1, max: 3, step: 0.1 },
      SEED,
    ],
  },
  hearth: {
    label: 'Hearth', category: 'Interior', placement: 'point', kind: 'prop', interior: true, glyph: '◙', color: '#ff7a3a', radius: 1.1, rotatable: true, snap: 0.25,
    help: 'A stone fireplace 1 deep, its back on a wall (rotation 0: a north wall). Lit: a flame, glowing embers, sparks and one point light, day and night (the game shares 12 point lights).',
    defaults: { rotation: 0, opts: { width: 2.2, height: 2.6, lit: true, embers: true, pot: false } },
    fields: [
      ROT,
      { key: 'opts.width', label: 'Width', type: 'number', min: 1.6, max: 3.6, step: 0.1 },
      { key: 'opts.height', label: 'Chimney breast height', type: 'number', min: 1.8, max: 4.5, step: 0.1, help: 'Match the wall: the breast reaches up to it.' },
      { key: 'opts.lit', label: 'Fire burns', type: 'bool' },
      { key: 'opts.embers', label: 'Sparks', type: 'bool' },
      { key: 'opts.pot', label: 'Cooking pot', type: 'bool' },
      SEED,
    ],
  },
  counter: {
    label: 'Counter', category: 'Interior', placement: 'point', kind: 'prop', interior: true, glyph: '▰', color: '#a0703f', radius: 1.3, rotatable: true, snap: 0.25,
    help: 'An inn bar or a shop counter, 0.7 deep; rotation 0: the panelled front faces +Z (the customers, the camera), the keeper stands north of it.',
    defaults: { rotation: 0, opts: { style: 'bar', width: 2.6, items: true } },
    fields: [
      ROT,
      { key: 'opts.style', label: 'Style', type: 'select', options: [{ value: 'bar', label: 'Inn bar' }, { value: 'shop', label: 'Shop counter' }] },
      { key: 'opts.width', label: 'Width', type: 'number', min: 1.2, max: 6, step: 0.1 },
      { key: 'opts.items', label: 'Things on top', type: 'bool' },
      SEED,
    ],
  },
  rug: {
    label: 'Rug', category: 'Interior', placement: 'point', kind: 'prop', interior: true, glyph: '▧', color: '#bf4b45', radius: 1, rotatable: true, snap: 0.25,
    help: 'Flat on the floor: walked over, casts no shadow. Length runs along local Z (the tassel ends).',
    defaults: { rotation: 0, opts: { color: 'red', width: 2, length: 3 } },
    fields: [
      ROT,
      { key: 'opts.color', label: 'Colour', type: 'select', options: RUG_COLORS },
      { key: 'opts.width', label: 'Width', type: 'number', min: 1, max: 6, step: 0.25 },
      { key: 'opts.length', label: 'Length', type: 'number', min: 1, max: 8, step: 0.25 },
      SEED,
    ],
  },
  staircase: {
    label: 'Staircase', category: 'Interior', placement: 'point', kind: 'prop', interior: true, glyph: '◢', color: '#c49358', radius: 1.2, rotatable: true, snap: 0.25,
    help: 'Marks where a "use" exit leads up or down (it is not walkable). Up: a flight along a wall (rotation 0: a north wall), rising to the east (or the west). Down: a stairwell, its open end toward +Z. Put the exit at its foot.',
    defaults: { rotation: 0, opts: { dir: 'up', width: 1.2, steps: 7, height: 2.5, flip: false, rail: true } },
    fields: [
      ROT,
      { key: 'opts.dir', label: 'Leads', type: 'select', options: [{ value: 'up', label: 'Up (a flight on a wall)' }, { value: 'down', label: 'Down (a stairwell)' }] },
      { key: 'opts.width', label: 'Width', type: 'number', min: 0.8, max: 2.4, step: 0.1 },
      { key: 'opts.steps', label: 'Steps', type: 'int', min: 3, max: 14 },
      { key: 'opts.height', label: 'Height (up)', type: 'number', min: 1, max: 5, step: 0.1, help: 'The top step: match the wall height.' },
      { key: 'opts.flip', label: 'Rises to the west (up)', type: 'bool' },
      { key: 'opts.rail', label: 'Banister', type: 'bool' },
      SEED,
    ],
  },
  wardrobe: {
    label: 'Wardrobe', category: 'Interior', placement: 'point', kind: 'prop', interior: true, glyph: '▯', color: '#7d5230', radius: 0.7, rotatable: true, snap: 0.25,
    help: 'A tall wardrobe (0.6 deep) or a chest of drawers (0.5 deep), its back on a wall (rotation 0: a north wall).',
    defaults: { rotation: 0, opts: { kind: 'wardrobe', width: 1.4 } },
    fields: [
      ROT,
      { key: 'opts.kind', label: 'Kind', type: 'select', options: [{ value: 'wardrobe', label: 'Wardrobe' }, { value: 'drawers', label: 'Chest of drawers' }] },
      { key: 'opts.width', label: 'Width', type: 'number', min: 0.6, max: 2.6, step: 0.1 },
      SEED,
    ],
  },
  wallWindow: {
    label: 'Wall window', category: 'Interior', placement: 'point', kind: 'prop', interior: true, glyph: '⊞', color: '#bfe0f2', radius: 0.6, rotatable: true, snap: 0.25,
    help: 'Place it on a wall face; rotation points into the room (0: on a north wall). Its panes glow (emissive, no point light); by day a shaft of light falls onto the floor.',
    defaults: { rotation: 0, opts: { panes: 1, sill: 0.9, glow: 'daylight', curtains: 'red', beam: true } },
    fields: [
      ROT,
      { key: 'opts.panes', label: 'Casements (1 wide each)', type: 'int', min: 1, max: 3 },
      { key: 'opts.sill', label: 'Sill height', type: 'number', min: 0.3, max: 2, step: 0.05 },
      { key: 'opts.glow', label: 'Light', type: 'select', options: [{ value: 'daylight', label: 'Daylight (dark at night)' }, { value: 'warm', label: 'Warm (glows day and night)' }] },
      { key: 'opts.curtains', label: 'Curtains', type: 'select', options: ['red', 'linen', 'none'] },
      { key: 'opts.beam', label: 'Light shaft by day', type: 'bool' },
      { key: 'opts.flowers', label: 'Flower box on the sill', type: 'bool' },
    ],
  },
  sacks: {
    label: 'Grain sacks', category: 'Interior', placement: 'point', kind: 'prop', interior: true, glyph: '◓', color: '#bea573', radius: 0.7, rotatable: true, snap: 0.25,
    help: 'Tied burlap sacks: up to three standing in a row, the fourth lying across them.',
    defaults: { rotation: 0, opts: { count: 3 } },
    fields: [ROT, { key: 'opts.count', label: 'Sacks', type: 'int', min: 1, max: 4 }, SEED],
  },
  smithy: {
    label: 'Smithy', category: 'Interior', placement: 'point', kind: 'prop', interior: true, owner: 'evermere', glyph: '⚒', color: '#b0603a', radius: 0.8, rotatable: true, snap: 0.25,
    help: 'A bell-founder\'s forge, anvil, bellows, bell mould, tool rack or bell blank.',
    defaults: { rotation: 0, opts: { kind: 'forge', seed: 1 } },
    fields: [ROT, KIND(SMITHY_KINDS), SEED],
  },

  // ------------------------------------------------------------------ Structures (two-point)
  fence: {
    label: 'Fence', category: 'Structures', placement: 'line', kind: 'prop', glyph: '╪', color: '#8e6038', radius: 0.2,
    help: 'Click the start point, then the end point.',
    defaults: { opts: {} },
    fields: [],
  },
  bridge: {
    label: 'Bridge', category: 'Structures', placement: 'line', kind: 'prop', glyph: '═', color: '#a0703f', radius: 1,
    help: 'Click one bank, then the other. The deck is walkable over water.',
    defaults: { deckY: null, opts: { width: 2, arch: 0.25 } },
    fields: [
      { key: 'opts.width', label: 'Width', type: 'number', min: 1.2, max: 3.5, step: 0.1 },
      { key: 'opts.arch', label: 'Arch', type: 'number', min: 0, max: 0.6, step: 0.02 },
      { key: 'deckY', label: 'Deck height, world units (blank = auto)', type: 'number', min: -2, max: 20, step: 0.05, nullable: true, help: 'World height = height level × 0.5. Blank: the height of the banks.' },
    ],
  },
  garland: {
    label: 'Garland', category: 'Structures', placement: 'line', kind: 'prop', setpiece: true, glyph: '⌒', color: '#e05a5a', radius: 0.2,
    help: 'Click one end, then the other: a sagging line of pennants and / or lanterns at roof height (Vanquish the Evil Dragon\'s festival). Lanterns glow at night.',
    defaults: { opts: { kind: 'pennants', sag: 0.5, posts: true, seed: 1 } },
    fields: [
      { key: 'opts.kind', label: 'Kind', type: 'select', options: [{ value: 'pennants', label: 'Pennants' }, { value: 'lanterns', label: 'Lanterns' }, { value: 'both', label: 'Pennants and lanterns' }] },
      { key: 'opts.sag', label: 'Sag', type: 'number', min: 0, max: 2, step: 0.05 },
      { key: 'opts.posts', label: 'Posts at the ends', type: 'bool' },
      SEED,
    ],
  },

  // ------------------------------------------------------------------ Water
  waterfall: {
    label: 'Waterfall', category: 'Water', placement: 'point', kind: 'prop', glyph: '⇣', color: '#8fd3ff', radius: 1,
    help: 'Place on the edge between a higher and a lower water tile; `facing` is the direction the water falls toward.',
    defaults: { width: 2, facing: 'S' },
    fields: [
      { key: 'width', label: 'Width', type: 'number', min: 1, max: 6, step: 0.5 },
      { key: 'facing', label: 'Falls toward', type: 'select', options: CARDINALS },
    ],
  },
  ship: {
    label: 'Ship', category: 'Water', placement: 'point', kind: 'prop', owner: 'evermere', glyph: '⛵', color: '#8a6440', radius: 2, rotatable: true,
    help: 'A cog, sloop or rowboat; frozen: locked in the ice until the thaw. Its deck is walkable.',
    defaults: { rotation: 0, opts: { kind: 'cog', frozen: true, sails: 'furled', seed: 1 } },
    fields: [
      ROT,
      KIND(SHIP_KINDS),
      { key: 'opts.frozen', label: 'Frozen in', type: 'bool' },
      { key: 'opts.sails', label: 'Sails', type: 'select', options: ['furled', 'set'] },
      SEED,
    ],
  },

  // ------------------------------------------------------------------ Characters
  npc: {
    label: 'Villager (NPC)', category: 'Characters', placement: 'point', kind: 'actor', glyph: '☺', color: '#f2e2b5', radius: 0.35,
    help: 'A character who wanders near here and talks when the player presses Space.',
    defaults: { name: 'Villager', preset: 'villager', facing: 'down', wander: 1.2, speed: 1, portraitColor: '#c9a45c', action: 'none', item: '', behaviour: 'wander', script: '', dialogue: ['Hello, traveler!'] },
    fields: [
      // what a designer edits most comes first (the inspector shows fields in this order)
      { key: 'name', label: 'Name', type: 'text', i18n: true },
      { key: 'title', label: 'Title', type: 'text', i18n: true, help: 'The small title beside the name plate when this villager speaks (Warden of the Cinderwatch). Blank = none.' },
      { key: 'dialogue', label: 'Dialogue', type: 'dialogue', i18n: true, help: 'One page per paragraph. A page like "Question? [Yes | No]" offers choices (one choice: "[Okay |]"); \\[ \\] \\| are literal. {word} is gold.' },
      { key: 'action', label: 'Special action', type: 'select', options: NPC_ACTIONS, help: 'Rest / shop: picking any answer but the first of the closing question runs it (a closing page of your own with one choice, "[Okay |]": that answer runs it). Music: starts the music (a closing question of your own: any answer but the first plays it — with one choice, that one; when the music is already playing, the built-in question offers to stop it).' },
      { key: 'item', label: 'Item sold (shop action)', type: 'text', i18n: true, help: 'Blank = "Crisp Apple".' },
      { key: 'preset', label: 'Look', type: 'select', options: CHARACTER_PRESET_NAMES },
      { key: 'facing', label: 'Facing', type: 'select', options: FACINGS },
      { key: 'behaviour', label: 'Behaviour', type: 'select', options: NPC_BEHAVIOURS },
      { key: 'wander', label: 'Wander radius', type: 'number', min: 0, max: 5, step: 0.1 },
      { key: 'speed', label: 'Walk speed', type: 'number', min: 0.3, max: 2, step: 0.05 },
      { key: 'portraitColor', label: 'Name plate colour', type: 'color' },
      { key: 'script', label: 'Built-in script (overrides dialogue)', type: 'select', options: NPC_SCRIPTS },
      { key: 'talk', label: 'Talk script (overrides all of the above)', type: 'script', i18n: true, help: 'What this villager says and does, in the story language (docs/specs/STORY_SCRIPT.md). Blank = the dialogue above, or the actor\'s talk script.' },
      { key: 'actor', label: 'Actor (story character)', type: 'text', help: 'The character this villager is across levels: name, look and talk script from the campaign\'s story files, one visit count. Blank = this villager only.' },
      { key: 'flag', label: 'Story: sets flag after talking', type: 'text', help: 'The story flag set when a conversation with this villager ends. Blank = none.' },
    ],
  },
  critters: {
    label: 'Critters', category: 'Characters', placement: 'point', kind: 'actor', glyph: '🐾', color: '#f0a060', radius: 0.4,
    defaults: { kind: 'chicken', count: 4, radius: 2.5 },
    fields: [
      { key: 'kind', label: 'Kind', type: 'select', options: CRITTER_KINDS },
      { key: 'count', label: 'Count', type: 'int', min: 1, max: 8 },
      { key: 'radius', label: 'Roam radius', type: 'number', min: 0.5, max: 8, step: 0.1 },
    ],
  },

  // ------------------------------------------------------------------ Markers
  emitter: {
    label: 'Particle area', category: 'Markers', placement: 'point', kind: 'marker', glyph: '∴', color: '#b8f07a', radius: 0.5,
    help: 'Fireflies (night only), falling leaves, petals, dust… inside a box centred here.',
    defaults: { preset: 'fireflies', size: [8, 2.4, 8], count: 30, dy: 1.2 },
    fields: [
      { key: 'preset', label: 'Effect', type: 'select', options: EMITTER_PRESETS },
      { key: 'size.0', label: 'Size X', type: 'number', min: 0.5, max: 40, step: 0.5 },
      { key: 'size.1', label: 'Size Y', type: 'number', min: 0.5, max: 12, step: 0.1 },
      { key: 'size.2', label: 'Size Z', type: 'number', min: 0.5, max: 40, step: 0.5 },
      { key: 'dy', label: 'Height above ground', type: 'number', min: 0, max: 10, step: 0.1 },
      { key: 'count', label: 'Particles', type: 'int', min: 1, max: 200 },
    ],
  },
  region: {
    label: 'Region name', category: 'Markers', placement: 'rect', kind: 'marker', glyph: '▢', color: '#c9a45c', radius: 0,
    help: 'Drag a rectangle. The HUD shows its name while the player is inside (first match wins).',
    defaults: { name: 'New area', sub: '', minY: null, banner: '' },
    fields: [
      { key: 'name', label: 'Name', type: 'text', i18n: true },
      { key: 'sub', label: 'Subtitle', type: 'text', i18n: true },
      { key: 'minY', label: 'Only above height, world units (blank = any)', type: 'number', min: -5, max: 20, step: 0.1, nullable: true, help: 'World height = height level × 0.5 (3 = level 6).' },
      { key: 'banner', label: 'Arrival banner subtitle (blank = none)', type: 'text', i18n: true, help: 'Shown with the region name the first time the player enters.' },
    ],
  },
  // campaigns (docs/specs/CAMPAIGN_FORMAT.md): a level played on its own ignores both
  exit: {
    label: 'Exit (to another level)', category: 'Markers', placement: 'rect', kind: 'marker', campaign: true,
    glyph: '⇨', color: '#7fd6a8', radius: 0,
    help: 'Drag a rectangle where the player leaves for another level of the campaign: walking into it travels (or Space, for a door). A level played on its own ignores it.',
    defaults: { to: '', entrance: '', mode: 'walk', label: 'Enter', requires: '', locked: [] },
    fields: [
      { key: 'to', label: 'Leads to level', type: 'text', help: 'The level\'s file name in the campaign\'s levels/ folder, without ".json".' },
      { key: 'entrance', label: 'Arrive at entrance', type: 'text', help: 'An entrance\'s name in that level. Blank: across the seam when campaign.json places both levels, else at its player start.' },
      { key: 'mode', label: 'Travel', type: 'select', options: EXIT_MODES },
      { key: 'label', label: 'Prompt (Space exits)', type: 'text', i18n: true, help: 'The verb shown over an exit used with Space ("Enter", "Climb down").' },
      { key: 'requires', label: 'Open only with story flag', type: 'text', help: 'Blank = always open.' },
      { key: 'locked', label: 'Text while closed', type: 'lines', i18n: true, help: 'Shown when the flag is missing; one paragraph per dialog page (blank: "The way is closed.").' },
    ],
  },
  entrance: {
    label: 'Entrance (arrival point)', category: 'Markers', placement: 'point', kind: 'marker', campaign: true,
    glyph: '⊙', color: '#7fd6a8', radius: 0.4,
    help: 'Where the player arrives through an exit of another level that names it. A level played on its own ignores it.',
    defaults: { name: '', facing: 'down' },
    fields: [
      { key: 'name', label: 'Name', type: 'text', help: 'What exits in other levels call it (blank: its id).' },
      { key: 'facing', label: 'Facing on arrival', type: 'select', options: FACINGS },
    ],
  },

  // story (docs/specs/STORY_SCRIPT.md): what happens, and named spots for the staging commands
  event: {
    label: 'Story event', category: 'Markers', placement: 'rect', kind: 'marker', story: true,
    glyph: '!', color: '#e8c25a', radius: 0,
    help: 'Drag a rectangle: its script runs when the trigger fires (Space inside it, walking in, arriving in the level, a condition becoming true…).',
    defaults: { on: 'use', once: false, run: [] },
    fields: [
      { key: 'on', label: 'Runs when', type: 'select', options: EVENT_TRIGGERS },
      { key: 'label', label: 'Prompt (Space)', type: 'text', i18n: true, help: 'The verb shown over a Space event ("Look", "Read", "Search"). Blank = "Look".' },
      { key: 'if', label: 'Condition', type: 'condition', help: 'The event runs only while this holds; for "Its condition becomes true", the condition to watch. Blank = always.' },
      { key: 'once', label: 'Only once', type: 'bool', help: 'Remembered in the save: it never runs again.' },
      // (no default: absent from every file that does not use it)
      { key: 'background', label: 'Runs in the background', type: 'bool', help: 'The script plays while the player keeps walking: it holds no one and opens no dialog window. Only lines that need no answer and move no one but villagers — bark, emote, villagers\' walk / face / teleport / home, wait, set, give, quest, toast, sfx … (no dialogue or choice: use bark). "Check for problems" lists the others.' },
      { key: 'at', label: 'At hour (clock)', type: 'number', min: 0, max: 24, step: 0.25, nullable: true },
      { key: 'group', label: 'Group (enemy id)', type: 'text', help: 'The enemy group object whose last foe ends the fight.' },
      { key: 'run', label: 'Script', type: 'script', i18n: true, help: 'What happens (docs/specs/STORY_SCRIPT.md).' },
    ],
  },
  marker: {
    label: 'Story marker (named spot)', category: 'Markers', placement: 'point', kind: 'marker', story: true,
    glyph: '✦', color: '#e8c25a', radius: 0.35,
    help: 'A named spot the story scripts walk actors to, put them at or look at ("walk ilse well-side"). Invisible in the game.',
    defaults: { name: '', facing: 'down' },
    fields: [
      { key: 'name', label: 'Name', type: 'text', help: 'What scripts call it (blank: its id).' },
      { key: 'facing', label: 'Facing', type: 'select', options: FACINGS, help: 'How an actor put here faces.' },
    ],
  },

  // ------------------------------------------------------------------ Combat (COMBAT.md §14)
  // Optional `enemy` fields, never in `defaults` and all relative to x / z: spotOffsets [[dx, dz], …],
  // area { minX, maxX, minZ, maxZ }, seed (int), arena { minX, maxX, minZ, maxZ } and
  // gate [dx0, dz0, dx1, dz1] (both required for a boss: golem, dragon); and the set-piece fields
  // of Vanquish the Evil Dragon (DRAGON_CAMPAIGN.md §5.3) — besiege [x, z] or [x, z, r] (world
  // coordinates: the point the idle group attacks; no inspector field) and swarm (bool).
  enemy: {
    label: 'Enemy group', category: 'Combat', placement: 'point', kind: 'actor', combat: true,
    glyph: '⚔', color: '#e0674f', radius: 0.45,
    help: 'A group of hostile creatures that turns combat on for the level. The boss (Cinderheart) needs an arena and a gate.',
    defaults: { kind: 'slime', count: 3, radius: 3, level: 1, elite: false, name: '' },
    fields: [
      { key: 'kind', label: 'Kind', type: 'select', options: ENEMY_KINDS.map((k) => ({ value: k, label: ENEMY_INFO[k].label })) },
      { key: 'count', label: 'Count', type: 'int', min: 1, max: 8 },
      { key: 'radius', label: 'Home radius', type: 'number', min: 0.5, max: 12, step: 0.1 },
      { key: 'level', label: 'Level', type: 'int', min: 1, max: 10 },
      { key: 'elite', label: 'Elite', type: 'bool' },
      { key: 'name', label: 'Name plate (optional)', type: 'text', i18n: true },
      // (no default: absent from every file that does not use it)
      { key: 'swarm', label: 'Swarm (rushes the party)', type: 'bool', help: 'On appearing (or at load when present) the whole group wakes and rushes the party: no leash, no home zone, aggro at any distance.' },
    ],
  },
  chest: {
    label: 'Treasure chest', category: 'Combat', placement: 'point', kind: 'prop', combat: true,
    glyph: '▣', color: '#e8cf8a', radius: 0.5, rotatable: true,
    help: 'Opened with Space on a combat level; its contents pop out as pickups. On a peaceful level it is only examined.',
    defaults: { rotation: 0, gold: 20, potions: 0, upgrade: 'none' },
    fields: [ROT,
      { key: 'gold', label: 'Gold', type: 'int', min: 0, max: 500 },
      { key: 'potions', label: 'Healing Draughts', type: 'int', min: 0, max: 5 },
      { key: 'upgrade', label: 'Upgrade', type: 'select', options: CHEST_UPGRADES.map((v) => ({ value: v, label: CHEST_UPGRADE_LABELS[v] ?? v })) }],
  },
  waystone: {
    label: 'Waystone (checkpoint)', category: 'Combat', placement: 'point', kind: 'prop', combat: true,
    glyph: '◆', color: '#7fe3ff', radius: 0.6,
    help: 'Walk close to attune (respawn point); Space to rest (heal, enemies return).',
    defaults: { name: 'Waystone' },
    fields: [{ key: 'name', label: 'Name', type: 'text', i18n: true }],
  },
  // a set-piece of Vanquish the Evil Dragon (DRAGON_CAMPAIGN.md §5.3, §6.5): no geometry — the
  // combat system flies it (src/game/combat/SkyDragon.js); its fields are top-level, not opts
  skyDragon: {
    label: 'Sky dragon (shadow)', category: 'Combat', placement: 'rect', kind: 'actor', combat: true, setpiece: true,
    glyph: '❂', color: '#c0392b', radius: 0,
    help: 'Drag a rectangle: a dragon\'s shadow flies over it and hurls telegraphed fireballs every few seconds; it cannot be attacked. When the story removes it, it flies off toward "Leaves toward".',
    defaults: { interval: [5, 9], volley: 2, radius: 2.4, power: 1.6, leave: 'N', ambient: true },
    fields: [
      { key: 'interval.0', label: 'Volley every (s), least', type: 'number', min: 1, max: 60, step: 0.5 },
      { key: 'interval.1', label: 'Volley every (s), most', type: 'number', min: 1, max: 60, step: 0.5 },
      { key: 'volley', label: 'Fireballs per volley', type: 'int', min: 0, max: 10 },
      { key: 'radius', label: 'Fireball radius', type: 'number', min: 0.5, max: 6, step: 0.1 },
      { key: 'power', label: 'Fireball power', type: 'number', min: 0, max: 6, step: 0.1 },
      { key: 'leave', label: 'Leaves toward', type: 'select', options: CARDINALS },
      { key: 'ambient', label: 'Flies in cutscenes (harmless)', type: 'bool', help: 'While a story scene holds the player, it keeps flying and its fireballs fall without hurting anyone.' },
    ],
  },
};

// every type's inspector ends with the story conditions (STORY_FIELDS)
for (const def of /** @type {ObjectTypeDef[]} */ (Object.values(OBJECT_TYPES))) def.fields.push(...STORY_FIELDS);

/** The player spawn is stored in `level.spawn`, not in `objects`; editors show it as a marker. */
export const SPAWN_MARKER = { label: 'Player start', glyph: '★', color: '#7fe3ff', radius: 0.35 };

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/**
 * Read a dotted-path field ('opts.width', 'size.0').
 * @param {object} obj a level object (or any plain object)
 * @param {string} key dotted path (`FieldDef.key`)
 * @returns {any} undefined when a step of the path is missing
 */
export function getField(obj, key) {
  let v = obj;
  for (const k of key.split('.')) {
    if (v == null) return undefined;
    v = v[k];
  }
  return v;
}

/**
 * Write a dotted-path field, creating intermediate objects (an array when the next step is an
 * index). Returns obj.
 * @template {object} T
 * @param {T} obj
 * @param {string} key dotted path (`FieldDef.key`)
 * @param {any} value
 * @returns {T}
 */
export function setField(obj, key, value) {
  const parts = key.split('.');
  let v = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (v[k] == null || typeof v[k] !== 'object') v[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    v = v[k];
  }
  v[parts[parts.length - 1]] = value;
  return obj;
}

/**
 * New object of `type` at (x, z) with catalog defaults (id left empty — use
 * LevelFormat.addObject / generateObjectId to assign one).
 * For 'line' types (x, z) is the start and the end defaults to 2 units east; for 'rect' types
 * a 4×4 rectangle centred on (x, z). `overrides` are deep-merged over the defaults (arrays
 * replace). Throws for an unknown type.
 * @template {ObjectType} T
 * @param {T} type
 * @param {number} x
 * @param {number} z
 * @param {ObjectOverrides<T>} [overrides]
 * @returns {LevelObjectOf<T>}
 */
export function createObject(type, x, z, overrides = {}) {
  if (!isOwnKey(OBJECT_TYPES, type)) throw new Error(`Unknown object type "${showValue(type)}"`);
  const def = OBJECT_TYPES[type];
  // canonical key order (id, type, position, then the defaults) — the order files are written in,
  // so a saved level re-serialises byte-identically after a reload (normalizeObject keeps it)
  const obj = { id: '', type };
  if (def.placement === 'point') Object.assign(obj, { x, z });
  else if (def.placement === 'line') Object.assign(obj, { x0: x, z0: z, x1: x + 2, z1: z });
  else Object.assign(obj, { minX: x - 2, maxX: x + 2, minZ: z - 2, maxZ: z + 2 });
  Object.assign(obj, clone(def.defaults));
  return deepMerge(obj, clone(overrides));
}

/**
 * Fill in missing defaults / coerce types of a (possibly hand-edited) object. The object's own
 * keys keep their order (defaults it lacks are appended), so load → save is byte-stable. Legacy
 * absolute NPC / critter fields (`talkPoint`, `bounds`, `spots`) become their relative forms
 * (`talkOffset`, `area`, `spotOffsets` — the game reads both), so they move with the object in
 * the editor. `o.type` must be a catalog type (normalizeLevel and the editor's paste drop the
 * others first); throws for any other type. A value String() cannot convert (a JSON object with an
 * own `toString` key), at any depth, is dropped first — a key's default then fills it, an array
 * element becomes null (`stripUnconvertible`, KNOWN_ISSUES LVL-18) — so no reader of the object
 * (a name in the Outliner, a texture name, a talk) can throw on it later; every other value is
 * kept as it is.
 * Its content-text keys (`textKeys`, docs/specs/I18N.md §4.2) keep only well-formed keys of the
 * type's translatable fields, bounded by those fields (a key of a field the object does not hold is
 * dropped, a key list is cut to its field's length); `report.textKeys` counts what was dropped,
 * `report.upcased` the keys of lower-case digits written in upper case.
 * @param {{ type: ObjectType, [key: string]: any }} o raw object (not modified: the result is a copy)
 * @param {{ textKeys: number, upcased: number }} [report] counted into (normalizeLevel warns)
 * @returns {LevelObject}
 */
export function normalizeObject(o, report) {
  if (!o || !isOwnKey(OBJECT_TYPES, o.type)) throw new Error(`Unknown object type "${showValue(o?.type)}"`);
  const def = OBJECT_TYPES[o.type];
  const out = fillDefaults(stripUnconvertible(clone(o)), clone(def.defaults) ?? {});
  // (toNumber / toText: a value Number() / String() cannot convert — a JSON object with an own
  // `toString` key — is not a number / gives '', i.e. normalizeLevel renames the object)
  const num = (k, d = 0) => { out[k] = Number.isFinite(toNumber(out[k])) ? toNumber(out[k]) : d; };
  if (def.placement === 'point') { num('x'); num('z'); }
  if (def.placement === 'line') { num('x0'); num('z0'); num('x1', out.x0 + 2); num('z1', out.z0); }
  if (def.placement === 'rect') {
    num('minX'); num('maxX', out.minX + 4); num('minZ'); num('maxZ', out.minZ + 4);
    if (out.maxX < out.minX) [out.minX, out.maxX] = [out.maxX, out.minX];
    if (out.maxZ < out.minZ) [out.minZ, out.maxZ] = [out.maxZ, out.minZ];
  }
  if ('rotation' in def.defaults || out.rotation != null) num('rotation');
  out.id = toText(out.id ?? '', '');
  if (def.placement === 'point' && (o.type === 'npc' || o.type === 'critters')) relativizeLegacy(out);
  // the content-text keys (docs/specs/I18N.md §4.2): only well-formed keys of this type's
  // translatable fields, bounded by the fields the object holds, are kept in place; nothing left,
  // no field (counted into `report`: normalizeLevel warns)
  if (Object.prototype.hasOwnProperty.call(out, 'textKeys')) {
    const { keys, dropped, upcased } = cleanTextKeysOf(o.type, out.textKeys, out);
    if (keys) out.textKeys = keys;
    else delete out.textKeys;
    if (report) { report.textKeys += dropped; report.upcased += upcased; }
  }
  return out;
}

const r6 = (v) => Math.round(v * 1e6) / 1e6;
const isPt = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const isRectLike = (r) => !!r && typeof r === 'object' && ['minX', 'maxX', 'minZ', 'maxZ'].every((k) => Number.isFinite(r[k]));

/** talkPoint / bounds / spots (absolute world coordinates) → talkOffset / area / spotOffsets. */
function relativizeLegacy(o) {
  const { x, z } = o;
  if (isPt(o.talkPoint)) {
    if (!isPt(o.talkOffset)) o.talkOffset = [r6(o.talkPoint[0] - x), r6(o.talkPoint[1] - z)];
    delete o.talkPoint;
  }
  if (isRectLike(o.bounds)) {
    if (!isRectLike(o.area)) o.area = { minX: r6(o.bounds.minX - x), maxX: r6(o.bounds.maxX - x), minZ: r6(o.bounds.minZ - z), maxZ: r6(o.bounds.maxZ - z) };
    delete o.bounds;
  }
  if (Array.isArray(o.spots)) {
    if (!Array.isArray(o.spotOffsets)) o.spotOffsets = o.spots.filter(isPt).map((p) => [r6(p[0] - x), r6(p[1] - z)]);
    delete o.spots;
  }
}

/** Add the keys of `defaults` that `target` lacks (recursing into plain objects); `target` wins. */
function fillDefaults(target, defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in target) || target[k] === undefined) target[k] = v;
    else if (isPlain(v) && isPlain(target[k])) fillDefaults(target[k], v);
  }
  return target;
}

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function deepMerge(target, src) {
  if (!src || typeof src !== 'object') return target;
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

/**
 * Representative world position of an object (point, line midpoint or rect centre).
 * @param {LevelObject} obj
 * @returns {{ x: number, z: number }}
 */
export function objectCenter(obj) {
  const def = OBJECT_TYPES[obj.type];
  if (def.placement === 'line') return { x: (obj.x0 + obj.x1) / 2, z: (obj.z0 + obj.z1) / 2 };
  if (def.placement === 'rect') return { x: (obj.minX + obj.maxX) / 2, z: (obj.minZ + obj.maxZ) / 2 };
  return { x: obj.x, z: obj.z };
}

/**
 * Approximate world-space XZ bounds of an object, for picking, selection outlines and 2D map
 * drawing. Houses / stalls use their width × depth rotated; lines are padded by half their width.
 * @param {LevelObject} obj
 * @returns {Rect}
 */
export function objectBounds(obj) {
  const def = OBJECT_TYPES[obj.type];
  if (def.placement === 'rect') return { minX: obj.minX, maxX: obj.maxX, minZ: obj.minZ, maxZ: obj.maxZ };
  if (def.placement === 'line') {
    const pad = obj.type === 'bridge' ? (obj.opts?.width ?? 2) / 2 : 0.2;
    return { minX: Math.min(obj.x0, obj.x1) - pad, maxX: Math.max(obj.x0, obj.x1) + pad, minZ: Math.min(obj.z0, obj.z1) - pad, maxZ: Math.max(obj.z0, obj.z1) + pad };
  }
  if (/** @type {ObjectTypeDef} */ (def).interior && def.placement === 'point') {
    const r = interiorFootprint(obj);
    if (r) {
      const rot = r.round ? 0 : obj.rotation ?? 0;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const [lx, lz] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]]) {
        const wx = obj.x + lx * c + lz * s;
        const wz = obj.z - lx * s + lz * c;
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
        minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
      }
      return { minX, maxX, minZ, maxZ };
    }
  }
  let hw = def.radius;
  let hd = def.radius;
  if (obj.type === 'house') { hw = (obj.opts?.width ?? 4) / 2 + 0.35; hd = (obj.opts?.depth ?? 3) / 2 + 0.35; }
  else if (obj.type === 'marketStall') { hw = (obj.opts?.width ?? 3) / 2 + 0.2; hd = 0.9; }
  else if (obj.type === 'bench') { hw = (obj.opts?.length ?? 1.8) / 2; hd = 0.35; }
  else if (obj.type === 'flowerbox') { hw = (obj.opts?.length ?? 1.2) / 2; hd = 0.25; }
  else if (obj.type === 'waterfall') { hw = (obj.width ?? 2) / 2; hd = 0.3; }
  else if (obj.type === 'emitter') { hw = (obj.size?.[0] ?? 8) / 2; hd = (obj.size?.[2] ?? 8) / 2; }
  else if (obj.type === 'critters') { hw = hd = obj.radius ?? 2.5; }
  else if (obj.type === 'enemy') { hw = hd = obj.radius ?? 3; }
  else if (obj.type === 'crag') { hw = hd = optNum(obj.opts?.width, 2.5, 0.8, 14) / 2; }
  else if (obj.type === 'fire') { hw = hd = Math.max(0.3, optNum(obj.opts?.size, 1.5, 0.3, 6) * 0.5); }
  else if (obj.type === 'debris') { hw = hd = Math.max(0.3, optNum(obj.opts?.size, 1, 0.3, 8) * 0.8); }
  const rot = obj.type === 'waterfall' ? (obj.facing === 'E' || obj.facing === 'W' ? Math.PI / 2 : 0) : (obj.rotation ?? 0);
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  const ex = hw * c + hd * s;
  const ez = hw * s + hd * c;
  return { minX: obj.x - ex, maxX: obj.x + ex, minZ: obj.z - ez, maxZ: obj.z + ez };
}

/**
 * Does world point (x, z) hit the object (for picking)? Uses the bounds, or the radius for small
 * point objects, or the distance to the segment for line objects.
 * @param {LevelObject} obj
 * @param {number} x
 * @param {number} z
 * @param {number} [tolerance] extra reach in world units (0.25)
 * @returns {boolean}
 */
export function hitTestObject(obj, x, z, tolerance = 0.25) {
  const def = OBJECT_TYPES[obj.type];
  if (def.placement === 'line') {
    const dx = obj.x1 - obj.x0;
    const dz = obj.z1 - obj.z0;
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - obj.x0) * dx + (z - obj.z0) * dz) / L2));
    const px = obj.x0 + dx * t - x;
    const pz = obj.z0 + dz * t - z;
    const half = obj.type === 'bridge' ? (obj.opts?.width ?? 2) / 2 : 0.3;
    return Math.hypot(px, pz) <= half + tolerance;
  }
  const b = objectBounds(obj);
  return x >= b.minX - tolerance && x <= b.maxX + tolerance && z >= b.minZ - tolerance && z <= b.maxZ + tolerance;
}

/**
 * Parse editor dialogue text into the level `dialogue` array, and back. Pages are separated by
 * blank lines; a page ending in a bracket group with a "|" is a choice page:
 * "Question? [Yes | No]" (one choice: "Question? [Yes |]"). `\[`, `\]`, `\|` and `\\` are literal
 * characters, so any page survives text → parse → text unchanged.
 * @param {string} text
 * @returns {DialoguePage[]}
 */
export function parseDialogueText(text) {
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(parseDialoguePage);
}

const escapeDialogue = (s) => String(s).replace(/[\\[\]|]/g, '\\$&');
const unescapeDialogue = (s) => String(s).replace(/\\([\\[\]|])/g, '$1');

/** One page of dialogue text → a string or a { text, choices } page. */
function parseDialoguePage(p) {
  // the last unescaped '[' whose group closes with the page's last character
  let open = -1;
  let close = -1;
  for (let k = 0; k < p.length; k++) {
    const c = p[k];
    if (c === '\\') { k++; continue; }
    if (c === '[') { open = k; close = -1; } else if (c === ']' && open >= 0) close = k;
  }
  if (open >= 0 && close === p.length - 1) {
    const inner = p.slice(open + 1, close);
    const parts = [];
    let cur = '';
    let bar = false;
    for (let k = 0; k < inner.length; k++) {
      const c = inner[k];
      if (c === '\\' && k + 1 < inner.length) { cur += c + inner[k + 1]; k++; continue; }
      if (c === '|') { parts.push(cur); cur = ''; bar = true; continue; }
      cur += c;
    }
    parts.push(cur);
    const choices = parts.map((c) => unescapeDialogue(c.trim())).filter(Boolean);
    // a group without '|' is plain text in brackets
    if (bar && choices.length) return { text: unescapeDialogue(p.slice(0, open).trim()), choices };
  }
  return unescapeDialogue(p);
}

/**
 * Editor text of one dialogue page. Blank choices are left out (the parser and the game drop them
 * too); a single choice keeps the trailing "|" ("Question? [Okay |]") so it parses back as a
 * choice page rather than as plain text in brackets.
 */
function dialoguePageText(d) {
  if (typeof d === 'string') return escapeDialogue(d);
  if (!d || typeof d !== 'object') return '';
  const choices = (Array.isArray(d.choices) ? d.choices : []).map(String).filter((c) => c.trim()).map((c) => escapeDialogue(c));
  const text = escapeDialogue(d.text ?? '');
  if (!choices.length) return text;
  return `${text} [${choices.length === 1 ? `${choices[0]} |` : choices.join(' | ')}]`;
}

/**
 * Editor text of an NPC's `dialogue` (a single page is taken as a one-page list).
 * @param {DialoguePage[]|DialoguePage} [dialogue]
 * @returns {string}
 */
export function dialogueToText(dialogue = []) {
  return (Array.isArray(dialogue) ? dialogue : [dialogue]).map(dialoguePageText).join('\n\n');
}

/**
 * Apply an edit of a page list's text to the original pages: pages whose text the edit did not
 * touch are kept exactly as they were (extra keys, blank lines, padding…); only the edited ones
 * are parsed again.
 * @param {any[]} pages the original pages
 * @param {string} text the edited text
 * @param {(page:any) => string} pageText page → its text (the list is `join('\n\n')`)
 * @param {(text:string) => any[]} parse text → pages
 */
export function mergePagesText(pages, text, pageText, parse) {
  const orig = Array.isArray(pages) ? pages : [];
  const blocks = orig.map(pageText);
  const old = blocks.join('\n\n');
  const next = String(text);
  if (next === old) return orig.map((p) => clone(p));
  // unchanged prefix / suffix of the text
  let p = 0;
  const maxP = Math.min(old.length, next.length);
  while (p < maxP && old[p] === next[p]) p++;
  let s = 0;
  const maxS = Math.min(old.length, next.length) - p;
  while (s < maxS && old[old.length - 1 - s] === next[next.length - 1 - s]) s++;
  const changedEnd = old.length - s; // [p, changedEnd) changed in the old text
  // page k spans [start_k, end_k) in the old text. A page is kept when its text is outside the
  // changed range and the new text still separates it from its neighbours by a blank line.
  const starts = [];
  let at = 0;
  for (const b of blocks) { starts.push(at); at += b.length + 2; }
  let keepHead = 0;
  let m0 = 0; // where the re-parsed middle starts in the new text
  while (keepHead < blocks.length) {
    const end = starts[keepHead] + blocks[keepHead].length;
    if (end > p || starts[keepHead] !== m0) break;
    if (end === next.length) { m0 = end; keepHead++; break; }
    const sep = /^\n\s*\n/.exec(next.slice(end, end + 64));
    if (!sep) break;
    m0 = end + sep[0].length;
    keepHead++;
  }
  let keepTail = 0;
  let m1 = next.length; // where the re-parsed middle ends in the new text
  while (keepTail < blocks.length - keepHead) {
    const k = blocks.length - 1 - keepTail;
    if (starts[k] < changedEnd) break;
    const pos = next.length - (old.length - starts[k]);
    if (pos < m0 || pos + blocks[k].length !== m1) break;
    if (pos === m0) { m1 = pos; keepTail++; break; }
    const sep = /\n\s*\n$/.exec(next.slice(Math.max(m0, pos - 64), pos));
    if (!sep) break;
    m1 = pos - sep[0].length;
    keepTail++;
  }
  const middle = m1 > m0 ? next.slice(m0, m1) : '';
  return [
    ...orig.slice(0, keepHead).map((x) => clone(x)),
    ...parse(middle),
    ...orig.slice(blocks.length - keepTail).map((x) => clone(x)),
  ];
}

/**
 * `dialogue` after an edit of its text (see mergePagesText).
 * @param {DialoguePage[]} dialogue
 * @param {string} text
 * @returns {DialoguePage[]}
 */
export function mergeDialogueText(dialogue, text) {
  return mergePagesText(dialogue, text, dialoguePageText, parseDialogueText);
}

/**
 * `text` / `lines` pages (string[], one paragraph per page) ↔ editor text.
 * @param {string[]|string} arr
 * @returns {string}
 */
export const linesToText = (arr) => (Array.isArray(arr) ? arr.map((x) => String(x ?? '')).join('\n\n') : String(arr ?? ''));
/**
 * Editor text → pages (split at blank lines, trimmed, blank pages dropped).
 * @param {string} t
 * @returns {string[]}
 */
export const textToLines = (t) => String(t).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
/**
 * `lines` after an edit of their text (see mergePagesText).
 * @param {string[]} lines
 * @param {string} text
 * @returns {string[]}
 */
export function mergeLinesText(lines, text) {
  return mergePagesText(Array.isArray(lines) ? lines : [], text, (x) => String(x ?? ''), textToLines);
}


// ---------------------------------------------------------------------------------------------
// Critter groups: where the game starts the animals (src/game/Critters.js calls these, and so do
// the editor's previews)
// ---------------------------------------------------------------------------------------------

const isFinitePoint = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const isFiniteRect = (r) => !!r && ['minX', 'maxX', 'minZ', 'maxZ'].every((k) => Number.isFinite(r[k])) && r.maxX >= r.minX && r.maxZ >= r.minZ;

/**
 * A critter group's explicit yard (world rect) — the relative `area` (offsets from x / z) or the
 * absolute legacy `bounds` — or null (the animals roam `radius` around the point).
 * @param {LevelObjectOf<'critters'>} g critters level object
 * @returns {Rect|null}
 */
export function critterYard(g) {
  const x = Number(g.x) || 0;
  const z = Number(g.z) || 0;
  if (isFiniteRect(g.area)) return { minX: x + g.area.minX, maxX: x + g.area.maxX, minZ: z + g.area.minZ, maxZ: z + g.area.maxZ };
  if (isFiniteRect(g.bounds)) return { minX: g.bounds.minX, maxX: g.bounds.maxX, minZ: g.bounds.minZ, maxZ: g.bounds.maxZ };
  return null;
}

/**
 * World start positions of a critter group's animals — the game's (`Critters._spawnGroup` starts
 * them here) and the editor previews': `count`
 * animals (0–16; the number of spots when blank), the first ones on the exact spots (relative
 * `spotOffsets`, or the absolute legacy `spots`), the others scattered over the yard
 * (`critterYard`, else the roam-radius square) with the group's seeded RNG (`seed`, default a
 * hash of the id) and up to 6 tries onto ground `isWalkable` accepts.
 * @param {LevelObjectOf<'critters'>} g critters level object
 * @param {((x:number, z:number) => boolean)|null} [isWalkable] (game: TileMap.isWalkable)
 * @returns {XZ[]}
 */
export function critterStartPoints(g, isWalkable = null) {
  const kind = CRITTER_KINDS.includes(g.kind) ? g.kind : 'chicken';
  const x = Number(g.x) || 0;
  const z = Number(g.z) || 0;
  const R = Math.max(0.3, Number(g.radius) || 2.5);
  let spots = null;
  if (Array.isArray(g.spotOffsets)) spots = g.spotOffsets.filter(isFinitePoint).map(([dx, dz]) => [x + dx, z + dz]);
  else if (Array.isArray(g.spots)) spots = g.spots.filter(isFinitePoint).map(([px, pz]) => [px, pz]);
  spots = spots?.slice(0, 16) ?? null;
  const count = Number.isFinite(Number(g.count)) && g.count !== null && g.count !== ''
    ? Math.max(0, Math.min(16, Math.round(Number(g.count))))
    : (spots?.length ?? 0);
  let bounds = { minX: x - R, maxX: x + R, minZ: z - R, maxZ: z + R };
  if (isFiniteRect(g.area)) bounds = { minX: x + g.area.minX, maxX: x + g.area.maxX, minZ: z + g.area.minZ, maxZ: z + g.area.maxZ };
  else if (isFiniteRect(g.bounds)) bounds = { ...g.bounds };
  const hash = hashString(String(g.id ?? kind));
  const rng = new RNG((Number.isFinite(g.seed) ? g.seed : hash) >>> 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    let px = x;
    let pz = z;
    if (spots && i < spots.length) [px, pz] = spots[i];
    else if (count > 1) {
      for (let k = 0; k < 6; k++) {
        px = rng.range(bounds.minX + 0.3, bounds.maxX - 0.3);
        pz = rng.range(bounds.minZ + 0.2, bounds.maxZ - 0.2);
        if (!isWalkable || isWalkable(px, pz)) break;
      }
    }
    out.push([px, pz]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Enemy groups and combat levels (COMBAT.md §3, §14.1)
// ---------------------------------------------------------------------------------------------

/**
 * World start positions of an `enemy` group, exactly as the game, the editor previews and the
 * generators choose them — the `critterStartPoints` algorithm, copied: `count` enemies (0–8; a
 * boss group — golem, dragon — is a single boss: 0–1), the first ones on the exact relative `spotOffsets`, the
 * others scattered over the relative `area` (else the home-radius square) with the group's seeded
 * RNG (`seed`, default a hash of 'enemy:' + id) and up to 6 tries onto ground `isWalkable` accepts.
 * @param {LevelObjectOf<'enemy'>} g enemy level object
 * @param {((x:number, z:number) => boolean)|null} [isWalkable] (game: standable ground; fliers:
 *   callers pass a test that also accepts water)
 * @returns {XZ[]}
 */
export function enemyStartPoints(g, isWalkable = null) {
  const kind = ENEMY_KINDS.includes(g.kind) ? g.kind : 'slime';
  const x = Number(g.x) || 0;
  const z = Number(g.z) || 0;
  const R = Math.max(0.3, Number(g.radius) || 3);
  const max = ENEMY_INFO[kind].boss ? 1 : 8;
  let spots = null;
  if (Array.isArray(g.spotOffsets)) spots = g.spotOffsets.filter(isFinitePoint).map(([dx, dz]) => [x + dx, z + dz]);
  spots = spots?.slice(0, max) ?? null;
  const count = Number.isFinite(Number(g.count)) && g.count !== null && g.count !== ''
    ? Math.max(0, Math.min(max, Math.round(Number(g.count))))
    : (spots?.length ?? 0);
  let bounds = { minX: x - R, maxX: x + R, minZ: z - R, maxZ: z + R };
  if (isFiniteRect(g.area)) bounds = { minX: x + g.area.minX, maxX: x + g.area.maxX, minZ: z + g.area.minZ, maxZ: z + g.area.maxZ };
  const hash = hashString('enemy:' + String(g.id ?? kind));
  const rng = new RNG((Number.isFinite(g.seed) ? g.seed : hash) >>> 0);
  const out = [];
  for (let i = 0; i < count; i++) {
    let px = x;
    let pz = z;
    if (spots && i < spots.length) [px, pz] = spots[i];
    else if (count > 1) {
      for (let k = 0; k < 6; k++) {
        px = rng.range(bounds.minX + 0.3, bounds.maxX - 0.3);
        pz = rng.range(bounds.minZ + 0.2, bounds.maxZ - 0.2);
        if (!isWalkable || isWalkable(px, pz)) break;
      }
    }
    out.push([px, pz]);
  }
  return out;
}

/**
 * Is `type` one of the combat-only object types (`combat: true`: enemy, chest, waystone)?
 * @param {string} type any string (unknown types are not combat types)
 * @returns {boolean}
 */
export function isCombatType(type) {
  return !!OBJECT_TYPES[type]?.combat;
}

/**
 * Is `type` one of the campaign types (`campaign: true`: exit, entrance — a level played on its own
 * ignores them)?
 * @param {string} type any string (unknown types are not campaign types)
 * @returns {boolean}
 */
export function isCampaignType(type) {
  return isOwnKey(OBJECT_TYPES, type) && !!(/** @type {ObjectTypeDef} */ (OBJECT_TYPES[type]).campaign);
}

/**
 * Is `type` one of the interior types (`interior: true`: the furniture of rooms — bed, table, chair,
 * shelf, hearth, counter, rug, staircase, wardrobe, wallWindow, sacks)?
 * @param {string} type any string (unknown types are not interior types)
 * @returns {boolean}
 */
export function isInteriorType(type) {
  return isOwnKey(OBJECT_TYPES, type) && !!(/** @type {ObjectTypeDef} */ (OBJECT_TYPES[type]).interior);
}

/**
 * Is `type` one of the set-piece types of Vanquish the Evil Dragon (`setpiece: true`: fire, debris,
 * crag, garland, skyDragon — docs/contracts/DRAGON_CAMPAIGN.md §5.3)? Starfall Vale's and
 * Cinderwatch Pass's coverage skip them; the dragon campaign's generator covers them.
 * @param {string} type any string (unknown types are not set-piece types)
 * @returns {boolean}
 */
export function isSetpieceType(type) {
  return isOwnKey(OBJECT_TYPES, type) && !!(/** @type {ObjectTypeDef} */ (OBJECT_TYPES[type]).setpiece);
}

/**
 * A number option from level data (anything else: the default), clamped — as the furniture
 * builders read it (the editor's 2D sketches read them the same way).
 * @param {unknown} v @param {number} d @param {number} lo @param {number} hi
 * @returns {number}
 */
export function optNum(v, d, lo, hi) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : d));
}

/**
 * The footprint of an interior piece in its own frame (x across, z front to back; rotation 0: the
 * front toward +Z; turn it by `rotation` about +Y for the world) — what its collider covers, or for
 * a rug / a wall window (`solid: false`, no collider) what it covers on the floor / the wall. Null
 * for any other type. Mirrors the builders in src/engine/world/props/Furniture.js: change both.
 * Used for picking and the 2D map (`objectBounds`) and by the level checks. `round`: the collider
 * is a circle of radius maxX (a chair, a round table) — the same whatever the rotation.
 * @param {LevelObject} obj
 * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number, solid: boolean, round: boolean }|null}
 */
export function interiorFootprint(obj) {
  // (only a plain object: the builders read a spread copy, which a string or an array leaves
  // without e.g. `length`)
  const raw = obj?.opts;
  const o = /** @type {Record<string, any>} */ (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
  const box = (hx, z0, z1, solid = true, round = false) => ({ minX: -hx, maxX: hx, minZ: z0, maxZ: z1, solid, round });
  switch (obj?.type) {
    case 'bed': { const w = optNum(o.width, 1.2, 0.8, 2.4); const l = optNum(o.length, 2.2, 1.6, 2.8); return box(w / 2 + 0.05, -l / 2, l / 2); }
    case 'table': {
      const round = o.shape === 'round';
      const w = optNum(o.width, round ? 1.2 : 1.6, 0.6, 3.2);
      if (round) return box(w / 2 + 0.02, -w / 2 - 0.02, w / 2 + 0.02, true, true);
      const d = optNum(o.depth, 0.9, 0.6, 2);
      return box(w / 2, -d / 2, d / 2);
    }
    case 'chair': { const r = o.style === 'stool' ? 0.22 : 0.27; return box(r, -r, r, true, true); }
    case 'shelf': return box(optNum(o.width, 1.6, 0.8, 3.2) / 2, -0.25, 0.25);
    case 'hearth': return box(optNum(o.width, 2.2, 1.6, 3.6) / 2 + 0.15, -0.5, 0.5);
    case 'counter': return box(optNum(o.width, 2.6, 1.2, 6) / 2, -0.35, 0.41);
    case 'rug': { const l = optNum(o.length, 3, 1, 8); return box(optNum(o.width, 2, 1, 6) / 2, -l / 2 - 0.15, l / 2 + 0.15, false); }
    case 'staircase': {
      const w = optNum(o.width, 1.2, 0.8, 2.4);
      const n = Math.round(optNum(o.steps, 7, 3, 14));
      if (o.dir === 'down') { const l = n * 0.38; return box(w / 2 + 0.1, -l / 2 - 0.1, l / 2); }
      return box(n * 0.2, -w / 2, w / 2 + 0.04);
    }
    case 'wardrobe': {
      const drawers = o.kind === 'drawers';
      const w = optNum(o.width, drawers ? 1.2 : 1.4, 0.6, 2.6);
      const d = drawers ? 0.5 : 0.6;
      return box(w / 2 + 0.04, -d / 2, d / 2 + 0.04);
    }
    case 'wallWindow': return box(Math.round(optNum(o.panes, 1, 1, 3)) / 2 + 0.5, 0, 0.3, false);
    case 'sacks': return box((Math.min(Math.round(optNum(o.count, 3, 1, 4)), 3) * 0.52 + 0.1) / 2, -0.33, 0.33);
    default: return null;
  }
}

/**
 * Where the player stands to use a `staircase` — the spot for its `use` exit — and the way they face
 * there: 0.5 beyond the first step of an up flight, or 0.55 in front of a stairwell's open end.
 * Null for any other object.
 * @param {LevelObject} obj
 * @returns {{ x: number, z: number, dx: number, dz: number }|null} the world point and the facing
 *   direction (a unit vector)
 */
export function staircaseFoot(obj) {
  if (obj?.type !== 'staircase') return null;
  const o = /** @type {Record<string, any>} */ (obj.opts ?? {});
  const n = Math.round(optNum(o.steps, 7, 3, 14));
  let lx;
  let lz;
  let fx;
  let fz;
  if (o.dir === 'down') { lx = 0; lz = (n * 0.38) / 2 + 0.55; fx = 0; fz = -1; }
  else { const s = o.flip === true ? -1 : 1; lx = -s * (n * 0.2 + 0.5); lz = 0; fx = s; fz = 0; }
  const rot = obj.rotation ?? 0;
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  return { x: obj.x + lx * c + lz * sn, z: obj.z - lx * sn + lz * c, dx: fx * c + fz * sn, dz: -fx * sn + fz * c };
}

/**
 * Is `type` one of the story types (`story: true`: event, marker — docs/specs/STORY_SCRIPT.md)?
 * @param {string} type any string (unknown types are not story types)
 * @returns {boolean}
 */
export function isStoryType(type) {
  return isOwnKey(OBJECT_TYPES, type) && !!(/** @type {ObjectTypeDef} */ (OBJECT_TYPES[type]).story);
}

/**
 * Does the level carry a story of its own — an `event` object, or a villager with a talk script or
 * an actor (docs/specs/STORY_SCRIPT.md)? Such a level gets the story runtime also when it is played
 * on its own (a session-only story state); every other single level plays exactly as before
 * (`when` / `unless` ignored, no story module loaded).
 * @param {Level} level
 * @returns {boolean}
 */
export function levelHasStory(level) {
  for (const o of level?.objects ?? []) {
    if (o?.type === 'event') return true;
    if (o?.type === 'npc' && (hasScript(o.talk) || (typeof o.actor === 'string' && o.actor.trim()))) return true;
  }
  return false;
}

/**
 * Does the level play with combat? `environment.combat === true` forces it on, `false` forces it
 * off; absent (auto) = on iff the level has an `enemy` object (COMBAT.md §3, D1).
 * @param {Level} level
 * @returns {boolean}
 */
export function levelHasCombat(level) {
  const env = /** @type {Partial<LevelEnvironment>} */ (level?.environment ?? {});
  if (env.combat === true) return true;
  if (env.combat === false) return false;
  return Array.isArray(level?.objects) && level.objects.some((o) => o?.type === 'enemy');
}
