// Type-check only (tsconfig.json, `npm run typecheck`); nothing here reaches a bundle.
// Types of src/engine/render that a JSDoc @typedef states less well: the shared uniforms, and the
// scene-graph node shapes the engine, the game, the editor and the sandboxes read.
import type * as THREE from 'three';

/** The uniforms every custom shader shares (GlobalUniforms.js; its header lists the writers). */
export interface GlobalUniforms {
  uTime: THREE.IUniform<number>;
  uNight: THREE.IUniform<number>;
  uWind: THREE.IUniform<THREE.Vector2>;
  uWindStrength: THREE.IUniform<number>;
  uCameraYaw: THREE.IUniform<number>;
  uCameraPosition: THREE.IUniform<THREE.Vector3>;
  uSunDirection: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uFogColor: THREE.IUniform<THREE.Color>;
  /** [0]: where the fog starts (world units from the camera), [1] unused — GlobalUniforms.js says why. */
  uFogStart: THREE.IUniform<Float32Array>;
}

/** A mesh with one material (terrain chunks, merged batches, shadow proxies, prop meshes). */
export type SolidMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

/** A material as `traverse()` callbacks see it: any Material, with the type flag they test. */
export type SceneMaterial = THREE.Material & { isShaderMaterial?: boolean };

/**
 * A scene-graph node as `traverse()` callbacks see it: any Object3D, with the three.js type flags
 * they test and the members they read after the test (`o.isMesh && o.material`,
 * `o.geometry?.dispose()`, a light's `shadow`, an InstancedMesh's `dispose()`).
 */
export type SceneNode = THREE.Object3D & {
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  isInstancedMesh?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
  isLight?: boolean;
  geometry?: THREE.BufferGeometry;
  material?: SceneMaterial | SceneMaterial[];
  shadow?: THREE.LightShadow;
  dispose?: () => void;
};
