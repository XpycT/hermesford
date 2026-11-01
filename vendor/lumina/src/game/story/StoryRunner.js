/**
 * StoryRunner — plays the story of a level or a campaign (docs/specs/STORY_SCRIPT.md): it reads the
 * level's `event` objects and villagers' talk scripts, watches the triggers (Space, walking in and
 * out, arriving, a condition becoming true, the clock, an enemy group falling), runs scripts one at
 * a time (a **run**: the player is held, `game.busy`), and stages them — dialogue with branching
 * choices, the camera, villagers and the player walking on the walk grid, emotes, fades, the
 * letterbox (hold Esc to skip a cutscene). It also decides what is there as the story stands
 * (`present`): live story props (World.applyStory), villagers, events and exits come and go while
 * the player watches.
 *
 * Events with `background: true` run in a second lane, beside play: they hold nobody, open no
 * window (`bark` lines, emotes, villagers walking), pause while the player is held, and give a
 * villager back to the main lane when a run there directs it.
 *
 * The player's party (docs/specs/PARTY.md §7): `party join / leave / rule / set / menu` (`_party`;
 * only a join makes the party), staging commands direct a member before a villager (`_npc`), a
 * villager the party holds is not there as the story stands (`present`), a member talks with its
 * villager's script (`talkFor`), `heal` refills the members.
 *
 * Languages (docs/specs/I18N.md §4): what the story shows is translated at display, never in the
 * story's data or state. A script line's text key is the GUID of its `#line:` tag (§4.2), which
 * `parseScript` cuts off and puts on the node (`tk`; an option's `tk`; a banner's `tks`), so each
 * text is shown as `interpolate(loc(node.tk, text))` — translated first, its `${…}` values filled
 * in after. A line without a tag (a level never keyed, an ad-hoc `__game.story.run` line) has no
 * key: it shows its English, recorded as a `nokey` miss. Names (speakers, quest titles, items,
 * the campaign's) are terms (`term(name)`) and stay English in the state (scripts match villagers by
 * name, `[once]` keys hold the option's English label); a stage text a script gave is saved in
 * English with its line's key and its English before the values beside it
 * (`StoryState.questChange`, shown by `_stageText`); declared item, quest, stage and goal texts by
 * the keys the story files hold (`textKey` on the built story). The trace records the source text.
 * A villager's title is shown by the key its level object holds. The runtime's own toasts and
 * defaults (*The End*) are the 'story' namespace (`./strings.js`), registered when the runner
 * starts. A dialog line carries its speaker's character sheet (`sheet`: the villager's, the
 * member's or the story actor's look) so the dialog draws a portrait (docs/specs/PIXEL_UI.md §8.1).
 *
 * Set-piece direction (docs/specs/STORY_SCRIPT.md; built for Vanquish the Evil Dragon,
 * docs/contracts/DRAGON_CAMPAIGN.md §5.5, §6.10): `shot` frames the camera (CameraRig `setFraming` /
 * `orbit` / `resetFraming`, `on` a look target like `camera`; a move waits unless `nowait`, a cut
 * cuts), `slowmo` eases the engine's time scale, `flash` and the big effects' glare are a
 * ScreenFlash, `title` a TitleCard the run waits for, `pose` plays sheet frames on an actor,
 * `effect` plays Effects.js (its burst pools primed when a level is attached), `fade out … white`
 * fades to G's white. The story's own clocks — waits, camera moves, slow motion's easing, the title
 * card, the skip hold — run in real time (a slow motion does not stretch them); walks, poses and
 * effects are in the world's (slowed) time. The run's end gives everything back: the camera eases
 * back to the game's framing (cut when skipped), the time scale is 1 again, poses end; a travel
 * (`detachLevel`) cuts them all. An `arrive` cutscene that fades in before anything else
 * (`openingRun`) lets the game open on black (Game.enterGameplay). Around the scene
 * (docs/specs/STORY_SCRIPT.md §9.2): a cut puts the depth of field in focus on the next frame
 * (`focusCut`, read by Game's render); an area banner raised just before `cutscene` is taken down
 * and comes after the run (`_retractRegionBanner`); the villagers keep their own barks to
 * themselves under a title card or the end card (`cardUp`, `_hush`); `shot on <boss group>` after
 * the kill follows the fallen boss's body while it is seen (`_groupFoe`).
 *
 * Created by the Game only when there is a story — a campaign, or a level with events / talk
 * scripts (ObjectCatalog.levelHasStory) — and imported lazily, so a level without one loads none of
 * it. It belongs to the game's persistent half: a run goes on across a campaign's travel (actors
 * are looked up by name for every command); `attachLevel` / `detachLevel` follow `swapLevel`.
 */
import * as THREE from 'three';
import {
  parseScript, cachedCondition, cachedScriptCondition, evalCondition, interpolate, varyIndex, hasScript, scriptLines,
  backgroundIssue, isPlayerName, walkNodes,
} from '../../engine/level/StoryScript.js';
import { storyAllows, levelEntrances, entranceName } from '../../engine/level/Travel.js';
import { MAX_PARTY } from '../../engine/level/PartyRules.js';
import { ownValue } from '../../engine/utils/own.js';
import { t, registerStrings } from '../../engine/i18n/I18n.js';
import { loc, term, quietly } from '../../engine/i18n/ContentText.js';
import { textKeyOf } from '../../engine/i18n/ContentKeys.js';
import { createCharacterSheet, CHARACTER_PRESETS } from '../../engine/pixel/CharacterSprites.js';
import { CONVERSATIONS, levelConversation } from '../dialogue.js';
import { Nav } from '../combat/Nav.js';
import { titleCase } from '../campaign/StoryFormat.js';
import { storyReader } from './StoryState.js';
import { play as playEffect, tick as tickEffects, clear as clearEffects, prime as primeEffects, pending as pendingEffects } from './Effects.js';
import { DIRECTIONS } from '../../engine/constants.js';
import storyStrings from './strings.js';
/**
 * The thaw's door (src/game/thaw/Frost.js), fetched by the first `thaw` / `wait thaw`: a story without
 * one never loads it. Kept once in, so a `thaw` starts its front in the frame its line runs (an
 * `import()` of a loaded chunk still resolves a task later: a frame late); a frozen level primes it
 * at `attachLevel` (LevelStates.js imports it: nothing fetched).
 * @type {typeof import('../thaw/Frost.js')|null}
 */
let frostMod = null;
const frostApi = () => frostMod ?? import('../thaw/Frost.js').then((m) => (frostMod = m));
/**
 * The Bells of Evermere's audio pack (src/engine/audio/EvermereAudio.js, the chunk AudioSystem
 * fetches on the first Evermere sound): a `toll` reads its bells' notes there (`BELL_PITCH`,
 * `CHIME_PITCH`). Only a `toll` asks — a story without bells never loads it.
 */
const evAudio = () => import('../../engine/audio/EvermereAudio.js');

// (the game creates a single level's story state from the same lazily loaded module)
export { StoryState, journeySeed } from './StoryState.js';

/**
 * @import { ScriptNode, ParsedScript, RefReader } from '../../engine/level/StoryScript.js'
 * @import { LevelObject } from '../../engine/level/types.js'
 * @import { Story } from '../campaign/StoryFormat.js'
 * @import { StoryState } from './StoryState.js'
 * @import { Game } from '../Game.js'
 * @import { Npc } from '../Npc.js'
 * @import { PartyMember } from '../party/PartyMember.js'
 */

/**
 * Who a script talks to or directs besides the player: a villager of the level, or a member of the
 * player's party (docs/specs/PARTY.md §7.4 — it has the members the story uses on an `Npc`).
 * @typedef {Npc|PartyMember} StoryActor
 */

/**
 * What the director's camera looks at (`camera`, `shot`): a point on the ground, an object it
 * follows (an actor's sprite), or an enemy group's foe — `group` the group's id, `foe` the foe
 * followed (its live boss, else its first living foe: the next one when it falls).
 * @typedef {{ x?: number, z?: number, object?: THREE.Object3D, group?: string, foe?: { alive: boolean, sprite: THREE.Object3D, uid: string } }} CamTarget
 */

/**
 * A line the runner hands the dialog (DialogBox's DialogLine): the speaker's plate (translated),
 * the text, the portrait's colour and character sheet, the speaker's small title beside the plate
 * (a villager's: as plain talks show it, `_titleOf`), the question asked under the line (`ask`: a
 * `choice` with a question right after a line of the same speaker in the held window — G's
 * dialogue keeps the speech and asks under it) and the options.
 * @typedef {{ speaker: string|null, text: string, portraitColor?: string, sheet?: HTMLCanvasElement, title?: string, ask?: string, choices?: string[] }} StoryLine
 */

/** Commands per run before it is stopped (a loop that never ends). */
const MAX_STEPS = 20000;
/** Iterations of one `loop` before it is stopped. */
const MAX_LOOP = 500;
/** How deep `call` may nest. */
const MAX_CALLS = 8;
/** Seconds Esc is held to skip a cutscene. */
const SKIP_HOLD = 0.6;
/** A walk that makes no progress for this long ends at its goal (a deterministic end state). */
const WALK_STUCK = 3;
/** The trace keeps this many executed lines. */
const TRACE = 60;
/**
 * Commands that close a held dialog window before they run (they take time or move the view). Of
 * the set-piece direction (DRAGON_CAMPAIGN.md §5.5) `shot` (it moves the view) and `title` (a card
 * over the screen) do; `slowmo`, `flash`, `pose` and `effect` take no time and leave the window up
 * (a villager bows, fireworks burst while it talks).
 */
const CLOSES_DIALOG = new Set([
  'wait', 'walk', 'camera', 'fade', 'travel', 'rest', 'ending', 'builtin', 'shop', 'cutscene', 'teleport', 'emote', 'banner', 'shake',
  'shot', 'title',
]);
/** Seconds the camera eases back to the game's framing when a run that framed it ends (skipped: a cut). */
const RESTORE_EASE = 0.6;
/** Seconds a `flash … hold` still up at the end of its run fades back over (skipped: off at once). */
const HOLD_RELEASE = 0.6;
/**
 * A title card's length where there is no card to wait for (a stub game, tests): in, held, out —
 * TitleCard.js TITLE_IN + TITLE_HOLD + TITLE_OUT (not imported: it pulls the UI into a Node test).
 */
const TITLE_SECONDS = 4.5;
/** G's white, for `fade out … white` (the fader is in the UI root: the palette's token, PIXEL_UI.md §1.3). */
const FADE_WHITE = 'var(--g-kf0)';
/** The words of `shot` that frame the camera → CameraRig framing fields. */
const SHOT_FRAMING = Object.freeze([['yaw', 'yaw'], ['pitch', 'pitch'], ['dist', 'distance'], ['fov', 'fov'], ['lift', 'lift']]);
/**
 * How each `pose` is played on an actor's sheet (docs/specs/STORY_SCRIPT.md), alternatives in
 * order — the first the sheet has wins: `anim` a sheet animation by its base name (`cheer_<dir>`,
 * the festival sheet's), `cols` columns of the sheet's `poses` map played at `fps` (looped, or held
 * on the last), as a combat sheet has them (COMBAT_POSE_NAMES and the plain `idle0` …) and the
 * festival sheet (`cower`, `kneel`, `bow` …). The player and party members use their combat sheet's
 * frames: `cast` raises both hands (and the weapon) — the victory's last frame and a cheer's —,
 * `wind` is the guard of a strike (ready), `tuck` the crouch (kneel, cower, bow).
 * @type {Readonly<Record<string, readonly ({ anim: string } | { cols: readonly string[], fps?: number, loop?: boolean })[]>>}
 */
const POSE_PLAYS = Object.freeze({
  cheer: [{ anim: 'cheer' }, { cols: ['cast', 'idle0'], fps: 3, loop: true }],
  dance: [{ anim: 'dance' }, { cols: ['spin', 'cast', 'spin', 'idle0'], fps: 3, loop: true }],
  cower: [{ cols: ['cower'] }, { cols: ['tuck'] }],
  kneel: [{ cols: ['kneel'] }, { cols: ['tuck'] }],
  bow: [{ cols: ['bow'] }, { cols: ['tuck'] }],
  victory: [{ cols: ['wind', 'cast'], fps: 6, loop: false }, { anim: 'cheer' }],
  ready: [{ cols: ['wind'] }],
  cast: [{ cols: ['cast'] }],
});
/**
 * Effect names a script line starts (`effect <name> …`, also as an alternative of a `cycle` / `seq` /
 * `pick`: `* effect …`), for priming a story file's scripts by their text (they are parsed when
 * they run).
 */
const EFFECT_LINE = /^\s*(?:\*\s+)?effect\s+([a-z]+)/;
/** A story file's `toll` line (it plays the `toll` effect: its pool primed at attach too). */
const TOLL_LINE = /^\s*(?:\*\s+)?toll\s/;
/** Seconds the scene and the music fade out after the end card is dismissed (`ending`), before the title. */
const ENDING_FADE = 1;
/** Seconds the director's look eases from a fallen foe to its group's next (`shot on <group>`). */
const GROUP_REFOCUS = 0.8;
/**
 * An area banner raised this many game seconds before a `cutscene` is taken down for the scene
 * (`_retractRegionBanner`) and shown again after it (the region's step started the scene).
 */
const REGION_BANNER_RECENT = 1.5;
/** Facings by name (`face`, markers, entrances): a world direction on the ground. */
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
/** Runs one event may start within `TRIGGER_WINDOW` seconds before it is held back (events that set each other off forever). */
const TRIGGER_BURST = 8;
const TRIGGER_WINDOW = 2;
/** Coordinates a script names are kept this far around the level (`teleport`, `walk`, `home`, `camera`). */
const MARGIN = 2;
/** Background runs at once (more wait in their queue). */
const MAX_BG = 8;
/** Legs a walk re-plans when its path ended short of the goal (the search's cell cap on a long way). */
const MAX_LEGS = 8;
/**
 * The longest an opening on black waits for its music's renders before it goes on (s; the music
 * then comes in when they are done — AudioSystem `startMusic` waits for them).
 */
const MUSIC_WAIT_MAX = 12;
/** Grid rows per step of the story's walk grid built ahead (≈ 0.3 ms on a 128 × 128 level). */
const NAV_ROWS_PER_STEP = 4;
/** The most of an idle period the walk grid built ahead takes (ms). */
const NAV_IDLE_MS = 6;

/**
 * `fn()`; when `quiet`, its content lookups record no miss (`quietly`, I18N.md §4.2): text no
 * window shows — a line a skipped cutscene passes over, a line tests answer without a window.
 * @template T
 * @param {boolean} quiet
 * @param {() => T} fn
 * @returns {T}
 */
const quietIf = (quiet, fn) => (quiet ? quietly(fn) : fn());

/**
 * A script being run.
 * @typedef {object} Run
 * @property {string} kind   'talk' | 'event' | 'story' | 'test'
 * @property {string} key    what it is, for messages and the trace (`talk:millbrook/hollis:5`)
 * @property {ScriptNode[]} nodes
 * @property {StoryActor|null} self   the villager (or party member) talked to (talk scripts)
 * @property {number} visits   conversations with `self` before this one
 * @property {string} visitKey the conversation is counted under this key when the run ends ('' = none)
 * @property {string} onceKey  marked done when the run ends ('' = none)
 * @property {number} steps
 * @property {boolean} fast    skipping (hold Esc in a cutscene)
 * @property {boolean} cutscene
 * @property {number} calls
 * @property {Promise<void>} [done]
 * @property {boolean} [background]  a background run (`background: true`): it holds nobody
 * @property {boolean} [stopped]  a background run the main lane (or a travel) stopped
 * @property {Set<any>} [actors]  the villagers a background run directs
 * @property {boolean} [onBlack]  the opening (`openingRun`) before its first `fade`: a `music` line
 *   waits for its track's renders, so the music starts with the line
 */

/**
 * A level `event` the runner watches.
 * @typedef {object} LevelEvent
 * @property {LevelObject & { type: 'event' }} obj
 * @property {ScriptNode[]} nodes
 * @property {string} key       `<level>.<event id>` (its `once` key)
 * @property {boolean} inside   the player stood inside its rect last frame (enter / leave)
 * @property {boolean} last     its condition last frame (change)
 * @property {any} [prompt]     its interactable (`use`)
 */

