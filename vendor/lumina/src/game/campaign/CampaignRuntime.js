import * as THREE from 'three';
import { applyStory, levelExits, findEntrance, inExit, hasStoryCondition, storyAllows } from '../../engine/level/Travel.js';
import { cachedCondition, evalCondition } from '../../engine/level/StoryCondition.js';
import { levelHasCombat, OBJECT_TYPES } from '../../engine/level/ObjectCatalog.js';
import { isOwnKey } from '../../engine/utils/own.js';
import { chapterLevelId, activeChapter, acrossSeam, campaignLevel } from './CampaignFormat.js';
import { CampaignState, formatPlayTime, SAVE_VERSION } from './CampaignState.js';
import { LevelPreparation } from './LevelPreparation.js';
import { storyReader, journeySeed } from '../story/StoryState.js';
import { renderLevelMap } from '../../engine/level/LevelMap.js';
import { TIME_SPEED } from '../config.js';
import { isInterior, soundtrackOf } from '../LevelLook.js';
import { t, registerStrings } from '../../engine/i18n/I18n.js';
import { loc, term } from '../../engine/i18n/ContentText.js';
import { textKeyOf, pageKeyOf, textPages } from '../../engine/i18n/ContentKeys.js';
import campaignStrings from './strings.js';

/**
 * @import { Level, LevelEnvironment, LevelObject, LevelObjectOf, LevelSpawn } from '../../engine/level/types.js'
 * @import { Campaign, CampaignChapter } from './CampaignFormat.js'
 * @import { Story } from './StoryFormat.js'
 * @import { CampaignLevels } from './CampaignStorage.js'
 * @import { Game } from '../Game.js'
 * @import { World } from '../World.js'
 * @import { StoryRunner } from '../story/StoryRunner.js'
 * @import { KeptLevel } from '../Game.js'
 */

/**
 * A level set aside (`CampaignRuntime._aside`, docs/specs/CAMPAIGN_FORMAT.md §6.3).
 * @typedef {object} AsideEntry
 * @property {string} id      its base level id (what exits name)
 * @property {string} fileId  the file played for it (a chapter's variant, or the level itself)
 * @property {string} text    that file's text when it was built
 * @property {Level} raw      that file parsed (the story not applied): the story must give the
 *   same objects from it again (`storyLevel`) for the level to be attached again
 * @property {KeptLevel} kept the game's detached level (Game.swapLevel `keep`)
 */

/**
 * A walk exit closer than this (world units) to the player has its level fetched ahead — and the
 * nearest open one's level built ahead (KNOWN_ISSUES CMP-01).
 */
const PRELOAD_DISTANCE = 12;
/**
 * The level built ahead works while the page is idle between frames (requestIdleCallback): at most
 * this many milliseconds a time, and only while this many are left before the next frame is due
 * (a step can overrun the budget by its own length, ≈ 1–4 ms).
 */
const PREPARE_IDLE_MAX_MS = 8;
const PREPARE_IDLE_MARGIN_MS = 3;
/** Without an idle period for this long a slice runs anyway, of PREPARE_BUDGET_MS. */
const PREPARE_IDLE_TIMEOUT_MS = 120;
/** Milliseconds of such a slice — and every frame's, in a browser without idle callbacks. */
const PREPARE_BUDGET_MS = 3;
/** A level built ahead is dropped once no exit toward it is this close (world units). */
const PREPARE_KEEP_DISTANCE = 24;
/** How far past the target's exit a seam arrival lands (the way back stays behind the player). */
const ARRIVE_CLEAR = 0.9;
/** Fader times (seconds): out before the switch, in after it. */
const FADE_OUT = 0.35;
const FADE_IN = 0.5;
/**
 * Seconds of play — no story run, no travel, the fader clear — before a chapter begun in a
 * cutscene is announced (`_showChapterBanner`): a run's closing fade in (0.4 s) is over, and an
 * area banner the end of the run brings (Game `_updateRegion`, every 0.3 s) is up first.
 */
const CHAPTER_BANNER_IDLE = 0.5;
/** And not within this long (ms) of a story title card: no banner right after a card (a toll's card and the next chapter). */
const CHAPTER_AFTER_CARD_MS = 20000;

/** The world map's ground between a campaign's placed levels. */
const MAP_GROUND = '#141a26';
/** Alpha of a placed level not visited yet on the campaign's world map. */
const UNVISITED_ALPHA = 0.38;

/**
 * Register the 'campaign' UI strings (docs/specs/I18N.md §2: the feature registers its namespace
 * when it starts — CampaignStart's loading line comes before the runtime exists). Idempotent.
 */
export function registerCampaignStrings() {
  registerStrings('campaign', campaignStrings);
}

