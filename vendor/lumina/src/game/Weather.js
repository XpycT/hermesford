import { clamp, smoothstep, damp } from '../engine/utils/math.js';
import { snowCover } from './SnowCover.js';
import {
  WEATHERS, WEATHER_PARAMS, WEATHER_KEYS, precipitationEmitter, precipitationIntensity, settledSnowCover,
  applyWeatherLighting, applyWeatherWind, applyWeatherGrade, applyOvercast, applyLampDayGlow, applyEmissiveDay,
  glassLevel, areaEmitterIntensity, NIGHT_DESATURATION, godRayHourLevel, nightWaterLevels,
} from './WeatherLook.js';
import { isInterior, shownWeather } from './LevelLook.js';

/**
 * @import { GodRays } from '../engine/fx/GodRays.js'
 * @import { Particles } from '../engine/fx/Particles.js'
 * @import { LightingSystem } from '../engine/lighting/LightingSystem.js'
 * @import { PostFX } from '../engine/render/PostFX.js'
 * @import { World } from './World.js'
 * @import { WeatherState } from './WeatherLook.js'
 */

export { WEATHERS };

/**
 * Time-of-day presets cycled by T (hours): `id` is the phase id of the hour (HUD.js `timePhase`) —
 * the toast shows the clock's name of it (HUD.js `phaseName`: `hud.phase.<id>`, docs/specs/I18N.md
 * §2) — and `name` its English name.
 */
export const TIME_PRESETS = [
  { h: 6.5, id: 'dawn', name: 'Dawn' },
  { h: 12.5, id: 'midday', name: 'Midday' },
  { h: 17.2, id: 'golden', name: 'Golden Hour' },
  { h: 18.9, id: 'dusk', name: 'Dusk' },
  { h: 22.5, id: 'night', name: 'Night' },
];

/**
 * Sky & weather director: smooth time-of-day transitions between presets (T), weather cycling
 * (R: clear → rain → snow → clear) with blended lighting / fog / wind / grade / particles, and the
 * "tuning" base values the debug panel edits (the weather multiplies on top of them, so the two
 * never fight).
 *
 * In a room (`environment.interior`, LevelLook.isInterior) no weather shows: `weather` — what R
 * cycles, `setWeather` sets, a campaign saves and carries to the next level — goes on, but the
 * look blends toward clear skies (`shown`: no rain or snow, no snow cover, no overcast grey), and
 * comes back outdoors.
 */
