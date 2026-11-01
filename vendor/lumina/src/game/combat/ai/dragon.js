/**
 * Vorthrax, the Ashen Tyrant — the dragon boss of Vanquish the Evil Dragon
 * (docs/contracts/DRAGON_CAMPAIGN.md §6.6). Like the golem's (COMBAT.md §8) this brain drives every
 * state itself (`update`); the Enemy supplies timers, markers, hazards and movement; core owns the
 * arena, the bar, the hit-stop, the music and the HP clamps (`e.hpFloor`).
 *
 * **Frames.** The sheet is laid out in strips (src/engine/pixel/monsters/dragon.js: the side view
 * facing left / right, a front view for the poses a dragon shows facing the camera); the brain shows
 * every frame itself through `sheet.cell(name, dir)` and `sprite.setFrame` (`show`): the front view
 * while the sprite's direction is `down` and the pose has one, else the side its facing points to on
 * screen. Idle breathes at 3.5 fps, the walk follows the distance walked, the wings beat at 9 fps.
 *
 * **States.** `dormant` (in the sky: not drawn, guarded) → `intro` (270 f: the descent out of the
 * sky with its shadow under it, touchdown, the impact crouch, the roar; `bossIntro` at f0,
 * `bossAwake` at the roar) → `engage` (turns toward the player, walks in, picks moves: 45–75 f
 * between moves, phase 2 36–60, phase 3 24–45) ⇄ `windup` / `active` / `recover`; interrupts
 * `phase` (the transition roar, guarded), `stagger` (Broken: poise per phase spent, 150 f,
 * vuln 1.3, exposed) and `stun` (after the dive's crash: 180 f, vuln 1.5, exposed). `dead`:
 * `die` + `dead` (the throes, the collapse, the ember storm, the fade — core calls `dead` every
 * sub-step of a dead enemy whose brain has one, COMBAT.md §29 V8).
 *
 * **Moves** (wind-ups × 0.8 in phase 3, never below 18 f; every area telegraphed by an enemy
 * marker that fills over the wind-up):
 * - Claw (d ≤ 5.8): 32 f, a sector r 5.6 ±55° ahead; 8 f hit (mv 1.4, kb 2.6); 34 f recover.
 * - Bite (3 ≤ d ≤ 7): 26 f, a circle r 1.9 at the snout 4.6 u ahead (it tracks); 6 f (mv 1.9,
 *   kb 1.6); 40 f recover — the punish window.
 * - Tail sweep (the player behind / beside it for 36 f, or within 6 u): 40 f, a sector r 6.6
 *   ±115° behind; 10 f (mv 1.25, kb 3.6, knockdown); 40 f.
 * - Fire breath (d ≤ 11): 54 f inhale (the furnace kindles: throat and cracks glow, the area of the
 *   whole sweep marked), then 96 f of flame sweeping ±35° across the locked aim: a flame jet of
 *   particles from the mouth, a narrow sector r 9.5 ±16° hitting every 10 f (mv 0.5, kb 0.8),
 *   four burning ground patches (magma hazards r 1.4, 5 s, 5 per 0.5 s) left along it; 40 f recover.
 * - Wing gust (phase ≥ 2, d ≤ 8): 36 f, a sector r 10 ±38°; 18 f (mv 0.3, kb 5.5) — a dust storm.
 * - Stomp (d ≤ 4.2): 42 f reared up, a circle r 3.4; the slam (mv 1.6, kb 2.8, knockdown), then
 *   1 / 2 / 3 shockwave rings (by phase) 16 f apart to r 11 at 7.5 u/s (mv 1.0, kb 1.8).
 * - Flight (phase ≥ 2; at once after the phase-2 roar, then every 32 s): the take-off (50 f, a
 *   downbeat push), the climb out of sight (60 f; guarded, only its shadow on the ground), circling
 *   the arena while the barrage falls (6 circles in phase 2, 10 in phase 3, r 1.7, each filling
 *   66 f while a fireball falls on it: mv 1.3, kb 1.5), the dive's lane (from the arena's far side
 *   through the player, 3.2 wide, tracking 54 f, locked 18 f), the swoop along it (22 u/s,
 *   armoured, mv 1.7, kb 3, knockdown), the crash at its end (a shockwave ring mv 0.8) — and the
 *   dragon lies **stunned** 180 f (vuln 1.5, exposed), then rises.
 *
 * **Phases** (`def.phases` [0.65, 0.30]): phase 2 — the roar (120 f, guarded, a push ring, three
 * whelps), the glow brighter, the first flight right after; phase 3 (enraged) — the roar, faster
 * (wind-ups × 0.8, walk 3.0 u/s), three rings to the stomp, ten fireballs to the barrage, lava
 * cracking open in the arena (6 magma pools at first, each 12 s; 3 new ones every 15 s — `LAVA`), the glow pulsing.
 *
 * Its randomness is `e.rng` only.
 */
import { globalUniforms } from '../../../engine/render/GlobalUniforms.js';
import { dirPreset } from '../../../engine/fx/presets/dragon.js';
import { DragonShadow } from '../SkyDragon.js';

/**
 * @import { Enemy } from '../Enemy.js'
 * @import { CombatContext, Brain, RectXZ, FxOptions, ProjectileLook } from '../types.js'
 */

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/**
 * The dragon's moves (`ai.move`; `boss.force(move)`; the dragon's part of `BossMove`).
 * @typedef {'claw'|'bite'|'tail'|'breath'|'gust'|'stomp'|'flight'|'rise'} DragonMove
 */

const INTRO = Object.freeze({ total: 270, descend: 140, flare: 110, touch: 150, crouch: 175, rise: 195, roar: 215, high: 16 });
const PHASE_ROAR_F = 120;
const BROKEN_F = 150;
const STUN_F = 180;
const RISE_F = 40;
const GAP_F = [[45, 75], [36, 60], [24, 45]];
/** Turn rates (deg/s) by phase. */
const TURN = [90, 110, 140];
const CLAW = { windup: 32, active: 8, recover: 34, r: 5.6, half: 55, mv: 1.4, kb: 2.6, range: 5.8 };
const BITE = { windup: 26, active: 6, recover: 40, r: 1.9, ahead: 4.6, mv: 1.9, kb: 1.6, near: 3, far: 7 };
const TAIL = { windup: 40, active: 10, recover: 40, r: 6.6, half: 115, mv: 1.25, kb: 3.6, behind: 36 };
const BREATH = { windup: 54, active: 96, recover: 40, r: 9.5, cone: 16, sweep: 35, every: 10, mv: 0.5, kb: 0.8, range: 11, patchEvery: 22, patches: 4, patchR: 1.4, patchDur: 300, patchFlat: 5, patchTick: 30 };
const GUST = { windup: 36, active: 18, recover: 30, r: 10, half: 38, mv: 0.3, kb: 5.5, range: 8 };
const STOMP = { windup: 42, active: 6, recover: 44, r: 3.4, mv: 1.6, kb: 2.8, range: 4.2, every: 16, speed: 7.5, rMax: 11, width: 0.8, ringMv: 1.0, ringKb: 1.8 };
const FLIGHT = {
  takeoff: 50, leap: 24, climb: 60, high: 18, circle: [6, 7], salvo: [0.9, 0.65], balls: [6, 10], ballR: 1.7, fill: 66, ballMv: 1.3, ballKb: 1.5,
  lane: 72, lock: 18, width: 3.2, speed: 22, hitR: 2.2, mv: 1.7, kb: 3, crashMv: 0.8, cooldown: 32, flySpeed: 9,
};
/**
 * The player outside its open arena (`outside`): lobs within `range` u every `every` s (`balls`
 * fireballs, `spread` u apart); given up on after `giveUp` s out of that reach: the climb back into
 * the sky over `climb` f.
 */
const OUTSIDE = Object.freeze({ range: 24, every: 4.5, balls: 3, spread: 2.5, giveUp: 10, climb: 90 });
/** Move cooldowns (f), started when a move begins. */
const COOLDOWN = { claw: 0, bite: 60, tail: 360, breath: 600, gust: 540, stomp: 420, flight: FLIGHT.cooldown * 60 };
const ADD_KIND = 'whelp';
const ADD_LEVEL = 5;
/** Lava cracks of phase 3: how many, how big, how long, renewed every (s). */
const LAVA = { n: 6, renew: 3, every: 15, r: [1.6, 2.2], dur: 12, flat: 6, tick: 30 };
/** The base glow colour of the cracks and eyes. */
const GLOW = [1.0, 0.42, 0.12];
/** The mouth on screen: side view (u along the camera's right, u up), front view (u forward, u up). */
const MOUTH_SIDE = [5.6, 5.0];
const MOUTH_FRONT = [2.2, 4.4];

/**
 * The impacts' frame effects (`ctx.fx` with the frames of src/engine/pixel/fx/dragonFx.js, one quad
 * each of the combat batch; constant options per effect, COMBAT.md §29 V9).
 * @type {Readonly<Record<'blast'|'crash'|'ring'|'quake'|'push'|'embers', FxOptions>>}
 */
