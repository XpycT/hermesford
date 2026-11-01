import { createCharacterSheet, COMBAT_POSE_NAMES, _painterKit } from './CharacterSprites.js';
import { DIRECTIONS, PPU } from '../constants.js';

/**
 * FestivalPoses.js — the festival sheet of a character (Vanquish the Evil Dragon: the panicking
 * village and the bonfire festival; docs/contracts/DRAGON_CAMPAIGN.md §6.3,
 * docs/design/SIEGE_AND_FESTIVAL.md). Owner: the siege package.
 *
 * Opt-in: only a character that needs a pose is made with it — a villager of the `panic`, `dance`,
 * `cheer` or `cower` behaviour or one a story poses (Npc.js, `NpcDef.festival`); any character
 * spec works (`createFestivalSheet(spec)` takes `createCharacterSheet`'s), so the player or a
 * party member on a peaceful level can wear it too (its first six columns are their plain sheet's
 * pixels: idle, walk and run play as before). Every other sheet is untouched, and so are the plain
 * sheets' pixels and hashes.
 *
 * Layout: frames 32 × 32, rows = DIRECTIONS (down, left, right, up); columns 0–5 are the plain
 * sheet's pixels byte for byte (idle0, idle1, walk0–walk3), columns 6–14 the festival poses
 * (`FESTIVAL_POSE_NAMES`): `cower`, `cheer0`, `cheer1`, `dance0`–`dance3`, `kneel`, `bow`. Its
 * texture is `character:<preset>:festival`; `poses` maps every column's pose name to its column
 * (`idle0` … `walk3`, `cower` … `bow`); animations: the plain ones plus `cheer_<dir>` (a jump with
 * both arms up, 2 frames), `dance_<dir>` (4 frames: arms out, a hop with arms up, one arm up, a
 * hop), and the held poses `cower_<dir>`, `kneel_<dir>`, `bow_<dir>`, for all four directions. The
 * story's `pose` (StoryRunner `POSE_PLAYS`) plays `cheer` and `dance` by their animations and
 * `cower`, `kneel`, `bow` by their `poses` columns.
 *
 * The poses are painted by the engine's own character painter — the arm, leg and lean layouts of
 * the combat sheet's poses (CharacterSprites `createCharacterSheet(spec, { combat: true })`: arms
 * raised to cast, flung wide in a spin, one arm up in a wind-up, the crouched tuck) — and composed
 * per direction from whole rows of those frames (a hop is the frame lifted, a bow the head and
 * shoulders lowered, a kneel the legs folded): the same outlines, ramps and light as every villager.
 */

/** The festival pose columns 6–14, in column order. */
export const FESTIVAL_POSE_NAMES = Object.freeze(['cower', 'cheer0', 'cheer1', 'dance0', 'dance1', 'dance2', 'dance3', 'kneel', 'bow']);

const FW = 32;
const FH = 32;
/** The plain sheet's columns. */
const PLAIN = 6;
/** A combat pose's column in the combat sheet. @param {string} name */
const combatCol = (name) => PLAIN + COMBAT_POSE_NAMES.indexOf(name);

/**
 * How each festival frame is made from the combat sheet, per view: `src` the source pose ('idle0'
 * = plain column 0), `dy` a lift (negative: up), `flip` mirrored (front / back views only), `fold`
 * legs folded by n px (the body above the hips lowered, the feet kept), `lower` the head and
 * shoulders lowered by n px (and `fwd` px forward in a side view).
 * @typedef {{ src: string, dy?: number, flip?: boolean, fold?: number, lower?: number, fwd?: number }} PoseRecipe
 */

/** @type {Record<string, { front: PoseRecipe, side: PoseRecipe }>} */
const RECIPES = {
  cower: { front: { src: 'tuck' }, side: { src: 'tuck' } },
  cheer0: { front: { src: 'cast' }, side: { src: 'cast' } },
  cheer1: { front: { src: 'cast', dy: -2 }, side: { src: 'cast', dy: -2 } },
  dance0: { front: { src: 'spin' }, side: { src: 'spin' } },
  dance1: { front: { src: 'cast', dy: -1 }, side: { src: 'cast', dy: -1 } },
  dance2: { front: { src: 'wind' }, side: { src: 'follow' } },
  dance3: { front: { src: 'spin', dy: -1, flip: true }, side: { src: 'wind', dy: -1 } },
  kneel: { front: { src: 'idle0', fold: 3 }, side: { src: 'idle0', fold: 3 } },
  bow: { front: { src: 'idle0', lower: 2 }, side: { src: 'idle0', lower: 1, fwd: 2 } },
};

