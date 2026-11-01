import * as THREE from 'three';
import { damp } from '../../engine/index.js';
import { SOFT_TARGET, LOCK, BOSS_FRAME } from './rules.js';

/**
 * @import { Enemy } from './Enemy.js'
 * @import { CombatSystem } from './CombatSystem.js'
 */

/**
 * Targeting (COMBAT.md §6.9): the aim direction of an action, the soft target (auto-aim / the
 * melee magnet), lock-on and the camera focus while locked or in the boss fight.
 *
 *  - Aim, first match wins: the lock target; the mouse aim point (mouse-triggered action, > 0.8 u
 *    away); the move input (|move| > 0.2); the facing.
 *  - Soft target: alive, targetable enemies within 5 u (Ember Bolt 12 u) and ±75° (bolt ±45°) of
 *    the aim; lowest `dist + 2.5·(1 − dot)` wins.
 *  - Lock-on: candidates are targetable enemies within 14 u inside the view frustum (the cached
 *    view-projection matrix, body middle). Tap unlocked → the candidate minimising
 *    `dist + 6·|ndcX|` (nearest within 14 u when none is on screen); tap locked → the next on-screen
 *    candidate by screen x (after the last: none); hold 0.35 s → release. The target's death moves
 *    the lock to the nearest on-screen target within 8 u; beyond 16 u it releases.
 *  - Camera: locked → `rig.setTarget(lockFocus)`, lockFocus = player + 0.3·clampLen(target −
 *    player, 4) damped λ 6/s. Boss fight (roar to defeat / reset) → bossFocus = player +
 *    0.45·clampLen(boss − player, 6) damped λ 4/s, `rig.minDistance` ≥ 30 and the distance target
 *    ≥ 30, restored afterwards. The yaw is never turned automatically.
 */
export class Targeting {
  /** @param {CombatSystem} sys the CombatSystem */
  constructor(sys) {
    this.sys = sys;
    /** @type {Enemy|null} */
    this.lock = null;
    /** Camera focus vectors owned by combat (rig targets while locked / framing the boss). */
    this.lockFocus = new THREE.Vector3();
    this.bossFocus = new THREE.Vector3();
    /** @type {Enemy|null} the boss being framed (null = off) */
    this.boss = null;
    /** @type {'player'|'lock'|'boss'} what the rig follows */
    this.mode = 'player';
    /** @type {{ min: number, target: number }|null} the rig distances before the boss framing */
    this._saved = null;
    this._lockedByPress = false;
    /** @type {Enemy[]} lock candidates of the last `_gather` */
    this._cands = [];
    this._ndc = { x: 0, y: 0, on: false };
    this._face = { x: 0, z: 1 };
    this._ring = -1;
  }

  // ------------------------------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------------------------------

  /**
   * Project an enemy's body middle with the cached view-projection matrix into `this._ndc`.
   * @param {Enemy} e
   * @returns {boolean} inside the frustum (|x|, |y| ≤ 1, in front)
   */
  project(e) {
    const b = e.def.body;
    const y = this.sys.bodyBase(e) + (b[0] + b[1]) / 2;
    return this.sys.projectNdc(e.position.x, y, e.position.z, this._ndc, 1);
  }

