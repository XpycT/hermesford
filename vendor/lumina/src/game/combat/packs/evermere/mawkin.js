/**
 * The Harvest Mawkin (docs/contracts/EVERMERE_CAMPAIGN.md §2.6.5, §5.4, §6.7): the scarecrow guardian
 * of Amberfield — an effigy animated by frost that rises from the frozen wheat among crows at the
 * golden hour, wearing Osmund's coat (the bell-founder's coat with the burns: chapter 3's clue).
 * Three phases against Linnet, Corin and Wenna (levels ≈ 8); at 0 HP it is not killed but released:
 * it collapses into a heap of straw with the coat draped over it. Owner: the guardians package —
 * this brain and the painter (src/engine/pixel/monsters/mawkin.js); the guardians' FX frames and
 * presets are registered by ./rimehart.js.
 *
 * Like the golem's (COMBAT.md §8) this brain drives every state itself (`update`); the Enemy supplies
 * timers, markers, hazards and movement; core owns the arena, the bar, the hit-stop, the music and
 * the HP floors (`e.hpFloor`: the next phase's threshold, so core's phase-3 kneel never applies).
 * Frames: a laid-out sheet (side, front, back) shown by the brain (`show`), as Rimehart's.
 *
 * **States.** `dormant` (sunk in the furrow: only the hat and head above the frozen ground, guarded)
 * → `intro` (156 f: `bossIntro` at f0; it rises out of the wheat with a burst of crows at f60, arms
 * flung up; `bossAwake` at f96) → `engage` (turns on its pole, lurches in hops, picks moves; idle
 * while its arena is open) ⇄ `windup` / `active` / `recover`; interrupts `phase` (the transitions,
 * guarded) and `stagger` (Broken: 150 f, vuln 1.3, exposed). `dead`: the release (below).
 *
 * **Moves** (every wind-up ≥ 18 f with a marker in core's ice styles: `frost`; the stalks' rows and
 * false marks `crack`):
 * - Reap (phases 1–2, d ≤ 5.2): 40 f (tracking 22, locked 18), a sector r 5 ±100°; 8 f (mv 1.3,
 *   kb 2.8); 36 f recover.
 * - Crow Volley (d ≥ 4): 36 f, the coat thrown open; three lanes 1.4 wide (at the player, ±24°)
 *   filling 36 / 44 / 52 f; a crow dives down each as it fills (a piercing shot, 15 u/s, mv 0.85,
 *   kb 1.6); 30 f recover.
 * - Furrow Swap: it sinks (36 f) and three marks fill around the player for 90 f — the gold one (the
 *   player style's gold rim) real, the other two cracking ice; under the field it is core's
 *   submerged (`ctx.submerge`: untargetable, guarded, faded), it rises at the gold one at f90 (mv 1.3, kb 2.6,
 *   knockdown) while the false ones erupt as frost stalks (mv 1.2, kb 2); 44 f recover — the punish
 *   window.
 * - The North Wind (phase ≥ 2): 50 f, its arms spread (two lanes — three in phase 3 — 2.4 wide
 *   across the arena west to east: at the player and 3.6 u to either side, inside the arena); 50 f
 *   of gusts and streaming leaves, a hit every 10 f (mv 0.25, kb 4, pushing east); up to two Rime
 *   Crows ride in from the west end (the pool's: at most three out at once); 30 f recover.
 * - The Reaping (phase 3; first at once after the transition): 30 f, the scythe planted; frost
 *   stalks erupt row by row along the furrows (rows 2.3 u apart across the arena, north to south,
 *   one every 16 f), each row a lane 1.3 wide filling 36 f with a seeded 2.6 u gap; mv 1.1, kb 2.4;
 *   50 f recover.
 * - The full reap (phase 3, replaces the Reap; d ≤ 5.4): 60 f, the scythe overhead (a circle r 5
 *   round it); 8 f (mv 1.5, kb 3.2, knockdown); 46 f recover.
 *
 * **Phases** (`def.phases` [0.60, 0.25]): phase 2 — the transition (110 f: crows burst from the coat,
 * a push ring at f50 (mv 0, kb 3) and three Rime Crows at the arena's corners farthest from the
 * player); phase 3 — the transition (90 f: the scythe planted, frost running along the furrows),
 * then the Reaping, faster (walk 2.4 u/s).
 *
 * **The release** (`die` + `dead`; true: the brain keeps the body): the straw bursts from its seams
 * (0.35 s), the head tips off and the coat slides (0.45 s), it crumples (0.45 s), then the heap —
 * straw under Osmund's coat, the sack head on top, eyes dark — with a few crows leaving it. The heap
 * stays (the story's coat scene plays over it) until the thaw front reaches it
 * (`thawField.reached`, at least 4 s after the fall): then the wind carries the straw off (leaves and straw, a 2 s
 * fade). A story that takes the Mawkin's group away (`unless`) hides the heap at once — under the
 * white of a memory flash it is not seen.
 *
 * Its randomness: `e.rng` (its own stream) for the move picks, the marks, the gaps and the crows'
 * flight only.
 *
 * @import { EnemyPackApi } from '../index.js'
 * @import { Brain, CombatContext, BossMove, RectXZ, FxOptions, ProjectileLook, MarkerStyle } from '../../types.js'
 * @import { Enemy } from '../../Enemy.js'
 */
import { mawkin as mawkinSheet } from '../../../../engine/pixel/monsters/mawkin.js';
import { globalUniforms } from '../../../../engine/render/GlobalUniforms.js';
import { thawField } from '../../../../engine/world/ThawField.js';

/** @type {(n: number) => number} frames → seconds */
const F = (n) => n / 60;
const EPS = 1e-6;
const DEG = Math.PI / 180;

/** The Mawkin's moves (`ai.move`; `boss.force(move)`). @typedef {'reap'|'volley'|'swap'|'wind'|'reaping'|'spin'} MawkinMove */
/** @type {readonly MawkinMove[]} */
export const MAWKIN_MOVES = Object.freeze(['reap', 'volley', 'swap', 'wind', 'reaping', 'spin']);

const INTRO = Object.freeze({ total: 156, rise: 30, burst: 60, awake: 96 });
const PHASE2_F = 110;
const PHASE2_PUSH_F = 50;
const PHASE3_F = 90;
const BROKEN_F = 150;
const GAP_F = [[48, 78], [40, 66], [30, 54]];
/** Turn rates (rad/s) by phase. */
const TURN = [130 * DEG, 150 * DEG, 180 * DEG];
const REAP = Object.freeze({ windup: 40, track: 22, active: 8, recover: 36, r: 5, half: 100, mv: 1.3, kb: 2.8, range: 5.2 });
const SPIN = Object.freeze({ windup: 60, active: 16, hit: 8, recover: 46, r: 5, mv: 1.5, kb: 3.2, range: 5.4 });
const VOLLEY = Object.freeze({ windup: 36, stagger: 8, recover: 30, lanes: 3, spread: 24, len: 13, width: 1.4, speed: 15, radius: 0.55, mv: 0.85, kb: 1.6, min: 4 });
const SWAP = Object.freeze({ sink: 36, fill: 90, rise: 24, recover: 44, r: 1.7, near: 2.2, ring: 3.2, mv: 1.3, kb: 2.6, stalkMv: 1.2, stalkKb: 2.0 });
const WIND = Object.freeze({ windup: 50, active: 50, every: 10, recover: 30, width: 2.4, apart: 3.6, mv: 0.25, kb: 4, riders: 2, maxCrows: 3 });
const REAPING = Object.freeze({ windup: 30, every: 16, fill: 36, width: 1.3, apart: 2.3, gap: 2.6, mv: 1.1, kb: 2.4, recover: 50, maxRows: 6 });
/** Move cooldowns (f), started when a move begins. */
const COOLDOWN = Object.freeze({ reap: 70, spin: 120, volley: 300, swap: 540, wind: 480, reaping: 600 });
const STALL_F = 90;
const ADD_KIND = 'rimecrow';
/** (the pool's level is its def's `adds`: 8 — the argument only names it) */
const ADD_LEVEL = 8;
/** The release (seconds). */
const REL = Object.freeze({ burst: 0.35, tip: 0.45, crumple: 0.45, wait: 4, fade: 2 });
/** The telegraphs' looks (core's Evermere marker styles, COMBAT.md §30.6). @type {MarkerStyle} */
const FROST = 'frost';
/** The frost stalks' fissures (the Reaping's rows, the false marks). @type {MarkerStyle} */
const CRACK = 'crack';
/** The Enemy's own hazards' markers (the transition's push ring) restyled to the ice. */
const ICE_STYLE = Object.freeze({ style: FROST });
/** The stitched eyes' and the blade's glow (frost cyan, below the bloom threshold). */
const GLOW = Object.freeze([0.45, 0.85, 1.0]);
/** The crows of the bursts (a dark tint on the atlas's grey crow). */
const CROW = [0.2, 0.21, 0.27];

