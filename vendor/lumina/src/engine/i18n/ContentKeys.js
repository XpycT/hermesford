/**
 * Content text keys (docs/specs/I18N.md §4.2): every unit of content prose a player reads carries a
 * **text key** in the data — a GUID, as Unreal's FText keys: 32 hex digits, made when the text is
 * made (the editor, a generator, `npm run i18n:keys`) and kept through every edit, so inserting a
 * page, reordering lines or renaming an object never moves a translation. A table's unit records the
 * English its translation was made from: editing the English keeps the key and shows the English
 * until the translation is reviewed.
 *
 * Where the keys live (`textKeys`, a side field mirroring the translatable fields beside it):
 *
 *     level object   "textKeys": { "text": [G, null, G], "dialogue": [G, { "key": G, "choices": [G, G] }],
 *                                  "title": G, "sub": G, "banner": G, "label": G, "locked": [G] }
 *     level root     "textKeys": { "subtitle": G, "title.title": G, "title.subtitle": G, … }
 *     campaign.json  "textKeys": { "subtitle": G, "title.title": G, … }; each chapter { "title": G, "subtitle": G }
 *     story file     item "textKeys": { "text": G }; quest { "text": G, "stages": { <stage id>: G }, "goals": [G] }
 *     scripts        a trailing tag on each line with text: `- Ah, a traveller. #line:9F2A…`
 *                    (npc `talk`, event `run`, story scripts, .story files; a banner's subtitle is `<G>.2`)
 *
 * - A list's keys run parallel to the raw list (`null` where an entry is blank or no text); a
 *   dialogue page with choices has `{ key, choices }`.
 * - A key identifies one English text. Two copies of a line (a chapter variant and its base, a
 *   campaign's copy of a shipped level) share a key while their English is the same — so they share
 *   one translation — and the copy whose English changes gets a new key (`npm run i18n:keys`).
 * - Names are not keyed: a name is an identity in this engine (scripts match villagers by it, saves
 *   keep it, `level.name` seeds the terrain), translated as a **term** (`term(name)`).
 * - Code text has hand-written code keys beside its English: `loc('dlg.elder.welcome', 'Ah, …')`.
 *
 * Import-free and Node-safe: the game, the editor, the generators and the tools import it. Readers
 * take untrusted data (a level file): they read own keys only and accept only well-formed keys.
 */

/** A text key: 32 upper-case hex digits (Unreal's GUID, `EGuidFormats::Digits`). */
const GUID = /^[0-9A-F]{32}$/;
/** The tag that carries a script line's key: `#line:<GUID>` at the end of the line. */
export const LINE_TAG = '#line:';
/** Length of a tag: `#line:` and 32 digits. */
const TAG_LEN = LINE_TAG.length + 32;

/** Is `s` a text key (a GUID)? @param {unknown} s @returns {s is string} */
export function isGuid(s) {
  return typeof s === 'string' && s.length === 32 && GUID.test(s);
}

/** 32 hex digits of either case (a key written by hand, or by a tool that writes lower case). */
const ANY_CASE_GUID = /^[0-9A-Fa-f]{32}$/;

/**
 * A key as it is written: 32 hex digits of either case give the GUID in upper case (Unreal reads
 * GUIDs case-insensitively; so do `splitLineTag` and the cleaners); anything else gives ''.
 * @param {unknown} s
 * @returns {string}
 */
export function toGuid(s) {
  if (typeof s !== 'string' || s.length !== 32) return '';
  if (GUID.test(s)) return s;
  return ANY_CASE_GUID.test(s) ? s.toUpperCase() : '';
}

/**
 * Is `k` a key `loc` can look up: a GUID, a banner subtitle's `<GUID>.2`, or a code key
 * (`dlg.elder.welcome`)?
 * @param {unknown} k
 * @returns {k is string}
 */
export function isTextKey(k) {
  if (typeof k !== 'string') return false;
  if (k.length === 34 && k.endsWith('.2')) return isGuid(k.slice(0, 32));
  return isGuid(k) || isCodeKey(k);
}

