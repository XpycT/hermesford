/**
 * A campaign's story files (docs/specs/STORY_SCRIPT.md §5): what the whole story shares across its
 * levels — declared variables, items, quests (named stages, goals), actors (story characters: name,
 * look, talk script), named scripts, campaign-wide events and debug start presets. campaign.json
 * lists them (`"story": ["main.json", "dialogue.story"]`, files in the campaign's `story/` folder):
 *
 *  - `<name>.json` (`format: "luminati-story"`): every section, scripts as arrays of lines;
 *  - `<name>.story`: plain text — scripts only, each after a `== <script-id>` header line (long
 *    dialogue is pleasant to write and to diff this way).
 *
 * Node-safe (no DOM, no three.js): the game, `tools/check-level.mjs --campaign` and the campaign
 * generators import it. Untrusted data like a level: every map is prototype-less, every name is
 * checked (`isStoryName`), sizes are capped, and anything unusable is dropped with a warning.
 */
// (the small condition module, not the script parser: the campaign files load with every campaign)
import { isStoryName, isFlagName, scriptLines, titleCase, eventIdOf, stageIdOf } from '../../engine/level/StoryCondition.js';
import { cleanTextKeysOf, cleanQuestTextKeys } from '../../engine/i18n/ContentKeys.js';
import { CHARACTER_PRESET_NAMES } from '../../engine/level/ObjectCatalog.js';
import { showValue } from '../../engine/utils/own.js';

export const STORY_FORMAT = 'luminati-story';
export const STORY_VERSION = 1;

/** A story file name in campaign.json's `story` list: `story/<name>.json` or `story/<name>.story`. */
const STORY_FILE = /^[a-z0-9][a-z0-9-]{0,59}\.(json|story)$/;
/** Windows device names cannot be files there. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])\./;

/** At most this many entries per section (a hand-written or hostile file cannot grow it unbounded). */
const MAX_ENTRIES = 4096;
/** At most this many story files in campaign.json's `story` list (the rest is ignored, with a warning). */
export const MAX_STORY_FILES = 64;

