/**
 * Straw Dummy (COMBAT.md §7.1, §7.7) — the tutorial target. Passive: never aggroes, never moves or
 * attacks, is never staggered or knocked back (poise and mass ∞), gives no XP or loot. Each hit
 * wobbles it: pose `hurt` 8 f, then `hurt2` 8 f, then the idle animation again. Core refills its HP
 * 120 f after the last hit.
 */

/** @import { Brain } from '../types.js' */

const WOBBLE_F = 8;

/** @typedef {Required<ReturnType<typeof dummy.init>>} DummyAI the brain state (`e.ai`) */

/** @satisfies {Brain} */
export const dummy = {
  init() {
    return { wob: -1 };
  },

  /** Stand; play the wobble after a hit. @type {Brain['idle']} */
  idle(e, h) {
    const ai = /** @type {DummyAI} */ (e.ai);
    if (ai.wob < 0) {
      e.anim('idle');
      return;
    }
    const f = Math.floor(ai.wob * 60 + 1e-6);
    if (f < WOBBLE_F) e.pose('hurt');
    else if (f < WOBBLE_F * 2) e.pose('hurt2');
    else {
      ai.wob = -1;
      e.anim('idle');
      return;
    }
    ai.wob += h;
  },

  /** @type {Brain['engage']} */
  engage(e) {
    e.setState('idle');
  },

  /** @type {Brain['attack']} */
  attack(e) {
    e.setState('idle');
  },

  /** @type {Brain['onHit']} */
  onHit(e) {
    /** @type {DummyAI} */ (e.ai).wob = 0;
    e.pose('hurt');
  },
};
