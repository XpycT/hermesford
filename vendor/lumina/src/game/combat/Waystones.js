import { RNG, hashString } from '../../engine/index.js';
import { WAYSTONE, CHEST_DISCOVER, POTION_MAX } from './rules.js';
import { t } from '../../engine/i18n/I18n.js';
import { term } from '../../engine/i18n/ContentText.js';

/**
 * @import { Interactable } from '../World.js'
 * @import { PropResult } from '../../engine/world/Props.js'
 * @import { CombatSystem } from './CombatSystem.js'
 * @import { LevelObject } from '../../engine/level/types.js'
 */

/**
 * Checkpoints and chests (COMBAT.md §6.12, §13.3).
 *
 * Waystones: walking within 2.0 u attunes one (the checkpoint becomes its stand point 1.2 u south
 * of the stone; toast, SFX `waystone`, `prop.setAttuned(true)`, the previous stone dims). Confirm →
 * **Rest** (refused while engaged): fade out 0.6 s, full HP / MP / SP, draughts ≥ 3, every
 * non-boss enemy group back at home (killed ones too), fade in 0.8 s. The first checkpoint is the
 * level spawn ("the camp", or "the start" when no waystone stands within 12 u of it).
 *
 * Chests: confirm → **Open**: `prop.open()`, SFX `chestOpen`, the contents pop out as pickups,
 * the interactable becomes `disabled` (session-only). A chest's map marker appears once it is
 * discovered — the player within 8 u, or within 12 u with line of sight — or opened.
 *
 * Both are level objects; the World (level package) turns them into interactables carrying
 * `object` and `prop` (the prop's controls). Without those (a level built before the props
 * existed) attunement still works from the object positions.
 *
 * Both come and go with the story (`when` / `unless`, STORY_SCRIPT.md §9.5): the World's story group
 * shows / hides the prop, its collider and its prompt; the combat system marks the record `absent`
 * (`CombatSystem.applyPresence`) — an absent chest is not discovered, opened or on the maps, an
 * absent waystone is not attuned or rested at.
 */

/**
 * A checkpoint: a level waystone, or the level spawn (`id` 'spawn').
 * @typedef {object} Checkpoint
 * @property {string} id            the waystone object's id, or 'spawn'
 * @property {string} name          the English name ('the camp' / 'the start' for the spawn; a
 *   waystone's level name, 'Waystone' without one — an identity, never translated): shown through
 *   `placeName`
 * @property {boolean} [unnamed]    a waystone whose level object has no name (`name` holds the code
 *   default 'Waystone': shown as the UI string `game.default.waystone`, I18N.md §4.8)
 * @property {'camp'|'start'} [place] the spawn's place id (`t('combat.place.<id>')`)
 * @property {number} x             the stone (the spawn point)
 * @property {number} z
 * @property {{ x: number, z: number }} stand  where the player rises (1.2 u south of a stone)
 * @property {Interactable|null} it the World's interactable (`bind`; null: none)
 * @property {PropResult['controls']|null} prop  the waystone prop's controls (`setAttuned`)
 * @property {LevelObject|null} obj  the waystone's level object (null: the spawn point)
 * @property {boolean} absent  the story has taken it away (`setAbsent`)
 */

/**
 * A chest of the level (session state: opened / discovered).
 * @typedef {object} Chest
 * @property {string} id            the chest object's id
 * @property {number} x
 * @property {number} z
 * @property {number} rotation      radians
 * @property {number} gold          gold inside (coins)
 * @property {number} potions       Healing Draughts inside
 * @property {string} upgrade       the upgrade inside: 'maxHp' | 'maxMp' | 'attack' | 'none'
 * @property {boolean} opened       opened this session
 * @property {boolean} discovered   its map marker is shown
 * @property {Interactable|null} it the World's interactable (`bind`; null: none)
 * @property {PropResult['controls']|null} prop  the chest prop's controls (`open`)
 * @property {{ x: number, z: number, kind: string, readonly hidden?: boolean }} marker  its map
 *   marker (`hidden` while the chest is absent: the maps skip it)
 * @property {LevelObject} obj  the chest's level object
 * @property {boolean} absent  the story has taken it away (CombatSystem.applyPresence)
 */

const CHECK_EVERY = 0.25;
const NEAR_SPAWN = 12;
/**
 * A checkpoint's name as the player reads it (docs/specs/I18N.md §4.8: translated at display): the
 * spawn's by its place id ('the camp' / 'the start' in English: the templates add no second
 * article), a waystone's name as a term (`term`), a waystone without a name as the UI string of
 * that default ('Waystone' in English, as before).
 * @param {Checkpoint} cp
 * @returns {string}
 */