const FX = Object.freeze({
  /** A barrage fireball's blast (the sky dragon's look). */
  blast: { mode: 'billboard', lift: 1.1, color: [1.5, 0.72, 0.28], loops: 1, scale: 1.25 },
  /** The crash at the end of the dive. */
  crash: { mode: 'billboard', lift: 1.6, color: [1.5, 0.72, 0.28], loops: 1, scale: 2.1 },
  /** The fire ring round a fireball's blast. */
  ring: { mode: 'flat', lift: 0.06, color: [1.9, 1.1, 0.55], loops: 1, scale: 1.0, grow: 1.2 },
  /** The shockwave of a landing, a slam, the crash: a hot ring flashing outward (0.17 s). */
  quake: { mode: 'flat', lift: 0.06, color: [1.6, 0.95, 0.5], loops: 1, fps: 24, scale: 1.5, grow: 2.6 },
  /** The push of air of a roar, the take-off's downbeat (pale, no fire; 0.2 s). */
  push: { mode: 'flat', lift: 0.08, color: [1.0, 0.9, 0.78], loops: 1, fps: 20, scale: 1.3, grow: 3.0 },
  /** Embers dying on the ground where a fireball fell. */
  embers: { mode: 'flat', lift: 0.045, color: [2.0, 0.75, 0.22], loops: 3, fps: 3, scale: 1.1 },
});

/**
 * A barrage fireball in flight (`ProjectileSpec.look`, COMBAT.md §29 V10): the sky dragon's
 * fireball, head down, its fire trail; the circle under it hits, the landing plays `FX` itself.
 * @type {ProjectileLook}
 */
const BALL_LOOK = Object.freeze({
  frame: 'dragonFireball', mode: 'billboard', color: [1.8, 0.8, 0.26], scale: 1.6, rot: -Math.PI / 2, fps: 14,
  trail: 'dragonTrail', trailEvery: 0.03, trailCount: 2, fadeBurst: 'dragonSmoke', fadeCount: 3,
});

/** Each boss's shadow (made once per enemy, freed when its sprite leaves the scene). @type {WeakMap<Enemy, DragonShadow>} */
const SHADOWS = new WeakMap();

/**
 * The dragon's shadow on the ground (its flight: the descent, the air phase).
 * @param {Enemy} e
 * @returns {DragonShadow}
 */
function shadowOf(e) {
  let s = SHADOWS.get(e);
  if (s) return s;
  // a child of the sprite: in the scene from load on (its program compiles with the level), hidden
  // with it; released with it (CombatSystem.dispose disposes the sprite, which leaves the scene)
  s = new DragonShadow(e.sprite);
  const shadow = s;
  e.sprite.addEventListener('removed', () => {
    shadow.dispose();
    SHADOWS.delete(e);
  });
  SHADOWS.set(e, s);
  return s;
}

/**
 * The brain state (`e.ai`): made at construction and at every reset — the dragon is back in the
 * sky (not drawn, full size again).
 * @param {Enemy} e
 */
function initAI(e) {
  shadowOf(e);
  e.sprite.opacity = 0;
  e.radius = e.def.radius;
  return {
    own: false, col: -1, row: -1, side: /** @type {'left'|'right'} */ ('left'),
    clock: 0, phaseT: 0, walk: 0, stepFr: -1,
    move: /** @type {DragonMove|null} */ (null), last1: /** @type {DragonMove|null} */ (null), last2: /** @type {DragonMove|null} */ (null),
    gap: F(50), stall: 0, offT: 0,
    cd: { claw: 0, bite: 0, tail: 0, breath: 0, gust: 0, stomp: 0, flight: 0, rise: 0 },
    forced: /** @type {DragonMove|null} */ (null),
    flyNext: false,
    tag: 0, cx: 0, cz: 0, ax: 0, az: 1, sweep: 1, ticks: 0, patches: 0, charge: 0, rings: 0,
    trans: 0, awoke: false, landed: false,
    // the air phase
    stage: /** @type {'up'|'circle'|'lane'|'swoop'} */ ('up'), st: 0, ang: 0, salvoT: 0, balls: 0, falls: /** @type {{ t: number, x: number, z: number }[]} */ ([]),
    lx0: 0, lz0: 0, lx1: 0, lz1: 1, llen: 1, done: 0,
    // the shadow
    sx: e.position.x, sz: e.position.z, sh: 0, sa: 0, sscale: 1,
    // phase 3
    lavaT: 0, spitT: 0, lava: /** @type {{ x: number, z: number, t: number }[]} */ ([]),
    adds: /** @type {Enemy[]} */ ([]), wave2: false,
    // the player outside its open arena: lobs at, time far away, the climb back into the sky
    lobT: 0, awayT: 0, ascend: 0,
    // death
    dieT: 0, dieFx: 0,
    // one-shot cues of the states (flags: a sub-step under slow motion repeats a frame index)
    roared: false, leapt: false, beatT: 0,
    inset: /** @type {RectXZ|null} */ (null),
  };
}

/**
 * The brain state (`e.ai`).
 * @typedef {ReturnType<typeof initAI>} DragonAI
 */

/**
 * The dragon's brain. Its `dead` plays the death's look after `die`, every sub-step (the ambient
 * step too) until the heap has faded, and returns true: it fades the sprite itself (§29 V8).
 * @type {Brain}
 */
export const dragon = {
  init: initAI,

  /** @type {Brain['update']} */
  update(e, h, ctx) {
    const ai = /** @type {DragonAI} */ (e.ai);
    if (!ai.own) {
      // take the frames over (Enemy.pose shows a laid-out sheet's poses in the wrong row)
      ai.own = true;
      e.anim('idle');
      ai.col = -1;
    }
    ai.clock += h;
    ai.phaseT += h;
    for (const k in ai.cd) if (ai.cd[k] > 0) ai.cd[k] -= h;
    const phases = e.def.phases ?? [0.65, 0.3];
    const fighting = e.state !== 'dormant' && e.state !== 'intro';
    if (fighting && e.state !== 'phase' && !inAir(e)) {
      if (e.phase === 1 && e.hp <= e.hpMax * phases[0] + EPS) startPhase(e, 2, ctx);
      else if (e.phase === 2 && e.hp <= e.hpMax * phases[1] + EPS) startPhase(e, 3, ctx);
    }
    for (let n = 0; n < 4; n++) {
      const k = e.serial;
      step(e, h, ctx);
      if (e.serial === k) break;
    }
    if (e.phase === 3 && fighting) lava(e, h, ctx);
    e.hpFloor = e.phase === 1 ? e.hpMax * phases[0] : e.phase === 2 ? e.hpMax * phases[1] : 0;
    drawShadow(e, ctx);
  },

  /** Boss poise: spent by hits outside the transitions and the air → Broken. @type {Brain['onHit']} */
  onHit(e, info, ctx) {
    if (info.guarded || e.guarded || e.armored || inAir(e)) return;
    const s = e.state;
    if (s !== 'engage' && s !== 'windup' && s !== 'active' && s !== 'recover') return;
    e.poise -= info.poise || 0;
    if (e.poise > 0) return;
    cancelMove(e, ctx);
    e.poise = 0;
    e.vuln = 1.3;
    e.exposed = true;
    e.setState('stagger');
    ctx.sfx('stun', e.position.x, e.position.z);
    ctx.shake(0.3, 0.4);
  },

  /** @type {Brain['cancel']} */
  cancel(e, ctx) {
    cancelMove(e, ctx);
  },

  /** The death begins (the throes; `dead` plays them). @type {Brain['die']} */
  die(e, ctx) {
    const ai = /** @type {DragonAI} */ (e.ai);
    ai.move = null;
    ai.dieT = 0;
    ai.dieFx = 0;
    ai.sa = 0;
    ai.ascend = 0;
    // (killed in the air: its ground shadow goes with it — `update`, which draws it, no longer runs)
    SHADOWS.get(e)?.hide();
    e.sprite.tint.setRGB(1, 1, 1);
    e.sprite.opacity = 1;
    e.radius = e.def.radius;
    ai.col = -1;
    show(e, 'death0');
    if (ctx) {
      ctx.sfx('roar', e.position.x, e.position.z, { pitch: 0.72, volume: 1 });
      ctx.shake(0.45, 1.2);
    }
  },

  /**
   * The death's look (after `die`): the throes (rearing, 0–0.7 s), the sway, the collapse (a quake
   * and dust at 1.5 s), down, the heap (from 2.8 s); an ember storm from the body until 5 s; the
   * glow dying; the heap fades from 6 s over 2 s. (Called by core every sub-step of a dead boss
   * whose brain has it, the ambient step included; true: the brain fades the sprite itself.)
   * @param {Enemy} e @param {number} h @param {CombatContext} ctx
   * @returns {boolean}
   */
  dead(e, h, ctx) {
    const ai = /** @type {DragonAI} */ (e.ai);
    // (Enemy.die showed its own `dead` pose after `die`: the throes' frame goes up again)
    if (ai.dieT === 0) ai.col = -1;
    ai.dieT += h;
    const t = ai.dieT;
    e.lift = Math.max(0, e.lift - h * 6);
    const name = t < 0.7 ? 'death0' : t < 1.5 ? 'death1' : t < 2.2 ? 'death2' : t < 2.8 ? 'death3' : 'death4';
    const before = ai.col;
    show(e, name);
    const p = e.position;
    if (name === 'death2' && before !== ai.col) {
      ctx.shake(0.7, 0.9);
      ctx.sfx('quake', p.x, p.z);
      dustRing(e, ctx, 2.5, 4);
      ctx.burst('dragonDebris', p.x, p.y + 0.3, p.z, 14);
    }
    if (name === 'death4' && before !== ai.col) ctx.sfx('crash', p.x, p.z, { volume: 0.8 });
    // the ember storm
    ai.dieFx -= h;
    if (t > 0.4 && t < 5 && ai.dieFx <= 0) {
      ai.dieFx = 0.15;
      const a = e.rng.next() * TAU;
      ctx.burst('dragonDeath', p.x + Math.cos(a) * 2, p.y + 1 + e.rng.next() * 2.5, p.z + Math.sin(a) * 1.2, 12);
      if (e.rng.next() < 0.4) ctx.burst('dragonSmoke', p.x + Math.cos(a) * 2.5, p.y + 1.5, p.z, 3);
    }
    if (t > 6) e.sprite.opacity = Math.max(0, 1 - (t - 6) / 2);
    return true;
  },

  /**
   * Test hook `combat.boss.force(move)`: only `move` may be picked next, at once (the others wait
   * 99 s); null: none. Takes the dragon's move names ('claw' … 'flight').
   * @type {Brain['force']}
   */
  force(e, move) {
    const ai = /** @type {DragonAI} */ (e.ai);
    for (const k in ai.cd) ai.cd[k] = k === move ? 0 : 99;
    ai.forced = move && Object.hasOwn(COOLDOWN, move) ? /** @type {DragonMove} */ (move) : null;
    ai.gap = 0;
    ai.stall = 0;
    ai.offT = 0;
  },

  /** Test hook `combat.boss.info()`: the move in progress, its stage in the air. @type {Brain['info']} */
  info(e) {
    const ai = /** @type {DragonAI} */ (e.ai);
    return {
      move: ai.move, pending: null, skid: false, stage: ai.move === 'flight' ? ai.stage : null, lift: +e.lift.toFixed(2),
      lava: ai.lava.length, adds: ai.adds.filter((a) => a.alive).length,
    };
  },

  /** Test hook `bossPhase(n)`: no transition, signals `bossPhase`. @type {Brain['jumpPhase']} */
  jumpPhase(e, n, ctx) {
    const ai = /** @type {DragonAI} */ (e.ai);
    n = Math.max(1, Math.min(3, n | 0));
    cancelMove(e, ctx);
    e.phase = n;
    e.poise = e.poiseMax;
    ai.phaseT = F(60);
    ai.trans = 0;
    tintFor(e);
    if (e.state !== 'dormant' && e.state !== 'intro') {
      e.guarded = false;
      e.setState('engage');
      ai.gap = F(30);
    }
    ctx.emit('bossPhase', e, n);
  },

  /** @type {Brain['glow']} */
  glow(e, out) {
    const ai = /** @type {DragonAI} */ (e.ai);
    let a;
    if (!e.alive) a = Math.max(0, 2.4 * (1 - ai.dieT / 4));
    else if (e.state === 'dormant') a = 0;
    else if (e.state === 'intro') a = 0.3 + 0.9 * Math.min(1, e.t / F(INTRO.roar));
    else if (e.phase === 1) a = 0.8;
    else if (e.phase === 2) a = 0.8 + 0.5 * Math.min(1, ai.phaseT);
    else a = 1.8 + 0.6 * (0.5 - 0.5 * Math.cos(TAU * 2 * ai.clock));
    if (e.alive && ai.move === 'breath') a += 2.6 * ai.charge;
    if (e.alive && (e.state === 'stun' || e.state === 'stagger')) a *= 0.5;
    out[0] = GLOW[0];
    out[1] = GLOW[1];
    out[2] = GLOW[2];
    out[3] = a;
  },
};