export class Weather {
  /**
   * @param {{ lighting: LightingSystem, particles: Particles, postfx: PostFX, godRays: GodRays,
   *           world: World }} ctx
   */
  constructor({ lighting, particles, postfx, godRays, world }) {
    this.lighting = lighting;
    this.particles = particles;
    this.postfx = postfx;
    this.godRays = godRays;
    /** Debug-tunable base values. */
    this.tuning = {
      sunMul: 1, ambientMul: 1, fogMul: 2.0, exposureMul: 1, pointLightMul: 1,
      windStrength: 1, godRays: 1, dust: 1, fireflies: 1, leaves: 1, petals: 1, smoke: 1, mist: 1,
      gradeTemperature: postfx.settings.grade.temperature, gradeSaturation: postfx.settings.grade.saturation,
    };
    /**
     * Fog multiplier from the camera zoom (set by the game every frame): the fog start is fixed
     * (AtmosphereFog), so a zoomed-out camera would otherwise put the whole focus band deep in the
     * haze.
     */
    this.zoomFog = 1;
    /**
     * A gust on top of the weather's wind (0 = none; 1 doubles the strength): a spell's storm
     * (the ice mage's Blizzard, src/game/party/IceSpellFx.js) bends the grass, the trees and the flames harder for a while. Set
     * the target; `update` eases toward it (in over ≈ 0.3 s, out over ≈ 1 s), lets it pulse a
     * little and swings the wind's direction a few degrees to and fro (a swirl; the wind's speed,
     * which sets the grass waves' pace, stays). 0 = exactly the weather's wind. A new world
     * (`setWorld`) ends it.
     */
    this.gust = 0;
    /** The gust as applied (eased toward `gust`). */
    this._gust = 0;
    /** The level is a room (`environment.interior`): the weather is not shown (`shown`). */
    this.indoors = false;
    /**
     * A frozen level's frost (EVERMERE_CAMPAIGN.md §5.2, §6.1; the thaw package sets these at
     * every arrival and story change — src/game/thaw/LevelStates.js): `frostCover` its snow cover
     * (`frost.cover`; 0 on a level without one — the weather's snow settles as ever), `snowHold`
     * that cover while the level is held frozen (and while a thaw front runs), null once released,
     * `frostAmount` how frozen the level is as a whole (1 … 0: held at 1; released, it melts over
     * ≈ 8 s unless a front thawed it). The frost's snow is the thaw patch's (it lies under the front
     * and the patches); the weather's own snow (`snow`) still settles on top — `frost` weather
     * settles none on such a level.
     * @type {number|null}
     */
    this.snowHold = null;
    this.frostCover = 0;
    this.frostAmount = 0;
    /**
     * The snow the level keeps whatever the weather (0–1): a holding state's `cover` — a thawed
     * level's soft snow (the Bell Court's ≈ 0.35 at dawn; src/game/thaw/LevelStates.js); 0 without.
     */
    this.snowFloor = 0;
    /**
     * The frozen year's per-frame work (the rings, the front, the uniforms: src/game/thaw/
     * LevelStates.js), run at the end of `update`; null on a page that never had a frost.
     * @type {{ update: (dt: number) => void }|null}
     */
    this.thaw = null;
    /**
     * Mist emitters of frozen waterfalls (`frost.falls`): no mist while frozen (the thaw kit adds
     * and removes them).
     * @type {Set<object>}
     */
    this.frozenMist = new Set();
    this.setWorld(world);
    snowCover.value = 0;
    this.weather = 'clear';
    /** @type {WeatherState} the blended state (eased toward the target) */
    this._w = { ...WEATHER_PARAMS.clear };
    this._transition = null;
    // precipitation emitters exist from the start (shaders compile at load), faded by intensity
    // (WeatherLook: boxes sized for the gameplay camera's view volume at distance ~30)
    this.rain = particles.createEmitter(precipitationEmitter('rain', { intensity: 0 }));
    this.snow = particles.createEmitter(precipitationEmitter('snow', { intensity: 0 }));
  }

  /**
   * The world this weather drives: its dust and particle areas, lanterns and windows, water and
   * the level's fog scale. The constructor's, and a campaign's next level after a travel.
   * @param {World} world
   */
  setWorld(world) {
    this.world = world;
    this.gust = this._gust = 0;
    // (the frozen falls' mist is told again at the next level's arrival: the thaw kit)
    this.frozenMist?.clear();
    /** @type {Partial<import('../engine/level/types.js').LevelEnvironment>} */
    this._env = world?.level?.environment ?? {};
    this.indoors = isInterior(this._env);
    /**
     * The level's own fog multiplier (`environment.fogScale`, default 1): a big level whose views
     * reach far can thin the haze (dawn and dusk otherwise dissolve its far layers into the horizon
     * colour).
     */
    const fogScale = Number(world?.level?.environment?.fogScale);
    this.levelFog = Number.isFinite(fogScale) && fogScale > 0 ? fogScale : 1;
    const water = world.water;
    // (read once per world: a world set aside and attached again has the scaled values in its
    // uniforms — World.waterBase keeps the ones it was built with)
    this._waterBase = water ? (world.waterBase ??= { brightness: water.uniforms.uBrightness.value, glint: water.uniforms.uGlint.value }) : null;
  }

