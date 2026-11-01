#!/usr/bin/env node
/**
 * Builds levels/village.json ("Hermesford") with Lumina's LevelFormat helpers (vendor/lumina),
 * the way Lumina's own tools/make-sample-hamlet.mjs does, tiered like its Emberfall: a high
 * woodland terrace (a stair cut into its cliff) under a rock ridge, a windmill in the lower eastern
 * woods, a river falling off the terrace into a pool and running south under two bridges, the
 * village square with the town hall, forge and library round it, 16 homes in clusters (Willow End
 * on its knoll, Eastbank on its green, singles by the lanes) facing every way the camera sees,
 * lanes winding between them, a lake and a field a step down, a hay hill. Villagers find their
 * way with Lumina's Nav (viewer.js), so the layout is free. 16 villagers r00..r15 stand at the home doors — the Hermes chats.
 *
 *   node tools/make-village.mjs [--out=<path>] [--check]
 *   node vendor/lumina/tools/check-level.mjs levels/village.json --strict
 *
 * Deterministic: no Math.random(), a second run is byte-identical.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createEmptyLevel, setTile, setHeightLevel, charToLevel, addObject, normalizeLevel, parseLevel, validateLevel, serializeLevel, levelStats,
} from '../vendor/lumina/src/engine/level/LevelFormat.js'
import { OBJECT_TYPES } from '../vendor/lumina/src/engine/level/ObjectCatalog.js'
import { keyLevel, keyIssueLines, rot, segDist, S_, E_, W_ } from '../vendor/lumina/tools/lib/levelgen.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/)
  return m ? [m[1], m[2] ?? true] : [a, true]
}))
const FILE = 'levels/village.json'
const OUT = path.resolve(root, String(args.out ?? FILE))

const W = 84
const D = 54
const level = createEmptyLevel({ name: 'Hermesford', width: W, depth: D, fill: 'g', level: 2, border: 2 })
level.subtitle = 'Where the Agents Live'
level.author = 'Hermes Village'
level.description = 'A river village under a wooded terrace: every villager is a Hermes chat.'
level.environment = { ...level.environment, timeOfDay: 16.8, border: 'forest', outerScenery: true, godRays: true, dust: true }

/** Fill [i0, i1) × [j0, j1) with a tile char and / or a height level. */
function fill(i0, j0, i1, j1, ch, lvl) {
  for (let j = Math.max(0, j0); j < Math.min(D, j1); j++)
    for (let i = Math.max(0, i0); i < Math.min(W, i1); i++) {
      if (ch != null) setTile(level, i, j, ch)
      if (lvl != null) setHeightLevel(level, i, j, lvl)
    }
}
// tiny deterministic hash → [0, 1)
const h01 = (a, b) => {
  let x = Math.imul(a * 73856093 ^ b * 19349663, 0x27d4eb2d) >>> 0
  x ^= x >>> 15
  return (Math.imul(x, 0x85ebca6b) >>> 0) / 2 ** 32
}

// Layout (camera looks north): a high woodland terrace across the north (z < 10, a stair at x 25–27
// cut into its cliff) · the village square in the middle with the town hall, the forge and the
// library round it · Willow End, a hamlet on a knoll in the west · Eastbank, homes on a raised
// green across the river · lanes winding between them, two bridges · the lake (south-west), the
// field and the hay hill (south-east). The river crosses everything at i 58–60.
const RIVER = [58, 61] // water columns [i0, i1)
const [RIVER0, RIVER1] = RIVER
const NATURAL = new Set(['g', 'G', 'f', 'F'])

