/**
 * Content text: what players read from level, campaign and story data (and the hand-written
 * conversations in src/game/dialogue.js), translated at display (docs/specs/I18N.md §4). Node-safe:
 * nothing here touches `fetch`, `location` or `document` at import time (it imports nothing), so
 * the story runtime, the level tools and the i18n checker import it in Node.
 *
 * Two kinds of content text:
 * - **Units** — prose (a dialogue page, a sign, a choice, a script's line, a quest's text, a title):
 *   `loc(key, source)`. The key is the text key the data holds beside the text (I18N.md §4.2: a
 *   GUID in `textKeys`, a script line's `#line:` tag — `9F2A1B3C4D5E6F708192A3B4C5D6E7F8`, a banner
 *   subtitle's `<GUID>.2` —, or a code key such as `dlg.elder.welcome`), kept through every edit:
 *   inserting a page or reordering lines never moves a translation. A table's unit records the
 *   English it was translated from, and the translation is shown only while that source is still
 *   the English shown — an edited line shows its English until a translator has reviewed it (never
 *   a translation of other words). Nothing is ever translated by its English: a key no table
 *   holds, and a text the data holds no key for, show the English (recorded as misses).
 * - **Terms** — names (villagers, places, levels, items, foes, speakers): identities in this engine
 *   (scripts match villagers by name, saves keep it, `level.name` seeds the terrain), translated by
 *   that identity: `term(name)`.
 *
 * Tables live in `public/i18n/<lang>/<id>.json` (`id`: `common`, `levels/<name>`,
 * `campaigns/<name>`), listed by `public/i18n/index.json`; only listed tables are ever fetched, and
 * English fetches nothing. A loaded table is a link of the lookup **chain**: the level's or the
 * campaign's own table, then the tables it `extends`, then `common`.
 *
 * Translate at display, never in the loaded data: names and labels are identities too (I18N.md
 * §4.5). Only version-3 tables are read: a file of an older version, or of none, is skipped with a
 * warning, like a file that cannot be read (I18N.md §4.9 tells how the tables came to version 3).
 *
 * Untrusted data: keys and names are any text a level holds ("__proto__", "constructor" …), so
 * every table is held in `Map`s, never read as `obj[key]` (KNOWN_ISSUES LVL-17).
 */

/** `format` of a content table file. */
export const CONTENT_FORMAT = 'luminati-i18n';
/** `format` of `public/i18n/index.json`. */
export const CONTENT_INDEX_FORMAT = 'luminati-i18n-index';
/**
 * The table version this engine writes and reads: 3, units keyed by the text keys the data holds
 * (GUIDs, code keys). A file of another version, or of none, is not read; a newer one is read with a
 * warning (its unknown fields ignored).
 */
export const CONTENT_VERSION = 3;
/** The version of `index.json` this engine writes and reads. */
export const CONTENT_INDEX_VERSION = 1;

/**
 * What a text is shown as (the extractor's kinds; tables do not need them): `loc(key, source,
 * kind)` passes one for the tools only.
 * - `line`: a page of dialogue or narration, a sign, a toast, a bark, a quest or item text
 * - `choice`: an answer of a choice (a level dialogue choice, a script's `> option`)
 * - `speaker`: a name plate over the dialog window
 * - `name`: a name shown anywhere else (villager, place, level, campaign, item, quest, waystone, foe)
 * - `label`: an interaction prompt's verb (an exit's or an event's label, Knock / Read …)
 * - `title`: a banner, a chapter title, a title-screen line, an ending's title
 */
export const CONTENT_KINDS = Object.freeze(['line', 'choice', 'speaker', 'name', 'label', 'title']);

/** A table id: `common`, `levels/<slug>` or `campaigns/<slug>` (the level / campaign file-name rule). */
const TABLE_ID = /^(common|(levels|campaigns)\/[a-z0-9][a-z0-9-]{0,59})$/;
/** A language code of the index (`ja`, `zh`; never `en`: English is the source). */
const LANG_CODE = /^[a-z]{2,3}$/;
/** At most this many `extends` links followed from one table (a cycle stops earlier). */
const MAX_EXTENDS_DEPTH = 4;
/** At most this many entries read from one table (a hostile file cannot grow it unbounded). */
const MAX_ENTRIES = 50000;
/** The longest key a table may hold. */
const MAX_KEY = 400;
/** At most this many misses remembered (`contentMisses`). */
const MAX_MISSES = 500;