// -------------------------------------------------------------------------------------------------
// frames
// -------------------------------------------------------------------------------------------------

/**
 * Show a pose: the front view while the sprite faces the camera and the pose has one, else the side
 * view its facing points to on screen (kept while it faces nearly straight toward or away).
 * @param {Enemy} e
 * @param {string} name
 */
function show(e, name) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const sheet = e.sheet;
  if (!sheet.cell) return;
  const yaw = globalUniforms.uCameraYaw.value;
  const rx = e.facing.x * Math.cos(yaw) - e.facing.z * Math.sin(yaw);
  if (rx > 0.2) ai.side = 'right';
  else if (rx < -0.2) ai.side = 'left';
  const down = sheet.cells?.down;
  const front = e.sprite.direction === 'down' && !!down && Object.hasOwn(down, name);
  const c = sheet.cell(name, front ? 'down' : ai.side);
  if (c.col === ai.col && c.row === ai.row) return;
  ai.col = c.col;
  ai.row = c.row;
  e.sprite.setFrame(c.col, c.row);
}

/** True while the sprite shows its front. @param {Enemy} e */
function facingCamera(e) {
  const down = e.sheet.cells?.down;
  return e.sprite.direction === 'down' && !!down;
}

/** The breathing idle. @param {Enemy} e */
function idle(e) {
  const ai = /** @type {DragonAI} */ (e.ai);
  show(e, `idle${Math.floor(ai.clock * 3.5) % 4}`);
}

/** The wing-beat in the air. @param {Enemy} e @param {number} [fps] */
function hover(e, fps = 9) {
  const ai = /** @type {DragonAI} */ (e.ai);
  show(e, `hover${Math.floor(ai.clock * fps) % 6}`);
}

/**
 * Walk toward the facing at `speed`: frames by the distance walked (a heavy step: dust and a thud
 * on each foot's plant).
 * @param {Enemy} e @param {number} speed @param {number} h @param {CombatContext} ctx
 */
function stride(e, speed, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  const x0 = p.x;
  const z0 = p.z;
  e.walk(e.facing.x, e.facing.z, speed, h, ctx, null, false);
  ai.walk += Math.hypot(p.x - x0, p.z - z0) / 0.55;
  const fr = Math.floor(ai.walk) % 6;
  show(e, `walk${fr}`);
  if (fr !== ai.stepFr) {
    if (fr === 0 || fr === 3) {
      ctx.burst('dragonDust', p.x + e.facing.x * (fr === 0 ? 1.6 : -1.2), p.y + 0.1, p.z + e.facing.z * (fr === 0 ? 1.6 : -1.2), 2);
      ctx.sfx('quake', p.x, p.z, { volume: 0.35, pitch: 1.4 });
      ctx.shake(0.05, 0.12);
    }
    ai.stepFr = fr;
  }
}

/**
 * Where the mouth is drawn (world): the side view's snout to the side the dragon faces on screen,
 * the front view's below the head, toward the camera.
 * @param {Enemy} e
 * @param {{ x: number, y: number, z: number }} out
 */
function mouth(e, out) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  if (facingCamera(e)) {
    out.x = p.x + e.facing.x * MOUTH_FRONT[0];
    out.z = p.z + e.facing.z * MOUTH_FRONT[0];
    out.y = p.y + MOUTH_FRONT[1] + e.lift;
    return out;
  }
  const yaw = globalUniforms.uCameraYaw.value;
  const s = ai.side === 'right' ? 1 : -1;
  out.x = p.x + Math.cos(yaw) * MOUTH_SIDE[0] * s;
  out.z = p.z - Math.sin(yaw) * MOUTH_SIDE[0] * s;
  out.y = p.y + MOUTH_SIDE[1] + e.lift;
  return out;
}
const _mouth = { x: 0, y: 0, z: 0 };

// -------------------------------------------------------------------------------------------------
// states
// -------------------------------------------------------------------------------------------------

/** @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function step(e, h, ctx) {
  switch (e.state) {
    case 'dormant': dormant(e, ctx); break;
    case 'intro': intro(e, h, ctx); break;
    case 'engage': engage(e, h, ctx); break;
    case 'windup':
    case 'active':
    case 'recover': attack(e, h, ctx); break;
    case 'phase': phase(e, ctx); break;
    case 'stagger':
      // Broken: the flinch, then down on the ground, heaving
      show(e, e.t < F(12) ? 'hurt' : Math.floor(e.t * 1.5) % 2 ? 'stagger1' : 'stagger0');
      if (e.after(BROKEN_F)) {
        e.poise = e.poiseMax;
        e.vuln = 1;
        e.exposed = false;
        startRise(e);
      }
      break;
    case 'stun':
      show(e, Math.floor(e.t * 1.2) % 2 ? 'stagger1' : 'stagger0');
      if (e.after(STUN_F)) {
        e.vuln = 1;
        e.exposed = false;
        startRise(e);
      }
      break;
    default:
      e.setState('engage');
  }
}

/**
 * In the sky until the player stands in the arena (no arena: within 12 u) — or the story brings
 * its group and core starts the intro at once (`introOnSpawn`).
 * @param {Enemy} e @param {CombatContext} ctx
 */
function dormant(e, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  e.guarded = true;
  e.aggro = false;
  e.sprite.opacity = 0;
  ai.sa = 0;
  const P = ctx.player;
  if (!P.alive) return;
  const a = e.arena;
  const inside = a ? a.contains(P.position.x, P.position.z) && Math.abs(P.position.y - a.y) < 1.0 : e.tp.d < 12;
  if (inside) e.setState('intro');
}