/** Tiles whose centre lies within width / 2 of a polyline (world coordinates). */
function polyline(points, width, fn) {
  const half = width / 2
  const xs = points.map(p => p[0]), zs = points.map(p => p[1])
  for (let j = Math.floor(Math.min(...zs) - half - 1); j <= Math.ceil(Math.max(...zs) + half + 1); j++)
    for (let i = Math.floor(Math.min(...xs) - half - 1); i <= Math.ceil(Math.max(...xs) + half + 1); i++) {
      if (i < 0 || j < 0 || i >= W || j >= D) continue
      let d = Infinity
      for (let k = 0; k < points.length - 1; k++) d = Math.min(d, segDist(i + 0.5, j + 0.5, ...points[k], ...points[k + 1]))
      if (d <= half) fn(i, j)
    }
}
/** Noisy ellipse of tiles (a knoll, a green): the edge wobbles by a hash. */
function blob(cx, cz, rx, rz, fn) {
  for (let j = Math.floor(cz - rz - 1); j <= Math.ceil(cz + rz + 1); j++)
    for (let i = Math.floor(cx - rx - 1); i <= Math.ceil(cx + rx + 1); i++) {
      if (i < 2 || j < 2 || i >= W - 2 || j >= D - 2) continue
      const d = Math.hypot((i + 0.5 - cx) / rx, (j + 0.5 - cz) / rz)
      if (d <= 1 + (h01(i, j) - 0.5) * 0.22) fn(i, j)
    }
}
const tileAt = (i, j) => level.tiles[j][i]
const lane = (pts, w = 2) => polyline(pts, w, (i, j) => { if (NATURAL.has(tileAt(i, j))) setTile(level, i, j, '.') })

// ---- terrain -----------------------------------------------------------------------------------
// Tiers (Emberfall's way: a village reads as 3D from its steps): the woodland terrace (level 8)
// under a rock ridge (10), the knoll and the raised green (3: a 0.5 u step walkers take), the
// square and the lanes (2), lake and field (1), the hay hill (4, up a stair)
fill(2, 2, W - 2, 10, 'G', 8) // the woodland terrace
fill(2, 2, W - 2, 4, 'x', 10) // the ridge behind it (rock, not walkable)
fill(RIVER1 + 1, 2, W - 2, 10, null, 3) // east of the river the woods sit low: a step up from the lanes
for (const [i0, i1, l] of [[2, 9, 11], [14, 19, 11], [33, 40, 11], [70, 82, 5]]) fill(i0, 2, i1, 4, 'x', l)
fill(RIVER1 + 1, 2, 70, 4, null, 4)
blob(8.5, 21, 7.5, 7, (i, j) => { setHeightLevel(level, i, j, 3); setTile(level, i, j, h01(i, j) < 0.3 ? 'f' : 'g') }) // Willow End's knoll
blob(73, 25, 9, 7.5, (i, j) => { setHeightLevel(level, i, j, 3); setTile(level, i, j, 'g') }) // Eastbank's green
blob(45, 31, 6, 4, (i, j) => setTile(level, i, j, 'G')) // a dark meadow south-east of the square
blob(12, 34, 4, 2.6, (i, j) => setTile(level, i, j, 'f')) // flowers by the carpentry
fill(66, 42, 82, 51, 'f', 4) // the hay hill
for (const [j, l] of [[40, 2], [41, 3]]) for (const i of [72, 73]) { setTile(level, i, j, 'v'); setHeightLevel(level, i, j, l) }
// the river: fast stream on the terrace, waterfall into a plunge pool, south to the map edge
fill(RIVER0 - 1, 0, RIVER1 + 1, 10, 'x', 8)
fill(RIVER0, 0, RIVER1, 10, 'w', 8)
fill(RIVER0 - 3, 10, RIVER1 + 3, 14, 's', 1)
fill(RIVER0 - 2, 10, RIVER1 + 2, 13, 'p', 0)
fill(RIVER0 - 1, 13, RIVER1 + 1, D, 's', 1)
fill(RIVER0, 13, RIVER1, D, '~', 0)
// the lake (south-west) with a sand shore, cut corners
fill(3, 42, 21, 52, 's', 1)
fill(4, 43, 20, 51, 'o', 0)
for (const [i, j] of [[4, 43], [19, 43], [4, 50], [19, 50], [5, 43], [4, 44], [18, 50], [19, 49]]) { setTile(level, i, j, 's'); setHeightLevel(level, i, j, 1) }
fill(28, 42, 42, 50, null, 1) // the field, a step down
fill(29, 43, 41, 49, 'F')
// the square: cobbles on a wobbly oval, stone tiles round the well
blob(29.5, 22.8, 6.2, 4.4, (i, j) => setTile(level, i, j, 'c'))
fill(29, 21, 32, 23, 'k')
// lanes (dirt, two tiles wide; never over water, stairs or the cobbles)
lane([[26.4, 19], [26.2, 16], [26, 13.8]]) // north: up to the terrace stair
lane([[23.6, 24.2], [18, 25], [13.6, 23.4], [11, 20.8]]) // west: Willow End's green
lane([[35.4, 22.4], [42, 21.6], [50, 23.2], [56.2, 24]]) // east: to the upper bridge
lane([[62.8, 24], [67.5, 24.6], [73, 25.4], [78, 26]]) // Eastbank
lane([[28.6, 27], [27, 32], [23.2, 37], [16, 40.6]]) // south: the lake
lane([[31.6, 27], [33.6, 33], [34, 41.8]]) // south-east: the field gate
lane([[33.8, 38.4], [45, 39.2], [56.2, 40]]) // to the lower bridge
lane([[62.8, 40], [72.5, 39.6]]) // the hay hill stair
lane([[73, 31], [70.5, 36], [66, 39.8]]) // Eastbank down to the lower bridge
// the terrace stair: one level per tile, from the lane (2) to the woods (8), cut into the cliff
for (let j = 8; j < 14; j++) for (const i of [25, 26]) { setTile(level, i, j, '^'); setHeightLevel(level, i, j, 15 - j) }

