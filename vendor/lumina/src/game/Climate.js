import { climateOf, seasonOf, auroraOf } from './LevelLook.js';
import { setMapTint } from '../engine/ui/art/minimap.js';

/**
 * Climate — what a level's climate (`environment.climate`, LevelLook.js `climateOf`;
 * docs/contracts/DRAGON_CAMPAIGN.md §5.2, §6.2; docs/design/ARID_LOOK.md) does to the running
 * game's sky and air. For 'arid': the sky's keyframes (`ARID_KEYFRAMES`: a pale hazy noon under a
 * hard white sun, a molten golden hour with violet shade, a deep blue night over a warm horizon),
 * so the fog — the horizon's colour — is a dusty one, through `lighting.setKeyframes`; and the camera
 * dust's look (`climateDust`, read where the dust is made: World's atmosphere, the editor's
 * preview). For a level without a climate the game's own keyframes again (a campaign travels from an
 * arid level to a temperate one without a reload).
 *
 * Called by `Game` whenever a level is applied — `init`, once the lighting, particles and post
 * exist and before the world is built; `swapLevel`, after `_applyLevel` (every travel, a room
 * attached again too) — and by nothing else. The border's kinds, the outer scenery
 * (Scenery.js: `climate` of `scatterForestSteps`, `makeOuterHeight`, `outerGroundSteps`) and the
 * ground foliage (GroundDetail.js: by the tiles' top textures) read the climate themselves.
 *
 * It adds and removes nothing: no light, no material, no program (the keyframes are numbers the
 * lighting interpolates every frame); a level without a climate after one without a climate does
 * not touch the lighting at all, so a temperate level renders exactly as before.
 *
 * A level's season and aurora (`environment.season` / `aurora`, The Bells of Evermere —
 * docs/contracts/EVERMERE_CAMPAIGN.md §6.2, docs/design/SEASONS_LOOK.md §7–8) go the same way: the
 * season's keyframes (only where its look needs them) and `game.season` — the aurora's light, made
 * only for such a level (null on every other) — come from ./season/SeasonLook.js, a chunk of its
 * own that `applyClimate` loads (`seasonReady`: its pending load, for the build to await); the
 * sky's aurora uniform is reset on every level applied.
 *
 * @import { Game } from './Game.js'
 * @import { LevelEnvironment } from '../engine/level/types.js'
 * @import { LightingSystem, LightKeyframe } from '../engine/lighting/LightingSystem.js'
 */

/**
 * The arid 24 h palette: the engine's keyframe names and hours (LightingSystem DEFAULT_KEYFRAMES —
 * the HUD reads the phase by name), the colours of a dry mountain range: hazy warm horizons (the
 * fog), a whiter, harder sun by day, sand-coloured ground bounce, fewer clouds; violet sky fill in
 * the shade at golden hour so the long shadows read violet against the orange light; a deep blue
 * night whose horizon keeps a warm glow. Every field given (no fallback to the defaults). Tuning
 * notes: docs/design/ARID_LOOK.md §3.
 * @type {readonly LightKeyframe[]}
 */
