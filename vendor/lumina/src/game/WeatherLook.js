import * as THREE from 'three';
import { globalUniforms } from '../engine/render/GlobalUniforms.js';
import { clamp, lerp } from '../engine/utils/math.js';

/** @import { LightingSystem } from '../engine/lighting/LightingSystem.js' */

/**
 * The weather look — the single source of truth shared by the game's weather director
 * (`Weather.js`, which blends between these states over a few seconds) and the level editor's 3D
 * preview (`src/editor/viewport3d/Viewport3D.js`, which shows a level's `environment.weather` at
 * its settled values).
 *
 * A weather state `w` is WEATHER_PARAMS-shaped: one of the presets (settled) or a per-key blend of
 * them (the game while it changes). The functions below apply the parts of the look that depend
 * on the weather only; the callers combine them with their own base values (the game: the debug
 * panel's `tuning`; the editor: its own edit fog and grade). The time-of-day effects are here
 * too, so both apply the same ones — the game at its running hour, the editor at its fixed one:
 * the golden-hour god rays (`godRayHourLevel`), the night desaturation (`NIGHT_DESATURATION`), the
 * calmer water at night (`nightWaterLevels`), the thinner leaves at night (`areaEmitterIntensity`'s
 * `night`) and the lantern-glass level (`glassLevel`).
 */

/** The weathers R cycles through (`frost` is not one: only data or the story set it). */
export const WEATHERS = ['clear', 'rain', 'snow'];

/** Grade saturation given back after dark (× the night factor): nights read blue but not neon. */
export const NIGHT_DESATURATION = 0.22;

/**
 * God rays by the hour: strongest around golden hour (17.3 h) and a touch at dawn (7 h) — 0.35 …
 * 1 (× the weather's `rays` and the caller's base).
 * @param {number} h hour of day
 * @returns {number}
 */
export function godRayHourLevel(h) {
  const golden = Math.exp(-(((h - 17.3) / 1.3) ** 2)) + 0.6 * Math.exp(-(((h - 7.0) / 1.0) ** 2));
  return lerp(0.35, 1.0, clamp(golden));
}

/**
 * Water at night: calmer (blue sky fill on blue albedo plus boosted glints read as neon) —
 * multipliers of the level's water brightness and glint.
 * @param {number} night the lighting's night factor (0 day … 1 night)
 * @returns {{ brightness: number, glint: number }}
 */
export function nightWaterLevels(night) {
  return { brightness: lerp(1, 0.66, night), glint: lerp(1, 0.55, night) };
}

/**
 * Per-weather multipliers / offsets:
 * - sun, ambient, fog, exposure: LightingSystem.settings multipliers (× the caller's base)
 * - wind, windX, windZ: wind strength and direction (global uniforms uWindStrength / uWind)
 * - temp, sat: grade temperature / saturation offsets (+ the caller's base)
 * - rays: god-ray factor; dust, bugs, leaves: particle-area factors; rain, snow: precipitation
 * - overcast: 0..1 grey sky — greys fog / sun / hemisphere colours, lights lanterns and windows a
 *   little by day
 *
 * `frost` (The Bells of Evermere, EVERMERE_CAMPAIGN.md §5.2): a clear, cold sky over settled snow,
 * no flakes — not in R's cycle (`WEATHERS`); the frozen look under the campaign's cinematic grade
 * (the sun a little low so lit snow stays under the lens streaks, a thin cold haze, the grade cool
 * and drained, the dust as diamond dust in the shafts).
 */
export const WEATHER_PARAMS = Object.freeze({
  clear: Object.freeze({ sun: 1, ambient: 1, fog: 1, exposure: 1, wind: 1, windX: 1.0, windZ: 0.35, temp: 0, sat: 0, rays: 1, dust: 1, bugs: 1, leaves: 1, rain: 0, snow: 0, overcast: 0 }),
  rain: Object.freeze({ sun: 0.26, ambient: 0.9, fog: 2.1, exposure: 0.92, wind: 2.3, windX: 2.2, windZ: 0.9, temp: -0.12, sat: -0.24, rays: 0, dust: 0.15, bugs: 0, leaves: 1.6, rain: 1, snow: 0, overcast: 0.72 }),
  snow: Object.freeze({ sun: 0.45, ambient: 1.15, fog: 1.9, exposure: 1.04, wind: 1.3, windX: 1.2, windZ: 0.5, temp: -0.3, sat: -0.42, rays: 0.25, dust: 0, bugs: 0, leaves: 0.3, rain: 0, snow: 1, overcast: 0.62 }),
  frost: Object.freeze({ sun: 0.8, ambient: 1.1, fog: 1.4, exposure: 0.92, wind: 0.6, windX: 0.8, windZ: 0.3, temp: -0.22, sat: -0.25, rays: 0.7, dust: 0.6, bugs: 0, leaves: 0, rain: 0, snow: 0, overcast: 0.15 }),
});