/**
 * The descent: out of the sky (its shadow under it, darkening), the flare, touchdown, the impact,
 * the roar.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function intro(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  e.guarded = true;
  e.aggro = true;
  const fr = e.fr;
  if (e.entered) {
    ai.awoke = false;
    ai.landed = false;
    e.radius = e.def.radius;
    ctx.emit('bossIntro', e);
    const P = ctx.player.position;
    e.face(P.x, P.z);
    ctx.sfx('roarFar', p.x, p.z, { volume: 1 });
  }
  if (fr < INTRO.descend) {
    // down out of the sky, slowing: lift 16 → 0
    const u = fr / INTRO.descend;
    e.lift = INTRO.high * Math.pow(1 - u, 1.6);
    e.sprite.opacity = Math.min(1, fr / 24);
    if (fr < INTRO.flare) hover(e, 7);
    else show(e, 'land0');
    ai.sx = p.x;
    ai.sz = p.z;
    ai.sh = Math.atan2(e.facing.z, e.facing.x);
    ai.sa = 0.25 + 0.75 * u;
    ai.sscale = 1.25 - 0.25 * u;
    ai.beatT -= h;
    if (ai.beatT <= 0) {
      ai.beatT = 0.5;
      ctx.sfx('wingbeat', p.x, p.z, { volume: 1.1, pitch: 0.75 });
    }
    return;
  }
  e.lift = 0;
  e.sprite.opacity = 1;
  ai.sa = 0;
  if (fr < INTRO.touch) show(e, 'land1');
  else if (fr < INTRO.crouch) {
    show(e, 'land2');
    if (!ai.landed) {
      ai.landed = true;
      ctx.shake(0.75, 0.9);
      ctx.sfx('quake', p.x, p.z, { volume: 1 });
      ctx.sfx('slam', p.x, p.z, { volume: 1, pitch: 0.7 });
      dustRing(e, ctx, 3.2, 6);
      ctx.burst('dragonDebris', p.x, p.y + 0.3, p.z, 16);
      ctx.fx('dragonRing', p.x, p.y, p.z, FX.quake);
      // the landing's shockwave: a push of air and dust (no damage)
      const hz = e.hazardRing(p.x, p.z, 1, 9, 12, 1.2);
      hz.mv = 0;
      hz.kb = 0;
    }
  } else if (fr < INTRO.rise) show(e, 'land3');
  else if (fr < INTRO.roar) show(e, 'roar0');
  else {
    if (!ai.awoke) {
      ai.awoke = true;
      ctx.sfx('roar', p.x, p.z, { volume: 1.2 });
      ctx.shake(0.5, 1.4);
      ctx.burst('dragonEmbers', p.x, p.y + 3, p.z, 20);
      ctx.emit('bossAwake', e);
    }
    show(e, Math.floor((fr - INTRO.roar) / 10) % 2 ? 'roar2' : 'roar1');
  }
  if (e.after(INTRO.total)) {
    e.guarded = false;
    ai.gap = F(36);
    e.setState('engage');
  }
}

/**
 * Turn toward the player, walk in, build up a tail sweep, pick moves.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function engage(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const P = ctx.player;
  const tp = e.tp;
  e.guarded = false;
  if (!P.alive) {
    idle(e);
    return;
  }
  turnToward(e, P.position.x, P.position.z, h, TURN[e.phase - 1] ?? TURN[0]);
  // came down with the player outside its arena (an intro on appearing; core closes the arena when
  // the player walks in): it comes to the edge and lobs fire, or gives up and climbs away
  if (e.arena && !e.arena.active) {
    outside(e, h, ctx);
    return;
  }
  ai.awayT = 0;
  // the player lingering behind / beside it builds up a tail sweep
  if (tp.d <= 7 && e.facing.x * tp.dx + e.facing.z * tp.dz < Math.cos(110 * DEG)) ai.offT += h;
  else ai.offT = Math.max(0, ai.offT - h * 0.5);
  ai.gap -= h;
  const speed = e.def.phaseSpeeds?.[e.phase - 1] ?? e.def.speed;
  if (ai.gap <= 0) {
    const m = chooseMove(e);
    if (m) {
      startMove(e, m, ctx);
      return;
    }
    ai.stall += h;
  }
  // walk in while the player is out of reach of the claws (aimed: it has turned enough)
  const ahead = e.facing.x * tp.dx + e.facing.z * tp.dz;
  if (tp.d > 6 && ahead > 0.6) stride(e, speed, h, ctx);
  else idle(e);
}

/**
 * The player outside its open arena (it came down with the player away; core closes the arena when
 * the player walks in): it comes to the edge facing the player and, within `OUTSIDE.range`, lobs a
 * telegraphed volley of fireballs at them every `OUTSIDE.every` s (the barrage's, landing outside
 * the arena) — it never just waits. A player out of that reach for `OUTSIDE.giveUp` s (the walk to
 * the edge included) is given up on: it climbs back into the sky (guarded, fading, its shadow
 * under it) to its dormant state, and comes down again when the player walks into the arena (core
 * ends the fight when its boss is dormant again: the report's edit to `CombatSystem._closeCheck`).
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function outside(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player;
  fallingBalls(e, h, ctx);
  if (ai.ascend > 0) {
    // the climb back into the sky: the leap, the wing-beats, fading out high up
    e.guarded = true;
    ai.ascend += h;
    const u = Math.min(1, ai.ascend / F(OUTSIDE.climb));
    if (u < 0.25) show(e, u < 0.12 ? 'takeoff1' : 'takeoff2');
    else hover(e);
    e.lift = INTRO.high * u * u;
    e.sprite.opacity = 1 - Math.min(1, Math.max(0, (u - 0.55) / 0.45));
    shadowAt(ai, p.x, p.z, Math.atan2(e.facing.z, e.facing.x), 1 - u, 1 + 0.25 * u);
    ai.beatT -= h;
    if (ai.beatT <= 0) {
      ai.beatT = 0.5;
      ctx.sfx('wingbeat', p.x, p.z, { volume: 1.1, pitch: 0.75 });
    }
    if (u >= 1) {
      ai.ascend = 0;
      ai.awayT = 0;
      ai.sa = 0;
      e.lift = 0;
      e.setState('dormant');
    }
    return;
  }
  // out of its reach (no lob can land on the player) for long enough: it gives up
  const r = e.arena.rect;
  const tp = e.tp;
  const reach = P.alive && tp.d <= OUTSIDE.range;
  ai.awayT = reach ? 0 : ai.awayT + h;
  if (ai.awayT >= OUTSIDE.giveUp) {
    ai.ascend = EPS;
    ai.beatT = 0;
    ai.falls.length = 0;
    ctx.sfx('roar', p.x, p.z, { volume: 0.9, pitch: 0.9 });
    ctx.sfx('wingbeat', p.x, p.z, { volume: 1.4, pitch: 0.65 });
    dustRing(e, ctx, 3, 6);
    ctx.fx('dragonRing', p.x, p.y, p.z, FX.push);
    return;
  }
  // to the point of its ground nearest the player (the arena keeps it in), then the lobs
  const ahead = e.facing.x * tp.dx + e.facing.z * tp.dz;
  const m = e.def.moveRadius + 0.6;
  const ex = Math.min(r.maxX - m, Math.max(r.minX + m, P.position.x));
  const ez = Math.min(r.maxZ - m, Math.max(r.minZ + m, P.position.z));
  if (tp.d > 9 && ahead > 0.6 && Math.hypot(ex - p.x, ez - p.z) > 1.5) stride(e, e.def.speed, h, ctx);
  else if (ai.lobT > OUTSIDE.every - 0.45) show(e, 'breath1');
  else idle(e);
  ai.lobT -= h;
  if (reach && ai.lobT <= 0) {
    ai.lobT = OUTSIDE.every;
    // (the fireballs leave from its head: the barrage's start point)
    ai.sx = p.x;
    ai.sz = p.z;
    ai.sh = Math.atan2(e.facing.z, e.facing.x);
    for (let i = 0; i < OUTSIDE.balls; i++) barrageBall(e, ctx, i ? OUTSIDE.spread : 0, false);
    ctx.sfx('fireRoar', p.x, p.z, { volume: 0.9 });
    mouth(e, _mouth);
    ctx.burst('dragonFireBurst', _mouth.x, _mouth.y, _mouth.z, 10);
  }
}

/**
 * The transition roar (guarded): phase 2 — the push ring at f50 and three whelps; phase 3 — the
 * push, the lava cracks open.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function phase(e, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  e.guarded = true;
  const fr = e.fr;
  // the blow that crossed the threshold makes it flinch; it rears back and roars
  show(e, fr < 10 ? 'hurt' : fr < 24 ? 'roar0' : Math.floor((fr - 24) / 10) % 2 ? 'roar2' : 'roar1');
  if (e.entered) {
    ctx.sfx('growl', p.x, p.z, { volume: 1 });
    ai.roared = false;
  }
  if (fr >= 24 && !ai.roared) {
    ai.roared = true;
    ctx.sfx('roar', p.x, p.z, { volume: 1.2 });
    ctx.shake(0.55, 1.3);
    ctx.burst('dragonEmbers', p.x, p.y + 3, p.z, 24);
  }
  if (fr >= 50 && !ai.awoke) {
    ai.awoke = true;
    const hz = e.hazardRing(p.x, p.z, 0.5, 7, 10, 1.0);
    hz.thin = false;
    hz.mv = 0;
    hz.kb = 3.0;
    dustRing(e, ctx, 2.5, 5);
    ctx.fx('dragonRing', p.x, p.y, p.z, FX.push);
    if (ai.trans === 2) spawnAdds(e, ctx);
    if (ai.trans === 3) {
      openLava(e, ctx, LAVA.n);
      if (aliveAdds(ai) < 2 && !ai.wave2) {
        ai.wave2 = true;
        spawnAdds(e, ctx);
      }
    }
  }
  if (e.after(PHASE_ROAR_F)) {
    e.guarded = false;
    ai.trans = 0;
    // the first flight right after the phase-2 roar
    if (e.phase === 2) ai.flyNext = true;
    endMove(e, F(20));
  }
}

/**
 * Start the transition to phase `n`, signal `bossPhase`.
 * @param {Enemy} e @param {number} n @param {CombatContext} ctx
 */
