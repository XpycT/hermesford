/**
 * EvermereAudio — The Bells of Evermere's audio (docs/contracts/EVERMERE_CAMPAIGN.md §6.8), the part
 * of the AudioSystem only that campaign uses, and the one door to it: AudioSystem.js imports this
 * module with a dynamic `import()` the first time an Evermere track, sound or ambience layer is
 * asked for (`loadEv`), so every other level — and Vanquish — never fetches it; the names
 * (`EV_MUSIC_TRACKS`, `EV_SFX_NAMES`, `EV_AMBIENCE_LAYERS`, the sections and role sections) stay in
 * AudioSystem.js, synchronous. Every function here takes the AudioSystem (`a`) it plays on; the
 * rendered buffers belong to no context and are shared by every AudioSystem. QA: sandbox/ev_audio.html.
 *
 * It plays on the score kit Vanquish's music built — vanquish/ScoreKit.js, ScoreVoices.js,
 * RenderKit.js and MusicRenders.js, which the build puts in a chunk of their own shared by the two
 * packs: Evermere downloads none of Vanquish's scores or recipes (vanquish/Scores.js and
 * VanquishAudio.js), Vanquish none of this module or evermere/. Here:
 *   - the music: its nine tracks (evermere/Scores.js) through the kit's lane (`primeMusic`,
 *     `musicReady`, `retainMusic` — handed this pack's `scoreTrack`), the bells registered with the
 *     kit's renders (evermere/Bells.js `registerBells`: a module side effect, the first time it is
 *     imported);
 *   - the 36 sounds (`EV_SFX_NAMES`: the contract's 28 and the integration round's eight —
 *     `stagBellow`, `motif`, `bellTollFar`, `hushSeal`, `wolfSnarl`, `frostBreath`, `shardSpit`,
 *     `cantorHush`) and the ambience's voices (evermere/Sounds.js), rendered by the kit's queue
 *     (RenderKit.js `loadRender`) and played two nodes each through the combat panner banks;
 *   - the layers `surf` (a rendered loop of waves and the gulls), `howl` (a winter wind, live) and
 *     `icebed` (the ice's creaks, pings and crackles — with `params.melt` the thaw's drips and quick
 *     crackles, panned to `params.pan`), and the crows over the fields (`params.crows`), each on its
 *     own RNG (`a._evrng`): the shared one's sequence and Vanquish's stay as they were.
 */
import { clamp, mulberry32, smoothstep } from '../utils/math.js';
import { ownValue } from '../utils/own.js';
import { thawField } from '../world/ThawField.js';
import { globalUniforms } from '../render/GlobalUniforms.js';
import { EV_SFX_NAMES } from './AudioSystem.js';
import { VQ_CACHE, cacheEntry, hashName, loadRender, nextTurn } from './vanquish/RenderKit.js';
import { warmVoices } from './vanquish/ScoreVoices.js';
import * as MR from './vanquish/MusicRenders.js';
import { scoreTrack as buildTrack } from './evermere/Scores.js';
import { registerBells } from './evermere/Bells.js';
import { EV_SOUNDS, EV_VOICES } from './evermere/Sounds.js';

/**
 * @import { AudioSystem } from './AudioSystem.js'
 */

export { scoreBuses, scoreVoice } from './vanquish/ScoreVoices.js';
export { EV_SCORE_TRACKS, MOOD } from './evermere/Scores.js';
export { EV_SOUNDS, EV_VOICES, BELL_PITCH, CHIME_PITCH } from './evermere/Sounds.js';

// the bells play as the kit's rendered instruments (once, when this pack arrives)
registerBells(MR.registerRendered);

/**
 * A track built from its seed (evermere/Scores.js `scoreTrack`; AudioSystem `_combatTrack`, the
 * kit's lane), a region's track — one with a `frozen` section — starting where the level stands:
 * its `start` read live, `frozen` while the level is frozen (the thaw field), else its season's.
 * Null for another name.
 * @param {string} name
 */