export const placeName = (cp) => (cp?.place ? t(`combat.place.${cp.place}`)
  : cp?.unnamed ? t('game.default.waystone') : term(String(cp?.name ?? '')));

export class Waystones {
  /** @param {CombatSystem} sys the CombatSystem */
  constructor(sys) {
    this.sys = sys;
    const level = sys.level;
    /** @type {Checkpoint[]} the level's waystones */
    this.list = level.objects.filter((o) => o.type === 'waystone').map((o) => ({
      id: o.id, name: String(o.name || 'Waystone'), unnamed: !o.name, x: o.x, z: o.z,
      stand: { x: o.x, z: o.z + WAYSTONE.stand }, it: null, prop: null, obj: o, absent: false,
    }));
    const sp = level.spawn ?? { x: level.width / 2, z: level.depth / 2 };
    const near = this.list.some((w) => Math.hypot(w.x - sp.x, w.z - sp.z) <= NEAR_SPAWN);
    /** @type {Checkpoint} the level spawn as the first checkpoint */
    this.spawnPoint = { id: 'spawn', name: near ? 'the camp' : 'the start', place: near ? 'camp' : 'start', x: sp.x, z: sp.z, stand: { x: sp.x, z: sp.z }, it: null, prop: null, obj: null, absent: false };
    /** @type {Checkpoint} the current checkpoint (a waystone record or the spawn point) */
    this.checkpoint = this.spawnPoint;
    this._t = 0;
  }

  /**
   * Adopt the World's interactables: label **Rest**, confirm → rest.
   * @param {Interactable[]} interactables
   */
  bind(interactables) {
    for (const it of interactables) {
      if (it.kind !== 'waystone') continue;
      const w = this.list.find((x) => x.id === (it.object?.id ?? it.id));
      if (!w) continue;
      w.it = it;
      w.prop = it.prop ?? null;
      it.label = 'Rest';
      it.onInteract = () => this.rest(w);
    }
  }

  /**
   * @param {string} id a waystone id or 'spawn'
   * @returns {Checkpoint|null}
   */
  byId(id) {
    return id === 'spawn' ? this.spawnPoint : this.list.find((w) => w.id === id) ?? null;
  }

  /**
   * Attune checks (every 0.25 s).
   * @param {number} dt
   */
  update(dt) {
    this._t -= dt;
    if (this._t > 0) return;
    this._t = CHECK_EVERY;
    const sys = this.sys;
    if (!sys.pc.alive) return;
    const p = sys.player.position;
    for (const w of this.list) {
      if (w === this.checkpoint || w.absent) continue;
      if (Math.hypot(w.x - p.x, w.z - p.z) <= WAYSTONE.attune && Math.abs(sys.groundAt(w.x, w.z) - p.y) < 1.3) {
        this.attune(w);
        break;
      }
    }
  }

  /**
   * Make `w` the checkpoint.
   * @param {Checkpoint} w a waystone record (or the spawn point)
   * @param {{ silent?: boolean }} [opts]
   */
  attune(w, { silent = false } = {}) {
    if (!w || w === this.checkpoint || w.absent) return;
    const prev = this.checkpoint;
    this.checkpoint = w;
    prev.prop?.setAttuned?.(false);
    w.prop?.setAttuned?.(true);
    if (!silent && w !== this.spawnPoint) {
      const sys = this.sys;
      sys.ui.hud.toast(t('combat.waystone.attuned', { place: placeName(w) }), 2.2);
      sys.sfxAt('waystone', w.x, w.z, { volume: 0.9 });
      sys.events.emit('attuned', w.id);
    }
  }

  /**
   * Rest at a waystone (confirm → Rest). Refused while engaged. With `instant` (the hook) there
   * is no fade.
   * @param {Checkpoint} w
   * @param {{ instant?: boolean }} [opts]
   * @returns {Promise<boolean>} false: refused (engaged, or the stone is absent)
   */
  async rest(w, { instant = false } = {}) {
    const sys = this.sys;
    const ui = sys.ui;
    if (w.absent) return false;
    if (sys.engaged) {
      ui.hud.toast(t('combat.waystone.silent'), 2.4);
      sys.audio.playSfx('cancel', { volume: 0.5 });
      return false;
    }
    this.attune(w);
    if (!instant) await ui.fader.fadeOut(0.6);
    // (the story took the stone away during the fade: no rest)
    if (w.absent) {
      if (!instant) await ui.fader.fadeIn(0.4);
      return false;
    }
    sys.restAll();
    if (!instant) {
      sys.sfxAt('waystone', w.x, w.z, { volume: 0.8 });
      await ui.fader.fadeIn(0.8);
    }
    ui.hud.toast(t('combat.waystone.rested', { place: placeName(w) }), 2.2);
    return true;
  }