/** @type {Readonly<Record<'reap'|'reapBack'|'burst'|'stalk'|'gust', FxOptions>>} */
const FX = Object.freeze({
  reap: Object.freeze({ mode: 'flat', lift: 0.9, color: [0.66, 0.9, 1.05], loops: 1, scale: 2.4 }),
  reapBack: Object.freeze({ mode: 'flat', lift: 0.9, color: [0.66, 0.9, 1.05], loops: 1, scale: 2.4, flip: true }),
  burst: Object.freeze({ mode: 'flat', lift: 0.06, color: [0.62, 0.86, 1.02], loops: 1, scale: 1.4 }),
  stalk: Object.freeze({ mode: 'billboard', lift: 0.7, color: [0.7, 0.92, 1.08], loops: 1, scale: 1.3 }),
  gust: Object.freeze({ mode: 'flat', lift: 0.5, color: [0.86, 0.9, 0.94], loop: true, duration: 50 / 60, scale: 1.4 }),
});

/** A crow diving down a lane (`ProjectileSpec.look`): its own frame, feathers behind it. @type {ProjectileLook} */
const CROW_LOOK = Object.freeze({
  frame: 'evgCrow', mode: 'billboard', color: [...CROW], scale: 1.5, fps: 14,
  trail: 'evgFeathers', trailEvery: 0.1, trailCount: 1, hitBurst: 'evgFeathers', hitCount: 6, hitSfx: 'crowCaw', hitVolume: 0.7,
  fadeBurst: 'evgFeathers', fadeCount: 4,
});

/**
 * The brain state (`e.ai`).
 * @typedef {ReturnType<typeof initAI>} MawkinAI
 */

/** @param {Enemy} e */
function initAI(e) {
  return {
    own: false,
    col: -1, row: -1, side: /** @type {'left'|'right'} */ ('left'),
    yaw: Math.atan2(e.facing.x, e.facing.z),
    clock: 0, phaseT: 0, stride: 0,
    /** @type {MawkinMove|null} */ move: null,
    /** @type {MawkinMove|null} */ last1: null,
    /** @type {MawkinMove|null} */ last2: null,
    /** @type {MawkinMove|null} */ forced: null,
    gap: F(40), stall: 0, reapingNext: false, strawAt: -1,
    cd: { reap: 0, volley: 0, swap: 0, wind: 0, reaping: 0, spin: 0 },
    awoke: false, risen: false, pushed: false, trans: 0,
    tag: 0, nextTick: 0,
    // the volley's lanes (direction per lane) and the crows launched
    lanes: [0, 0, 0, 0, 0, 0], launched: 0,
    // the swap's marks (x, z; the real one is index `real`), their markers, the eruption done
    marks: [0, 0, 0, 0, 0, 0], real: 0, markH: [-1, -1, -1], erupted: false,
    // the wind's lanes (z of each), their markers, the riders sent
    windZ: [0, 0, 0], windN: 0, windH: [-1, -1, -1], riders: 0,
    // the Reaping's rows
    rows: Array.from({ length: REAPING.maxRows }, () => ({ on: false, z: 0, gx: 0, t: 0, h1: -1, h2: -1, done: false })),
    rowN: 0,
    /** @type {Enemy[]} the adds shown */ adds: /** @type {Enemy[]} */ ([]),
    // the crows of the bursts (FX following these points)
    flock: Array.from({ length: 8 }, () => ({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 })),
    // the release
    rel: /** @type {''|'burst'|'tip'|'crumple'|'heap'|'blow'|'gone'} */ (''), relT: 0, relAll: 0, relFx: 0,
    /** @type {RectXZ|null} */ inset: null,
  };
}