export function scoreTrack(name) {
  const tr = buildTrack(name);
  if (tr?.sections.frozen) Object.defineProperty(tr, 'start', { get: () => (thawField.frozen ? 'frozen' : tr.score.start), enumerable: true });
  return tr;
}

// ---------------------------------------------------------------------------------------------
// The music: the kit's lane, handed this pack's scores
// ---------------------------------------------------------------------------------------------

/**
 * Render every buffer a score track plays, ahead of its first note (AudioSystem `primeMusic`), then
 * — for a live AudioSystem — warm it for its context (as VanquishAudio.js does). Never rejects.
 * @param {string} track
 * @param {AudioSystem} [a]
 * @returns {Promise<{ ok: boolean, failed: string[] }>}
 */
export function primeMusic(track, a) {
  const p = MR.primeMusic(track, scoreTrack);
  if (!a || a._offline) return p;
  return p.then((r) => (r.failed.includes(track) ? r : warmMusic(a, track).then(() => r)));
}

/** @type {WeakMap<object, Map<string, Promise<void>>>} the warms done or going on: by context (by AudioSystem before it has one), by track */
const WARMS = new WeakMap();

/**
 * Warm a primed track for the AudioSystem `a` (ScoreVoices.js `warmVoices`, in pieces between page
 * turns): once per context and track. Never rejects.
 * @param {AudioSystem} a
 * @param {string} track
 * @returns {Promise<void>}
 */
function warmMusic(a, track) {
  const by = a.ctx ?? a;
  let byTrack = WARMS.get(by);
  if (!byTrack) WARMS.set(by, (byTrack = new Map()));
  let p = byTrack.get(track);
  if (!p) {
    p = Promise.resolve()
      .then(() => (a._disposed ? undefined : warmVoices(a.ctx, track, /** @type {any} */ (a._combatTrack(track)), mulberry32(hashName(track)), nextTurn, MR.noteBlock, (midi) => {
        if (a.ctx && !a._disposed) a._harpBuffer(midi);
      })))
      .catch((err) => console.error(`[AudioSystem] warming the music of "${track}" failed:`, err));
    byTrack.set(track, p);
  }
  return p;
}

/**
 * Whether every buffer of a track is rendered (AudioSystem `musicReady`).
 * @param {string} track
 */
export function musicReady(track) {
  return MR.musicReady(track, scoreTrack);
}

/**
 * Keep the rendered music of `tracks` for `owner` — this pack's tracks; what the owner keeps of
 * Vanquish's is left to it (AudioSystem `retainMusic`).
 * @param {'level'|'next'|'story'} owner
 * @param {readonly string[]} tracks
 */
export function retainMusic(owner, tracks) {
  MR.retainMusic(owner, tracks, scoreTrack);
}

/**
 * Every render key a track's sections can play (QA: the key parity, the bytes a track keeps).
 * @param {string} track
 */
export function musicKeys(track) {
  return MR.musicKeys(track, scoreTrack);
}

/** The music renders' statistics (shared by both packs: the kit's lane). */
export function musicRenders() {
  return MR.musicRenders();
}

// ---------------------------------------------------------------------------------------------
// The sounds and the ambience's voices
// ---------------------------------------------------------------------------------------------

/** The definition of an Evermere sound or voice (null for another name). */
function evDef(name) {
  return ownValue(EV_SOUNDS, name) ?? ownValue(EV_VOICES, name) ?? null;
}

/** The render entry of a sound or voice (the kit's sound cache, `VQ_CACHE`). */
function evEntry(name) {
  return cacheEntry(name, evDef(name).variants ?? 1);
}

/**
 * Variant `v` of an Evermere sound or voice as an AudioBuffer: rendered once (its `deps` first),
 * queued behind the renders asked for before (RenderKit.js `loadRender`).
 * @param {string} name @param {number} v
 * @returns {Promise<AudioBuffer>}
 */
