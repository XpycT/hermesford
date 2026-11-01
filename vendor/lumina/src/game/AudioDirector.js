import { clamp, smoothstep } from '../engine/utils/math.js';
import { ownValue } from '../engine/utils/own.js';

/**
 * @import { AudioSystem } from '../engine/audio/AudioSystem.js'
 * @import { LightingSystem } from '../engine/lighting/LightingSystem.js'
 * @import { TileMap } from '../engine/world/TileMap.js'
 * @import { Weather } from './Weather.js'
 */

/**
 * A big fire for the `blaze` ambience (DRAGON_CAMPAIGN.md §6.9): where it burns, how loud it roars
 * (`roar`: 1 a blaze of size 1.5; a burning house up to 2.2) and how much it crackles close by
 * (`crackle` 0..1: the `fire` layer's crackle), and the live story group it belongs to (absent:
 * silent) — `blazeOf`.
 * @typedef {{ x: number, z: number, roar: number, crackle: number, group: { present: boolean }|null }} Blaze
 */
/**
 * A villager as the crowd ambience reads it (src/game/Npc.js): `panicking` — running in panic now
 * (the `panic` behaviour, there, not talking, not held by a script, not calmed by the victory);
 * `cowering` — the `cower` behaviour, there, not held, not calmed (the siege package's getters).
 * @typedef {{ position: { x: number, z: number }, present: boolean, directed: boolean, behaviour: string,
 *   panicking: boolean, cowering: boolean }} CrowdMember
 */

/** `fire` kinds: [roar per unit of `opts.size` / 1.5, crackle] (a brazier and embers only crackle). */
const FIRE_SOUND = { blaze: [1, 1], bonfire: [0.85, 1], brazier: [0, 0.6], embers: [0, 0.35] };
/** How loud a cowering villager is in the crowd (whimpers) against a panicking one (cries). */
const COWER_VOICE = 0.45;

/**
 * The `blaze` a level object makes, or null: a `fire` object (by `opts.kind` and `opts.size`) or a
 * house with `opts.burning` > 0 (DRAGON_CAMPAIGN.md §5.3). For World's list of big fires (the
 * AudioDirector's `blazes`); level data is untrusted — kinds looked up as own keys, numbers clamped.
 * @param {{ type: string, x?: number, z?: number, opts?: any }} obj (a point object: line and rect objects make none)
 * @param {{ present: boolean }|null} [group] the object's live story group
 * @returns {Blaze|null}
 */
