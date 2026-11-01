/**
 * CombatMusic — which track plays on a combat level (COMBAT.md §12.2): engaged ≥ 0.8 s → `battle`
 * (fade 1.2 s); calm for 4 s → the level track `emberfall` (fade 2.0 s); the boss fight → `boss`
 * (section B from phase 2); victory → the `victory` stinger alone (the boss track, in C phrygian,
 * fades out under the D major fanfare instead of ducking), then `emberfall` once the stinger's
 * last chord has sounded. The player's death fades the music out (1.5 s) and the respawn brings
 * the level track back.
 *
 * Nothing starts while the music is off (M, `environment.music === false`, or not yet unlocked):
 * `musicTrack` still says what combat wants, and `Game.setMusic(true)` starts that track.
 *
 * The three parts — the level track, the fight, the boss — are roles (`track`); the names played
 * are the level's (`environment.soundtrack`, LevelLook.js `soundtrackOf`; DRAGON_CAMPAIGN.md §5.2):
 * without one, `emberfall` / `battle` / `boss` as before. A track with sections for the roles
 * (AudioSystem `MUSIC_ROLE_SECTIONS`: Vanquish's 'siege', 'ascent', 'dragon') plays each role in its
 * section: the level track and a fight on one track ('siege' A / B) move between sections at the
 * next bar instead of crossfading, and the boss fight's phases 1 / 2 / 3 take the boss track's
 * phase sections (`setPhase`: 'dragon' A / B / C). Tracks without them keep the behaviour above.
 *
 * The Bells of Evermere (EVERMERE_CAMPAIGN.md §6.8, §7.4): the environment is read as it stands —
 * `env` may be a getter (`game.envNow`: a level's `states` change its soundtrack with the story), and
 * a role whose track name changes is asked for again (a crossfade). Its role sections are this
 * module's own table (`EV_ROLE_SECTIONS`, the combat chunk's): the fight (`hushfight`) plays the
 * section named after the level's exploring track (`regional`: 'waking' on the Blossomwood …), the
 * guardians' and the King's phases A / B / C, and their fall is a release, not a victory
 * (`release`): no fanfare — the boss track fades and the level's own track comes back (a region's in
 * its frozen section until the toll: EvermereAudio.js). A region's exploring track takes no section
 * from here: its pack starts it frozen or in its season and moves it at the thaw.
 */
import { MUSIC_ROLE_SECTIONS } from '../../engine/audio/AudioSystem.js';
import { ownValue } from '../../engine/utils/own.js';
import { soundtrackOf } from '../LevelLook.js';

/**
 * @import { AudioSystem } from '../../engine/audio/AudioSystem.js'
 * @import { LevelEnvironment } from '../../engine/level/types.js'
 */

const ENGAGE_DELAY = 0.8;
const CALM_DELAY = 4;
const FADE = { battle: 1.2, emberfall: 2.0, boss: 1.5 };
/** A release's fade: the boss track out, the level's own back. */
const RELEASE_FADE = 4;
/**
 * The victory stinger's length: 4 bars at its own 108 bpm plus the held last chord — 18 beats,
 * 10 s (AudioSystem `buildStinger('victory')`). The level track starts after it.
 */
export const VICTORY_STINGER = (18 * 60) / 108;

/**
 * The Bells of Evermere's role sections (as AudioSystem's `MUSIC_ROLE_SECTIONS`): `regional` — the
 * fight's section is the level's exploring track's name; `phases` the boss fight's; `release` — the
 * boss's fall ends its music without the stinger.
 * @type {Readonly<Record<string, Readonly<{ explore?: string, battle?: string, phases?: readonly string[], regional?: boolean, release?: boolean }>>>}
 */
export const EV_ROLE_SECTIONS = Object.freeze({
  hushfight: Object.freeze({ regional: true }),
  guardian: Object.freeze({ battle: 'A', phases: Object.freeze(['A', 'B', 'C']), release: true }),
  hushedking: Object.freeze({ battle: 'A', phases: Object.freeze(['A', 'B', 'C']), release: true }),
});

