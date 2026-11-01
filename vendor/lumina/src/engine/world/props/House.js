import * as THREE from 'three';
import { clamp, smoothstep, DEG2RAD } from '../../utils/math.js';
import { TRIM, centerOff, centeredSides, lanternGeom, flowerBoxGeom } from './Details.js';
import { ownValue } from '../../utils/own.js';
import { needSetPieceKit } from '../SetPieceKit.js';
import { needSeasonKit } from '../SeasonKit.js';

/**
 * @import { PropFactory, PropResult } from '../Props.js'
 * @import { MeshBuilder } from './MeshBuilder.js'
 * @import { RNG } from '../../utils/math.js'
 */

/**
 * Procedural 2.5D pixel-art house.
 *
 * Internal frame: ridge along local X, footprint centred on the origin, ground at y = 0.
 * `gableFront` rotates the internal frame by -90° so the gable faces the front (+Z).
 *
 * Vertical layout (world units, 16 px each):
 *   0 … P            stone plinth (one 8 px stone row per 0.5)
 *   P … P+H1         ground floor (H1 = 3: timber_frame beams at 0, 1, 2, 3 line up exactly)
 *   P+H1 … +H2       optional jettied upper floor (H2 = 2)
 *   eave … ridge     two thick sloped slabs with overhang, dark fascia/barge boards, ridge cap
 *
 * The siege options of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §5.3, §6.3;
 * docs/design/SIEGE_AND_FESTIVAL.md; owner: the siege package) — absent, a house builds exactly as
 * before (every random choice of an intact house comes from the same RNG in the same order; the
 * siege's own choices come from a second RNG, `house:siege`):
 *  - `flatRoof`: a flat adobe roof — a deck within a parapet, roof beams (vigas) jutting from the
 *    walls, a water spout, a squat chimney, a ladder against a one-storey house, a timber balcony
 *    on the upper floor of a two-storey one; no jetty.
 *  - `ruin` 1 (damaged): holes in the roof showing charred rafters and the dark attic, charred
 *    rims; the windows dark and broken, shutters hanging askew or gone, soot over the openings,
 *    cracks, a fallen beam, scorched ground. `ruin` 2 (gutted): the walls built as broken courses —
 *    a front torn open down to the ground floor, a corner collapsed, the interior floor with
 *    rubble and fallen beams; only a stub of the roof frame (rafters, ridge beam) at one gable end.
 *  - `burning` 0–1: flames along the roof (at its holes, along the ridge or on the deck), licking
 *    out of the windows (and up from the floor of a gutted house), the windows lit by the fire day
 *    and night (`FIRE_WINDOW_GLOW`), showers of sparks, a tall dark smoke column (`smokeDark`: the
 *    one particle emitter a burning house costs) and one flickering fire light (`fire: true`: kept
 *    even when the house's `light` is off — ObjectBuilder; priority 0). The flames and sparks are
 *    batched (FlameBatch.js).
 *  - the arid walls (`adobe`, `whitewash`: soft corner pilasters and a darker skirting band;
 *    `sandstone_brick`, `charred_wall`: quoins) take a sandstone plinth by default.
 */

export const SIDES = {
  // internal faces: centre on the wall plane, outward normal, yaw of the face frame, length key
  front: { n: [0, 1], yaw: 0 },
  back: { n: [0, -1], yaw: Math.PI },
  right: { n: [1, 0], yaw: Math.PI / 2 },
  left: { n: [-1, 0], yaw: -Math.PI / 2 },
};
// external side → internal side when the internal frame is rotated by -90° (gableFront)
const GABLE_FRONT_MAP = { front: 'right', back: 'left', left: 'front', right: 'back' };

const SHUTTER_TINTS = [
  [0.62, 0.78, 1.0], // blue
  [0.7, 0.95, 0.65], // green
  [1.0, 0.72, 0.62], // red
  [1, 1, 1], // natural wood
];

/** The arid walls (the siege's textures): their plinth and trim. */
const PLASTER_WALLS = new Set(['adobe', 'whitewash']);
export const ASHLAR_WALLS = new Set(['sandstone_brick', 'charred_wall']);
/** Vertex tints: charred wood, soot on masonry, the dark of an empty room. */
export const CHAR = [0.3, 0.26, 0.25];
export const SOOT = [0.46, 0.4, 0.38];
export const VOID = [0.07, 0.055, 0.05];

