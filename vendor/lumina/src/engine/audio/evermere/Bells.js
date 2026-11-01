/**
 * Bells — The Bells of Evermere's bells (docs/contracts/EVERMERE_CAMPAIGN.md §6.8): rendered, never
 * live (a live doublet bell would cost ≈ 50 nodes a stroke; a rendered one costs two to four):
 *   - the great bells (`bell`): a cast bell's partials — the hum an octave down, the prime, the
 *     tierce, the quint, the nominal and the upper partials —, every one a beating doublet dying at
 *     its own rate, a clapper's strike, and the swing: the bell turning toward the listener and away
 *     as it rings (its pitch ± 0.2 %, its brightness more than its body). Two tierces: the major one
 *     of the four Season Bells (`maj`: spring and summer under the frost) and the minor one of the
 *     black Hush Bell (`min`), whose prime and tierce beat roughly and whose crack rattles. The Hush
 *     Bell and the Bell of Rest are one pitch, D3: the same bronze, recast;
 *   - the tubular bells (`tubular`): a free-free tube's modes (≈ 0.62, 1.21, 2, 2.99, 4.17, 5.56 of
 *     the strike note, which the ear builds from the 2 : 3 : 4 of the middle ones) under a rawhide
 *     mallet;
 *   - the handbells (`handbell`): the fundamental and the twelfth of an English handbell, the
 *     clapper's tick, a flick of the wrist (the cantor's, Brother Fallow's);
 *   - the celesta / music box (`chime`): a steel bar over its resonator — a pure fundamental, a
 *     whisper of the octave — with the tine's ping, a felt hammer; the motif's lead: a melodic kind
 *     (`lead` events count, ScoreKit.js), not percussion.
 * The four are rendered instruments of the shared score kit, registered with MusicRenders.js
 * (`registerBells`: their keys, recipes and plays), so the kit's own code holds none of them and
 * Vanquish's renders are untouched (its `toll@<midi>:<decay>` is its own and never retuned). The
 * same drawing functions make the bell sounds (EvermereAudio.js: `bellToll`, `bellTollBlack`,
 * `hushToll`, `waysideChime`, `tollBell`, `carillon`, `memoryChime` …).
 *
 * Keys (seeded by `hashName(key)`, so adding a pitch never re-seeds another): `bell@50:maj:7` (a
 * great bell at MIDI 50, the major tierce, its hum ringing 7 s), `tubular@69`, `handbell@81`,
 * `chime@76`. One shared scale per instrument (`SCALE`): pitches keep their level relation.
 *
 * Pure: imports ScoreKit.js only (`mtof`); runs its recipes in a RenderKit.js Sketch. Imported only
 * through EvermereAudio.js.
 */
import { mtof } from '../vanquish/ScoreKit.js';

/**
 * @import { Sketch, MusicJob } from '../vanquish/RenderKit.js'
 */
/**
 * A rendered kind as MusicRenders.js `registerRendered` takes it (its `RenderedKind`; written out
 * here so the Node tools that read this module never load MusicRenders.js's types).
 * @typedef {{ keys: (ev: any, beat: number) => string[], job: (key: string, seed: number) => MusicJob|null,
 *   play: { bus: 'bells'|'metal'|'lute', level: number, soft: number[]|null, pan: number }, damp?: (ev: any, beat: number) => number }} RenderedKind
 */

/** Sample rate of the great bells and the tubular bells (their partials end below 6 kHz). */
export const SR_BELL = 16000;
/** Sample rate of the handbells and the celesta (their pings reach 7 kHz). */
export const SR_CHIME = 24000;
/** The anti-imaging lowpass of a render at `sr`. */
const aa = (sr) => sr * 0.42;

/**
 * A great bell's partials against its strike note (the prime): [ratio, level, decay share]; the
 * tierce (index 2) by its type — 1.26 the major third of the Season Bells, 1.19 the minor of the
 * Hush Bell.
 */
const GREAT = Object.freeze([[0.5, 0.55, 1], [1, 0.42, 0.62], [1.26, 0.3, 0.5], [1.5, 0.12, 0.34], [2, 0.36, 0.42], [2.52, 0.1, 0.24],
  [2.67, 0.08, 0.21], [3, 0.07, 0.18], [4.03, 0.05, 0.12], [4.24, 0.035, 0.1], [5.33, 0.025, 0.08], [6, 0.02, 0.07]]);