/**
 * A track's role sections: Vanquish's (AudioSystem) or Evermere's (here).
 * @param {string} track
 * @returns {{ explore?: string, battle?: string, phases?: readonly string[], regional?: boolean, release?: boolean }|undefined}
 */
const rolesOf = (track) => ownValue(MUSIC_ROLE_SECTIONS, track) ?? ownValue(EV_ROLE_SECTIONS, track);

export class CombatMusic {
  /**
   * @param {AudioSystem} audio
   * @param {Partial<LevelEnvironment>|(() => Partial<LevelEnvironment>)} env the level environment
   *   (`music === false`: never start a track), or a getter of it as it stands (Game `envNow`)
   */
  constructor(audio, env) {
    this.audio = audio;
    /** @type {() => Partial<LevelEnvironment>} */
    this._env = typeof env === 'function' ? env : () => env;
    this.enabled = this._env()?.music !== false;
    /** @type {any} the environment the track names were read from (`tracks`) */
    this._tracksOf = null;
    /** @type {Readonly<Record<'emberfall'|'battle'|'boss', string>>} */
    this._tracks = null;
    this.reset();
  }

  /**
   * The track name each role plays on this level (`soundtrackOf`: the level's, else the game's) —
   * read from the environment as it stands (an object made again only when it changes).
   * @returns {Readonly<Record<'emberfall'|'battle'|'boss', string>>}
   */
  get tracks() {
    const env = this._env();
    if (env !== this._tracksOf || !this._tracks) {
      this._tracksOf = env;
      this._tracks = Object.freeze({ emberfall: soundtrackOf(env, 'explore'), battle: soundtrackOf(env, 'battle'), boss: soundtrackOf(env, 'boss') });
    }
    return this._tracks;
  }

  /** The track combat wants now: the name of its role's track on this level (`tracks[track]`). */
  get musicTrack() { return this.tracks[this.track]; }

  reset() {
    /** @type {'emberfall'|'battle'|'boss'} the role playing (the level track, a fight, the boss) */
    this.track = 'emberfall';
    this._engaged = 0;
    this._calm = CALM_DELAY;
    this._victory = -1;
    /** @type {string|null} the role last asked of the AudioSystem (null: ask again) */
    this._requested = null;
    /** @type {string|null} the track name it was asked for */
    this._requestedName = null;
    this._silenced = false;
    this._wasPlaying = false;
    /** @type {string} the boss track's section ('A' | 'B'; 'C' on a track with three phases) */
    this._section = 'A';
  }

  /**
   * @param {number} dt real seconds (combat active)
   * @param {boolean} engaged
   * @param {boolean} bossFight the boss fight runs (roar to defeat / reset)
   */
  update(dt, engaged, bossFight) {
    if (this._victory >= 0) {
      this._victory -= dt;
      if (this._victory < 0) this.track = 'emberfall';
    } else if (bossFight) {
      this.track = 'boss';
      this._engaged = ENGAGE_DELAY;
      this._calm = 0;
    } else if (engaged) {
      this._engaged += dt;
      this._calm = 0;
      if (this._engaged >= ENGAGE_DELAY - 1e-6) this.track = 'battle';
    } else {
      this._calm += dt;
      this._engaged = 0;
      if (this._calm >= CALM_DELAY - 1e-6) this.track = 'emberfall';
    }
    this._apply();
  }

