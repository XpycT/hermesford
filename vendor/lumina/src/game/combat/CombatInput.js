import { COMBAT_ACTIONS } from './bindings.js';
import { BUFFER, LOCK_HOLD } from './rules.js';

/** @import { Input, ActionName } from '../../engine/core/Input.js' */

/**
 * CombatInput — turns real input (keyboard, mouse buttons) and the test hooks' virtual presses
 * into buffered combat actions (COMBAT.md §4.4, §5.1).
 *
 *  - `collect(dt, resuming)` runs once per active frame, before the sub-steps: every pressed edge
 *    of a combat action enters the 10 f input buffer (with a "mouse-triggered" flag for the aim
 *    rule of §6.9).
 *  - Resume guard (symmetric, no dead time): in the frame combat resumes (map, dialog, photo
 *    closed) every edge is dropped, and an action whose binding is still held is ignored until it
 *    is released — a key pressed as the map closes does not also act, a held J does not
 *    auto-attack.
 *  - Respawn guard: `respawnGuard` seconds after a respawn every edge is dropped.
 *  - `lock` is separate: `lockEvent` is 'press' (edge), 'tap' (released within 0.35 s) or 'hold'
 *    (held 0.35 s) for one frame.
 *  - Virtual input (`press(action, frames)`, `hold(action, frames)`) obeys both guards exactly like
 *    real input; `reset()` clears everything.
 */
export class CombatInput {
  /** @param {Input} input */
  constructor(input) {
    this.input = input;
    /**
     * Buffered presses by action: seconds left (`t`), triggered by a Mouse* code (`mouse`).
     * @type {Record<string, { t: number, mouse: boolean }>}
     */
    this.buffer = {};
    for (const a of COMBAT_ACTIONS) this.buffer[a] = { t: 0, mouse: false };
    /**
     * The virtual input queue (`frames`: held frames left).
     * @type {{ action: string, frames: number, started: boolean }[]}
     */
    this._virtual = [];
    /** @type {Set<string>} actions held at the resume frame, ignored until released */
    this._ignored = new Set();
    /** Seconds of the respawn guard left. */
    this.respawnGuard = 0;
    /** @type {'press'|'tap'|'hold'|null} the lock-on event of this frame */
    this.lockEvent = null;
    this._lockPending = false;
    this._lockT = 0;
    /** @type {Record<string, number>} action → this frame's edge (0 none, 1 key, 2 mouse) */
    this._edges = {};
    for (const a of COMBAT_ACTIONS) this._edges[a] = 0;
  }

  /** Is the resume guard ignoring any held action? */
  get resumeGuard() { return this._ignored.size > 0; }

  /**
   * A test hook's press: one edge now, the action held for `frames` engine frames.
   * @param {string} action
   * @param {number} [frames]
   * @returns {boolean} false: not a combat action
   */
  press(action, frames = 1) {
    if (!COMBAT_ACTIONS.includes(action)) return false;
    this._virtual.push({ action, frames: Math.max(1, frames | 0), started: false });
    return true;
  }

  /**
   * Is `action` held (real binding or virtual), ignoring the guards?
   * @param {string} action
   * @returns {boolean}
   */
  _heldRaw(action) {
    for (let i = 0; i < this._virtual.length; i++) {
      const v = this._virtual[i];
      if (v.action === action && v.frames > 0) return true;
    }
    return this.input.action(/** @type {ActionName} */ (action)); // a COMBAT_ACTIONS name
  }

  /**
   * Is `action` held (and not ignored by the resume guard)?
   * @param {string} action
   * @returns {boolean}
   */
  held(action) {
    return !this._ignored.has(action) && this._heldRaw(action);
  }

  /**
   * The pressed edge of `action` this frame from real input: 0 none, 1 keyboard, 2 mouse.
   * @param {string} action
   * @returns {number}
   */
  _realEdge(action) {
    const input = this.input;
    const kb = input.bindings[action];
    if (kb) {
      for (let i = 0; i < kb.length; i++) {
        const c = kb[i];
        if (input.wasPressed(c)) return c.startsWith('Mouse') ? 2 : 1;
      }
    }
    return 0;
  }

