// Hosts a Lumina level (vendor/lumina) in a container: world, light, post, camera, villagers.
// No player, UI, audio, combat or story. Mirrors Game.init/_buildLevel/update (vendor/lumina/src/game/Game.js).
import * as THREE from 'three'
import { Engine } from '../vendor/lumina/src/engine/core/Engine.js'
import { CameraRig } from '../vendor/lumina/src/engine/core/CameraRig.js'
import { PostFX } from '../vendor/lumina/src/engine/render/PostFX.js'
import { LightingSystem, DEFAULT_KEYFRAMES } from '../vendor/lumina/src/engine/lighting/LightingSystem.js'
import { TextureLibrary } from '../vendor/lumina/src/engine/pixel/Textures.js'
import { Particles } from '../vendor/lumina/src/engine/fx/Particles.js'
import { GodRays } from '../vendor/lumina/src/engine/fx/GodRays.js'
import { SpriteManager } from '../vendor/lumina/src/engine/sprite/SpriteManager.js'
import { computeCameraBounds } from '../vendor/lumina/src/engine/level/ObjectBuilder.js'
import { normalizeLevel } from '../vendor/lumina/src/engine/level/LevelFormat.js'
import { primeShadowPrograms } from '../vendor/lumina/src/engine/world/ShadowCasters.js'
import { World } from '../vendor/lumina/src/game/World.js'
import { Npc } from '../vendor/lumina/src/game/Npc.js'
import { Critters } from '../vendor/lumina/src/game/Critters.js'
import { createEnemySheet } from '../vendor/lumina/src/engine/pixel/MonsterSprites.js'
import { icon } from '../vendor/lumina/src/engine/ui/art/icons/combat.js'
import { Weather } from '../vendor/lumina/src/game/Weather.js'
import { installFogStart, setFogStart } from '../vendor/lumina/src/game/AtmosphereFog.js'
import { UI } from '../vendor/lumina/src/engine/ui/UI.js'
import { startFonts } from '../vendor/lumina/src/engine/ui/FontLoader.js'
import { Emotes } from '../vendor/lumina/src/engine/ui/Emotes.js'
import { Journal } from '../vendor/lumina/src/engine/ui/Journal.js'
import { EndCard } from '../vendor/lumina/src/engine/ui/EndCard.js'
import { PartyFrames } from '../vendor/lumina/src/engine/ui/PartyFrames.js'
import { group, box, put, keyHints } from '../vendor/lumina/src/engine/ui/layout/layout.js'
import { txc, measure, grow } from '../vendor/lumina/src/engine/ui/layout/type.js'
import { glyph, dimGlyph, plate } from '../vendor/lumina/src/engine/ui/art/pieces.js'
import { pal } from '../vendor/lumina/src/engine/ui/art/palette.js'
import { phaseName } from '../vendor/lumina/src/engine/ui/HUD.js'
import { renderLevelMap } from '../vendor/lumina/src/engine/level/LevelMap.js'
import { decide, state, toolSpot, hash, SPOTS, SEASONS, SEASON_BANNER, seasonOn, seasonal } from './village.js'
import { loadSeasonLook, showClimateSky } from '../vendor/lumina/src/game/Climate.js'
import { Fader } from '../vendor/lumina/src/engine/ui/Fader.js'
import { Nav } from '../vendor/lumina/src/game/combat/Nav.js'
import { CAMERA, SUN_PATH, MOON_PATH, KEYFRAME_OVERRIDES, SPRITE_FILL } from '../vendor/lumina/src/game/config.js'

const DEG = Math.PI / 180

/** The controls legend (Lumina's HUD, bottom-left): only what the village really does. */
const CONTROLS = [
  { id: 'follow', keys: '←/→', label: 'Follow a villager' },
  { id: 'pan', keys: 'Drag', label: 'Pan (or scroll), lets go' },
  { id: 'camera', keys: 'Q/E', label: 'Rotate camera' },
  { id: 'zoom', keys: 'Z/X', label: 'Zoom (or pinch)' },
  { id: 'map', keys: 'N/Tab', label: 'World map' },
  { id: 'time', keys: 'T', label: 'Time of day' },
  { id: 'weather', keys: 'R', label: 'Weather' },
  { id: 'season', keys: 'Y', label: 'Season' },
]
/** Lumina editor's world labels (src/editor/viewport3d/Labels.js), the region style. */
const PLATE_CSS = `
.lvp3d-label {
  position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); white-space: nowrap; pointer-events: none; z-index: 0;
  font: 600 12px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #f4ead2;
  padding: 3px 8px 3px 7px; border-radius: 4px; letter-spacing: 0.02em;
  background: linear-gradient(180deg, rgba(20, 24, 40, 0.86), rgba(10, 12, 22, 0.86));
  border: 1px solid rgba(201, 164, 92, 0.55); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
  will-change: transform; user-select: none;
}
.lvp3d-label small { display: block; font-weight: 400; font-size: 10.5px; color: #c8b98f; }
.lvp3d-label.region { border-left: 3px solid #e3b35c; text-align: left; }
.lvp3d-label.region::after {
  content: ''; position: absolute; left: 50%; bottom: -7px; width: 1px; height: 6px;
  background: rgba(227, 179, 92, 0.7);
}`
/** What each workplace is for (village.js TOOLS → spots). */
const PLATE_SUB = { 'The Forge': 'terminal · code', 'The Library': 'read · search', Carpentry: 'write · patch', 'Town Hall': 'delegate · kanban' }
/** A villager's work (village.js spot) → its trade on the party frame. */
const TRADE = { forge: 'Blacksmith', woods: 'Hunter', library: 'Scribe', carpentry: 'Carpenter', townhall: 'Messenger', well: 'Keeper', lake: 'Painter', field: 'Farmer' }
const STATE_LABEL = { blocked: 'Waiting for you', failed: 'Error', thinking: 'Thinking', idle: 'Idle' }
const STATE_ORDER = { blocked: 0, failed: 1, tool: 2, thinking: 3, idle: 4 }
const MAX_FRAMES = 6