/** One-row animations of the festival poses (frame lists, fps). */
const FESTIVAL_ANIMS = {
  cheer: { frames: ['cheer0', 'cheer1'], fps: 4 },
  dance: { frames: ['dance0', 'dance1', 'dance2', 'dance3'], fps: 5 },
  cower: { frames: ['cower'], fps: 1 },
  kneel: { frames: ['kneel'], fps: 1 },
  bow: { frames: ['bow'], fps: 1 },
};

/**
 * Create a villager's festival sheet (see the module notes). Same spec as `createCharacterSheet`
 * (a spec object or a bare preset name); the result has the same shape plus `poses` (pose name →
 * column: the plain poses' and the festival ones').
 * @param {string|object|null} [spec]
 * @returns {ReturnType<typeof createCharacterSheet>}
 */
export function createFestivalSheet(spec = {}) {
  const combat = createCharacterSheet(spec, { combat: true });
  // (only its pixels are needed: its texture is never uploaded)
  combat.texture.dispose();
  const src = combat.canvas;
  const cols = PLAIN + FESTIVAL_POSE_NAMES.length;
  const canvas = document.createElement('canvas');
  canvas.width = FW * cols;
  canvas.height = FH * DIRECTIONS.length;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  // the plain columns, byte for byte (canvas to canvas)
  g.drawImage(src, 0, 0, FW * PLAIN, FH * DIRECTIONS.length, 0, 0, FW * PLAIN, FH * DIRECTIONS.length);
  const child = /** @type {{ build?: string }} */ (combat.spec)?.build === 'child';
  // a child's legs are short: fold them less
  const k = child ? 0.67 : 1;
  /** the rig's rows: the hips (fold above them) and the shoulders (a bow lowers above them) */
  const hip = child ? 26 : 24;
  const neck = child ? 21 : 14;
  DIRECTIONS.forEach((dir, row) => {
    const side = dir === 'left' || dir === 'right';
    FESTIVAL_POSE_NAMES.forEach((name, i) => {
      const r = RECIPES[name][side ? 'side' : 'front'];
      const sc = r.src === 'idle0' ? 0 : combatCol(r.src);
      const sx = sc * FW;
      const sy = row * FH;
      const dx = (PLAIN + i) * FW;
      const dy = row * FH;
      /** draw rows [y0, y1) of the source frame at (ox, oy) in the target frame */
      const rows = (y0, y1, ox, oy) => {
        if (y1 <= y0) return;
        g.drawImage(src, sx, sy + y0, FW, y1 - y0, dx + ox, dy + y0 + oy, FW, y1 - y0);
      };
      if (r.fold) {
        // legs folded: the body down to the hips lowered, the feet (the last 4 rows) kept
        const f = Math.round(r.fold * k);
        rows(FH - 4, FH, 0, 0);
        rows(0, hip, 0, f);
      } else if (r.lower) {
        // a bow: below the shoulders as it stands, the head and shoulders lowered (and forward)
        const fwd = side ? (dir === 'left' ? -1 : 1) * (r.fwd ?? 0) : 0;
        rows(neck, FH, 0, 0);
        rows(0, neck, fwd, Math.round(r.lower * k));
      } else if (r.flip) {
        g.save();
        g.translate(dx + FW, dy);
        g.scale(-1, 1);
        g.drawImage(src, sx, sy, FW, FH, 0, r.dy ?? 0, FW, FH);
        g.restore();
      } else {
        g.drawImage(src, sx, sy, FW, FH, dx, dy + (r.dy ?? 0), FW, FH);
      }
    });
  });
  const name = combat.name;
  const texture = _painterKit.finishTexture(canvas, `character:${name}:festival`);
  /** @type {Record<string, number>} */
  const poses = {};
  _painterKit.POSES.forEach((pose, col) => { poses[pose.key] = col; });
  FESTIVAL_POSE_NAMES.forEach((pose, i) => { poses[pose] = PLAIN + i; });
  const animations = _painterKit.buildAnimations(DIRECTIONS.length, {
    extra: (anims, d, row) => {
      for (const [anim, a] of Object.entries(FESTIVAL_ANIMS)) {
        anims[`${anim}_${d}`] = { frames: a.frames.map((p) => ({ col: poses[p], row })), fps: a.fps, loop: true };
      }
    },
  });
  return {
    texture, canvas, frameWidth: FW, frameHeight: FH, columns: cols, rows: DIRECTIONS.length,
    pixelsPerUnit: PPU, anchor: [0.5, 0], animations, name, spec: combat.spec, poses,
    /** Free the GPU texture (clones made by sprites share the image and must be disposed by their owners). */
    dispose() { texture.dispose(); },
  };
}