/**
 * Options of `buildHouse` / `PropFactory.house` (defaults in brackets; OBJECT_CATALOG.md §house,
 * docs/architecture/modules/world.md §4.2). Mirrored in src/engine/level/types.d.ts
 * (ObjectExtras.house.opts), kept separate so the Node tools stay free of three.js: change both.
 * @typedef {object} HouseOptions
 * @property {number} [width] footprint along the front (4)
 * @property {number} [depth] footprint front to back (3)
 * @property {number} [stories] 1 or 2 (1)
 * @property {string} [roof] roof texture ('roof_red')
 * @property {string} [wall] wall texture ('timber_frame')
 * @property {string} [upperWall] upper-storey / gable wall texture (`wall`)
 * @property {number} [rotation] yaw in radians (0)
 * @property {boolean} [chimney] (true)
 * @property {'front'|'back'|'left'|'right'|'none'|false} [door] door side ('front'); 'none' or
 *   false = no door
 * @property {number} [seed] variation seed
 * @property {string} [id] `interact.id` (default 'house')
 * @property {boolean} [gableFront] turn the gable to the front (false)
 * @property {string} [plinth] plinth texture ('stone_brick'; the arid walls: 'sandstone_brick',
 *   `charred_wall`: 'charred_wall')
 * @property {number} [plinthHeight] (0.5)
 * @property {number} [storyHeight] ground-floor height (3.0)
 * @property {number} [upperHeight] second-storey height (2.0)
 * @property {number} [jetty] second-storey overhang (0.25; a flat roof or a gutted house: 0)
 * @property {number} [pitch] roof pitch in degrees (random 38–45)
 * @property {number} [overhang] roof overhang (0.35)
 * @property {number} [roofThickness] (0.22)
 * @property {string} [gable] gable-end texture (the upper wall, 'wood_planks' for brick / stone)
 * @property {string} [ridge] ridge-cap texture (the roof)
 * @property {number} [chimneySide] 1 or -1 (random)
 * @property {boolean} [shutters] (random 60 %)
 * @property {boolean} [flowerboxes] (true; a damaged or burning house: false)
 * @property {number} [doorOffset] door position along its wall (random)
 * @property {boolean} [lantern] door lantern (true; a damaged or burning house: false)
 * @property {boolean} [sign] hanging sign beside the door
 * @property {boolean} [woodpile] (random 55 %)
 * @property {boolean} [doorHood] (random 55 %)
 * @property {boolean} [windowLights] a second, dim night light at the door
 * @property {number} [ruin] damage 0–2 (0): 1 damaged, 2 gutted (see the notes above)
 * @property {number} [burning] 0–1 (0): how fiercely it burns
 * @property {boolean} [flatRoof] a flat adobe roof with a parapet and vigas (false)
 * @property {boolean} [icicles] The Bells of Evermere: icicles on the eaves while the level is
 *   frozen (the season kit's `houseIcicles`, props/Belfry.js: their own RNG stream; not on a flat
 *   or damaged roof)
 */

/**
 * @param {PropFactory} f
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {HouseOptions} [opts]
 * @returns {PropResult}
 */
