// Hermes Village — the pure simulation: a chat's live status → where its villager goes and why.
// No three, no SDK, times in ms passed in (testable). Spec: docs/specs/2026-11-01-village-design.md
export const SLOTS = 16
const HOLD = 4000 // a villager changes its goal at most this often
const WORK = 2000 // …and works at least this long once it got there (a short tool still shows)
const STALE = 10 * 60e3 // no event this long: a lost `complete`, back to idle
const FAIL = 6000

const TOOLS = [
  [/^(terminal|execute_code|process)/, 'forge'],
  [/^(web_|browser|mcp__tavily|mcp__scrapling)/, 'woods'],
  [/^(read_file|search_files|session_search)/, 'library'],
  [/^(write_file|patch)$/, 'carpentry'],
  [/^(delegate_task|kanban)/, 'townhall'],
  [/^(memory|fact_|skill)/, 'well'],
  [/^(vision_analyze|image_generate|computer_use)/, 'lake'],
]
export const toolSpot = name => TOOLS.find(([re]) => re.test(name || ''))?.[1] ?? 'field'

// Where things are in levels/village.json (tools/make-village.mjs): [x, z] points, wander radius.
// 'home' is the villager's own door (its level npc).
export const SPOTS = {
  forge: { at: [[43, 19.3], [41.6, 19.5]], wander: 0.3 },
  woods: { at: [[26, 6.5], [19.5, 5.5], [32, 4.6], [12.5, 6.5], [39.5, 7], [6, 5.2]], wander: 2.6 },
  library: { at: [[24.3, 19], [22.4, 18.3]], wander: 0.2 },
  carpentry: { at: [[20.8, 35.3], [21.4, 37.5]], wander: 0.3 },
  townhall: { at: [[34, 18.9], [32.4, 19], [35.6, 19]], wander: 0.3 },
  well: { at: [[29.3, 22], [31.4, 22.4]], wander: 0.4 },
  lake: { at: [[12, 42.3], [8, 42.4], [16, 42.3]], wander: 0.6 },
  field: { at: [[31, 44.8], [37, 45.2]], wander: 0.6 },
  campfire: { at: [[29.7, 25], [31.9, 25.2], [30.8, 26.6]], wander: 0.2 },
  plaza: { at: [[27, 23.6], [32.2, 23.2], [29, 19.6]], wander: 3 },
  home: { at: [], wander: 0.6 },
}
const WORKS = new Set(['forge', 'woods', 'library', 'carpentry', 'townhall', 'well', 'lake', 'field'])
const BY_STATE = { asleep: 'home', blocked: 'townhall', thinking: 'campfire', idle: 'plaza' }

