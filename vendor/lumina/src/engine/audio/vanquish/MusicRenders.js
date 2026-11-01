/**
 * MusicRenders — the rendered instruments of Vanquish the Evil Dragon's score (docs/contracts/
 * DRAGON_CAMPAIGN.md §6.9): the drums (the great drum, a taiko, a low tom, the festival's frame
 * drum), the timpani (a stroke at a pitch, a roll as one membrane), the great bell's toll, the
 * tam-tam, the suspended cymbal (a crash; a swell rolled to the bar line, ringing on), the field
 * snare, the tambourine's jingles, the villagers' claps and the festival's lute (ScoreKit.js
 * `ScoreEvent`: drum … lute). Each is a seeded recipe rendered once into an AudioBuffer (RenderKit.js
 * `renderMusic`: an OfflineAudioContext graph of modal partials, seeded noise and biquads, or the
 * lute's Karplus–Strong in JS), keyed by what makes it differ — `drum:great:h#2`, `timp@43:h#1`,
 * `timpRoll@40:1.90:0.10-0.70`, `toll@48:7`, `tamtam`, `cymbalCrash`, `cymbalSwell` (a loop),
 * `cymbalRing`, the crash's and the ring's tails `cymbalCrashTail` / `cymbalRingTail` (seeded by
 * their heads), `snare#1`, `jingle#0`, `clap#2`, `lute@62#1` — and seeded by that key (`hashName`):
 * adding a pitch never re-seeds another. One shared scale per instrument (never a buffer normalised
 * on its own): its pitches, round-robins and rolls keep their level relation; a soft stroke is the
 * hard buffer through a static lowpass at play (brightness follows dynamics). Drums, timpani, bells,
 * the tam-tam (its modes end at 6.5 kHz) and the lute render at 24 kHz, the cymbal, the snare's wires
 * and the jingles at 32 kHz (a cymbal's tail at 16 kHz), each finished with an anti-imaging lowpass
 * at 0.42 × its rate. Every struck metal rings to ≤ −40 dB under its loudest before its buffer's
 * end fades (the cymbal through its tail).
 *
 * The music lane (beside the sounds' queue in RenderKit.js, with its own cache and statistics):
 * `primeMusic(track)` renders every key a score track's sections can play (computed with each
 * section's tempo: `musicKeys`), one key at a time per track, and resolves `{ ok, failed }` — it
 * never rejects; `musicReady(track)` says whether they are all here; `retainMusic(owner, tracks)`
 * keeps the sets of the level played ('level'), the next one built ahead ('next') and a story run's
 * music lines ('story'): a set released by its last owner is freed (unless it plays or was used in
 * the last seconds), and above `MUSIC_CAP` resident the least recently used sets nobody plays go
 * first. A note whose buffer is missing when it is scheduled is skipped and counted (`missed`),
 * never played late.
 *
 * Playing one (`playRendered`): BufferSource → Gain (the velocity) → [the soft lowpass] → [a panner]
 * → the score bus of its family (`drums`, `timp`, `bells`, `metal`, `lute`; a far event's `far`, a
 * far drum's `farDrums`): 2–4 nodes (a cymbal's tail one more), one `_cleanup` on the source that
 * ends last. A timpani roll starts where its last stroke lands on the stroke it ends on
 * (`rollStart`), and a stroke of its pitch landing there takes it over (LAND_TOL).
 *
 * Imports ScoreKit.js (`mtof`, the event types) and RenderKit.js; never VanquishAudio.js or
 * AudioSystem.js (what it uses of the AudioSystem is `VoiceHost`), and never Scores.js — the score of
 * a track reaches it as a `ScoreSource` (VanquishAudio.js passes Scores.js `scoreTrack`).
 * ScoreVoices.js hands it every event it does not play itself; it is imported only through the
 * campaigns' audio packs (VanquishAudio.js, EvermereAudio.js — the shared score kit, a chunk of its
 * own); a pack adds its own rendered instruments (`registerRendered`: The Bells of Evermere's bells)
 * and hands its own `ScoreSource`.
 */
import { mtof } from './ScoreKit.js';
import { hashName, renderMusic } from './RenderKit.js';

/**
 * @import { ScoreEvent, ScoreSection, ScoreBusName } from './ScoreKit.js'
 * @import { Sketch, MusicJob } from './RenderKit.js'
 */

/**
 * What the score's voices use of the AudioSystem they play on (vanquish/ never imports
 * AudioSystem.js, not even its type): the context, the shared RNG (a voice's default; the scores
 * pass the instance's `m.rng`), the white noise loop, its filter / noise / voice-cleanup helpers,
 * Emberfall's bell and the harp's pluck.
 * @typedef {object} VoiceHost
 * @property {BaseAudioContext} ctx
 * @property {() => number} _rng
 * @property {AudioBuffer} _white
 * @property {(type: BiquadFilterType, freq: number, q: number) => BiquadFilterNode} _biquad
 * @property {(buffer: AudioBuffer, t: number, offset?: number) => AudioBufferSourceNode} _noiseSource
 * @property {(src: AudioScheduledSourceNode, nodes: AudioNode[]) => void} _cleanup
 * @property {(t: number, f: number, amp: number, decay: number, out: AudioNode) => void} _bell
 * @property {(t: number, midi: number, vel: number, pan: number, dest: AudioNode) => void} _pluck
 */
/**
 * A built score track as the renders read it: VanquishAudio.js passes Scores.js `scoreTrack` (the
 * same deterministic build the AudioSystem plays; null for a name that is not a score track).
 * @typedef {(name: string) => ({ bpm: number, sections: Record<string, ScoreSection> } | null)} ScoreSource
 */
/**
 * Who keeps a set of rendered music (`retainMusic`): the level being played, the next one built
 * ahead, a story run.
 * @typedef {'level'|'next'|'story'} MusicOwner
 */
/**
 * The music renders' statistics (AudioSystem `vqRenders.music`): buffers and sample bytes resident
 * now, the main thread's milliseconds (building graphs, finishing renders, making buffers) and its
 * longest block, notes skipped for a missing buffer, the milliseconds the last `startMusic` of a
 * score track waited for its set (the AudioSystem's), the tracks whose sets are resident; and
 * (diagnostics) the milliseconds spent rendering (in all, wall time), the blocks over 6 ms, what
 * each owner keeps, and per track primed its keys, their bytes, the milliseconds its last prime
 * took and whether every key rendered.
 * @typedef {{ buffers: number, bytes: number, mainMs: number, maxBlockMs: number, missed: number, waitMs: number, primed: string[],
 *   renderMs?: number, slow?: string[], retained?: Record<string, string[]>,
 *   tracks?: Record<string, { keys: number, bytes: number, ms: number, ok: boolean }> }} MusicRenderStats
 */

// ---------------------------------------------------------------------------------------------
// The recipes
// ---------------------------------------------------------------------------------------------

/** Sample rate of the drums, timpani, bells and the lute. */
const SR_LOW = 24000;
/** Sample rate of the metals (tam-tam, cymbal, the snare's wires, the jingles). */
const SR_METAL = 32000;
/** The anti-imaging lowpass of a render at `sr`. */
const aa = (sr) => sr * 0.42;
/** Round-robin renders per instrument (the score stamps `rr`; another is taken modulo). */
const RR = Object.freeze({ drum: 3, timp: 2, snare: 3, jingle: 3, clap: 3, lute: 2 });
/** The timpani roll's strokes a second (alternating hands). */
const ROLL_RATE = 12;
/** Where a timpani stroke's render strikes (s into its buffer): a hit's one stroke, a roll's first. */
const HIT_AT = 0.002;
const ROLL_AT = 0.004;
/**
 * A crash and the swell's ring (the cymbal struck, ringing on) in two renders: the head as it always
 * was (CYMBAL_HEAD s at the metals' rate, its end faded over CYMBAL_FADE) and the tail — the same
 * plate (the same seed: the same partials, phases and decays) rendered to CYMBAL_LEN at CYMBAL_TAIL_SR
 * (above ≈ 7 kHz nothing is left of it by then: ≤ −44 dB under the strike) from the head's fade on,
 * faded in there as the head fades out — the plate rings to ≤ −40 dB under its loudest before its
 * end fades (from CYMBAL_LEN − CYMBAL_FADE = 12.0 s), at a third of a full-rate render's bytes.
 */
const CYMBAL_HEAD = 4.5;
const CYMBAL_FADE = 0.4;
const CYMBAL_LEN = 12.4;
const CYMBAL_TAIL_SR = 16000;

/**
 * A membrane's modes for a drum type: [ratio, amplitude, τ (s)] — the circular membrane's
 * (1, 1.59, 2.14, 2.30, 2.65, 2.92, 3.16, 3.5) — its pitch (Hz), the pitch drop at the strike (a
 * ratio, ≤ 3 semitones) and its time, the strike (mallet / stick / hand: [filter, Hz, Q, amplitude,
 * τ] bursts), the shell's resonance ([Hz, Q, amplitude, τ]), the render's length and the play's
 * level at velocity 1 (× `PLAY`'s; calibrated on the war drum's and frame drum's balance before them).
 * @type {Readonly<Record<'great'|'taiko'|'tom'|'frame'|'frameTip', { f: number, modes: number[][], glide: number,
 *   glideTime: number, strike: [BiquadFilterType, number, number, number, number][], shell: number[]|null, len: number, level: number }>>}
 */