export const ARID_KEYFRAMES = Object.freeze([
  { t: 0.0, name: 'night',
    top: '#04071a', horizon: '#2e2442', bottom: '#0b0c24', sun: '#7c96f2', sunI: 1.0,
    hemiSky: '#3654bc', hemiGround: '#251c2c', hemiI: 1.58, fog: 0.0098, exp: 1.36, night: 1, moon: 1, shadow: 0.6, glow: 0.45, clouds: 0.12 },
  { t: 4.3, name: 'late night',
    top: '#060a20', horizon: '#33284a', bottom: '#0d0e2a', sun: '#809af2', sunI: 0.9,
    hemiSky: '#3654bc', hemiGround: '#261c2e', hemiI: 1.52, fog: 0.0102, exp: 1.36, night: 1, moon: 1, shadow: 0.58, glow: 0.5, clouds: 0.14 },
  { t: 5.25, name: 'pre-dawn',
    top: '#181a46', horizon: '#7a5874', bottom: '#2a2244', sun: '#a6a2e2', sunI: 0.18,
    hemiSky: '#5a5ea6', hemiGround: '#2c2030', hemiI: 1.05, fog: 0.0125, exp: 1.26, night: 0.86, moon: 1, shadow: 0.35, glow: 0.85, clouds: 0.2 },
  { t: 6.1, name: 'pink dawn',
    top: '#3a4a94', horizon: '#f7a27a', bottom: '#8e6488', sun: '#ff8456', sunI: 2.4,
    hemiSky: '#9c86cc', hemiGround: '#7a4c3c', hemiI: 1.0, fog: 0.0118, exp: 1.08, night: 0.3, moon: 0, shadow: 0.85, glow: 1.05, clouds: 0.2 },
  { t: 6.9, name: 'sunrise',
    top: '#4c72c0', horizon: '#fbc694', bottom: '#a8869a', sun: '#ffbe84', sunI: 3.0,
    hemiSky: '#9cb0de', hemiGround: '#7e5a40', hemiI: 1.05, fog: 0.0118, exp: 1.05, night: 0.06, moon: 0, shadow: 0.95, glow: 1.0, clouds: 0.18 },
  { t: 8.0, name: 'morning',
    top: '#5488d2', horizon: '#ecdcc2', bottom: '#c2aa8c', sun: '#fff0d2', sunI: 3.5,
    hemiSky: '#a6c0e6', hemiGround: '#94704c', hemiI: 1.05, fog: 0.0104, exp: 1.0, night: 0, moon: 0, shadow: 1, glow: 0.8, clouds: 0.15 },
  // noon: a pale, hazy blue; a hard white sun; the haze a warm off-white (the dust in the air)
  { t: 12.2, name: 'noon',
    top: '#5a94de', horizon: '#e8e2d2', bottom: '#cab494', sun: '#fffaf0', sunI: 3.9,
    hemiSky: '#b2cae8', hemiGround: '#a08058', hemiI: 1.02, fog: 0.0102, exp: 0.95, night: 0, moon: 0, shadow: 1, glow: 0.6, clouds: 0.12 },
  { t: 15.3, name: 'afternoon',
    top: '#5a8cd8', horizon: '#ecdcbe', bottom: '#c2a688', sun: '#ffe8c0', sunI: 3.9,
    hemiSky: '#a6bce6', hemiGround: '#9a7450', hemiI: 1.06, fog: 0.0104, exp: 0.98, night: 0, moon: 0, shadow: 1, glow: 0.8, clouds: 0.15 },
  // golden hour: molten orange light, violet fill in the shade (long violet shadows), the haze glowing
  { t: 17.2, name: 'golden hour',
    top: '#46448e', horizon: '#f8a066', bottom: '#a8626e', sun: '#ffb468', sunI: 5.1,
    hemiSky: '#7276d4', hemiGround: '#8c6656', hemiI: 1.9, fog: 0.0104, exp: 1.12, night: 0, moon: 0, shadow: 1, glow: 1.2, clouds: 0.22 },
  { t: 18.45, name: 'sunset',
    top: '#2c2466', horizon: '#f2704c', bottom: '#6a2e5c', sun: '#ff7040', sunI: 3.2,
    hemiSky: '#6a58c0', hemiGround: '#4e2c3c', hemiI: 1.45, fog: 0.0112, exp: 1.2, night: 0.22, moon: 0, shadow: 0.85, glow: 1.35, clouds: 0.25 },
  { t: 19.25, name: 'purple dusk',
    top: '#1a184e', horizon: '#9a5878', bottom: '#2c1c46', sun: '#c47a9e', sunI: 0.85,
    hemiSky: '#4c4ca6', hemiGround: '#2c1c32', hemiI: 1.62, fog: 0.0122, exp: 1.46, night: 0.62, moon: 0, shadow: 0.5, glow: 0.95, clouds: 0.22 },
  { t: 20.05, name: 'blue hour',
    top: '#0a1040', horizon: '#3c3478', bottom: '#12163c', sun: '#7290f2', sunI: 0.42,
    hemiSky: '#304cae', hemiGround: '#1c1630', hemiI: 1.5, fog: 0.0116, exp: 1.36, night: 0.92, moon: 1, shadow: 0.5, glow: 0.55, clouds: 0.15 },
  // night: deep blue overhead, the horizon still warm (the glow of the dry air)
  { t: 21.4, name: 'night',
    top: '#050a20', horizon: '#30264a', bottom: '#0b0e28', sun: '#7a96f2', sunI: 1.0,
    hemiSky: '#3654bc', hemiGround: '#251c2c', hemiI: 1.58, fog: 0.0098, exp: 1.36, night: 1, moon: 1, shadow: 0.6, glow: 0.45, clouds: 0.12 },
]);

/**
 * The camera dust's look for a climate (Particles `createEmitter` overrides on top of the 'dust'
 * preset, spread where the dust is made — World's atmosphere, the editor's preview): for 'arid'
 * more motes, a little larger, a warmer gold, drifting with the wind; for a level without a climate
 * nothing (`{}`: the dust as before).
 * @param {Partial<LevelEnvironment>|null|undefined} env
 * @returns {{ count?: number, size?: [number, number], color?: string, windInfluence?: number,
 *   velocity?: [number, number, number], velocityVariance?: [number, number, number], hdr?: number,
 *   alpha?: number }}
 */