/** @satisfies {Brain} */
export const mawkinBrain = {
  init: initAI,

  /** @type {Brain['update']} */
  update(e, h, ctx) {
    const ai = /** @type {MawkinAI} */ (e.ai);
    if (!ai.own) {
      // take the frames over (Enemy.pose shows a laid-out sheet's poses in the wrong row)
      ai.own = true;
      e.anim('idle');
      ai.col = -1;
    }
    ai.clock += h;
    ai.phaseT += h;
    for (const k of MAWKIN_MOVES) if (ai.cd[k] > 0) ai.cd[k] -= h;
    const phases = e.def.phases ?? [0.6, 0.25];
    const fighting = e.state !== 'dormant' && e.state !== 'intro';
    // (no transition while it is under the field: it rises first)
    if (fighting && e.state !== 'phase' && !e.submerged) {
      if (e.phase === 1 && e.hp <= e.hpMax * phases[0] + EPS) startPhase(e, 2, ctx);
      else if (e.phase === 2 && e.hp <= e.hpMax * phases[1] + EPS) startPhase(e, 3, ctx);
    }
    for (const hz of e._hazards) if (hz.on && hz.h >= 0) ctx.setMarker(hz.h, ICE_STYLE);
    flockStep(e, h);
    rowsStep(e, h, ctx);
    for (let n = 0; n < 4; n++) {
      const k = e.serial;
      step(e, h, ctx);
      if (e.serial === k) break;
    }
    e.hpFloor = e.phase === 1 ? e.hpMax * phases[0] : e.phase === 2 ? e.hpMax * phases[1] : 0;
  },

  /** Boss poise: spent by hits outside the transitions → Broken. @type {Brain['onHit']} */
  onHit(e, info, ctx) {
    const p = e.position;
    // (straw from the seams on a solid hit)
    const ai = /** @type {MawkinAI} */ (e.ai);
    if (!info.guarded && info.damage > 0 && ai.clock - ai.strawAt > 0.15) {
      ai.strawAt = ai.clock;
      ctx.burst('evgStraw', p.x, p.y + 2.6, p.z, 3);
    }
    if (info.guarded || e.guarded || e.armored) return;
    const s = e.state;
    if (s !== 'engage' && s !== 'windup' && s !== 'active' && s !== 'recover') return;
    if (e.submerged) return;
    e.poise -= info.poise || 0;
    if (e.poise > 0) return;
    cancelMove(e, ctx);
    e.vuln = 1.3;
    e.exposed = true;
    e.setState('stagger');
    ctx.sfx('stun', p.x, p.z);
  },

  /** @type {Brain['cancel']} */
  cancel(e, ctx) {
    cancelMove(e, ctx);
    if (ctx) clearRows(e, ctx);
  },

  /** The collapse begins (the release: `dead` plays it). @type {Brain['die']} */
  die(e, ctx) {
    const ai = /** @type {MawkinAI} */ (e.ai);
    ai.move = null;
    ai.rel = 'burst';
    ai.relT = 0;
    ai.relAll = 0;
    ai.relFx = 0;
    e.lift = 0;
    e.sprite.visible = true;
    e.sprite.tint.setRGB(1, 1, 1);
    e.sprite.opacity = 1;
    if (ctx) {
      const p = e.position;
      ctx.burst('evgStraw', p.x, p.y + 2.4, p.z, 14);
      ctx.burst('evgStraw', p.x, p.y + 1.4, p.z, 10);
      ctx.sfx('reap', p.x, p.z, { volume: 0.6, pitch: 0.6 });
    }
  },

  /**
   * The release (after `die`), every sub-step of the dead boss: the collapse, the heap, the wind.
   * True: the brain keeps the body (core's default fade off).
   * @param {Enemy} e @param {number} h @param {CombatContext} ctx
   * @returns {boolean}
   */
  dead(e, h, ctx) {
    flockStep(e, h);
    return releaseStep(e, h, ctx);
  },

  /**
   * Test hook `combat.boss.force(move)`: only `move` may be picked next, at once (the others wait
   * 99 s); null: none. The Mawkin's move names (`MAWKIN_MOVES`).
   * @type {Brain['force']}
   */
  force(e, move) {
    const ai = /** @type {MawkinAI} */ (e.ai);
    const m = /** @type {string|null} */ (move);
    for (const k of MAWKIN_MOVES) ai.cd[k] = k === m ? 0 : 99;
    ai.forced = MAWKIN_MOVES.find((k) => k === m) ?? null;
    ai.reapingNext = false;
    ai.gap = 0;
    ai.stall = 0;
  },

  /** Test hook `combat.boss.info()`: the move in progress. @type {Brain['info']} */
  info(e) {
    const ai = /** @type {MawkinAI} */ (e.ai);
    // (the Mawkin's move names until core's BossMove lists them: report §2)
    return { move: ai.move, pending: null, skid: false, adds: ai.adds.filter((a) => a.alive).length };
  },

  /** Test hook `bossPhase(n)`: no transition, signals `bossPhase`. @type {Brain['jumpPhase']} */
  jumpPhase(e, n, ctx) {
    const ai = /** @type {MawkinAI} */ (e.ai);
    n = Math.max(1, Math.min(3, n | 0));
    cancelMove(e, ctx);
    clearRows(e, ctx);
    e.phase = n;
    e.poise = e.poiseMax;
    ai.phaseT = F(60);
    ai.reapingNext = false;
    if (e.state !== 'dormant' && e.state !== 'intro') {
      e.guarded = false;
      e.setState('engage');
      ai.gap = F(30);
    }
    ctx.emit('bossPhase', e, n);
  },

  /** The stitched eyes and the blade's edge: brighter by phase, a flicker through every wind-up. @type {Brain['glow']} */
  glow(e, out) {
    const ai = /** @type {MawkinAI} */ (e.ai);
    let a;
    if (!e.alive) a = ai.rel === 'burst' ? 0.5 : 0;
    else if (e.state === 'dormant') a = 0.3;
    else if (e.state === 'intro') a = 0.3 + 0.5 * Math.min(1, e.t / F(INTRO.burst));
    else a = [0.8, 1.0, 1.25][e.phase - 1] ?? 0.8;
    if (e.alive && e.state === 'windup') a += 0.35 * (0.5 - 0.5 * Math.cos(2 * Math.PI * 6 * e.t));
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
 * Show a cell: the front one facing the camera, the back one facing away (when the pose has one),
 * else the side its facing points to on screen.
 * @param {Enemy} e @param {string} name
 */
function show(e, name) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const sheet = e.sheet;
  if (!sheet.cell) return;
  const dir = e.sprite.direction;
  const cells = sheet.cells;
  let d;
  if (dir === 'down' && cells?.down && Object.hasOwn(cells.down, name)) d = 'down';
  else if (dir === 'up' && cells?.up && Object.hasOwn(cells.up, name)) d = 'up';
  else {
    const yaw = globalUniforms.uCameraYaw.value;
    const rx = e.facing.x * Math.cos(yaw) - e.facing.z * Math.sin(yaw);
    if (rx > 0.2) ai.side = 'right';
    else if (rx < -0.2) ai.side = 'left';
    d = ai.side;
  }
  const c = sheet.cell(name, d);
  if (c.col === ai.col && c.row === ai.row) return;
  ai.col = c.col;
  ai.row = c.row;
  e.sprite.setFrame(c.col, c.row);
}

/** Swaying on its pole. @param {Enemy} e */
function idle(e) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  show(e, `idle${[0, 1, 2, 1][Math.floor(ai.clock * 2.5) % 4]}`);
}

/**
 * Lurch along the facing in hops: the frames by the distance travelled.
 * @param {Enemy} e @param {number} speed @param {number} h @param {CombatContext} ctx
 */
function hop(e, speed, h, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  const x0 = p.x;
  const z0 = p.z;
  e.walk(e.facing.x, e.facing.z, speed, h, ctx, null, false);
  const before = Math.floor(ai.stride / 0.5) % 4;
  ai.stride += Math.hypot(p.x - x0, p.z - z0);
  const k = Math.floor(ai.stride / 0.5) % 4;
  show(e, `walk${k}`);
  // the pole lands: frost cracks at its foot
  if (k === 3 && before !== 3) ctx.burst('evgFrost', p.x, p.y + 0.1, p.z, 2);
}

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
    case 'phase': phase(e, h, ctx); break;
    case 'stagger':
      show(e, 'stun');
      if (e.after(BROKEN_F)) {
        e.poise = e.poiseMax;
        e.vuln = 1;
        e.exposed = false;
        endMove(e);
      }
      break;
    default:
      e.setState('engage');
  }
}

/**
 * Sunk in the furrow (only the hat and the head above the ground), guarded, until the player stands
 * inside its arena — or its group appears through the story (`introOnSpawn`: core starts the intro).
 * @param {Enemy} e @param {CombatContext} ctx
 */
function dormant(e, ctx) {
  e.guarded = true;
  e.aggro = false;
  show(e, 'sink2');
  const P = ctx.player;
  if (!P.alive || ctx.ambient) return;
  const a = e.arena;
  const inside = a ? a.contains(P.position.x, P.position.z) && Math.abs(P.position.y - a.y) < 1.0 : e.tp.d < 10;
  if (inside) e.setState('intro');
}

/**
 * The intro (156 f): sunk, rising (f30), bursting out of the wheat with the crows (f60), arms flung
 * up; `bossAwake` at f96.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function intro(e, h, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  e.guarded = true;
  e.aggro = true;
  if (e.entered) {
    ai.awoke = false;
    ai.risen = false;
    ctx.emit('bossIntro', e);
    ctx.sfx('iceCrack', p.x, p.z, { volume: 0.7, pitch: 0.7 });
  }
  const P = ctx.player.position;
  turnToward(e, P.x, P.z, h, 90 * DEG);
  const f = e.fr;
  if (f < INTRO.rise) {
    show(e, 'sink2');
    if (everyF(e, h, 10)) ctx.burst('evgFrost', p.x, p.y + 0.2, p.z, 2);
  } else if (f < INTRO.rise + 15) show(e, 'rise0');
  else if (f < INTRO.burst) show(e, 'rise1');
  else {
    if (!ai.risen) {
      ai.risen = true;
      ctx.burst('evgChaff', p.x, p.y + 0.4, p.z, 16);
      ctx.burst('evgFrost', p.x, p.y + 0.4, p.z, 8);
      ctx.fx('evgFrostBurst', p.x, p.y, p.z, FX.burst);
      flock(e, ctx, 6, p.x, p.y + 3.0, p.z);
      ctx.sfx('crowFlock', p.x, p.z);
      ctx.shake(0.2, 0.5);
    }
    if (f < INTRO.burst + 16) show(e, 'rise2');
    else if (f < INTRO.awake + 30) show(e, 'volley');
    else idle(e);
    if (f >= INTRO.awake && !ai.awoke) {
      ai.awoke = true;
      ctx.sfx('reap', p.x, p.z, { volume: 0.8, pitch: 0.7 });
      ctx.shake(0.25, 0.5);
      ctx.emit('bossAwake', e);
    }
  }
  if (e.after(INTRO.total)) {
    e.guarded = false;
    ai.gap = F(36);
    e.setState('engage');
  }
}

/** The fight is on: its arena closed with the player inside (no arena: always). @param {Enemy} e */
function fightOn(e) {
  return !e.arena || e.arena.active;
}