const DRUMS = Object.freeze({
  // the o-daiko: a felt mallet on a great skin, ≈ 52 Hz, a long boom
  great: {
    f: 52, glide: 1.17, glideTime: 0.16, len: 2.6, level: 1.12,
    modes: [[1, 1, 0.45], [1.59, 0.55, 0.22], [2.14, 0.36, 0.15], [2.3, 0.3, 0.13], [2.65, 0.22, 0.1], [2.92, 0.16, 0.085], [3.16, 0.12, 0.075], [3.5, 0.09, 0.065]],
    strike: [['lowpass', 650, 0.8, 0.55, 0.02], ['bandpass', 1600, 1, 0.1, 0.008]],
    shell: [210, 3, 0.25, 0.06],
  },
  // a nagado taiko under a stick, ≈ 150 Hz
  taiko: {
    f: 150, glide: 1.12, glideTime: 0.06, len: 1.4, level: 0.6,
    modes: [[1, 1, 0.24], [1.59, 0.5, 0.12], [2.14, 0.34, 0.09], [2.3, 0.26, 0.08], [2.65, 0.2, 0.06], [2.92, 0.14, 0.05], [3.16, 0.1, 0.045], [3.5, 0.08, 0.04]],
    strike: [['bandpass', 2400, 0.9, 0.35, 0.006], ['lowpass', 1200, 0.7, 0.25, 0.012]],
    shell: [420, 3, 0.2, 0.04],
  },
  // a low tom under a soft mallet, ≈ 100 Hz
  tom: {
    f: 100, glide: 1.13, glideTime: 0.09, len: 1.9, level: 0.62,
    modes: [[1, 1, 0.32], [1.59, 0.5, 0.16], [2.14, 0.34, 0.11], [2.3, 0.26, 0.1], [2.65, 0.2, 0.075], [2.92, 0.14, 0.065], [3.16, 0.1, 0.055], [3.5, 0.08, 0.05]],
    strike: [['lowpass', 900, 0.8, 0.45, 0.015], ['bandpass', 2000, 1, 0.08, 0.006]],
    shell: [300, 3, 0.2, 0.05],
  },
  // the bodhrán's open boom (the tipper's low end), ≈ 76 Hz
  frame: {
    f: 76, glide: 1.12, glideTime: 0.05, len: 1.1, level: 0.89,
    modes: [[1, 1, 0.2], [1.59, 0.45, 0.1], [2.14, 0.3, 0.07], [2.65, 0.18, 0.05], [3.16, 0.1, 0.04]],
    strike: [['lowpass', 1100, 0.7, 0.35, 0.01], ['bandpass', 2500, 1, 0.08, 0.005]],
    shell: null,
  },
  // the tipper's tap near the rim: high, dry
  frameTip: {
    f: 190, glide: 1.05, glideTime: 0.02, len: 0.45, level: 0.54,
    modes: [[1, 0.7, 0.07], [1.59, 0.5, 0.05], [2.14, 0.45, 0.04], [2.65, 0.3, 0.03], [3.16, 0.2, 0.025]],
    strike: [['bandpass', 1800, 1.1, 0.4, 0.006]],
    shell: null,
  },
});
/**
 * The timpani's modes: [ratio, amplitude, τ] — the (0,1) thud at 0.62 (short), the principal, then
 * the kettle's near-harmonic (1.5, 1.98, 2.44, 2.94, 3.42).
 */
const TIMP_MODES = Object.freeze([[0.62, 0.45, 0.05], [1, 1, 0.5], [1.5, 0.5, 0.38], [1.98, 0.32, 0.3], [2.44, 0.2, 0.22], [2.94, 0.13, 0.17], [3.42, 0.09, 0.13]]);
/**
 * A great bell's partials: [ratio, level, decay share] — the hum an octave down (the longest), the
 * prime, the minor-third tierce of a cast bell (its mournful colour), the quint, the nominal, the
 * upper partials; each sounds as a beating doublet.
 */
const TOLL_PARTIALS = Object.freeze([[0.5, 0.5, 1], [1, 0.45, 0.6], [1.19, 0.32, 0.5], [1.5, 0.15, 0.36], [2, 0.38, 0.42], [2.51, 0.12, 0.25],
  [2.66, 0.09, 0.22], [3.01, 0.07, 0.18], [4.07, 0.05, 0.12], [4.2, 0.04, 0.11], [5.4, 0.03, 0.08], [6, 0.025, 0.07]]);

/**
 * The shared render scale of each instrument (the buffers' level relation kept), set so its loudest
 * buffer peaks below ≈ 0.9.
 */
const SCALE = Object.freeze({ drum: 0.42, timp: 0.38, toll: 0.57, tamtam: 0.1, cymbal: 0.096, snare: 0.35, jingle: 0.18, clap: 0.875, lute: 1.05 });

/**
 * A membrane struck at [[t, v], …]: one sine per mode (sliding down to pitch from `glide` × f over
 * `glideTime` after the first stroke), its gain re-excited at every stroke — the mode's energy adds
 * (√(a² + b²)), so a roll builds like a real one and stays one coherent sound —, the strike's noise
 * bursts at every stroke, the shell's ring (yielding to the page between the modes).
 * @param {Sketch} s @param {number} f @param {readonly number[][]} modes @param {number[][]} strokes
 * @param {{ glide: number, glideTime: number, strike: [BiquadFilterType, number, number, number, number][], shell?: number[]|null, vary?: number }} o
 */
async function membrane(s, f, modes, strokes, { glide, glideTime, strike, shell = null, vary = 0.12 }) {
  const t0 = strokes[0][0];
  const tEnd = strokes[strokes.length - 1][0];
  const att = 0.0015;
  for (const [ratio, amp0, tau] of modes) {
    const fm = f * ratio;
    if (fm > s.sr * 0.45) continue;
    const amp = amp0 * (1 + s.r(-vary, vary));
    const o = s.osc('sine', glide !== 1 ? s.curve([[t0, fm * glide], [t0 + glideTime, fm]], true) : fm, t0, Math.min(s.len - t0, tEnd - t0 + att + tau * 7 + 0.01));
    const g = s.ctx.createGain();
    g.gain.value = 0;
    let a = 0;
    let tPrev = t0;
    for (const [t, v] of strokes) {
      const left = a * Math.exp(-Math.max(0, t - tPrev - att) / tau);
      a = Math.sqrt(left * left + (amp * v) ** 2);
      g.gain.setValueAtTime(left, t);
      g.gain.linearRampToValueAtTime(a, t + att);
      g.gain.setTargetAtTime(0, t + att, tau);
      tPrev = t;
    }
    o.connect(g);
    s.route(g);
    if (s.due()) await s.pace();
  }
  // the strike: noise through its filters, a burst at every stroke (one source and gain per filter)
  for (const [type, hz, q, amp, tau] of strike) {
    const fl = s.filter(s.shared('white'), type, hz * (1 + s.r(-0.08, 0.08)), q);
    const g = s.ctx.createGain();
    g.gain.value = 0;
    for (const [t, v] of strokes) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * v, t + 0.001);
      g.gain.setTargetAtTime(0, t + 0.001, tau);
    }
    fl.connect(g);
    s.route(g);
  }
  if (shell) {
    const [hz, q, amp, tau] = shell;
    const fl = s.filter(s.shared('white'), 'bandpass', hz * (1 + s.r(-0.05, 0.05)), q);
    const g = s.ctx.createGain();
    g.gain.value = 0;
    for (const [t, v] of strokes) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * v, t + 0.002);
      g.gain.setTargetAtTime(0, t + 0.002, tau);
    }
    fl.connect(g);
    s.route(g);
  }
}

/**
 * The strokes of a roll over `dur` s at ROLL_RATE from ROLL_AT (the last at ROLL_AT + `dur`),
 * velocity v0 → v1, the hands alternating (seeded).
 */
function rollStrokes(s, dur, v0, v1) {
  const n = Math.max(2, Math.round(dur * ROLL_RATE) + 1);
  const out = [];
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    const jitter = k > 0 && k < n - 1 ? s.r(-0.006, 0.006) : 0;
    const hand = k % 2 ? 0.93 : 1;
    out.push([ROLL_AT + u * dur + jitter, (v0 + (v1 - v0) * u) * hand * (1 + s.r(-0.04, 0.04))]);
  }
  return out;
}

/** Decaying sine partials into `dest` (or the output): [[Hz, amplitude, attack, τ], …] from `t` (yielding to the page now and then). */
async function partials(s, t, list, dest = null) {
  for (const [f, amp, attack, tau] of list) {
    if (s.due()) await s.pace();
    if (f > s.sr * 0.45 || t >= s.len) continue;
    const o = s.osc('sine', f, t, Math.min(s.len - t, attack + tau * 7 + 0.01));
    const g = s.ctx.createGain();
    g.gain.value = 0;
    s.ad(g.gain, t, amp, attack, tau);
    o.connect(g);
    if (dest) g.connect(dest);
    else s.route(g);
  }
}

/** Gains into the output at fixed pans (a stereo render: one panner each), for many partials. */
function panBuses(s, pans) {
  return pans.map((p) => {
    const g = s.ctx.createGain();
    s.route(g, p);
    return g;
  });
}

