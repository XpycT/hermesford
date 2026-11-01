/**
 * The story's door to the thaw front (docs/contracts/EVERMERE_CAMPAIGN.md §5.6: `thaw`, `wait thaw`):
 * the front running now — the frozen year's runtime's (`game.thaw`, src/game/thaw/LevelStates.js,
 * a chunk of its own, loaded for a level with a frost or states), or on any other level a front
 * that is only its time (nothing there is frozen: `thaw` waits its seconds, `wait thaw` for them).
 * Its own small chunk: LevelStates imports it, StoryRunner fetches it at its first `thaw` / `wait thaw`
 * (a campaign without one never loads it); it imports nothing.
 *
 * @import { Game } from '../Game.js'
 */

/**
 * The running front: its end (a promise) and, for the runtime's, `finish` (to its end state at
 * once) — or null.
 * @type {{ promise: Promise<void>, finish: (() => void)|null }|null}
 */
let front = null;

/**
 * The default length of a front that is only its time (§5.6: by the level's size, ≈ 10–13 s). The
 * runtime's front runs at the contract's speeds instead (≈ 13 s across 120 tiles).
 * @param {{ width: number, depth: number }} level
 */
export function thawSeconds(level) {
  const size = Math.max(level?.width ?? 0, level?.depth ?? 0);
  return 10 + 3 * Math.min(1, Math.max(0, (size - 64) / 56));
}

/**
 * A `thaw` command: a front starts — the runtime's at `at` (default: the level's `frost.at`) over
 * about `seconds` (default: the contract's speeds), else one of its seconds — and the command goes
 * on (`wait thaw` waits). A front still running is finished first. At its end the level's states
 * are applied again (`game.levelStatesChanged`: released if its frost's `until` holds).
 * @param {Game} game
 * @param {{ at?: { x: number, z: number }|null, seconds?: number, wait: (seconds: number) => Promise<void>, run?: { fast?: boolean }|null }} opts
 *   wait: the story's game-time wait (a skip ends it at once); run: the run that started it (a
 *   skipped cutscene finishes the front at once)
 * @returns {Promise<void>} the front's end
 */
export function startThaw(game, { at = null, seconds, wait, run = null }) {
  front?.finish?.();
  /** @type {NonNullable<typeof front>} */
  const mine = { promise: Promise.resolve(), finish: null };
  front = mine;
  const runtime = game.thaw;
  const secs = Number.isFinite(seconds) ? /** @type {number} */ (seconds) : undefined;
  const ran = runtime ? runtime.runFront(game, { at, seconds: secs, run }, mine) : wait(secs ?? thawSeconds(game.level));
  mine.promise = ran.then(() => {
    if (front === mine) front = null;
    game.levelStatesChanged?.();
  });
  return mine.promise;
}

/** Is a front running? */
export function thawRunning() {
  return front !== null;
}

/** The running front's end (resolved at once when none runs): `wait thaw`. @returns {Promise<void>} */
export function whenThawed() {
  return front?.promise ?? Promise.resolve();
}

/** A new level: no front runs any more (the old level's is dropped, not finished). */
export function endThaw() {
  front = null;
}