  /**
   * The story took waystone `w` away or brought it back (CombatSystem.applyPresence): an absent
   * stone is not attuned or rested at, and the checkpoint it held falls back to the level's start
   * (silently, its crystal dimmed); back, it is attuned again by walking up to it.
   * @param {Checkpoint} w
   * @param {boolean} absent
   */
  setAbsent(w, absent) {
    if (w.absent === absent) return;
    w.absent = absent;
    if (absent && this.checkpoint === w) {
      w.prop?.setAttuned?.(false);
      this.checkpoint = this.spawnPoint;
    }
  }

  /** Every attuned crystal dimmed except the checkpoint's (reset). */
  reset() {
    for (const w of this.list) w.prop?.setAttuned?.(false);
    this.checkpoint = this.spawnPoint;
    this._t = 0;
  }
}

export class Chests {
  /** @param {CombatSystem} sys the CombatSystem */
  constructor(sys) {
    this.sys = sys;
    /** @type {Chest[]} the level's chests */
    this.list = sys.level.objects.filter((o) => o.type === 'chest').map((o) => {
      /** @type {Chest} */
      const c = {
        id: o.id, x: o.x, z: o.z, rotation: Number(o.rotation) || 0,
        gold: Math.max(0, Math.round(Number(o.gold) || 0)), potions: Math.max(0, Math.round(Number(o.potions) || 0)),
        upgrade: ['maxHp', 'maxMp', 'attack'].includes(o.upgrade) ? o.upgrade : 'none',
        opened: false, discovered: false, it: null, prop: null, marker: { x: o.x, z: o.z, kind: 'chest' }, obj: o, absent: false,
      };
      // (the maps skip a hidden marker: an absent chest leaves them without a repaint)
      Object.defineProperty(c.marker, 'hidden', { get: () => c.absent, enumerable: true });
      return c;
    });
    /**
     * The map state's marker list (set by attachMaps).
     * @type {{ x: number, z: number, kind: string }[]|null}
     */
    this.markers = null;
    this._t = 0;
  }

  /**
   * Adopt the World's interactables: label **Open**, confirm → open.
   * @param {Interactable[]} interactables
   */
  bind(interactables) {
    for (const it of interactables) {
      if (it.kind !== 'chest') continue;
      const c = this.list.find((x) => x.id === (it.object?.id ?? it.id));
      if (!c) continue;
      c.it = it;
      c.prop = it.prop ?? null;
      it.label = 'Open';
      it.onInteract = () => this.open(c);
      if (c.opened) it.disabled = true;
    }
  }

  /**
   * Discovery checks (every 0.25 s).
   * @param {number} dt
   */
  update(dt) {
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.25;
    const sys = this.sys;
    const p = sys.player.position;
    for (const c of this.list) {
      if (c.discovered || c.absent) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d <= CHEST_DISCOVER.near || (d <= CHEST_DISCOVER.los && sys.los(p.x, p.z, c.x, c.z))) this.discover(c);
    }
  }

  /**
   * Show the chest's map marker (and emit `chestFound`) once.
   * @param {Chest} c
   */
  discover(c) {
    if (c.discovered) return;
    c.discovered = true;
    if (this.markers && !this.markers.includes(c.marker)) this.markers.push(c.marker);
    this.sys.events.emit('chestFound', c.id);
  }

  /**
   * Open a chest: lid, sound, contents as pickups.
   * @param {Chest} c
   * @returns {boolean} false: already open
   */
  open(c) {
    if (!c || c.opened || c.absent) return false;
    const sys = this.sys;
    c.opened = true;
    if (c.it) c.it.disabled = true;
    this.discover(c);
    c.prop?.open?.();
    sys.sfxAt('chestOpen', c.x, c.z, { volume: 1 });
    const rng = new RNG((hashString(`chest:${c.id}`) ^ sys.seedValue) >>> 0);
    const y = sys.groundAt(c.x, c.z);
    sys.dropGold(c.gold, c.x, y + 0.3, c.z, rng);
    for (let i = 0; i < Math.min(POTION_MAX, c.potions); i++) sys.pickups.drop('draught', 1, c.x, y + 0.3, c.z, rng);
    if (c.upgrade !== 'none') sys.pickups.drop('upgrade', 1, c.x, y + 0.3, c.z, rng, c.upgrade);
    sys.burst('sparkle', c.x, y + 0.7, c.z, 12);
    return true;
  }
}
