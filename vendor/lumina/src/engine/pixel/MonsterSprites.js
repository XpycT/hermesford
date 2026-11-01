/**
 * MonsterSprites.js — enemy sprite sheets for combat levels (COMBAT.md §10.3).
 *
 * `createEnemySheet(kind)` returns a SpriteSheet (the createCharacterSheet shape) plus
 * `{ kind, poses, spriteOptions }`: rows = DIRECTIONS (down, left, right, up, with a real `right`
 * row — the left drawing mirrored by `resolvePainter`), `idle_<d>` / `walk_<d>` / `run_<d>`
 * animations, and `poses` (pose name → column, aliases included) for the combat state machine's
 * `sprite.setFrame(poses[name], row)`. `spriteOptions` holds only Sprite3D option keys; the game
 * spreads it into the sprite options (`{ ...CHARACTER_SPRITE_OPTS, ...sheet.spriteOptions, combatFx: true }`).
 *
 * Art: the monsters (slime, bat, boar, dummy, golem) are painted like the creatures of
 * CharacterSprites.js — shaded parts in a (material, shade) label buffer, 5-tone ramps, the dark
 * plum silhouette outline, light from the upper left — through its `_painterKit`. The humanoids
 * (goblin, archer, shaman) are `createCharacterSheet(spec, { combat: true })` sheets. Glow texels
 * (magma cracks, crown embers, bat eyes, the shaman's gem) are painted with alpha 204 so a
 * `combatFx` sprite's `setGlow` lights exactly them. New material ids 35–39 (GEL, BONE, GLOW,
 * STONE, WING). Painting is RNG-free (fixed layouts and `hash2` lattice noise with fixed seeds).
 */
import { createCharacterSheet, COMBAT_POSE_NAMES, _painterKit } from './CharacterSprites.js';
import { PixelCanvas } from './PixelCanvas.js';
import { DIRECTIONS, PPU } from '../constants.js';
import { hash2 } from '../utils/math.js';
// the kinds of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §5.3): one module per
// kind, each its package's (brutes: drakeborn / ashhound / wyrmcaller; swarm: kobold / whelp /
// emberimp; dragon: dragon) — a factory of its KINDS entry from the MONSTER_KIT below
import { drakeborn } from './monsters/drakeborn.js';
import { ashhound } from './monsters/ashhound.js';
import { wyrmcaller } from './monsters/wyrmcaller.js';
import { kobold } from './monsters/kobold.js';
import { whelp } from './monsters/whelp.js';
import { emberimp } from './monsters/emberimp.js';
import { dragon } from './monsters/dragon.js';

/** @import * as THREE from 'three' */

const { Painter, resolvePainter, M, blob, quadGait, quadLeg, tailChain, rampForKind, finishTexture, glowTexel, OUTLINE } = _painterKit;

/**
 * An enemy kind with a sheet (ObjectCatalog.ENEMY_KINDS; the `kind` of createEnemySheet): the kinds
 * of this file and the lazy enemy packs' (src/game/combat/packs/: The Bells of Evermere's eight,
 * docs/contracts/EVERMERE_CAMPAIGN.md §5.4), which have a sheet once their pack registered it
 * (`registerMonsterKind`).
 * @typedef {'slime'|'goblin'|'archer'|'shaman'|'bat'|'boar'|'dummy'|'golem'
 *   |'drakeborn'|'ashhound'|'wyrmcaller'|'kobold'|'whelp'|'emberimp'|'dragon'
 *   |'hushguard'|'frostwolf'|'rimecrow'|'cantor'|'rimehart'|'mawkin'|'gullet'|'hushedking'|'tentacle'} EnemySheetKind
 */

/**
 * Every enemy kind with a sheet from the start (the packs' kinds are not listed: they register at
 * load; the `kind` of createEnemySheet).
 * @type {readonly EnemySheetKind[]}
 */
export const ENEMY_SHEET_KINDS = Object.freeze(['slime', 'goblin', 'archer', 'shaman', 'bat', 'boar', 'dummy', 'golem',
  'drakeborn', 'ashhound', 'wyrmcaller', 'kobold', 'whelp', 'emberimp', 'dragon']);

/** The widest sheet texture a kind may paint (columns × frame width; WebGL 2's guaranteed minimum 4096). */
const MAX_SHEET_PX = 4096;

/** Columns 0–9 shared by the monster (non-humanoid) sheets. */
const COMMON = ['idle0', 'idle1', 'move0', 'move1', 'move2', 'move3', 'windup', 'attack', 'hurt', 'dead'];
/** Humanoid columns: the character combat sheet (plain 0–5 + COMBAT_POSE_NAMES 6–17). */
const HUMANOID = ['idle0', 'idle1', 'walk0', 'walk1', 'walk2', 'walk3', ...COMBAT_POSE_NAMES];
const HUMANOID_MOVE = { move0: 'walk0', move1: 'walk1', move2: 'walk2', move3: 'walk3' };

// ---------------------------------------------------------------------------
// Shared painting helpers
// ---------------------------------------------------------------------------

/** 40 material ramps from { materialId: colour spec | explicit 5-tone array }; the rest fall back to `fallback`. */
function makeRamps(spec, fallback) {
  const ramps = new Array(40).fill(null);
  for (const [id, v] of Object.entries(spec)) ramps[id] = Array.isArray(v) && Array.isArray(v[0]) ? v : rampForKind(v);
  ramps[M.LINE] = [OUTLINE, OUTLINE, OUTLINE, OUTLINE, OUTLINE];
  const fb = ramps[fallback];
  for (let i = 0; i < 40; i++) if (!ramps[i]) ramps[i] = fb;
  return ramps;
}

/** Explicit dark → light ramp of five hex colours. */
const ramp5 = (hexes) => rampForKind(hexes);

/** A glow ramp: the colours as glow texels (alpha 204). */
const glowRamp = (hexes) => rampForKind(hexes).map(glowTexel);

/** Eye ramp [outline, dark, iris, light, white]. */
function eyeRamp(iris, light) {
  const c = rampForKind([iris, iris, iris, light, '#ffffff']);
  return [OUTLINE, c[1], c[2], c[3], [255, 255, 255, 255]];
}

/** Fill a polygon (screen points) with a material; `shade(x, y)` gives each pixel's tone. */
function fillPoly(p, pts, mat, shade) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      if (!inPoly(x + 0.5, y + 0.5, pts)) continue;
      const s = typeof shade === 'function' ? shade(x, y) : shade;
      if (s != null) p.set(x, y, mat, s);
    }
  }
}

/** Crossing-number point-in-polygon test. */
function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Thick line (`w` px) between two points with a shade function of t (0 → 1). */
function thickLine(p, x0, y0, x1, y1, w, mat, shade) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  const r = w / 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r * r + 0.01) continue;
        p.set(x, y, mat, typeof shade === 'function' ? shade(t, x, y) : shade);
      }
    }
  }
}

/**
 * Chiselled rock chunk: a jagged star polygon (facet vertices on an ellipse, radii jittered by a
 * fixed lattice hash) with a flat inner face and bevel facets shaded by their direction to the light
 * (upper left), a bright chipped rim on the lit side. `seed` picks the jitter (deterministic).
 */
function rock(p, cx, cy, rx, ry, mat, seed, { facets = 8, rot = 0.3, face = 0.55, faceShade = 2, lift = 0 } = {}) {
  const TAU = Math.PI * 2;
  const vx = new Float32Array(facets + 1), vy = new Float32Array(facets + 1), shadeK = new Int8Array(facets);
  for (let k = 0; k <= facets; k++) {
    const a = rot + ((k % facets) / facets) * TAU;
    const j = 1 - 0.16 * hash2(k % facets, 3, seed);
    vx[k] = Math.cos(a) * j; vy[k] = Math.sin(a) * j;
  }
  for (let k = 0; k < facets; k++) {
    const am = rot + ((k + 0.5) / facets) * TAU;
    const l = -(Math.cos(am) * 0.62 + Math.sin(am) * 0.78);
    shadeK[k] = l > 0.5 ? 3 : l > -0.05 ? 2 : l > -0.6 ? 1 : 0;
  }
  let sector = 0;
  // inside test of normalised (nx, ny): the ray's radius against the facet edge of its sector;
  // returns r / boundary (< 1 inside) and leaves the sector in `sector`
  const ratio = (nx, ny) => {
    const r = Math.sqrt(nx * nx + ny * ny);
    if (r < 1e-6) { sector = 0; return 0; }
    let u = (Math.atan2(ny, nx) - rot) / TAU;
    u -= Math.floor(u);
    const k = Math.min(facets - 1, (u * facets) | 0);
    sector = k;
    const ex = vx[k + 1] - vx[k], ey = vy[k + 1] - vy[k];
    const t = (vx[k] * ey - vy[k] * ex) / ((nx / r) * ey - (ny / r) * ex);
    return r / t;
  };
  const x0 = Math.floor(cx - rx - 1), x1 = Math.ceil(cx + rx + 1);
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    const ny = (y + 0.5 - cy) / ry;
    for (let x = x0; x <= x1; x++) {
      const q = ratio((x + 0.5 - cx) / rx, ny);
      if (q >= 1) continue;
      let s;
      if (q < face) s = faceShade + lift;
      else {
        const k = sector;
        s = shadeK[k] + lift;
        // chipped bright rim on the lit side (the upper-left neighbour lies outside)
        if (shadeK[k] >= 2 && ratio((x - 0.5 - cx) / rx, (y - 0.5 - cy) / ry) >= 1) s = 4 + Math.min(0, lift);
      }
      p.set(x, y, mat, s < 0 ? 0 : s > 4 ? 4 : s);
    }
  }
}

/** Jagged glowing crack along a polyline (glow texels; `s` = tone, 3 = hot). */
function crack(p, pts, s = 3, mat = M.GLOW) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    p.line2(x0, y0, x1, y1, mat, (t) => (t < 0.15 && i === 0 ? Math.min(4, s + 1) : s));
  }
}

/** Keep every frame inside a transparent 1 px margin (the outline needs the next pixel; SPR-04). */
function clipMargin(p) {
  const { w, h, mat } = p;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x > 1 && x < w - 2 && y > 1 && y < h - 1) continue;
      mat[y * w + x] = 0;
    }
  }
}

/** Shear the painted labels sideways about a base row: x' = x + round((base − y) · k). */
function shear(p, k, base) {
  const { w, h, mat, shade } = p;
  const m2 = new Uint8Array(w * h), s2 = new Int8Array(w * h);
  for (let y = 0; y < h; y++) {
    const dx = Math.round((base - y) * k);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mat[i]) continue;
      const tx = x + dx;
      if (tx < 0 || tx >= w) continue;
      m2[y * w + tx] = mat[i]; s2[y * w + tx] = shade[i];
    }
  }
  mat.set(m2); shade.set(s2);
}

// ---------------------------------------------------------------------------
// Slime — translucent teal gel with a moss tuft and a leaf sprout (20 × 16)
// ---------------------------------------------------------------------------