export function climateDust(env) {
  if (climateOf(env) !== 'arid') return {};
  return {
    count: 190, size: [0.06, 0.14], color: '#ffd596', windInfluence: 0.45,
    velocity: [0.1, 0.04, 0.03], velocityVariance: [0.09, 0.05, 0.09], hdr: 1.1, alpha: 0.75,
  };
}

/** The keyframes a lighting system had before a climate replaced them (its own: the game's). */
const OWN = new WeakMap();
/** The climate (or season) a lighting system shows now (absent: none). */
const SHOWN = new WeakMap();

/** The season's look once loaded (./season/SeasonLook.js). @type {typeof import('./season/SeasonLook.js')|null} */
let SEASON = null;
/** @type {Promise<typeof import('./season/SeasonLook.js')>|null} */
let seasonJob = null;

/**
 * Load the season's look (once; later calls share the import): the seasons' keyframes and the
 * aurora's light, a chunk of its own.
 * @returns {Promise<typeof import('./season/SeasonLook.js')>}
 */
export function loadSeasonLook() {
  return (seasonJob ??= import('./season/SeasonLook.js').then((m) => (SEASON = m), (err) => {
    seasonJob = null;
    throw err;
  }));
}

/**
 * The season's look still loading for the level applied last (`applyClimate` started it), or null:
 * awaited before the level's first frame so it opens under its own sky.
 * @returns {Promise<unknown>|null}
 */
export function seasonReady() {
  return SEASON ? null : seasonJob;
}

/**
 * Show a climate's sky on a lighting system: 'arid' → `ARID_KEYFRAMES`; a season (when its look is
 * loaded: `loadSeasonLook`) → its keyframes (SeasonLook `seasonKeyframes`, the own ones retouched
 * where the season needs it); null → the keyframes it had before the first climate (kept on first
 * use). Does nothing when that sky shows already — so a level without a climate or season never
 * touches a lighting system that never showed one. Shared by the game (`applyClimate`) and the
 * editor's 3D preview (`showLevelSky`).
 * @param {LightingSystem} lighting
 * @param {'arid'|null} climate
 * @param {string|null} [season] the level's season (LevelLook.seasonOf); the climate wins
 * @returns {boolean} whether the keyframes changed
 */
export function showClimateSky(lighting, climate, season = null) {
  const key = climate ?? (season && SEASON ? season : null);
  const now = SHOWN.get(lighting) ?? null;
  if (now === key) return false;
  if (!OWN.has(lighting)) OWN.set(lighting, lighting.keyframes);
  const own = OWN.get(lighting);
  // (copies: the debug panel may tune the lighting's keyframes in place)
  lighting.setKeyframes(key === 'arid' ? ARID_KEYFRAMES.map((k) => ({ ...k })) : key ? SEASON.seasonKeyframes(own, key) : own);
  SHOWN.set(lighting, key);
  return true;
}

/**
 * The level's sky in the editor's 3D preview (every frame, before the lighting's update): its
 * climate or season (`showClimateSky`; the season's look loads on first use) and its aurora at the
 * hour shown (the sky only; the aurora's light is the game's).
 * @param {LightingSystem} lighting
 * @param {Partial<LevelEnvironment>|null|undefined} env
 */
export function showLevelSky(lighting, env) {
  const season = seasonOf(env);
  if (season && !SEASON) loadSeasonLook().catch(() => {});
  showClimateSky(lighting, climateOf(env), season);
  lighting.sky.uniforms.uAurora.value = auroraOf(env) * lighting.nightFactor;
}

/**
 * Apply a level's climate to the running game (see the header): its sky on `game.lighting`; for a
 * level with a season or an aurora the season's keyframes and `game.season` (the aurora's light)
 * once its look is loaded — `seasonReady` until then —, for any other no season and no aurora.
 * @param {Game} game
 * @param {Partial<LevelEnvironment>} env the level's environment (`game.env`)
 * @returns {void}
 */
export function applyClimate(game, env) {
  const season = seasonOf(env);
  showClimateSky(game.lighting, climateOf(env), season);
  game.season = null;
  game.lighting.sky.uniforms.uAurora.value = 0;
  // (the minimap's frozen palette is the season's, per level: its SeasonLight sets it again)
  setMapTint(null);
  if (!season && !(auroraOf(env) > 0)) return;
  const start = () => {
    // (another level applied meanwhile: its own call decides)
    if (game.env !== env) return;
    showClimateSky(game.lighting, climateOf(env), season);
    game.season = SEASON.createSeason(game);
  };
  if (SEASON) start();
  else loadSeasonLook().then(start, (err) => console.warn('[Luminati] the season look did not load:', err));
}
