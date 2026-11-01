/**
 * What the story knows (docs/specs/STORY_SCRIPT.md §6): flags and variables (one namespace: a flag
 * is a variable whose value is 1), the player's items (and the names shop items were given by) and
 * gold, quests (state, stage, the stages reached), the `once` events and blocks done, the turns of
 * `cycle` / `seq` / `pick` blocks, visit counts, the day, the per-level memory (where a villager now
 * lives) and the ending reached.
 *
 * It also holds the player's party as records (docs/specs/PARTY.md §2: `party`, written by the
 * Party after every change), which conditions read (`party`, `party:<who>`) and the save keeps.
 *
 * A campaign keeps one inside its save (`CampaignState.story`); a single level with a story keeps
 * one for the session. A save is untrusted data: `fromJSON` keeps only names that are names,
 * finite numbers within bounds and at most 4 096 entries per map. Every map is prototype-less.
 */
import { isFlagName, isStoryName } from '../../engine/level/StoryCondition.js';
import { MAX_PARTY, isClass, classForWeapon, normalizeRule } from '../../engine/level/PartyRules.js';
import { ownValue } from '../../engine/utils/own.js';
import { isGuid } from '../../engine/i18n/ContentKeys.js';

/**
 * @import { Story } from '../campaign/StoryFormat.js'
 * @import { Ref, RefReader } from '../../engine/level/StoryCondition.js'
 * @import { PartyRecord } from '../party/types.js'
 */

/**
 * A quest as the story has it.
 * @typedef {{ state: 'active'|'done'|'failed', stage: string, log: string[], title: string,
 *   texts: Record<string, string>, keys?: Record<string, string>, src?: Record<string, string> }} QuestState
 *   stage: the current stage id ('' before the first); log: the stage ids reached, in order; title
 *   and texts: what the script itself gave (`quest x start <title>`, `quest x stage s <text>`, its
 *   `${…}` values filled in), in English — declared quests read theirs from the story files; keys
 *   and src, per stage beside `texts` (docs/specs/I18N.md §4.2, §4.5): the stage text's content key
 *   (the GUID of the script line's tag) and its English before the values — the journal translates
 *   the text by its key while the saved text is that English (absent: an untagged line, or a saved
 *   key that is no GUID — dropped on load)
 */

const MAX = 4096;
const LIMIT = 1e9;
/** The longest key (`done`, counters, visits) a save keeps: longer ones are shortened (`storyKey`). */
const KEY_MAX = 200;
/** Saved positions (a villager's home) further out than this are dropped. */
const COORD_MAX = 1e5;
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clampN = (v) => Math.max(-LIMIT, Math.min(LIMIT, v));
/** @returns {Record<string, any>} */
const map = () => Object.create(null);

/**
 * A flag of the older, looser kind: a campaign's starting `flags`, a villager's `flag` — any short
 * text without control characters (`met hollis`, `gold`). Such a flag is set and read as it is
 * written (`when` / `unless` read one bare name as a flag); scripts use names (`isFlagName`).
 * @param {unknown} s
 * @returns {s is string}
 */
export function isLooseFlag(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 80 && s === s.trim() && !/[\u0000-\u001f\u007f]/.test(s);
}

/**
 * A new journey's seed for `pick` (a u32, never 0): the page's `&seed=<n>` when it gives one (tests:
 * the same picks every run), else a random one (`crypto.getRandomValues`). The save keeps it, so a
 * journey plays its picks the same way after a reload; another journey picks differently.
 * @returns {number}
 */
export function journeySeed() {
  const param = globalThis.location ? new URLSearchParams(globalThis.location.search).get('seed') : null;
  const n = param !== null && /^\d{1,10}$/.test(param) ? Number(param) >>> 0 : 0;
  if (n) return n;
  const c = globalThis.crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0] || 1;
  return (Date.now() >>> 0) || 1;
}

/**
 * A key the story remembers (a `once` key, a counter, a visit count) at most 200 characters long:
 * a longer one keeps its start and gets a hash of the whole, so it survives a save.
 * @param {string} key
 */