/**
 * Turn toward the player on the pole, hop in, pick moves; while its arena stands open it waits.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function engage(e, h, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const P = ctx.player;
  const tp = e.tp;
  e.guarded = false;
  if (!P.alive || !fightOn(e)) {
    turnToward(e, P.position.x, P.position.z, h, 60 * DEG);
    idle(e);
    return;
  }
  turnToward(e, P.position.x, P.position.z, h, TURN[e.phase - 1]);
  ai.gap -= h;
  let stalled = false;
  if (ai.gap <= 0) {
    const m = chooseMove(e);
    if (m) {
      startMove(e, m, ctx);
      return;
    }
    ai.stall += h;
    stalled = true;
  }
  const speed = e.def.phaseSpeeds?.[e.phase - 1] ?? e.def.speed;
  if (tp.d > 3.8 || (stalled && tp.d > 2.6)) hop(e, speed, h, ctx);
  else idle(e);
}

/**
 * The transitions (guarded): phase 2 — crows burst from the coat, the push and three crows at f50;
 * phase 3 — the scythe planted, frost running along the furrows, then the Reaping.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function phase(e, h, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  e.guarded = true;
  if (ai.trans === 2) {
    if (e.entered) {
      ai.pushed = false;
      ctx.sfx('crowFlock', p.x, p.z, { volume: 1 });
      flock(e, ctx, 8, p.x, p.y + 2.6, p.z);
      ctx.burst('evgFeathers', p.x, p.y + 2.4, p.z, 10);
      ctx.shake(0.3, 0.8);
    }
    show(e, e.fr < 30 ? 'volley' : 'gustWind');
    if (e.fr >= PHASE2_PUSH_F && !ai.pushed) {
      ai.pushed = true;
      const hz = e.hazardRing(p.x, p.z, 0.5, 5, 9, 0.8);
      hz.thin = false;
      hz.mv = 0;
      hz.kb = 3.0;
      ctx.sfx('windGust', p.x, p.z);
      ctx.burst('evgLeaves', p.x, p.y + 1.2, p.z, 10);
      spawnCorners(e, ctx, 3);
    }
    if (e.after(PHASE2_F)) {
      e.guarded = false;
      ai.trans = 0;
      endMove(e, F(24));
    }
    return;
  }
  // phase 3
  if (e.entered) {
    ctx.sfx('iceCrack', p.x, p.z, { volume: 1, pitch: 0.6 });
    ctx.shake(0.3, 0.9);
    ctx.fx('evgFrostBurst', p.x, p.y, p.z, FX.burst);
  }
  show(e, 'call');
  // frost runs out along the furrows
  if (everyF(e, h, 12)) {
    const k = Math.floor((e.t * 60 + 1e-6) / 12);
    const rect = e.arena ? e.arena.rect : null;
    if (rect) {
      const z = rect.minZ + 1.6 + ((k * 2) % 5) * REAPING.apart;
      for (let s = -1; s <= 1; s += 2) {
        const x = p.x + s * (1.5 + k * 1.6);
        if (x > rect.minX + 0.5 && x < rect.maxX - 0.5 && z < rect.maxZ - 0.5) ctx.burst('evgFrost', x, ctx.groundAt(x, z) + 0.15, z, 2);
      }
    }
  }
  if (e.after(PHASE3_F)) {
    e.guarded = false;
    ai.trans = 0;
    ai.reapingNext = true;
    endMove(e, F(6));
  }
}

/**
 * Start the transition to phase `n` and signal it.
 * @param {Enemy} e @param {number} n @param {CombatContext} ctx
 */
function startPhase(e, n, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  cancelMove(e, ctx);
  e.phase = n;
  e.poise = e.poiseMax;
  ai.phaseT = 0;
  ai.trans = n;
  ctx.emit('bossPhase', e, n);
  e.guarded = true;
  e.setState('phase');
}

// -------------------------------------------------------------------------------------------------
// moves
// -------------------------------------------------------------------------------------------------

/**
 * A seeded, weighted pick by distance and phase; cooldowns; never the same move three times in a
 * row unless nothing was legal for STALL_F frames. Phase 3 opens with the Reaping.
 * @param {Enemy} e
 * @returns {MawkinMove|null}
 */
function chooseMove(e) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const d = e.tp.d;
  const ph = e.phase;
  const waive = ai.stall >= F(STALL_F) - EPS;
  /** @type {(m: MawkinMove) => boolean} */
  const ok = (m) => ai.cd[m] <= 0 && (waive || !(ai.last1 === m && ai.last2 === m));
  if (ai.forced) return ok(ai.forced) ? ai.forced : null;
  if (ai.reapingNext) {
    ai.reapingNext = false;
    return 'reaping';
  }
  /** @type {[MawkinMove, number][]} */
  const w = [
    ['reap', ph < 3 && d <= REAP.range && ok('reap') ? 3 : 0],
    ['spin', ph === 3 && d <= SPIN.range && ok('spin') ? 3 : 0],
    ['volley', d >= VOLLEY.min && ok('volley') ? 2.2 : 0],
    ['swap', ok('swap') ? 1.6 : 0],
    ['wind', ph >= 2 && ok('wind') ? 2.4 : 0],
    ['reaping', ph === 3 && ok('reaping') ? 2.6 : 0],
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

/** @param {Enemy} e @param {MawkinMove} m @param {CombatContext} ctx */
function startMove(e, m, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  ai.move = m;
  ai.last2 = ai.last1;
  ai.last1 = m;
  ai.cd[m] = F(COOLDOWN[m]);
  ai.stall = 0;
  e.setState('windup');
  ctx.sfx('windup', e.position.x, e.position.z);
}

/** @param {Enemy} e @param {number} [gap] */
function endMove(e, gap) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  ai.move = null;
  e.armored = false;
  e.lift = 0;
  const g = GAP_F[e.phase - 1] ?? GAP_F[0];
  ai.gap = gap ?? F(e.rng.int(g[0], g[1]));
  e.setState('engage');
}

/**
 * Drop the move in progress: its markers (the slots, the swap's marks, the wind's lanes), armour,
 * vulnerability; back above the field if it was under it.
 * @param {Enemy} e @param {CombatContext} [ctx]
 */
function cancelMove(e, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  if (ctx) {
    e.unmarkAll(ctx);
    for (let i = 0; i < 3; i++) {
      ctx.freeMarker(ai.markH[i]);
      ai.markH[i] = -1;
      ctx.freeMarker(ai.windH[i]);
      ai.windH[i] = -1;
    }
  }
  if (e.submerged && ctx) ctx.surface?.(e);
  ai.move = null;
  e.armored = false;
  e.vuln = 1;
  e.exposed = false;
  e.lift = 0;
}