/**
 * A unit of a table: the English it translates (`source`, trimmed) and the translation.
 * @typedef {{ source: string, target: string, note?: string }} ContentUnit
 */

/**
 * One loaded table.
 * @typedef {object} ContentTable
 * @property {string} id            'common' | 'levels/<name>' | 'campaigns/<name>' ('' for an anonymous one)
 * @property {string} lang
 * @property {number} version       `CONTENT_VERSION` (a newer file is read as this version)
 * @property {string[]} extends     the table ids it builds on (looked up after it, before common)
 * @property {Map<string, string>} terms             name → translation
 * @property {Map<string, ContentUnit>} units        key → unit
 */

/**
 * What `loadContentTables` did.
 * @typedef {object} ContentLoad
 * @property {string} lang
 * @property {string[]} tables    the chain installed, in lookup order
 * @property {number} strings     entries in it (units + terms)
 * @property {string[]} warnings  what was skipped and why (missing files, bad entries …)
 */

/**
 * A text the active chain could not translate (`contentMisses`): a unit's key no table holds
 * (`missing`), one whose recorded source is not the English shown (`stale`: the English was edited
 * — the line needs review), a text the data holds no key for (`nokey`: one miss per English), or a
 * name with no term (`term`).
 * @typedef {{ key?: string, name?: string, source: string, why: 'missing'|'stale'|'nokey'|'term' }} ContentMiss
 */

/** @type {ContentTable[]} the active chain (empty: English) */
let chain = [];
/** @type {string} the language of the active chain ('en' when empty) */
let chainLang = 'en';
/** @type {Map<string, ContentMiss>} */
const misses = new Map();

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** A value for a message (never throws: `{"toString": 1}`). */
const show = (v) => {
  if (typeof v === 'string') return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  try { return String(JSON.stringify(v)); } catch { return typeof v; }
};

/** Is `id` a usable table id (`common`, `levels/<slug>`, `campaigns/<slug>`)? @param {unknown} id @returns {id is string} */
export function isTableId(id) {
  return typeof id === 'string' && TABLE_ID.test(id);
}

/** How many misses did not fit (`contentInfo().missDropped`). */
let dropped = 0;
/** Inside `quietly` (a lookup for what is not shown yet): nothing is recorded. */
let quiet = 0;

/** Remember a miss (the first of each key or name). @param {string} id @param {ContentMiss} m */
function miss(id, m) {
  if (quiet > 0 || misses.has(id)) return;
  if (misses.size < MAX_MISSES) misses.set(id, m);
  else dropped++;
}

/**
 * `v` in place of the trimmed `core` of `text` (the spaces around the English stay around the
 * translation).
 * @param {string} text
 * @param {string} core
 * @param {string} v
 */
function around(text, core, v) {
  if (core === text) return v;
  const at = text.indexOf(core);
  return text.slice(0, at) + v + text.slice(at + core.length);
}

/**
 * The translation of a unit of content prose, by its text key (the key the data holds beside the
 * text, I18N.md §4.2), or the English:
 * 1. in each table of the chain, the unit with `key` whose recorded source is `source` (the
 *    English shown, trimmed);
 * 2. else the English, recorded as a miss: `missing` when no table of the chain holds `key` (a key
 *    minted after the tables were made: a level keyed by the editor, a copy that took a new key —
 *    its unit is not translated yet), `stale` when the key's unit records other English (the line
 *    was edited and needs review).
 * An empty `key` (a text the data holds no key for — a level never keyed with
 * `npm run i18n:keys -- --assign`, an ad-hoc `__game.story.run` line) shows the English too, as a
 * `nokey` miss. Nothing is ever translated by its English. Text with spaces around it keeps them
 * around the translation; anything but a non-empty string comes back as it is.
 *
 * Translate first, then fill values: `interpolate(loc(node.tk, node.text), reader)`,
 * `contentFormat(loc('dlg.shop.bought', 'Obtained: ${name}'), { name })`.
 * @param {string} key the unit's key (a GUID the data holds — `textKeyOf`, a script node's `tk` —,
 *   a banner subtitle's `<GUID>.2`, a code key …)
 * @param {string} source the English, exactly as in the data or the code
 * @param {string} [kind] what it is shown as (`CONTENT_KINDS`) — read by the tools, not here
 * @returns {string}
 */