export function buildHouse(f, x, y, z, opts = {}) {
  const o = {
    width: 4, depth: 3, stories: 1, roof: 'roof_red', wall: 'timber_frame', rotation: 0, chimney: true, door: 'front',
    ...opts,
  };
  const T = f.textures;
  const rng = f.rng('house', x, z, o.seed);
  // the siege options (level data: numbers clamped, anything else ignored)
  const ruin = Number.isFinite(o.ruin) ? clamp(Math.round(o.ruin), 0, 2) : 0;
  const burning = Number.isFinite(o.burning) ? clamp(o.burning, 0, 1) : 0;
  const flat = o.flatRoof === true;
  const damaged = ruin > 0 || burning > 0;
  /** the siege's own random choices (an intact house's RNG sequence stays as it was) */
  const sr = damaged || flat ? f.rng('house:siege', x, z, o.seed) : null;
  /**
   * the siege's builders (./HouseSiege.js, the decals and the fire-lit glass of ./SetPieces.js, the
   * flames of ./FlameBatch.js): the set-piece kit's, loaded for a level that has such a house
   */
  const S = damaged || flat ? needSetPieceKit('a damaged, burning or flat-roofed house') : null;
  const gf = !!o.gableFront;
  const W = gf ? o.depth : o.width;
  const D = gf ? o.width : o.depth;
  const stories = clamp(Math.round(o.stories), 1, 2);
  const P = o.plinthHeight ?? 0.5;
  const H1 = o.storyHeight ?? 3.0;
  const H2 = stories > 1 ? (o.upperHeight ?? 2.0) : 0;
  const J = stories > 1 ? (o.jetty ?? (flat || ruin === 2 ? 0 : 0.25)) : 0;
  const wall = o.wall;
  const upperWall = o.upperWall ?? wall;
  const plinth = o.plinth ?? (wall === 'charred_wall' ? 'charred_wall' : PLASTER_WALLS.has(wall) || ASHLAR_WALLS.has(wall) ? 'sandstone_brick' : 'stone_brick');
  const E = P + H1 + H2;
  const hw = W / 2;
  const hd = D / 2;
  const hs = hd + J;
  const pitch = (o.pitch ?? rng.range(38, 45)) * DEG2RAD;
  const O = o.overhang ?? 0.35;
  const R = hs * Math.tan(pitch);
  const Ts = o.roofThickness ?? 0.22;
  const pm = 0.1;

  const ao = (px, py) => {
    let a = 0.62 + 0.38 * smoothstep(-0.05, 1.1, py);
    if (py > P && py < E + 0.01) a *= 1 - 0.2 * smoothstep(E - 0.9, E, py);
    return a;
  };
  const b = f.builder(ao);
  if (gf) b.matrix.makeRotationY(-Math.PI / 2);

  const winMat = f.windowMaterial();
  const glassMat = f.glassMaterial();
  const lights = [];
  const emitters = [];
  const emissives = [{ material: winMat, day: 0, night: 1.6 }];
  const anchors = {}; // builder-space points converted to world at the end
  /** the siege's extras: decals, the fire-lit glass, the flames (group-local) */
  const decal = damaged ? S.siegeDecalMaterial(f) : null;
  const fireWin = burning > 0 ? S.fireWindowMaterial(f) : null;
  if (fireWin) emissives.push({ material: fireWin, ...S.FIRE_WINDOW_GLOW });
  const flames = burning > 0 ? new S.FlameSet() : null;
  /** windows and doors drawn, in face frames: where the soot and the window flames go */
  const openings = [];

  // ---------------------------------------------------------------------------------------
  // plinth + walls
  // ---------------------------------------------------------------------------------------
  const Up = T.meta(plinth).units[0];
  b.box(plinth, [W + 2 * pm, P, D + 2 * pm], {
    at: [0, P / 2, 0], faces: { ...centeredSides(W + 2 * pm, D + 2 * pm, Up), ny: false }, cutsT: [P * 0.5],
  });

  /** a gutted house's broken walls: each side's top height along its face (null: whole walls) */
  let broken = null;
  let yUp = P + H1;
  if (ruin === 2) {
    broken = S.brokenWalls(b, T, sr, { W, D, P, H1, E, wall, upperWall, stories, door: houseDoorSide(o, gf) });
  } else {
    const Uw = T.meta(wall).units[0];
    b.box(wall, [W, H1, D], {
      at: [0, P + H1 / 2, 0], faces: { ...centeredSides(W, D, Uw), py: false, ny: false }, cutsT: [0.5, H1 - 0.9],
    });
    wallTrim(b, T, wall, W, D, P, H1, rng, { top: stories === 1 && !flat, bottom: true });

    if (stories > 1) {
      const Uu = T.meta(upperWall).units[0];
      b.box(upperWall, [W, H2, D + 2 * J], {
        at: [0, yUp + H2 / 2, 0], faces: { ...centeredSides(W, D + 2 * J, Uu), py: false, ny: false }, cutsT: [H2 - 0.9],
      });
      // floor band + joist ends under the jetty
      b.box(TRIM, [W + 0.14, 0.24, D + 2 * J + 0.14], { at: [0, yUp + 0.04, 0] });
      const nJ = Math.max(2, Math.round(W / 0.55));
      for (let i = 0; i < nJ; i++) {
        const jx = -hw + 0.25 + (i * (W - 0.5)) / (nJ - 1);
        for (const s of [-1, 1]) b.box(TRIM, [0.13, 0.13, J + 0.08], { at: [jx, yUp - 0.13, s * (hd + J / 2)], faces: { nz: s > 0 ? false : true, pz: s < 0 ? false : true } });
      }
      wallTrim(b, T, upperWall, W, D + 2 * J, yUp + 0.16, H2 - 0.16, rng, { top: !flat, bottom: false });
    }
  }

  // ---------------------------------------------------------------------------------------
  // gables
  // ---------------------------------------------------------------------------------------
  const gableMat = o.gable ?? (upperWall === 'brick' || upperWall === 'stone_brick' ? 'wood_planks' : upperWall);
  const gBase = stories > 1 ? yUp : P;
  if (!flat) {
    const Ug = T.meta(gableMat).units;
    const vertPlanks = gableMat === 'wood_planks' || gableMat === 'wood_planks_dark';
    const gOff = centerOff(2 * hs, Ug[0]);
    for (const s of [1, -1]) {
      // (a gutted house keeps only the gable at its standing end)
      if (broken && s === broken.collapseEnd) continue;
      const gx = s * hw;
      const pts = s > 0
        ? [[gx, E, hs], [gx, E, -hs], [gx, E + R + 0.02, 0]]
        : [[gx, E, -hs], [gx, E, hs], [gx, E + R + 0.02, 0]];
      const sDir = s > 0 ? [0, 0, -1] : [0, 0, 1];
      const tint = damaged ? { color: ruin ? SOOT : [0.8, 0.74, 0.72] } : {};
      b.poly(gableMat, pts, vertPlanks
        ? { uAxis: [0, 1, 0], vAxis: sDir, origin: [gx, gBase, s * hs], off: [0, gOff], ...tint }
        : { uAxis: sDir, vAxis: [0, 1, 0], origin: [gx, gBase, s * hs], off: [gOff, 0], ...tint });
      // a damaged house's roof is open: the gable's inside shows (charred)
      if (ruin) b.poly(TRIM, [pts[1], pts[0], pts[2]].map((p) => [p[0] - s * 0.03, p[1], p[2]]), { uAxis: sDir, vAxis: [0, 1, 0], color: CHAR });
      // tie beam at the gable base + king post
      b.box(TRIM, [0.1, 0.16, 2 * hs + 0.1], { at: [gx + s * 0.05, E + 0.02, 0] });
      if (!vertPlanks) b.box(TRIM, [0.1, R * 0.8, 0.16], { at: [gx + s * 0.04, E + R * 0.4, 0], rotUV: true });
    }
  }

  // ---------------------------------------------------------------------------------------
  // roof
  // ---------------------------------------------------------------------------------------
  const roof = o.roof;
  const ridgeY = E + R;
  const c = Math.cos(pitch);
  const sn = Math.sin(pitch);
  const ridgeTop = ridgeY + Ts / c;
  /** where the roof burns (builder space): hole centres, the ridge, the deck */
  const roofFires = [];
  if (flat) {
    S.flatRoofGeom(b, T, sr, { W, D, E, wall, ruin, stories, chimney: o.chimney, anchors, roofFires, decal });
  } else if (ruin > 0) {
    S.ruinedRoof(b, T, sr, { W, hw, hs, E, R, O, Ts, pitch, roof, ruin, collapseEnd: broken?.collapseEnd ?? 0, roofFires });
  } else {
    const Ur = T.meta(roof).units[0];
    const tn = Math.tan(pitch);
    const Lx = W + 2 * O;
    const Ls = (hs + O) / c + Ts * tn;
    const cS = ((hs + O) / c - Ts * tn) / 2;
    for (const side of [1, -1]) {
      const center = [0, ridgeY - sn * cS + (c * Ts) / 2, side * (c * cS + (sn * Ts) / 2)];
      b.push(center, side > 0 ? [pitch, 0, 0] : [pitch, Math.PI, 0, 'YXZ']);
      b.box(roof, [Lx, Ts, Ls], {
        faces: {
          py: { off: [centerOff(Lx, Ur), 0] },
          ny: { mat: TRIM, color: [0.8, 0.78, 0.8] },
          pz: { mat: TRIM },
          nz: false,
          px: { mat: TRIM },
          nx: { mat: TRIM },
        },
      });
      // chunky fascia along the eave and barge boards along the gable ends
      b.box(TRIM, [Lx + 0.1, Ts + 0.16, 0.09], { at: [0, -0.06, Ls / 2 + 0.03], faces: { nz: false } });
      for (const s of [-1, 1]) b.box(TRIM, [0.09, Ts + 0.16, Ls + 0.02], { at: [s * (Lx / 2 + 0.035), -0.06, 0.005], faces: { nz: false } });
      b.pop();
    }
    // ridge cap (diamond section)
    b.box(o.ridge ?? roof, [Lx + 0.14, 0.3, 0.3], { at: [0, ridgeTop - 0.05, 0], rot: [Math.PI / 4, 0, 0], faces: { px: TRIM, nx: TRIM }, color: [0.82, 0.8, 0.82] });
    if (burning > 0) {
      // no hole: it burns along the ridge
      const n = 1 + Math.round(burning * 2.5);
      for (let i = 0; i < n; i++) roofFires.push({ x: (i - (n - 1) / 2) * (W / Math.max(1, n)) + sr.range(-0.3, 0.3), y: ridgeY - 0.25, z: sr.range(-0.3, 0.3), size: 1 });
    }
  }

  // ---------------------------------------------------------------------------------------
  // chimney
  // ---------------------------------------------------------------------------------------
  if (o.chimney && !flat) {
    const side = o.chimneySide ?? (rng.chance(0.5) ? 1 : -1);
    const cx = side * Math.max(0.2, hw - 0.8);
    const cz = rng.chance(0.6) ? -hs * 0.42 : hs * 0.3;
    // (a gutted house's chimney stands broken off, by its standing gable)
    const top = ruin === 2 ? E + R * 0.45 : ridgeTop + 0.75;
    const base = E - 0.2;
    const cw = 0.74;
    const Uc = T.meta('chimney_stone').units;
    if (!(broken && Math.sign(cx) === broken.collapseEnd)) {
      b.box('chimney_stone', [cw, top - base, cw], { at: [cx, (top + base) / 2, cz], faces: { ...centeredSides(cw, cw, Uc[0], { vOff: (base - E) }), ny: false, py: false }, color: damaged ? SOOT : undefined });
      if (ruin < 2) {
        b.box(plinth, [cw + 0.2, 0.16, cw + 0.2], { at: [cx, top + 0.08, cz] });
        b.box('chimney_stone', [cw - 0.1, 0.12, cw - 0.1], { at: [cx, top + 0.2, cz], faces: { py: false } });
        b.box('chimney_stone', [cw - 0.26, 0.02, cw - 0.26], { at: [cx, top + 0.255, cz], faces: { ny: false }, color: [0.1, 0.08, 0.08] });
      } else b.box('chimney_stone', [cw - 0.16, 0.02, cw - 0.16], { at: [cx, top + 0.005, cz], faces: { ny: false }, color: [0.1, 0.08, 0.08] });
      // (a damaged house is cold: no hearth smoke)
      if (!damaged) anchors.smoke = b.point(cx, top + 0.45, cz);
    }
  }

  // ---------------------------------------------------------------------------------------
  // facades: door, windows, details
  // ---------------------------------------------------------------------------------------
  const faceInfo = (side, upper) => {
    const sd = SIDES[side];
    const long = side === 'front' || side === 'back';
    const depthHalf = upper ? hd + J : hd;
    const L = long ? W : (upper ? D + 2 * J : D);
    const cx = sd.n[0] * hw;
    const cz = sd.n[1] * depthHalf;
    return { L, cx, cz, yaw: sd.yaw, long };
  };
  const pushFace = (fi) => b.push([fi.cx, 0, fi.cz], fi.yaw);

  const doorSideExt = o.door === 'none' || o.door === false ? null : (o.door || 'front');
  const doorSide = doorSideExt ? (gf ? ownValue(GABLE_FRONT_MAP, doorSideExt) : doorSideExt) : null;
  const shutters = o.shutters ?? rng.chance(0.6);
  const shutterTint = SHUTTER_TINTS[rng.int(0, SHUTTER_TINTS.length - 1)];
  const flowerboxes = o.flowerboxes ?? !damaged;
  let doorX = 0;
  /** the glass of a window: lit by a fire inside, broken and dark, or the village's own */
  const glassOf = () => (fireWin ?? (ruin ? null : winMat));
  /** does the (gutted) wall stand up to height y over [x0, x1] of this face? */
  const stands = (side, x0, x1, yTop) => !broken || broken.minTop(side, x0, x1) >= yTop;

  for (const side of ['front', 'back', 'right', 'left']) {
    // ----- ground floor
    const fi = faceInfo(side, false);
    pushFace(fi);
    const hasDoor = side === doorSide;
    if (hasDoor) {
      const offX = fi.L / 2 - 1.15;
      const pickOff = fi.L >= 4 && (fi.L < 5.5 || rng.chance(0.5));
      doorX = o.doorOffset ?? (pickOff ? (rng.chance(0.5) ? -offX : offX) : 0);
    }
    // (a gutted house's door may have gone with its wall: no door, nothing to knock on)
    if (hasDoor && stands(side, doorX - 0.75, doorX + 0.75, P + 2.3)) {
      doorGeom(b, T, doorX, P, pm, plinth, rng, o, damaged);
      openings.push({ side, upper: false, x: doorX, y: P, w: 1, h: 2.1, door: true });
      anchors.door = b.point(doorX, 0, pm + 0.9);
      // the door leaf's edges at mid-height (interact.lookSpan; the leaf is doorGeom's 1 × 2 quad)
      anchors.leafA = b.point(doorX - 0.5, P + 1, 0.02);
      anchors.leafB = b.point(doorX + 0.5, P + 1, 0.02);
      // lantern or hanging sign beside the door
      const spaceR = fi.L / 2 - (doorX + 0.7);
      const spaceL = (doorX - 0.7) + fi.L / 2;
      const lside = spaceR >= spaceL ? 1 : -1;
      const lx = doorX + lside * 0.98;
      if ((o.lantern ?? !damaged) && Math.abs(lx) < fi.L / 2 - 0.15) {
        const ly = P + 1.95;
        b.box('metal', [0.05, 0.05, 0.46], { at: [lx, ly + 0.36, 0.23] });
        b.box('metal', [0.04, 0.04, 0.32], { at: [lx, ly + 0.25, 0.12], rot: [-0.75, 0, 0] });
        b.box('metal', [0.1, 0.14, 0.03], { at: [lx, ly + 0.3, 0.015] });
        lanternGeom(b, glassMat, lx, ly, 0.44, { w: 0.22, h: 0.28 });
        // same values as the lamppost: the glass material is shared, so every descriptor must agree
        emissives.push({ material: glassMat, day: 0, night: 2.4 });
        anchors.lantern = b.point(lx, ly, 0.6);
      }
      if (o.sign) {
        const sx = doorX - lside * 1.0;
        if (Math.abs(sx) < fi.L / 2 + 0.2) {
          // bracket angled 45° away from the door so the board reads from the diorama camera
          b.push([sx, 0, 0], -lside * Math.PI / 4);
          signGeom(b, T, 0, P + 2.35);
          b.pop();
        }
      }
    }
    const winY = P + 1.0;
    const slots = windowSlots(fi.L, hasDoor ? doorX : null, fi.long);
    for (const wx of slots) {
      if (!hasDoor && !fi.long && rng.chance(0.25)) continue;
      const fbox = flowerboxes && (side === 'front' || rng.chance(0.3)) && rng.chance(0.75);
      const room = Math.min(fi.L / 2 - Math.abs(wx), hasDoor ? Math.abs(wx - doorX) - 0.75 : 9);
      const uShift = rng.range(0, 1);
      if (!stands(side, wx - 0.7, wx + 0.7, winY + 1.15)) continue;
      windowGeom(b, glassOf(), wx, winY, { shutters: shutters && room > 1.12, shutterTint, flowerbox: fbox, uShift, ruin, sr });
      openings.push({ side, upper: false, x: wx, y: winY, w: 1, h: 1 });
    }
    b.pop();
    // ----- upper floor
    if (stories > 1) {
      const fu = faceInfo(side, true);
      pushFace(fu);
      const slotsU = windowSlots(fu.L, null, fu.long);
      for (const wx of slotsU) {
        if (!fu.long && rng.chance(0.3)) continue;
        const room = fu.L / 2 - Math.abs(wx);
        const fb = flowerboxes && side === 'front' && rng.chance(0.5);
        const uShift = rng.range(0, 1);
        if (!stands(side, wx - 0.7, wx + 0.7, yUp + 1.65)) continue;
        windowGeom(b, glassOf(), wx, yUp + 0.5, { shutters: shutters && room > 1.12, shutterTint, flowerbox: fb, uShift, ruin, sr });
        openings.push({ side, upper: true, x: wx, y: yUp + 0.5, w: 1, h: 1 });
      }
      if (flat && side === 'front' && !damaged && sr.chance(0.75)) S.balconyGeom(b, sr, fu.L, yUp);
      b.pop();
    }
  }

  // small side details: a log pile against one gable wall
  if (o.woodpile ?? rng.chance(0.55)) {
    const side = rng.chance(0.5) ? 'right' : 'left';
    const fi = faceInfo(side, false);
    pushFace(fi);
    if (stands(side, -fi.L / 2, fi.L / 2, P + 1.5)) woodpileGeom(b, rng.range(-0.4, 0.4) * (fi.L - 2), pm + 0.28, damaged ? CHAR : null);
    b.pop();
  }

  // ---------------------------------------------------------------------------------------
  // the siege: soot, cracks, fallen beams, the dark inside, scorched ground, flames
  // ---------------------------------------------------------------------------------------
  if (damaged) S.siegeDetails(b, T, sr, {
    W, D, P, E, hw, hd, J, stories, ruin, burning, flat, gableR: R, broken, decal, openings, faceInfo, pushFace, wall,
  });
  if (flames) {
    S.burnFlames(b, sr, flames, { burning, ruin, flat, openings, faceInfo, pushFace, roofFires, P, E, W, D, broken });
    // the smoke column and the ember shower rise from the roof's fires (the middle of the house without any)
    const cx = roofFires.length ? roofFires.reduce((a, r) => a + r.x, 0) / roofFires.length : 0;
    const cz = roofFires.length ? roofFires.reduce((a, r) => a + r.z, 0) / roofFires.length : 0;
    const top = flat ? E + 0.6 : ruin === 2 ? E + 0.5 : ridgeTop;
    anchors.fireSmoke = b.point(cx, top + 1.4, cz);
    anchors.fireLight = b.point(cx * 0.5, Math.max(E + 0.6, top - 0.6), cz * 0.5 + (gf ? 0 : hd * 0.3));
  }

  const group = f.finish(b, 'house', x, y, z, o.rotation);
  if (flames) {
    const fl = flames.build(f);
    if (fl) {
      group.add(fl);
      group.updateMatrixWorld(true);
    }
  }
  const toW = (p) => f.world(group, p);
  if (anchors.lantern) lights.push({ position: toW(anchors.lantern), color: 0xffb46b, intensity: 6, distance: 7, flicker: 0.25, nightOnly: true });
  if (o.windowLights && anchors.door) lights.push({ position: toW(anchors.door).setY(y + 1.6), color: 0xffa65a, intensity: 3, distance: 6, flicker: 0.1, nightOnly: true });
  if (anchors.smoke) emitters.push({ preset: 'smoke', position: toW(anchors.smoke), rate: 3 });
  if (anchors.fireLight) {
    // the fire's light: kept whatever the house's `light` says (`fire`, ObjectBuilder), priority 0
    lights.push({ position: toW(anchors.fireLight), color: 0xff7a2e, intensity: 8 + 12 * burning, distance: 9 + 5 * burning, flicker: 0.65, nightOnly: false, fire: true });
    emitters.push({ preset: 'smokeDark', position: toW(anchors.fireSmoke), rate: 1.2 + 2.4 * burning });
  }

  const res = f.result(group, {
    // (strips following the walls when turned by other than a quarter turn, KNOWN_ISSUES PROP-15)
    colliders: gf ? f.boxColliders(group, -hd - pm, hd + pm, -hw - pm, hw + pm) : f.boxColliders(group, -hw - pm, hw + pm, -hd - pm, hd + pm),
    lights,
    emissives,
    emitters,
  });
  // `position` is the door-step point 0.9 in front of the wall collider (the game's ground detail
  // keeps it clear, the prompt floats above it). `lookSpan` is the door leaf itself, edge to edge:
  // a player who walks on into the door stops 0.3 from the wall with `position` behind them, so
  // the game also targets the leaf when they face it (Game._findInteractable).
  if (anchors.door) {
    res.interact = { position: toW(anchors.door), radius: 1.1, id: o.id ?? 'house', lookSpan: { a: toW(anchors.leafA), b: toW(anchors.leafB) } };
  }
  if (o.icicles === true && !flat && !ruin) res.update = needSeasonKit('icicles').houseIcicles(f, group, { W, hs, O, Ts, pitch, ridgeY, gf, x, z, seed: o.seed });
  return res;
}

