// Type-check only (tsconfig.json, `npm run typecheck`); nothing here reaches a bundle.
// Module augmentation for src/game: fields created lazily (`this._x ??= …`) or by another module
// (e.g. `npc.talk = …` in Game.js), which the class body cannot declare without a runtime change.

import type * as THREE from 'three';
import type { Collider } from '../engine/world/TileMap.js';
import type { Conversation } from './dialogue.js';
import type { PartyInfo } from './party/types.js';
import './Critters.js';
import './Game.js';
import './Npc.js';
import './World.js';

declare module './Npc.js' {
  interface Npc {
    /**
     * The villager's conversation, set by `Game.init` right after construction
     * (`conversationFor(obj)`, dialogue.js).
     */
    talk?: Conversation;
    /**
     * Campaigns: the story flag the villager sets when a conversation ends (its level object's
     * `flag`), set by `Game._buildLevel` ('' = none).
     */
    storyFlag?: string;
    /** 'chase' villagers: reused list of the chickens near their patch (lazy). */
    _near?: { position: THREE.Vector3 }[];
  }
}

declare module '../engine/core/types.js' {
  /** The story journal's key (`Game._createStory`: `input.addBindings({ journal: ['KeyB'] })`). */
  interface ExtraActions {
    journal: true;
    /** The party's tactics panel (`Game.ensureParty`: `input.addBindings({ party: ['KeyG'] })`). */
    party: true;
  }
}

declare module './Critters.js' {
  interface Critters {
    /** Far-critter throttle: seconds accumulated per critter since its last update (lazy). */
    _acc?: Float32Array;
  }
}

declare module './Game.js' {
  interface Game {
    /** The view World.update ranks the light pool with: the camera focus and camera (lazy). */
    _worldView?: { focus: THREE.Vector3; camera: THREE.Camera };
    /** The villagers' sprite sheets by preset, released with the level (`_buildLevel`). */
    _npcSheets?: Map<string, { dispose?: () => void }>;
    /** The actors' warm-fill registrations, released with the level (`_buildLevel`). */
    _actorEmissives?: { dispose: () => void }[];
    /** `ensureParty`'s load in progress (the party's chunk and UI). */
    _partyLoad?: Promise<import('./party/Party.js').Party>;
  }
}

declare module './party/types.js' {
  interface PartyPanelLike {
    /**
     * The member shown (PartyPanel's getter, PARTY.md §11 UI-6; '' before the first open): a
     * change of the party while the panel is open reopens it on that member (`Party._changed`).
     */
    readonly memberId?: string;
  }

  /** The party core's additions to `window.__game.party` (docs/specs/AUTOMATION_API.md §3.8). */
  interface PartyHooks {
    /**
     * The follow as the tests read it (`Party.trailInfo`): the trail (newest first), each member's
     * place, trail point, distance from it, mode and gait; the totals → null without a party.
     */
    trail(who?: string, max?: number): ReturnType<import('./party/Party.js').Party['trailInfo']> | null;
    /** `Game.syncParty()`: the party brought in line with the story's records → `info()` or null. */
    sync(): Promise<PartyInfo | null>;
  }
}

declare global {
  interface Window {
    /** The party core's check helpers (sandbox/party_follow.js; `party.follow*.json`). */
    PF?: typeof import('../../sandbox/party_follow.js').default;
  }
}

declare module './World.js' {
  interface World {
    /** Materials already registered as emissive (each once; lazy). */
    _emissiveSet?: Set<THREE.Material>;
    /** Reused collider query list of `_isFreeForFoliage` (lazy). */
    _freeTmp?: Collider[];
  }
}