// ---- buildings ---------------------------------------------------------------------------------
// Homes face the lanes and the greens (S_ toward the camera, E_ / W_ sideways; never N_: its door
// would be hidden), each its own size, height, gable and porch
const HOME_LOOKS = [
  { wall: 'plaster', roof: 'roof_thatch' }, { wall: 'timber_frame', roof: 'roof_red' }, { wall: 'stone_brick', roof: 'roof_slate' },
  { wall: 'plaster', upperWall: 'timber_frame', roof: 'roof_blue', stories: 2 }, { wall: 'log_wall', roof: 'roof_thatch' },
  { wall: 'whitewash', roof: 'roof_terracotta' }, { wall: 'brick', roof: 'roof_red' }, { wall: 'timber_frame', roof: 'roof_slate' },
]
// (the camera looks north: a house hides ~7–10 u of ground behind it, so no house stands within
// that of another's door in the same x span — the columns are staggered)
const HOMES = [
  // Willow End
  [4.6, 14.8, S_, 4, 3], [12, 14.6, S_, 4.4, 3.4], [7.2, 29.2, S_, 4, 3], [3.8, 33.6, E_, 4, 3],
  // by the lake
  [12.6, 38.8, S_, 4.8, 3], [25.6, 45.2, S_, 4, 3],
  // north and east of the square
  [49.6, 14.6, S_, 4, 3], [54.2, 19.4, W_, 4, 3], [39.5, 35.4, S_, 4.4, 3], [49.4, 36.4, W_, 4, 3.4], [54.4, 35.4, S_, 3.6, 3],
  // Eastbank
  [67.5, 18.6, S_, 4, 3], [74.2, 18, S_, 4.8, 3.4], [80, 23.2, W_, 4, 3], [80.2, 33.6, W_, 4.4, 3], [65, 36.8, E_, 4, 3],
]
/** Level the ground under a house (and a margin round it) to the level at its centre. */
function pad(x, z, a, width, depth) {
  const lvl = charToLevel(level.heights[Math.floor(z)][Math.floor(x)])
  const [hx, hz] = Math.abs(Math.sin(a)) > 0.5 ? [depth / 2, width / 2] : [width / 2, depth / 2]
  fill(Math.floor(x - hx - 0.6), Math.floor(z - hz - 0.6), Math.ceil(x + hx + 0.6), Math.ceil(z + hz + 0.6), null, lvl)
}
const doorOf = (x, z, a, depth) => { const [dx, dz] = rot(0, depth / 2 + 1.0, a); return { x: +(x + dx).toFixed(2), z: +(z + dz).toFixed(2) } }
const doors = []
HOMES.forEach(([x, z, a, width, depth], k) => {
  const look = HOME_LOOKS[k % HOME_LOOKS.length]
  const q = h01(k, 13)
  const two = look.stories === 2
  pad(x, z, a, width, depth)
  addObject(level, 'house', x, z, {
    rotation: a, name: `Home ${k + 1}`, light: true, // (the window light: on while its chat sleeps, viewer.js)
    opts: {
      width, depth, ...look, stories: two ? 2 : 1, upperWall: look.upperWall ?? (two ? 'timber_frame' : ''),
      windowLights: true, lantern: k % 3 === 0, shutters: q > 0.15, woodpile: k % 4 === 1, doorHood: k % 3 === 2, gableFront: h01(k, 5) < 0.35, chimneySide: k % 2 ? 1 : -1, seed: 11 + k * 7,
    },
  })
  // the yard by the facade: a flowerbox, a bench, or a barrel and a crate
  const at = (lx, lz) => { const [dx, dz] = rot(lx, lz, a); return [+(x + dx).toFixed(2), +(z + dz).toFixed(2)] }
  const yard = k % 3
  if (yard === 0) addObject(level, 'flowerbox', ...at(width / 2 - 0.9, depth / 2 + 0.35), { rotation: a, opts: { length: 1 } })
  else if (yard === 1) addObject(level, 'bench', ...at(-width / 2 - 0.8, depth / 2 - 0.7), { rotation: a + E_, opts: { length: 1.2 } })
  else {
    addObject(level, 'barrel', ...at(width / 2 + 0.85, depth / 2 - 0.3), { rotation: k })
    addObject(level, 'crate', ...at(width / 2 + 0.85, depth / 2 - 1.3), { rotation: k * 0.7, opts: { size: 0.6 } })
  }
  doors.push({ ...doorOf(x, z, a, depth), k })
})
const WORK = {
  townhall: { name: 'Town Hall', x: 34, z: 14.6, a: S_, opts: { width: 7, depth: 4.5, stories: 2, wall: 'stone_brick', upperWall: 'plaster', roof: 'roof_slate', sign: true, doorHood: true, gableFront: true, seed: 102 } },
  forge: { name: 'The Forge', x: 43, z: 14.4, a: S_, opts: { width: 4.5, depth: 3.5, stories: 1, wall: 'stone_brick', roof: 'roof_slate', chimney: true, sign: true, seed: 103 } },
  library: { name: 'The Library', x: 19.4, z: 20.6, a: E_, opts: { width: 5, depth: 3.5, stories: 2, wall: 'brick', upperWall: 'timber_frame', roof: 'roof_blue', sign: true, doorHood: true, seed: 101 } },
  carpentry: { name: 'Carpentry', x: 17, z: 36.4, a: E_, opts: { width: 5, depth: 3.5, stories: 1, wall: 'log_wall', roof: 'roof_thatch', woodpile: true, sign: true, seed: 104 } },
}
for (const b of Object.values(WORK)) pad(b.x, b.z, b.a, b.opts.width, b.opts.depth)
for (const b of Object.values(WORK)) addObject(level, 'house', b.x, b.z, { rotation: b.a, name: b.name, light: true, opts: b.opts })