export class StoryRunner {
  /**
   * @param {{ game: Game, story?: Story|null, state: StoryState, levelId?: string }} opts
   *   story: the campaign's story files (null: a single level — nothing declared); levelId: the base
   *   id of the level played (a campaign's level id, a single level's file slug or name)
   */
  constructor({ game, story = null, state, levelId = '' }) {
    // the runtime's own strings (docs/specs/I18N.md §2: a feature registers its namespace when it starts)
    registerStrings('story', storyStrings);
    this.game = game;
    /** @type {Story|null} */
    this.story = story;
    this.state = state;
    this.levelId = levelId;
    /** @type {Map<string, ParsedScript>} parsed scripts by source key and text (tags included) */
    this._parsed = new Map();
    /** @type {LevelEvent[]} */
    this.events = [];
    /** Campaign-wide events of the story files. */
    this.globalEvents = (story?.events ?? []).map((def) => ({ def, last: /** @type {boolean|null} */ (null) }));
    /** @type {{ kind: string, key: string, nodes: ScriptNode[], self?: StoryActor|null, onceKey?: string }[]} */
    this.queue = [];
    /** @type {Run|null} */
    this.run = null;
    /** @type {Map<any, any>} walks by actor (the player / a villager) */
    this.walks = new Map();
    /** @type {{ t: number, resolve: () => void, run?: Run }[]} game-time waits */
    this.timers = [];
    /** Waits until something the game shows is done (`party menu`: the tactics panel closed), polled every frame. @type {{ done: () => boolean, resolve: () => void, run?: Run }[]} */
    this._untils = [];
    /** Background runs going on (events with `background: true`). @type {Run[]} */
    this.bgRuns = [];
    /** Background runs waiting (while the player is held, or `MAX_BG` run). @type {{ kind: string, key: string, nodes: ScriptNode[], onceKey?: string }[]} */
    this.bgQueue = [];
    /** Villagers the main run directs (a background run that wants one is stopped). @type {Set<any>} */
    this._mainActors = new Set();
    /** The villager of a conversation a reload interrupted: talked to again on Continue ('' = none). */
    this._resumeTalk = '';
    /** Background runs whose next line waits for the player to be free. @type {(() => void)[]} */
    this._bgWaiters = [];
    /**
     * The director's camera (`camera`, `shot`), or null: the game's own. `proxy` the look target the
     * rig follows once a script names one (null: the rig keeps its target — a `shot` that only
     * frames); the move of the proxy (`from` → `to` over `dur`); what the rig had (`saved`).
     * @type {null | { proxy: THREE.Object3D|null, from: THREE.Vector3, to: CamTarget|null,
     *   t: number, dur: number, resetting: boolean, resolve: (() => void)|null, saved: { lookAhead: number, bounds: any }, up: number }}
     */
    this._cam = null;
    /**
     * The set-piece direction's UI (the title card, the screen flash) on the UI root, made on its
     * first use (`_cineNow` / `_cineUI`); null before and without a document (the Node tests).
     * @type {{ title: import('../../engine/ui/TitleCard.js').TitleCard, flash: import('../../engine/ui/ScreenFlash.js').ScreenFlash }|null}
     */
    this._cine = null;
    /**
     * The classes of that UI (storyUI.js `cineUIClasses`, the story chunk), fetched at a level's
     * attach — no DOM until a script shows a title or a flash.
     * @type {ReturnType<typeof import('./storyUI.js').cineUIClasses>|null}
     */
    this._cineKit = null;
    /** @type {Promise<StoryRunner['_cineKit']>|null} */
    this._cineLoad = null;
    /**
     * Slow motion going on (`slowmo`): the engine's time scale eased from `from` to `to` over `dur`
     * real seconds; `base` the scale before the story slowed it (given back at the run's end).
     * @type {{ base: number, from: number, to: number, t: number, dur: number }|null}
     */
    this._slow = null;
    /**
     * Poses being played (`pose`), by actor: the frames (`plan`), the time in it, the seconds left
     * (Infinity: held until `pose … none`, a walk or its run's end), the run that posed it.
     * @type {Map<any, { name: string, plan: { anim?: string, cols?: number[], fps: number, loop: boolean }, t: number, left: number, run: Run }>}
     */
    this._poses = new Map();
    /** Pose warnings already given (`<sheet>:<pose>`: once each). @type {Set<string>} */
    this._poseWarned = new Set();
    /** Executed lines, newest last (`__game.story.trace()`). @type {string[]} */
    this._trace = [];
    /**
     * The source of each dialog line shown (`_line`): its speaker's English name and its text as
     * written, for the trace (which never depends on the language).
     * @type {WeakMap<object, { speaker: string|null, text: string }>}
     */
    this._src = new WeakMap();
    /** Story actors' looks by preset, for the portraits of actors who are not here (`_actorSheet`). @type {Map<string, HTMLCanvasElement|null>} */
    this._actorSheets = new Map();
    /** When (performance.now, ms) the last title card came up — a chapter banner waits some time after one (CampaignRuntime). */
    this.cardShownAt = -Infinity;
    /** The story's last sound and when it played (`_sfx`: one sound asked twice at once plays once). */
    this._lastSfx = { name: '', at: -Infinity };
    /** Script errors so far (counted for the tests). */
    this.errors = 0;
    /** Automatic answers for tests (`__game.story.auto`): null = the player answers. @type {number[]|null} */
    this._auto = null;
    this._version = -1;
    this._hourInt = -1;
    /** The clock's tenth of an hour when conditions were last read (`hour >= 18.5` is noticed within 0.1 h). */
    this._tick = -1;
    /** The weather and the gold when conditions were last read (they change without a story version). */
    this._weather = '';
    this._gold = 0;
    /** The campaign hour last frame (`_clock`); null before the first level. @type {number|null} */
    this._prevTime = null;
    this._skipHold = 0;
    this._nav = null;
    this._navLevel = null;
    /** The story's walk grid being built ahead (`_prepareNav`), its steps left. @type {Generator<undefined, void>|null} */
    this._navSteps = null;
    /** The idle callback that builds it on. */
    this._navIdle = 0;
    this._pathBuf = new Float32Array(512);
    this._offCombat = null;
    /** Reading the chapter (a chapter's `when` that reads `chapter` would ask again forever). */
    this._inChapter = false;
    /** @type {Map<string, { t: number, n: number }>} recent runs per event (`TRIGGER_BURST`) */
    this._bursts = new Map();
    this._now = 0;
    /**
     * A `shot` cut since the last frame drawn (no seconds; `shot reset 0` too): the game's render
     * puts the depth of field in focus at once on the next frame (Game.js) and clears it.
     */
    this.focusCut = false;
    /**
     * Whether the game is past its load (`game.warmedUp`; a game without one — the tests' — is from
     * the start). While it loads, or a travel builds the next level, `_primeMusic` renders only
     * what is wanted first and keeps the rest here (`_musicLater`) for the first frame of play
     * after it: their renders do not run inside the load's long tasks.
     */
    this._loaded = !game.warmedUp;
    /** @type {string[]} */
    this._musicLater = [];
    game.warmedUp?.then(() => {
      this._loaded = true;
      if (!this._loading()) this._primeLater();
    });
    /** The values conditions read (StoryState.storyReader: the same rules as at boot). */
    this.reader = storyReader(() => this.state, {
      story,
      level: () => this.levelId,
      visited: () => this.game.campaign?.state.visited ?? [],
      game: (name) => this._gameValue(name),
      visitKeys: (name) => {
        const npc = this._npc(name);
        return npc ? [this.visitKey(npc)] : [];
      },
    });
    /** Does a `when` / `unless` / `requires` condition hold now (one bare name is a flag)? @type {(cond: string) => boolean} */
    this.holds = (c) => evalCondition(cachedCondition(c), this.reader);
    /**
     * Does an event's `if` or a goal's `done` hold now? These read like a script's `if`: one bare
     * name is a flag or variable, a game value's word the game value (`if: gold` — the purse).
     * @type {(cond: unknown) => boolean}
     */
    this.test = (c) => evalCondition(cachedScriptCondition(c), this.reader);
    /**
     * Is an object there as the story stands (`when` / `unless`)? A villager the player's party
     * holds is not (its member walks with the player instead; docs/specs/PARTY.md §7.4).
     * @type {(o: LevelObject) => boolean}
     */
    this.present = (o) => storyAllows(o, this.holds) && !(o?.type === 'npc' && this.partyHolds(o));
  }

  /**
   * Does the player's party hold this villager — a level object or an `Npc` — by its id or its
   * story actor? The party's own answer (`Party.holds`) once there is a party, else the story's
   * records (a save read before the party was made).
   * @param {{ id?: string, actor?: unknown, storyObj?: any }} v
   * @returns {boolean}
   */
  partyHolds(v) {
    const party = this.game.party;
    if (party) return party.holds(v);
    const records = this.state.party;
    if (!records?.length || !v) return false;
    const actor = typeof v.actor === 'string' ? v.actor.trim() : typeof v.storyObj?.actor === 'string' ? v.storyObj.actor.trim() : '';
    return records.some((r) => r.id === v.id || (!!actor && r.actor === actor));
  }

  // ---------------------------------------------------------------------------------------------
  // The story's values
  // ---------------------------------------------------------------------------------------------

  /** A game value conditions read (`hour`, `gold`, `chapter`, `weather`, `visits`). @param {string} name */
  _gameValue(name) {
    const g = this.game;
    switch (name) {
      case 'hour': return this._clock();
      case 'gold': return this.gold;
      case 'chapter': {
        // (a chapter whose `when` reads `chapter` gets the chapter in force before)
        if (this._inChapter || !g.campaign) return g.campaign?.state.chapter ?? '';
        this._inChapter = true;
        try {
          return g.campaign.chapterId();
        } finally {
          this._inChapter = false;
        }
      }
      case 'weather': return g.weather?.weather ?? 'clear';
      case 'visits': return this.run?.self ? this.run.visits : 0;
      default: return undefined;
    }
  }

  /**
   * The story's hour: a campaign's (inside a level with its own fixed hour, the hour outside — it
   * does not jump when the player goes in or out), else the level's.
   */
  _clock() {
    const g = this.game;
    return g.campaign ? g.campaign.hour() : g.lighting?.timeOfDay ?? 0;
  }

  /** The player's gold (a combat level's purse while one is played). */
  get gold() {
    const pc = this.game.combat?.pc;
    return pc ? pc.gold : this.state.gold;
  }

  /**
   * The key a villager's visits are counted under: its actor, else `<level>/<id>` in a campaign. A
   * party member's are its villager's: its actor, else `<the level it joined in>/<id>`.
   * @param {StoryActor} npc
   */
  visitKey(npc) {
    const record = 'record' in npc ? npc.record : null;
    const actor = typeof npc.storyObj?.actor === 'string' ? npc.storyObj.actor.trim() : record?.actor ?? '';
    if (actor) return `actor:${actor}`;
    return this.game.campaign ? `${record?.level || this.levelId}/${npc.id}` : npc.id;
  }

  /** The story changed (a command, a flag): conditions are re-checked at the next update. */
  changed() {
    this.state.version++;
  }

  /**
   * A new story state (a campaign's New journey): everything is read from it from now on.
   * @param {StoryState} state
   */
  setState(state) {
    this.state = state;
    this._version = -1;
    for (const ge of this.globalEvents) ge.last = null;
    this.queue.length = 0;
    for (const r of [...this.bgRuns]) this._stopBg(r);
    this.bgQueue.length = 0;
    this._resumeTalk = '';
    this._bursts.clear();
    // the party follows the new state's records (a new journey: nobody — PARTY.md §2)
    this.game.syncParty?.()?.catch?.((err) => console.warn('[Luminati] story: the party could not follow the new story state:', err));
  }

  /**
   * The player slept until morning (Game.restUntilMorning): a new day when the night passed
   * midnight (an hour at or after 8 before sleeping); clock events between are not run.
   * @param {number} hourBefore the campaign's hour before
   */
  rested(hourBefore) {
    if (hourBefore >= 8) this.state.day++;
    this.state.version++;
    this._prevTime = this._clock();
  }

  /**
   * The game set the clock (a continued game's saved hour, a new journey's start), not time
   * passing: no day and no `time` events for the jump; the story as it stands at the new hour is
   * the baseline (presence, `change` events — a condition that already held does not fire).
   */
  resyncClock() {
    this._prevTime = this._clock();
    this.applyPresence({ instant: true });
    this._baseline();
  }

  /** What conditions read now is what they read "last frame": `change` events wait for a change. */
  _baseline() {
    for (const le of this.events) le.last = le.obj.on === 'change' ? this._eventHolds(le) : false;
    for (const ge of this.globalEvents) ge.last = ge.def.on === 'change' && this.test(ge.def.if);
    const now = this._clock();
    this._version = this.state.version;
    this._hourInt = Math.floor(now);
    this._tick = Math.floor(now * 10);
    this._weather = this.game.weather?.weather ?? 'clear';
    this._gold = this.gold;
  }

  /**
   * The level about to be built (Game._buildLevel, before its world): conditions read `level` and
   * `done:<id>` for it from now on — also the world's presence while it is built.
   * @param {string} levelId
   */
  setLevelId(levelId) {
    this.levelId = levelId;
  }

  /**
   * Does a condition hold in another level (a campaign's travel: the level about to be entered is
   * read as the story has it there)?
   * @param {string} levelId
   * @returns {(cond: string) => boolean}
   */
  holdsIn(levelId) {
    return (c) => {
      const was = this.levelId;
      this.levelId = levelId;
      try {
        return this.holds(c);
      } finally {
        this.levelId = was;
      }
    };
  }

  /**
   * A continued game (Game.enterGameplay): the event runs that were queued or going on when it was
   * saved run again (StoryState.pending), and a conversation that was going on starts again with
   * the same villager; `arrive` events do not run (the player arrived before).
   */
  resumePending() {
    const keys = this.state.pending;
    this.state.pending = [];
    for (const key of keys) {
      if (key.startsWith('event:')) {
        const le = this.events.find((e) => `event:${e.key}` === key);
        if (le) this._trigger(le, { resume: true });
      } else if (key.startsWith('story:')) {
        const ge = this.globalEvents.find((x) => `story:${x.def.id}` === key);
        if (ge) this._triggerGlobal(ge, { resume: true });
      } else if (key.startsWith('talk:')) {
        const k = key.lastIndexOf('/');
        if (k > 5 && key.slice(5, k) === this.levelId) this._resumeTalk = key.slice(k + 1);
      }
    }
  }

  /**
   * The runs queued or going on now that a save keeps (`resumePending`): event runs, and the
   * conversation going on (`talk:<level>/<villager>`). Background runs are not kept.
   */
  pendingKeys() {
    const keys = [];
    if (this.run && (this.run.kind === 'event' || this.run.kind === 'story' || this.run.kind === 'talk')) keys.push(this.run.key);
    for (const q of this.queue) if ((q.kind === 'event' || q.kind === 'story') && !keys.includes(q.key)) keys.push(q.key);
    // (a `once` background run cut by a reload would never run again: it runs again from its
    // start — background runs are not atomic, what it changed before stays)
    for (const r of this.bgRuns) if (r.onceKey && !r.stopped && !keys.includes(r.key)) keys.push(r.key);
    for (const q of this.bgQueue) if (q.onceKey && !keys.includes(q.key)) keys.push(q.key);
    return keys;
  }

  // ---------------------------------------------------------------------------------------------
  // Levels
  // ---------------------------------------------------------------------------------------------

  /**
   * A level was built (Game._buildLevel): index its events, give the villagers their talk scripts
   * and saved homes, put the Space events among the world's interactables, apply the story's
   * presence at once. A run going on (a travel inside a script) carries on in the new level.
   * (The scripts' texts carry their keys in their lines' tags: I18N.md §4.2.)
   * @param {string} levelId the level's base id
   */
  attachLevel(levelId) {
    const g = this.game;
    this.levelId = levelId;
    this.events = [];
    const world = g.world;
    for (const o of g.level.objects) {
      if (o.type !== 'event') continue;
      const ev = /** @type {LevelObject & { type: 'event' }} */ (o);
      const parsed = this._parse(`level:${levelId}/${ev.id}`, ev.run, `${levelId} › event ${ev.id}`);
      /** @type {LevelEvent} */
      const le = { obj: ev, nodes: parsed.nodes, key: `${levelId}.${ev.id}`, inside: false, last: false };
      if (ev.on === 'use' && ev.maxX > ev.minX && ev.maxZ > ev.minZ) {
        const cx = (ev.minX + ev.maxX) / 2;
        const cz = (ev.minZ + ev.maxZ) / 2;
        const y = world.groundAt(cx, cz);
        const label = typeof ev.label === 'string' && ev.label.trim() ? ev.label.trim() : 'Look';
        le.prompt = {
          id: `event:${ev.id}`,
          position: new THREE.Vector3(cx, y, cz),
          radius: Math.max(0.9, Math.hypot(ev.maxX - ev.minX, ev.maxZ - ev.minZ) / 2 + 0.3),
          label,
          kind: 'event',
          prompt: new THREE.Vector3(cx, y + 1.6, cz),
          lookSpan: null,
          area: { minX: ev.minX, maxX: ev.maxX, minZ: ev.minZ, maxZ: ev.maxZ },
          text: { speaker: '', lines: [] },
          // (its label is shown by the key the event holds: Game.js `promptLabel`)
          object: ev,
          storyEvent: true,
          disabled: true,
          // (a background event's Space starts its run beside play: the prompt holds the player
          // only for the press)
          onInteract: () => (ev.background === true
            ? Promise.resolve(void this._enqueueBg({ kind: 'event', key: `event:${le.key}`, nodes: le.nodes, onceKey: ev.once ? le.key : '' }))
            : this._runInline({ kind: 'event', key: `event:${le.key}`, nodes: le.nodes, onceKey: ev.once ? le.key : '' })),
        };
        world.interactables.push(le.prompt);
      }
      this.events.push(le);
    }
    // villagers: their talk script (their own, else their actor's) and the home a script gave them
    const homes = this.state.levelMemory(levelId).homes;
    const W = g.level.width;
    const D = g.level.depth;
    for (const npc of g.npcs) {
      const obj = npc.storyObj;
      const lines = hasScript(obj?.talk) ? obj.talk : null;
      const actor = typeof obj?.actor === 'string' ? obj.actor.trim() : '';
      const actorTalk = !lines && actor ? ownValue(this.story?.actors ?? {}, actor)?.talk : '';
      if (lines) npc.storyTalk = this._parse(`talk:${levelId}/${npc.id}`, lines, `${levelId} › npc ${npc.id} talk`).nodes;
      else if (actorTalk) npc.storyTalk = this._script(actorTalk)?.nodes ?? null;
      else npc.storyTalk = null;
      const h = Object.hasOwn(homes, npc.id) ? homes[npc.id] : null;
      if (h) npc.setHome(Math.min(W, Math.max(0, h[0])), Math.min(D, Math.max(0, h[1])), { move: true });
    }
    // combat: an enemy group's last foe
    const combat = g.combat;
    if (combat && this.events.some((e) => e.obj.on === 'cleared')) this._offCombat = combat.events.on('kill', (e) => this._onKill(e));
    // the story as it stands: presence, events' starting conditions (story-file events keep theirs
    // across levels), the clock (a campaign's hour goes on across a travel)
    this.applyPresence({ instant: true });
    const p = g.player.position;
    for (const le of this.events) {
      le.inside = this._inside(le.obj, p.x, p.z);
      le.last = le.obj.on === 'change' ? this._eventHolds(le) : false;
    }
    for (const ge of this.globalEvents) if (ge.last === null) ge.last = ge.def.on === 'change' && this.test(ge.def.if);
    const now = this._clock();
    this._version = this.state.version;
    this._hourInt = Math.floor(now);
    this._tick = Math.floor(now * 10);
    this._weather = g.weather?.weather ?? 'clear';
    this._gold = this.gold;
    this._prevTime ??= now;
    this._dropNav();
    this._prepareNav();
    // set-piece direction: the burst pools of the effects this level's scripts and the story files
    // name, before the game's warm-up compiles the scene (no program mid-cutscene); the classes of
    // the title card and the flash on their way (their DOM is made on first use)
    const fx = this._effectNames();
    if (fx.size) primeEffects(g, fx);
    void this._loadCineKit();
    // a frozen level: the thaw's door in before a `thaw` line runs (a skipped toll thaws on its frame)
    if (g.thaw) void frostApi();
  }

  /**
   * The effects (`effect <name> …`) the scripts that can run here name: the level's events and
   * villagers' talk (parsed), the story files' scripts (by their text — they are parsed when they
   * run).
   * @returns {Set<string>}
   */
  _effectNames() {
    /** @type {Set<string>} */
    const out = new Set();
    const look = (nodes) => {
      if (nodes) walkNodes(nodes, (n) => {
        if (n.t === 'cmd' && n.op === 'effect' && typeof n.args?.name === 'string') out.add(n.args.name);
        // (a `toll` plays the `toll` effect at the bell's mouth)
        else if (n.t === 'cmd' && n.op === 'toll') out.add('toll');
      });
    };
    for (const le of this.events) look(le.nodes);
    for (const npc of this.game.npcs ?? []) look(npc.storyTalk);
    const scripts = this.story?.scripts ?? {};
    for (const id of Object.keys(scripts)) {
      const sc = ownValue(scripts, id);
      if (!sc) continue;
      for (const l of scriptLines(sc.lines)) {
        const m = EFFECT_LINE.exec(l);
        if (m) out.add(m[1]);
        else if (TOLL_LINE.test(l)) out.add('toll');
      }
    }
    return out;
  }

  /**
   * The classes of the title card and the screen flash (src/game/story/storyUI.js
   * `cineUIClasses`, the story chunk — already in when the runner is), fetched once; null without
   * a document or a UI root (the Node tests).
   * @returns {Promise<StoryRunner['_cineKit']>}
   */
  _loadCineKit() {
    if (this._cineKit) return Promise.resolve(this._cineKit);
    if (typeof document === 'undefined' || !this.game.ui?.root) return Promise.resolve(null);
    this._cineLoad ??= import('./storyUI.js').then(({ cineUIClasses }) => {
      this._cineKit = cineUIClasses();
      return this._cineKit;
    }, (err) => {
      console.warn('[Luminati] story: the title card and the flash could not be made:', err);
      this._cineLoad = null;
      return null;
    });
    return this._cineLoad;
  }

  /**
   * The title card and the screen flash on the UI root, made now if their classes are in (the
   * first `title` / `flash` / big effect of the level's scripts); null while they load and without
   * a UI (the Node tests).
   * @returns {StoryRunner['_cine']}
   */
  _cineNow() {
    if (this._cine) return this._cine;
    const root = this.game.ui?.root;
    if (!this._cineKit || !root) {
      void this._loadCineKit();
      return null;
    }
    const { TitleCard, ScreenFlash } = this._cineKit;
    this._cine = { title: new TitleCard(root), flash: new ScreenFlash(root) };
    return this._cine;
  }

  /** `_cineNow`, waiting for the classes if they are still on their way. @returns {Promise<StoryRunner['_cine']>} */
  async _cineUI() {
    if (this._cine) return this._cine;
    await this._loadCineKit();
    return this._cineNow();
  }

  /**
   * The level is being taken down (Game._detachLevel): forget its events and actors; the camera
   * goes back to the game (a run's `camera` after a `travel` starts from the new level); events of
   * the level that were queued and not run yet are dropped (story-file events and tests go on).
   */
  detachLevel() {
    this._offCombat?.();
    this._offCombat = null;
    for (const [actor, job] of this.walks) this._endWalk(actor, job, true);
    this.walks.clear();
    this._endUntils();
    // (the set-piece direction ends with the level, in a cut: the camera's framing, slow motion,
    // poses, the effects still to come, a flash; behind the travel's fader)
    if (this._cam) this._cameraRestore();
    if (this.game.rig?.framed) this.game.rig.endFraming();
    this._endSlowmo();
    this._endPoses(null);
    clearEffects(this.game);
    this._cine?.flash.clear();
    if (this._cine?.title.active) this._cine.title.skip();
    this.queue = this.queue.filter((q) => q.kind === 'story' || q.kind === 'test');
    // background runs belong to their level (a story file's queued ones go on in the next)
    for (const r of [...this.bgRuns]) this._stopBg(r);
    this.bgQueue = this.bgQueue.filter((q) => q.kind === 'story');
    this._mainActors.clear();
    this._resumeTalk = '';
    this.events = [];
    this._dropNav();
    this.game.ui.emotes?.clear?.();
  }