/** @param {Enemy} e @param {number} h @param {CombatContext} ctx */
function attack(e, h, ctx) {
  switch (/** @type {MawkinAI} */ (e.ai).move) {
    case 'reap': reap(e, h, ctx); break;
    case 'spin': spin(e, ctx); break;
    case 'volley': volley(e, h, ctx); break;
    case 'swap': swap(e, h, ctx); break;
    case 'wind': wind(e, h, ctx); break;
    case 'reaping': reaping(e, ctx); break;
    default: endMove(e);
  }
}

/**
 * Reap: the scythe drawn back (the sector ahead, tracking then locked), the swing.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function reap(e, h, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player.position;
  if (e.state === 'windup') {
    if (e.t < F(REAP.track) - EPS) turnToward(e, P.x, P.z, h, TURN[e.phase - 1] * 1.5);
    show(e, 'reapWind');
    const m = e.markerSpec('sector', p.x, p.z);
    m.style = FROST;
    m.r = REAP.r;
    m.halfAngle = REAP.half;
    m.progress = Math.min(1, e.t / F(REAP.windup));
    m.flash = e.lockFlash(e.t - F(REAP.track));
    e.mark(0, ctx, m);
    if (e.after(REAP.windup)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    show(e, 'reap');
    if (e.entered) {
      e.markProgress(0, ctx, 1);
      ctx.sfx('reap', p.x, p.z);
      ctx.fx('evgReap', p.x, p.y, p.z, { ...FX.reap, dirX: e.facing.x, dirZ: e.facing.z });
      ctx.burst('evgChaff', p.x + e.facing.x * 3, p.y + 0.2, p.z + e.facing.z * 3, 8);
    }
    if (e.after(REAP.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
      return;
    }
    const s = e.hitSpec();
    s.shape = 'sector';
    s.r = REAP.r;
    s.halfAngle = REAP.half;
    s.mv = REAP.mv;
    s.kb = REAP.kb;
    s.tag = ai.tag;
    ctx.hitbox(e, s);
    return;
  }
  show(e, e.t < F(20) ? 'reapEnd' : 'idle0');
  if (e.after(REAP.recover)) endMove(e);
}

/**
 * The full reap (phase 3): the scythe overhead over the circle round it, the spin.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function spin(e, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    show(e, 'spinWind');
    const m = e.markerSpec('circle', p.x, p.z);
    m.style = FROST;
    m.r = SPIN.r;
    m.progress = Math.min(1, e.t / F(SPIN.windup));
    e.mark(0, ctx, m);
    if (e.after(SPIN.windup)) {
      ai.tag = e.newTag();
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    show(e, Math.floor(e.t * 12) % 2 ? 'spin1' : 'spin0');
    if (e.entered) {
      e.markProgress(0, ctx, 1);
      ctx.sfx('reap', p.x, p.z, { pitch: 0.85 });
      ctx.sfx('swingHeavy', p.x, p.z);
      ctx.fx('evgReap', p.x, p.y, p.z, { ...FX.reap, dirX: e.facing.x, dirZ: e.facing.z });
      ctx.fx('evgReap', p.x, p.y, p.z, { ...FX.reapBack, dirX: -e.facing.x, dirZ: -e.facing.z });
      ctx.burst('evgStraw', p.x, p.y + 2.0, p.z, 10);
      ctx.burst('evgChaff', p.x, p.y + 0.3, p.z, 12);
      ctx.shake(0.3, 0.4);
    }
    if (e.fr < SPIN.hit) {
      const s = e.hitSpec();
      s.shape = 'circle';
      s.r = SPIN.r;
      s.mv = SPIN.mv;
      s.kb = SPIN.kb;
      s.knockdown = true;
      s.tag = ai.tag;
      ctx.hitbox(e, s);
    }
    if (e.after(SPIN.active)) {
      e.unmark(0, ctx);
      e.setState('recover');
    }
    return;
  }
  show(e, e.t < F(24) ? 'reapEnd' : 'idle0');
  if (e.after(SPIN.recover)) endMove(e);
}

/**
 * Crow Volley: the coat thrown open; three lanes fill, staggered; a crow dives down each.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function volley(e, h, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player.position;
  if (e.state === 'windup') {
    if (e.entered) {
      turnToward(e, P.x, P.z, h, Infinity);
      const yaw = Math.atan2(e.facing.x, e.facing.z);
      for (let k = 0; k < VOLLEY.lanes; k++) {
        const a = yaw + [0, -1, 1][k] * VOLLEY.spread * DEG;
        ai.lanes[k * 2] = Math.sin(a);
        ai.lanes[k * 2 + 1] = Math.cos(a);
      }
      ai.launched = 0;
      ctx.burst('evgFeathers', p.x, p.y + 2.6, p.z, 6);
      ctx.sfx('crowCaw', p.x, p.z, { volume: 0.8 });
    }
    show(e, 'volley');
    for (let k = 0; k < VOLLEY.lanes; k++) laneMark(e, ctx, k);
    if (e.after(VOLLEY.windup)) {
      launch(e, ctx, 0);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    show(e, 'volley');
    for (let k = ai.launched; k < VOLLEY.lanes; k++) laneMark(e, ctx, k);
    while (ai.launched < VOLLEY.lanes && e.t >= F(ai.launched * VOLLEY.stagger) - EPS) launch(e, ctx, ai.launched);
    if (ai.launched >= VOLLEY.lanes) e.setState('recover');
    return;
  }
  show(e, e.t < F(16) ? 'volley' : 'idle0');
  if (e.after(VOLLEY.recover)) endMove(e);
}

/**
 * Lane `k`'s marker (slot k): from the Mawkin along its direction, filling until its crow flies.
 * @param {Enemy} e @param {CombatContext} ctx @param {number} k
 */
function laneMark(e, ctx, k) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  const m = e.markerSpec('lane', p.x, p.z);
  m.style = FROST;
  m.dirX = ai.lanes[k * 2];
  m.dirZ = ai.lanes[k * 2 + 1];
  m.len = VOLLEY.len;
  m.width = VOLLEY.width;
  const total = F(VOLLEY.windup + k * VOLLEY.stagger);
  const t = e.state === 'windup' ? e.t : F(VOLLEY.windup) + e.t;
  m.progress = Math.min(1, t / total);
  e.mark(k, ctx, m);
}

/**
 * The crow of lane `k`: a piercing shot from the coat down the lane; its marker fades.
 * @param {Enemy} e @param {CombatContext} ctx @param {number} k
 */
function launch(e, ctx, k) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  const dx = ai.lanes[k * 2];
  const dz = ai.lanes[k * 2 + 1];
  const ps = e.projSpec();
  ps.kind = 'arrow';
  ps.x = p.x + dx * 0.8;
  ps.z = p.z + dz * 0.8;
  ps.y = p.y + 2.0;
  ps.dirX = dx;
  ps.dirZ = dz;
  ps.vy = -1.0 / (VOLLEY.len / VOLLEY.speed);
  ps.speed = VOLLEY.speed;
  ps.range = VOLLEY.len;
  ps.radius = VOLLEY.radius;
  ps.mv = VOLLEY.mv;
  ps.kb = VOLLEY.kb;
  ps.pierce = true;
  ps.look = CROW_LOOK;
  ctx.projectile(e, ps);
  e.markToFade(k, ctx, F(14));
  ctx.sfx('crowCaw', p.x, p.z, { volume: 0.6, pitch: 0.9 + k * 0.1 });
  ai.launched = k + 1;
}

