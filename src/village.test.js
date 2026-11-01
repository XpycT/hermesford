// node src/village.test.js
import assert from 'node:assert/strict'
import { toolSpot, resident, apply, state, decide, slotFor, SLOTS } from './village.js'

// tools → work
assert.equal(toolSpot('terminal'), 'forge')
assert.equal(toolSpot('mcp__tavily__tavily_search'), 'woods')
assert.equal(toolSpot('web_extract'), 'woods')
assert.equal(toolSpot('read_file'), 'library')
assert.equal(toolSpot('patch'), 'carpentry')
assert.equal(toolSpot('kanban_create'), 'townhall')
assert.equal(toolSpot('fact_store'), 'well')
assert.equal(toolSpot('no_such_tool'), 'field')
assert.equal(toolSpot(undefined), 'field')

// priority: asleep < … < blocked
const r = resident('s1', 0)
assert.equal(state(r, 0), 'asleep')
apply(r, { type: 'live', on: true }, 0); assert.equal(state(r, 0), 'idle')
apply(r, { type: 'busy', on: true }, 0); assert.equal(state(r, 0), 'thinking')
apply(r, { type: 'tool', name: 'terminal' }, 0); assert.equal(state(r, 0), 'tool')
apply(r, { type: 'blocked' }, 0); assert.equal(state(r, 0), 'blocked')
apply(r, { type: 'unblocked' }, 0); assert.equal(state(r, 0), 'tool')
apply(r, { type: 'error' }, 0); assert.equal(state(r, 0), 'failed'); assert.equal(state(r, 6001), 'idle')

// hysteresis: a goal at most every 4 s; a work spot is worked 2 s after arrival
const h = resident('s2', 1)
apply(h, { type: 'tool', name: 'terminal' }, 0)
assert.equal(decide(h, 0), true); assert.equal(h.spot, 'forge')
apply(h, { type: 'tool', name: 'read_file' }, 1000)
assert.equal(decide(h, 1000), false) // < 4 s
assert.equal(decide(h, 5000), false) // not there yet
h.arrivedAt = 5000
assert.equal(decide(h, 6000), false) // worked 1 s
assert.equal(decide(h, 7000), true); assert.equal(h.spot, 'library')
// blocked overrides the work commitment (after the 4 s hold)
apply(h, { type: 'blocked' }, 8000)
assert.equal(decide(h, 8000), false)
assert.equal(decide(h, 11000), true); assert.equal(h.spot, 'townhall')
// the session went away → home
apply(h, { type: 'live', on: false }, 12000)
assert.equal(decide(h, 15000), true); assert.equal(h.spot, 'home')

// stale: 10 min without an event → idle
const s = resident('s3', 2)
apply(s, { type: 'tool', name: 'terminal' }, 0)
assert.equal(state(s, 9 * 60e3), 'tool')
assert.equal(state(s, 11 * 60e3), 'idle')

// slots: stable, probing, full
const taken = new Set()
for (let k = 0; k < SLOTS; k++) { const sl = slotFor('id' + k, taken); assert.ok(sl >= 0 && !taken.has(sl)); taken.add(sl) }
assert.equal(slotFor('one-more', taken), -1)
assert.equal(slotFor('x', new Set()), slotFor('x', new Set()))

console.log('village: ok')

// Hermes adapter
import { fromGatewayEvent, syncRoster } from './village.js'
assert.deepEqual(fromGatewayEvent({ type: 'tool.start', payload: { name: 'terminal' } }), { type: 'tool', name: 'terminal' })
assert.deepEqual(fromGatewayEvent({ type: 'tool.start', payload: { name: 'tool_call', args: { calls: [{ name: 'browser_vault' }] } } }), { type: 'tool', name: 'browser_vault' })
assert.deepEqual(fromGatewayEvent({ type: 'message.complete', payload: { status: 'error' } }), { type: 'error' })
assert.deepEqual(fromGatewayEvent({ type: 'message.complete', payload: {} }), { type: 'busy', on: false })
assert.equal(fromGatewayEvent({ type: 'message.delta' }), null)

const people = new Map()
const rt = syncRoster(people,
  [{ id: 'rt1', session_key: 'st1', status: 'working', title: 'A' }, { id: 'rt2', session_key: 'st2', status: 'waiting', title: 'B' }],
  [{ id: 'st1', title: 'A' }, { id: 'st3', title: '' }, ...Array.from({ length: 20 }, (_, k) => ({ id: 'old' + k, title: 'o' }))], 0)
assert.equal(rt.get('rt1'), 'st1')
assert.equal(people.size, SLOTS)
assert.equal(state(people.get('st1'), 0), 'thinking')
assert.equal(state(people.get('st2'), 0), 'blocked')
assert.equal(state(people.get('st3'), 0), 'asleep')
assert.equal(people.get('st3').title, 'Untitled chat')
assert.equal(new Set([...people.values()].map(r => r.slot)).size, SLOTS)
const slot1 = people.get('st1').slot
syncRoster(people, [{ id: 'rt1', session_key: 'st1', status: 'idle', title: 'A' }], [{ id: 'st1', title: 'A' }], 1000)
assert.equal(people.size, 1)
assert.equal(people.get('st1').slot, slot1) // kept its home
assert.equal(state(people.get('st1'), 1000), 'idle')

// empty chats (0 messages, idle) are skipped, live or stored; a working empty one is not
const e = new Map()
syncRoster(e, [{ id: 'x', session_key: 'x', status: 'idle', message_count: 0 }, { id: 'y', session_key: 'y', status: 'working', message_count: 0 }],
  [{ id: 'x', message_count: 0 }, { id: 'z', message_count: 0 }, { id: 'w', message_count: 3 }], 0)
assert.deepEqual([...e.keys()].sort(), ['w', 'y'])

console.log('adapter: ok')