/** Any value for a message, never throwing (`{"toString": 1}`), at most 80 characters. @param {unknown} v */
const show = (v) => {
  const s = showValue(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
};

/**
 * Is `s` a usable story file name (`main.json`, `dialogue.story`)?
 * @param {unknown} s
 * @returns {s is string}
 */
export function isStoryFileName(s) {
  return typeof s === 'string' && STORY_FILE.test(s) && !RESERVED.test(s);
}

/** The path of a story file inside the campaign folder. @param {string} name a story file name */
export const storyFile = (name) => `story/${name}`;

/**
 * @typedef {{ name: string, text: string, key: boolean, textKey?: string }} StoryItem
 *   key: a key item (the journal lists it apart; `take` never takes it unless named); textKey: its
 *   text's content key (the file's `textKeys.text`, docs/specs/I18N.md §4.2; absent: none)
 * @typedef {{ id: string, text: string, textKey?: string }} QuestStage
 * @typedef {{ text: string, done: string, textKey?: string }} QuestGoal  `done`: a condition as scripts write it (`parseCondition`: `done: gold` reads the purse); the journal ticks the goal while it holds
 * @typedef {{ title: string, text: string, stages: QuestStage[], goals: QuestGoal[], textKey?: string }} StoryQuest
 *   the content keys of its text, stages and goals come from the file's `textKeys` (`text`,
 *   `stages` by stage id, `goals` by the goal's raw index): each built stage and goal carries its own
 * @typedef {{ name: string, preset: string, portraitColor: string, talk: string, spec?: Record<string, any> }} StoryActor
 *   talk: the id of the script it says when talked to ('' = none: the villager's own dialogue);
 *   spec: sheet fields merged over the preset for its portrait (as a villager's `spec`: plain JSON,
 *   copied, at most 4 deep and 64 keys a level; absent: the preset's look)
 * @typedef {{ id: string, on: 'change'|'arrive', if: string, once: boolean, level: string, run: string, background: boolean }} StoryEvent
 *   run: a script id; level: `arrive` only in that level ('' = any; always '' for `change`); if: a
 *   condition as scripts write it (`parseCondition`: `if: gold` reads the purse); background: a
 *   background run (the file's `background: true`; anything else is false) — it holds no one and
 *   may use only `BACKGROUND_OPS` (StoryScript.js; the campaign check follows its `call`s)
 * @typedef {{ level: string, entrance: string, vars: Record<string, number>, items: Record<string, number>,
 *   quests: Record<string, string>, gold: number, progress?: { level: number, potions?: number } }} StoryStart
 *   a debug start preset (`&story=<name>`): where a new game begins and what it already has; quests:
 *   quest id → stage id ('done' / 'failed' for the end states); progress: the player's combat level
 *   (1–10) and draughts (0–5) on that new game (absent: the campaign's `progress`)
 */

/**
 * The merged story of a campaign (every story file; prototype-less maps).
 * @typedef {object} Story
 * @property {Record<string, number>} vars      declared variables / flags and their start values
 * @property {Record<string, StoryItem>} items
 * @property {Record<string, StoryQuest>} quests
 * @property {Record<string, StoryActor>} actors
 * @property {Record<string, { lines: string[], file: string, line: number }>} scripts
 *   named scripts; `line`: where the script starts in its file (1-based, for messages)
 * @property {StoryEvent[]} events
 * @property {Record<string, StoryStart>} starts
 */

/** Prototype keys a copied spec never takes (untrusted data). */
const UNSAFE_SPEC_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * A copy of plain JSON data (a story actor's `spec`), at most 4 deep and 64 keys a level; anything
 * else left out (undefined for a value that is none of these) — as campaign.json's `player.spec`.
 * @param {unknown} v
 * @param {number} depth
 * @returns {any}
 */
function specCopy(v, depth) {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (depth >= 4) return undefined;
  if (Array.isArray(v)) return v.slice(0, 64).map((x) => specCopy(x, depth + 1)).filter((x) => x !== undefined);
  if (!isPlain(v)) return undefined;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, x] of Object.entries(/** @type {object} */ (v)).slice(0, 64)) {
    if (UNSAFE_SPEC_KEYS.has(k)) continue;
    const c = specCopy(x, depth + 1);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

/** @returns {Story} */
export function emptyStory() {
  return {
    vars: Object.create(null), items: Object.create(null), quests: Object.create(null), actors: Object.create(null),
    scripts: Object.create(null), events: [], starts: Object.create(null),
  };
}

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v : '');

// (`eventIdOf` / `stageIdOf`: an event's and a stage's id as the loader and the text keys read them —
// defined in the engine's StoryCondition.js, so TextKeys.js never imports the game; re-exported here)
export { eventIdOf, stageIdOf };
const finite = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** Own entries of a plain object (at most MAX_ENTRIES). */
const entries = (v) => (isPlain(v) ? Object.entries(v).slice(0, MAX_ENTRIES) : []);

/**
 * Add one parsed story file to `story` (later files may not redeclare a name: the first wins, with
 * a warning). `file`: its name, for messages.
 * @param {Story} story
 * @param {unknown} raw parsed JSON of a `.json` story file
 * @param {string} file
 * @param {string[]} warnings
 */
export function addStoryJSON(story, raw, file, warnings) {
  const where = (s) => `${file}: ${s}`;
  if (!isPlain(raw)) { warnings.push(where('not a JSON object — ignored')); return; }
  const r = /** @type {Record<string, any>} */ (raw);
  if (r.format !== STORY_FORMAT) warnings.push(where(`"format" should be "${STORY_FORMAT}"`));
  if (Number.isInteger(r.version) && r.version > STORY_VERSION) warnings.push(where(`version ${r.version} is newer than this engine (${STORY_VERSION}): unknown fields are ignored`));
  const dup = (map, id, what) => {
    if (Object.hasOwn(map, id)) { warnings.push(where(`${what} "${id}" is declared twice — the first is kept`)); return true; }
    return false;
  };
  for (const [id, v] of entries(r.vars)) {
    if (!isFlagName(id)) { warnings.push(where(`vars: "${id}" is not a flag / variable name — dropped`)); continue; }
    if (dup(story.vars, id, 'variable')) continue;
    const n = typeof v === 'boolean' ? Number(v) : finite(v, NaN);
    if (!Number.isFinite(n) || Math.abs(n) > 1e9) { warnings.push(where(`vars: "${id}" must start as a number (or true / false) — 0 used`)); story.vars[id] = 0; continue; }
    story.vars[id] = n;
  }
  for (const [id, v] of entries(r.items)) {
    if (!isStoryName(id) || id === 'gold') { warnings.push(where(`items: "${id}" is not an item id${id === 'gold' ? ' (gold is built in)' : ''} — dropped`)); continue; }
    if (dup(story.items, id, 'item')) continue;
    const o = isPlain(v) ? v : { name: v };
    const ik = cleanTextKeysOf('item', o.textKeys);
    if (ik.dropped) warnings.push(where(`item "${id}": ${ik.dropped} malformed or unknown text key(s) dropped`));
    story.items[id] = { name: text(o.name).trim() || titleCase(id), text: text(o.text), key: o.key === true, ...(ik.keys?.text ? { textKey: ik.keys.text } : {}) };
  }
  for (const [id, v] of entries(r.quests)) {
    if (!isStoryName(id)) { warnings.push(where(`quests: "${id}" is not a quest id — dropped`)); continue; }
    if (dup(story.quests, id, 'quest')) continue;
    const o = isPlain(v) ? v : {};
    const qk = cleanQuestTextKeys(o.textKeys);
    if (qk.dropped) warnings.push(where(`quest "${id}": ${qk.dropped} malformed or unknown text key(s) dropped`));
    /** @type {QuestStage[]} */
    const stages = [];
    for (const [k, s] of (Array.isArray(o.stages) ? o.stages : []).slice(0, 256).entries()) {
      const st = isPlain(s) ? s : { id: `${k + 1}`, text: s };
      const sid = stageIdOf(s, k);
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(sid)) { warnings.push(where(`quest "${id}": stage "${sid}" is not a stage name — dropped`)); continue; }
      if (stages.some((x) => x.id === sid)) { warnings.push(where(`quest "${id}": stage "${sid}" is listed twice — the second dropped`)); continue; }
      const sk = qk.keys?.stages && Object.hasOwn(qk.keys.stages, sid) ? qk.keys.stages[sid] : '';
      stages.push({ id: sid, text: text(st.text), ...(sk ? { textKey: sk } : {}) });
    }
    /** @type {QuestGoal[]} */
    const goals = [];
    for (const [k, g] of (Array.isArray(o.goals) ? o.goals : []).slice(0, 64).entries()) {
      if (!isPlain(g) || !text(g.text)) continue;
      const gk = Array.isArray(qk.keys?.goals) ? qk.keys.goals[k] : null;
      goals.push({ text: text(g.text), done: text(g.done), ...(gk ? { textKey: gk } : {}) });
    }
    story.quests[id] = { title: text(o.title).trim() || titleCase(id), text: text(o.text), stages, goals, ...(qk.keys?.text ? { textKey: qk.keys.text } : {}) };
  }
  for (const [id, v] of entries(r.scripts)) {
    if (!isStoryName(id)) { warnings.push(where(`scripts: "${id}" is not a script id — dropped`)); continue; }
    if (dup(story.scripts, id, 'script')) continue;
    story.scripts[id] = { lines: scriptLines(v), file, line: 1 };
  }
  for (const [id, v] of entries(r.actors)) {
    if (!isStoryName(id)) { warnings.push(where(`actors: "${id}" is not an actor id — dropped`)); continue; }
    if (dup(story.actors, id, 'actor')) continue;
    const o = isPlain(v) ? v : {};
    let talk = '';
    if (Array.isArray(o.talk)) {
      // inline lines: kept as the script `actor.<id>` (a `== actor.<id>` script read before wins)
      talk = `actor.${id}`;
      if (!Object.hasOwn(story.scripts, talk)) story.scripts[talk] = { lines: scriptLines(o.talk), file, line: 1 };
      else warnings.push(where(`actor "${id}": its inline talk is the script "${talk}", which is declared twice (also in ${story.scripts[talk].file}) — the first is kept, these lines are ignored`));
    } else if (typeof o.talk === 'string' && o.talk.trim()) {
      if (isStoryName(o.talk.trim())) talk = o.talk.trim();
      else warnings.push(where(`actor "${id}": talk "${o.talk}" is not a script id — ignored`));
    }
    const preset = text(o.preset);
    story.actors[id] = {
      name: text(o.name).trim() || titleCase(id),
      preset: CHARACTER_PRESET_NAMES.includes(preset) ? preset : '',
      portraitColor: /^#[0-9a-fA-F]{3,8}$/.test(text(o.portraitColor)) ? text(o.portraitColor) : '',
      talk,
    };
    if (o.spec !== undefined) {
      const spec = isPlain(o.spec) ? specCopy(o.spec, 0) : undefined;
      if (spec && Object.keys(spec).length) story.actors[id].spec = spec;
      else warnings.push(where(`actor "${id}": "spec" must be an object of sheet fields (as a villager's spec) — ignored`));
    }
    if (preset && !story.actors[id].preset) warnings.push(where(`actor "${id}": "${preset}" is not a character look — ignored`));
  }
  // (the ids so far, of every file: a Set, so a file of many events stays linear)
  const eventIds = new Set(story.events.map((x) => x.id));
  for (const [k, e] of (Array.isArray(r.events) ? r.events : []).slice(0, MAX_ENTRIES).entries()) {
    if (!isPlain(e)) { warnings.push(where(`events[${k}] is not an object — dropped`)); continue; }
    const id = eventIdOf(e, k);
    if (!isStoryName(id)) { warnings.push(where(`events[${k}]: "${id}" is not an event id — dropped`)); continue; }
    if (eventIds.has(id)) { warnings.push(where(`event "${id}" is declared twice — the second dropped`)); continue; }
    const on = e.on === 'arrive' ? 'arrive' : 'change';
    if (e.on !== on) warnings.push(where(`event "${id}": "on" must be "change" or "arrive" — "change" used`));
    let run = '';
    if (Array.isArray(e.run)) {
      // inline lines: kept as the script `event.<id>` (a `== event.<id>` script read before wins)
      run = `event.${id}`;
      if (!Object.hasOwn(story.scripts, run)) story.scripts[run] = { lines: scriptLines(e.run), file, line: 1 };
      else warnings.push(where(`event "${id}": its inline run is the script "${run}", which is declared twice (also in ${story.scripts[run].file}) — the first is kept, these lines are ignored`));
    } else if (isStoryName(text(e.run).trim())) run = text(e.run).trim();
    else { warnings.push(where(`event "${id}": "run" names no script — dropped`)); continue; }
    // `level`: an `arrive` event's level ('' any); a `change` event watches its condition everywhere
    let level = '';
    if (e.level !== undefined && e.level !== '') {
      if (!isStoryName(e.level)) warnings.push(where(`event "${id}": level "${show(e.level)}" is not a level id — ignored`));
      else if (on !== 'arrive') warnings.push(where(`event "${id}": "level" applies to "arrive" events only — a "change" event watches its condition in every level; ignored`));
      else level = e.level;
    }
    if (e.background !== undefined && typeof e.background !== 'boolean') warnings.push(where(`event "${id}": "background" must be true or false — false used`));
    eventIds.add(id);
    story.events.push({ id, on, if: text(e.if).trim(), once: e.once === true, level, run, background: e.background === true });
  }
  for (const [name, v] of entries(r.starts)) {
    if (!isStoryName(name) || !isPlain(v)) { warnings.push(where(`starts: "${name}" is not a start preset — dropped`)); continue; }
    if (dup(story.starts, name, 'start preset')) continue;
    const nums = (m, ok) => {
      const out = Object.create(null);
      for (const [k, n] of entries(m)) if (ok(k) && Number.isFinite(typeof n === 'boolean' ? Number(n) : n)) out[k] = typeof n === 'boolean' ? Number(n) : n;
      return out;
    };
    const quests = Object.create(null);
    for (const [q, st] of entries(v.quests)) if (isStoryName(q) && typeof st === 'string') quests[q] = st;
    story.starts[name] = {
      level: isStoryName(v.level) ? v.level : '', entrance: text(v.entrance),
      vars: nums(v.vars, isFlagName), items: nums(v.items, (k) => isStoryName(k) && k !== 'gold'), quests,
      gold: Math.max(0, Math.floor(finite(v.gold, 0))),
    };
    // (the player's combat level and draughts on that new game — a preset deep in the story starts
    // at the level the journey reaches there)
    if (v.progress !== undefined) {
      const pr = isPlain(v.progress) ? /** @type {Record<string, unknown>} */ (v.progress) : null;
      const lv = pr ? Math.round(finite(pr.level, NaN)) : NaN;
      if (Number.isFinite(lv) && lv >= 1 && lv <= 10) {
        const pot = Math.round(finite(pr?.potions, NaN));
        story.starts[name].progress = Number.isFinite(pot) ? { level: lv, potions: Math.min(5, Math.max(0, pot)) } : { level: lv };
      } else warnings.push(where(`starts: "${name}": "progress" must be { level: 1–10, potions?: 0–5 } — ignored`));
    }
  }
}

