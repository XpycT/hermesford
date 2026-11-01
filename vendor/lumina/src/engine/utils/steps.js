/**
 * Step generators: the long, pure build functions (the terrain, the merges, the forest scatter, the
 * ground foliage) are written once as generators that `yield` between small pieces of work, so a
 * caller can spread them over many frames (a campaign building its next level ahead of a travel,
 * KNOWN_ISSUES CMP-01; the editor's sliced rebuilds). The synchronous functions run the same
 * generator to its end in one go (`runSteps`): both give the very same result.
 *
 * Node-safe (the level generators import modules that use it).
 */

/**
 * Run a step generator to its end (no pause) and return what it returns.
 * @template T
 * @param {Generator<unknown, T, unknown>} steps
 * @returns {T}
 */
export function runSteps(steps) {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}
