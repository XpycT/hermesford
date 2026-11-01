/**
 * RenderKit — the offline render kit of Vanquish the Evil Dragon's audio (docs/contracts/
 * DRAGON_CAMPAIGN.md §6.9): every rendered sound (VanquishAudio.js's 31 sound effects and the
 * crowd / blaze voices) is a seeded synth rendered once into an AudioBuffer by an
 * OfflineAudioContext — the audio-rate work (band-limited oscillators, seeded noise, biquads,
 * formant voices, modal partials) runs on the audio rendering thread, off the main thread; JS draws
 * only the control curves (pitch, formant and envelope curves at VQ_CR) and finishes the result
 * (saturation, DC, fades, level). Here: the render being built (`Sketch`), its seeded noise loops
 * (`vqNoiseReady`), the seed of a name (`hashName`), and the render cache and queue (`VQ_CACHE`,
 * `loadRender`: one render at a time, behind the ones already asked for). The buffers belong to no
 * context and are shared by every AudioSystem. The score's rendered instruments use the same Sketch
 * through `renderMusic` (MusicRenders.js runs its own lane and cache): finished with one shared scale
 * per instrument instead of a normalisation, an anti-imaging lowpass, no fade for a loop's body, and
 * the loop a `post` made; the sounds' renders are finished as they always were.
 *
 * No browser global is touched when the module is evaluated (only when a render runs). Imports the
 * engine's utils only; MusicRenders.js and the campaigns' audio packs (VanquishAudio.js,
 * EvermereAudio.js) import it, and it is imported only through them (the shared score kit).
 */
import { mulberry32 } from '../../utils/math.js';

/** Sample rate of the VQ renders (the dull ones render at 16 kHz, the crowd's babble at 12 kHz). */
export const VQ_SR = 24000;
/**
 * Control rate of the VQ renders' computed curves (Hz). Point curves and envelopes become native
 * automation events instead (`Sketch.set`): a sampled curve costs Chrome ≈ 0.5 µs a point to hand
 * over, on the main thread.
 */
export const VQ_CR = 200;

/** Vowel formants F1–F3 (Hz, an adult man's; × 1.17 a woman's, × 1.3 a child's). */
export const VOWELS = { a: [730, 1090, 2440], e: [530, 1840, 2480], i: [300, 2250, 3000], o: [520, 860, 2400], u: [320, 800, 2240] };

/**
 * A control curve of a VQ render: samples at VQ_CR over the render, and — for a curve through points
 * (`pts`, `exp`, `zero` outside them) or an attack-decay envelope (`ad`) — what makes it native
 * automation events.
 * @typedef {Float32Array & { pts?: number[][], exp?: boolean, zero?: boolean, ad?: number[] }} Ctl
 */
/** @type {Map<number, { white: AudioBuffer, brown: AudioBuffer }>} seeded 6 s noise loops per sample rate */
export const VQ_NOISE = new Map();

/** The channel the renders yield through (made on first use) and who waits for a turn, in order. */
let turnPort = null;
/** @type {(() => void)[]} */
const turns = [];

/**
 * The page's turn: resolves in a task of its own after what is queued (a message through a
 * MessageChannel) — every render yields here. Not `setTimeout(0)`: Chrome holds a hidden tab's
 * timers to about one wake-up a second (a minute after five minutes hidden), which would stall a
 * prime for minutes; nor clamped to 4 ms after a few nested ones.
 * @returns {Promise<void>}
 */
export function nextTurn() {
  if (!turnPort) {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => turns.shift()?.();
    turnPort = ch.port2;
  }
  return new Promise((resolve) => {
    turns.push(resolve);
    turnPort.postMessage(0);
  });
}

/**
 * Make the seeded white and brown noise loops of the VQ renders at `sr` (shared by every render) —
 * in slices of a second of noise, yielding to the page between them.
 * @param {number} sr
 * @returns {Promise<void>}
 */
export async function vqNoiseReady(sr) {
  if (VQ_NOISE.has(sr)) return;
  const len = sr * 6;
  const rng = mulberry32(0x7e15e + sr);
  const white = new AudioBuffer({ numberOfChannels: 1, length: len, sampleRate: sr });
  const brown = new AudioBuffer({ numberOfChannels: 1, length: len, sampleRate: sr });
  const w = white.getChannelData(0);
  const b = brown.getChannelData(0);
  for (let i0 = 0; i0 < len; i0 += sr) {
    for (let i = i0; i < Math.min(len, i0 + sr); i++) w[i] = rng() * 2 - 1;
    await nextTurn();
  }
  let y = 0;
  for (let i0 = 0; i0 < len; i0 += sr) {
    for (let i = i0; i < Math.min(len, i0 + sr); i++) {
      y = (y + 0.02 * (rng() * 2 - 1)) / 1.02;
      b[i] = y * 3.5;
    }
    await nextTurn();
  }
  // a seamless loop without DC, like the ambience's brown noise
  const drift = b[len - 1] - b[0];
  let m = 0;
  for (let i = 0; i < len; i++) {
    b[i] -= (drift * i) / (len - 1);
    m += b[i];
  }
  m /= len;
  for (let i = 0; i < len; i++) b[i] -= m;
  if (!VQ_NOISE.has(sr)) VQ_NOISE.set(sr, { white, brown });
}