export function loc(key, source, kind) {
  if (chain.length === 0 || typeof source !== 'string' || source === '') return source;
  const core = source.trim();
  if (!core) return source;
  if (typeof key === 'string' && key) {
    let stale = false;
    for (const t of chain) {
      const u = t.units.get(key);
      if (!u) continue;
      if (u.source === core) return around(source, core, u.target);
      stale = true;
    }
    miss(key, { key, source: core, why: stale ? 'stale' : 'missing' });
    return source;
  }
  miss(`\u0001${core}`, { source: core, why: 'nokey' });
  return source;
}

/**
 * The translation of a name — a villager's, a place's, a level's, an item's, a foe's, a speaker's —
 * by the name itself (its identity: the English, trimmed), or the name. The first table of the
 * chain with the term wins.
 * @param {string} name
 * @returns {string}
 */
export function term(name) {
  if (chain.length === 0 || typeof name !== 'string' || name === '') return name;
  const core = name.trim();
  if (!core) return name;
  for (const t of chain) {
    const v = t.terms.get(core);
    if (v !== undefined) return around(name, core, v);
  }
  miss(`\u0000${core}`, { name: core, source: core, why: 'term' });
  return name;
}

/**
 * Fill `${name}` slots of a code template after translating it (dialogue.js's templates:
 * `contentFormat(loc('dlg.drillmaster.toast', 'Obtained: Healing Draught ×${count}'), { count })`;
 * plain `{word}` stays: it is the gold markup). A slot whose name is not an own key of `params`
 * stays as written (no `params`, or not an object: every slot stays).
 * @param {string} template
 * @param {Record<string, any>|null} [params]
 */