function startPhase(e, n, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  cancelMove(e, ctx);
  e.phase = n;
  e.poise = e.poiseMax;
  ai.phaseT = 0;
  ai.trans = n;
  ai.awoke = false;
  tintFor(e);
  ctx.emit('bossPhase', e, n);
  e.guarded = true;
  e.setState('phase');
}


/** The phase's tint (phase 3: an ember flush). @param {Enemy} e */
function tintFor(e) {
  if (e.phase >= 3) e.sprite.tint.setRGB(1.0, 0.9, 0.86);
  else e.sprite.tint.setRGB(1, 1, 1);
}

/** Get up (after Broken or the crash): `land3`, then the fight. @param {Enemy} e */
function startRise(e) {
  const ai = /** @type {DragonAI} */ (e.ai);
  ai.move = 'rise';
  e.armored = false;
  e.setState('recover');
}

// -------------------------------------------------------------------------------------------------
// moves
// -------------------------------------------------------------------------------------------------

/**
 * Wind-up length in the current phase (phase 3 × 0.8 rounded up, ≥ 18 f).
 * @param {Enemy} e @param {number} n frames
 */
function W(e, n) {
  return e.phase === 3 ? Math.max(18, Math.ceil(n * 0.8)) : n;
}

/**
 * Seeded, distance-weighted pick; cooldowns; never the same move three times in a row (waived after
 * 90 f with nothing legal).
 * @param {Enemy} e
 * @returns {DragonMove|null}
 */
function chooseMove(e) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const d = e.tp.d;
  const ph = e.phase;
  const waive = ai.stall >= F(90) - EPS;
  /** @type {(m: DragonMove) => boolean} */
  const ok = (m) => ai.cd[m] <= 0 && (waive || !(ai.last1 === m && ai.last2 === m));
  if (ai.forced) return ok(ai.forced) ? ai.forced : null;
  if (ai.flyNext && ph >= 2) return 'flight';
  if (ai.offT >= F(TAIL.behind) - EPS && ok('tail')) return 'tail';
  const ahead = e.facing.x * e.tp.dx + e.facing.z * e.tp.dz;
  /** @type {[DragonMove, number][]} */
  const w = [
    ['claw', d <= CLAW.range && ahead > 0.5 && ok('claw') ? 3 : 0],
    ['bite', d >= BITE.near && d <= BITE.far && ahead > 0.7 && ok('bite') ? 2.4 : 0],
    ['stomp', d <= STOMP.range && ok('stomp') ? 2.2 : 0],
    ['breath', d <= BREATH.range && ahead > 0.3 && ok('breath') ? 2 : 0],
    ['gust', ph >= 2 && d <= GUST.range && ahead > 0.5 && ok('gust') ? 1.4 : 0],
    ['flight', ph >= 2 && ok('flight') ? (d > 7 ? 1.5 : 0.8) : 0],
    ['tail', d <= 6 && ok('tail') ? 0.8 : 0],
  ];
  let total = 0;
  for (const [, v] of w) total += v;
  if (total <= 0) return null;
  let r = e.rng.next() * total;
  for (const [m, v] of w) {
    r -= v;
    if (r < 0 && v > 0) return m;
  }
  return null;
}

/**
 * Begin move `m`: its cooldown, the history, the wind-up.
 * @param {Enemy} e @param {DragonMove} m @param {CombatContext} ctx
 */
function startMove(e, m, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  ai.move = m;
  ai.last2 = ai.last1;
  ai.last1 = m;
  ai.cd[m] = F(COOLDOWN[m] * (e.phase === 3 && m === 'breath' ? 0.7 : 1));
  ai.stall = 0;
  ai.forced = null;
  if (m === 'tail') ai.offT = 0;
  if (m === 'flight') ai.flyNext = false;
  ai.ticks = 0;
  ai.patches = 0;
  ai.charge = 0;
  ai.rings = 0;
  ai.leapt = false;
  e.setState('windup');
  if (e.entered) ctx.sfx(m === 'breath' ? 'breath' : m === 'flight' ? 'wingbeat' : 'windup', e.position.x, e.position.z);
}

/**
 * The move is over: back to `engage` after `gap` s (default: the phase's seeded gap).
 * @param {Enemy} e @param {number} [gap]
 */
function endMove(e, gap) {
  const ai = /** @type {DragonAI} */ (e.ai);
  ai.move = null;
  ai.charge = 0;
  e.armored = false;
  const g = GAP_F[e.phase - 1] ?? GAP_F[0];
  ai.gap = gap ?? F(e.rng.int(g[0], g[1]));
  e.setState('engage');
}

/**
 * Drop the move in progress (interrupts, phases, death): markers, armour, the air.
 * @param {Enemy} e @param {CombatContext} [ctx]
 */
function cancelMove(e, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  if (ctx) e.unmarkAll(ctx);
  ai.move = null;
  ai.charge = 0;
  ai.falls.length = 0;
  ai.sa = 0;
  e.armored = false;
  e.vuln = 1;
  e.exposed = false;
  e.lift = 0;
  e.radius = e.def.radius;
  if (e.alive && e.state !== 'dormant') e.sprite.opacity = 1;
}

/** In the air (the flight's climb, circle and lane: out of sight, untouchable). @param {Enemy} e */
function inAir(e) {
  const ai = /** @type {DragonAI} */ (e.ai);
  return ai.move === 'flight' && e.state === 'active' && ai.stage !== 'swoop';
}