/**
 * One VQ render being built: an OfflineAudioContext of `seconds` at `sr`. Its two channels are the
 * left / right of a stereo render, or a mono render's clean mix and its saturation bus (`drive`:
 * normalised, saturated by tanh and optionally low-passed in `render`, then added). Curves are
 * control-rate arrays (VQ_CR) over the whole render; everything random comes from `rng`.
 */
export class Sketch {
  /**
   * @param {number} seconds @param {() => number} rng
   * @param {{ stereo?: boolean, sr?: number }} [o]
   */
  constructor(seconds, rng, { stereo = false, sr = VQ_SR } = {}) {
    this.len = seconds;
    this.sr = sr;
    this.rng = rng;
    this.stereo = stereo;
    /** control curve points */
    this.n = Math.ceil(seconds * VQ_CR) + 1;
    this.ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
    this.noise = VQ_NOISE.get(sr); // (made ahead: vqNoiseReady)
    const merge = this.ctx.createChannelMerger(2);
    merge.connect(this.ctx.destination);
    this.clean = this.ctx.createGain();
    this.clean.connect(merge, 0, 0);
    this.driveBus = this.ctx.createGain();
    this.driveBus.connect(merge, 0, 1);
    /** the drive bus's saturation (tanh drive; 0 none), the lowpass and the envelope after it */
    this.k = 0;
    this.postLp = 0;
    /** @type {Ctl|null} */
    this.postEnv = null;
    /** @type {'clean'|'drive'} where `out` sends by default */
    this.bus = 'clean';
    /** @type {Record<string, AudioBufferSourceNode>} one looped noise of each kind, shared by the bursts and voices */
    this._shared = {};
    /** main-thread time: building since the last yield, in all, the longest block (ms) */
    this._t0 = performance.now();
    this.busyMs = 0;
    this.maxBlockMs = 0;
    /** what is rendered (diagnostics) and what of it runs: its graph built, its result finished */
    this.label = '';
    /** @type {'build'|'finish'} */
    this.phase = 'build';
    /** @type {string[]} where its blocks of more than 6 ms are noted (the sounds' VQ_CACHE.slow; the music's its own) */
    this.slow = VQ_CACHE.slow;
  }

  /**
   * Whether a yield is due: ≈ 3 ms of main thread since the last one. A render's own code asks
   * first and awaits `pace` only then (`if (s.due()) await s.pace()`): an await that does not
   * yield still lets the promise continuations queued meanwhile run (another prime, a world's
   * build) inside the block this render's time is measured over.
   */
  due() {
    return performance.now() - this._t0 >= 3;
  }

  /**
   * Yield to the page after ≈ 3 ms of graph building (a render is built while the game plays;
   * nothing sounds until `render`) or finishing: a turn of its own (`nextTurn`). Awaited between a
   * recipe's voices and bursts (when `due`); a block over 6 ms is noted with what it was.
   */
  async pace() {
    const dt = performance.now() - this._t0;
    if (dt < 3) return;
    this.busyMs += dt;
    this.maxBlockMs = Math.max(this.maxBlockMs, dt);
    if (dt > 6 && this.slow.length < 12) this.slow.push(`${this.label} ${this.phase} ${dt.toFixed(1)} ms`);
    await nextTurn();
    this._t0 = performance.now();
  }

  /** Close a stretch of main-thread time (the graph's building, the finishing) since the last yield. */
  _closeBusy(what = 'build') {
    const dt = performance.now() - this._t0;
    this.busyMs += dt;
    this.maxBlockMs = Math.max(this.maxBlockMs, dt);
    if (dt > 6 && this.slow.length < 12) this.slow.push(`${this.label} ${what} ${dt.toFixed(1)} ms`);
  }

  /** The render's shared looped noise of a kind (one source for all its bursts and voices). */
  shared(kind = 'white') {
    return (this._shared[kind] ??= this.noiseSrc(kind));
  }

  /** A seeded number in [a, b). */
  r(a = 0, b = 1) { return a + (b - a) * this.rng(); }

