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
import { Weather } from '../vendor/lumina/src/game/Weather.js'
import { installFogStart, setFogStart } from '../vendor/lumina/src/game/AtmosphereFog.js'
import { UI } from '../vendor/lumina/src/engine/ui/UI.js'
import { Emotes } from '../vendor/lumina/src/engine/ui/Emotes.js'
import { PartyFrames } from '../vendor/lumina/src/engine/ui/PartyFrames.js'
import { phaseName } from '../vendor/lumina/src/engine/ui/HUD.js'
import { renderLevelMap } from '../vendor/lumina/src/engine/level/LevelMap.js'
import { decide, route, state, toolSpot, hash, SPOTS } from './village.js'
import { CAMERA, SUN_PATH, MOON_PATH, KEYFRAME_OVERRIDES, SPRITE_FILL } from '../vendor/lumina/src/game/config.js'

const DEG = Math.PI / 180

/** The controls legend (Lumina's HUD, bottom-left): only what the village really does. */
const CONTROLS = [
  { id: 'pan', keys: 'Drag', label: 'Pan (or scroll)' },
  { id: 'camera', keys: 'Q/E', label: 'Rotate camera' },
  { id: 'zoom', keys: 'Z/X', label: 'Zoom (or pinch)' },
  { id: 'map', keys: 'N/Tab', label: 'World map' },
  { id: 'time', keys: 'T', label: 'Time of day' },
  { id: 'weather', keys: 'R', label: 'Weather' },
]
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
const EMOTE = { blocked: '!', failed: '#', thinking: '…' }

/**
 * @param {HTMLElement} container
 * @param {object} rawLevel luminati-level JSON
 * @param {{ hour?: number|null }} [opts] fixed hour (dev); default = the local clock
 */
