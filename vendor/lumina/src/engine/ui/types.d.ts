// Type-check only (tsconfig.json, `npm run typecheck`); nothing here reaches a bundle.
// - Module augmentation for src/engine/ui: fields created lazily (`this._x ??= …`) or by another
//   module, which the class body cannot declare without a runtime change.
// - The story UI's data shapes (Journal.setData, the emote icons, the toast kinds).
import 'lil-gui';

declare module 'lil-gui' {
  interface Controller {
    /**
     * DebugPanel.syncListening: set while the panel is hidden on a controller that was
     * `listen()`ing, so showing the panel again restarts exactly those controllers.
     */
    _luPaused?: boolean;
  }
}

// -------------------------------------------------------------------------------------------------
// Story UI (Journal, Emotes, EndCard; created by UI.useStoryUI)
// -------------------------------------------------------------------------------------------------

/** The journal's tabs. */
export type JournalTab = 'quests' | 'items';

/** An objective of a quest: shown with a box, ticked (and struck through) once `done`. */
export interface JournalGoal {
  text: string;
  done: boolean;
}

/**
 * A quest in the journal. `log`: the texts of the stages reached, latest last (the latest is
 * highlighted). `title` falls back to the id; a missing or unknown `state` is 'active'.
 */
export interface JournalQuest {
  id: string;
  title?: string;
  state?: 'active' | 'done' | 'failed';
  text?: string;
  log?: string[];
  goals?: JournalGoal[];
}

/**
 * An item in the journal. `key`: a key item (its own group first; no count unless > 1). `name`
 * falls back to the id; `count` defaults to 1.
 */
export interface JournalItem {
  id: string;
  name?: string;
  count?: number;
  text?: string;
  key?: boolean;
}

/**
 * `Journal.setData(…)`. Untrusted (built from story files): every field is optional, wrong shapes
 * are dropped, every text is set with `textContent` (`{word}` renders in gold).
 */
export interface JournalData {
  quests?: JournalQuest[];
  items?: JournalItem[];
  /** shown on the Items tab */
  gold?: number;
}

/**
 * The icons `Emotes.show` draws (the values of the story language's `EMOTES`; '...' is taken as
 * '…'). Any other string is drawn as text (at most 4 characters).
 */
export type EmoteIcon = '!' | '?' | '…' | '♪' | '♥' | 'zzz' | '#' | '💧' | '✦';

/** `HUD.toast(text, seconds, { kind })`. */
export type ToastKind = 'quest' | 'item' | 'error';

// -------------------------------------------------------------------------------------------------
// Party UI (PartyPanel, PartyFrames; created by UI.usePartyUI — the contract types are in
// src/game/party/types.d.ts: PartyPanelLike, PartyFramesLike, PartyFrameEntry …)
// -------------------------------------------------------------------------------------------------

/**
 * The tactics panel's sounds (`PartyPanel.onSound`): `menuOpen` / `menuClose` (it opened / closed),
 * `menuMove` (the focus moved to another row or card), `menuSelect` (a change: a value, a preset
 * picked, another member shown). The game maps them to its SFX (AudioSystem: `open`, `close`,
 * `blip`, `confirm`).
 */
export type PartySound = 'menuOpen' | 'menuClose' | 'menuMove' | 'menuSelect';

/**
 * A map marker state's party (`Minimap.update(s)` / `WorldMap.update(dt, s)`): `s.party`, the
 * members' live positions — teal dots with a light rim, over the villagers, under the player's
 * arrow. Absent or empty: the maps draw exactly what they drew before.
 */
export type MapPartyDots = ReadonlyArray<{ x: number; z: number }>;