function evLoad(name, v) {
  return loadRender(name, v, evDef);
}

/** This pack's RNG on an AudioSystem (variants, jitter, the layers' scheduling): its own seed. */
const rngOf = (a) => (a._evrng ??= mulberry32(0xe7a11));

/**
 * One Evermere sound (AudioSystem `playSfx`): a variant's buffer through its gain into the combat
 * panner bank (two nodes); a re-trigger within its recipe's `gap` is dropped. Its buffer not
 * rendered yet: it plays when the render arrives if that is within 0.4 s of its time, else it is
 * dropped.
 * @param {AudioSystem} a @param {string} name @param {number} t @param {number} v volume
 * @param {number} p pitch @param {number} pan
 */
export function playSfx(a, name, t, v, p, pan) {
  const def = EV_SOUNDS[name];
  const last = (a._evLast ??= Object.create(null));
  if (t - (last[name] ?? -Infinity) < (def.gap ?? 0.02)) return;
  last[name] = t;
  const r = rngOf(a);
  const n = def.variants ?? 1;
  const k = n > 1 ? Math.floor(r() * n) : 0;
  const j = 0.99 + r() * 0.02;
  const rate = p * (def.rate ?? 1) * (def.tuned ? 1 : j);
  const buf = evEntry(name).buffers[k];
  if (buf) play(a, buf, t, def.gain * v, rate, pan, !!def.wet);
  else {
    evLoad(name, k).then((b) => {
      if (a._disposed || !a.ctx) return;
      const now = a.ctx.currentTime;
      if (now - t <= 0.4) play(a, b, Math.max(t, now + 0.005), def.gain * v, rate, pan, !!def.wet);
    });
  }
}

/** A buffer at `t` through a gain into the combat panner bank. */
function play(a, buf, t, gain, rate, pan, wet) {
  const ctx = a.ctx;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(a._combatOut(pan, wet));
  src.start(t);
  a._cleanup(src, [src, g]);
}

/**
 * Render the buffers of `names` (default: every Evermere sound and the ambience's voices) — never
 * a Vanquish one (each pack primes its own) — resolving when they are all ready.
 * @param {readonly string[]} [names]
 * @returns {Promise<void>}
 */
export function primeSfx(names = [...Object.keys(EV_VOICES), ...EV_SFX_NAMES]) {
  /** @type {Promise<AudioBuffer>[]} */
  const all = [];
  for (const name of names) {
    const def = evDef(name);
    if (!def) continue;
    for (let v = 0; v < (def.variants ?? 1); v++) all.push(evLoad(name, v));
  }
  return Promise.all(all).then(() => {});
}

/**
 * Diagnostics of the sound renders (AudioSystem `vqRenders`: the kit's sound cache, both packs').
 * @returns {{ buffers: number, bytes: number, mainMs: number, maxBlockMs: number, slow: string[] }}
 */
export function renders() {
  let buffers = 0;
  for (const e of VQ_CACHE.entries.values()) buffers += e.buffers.filter(Boolean).length;
  return { buffers, bytes: VQ_CACHE.bytes, mainMs: VQ_CACHE.mainMs, maxBlockMs: VQ_CACHE.maxBlockMs, slow: [...VQ_CACHE.slow] };
}

/**
 * The rendered buffers of an Evermere sound or voice (null: not one) — diagnostics.
 * @param {string} name
 * @returns {(AudioBuffer|null)[]|null}
 */
export function buffersOf(name) {
  return evDef(name) ? evEntry(name).buffers : null;
}

// ---------------------------------------------------------------------------------------------
// The ambience: the surf, the howl, the ice's bed, the crows
// ---------------------------------------------------------------------------------------------