  /**
   * The section a role plays on its track, or null (the track's own order): on a track with role
   * sections (`MUSIC_ROLE_SECTIONS`, `EV_ROLE_SECTIONS`) its `explore` / `battle` section — a
   * `regional` fight's, the level's exploring track's name —, the boss's current one; on the others
   * only the boss track's B from phase 2.
   * @param {'emberfall'|'battle'|'boss'} role
   * @returns {string|null}
   */
  _roleSection(role) {
    const s = rolesOf(this.tracks[role]);
    if (role === 'boss') return s || this._section !== 'A' ? this._section : null;
    if (!s) return null;
    if (role === 'battle') return s.regional ? this.tracks.emberfall : s.battle ?? null;
    return s.explore ?? null;
  }

  _apply() {
    const audio = this.audio;
    if (!this.enabled || this._silenced || !audio.musicPlaying) {
      this._requested = null;
      return;
    }
    // (a request is made once per change — of the role, or of its track's name: a level's states
    // changed the soundtrack — so a track that does not start, still loading, is not asked for again
    // every frame)
    const name = this.tracks[this.track];
    if (this.track === this._requested && name === this._requestedName) return;
    this._requested = this.track;
    this._requestedName = name;
    const section = this._roleSection(this.track);
    if (audio.musicTrack !== name) audio.startMusic({ track: name, fade: FADE[this.track] ?? 1.5, ...(section ? { section } : {}) });
    else if (section) audio.setMusicSection?.(section);
  }

  /**
   * The boss track's section (switches at the next bar while the boss fight plays): 'B' from
   * phase 2, 'A' back at a reset (the CombatSystem's boss phases; `setPhase` maps a phase to it).
   * @param {string} name
   */
  setSection(name) {
    this._section = name;
    if (this.track === 'boss' && this.audio.musicPlaying) this.audio.setMusicSection?.(name);
  }

  /**
   * The boss fight reached phase `n` (1, 2, 3 …): its section on the boss track — the track's
   * `phases` (MUSIC_ROLE_SECTIONS: 'dragon' A / B / C; EV_ROLE_SECTIONS: the guardians', the King's;
   * the last holds for later phases), on the others 'B' from phase 2 (as `setSection('B')`).
   * @param {number} n
   */
  setPhase(n) {
    const phase = Math.max(1, Math.floor(Number(n)) || 1);
    const p = rolesOf(this.tracks.boss)?.phases;
    this.setSection(p ? p[Math.min(p.length, phase) - 1] : phase >= 2 ? 'B' : 'A');
  }

  /**
   * The boss fell: the stinger (the boss track fades out under it), then the level track — or, on a
   * boss track that ends in a release (`EV_ROLE_SECTIONS`), no stinger: the level's own track comes
   * back over 4 s as the boss track fades.
   */
  victory() {
    this._section = 'A';
    if (rolesOf(this.tracks.boss)?.release) {
      this._victory = -1;
      this.track = 'emberfall';
      this._requested = 'emberfall';
      this._requestedName = this.tracks.emberfall;
      if (this.enabled && this.audio.musicPlaying) this.audio.startMusic({ track: this.tracks.emberfall, fade: RELEASE_FADE });
      return;
    }
    if (this.enabled && this.audio.musicPlaying) this.audio.playStinger?.('victory', { duck: 0 });
    this._victory = VICTORY_STINGER;
  }

  /** The player fell: fade the music out (1.5 s). */
  death() {
    this._wasPlaying = this.audio.musicPlaying;
    this._silenced = true;
    if (this._wasPlaying) this.audio.stopMusic({ fade: 1.5 });
  }

  /** Respawned: the level track again (if the music was playing). */
  respawn() {
    this._silenced = false;
    this.track = 'emberfall';
    this._engaged = 0;
    this._calm = CALM_DELAY;
    this._section = 'A';
    this._requested = null;
    if (this._wasPlaying && this.enabled) {
      this.audio.startMusic({ track: this.tracks.emberfall, fade: 2.0 });
      this._requested = 'emberfall';
      this._requestedName = this.tracks.emberfall;
      const section = this._roleSection('emberfall');
      if (section) this.audio.setMusicSection?.(section);
    }
    this._wasPlaying = false;
  }
}