/** Body ellipse per pose: rx, ry (px), lift (px above the ground), lean (side view, − = forward), face. */
const SLIME_SHAPES = {
  idle0: { rx: 6.8, ry: 4.3 },
  idle1: { rx: 7.2, ry: 4.0 },
  move0: { rx: 7.6, ry: 3.6 },                         // crouch before the hop
  move1: { rx: 5.6, ry: 5.0, lean: -1 },               // launch, stretched
  move2: { rx: 6.2, ry: 4.6, lift: 1 },                // airborne (the arc itself is mesh.position.y)
  move3: { rx: 5.8, ry: 4.9, lean: 1 },                // falling, stretched
  windup: { rx: 7.8, ry: 3.3, face: 'fierce' },        // deep squash
  attack: { rx: 7.4, ry: 4.2, lift: 1, lean: -2, face: 'fierce', stretch: true }, // leap
  hurt: { rx: 7.1, ry: 3.9, face: 'hurt', dent: true },
  dead: { rx: 7.8, ry: 2.0, face: 'dead', splat: true },
  land: { rx: 7.8, ry: 3.5 },
};

function drawSlime(p, view, key, f) {
  const S = SLIME_SHAPES[key];
  const G = f.G;
  const side = view === 'side';
  const cx = 10 + (side ? (S.lean ?? 0) : 0);
  const rx = side && S.stretch ? S.rx + 0.4 : !side && S.stretch ? S.rx - 1.4 : S.rx;
  const ry = !side && S.stretch ? S.ry + 0.8 : S.ry;
  const lift = S.lift ?? 0;
  const cy = G + 1 - ry - lift;
  const bottom = G - lift;
  // splat droplets
  if (S.splat) {
    p.begin(null);
    for (const [x, y] of [[3, G], [4, G], [16, G - 1], [15, G]]) p.set(x, y, M.GEL, 2);
    p.end();
  }
  // trailing drop of the leap (side view, behind the body)
  if (side && S.stretch) {
    p.begin(null);
    blob(p, cx + rx - 0.5, cy + 1.5, 2.2, 1.6, M.GEL, { hi: 0.2, lo: -0.4 });
    p.end();
  }
  // gel body: flat base, rim light through the gel at the bottom, bright upper-left rim
  p.begin(null);
  for (let y = Math.floor(cy - ry); y <= bottom; y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x + 0.5 - cx) / rx;
      let dy = (y + 0.5 - cy) / ry;
      if (dy > 0) dy *= 0.72; // fuller, flatter base
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const l = -dx * 0.55 - dy * 0.8;
      let s = l > 0.45 ? 3 : l > -0.2 ? 2 : 1;
      if (d < 0.3 && dy > -0.2) s = Math.min(s, 2);                     // denser core
      if (y === bottom) s = 1;                                          // contact
      else if (y === bottom - 1 && Math.abs(dx) < 0.8) s = 3;           // light through the gel
      if (d > 0.62 && l > 0.25) s = 4;                                  // bright rim
      p.set(x, y, M.GEL, s);
    }
  }
  if (S.dent) { for (let x = Math.round(cx) - 1; x <= Math.round(cx) + 1; x++) p.erase(x, Math.floor(cy - ry)); }
  // specular highlight and a bubble
  const hx = Math.round(cx - rx * 0.45), hy = Math.round(cy - ry * 0.45);
  p.over(hx, hy, M.GEL, 4); p.over(hx + 1, hy, M.GEL, 4); p.over(hx, hy + 1, M.GEL, 4);
  p.over(Math.round(cx + rx * 0.35), Math.round(cy + ry * 0.15), M.GEL, 3);
  p.end();
  // face
  const face = S.face ?? 'calm';
  const ey = Math.round(cy - (S.splat ? 0.5 : 0.2));
  const eyes = view === 'down' ? [Math.round(cx - 3), Math.round(cx + 2)] : side ? [Math.round(cx - rx * 0.62)] : [];
  p.begin(null);
  for (const ex of eyes) {
    if (face === 'hurt') { p.set(ex - 1, ey, M.EYE, 0); p.set(ex, ey + 1, M.EYE, 0); p.set(ex + 1, ey, M.EYE, 0); continue; }
    if (face === 'dead') { p.set(ex, ey, M.EYE, 0); p.set(ex + 1, ey + 1, M.EYE, 0); p.set(ex + 1, ey, M.EYE, 1); p.set(ex, ey + 1, M.EYE, 1); continue; }
    p.set(ex, ey, M.EYE, 0); p.set(ex + 1, ey, M.EYE, 0); p.set(ex, ey + 1, M.EYE, 0); p.set(ex + 1, ey + 1, M.EYE, 0);
    p.set(ex, ey, M.EYE, 4); // catch light
    if (face === 'fierce') { p.set(ex - 1, ey - 1, M.GEL, 0); p.set(ex, ey - 1, M.GEL, 0); p.set(ex + 1, ey - 1, M.GEL, 0); }
  }
  if (view === 'down' && face !== 'dead') {
    const mx = Math.round(cx - 0.5), my = ey + 2;
    p.set(mx, my, M.EYE, 0); p.set(mx + 1, my, M.EYE, 0);
    if (face === 'fierce' || face === 'hurt') p.set(mx, my + 1, M.EYE, 1);
  } else if (side && face !== 'dead') p.set(eyes[0] - 1, ey + 2, M.EYE, 0);
  p.end();
  // moss tuft and leaf sprout on top (lying flat on the splat)
  const top = Math.floor(cy - ry) + (S.dent ? 1 : 0);
  const mx = Math.round(cx - (side ? -0.5 : 0.5));
  p.begin('below', 1);
  if (S.splat) {
    for (let x = mx - 2; x <= mx + 1; x++) p.set(x, top, M.FUR, x < mx ? 3 : 2);
    p.set(mx + 2, top, M.FUR2, 3); p.set(mx + 3, top, M.FUR2, 2);
  } else {
    for (let x = mx - 2; x <= mx + 2; x++) p.set(x, top, M.FUR, x < mx ? 3 : x === mx ? 2 : 1);
    for (let x = mx - 1; x <= mx + 1; x++) p.set(x, top - 1, M.FUR, x < mx + 1 ? 3 : 2);
    p.set(mx - 3, top + 1, M.FUR, 2); p.set(mx + 3, top + 1, M.FUR, 1); // drips of moss
    // sprout: short stem, two leaves (the leaf flips with the hop)
    const lean = key === 'move1' || key === 'attack' ? 1 : key === 'move3' ? -1 : 0;
    p.set(mx + lean, top - 2, M.FUR2, 1);
    p.set(mx + 1 + lean, top - 3, M.FUR2, 3); p.set(mx + 2 + lean, top - 3, M.FUR2, 4); p.set(mx + 2 + lean, top - 4, M.FUR2, 3);
    p.set(mx - 1 + lean, top - 3, M.FUR2, 2);
  }
  p.end();
}

// ---------------------------------------------------------------------------
// Bat — charcoal body and bones, ember-orange membranes, glowing eyes (20 × 20)
// ---------------------------------------------------------------------------

/** Wing shapes: wrist and three finger tips relative to the shoulder (screen-right wing, front view). */
const BAT_WINGS = {
  up: { wrist: [3, -5], tips: [[5, -8], [7, -6], [7, -2]] },
  mid: { wrist: [4, -2], tips: [[7, -3], [8, 0], [6, 3]] },
  down: { wrist: [3, 1], tips: [[7, 2], [6, 5], [3, 6]] },
  high: { wrist: [2, -6], tips: [[3, -9], [6, -8], [7, -4]] },
  swept: { wrist: [2, -3], tips: [[3, 2], [4, 4], [2, 5]] },
  crumple: { wrist: [3, 0], tips: [[4, 4], [6, 2], [2, 5]] },
  fold: { wrist: [1, -2], tips: [[1, 3], [2, 3], [0, 4]] },
};

/** Per pose: [screen-left wing, screen-right wing] shapes, eyes, body offset. */
const BAT_POSES = {
  idle0: { wings: ['up', 'up'] }, idle1: { wings: ['down', 'down'] },
  move0: { wings: ['up', 'up'] }, move1: { wings: ['mid', 'mid'] }, move2: { wings: ['down', 'down'], dy: 1 }, move3: { wings: ['mid', 'mid'], dy: -1 },
  windup: { wings: ['high', 'high'], eyes: 'wide', dy: -1 },
  attack: { wings: ['swept', 'swept'], eyes: 'wide', dy: 1 },
  hurt: { wings: ['crumple', 'up'], eyes: 'shut' },
  dead: { wings: ['fold', 'fold'], eyes: 'dead', dy: 2 },
};

/**
 * One wing: a membrane between the arm bone (shoulder → wrist) and three fingers (wrist → tips),
 * its trailing edge scalloped between the finger tips; bones drawn over it. `dir` = ±1 (outward),
 * `sx` = x scale (side views foreshorten the wing), `tone` = 0 (far / back) … 2 (lit).
 */
function batWing(p, x0, y0, shape, dir, tone, sx = 0.85) {
  const W = BAT_WINGS[shape];
  const pt = ([x, y]) => [x0 + x * dir * sx, y0 + y];
  const wrist = pt(W.wrist);
  const tips = W.tips.map(pt);
  const hip = [x0 + 0.5 * dir, y0 + 3.2];
  const scallop = (a, b) => {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return [m[0] + (wrist[0] - m[0]) * 0.38, m[1] + (wrist[1] - m[1]) * 0.38];
  };
  const poly = [[x0, y0 - 0.6], wrist, tips[0]];
  for (let i = 0; i + 1 < tips.length; i++) poly.push(scallop(tips[i], tips[i + 1]), tips[i + 1]);
  poly.push(scallop(tips[tips.length - 1], hip), hip);
  fillPoly(p, poly, M.WING, (x, y) => {
    // lit near the arm (the membrane is thin and glows ember-orange there), dark toward the trailing edge
    const d = Math.hypot(x + 0.5 - wrist[0], y + 0.5 - wrist[1]);
    return Math.max(0, (d < 2.4 ? 3 : d < 4.6 ? 2 : 1) + tone - 1);
  });
  const bone = Math.min(4, tone + 2);
  p.line2(x0, y0, wrist[0], wrist[1], M.FUR, Math.min(4, bone + 1));
  for (const t of tips) p.line2(wrist[0], wrist[1], t[0], t[1], M.FUR, bone);
  p.set(Math.round(wrist[0]), Math.round(wrist[1]) - 1, M.BONE, 2); // thumb claw
}