  /**
   * Who is there as the story stands: villagers (shown / hidden, their colliders parked), the
   * world's live story props and particle areas (World.applyStory: actors on ground that went away
   * are moved to standable ground), critters (Critters.applyStory), Space events' prompts. Called
   * on every story change and on attach.
   * @param {{ instant?: boolean }} [opts]
   */
  applyPresence({ instant = false } = {}) {
    const g = this.game;
    let npcsChanged = false;
    // (what a running thaw front has not reached yet keeps its old presence: the thaw's gate —
    // EVERMERE_CAMPAIGN.md §6.1, staged presence)
    const present = !instant && g.thaw ? g.thaw.gate(g, this.present) : this.present;
    for (const npc of g.npcs) {
      // (a villager the party holds stays hidden: its member walks with the player)
      const on = (!npc.storyObj || present(npc.storyObj)) && !this.partyHolds(npc);
      if (on !== npc.present) {
        npc.setPresent(on);
        npcsChanged = true;
      }
    }
    // the level's frost and states first (EVERMERE_CAMPAIGN.md §7.3: a thaw stages what follows)
    g.levelStatesChanged?.();
    const { rect, mapChanged } = g.world.applyStory({ instant });
    // critters: an absent group hidden and still, one that comes back at its start points
    g.critters?.applyStory(this.present);
    // combat: absent enemy groups, chests and waystones out of play, present ones back
    g.combat?.applyPresence(present, { instant });
    // (the painted maps only when something they show came or went — not a lamp)
    if (mapChanged && !instant) g.repaintLevelMap();
    if (rect) {
      // ground that went away (a bridge) or a prop that came (a crate): whoever stands there moves
      // to the nearest spot the player fits (the spot itself when it still stands)
      const grow = 0.5;
      const inRect = (x, z) => x > rect.minX - grow && x < rect.maxX + grow && z > rect.minZ - grow && z < rect.maxZ + grow;
      const p = g.player.position;
      if (inRect(p.x, p.z)) {
        const s = g._nearestStandable(p.x, p.z);
        if (s && (s.x !== p.x || s.z !== p.z)) {
          g.player.teleport(s.x, s.z);
          g.combat?.onTeleport();
        }
      }
      for (const npc of g.npcs) {
        if (npc.present && inRect(npc.position.x, npc.position.z) && !g.tileMap.isWalkable(npc.position.x, npc.position.z)) npc.teleportHome();
      }
      g.critters?.standClear(inRect);
      // the walk grids — the story's own, a combat level's (enemies path around what came and went):
      // only the cells the change can reach (Nav.buildRect); the story's being built ahead starts
      // its build over (the bands it did may hold what went)
      if (this._nav && this._navLevel === g.tileMap) {
        if (this._navSteps) this._navSteps = this._nav.buildSteps(null, NAV_ROWS_PER_STEP);
        else this._nav.buildRect(rect.minX, rect.maxX, rect.minZ, rect.maxZ);
      }
      g.combat?.rebuildNav(rect);
    }
    for (const le of this.events) {
      if (!le.prompt) continue;
      le.prompt.disabled = !this.present(le.obj) || (le.obj.once && this.state.isDone(le.key)) || !this._eventGuard(le);
    }
    if (npcsChanged) g.refreshActors();
  }

  /** The event's `if` guard holds (a `change` event's condition is its trigger, not a guard). */
  _eventGuard(le) {
    return le.obj.on === 'change' || !le.obj.if || this.test(le.obj.if);
  }

  /** A `change` event's condition. */
  _eventHolds(le) {
    return !!le.obj.if && this.test(le.obj.if);
  }

  _inside(o, x, z) {
    return x >= o.minX && x < o.maxX && z >= o.minZ && z < o.maxZ;
  }

  /**
   * The player arrived (a travel's fade-in, the start of play): `arrive` events of the level and of
   * the story files.
   */
  onArrive() {
    for (const le of this.events) if (le.obj.on === 'arrive') this._trigger(le);
    for (const ge of this.globalEvents) {
      const d = ge.def;
      if (d.on !== 'arrive' || (d.level && d.level !== this.levelId)) continue;
      this._triggerGlobal(ge);
    }
  }

  /**
   * Queue a level event when it is there, its guard holds and a `once` one has not run.
   * @param {LevelEvent} le
   * @param {{ resume?: boolean }} [opts] resume: it was triggered before a reload (its guard held then)
   */
  _trigger(le, { resume = false } = {}) {
    const o = le.obj;
    if (!this.present(o) || (!resume && !this._eventGuard(le))) return;
    if (o.once && this.state.isDone(le.key)) return;
    const spec = { kind: 'event', key: `event:${le.key}`, nodes: le.nodes, onceKey: o.once ? le.key : '' };
    if (o.background === true) this._enqueueBg(spec);
    else this.enqueue(spec);
  }

  /** @param {{ def: any }} ge @param {{ resume?: boolean }} [opts] */
  _triggerGlobal(ge, { resume = false } = {}) {
    const d = ge.def;
    const key = `story.${d.id}`;
    if (d.once && this.state.isDone(key)) return;
    if (!resume && d.on === 'arrive' && d.if && !this.test(d.if)) return;
    const sc = this._script(d.run);
    if (!sc) return;
    const spec = { kind: 'story', key: `story:${d.id}`, nodes: sc.nodes, onceKey: d.once ? key : '' };
    if (d.background === true) this._enqueueBg(spec);
    else this.enqueue(spec);
  }

  /** combat `kill`: a `cleared` event whose group's last foe fell. */
  _onKill(e) {
    const gid = e?.groupId;
    if (!gid) return;
    const enemies = this.game.combat?.enemies ?? [];
    if (enemies.some((x) => x.groupId === gid && !x.isAdd && x.alive)) return;
    for (const le of this.events) {
      const group = typeof le.obj.group === 'string' ? le.obj.group.trim() : '';
      if (le.obj.on === 'cleared' && group === gid) this._trigger(le);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------------------------

  /**
   * Per frame while playing (Game.update, after the player): walks, waits, the skip hold, the
   * clock (day, `time` events), story changes (presence, `change` events, chapters), area events,
   * and the next queued run.
   * @param {number} dt
   */
  update(dt) {
    const g = this.game;
    if (g.mode !== 'play') return;
    if (this._musicLater.length && this._loaded) this._primeLater();
    this._now += dt;
    // the story's own clocks run in real time (a slow motion does not stretch a wait, a camera move,
    // the title card or the skip hold); the world's — walks, poses, effects — in the game's
    const ts = g.engine?.time?.timeScale;
    const real = ts > 0 && ts !== 1 ? dt / ts : dt;
    // (background runs stand still while the player is held: walks, waits)
    const bgPaused = this._bgPaused();
    if (this.walks.size) this._updateWalks(dt, bgPaused);
    if (this.timers.length) this._updateTimers(real, bgPaused);
    if (this._untils.length) this._updateUntils();
    if (this._slow) this._stepSlow(real);
    if (this._cam) this._updateCamera(real);
    if (this._poses.size) this._updatePoses(dt);
    tickEffects(g, dt);
    const card = this._cine?.title;
    if (card?.active) card.update(real, g.engine?.input ?? null);
    const run = this.run;
    if (run?.cutscene && !run.fast) this._updateSkip(real);
    // the clock: a new day at midnight; `time` events (a jump of 12 h or more is the game setting
    // the clock, not time passing — the `time` command counts its own: `_advanceClock`)
    const now = this._clock();
    if (this._prevTime !== null && now !== this._prevTime) {
      const d = (((now - this._prevTime) % 24) + 24) % 24;
      if (d > 0 && d < 12) this._passTime(this._prevTime, d);
    }
    this._prevTime = now;
    // conditions are read again when the story, the hour (every tenth), the weather or the gold moved
    const tick = Math.floor(now * 10);
    const weather = g.weather?.weather ?? 'clear';
    const gold = this.gold;
    if (this.state.version !== this._version || tick !== this._tick || weather !== this._weather || gold !== this._gold) {
      const hourInt = Math.floor(now);
      // (the save follows a story change or a new hour — not every tenth of one)
      const save = this.state.version !== this._version || hourInt !== this._hourInt;
      this._version = this.state.version;
      this._hourInt = hourInt;
      this._tick = tick;
      this._weather = weather;
      this._gold = gold;
      this._storyChanged(save);
    }
    // walking in and out: a run that moves the player (a walk, a teleport) triggers nothing; what
    // the player stands in when it ends is where they are
    const p = g.player.position;
    for (const le of this.events) {
      const on = le.obj.on;
      if (on !== 'enter' && on !== 'leave') continue;
      const inside = this._inside(le.obj, p.x, p.z);
      if (inside !== le.inside) {
        le.inside = inside;
        if (!run && !g.busy && (on === 'enter') === inside) this._trigger(le);
      }
    }
    if (!this.run && this.queue.length && this._idle()) this._next();
    else if (!this.run && this._resumeTalk && this._idle()) {
      // a conversation a reload interrupted: the player talks to the villager again
      const id = this._resumeTalk;
      this._resumeTalk = '';
      g.talkTo(id);
    }
    if (!this._bgPaused()) {
      // background runs that waited for the player to be free go on
      if (this._bgWaiters.length) for (const w of this._bgWaiters.splice(0)) w();
      while (this.bgQueue.length && this.bgRuns.length < MAX_BG) this._execBg(this.bgQueue.shift());
    }
  }

  /** A background run's next line waits until the player is free (`_bgPaused`): resolves then. */
  _bgFree() {
    return /** @type {Promise<void>} */ (new Promise((resolve) => { this._bgWaiters.push(resolve); }));
  }

  /**
   * Background runs wait while the player is held (a run, a conversation, the map, the journal, the
   * party's tactics panel …).
   */
  _bgPaused() {
    const g = this.game;
    return !!this.run || g.mode !== 'play' || g.busy || g.ui.dialog.isOpen || g.mapOpen || g.photoMode || g.journalOpen || !!g.partyMenuOpen || !!g.campaign?.traveling;
  }

  /**
   * `d` hours passed since `from` (0 < d < 24): a new day for every midnight passed, the `time`
   * events whose hour came.
   * @param {number} from @param {number} d
   */
  _passTime(from, d) {
    if (from + d >= 24) {
      this.state.day++;
      this.state.version++;
    }
    for (const le of this.events) {
      const at = le.obj.at;
      if (le.obj.on !== 'time' || typeof at !== 'number' || !Number.isFinite(at)) continue;
      const k = ((((at % 24) - from) % 24) + 24) % 24;
      if (k > 0 && k <= d) this._trigger(le);
    }
  }

  /**
   * A script's `time <h>`: the clock moves forward to that hour — the day turns when it passes
   * midnight and `time` events between run (also for a jump of 12 hours or more).
   * @param {number} h
   */
  _advanceClock(h) {
    const g = this.game;
    const from = this._clock();
    if (g.campaign) g.campaign.setStoryTime(h);
    else g.setTime(h);
    const to = this._clock();
    const d = (((to - from) % 24) + 24) % 24;
    if (d > 0) this._passTime(from, d);
    this._prevTime = to;
  }

  /**
   * The story moved: presence, `change` events (level and story files), chapters, the journal.
   * @param {boolean} [save] the campaign saves (a story change, a new hour)
   */
  _storyChanged(save = true) {
    this.applyPresence();
    for (const le of this.events) {
      if (le.obj.on !== 'change') continue;
      const now = this._eventHolds(le);
      if (now && !le.last) this._trigger(le);
      le.last = now;
    }
    for (const ge of this.globalEvents) {
      if (ge.def.on !== 'change') continue;
      const now = !!ge.def.if && this.test(ge.def.if);
      if (now && !ge.last) this._triggerGlobal(ge);
      ge.last = now;
    }
    this.game.campaign?.onStoryChange({ save });
    if (this.game.ui.journal?.isOpen) this.game.ui.journal.setData(this.journalData());
  }

  /**
   * Resolves once no run goes on and none is queued (or after `ms`): tests and hooks that travel
   * or reload wait for the story first.
   * @param {number} [ms]
   * @returns {Promise<boolean>} false when it timed out
   */
  whenIdle(ms = 10000) {
    const t0 = performance.now();
    return new Promise((resolve) => {
      const check = () => {
        if (!this.run && !this.queue.length) resolve(true);
        else if (performance.now() - t0 > ms) resolve(false);
        else setTimeout(check, 50);
      };
      check();
    });
  }

  /**
   * Nothing else holds the player (a conversation, the map, the journal, the party's tactics panel
   * …): a queued run may start.
   */
  _idle() {
    const g = this.game;
    return g.mode === 'play' && !g.busy && !g.ui.dialog.isOpen && !g.mapOpen && !g.photoMode && !g.journalOpen && !g.partyMenuOpen && !g.combat?.locksPlayer && !g.campaign?.traveling;
  }

  // ---------------------------------------------------------------------------------------------
  // Runs
  // ---------------------------------------------------------------------------------------------

  /**
   * Queue a script to run when the player is free (an event, a story event, a test).
   * @param {{ kind: string, key: string, nodes: ScriptNode[], self?: StoryActor|null, onceKey?: string }} spec
   */
  enqueue(spec) {
    if (this.queue.some((q) => q.key === spec.key) || this.run?.key === spec.key) return;
    if (this.queue.length >= 64 || !this._admit(spec)) return;
    this.queue.push(spec);
  }

  /**
   * Events that set each other off forever (a sets b, b clears a …) are held back after a burst.
   * @param {{ kind: string, key: string }} spec
   */
  _admit(spec) {
    if (spec.kind !== 'event' && spec.kind !== 'story') return true;
    const b = this._bursts.get(spec.key);
    if (b && this._now - b.t < TRIGGER_WINDOW) {
      if (++b.n > TRIGGER_BURST) {
        if (b.n === TRIGGER_BURST + 1) console.warn(`[Luminati] story: ${spec.key} ran ${TRIGGER_BURST} times in ${TRIGGER_WINDOW} s — held back (events that trigger each other?)`);
        return false;
      }
    } else this._bursts.set(spec.key, { t: this._now, n: 1 });
    if (this._bursts.size > 256) this._bursts.clear();
    return true;
  }

  /**
   * Queue a background run (an event with `background: true`): it starts when the player is free
   * and fewer than `MAX_BG` run; the same event never runs twice at once.
   * @param {{ kind: string, key: string, nodes: ScriptNode[], onceKey?: string }} spec
   */
  _enqueueBg(spec) {
    if (this.bgQueue.some((q) => q.key === spec.key) || this.bgRuns.some((r) => r.key === spec.key)) return;
    if (this.bgQueue.length >= 64 || !this._admit(spec)) return;
    this.bgQueue.push(spec);
  }

  /**
   * A background run: commands that need no input (`bark`, `emote`, villagers walking, state
   * changes …; StoryScript.backgroundIssue refuses the rest — the run ends with an error there). It
   * holds nobody and is not atomic (its changes are saved as they happen); a travel stops it.
   * @param {{ kind: string, key: string, nodes: ScriptNode[], onceKey?: string }} spec
   */
  async _execBg(spec) {
    if (spec.onceKey && this.state.isDone(spec.onceKey)) return;
    /** @type {Run} */
    const run = {
      kind: spec.kind, key: spec.key, nodes: spec.nodes, self: null, visits: 0, visitKey: '', onceKey: spec.onceKey ?? '',
      steps: 0, fast: false, cutscene: false, calls: 0, background: true, stopped: false, actors: new Set(),
    };
    this.bgRuns.push(run);
    try {
      await this._block(run.nodes, run);
    } catch (err) {
      if (!run.stopped) this._error(run, err?.message ?? String(err));
    } finally {
      // (a `nowait` walk still going goes on to its goal — the villager is released there — as a
      // main run's walk is finished at its goal; a stopped run's walks were ended where they stood)
      for (const [, job] of this.walks) if (job.run === run) job.orphan = true;
      this.timers = this.timers.filter((t) => {
        if (t.run !== run) return true;
        t.resolve();
        return false;
      });
      const i = this.bgRuns.indexOf(run);
      if (i >= 0) this.bgRuns.splice(i, 1);
      // (its poses end with it: held ones were held until the run's end)
      this._endPoses(run);
      for (const a of run.actors) if (a.directed && !this.walks.get(a)?.orphan && !this._heldElsewhere(a, null)) a.release();
      if (run.onceKey && !run.stopped) this.state.markDone(run.onceKey);
    }
  }

  /**
   * Does a lane other than background run `run` direct this villager (the main run, another
   * background run, an orphan walk of another run)?
   * @param {any} actor @param {Run|null} run
   */
  _heldElsewhere(actor, run) {
    if (this._mainActors.has(actor)) return true;
    if (this.bgRuns.some((r) => r !== run && r.actors.has(actor))) return true;
    const job = this.walks.get(actor);
    return !!job && job.run !== run && !!job.run?.background;
  }

  /** Stop a background run: its walk ends where the villager stands, its wait ends; it goes no further. @param {Run} run */
  _stopBg(run) {
    if (run.stopped) return;
    run.stopped = true;
    // (a run waiting for the player to be free sees that it stopped; the others wait again)
    for (const w of this._bgWaiters.splice(0)) w();
    for (const [actor, job] of this.walks) if (job.run === run) this._endWalk(actor, job, false);
    this.timers = this.timers.filter((t) => {
      if (t.run !== run) return true;
      t.resolve();
      return false;
    });
    this._endPoses(run);
  }

  /**
   * The main run directs a villager (walk, face, teleport, home): a background run that directs it
   * stops, and it stays the main run's until that ends.
   * @param {any} actor @param {Run} run
   */
  _takeActor(actor, run) {
    if (run.background) {
      // (the main lane's villager: this background run stops — its error is not reported)
      if (this._mainActors.has(actor)) {
        this._stopBg(run);
        throw new Error('the main lane directs this villager');
      }
      run.actors.add(actor);
      return;
    }
    if (actor === this.game.player) return;
    this._mainActors.add(actor);
    for (const r of [...this.bgRuns]) if (r.actors.has(actor)) this._stopBg(r);
    // (an orphan walk: a finished background run's `nowait` walk)
    const job = this.walks.get(actor);
    if (job?.run?.background) this._endWalk(actor, job, false);
    // (a background run's pose of it ends: the main lane directs it now)
    const pose = this._poses.get(actor);
    if (pose?.run.background) this._endPose(actor);
  }

  _next() {
    // (the opening: the run queued first fades in before anything else — it starts on black)
    const opening = !!this.openingRun();
    const spec = this.queue.shift();
    if (!spec) return;
    if (spec.onceKey && this.state.isDone(spec.onceKey)) return;
    this._exec(spec, { ownBusy: true, opening });
  }

  /**
   * Run a script now, inside an interaction that already holds the player (Game._interact: talk,
   * a Space event).
   * @param {{ kind: string, key: string, nodes: ScriptNode[], self?: StoryActor|null, onceKey?: string, visits?: number,
   *   visitKey?: string }} spec
   */
  _runInline(spec) {
    if (spec.onceKey && this.state.isDone(spec.onceKey)) return Promise.resolve();
    return this._exec(spec, { ownBusy: false });
  }

  /**
   * A villager's talk script (Game._interact, which holds the player): the conversation counts as a
   * visit when it ends (`visits` and `visits:<who>` read the count before it meanwhile; a reload
   * during it counts nothing). A party member talks with its villager's script (`talkFor`) and its
   * villager's visits (`visitKey`; docs/specs/PARTY.md §7.5).
   * @param {StoryActor} npc
   */
  async talk(npc) {
    const key = this.visitKey(npc);
    const visits = this.state.visitsOf(key);
    const nodes = ('record' in npc ? this.talkFor(npc) : null) ?? npc.storyTalk ?? [];
    await this._runInline({ kind: 'talk', key: `talk:${this.levelId}/${npc.id}`, nodes, self: npc, visits, visitKey: key });
  }

  /**
   * A party member's talk script (docs/specs/PARTY.md §7.5): its villager's — the `talk` of the
   * villager's level object when that object is on this level (by id; its actor's when it has none,
   * as that villager talks), else the talk script of its story actor — parsed; null when it has
   * none (the party's own conversation then).
   * @param {PartyMember|{ id: string, record?: { actor?: string }, storyObj?: any }} member
   * @returns {ScriptNode[]|null}
   */
  talkFor(member) {
    const id = member?.id;
    if (typeof id !== 'string') return null;
    // the villager's object on this level: the talk script attachLevel gave its Npc
    const npc = this.game.npcById?.get(id);
    if (npc?.storyTalk) return npc.storyTalk;
    if (!npc) {
      const obj = this.game.level?.objects?.find((o) => o.type === 'npc' && o.id === id);
      if (obj && hasScript(obj.talk)) return this._parse(`talk:${this.levelId}/${id}`, obj.talk, `${this.levelId} › npc ${id} talk`).nodes;
    }
    const raw = member.record?.actor || member.storyObj?.actor;
    const actor = typeof raw === 'string' ? raw.trim() : '';
    const talk = actor ? ownValue(this.story?.actors ?? {}, actor)?.talk : '';
    return talk ? this._script(talk)?.nodes ?? null : null;
  }

  /**
   * @param {{ kind: string, key: string, nodes: ScriptNode[], self?: StoryActor|null, onceKey?: string, visits?: number,
   *   visitKey?: string }} spec
   * @param {{ ownBusy: boolean, opening?: boolean }} opts ownBusy: the run holds the player itself;
   *   opening: it is the opening (`openingRun`: on black until its first fade)
   */
  async _exec(spec, { ownBusy, opening = false }) {
    const g = this.game;
    /** @type {Run} */
    const run = {
      kind: spec.kind, key: spec.key, nodes: spec.nodes, self: spec.self ?? null, visits: spec.visits ?? 0,
      visitKey: spec.visitKey ?? '', onceKey: spec.onceKey ?? '', steps: 0, fast: false, cutscene: false, calls: 0,
      onBlack: opening,
    };
    this.run = run;
    // its music renders from now on (Vanquish's score tracks: seconds of lead before its lines),
    // kept for the story until a later run with music lines — while the game loads, the opening's
    // own (it waits on black for them) and the rest after the load
    const music = this.musicOf(run.nodes);
    if (music.length) this._primeMusic(music, opening ? this._blackMusic(run.nodes) : []);
    if (ownBusy) g.busy = true;
    g.ui.prompt.hide();
    // a save taken while the run goes on writes the game as it was when the run began (runs are
    // atomic: a reload replays the event, never half of it)
    g.campaign?.holdSaves();
    try {
      await this._block(run.nodes, run);
    } catch (err) {
      this._error(run, err?.message ?? String(err));
    } finally {
      try {
        this._finish(run);
      } catch (err) {
        console.error('[Luminati] story: ending the run failed:', err);
      }
      if (this.run === run) this.run = null;
      if (ownBusy) g.busy = false;
      g._talkCooldown = Math.max(g._talkCooldown ?? 0, 0.4);
      g.campaign?.releaseSaves();
      g.campaign?.save();
      // (the story changed at the end of the run: the save is written; the next frame's re-read of
      // the conditions does not save it again)
      this._version = this.state.version;
      this._storyChanged(false);
    }
  }

  /**
   * The run ended (or failed): close the window, give back the camera, the villagers, the HUD, the
   * screen (a script that stopped after `fade out`); a conversation counts as a visit.
   * @param {Run} run
   */
  _finish(run) {
    const g = this.game;
    if (g.ui.dialog.isHeld || g.ui.dialog.isOpen) g.ui.dialog.close();
    // (the main run's walks and waits — the background lane's go on)
    for (const [actor, job] of this.walks) if (!job.run?.background) this._endWalk(actor, job, true);
    this.timers = this.timers.filter((t) => {
      if (t.run?.background) return true;
      t.resolve();
      return false;
    });
    // the set-piece direction given back: the camera eases back to the game's framing (a cut when
    // skipped), the time runs at its own speed again, the run's poses end, a card still up goes
    if (this._cam) this._cameraRestore({ ease: run.fast ? 0 : RESTORE_EASE });
    else if (g.rig?.framed && run.fast) g.rig.endFraming();
    this._endSlowmo();
    this._endPoses(run);
    if (this._cine?.title.active) this._cine.title.skip();
    // (a held flash the run did not release fades back; off at once when skipped)
    const held = this._cine?.flash.held ? this._cine.flash : null;
    if (held && run.fast) held.clear();
    else held?.flash(held.color, HOLD_RELEASE, 1);
    if (run.cutscene) {
      g.ui.setCutscene?.(false);
      g.ui.setSkipHint?.(false, 0);
    }
    // (the screen stays covered when the run queued next opens on black itself: a travel's arrival
    // cutscene that fades in — `openingRun`)
    if (g.ui.fader.opacity > 0 && !g.campaign?.traveling && !this.state.ending && !this.openingRun()) g.ui.fader.fadeIn(0.4);
    for (const npc of g.npcs) if (npc.directed && !this.bgRuns.some((r) => r.actors.has(npc))) npc.release();
    // (party members the run directed go back to the follow)
    for (const m of g.party?.members ?? []) if (m.directed && !this.bgRuns.some((r) => r.actors.has(m))) m.release();
    this._mainActors.clear();
    if (run.visitKey) this.state.visit(run.visitKey);
    if (run.onceKey) this.state.markDone(run.onceKey);
    this.state.version++;
    if (this.run === run) this.run = null;
  }

  /** A script error: logged (with where it happened), counted; a development build toasts it. */
  _error(run, msg) {
    this.errors++;
    console.warn(`[Luminati] story: ${run.key}: ${msg}`);
    if (import.meta.env?.DEV) this.game.ui.hud.toast(`Story error: ${msg}`, 3, { kind: 'error' });
  }

  _traceLine(run, n) {
    const what = n.t === 'cmd' ? n.op : n.t;
    this._trace.push(`${run.key}:${n.line} ${what}`);
    if (this._trace.length > TRACE) this._trace.shift();
  }

  /**
   * Run a block of nodes → '' (went through), 'stop' (end the script) or 'break' (leave a loop).
   * @param {ScriptNode[]} nodes
   * @param {Run} run
   * @returns {Promise<''|'stop'|'break'>}
   */
  async _block(nodes, run) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (run.stopped) return 'stop';
      if (run.background) {
        // (no line of a background run runs while the player is held: a run, a conversation …)
        while (this._bgPaused() && !run.stopped) await this._bgFree();
        if (run.stopped) return 'stop';
        const why = backgroundIssue(n);
        if (why) throw new Error(`line ${n.line}: ${why} (a background run)`);
      }
      if (++run.steps > MAX_STEPS) throw new Error(`line ${n.line}: the script ran more than ${MAX_STEPS} commands (a loop that never ends?)`);
      this._traceLine(run, n);
      let sig = /** @type {''|'stop'|'break'} */ ('');
      switch (n.t) {
        case 'say': {
          const batch = [n];
          while (nodes[i + 1]?.t === 'say') batch.push(/** @type {any} */ (nodes[++i]));
          const choice = nodes[i + 1]?.t === 'choice' ? /** @type {any} */ (nodes[++i]) : null;
          sig = await this._say(batch, choice, run);
          break;
        }
        case 'choice':
          sig = await this._say([], n, run);
          break;
        case 'if': {
          const b = n.branches.find((br) => evalCondition(br.cond, this.reader));
          const body = b ? b.body : n.otherwise;
          if (body) sig = await this._block(body, run);
          break;
        }
        case 'loop':
          for (let it = 0; ; it++) {
            if (it >= MAX_LOOP) throw new Error(`line ${n.line}: the loop ran ${MAX_LOOP} times without a break`);
            const s = await this._block(n.body, run);
            if (s === 'break') break;
            if (s === 'stop') { sig = 'stop'; break; }
          }
          break;
        case 'once':
          if (this.state.markDone(`once:${n.key}`)) sig = await this._block(n.body, run);
          break;
        case 'vary': {
          const count = this.state.bump(`vary:${n.key}`);
          this.state.version++;
          sig = await this._block(n.alts[varyIndex(n.mode, n.alts.length, count, n.key, this.state.day, this.state.seed)], run);
          break;
        }
        case 'cmd':
          sig = await this._cmd(n, run);
          break;
        default:
          break;
      }
      if (sig) return sig;
    }
    return '';
  }