/** The minor tierce of the Hush Bell. */
const MINOR_TIERCE = 1.19;
/** The swing of a tolling bell: its period (s), its pitch's depth, the body's and the brightness's level depth. */
const SWING = Object.freeze({ period: 2.6, pitch: 0.002, body: 0.06, bright: 0.24 });

/** A tubular bell's modes against its strike note: [ratio, level, τ at C5 (s)]. */
const TUBE = Object.freeze([[0.617, 0.16, 1.5], [1.21, 0.48, 1.7], [2, 1, 1.45], [2.99, 0.7, 1.05], [4.17, 0.42, 0.72], [5.56, 0.22, 0.48], [7.14, 0.1, 0.3]]);
/** A handbell's partials: [ratio, level, τ at C6 (s)] — the fundamental and the twelfth above all. */
const HAND = Object.freeze([[1, 1, 0.85], [2, 0.05, 0.4], [3, 0.42, 0.42], [4.2, 0.06, 0.17], [5.4, 0.05, 0.11], [6.8, 0.03, 0.07]]);

/**
 * The shared render scale of each instrument (the buffers' level relation kept), set so its loudest
 * buffer peaks below ≈ 0.9.
 */
export const SCALE = Object.freeze({ bell: 0.36, tubular: 0.3, handbell: 0.5, chime: 0.62 });

/**
 * Decaying sine partials [[Hz, level, τ], …] from `t` into `dest` (or the output), each a beating
 * doublet split by `split` (a fraction, seeded ± 40 %), its pitch moved by `fm` (a node of cents
 * into every oscillator's detune: the swing's LFO; null none); yielding to the page between partials.
 * @param {Sketch} s @param {number} t @param {number[][]} list @param {{ split?: number, fm?: AudioNode|null,
 *   dest?: AudioNode|null, attack?: number }} [o]
 */
async function doublets(s, t, list, { split = 0.0007, fm = null, dest = null, attack = 0.0012 } = {}) {
  for (const [f, amp, tau] of list) {
    if (s.due()) await s.pace();
    if (f > s.sr * 0.44 || t >= s.len) continue;
    const d = split * s.r(0.6, 1.4);
    for (const [k, share] of [[1 - d, 0.55], [1 + d, 0.45]]) {
      const o = s.osc('sine', f * k, t, Math.min(s.len - t, attack + tau * 7.5 + 0.01));
      if (fm) fm.connect(o.detune);
      const g = s.ctx.createGain();
      g.gain.value = 0;
      s.ad(g.gain, t, amp * share, attack, tau * (share === 0.55 ? 1 : s.r(0.93, 1.05)));
      o.connect(g);
      if (dest) g.connect(dest);
      else s.route(g);
    }
  }
}

/**
 * A great bell struck at `t`: strike note `f` (Hz), `minor` the Hush Bell's tierce and crack, `decay`
 * the hum's ring (s: its τ is a quarter of it), `swing` the tolling bell's motion (the toll's), `level`.
 * The body (≤ the tierce) and the brightness (above) on two sums, each under its swing (the mouth
 * turning moves the brightness most); the clapper's strike: its mass's thump, the bronze's clank
 * and a tick.
 * `out`: a node to sum into instead of the render's output (a far bell's lowpass: `hushToll`).
 * @param {Sketch} s @param {number} t @param {number} f
 * @param {{ minor?: boolean, decay?: number, swing?: boolean, level?: number, phase?: number, out?: AudioNode|null }} [o]
 */