/** A noise wash: white noise through a highpass and a bandpass, its gain `env` (a point curve). */
function wash(s, hp, bp, q, env, pan = 0) {
  const src = s.noiseSrc('white');
  const f = s.filter(s.filter(src, 'highpass', hp, 0.7), 'bandpass', bp, q);
  const g = s.amp(f, env);
  s.route(g, pan);
  return g;
}

/**
 * A cymbal plate's partials (`n` from 380 Hz to 12 kHz, seeded): [Hz, amplitude, τ].
 * @param {Sketch} s @param {number} n
 */
function plateModes(s, n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const f = 380 * (12000 / 380) ** ((k + s.r(-0.45, 0.45)) / n);
    out.push([f, (f / 1000) ** -0.2 * s.r(0.4, 1), 2.2 * (1000 / f) ** 0.35 * s.r(0.8, 1.2)]);
  }
  return out;
}

/**
 * A cymbal struck: the plate's partials spread over three pans, a wash, and the strike — `hard` a
 * stick's ping (the crash), else a soft mallet (the swell's climax ringing on).
 * @param {Sketch} s @param {boolean} hard
 */
async function cymbalHit(s, hard) {
  const buses = panBuses(s, [-0.5, 0, 0.5]);
  const modes = plateModes(s, 64);
  for (let k = 0; k < modes.length; k++) {
    const [f, amp, tau] = modes[k];
    await partials(s, 0, [[f, amp, hard ? 0.001 + (f / 12000) * 0.02 : 0.012 + (f / 12000) * 0.04, tau]], buses[k % 3]);
  }
  const pts = hard ? [[0, 0], [0.002, 1], [0.25, 0.45], [1.5, 0.12], [4.4, 0]] : [[0, 0], [0.015, 0.8], [0.4, 0.45], [1.8, 0.12], [4.4, 0]];
  wash(s, 3000, 6500, 0.5, s.shape(pts.map(([t, v]) => [t, v * 0.5])), -0.4);
  wash(s, 3000, 7200, 0.5, s.shape(pts.map(([t, v]) => [t, v * 0.5])), 0.4);
  if (hard) s.burst(0, 0.05, { type: 'bandpass', f: 6000, q: 0.8, attack: 0.0005, tau: 0.004, amp: 1.4 });
}

/**
 * A music job's recipe by its key (the key names what it renders; `musicKeys` / `eventKeys` make
 * them), seeded by the key — null for a key no recipe knows.
 * @param {string} key
 * @returns {MusicJob|null}
 */