  // ---------------------------------------------------------------------------------------------
  // Dialogue
  // ---------------------------------------------------------------------------------------------

  /**
   * Lines of dialogue (and the choice after them) in one window. The window stays open (held) so
   * the next lines of the run go on in it; commands that take time close it first.
   * @param {Extract<ScriptNode, { t: 'say' }>[]} batch
   * @param {Extract<ScriptNode, { t: 'choice' }>|null} choice
   * @param {Run} run
   * @returns {Promise<''|'stop'|'break'>}
   */
  async _say(batch, choice, run) {
    const g = this.game;
    /** @type {Extract<ScriptNode, { t: 'choice' }>['options']} */
    let options = [];
    if (choice) {
      options = choice.options.filter((o) => (!o.cond || evalCondition(o.cond, this.reader)) && !(o.once && this.state.isDone(this._optionKey(run, o))));
      if (!options.length) {
        this._error(run, `line ${choice.line}: no option of the choice is open — skipped`);
        choice = null;
      }
    }
    // (what no window will show is looked up quietly — no miss, I18N.md §4.2: nothing in tests that
    // answer for the player (`auto`); in a skipped cutscene only the page that asks — the question,
    // else the batch's last line with the options, else a page of its own)
    const unseen = !!this._auto;
    const asks = !unseen && run.fast ? (choice && !choice.text ? batch.length - 1 : -1) : null;
    const lines = batch.map((n, k) => quietIf(unseen || (asks !== null && k !== asks), () => this._line(n.speaker, n.text, run, n.tk)));
    /** the choice goes on the line the held window shows: no new page, no retyping */
    let onHeld = false;
    if (choice) {
      // (each option translated alone, by its key — the answer is its index; `[once]` keys keep the
      // English label)
      const labels = quietIf(unseen, () => options.map((o) => interpolate(loc(o.tk, o.label, 'choice'), this.reader)));
      // (a choice after a block — `if` / `else`, `cycle` … — whose last lines are in the held
      // window: its options go on that line, as on the last line of a batch; a question it asks
      // goes under that line when its speaker said it — G's dialogue: the speech kept, the
      // question under it, `ask` (DialogBox)
      const held = !lines.length && !this._auto && !run.fast ? g.ui.dialog.heldLine ?? null : null;
      const q = choice.text ? quietIf(unseen, () => this._line(batch.length ? batch[batch.length - 1].speaker : null, choice.text, run, choice.tk)) : null;
      if (q && held && (held.speaker ?? null) === q.speaker) {
        lines.push({ ...held, speaker: held.speaker ?? null, ask: q.text, choices: labels });
        onHeld = true;
      } else if (q) {
        q.choices = labels;
        lines.push(q);
      } else if (lines.length) lines[lines.length - 1].choices = labels;
      else if (held) {
        lines.push({ ...held, speaker: held.speaker ?? null, choices: labels });
        onHeld = true;
      } else {
        const q = quietIf(unseen, () => this._line(null, '', run));
        q.choices = labels;
        lines.push(q);
      }
    }
    if (!lines.length) return '';
    let pick = 0;
    if (this._auto) {
      // tests: no window; the next queued answer (or the first option) — the trace in the source text
      for (const l of lines) {
        const s = this._src.get(l);
        this._trace.push(s ? `  “${s.speaker ?? ''}: ${interpolate(s.text, this.reader)}”` : `  “${l.speaker ?? ''}: ${l.text}”`);
      }
      pick = choice ? Math.min(options.length - 1, Math.max(0, this._auto.shift() ?? 0)) : 0;
    } else {
      if (run.fast && !choice) return '';
      // (skipping: only the page that asks; a skip while its lines show asks it alone — a choice is
      // still the player's)
      const opened = g.ui.dialog.open({ lines: run.fast ? lines.slice(-1) : lines, hold: true });
      // (the held line again: shown whole at once, its options after it)
      if (onHeld) g.ui.dialog.skip?.();
      let r = await opened;
      if (choice && typeof r !== 'number' && run.fast && this.run === run) r = await g.ui.dialog.open({ lines: lines.slice(-1), hold: true });
      pick = typeof r === 'number' ? r : 0;
    }
    if (!choice) return '';
    const o = options[Math.min(pick, options.length - 1)];
    if (o.once) {
      this.state.markDone(this._optionKey(run, o));
    }
    this._trace.push(`  > ${o.label}`);
    return this._block(o.body, run);
  }

  /** The `done` key of a `[once]` option: its script, line and label. */
  _optionKey(run, o) {
    const where = run.kind === 'talk' && run.self ? this.visitKey(run.self) : run.key;
    return `opt:${where}:${o.line}:${o.label}`;
  }

  /**
   * One dialog line: the speaker's name plate (`_plateOf`, a term), colour and character sheet (the
   * dialog's portrait), the text translated by its key (`loc(key, text)`: the node's `tk`), then its
   * `${…}` filled in. The source (the speaker's English name, the text as written) is kept for the
   * trace (`_src`).
   * @param {string|null} speaker null: the villager talked to (or the narrator); '': the narrator
   * @param {string} text
   * @param {Run} run
   * @param {string} [key] the text's content key (the node's `tk`, its line's tag; none: the English, a `nokey` miss)
   * @returns {StoryLine}
   */
  _line(speaker, text, run, key = '') {
    const shown = interpolate(loc(key, text), this.reader);
    /** @type {StoryLine} */
    let line;
    let src = null;
    if (speaker === null) {
      const npc = run.self;
      if (npc) {
        const sheet = this._sheetOf(npc);
        const title = this._titleOf(npc);
        line = { speaker: this._plateOf(npc), text: shown, portraitColor: npc.def.portraitColor, ...(sheet ? { sheet } : {}), ...(title ? { title } : {}) };
        src = npc.name;
      } else line = { speaker: null, text: shown };
    } else if (speaker === '') line = { speaker: null, text: shown };
    else {
      const who = this._speaker(speaker);
      if (who) {
        line = { speaker: who.plate, text: shown, ...(who.color ? { portraitColor: who.color } : {}), ...(who.sheet ? { sheet: who.sheet } : {}), ...(who.title ? { title: who.title } : {}) };
        src = who.name;
      } else {
        line = { speaker: term(speaker), text: shown };
        src = speaker;
      }
    }
    this._src.set(line, { speaker: src, text });
    return line;
  }

  /**
   * A speaker written in a script → name (English), name plate (translated), colour and character
   * sheet (a villager here, an actor of the story), or null.
   * @param {string} s
   * @returns {{ name: string, plate: string, color: string, sheet: HTMLCanvasElement|null, title?: string }|null}
   */
  _speaker(s) {
    // the speaker `player` in a campaign that names its hero (campaign.json `player.name`, a term:
    // DRAGON_CAMPAIGN.md §5.1) — with the player's portrait; without a name, as written (as before)
    const hero = isPlayerName(s) ? this.game.playerName : '';
    if (hero) return { name: hero, plate: term(hero), color: '', sheet: this._sheetOf(/** @type {any} */ (this.game.player)) };
    const npc = this._npc(s);
    if (npc) return { name: npc.name, plate: this._plateOf(npc), color: npc.def.portraitColor, sheet: this._sheetOf(npc), title: this._titleOf(npc) };
    const actors = this.story?.actors;
    if (actors) {
      const low = s.toLowerCase();
      for (const [id, a] of Object.entries(actors)) {
        if (id.toLowerCase() === low || a.name.toLowerCase() === low) return { name: a.name, plate: term(a.name), color: a.portraitColor, sheet: this._actorSheet(a.preset, a.spec) };
      }
    }
    return null;
  }

  /**
   * A villager's or a party member's name plate: its name as a term (`term(name)`: the name is its
   * identity, I18N.md §4.5); a villager whose level object gives no name — the game shows the code
   * default 'Villager' then (Game.js) — the UI string `game.default.villager` (I18N.md §4.8).
   * @param {StoryActor} actor
   * @returns {string}
   */
  _plateOf(actor) {
    const obj = /** @type {{ type?: unknown, name?: unknown }|null|undefined} */ (actor.storyObj);
    if (obj?.type === 'npc') {
      // (Game.js `npcDef`: a non-empty string, a number or a boolean is the name; else the default)
      const raw = obj.name;
      if (!(typeof raw === 'string' && raw) && typeof raw !== 'number' && typeof raw !== 'boolean') return t('game.default.villager');
    }
    return term(actor.name);
  }

  /**
   * A villager's small title beside the dialogue's name plate (DialogLine `title`, PIXEL_UI.md
   * §8.1), as plain talks show it (Game.js `speakerTitle`, which reads data only): the villager's
   * own `title` from its level object, translated by the key that object holds for it
   * (`textKeyOf(obj, 'title')`, I18N.md §4.2; none: its English); '' without one — a party
   * member away from its villager's level has none. (Game.js pulls the whole game into a Node test
   * of this runner, so the rule is read here, not imported.)
   * @param {StoryActor|null|undefined} npc
   * @returns {string}
   */
  _titleOf(npc) {
    if (!npc) return '';
    // (the level object's optional `title` — untrusted: a string or none —, read where the game
    // keeps it: the villager's def (with its key), else the level object it was built from)
    const o = /** @type {{ title?: unknown, def?: { title?: unknown, titleKey?: unknown }, storyObj?: { title?: unknown } }} */ (/** @type {unknown} */ (npc));
    const holder = o.def?.title != null ? null : o.storyObj?.title != null ? o.storyObj : o;
    const raw = holder ? holder.title : o.def?.title;
    if (typeof raw !== 'string' || !raw.trim()) return '';
    const key = holder ? textKeyOf(holder, 'title') : typeof o.def?.titleKey === 'string' ? o.def.titleKey : '';
    return loc(key, raw.trim(), 'title');
  }

  /**
   * The character sheet a villager's or a party member's portrait is cut from (its sprite's sheet:
   * frame (0, 0) is the same on a combat sheet), or null.
   * @param {StoryActor|null|undefined} actor
   * @returns {HTMLCanvasElement|null}
   */
  _sheetOf(actor) {
    if (!actor) return null;
    const a = /** @type {{ sheet?: { canvas?: HTMLCanvasElement }, sprite?: { sheet?: { canvas?: HTMLCanvasElement } }|null }} */ (actor);
    return a.sheet?.canvas ?? a.sprite?.sheet?.canvas ?? null;
  }

  /**
   * The look of a story actor who is not here (a line spoken from off the level): its preset's
   * sheet, made once per preset (a canvas; its texture is never uploaded). null without a document
   * (the Node tests) or a preset.
   * @param {string} preset
   * @param {Record<string, any>} [spec] the actor's sheet fields over the preset (a villager's look)
   * @returns {HTMLCanvasElement|null}
   */
  _actorSheet(preset, spec) {
    if ((!preset && !spec) || typeof document === 'undefined') return null;
    const look = preset || 'villager';
    const key = spec ? `${look}|${JSON.stringify(spec)}` : look;
    let c = this._actorSheets.get(key);
    if (c === undefined) {
      c = null;
      try {
        const sheet = createCharacterSheet(spec ? { ...CHARACTER_PRESETS[look], preset: look, ...spec } : look);
        c = sheet.canvas;
        sheet.dispose();
      } catch (err) {
        console.warn(`[Luminati] story: no portrait for the look "${look}":`, err);
      }
      this._actorSheets.set(key, c);
    }
    return c;
  }

  // ---------------------------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------------------------

