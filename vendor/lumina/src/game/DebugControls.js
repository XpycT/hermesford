import { DEG2RAD, RAD2DEG } from '../engine/index.js';
import { WEATHERS } from './Weather.js';

/** @import { Game } from './Game.js' */

/**
 * Populates the DebugPanel (lil-gui) with every live knob of the demo: Time & Weather, Post FX,
 * Lighting, Camera, Atmosphere and Render. Controllers `listen()` where the value also changes
 * from gameplay (time, weather, camera).
 * @param {Game} game
 */
export function buildDebugControls(game) {
  const { ui, lighting, postfx, rig, weather, engine } = game;
  const panel = ui.debug;

  // ---- Time & Weather ---------------------------------------------------------------------------
  const tw = panel.addFolder('Time & Weather');
  const timeProxy = {
    get hour() { return lighting.timeOfDay; },
    set hour(v) { weather.setTime(v); },
    get weather() { return weather.weather; },
    set weather(v) { game.setWeather(v); },
  };
  tw.add(timeProxy, 'hour', 0, 24, 0.01).name('time of day').listen();
  tw.add(lighting, 'timeSpeed', 0, 2, 0.01).name('speed (h / s)');
  // listen(): the game pauses the clock on the title screen and resumes it in play
  tw.add(lighting, 'paused').listen();
  tw.add(timeProxy, 'weather', WEATHERS).listen();
  tw.add({ next: () => game.cycleTime() }, 'next').name('next preset (T)');

  // ---- Post FX ----------------------------------------------------------------------------------
  const S = postfx.settings;
  const pf = panel.addFolder('Post FX');
  pf.add(S, 'enabled').name('post-processing');
  const dof = pf.addFolder('Depth of field');
  dof.add(S.dof, 'enabled');
  dof.add(S.dof, 'debug').name('CoC debug view');
  dof.add(S.dof, 'autoFocus');
  dof.add(S.dof, 'focusSpeed', 0.5, 20, 0.1).name('autofocus speed');
  dof.add(S.dof, 'focusDistance', 2, 80, 0.1).listen();
  dof.add(S.dof, 'focusRange', 0.5, 30, 0.1);
  dof.add(S.dof, 'maxBlur', 0, 32, 0.1);
  dof.add(S.dof, 'nearScale', 0, 3, 0.01);
  dof.add(S.dof, 'farScale', 0, 3, 0.01);
  dof.add(S.dof, 'tiltShift', 0, 1, 0.01);
  dof.add(S.dof, 'tiltCenter', 0, 1, 0.01);
  dof.add(S.dof, 'tiltWidth', 0, 1, 0.01);
  dof.add(S.dof, 'tiltFeather', 0.01, 1, 0.01);
  dof.add(S.dof, 'bokehBoost', 0, 4, 0.01);
  dof.add(S.dof, 'bokehThreshold', 0.1, 6, 0.01);
  dof.add(S.dof, 'bokehSprites');
  dof.close();
  const bl = pf.addFolder('Bloom');
  bl.add(S.bloom, 'enabled');
  bl.add(S.bloom, 'strength', 0, 2, 0.01);
  bl.add(S.bloom, 'radius', 0, 1, 0.01);
  bl.add(S.bloom, 'threshold', 0, 3, 0.01);
  bl.add(S.bloom, 'knee', 0, 1, 0.01);
  bl.add(S.bloom, 'warmth', 0, 1, 0.01);
  bl.close();
  const gr = pf.addFolder('Grade');
  gr.add(S.grade, 'enabled');
  gr.add(S.grade, 'exposure', 0.2, 2, 0.01);
  gr.add(S.grade, 'contrast', 0.5, 1.6, 0.01);
  gr.add(weather.tuning, 'gradeSaturation', 0, 2, 0.01).name('saturation');
  gr.add(weather.tuning, 'gradeTemperature', -0.5, 0.5, 0.01).name('temperature');
  gr.add(S.grade, 'tint', -0.5, 0.5, 0.01);
  gr.add(S.grade, 'vignette', 0, 1.5, 0.01);
  gr.add(S.grade, 'vignetteSoftness', 0.05, 1.5, 0.01);
  if ('vignetteRoundness' in S.grade) gr.add(S.grade, 'vignetteRoundness', 0, 1, 0.01);
  gr.add(S.grade, 'grain', 0, 0.2, 0.001);
  // (the cinematic stage's film grain takes fractional sizes; the pixel grain whole pixels)
  gr.add(S.grade, 'grainSize', 1, 4, S.cinematic.enabled ? 0.1 : 1).name('grain size (px)');
  gr.add(S.grade, 'chromaticAberration', 0, 0.01, 0.0001);
  gr.add(S.grade, 'sharpen', 0, 1, 0.01);
  gr.add(S.grade, 'dither', 0, 2, 0.01);
  // split toning + vignette colour are [r, g, b] arrays (tints may be negative)
  const tone = gr.addFolder('Split toning & vignette colour');
  const rgbSliders = (arr, label, min, max) => {
    ['r', 'g', 'b'].forEach((c, i) => {
      const proxy = { get v() { return arr[i]; }, set v(x) { arr[i] = x; } };
      tone.add(proxy, 'v', min, max, 0.005).name(`${label} ${c}`);
    });
  };
  rgbSliders(S.grade.shadowsTint, 'shadows', -0.2, 0.2);
  rgbSliders(S.grade.highlightsTint, 'highlights', -0.2, 0.2);
  if (S.grade.vignetteColor) rgbSliders(S.grade.vignetteColor, 'vignette', 0, 0.3);
  tone.close();
  gr.close();
  // PostFX's cinematic stage (on with `?look=cinematic`, CinematicLook.js; switched on here, its
  // programs compile at its first frame)
  const ci = pf.addFolder('Cinematic');
  ci.add(S.cinematic, 'enabled').name('cinematic stage');
  ci.add(S.cinematic, 'streaks', 0, 4, 0.01);
  ci.add(S.cinematic, 'streakThreshold', 0, 4, 0.01).name('streak threshold');
  ci.add(S.cinematic, 'streakTintMix', 0, 1, 0.01).name('streak tint');
  ci.add(S.cinematic, 'bokehSquash', 1, 3, 0.01).name('oval bokeh');
  ci.add(S.cinematic, 'tealOrange', 0, 1, 0.01).name('orange & teal');
  ci.add(S.cinematic, 'filmCurve', 0, 1, 0.01).name('print curve');
  ci.add(S.cinematic, 'grainChroma', 0, 1, 0.01).name('grain colour');
  ci.close();
  pf.close();

  // ---- Lighting ---------------------------------------------------------------------------------
  const T = weather.tuning;
  const li = panel.addFolder('Lighting');
  li.add(T, 'sunMul', 0, 3, 0.01).name('sun');
  li.add(T, 'ambientMul', 0, 3, 0.01).name('ambient');
  li.add(T, 'fogMul', 0, 4, 0.01).name('fog');
  li.add(T, 'exposureMul', 0.2, 2.5, 0.01).name('exposure');
  li.add(T, 'pointLightMul', 0, 4, 0.01).name('point lights');
  li.add(lighting.settings, 'shadows');
  li.add(lighting.settings, 'flicker').name('lantern flicker');
  li.add(lighting, 'shadowExtent', 10, 40, 0.5).name('shadow extent');
  // (a proxy: a campaign's travel replaces the tile map)
  li.add({ get wallBounce() { return game.tileMap.wallBounce; }, set wallBounce(v) { game.tileMap.wallBounce = v; } }, 'wallBounce', 0, 3, 0.01).name('cliff bounce');
  li.close();

  // ---- Camera -----------------------------------------------------------------------------------
  // In play the pitch is re-aimed every frame (Game._updatePlayCamera: the high-ground pitch while
  // the player stands above `highGround.minY`, else `game.camera.pitch`), so the slider writes the
  // setting in use and `reset` restores the level's value. Both objects belong to the level: a
  // campaign's travel replaces them, and the tweak with them.
  /** @type {WeakMap<object, number>} the level's pitch, per setting object the slider changed */
  const levelPitch = new WeakMap();
  const setPitch = (v) => {
    rig.pitchTarget = v * DEG2RAD;
    const hg = game.highGround;
    if (hg && game.player.position.y > hg.minY) {
      if (!levelPitch.has(hg)) levelPitch.set(hg, hg.pitch);
      hg.pitch = v;
    } else {
      // (game.camera is frozen: replaced)
      const C = game.camera;
      game.camera = Object.freeze({ ...C, pitch: v });
      levelPitch.set(game.camera, levelPitch.get(C) ?? C.pitch);
    }
  };
  const resetPitch = () => {
    const hg = game.highGround;
    if (hg && levelPitch.has(hg)) hg.pitch = levelPitch.get(hg);
    const C = game.camera;
    if (levelPitch.has(C)) game.camera = Object.freeze({ ...C, pitch: levelPitch.get(C) });
  };
  const camProxy = {
    get fov() { return rig.fov; },
    set fov(v) { rig.fov = v; },
    get pitch() { return rig.pitchTarget * RAD2DEG; },
    set pitch(v) { setPitch(v); },
    get distance() { return rig.distanceTarget; },
    set distance(v) { rig.distanceTarget = v; },
    get yaw() { return rig.yawTarget * RAD2DEG; },
    set yaw(v) { rig.yawTarget = v * DEG2RAD; },
  };
  const cam = panel.addFolder('Camera');
  cam.add(camProxy, 'fov', 10, 70, 0.1).listen();
  cam.add(camProxy, 'pitch', 8, 80, 0.1).listen();
  cam.add(camProxy, 'distance', rig.minDistance, rig.maxDistance, 0.1).listen();
  cam.add(camProxy, 'yaw', -180, 180, 0.1).listen();
  cam.add(rig, 'freeYaw').name('free yaw');
  cam.add(rig, 'lookAhead', 0, 3, 0.01);
  cam.add(rig, 'followLambda', 0.5, 15, 0.1).name('follow speed');
  // (game.camera is read at the click: a campaign's travel brings another level's framing)
  cam.add({ reset: () => { resetPitch(); const C = game.camera; rig.setAngles(0, C.pitch); rig.distanceTarget = C.distance; rig.fov = C.fov; } }, 'reset');
  cam.close();

  // ---- Atmosphere -------------------------------------------------------------------------------
  const at = panel.addFolder('Atmosphere');
  at.add(T, 'godRays', 0, 3, 0.01).name('god rays');
  at.add(T, 'dust', 0, 1, 0.01).name('dust motes');
  at.add(T, 'fireflies', 0, 1, 0.01);
  at.add(T, 'leaves', 0, 1, 0.01).name('falling leaves');
  at.add(T, 'petals', 0, 1, 0.01);
  at.add(T, 'smoke', 0, 1, 0.01).name('chimney smoke');
  at.add(T, 'mist', 0, 1, 0.01).name('waterfall mist');
  at.add(T, 'windStrength', 0, 4, 0.01).name('wind');
  at.add(weather, 'snowCover', 0, 1, 0.01).name('snow cover').listen();
  at.close();

  // ---- Render -----------------------------------------------------------------------------------
  const rn = panel.addFolder('Render');
  const renderProxy = {
    get renderScale() { return engine.renderScale; },
    set renderScale(v) {
      // a manual scale overrides the dynamic-resolution governor
      if (game.resolution) game.resolution.manual = true;
      engine.renderScale = v;
    },
    get autoResolution() { return !game.resolution?.manual; },
    set autoResolution(v) { if (game.resolution) game.resolution.manual = !v; },
    showStats: true,
  };
  rn.add(renderProxy, 'renderScale', 0.5, 1, 0.05).name('render scale').listen();
  rn.add(renderProxy, 'autoResolution').name('dynamic resolution').listen();
  rn.add(renderProxy, 'showStats').name('show stats').onChange((v) => { panel.stats.element.style.display = v ? '' : 'none'; });
  rn.add({ photo: () => game.togglePhotoMode() }, 'photo').name('photo mode (P)');
  rn.close();

  // the listening controllers only refresh while the panel is shown (it starts hidden)
  panel.syncListening?.();
  return panel;
}
