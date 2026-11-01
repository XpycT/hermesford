/**
 * ScoreVoices — the live instruments of Vanquish the Evil Dragon's score (docs/contracts/
 * DRAGON_CAMPAIGN.md §6.9): a score track instance's buses (`scoreBuses`) and the voices that play
 * its live events (`scoreVoice`, AudioSystem `_scheduleMusic`): the string section (violins, violas,
 * cellos, basses), the solo cello, the fiddle, the brass (horns — the cuivré low horn among them —,
 * trombones, tubas), the choir, the organ and the drone. The harp and the flute stay AudioSystem's;
 * every other kind goes to MusicRenders.js `playRendered` (the percussion, the bells, the lute), and
 * a kind nobody plays is logged once (`console.error`), never dropped in silence.
 *
 * Shaped for the real-time budget (the overhaul's design §4):
 * - the sources are pitch-independent PeriodicWaves (`SPECTRA`: a string's saw with a soft top, the
 *   brass families' soft and loud layers, the cuivré horn, the glottal source soft and loud, the
 *   organ's ranks, the chanter's reed; at most 16 a context, cached per context, Schroeder phases,
 *   not normalised);
 * - everything fixed in Hz is a static filter on a sub-bus (`SUB_FILTERS`: the string bodies, the
 *   brass formants and bells, the choir's vowels — five resonances in cascade per part × vowel);
 * - each note's level is normalised from its wave's harmonics and the response of those filters
 *   and of its event's lowpass (`harmonicPower`), so every pitch sits level and a velocity (dynamics
 *   0–1) means one loudness (`dyn`) whatever the note;
 * - ensembles take their vibrato, slow drift and bowed tremolo from one LFO bank per instance (built
 *   in `scoreBuses`): a player picks its LFOs by hashing (note, player) and has its own tuning and
 *   onset; an event has ≤ 2 groups — an envelope and a seat each: a single note's players
 *   alternating between the desk's halves, a chord's lower and upper notes (divisi), the choir's
 *   parts — whose players start under the group's envelope (every wave starts at a zero crossing),
 *   one brightness lowpass, and ≤ 4 vibrato depth gains (one per LFO it uses); the brass plays
 *   straight (drift, no vibrato);
 * - organ and drone notes marked `respeak` (and a tied organ chord) cross over in phase from the
 *   same note sounding (`m.held`), so a re-spoken pedal holds steady;
 * - a slur crosses over: the note slurring on (`next`) holds to its end and hands its players'
 *   oscillators to the tied note after it, the two envelopes crossing linearly past the end — one
 *   tone per player through both notes —, the line's brightness held (`SLUR`, `handOn`,
 *   `brightOf`); a tied chord — the same chord held on — sounds on through the last one's release,
 *   its players already playing (`tieIn`); a slur into a note past a pending section switch plays
 *   unslurred;
 * - a marcato or spiccato note below 250 Hz: its players start whole periods apart, in phase, so
 *   every such note sounds alike, at the level its players had on average (`lockedPower`);
 * - filter and oscillator parameters run at k-rate (gains stay a-rate; a vibrato's depth gains,
 *   which feed only k-rate detunes, at k-rate too);
 * - no node for what can be summed first: a bus's `mix` level is played in its voices' own gains
 *   (`busGain`), a voice that ends in one mono line (a desk's short or low accented notes;
 *   MusicRenders.js: a mono buffer) goes through its bus's shared seat (`seatBus`), a single string
 *   note's two seats share one envelope after them;
 * - one `_cleanup` per event: every gain starts at 0, every envelope is piecewise linear and ends at
 *   0, and all of an event's sources stop together once it has.
 *
 * Imports ScoreKit.js and MusicRenders.js only (never VanquishAudio.js or AudioSystem.js: what it
 * uses of the AudioSystem is `ScoreHost`); imported only through the campaigns' audio packs
 * (VanquishAudio.js, EvermereAudio.js: the shared score kit).
 */
import { mtof } from './ScoreKit.js';
import { playRendered, renderedBus } from './MusicRenders.js';

/**
 * @import { BrassEvent, ChoirEvent, DroneEvent, OrganEvent, ScoreEvent, ScoreTrackDef, SoloEvent, StringsEvent } from './ScoreKit.js'
 * @import { VoiceHost } from './MusicRenders.js'
 */

/**
 * What the score's buses and voices use of the AudioSystem (MusicRenders.js `VoiceHost` and the
 * reverb's input).
 * @typedef {VoiceHost & { _reverbIn: AudioNode }} ScoreHost
 */

/**
 * A static filter: [type, Hz, Q, gain dB] in WebAudio's meanings (Q in dB for lowpass and
 * highpass, linear for peaking and bandpass).
 * @typedef {[BiquadFilterType, number, number, number?]} FilterSpec
 */

/**
 * An envelope: points [seconds from the note's start, level 0–1], the first [0, 0], the last at
 * level 0; piecewise linear.
 * @typedef {number[][]} Env
 */

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const clamp01 = (x) => clamp(x, 0, 1);