  /**
   * @param {Extract<ScriptNode, { t: 'cmd' }>} n
   * @param {Run} run
   * @returns {Promise<''|'stop'|'break'>}
   */
  async _cmd(n, run) {
    const g = this.game;
    const a = n.args;
    const s = this.state;
    // (the main run's window: a background run never closes it; `party menu` opens a panel over it)
    const closes = CLOSES_DIALOG.has(n.op) || (n.op === 'party' && a.verb === 'menu');
    if (!run.background && closes && (g.ui.dialog.isHeld || g.ui.dialog.isOpen) && !(n.op === 'wait' && a.seconds === 0)) g.ui.dialog.close();
    switch (n.op) {
      case 'stop': return 'stop';
      case 'break': return 'break';
      case 'call': {
        const sc = this._script(a.script);
        if (!sc) throw new Error(`line ${n.line}: no script "${a.script}" in the story files`);
        if (++run.calls > MAX_CALLS) throw new Error(`line ${n.line}: calls nested deeper than ${MAX_CALLS}`);
        const sig = await this._block(sc.nodes, run);
        run.calls--;
        return sig === 'stop' ? 'stop' : '';
      }
      case 'wait':
        // (`wait thaw`: the running front's end — src/game/thaw/Frost.js; at once when none runs)
        if (a.thaw) await (await frostApi()).whenThawed();
        else if (a.who) {
          const actor = this._actor(a.who);
          const job = actor ? this.walks.get(actor) : null;
          // (the main run waiting for a villager a background run walks: the main lane takes it —
          // the background walk stands still while the player is held, it would never end)
          if (job?.run?.background && !run.background) this._takeActor(actor, run);
          else if (job) await job.promise;
        } else await this._wait(a.seconds, run);
        return '';
      case 'set': s.setVar(a.name, 1); return '';
      case 'clear': s.setVar(a.name, 0); return '';
      case 'var': s.setVar(a.name, a.by === '=' ? a.value : s.get(a.name) + (a.by === '+' ? a.value : -a.value)); return '';
      case 'give': case 'take': this._items(a.item, n.op === 'give' ? a.count : -a.count, run); return '';
      case 'quest': this._quest(a, n.tk); return '';
      case 'home': {
        const actor = this._actor(a.who);
        if (!actor || actor === g.player) throw new Error(`line ${n.line}: "${a.who}" is no villager here`);
        // (a party member has no home while it walks with the player: nothing changes)
        if ('record' in actor) {
          this._warn(run, `line ${n.line}: "${a.who}" is in the party — "home" changes nothing while it is`);
          return '';
        }
        const npc = /** @type {Npc} */ (actor);
        this._takeActor(npc, run);
        const x = a.x ?? npc.position.x;
        const z = a.z ?? npc.position.z;
        const [hx, hz] = this._onMap(x, z);
        npc.setHome(hx, hz, { move: a.x !== undefined && !npc.directed });
        s.levelMemory(this.levelId).homes[npc.id] = [+hx.toFixed(3), +hz.toFixed(3)];
        s.version++;
        return '';
      }
      case 'time': {
        // `time <h>`: the story's clock (a fixed-hour level's shown hour stays). With seconds the
        // shown hour glides there too — a fixed-hour level's as well (EVERMERE_CAMPAIGN.md §5.6;
        // its `states` keep it on arrival) — and the line waits for it. `time` events run once:
        // a campaign's hour on a fixed-hour level moves at once (`_passTime` below), a running
        // clock passes them as it glides (the frame's clock check)
        if (a.seconds === undefined) {
          this._advanceClock(a.hour);
          return '';
        }
        const secs = run.fast ? 0 : Math.max(0, a.seconds);
        const from = this._clock();
        if (g.campaign) g.campaign.setStoryTime(a.hour, { seconds: secs });
        else if (secs > 0 && typeof g.weather?.setTime === 'function') g.weather.setTime(a.hour, { duration: secs });
        else g.setTime(a.hour);
        const to = this._clock();
        const d = (((to - from) % 24) + 24) % 24;
        if (d > 0) this._passTime(from, d);
        this._prevTime = to;
        if (secs > 0) await this._wait(secs, run);
        // (the shown hour's end state: at once on a skip, or after a slow motion held the glide back)
        if (Math.abs(g.lighting.timeOfDay - (((a.hour % 24) + 24) % 24)) > 1e-3) g.setTime(a.hour);
        return '';
      }
      // ---- The Bells of Evermere (EVERMERE_CAMPAIGN.md §5.6, §6.1): `thaw` starts the melt front
      // (src/game/thaw/Frost.js → the frozen year's runtime, LevelStates.js `runFront`; a skip
      // finishes it) and does not wait; `toll` swings a bell (World `bells`) and plays its toll —
      // its sound and its note by the bell's object (`_tollVoice`), a gold ring of sound at its mouth
      case 'thaw': {
        const at = a.who !== undefined ? this._place(a.who) : a.x !== undefined ? this._onMapXZ(a.x, a.z) : null;
        if (a.who !== undefined && !at) throw new Error(`line ${n.line}: "${a.who}" names no place here`);
        this._trace.push('  [thaw]');
        const { startThaw } = await frostApi();
        if (run.stopped) return '';
        startThaw(g, { at, seconds: a.seconds, wait: (secs) => this._wait(secs, run), run });
        return '';
      }
      case 'toll': {
        const bell = g.world.bells.get(a.id);
        this._trace.push(`  [toll: ${a.id}]`);
        if (!bell) {
          this._warn(run, `line ${n.line}: "${a.id}" is no bell here (a belfry or a chime as the story stands) — nothing rings`);
          return '';
        }
        if (run.fast) return '';
        const power = a.strength ?? 1;
        bell.ring(power);
        playEffect(g, 'toll', bell.mouth[0], bell.mouth[1], bell.mouth[2], bell.kind === 'chime' ? 0.45 * power : power);
        // (its note is the audio pack's — in already on a level with bells: the music's and the
        // layers' — so the sound starts with the swing)
        const voice = this._tollVoice(a.id, bell, await evAudio());
        if (run.stopped) return '';
        this._trace.push(`  [bell: ${voice.sound} ×${+voice.pitch.toFixed(3)}]`);
        g.audio.playSfx(voice.sound, { volume: Math.min(1, 0.6 + 0.3 * power), pitch: voice.pitch });
        return '';
      }
      case 'weather': g.weather.setWeather(a.weather); return '';
      case 'travel':
        if (!g.campaign) throw new Error(`line ${n.line}: "travel" needs a campaign`);
        if (!g.campaign.isLevel(a.level)) throw new Error(`line ${n.line}: "${a.level}" is not a level of the campaign`);
        if (!(await g.campaign.travel(a.level, { entrance: a.entrance, fromStory: true }))) throw new Error(`line ${n.line}: the travel to "${a.level}" failed`);
        return '';
      case 'rest':
        await g.restUntilMorning();
        return '';
      case 'heal':
        g.combat?.pc?.refill?.();
        this._healMembers();
        return '';
      case 'party': return this._party(n, run);
      case 'shop': {
        const npc = run.self;
        if (!npc) throw new Error(`line ${n.line}: "shop" belongs in a villager's talk script`);
        await levelConversation({ ...npc.storyObj, dialogue: [], action: 'shop' })(this._conversationContext(npc, run));
        return '';
      }
      case 'builtin': {
        const conv = ownValue(CONVERSATIONS, a.script);
        if (!conv) throw new Error(`line ${n.line}: no built-in conversation "${a.script}"`);
        const npc = run.self;
        await conv(this._conversationContext(npc, run), npc?.storyObj ?? /** @type {any} */ ({}));
        return '';
      }
      case 'ending': {
        s.ending = a.id;
        s.version++;
        g.campaign?.releaseSaves();
        g.campaign?.save();
        g.campaign?.holdSaves();
        // (a blank title: the UI's default — I18N.md §4.8; the subtitle is the campaign's or the
        // level's name, a term)
        // (the card over the scene, which goes on under it — the last shot turning, the music —;
        // dismissed, scene and music fade out under the card's fade and the title comes; the
        // villagers' own cries off it and quiet under it: `_hush`, Npc `_bark`)
        this._hush();
        await g.ui.endCard?.show({
          title: a.title ? interpolate(loc(n.tk, a.title, 'title'), this.reader) : t('story.ending.default'),
          subtitle: term(g.campaign?.campaign.name ?? g.level.name),
        });
        if (g.ui.endCard) {
          g.audio?.stopMusic?.({ fade: ENDING_FADE });
          await g.ui.fader.fadeOut(ENDING_FADE);
        }
        g.returnToTitle();
        return 'stop';
      }
      case 'cutscene':
        if (!run.cutscene) {
          run.cutscene = true;
          g.ui.setCutscene?.(true);
          // (a combat lock-on lets go — its reticle and ring off the scene; Targeting.release)
          g.combat?.targeting?.release();
          this._retractRegionBanner();
        }
        return '';
      case 'walk': {
        const actor = this._actor(a.who);
        if (!actor) throw new Error(`line ${n.line}: "${a.who}" is no villager or "player" here`);
        const to = a.to !== undefined ? this._place(a.to) : { x: a.x, z: a.z };
        if (!to) throw new Error(`line ${n.line}: "${a.to}" names no place here`);
        const [wx, wz] = this._onMap(to.x, to.z);
        const p = this._walk(actor, wx, wz, a.run, run);
        if (a.wait) await p;
        return '';
      }
      case 'face': {
        const actor = this._actor(a.who);
        if (!actor) throw new Error(`line ${n.line}: "${a.who}" is no villager or "player" here`);
        this._takeActor(actor, run);
        if (a.dir) this._faceDir(actor, a.dir);
        else {
          const other = this._place(a.to);
          if (other) this._faceTo(actor, other.x, other.z);
        }
        return '';
      }
      case 'emote': {
        const actor = this._actor(a.who);
        if (actor && !run.fast) g.ui.emotes?.show(actor.sprite, a.icon, a.seconds, { offsetY: actor === g.player ? 2.2 : 2.35 });
        return '';
      }
      case 'bark': {
        // a line over an actor: no window, nobody held (`{word}` highlighted, `${…}` filled in)
        // (an actor who is not here says nothing, as `emote` shows nothing)
        const actor = this._actor(a.who);
        if (actor && !run.fast) g.ui.emotes?.bark(actor.sprite, interpolate(loc(n.tk, a.text), this.reader), undefined, { offsetY: actor === g.player ? 2.2 : 2.35 });
        this._trace.push(`  ‹${a.who}: ${a.text}›`);
        return '';
      }
      case 'teleport': {
        const actor = this._actor(a.who);
        if (!actor) throw new Error(`line ${n.line}: "${a.who}" is no villager or "player" here`);
        const to = a.to !== undefined ? this._place(a.to) : { x: a.x, z: a.z, facing: '' };
        if (!to) throw new Error(`line ${n.line}: "${a.to}" names no place here`);
        const [tx, tz] = this._onMap(to.x, to.z);
        this._takeActor(actor, run);
        this._teleport(actor, tx, tz);
        const facing = a.facing || to.facing;
        if (facing) this._faceDir(actor, facing);
        return '';
      }
      case 'camera':
        if (a.reset) await this._cameraReset(run.fast ? 0 : a.seconds);
        else {
          const target = a.who !== undefined ? this._placeTarget(a.who) : this._onMapXZ(a.x, a.z);
          if (!target) throw new Error(`line ${n.line}: "${a.who}" names nothing to look at here`);
          await this._cameraTo(target, run.fast ? 0 : a.seconds);
        }
        return '';
      case 'shake': if (!run.fast) g.rig.shake(a.amount, 0.45); return '';
      case 'fade':
        run.onBlack = false;
        // (`fade out … white`: to G's white — a travel's fade to black after it crossfades: Fader.js)
        if (a.dir === 'out') await g.ui.fader.fadeOut(run.fast ? 0.05 : a.seconds, a.white ? FADE_WHITE : undefined);
        else await g.ui.fader.fadeIn(run.fast ? 0.05 : a.seconds);
        return '';
      // ---- set-piece direction (DRAGON_CAMPAIGN.md §5.5) ----
      case 'shot': return this._shot(n, run);
      case 'slowmo': return this._slowmo(n, run);
      case 'flash': return this._flash(n, run);
      case 'title': return this._title(n, run);
      case 'pose': return this._pose(n, run);
      case 'effect': return this._effect(n, run);
      case 'banner': if (!run.fast) g.ui.banner.show(interpolate(loc(n.tks?.[0], a.title, 'title'), this.reader), interpolate(loc(n.tks?.[1], a.subtitle, 'title'), this.reader), { duration: 3.2 }); return '';
      case 'toast': g.ui.hud.toast(interpolate(loc(n.tk, a.text), this.reader), 2.4); return '';
      case 'sfx': this._sfx(a.name, 0.7, a); return '';
      case 'music':
        if (a.track === 'off') g.audio.stopMusic();
        else if (a.track === 'on') g.setMusic(true);
        else {
          // (the opening on black waits for its music's renders: the music starts with the line,
          // before the scene fades in — AudioSystem `startMusic` would otherwise wait for them)
          if (run.onBlack && !run.fast) await this._musicRendered(a.track);
          g.audio.startMusic({ track: a.track, fade: 2 });
        }
        return '';
      default:
        throw new Error(`line ${n.line}: "${n.op}" cannot run here`);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Set-piece direction (DRAGON_CAMPAIGN.md §5.5, §6.10; docs/specs/STORY_SCRIPT.md): the commands.
  // Each takes the parsed node (`n.args` as StoryScript.js `commandArgs` reads it) and the run,
  // honours `run.fast` (a skipped cutscene reaches the same end state) and returns '' (or throws a
  // `line <n>: …` error that stops the script, as `camera` does).
  // ---------------------------------------------------------------------------------------------

  /**
   * `shot …` — args `{ reset: true, seconds }` or `{ reset: false, seconds, who?, x?, z?, yaw?,
   * pitch?, dist?, fov?, lift?, orbit?, wait? }` (a word left out is absent and keeps what the
   * camera has; numbers clamped to `SHOT_LIMITS`). `on` looks at an actor (followed) or a place as
   * `camera` does; the framing words move the rig (CameraRig `setFraming`, the same seconds, a
   * smooth ease); `orbit` turns the yaw on and on. A move with a length waits until the camera is
   * there (both the look and the framing) unless `nowait` (`wait: false`); 0 is a cut — the focus
   * too. `shot reset [s]` is `camera reset`: the look back on the player and the framing back to
   * the game's, then the camera is the game's again. An unknown target stops the script before
   * anything moves.
   * @param {Extract<ScriptNode, { t: 'cmd' }>} n
   * @param {Run} run
   * @returns {Promise<''>}
   */
  async _shot(n, run) {
    const a = n.args;
    const rig = this.game.rig;
    const secs = run.fast ? 0 : Math.max(0, Number(a.seconds) || 0);
    if (a.reset) {
      // (back at once: the depth of field in focus at once too)
      if (secs === 0) this.focusCut = true;
      await this._cameraReset(secs);
      return '';
    }
    /** @type {CamTarget|null} */
    let target = null;
    if (a.who !== undefined || a.x !== undefined) {
      target = a.who !== undefined ? this._placeTarget(a.who) : this._onMapXZ(a.x, a.z);
      if (!target) throw new Error(`line ${n.line}: "${a.who}" names nothing to look at here`);
    }
    this._camSession();
    /** @type {Promise<void>[]} */
    const moves = [];
    if (target) moves.push(this._cameraTo(target, secs, { chest: true }));
    /** @type {import('../../engine/core/CameraRig.js').Framing} */
    const framing = {};
    for (const [word, field] of SHOT_FRAMING) if (typeof a[word] === 'number') framing[field] = a[word];
    if (Object.keys(framing).length) moves.push(rig.setFraming(framing, secs));
    if (typeof a.orbit === 'number') rig.orbit(a.orbit);
    // a cut is a cut: the look there this frame as well — and the depth of field in focus on the
    // frame drawn next (Game's render: `focusCut`), not easing in from the shot before
    if (secs === 0 && target) rig.snap();
    if (secs === 0 && moves.length) this.focusCut = true;
    if (secs > 0 && a.wait !== false) await Promise.all(moves);
    return '';
  }

  /**
   * `slowmo <scale> [seconds]` — args `{ scale: 0.1–1, seconds }`: the whole game's time scale
   * (the engine's: combat, walks, villagers, particles, the clock) eased to `scale` over the seconds
   * of real time (0: at once). Never waited for. The scale the game had comes back at the end of
   * the run (and on a travel); `slowmo 1` eases back sooner. The camera's framing moves keep real
   * time meanwhile (CameraRig `framingRate`).
   * @param {Extract<ScriptNode, { t: 'cmd' }>} n
   * @param {Run} run
   * @returns {''}
   */
  _slowmo(n, run) {
    const time = this.game.engine?.time;
    if (!time) return '';
    const now = time.timeScale > 0 ? time.timeScale : 1;
    const s = (this._slow ??= { base: now, from: now, to: now, t: 0, dur: 0 });
    s.from = now;
    s.to = Math.min(1, Math.max(0.1, Number(n.args.scale) || 1));
    s.t = 0;
    s.dur = run.fast ? 0 : Math.max(0, Number(n.args.seconds) || 0);
    this._stepSlow(0);
    return '';
  }

  /** Slow motion's easing (real seconds): the engine's time scale; done back at its base: over. @param {number} real */
  _stepSlow(real) {
    const s = this._slow;
    if (!s) return;
    s.t = Math.min(s.dur, s.t + Math.max(0, real));
    const k = s.dur > 0 ? s.t / s.dur : 1;
    this._setTimeScale(s.from + (s.to - s.from) * ((1 - Math.cos(Math.PI * k)) / 2));
    if (k >= 1 && Math.abs(s.to - s.base) < 1e-6) this._endSlowmo();
  }

  /** The engine's time scale, the camera's framing kept in real time. @param {number} v */
  _setTimeScale(v) {
    const g = this.game;
    if (!g.engine?.time) return;
    g.engine.time.timeScale = v;
    if (g.rig) g.rig.framingRate = v > 0 ? 1 / v : 1;
  }

  /** Slow motion over: the time scale it found, the framing at its own pace. */
  _endSlowmo() {
    const s = this._slow;
    if (!s) return;
    this._slow = null;
    this._setTimeScale(s.base);
    if (this.game.rig) this.game.rig.framingRate = 1;
  }

  /**
   * `flash [white|gold|red] [seconds] [hold]` — args `{ color, seconds, hold? }`: a full-screen
   * flash in G's palette (ScreenFlash) that fades back over the seconds; with `hold` the colour
   * comes in over them (at once without) and stays — a memory over white, under the dialog — until
   * the next `flash` fades it back from where it stands (the release), else the end of the run does
   * (`HOLD_RELEASE`); a skip takes it off. Never waited for (a hold waits for the story UI's classes
   * if they are still on their way: it must not be lost); skipping shows none.
   * @param {Extract<ScriptNode, { t: 'cmd' }>} n
   * @param {Run} run
   * @returns {Promise<''>}
   */
  async _flash(n, run) {
    if (run.fast) return '';
    if (n.args.hold) {
      const c = await this._cineUI();
      if (!run.fast && !run.stopped) c?.flash.hold(n.args.color, n.args.seconds, 1);
    } else this._cineNow()?.flash.flash(n.args.color, n.args.seconds, 1);
    return '';
  }

  /**
   * A big effect's faint glare (Effects.js): a full-screen flash, a colour of G's palette that
   * fades back over `seconds` — none while a `flash … hold` is up (a glare never takes a memory's
   * white away). Nothing before the story's UI is in (or without one: the Node tests).
   * @param {string} color 'white' | 'gold' | 'red'
   * @param {number} [seconds]
   * @param {number} [strength] the peak, 0–1
   */
  screenFlash(color, seconds = 0.35, strength = 1) {
    const f = this._cineNow()?.flash;
    if (f && !f.held) f.flash(color, seconds, strength);
  }

  /**
   * `title <text> [| subtitle]` — args `{ title, subtitle }`, keys `n.tks` (the line's tag and
   * `<tag>.2`, as a banner's): the cinematic title card (TitleCard: in, held, out — about 4.5 s),
   * translated at display; the run waits until it is gone. A `confirm` press after its guard ends
   * it sooner, a skipped cutscene takes it off (and a skipped run shows none). Without the card (no
   * UI: tests) the run waits the card's time.
   * @param {Extract<ScriptNode, { t: 'cmd' }>} n
   * @param {Run} run
   * @returns {Promise<''>}
   */
  async _title(n, run) {
    const a = n.args;
    this._trace.push(`  [title: ${a.title}${a.subtitle ? ` | ${a.subtitle}` : ''}]`);
    if (run.fast) return '';
    const title = interpolate(loc(n.tks?.[0], a.title, 'title'), this.reader);
    const sub = a.subtitle ? interpolate(loc(n.tks?.[1], a.subtitle, 'title'), this.reader) : '';
    const ui = await this._cineUI();
    if (run.fast || run.stopped) return '';
    this.cardShownAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // (the villagers' own cries off the card and quiet under it: `cardUp`, Npc `_bark`)
    this._hush();
    if (ui) await ui.title.show(title, sub);
    else await this._wait(TITLE_SECONDS, run);
    return '';
  }

  /**
   * A title card is up (`title`): the villagers keep their own barks to themselves meanwhile (Npc
   * `_bark`, as under a dialog window; the end card likewise). The story's `bark` lines still show.
   */
  get cardUp() {
    return !!this._cine?.title.active;
  }

  /**
   * A card comes up (`title`, `ending`): every villager's own bark still over its head pops out
   * (Npc `hush`) — a cry from just before the card is not left on it.
   */
  _hush() {
    const emotes = this.game.ui.emotes;
    if (emotes) for (const npc of this.game.npcs ?? []) npc.hush?.(emotes);
  }

  /**
   * A cutscene begins (`cutscene`): an area banner raised a moment ago (`REGION_BANNER_RECENT` s:
   * the step into the region was the step that started the scene — Game `_updateRegion` records
   * it as `_regionBanner`) is taken down at once (no fade-out over the first shot) and counted as
   * not shown, so it comes again after the run if the player is still in the region; never over
   * the scene's first shot.
   */
  _retractRegionBanner() {
    const g = this.game;
    const b = g._regionBanner;
    if (!b) return;
    g._regionBanner = null;
    const banner = g.ui.banner;
    if (g.engine.time.elapsed - b.at > REGION_BANNER_RECENT || !banner.visible || banner._titleText !== b.title) return;
    banner.hide(true);
    g._bannersShown.delete(b.name);
  }

  /**
   * `pose <who> <pose> [seconds]` — args `{ who, pose: POSE_NAMES, seconds }`: the actor (the
   * player, a party member, a villager) plays the pose (`POSE_PLAYS`: its sheet's frames, re-applied
   * every frame over what its own update shows) for the seconds of game time, or — 0, the default —
   * held until `pose <who> none`, a walk of it or the end of the run; never waited for. It stops the
   * actor's walk, and directs a villager or a member (its behaviour or the follow waits) like
   * `face`. A sheet without the pose's frames — a villager without the festival sheet, the player
   * or a member on its festival sheet (a level without combat) asked to `ready` / `cast` — plays
   * nothing (a warning, once per look and pose); an actor who is not here, a warning. A timed pose in a skipped cutscene is over before it shows.
   * @param {Extract<ScriptNode, { t: 'cmd' }>} n
   * @param {Run} run
   * @returns {''}
   */
  _pose(n, run) {
    const a = n.args;
    const g = this.game;
    const actor = this._actor(a.who);
    if (!actor?.sprite) {
      this._warn(run, `line ${n.line}: "${a.who}" is no villager, party member or "player" here — no pose`);
      return '';
    }
    if (actor !== g.player) this._takeActor(actor, run);
    const walking = this.walks.get(actor);
    if (walking) this._endWalk(actor, walking, false);
    this._endPose(actor);
    this._trace.push(`  [pose: ${a.who} ${a.pose}]`);
    if (a.pose === 'none' || (run.fast && a.seconds > 0)) return '';
    const plan = this._posePlan(actor, a.pose);
    if (!plan) {
      const look = actor === g.player ? 'the player' : 'record' in actor ? 'a party member' : 'a villager';
      const key = `${look}:${actor.sprite.sheet?.name ?? ''}:${a.pose}`;
      if (!this._poseWarned.has(key)) {
        this._poseWarned.add(key);
        this._warn(run, `line ${n.line}: "${a.who}" has no "${a.pose}" pose on this level (${look === 'a villager' ? 'villagers pose on the festival sheet' : 'the player and party members pose on their combat sheet, on a level without enemies on the festival sheet: no ready / cast'}) — it stands as it is`);
      }
      return '';
    }
    if (actor !== g.player) actor.direct?.();
    const job = { name: a.pose, plan, t: 0, left: a.seconds > 0 ? a.seconds : Infinity, run };
    this._poses.set(actor, job);
    this._applyPose(actor, job);
    return '';
  }

  /**
   * How an actor's sheet plays a pose (`POSE_PLAYS`: the first alternative it has the frames for),
   * or null.
   * @param {any} actor
   * @param {string} pose
   * @returns {{ anim?: string, cols?: number[], fps: number, loop: boolean }|null}
   */
  _posePlan(actor, pose) {
    const sheet = /** @type {{ poses?: Record<string, number>, animations?: Record<string, { frames: { col: number }[], fps?: number, loop?: boolean }> }|undefined} */ (actor.sprite?.sheet);
    if (!sheet) return null;
    const poses = sheet.poses ?? null;
    const anims = sheet.animations ?? {};
    for (const alt of ownValue(POSE_PLAYS, pose) ?? []) {
      if ('anim' in alt) {
        const an = Object.hasOwn(anims, `${alt.anim}_down`) ? anims[`${alt.anim}_down`] : null;
        if (an?.frames?.length) return { anim: alt.anim, fps: an.fps > 0 ? an.fps : 6, loop: an.loop !== false };
      } else if (poses && alt.cols.every((c) => Object.hasOwn(poses, c))) {
        return { cols: alt.cols.map((c) => poses[c]), fps: alt.fps ?? 4, loop: !!alt.loop };
      }
    }
    return null;
  }

  /** Every frame: the poses' frames over what the actors' own updates showed; timed ones end. @param {number} dt game seconds */
  _updatePoses(dt) {
    for (const [actor, job] of this._poses) {
      if (!actor.sprite) {
        this._poses.delete(actor);
        continue;
      }
      job.t += dt;
      if (job.left !== Infinity) {
        job.left -= dt;
        if (job.left <= 0) {
          this._endPose(actor);
          continue;
        }
      }
      this._applyPose(actor, job);
    }
  }

  /**
   * Show the pose's frame now, in the row of the actor's facing (`setFrame`: the sprite plays
   * nothing of its own until the pose ends).
   * @param {any} actor
   * @param {{ plan: { anim?: string, cols?: number[], fps: number, loop: boolean }, t: number }} job
   */
  _applyPose(actor, job) {
    const s = actor.sprite;
    const p = job.plan;
    const dir = DIRECTIONS.includes(s.direction) ? s.direction : 'down';
    let row = Math.max(0, DIRECTIONS.indexOf(dir));
    /** @type {number[]} */
    let cols = p.cols ?? [];
    if (p.anim) {
      const anims = s.sheet.animations;
      const an = Object.hasOwn(anims, `${p.anim}_${dir}`) ? anims[`${p.anim}_${dir}`] : anims[`${p.anim}_down`];
      cols = an.frames.map((f) => f.col);
      row = an.frames[0]?.row ?? row;
    }
    if (!cols.length) return;
    const i = Math.floor(job.t * p.fps);
    const col = cols[p.loop ? i % cols.length : Math.min(cols.length - 1, i)];
    s.direction = dir;
    s.setFrame(col, row);
  }

  /** An actor's pose ends (`none`, a walk, its time, its run's end): a villager or a member stands idle again. @param {any} actor */
  _endPose(actor) {
    if (!this._poses.delete(actor)) return;
    if (actor !== this.game.player) actor.sprite?.play?.('idle', { restart: true });
  }

  /** The poses of a run end (null: every pose — the level goes). @param {Run|null} run */
  _endPoses(run) {
    for (const [actor, job] of [...this._poses]) if (!run || job.run === run) this._endPose(actor);
  }

  /**
   * `effect <name> <who|place|x z> [scale]` — args `{ name: EFFECT_NAMES, who? | x?, z?, scale }`:
   * the named effect there, on the ground (Effects.js `play`; its later layers in game time), never
   * waited for, nobody hurt. A place that is not here stops the script (as `camera`'s). Skipping
   * plays nothing.
   * @param {Extract<ScriptNode, { t: 'cmd' }>} n
   * @param {Run} run
   * @returns {''}
   */
  _effect(n, run) {
    const a = n.args;
    const at = a.who !== undefined ? this._place(a.who) : this._onMapXZ(a.x, a.z);
    if (!at) throw new Error(`line ${n.line}: "${a.who}" names no place here`);
    this._trace.push(`  [effect: ${a.name}]`);
    if (run.fast) return '';
    const [x, z] = this._onMap(at.x, at.z);
    playEffect(this.game, a.name, x, this.game.tileMap.getHeight(x, z), z, a.scale);
    return '';
  }

  /**
   * The run queued first opens on black: an `event` or a story file's event whose script's first
   * `fade` — at its top, through the scripts it `call`s there, before any block (`if`, `loop`,
   * `once`, `cycle` …, a `choice`) or a `travel` / `ending` / `rest` / `shop` / `builtin` / `stop`
   * — is a `fade in` (everything before it happens on a black screen). Game.enterGameplay holds the
   * screen black for it from the first frame — no frame of play, no level banner — and leaves the
   * level's music to the script when it starts some before its fade in (`music`; `tracks` the
   * tracks those lines name, in order: the run waits for their renders there). null when it does
   * not.
   * @returns {{ music: boolean, tracks: string[] }|null}
   */
  openingRun() {
    const spec = this.queue[0];
    if (!spec || (spec.kind !== 'event' && spec.kind !== 'story')) return null;
    const seen = { music: false, tracks: [] };
    return this._fadesInFirst(spec.nodes, seen, 0) === 'in' ? seen : null;
  }

  /**
   * The music to render ahead when a level is built (Game._buildLevel, kept for the story): the
   * tracks the opening of this level's arrival starts before it fades in (the `arrive` event
   * `onArrive` would queue first, as `openingRun` reads it) — its lead is the build's rest and the
   * title —, and those of a run still going on (a script that travels on). Reads, queues nothing.
   * @returns {string[]}
   */
  openingMusic() {
    const out = new Set(this.run ? this.musicOf(this.run.nodes) : []);
    for (const t of this._arrivalMusic()) out.add(t);
    return [...out];
  }

  /** The tracks the opening of this level's arrival starts on black (`openingMusic`'s own: none without one). */
  _arrivalMusic() {
    const first = this._arrivalFirst();
    return first ? this._blackMusic(first) : [];
  }

  /**
   * The tracks a script's `music` lines start before its first `fade in` at its top (through the
   * scripts it `call`s there) — an opening's, played on black; none when it does not fade in first.
   * @param {ScriptNode[]} nodes
   * @returns {string[]}
   */
  _blackMusic(nodes) {
    const seen = { music: false, tracks: [] };
    return this._fadesInFirst(nodes, seen, 0) === 'in' ? seen.tracks : [];
  }

  /**
   * Render ahead the music `openingMusic` names and keep it for the story instead of what it kept
   * (Game._buildLevel, once the level is attached: a level's arrival) — the arrival's opening's
   * tracks at once, a run's going on after the load.
   */
  primeMusicAhead() {
    this._primeMusic(this.openingMusic(), this._arrivalMusic());
  }

  /**
   * Keep `tracks` for the story (AudioSystem `retainMusic`: what it kept before is released) and
   * render them (`primeMusic`; at once for a track that renders nothing) — while the game loads
   * (or a travel builds the next level: `_loading`) only those in `first`, the others on the first
   * frame of play after it (`_musicLater`; a later call replaces them, as it replaces what is kept).
   * A track left for later that a `music` line starts meanwhile renders then anyway (AudioSystem
   * `startMusic` waits for it).
   * @param {string[]} tracks
   * @param {readonly string[]} [first]
   */
  _primeMusic(tracks, first = tracks) {
    const audio = this.game.audio;
    audio.retainMusic('story', tracks);
    this._musicLater = this._loading() ? tracks.filter((t) => !first.includes(t)) : [];
    for (const track of tracks) if (!this._musicLater.includes(track)) audio.primeMusic(track);
  }

  /** Is the game loading — its first load, or a travel building the next level? */
  _loading() {
    return !this._loaded || this.game.mode === 'travel';
  }

  /** Render the tracks left for after the load (`_primeMusic`). */
  _primeLater() {
    const later = this._musicLater;
    this._musicLater = [];
    for (const track of later) this.game.audio.primeMusic(track);
  }

  /**
   * The script of the `arrive` event the arrival would queue first (`onArrive`: the level's events,
   * then the story files'; one that is not there, whose guard fails, done once already or running in
   * the background is passed over), or null.
   * @returns {ScriptNode[]|null}
   */
  _arrivalFirst() {
    for (const le of this.events) {
      const o = le.obj;
      if (o.on !== 'arrive' || o.background === true || !this.present(o) || !this._eventGuard(le)) continue;
      if (o.once && this.state.isDone(le.key)) continue;
      return le.nodes;
    }
    for (const ge of this.globalEvents) {
      const d = ge.def;
      if (d.on !== 'arrive' || (d.level && d.level !== this.levelId) || d.background === true) continue;
      if ((d.once && this.state.isDone(`story.${d.id}`)) || (d.if && !this.test(d.if))) continue;
      const sc = this._script(d.run);
      if (sc) return sc.nodes;
    }
    return null;
  }

  /**
   * The tracks a script's `music` lines start (in its blocks and the scripts it `call`s; not `off`
   * / `on`), in order — what a run's start renders ahead (`_exec`).
   * @param {ScriptNode[]} nodes
   * @returns {string[]}
   */
  musicOf(nodes) {
    /** @type {Set<string>} */
    const out = new Set();
    const visit = (list, depth) => walkNodes(list, (n) => {
      if (n.t !== 'cmd') return;
      if (n.op === 'music') {
        const track = n.args?.track;
        if (typeof track === 'string' && track !== 'off' && track !== 'on') out.add(track);
      } else if (n.op === 'call' && depth < MAX_CALLS) {
        const sc = this._script(n.args?.script);
        if (sc) visit(sc.nodes, depth + 1);
      }
    });
    visit(nodes, 0);
    return [...out];
  }

  /**
   * Resolves when a track's renders are done (AudioSystem `primeMusic`; at once for a track that
   * renders nothing), or after MUSIC_WAIT_MAX seconds.
   * @param {string} track
   * @returns {Promise<void>}
   */
  _musicRendered(track) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, MUSIC_WAIT_MAX * 1000);
      Promise.resolve(this.game.audio.primeMusic(track)).then(() => {
        clearTimeout(timer);
        resolve();
      }, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * The first `fade` of a script's top: 'in' or 'out'; 'stop' at a block or a scene change first
   * (or a call that cannot be followed); '' when it ends without one. `seen.music` notes a `music`
   * line before it, `seen.tracks` the tracks such lines start.
   * @param {ScriptNode[]} nodes
   * @param {{ music: boolean, tracks: string[] }} seen
   * @param {number} depth
   * @returns {''|'in'|'out'|'stop'}
   */
  _fadesInFirst(nodes, seen, depth) {
    for (const n of nodes) {
      if (n.t === 'say') continue;
      if (n.t !== 'cmd') return 'stop';
      switch (n.op) {
        case 'fade': return n.args.dir === 'in' ? 'in' : 'out';
        case 'music': {
          seen.music = true;
          const track = n.args?.track;
          if (typeof track === 'string' && track !== 'off' && track !== 'on' && !seen.tracks.includes(track)) seen.tracks.push(track);
          break;
        }
        case 'call': {
          const sc = depth < 4 ? this._script(n.args.script) : null;
          if (!sc) return 'stop';
          const r = this._fadesInFirst(sc.nodes, seen, depth + 1);
          if (r) return r;
          break;
        }
        case 'travel': case 'ending': case 'rest': case 'shop': case 'builtin': case 'stop': return 'stop';
        default: break;
      }
    }
    return '';
  }

  /**
   * The context a built-in conversation / the shop gets (dialogue.js ConversationContext): its
   * lines arrive translated; the name plate is the villager's (`_plateOf`), with its sheet, or the
   * speaker the conversation names (a term).
   */
  _conversationContext(npc, run) {
    const g = this.game;
    return {
      say: (lines, opts = {}) => {
        const sheet = opts.speaker === undefined ? this._sheetOf(npc) : null;
        const plate = opts.speaker != null ? term(String(opts.speaker)) : npc ? this._plateOf(npc) : '';
        const o = { speaker: plate, lines, portraitColor: npc?.def.portraitColor, ...(sheet ? { sheet } : {}) };
        return g.ui.dialog.open(o);
      },
      toast: (t) => g.ui.hud.toast(t, 2.4),
      sfx: (name) => this._sfx(name, 0.7),
      visits: run.visits,
      game: g,
      npc,
    };
  }

  /** Give (n > 0) or take items / gold; a toast says what changed hands. */
  _items(id, n, run) {
    const g = this.game;
    if (id === 'gold') {
      const pc = g.combat?.pc;
      const have = this.gold;
      const next = Math.max(0, have + n);
      if (next === have) return;
      if (pc) pc.gold = next;
      else { this.state.gold = next; }
      this.state.version++;
      if (!run.fast) g.ui.hud.toast(n > 0 ? t('story.gold.received', { n: next - have }) : t('story.gold.given', { n: have - next }), 2.2, { kind: 'item' });
      return;
    }
    const moved = this.state.addItem(id, n);
    if (!moved) return;
    const count = Math.abs(moved);
    const key = moved > 0 ? (count > 1 ? 'story.item.receivedCount' : 'story.item.received') : count > 1 ? 'story.item.givenCount' : 'story.item.given';
    // (the name looked up only when the toast shows it: a skipped cutscene's records no miss)
    if (!run.fast) g.ui.hud.toast(t(key, { item: term(this.itemName(id)), n: count }), 2.2, { kind: 'item' });
    if (moved > 0) this._sfx('chime', 0.5);
  }

  /**
   * A story sound: the same name asked again within 50 ms (a give and a quest line in one beat, two
   * `sfx` lines) plays once. `sfx … pitch <semitones> pan <side>` plays it higher or lower and from
   * a side (the Frost Gate's far Season Bells: each on its note, from its road).
   * @param {string} name
   * @param {number} volume
   * @param {{ pitch?: number, pan?: number }} [at] `pitch` in semitones, `pan` −1 left … 1 right
   */
  _sfx(name, volume, at = {}) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this._lastSfx.name === name && now - this._lastSfx.at < 50) return;
    this._lastSfx = { name, at: now };
    /** @type {{ volume: number, pitch?: number, pan?: number }} */
    const o = { volume };
    if (at.pitch !== undefined) o.pitch = 2 ** (at.pitch / 12);
    if (at.pan !== undefined) o.pan = at.pan;
    this.game.audio.playSfx(/** @type {any} */ (name), o);
  }