// ---- props -------------------------------------------------------------------------------------
// the square
addObject(level, 'well', 30.4, 21.6)
addObject(level, 'marketStall', 25, 20.6, { rotation: S_ })
addObject(level, 'marketStall', 34.6, 24.6, { rotation: W_, opts: { cloth: 'cloth_red' } })
addObject(level, 'campfire', 30.8, 25.4, { opts: { seat: true } })
addObject(level, 'bench', 27.6, 25.8, { rotation: E_ })
addObject(level, 'bench', 33.2, 21.2, { rotation: W_ })
addObject(level, 'signpost', 28.4, 19.4, { rotation: 0.2, speaker: 'Signpost', text: ['↑ {The Woodland} · → {Eastbank}\n← {Willow End} · ↓ {Mirror Lake}'], opts: { boards: 3 } })
for (const [x, z] of [[23.4, 26.4], [36.6, 20.2], [12.2, 22.2], [46, 23.6], [64.6, 26], [26, 33], [33, 36], [46, 40.6], [70.6, 24]])
  addObject(level, 'lamppost', x, z)
// the forge's open yard in front of it: hearth, anvil, tool rack, smoke and sparks
addObject(level, 'smithy', 41.4, 17.8, { opts: { kind: 'forge', seed: 3 } })
addObject(level, 'smithy', 44.4, 18.2, { opts: { kind: 'anvil', seed: 5 } })
addObject(level, 'smithy', 46.2, 16.8, { rotation: Math.PI / 2, opts: { kind: 'rack', seed: 6 } })
addObject(level, 'barrel', 46.2, 18.6, { rotation: 0.3 })
addObject(level, 'emitter', 41.4, 17.7, { preset: 'embers', size: [1.2, 1.5, 0.8], count: 14, dy: 1.2 })
addObject(level, 'emitter', 41.8, 13, { preset: 'smoke', size: [1, 2, 1], count: 10, dy: 4.6 })
// the library's reading corner (north of its door, by the square): a bookshelf, a table, a chair
addObject(level, 'shelf', 23.2, 17.2, { opts: { kind: 'books', width: 1.6, height: 2.2 } })
addObject(level, 'table', 23.2, 18.8, { opts: { shape: 'rect', width: 1.4, depth: 0.8, items: true, candle: true } })
addObject(level, 'chair', 23.2, 19.7, { rotation: Math.PI })
// the carpentry's lumber yard (in front of it, east): timbers, planks on a table, a crate
addObject(level, 'debris', 21.6, 34.2, { opts: { kind: 'timbers', size: 0.9, seed: 7 } })
addObject(level, 'table', 21.8, 36.2, { rotation: 0.1, opts: { shape: 'rect', width: 1.5, depth: 0.8, items: true } })
addObject(level, 'crate', 23.2, 35, { rotation: 0.4, opts: { size: 0.6 } })
// the town hall: pennants across its front
addObject(level, 'garland', 30.8, 17.6, { x1: 37.2, z1: 17.6, opts: { kind: 'pennants', sag: 0.35, posts: true, seed: 8 } })
// Willow End's green and Eastbank's: a bench, flowers, a fenced garden
addObject(level, 'bench', 8.6, 18.4, { rotation: S_, opts: { length: 1.6 } })
addObject(level, 'flowerbox', 10.6, 25.6, { opts: { length: 1.2 } })
addObject(level, 'bench', 73.4, 22.2, { rotation: S_, opts: { length: 1.6 } })
addObject(level, 'marketStall', 75.4, 28.4, { rotation: W_, opts: { cloth: 'cloth_stripe', width: 2.6 } })
// the hay hill: hay, sacks, a signpost at its stair (nothing tall: south of a lane it would hide it)
addObject(level, 'haystack', 69.5, 44.2, { opts: { size: 0.9 } })
addObject(level, 'haystack', 79.6, 50, { opts: { size: 0.7 } })
addObject(level, 'sacks', 72.4, 46.4, { rotation: 0.4, opts: { count: 3 } })
addObject(level, 'signpost', 74.6, 40.8, { rotation: -0.2, speaker: 'Signpost', text: ['↓ {Hay Hill}'], opts: { boards: 1 } })
// boulders at the foot of the terrace cliff
for (const [x, z, sz] of [[3.4, 10.6, 0.8], [15.6, 10.5, 0.7], [23.4, 10.6, 0.9], [29.2, 10.5, 0.7], [44.2, 10.6, 0.8], [56, 10.8, 0.7], [81, 10.6, 0.8]])
  addObject(level, 'rock', x, z, { opts: { size: sz, seed: Math.round(x * 3) } })