/**
 * Add one `.story` text file: each script starts at a `== <script-id>` header line and runs to the
 * next header (lines before the first header must be blank or comments).
 * @param {Story} story
 * @param {string} src
 * @param {string} file
 * @param {string[]} warnings
 */
export function addStoryText(story, src, file, warnings) {
  const lines = String(src).split(/\r?\n/);
  let cur = null;
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    const h = /^==\s*(\S+)\s*$/.exec(l);
    if (h) {
      const id = h[1];
      if (!isStoryName(id)) { warnings.push(`${file}:${k + 1}: "${id}" is not a script id — its lines are ignored`); cur = null; continue; }
      if (Object.hasOwn(story.scripts, id)) { warnings.push(`${file}:${k + 1}: script "${id}" is declared twice — the first is kept`); cur = null; continue; }
      cur = { lines: [], file, line: k + 2 };
      story.scripts[id] = cur;
      continue;
    }
    if (cur) cur.lines.push(l);
    else if (l.trim() && !l.trim().startsWith('#')) warnings.push(`${file}:${k + 1}: text before the first "== <script-id>" line — ignored`);
  }
  // (trailing blank lines are not part of a script)
  for (const s of Object.values(story.scripts)) if (s.file === file) while (s.lines.length && !s.lines[s.lines.length - 1].trim()) s.lines.pop();
}

