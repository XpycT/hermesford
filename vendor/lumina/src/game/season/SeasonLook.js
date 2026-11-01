import * as THREE from 'three';
import { globalUniforms } from '../../engine/render/GlobalUniforms.js';
import { thawField } from '../../engine/world/ThawField.js';
import { setMapTint } from '../../engine/ui/art/minimap.js';
import { auroraOf, frostOf } from '../LevelLook.js';
import { NIGHT_DESATURATION } from '../WeatherLook.js';

/**
 * SeasonLook — the season's sky and the aurora's light of The Bells of Evermere
 * (docs/contracts/EVERMERE_CAMPAIGN.md §5.2, §6.2; docs/design/SEASONS_LOOK.md §7–8), a chunk of its
 * own: ../Climate.js loads it (`loadSeasonLook`) for a level with an `environment.season` or an
 * `aurora` and nowhere else.
 *
 * - `seasonKeyframes(own, season)`: the lighting's own 24 h keyframes with the season's retouches
 *   (`SEASON_KEYFRAMES`, only where the default palette fails under the cinematic look at the
 *   campaign's hours: the autumn golden hour's fill, the winter night's readable blue, the spring
 *   dawn). Same names and hours (the HUD reads the phase by name), numbers only — no program.
 * - `createSeason(game)`: `game.season`, updated every frame after the weather
 *   (`Game.update`): the aurora — `game.envNow.aurora` (the level's, or a holding state's), eased
 *   over a few seconds, × the night — as light: the hemisphere fill and the fog colour (which the
 *   water reflects, so ice and water carry it) drift slowly between green and violet at a low
 *   amplitude (the moonlight a little too), and as sky (the Sky shader's `uAurora`, seen only in
 *   low, lifted shots). And the lamplight under falling snow at night (`SNOW_NIGHT_LAMPS`: the
 *   hub's blue hour) — the lamps brighter, the grade's night desaturation given back.
 *
 * Nothing is added or removed: colours, intensities, two grade values and a uniform, rewritten every
 * frame after the lighting's and the weather's own update (LightingSystem recomputes them from its
 * palette first, Weather the grade, so nothing accumulates).
 *
 * @import { Game } from '../Game.js'
 * @import { LightKeyframe } from '../../engine/lighting/LightingSystem.js'
 */

/**
 * The seasons' retouches of the lighting's keyframes, by keyframe name (every keyframe of that name;
 * the other fields are the lighting's own). Tuned under the cinematic look at the campaign's hours
 * (SEASONS_LOOK.md §7: the measured views).
 * @type {Readonly<Record<string, Readonly<Record<string, Partial<LightKeyframe>>>>>}
 */
export const SEASON_KEYFRAMES = Object.freeze({
  // the Blossomwood's morning (7.5 → 9) and the epilogue's dawn (6.7 → 9): a soft rose dawn, a clear
  // pale morning; the sky's fill near neutral (a blue or lilac one turns white blossom in shade
  // hydrangea purple under the grade's teal shadows) over a warm bounce. Evermere's blue hour (19.9,
  // the hub under falling snow): a moderate fill off the snow at the game's own exposure — deep
  // blacks, the lamps' pools reading warm (review EV-07: a brighter fill and exposure read milky)
  spring: {
    'pink dawn': { horizon: '#f6a6a4', hemiSky: '#b4a6cc', hemiGround: '#7c5e50', hemiI: 1.1 },
    sunrise: { horizon: '#f8c8a8', hemiSky: '#c4bed2', hemiGround: '#86684e', hemiI: 1.22 },
    morning: { top: '#5b8fd8', horizon: '#e6eef2', hemiSky: '#c6cad8', hemiGround: '#806c4c', hemiI: 1.18 },
    'purple dusk': { hemiSky: '#5658b0', hemiGround: '#2e2840', hemiI: 1.5 },
    'blue hour': { hemiSky: '#4462c0', hemiGround: '#2c3050', hemiI: 1.4, exp: 1.2 },
  },
  // Saltcombe's bright mid-morning (10.5 → 11.5): a deep summer blue over a pale sea haze
  summer: {
    morning: { top: '#3f80dc', horizon: '#d2e6f2', hemiSky: '#a6c8f0' },
    noon: { top: '#3a7ee0', horizon: '#cfe6f4' },
  },
  // Amberfield (16.6 → 17.2): the low sun behind the camera's left — a raised lavender fill so the
  // backlit canopies' shade reads as coloured (red reflects some of it), not red-brown murk (VQ-09),
  // a warm bounce off the wheat
  autumn: {
    afternoon: { hemiSky: '#a4a2dc', hemiGround: '#8e6e4a', hemiI: 1.5 },
    'golden hour': { top: '#3e4c9a', horizon: '#f2ac74', hemiSky: '#9890d8', hemiGround: '#a87850', hemiI: 2.0, sunI: 5.4 },
  },
  // Rimeholt and the Bell Court (22.5, gliding to 6.7): a readable blue night, not black (LIT-03) —
  // a brighter, bluer sky fill, a stronger moon rim; the dawn rose-gold for the ice to catch: a
  // warmer, stronger low sun and a rose fill off the sky, not the default's lilac (review EV-72: the
  // court's dawn read grey-mauve)
  winter: {
    night: { horizon: '#1c2b5c', hemiSky: '#4862bc', hemiGround: '#20284a', hemiI: 1.8, sunI: 1.15, exp: 1.42 },
    'late night': { hemiSky: '#4660b8', hemiGround: '#1e2648', hemiI: 1.72, sunI: 1.05, exp: 1.42 },
    'pre-dawn': { hemiSky: '#5a68b4', hemiI: 1.2 },
    'pink dawn': { horizon: '#f6a49a', sun: '#ff9a66', sunI: 2.7, hemiSky: '#d498b4', hemiGround: '#6c4656', hemiI: 1.12, exp: 1.12 },
    sunrise: { horizon: '#f8c4a0', sun: '#ffae6e', sunI: 3.1, hemiSky: '#e0a6b4', hemiGround: '#764a50', hemiI: 1.08, exp: 1.1 },
  },
});