export function contentFormat(template, params) {
  const p = params && typeof params === 'object' ? params : {};
  return String(template).replace(/\$\{([A-Za-z0-9_]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(p, k) ? String(p[k]) : m));
}

/**
 * Install one anonymous table (tests, a page that builds its own): a table's parts, `{ terms?,
 * units? }` (plain objects as in a file: name → translation, key → `{ source, target }`). `null` or
 * nothing to install goes back to English.
 * @param {{ terms?: Record<string, string>, units?: Record<string, ContentUnit> }|null} content
 */
export function setContentTables(content) {
  /** @type {ContentTable|null} */
  let t = null;
  if (isPlain(content)) {
    t = parseContentTable({ format: CONTENT_FORMAT, version: CONTENT_VERSION, terms: content.terms ?? {}, units: content.units ?? {} }).table;
    if (!t.terms.size && !t.units.size) t = null;
  }
  chain = t ? [t] : [];
  chainLang = t ? '' : 'en';
  misses.clear();
  dropped = 0;
}

/**
 * Install a chain of parsed tables (`parseContentTable`), in lookup order: the level's or the
 * campaign's own table first, `common` last. An empty list goes back to English. Forgets the misses.
 * @param {string} lang
 * @param {ContentTable[]} tables
 */
export function installContentTables(lang, tables) {
  chain = (tables ?? []).filter(Boolean);
  chainLang = chain.length ? lang : 'en';
  misses.clear();
  dropped = 0;
  return contentInfo();
}

/** Back to English (nothing translated). */
export function clearContentTables() {
  chain = [];
  chainLang = 'en';
  misses.clear();
  dropped = 0;
}

/** Entries of a table: units + terms. @param {ContentTable} t */
const sizeOf = (t) => t.units.size + t.terms.size;

/**
 * The active chain: its language, its tables in lookup order, how many entries they hold (`strings`:
 * all of them; `units`, `terms`), how many texts were shown untranslated so far (`missCount`;
 * `contentMisses()` lists them) and how many of those did not fit the list (`missDropped`).
 */
export function contentInfo() {
  let n = 0, units = 0, terms = 0;
  for (const t of chain) { n += sizeOf(t); units += t.units.size; terms += t.terms.size; }
  return { lang: chainLang, tables: chain.map((t) => t.id), strings: n, units, terms, missCount: misses.size, missDropped: dropped };
}

/**
 * The texts shown untranslated since the chain was installed (or `clearContentMisses`), in the
 * order met — at most 500, each key or name once. Only a chain of tables records them (English
 * records nothing). The harness's tours read them (`window.__luminati.content.misses`).
 * @returns {ContentMiss[]}
 */
export function contentMisses() {
  return [...misses.values()];
}

/**
 * Run `fn` without recording misses: lookups for text that is not shown now — the glyphs a level
 * preloads, a line a skipped cutscene passes over, a name compared before it is shown. Returns
 * what `fn` returns.
 * @template T
 * @param {() => T} fn
 * @returns {T}
 */
export function quietly(fn) {
  quiet++;
  try { return fn(); } finally { quiet--; }
}

/** Forget the misses recorded so far. */
export function clearContentMisses() {
  misses.clear();
  dropped = 0;
}

/** @param {string} id @param {string} lang @returns {ContentTable} */
const emptyTable = (id, lang) => ({
  id, lang, version: CONTENT_VERSION, extends: [], terms: new Map(), units: new Map(),
});

/**
 * A content table file's JSON → a `ContentTable`, dropping what cannot be used (each with a
 * warning): a translation that is no string or is empty (it would blank the text), a unit that is
 * no `{ source, target }` object, a key or name that is blank or too long, an `extends` entry that
 * is no table id. Reads version 3 (`terms`, `units`; a newer version with a warning, its unknown
 * fields ignored). A file that is no object, or of an older version or of none, is not read: no
 * table, one warning. Never throws.
 * @param {unknown} raw parsed JSON
 * @param {{ id?: string, lang?: string }} [expect] what the index says it is (a mismatch is a warning)
 * @returns {{ table: ContentTable|null, warnings: string[] }} `table`: null when the file is not read
 */
export function parseContentTable(raw, expect = {}) {
  /** @type {string[]} */
  const warnings = [];
  const where = expect.lang && expect.id ? `${expect.lang}/${expect.id}` : (expect.id || 'table');
  if (!isPlain(raw)) return { table: null, warnings: [`${where}: not a JSON object — ignored`] };
  const r = /** @type {Record<string, any>} */ (raw);
  if (!(Number.isInteger(r.version) && r.version >= CONTENT_VERSION)) {
    const said = r.version === undefined ? 'no version' : `version ${typeof r.version === 'string' ? `"${show(r.version)}"` : show(r.version)}`;
    return { table: null, warnings: [`${where}: ${said}: not read — tables are version ${CONTENT_VERSION}`] };
  }
  if (r.format !== CONTENT_FORMAT) warnings.push(`${where}: "format" should be "${CONTENT_FORMAT}"`);
  if (r.version > CONTENT_VERSION) warnings.push(`${where}: version ${r.version} is newer than this engine (${CONTENT_VERSION}): unknown fields are ignored`);
  const lang = typeof r.lang === 'string' ? r.lang : (expect.lang ?? '');
  if (expect.lang && r.lang !== expect.lang) warnings.push(`${where}: "lang" is ${show(r.lang)}, the index lists it under "${expect.lang}"`);
  const id = isTableId(r.source) ? r.source : (expect.id ?? '');
  if (expect.id && r.source !== expect.id) warnings.push(`${where}: "source" is ${show(r.source)}, expected "${expect.id}"`);
  const table = emptyTable(id, lang);
  for (const e of Array.isArray(r.extends) ? r.extends : (r.extends === undefined ? [] : [r.extends])) {
    if (!isTableId(e) || e === 'common') { warnings.push(`${where}: extends ${show(e)} is not a level or campaign table — ignored`); continue; }
    if (e === id) { warnings.push(`${where}: extends itself — ignored`); continue; }
    if (!table.extends.includes(e)) table.extends.push(e);
  }
  let count = 0;
  const full = (what) => {
    if (++count <= MAX_ENTRIES) return false;
    if (count === MAX_ENTRIES + 1) warnings.push(`${where}: ${what}: more than ${MAX_ENTRIES} entries — the rest is ignored`);
    return true;
  };
  /**
   * A translation, or null (with a warning).
   * @param {unknown} v
   * @param {string} what
   */
  const translation = (v, what) => {
    if (typeof v !== 'string') { warnings.push(`${where}: ${what}: the translation is not a string — ignored`); return null; }
    if (!v.trim()) { warnings.push(`${where}: ${what}: an empty translation — ignored (leave the English out instead)`); return null; }
    return v;
  };
  /**
   * Name → translation pairs (`terms`).
   * @param {unknown} obj
   * @param {string} what
   */
  const pairs = (obj, what) => {
    /** @type {Map<string, string>} */
    const m = new Map();
    if (obj === undefined) return m;
    if (!isPlain(obj)) { warnings.push(`${where}: ${what} is not an object — ignored`); return m; }
    for (const k of Object.keys(/** @type {object} */ (obj))) {
      if (full(what)) break;
      if (!k.trim() || k.length > MAX_KEY) { warnings.push(`${where}: ${what}: an empty or too long key "${show(k)}" — ignored`); continue; }
      const v = translation(/** @type {Record<string, unknown>} */ (obj)[k], `${what} "${show(k)}"`);
      if (v !== null) m.set(k.trim(), v);
    }
    return m;
  };
  table.terms = pairs(r.terms, 'terms');
  if (r.units !== undefined && !isPlain(r.units)) warnings.push(`${where}: units is not an object — ignored`);
  else if (r.units) {
    for (const k of Object.keys(r.units)) {
      if (full('units')) break;
      const what = `units "${show(k)}"`;
      if (!k.trim() || k.length > MAX_KEY || k !== k.trim()) { warnings.push(`${where}: ${what}: not a key — ignored`); continue; }
      const u = r.units[k];
      if (!isPlain(u)) { warnings.push(`${where}: ${what}: not a { source, target } object — ignored`); continue; }
      if (typeof u.source !== 'string' || !u.source.trim()) { warnings.push(`${where}: ${what}: the English is not a string — ignored`); continue; }
      const target = translation(u.target, what);
      if (target === null) continue;
      const src = u.source.trim();
      /** @type {ContentUnit} */
      const unit = { source: src, target };
      if (typeof u.note === 'string' && u.note) unit.note = u.note;
      table.units.set(k, unit);
    }
  }
  return { table, warnings };
}

/**
 * `public/i18n/index.json` → language → the table ids listed for it. Never throws; English and
 * anything unusable are dropped with a warning.
 * @param {unknown} raw
 * @returns {{ languages: Map<string, Set<string>>, warnings: string[] }}
 */
export function parseContentIndex(raw) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Map<string, Set<string>>} */
  const languages = new Map();
  const r = isPlain(raw) ? /** @type {Record<string, any>} */ (raw) : {};
  if (!isPlain(raw)) { warnings.push('index: not a JSON object'); return { languages, warnings }; }
  if (r.format !== CONTENT_INDEX_FORMAT) warnings.push(`index: "format" should be "${CONTENT_INDEX_FORMAT}"`);
  if (Number.isInteger(r.version) && r.version > CONTENT_INDEX_VERSION) warnings.push(`index: version ${r.version} is newer than this engine (${CONTENT_INDEX_VERSION})`);
  if (!isPlain(r.languages)) { warnings.push('index: "languages" is not an object'); return { languages, warnings }; }
  for (const lang of Object.keys(r.languages)) {
    if (!LANG_CODE.test(lang) || lang === 'en') { warnings.push(`index: "${show(lang)}" is not a translated language code — ignored`); continue; }
    const e = r.languages[lang];
    const list = isPlain(e) && Array.isArray(e.tables) ? e.tables : null;
    if (!list) { warnings.push(`index: ${lang}: "tables" is not a list — ignored`); continue; }
    const set = new Set();
    for (const id of list) {
      if (!isTableId(id)) { warnings.push(`index: ${lang}: ${show(id)} is not a table id — ignored`); continue; }
      set.add(id);
    }
    languages.set(lang, set);
  }
  return { languages, warnings };
}