export function blazeOf(obj, group = null) {
  const o = obj.opts && typeof obj.opts === 'object' ? obj.opts : {};
  const x = Number(obj.x);
  const z = Number(obj.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (obj.type === 'fire') {
    const [roar, crackle] = ownValue(FIRE_SOUND, typeof o.kind === 'string' ? o.kind : 'blaze') ?? FIRE_SOUND.blaze;
    const size = clamp(Number.isFinite(Number(o.size)) ? Number(o.size) : 1.5, 0.2, 6);
    return { x, z, roar: roar * clamp(size / 1.5, 0.3, 3), crackle, group };
  }
  if (obj.type === 'house') {
    const burning = clamp(Number(o.burning) || 0, 0, 1);
    return burning > 0 ? { x, z, roar: 2.2 * burning, crackle: burning, group } : null;
  }
  return null;
}

/**
 * Drives the procedural ambience from the world state a few times per second:
 * wind + birds by day, crickets at night, the crackle of the nearest campfire by distance, the
 * river and the waterfalls by distance to the nearest water, all scaled by the weather; on combat
 * levels `combatIntensity` hushes the birds during a fight. Vanquish the Evil Dragon's
 * (DRAGON_CAMPAIGN.md §6.9): `crowd` from the panicking (and cowering) villagers near the camera,
 * `blaze` from the big fires and burning houses near it (they also crackle) — measured from the
 * camera's focus, so a cutscene's shot hears what it shows. A level without either gets 0 for both
 * and creates nothing. The Bells of Evermere's (EVERMERE_CAMPAIGN.md §6.8): on a level with a `frost`
 * or a `season` (`env`: the game's `envNow`) its audio pack directs the frozen year after this mix —
 * the howl, the ice's bed, the thaw's melt, the season's beds, the iced water, the frozen sections of
 * its music (EvermereAudio.js `direct`; the pack is fetched on such a level only).
 */
export class AudioDirector {
  /**
   * @param {{ audio: AudioSystem, lighting: LightingSystem, weather: Weather, tileMap: TileMap,
   *           fires?: {x:number, z:number}[], falls?: {x:number, z:number}[], blazes?: Blaze[],
   *           npcs?: CrowdMember[], focus?: {x:number, y:number, z:number}|null, env?: (() => any)|null }} ctx
   *   fires: campfire positions; falls: foot of every roaring waterfall (both may be empty);
   *   blazes: the big fires (World's list, `blazeOf`), npcs: the villagers, focus: the camera's
   *   focus point (live; the listener when absent) — the last three for the crowd / blaze layers;
   *   env: the level's environment as it stands (Game `envNow`; absent: none of Evermere's)
   */
  constructor({ audio, lighting, weather, tileMap, fires = [], falls = [], blazes = [], npcs = [], focus = null, env = null }) {
    this.audio = audio;
    this.lighting = lighting;
    this.weather = weather;
    this.fires = fires;
    this.falls = falls;
    this.blazes = blazes;
    this.npcs = npcs;
    this.focus = focus;
    /** @type {(() => any)|null} the environment as it stands (Evermere's `frost` and `season`) */
    this.env = env;
    this.enabled = false;
    this._timer = 0;
    // water sample points: the centre of every water tile (river, pool, pond, stream), packed
    // x0, z0, x1, z1 … (compute() runs a few times a second over up to thousands of them: no garbage)
    const pts = [];
    tileMap.forEachTile((i, j, t) => { if (t.water) pts.push(i + 0.5, j + 0.5); });
    this.waterXZ = Float32Array.from(pts);
    this.levels = { wind: 0, birds: 0, crickets: 0, fire: 0, water: 0, crowd: 0, blaze: 0 };
    /**
     * 0..1: how much a fight is going on (COMBAT.md §12.2). Birds are scaled by (1 − 0.8·i) so
     * they fall silent while the player is engaged; combat sets 1 while engaged and eases it back
     * over 3 s. The default 0 leaves the mix unchanged (peaceful levels never touch it).
     */
    this.combatIntensity = 0;
  }

  /** Distance from the listener to the nearest point (Infinity when there is none). */
  static nearest(points, listener) {
    let best = Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const d = (p.x - listener.x) ** 2 + (p.z - listener.z) ** 2;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /** Current mix, recomputed immediately (also used by state()). */
  compute(listener) {
    const night = this.lighting.nightFactor;
    const rain = this.weather.factor('rain');
    const snow = this.weather.factor('snow');
    const storm = clamp(rain + snow);
    const dFire = AudioDirector.nearest(this.fires, listener);
    let dWater = Infinity;
    const w = this.waterXZ;
    const lx = listener.x;
    const lz = listener.z;
    for (let k = 0; k < w.length; k += 2) {
      const dx = w[k] - lx;
      const dz = w[k + 1] - lz;
      const d = dx * dx + dz * dz;
      if (d < dWater) dWater = d;
    }
    dWater = Math.sqrt(dWater);
    const dFall = AudioDirector.nearest(this.falls, listener);
    const L = this.levels;
    L.wind = clamp(0.28 + 0.12 * (listener.y > 3 ? 1 : 0) + storm * 0.55);
    L.birds = clamp((1 - night) * (1 - storm * 0.85) * 0.75);
    if (this.combatIntensity > 0) L.birds *= 1 - 0.8 * clamp(this.combatIntensity);
    L.crickets = clamp(smoothstep(0.35, 0.9, night) * (1 - storm) * 0.8);
    L.fire = clamp((1 - smoothstep(2, 15, dFire)) ** 1.5 * 0.9);
    L.water = clamp(Math.max((1 - smoothstep(1, 11, dWater)) * 0.55, (1 - smoothstep(3, 20, dFall)) * 0.95));
    this._computeSiege(this.focus ?? listener);
    // (The Bells of Evermere: its pack directs the frozen year once it is here)
    const env = this.env?.();
    if (env?.frost || env?.season) this.audio.evPack?.direct(this, listener, L);
    return L;
  }

  /**
   * The crowd and the blaze, from the camera's focus `f`: each panicking villager (`panicking`)
   * adds a voice that fades out by 34 u — a cowering one (present, not held by a script) less —,
   * and the level saturates (≈ 0.6 at 3 near voices, 0.9 at 8); the big fires' roars add up
   * likewise (a burning street roars louder than one house) and fade by 30 u, and the nearest fire
   * within 12 u crackles (the `fire` layer).
   * @param {{x: number, z: number}} f
   */
  _computeSiege(f) {
    const L = this.levels;
    let voices = 0;
    for (const n of this.npcs) {
      const k = n.panicking ? 1 : n.cowering ? COWER_VOICE : 0;
      if (!k) continue;
      const d = Math.hypot(n.position.x - f.x, n.position.z - f.z);
      voices += k * (1 - smoothstep(4, 34, d));
    }
    L.crowd = voices > 0 ? clamp(1 - Math.exp(-voices / 3.4)) : 0;
    let roar = 0;
    let crackle = 0;
    for (const b of this.blazes) {
      if (b.group && !b.group.present) continue;
      const d = Math.hypot(b.x - f.x, b.z - f.z);
      if (b.roar > 0) roar += b.roar * (1 - smoothstep(3, 30, d)) ** 1.6;
      if (b.crackle > 0) crackle = Math.max(crackle, b.crackle * (1 - smoothstep(1.5, 12, d)) ** 1.5);
    }
    L.blaze = roar > 0 ? clamp(1 - Math.exp(-roar * 0.9)) * 0.95 : 0;
    if (crackle * 0.9 > L.fire) L.fire = crackle * 0.9;
  }

  update(dt, listener) {
    if (!this.enabled) return;
    this._timer -= dt;
    if (this._timer > 0) return;
    this._timer = 0.25;
    this.audio.setAmbience(this.compute(listener), { fade: 0.6 });
  }
}