/**
 * Furrow Swap: it sinks, three marks fill round the player (the gold one real), it rises there and
 * the false ones erupt.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function swap(e, h, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    if (e.entered) {
      placeMarks(e, ctx);
      ai.erupted = false;
      ctx.sfx('iceCrack', p.x, p.z, { volume: 0.7, pitch: 0.8 });
    }
    const f = e.fr;
    show(e, f < 12 ? 'sink0' : f < 24 ? 'sink1' : 'sink2');
    if (everyF(e, h, 8)) ctx.burst('evgChaff', p.x, p.y + 0.2, p.z, 3);
    marksFill(e, ctx);
    if (e.after(SWAP.sink)) {
      // under the field (core's submerged state: untargetable, guarded, faded)
      ctx.submerge?.(e);
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    marksFill(e, ctx);
    if (e.t >= F(SWAP.fill - SWAP.sink) - EPS && !ai.erupted) {
      ai.erupted = true;
      erupt(e, ctx);
      // up at the gold mark
      ctx.surface?.(e, ai.marks[ai.real * 2], ai.marks[ai.real * 2 + 1]);
      ai.col = -1;
      e.guarded = false;
      ai.tag = e.newTag();
      const s = e.hitSpec();
      s.shape = 'circle';
      s.r = SWAP.r;
      s.mv = SWAP.mv;
      s.kb = SWAP.kb;
      s.knockdown = true;
      s.tag = ai.tag;
      ctx.hitbox(e, s);
      ctx.burst('evgChaff', p.x, p.y + 0.3, p.z, 16);
      ctx.burst('evgFrost', p.x, p.y + 0.3, p.z, 6);
      ctx.fx('evgFrostBurst', p.x, p.y, p.z, FX.burst);
      flock(e, ctx, 3, p.x, p.y + 2.8, p.z);
      ctx.sfx('crowFlock', p.x, p.z, { volume: 0.8 });
      ctx.shake(0.25, 0.4);
      e.setState('recover');
    } else if (!ai.erupted) show(e, 'sink2');
    return;
  }
  const f = e.fr;
  show(e, f < 8 ? 'rise0' : f < 16 ? 'rise1' : f < SWAP.rise ? 'rise2' : 'idle0');
  if (e.after(SWAP.recover + SWAP.rise)) endMove(e);
}

/**
 * The three marks: the real one ≈ 2.2 u from the player (seeded side), the false ones at the other
 * corners of a triangle 3.2 u round the player; inside the arena (inset 1.8), on standable ground.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function placeMarks(e, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const P = ctx.player.position;
  const rect = inset(e, 1.8);
  const a0 = e.rng.next() * Math.PI * 2;
  ai.real = e.rng.int(0, 2);
  for (let k = 0; k < 3; k++) {
    const a = a0 + (k * 2 * Math.PI) / 3;
    const r = k === ai.real ? SWAP.near : SWAP.ring;
    let x = P.x + Math.cos(a) * r;
    let z = P.z + Math.sin(a) * r;
    if (rect) {
      x = Math.min(rect.maxX, Math.max(rect.minX, x));
      z = Math.min(rect.maxZ, Math.max(rect.minZ, z));
    }
    if (!ctx.walkable(x, z)) {
      x = P.x;
      z = P.z;
    }
    ai.marks[k * 2] = x;
    ai.marks[k * 2 + 1] = z;
    ctx.freeMarker(ai.markH[k]);
    ai.markH[k] = ctx.marker({
      shape: 'circle', x, z, y: 0.03, r: SWAP.r, rInner: 0, progress: 0,
      // the real one gold (the gold rim the party's own areas wear), the false ones cracking ice
      style: k === ai.real ? 'player' : CRACK, alpha: 1, flash: 0,
    });
  }
}

/** The marks fill over the swap (`fill` frames from its start). @param {Enemy} e @param {CombatContext} ctx */
function marksFill(e, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const t = e.state === 'windup' ? e.t : F(SWAP.sink) + e.t;
  const prog = Math.min(1, t / F(SWAP.fill));
  for (let k = 0; k < 3; k++) if (ai.markH[k] >= 0) ctx.setMarker(ai.markH[k], { progress: prog });
}

/**
 * The false marks erupt as frost stalks (a hit each); every mark's marker is freed.
 * @param {Enemy} e @param {CombatContext} ctx
 */
function erupt(e, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  for (let k = 0; k < 3; k++) {
    ctx.freeMarker(ai.markH[k]);
    ai.markH[k] = -1;
    if (k === ai.real) continue;
    const x = ai.marks[k * 2];
    const z = ai.marks[k * 2 + 1];
    const gy = ctx.groundAt(x, z);
    const s = e.hitSpec();
    s.shape = 'circle';
    s.x = x;
    s.z = z;
    s.y = gy;
    s.r = SWAP.r;
    s.mv = SWAP.stalkMv;
    s.kb = SWAP.stalkKb;
    s.tag = e.newTag();
    ctx.hitbox(e, s);
    stalks(ctx, x, gy, z, 1.0);
    ctx.sfx('iceBreak', x, z, { volume: 0.7 });
  }
}

/** A cluster of frost stalks round (x, z): four spikes, shards. @param {CombatContext} ctx @param {number} x @param {number} gy @param {number} z @param {number} r */
function stalks(ctx, x, gy, z, r) {
  ctx.fx('evgStalk', x, gy, z, FX.stalk);
  ctx.fx('evgStalk', x - r * 0.7, gy, z + r * 0.3, FX.stalk);
  ctx.fx('evgStalk', x + r * 0.7, gy, z + r * 0.2, FX.stalk);
  ctx.fx('evgStalk', x, gy, z - r * 0.6, FX.stalk);
  ctx.burst('evgShards', x, gy + 0.4, z, 8);
}

