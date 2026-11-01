/**
 * VanquishAudio — Vanquish the Evil Dragon's audio (docs/contracts/DRAGON_CAMPAIGN.md §6.9), the
 * part of the AudioSystem that only the campaign uses, and the one door to it: AudioSystem.js
 * imports this module with a dynamic `import()` the first time a Vanquish track, sound or ambience
 * layer is asked for, so a level that uses none of them never fetches it; the names
 * (`MUSIC_TRACKS`, `VQ_SFX_NAMES`, `MUSIC_ROLE_SECTIONS`, `AMBIENCE_LAYERS`) stay in AudioSystem.js,
 * synchronous for the parser and the checks. Every function here takes the AudioSystem (`a`) it
 * plays on; the rendered buffers belong to no context and are shared by every AudioSystem.
 * QA: sandbox/vq_audio.html.
 *
 * Here: the recipes of its 31 sounds and of the crowd / blaze voices (rendered by vanquish/
 * RenderKit.js), playing them, and the crowd / blaze ambience layers. The music lives under
 * vanquish/, imported only from here (one way: nothing there imports this module or
 * AudioSystem.js), and is re-exported below for AudioSystem.js and the sandboxes:
 *   - ScoreKit.js: the scoring kit and the event contract (`ScoreEvent`, `SCORE_KINDS`);
 *   - Scores.js: the six tracks (`SCORE_TRACKS`, `scoreTrack`);
 *   - ScoreVoices.js: a track instance's buses and its live instruments (`scoreBuses`, `scoreVoice`;
 *     `warmVoices`, a track warmed when it is primed: `warmMusic` below);
 *   - RenderKit.js: the offline render kit (`Sketch`, `renderMusic`), the render cache and queue,
 *     the page turns every render yields to (`nextTurn`);
 *   - MusicRenders.js: the rendered instruments and the music's renders (`primeMusic`,
 *     `musicReady`, `retainMusic`, `musicRenders`; `musicKeys` for QA).
 */
import { ownValue } from '../utils/own.js';
import { mulberry32 } from '../utils/math.js';
import { VQ_SFX_NAMES } from './AudioSystem.js';
import { mtof } from './vanquish/ScoreKit.js';
import { scoreTrack } from './vanquish/Scores.js';
import { VQ_CACHE, cacheEntry, hashName, loadRender, nextTurn } from './vanquish/RenderKit.js';
import { warmVoices } from './vanquish/ScoreVoices.js';
import * as MR from './vanquish/MusicRenders.js';

/**
 * @import { AudioSystem } from './AudioSystem.js'
 * @import { VqSound } from './vanquish/RenderKit.js'
 */

// ---------------------------------------------------------------------------------------------
// The music (vanquish/): what AudioSystem.js and the sandboxes use of it
// ---------------------------------------------------------------------------------------------

export { SCORE_KINDS } from './vanquish/ScoreKit.js';
export { SCORE_TRACKS, scoreTrack } from './vanquish/Scores.js';
export { scoreBuses, scoreVoice } from './vanquish/ScoreVoices.js';

/**
 * A score track's definition (Scores.js `SCORE_TRACKS` entry; ScoreKit.js).
 * @typedef {import('./vanquish/ScoreKit.js').ScoreTrackDef} ScoreTrackDef
 */
/**
 * The music renders' statistics (AudioSystem `vqRenders.music`; MusicRenders.js).
 * @typedef {import('./vanquish/MusicRenders.js').MusicRenderStats} MusicRenderStats
 */

/**
 * Render every buffer a score track plays, ahead of its first note (AudioSystem `primeMusic`;
 * MusicRenders.js, handed Scores.js `scoreTrack`), then — for the AudioSystem `a` that asked, when
 * it plays live (not an offline render) — warm the track for it (`warmMusic`), so its first
 * `startMusic` finds its instruments built. Never rejects: `failed` names what could not be
 * rendered.
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
 * Warm a primed score track for the AudioSystem `a` (ScoreVoices.js `warmVoices`, in pieces between
 * page turns, each counted as the music's main-thread work: MusicRenders.js `noteBlock`): its
 * instruments built once on a throwaway context, its waves and its harp's first pitches made on
 * `a`'s context — once per context and track (per AudioSystem and track before its unlock: the
 * waves wait for the context). Never
 * rejects: a failure is logged, and the first start then does the work itself.
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
 * Whether every buffer of a score track is rendered (AudioSystem `musicReady`; MusicRenders.js).
 * @param {string} track
 * @returns {boolean}
 */
export function musicReady(track) {
  return MR.musicReady(track, scoreTrack);
}

/**
 * Keep the rendered music of `tracks` for `owner`, releasing what it kept before (AudioSystem
 * `retainMusic`; MusicRenders.js).
 * @param {'level'|'next'|'story'} owner
 * @param {readonly string[]} tracks
 */
export function retainMusic(owner, tracks) {
  MR.retainMusic(owner, tracks, scoreTrack);
}

/**
 * Every render key a score track's sections can play (MusicRenders.js `musicKeys`, handed Scores.js
 * `scoreTrack`): the set `primeMusic` renders. For QA (sandbox/vq_audio.js: the key parity, the
 * in-game music checks); null for a track that is not a score track.
 * @param {string} track
 * @returns {string[]|null}
 */
export function musicKeys(track) {
  return MR.musicKeys(track, scoreTrack);
}

/**
 * The music renders' statistics (AudioSystem `vqRenders.music`; MusicRenders.js).
 * @returns {MusicRenderStats}
 */
export function musicRenders() {
  return MR.musicRenders();
}

// ---------------------------------------------------------------------------------------------
// Vanquish the Evil Dragon's sound effects and ambience voices (DRAGON_CAMPAIGN.md §6.9): each a
// seeded synth rendered once into an AudioBuffer (RenderKit.js `Sketch`: the audio-rate work on the
// audio rendering thread; JS draws the control curves and finishes the result). One play costs
// two nodes: a buffer source and its gain, into the combat panner banks.
// ---------------------------------------------------------------------------------------------

/**
 * Vanquish's sounds (`VQ_SFX_NAMES`).
 * @type {Record<string, VqSound>}
 */