/** The internal side the door is on (null: none), as buildHouse resolves it. */
function houseDoorSide(o, gf) {
  const ext = o.door === 'none' || o.door === false ? null : (o.door || 'front');
  return ext ? (gf ? ownValue(GABLE_FRONT_MAP, ext) : ext) : null;
}

/** Corner posts, sill and top plate (timber / plaster), quoins (brick), log ends (log_wall). */
function wallTrim(b, T, wall, W, D, y0, H, rng, { top = true, bottom = true } = {}) {
  const hw = W / 2;
  const hd = D / 2;
  if (wall === 'timber_frame' || wall === 'plaster') {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) b.box(TRIM, [0.2, H, 0.2], { at: [sx * (hw - 0.06), y0 + H / 2, sz * (hd - 0.06)], rotUV: true, faces: { py: false, ny: false } });
    }
    if (bottom) b.box(TRIM, [W + 0.08, 0.16, D + 0.08], { at: [0, y0 + 0.08, 0], faces: { ny: false } });
  } else if (wall === 'brick') {
    const n = Math.floor(H / 0.5);
    for (let i = 0; i < n; i++) {
      const long = i % 2 === 0;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const ax = long ? 0.62 : 0.34;
          const az = long ? 0.34 : 0.62;
          b.box('stone_brick', [ax, 0.46, az], { at: [sx * (hw - ax / 2 + 0.04), y0 + i * 0.5 + 0.25, sz * (hd - az / 2 + 0.04)], faces: { ny: false }, off: [rng.range(0, 1), 0] });
        }
      }
    }
    if (bottom) b.box('stone_brick', [W + 0.1, 0.18, D + 0.1], { at: [0, y0 + 0.09, 0], faces: { ny: false } });
  } else if (wall === 'log_wall') {
    const n = Math.round(H / 0.5);
    for (let i = 0; i < n; i++) {
      const yy = y0 + i * 0.5 + 0.25;
      const alongX = i % 2 === 0;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const cx = sx * (hw - 0.05);
          const cz = sz * (hd - 0.05);
          if (alongX) b.tube('bark', [cx - sx * 0.12, yy, cz], [cx + sx * 0.32, yy, cz], 0.2, 0.19, { segments: 6, capTop: 'wood_planks', twist: 0.3 });
          else b.tube('bark', [cx, yy, cz - sz * 0.12], [cx, yy, cz + sz * 0.32], 0.2, 0.19, { segments: 6, capTop: 'wood_planks', twist: 0.3 });
        }
      }
    }
  } else if (PLASTER_WALLS.has(wall)) {
    // adobe: soft, slightly battered corner pilasters and a darker skirting where rain splashes
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.box(wall, [0.34, H, 0.34], { at: [sx * (hw - 0.1), y0 + H / 2, sz * (hd - 0.1)], faces: { ny: false, py: false }, off: [sx * 0.3, 0] });
        b.box(wall, [0.42, 0.5, 0.42], { at: [sx * (hw - 0.12), y0 + 0.25, sz * (hd - 0.12)], faces: { ny: false }, color: [0.82, 0.78, 0.74] });
      }
    }
    if (bottom) b.box(wall, [W + 0.04, 0.42, D + 0.04], { at: [0, y0 + 0.21, 0], faces: { ny: false, py: false }, color: [0.8, 0.76, 0.72] });
  } else if (ASHLAR_WALLS.has(wall)) {
    // quoins: big dressed blocks alternating long and short at each corner
    const n = Math.floor(H / 0.5);
    for (let i = 0; i < n; i++) {
      const long = i % 2 === 0;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const ax = long ? 0.66 : 0.36;
          const az = long ? 0.36 : 0.66;
          b.box(wall, [ax, 0.46, az], { at: [sx * (hw - ax / 2 + 0.04), y0 + i * 0.5 + 0.25, sz * (hd - az / 2 + 0.04)], faces: { ny: false }, off: [rng.range(0, 1), 0], color: [1.06, 1.04, 1.02] });
        }
      }
    }
  }
  if (top) b.box(TRIM, [W + 0.12, 0.2, D + 0.12], { at: [0, y0 + H - 0.1, 0], faces: { py: false } });
}

