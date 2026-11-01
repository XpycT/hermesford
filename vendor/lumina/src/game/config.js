/**
 * Game tunables shared by several demo modules (camera framing defaults, sun arc, sprite look,
 * the day palette). Per-level tuning (camera distance / pitch / focus bounds, the high-ground tilt)
 * lives in the level's `environment` (docs/contracts/LEVEL_EDITOR.md).
 */

/**
 * Gameplay camera defaults (a level's `environment.camera` may override distance and pitch).
 * Further back than the engine default (24) so the village reads as a diorama — characters about a
 * tenth of the screen tall, the houses around them in view — while keeping the narrow
 * lens of Square Enix's HD-2D games.
 */
export const CAMERA = Object.freeze({ distance: 30, pitch: 32, fov: 28, minDistance: 18, maxDistance: 42 });

/** Game hours per real second while playing (1 game hour ≈ 90 s: golden hour lingers). */
export const TIME_SPEED = 1 / 90;

/**
 * Sun arc: golden hour (17.2 h) puts the sun ~25° up, behind-left of the default view. High enough
 * that the plaza is not swallowed by house shadows, low enough for long raking shadows toward the
 * lower right and slanted god rays.
 */
export const SUN_PATH = Object.freeze({ noon: 12.6, lat: 32, dec: 14, refTime: 17.2, refAzimuth: -112 });

/**
 * Moon arc: the moon keys the scene from the front-right (camera side) instead of from behind, so
 * the faces the camera sees are moonlit and the hill / grove / pond don't read as black frames.
 */
export const MOON_PATH = Object.freeze({ refAzimuth: 40 });

/**
 * Day-palette overrides on top of LightingSystem's DEFAULT_KEYFRAMES (matched by keyframe name).
 *  - night / late night / blue hour: a brighter, bluer sky fill, so the world away from the lanterns
 *    stays readable (the nights of Square Enix's HD-2D games are blue, not black);
 *  - sunset / purple dusk: more sun and fill in the dusk trough (it used to be darker than night);
 *  - golden hour: a cooler ground bounce and sky fill, so the long shadows are lifted and slightly
 *    teal (ARCHITECTURE §1.5) instead of muddy red-brown.
 */
export const KEYFRAME_OVERRIDES = Object.freeze({
  night: { hemiI: 1.6, hemiSky: '#3656c0', hemiGround: '#1a2042', sunI: 1.0, exp: 1.36 },
  'late night': { hemiI: 1.55, hemiSky: '#3656c0', hemiGround: '#1a2042', sunI: 0.9, exp: 1.36 },
  'blue hour': { hemiI: 1.5, exp: 1.36 },
  sunset: { hemiI: 1.45, exp: 1.2 },
  'purple dusk': { sunI: 0.85, hemiI: 1.62, exp: 1.46 },
  'golden hour': { hemiGround: '#7a6058', hemiSky: '#6a80d4' },
});

/**
 * Shared look for every character / critter sprite in the demo.
 *
 * 2.5D pixel-art characters must read clearly at every hour, even when the low golden-hour sun sits behind
 * them. Sprite3D already bends its shading normal and wraps the diffuse term; here the normal leans
 * a little further toward "up" (so a low sun still grazes it) and a small emissive fill — which
 * Sprite3D multiplies by the sprite's own texel colours — lifts the shadow side like warm bounce
 * light off the ground. Kept modest: stacked with the wrap and the sun it otherwise blows faces and
 * white hair out to flat orange blobs at golden hour and noon. The fill is driven by
 * LightingSystem.registerEmissive so it fades down at night, where lanterns and the campfire take over.
 * Its strength is therefore SPRITE_FILL below: the game (Game._buildLevel: player, villagers,
 * critters, enemies) and the editor preview register every such sprite with
 * `registerEmissive(material, SPRITE_FILL)`, which sets `emissiveIntensity` at once and every
 * frame. `emissiveIntensity` here only lights sprites nobody registers (the combat_fx and enemy_ai
 * sandboxes); without it Sprite3D's default (1) would apply to them.
 */
export const CHARACTER_SPRITE_OPTS = Object.freeze({
  normalUp: 0.6,
  wrap: 0.6,
  roundness: 0.55,
  emissive: '#ffe9d2',
  emissiveIntensity: 0.06,
});

/** registerEmissive() levels for the sprite fill (day → night). */
export const SPRITE_FILL = Object.freeze({ day: 0.05, night: 0.03 });

/** Idle "breathing" playback speed range (the sheet's idle cycle is fast; villagers drift apart). */
export const IDLE_SPEED = Object.freeze([0.5, 0.62]);