  /**
   * A bell's toll (`toll`; EVERMERE_CAMPAIGN.md §5.6, §7.2), by the bell's object in the level: its
   * sound by the bell's own metal — a belfry's `bell: 'black'` the Hush Bell's `bellTollBlack`,
   * else the bronze `bellToll` (the bell blank's too) —, a wayside chime's `waysideChime`; its note
   * the audio pack's (a playback ratio): a belfry on its kind's note of the motif (`BELL_PITCH`: the
   * shrine's A, the lighthouse's F♯, the abbey's B, the town's, the citadel's and the Hush Bell's
   * D), the bell blank on D, a chime on its place among the level's chimes in the objects' order
   * (`CHIME_PITCH`: A, F♯, B — the Blossomwood lists them in the song's order, Wake, Turn, Gold).
   * @param {string} id the bell's object id
   * @param {import('../../engine/world/Props.js').Bell} bell
   * @param {{ BELL_PITCH: Readonly<Record<string, number>>, CHIME_PITCH: readonly number[] }} ev the audio pack
   * @returns {{ sound: 'bellToll' | 'bellTollBlack' | 'waysideChime', pitch: number }}
   */
  _tollVoice(id, bell, ev) {
    const objs = this.game.level.objects;
    if (bell.kind === 'chime') {
      const chimes = objs.filter((o) => o.type === 'monument' && /** @type {any} */ (o).opts?.kind === 'chime');
      const k = Math.max(0, chimes.findIndex((o) => o.id === id));
      return { sound: 'waysideChime', pitch: ev.CHIME_PITCH[k % ev.CHIME_PITCH.length] };
    }
    const obj = /** @type {any} */ (objs.find((o) => o.id === id));
    const black = obj?.type === 'belfry' && obj.opts?.bell === 'black';
    return { sound: black ? 'bellTollBlack' : 'bellToll', pitch: ownValue(ev.BELL_PITCH, bell.kind) ?? 1 };
  }