// field: a fence along its north side with a gate where the lane comes in, haystacks
addObject(level, 'fence', 28.6, 42.6, { x1: 33, z1: 42.6 })
addObject(level, 'fence', 35.2, 42.6, { x1: 41.4, z1: 42.6 })
addObject(level, 'haystack', 31.4, 47.6, { opts: { size: 0.8 } })
addObject(level, 'haystack', 38.6, 47.8, { opts: { size: 0.9 } })
// river: waterfall, bridges, rocks
const RX = (RIVER0 + RIVER1) / 2
addObject(level, 'waterfall', RX, 10, { width: 3, facing: 'S' })
for (const z of [24, 40]) addObject(level, 'bridge', RIVER0 - 1.8, z, { x1: RIVER1 + 1.8, z1: z, opts: { width: 2.4, arch: 0.3 } })
for (const [x, z, s] of [[RIVER1 + 2.4, 11.2, 0.7], [RIVER0 - 0.6, 30, 0.6], [RIVER1 + 0.4, 46, 0.8], [21.4, 46, 0.8], [3.6, 48.6, 0.6], [12, 52, 0.7]])
  addObject(level, 'rock', x, z, { opts: { size: s } })

// the windmill on the low eastern woods (north: it hides nobody)
const MILL = [69, 6.8]
addObject(level, 'windmill', ...MILL, { rotation: -0.4, opts: { height: 6.5, roof: 'roof_thatch' } })