/** File names Windows reserves (LevelStorage.slugify gives them a `-level` suffix). */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/**
 * A level name or `?level=` value → its file slug, as LevelStorage.slugify makes it for a name with
 * Latin letters or digits ("Emberfall" → "emberfall"); '' for a name without (LevelStorage gives
 * those a hashed name: pass the loaded level's `source` instead).
 * @param {string} name
 */
function slugOf(name) {
  const s = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s && RESERVED.test(s) ? `${s}-level` : s;
}

/**
 * The table ids a page asks for, and what could not name one.
 * @param {{ level?: string|null, source?: string|null, campaign?: string|null, tables?: unknown }} o
 */
function tableRequest({ level = null, source = null, campaign = null, tables = null } = {}) {
  /** @type {string[]} */
  const ids = [];
  /** @type {string[]} */
  const dropped = [];
  const q = (v) => (typeof v === 'string' ? `"${show(v)}"` : show(v));
  const add = (id, what) => {
    if (!isTableId(id) || id === 'common') { if (what) dropped.push(what); return; }
    if (!ids.includes(id)) ids.push(id);
  };
  if (typeof campaign === 'string' && campaign) add(`campaigns/${slugOf(campaign)}`, `campaign ${q(campaign)}`);
  else if (typeof source === 'string' && source) {
    // the loaded level's source: `levels/<slug>.json` names a table, `local:<slot>` none
    const m = /^levels\/([^/]+)\.json$/.exec(source);
    if (m) add(`levels/${m[1]}`, `source ${q(source)}`);
  } else if (typeof level === 'string' && level && !level.startsWith('local:')) {
    add(`levels/${slugOf(level.replace(/\.json$/i, ''))}`, `level ${q(level)}`);
  }
  for (const id of Array.isArray(tables) ? tables : []) add(id, `table ${q(id)}`);
  return { ids, dropped };
}