/** Window centres along a facade of length L, avoiding a door at doorX. */
function windowSlots(L, doorX, long) {
  const lo = -L / 2 + 0.85;
  const hi = L / 2 - 0.85;
  const intervals = [];
  if (doorX == null) intervals.push([lo, hi]);
  else {
    if (doorX - 1.38 >= lo) intervals.push([lo, doorX - 1.38]);
    if (doorX + 1.38 <= hi) intervals.push([doorX + 1.38, hi]);
  }
  const out = [];
  for (const [a, bb] of intervals) {
    const len = bb - a;
    if (len < 0) continue;
    let n = Math.floor(len / (long ? 1.9 : 2.4)) + 1;
    if (!long) n = Math.min(n, 1);
    if (n === 1) out.push((a + bb) / 2);
    else for (let i = 0; i < n; i++) out.push(a + (i * len) / (n - 1));
  }
  return out;
}

/** Door leaf inset in a dark frame, lintel, stone step (face-local frame, wall plane z = 0). */
function doorGeom(b, T, dx, P, pm, plinth, rng, o, damaged = false) {
  b.quad('door', [[dx - 0.5, P, 0.02], [dx + 0.5, P, 0.02], [dx + 0.5, P + 2, 0.02], [dx - 0.5, P + 2, 0.02]], [[0, 0], [1, 0], [1, 1], [0, 1]], damaged ? { color: SOOT } : {});
  for (const s of [-1, 1]) b.box(TRIM, [0.15, 2.16, 0.18], { at: [dx + s * 0.575, P + 1.08, 0.07], rotUV: true });
  b.box(TRIM, [1.46, 0.2, 0.22], { at: [dx, P + 2.1, 0.09] });
  // threshold + two stone steps
  b.box(TRIM, [1.2, 0.05, 0.16], { at: [dx, P + 0.02, 0.08], faces: { ny: false } });
  b.box(plinth, [1.5, 0.25, 0.5], { at: [dx, 0.125, pm + 0.25], faces: { ny: false }, off: [0.3, 0] });
  // little door hood on brackets
  if (o.doorHood ?? rng.chance(0.55)) {
    const hy = P + 2.45;
    b.box(o.roof, [1.8, 0.1, 0.78], { at: [dx, hy, 0.36], rot: [0.32, 0, 0], faces: { ny: TRIM, px: TRIM, nx: TRIM, pz: TRIM } });
    for (const s of [-1, 1]) b.box(TRIM, [0.08, 0.08, 0.62], { at: [dx + s * 0.7, hy - 0.26, 0.26], rot: [-0.7, 0, 0] });
  }
}