const VQ_SOUNDS = {
  // ---- the dragon --------------------------------------------------------------------------------
  // a huge roar: a rattling low growl through an "oar" throat, an open scream above it, breath, a
  // chest-deep thump; saturated, then the reverb
  roar: {
    len: 3.6, gain: 0.4, wet: true, sr: 16000,
    async render(s) {
      const e = s.shape([[0, 0], [0.16, 0.6], [0.5, 1], [1.4, 0.9], [2.3, 0.7], [3.0, 0.28], [3.45, 0]]);
      s.saturate(2.4, 6500, e);
      const f0 = s.curve([[0, 44], [0.22, 60], [0.85, 57], [2.1, 50], [3.1, 36]], true);
      const j1 = s.wobble(38);
      const j2 = s.wobble(23);
      const growl = s.osc('sawtooth', s.ctl((t, i) => f0[i] * (1 + 0.06 * j1[i])));
      const rattle = s.amp(s.rectify(s.osc('sine', s.curve([[0, 22], [1, 27], [3, 19]]))), 0.45);
      const g = s.formants(s.amp(growl, rattle, 0.55), [[s.curve([[0, 380], [0.5, 520], [3, 420]]), 4, 1], [900, 5, 0.7], [1900, 6, 0.35]]);
      const sc = s.formants(s.osc('sawtooth', s.ctl((t, i) => f0[i] * 3.9 * (1 + 0.1 * j2[i] + 0.04 * j1[i]))),
        [[s.curve([[0, 520], [0.4, 760], [2.4, 660], [3.2, 470]]), 5, 1], [s.curve([[0, 1000], [0.5, 1250], [3, 980]]), 6, 0.7], [2500, 7, 0.4]]);
      const br = s.filter(s.noiseSrc(), 'bandpass', s.curve([[0, 900], [0.6, 1500], [3, 1000]]), 0.8);
      // (the scream's share of the voice: it opens after the growl and closes before it)
      const es = s.curve([[0, 0.3], [0.25, 0.5], [0.6, 1], [2.0, 0.85], [2.8, 0.45], [3.3, 0.3]]);
      s.out(g, 1.3, 0, 'drive');
      s.out(s.amp(sc, es), 0.9, 0, 'drive');
      s.out(br, 0.05, 0, 'drive');
      s.thump(0.02, 72, 38, 0.45, 0.4, 0.45);
      s.thump(0.02, 144, 76, 0.45, 0.3, 0.2);
    },
  },
  // the roar far off, echoing from the mountains: dulled, two echoes, played a little slower
  roarFar: {
    len: 4.8, gain: 0.24, wet: true, rate: 0.92, sr: 12000, deps: ['roar'],
    async render(s, v, dep) {
      const play = (at) => {
        const b = s.ctx.createBufferSource();
        b.buffer = dep('roar');
        b.start(at);
        return b;
      };
      const a = (at, f) => s.filter(s.filter(play(at), 'lowpass', f, 0.7), 'lowpass', f, 0.7);
      s.out(a(0, 1100), 1);
      s.out(a(0.34, 600), 0.38);
      s.out(a(0.79, 420), 0.2);
    },
  },
  // a great wing-beat: a leathery downstroke whoosh, the air it pushes, the membrane's snap
  wingbeat: {
    len: 0.85, gain: 0.37, variants: 2, sr: 16000,
    async render(s, v) {
      const k = 1 + 0.09 * v;
      s.burst(0, 0.85, { f: [[0, 200 * k], [0.14, 540 * k], [0.42, 150 * k]], q: 0.9, attack: 0.12, tau: 0.13 });
      s.thump(0.04, 78, 40, 0.15, 0.12, 0.55);
      s.burst(0.16, 0.12, { f: 1800 * k, q: 1.5, tau: 0.012, amp: 0.35 });
      s.burst(0.205, 0.16, { f: 900 * k, q: 1.2, tau: 0.02, amp: 0.25 });
    },
  },
  // a fireball falling from the sky (≈ 1.3 s: its end is the impact — `explosion`): a falling
  // whistle and a roaring, crackling crescendo
  fireballFall: {
    len: 1.4, gain: 0.21,
    async render(s) {
      const T = 1.3;
      const f = s.curve([[0, 2300], [T, 640]], true);
      const vib = s.lfo(7.5);
      const ew = s.shape([[0, 0], [0.3, 0.2], [T, 1], [T + 0.04, 0]]);
      s.out(s.amp(s.osc('sine', s.ctl((t, i) => f[i] * (1 + 0.015 * vib[i]))), s.ctl((t, i) => ew[i] * ew[i])), 0.2);
      const fl = s.wobble(18);
      const er = s.shape([[0, 0], [0.4, 0.2], [T, 1], [T + 0.05, 0]]);
      const roar = s.filter(s.sum([[s.noiseSrc('brown'), 1], [s.noiseSrc('white'), 0.3]]), 'bandpass', s.curve([[0, 450], [T, 1150]], true), 0.6);
      s.out(s.amp(roar, s.ctl((t, i) => er[i] * er[i] * (0.7 + 0.3 * fl[i]))));
      await s.scatter(0.3, T, 30, { type: 'highpass', f: [2000, 4000], q: 0.8, len: [0.002, 0.006], amp: [0.03, 0.1], fade: false, bias: 0.5 });
    },
  },
  // a fireball's impact: a crack, a deep boom (and its octave), the blast, a long rumble, the
  // fire's whoosh and debris raining down
  explosion: {
    len: 2.8, gain: 0.44, wet: true, variants: 3, sr: 16000,
    async render(s, v) {
      s.driveAll(1.6);
      const k = [1, 0.9, 1.1][v];
      s.burst(0, 0.12, { type: 'highpass', f: 1400, q: 0.7, attack: 0.0008, tau: 0.012, amp: 0.7 });
      s.thump(0, 95 * k, 30, 0.5, 0.33, 1);
      s.thump(0, 190 * k, 60, 0.3, 0.15, 0.35);
      s.out(s.filter(s.amp(s.noiseSrc('brown'), s.env(0, 0.003, 0.22)), 'lowpass', s.curve([[0, 3600], [0.15, 1300], [0.6, 320], [2, 160]], true), 0.8), 1.4);
      const w = s.wobble(9);
      const er = s.env(0.03, 0.08, 0.85);
      s.out(s.amp(s.filter(s.filter(s.noiseSrc('brown'), 'lowpass', 190, 0.9), 'highpass', 40, 0.7), s.ctl((t, i) => er[i] * (0.72 + 0.28 * w[i]))), 1.1);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', s.curve([[0, 500], [0.25, 1100], [1.5, 700]], true), 0.7), s.env(0.04, 0.12, 0.5)), 0.22);
      await s.scatter(0.12, 2.1, 34, { f: [1200, 4800], q: 1.6, len: [0.004, 0.014], amp: [0.04, 0.22], bias: 2 });
    },
  },
  // a flame pillar / eruption: the ignition's whoomph and thump, a turbulent roar, crackles
  fireRoar: {
    len: 2.0, gain: 0.51, wet: true, sr: 16000,
    async render(s) {
      s.driveAll(1.3);
      s.out(s.amp(s.filter(s.noiseSrc('brown'), 'lowpass', s.curve([[0, 220], [0.08, 2800], [0.5, 900], [1.7, 480]], true), 0.8), s.env(0, 0.03, 0.45, 0.1)), 1.2);
      s.thump(0, 125, 44, 0.25, 0.16, 0.7);
      const tb = s.wobble(11);
      const eb = s.env(0.02, 0.06, 0.38, 0.45);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', 820, 0.5), s.ctl((t, i) => eb[i] * (0.6 + 0.4 * tb[i]))), 0.35);
      await s.scatter(0.05, 1.6, 28, { type: 'highpass', f: [1800, 4000], q: 0.8, len: [0.002, 0.007], amp: [0.04, 0.16] });
    },
  },
  // the dragon's fire breath: a turbulent jet over a low roar and a growl in the throat
  breath: {
    len: 2.7, gain: 0.37, wet: true, sr: 16000,
    async render(s) {
      s.driveAll(1.5);
      const e = s.shape([[0, 0], [0.12, 0.9], [0.3, 1], [1.9, 0.95], [2.3, 0]]);
      const t1 = s.wobble(13);
      const t2 = s.wobble(4);
      const a = s.ctl((t, i) => e[i] * (0.62 + 0.28 * t1[i] + 0.1 * t2[i]));
      s.out(s.amp(s.filter(s.filter(s.noiseSrc(), 'bandpass', s.curve([[0, 600], [0.3, 1400], [2.3, 1100]], true), 0.55), 'lowpass', 5200, 0.7), a), 0.9);
      s.out(s.amp(s.filter(s.noiseSrc('brown'), 'lowpass', 320, 0.8), a), 0.8);
      const growl = s.formants(s.voice(s.curve([[0, 52], [0.4, 60], [2.3, 48]], true), { jitter: 0.06, rate: 30, breath: 0 }), [[440, 4, 1], [880, 5, 0.6]]);
      s.out(s.amp(growl, e), 2.5);
      await s.scatter(0.1, 2.2, 70, { type: 'highpass', f: [1800, 4200], q: 0.8, len: [0.002, 0.006], amp: [0.03, 0.12], fade: false });
    },
  },
  // the ground shaking: a deep, wavering rumble, rock grinding, cracks and falling pebbles
  quake: {
    len: 2.7, gain: 0.585, wet: true, sr: 16000,
    async render(s) {
      const e = s.shape([[0, 0], [0.35, 1], [1.4, 0.9], [2.35, 0]]);
      const am = s.wobble(6);
      s.out(s.amp(s.filter(s.filter(s.noiseSrc('brown'), 'lowpass', 120, 1), 'highpass', 42, 0.7), s.ctl((t, i) => e[i] * (0.62 + 0.38 * am[i]))), 1.3);
      const gr = s.wobble(26);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', 260, 1.2), s.ctl((t, i) => e[i] * Math.max(0, gr[i]) ** 2)), 0.7);
      for (let k = 0; k < 6; k++) {
        const t = s.r(0.2, 1.9);
        s.burst(t, 0.2, { f: s.r(700, 1600), q: 1.2, tau: s.r(0.008, 0.025), amp: s.r(0.25, 0.5) });
        s.thump(t, 110, 70, 0.05, 0.04, 0.2);
      }
      await s.scatter(0.3, 2.3, 20, { f: [2000, 5000], len: [0.002, 0.006], amp: [0.03, 0.08] });
    },
  },
  // ---- the swordmaster -----------------------------------------------------------------------------
  // Dragonfang Wave: the blade's ringing shing, a long resonant rush down the lane, a whistle, a thrum
  swordWave: {
    len: 1.3, gain: 0.21, wet: true,
    async render(s) {
      s.modes(0, [[1620, 0.5, 0.26], [2380, 0.33, 0.18], [3950, 0.16, 0.09], [5200, 0.07, 0.05]]);
      s.burst(0, 1.3, { f: [[0, 700], [0.15, 2600], [0.6, 1500], [1.15, 600]], q: 2.5, attack: 0.06, hold: 0.15, tau: 0.26, amp: 1.6 });
      s.out(s.amp(s.osc('sine', s.curve([[0, 880], [0.2, 1400], [1.0, 720]], true)), s.env(0.02, 0.05, 0.3)), 0.1);
      s.thump(0, 115, 80, 0.2, 0.22, 0.35);
    },
  },
  // Tempest Edge: three storms of blades — quick swishes, glints, a thrum — over a spinning wind
  bladeStorm: {
    len: 1.9, gain: 0.25, wet: true,
    async render(s) {
      for (const t0 of [0, 0.32, 0.64]) {
        for (let k = 0; k < 4; k++) {
          const c = s.r(1800, 3000);
          s.burst(t0 + k * 0.035 + s.r(0, 0.01), 0.16, { f: [[0, c * 0.45], [0.05, c], [0.12, c * 0.6]], q: 3, attack: 0.025, tau: 0.035, amp: s.r(0.5, 0.8) });
        }
        s.modes(t0 + 0.02, [[s.r(2700, 3100), 0.2, 0.08], [s.r(3900, 4300), 0.12, 0.05]]);
        s.thump(t0, 150, 90, 0.06, 0.05, 0.3);
      }
      const lfo = s.lfo(9);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', s.ctl((t, i) => 600 + 250 * lfo[i]), 1.5), s.env(0, 0.1, 0.25, 0.65)), 0.45);
    },
  },
  // Skyfall Judgement: a rising charge, then the spectral sword's impact — a boom, a crack, a
  // ringing clang, a bright D-major shimmer, the ground's debris
  skyfall: {
    len: 3.4, gain: 0.39, wet: true,
    async render(s) {
      s.driveAll(1.3);
      const T = 0.62;
      const er = s.shape([[0, 0], [T * 0.7, 0.4], [T, 1], [T + 0.02, 0]]);
      s.out(s.amp(s.osc('sine', s.curve([[0, 300], [T, 1500]], true)), s.ctl((t, i) => er[i] * er[i])), 0.15);
      s.burst(0, T + 0.02, { f: [[0, 1000], [T, 4200]], q: 1.2, attack: T, tau: 0.01, amp: 0.25 });
      s.thump(T, 92, 28, 0.6, 0.42, 1);
      s.thump(T, 184, 60, 0.4, 0.18, 0.3);
      s.burst(T, 0.1, { type: 'highpass', f: 1200, q: 0.7, attack: 0.0008, tau: 0.015, amp: 0.85 });
      s.modes(T, [[180, 0.5, 0.7], [455, 0.35, 0.6], [790, 0.3, 0.5], [1220, 0.22, 0.4], [1910, 0.12, 0.3], [2730, 0.08, 0.2]], 0.55);
      for (const [f, a] of [[587.3, 0.06], [740, 0.05], [880, 0.05], [1174.7, 0.04]]) s.modes(T + 0.02, [[f, a, 0.65], [f * 1.003, a * 0.8, 0.65]]);
      s.burst(T, 2.2, { src: 'brown', type: 'lowpass', f: [[0, 2000], [0.6, 200]], q: 0.8, attack: 0.003, tau: 0.3, amp: 0.7 });
      await s.scatter(T + 0.1, T + 1.8, 22, { f: [1200, 4500], len: [0.004, 0.012], amp: [0.04, 0.16], bias: 2 });
    },
  },
  // ---- the cleric -----------------------------------------------------------------------------------
  // a holy bolt: a bright bell-like ting, a rising airy whoosh, sparkles
  holyBolt: {
    len: 1.3, gain: 0.195, wet: true,
    async render(s) {
      s.modes(0.01, [[1318.5, 0.45, 0.3], [1975.5, 0.28, 0.22], [2637, 0.18, 0.15], [3951, 0.06, 0.08]]);
      s.burst(0, 0.85, { f: [[0, 2000], [0.2, 4500], [0.5, 3000]], q: 2, attack: 0.04, tau: 0.12, amp: 0.5 });
      for (let k = 0; k < 6; k++) s.modes(s.r(0.05, 0.4), [[s.r(3000, 5000), s.r(0.02, 0.05), 0.04]]);
    },
  },
  // Judgement: a great sweet bell struck, a pillar of light rising (air and a G-major shimmer), a soft boom
  holyPillar: {
    len: 3.6, gain: 0.49, wet: true,
    async render(s) {
      const f = 392;
      s.modes(0, [[f * 0.5, 0.3, 0.8], [f, 0.5, 0.7], [f * 1.25, 0.22, 0.6], [f * 1.5, 0.2, 0.55], [f * 2, 0.25, 0.5], [f * 2.67, 0.1, 0.4], [f * 3, 0.08, 0.35], [f * 4.2, 0.05, 0.25]]);
      s.burst(0, 2.0, { f: [[0, 800], [0.8, 3000]], q: 1.2, attack: 0.25, tau: 0.5, amp: 0.5 });
      const sw = s.shape([[0, 0], [0.35, 1], [1.2, 0.7], [2.5, 0]]);
      for (const m of [67, 71, 74, 79]) s.out(s.amp(s.sum([[s.osc('triangle', mtof(m)), 1], [s.osc('triangle', mtof(m) * 1.004), 1]]), sw), 0.035);
      s.thump(0, 82, 45, 0.3, 0.3, 0.45);
    },
  },
  // Sanctuary: a warm D-major swell, a harp-like rising arpeggio, sparkles and the circle's hum
  sanctuary: {
    len: 3.6, gain: 0.37, wet: true,
    async render(s) {
      const sw = s.shape([[0, 0], [0.5, 1], [2, 0.85], [3, 0]]);
      for (const m of [62, 66, 69, 76]) s.out(s.amp(s.sum([[s.osc('triangle', mtof(m)), 1], [s.osc('triangle', mtof(m) * 1.003), 1]]), sw), 0.06);
      [74, 78, 81, 86, 90].forEach((m, k) => {
        const f = mtof(m);
        s.modes(0.1 + k * 0.09, [[f, 0.35, 0.6], [2 * f, 0.12, 0.3], [3 * f, 0.05, 0.16]]);
      });
      for (let k = 0; k < 5; k++) s.modes(s.r(0.4, 1.8), [[s.r(2500, 4500), s.r(0.02, 0.05), 0.08]]);
      const trem = s.lfo(3);
      const he = s.shape([[0, 0], [0.6, 1], [2.2, 0.8], [3.1, 0]]);
      s.out(s.amp(s.sum([[s.osc('sine', 146.8), 1], [s.osc('sine', 220), 0.7]]), s.ctl((t, i) => he[i] * (0.8 + 0.2 * trem[i]))), 0.12);
    },
  },
  // ---- the ice mage -----------------------------------------------------------------------------------
  // a frost lance: a crystalline tsing (a beating partial), an icy whoosh, frost hiss
  iceShard: {
    len: 1.0, gain: 0.26, wet: true,
    async render(s) {
      s.modes(0, [[2093, 0.35, 0.18], [2131, 0.12, 0.2], [3136, 0.22, 0.12], [4186, 0.1, 0.08], [5588, 0.04, 0.05]]);
      s.burst(0, 0.6, { f: [[0, 6000], [0.25, 2500]], q: 2, attack: 0.03, tau: 0.08, amp: 0.5 });
      s.burst(0, 0.8, { type: 'highpass', f: 5000, q: 0.7, attack: 0.005, tau: 0.15, amp: 0.06 });
      s.thump(0, 300, 180, 0.05, 0.04, 0.15);
    },
  },
  // Blizzard: two howling winds whose pitch swirls, gusts, frost hiss and tinkling ice
  blizzard: {
    len: 3.4, gain: 0.19, wet: true,
    async render(s) {
      const l1 = s.lfo(0.9);
      const l2 = s.lfo(0.63, 0.4);
      const wb = s.wobble(3);
      const ga = s.wobble(2);
      const e = s.shape([[0, 0], [0.5, 1], [2.5, 0.9], [3.1, 0]]);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', s.ctl((t, i) => 700 + 300 * l1[i] + 150 * wb[i]), 5), e), 2.2);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', s.ctl((t, i) => 1150 + 380 * l2[i] + 200 * wb[i]), 6), e), 1.1);
      s.out(s.amp(s.filter(s.noiseSrc('brown'), 'lowpass', 650, 0.8), s.ctl((t, i) => e[i] * (0.5 + 0.5 * ga[i]))), 0.5);
      s.out(s.amp(s.filter(s.noiseSrc(), 'highpass', 4500, 0.7), e), 0.04);
      for (let k = 0; k < 40; k++) {
        await s.pace();
        s.modes(s.r(0.2, 2.8), [[s.r(3000, 6000), s.r(0.01, 0.04), s.r(0.02, 0.05)]]);
      }
    },
  },
  // Glacial Tomb: ice spikes erupting — a crack and a thump, six spikes (bursts and glassy rings),
  // a shattering tail, a crunch
  iceSpike: {
    len: 1.5, gain: 0.56, wet: true,
    async render(s) {
      s.burst(0, 0.15, { type: 'highpass', f: 900, q: 0.7, attack: 0.0008, tau: 0.02, amp: 0.8 });
      s.thump(0, 130, 60, 0.08, 0.08, 0.55);
      for (const t of [0, 0.06, 0.11, 0.17, 0.22, 0.3]) {
        s.burst(t, 0.1, { f: s.r(2200, 2800), q: 1.5, tau: 0.015, amp: 0.4 });
        s.modes(t, [[s.r(1800, 3200), 0.15, 0.12], [s.r(3300, 4500), 0.07, 0.07]]);
      }
      for (let k = 0; k < 30; k++) {
        await s.pace();
        s.modes(s.r(0.05, 1.0), [[s.r(2500, 6000), s.r(0.02, 0.08), s.r(0.01, 0.05)]]);
      }
      const cw = s.wobble(30);
      const ce = s.env(0, 0.01, 0.2);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', 1200, 0.8), s.ctl((t, i) => ce[i] * cw[i] * cw[i])), 0.3);
    },
  },
  // a foe freezing: crackles of ice forming faster and faster, a rising glassy shimmer, a final tink
  freeze: {
    len: 1.8, gain: 0.21, wet: true,
    async render(s) {
      for (let k = 0; k < 70; k++) {
        await s.pace();
        const t = 0.7 * Math.sqrt(s.rng());
        s.burst(t, 0.012, { type: 'highpass', f: s.r(3000, 6000), q: 0.8, attack: 0.0005, tau: 0.0015, amp: 0.05 + (0.2 * t) / 0.7 });
      }
      s.out(s.amp(s.osc('sine', s.curve([[0, 1200], [0.7, 2400]], true)), s.shape([[0, 0], [0.6, 1], [0.72, 0]])), 0.05);
      s.modes(0.72, [[2637, 0.3, 0.25], [3951, 0.15, 0.15], [5274, 0.05, 0.08]]);
      s.thump(0.72, 170, 90, 0.07, 0.07, 0.3);
    },
  },
  // ---- the greatshield --------------------------------------------------------------------------------
  // a tower shield's bash: a heavy thump, the steel's clang, a crack, the body of the blow
  shieldBash: {
    len: 1.1, gain: 0.69, variants: 2, sr: 16000,
    async render(s, v) {
      const k = 1 + 0.06 * v;
      s.thump(0, 140, 55, 0.08, 0.09, 1);
      s.modes(0.002, [[315 * k, 0.5, 0.22], [790 * k, 0.4, 0.17], [1270 * k, 0.3, 0.13], [1840 * k, 0.22, 0.1], [2600 * k, 0.12, 0.07], [3400 * k, 0.06, 0.05]], 0.5);
      s.burst(0, 0.07, { f: 2000, q: 0.9, attack: 0.0006, tau: 0.008, amp: 0.6 });
      s.burst(0, 0.3, { src: 'brown', type: 'lowpass', f: 800, q: 0.7, attack: 0.001, tau: 0.04, amp: 0.4 });
    },
  },
  // Bulwark's taunt: a war cry ("HAAH!") with a shield's clang
  taunt: {
    len: 1.4, gain: 0.155, wet: true, sr: 16000,
    async render(s) {
      s.saturate(2.2, 0, s.shape([[0, 0], [0.05, 0.85], [0.18, 1], [0.7, 0.85], [1.1, 0]]));
      const src = s.voice(s.curve([[0, 112], [0.12, 152], [0.7, 142], [1.05, 110]], true), { jitter: 0.04, rate: 35, breath: 0.2, fm: [55, 35] });
      const vox = s.formants(src, [[730, 6, 1], [1090, 8, 0.55], [2440, 10, 0.3], [3300, 10, 0.12]]);
      s.out(vox, 1, 0, 'drive');
      s.burst(0, 0.12, { f: 1500, q: 0.8, attack: 0.01, tau: 0.03, amp: 0.15 });
      s.modes(0.01, [[280, 0.3, 0.25], [700, 0.22, 0.18], [1150, 0.15, 0.12], [1680, 0.1, 0.08]], 0.4);
    },
  },
  // Earthshatter: a slam (boom, crack), five stone spikes bursting up in turn, rumble, pebbles
  earthshatter: {
    len: 2.3, gain: 0.46, wet: true, sr: 16000,
    async render(s) {
      s.driveAll(1.3);
      s.thump(0, 85, 30, 0.5, 0.4, 1);
      s.thump(0, 170, 60, 0.3, 0.16, 0.3);
      s.burst(0, 0.1, { type: 'highpass', f: 1000, q: 0.7, attack: 0.0008, tau: 0.012, amp: 0.9 });
      [0.08, 0.17, 0.27, 0.36, 0.47].forEach((t, k) => {
        s.burst(t, 0.3, { src: 'brown', f: s.r(700, 1300), q: 1, attack: 0.002, tau: 0.04, amp: 1.1 });
        s.thump(t, 115, 70, 0.05, 0.05, 0.35 - k * 0.03);
        s.burst(t, 0.05, { type: 'highpass', f: 2000, q: 0.7, attack: 0.0005, tau: 0.006, amp: 0.3 });
      });
      s.burst(0.02, 2.25, { src: 'brown', type: 'lowpass', f: 160, q: 0.8, attack: 0.05, tau: 0.6, amp: 0.8 });
      await s.scatter(0.2, 1.8, 25, { f: [1500, 4500], len: [0.003, 0.01], amp: [0.03, 0.12], bias: 1.5 });
    },
  },
  // the ward dome: a shimmering, beating A-major hum, a glassy rising sweep, a bell at the top
  ward: {
    len: 2.4, gain: 0.18, wet: true,
    async render(s) {
      const sw = s.shape([[0, 0], [0.35, 1], [0.9, 0.85], [1.8, 0]]);
      for (const [f, a] of [[220, 0.12], [330, 0.09], [440, 0.08], [554.4, 0.05], [659.3, 0.04]]) s.out(s.amp(s.sum([[s.osc('sine', f), 1], [s.osc('sine', f * 1.0035), 1]]), sw), a);
      s.burst(0, 1.4, { f: [[0, 2000], [0.6, 7000]], q: 3, attack: 0.3, tau: 0.25, amp: 0.2 });
      s.modes(0.35, [[1760, 0.15, 0.45], [2640, 0.08, 0.3]]);
    },
  },
  // ---- the village --------------------------------------------------------------------------------------
  // villagers cheering: the crowd's roar ("aah") swelling under fourteen voices' shouts ("hey!",
  // "yeah!", "hoo-ray!", once or twice each), three whistles and claps — in stereo
  cheer: {
    len: 3.0, gain: 0.34, stereo: true,
    async render(s) {
      const bed = s.shape([[0, 0], [0.25, 0.5], [0.6, 1], [1.6, 0.8], [2.8, 0]]);
      for (const [src, pan] of /** @type {['white'|'brown', number][]} */ ([['white', -0.4], ['brown', 0.4]])) {
        s.out(s.amp(s.formants(s.shared(src), [[750, 3, 1], [1150, 4, 0.6], [2500, 5, 0.25]]), bed), src === 'white' ? 0.1 : 0.35, pan);
      }
      for (let k = 0; k < 14; k++) {
        await s.pace();
        const kind = k % 3;
        const base = kind === 0 ? s.r(105, 145) : kind === 1 ? s.r(200, 265) : s.r(270, 340);
        const scale = [1, 1.17, 1.3][kind];
        const pan = s.r(-0.85, 0.85);
        const amp = s.r(0.25, 0.55);
        let t0 = s.r(0, 0.6);
        for (let n = s.rng() < 0.4 ? 2 : 1; n > 0 && t0 < 2.4; n--) {
          const dur = s.r(0.3, 0.65);
          const two = s.rng() < 0.4;
          const at = (pts) => pts.map(([t, v]) => [t0 + t, v]);
          const f0 = s.curve(at(two ? [[0, base], [0.15, base * 1.05], [0.22, base * 1.3], [dur, base * 0.95]] : [[0, base * 0.95], [0.08, base * 1.35], [dur, base * 0.9]]), true);
          const F = s.vowels(at(two ? [[0, 'u'], [0.15, 'u'], [0.26, 'e'], [dur, 'e']] : [[0, 'e'], [0.1, 'a'], [dur, 'a']]), scale);
          const vox = s.formants(s.voice(f0, { jitter: 0.05, rate: 35, breath: 0.25, t0, len: dur + 0.08 }), [[F[0], 6, 1], [F[1], 8, 0.5], [F[2], 10, 0.25]]);
          s.out(s.amp(vox, s.shape(at([[0, 0], [0.03, 1], [dur * 0.5, 0.85], [dur, 0]]))), amp, pan);
          t0 += dur + s.r(0.1, 0.4);
        }
      }
      for (let k = 0; k < 3; k++) {
        const t0 = s.r(0.1, 1.2);
        const vib = s.lfo(9);
        const f = s.curve([[t0, 2200], [t0 + 0.2, 2800], [t0 + 0.6, 2400]], true);
        s.out(s.amp(s.osc('sine', s.ctl((t, i) => f[i] * (1 + 0.01 * vib[i])), t0, 0.7), s.shape([[t0, 0], [t0 + 0.04, 1], [t0 + 0.5, 0.8], [t0 + 0.65, 0]])), 0.06, s.r(-0.6, 0.6));
      }
      for (let k = 0; k < 26; k++) {
        await s.pace();
        const t = s.r(0.2, 2.5);
        const pan = s.r(-0.9, 0.9);
        const f = s.r(1100, 1500);
        const a = s.r(0.6, 1.2);
        for (const [dt, p] of [[0, 0.11], [0.0095, 0.12], [0.02, 0.14]]) s.burst(t + dt, 0.06, { f, q: 1, attack: 0.001, tau: dt === 0.02 ? 0.04 : 0.006, amp: p * a, pan });
      }
    },
  },
  // a firework: the rising whistle, the burst (crack, boom, air), a long crackling glitter
  firework: {
    len: 3.0, gain: 0.73, wet: true, variants: 2,
    async render(s, v) {
      const T = 0.7 + 0.1 * v;
      const vib = s.lfo(12);
      const f = s.curve([[0, 700], [T - 0.05, 2600 + 300 * v]], true);
      s.out(s.amp(s.osc('sine', s.ctl((t, i) => f[i] * (1 + 0.02 * vib[i])), 0, T), s.shape([[0, 0], [0.1, 0.6], [T - 0.05, 1], [T - 0.02, 0]])), 0.12);
      s.burst(0, T, { type: 'highpass', f: 3000, q: 0.7, attack: T - 0.05, tau: 0.01, amp: 0.05 });
      s.burst(T + 0.05, 0.15, { type: 'highpass', f: 800, q: 0.7, attack: 0.0008, tau: 0.02, amp: 0.9 });
      s.thump(T + 0.05, 110, 45, 0.2, 0.2, 0.7);
      s.burst(T + 0.05, 1.2, { src: 'brown', type: 'lowpass', f: 1500, q: 0.7, attack: 0.002, tau: 0.15, amp: 0.6 });
      await s.scatter(T + 0.2, 2.8, 60, { type: 'highpass', f: [2000, 5000], q: 0.8, len: [0.002, 0.006], amp: [0.05, 0.2], bias: 1.4 });
    },
  },
  // a villager's scream (a woman, a man, a child)
  scream: {
    len: 1.3, gain: 0.108, variants: 3,
    async render(s, v) {
      s.saturate(2.2, 0, s.shape([[0, 0], [0.05, 0.75], [0.25, 1], [0.7, 0.9], [1.15, 0]]));
      const V = [
        { f: [[0, 420], [0.1, 640], [0.4, 700], [0.9, 560], [1.1, 480]], fs: 1.17, rough: 70 },
        { f: [[0, 260], [0.1, 380], [0.5, 360], [1.0, 280]], fs: 1, rough: 55 },
        { f: [[0, 560], [0.1, 820], [0.5, 760], [1.0, 640]], fs: 1.3, rough: 85 },
      ][v];
      const f0 = s.curve(V.f, true);
      const vib = s.lfo(6.5);
      const wob = s.wobble(9);
      const F = s.vowels([[0, 'a'], [0.7, 'a'], [1.1, 'e']], V.fs);
      const src = s.voice(s.ctl((t, i) => f0[i] * (1 + 0.025 * vib[i] + 0.02 * wob[i])), { jitter: 0.06, rate: 45, breath: 0.35, fm: [V.rough, 40] });
      s.out(s.formants(src, [[F[0], 5, 1], [F[1], 7, 0.6], [F[2], 9, 0.35]]), 1, 0, 'drive');
    },
  },
  // ---- the monsters --------------------------------------------------------------------------------------
  // a brute's growl: a rattling low voice through an "oh" throat (three sizes)
  growl: {
    len: 1.1, gain: 0.205, variants: 3, sr: 16000,
    async render(s, v) {
      s.saturate(2.5, 0, s.shape([[0, 0], [0.1, 1], [0.55, 0.85], [1.0, 0]]));
      const k = [1, 0.82, 1.2][v];
      const src = s.voice(s.curve([[0, 75 * k], [0.2, 92 * k], [0.85, 70 * k]], true), { jitter: 0.05, rate: 30, breath: 0.25 });
      const rattle = s.amp(s.rectify(s.osc('sine', 28 * k)), 0.5);
      const vox = s.formants(s.amp(src, rattle, 0.5), [[450, 4, 1], [820, 5, 0.6], [2200, 6, 0.25]]);
      s.out(vox, 1, 0, 'drive');
    },
  },
  // a kobold's yip
  yip: {
    len: 0.32, gain: 0.225, variants: 3,
    async render(s, v) {
      s.saturate(1.6, 0, s.shape([[0, 0], [0.012, 1], [0.09, 0.8], [0.22, 0]]));
      const k = [1, 1.12, 0.9][v];
      const vox = s.formants(s.voice(s.curve([[0, 620 * k], [0.04, 980 * k], [0.18, 700 * k]], true), { jitter: 0.04, rate: 50, breath: 0.25, fm: [90, 30] }),
        [[600, 5, 1], [1800, 6, 0.6], [2600, 7, 0.3]]);
      s.out(vox, 1, 0, 'drive');
    },
  },
  // a whelp's screech: a raspy, wavering high cry
  screech: {
    len: 0.75, gain: 0.113, variants: 2,
    async render(s, v) {
      s.saturate(2, 0, s.shape([[0, 0], [0.03, 1], [0.33, 0.8], [0.6, 0]]));
      const k = [1, 0.88][v];
      const f0 = s.curve([[0, 850 * k], [0.08, 1300 * k], [0.5, 1050 * k], [0.65, 800 * k]], true);
      const src = s.sum([[s.voice(f0, { jitter: 0.05, rate: 60, breath: 0, fm: [40, 68] }), 1], [s.noiseSrc(), 0.3]]);
      s.out(s.formants(src, [[1500, 3, 1], [3000, 4, 0.5]]), 1, 0, 'drive');
    },
  },
  // an ember imp's cackle: "hee-hee-hee…", falling
  cackle: {
    len: 1.0, gain: 0.16, variants: 2,
    async render(s, v) {
      s.driveAll(1.4);
      const k = [1, 1.1][v];
      for (const [i, t0] of [0, 0.12, 0.24, 0.36, 0.5, 0.64].entries()) {
        await s.pace();
        const f = (780 - i * 40) * k;
        const F = s.vowels([[t0, 'i'], [t0 + 0.1, 'e']], 1.3);
        const vox = s.formants(s.voice(s.curve([[t0, f * 0.9], [t0 + 0.03, f * 1.1], [t0 + 0.1, f * 0.85]], true), { jitter: 0.02, rate: 50, breath: 0.2, t0, len: 0.13 }),
          [[F[0], 5, 1], [F[1], 7, 0.6], [F[2], 9, 0.3], [1000, 6, 0.4]]);
        s.out(s.amp(vox, s.shape([[t0, 0], [t0 + 0.008, 1], [t0 + 0.06, 0.7], [t0 + 0.11, 0]])), 1 - i * 0.07);
        s.burst(t0, 0.1, { f: 2000, q: 1, attack: 0.002, tau: 0.02, amp: 0.15 });
      }
    },
  },
  // a building giving way: timber cracks and a splintering creak, heavy thuds, debris, dust
  crash: {
    len: 2.4, gain: 0.52, wet: true, sr: 16000,
    async render(s) {
      for (const t of [0, 0.05, 0.14, 0.3]) {
        s.burst(t, 0.08, { type: 'highpass', f: 1500, q: 0.7, attack: 0.0006, tau: 0.01, amp: 0.6 });
        const k = s.r(0.9, 1.15);
        s.modes(t, [[280 * k, 0.3, 0.06], [650 * k, 0.2, 0.04], [1100 * k, 0.1, 0.03]]);
      }
      const slip = s.rectify(s.osc('square', s.curve([[0, 35], [0.4, 55]]), 0, 0.42));
      const ce = s.shape([[0.04, 0], [0.08, 1], [0.33, 0.6], [0.38, 0]]);
      s.out(s.amp(s.amp(s.filter(s.noiseSrc('white', 0, 0.42), 'bandpass', 900, 6), slip), ce), 1.2);
      for (const [t, a] of [[0.35, 0.9], [0.62, 0.6], [0.95, 0.4]]) {
        s.thump(t, 92, 45, 0.15, 0.15, a);
        s.burst(t, 0.6, { src: 'brown', type: 'lowpass', f: 600, q: 0.7, attack: 0.002, tau: 0.08, amp: a * 0.5 });
      }
      await s.scatter(0.4, 2.0, 40, { f: [600, 3000], len: [0.004, 0.014], amp: [0.04, 0.18], bias: 1.6 });
      s.burst(0.3, 2.1, { src: 'brown', type: 'lowpass', f: 1200, q: 0.7, attack: 0.3, tau: 0.5, amp: 0.25 });
    },
  },
  // a monster striking a house wall: a dull thud, a wooden knock, splinters, grit (three)
  wallHit: {
    len: 0.55, gain: 0.55, variants: 3, sr: 16000,
    async render(s, v) {
      const k = [1, 0.9, 1.12][v];
      s.thump(0, 150 * k, 75 * k, 0.05, 0.06, 0.9);
      s.modes(0.001, [[230 * k, 0.35, 0.07], [520 * k, 0.25, 0.05], [910 * k, 0.12, 0.03]]);
      for (const t of [0.005, 0.02, 0.05]) s.burst(t, 0.05, { f: 2500, q: 1.2, attack: 0.0005, tau: 0.006, amp: 0.25 });
      s.burst(0.03, 0.5, { type: 'lowpass', f: 2500, q: 0.7, attack: 0.02, tau: 0.08, amp: 0.12 });
    },
  },
};