/**
 * The North Wind: its arms spread over the lanes (west to east), the gusts, the riders.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function wind(e, h, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player.position;
  const R = windRect(e);
  if (e.state === 'windup') {
    if (e.entered) {
      const n = e.phase === 3 ? 3 : 2;
      const zs = n === 3 ? [P.z, P.z - WIND.apart, P.z + WIND.apart] : [P.z, P.z + (e.rng.next() < 0.5 ? -1 : 1) * WIND.apart];
      ai.windN = n;
      for (let k = 0; k < 3; k++) {
        ctx.freeMarker(ai.windH[k]);
        ai.windH[k] = -1;
        if (k >= n) continue;
        const z = Math.min(R.maxZ - WIND.width / 2, Math.max(R.minZ + WIND.width / 2, zs[k]));
        ai.windZ[k] = z;
        ai.windH[k] = ctx.marker({ shape: 'lane', x: R.minX, z, y: 0.03, dirX: 1, dirZ: 0, len: R.maxX - R.minX, width: WIND.width, progress: 0, style: FROST, alpha: 1, flash: 0 });
      }
      ai.riders = 0;
      ctx.sfx('windGust', p.x, p.z, { volume: 0.6, pitch: 0.8 });
    }
    show(e, 'gustWind');
    const prog = Math.min(1, e.t / F(WIND.windup));
    for (let k = 0; k < ai.windN; k++) if (ai.windH[k] >= 0) ctx.setMarker(ai.windH[k], { progress: prog });
    if (e.after(WIND.windup)) {
      ai.nextTick = 0;
      ctx.sfx('windGust', p.x, p.z, { volume: 1 });
      for (let k = 0; k < ai.windN; k++) {
        if (ai.windH[k] >= 0) ctx.setMarker(ai.windH[k], { progress: 1 });
        for (let x = R.minX + 2; x < R.maxX - 1; x += 4.2) ctx.fx('evgGust', x, ctx.groundAt(x, ai.windZ[k]), ai.windZ[k], { ...FX.gust, dirX: 1, dirZ: 0 });
      }
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    show(e, 'gust');
    if (e.t >= ai.nextTick - EPS) {
      ai.nextTick += F(WIND.every);
      for (let k = 0; k < ai.windN; k++) {
        const s = e.hitSpec();
        s.shape = 'lane';
        s.x = R.minX;
        s.z = ai.windZ[k];
        s.y = ctx.groundAt((R.minX + R.maxX) / 2, ai.windZ[k]);
        s.dirX = 1;
        s.dirZ = 0;
        s.len = R.maxX - R.minX;
        s.width = WIND.width;
        s.mv = WIND.mv;
        s.kb = WIND.kb;
        // (pushed east: the knockback comes from far west of the lane)
        s.fromX = R.minX - 30;
        s.fromZ = ai.windZ[k];
        s.tag = e.newTag();
        ctx.hitbox(e, s);
      }
    }
    if (everyF(e, h, 6)) {
      for (let k = 0; k < ai.windN; k++) {
        const x = R.minX + 1 + ((e.fr * 7 + k * 5) % 9);
        ctx.burst('evgLeaves', x, ctx.groundAt(x, ai.windZ[k]) + 0.9, ai.windZ[k], 3, { velocity: [7.5, 0.4, 0] });
      }
    }
    // the crows ride in from the west end (the pool's; at most three out)
    if (everyF(e, h, 16) && e.t > F(4) && e.t < F(40)) {
      if (ai.riders < WIND.riders && aliveAdds(ai) < WIND.maxCrows) {
        const k = ai.riders % ai.windN;
        const add = ctx.spawnAdd(ADD_KIND, R.minX + 1, ai.windZ[k], ADD_LEVEL);
        if (add && !ai.adds.includes(add)) ai.adds.push(add);
        ai.riders++;
      }
    }
    if (e.after(WIND.active)) {
      for (let k = 0; k < 3; k++) {
        ctx.freeMarker(ai.windH[k]);
        ai.windH[k] = -1;
      }
      e.setState('recover');
    }
    return;
  }
  show(e, e.t < F(14) ? 'gust' : 'idle0');
  if (e.after(WIND.recover)) endMove(e);
}

/** The wind's span: the arena (inset 0.5), or 10 u round the Mawkin without one. @param {Enemy} e @returns {RectXZ} */
function windRect(e) {
  const r = inset(e, 0.5);
  if (r) return r;
  const p = e.position;
  return { minX: p.x - 10, maxX: p.x + 10, minZ: p.z - 8, maxZ: p.z + 8 };
}

/**
 * The Reaping: the scythe planted; the rows of frost stalks start (north to south, one every 16 f).
 * @param {Enemy} e @param {CombatContext} ctx
 */
function reaping(e, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  if (e.state === 'windup') {
    show(e, 'call');
    if (e.entered) {
      ctx.sfx('iceCrack', p.x, p.z, { volume: 0.9, pitch: 0.7 });
      ctx.fx('evgFrostBurst', p.x, p.y, p.z, FX.burst);
    }
    if (e.after(REAPING.windup)) {
      const R = windRect(e);
      ai.rowN = 0;
      for (let z = R.minZ + 1.1; z <= R.maxZ - 0.6 && ai.rowN < REAPING.maxRows; z += REAPING.apart) {
        const row = ai.rows[ai.rowN];
        row.on = true;
        row.z = z;
        row.gx = R.minX + REAPING.gap / 2 + e.rng.next() * (R.maxX - R.minX - REAPING.gap);
        row.t = -F(ai.rowN * REAPING.every);
        row.h1 = -1;
        row.h2 = -1;
        row.done = false;
        ai.rowN++;
      }
      e.setState('active');
    }
    return;
  }
  if (e.state === 'active') {
    show(e, 'call');
    let live = false;
    for (let i = 0; i < ai.rowN; i++) if (ai.rows[i].on) live = true;
    if (!live) e.setState('recover');
    return;
  }
  show(e, e.t < F(30) ? 'call' : 'idle0');
  if (e.after(REAPING.recover)) endMove(e);
}

/**
 * Every sub-step: the Reaping's rows — each a lane in two parts round its gap, filling 36 f, then
 * erupting (a hit per part, stalks along it), its markers freed 5 f later. They run on while the
 * Mawkin does anything else (its death clears them).
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 */
function rowsStep(e, h, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  if (!ai.rowN) return;
  const R = windRect(e);
  for (let i = 0; i < ai.rowN; i++) {
    const row = ai.rows[i];
    if (!row.on) continue;
    row.t += h;
    if (row.t < 0) continue;
    const g0 = row.gx - REAPING.gap / 2;
    const g1 = row.gx + REAPING.gap / 2;
    if (row.h1 < 0 && row.h2 < 0 && !row.done) {
      if (g0 - R.minX > 0.4) row.h1 = ctx.marker({ shape: 'lane', x: R.minX, z: row.z, y: 0.03, dirX: 1, dirZ: 0, len: g0 - R.minX, width: REAPING.width, progress: 0, style: CRACK, alpha: 1, flash: 0 });
      if (R.maxX - g1 > 0.4) row.h2 = ctx.marker({ shape: 'lane', x: g1, z: row.z, y: 0.03, dirX: 1, dirZ: 0, len: R.maxX - g1, width: REAPING.width, progress: 0, style: CRACK, alpha: 1, flash: 0 });
    }
    const prog = Math.min(1, row.t / F(REAPING.fill));
    if (!row.done) {
      if (row.h1 >= 0) ctx.setMarker(row.h1, { progress: prog });
      if (row.h2 >= 0) ctx.setMarker(row.h2, { progress: prog });
    }
    if (!row.done && row.t >= F(REAPING.fill) - EPS) {
      row.done = true;
      const gy = ctx.groundAt((R.minX + R.maxX) / 2, row.z);
      for (const [x0, x1] of [[R.minX, g0], [g1, R.maxX]]) {
        if (x1 - x0 <= 0.4) continue;
        const s = e.hitSpec();
        s.shape = 'lane';
        s.x = x0;
        s.z = row.z;
        s.y = gy;
        s.dirX = 1;
        s.dirZ = 0;
        s.len = x1 - x0;
        s.width = REAPING.width;
        s.mv = REAPING.mv;
        s.kb = REAPING.kb;
        s.fromX = (x0 + x1) / 2;
        s.fromZ = row.z - 2;
        s.tag = e.newTag();
        ctx.hitbox(e, s);
        for (let x = x0 + 0.6; x < x1 - 0.3; x += 1.5) ctx.fx('evgStalk', x, ctx.groundAt(x, row.z), row.z, FX.stalk);
        ctx.burst('evgShards', (x0 + x1) / 2, gy + 0.4, row.z, 6);
      }
      ctx.sfx('iceBreak', (R.minX + R.maxX) / 2, row.z, { volume: 0.6 });
      if (row.h1 >= 0) ctx.setMarker(row.h1, { progress: 1 });
      if (row.h2 >= 0) ctx.setMarker(row.h2, { progress: 1 });
    }
    if (row.done && row.t >= F(REAPING.fill + 5) - EPS) {
      ctx.freeMarker(row.h1);
      ctx.freeMarker(row.h2);
      row.h1 = -1;
      row.h2 = -1;
      row.on = false;
    }
  }
}

/** End every row (their markers freed). @param {Enemy} e @param {CombatContext} ctx */
function clearRows(e, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  for (const row of ai.rows) {
    if (!row.on) continue;
    ctx.freeMarker(row.h1);
    ctx.freeMarker(row.h2);
    row.h1 = -1;
    row.h2 = -1;
    row.on = false;
  }
  ai.rowN = 0;
}

// -------------------------------------------------------------------------------------------------
// crows
// -------------------------------------------------------------------------------------------------