  /**
   * A control curve from `fn(t, i)` over the render (sampled at VQ_CR).
   * @param {(t: number, i: number) => number} fn
   * @returns {Ctl}
   */
  ctl(fn) {
    const x = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) x[i] = fn(i / VQ_CR, i);
    return x;
  }

  /**
   * A curve through [[t, v], …] (linear, or exponential with `exp`), held at both ends.
   * @returns {Ctl}
   */
  curve(pts, exp = false) {
    let k = 0;
    const x = this.ctl((t) => {
      while (k < pts.length - 1 && t >= pts[k + 1][0]) k++;
      if (t <= pts[0][0]) return pts[0][1];
      if (k >= pts.length - 1) return pts[pts.length - 1][1];
      const [t0, v0] = pts[k];
      const [t1, v1] = pts[k + 1];
      const f = (t - t0) / Math.max(1e-9, t1 - t0);
      return exp ? v0 * (v1 / v0) ** f : v0 + (v1 - v0) * f;
    });
    return Object.assign(x, { pts, exp });
  }

  /**
   * A piecewise-linear envelope [[t, v], …], 0 before the first point and after the last.
   * @returns {Ctl}
   */
  shape(pts) {
    const x = this.curve(pts);
    const t0 = pts[0][0];
    const t1 = pts[pts.length - 1][0];
    for (let i = 0; i < x.length; i++) if (i / VQ_CR < t0 || i / VQ_CR > t1) x[i] = 0;
    return Object.assign(x, { zero: true });
  }

  /**
   * Attack-decay: 0 before t0, a linear rise over `attack`, `hold`, an exponential decay τ.
   * @returns {Ctl}
   */
  env(t0, attack, tau, hold = 0) {
    const x = this.ctl((t) => (t < t0 ? 0 : t < t0 + attack ? (t - t0) / attack : t < t0 + attack + hold ? 1 : Math.exp(-(t - t0 - attack - hold) / tau)));
    return Object.assign(x, { ad: [t0, attack, tau, hold] });
  }

  /** Smooth seeded random motion in ±1 at about `rate` changes a second. */
  wobble(rate) {
    const step = VQ_CR / rate;
    let a = this.r(-1, 1);
    let b = this.r(-1, 1);
    let k = 0;
    return this.ctl(() => {
      if (k >= step) {
        k -= step;
        a = b;
        b = this.r(-1, 1);
      }
      const f = k / step;
      k++;
      return a + (b - a) * f * f * (3 - 2 * f);
    });
  }

  /** A control-rate sine at `freq` Hz (slow modulation). */
  lfo(freq, phase = 0) { return this.ctl((t) => Math.sin(2 * Math.PI * (freq * t + phase))); }

  /**
   * Set an AudioParam to a value or a curve over the render: a point curve or an envelope as
   * automation events, a computed curve as a sampled value curve.
   * @param {AudioParam} param
   * @param {number|Ctl} v
   */
  set(param, v) {
    if (typeof v === 'number') {
      param.value = v;
      return;
    }
    if (v.ad) {
      const [t0, attack, tau, hold] = v.ad;
      param.value = 0;
      this.ad(param, t0, 1, attack, tau, hold);
      return;
    }
    if (v.pts) {
      const pts = v.pts;
      let last = Math.max(0, pts[0][0]);
      param.value = v.zero ? 0 : pts[0][1];
      param.setValueAtTime(pts[0][1], last);
      for (let k = 1; k < pts.length; k++) {
        const [t, x] = pts[k];
        if (t <= last) param.setValueAtTime(x, last);
        else if (v.exp) param.exponentialRampToValueAtTime(x, t);
        else param.linearRampToValueAtTime(x, t);
        last = Math.max(last, t);
      }
      if (v.zero && pts[pts.length - 1][1] !== 0) param.setValueAtTime(0, last);
      return;
    }
    param.setValueCurveAtTime(v, 0, this.len);
  }

  /** Looped seeded noise ('white' | 'brown') from `t0` for `len` seconds. */
  noiseSrc(kind = 'white', t0 = 0, len = this.len - t0) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise[kind];
    s.loop = true;
    s.start(t0, this.rng() * 5.5);
    s.stop(Math.min(this.len, t0 + len));
    return s;
  }

  /** An oscillator ('sine' | 'triangle' | 'sawtooth' | 'square') at `freq` (Hz or a curve). */
  osc(type, freq, t0 = 0, len = this.len - t0, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    this.set(o.frequency, freq);
    if (detune) o.detune.value = detune;
    o.start(t0);
    o.stop(Math.min(this.len, t0 + len));
    return o;
  }

  /** A biquad over `input` ('lowpass' | 'highpass' | 'bandpass' | 'peaking'); freq may be a curve. */
  filter(input, type, freq, q = 0.707, gainDb = 0) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    this.set(f.frequency, freq);
    f.Q.value = q;
    if (gainDb) f.gain.value = gainDb;
    input.connect(f);
    return f;
  }

  /** `input` × g — a number, a curve, or an audio-rate node added to `base`. */
  amp(input, g, base = 0) {
    const n = this.ctx.createGain();
    if (g instanceof AudioNode) {
      n.gain.value = base;
      g.connect(n.gain);
    } else this.set(n.gain, g);
    input.connect(n);
    return n;
  }

  /** The sum of [node, gain] pairs. */
  sum(list) {
    const g = this.ctx.createGain();
    for (const [node, k] of list) (k === 1 ? node : this.amp(node, k)).connect(g);
    return g;
  }

  /** A formant bank: the sum of bandpasses [[f (Hz or a curve), q, gain], …] over `input`. */
  formants(input, list) { return this.sum(list.map(([f, q, g]) => [this.filter(input, 'bandpass', f, q), g])); }

  /** The three formant curves of a vowel line [[t, 'a'], …] scaled by `scale` (a woman 1.17, a child 1.3). */
  vowels(pts, scale = 1) { return [0, 1, 2].map((k) => this.curve(pts.map(([t, v]) => [t, VOWELS[v][k] * scale]))); }

  /** max(0, x): a rectifier for amplitude modulation. */
  rectify(input) {
    const w = this.ctx.createWaveShaper();
    const c = new Float32Array(257);
    for (let i = 0; i < c.length; i++) c[i] = Math.max(0, i / 128 - 1);
    w.curve = c;
    input.connect(w);
    return w;
  }

  /**
   * A voice source: a saw at the pitch curve `f0` with jitter (random pitch motion at `rate` Hz)
   * and breath noise, softened above ≈ 4 kHz; from `t0` for `len` seconds; `fm` [Hz, cents] an
   * audio-rate vibrato (a rasp).
   * @param {Ctl} f0
   * @param {{ jitter?: number, rate?: number, breath?: number, t0?: number, len?: number, fm?: number[]|null }} [o]
   */
  voice(f0, { jitter = 0.02, rate = 30, breath = 0.1, t0 = 0, len = this.len - t0, fm = null } = {}) {
    const w = this.wobble(rate);
    const o = this.osc('sawtooth', this.ctl((t, i) => f0[i] * (1 + jitter * w[i])), t0, len);
    if (fm) this.amp(this.osc('sine', fm[0], t0, len), fm[1]).connect(o.detune);
    const sum = this.ctx.createGain();
    o.connect(sum);
    if (breath > 0) this.amp(this.filter(this.shared('white'), 'highpass', 900, 0.7), breath).connect(sum);
    return this.filter(sum, 'lowpass', 4200, 0.6);
  }

  /** Send a node to the output: the clean or the drive bus (mono), or a pan (stereo). */
  route(node, pan = 0, bus = this.bus) {
    if (this.stereo) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p).connect(this.ctx.destination);
    } else node.connect(bus === 'drive' ? this.driveBus : this.clean);
  }

  /** `route` at a gain. */
  out(node, gain = 1, pan = 0, bus = this.bus) { this.route(gain === 1 ? node : this.amp(node, gain), pan, bus); }

  /**
   * Saturate what is sent to the drive bus (tanh at drive `k`), then low-pass it (`lp` Hz, 0 none)
   * and shape it by `env` (so the saturation does not flatten the sound's swell and decay).
   * @param {number} k @param {number} [lp] @param {Ctl|null} [env]
   */
  saturate(k, lp = 0, env = null) {
    this.k = k;
    this.postLp = lp;
    this.postEnv = env;
  }

  /** From now on `out` sends to the drive bus: the whole sound saturated. */
  driveAll(k, lp = 0) {
    this.saturate(k, lp);
    this.bus = 'drive';
  }

  /** Attack-decay automation on a param: 0 → `peak` over `attack`, `hold`, decay τ. */
  ad(param, t0, peak, attack, tau, hold = 0) {
    param.setValueAtTime(0, t0);
    param.linearRampToValueAtTime(peak, t0 + attack);
    param.setTargetAtTime(0, t0 + attack + hold, tau);
  }

  /**
   * A noise burst at `t`: white (or brown) noise for `len` s through a filter whose frequency may
   * move over [[dt, Hz], …] (from `t`, exponentially), a linear attack, `hold` and a decay τ.
   * @param {number} t @param {number} len
   * @param {{ src?: 'white'|'brown', type?: BiquadFilterType, f?: number|number[][], q?: number, attack?: number,
   *   tau?: number, hold?: number, amp?: number, pan?: number, bus?: 'clean'|'drive' }} [o]
   */
  burst(t, len, { src = 'white', type = 'bandpass', f = 1000, q = 0.8, attack = 0.001, tau = 0.02, hold = 0, amp = 1, pan = 0, bus = this.bus } = {}) {
    if (t >= this.len) return;
    const fl = this.ctx.createBiquadFilter();
    fl.type = type;
    fl.Q.value = q;
    if (typeof f === 'number') fl.frequency.value = f;
    else {
      fl.frequency.setValueAtTime(f[0][1], t);
      for (let k = 1; k < f.length; k++) fl.frequency.exponentialRampToValueAtTime(f[k][1], t + f[k][0]);
    }
    const g = this.ctx.createGain();
    g.gain.value = 0;
    this.ad(g.gain, t, amp, attack, tau, hold);
    this.shared(src).connect(fl).connect(g);
    this.route(g, pan, bus);
  }

  /** Decaying sine partials [[Hz, amplitude, τ], …] struck at `t` (a 1 ms attack). */
  modes(t, list, amp = 1, pan = 0, bus = this.bus) {
    if (t >= this.len) return;
    for (const [f, a, tau] of list) {
      const o = this.osc('sine', f, t, tau * 7 + 0.01);
      const g = this.ctx.createGain();
      g.gain.value = 0;
      this.ad(g.gain, t, a * amp, 0.001, tau);
      o.connect(g);
      this.route(g, pan, bus);
    }
  }

  /** A pitch-dropping sine thump: f0 → f1 (exponential) over `sweep`, a 2 ms attack, decay τ. */
  thump(t, f0, f1, sweep, tau, amp, pan = 0, bus = this.bus) {
    if (t >= this.len) return;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
    o.start(t);
    o.stop(Math.min(this.len, t + tau * 7 + 0.01));
    const g = this.ctx.createGain();
    g.gain.value = 0;
    this.ad(g.gain, t, amp, 0.002, tau);
    o.connect(g);
    this.route(g, pan, bus);
  }

  /** `count` tiny bursts between t0 and t1 (`bias` < 1 earlier, > 1 later), fading over the span. */
  async scatter(t0, t1, count, { f = [1500, 4500], q = 1.4, len = [0.003, 0.012], amp = [0.05, 0.2], fade = true, bias = 1, type = 'bandpass', stereo = 0 } = {}) {
    for (let k = 0; k < count; k++) {
      if (this.due()) await this.pace();
      const u = this.rng() ** bias;
      const d = this.r(len[0], len[1]);
      this.burst(t0 + (t1 - t0) * u, d * 7 + 0.004, {
        type: /** @type {BiquadFilterType} */ (type), f: this.r(f[0], f[1]), q, attack: 0.0005, tau: d,
        amp: this.r(amp[0], amp[1]) * (fade ? 1 - 0.8 * u : 1), pan: this.r(-stereo, stereo),
      });
    }
  }

  /**
   * Render and finish: the drive bus normalised, saturated and low-passed into the clean mix (a
   * mono render), DC blocked, a 2 ms fade-in, the end faded out (a raised cosine over 12 % of the
   * render, 60–350 ms: a tail that rings on is not cut; `fade` 0: none), normalised to `peak`.
   * The music's renders (`renderMusic`) add two options: `gain` — the instrument's one shared scale
   * instead of the normalisation, so its pitches, round-robins and rolls keep their level relation —
   * and `lowpass` — an anti-imaging lowpass (Hz; 4th-order Butterworth, before the DC blocker)
   * against the images a low-rate buffer makes when it is played at the context's rate. Without
   * them (the sounds and voices) the finish is as it always was.
   * @param {number} [peak]
   * @param {number} [fade]
   * @param {{ gain?: number, lowpass?: number }} [opts]
   * @returns {Promise<Float32Array[]>} the channels (one, or two for a stereo render)
   */
  async render(peak = 0.9, fade = Math.max(0.06, Math.min(0.35, this.len * 0.12)), { gain = 0, lowpass = 0 } = {}) {
    this._closeBusy();
    const buf = await this.ctx.startRendering();
    this._t0 = performance.now();
    this.phase = 'finish';
    const sr = this.sr;
    // (every pass in slices of 8192 samples, yielding to the page after ≈ 3 ms of them)
    const each = async (n, fn) => {
      for (let a = 0; a < n; a += 8192) {
        fn(a, Math.min(n, a + 8192));
        if (this.due()) await this.pace();
      }
    };
    /** @type {Float32Array[]} */
    let chans;
    if (this.stereo) chans = [buf.getChannelData(0), buf.getChannelData(1)];
    else {
      const c = buf.getChannelData(0);
      const d = buf.getChannelData(1);
      if (this.k > 0) {
        let p = 0;
        await each(d.length, (a, b) => { for (let i = a; i < b; i++) p = Math.max(p, Math.abs(d[i])); });
        const s = p > 0 ? 1 / p : 1;
        const k = this.k;
        const norm = 1 / Math.tanh(k);
        await each(d.length, (a, b) => { for (let i = a; i < b; i++) d[i] = Math.tanh(k * d[i] * s) * norm; });
        if (this.postLp > 0) {
          const co = [0, 0, 0, 0, 0];
          rbjInto(co, 'lowpass', this.postLp, 0.7, 0, sr);
          let x1 = 0;
          let x2 = 0;
          let y1 = 0;
          let y2 = 0;
          await each(d.length, (a, b) => {
            for (let i = a; i < b; i++) {
              const x0 = d[i];
              const y0 = co[0] * x0 + co[1] * x1 + co[2] * x2 - co[3] * y1 - co[4] * y2;
              x2 = x1;
              x1 = x0;
              y2 = y1;
              y1 = y0;
              d[i] = y0;
            }
          });
        }
        const pe = this.postEnv;
        if (pe) {
          const last = pe.length - 1;
          await each(d.length, (a, b) => {
            for (let i = a; i < b; i++) {
              const u = (i / sr) * VQ_CR;
              const j = Math.min(last, Math.floor(u));
              d[i] *= pe[j] + (pe[Math.min(last, j + 1)] - pe[j]) * (u - j);
            }
          });
        }
      }
      await each(c.length, (a, b) => { for (let i = a; i < b; i++) c[i] += d[i]; });
      chans = [c];
    }
    if (lowpass > 0) {
      // (two cascaded RBJ lowpasses with the Butterworth Qs of a 4th-order filter)
      for (const x of chans) {
        for (const q of [0.5412, 1.3066]) {
          const co = [0, 0, 0, 0, 0];
          rbjInto(co, 'lowpass', lowpass, q, 0, sr);
          let x1 = 0;
          let x2 = 0;
          let y1 = 0;
          let y2 = 0;
          await each(x.length, (a, b) => {
            for (let i = a; i < b; i++) {
              const x0 = x[i];
              const y0 = co[0] * x0 + co[1] * x1 + co[2] * x2 - co[3] * y1 - co[4] * y2;
              x2 = x1;
              x1 = x0;
              y2 = y1;
              y1 = y0;
              x[i] = y0;
            }
          });
        }
      }
    }
    let p = 0;
    const kdc = Math.exp((-2 * Math.PI * 20) / sr);
    for (const x of chans) {
      let x1 = 0;
      let y = 0;
      await each(x.length, (a, b) => {
        for (let i = a; i < b; i++) {
          y = kdc * (y + x[i] - x1);
          x1 = x[i];
          x[i] = y;
        }
      });
      const fi = Math.min(x.length, Math.round(0.002 * sr));
      for (let i = 0; i < fi; i++) x[i] *= i / fi;
      const fo = Math.min(x.length, Math.round(fade * sr));
      for (let i = 0; i < fo; i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
      if (!(gain > 0)) await each(x.length, (a, b) => { for (let i = a; i < b; i++) p = Math.max(p, Math.abs(x[i])); });
    }
    const s = gain > 0 ? gain : p > 0 ? peak / p : 1;
    for (const x of chans) await each(x.length, (a, b) => { for (let i = a; i < b; i++) x[i] *= s; });
    this._closeBusy('finish');
    return chans;
  }
}

