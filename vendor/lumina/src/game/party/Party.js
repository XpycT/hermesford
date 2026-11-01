import * as THREE from 'three';
import { EventEmitter, CHARACTER_PRESETS, hashString, globalUniforms } from '../../engine/index.js';
import {
  MAX_PARTY, PARTY_CLASSES, PARTY_PRESETS, DEFAULT_PRESET, isClass, isPreset, isRuleValue,
  classForWeapon, normalizeRule, ruleOfPreset, presetOf,
} from '../../engine/level/PartyRules.js';
import { isStoryName } from '../../engine/level/StoryCondition.js';
import { t } from '../../engine/i18n/I18n.js';
import { term } from '../../engine/i18n/ContentText.js';
import { Nav } from '../combat/Nav.js';
import { PartyMember, createMemberSheet } from './PartyMember.js';
import {
  registerPartyStrings, classLabel, classHelp, roleLabel, weaponLabel, presetLabel, localFields, localPresets,
} from './strings.js';

/**
 * @import { Game } from '../Game.js'
 * @import { Npc } from '../Npc.js'
 * @import { PartyRecord, PartyRule, PartyInfo, PartyFrameEntry } from './types.js'
 */

/**
 * A member's name as the player reads it (docs/specs/I18N.md §4.8): a term — the record keeps the
 * English, an identity (saves, the story's `party` commands, `__game.party`) —, and 'Villager',
 * the name a villager without one is given (Game's `npcDef`, the catalog's default), as the UI
 * string of that default (`game.default.villager`).
 * @param {string} name the record's name
 * @returns {string}
 */
const memberName = (name) => (name === 'Villager' ? t('game.default.villager') : term(name));

// ---- the follow (docs/specs/PARTY.md §4.2) ----
/** Arc length between two members along the trail (member k stands at SPACING · (k + 1)). */
export const SPACING = 1.1;
/** The trail keeps a point every SAMPLE u of the player's way… */
const SAMPLE = 0.12;
/** …this many of them (≈ 48 u: the last member's point, the snap's spots further back). */
const TRAIL_CAP = 400;
/** A member's top speed: the player's run × 1.3. */
const MAX_SPEED = 5.6 * 1.3;
/** Closing time constant (s): on top of the player's speed it closes its gap at gap / TAU. */
const TAU = 0.16;
/** Below this pace (u/s) a member finishing its approach still walks (it never creeps). */
const MIN_PACE = 1.2;
/** Standing still: on its point within this distance. */
const ARRIVE = 0.05;
/** Farther than this from its point: catch-up (a run along the walk grid) … */
const CATCH_UP = 4;
/** … until it is this close again. */
const REJOIN = 0.9;
/** Farther than this from the player, or stuck STUCK s: put behind the player (the snap). */
const SNAP_DIST = 20;
const STUCK = 2;
/** The player stopped: no member rests nearer than GAP to them, nor nearer than APART to another. */
const GAP = 0.8;
const APART = 0.6;
/** The player moved farther than this in one frame: a teleport (a script's, an arrival). */
const JUMP = 2.5;
/** Seconds a member stands before it turns the way the player faces. */
const TURN_AFTER = 0.6;
/** Members put behind the player wait there until the player walked this far. */
const PLACE_MOVE = 0.3;
/** Catch-up: the walk grid is asked again at most this often (s), the straight way every LINE_EVERY s. */
const REPLAN = 0.5;
const LINE_EVERY = 0.15;
/** The party's own walk grid: rows per idle slice, ms per idle period. */
const NAV_ROWS_PER_STEP = 8;
const NAV_IDLE_MS = 6;
/** The player stands: a member's way that passes nearer than ROUND goes round them ROUND_R aside. */
const ROUND = 0.6;
const ROUND_R = 0.85;
/** Seconds a member stays directed after the story let go of it before the follow takes it back. */
const SCRIPT_GRACE = 0.5;
/** Body radius of the standable tests (tileMap.move's circle). */
const BODY = 0.3;
/** Largest height step between two standable samples (tileMap.move's maxStep). */
const STEP = 0.55;
// ---- the follow's feel (§4.2: a party, not a train) ----
/** Reaction: member k follows the trail point of REACT · (k + 1) s ago (it sets off and stops a beat after the one before it). */
const REACT = 0.06;
/** The reaction's history: one entry per frame (≥ REACT · MAX_PARTY s at 60 fps and more). */
const HIST = 48;
/** A member speeds up at most this fast (u/s²: a walk in 0.2 s) … */
const ACCEL = 16;
/** … brakes toward a goal that stands at this deceleration (u/s²: from a walk in ≈ 0.15 s; the pace it may have is √(2 · BRAKE · gap)) … */
const BRAKE = 22;
/** … slows down at most this fast otherwise (a goal that comes toward it: a few frames, never one). */
const SLOW = 60;
/** The last centimetres of an approach are walked at least this fast (no creep). */
const STOP_PACE = 0.6;
/** The player stands once it made no step for this long (s; a frame held up by a wall is no stop). */
const STAND_AFTER = 0.1;
/** A member walks to its rest spot (or out of the way) at this pace (u/s) — it runs only from farther than REST_RUN u. */
const REST_PACE = 3.4;
const REST_RUN = 3;
/** Spacing: each member's own offset (± u, by its id) and a slow sway along the way (± u, every SWAY_LEN u). */
const JITTER = 0.08;
const SWAY = 0.1;
const SWAY_LEN = 6.5;
/**
 * The trail runs toward the camera (the way to the member's trail point points down the screen):
 * the member walks LATERAL u to the side (the side it is on, else alternating by its place) so it
 * does not hide the player — blended in between the shares SHARE_ON … SHARE_FULL of that way's
 * screen-down component, and out again between DEPTH_ON … DEPTH_OFF u down the screen (far enough
 * below the player it hides nothing); eased with LATERAL_TAU s out (LATERAL_BACK s back); only where
 * it can stand.
 */
const LATERAL = 0.8;
const SHARE_ON = 0.35;
const SHARE_FULL = 0.75;
const DEPTH_ON = 2.6;
const DEPTH_OFF = 3.6;
const LATERAL_TAU = 0.12;
const LATERAL_BACK = 0.2;
/** A side is kept until the trail point lies this far on the other side of the player's column. */
const SIDE_SWITCH = 0.3;
/**
 * Where the side is walled (a passage, a bridge, stairs) a member that cannot step aside hangs
 * back instead: up to HANG u more trail (for the share of the offset it could not take), it and the
 * members after it — far enough down the screen not to hide the player; eased with HANG_TAU s.
 */
const HANG = 1.6;
const HANG_TAU = 0.25;
/**
 * Rest spots and placements are **screen-clear** (`_screenClear`): a member below the player on the
 * screen (toward the camera) stands at least CLEAR_SIDE u to the side of the player's column, or at
 * least CLEAR_FAR u down the screen; one up the screen (behind the player) is always clear.
 */
const CLEAR_SIDE = 1.05;
const CLEAR_FAR = 2.8;
const CLEAR_BEHIND = 0.1;
/**
 * The camera turned this far (rad) while the player stands, and has been still YAW_SETTLE s: the
 * rest spots are worked out again (once the turn ended: not while it goes on).
 */
const REST_YAW = 0.15;
const YAW_SETTLE = 0.25;
/**
 * The player walks into a member (it stands in the way: ahead of the player's step, nearer than
 * WAY_AHEAD u, within WAY_SIDE u of its line): the member makes way — a step to the side it
 * stands on, out to WAY_CLEAR u from that line — until the player has passed.
 */
const WAY_AHEAD = 2.2;
const WAY_SIDE = 0.75;
const WAY_CLEAR = 1.05;
/** The silhouette fade: a member nearer the camera whose body covers this much of the player's (screen rects). */
const COVER = 0.03;

/**
 * The built-in party conversation's opening lines (a member's talk without a script, §4.3): their
 * keys in the 'party' strings (src/game/party/strings.js), one picked per talk.
 */
const TALK_LINES = ['party.talk.line0', 'party.talk.line1', 'party.talk.line2', 'party.talk.line3'];
/** Its choices: Tactics… / Part ways / Carry on (keys). */
const TALK_CHOICES = ['party.talk.tactics', 'party.talk.part', 'party.talk.carryOn'];
/** The tactics panel's UI sounds → the game's SFX. */
const PANEL_SFX = { menuMove: 'blip', menuSelect: 'confirm', menuOpen: 'open', menuClose: 'close', menuCancel: 'cancel', blip: 'blip', confirm: 'confirm', open: 'open', close: 'close', cancel: 'cancel' };

const _p = new THREE.Vector3();

/**
 * The player's trail (§4.2): their ground positions as they move, one every SAMPLE u (with their
 * height and whether they ran), in a ring buffer. `pointBehind(x, z, s)` walks it back from the
 * player's position now by an arc length `s`. Allocates nothing per frame.
 */
export class Trail {
  /** @param {number} [cap] */
  constructor(cap = TRAIL_CAP) {
    this.cap = cap;
    this.xs = new Float32Array(cap);
    this.ys = new Float32Array(cap);
    this.zs = new Float32Array(cap);
    this.runs = new Uint8Array(cap);
    /** Points held. */
    this.n = 0;
    /** Index of the newest point. */
    this.head = -1;
    /** Arc length recorded since the last reset (only grows: "has the player walked on?"). */
    this.total = 0;
  }

  reset() {
    this.n = 0;
    this.head = -1;
    this.total = 0;
  }

  /** The index of the i-th newest point (0: the newest). @param {number} i */
  at(i) {
    return (this.head - i + this.cap * 2) % this.cap;
  }

  _push(x, y, z, run) {
    this.head = (this.head + 1) % this.cap;
    const h = this.head;
    this.xs[h] = x;
    this.ys[h] = y;
    this.zs[h] = z;
    this.runs[h] = run ? 1 : 0;
    if (this.n < this.cap) this.n++;
  }

  /**
   * The player is at (x, y, z): a point every SAMPLE u from the newest one toward it (the stretch
   * shorter than SAMPLE stays the live head of the trail).
   * @param {number} x @param {number} y @param {number} z @param {boolean} run
   */
  record(x, y, z, run) {
    if (!this.n) {
      this._push(x, y, z, run);
      return;
    }
    const h = this.head;
    const lx = this.xs[h];
    const ly = this.ys[h];
    const lz = this.zs[h];
    const dx = x - lx;
    const dz = z - lz;
    const d = Math.hypot(dx, dz);
    if (d < SAMPLE) return;
    const k = Math.floor(d / SAMPLE);
    const ux = dx / d;
    const uz = dz / d;
    for (let i = 1; i <= k; i++) {
      const s = i * SAMPLE;
      this._push(lx + ux * s, ly + (y - ly) * (s / d), lz + uz * s, run);
    }
    this.total += k * SAMPLE;
  }