/**
 * Lumina's x-ray silhouette (game/Player.js `silhouetteMaterial`, not exported there; copied as is):
 * a pale copy of a sprite quad drawn only where something hides it (depthFunc GREATER), pulled
 * 1.3 u toward the camera so only real occluders (roofs, canopies, not grass) reveal it.
 */
function silhouetteMaterial(map) {
  const m = new THREE.MeshBasicMaterial({ map, color: new THREE.Color('#d9ccff'), transparent: true, opacity: 0.55, depthWrite: true, depthFunc: THREE.GreaterDepth, fog: false })
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n\tmvPosition.xyz *= max( 0.0, 1.0 - 1.3 / length( mvPosition.xyz ) );\n\tgl_Position = projectionMatrix * mvPosition;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\n\tif ( sampledDiffuseColor.a < 0.5 ) discard;\n\tfloat silL = sqrt( dot( sampledDiffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) );\n\tdiffuseColor = vec4( diffuse * ( 0.42 + 0.8 * silL ), opacity );')
  }
  m.customProgramCacheKey = () => 'emberfall-player-silhouette-v2'
  return m
}
const SILHOUETTE = new THREE.Color('#d9ccff')

/** A villager's state → its Lumina emote bubble. */
const EMOTE = { blocked: '!', failed: 'skull', thinking: '…' } // Lumina's emotes: alert, ellipsis; the skull: its UI icon (art/icons/combat.js)

/**
 * @param {HTMLElement} container
 * @param {object} rawLevel luminati-level JSON
 * @param {{ hour?: number|null }} [opts] fixed hour (dev); default = the local clock
 */