export function storyKey(key) {
  if (key.length <= KEY_MAX) return key;
  let h = 0x811c9dc5;
  for (let k = 0; k < key.length; k++) {
    h ^= key.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${key.slice(0, KEY_MAX - 10)}#${h.toString(36)}`;
}

/** The longest member name a save keeps; a record's look (`spec`): at most this many keys a level, this much JSON. */
const NAME_MAX = 60;
/** The longest item name a save keeps (`itemNames`). */
const ITEM_NAME_MAX = 200;
const SPEC_KEYS = 32;
const SPEC_JSON_MAX = 4096;
/** A key of a member's look (`spec`): a plain identifier, never one an object has already. */
const SPEC_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const COLOR = /^#[0-9a-fA-F]{3,8}$/;
/** Text a save may show as a name: no control characters, at most `max` long. */
const plainText = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');

/**
 * A member's look from a save (untrusted): a plain object of plain values — text (≤ 80), finite
 * numbers, booleans, null — and, one level deep, plain objects of those (`outfit`, `gear`); other
 * keys and values dropped, at most `SPEC_KEYS` keys a level and `SPEC_JSON_MAX` characters of JSON
 * (else none). null for anything else.
 * @param {unknown} v
 * @returns {Record<string, unknown>|null}
 */
function readSpec(v, depth = 0) {
  if (!isPlain(v)) return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  let n = 0;
  for (const [k, x] of Object.entries(/** @type {Record<string, unknown>} */ (v))) {
    if (n >= SPEC_KEYS) break;
    if (!SPEC_KEY.test(k) || k === 'constructor' || k === 'prototype') continue;
    let val;
    if (typeof x === 'string') val = x.slice(0, 80);
    else if (typeof x === 'boolean' || x === null || (typeof x === 'number' && Number.isFinite(x))) val = x;
    else if (depth === 0 && isPlain(x)) val = readSpec(x, 1);
    else continue;
    if (val === null && x !== null) continue;
    out[k] = val;
    n++;
  }
  if (depth === 0 && JSON.stringify(out).length > SPEC_JSON_MAX) return null;
  return out;
}

/**
 * The party's records from a save (untrusted; docs/specs/PARTY.md §2): a record whose `id` is no
 * story name is dropped, and so is a second one with the same id or actor; the rest is repaired —
 * an unknown class becomes the one its weapon gives, a bad rule field the default preset's, a bad
 * name, look or colour the plain ones; at most `MAX_PARTY`.
 * @param {unknown} v
 * @returns {PartyRecord[]}
 */
export function readPartyRecords(v) {
  if (!Array.isArray(v)) return [];
  /** @type {PartyRecord[]} */
  const out = [];
  const ids = new Set();
  const actors = new Set();
  for (const r of v.slice(0, 64)) {
    if (out.length >= MAX_PARTY) break;
    if (!isPlain(r) || !isStoryName(r.id) || ids.has(r.id)) continue;
    const actor = isStoryName(r.actor) ? r.actor : '';
    if (actor && actors.has(actor)) continue;
    ids.add(r.id);
    if (actor) actors.add(actor);
    const spec = readSpec(r.spec);
    out.push({
      id: r.id,
      name: plainText(r.name, NAME_MAX) || r.id,
      actor,
      preset: isStoryName(r.preset) && r.preset.length <= 40 ? r.preset : 'villager',
      spec,
      color: typeof r.color === 'string' && COLOR.test(r.color) ? r.color : '#c9a45c',
      cls: isClass(r.cls) ? r.cls : classForWeapon(spec?.weapon),
      rule: normalizeRule(r.rule),
      level: isStoryName(r.level) ? r.level : '',
    });
  }
  return out;
}

/**
 * Is a villager — by id, actor or name, in any case, as the game finds a member — one of the
 * party's records?
 * @param {readonly PartyRecord[]|undefined} records
 * @param {string} who
 */
export function partyHas(records, who) {
  if (!records?.length) return false;
  const low = String(who).toLowerCase();
  return records.some((r) => r.id.toLowerCase() === low || (!!r.actor && r.actor.toLowerCase() === low) || r.name.toLowerCase() === low);
}

/**
 * What a reader of the story's values needs beyond the state (`storyReader`).
 * @typedef {object} ReaderContext
 * @property {Story|null} [story]  the story files (declared stage order); null: nothing declared
 * @property {() => string} level  the base id of the level the story is read in (`level`, `done:`)
 * @property {() => readonly string[]} [visited]  the levels entered so far (`visited:`)
 * @property {(name: string) => number|string|undefined} [game]  a game value (`hour`, `gold`,
 *   `chapter`, `weather`, `visits`); undefined: the default (0, '' — `gold`: the story's purse)
 * @property {(name: string) => string[]} [visitKeys]  the keys a `visits:<name>` count may be kept
 *   under, first (the runtime: the villager of that name here)
 */

/**
 * The values story conditions read (docs/specs/STORY_SCRIPT.md §6) — one resolver for the story
 * runtime and for conditions read before it exists (a campaign's chapter and level variants at
 * boot), so both read a condition the same way.
 * @param {() => StoryState} stateOf the state (read anew each time: a new journey replaces it)
 * @param {ReaderContext} ctx
 * @returns {RefReader & { text: (ref: Ref) => string|undefined }}
 */
export function storyReader(stateOf, ctx) {
  /**
   * A stage's number in its quest: its place among the declared stages, else among the stages the
   * quest reached (1-based; '' → 0). A stage the quest has not reached, or one that is not
   * declared, comes after all of them: `stage:q >= x` holds only once `x` is reached.
   */
  const stageIndex = (quest, stage) => {
    if (!stage) return 0;
    const decl = ownValue(ctx.story?.quests ?? {}, quest)?.stages;
    if (decl?.length) {
      const k = decl.findIndex((st) => st.id === stage);
      return k >= 0 ? k + 1 : decl.length + 1;
    }
    const log = stateOf().quest(quest)?.log ?? [];
    const k = log.indexOf(stage);
    return k >= 0 ? k + 1 : log.length + 1;
  };
  const visitsOf = (s, name) => {
    const keys = ctx.visitKeys?.(name) ?? [];
    for (const k of [...keys, `actor:${name}`, `actor:${name.toLowerCase()}`, `${ctx.level()}/${name}`, name]) {
      if (Object.hasOwn(s.visits, k)) return s.visits[k];
    }
    return 0;
  };
  return {
    get(ref) {
      const s = stateOf();
      switch (ref.kind) {
        case '': return s.get(ref.name);
        case 'item': return s.count(ref.name);
        case 'quest': return s.quest(ref.name)?.state ?? 'none';
        case 'stage': return stageIndex(ref.name, s.quest(ref.name)?.stage ?? '');
        case 'visits': return visitsOf(s, ref.name);
        case 'visited': return ctx.visited?.().includes(ref.name) ? 1 : 0;
        // (`party:<who>`: a member, by id, actor or name — PARTY.md §7.2)
        case 'party': return partyHas(s.party, ref.name) ? 1 : 0;
        // (`done:<id>`: this level's event; `done:<level>.<id>` another level's; a story file's
        // event; a `once` block's key)
        case 'done': return s.isDone(`${ctx.level()}.${ref.name}`) || s.isDone(ref.name) || s.isDone(`story.${ref.name}`) || s.isDone(`once:${ref.name}`) ? 1 : 0;
        case 'game': {
          if (ref.name === 'day') return s.day;
          if (ref.name === 'level') return ctx.level();
          // (how many members: the records the Party writes after every change)
          if (ref.name === 'party') return s.party?.length ?? 0;
          const v = ctx.game?.(ref.name);
          if (v !== undefined) return v;
          if (ref.name === 'gold') return s.gold;
          return ref.name === 'chapter' || ref.name === 'weather' ? '' : 0;
        }
        default: return 0;
      }
    },
    word(ref, w) {
      if (ref.kind === 'stage') return stageIndex(ref.name, w);
      if (ref.kind === 'quest' || (ref.kind === 'game' && (ref.name === 'chapter' || ref.name === 'level' || ref.name === 'weather'))) return w;
      return stateOf().get(w);
    },
    // (`${stage:q}` shows the stage's id, `${quest:q}` its state)
    text(ref) {
      const s = stateOf();
      if (ref.kind === 'stage') return s.quest(ref.name)?.stage ?? '';
      if (ref.kind === 'quest') return s.quest(ref.name)?.state ?? 'none';
      return undefined;
    },
  };
}

export class StoryState {
  /**
   * A new story: the declared variables' start values, then `flags` (set to 1).
   * @param {Story|null} [story]
   * @param {string[]} [flags]
   */
  constructor(story = null, flags = []) {
    /** @type {Record<string, number>} flags and variables (absent = 0) */
    this.vars = map();
    for (const [k, v] of Object.entries(story?.vars ?? {})) if (v) this.vars[k] = v;
    for (const f of flags) if (isLooseFlag(f)) this.vars[f] = 1;
    /** @type {Record<string, number>} item id → count (absent = 0) */
    this.items = map();
    /**
     * Item id → the name it was given by, for an item no story file declares (a shop's `item`:
     * `StoryRunner.giveNamed`, `nameItem`) — in English, what the journal shows (a term). Saved
     * when it holds any (an item without a name shows its id's title case).
     * @type {Record<string, string>}
     */
    this.itemNames = map();
    this.gold = 0;
    /** @type {Record<string, QuestState>} */
    this.quests = map();
    /** @type {Set<string>} `once` events (`<level>.<event id>`, `story.<event id>`) and `once` blocks (their key) */
    this.done = new Set();
    /** @type {Record<string, number>} times each `cycle` / `seq` / `pick` block and `[once]` option played */
    this.counters = map();
    /** @type {Record<string, number>} conversations per actor (or `<level>/<villager id>`) */
    this.visits = map();
    /** The day: 1 on a new game, +1 at every midnight (and every rest past one). */
    this.day = 1;
    /** @type {Record<string, { homes: Record<string, [number, number]> }>} per base level */
    this.levels = map();
    /** The ending reached ('' = the story goes on). */
    this.ending = '';
    /**
     * Event runs that were queued or going on when the game was saved (`event:<level>.<id>`,
     * `story:<id>`): a continued game runs them again (StoryRunner.resumePending), so an event
     * interrupted by a reload is not lost.
     * @type {string[]}
     */
    this.pending = [];
    /** The journey's seed for `pick` (`journeySeed`; 0: the fixed picks of a story without one). */
    this.seed = 0;
    /**
     * The party's members (docs/specs/PARTY.md §2): written by the Party after every change
     * (`setParty`), read back on Continue (`fromJSON`: `readPartyRecords`). Plain records. A save
     * taken while a run goes on holds them as they were when it began (runs are atomic).
     * @type {PartyRecord[]}
     */
    this.party = [];
    /** Bumped by every change (the story runtime re-checks conditions when it moves). */
    this.version = 0;
  }

  /**
   * The party's records now (copies; the Party's own change after every join, leave and rule).
   * @param {PartyRecord[]} records
   */
  setParty(records) {
    this.party = records.map((r) => ({ ...r, spec: r.spec ? { ...r.spec } : null, rule: { ...r.rule } }));
    this.version++;
  }

  /** A flag / variable's value (0 when unset). @param {string} name */
  get(name) {
    return Object.hasOwn(this.vars, name) ? this.vars[name] : 0;
  }

  /** Is a flag set (a variable non-zero)? @param {string} name */
  has(name) {
    return this.get(String(name).trim()) !== 0;
  }

  /**
   * Set a flag / variable (0 removes it). Returns true when the value changed.
   * @param {string} name
   * @param {number} value
   */
  setVar(name, value) {
    if (!isFlagName(name) || !Number.isFinite(value)) return false;
    const v = clampN(value);
    if (this.get(name) === v) return false;
    if (v === 0) delete this.vars[name];
    else this.vars[name] = v;
    this.version++;
    return true;
  }

  /**
   * Set (or clear) a flag that may be of the older, looser kind (`isLooseFlag`: a campaign's
   * `flags`, a villager's `flag`, the `setFlag` hook). Returns true when it changed.
   * @param {string} name
   * @param {boolean} [on]
   */
  setFlag(name, on = true) {
    if (isFlagName(name)) return this.setVar(name, on ? 1 : 0);
    if (!isLooseFlag(name) || this.has(name) === on) return false;
    if (on) this.vars[name] = 1;
    else delete this.vars[name];
    this.version++;
    return true;
  }

  /** How many of an item the player has. @param {string} id */
  count(id) {
    return id === 'gold' ? this.gold : Object.hasOwn(this.items, id) ? this.items[id] : 0;
  }

  /**
   * Add (or with a negative `n`, take) items; returns how many changed hands. Gold is the `gold` item.
   * @param {string} id
   * @param {number} n
   */
  addItem(id, n) {
    if (!isStoryName(id) || !Number.isFinite(n) || n === 0) return 0;
    const have = this.count(id);
    const next = Math.max(0, Math.min(LIMIT, have + Math.trunc(n)));
    if (next === have) return 0;
    if (id === 'gold') this.gold = next;
    else if (next === 0) delete this.items[id];
    else this.items[id] = next;
    this.version++;
    return next - have;
  }

  /**
   * Keep the name an item was given by (`giveNamed`: a shop's item no story file declares) — plain
   * text, at most 200 characters; returns false for an id that is no item name or a blank name.
   * @param {string} id
   * @param {string} name
   */
  nameItem(id, name) {
    const text = plainText(name, ITEM_NAME_MAX);
    if (!isStoryName(id) || id === 'gold' || !text) return false;
    if (!Object.hasOwn(this.itemNames, id) && Object.keys(this.itemNames).length >= MAX) return false;
    this.itemNames[id] = text;
    return true;
  }

  /** The name an item was given by (`nameItem`), or ''. @param {string} id */
  itemNameOf(id) {
    return Object.hasOwn(this.itemNames, id) ? this.itemNames[id] : '';
  }

  /**
   * A quest's state, or null (not started).
   * @param {string} id
   * @returns {QuestState|null}
   */
  quest(id) {
    return Object.hasOwn(this.quests, id) ? this.quests[id] : null;
  }

  /**
   * Change a quest: start it, move it to a stage (starting it), finish or fail it. Returns what
   * happened ('' = nothing changed): 'start' | 'stage' | 'done' | 'fail'.
   * @param {string} id
   * @param {'start'|'stage'|'done'|'fail'} verb
   * @param {{ stage?: string, text?: string, key?: string, src?: string }} [opts] stage: the stage
   *   id; text: the script's own title (start) or stage text (stage), its values filled in; key and
   *   src (stage, with a text): the text's content key (a GUID: its line's tag; anything else counts
   *   as none) and its English before the values, kept beside it (none: a text without a key — what
   *   an earlier text of the stage kept goes)
   * @returns {''|'start'|'stage'|'done'|'fail'}
   */
  questChange(id, verb, { stage = '', text = '', key = '', src = '' } = {}) {
    if (!isStoryName(id)) return '';
    let q = this.quest(id);
    const fresh = !q;
    if (!q) {
      if (Object.keys(this.quests).length >= MAX) return '';
      q = { state: 'active', stage: '', log: [], title: '', texts: map(), keys: map(), src: map() };
      this.quests[id] = q;
    }
    let what = /** @type {''|'start'|'stage'|'done'|'fail'} */ ('');
    if (verb === 'start') {
      if (text && !q.title) q.title = text;
      what = fresh ? 'start' : '';
    } else if (verb === 'stage') {
      if (text) {
        q.texts[stage] = text;
        q.keys ??= map();
        q.src ??= map();
        if (isGuid(key) && typeof src === 'string') {
          q.keys[stage] = key;
          q.src[stage] = src;
        } else {
          delete q.keys[stage];
          delete q.src[stage];
        }
      }
      if (q.stage !== stage) {
        q.stage = stage;
        if (!q.log.includes(stage)) q.log.push(stage);
        what = fresh ? 'start' : 'stage';
      }
      // (a stage given to a finished or failed quest opens it again, at that stage)
      if (q.state !== 'active') {
        q.state = 'active';
        what ||= 'stage';
      }
    } else if (verb === 'done' && q.state !== 'done') {
      q.state = 'done';
      what = 'done';
    } else if (verb === 'fail' && q.state !== 'failed') {
      q.state = 'failed';
      what = 'fail';
    }
    if (what || fresh) this.version++;
    return what;
  }

  /** Is a `once` key done? @param {string} key */
  isDone(key) {
    return this.done.has(storyKey(key));
  }

  /**
   * Mark a `once` key done. Returns true when it was new. (A full list forgets its oldest key
   * rather than refusing the new one: a `once` that never runs would be worse.)
   * @param {string} key
   */
  markDone(key) {
    const k = storyKey(key);
    if (this.done.has(k)) return false;
    if (this.done.size >= MAX * 4) this.done.delete(this.done.values().next().value);
    this.done.add(k);
    this.version++;
    return true;
  }

  /** Advance a counter; returns its value before. @param {string} key */
  bump(key) {
    const k = storyKey(key);
    const n = Object.hasOwn(this.counters, k) ? this.counters[k] : 0;
    if (Object.keys(this.counters).length < MAX || Object.hasOwn(this.counters, k)) this.counters[k] = n + 1;
    return n;
  }

  /** Conversations counted under `key` so far. @param {string} key */
  visitsOf(key) {
    const k = storyKey(key);
    return Object.hasOwn(this.visits, k) ? this.visits[k] : 0;
  }

  /** Count a conversation under `key`; returns the count before. @param {string} key */
  visit(key) {
    const k = storyKey(key);
    const n = this.visitsOf(k);
    if (Object.keys(this.visits).length < MAX || Object.hasOwn(this.visits, k)) this.visits[k] = n + 1;
    this.version++;
    return n;
  }

  /** The per-level memory of base level `id` (created on first use). @param {string} id */
  levelMemory(id) {
    if (!Object.hasOwn(this.levels, id)) this.levels[id] = { homes: map() };
    return this.levels[id];
  }

  /**
   * A reader of the story's values for conditions read before the story runtime exists (a
   * campaign's chapter and level variants at boot) — the runtime's own rules (`storyReader`); the
   * game values it cannot know (hour, weather …) read as `ctx.game` gives them, else 0 / ''.
   * @param {Partial<ReaderContext>} [ctx]
   */
  basicReader(ctx = {}) {
    return storyReader(() => this, { level: () => '', ...ctx });
  }

  /** The save's `story` part: plain JSON. */
  toJSON() {
    return {
      vars: { ...this.vars },
      items: { ...this.items },
      // (the names shop items were given by — absent without any)
      ...(Object.keys(this.itemNames).length ? { itemNames: { ...this.itemNames } } : {}),
      gold: this.gold,
      // (a script's stage texts with their content keys and English beside them — each absent
      // without any)
      quests: Object.fromEntries(Object.entries(this.quests).map(([k, q]) => [k, {
        state: q.state, stage: q.stage, log: [...q.log], ...(q.title ? { title: q.title } : {}), ...(Object.keys(q.texts).length ? { texts: { ...q.texts } } : {}),
        ...(q.keys && Object.keys(q.keys).length ? { keys: { ...q.keys } } : {}), ...(q.src && Object.keys(q.src).length ? { src: { ...q.src } } : {}),
      }])),
      done: [...this.done],
      counters: { ...this.counters },
      visits: { ...this.visits },
      day: this.day,
      levels: Object.fromEntries(Object.entries(this.levels).map(([k, l]) => [k, { homes: { ...l.homes } }])),
      ...(this.ending ? { ending: this.ending } : {}),
      ...(this.pending.length ? { pending: [...this.pending] } : {}),
      ...(this.seed ? { seed: this.seed } : {}),
      // (absent without members: a save of a game nobody joined is as it was before the party)
      ...(this.party.length ? { party: this.party.map((r) => ({ ...r, spec: r.spec ? JSON.parse(JSON.stringify(r.spec)) : null, rule: { ...r.rule } })) } : {}),
    };
  }

  /**
   * A saved story read back (untrusted): what does not fit is dropped.
   * @param {unknown} data
   * @param {Story|null} [story]
   * @returns {StoryState}
   */
  static fromJSON(data, story = null) {
    const s = new StoryState(story);
    if (!isPlain(data)) return s;
    const d = /** @type {Record<string, any>} */ (data);
    const entries = (v) => (isPlain(v) ? Object.entries(v).slice(0, MAX) : []);
    // (a save holds every value: the declared starts are replaced, not merged)
    s.vars = map();
    for (const [k, v] of entries(d.vars)) if ((isFlagName(k) || (isLooseFlag(k) && v === 1)) && num(v) !== null && v !== 0) s.vars[k] = clampN(v);
    for (const [k, v] of entries(d.items)) if (isStoryName(k) && k !== 'gold' && num(v) !== null && v > 0) s.items[k] = Math.min(LIMIT, Math.floor(v));
    // (absent without any: the ids' title case is shown)
    for (const [k, v] of entries(d.itemNames)) if (typeof v === 'string') s.nameItem(k, v);
    s.gold = Math.max(0, Math.min(LIMIT, Math.floor(num(d.gold) ?? 0)));
    for (const [k, q] of entries(d.quests)) {
      if (!isStoryName(k) || !isPlain(q)) continue;
      const state = ['active', 'done', 'failed'].includes(q.state) ? q.state : 'active';
      const stageOk = (x) => typeof x === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/.test(x);
      const texts = map();
      for (const [sk, tv] of entries(q.texts)) if (stageOk(sk) && typeof tv === 'string') texts[sk] = tv.slice(0, 2000);
      // (a stage text's content key and English before the values: kept in pairs, for a text the
      // save has; only a GUID is a key — a key that is no GUID is dropped, so its text shows its
      // English — I18N.md §4.2, §4.5)
      const keys = map();
      const src = map();
      const srcIn = isPlain(q.src) ? q.src : {};
      for (const [sk, kv] of entries(q.keys)) {
        const sv = Object.hasOwn(srcIn, sk) ? srcIn[sk] : undefined;
        if (!Object.hasOwn(texts, sk) || !isGuid(kv) || typeof sv !== 'string') continue;
        keys[sk] = kv;
        src[sk] = sv.slice(0, 2000);
      }
      s.quests[k] = {
        state, stage: stageOk(q.stage) ? q.stage : '',
        log: Array.isArray(q.log) ? q.log.filter(stageOk).slice(0, 256) : [],
        title: typeof q.title === 'string' ? q.title.slice(0, 200) : '', texts, keys, src,
      };
    }
    if (Array.isArray(d.done)) for (const k of d.done.slice(0, MAX * 4)) if (typeof k === 'string' && k.length <= KEY_MAX) s.done.add(k);
    for (const [k, v] of entries(d.counters)) if (k.length <= KEY_MAX && num(v) !== null && v >= 0) s.counters[k] = Math.min(LIMIT, Math.floor(v));
    for (const [k, v] of entries(d.visits)) if (k.length <= KEY_MAX && num(v) !== null && v >= 0) s.visits[k] = Math.min(LIMIT, Math.floor(v));
    s.day = Math.max(1, Math.min(LIMIT, Math.floor(num(d.day) ?? 1)));
    for (const [id, l] of entries(d.levels)) {
      if (!isStoryName(id) || !isPlain(l)) continue;
      const m = s.levelMemory(id);
      for (const [npc, xz] of entries(l.homes)) {
        const ok = (v) => num(v) !== null && Math.abs(v) <= COORD_MAX;
        if (isStoryName(npc) && Array.isArray(xz) && xz.length === 2 && ok(xz[0]) && ok(xz[1])) m.homes[npc] = [xz[0], xz[1]];
      }
    }
    s.ending = isStoryName(d.ending) ? d.ending : '';
    if (Array.isArray(d.pending)) s.pending = d.pending.filter((k) => typeof k === 'string' && k.length <= 300 && /^(event|story|talk):/.test(k)).slice(0, 64);
    s.seed = Number.isInteger(d.seed) && d.seed > 0 && d.seed <= 0xffffffff ? d.seed : 0;
    s.party = readPartyRecords(d.party);
    return s;
  }
}