  /**
   * The point at arc length `s` behind the player at (hx, hz) along the trail, into `out`; `short`
   * when the trail is shorter (`out` is then its oldest point).
   * @param {number} hx @param {number} hz @param {number} s
   * @param {{ x: number, y: number, z: number, short: boolean }} out
   */
  pointBehind(hx, hz, s, out) {
    if (!this.n) {
      out.x = hx;
      out.z = hz;
      out.short = true;
      return out;
    }
    let ax = hx;
    let az = hz;
    let ay = this.ys[this.head];
    let left = s;
    for (let i = 0; i < this.n; i++) {
      const k = this.at(i);
      const bx = this.xs[k];
      const bz = this.zs[k];
      const by = this.ys[k];
      const seg = Math.hypot(bx - ax, bz - az);
      if (seg >= left && seg > 1e-9) {
        const t = left / seg;
        out.x = ax + (bx - ax) * t;
        out.y = ay + (by - ay) * t;
        out.z = az + (bz - az) * t;
        out.short = false;
        return out;
      }
      left -= seg;
      ax = bx;
      az = bz;
      ay = by;
    }
    out.x = ax;
    out.y = ay;
    out.z = az;
    out.short = true;
    return out;
  }

  /** The trail's length from the player at (hx, hz) to its oldest point. @param {number} hx @param {number} hz */
  length(hx, hz) {
    let ax = hx;
    let az = hz;
    let len = 0;
    for (let i = 0; i < this.n; i++) {
      const k = this.at(i);
      len += Math.hypot(this.xs[k] - ax, this.zs[k] - az);
      ax = this.xs[k];
      az = this.zs[k];
    }
    return len;
  }
}

/**
 * The player's party (docs/specs/PARTY.md): the villagers who joined (at most `MAX_PARTY`), their
 * classes and combat rules. Part of the game's persistent half — made on demand
 * (`Game.ensureParty`, its own chunk: a game nobody joins never loads it) and kept across a
 * campaign's levels; each level gets its members as actors (`attachLevel` / `detachLevel`). The
 * records are the story's (`StoryState.party`, saved with a campaign); the party writes them back
 * after every change (`_save`). Without a story the party keeps them itself (for the session).
 *
 * Out of a fight the members follow the player's **trail** (§4.2): member k walks to the point an
 * arc length SPACING · (k + 1) (and a little of its own) behind the player along the way the player
 * walked — a beat late (REACT · (k + 1) s), easing in and out, to the side where the trail runs
 * toward the camera (it would hide the player), back further where it cannot step aside; when the
 * player stops it rests beside or behind the player on the screen, and it makes way when the player
 * walks into it. Farther than CATCH_UP it runs back (straight, else along the walk grid, else along
 * the trail); farther than SNAP_DIST, stuck STUCK s or with no way back it is put behind the player.
 * A teleport puts them behind the player at once (fanned out, clear of the player on the screen).
 * Deterministic: no randomness anywhere (a member's spacing jitter is seeded by its id).
 */
export class Party {
  /** @param {{ game: Game }} opts */
  constructor({ game }) {
    this.game = game;
    // the party's words (the panel, the frames, its talk and toasts: docs/specs/PIXEL_UI.md §8.1)
    registerPartyStrings();
    /** @type {PartyRecord[]} join order */
    this.records = [];
    /** @type {PartyMember[]} the members as actors of the level (same order as `records`) */
    this.members = [];
    /** 'join' (member), 'leave' (record), 'rule' (member, rule, source), 'sync' (). */
    this.events = new EventEmitter();
    /** @type {Map<string, any>} sheet key → character sheet (disposed with the party) */
    this._sheets = new Map();
    /** The player's trail. */
    this.trail = new Trail();
    /** The members have their actors on the level being played (`attachLevel` … `detachLevel`). */
    this.attached = false;
    /** Villagers the party hid, on any level (shown again when no longer held). @type {WeakSet<Npc>} */
    this._hid = new WeakSet();
    /** The villagers of the level being played the party hides (re-hidden every frame). @type {Npc[]} */
    this._hidHere = [];
    /** The way the trail was seeded (`_seedTrail`): its direction and length. @type {{ x: number, z: number, len: number }|null} */
    this._seedDir = null;
    /** The player's position last frame (a jump is a teleport). */
    this._last = { x: 0, z: 0, ok: false };
    /** Each member's rest spot while the player stands (`_computeRest`: no two on one spot). */
    this._rest = Array.from({ length: MAX_PARTY }, () => ({ x: 0, z: 0 }));
    /** `_rest` holds for this stop (cleared whenever the player walks or the line changes). */
    this._restValid = false;
    /** The camera yaw the rest spots were worked out for (a turn of REST_YAW works them out again). */
    this._restYaw = 0;
    /** Play time the follow has run (s): the reaction's clock. */
    this._clock = 0;
    /** Seconds the player has made no step (it stands from STAND_AFTER on). */
    this._standT = STAND_AFTER;
    /** The camera yaw last frame and how long it has not changed (s). */
    this._yawPrev = 0;
    this._yawStill = 0;
    /** The hang of the members before the one following now (`_follow`; summed in line order). */
    this._hangSum = 0;
    /** The player's way so far (u): the trail's length plus its live head. */
    this._arc = 0;
    /** The reaction's history (`_lagged`): per frame the clock, `_arc` and whether the player walked. */
    this._hist = { t: new Float64Array(HIST), arc: new Float64Array(HIST), mv: new Uint8Array(HIST), v: new Float32Array(HIST), head: -1, n: 0 };
    this._lag = { moving: false, arc: 0, v: 0 };
    /** The screen's right and down (toward the camera) on the ground, from the camera yaw (`_screenBasis`). */
    this._R = { x: 1, z: 0 };
    this._D = { x: 0, z: 1 };
    /**
     * A member nearer the camera covers part of the player on screen (`_updateCover`, every frame of
     * the follow): the game fades the player's x-ray silhouette meanwhile (it painted a pale ghost
     * of the player over that member).
     */
    this.coversPlayer = false;
    this._rect = { x0: 0, x1: 0, y0: 0, y1: 0, d: 0 };
    this._rect2 = { x0: 0, x1: 0, y0: 0, y1: 0, d: 0 };
    this._tgt = { x: 0, y: 0, z: 0, short: false };
    this._wp = { x: 0, z: 0 };
    this._pathBuf = new Float32Array(256);
    /** The party's own walk grid (no combat grid on this level), built ahead in idle time. @type {Nav|null} */
    this._nav = null;
    this._navMap = null;
    /** @type {Generator<undefined, void>|null} */
    this._navSteps = null;
    this._navIdle = 0;
    /** Conversations per member this session (the built-in talk's lines). @type {Map<string, number>} */
    this._talks = new Map();
    /** The engine frame the tactics panel last closed in (the G press that closed it reopens nothing). */
    this.closedFrame = -1;
    /** Totals for the tests (`trail()` hook). */
    this.stats = { snaps: 0, catchups: 0, placements: 0, jumps: 0, plans: 0, unplaced: 0 };
  }

  /** How many members. */
  get count() { return this.records.length; }

  /**
   * A member by id, actor or name (case-insensitive), or null.
   * @param {string} who
   * @returns {PartyMember|null}
   */
  find(who) {
    const s = String(who ?? '').trim();
    if (!s) return null;
    const low = s.toLowerCase();
    // (names read from level data or a save: anything coerced — a number name threw here)
    return this.members.find((m) => m.id === s)
      ?? this.members.find((m) => (m.record.actor && String(m.record.actor).toLowerCase() === low) || String(m.id).toLowerCase() === low || String(m.name).toLowerCase() === low)
      ?? null;
  }

  /**
   * Could this villager join now: there (as the story stands), not held by the party, a place
   * free, no travel going on? (`Game.canJoin` asks it before the join; `join` again.)
   * @param {Npc|null|undefined} npc
   */
  canTake(npc) {
    return !!npc && npc.present && this.count < MAX_PARTY && !this.holds(npc) && this.game.mode !== 'travel';
  }

  /** Is the villager `id` a member? @param {string} id */
  has(id) {
    return this.records.some((r) => r.id === id);
  }

  /**
   * Is this villager (a level object or an Npc) in the party — by id, or by its story actor?
   * @param {{ id?: string, actor?: unknown, storyObj?: any }} v
   */
  holds(v) {
    const id = v?.id;
    const actor = typeof v?.actor === 'string' ? v.actor.trim() : typeof v?.storyObj?.actor === 'string' ? v.storyObj.actor.trim() : '';
    return this.records.some((r) => r.id === id || (!!actor && r.actor === actor));
  }

  /**
   * A villager of this level joins (by id, actor or name, or the Npc itself). Refused (null) when
   * the party is full, it is a member already, or no such villager is here (or the story has it
   * away). The member appears where the villager stood and walks to the player.
   * @param {string|Npc} who
   * @param {{ cls?: string, preset?: string, rule?: Partial<PartyRule> }} [opts]
   * @returns {PartyMember|null}
   */
  join(who, opts = {}) {
    const g = this.game;
    const npc = typeof who === 'string' ? findVillager(g, who) : who;
    if (!this.canTake(npc)) return null;
    this._ensureAttached();
    const obj = npc.storyObj ?? {};
    const spec = obj.spec && typeof obj.spec === 'object' && !Array.isArray(obj.spec) ? { ...obj.spec } : null;
    // (the class follows the weapon the villager carries: its own spec's, else its preset's)
    const weapon = spec?.weapon ?? CHARACTER_PRESETS[npc.def.preset]?.weapon ?? null;
    const cls = isClass(opts.cls) ? opts.cls : classForWeapon(weapon);
    const base = ruleOfPreset(isPreset(opts.preset) ? opts.preset : DEFAULT_PRESET);
    /** @type {PartyRecord} */
    const record = {
      id: npc.id,
      name: String(npc.name ?? npc.id),
      actor: typeof obj.actor === 'string' ? obj.actor.trim() : '',
      preset: npc.def.preset,
      spec,
      color: npc.def.portraitColor ?? '#c9a45c',
      cls,
      rule: normalizeRule(opts.rule ?? base, base),
      level: g.campaign?.levelId ?? '',
    };
    // (the first member: the trail starts at the player now — nothing was recorded without one)
    if (!this.members.length) this._seedTrail();
    this.records.push(record);
    const m = new PartyMember({ party: this, record });
    this.members.push(m);
    this._restValid = false;
    const at = npc.position;
    const dir = dirVector(npc.sprite.direction);
    // (a speech bubble over the villager goes: its member speaks from now on)
    g.ui.emotes?.clear(npc.sprite, true);
    this._hide(npc);
    if (this.attached) {
      m.attach(g, at.x, at.z, dir);
      m.followGround(0, true);
      m.follow.mode = 'trail';
      this._rest[this.members.length - 1].x = at.x;
      this._rest[this.members.length - 1].z = at.z;
      g.combat?.addAlly(m);
      // (the party's walk grid, built ahead in idle time: a first catch-up that needs it does not
      // build it in one go — 13–30 ms on a 128 × 128 level)
      this._prepareNav();
    }
    this._save();
    this._changed();
    this.events.emit('join', m);
    return m;
  }

