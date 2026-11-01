// Type-check only (tsconfig.json, `npm run typecheck`); nothing here reaches a bundle.
// Module augmentation for the frozen year (src/game/thaw/*, EVERMERE_CAMPAIGN.md §6.1): fields the
// thaw package sets on World from outside its class body.

import '../World.js';

declare module '../World.js' {
  interface World {
    /**
     * A frozen level's walkable ice (`environment.frost.ice`; ThawKit `prepareWorld`): its pieces
     * (walk surfaces on the water, each there or not), the test object whose presence is "frozen as
     * the story stands" (`{ unless: frost.until }`), and the thaw's own test once the level is the
     * running one (LevelStates: frozen until the thaw has passed the piece's farthest corner).
     * `applyStory` lays and lifts the pieces.
     */
    thawIce?: {
      chunks: import('./ThawKit.js').IceChunk[];
      test: import('../../engine/level/types.js').LevelObject;
      at: ((c: import('./ThawKit.js').IceChunk) => boolean) | null;
    };
    /**
     * While a thaw front stages the frost's changes (LevelStates): may a live story group that
     * changed switch now? (`applyStory`: not before the front reaches it.) null otherwise.
     */
    thawGate?: ((group: any) => boolean) | null;
    /** The names the level's frost `until` reads (`_frostCell`, made once). */
    _frostNames?: Set<string>;
  }
}