/**
 * A season's keyframes: the lighting's own (`own`, the game's palette) with the season's retouches
 * (fresh copies: the debug panel may tune them in place).
 * @param {readonly LightKeyframe[]} own
 * @param {string} season
 * @returns {LightKeyframe[]}
 */
export function seasonKeyframes(own, season) {
  const patch = Object.hasOwn(SEASON_KEYFRAMES, season) ? SEASON_KEYFRAMES[season] : {};
  return own.map((k) => ({ ...k, ...((k.name && Object.hasOwn(patch, k.name) && patch[k.name]) || {}) }));
}

/** The aurora's light: the two ends of its slow drift (linear colours; the hue, not the brightness). */
const AURORA_GREEN = new THREE.Color('#2fa080');
const AURORA_VIOLET = new THREE.Color('#6a46b0');
/**
 * How far the aurora pulls the hemisphere fill, the fog and (a little) the moonlight toward its hue,
 * at full strength by night.
 */
const HEMI_PULL = 0.75;
const FOG_PULL = 0.55;
const MOON_PULL = 0.3;
/** The drift's two periods (s): ≈ 40–90 s between green and violet. */
const DRIFT = [64, 41];

/**
 * Lamplight under falling snow at night (Evermere's blue hour at 19.9; review EV-07, KNOWN_ISSUES
 * EVM-04, docs/design/SEASONS_LOOK.md §7): the snow weather's grey grade and the night's
 * desaturation (`NIGHT_DESATURATION`) left the lamps' pools on the snow pink-grey — their warm
 * light only cancelled the blue fill they share the snow with. By the falling snow (the weather's
 * `snow`, 0–1) × the night factor: the **lamps** (the world's `nightOnly` point lights — never a
 * fire, never a combat VFX light) × `lamps`, so a pool beats the fill, and the grade gives back
 * `saturation` (the night's desaturation) and `temperature` of the snow's cold. The blue hour keeps
 * its blue: the frame away from the lamps stays cold (at the hub's play camera the warm pixels
 * 0–2 % → 1–12 % of the frame, 1–38 % near the lamps; the cold ones 66–77 % → 55–77 %:
 * SEASONS_LOOK.md §7). Only where a season look runs
 * (`game.season`) and snow falls at night — the hub alone among the shipped levels.
 */
export const SNOW_NIGHT_LAMPS = Object.freeze({ lamps: 2.7, saturation: NIGHT_DESATURATION, temperature: 0.11 });

const _hue = new THREE.Color();
const _t = new THREE.Color();
const lum = (c) => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;

/**
 * Pull a colour toward a hue at its own brightness (by `k`, 0–1).
 * @param {THREE.Color} c
 * @param {THREE.Color} hue
 * @param {number} k
 */