  /**
   * A member leaves: on its own level its villager appears where the member stood (there as the
   * story has it); elsewhere the member goes (a puff of dust) and its villager is back home.
   * @param {string} who
   * @returns {boolean}
   */
  leave(who) {
    const m = this.find(who);
    if (!m) return false;
    const g = this.game;
    const at = { x: m.position.x, z: m.position.z };
    const was = !!m.sprite;
    g.combat?.removeAlly(m);
    m.dispose();
    this.members.splice(this.members.indexOf(m), 1);
    this.records.splice(this.records.indexOf(m.record), 1);
    this._restValid = false;
    // (the line moved up: each member's last rest spot is where it stands)
    this.members.forEach((o, k) => { this._rest[k].x = o.position.x; this._rest[k].z = o.position.z; });
    const npc = this._villagerOf(m.record);
    const own = !m.record.level || !g.campaign || m.record.level === g.campaign.levelId;
    if (npc) {
      this._unhide(npc);
      if (own && was) {
        // the villager stays where it left (its home from now on: a post or wander villager put
        // back away from home walked straight home through the player — PARTY.md §4.1, D2); with
        // a story the home is the story's (saved with a campaign), as a script's `home`
        npc.placeAt(at.x, at.z);
        npc.setHome(at.x, at.z);
        this._rememberHome(npc, at.x, at.z);
        if (g.player) npc.faceWorld(g.player.position.x - at.x, g.player.position.z - at.z);
      } else npc.teleportHome();
      if (npc.directed) npc.release();
      npc.setPresent(g.story ? g.story.present(npc.storyObj) : true);
    }
    if (was && !(npc && own)) g.particles?.burst('footstep', _p.set(at.x, g.tileMap?.getHeight(at.x, at.z) ?? 0, at.z), 6);
    this._save();
    this._changed();
    this.events.emit('leave', m.record);
    return true;
  }

  /**
   * A villager's new home into the story's memory of the level (as StoryRunner's `home` command:
   * `levelMemory(levelId).homes[id]`, read back at the level's next attach, saved with a campaign).
   * Nothing without a story.
   * @param {Npc} npc @param {number} x @param {number} z
   */
  _rememberHome(npc, x, z) {
    const story = this.game.story;
    const st = story?.state;
    if (!st?.levelMemory || !story.levelId) return;
    st.levelMemory(story.levelId).homes[npc.id] = [+x.toFixed(3), +z.toFixed(3)];
    st.version++;
  }

  /**
   * Set a member's combat rule: a preset name or a (partial) rule (merged over its rule now).
   * @param {string} who
   * @param {string|Partial<PartyRule>} rule
   * @param {{ source?: 'player'|'story'|'test', quiet?: boolean }} [opts]
   * @returns {PartyRule|null} the rule now, or null (no such member, no such preset)
   */
  setRule(who, rule, { source = 'player', quiet = false } = {}) {
    const m = this.find(who);
    if (!m) return null;
    const next = typeof rule === 'string' ? ruleOfPreset(rule) : normalizeRule(rule, m.record.rule);
    if (!next) return null;
    m.record.rule = next;
    this._save();
    // (the panel shows the player's own change already)
    if (source !== 'player' && this.menuOpen) this.game.ui.party?.panel.setRule(m.id, { ...next });
    this.events.emit('rule', m, next, source);
    if (source === 'story' && !quiet) this.game.ui.hud.toast(t('party.toast.rule', { name: memberName(m.name), preset: presetLabel(presetOf(next)) }), 2.2);
    return { ...next };
  }

  /**
   * Set one field of a member's rule.
   * @param {string} who
   * @param {string} field
   * @param {string} value
   * @param {{ source?: 'player'|'story'|'test', quiet?: boolean }} [opts]
   * @returns {PartyRule|null}
   */
  setField(who, field, value, opts = {}) {
    if (!isRuleValue(field, value)) return null;
    return this.setRule(who, { [field]: value }, opts);
  }

  // ---------------------------------------------------------------------------------------------
  // The level
  // ---------------------------------------------------------------------------------------------

  /**
   * The level is being built (`Game._buildLevel`'s end: built, prepared or set aside and attached
   * again): the members arrive behind the player (fanned out, facing the player's way), registered
   * like the level's actors, allies of its combat; their villagers here are hidden. Again on an
   * attached level: everything is attached anew.
   */
  attachLevel() {
    const g = this.game;
    if (this.attached) this.detachLevel();
    this.attached = true;
    this._dropNav();
    const p = g.player.position;
    for (const m of this.members) m.attach(g, p.x, p.z, g.player.facing);
    this.placeBehind(this.members);
    for (const m of this.members) g.combat?.addAlly(m);
    this._applyVillagers();
    this._last.x = p.x;
    this._last.z = p.z;
    this._last.ok = true;
    if (this.members.length) this._prepareNav();
  }

  /** The level goes (`Game._detachLevel`): the members' actors with it (their records stay). */
  detachLevel() {
    const g = this.game;
    for (const m of this.members) {
      g.combat?.removeAlly(m);
      m.detach();
    }
    this.attached = false;
    this._hidHere = [];
    this._last.ok = false;
    this.trail.reset();
    this._dropNav();
  }

  /** A level is being played but the party was made after it was built (init's `syncParty`, a join). */
  _ensureAttached() {
    const g = this.game;
    if (!this.attached && g.mode !== 'travel' && g.player && g.world && g.tileMap) this.attachLevel();
  }

  /**
   * Who the party hides on this level: every villager it holds (by id or actor, on every level and
   * chapter variant); one it hid before and holds no longer (it left while the level was set
   * aside) is back at home, there as the story has it.
   */
  _applyVillagers() {
    const g = this.game;
    this._hidHere = [];
    for (const npc of g.npcs ?? []) {
      if (this.holds(npc)) this._hide(npc);
      else if (this._hid.has(npc)) {
        this._unhide(npc);
        npc.teleportHome();
        npc.setPresent(g.story ? g.story.present(npc.storyObj) : true);
      }
    }
  }

  /** @param {Npc} npc */
  _hide(npc) {
    if (npc.talking) npc.endTalk();
    if (npc.directed) npc.release();
    if (npc.present) npc.setPresent(false);
    this._hid.add(npc);
    if (!this._hidHere.includes(npc)) this._hidHere.push(npc);
  }

  /** The party holds this villager no longer (the caller shows it). @param {Npc} npc */
  _unhide(npc) {
    this._hid.delete(npc);
    const i = this._hidHere.indexOf(npc);
    if (i >= 0) this._hidHere.splice(i, 1);
  }

  /** The level's villager of a record (by id, else by actor), or null. @param {PartyRecord} r */
  _villagerOf(r) {
    const g = this.game;
    const byId = g.npcById?.get(r.id);
    if (byId) return byId;
    if (!r.actor) return null;
    return (g.npcs ?? []).find((n) => typeof n.storyObj?.actor === 'string' && n.storyObj.actor.trim() === r.actor) ?? null;
  }

  // ---------------------------------------------------------------------------------------------
  // The follow (§4.2)
  // ---------------------------------------------------------------------------------------------

  /**
   * One frame (after the player, the combat and the story moved; not while play is paused): the
   * trail grows, each member follows it — or waits while a fight, a script or a talk holds it.
   * @param {number} dt
   */
  update(dt) {
    const g = this.game;
    const pl = g.player;
    if (!this.attached || !pl || !this.members.length) {
      this.coversPlayer = false;
      return;
    }
    const p = pl.position;
    // a jump of the player (a script's teleport): as a teleport
    if (this._last.ok && Math.hypot(p.x - this._last.x, p.z - this._last.z) > JUMP) {
      this.stats.jumps++;
      this.onTeleport();
    }
    this._last.x = p.x;
    this._last.z = p.z;
    this._last.ok = true;
    this.trail.record(p.x, p.y, p.z, pl.running);
    // (a held villager the story would show again: hidden — the story's presence asks `holds` too)
    for (const npc of this._hidHere) {
      if (npc.present) {
        npc.setPresent(false);
        g.refreshActors();
      }
    }
    // (the player stands only after STAND_AFTER s without a step: a frame held up by a wall or a turn
    // is no stop — the members braked into a rest spot for it)
    this._standT = pl.speed > 0.05 || pl.scripted ? 0 : this._standT + dt;
    const moving = this._standT < STAND_AFTER;
    // the reaction's history: the way so far and whether the player walks, this frame
    this._clock += dt;
    const tr = this.trail;
    this._arc = tr.total + (tr.n ? Math.hypot(p.x - tr.xs[tr.head], p.z - tr.zs[tr.head]) : 0);
    this._pushHist(moving, pl.speed);
    this._screenBasis();
    // the player stands: where each member rests is worked out once (it stands still too) — again
    // when the camera turned (a rest spot clear of the player on screen may be in front of it now)
    const yaw = globalUniforms.uCameraYaw.value;
    this._yawStill = Math.abs(angleDiff(yaw, this._yawPrev)) > 1e-4 ? 0 : this._yawStill + dt;
    this._yawPrev = yaw;
    if (moving) this._restValid = false;
    else if (this._restValid && this._yawStill >= YAW_SETTLE && Math.abs(angleDiff(yaw, this._restYaw)) > REST_YAW) this._restValid = false;
    if (!moving && !this._restValid) {
      this._computeRest();
      this._restValid = true;
      this._restYaw = globalUniforms.uCameraYaw.value;
    }
    // (the members in line order: each one hangs back behind those before it that do)
    this._hangSum = 0;
    for (let k = 0; k < this.members.length; k++) {
      const m = this.members[k];
      this._follow(m, k, dt, moving);
      this._hangSum += m.follow.hang;
    }
    this._updateCover();
  }

  /** The screen's right / down on the ground (`_R`, `_D`) for the camera yaw now (Sprite3D's convention). */
  _screenBasis() {
    const yaw = globalUniforms.uCameraYaw.value;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    this._R.x = c;
    this._R.z = -s;
    this._D.x = s;
    this._D.z = c;
  }

  /** One frame of the reaction's history. @param {boolean} moving @param {number} speed the player's */
  _pushHist(moving, speed) {
    const h = this._hist;
    h.head = (h.head + 1) % HIST;
    h.t[h.head] = this._clock;
    h.arc[h.head] = this._arc;
    h.mv[h.head] = moving ? 1 : 0;
    h.v[h.head] = speed;
    if (h.n < HIST) h.n++;
  }

  /** Forget the reaction's history (the trail starts again: a teleport, a placement). */
  _resetHist() {
    this._hist.n = 0;
    this._hist.head = -1;
  }

  /**
   * What member k reacts to now: whether the player walked, the player's way so far and its pace,
   * REACT · (k + 1) s ago (the oldest frame held when the history is shorter; now without one).
   * @param {number} k
   * @returns {{ moving: boolean, arc: number, v: number }}
   */
  _lagged(k) {
    const h = this._hist;
    const out = this._lag;
    if (!h.n) {
      out.moving = false;
      out.arc = this._arc;
      out.v = 0;
      return out;
    }
    const want = this._clock - REACT * (k + 1) + 1e-9;
    let j = h.head;
    for (let i = 0; i < h.n; i++) {
      j = (h.head - i + HIST) % HIST;
      if (h.t[j] <= want) break;
    }
    out.moving = h.mv[j] === 1;
    out.arc = h.arc[j];
    out.v = h.v[j];
    return out;
  }

  /**
   * Member k's spacing behind the player now (u of trail): SPACING · (k + 1), its own offset and a
   * slow sway along the way (seeded by its id).
   * @param {PartyMember} m @param {number} k
   */
  _spacing(m, k) {
    const fo = m.follow;
    return SPACING * (k + 1) + fo.jit * JITTER + SWAY * Math.sin((this._arc / SWAY_LEN) * Math.PI * 2 + fo.phase);
  }