/** States `windup` / `active` / `recover`: the current move. @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function attack(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  switch (ai.move) {
    case 'claw': claw(e, h, ctx); break;
    case 'bite': bite(e, h, ctx); break;
    case 'tail': tail(e, h, ctx); break;
    case 'breath': breath(e, h, ctx); break;
    case 'gust': gust(e, h, ctx); break;
    case 'stomp': stomp(e, h, ctx); break;
    case 'flight': flight(e, h, ctx); break;
    case 'rise':
      show(e, 'land3');
      if (e.after(RISE_F)) endMove(e, F(20));
      break;
    default: endMove(e);
  }
}

/** Claw swipe: a sector ahead. @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function claw(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    const dur = W(e, CLAW.windup);
    if (e.t < F(dur * 0.5)) turnToward(e, ctx.player.position.x, ctx.player.position.z, h, 200);
    show(e, 'claw0');
    const m = e.markerSpec('sector', p.x, p.z);
    m.r = CLAW.r;
    m.halfAngle = CLAW.half;
    m.progress = Math.min(1, e.t / F(dur));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    show(e, 'claw1');
    if (e.entered) {
      e.markProgress(0, ctx, 1);
      ctx.sfx('swingHeavy', p.x, p.z, { pitch: 0.7 });
      ctx.shake(0.2, 0.25);
      ctx.burst('dragonDust', p.x + e.facing.x * 3.5, p.y + 0.2, p.z + e.facing.z * 3.5, 6);
    }
    if (e.after(CLAW.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = CLAW.r;
    s.halfAngle = CLAW.half;
    s.mv = CLAW.mv;
    s.kb = CLAW.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  show(e, 'claw2');
  if (e.after(CLAW.recover)) endMove(e);
}

/** Bite: the snout's circle, tracking through the wind-up. @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function bite(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    const dur = W(e, BITE.windup);
    if (e.entered) ctx.sfx('growl', p.x, p.z, { volume: 0.9 });
    if (e.t < F(dur - 8)) turnToward(e, ctx.player.position.x, ctx.player.position.z, h, 160);
    ai.cx = p.x + e.facing.x * BITE.ahead;
    ai.cz = p.z + e.facing.z * BITE.ahead;
    show(e, 'bite0');
    const m = e.markerSpec('circle', ai.cx, ai.cz);
    m.r = BITE.r;
    m.progress = Math.min(1, e.t / F(dur));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    show(e, 'bite1');
    if (e.entered) {
      e.markProgress(0, ctx, 1);
      ctx.sfx('swingHeavy', ai.cx, ai.cz, { pitch: 0.55 });
      ctx.shake(0.18, 0.2);
    }
    if (e.after(BITE.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = ai.cx;
    s.z = ai.cz;
    s.r = BITE.r;
    s.mv = BITE.mv;
    s.kb = BITE.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  show(e, 'bite2');
  if (e.after(BITE.recover)) endMove(e);
}

/** Tail sweep: a wide sector behind and to the sides. @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function tail(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    const dur = W(e, TAIL.windup);
    show(e, 'tail0');
    const m = e.markerSpec('sector', p.x, p.z);
    m.dirX = -e.facing.x;
    m.dirZ = -e.facing.z;
    m.r = TAIL.r;
    m.halfAngle = TAIL.half;
    m.progress = Math.min(1, e.t / F(dur));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    void h;
    return;
  }
  if (e.state === 'active') {
    show(e, e.t < F(5) ? 'tail1' : 'tail2');
    if (e.entered) {
      e.markProgress(0, ctx, 1);
      ctx.sfx('swingHeavy', p.x, p.z, { pitch: 0.5, volume: 1.2 });
      ctx.shake(0.3, 0.35);
      for (let k = 0; k < 3; k++) {
        const a = Math.atan2(-e.facing.z, -e.facing.x) + (k - 1) * 0.9;
        ctx.burst('dragonDust', p.x + Math.cos(a) * 4.5, p.y + 0.15, p.z + Math.sin(a) * 4.5, 5);
      }
    }
    if (e.after(TAIL.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'sector';
    s.dirX = -e.facing.x;
    s.dirZ = -e.facing.z;
    s.r = TAIL.r;
    s.halfAngle = TAIL.half;
    s.mv = TAIL.mv;
    s.kb = TAIL.kb;
    s.knockdown = true;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  show(e, 'tail3');
  if (e.after(TAIL.recover)) endMove(e);
}

/**
 * Fire breath: the inhale (the area of the whole sweep marked, the furnace kindling), the gout
 * sweeping across the locked aim, burning patches left behind.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function breath(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    const dur = W(e, BREATH.windup);
    const u = Math.min(1, e.t / F(dur));
    if (u < 0.6) {
      turnToward(e, ctx.player.position.x, ctx.player.position.z, h, 140);
      ai.ax = e.facing.x;
      ai.az = e.facing.z;
    }
    ai.charge = u;
    show(e, u < 0.75 ? 'breath0' : 'breath1');
    const m = e.markerSpec('sector', p.x + ai.ax * 1.5, p.z + ai.az * 1.5);
    m.dirX = ai.ax;
    m.dirZ = ai.az;
    m.r = BREATH.r;
    m.halfAngle = BREATH.sweep + BREATH.cone;
    m.progress = u;
    e.mark(0, ctx, m);
    // embers gathering in the throat
    if (e.fr % 6 === 0) {
      mouth(e, _mouth);
      ctx.burst('dragonEmbers', _mouth.x, _mouth.y - 0.6, _mouth.z, 2);
    }
    if (e.after(dur)) {
      e.unmark(0, ctx);
      ai.sweep = e.rng.next() < 0.5 ? -1 : 1;
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    const u = Math.min(1, e.t / F(BREATH.active));
    ai.charge = 1 - 0.3 * u;
    // the jet's direction: across the aim, ±sweep
    const a = Math.atan2(ai.az, ai.ax) + ai.sweep * (u * 2 - 1) * BREATH.sweep * DEG;
    const jx = Math.cos(a);
    const jz = Math.sin(a);
    e.faceDir(jx, jz);
    show(e, e.t < F(8) ? 'breath1' : Math.floor(e.t * 10) % 2 ? 'breath3' : 'breath2');
    if (e.entered) {
      ctx.sfx('fireRoar', p.x, p.z, { volume: 1.2 });
      ctx.shake(0.22, 1.6);
    }
    // the jet: flame particles out of the mouth along the jet
    mouth(e, _mouth);
    if (e.fr % 2 === 0) ctx.burst(dirPreset('dragonBreath', jx, jz), _mouth.x, _mouth.y, _mouth.z, 4);
    if (e.fr % 9 === 0) ctx.burst('dragonSmoke', p.x + jx * 7, p.y + 1.2, p.z + jz * 7, 2);
    // the active cone marker follows the jet
    const m = e.markerSpec('sector', p.x + jx * 1.5, p.z + jz * 1.5);
    m.dirX = jx;
    m.dirZ = jz;
    m.r = BREATH.r;
    m.halfAngle = BREATH.cone;
    m.progress = 1;
    e.mark(1, ctx, m);
    // a hit every 10 f (a new tag each)
    if (e.fr >= ai.ticks * BREATH.every) {
      ai.ticks++;
      const s = e.hitSpec();
      s.shape = 'sector';
      s.x = p.x + jx * 1.5;
      s.z = p.z + jz * 1.5;
      s.dirX = jx;
      s.dirZ = jz;
      s.r = BREATH.r;
      s.halfAngle = BREATH.cone;
      s.mv = BREATH.mv;
      s.kb = BREATH.kb;
      s.tag = e.newTag();
      ctx.hitbox(e, s);
    }
    // burning ground left along the sweep
    if (ai.patches < BREATH.patches && e.fr >= 12 + ai.patches * BREATH.patchEvery) {
      ai.patches++;
      const d = 4.5 + e.rng.next() * 3.5;
      const x = p.x + jx * d;
      const z = p.z + jz * d;
      e.hazardMagma(x, z, BREATH.patchR, F(BREATH.patchDur), BREATH.patchFlat, F(BREATH.patchTick));
      ctx.burst('dragonEmbers', x, ctx.groundAt(x, z) + 0.2, z, 6);
    }
    if (e.after(BREATH.active)) {
      e.unmark(1, ctx);
      e.setState('recover');
    }
    return;
  }
  ai.charge = Math.max(0, 0.7 - e.t * 2);
  show(e, e.t < F(16) ? 'breath3' : 'idle0');
  if (e.after(BREATH.recover)) endMove(e);
}

/** Wing gust: a sector of wind ahead that throws the party back. @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function gust(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    const dur = W(e, GUST.windup);
    if (e.t < F(dur * 0.5)) turnToward(e, ctx.player.position.x, ctx.player.position.z, h, 160);
    show(e, 'gust0');
    const m = e.markerSpec('sector', p.x, p.z);
    m.r = GUST.r;
    m.halfAngle = GUST.half;
    m.progress = Math.min(1, e.t / F(dur));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    show(e, 'gust1');
    if (e.entered) {
      e.markProgress(0, ctx, 1);
      ctx.sfx('wingbeat', p.x, p.z, { volume: 1.4, pitch: 0.7 });
      ctx.shake(0.3, 0.5);
    }
    if (e.fr % 2 === 0) {
      const preset = dirPreset('dragonGust', e.facing.x, e.facing.z);
      ctx.burst(preset, p.x + e.facing.x * 2.5, p.y + 0.5, p.z + e.facing.z * 2.5, 4);
    }
    if (e.after(GUST.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = GUST.r;
    s.halfAngle = GUST.half;
    s.mv = GUST.mv;
    s.kb = GUST.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  show(e, e.t < F(14) ? 'gust1' : 'idle0');
  if (e.after(GUST.recover)) endMove(e);
}

/** Stomp: reared up, the slam, the shockwave rings. @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function stomp(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    const dur = W(e, STOMP.windup);
    show(e, 'stomp0');
    const m = e.markerSpec('circle', p.x, p.z);
    m.r = STOMP.r;
    m.progress = Math.min(1, e.t / F(dur));
    e.mark(0, ctx, m);
    if (e.after(dur)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    void h;
    return;
  }
  if (e.state === 'active') {
    show(e, 'stomp1');
    if (e.entered) {
      e.markProgress(0, ctx, 1);
      ctx.shake(0.6, 0.6);
      ctx.sfx('quake', p.x, p.z, { volume: 1.1 });
      ctx.sfx('slam', p.x, p.z, { pitch: 0.65 });
      dustRing(e, ctx, 2.6, 6);
      ctx.burst('dragonDebris', p.x, p.y + 0.3, p.z, 14);
      ctx.fx('dragonRing', p.x, p.y, p.z, FX.quake);
      const rings = e.phase;
      for (let i = 0; i < rings; i++) {
        const hz = e.hazardRing(p.x, p.z, STOMP.width, STOMP.rMax, STOMP.speed, STOMP.width, F(i * STOMP.every));
        hz.mv = STOMP.ringMv;
        hz.kb = STOMP.ringKb;
      }
    }
    if (e.after(STOMP.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'circle';
    s.r = STOMP.r;
    s.mv = STOMP.mv;
    s.kb = STOMP.kb;
    s.knockdown = true;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  show(e, e.t < F(20) ? 'stomp1' : 'idle0');
  if (e.after(STOMP.recover)) endMove(e);
}

/**
 * The flight: take-off, the climb out of sight, circling while the barrage falls, the dive's lane,
 * the swoop along it, the crash — then the stun (state `stun`).
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function flight(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player.position;
  if (e.state === 'windup') {
    // the take-off: the crouch under raised wings, the leap on a downbeat
    if (e.fr < FLIGHT.leap) {
      turnToward(e, P.x, P.z, h, 120);
      show(e, 'takeoff0');
      e.lift = 0;
    } else {
      if (!ai.leapt) {
        ai.leapt = true;
        ctx.sfx('wingbeat', p.x, p.z, { volume: 1.4, pitch: 0.65 });
        ctx.shake(0.35, 0.5);
        dustRing(e, ctx, 3, 6);
        ctx.fx('dragonRing', p.x, p.y, p.z, FX.push);
        const hz = e.hazardRing(p.x, p.z, 1, 6, 10, 1.0);
        hz.mv = 0;
        hz.kb = 2.5;
        hz.thin = false;
        e.guarded = true;
      }
      const u = (e.fr - FLIGHT.leap) / (FLIGHT.takeoff - FLIGHT.leap);
      show(e, u < 0.5 ? 'takeoff1' : 'takeoff2');
      e.lift = 4 * u * u;
    }
    if (e.after(FLIGHT.takeoff)) {
      ai.stage = 'up';
      ai.st = 0;
      ai.balls = 0;
      ai.falls.length = 0;
      ai.ang = Math.atan2(p.z - arenaCenter(e).z, p.x - arenaCenter(e).x);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    ai.st += h;
    e.guarded = ai.stage !== 'swoop';
    if (ai.stage === 'up') {
      // the climb: up and out of sight; its shadow takes over on the ground
      const u = Math.min(1, ai.st / F(FLIGHT.climb));
      e.lift = 4 + (FLIGHT.high - 4) * u * u;
      hover(e, 10);
      e.sprite.opacity = Math.max(0, Math.min(1, (14 - e.lift) / 6));
      if (e.sprite.opacity < 0.5) e.radius = 0.01;
      shadowAt(ai, p.x, p.z, Math.atan2(e.facing.z, e.facing.x), u * 0.9, 1.2 - 0.2 * u);
      if (ai.st % 0.5 < h) ctx.sfx('wingbeat', p.x, p.z, { volume: 0.9, pitch: 0.75 });
      if (u >= 1) {
        ai.stage = 'circle';
        ai.st = 0;
        ai.salvoT = F(20);
      }
      return;
    }
    if (ai.stage === 'circle') {
      // circling the arena; the barrage falls on the player
      const c = arenaCenter(e);
      const R = arenaRadius(e);
      ai.ang += (FLIGHT.flySpeed / R) * h;
      const x = c.x + Math.cos(ai.ang) * R;
      const z = c.z + Math.sin(ai.ang) * R;
      p.x = x;
      p.z = z;
      shadowAt(ai, x, z, ai.ang + Math.PI / 2, 1, 1);
      const n = FLIGHT.balls[e.phase >= 3 ? 1 : 0];
      ai.salvoT -= h;
      if (ai.salvoT <= 0 && ai.balls < n) {
        ai.salvoT = FLIGHT.salvo[e.phase >= 3 ? 1 : 0];
        barrageBall(e, ctx, ai.balls === 0 ? 0 : 3.2);
        ai.balls++;
      }
      fallingBalls(e, h, ctx);
      const dur = FLIGHT.circle[e.phase >= 3 ? 1 : 0];
      if (ai.st >= dur && ai.balls >= n) {
        ai.stage = 'lane';
        ai.st = 0;
      }
      return;
    }
    if (ai.stage === 'lane') {
      // the dive's lane, from the arena's far side through the player: tracks, then locks
      fallingBalls(e, h, ctx);
      const tracking = ai.st < F(FLIGHT.lane - FLIGHT.lock) - EPS;
      if (tracking) laneThrough(e, P.x, P.z);
      // the shadow heads for the lane's start
      const k = Math.min(1, h * 4);
      ai.sx += (ai.lx0 - ai.sx) * k;
      ai.sz += (ai.lz0 - ai.sz) * k;
      ai.sh = Math.atan2(ai.lz1, ai.lx1);
      const m = e.markerSpec('lane', ai.lx0, ai.lz0);
      m.dirX = ai.lx1;
      m.dirZ = ai.lz1;
      m.len = ai.llen;
      m.width = FLIGHT.width;
      m.progress = Math.min(1, ai.st / F(FLIGHT.lane));
      m.flash = e.lockFlash(ai.st - F(FLIGHT.lane - FLIGHT.lock));
      e.mark(0, ctx, m);
      if (ai.st >= F(FLIGHT.lane) - EPS) {
        e.markProgress(0, ctx, 1);
        ai.stage = 'swoop';
        ai.st = 0;
        ai.done = 0;
        ai.tag = e.newTag();
        p.x = ai.lx0;
        p.z = ai.lz0;
        e.faceDir(ai.lx1, ai.lz1);
        e.radius = e.def.radius;
        e.armored = true;
        e.guarded = false;
        e.sprite.opacity = 1;
        ai.sa = 0;
        ctx.sfx('roar', p.x, p.z, { volume: 1, pitch: 1.1 });
      }
      return;
    }
    // the swoop along the lane, skimming the ground, then the crash
    const step = Math.min(FLIGHT.speed * h, ai.llen - ai.done);
    p.x += ai.lx1 * step;
    p.z += ai.lz1 * step;
    ai.done += step;
    const u = ai.done / ai.llen;
    e.lift = u < 0.35 ? 8 * (1 - u / 0.35) + 1.2 : 1.2 * (1 - (u - 0.35) / 0.65);
    show(e, u < 0.45 ? 'dive0' : 'dive1');
    if (e.fr % 3 === 0) ctx.burst('dragonDust', p.x - ai.lx1 * 2, p.y + 0.2, p.z - ai.lz1 * 2, 3);
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = p.x + ai.lx1 * 1.5;
    s.z = p.z + ai.lz1 * 1.5;
    s.r = FLIGHT.hitR;
    s.mv = FLIGHT.mv;
    s.kb = FLIGHT.kb;
    s.knockdown = true;
    s.fromX = p.x;
    s.fromZ = p.z;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    if (ai.done >= ai.llen - 1e-3) crash(e, ctx);
    return;
  }
  endMove(e);
}

/**
 * The swoop's end: the crash (a shockwave ring, dust, debris, a quake), the stun.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function crash(e, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const p = e.position;
  e.unmarkAll(ctx);
  e.lift = 0;
  e.armored = false;
  e.guarded = false;
  ai.move = null;
  ctx.shake(0.8, 0.8);
  ctx.sfx('crash', p.x, p.z, { volume: 1.2 });
  ctx.sfx('quake', p.x, p.z, { volume: 1 });
  dustRing(e, ctx, 3, 7);
  ctx.burst('dragonDebris', p.x, p.y + 0.3, p.z, 20);
  ctx.fx('dragonBlast', p.x, p.y, p.z, FX.crash);
  ctx.fx('dragonRing', p.x, p.y, p.z, FX.quake);
  const hz = e.hazardRing(p.x, p.z, 1, 6, 10, 1.0);
  hz.mv = FLIGHT.crashMv;
  hz.kb = 2;
  hz.thin = false;
  e.vuln = 1.5;
  e.exposed = true;
  // dizzy stars over the head lying on the ground
  ctx.fx('stun', p.x, p.y + 1.2, p.z, { duration: STUN_F / 60, follow: e.position });
  e.setState('stun');
}

/**
 * The lane of the dive: from the arena's edge opposite the player through the player to the far
 * edge (inset 1.5).
 * @param {Enemy} e @param {number} px @param {number} pz
 */
