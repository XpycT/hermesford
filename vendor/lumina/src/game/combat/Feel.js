import { clamp, lerp } from '../../engine/index.js';
import { F } from './rules.js';

/** @import { PostFX } from '../../engine/render/PostFX.js' */

/**
 * Feedback tables (COMBAT.md §11.4): hit-stop frames, camera shakes, hit flashes and the combat
 * look — the grade / DOF offsets `CombatLook` writes on top of a baseline every frame.
 */

/**
 * Hit-stop in frames (§11.4). A player hit's stop is min(cap, base + crit + kill). `melee`,
 * `finisher` and `skill` are the §11.4 table for reference: the move tables of rules.js (`COMBO[i]`,
 * `WHIRL`, `BOLT`, `NOVA` `.hitStop`) carry the values core uses.
 */
export const HIT_STOP = Object.freeze({
  melee: 4, finisher: 7, skill: 3, crit: 2, kill: 4, boss: 5, cap: 10,
  playerHurt: 6, bossPhase: 12, bossDeath: 12, guard: 2,
});

/**
 * Hit-stop (seconds) of a hit the player landed.
 * @param {number} base frames (melee 4, A3 7, skills 3, boss 5)
 * @param {boolean} crit
 * @param {boolean} kill
 * @param {boolean} boss boss hits get no kill bonus
 */
export function playerHitStop(base, crit, kill, boss) {
  const f = base + (crit ? HIT_STOP.crit : 0) + (kill && !boss ? HIT_STOP.kill : 0);
  return F(Math.min(HIT_STOP.cap, f));
}

/**
 * Camera shakes `[amplitude u, duration s]` (§11.4). Dodges shake nothing. `wallStun`, `bossSlam`,
 * `bossRoar` and `bossIntro` are brain-owned (§8.1): the boar and golem brains request the same
 * values through `ctx.shake` (brains see only the CombatContext), listed here for reference.
 */
export const SHAKE = Object.freeze({
  hit: [0.05, 0.12], crit: [0.12, 0.2], finisher: [0.08, 0.15], hurt: [0.15, 0.25], knockdown: [0.25, 0.35],
  nova: [0.2, 0.3], wallStun: [0.3, 0.4], bossSlam: [0.45, 0.5], bossRoar: [0.45, 1.2], bossIntro: [0.25, 0.6],
  bossDeath: [0.5, 0.8], kill: [0.08, 0.16],
});

/** Enemy hit flash: (2.2, 2.2, 2.2) a 0.85 for 2 f then a 0.4 for 2 f — core sets `e.hitFlash`. */
export const ENEMY_FLASH_TIME = F(4);
/** Player hurt flash: (2.0, 0.35, 0.3) a 0.7 for 3 f. */
export const PLAYER_FLASH = Object.freeze({ r: 2.0, g: 0.35, b: 0.3, a: 0.7, time: F(3) });
/** Player i-frame blink (mesh.visible) frequency, Hz. */
export const BLINK_HZ = 15;

/**
 * Look targets and pulse lengths (§11.4). The vignette pulses go at least `hurtLift` / `lowLift`
 * above the baseline: a baseline that already reaches the targets (the cinematic look's 0.85,
 * `?look=cinematic`) still deepens on a hit and beats at low HP.
 */
const LOOK = {
  engagedEase: 0.8, focusRange: 8.5, tiltShift: 0.30, tiltWidth: 0.40,
  hurtTime: 0.35, hurtVignette: 0.85, hurtLift: 0.3, hurtColor: [0.62, 0.07, 0.04],
  lowVignette: 0.7, lowLift: 0.15, lowSaturation: -0.25,
  perfectTime: 0.6, perfectSaturation: -0.35, ca: 0.004,
  phaseTime: 1.0, deathTime: 1.0,
  // the cinematic look's lens streaks in a fight: × this of their baseline (2.2 → 0.77), eased like
  // the engaged DOF — full-width lines from every brazier and blaze crossed the party frames, the
  // boss bar and the telegraphs (COMBAT.md §29 V17); only while the cinematic stage is on
  streaksEngaged: 0.35,
};

/** Scalar post settings the look writes as baseline + offset: [group, key, base key]. */
const LOOK_FIELDS = [
  ['dof', 'focusRange', 'focusRange'], ['dof', 'tiltShift', 'tiltShift'], ['dof', 'tiltWidth', 'tiltWidth'],
  ['grade', 'vignette', 'vignette'], ['grade', 'chromaticAberration', 'ca'], ['grade', 'exposure', 'exposure'],
  ['cinematic', 'streaks', 'streaks'],
];

/**
 * The combat look. At construction it copies the post settings it touches (the baseline); every
 * frame `apply()` writes baseline + offsets (never accumulating). `grade.saturation` is rewritten
 * by Weather every frame, so its offset is added to the current value (apply runs after
 * `weather.update`). `renderer.toneMappingExposure` and the lighting multipliers are never touched.
 * A value that differs from what the look wrote last frame was changed by someone else (the debug
 * panel's sliders, a tuning pass) and becomes the new baseline, so those controls keep working on
 * combat levels.
 */
export class CombatLook {
  /** @param {PostFX} postfx */
  constructor(postfx) {
    this.settings = postfx.settings;
    const s = this.settings;
    this.base = {
      focusRange: s.dof.focusRange,
      tiltShift: s.dof.tiltShift,
      tiltWidth: s.dof.tiltWidth,
      vignette: s.grade.vignette,
      vignetteColor: Array.isArray(s.grade.vignetteColor) ? [...s.grade.vignetteColor] : [0.05, 0.025, 0.04],
      ca: s.grade.chromaticAberration ?? 0,
      exposure: s.grade.exposure,
      streaks: s.cinematic?.streaks ?? 0,
    };
    this._color = [...this.base.vignetteColor];
    /** What apply() wrote last (NaN: nothing yet), per LOOK_FIELDS entry, and the vignette colour. */
    this._wrote = LOOK_FIELDS.map(() => NaN);
    this._wroteColor = [NaN, NaN, NaN];
    this.reset();
  }