  /**
   * Member k's sideways offset (u along the screen's right) from its trail point (tx, tz) this frame
   * (eased into `follow.lat`): where the way to that point runs down the screen (toward the
   * camera) it would stand in front of the player — it walks LATERAL u to the side it is on (else
   * alternating by its place: 0 right, 1 left, 2 right), out of the player's column; less or none
   * where it cannot stand there (or walk there from its point).
   * @param {PartyMember} m @param {number} k @param {number} tx @param {number} tz @param {number} dt
   */
  _lateral(m, k, tx, tz, dt) {
    const fo = m.follow;
    const P = this.game.player.position;
    const R = this._R;
    const D = this._D;
    const ox = tx - P.x;
    const oz = tz - P.z;
    const dist = Math.hypot(ox, oz);
    let want = 0;
    fo.need = 0;
    const ty = this.game.tileMap.getHeight(tx, tz);
    const ok = (o) => {
      const x = tx + R.x * o;
      const z = tz + R.z * o;
      return this._standable(x, z, ty) && this._reachable(tx, tz, x, z);
    };
    if (dist > 0.3) {
      const dep = ox * D.x + oz * D.z;
      const l = ox * R.x + oz * R.z;
      const blend = smoothstep(SHARE_ON, SHARE_FULL, dep / dist) * (1 - smoothstep(DEPTH_ON, DEPTH_OFF, dep));
      if (blend > 0) {
        // (its side: the one its trail point is on; else the one it stands on; else by its place)
        if (fo.side === 0 || l * fo.side < -SIDE_SWITCH) {
          const own = (m.position.x - P.x) * R.x + (m.position.z - P.z) * R.z;
          fo.side = Math.abs(l) > SIDE_SWITCH ? Math.sign(l) : Math.abs(own) > SIDE_SWITCH ? Math.sign(own) : k % 2 ? -1 : 1;
        }
        want = fo.side * Math.max(0, LATERAL - fo.side * l) * blend;
        fo.need = want;
        if (Math.abs(want) > 0.02) {
          if (!ok(want)) want = ok(want * 0.5) ? want * 0.5 : 0;
        } else want = 0;
      } else fo.side = 0;
    }
    // eased (out to the side quickly, back more slowly); held up by a wall, straight back onto the way the
    // player walked; and never a goal it cannot stand on or walk to from its trail point — less of
    // the offset at once (the trail ran into a passage beside a house: it walked into the wall)
    fo.lat += (want - fo.lat) * (1 - Math.exp(-dt / (Math.abs(want) < Math.abs(fo.lat) ? LATERAL_BACK : LATERAL_TAU)));
    if (fo.stuck > 0.2) fo.lat *= Math.exp(-dt / 0.08);
    if (Math.abs(fo.lat) > 0.02 && !ok(fo.lat)) fo.lat = ok(fo.lat * 0.5) ? fo.lat * 0.5 : 0;
    return fo.lat;
  }

  /**
   * Make way: the player walks into member k — it stands ahead of the player's step (the way the
   * player faces) nearer than WAY_AHEAD u and within WAY_SIDE u of that line — so it steps aside,
   * out to WAY_CLEAR u from the line — up the screen when that step runs up / down it, else on the
   * side it stands on (else the other side; standable and reachable straight) — and waits there
   * until the player has passed it (`follow.way`; if the player stops meanwhile it rests there:
   * `wayHold`). Null when
   * it is not in the way (or has nowhere to go: the player walks through it, as before).
   * @param {PartyMember} m @param {number} k @param {boolean} moving the player walks
   * @returns {{ x: number, z: number }|null}
   */
  _makeWay(m, k, moving) {
    const fo = m.follow;
    if (!moving) {
      // (the player stopped while it stood aside: it rests there — it does not go on along the
      // trail for its reaction's beat first)
      if (fo.way) fo.wayHold = true;
      fo.way = null;
      return null;
    }
    fo.wayHold = false;
    const pl = this.game.player;
    const P = pl.position;
    const q = m.position;
    const fl = Math.hypot(pl.facing.x, pl.facing.z) || 1;
    const fx = pl.facing.x / fl;
    const fz = pl.facing.z / fl;
    const ox = q.x - P.x;
    const oz = q.z - P.z;
    const along = ox * fx + oz * fz;
    const across = -ox * fz + oz * fx;
    if (fo.way) {
      // (until the player has passed it, or turned away from it)
      if (along < -0.2 || along > WAY_AHEAD + 1.5 || Math.abs(across) > WAY_CLEAR + 1) fo.way = null;
      return fo.way;
    }
    if (along < 0.2 || along > WAY_AHEAD || Math.abs(across) >= WAY_SIDE) return null;
    // (the side: up the screen when the step aside runs mostly up / down it — behind the player
    // on the screen, never in front of it; else the side it stands on)
    const nd = -fz * this._D.x + fx * this._D.z;
    const s0 = Math.abs(nd) > 0.5 ? -Math.sign(nd) : Math.abs(across) > 0.05 ? Math.sign(across) : fo.side || (k % 2 ? -1 : 1);
    for (const s of [s0, -s0]) {
      const step = s * across >= 0 ? WAY_CLEAR - Math.abs(across) : WAY_CLEAR + Math.abs(across);
      const x = q.x - fz * s * step;
      const z = q.z + fx * s * step;
      if (this._standable(x, z) && this._reachable(q.x, q.z, x, z)) {
        fo.way = { x, z };
        return fo.way;
      }
    }
    return null;
  }

  /**
   * Is a member at (x, z) clear of the player on the screen — not in front of the player's body
   * (below it on the screen, nearer the camera) within CLEAR_SIDE u of its column and CLEAR_FAR u
   * down the screen? A spot behind the player (up the screen) is always clear.
   * @param {number} x @param {number} z
   */
  _screenClear(x, z) {
    const P = this.game.player.position;
    const ox = x - P.x;
    const oz = z - P.z;
    const dep = ox * this._D.x + oz * this._D.z;
    if (dep <= CLEAR_BEHIND || dep >= CLEAR_FAR) return true;
    return Math.abs(ox * this._R.x + oz * this._R.z) >= CLEAR_SIDE;
  }

  /**
   * Whether a member nearer the camera covers part of the player's body on screen (`coversPlayer`):
   * the sprites' quads projected (their bodies: the middle 44 % of the width, the lower 80 % of the
   * height), more than COVER of the player's body under a member's.
   */
  _updateCover() {
    const g = this.game;
    const cam = g.engine.camera;
    const pr = spriteRect(g.player.sprite, cam, this._rect);
    let cover = false;
    if (pr) {
      const area = Math.max(1e-6, (pr.x1 - pr.x0) * (pr.y1 - pr.y0));
      for (const m of this.members) {
        if (!m.sprite?.visible) continue;
        const r = spriteRect(m.sprite, cam, this._rect2);
        if (!r || r.d >= pr.d) continue;
        const w = Math.min(pr.x1, r.x1) - Math.max(pr.x0, r.x0);
        const h = Math.min(pr.y1, r.y1) - Math.max(pr.y0, r.y0);
        if (w > 0 && h > 0 && (w * h) / area > COVER) {
          cover = true;
          break;
        }
      }
    }
    this.coversPlayer = cover;
  }

  /**
   * One member's frame of the follow.
   * @param {PartyMember} m
   * @param {number} k its place in the line (0: right behind the player)
   * @param {number} dt
   * @param {boolean} moving the player walks (else: it stands, the members go to their rest spots)
   */
  _follow(m, k, dt, moving) {
    if (!m.sprite) return;
    const g = this.game;
    const fo = m.follow;
    // (a script that ended without giving the member back — no run, no walk of it — releases it)
    if (m.directed && this._scriptDone(m, dt)) m.release();
    const held = m.talking ? 'talk' : m.directed ? 'script' : m.combat?.active ? 'combat' : '';
    if (held) {
      fo.held = held;
      fo.heldT += dt;
      fo.path = null;
      fo.crumb = null;
      fo.stuck = 0;
      fo.v = 0;
      fo.way = null;
      fo.wayHold = false;
      // (the combat moves it by its own animations: no follow pace from before the fight is left
      // over when the follow takes it back — it hid the Talk prompt, "on the move", PARTY-17)
      if (held === 'combat') fo.speed = 0;
      // (a member put behind the player that a fight takes over follows the trail afterwards: as
      // 'placed' its rest spot was where it stood when the player stopped — after the fight it ran
      // back there, far from the player)
      if (fo.mode === 'placed') fo.mode = 'trail';
      m.followGround(dt);
      return;
    }
    if (fo.held) {
      // (a fight, a script or a talk let it go: the follow again — a catch-up when it fell behind;
      // the rest spots of a stop it was held in are worked out again — not for a hold of a frame or
      // two: a fight that flickers on and off near a foe)
      fo.held = '';
      fo.idle = 0;
      if (fo.mode === 'placed') fo.mode = 'trail';
      if (fo.heldT > 0.25) this._restValid = false;
    }
    fo.heldT = 0;
    const pl = g.player;
    const P = pl.position;
    const q = m.position;
    if (Math.hypot(q.x - P.x, q.z - P.z) > SNAP_DIST) {
      this._snap(m, k);
      return;
    }
    // the player walks into it (it stands ahead of the player's step): it makes way first
    const way = fo.mode === 'catchup' ? null : this._makeWay(m, k, moving);
    if (way && fo.mode === 'placed') fo.mode = 'trail';
    if (fo.mode === 'placed') {
      if (this.trail.total - fo.placedAt < PLACE_MOVE) {
        fo.v = 0;
        fo.gx = q.x;
        fo.gz = q.z;
        m.stand(dt, moving ? null : pl.facing, TURN_AFTER, pl.sprite.direction);
        m.followGround(dt);
        return;
      }
      fo.mode = 'trail';
    }
    // the goal: while the member "sees" the player walk (a beat late: REACT · (k + 1) s), the
    // trail point that far back — the player's way since then added to its spacing — and to the
    // side where that point lies in front of the player on the screen; else its rest spot
    const lag = this._lagged(k);
    const walking = lag.moving && !way && !fo.wayHold;
    let gx;
    let gz;
    const setOff = walking && !fo.walking;
    fo.walking = walking;
    if (way) {
      gx = way.x;
      gz = way.z;
    } else if (walking) {
      // (behind the members before it that hang back, and its own hang)
      const hang = this._hangSum + fo.hang;
      const t = this.trail.pointBehind(P.x, P.z, this._spacing(m, k) + Math.max(0, this._arc - lag.arc) + hang, this._tgt);
      // (setting off from its rest spot: its offset starts where it stands beside the trail — it
      // does not cut across behind the player to its old one)
      if (setOff) fo.lat = Math.max(-LATERAL * 1.5, Math.min(LATERAL * 1.5, (q.x - t.x) * this._R.x + (q.z - t.z) * this._R.z));
      let lat = this._lateral(m, k, t.x, t.z, dt);
      // (a goal beside the trail it cannot walk to straight — a corner between: back onto the
      // player's way, fast)
      if (Math.abs(lat) > 0.02 && !this._reachable(q.x, q.z, t.x + this._R.x * lat, t.z + this._R.z * lat)) {
        fo.lat = lat *= Math.exp(-dt / 0.06);
      }
      // walled in where it would step aside: it hangs back for what it could not take
      const missing = Math.max(0, Math.abs(fo.need) - Math.abs(lat)) / LATERAL;
      fo.hang += (missing * HANG - fo.hang) * (1 - Math.exp(-dt / HANG_TAU));
      gx = t.x + this._R.x * lat;
      gz = t.z + this._R.z * lat;
    } else {
      // the player stands (or set off a moment ago): it rests on its spot — never on the player,
      // nor on a member before it, nor in front of the player on the screen
      gx = this._rest[k].x;
      gz = this._rest[k].z;
      fo.hang *= Math.exp(-dt / HANG_TAU);
    }
    fo.gx = gx;
    fo.gz = gz;
    const dGoal = Math.hypot(gx - q.x, gz - q.z);
    if (fo.mode === 'trail' && dGoal > CATCH_UP) {
      fo.mode = 'catchup';
      fo.path = null;
      fo.crumb = null;
      fo.replan = 0;
      fo.lineT = 0;
      fo.catchups++;
      this.stats.catchups++;
    } else if (fo.mode === 'catchup' && dGoal < REJOIN) {
      fo.mode = 'trail';
      fo.path = null;
      fo.crumb = null;
    }
    let tx = gx;
    let tz = gz;
    let desired;
    if (fo.mode === 'catchup') {
      desired = MAX_SPEED;
      const w = this._catchupWaypoint(m, gx, gz, dt);
      if (!w) {
        // (no way back at all — none on the walk grid, none along the trail: put behind the player
        // now rather than running into a wall for STUCK s)
        this._snap(m, k);
        return;
      }
      tx = w.x;
      tz = w.z;
    } else {
      if (!walking && dGoal < ARRIVE) {
        fo.stuck = 0;
        fo.v = 0;
        m.stand(dt, moving ? null : pl.facing, TURN_AFTER, pl.sprite.direction);
        m.followGround(dt);
        return;
      }
      // the pace: the pace of the trail point it follows (feed-forward: the player's, a beat ago) and
      // the gap closed in TAU s — braking toward the goal (at most √(2 · BRAKE · gap): it slows down
      // into its spot instead of stopping dead)
      const ff = walking ? Math.min(lag.v, MAX_SPEED) : 0;
      const step = Math.max(dt, 1e-3);
      desired = Math.min(MAX_SPEED, Math.max(ff + dGoal / TAU, Math.min(MIN_PACE, dGoal / step)));
      const brake = Math.sqrt(2 * BRAKE * Math.max(0, dGoal - ARRIVE * 0.5));
      // (slowing down: along the braking curve — no sooner than it asks, no faster)
      if (desired < fo.v) desired = Math.min(fo.v, Math.max(desired, brake));
      desired = Math.min(desired, Math.max(brake, Math.min(STOP_PACE, dGoal / step)));
      // (to a rest spot or out of the way it walks — it runs only from farther than REST_RUN)
      if (!walking && dGoal < REST_RUN) desired = Math.min(desired, REST_PACE);
    }
    // eased: it speeds up over ≈ 0.2 s (and slows down over a few frames when the goal comes to it)
    fo.v = desired > fo.v ? Math.min(desired, fo.v + ACCEL * dt) : Math.max(desired, fo.v - SLOW * dt);
    // the player stands: a member never walks straight through them (it rounds them on its side)
    if (!moving) {
      const w = this._roundPlayer(q.x, q.z, tx, tz);
      tx = w.x;
      tz = w.z;
    }
    const want = Math.min(Math.hypot(tx - q.x, tz - q.z), fo.v * dt);
    const moved = m.stepToward(dt, tx, tz, fo.v);
    if (want > 1e-3 && moved < want * 0.25) fo.stuck += dt;
    else fo.stuck = Math.max(0, fo.stuck - dt);
    if (fo.stuck >= STUCK) {
      this._snap(m, k);
      return;
    }
    m.followGround(dt);
  }