function laneThrough(e, px, pz) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const c = arenaCenter(e);
  let dx = px - c.x;
  let dz = pz - c.z;
  let d = Math.hypot(dx, dz);
  if (d < 1) {
    dx = Math.cos(ai.ang);
    dz = Math.sin(ai.ang);
    d = 1;
  }
  dx /= d;
  dz /= d;
  /** How far from (x, z) along (ux, uz) the arena inset by `m` goes (negative: already past it; no arena: 10 u). */
  const reach = (m, x, z, ux, uz) => {
    const r = inset(e, m);
    if (!r) return 10;
    let t = Infinity;
    if (ux > 1e-6) t = Math.min(t, (r.maxX - x) / ux);
    if (ux < -1e-6) t = Math.min(t, (r.minX - x) / ux);
    if (uz > 1e-6) t = Math.min(t, (r.maxZ - z) / uz);
    if (uz < -1e-6) t = Math.min(t, (r.minZ - z) / uz);
    return t;
  };
  // start behind the arena's centre (seen from the player; 1.5 u in from the edge), end up to 5 u
  // past the player — the crash keeps its body (radius + 1 u) off the arena's edge: it ends up to
  // 2 u short of a player standing there
  const back = Math.max(2, reach(1.5, px, pz, -dx, -dz));
  const fwd = Math.max(-2, Math.min(5, reach(e.def.radius + 1, px, pz, dx, dz)));
  ai.lx0 = px - dx * back;
  ai.lz0 = pz - dz * back;
  ai.lx1 = dx;
  ai.lz1 = dz;
  ai.llen = Math.max(4, back + fwd);
}

/**
 * One fireball of the barrage: a circle on the player (later ones scattered within `spread` u of
 * its predicted position), filling 66 f while a fireball falls on it from the sky. Inside the
 * arena (`inArena`; the lobs at a player outside its open arena fall where the player is).
 * @param {Enemy} e @param {CombatContext} ctx @param {number} spread @param {boolean} [inArena]
 */