  /**
   * An item's name, in English (shown as `term(name)`): the story file's (what `giveNamed`
   * matches), else the name a shop gave it by (`StoryState.itemNames`: "Ilse's Lantern" for the id
   * `ilse-s-lantern`), else its id in title case.
   * @param {string} id
   */
  itemName(id) {
    return ownValue(this.story?.items ?? {}, id)?.name ?? (this.state.itemNameOf(id) || titleCase(id));
  }

  /** A quest's title (the English: the story file's, else the one a script saved; shown as `term(title)`). @param {string} id */
  questTitle(id) {
    return ownValue(this.story?.quests ?? {}, id)?.title || this.state.quest(id)?.title || titleCase(id);
  }

  /**
   * `quest <id> …`: the state changes, a toast tells the player. A script's own title and stage text
   * are saved in English (the title a term); a stage text with its content key and its English
   * before the values beside it (I18N.md §4.5: the journal translates it while the two agree,
   * `_stageText`).
   * @param {Record<string, any>} a the command's arguments
   * @param {string} [key] the stage text's content key (the node's `tk`; none in an ad-hoc run)
   */
  _quest(a, key = '') {
    const stage = a.verb === 'stage';
    const what = this.state.questChange(a.id, a.verb, {
      stage: a.stage ?? '', text: a.text ? interpolate(a.text, this.reader) : '',
      ...(stage && a.text && key ? { key, src: a.text } : {}),
    });
    if (!what) return;
    const title = term(this.questTitle(a.id));
    this.game.ui.hud.toast(t(`story.quest.${what}`, { title }), 2.8, { kind: 'quest' });
    this._sfx(what === 'fail' ? 'cancel' : 'chime', 0.55);
  }

  /**
   * Give the player an item by its display name (the generic shop's `item`): the story file's item
   * of that name, else an id made from the name — the name kept beside it (`StoryState.nameItem`),
   * so the journal and the toasts show the name given, not the id's title case.
   * @param {string} name
   * @param {number} n
   * @returns {{ id: string, count: number }}
   */
  giveNamed(name, n = 1) {
    const low = name.trim().toLowerCase();
    let id = '';
    for (const [k, it] of Object.entries(this.story?.items ?? {})) if (it.name.toLowerCase() === low || k === low) { id = k; break; }
    if (!id) {
      id = low.replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
      this.state.nameItem(id, name);
    }
    this.state.addItem(id, n);
    return { id, count: this.state.count(id) };
  }

  // ---------------------------------------------------------------------------------------------
  // The party (docs/specs/PARTY.md §7)
  // ---------------------------------------------------------------------------------------------

  /**
   * `party join | leave | rule | set | menu`. What cannot be done — a full party, a villager who is
   * not here or a member already, a member who is not one — is a warning and the run goes on. Only
   * a `join` that will happen makes the party (`Game.ensureParty`: its chunk, its UI — a refused
   * one makes none); the others do nothing without one. In a skipped cutscene the changes still
   * happen (quietly); `menu` opens nothing then, nor in tests that answer for the player (`auto`).
   * @param {Extract<ScriptNode, { t: 'cmd' }>} n
   * @param {Run} run
   * @returns {Promise<''>}
   */
  async _party(n, run) {
    const g = this.game;
    const a = n.args;
    const at = `line ${n.line}: party ${a.verb}`;
    if (a.verb === 'join') {
      // (what refuses the join is checked first: only a join that will happen makes the party —
      // PARTY.md §10, a level nobody joins on has none)
      const already = () => {
        this._warn(run, `${at}: "${a.who}" is in the party already`);
        return /** @type {''} */ ('');
      };
      if (g.party?.find(a.who)) return already();
      const npc = this._villager(a.who);
      if (!npc) this._warn(run, `${at}: "${a.who}" is no villager here — nobody joins`);
      else if (!g.party && this.partyHolds(npc)) return already();
      else if (!npc.present) this._warn(run, `${at}: "${a.who}" is not here as the story stands — nobody joins`);
      else if ((g.party?.count ?? 0) >= MAX_PARTY) this._warn(run, `${at}: the party is full (${MAX_PARTY}) — "${a.who}" does not join`);
      else {
        const party = await g.ensureParty();
        // (the party just made may hold members of the story's records: asked again)
        if (party.find(a.who) || party.holds(npc)) return already();
        if (party.count >= MAX_PARTY) {
          this._warn(run, `${at}: the party is full (${MAX_PARTY}) — "${a.who}" does not join`);
          return '';
        }
        // (a walk the villager was on ends: from now on its member is directed — `_npc` finds it;
        // a bubble over it goes with it)
        const job = this.walks.get(npc);
        if (job) this._endWalk(npc, job, false);
        if (npc.sprite) g.ui.emotes?.clear?.(npc.sprite, true);
        if (!party.join(npc, { cls: a.cls || undefined, preset: a.preset || undefined })) this._warn(run, `${at}: "${a.who}" could not join`);
        else this._trace.push(`  [party: ${a.who} joins]`);
      }
      return '';
    }
    const party = g.party;
    const member = party?.find(a.who || '') ?? null;
    if (a.verb === 'menu') {
      if (!party?.count) {
        this._warn(run, `${at}: nobody is in the party — no tactics panel`);
        return '';
      }
      if (a.who && !member) this._warn(run, `${at}: "${a.who}" is not in the party — the panel opens on the first member`);
      // (a skipped cutscene, a test answering for the player: no panel to wait for)
      if (run.fast || this._auto) {
        this._trace.push('  [party: tactics panel (not opened)]');
        return '';
      }
      // (through the game when it can: the talk prompt hidden, the combat paused like the journal's)
      const id = member ? member.id : undefined;
      const opened = typeof g.togglePartyMenu === 'function' ? g.togglePartyMenu(true, id, { force: true }) : party.openMenu(id);
      if (!opened) {
        this._warn(run, `${at}: the tactics panel did not open`);
        return '';
      }
      await this._until(() => !party.menuOpen, run);
      return '';
    }
    if (!member) {
      this._warn(run, `${at}: "${a.who}" is not in the party`);
      return '';
    }
    switch (a.verb) {
      case 'leave': {
        // (its walk, its place among the directed and a bubble over it end with it)
        const job = this.walks.get(member);
        if (job) this._endWalk(member, job, false);
        this._mainActors.delete(member);
        for (const r of this.bgRuns) r.actors.delete(member);
        if (member.sprite) g.ui.emotes?.clear?.(member.sprite, true);
        party.leave(member.id);
        break;
      }
      case 'rule': party.setRule(member.id, a.preset, { source: 'story', quiet: run.fast }); break;
      case 'set': party.setField(member.id, a.field, a.value, { source: 'story', quiet: run.fast }); break;
      default: break;
    }
    return '';
  }

  /**
   * The story's `heal`: the party's members too (docs/specs/PARTY.md §7.3) — the combat's own
   * refill of its allies when it has one (`healAllies`), else each member's fight (`refill`).
   */
  _healMembers() {
    const combat = this.game.combat;
    if (combat && 'healAllies' in combat && typeof combat.healAllies === 'function') combat.healAllies();
    else for (const m of this.game.party?.members ?? []) m.combat?.refill();
  }

  /** Something a script asked for cannot be done: logged, the run goes on (not a script error). */
  _warn(run, msg) {
    console.warn(`[Luminati] story: ${run.key}: ${msg}`);
  }

  /**
   * Wait until `done()` holds (asked every frame, `update`): what the game shows ends by itself —
   * the tactics panel closed. A level taken down ends the wait.
   * @param {() => boolean} done
   * @param {Run} run
   * @returns {Promise<void>}
   */
  _until(done, run) {
    if (done()) return Promise.resolve();
    return new Promise((resolve) => { this._untils.push({ done, resolve: () => resolve(), run }); });
  }

  _updateUntils() {
    for (let k = this._untils.length - 1; k >= 0; k--) {
      const u = this._untils[k];
      let over = true;
      try { over = u.done(); } catch (err) { console.warn('[Luminati] story: a wait failed:', err); }
      if (over) {
        this._untils.splice(k, 1);
        u.resolve();
      }
    }
  }

  /** End every wait (the level goes). */
  _endUntils() {
    for (const u of this._untils.splice(0)) u.resolve();
  }

  // ---------------------------------------------------------------------------------------------
  // Actors and places
  // ---------------------------------------------------------------------------------------------

  /**
   * A member of the player's party in this level (by id, actor or name), else a villager of this
   * level: staging commands direct the member — its villager is hidden while it is in the party
   * (docs/specs/PARTY.md §7.4).
   * @param {string} s
   * @returns {StoryActor|null}
   */
  _npc(s) {
    const m = this.game.party?.find(s);
    if (m?.sprite) return m;
    return this._villager(s);
  }

  /** A villager of this level by id, actor or name (case-insensitive), or null. @param {string} s @returns {Npc|null} */
  _villager(s) {
    const npcs = this.game.npcs ?? [];
    const byId = this.game.npcById?.get(s);
    if (byId) return byId;
    const low = String(s).toLowerCase();
    return npcs.find((n) => (typeof n.storyObj?.actor === 'string' && n.storyObj.actor.trim().toLowerCase() === low))
      ?? npcs.find((n) => n.id.toLowerCase() === low || n.name.toLowerCase() === low) ?? null;
  }

  /** `player`, a party member or a villager here. @param {string} s @returns {any} */
  _actor(s) {
    return isPlayerName(s) ? this.game.player : this._npc(s);
  }

  /**
   * A place by name: an actor (its position), a marker (name or id), an entrance (its name), any
   * object (its position or centre). @param {string} s
   * @returns {{ x: number, z: number, facing?: string }|null}
   */
  _place(s) {
    const actor = this._actor(s);
    if (actor) return { x: actor.position.x, z: actor.position.z };
    const objs = this.game.level.objects;
    const facing = (f) => (typeof f === 'string' && Object.hasOwn(DIRS, f) ? f : '');
    const marker = objs.find((o) => o.type === 'marker' && (o.id === s || (typeof o.name === 'string' && o.name.trim() === s)));
    if (marker) return { x: marker.x, z: marker.z, facing: facing(marker.facing) };
    const ent = levelEntrances(this.game.level).find((e) => entranceName(e) === s && this.present(e));
    if (ent) return { x: ent.x, z: ent.z, facing: facing(ent.facing) };
    const o = objs.find((x) => x.id === s);
    if (!o) return null;
    if (Number.isFinite(o.x) && Number.isFinite(o.z)) return { x: o.x, z: o.z };
    if (Number.isFinite(o.minX)) return { x: (o.minX + o.maxX) / 2, z: (o.minZ + o.maxZ) / 2 };
    if (Number.isFinite(o.x0)) return { x: (o.x0 + o.x1) / 2, z: (o.z0 + o.z1) / 2 };
    return null;
  }

  /**
   * What the camera looks at: an actor (followed); an enemy group of the level by its id (its live
   * boss followed, else its first living foe — the next when it falls; a group with none alive: its
   * home); or a place.
   * @param {string} s
   * @returns {CamTarget|null}
   */
  _placeTarget(s) {
    const actor = this._actor(s);
    if (actor) return { object: actor.sprite };
    const foe = this._groupFoe(s);
    if (foe) return { object: foe.sprite, group: s, foe };
    return this._place(s);
  }

  /**
   * An enemy group's foe the camera follows: its boss while alive, else its first living foe (the
   * combat's order) — of those in play: a foe out of it (its sprite hidden: a pooled add not
   * spawned, a group the story has away) is nothing to look at; with none of the group alive, its
   * fallen boss while the body is still seen (not faded out: a death scene's `shot on <boss group>`
   * follows the body wherever the fight left it — the boss's pooled adds stay alive, hidden); null
   * without combat or with nothing of the group to look at.
   * @param {string} id the group's id (its `enemy` object's)
   */
  _groupFoe(id) {
    const list = this.game.combat?.enemies;
    if (!list || !id) return null;
    let first = null;
    let fallen = null;
    for (const e of list) {
      if (e.groupId !== id || !e.sprite.visible) continue;
      if (!e.alive) {
        if (e.boss && (e.sprite.opacity ?? 1) > 0) fallen ??= e;
        continue;
      }
      if (e.boss) return e;
      first ??= e;
    }
    return first ?? fallen;
  }

  _faceDir(actor, dir) {
    const v = ownValue(DIRS, dir);
    if (!v) return;
    if (actor === this.game.player) this.game.player.faceTowards(actor.position.x + v[0], actor.position.z + v[1]);
    // (a villager keeps a world facing: its row follows the camera — Npc.faceWorld)
    else if (typeof actor.faceWorld === 'function') actor.faceWorld(v[0], v[1]);
    else actor.sprite.setDirection(dir);
  }

  /** A point a script names, kept on (around) the map. @param {number} x @param {number} z @returns {[number, number]} */
  _onMap(x, z) {
    const L = this.game.level;
    return [Math.min(L.width + MARGIN, Math.max(-MARGIN, x)), Math.min(L.depth + MARGIN, Math.max(-MARGIN, z))];
  }

  /** `_onMap` as a camera target. @param {number} x @param {number} z */
  _onMapXZ(x, z) {
    const [cx, cz] = this._onMap(x, z);
    return { x: cx, z: cz };
  }

  _faceTo(actor, x, z) {
    if (actor === this.game.player) this.game.player.faceTowards(x, z);
    else if (typeof actor.faceWorld === 'function') actor.faceWorld(x - actor.position.x, z - actor.position.z);
    else actor.sprite.faceVector(x - actor.position.x, z - actor.position.z);
  }

  _teleport(actor, x, z) {
    const g = this.game;
    const spot = g._standable(x, z) ?? { x, z };
    if (actor === g.player) {
      g.player.teleport(spot.x, spot.z);
      g.combat?.onTeleport();
      if (!this._cam) {
        g._updateCameraBounds();
        g.rig.snap();
      }
      g.world.lightPool?.snap();
    } else actor.placeAt(spot.x, spot.z);
  }

  // ---------------------------------------------------------------------------------------------
  // Walking
  // ---------------------------------------------------------------------------------------------

  /**
   * The story's own walk grid, able to search the whole map (its capacity is every cell: a long
   * way across a big map is found, not cut off): built ahead in idle time (`_prepareNav`) — the
   * rest of it now when a walk comes first —, else on the first walk that needs it.
   */
  _ownNav() {
    const g = this.game;
    if (this._nav && this._navLevel === g.tileMap) {
      if (this._navSteps) {
        const steps = this._navSteps;
        this._navSteps = null;
        for (let r = steps.next(); !r.done; r = steps.next());
      }
      return this._nav;
    }
    this._dropNav();
    this._nav = new Nav(g.tileMap, { maxExpand: this._navCapacity() });
    this._navLevel = g.tileMap;
    return this._nav;
  }

  /** Cells of the level's walk grid (two per unit each way), the story grid's search capacity. */
  _navCapacity() {
    const lv = this.game.level;
    return Math.max(8000, Math.ceil(lv.width * 2) * Math.ceil(lv.depth * 2));
  }

  /** Forget the story's walk grid (a level left or entered) and stop building it. */
  _dropNav() {
    if (this._navIdle && typeof cancelIdleCallback === 'function') cancelIdleCallback(this._navIdle);
    this._navIdle = 0;
    this._navSteps = null;
    this._nav = null;
    this._navLevel = null;
  }

  /**
   * Build the story's walk grid ahead, in idle time, on a level without a combat grid where some
   * script walks someone — the level's events and villagers or a story file's (KNOWN_ISSUES
   * STORY-14: built on the first walk it took 35–42 ms on a 128 × 128 level). Not where the browser
   * has no idle callbacks (the first walk builds it there).
   */
  _prepareNav() {
    const g = this.game;
    if (g.combat?.nav || this._nav || typeof requestIdleCallback !== 'function' || !this._mayWalk()) return;
    this._nav = new Nav(g.tileMap, { maxExpand: this._navCapacity(), defer: true });
    this._navLevel = g.tileMap;
    this._navSteps = this._nav.buildSteps(null, NAV_ROWS_PER_STEP);
    this._stepNav();
  }

  /** The next slice of the walk grid built ahead: up to NAV_IDLE_MS of an idle period. */
  _stepNav() {
    if (this._navIdle || !this._navSteps) return;
    this._navIdle = requestIdleCallback((deadline) => {
      this._navIdle = 0;
      const steps = this._navSteps;
      if (!steps) return;
      const t0 = performance.now();
      const budget = deadline.didTimeout ? NAV_IDLE_MS / 2 : Math.min(NAV_IDLE_MS, deadline.timeRemaining() - 1);
      while (this._navSteps === steps) {
        if (steps.next().done) {
          this._navSteps = null;
          return;
        }
        if (performance.now() - t0 >= budget) break;
      }
      this._stepNav();
    }, { timeout: 1000 });
  }

  /** Does a script of this level or of the story files hold a `walk`? */
  _mayWalk() {
    let found = false;
    const look = (nodes) => {
      if (!found && nodes) walkNodes(nodes, (n) => { if (n.t === 'cmd' && n.op === 'walk') found = true; });
    };
    for (const le of this.events) look(le.nodes);
    for (const npc of this.game.npcs) look(npc.storyTalk);
    // (a story file's scripts by their text, not parsed: their errors are reported when they run)
    const scripts = this.story?.scripts ?? {};
    for (const id of Object.keys(scripts)) {
      if (found) break;
      const sc = ownValue(scripts, id);
      if (sc && scriptLines(sc.lines).some((l) => /^\s*walk\s/.test(l))) found = true;
    }
    return found;
  }

  /**
   * Waypoints from (fx, fz) to (x, z) on the walk grid: first with the level's search budget, then
   * — a long way across a big map — once more over the whole map; [] when there is no way.
   * @param {number} fx @param {number} fz @param {number} x @param {number} z
   * @returns {[number, number][]}
   */
  _plan(fx, fz, x, z) {
    const g = this.game;
    const buf = this._pathBuf;
    const read = (n) => {
      /** @type {[number, number][]} */
      const pts = [];
      for (let k = 0; k < n; k++) pts.push([buf[k * 2], buf[k * 2 + 1]]);
      return pts;
    };
    try {
      // (one search over the whole map on the story's own grid; on a combat level the combat grid
      // first, with its budget — the story's grid is built only when that finds no way)
      const nav = g.combat?.nav;
      if (nav) {
        const budget = Math.max(g.level.width, g.level.depth) > 64 ? 24000 : 8000;
        const n = nav.findPath(fx, fz, x, z, 1e6, buf, Math.min(nav.maxExpand, budget));
        if (n > 0) return read(n);
      }
      const wide = this._ownNav();
      const m = wide.findPath(fx, fz, x, z, 1e6, buf, wide.maxExpand);
      if (m > 0) return read(m);
    } catch (err) {
      console.warn('[Luminati] story: walk grid:', err);
    }
    return [];
  }

  /**
   * Walk an actor to (x, z) along the walk grid. Resolves when it arrives (or, stuck, is put there).
   * @returns {Promise<void>}
   */
  _walk(actor, x, z, running, run) {
    const g = this.game;
    // (the main lane takes the villager from the background lane; a background run that wants the
    // main lane's villager stops here, before it ends anyone's walk)
    this._takeActor(actor, run);
    const prev = this.walks.get(actor);
    if (prev?.run?.background && prev.run !== run && !prev.orphan) this._stopBg(prev.run);
    else if (prev) this._endWalk(actor, prev, false);
    // (a walk ends the actor's pose)
    this._endPose(actor);
    if (run.fast) {
      this._teleport(actor, x, z);
      return Promise.resolve();
    }
    const from = actor.position;
    let points = this._plan(from.x, from.z, x, z);
    if (!points.length) {
      console.warn(`[Luminati] story: ${run.key}: no way to (${x.toFixed(1)}, ${z.toFixed(1)}) on the walk grid — walking straight`);
      points = [[x, z]];
    }
    if (actor !== g.player) actor.direct();
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    this.walks.set(actor, { points, i: 0, running: !!running, resolve, promise, stuck: 0, last: Infinity, goal: [x, z], run, legs: 0 });
    return promise;
  }