async function mount(container, rawLevel, { hour = null, bannersShown = new Set(), known = new Set() } = {}) {
  const { level } = normalizeLevel(rawLevel)
  const env = level.environment ?? {}
  const cam = { ...CAMERA, ...(env.camera ?? {}) }

  setFogStart(cam.distance - 7)
  installFogStart()
  const engine = new Engine({ container, maxPixelRatio: 1.25, inputTarget: container })
  const { scene, camera, renderer } = engine
  const textures = new TextureLibrary({ seed: 1337, anisotropy: 4 })
  const keyframes = DEFAULT_KEYFRAMES.map(k => ({ ...k, ...(KEYFRAME_OVERRIDES[k.name] ?? {}) }))
  const lighting = new LightingSystem(engine, { timeOfDay: clockHour(hour), shadowExtent: 26, sunPath: SUN_PATH, moonPath: MOON_PATH, keyframes })
  lighting.sky.lowerClouds = 0.25
  lighting.timeSpeed = 0 // we drive the hour from the real clock
  // the season's sky retouches (Lumina's SeasonLook keyframes over ours)
  if (env.season) { await loadSeasonLook(); showClimateSky(lighting, null, env.season) }
  const particles = new Particles(scene)
  const godRays = new GodRays({ gain: 0.2 })
  scene.add(godRays.object)
  const spriteManager = new SpriteManager(camera)

  const walk = computeCameraBounds(level, 0)
  const rig = new CameraRig(camera, { ...cam, yaw: 0, lookAhead: 0, minDistance: 18, maxDistance: 60 })
  rig.wheelZoomScale = 0 // the wheel is ours: pan, pinch = zoom (below)
  rig.bounds = { minX: walk.minX + 3, maxX: walk.maxX - 3, minZ: walk.minZ + 1, maxZ: walk.maxZ - 2 }
  const focus = new THREE.Object3D()
  focus.position.set((walk.minX + walk.maxX) / 2, 1, (walk.minZ + walk.maxZ) / 2)
  rig.setTarget(focus)

  const dpr = Math.min(devicePixelRatio || 1, engine.maxPixelRatio)
  const postfx = new PostFX(renderer, scene, camera, { maxTaps: 64, samples: container.clientWidth * container.clientHeight * dpr * dpr > 1.8e6 ? 2 : 4 })
  const S = postfx.settings // Game._tunePost
  Object.assign(S.dof, { focusRange: 6, maxBlur: 13, nearScale: 1.5, farScale: 1.15, tiltShift: 0.42, tiltCenter: 0.5, tiltWidth: 0.3, bokehBoost: 1.6 })
  Object.assign(S.bloom, { strength: 0.5, radius: 0.58, threshold: 1.05 })
  Object.assign(S.grade, { exposure: 1.03, contrast: 1.04, saturation: 1.3, temperature: 0.04, vignette: 0.55, grain: 0.03, shadowsTint: [-0.04, 0.05, 0.15] })
  engine.events.on('resize', ({ width, height, pixelRatio }) => postfx.setSize(width, height, pixelRatio))

  const world = new World({ engine, textures, lighting, particles, godRays, level })
  await world.build(() => {})
  if (world.batching) lighting.setShadowDepthRange(world.batching.shadowUp, world.batching.shadowDown)
  const tileMap = world.tileMap

  // villagers: every npc object of the level (residents are bound to them by id)
  const sheetCache = new Map()
  const npcs = []
  for (const o of level.objects) {
    if (o.type !== 'npc') continue
    const npc = new Npc({ def: { id: o.id, name: o.name || 'Villager', preset: o.preset || 'villager', home: [o.x, o.z], wander: o.wander ?? 1.2, speed: o.speed ?? 1, facing: o.facing || 'down' }, tileMap, sheetCache })
    npc.door = [o.x, o.z]
    npc.setPresent(false) // shown once a chat lives here
    // seen through roofs and canopies (Lumina's player x-ray)
    const sil = new THREE.Mesh(npc.sprite.mesh.geometry, silhouetteMaterial(npc.sprite.texture))
    sil.renderOrder = 60
    npc.sprite.mesh.add(sil)
    npc.silhouette = sil
    scene.add(npc.sprite)
    spriteManager.add(npc.sprite)
    npcs.push(npc)
    // its home (npcs r00..r15 ↔ 'Home 1..16'): the window light at the door and a spot over the roof
    const k = npcs.length - 1
    const home = level.objects.find(h => h.type === 'house' && h.name === `Home ${k + 1}`)
    if (home) {
      npc.roof = new THREE.Object3D()
      npc.roof.position.set(home.x, tileMap.getHeight(home.x, home.z) + (home.opts?.stories ?? 1) * 2.4, home.z)
      scene.add(npc.roof)
    }
  }
  // footsteps: Lumina's dust puff at the walk / run contact frames (game/Player.js)
  for (const npc of npcs) npc.sprite.onFrameChange = (frame, anim) => {
    if (!npc.present || (frame !== 0 && frame !== 2) || !anim || !(anim.startsWith('walk') || anim.startsWith('run'))) return
    particles.burst('footstep', npc.position, anim.startsWith('run') ? 4 : 2)
  }
  const critters = new Critters({ tileMap, scene, spriteManager, groups: level.objects.filter(o => o.type === 'critters') })
  // the wild things of the woods (Lumina's monster sheets, MonsterSprites.js): boars and slimes by
  // day, bats at night; they roam with Critters' cat brain (its class, off the level's cat)
  // ponytail: borrows the class from an instance; needs the level's cat (one at the square)
  const Roam = critters.cats[0]?.constructor
  const WILD = [['boar', 13, 6.6, 3], ['boar', 44, 6.2, 3], ['slime', 20, 7.4, 2], ['slime', 34, 7.6, 2], ['slime', 76, 7, 2.5], ['slime', 72.5, 46.5, 2.5], ['slime', 76.5, 48, 2.5], ['slime', 74, 50.5, 2.5], // the last three: the hay hill
    ['bat', 9, 6, 3.5], ['bat', 38, 5.4, 3.5], ['bat', 68, 7.4, 3], ['bat', 12, 41.6, 4]]
  const sheets = {}
  const wild = Roam ? WILD.map(([kind, x, z, roam], i) => {
    const sheet = (sheets[kind] ??= createEnemySheet(kind))
    const c = new Roam({ sheet, tileMap, x, z, seed: 900 + i, radius: 0.3, speed: kind === 'bat' ? 1.6 : 0.7, roam, opts: sheet.spriteOptions })
    c.kind = kind
    if (kind === 'bat') { c.sprite.mesh.position.y = 1.3; c.sprite.mesh.castShadow = false } // a flier: hovers over its shadow
    scene.add(c.sprite)
    spriteManager.add(c.sprite)
    critters.all.push(c)
    return c
  }) : []
  for (const s of [...npcs.map(n => n.sprite), ...critters.all.map(c => c.sprite)])
    lighting.registerEmissive(s.material, SPRITE_FILL)
  const weather = new Weather({ lighting, particles, postfx, godRays, world })
  if (env.season === 'winter') weather.snowFloor = 0.9 // snow lies whatever the weather
  lighting.followTarget(focus)

  // Lumina's UI: place plate + clock + minimap (top), controls legend (bottom-left), area banner,
  // world map, toasts, emote bubbles. English only: its pixel fonts have no Cyrillic.
  // Fonts in local mode: the bundled (inlined) faces, no Google Fonts fetch, no localStorage.
  const ui = new UI(container, { lang: 'en', fonts: startFonts({ lang: 'en', mode: 'local' }) })
  // the story UI as Lumina's sandbox/story_ui sets it up: ui.update moves the emote bubbles
  const { emotes } = ui.useStoryUI({ Journal, Emotes, EndCard })
  // the villagers awake, top-left under the place plate (Lumina's party frames): who, doing what
  const frames = new PartyFrames(ui.root)
  // a click on a frame opens its chat (as on the villager)
  frames.element.style.pointerEvents = 'auto'
  frames.element.style.cursor = 'pointer'
  frames.element.addEventListener('click', e => {
    const f = frames._frames.find(f => f.el.contains(e.target))
    const r = f && residents.find(x => x.id === f.id)
    if (r) onOpen?.(r)
  })
  // chat titles in the party frames' face (Tiny5, 'small' tracked caps): Lumina's one pixel face
  // with Cyrillic (Jersey has none); the toast is laid out by Lumina for its 'line' role, so its
  // size and text are redone in this one
  const TITLE = { font: 'small', track: 1, drop: true }
  const caps = t => String(t).toUpperCase()
  const hud = ui.hud, toastSize = hud._toastSize.bind(hud), renderToast = hud._renderToast.bind(hud)
  hud._toastSize = (spec, room) => {
    const z = toastSize(spec, room)
    if (!spec.title || z.title) return z
    const tw = measure(caps(spec.text), 'small', 1)
    const w = z.w - z.tw + tw
    return (spec.size = { ...z, tw, lines: 1, w: w + (w % 2), parts: null, title: true })
  }
  hud._renderToast = (el, spec, z) => {
    renderToast(el, spec, z)
    const t = spec.title && el.querySelector('.lu-toast__text')
    if (!t) return
    const x = parseFloat(t.style.left.match(/\* ([\d.]+)/)?.[1] ?? 35)
    t.remove()
    txc(el, caps(spec.text), x, z.h / 2, { ...TITLE, color: pal().g5, cls: 'lu-toast__text' })
  }
  const titleToast = (text, seconds, kind) => {
    const el = hud.toast(text, seconds, { kind })
    hud._toastSpecs.get(el).title = true
    hud._toastSpecs.get(el).size = hud._toastSpecs.get(el).drawn = null
    hud._layoutToasts()
  }
  let framesAt = 0
  const short = t => (t.length > 22 ? t.slice(0, 21) + '…' : t)
  // the villagers awake, the followed one first, then by urgency
  // (the chooser cycles by slot: a steady order while states change)
  const awake = (now, bySlot = false) => residents.map(r => ({ r, st: state(r, now) })).filter(x => x.st !== 'asleep')
    .sort((a, b) => bySlot ? a.r.slot - b.r.slot : (b.r.id === followId) - (a.r.id === followId) || STATE_ORDER[a.st] - STATE_ORDER[b.st] || a.r.slot - b.r.slot)
  function updateFrames(now) {
    if (now - framesAt < 250) return
    framesAt = now
    frames.update(awake(now).slice(0, MAX_FRAMES).map(({ r, st }) => ({
      fighting: r.id === followId, // the frame's glow: the camera follows this one
      id: r.id,
      name: short(r.title),
      color: `hsl(${hash(r.id) % 360} 55% 62%)`,
      cls: st === 'tool' ? TRADE[toolSpot(r.tool)] : STATE_LABEL[st],
      tactic: [r.id === followId && 'Following', st === 'tool' && r.tool].filter(Boolean).join(' · '),
    })))
  }

  // the follow chooser, bottom-centre: Lumina's title chooser (TitleScreen._renderChooser, private
  // there; its layout here as is) — ◀ the followed chat ▶ on the plate, the ← → hint under it
  let followId = null
  let chooserEl = null, chooserKey = ''
  function cycle(dir) {
    const ids = [null, ...awake(performance.now(), true).filter(x => npcs[x.r.slot]?.present).map(x => x.r.id)]
    followId = ids[(ids.indexOf(followId) + dir + ids.length) % ids.length]
    framesAt = 0
  }
  function renderChooser(now) {
    const r = followId && residents.find(x => x.id === followId)
    const label = r ? short(r.title) : 'Free camera'
    const n = awake(now).length
    const hint = r ? 'Next villager · drag lets go' : 'Follow a villager'
    if (chooserKey === `${label}|${n}|${hint}`) return
    chooserKey = `${label}|${n}|${hint}`
    chooserEl?.remove()
    const k = pal()
    const gn = 2 * Math.ceil(grow('name') / 2)
    const pw = Math.max(170, measure(caps(label), 'small', 1) + 50)
    const x0 = 320 - Math.floor(pw / 2)
    const y = 360 - 14 - (16 + gn + 22) + gn / 2
    const g = group(ui.hud.element, 'bc', x0, y - gn / 2, pw, 16 + gn + 22, 'vl-follow')
    const lab = box(g, x0, y - gn / 2, pw, 16 + gn)
    put(lab, plate(pw, 16 + gn), x0, y - gn / 2)
    txc(lab, caps(label), 320, y + 8, { ...TITLE, color: k.kw, align: 'center' }) // bright gold
    for (const [dir, gx] of [[-1, x0 + 6], [1, x0 + pw - 11]]) {
      const a = box(g, gx - 5, y - gn / 2, 15, 16 + gn)
      a.setAttribute('role', 'button')
      a.setAttribute('aria-label', dir < 0 ? 'Previous villager' : 'Next villager')
      a.style.cssText += ';pointer-events:auto;cursor:pointer'
      a.addEventListener('click', () => cycle(dir))
      put(a, n ? glyph(dir < 0 ? 'left' : 'right') : dimGlyph(dir < 0 ? 'left' : 'right'), gx, y + 5)
    }
    const hy = y + 16 + gn / 2 + 6
    keyHints(box(g, x0, hy, pw, 11), [{ keys: ['←', '→'], label: hint }], 320, hy, { align: 'center', color: k.tx2, ol: true })
    chooserEl = g
  }
  const onKey = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (e.target.closest?.('input, textarea, [contenteditable]') || !container.isConnected) return
    e.preventDefault()
    cycle(e.key === 'ArrowLeft' ? -1 : 1)
  }
  window.addEventListener('keydown', onKey)
  // the camera glides after the followed villager; it lets go when that one leaves
  function follow(dt) {
    if (!followId) return
    const r = residents.find(x => x.id === followId)
    if (!r?.live) { followId = null; framesAt = 0; return } // the chat closed or went to sleep
    const npc = npcs[r.slot]
    if (!npc?.present) return // indoors: the camera waits at the door
    const p = focus.position, t = 1 - Math.exp(-6 * dt)
    p.x += (npc.position.x - p.x) * t
    p.z += (npc.position.z - p.z) * t
    p.y = tileMap.getHeight(p.x, p.z) + 1
  }
  const regions = level.objects.filter(o => o.type === 'region')
  const levelMap = renderLevelMap(level)
  ui.minimap.setMap(levelMap, { view: 34, level })
  ui.worldMap.setMap(levelMap, { title: level.name, subtitle: level.subtitle ?? '', regions })
  const mapState = { player: focus.position, facing: new THREE.Vector3(0, 0, 1), view: { x: 0, z: -1 }, npcs: [], markers: world.mapMarkers() }
  let region = null
  let liveClock = hour == null
  ui.fontsReady.then(() => {
    ui.fontsReady.done = true
    ui.hud.setControls(CONTROLS)
    ui.hud.setLocation(level.name, level.subtitle ?? '')
    ui.hud.showHelp(true)
    if (!bannersShown.has(level.name)) ui.banner.show(level.name, level.subtitle ?? '', { duration: 3.2 })
    bannersShown.add(level.name)
  })
  function updateUi(dt) {
    const input = engine.input
    if (input.actionPressed('help')) ui.hud.toggleHelp()
    if (input.actionPressed('map')) (ui.worldMap.isOpen ? ui.worldMap.close() : ui.worldMap.open())
    else if (ui.worldMap.isOpen && input.actionPressed('cancel')) ui.worldMap.close()
    if (input.actionPressed('time')) { liveClock = false; ui.hud.toast(phaseName(weather.cycleTime().id), 1.6) }
    if (input.actionPressed('weather')) ui.hud.toast(`Weather: ${weather.cycleWeather()}`, 1.6)
    if (input.actionPressed('season')) onSeason?.()
    ui.hud.setTime(lighting.timeOfDay)
    // the place under the camera (Game._updateRegion: first matching region wins)
    const p = focus.position
    const r = regions.find(g => p.x >= g.minX && p.x < g.maxX && p.z >= g.minZ && p.z < g.maxZ && (g.minY == null || p.y > g.minY))
    if (r && r.name !== region) {
      region = r.name
      ui.hud.setLocation(r.name, r.sub || level.name)
      if (!bannersShown.has(r.name)) { bannersShown.add(r.name); ui.banner.show(r.name, r.sub || '', { duration: 2.6 }) }
    }
    const e = camera.matrixWorld.elements
    const len = Math.hypot(e[8], e[10]) || 1
    mapState.view.x = -e[8] / len
    mapState.view.z = -e[10] / len
    mapState.facing.set(mapState.view.x, 0, mapState.view.z)
    mapState.npcs = npcs.filter(n => n.present).map(n => n.position)
    ui.minimap.update(mapState)
    if (ui.worldMap.isOpen) ui.worldMap.update(dt, mapState)
  }

  const away = new THREE.Vector3(-1e4, 0, -1e4) // no player: nobody yields to one
  const npcCtx = { player: away, chickens: critters.chickens, game: null }
  const critterCtx = { player: away, threats: [away] }
  const view = { focus: rig.focusPoint, camera }
  let onTick = null
  let onSeason = null
  engine.input.bindings.season = ['KeyY']

  engine.addSystem(lighting, -10)
  engine.addSystem({
    name: 'village',
    update(dt) {
      if (liveClock) lighting.timeOfDay = clockHour(null)
      updateUi(dt)
      onTick?.(dt)
      drive(dt, performance.now())
      follow(dt)
      for (const n of npcs) n.update(dt, npcCtx)
      critters.update(dt, critterCtx)
      const night = (lighting.nightFactor ?? 0) > 0.5
      for (const c of wild) if (c.kind === 'bat') c.sprite.visible = night
      rig.update(dt, engine.input)
      // the sharp band scales with the zoom (Game tunes focusRange 6 for distance 30)
      S.dof.focusRange = 6 * rig.distance / 30
      spriteManager.update(dt)
      const dust = world.emitters.dust
      if (dust) dust.position.set(rig.focusPoint.x, rig.focusPoint.y + 1.2, rig.focusPoint.z - 2)
      weather.zoomFog = Math.min(1, Math.max(0.4, ((cam.distance - 7) / Math.max(1, rig.distance - 7)) ** 2))
      weather.update(dt)
      world.update(dt, view)
      godRays.update(dt)
      particles.update(dt, camera)
    }
  }, 0)
  engine.events.on('lateUpdate', dt => ui.update(dt, { camera, input: engine.input }))
  engine.setRenderFn(dt => {
    postfx.setFocus(rig.focusDistance)
    postfx.render(dt)
  })

  // residents (village.js) → their npcs: walk the route there, then Lumina's own wander at the spot.
  // Routes: Lumina's walk grid and A* (game/combat/Nav.js: houses, trees, cliffs, stairs, bridges)
  const nav = new Nav(tileMap, { maxExpand: 24000 })
  const navBuf = new Float32Array(256)
  const route = (x, z, to) => {
    const n = nav.findPath(x, z, to[0], to[1], 400, navBuf)
    if (n < 0) return [to] // no way: walk straight (the anti-stuck hop gets it there)
    const pts = []
    for (let i = 0; i < n; i++) pts.push([navBuf[2 * i], navBuf[2 * i + 1]])
    return pts
  }
  let residents = []
  const paths = new Map() // npc → remaining waypoints
  const shown = new Map() // npc → the emote over it

  // name plates over the workplaces (level houses named other than 'Home …'): the Lumina editor's
  // region label (src/editor/viewport3d/Labels.js `.lvp3d-label.region`, its CSS as is), the
  // name and what the place is for
  const plateCss = document.createElement('style')
  plateCss.textContent = PLATE_CSS
  container.append(plateCss)
  const plates = level.objects.filter(o => o.type === 'house' && o.name && !o.name.startsWith('Home')).map(o => {
    const el = document.createElement('div')
    el.className = 'lvp3d-label region'
    el.textContent = o.name
    const sub = document.createElement('small')
    sub.textContent = PLATE_SUB[o.name] ?? ''
    el.append(sub)
    container.append(el)
    const h = tileMap.getHeight(o.x, o.z) + (o.opts?.stories ?? 1) * 2.4 + 2.2
    return { el, at: new THREE.Vector3(o.x, h, o.z) }
  })
  // the hover hint over a villager: the same plate, its chat's title and what it is doing
  const WHAT = { blocked: 'waiting for you', failed: 'error', thinking: 'thinking', idle: 'idle', asleep: 'asleep' }
  const tip = { el: document.createElement('div'), at: new THREE.Vector3(), text: '' }
  tip.el.className = 'lvp3d-label region'
  tip.el.style.zIndex = 1
  container.append(tip.el)
  let hovered = null
  const skullArt = icon('skull', { scale: 2 }).toDataURL()
  const skulls = npcs.map(npc => {
    const el = Object.assign(document.createElement('img'), { src: skullArt, alt: '' })
    el.style.cssText = 'position:absolute;transform:translate(-50%,-100%);image-rendering:pixelated;width:28px;pointer-events:none;filter:drop-shadow(0 2px 2px rgba(0,0,0,.5))'
    container.append(el)
    return (npc.skull = { el, at: new THREE.Vector3(), on: false, npc })
  })
  const pv = new THREE.Vector3()
  function placePlates() {
    const npc = hovered && npcs[hovered.slot]
    tip.on = !!npc?.present
    if (tip.on) {
      const sub = [TRADE[hovered.spot], hovered.tool ?? WHAT[state(hovered, performance.now())]].filter(Boolean).join(' · ')
      if (tip.text !== hovered.title + sub) {
        tip.text = hovered.title + sub
        tip.el.textContent = hovered.title
        tip.el.append(Object.assign(document.createElement('small'), { textContent: sub }))
      }
      tip.at.copy(npc.position).setY(npc.position.y + (shown.get(npc) ? 3.4 : 2.2)) // above its emote, if any
    }
    for (const k of skulls) if (k.on) k.at.copy(k.npc.position).setY(k.npc.position.y + 2.4)
    for (const p of [...plates, tip, ...skulls]) {
      pv.copy(p.at).project(camera)
      const on = p.on !== false && pv.z < 1 && Math.abs(pv.x) < 1.1 && Math.abs(pv.y) < 1.1
      p.el.style.display = on ? '' : 'none'
      if (on) { p.el.style.left = `${(pv.x + 1) * 50}%`; p.el.style.top = `${(1 - pv.y) * 50}%` }
    }
  }
  // the lamps the residents switch: each home's window light (House `windowLights`), the forge's
  // sparks (only while a smith works there)
  const near = (p, x, z, d) => Math.hypot(p.x - x, p.z - z) < d
  const pool = world.lightPool
  for (const npc of npcs) {
    npc.lamp = pool.descriptors.find(d => d.flicker === 0.1 && d.intensity === 3 && near(d.position, ...npc.door, 1.6)) ?? null
    pool.setHidden(npc.lamp, true, { instant: true })
  }
  const sparks = world.areaEmitters.find(a => a.preset === 'embers')?.emitter // the forge's (level emitter)
  function drive(dt, now) {
    const bound = new Set()
    let smithing = false
    for (const r of residents) {
      const npc = npcs[r.slot]
      if (!npc) continue
      bound.add(npc)
      const st = state(r, now)
      // asleep at home: the window lit (at night: LightPool's nightOnly) and 'zzz' over the roof
      const sleeping = st === 'asleep' && !npc.present
      pool.setHidden(npc.lamp, !sleeping)
      if (npc.roof && sleeping !== !!npc.zzz) { if (sleeping) emotes.show(npc.roof, 'zzz', Infinity, { offsetY: 1.2 }); else emotes.clear(npc.roof); npc.zzz = sleeping }
      if (r.spot === 'forge' && r.arrivedAt && !paths.has(npc) && st.startsWith('tool')) smithing = true
      if (decide(r, now)) {
        const to = r.spot === 'home' ? npc.door : SPOTS[r.spot].at[r.point]
        if (!npc.present) { npc.placeAt(...npc.door); npc.setPresent(true) }
        npc.direct()
        paths.set(npc, route(npc.position.x, npc.position.z, to))
      }
      const path = paths.get(npc)
      if (path?.length) {
        const [x, z] = path[0]
        const left = path.reduce((d, p, i) => d + Math.hypot(p[0] - (i ? path[i - 1][0] : npc.position.x), p[1] - (i ? path[i - 1][1] : npc.position.z)), 0)
        npc.walkStep(dt, x, z, left > 10)
        // ponytail: villagers that block each other just hop to the waypoint after 2 s
        if (Math.hypot(x - npc.position.x, z - npc.position.z) < 0.15 || npc._stuck > 2) {
          if (npc._stuck > 2) npc.placeAt(x, z)
          npc._stuck = 0
          path.shift()
          if (!path.length) {
            paths.delete(npc)
            r.arrivedAt = now
            npc.stopWalk()
            if (r.spot === 'home' && !r.live) npc.setPresent(false)
            else { npc.setHome(x, z); npc.wander = SPOTS[r.spot].wander; npc.release() }
          }
        }
      } else if (r.spot === 'home' && !r.live && npc.present && !paths.has(npc)) npc.setPresent(false)
    }
    for (const npc of npcs) if (!bound.has(npc)) {
      if (npc.present) { paths.delete(npc); npc.setPresent(false) }
      pool.setHidden(npc.lamp, true)
      if (npc.zzz) { emotes.clear(npc.roof); npc.zzz = false }
    }
    if (sparks) sparks.intensity = smithing ? 1 : 0 // (not `enabled`: World's particle cull owns it)
    placePlates()
    updateFrames(now)
    if (ui.fontsReady.done) renderChooser(now)
    const sk = THREE.MathUtils.lerp(1, 0.5, lighting.nightFactor ?? 0)
    for (const n of npcs) n.silhouette.material.color.copy(SILHOUETTE).multiplyScalar(sk)
    // a new chat moved in: Lumina's quest toast (the first roster is the village as found, no toasts)
    if (residents.length) {
      const first = !known.size
      for (const r of residents) {
        if (known.has(r.id)) continue
        if (!first && r.live) titleToast(`New villager: ${r.title}`, 4, 'quest')
        known.add(r.id)
      }
    }
    // emote bubbles over heads
    for (const npc of npcs) {
      const r = residents.find(x => npcs[x.slot] === npc)
      const want = (npc.present && r && EMOTE[state(r, now)]) || null
      npc.skull.on = want === 'skull'
      if (want === (shown.get(npc) ?? null)) continue
      if (want && want !== 'skull') emotes.show(npc.sprite, want, Infinity)
      else emotes.clear(npc.sprite)
      shown.set(npc, want)
    }
  }

  // drag / two-finger scroll = pan the focus; pinch (or ⌥ / ctrl + wheel) = zoom; Q/E = turn (rig)
  const el = renderer.domElement
  // grab-pan: the ground point under the pointer stays under it (any yaw, pitch, zoom)
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const hitA = new THREE.Vector3(), hitB = new THREE.Vector3()
  const groundAt = (cx, cy, out) => {
    const r = el.getBoundingClientRect()
    ndc.set((cx - r.left) / r.width * 2 - 1, 1 - (cy - r.top) / r.height * 2)
    ray.setFromCamera(ndc, camera)
    return ray.ray.intersectPlane(ground, out)
  }
  const pan = (x0, y0, x1, y1) => {
    if (followId) { followId = null; framesAt = 0 } // moving the camera lets go
    ground.constant = -(focus.position.y - 1)
    if (!groundAt(x0, y0, hitA) || !groundAt(x1, y1, hitB)) return
    const b = rig.bounds
    const p = focus.position
    p.x = THREE.MathUtils.clamp(p.x + hitA.x - hitB.x, b.minX, b.maxX)
    p.z = THREE.MathUtils.clamp(p.z + hitA.z - hitB.z, b.minZ, b.maxZ)
    p.y = tileMap.getHeight(p.x, p.z) + 1
  }
  // a villager under the pointer (screen distance to its body; nearest within 28 px)
  const scr = new THREE.Vector3()
  const residentAt = (cx, cy) => {
    const rc = el.getBoundingClientRect()
    let best = null, bd = 28
    for (const r of residents) {
      const npc = npcs[r.slot]
      if (!npc?.present) continue
      scr.copy(npc.position).setY(npc.position.y + 0.9).project(camera)
      const d = Math.hypot(rc.left + (scr.x + 1) / 2 * rc.width - cx, rc.top + (1 - scr.y) / 2 * rc.height - cy)
      if (scr.z < 1 && d < bd) { bd = d; best = r }
    }
    return best
  }
  let drag = null
  let onOpen = null
  const onDown = e => { drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY }; el.setPointerCapture(e.pointerId) }
  const onMove = e => {
    if (!drag) {
      // hover: the chat's title and what it is doing (the native tooltip)
      const r = residentAt(e.clientX, e.clientY)
      hovered = r
      el.style.cursor = r && onOpen ? 'pointer' : ''
      return
    }
    pan(drag.x, drag.y, e.clientX, e.clientY)
    drag.x = e.clientX
    drag.y = e.clientY
  }
  const onUp = e => {
    // a click (not a drag) on a villager opens its chat
    if (drag && onOpen && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) {
      const r = residentAt(e.clientX, e.clientY)
      if (r) onOpen(r)
    }
    drag = null
  }
  const onWheel = e => {
    e.preventDefault()
    if (e.ctrlKey || e.altKey) rig.distanceTarget = THREE.MathUtils.clamp(rig.distanceTarget * Math.exp(e.deltaY * 0.01), rig.minDistance, rig.maxDistance)
    else pan(e.clientX, e.clientY, e.clientX - e.deltaX, e.clientY - e.deltaY) // scroll = drag the other way
  }
  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  const onLeave = () => { hovered = null }
  el.addEventListener('pointerleave', onLeave)
  el.addEventListener('wheel', onWheel, { passive: false })

  // pause while hidden
  const io = new IntersectionObserver(([e]) => (e.isIntersecting && !document.hidden ? engine.start() : engine.stop()))
  io.observe(container)

  // warm-up (Game.init): compile for PostFX's scene target, shadow programs
  rig.snap()
  const prev = renderer.getRenderTarget()
  renderer.setRenderTarget(postfx.sceneTarget)
  await renderer.compileAsync(scene, camera)
  renderer.setRenderTarget(prev)
  postfx.warmup()
  const primer = primeShadowPrograms(scene, { lights: [lighting.sun] })
  scene.add(primer.object)
  setTimeout(() => primer.dispose(), 1500)
  if (env.weather && env.weather !== 'clear') weather.setWeather(env.weather, { instant: true })
  engine.start()

  return {
    level, npcs, tileMap, rig, focus, engine, lighting, postfx, world, nav,
    set onTick(fn) { onTick = fn },
    /** village.js residents (the array is read every frame; mutate it or set a new one) */
    set residents(list) { residents = list },
    /** click on a villager → fn(resident) */
    set onOpen(fn) { onOpen = fn },
    set onSeason(fn) { onSeason = fn },
    ui,
    setHour(h) { liveClock = h == null; lighting.timeOfDay = clockHour(h) },
    dispose() {
      io.disconnect()
      emotes.dispose()
      frames.dispose()
      window.removeEventListener('keydown', onKey)
      for (const p of plates) p.el.remove()
      plateCss.remove()
      ui.dispose()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('wheel', onWheel)
      engine.stop()
      world.dispose?.()
      postfx.dispose?.()
      engine.dispose?.()
    }
  }
}