  /**
   * The weather the level shows: `weather`, or 'clear' in a room (LevelLook.shownWeather — the
   * weather itself goes on outside).
   */
  get shown() {
    return shownWeather(this._env, this.weather);
  }

  get time() { return this.lighting.timeOfDay; }
  /**
   * Settled snow on the ground, 0..1 (builds up while it snows; settable for tests / the panel):
   * the weather's, or a frozen level's frost (`frostCover` × `frostAmount`) where that is more —
   * set on such a level, it sets how frozen the level is.
   */
  get snowCover() { return Math.max(snowCover.value, this.frostCover * this.frostAmount); }
  set snowCover(v) {
    v = clamp(Number(v) || 0);
    if (this.frostCover > 0) this.frostAmount = clamp(v / this.frostCover);
    else snowCover.value = v;
  }
  get transitioning() { return !!this._transition; }

  /** Jump (or glide over `duration` seconds, always forward in time) to an hour. */
  setTime(hours, { duration = 0 } = {}) {
    hours = Number(hours);
    if (!Number.isFinite(hours)) return; // never poison the clock (NaN would stick through every glide)
    const to = ((hours % 24) + 24) % 24;
    if (duration <= 0) {
      this._transition = null;
      this.lighting.setTime(to);
      return;
    }
    const from = this.lighting.timeOfDay;
    let delta = to - from;
    if (delta < 0) delta += 24;
    this._transition = { from, delta, t: 0, duration };
  }

  /** Advance to the next time preset with a ~2 s glide. Returns the preset. */
  cycleTime() {
    const now = this._transition ? (this._transition.from + this._transition.delta) % 24 : this.lighting.timeOfDay;
    let next = TIME_PRESETS.find((p) => p.h > now + 0.05);
    if (!next) next = TIME_PRESETS[0];
    this.setTime(next.h, { duration: 2.0 });
    return next;
  }

  /**
   * Change the weather (blends over a few seconds). `instant` jumps straight to it — lighting,
   * particles and the settled snow — e.g. for a level that starts in the rain. In a room the
   * weather changes but shows clear skies (`shown`); `instant` jumps to those.
   */
  setWeather(name, { instant = false } = {}) {
    if (!Object.hasOwn(WEATHER_PARAMS, name)) return this.weather;
    this.weather = name;
    if (instant) {
      const shown = this.shown;
      Object.assign(this._w, WEATHER_PARAMS[shown]);
      snowCover.value = this._settled(shown);
    }
    return name;
  }

  /**
   * The weather's own settled snow (a level with a frost: only falling snow settles), never under
   * the level's `snowFloor`.
   * @param {string} shown
   */
  _settled(shown) {
    return Math.max(this.frostCover > 0 && shown === 'frost' ? 0 : settledSnowCover(shown), this.snowFloor);
  }

  /** The weather's own snow at its settled cover at once (a level's frost was just applied). */
  settleSnow() {
    snowCover.value = this._settled(this.shown);
  }

  cycleWeather() {
    const i = WEATHERS.indexOf(this.weather);
    return this.setWeather(WEATHERS[(i + 1) % WEATHERS.length]);
  }

  /** Weather-blended value of a parameter (for the audio director etc.). */
  factor(key) { return this._w[key]; }