function pullToward(c, hue, k) {
  const l = lum(c);
  _t.copy(hue).multiplyScalar(l / Math.max(1e-4, lum(hue)));
  c.lerp(_t, k);
}

/**
 * The season's per-frame work (`game.season`): the aurora's light and sky.
 */
/**
 * The minimap's colours while its level is frozen (review EV-74: no summer map under the snow): the
 * land in the frozen base's snow — lit `#dfe8f4`, the paths and stone trodden `#b4c4dc`, the forest
 * the snow's shade —, the water in ice. By G's class letter (art/minimap.js).
 */
const FROZEN_MAP = Object.freeze({
  g: '#dfe8f4', G: '#cad6ea', f: '#dfe8f4', F: '#c2d0e4', s: '#d4dff0', m: '#b4c4dc', t: '#7d8fbe', p: '#b4c4dc', c: '#a6b4cc',
  k: '#c6d2e6', b: '#9aa6be', w: '#cfe8f0',
});

export class SeasonLight {
  /** @param {Game} game */
  constructor(game) {
    this.game = game;
    /** The aurora's eased strength (0–1; it starts where the level's environment says). */
    this.aurora = auroraOf(game.envNow);
    /** The drift's clock (s; it starts at the green end). */
    this.t = 48;
    /** The minimap shows the frozen palette (`setMapTint`; Climate.applyClimate clears it per level). */
    this.frozenMap = false;
  }

  /**
   * After the weather's update (Game.update): the minimap's frozen palette following the thaw field;
   * the aurora eased toward `envNow.aurora` (≈ 3 s), × the night, into the sky's uniform and — by
   * night — the hemisphere fill and the fog colour.
   * @param {number} dt seconds
   */
  update(dt) {
    // the minimap in snow and ice while the level is frozen, its own colours again after the bell
    const frozen = thawField.frozen && !!frostOf(this.game.level?.environment);
    if (frozen !== this.frozenMap) setMapTint((this.frozenMap = frozen) ? FROZEN_MAP : null);
    const L = this.game.lighting;
    // the lamps' warm pools under falling snow at night (SNOW_NIGHT_LAMPS): the lamps' intensities
    // as the lighting set them this frame (their flicker, a pool's fade, a hidden group's 0) × the
    // lift; the grade as the weather set it this frame + the relief
    const snowNight = this.game.weather.factor('snow') * L.nightFactor;
    if (snowNight > 0.002) {
      const lift = 1 + (SNOW_NIGHT_LAMPS.lamps - 1) * snowNight;
      const lamps = this.game.world?.lights ?? [];
      for (let i = 0; i < lamps.length; i++) if (lamps[i].nightOnly) lamps[i].light.intensity *= lift;
      const grade = this.game.postfx.settings.grade;
      grade.saturation += SNOW_NIGHT_LAMPS.saturation * snowNight;
      grade.temperature += SNOW_NIGHT_LAMPS.temperature * snowNight;
    }
    this.aurora += (auroraOf(this.game.envNow) - this.aurora) * Math.min(1, dt * 0.7);
    this.t += dt;
    const k = this.aurora * L.nightFactor;
    L.sky.uniforms.uAurora.value = k > 0.002 ? k : 0;
    if (k <= 0.002 || L.settings.backdrop) return;
    // (0 green … 1 violet, lingering near the ends)
    const d = 0.75 * Math.sin((this.t * Math.PI * 2) / DRIFT[0]) + 0.25 * Math.sin((this.t * Math.PI * 2) / DRIFT[1] + 1.3);
    const m = 0.5 + 0.5 * Math.sign(d) * Math.abs(d) ** 0.6;
    _hue.copy(AURORA_GREEN).lerp(AURORA_VIOLET, m);
    pullToward(L.hemi.color, _hue, HEMI_PULL * k);
    pullToward(L.fog.color, _hue, FOG_PULL * k);
    globalUniforms.uFogColor.value.copy(L.fog.color);
    // (the moon, which lights the snow most at night: the aurora's colour on it too, a little)
    pullToward(L.sun.color, _hue, MOON_PULL * k);
    pullToward(globalUniforms.uSunColor.value, _hue, MOON_PULL * k);
  }
}

/**
 * The game's season (`game.season`; ../Climate.js `applyClimate` makes it for a level with a season
 * or an aurora).
 * @param {Game} game
 * @returns {SeasonLight}
 */
export function createSeason(game) {
  return new SeasonLight(game);
}
