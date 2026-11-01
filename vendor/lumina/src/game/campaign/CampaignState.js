/**
 * What a campaign remembers between levels and sessions (docs/specs/CAMPAIGN_FORMAT.md §7): the
 * story (`story`: flags and variables, items and gold, quests, the events done, visit counts, the
 * day, per-level memory — StoryState), where the player is and how they got there, the time of day
 * and the weather, the player's combat progress, the chests opened, the enemy groups defeated, the
 * levels visited, the chapter.
 *
 * Saved in this browser (`localStorage` key `luminati.campaign.<name>`; a play-test of a campaign
 * level or a `&level=` start uses `…<name>.test`, so it never overwrites the real game) whenever the
 * player travels, the story changes or the page is hidden; each travel first keeps the save it
 * replaces as `….prev` (the backup: the game shortly before the last travel).
 * A saved game is untrusted data like a level file: every field is checked on load; a save of an
 * older version (or of none) is not read — a new journey starts and saves over it —; fields this
 * engine does not know are kept as they are, and a save newer than this engine is never written
 * over.
 */
import { StoryState } from '../story/StoryState.js';

/**
 * @import { Campaign } from './CampaignFormat.js'
 * @import { Story } from './StoryFormat.js'
 * @import { LevelSpawn } from '../../engine/level/types.js'
 */

/** @type {LevelSpawn['facing'][]} */
const FACINGS = ['down', 'up', 'left', 'right'];
const PREFIX = 'luminati.campaign.';
/**
 * The draughts a new journey's `progress` gives when it names none: PlayerCombat's start
 * (combat/rules.js `POTION_START`, 3 — not imported: rules.js's types pull the whole combat graph
 * into the Node tools that import this file).
 */
const START_POTIONS = 3;
export const SAVE_VERSION = 2;
/** The top-level keys of a save this engine reads (the rest are kept in `extra`). */
const KNOWN = new Set(['version', 'story', 'level', 'at', 'via', 'time', 'weather', 'combat', 'opened', 'cleared', 'fallen', 'visited', 'chapter', 'savedAt', 'playTime']);
/** At most this many group ids per level in `cleared` (a saved game is untrusted). */
const MAX_IDS = 4096;
/** Keys never copied into `extra` (they would change its prototype, not add a field). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v) => (typeof v === 'string' ? v : '');

/**
 * Is `data` a save this engine reads — an object of this version or a newer one? (A save of an
 * older version, or of none, is not: the game starts afresh and saves over it.)
 * @param {any} data
 * @returns {data is Record<string, any>}
 */
const readable = (data) => isPlain(data) && Number.isInteger(data.version) && data.version >= SAVE_VERSION;

/**
 * A time played (`playTime`, seconds) as the title's save line shows it: `h:mm:ss` — `0:05:09`,
 * `1:42:10` (the same digits in every language).
 * @param {number} seconds
 * @returns {string}
 */
