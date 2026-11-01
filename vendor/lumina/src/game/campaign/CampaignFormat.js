/**
 * The campaign file (docs/specs/CAMPAIGN_FORMAT.md): `public/campaigns/<name>/campaign.json`, the
 * story game that ties several levels together — which levels it has (their files are
 * `levels/<id>.json` in the same folder) and where they sit on a shared plane (`at`, for seams and
 * the campaign map), where the game starts, and the chapters that swap a level for a variant file.
 *
 * Node-safe (no DOM, no three.js): `tools/check-level.mjs --campaign` and the campaign generators
 * import it. Like a level, a campaign file is untrusted data: every name is looked up as an own
 * key, and level ids are file-safe slugs, so every path stays inside the campaign's folder.
 */
import { isOwnKey, showValue } from '../../engine/utils/own.js';
import { storyFileList } from './StoryFormat.js';
import { cleanTextKeysOf } from '../../engine/i18n/ContentKeys.js';
import { CHARACTER_PRESET_NAMES } from '../../engine/level/ObjectCatalog.js';

/** Any value for a message, never throwing (`{"toString": 1}`), at most 80 characters. @param {unknown} v */
const show = (v) => {
  const s = showValue(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
};

export const CAMPAIGN_FORMAT = 'luminati-campaign';
export const CAMPAIGN_VERSION = 1;

/** A level id / campaign name: the file-name rule of the level API (a–z, 0–9, '-'; ≤ 60). */
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
/** Windows device names cannot be files there (LevelStorage.slugify avoids them too). */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/**
 * One level of a campaign.
 * @typedef {object} CampaignLevel
 * @property {string} id   file `levels/<id>.json`; what exits call the level
 * @property {[number, number]|null} at   where the level's corner (x 0, z 0) sits on the campaign
 *   plane, in world units — two placed levels that touch or overlap join seamlessly: an exit with
 *   no entrance arrives across the seam (null: not placed)
 */

/**
 * A stage of the story. The active chapter is the last one whose `when` holds (a chapter without
 * `when` is always reached); its `levels` swap a level for a variant file.
 * @typedef {object} CampaignChapter
 * @property {string} id
 * @property {string} title      shown in a banner when the chapter begins ('' = none)
 * @property {string} subtitle
 * @property {string} when       story condition that begins it — a flag name, or e.g.
 *   `quest:lantern = done` (docs/specs/STORY_SCRIPT.md §2; '' = from the start)
 * @property {Record<string, string>} levels   level id → variant level id (prototype-less)
 * @property {{ title?: string, subtitle?: string }} [textKeys]   the content-text keys of its title and
 *   subtitle (GUIDs, docs/specs/I18N.md §4.2; absent: none)
 */

/** The page's post looks a campaign may choose (`look`; src/game/CinematicLook.js `PostLook`). */
export const CAMPAIGN_LOOKS = /** @type {const} */ (['cinematic', 'diorama']);
/**
 * The player's kits (`player.kit`): `traveler` — the default, today's traveler and sword —,
 * `swordmaster` (docs/contracts/DRAGON_CAMPAIGN.md §6.8: the player package's kit) and `bellwarden`
 * (docs/contracts/EVERMERE_CAMPAIGN.md §5.5: Linnet's hammer, Peal, Toll and Carillon).
 */
export const PLAYER_KITS = /** @type {const} */ (['traveler', 'swordmaster', 'bellwarden']);
/** The keys a campaign may turn off (`controls`): T (the time of day) and R (the weather). */
export const CONTROL_KEYS = /** @type {const} */ (['time', 'weather']);

/**
 * The player of a campaign (`player`, DRAGON_CAMPAIGN.md §5.1): every field optional — absent, the
 * traveler as before.
 * @typedef {object} CampaignPlayer
 * @property {string} [name]   the name the story shows for the speaker `player` (a term)
 * @property {string} [preset] the look: a `CHARACTER_PRESET_NAMES` value (absent: the traveler)
 * @property {Record<string, any>} [spec] sheet spec overrides merged over the preset (as an npc's
 *   `spec`: `createCharacterSheet`'s fields — plain JSON, copied)
 * @property {typeof PLAYER_KITS[number]} [kit] the combat kit (absent: `traveler`)
 */

/**
 * @typedef {object} Campaign
 * @property {'luminati-campaign'} format
 * @property {number} version
 * @property {string} name       the title screen's title and the save's label
 * @property {string} subtitle
 * @property {{ title?: string, subtitle?: string, prompt?: string, credit?: string }} title
 *   title-screen overrides (as a level's `environment.title`)
 * @property {typeof CAMPAIGN_LOOKS[number]} [look]   the page's post look for the campaign (absent:
 *   the diorama; `?look=` in the URL wins — src/main.js)
 * @property {CampaignPlayer} [player]   the player's name, look and kit (absent: the traveler)
 * @property {{ level?: number, potions?: number }} [progress]   the combat progress a new journey
 *   starts with (level 1–10, draughts 0–5; CampaignState seeds its `combat` from it)
 * @property {{ time?: false, weather?: false }} [controls]   keys turned off for the whole campaign
 *   (`false`: T / R do nothing and the controls legend leaves them out)
 * @property {{ level: string, entrance: string }} start   where a new game begins ('' entrance:
 *   the level's player start)
 * @property {CampaignLevel[]} levels
 * @property {CampaignChapter[]} chapters
 * @property {string[]} flags    story flags set when a new game begins
 * @property {string[]} story    the story files, in the campaign's `story/` folder (StoryFormat.js;
 *   [] = none)
 * @property {Record<string, string>} [textKeys]   the content-text keys of its own texts (`subtitle`,
 *   `title.title` …; GUIDs, docs/specs/I18N.md §4.2; absent: none)
 * @property {Record<string, any>} extra   top-level keys this engine does not know, kept as they are
 *   so a rewrite (serializeCampaign) does not drop what a newer engine wrote
 */

/** The top-level keys of a campaign file this engine reads (the rest go to `extra`). */
const KNOWN_KEYS = new Set(['format', 'version', 'name', 'subtitle', 'title', 'look', 'player', 'progress', 'controls', 'start', 'levels', 'chapters', 'flags', 'story', 'textKeys']);
/** Keys never copied into `extra` (they would change its prototype, not add a field). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Is `s` a usable level id (a file-safe slug that is no Windows device name)?
 * @param {unknown} s
 * @returns {s is string}
 */
export function isLevelId(s) {
  return typeof s === 'string' && SLUG.test(s) && !RESERVED.test(s);
}

/** The level's file inside the campaign folder. @param {string} id a level id (isLevelId) */
export const levelFile = (id) => `levels/${id}.json`;

const text = (v) => (typeof v === 'string' ? v : '');
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isXZ = (p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * Fill defaults and drop what cannot be used, with a warning for each thing dropped; `errors`
 * lists what makes the campaign unplayable (no levels, an unknown start level …).
 * @param {unknown} raw parsed JSON
 * @returns {{ campaign: Campaign, warnings: string[], errors: string[] }}
 */
export function normalizeCampaign(raw) {
  const warnings = [];
  const errors = [];
  const r = isPlain(raw) ? /** @type {Record<string, any>} */ (raw) : {};
  if (!isPlain(raw)) errors.push('the campaign file is not a JSON object');
  else if (r.format !== CAMPAIGN_FORMAT) errors.push(`"format" must be "${CAMPAIGN_FORMAT}"`);
  const version = Number.isInteger(r.version) ? r.version : CAMPAIGN_VERSION;
  if (version > CAMPAIGN_VERSION) warnings.push(`campaign version ${version} is newer than this engine (${CAMPAIGN_VERSION}): unknown fields are ignored`);

  /** @type {CampaignLevel[]} */
  const levels = [];
  const ids = new Set();
  for (const [k, e] of (Array.isArray(r.levels) ? r.levels : []).entries()) {
    const id = isPlain(e) ? e.id : e;
    if (!isLevelId(id)) { warnings.push(`levels[${k}]: "${show(id)}" is not a level id (a–z, 0–9 and -) — dropped`); continue; }
    if (ids.has(id)) { warnings.push(`levels[${k}]: "${id}" is listed twice — the second dropped`); continue; }
    ids.add(id);
    const at = isPlain(e) && e.at != null ? e.at : null;
    if (at != null && !isXZ(at)) warnings.push(`level "${id}": "at" must be [x, z] — ignored`);
    levels.push({ id, at: isXZ(at) ? [at[0], at[1]] : null });
  }
  if (!levels.length) errors.push('the campaign lists no levels');

  const s = isPlain(r.start) ? r.start : {};
  const start = { level: text(s.level), entrance: text(s.entrance) };
  if (!start.level && levels.length) start.level = levels[0].id;
  else if (start.level && !ids.has(start.level)) errors.push(`start level "${start.level}" is not one of the campaign's levels`);

  /** @type {CampaignChapter[]} */
  const chapters = [];
  const chapterIds = new Set();
  /** variant id → the base level it stands for (one base per variant file) */
  const variantOf = new Map();
  for (const [k, c] of (Array.isArray(r.chapters) ? r.chapters : []).entries()) {
    if (!isPlain(c)) { warnings.push(`chapters[${k}] is not an object — dropped`); continue; }
    const id = text(c.id) || `chapter-${k + 1}`;
    if (chapterIds.has(id)) warnings.push(`chapter id "${id}" is used twice`);
    chapterIds.add(id);
    /** @type {Record<string, string>} */
    const swap = Object.create(null);
    for (const [from, to] of Object.entries(isPlain(c.levels) ? c.levels : {})) {
      if (!ids.has(from)) { warnings.push(`chapter "${id}": "${from}" is not one of the campaign's levels — ignored`); continue; }
      if (!isLevelId(to)) { warnings.push(`chapter "${id}": variant "${show(to)}" of "${from}" is not a level id — ignored`); continue; }
      if (to !== from && ids.has(to)) { warnings.push(`chapter "${id}": "${to}" is a level of the campaign itself, not a variant of "${from}" — ignored`); continue; }
      if (variantOf.has(to) && variantOf.get(to) !== from) { warnings.push(`chapter "${id}": variant "${to}" already stands for "${variantOf.get(to)}" — not also for "${from}"`); continue; }
      variantOf.set(to, from);
      swap[from] = to;
    }
    const ck = cleanTextKeysOf('chapter', c.textKeys);
    if (ck.dropped) warnings.push(`chapter "${id}": ${ck.dropped} malformed or unknown text key(s) dropped`);
    chapters.push({ id, title: text(c.title), subtitle: text(c.subtitle), when: text(c.when).trim(), levels: swap, ...(ck.keys ? { textKeys: ck.keys } : {}) });
  }

  const flags = (Array.isArray(r.flags) ? r.flags : []).filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim());
  const t = isPlain(r.title) ? r.title : {};
  const title = {};
  for (const k of ['title', 'subtitle', 'prompt', 'credit']) if (typeof t[k] === 'string') title[k] = t[k];

  const story = storyFileList(r.story, warnings);
  const look = r.look === undefined ? undefined : readLook(r.look, warnings);
  const player = r.player === undefined ? undefined : readPlayer(r.player, warnings);
  const progress = r.progress === undefined ? undefined : readProgress(r.progress, warnings);
  const controls = r.controls === undefined ? undefined : readControls(r.controls, warnings);
  const rootKeys = cleanTextKeysOf('root', r.textKeys);
  if (rootKeys.dropped) warnings.push(`textKeys: ${rootKeys.dropped} malformed or unknown text key(s) dropped`);
  /** @type {Record<string, any>} */
  const extra = {};
  // (as LevelFormat: `extra.__proto__ = v` would set extra's prototype rather than keep a field)
  for (const [k, v] of Object.entries(r)) if (!KNOWN_KEYS.has(k) && !UNSAFE_KEYS.has(k)) extra[k] = v;

  /** @type {Campaign} */
  const campaign = {
    format: CAMPAIGN_FORMAT,
    version,
    name: text(r.name).trim() || 'Untitled campaign',
    subtitle: text(r.subtitle),
    title,
    ...(look ? { look } : {}),
    ...(player ? { player } : {}),
    ...(progress ? { progress } : {}),
    ...(controls ? { controls } : {}),
    start,
    levels,
    chapters,
    flags,
    story,
    ...(rootKeys.keys ? { textKeys: rootKeys.keys } : {}),
    extra,
  };
  return { campaign, warnings, errors };
}

/** The longest name `player.name` may be (a name plate). */
const MAX_PLAYER_NAME = 60;
/** How deep and how wide a `player.spec` may be (it is copied: untrusted data). */
const SPEC_LIMITS = Object.freeze({ depth: 4, keys: 64 });

/**
 * `look` → 'cinematic' | 'diorama', or null (dropped with a warning).
 * @param {unknown} v
 * @param {string[]} warnings
 * @returns {Campaign['look']|null}
 */
function readLook(v, warnings) {
  if (CAMPAIGN_LOOKS.includes(/** @type {any} */ (v))) return /** @type {Campaign['look']} */ (v);
  warnings.push(`"look" must be ${CAMPAIGN_LOOKS.map((l) => `"${l}"`).join(' or ')}, not ${show(v)} — ignored`);
  return null;
}

/**
 * `player` → its usable fields (null when none is: dropped), each bad one dropped with a warning.
 * @param {unknown} v
 * @param {string[]} warnings
 * @returns {CampaignPlayer|null}
 */
function readPlayer(v, warnings) {
  if (!isPlain(v)) {
    warnings.push(`"player" must be an object { name, preset, spec, kit } — ignored`);
    return null;
  }
  const p = /** @type {Record<string, unknown>} */ (v);
  /** @type {CampaignPlayer} */
  const out = {};
  for (const k of Object.keys(p)) if (!['name', 'preset', 'spec', 'kit'].includes(k)) warnings.push(`player: "${show(k)}" is not a field of the player (name, preset, spec, kit) — ignored`);
  if (p.name !== undefined) {
    const n = typeof p.name === 'string' ? p.name.trim() : '';
    if (n && n.length <= MAX_PLAYER_NAME) out.name = n;
    else warnings.push(`player.name must be a name of 1–${MAX_PLAYER_NAME} characters, not ${show(p.name)} — ignored`);
  }
  if (p.preset !== undefined) {
    if (typeof p.preset === 'string' && CHARACTER_PRESET_NAMES.includes(p.preset)) out.preset = p.preset;
    else warnings.push(`player.preset ${show(p.preset)} is not a look (${CHARACTER_PRESET_NAMES.join(', ')}) — ignored`);
  }
  if (p.spec !== undefined) {
    const spec = isPlain(p.spec) ? plainCopy(p.spec, 0) : undefined;
    if (spec && Object.keys(spec).length) out.spec = spec;
    else warnings.push('player.spec must be an object of sheet fields (as an npc\'s spec) — ignored');
  }
  if (p.kit !== undefined) {
    if (PLAYER_KITS.includes(/** @type {any} */ (p.kit))) out.kit = /** @type {CampaignPlayer['kit']} */ (p.kit);
    else warnings.push(`player.kit ${show(p.kit)} is not a kit (${PLAYER_KITS.join(', ')}) — ignored`);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * A copy of plain JSON data (objects without prototype keys, arrays, strings, finite numbers,
 * booleans, null), at most `SPEC_LIMITS` deep and wide; anything else is left out. undefined for
 * a value that is none of these.
 * @param {unknown} v
 * @param {number} depth
 * @returns {any}
 */
function plainCopy(v, depth) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (depth >= SPEC_LIMITS.depth) return undefined;
  if (Array.isArray(v)) return v.slice(0, SPEC_LIMITS.keys).map((x) => plainCopy(x, depth + 1)).filter((x) => x !== undefined);
  if (!isPlain(v)) return undefined;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, x] of Object.entries(/** @type {object} */ (v)).slice(0, SPEC_LIMITS.keys)) {
    if (UNSAFE_KEYS.has(k)) continue;
    const c = plainCopy(x, depth + 1);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

/**
 * `progress` → `{ level?, potions? }` (whole numbers clamped into 1–10 and 0–5, with a warning when
 * moved), or null (none usable: dropped).
 * @param {unknown} v
 * @param {string[]} warnings
 * @returns {Campaign['progress']|null}
 */
function readProgress(v, warnings) {
  if (!isPlain(v)) {
    warnings.push('"progress" must be an object { level, potions } — ignored');
    return null;
  }
  const p = /** @type {Record<string, unknown>} */ (v);
  /** @type {{ level?: number, potions?: number }} */
  const out = {};
  for (const k of Object.keys(p)) if (k !== 'level' && k !== 'potions') warnings.push(`progress: "${show(k)}" is not a field of the progress (level, potions) — ignored`);
  for (const [k, lo, hi] of /** @type {const} */ ([['level', 1, 10], ['potions', 0, 5]])) {
    const x = p[k];
    if (x === undefined) continue;
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      warnings.push(`progress.${k} must be a number (${lo}–${hi}), not ${show(x)} — ignored`);
      continue;
    }
    const n = Math.min(hi, Math.max(lo, Math.round(x)));
    if (n !== x) warnings.push(`progress.${k} ${x} is read as ${n} (a whole number, ${lo}–${hi})`);
    out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * `controls` → `{ time?: false, weather?: false }` (only `false` turns a key off; `true` is the
 * default and is dropped), or null (nothing turned off).
 * @param {unknown} v
 * @param {string[]} warnings
 * @returns {Campaign['controls']|null}
 */
function readControls(v, warnings) {
  if (!isPlain(v)) {
    warnings.push('"controls" must be an object { time: false, weather: false } — ignored');
    return null;
  }
  const c = /** @type {Record<string, unknown>} */ (v);
  /** @type {{ time?: false, weather?: false }} */
  const out = {};
  for (const [k, x] of Object.entries(c)) {
    if (!CONTROL_KEYS.includes(/** @type {any} */ (k))) warnings.push(`controls: "${show(k)}" is not a key a campaign turns off (${CONTROL_KEYS.join(', ')}) — ignored`);
    else if (x === false) out[/** @type {typeof CONTROL_KEYS[number]} */ (k)] = false;
    else if (x !== true) warnings.push(`controls.${k} must be false (or true, the default), not ${show(x)} — ignored`);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Parse a campaign file's text (throws on invalid JSON).
 * @param {string} json
 */
export function parseCampaign(json) {
  return normalizeCampaign(JSON.parse(json));
}

/**
 * The file text of a campaign: the normalised fields in a fixed order, two-space indent, final
 * newline (generators write it; `--check` compares it byte for byte).
 * @param {Campaign} c
 * @returns {string}
 */
export function serializeCampaign(c) {
  const out = {
    format: CAMPAIGN_FORMAT,
    version: c.version,
    name: c.name,
    subtitle: c.subtitle,
    ...(Object.keys(c.title).length ? { title: c.title } : {}),
    // (DRAGON_CAMPAIGN.md §5.1: only when present, each in a fixed order of its fields)
    ...(c.look ? { look: c.look } : {}),
    ...(c.player ? { player: pick(c.player, ['name', 'preset', 'spec', 'kit']) } : {}),
    ...(c.progress ? { progress: pick(c.progress, ['level', 'potions']) } : {}),
    ...(c.controls ? { controls: pick(c.controls, CONTROL_KEYS) } : {}),
    start: c.start,
    levels: c.levels.map((l) => (l.at ? { id: l.id, at: l.at } : { id: l.id })),
    chapters: c.chapters.map((ch) => ({
      id: ch.id,
      ...(ch.title ? { title: ch.title } : {}),
      ...(ch.subtitle ? { subtitle: ch.subtitle } : {}),
      ...(ch.when ? { when: ch.when } : {}),
      ...(Object.keys(ch.levels).length ? { levels: { ...ch.levels } } : {}),
      ...(ch.textKeys ? { textKeys: ch.textKeys } : {}),
    })),
    ...(c.flags.length ? { flags: c.flags } : {}),
    ...(c.story?.length ? { story: c.story } : {}),
    ...(c.textKeys ? { textKeys: c.textKeys } : {}),
    ...(c.extra ?? {}),
  };
  // (an `at` pair on one line)
  return `${JSON.stringify(out, null, 2).replace(/\[\n\s+(-?[\d.e+-]+),\n\s+(-?[\d.e+-]+)\n\s+\]/g, '[$1, $2]')}\n`;
}

/**
 * The fields of `o` named in `keys`, in that order (absent ones left out).
 * @param {Record<string, any>} o
 * @param {readonly string[]} keys
 */
function pick(o, keys) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

/**
 * The campaign's entry for level `id` (a base level; variants are not listed), or null.
 * @param {Campaign} c
 * @param {string} id
 * @returns {CampaignLevel|null}
 */
export function campaignLevel(c, id) {
  return c.levels.find((l) => l.id === id) ?? null;
}

/** The campaigns whose chapter is being decided now → the chapter decided so far. @type {WeakMap<Campaign, { cur: CampaignChapter|null }>} */
const deciding = new WeakMap();

/**
 * The chapter in force: the last one whose `when` holds (or that has none), else null.
 *
 * A chapter's `when` that reads `chapter` (an error of the campaign check) asks this again while it
 * is being decided: that inner question is answered with the chapter decided so far — the last
 * earlier chapter whose condition held, else the first chapter — instead of recursing forever.
 * @param {Campaign} c
 * @param {(when: string) => boolean} holds does a story condition hold now (the flag rule: a bare
 *   flag name is that flag — `StoryState.holds`)
 * @returns {CampaignChapter|null}
 */
export function activeChapter(c, holds) {
  const outer = deciding.get(c);
  if (outer) return outer.cur ?? c.chapters[0] ?? null;
  const state = { cur: /** @type {CampaignChapter|null} */ (null) };
  deciding.set(c, state);
  try {
    for (const ch of c.chapters) if (!ch.when || holds(ch.when)) state.cur = ch;
    return state.cur;
  } finally {
    deciding.delete(c);
  }
}

/**
 * The file id to load for level `id` in the current chapter (its variant, or itself).
 * @param {Campaign} c
 * @param {string} id
 * @param {(when: string) => boolean} holds
 * @returns {string}
 */
export function chapterLevelId(c, id, holds) {
  const ch = activeChapter(c, holds);
  return ch && isOwnKey(ch.levels, id) ? ch.levels[id] : id;
}

/**
 * Every file id that can stand for level `id` (itself and its chapter variants), for checks.
 * @param {Campaign} c
 * @param {string} id
 * @returns {string[]}
 */
export function levelVariants(c, id) {
  const out = [id];
  for (const ch of c.chapters) if (isOwnKey(ch.levels, id) && !out.includes(ch.levels[id])) out.push(ch.levels[id]);
  return out;
}

/**
 * Across a seam: point (x, z) of level `from` in the coordinates of level `to`, when the campaign
 * places both (`at`); null otherwise.
 * @param {Campaign} c
 * @param {string} from
 * @param {string} to
 * @param {number} x
 * @param {number} z
 * @returns {{ x: number, z: number }|null}
 */
export function acrossSeam(c, from, to, x, z) {
  const a = campaignLevel(c, from)?.at;
  const b = campaignLevel(c, to)?.at;
  if (!a || !b) return null;
  return { x: x + a[0] - b[0], z: z + a[1] - b[1] };
}