  /**
   * Where to walk from (x, z) toward (tx, tz) without crossing the standing player: (tx, tz)
   * itself unless the straight way passes within ROUND of the player — then a point ROUND_R beside
   * the player on the member's side of that way (when it can stand there).
   * @returns {{ x: number, z: number }}
   */
  _roundPlayer(x, z, tx, tz) {
    const w = this._wp;
    w.x = tx;
    w.z = tz;
    const P = this.game.player.position;
    const ax = tx - x;
    const az = tz - z;
    const a2 = ax * ax + az * az;
    if (a2 < 1e-6 || Math.hypot(x - P.x, z - P.z) < 0.2) return w;
    const u = ((P.x - x) * ax + (P.z - z) * az) / a2;
    if (u <= 0 || u >= 1) return w;
    let cx = x + ax * u - P.x;
    let cz = z + az * u - P.z;
    let c = Math.hypot(cx, cz);
    if (c >= ROUND) return w;
    if (c < 1e-3) {
      // (dead on: round on the left of the way)
      cx = -az;
      cz = ax;
      c = Math.sqrt(a2);
    }
    const rx = P.x + (cx / c) * ROUND_R;
    const rz = P.z + (cz / c) * ROUND_R;
    if (this._standable(rx, rz)) {
      w.x = rx;
      w.z = rz;
    }
    return w;
  }

  /**
   * Has the story let go of a member it directed (no run of the main lane, no background run that
   * holds it, no walk of it — for SCRIPT_GRACE s)? StoryRunner gives villagers back at a run's end
   * (`release`); this covers a member until the story package does the same for members.
   * @param {PartyMember} m @param {number} dt
   */
  _scriptDone(m, dt) {
    /** @type {any} (StoryRunner's run state, read only) */
    const story = this.game.story;
    // (no story: whoever directs a member gives it back itself — tests)
    if (!story) return false;
    const busy = !!story.run || !!story.walks?.has?.(m) || !!story.bgRuns?.some?.((r) => r.actors?.has?.(m));
    m.follow.free = busy ? 0 : (m.follow.free ?? 0) + dt;
    return m.follow.free >= SCRIPT_GRACE;
  }

  /**
   * Where each member rests while the player stands (`this._rest`, worked out once per stop and
   * again after a camera turn): its natural spot — its trail point at its spacing, to the side it
   * walked on — unless that is within GAP of the player (a trail that folds back on itself), within
   * APART of a member before it, or in front of the player on the screen (`_screenClear`: below
   * the player, nearer the camera, within CLEAR_SIDE u of its column); then the spot around the
   * player (rings of 1.1 – 2.8 u, 24 ways) nearest to the natural one that keeps all three — beside
   * or behind the player —, which it can stand on and walk to straight from its trail point or from
   * where it stands; without such a spot, the nearest that keeps the first two; else where it
   * stands now. A member put behind the player (and waiting) rests where it is (its placement was
   * screen-clear already).
   */
  _computeRest() {
    const g = this.game;
    const P = g.player.position;
    const t = this._tgt;
    const R = this._R;
    this._screenBasis();
    for (let k = 0; k < this.members.length && k < this._rest.length; k++) {
      const m = this.members[k];
      const out = this._rest[k];
      const q = m.position;
      if (m.follow.mode === 'placed' || !m.sprite) {
        out.x = q.x;
        out.z = q.z;
        continue;
      }
      this.trail.pointBehind(P.x, P.z, this._spacing(m, k), t);
      const tx = t.x;
      const tz = t.z;
      const ty = g.tileMap.getHeight(tx, tz);
      const ok = (x, z) => {
        if (Math.hypot(x - P.x, z - P.z) < GAP - 1e-6) return false;
        for (let j = 0; j < k; j++) if (Math.hypot(x - this._rest[j].x, z - this._rest[j].z) < APART - 1e-6) return false;
        return this._standable(x, z, ty) && (this._reachable(tx, tz, x, z) || this._reachable(q.x, q.z, x, z));
      };
      // (a member that was not following the trail — it stood, or stepped out of the player's way —
      // stays where it stands when that is a good spot near the player: no shuffle at a stop)
      if (!m.follow.walking && m.follow.mode === 'trail' && Math.hypot(q.x - P.x, q.z - P.z) <= this._spacing(m, k) + 1.2
        && this._screenClear(q.x, q.z) && ok(q.x, q.z)) {
        out.x = q.x;
        out.z = q.z;
        continue;
      }
      const nx = tx + R.x * m.follow.lat;
      const nz = tz + R.z * m.follow.lat;
      if (this._screenClear(nx, nz) && ok(nx, nz)) {
        out.x = nx;
        out.z = nz;
        continue;
      }
      if (this._screenClear(tx, tz) && ok(tx, tz)) {
        out.x = tx;
        out.z = tz;
        continue;
      }
      // the spots around the player, nearest to the natural one first (then nearer the player)
      /** @type {[number, number, number][]} */
      const cands = [];
      for (const r of [1.1, 1.45, 1.8, 2.3, 2.8]) {
        for (let a = 0; a < 24; a++) {
          const ang = (a / 24) * Math.PI * 2;
          const x = P.x + Math.cos(ang) * r;
          const z = P.z + Math.sin(ang) * r;
          cands.push([Math.hypot(x - nx, z - nz) + 0.3 * r, x, z]);
        }
      }
      cands.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      let spot = null;
      let fallback = null;
      for (const [, x, z] of cands) {
        const clear = this._screenClear(x, z);
        if (!clear && fallback) continue;
        if (!ok(x, z)) continue;
        if (clear) {
          spot = [x, z];
          break;
        }
        fallback = [x, z];
      }
      // (none clear of the player on the screen: the nearest that keeps the rest; no room
      // anywhere near: it stays where it is)
      const s = spot ?? fallback ?? (ok(tx, tz) ? [tx, tz] : [q.x, q.z]);
      out.x = s[0];
      out.z = s[1];
    }
  }

  /**
   * Catch-up: the next point to run to — the goal itself while the way is clear, else the next
   * waypoint of a path on the walk grid (asked again every REPLAN s); with no path on the grid (it
   * is closed where the player squeezed through — a lamppost beside a house —, or the two ends lie
   * in parts it does not join) back along the player's own way (`_trailWay`); null when there is
   * no way at all (the caller puts the member behind the player).
   * @param {PartyMember} m @param {number} gx @param {number} gz @param {number} dt
   * @returns {{ x: number, z: number }|null}
   */
  _catchupWaypoint(m, gx, gz, dt) {
    const fo = m.follow;
    const q = m.position;
    const w = this._wp;
    fo.replan -= dt;
    fo.lineT -= dt;
    const look = fo.lineT <= 0;
    if (look) {
      fo.lineT = LINE_EVERY;
      fo.clear = this._lineClear(q.x, q.z, gx, gz);
    }
    if (fo.clear) {
      fo.path = null;
      fo.crumb = null;
      w.x = gx;
      w.z = gz;
      return w;
    }
    // (a path ended or is old: ask again — at most every REPLAN s, also when none was found)
    if (fo.crumb === null && (fo.replan <= 0 || (fo.path && fo.pathI >= fo.path.length))) {
      fo.replan = REPLAN;
      fo.path = this._plan(q.x, q.z, gx, gz);
      fo.pathI = 0;
      // (no way on the grid: back along the trail, from the nearest point of it it can walk to)
      if (!fo.path) fo.crumb = this._trailStart(q.x, q.z);
    }
    if (fo.crumb !== null) return this._trailWay(m, look);
    const path = fo.path;
    if (!path) return null;
    const reach = Math.max(0.15, dt * MAX_SPEED);
    while (fo.pathI < path.length && Math.hypot(path[fo.pathI] - q.x, path[fo.pathI + 1] - q.z) < reach) fo.pathI += 2;
    if (fo.pathI >= path.length) {
      w.x = gx;
      w.z = gz;
    } else {
      w.x = path[fo.pathI];
      w.z = path[fo.pathI + 1];
    }
    return w;
  }