/**
 * The table ids a page asks for, in lookup order; `common` is always added last by the loader.
 * - `campaign: 'ferrymans-lantern'` → `campaigns/ferrymans-lantern`. With a campaign, `level` and
 *   `source` are ignored: the campaign's table holds every level file of it (`level=` there is the
 *   start level), and a shipped level it builds on comes in through its `extends`.
 * - Else `source`, the loaded level's (`levels/emberfall.json` → `levels/emberfall`; `local:<slot>`:
 *   none), else `level`, the `?level=` value, slugified as LevelStorage does (`Emberfall` →
 *   `levels/emberfall`; `local:…`: none).
 * - `tables`: any given as they are (a play-test's `&i18n=levels/<name>`).
 * What is no table id is left out (`loadContentTables` warns about it).
 * @param {{ level?: string|null, source?: string|null, campaign?: string|null, tables?: string[]|null }} [o]
 * @returns {string[]}
 */
export function contentTableIds(o = {}) {
  return tableRequest(o).ids;
}

/** The page's base URL (Vite's `BASE_URL`; '/' in Node and outside Vite). */
const baseUrl = () => {
  try { return import.meta.env?.BASE_URL ?? '/'; } catch { return '/'; }
};

/** The index per reader (one fetch per page load). @type {WeakMap<Function, Promise<unknown>>} */
const indexCache = new WeakMap();

/**
 * Load the content tables of `lang` for a level or a campaign and install them (`loc` and `term`
 * translate from then on). English loads and fetches nothing. Reads `index.json`, then only the tables it lists for
 * `lang`: the requested ones, the tables they `extend` (followed up to 4 deep) and `common`; a table
 * not listed is never fetched (the dev server would answer it with index.html). Never throws — what
 * cannot be read (a missing file, no JSON, a table that is not version 3) is skipped with a warning
 * and stays English.
 *
 * In the browser the files come through `fetch` from `<BASE_URL>i18n/`; Node tools and tests pass
 * `read(path)` (a path under `public/i18n/`, e.g. `ja/common.json` → the parsed JSON, or null when
 * missing) or their own `fetch`.
 * @param {string} lang 'en' | 'ja' | 'zh' …
 * @param {{ level?: string|null, source?: string|null, campaign?: string|null, tables?: string[]|null,
 *   fetch?: (url: string, init?: object) => Promise<{ ok: boolean, json(): Promise<unknown> }>,
 *   read?: (path: string) => unknown, base?: string, install?: boolean }} [o]
 *   `campaign` / `source` / `level` / `tables`: the tables asked for (`contentTableIds`); `base`: the
 *   folder URL holding `index.json` (default `<BASE_URL>i18n/`); `install: false` returns the tables
 *   without installing them (the checker)
 * @returns {Promise<ContentLoad & { chain: ContentTable[] }>}
 */