  update(dt) {
    // time glide
    const tr = this._transition;
    if (tr) {
      tr.t += dt;
      const k = smoothstep(0, 1, clamp(tr.t / tr.duration));
      this.lighting.setTime(tr.from + tr.delta * k);
      if (tr.t >= tr.duration) this._transition = null;
    }

    // weather blend (toward what the level shows: clear skies in a room)
    const shown = this.shown;
    const target = WEATHER_PARAMS[shown];
    const a = damp(1.1, dt);
    const w = this._w;
    for (let i = 0; i < WEATHER_KEYS.length; i++) {
      const key = WEATHER_KEYS[i];
      w[key] += (target[key] - w[key]) * a;
    }

    // the weather look (WeatherLook.js, shared with the editor's 3D preview) on top of the tuning
    const T = this.tuning;
    const L = this.lighting.settings;
    applyWeatherLighting(L, w, T);
    L.fogMul = T.fogMul * w.fog * this.zoomFog * this.levelFog;
    // (a spell's gust on top, eased: `gust`)
    this._gust += (this.gust - this._gust) * damp(this.gust > this._gust ? 7 : 2.2, dt);
    if (this._gust < 1e-3 && !this.gust) this._gust = 0;
    applyWeatherWind(w, T.windStrength, this._gust);
    const g = this.postfx.settings.grade;
    applyWeatherGrade(g, w, T.gradeTemperature, T.gradeSaturation);
    // nights read blue but not neon: the grade gives back some of the saturation boost after dark
    g.saturation -= NIGHT_DESATURATION * this.lighting.nightFactor;

    // Overcast: LightingSystem recomputes these from its palette every frame (it updates before the
    // game), so greying them here never accumulates. Rain and snow lose the golden cast.
    const oc = w.overcast;
    applyOvercast(this.lighting, oc);

    // god rays: strongest around golden hour (and a touch at dawn)
    this.godRays.intensity = T.godRays * w.rays * godRayHourLevel(this.lighting.timeOfDay);

    const night = this.lighting.nightFactor;
    const world = this.world;
    const E = world.emitters;
    if (E.dust) E.dust.intensity = T.dust * w.dust;
    // the level's particle areas, by effect
    // (leaves thin out as the light fades)
    const areas = world.areaEmitters ?? [];
    for (let i = 0; i < areas.length; i++) {
      const v = areaEmitterIntensity(areas[i].preset, w, T, night);
      if (v !== null) areas[i].emitter.intensity = v;
    }
    const pe = world.propEmitters;
    for (let i = 0; i < pe.length; i++) {
      const e = pe[i];
      const p = e.preset ?? e.config?.preset;
      if (p === 'smoke') e.intensity = T.smoke;
      else if (p === 'mist') e.intensity = this.frozenMist.has(e) ? 0 : T.mist;
    }

    // Lanterns and windows: lit at night — and, under an overcast (rain / snow) sky, glowing a
    // little by day too, the warm accents of a rainy village.
    // (a pooled light moving to another lantern takes this value too)
    applyLampDayGlow(world.lights, world.lightPool ?? null, oc);
    applyEmissiveDay(world.emissiveEntries, oc);
    // lantern glass: its albedo is bright amber, so dim it while the lamps are unlit
    if (world.glassMaterial) world.glassMaterial.color.setScalar(glassLevel(night, oc));

    // Water: calmer at night (blue sky fill on blue albedo + boosted glints read as neon)
    const wb = this._waterBase;
    if (wb) {
      const u = world.water.uniforms;
      const k = nightWaterLevels(night);
      u.uBrightness.value = wb.brightness * k.brightness;
      u.uGlint.value = wb.glint * k.glint;
    }
    this.rain.intensity = precipitationIntensity(w.rain);
    this.snow.intensity = precipitationIntensity(w.snow);
    // snow settles over ~15 s of snowfall and melts a little faster once it stops (or it rains)
    const settle = this._settled(shown);
    const rate = settle > snowCover.value ? 1 / 15 : 1 / 8;
    snowCover.value += clamp(settle - snowCover.value, -rate * dt, rate * dt);
    // a frozen level's frost: held while frozen (frozen again, it settles back over ≈ 3 s);
    // released, it melts over ≈ 8 s (a thaw front that passed over the whole level set it to 0)
    if (this.snowHold !== null) this.frostAmount = Math.min(1, this.frostAmount + dt / 3);
    else if (this.frostAmount > 0) this.frostAmount = Math.max(0, this.frostAmount - dt / 8);
    this.thaw?.update(dt);
  }

  dispose() {
    this.rain.dispose();
    this.snow.dispose();
  }
}