function drawBat(p, view, key) {
  const P = BAT_POSES[key];
  const dy = P.dy ?? 0;
  const cy = 11 + dy;
  const eyeS = P.eyes === 'wide' ? 4 : 3;
  if (view === 'side') {
    // facing left: both wings stroke behind the body (the far one darker, higher and further back,
    // outlined off the near one), so the body stays whole — a round, furry three-quarter profile
    // under a big head with a tall pointed ear, the snout, a glowing eye and a fang
    const [w0, w1] = P.wings;
    p.begin(null); batWing(p, 13, cy - 3, w1, 1, 0, 0.6); p.end();
    p.begin('all', 0); batWing(p, 11.5, cy - 2, w0, 1, 2, 0.85); p.end();
    p.begin('all', 0);
    blob(p, 11, cy + 0.8, 3.2, 3, M.FUR, { hi: 0.4, lo: -0.3 });
    for (let y = cy; y <= cy + 2; y++) { p.over(9, y, M.FUR, 3); p.over(10, y, M.FUR, 2); } // chest ruff
    p.set(11, cy + 4, M.FUR, 1); p.set(12, cy + 4, M.FUR, 0); // feet
    p.end();
    // the head, outlined off the body: a tall pointed ear (the far one behind it), the snout
    p.begin('all', 0);
    blob(p, 7.5, cy - 1.8, 3, 2.7, M.FUR, { hi: 0.3, lo: -0.3 });
    p.set(10, cy - 6, M.FUR, 1); p.set(10, cy - 5, M.FUR, 1); // far ear
    p.set(8, cy - 7, M.FUR, 4); p.set(8, cy - 6, M.FUR, 3); p.set(9, cy - 6, M.FUR, 2); p.set(8, cy - 5, M.FUR, 3); p.set(9, cy - 5, M.FUR, 2); // near ear
    p.set(9, cy - 5, M.WING, 2); // inner ear
    p.set(4, cy - 1, M.FUR, 3); p.set(4, cy, M.FUR, 2); p.set(5, cy, M.FUR, 1); // snout
    p.end();
    p.begin(null);
    if (P.eyes === 'shut' || P.eyes === 'dead') { p.set(6, cy - 2, M.EYE, 0); p.set(7, cy - 2, M.EYE, 0); }
    else { p.set(6, cy - 2, M.GLOW, eyeS); p.set(7, cy - 2, M.GLOW, eyeS - 1); if (P.eyes === 'wide') p.set(6, cy - 3, M.GLOW, 3); }
    p.set(5, cy + 1, M.BONE, 4); // fang
    p.end();
    return;
  }
  const back = view === 'up';
  const cx = 9.5;
  // wings (behind the body); the screen-left wing catches the light
  p.begin(null);
  batWing(p, cx - 1.5, cy - 2, P.wings[0], -1, back ? 0 : 1);
  batWing(p, cx + 1.5, cy - 2, P.wings[1], 1, 0);
  p.end();
  // body, head, ears
  p.begin(null);
  blob(p, cx, cy, 2.6, 3.1, M.FUR, { hi: 0.35, lo: -0.3 });
  if (!back) for (let y = cy - 1; y <= cy + 2; y++) { p.over(Math.floor(cx) - 1, y, M.FUR, 3); p.over(Math.floor(cx), y, M.FUR, 2); } // chest ruff
  blob(p, cx, cy - 4, 2.6, 2.2, M.FUR, { hi: 0.3, lo: -0.3 });
  const ex0 = Math.floor(cx) - 2, ex1 = Math.floor(cx) + 1;
  p.set(ex0 - 1, cy - 7, M.FUR, 3); p.set(ex0 - 1, cy - 6, M.FUR, 2); p.set(ex0, cy - 6, M.FUR, 2);
  p.set(ex1 + 1, cy - 7, M.FUR, 2); p.set(ex1 + 1, cy - 6, M.FUR, 1); p.set(ex1, cy - 6, M.FUR, 1);
  if (!back) { p.set(ex0 - 1, cy - 6, M.WING, 2); p.set(ex1 + 1, cy - 6, M.WING, 1); } // inner ears
  p.set(ex0 + 1, cy + 3, M.FUR, 1); p.set(ex1, cy + 3, M.FUR, 0); // feet
  p.end();
  if (!back) {
    p.begin(null);
    const ey = cy - 4;
    if (P.eyes === 'shut') { p.set(ex0, ey, M.EYE, 0); p.set(ex1, ey, M.EYE, 0); }
    else if (P.eyes === 'dead') { p.set(ex0, ey, M.EYE, 1); p.set(ex1, ey, M.EYE, 1); }
    else {
      p.set(ex0, ey, M.GLOW, eyeS); p.set(ex1, ey, M.GLOW, eyeS);
      if (P.eyes === 'wide') { p.set(ex0, ey - 1, M.GLOW, 3); p.set(ex1, ey - 1, M.GLOW, 3); }
    }
    p.set(ex0 + 1, ey + 2, M.BONE, 4); p.set(ex1 - 1, ey + 2, M.BONE, 3); // fangs
    p.end();
  }
}

// ---------------------------------------------------------------------------
// Boar — bristled iron-grey hide, bone tusks, plated forehead (32 × 24)
// ---------------------------------------------------------------------------

/** Per pose: head offset / drop, leg gait override, body drop, eye, extras. */
const BOAR_POSES = {
  idle0: {}, idle1: { head: [0, 1] },
  move0: { walk: 0 }, move1: { walk: 1, body: -1 }, move2: { walk: 2 }, move3: { walk: 3, body: -1 },
  windup: { head: [0, 2], paw: true, eye: 'angry' },
  attack: { head: [-1, -2], legs: [[-2, 0], [-1, 0], [2, 0], [1, 0]], eye: 'angry' },
  hurt: { head: [1, -1], body: 0, eye: 'shut', legs: [[1, 0], [0, 0], [1, 0], [0, 0]] },
  dead: { dead: true },
  charge0: { head: [-1, 2], body: 1, legs: [[-3, 1], [-2, 1], [3, 1], [2, 1]], eye: 'angry', flat: true },
  charge1: { head: [-1, 1], body: -1, legs: [[1, 2], [2, 2], [-1, 2], [-2, 2]], eye: 'angry', flat: true },
  stun: { head: [-1, 3], eye: 'dizzy', legs: [[-1, 0], [1, 0], [1, 0], [-1, 0]] },
};

/** Boar head (side view, facing left) at (hx, hy) = the head's centre. */
function boarHeadSide(p, hx, hy, eye) {
  p.begin(null);
  blob(p, hx, hy, 5.2, 4.2, M.FUR, { hi: 0.4, lo: -0.25 });
  // snout
  for (let y = hy; y <= hy + 3; y++) for (let x = hx - 7; x <= hx - 4; x++) {
    const tip = x === hx - 7;
    if (tip && (y === hy || y === hy + 3)) continue;
    p.set(x, y, tip ? M.NOSE : M.FUR, tip ? (y === hy + 1 ? 3 : 2) : y === hy ? 3 : y === hy + 3 ? 1 : 2);
  }
  p.set(hx - 7, hy + 1, M.NOSE, 1); // nostril
  // lower jaw shadow
  for (let x = hx - 5; x <= hx + 2; x++) p.over(x, hy + 3, M.FUR, 1);
  p.end();
  // plated forehead: an iron plate with a bright edge and a rivet
  p.begin('below', 0);
  const plate = [[-3, -4], [-2, -4], [-1, -4], [0, -4], [-4, -3], [-3, -3], [-2, -3], [-1, -3], [0, -3], [1, -3], [-5, -2], [-4, -2], [-3, -2], [-2, -2], [-1, -2]];
  for (const [dx, dy] of plate) p.set(hx + dx, hy + dy, M.METAL, dy === -4 ? 4 : dx < -2 ? 3 : 2);
  p.set(hx - 2, hy - 3, M.METAL, 4);
  p.end();
  // ear, eye, tusk
  p.begin(null);
  p.set(hx + 2, hy - 5, M.FUR, 3); p.set(hx + 3, hy - 5, M.FUR, 2); p.set(hx + 3, hy - 6, M.FUR, 3); p.set(hx + 2, hy - 4, M.FUR, 2);
  const ex = hx - 2, ey = hy - 1;
  if (eye === 'shut') { p.set(ex, ey, M.EYE, 0); p.set(ex + 1, ey, M.EYE, 0); }
  else if (eye === 'dizzy' || eye === 'dead') { p.set(ex, ey, M.EYE, 0); p.set(ex + 1, ey + 1, M.EYE, 0); p.set(ex + 1, ey - 1, M.EYE, 0); p.set(ex - 1, ey + 1, M.EYE, 0); }
  else { p.set(ex, ey, M.EYE, 2); p.set(ex + 1, ey, M.EYE, 0); if (eye === 'angry') p.set(ex, ey - 1, M.FUR, 0); }
  p.end();
  p.begin('all', 0);
  p.set(hx - 4, hy + 3, M.BONE, 3); p.set(hx - 5, hy + 2, M.BONE, 4); p.set(hx - 6, hy + 1, M.BONE, 4); p.set(hx - 6, hy, M.BONE, 3);
  p.end();
}

/** Boar from behind: haunches, spine ridge, ears peeking over, curly tail, hind legs with hooves. */
function drawBoarBack(p, P, G, bd) {
  const cx = 16;
  const walkL = P.walk === 0 || P.walk === 1 ? 1 : 0, walkR = P.walk === 2 || P.walk === 3 ? 1 : 0;
  const lift = [P.paw ? 1 : walkL, walkR];
  p.begin(null);
  // ears and the shoulder hump behind the rump
  p.set(cx - 7, 5 + bd, M.FUR, 3); p.set(cx - 7, 6 + bd, M.FUR, 2); p.set(cx - 6, 6 + bd, M.FUR, 2);
  p.set(cx + 6, 5 + bd, M.FUR, 2); p.set(cx + 6, 6 + bd, M.FUR, 1); p.set(cx + 5, 6 + bd, M.FUR, 1);
  blob(p, cx, 10 + bd, 7.5, 4, M.FUR, { hi: 0.4, lo: -0.1 });
  p.end();
  p.begin(null);
  for (const [k, lx] of [[0, 10], [1, 19]]) {
    for (let y = 16 + bd; y <= G - lift[k]; y++) {
      const hoof = y >= G - lift[k] - 1;
      for (let i = 0; i < 3; i++) p.set(lx + i, y, hoof ? M.FUR2 : M.FUR, hoof ? (i === 0 ? 3 : 1) : i === 0 ? 3 : i === 1 ? 2 : 1);
    }
  }
  p.end();
  p.begin('below', 1);
  blob(p, cx, 13.5 + bd, 9.4, 5.8, M.FUR, { hi: 0.45, lo: -0.25 });
  for (let x = cx - 8; x <= cx + 7; x++) if (x !== cx - 1 && x !== cx) p.over(x, 18 + bd, M.FUR3, x < cx ? 2 : 1);
  p.end();
  p.begin(null);
  // spine ridge running down to the tail, a darker cleft between the haunches
  for (let y = 6 + bd; y <= 15 + bd; y++) { p.set(cx - 1, y, M.FUR2, y & 1 ? 3 : 2); p.set(cx, y, M.FUR2, y & 1 ? 1 : 2); if ((y & 1) === 0) p.set(cx + (y % 4 ? 1 : -2), y - 1, M.FUR2, 2); }
  for (let y = 16 + bd; y <= 18 + bd; y++) p.set(cx, y, M.FUR, 0);
  p.set(cx - 1, 15 + bd, M.FUR, 3); p.set(cx - 2, 16 + bd, M.FUR, 3); p.set(cx - 2, 17 + bd, M.FUR, 2); p.set(cx - 1, 17 + bd, M.FUR, 1); // tail curl
  p.end();
}