  /** Adopt values changed by someone else since the last apply() as the new baseline. */
  _rebase() {
    const S = this.settings;
    const B = this.base;
    for (let i = 0; i < LOOK_FIELDS.length; i++) {
      const [g, k, b] = LOOK_FIELDS[i];
      const v = S[g][k] ?? 0;
      if (!Number.isNaN(this._wrote[i]) && v !== this._wrote[i]) B[b] = v;
    }
    const c = S.grade.vignetteColor;
    if (Array.isArray(c)) {
      const W = this._wroteColor;
      if (c !== this._color || c[0] !== W[0] || c[1] !== W[1] || c[2] !== W[2]) {
        if (!Number.isNaN(W[0])) for (let i = 0; i < 3; i++) B.vignetteColor[i] = c[i];
      }
    }
  }

  /** Remember what apply() wrote (see _rebase). */
  _remember() {
    const S = this.settings;
    for (let i = 0; i < LOOK_FIELDS.length; i++) {
      const [g, k] = LOOK_FIELDS[i];
      this._wrote[i] = S[g][k] ?? 0;
    }
    const c = this._color;
    this._wroteColor[0] = c[0];
    this._wroteColor[1] = c[1];
    this._wroteColor[2] = c[2];
  }

  /** Clear every offset and pulse (reset hook, respawn). */
  reset() {
    this.engaged = 0;
    this.hurt = 0;
    this.perfect = 0;
    this.phase = 0;
    this.death = 0;
    this.dying = false;
    this._pulse = 0;
  }

  /** Player hurt: vignette pulse toward red (0.35 s). */
  pulseHurt() { this.hurt = LOOK.hurtTime; }
  /** Perfect dodge: desaturation + chromatic aberration (0.6 s). */
  pulsePerfect() { this.perfect = LOOK.perfectTime; }
  /** Boss phase change: chromatic aberration pulse (1 s). */
  pulsePhase() { this.phase = LOOK.phaseTime; }
  /** Player death: saturation → −1 over 1 s (held until `reset`). */
  startDeath() { this.dying = true; }

  /**
   * Write the look for this frame.
   * @param {number} dt real seconds (0 while combat is paused: pulses hold)
   * @param {boolean} engaged
   * @param {boolean} lowHp HP < 25 %
   */
  apply(dt, engaged, lowHp) {
    const k = dt / LOOK.engagedEase;
    this.engaged = clamp(this.engaged + (engaged ? k : -k), 0, 1);
    this.hurt = Math.max(0, this.hurt - dt);
    this.perfect = Math.max(0, this.perfect - dt);
    this.phase = Math.max(0, this.phase - dt);
    if (this.dying) this.death = Math.min(1, this.death + dt / LOOK.deathTime);
    this._pulse = (this._pulse + dt) % 1;

    this._rebase();
    const S = this.settings;
    const B = this.base;
    const e = this.engaged * this.engaged * (3 - 2 * this.engaged);
    S.dof.focusRange = lerp(B.focusRange, LOOK.focusRange, e);
    S.dof.tiltShift = lerp(B.tiltShift, LOOK.tiltShift, e);
    S.dof.tiltWidth = lerp(B.tiltWidth, LOOK.tiltWidth, e);
    // (the diorama's settings are never touched: only the cinematic stage has streaks)
    if (S.cinematic?.enabled) S.cinematic.streaks = lerp(B.streaks, B.streaks * LOOK.streaksEngaged, e);

    const hurtK = this.hurt / LOOK.hurtTime;
    const beat = 0.5 + 0.5 * Math.cos(this._pulse * Math.PI * 2);
    let vig = B.vignette;
    const lowVig = Math.max(LOOK.lowVignette, B.vignette + LOOK.lowLift);
    const hurtVig = Math.max(LOOK.hurtVignette, B.vignette + LOOK.hurtLift);
    if (lowHp) vig = Math.max(vig, lerp(B.vignette, lowVig, 0.55 + 0.45 * beat));
    vig = lerp(vig, hurtVig, hurtK);
    S.grade.vignette = vig;
    const redK = Math.max(hurtK, lowHp ? 0.35 * beat : 0);
    const c = this._color;
    for (let i = 0; i < 3; i++) c[i] = lerp(B.vignetteColor[i], LOOK.hurtColor[i], redK);
    S.grade.vignetteColor = c;

    const perfK = this.perfect / LOOK.perfectTime;
    const phaseK = this.phase / LOOK.phaseTime;
    S.grade.chromaticAberration = B.ca + LOOK.ca * Math.max(perfK, phaseK);
    S.grade.exposure = B.exposure;
    // saturation: Weather rewrote it this frame; add the offsets on top
    const sat = (lowHp ? LOOK.lowSaturation : 0) + LOOK.perfectSaturation * perfK - this.death;
    S.grade.saturation += Math.max(-1, sat);
    this._remember();
  }

  /** Put the baseline back (dispose). */
  restore() {
    const S = this.settings;
    const B = this.base;
    S.dof.focusRange = B.focusRange;
    S.dof.tiltShift = B.tiltShift;
    S.dof.tiltWidth = B.tiltWidth;
    S.grade.vignette = B.vignette;
    S.grade.vignetteColor = [...B.vignetteColor];
    S.grade.chromaticAberration = B.ca;
    S.grade.exposure = B.exposure;
    if (S.cinematic?.enabled) S.cinematic.streaks = B.streaks;
  }
}