/** Per-layer loudness at level 1 (before the ambience bus; AudioSystem's `LAYER_GAIN` for the others). */
export const LAYER_GAIN = Object.freeze({ surf: 0.5, howl: 0.5, icebed: 0.6 });

/**
 * What the layers read besides their levels, set by `direct` (the game's AudioDirector on a level of
 * this campaign): `melt` 0..1 — the thaw front at the camera: the ice's bed turns to drips and quick
 * crackles —, `pan` −1..1 where the front is, `crows` 0..1 — crows over the thawed fields.
 */
export const PARAMS = { melt: 0, pan: 0, crows: 0 };
/** How thawed the year is where the camera looks, eased in over 4 s (the season's beds fade in with it). */
let thawEase = 1;
/** When `direct` last ran (performance.now()). */
let lastDirect = 0;
/** The front's band in the thaw field: rings and directions sampled around the camera's focus. */
const RINGS = [3, 8, 14];
/** The front's nearest point (reused). */
const NEAR = { x: 0, z: 0 };
const DIRS = [...Array(8).keys()].map((k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);

/**
 * The frozen year's ambience and music on a level of The Bells of Evermere (one with a `frost` or a
 * `season`): the game's AudioDirector calls it after its own mix (`compute`), from the camera's
 * focus, a few times a second, and the layers take what it leaves in `L` — EVERMERE_CAMPAIGN.md
 * §6.8 and the thaw's sound:
 *   - frozen (the thaw field, `thawField.at` where the camera looks): no birds, no crickets, the
 *     iced water and the frozen falls silent; a winter howl; the ice's creaks, pings and crackles
 *     near the ice (a little everywhere);
 *   - the front passing (its band in the field around the focus): the ice's bed turns to drips and
 *     quick crackles (`PARAMS.melt`), panned to where the front is (`PARAMS.pan`: its nearest point,
 *     `thawField.nearest`, else the band's samples — on the screen's axis, the camera's yaw);
 *   - the water: silent while iced — where the camera looks (`1 - at` at the nearest water) and
 *     while the level's water has not broken (`thawField.ice`, the thaw's own clock of it);
 *   - thawed: the season's bed fading in over 4 s — the birds (spring; a dawn chorus before nine on
 *     a spring morning), the surf and its gulls (summer: the level's water is the sea), the wind in
 *     the wheat and the crows (autumn), the water flowing again;
 *   - the music: a region's track moves from its `frozen` section to its season's at the next bar
 *     when the front has reached the camera (and back, should the frost return).
 * @param {{ audio: AudioSystem, env?: () => any, focus?: { x: number, z: number }|null, waterXZ: Float32Array,
 *   falls: { x: number, z: number }[], lighting: { nightFactor: number, timeOfDay?: number }, weather: { factor: (w: string) => number } }} d
 *   the AudioDirector
 * @param {{ x: number, y: number, z: number }} listener
 * @param {Record<string, number>} L the mix it computed (changed in place)
 */
export function direct(d, listener, L) {
  const env = d.env?.() ?? {};
  const a = d.audio;
  const f = d.focus ?? listener;
  const now = performance.now();
  const dt = clamp((now - lastDirect) / 1000, 0, 1);
  lastDirect = now;
  const here = thawField.at(f.x, f.z);
  thawEase = here > thawEase ? Math.min(here, thawEase + dt / 4) : here;
  const cold = 1 - thawEase;
  const season = env.season;
  // the water: its nearest point, iced or flowing; the falls frozen or roaring
  let best = Infinity;
  let wx = 0;
  let wz = 0;
  const w = d.waterXZ;
  for (let k = 0; k < w.length; k += 2) {
    const dd = (w[k] - f.x) ** 2 + (w[k + 1] - f.z) ** 2;
    if (dd < best) {
      best = dd;
      wx = w[k];
      wz = w[k + 1];
    }
  }
  const dW = Math.sqrt(best);
  const iceW = w.length ? 1 - thawField.at(wx, wz) : 0;
  let dF = Infinity;
  let fall = null;
  for (const p of d.falls) {
    const dd = Math.hypot(p.x - f.x, p.z - f.z);
    if (dd < dF) {
      dF = dd;
      fall = p;
    }
  }
  const open = 1 - Math.max(iceW, thawField.ice);
  const river = (1 - smoothstep(1, 11, dW)) * 0.55 * open * (season === 'summer' ? 0.35 : 1);
  const roar = fall ? (1 - smoothstep(3, 20, dF)) * 0.95 * (env.frost?.falls ? thawField.at(fall.x, fall.z) : 1) : 0;
  L.water = clamp(Math.max(river, roar));
  L.surf = season === 'summer' ? clamp((1 - smoothstep(3, 32, dW)) * 0.85 * open) : 0;
  // the season's life under the frost
  L.birds *= thawEase;
  L.crickets *= thawEase;
  const hour = d.lighting.timeOfDay ?? 12;
  if (season === 'spring' && hour < 9) L.birds = Math.max(L.birds, 0.85 * thawEase * (1 - d.weather.factor('rain')));
  PARAMS.crows = season === 'autumn' ? 0.6 * thawEase : 0;
  if (season === 'autumn') L.wind = clamp(L.wind + 0.12 * thawEase);
  // the winter's howl and the ice's bed; the front passing: its melt, panned to it
  const storm = clamp(d.weather.factor('snow') + d.weather.factor('rain'));
  L.howl = clamp(Math.max(cold, season === 'winter' ? 0.55 : 0) * (0.34 + 0.2 * (listener.y > 3 ? 1 : 0) + 0.3 * storm));
  // (the band: where the field is between frozen and thawed; the pan toward the front's nearest
  // point, else the samples' direction weighted — along the screen's right, CameraRig's basis)
  const yaw = globalUniforms.uCameraYaw.value;
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  let melt = 0;
  let sum = 0;
  let side = 0;
  for (const r of RINGS) {
    for (const [cx, cz] of DIRS) {
      const t = thawField.at(f.x + cx * r, f.z + cz * r);
      const m = (1 - Math.abs(2 * t - 1)) * (1 - r / 20);
      melt = Math.max(melt, m);
      sum += m;
      side += m * (cx * rx + cz * rz);
    }
  }
  PARAMS.melt = melt;
  const near = thawField.nearest(f.x, f.z, NEAR);
  const dn = near ? Math.hypot(near.x - f.x, near.z - f.z) : 0;
  PARAMS.pan = near && dn > 0.5 ? clamp((((near.x - f.x) * rx + (near.z - f.z) * rz) / dn) * Math.min(1, dn / 6), -1, 1)
    : sum > 1e-6 ? clamp((side / sum) * 1.5, -1, 1) : 0;
  L.icebed = clamp(cold * (0.15 + 0.65 * (1 - smoothstep(2, 18, dW)) * Math.max(iceW, 0.3)) + melt * 0.8);
  // the music: a region's track resolves at the next bar once the front has reached the camera
  const s = a.musicSection;
  const want = thawField.frozen || here < 0.5 ? 'frozen' : 'A';
  if ((s === 'frozen' || (s === 'A' && a._music?.sections?.frozen)) && s !== want) a.setMusicSection(want);
}

/**
 * Build an Evermere layer (AudioSystem `_createLayer` hands its helpers: `add` keeps nodes for the
 * teardown, `src` a looped noise source, `lfo` a modulator):
 *   - surf: the rendered loop of breaking waves twice, a little apart in time and rate, drifting
 *     in level (a loop whose buffer is still rendering starts when it arrives); the gulls are
 *     scheduled (`scheduleLayers`);
 *   - howl: a winter wind — two resonant bands of brown noise moaning slowly (≈ 280 and 430 Hz),
 *     a whistle sweeping around 1.7 kHz, slow gusts;
 *   - icebed: a faint hiss of wind over the ice; its creaks, pings, crackles and drips are scheduled.
 * @param {AudioSystem} a @param {'surf'|'howl'|'icebed'} name @param {any} layer
 * @param {{ add: (...n: AudioNode[]) => any, src: (buffer: AudioBuffer, rate?: number, offset?: number) => AudioBufferSourceNode,
 *   lfo: (freq: number, depth: number, param: AudioParam, type?: OscillatorType) => OscillatorNode }} h
 */
export function buildLayer(a, name, layer, { add, src, lfo }) {
  const ctx = a.ctx;
  const gain = layer.gain;
  const r = rngOf(a);
  if (name === 'surf') {
    const bed = add(ctx.createGain());
    bed.gain.value = 0.85;
    bed.connect(gain);
    const offsets = [r(), r()];
    const loop = (b, k, late = false) => {
      if (late && (a._layers.surf !== layer || a._disposed)) return;
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      s.playbackRate.value = k ? 0.94 : 1;
      s.start(ctx.currentTime, offsets[k] * b.duration);
      const g = ctx.createGain();
      g.gain.value = k ? 0.6 : 1;
      s.connect(g).connect(bed);
      layer.sources.push(s);
      add(s, g);
    };
    const b = evEntry('surf').buffers[0];
    for (const k of [0, 1]) {
      if (b) loop(b, k);
      else evLoad('surf', 0).then((bb) => loop(bb, k, true));
    }
    lfo(0.05, 0.15, bed.gain);
    const calls = add(ctx.createGain());
    calls.connect(gain);
    layer.input = calls;
    layer.next = ctx.currentTime + 1 + r() * 2;
    return;
  }
  if (name === 'howl') {
    for (const [f, q, lev, sweep, rate] of [[280, 9, 0.9, 70, 0.06], [430, 11, 0.6, 110, 0.083]]) {
      const s = src(a._brown, 1, r() * 5);
      const bp = add(a._biquad('bandpass', f, q));
      const g = add(ctx.createGain());
      g.gain.value = lev;
      s.connect(bp).connect(g).connect(gain);
      lfo(rate, sweep, bp.frequency);
      lfo(rate * 1.7, lev * 0.45, g.gain);
    }
    const w = src(a._white, 1, r() * 1.5);
    const bp = add(a._biquad('bandpass', 1700, 14));
    const g = add(ctx.createGain());
    g.gain.value = 0.06;
    w.connect(bp).connect(g).connect(gain);
    lfo(0.07, 500, bp.frequency);
    lfo(0.11, 0.04, g.gain);
    lfo(0.13, 0.25, gain.gain);
    return;
  }
  // icebed
  const w = src(a._white, 1, r() * 1.5);
  const hp = add(a._biquad('highpass', 3500, 0.7));
  const g = add(ctx.createGain());
  g.gain.value = 0.012;
  w.connect(hp).connect(g).connect(gain);
  lfo(0.09, 0.006, g.gain);
  const ev = add(ctx.createGain());
  ev.connect(gain);
  layer.input = ev;
  layer.next = ctx.currentTime + 0.4 + r();
  layer.drip = ctx.currentTime + 0.2;
}

/**
 * Schedule the layers' events up to `ahead` (AudioSystem `_scheduleAmbience`; this pack's RNG): the
 * gulls over the surf (more with its level), the ice's creaks, pings and crackles (and with
 * `params.melt` the drips and quick crackles of the thaw, around `params.pan`), the crows calling
 * over the fields (`params.crows`) into the ambience bus.
 * @param {AudioSystem} a @param {Record<string, any>} L the live layers @param {number} now @param {number} ahead
 */
export function scheduleLayers(a, L, now, ahead) {
  const r = rngOf(a);
  const P = PARAMS;
  const surf = L.surf;
  if (surf && surf.level > 0.001) {
    if (surf.next < now) surf.next = now + 0.5 + r() * 2;
    while (surf.next < ahead) {
      voice(a, 'gullCry', Math.floor(r() * 2), surf.next, 0.12 + r() * 0.25, (r() - 0.5) * 1.6, 0.9 + r() * 0.25, surf.input);
      surf.next += 1.5 + (-Math.log(1 - r() * 0.999) * 5) / (0.4 + surf.level);
    }
  }
  const ice = L.icebed;
  if (ice && ice.level > 0.001) {
    const melt = clamp(P.melt);
    const pan = clamp(P.pan, -1, 1);
    if (ice.next < now) ice.next = now + r() * 0.5;
    while (ice.next < ahead) {
      const u = r();
      const at = (spread) => Math.max(-1, Math.min(1, pan * melt + (r() - 0.5) * spread));
      if (u < 0.12) voice(a, 'creak', Math.floor(r() * 3), ice.next, 0.18 + r() * 0.3, at(1.6), 0.85 + r() * 0.3, ice.input);
      else if (u < 0.3) voice(a, 'ping', Math.floor(r() * 3), ice.next, 0.08 + r() * 0.2, at(1.6), 0.8 + r() * 0.5, ice.input);
      else iceCrackle(a, ice.next, ice.input, 0.05 + r() * r() * 0.25 * (1 + melt), at(1.2));
      ice.next += -Math.log(1 - r() * 0.999) / (0.9 + 1.4 * ice.level + 9 * melt);
    }
    if (melt > 0.01) {
      if (ice.drip < now) ice.drip = now + r() * 0.2;
      while (ice.drip < ahead) {
        voice(a, 'drip', Math.floor(r() * 3), ice.drip, 0.13 + r() * 0.32, Math.max(-1, Math.min(1, pan + (r() - 0.5) * 0.9)), 0.8 + r() * 0.5, ice.input);
        ice.drip += -Math.log(1 - r() * 0.999) / (1 + 10 * melt);
      }
    }
  }
  const crows = clamp(P.crows);
  if (crows > 0.001) {
    let next = a._evCrows ?? now + 1 + r() * 3;
    if (next < now) next = now + r() * 2;
    while (next < ahead) {
      voice(a, 'crowCaw', Math.floor(r() * 3), next, 0.06 + r() * 0.12, (r() - 0.5) * 1.6, 0.9 + r() * 0.2, a._buses.amb);
      next += 2 + (-Math.log(1 - r() * 0.999) * 6) / (0.3 + crows);
    }
    a._evCrows = next;
  }
}

/**
 * A voice into a layer at `vol` (of its normalised buffer, not its SFX gain): its buffer, a gain, a
 * panner (three nodes); skipped while its buffer is still rendering (an ambience event, not a cue).
 */
function voice(a, name, v, t, vol, pan, rate, dest) {
  const buf = evEntry(name).buffers[v];
  if (!buf) {
    evLoad(name, v);
    return;
  }
  const ctx = a.ctx;
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = vol;
  const p = a._panner(pan, dest);
  s.connect(g).connect(p);
  s.start(t);
  a._cleanup(s, [s, g, p]);
}

/** One crackle of the ice: a sharp, bright tick (shorter and higher than a fire's). */
function iceCrackle(a, t, dest, amp, pan) {
  const ctx = a.ctx;
  const r = rngOf(a);
  const src = a._noiseSource(a._white, t, r() * 1.8);
  const hp = a._biquad('highpass', 2400 + r() * 3500, 0.9);
  const g = ctx.createGain();
  const dur = 0.002 + r() * 0.006;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amp, t + 0.0005);
  g.gain.setTargetAtTime(0, t + 0.0007, dur * 0.4);
  const p = a._panner(pan, dest);
  src.connect(hp).connect(g).connect(p);
  src.stop(t + dur * 3 + 0.05);
  a._cleanup(src, [src, hp, g, p]);
}