/**
 * Window quad + modelled frame, sill, lintel, optional shutters and flower box. `glass` null: a
 * broken window, dark inside, a few shards in the frame; a damaged house's shutters hang askew or
 * are gone.
 */
function windowGeom(b, winMat, wx, wy, { shutters, shutterTint, flowerbox, uShift = 0, ruin = 0, sr = null }) {
  if (winMat) b.quad(winMat, [[wx - 0.5, wy, 0.02], [wx + 0.5, wy, 0.02], [wx + 0.5, wy + 1, 0.02], [wx - 0.5, wy + 1, 0.02]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  else {
    // broken: the dark room behind, jagged shards of glass left in the corners
    b.quad(TRIM, [[wx - 0.5, wy, 0.0], [wx + 0.5, wy, 0.0], [wx + 0.5, wy + 1, 0.0], [wx - 0.5, wy + 1, 0.0]], [[0, 0], [1, 0], [1, 1], [0, 1]], { color: VOID });
    b.tri('window', [wx - 0.5, wy + 1, 0.02], [wx - 0.5, wy + 0.55, 0.02], [wx - 0.22, wy + 1, 0.02], [0, 1], [0, 0.55], [0.28, 1], { color: [0.5, 0.5, 0.55] });
    b.tri('window', [wx + 0.5, wy, 0.02], [wx + 0.5, wy + 0.32, 0.02], [wx + 0.18, wy, 0.02], [1, 0], [1, 0.32], [0.68, 0], { color: [0.5, 0.5, 0.55] });
  }
  b.box(TRIM, [1.16, 0.08, 0.1], { at: [wx, wy + 1.0, 0.05] });
  for (const s of [-1, 1]) b.box(TRIM, [0.08, 1.02, 0.1], { at: [wx + s * 0.54, wy + 0.5, 0.05], rotUV: true });
  b.box(TRIM, [1.36, 0.09, 0.24], { at: [wx, wy - 0.045, 0.11] });
  b.box(TRIM, [1.3, 0.13, 0.15], { at: [wx, wy + 1.1, 0.07] });
  if (shutters) {
    for (const s of [-1, 1]) {
      if (ruin && sr) {
        // a damaged house: a shutter hangs from one hinge, or it is gone
        if (sr.chance(0.45)) continue;
        if (sr.chance(0.6)) {
          b.push([wx + s * 0.83, wy + 0.95, 0.06], [0.08, s * 0.35, s * (0.35 + sr.range(0, 0.4))]);
          b.box('wood_planks', [0.46, 1.04, 0.05], { at: [0, -0.5, 0], rotUV: true, color: shutterTint.map((v) => v * 0.55) });
          b.pop();
          continue;
        }
      }
      b.box('wood_planks', [0.46, 1.04, 0.05], { at: [wx + s * 0.83, wy + 0.5, 0.035], rotUV: true, color: ruin ? shutterTint.map((v) => v * 0.55) : shutterTint });
      b.box(TRIM, [0.4, 0.06, 0.02], { at: [wx + s * 0.83, wy + 0.8, 0.07] });
      b.box(TRIM, [0.4, 0.06, 0.02], { at: [wx + s * 0.83, wy + 0.2, 0.07] });
    }
  }
  if (flowerbox) flowerBoxGeom(b, wx, wy - 0.09 - 7 / 16, 0.36, 1.1, 0.26, uShift);
}

/** Hanging sign board on an iron arm, perpendicular to the wall. */
function signGeom(b, T, sx, sy) {
  b.box('metal', [0.05, 0.05, 1.05], { at: [sx, sy, 0.52] });
  b.box('metal', [0.04, 0.04, 0.6], { at: [sx, sy - 0.2, 0.25], rot: [0.62, 0, 0] });
  for (const dz of [0.3, 0.9]) b.box('metal', [0.02, 0.14, 0.02], { at: [sx, sy - 0.08, dz] });
  const bw = 0.95;
  const bh = 0.52;
  b.box('sign_board', [0.06, bh, bw], {
    at: [sx, sy - 0.15 - bh / 2, 0.6],
    faces: { px: { off: [(2 - bw) / 2, (1 - bh) / 2] }, nx: { off: [(2 - bw) / 2, (1 - bh) / 2] }, py: TRIM, ny: TRIM, pz: TRIM, nz: TRIM },
  });
}

/** Stack of split logs against a wall (face-local, wall plane z = 0). */
function woodpileGeom(b, cx, z0, tint = null) {
  const rows = [[4, 0], [3, 0.5], [2, 1.0]];
  for (const [n, row] of rows) {
    for (let i = 0; i < n; i++) {
      const lx = cx + (i - (n - 1) / 2) * 0.36;
      const ly = 0.17 + row * 0.62;
      b.tube(TRIM, [lx, ly, z0 + 0.3], [lx, ly, z0 - 0.25], 0.17, 0.17, { segments: 6, capTop: 'wood_planks', capBottom: 'wood_planks', twist: i * 0.7 + row, uRepeat: 1, ...(tint ? { color: tint } : {}) });
    }
  }
  b.box(TRIM, [1.6, 0.08, 0.7], { at: [cx, 0.04, z0 + 0.02] });
}