/**
 * The voices of the crowd and blaze ambience layers (not `playSfx` names): the cries of a
 * panicking crowd, its babble (`walla`: two stereo loops of four voices each, at 12 kHz) and the
 * crack of burning timber.
 * @type {Record<string, VqSound>}
 */
const VQ_VOICES = {
  // a cry for help: "heh-elp!" (a man) or "oh, no!" (a woman), and a child's sobbing wail
  cry: {
    len: 1.8, gain: 1, variants: 3,
    async render(s, v) {
      const syl = (t0, dur, f, vow, scale, amp) => {
        const at = (pts) => pts.map(([t, x]) => [t0 + t, x]);
        const F = s.vowels(at(vow), scale);
        const vox = s.formants(s.voice(s.curve(at(f), true), { jitter: 0.03, rate: 40, breath: 0.2, t0, len: dur + 0.05 }), [[F[0], 5, 1], [F[1], 7, 0.6], [F[2], 9, 0.3]]);
        s.out(s.amp(vox, s.shape(at([[0, 0], [0.03, 1], [dur * 0.6, 0.85], [dur, 0]]))), amp);
      };
      if (v === 0) {
        s.burst(0, 0.1, { f: 1600, q: 0.8, attack: 0.01, tau: 0.025, amp: 0.05 });
        syl(0.02, 0.2, [[0, 190], [0.08, 245], [0.2, 225]], [[0, 'e'], [0.2, 'e']], 1, 1);
        syl(0.25, 0.42, [[0, 235], [0.1, 250], [0.42, 165]], [[0, 'e'], [0.12, 'a'], [0.42, 'o']], 1, 0.9);
      } else if (v === 1) {
        syl(0, 0.24, [[0, 330], [0.1, 410], [0.24, 380]], [[0, 'o'], [0.24, 'o']], 1.17, 1);
        syl(0.3, 0.45, [[0, 400], [0.12, 430], [0.45, 300]], [[0, 'o'], [0.2, 'o'], [0.45, 'u']], 1.17, 0.95);
      } else {
        const sob = s.lfo(4.5);
        const e = s.shape([[0, 0], [0.08, 1], [1.1, 0.8], [1.45, 0]]);
        const F = s.vowels([[0, 'a'], [0.8, 'a'], [1.4, 'e']], 1.3);
        const vox = s.formants(s.voice(s.curve([[0, 500], [0.3, 570], [0.9, 540], [1.4, 420]], true), { jitter: 0.04, rate: 30, breath: 0.3 }), [[F[0], 5, 1], [F[1], 7, 0.6], [F[2], 9, 0.3]]);
        s.out(s.amp(vox, s.ctl((t, i) => e[i] * (0.35 + 0.65 * Math.abs(sob[i])))));
      }
    },
  },
  // the babble of a frightened crowd: four voices of quick, raised syllables each, in stereo; the
  // loop's end crossfades into its start (`post`)
  walla: {
    len: 5.5, gain: 1, variants: 2, stereo: true, sr: 12000,
    async render(s) {
      for (let k = 0; k < 4; k++) {
        await s.pace();
        const woman = (k + s.r(0, 2)) % 2 >= 1;
        const base = (woman ? s.r(210, 270) : s.r(120, 165)) * 1.15;
        const fPts = [];
        const vPts = [];
        const aPts = [[0, 0]];
        let t = s.r(0, 0.4);
        while (t < 5.3) {
          const d = s.r(0.12, 0.32);
          const v1 = 'aeiou'[Math.floor(s.r(0, 5))];
          const v2 = 'aaeoo'[Math.floor(s.r(0, 5))];
          const up = s.r(0.95, 1.2);
          fPts.push([t, base * up], [t + d * 0.4, base * up * s.r(1, 1.15)], [t + d, base * s.r(0.85, 1)]);
          vPts.push([t, v1], [t + d, v2]);
          const a = s.r(0.5, 1);
          aPts.push([t, 0], [t + 0.03, a], [t + d * 0.7, a * 0.8], [t + d, 0]);
          t += d + s.r(0.02, 0.25);
        }
        await s.pace();
        aPts.push([5.5, 0]);
        const vox = s.formants(s.voice(s.curve(fPts, true), { jitter: 0.03, rate: 30, breath: 0.15 }),
          s.vowels(vPts, woman ? 1.17 : 1).map((f, j) => [f, 5 + 2 * j, [1, 0.55, 0.25][j]]));
        s.out(s.amp(vox, s.curve(aPts)), s.r(0.6, 1), s.r(-0.9, 0.9));
      }
    },
    post(chans, sr) {
      const x = Math.round(0.5 * sr);
      return chans.map((c) => {
        const len = c.length - x;
        const out = c.slice(0, len);
        for (let i = 0; i < x; i++) {
          const f = i / x;
          out[i] = c[i] * f + c[len + i] * (1 - f);
        }
        return out;
      });
    },
  },
  // burning timber cracking
  timber: {
    len: 0.45, gain: 1, variants: 3, sr: 16000,
    async render(s, v) {
      const k = [1, 0.85, 1.2][v];
      s.burst(0, 0.08, { type: 'highpass', f: 1300 * k, q: 0.7, attack: 0.0005, tau: 0.008, amp: 0.8 });
      s.modes(0, [[260 * k, 0.3, 0.05], [610 * k, 0.22, 0.035], [1040 * k, 0.12, 0.025]]);
      await s.scatter(0.01, 0.2, 8, { type: 'highpass', f: [2000, 4000], q: 0.8, len: [0.002, 0.005], amp: [0.05, 0.2] });
    },
  },
};