export async function greatBell(s, t, f, { minor = false, decay = 7, swing = false, level = 1, phase = 0, out = null } = {}) {
  const ctx = s.ctx;
  const body = ctx.createGain();
  const bright = ctx.createGain();
  body.gain.value = level;
  bright.gain.value = level;
  for (const g of [body, bright]) {
    if (out) g.connect(out);
    else s.route(g);
  }
  /** @type {AudioNode|null} */
  let fm = null;
  if (swing) {
    // the swing: one LFO (native: no curve to hand over) — the pitch in cents, the two sums' levels
    // (it starts a quarter of a swing before the strike: the bell strikes at the top of its arc)
    const lfo = s.osc('sine', 1 / SWING.period, Math.max(0, t - SWING.period * (0.25 + phase)));
    fm = s.amp(lfo, 1200 * Math.log2(1 + SWING.pitch));
    s.amp(lfo, level * SWING.body).connect(body.gain);
    s.amp(lfo, level * SWING.bright).connect(bright.gain);
  }
  const low = [];
  const high = [];
  GREAT.forEach(([ratio, amp, share], k) => {
    const r = k === 2 && minor ? MINOR_TIERCE : ratio;
    // (the Hush Bell: a darker voice — more hum and tierce, less shimmer above the nominal)
    const a = minor ? amp * (k === 0 ? 1.25 : k === 2 ? 1.35 : ratio > 2 ? 0.7 : 1) : amp;
    (ratio <= 1.3 ? low : high).push([f * r, a, (decay * share) / 4]);
  });
  // (a cracked bell beats roughly: its prime and tierce split wide)
  await doublets(s, t, low, { split: minor ? 0.006 : 0.0007, fm, dest: body });
  await doublets(s, t, high, { split: minor ? 0.0022 : 0.0008, fm, dest: bright });
  if (s.due()) await s.pace();
  // the clapper: its mass's thump (a pitch dropping 0.65 × in 40 ms), the bronze's clank, a tick
  const hit = (node) => (out ? node.connect(out) : s.route(node));
  const th = ctx.createOscillator();
  th.frequency.setValueAtTime(Math.min(260, f * 1.4), t);
  th.frequency.exponentialRampToValueAtTime(Math.min(260, f * 1.4) * 0.65, t + 0.04);
  th.start(t);
  th.stop(Math.min(s.len, t + 0.4));
  const tg = ctx.createGain();
  tg.gain.value = 0;
  s.ad(tg.gain, t, 0.3 * level, 0.002, 0.05);
  hit(th.connect(tg));
  for (const [hz, q, amp, attack, tau] of [[Math.min(3400, f * 9), 1.6, 0.3, 0.0012, 0.012], [Math.min(5200, s.sr * 0.4), 1.8, 0.08, 0.0006, 0.004]]) {
    const g = ctx.createGain();
    g.gain.value = 0;
    s.ad(g.gain, t, amp * level, attack, tau);
    hit(s.filter(s.shared('white'), 'bandpass', hz, q).connect(g));
  }
  if (minor) {
    // the crack's rattle: a band of noise at the nominal, buzzing at ≈ 27 Hz, dying in ≈ 1.5 s
    const buzz = s.ctl((tt) => (tt < t ? 0 : Math.abs(Math.sin(2 * Math.PI * 27 * (tt - t))) * Math.exp(-(tt - t) / 0.45)));
    hit(s.amp(s.amp(s.filter(s.noiseSrc('white', t), 'bandpass', f * 2.05, 6), buzz), 0.07 * level));
  }
}

/**
 * A tubular bell struck at `t` (strike note `f`): its modes, a rawhide mallet's click.
 * @param {Sketch} s @param {number} t @param {number} f @param {number} [level]
 */
export async function tubularBell(s, t, f, level = 1) {
  const k = Math.min(1.4, Math.max(0.7, (523 / f) ** 0.35));
  await doublets(s, t, TUBE.map(([r, a, tau]) => [f * r, a * level, tau * k]), { split: 0.0003 });
  s.burst(t, 0.04, { type: 'bandpass', f: Math.min(4500, f * 6), q: 1.2, attack: 0.0006, tau: 0.004, amp: 0.25 * level });
}

/**
 * A handbell rung at `t` (fundamental `f`): its partials, the clapper's tick; the wrist's flick a
 * slow swell of the twelfth.
 * @param {Sketch} s @param {number} t @param {number} f @param {number} [level]
 */
export async function handbell(s, t, f, level = 1) {
  const k = Math.min(1.5, Math.max(0.6, (1046 / f) ** 0.4));
  await doublets(s, t, HAND.map(([r, a, tau]) => [f * r, a * level, tau * k]), { split: 0.0005 });
  s.burst(t, 0.03, { type: 'bandpass', f: Math.min(6000, f * 4), q: 1.5, attack: 0.0005, tau: 0.003, amp: 0.18 * level });
}

/**
 * The celesta / music box struck at `t` (`f`): a pure fundamental (a beating doublet, slowly), a
 * whisper of the octave from the resonator, the tine's ping (6.27 × f, short), a felt hammer.
 * @param {Sketch} s @param {number} t @param {number} f @param {number} [level]
 */