/** Bristle ridge along the back: dark spikes following the body's top edge. */
function bristles(p, x0, x1, topAt, flat) {
  for (let x = x0; x <= x1; x++) {
    const y = topAt(x);
    if (y == null) continue;
    const k = (x - x0) % 3;
    p.set(x, y, M.FUR2, k === 0 ? 3 : 2);
    if (!flat && k === 0) p.set(x + 1, y - 1, M.FUR2, 2);
    if (flat && k === 0) p.set(x + 1, y, M.FUR2, 3);
  }
}

function drawBoar(p, view, key, f) {
  const P = BOAR_POSES[key];
  const G = f.G;
  const [hdx, hdy] = P.head ?? [0, 0];
  const bd = P.body ?? 0;
  if (view === 'side') {
    if (P.dead) {
      // keeled over on its side: flattened body, stiff legs sprawled toward the viewer, head on the ground
      p.begin(null);
      blob(p, 18.5, G - 3.2, 9.5, 3.8, M.FUR, { hi: 0.35, lo: -0.3 });
      for (let x = 12; x <= 25; x++) p.over(x, G - 5, M.FUR, 3);
      p.end();
      p.begin(null); bristles(p, 12, 25, () => G - 7, true); p.end();
      p.begin('all', 0);
      for (const lx of [12, 15, 21, 24]) { p.set(lx, G - 1, M.FUR, 2); p.set(lx + 1, G, M.FUR, 1); p.set(lx + 2, G, M.FUR2, 1); }
      p.end();
      boarHeadSide(p, 9, G - 3, 'dead');
      return;
    }
    const gait = P.legs ? P.legs.map(([dx, lift]) => ({ dx, lift })) : quadGait({ walk: P.walk ?? -1 });
    if (P.paw) { gait[0] = { dx: 1, lift: 2 }; }
    const bodyY = 13.5 + bd;
    // far legs
    p.begin(null);
    quadLeg(p, 12, 17 + bd, G, gait[1].lift, gait[1].dx, true, M.FUR2, M.FUR, 3);
    quadLeg(p, 24, 17 + bd, G, gait[3].lift, gait[3].dx, true, M.FUR2, M.FUR, 3);
    p.end();
    // body: a high shoulder hump sloping to the haunch, lighter belly, bristled hide, curly tail
    p.begin(null);
    blob(p, 22, bodyY + 0.8, 6.8, 5, M.FUR, { hi: 0.45, lo: -0.2 });
    blob(p, 15, bodyY - 0.4, 7, 6.2, M.FUR, { hi: 0.45, lo: -0.2 });
    for (let x = 11; x <= 26; x++) { p.over(x, Math.round(bodyY + 4.8), M.FUR3, 2); p.over(x, Math.round(bodyY + 5.6), M.FUR3, 1); }
    for (let y = Math.round(bodyY - 4); y <= Math.round(bodyY + 3); y++) {
      for (let x = 10; x <= 27; x++) if ((x * 2 + y * 3) % 7 === 0 && p.getShade(x, y) >= 2) p.over(x, y, M.FUR, p.getShade(x, y) - 1); // bristle strokes
    }
    p.set(28, Math.round(bodyY - 1), M.FUR, 2); p.set(29, Math.round(bodyY - 2), M.FUR, 2); p.set(29, Math.round(bodyY - 3), M.FUR, 1); p.set(28, Math.round(bodyY - 3), M.FUR, 1);
    p.end();
    const topAt = (x) => {
      const a = bodyY - 0.4 - 6.2 * Math.sqrt(Math.max(0, 1 - ((x + 0.5 - 15) / 7) ** 2));
      const b = bodyY + 0.8 - 5 * Math.sqrt(Math.max(0, 1 - ((x + 0.5 - 22) / 6.8) ** 2));
      return Math.round(Math.min(Math.abs(x + 0.5 - 15) < 7 ? a : 99, Math.abs(x + 0.5 - 22) < 6.8 ? b : 99)) - 1;
    };
    p.begin(null);
    bristles(p, 10, 26, topAt, P.flat);
    p.end();
    // near legs
    p.begin('sides', 1);
    quadLeg(p, 11, 17 + bd, G, gait[0].lift, gait[0].dx, false, M.FUR2, M.FUR, 3);
    quadLeg(p, 23, 17 + bd, G, gait[2].lift, gait[2].dx, false, M.FUR2, M.FUR, 3);
    p.end();
    boarHeadSide(p, 9 + hdx, 13 + hdy + bd, P.eye);
    return;
  }
  if (!P.dead && view === 'up') { drawBoarBack(p, P, G, bd); return; }
  const back = view === 'up';
  const cx = 16;
  if (P.dead) {
    p.begin(null);
    blob(p, cx, G - 3.2, 10, 3.8, M.FUR, { hi: 0.35, lo: -0.3 });
    for (let x = cx - 7; x <= cx + 6; x++) p.over(x, G - 6, M.FUR2, 2); // flattened bristle ridge
    p.end();
    p.begin('all', 0);
    for (const [lx, d] of [[5, -1], [7, -1], [25, 1], [27, 1]]) { p.set(lx, G - 1, M.FUR, 2); p.set(lx + d, G, M.FUR2, 1); }
    p.end();
    if (!back) {
      p.begin('all', 0);
      p.set(cx - 2, G - 4, M.EYE, 0); p.set(cx - 1, G - 3, M.EYE, 0); p.set(cx + 2, G - 4, M.EYE, 0); p.set(cx + 1, G - 3, M.EYE, 0);
      p.end();
    }
    return;
  }
  const walkL = P.walk === 0 || P.walk === 1 ? 1 : 0, walkR = P.walk === 2 || P.walk === 3 ? 1 : 0;
  const lift = [P.paw ? 2 : walkL, walkR];
  // legs
  p.begin(null);
  for (const [k, lx] of [[0, 10], [1, 19]]) {
    for (let y = 16 + bd; y <= G - lift[k]; y++) for (let i = 0; i < 3; i++) p.set(lx + i, y, y >= G - lift[k] - 1 ? M.FUR2 : M.FUR, y >= G - lift[k] - 1 ? (i === 0 ? 2 : 1) : i === 0 ? 3 : i === 1 ? 2 : 1);
  }
  p.end();
  // shoulders / rump
  p.begin(null);
  blob(p, cx, 13 + bd, 10, 6.2, M.FUR, { hi: 0.45, lo: -0.2 });
  p.end();
  p.begin(null);
  if (back) {
    // spine ridge and a curly tail
    for (let y = 7 + bd; y <= 17 + bd; y++) { p.set(cx - 1, y, M.FUR2, 2); p.set(cx, y, M.FUR2, y & 1 ? 3 : 1); }
    p.set(cx, 16 + bd, M.FUR, 3); p.set(cx + 1, 17 + bd, M.FUR, 2); p.set(cx, 18 + bd, M.FUR, 2);
    // ears peeking over the shoulders
    p.set(cx - 6, 6 + bd, M.FUR, 3); p.set(cx - 5, 6 + bd, M.FUR, 2); p.set(cx + 5, 6 + bd, M.FUR, 2); p.set(cx + 6, 6 + bd, M.FUR, 1);
  } else {
    bristles(p, cx - 7, cx + 6, (x) => Math.round(13 + bd - 6.2 * Math.sqrt(Math.max(0, 1 - ((x + 0.5 - cx) / 10) ** 2))) - 1, P.flat);
  }
  p.end();
  if (back) return;
  // head: front view with snout, tusks, forehead plate, ears, eyes
  const hy = 13 + hdy + bd;
  p.begin('all', 1);
  blob(p, cx, hy, 6.2, 5, M.FUR, { hi: 0.35, lo: -0.3 });
  p.set(cx - 7, hy - 4, M.FUR, 3); p.set(cx - 6, hy - 4, M.FUR, 2); p.set(cx - 7, hy - 5, M.FUR, 2); // ears
  p.set(cx + 6, hy - 4, M.FUR, 1); p.set(cx + 5, hy - 4, M.FUR, 2); p.set(cx + 6, hy - 5, M.FUR, 1);
  p.end();
  p.begin('below', 0);
  for (let x = cx - 3; x <= cx + 2; x++) { p.set(x, hy - 4, M.METAL, x < cx ? 4 : 3); p.set(x, hy - 3, M.METAL, x < cx - 1 ? 3 : 2); }
  p.set(cx - 2, hy - 2, M.METAL, 2); p.set(cx + 1, hy - 2, M.METAL, 1); p.set(cx - 1, hy - 3, M.METAL, 4);
  p.end();
  p.begin(null);
  const ey = hy - 1;
  if (P.eye === 'shut') { p.set(cx - 4, ey, M.EYE, 0); p.set(cx - 3, ey, M.EYE, 0); p.set(cx + 2, ey, M.EYE, 0); p.set(cx + 3, ey, M.EYE, 0); }
  else if (P.eye === 'dizzy') { for (const ex of [cx - 4, cx + 2]) { p.set(ex, ey, M.EYE, 0); p.set(ex + 1, ey + 1, M.EYE, 0); p.set(ex + 1, ey - 1, M.EYE, 0); } }
  else { p.set(cx - 4, ey, M.EYE, 2); p.set(cx - 3, ey, M.EYE, 0); p.set(cx + 3, ey, M.EYE, 2); p.set(cx + 2, ey, M.EYE, 0); if (P.eye === 'angry') { p.set(cx - 4, ey - 1, M.FUR, 0); p.set(cx + 3, ey - 1, M.FUR, 0); } }
  // snout disc with nostrils
  for (let y = hy + 1; y <= hy + 4; y++) for (let x = cx - 2; x <= cx + 1; x++) {
    if ((y === hy + 1 || y === hy + 4) && (x === cx - 2 || x === cx + 1)) continue;
    p.set(x, y, M.NOSE, y === hy + 1 ? 3 : x < cx ? 2 : 1);
  }
  p.set(cx - 1, hy + 3, M.NOSE, 0); p.set(cx, hy + 3, M.NOSE, 0);
  p.end();
  p.begin('all', 0);
  p.set(cx - 3, hy + 4, M.BONE, 3); p.set(cx - 4, hy + 3, M.BONE, 4); p.set(cx - 4, hy + 2, M.BONE, 4);
  p.set(cx + 2, hy + 4, M.BONE, 2); p.set(cx + 3, hy + 3, M.BONE, 3); p.set(cx + 3, hy + 2, M.BONE, 3);
  p.end();
}

// ---------------------------------------------------------------------------
// Straw dummy on a post with a painted target (16 × 24)
// ---------------------------------------------------------------------------