/**
 * The story files campaign.json lists (`story`): valid names only, each once, at most
 * `MAX_STORY_FILES`.
 * @param {unknown} list
 * @param {string[]} warnings
 * @returns {string[]}
 */
export function storyFileList(list, warnings) {
  const out = [];
  const seen = new Set();
  for (const f of Array.isArray(list) ? list : []) {
    // (show(): a hostile entry such as {"toString": 1} must not throw — String() would)
    if (!isStoryFileName(f)) { warnings.push(`story: "${show(f)}" is not a story file name (a–z, 0–9, - then .json or .story) — ignored`); continue; }
    if (seen.has(f)) continue;
    if (out.length >= MAX_STORY_FILES) { warnings.push(`story: more than ${MAX_STORY_FILES} story files — "${f}" and the files after it are ignored`); break; }
    seen.add(f);
    out.push(f);
  }
  return out;
}

/**
 * Build a story from its files' texts, in the order campaign.json lists them.
 * @param {{ name: string, text: string }[]} files
 * @returns {{ story: Story, warnings: string[] }}
 */
export function buildStory(files) {
  const story = emptyStory();
  const warnings = [];
  for (const f of files) {
    if (f.name.endsWith('.story')) addStoryText(story, f.text, f.name, warnings);
    else {
      let raw;
      try { raw = JSON.parse(f.text); } catch (err) { warnings.push(`${f.name}: not valid JSON (${err.message}) — ignored`); continue; }
      addStoryJSON(story, raw, f.name, warnings);
    }
  }
  return { story, warnings };
}

/**
 * The file text of a `.json` story file (generators): the sections in a fixed order, two-space
 * indent, final newline. `scripts` keep one line per array entry.
 * @param {Record<string, any>} s the sections (vars, items, quests, actors, scripts, events,
 *   starts) as the file holds them
 * @returns {string}
 */
export function serializeStory(s) {
  const out = { format: STORY_FORMAT, version: STORY_VERSION };
  for (const k of ['vars', 'items', 'quests', 'actors', 'scripts', 'events', 'starts']) {
    const v = s[k];
    if (v && (Array.isArray(v) ? v.length : Object.keys(v).length)) out[k] = v;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * The text of a `.story` file (generators): each script after a `== <id>` header, a blank line
 * between scripts.
 * @param {Record<string, string[]>} scripts
 * @returns {string}
 */
export function serializeStoryText(scripts) {
  return `${Object.entries(scripts).map(([id, lines]) => `== ${id}\n${lines.join('\n')}`).join('\n\n')}\n`;
}

/** 'ferry-lantern' → 'Ferry Lantern' (StoryCondition.js; re-exported for the story runtime). */
export { titleCase };