/** RBJ biquad coefficients [b0, b1, b2, a1, a2] (a0-normalised) into `c` (the drive bus's lowpass). */
export function rbjInto(c, type, f, q, gainDb, sr) {
  const w = (2 * Math.PI * Math.min(Math.max(f, 10), sr * 0.45)) / sr;
  const cw = Math.cos(w);
  const al = Math.sin(w) / (2 * Math.max(0.05, q));
  const a0 = 1 + al;
  c[0] = (1 - cw) / 2 / a0;
  c[1] = (1 - cw) / a0;
  c[2] = c[0];
  c[3] = (-2 * cw) / a0;
  c[4] = (1 - al) / a0;
}

/**
 * A rendered VQ sound or voice: `len` seconds, `variants` renders (one is picked per play), `gain`
 * the play level at volume 1, `wet` into the reverb, `rate` a base playback rate, `stereo` a
 * stereo render, `sr` its rate (VQ_SR), `deps` the sounds its render plays (rendered first; `dep`
 * hands their first variant's buffer), `post` a last touch to the finished channels;
 * `render(s, v, dep)` builds variant `v` in the Sketch `s` (async: it awaits `s.pace()` between
 * its parts, so a big graph is built in short blocks). Seeded by the name and the variant.
 * @typedef {{ len: number, gain: number, wet?: boolean, rate?: number, variants?: number, stereo?: boolean,
 *   sr?: number, deps?: string[], post?: (chans: Float32Array[], sr: number) => Float32Array[],
 *   render: (s: Sketch, v: number, dep: (name: string) => AudioBuffer) => void|Promise<void> }} VqSound
 */