/**
 * A weather state: one of the WEATHER_PARAMS presets (settled) or a per-key blend of them.
 * @typedef {{ -readonly [K in keyof typeof WEATHER_PARAMS.clear]: number }} WeatherState
 */

/** The keys of a weather state (blended one by one). */
export const WEATHER_KEYS = /** @type {(keyof WeatherState)[]} */ (Object.keys(WEATHER_PARAMS.clear));

/**
 * A known weather name, else 'clear' (level files may hold anything).
 * @param {unknown} name
 * @returns {keyof typeof WEATHER_PARAMS}
 */
export function weatherName(name) {
  return typeof name === 'string' && Object.hasOwn(WEATHER_PARAMS, name) ? /** @type {keyof typeof WEATHER_PARAMS} */ (name) : 'clear';
}

/**
 * The settled state of a weather (unknown names = clear).
 * @param {unknown} name
 * @returns {WeatherState}
 */
export function settledWeather(name) {
  return WEATHER_PARAMS[weatherName(name)];
}

/**
 * Settled snow on the ground under a weather (0 … 1): snow and frost lie white (a frozen level's
 * frost holds its own cover instead: Weather `snowHold`).
 * @param {unknown} name
 */
export function settledSnowCover(name) {
  const w = weatherName(name);
  return w === 'snow' || w === 'frost' ? 1 : 0;
}

/**
 * Particles.createEmitter configs of the precipitation (boxes that follow the camera, sized for
 * the gameplay camera's view volume at distance ~30).
 * @type {Record<'rain'|'snow',
 *   { preset: 'rain'|'snow', count: number, bounds: number[], size?: number[] }>}
 */
const PRECIPITATION = {
  rain: { preset: 'rain', count: 2600, bounds: [44, 16, 44] },
  snow: { preset: 'snow', count: 2400, bounds: [44, 15, 44], size: [0.09, 0.15] },
};

/**
 * A fresh emitter config for 'rain' or 'snow' (fresh arrays: the particle system keeps them).
 * @param {'rain'|'snow'} kind
 * @param {object} [extra] more config (e.g. `{ intensity: 0 }`)
 * @returns {{ preset: 'rain'|'snow', count: number, bounds: number[], size?: number[],
 *   [key: string]: unknown }} bounds: the box size [x, y, z] (Particles `cfg.bounds`)
 */
export function precipitationEmitter(kind, extra = {}) {
  const c = PRECIPITATION[kind];
  if (!c) throw new Error(`precipitationEmitter: unknown kind "${kind}"`);
  /** @type {ReturnType<typeof precipitationEmitter>} */
  const out = { preset: c.preset, ...extra, count: c.count, bounds: [...c.bounds] };
  if (c.size) out.size = [...c.size];
  return out;
}

/**
 * Emitter intensity of a precipitation factor (the faint tail of a blend draws nothing).
 * @param {number} v
 */
export function precipitationIntensity(v) {
  return v < 0.02 ? 0 : v;
}

/**
 * LightingSystem.settings multipliers of a weather state (the fog multiplier is the caller's:
 * `base × w.fog × …`).
 * @param {LightingSystem['settings']} settings
 *   LightingSystem.settings
 * @param {WeatherState} w weather state
 * @param {{ sunMul?: number, ambientMul?: number, exposureMul?: number, pointLightMul?: number }} [base]
 */
export function applyWeatherLighting(settings, w, { sunMul = 1, ambientMul = 1, exposureMul = 1, pointLightMul = 1 } = {}) {
  settings.sunMul = sunMul * w.sun;
  settings.ambientMul = ambientMul * w.ambient;
  settings.exposureMul = exposureMul * w.exposure;
  settings.pointLightMul = pointLightMul;
}

/**
 * Wind strength and direction (global uniforms) of a weather state; `strength` = base strength.
 * `gust` (Weather.gust, eased): extra strength (1 doubles it) that pulses a little (±30 %), and a
 * swirl — the direction swings to and fro by up to 0.22 rad × gust while its length, which sets the
 * pace of the grass waves, stays. 0 = the weather's own wind, exactly.
 * @param {WeatherState} w
 * @param {number} [strength]
 * @param {number} [gust]
 */
export function applyWeatherWind(w, strength = 1, gust = 0) {
  const t = globalUniforms.uTime.value;
  const p = gust && Math.sin(t * 2.7) * Math.sin(t * 1.1 + 1);
  globalUniforms.uWindStrength.value = strength * w.wind * (1 + gust * (1 + 0.3 * p));
  const c = Math.cos(gust * 0.22 * p);
  const s = Math.sin(gust * 0.22 * p);
  globalUniforms.uWind.value.set(w.windX * c - w.windZ * s, w.windX * s + w.windZ * c);
}