/** The definition of a VQ sound or voice (null for another name). */
function vqDef(name) {
  return ownValue(VQ_SOUNDS, name) ?? ownValue(VQ_VOICES, name) ?? null;
}

/** The render entry of a VQ sound or voice (RenderKit.js `VQ_CACHE`). */
function vqEntry(name) {
  return cacheEntry(name, vqDef(name).variants ?? 1);
}

/**
 * Variant `v` of a VQ sound or voice as an AudioBuffer: rendered once (its `deps` first), queued
 * behind the renders already asked for (RenderKit.js `loadRender`).
 * @param {string} name
 * @param {number} v
 * @returns {Promise<AudioBuffer>}
 */
function vqLoad(name, v) {
  return loadRender(name, v, vqDef);
}

// ---------------------------------------------------------------------------------------------
// Playing the sounds; the crowd and the blaze
// ---------------------------------------------------------------------------------------------

/**
 * One VQ sound (AudioSystem `playSfx`): a variant's buffer through its gain into the combat panner
 * bank (two nodes). Its buffer not rendered yet (asked for before the renders could finish): it
 * plays when the render arrives if that is within 0.4 s of its time, else it is dropped.
 * @param {AudioSystem} a @param {string} name @param {number} t @param {number} v volume
 * @param {number} p pitch @param {number} pan
 */