function drawDummy(p, view, key, f) {
  const G = f.G;
  const cx = 7.5;
  const side = view === 'side';
  const back = view === 'up';
  // post into a little dirt mound
  p.begin(null);
  for (let y = 14; y <= G; y++) { p.set(7, y, M.WOOD, 3); p.set(8, y, M.WOOD, 1); }
  for (let x = 5; x <= 10; x++) p.set(x, G, M.WOOD, x < 7 ? 2 : 1);
  p.set(6, G - 1, M.WOOD, 2); p.set(9, G - 1, M.WOOD, 1);
  p.end();
  // crossbar arms with straw tufts
  p.begin(null);
  if (side) { p.set(7, 10, M.WOOD, 4); p.set(8, 10, M.WOOD, 2); p.set(7, 11, M.WOOD, 2); p.set(8, 11, M.WOOD, 1); }
  else {
    for (let x = 2; x <= 13; x++) { p.set(x, 10, M.WOOD, 3); p.set(x, 11, M.WOOD, 1); }
    for (const [x, s] of [[2, 3], [13, 2]]) { p.set(x, 12, M.FUR, s); p.set(x, 13, M.FUR, s - 1); p.set(x + (x < 7 ? -0 : 0), 9, M.FUR, s + 1); }
  }
  p.end();
  // straw body bound with rope, the target painted on the front
  p.begin(null);
  blob(p, cx, 14, side ? 2.8 : 4.1, 4.6, M.FUR, { hi: 0.3, lo: -0.35 });
  for (let y = 10; y <= 18; y++) for (let x = 3; x <= 12; x++) if (((x * 3 + y * 5) % 7) === 0) p.over(x, y, M.FUR, 1); // straw strands
  p.end();
  p.begin(null);
  for (let x = 3; x <= 12; x++) { p.over(x, 11, M.LEATHER, x < 7 ? 3 : 1); p.over(x, 17, M.LEATHER, x < 7 ? 2 : 1); }
  if (!side && !back) {
    for (let y = 11; y <= 17; y++) for (let x = 4; x <= 11; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - 14);
      if (d > 3.3) continue;
      const ring = d < 1.1 ? 0 : d < 2.2 ? 1 : 2;
      p.over(x, y, ring === 1 ? M.WHITE : M.SCARF, ring === 1 ? (x < cx ? 4 : 3) : (x < cx ? 3 : 2));
    }
  }
  if (side) { for (let y = 12; y <= 16; y++) p.over(5, y, M.SCARF, 2); }
  // loose straw at the bottom
  p.set(5, 19, M.FUR, 2); p.set(9, 19, M.FUR, 1); p.set(7, 19, M.FUR, 3);
  p.end();
  // burlap sack head with stitched eyes, tied at the neck
  p.begin('below', 1);
  blob(p, cx, 5.5, side ? 3.1 : 3.5, 3.3, M.FUR3, { hi: 0.3, lo: -0.35 });
  p.set(side ? 9 : 10, 2, M.FUR3, 2); p.set(side ? 10 : 11, 2, M.FUR3, 1); // knotted tip
  p.end();
  p.begin(null);
  for (let x = 5; x <= 10; x++) p.set(x, 9, M.LEATHER, x < 7 ? 3 : 2);
  p.set(6, 10, M.FUR, 3); p.set(9, 10, M.FUR, 2);
  if (!back) {
    const eyes = side ? [5] : [5, 9];
    for (const ex of eyes) { p.set(ex, 4, M.LINE, 0); p.set(ex + 1, 5, M.LINE, 0); p.set(ex + 1, 4, M.FUR3, 1); p.set(ex, 5, M.FUR3, 1); } // stitched crosses
    if (!side) { p.set(6, 7, M.LINE, 0); p.set(7, 7, M.FUR3, 1); p.set(8, 7, M.LINE, 0); }
  } else { p.set(7, 5, M.FUR3, 1); p.set(7, 6, M.FUR3, 1); } // back seam
  p.end();
  // wobble: hurt tilts left, hurt2 right, dead = hurt
  if (key === 'hurt' || key === 'dead') shear(p, -0.22, G);
  if (key === 'hurt2') shear(p, 0.22, G);
  if (key === 'idle1') shear(p, 0.06, G);
}

// ---------------------------------------------------------------------------
// Golem "Cinderheart" — basalt boss with magma cracks, core and cinder crown (64 × 64)
// ---------------------------------------------------------------------------

/**
 * Golem rig per pose (front view, screen coordinates; the back view mirrors the asymmetric ones):
 * torso centre, head centre, shoulders, elbows and fists (screen-left arm A = the golem's right arm,
 * B = its left), feet with lifts, the core size and crack heat.
 */
function golemRig(key) {
  const R = {
    torso: [32, 34], head: [32, 17], sA: [16, 25], sB: [48, 25], eA: [12, 37], eB: [52, 37],
    fA: [11, 47], fB: [53, 47], footA: [23, 59, 0], footB: [41, 59, 0], core: 3.4, heat: 3, eyes: 3, lean: 0,
  };
  const up = (d) => { for (const k of ['torso', 'head', 'sA', 'sB', 'eA', 'eB']) R[k] = [R[k][0], R[k][1] + d]; };
  switch (key) {
    case 'idle1': up(1); R.fA = [11, 48]; R.fB = [53, 48]; R.core = 3; break;
    case 'move0': R.footA = [23, 57, 2]; up(-1); R.fA = [12, 45]; R.fB = [53, 49]; break;
    case 'move1': up(1); R.fA = [11, 47]; R.fB = [53, 47]; break;
    case 'move2': R.footB = [41, 57, 2]; up(-1); R.fA = [11, 49]; R.fB = [52, 45]; break;
    case 'move3': up(1); break;
    case 'windup': case 'slamWind':
      up(-1); R.eA = [13, 15]; R.eB = [51, 15]; R.fA = [23, 7]; R.fB = [41, 7]; R.heat = 4; break;
    case 'attack': case 'slam':
      up(5); R.head = [32, 25]; R.eA = [19, 44]; R.eB = [45, 44]; R.fA = [26, 56]; R.fB = [38, 56]; R.heat = 4; break;
    case 'sweepWind':
      R.torso = [34, 34]; R.head = [33, 17]; R.eA = [8, 27]; R.fA = [6, 19]; R.sA = [17, 24]; R.heat = 4; break;
    case 'sweep':
      R.torso = [30, 34]; R.head = [31, 17]; R.eA = [26, 38]; R.fA = [45, 40]; R.eB = [55, 34]; R.fB = [57, 44]; R.heat = 4; break;
    case 'throw':
      R.eB = [53, 20]; R.fB = [48, 13]; R.boulder = [48, 7]; R.eA = [12, 36]; R.fA = [13, 46]; break;
    case 'roar':
      up(-1); R.head = [32, 15]; R.eA = [8, 29]; R.eB = [56, 29]; R.fA = [7, 23]; R.fB = [57, 23]; R.core = 4.4; R.heat = 4; R.eyes = 4; R.roar = true; break;
    case 'hurt':
      up(-1); R.head = [33, 16]; R.eA = [11, 34]; R.eB = [53, 34]; R.fA = [13, 41]; R.fB = [51, 41]; R.eyes = 2; R.lean = 1; break;
    case 'kneel':
      up(10); R.head = [32, 28]; R.footA = [22, 59, 0]; R.footB = [42, 60, 0]; R.kneel = true;
      R.eA = [12, 49]; R.eB = [52, 49]; R.fA = [13, 57]; R.fB = [51, 57]; R.core = 2.4; R.heat = 2; R.eyes = 2; break;
    default: break;
  }
  return R;
}

/** Magma cracks (offsets from the torso centre) for the front / back views. */
const GOLEM_CRACKS = {
  front: [
    [[-3, -2], [-7, -6], [-9, -7], [-12, -11]], [[3, -2], [6, -5], [10, -6]], [[-2, 3], [-5, 7], [-4, 10]],
    [[3, 3], [7, 6], [9, 10]], [[0, -4], [1, -8], [-1, -11]],
  ],
  back: [[[-10, -8], [-6, -4], [-7, 1], [-3, 6]], [[9, -9], [5, -3], [7, 3]], [[0, 2], [2, 7], [0, 11]]],
};

/** One golem arm: upper arm, forearm and fist as rock chunks, a glowing seam on the forearm. */
function golemArm(p, s, e, f, lit, seed, heat) {
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const lift = lit ? 0 : -1;
  const u = mid(s, e), fo = mid(e, f);
  rock(p, u[0], u[1], 4.6, Math.max(4.6, Math.abs(e[1] - s[1]) / 2 + 2), M.STONE, seed, { facets: 7, lift });
  rock(p, fo[0], fo[1], 4.2, Math.max(4.4, Math.abs(f[1] - e[1]) / 2 + 2), M.STONE, seed + 1, { facets: 7, lift });
  if (heat > 2) crack(p, [[e[0] - 1, e[1]], [fo[0], fo[1] + 1], [f[0] + 1, f[1] - 3]], 2);
  rock(p, f[0], f[1], 5.6, 5, M.STONE, seed + 2, { facets: 8, lift });
  // knuckle ridge
  p.over(Math.round(f[0] - 3), Math.round(f[1] + 2), M.STONE, 1); p.over(Math.round(f[0]), Math.round(f[1] + 3), M.STONE, 1); p.over(Math.round(f[0] + 3), Math.round(f[1] + 2), M.STONE, 1);
}

/** Crown of cinder spikes on the head (ember tips glow). */
function golemCrown(p, hx, hy, heat, back) {
  const spikes = [[-5, -3, 3], [-2, -5, 4], [1, -6, 5], [4, -4, 4], [6, -2, 3]];
  for (const [dx, dy, h] of spikes) {
    const x = Math.round(hx + (back ? -dx : dx)), y0 = Math.round(hy + dy);
    for (let k = 0; k < h; k++) {
      p.set(x, y0 - k, M.STONE, k === 0 ? 2 : 3);
      if (k < h - 2) p.set(x + 1, y0 - k, M.STONE, 1);
    }
    p.set(x, y0 - h, M.GLOW, heat >= 3 ? 4 : 2);
    if (heat >= 3) p.set(x, y0 - h + 1, M.GLOW, 3);
  }
}