export async function createViewer(container, rawLevel, { hour = null } = {}) {
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
  }
  const critters = new Critters({ tileMap, scene, spriteManager, groups: level.objects.filter(o => o.type === 'critters') })
  for (const s of [...npcs.map(n => n.sprite), ...critters.all.map(c => c.sprite)])
    lighting.registerEmissive(s.material, SPRITE_FILL)
  const weather = new Weather({ lighting, particles, postfx, godRays, world })
  lighting.followTarget(focus)

  // Lumina's UI: place plate + clock + minimap (top), controls legend (bottom-left), area banner,
  // world map, toasts, emote bubbles. English only: its pixel fonts have no Cyrillic.
  const ui = new UI(container, { lang: 'en' })
  const emotes = new Emotes(ui.root)
  // the villagers awake, top-left under the place plate (Lumina's party frames): who, doing what
  const frames = new PartyFrames(ui.root)
  let framesAt = 0
  function updateFrames(now) {
    if (now - framesAt < 250) return
    framesAt = now
    const list = residents.map(r => ({ r, st: state(r, now) })).filter(x => x.st !== 'asleep')
      .sort((a, b) => STATE_ORDER[a.st] - STATE_ORDER[b.st] || a.r.slot - b.r.slot).slice(0, MAX_FRAMES)
    frames.update(list.map(({ r, st }) => ({
      id: r.id,
      name: r.title.length > 22 ? r.title.slice(0, 21) + '…' : r.title,
      color: `hsl(${hash(r.id) % 360} 55% 62%)`,
      cls: st === 'tool' ? TRADE[toolSpot(r.tool)] : STATE_LABEL[st],
      tactic: st === 'tool' ? r.tool : '',
    })))
  }
  const regions = level.objects.filter(o => o.type === 'region')
  const levelMap = renderLevelMap(level)
  ui.minimap.setMap(levelMap, { view: 34, level })
  ui.worldMap.setMap(levelMap, { title: level.name, subtitle: level.subtitle ?? '', regions })
  const mapState = { player: focus.position, facing: new THREE.Vector3(0, 0, 1), view: { x: 0, z: -1 }, npcs: [], markers: world.mapMarkers() }
  let region = null
  const bannersShown = new Set()
  let liveClock = hour == null
  ui.fontsReady.then(() => {
    ui.hud.setControls(CONTROLS)
    ui.hud.setLocation(level.name, level.subtitle ?? '')
    ui.hud.showHelp(true)
    ui.banner.show(level.name, level.subtitle ?? '', { duration: 3.2 })
    bannersShown.add(level.name)
  })
  function updateUi(dt) {
    const input = engine.input
    if (input.actionPressed('help')) ui.hud.toggleHelp()
    if (input.actionPressed('map')) (ui.worldMap.isOpen ? ui.worldMap.close() : ui.worldMap.open())
    else if (ui.worldMap.isOpen && input.actionPressed('cancel')) ui.worldMap.close()
    if (input.actionPressed('time')) { liveClock = false; ui.hud.toast(phaseName(weather.cycleTime().id), 1.6) }
    if (input.actionPressed('weather')) ui.hud.toast(`Weather: ${weather.cycleWeather()}`, 1.6)
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

  engine.addSystem(lighting, -10)
  engine.addSystem({
    name: 'village',
    update(dt) {
      if (liveClock) lighting.timeOfDay = clockHour(null)
      updateUi(dt)
      onTick?.(dt)
      drive(dt, performance.now())
      for (const n of npcs) n.update(dt, npcCtx)
      critters.update(dt, critterCtx)
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

  // residents (village.js) → their npcs: walk the route there, then Lumina's own wander at the spot
  let residents = []
  const paths = new Map() // npc → remaining waypoints
  const shown = new Map() // npc → the emote over it

  // name plates over the workplaces (level houses named other than 'Home …'), in Lumina's type
  const plates = level.objects.filter(o => o.type === 'house' && o.name && !o.name.startsWith('Home')).map(o => {
    const el = document.createElement('div')
    el.textContent = o.name
    el.style.cssText = "position:absolute;pointer-events:none;transform:translate(-50%,-100%);white-space:nowrap;font:20px/1 'Jersey 15',monospace;letter-spacing:.5px;color:#f5e6bd;background:rgba(24,16,10,.78);border:1px solid #b8914c;padding:2px 7px 3px;text-shadow:0 1px 0 #000"
    container.append(el)
    const h = tileMap.getHeight(o.x, o.z) + (o.opts?.stories ?? 1) * 2.4 + 2.2
    return { el, at: new THREE.Vector3(o.x, h, o.z) }
  })
  const pv = new THREE.Vector3()
  function placePlates() {
    for (const p of plates) {
      pv.copy(p.at).project(camera)
      const on = pv.z < 1 && Math.abs(pv.x) < 1.1 && Math.abs(pv.y) < 1.1
      p.el.style.display = on ? '' : 'none'
      if (on) { p.el.style.left = `${(pv.x + 1) * 50}%`; p.el.style.top = `${(1 - pv.y) * 50}%` }
    }
  }
  function drive(dt, now) {
    const bound = new Set()
    for (const r of residents) {
      const npc = npcs[r.slot]
      if (!npc) continue
      bound.add(npc)
      if (decide(r, now)) {
        const to = r.spot === 'home' ? npc.door : SPOTS[r.spot].at[r.point]
        if (!npc.present) { npc.placeAt(...npc.door); npc.setPresent(true) }
        npc.direct()
        paths.set(npc, route([npc.position.x, npc.position.z], to))
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
    for (const npc of npcs) if (!bound.has(npc) && npc.present) { paths.delete(npc); npc.setPresent(false) }
    placePlates()
    updateFrames(now)
    const sk = THREE.MathUtils.lerp(1, 0.5, lighting.nightFactor ?? 0)
    for (const n of npcs) n.silhouette.material.color.copy(SILHOUETTE).multiplyScalar(sk)
    // emote bubbles over heads
    for (const npc of npcs) {
      const r = residents.find(x => npcs[x.slot] === npc)
      const want = (npc.present && r && EMOTE[state(r, now)]) || null
      if (want === (shown.get(npc) ?? null)) continue
      if (want) emotes.show(npc.sprite, want, Infinity)
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
  const WHAT = { blocked: 'waiting for you', failed: 'error', thinking: 'thinking', idle: 'idle', asleep: 'asleep' }
  let drag = null
  let onOpen = null
  const onDown = e => { drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY }; el.setPointerCapture(e.pointerId) }
  const onMove = e => {
    if (!drag) {
      // hover: the chat's title and what it is doing (the native tooltip)
      const r = residentAt(e.clientX, e.clientY)
      el.title = r ? `${r.title} — ${r.tool ?? WHAT[state(r, performance.now())]}` : ''
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
    level, npcs, tileMap, rig, focus, engine, lighting, postfx, world,
    set onTick(fn) { onTick = fn },
    /** village.js residents (the array is read every frame; mutate it or set a new one) */
    set residents(list) { residents = list },
    /** click on a villager → fn(resident) */
    set onOpen(fn) { onOpen = fn },
    ui,
    setHour(h) { liveClock = h == null; lighting.timeOfDay = clockHour(h) },
    dispose() {
      io.disconnect()
      emotes.dispose()
      frames.dispose()
      for (const p of plates) p.el.remove()
      ui.dispose()
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('wheel', onWheel)
      engine.stop()
      world.dispose?.()
      postfx.dispose?.()
      engine.dispose?.()
    }
  }
}

function clockHour(h) {
  if (h != null) return ((h % 24) + 24) % 24
  const d = new Date()
  return d.getHours() + d.getMinutes() / 60
}