/** A seed from a name (FNV-1a), for the VQ renders. */
export function hashName(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The VQ renders, shared by every AudioSystem (an AudioBuffer belongs to no context): per name and
 * variant the buffer once made and the promise of it; renders run one after another (`chain`).
 */
export const VQ_CACHE = {
  /** @type {Map<string, { buffers: (AudioBuffer|null)[], pending: (Promise<AudioBuffer>|null)[] }>} */
  entries: new Map(),
  /** @type {Promise<unknown>} */
  chain: Promise.resolve(),
  /** sample bytes rendered */
  bytes: 0,
  /** milliseconds spent on the main thread building graphs and finishing renders, and its longest block */
  mainMs: 0,
  maxBlockMs: 0,
  /** @type {string[]} the blocks of more than 6 ms (diagnostics, the first 12) */
  slow: [],
};

/**
 * The render entry of a sound or voice (`variants` slots), made on first use.
 * @param {string} name
 * @param {number} variants
 */
export function cacheEntry(name, variants) {
  let e = VQ_CACHE.entries.get(name);
  if (!e) {
    e = { buffers: new Array(variants).fill(null), pending: new Array(variants).fill(null) };
    VQ_CACHE.entries.set(name, e);
  }
  return e;
}

/**
 * Variant `v` of a rendered sound or voice as an AudioBuffer: rendered once (its `deps` first),
 * queued behind the renders already asked for (`VQ_CACHE.chain`). `defOf` resolves a name to its
 * recipe (VanquishAudio.js: its sounds and voices). Seeded by the name and the variant.
 * @param {string} name
 * @param {number} v
 * @param {(name: string) => VqSound} defOf
 * @returns {Promise<AudioBuffer>}
 */
export function loadRender(name, v, defOf) {
  const def = defOf(name);
  const e = cacheEntry(name, def.variants ?? 1);
  if (e.pending[v]) return e.pending[v];
  const deps = Promise.all((def.deps ?? []).map((d) => loadRender(d, 0, defOf)));
  const job = async () => {
    await deps;
    await vqNoiseReady(def.sr ?? VQ_SR);
    const t0 = performance.now();
    const s = new Sketch(def.len, mulberry32((hashName(name) + Math.imul(v, 0x9e3779b9)) >>> 0), { stereo: !!def.stereo, sr: def.sr ?? VQ_SR });
    s._t0 = t0;
    s.label = `${name}#${v}`;
    await def.render(s, v, (dep) => cacheEntry(dep, defOf(dep).variants ?? 1).buffers[0]);
    let chans = await s.render();
    const t1 = performance.now();
    if (def.post) chans = def.post(chans, s.sr);
    const b = new AudioBuffer({ numberOfChannels: chans.length, length: chans[0].length, sampleRate: s.sr });
    chans.forEach((c, k) => b.getChannelData(k).set(c));
    const dt = performance.now() - t1;
    VQ_CACHE.mainMs += s.busyMs + dt;
    VQ_CACHE.maxBlockMs = Math.max(VQ_CACHE.maxBlockMs, s.maxBlockMs, dt);
    if (dt > 6 && VQ_CACHE.slow.length < 12) VQ_CACHE.slow.push(`${s.label} buffer ${dt.toFixed(1)} ms`);
    VQ_CACHE.bytes += chans.length * chans[0].length * 4;
    e.buffers[v] = b;
    return b;
  };
  const p = VQ_CACHE.chain.then(job, job);
  VQ_CACHE.chain = p.catch((err) => console.error(`[AudioSystem] could not render "${name}"`, err));
  e.pending[v] = p;
  return p;
}

// ---------------------------------------------------------------------------------------------
// The music's renders (MusicRenders.js: its own lane and cache, beside the sounds' queue above)
// ---------------------------------------------------------------------------------------------

/**
 * One rendered buffer of the score's instruments (MusicRenders.js): `len` seconds at `sr` (mono, or
 * `stereo`), seeded by `seed` (`hashName` of its key). Either `build(s)` draws it into a Sketch (an
 * OfflineAudioContext, finished with the instrument's shared `gain` instead of a normalisation, the
 * `lowpass` against images, the end faded over `fade` s — 0: none, a loop's body) or `synth`
 * computes it in JS (the lute's Karplus–Strong: one block of a few ms; between parts it calls
 * `pace` and awaits what that returns — a turn when one is due, else null: it goes on at once —;
 * its `lowpass` applied after it the same way).
 * `post` touches the finished channels last and may return the loop it made (`{ chans, loop: [start,
 * end] }` in seconds: the cymbal's swell body, crossfaded into itself).
 * @typedef {{ name: string, len: number, seed: number, sr?: number, stereo?: boolean, gain: number, fade?: number,
 *   lowpass?: number, build?: (s: Sketch) => void|Promise<void>,
 *   synth?: (rng: () => number, sr: number, pace: () => Promise<void>|null) => Float32Array[]|Promise<Float32Array[]>,
 *   post?: (chans: Float32Array[], sr: number) => Float32Array[]|{ chans: Float32Array[], loop: [number, number] } }} MusicJob
 */
/**
 * A rendered music buffer and what it cost the main thread (ms: in all, the longest block between
 * two yields) — `loop` the loop region (s) a `post` made.
 * @typedef {{ buffer: AudioBuffer, bytes: number, mainMs: number, maxBlockMs: number, loop: [number, number]|null }} MusicRender
 */

/**
 * Render one music buffer now (the caller runs one at a time per lane): the noise loops of its rate
 * first, then the graph built and rendered off the main thread (or the JS synth in short blocks),
 * finished, copied into an AudioBuffer (one that belongs to no context).
 * @param {MusicJob} job
 * @param {string[]} [slow] where blocks of more than 6 ms are noted (the music's own list)
 * @returns {Promise<MusicRender>}
 */
export async function renderMusic(job, slow = []) {
  const sr = job.sr ?? VQ_SR;
  const rng = mulberry32(job.seed >>> 0);
  /** @type {Float32Array[]} */
  let chans;
  let mainMs = 0;
  let maxBlockMs = 0;
  if (job.synth) {
    let t0 = performance.now();
    // (a turn only when one is due: else null, and the synth goes on without an await)
    const pace = () => {
      const dt = performance.now() - t0;
      if (dt < 3) return null;
      mainMs += dt;
      maxBlockMs = Math.max(maxBlockMs, dt);
      return nextTurn().then(() => {
        t0 = performance.now();
      });
    };
    chans = await job.synth(rng, sr, pace);
    // (the anti-imaging lowpass of a render, as Sketch.render's: two cascaded RBJ lowpasses)
    if (job.lowpass > 0) {
      for (const x of chans) {
        for (const q of [0.5412, 1.3066]) {
          const co = [0, 0, 0, 0, 0];
          rbjInto(co, 'lowpass', job.lowpass, q, 0, sr);
          let x1 = 0;
          let x2 = 0;
          let y1 = 0;
          let y2 = 0;
          for (let i = 0; i < x.length; i++) {
            const x0 = x[i];
            const y0 = co[0] * x0 + co[1] * x1 + co[2] * x2 - co[3] * y1 - co[4] * y2;
            x2 = x1;
            x1 = x0;
            y2 = y1;
            y1 = y0;
            x[i] = y0;
          }
          const turn = pace();
          if (turn) await turn;
        }
      }
    }
    const dt = performance.now() - t0;
    mainMs += dt;
    maxBlockMs = Math.max(maxBlockMs, dt);
  } else {
    await vqNoiseReady(sr);
    const s = new Sketch(job.len, rng, { stereo: !!job.stereo, sr });
    s.label = job.name;
    s.slow = slow;
    await job.build(s);
    chans = await s.render(0.9, job.fade ?? Math.max(0.06, Math.min(0.35, job.len * 0.12)), { gain: job.gain, lowpass: job.lowpass ?? 0 });
    mainMs += s.busyMs;
    maxBlockMs = Math.max(maxBlockMs, s.maxBlockMs);
  }
  const t1 = performance.now();
  /** @type {[number, number]|null} */
  let loop = null;
  if (job.post) {
    const r = job.post(chans, sr);
    if (Array.isArray(r)) chans = r;
    else {
      chans = r.chans;
      loop = r.loop;
    }
  }
  const buffer = new AudioBuffer({ numberOfChannels: chans.length, length: chans[0].length, sampleRate: sr });
  chans.forEach((c, k) => buffer.getChannelData(k).set(c));
  const dt = performance.now() - t1;
  if (job.synth && maxBlockMs > 6 && slow.length < 12) slow.push(`${job.name} synth ${maxBlockMs.toFixed(1)} ms`);
  if (dt > 6 && slow.length < 12) slow.push(`${job.name} buffer ${dt.toFixed(1)} ms`);
  return { buffer, bytes: chans.length * chans[0].length * 4, mainMs: mainMs + dt, maxBlockMs: Math.max(maxBlockMs, dt), loop };
}
