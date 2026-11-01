#!/usr/bin/env node
/**
 * Builds levels/village.json ("Hermesford") with Lumina's LevelFormat helpers (vendor/lumina),
 * the way Lumina's own tools/make-sample-hamlet.mjs does, tiered like its Emberfall: a high
 * woodland terrace (a stair cut into its cliff) under a rock ridge, a windmill in the lower eastern
 * woods, a river falling off the terrace into a pool and running south under two bridges, two rows
 * of 16 varied homes + library, town hall, forge and carpentry on banks over their streets, a
 * plaza, a lake and a field a step down, a hay hill. 16 villagers r00..r15 stand at the home doors — the Hermes chats.
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
  createEmptyLevel, setTile, setHeightLevel, addObject, normalizeLevel, parseLevel, validateLevel, serializeLevel, levelStats,
} from '../vendor/lumina/src/engine/level/LevelFormat.js'
import { OBJECT_TYPES } from '../vendor/lumina/src/engine/level/ObjectCatalog.js'
import { keyLevel, keyIssueLines } from '../vendor/lumina/tools/lib/levelgen.mjs'

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

// Layout (camera looks north): woodland terrace j 2–9 · street A j 17–18 with row A north of it ·
// plaza j 19–26 · street B j 38–39 with row B north of it · lake, field and meadow south of B.
// The river crosses everything at i 58–60.
const RIVER = [58, 61] // water columns [i0, i1)
const [RIVER0, RIVER1] = RIVER
const ROW = { A: 14, B: 35 }
const STREET = { A: 17, B: 38 } // first row of each 2-tile street

// ---- terrain -----------------------------------------------------------------------------------
// Tiers (Emberfall's way: a village reads as 3D from its steps, not its props): a high woodland
// terrace (level 8) under a rock ridge (10), the house rows on banks one level over their streets
// (stone curbs; a 0.5 u step walkers take), the streets and the plaza (2), lake and field (1),
// a windmill hill (4) south of street B
fill(2, 2, W - 2, 10, 'G', 8) // the woodland terrace
fill(2, 2, W - 2, 4, 'x', 10) // the ridge behind it (rock, not walkable)
fill(RIVER1 + 1, 2, W - 2, 10, null, 4) // east of the river the woods sit lower: a step up from the bank
for (const [i0, i1, l] of [[2, 9, 11], [14, 19, 11], [33, 40, 11], [70, 82, 6]]) fill(i0, 2, i1, 4, 'x', l)
fill(RIVER1 + 1, 2, 70, 4, null, 5)
for (const [i0, j0, i1, j1] of [[2, 10, 25, 17], [27, 10, RIVER0 - 2, 17], [RIVER1 + 2, 10, W - 2, 17], [2, 31, RIVER0 - 2, 38], [RIVER1 + 2, 31, W - 2, 38]]) {
  fill(i0, j0, i1, j1, null, 3) // the house banks
  fill(i0, j1 - 1, i1, j1, 'k') // their stone curbs
}
// the stair up the terrace: one level per tile, from the road (2) to the woods (8), cut into the cliff
for (let j = 8; j < 14; j++) for (const i of [25, 26]) { setTile(level, i, j, '^'); setHeightLevel(level, i, j, 15 - j) }
fill(3, 20, 12, 28, 'f') // meadows
fill(66, 42, 82, 51, 'f', 4) // the windmill hill, up a stair from street B
for (const [j, l] of [[40, 2], [41, 3]]) for (const i of [72, 73]) { setTile(level, i, j, 'v'); setHeightLevel(level, i, j, l) }
// the river: fast stream on the terrace, waterfall into a plunge pool, south to the map edge
fill(RIVER[0] - 1, 0, RIVER[1] + 1, 10, 'x', 8)
fill(RIVER[0], 0, RIVER[1], 10, 'w', 8)
fill(RIVER[0] - 3, 10, RIVER[1] + 3, 14, 's', 1)
fill(RIVER[0] - 2, 10, RIVER[1] + 2, 13, 'p', 0)
fill(RIVER[0] - 1, 13, RIVER[1] + 1, D, 's', 1)
fill(RIVER[0], 13, RIVER[1], D, '~', 0)
// the lake (south-west) with a sand shore, cut corners
fill(3, 42, 21, 52, 's', 1)
fill(4, 43, 20, 51, 'o', 0)
for (const [i, j] of [[4, 43], [19, 43], [4, 50], [19, 50], [5, 43], [4, 44], [18, 50], [19, 49]]) { setTile(level, i, j, 's'); setHeightLevel(level, i, j, 1) }
// streets, main road, plaza, field
for (const r of Object.values(STREET)) { fill(2, r, RIVER[0] - 1, r + 2, '.'); fill(RIVER[1] + 1, r, W - 2, r + 2, '.') }
fill(25, 14, 27, D, '.')
fill(20, 19, 33, 27, 'c')
fill(25, 21, 28, 24, 'k')
fill(28, 42, 42, 50, null, 1) // the field, a step down
fill(29, 43, 41, 49, 'F')

// ---- buildings ---------------------------------------------------------------------------------
const HOME_LOOKS = [
  { wall: 'plaster', roof: 'roof_thatch' }, { wall: 'timber_frame', roof: 'roof_red' }, { wall: 'stone_brick', roof: 'roof_slate' },
  { wall: 'plaster', upperWall: 'timber_frame', roof: 'roof_blue', stories: 2 }, { wall: 'log_wall', roof: 'roof_thatch' },
  { wall: 'whitewash', roof: 'roof_terracotta' }, { wall: 'brick', roof: 'roof_red' }, { wall: 'timber_frame', roof: 'roof_slate' },
]
const HOME_X = { A: [5.5, 12, 46.5, 53, 66.5, 73, 79], B: [5.5, 12, 32.5, 39, 45.5, 52, 66.5, 73, 79] }
const doors = []
let k = 0
for (const row of ['A', 'B'])
  for (const x of HOME_X[row]) {
    const look = HOME_LOOKS[k % HOME_LOOKS.length]
    // no two neighbours alike: size, height, gable, setback and porch vary by a hash of the home
    const r = h01(k, 7), q = h01(k, 13)
    const width = [3.6, 4, 4.4, 4.8][Math.floor(r * 4)], depth = q < 0.5 ? 3 : 3.4
    const z = ROW[row] - (h01(k, 3) < 0.5 ? 0.5 : 0) // some stand back from the curb
    addObject(level, 'house', x, z, {
      name: `Home ${k + 1}`, light: k % 3 === 0,
      opts: {
        width, depth, stories: look.stories ?? (q > 0.78 ? 2 : 1), ...look, upperWall: look.upperWall ?? (q > 0.78 ? 'timber_frame' : ''),
        shutters: r > 0.15, woodpile: k % 4 === 1, doorHood: k % 3 === 2, gableFront: h01(k, 5) < 0.35, chimneySide: k % 2 ? 1 : -1, seed: 11 + k * 7,
      },
    })
    const front = z + depth / 2
    // the yard: a flowerbox, a bench by the door, or barrels and a crate at the side
    const yard = k % 3
    if (yard === 0) addObject(level, 'flowerbox', x + width / 2 - 0.9, front + 0.35, { opts: { length: 1 } })
    else if (yard === 1) addObject(level, 'bench', x - width / 2 + 0.9, front + 0.55, { opts: { length: 1.2 } })
    else {
      addObject(level, 'barrel', x + width / 2 + 0.85, front - 0.3, { rotation: k })
      addObject(level, 'crate', x + width / 2 + 0.85, front - 1.3, { rotation: k * 0.7, opts: { size: 0.6 } })
    }
    doors.push({ x, z: front + 1.1, k })
    k++
  }
const WORK = {
  library: { x: 18.5, z: ROW.A, opts: { width: 5, depth: 3.5, stories: 2, wall: 'brick', upperWall: 'timber_frame', roof: 'roof_blue', sign: true, doorHood: true, seed: 101 } },
  townhall: { x: 32.5, z: ROW.A - 0.5, opts: { width: 7, depth: 4.5, stories: 2, wall: 'stone_brick', upperWall: 'plaster', roof: 'roof_slate', sign: true, doorHood: true, gableFront: true, seed: 102 } },
  forge: { x: 40, z: ROW.A - 1.6, opts: { width: 4.5, depth: 3.5, stories: 1, wall: 'stone_brick', roof: 'roof_slate', chimney: true, sign: true, seed: 103 } },
  carpentry: { x: 18.5, z: ROW.B, opts: { width: 5, depth: 3.5, stories: 1, wall: 'log_wall', roof: 'roof_thatch', woodpile: true, sign: true, seed: 104 } },
}
const NAMES = { library: 'The Library', townhall: 'Town Hall', forge: 'The Forge', carpentry: 'Carpentry' }
for (const [key, b] of Object.entries(WORK)) addObject(level, 'house', b.x, b.z, { name: NAMES[key], light: true, opts: b.opts })

// ---- props -------------------------------------------------------------------------------------
addObject(level, 'well', 30.4, 21.6)
addObject(level, 'marketStall', 21.8, 21.2, { rotation: Math.PI / 2 })
addObject(level, 'marketStall', 21.8, 25.2, { rotation: Math.PI / 2, opts: { cloth: 'cloth_red' } })
addObject(level, 'campfire', 30.8, 25.4, { opts: { seat: true } })
addObject(level, 'bench', 32.2, 24.2, { rotation: -Math.PI / 2 })
addObject(level, 'bench', 28.2, 26.2)
addObject(level, 'signpost', 27.9, 19.8, { rotation: 0.2, speaker: 'Signpost', text: ['↑ {The Woodland} · → {River Hermes}\n↓ {Mirror Lake}'], opts: { boards: 3 } })
for (const x of [9, 19, 36.4, 50, 64, 76]) addObject(level, 'lamppost', x, STREET.A + 2.6)
for (const x of [9, 23.2, 36, 49, 64, 76]) addObject(level, 'lamppost', x, STREET.B + 2.6)
// forge yard (east of the forge), carpentry yard (west of the carpentry)
// ---- workplace yards: what each building is for reads from the street ----------------------------
// the forge's open yard (in front, the building moved back): hearth, bellows, anvil, tool rack, smoke
addObject(level, 'smithy', 38.2, 15.1, { opts: { kind: 'forge', seed: 3 } })
addObject(level, 'smithy', 41.4, 15.6, { opts: { kind: 'anvil', seed: 5 } })
addObject(level, 'smithy', 43.3, 14.0, { rotation: Math.PI / 2, opts: { kind: 'rack', seed: 6 } })
addObject(level, 'barrel', 43.3, 15.9, { rotation: 0.3 })
addObject(level, 'emitter', 38.2, 15.0, { preset: 'embers', size: [1.2, 1.5, 0.8], count: 14, dy: 1.2 })
addObject(level, 'emitter', 38.6, 12.0, { preset: 'smoke', size: [1, 2, 1], count: 10, dy: 4.6 })
// the library's reading yard (east of it): a bookshelf, a reading table with a candle, a chair
addObject(level, 'shelf', 22.8, 13.2, { opts: { kind: 'books', width: 1.6, height: 2.2 } })
addObject(level, 'table', 22.9, 15.0, { opts: { shape: 'rect', width: 1.4, depth: 0.8, items: true, candle: true } })
addObject(level, 'chair', 22.9, 15.9, { rotation: Math.PI })
// the carpentry's lumber yard (east of it): timbers, planks on a table, crates
addObject(level, 'debris', 23.0, 34.2, { opts: { kind: 'timbers', size: 0.9, seed: 7 } })
addObject(level, 'table', 22.9, 36.4, { rotation: 0.1, opts: { shape: 'rect', width: 1.5, depth: 0.8, items: true } })
addObject(level, 'crate', 21.8, 37.4, { rotation: 0.4, opts: { size: 0.6 } })
// the town hall: pennants across its front
addObject(level, 'garland', 29.6, 16.2, { x1: 35.4, z1: 16.2, opts: { kind: 'pennants', sag: 0.35, posts: true, seed: 8 } })
addObject(level, 'barrel', 15.1, 37.4, { rotation: 0.5 })
// the hay hill: hay, sacks, a signpost at its stair (nothing tall: south of a street it would hide it)
addObject(level, 'haystack', 69.5, 44.2, { opts: { size: 0.9 } })
addObject(level, 'haystack', 79.6, 50, { opts: { size: 0.7 } })
addObject(level, 'sacks', 72.4, 46.4, { rotation: 0.4, opts: { count: 3 } })
addObject(level, 'signpost', 74.6, 41.2, { rotation: -0.2, speaker: 'Signpost', text: ['↓ {Hay Hill}'], opts: { boards: 1 } })
// boulders at the foot of the terrace cliff, between the homes' backs
for (const [x, z, sz] of [[3.4, 10.6, 0.8], [15.6, 10.5, 0.7], [23.4, 10.6, 0.9], [29.2, 10.5, 0.7], [44.2, 10.6, 0.8], [56, 10.8, 0.7], [81, 10.6, 0.8]])
  addObject(level, 'rock', x, z, { opts: { size: sz, seed: Math.round(x * 3) } })
// field: fence along the street side, haystacks
addObject(level, 'fence', 28.6, 42.6, { x1: 41.4, z1: 42.6 })
addObject(level, 'haystack', 31.4, 47.6, { opts: { size: 0.8 } })
addObject(level, 'haystack', 38.6, 47.8, { opts: { size: 0.9 } })
// river: waterfall, bridges, rocks
const RX = (RIVER[0] + RIVER[1]) / 2
addObject(level, 'waterfall', RX, 10, { width: 3, facing: 'S' })
for (const r of Object.values(STREET)) addObject(level, 'bridge', RIVER[0] - 1.8, r + 1, { x1: RIVER[1] + 1.8, z1: r + 1, opts: { width: 2.4, arch: 0.3 } })
for (const [x, z, s] of [[RIVER[1] + 2.4, 11.2, 0.7], [RIVER[0] - 0.6, 28, 0.6], [RIVER[1] + 0.4, 46, 0.8], [21.4, 46, 0.8], [3.6, 48.6, 0.6], [12, 52, 0.7]])
  addObject(level, 'rock', x, z, { opts: { size: s } })

// the windmill on the low eastern woods, behind row A (north: it hides nobody)
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
    if (x > RIVER[0] - 3.5 && x < RIVER[1] + 3.5) continue // the river and the falls
    if (x > 22.5 && x < 29) continue // the stair and the path into the woods
    if (Math.hypot(x - MILL[0], z - MILL[1]) < 3.4) continue // the windmill's clearing
    if (r < 0.3) continue // clearings (the hunting grounds)
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1.9)) continue
    placed.push([x, z])
    addObject(level, 'tree', +x.toFixed(2), +z.toFixed(2), { opts: { kind: KINDS[n % KINDS.length], height: +(4.2 + r * 1.6).toFixed(1), seed: Math.round(x * 10 + z) } })
    n++
  }
// a few trees by the lake and the meadow, off every door's sightline
for (const [kind, x, z, hgt] of [
  ['birch', 23, 44.5, 4.4], ['oak', 22.6, 49.5, 4.2], ['autumn', 9, 52.2, 4],
  ['oak', 69.6, 50.6, 4.4], ['pine', 63.6, 49.6, 4.8],
]) addObject(level, 'tree', x, z, { opts: { kind, height: hgt, seed: Math.round(x * 10 + z) } })

// ---- villagers: one per home (the Hermes chats bind to r00..r15) -------------------------------
const PRESETS = ['traveler', 'merchant', 'scholar', 'farmer', 'hunter', 'cleric', 'villager', 'bard',
  'innkeeper', 'elder', 'guard', 'dancer', 'swordsman', 'villager', 'farmer', 'scholar']
for (const d of doors) {
  addObject(level, 'npc', d.x, d.z, { name: `Villager ${d.k + 1}`, preset: PRESETS[d.k], wander: 1.2, dialogue: ['…'] })
  level.objects[level.objects.length - 1].id = `r${String(d.k).padStart(2, '0')}`
}

// ---- critters, particles, regions --------------------------------------------------------------
addObject(level, 'critters', 14.6, 40.8, { kind: 'chicken', count: 4, radius: 1.6 })
addObject(level, 'critters', 35, 45.6, { kind: 'chicken', count: 3, radius: 1.8 })
addObject(level, 'critters', 26.8, 23.2, { kind: 'cat', count: 1, radius: 2.5 })
addObject(level, 'critters', 37, 22, { kind: 'dog', count: 1, radius: 2 })
for (const [x, z] of [[11, 6], [37, 6.4], [72, 6]]) addObject(level, 'critters', x, z, { kind: 'bird', count: 4, radius: 3 })
addObject(level, 'emitter', 12, 47, { preset: 'fireflies', size: [16, 2, 9], count: 36, dy: 0.9 })
addObject(level, 'emitter', RX, 12, { preset: 'mist', size: [7, 2, 4], count: 18, dy: 0.6 })
addObject(level, 'emitter', 40, 6, { preset: 'leaves', size: [74, 4, 7], count: 44, dy: 3 })
addObject(level, 'emitter', 74, 45, { preset: 'petals', size: [14, 3, 7], count: 22, dy: 1.6 })
addObject(level, 'region', 0, 0, { name: 'The Woodland', sub: 'Hermesford', minX: 0, maxX: W, minZ: 0, maxZ: 10.5, minY: 1.3 })
addObject(level, 'region', 0, 0, { name: 'Mirror Lake', sub: 'Hermesford', minX: 0, maxX: 22, minZ: 41, maxZ: D })
addObject(level, 'region', 0, 0, { name: 'River Hermes', sub: 'Hermesford', minX: RIVER[0] - 3, maxX: RIVER[1] + 3, minZ: 10, maxZ: D })
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