/** The key of a banner's subtitle, from its line's key: `<GUID>.2`. @param {string} key */
export function subtitleKey(key) {
  return isGuid(key) ? `${key}.2` : '';
}

/** 16 bytes → a GUID. @param {ArrayLike<number>} b */
const hex = (b) => Array.from(b, (x) => (x & 255).toString(16).toUpperCase().padStart(2, '0')).join('');

/**
 * A new random GUID (the editor, `npm run i18n:keys` for a level of no generator). Uses the Web
 * Crypto random source (browsers and Node), never `Math.random`.
 * @returns {string}
 */
export function randomGuid() {
  const c = /** @type {{ getRandomValues?: (a: Uint8Array) => Uint8Array }|undefined} */ (globalThis.crypto);
  if (!c?.getRandomValues) throw new Error('randomGuid: no crypto.getRandomValues here');
  return hex(c.getRandomValues(new Uint8Array(16)));
}

/**
 * A GUID derived from `seed` (the generators: the same seed always gives the same key, so a
 * generator's output stays byte for byte). A 128-bit hash (cyrb128), not cryptographic — seeds are
 * our own and unique per text.
 * @param {string} seed
 * @returns {string}
 */
export function guidOf(seed) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).toUpperCase().padStart(8, '0')).join('');
}

/** A code key: lower case, at least two dot-separated parts, no colon (`dlg.elder.welcome`). */
const CODE_KEY = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

/** Is `k` a code key (`dlg.elder.welcome`)? @param {unknown} k @returns {k is string} */
export function isCodeKey(k) {
  return typeof k === 'string' && k.length <= 120 && CODE_KEY.test(k);
}

// =================================================================================================
// Script line tags
// =================================================================================================

/** Is `c` a hex digit (either case: a tag is read case-insensitively)? @param {number} c a char code */
const isHexCode = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

/**
 * A script line split into its text and its key tag: a line ending in white space, `#line:` and a
 * GUID (32 hex digits; lower case is read too and comes back in upper case) gives `{ text: the rest
 * (trimmed at the end), tag: the GUID }`; any other line `{ text: line, tag: '' }` (a tag-only line
 * is `{ text: '', tag }`). A fixed-width check, no pattern: a hostile line parses in linear time
 * (StoryScript.js's promise). A line whose text still holds `#line:` after the split (a malformed
 * tag, a second tag) is a parse error of its script (`parseScript`): never shown to a player.
 * @param {string} line
 * @returns {{ text: string, tag: string }}
 */
export function splitLineTag(line) {
  let end = line.length;
  while (end > 0 && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9 || line.charCodeAt(end - 1) === 13)) end--;
  const at = end - TAG_LEN;
  if (at < 0 || line.slice(at, at + LINE_TAG.length) !== LINE_TAG) return { text: line, tag: '' };
  for (let i = at + LINE_TAG.length; i < end; i++) if (!isHexCode(line.charCodeAt(i))) return { text: line, tag: '' };
  if (at > 0 && line.charCodeAt(at - 1) !== 32 && line.charCodeAt(at - 1) !== 9) return { text: line, tag: '' };
  return { text: line.slice(0, at).trimEnd(), tag: line.slice(at + LINE_TAG.length, end).toUpperCase() };
}

/**
 * A script line with `key` as its tag, written after the line's text with its trailing white space
 * (a carriage return too) cut: any tag it had is replaced. A key of lower-case digits is written in
 * upper case; '' (or anything that is no GUID) removes the tag — a line without one comes back as it
 * is.
 * @param {string} line
 * @param {string} key a GUID, or '' for none
 */
export function tagLine(line, key) {
  const { text, tag } = splitLineTag(line);
  const k = toGuid(key);
  if (k) return `${text.trimEnd()} ${LINE_TAG}${k}`;
  return tag ? text : line;
}

// =================================================================================================
// Where the keys live
// =================================================================================================

/**
 * The translatable fields of each object type and how their keys are held (names — a villager's,
 * a place's, a sign's speaker, an item's, a foe's, a waystone's — are terms, not keyed):
 * - `text`: one string → one key;
 * - `lines`: a list of pages (or one string) → a key per raw entry (`textPages`);
 * - `dialogue`: a villager's pages → a key, or `{ key, choices }`, per raw page (`dialogueUnits`);
 * - `script`: a script field → tags on its lines (no `textKeys` entry).
 * An exit's or event's `label` that is a built-in verb (`builtinLabel`) is a UI string: no key.
 */