  /**
   * Once per active frame, before the sub-steps.
   * @param {number} dt frame seconds
   * @param {boolean} resuming combat was inactive last frame
   */
  collect(dt, resuming) {
    const edges = this._edges;
    for (let k = 0; k < COMBAT_ACTIONS.length; k++) {
      const a = COMBAT_ACTIONS[k];
      edges[a] = this._realEdge(a);
    }
    // virtual presses: an edge on their first frame
    for (let i = 0; i < this._virtual.length; i++) {
      const v = this._virtual[i];
      if (!v.started) {
        v.started = true;
        if (!edges[v.action]) edges[v.action] = 1;
      }
    }
    if (resuming) {
      // drop this frame's edges; remember what is still held
      for (let k = 0; k < COMBAT_ACTIONS.length; k++) {
        const a = COMBAT_ACTIONS[k];
        edges[a] = 0;
        if (this._heldRaw(a)) this._ignored.add(a);
      }
      this._lockPending = false;
    }
    // resume guard: ignored until released
    if (this._ignored.size) {
      for (const a of this._ignored) {
        if (!this._heldRaw(a)) this._ignored.delete(a);
        else edges[a] = 0;
      }
    }
    if (this.respawnGuard > 0) for (let k = 0; k < COMBAT_ACTIONS.length; k++) edges[COMBAT_ACTIONS[k]] = 0;

    for (let k = 0; k < COMBAT_ACTIONS.length; k++) {
      const a = COMBAT_ACTIONS[k];
      const e = edges[a];
      if (!e) continue;
      if (a === 'lock') continue;
      const b = this.buffer[a];
      b.t = BUFFER;
      b.mouse = e === 2;
    }

    // lock-on: press / tap / hold
    this.lockEvent = null;
    const lockHeld = this.held('lock');
    if (edges.lock) {
      this.lockEvent = 'press';
      this._lockPending = true;
      this._lockT = 0;
    } else if (this._lockPending) {
      if (!lockHeld) {
        this._lockPending = false;
        this.lockEvent = 'tap';
      } else {
        this._lockT += dt;
        if (this._lockT >= LOCK_HOLD - 1e-6) {
          this._lockPending = false;
          this.lockEvent = 'hold';
        }
      }
    }

    // virtual holds count down per frame
    for (let i = this._virtual.length - 1; i >= 0; i--) {
      const v = this._virtual[i];
      v.frames--;
      if (v.frames <= 0) this._virtual.splice(i, 1);
    }
  }

  /**
   * Per sub-step (real seconds): buffered presses expire, the respawn guard runs out.
   * @param {number} h
   */
  tick(h) {
    for (let k = 0; k < COMBAT_ACTIONS.length; k++) {
      const b = this.buffer[COMBAT_ACTIONS[k]];
      if (b.t > 0) b.t = Math.max(0, b.t - h);
    }
    if (this.respawnGuard > 0) this.respawnGuard = Math.max(0, this.respawnGuard - h);
  }

  /**
   * Is `action` waiting in the buffer?
   * @param {string} action
   * @returns {boolean}
   */
  has(action) {
    return this.buffer[action].t > 0;
  }

  /**
   * Consume a buffered action; returns its entry ({ mouse }) or null.
   * @param {string} action
   * @returns {{ t: number, mouse: boolean }|null}
   */
  take(action) {
    const b = this.buffer[action];
    if (!(b.t > 0)) return null;
    b.t = 0;
    return b;
  }

  /** Drop every buffered press (death, respawn, dialogs). */
  clearBuffer() {
    for (let k = 0; k < COMBAT_ACTIONS.length; k++) this.buffer[COMBAT_ACTIONS[k]].t = 0;
  }

  /** Everything back to a fresh state (the `reset()` hook). */
  reset() {
    this.clearBuffer();
    this._virtual.length = 0;
    this._ignored.clear();
    this.respawnGuard = 0;
    this.lockEvent = null;
    this._lockPending = false;
    this._lockT = 0;
  }
}
