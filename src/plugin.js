// Hermes Village — desktop plugin: a full page (/village) with a Lumina diorama of the village.
// Every Hermes chat is a villager: session.active_list / session.list (polled) say who lives here
// and who is working or waiting; tool / message events say what they do between polls.
import { host, atom, useValue, EmptyState, StatusDot, ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'
import { useEffect, useRef } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { createViewer } from './viewer.js'
import { apply, fromGatewayEvent, syncRoster } from './village.js'
import village from '../levels/village.json'

const POLL_MS = 3000
// the village outlives the page: residents keep their homes and state between visits
const people = new Map() // stored session id → resident
const roster = [] // what the viewer reads every frame
let runtime = new Map() // runtime session id → stored id
const $offline = atom(false) // the last poll failed: the village stays as it was (state.js: idle after 10 min)
const $broken = atom(null) // the viewer could not start (no WebGL)
// DevTools (F12): __village.people / __village.runtime / __village.events
globalThis.__village = { people, get runtime() { return runtime }, events: [] }

async function poll() {
  const [live, recent] = await Promise.all([
    host.request('session.active_list', {}),
    host.request('session.list', { limit: 16 }),
  ])
  $offline.set(false)
  runtime = syncRoster(people, live?.sessions ?? [], recent?.sessions ?? [], performance.now())
  roster.length = 0
  roster.push(...people.values())
}

function onGatewayEvent(ev) {
  const r = people.get(runtime.get(ev?.session_id))
  const e = r && fromGatewayEvent(ev)
  const log = globalThis.__village.events
  log.push({ t: ev?.type, sid: ev?.session_id, name: ev?.payload?.name, hit: !!r })
  if (log.length > 50) log.shift()
  if (e) apply(r, e, performance.now())
}

function VillagePage() {
  const ref = useRef(null)

  useEffect(() => {
    let viewer = null
    let gone = false
    const tick = () => poll().catch(err => { $offline.set(true); console.warn('[village] poll failed', err) })
    tick()
    const timer = setInterval(tick, POLL_MS)
    createViewer(ref.current, village).then(
      v => {
        if (gone) return v.dispose()
        viewer = v
        v.residents = roster
        v.onOpen = r => host.openSession(r.id)
      },
      err => { $broken.set(String(err?.message ?? err)); console.error('[village] failed to start', err) }
    )
    return () => {
      gone = true
      clearInterval(timer)
      viewer?.dispose()
    }
  }, [])

  const offline = useValue($offline)
  const broken = useValue($broken)
  if (broken) return jsx(EmptyState, { className: 'h-full', title: 'WebGL is unavailable', description: 'HermesFord needs WebGL to draw the village.' })
  return jsxs('div', {
    className: 'relative h-full w-full overflow-hidden',
    children: [
      jsx('div', { ref, className: 'absolute inset-0' }),
      offline && jsx('div', {
        className: 'absolute bottom-2 right-2 z-10 flex items-center p-1', title: 'Gateway unreachable: the village shows the last known state',
        children: jsx(StatusDot, { tone: 'muted', className: 'size-2' }),
      }),
    ],
  })
}

export default {
  id: 'hermesford',
  name: 'HermesFord - Where the Agents Live',
  register(ctx) {
    for (const type of ['tool.start', 'tool.complete', 'message.start', 'message.complete']) ctx.onEvent(type, onGatewayEvent)
    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: '/village' }, render: () => jsx(VillagePage, {}) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: '/village', label: 'HermesFord', codicon: 'home' } },
    ])
  },
}