/** Golem in the front (down) or back (up) view. */
function drawGolemFront(p, key, back) {
  const R = golemRig(key);
  const mx = (pt) => (back ? [64 - pt[0], pt[1]] : pt);
  const [tx, ty] = mx(R.torso);
  const [hx, hy] = mx(R.head);
  // legs and feet
  p.begin(null);
  for (const foot of [R.footA, R.footB]) {
    const [fx, fy] = mx(foot);
    if (R.kneel && foot === R.footB) {
      rock(p, fx, fy - 2, 6, 3.2, M.STONE, 41, { facets: 6 });     // knee on the ground, shin behind
      continue;
    }
    rock(p, (fx + tx) / 2 + (fx < tx ? 1 : -1), (fy + ty + 12) / 2 - 1, 5, 6, M.STONE, fx < 32 ? 11 : 12, { facets: 7, lift: -1 });
    rock(p, fx, fy, 6.2, 3.4, M.STONE, fx < 32 ? 13 : 14, { facets: 6 });
  }
  p.end();
  // far arms first when raised behind the head
  const arms = [[R.sA, R.eA, R.fA, 21], [R.sB, R.eB, R.fB, 25]].map(([s, e, f, seed]) => [mx(s), mx(e), mx(f), seed]);
  // torso: pelvis block + great chest
  p.begin(null);
  rock(p, tx, ty + 12, 11, 4.5, M.STONE, 5, { facets: 7, lift: -1 });
  rock(p, tx, ty, 15.5, 13, M.STONE, 7, { facets: 10, face: 0.62 });
  // dark seams between the chest plates
  p.line2(tx - 9, ty - 4, tx - 5, ty + 8, M.STONE, 0);
  p.line2(tx + 9, ty - 5, tx + 6, ty + 7, M.STONE, 0);
  p.end();
  // magma cracks and the core
  p.begin(null);
  for (const pts of GOLEM_CRACKS[back ? 'back' : 'front']) crack(p, pts.map(([x, y]) => [tx + x, ty + y]), R.heat >= 3 ? 3 : 2);
  if (!back) {
    const c = R.core;
    for (let y = Math.floor(ty - c - 1); y <= Math.ceil(ty + c + 1); y++) {
      for (let x = Math.floor(tx - c - 1); x <= Math.ceil(tx + c + 1); x++) {
        const d = Math.hypot(x + 0.5 - tx, y + 0.5 - ty + 0.3);
        if (d > c + 0.6) continue;
        p.set(x, y, d > c - 0.4 ? M.STONE : M.GLOW, d > c - 0.4 ? 0 : d < c * 0.35 ? 4 : d < c * 0.7 ? 3 : 2);
      }
    }
  } else {
    // spine ridge of basalt spikes
    for (let k = 0; k < 4; k++) { const y = ty - 9 + k * 5; p.set(tx, y, M.STONE, 4); p.set(tx, y + 1, M.STONE, 3); p.set(tx + 1, y + 1, M.STONE, 1); p.set(tx - 1, y + 2, M.STONE, 3); }
  }
  p.end();
  // shoulders and arms
  p.begin(null);
  for (const [s, e, f, seed] of arms) golemArm(p, s, e, f, s[0] < 32, seed, R.heat);
  p.end();
  p.begin(null);
  for (const [s, , , seed] of arms) rock(p, s[0], s[1], 7.2, 6.4, M.STONE, seed + 9, { facets: 8, face: 0.5 });
  p.end();
  // head sunk between the shoulders, crown, eyes
  p.begin('all', 0);
  rock(p, hx, hy, 6.4, 5.6, M.STONE, 31, { facets: 7 });
  p.end();
  p.begin(null);
  golemCrown(p, hx, hy - 3, R.heat, back);
  if (!back) {
    const ey = Math.round(hy);
    const s = R.eyes;
    for (const ex of [Math.round(hx - 3), Math.round(hx + 1)]) { p.set(ex, ey, M.GLOW, s); p.set(ex + 1, ey, M.GLOW, Math.max(2, s - 1)); }
    if (R.roar) { for (let x = Math.round(hx - 2); x <= Math.round(hx + 1); x++) p.set(x, ey + 3, M.GLOW, 3); } // open maw
    else p.set(Math.round(hx - 1), ey + 3, M.STONE, 0);
  }
  p.end();
  if (R.boulder) {
    p.begin('all', 0);
    const [bx, by] = mx(R.boulder);
    rock(p, bx, by, 5, 4.4, M.STONE, 51, { facets: 7, lift: 1 });
    crack(p, [[bx - 2, by], [bx + 1, by + 1], [bx + 2, by - 2]], 2);
    p.end();
  }
}

/** Golem in the side view (facing left): hunched profile, far arm behind, near arm in front. */
function drawGolemSide(p, key) {
  const R = golemRig(key);
  // map the front rig to a profile: depth offsets per part (forward = −x)
  const drop = R.torso[1] - 34;
  const tx = 34 + (R.lean ?? 0) * 2, ty = 35 + drop;
  const hx = 23 + (R.lean ?? 0) * 2 + (key === 'slam' || key === 'attack' ? -4 : 0), hy = R.head[1] + 5 + (key === 'roar' ? -2 : 0);
  const near = sideArm(key, 'near', drop), far = sideArm(key, 'far', drop);
  // far leg and far arm (behind)
  p.begin(null);
  const footF = R.kneel ? [38, 59] : [38 - (key === 'move2' ? -2 : 0), 59 - (R.footB[2] ?? 0)];
  rock(p, 38, (footF[1] + ty + 12) / 2, 5, 6, M.STONE, 12, { facets: 7, lift: -1 });
  rock(p, footF[0] - 2, footF[1], 6.4, 3.2, M.STONE, 14, { facets: 6, lift: -1 });
  golemArm(p, far.s, far.e, far.f, false, 25, R.heat);
  p.end();
  // body
  p.begin(null);
  rock(p, tx + 1, ty + 12, 9, 4.5, M.STONE, 5, { facets: 7, lift: -1 });
  rock(p, tx, ty, 11.5, 13, M.STONE, 7, { facets: 9, face: 0.6 });
  for (let k = 0; k < 4; k++) { const y = ty - 9 + k * 5; if (p.get(tx + 9, y)) { p.set(tx + 10, y, M.STONE, 3); p.set(tx + 11, y + 1, M.STONE, 2); p.set(tx + 10, y + 1, M.STONE, 1); } } // back spikes
  p.end();
  p.begin(null);
  crack(p, [[tx - 9, ty - 1], [tx - 5, ty + 2], [tx - 6, ty + 7], [tx - 2, ty + 10]], R.heat >= 3 ? 3 : 2);
  crack(p, [[tx - 4, ty - 8], [tx, ty - 5], [tx + 3, ty - 7]], 2);
  // core glowing through a rift at the front of the chest
  const c = Math.max(1.4, R.core - 1.6);
  for (let y = Math.floor(ty - c); y <= Math.ceil(ty + c); y++) for (let x = Math.floor(tx - 11); x <= Math.floor(tx - 11 + c + 1); x++) {
    const d = Math.hypot(x + 0.5 - (tx - 10.5), y + 0.5 - ty);
    if (d <= c + 0.3) p.over(x, y, M.GLOW, d < c * 0.5 ? 3 : 2);
  }
  p.end();
  // near leg
  p.begin(null);
  const footN = [29 - (R.footA[2] ? 2 : 0), 59 - (R.footA[2] ?? 0)];
  rock(p, 30, (footN[1] + ty + 12) / 2, 5.2, 6.2, M.STONE, 11, { facets: 7 });
  rock(p, footN[0] - 2, footN[1], 6.6, 3.4, M.STONE, 13, { facets: 6 });
  p.end();
  // head (hunched forward), crown, eye
  p.begin('all', 0);
  rock(p, hx, hy, 6, 5.4, M.STONE, 31, { facets: 7 });
  p.end();
  p.begin(null);
  golemCrown(p, hx + 1, hy - 3, R.heat, false);
  p.set(hx - 4, hy, M.GLOW, R.eyes); p.set(hx - 3, hy, M.GLOW, Math.max(2, R.eyes - 1));
  if (R.roar) { p.set(hx - 5, hy + 3, M.GLOW, 3); p.set(hx - 4, hy + 3, M.GLOW, 3); }
  p.end();
  // near arm (in front) and shoulder
  p.begin(null);
  golemArm(p, near.s, near.e, near.f, true, 21, R.heat);
  rock(p, near.s[0], near.s[1], 6.8, 6.2, M.STONE, 30, { facets: 8, face: 0.5 });
  p.end();
  if (key === 'throw') {
    p.begin('all', 0);
    rock(p, near.f[0] + 1, near.f[1] - 6, 5, 4.4, M.STONE, 51, { facets: 7, lift: 1 });
    p.end();
  }
}

/** Side-view arm joints (facing left) per pose for the near / far arm. */
function sideArm(key, which, drop) {
  const n = which === 'near';
  const s = n ? [30, 26 + drop] : [37, 25 + drop];
  const A = {
    idle0: n ? [[27, 37], [24, 47]] : [[40, 36], [41, 46]],
    idle1: n ? [[27, 37], [24, 48]] : [[40, 36], [41, 47]],
    move0: n ? [[26, 36], [22, 45]] : [[41, 36], [43, 47]],
    move1: n ? [[27, 37], [24, 47]] : [[40, 36], [41, 46]],
    move2: n ? [[28, 37], [27, 48]] : [[39, 36], [38, 45]],
    move3: n ? [[27, 37], [24, 47]] : [[40, 36], [41, 46]],
    slamWind: n ? [[23, 17], [17, 9]] : [[31, 15], [25, 8]],
    slam: n ? [[20, 44], [13, 55]] : [[28, 43], [20, 55]],
    sweepWind: n ? [[40, 30], [48, 24]] : [[42, 34], [44, 44]],
    sweep: n ? [[19, 33], [9, 36]] : [[40, 36], [42, 46]],
    throw: n ? [[38, 18], [42, 14]] : [[40, 36], [41, 46]],
    roar: n ? [[21, 26], [13, 20]] : [[44, 26], [52, 21]],
    hurt: n ? [[29, 35], [28, 43]] : [[42, 34], [45, 41]],
    kneel: n ? [[24, 48], [18, 57]] : [[36, 47], [32, 57]],
  };
  const k = key === 'windup' ? 'slamWind' : key === 'attack' ? 'slam' : key;
  const [e, f] = A[k] ?? A.idle0;
  const d = k === 'slam' || k === 'kneel' ? 0 : drop;
  return { s, e: [e[0], e[1] + d * 0], f: [f[0], f[1] + (k === 'idle1' || k === 'move1' || k === 'move3' ? 0 : 0)] };
}

/** Collapsed golem: a pile of basalt rubble, a few embers still glowing, the dimmed core on top. */
function drawGolemDead(p, view) {
  const pile = view === 'side'
    ? [[32, 56, 12, 6, 1], [22, 58, 7, 4.5, 2], [42, 57, 8, 5, 3], [30, 49, 8, 5.5, 4], [38, 50, 6, 4.5, 5], [26, 44, 6, 5, 6], [47, 60, 4, 2.6, 7]]
    : [[32, 57, 13, 5.5, 1], [19, 58, 7, 4.2, 2], [45, 58, 7.5, 4.4, 3], [27, 50, 8, 5.4, 4], [38, 50, 7.5, 5, 5], [32, 43, 6, 5, 6], [12, 60, 3.5, 2.2, 7], [53, 60, 3.8, 2.4, 8]];
  p.begin(null);
  for (const [x, y, rx, ry, seed] of pile) rock(p, x, y, rx, ry, M.STONE, 60 + seed, { facets: 7, lift: -1 });
  p.end();
  p.begin(null);
  crack(p, [[24, 55], [29, 57], [33, 54]], 2);
  crack(p, [[36, 52], [40, 55]], 1);
  if (view !== 'up') { p.set(31, 43, M.GLOW, 2); p.set(32, 43, M.GLOW, 3); p.set(32, 44, M.GLOW, 2); }
  for (const [x, y] of [[20, 57], [44, 56], [28, 49]]) p.set(x, y, M.GLOW, 2);
  p.end();
}

function drawGolem(p, view, key) {
  if (key === 'dead') drawGolemDead(p, view);
  else if (view === 'side') drawGolemSide(p, key);
  else drawGolemFront(p, key, view === 'up');
}

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

