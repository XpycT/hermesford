/** @import * as THREE from 'three' */

/**
 * SpriteManager — a tiny registry that updates every registered sprite once per frame.
 * Engine-system compatible: `engine.addSystem(spriteManager, order)` works because
 * `update(dt)` ignores the extra `(t, engine)` arguments. Register it AFTER the camera rig has
 * written `globalUniforms.uCameraYaw` for the frame (e.g. as a late system) so billboards match
 * the camera exactly.
 */
export class SpriteManager {
  /** @param {THREE.Camera} camera camera passed to every `sprite.update(dt, camera)` */
  constructor(camera) {
    this.name = 'SpriteManager';
    /** Camera handed to sprites (may be swapped at runtime). */
    this.camera = camera;
    this._sprites = [];
    /** Index of the sprite `update()` is updating (-1 outside it): `remove()` keeps it in step. */
    this._cursor = -1;
  }

  /**
   * Register a sprite (anything with `update(dt, camera)`). Duplicate adds are ignored.
   * @template T
   * @param {T} sprite
   * @returns {T}
   */
  add(sprite) {
    if (sprite && !this._sprites.includes(sprite)) this._sprites.push(sprite);
    return sprite;
  }

  /**
   * Unregister a sprite (does not dispose it). Safe from inside a sprite callback during
   * `update()` (`onAnimationEnd`, `onFrameChange`): the walk over the list stays in step, so no
   * other sprite is skipped that frame, and a removed sprite not yet reached is not updated.
   * @param {object} sprite
   * @returns {boolean} true when it was registered
   */
  remove(sprite) {
    const i = this._sprites.indexOf(sprite);
    if (i < 0) return false;
    this._sprites.splice(i, 1);
    // removed at or before the sprite being updated: the walk's next index moved down by one
    if (i <= this._cursor) this._cursor--;
    return true;
  }

  /** Registered sprites (live array — do not mutate). */
  get sprites() {
    return this._sprites;
  }

  /**
   * Update every registered sprite. Sprites added during the walk (by a callback) are updated in
   * the same frame; sprites removed during it are not (see `remove`).
   * @param {number} dt seconds
   */
  update(dt) {
    const list = this._sprites;
    const cam = this.camera;
    try {
      for (this._cursor = 0; this._cursor < list.length; this._cursor++) list[this._cursor].update(dt, cam);
    } finally {
      this._cursor = -1;
    }
  }

  /**
   * Clear the registry.
   * @param {{ disposeSprites?: boolean }} [opts] also dispose the sprites (default false)
   */
  dispose({ disposeSprites = false } = {}) {
    if (disposeSprites) for (const s of this._sprites.slice()) s.dispose?.();
    this._sprites.length = 0;
  }
}