/** Text of an untrusted text field (trimmed; '' for anything else). */
const text = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * A campaign being played (docs/specs/CAMPAIGN_FORMAT.md §6): the game's link to the campaign
 * file, its story and saved state, and the level files. It turns the current level's exits into
 * travel — walk exits by stepping in, Space exits as interactables —, switches levels inside the
 * running game (`Game.swapLevel`, behind the fader), places the player at the entrance or across
 * the seam, applies the story (chapter variants, `when` / `unless`), carries combat progress,
 * opened chests, the enemy groups defeated, the clock and the weather between levels and saves the
 * game in this browser.
 * The story itself (scripts, events, presence) runs in the game's StoryRunner (`attachStory`).
 *
 * Languages (docs/specs/I18N.md): the runtime's own messages are the 'campaign' namespace
 * (`./strings.js`, registered here); what the campaign and its levels say is translated at display,
 * never in the data or the save (§4.5): names as terms (`term`), prose by the stable key the data
 * holds for it (`loc`, §4.2 — an exit's `locked` pages, the level's subtitle, the chapters' and the
 * title screen's texts: `pageKeyOf` / `textKeyOf` of the exit, the level, the chapter, the campaign);
 * a code default for blank data is a UI string (`t`, §4.8). An exit's prompt `label` stays English:
 * the game's prompt translates it.
 */
export class CampaignRuntime {
  /**
   * @param {{ name: string, campaign: Campaign, state: CampaignState, levels: CampaignLevels,
   *   levelId: string, fileId: string, hasSave?: boolean, story?: Story|null,
   *   start?: import('./StoryFormat.js').StoryStart|null }} opts
   *   levelId / fileId: the level the game starts in (its base id and the file played for it);
   *   story: the story files; start: a debug start preset to apply to a new game (`&story=`)
   */
  constructor({ name, campaign, state, levels, levelId, fileId, hasSave = false, story = null, start = null }) {
    registerCampaignStrings();
    this.name = name;
    this.campaign = campaign;
    this.state = state;
    this.levels = levels;
    /** @type {Story|null} the campaign's story files */
    this.story = story;
    /** A debug start preset for a new game (`&story=<name>`), or null. */
    this.startPreset = start;
    /** The base id of the level being played (what exits name). */
    this.levelId = levelId;
    /** The file played for it (a chapter's variant, or the level itself). */
    this.fileId = fileId;
    /** A saved game existed at boot (the title offers Continue / New journey). */
    this.hasSave = hasSave;
    /** @type {Game|null} */
    this.game = null;
    /** @type {StoryRunner|null} the game's story runtime (`attachStory`) */
    this.runner = null;
    /** @type {LevelObjectOf<'exit'>[]} the current level's exits */
    this._exits = [];
    /** @type {Map<LevelObjectOf<'exit'>, any>} Space exits' prompts */
    this._exitPrompts = new Map();
    /** Walk exits fire only after the player has stood outside every exit (arrivals, refusals). */
    this._armed = false;
    this._traveling = false;
    this._preloadT = 0;
    /** No save is written before the game has started (`onStart`): a boot hidden mid-way saves nothing. */
    this._started = false;
    /**
     * A chapter begun whose banner waits until the player has the screen (`_showChapterBanner`), or null.
     * @type {CampaignChapter|null}
     */
    this._chapterBanner = null;
    /** Seconds of play free of the story, travels and the fader so far (0 while not). */
    this._freeT = 0;
    /** While a story run goes on: the save as it was when the run began (`holdSaves`). @type {Record<string, any>|null} */
    this._held = null;
    /** The save failed once (a toast told the player; it is not repeated every save). */
    this._saveFailed = false;
    /**
     * Milliseconds of the last travel (fade out → level built → fade in starts) and its parts;
     * `prepared`: travels that used a level built ahead; `lastPrep`: the last travel's
     * preparation (LevelPreparation.info + `used`), null when it had none; `kept`: travels that
     * attached a level set aside again instead of building it, `lastKept` whether the last one
     * did; `lastAside`: where the last travel set the level it left aside ('parent' | 'room' | ''
     * none); `dropped`: levels set aside that were released since (replaced, dropped, stale).
     * @type {{ travels: number, lastMs: number, lastBuildMs: number, prepared: number,
     *   lastPrep: (ReturnType<LevelPreparation['info']> & { used: boolean })|null,
     *   kept: number, lastKept: boolean, lastAside: string, dropped: number }}
     */
    this.stats = { travels: 0, lastMs: 0, lastBuildMs: 0, prepared: 0, lastPrep: null, kept: 0, lastKept: false, lastAside: '', dropped: 0 };
    /**
     * Levels set aside (CAMPAIGN_FORMAT.md §6.3): `parent`, the level the player came from while
     * they are in rooms; `room`, the last room they left. At most one each; a travel to one of
     * them attaches it again instead of building it.
     * @type {{ parent: AsideEntry|null, room: AsideEntry|null }}
     */
    this._aside = { parent: null, room: null };
    this._keepRooms = true;
    /**
     * The file of the level played now, parsed (the story not applied; CampaignStart sets the
     * first): a level set aside keeps it.
     * @type {Level|null}
     */
    this.levelRaw = null;
    /**
     * The level the player is heading for, built ahead (`_prepareAhead`; KNOWN_ISSUES CMP-01), or null.
     * @type {LevelPreparation|null}
     */
    this._prep = null;
    /** Build the next level ahead (false: every travel builds its level behind the fader, as before CMP-01). */
    this.prepareAhead = true;
    /** The idle callback that works on `_prep` next (0: none asked for). */
    this._idleId = 0;
    /**
     * Painted maps (LevelMap) of the placed levels by file id, and their names by level id, for
     * the campaign's world map (loaded in the background: `_loadMaps`).
     * @type {Map<string, ReturnType<typeof renderLevelMap>>}
     */
    this._maps = new Map();
    /** @type {Map<string, string>} */
    this._names = new Map();
    /** @type {Promise<void>|null} */
    this._mapsLoading = null;
    /**
     * The campaign's hour while the player is in a level with its own fixed hour
     * (`environment.clock: false`: the campaign clock pauses there and goes on from this hour
     * outside); null elsewhere.
     * @type {number|null}
     */
    this._outsideTime = null;
    /** The campaign's weather while the player is in such a level (it keeps its own); null elsewhere. */
    this._outsideWeather = null;
    this._onHide = () => { if (document.visibilityState === 'hidden') this.save(); };
    this._onPageHide = () => this.save();
    /** Does a story condition hold (the story runner's reader once there is one)? @type {(cond: string) => boolean} */
    this.holds = this._holdsIn(() => this.levelId);
  }

  /**
   * A condition tester reading the story in level `levelOf()` — the story runner's, else (at boot,
   * before it exists) the same rules over the saved state (`storyReader`), the saved hour, weather
   * and chapter.
   * @param {() => string} levelOf
   * @returns {(cond: string) => boolean}
   */
  _holdsIn(levelOf) {
    const basic = storyReader(() => this.state.story, {
      story: this.story,
      level: levelOf,
      visited: () => this.state.visited,
      game: (name) => (name === 'hour' ? this.state.time ?? undefined : name === 'weather' ? this.state.weather : name === 'chapter' ? this.state.chapter : undefined),
    });
    return (c) => {
      if (!this.runner) return evalCondition(cachedCondition(c), basic);
      const id = levelOf();
      return id === this.runner.levelId ? this.runner.holds(c) : this.runner.holdsIn(id)(c);
    };
  }

  /** Is `id` a (base) level of the campaign? @param {string} id */
  isLevel(id) {
    return !!campaignLevel(this.campaign, id);
  }

  /** Is a story flag set? @param {string} flag */
  has(flag) {
    return this.state.has(flag);
  }

  /** The file to play for base level `id` in the current chapter. @param {string} id */
  fileFor(id) {
    return chapterLevelId(this.campaign, id, this.holds);
  }

  /**
   * Where the text played as file `fileId` comes from (below the site root): its own file, or the
   * file a start or a play-test played in its place (a chapter variant: `CampaignLevels.textPath`).
   * What the game's `source` is: the file actually played (its texts' keys are the ones that file
   * holds, docs/specs/I18N.md §4.2).
   * @param {string} fileId
   */
  sourceOf(fileId) {
    return this.levels.textPath(fileId);
  }

  /** The chapter in force (its id; '' = none). */
  chapterId() {
    return activeChapter(this.campaign, this.holds)?.id ?? '';
  }

  /**
   * A loaded level as the story has it on entering: objects of the types applied on entering only
   * are left out when their `when` / `unless` say so; the live ones stay (the story runner shows and
   * hides them) — enemy groups, chests and waystones among them: a combat level loads every one,
   * present or not, so it keeps combat even when the story has every enemy away (the guard below
   * forces `environment.combat` should a level ever lose its enemies here).
   * @template {Level} L
   * @param {L} level
   * @param {string} [levelId] the base level it is played as (conditions read `level` and `done:`
   *   there; default: the level played now)
   * @returns {L}
   */
  storyLevel(level, levelId = this.levelId) {
    const out = applyStory(level, levelId === this.levelId ? this.holds : this._holdsIn(() => levelId), { live: true });
    if (out !== level && levelHasCombat(level) && !levelHasCombat(out)) {
      return { ...out, environment: { ...(out.environment ?? {}), combat: true } };
    }
    return out;
  }

  /**
   * What the story makes of a level's story-conditioned objects as it stands now in level
   * `levelId`: `key`, one character per such object ('1' there, '0' not), and `present`, the
   * presence test of this moment (a snapshot: a level built ahead is built for exactly `key`, how
   * ever long its build takes). Two equal keys: `storyLevel` and the world built from it are the
   * same (KNOWN_ISSUES CMP-01: a level built ahead is used only while its key holds).
   * @param {Level} level a parsed level file (the story not applied)
   * @param {string} levelId
   * @returns {{ key: string, present: (o: LevelObject) => boolean }}
   */
  presence(level, levelId) {
    const holds = this._holdsIn(() => levelId);
    /** @type {Map<LevelObject, boolean>} */
    const snap = new Map();
    let key = '';
    for (const o of level.objects) {
      // (only what the world builds — props, waterfalls, chests, waystones, particle areas: villagers,
      // exits, events, critters and enemies are made or applied at the travel anyway, so a change of
      // theirs keeps a level built ahead)
      if (!hasStoryCondition(o) || !isOwnKey(OBJECT_TYPES, o.type) || (OBJECT_TYPES[o.type].kind !== 'prop' && o.type !== 'emitter')) continue;
      const on = storyAllows(o, holds);
      snap.set(o, on);
      key += on ? '1' : '0';
    }
    // (a level with a frost or states: whether it is frozen and which states hold — a world built
    // ahead is built frozen or thawed, EVERMERE_CAMPAIGN.md §6.1)
    const env = /** @type {Partial<LevelEnvironment>} */ (level.environment);
    if (env?.frost || env?.states) {
      key += env.frost?.until && holds(env.frost.until) ? '|t' : '|f';
      for (const s of Array.isArray(env.states) ? env.states : []) key += s?.when && holds(s.when) ? '1' : '0';
    }
    return { key, present: (o) => snap.get(o) ?? storyAllows(o, holds) };
  }

  /**
   * Link to the game (its constructor). The page saves when it is hidden or left.
   * @param {Game} game
   */
  attach(game) {
    this.game = game;
    document.addEventListener('visibilitychange', this._onHide);
    window.addEventListener('pagehide', this._onPageHide);
  }

  /**
   * Link to the game's story runtime (Game._createStory): conditions read its values from now on.
   * @param {StoryRunner} runner
   */
  attachStory(runner) {
    this.runner = runner;
  }

  /**
   * A level was built (Game._buildLevel): read its exits; Space exits become interactables of the
   * world (prompt `label` at the rect's centre). Exits come and go with the story (`when` /
   * `unless`, live). The exits' texts are shown by the keys the exits hold (docs/specs/I18N.md §4.2:
   * the prompt's by `textKeyOf(it.object, 'label')`, Game.js `promptLabel`; the `locked` pages by
   * `pageKeyOf`).
   * @param {World} world
   */
  attachWorld(world) {
    const level = world.level;
    this._exits = levelExits(level).filter((o) => o.maxX > o.minX && o.maxZ > o.minZ);
    this._exitPrompts.clear();
    this._armed = false;
    for (const o of this._exits) {
      if (o.mode !== 'use') continue;
      const cx = (o.minX + o.maxX) / 2;
      const cz = (o.minZ + o.maxZ) / 2;
      const y = world.groundAt(cx, cz);
      const it = {
        id: `exit:${o.id}`,
        position: new THREE.Vector3(cx, y, cz),
        radius: Math.max(0.9, Math.hypot(o.maxX - o.minX, o.maxZ - o.minZ) / 2 + 0.3),
        label: text(o.label) || 'Enter',
        kind: 'exit',
        prompt: new THREE.Vector3(cx, y + 1.7, cz),
        lookSpan: null,
        area: { minX: o.minX, maxX: o.maxX, minZ: o.minZ, maxZ: o.maxZ },
        text: { speaker: '', lines: [] },
        object: o,
        disabled: !this._present(o),
        onInteract: () => this.tryExit(o, { fromInteract: true }),
      };
      world.interactables.push(it);
      this._exitPrompts.set(o, it);
    }
  }

  /** Is an object there as the story stands? */
  _present(o) {
    return this.runner ? this.runner.present(o) : true;
  }

  /**
   * Per frame while playing (Game.update): walk exits, preloading, a slice of the level built
   * ahead (`_prepareAhead`), the banner of a chapter begun in a cutscene (`_showChapterBanner`).
   * @param {number} dt
   * @param {{ blocked?: boolean }} [opts] blocked: a dialog, the map, photo mode or a combat lock
   */
  update(dt, { blocked = false } = {}) {
    const g = this.game;
    if (!g || this._traveling || g.mode !== 'play') {
      this._freeT = 0;
      return;
    }
    if (this._started) this.state.playTime += dt;
    // (the banner of a chapter begun in a cutscene: once the player has the screen again)
    const r = this.runner;
    this._freeT = r?.run || r?.queue.length || g.busy || blocked || g.ui.fader.opacity > 0 ? 0 : this._freeT + dt;
    if (this._chapterBanner) this._showChapterBanner();
    const p = g.player.position;
    let inside = null;
    for (const o of this._exits) if (inExit(o, p.x, p.z) && this._present(o)) { inside = o; break; }
    if (!this._armed) {
      if (!inside) this._armed = true;
    } else if (inside && inside.mode !== 'use' && !blocked && !g.busy) {
      this.tryExit(inside);
    }
    this._preloadT -= dt;
    if (this._preloadT <= 0) {
      this._preloadT = 0.5;
      let ahead = '';
      let aheadD2 = Infinity;
      for (const o of this._exits) {
        const to = text(o.to);
        const d2 = exitDistance2(o, p.x, p.z);
        if (d2 < PRELOAD_DISTANCE * PRELOAD_DISTANCE && campaignLevel(this.campaign, to) && this._present(o)) {
          this.levels.preload(this.fileFor(to));
          // the nearest exit that would open: its level is built ahead
          const req = text(o.requires);
          if (d2 < aheadD2 && (!req || this.holds(req))) {
            ahead = to;
            aheadD2 = d2;
          }
        }
      }
      this._prepareAhead(ahead, p);
    }
    // the level built ahead: some milliseconds of it while the page is idle
    if (this._prep) this._stepPrep();
  }

  /**
   * Ask for the next slice of the level built ahead: in an idle period after this frame (as much
   * as it leaves, up to PREPARE_IDLE_MAX_MS), else after PREPARE_IDLE_TIMEOUT_MS anyway; in this
   * frame where the browser has no idle callbacks.
   */
  _stepPrep() {
    if (this._idleId) return;
    if (typeof requestIdleCallback !== 'function') {
      this._prep.step(PREPARE_BUDGET_MS);
      return;
    }
    this._idleId = requestIdleCallback((deadline) => {
      this._idleId = 0;
      // (a travel took it meanwhile, or play stopped: nothing until play goes on)
      if (!this._prep || this._traveling || this.game?.mode !== 'play') return;
      const budget = deadline.didTimeout ? PREPARE_BUDGET_MS : Math.min(PREPARE_IDLE_MAX_MS, deadline.timeRemaining() - PREPARE_IDLE_MARGIN_MS);
      if (budget >= 1) this._prep.step(budget);
    }, { timeout: PREPARE_IDLE_TIMEOUT_MS });
  }

  /**
   * Keep the level the player is heading for built ahead (KNOWN_ISSUES CMP-01; every 0.5 s while
   * playing): `to` is the target of the nearest open exit within PRELOAD_DISTANCE ('' none). A
   * preparation of another level or file is dropped (one at a time), one whose story presence
   * changed meanwhile is begun again, and one without an exit toward it within
   * PREPARE_KEEP_DISTANCE is dropped. A failed one stays (not begun again) until the target changes.
   * @param {string} to
   * @param {{ x: number, z: number }} p the player
   */
  _prepareAhead(to, p) {
    const prep = this._prep;
    const fileId = to ? this.fileFor(to) : '';
    // (a level set aside from a file the campaign no longer plays for it — a chapter's variant
    // since —: released now, its variant built ahead below; one still played: attached again, not
    // built — nothing to build ahead for it)
    if (to && this._asideOf(to) && this._asideOf(to).fileId !== fileId) this._release(this._takeAside(to));
    if (to && this._asideOf(to)?.fileId === fileId) {
      if (prep) {
        prep.dispose();
        this._prep = null;
        this._releaseNextMusic();
      }
      return;
    }
    if (prep) {
      const wanted = to
        ? prep.to === to && prep.fileId === fileId
        : prep.fileId === this.fileFor(prep.to) && this._exits.some((o) => text(o.to) === prep.to && this._present(o) && exitDistance2(o, p.x, p.z) < PREPARE_KEEP_DISTANCE ** 2);
      const stale = !!prep.raw && prep.state !== 'failed' && this.presence(prep.raw, prep.to).key !== prep.presence;
      if (wanted && !stale) return;
      prep.dispose();
      this._prep = null;
    }
    if (!to || !this.prepareAhead || !this.game?.prepareWorld) {
      if (prep) this._releaseNextMusic();
      return;
    }
    this._prep = new LevelPreparation({
      to,
      fileId,
      text: this.levels.text(fileId),
      host: {
        apply: (raw) => {
          const { key, present } = this.presence(raw, to);
          return { level: this.storyLevel(raw, to), presence: key, present };
        },
        world: (level, present) => this.game.prepareWorld(level, present),
        // (its music too, kept as the next level's until another is prepared or none is)
        music: (level) => this.game.primeLevelMusic?.(level, 'next'),
      },
    });
  }

  /**
   * The level built ahead for file `fileId` as level `to`, taken out of `_prep` for a travel (null
   * when there is none; a preparation of anything else is dropped, and the music kept for it — one
   * taken keeps it until the travel is over: `travel`).
   * @param {string} fileId
   * @param {string} to
   */
  _takePrep(fileId, to) {
    const prep = this._prep;
    this._prep = null;
    if (!prep) return null;
    if (prep.fileId === fileId && prep.to === to) return prep;
    prep.dispose();
    this._releaseNextMusic();
    return null;
  }

  /** No level is built ahead any more: the music kept for it is released (AudioSystem `retainMusic`). */
  _releaseNextMusic() {
    this.game?.audio?.retainMusic('next', []);
  }

  /** Is a travel going on? */
  get traveling() {
    return this._traveling;
  }

  /**
   * The level set aside as base level `id` (either slot), or null.
   * @param {string} id
   * @returns {AsideEntry|null}
   */
  _asideOf(id) {
    const a = this._aside;
    return a.parent?.id === id ? a.parent : a.room?.id === id ? a.room : null;
  }

  /**
   * Set levels aside around rooms (CAMPAIGN_FORMAT.md §6.3; true by default). False: every travel
   * builds its level and releases the one left — switching it off releases the levels set aside now.
   */
  get keepRooms() {
    return this._keepRooms;
  }

  set keepRooms(v) {
    this._keepRooms = !!v;
    if (!this._keepRooms) this.dropAside();
  }

  /**
   * Take the level set aside as `id` out of its slot for a travel (null when there is none).
   * @param {string} id
   * @returns {AsideEntry|null}
   */
  _takeAside(id) {
    const a = this._aside;
    for (const slot of /** @type {const} */ (['parent', 'room'])) {
      const e = a[slot];
      if (e?.id !== id) continue;
      a[slot] = null;
      return e;
    }
    return null;
  }

  /**
   * Can a level set aside be attached again as level `to` from file `fileId`: the same file, its
   * text unchanged, and the story giving the same objects from it (`storyLevel` — what the story
   * changed meanwhile is applied live on attach: StoryRunner.applyPresence)?
   * @param {AsideEntry} e
   * @param {string} fileId
   * @param {string} to
   */
  async _asideHolds(e, fileId, to) {
    if (e.fileId !== fileId || !e.raw || e.text !== await this.levels.text(fileId)) return false;
    const now = this.storyLevel(e.raw, to);
    const was = e.kept.level;
    return now === was || (now.objects.length === was.objects.length && now.objects.every((o, i) => o === was.objects[i]));
  }

  /**
   * Keep a level the player left in slot `slot` (an older one there is released).
   * @param {'parent'|'room'} slot
   * @param {AsideEntry} e
   */
  _putAside(slot, e) {
    const old = this._aside[slot];
    this._aside[slot] = e;
    if (old) this._release(old);
  }

  /** @param {AsideEntry} e */
  _release(e) {
    this.stats.dropped++;
    try {
      this.game?.disposeKept(e.kept);
    } catch (err) {
      console.warn(`[Luminati] releasing the level "${e.id}" set aside failed:`, err);
    }
  }

  /**
   * Release every level set aside (a travel to a level that is neither a room nor set aside, a new
   * game, the game's end).
   */
  dropAside() {
    const a = this._aside;
    const list = [a.parent, a.room].filter(Boolean);
    a.parent = null;
    a.room = null;
    for (const e of list) this._release(e);
  }

  /**
   * The player uses an exit: travel — or, while its `requires` condition does not hold, read
   * `locked`.
   * @param {LevelObjectOf<'exit'>} o
   * @param {{ fromInteract?: boolean }} [opts] fromInteract: a Space exit (Game._interact holds
   *   `busy` meanwhile)
   */
  async tryExit(o, { fromInteract = false } = {}) {
    const g = this.game;
    if (!g || this._traveling || (!fromInteract && g.busy) || !this._present(o)) return false;
    const req = text(o.requires);
    if (req && !this.holds(req)) {
      // (a walk exit fires again only after the player has stepped out of it)
      this._armed = false;
      // (the exit's `locked` pages, each translated alone by the key the exit holds for it — at its
      // raw index, `textPages`; the default that stands in for none is a UI string)
      const pages = textPages(o.locked);
      await this._say(pages.length ? pages.map((p) => loc(pageKeyOf(o, 'locked', p.i), p.text)) : [t('campaign.exit.closed')], fromInteract);
      return false;
    }
    const to = text(o.to);
    if (!campaignLevel(this.campaign, to)) {
      this._armed = false;
      console.warn(`[Luminati] exit "${o.id}" leads to "${to}", which is not a level of the campaign`);
      g.ui.hud.toast(t('campaign.exit.nowhere'), 2);
      return false;
    }
    return this.travel(to, { entrance: text(o.entrance) });
  }

  /**
   * The toast of a travel to `to` that failed: the level's name when it is known (a file that
   * loaded once, or the level that failed to build), else no name — never the level's id.
   * @param {string} to
   * @param {string} [name]
   */
  _travelFailed(to, name = this._names.get(to)) {
    this.game?.ui.hud.toast(name ? t('campaign.travel.failed', { place: term(name) }) : t('campaign.travel.failedUnknown'), 2.4);
  }

  /** A dialog page or two (a closed exit; translated), holding the player meanwhile. */
  async _say(lines, alreadyBusy) {
    const g = this.game;
    if (!alreadyBusy) g.busy = true;
    g.ui.prompt.hide();
    try {
      await g.ui.dialog.open({ speaker: '', lines });
    } finally {
      if (!alreadyBusy) g.busy = false;
      g._talkCooldown = 0.8;
    }
  }

  /**
   * Switch to level `to` (a base id; the current chapter picks the file) behind the fader: at
   * `entrance`, else across the seam (both levels placed), else at its player start. A level that
   * fails to build puts the player back where they were.
   * @param {string} to
   * @param {{ entrance?: string, banner?: boolean, start?: boolean, fresh?: boolean,
   *   fromStory?: boolean }} [opts] banner: show the level's banner after; start: arrive at the
   *   entrance or the player start, never across a seam (a new game); fresh: the level left carries
   *   nothing over (a new game: its combat progress and chests are not the new story's);
   *   fromStory: a story script's `travel` (it holds the player already)
   * @returns {Promise<boolean>} false when the level could not be loaded (the player stays)
   */
  async travel(to, { entrance = '', banner = true, start = false, fresh = false, fromStory = false } = {}) {
    const g = this.game;
    if (!g || this._traveling) return false;
    // (a story run travels from inside the run; anything else only from play — not mid-dialog)
    if (!fromStory && !start && g.mode === 'play' && g.ui.dialog.isOpen && !g.busy) return false;
    this._traveling = true;
    const t0 = performance.now();
    const wasBusy = g.busy;
    g.busy = true;
    const from = this.levelId;
    const fromFile = this.fileId;
    const fileId = this.fileFor(to);
    // (a new story keeps nothing of the one before)
    if (fresh) this.dropAside();
    // the level set aside on an earlier visit (attached again below while its file still holds:
    // CAMPAIGN_FORMAT.md §6.3) — else the level built ahead for this file (used below while its
    // inputs still hold), else the file
    let aside = this._takeAside(to);
    // (set aside from another file — a chapter's variant since —: released now, so the level built
    // ahead for the new file is used instead of being thrown away for it)
    if (aside && aside.fileId !== fileId) {
      this._release(aside);
      aside = null;
    }
    let prep = this._takePrep(fileId, to);
    // (the music kept for the level built ahead is released once this travel is over — used, the
    // level arrived at keeps it as its own: Game._buildLevel; not used, nobody wants it)
    const tookPrep = !!prep;
    if (aside && prep) {
      prep.dispose();
      prep = null;
    }
    const pending = prep || aside ? null : this.levels.load(fileId);
    pending?.catch(() => {});
    /** The level set aside was handed to `swapLevel` (from then on the game releases it on a failure). */
    let handed = false;
    const pos = { x: g.player.position.x, z: g.player.position.z };
    const facing = g.player.sprite.direction;
    g.toggleMap(false);
    g.toggleJournal?.(false);
    g.ui.prompt.hide();
    try {
      // (a screen covered already — a story's `fade out … white` — stays in its colour through the
      // travel, into the next level's fade in)
      const fader = g.ui.fader;
      await fader.fadeOut(FADE_OUT, fader.opacity >= 1 ? fader.color : undefined);
      let loaded;
      /** @type {LevelPreparation|null} */
      let prepared = null;
      try {
        // (set aside from a file that changed meanwhile — a chapter's variant —, or with objects
        // the story now has otherwise on entering: released, the level built as usual)
        if (aside && !(await this._asideHolds(aside, fileId, to))) {
          this._release(aside);
          aside = null;
        }
        if (aside) loaded = { level: aside.raw, warnings: [] };
        // (built ahead from the same text, for the same story presence: its level and world)
        else if (prep && (prep.state === 'building' || prep.state === 'ready') && prep.text === await this.levels.text(fileId)
          && prep.presence === this.presence(prep.raw, to).key) {
          prepared = prep.take();
          loaded = { level: prep.raw, warnings: prep.warnings };
        } else {
          prep?.dispose();
          loaded = await (pending ?? this.levels.load(fileId));
        }
      } catch (err) {
        prep?.dispose();
        if (aside) {
          this._release(aside);
          aside = null;
        }
        console.warn(`[Luminati] ${err?.message ?? err}`);
        this._travelFailed(to);
        this._armed = false;
        await g.ui.fader.fadeIn(FADE_IN);
        return false;
      }
      this.stats.lastPrep = prep ? { ...prep.info(), used: !!prepared } : null;
      for (const w of loaded.warnings) console.warn(`[Luminati] ${this.levels.path(fileId)}: ${w}`);
      const level = aside ? aside.kept.level : prepared ? prepared.level : this.storyLevel(loaded.level, to);
      const spawn = this.arrival(level, start ? '' : from, to, entrance, pos, facing);
      const prevLevel = g.level;
      const prevRaw = this.levelRaw;
      // levels set aside (CAMPAIGN_FORMAT.md §6.3): going to a level that is neither a room nor
      // set aside releases them all; the level left is set aside when it is a room (the last
      // room) or the player goes into one (the parent) — never a combat level
      const toRoom = isInterior(level.environment);
      const fromRoom = isInterior(prevLevel.environment);
      if (!toRoom && !aside) this.dropAside();
      let keepText = null;
      if (this.keepRooms && !fresh && to !== from && (fromRoom || toRoom) && !g.combatEnabled && prevRaw) {
        keepText = await this.levels.text(fromFile).catch(() => null);
      }
      if (!fresh) this._leaveLevel();
      this.levelId = to;
      this.fileId = fileId;
      const tb = performance.now();
      /** @type {KeptLevel|null} */
      let left = null;
      handed = true;
      try {
        ({ aside: left } = await g.swapLevel(level, { spawn, source: this.sourceOf(fileId), prepared, kept: aside?.kept ?? null, keep: keepText !== null }));
      } catch (err) {
        // the new level failed to build (or the level set aside failed to attach: swapLevel
        // released it, and the level left): back to the one the player left, built again
        console.error(`[Luminati] could not enter "${to}":`, err);
        this.levelId = from;
        this.fileId = fromFile;
        try {
          await g.swapLevel(prevLevel, { spawn: { ...pos, facing }, source: this.sourceOf(fromFile) });
          this._enterLevel(prevLevel);
        } catch (err2) {
          console.error('[Luminati] could not return to the previous level either:', err2);
        }
        this._travelFailed(to, level.name);
        await g.ui.fader.fadeIn(FADE_IN);
        return false;
      }
      this.stats.lastBuildMs = Math.round(performance.now() - tb);
      if (prepared) this.stats.prepared++;
      this.stats.lastKept = !!aside;
      if (aside) this.stats.kept++;
      this.levelRaw = aside ? aside.raw : loaded.level;
      const slot = fromRoom ? 'room' : 'parent';
      this.stats.lastAside = left ? slot : '';
      if (left) this._putAside(slot, { id: from, fileId: fromFile, text: keepText, raw: prevRaw, kept: left });
      this._enterLevel(level);
      this._armed = false;
      this.state.level = to;
      this.state.via = { from, entrance };
      // (the save of the level left becomes the backup)
      this.save({ milestone: true });
      this.stats.travels++;
      this.stats.lastMs = Math.round(performance.now() - t0);
      // the story: the new level's `arrive` events — an arrival cutscene that opens with a `fade in`
      // (StoryRunner.openingRun) keeps the screen covered and shows no banner: its script reveals it
      g.story?.onArrive();
      if (g.story?.openingRun()) g.rig.snap();
      else {
        await g.ui.fader.fadeIn(FADE_IN);
        // (the name a term, the subtitle by the key the level holds — I18N.md §4.2, §4.8)
        if (banner) g.ui.banner.show(term(level.name), loc(textKeyOf(level, 'subtitle'), level.subtitle), { duration: 3.2 });
      }
      return true;
    } finally {
      // (taken for this travel but not attached — something threw before the swap: released)
      if (aside && !handed) this._release(aside);
      if (tookPrep) this._releaseNextMusic();
      g.busy = wasBusy;
      this._traveling = false;
    }
  }

  /**
   * Where the player arrives in `level` (base id `to`) coming from `from`: the named entrance (one
   * the story has there now); else across the seam (`pos` mapped through the campaign plane, when
   * it lands within 3 u of the map), moved out of the exit it lands in toward the inside of the
   * map; else the level's player start.
   * @param {Level} level
   * @param {string} from
   * @param {string} to
   * @param {string} entrance
   * @param {{ x: number, z: number }} pos the player's position in `from`
   * @param {string} facing the player's facing now
   * @returns {{ x: number, z: number, facing: string }}
   */
  arrival(level, from, to, entrance, pos, facing) {
    if (entrance) {
      const e = findEntrance(level, entrance, this._holdsIn(() => to)) ?? findEntrance(level, entrance);
      if (e) return { x: e.x, z: e.z, facing: e.facing ?? 'down' };
      console.warn(`[Luminati] level "${to}" has no entrance "${entrance}": arriving at its player start`);
      return { ...level.spawn };
    }
    const q = from ? acrossSeam(this.campaign, from, to, pos.x, pos.z) : null;
    const W = level.width;
    const D = level.depth;
    // (not near the seam — a travel from anywhere, e.g. a script: the player start)
    if (!q || q.x < -3 || q.z < -3 || q.x > W + 3 || q.z > D + 3) return { ...level.spawn };
    // (the mapped point lies past the target's edge when the exit spans the seam: onto the map first)
    q.x = Math.min(W - 0.4, Math.max(0.4, q.x));
    q.z = Math.min(D - 0.4, Math.max(0.4, q.z));
    for (const o of levelExits(level)) {
      if (!(q.x >= o.minX - 0.3 && q.x <= o.maxX + 0.3 && q.z >= o.minZ - 0.3 && q.z <= o.maxZ + 0.3)) continue;
      // the nearest way out of the rect that stays on the map
      const moves = [
        { x: o.minX - ARRIVE_CLEAR, z: q.z }, { x: o.maxX + ARRIVE_CLEAR, z: q.z },
        { x: q.x, z: o.minZ - ARRIVE_CLEAR }, { x: q.x, z: o.maxZ + ARRIVE_CLEAR },
      ].filter((m) => m.x > 0.4 && m.z > 0.4 && m.x < W - 0.4 && m.z < D - 0.4)
        .sort((a, b) => Math.hypot(a.x - q.x, a.z - q.z) - Math.hypot(b.x - q.x, b.z - q.z));
      if (moves.length) { q.x = moves[0].x; q.z = moves[0].z; }
    }
    q.x = Math.min(W - 0.4, Math.max(0.4, q.x));
    q.z = Math.min(D - 0.4, Math.max(0.4, q.z));
    return { x: q.x, z: q.z, facing };
  }

  /**
   * Before leaving a level (and at every save there): what it changed that the campaign keeps —
   * combat progress and gold, the chests opened, the enemy groups defeated (as they stand now: a
   * waystone rest brought the fallen back, so its groups leave the list; a defeated boss stays).
   */
  _leaveLevel() {
    const g = this.game;
    if (!g?.combat) return;
    this.state.combat = g.combat.exportProgress();
    this.state.story.gold = this.state.combat.gold;
    const opened = new Set([...(this.state.opened[this.levelId] ?? []), ...g.combat.openedChests()]);
    if (opened.size) this.state.opened[this.levelId] = [...opened];
    // (ids of groups this file does not have stay — a chapter variant may lack a group another
    // has; a rest here clears only this file's)
    const here = new Set(g.level.objects.filter((o) => o.type === 'enemy').map((o) => o.id));
    const kept = (this.state.cleared[this.levelId] ?? []).filter((id) => !here.has(id));
    const cleared = [...kept, ...g.combat.defeatedGroups()];
    if (cleared.length) this.state.cleared[this.levelId] = cleared;
    else delete this.state.cleared[this.levelId];
    // the foes fallen in groups not yet defeated, on a level where nothing respawns (the same rule
    // for the uids of groups this file does not have; COMBAT.md §29 V18)
    const keptFallen = (this.state.fallen[this.levelId] ?? []).filter((uid) => !here.has(uid.slice(0, uid.lastIndexOf('#'))));
    const fallen = [...keptFallen, ...g.combat.fallenFoes()];
    if (fallen.length) this.state.fallen[this.levelId] = fallen;
    else delete this.state.fallen[this.levelId];
  }

  /**
   * After entering a level: its clock, weather and music (its `soundtrack`'s track for exploring,
   * else `emberfall`), the player's combat progress and the chests opened before. A level with its
   * own fixed hour (`environment.clock: false`: an interior,
   * a set piece) shows that hour and its own weather while the campaign's clock and weather pause;
   * the next level with a running clock goes on from where the player left them. An outdoor level
   * keeps the campaign's weather unless it sets one of its own. A room (`environment.interior`)
   * shows no weather at all — its own `weather` is ignored — while the campaign's goes on (it is
   * `game.weather.weather`, which R cycles and saves keep; Weather shows clear skies indoors).
   * @param {Level} level
   */
  _enterLevel(level) {
    const g = this.game;
    const env = /** @type {Partial<LevelEnvironment>} */ (level.environment ?? {});
    const room = isInterior(env);
    if (env.clock === false) {
      this._outsideTime ??= g.lighting.timeOfDay;
      g.setTime(Number.isFinite(env.timeOfDay) ? env.timeOfDay : 17.2);
      g.lighting.timeSpeed = 0;
      if (room) {
        // (the weather goes on: what was outside — a set piece's own weather before, if any)
        g.weather.setWeather(this._outsideWeather ?? g.weather.weather, { instant: true });
        this._outsideWeather = null;
      } else {
        this._outsideWeather ??= g.weather.weather;
        g.weather.setWeather(env.weather ?? 'clear', { instant: true });
      }
    } else {
      if (this._outsideTime !== null) g.setTime(this._outsideTime);
      this._outsideTime = null;
      g.lighting.timeSpeed = TIME_SPEED;
      const weather = !room && env.weather && env.weather !== 'clear' ? env.weather : this._outsideWeather ?? g.weather.weather;
      this._outsideWeather = null;
      g.weather.setWeather(weather, { instant: true });
    }
    // the level's frost and states as the story stands (src/game/thaw/LevelStates.js: `envNow`)
    g.applyLevelStates(level);
    // (the level's own track for exploring — `environment.soundtrack.explore`, else `emberfall` —
    // as its states have it now: `envNow`, EVERMERE_CAMPAIGN.md §7.4)
    const track = soundtrackOf(g.envNow, 'explore');
    if (env.music === false) g.audio.stopMusic();
    else if (g.musicWanted && g.audio.ready && (!g.audio.musicPlaying || g.audio.musicTrack !== track)) g.audio.startMusic({ track, fade: 2 });
    this._restoreCombat();
  }

  /**
   * On a combat level: the progress from earlier combat levels and the story's purse, the chests
   * opened before, the enemy groups defeated before (not there: no drop, XP or `cleared` event).
   */
  _restoreCombat() {
    const c = this.game?.combat;
    if (!c) return;
    const gold = this.state.story.gold;
    if (this.state.combat) c.importProgress({ ...this.state.combat, gold });
    else c.pc.gold = gold;
    const opened = this.state.opened[this.levelId];
    if (opened?.length) c.markChestsOpened(opened);
    const cleared = this.state.cleared[this.levelId];
    if (cleared?.length) c.markGroupsCleared(cleared, { released: this._replayedGroups() });
    // (and on a level where nothing respawns, the single foes fallen before: rv-play #8)
    const fallen = this.state.fallen[this.levelId];
    if (fallen?.length) c.markFoesFallen(fallen);
  }

  /**
   * The enemy groups whose `cleared` event run a save kept (`story.pending`, a Continue replays it):
   * a released boss of one comes back as its released body for the scene (COMBAT.md §30 E7, EV-52).
   * @returns {Set<string>}
   */
  _replayedGroups() {
    const out = new Set();
    const pending = this.state.story.pending ?? [];
    if (!pending.length) return out;
    for (const o of this.game.level.objects) {
      if (o.type !== 'event' || o.on !== 'cleared' || typeof o.group !== 'string') continue;
      if (pending.some((k) => k.startsWith('event:') && k.endsWith(`.${o.id}`))) out.add(o.group.trim());
    }
    return out;
  }

  /**
   * The game started (Game.init, after the warm-up): a continued game gets its saved time,
   * weather and combat progress; a new one its debug start preset (`&story=`). Saves are allowed
   * from now on.
   */
  onStart() {
    const g = this.game;
    const s = this.state;
    const env = /** @type {Partial<LevelEnvironment>} */ (g.level.environment ?? {});
    // (in a level with its own hour the saved hour and weather are the campaign's, for when the
    // player leaves — a room's weather is the campaign's, not shown inside)
    if (env.clock === false) {
      this._outsideTime = s.time;
      if (isInterior(env)) g.weather.setWeather(s.weather, { instant: true });
      else this._outsideWeather = s.weather;
    } else {
      if (s.time !== null) g.setTime(s.time);
      // (a room's own `weather` is ignored: the campaign's goes on)
      const own = !isInterior(env) && env.weather && env.weather !== 'clear' ? env.weather : '';
      if (s.weather !== 'clear' || env.weather) g.weather.setWeather(own || s.weather, { instant: true });
    }
    this._restoreCombat();
    this.state.chapter = this.chapterId();
    this._chapterBanner = null;
    this._started = true;
    // (the saved hour is the game setting the clock, not time passing)
    this.runner?.resyncClock();
  }

  /**
   * The story changed (StoryRunner, once per frame after a change): a chapter it begins is in
   * force at once (its level variants are played from the next travel on) and announced with a
   * banner once the player has the screen (`_showChapterBanner`: at once in play, after the
   * cutscene that began it); Space exits' prompts follow their `when` / `unless`.
   * @param {{ save?: boolean }} [opts] save: write the save (not while a run goes on)
   */
  onStoryChange({ save = true } = {}) {
    const ch = activeChapter(this.campaign, this.holds);
    const id = ch?.id ?? '';
    if (id !== this.state.chapter) {
      // (the chapter is in force at once — conditions, the save; its banner waits for play)
      this.state.chapter = id;
      this._chapterBanner = ch && (ch.title || ch.subtitle) && this._started ? ch : null;
      this._showChapterBanner();
    }
    for (const [o, it] of this._exitPrompts) it.disabled = !this._present(o);
    if (save && !this.runner?.run) this.save();
  }

  /**
   * The banner of a chapter begun (`_chapterBanner`), once the player has the screen: no story run
   * going on or queued, no travel, play free (no dialog, no busy game), the fader clear, play
   * resumed for `CHAPTER_BANNER_IDLE` s and no other banner up (an area's shown after a cutscene
   * goes first) — a chapter begun by a cutscene is announced when the scene and what follows it
   * (a travel, the next level's arrival scene) are over, never over a shot (CAMPAIGN_FORMAT.md
   * §5). One begun in a run that ends the story (`ending`) is never shown. Called when a chapter
   * begins and every frame of play (`update`).
   */
  _showChapterBanner() {
    const ch = this._chapterBanner;
    const g = this.game;
    if (!ch || !g) return;
    if (this.state.story.ending) {
      this._chapterBanner = null;
      return;
    }
    if (this._freeT < CHAPTER_BANNER_IDLE || g.ui.banner.visible) return;
    if (performance.now() - (g.story?.cardShownAt ?? -Infinity) < CHAPTER_AFTER_CARD_MS) return;
    this._chapterBanner = null;
    // (each text by the key the chapter holds for it — a chapter without a title shows its
    // subtitle as the banner's title, keyed as the subtitle it is)
    const key = (/** @type {'title'|'subtitle'} */ part) => textKeyOf(ch, part);
    const head = ch.title ? loc(key('title'), ch.title) : loc(key('subtitle'), ch.subtitle);
    g.ui.banner.show(head, ch.title ? loc(key('subtitle'), ch.subtitle) : '', { duration: 3.6 });
  }

  /**
   * Set a story flag (a villager's `flag` after the conversation, the test hook). The story runner
   * notices the change (chapters, presence, `change` events).
   * @param {string} flag
   * @returns {boolean} true when the flag was new
   */
  setFlag(flag) {
    const changed = this.state.set(flag);
    if (changed) this.onStoryChange();
    return changed;
  }

  /**
   * A script's `time <h>`: the campaign's hour (inside a level with its own hour, the hour the
   * player finds outside). With `seconds` (`time <h> <seconds>`, EVERMERE_CAMPAIGN.md §5.6) the
   * shown hour glides there over them — inside a level with its own hour too (its `states` keep
   * the hour on the next arrival); a running clock glides on its own.
   * @param {number} h
   * @param {{ seconds?: number }} [opts]
   */
  setStoryTime(h, { seconds = 0 } = {}) {
    const g = this.game;
    if (this._outsideTime !== null) {
      this._outsideTime = ((h % 24) + 24) % 24;
      if (seconds > 0) g?.weather.setTime(h, { duration: seconds });
    } else if (seconds > 0) g?.weather.setTime(h, { duration: seconds });
    else g?.setTime(h);
  }

  /** Rested until morning (Game.restUntilMorning): inside a level with its own hour, the campaign's morning. */
  onRest() {
    if (this._outsideTime !== null) this._outsideTime = 8;
  }

  /** The campaign's hour now (inside a level with its own hour: the hour outside). */
  hour() {
    return this._outsideTime ?? this.game?.lighting.timeOfDay ?? 0;
  }

  /** The save object of the game as it is now (position, time, weather, story, combat). */
  _saveObject() {
    const g = this.game;
    const s = this.state;
    if (g?.player && g.mode !== 'travel') {
      s.level = this.levelId;
      const facing = /** @type {LevelSpawn['facing']} */ (g.player.sprite.direction);
      s.at = { x: +g.player.position.x.toFixed(3), z: +g.player.position.z.toFixed(3), facing };
      s.time = +(this._outsideTime ?? g.lighting.timeOfDay).toFixed(3);
      s.weather = this._outsideWeather ?? g.weather.weather;
      if (g.combat) this._leaveLevel();
    }
    // (event runs queued or going on run again on Continue)
    s.story.pending = this.runner?.pendingKeys() ?? [];
    return s.toJSON();
  }

  /**
   * A story run began (StoryRunner): saves meanwhile write the game as it was now (a run is
   * atomic: a reload replays it, never half of it).
   */
  holdSaves() {
    if (this._started && !this._held) this._held = this._saveObject();
  }

  /** The run ended: saves write the game as it is again. */
  releaseSaves() {
    this._held = null;
  }

  /**
   * Save the game now (position, time, weather, the story, combat). Nothing before the game started.
   * @param {{ milestone?: boolean }} [opts] milestone: a travel — the save replaced becomes the backup
   */
  save({ milestone = false } = {}) {
    if (!this._started) return false;
    const ok = this.state.save(this._held ?? this._saveObject(), { milestone });
    if (!ok && !this._saveFailed && this.state.readVersion <= SAVE_VERSION) {
      this._saveFailed = true;
      this.game?.ui.hud.toast(t('campaign.save.failed'), 3, { kind: 'error' });
    }
    return ok;
  }

  /**
   * Begin again (the title's New journey): forget the saved game and travel to the start — or to a
   * debug start preset's level with its values (`&story=`). A campaign with `progress`
   * (campaign.json, DRAGON_CAMPAIGN.md §5.1) starts with that combat progress (the new
   * CampaignState's `combat`: `startProgress`), imported by the first combat level (`_restoreCombat`).
   * @returns {Promise<boolean>}
   */
  async newGame() {
    const g = this.game;
    CampaignState.clear(this.name, { test: this.state.test });
    this.state = new CampaignState(this.campaign, this.name, { story: this.story, test: this.state.test });
    this.state.story.seed = journeySeed();
    this._applyStartPreset();
    this.runner?.setState(this.state.story);
    g.visits.clear();
    for (const k of Object.keys(g.inventory)) delete g.inventory[k];
    g.inventory.apples = 0;
    this.hasSave = false;
    this._outsideTime = null;
    this._outsideWeather = null;
    const p = this.startPreset;
    const level = p?.level && campaignLevel(this.campaign, p.level) ? p.level : this.campaign.start.level;
    const entrance = p?.level ? p.entrance : this.campaign.start.entrance;
    const ok = await this.travel(level, { entrance, banner: false, start: true, fresh: true });
    // a new story starts at its level's hour, in its weather
    const env = /** @type {Partial<LevelEnvironment>} */ (g.level.environment ?? {});
    if (ok && env.clock !== false) g.setTime(Number.isFinite(env.timeOfDay) ? env.timeOfDay : 17.2);
    this.state.chapter = this.chapterId();
    // (a new story begins in its chapter: no banner for it)
    this._chapterBanner = null;
    this._started = true;
    this.runner?.resyncClock();
    this.save();
    return ok;
  }

  /** A debug start preset's values on a new story (`&story=<name>`). */
  _applyStartPreset() {
    const p = this.startPreset;
    if (!p) return;
    const st = this.state.story;
    for (const [k, v] of Object.entries(p.vars)) st.setVar(k, v);
    for (const [k, v] of Object.entries(p.items)) st.addItem(k, v);
    for (const [q, stage] of Object.entries(p.quests)) {
      if (stage === 'done' || stage === 'failed') { st.questChange(q, 'start'); st.questChange(q, stage === 'done' ? 'done' : 'fail'); } else st.questChange(q, 'stage', { stage });
    }
    st.gold = p.gold;
    // (a preset deep in the story starts at the combat level the journey reaches there)
    if (p.progress) {
      const was = this.state.combat;
      this.state.combat = {
        level: p.progress.level, xp: 0, gold: 0, potions: p.progress.potions ?? was?.potions ?? 3,
        upgrades: { maxHp: 0, maxMp: 0, attack: 0, def: 0 }, wares: [],
      };
    }
  }

  /**
   * The title screen's options (translated): the campaign's title, and — when a saved game was
   * found at boot — a vertical menu (`menu: true`, docs/specs/PIXEL_UI.md §8.1) of Continue, its
   * second line the save (`saveLine`), and New journey. The campaign's texts by the keys
   * `campaign.json` holds (`textKeyOf(campaign, 'title.<k>')`, else its `subtitle`'s), its name as a
   * term, a blank prompt or an absent credit as the UI strings of those defaults (docs/specs/I18N.md
   * §4.2, §4.8).
   */
  titleOptions() {
    const c = this.campaign;
    const tt = c.title ?? {};
    const opts = {
      title: tt.title ? loc(textKeyOf(c, 'title.title'), tt.title) : term(c.name).toUpperCase(),
      titleSource: tt.title || c.name.toUpperCase(),
      subtitle: tt.subtitle != null ? loc(textKeyOf(c, 'title.subtitle'), tt.subtitle) : loc(textKeyOf(c, 'subtitle'), c.subtitle),
      prompt: tt.prompt ? loc(textKeyOf(c, 'title.prompt'), tt.prompt) : t('game.default.prompt'),
      credit: tt.credit != null ? loc(textKeyOf(c, 'title.credit'), tt.credit) : t('game.default.credit'),
    };
    if (!this.hasSave) return opts;
    return {
      ...opts,
      menu: true,
      destinations: [
        { value: 'continue', label: t('campaign.title.continue'), detail: this.saveLine() },
        { value: 'new', label: t('campaign.title.newJourney') },
      ],
      current: 'continue',
    };
  }

  /**
   * The Continue entry's second line (docs/specs/PIXEL_UI.md §8.1): where the saved game stands —
   * the region the player is in, else the level —, `Lv n` (the combat level carried, once there is
   * one) and the time played (`CampaignState.playTime`); the place alone for a save without a time.
   * Read at the title, with the saved level built and the player at the saved spot.
   */
  saveLine() {
    const g = this.game;
    const p = g?.player?.position;
    const r = p ? (g.regions ?? []).find((o) => p.x >= o.minX && p.x < o.maxX && p.z >= o.minZ && p.z < o.maxZ && (o.minY == null || p.y > o.minY)) : null;
    const place = term(text(r?.name) || g?.level?.name || '');
    const secs = Math.floor(this.state.playTime);
    if (secs < 1) return place;
    const time = formatPlayTime(secs);
    const level = this.state.combat?.level;
    return level ? t('campaign.title.save', { place, level, time }) : t('campaign.title.saveNoLevel', { place, time });
  }

  /**
   * The world map (N / Tab) of a level the campaign places (Game._setupMaps): every placed level
   * on its place on the campaign plane — the ones not visited yet dimmed — named, with this level's
   * regions; the player and the markers are drawn at `origin`. null for a level the campaign does
   * not place (its own map). The other levels' maps load in the background; the game sets the map
   * again when they arrive (`Game.refreshWorldMap`). The names are translated (shown as they come).
   * @param {ReturnType<typeof renderLevelMap>} levelMap this level's painted map
   * @param {Level} level
   * @returns {{ map: ReturnType<typeof renderLevelMap>, origin: [number, number], title: string,
   *   subtitle: string, regions: { name: string, minX: number, maxX: number, minZ: number, maxZ: number }[] }|null}
   */
  worldMap(levelMap, level) {
    if (!this.state.visited.includes(this.levelId)) this.state.visited.push(this.levelId);
    this._maps.set(this.fileId, levelMap);
    this._names.set(this.levelId, level.name);
    const here = campaignLevel(this.campaign, this.levelId);
    if (!here?.at) return null;
    this._loadMaps();
    const known = [];
    for (const l of this.campaign.levels) {
      const m = l.at ? this._maps.get(l.id === this.levelId ? this.fileId : this.fileFor(l.id)) : null;
      if (m) known.push({ l, m });
    }
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const { l, m } of known) {
      x0 = Math.min(x0, l.at[0]);
      z0 = Math.min(z0, l.at[1]);
      x1 = Math.max(x1, l.at[0] + m.width);
      z1 = Math.max(z1, l.at[1] + m.depth);
    }
    const pad = 2;
    x0 -= pad;
    z0 -= pad;
    x1 += pad;
    z1 += pad;
    const W = x1 - x0;
    const D = z1 - z0;
    // (one scale for every level; the canvas at most 2048 px on its long side)
    const ppt = Math.max(1, Math.min(...known.map(({ m }) => m.pixelsPerTile), Math.floor(2048 / Math.max(W, D))));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * ppt);
    canvas.height = Math.round(D * ppt);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = MAP_GROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    for (const { l, m } of known) {
      ctx.globalAlpha = this.state.visited.includes(l.id) ? 1 : UNVISITED_ALPHA;
      ctx.drawImage(m.canvas, (l.at[0] - x0) * ppt, (l.at[1] - z0) * ppt, m.width * ppt, m.depth * ppt);
    }
    ctx.globalAlpha = 1;
    const ox = here.at[0] - x0;
    const oz = here.at[1] - z0;
    // (names as terms; a level whose name is not known yet shows its id, which is no name)
    const levelName = (/** @type {string} */ id) => {
      const n = this._names.get(id);
      return n !== undefined ? term(n) : id;
    };
    const regions = [
      ...known.map(({ l, m }) => ({ name: levelName(l.id), minX: l.at[0] - x0, maxX: l.at[0] - x0 + m.width, minZ: l.at[1] - z0, maxZ: l.at[1] - z0 + m.depth })),
      ...level.objects.filter((o) => o.type === 'region').map((r) => ({ name: term(r.name), minX: r.minX + ox, maxX: r.maxX + ox, minZ: r.minZ + oz, maxZ: r.maxZ + oz })),
    ];
    return { map: { canvas, pixelsPerTile: ppt, width: W, depth: D }, origin: [ox, oz], title: term(this.campaign.name), subtitle: term(level.name), regions };
  }

  /** Paint the maps of the placed levels not painted yet (background; then the game re-sets its map). */
  _loadMaps() {
    if (this._mapsLoading) return this._mapsLoading;
    this._mapsLoading = (async () => {
      let added = false;
      for (const l of this.campaign.levels) {
        const fileId = this.fileFor(l.id);
        if (!l.at || this._maps.has(fileId)) continue;
        try {
          // (painted as the story has it there now: without what it has away — live types too, a
          // chest or a waystone the story has not brought yet; Game._mapLevel's rule)
          const lv = applyStory((await this.levels.load(fileId)).level, this._holdsIn(() => l.id));
          this._maps.set(fileId, renderLevelMap(lv));
          this._names.set(l.id, lv.name);
          added = true;
        } catch (err) {
          console.warn(`[Luminati] campaign map: ${err?.message ?? err}`);
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      this._mapsLoading = null;
      if (added) this.game?.refreshWorldMap();
    })();
    return this._mapsLoading;
  }

  /** `state().campaign`: where the story stands. */
  info() {
    return {
      name: this.name,
      title: this.campaign.name,
      level: this.levelId,
      file: this.fileId,
      chapter: this.chapterId(),
      // (a chapter begun in a cutscene whose banner waits for play: its id; '' none)
      chapterBanner: this._chapterBanner?.id ?? '',
      flags: [...this.state.flags],
      exits: this._exits.map((o) => ({
        id: o.id, to: text(o.to), entrance: text(o.entrance), mode: o.mode, requires: text(o.requires),
        open: this._present(o) && (!text(o.requires) || this.holds(text(o.requires))),
      })),
      armed: this._armed,
      traveling: this._traveling,
      visited: [...this.state.visited],
      mapLevels: [...this._maps.keys()],
      started: this._started,
      test: this.state.test,
      stats: { ...this.stats },
      // the level built ahead (KNOWN_ISSUES CMP-01): null when none
      prep: this._prep?.info() ?? null,
      // the levels set aside (CAMPAIGN_FORMAT.md §6.3)
      aside: Object.entries(this._aside).filter(([, e]) => e).map(([slot, e]) => ({ slot, level: e.id, file: e.fileId })),
    };
  }

  /**
   * `window.__game.campaign` (docs/specs/AUTOMATION_API.md): the campaign test hooks.
   * @typedef {object} CampaignHooks
   * @property {() => ReturnType<CampaignRuntime['info']>} info  where the story stands
   * @property {(to: string, entrance?: string) => Promise<boolean>} travel  switch to a level (after
   *   a story script that goes on has ended)
   * @property {(id: string) => Promise<boolean>} exit  use exit `id` of the current level (its
   *   condition check included) as if the player stepped in / pressed Space
   * @property {(flag: string) => boolean} setFlag  set a story flag → true when new
   * @property {(flag: string) => boolean} has  is a flag set
   * @property {() => boolean} save  save now → false when storage refused it (or before the start)
   * @property {() => Promise<boolean>} newGame  forget the save and start over
   */

  /** @returns {CampaignHooks} */
  get hooks() {
    return {
      info: () => this.info(),
      // (a story script going on finishes first: a travel from outside never cuts one in half)
      travel: async (to, entrance = '') => {
        await this.runner?.whenIdle();
        return this.travel(String(to), { entrance: String(entrance ?? '') });
      },
      exit: async (id) => {
        const o = this._exits.find((e) => e.id === id);
        return o ? this.tryExit(o) : false;
      },
      setFlag: (flag) => this.setFlag(String(flag)),
      has: (flag) => this.has(String(flag)),
      save: () => this.save(),
      newGame: () => this.newGame(),
    };
  }

  dispose() {
    document.removeEventListener('visibilitychange', this._onHide);
    window.removeEventListener('pagehide', this._onPageHide);
    if (this._idleId) cancelIdleCallback(this._idleId);
    this._idleId = 0;
    this._prep?.dispose();
    this._prep = null;
    this.dropAside();
  }
}

/**
 * Squared distance from (x, z) to an exit's rect (0 inside).
 * @param {LevelObjectOf<'exit'>} o
 * @param {number} x
 * @param {number} z
 */
function exitDistance2(o, x, z) {
  const dx = Math.max(o.minX - x, 0, x - o.maxX);
  const dz = Math.max(o.minZ - z, 0, z - o.maxZ);
  return dx * dx + dz * dz;
}