/** Humanoid enemy specs (createCharacterSheet with { combat: true }). */
const HUMANOID_SPECS = {
  goblin: {
    preset: 'goblin', build: 'child', skin: '#7aa84a', ears: 'pointed', face: 'fierce', hairStyle: 'bald', hair: '#7aa84a',
    eyes: '#f2c23a', beard: false, hat: 'none', cape: false, weapon: 'sword', blush: false,
    // an open dark-leather vest over the bare green chest and arms, a tan loincloth, bare feet
    outfit: { top: '#4a3226', bottom: '#a8885a', accent: 'brown', style: 'vest', shirt: '#7aa84a' },
    gear: { boots: '#7aa84a', belt: '#2a1c14', leather: '#3a281c' },
  },
  archer: {
    preset: 'archer', build: 'child', skin: '#6f9c46', face: 'fierce', hairStyle: 'short', hair: '#2a2a1e',
    eyes: '#e8b83a', beard: false, hat: 'hood', hatColor: '#6a3a28', cape: false, weapon: 'bow', blush: false,
    outfit: { top: '#5a4a30', bottom: '#3a3024', accent: 'brown', style: 'tunic', shirt: 'cream' },
    gear: { quiver: true, boots: '#2a2018', leather: '#6a4428', belt: '#2a1c14' },
  },
  shaman: {
    preset: 'shaman', build: 'child', skin: '#7f9e50', face: 'fierce', hairStyle: 'bald', hair: '#3e5a2a',
    eyes: '#f2c23a', beard: false, hat: 'hood', hatColor: '#5a2446', feather: '#e8dcc0', cape: false, weapon: 'staff', blush: false,
    outfit: { top: '#3e2c48', bottom: '#2e2236', accent: '#c8a060', style: 'robe', shirt: 'cream' },
    gear: { beads: true, staffGem: '#5ee08c', gemGlow: true, boots: '#2a1e18', sash: '#8a3a2a' },
  },
};

/**
 * Sprite3D options of an enemy sheet (`EnemySheet.spriteOptions`, spread into the sprite options).
 * @typedef {{ castShadow?: boolean, blobSize?: [number, number] }} EnemySpriteOptions
 */

/**
 * One KINDS entry — a kind's sheet recipe: frame size (px; `fw` × the column count ≤ 4096), the
 * column pose names (COMMON first for the monster sheets: the Enemy's state machine shows
 * `idle0`/`idle1`, `move0`–`move3`, `windup`, `attack`, `hurt`, `dead`; a pose a brain names that
 * the sheet lacks shows `idle0`), aliases (alias → column pose name: one column can serve several
 * names), the Sprite3D options, and either `humanoid` (a CharacterSprites spec painted with
 * `{ combat: true }`, columns HUMANOID) or `draw` (paints one frame into the Painter: `view` 'down' |
 * 'up' | 'side' — the side view faces left, the `right` row mirrors it — `key` the pose name,
 * `f.G` the ground row) with `ramps` (40 material ramps, `makeRamps`) and an optional `idle`
 * animation ({ poses, fps }; default idle0 / idle1 at 2.5 fps). Painting must be RNG-free
 * (fixed layouts, `hash2` with fixed seeds). A kind with more poses than one row of
 * MAX_SHEET_PX holds, or with views for only some poses, gives a `layout` (MonsterLayout).
 * @typedef {object} MonsterKind
 * @property {number} fw
 * @property {number} fh
 * @property {readonly string[]} columns
 * @property {Record<string, string>} aliases
 * @property {EnemySpriteOptions} spriteOptions
 * @property {object} [humanoid]
 * @property {(p: InstanceType<typeof Painter>, view: 'down'|'up'|'side', key: string, f: { G: number }) => void} [draw]
 * @property {() => any[]} [ramps]
 * @property {{ poses: string[], fps: number }} [idle]
 * @property {MonsterLayout} [layout]
 */

/**
 * One strip of a laid-out sheet (`MonsterLayout`): the cells of `poses` (column names; default: every
 * column, in column order) shown in direction `dir` — 'left' paints the side view, 'right' the side
 * view mirrored, 'down' the front view, 'up' the back view.
 * @typedef {object} MonsterStrip
 * @property {'down'|'left'|'right'|'up'} dir
 * @property {readonly string[]} [poses]
 */

/**
 * A sheet laid out in strips instead of one row per direction (the dragon boss: 54 poses of
 * 192 px, a front view for some): the strips follow each other, each wrapped into rows of at most
 * `perRow` cells (`fw` × `perRow` ≤ MAX_SHEET_PX, the rows × `fh` too). The sheet then holds
 * `cells` (direction → pose name, aliases included → { col, row }) and `cell(name, dir)`, which
 * answers a direction without a strip, or a pose its strip lacks, with the 'left' strip's cell (an
 * unknown pose: `idle0`'s). `poses` maps each name to its 'left' cell's column only — a brain shows
 * a laid-out sheet's frames through `cell` and `sprite.setFrame(col, row)`. A pose shown in
 * 'left' and 'right' is painted once and resolved twice (the second mirrored).
 * @typedef {object} MonsterLayout
 * @property {number} perRow
 * @property {readonly MonsterStrip[]} strips
 */

/**
 * The painting kit a kind module (src/engine/pixel/monsters/<kind>.js) builds its KINDS entry with:
 * each module exports `<kind>(kit) → MonsterKind` and imports nothing of this file at run time (no
 * cycle; `@import { MonsterKit, MonsterKind } from '../MonsterSprites.js'` for the types). Holds the
 * material ids `M` (GEL 35, BONE 36, GLOW 37 — alpha-204 glow texels a combatFx sprite lights —,
 * STONE 38, WING 39 besides CharacterSprites' own), the column lists, the ramp makers and the
 * shared shape painters of this file and of CharacterSprites' `_painterKit`.
 */
export const MONSTER_KIT = Object.freeze({
  M, COMMON, HUMANOID, HUMANOID_MOVE, COMBAT_POSE_NAMES, OUTLINE,
  makeRamps, ramp5, glowRamp, eyeRamp, rampForKind, glowTexel,
  blob, fillPoly, inPoly, thickLine, rock, crack, shear, quadGait, quadLeg, tailChain, hash2,
});
/** @typedef {typeof MONSTER_KIT} MonsterKit */

/**
 * Per kind: frame size, column pose names, aliases (alias → pose name), sprite options, material
 * colours, painter and idle animation override. Humanoids use a character spec instead.
 * @type {Record<string, MonsterKind>}
 */
const KINDS = {
  slime: {
    fw: 20, fh: 16, columns: [...COMMON, 'land'], aliases: {},
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([0.9, 0.45]) }, draw: drawSlime,
    ramps: () => makeRamps({
      [M.GEL]: ramp5(['#1a4a50', '#25807e', '#3fb6a8', '#7fe0c8', '#dcfff2']),
      [M.FUR]: ramp5(['#1e3a24', '#2f5a30', '#4f8238', '#77a845', '#a8cc62']),
      [M.FUR2]: ramp5(['#23502a', '#3a8a3a', '#62bc48', '#9ade6a', '#d8ff9a']),
      [M.EYE]: eyeRamp('#1a2430', '#3a4c5a'),
    }, M.GEL),
  },
  goblin: {
    fw: 32, fh: 32, columns: HUMANOID, humanoid: HUMANOID_SPECS.goblin,
    aliases: { ...HUMANOID_MOVE, windup: 'wind', attack: 'slash', attack2: 'backhand', dead: 'down' },
    spriteOptions: {},
  },
  archer: {
    fw: 32, fh: 32, columns: HUMANOID, humanoid: HUMANOID_SPECS.archer,
    aliases: { ...HUMANOID_MOVE, windup: 'aim', attack: 'follow', shove: 'thrust', dead: 'down' },
    spriteOptions: {},
  },
  shaman: {
    fw: 32, fh: 32, columns: HUMANOID, humanoid: HUMANOID_SPECS.shaman,
    aliases: { ...HUMANOID_MOVE, windup: 'cast', attack: 'aim', blink: 'tuck', dead: 'down' },
    spriteOptions: {},
  },
  bat: {
    fw: 20, fh: 20, columns: COMMON, aliases: {},
    spriteOptions: { castShadow: false, blobSize: /** @type {[number, number]} */ ([0.7, 0.35]) }, draw: drawBat,
    idle: { poses: ['move0', 'move1', 'move2', 'move3'], fps: 10 },
    ramps: () => makeRamps({
      [M.FUR]: ramp5(['#0e0b12', '#1b1720', '#2b2632', '#433b4c', '#625870']),
      [M.WING]: ramp5(['#240a08', '#4e1a0e', '#8e3414', '#d0662a', '#f6a44a']),
      [M.GLOW]: glowRamp(['#6a1a06', '#c4400e', '#ff7a1e', '#ffb84a', '#fff0a8']),
      [M.BONE]: ramp5(['#8a8272', '#b8ae98', '#ddd4bc', '#f2ead6', '#ffffff']),
      [M.EYE]: eyeRamp('#3a1010', '#6a2a1a'),
    }, M.FUR),
  },
  boar: {
    fw: 32, fh: 24, columns: [...COMMON, 'charge0', 'charge1', 'stun'], aliases: {},
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([1.6, 0.7]) }, draw: drawBoar,
    ramps: () => makeRamps({
      [M.FUR]: ramp5(['#1c1c24', '#32323c', '#4c4e5a', '#6c707c', '#9498a4']),
      [M.FUR2]: ramp5(['#0e0e14', '#18181f', '#26262f', '#3a3a46', '#50505e']),
      [M.FUR3]: ramp5(['#3a3a42', '#56565e', '#74747c', '#94949a', '#b4b4b8']),
      [M.NOSE]: ramp5(['#3a2426', '#6a4446', '#94686a', '#b88c8c', '#d8b0ac']),
      [M.BONE]: ramp5(['#7a705e', '#aea48a', '#d8ceb2', '#efe6cc', '#fffaea']),
      [M.METAL]: 'metal',
      [M.EYE]: eyeRamp('#b8321e', '#e06a3a'),
    }, M.FUR),
  },
  dummy: {
    fw: 16, fh: 24, columns: [...COMMON, 'hurt2'], aliases: {},
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([0.7, 0.35]) }, draw: drawDummy,
    ramps: () => makeRamps({
      [M.FUR]: ramp5(['#6a4a18', '#a07a2a', '#d8b453', '#ecd488', '#fbefc0']),
      [M.FUR3]: ramp5(['#5a4630', '#86704e', '#b09a72', '#cdb994', '#e6d8b8']),
      [M.WOOD]: 'wood', [M.LEATHER]: ramp5(['#2a1a10', '#4a3020', '#6e4a30', '#946a44', '#b88c5c']),
      [M.SCARF]: 'red', [M.WHITE]: 'cream',
    }, M.FUR),
  },
  golem: {
    fw: 64, fh: 64, columns: [...COMMON, 'slamWind', 'slam', 'sweepWind', 'sweep', 'throw', 'roar', 'kneel'], aliases: {},
    spriteOptions: { blobSize: /** @type {[number, number]} */ ([2.6, 1.2]) }, draw: drawGolem,
    ramps: () => makeRamps({
      [M.STONE]: ramp5(['#131218', '#23212a', '#373440', '#524e5c', '#77727f']),
      [M.GLOW]: glowRamp(['#6e1c06', '#c2400e', '#f27a22', '#ffba4a', '#fff2b0']),
    }, M.STONE),
  },
  // Vanquish the Evil Dragon (DRAGON_CAMPAIGN.md §5.3): src/engine/pixel/monsters/<kind>.js
  drakeborn: drakeborn(MONSTER_KIT),
  ashhound: ashhound(MONSTER_KIT),
  wyrmcaller: wyrmcaller(MONSTER_KIT),
  kobold: kobold(MONSTER_KIT),
  whelp: whelp(MONSTER_KIT),
  emberimp: emberimp(MONSTER_KIT),
  dragon: dragon(MONSTER_KIT),
};