export const TEXT_KEY_FIELDS = Object.freeze({
  house: Object.freeze({ text: 'lines' }),
  well: Object.freeze({ text: 'lines' }),
  signpost: Object.freeze({ text: 'lines' }),
  npc: Object.freeze({ title: 'text', dialogue: 'dialogue', talk: 'script' }),
  region: Object.freeze({ sub: 'text', banner: 'text' }),
  exit: Object.freeze({ label: 'text', locked: 'lines' }),
  event: Object.freeze({ label: 'text', run: 'script' }),
});

/** The keyed texts of a level's root (`textKeys` at the level's top; `title.*`: `environment.title`). */
export const LEVEL_TEXT_FIELDS = Object.freeze(['subtitle', 'title.title', 'title.subtitle', 'title.prompt', 'title.credit']);
/** The keyed texts of a campaign file's root (`title.*`: its `title` overrides). */
export const CAMPAIGN_TEXT_FIELDS = LEVEL_TEXT_FIELDS;
/** The keyed texts of a chapter. */
export const CHAPTER_TEXT_FIELDS = Object.freeze(['title', 'subtitle']);

const isPlainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Own value `k` of `o` (undefined for an inherited or missing one). */
const own = (o, k) => (isPlainObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
/** The holder's `textKeys` map, or undefined. @param {unknown} holder */
const keysOf = (holder) => {
  const k = own(holder, 'textKeys');
  return isPlainObj(k) ? k : undefined;
};

/**
 * The key of a one-string field (`title`, `sub`, `banner`, `label`; a root's `subtitle` /
 * `title.title` …; a chapter's `title`; an item's or quest's `text`), or ''.
 * @param {unknown} holder a level object, a level, a campaign, a chapter, a story item or quest
 * @param {string} field
 * @returns {string}
 */
export function textKeyOf(holder, field) {
  const k = own(keysOf(holder), field);
  return isGuid(k) ? k : '';
}

/**
 * The key of page `i` (the raw index, `textPages`) of a `lines` field, or ''.
 * @param {unknown} holder
 * @param {string} field `text`, `locked`
 * @param {number} i
 * @returns {string}
 */
export function pageKeyOf(holder, field, i) {
  const list = own(keysOf(holder), field);
  const k = Array.isArray(list) ? list[i] : undefined;
  return isGuid(k) ? k : '';
}

/**
 * The key of a villager's dialogue page `i` (the raw index, `dialogueUnits`), or ''.
 * @param {unknown} holder
 * @param {number} i
 * @returns {string}
 */
export function dialogueKeyOf(holder, i) {
  const list = own(keysOf(holder), 'dialogue');
  const e = Array.isArray(list) ? list[i] : undefined;
  const k = isPlainObj(e) ? own(e, 'key') : e;
  return isGuid(k) ? k : '';
}

/**
 * The key of choice `j` of a villager's dialogue page `i` (raw indices, `dialogueUnits`), or ''.
 * @param {unknown} holder
 * @param {number} i
 * @param {number} j
 * @returns {string}
 */
export function choiceKeyOf(holder, i, j) {
  const list = own(keysOf(holder), 'dialogue');
  const e = Array.isArray(list) ? list[i] : undefined;
  const cs = own(e, 'choices');
  const k = Array.isArray(cs) ? cs[j] : undefined;
  return isGuid(k) ? k : '';
}

/**
 * A quest's keys in a story file: its `text`, a stage's (by stage id) or a goal's (by the goal's
 * raw index in the file), or ''.
 * @param {unknown} quest the quest as written in the file
 * @param {'text'|'stage'|'goal'} what
 * @param {string|number} [at] the stage id, or the goal's raw index
 * @returns {string}
 */
export function questKeyOf(quest, what, at) {
  const keys = keysOf(quest);
  if (what === 'text') return textKeyOf(quest, 'text');
  const part = own(keys, what === 'stage' ? 'stages' : 'goals');
  const k = what === 'stage' ? own(part, String(at)) : Array.isArray(part) ? part[/** @type {number} */ (at)] : undefined;
  return isGuid(k) ? k : '';
}

/** Counted while cleaning: entries dropped, lower-case keys written in upper case. */
let dropped = 0;
let upcased = 0;

/** A key (lower-case digits written in upper case), or null (counting what was not a key). @param {unknown} v */
const keyOrNull = (v) => {
  if (v === null) return null;
  const g = toGuid(v);
  if (g) { if (g !== v) upcased++; return g; }
  dropped++;
  return null;
};

/**
 * A list of keys (`lines`): each entry a key or null; anything else becomes null (counted). Not a
 * list: undefined (counted). `max`: entries past it are dropped (counted).
 * @param {unknown} v
 * @param {number} [max]
 */
function cleanList(v, max = Infinity) {
  if (!Array.isArray(v)) { dropped++; return undefined; }
  if (v.length > max) dropped += v.length - max;
  // (a loop up to the bound: a hostile list of a million entries is never copied whole)
  const out = [];
  for (let i = 0; i < Math.min(v.length, max); i++) out.push(keyOrNull(v[i]));
  return out;
}

/**
 * The number of raw entries a `lines` field's or a dialogue's key list may hold: its raw list's
 * length (a single string or page: 1; nothing: 0).
 * @param {unknown} v the field's value
 * @param {'lines'|'dialogue'} kind
 */
function rawLength(v, kind) {
  if (Array.isArray(v)) return v.length;
  if (v === undefined || v === null) return 0;
  // (as `textPages` / `dialogueUnits` read a field that is no list: one string is one page; one
  // dialogue page of any shape is one entry)
  return kind === 'dialogue' || typeof v === 'string' ? 1 : 0;
}

/**
 * A dialogue's keys: per page a key, `{ key, choices }`, or null. `field`: the dialogue itself (when
 * given, the list and each page's choices are cut to its raw lengths).
 * @param {unknown} v
 * @param {unknown} [field]
 */
function cleanDialogue(v, field) {
  if (!Array.isArray(v)) { dropped++; return undefined; }
  const bounded = field !== undefined;
  const max = bounded ? rawLength(field, 'dialogue') : Infinity;
  if (v.length > max) dropped += v.length - max;
  const pageOf = (i) => (Array.isArray(field) ? field[i] : field);
  const out = [];
  for (let i = 0; i < Math.min(v.length, max); i++) {
    const e = v[i];
    if (!isPlainObj(e)) { out.push(keyOrNull(e)); continue; }
    /** @type {{ key?: string|null, choices?: (string|null)[] }} */
    const page = {};
    for (const k of Object.keys(e)) {
      if (k === 'key') page.key = keyOrNull(e.key);
      else if (k === 'choices') {
        const cs = bounded ? own(pageOf(i), 'choices') : undefined;
        const c = cleanList(e.choices, bounded ? (Array.isArray(cs) ? cs.length : 0) : Infinity);
        if (c) page.choices = c;
      } else dropped++;
    }
    out.push(page);
  }
  return out;
}

/**
 * Clean an untrusted `textKeys` map against the fields it may hold (kind per field: `text`,
 * `lines`, `dialogue`; `script` fields hold no entry): unknown fields, malformed keys and wrong
 * shapes are dropped (a malformed key in a list becomes null); a key of lower-case digits is written
 * in upper case (`upcased`). With the `holder` (the object the keys belong to), the keys are bounded
 * by its fields: a key of a field it does not hold is dropped, a list is cut to its field's raw
 * length (a dialogue page's choices to the page's). Well-formed data comes back equal and in its own
 * key order (files stay byte for byte). Never throws.
 * @param {unknown} raw
 * @param {Record<string, string>} kinds field → kind
 * @param {unknown} [holder] the object holding the keys (bounds them by its fields)
 * @returns {{ keys: Record<string, any>|undefined, dropped: number, upcased: number }} `keys` undefined when nothing is left
 */
export function cleanTextKeys(raw, kinds, holder) {
  dropped = 0;
  upcased = 0;
  if (raw === undefined) return { keys: undefined, dropped: 0, upcased: 0 };
  if (!isPlainObj(raw)) return { keys: undefined, dropped: 1, upcased: 0 };
  const bounded = holder !== undefined;
  /** @type {Record<string, any>} */
  const out = {};
  for (const f of Object.keys(/** @type {object} */ (raw))) {
    const kind = Object.prototype.hasOwnProperty.call(kinds, f) ? kinds[f] : '';
    const v = /** @type {Record<string, unknown>} */ (raw)[f];
    // (bounded: the holder's own value of the field; a key of a field it does not hold is no key)
    const field = bounded ? own(holder, f) : undefined;
    if (bounded && kind && (field === undefined || (kind === 'text' && typeof field !== 'string'))) { dropped += countKeys(v); continue; }
    if (kind === 'text') { const g = toGuid(v); if (g) { if (g !== v) upcased++; out[f] = g; } else dropped++; }
    else if (kind === 'lines') { const l = cleanList(v, bounded ? rawLength(field, 'lines') : Infinity); if (l && (l.length || !bounded)) out[f] = l; }
    else if (kind === 'dialogue') { const d = cleanDialogue(v, bounded ? field : undefined); if (d && (d.length || !bounded)) out[f] = d; }
    else dropped++;
  }
  return { keys: Object.keys(out).length ? out : undefined, dropped, upcased };
}

/** How many entries a `textKeys` value holds (for the count of what was dropped): at least 1. @param {unknown} v */
function countKeys(v) {
  if (!Array.isArray(v)) return 1;
  let n = 0;
  for (const e of v) n += isPlainObj(e) && Array.isArray(own(e, 'choices')) ? 1 + /** @type {unknown[]} */ (own(e, 'choices')).length : 1;
  return Math.max(1, n);
}

/** Kinds of a level root's and a campaign root's keys. */
const ROOT_KINDS = Object.freeze(Object.fromEntries(LEVEL_TEXT_FIELDS.map((f) => [f, 'text'])));
/** Kinds of a chapter's keys. */
const CHAPTER_KINDS = Object.freeze({ title: 'text', subtitle: 'text' });
/** Kinds of a story item's keys. */
const ITEM_KINDS = Object.freeze({ text: 'text' });

/**
 * Clean the `textKeys` of a level object of `type` (`TEXT_KEY_FIELDS`), a level or campaign root
 * (`'root'`), a chapter (`'chapter'`) or a story item (`'item'`). See `cleanTextKeys` (`holder`:
 * the object itself — its keys are then bounded by its fields; `normalizeObject` passes it).
 * @param {string} type an object type, or 'root' | 'chapter' | 'item'
 * @param {unknown} raw
 * @param {unknown} [holder]
 */
export function cleanTextKeysOf(type, raw, holder) {
  const kinds = type === 'root' ? ROOT_KINDS : type === 'chapter' ? CHAPTER_KINDS : type === 'item' ? ITEM_KINDS
    : Object.prototype.hasOwnProperty.call(TEXT_KEY_FIELDS, type) ? TEXT_KEY_FIELDS[/** @type {keyof typeof TEXT_KEY_FIELDS} */ (type)] : {};
  return cleanTextKeys(raw, kinds, holder);
}

/**
 * Clean a story quest's `textKeys`: `text` a key, `stages` stage id → key, `goals` a list (raw
 * goal index). See `cleanTextKeys`.
 * @param {unknown} raw
 * @returns {{ keys: Record<string, any>|undefined, dropped: number, upcased: number }}
 */
export function cleanQuestTextKeys(raw) {
  dropped = 0;
  upcased = 0;
  if (raw === undefined) return { keys: undefined, dropped: 0, upcased: 0 };
  if (!isPlainObj(raw)) return { keys: undefined, dropped: 1, upcased: 0 };
  /** @type {Record<string, any>} */
  const out = {};
  for (const f of Object.keys(/** @type {object} */ (raw))) {
    const v = /** @type {Record<string, unknown>} */ (raw)[f];
    if (f === 'text') { const g = toGuid(v); if (g) { if (g !== v) upcased++; out.text = g; } else dropped++; }
    else if (f === 'goals') { const l = cleanList(v); if (l) out.goals = l; }
    else if (f === 'stages' && isPlainObj(v)) {
      /** @type {Record<string, string>} */
      const st = {};
      for (const id of Object.keys(/** @type {object} */ (v))) {
        const g = toGuid(/** @type {Record<string, unknown>} */ (v)[id]);
        if (g && id !== '__proto__') { if (g !== /** @type {Record<string, unknown>} */ (v)[id]) upcased++; st[id] = g; } else dropped++;
      }
      if (Object.keys(st).length) out.stages = st;
    } else dropped++;
  }
  return { keys: Object.keys(out).length ? out : undefined, dropped, upcased };
}

// =================================================================================================
// Pages
// =================================================================================================

/**
 * The pages a `lines` field shows (a house's, a well's, a sign's `text`; an exit's `locked`): one
 * per entry of an array (or the one string), each with its **raw** index `i`; numbers are shown as
 * text, anything else and blank entries are skipped (their index is not reused).
 * @param {unknown} v
 * @returns {{ i: number, text: string }[]}
 */
export function textPages(v) {
  /** @type {{ i: number, text: string }[]} */
  const out = [];
  const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const s = typeof e === 'string' ? e : typeof e === 'number' && Number.isFinite(e) ? String(e) : null;
    if (s !== null && s.trim()) out.push({ i, text: s });
  }
  return out;
}