export async function celesta(s, t, f, level = 1) {
  const midi = 69 + 12 * Math.log2(f / 440);
  const tau = Math.min(0.66, Math.max(0.3, 0.6 - (midi - 72) * 0.012));
  await doublets(s, t, [[f, level, tau], [2 * f, 0.07 * level, tau * 0.45], [3 * f, 0.025 * level, tau * 0.3]], { split: 0.00035, attack: 0.002 });
  if (6.27 * f < s.sr * 0.44) s.modes(t, [[6.27 * f, 0.09 * level, 0.035]]);
  s.burst(t, 0.03, { type: 'lowpass', f: 1800, q: 0.7, attack: 0.001, tau: 0.004, amp: 0.05 * level });
}

/**
 * The rendered kinds' keys and recipes for MusicRenders.js (`registerRendered`): the great bell
 * (`bell`: `minor`, `decay` s), the tubular bells, the handbells and the celesta. Each recipe is a
 * MusicJob (`renderMusic`), seeded by its key.
 * @type {Record<'bell'|'tubular'|'handbell'|'chime', RenderedKind>}
 */
export const BELL_KINDS = {
  bell: {
    keys: (ev) => [`bell@${ev.midi}:${ev.minor ? 'min' : 'maj'}:${ev.decay ?? 7}`],
    job(key, seed) {
      const m = /^bell@(\d+):(maj|min):([\d.]+)$/.exec(key);
      if (!m) return null;
      const decay = Number(m[3]);
      // (long enough for the hum to fall ≤ 45 dB under the strike before the end fades)
      const len = Math.min(24, 1.3 * decay + 0.8);
      return {
        name: key, seed, len, sr: SR_BELL, gain: SCALE.bell, lowpass: aa(SR_BELL), fade: Math.min(0.6, len * 0.1),
        build: (s) => greatBell(s, 0.002, mtof(Number(m[1])), { minor: m[2] === 'min', decay }),
      };
    },
    play: { bus: 'bells', level: 0.6, soft: null, pan: 0.12 },
  },
  tubular: {
    keys: (ev) => [`tubular@${ev.midi}`],
    job(key, seed) {
      const m = /^tubular@(\d+)$/.exec(key);
      if (!m) return null;
      return {
        name: key, seed, len: 8.6, sr: SR_BELL, gain: SCALE.tubular, lowpass: aa(SR_BELL), fade: 0.5,
        build: (s) => tubularBell(s, 0.002, mtof(Number(m[1]))),
      };
    },
    play: { bus: 'bells', level: 0.5, soft: [1400, 6000], pan: 0.22 },
  },
  handbell: {
    keys: (ev) => [`handbell@${ev.midi}`],
    job(key, seed) {
      const m = /^handbell@(\d+)$/.exec(key);
      if (!m) return null;
      return {
        name: key, seed, len: 4.9, sr: SR_CHIME, gain: SCALE.handbell, lowpass: aa(SR_CHIME), fade: 0.35,
        build: (s) => handbell(s, 0.002, mtof(Number(m[1]))),
      };
    },
    play: { bus: 'metal', level: 0.42, soft: [2200, 9000], pan: -0.25 },
  },
  chime: {
    keys: (ev) => [`chime@${ev.midi}`],
    job(key, seed) {
      const m = /^chime@(\d+)$/.exec(key);
      if (!m) return null;
      return {
        name: key, seed, len: 3.4, sr: SR_CHIME, gain: SCALE.chime, lowpass: aa(SR_CHIME), fade: 0.3,
        build: (s) => celesta(s, 0.002, mtof(Number(m[1]))),
      };
    },
    play: { bus: 'lute', level: 0.55, soft: [1600, 8000], pan: 0.08 },
  },
};

/** The rendered kinds (a pack's score table adds them to SCORE_KINDS: evermere/Scores.js). */
export const BELL_KIND_NAMES = Object.freeze(Object.keys(BELL_KINDS));

/**
 * Register the bells with the shared kit's renders (MusicRenders.js `registerRendered`).
 * @param {(kind: string, spec: RenderedKind) => void} register
 */
export function registerBells(register) {
  for (const [kind, spec] of Object.entries(BELL_KINDS)) register(kind, spec);
}