export async function loadContentTables(lang, o = {}) {
  /** @type {string[]} */
  const warnings = [];
  const install = o.install !== false;
  const done = (/** @type {ContentTable[]} */ tables) => {
    if (install) installContentTables(lang, tables);
    let n = 0;
    for (const t of tables) n += sizeOf(t);
    return { lang, tables: tables.map((t) => t.id), strings: n, warnings, chain: tables };
  };
  if (typeof lang !== 'string' || !LANG_CODE.test(lang) || lang === 'en') return done([]);
  const base = o.base ?? `${baseUrl()}i18n/`;
  const fetchFn = o.fetch ?? (typeof fetch === 'function' ? fetch : null);
  /** @type {(path: string) => Promise<unknown>} the parsed JSON of `path`, or null */
  const read = o.read
    ? async (path) => { try { return await o.read(path); } catch (e) { warnings.push(`${path}: ${e?.message ?? e}`); return null; } }
    : async (path) => {
      if (!fetchFn) { warnings.push(`${path}: no fetch here`); return null; }
      try {
        const r = await fetchFn(`${base}${path}`, { cache: 'no-cache' });
        if (!r.ok) { warnings.push(`${path}: not found`); return null; }
        return await r.json();
      } catch (e) {
        warnings.push(`${path}: ${e?.message ?? e}`);
        return null;
      }
    };
  // (one index per reader and page load: a campaign's travel loads no second copy)
  const key = o.read ?? fetchFn;
  let indexP = key && !o.base ? indexCache.get(key) : undefined;
  if (!indexP) {
    indexP = read('index.json');
    if (key && !o.base) indexCache.set(key, indexP);
  }
  const rawIndex = await indexP;
  if (rawIndex == null) return done([]);
  const index = parseContentIndex(rawIndex);
  warnings.push(...index.warnings);
  const listed = index.languages.get(lang);
  if (!listed || !listed.size) return done([]);

  /** @type {Map<string, Promise<ContentTable|null>>} */
  const pending = new Map();
  const get = (id) => {
    let p = pending.get(id);
    if (!p) {
      p = read(`${lang}/${id}.json`).then((raw) => {
        if (raw == null) return null;
        const { table, warnings: w } = parseContentTable(raw, { id, lang });
        warnings.push(...w);
        return table;
      });
      pending.set(id, p);
    }
    return p;
  };
  const { ids: asked, dropped } = tableRequest(o);
  for (const d of dropped) warnings.push(`${d} names no table (common, levels/<slug>, campaigns/<slug>) — only common is looked up for it`);
  for (const id of asked) if (!listed.has(id)) warnings.push(`${lang}/${id}: not in the index — stays English`);
  // (the asked tables and common in parallel; their extends after them)
  const roots = asked.filter((id) => listed.has(id));
  if (listed.has('common')) get('common');
  /** @type {ContentTable[]} */
  const out = [];
  const seen = new Set();
  const walk = async (id, depth) => {
    if (seen.has(id) || depth > MAX_EXTENDS_DEPTH) return;
    seen.add(id);
    const t = await get(id);
    if (!t) return;
    out.push(t);
    for (const e of t.extends) {
      if (!listed.has(e)) { warnings.push(`${lang}/${id}: extends ${e}, which the index does not list — skipped`); continue; }
      await walk(e, depth + 1);
    }
  };
  for (const id of roots) get(id);
  for (const id of roots) await walk(id, 0);
  if (listed.has('common') && !seen.has('common')) {
    const c = await get('common');
    if (c) out.push(c);
  }
  return done(out);
}
