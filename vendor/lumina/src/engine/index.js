/**
 * Luminati — public engine API (barrel).
 *
 * `import { Engine, CameraRig, PostFX, LightingSystem, TileMap, ... } from './engine/index.js'`
 *
 * Importing this file has no side effects except the UI stylesheet / web-font imports pulled in
 * by `ui/UI.js` (see ARCHITECTURE.md §2 "No global side effects on import").
 *
 * Sections follow the module map: foundation, core, audio, rendering, pixel art, sprites, effects,
 * lighting, world, UI — then the lower-level building blocks (prop mesh builder, wind / flame
 * shaders, post-processing shaders) for games that extend the engine.
 */

// Foundation ------------------------------------------------------------------------------------
export { PPU, TILE_SIZE, LEVEL_HEIGHT, DIRECTIONS, RENDER_ORDER } from './constants.js';
export {
  clamp, lerp, invLerp, remap, smoothstep, fract, damp, angleDelta, DEG2RAD, RAD2DEG,
  mulberry32, hashString, RNG, hash2, valueNoise2, fbm2, bayer4,
} from './utils/math.js';
export { globalUniforms } from './render/GlobalUniforms.js';

// Core ------------------------------------------------------------------------------------------
export { EventEmitter } from './core/EventEmitter.js';
export { Input, DEFAULT_BINDINGS } from './core/Input.js';
export { Engine, disposeObjectTree } from './core/Engine.js';
export { CameraRig } from './core/CameraRig.js';

// Audio -----------------------------------------------------------------------------------------
export { AudioSystem, SFX_NAMES, AMBIENCE_LAYERS, COMBAT_SFX_NAMES, MUSIC_TRACKS, MUSIC_STINGERS } from './audio/AudioSystem.js';

// Rendering -------------------------------------------------------------------------------------
export { PostFX } from './render/PostFX.js';

// Pixel art -------------------------------------------------------------------------------------
export {
  PixelCanvas, parseColor, toHex, toCss, toThreeColor, mixColor, rgbToHsl, hslToRgb, shadeColor,
  rampFrom, makePixelTexture, normalMapFromHeight,
} from './pixel/PixelCanvas.js';
export { PALETTE, rampAt } from './pixel/Palette.js';
export { TextureLibrary, TEXTURE_NAMES } from './pixel/Textures.js';
export { createCharacterSheet, createCreatureSheet, CHARACTER_PRESETS, materialRamp, COMBAT_POSE_NAMES } from './pixel/CharacterSprites.js';
export { createPropSprite, PROP_SPRITE_KINDS } from './pixel/PropSprites.js';
// combat levels only (COMBAT.md §10): enemy sheets and the FX atlas. (The combat-only modules of
// this barrel are marked side-effect free in vite.config.js: re-exporting them here puts nothing
// into a page's chunks unless the page uses them — combat code imports them from their files.)
export { createEnemySheet, ENEMY_SHEET_KINDS } from './pixel/MonsterSprites.js';
export { createFxAtlas, FX_FRAMES } from './pixel/FxSprites.js';

// Sprites ---------------------------------------------------------------------------------------
export { Sprite3D, spriteSheetFromProp, patchSpriteLighting, cloneSharedTexture, GLSL_BAYER4 } from './sprite/Sprite3D.js';
export { SpriteManager } from './sprite/SpriteManager.js';
export { BlobBatch } from './sprite/BlobBatch.js';
export { Foliage } from './sprite/Foliage.js';

// Effects ---------------------------------------------------------------------------------------
export { Particles, PARTICLE_PRESETS, Emitter } from './fx/Particles.js';
export { GodRays } from './fx/GodRays.js';
// combat levels only (COMBAT.md §11): instanced atlas quads and terrain-draped telegraph markers
export { FxQuads } from './fx/FxQuads.js';
export { GroundMarkers, MARKER_GRID } from './fx/GroundMarkers.js';

// Lighting --------------------------------------------------------------------------------------
export { LightingSystem, DEFAULT_KEYFRAMES } from './lighting/LightingSystem.js';
export { Sky } from './lighting/Sky.js';
export { LightPool } from './lighting/LightPool.js';

// World -----------------------------------------------------------------------------------------
export { TileMap, ORGANIC_TOPS, GRASS_TOPS, FRINGE_RECEIVERS, FRINGE_PRIORITY, paintDecalMask } from './world/TileMap.js';
export { Water, createWaterfall } from './world/Water.js';
export { PropFactory } from './world/Props.js';

// UI --------------------------------------------------------------------------------------------
export { UI, DialogBox, Banner, TitleScreen, HUD, InteractPrompt, Fader, DebugPanel, Minimap, WorldMap } from './ui/UI.js';
export { DebugStats } from './ui/DebugPanel.js';
export { DEFAULT_CONTROLS, TIME_PHASES, timePhase, createKeycaps } from './ui/HUD.js';
// combat levels only (COMBAT.md §13; created by `ui.enableCombat()`)
export { CombatHUD } from './ui/CombatHUD.js';
export { BossBar } from './ui/BossBar.js';
export { WorldLabels } from './ui/WorldLabels.js';
export { Announcer } from './ui/Announcer.js';
export { DeathScreen } from './ui/DeathScreen.js';

// Advanced building blocks ------------------------------------------------------------------------
// Custom props: the same geometry builder, wind sway and flame shaders PropFactory uses internally.
export { MeshBuilder, trs } from './world/props/MeshBuilder.js';
export { applyWind, createWindDepthMaterial } from './world/props/Wind.js';
export { createFlame, createFlameMaterial, createGlowMaterial } from './world/props/Flame.js';
export { PropTextureSet } from './world/props/PropTextures.js';
// Custom post passes: the full-screen shaders PostFX is assembled from.
export { FULLSCREEN_VERTEX, POST_COMMON_GLSL, CopyShader } from './render/shaders/PostCommon.js';
export { GradeShader } from './render/shaders/GradeShader.js';
export { BloomBrightPassShader } from './render/shaders/BloomShaders.js';
export {
  createCocUniforms, DOF_COC_GLSL, DofPrefilterShader, goldenAngleKernel, createDofGatherShader,
  DofTentShader, DofBokehSpriteShader, DofCompositeShader,
} from './render/shaders/DofShaders.js';