  /** @param {number} dt @param {boolean} [bgPaused] background runs' walks stand still */
  _updateWalks(dt, bgPaused = false) {
    const g = this.game;
    // (arrived: within a frame's step — at a low frame rate a step overshoots a tight radius)
    const reach = Math.max(0.12, dt * 6.5);
    for (const [actor, job] of this.walks) {
      if (bgPaused && job.run?.background) {
        job.stuck = 0;
        job.last = Infinity;
        // (standing still: the idle pose, once)
        if (!job.paused) {
          job.paused = true;
          if (actor !== g.player) actor.stopWalk?.();
        }
        continue;
      }
      job.paused = false;
      const [tx, tz] = job.points[job.i];
      const p = actor.position;
      const before = Math.hypot(tx - p.x, tz - p.z);
      if (before < reach) {
        if (++job.i < job.points.length) continue;
        // the path ended short of the goal (a long way: the search keeps a limited number of
        // cells) — the next leg from here
        const gx = job.goal[0];
        const gz = job.goal[1];
        if (Math.hypot(gx - p.x, gz - p.z) > Math.max(0.5, reach) && job.legs < MAX_LEGS) {
          const pts = this._plan(p.x, p.z, gx, gz);
          if (pts.length) {
            job.points = pts;
            job.i = 0;
            job.legs++;
            job.stuck = 0;
            job.last = Infinity;
            continue;
          }
        }
        this._endWalk(actor, job, false);
        continue;
      }
      // (progress is measured from frame to frame: the player moves in its own update, next frame)
      job.stuck = before < job.last - 1e-3 ? 0 : job.stuck + dt;
      job.last = before;
      if (actor === g.player) {
        g.player.scripted = { x: (tx - p.x) / before, z: (tz - p.z) / before, run: job.running };
      } else actor.walkStep(dt, tx, tz, job.running);
      if (job.stuck > WALK_STUCK) {
        this._teleport(actor, job.goal[0], job.goal[1]);
        this._endWalk(actor, job, false);
      }
    }
  }

  /** A walk is over (arrived, replaced, the run ended: `snap` puts the actor at its goal). */
  _endWalk(actor, job, snap) {
    if (snap) this._teleport(actor, job.goal[0], job.goal[1]);
    if (actor === this.game.player) this.game.player.scripted = null;
    else actor.stopWalk?.();
    this.walks.delete(actor);
    job.resolve();
    // (a finished background run's walk: the villager is its own again)
    if (job.orphan && actor !== this.game.player && actor.directed && !this._heldElsewhere(actor, job.run)) actor.release();
  }

  // ---------------------------------------------------------------------------------------------
  // Waiting and skipping
  // ---------------------------------------------------------------------------------------------

  /** Wait `seconds` of game time (0 while skipping). */
  _wait(seconds, run) {
    if (run.fast || seconds <= 0) return Promise.resolve();
    return /** @type {Promise<void>} */ (new Promise((resolve) => { this.timers.push({ t: seconds, resolve: () => resolve(), run }); }));
  }

  /** @param {number} dt @param {boolean} [bgPaused] background runs' waits stand still */
  _updateTimers(dt, bgPaused = false) {
    for (let k = this.timers.length - 1; k >= 0; k--) {
      const t = this.timers[k];
      if (bgPaused && t.run?.background) continue;
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(k, 1);
        t.resolve();
      }
    }
  }

  /** A cutscene: holding Esc skips it — waits end, walks arrive, the camera snaps, plain lines go. */
  _updateSkip(dt) {
    const g = this.game;
    const input = g.engine.input;
    if (input.action('cancel')) this._skipHold += dt;
    else this._skipHold = 0;
    g.ui.setSkipHint?.(this._skipHold > 0, Math.min(1, this._skipHold / SKIP_HOLD));
    if (this._skipHold < SKIP_HOLD) return;
    this._skipHold = 0;
    g.ui.setSkipHint?.(false, 0);
    this.skip();
  }

  /** Skip the cutscene running now (the `__game.story.skip()` hook too). */
  skip() {
    const run = this.run;
    if (!run || run.fast) return false;
    run.fast = true;
    const g = this.game;
    this.timers = this.timers.filter((t) => {
      if (t.run?.background) return true;
      t.resolve();
      return false;
    });
    for (const [actor, job] of this.walks) if (!job.run?.background) this._endWalk(actor, job, true);
    // (the camera where its moves go, slow motion where it eases to, the title card off, the
    // effects still to come dropped and those playing cut — a skipped `effect fireball` never lands)
    if (this._cam) this._cam.t = this._cam.dur;
    g.rig?.completeFraming?.();
    if (this._slow) this._slow.t = this._slow.dur;
    if (this._cine?.title.active) this._cine.title.skip();
    if (this._cine?.flash.held) this._cine.flash.clear();
    clearEffects(g);
    if (g.ui.dialog.isOpen && !g.ui.dialog.isChoosing) g.ui.dialog.close();
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // The director's camera
  // ---------------------------------------------------------------------------------------------

  /**
   * Is the camera the story's (`camera`, `shot` — Game.update skips its play camera; DOF focuses on
   * what it looks at: the rig's look-at point)?
   */
  get ownsCamera() {
    return !!this._cam;
  }

  /**
   * The story takes the camera (the first `camera` or `shot` of a run): no look-ahead, the focus
   * free over the whole level (4 u round it); what the rig had is kept for `_cameraRestore`.
   */
  _camSession() {
    if (this._cam) return this._cam;
    const g = this.game;
    const rig = g.rig;
    this._cam = {
      proxy: null, from: new THREE.Vector3(), to: null, t: 0, dur: 0, resetting: false, resolve: null,
      saved: { lookAhead: rig.lookAhead, bounds: { ...rig.bounds } }, up: 0.9,
    };
    rig.lookAhead = 0;
    const W = g.level.width;
    const D = g.level.depth;
    rig.bounds = { minX: -4, maxX: W + 4, minZ: -4, maxZ: D + 4 };
    return this._cam;
  }

  /**
   * Look at a place or follow an object over `seconds` (the camera keeps it until `camera reset`
   * or the end of the run): a look target (a proxy the rig and the shadow frustum follow) eased
   * there.
   * `shot` looks at an actor's chest (the rig's own `targetOffsetY` over its feet: `chest`) and
   * takes the look over where the camera looks now; `camera` looks 0.9 u higher, as it always has.
   * @param {CamTarget} target
   * @param {number} seconds
   * @param {{ chest?: boolean }} [opts]
   * @returns {Promise<void>}
   */
  _cameraTo(target, seconds, { chest = false } = {}) {
    const g = this.game;
    const rig = g.rig;
    const c = this._camSession();
    if (!c.proxy) {
      const proxy = new THREE.Object3D();
      proxy.position.copy(rig.focusPoint);
      // (the rig adds its target offset over the proxy: a shot takes the look where it is)
      if (chest) proxy.position.y -= rig.targetOffsetY ?? 0;
      c.proxy = proxy;
      rig.setTarget(proxy);
      g.lighting.followTarget(proxy);
    }
    c.resolve?.();
    c.resolve = null;
    c.from.copy(c.proxy.position);
    c.up = chest ? 0 : 0.9;
    c.to = target;
    c.t = 0;
    c.dur = Math.max(0, seconds);
    c.resetting = false;
    if (c.dur === 0) {
      this._updateCamera(0);
      return Promise.resolve();
    }
    return new Promise((resolve) => { c.resolve = () => resolve(); });
  }

  /**
   * Back to the game's camera over `seconds` (`camera reset`, `shot reset`): the look target eases
   * to the player, the framing back to the game's (CameraRig `resetFraming`); then the camera is
   * the game's again.
   * @param {number} seconds
   * @returns {Promise<void>}
   */
  _cameraReset(seconds) {
    const c = this._cam;
    if (!c) return Promise.resolve();
    c.resolve?.();
    c.resolve = null;
    const dur = Math.max(0, seconds);
    if (c.proxy) {
      const p = this.game.player.position;
      const b = c.saved.bounds;
      // where the game's camera will look (its bounds clamp the focus): no jump at the hand-over
      c.from.copy(c.proxy.position);
      c.to = { x: Math.min(b.maxX, Math.max(b.minX, p.x)), z: Math.min(b.maxZ, Math.max(b.minZ, p.z)) };
    } else c.to = null;
    c.t = 0;
    c.dur = dur;
    c.resetting = true;
    const rig = this.game.rig;
    if (rig.framed) void rig.resetFraming(dur);
    return new Promise((resolve) => {
      c.resolve = resolve;
      if (dur === 0) this._updateCamera(0);
    });
  }

  /**
   * The camera back to the game (the end of a run, a reset arrived, a travel): its look-ahead,
   * bounds and target (the player; the shadow frustum too); a framing eases back over `ease` s
   * (0: a cut).
   * @param {{ ease?: number }} [opts]
   */
  _cameraRestore({ ease = 0 } = {}) {
    const c = this._cam;
    if (!c) return;
    const g = this.game;
    const rig = g.rig;
    rig.lookAhead = c.saved.lookAhead;
    rig.bounds = { ...c.saved.bounds };
    rig.setTarget(g.player.sprite);
    g.lighting.followTarget(g.player.sprite);
    if (rig.framed) {
      if (ease > 0) void rig.resetFraming(ease);
      else rig.endFraming();
    }
    this._cam = null;
    c.resolve?.();
  }

  /** The look target's move (real seconds); a reset that arrived gives the camera back. @param {number} dt */
  _updateCamera(dt) {
    const c = this._cam;
    if (!c) return;
    const to = c.to;
    // (an enemy group's foe fell: the look goes on to the group's next — eased when it had
    // arrived; the group all down, it stays on the last — on a fallen boss, its body)
    if (c.proxy && to?.foe && !to.foe.alive && to.group) {
      const next = this._groupFoe(to.group);
      if (next && next !== to.foe) {
        to.foe = next;
        to.object = next.sprite;
        if (c.t >= c.dur) {
          c.from.copy(c.proxy.position);
          c.t = 0;
          c.dur = GROUP_REFOCUS;
        }
      }
    }
    c.t = Math.min(c.dur, c.t + dt);
    const k = c.dur > 0 ? c.t / c.dur : 1;
    const e = k * k * (3 - 2 * k);
    if (c.proxy && to) {
      let tx;
      let ty;
      let tz;
      if (to.object) {
        to.object.getWorldPosition(c.proxy.position);
        tx = c.proxy.position.x;
        ty = c.proxy.position.y + c.up;
        tz = c.proxy.position.z;
      } else {
        tx = to.x;
        tz = to.z;
        ty = this.game.tileMap.getHeight(to.x, to.z);
      }
      c.proxy.position.set(c.from.x + (tx - c.from.x) * e, c.from.y + (ty - c.from.y) * e, c.from.z + (tz - c.from.z) * e);
    }
    if (k >= 1) {
      const r = c.resolve;
      c.resolve = null;
      if (c.resetting) this._cameraRestore();
      r?.();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Scripts, the journal, test hooks
  // ---------------------------------------------------------------------------------------------

  /**
   * Parse a script once (cached by its key and its text, the lines' `#line:` tags included); its
   * errors are counted and reported when it is parsed, so once per key and text. Its texts' keys
   * are its lines' tags (`parseScript` puts them on the nodes, I18N.md §4.2): the same text in
   * another file — a chapter variant's villager — is the same parse with the same keys; a variant
   * whose line was edited holds another text (another tag) and is a parse of its own.
   * @param {string} key
   * @param {unknown} source
   * @param {string} where for messages
   */
  _parse(key, source, where) {
    // (the source as the parser reads it: level data may hold anything — an object whose toString
    // throws is no script)
    const src = scriptLines(source).join('\n');
    const k = `${key}\u0000${src}`;
    let p = this._parsed.get(k);
    if (!p) {
      p = parseScript(source);
      for (const e of p.errors) {
        this.errors++;
        console.warn(`[Luminati] story: ${where}:${e.line}: ${e.msg}`);
      }
      this._parsed.set(k, p);
    }
    return p;
  }

  /**
   * A named script of the story files, parsed (a story file's inline actor talk is the script
   * `actor.<id>`, an event's inline run `event.<id>`); its texts' keys are its lines' tags. A node
   * run by `call` keeps its own script's keys. @param {string} id
   */
  _script(id) {
    const sc = ownValue(this.story?.scripts ?? {}, id);
    if (!sc) return null;
    return this._parse(`script:${id}`, sc.lines, `${sc.file} › ${id} (from line ${sc.line})`);
  }

  /**
   * A quest's stage text as the journal shows it: a declared stage's by the key the story file holds
   * for it (the built stage's `textKey`), its values filled in now; else the text a script saved
   * (I18N.md §4.5) — translated by the key saved beside it (its line's GUID) while the saved text is
   * its English (it had no values), as it is when values were filled in (English, no miss), and a
   * text saved without a key (or with one that is no GUID: StoryState drops it) as its English (a
   * `nokey` miss).
   * @param {string} id the quest
   * @param {import('./StoryState.js').QuestState} q
   * @param {string} st the stage
   * @returns {string}
   */
  _stageText(id, q, st) {
    const d = ownValue(this.story?.quests ?? {}, id);
    const stage = d?.stages.find((x) => x.id === st);
    const declared = stage?.text;
    if (declared) return interpolate(loc(stage.textKey ?? '', declared), this.reader);
    const saved = Object.hasOwn(q.texts, st) ? q.texts[st] : '';
    if (!saved) return '';
    const key = q.keys && Object.hasOwn(q.keys, st) ? q.keys[st] : '';
    const src = q.src && Object.hasOwn(q.src, st) ? q.src[st] : null;
    if (key && src !== null) return saved === src ? loc(key, src) : saved;
    // (a script's own text saved without a key — an ad-hoc run's line: `key` is '', so its English,
    // a `nokey` miss)
    return loc(key, saved);
  }

  /**
   * What the journal shows: the quests (title, text, stages reached, goals), the items, the gold —
   * translated at display: names as terms, declared texts by the keys the story files hold (the
   * built quest's, goal's and item's `textKey`; none: the English) and then filled in, the stage
   * texts by `_stageText`.
   */
  journalData() {
    const s = this.state;
    const declared = this.story?.quests ?? {};
    const quests = Object.entries(s.quests).map(([id, q]) => {
      const d = ownValue(declared, id);
      return {
        id,
        title: term(this.questTitle(id)),
        state: q.state,
        text: d ? loc(d.textKey ?? '', d.text) : '',
        log: q.log.map((st) => this._stageText(id, q, st)).filter(Boolean),
        goals: (d?.goals ?? []).map((gl) => ({ text: interpolate(loc(gl.textKey ?? '', gl.text), this.reader), done: !!gl.done && this.test(gl.done) })),
      };
    });
    const items = Object.entries(s.items).map(([id, count]) => {
      const it = ownValue(this.story?.items ?? {}, id);
      return { id, name: term(this.itemName(id)), count, text: it ? loc(it.textKey ?? '', it.text) : '', key: !!it?.key };
    });
    return { quests, items, gold: this.gold };
  }

  /** `state().story`. */
  info() {
    return {
      level: this.levelId,
      vars: { ...this.state.vars },
      items: { ...this.state.items },
      gold: this.gold,
      quests: Object.fromEntries(Object.entries(this.state.quests).map(([k, q]) => [k, { state: q.state, stage: q.stage }])),
      day: this.state.day,
      done: [...this.state.done],
      running: this.run ? this.run.key : '',
      queued: this.queue.map((q) => q.key),
      background: this.bgRuns.map((r) => r.key),
      backgroundQueued: this.bgQueue.map((q) => q.key),
      events: this.events.map((e) => ({ id: e.obj.id, on: e.obj.on, present: this.present(e.obj), done: this.state.isDone(e.key) })),
      ownsCamera: this.ownsCamera,
      errors: this.errors,
      ending: this.state.ending,
      cine: this.cineInfo(),
    };
  }

  /**
   * The set-piece direction now (`state().story.cine`, the tests): whether a framing owns the
   * camera, its orbit (°/s), the engine's time scale (slow motion), the title card's phase and
   * texts, the flash's colour ('' none), the poses played (`<who>:<pose>`), the effect jobs waiting,
   * the enemy group foe the director's look follows (`shot on <group>`: its uid, '' none).
   */
  cineInfo() {
    const g = this.game;
    const card = this._cine?.title;
    return {
      framed: !!g.rig?.framed,
      orbit: g.rig?.orbitRate ?? 0,
      timeScale: g.engine?.time?.timeScale ?? 1,
      title: card ? card.phase : 'gone',
      titleTexts: card?.active ? card.texts : null,
      flash: this._cine?.flash.color ?? '',
      poses: [...this._poses].map(([a, j]) => `${a === g.player ? 'player' : a.id}:${j.name}`),
      effects: pendingEffects(g),
      follows: this._cam?.to?.foe?.uid ?? '',
    };
  }

  /**
   * `window.__game.story` (docs/specs/AUTOMATION_API.md): the story test hooks.
   * @typedef {object} StoryHooks
   * @property {() => ReturnType<StoryRunner['info']>} info
   * @property {(name: string) => number} get  a flag / variable
   * @property {(name: string, value?: number) => boolean} set  set a flag / variable (default 1)
   * @property {(cond: string) => boolean} holds  does a condition hold
   * @property {(item: string, n?: number) => number} give  give (n < 0: take) an item; → the count
   * @property {(lines: string | string[]) => Promise<boolean>} run  run a script now (queued while
   *   the player is busy); → false when it does not parse
   * @property {(id: string) => boolean} fire  queue a level event as if triggered (ignores its trigger;
 *   a background event goes to the background lane)
 * @property {(n?: number) => number} seed  the journey's seed for `pick` (set it with a positive n)
   * @property {(answers?: number[]|boolean) => void} auto  tests: answer choices without windows
   *   (true: always the first option; an array: these answers in turn; false: the player again)
   * @property {() => boolean} skip  skip the cutscene running now
   * @property {() => string[]} trace  the last executed lines
   * @property {() => ReturnType<StoryRunner['journalData']>} journal
   */

  /** @returns {StoryHooks} */
  get hooks() {
    return {
      info: () => this.info(),
      get: (name) => this.state.get(String(name)),
      set: (name, value = 1) => (Number(value) === 1 || Number(value) === 0 ? this.state.setFlag(String(name), Number(value) === 1) : this.state.setVar(String(name), Number(value))),
      holds: (cond) => this.holds(String(cond)),
      give: (item, n = 1) => {
        if (String(item) === 'gold') this._items('gold', Number(n), { fast: true });
        else this.state.addItem(String(item), Number(n));
        return this.state.count(String(item));
      },
      run: (lines) => {
        const p = parseScript(lines);
        if (p.errors.length) {
          console.warn('[Luminati] story: test script:', p.errors);
          return Promise.resolve(false);
        }
        const key = `test:${Math.round(performance.now())}`;
        this.enqueue({ kind: 'test', key, nodes: p.nodes });
        return new Promise((resolve) => {
          const check = () => (this.run?.key === key || this.queue.some((q) => q.key === key) ? setTimeout(check, 50) : resolve(true));
          setTimeout(check, 50);
        });
      },
      fire: (id) => {
        const le = this.events.find((e) => e.obj.id === id);
        if (!le) return false;
        const spec = { kind: 'event', key: `event:${le.key}`, nodes: le.nodes, onceKey: le.obj.once ? le.key : '' };
        if (le.obj.background === true) this._enqueueBg(spec);
        else this.enqueue(spec);
        return true;
      },
      seed: (n) => {
        if (n !== undefined && Number.isInteger(Number(n)) && Number(n) > 0) this.state.seed = Number(n) >>> 0;
        return this.state.seed;
      },
      auto: (answers = true) => { this._auto = answers === false ? null : Array.isArray(answers) ? answers.map(Number) : []; },
      skip: () => this.skip(),
      trace: () => [...this._trace],
      journal: () => this.journalData(),
    };
  }

  dispose() {
    this.detachLevel();
    this._endUntils();
    this.queue.length = 0;
    this.bgQueue.length = 0;
    this._cam = null;
    this._actorSheets.clear();
    this._cine?.title.dispose();
    this._cine?.flash.dispose();
    this._cine = null;
  }
}
