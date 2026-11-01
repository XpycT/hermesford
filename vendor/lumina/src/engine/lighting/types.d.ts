// Type-check only (tsconfig.json, `npm run typecheck`); nothing here reaches a bundle.
// Module augmentation for src/engine/lighting: fields created lazily (`this._x ??= …`) or by
// another module, which the class body cannot declare without a runtime change.
import './LightingSystem.js';

declare module './LightingSystem.js' {
  interface LightingSystem {
    /** The shadow camera's default near / far / bias, saved by the first `setShadowDepthRange`. */
    _shadowBase?: { near: number; far: number; bias: number };
  }
}