// ---- trees -------------------------------------------------------------------------------------
const KINDS = ['pine', 'oak', 'birch', 'pine', 'autumn', 'oak', 'pine', 'maple']
let n = 0
const placed = []
for (let j = 3; j <= 9; j += 1.6)
  for (let i = 3; i <= W - 4; i += 2.3) {
    const r = h01(Math.round(i * 10), Math.round(j * 10))
    const x = i + (r - 0.5) * 1.6, z = j + (h01(Math.round(j * 10), Math.round(i * 10)) - 0.5) * 1.1
    if (x > RIVER0 - 3.5 && x < RIVER1 + 3.5) continue // the river and the falls
    if (x > 22.5 && x < 29) continue // the stair and the path into the woods
    if (Math.hypot(x - MILL[0], z - MILL[1]) < 3.4) continue // the windmill's clearing
    if (r < 0.3) continue // clearings (the hunting grounds)
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1.9)) continue
    placed.push([x, z])
    addObject(level, 'tree', +x.toFixed(2), +z.toFixed(2), { opts: { kind: KINDS[n % KINDS.length], height: +(4.2 + r * 1.6).toFixed(1), seed: Math.round(x * 10 + z) } })
    n++
  }
// trees between the houses: copses and single trees (behind the homes, off every door's sightline)
for (const [kind, x, z, hgt] of [
  ['birch', 23, 44.5, 4.4], ['oak', 22.6, 49.5, 4.2], ['autumn', 9, 52.2, 4],
  ['oak', 69.6, 50.6, 4.4], ['pine', 63.6, 49.6, 4.8],
  ['oak', 2.8, 12.4, 4.6], ['autumn', 8.6, 12, 4.2], ['birch', 16.2, 12.8, 4.4],
  ['birch', 56, 15.6, 4.6], ['pine', 47, 12.4, 4.8],
  ['oak', 64.4, 16.4, 4.6], ['autumn', 81.2, 15.6, 4.2], ['birch', 81.4, 36.4, 4.4],
  ['oak', 54.6, 47.6, 4.4],
]) addObject(level, 'tree', x, z, { opts: { kind, height: hgt, seed: Math.round(x * 10 + z) } })

// ---- villagers: one per home (the Hermes chats bind to r00..r15) -------------------------------
const PRESETS = ['traveler', 'merchant', 'scholar', 'farmer', 'hunter', 'cleric', 'villager', 'bard',
  'innkeeper', 'elder', 'guard', 'dancer', 'swordsman', 'villager', 'farmer', 'scholar']
for (const d of doors) {
  addObject(level, 'npc', d.x, d.z, { name: `Villager ${d.k + 1}`, preset: PRESETS[d.k], wander: 1.2, dialogue: ['…'] })
  level.objects[level.objects.length - 1].id = `r${String(d.k).padStart(2, '0')}`
}