/**
 * The pages a villager's `dialogue` shows (dialogue.js): a string page, or `{ text, choices }`
 * whose non-blank choices make it a choice page (a string or a number is a choice; anything else and
 * blank ones are skipped; a page whose choices are all skipped is a plain page). A blank string page
 * and a page without a string `text` are skipped (a `{ text: ' ' }` page is kept, as the game shows
 * it). Each page keeps its raw index `i`, each choice its raw index `j`.
 * @param {unknown} v the field as loaded (a page array; a single page is accepted too)
 * @returns {{ i: number, text: string, choices: { j: number, text: string }[] | null }[]}
 */
export function dialogueUnits(v) {
  /** @type {{ i: number, text: string, choices: { j: number, text: string }[] | null }[]} */
  const out = [];
  const list = Array.isArray(v) ? v : [v];
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (typeof d === 'string') {
      if (d.trim()) out.push({ i, text: d, choices: null });
    } else if (d && typeof d === 'object' && typeof d.text === 'string') {
      /** @type {{ j: number, text: string }[]} */
      const choices = [];
      const cs = Array.isArray(d.choices) ? d.choices : [];
      for (let j = 0; j < cs.length; j++) {
        const e = cs[j];
        const c = typeof e === 'string' ? e : typeof e === 'number' && Number.isFinite(e) ? String(e) : '';
        if (c.trim()) choices.push({ j, text: c });
      }
      out.push({ i, text: d.text, choices: choices.length ? choices : null });
    }
  }
  return out;
}

/**
 * The prompt's built-in verbs, English → the UI string id (`game.prompt.<id>`): World, StoryRunner,
 * CampaignRuntime and the combat's waystones and chests label interactables with these words, and
 * the catalog writes `Enter` into exits. An exit's or event's `label` that is one of them is UI
 * vocabulary, shown with `t()` — not a unit (I18N.md §4.8); any other label is a unit.
 */
export const BUILTIN_LABELS = Object.freeze({ Talk: 'talk', Examine: 'examine', Knock: 'knock', Read: 'read', Look: 'look', Enter: 'enter', Rest: 'rest', Open: 'open' });

/**
 * The built-in verb a label is (`BUILTIN_LABELS`; the label trimmed, exact case), or ''.
 * @param {unknown} label
 * @returns {string}
 */
export function builtinLabel(label) {
  if (typeof label !== 'string') return '';
  const k = label.trim();
  return Object.prototype.hasOwnProperty.call(BUILTIN_LABELS, k) ? BUILTIN_LABELS[/** @type {keyof typeof BUILTIN_LABELS} */ (k)] : '';
}