export function jobOf(key) {
  const seed = hashName(key);
  let m;
  if ((m = /^drum:(great|taiko|tom|frame|frameTip):h#(\d+)$/.exec(key))) {
    const d = DRUMS[/** @type {'great'|'taiko'|'tom'|'frame'|'frameTip'} */ (m[1])];
    return {
      name: key, seed, len: d.len, sr: SR_LOW, gain: SCALE.drum, lowpass: aa(SR_LOW), fade: 0.3,
      build: (s) => membrane(s, d.f * (1 + s.r(-0.012, 0.012)), d.modes, [[0.002, 1]], d),
    };
  }
  if ((m = /^timp@(\d+):h#(\d+)$/.exec(key))) {
    const f = mtof(Number(m[1]));
    return {
      name: key, seed, len: 2.6, sr: SR_LOW, gain: SCALE.timp, lowpass: aa(SR_LOW), fade: 0.4,
      build: (s) => membrane(s, f, TIMP_MODES, [[HIT_AT, 1]], {
        glide: 1.022 + s.r(-0.004, 0.004), glideTime: 0.12, vary: 0.1,
        strike: [['lowpass', 1300, 0.7, 0.3, 0.012]], shell: null,
      }),
    };
  }
  if ((m = /^timpRoll@(\d+):([\d.]+):([\d.]+)-([\d.]+)$/.exec(key))) {
    const f = mtof(Number(m[1]));
    const dur = Number(m[2]);
    const v0 = Number(m[3]);
    const v1 = Number(m[4]);
    return {
      name: key, seed, len: dur + 2.4, sr: SR_LOW, gain: SCALE.timp, lowpass: aa(SR_LOW), fade: 0.4,
      build: (s) => membrane(s, f, TIMP_MODES, rollStrokes(s, dur, v0, v1), {
        glide: 1.012, glideTime: 0.08, vary: 0.06,
        strike: [['lowpass', 500 + 900 * Math.max(v0, v1), 0.7, 0.14, 0.012]], shell: null,
      }),
    };
  }
  if ((m = /^toll@(\d+):([\d.]+)$/.exec(key))) {
    const f = mtof(Number(m[1]));
    const decay = Number(m[2]);
    // (long enough for the hum to fall ≤ 50 dB under the strike before the end fades)
    const len = Math.min(11, 1.3 * decay + 0.6);
    return {
      name: key, seed, len, sr: SR_LOW, gain: SCALE.toll, lowpass: aa(SR_LOW), fade: Math.min(0.5, len * 0.1),
      build: async (s) => {
        // every partial a beating doublet (a cast bell is never quite round), each dying at its own rate
        const list = [];
        for (const [ratio, amp, share] of TOLL_PARTIALS) {
          const fp = f * ratio;
          const d = s.r(0.0004, 0.001);
          const tau = (decay * share) / 4;
          list.push([fp * (1 - d), amp * 0.55, 0.001, tau], [fp * (1 + d), amp * 0.45, 0.001, tau * s.r(0.92, 1.05)]);
        }
        await partials(s, 0.002, list);
        s.burst(0.002, 0.12, { type: 'bandpass', f: Math.min(3000, f * 7), q: 1.2, attack: 0.0015, tau: 0.01, amp: 0.25 });
        s.burst(0.002, 0.04, { type: 'bandpass', f: 4500, q: 1.5, attack: 0.0008, tau: 0.004, amp: 0.06 });
      },
    };
  }
  if (key === 'tamtam') {
    // (its modes stop at 6.5 kHz: at the low rate it loses nothing, and rings ≈ 15 s — to ≤ −40 dB
    // under its bloom — before its end fades)
    return {
      name: key, seed, len: 16.4, sr: SR_LOW, stereo: true, gain: SCALE.tamtam, lowpass: aa(SR_LOW), fade: 0.6,
      build: async (s) => {
        const buses = panBuses(s, [-0.55, 0, 0.55]);
        const n = 90;
        for (let k = 0; k < n; k++) {
          const f = 70 * (6500 / 70) ** ((k + s.r(-0.4, 0.4)) / n);
          const amp = (f < 400 ? (f / 400) ** 0.6 : (f / 400) ** -0.35) * s.r(0.5, 1);
          // the high modes bloom after the strike (the energy climbs the spectrum), the low ones ring longest
          const rise = 0.02 + 1.6 * (f / 6500) ** 0.8 * s.r(0.7, 1.3);
          await partials(s, 0.004, [[f, amp, rise, 4.5 * (70 / f) ** 0.25 * s.r(0.85, 1.15)]], buses[k % 3]);
        }
        // the beater's soft blow
        s.burst(0.004, 0.4, { type: 'lowpass', f: 300, q: 0.7, attack: 0.004, tau: 0.06, amp: 2.2 });
        s.thump(0.004, 74, 68, 0.2, 0.5, 1.2);
      },
    };
  }
  if ((m = /^(cymbalCrash|cymbalRing)(Tail)?$/.exec(key))) {
    const hard = m[1] === 'cymbalCrash';
    if (!m[2]) {
      return {
        name: key, seed, len: CYMBAL_HEAD, sr: SR_METAL, stereo: true, gain: SCALE.cymbal, lowpass: aa(SR_METAL), fade: CYMBAL_FADE,
        build: (s) => cymbalHit(s, hard),
      };
    }
    // the tail: the head's plate (its seed), kept from the head's fade on and faded in there
    const from = CYMBAL_HEAD - CYMBAL_FADE;
    return {
      name: key, seed: hashName(m[1]), len: CYMBAL_LEN, sr: CYMBAL_TAIL_SR, stereo: true, gain: SCALE.cymbal, lowpass: aa(CYMBAL_TAIL_SR), fade: CYMBAL_FADE,
      build: (s) => cymbalHit(s, hard),
      post: (chans, sr) => chans.map((c) => {
        const y = c.slice(Math.round(from * sr));
        const n = Math.round(CYMBAL_FADE * sr);
        for (let i = 0; i < n; i++) y[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
        return y;
      }),
    };
  }
  if (key === 'cymbalSwell') {
    // a soft-mallet roll's body (strokes ≈ 14 a second, the hands alternating, smoothed — no ticking),
    // looped: its last 0.35 s crossfaded into its start (`post`)
    const body = 2;
    const xf = 0.35;
    return {
      name: key, seed, len: body + xf, sr: SR_METAL, stereo: true, gain: SCALE.cymbal, lowpass: aa(SR_METAL), fade: 0,
      build: async (s) => {
        const buses = panBuses(s, [-0.5, 0, 0.5]);
        const modes = plateModes(s, 44);
        for (let k = 0; k < modes.length; k++) {
          // (the plate's partials held: the strokes below keep them ringing)
          const [f, amp] = modes[k];
          const o = s.osc('sine', f, 0, s.len);
          const g = s.ctx.createGain();
          g.gain.value = amp * 0.35;
          o.connect(g).connect(buses[k % 3]);
          if (k % 16 === 15 && s.due()) await s.pace();
        }
        // the strokes: smoothed bumps on two washes, left and right hands in turn
        for (const [side, pan] of [[0, -0.45], [1, 0.45]]) {
          const pts = [[0, 0.55]];
          for (let t = side / 28 + 0.01; t < s.len; t += 1 / 14) {
            const tt = t + s.r(-0.005, 0.005);
            pts.push([tt, 0.55], [tt + 0.025, 0.55 + s.r(0.3, 0.45)], [tt + 0.07, 0.62]);
          }
          pts.push([s.len, 0.55]);
          wash(s, 2500, 6200 + side * 900, 0.5, s.curve(pts.map(([t, v]) => [t, v * 0.9])), pan);
        }
      },
      post: (chans, sr) => {
        const n = Math.round(body * sr);
        const x = Math.round(xf * sr);
        const out = chans.map((c) => {
          const y = c.slice(0, n);
          for (let i = 0; i < x; i++) {
            const u = (i / x) * (Math.PI / 2);
            y[i] = c[i] * Math.sin(u) + c[n + i] * Math.cos(u);
          }
          return y;
        });
        return { chans: out, loop: [0, n / sr] };
      },
    };
  }
  if ((m = /^snare#(\d+)$/.exec(key))) {
    return {
      name: key, seed, len: 0.7, sr: SR_METAL, gain: SCALE.snare, lowpass: aa(SR_METAL), fade: 0.12,
      build: async (s) => {
        await membrane(s, 185 * (1 + s.r(-0.01, 0.01)), [[1, 1, 0.11], [1.59, 0.6, 0.07], [2.14, 0.45, 0.06], [2.3, 0.35, 0.05], [2.65, 0.25, 0.04], [2.92, 0.2, 0.035]], [[0.002, 1]], {
          glide: 1.04, glideTime: 0.02, strike: [['bandpass', 3500, 0.8, 0.45, 0.004], ['lowpass', 800, 0.7, 0.2, 0.008]], shell: null,
        });
        // the wires: a buzz that follows the head
        const pts = [[0.002, 0], [0.004, 0.55], [0.014, 0.5], [0.06, 0.22], [0.16, 0.06], [0.32, 0.012], [0.6, 0]];
        wash(s, 1800, 5200 * (1 + s.r(-0.06, 0.06)), 0.5, s.shape(pts));
      },
    };
  }
  if ((m = /^jingle#(\d+)$/.exec(key))) {
    return {
      name: key, seed, len: 0.5, sr: SR_METAL, gain: SCALE.jingle, lowpass: aa(SR_METAL), fade: 0.1,
      build: async (s) => {
        // three shakes, each ringing the jingles' metallic partials again
        const shakes = [[0.002, 1], [0.019 + s.r(-0.002, 0.002), 0.7], [0.038 + s.r(-0.003, 0.003), 0.45]];
        for (let k = 0; k < 14; k++) {
          const f = s.r(3200, 11000);
          const amp = s.r(0.3, 1);
          const tau = s.r(0.04, 0.16);
          const o = s.osc('sine', f, 0, s.len);
          const g = s.ctx.createGain();
          g.gain.value = 0;
          let a = 0;
          let tPrev = 0;
          for (const [t, v] of shakes) {
            const left = a * Math.exp(-Math.max(0, t - tPrev) / tau);
            a = Math.sqrt(left * left + (amp * v * s.r(0.5, 1)) ** 2);
            g.gain.setValueAtTime(left, t);
            g.gain.linearRampToValueAtTime(a, t + 0.0008);
            g.gain.setTargetAtTime(0, t + 0.0008, tau);
            tPrev = t;
          }
          o.connect(g);
          s.route(g);
          if (s.due()) await s.pace();
        }
        for (const [t, v] of shakes) s.burst(t, 0.12, { type: 'highpass', f: 6000, q: 0.7, attack: 0.0005, tau: 0.02, amp: 0.5 * v });
      },
    };
  }
  if ((m = /^clap#(\d+)$/.exec(key))) {
    return {
      name: key, seed, len: 0.4, sr: SR_LOW, stereo: true, gain: SCALE.clap, lowpass: aa(SR_LOW), fade: 0.08,
      build: (s) => {
        // a crowd of claps over ≈ 30 ms: each its own hands (tone, Q, length) and place
        const n = 7 + Math.floor(s.r(0, 3));
        for (let k = 0; k < n; k++) {
          s.burst(0.002 + s.r(0, 0.032), 0.12, {
            type: 'bandpass', f: s.r(850, 2000), q: s.r(0.9, 1.6), attack: 0.0007, tau: s.r(0.007, 0.013), amp: s.r(0.5, 1), pan: s.r(-0.6, 0.6),
          });
        }
        s.burst(0.012, 0.3, { type: 'bandpass', f: 1200, q: 0.7, attack: 0.004, tau: 0.06, amp: 0.12, pan: -0.2 });
        s.burst(0.014, 0.3, { type: 'bandpass', f: 1300, q: 0.7, attack: 0.004, tau: 0.06, amp: 0.12, pan: 0.2 });
      },
    };
  }
  if ((m = /^lute@(\d+)#(\d+)$/.exec(key))) {
    const midi = Number(m[1]);
    return { name: key, seed, len: 0.9, sr: SR_LOW, gain: SCALE.lute, lowpass: aa(SR_LOW), synth: async (rng, sr, pace) => [await luteString(midi, rng, sr, 0.9, pace)] };
  }
  // (a kind a campaign's pack registered: its own keys and recipes — `registerRendered`)
  for (const x of EXTRA.values()) {
    const job = x.job(key, seed);
    if (job) return job;
  }
  return null;
}

/**
 * A rendered instrument a campaign's audio pack adds to the shared kit (EvermereAudio.js: The Bells
 * of Evermere's bells, evermere/Bells.js) — so the kit's code holds none of it: `keys(ev, beat)` the
 * keys one event plays (as `eventKeys`), `job(key, seed)` the recipe of a key of its own (null for
 * another), `play` its bus (one of the instance's percussion buses: 'bells', 'metal', 'lute' …),
 * level at velocity 1, soft layer and place (as a `PLAY` row), `damp(ev, beat)` where a note is
 * damped (s after its start; 0: rings out).
 * @typedef {{ keys: (ev: any, beat: number) => string[], job: (key: string, seed: number) => MusicJob|null,
 *   play: { bus: ScoreBusName, level: number, soft: number[]|null, pan: number }, damp?: (ev: any, beat: number) => number }} RenderedKind
 */
/** @type {Map<string, RenderedKind>} the rendered kinds a pack registered, by event kind */
const EXTRA = new Map();

/**
 * Register a rendered instrument of a campaign's pack (`RenderedKind`): its events play through
 * `playRendered`, its keys prime with `musicKeys` like the kit's own. Its keys must not collide
 * with the kit's (the kit's recipes are asked first).
 * @param {string} kind
 * @param {RenderedKind} spec
 */
export function registerRendered(kind, spec) {
  EXTRA.set(kind, spec);
}

/**
 * The bus a pack's rendered kind plays on (null: not one) — ScoreVoices.js builds the bells' bus
 * with its reverb send for a track that plays one.
 * @param {string} kind
 * @returns {string|null}
 */
export function renderedBus(kind) {
  return EXTRA.get(kind)?.play.bus ?? null;
}

/**
 * The lute's double course in JS (Karplus–Strong; a WebAudio delay loop cannot be shorter than 128
 * frames): two strings ±3 cents, plucked a tenth of the way along with a bright excitation (0.6),
 * summed, the onset softened, the tail faded; its level the instrument's scale (the excitation's
 * energy is the same at every pitch); `pace` between the strings (its turn awaited when it gives one).
 * @param {number} midi @param {() => number} rng @param {number} sr @param {number} seconds @param {() => Promise<void>|null} pace
 * @returns {Promise<Float32Array>}
 */
async function luteString(midi, rng, sr, seconds, pace) {
  const len = Math.ceil(seconds * sr);
  const out = new Float32Array(len);
  const f0 = mtof(midi);
  const t60 = Math.max(0.6, Math.min(1.6, 1.6 - (midi - 40) * 0.025));
  for (const cents of [-3, 3]) {
    const f = f0 * 2 ** (cents / 1200);
    const P = sr / f;
    const D = P - 0.5;
    const g = 10 ** (-3 / (t60 * f));
    const exN = Math.ceil(P) + 2;
    const d = new Float32Array(len);
    let lp1 = 0;
    let lp2 = 0;
    for (let i = 0; i < exN; i++) {
      lp1 += (rng() * 2 - 1 - lp1) * 0.6;
      lp2 += (lp1 - lp2) * 0.6;
      d[i] = lp2;
    }
    const k = Math.max(1, Math.round(P * 0.1));
    for (let i = exN - 1; i >= k; i--) d[i] -= 0.8 * d[i - k];
    let mean = 0;
    for (let i = 0; i < exN; i++) mean += d[i];
    mean /= exN;
    let e = 0;
    for (let i = 0; i < exN; i++) {
      d[i] -= mean;
      e += d[i] * d[i];
    }
    const norm = e > 0 ? 0.35 / Math.sqrt(e / exN) : 1;
    for (let i = 0; i < exN; i++) d[i] *= norm;
    for (let n = exN; n < len; n++) {
      const pos = n - D;
      const i0 = Math.floor(pos);
      const fr = pos - i0;
      const s0 = d[i0] + (d[i0 + 1] - d[i0]) * fr;
      const s1 = d[i0 - 1] + (d[i0] - d[i0 - 1]) * fr;
      d[n] = g * 0.5 * (s0 + s1);
    }
    for (let i = 0; i < len; i++) out[i] += d[i] * 0.5;
    const turn = pace();
    if (turn) await turn;
  }
  const fadeIn = Math.round(0.0015 * sr);
  const fadeOut = Math.round(0.18 * sr);
  for (let i = 0; i < len; i++) {
    let v = out[i] * SCALE.lute;
    if (i < fadeIn) v *= i / fadeIn;
    const k = len - 1 - i;
    if (k < fadeOut) v *= 0.5 - 0.5 * Math.cos((Math.PI * k) / fadeOut);
    out[i] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Keys: what an event plays, what a track needs
// ---------------------------------------------------------------------------------------------

/**
 * A roll's velocity to the key's 0.1 grid ('0.40'): a score's humanised rolls of one gesture share
 * one render (a difference of under 0.05 in a roll's dynamics is not heard; a render is ≈ 0.4 MB).
 */
const qVel = (v) => (Math.round(Math.max(0, Math.min(1, v)) * 10) / 10).toFixed(2);

/** A round-robin index of `count` from the event's stamped `rr` (0 when the score stamped none). */
const rrOf = (ev, count) => (((Number(/** @type {any} */ (ev).rr) || 0) % count) + count) % count;

/**
 * A timpani roll's rendered length (s): its `dur` beats to the 0.05 s grid, so the rolls of one
 * gesture share a render across tempi (where it starts makes up the rounding: `rollStart`).
 * @param {{ dur?: number }} ev @param {number} beat
 */
const rollLen = (ev, beat) => Math.max(1, Math.round(((ev.dur ?? 0) * beat) / 0.05)) * 0.05;

/**
 * The keys of the buffers one event plays (`beat`: seconds a beat of its section) — what
 * `playRendered` looks up, and what `musicKeys` primes. Empty for a kind not rendered here.
 * @param {ScoreEvent} ev
 * @param {number} beat
 * @returns {string[]}
 */
export function eventKeys(ev, beat) {
  switch (ev.kind) {
    case 'drum': return [`drum:${ev.type}:h#${rrOf(ev, RR.drum)}`];
    case 'timp':
      if (ev.roll) return [`timpRoll@${ev.midi}:${rollLen(ev, beat).toFixed(2)}:${qVel(ev.roll[0])}-${qVel(ev.roll[1])}`];
      return [`timp@${ev.midi}:h#${rrOf(ev, RR.timp)}`];
    case 'toll': return [`toll@${ev.midi}:${ev.decay ?? 6}`];
    case 'tamtam': return ['tamtam'];
    // (a crash, a swell's ring: the head and the tail it rings on in)
    case 'cymbal': return ev.swell && (ev.dur ?? 0) * beat > 0.2 ? ['cymbalSwell', 'cymbalRing', 'cymbalRingTail'] : ['cymbalCrash', 'cymbalCrashTail'];
    case 'snare': return [`snare#${rrOf(ev, RR.snare)}`];
    case 'jingle': return [`jingle#${rrOf(ev, RR.jingle)}`];
    case 'clap': return [`clap#${rrOf(ev, RR.clap)}`];
    case 'lute': return [`lute@${ev.midi}#${rrOf(ev, RR.lute)}`];
    default: return EXTRA.get(ev.kind)?.keys(ev, beat) ?? [];
  }
}

/**
 * The keys of each score track, per score source: a score is fixed at run time, so it is built for
 * its keys once (a build is milliseconds of main thread: `musicReady`, `primeMusic` and
 * `retainMusic` are asked at every start, prime and keep).
 * @type {WeakMap<ScoreSource, Map<string, string[]|null>>}
 */
const KEYS = new WeakMap();

/**
 * Every key a score track's sections can play, each event read with its section's tempo — the set
 * `primeMusic` renders (null: not a score track). Pure: the same score gives the same keys — built
 * once per track and source (the array is shared: never changed by a caller); a build that throws
 * is not kept (it throws again).
 * @param {string} track
 * @param {ScoreSource} scores
 * @returns {string[]|null}
 */
export function musicKeys(track, scores) {
  let byTrack = KEYS.get(scores);
  if (!byTrack) KEYS.set(scores, (byTrack = new Map()));
  if (byTrack.has(track)) return byTrack.get(track);
  const tr = scores(track);
  const keys = tr ? sectionKeys(Object.values(tr.sections), tr.bpm) : null;
  byTrack.set(track, keys);
  return keys;
}

/** The keys of sections' events (their own tempo, else `bpm`), in order of first use. */
function sectionKeys(sections, bpm) {
  const keys = new Set();
  for (const sec of sections) {
    const beat = 60 / (sec.bpm ?? bpm);
    for (const ev of sec.events) for (const k of eventKeys(ev, beat)) keys.add(k);
  }
  return [...keys];
}

// ---------------------------------------------------------------------------------------------
// The music lane: the cache, priming, keeping and freeing
// ---------------------------------------------------------------------------------------------

/** Resident rendered music above which the least recently used sets nobody plays are freed (bytes). */
export const MUSIC_CAP = 32 * 1024 * 1024;
/** A buffer used (primed, played) this recently is never freed (ms). */
const GRACE_MS = 10000;
/** How much each owner's keeping counts when the cap frees sets (the level played most). */
const RANK = Object.freeze({ next: 1, story: 2, level: 3 });

/**
 * A rendered buffer of the lane: the buffer once made (null while it renders), its promise, its loop
 * (s), its bytes, when it was last primed or played (performance.now()), whether an owner ever kept
 * it (only those are freed when released: a page that primes without keeping keeps what it primed).
 * @typedef {{ buffer: AudioBuffer|null, pending: Promise<AudioBuffer>|null, loop: [number, number]|null, bytes: number, used: number, kept: boolean }} MusicEntry
 */

const MUSIC = {
  /** @type {Map<string, MusicEntry>} */
  entries: new Map(),
  bytes: 0,
  mainMs: 0,
  maxBlockMs: 0,
  renderMs: 0,
  missed: 0,
  /** @type {string[]} */
  slow: [],
  /** @type {Map<string, Promise<{ ok: boolean, failed: string[] }>>} primes going on, by track */
  primes: new Map(),
  /** @type {Map<string, string[]>} the keys of the primes going on (never freed meanwhile) */
  pinned: new Map(),
  /** @type {Map<string, { keys: string[], bytes: number, ms: number, ok: boolean }>} the tracks primed */
  tracks: new Map(),
  /** @type {Map<MusicOwner, Map<string, string[]>>} what each owner keeps: track → its keys */
  owners: new Map(),
  /** The music instances that played a rendered note last (the newest four): their keys are not freed while they play. @type {any[]} */
  live: [],
  /** @type {WeakMap<object, Set<string>>} an instance's keys (its sections, each with its tempo) */
  instanceKeys: new WeakMap(),
  /** @type {Set<string>} keys whose failure was logged */
  logged: new Set(),
  /** The sweep asked for later (a timer id; 0 none): what a sweep could not free yet — in its grace, playing — goes then. */
  later: 0,
};

/**
 * One key's buffer: rendered once (concurrent asks share the render); a failed render is forgotten
 * (a later prime tries again) and rejects.
 * @param {string} key
 * @returns {Promise<AudioBuffer>}
 */
function loadKey(key) {
  let e = MUSIC.entries.get(key);
  if (e?.buffer) return Promise.resolve(e.buffer);
  if (e?.pending) return e.pending;
  const job = jobOf(key);
  if (!job) return Promise.reject(new Error(`no recipe renders "${key}"`));
  const entry = e ?? { buffer: null, pending: null, loop: null, bytes: 0, used: 0, kept: false };
  MUSIC.entries.set(key, entry);
  const t0 = performance.now();
  entry.pending = renderMusic(job, MUSIC.slow).then(
    (r) => {
      entry.buffer = r.buffer;
      entry.loop = r.loop;
      entry.bytes = r.bytes;
      entry.used = performance.now();
      entry.pending = null;
      MUSIC.bytes += r.bytes;
      MUSIC.mainMs += r.mainMs;
      MUSIC.maxBlockMs = Math.max(MUSIC.maxBlockMs, r.maxBlockMs);
      MUSIC.renderMs += performance.now() - t0;
      return r.buffer;
    },
    (err) => {
      if (MUSIC.entries.get(key) === entry) MUSIC.entries.delete(key);
      throw err;
    },
  );
  return entry.pending;
}

/** A key that could not be rendered: logged once (MUSIC.logged). @param {string} key @param {unknown} err */
function logFailure(key, err) {
  if (MUSIC.logged.has(key)) return;
  MUSIC.logged.add(key);
  console.error(`[AudioSystem] could not render the music buffer "${key}":`, err);
}

/** The sample bytes of keys resident now. @param {readonly string[]} keys */
function bytesOf(keys) {
  let b = 0;
  for (const k of keys) b += MUSIC.entries.get(k)?.bytes ?? 0;
  return b;
}

/**
 * Render every buffer a score track's sections play, ahead of its first note (VanquishAudio.js
 * `primeMusic`, AudioSystem `primeMusic`): one key after another (a track at a time per lane: two
 * tracks primed together render side by side), the keys another track shares rendered once. Never
 * rejects: `failed` names the keys that could not be rendered (the track itself when its score could
 * not be built or it is not a score track); the same track asked again while it primes gets the same
 * promise.
 * @param {string} track
 * @param {ScoreSource} scores
 * @returns {Promise<{ ok: boolean, failed: string[] }>}
 */
export function primeMusic(track, scores) {
  const going = MUSIC.primes.get(track);
  if (going) return going;
  /** @type {string[]|null} */
  let keys;
  try {
    keys = musicKeys(track, scores);
  } catch (err) {
    console.error(`[AudioSystem] the music of "${track}" could not be built:`, err);
    return Promise.resolve({ ok: false, failed: [track] });
  }
  if (!keys) return Promise.resolve({ ok: false, failed: [track] });
  const now = performance.now();
  if (keys.every((k) => MUSIC.entries.get(k)?.buffer)) {
    for (const k of keys) MUSIC.entries.get(k).used = now;
    const prev = MUSIC.tracks.get(track);
    MUSIC.tracks.set(track, { keys, bytes: bytesOf(keys), ms: prev?.ms ?? 0, ok: true });
    return Promise.resolve({ ok: true, failed: [] });
  }
  const run = async () => {
    /** @type {string[]} */
    const failed = [];
    try {
      for (const key of keys) {
        const e = MUSIC.entries.get(key);
        if (e?.buffer) {
          e.used = performance.now();
          continue;
        }
        try {
          await loadKey(key);
        } catch (err) {
          failed.push(key);
          logFailure(key, err);
        }
      }
      const t1 = performance.now();
      for (const k of keys) {
        const e = MUSIC.entries.get(k);
        if (e) e.used = t1;
      }
      MUSIC.tracks.set(track, { keys, bytes: bytesOf(keys), ms: t1 - now, ok: failed.length === 0 });
    } catch (err) {
      failed.push(track);
      console.error(`[AudioSystem] priming the music of "${track}" failed:`, err);
    } finally {
      MUSIC.primes.delete(track);
      MUSIC.pinned.delete(track);
      if (MUSIC.owners.size) sweep();
    }
    return { ok: failed.length === 0, failed };
  };
  MUSIC.pinned.set(track, keys);
  const p = run();
  MUSIC.primes.set(track, p);
  return p;
}

/**
 * Whether every buffer of a score track is rendered (VanquishAudio.js `musicReady`; false for a name
 * that is not a score track).
 * @param {string} track
 * @param {ScoreSource} scores
 * @returns {boolean}
 */
export function musicReady(track, scores) {
  let keys;
  try {
    keys = musicKeys(track, scores);
  } catch {
    return false;
  }
  return !!keys && keys.every((k) => MUSIC.entries.get(k)?.buffer);
}

/**
 * Keep the rendered music of `tracks` for `owner` instead of what it kept before (VanquishAudio.js
 * `retainMusic`; it renders nothing — `primeMusic` does). A key several tracks share is kept while
 * one of them is; what no owner keeps any more is freed unless an instance plays it or it was used
 * in the last seconds, and above `MUSIC_CAP` resident the least recently used of what the level
 * played does not keep goes too ('next' before 'story'). What the owner keeps of another score
 * source (the other campaign's pack: VanquishAudio.js, EvermereAudio.js) stays kept — with one
 * source, as before, the call replaces all that the owner kept.
 * @param {MusicOwner} owner
 * @param {readonly string[]} tracks
 * @param {ScoreSource} scores
 */
export function retainMusic(owner, tracks, scores) {
  /** @type {Map<string, string[]>} */
  const sets = new Map();
  // (the owner's tracks of another source first, kept as they were)
  for (const [t, keys] of MUSIC.owners.get(owner) ?? []) {
    let mine;
    try {
      mine = musicKeys(t, scores) !== null;
    } catch {
      mine = true;
    }
    if (!mine) sets.set(t, keys);
  }
  for (const t of new Set(tracks)) {
    try {
      const keys = musicKeys(t, scores);
      if (keys) sets.set(t, keys);
    } catch (err) {
      console.error(`[AudioSystem] the music of "${t}" could not be built:`, err);
    }
  }
  if (sets.size) MUSIC.owners.set(owner, sets);
  else MUSIC.owners.delete(owner);
  sweep();
}

/** The keys of the instances that play now (not stopping). */
function liveKeys() {
  const out = new Set();
  MUSIC.live = MUSIC.live.filter((m) => !m.stopping);
  for (const m of MUSIC.live) {
    let keys = MUSIC.instanceKeys.get(m);
    if (!keys) {
      keys = new Set(m.sections ? sectionKeys(Object.values(m.sections), m.bpm) : []);
      MUSIC.instanceKeys.set(m, keys);
    }
    for (const k of keys) out.add(k);
  }
  return out;
}

/** Free a rendered buffer. @param {string} key @param {MusicEntry} e */
function free(key, e) {
  MUSIC.bytes -= e.bytes;
  MUSIC.entries.delete(key);
}

/**
 * Free what no owner keeps any more (rendered, kept once, not playing, not being primed, unused for
 * GRACE_MS), then — above MUSIC_CAP — the least recently used buffers the level does not keep.
 * What it could not free yet for its grace or its playing (released, or over the cap) is swept
 * again after GRACE_MS (one timer at a time): a set released between two music calls does not stay
 * resident until the next one (a level later).
 */
function sweep() {
  const now = performance.now();
  /** @type {Map<string, number>} key → the highest rank of an owner keeping it */
  const held = new Map();
  for (const [owner, sets] of MUSIC.owners) for (const keys of sets.values()) for (const k of keys) held.set(k, Math.max(held.get(k) ?? 0, RANK[owner]));
  const keep = liveKeys();
  for (const keys of MUSIC.pinned.values()) for (const k of keys) keep.add(k);
  const idle = (e) => now - e.used > GRACE_MS;
  let later = false;
  for (const [k, e] of MUSIC.entries) {
    if (held.has(k)) e.kept = true;
    else if (e.buffer && e.kept) {
      if (!keep.has(k) && idle(e)) free(k, e);
      else later = true;
    }
  }
  if (MUSIC.bytes > MUSIC_CAP) {
    const cands = [...MUSIC.entries].filter(([k, e]) => e.buffer && (held.get(k) ?? 0) < RANK.level);
    const ready = cands.filter(([k, e]) => !keep.has(k) && idle(e));
    ready.sort((x, y) => (held.get(x[0]) ?? 0) - (held.get(y[0]) ?? 0) || x[1].used - y[1].used);
    for (const [k, e] of ready) {
      if (MUSIC.bytes <= MUSIC_CAP) break;
      free(k, e);
    }
    // (still over: what may go once its grace or its playing is over)
    if (MUSIC.bytes > MUSIC_CAP && cands.length > ready.length) later = true;
  }
  if (later && !MUSIC.later) {
    MUSIC.later = setTimeout(() => {
      MUSIC.later = 0;
      sweep();
    }, GRACE_MS + 50);
  }
}

/**
 * A piece of the music lane's main-thread work that is not a render (VanquishAudio.js's warm of a
 * track, ScoreVoices.js `warmVoices`): counted with the renders' main-thread time and longest
 * block, and above 6 ms in the slow list (its label ending in "<n> ms", as a render's).
 * @param {string} label
 * @param {number} ms
 */
export function noteBlock(label, ms) {
  MUSIC.mainMs += ms;
  MUSIC.maxBlockMs = Math.max(MUSIC.maxBlockMs, ms);
  if (ms > 6 && MUSIC.slow.length < 12) MUSIC.slow.push(`${label} ${ms.toFixed(1)} ms`);
}

/**
 * The music renders' statistics (VanquishAudio.js `musicRenders`; a fresh object each call;
 * `waitMs` is the AudioSystem's).
 * @returns {MusicRenderStats}
 */
export function musicRenders() {
  let buffers = 0;
  for (const e of MUSIC.entries.values()) if (e.buffer) buffers++;
  /** @type {Record<string, { keys: number, bytes: number, ms: number, ok: boolean }>} */
  const tracks = {};
  const primed = [];
  for (const [t, s] of MUSIC.tracks) {
    tracks[t] = { keys: s.keys.length, bytes: s.bytes, ms: Math.round(s.ms), ok: s.ok };
    if (s.keys.every((k) => MUSIC.entries.get(k)?.buffer)) primed.push(t);
  }
  /** @type {Record<string, string[]>} */
  const retained = {};
  for (const [owner, sets] of MUSIC.owners) retained[owner] = [...sets.keys()];
  return {
    buffers, bytes: MUSIC.bytes, mainMs: +MUSIC.mainMs.toFixed(1), maxBlockMs: +MUSIC.maxBlockMs.toFixed(2), missed: MUSIC.missed, waitMs: 0,
    primed, renderMs: Math.round(MUSIC.renderMs), slow: [...MUSIC.slow], retained, tracks,
  };
}

// ---------------------------------------------------------------------------------------------
// Playing the rendered instruments
// ---------------------------------------------------------------------------------------------

/**
 * Each kind's play: its score bus, its level at velocity 1, the soft layer's lowpass ([Hz at
 * velocity 0.15, Hz at SOFT_BELOW]; none: no soft layer) and its place.
 * @type {Readonly<Record<string, { bus: ScoreBusName, level: number, soft: number[]|null, pan: number }>>}
 */
const PLAY = Object.freeze({
  // (a drum's level × its type's: DRUMS)
  drum: { bus: 'drums', level: 1, soft: [450, 4000], pan: 0 },
  frame: { bus: 'drums', level: 1, soft: [700, 5000], pan: -0.1 },
  timp: { bus: 'timp', level: 0.88, soft: [500, 3500], pan: -0.15 },
  toll: { bus: 'bells', level: 0.58, soft: null, pan: 0.15 },
  tamtam: { bus: 'metal', level: 0.25, soft: [1500, 9000], pan: 0 },
  cymbal: { bus: 'metal', level: 0.27, soft: [2500, 10000], pan: 0 },
  snare: { bus: 'drums', level: 0.36, soft: [1500, 9000], pan: 0.1 },
  jingle: { bus: 'metal', level: 0.18, soft: [3000, 11000], pan: 0.25 },
  clap: { bus: 'drums', level: 0.32, soft: null, pan: 0 },
  lute: { bus: 'lute', level: 0.7, soft: [1200, 6000], pan: 0 },
});
/** Below this velocity a stroke is the soft layer (the hard buffer through a static lowpass). */
const SOFT_BELOW = 0.7;
/** The swell's ring at the bar line against the body's peak (their renders' levels matched, a small accent). */
const RING_MATCH = 0.45;
/** A swell's level against a crash's of the same velocity (the roll gathers to a climax). */
const SWELL_GAIN = 2;

/**
 * The name of the bus an event of a kind plays into: its family's (`p.bus`), else for a `far` event
 * the far bus — a far drum's own (`farDrums`: through the drums' mix EQ) when the instance has one.
 * @param {any} m @param {{ bus: ScoreBusName }} p @param {{ kind: string, far?: boolean }} ev
 * @returns {string}
 */
const busName = (m, p, ev) => (!ev.far ? p.bus : ev.kind === 'drum' && m.bus.farDrums ? 'farDrums' : 'far');
/**
 * The bus an event plays into: the instance's bus of that name (`m.bus[name]`, ScoreVoices.js
 * `scoreBuses`; `busName`).
 * @param {any} m @param {{ bus: ScoreBusName }} p @param {{ kind: string, far?: boolean }} ev
 * @returns {AudioNode}
 */
const busOf = (m, p, ev) => m.bus[busName(m, p, ev)];
/**
 * That bus's level (the track's `mix`), played in the voice's own gain (`m.busGain`, ScoreVoices.js
 * `scoreBuses`: no gain node on the bus).
 * @param {any} m @param {{ bus: ScoreBusName }} p @param {{ kind: string, far?: boolean }} ev
 * @returns {number}
 */
const busGainOf = (m, p, ev) => m.busGain[busName(m, p, ev)];

/**
 * The instance `m`'s shared seat into `dest` at `pan` for mono buffers (built on first use; one of
 * the instance's nodes): mono sounds each panned, or summed and panned once, are the same signal,
 * with one node less a note.
 * @param {VoiceHost} a @param {any} m @param {AudioNode} dest @param {number} pan
 * @returns {StereoPannerNode}
 */
function seatOf(a, m, dest, pan) {
  m.bufferSeats ??= new Map();
  let byPan = m.bufferSeats.get(dest);
  if (!byPan) m.bufferSeats.set(dest, (byPan = new Map()));
  let pn = byPan.get(pan);
  if (!pn) {
    pn = a.ctx.createStereoPanner();
    pn.pan.value = pan;
    pn.connect(dest);
    m.nodes.push(pn);
    byPan.set(pan, pn);
  }
  return pn;
}

/**
 * A rendered buffer at `t` (seconds), its velocity `vel` (dynamics 0–1: the level, and below
 * SOFT_BELOW the soft layer's lowpass), into `dest` of the instance `m`: BufferSource → Gain →
 * [lowpass] → [panner] → dest (2–4 nodes; a mono buffer through the instance's shared seat at its
 * pan, `seatOf`). `gain` scales the level (a drum type's, the bus's); `damp` (s after `t`): the
 * note is damped there (the lute); `ringOn`: the tail it rings on in (a crash's: from its head's
 * fade, into the same gain — one node more). Returns the source that ends last and its nodes (for
 * `_cleanup`).
 * @param {VoiceHost} a @param {any} m @param {MusicEntry} e @param {number} t @param {number} vel
 * @param {{ level: number, soft: number[]|null, pan: number }} p @param {number} pan
 * @param {AudioNode} dest @param {{ gain?: number, damp?: number, ringOn?: MusicEntry|null }} [o]
 */
function playBuffer(a, m, e, t, vel, p, pan, dest, { gain = 1, damp = 0, ringOn = null } = {}) {
  const ctx = a.ctx;
  const src = ctx.createBufferSource();
  src.buffer = e.buffer;
  const g = ctx.createGain();
  g.gain.value = 0;
  g.gain.setValueAtTime(p.level * gain * Math.max(0, vel), t);
  /** @type {AudioNode[]} */
  const nodes = [src, g];
  /** @type {AudioNode} */
  let tail = src.connect(g);
  if (p.soft && vel < SOFT_BELOW) {
    const u = Math.max(0, Math.min(1, (vel - 0.15) / (SOFT_BELOW - 0.15)));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.automationRate = 'k-rate';
    lp.Q.automationRate = 'k-rate';
    lp.frequency.value = p.soft[0] * (p.soft[1] / p.soft[0]) ** u;
    lp.Q.value = 0.6;
    tail = tail.connect(lp);
    nodes.push(lp);
  }
  const at = Math.max(-1, Math.min(1, pan));
  if (e.buffer.numberOfChannels === 1) tail.connect(seatOf(a, m, dest, at));
  else if (at !== 0) {
    const pn = ctx.createStereoPanner();
    pn.pan.value = at;
    tail.connect(pn).connect(dest);
    nodes.push(pn);
  } else tail.connect(dest);
  src.start(t);
  if (damp > 0 && damp + 0.32 < e.buffer.duration) {
    g.gain.setTargetAtTime(0, t + damp, 0.045);
    src.stop(t + damp + 0.32);
  }
  e.used = performance.now();
  if (!ringOn) return { src, nodes };
  return { src: ringTail(ctx, ringOn, t, g, nodes), nodes };
}

/**
 * A cymbal's tail (`cymbalCrashTail`, `cymbalRingTail`) into `g` from the head's fade on — the head
 * struck at `t` — added to `nodes`; returns its source (it ends last).
 * @param {BaseAudioContext} ctx @param {MusicEntry} e @param {number} t @param {AudioNode} g @param {AudioNode[]} nodes
 */
function ringTail(ctx, e, t, g, nodes) {
  const src = ctx.createBufferSource();
  src.buffer = e.buffer;
  src.connect(g);
  src.start(t + CYMBAL_HEAD - CYMBAL_FADE);
  e.used = performance.now();
  nodes.push(src);
  return src;
}

/**
 * When a timpani roll's buffer starts (its event at `tt`, jitter included): its last stroke
 * (ROLL_AT + its rendered length into it, `rollLen`) strikes where the stroke it ends on does — the
 * timpani's hit at its notated end (`endHit`: that hit's own jitter) — else on that end, its own
 * jitter kept; never before now. (Its length is rounded for the render: started at its notated
 * time, its last stroke flammed with that hit by up to 25 ms.) Returns that start and where the
 * last stroke lands (s).
 * @param {VoiceHost} a @param {{ beat: number, dur?: number, jitter?: number, midi: number }} ev
 * @param {number} tt @param {number} beat @param {any} m
 * @returns {{ at: number, lands: number }}
 */
function rollStart(a, ev, tt, beat, m) {
  const hit = endHit(m, ev.beat + (ev.dur ?? 0), ev.midi);
  const len = rollLen(ev, beat);
  const lands = tt - (ev.jitter ?? 0) + (ev.dur ?? 0) * beat + (hit ? hit.jitter ?? 0 : ev.jitter ?? 0) + HIT_AT;
  const at = Math.max(lands - ROLL_AT - len, a.ctx.currentTime);
  return { at, lands: at + ROLL_AT + len };
}

/**
 * A timpani stroke landing on a roll of its pitch (struck where the roll's last stroke lands,
 * within LAND_TOL) takes the roll over — two renders of one drum struck together ring at whatever
 * phase they meet, and cancel as often as not: the roll is damped at the stroke (τ LAND_DAMP) and
 * the stroke carries the roll's ring in its own level, the energies added as one membrane's modes
 * add (`membrane`: √(a² + b²) — the roll's level there, LAND_WIN of its buffer from its last
 * stroke, and the stroke's, LAND_WIN of its own), accented: at least the roll's top + LAND_ACCENT
 * (≤ 1). A roll that nothing lands on rings on (a switch that takes its hit away never cuts it).
 */
const LAND_TOL = 0.03;
const LAND_DAMP = 0.006;
const LAND_WIN = 0.2;
const LAND_ACCENT = 0.25;
/** A timpani buffer's RMS over LAND_WIN from `from` s, by key and offset (a key always renders the same). @type {Map<string, number>} */
const LAND_RMS = new Map();
/** @param {string} key @param {MusicEntry} e @param {number} from */
function landRms(key, e, from) {
  const id = `${key}@${from.toFixed(4)}`;
  let v = LAND_RMS.get(id);
  if (v === undefined) {
    const buf = /** @type {AudioBuffer} */ (e.buffer);
    const i0 = Math.max(0, Math.round(from * buf.sampleRate));
    const i1 = Math.min(buf.length, i0 + Math.round(LAND_WIN * buf.sampleRate));
    let sum = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = i0; i < i1; i++) sum += d[i] * d[i];
    }
    v = Math.sqrt(sum / Math.max(1, (i1 - i0) * buf.numberOfChannels));
    LAND_RMS.set(id, v);
  }
  return v;
}

/**
 * The timpani hit (not a roll) on beat `at` of the instance `m`'s music to come: in the section
 * playing — or, at its end or past a bar line where a switch was asked for, on the first beats of
 * the section that follows (the one asked for, else the one its order takes: AudioSystem's
 * `m.next` on a stand-in, which moves only the stand-in's name) —, one of pitch `midi` before
 * another; null: none.
 * @param {any} m @param {number} at @param {number} midi
 * @returns {{ jitter?: number }|null}
 */
function endHit(m, at, midi) {
  let sec = m.section;
  if (m.switchAt >= 0 && at >= m.switchAt - 1e-6) {
    sec = m.sections[m.pending];
    at -= m.switchAt;
  } else if (at >= sec.lengthBeats - 1e-6) {
    at -= sec.lengthBeats;
    sec = m.pending !== null ? m.sections[m.pending] : m.next({ sectionName: m.sectionName });
  }
  let hit = null;
  for (const e of sec?.events ?? []) {
    if (e.beat > at + 1e-6) break;
    if (e.kind === 'timp' && !e.roll && Math.abs(e.beat - at) < 1e-6 && (!hit || e.midi === midi)) hit = e;
  }
  return hit;
}

/**
 * Play one event of a rendered instrument at `tt`, `beat` seconds a beat, on the instance `m`'s
 * buses (ScoreVoices.js `scoreVoice` hands over every event it does not play itself). Its buffer
 * missing (its track not primed, a render that failed): the note is skipped and counted (`missed`),
 * its render asked for — never played late.
 * @param {VoiceHost} a
 * @param {ScoreEvent} ev
 * @param {number} tt
 * @param {number} beat
 * @param {any} m the music instance
 * @returns {boolean} false: not a kind it plays (`scoreVoice` reports it)
 */
export function playRendered(a, ev, tt, beat, m) {
  const keys = eventKeys(ev, beat);
  if (!keys.length) return false;
  const entries = keys.map((k) => MUSIC.entries.get(k));
  if (entries.some((e) => !e?.buffer)) {
    MUSIC.missed++;
    // (asked for again unless it failed already: a recipe that fails fails every time — not a
    // render started for every note of it)
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!entries[i]?.buffer && !MUSIC.logged.has(k)) loadKey(k).catch((err) => logFailure(k, err));
    }
    return true;
  }
  if (!MUSIC.live.includes(m)) {
    MUSIC.live.push(m);
    if (MUSIC.live.length > 4) MUSIC.live.shift();
  }
  const extra = ev.pan ?? 0;
  switch (ev.kind) {
    case 'drum': {
      const type = ev.type;
      const p = type.startsWith('frame') ? PLAY.frame : PLAY.drum;
      const { src, nodes } = playBuffer(a, m, entries[0], tt, ev.vel, p, p.pan + extra, busOf(m, p, ev), { gain: DRUMS[type].level * busGainOf(m, p, ev) });
      a._cleanup(src, nodes);
      return true;
    }
    case 'timp': {
      const p = PLAY.timp;
      const gain = busGainOf(m, p, ev);
      if (ev.roll) {
        // (a roll carries its dynamics in its render, its last stroke on the stroke it ends on —
        // which takes it over there: LAND_TOL)
        const { at, lands } = rollStart(a, ev, tt, beat, m);
        const { src, nodes } = playBuffer(a, m, entries[0], at, 1, p, p.pan + extra, busOf(m, p, ev), { gain });
        a._cleanup(src, nodes);
        m.timpRing = { midi: ev.midi, lands, top: ev.roll[1], src, g: nodes[1], level: gain * landRms(keys[0], entries[0], lands - at) };
        return true;
      }
      let vel = ev.vel ?? 0;
      let k = 1;
      const ring = m.timpRing;
      const strikes = tt + HIT_AT;
      if (ring && ring.midi === ev.midi && Math.abs(strikes - ring.lands) <= LAND_TOL) {
        m.timpRing = null;
        /** @type {GainNode} */ (ring.g).gain.setTargetAtTime(0, strikes, LAND_DAMP);
        /** @type {AudioBufferSourceNode} */ (ring.src).stop(strikes + LAND_DAMP * 12);
        vel = Math.max(vel, Math.min(1, ring.top + LAND_ACCENT));
        const own = gain * vel * landRms(keys[0], entries[0], HIT_AT);
        k = Math.sqrt(1 + (ring.level / Math.max(own, 1e-9)) ** 2);
      } else if (ring && ring.lands < strikes - LAND_TOL) m.timpRing = null;
      const { src, nodes } = playBuffer(a, m, entries[0], tt, vel, p, p.pan + extra, busOf(m, p, ev), { gain: gain * k });
      a._cleanup(src, nodes);
      return true;
    }
    case 'toll': {
      const p = PLAY.toll;
      const { src, nodes } = playBuffer(a, m, entries[0], tt, ev.vel, p, p.pan + extra, busOf(m, p, ev), { gain: busGainOf(m, p, ev) });
      a._cleanup(src, nodes);
      return true;
    }
    case 'cymbal': {
      const p = PLAY.cymbal;
      const dest = busOf(m, p, ev);
      const gain = busGainOf(m, p, ev);
      if (keys.length === 2) {
        const { src, nodes } = playBuffer(a, m, entries[0], tt, ev.vel, p, extra, dest, { gain, ringOn: entries[1] });
        a._cleanup(src, nodes);
        return true;
      }
      cymbalSwell(a, entries[0], entries[1], entries[2], tt, (ev.dur ?? 0) * beat, ev.vel * gain, extra, dest);
      return true;
    }
    case 'tamtam': case 'snare': case 'jingle': case 'clap': {
      const p = PLAY[ev.kind];
      const { src, nodes } = playBuffer(a, m, entries[0], tt, ev.vel, p, p.pan + extra, busOf(m, p, ev), { gain: busGainOf(m, p, ev) });
      a._cleanup(src, nodes);
      return true;
    }
    case 'lute': {
      const p = PLAY.lute;
      const { src, nodes } = playBuffer(a, m, entries[0], tt, ev.vel, p, extra, busOf(m, p, ev), { gain: busGainOf(m, p, ev), damp: Math.max(0.05, ev.dur * beat) });
      a._cleanup(src, nodes);
      return true;
    }
    default: {
      // (a pack's rendered kind: `registerRendered`)
      const x = EXTRA.get(ev.kind);
      if (!x) return false;
      const p = x.play;
      const e = /** @type {any} */ (ev);
      const { src, nodes } = playBuffer(a, m, entries[0], tt, e.vel, p, p.pan + extra, busOf(m, p, ev), { gain: busGainOf(m, p, ev), damp: x.damp?.(ev, beat) ?? 0 });
      a._cleanup(src, nodes);
      return true;
    }
  }
}

/**
 * The suspended cymbal's swell: the rolled body (a loop) swelling to the bar line `dur` s after `t`,
 * where the climax rings on (`cymbalRing` at the body's peak level, a small accent: RING_MATCH; the
 * body hands over in ≈ 60 ms; the ring's tail from its fade on, `ringTail`) — never cut. 5 nodes
 * (+ a panner for an extra `pan`), one `_cleanup` on the ring's tail (it ends last).
 * @param {VoiceHost} a @param {MusicEntry} body @param {MusicEntry} ring @param {MusicEntry} rest @param {number} t
 * @param {number} dur @param {number} vel @param {number} pan @param {AudioNode} dest
 */
function cymbalSwell(a, body, ring, rest, t, dur, vel, pan, dest) {
  const ctx = a.ctx;
  const peak = PLAY.cymbal.level * SWELL_GAIN * Math.max(0, vel);
  let out = dest;
  /** @type {AudioNode[]} */
  const nodes = [];
  if (pan) {
    const pn = ctx.createStereoPanner();
    pn.pan.value = Math.max(-1, Math.min(1, pan));
    pn.connect(dest);
    out = pn;
    nodes.push(pn);
  }
  const src = ctx.createBufferSource();
  src.buffer = body.buffer;
  src.loop = true;
  if (body.loop) {
    src.loopStart = body.loop[0];
    src.loopEnd = body.loop[1];
  }
  const g = ctx.createGain();
  g.gain.value = 0;
  // (a crescendo that gathers toward the bar line)
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.06 * peak, t + dur * 0.4);
  g.gain.linearRampToValueAtTime(0.32 * peak, t + dur * 0.78);
  g.gain.linearRampToValueAtTime(peak, t + dur);
  g.gain.setTargetAtTime(0, t + dur, 0.02);
  src.connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.2);
  const r = ctx.createBufferSource();
  r.buffer = ring.buffer;
  const rg = ctx.createGain();
  rg.gain.value = 0;
  rg.gain.setValueAtTime(peak * RING_MATCH, t + dur - 0.004);
  r.connect(rg).connect(out);
  r.start(t + dur - 0.004);
  body.used = ring.used = performance.now();
  nodes.push(src, g, r, rg);
  a._cleanup(ringTail(ctx, rest, t + dur - 0.004, rg, nodes), nodes);
}