  /**
   * The nearest point of the trail (within 3.5 u) a member at (x, z) can walk to in a straight
   * line: its place on the player's way (`follow.crumb`: the trail's length at that point), or null.
   * @param {number} x @param {number} z
   * @returns {number|null}
   */
  _trailStart(x, z) {
    const tr = this.trail;
    /** @type {[number, number][]} */
    const near = [];
    for (let i = 0; i < tr.n; i++) {
      const k = tr.at(i);
      const d = Math.hypot(tr.xs[k] - x, tr.zs[k] - z);
      if (d < 3.5) near.push([d, i]);
    }
    near.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let n = 0; n < Math.min(near.length, 12); n++) {
      const i = near[n][1];
      const k = tr.at(i);
      if (this._reachable(x, z, tr.xs[k], tr.zs[k])) return tr.total - i * SAMPLE;
    }
    return null;
  }

  /**
   * The catch-up along the trail: the point of the player's way it runs to (`follow.crumb`), moved
   * on toward the player — to the farthest point a few metres ahead it can walk to straight (every
   * LINE_EVERY s, and whenever it reached its point), else to the next one (the player walked from
   * point to point). Null when its point has left the trail (the ring buffer moved on).
   * @param {PartyMember} m @param {boolean} look
   * @returns {{ x: number, z: number }|null}
   */
  _trailWay(m, look) {
    const tr = this.trail;
    const fo = m.follow;
    const q = m.position;
    let i = Math.max(0, Math.round((tr.total - fo.crumb) / SAMPLE));
    if (i >= tr.n) {
      fo.crumb = null;
      return null;
    }
    let k = tr.at(i);
    const there = Math.hypot(tr.xs[k] - q.x, tr.zs[k] - q.z) < 0.35;
    if (look || there) {
      const was = i;
      for (const ahead of [32, 20, 12, 6]) {
        const j = i - ahead;
        if (j < 0) continue;
        const kj = tr.at(j);
        if (this._reachable(q.x, q.z, tr.xs[kj], tr.zs[kj])) {
          i = j;
          break;
        }
      }
      if (i === was && there) i = Math.max(0, i - 3);
      fo.crumb = tr.total - i * SAMPLE;
      k = tr.at(i);
    }
    const w = this._wp;
    w.x = tr.xs[k];
    w.z = tr.zs[k];
    return w;
  }

  /**
   * Waypoints [x0, z0, x1, z1 …] from (ax, az) to (bx, bz) on the walk grid (the combat's on a
   * combat level, else the party's own), or null.
   */
  _plan(ax, az, bx, bz) {
    const nav = this._navFor();
    if (!nav) return null;
    this.stats.plans++;
    try {
      const n = nav.findPath(ax, az, bx, bz, SNAP_DIST * 3, this._pathBuf, Math.min(nav.maxExpand, 8000));
      if (n <= 0) return null;
      return Array.from(this._pathBuf.subarray(0, n * 2));
    } catch (err) {
      console.warn('[Luminati] party: walk grid:', err);
      return null;
    }
  }

  /** Can a member walk straight from a to b (every 0.25 u standable, within a step of the last)? */
  _lineClear(ax, az, bx, bz) {
    const g = this.game;
    const nav = g.combat?.nav ?? (this._nav && this._navMap === g.tileMap && !this._navSteps ? this._nav : null);
    if (nav) return nav.lineClear(ax, az, bx, bz, 0, true);
    const tm = g.tileMap;
    const d = Math.hypot(bx - ax, bz - az);
    if (d < 1e-6) return true;
    let prev = tm.getHeight(ax, az);
    for (let s = 0.25; s <= d + 1e-9; s += 0.25) {
      const x = ax + ((bx - ax) * s) / d;
      const z = az + ((bz - az) * s) / d;
      if (!this._standable(x, z, prev)) return false;
      prev = tm.getHeight(x, z);
    }
    return true;
  }

  /**
   * Put a member behind the player at once (it fell too far behind, or was stuck): a standable spot
   * on the trail behind its own point — the first one the camera does not see (it runs in from
   * there), else its point — with a puff of dust.
   * @param {PartyMember} m @param {number} k
   */
  _snap(m, k) {
    const g = this.game;
    const P = g.player.position;
    const s0 = SPACING * (k + 1);
    const total = this.trail.length(P.x, P.z);
    let on = null;
    let off = null;
    const t = this._tgt;
    for (let s = s0; s <= Math.min(total, s0 + 30); s += 0.5) {
      this.trail.pointBehind(P.x, P.z, s, t);
      if (Math.hypot(t.x - P.x, t.z - P.z) > SNAP_DIST * 0.8) break;
      if (!this._standable(t.x, t.z)) continue;
      on ??= { x: t.x, z: t.z };
      if (this._offScreen(t.x, g.tileMap.getHeight(t.x, t.z), t.z)) {
        off = { x: t.x, z: t.z };
        break;
      }
    }
    const spot = off ?? on ?? this._slotSpot(k, [], P.x, P.z) ?? { x: P.x, z: P.z };
    m.placeAt(spot.x, spot.z);
    m.followGround(0, true);
    const fo = m.follow;
    fo.mode = off ? 'catchup' : 'trail';
    fo.stuck = 0;
    fo.path = null;
    fo.crumb = null;
    fo.v = 0;
    fo.way = null;
    fo.wayHold = false;
    fo.snaps++;
    this.stats.snaps++;
    g.particles?.burst('footstep', m.position, 6);
  }

  /** Is the world point outside the camera's view? */
  _offScreen(x, y, z) {
    const cam = this.game.engine.camera;
    _p.set(x, y + 0.9, z).project(cam);
    return _p.z > 1 || Math.abs(_p.x) > 1.05 || Math.abs(_p.y) > 1.05;
  }

  /**
   * Can a member stand at (x, z) — the tile or a walk surface, no collider, its body's rim within a
   * step — and, given `href`, within a step of that height?
   * @param {number} x @param {number} z @param {number} [href]
   */
  _standable(x, z, href) {
    const tm = this.game.tileMap;
    if (!tm.isWalkable(x, z)) return false;
    const h = tm.getHeight(x, z);
    if (href !== undefined && Math.abs(h - href) > STEP) return false;
    for (const [ox, oz] of RIM) {
      if (!tm.isWalkable(x + ox, z + oz) || Math.abs(tm.getHeight(x + ox, z + oz) - h) > STEP) return false;
    }
    return true;
  }

  /** Can a member walk from a to b in a straight line (every 0.2 u standable within a step)? */
  _reachable(ax, az, bx, bz) {
    const tm = this.game.tileMap;
    const d = Math.hypot(bx - ax, bz - az);
    let prev = tm.getHeight(ax, az);
    for (let s = Math.min(0.2, d); s <= d + 1e-9; s += 0.2) {
      const x = ax + ((bx - ax) * s) / Math.max(d, 1e-9);
      const z = az + ((bz - az) * s) / Math.max(d, 1e-9);
      if (!this._standable(x, z, prev)) return false;
      prev = tm.getHeight(x, z);
    }
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // Teleports and placement
  // ---------------------------------------------------------------------------------------------

  /** The player was put somewhere at once (Game.teleport, a respawn, a script): the members with them. */
  onTeleport() {
    if (!this.attached) return;
    const free = this.members.filter((m) => m.sprite && !m.directed && !m.talking);
    this.placeBehind(free);
    for (const m of this.members) m.combat?.onTeleport();
    const p = this.game.player.position;
    this._last.x = p.x;
    this._last.z = p.z;
    this._last.ok = true;
  }

  /**
   * Put members behind the player at once: the trail starts again at the player (straight back
   * the way the player faces, as far as the ground allows — else the most open way), member 0 on
   * it, members 1 and 2 fanned out beside it; facing the player's way, waiting there until the
   * player walks on.
   * @param {PartyMember[]} list
   */
  placeBehind(list) {
    const g = this.game;
    if (!g.player || !g.tileMap) return;
    const P = g.player.position;
    this._seedTrail();
    this._restValid = false;
    const taken = [];
    // (the members not moved keep their spots)
    for (const m of this.members) if (m.sprite && !list.includes(m)) taken.push({ x: m.position.x, z: m.position.z });
    const f = g.player.facing;
    for (const m of list) {
      const k = Math.max(0, this.members.indexOf(m));
      const slot = this._slotSpot(k, taken, P.x, P.z);
      // (no spot anywhere near it can stand on and walk to: on the player's own, running from there)
      const spot = slot ?? { x: P.x, z: P.z };
      taken.push(spot);
      m.placeAt(spot.x, spot.z);
      m.followGround(0, true);
      m.facing.x = f.x;
      m.facing.z = f.z;
      m.sprite?.faceVector(f.x, f.z);
      m.sprite?.play('idle');
      const fo = m.follow;
      fo.mode = slot ? 'placed' : 'catchup';
      fo.placedAt = this.trail.total;
      fo.path = null;
      fo.stuck = 0;
      fo.speed = 0;
      fo.v = 0;
      fo.lat = 0;
      fo.side = 0;
      fo.hang = 0;
      fo.way = null;
      fo.wayHold = false;
      fo.idle = TURN_AFTER;
      if (k < this._rest.length) {
        this._rest[k].x = spot.x;
        this._rest[k].z = spot.z;
      }
      this.stats.placements++;
      if (!slot) this.stats.unplaced++;
    }
  }

  /**
   * A member steps up to the player for a talk (`Game.talkTo`): unless it stands within reach in
   * front of them already, it is put 1.15 u in front of the player (else beside, else behind) on a
   * spot it can stand on and walk to from the player.
   * @param {PartyMember} m
   * @returns {boolean} whether it is within reach now
   */
  standBeside(m) {
    const g = this.game;
    const P = g.player.position;
    const f = g.player.facing;
    const q = m.position;
    const d = Math.hypot(q.x - P.x, q.z - P.z);
    if (d > 0.5 && d < m.talkRadius - 0.1 && ((q.x - P.x) * f.x + (q.z - P.z) * f.z) / d > 0.5) return true;
    const r = 1.15;
    for (const [ox, oz] of [[f.x, f.z], [-f.z, f.x], [f.z, -f.x], [-f.x, -f.z]]) {
      const x = P.x + ox * r;
      const z = P.z + oz * r;
      if (!this._standable(x, z) || !this._reachable(P.x, P.z, x, z)) continue;
      m.placeAt(x, z);
      m.followGround(0, true);
      m.follow.mode = 'trail';
      m.follow.v = 0;
      return true;
    }
    return false;
  }

  /**
   * The trail starts again at the player: a straight line of points behind them (the way they face,
   * else the most open of a fan of ways), as long as the ground allows (up to the last member's
   * place and a little).
   */
  _seedTrail() {
    const g = this.game;
    const P = g.player.position;
    const f = g.player.facing;
    const need = SPACING * MAX_PARTY + 0.6;
    const bx = -f.x;
    const bz = -f.z;
    let best = { len: 0, ux: bx, uz: bz };
    for (const deg of [0, 30, -30, 60, -60, 90, -90, 135, -135, 180]) {
      const a = (deg * Math.PI) / 180;
      const ux = bx * Math.cos(a) - bz * Math.sin(a);
      const uz = bx * Math.sin(a) + bz * Math.cos(a);
      let len = 0;
      let prev = g.tileMap.getHeight(P.x, P.z);
      for (let s = SAMPLE; s <= need + 1e-9; s += SAMPLE) {
        const x = P.x + ux * s;
        const z = P.z + uz * s;
        if (!this._standable(x, z, prev)) break;
        prev = g.tileMap.getHeight(x, z);
        len = s;
      }
      if (len > best.len) best = { len, ux, uz };
      if (len >= need - 1e-6) break;
    }
    const tr = this.trail;
    tr.reset();
    const n = Math.round(best.len / SAMPLE);
    for (let i = n; i >= 1; i--) {
      const x = P.x + best.ux * i * SAMPLE;
      const z = P.z + best.uz * i * SAMPLE;
      tr._push(x, g.tileMap.getHeight(x, z), z, false);
    }
    tr._push(P.x, P.y, P.z, false);
    tr.total = 0;
    this._seedDir = { x: best.ux, z: best.uz, len: best.len };
    // (the way so far starts again with it: the reaction's history goes)
    this._arc = 0;
    this._resetHist();
  }

  /**
   * Member k's spot behind the player at (px, pz) after a placement — standable, reachable in a
   * straight line from the player, never within APART of a spot `taken` — tried in this order: k 0
   * on the trail at SPACING, k 1 / 2 fanned out to the left / right of it; its trail point at its
   * own distance; the spots around the player (1.1 – 2.8 u, from behind them round to the front) —
   * first only those clear of the player on the screen (`_screenClear`: not in front of the player,
   * toward the camera), then any of them; then a wider search (0.8 – 4 u, 16 ways); else null.
   * @param {number} k @param {{ x: number, z: number }[]} taken @param {number} px @param {number} pz
   * @returns {{ x: number, z: number }|null}
   */
  _slotSpot(k, taken, px, pz) {
    const g = this.game;
    const sd = this._seedDir ?? { x: -g.player.facing.x, z: -g.player.facing.z, len: 0 };
    const free = (x, z) => taken.every((t) => Math.hypot(t.x - x, t.z - z) >= APART);
    const ok = (x, z) => free(x, z) && this._standable(x, z) && this._reachable(px, pz, x, z);
    /** @type {[number, number][]} */
    const cands = [];
    if (k === 0) cands.push([px + sd.x * SPACING, pz + sd.z * SPACING]);
    else {
      const side = k === 1 ? 1 : -1;
      // (left of the way back is the player's right hand… either way: the fan's two sides)
      const lx = -sd.z * side;
      const lz = sd.x * side;
      cands.push([px + sd.x * 1.6 + lx * 0.85, pz + sd.z * 1.6 + lz * 0.85]);
    }
    const t = this.trail.pointBehind(px, pz, SPACING * (k + 1), this._tgt);
    if (!t.short) cands.push([t.x, t.z]);
    const f = g.player.facing;
    const around = (radii, ways, out) => {
      for (const r of radii) {
        for (const deg of ways) {
          const a = (deg * Math.PI) / 180;
          const ux = -f.x * Math.cos(a) + f.z * Math.sin(a);
          const uz = -f.x * Math.sin(a) - f.z * Math.cos(a);
          out.push([px + ux * r, pz + uz * r]);
        }
      }
      return out;
    };
    around([1.1, 1.6, 2.2, 2.8], [0, 45, -45, 90, -90, 135, -135, 180], cands);
    this._screenBasis();
    for (const [x, z] of cands) if (this._screenClear(x, z) && ok(x, z)) return { x, z };
    for (const [x, z] of cands) if (ok(x, z)) return { x, z };
    // (a tight place — a room's corner behind a counter, the map's edge: wider and finer, and also a
    // spot reachable round one corner — straight from a spot that is reachable from the player)
    const ways = [0, 22.5, -22.5, 45, -45, 67.5, -67.5, 90, -90, 112.5, -112.5, 135, -135, 157.5, -157.5, 180];
    const wide = around([0.8, 1.4, 2, 2.6, 3.2, 4], ways, []);
    /** @type {[number, number][]} standable spots reachable straight from the player (taken or not) */
    const elbows = [];
    for (const [x, z] of wide) {
      if (!this._standable(x, z)) continue;
      if (this._reachable(px, pz, x, z)) {
        if (free(x, z)) return { x, z };
        if (elbows.length < 8) elbows.push([x, z]);
      }
    }
    for (const [x, z] of wide) {
      if (!free(x, z) || !this._standable(x, z) || this._reachable(px, pz, x, z)) continue;
      if (elbows.some(([ex, ez]) => this._reachable(ex, ez, x, z))) return { x, z };
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // The walk grid (catch-up)
  // ---------------------------------------------------------------------------------------------

  /** The walk grid: the combat's on a combat level, else the party's own (the rest of it built now). */
  _navFor() {
    const g = this.game;
    if (g.combat?.nav) return g.combat.nav;
    if (this._nav && this._navMap === g.tileMap) {
      if (this._navSteps) {
        const steps = this._navSteps;
        this._navSteps = null;
        for (let r = steps.next(); !r.done; r = steps.next());
      }
      return this._nav;
    }
    this._dropNav();
    try {
      this._nav = new Nav(g.tileMap, { maxExpand: 8000 });
      this._navMap = g.tileMap;
    } catch (err) {
      console.warn('[Luminati] party: walk grid:', err);
      return null;
    }
    return this._nav;
  }

  /** Build the party's walk grid ahead, in idle time (no combat grid here). */
  _prepareNav() {
    const g = this.game;
    if (g.combat?.nav || this._nav || typeof requestIdleCallback !== 'function' || !g.tileMap) return;
    this._nav = new Nav(g.tileMap, { maxExpand: 8000, defer: true });
    this._navMap = g.tileMap;
    this._navSteps = this._nav.buildSteps(null, NAV_ROWS_PER_STEP);
    this._stepNav();
  }

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

  /** Forget the party's walk grid (a level left, the level's colliders changed). */
  dropNav() {
    this._dropNav();
    if (this.attached && this.members.length) this._prepareNav();
  }

  _dropNav() {
    if (this._navIdle && typeof cancelIdleCallback === 'function') cancelIdleCallback(this._navIdle);
    this._navIdle = 0;
    this._navSteps = null;
    this._nav = null;
    this._navMap = null;
  }

  // ---------------------------------------------------------------------------------------------
  // Saves (§2)
  // ---------------------------------------------------------------------------------------------

  /**
   * The story's records changed under the party (a save loaded, a new journey): the members follow
   * them — records checked (untrusted), no member twice, at most MAX_PARTY; members no longer
   * there go (their villagers here come back, at home), new ones arrive behind the player.
   */
  syncFromState() {
    const g = this.game;
    const st = g.story?.state;
    if (!st) return;
    const want = sanitizeRecords(st.party);
    // (the state keeps the records as checked: a save written next holds no bad one)
    if (JSON.stringify(want) !== JSON.stringify(st.party)) st.setParty?.(want);
    let changed = false;
    for (const m of [...this.members]) {
      if (want.some((r) => r.id === m.id)) continue;
      g.combat?.removeAlly(m);
      m.dispose();
      this.members.splice(this.members.indexOf(m), 1);
      const npc = this._villagerOf(m.record);
      if (npc) {
        this._unhide(npc);
        npc.teleportHome();
        npc.setPresent(g.story ? g.story.present(npc.storyObj) : true);
      }
      changed = true;
    }
    this.records = want;
    this._restValid = false;
    this._ensureAttached();
    /** @type {PartyMember[]} */
    const added = [];
    for (const r of this.records) {
      const m = this.members.find((x) => x.id === r.id);
      if (m) {
        if (JSON.stringify(m.record) !== JSON.stringify(r)) changed = true;
        m.record = r;
        m.name = r.name;
        m.def.preset = r.preset;
        m.def.portraitColor = r.color;
        continue;
      }
      const nm = new PartyMember({ party: this, record: r });
      this.members.push(nm);
      added.push(nm);
      changed = true;
    }
    this.members.sort((a, b) => this.records.findIndex((r) => r.id === a.id) - this.records.findIndex((r) => r.id === b.id));
    if (this.attached && added.length) {
      const p = g.player.position;
      if (this.members.length === added.length) this._seedTrail();
      for (const m of added) m.attach(g, p.x, p.z, g.player.facing);
      this.placeBehind(added);
      for (const m of added) g.combat?.addAlly(m);
      this._prepareNav();
    }
    if (this.attached) this._applyVillagers();
    if (changed) {
      this._changed();
      this.events.emit('sync');
    }
  }

  /** The records into the story's state (saved with a campaign). */
  _save() {
    this.game.story?.state?.setParty?.(this.records);
  }

  /** The party changed (a join, a leave, a sync): the maps, the legend, the open panel. */
  _changed() {
    const g = this.game;
    g.refreshActors?.();
    g.refreshPartyLegend?.();
    // (the open panel shows the members as they are now — still on the member it showed, when that
    // one is still in the party)
    if (this.menuOpen) {
      if (!this.members.length) this.closeMenu();
      else {
        const shown = g.ui.party?.panel.memberId;
        this.openMenu(shown && this.members.some((m) => m.id === shown) ? shown : undefined);
      }
    }
  }

  /**
   * A member's sheet (cached: plain, or the combat sheet with its class weapon).
   * @param {PartyRecord} record
   * @param {boolean} combat
   */
  sheetFor(record, combat) {
    const key = JSON.stringify([record.preset, record.spec, combat ? record.cls : '']);
    let s = this._sheets.get(key);
    if (!s) {
      s = createMemberSheet(record, combat);
      this._sheets.set(key, s);
    }
    return s;
  }

  // ---------------------------------------------------------------------------------------------
  // Talk (§4.3) and the tactics panel (§4.4)
  // ---------------------------------------------------------------------------------------------

  /**
   * Talk to a member (Game._interact, which holds the player): its talk script when the story has
   * one (the villager's `talk`, else its actor's — `StoryRunner.talkFor`), else the party
   * conversation: its line and a choice — Tactics… (the panel on it), Part ways (asked again, then
   * `leave`), Carry on.
   * @param {PartyMember} m
   */
  async talk(m) {
    const g = this.game;
    // (the story package's member talk: `talkFor(member)` → the parsed script or null, and
    // `talk(member)` — StoryRunner's own types know villagers only until it lands, PARTY.md §7.5)
    /** @type {any} */
    const story = g.story;
    const nodes = story?.talkFor?.(m) ?? null;
    if (story && nodes) {
      m.storyTalk = nodes;
      await story.talk(m);
      return;
    }
    await this._converse(m);
  }

  /**
   * The built-in party conversation, in the page's language: the member's name plate
   * (`memberName`), its portrait (its sheet) and its class as the plate's title (DialogBox's
   * `sheet` / `title`, docs/specs/PIXEL_UI.md §8.1).
   * @param {PartyMember} m
   */
  async _converse(m) {
    const g = this.game;
    const visits = this._talks.get(m.id) ?? 0;
    this._talks.set(m.id, visits + 1);
    const sheet = this.sheetFor(m.record, !!g.combatEnabled)?.canvas ?? null;
    const say = (/** @type {(string | { text: string, choices?: string[] })[]} */ lines) => {
      const opts = { speaker: memberName(m.name), lines, portraitColor: m.record.color, sheet, title: classLabel(isClass(m.record.cls) ? m.record.cls : 'warden') };
      return g.ui.dialog.open(opts);
    };
    const line = t(TALK_LINES[(hashString(m.id) + visits) % TALK_LINES.length]);
    const choice = await say([{ text: line, choices: TALK_CHOICES.map((k) => t(k)) }]);
    if (choice === 0) {
      g.togglePartyMenu(true, m.id, { force: true });
    } else if (choice === 1) {
      const sure = await say([{ text: t('party.talk.stayQ'), choices: [t('party.talk.stay'), t('party.talk.leave')] }]);
      if (sure === 1) {
        await say([t('party.talk.bye')]);
        this.leave(m.id);
      } else await say([t('party.talk.glad')]);
    }
  }

  /** The tactics panel is open. */
  get menuOpen() {
    return !!this.game.ui.party?.panel.isOpen;
  }

  /**
   * Open the tactics panel (focus a member). The game's `togglePartyMenu` is the way in (it gates
   * and pauses); this only fills and opens the panel.
   * @param {string} [who]
   * @returns {boolean} open
   */
  openMenu(who) {
    const g = this.game;
    const panel = g.ui.party?.panel;
    if (!panel || !this.count) return false;
    this.wireUI();
    panel.onRule = (id, rule) => { this.setRule(id, rule, { source: 'player' }); };
    // (in the page's language: the names as terms — `memberName` —, the rule vocabulary by id —
    // PartyRules.js stays English; the portrait from the member's sheet on this level)
    const combat = !!g.combatEnabled;
    const cls = (/** @type {PartyMember} */ m) => (isClass(m.record.cls) ? m.record.cls : 'warden');
    panel.open({
      members: this.members.map((m) => ({
        id: m.id, name: memberName(m.name), color: m.record.color,
        cls: classLabel(cls(m)), clsHelp: classHelp(cls(m)), clsId: cls(m),
        role: roleLabel(m.cls.role), weapon: weaponLabel(m.cls.weapon),
        portrait: this.sheetFor(m.record, combat)?.canvas ?? null,
        rule: { ...m.record.rule },
      })),
      focus: who ? this.find(who)?.id : undefined,
      presets: localPresets(),
      fields: localFields(),
      closeKey: 'G',
    });
    return panel.isOpen;
  }

  /**
   * The tactics panel's callbacks (docs/specs/PARTY.md §6.5): its UI sounds as the game's SFX, and
   * its close (whoever closes it) noted — the G that closed it opens nothing in the same frame.
   * `Game.ensureParty` calls it after `usePartyUI`; `openMenu` again (a panel set up later).
   */
  wireUI() {
    const g = this.game;
    const panel = g.ui.party?.panel;
    if (!panel) return;
    panel.onClose = () => { this.closedFrame = g.engine.time.frame; };
    panel.onSound = (name) => {
      const sfx = Object.hasOwn(PANEL_SFX, name) ? PANEL_SFX[name] : null;
      if (sfx) g.audio.playSfx(sfx, { volume: 0.5 });
    };
  }

  closeMenu() {
    const panel = this.game.ui.party?.panel;
    if (!panel?.isOpen) return;
    panel.close();
    this.closedFrame = this.game.engine.time.frame;
  }

  /** The HUD's lines (PartyFrames). @returns {PartyFrameEntry[]} */
  frames() {
    return this.members.map((m) => {
      const c = m.combat;
      return {
        id: m.id, name: memberName(m.name), color: m.record.color,
        cls: classLabel(isClass(m.record.cls) ? m.record.cls : 'warden'), tactic: presetLabel(presetOf(m.record.rule)),
        ...(c ? { hp: c.hp, hpMax: c.hpMax, mp: c.mp, mpMax: c.mpMax, down: c.down, fighting: c.active, ...(Number.isFinite(c.level) ? { level: c.level } : {}) } : {}),
      };
    });
  }

  /** The members' live positions for the maps (`map.party`, §4.4). */
  mapPositions() {
    return this.members.filter((m) => m.sprite).map((m) => m.position);
  }

  /** `state().party`. @returns {PartyInfo} */
  info() {
    const p = this.game.player?.position;
    return {
      members: this.members.map((m) => {
        const q = m.position;
        const c = m.combat;
        return {
          id: m.id, name: m.name, cls: m.record.cls, preset: presetOf(m.record.rule), rule: { ...m.record.rule },
          x: +q.x.toFixed(3), y: +q.y.toFixed(3), z: +q.z.toFixed(3),
          mode: m.talking ? 'talk' : m.directed ? 'script' : c?.active ? 'combat' : 'follow',
          // (the follow's own state: 'placed' | 'trail' | 'catchup'; whether it has a sprite here)
          follow: m.follow.mode,
          attached: !!m.sprite,
          dist: p ? +Math.hypot(q.x - p.x, q.z - p.z).toFixed(3) : 0,
          ...(c ? { hp: Math.round(c.hp), hpMax: Math.round(c.hpMax), down: c.down } : {}),
        };
      }),
      menuOpen: this.menuOpen,
    };
  }

  /**
   * The follow as the tests read it (`__game.party.trail(who)`): the trail (newest first, at most
   * `max` points), its length, and per member its place in the line, its trail point and how far it
   * is from it along the ground; the totals (snaps, catch-ups, placements, jumps, path searches).
   * @param {string} [who] one member (id, actor or name); all without
   * @param {number} [max]
   */
  trailInfo(who, max = 60) {
    const g = this.game;
    const P = g.player?.position;
    const tr = this.trail;
    const points = [];
    for (let i = 0; i < Math.min(tr.n, max); i++) {
      const k = tr.at(i);
      points.push([+tr.xs[k].toFixed(3), +tr.zs[k].toFixed(3), +tr.ys[k].toFixed(3), tr.runs[k]]);
    }
    const list = who ? [this.find(who)].filter(Boolean) : this.members;
    const t = { x: 0, y: 0, z: 0, short: false };
    return {
      n: tr.n,
      total: +tr.total.toFixed(3),
      length: P ? +tr.length(P.x, P.z).toFixed(3) : 0,
      points,
      members: list.map((m) => {
        const k = this.members.indexOf(m);
        if (P) tr.pointBehind(P.x, P.z, SPACING * (k + 1), t);
        const q = m.position;
        const fo = m.follow;
        return {
          id: m.id, k, mode: fo.mode, held: fo.held,
          x: +q.x.toFixed(3), y: +q.y.toFixed(3), z: +q.z.toFixed(3),
          target: { x: +t.x.toFixed(3), z: +t.z.toFixed(3), short: t.short },
          off: +Math.hypot(t.x - q.x, t.z - q.z).toFixed(3),
          // (where it walked to this frame — its trail point a beat late and to the side, its rest
          // spot, the catch-up's goal — and how far it is from it; its pace, side offset, spacing)
          goal: { x: +fo.gx.toFixed(3), z: +fo.gz.toFixed(3) },
          gap: +Math.hypot(fo.gx - q.x, fo.gz - q.z).toFixed(3),
          v: +fo.v.toFixed(3), lat: +fo.lat.toFixed(3), side: fo.side, hang: +fo.hang.toFixed(3),
          spacing: +this._spacing(m, k).toFixed(3),
          rest: { x: +this._rest[k]?.x.toFixed(3), z: +this._rest[k]?.z.toFixed(3) },
          anim: m.sprite?.animation ?? '', speed: +fo.speed.toFixed(3),
          snaps: fo.snaps, catchups: fo.catchups,
        };
      }),
      spacing: SPACING,
      covers: this.coversPlayer,
      stats: { ...this.stats },
    };
  }

  dispose() {
    this._dropNav();
    for (const m of this.members) {
      try { m.dispose(); } catch (err) { console.warn('[Luminati] party: releasing a member failed:', err); }
    }
    this.members = [];
    for (const s of this._sheets.values()) s.dispose?.();
    this._sheets.clear();
    this._hid = new WeakSet();
    this._hidHere = [];
  }
}

/** The four rim points of a member's body (the standable test). */
const RIM = [[BODY, 0], [-BODY, 0], [0, BODY], [0, -BODY]];

/** Hermite step of x between a and b (0 … 1). */
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The signed difference of two angles (rad), in (-π, π]. */
function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * A character sprite's body on screen (NDC: the middle 44 % of its quad's width, the lower 80 % of
 * its height — the frame's padding left out) and its distance from the camera, into `out`; null
 * without a quad. The quad's corners through its world matrix (the last frame's).
 * @param {any} sprite a Sprite3D
 * @param {THREE.Camera} cam
 * @param {{ x0: number, x1: number, y0: number, y1: number, d: number }} out
 */
function spriteRect(sprite, cam, out) {
  const mesh = sprite?.mesh;
  const pos = mesh?.geometry?.attributes?.position;
  if (!pos) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(cam);
    if (_p.x < x0) x0 = _p.x;
    if (_p.x > x1) x1 = _p.x;
    if (_p.y < y0) y0 = _p.y;
    if (_p.y > y1) y1 = _p.y;
  }
  const w = x1 - x0;
  out.x0 = x0 + w * 0.28;
  out.x1 = x1 - w * 0.28;
  out.y0 = y0;
  out.y1 = y0 + (y1 - y0) * 0.8;
  out.d = cam.position.distanceTo(sprite.position);
  return out;
}