/** An integer hash of (x, y) in [0, 1): a player's LFO picks. */
function hash01(x, y) {
  let h = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((y | 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Dynamics → level, 1 at ff: a velocity 0–1 (pp 0.25 … mf 0.6 … ff 1). */
const dyn = (vel) => 0.08 + 0.92 * clamp01(vel) ** 1.3;

/**
 * Each instrument's level (RMS of its sustain, dB) at ff through its bus, before the track's mix —
 * calibrated so the old scores' instruments play at the loudness they had (integrated, stem by stem).
 */
const LEVEL_DB = { strings: -20, solo: -23, fiddle: -27.2, hn: -21.1, hnc: -18.6, tbn: -24.8, tba: -25.8, choir: -23.5, organ: -28, drone: -29, reed: -29 };
const LEVEL = Object.fromEntries(Object.entries(LEVEL_DB).map(([k, db]) => [k, 10 ** (db / 20)]));

/** The variance of AudioSystem's white noise loop (uniform in −1…1). */
const WHITE_VAR = 1 / 3;

// ---------------------------------------------------------------------------------------------
// The waves: source spectra, pitch-independent (the filters and the per-note level do the rest)
// ---------------------------------------------------------------------------------------------

/** The organ's principal 8' and stopped flute 8' (harmonic amplitudes from the fundamental). */
const PRINCIPAL = [0, 1, 0.42, 0.24, 0.16, 0.1, 0.07, 0.05, 0.035, 0.025, 0.018, 0.012, 0.008];
const FLUTE = [0, 1, 0, 0.21, 0, 0.06, 0, 0.02];
const at = (arr, k) => (Number.isInteger(k) && k < arr.length ? arr[k] : 0);

/**
 * The source waves: [harmonics, amplitude of harmonic k]. The brass families' soft and loud
 * layers (blended by the dynamics) share their harmonics' phases.
 * @type {Record<string, [number, (k: number) => number]>}
 */
const SPECTRA = {
  // a bowed string: the saw, its top softened above the 40th harmonic
  string: [96, (k) => 1 / (k * Math.sqrt(1 + (k / 40) ** 2))],
  // brass: a soft note nearly a sine, a loud one blaring up the series (the bell's lowpass on the bus)
  hnSoft: [64, (k) => k ** -1.05 * Math.exp(-0.3 * (k - 1))],
  hnLoud: [64, (k) => k ** -0.75 * Math.exp(-0.02 * (k - 1))],
  tbnSoft: [64, (k) => k ** -0.8 * Math.exp(-0.25 * (k - 1))],
  tbnLoud: [64, (k) => k ** -0.45 * Math.exp(-0.012 * (k - 1))],
  tbaSoft: [48, (k) => k ** -1.25 * Math.exp(-0.35 * (k - 1))],
  tbaLoud: [48, (k) => k ** -0.95 * Math.exp(-0.04 * (k - 1))],
  // the stopped horn forced brassy: a flat, metallic series (its nasal peak on the bus)
  cuivre: [64, (k) => k ** -0.55],
  // the glottal source: soft singing falls faster, its fundamental strong (breathier); loud brighter
  glotSoft: [80, (k) => (k === 1 ? 1.6 : 1) * k ** -1.15],
  glotLoud: [80, (k) => k ** -0.85],
  // the organ, its ranks in tune: the pedal (principal 8' + octave 4' fused into one note) and the manual (principal + stopped flute)
  organPedal: [24, (k) => at(PRINCIPAL, k) + 0.6 * at(PRINCIPAL, k / 2)],
  organManual: [24, (k) => at(PRINCIPAL, k) + 0.7 * at(FLUTE, k)],
  // the chanter's drone: a reed, its odd harmonics strong
  reed: [64, (k) => k ** -0.65 * (k % 2 ? 1 : 0.45)],
};

/** The slow pitch drift's depth (cents) and the bowed tremolo's amplitude shape (a bow stroke's swell). */
const DRIFT_CENTS = 5;
const TREM_BASE = 0.594;
const TREM_RMS = Math.sqrt(TREM_BASE ** 2 + (0.325 ** 2 + 0.081 ** 2) / 2);

/** @type {Map<string, Float64Array>} */
const AMPS = new Map();
/** Harmonic amplitudes a[1…K] of a source wave (a[0] = 0). */
function ampsOf(name) {
  let a = AMPS.get(name);
  if (!a) {
    const [K, fn] = SPECTRA[name];
    a = new Float64Array(K + 1);
    for (let k = 1; k <= K; k++) a[k] = fn(k);
    AMPS.set(name, a);
  }
  return a;
}

/** One period of Σ a_k sin(kθ + φ_k) at N points (each harmonic by rotation). */
function periodOf(amps, ph, N) {
  const x = new Float64Array(N);
  const sd = Math.sin((2 * Math.PI) / N);
  const cd = Math.cos((2 * Math.PI) / N);
  for (let k = 1; k < amps.length; k++) {
    if (!amps[k]) continue;
    // a step of k · 2π/N
    let sk = 0;
    let ck = 1;
    for (let j = 0; j < k; j++) {
      const s2 = sk * cd + ck * sd;
      ck = ck * cd - sk * sd;
      sk = s2;
    }
    let s = Math.sin(ph[k]);
    let c = Math.cos(ph[k]);
    for (let i = 0; i < N; i++) {
      x[i] += amps[k] * s;
      const s2 = s * ck + c * sk;
      c = c * ck - s * sk;
      s = s2;
    }
  }
  return x;
}

/** Where a wave's period crosses zero rising (radians), so a source started under a sounding envelope steps by nothing. */
function zeroCrossing(amps, ph) {
  const N = 512;
  const x = periodOf(amps, ph, N);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    if (x[i] <= 0 && x[j] > 0) return ((i + x[i] / (x[i] - x[j])) / N) * 2 * Math.PI;
  }
  return 0;
}

/** Where two waves with the same phases are both nearest zero (radians): a brass family's soft and loud layers, rotated together. */
function jointZero(a1, a2, ph) {
  const N = 512;
  const x1 = periodOf(a1, ph, N);
  const x2 = periodOf(a2, ph, N);
  let p1 = 1e-12;
  let p2 = 1e-12;
  for (let i = 0; i < N; i++) {
    p1 = Math.max(p1, Math.abs(x1[i]));
    p2 = Math.max(p2, Math.abs(x2[i]));
  }
  let best = 0;
  let bv = Infinity;
  for (let i = 0; i < N; i++) {
    const v = Math.max(Math.abs(x1[i]) / p1, Math.abs(x2[i]) / p2);
    if (v < bv) {
      bv = v;
      best = i;
    }
  }
  return (best / N) * 2 * Math.PI;
}

/** The brass families' layer pairs (their phases, and their rotation, shared). */
const PAIRS = { hnSoft: 'hnLoud', hnLoud: 'hnSoft', tbnSoft: 'tbnLoud', tbnLoud: 'tbnSoft', tbaSoft: 'tbaLoud', tbaLoud: 'tbaSoft' };

/** @type {Map<string, { re: Float32Array, im: Float32Array }>} */
const PARTS = new Map();
/**
 * A wave's Fourier coefficients: Schroeder phases (a bounded crest), rotated to start at a zero
 * crossing — a brass family's two layers rotated together, to where both are nearest zero — so a
 * player can start under a group's sounding envelope.
 */
function partsOf(name) {
  let p = PARTS.get(name);
  if (!p) {
    const amps = ampsOf(name);
    const K = amps.length - 1;
    const ph = new Float64Array(K + 1);
    for (let k = 1; k <= K; k++) ph[k] = (-Math.PI * k * (k - 1)) / K;
    const pair = PAIRS[name];
    const th = pair ? jointZero(ampsOf(name.endsWith('Soft') ? name : pair), ampsOf(name.endsWith('Soft') ? pair : name), ph) : zeroCrossing(amps, ph);
    for (let k = 1; k <= K; k++) ph[k] += k * th;
    // x(θ) = Σ a_k sin(kθ + φ_k) = Σ a_k sin φ_k cos kθ + a_k cos φ_k sin kθ
    const re = new Float32Array(K + 1);
    const im = new Float32Array(K + 1);
    for (let k = 1; k <= K; k++) {
      re[k] = amps[k] * Math.sin(ph[k]);
      im[k] = amps[k] * Math.cos(ph[k]);
    }
    p = { re, im };
    PARTS.set(name, p);
  }
  return p;
}

/** @type {WeakMap<BaseAudioContext, Map<string, PeriodicWave>>} */
const WAVES = new WeakMap();
/** A context's PeriodicWave of a source wave or an LFO shape ('drift', 'trem'), made once. */
function waveOf(a, name) {
  const ctx = a.ctx;
  let map = WAVES.get(ctx);
  if (!map) WAVES.set(ctx, (map = new Map()));
  let w = map.get(name);
  if (!w) {
    let re;
    let im;
    if (name === 'drift') {
      re = new Float32Array(2);
      im = Float32Array.from([0, DRIFT_CENTS]);
    } else if (name === 'trem') {
      re = Float32Array.from([0, 0, -0.081]);
      im = Float32Array.from([0, 0.325, 0]);
    } else ({ re, im } = partsOf(name));
    w = ctx.createPeriodicWave(re, im, { disableNormalization: true });
    map.set(name, w);
  }
  return w;
}

// ---------------------------------------------------------------------------------------------
// Static filters and the per-note level
// ---------------------------------------------------------------------------------------------

/**
 * Each sub-bus's static filters (its voices' levels are normalised through them).
 * @type {Record<string, FilterSpec[]>}
 */
const SUB_FILTERS = {
  // the string bodies: the violin's air and wood modes and bridge hill, the viola's, the cello's, the bass's
  vn: [['highpass', 170, -3], ['peaking', 290, 1.4, 2], ['peaking', 520, 1.6, 1.5], ['peaking', 2800, 1, 2.5]],
  va: [['highpass', 120, -3], ['peaking', 240, 1.4, 2], ['peaking', 440, 1.6, 1.5], ['peaking', 2100, 1, 2]],
  vc: [['highpass', 55, -3], ['peaking', 120, 1.3, 2], ['peaking', 260, 1.5, -1.5], ['peaking', 1500, 1, 2]],
  cb: [['peaking', 65, 1.3, 2], ['peaking', 120, 1.4, 1], ['peaking', 400, 1.2, -2], ['lowpass', 2600, -3]],
  solo: [['highpass', 60, -3], ['peaking', 115, 1.3, 2], ['peaking', 280, 1.2, 2.5], ['peaking', 1600, 1, 3]],
  // the fiddle: air 280, wood 450–600, the bridge's hill at 2–3 kHz
  fiddle: [['highpass', 190, -3], ['peaking', 280, 1.5, 3], ['peaking', 520, 1, 2], ['peaking', 2500, 0.8, 4]],
  // the brass: each family's formant and bell; the cuivré horn's nasal peak and brassy edge (≥ 1 kHz kept)
  hn: [['peaking', 500, 0.9, 3], ['lowpass', 1900, -3]],
  hnc: [['peaking', 1200, 1.4, 6], ['peaking', 2800, 1, 3], ['lowpass', 5200, -3]],
  tbn: [['peaking', 550, 1, 2], ['peaking', 1250, 1.2, 3], ['lowpass', 3000, -3]],
  tba: [['peaking', 250, 1, 2], ['lowpass', 900, -3]],
  organ: [['lowpass', 3200, -3]],
  drone: [['lowpass', 420, 2]],
  reed: [['highpass', 150, -3], ['peaking', 1100, 1.2, 5], ['peaking', 2600, 1, 3], ['lowpass', 5500, -3]],
};

/**
 * The choir's vowels (the Csound formant tables: [Hz, bandwidth] × 5) per part; F1 and F2 per
 * vowel make a sub-bus's head, F3–F5 (the vowels' mean) its part's chain.
 */
const FORMANTS = {
  bass: { a: [[600, 60], [1040, 70]], o: [[400, 40], [750, 80]], u: [[350, 40], [600, 80]], hi: [[2350, 103], [2575, 120], [2867, 123]] },
  tenor: { a: [[650, 80], [1080, 90]], o: [[400, 40], [800, 80]], u: [[350, 40], [600, 60]], hi: [[2650, 107], [2867, 123], [3183, 127]] },
  alto: { a: [[800, 80], [1150, 90]], o: [[450, 70], [800, 80]], u: [[325, 50], [700, 60]], hi: [[2720, 130], [3500, 147], [4950, 158]] },
  soprano: { a: [[800, 80], [1150, 90]], o: [[450, 70], [800, 80]], u: [[325, 50], [700, 60]], hi: [[2810, 130], [3833, 147], [4950, 158]] },
};
/** The singers' part by pitch, and the parts' seats. */
const partOf = (midi) => (midi < 50 ? 'bass' : midi < 58 ? 'tenor' : midi < 66 ? 'alto' : 'soprano');
const PART_SEAT = { bass: 0.35, tenor: 0.12, alto: -0.12, soprano: -0.35 };
/** A formant as a resonance: a lowpass at F peaking by F / bandwidth (a cascade gives the vowel's own levels). */
const resonance = ([f, bw]) => /** @type {FilterSpec} */ (['lowpass', f, 20 * Math.log10(f / bw)]);
const choirHeadFilters = (part, vowel) => FORMANTS[part][vowel].map(resonance);
const choirPartFilters = (part) => FORMANTS[part].hi.map(resonance);

/** A bus's filters by key (a sub-bus, or 'choir:<part>:<vowel>': the head and its part's chain). */
function filtersOf(key) {
  if (key.startsWith('choir:')) {
    const [, part, vowel] = key.split(':');
    return [...choirHeadFilters(part, vowel), ...choirPartFilters(part)];
  }
  return SUB_FILTERS[key];
}

/** A biquad's normalised coefficients [b0, b1, b2, a1, a2] (the WebAudio spec's formulas). */
function coefsOf([type, f, q, gain = 0], sr) {
  const w0 = (2 * Math.PI * Math.min(f, sr * 0.4999)) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const A = 10 ** (gain / 40);
  let b0;
  let b1;
  let b2;
  let a0;
  let a1;
  let a2;
  if (type === 'lowpass' || type === 'highpass') {
    const al = sw / (2 * 10 ** (q / 20));
    const s = type === 'lowpass' ? 1 : -1;
    b1 = type === 'lowpass' ? 1 - cw : -(1 + cw);
    b0 = b2 = (1 - s * cw) / 2;
    a0 = 1 + al;
    a1 = -2 * cw;
    a2 = 1 - al;
  } else if (type === 'peaking') {
    const al = sw / (2 * q);
    b0 = 1 + al * A;
    b1 = -2 * cw;
    b2 = 1 - al * A;
    a0 = 1 + al / A;
    a1 = -2 * cw;
    a2 = 1 - al / A;
  } else {
    // bandpass (constant 0 dB peak)
    const al = sw / (2 * q);
    b0 = al;
    b1 = 0;
    b2 = -al;
    a0 = 1 + al;
    a1 = -2 * cw;
    a2 = 1 - al;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

/**
 * |H(e^{jω})|² of a biquad's coefficients (`coefsOf`).
 * @param {number[]} c @param {number} w
 */
function mag2(c, w) {
  const [b0, b1, b2, a1, a2] = c;
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2;
  const ni = b1 * s1 + b2 * s2;
  const dr = 1 + a1 * c1 + a2 * c2;
  const di = a1 * s1 + a2 * s2;
  return (nr * nr + ni * ni) / (dr * dr + di * di);
}

/** @type {Map<string, Float64Array>} */
const POWER = new Map();
/**
 * The power of each harmonic of a wave at `midi` through a bus's static filters: (a_k |H(k f0)|)² / 2
 * (a sine of amplitude a has power a² / 2); harmonics at or above Nyquist are dropped, as the
 * oscillator does. Cached per sample rate, bus, wave and note.
 */
function harmonicPower(sr, bus, wave, midi) {
  const key = `${sr}|${bus}|${wave}|${midi}`;
  let out = POWER.get(key);
  if (!out) {
    const amps = ampsOf(wave);
    const f0 = mtof(midi);
    const cs = filtersOf(bus).map((s) => coefsOf(s, sr));
    out = new Float64Array(amps.length);
    for (let k = 1; k < amps.length; k++) {
      const f = k * f0;
      if (f >= sr * 0.49) break;
      const w = (2 * Math.PI * f) / sr;
      let h = 1;
      for (const c of cs) h *= mag2(c, w);
      out[k] = (amps[k] * amps[k] * h) / 2;
    }
    POWER.set(key, out);
  }
  return out;
}

/** A note's power through its bus (`harmonicPower`) and, if given, its event's lowpass at full brightness. */
function powerThrough(arr, f0, lp, sr) {
  let s = 0;
  for (let k = 1; k < arr.length; k++) {
    if (!arr[k]) continue;
    s += lp ? arr[k] * mag2(lp, (2 * Math.PI * k * f0) / sr) : arr[k];
  }
  return Math.max(s, 1e-12);
}

/**
 * `powerThrough` of a locked note (`lockedPower`'s weights: in phase, the old offsets), scaled to
 * what its players had on average: P × P_in phase / P_old offsets (one pass over the harmonics).
 * @param {Float64Array} arr @param {number} f0 @param {number[]} lp @param {number} sr @param {[Float64Array, Float64Array]} W
 */
function lockedThrough(arr, f0, lp, sr, [inPhase, before]) {
  let s = 0;
  let si = 0;
  let sb = 0;
  for (let k = 1; k < arr.length; k++) {
    if (!arr[k]) continue;
    const p = arr[k] * mag2(lp, (2 * Math.PI * k * f0) / sr);
    s += p;
    si += k < inPhase.length ? p * inPhase[k] : p;
    sb += k < before.length ? p * before[k] : p;
  }
  return Math.max((s * si) / Math.max(sb, 1e-12), 1e-12);
}

/** @type {Map<string, number>} */
const NOISE_POWER = new Map();
/** The power gain of white noise through a bus's filters (the mean of |H|² over the band). */
function noisePower(sr, bus) {
  const key = `${sr}|${bus}`;
  let p = NOISE_POWER.get(key);
  if (p === undefined) {
    const cs = filtersOf(bus).map((s) => coefsOf(s, sr));
    const N = 256;
    p = 0;
    for (let i = 0; i < N; i++) {
      const w = (Math.PI * (i + 0.5)) / N;
      let h = 1;
      for (const c of cs) h *= mag2(c, w);
      p += h;
    }
    p = Math.max(p / N, 1e-12);
    NOISE_POWER.set(key, p);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// The buses
// ---------------------------------------------------------------------------------------------

/** Each sub-bus's family (its `mix` level), its own level's name and, for a bus of single players, its seat. */
const SUBS = {
  vn: { fam: 'strings', level: 'vn' }, va: { fam: 'strings', level: 'va' }, vc: { fam: 'strings', level: 'vc' }, cb: { fam: 'strings', level: 'cb' },
  solo: { fam: 'solo', seat: 0.12 }, fiddle: { fam: 'fiddle', seat: -0.15 },
  hn: { fam: 'brass', level: 'hn' }, hnc: { fam: 'brass', level: 'hn' }, tbn: { fam: 'brass', level: 'tbn' }, tba: { fam: 'brass', level: 'tba', seat: 0.4 },
  organ: { fam: 'organ' }, drone: { fam: 'drone' }, reed: { fam: 'drone' },
};
/** The families' extra reverb sends (into the instance's `wetFade`). */
const FAMILY_SEND = { choir: 0.45, organ: 0.5 };
/**
 * The far buses' dry levels (their reverb sends 0.9): far is mostly reverb — a far drum's the
 * quieter (its boom is what carries: `farDrums`).
 */
const FAR_DRY = { far: 0.5, farDrums: 0.3 };

/** A bus level from the track's `mix` (undefined: none set). */
const mixOf = (m, key) => m.vq.mix[key];

function gainNode(m, ctx, v) {
  const g = ctx.createGain();
  g.gain.value = v;
  m.nodes.push(g);
  return g;
}

/** A static filter (k-rate). */
function filterNode(ctx, [type, f, q, gain = 0]) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.automationRate = 'k-rate';
  b.Q.automationRate = 'k-rate';
  b.gain.automationRate = 'k-rate';
  b.detune.automationRate = 'k-rate';
  b.frequency.value = f;
  b.Q.value = q;
  b.gain.value = gain;
  return b;
}

/**
 * A track's mix EQ at a sub-bus, a family or a rendered bus (`def.eq`; null: none).
 * @returns {FilterSpec[]|null}
 */
const eqOf = (V, name) => (V.eq && Object.hasOwn(V.eq, name) && V.eq[name].length ? V.eq[name] : null);

/**
 * The static gain of a bus's voices: its level and its family's from the track's `mix` (a sub-bus
 * of SUBS, or 'choir'). The voices play it in their own gains — the same sum as a gain node on the
 * bus, without the node.
 * @param {any} m @param {string} name
 */
function busGain(m, name) {
  const V = m.vq;
  let g = V.gains.get(name);
  if (g === undefined) {
    const meta = SUBS[name] ?? { fam: name };
    g = (meta.level ? mixOf(m, meta.level) ?? 1 : 1) * (mixOf(m, meta.fam) ?? 1);
    V.gains.set(name, g);
  }
  return g;
}

/**
 * Where a family's buses go: the trim, and the family's extra reverb send (one gain into `wetFade`)
 * if it has one — through the family's mix EQ when the track sets one (`eq.strings`, `eq.brass`,
 * `eq.choir`: a family that is not itself a sub-bus).
 */
function familyDests(a, m, fam) {
  const V = m.vq;
  let dests = V.families.get(fam);
  if (!dests) {
    const send = FAMILY_SEND[fam] ?? 0;
    dests = [V.trim];
    if (send) {
      const g = gainNode(m, a.ctx, send);
      g.connect(V.wetFade);
      dests.push(g);
    }
    const eq = SUBS[fam] ? null : eqOf(V, fam);
    if (eq) dests = [chainInto(a, m, eq, dests)];
    V.families.set(fam, dests);
  }
  return dests;
}

/** A chain of static filters (at least one) into each of `dests`, its first node returned. */
function chainInto(a, m, specs, dests) {
  let next = null;
  for (let i = specs.length - 1; i >= 0; i--) {
    const f = filterNode(a.ctx, specs[i]);
    if (next) f.connect(next);
    else for (const d of dests) f.connect(d);
    m.nodes.push(f);
    next = f;
  }
  return next;
}

/** A sub-bus's input (built on first use): its filters, its seat, its family's destinations (its level: `busGain`, in the voices). */
function subBus(a, m, name) {
  const V = m.vq;
  let node = V.subs.get(name);
  if (!node) {
    const meta = SUBS[name];
    let dests = familyDests(a, m, meta.fam);
    if (meta.seat !== undefined) {
      const p = a.ctx.createStereoPanner();
      p.pan.value = meta.seat;
      for (const d of dests) p.connect(d);
      m.nodes.push(p);
      dests = [p];
    }
    // (its mix EQ after its own filters: outside the per-note level, which reads SUB_FILTERS only)
    node = chainInto(a, m, [...SUB_FILTERS[name], ...(eqOf(V, name) ?? [])], dests);
    V.subs.set(name, node);
  }
  return node;
}

/**
 * A sub-bus's seat for its voices that end in one mono line (built on first use): a panner at
 * `pan` into the sub-bus, shared — mono voices each panned, or summed and panned once, are the
 * same signal, with one node less a note.
 */
function seatBus(a, m, name, pan) {
  const V = m.vq;
  const key = `${name}@${pan}`;
  let node = V.seats.get(key);
  if (!node) {
    node = a.ctx.createStereoPanner();
    node.pan.value = clamp(pan, -1, 1);
    node.connect(subBus(a, m, name));
    m.nodes.push(node);
    V.seats.set(key, node);
  }
  return node;
}

/** The choir's sub-bus of a part × vowel: the vowel's F1 and F2, then its part's F3–F5 and seat. */
function choirBus(a, m, part, vowel) {
  const V = m.vq;
  const key = `choir:${part}:${vowel}`;
  let node = V.subs.get(key);
  if (!node) {
    let chain = V.subs.get(`choir:${part}`);
    if (!chain) {
      const p = a.ctx.createStereoPanner();
      p.pan.value = PART_SEAT[part];
      for (const d of familyDests(a, m, 'choir')) p.connect(d);
      m.nodes.push(p);
      chain = chainInto(a, m, choirPartFilters(part), [p]);
      V.subs.set(`choir:${part}`, chain);
    }
    node = chainInto(a, m, choirHeadFilters(part, vowel), [chain]);
    V.subs.set(key, node);
  }
  return node;
}

// ---------------------------------------------------------------------------------------------
// What a track needs (read once at its start: the waves to make early, the LFO bank, the buses)
// ---------------------------------------------------------------------------------------------

const BRASS_WAVES = { hn: ['hnSoft', 'hnLoud'], tbn: ['tbnSoft', 'tbnLoud'], tba: ['tbaSoft', 'tbaLoud'] };

/**
 * The waves an event plays and the LFOs it takes.
 * @param {any} ev
 * @returns {{ waves: string[], vib?: boolean, drift?: boolean, trem?: boolean }}
 */
function needsOf(ev) {
  switch (ev.kind) {
    case 'strings': return { waves: ['string'], vib: true, drift: true, trem: ev.art === 'trem' };
    case 'solo': case 'fiddle': return { waves: ['string'], vib: true, drift: true };
    case 'brass': return { waves: ev.cuivre ? ['cuivre'] : BRASS_WAVES[ev.fam], vib: true, drift: true };
    case 'choir': return { waves: ['glotSoft', 'glotLoud'], vib: true, drift: true };
    case 'organ': return { waves: [ev.pedal || Math.min(...ev.notes) < 52 ? 'organPedal' : 'organManual'] };
    case 'drone': return { waves: [ev.reed ? 'reed' : 'string'] };
    default: return { waves: [] };
  }
}

/** Scan a track's sections: waves by first use, the LFOs wanted, the percussion buses used. */
function scan(m) {
  const first = new Map();
  const need = { vib: false, drift: false, trem: false, bells: false, farOther: false, farDrums: false, first, early: new Set() };
  const startName = m.sectionName;
  const sections = m.sections ?? {};
  let order = 0;
  for (const [name, sec] of Object.entries(sections)) {
    const spb = 60 / (sec.bpm ?? m.bpm ?? 120);
    for (const ev of sec.events) {
      const nd = needsOf(ev);
      need.vib ||= !!nd.vib;
      need.drift ||= !!nd.drift;
      need.trem ||= !!nd.trem;
      // (a near toll — or a pack's bell on the bells' bus: MusicRenders.js `registerRendered`)
      need.bells ||= !ev.far && (ev.kind === 'toll' || renderedBus(ev.kind) === 'bells');
      need.farDrums ||= !!ev.far && ev.kind === 'drum';
      need.farOther ||= !!ev.far && ev.kind !== 'drum';
      const when = name === startName ? ev.beat * spb : 1e6 + order++;
      for (const w of nd.trem ? [...nd.waves, 'trem'] : nd.waves) {
        if (!first.has(w) || first.get(w) > when) first.set(w, when);
        if (when < 0.6) need.early.add(w);
      }
    }
  }
  return need;
}

/** @type {WeakMap<object, Map<string, ReturnType<typeof scan>>>} */
const SCANS = new WeakMap();
/** A built track's scan, from its start section (once per build: AudioSystem keeps its built tracks). */
function scanOf(m) {
  if (!m.sections) return scan(m);
  let byStart = SCANS.get(m.sections);
  if (!byStart) SCANS.set(m.sections, (byStart = new Map()));
  let need = byStart.get(m.sectionName);
  if (!need) byStart.set(m.sectionName, (need = scan(m)));
  return need;
}

/**
 * The instance's LFO bank: [LFOs, wave ('sine' or an LFO shape), lowest and highest rate (Hz)] —
 * the vibrato, the slow drift (±`DRIFT_CENTS`), the bowed tremolo's strokes.
 */
const BANK = { vib: [8, 'sine', 4.6, 6.2], drift: [4, 'drift', 0.09, 0.37], trem: [8, 'trem', 12.5, 16.5] };

/** The bank's LFOs of a type (made on first use: random rates, random phases by staggered starts; `m.sources`). */
function bankOf(a, m, type) {
  const list = m.vq.bank[type];
  if (!list.length) {
    const ctx = a.ctx;
    const now = ctx.currentTime;
    const [count, wave, lo, hi] = BANK[type];
    for (let i = 0; i < count; i++) {
      const o = ctx.createOscillator();
      if (wave === 'sine') o.type = 'sine';
      else o.setPeriodicWave(waveOf(a, wave));
      const f = lo + m.rng() * (hi - lo);
      o.frequency.value = f;
      o.start(now + m.rng() * Math.min(1 / f, 3));
      m.nodes.push(o);
      m.sources.push(o);
      list.push(o);
    }
  }
  return list;
}

/** Make one wave still wanted (at most one per 12 ms of the main thread), so a section's first notes find theirs made. */
function drainWaves(a, V) {
  const made = WAVES.get(a.ctx);
  while (V.pending.length && made?.has(V.pending[0])) V.pending.shift();
  if (!V.pending.length) return;
  const now = performance.now();
  if (now - V.lastWave < 12) return;
  V.lastWave = now;
  waveOf(a, V.pending.shift());
}

// ---------------------------------------------------------------------------------------------
// The instance's buses
// ---------------------------------------------------------------------------------------------

/**
 * A score track instance's buses (AudioSystem `_startCombatTrack`). The output: every bus → the
 * track's trim (`gain`) → a ~32 Hz low cut → `m.out`, each bus's level (`mix`, linear) played in
 * its voices' own gains (`busGain`; MusicRenders.js: `m.busGain`) — no gain node a bus; every reverb
 * send sums into `m.wetFade` → the reverb, so `m.faders` ([out, wetFade]) fade everything the
 * instance plays. The instance's harp and flute buses (AudioSystem's) go onto the trim too (through
 * their `mix` level's gain when it is not 1). The percussion buses for MusicRenders.js are `m.bus`
 * (drums, timp, bells, metal, lute, far, and farDrums when a drum plays far — the trim itself for
 * one without a send); the instruments' sub-buses are built on first use. The track's mix EQ
 * (`def.eq`, static filters, a node each) sits after an instrument's sub-bus filters (outside its
 * per-note level, so a cut takes energy out), on a family's way to the trim and its sends
 * ('strings', 'brass', 'choir') or in front of a rendered bus.
 * Also made here: the waves the start section opens with (the rest one at a time after), the LFO
 * bank (`m.sources`) and `m.held` (the organ's and the drone's sounding notes, for re-speaking).
 * @param {ScoreHost} a
 * @param {any} m the music instance
 * @param {ScoreTrackDef} def
 */
export function scoreBuses(a, m, def) {
  const ctx = a.ctx;
  const mix = /** @type {Record<string, number>} */ (def.mix ?? {});
  const need = scanOf(m);
  const trim = ctx.createGain();
  trim.gain.value = def.gain ?? 1;
  const lowcut = filterNode(ctx, ['highpass', 32, -3]);
  trim.connect(lowcut).connect(m.out);
  const wetFade = ctx.createGain();
  wetFade.gain.value = 1;
  wetFade.connect(a._reverbIn);
  m.nodes.push(trim, lowcut, wetFade);
  m.wetFade = wetFade;
  m.faders = [m.out, wetFade];
  m.sources = [];
  m.held = {};
  const V = {
    mix, eq: def.eq ?? null, trim, wetFade, gains: new Map(), families: new Map(), subs: new Map(), seats: new Map(),
    bank: { vib: [], drift: [], trem: [] }, pending: [], lastWave: -Infinity, slurs: new Map(),
  };
  m.vq = V;
  // AudioSystem's buses (the harp, the flute) onto the trim
  m.harpBus.frequency.value = 5200;
  for (const [bus, key] of [[m.harpBus, 'harp'], [m.fluteBus, 'flute']]) {
    bus.disconnect();
    if (mix[key] === undefined || mix[key] === 1) bus.connect(trim);
    else bus.connect(gainNode(m, ctx, mix[key])).connect(trim);
  }
  // the percussion's buses (MusicRenders.js)
  m.bus = {};
  m.busGain = { bells: 1, far: 1, farDrums: 1 };
  // (each through its mix EQ when the track sets one, `eq.drums` …)
  const withEq = (name, node) => {
    const eq = eqOf(V, name);
    return eq ? chainInto(a, m, eq, [node]) : node;
  };
  for (const name of ['drums', 'timp', 'metal', 'lute']) {
    m.bus[name] = withEq(name, trim);
    m.busGain[name] = mixOf(m, name) ?? 1;
  }
  if (need.bells) {
    const b = gainNode(m, ctx, mixOf(m, 'bells') ?? 1);
    b.connect(trim);
    b.connect(gainNode(m, ctx, 0.5)).connect(wetFade);
    m.bus.bells = withEq('bells', b);
  } else m.bus.bells = withEq('bells', trim);
  // far away: dull and quiet in the dry mix (× FAR_DRY), mostly reverb (× 0.9) — sent before its
  // lowpass, so the reverb keeps its body; the far drums on a bus of their own (built only when a
  // drum plays far: `need.farDrums`), quieter and dry through the drums' mix EQ too (`eq.drums`: a
  // far drum never boomier than a near one — the reverb's own low cut takes the boom out of the
  // send); every other far event (a toll, a far line) on `far`
  const farBus = (name, boom) => {
    const f = gainNode(m, ctx, (mixOf(m, 'far') ?? 1) * FAR_DRY[name]);
    f.connect(gainNode(m, ctx, 0.9 / FAR_DRY[name])).connect(wetFade);
    const lp = filterNode(ctx, ['lowpass', 700, -3]);
    m.nodes.push(lp);
    f.connect(boom ? chainInto(a, m, boom, [lp]) : lp);
    lp.connect(trim);
    return withEq('far', f);
  };
  m.bus.far = need.farOther ? farBus('far', null) : withEq('far', trim);
  if (need.farDrums) m.bus.farDrums = farBus('farDrums', eqOf(V, 'drums'));
  // the LFO bank the track's instruments take (vibrato, drift; the bowed tremolo's on first use)
  for (const type of ['vib', 'drift']) if (need[type]) bankOf(a, m, type);
  // the waves (≈ 0.6 ms each, made once a context): the start section's first notes' now (≤ 3), the
  // rest one at a time as the music plays (`drainWaves`), any still missing when a note needs it then
  const order = [...need.first.keys()].sort((x, y) => need.first.get(x) - need.first.get(y));
  const early = order.filter((w) => need.early.has(w)).slice(0, 3);
  for (const w of early) waveOf(a, w);
  V.pending = order.filter((w) => !early.includes(w));
}

// ---------------------------------------------------------------------------------------------
// The voices: shared pieces
// ---------------------------------------------------------------------------------------------

/**
 * One event's voice being built: its nodes (all released by one `_cleanup`), its sources (all
 * stopped together), its links from the instance's LFO bank (undone when it ends), its vibrato
 * depth gains by LFO.
 * @typedef {{ a: ScoreHost, ctx: BaseAudioContext, m: any, V: any, t: number, nodes: AudioNode[], srcs: AudioScheduledSourceNode[], links: any[], vib: Map<number, GainNode>|null }} Voice
 */

/** @returns {Voice} */
const voiceAt = (a, m, t) => ({ a, ctx: a.ctx, m, V: m.vq, t, nodes: [], srcs: [], links: [], vib: null });

/** A source oscillator of a wave (k-rate pitch). */
function oscOf(E, wave, f, det) {
  const o = E.ctx.createOscillator();
  o.setPeriodicWave(wave);
  o.frequency.automationRate = 'k-rate';
  o.detune.automationRate = 'k-rate';
  o.frequency.value = f;
  o.detune.value = det;
  E.nodes.push(o);
  E.srcs.push(o);
  return o;
}

/** An envelope gain (starting at 0). */
function envGain(E) {
  const g = E.ctx.createGain();
  g.gain.value = 0;
  E.nodes.push(g);
  return g;
}

/** A filter of the voice (k-rate). */
function voiceFilter(E, spec) {
  const f = filterNode(E.ctx, spec);
  E.nodes.push(f);
  return f;
}

function panner(E, pan) {
  const p = E.ctx.createStereoPanner();
  p.pan.value = clamp(pan, -1, 1);
  E.nodes.push(p);
  return p;
}

/** A connection from the instance's LFO bank, undone when the voice ends. */
function link(E, from, to) {
  from.connect(to);
  E.links.push(from, to);
}

/**
 * The event's vibrato depth gain for bank LFO `idx` (made on first use): 0 until `on` s, then a
 * ramp over `ramp` s to `depth()` cents.
 */
function vibrato(E, idx, on, ramp, depth) {
  E.vib ??= new Map();
  let g = E.vib.get(idx);
  if (!g) {
    g = E.ctx.createGain();
    // (k-rate: it feeds only k-rate detunes, which read the first frame of each quantum — the
    // same value an a-rate gain gives there, without its per-sample automation)
    g.gain.automationRate = 'k-rate';
    g.gain.value = 0;
    g.gain.setValueAtTime(0, E.t + on);
    g.gain.linearRampToValueAtTime(depth(), E.t + on + ramp);
    E.nodes.push(g);
    link(E, bankOf(E.a, E.m, 'vib')[idx], g);
    E.vib.set(idx, g);
  }
  return g;
}

/** A noise source (AudioSystem's white loop) from `t`. */
function noiseOf(E, t) {
  const n = E.a._noiseSource(E.a._white, t, E.m.rng() * 1.9);
  E.nodes.push(n);
  E.srcs.push(n);
  return n;
}

/**
 * Stop every source at `end`, one `_cleanup` for the event, the bank's links undone when it has
 * ended. A voice playing handed-over oscillators (`held`: another voice's sources, that voice's
 * nodes and links released when they end) stops them at its end too — and, if it has no source of
 * its own, keeps one silent (offset 0, into `keep`) for its `_cleanup` to follow.
 * @param {Voice} E @param {number} end @param {OscillatorNode[]} [held] @param {AudioNode} [keep]
 */
function finish(E, end, held, keep) {
  if (held?.length && !E.srcs.length) {
    const c = E.ctx.createConstantSource();
    c.offset.value = 0;
    c.connect(/** @type {AudioNode} */ (keep));
    c.start(E.t);
    E.nodes.push(c);
    E.srcs.push(c);
  }
  for (const s of E.srcs) s.stop(end);
  if (held) for (const o of held) o.stop(end);
  const src = E.srcs[0];
  E.a._cleanup(src, E.nodes);
  const links = E.links;
  if (src && links.length) {
    src.addEventListener('ended', () => {
      for (let i = 0; i < links.length; i += 2) {
        try {
          links[i].disconnect(links[i + 1]);
        } catch {
          /* already gone */
        }
      }
    }, { once: true });
  }
}

/** The envelope's points builder: strictly increasing times. */
function envPts() {
  const pts = [[0, 0]];
  const add = (x, v) => {
    const last = pts[pts.length - 1][0];
    pts.push([Math.max(x, last + 0.001), v]);
  };
  return { pts, add };
}
/** A release of `r` s from level v at `d`: 30 % at 0.4 r, 0 at r (an exponential's shape in two lines). */
function release(add, d, v, r) {
  add(d + r * 0.4, v * 0.3);
  add(d + r, 0);
}

/**
 * A slur's crossfade (s) by instrument. A note slurring on (`next`) holds its level to its notated
 * end and fades out over `q` past it while the `tied` note after it — on its time: ScoreKit gives a
 * tied note its predecessor's jitter — fades in over the same. The note slurring on hands its
 * players' oscillators to it (`handOn`, `takeSlur`; the glide brings them to the new pitch at the
 * old note's end, `slurGlide`): one tone per player through both notes' envelopes and filters,
 * crossing linearly (`HANDOFF`: a coherent pair, no dip whatever its phase). A tied note that finds
 * none (its predecessor not played, or other players) slurs in on its own tones, equal power (0.7).
 */
const SLUR = { strings: 0.045, solo: 0.045, brass: 0.035 };
/** The middle of a handed-over slur's crossfade: one signal through both notes — linear (0.5 + 0.5). */
const HANDOFF = 0.5;

/**
 * Hold `v` to `d`, then either the slur's crossfade out past it (`next`, `q` s; `mid` × v at q / 2)
 * or a release of `r`.
 */
function ending(add, d, v, r, q, next, mid = 0.7) {
  add(d, v);
  if (next) {
    add(d + q * 0.5, v * mid);
    add(d + q, 0);
  } else release(add, d, v, r);
}

/**
 * A tied note's attack to `v`, its end returned (s): a slur ('slur': from a note slurring on, the
 * other half of its crossfade, `q`, `mid` × v at q / 2) or the same chord held on ('chord': from one
 * released over `r`, in r / 3 — the pair's power within ±1.2 dB across the bar line).
 * @param {(x: number, v: number) => void} add @param {'slur'|'chord'} tie
 * @param {number} q @param {number} r @param {number} dur @param {number} v @param {number} [mid]
 */
function tieIn(add, tie, q, r, dur, v, mid = 0.7) {
  if (tie === 'chord') {
    const x = Math.min(r / 3, dur * 0.45);
    add(x, v);
    return x;
  }
  const x = Math.min(q, dur * 0.5);
  add(x * 0.5, v * mid);
  add(x, v);
  return x;
}

/**
 * How an event is tied on (`tied`): a line's note slurred from the one before ('slur') or a chord —
 * `notes`, the voicer's tie — the same chord held on from the bar before ('chord'); null: not tied.
 * @param {{ tied?: boolean, notes?: number[] }} ev
 * @returns {'slur'|'chord'|null}
 */
const tieOf = (ev) => (!ev.tied ? null : ev.notes ? 'chord' : 'slur');

/**
 * A slur handed on (`V.slurs`, by '<line>:<next MIDI note>', the line '<kind>[/<desk or family>]'):
 * when the note slurring on ends (`at`), its players' oscillators (in the voice's order), their
 * tuning before the glide (`from`) and after it (`det`: cents on their own frequency), the glide's
 * length (`g`, s: `slurGlide`; 0 none) and whether their vibrato is their first voice's (it lasts as
 * long as they do).
 * @typedef {{ at: number, g: number, players: { oscs: OscillatorNode[], from: number, det: number }[], vib: boolean }} Handoff
 */

/**
 * The slur's glide into the next note (s): the last `g` of the note, its pitch moving to `next` — a
 * lip slur's flick on the brass (6 ms over more than a whole tone, else 15 ms), a finger's slide on
 * the strings and the leads (30 ms up to a major third, 15 ms beyond); at most a quarter of the
 * note, none on one under 0.1 s (after the attack's pitch automation, ≤ 60 ms).
 * @param {'strings'|'solo'|'brass'} kind @param {number} midi @param {number} next @param {number} dur
 */
function slurGlide(kind, midi, next, dur) {
  if (dur < 0.1) return 0;
  const leap = Math.abs(next - midi);
  const max = kind === 'brass' ? (leap > 2 ? 0.006 : 0.015) : leap <= 4 ? 0.03 : 0.015;
  return Math.min(max, dur * 0.25);
}

/**
 * Hand a slurring single note's players on to its tied successor (`takeSlur`): their oscillators,
 * to be tuned `next − midi` semitones up from `dets` by the glide (`g` s before `at`) — which the
 * successor plays when it takes them: a note whose successor never plays (a section switch asked for
 * while it sounds, a note skipped) ends on its own pitch.
 * @param {any} V @param {string} line @param {{ next?: number, midi?: number }} ev @param {number} at
 * @param {number} g @param {OscillatorNode[][]} oscs @param {number[]} dets @param {boolean} vib
 */
function handOn(V, line, ev, at, g, oscs, dets, vib) {
  const up = 100 * (ev.next - ev.midi);
  V.slurs.set(`${line}:${ev.next}`, { at, g, players: oscs.map((o, p) => ({ oscs: o, from: dets[p], det: dets[p] + up })), vib });
}

/**
 * The slur into `key` ending at `t` (the tied note on its predecessor's time: `handOn`): its glide
 * played on the note slurring on — its oscillators' pitch moving over [t − g, t]; the tied note is
 * scheduled ahead of that — and its players handed on to the tied note if they are `per` players of
 * `layers` oscillators each (else null: the tied note slurs in on its own tones while the old ones
 * glide as they fade). Taken once; a slur ending elsewhere is stale (no glide, null).
 * @param {any} V @param {string} key @param {number} t @param {number} per @param {number} layers
 * @returns {Handoff|null}
 */
function takeSlur(V, key, t, per, layers) {
  const h = /** @type {Handoff|undefined} */ (V.slurs.get(key));
  if (!h) return null;
  V.slurs.delete(key);
  if (Math.abs(h.at - t) > 0.005) return null;
  if (h.g > 0) {
    for (const x of h.players) {
      for (const o of x.oscs) {
        o.detune.setValueAtTime(x.from, t - h.g);
        o.detune.linearRampToValueAtTime(x.det, t);
      }
    }
  }
  return h.players.length === per && h.players.every((x) => x.oscs.length === layers) ? h : null;
}

/**
 * A note's brightness envelope (its lowpass, the brass's layer blend): its level envelope with the
 * tie's attack (to `tieEnd` s; 0: none) and the slur's crossfade out (from `slurFrom` s; Infinity:
 * none) held at the level they cross from or to — the line's sound stays bright through the join,
 * never each note's fade.
 * @param {Env} env @param {number} tieEnd @param {number} slurFrom
 * @returns {Env}
 */
function brightOf(env, tieEnd, slurFrom) {
  if (!tieEnd && slurFrom === Infinity) return env;
  const a = tieEnd ? envAt(env, tieEnd) : 0;
  const b = slurFrom < Infinity ? envAt(env, slurFrom) : 0;
  return env.map(([x, v]) => [x, x <= tieEnd ? a : x >= slurFrom ? b : v]);
}

/**
 * An event's share of its chord's level: √(its notes / the chord's), the chord's count `chordSize`
 * stamped on each event of a voicing split between desks of one kind or a part split between the
 * trombones and the tuba (ScoreKit `voiced`); absent, the event is the whole chord (1).
 * @param {{ beat: number, chordSize?: number }} ev @param {number} n its notes
 */
const chordShare = (ev, n) => Math.sqrt(n / (ev.chordSize ?? n));

const envEnd = (env) => env[env.length - 1][0];
/** An envelope's level at `x` s. */
function envAt(env, x) {
  if (x <= 0) return 0;
  for (let i = 1; i < env.length; i++) {
    if (x <= env[i][0]) {
      const [x0, v0] = env[i - 1];
      const [x1, v1] = env[i];
      return v0 + ((v1 - v0) * (x - x0)) / (x1 - x0);
    }
  }
  return 0;
}

/** Automate a parameter along an envelope from `t`: value fn(level) at each point (linear between). */
function setEnv(param, t, env, fn) {
  param.setValueAtTime(fn(env[0][1]), t);
  for (let i = 1; i < env.length; i++) param.linearRampToValueAtTime(fn(env[i][1]), t + env[i][0]);
}

/** `setEnv` along an envelope and its brightness envelope (`brightOf`: the same points): value fn(level, brightness). */
function setEnv2(param, t, env, bright, fn) {
  param.setValueAtTime(fn(env[0][1], bright[0][1]), t);
  for (let i = 1; i < env.length; i++) param.linearRampToValueAtTime(fn(env[i][1], bright[i][1]), t + env[i][0]);
}

/** Spread −1…1 of item i of n. */
const spread = (i, n) => (n > 1 ? (i / (n - 1)) * 2 - 1 : 0);

// ---------------------------------------------------------------------------------------------
// The string section
// ---------------------------------------------------------------------------------------------

/**
 * The desks: players on a sustained note, seat and spread, brightness [at rest, at full bow] in
 * multiples of the fundamental, vibrato depth (cents).
 */
const DESKS = {
  vn: { players: 4, seat: -0.5, width: 0.3, bright: [2.4, 7], vib: [9, 20] },
  va: { players: 3, seat: -0.1, width: 0.25, bright: [2.6, 8], vib: [8, 18] },
  vc: { players: 3, seat: 0.3, width: 0.22, bright: [4, 12], vib: [8, 16] },
  cb: { players: 2, seat: 0.5, width: 0.12, bright: [5, 14], vib: [6, 12] },
};

/** Below this fundamental (Hz) a marcato or spiccato note's players play in phase (`strings`). */
const LOCK_HZ = 250;

/** @type {Map<string, [Float64Array, Float64Array]>} */
const LOCKED = new Map();
/**
 * The power of a note's `per` players started in phase (`strings`' locked notes) and the power
 * the same players had on average when each but the first started `U[0, S]` s late (`spreadS`), per
 * harmonic k, against players at random phases (1) — the level such a note had on average (the
 * mix's) is kept, now the same every time. The players start coherent and drift apart at their
 * detunings' beat (the desk's spread, `spread(p, per)` × 6.5 cents; one drift LFO for all): per
 * pair, the envelope energy's mean of cos(ω t) (in phase) and of Re(E[e^{−iωΔU}] e^{iω t}) (the old
 * offsets), ω = 2π k × their frequency difference. Cached per note, players, spread and envelope.
 * @param {number} midi @param {number} per @param {number} S @param {Env} env
 * @returns {[Float64Array, Float64Array]} in phase, the old offsets: harmonic k's weights (`lockedThrough`; beyond K: 1)
 */
function lockedPower(midi, per, S, env) {
  const key = `${midi}|${per}|${S}|${env.join(';')}`;
  let A = LOCKED.get(key);
  if (!A) {
    const f0 = mtof(midi);
    const fp = Array.from({ length: per }, (_, p) => f0 * 2 ** ((spread(p, per) * 6.5) / 1200));
    const K = 32;
    A = [new Float64Array(K + 1).fill(1), new Float64Array(K + 1).fill(1)];
    // the envelope's energy at 4 ms steps
    const T = envEnd(env);
    const w = [];
    let W = 0;
    for (let x = 0.002; x < T; x += 0.004) {
      const e = envAt(env, x);
      w.push([x, e * e]);
      W += e * e;
    }
    W = Math.max(W, 1e-12);
    for (let k = 1; k <= K; k++) {
      // E[e^{−iωU}], U uniform in [0, S]: a late player's phase against the first's
      const a = 2 * Math.PI * k * f0 * S;
      const mr = a ? Math.sin(a) / a : 1;
      const mi = a ? -(1 - Math.cos(a)) / a : 0;
      let cNew = 0;
      let cOld = 0;
      for (let p = 0; p < per; p++) {
        for (let q = p + 1; q < per; q++) {
          // (two late players: |E|², real)
          const [Mr, Mi] = p === 0 ? [mr, mi] : [mr * mr + mi * mi, 0];
          const om = 2 * Math.PI * k * (fp[q] - fp[p]);
          for (const [x, e2] of w) {
            const c = Math.cos(om * x);
            cNew += e2 * c;
            cOld += e2 * (Mr * c - Mi * Math.sin(om * x));
          }
        }
      }
      A[0][k] = 1 + (2 * cNew) / (per * W);
      A[1][k] = 1 + (2 * cOld) / (per * W);
    }
    LOCKED.set(key, A);
  }
  return A;
}

/**
 * The bow's envelope per articulation and its brightness envelope (`brightOf`); a tie (`tieOf`) on
 * a sustained or tremolo note: no new bow stroke (`tieIn`, its crossfade's middle `mid`); a slur on
 * (`next`): the handed-over crossfade out (`HANDOFF`).
 * @param {string} art @param {number} dur @param {number} vel @param {'slur'|'chord'|null} tie @param {boolean} next @param {number} mid
 * @returns {[Env, Env]}
 */
function stringEnv(art, dur, vel, tie, next, mid) {
  const { pts, add } = envPts();
  const q = SLUR.strings;
  let tieEnd = 0;
  switch (art) {
    case 'marc': {
      const at = Math.min(0.012, dur * 0.3);
      add(at, 1);
      add(Math.min(at + 0.09, dur * 0.7), 0.55);
      ending(add, dur, 0.55, 0.08, q, next, HANDOFF);
      break;
    }
    case 'spic': {
      const d = Math.min(dur, 0.25);
      add(0.006, 1);
      add(d, 0.18);
      add(d + 0.03, 0);
      break;
    }
    case 'trem': {
      if (tie) tieEnd = tieIn(add, tie, q, 0.3, dur, 1, mid);
      else add(Math.min(0.25, dur * 0.45), 1);
      ending(add, dur, 1, 0.3, q, next, HANDOFF);
      break;
    }
    case 'swell': {
      const r = dur * 0.85;
      add(r * 0.05, 0.04);
      add(r * 0.5, 0.33);
      add(r, 1);
      ending(add, dur, 1, 0.35, q, next, HANDOFF);
      break;
    }
    default: {
      // sustained: a slower bow when soft
      if (tie) tieEnd = tieIn(add, tie, q, 0.3, dur, 1, mid);
      else add(Math.min(Math.max(0.06, 0.42 - 0.3 * vel), dur * 0.45), 1);
      ending(add, dur, 1, 0.3, q, next, HANDOFF);
    }
  }
  return [pts, brightOf(pts, tieEnd, next && art !== 'spic' ? dur : Infinity)];
}

/**
 * An ensemble event's group of a player (`p`) of a note (`i`): ≤ 2 groups — each an envelope and a
 * seat — a single note's players alternating between the desk's two halves, a chord's lower notes
 * in one and its upper in the other (divisi); every player starts under its group's envelope (the
 * waves start at a zero crossing).
 * @param {number} n notes @param {number} G groups (1 or 2)
 * @returns {(i: number, p: number) => number}
 */
const groupOf = (n, G) => (G === 1 ? () => 0 : n === 1 ? (i, p) => p % 2 : (i) => (i < Math.ceil(n / 2) ? 0 : 1));

/**
 * Each group's share of an event's power (T²: its players' share of all) divided by their power
 * (each player's note's, `R`): the gain that brings the group to it.
 * @param {number[]} R a note's power @param {number} per players a note @param {(i: number, p: number) => number} gOf @param {number} T
 */
function groupScales(R, per, gOf, T) {
  const sum = [0, 0];
  const cnt = [0, 0];
  for (let i = 0; i < R.length; i++) {
    for (let p = 0; p < per; p++) {
      const g = gOf(i, p);
      sum[g] += R[i];
      cnt[g]++;
    }
  }
  const C = R.length * per;
  return sum.map((s, g) => (cnt[g] ? (T * Math.sqrt(cnt[g] / C)) / Math.sqrt(Math.max(s, 1e-12)) : 0));
}

/**
 * The string section: a note (`midi`) or a chord (`notes`) of a desk — a note's players (a chord:
 * ≥ 2 a note, divisi) each with their own tuning, onset, vibrato and drift, in two groups seated
 * across the desk; the event's lowpass follows the bow (envelope × dynamics), darker sul tasto,
 * glassy sul ponticello; a tremolo's bowing from the bank's tremolo LFOs.
 * @param {ScoreHost} a @param {any} m @param {StringsEvent} ev @param {number} t @param {number} beat
 */
function strings(a, m, ev, t, beat) {
  const D = DESKS[ev.sec];
  if (!D) return unplayed(`strings/${ev.sec}`);
  const E = voiceAt(a, m, t);
  const rng = m.rng;
  const sr = E.ctx.sampleRate;
  const notes = ev.notes ?? [ev.midi];
  const n = notes.length;
  const dur = Math.max(0.03, ev.dur * beat);
  const art = ev.art ?? 'sus';
  const vel = clamp01(ev.vel);
  const short = (art === 'spic' || art === 'marc') && dur < 0.3;
  // a bowed accent's low notes: a note's players start whole periods apart, in phase, one line on
  // one drift — players a few ms apart would fix a random phase between them for the whole short
  // note, its fundamental combed its own way each time (`LOCK_HZ`)
  const locked = (art === 'spic' || art === 'marc') && notes.every((x) => mtof(x) < LOCK_HZ);
  const sustained = art === 'sus' || art === 'swell';
  const P = short ? 2 : D.players;
  const per = n === 1 ? P : Math.max(2, Math.ceil(P / n));
  const G = short || locked ? 1 : 2;
  const gOf = groupOf(n, G);
  const slur = n === 1 && ev.next !== undefined;
  // (a tie holds a sustained or tremolo bow on; an accent or a swell plays as written)
  const tie = art === 'sus' || art === 'trem' ? tieOf(ev) : null;
  // (a slur's players handed on from the note before — `handOn`)
  const line = `strings/${ev.sec}`;
  const hand = tie === 'slur' ? takeSlur(m.vq, `${line}:${ev.midi}`, t, per, 1) : null;
  const [env, bright] = stringEnv(art, dur, vel, tie, slur, hand ? HANDOFF : 0.7);
  const spreadS = short ? 0.006 : art === 'marc' ? 0.008 : 0.025;
  const dest = ev.far ? m.bus.far : subBus(a, m, ev.sec);
  const wave = waveOf(a, 'string');
  // the brightness: one lowpass, following the bow (before the one seat, or after the two)
  let fm = 1;
  for (const x of notes) fm *= mtof(x);
  fm **= 1 / n;
  const lo = D.bright[0] * (ev.tasto ? 0.6 : 1) * (ev.pont ? 1.7 : 1);
  const hi = D.bright[1] * (ev.tasto ? 0.55 : 1) * (ev.pont ? 1.5 : 1);
  const bow = 0.4 + 0.6 * vel;
  const fc = (e) => clamp(fm * (lo + (hi - lo) * e * bow), 180, 14000);
  const q = ev.pont ? 6 : 0;
  const lp = voiceFilter(E, ['lowpass', fc(0), q]);
  setEnv(lp.frequency, t, bright, fc);
  if (G === 1) {
    // (one group: a mono line, into the desk's shared seat unless the event has one of its own)
    if (ev.far || ev.pan) lp.connect(panner(E, D.seat + (ev.pan ?? 0))).connect(dest);
    else lp.connect(seatBus(a, m, ev.sec, D.seat));
  } else lp.connect(dest);
  const lpc = coefsOf(['lowpass', fc(1), q], sr);
  // the level: the event's power (T × dyn)² — its share of a split chord's —, each group its players' share
  const T = (LEVEL.strings * dyn(vel) * chordShare(ev, n) * (ev.far ? 1 : busGain(m, ev.sec))) / (art === 'trem' ? TREM_RMS : 1);
  // (locked: the note's in-phase power, against what its players had on average — `lockedPower`)
  const R = notes.map((x) => (locked
    ? lockedThrough(harmonicPower(sr, ev.sec, 'string', x), mtof(x), lpc, sr, lockedPower(x, per, spreadS, env))
    : powerThrough(harmonicPower(sr, ev.sec, 'string', x), mtof(x), lpc, sr)));
  const scales = groupScales(R, per, gOf, T);
  // where each group's players play in: its envelope (→ its seat), or, for a single note's two
  // seats (no tremolo), its seat — both under one envelope after them: their scales are the same
  // (every player's note at one level), so the envelope may follow the seats, on the stereo line
  const inputs = [];
  if (G === 2 && n === 1 && art !== 'trem') {
    const eg = envGain(E);
    setEnv(eg.gain, t, env, (e) => e * scales[0]);
    eg.connect(lp);
    for (let g = 0; g < G; g++) {
      const pn = panner(E, D.seat + (g ? 1 : -1) * D.width + (ev.pan ?? 0));
      pn.connect(eg);
      inputs.push(pn);
    }
  } else for (let g = 0; g < G; g++) {
    const eg = envGain(E);
    setEnv(eg.gain, t, env, (e) => e * scales[g]);
    let tail = eg;
    if (art === 'trem') {
      const am = E.ctx.createGain();
      am.gain.value = TREM_BASE;
      E.nodes.push(am);
      link(E, bankOf(a, m, 'trem')[Math.floor(hash01(notes[0] * 2 + g, 0x7e) * 8)], am.gain);
      eg.connect(am);
      tail = am;
    }
    if (G === 1) tail.connect(lp);
    else tail.connect(panner(E, D.seat + (g ? 1 : -1) * D.width + (ev.pan ?? 0))).connect(lp);
    inputs.push(eg);
  }
  // the players: ≤ 4 vibrato LFOs an event (a note's players on different ones)
  const vibOn = sustained && dur > 0.35 ? 0.18 + 0.22 * rng() : -1;
  const vbase = Math.floor(hash01(notes[0], ev.sec.charCodeAt(1)) * 8);
  let j = 0;
  /** @type {OscillatorNode[][]} */
  const played = [];
  const dets = [];
  for (let i = 0; i < n; i++) {
    const midi = notes[i];
    const f0 = mtof(midi);
    const hd = Math.floor(hash01(midi, 0x5d) * 4);
    let t0 = t;
    for (let p = 0; p < per; p++, j++) {
      const det0 = per > 1 ? spread(p, per) * 6.5 + (rng() - 0.5) * 1.2 : (rng() - 0.5) * 2;
      const off = j === 0 ? 0 : rng() * spreadS;
      // (locked: the note's later players whole periods after its first; tied: every player
      // sounding by `t`, none re-attacks — they start under the still closed envelope)
      const ts = tie ? Math.max(0, t - off) : locked && p > 0 ? t0 + Math.round(off * f0) / f0 : t + off;
      if (p === 0) t0 = ts;
      // (handed over: the player's oscillator, tuning, drift and vibrato the line's — the draws
      // made all the same); else the bow's grip (a few cents flat, settling)
      const det = hand ? hand.players[p].det : det0;
      const o = hand ? hand.players[p].oscs[0] : oscOf(E, wave, f0, det);
      if (hand) o.detune.setValueAtTime(det, t);
      else if (sustained && !ev.tied) {
        o.detune.setValueAtTime(det - (4 + 10 * rng()), ts);
        o.detune.linearRampToValueAtTime(det, ts + 0.06);
      }
      o.connect(inputs[gOf(i, p)]);
      if (vibOn >= 0 && !hand?.vib) vibrato(E, (vbase + (j % 4) * 2) % 8, vibOn, 0.35, () => D.vib[0] + rng() * (D.vib[1] - D.vib[0])).connect(o.detune);
      if (!hand) {
        if (!short) link(E, bankOf(a, m, 'drift')[(hd + (locked ? 0 : p)) % 4], o.detune);
        o.start(ts);
      }
      played.push([o]);
      dets.push(det);
    }
  }
  if (slur) handOn(m.vq, line, ev, t + dur, slurGlide('strings', ev.midi, ev.next, dur), played, dets, hand ? hand.vib : vibOn >= 0);
  finish(E, t + envEnd(env) + 0.005, hand ? played.map((x) => x[0]) : undefined, lp);
}

// ---------------------------------------------------------------------------------------------
// The solo cello and the fiddle (single lines: one player, a lowpass of their own)
// ---------------------------------------------------------------------------------------------

/**
 * The leads: brightness [at rest, at full bow] × the fundamental and its range (Hz), vibrato depth
 * (cents), its start and ramp (s), the shortest note that gets it, the attack [soft, loud], the
 * release, the bow's hiss (its level against the tone, at the attack and held).
 */
const LEADS = {
  solo: { bright: [3.5, 12], hz: [300, 9000], vib: [15, 25], vibOn: 0.25, vibRamp: 0.5, vibMin: 0.4, attack: [0.16, 0.08], rel: 0.16, scoop: 8, hiss: [0.08, 0.025] },
  fiddle: { bright: [3, 10], hz: [500, 12000], vib: [10, 18], vibOn: 0.12, vibRamp: 0.15, vibMin: 0.25, attack: [0.03, 0.016], rel: 0.06, scoop: 5, hiss: [0.14, 0.03] },
};

/**
 * The solo cello (the lament) or the fiddle: a bowed string through its body, a lowpass of its
 * own following the bow, expressive vibrato on the longer notes, the bow's hiss (an attack's bite,
 * a breath held), slurs.
 * @param {ScoreHost} a @param {any} m @param {SoloEvent} ev @param {number} t @param {number} beat
 */
function lead(a, m, ev, t, beat) {
  const L = LEADS[ev.kind];
  const bus = ev.kind;
  const E = voiceAt(a, m, t);
  const { ctx, V } = E;
  const rng = m.rng;
  const sr = ctx.sampleRate;
  const dur = Math.max(0.03, ev.dur * beat);
  const vel = clamp01(ev.vel);
  const f0 = mtof(ev.midi);
  const slur = ev.next !== undefined;
  // a slur's handoff (`handOn`): the note slurring on lends its oscillator to the tied note after
  // it, which plays on from the pitch the glide left it at — one tone through both notes' bodies and
  // envelopes, crossing linearly (a coherent pair: no dip whatever its phase); a tied note finding
  // none (its predecessor not played) slurs in on its own tone, equal power
  const hand = ev.tied ? takeSlur(V, `${ev.kind}:${ev.midi}`, t, 1, 1) : null;
  const { pts, add } = envPts();
  const tieEnd = ev.tied ? tieIn(add, 'slur', SLUR.solo, L.rel, dur, 1, hand ? HANDOFF : 0.7) : 0;
  if (!ev.tied) add(Math.min(L.attack[0] + (L.attack[1] - L.attack[0]) * vel, dur * 0.4), 1);
  ending(add, dur, 1, L.rel, SLUR.solo, slur, HANDOFF);
  const env = pts;
  const dest = ev.far ? m.bus.far : subBus(a, m, bus);
  const bow = 0.4 + 0.6 * vel;
  const fc = (e) => clamp(f0 * (L.bright[0] + (L.bright[1] - L.bright[0]) * e * bow), L.hz[0], L.hz[1]);
  const lp = voiceFilter(E, ['lowpass', fc(0), 0]);
  setEnv(lp.frequency, t, brightOf(env, tieEnd, slur ? dur : Infinity), fc);
  lp.connect(dest);
  const T = LEVEL[bus] * dyn(vel) * (ev.far ? 1 : busGain(m, bus));
  const k = T / Math.sqrt(powerThrough(harmonicPower(sr, bus, 'string', ev.midi), f0, coefsOf(['lowpass', fc(1), 0], sr), sr));
  const g = envGain(E);
  setEnv(g.gain, t, env, (e) => e * k);
  g.connect(lp);
  // (a handed-over oscillator: its tuning, drift and vibrato the line's — the draws made all the same)
  const det0 = (rng() - 0.5) * 2;
  const det = hand ? hand.players[0].det : det0;
  const o = hand ? hand.players[0].oscs[0] : oscOf(E, waveOf(a, 'string'), f0, det);
  if (hand) o.detune.setValueAtTime(det, t); // (a step only after a note too short to glide)
  else if (!ev.tied) {
    o.detune.setValueAtTime(det - L.scoop * (0.6 + 0.6 * rng()), t);
    o.detune.linearRampToValueAtTime(det, t + 0.06);
  }
  o.connect(g);
  // (vibrato: the oscillator's first voice's lasts as long as it does; a later voice's, its own note)
  const vibDepth = () => L.vib[0] + rng() * (L.vib[1] - L.vib[0]);
  if (dur > L.vibMin) {
    if (hand?.vib) vibDepth();
    else vibrato(E, Math.floor(hash01(ev.midi, 0x50) * 8), L.vibOn, L.vibRamp, vibDepth).connect(o.detune);
  }
  if (!hand) {
    link(E, bankOf(a, m, 'drift')[Math.floor(hash01(ev.midi, 0x51) * 4)], o.detune);
    o.start(t);
  }
  if (slur) handOn(V, ev.kind, ev, t + dur, slurGlide('solo', ev.midi, ev.next, dur), [[o]], [det], hand ? hand.vib : dur > L.vibMin);
  // the bow's hiss, through the body: a bite on the attack (a slur's none: its breath crossing
  // over as the tone does), then a breath held along the tone
  const hk = T / Math.sqrt(WHITE_VAR * noisePower(sr, bus));
  const held = L.hiss[1];
  const hiss = envPts();
  let settle = tieEnd;
  if (ev.tied) {
    hiss.add(tieEnd * 0.5, held * 0.7);
    hiss.add(tieEnd, held);
  } else {
    settle = Math.min(0.09, env[2][0] * 0.6);
    hiss.add(Math.min(0.012, settle * 0.5), L.hiss[0]);
    hiss.add(settle, held);
  }
  for (let i = 2; i < env.length; i++) if (env[i][0] > settle) hiss.add(env[i][0], env[i][1] * held);
  const ng = envGain(E);
  setEnv(ng.gain, t, hiss.pts, (e) => e * hk);
  noiseOf(E, t).connect(ng).connect(dest);
  // (a handed-over oscillator is not this voice's source: the voice's `_cleanup` follows its noise)
  finish(E, t + envEnd(env) + 0.005, hand ? [o] : undefined);
}

// ---------------------------------------------------------------------------------------------
// The brass
// ---------------------------------------------------------------------------------------------

/**
 * The families: players on a note, sub-bus, the soft and loud layers, seat and spread, the lip's
 * scoop (cents), attack (s), brightness [at rest, full] × the fundamental and its range (Hz). The
 * cuivré horn: one layer, never darker than 1.3 kHz (its rasp on a small speaker). Brass plays
 * straight: no vibrato, only the slow drift (not the tuba).
 */
const FAMS = {
  hn: { players: 3, sub: 'hn', level: 'hn', soft: 'hnSoft', loud: 'hnLoud', seat: -0.3, width: 0.15, scoop: 30, attack: 0.05, bright: [2, 8], hz: [220, 5000], drift: true },
  tbn: { players: 2, sub: 'tbn', level: 'tbn', soft: 'tbnSoft', loud: 'tbnLoud', seat: 0.25, width: 0.15, scoop: 22, attack: 0.035, bright: [2.5, 12], hz: [200, 7000], drift: true },
  tba: { players: 1, sub: 'tba', level: 'tba', soft: 'tbaSoft', loud: 'tbaLoud', seat: 0.4, width: 0, scoop: 18, attack: 0.06, bright: [2, 7], hz: [120, 2000], drift: false },
};
const CUIVRE = { players: 3, sub: 'hnc', level: 'hnc', soft: null, loud: 'cuivre', seat: -0.3, width: 0.15, scoop: 40, attack: 0.055, bright: [4, 10], hz: [1300, 7000], drift: true };

/** The breath's envelope (a burst of air on the attack). */
const BREATH = [[0, 0], [0.004, 1], [0.03, 0.25], [0.09, 0]];

/**
 * The breath's envelope per articulation and its brightness envelope (`brightOf`); a tie (`tieOf`)
 * on a sustained note: no new tonguing — straight to the held level (`tieIn`, its crossfade's
 * middle `mid`), no accent; a slur on (`next`): the handed-over crossfade out (`HANDOFF`).
 * @param {string} art @param {number} dur @param {number} vel @param {'slur'|'chord'|null} tie @param {boolean} next @param {number} attack @param {number} mid
 * @returns {[Env, Env]}
 */
function brassEnv(art, dur, vel, tie, next, attack, mid) {
  const { pts, add } = envPts();
  const q = SLUR.brass;
  let tieEnd = 0;
  if (art === 'stab') {
    add(Math.min(0.018, dur * 0.3), 1);
    add(Math.min(0.15, dur * 0.7), 0.5);
    ending(add, dur, 0.5, 0.09, q, next, HANDOFF);
  } else if (art === 'swell') {
    const r = dur * 0.88;
    add(r * 0.08, 0.05);
    add(r * 0.5, 0.32);
    add(r, 1);
    ending(add, dur, 1, 0.22, q, next, HANDOFF);
  } else {
    if (tie) tieEnd = tieIn(add, tie, q, 0.13, dur, 0.86, mid);
    else {
      const at = Math.min(attack * (1.15 - 0.3 * vel), dur * 0.4);
      add(at, 1);
      add(Math.min(at + 0.25, Math.max(at + 0.002, dur * 0.6)), 0.86);
    }
    ending(add, dur, 0.86, 0.13, q, next, HANDOFF);
  }
  return [pts, brightOf(pts, tieEnd, next ? dur : Infinity)];
}

/**
 * The brass: a note of a family's players (a line) or a chord (a player or two a note), each player
 * with its own tuning, onset and drift, in ≤ 2 groups across the family's seat; dynamics open the
 * event's lowpass and blend the soft layer into the loud one (envelope × dynamics: the two layers'
 * phases match, so the blend is a spectrum between them); the lip's scoop on an attack that is not
 * a slur, the air's burst; `cuivre` the stopped horn forced brassy.
 * @param {ScoreHost} a @param {any} m @param {BrassEvent} ev @param {number} t @param {number} beat
 */
function brass(a, m, ev, t, beat) {
  const F = ev.cuivre ? CUIVRE : FAMS[ev.fam];
  if (!F) return unplayed(`brass/${ev.fam}`);
  const E = voiceAt(a, m, t);
  const rng = m.rng;
  const sr = E.ctx.sampleRate;
  const notes = ev.notes ?? [ev.midi];
  const n = notes.length;
  const dur = Math.max(0.03, ev.dur * beat);
  const art = ev.art ?? 'sus';
  const vel = clamp01(ev.vel);
  const P = Math.max(1, Math.round(ev.players ?? F.players));
  const per = n === 1 ? P : Math.max(1, Math.round(P / n));
  const seated = SUBS[F.sub].seat !== undefined;
  const G = seated || n * per === 1 ? 1 : 2;
  const gOf = groupOf(n, G);
  const slur = n === 1 && ev.next !== undefined;
  // (a tie holds a sustained note on; a stab or a swell plays as written)
  const tie = art === 'stab' || art === 'swell' ? null : tieOf(ev);
  // (a slur's players handed on from the note before — `handOn`)
  const line = `brass/${F.sub}`;
  const hand = tie === 'slur' ? takeSlur(m.vq, `${line}:${ev.midi}`, t, per, F.soft ? 2 : 1) : null;
  const [env, bright] = brassEnv(art, dur, vel, tie, slur, F.attack, hand ? HANDOFF : 0.7);
  const spreadS = art === 'stab' ? 0.004 : 0.008;
  const dest = ev.far ? m.bus.far : subBus(a, m, F.sub);
  // the brightness: one lowpass (before the one seat, or after the two)
  let fm = 1;
  for (const x of notes) fm *= mtof(x);
  fm **= 1 / n;
  const fc = (e) => clamp(fm * (F.bright[0] + (F.bright[1] - F.bright[0]) * e * vel), F.hz[0], F.hz[1]);
  const lp = voiceFilter(E, ['lowpass', fc(0), 0]);
  setEnv(lp.frequency, t, bright, fc);
  if (G === 1 && !seated) {
    // (one group: a mono line, into the family's shared seat unless the event has one of its own)
    if (ev.far || ev.pan) lp.connect(panner(E, F.seat + (ev.pan ?? 0))).connect(dest);
    else lp.connect(seatBus(a, m, F.sub, F.seat));
  } else lp.connect(dest);
  const lpc = coefsOf(['lowpass', fc(1), 0], sr);
  const T = LEVEL[F.level] * dyn(vel) * chordShare(ev, n) * (ev.far ? 1 : busGain(m, F.sub));
  const blend = (e) => clamp01(e * vel);
  const soft = F.soft && waveOf(a, F.soft);
  const loud = waveOf(a, F.loud);
  // the level: each group its players' share of the event's power, through the blend at full (b = vel)
  const lpH = (f0) => {
    const h = [];
    for (let k = 1; k < 65; k++) h.push(mag2(lpc, (2 * Math.PI * k * f0) / sr));
    return h;
  };
  const pS = notes.map((x) => (F.soft ? harmonicPower(sr, F.sub, F.soft, x) : null));
  const pL = notes.map((x) => harmonicPower(sr, F.sub, F.loud, x));
  const H = notes.map((x) => lpH(mtof(x)));
  const RS = pS.map((p, i) => (p ? powerThrough(p, mtof(notes[i]), lpc, sr) : 0));
  const RL = pL.map((p, i) => powerThrough(p, mtof(notes[i]), lpc, sr));
  const kS = [0, 0];
  const kL = [0, 0];
  const RB = [0, 0];
  const cnt = [0, 0];
  for (let g = 0; g < G; g++) {
    // the group's layers each at unit power (over its players' notes)
    let ms = 0;
    let ml = 0;
    let c = 0;
    for (let i = 0; i < n; i++) for (let p = 0; p < per; p++) if (gOf(i, p) === g) { ms += RS[i]; ml += RL[i]; c++; }
    cnt[g] = c;
    if (!c) continue;
    kS[g] = soft ? 1 / Math.sqrt(Math.max(ms / c, 1e-12)) : 0;
    kL[g] = 1 / Math.sqrt(Math.max(ml / c, 1e-12));
    const b = soft ? blend(1) : 1;
    for (let i = 0; i < n; i++) {
      for (let p = 0; p < per; p++) {
        if (gOf(i, p) !== g) continue;
        for (let k = 1; k < pL[i].length && k <= H[i].length; k++) {
          const x = (soft ? (1 - b) * kS[g] * Math.sqrt(pS[i][k]) : 0) + b * kL[g] * Math.sqrt(pL[i][k]);
          RB[g] += x * x * H[i][k - 1];
        }
      }
    }
  }
  const layers = [];
  for (let g = 0; g < G; g++) {
    const sc = cnt[g] ? (T * Math.sqrt(cnt[g] / (n * per))) / Math.sqrt(Math.max(RB[g], 1e-12)) : 0;
    const out = G === 1 ? lp : panner(E, F.seat + (g ? 1 : -1) * F.width + (ev.pan ?? 0));
    if (out !== lp) out.connect(lp);
    // (the layers' blend follows the brightness envelope: a slur's join keeps its timbre)
    let gS = null;
    if (soft) {
      gS = envGain(E);
      setEnv2(gS.gain, t, env, bright, (e, b) => e * (1 - blend(b)) * kS[g] * sc);
      gS.connect(out);
    }
    const gL = envGain(E);
    if (soft) setEnv2(gL.gain, t, env, bright, (e, b) => e * blend(b) * kL[g] * sc);
    else setEnv(gL.gain, t, env, (e) => e * kL[g] * sc);
    gL.connect(out);
    layers.push([gS, gL]);
  }
  // the players
  const hd = Math.floor(hash01(notes[0], 0xb7) * 4);
  let j = 0;
  /** @type {OscillatorNode[][]} */
  const played = [];
  const dets = [];
  for (let i = 0; i < n; i++) {
    const midi = notes[i];
    const f0 = mtof(midi);
    for (let p = 0; p < per; p++, j++) {
      // (tied: every player sounding by `t`, as the strings')
      const off = j === 0 ? 0 : rng() * spreadS;
      const ts = tie ? Math.max(0, t - off) : t + off;
      const det0 = per > 1 ? spread(p, per) * 6 + (rng() - 0.5) : (rng() - 0.5) * 2;
      // (handed over: the player's oscillators, tuning and drift the line's — the draws made all the same)
      const det = hand ? hand.players[p].det : det0;
      const [gS, gL] = layers[gOf(i, p)];
      const own = hand ? hand.players[p].oscs : gS ? [oscOf(E, soft, f0, det), oscOf(E, loud, f0, det)] : [oscOf(E, loud, f0, det)];
      const scoop = F.scoop * (0.6 + 0.6 * hash01(midi, p));
      own.forEach((o, l) => {
        // (handed over: on from the glide's pitch); the lip's scoop up to the note, unless
        // slurred (the slur's glide into the next: played by the tied note, `takeSlur`)
        if (hand) o.detune.setValueAtTime(det, t);
        else if (!ev.tied && art !== 'swell') {
          o.detune.setValueAtTime(det - scoop, ts);
          o.detune.linearRampToValueAtTime(det, ts + (art === 'stab' ? 0.03 : 0.045));
        }
        o.connect(gS && l === 0 ? gS : gL);
        if (!hand) {
          if (F.drift) link(E, bankOf(a, m, 'drift')[(hd + j) % 4], o.detune);
          o.start(ts);
        }
      });
      played.push(own);
      dets.push(det);
    }
  }
  if (slur) handOn(m.vq, line, ev, t + dur, slurGlide('brass', notes[0], ev.next, dur), played, dets, false);
  // the air's burst on an attack (not a slur, not a swell), through the family's formant
  if (!ev.tied && art !== 'swell') {
    const bk = (T * (art === 'stab' ? 0.22 : 0.15)) / Math.sqrt(WHITE_VAR * noisePower(sr, F.sub));
    const bg = envGain(E);
    setEnv(bg.gain, t, BREATH, (e) => e * bk);
    noiseOf(E, t).connect(bg).connect(dest);
  }
  finish(E, t + envEnd(env) + 0.005, hand ? played.flat() : undefined, lp);
}

// ---------------------------------------------------------------------------------------------
// The choir
// ---------------------------------------------------------------------------------------------

/** The choir's release (s). */
const CHOIR_RELEASE = 0.45;

/**
 * The choir: a chord sung on a vowel, each note by its part (bass, tenor, alto, soprano by pitch)
 * through that part × vowel's formants (one envelope a part), 3 singers a note (4 in a chord of ≤ 3)
 * with their own tuning, onset (0–60 ms), vibrato (≤ 4 of the bank's an event, a note's singers on
 * different ones) and drift; the louder, the more of them sing with the bright glottal source; a
 * breath of air through the vowel.
 * @param {ScoreHost} a @param {any} m @param {ChoirEvent} ev @param {number} t @param {number} beat
 */
function choir(a, m, ev, t, beat) {
  const E = voiceAt(a, m, t);
  const rng = m.rng;
  const sr = E.ctx.sampleRate;
  const notes = ev.notes;
  const n = notes.length;
  const vowel = ev.vowel ?? 'a';
  const dur = Math.max(0.05, ev.dur * beat);
  const vel = clamp01(ev.vel);
  const S = n <= 3 ? 4 : 3;
  const { pts, add } = envPts();
  // (tied: the same chord held on — sung on through the last one's release, `tieIn`)
  if (ev.tied) tieIn(add, 'chord', 0, CHOIR_RELEASE, dur, 1);
  else add(Math.max(0.05, Math.min(0.75 - 0.35 * vel, dur * 0.45)), 1);
  ending(add, dur, 1, CHOIR_RELEASE, 0, false);
  const env = pts;
  const T = LEVEL.choir * dyn(vel) * chordShare(ev, n) * (ev.far ? 1 : busGain(m, 'choir'));
  const loudSingers = Math.round(S * clamp01((vel - 0.3) / 0.6));
  const waves = Array.from({ length: S }, (_, s) => (s >= S - loudSingers ? 'glotLoud' : 'glotSoft'));
  const pw = waves.map((w) => waveOf(a, w));
  // a group a part: its share of the event's power (its singers' share), through its own formants
  const parts = [];
  /** @type {Map<string, { bus: string, head: AudioNode, R: number, c: number, g: GainNode|null }>} */
  const groups = new Map();
  for (const midi of notes) {
    const part = partOf(midi);
    parts.push(part);
    let G = groups.get(part);
    if (!G) groups.set(part, (G = { bus: `choir:${part}:${vowel}`, head: ev.far ? m.bus.far : choirBus(a, m, part, vowel), R: 0, c: 0, g: null }));
    for (const w of waves) G.R += powerThrough(harmonicPower(sr, G.bus, w, midi), mtof(midi), null, sr);
    G.c += S;
  }
  for (const G of groups.values()) {
    const k = (T * Math.sqrt(G.c / (n * S))) / Math.sqrt(Math.max(G.R, 1e-12));
    G.g = envGain(E);
    setEnv(G.g.gain, t, env, (e) => e * k);
    G.g.connect(G.head);
  }
  const vbase = Math.floor(hash01(notes[0], 0xc4) * 8);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const midi = notes[i];
    const f0 = mtof(midi);
    const G = groups.get(parts[i]);
    const hd = Math.floor(hash01(midi, 0xc5) * 4);
    for (let s = 0; s < S; s++, j++) {
      const det = spread(s, S) * 7 + (rng() - 0.5) * 2;
      const o = oscOf(E, pw[s], f0, det);
      o.connect(G.g);
      vibrato(E, (vbase + (j % 4) * 2) % 8, 0.3, 0.6, () => 9 + rng() * 10).connect(o.detune);
      link(E, bankOf(a, m, 'drift')[(hd + s) % 4], o.detune);
      // (tied: every singer sounding by `t`, none re-attacks)
      const off = j === 0 ? 0 : rng() * 0.06;
      o.start(ev.tied ? Math.max(0, t - off) : t + off);
    }
  }
  // the breath: air through the vowel (of the middle note's part), breathier when soft
  const G = groups.get(parts[Math.floor(n / 2)]);
  const bk = (T * 0.07 * (1.3 - 0.6 * vel)) / Math.sqrt(WHITE_VAR * noisePower(sr, G.bus));
  const bg = envGain(E);
  setEnv(bg.gain, t, env, (e) => e * bk);
  noiseOf(E, t).connect(bg).connect(G.head);
  finish(E, t + envEnd(env) + 0.005);
}

// ---------------------------------------------------------------------------------------------
// The organ and the drone (held notes; re-spoken in phase)
// ---------------------------------------------------------------------------------------------

/**
 * A note held by the organ or the drone (`m.held`, by '<kind>:<midi>'): its start frame, its
 * notated end, its envelope (s from its start) and scale, its gain, its event's sources and how
 * many of that event's notes still sound.
 * @typedef {{ frame: number, start: number, end: number, until: number, env: Env, scale: number, gain: GainNode, group: { srcs: AudioScheduledSourceNode[], live: number, stop: number } }} HeldNote
 */

/**
 * Re-speak a held note in phase (design §4, engine critique 7): the new note starts on the first
 * sample frame at or after `t` where it is a whole number of periods after the old one (Chrome
 * starts an oscillator at phase 0, and the same wave at the same frequency then lines up partial for
 * partial), and the two cross over complementary linear ramps of ≥ 0.25 s (the old one's from its
 * level there — held from its notated end when the new one starts within a period after it — to
 * 0, its sources stopped there once all its event's notes have gone; the new one's from 0). Null
 * when nothing of that note sounds.
 * @returns {{ ts: number, frame: number, x: number } | null}
 */
function respeak(E, key, t, f) {
  const h = /** @type {HeldNote|undefined} */ (E.m.held?.[key]);
  if (!h || h.until <= t) return null;
  const sr = E.ctx.sampleRate;
  const nMin = Math.ceil(t * sr);
  const period = sr / f;
  let k = Math.max(0, Math.ceil((nMin - h.frame) / period));
  let frame = h.frame + Math.round(k * period);
  while (frame < nMin) frame = h.frame + Math.round(++k * period);
  const ts = (frame + 0.25) / sr;
  const x = Math.max(0.25, h.end - ts);
  const g = h.gain.gain;
  if (ts > h.end && ts - h.end <= 1 / f + 1e-6 && E.ctx.currentTime < h.end) {
    // the new note a fraction of a period after the old one's notated end (the frame alignment):
    // the old one held at its level there until `ts` (its release never begins — no sag)
    g.cancelScheduledValues(h.end + 1e-6);
    g.setValueAtTime(envAt(h.env, h.end - h.start) * h.scale, ts);
  } else {
    // else from where its envelope is at `ts`: the same line up to it (a ramp, never a step)
    g.cancelScheduledValues(ts);
    g.linearRampToValueAtTime(envAt(h.env, ts - h.start) * h.scale, ts);
  }
  g.linearRampToValueAtTime(0, ts + x);
  h.until = ts;
  h.group.stop = Math.max(h.group.stop, ts + x + 0.005);
  if (--h.group.live === 0) for (const s of h.group.srcs) s.stop(h.group.stop);
  return { ts, frame, x };
}

/**
 * Held notes (the organ, the drone): one oscillator a note (its ranks in one wave, in tune, no
 * drift), an envelope a note; `respeak` notes — and a `tied` chord, the same chord held on — cross
 * over in phase from the same note sounding. Returns when the last ends and how many were re-spoken.
 * @param {Voice} E @param {any} ev @param {number} beat @param {string} kind @param {string} wave @param {AudioNode} dest
 * @param {string} bus @param {(dur: number, attack: number) => Env} envOf `attack`: a cross-over's (s), or 0
 * @param {number} T
 * @returns {{ end: number, respoken: number }}
 */
function heldNotes(E, ev, beat, kind, wave, dest, bus, envOf, T) {
  const { ctx, m } = E;
  const sr = ctx.sampleRate;
  const notes = ev.notes;
  const n = notes.length;
  const w = waveOf(E.a, wave);
  const t = E.t;
  const group = { srcs: E.srcs, live: n, stop: 0 };
  // (each note its share of the event's power — of its split voicing's, `chordSize`)
  const size = ev.chordSize ?? n;
  let end = t;
  let respoken = 0;
  for (const midi of notes) {
    const f0 = mtof(midi);
    const key = `${kind}:${midi}`;
    const r = ev.respeak || ev.tied ? respeak(E, key, t, f0) : null;
    if (r) respoken++;
    const frame = r ? r.frame : Math.ceil(t * sr);
    const ts = r ? r.ts : (frame + 0.25) / sr;
    const dur = Math.max(0.05, ev.dur * beat - (ts - t));
    const env = envOf(dur, r ? r.x : 0);
    const k = T / Math.sqrt(size * powerThrough(harmonicPower(sr, bus, wave, midi), f0, null, sr));
    const g = envGain(E);
    setEnv(g.gain, ts, env, (e) => e * k);
    g.connect(dest);
    const o = oscOf(E, w, f0, 0);
    o.connect(g);
    o.start(ts);
    end = Math.max(end, ts + envEnd(env));
    if (m.held) m.held[key] = { frame, start: ts, end: ts + dur, until: ts + envEnd(env), env, scale: k, gain: g, group };
  }
  return { end, respoken };
}

/**
 * The organ: pipes speaking (the event's lowpass opening as they do, or with `swell` the swell box
 * opening over the note), held, the wind cut; the pedal and the low manual notes principal 8' +
 * octave 4', the manual principal + stopped flute.
 * @param {ScoreHost} a @param {any} m @param {OrganEvent} ev @param {number} t @param {number} beat
 */
function organ(a, m, ev, t, beat) {
  const E = voiceAt(a, m, t);
  const swell = !!ev.swell;
  const dur = Math.max(0.05, ev.dur * beat);
  const lp = voiceFilter(E, ['lowpass', 3600, -3]);
  lp.connect(ev.far ? m.bus.far : subBus(a, m, 'organ'));
  const wave = ev.pedal || Math.min(...ev.notes) < 52 ? 'organPedal' : 'organManual';
  const envOf = (d, x) => {
    const { pts, add } = envPts();
    if (x) add(x, 1);
    else if (swell) {
      add(0.02, 0.2);
      add(Math.max(0.04, d * 0.6), 1);
    } else add(Math.min(0.07, d * 0.3), 1);
    ending(add, d, 1, 0.18, 0.05, false);
    return pts;
  };
  const { end, respoken } = heldNotes(E, ev, beat, 'organ', wave, lp, 'organ', envOf, LEVEL.organ * dyn(ev.vel) * (ev.far ? 1 : busGain(m, 'organ')));
  // the pipes speaking: the lowpass opening (a re-spoken note's pipes are speaking already — it
  // stays open, as the old note's is)
  if (swell || !respoken) {
    const f = swell ? 700 : 1200;
    lp.frequency.value = f;
    lp.frequency.setValueAtTime(f, t);
    lp.frequency.linearRampToValueAtTime(3600, t + (swell ? Math.max(0.1, dur * 0.6) : 0.08));
  }
  finish(E, end + 0.005);
}

/**
 * The drone: a dark held pedal through the drone bus (a slow swell in and out), or with `reed`
 * the festival's chanter drone, bright and nasal.
 * @param {ScoreHost} a @param {any} m @param {DroneEvent} ev @param {number} t @param {number} beat
 */
function drone(a, m, ev, t, beat) {
  const E = voiceAt(a, m, t);
  const reed = !!ev.reed;
  const bus = reed ? 'reed' : 'drone';
  const envOf = (d, x) => {
    const { pts, add } = envPts();
    add(x || (reed ? Math.min(0.25, d * 0.3) : Math.min(3, d * 0.3)), 1);
    ending(add, d, 1, reed ? 0.4 : 1.2, 0.05, false);
    return pts;
  };
  const dest = ev.far ? m.bus.far : subBus(a, m, bus);
  const { end } = heldNotes(E, ev, beat, 'drone', reed ? 'reed' : 'string', dest, bus, envOf, LEVEL[bus] * dyn(ev.vel) * (ev.far ? 1 : busGain(m, bus)));
  finish(E, end + 0.005);
}

// ---------------------------------------------------------------------------------------------
// Playing an event
// ---------------------------------------------------------------------------------------------

/** Event kinds (and desks, families) already reported as played by no instrument (logged once each). */
const UNPLAYED = new Set();
function unplayed(what) {
  if (UNPLAYED.has(what)) return;
  UNPLAYED.add(what);
  console.error(`[AudioSystem] no instrument plays the score event kind "${what}"`);
}

/**
 * A note slurring on (`next`) into one at or past a pending section switch (`m.switchAt`, in the
 * section's beats: that note is never played) plays as if not slurred — no glide to nowhere.
 * @template {StringsEvent|SoloEvent|BrassEvent} Ev
 * @param {Ev} ev @param {any} m
 * @returns {Ev}
 */
function unslur(ev, m) {
  if (ev.next === undefined || m.switchAt < 0 || ev.beat + ev.dur < m.switchAt - 1e-9) return ev;
  return { ...ev, next: undefined };
}

/**
 * Play one event of a score instrument (AudioSystem `_scheduleMusic`; the harp and the flute stay
 * there) at `tt`, `beat` seconds a beat, on the instance `m`'s buses. A kind not played here goes to
 * MusicRenders.js `playRendered`; one neither plays is logged once.
 * @param {ScoreHost} a
 * @param {ScoreEvent} ev
 * @param {number} tt
 * @param {number} beat
 * @param {any} m the music instance
 */
export function scoreVoice(a, ev, tt, beat, m) {
  drainWaves(a, m.vq);
  switch (ev.kind) {
    case 'strings': strings(a, m, unslur(ev, m), tt, beat); break;
    case 'solo': case 'fiddle': lead(a, m, unslur(ev, m), tt, beat); break;
    case 'brass': brass(a, m, unslur(ev, m), tt, beat); break;
    case 'choir': choir(a, m, ev, tt, beat); break;
    case 'organ': organ(a, m, ev, tt, beat); break;
    case 'drone': drone(a, m, ev, tt, beat); break;
    default:
      if (!playRendered(a, ev, tt, beat, m)) unplayed(ev.kind);
      break;
  }
}

// ---------------------------------------------------------------------------------------------
// Warming a track before its first start
// ---------------------------------------------------------------------------------------------

/** The kinds `scoreVoice` plays itself (the others are MusicRenders.js's rendered instruments). */
const LIVE_KINDS = new Set(['strings', 'solo', 'fiddle', 'brass', 'choir', 'organ', 'drone']);
/** How far into each section the warm plays its notes (s): what a start's first schedules play. */
const WARM_S = 0.6;
/** The tracks warmed at a sample rate (`<track>@<Hz>`): their instruments built once there. */
const WARMED = new Set();

/**
 * The notes `warmVoices` plays: every section's live notes in its first WARM_S, then the first
 * note of each kind (and brass family, string desk, articulation) the track plays live later; and
 * the harp's pitches in those first WARM_S (`harps`: AudioSystem's plucks, a buffer a pitch).
 * @param {{ bpm: number, sections: Record<string, { bpm?: number, events: any[] }> }} tr
 * @param {Set<number>} harps
 * @returns {[any, number][]} [event, seconds a beat]
 */
function warmNotes(tr, harps) {
  const out = [];
  const seen = new Set();
  const sections = Object.values(tr.sections);
  const beatOf = (sec) => 60 / (sec.bpm ?? tr.bpm);
  const sort = (ev) => `${ev.kind}|${ev.fam ?? ev.sec ?? ''}|${ev.art ?? ''}|${ev.cuivre ? 1 : 0}`;
  for (const sec of sections) {
    const beat = beatOf(sec);
    for (const ev of sec.events) {
      if (ev.beat * beat > WARM_S) break;
      if (ev.kind === 'harp') harps.add(ev.midi);
      if (!LIVE_KINDS.has(ev.kind)) continue;
      out.push([ev, beat]);
      seen.add(sort(ev));
    }
  }
  for (const sec of sections) {
    const beat = beatOf(sec);
    for (const ev of sec.events) {
      if (!LIVE_KINDS.has(ev.kind) || seen.has(sort(ev))) continue;
      seen.add(sort(ev));
      out.push([ev, beat]);
    }
  }
  return out;
}

/**
 * Warm a built score track ahead of its first start (VanquishAudio.js `primeMusic`). A start
 * builds the instance's buses and its first notes in one call, so whatever is done for the first
 * time — the instruments' code compiled, the per-note level caches (`harmonicPower`,
 * `lockedPower` …), the waves of the context — would hold the main thread there. Here instead,
 * one piece at a time (`turn()` between them):
 *   - the first time at a sample rate (WARMED): its waves' coefficients (`partsOf`), then an
 *     instance of the track on a throwaway OfflineAudioContext — never rendered, so never heard, with its own random numbers (`rng`:
 *     the track's are never drawn) and a host of its own (nothing played, counted or kept by the
 *     AudioSystem or MusicRenders.js) — its buses, then the notes of `warmNotes`, one a piece;
 *   - on `ctx`, the context the track will play on (null before the AudioSystem's unlock): every
 *     wave the track plays not made there yet (`waveOf`), one a piece, and the harp's first
 *     pitches (`harp(midi)`: AudioSystem `_harpBuffer`, a pure buffer a pitch), one a piece.
 * Each piece's main-thread time goes to `block(label, ms)` (MusicRenders.js `noteBlock`).
 * @param {BaseAudioContext|null} ctx
 * @param {string} name the track
 * @param {{ bpm: number, start: string, sections: Record<string, any>, score: ScoreTrackDef }} tr the built track (AudioSystem `_combatTrack`)
 * @param {() => number} rng
 * @param {() => Promise<void>} turn
 * @param {(label: string, ms: number) => void} block
 * @param {(midi: number) => void} harp
 */
export async function warmVoices(ctx, name, tr, rng, turn, block, harp) {
  const sr = ctx?.sampleRate ?? 48000;
  const off = new OfflineAudioContext(2, 128, sr);
  const out = off.createGain();
  const m = {
    out, harpBus: off.createBiquadFilter(), fluteBus: off.createBiquadFilter(), nodes: [], sections: tr.sections, sectionName: tr.start,
    section: tr.sections[tr.start], bpm: tr.sections[tr.start].bpm ?? tr.bpm, rng, switchAt: -1, pending: null, faders: [out], sources: [], held: null,
  };
  const piece = (label, fn) => {
    const t0 = performance.now();
    fn();
    block(`${name} warm ${label}`, performance.now() - t0);
  };
  const key = `${name}@${sr}`;
  const harps = new Set();
  const notes = warmNotes(tr, harps);
  const need = scanOf(m);
  const waves = [...need.first.keys()].sort((x, y) => need.first.get(x) - need.first.get(y));
  if (need.drift) waves.push('drift');
  if (!WARMED.has(key)) {
    WARMED.add(key);
    // (the waves' coefficients first, one a piece: the buses make the first ones)
    for (const w of waves) {
      if (PARTS.has(w) || !Object.hasOwn(SPECTRA, w)) continue;
      await turn();
      piece(`parts ${w}`, () => partsOf(w));
    }
    // (what the voices use of a host: the context, the reverb's input, the noise loop, the cleanup)
    const host = /** @type {ScoreHost} */ (/** @type {any} */ ({
      ctx: off, _reverbIn: off.createGain(), _white: off.createBuffer(1, 128, sr), _cleanup() {},
      _noiseSource(buffer, t, offset = 0) {
        const s = off.createBufferSource();
        s.buffer = buffer;
        s.loop = true;
        s.start(t, offset % buffer.duration);
        return s;
      },
    }));
    await turn();
    piece('buses', () => scoreBuses(host, m, tr.score));
    for (const [ev, beat] of notes) {
      await turn();
      piece(ev.kind, () => scoreVoice(host, ev, 0.05, beat, m));
    }
  }
  if (!ctx) return;
  for (const w of waves) {
    if (WAVES.get(ctx)?.has(w)) continue;
    await turn();
    piece(`wave ${w}`, () => waveOf(/** @type {any} */ ({ ctx }), w));
  }
  for (const midi of harps) {
    await turn();
    piece(`harp ${midi}`, () => harp(midi));
  }
}

/**
 * For QA (sandbox and test pages): the source waves' names, harmonic amplitudes and PeriodicWave
 * in a context, the sub-buses' static filters, a note's power through a bus (the level
 * normalisation's own numbers) and the instruments' levels.
 */
export const SCORE_VOICE_QA = Object.freeze({
  waves: Object.keys(SPECTRA), ampsOf, filtersOf, harmonicPower, coefsOf, mag2, LEVEL_DB,
  /** @param {BaseAudioContext} ctx @param {string} name */
  waveIn: (ctx, name) => waveOf(/** @type {any} */ ({ ctx }), name),
});
