// Type-check only (tsconfig.json, `npm run typecheck`); nothing here reaches a bundle.
// Module augmentation for src/engine/core: fields created lazily (`this._x ??= …`) or by another
// module, which the class body cannot declare without a runtime change.
// Also: ExtraActions, the action names a level adds to Input at runtime.
import type * as THREE from 'three';
import './Engine.js';
import './Input.js';

/** Action names a level adds at runtime with `Input.addBindings` (combat: src/game/combat/types.d.ts). */
export interface ExtraActions {}

declare module './Engine.js' {
  interface Engine {
    /** Reused target of the `drawingBufferSize` getter (created on first read). */
    _dbs?: THREE.Vector2;
  }
}

declare module './Input.js' {
  interface Input {
    /** Bound once by the first `enableMouseButtons` (kept for removeEventListener). */
    _onMouseDown?: (e: PointerEvent) => void;
    /** Bound once by the first `enableMouseButtons`: chorded button changes. */
    _onMouseMove?: (e: PointerEvent) => void;
    /** Bound once by the first `enableMouseButtons`: release edge (pointerup / pointercancel). */
    _onMouseUp?: (e: PointerEvent) => void;
    /** Bound once by the first `enableMouseButtons`: suppresses the context menu on the target. */
    _onContextMenu?: (e: Event) => void;
    /** Bound once by the first `enableMouseButtons`: suppresses middle-button autoscroll. */
    _onAuxDown?: (e: MouseEvent) => void;
  }
}