export function formatPlayTime(seconds) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The player's combat progress carried from one combat level to the next (CombatSystem
 * `exportProgress` / `importProgress`): level, XP, gold, draughts, the upgrades from chests and
 * wares, and the one-time wares bought. (The story's `gold` is the purse between combat levels.)
 * @typedef {{ level: number, xp: number, gold: number, potions: number,
 *   upgrades: { maxHp: number, maxMp: number, attack: number, def: number }, wares: string[] }} CombatProgress
 */

/**
 * The combat progress a new journey of `campaign` starts with (its `progress`: the level, 1 when
 * absent; the draughts, `START_POTIONS` — PlayerCombat's — when absent; nothing else), or null for a
 * campaign without one (the first combat level starts afresh, as before). CombatSystem
 * `importProgress` takes it on the first combat level: HP, MP and SP full.
 * @param {Campaign} campaign
 * @returns {CombatProgress|null}
 */
export function startProgress(campaign) {
  const p = campaign.progress;
  if (!p) return null;
  return {
    level: p.level ?? 1, xp: 0, gold: 0, potions: p.potions ?? START_POTIONS,
    upgrades: { maxHp: 0, maxMp: 0, attack: 0, def: 0 }, wares: [],
  };
}

export class CampaignState {
  /**
   * A new game of `campaign` (its starting flags and the story's declared variables, at its start).
   * @param {Campaign} campaign
   * @param {string} name the campaign's folder name
   * @param {{ story?: Story|null, test?: boolean }} [opts] story: the campaign's story files; test:
   *   a play-test / `&level=` start — saved under `….test`, never over the real game
   */
  constructor(campaign, name, { story = null, test = false } = {}) {
    this.name = name;
    /** Saved under the play-test key (`….test`). */
    this.test = test;
    /** The story: flags and variables, items, gold, quests, events done, visits, the day … */
    this.story = new StoryState(story, campaign.flags);
    /** The base level id the player is in. */
    this.level = campaign.start.level;
    /**
     * Where in it (null: the level's entrance / player start).
     * @type {{ x: number, z: number, facing: LevelSpawn['facing'] }|null}
     */
    this.at = null;
    /**
     * How the player came into the level (an exit's entrance), the fallback when a changed level
     * no longer has room at `at`.
     * @type {{ from: string, entrance: string }|null}
     */
    this.via = null;
    /** Hour of day (null: the level's start time). @type {number|null} */
    this.time = null;
    this.weather = 'clear';
    /**
     * The combat progress carried between combat levels (null: none yet — the first combat level
     * starts afresh). A new journey of a campaign with `progress` (DRAGON_CAMPAIGN.md §5.1) starts
     * with it: that level and those draughts, no XP, gold, upgrades or wares (`startProgress`).
     * @type {CombatProgress|null}
     */
    this.combat = startProgress(campaign);
    /** @type {Record<string, string[]>} level id → chests opened there */
    this.opened = Object.create(null);
    /**
     * Base level id → the enemy groups defeated there (`CombatSystem.defeatedGroups`): they are not
     * there when the player comes back, until a waystone rest there brings them back
     * (KNOWN_ISSUES CMP-03).
     * @type {Record<string, string[]>}
     */
    this.cleared = Object.create(null);
    /**
     * Base level id → the foes fallen there in groups not yet defeated, by uid (`<group id>#<index>`),
     * on a level whose foes never come back (CombatSystem `fallenFoes`: `environment.respawn: false`):
     * a reload or a return does not bring them back (DRAGON_CAMPAIGN.md §5.2, COMBAT.md §29 V18).
     * Written only when a level has some (version 2 unchanged).
     * @type {Record<string, string[]>}
     */
    this.fallen = Object.create(null);
    /** @type {string[]} the levels entered so far (the campaign's world map dims the others) */
    this.visited = [];
    /** Chapter id in force when saved ('' = none yet). */
    this.chapter = '';
    this.savedAt = 0;
    /**
     * Seconds played (all sessions): counted while the game is played (CampaignRuntime.update — not
     * on the title, in a travel or while the page is hidden), shown on the title's Continue entry
     * (`formatPlayTime`). A save without it reads 0.
     */
    this.playTime = 0;
    /** The save's version when read (`fromJSON`): a newer one is never written over. */
    this.readVersion = SAVE_VERSION;
    /** @type {Record<string, any>} save fields this engine does not know (written back as they are) */
    this.extra = {};
  }

  /** Is a story flag set (a variable non-zero)? @param {string} flag */
  has(flag) {
    return this.story.has(flag);
  }

  /**
   * Set a story flag. Returns true when it was not set before.
   * @param {string} flag
   */
  set(flag) {
    const f = typeof flag === 'string' ? flag.trim() : '';
    if (!f || this.story.has(f)) return false;
    return this.story.setFlag(f);
  }

  /** The story flags set now (variables whose value is not 0). */
  get flags() {
    return new Set(Object.keys(this.story.vars));
  }

  /** The save: plain JSON. */
  toJSON() {
    return {
      ...this.extra,
      version: SAVE_VERSION,
      story: this.story.toJSON(),
      level: this.level,
      at: this.at,
      ...(this.via ? { via: this.via } : {}),
      time: this.time,
      weather: this.weather,
      combat: this.combat,
      opened: { ...this.opened },
      cleared: { ...this.cleared },
      ...(Object.keys(this.fallen).length ? { fallen: { ...this.fallen } } : {}),
      visited: [...this.visited],
      chapter: this.chapter,
      savedAt: this.savedAt,
      playTime: Math.round(this.playTime),
    };
  }

  /**
   * A saved game read back: fields that do not fit are dropped (untrusted data); a level the
   * campaign no longer has starts at the campaign's start. A save this engine does not read (not an
   * object, or of an older version: `readable`) gives a new game, which may be saved over it.
   * @param {Campaign} campaign
   * @param {string} name
   * @param {unknown} data
   * @param {{ story?: Story|null, test?: boolean }} [opts]
   * @returns {CampaignState}
   */
  static fromJSON(campaign, name, data, { story = null, test = false } = {}) {
    const s = new CampaignState(campaign, name, { story, test });
    if (!readable(data)) return s;
    const d = data;
    s.readVersion = d.version;
    // (as LevelFormat: `extra.__proto__ = v` would set extra's prototype rather than keep a field)
    for (const [k, v] of Object.entries(d)) if (!KNOWN.has(k) && !UNSAFE_KEYS.has(k)) s.extra[k] = v;
    s.story = StoryState.fromJSON(d.story, story);
    if (campaign.levels.some((l) => l.id === d.level)) {
      s.level = d.level;
      const at = isPlain(d.at) ? d.at : null;
      if (at && num(at.x) !== null && num(at.z) !== null) s.at = { x: at.x, z: at.z, facing: FACINGS.includes(at.facing) ? at.facing : 'down' };
      if (isPlain(d.via)) s.via = { from: text(d.via.from), entrance: text(d.via.entrance) };
    }
    if (num(d.time) !== null) s.time = ((d.time % 24) + 24) % 24;
    if (['clear', 'rain', 'snow'].includes(d.weather)) s.weather = d.weather;
    if (isPlain(d.combat)) {
      const c = d.combat;
      const n = (v, lo, hi) => Math.min(hi, Math.max(lo, num(v) ?? lo));
      const up = isPlain(c.upgrades) ? c.upgrades : {};
      s.combat = {
        level: n(c.level, 1, 10), xp: n(c.xp, 0, 1e7), gold: n(c.gold, 0, 1e7), potions: n(c.potions, 0, 5),
        upgrades: { maxHp: n(up.maxHp, 0, 999), maxMp: n(up.maxMp, 0, 999), attack: n(up.attack, 0, 999), def: n(up.def, 0, 999) },
        wares: Array.isArray(c.wares) ? c.wares.filter((w) => typeof w === 'string') : [],
      };
    }
    if (Array.isArray(d.visited)) s.visited = d.visited.filter((id) => typeof id === 'string' && campaign.levels.some((l) => l.id === id));
    for (const [k, v] of Object.entries(isPlain(d.opened) ? d.opened : {})) {
      if (Array.isArray(v)) s.opened[k] = v.filter((id) => typeof id === 'string');
    }
    // (only levels of the campaign; ids are short names, each once)
    for (const [k, v] of Object.entries(isPlain(d.cleared) ? d.cleared : {})) {
      if (!Array.isArray(v) || !campaign.levels.some((l) => l.id === k)) continue;
      const ids = [...new Set(v.filter((id) => typeof id === 'string' && id && id.length <= 200))].slice(0, MAX_IDS);
      if (ids.length) s.cleared[k] = ids;
    }
    // (the same rules; a foe's uid holds its group id and its index)
    for (const [k, v] of Object.entries(isPlain(d.fallen) ? d.fallen : {})) {
      if (!Array.isArray(v) || !campaign.levels.some((l) => l.id === k)) continue;
      const uids = [...new Set(v.filter((id) => typeof id === 'string' && id.length <= 220 && /#\d+$/.test(id)))].slice(0, MAX_IDS);
      if (uids.length) s.fallen[k] = uids;
    }
    s.chapter = text(d.chapter);
    s.savedAt = num(d.savedAt) ?? 0;
    s.playTime = Math.max(0, num(d.playTime) ?? 0);
    return s;
  }

  /**
   * The browser-storage key of a campaign's save.
   * @param {string} name
   * @param {{ test?: boolean }} [opts] test: the play-test save
   */
  static key(name, { test = false } = {}) {
    return `${PREFIX}${name}${test ? '.test' : ''}`;
  }

  /**
   * The saved game of a campaign in this browser, or null (none, one this engine does not read —
   * `readable`: a new journey starts and saves over it —, or storage unavailable). A save that
   * cannot be parsed falls back to the backup (`….prev`).
   * @param {Campaign} campaign
   * @param {string} name
   * @param {{ story?: Story|null, test?: boolean }} [opts]
   * @returns {CampaignState|null}
   */
  static load(campaign, name, opts = {}) {
    const key = CampaignState.key(name, opts);
    for (const k of [key, `${key}.prev`]) {
      let raw = null;
      try { raw = localStorage.getItem(k); } catch { return null; }
      if (!raw) continue;
      try {
        const data = JSON.parse(raw);
        if (readable(data)) return CampaignState.fromJSON(campaign, name, data, opts);
        console.warn(`[Luminati] the saved game "${k}" is of an older version (or not a saved game): not read, a new journey starts`);
        return null;
      } catch {
        console.warn(`[Luminati] the saved game "${k}" could not be read${k === key ? ' — trying the backup' : ''}`);
      }
    }
    return null;
  }

  /**
   * Forget a campaign's saved game (and its backup).
   * @param {string} name
   * @param {{ test?: boolean }} [opts]
   */
  static clear(name, opts = {}) {
    const key = CampaignState.key(name, opts);
    try {
      localStorage.removeItem(key);
      localStorage.removeItem(`${key}.prev`);
    } catch { /* storage unavailable */ }
  }

  /**
   * Write the save (the one before it becomes the backup). A save newer than this engine is never
   * written over.
   * @param {Record<string, any>} [json] what to write (default `toJSON()`; a run's snapshot)
   * @param {{ milestone?: boolean }} [opts] milestone: a travel — the save replaced becomes the
   *   backup `….prev` (other saves leave the backup as it is)
   * @returns {boolean} false when storage refused it (full, disabled) or the stored save is newer
   */
  save(json = null, { milestone = false } = {}) {
    if (this.readVersion > SAVE_VERSION) return false;
    const key = CampaignState.key(this.name, { test: this.test });
    const data = json ?? this.toJSON();
    data.savedAt = Date.now();
    this.savedAt = data.savedAt;
    try {
      // (the backup is the save as it was at the last milestone — a travel —, not a moment ago)
      const prev = milestone ? localStorage.getItem(key) : null;
      if (prev) localStorage.setItem(`${key}.prev`, prev);
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }
}