/**
 * Grade temperature / saturation: the caller's base plus the weather's offsets.
 * @param {{ temperature: number, saturation: number }} grade PostFX settings.grade
 * @param {WeatherState} w
 * @param {number} temperature
 * @param {number} saturation
 */
export function applyWeatherGrade(grade, w, temperature, saturation) {
  grade.temperature = temperature + w.temp;
  grade.saturation = saturation + w.sat;
}

/** Overcast light: cool grey — the colour keeps its luminance but loses the golden cast. */
const OVERCAST_TINT = new THREE.Color(0.9, 0.97, 1.12);
const _grey = new THREE.Color();
export function overcastColor(c, k) {
  if (k <= 0) return c;
  const lum = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  _grey.copy(OVERCAST_TINT).multiplyScalar(lum);
  return c.lerp(_grey, k);
}

/**
 * Grey the lighting's fog, sun and hemisphere colours (and the fog / sun global uniforms) by the
 * overcast amount. LightingSystem recomputes them from its palette in every update, so call this
 * after the lighting update of the frame (it never accumulates).
 * @param {LightingSystem} lighting
 * @param {number} oc overcast 0..1
 */
export function applyOvercast(lighting, oc) {
  if (!(oc > 0.002)) return;
  overcastColor(lighting.fog.color, oc);
  overcastColor(lighting.sun.color, oc * 0.85);
  overcastColor(lighting.hemi.color, oc * 0.6);
  overcastColor(lighting.hemi.groundColor, oc * 0.6);
  globalUniforms.uFogColor.value.copy(lighting.fog.color);
  overcastColor(globalUniforms.uSunColor.value, oc * 0.85);
}

/** Daytime brightness of the lanterns (nightOnly lights) under an overcast sky: warm accents of a grey day. */
export function lampDayIntensity(oc) {
  return lerp(0.05, 0.45, oc);
}

/**
 * Lanterns glowing by day under an overcast sky: every nightOnly light handle gets the weather's
 * `dayIntensity`, and so does the LightPool (a pooled light moving to another lantern takes it;
 * its ranking uses it too).
 * @param {{ nightOnly: boolean, dayIntensity: number }[]} lights LightingSystem point-light handles
 * @param {{ nightDayIntensity: number }|null} pool
 * @param {number} oc overcast 0..1
 */
export function applyLampDayGlow(lights, pool, oc) {
  const dayLamp = lampDayIntensity(oc);
  for (let i = 0; i < lights.length; i++) if (lights[i].nightOnly) lights[i].dayIntensity = dayLamp;
  if (pool) pool.nightDayIntensity = dayLamp;
}

/**
 * Windows and lantern glass glowing a little by day under an overcast sky.
 * @param {{ day: number, night: number, baseDay: number }[]} entries LightingSystem.registerEmissive
 *   entries with `baseDay` = their own day value
 * @param {number} oc overcast 0..1
 */
export function applyEmissiveDay(entries, oc) {
  for (let i = 0; i < entries.length; i++) entries[i].day = lerp(entries[i].baseDay, entries[i].night * 0.4, oc);
}

/**
 * Lantern-glass albedo level: its albedo is bright amber, so it is dimmed while the lamps are
 * unlit (by day under a clear sky). `night` = LightingSystem.nightFactor.
 */
export function glassLevel(night, oc) {
  return lerp(0.5, 1, clamp(Math.max(night, oc * 0.8)));
}

/** Tuning of the particle areas (the game's debug panel edits its own copy). */
const UNIT_AREAS = Object.freeze({ fireflies: 1, leaves: 1, petals: 1, dust: 1, smoke: 1, mist: 1 });

/**
 * Intensity of a particle area (level `emitter` object) by its preset under a weather state, or
 * null for presets the weather leaves alone.
 * @param {string} preset
 * @param {WeatherState} w weather state
 * @param {{ fireflies: number, leaves: number, petals: number, dust: number, smoke: number, mist: number }} [T]
 *   per-preset base values
 * @param {number} [night] LightingSystem.nightFactor: leaves thin out as the light fades (the
 *   editor preview passes 0)
 * @returns {number|null}
 */
export function areaEmitterIntensity(preset, w, T = UNIT_AREAS, night = 0) {
  switch (preset) {
    case 'fireflies': return T.fireflies * w.bugs;
    // big dark flakes read as petals / bats at dusk
    case 'leaves': return T.leaves * clamp(w.leaves, 0, 1) * (1 - 0.6 * night);
    case 'petals': return T.petals * clamp(1 - w.rain - w.snow, 0, 1);
    case 'dust': return T.dust * w.dust;
    case 'smoke': return T.smoke;
    case 'mist': return T.mist;
    default: return null;
  }
}