/**
 * The village in `container`, dressed for a season (default: the calendar's). Y fades to black,
 * rebuilds it for the next season (the camera kept) and fades back under the season's banner.
 * ponytail: a full rebuild (~1–2 s behind the black); textures are baked into merged meshes.
 */
export async function createViewer(container, rawLevel, { hour = null, season = seasonOn(new Date()) } = {}) {
  const fader = new Fader(container)
  fader.element.style.zIndex = 100 // over Lumina's UI root (50)
  let v = null, residents = [], onOpen = null, onTick = null, busy = false, gone = false
  // across rebuilds: a season change is no arrival (banners) and brings no new villagers (toasts)
  const bannersShown = new Set(), known = new Set()
  async function show() {
    const nv = await mount(container, seasonal(rawLevel, season), { hour, bannersShown, known })
    if (gone) return nv.dispose()
    Object.assign(nv, { residents, onOpen: r => onOpen?.(r), onTick: dt => onTick?.(dt), onSeason: next })
    v = nv
  }
  async function next() {
    if (busy || !v) return
    busy = true
    season = SEASONS[(SEASONS.indexOf(season) + 1) % SEASONS.length]
    const { rig, focus } = v, cam = { yaw: rig.yawTarget, distance: rig.distanceTarget, at: focus.position.clone() }
    try {
      await fader.fadeOut(0.8)
      v.dispose()
      v = null
      await show()
      if (!v) return
      v.rig.yaw = v.rig.yawTarget = cam.yaw
      v.rig.distance = v.rig.distanceTarget = cam.distance
      v.focus.position.copy(cam.at)
      v.rig.snap()
      v.ui.banner.show(...SEASON_BANNER[season], { duration: 4 })
      await fader.fadeIn(1.2)
    } catch (err) {
      console.error('[village] season change failed', err)
    } finally {
      busy = false
    }
  }
  await show()
  return {
    get current() { return v },
    get season() { return season },
    set residents(list) { residents = list; if (v) v.residents = list },
    set onOpen(fn) { onOpen = fn },
    set onTick(fn) { onTick = fn },
    setHour(h) { hour = h; v?.setHour(h) },
    nextSeason: next,
    dispose() {
      gone = true
      v?.dispose()
      v = null
      fader.dispose()
    },
  }
}

function clockHour(h) {
  if (h != null) return ((h % 24) + 24) % 24
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60
}