  /**
   * Aim direction at an action's start (§6.9), written into `out` ({x, z} unit).
   * @param {boolean} mouse the action was triggered by a mouse button (or the aim hook)
   * @param {{x:number, z:number}} out
   * @returns {{x:number, z:number}}
   */
  aimDir(mouse, out) {
    const sys = this.sys;
    const p = sys.player.position;
    if (this.lock && this.lock.alive) {
      const dx = this.lock.position.x - p.x;
      const dz = this.lock.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) { out.x = dx / d; out.z = dz / d; return out; }
    }
    // (the aim hook overrides like a mouse pointer for every action)
    if ((mouse || sys.aimOverride) && sys.aimPoint(out)) {
      const dx = out.x - p.x;
      const dz = out.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.8) { out.x = dx / d; out.z = dz / d; return out; }
    }
    const m = sys.moveWorld(out);
    if (m > 0.2) return out;
    out.x = sys.player.facing.x;
    out.z = sys.player.facing.z;
    return out;
  }

  /**
   * The best soft target around the aim direction, or null.
   * @param {number} dirX @param {number} dirZ unit aim
   * @param {boolean} [bolt] Ember Bolt ranges (12 u, ±45°)
   * @returns {Enemy|null}
   */
  soft(dirX, dirZ, bolt = false) {
    const sys = this.sys;
    const p = sys.player.position;
    const range = bolt ? SOFT_TARGET.boltRange : SOFT_TARGET.range;
    const minDot = Math.cos(((bolt ? SOFT_TARGET.boltHalfAngle : SOFT_TARGET.halfAngle) * Math.PI) / 180);
    let best = null;
    let bestScore = Infinity;
    const list = sys.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.targetable) continue;
      const dx = e.position.x - p.x;
      const dz = e.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      const dot = d > 1e-4 ? (dx * dirX + dz * dirZ) / d : 1;
      if (dot < minDot) continue;
      const score = d + 2.5 * (1 - dot);
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  // ------------------------------------------------------------------------------------------
  // Lock-on
  // ------------------------------------------------------------------------------------------

  /**
   * Targetable enemies within `range` of the player that are on screen, into `_cands` (ndcX stored).
   * @param {number} range
   * @returns {Enemy[]}
   */
  _gather(range) {
    const sys = this.sys;
    const p = sys.player.position;
    const out = this._cands;
    out.length = 0;
    const list = sys.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.targetable) continue;
      const d = Math.hypot(e.position.x - p.x, e.position.z - p.z);
      if (d > range) continue;
      if (!this.project(e)) continue;
      e._ndcX = this._ndc.x;
      e._lockDist = d;
      out.push(e);
    }
    return out;
  }

  /**
   * A lock-on input event from CombatInput ('press' | 'tap' | 'hold').
   * @param {'press'|'tap'|'hold'} ev
   */
  onLockEvent(ev) {
    if (ev === 'press') {
      this._lockedByPress = false;
      if (!this.lock) {
        this._lockedByPress = true;
        this._lockFirst();
      }
    } else if (ev === 'tap') {
      if (this.lock && !this._lockedByPress) this._lockNext();
      this._lockedByPress = false;
    } else if (ev === 'hold') {
      this.release();
    }
  }

  _lockFirst() {
    const cands = this._gather(LOCK.range);
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < cands.length; i++) {
      const e = cands[i];
      const s = e._lockDist + 6 * Math.abs(e._ndcX);
      if (s < bestScore) { bestScore = s; best = e; }
    }
    if (!best) {
      // nothing on screen: the nearest within range
      const p = this.sys.player.position;
      for (const e of this.sys.enemies) {
        if (!e.targetable) continue;
        const d = Math.hypot(e.position.x - p.x, e.position.z - p.z);
        if (d <= LOCK.range && d < bestScore) { bestScore = d; best = e; }
      }
    }
    if (best) this._set(best);
  }

  _lockNext() {
    const cands = this._gather(LOCK.range);
    const cur = this.lock;
    const curX = cur && this.project(cur) ? this._ndc.x : -Infinity;
    let next = null;
    for (let i = 0; i < cands.length; i++) {
      const e = cands[i];
      if (e === cur) continue;
      if (e._ndcX > curX && (!next || e._ndcX < next._ndcX)) next = e;
    }
    if (next) this._set(next);
    else this.release();
  }

  /** @param {Enemy} e */
  _set(e) {
    if (this.lock === e) return;
    this.lock = e;
    this.sys.audio?.playSfx?.('confirm', { volume: 0.35, pitch: 1.4 });
  }

  /** Release the lock (teleport, death, map, hold). */
  release() {
    this.lock = null;
    this._lockedByPress = false;
  }

  // ------------------------------------------------------------------------------------------
  // Boss framing
  // ------------------------------------------------------------------------------------------

  /**
   * Frame the boss fight (bossAwake) or stop (null: defeat, death reset).
   * @param {Enemy|null} boss
   */
  setBoss(boss) {
    this.boss = boss;
  }

  // ------------------------------------------------------------------------------------------
  // Per frame
  // ------------------------------------------------------------------------------------------

  /**
   * Keep the lock valid, move the focus vectors, switch the rig's target, write the facing
   * override and the reticle / lock ring.
   * @param {number} dt real seconds
   * @param {boolean} active
   */
  update(dt, active) {
    const sys = this.sys;
    const player = sys.player;
    const p = player.position;
    // lock validity
    const L = this.lock;
    if (L) {
      const d = Math.hypot(L.position.x - p.x, L.position.z - p.z);
      if (!L.targetable) {
        // dead / walking home: the nearest on-screen target within 8 u, else release
        const cands = this._gather(LOCK.retarget);
        let best = null;
        for (let i = 0; i < cands.length; i++) if (cands[i] !== L && (!best || cands[i]._lockDist < best._lockDist)) best = cands[i];
        this.lock = best;
      } else if (d > LOCK.breakAt) this.release();
    }
    const lock = this.lock;

    // rig target
    const rig = sys.rig;
    const want = this.boss ? 'boss' : lock ? 'lock' : 'player';
    if (want !== this.mode) {
      if (this.mode === 'boss' && this._saved) {
        rig.minDistance = this._saved.min;
        rig.distanceTarget = this._saved.target;
        this._saved = null;
      }
      if (want === 'player') rig.setTarget(player.sprite);
      else if (want === 'lock') {
        this.lockFocus.copy(this.mode === 'boss' ? this.bossFocus : p);
        rig.setTarget(this.lockFocus);
      } else {
        this.bossFocus.copy(this.mode === 'lock' ? this.lockFocus : p);
        this._saved = { min: rig.minDistance, target: rig.distanceTarget };
        rig.minDistance = Math.max(rig.minDistance, BOSS_FRAME.minDistance);
        rig.distanceTarget = Math.max(rig.distanceTarget, BOSS_FRAME.minDistance);
        rig.setTarget(this.bossFocus);
      }
      this.mode = want;
    }
    if (this.mode === 'lock' && lock) this._follow(this.lockFocus, lock, LOCK.focusShare, LOCK.focusClamp, LOCK.lambda, dt);
    else if (this.mode === 'boss') this._follow(this.bossFocus, this.boss, BOSS_FRAME.share, BOSS_FRAME.clamp, BOSS_FRAME.lambda, dt);

    // facing override (lock-on strafe)
    if (lock && active && sys.pc.alive) {
      const dx = lock.position.x - p.x;
      const dz = lock.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) {
        this._face.x = dx / d;
        this._face.z = dz / d;
        player.faceOverride = this._face;
      }
    } else player.faceOverride = null;

    // reticle and the lock ring
    const labels = sys.ui.combat?.labels;
    if (lock) {
      labels?.reticle(lock.position, sys.labelY(lock) * 0.55);
      if (this._ring < 0) this._ring = sys.markerAllocCore();
      if (this._ring >= 0) {
        const s = sys._markerSpec;
        s.shape = 'ring';
        s.x = lock.position.x;
        s.z = lock.position.z;
        s.r = lock.radius + 0.45;
        s.rInner = lock.radius + 0.28;
        s.progress = 1;
        s.style = 'lock';
        s.alpha = 1;
        sys.markerSetCore(this._ring, s);
      }
    } else {
      labels?.reticle(null);
      if (this._ring >= 0) {
        sys.markerFreeCore(this._ring);
        this._ring = -1;
      }
    }
  }

  /**
   * focus → player + share·clampLen(target − player, clampTo), damped (y follows the player).
   * @param {THREE.Vector3} focus
   * @param {Enemy|null} target
   * @param {number} share
   * @param {number} clampTo
   * @param {number} lambda
   * @param {number} dt
   */
  _follow(focus, target, share, clampTo, lambda, dt) {
    const p = this.sys.player.position;
    let dx = 0;
    let dz = 0;
    if (target) {
      dx = target.position.x - p.x;
      dz = target.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > clampTo) { dx *= clampTo / d; dz *= clampTo / d; }
    }
    const k = damp(lambda, dt);
    focus.x += (p.x + share * dx - focus.x) * k;
    focus.z += (p.z + share * dz - focus.z) * k;
    focus.y = p.y;
  }

  /** Snap the focus vectors to the player (teleport, respawn). */
  snap() {
    this.lockFocus.copy(this.sys.player.position);
    this.bossFocus.copy(this.sys.player.position);
  }

  /** Back to following the player sprite (reset / dispose). */
  reset() {
    this.release();
    this.boss = null;
    this.update(0, false);
  }
}