export function playSfx(a, name, t, v, p, pan) {
  const def = VQ_SOUNDS[name];
  const n = def.variants ?? 1;
  const k = n > 1 ? Math.floor(a._vrng() * n) : 0;
  const rate = p * (def.rate ?? 1) * (0.98 + a._vrng() * 0.04);
  const buf = vqEntry(name).buffers[k];
  if (buf) playVq(a, buf, t, def.gain * v, rate, pan, !!def.wet);
  else {
    vqLoad(name, k).then((b) => {
      if (a._disposed || !a.ctx) return;
      const now = a.ctx.currentTime;
      if (now - t <= 0.4) playVq(a, b, Math.max(t, now + 0.005), def.gain * v, rate, pan, !!def.wet);
    });
  }
}

/** A VQ buffer at `t` through a gain into the combat panner bank. */
function playVq(a, buf, t, gain, rate, pan, wet) {
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
 * Render the buffers of `names` (default: every `VQ_SFX_NAMES` sound and the crowd / blaze voices)
 * — AudioSystem `primeSfx`; resolves when they are all ready.
 * @param {readonly string[]} [names]
 * @returns {Promise<void>}
 */
export function primeSfx(names = [...Object.keys(VQ_VOICES), ...VQ_SFX_NAMES]) {
  /** @type {Promise<AudioBuffer>[]} */
  const all = [];
  for (const name of names) {
    const def = vqDef(name);
    if (!def) continue;
    for (let v = 0; v < (def.variants ?? 1); v++) all.push(vqLoad(name, v));
  }
  return Promise.all(all).then(() => {});
}

/**
 * Diagnostics of the sound and voice renders (AudioSystem `vqRenders`): every entry of RenderKit.js
 * `VQ_CACHE` (the music's renders report through `musicRenders`).
 * @returns {{ buffers: number, bytes: number, mainMs: number, maxBlockMs: number, slow: string[] }}
 */
export function renders() {
  let buffers = 0;
  for (const e of VQ_CACHE.entries.values()) buffers += e.buffers.filter(Boolean).length;
  return { buffers, bytes: VQ_CACHE.bytes, mainMs: VQ_CACHE.mainMs, maxBlockMs: VQ_CACHE.maxBlockMs, slow: [...VQ_CACHE.slow] };
}

/**
 * The rendered buffers of a VQ sound or voice (null: not one) — diagnostics.
 * @param {string} name
 * @returns {(AudioBuffer|null)[]|null}
 */
export function buffersOf(name) {
  return vqDef(name) ? vqEntry(name).buffers : null;
}

/**
 * Build the `crowd` or `blaze` ambience layer (AudioSystem `_createLayer` hands its helpers: `add`
 * keeps nodes for the teardown, `src` a looped noise source, `lfo` a modulator).
 *   - crowd: a frightened crowd — two looped babble beds in stereo drifting in level (a bed whose
 *     buffer is still rendering starts when it arrives); the cries are scheduled (`scheduleLayers`).
 *   - blaze: a big fire (burning houses, the bonfire) — a deep turbulent roar, a breathing mid
 *     band, a hiss; crackles, pops and cracking timber are scheduled.
 * @param {AudioSystem} a @param {'crowd'|'blaze'} name @param {any} layer
 * @param {{ add: (...n: AudioNode[]) => any, src: (buffer: AudioBuffer, rate?: number, offset?: number) => AudioBufferSourceNode,
 *   lfo: (freq: number, depth: number, param: AudioParam, type?: OscillatorType) => OscillatorNode }} h
 */
export function buildLayer(a, name, layer, { add, src, lfo }) {
  const ctx = a.ctx;
  const gain = layer.gain;
  const vr = a._vrng;
  if (name === 'crowd') {
    const bed = add(ctx.createGain());
    bed.gain.value = 0.6;
    bed.connect(gain);
    const offsets = [vr(), vr()];
    const bedSource = (b, k, late = false) => {
      // (a buffer rendered after the layer went: nothing; the layer is registered after the build)
      if (late && (a._layers.crowd !== layer || a._disposed)) return;
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      s.playbackRate.value = k ? 0.97 : 1;
      s.start(ctx.currentTime, offsets[k] * b.duration);
      s.connect(bed);
      layer.sources.push(s);
      add(s);
    };
    for (const k of [0, 1]) {
      const b = vqEntry('walla').buffers[k];
      if (b) bedSource(b, k);
      else vqLoad('walla', k).then((bb) => bedSource(bb, k, true));
    }
    lfo(0.11, 0.2, bed.gain);
    const cries = add(ctx.createGain());
    cries.gain.value = 1;
    cries.connect(gain);
    layer.input = cries;
    layer.next = ctx.currentTime + 0.3 + vr() * 0.6;
    return;
  }
  const s1 = src(a._brown, 0.7, vr() * 5);
  const lp = add(a._biquad('lowpass', 300, 0.8));
  const hp1 = add(a._biquad('highpass', 45, 0.7));
  const g1 = add(ctx.createGain());
  g1.gain.value = 0.8;
  s1.connect(lp).connect(hp1).connect(g1).connect(gain);
  lfo(0.23, 0.2, g1.gain);
  lfo(0.41, 0.14, g1.gain);
  lfo(5.3, 0.05, g1.gain);
  const s2 = src(a._brown, 1.6, vr() * 5);
  const bp = add(a._biquad('bandpass', 750, 0.7));
  const g2 = add(ctx.createGain());
  g2.gain.value = 0.5;
  s2.connect(bp).connect(g2).connect(gain);
  lfo(0.17, 0.22, g2.gain);
  lfo(0.07, 220, bp.frequency);
  const s3 = src(a._white, 1, vr());
  const hp = add(a._biquad('highpass', 3200, 0.7));
  const g3 = add(ctx.createGain());
  g3.gain.value = 0.02;
  s3.connect(hp).connect(g3).connect(gain);
  lfo(1.1, 0.01, g3.gain);
  const ev = add(ctx.createGain());
  ev.gain.value = 1;
  ev.connect(gain);
  layer.input = ev;
  layer.next = ctx.currentTime + 0.05;
}

/**
 * Schedule the crowd's cries and the blaze's crackles, pops and timber cracks up to `ahead`
 * (AudioSystem `_scheduleAmbience`; their own RNG: the shared one's sequence stays as it was).
 * @param {AudioSystem} a @param {Record<string, any>} L the live layers @param {number} now @param {number} ahead
 */
export function scheduleLayers(a, L, now, ahead) {
  const vr = a._vrng;
  const crowd = L.crowd;
  if (crowd && crowd.level > 0.001) {
    if (crowd.next < now) crowd.next = now + 0.1 + vr() * 0.5;
    const rate = 0.3 + 1.6 * crowd.level;
    while (crowd.next < ahead) {
      crowdCry(a, crowd.next, crowd.input);
      crowd.next += 0.12 - Math.log(1 - vr() * 0.999) / rate;
    }
  }
  const blaze = L.blaze;
  if (blaze && blaze.level > 0.001) {
    if (blaze.next < now) blaze.next = now + vr() * 0.05;
    const rate = 10 + 22 * blaze.level;
    while (blaze.next < ahead) {
      const tt = blaze.next;
      const u = vr();
      if (u < 0.006 + 0.01 * blaze.level) vqVoice(a, 'timber', Math.floor(vr() * 3), tt, 0.25 + vr() * 0.35, (vr() - 0.5) * 1.4, 0.85 + vr() * 0.3, blaze.input);
      else if (u < 0.07) blazePop(a, tt, blaze.input);
      else {
        const cluster = vr() < 0.3 ? 2 + Math.floor(vr() * 3) : 1;
        for (let k = 0; k < cluster; k++) blazeCrackle(a, tt + k * (0.006 + vr() * 0.025), blaze.input);
      }
      blaze.next += -Math.log(1 - vr() * 0.999) / rate;
    }
  }
}

/** A crowd's cry: a scream, a cry for help or a child's wail, somewhere in the crowd. */
function crowdCry(a, t, dest) {
  const vr = a._vrng;
  const u = vr();
  const [name, v] = u < 0.45 ? ['scream', Math.floor(vr() * 3)] : u < 0.88 ? ['cry', Math.floor(vr() * 2)] : ['cry', 2];
  vqVoice(a, name, v, t, 0.15 + vr() * vr() * 0.45, (vr() - 0.5) * 1.7, 0.88 + vr() * 0.24, dest);
}

/**
 * A VQ voice into an ambience layer at `vol` (of its normalised buffer, not its SFX gain): its
 * buffer, a gain, a panner (three nodes); skipped while its buffer is still rendering (an ambience
 * event, not a cue).
 */
function vqVoice(a, name, v, t, vol, pan, rate, dest) {
  const buf = vqEntry(name).buffers[v];
  if (!buf) {
    vqLoad(name, v);
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

/** One crackle of a big fire (louder and lower-reaching than the campfire's). */
function blazeCrackle(a, t, dest) {
  const ctx = a.ctx;
  const r = a._vrng;
  const src = a._noiseSource(a._white, t, r() * 1.8);
  const hp = a._biquad('highpass', 900 + r() * 2600, 0.8);
  const g = ctx.createGain();
  const amp = 0.1 + r() * r() * 0.6;
  const dur = 0.003 + r() * 0.012;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amp, t + 0.0008);
  g.gain.setTargetAtTime(0, t + 0.001, dur * 0.4);
  const p = a._panner((r() - 0.5) * 1.2, dest);
  src.connect(hp).connect(g).connect(p);
  src.stop(t + dur * 3 + 0.06);
  a._cleanup(src, [src, hp, g, p]);
}

/** A knot popping in a big fire: a low thump with a crack. */
function blazePop(a, t, dest) {
  const ctx = a.ctx;
  const r = a._vrng;
  const o = ctx.createOscillator();
  o.type = 'sine';
  const f = 85 + r() * 40;
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.06);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0, t);
  og.gain.linearRampToValueAtTime(0.25 + r() * 0.25, t + 0.002);
  og.gain.setTargetAtTime(0, t + 0.004, 0.035);
  const n = a._noiseSource(a._white, t, r() * 1.8);
  const bp = a._biquad('bandpass', 1400 + r() * 1200, 1);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(0.3 + r() * 0.3, t + 0.0008);
  ng.gain.setTargetAtTime(0, t + 0.001, 0.006);
  const p = a._panner((r() - 0.5) * 1.2, dest);
  o.connect(og).connect(p);
  n.connect(bp).connect(ng).connect(p);
  o.start(t);
  o.stop(t + 0.3);
  n.stop(t + 0.08);
  a._cleanup(o, [o, og, n, bp, ng, p]);
}