/** A sprite direction's world vector ('down' faces +Z). @param {string} dir */
function dirVector(dir) {
  switch (dir) {
    case 'up': return { x: 0, z: -1 };
    case 'left': return { x: -1, z: 0 };
    case 'right': return { x: 1, z: 0 };
    default: return { x: 0, z: 1 };
  }
}

/**
 * Records read from a save or the story (untrusted): each one checked and repaired (an id that is
 * no story name — `isStoryName` — is dropped, and so is a second record of an id; a bad actor
 * becomes none, a bad preset 'villager', a bad colour the default, a bad class the one its weapon
 * makes, a bad rule field the default preset's), at most MAX_PARTY. New objects (the state's are
 * not shared).
 * @param {unknown} list
 * @returns {PartyRecord[]}
 */
export function sanitizeRecords(list) {
  /** @type {PartyRecord[]} */
  const out = [];
  if (!Array.isArray(list)) return out;
  const str = (v, d = '') => (typeof v === 'string' ? v.trim() : d);
  for (const r of list) {
    if (out.length >= MAX_PARTY) break;
    if (!r || typeof r !== 'object') continue;
    const id = str(r.id);
    if (!isStoryName(id) || out.some((o) => o.id === id)) continue;
    const preset = typeof r.preset === 'string' && Object.hasOwn(CHARACTER_PRESETS, r.preset) ? r.preset : 'villager';
    const spec = r.spec && typeof r.spec === 'object' && !Array.isArray(r.spec) ? { ...r.spec } : null;
    const color = typeof r.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(r.color) ? r.color : '#c9a45c';
    const weapon = spec?.weapon ?? CHARACTER_PRESETS[preset]?.weapon ?? null;
    out.push({
      id,
      name: str(r.name) || id,
      actor: isStoryName(str(r.actor)) ? str(r.actor) : '',
      preset,
      spec,
      color,
      cls: isClass(r.cls) ? r.cls : classForWeapon(weapon),
      rule: normalizeRule(r.rule),
      level: str(r.level),
    });
  }
  return out;
}

/**
 * A villager of the level being played by id, actor or name (case-insensitive), or null.
 * @param {Game} g
 * @param {string} who
 * @returns {Npc|null}
 */
export function findVillager(g, who) {
  return g.findVillager(who);
}

/** Exported for the tests: the class and preset tables the party reads. */
export { PARTY_CLASSES, PARTY_PRESETS };
