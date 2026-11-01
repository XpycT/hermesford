import * as THREE from 'three';

/** @import { Sprite3D } from './Sprite3D.js' */

/**
 * BlobBatch — draws the blob contact shadows of many Sprite3Ds with ONE instanced draw call.
 *
 * `adopt(sprite)` takes over a sprite's own blob: the blob mesh stays in the sprite and keeps being
 * updated by it (position, camera-facing yaw, size, fade) but leaves layer 0, so the camera no
 * longer draws it; every frame `update()` copies each adopted blob's world matrix and opacity into
 * the instance buffers (hidden or faded-out blobs are skipped). The look is the blob's own
 * material — the same colour, texture, polygon offset, render order and fog — with the per-sprite
 * opacity as an instance attribute. Blobs are flat decals that write no depth, so drawing them in
 * one call instead of depth-sorted one by one changes nothing visible.
 *
 * Used by the game on big levels, where a busy view holds dozens of villagers and critters.
 */
export class BlobBatch {
  /** @param {{ capacity?: number }} [opts] capacity: most blobs drawn (extra ones are skipped) */
  constructor({ capacity = 256 } = {}) {
    this.capacity = capacity;
    /** The instanced mesh (created by the first `adopt`; add it to the scene). */
    this.mesh = null;
    /** @type {Sprite3D[]} */
    this.sprites = [];
    this._alpha = null;
  }

  /**
   * Draw this sprite's blob through the batch.
   * @param {Sprite3D} sprite
   * @returns {boolean} whether the sprite has a blob (and was adopted)
   */
  adopt(sprite) {
    const blob = sprite?.blob;
    if (!blob || this.sprites.includes(sprite)) return false;
    if (!this.mesh) this._create(blob);
    blob.layers.disable(0);
    this.sprites.push(sprite);
    return true;
  }

  /** Stop drawing a sprite's blob here (it is drawn by itself again). */
  release(sprite) {
    const i = this.sprites.indexOf(sprite);
    if (i < 0) return false;
    this.sprites.splice(i, 1);
    sprite.blob?.layers.enable(0);
    return true;
  }

  /** Per frame, after the sprites updated (before rendering). */
  update() {
    const mesh = this.mesh;
    if (!mesh) return;
    const alpha = this._alpha.array;
    let n = 0;
    for (let i = 0; i < this.sprites.length && n < this.capacity; i++) {
      const s = this.sprites[i];
      const blob = s.blob;
      if (!blob || !shownInScene(blob)) continue;
      const a = blob.material.opacity;
      if (!(a > 0.001)) continue;
      blob.updateWorldMatrix(true, false);
      mesh.setMatrixAt(n, blob.matrixWorld);
      alpha[n] = a;
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    this._alpha.needsUpdate = true;
  }

  dispose() {
    for (const s of this.sprites) s.blob?.layers.enable(0);
    this.sprites.length = 0;
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh.dispose?.();
      this.mesh = null;
    }
  }

  _create(blob) {
    const src = blob.material;
    const geometry = blob.geometry.clone();
    this._alpha = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    this._alpha.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aBlobAlpha', this._alpha);
    const material = new THREE.MeshBasicMaterial({
      color: src.color.clone(),
      map: src.map,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      polygonOffset: src.polygonOffset,
      polygonOffsetFactor: src.polygonOffsetFactor,
      polygonOffsetUnits: src.polygonOffsetUnits,
      fog: src.fog,
    });
    material.name = 'luminati:blob-batch';
    material.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aBlobAlpha;\nvarying float vBlobAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvBlobAlpha = aBlobAlpha;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vBlobAlpha;')
        .replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\n\tdiffuseColor.a *= vBlobAlpha;');
    };
    material.customProgramCacheKey = () => 'luminati-blob-batch';
    const mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    mesh.name = 'BlobBatch';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.renderOrder = blob.renderOrder;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    // (instances are spread over the whole level: never culled as one sphere)
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    this.mesh = mesh;
  }
}

/** Is the object in a scene with itself and every ancestor visible? */
function shownInScene(o) {
  for (let x = o; x; x = x.parent) {
    if (!x.visible) return false;
    if (x.isScene) return true;
  }
  return false;
}