export const hash = s => {
  let h = 2166136261
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

/** A free home slot for `id`: hash with linear probing; -1 when all are taken. */
export function slotFor(id, taken) {
  for (let k = 0; k < SLOTS; k++) {
    const s = (hash(id) + k) % SLOTS
    if (!taken.has(s)) return s
  }
  return -1
}

export const resident = (id, slot) => ({
  id, slot, title: '', live: false, busy: false, tool: null, blocked: false, failedUntil: 0, last: 0,
  spot: 'home', point: 0, spotAt: -Infinity, arrivedAt: 0, picks: 0,
})

/**
 * One normalized event (the Hermes adapter makes these):
 * { type: 'live', on } · { type: 'busy', on } · { type: 'tool', name } · { type: 'toolDone' } ·
 * { type: 'blocked' } · { type: 'unblocked' } · { type: 'error' }
 */
export function apply(r, ev, now) {
  r.last = now
  switch (ev.type) {
    case 'live': r.live = ev.on; if (!ev.on) Object.assign(r, { busy: false, tool: null, blocked: false }); break
    case 'busy': r.busy = ev.on; if (ev.on) r.live = true; else r.tool = null; break
    case 'tool': r.tool = ev.name; r.live = true; r.busy = true; break
    case 'toolDone': r.tool = null; r.blocked = false; break
    case 'blocked': r.blocked = true; r.live = true; break
    case 'unblocked': r.blocked = false; break
    case 'error': Object.assign(r, { failedUntil: now + FAIL, busy: false, tool: null, blocked: false }); break
  }
}

export function state(r, now) {
  if (now - r.last > STALE && (r.busy || r.tool || r.blocked)) Object.assign(r, { busy: false, tool: null, blocked: false })
  if (!r.live) return 'asleep'
  if (r.blocked) return 'blocked'
  if (now < r.failedUntil) return 'failed'
  if (r.tool) return 'tool'
  if (r.busy) return 'thinking'
  return 'idle'
}

/** Pick the villager's goal; true when it changed (then walk to SPOTS[r.spot].at[r.point]). */
export function decide(r, now) {
  const st = state(r, now)
  if (st === 'failed') return false // stays where it went wrong
  const want = st === 'tool' ? toolSpot(r.tool) : BY_STATE[st]
  if (want === r.spot) return false
  if (now - r.spotAt < HOLD) return false
  const working = WORKS.has(r.spot) && !(r.arrivedAt && now - r.arrivedAt >= WORK) && now - r.spotAt < 60e3
  if (working && st !== 'blocked' && st !== 'asleep') return false
  r.spot = want
  r.point = (hash(r.id) + r.picks++) % Math.max(1, SPOTS[want].at.length)
  r.spotAt = now
  r.arrivedAt = 0
  return true
}

// ---- Hermes → village (plugin.js feeds these; kept here so the test covers them) ----------------

/** A gateway event → a normalized event (see `apply`), or null when the village ignores it. */
export function fromGatewayEvent(ev) {
  const p = ev?.payload ?? {}
  switch (ev?.type) {
    case 'tool.start': {
      // deferred tools run through `tool_call`: the real name is the first call's
      const name = p.name === 'tool_call' ? p.args?.calls?.[0]?.name ?? p.name : p.name
      return { type: 'tool', name: String(name ?? '') }
    }
    case 'tool.complete': return { type: 'toolDone' }
    case 'message.start': return { type: 'busy', on: true }
    case 'message.complete': return p.status === 'error' ? { type: 'error' } : { type: 'busy', on: false }
    default: return null
  }
}

/**
 * The population from a poll: `live` = session.active_list rows (runtime `id`, stored
 * `session_key`, `status`, `title`), `recent` = session.list rows (stored `id`, `title`). Live
 * chats first, then the most recent asleep, at most SLOTS. Mutates `people` (stored id → resident;
 * kept residents keep their home), returns runtime id → stored id for the events.
 */
export function syncRoster(people, live, recent, now) {
  const runtime = new Map()
  const want = new Map()
  // an empty chat (a fresh tab nobody wrote in yet) is no villager
  const empty = s => s.message_count === 0 && (s.status ?? 'idle') === 'idle'
  for (const s of live) {
    const id = s.session_key || s.id
    runtime.set(s.id, id)
    if (!want.has(id) && !empty(s)) want.set(id, { title: s.title, row: s })
  }
  for (const s of recent) if (!want.has(s.id) && !empty(s) && !runtime.has(s.id)) want.set(s.id, { title: s.title, row: null })
  const keep = [...want].slice(0, SLOTS)
  const ids = new Set(keep.map(([id]) => id))
  for (const id of people.keys()) if (!ids.has(id)) people.delete(id)
  const taken = new Set([...people.values()].map(r => r.slot))
  for (const [id, { title, row }] of keep) {
    let r = people.get(id)
    if (!r) {
      r = resident(id, slotFor(id, taken))
      taken.add(r.slot)
      people.set(id, r)
    }
    r.title = title || r.title || 'Untitled chat'
    // the poll is the truth for live / busy / waiting; events fill in the tools between polls
    const on = !!row
    if (r.live !== on) apply(r, { type: 'live', on }, now)
    if (!row) continue
    const busy = row.status !== 'idle'
    if (busy !== r.busy) apply(r, { type: 'busy', on: busy }, now)
    const waiting = row.status === 'waiting'
    if (waiting !== r.blocked) apply(r, { type: waiting ? 'blocked' : 'unblocked' }, now)
  }
  return runtime
}

// Seasons: the level re-dressed with Lumina's season kit (vendor/lumina: pixel/textures/seasons.js,
// world/props/SeasonTrees.js). Summer is the level as drawn, its autumn trees green.
export const SEASONS = ['winter', 'spring', 'summer', 'autumn']
/** The season of a date (northern hemisphere: Dec–Feb winter …). */
export const seasonOn = date => SEASONS[Math.floor(((date.getMonth() + 1) % 12) / 3)]
const LOOK = {
  spring: { tops: { grass: 'spring_grass', grass_dark: 'spring_grass', grass_flowers: 'blossom_grass' }, lip: 'spring_grass_side',
    trees: { autumn: 'blossom', maple: 'blossom' }, drop: ['leaves'] },
  summer: { tops: {}, trees: { autumn: 'oak', maple: 'oak' }, drop: [] },
  autumn: { tops: { grass: 'autumn_grass', grass_dark: 'autumn_grass', grass_flowers: 'fallen_leaves', farmland: 'stubble' }, lip: 'autumn_grass_side',
    trees: { oak: 'maple', birch: 'goldbirch' }, drop: ['petals'] },
  winter: { tops: { grass: 'snow_top', grass_dark: 'snow_top', grass_flowers: 'snow_top', farmland: 'snow_top', dirt: 'snow_path', dirt_path: 'snow_path', cobblestone: 'frost_cobble' },
    lip: 'snow_side', trees: { pine: 'snowpine', oak: 'bare', birch: 'bare', autumn: 'bare', maple: 'bare' }, drop: ['leaves', 'petals', 'fireflies'],
    house: { icicles: true }, weather: 'snow' },
}
/** What the banner says when a season comes (Latin only: Lumina's pixel fonts have no Cyrillic). */
export const SEASON_BANNER = {
  winter: ['Winter', 'Snow falls on the village'],
  spring: ['Spring', 'The snow melts, the cherries bloom'],
  summer: ['Summer', 'Long warm days'],
  autumn: ['Autumn', 'The leaves turn gold'],
}

/** A copy of a raw level dressed for a season (the level itself is untouched). */
export function seasonal(level, season) {
  const L = LOOK[season]
  const legend = Object.fromEntries(Object.entries(level.legend).map(([k, d]) => [k, {
    ...d, ...(L.tops[d.top] && { top: L.tops[d.top] }), ...(L.lip && d.lip === 'grass_side' && { lip: L.lip }),
  }]))
  const objects = level.objects.filter(o => !(o.type === 'emitter' && L.drop.includes(o.preset))).map(o =>
    o.type === 'tree' && L.trees[o.opts?.kind] ? { ...o, opts: { ...o.opts, kind: L.trees[o.opts.kind] } }
    : o.type === 'house' && L.house ? { ...o, opts: { ...o.opts, ...L.house } } : o)
  // (no `season` in summer: Lumina's summer raises limestone headlands at the map's water edge)
  const environment = { ...level.environment, ...(season !== 'summer' && { season }), ...(L.weather && { weather: L.weather }) }
  return { ...level, legend, objects, environment }
}