function barrageBall(e, ctx, spread, inArena = true) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const P = ctx.player;
  let x = P.position.x + P.velocity.x * 0.5;
  let z = P.position.z + P.velocity.z * 0.5;
  if (spread > 0) {
    const a = e.rng.next() * TAU;
    const r = spread * Math.sqrt(e.rng.next());
    x += Math.cos(a) * r;
    z += Math.sin(a) * r;
  }
  const rect = inArena ? inset(e, FLIGHT.ballR) : null;
  if (rect) {
    x = Math.min(rect.maxX, Math.max(rect.minX, x));
    z = Math.min(rect.maxZ, Math.max(rect.minZ, z));
  }
  const hz = e.hazardCircle(x, z, FLIGHT.ballR, F(FLIGHT.fill));
  hz.mv = FLIGHT.ballMv;
  hz.kb = FLIGHT.ballKb;
  hz.burst = 'dragonFireBurst';
  hz.burstN = 16;
  hz.sfx = 'explosion';
  // the fireball leaves the sky when it has the time to land with the fill
  ai.falls.push({ t: F(FLIGHT.fill), x, z });
}

/**
 * The barrage's fireballs: each launched from the shadow's head so it lands as its circle resolves
 * (an arc shot with the fireball's look, harmless itself: the circle hits); at the impact the blast,
 * the fire ring, embers on the ground, smoke and debris.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function fallingBalls(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const fallTime = 0.75;
  for (let i = ai.falls.length - 1; i >= 0; i--) {
    const f = ai.falls[i];
    const before = f.t;
    f.t -= h;
    if (before > fallTime && f.t <= fallTime) {
      const sx = ai.sx + Math.cos(ai.sh) * 4;
      const sz = ai.sz + Math.sin(ai.sh) * 4;
      const ps = e.projSpec();
      const dist = Math.hypot(f.x - sx, f.z - sz);
      ps.kind = 'boulder';
      ps.look = BALL_LOOK;
      ps.x = sx;
      ps.z = sz;
      ps.y = ctx.groundAt(f.x, f.z) + 13;
      ps.dirX = dist > 1e-4 ? (f.x - sx) / dist : 0;
      ps.dirZ = dist > 1e-4 ? (f.z - sz) / dist : 1;
      ps.speed = dist / fallTime;
      ps.range = dist;
      ps.radius = 0.4;
      ps.mv = 0;
      ps.kb = 0;
      ps.arc = { tx: f.x, tz: f.z, time: fallTime, apex: 0 };
      ctx.projectile(e, ps);
      ctx.sfx('fireballFall', f.x, f.z, { volume: 0.7 });
    }
    if (f.t <= 0) {
      const gy = ctx.groundAt(f.x, f.z);
      ctx.fx('dragonBlast', f.x, gy, f.z, FX.blast);
      ctx.fx('dragonRing', f.x, gy, f.z, FX.ring);
      ctx.fx('dragonEmbers', f.x, gy, f.z, FX.embers);
      ctx.burst('dragonSmoke', f.x, gy + 0.6, f.z, 5);
      ctx.burst('dragonDebris', f.x, gy + 0.2, f.z, 6);
      ai.falls.splice(i, 1);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// phase 3: the arena cracks open
// -------------------------------------------------------------------------------------------------

/** @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function lava(e, h, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  for (let i = ai.lava.length - 1; i >= 0; i--) {
    ai.lava[i].t -= h;
    if (ai.lava[i].t <= 0) ai.lava.splice(i, 1);
  }
  if (!ai.lava.length && e.state !== 'phase') {
    ai.lavaT -= h;
    if (ai.lavaT <= 0) openLava(e, ctx, LAVA.renew);
  }
  // the pools spit
  ai.spitT -= h;
  if (ai.spitT <= 0 && ai.lava.length) {
    ai.spitT = 0.35 + e.rng.next() * 0.5;
    const L = ai.lava[Math.floor(e.rng.next() * ai.lava.length)];
    ctx.burst('dragonLavaSpit', L.x, ctx.groundAt(L.x, L.z) + 0.1, L.z, 5);
  }
}

/**
 * `n` lava cracks at seeded points of the arena (not within 2.5 u of the player).
 * @param {Enemy} e @param {CombatContext} ctx @param {number} n
 */
function openLava(e, ctx, n) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const r = inset(e, 2.5);
  const P = ctx.player.position;
  const c = arenaCenter(e);
  for (let k = 0; k < n; k++) {
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 8; tries++) {
      x = r ? r.minX + e.rng.next() * (r.maxX - r.minX) : c.x + (e.rng.next() - 0.5) * 16;
      z = r ? r.minZ + e.rng.next() * (r.maxZ - r.minZ) : c.z + (e.rng.next() - 0.5) * 12;
      if (Math.hypot(x - P.x, z - P.z) > 2.5) break;
    }
    const rr = LAVA.r[0] + e.rng.next() * (LAVA.r[1] - LAVA.r[0]);
    e.hazardMagma(x, z, rr, LAVA.dur, LAVA.flat, F(LAVA.tick));
    ai.lava.push({ x, z, t: LAVA.dur });
    ctx.burst('dragonLavaSpit', x, ctx.groundAt(x, z) + 0.1, z, 8);
  }
  ai.lavaT = LAVA.every - LAVA.dur;
  ctx.sfx('quake', c.x, c.z, { volume: 0.8 });
  ctx.shake(0.25, 0.6);
}

// -------------------------------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------------------------------

/**
 * Turn the facing toward a point at `rate` deg/s.
 * @param {Enemy} e @param {number} x @param {number} z @param {number} h @param {number} rate
 */
function turnToward(e, x, z, h, rate) {
  const p = e.position;
  const want = Math.atan2(x - p.x, z - p.z);
  let yaw = Math.atan2(e.facing.x, e.facing.z);
  let d = want - yaw;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  const max = rate * DEG * h;
  yaw += Math.max(-max, Math.min(max, d));
  e.faceDir(Math.sin(yaw), Math.cos(yaw));
}

/**
 * Dust thrown out in a ring round the dragon.
 * @param {Enemy} e @param {CombatContext} ctx @param {number} r @param {number} n bursts
 */
function dustRing(e, ctx, r, n) {
  const p = e.position;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + e.rng.next() * 0.4;
    ctx.burst('dragonDust', p.x + Math.cos(a) * r, p.y + 0.15, p.z + Math.sin(a) * r, 5);
  }
}

/**
 * Put the shadow at (x, z), heading `hd`, opacity `a` (× 0.45), size `scale`.
 * @param {DragonAI} ai @param {number} x @param {number} z @param {number} hd @param {number} a @param {number} scale
 */
function shadowAt(ai, x, z, hd, a, scale) {
  ai.sx = x;
  ai.sz = z;
  ai.sh = hd;
  ai.sa = a;
  ai.sscale = scale;
}

/** Draw (or hide) the shadow. @param {Enemy} e @param {CombatContext} ctx */
function drawShadow(e, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const s = SHADOWS.get(e);
  if (!s) return;
  if (!(ai.sa > 0.005) || !e.alive) {
    s.hide();
    return;
  }
  s.set(ai.sx, ai.sz, ai.sh, ai.clock * 6, 0.45 * ai.sa, ai.sscale, ctx.groundAt);
}

/** The arena's centre (no arena: home). @param {Enemy} e @returns {{ x: number, z: number }} */
function arenaCenter(e) {
  const a = e.arena;
  if (!a) return e.home;
  return { x: (a.rect.minX + a.rect.maxX) / 2, z: (a.rect.minZ + a.rect.maxZ) / 2 };
}

/** The circling radius over the arena. @param {Enemy} e */
function arenaRadius(e) {
  const a = e.arena;
  if (!a) return 8;
  return Math.max(4, Math.min(a.rect.maxX - a.rect.minX, a.rect.maxZ - a.rect.minZ) * 0.36);
}

/**
 * The arena rect inset by `m` (reused object), or null without an arena.
 * @param {Enemy} e @param {number} m
 * @returns {RectXZ|null}
 */
function inset(e, m) {
  const a = e.arena;
  if (!a) return null;
  const ai = /** @type {DragonAI} */ (e.ai);
  const r = ai.inset ?? (ai.inset = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  r.minX = a.rect.minX + m;
  r.maxX = a.rect.maxX - m;
  r.minZ = a.rect.minZ + m;
  r.maxZ = a.rect.maxZ - m;
  return r;
}

/** Live adds. @param {{ adds: Enemy[] }} ai */
function aliveAdds(ai) {
  let n = 0;
  for (const a of ai.adds) if (a && a.alive) n++;
  return n;
}

/**
 * Three whelps at the arena corners farthest from the player.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function spawnAdds(e, ctx) {
  const ai = /** @type {DragonAI} */ (e.ai);
  const a = e.arena;
  const p = e.position;
  const P = ctx.player.position;
  const r = a ? a.rect : { minX: p.x - 9, maxX: p.x + 9, minZ: p.z - 7, maxZ: p.z + 7 };
  const corners = [[r.minX + 2.5, r.minZ + 2.5], [r.maxX - 2.5, r.minZ + 2.5], [r.minX + 2.5, r.maxZ - 2.5], [r.maxX - 2.5, r.maxZ - 2.5]];
  corners.sort((u, v) => Math.hypot(v[0] - P.x, v[1] - P.z) - Math.hypot(u[0] - P.x, u[1] - P.z));
  for (let i = 0; i < 3; i++) {
    const add = ctx.spawnAdd(ADD_KIND, corners[i][0], corners[i][1], ADD_LEVEL);
    if (add && !ai.adds.includes(add)) ai.adds.push(add);
  }
}
