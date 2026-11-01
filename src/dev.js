// Dev page: a level in the viewer outside Hermes. ?level=village|sample-hamlet  ?hour=N  ?season=winter|spring|summer|autumn  ?fake=0 (no auto events)
// A fake event stream drives 12 residents; the panel (top-left) fires events at one of them.
import { createViewer } from './viewer.js'
import { resident, apply, state, slotFor } from './village.js'
import village from '../levels/village.json'
import hamlet from '../vendor/lumina/public/levels/sample-hamlet.json'

const q = new URLSearchParams(location.search)
const level = q.get('level') === 'sample-hamlet' ? hamlet : village
window.__errs ??= []

const TITLES = ['Fix flaky CI on main', 'Refactor auth module', 'Research vector DBs', 'Write release notes', 'Plan Q3 roadmap',
  'Debug memory leak', 'Translate docs to German', 'Review PR #482', 'Benchmark the parser', 'Draft blog post', 'Clean up old branches', 'Migrate to Postgres 17']
const taken = new Set()
const people = Array.from({ length: 12 }, (_, k) => {
  const r = resident(`chat-${k}`, slotFor(`chat-${k}`, taken))
  taken.add(r.slot)
  r.title = TITLES[k]
  apply(r, { type: 'live', on: k < 10 }, performance.now())
  return r
})
const TOOLS = ['terminal', 'web_search', 'read_file', 'patch', 'delegate_task', 'memory', 'vision_analyze', 'todo']
const EVENTS = [
  ...TOOLS.map(name => ({ type: 'tool', name })),
  { type: 'toolDone' }, { type: 'busy', on: true }, { type: 'busy', on: false },
  { type: 'blocked' }, { type: 'unblocked' }, { type: 'error' }, { type: 'live', on: false }, { type: 'live', on: true },
]
const fire = (r, ev) => apply(r, ev, performance.now())

// panel (bottom-right; ?panel=0 hides it)
const panel = document.createElement('div')
panel.id = 'devpanel'
panel.style.cssText = 'position:absolute;right:8px;bottom:8px;z-index:20;font:12px system-ui;color:#eee;background:#000a;padding:6px;border-radius:6px;display:flex;flex-wrap:wrap;gap:4px;max-width:420px'
const pick = document.createElement('select')
pick.append(...people.map((r, i) => new Option(r.title, i)))
panel.append(pick)
for (const ev of EVENTS) {
  const b = document.createElement('button')
  b.textContent = ev.name ?? (ev.on != null ? `${ev.type}:${ev.on}` : ev.type)
  b.onclick = () => fire(people[pick.value], ev)
  panel.append(b)
}
const info = document.createElement('div')
info.style.cssText = 'width:100%;white-space:pre;font:11px ui-monospace,monospace'
panel.append(info)
if (q.get('panel') !== '0') document.body.append(panel)
setInterval(() => { info.textContent = people.map(r => `${r.title.padEnd(8)} ${state(r, performance.now()).padEnd(8)} ${r.spot} ${r.tool ?? ''}`).join('\n') }, 500)

// auto stream: a random chat gets a plausible next event every 1.5 s
if (q.get('fake') !== '0')
  setInterval(() => {
    const r = people[Math.floor(Math.random() * people.length)]
    const roll = Math.random()
    const ev = !r.live ? { type: 'live', on: roll < 0.3 }
      : r.blocked ? { type: roll < 0.5 ? 'unblocked' : 'busy', on: true }
      : roll < 0.45 ? { type: 'tool', name: TOOLS[Math.floor(Math.random() * TOOLS.length)] }
      : roll < 0.6 ? { type: 'toolDone' }
      : roll < 0.72 ? { type: 'busy', on: Math.random() < 0.5 }
      : roll < 0.78 ? { type: 'blocked' }
      : roll < 0.82 ? { type: 'error' }
      : roll < 0.85 ? { type: 'live', on: false }
      : { type: 'busy', on: true }
    if (ev.type === 'live' && !ev.on && r.live === false) return
    fire(r, ev)
  }, 1500)

createViewer(document.getElementById('wrap'), level, { hour: q.has('hour') ? Number(q.get('hour')) : null, season: q.get('season') ?? undefined })
  .then(v => { v.residents = people; window.__v = v; window.__people = people })
  .catch(e => { window.__errs.push(String(e?.stack || e)); throw e })
