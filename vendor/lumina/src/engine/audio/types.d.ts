// Type-check only (tsconfig.json, `npm run typecheck`); nothing here reaches a bundle.
// Module augmentation for src/engine/audio: fields created lazily (`this._x ??= …`) or by another
// module, which the class body cannot declare without a runtime change.
import './AudioSystem.js';

declare module './AudioSystem.js' {
  interface AudioSystem {
    /** SFX names already warned about as unknown (created on the first unknown name). */
    _warnedSfx?: Set<string>;
    /** Evermere's pack RNG on this system (EvermereAudio.js: variants, jitter, its layers' scheduling). */
    _evrng?: () => number;
    /** When each Evermere sound last played (EvermereAudio.js `playSfx`: its recipe's `gap`). */
    _evLast?: Record<string, number>;
    /** The next crow's call over the fields (EvermereAudio.js `scheduleLayers`, `params.crows`). */
    _evCrows?: number;
  }
}