// ---- critters, particles, regions --------------------------------------------------------------
addObject(level, 'critters', 6, 30, { kind: 'chicken', count: 4, radius: 1.6 })
addObject(level, 'critters', 35, 45.6, { kind: 'chicken', count: 3, radius: 1.8 })
addObject(level, 'critters', 26.8, 23.2, { kind: 'cat', count: 1, radius: 2.5 })
addObject(level, 'critters', 72, 26, { kind: 'dog', count: 1, radius: 2 })
for (const [x, z] of [[11, 6], [37, 6.4], [72, 6]]) addObject(level, 'critters', x, z, { kind: 'bird', count: 4, radius: 3 })
addObject(level, 'emitter', 12, 47, { preset: 'fireflies', size: [16, 2, 9], count: 36, dy: 0.9 })
addObject(level, 'emitter', RX, 12, { preset: 'mist', size: [7, 2, 4], count: 18, dy: 0.6 })
addObject(level, 'emitter', 40, 6, { preset: 'leaves', size: [74, 4, 7], count: 44, dy: 3 })
addObject(level, 'emitter', 74, 45, { preset: 'petals', size: [14, 3, 7], count: 22, dy: 1.6 })
addObject(level, 'region', 0, 0, { name: 'The Woodland', sub: 'Hermesford', minX: 0, maxX: W, minZ: 0, maxZ: 10.5, minY: 1.3 })
addObject(level, 'region', 0, 0, { name: 'Mirror Lake', sub: 'Hermesford', minX: 0, maxX: 22, minZ: 41, maxZ: D })
addObject(level, 'region', 0, 0, { name: 'Willow End', sub: 'Hermesford', minX: 0, maxX: 17, minZ: 11, maxZ: 31 })
addObject(level, 'region', 0, 0, { name: 'Eastbank', sub: 'Hermesford', minX: RIVER1 + 2, maxX: W, minZ: 11, maxZ: 36 })
addObject(level, 'region', 0, 0, { name: 'Village Square', sub: 'Hermesford', minX: 22, maxX: 38, minZ: 17, maxZ: 29 })
addObject(level, 'region', 0, 0, { name: 'River Hermes', sub: 'Hermesford', minX: RIVER0 - 3, maxX: RIVER1 + 3, minZ: 10, maxZ: D })
addObject(level, 'region', 0, 0, { name: 'Hermesford', sub: '', minX: 0, maxX: W, minZ: 0, maxZ: D })

level.spawn = { x: 26, z: 21, facing: 'up' }

// ---- output (Lumina's canonical tail, tools/make-sample-hamlet.mjs) ------------------------------
const PLACEMENT_KEYS = { point: ['x', 'z'], line: ['x0', 'z0', 'x1', 'z1'], rect: ['minX', 'maxX', 'minZ', 'maxZ'] }
const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v)
function orderKeys(obj, lead) {
  const out = {}
  for (const k of lead) if (Object.hasOwn(obj, k)) out[k] = obj[k]
  for (const k of Object.keys(obj)) if (!Object.hasOwn(out, k)) out[k] = obj[k]
  return out
}
function canonicalObject(o) {
  const def = OBJECT_TYPES[o.type]
  const out = orderKeys(o, ['id', 'type', ...PLACEMENT_KEYS[def.placement], ...Object.keys(def.defaults)])
  for (const [k, d] of Object.entries(def.defaults)) if (isPlain(d) && isPlain(out[k])) out[k] = orderKeys(out[k], Object.keys(d))
  return out
}

const { level: out, warnings } = normalizeLevel(level)
out.objects = out.objects.map(canonicalObject)
keyLevel(out, { root, file: FILE })
const errors = [...validateLevel(out), ...keyIssueLines(out)]
const text = serializeLevel(out)
if (serializeLevel(parseLevel(text).level) !== text) errors.push('the output does not re-serialise byte-identically')
if (warnings.length || errors.length) {
  console.error([...warnings, ...errors].join('\n'))
  process.exit(1)
}
const rel = path.relative(root, OUT)
if (args.check) {
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null
  if (old === text) { console.log(`${rel} is up to date.`); process.exit(0) }
  console.error(`${rel} differs from the generator output. Re-run without --check.`)
  process.exit(1)
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, text)
const s = levelStats(out)
console.log(`Hermesford → ${rel}: ${s.width}×${s.depth}, ${s.objects} objects, ${s.water} water tiles`, s.counts)