/**
 * Add a lazy enemy pack's kind (src/game/combat/packs/: registered at load, before the combat makes
 * its sheets; docs/contracts/EVERMERE_CAMPAIGN.md §6.4): its `MonsterKind` recipe — a painter
 * (`draw` + `ramps`, or a `layout`) or a humanoid spec (`humanoid`, columns `MONSTER_KIT.HUMANOID`)
 * — or a factory `(kit) => MonsterKind` called with `MONSTER_KIT` (a monsters/<kind>.js module's
 * export). A kind defined twice — one of this file's, or one registered before — throws; the base
 * kinds' sheets never change.
 * @param {EnemySheetKind} kind
 * @param {MonsterKind | ((kit: MonsterKit) => MonsterKind)} recipe
 */
export function registerMonsterKind(kind, recipe) {
  if (Object.hasOwn(KINDS, kind)) throw new Error(`registerMonsterKind: the enemy kind "${kind}" is defined twice`);
  const def = typeof recipe === 'function' ? recipe(MONSTER_KIT) : recipe;
  const ok = def && def.fw > 0 && def.fh > 0 && Array.isArray(def.columns) && def.aliases && def.spriteOptions
    && (def.humanoid || (typeof def.draw === 'function' && typeof def.ramps === 'function'));
  if (!ok) throw new Error(`registerMonsterKind: "${kind}" needs fw, fh, columns, aliases, spriteOptions and a humanoid spec or draw + ramps`);
  KINDS[kind] = def;
}

/**
 * A kind's recipe (one of this file's or a registered one), or null — for a pack that borrows a
 * painter (its draw, columns and aliases, its own ramps).
 * @param {string} kind
 * @returns {Readonly<MonsterKind>|null}
 */
export function monsterKind(kind) {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind] : null;
}

/**
 * A cell of a laid-out sheet (`MonsterLayout`).
 * @typedef {{ col: number, row: number }} SheetCell
 */

/**
 * Create an enemy sprite sheet (callers cache it: one sheet per kind is shared by every sprite).
 * A kind with a `layout` (MonsterLayout) also gets `cells` and `cell(name, dir)`.
 * @param {EnemySheetKind} kind
 * @returns {{texture: THREE.Texture, canvas: HTMLCanvasElement, frameWidth: number, frameHeight: number,
 *   columns: number, rows: number, pixelsPerUnit: number, anchor: [number, number],
 *   animations: Record<string, {frames: {col:number,row:number}[], fps: number, loop: boolean}>,
 *   name: string, dispose: () => void, kind: string, poses: Record<string, number>,
 *   spriteOptions: EnemySpriteOptions,
 *   cells?: Record<string, Record<string, SheetCell>>,
 *   cell?: (name: string, dir: string) => SheetCell}} EnemySheet
 */
export function createEnemySheet(kind) {
  const def = Object.hasOwn(KINDS, kind) ? KINDS[kind] : null;
  if (!def) throw new Error(`createEnemySheet: unknown enemy kind "${kind}"`);
  if (def.humanoid) return humanoidSheet(kind, def);
  if (def.layout) return laidOutSheet(kind, def);
  const { fw: FW, fh: FH } = def;
  const cols = def.columns.length;
  const rows = DIRECTIONS.length;
  if (FW * cols > MAX_SHEET_PX) throw new Error(`createEnemySheet: "${kind}" is ${FW * cols} px wide (${cols} columns × ${FW}); the most is ${MAX_SHEET_PX}`);
  const pc = new PixelCanvas(FW * cols, FH * rows);
  const p = new Painter(FW, FH);
  const ramps = def.ramps();
  DIRECTIONS.forEach((dir, row) => {
    const view = dir === 'down' ? 'down' : dir === 'up' ? 'up' : 'side';
    def.columns.forEach((key, col) => {
      p.clear();
      def.draw(p, view, key, { G: FH - 2 });
      p.ox = 0; p.oy = 0;
      clipMargin(p);
      resolvePainter(p, ramps, pc, col * FW, row * FH, dir === 'right');
    });
  });

  const poses = {};
  def.columns.forEach((name, col) => { poses[name] = col; });
  for (const [alias, name] of Object.entries(def.aliases)) poses[alias] = poses[name];

  const animations = {};
  const idle = def.idle ?? { poses: ['idle0', 'idle1'], fps: 2.5 };
  const move = ['move0', 'move1', 'move2', 'move3'];
  DIRECTIONS.forEach((d, row) => {
    const at = (list) => list.map((n) => ({ col: poses[n], row }));
    animations[`idle_${d}`] = { frames: at(idle.poses), fps: idle.fps, loop: true };
    animations[`walk_${d}`] = { frames: at(move), fps: 8, loop: true };
    animations[`run_${d}`] = { frames: at(move), fps: 13, loop: true };
  });

  const canvas = pc.toCanvas();
  const texture = finishTexture(canvas, `enemy:${kind}`);
  return {
    texture, canvas, frameWidth: FW, frameHeight: FH, columns: cols, rows,
    pixelsPerUnit: PPU, anchor: [0.5, 0], animations, name: kind,
    kind, poses, spriteOptions: { ...def.spriteOptions },
    /** Free the GPU texture (sprite clones share the image and are disposed by their owners). */
    dispose() { texture.dispose(); },
  };
}

/**
 * A kind with a `layout` (MonsterLayout): its strips, each wrapped into rows of `perRow` cells; a
 * pose shown in several strips of one view ('left' / 'right') is painted once.
 * @param {string} kind
 * @param {MonsterKind} def
 */
function laidOutSheet(kind, def) {
  const { fw: FW, fh: FH } = def;
  const { perRow, strips } = def.layout;
  if (!(perRow >= 1) || FW * perRow > MAX_SHEET_PX) throw new Error(`createEnemySheet: "${kind}" lays out ${perRow} cells of ${FW} px per row; the most is ${MAX_SHEET_PX} px`);
  /** @type {{ dir: string, view: 'down'|'up'|'side', flip: boolean, pose: string, col: number, row: number }[]} */
  const list = [];
  let rowBase = 0;
  let widest = 0;
  for (const s of strips) {
    const poses = s.poses ?? def.columns;
    const view = s.dir === 'down' ? 'down' : s.dir === 'up' ? 'up' : 'side';
    poses.forEach((pose, k) => {
      if (!def.columns.includes(pose)) throw new Error(`createEnemySheet: "${kind}" lays out "${pose}", which is no column`);
      list.push({ dir: s.dir, view, flip: s.dir === 'right', pose, col: k % perRow, row: rowBase + Math.floor(k / perRow) });
    });
    widest = Math.max(widest, Math.min(perRow, poses.length));
    rowBase += Math.ceil(poses.length / perRow);
  }
  if (FH * rowBase > MAX_SHEET_PX) throw new Error(`createEnemySheet: "${kind}" is ${FH * rowBase} px tall (${rowBase} rows × ${FH}); the most is ${MAX_SHEET_PX}`);
  const pc = new PixelCanvas(FW * widest, FH * rowBase);
  const p = new Painter(FW, FH);
  const ramps = def.ramps();
  // (the cells of one painting next to each other: a pose of the side view is painted once for
  // its 'left' and 'right' cells)
  const byPaint = new Map();
  for (const c of list) {
    const key = `${c.view}|${c.pose}`;
    const group = byPaint.get(key);
    if (group) group.push(c);
    else byPaint.set(key, [c]);
  }
  for (const group of byPaint.values()) {
    const { view, pose } = group[0];
    p.clear();
    def.draw(p, view, pose, { G: FH - 2 });
    p.ox = 0; p.oy = 0;
    clipMargin(p);
    for (const c of group) resolvePainter(p, ramps, pc, c.col * FW, c.row * FH, c.flip);
  }

  /** @type {Record<string, Record<string, SheetCell>>} direction → pose (aliases included) → cell */
  const cells = {};
  for (const c of list) (cells[c.dir] ??= {})[c.pose] = { col: c.col, row: c.row };
  for (const map of Object.values(cells)) {
    for (const [alias, name] of Object.entries(def.aliases)) if (map[name]) map[alias] = map[name];
  }
  const left = cells.left ?? {};
  const first = list[0];
  /** @type {(name: string, dir: string) => SheetCell} */
  const cell = (name, dir) => {
    const map = Object.hasOwn(cells, dir) ? cells[dir] : null;
    return (map && Object.hasOwn(map, name) ? map[name] : null)
      ?? (Object.hasOwn(left, name) ? left[name] : null)
      ?? left.idle0 ?? { col: first.col, row: first.row };
  };
  const poses = {};
  for (const [name, c] of Object.entries(left)) poses[name] = c.col;

  const animations = {};
  const idle = def.idle ?? { poses: ['idle0', 'idle1'], fps: 2.5 };
  const move = ['move0', 'move1', 'move2', 'move3'];
  for (const d of DIRECTIONS) {
    const at = (names) => names.map((n) => ({ ...cell(n, d) }));
    animations[`idle_${d}`] = { frames: at(idle.poses), fps: idle.fps, loop: true };
    animations[`walk_${d}`] = { frames: at(move), fps: 8, loop: true };
    animations[`run_${d}`] = { frames: at(move), fps: 13, loop: true };
  }

  const canvas = pc.toCanvas();
  const texture = finishTexture(canvas, `enemy:${kind}`);
  return {
    texture, canvas, frameWidth: FW, frameHeight: FH, columns: widest, rows: rowBase,
    pixelsPerUnit: PPU, anchor: /** @type {[number, number]} */ ([0.5, 0]), animations, name: kind,
    kind, poses, spriteOptions: { ...def.spriteOptions }, cells, cell,
    /** Free the GPU texture (sprite clones share the image and are disposed by their owners). */
    dispose() { texture.dispose(); },
  };
}

/** Goblin / archer / shaman: the character combat sheet of the kind's spec, with the enemy aliases. */
function humanoidSheet(kind, def) {
  const s = createCharacterSheet(def.humanoid, { combat: true });
  s.texture.name = `enemy:${kind}`;
  const poses = { ...s.poses };
  for (const [alias, name] of Object.entries(def.aliases)) poses[alias] = s.poses[name];
  return {
    texture: s.texture, canvas: s.canvas, frameWidth: s.frameWidth, frameHeight: s.frameHeight,
    columns: s.columns, rows: s.rows, pixelsPerUnit: s.pixelsPerUnit, anchor: s.anchor,
    animations: s.animations, name: kind, kind, poses, spriteOptions: { ...def.spriteOptions },
    dispose() { s.dispose(); },
  };
}
