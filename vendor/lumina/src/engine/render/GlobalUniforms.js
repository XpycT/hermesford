import * as THREE from 'three';

/** @import { GlobalUniforms } from './types.js' */

/**
 * Uniforms shared by every custom shader in the engine. Materials should reference
 * these objects directly (e.g. `uniforms.uTime = globalUniforms.uTime`) so a single
 * write per frame updates all of them.
 *
 * Writers:
 *  - Engine:          uTime (seconds since start, affected by timeScale)
 *  - CameraRig:       uCameraYaw (radians, billboard orientation), uCameraPosition
 *  - LightingSystem:  uNight (0 = day, 1 = full night), uSunDirection (normalised, points FROM
 *                     the scene TOWARD the sun), uSunColor (linear sun colour × sun intensity ×
 *                     `sunMul` / 3.5: ≈ 1 × the colour at noon (intensity 3.5), ≈ 1.71 × at golden
 *                     hour (6.0), more when the weather raises `sunMul`), uFogColor
 *  - (anyone):        uWind (xz direction * speed), uWindStrength
 *  - the game:        uFogStart ([0] = distance from the camera where the fog starts, [1] unused;
 *                     `setFogStart` in src/game/AtmosphereFog.js, per level). Read only once the
 *                     game's fog-start patch is installed (`uniform vec2 uFogStart` in three's
 *                     fog chunk), by every fogged program: fogged custom shaders reference it as
 *                     `uFogStart`. A Float32Array, not a number: three gives each built-in material
 *                     a copy of its ShaderLib uniforms when it compiles, and that copy keeps a
 *                     typed array by reference (a number would be copied) — one write reaches all.
 * @type {GlobalUniforms}
 */
export const globalUniforms = {
  uTime: { value: 0 },
  uNight: { value: 0 },
  uWind: { value: new THREE.Vector2(1.0, 0.35) },
  uWindStrength: { value: 1.0 },
  uCameraYaw: { value: 0 },
  uCameraPosition: { value: new THREE.Vector3() },
  uSunDirection: { value: new THREE.Vector3(0.4, 0.8, 0.45).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.9, 0.75) },
  uFogColor: { value: new THREE.Color(0.6, 0.65, 0.75) },
  uFogStart: { value: new Float32Array(2) },
};