/**
 * A burst of `n` crows taking flight from (x, y, z): FX crows following points that fly up and
 * out (seeded directions; the flock's eight points reused).
 * @param {Enemy} e @param {CombatContext} ctx @param {number} n @param {number} x @param {number} y @param {number} z
 */
function flock(e, ctx, n, x, y, z) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  let made = 0;
  for (const c of ai.flock) {
    if (made >= n) break;
    if (c.on) continue;
    const a = e.rng.next() * Math.PI * 2;
    const sp = 2.6 + e.rng.next() * 2.2;
    c.on = true;
    c.x = x + Math.cos(a) * 0.5;
    c.y = y + e.rng.next() * 0.6;
    c.z = z + Math.sin(a) * 0.3;
    c.vx = Math.cos(a) * sp;
    c.vz = Math.sin(a) * sp * 0.5;
    c.vy = 2.0 + e.rng.next() * 1.6;
    c.t = 0;
    ctx.fx('evgCrow', c.x, c.y, c.z, { mode: 'billboard', color: CROW, loop: true, duration: 1.6, scale: 1.3, follow: c, flip: c.vx < 0, fps: 12 + (made % 3) * 2 });
    made++;
  }
}

/** Fly the flock's points (up and away). @param {Enemy} e @param {number} h */
function flockStep(e, h) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  for (const c of ai.flock) {
    if (!c.on) continue;
    c.t += h;
    c.x += c.vx * h;
    c.y += c.vy * h;
    c.z += c.vz * h;
    c.vy += 0.6 * h;
    if (c.t > 1.7) c.on = false;
  }
}

// -------------------------------------------------------------------------------------------------
// the release
// -------------------------------------------------------------------------------------------------

/**
 * One sub-step of the release (see the module comment). True: the brain keeps the body.
 * @param {Enemy} e @param {number} h @param {CombatContext} ctx
 * @returns {boolean}
 */
function releaseStep(e, h, ctx) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  if (ai.relAll === 0) {
    // (Enemy.die showed its own `dead` pose after `die`: take the frames over again)
    e.anim('idle');
    ai.col = -1;
    if (!ai.rel) ai.rel = 'burst';
  }
  ai.relT += h;
  ai.relAll += h;
  const t = ai.relT;
  switch (ai.rel) {
    case 'burst':
      show(e, 'collapse0');
      if (t >= REL.burst) {
        relNext(e, 'tip');
        ctx.burst('evgStraw', p.x, p.y + 1.8, p.z, 10);
      }
      break;
    case 'tip':
      show(e, 'collapse1');
      if (t >= REL.tip) {
        relNext(e, 'crumple');
        ctx.burst('evgStraw', p.x, p.y + 0.8, p.z, 12);
        ctx.sfx('iceCrack', p.x, p.z, { volume: 0.5, pitch: 1.3 });
      }
      break;
    case 'crumple':
      show(e, 'collapse2');
      if (t >= REL.crumple) {
        relNext(e, 'heap');
        ctx.burst('evgStraw', p.x, p.y + 0.4, p.z, 10);
        ctx.burst('evgFrost', p.x, p.y + 0.3, p.z, 6);
        flock(e, ctx, 4, p.x, p.y + 1.2, p.z);
        ctx.sfx('crowFlock', p.x, p.z, { volume: 0.6 });
      }
      break;
    case 'heap':
      show(e, 'heap');
      if (ai.relAll >= REL.wait && thawField.reached(p.x, p.z)) relNext(e, 'blow');
      break;
    case 'blow':
      show(e, 'heap');
      ai.relFx -= h;
      if (ai.relFx <= 0) {
        ai.relFx = 0.2;
        ctx.burst('evgLeaves', p.x, p.y + 0.6, p.z, 3, { velocity: [3.2, 0.8, 0] });
        ctx.burst('evgStraw', p.x, p.y + 0.4, p.z, 3);
      }
      // (kept above core's cut-off — a body at ≤ 0.001 is no longer updated — until the stage ends)
      e.sprite.opacity = Math.max(0.01, 1 - t / REL.fade);
      if (t >= REL.fade - 1e-6) relNext(e, 'gone');
      break;
    default:
      e.sprite.opacity = 0;
  }
  return true;
}

/** @param {Enemy} e @param {MawkinAI['rel']} stage */
function relNext(e, stage) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  ai.rel = stage;
  ai.relT = 0;
  ai.relFx = 0;
  if (stage === 'gone') e.sprite.opacity = 0;
}

// -------------------------------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------------------------------

/**
 * Does this sub-step — the state's time [e.t, e.t + h) — hold a multiple of `n` frames (its frame 0
 * included)? Once per multiple whatever the step's length (a chilled boss steps less than a frame).
 * @param {Enemy} e @param {number} h @param {number} n
 */
function everyF(e, h, n) {
  const t0 = e.t * 60 - 1e-6;
  return Math.floor((t0 + h * 60) / n) !== Math.floor(t0 / n);
}


/**
 * Turn the facing toward a point at `rate` rad/s (Infinity: at once).
 * @param {Enemy} e @param {number} x @param {number} z @param {number} h @param {number} rate
 */
function turnToward(e, x, z, h, rate) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  const want = Math.atan2(x - p.x, z - p.z);
  ai.yaw = Math.atan2(e.facing.x, e.facing.z);
  let d = want - ai.yaw;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const max = rate === Infinity ? Math.PI : rate * h;
  ai.yaw += Math.max(-max, Math.min(max, d));
  e.faceDir(Math.sin(ai.yaw), Math.cos(ai.yaw));
}

/** @param {Enemy} e @param {number} m @returns {RectXZ|null} */
function inset(e, m) {
  const a = e.arena;
  if (!a) return null;
  const ai = /** @type {MawkinAI} */ (e.ai);
  const r = ai.inset ?? (ai.inset = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  r.minX = a.rect.minX + m;
  r.maxX = a.rect.maxX - m;
  r.minZ = a.rect.minZ + m;
  r.maxZ = a.rect.maxZ - m;
  return r;
}

/** Live adds shown by this brain. @param {MawkinAI} ai @returns {number} */
function aliveAdds(ai) {
  let n = 0;
  for (const a of ai.adds) if (a.alive) n++;
  return n;
}

/**
 * `n` Rime Crows at the arena's corners (inset 2 u) farthest from the player.
 * @param {Enemy} e @param {CombatContext} ctx @param {number} n
 */
function spawnCorners(e, ctx, n) {
  const ai = /** @type {MawkinAI} */ (e.ai);
  const p = e.position;
  const P = ctx.player.position;
  const r = e.arena ? e.arena.rect : { minX: p.x - 8, maxX: p.x + 8, minZ: p.z - 6, maxZ: p.z + 6 };
  const corners = [[r.minX + 2, r.minZ + 2], [r.maxX - 2, r.minZ + 2], [r.minX + 2, r.maxZ - 2], [r.maxX - 2, r.maxZ - 2]];
  corners.sort((u, v) => Math.hypot(v[0] - P.x, v[1] - P.z) - Math.hypot(u[0] - P.x, u[1] - P.z));
  for (let i = 0; i < n; i++) {
    const add = ctx.spawnAdd(ADD_KIND, corners[i][0], corners[i][1], ADD_LEVEL);
    if (add && !ai.adds.includes(add)) ai.adds.push(add);
  }
}

/**
 * Register the Harvest Mawkin (once per page: ./index.js): its sheet and its brain. (The FX frames
 * and presets it uses are the guardians' shared ones, registered by ./rimehart.js.)
 * @param {EnemyPackApi} api
 */
export function register(api) {
  api.registerMonsterKind('mawkin', mawkinSheet);
  api.registerBrain('mawkin', mawkinBrain);
}
