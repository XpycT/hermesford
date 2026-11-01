/**
 * Sounds — The Bells of Evermere's 36 sound effects (`EV_SFX_NAMES`, docs/contracts/
 * EVERMERE_CAMPAIGN.md §5.7) and the voices of its ambience (the gulls, the crows, the ice's creaks
 * and pings, the thaw's drips, the surf's loop): seeded recipes drawn into a RenderKit.js Sketch —
 * an OfflineAudioContext, off the main thread — and rendered once into shared buffers
 * (EvermereAudio.js `playSfx`, `primeSfx`), like Vanquish's (VanquishAudio.js `VQ_SOUNDS`).
 *
 * A recipe: `{ len, gain, wet?, sr?, variants?, rate?, stereo?, deps?, gap?, tuned?, render(s, v, dep), post? }`
 * — the render normalised to a peak of 0.9 and played at `gain` × the caller's volume (the level
 * QA sets: sandbox/ev_audio.js's role windows), `gap` the shortest re-trigger (s; AudioSystem's own
 * is 0.02 for these names), `tuned` a sound on the motif's pitches (the bells, the fork, the
 * motif): played at the caller's pitch exactly — the others take ± 1 % of seeded pitch.
 *
 * The bells are the campaign's own (evermere/Bells.js): the Season Bells' toll (`bellToll`, D3, the
 * major tierce — the other Season Bells play it at their pitch: `BELL_PITCH`), the Hush Bell's
 * (`bellTollBlack`, D3 minor: the same bronze), its three far strokes over Rimeholt (`hushToll`),
 * the wayside chime (A5: the motif's first note; the three chimes at `CHIME_PITCH`), the bellwarden's
 * skills on the motif's notes (`peal`, `tollBell`, `carillon`), Tin's fork on Rest's note (D5), the
 * memory's three notes, the forge's motif (`motif`), a Season Bell far off (`bellTollFar`). Nothing here is a `toll@` key of Vanquish's: its renders are untouched.
 *
 * Pure: imports Bells.js and ScoreKit.js (`mtof`) only. Imported only through EvermereAudio.js.
 */
import { mtof } from '../vanquish/ScoreKit.js';
import { celesta, greatBell, handbell, tubularBell, SR_BELL } from './Bells.js';

/** @import { VqSound } from '../vanquish/RenderKit.js' */

/**
 * The playback-rate ratio a Season Bell's toll is played at (`bellToll`'s D3 strike): each bell on
 * its note of the motif in D — Waking A3, Tides F♯3, Harvest B3, Rest D3; the town belfry's D3. A
 * smaller bell is higher and rings shorter, as it should. For the `toll` command (the thaw package)
 * and the story's `sfx` (one pitch: Rest's).
 */
export const BELL_PITCH = Object.freeze({ shrine: 2 ** (7 / 12), lighthouse: 2 ** (4 / 12), abbey: 2 ** (9 / 12), citadel: 1, town: 1, hush: 1 });
/** The wayside chimes' ratios in the motif's order (`waysideChime` rings A5): A, F♯, B. */
export const CHIME_PITCH = Object.freeze([1, 2 ** (-3 / 12), 2 ** (2 / 12)]);

/** The motif's notes in D (A F♯ B · D) as MIDI around the fourth octave. */
const A4 = 69;
const FS4 = 66;
const B4 = 71;
const D4 = 62;

/** A short pitch-dropping sine (a body's thump) into the output. */
const thud = (s, t, f0, f1, tau, amp) => s.thump(t, f0, f1, Math.min(0.12, tau), tau, amp);

/**
 * A voice through formants: `f0` points (exponential), vowel points, `scale` the formants' shift,
 * `amp` points; jitter and a rasp (`fm`).
 */
function voiced(s, f0, vowels, ampPts, { scale = 1, jitter = 0.04, rate = 30, breath = 0.15, fm = null, q = [6, 8, 10], gain = 1 } = {}) {
  const F = s.vowels(vowels, scale);
  const v = s.formants(s.voice(s.curve(f0, true), { jitter, rate, breath, fm }), [[F[0], q[0], 1], [F[1], q[1], 0.6], [F[2], q[2], 0.3]]);
  s.out(s.amp(v, s.shape(ampPts)), gain);
}

/**
 * The ice's song: a dispersive chirp — a sheet of ice under strain rings from high to low (≈ 3.4 kHz
 * → 500 Hz in a quarter of a second), with a faint twin.
 */
function icePing(s, t, k = 1, amp = 1) {
  for (const [f0, f1, d, a] of [[3400 * k, 520 * k, 0.24, 1], [2600 * k, 430 * k, 0.3, 0.45]]) {
    const o = s.osc('sine', s.curve([[t, f0], [t + d, f1]], true), t, d + 0.25);
    s.out(s.amp(o, s.shape([[t, 0], [t + 0.002, 1], [t + d * 0.5, 0.5], [t + d + 0.2, 0]])), 0.32 * a * amp);
  }
}

/** A crack: a sharp highpassed snap and a body. */
function crack(s, t, amp = 1, f = 1800) {
  s.burst(t, 0.06, { type: 'highpass', f, q: 0.7, attack: 0.0004, tau: 0.006, amp: 0.9 * amp });
  s.burst(t + 0.003, 0.12, { type: 'bandpass', f: f * 0.55, q: 1.1, attack: 0.001, tau: 0.02, amp: 0.4 * amp });
}

/**
 * The sounds (`EV_SFX_NAMES`).
 * @type {Record<string, VqSound & { gap?: number, tuned?: boolean }>}
 */
export const EV_SOUNDS = {
  // ---- the bells -------------------------------------------------------------------------------
  // a Season Bell tolls (D3, the major tierce): the clapper, the hum ringing ≈ 20 s, the swing
  bellToll: {
    len: 20, gain: 0.4, wet: true, sr: SR_BELL, gap: 0.6, tuned: true,
    async render(s) {
      await greatBell(s, 0.002, mtof(50), { decay: 15, swing: true });
    },
  },
  // the Hush Bell tolls (D3, the minor tierce): darker, its crack rattling
  bellTollBlack: {
    len: 20, gain: 0.45, wet: true, sr: SR_BELL, gap: 0.6, tuned: true,
    async render(s) {
      await greatBell(s, 0.002, mtof(50), { minor: true, decay: 15, swing: true });
    },
  },
  // the Hush Bell's three beats over Rimeholt (the hazard's toll, played once a toll): far off —
  // low-passed — three strokes 0.9 s apart, ringing ≈ 8 s
  hushToll: {
    len: 10, gain: 0.46, wet: true, sr: SR_BELL, gap: 1, tuned: true,
    async render(s) {
      const far = s.ctx.createGain();
      s.route(s.filter(s.filter(far, 'lowpass', 1400, 0.7), 'highpass', 55, 0.7));
      for (const [t, l] of [[0.002, 1], [0.9, 0.86], [1.8, 0.94]]) await greatBell(s, t, mtof(50), { minor: true, decay: 5, level: l, out: far });
    },
  },
  // a wayside chime: a small bell on a post, struck, swinging back for a softer second ring (A5)
  waysideChime: {
    len: 4.6, gain: 0.12, wet: true, gap: 0.25, tuned: true,
    async render(s) {
      await handbell(s, 0.002, mtof(81));
      await handbell(s, 0.42, mtof(81), 0.35);
    },
  },
  // the bellwarden's Peal: three bells struck in a breath (the motif's notes, high) and the sound
  // thrown forward (a rising rush)
  peal: {
    len: 2, gain: 0.146, wet: true, gap: 0.2, tuned: true,
    async render(s) {
      for (const [t, m] of [[0.002, A4 + 12], [0.03, FS4 + 12], [0.06, B4 + 12]]) await handbell(s, t, mtof(m), 0.8);
      s.burst(0, 1.1, { f: [[0, 600], [0.35, 3000], [0.9, 1400]], q: 1.4, attack: 0.05, tau: 0.25, amp: 0.55 });
      thud(s, 0, 140, 80, 0.06, 0.3);
    },
  },
  // the spectral bell's toll (every 1.5 s while it stands): a mid bell (D4), a ghost's shimmer
  tollBell: {
    len: 2.6, gain: 0.24, wet: true, sr: SR_BELL, gap: 0.3, tuned: true,
    async render(s) {
      await greatBell(s, 0.002, mtof(62), { decay: 1.8 });
      await tubularBell(s, 0.01, mtof(74), 0.25);
    },
  },
  // Carillon: four bells 12 frames apart on the motif's four notes (A F♯ B D), then — at 0.8 s —
  // the last chord: the four together, a boom, a bright shimmer
  carillon: {
    len: 3.6, gain: 0.4, wet: true, sr: SR_BELL, gap: 1, tuned: true,
    async render(s) {
      const notes = [A4, FS4, B4, D4];
      for (let k = 0; k < 4; k++) await greatBell(s, 0.002 + k * 0.2, mtof(notes[k]), { decay: 1.6, level: 0.75 });
      for (const m of notes) await greatBell(s, 0.8, mtof(m + 12), { decay: 2.2, level: 0.45 });
      thud(s, 0.8, 110, 45, 0.3, 0.8);
      s.burst(0.8, 1.6, { f: [[0, 2500], [1.2, 5500]], q: 0.9, attack: 0.02, tau: 0.35, amp: 0.25 });
    },
  },
  // Tin's tuning fork struck on its gauntlet: Rest's note, D5, pure — a clang at the strike
  tuningFork: {
    len: 4.6, gain: 0.1, wet: true, gap: 0.5, tuned: true,
    async render(s) {
      const f = mtof(74);
      s.modes(0.002, [[f * 0.9998, 0.55, 1.45], [f * 1.0003, 0.45, 1.35]]);
      s.modes(0.002, [[f * 6.25, 0.18, 0.05], [f * 2, 0.02, 0.4]]);
      s.burst(0.002, 0.04, { type: 'bandpass', f: 3800, q: 1.4, attack: 0.0004, tau: 0.003, amp: 0.3 });
    },
  },
  // a memory: the motif's three notes on the celesta (A5 F♯5 B5), a halo of air — and no fourth
  memoryChime: {
    len: 4.4, gain: 0.14, wet: true, gap: 1, tuned: true,
    async render(s) {
      for (const [t, m] of [[0.002, A4 + 12], [0.55, FS4 + 12], [1.1, B4 + 12]]) await celesta(s, t, mtof(m), 0.9);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', 6200, 2.5), s.shape([[0, 0], [0.8, 0.05], [2.4, 0.03], [4.2, 0]])), 1);
    },
  },
  // the forge's opening — one hammer strike on a bell blank (`hammerHit`), and the motif rings once:
  // three handbells on its first notes (A5 F♯5 B5), a celesta's ghost an octave above each — and no
  // fourth (Rest's D, the line Linnet cannot remember: the last note rings on, unanswered)
  motif: {
    len: 5.6, gain: 0.14, wet: true, gap: 1, tuned: true,
    async render(s) {
      for (const [t, m, l] of [[0.002, A4 + 12, 0.85], [0.5, FS4 + 12, 0.8], [1, B4 + 12, 0.95]]) {
        await handbell(s, t, mtof(m), l);
        await celesta(s, t + 0.004, mtof(m + 12), 0.16);
      }
    },
  },
  // a Season Bell tolling far off (the Frost Gate's three tolls, from the west, the south, the east):
  // D3, the clapper lost in the distance — low-passed at 1.1 kHz — and softer; call it at the bell's
  // pitch (`BELL_PITCH`) and its side (`pan`)
  bellTollFar: {
    len: 12, gain: 0.2, wet: true, sr: SR_BELL, gap: 0.2, tuned: true,
    async render(s) {
      const far = s.ctx.createGain();
      s.route(s.filter(s.filter(far, 'lowpass', 1100, 0.7), 'highpass', 60, 0.7));
      await greatBell(s, 0.002, mtof(50), { decay: 8, out: far });
    },
  },
  // the resonance mark consumed: a tiny bright ding and a pop
  markPop: {
    len: 0.4, gain: 0.16, variants: 2, gap: 0.03,
    async render(s, v) {
      const k = v ? 1.12 : 1;
      s.modes(0.002, [[2640 * k, 0.5, 0.06], [6500 * k, 0.15, 0.02], [1320 * k, 0.12, 0.05]]);
      thud(s, 0, 320, 180, 0.03, 0.4);
    },
  },

  // ---- the hammer ------------------------------------------------------------------------------
  // the bell-founder's hammer striking: a thump, the bronze head's ring, a tick of frost
  hammerHit: {
    len: 0.9, gain: 0.54, variants: 3, gap: 0.03,
    async render(s, v) {
      const k = [1, 0.93, 1.07][v];
      thud(s, 0, 170 * k, 60, 0.08, 1);
      s.burst(0, 0.08, { type: 'bandpass', f: 1500 * k, q: 0.9, attack: 0.0006, tau: 0.012, amp: 0.55 });
      s.modes(0.003, [[410 * k, 0.22, 0.12], [1130 * k, 0.16, 0.08], [2210 * k, 0.1, 0.05], [3480 * k, 0.05, 0.03]]);
    },
  },
  // a heavy slam: a big thud, the anvil-deep ring of the head, a crack of ice, debris
  hammerSlam: {
    len: 1.8, gain: 0.42, wet: true, gap: 0.08,
    async render(s) {
      s.driveAll(1.3);
      thud(s, 0, 120, 50, 0.3, 1);
      s.burst(0, 0.12, { type: 'lowpass', f: 2200, q: 0.7, attack: 0.0008, tau: 0.03, amp: 0.8 });
      s.modes(0.003, [[220, 0.25, 0.35], [590, 0.2, 0.24], [1150, 0.12, 0.16], [1960, 0.07, 0.1]]);
      crack(s, 0.01, 0.5, 2200);
      await s.scatter(0.05, 1, 16, { f: [1500, 4500], len: [0.003, 0.01], amp: [0.03, 0.12], bias: 1.6 });
    },
  },

  // ---- the thaw --------------------------------------------------------------------------------
  // the thaw starting: a sub-bass swell (from ≈ 0.25 s), a glassy shimmer rising, the air opening,
  // the first tinkles of melting ice
  thawSweep: {
    len: 5.2, gain: 0.37, wet: true, gap: 2,
    async render(s) {
      const sw = s.shape([[0.25, 0], [1.5, 1], [3.2, 0.7], [5, 0]]);
      s.out(s.amp(s.osc('sine', s.curve([[0.25, 46], [2.5, 55], [5, 50]], true)), sw), 0.9);
      s.out(s.amp(s.osc('sine', s.curve([[0.25, 92], [2.5, 110], [5, 100]], true)), sw), 0.35);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', s.curve([[0, 700], [2.6, 4800], [5, 3000]], true), 1.6), s.shape([[0, 0], [1.2, 0.3], [2.6, 0.5], [5, 0]])), 0.5);
      s.out(s.amp(s.filter(s.noiseSrc('brown'), 'lowpass', s.curve([[0, 300], [2, 1600], [5, 600]], true), 0.7), s.shape([[0, 0], [0.8, 0.5], [2.4, 0.6], [5, 0]])), 0.5);
      for (let k = 0; k < 14; k++) {
        if (s.due()) await s.pace();
        const t = s.r(0.6, 4.2);
        s.modes(t, [[s.r(2400, 6200), s.r(0.02, 0.06), s.r(0.03, 0.09)]]);
      }
    },
  },
  // an ice crack: a snap, the ice's singing chirp, a low knock under it
  iceCrack: {
    len: 1.2, gain: 0.32, variants: 3, wet: true, gap: 0.06,
    async render(s, v) {
      const k = [1, 0.86, 1.18][v];
      crack(s, 0, 1, 1700 * k);
      icePing(s, 0.004, k);
      thud(s, 0, 90 * k, 55, 0.05, 0.35);
    },
  },
  // the ice breaking up: a great crack and its boom, a shattering, chunks, the water underneath
  iceBreak: {
    len: 3.2, gain: 0.46, wet: true, sr: 16000, gap: 0.3,
    async render(s) {
      crack(s, 0, 1.2, 1500);
      thud(s, 0, 100, 48, 0.4, 1);
      icePing(s, 0.01, 0.9, 0.8);
      icePing(s, 0.32, 1.15, 0.5);
      await s.scatter(0.04, 1.4, 40, { f: [1800, 6000], q: 1.6, len: [0.002, 0.012], amp: [0.05, 0.3], bias: 1.4 });
      for (const t of [0.3, 0.55, 0.9, 1.3]) thud(s, t, s.r(110, 160), 50, 0.08, s.r(0.2, 0.4));
      s.out(s.amp(s.filter(s.noiseSrc('brown'), 'lowpass', s.curve([[0, 400], [1, 900], [3, 300]], true), 0.8), s.shape([[0, 0], [0.5, 0.5], [1.6, 0.4], [3.1, 0]])), 0.8);
    },
  },
  // a drop of meltwater: a "plip" (the bubble's rising ring), a tiny splash
  drip: {
    len: 0.36, gain: 0.14, variants: 3, gap: 0.02,
    async render(s, v) {
      const f0 = [900, 1150, 760][v];
      const o = s.osc('sine', s.curve([[0.002, f0], [0.018, f0 * 2.1]], true), 0.002, 0.2);
      s.out(s.amp(o, s.shape([[0.002, 0], [0.004, 1], [0.03, 0.4], [0.12, 0]])), 0.5);
      s.burst(0.001, 0.03, { type: 'highpass', f: 3000, q: 0.7, attack: 0.0005, tau: 0.003, amp: 0.15 });
    },
  },
  // a frozen waterfall breaking: a crack, the roar of the water bursting through, the mist, ice
  fallsBreak: {
    len: 4.2, gain: 0.46, wet: true, sr: 16000, gap: 0.5,
    async render(s) {
      crack(s, 0, 1.1, 1400);
      thud(s, 0, 90, 48, 0.35, 0.8);
      const e = s.shape([[0.05, 0], [0.5, 1], [2.6, 0.85], [4.1, 0]]);
      s.out(s.amp(s.filter(s.noiseSrc('brown'), 'lowpass', s.curve([[0, 400], [0.6, 2600], [4, 1500]], true), 0.6), e), 1.1);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', 2400, 0.6), e), 0.35);
      await s.scatter(0.05, 1.2, 28, { f: [1800, 5500], q: 1.5, len: [0.002, 0.01], amp: [0.05, 0.25], bias: 1.6 });
    },
  },
  // a windmill starting: the wooden creak, the gears' clunks quickening, the sails' first sweeps
  millStart: {
    len: 3.2, gain: 0.29, wet: true, sr: 16000, gap: 0.5,
    async render(s) {
      voiced(s, [[0, 78], [0.35, 96], [0.6, 70]], [[0, 'o'], [0.6, 'a']], [[0, 0], [0.04, 0.8], [0.5, 0.6], [0.65, 0]], { jitter: 0.12, rate: 45, breath: 0.05, gain: 0.5 });
      for (const t of [0.5, 1.05, 1.5, 1.85, 2.15, 2.4]) {
        thud(s, t, 140, 90, 0.05, 0.4);
        s.burst(t, 0.05, { type: 'bandpass', f: 900, q: 1.5, attack: 0.0008, tau: 0.008, amp: 0.3 });
      }
      const am = s.ctl((t) => (t < 0.8 ? 0 : 0.5 + 0.5 * Math.sin(2 * Math.PI * (0.4 * t + 0.6 * t * t / 3.2))));
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', 520, 0.8), s.ctl((t, i) => am[i] * Math.min(1, Math.max(0, t - 0.8) / 1.2) * (t > 3 ? 0 : 1))), 0.35);
    },
  },
  // a gust of wind (the North Wind, the mills): a swell through a moving band, a whistle on it
  windGust: {
    len: 2.4, gain: 0.16, wet: true, sr: 16000, gap: 0.2,
    async render(s) {
      const e = s.shape([[0, 0], [0.45, 1], [1.1, 0.75], [2.3, 0]]);
      s.out(s.amp(s.filter(s.noiseSrc('brown'), 'bandpass', s.curve([[0, 250], [0.5, 900], [2.3, 300]], true), 0.7), e), 1.4);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', s.curve([[0, 1300], [0.6, 1900], [2.3, 1200]], true), 9), e), 0.12);
    },
  },
  // braziers lit: the ignition's whoomph, the fire catching, a warm shimmer
  braziersLit: {
    len: 2, gain: 0.34, wet: true, gap: 0.3,
    async render(s) {
      s.out(s.amp(s.filter(s.noiseSrc('brown'), 'lowpass', s.curve([[0, 200], [0.08, 2500], [0.6, 700], [1.8, 400]], true), 0.8), s.env(0, 0.03, 0.4)), 1.2);
      thud(s, 0, 110, 50, 0.15, 0.6);
      await s.scatter(0.1, 1.7, 26, { type: 'highpass', f: [1800, 4200], q: 0.8, len: [0.002, 0.006], amp: [0.03, 0.14] });
      for (const m of [D4 + 12, A4 + 12]) s.modes(0.12, [[mtof(m), 0.05, 0.5]]);
    },
  },

  // ---- the foes and the bosses ------------------------------------------------------------------
  // a frost wolf's howl: a rising, then long falling "oo", breathy (2 voices of the pack)
  wolfHowl: {
    len: 2.6, gain: 0.13, variants: 2, wet: true, sr: 16000, gap: 0.3,
    async render(s, v) {
      const k = v ? 1.16 : 1;
      const end = v ? 1.8 : 2.4;
      voiced(s, [[0, 360 * k], [0.35, 540 * k], [0.9, 520 * k], [end, 330 * k]], [[0, 'u'], [0.5, 'o'], [end, 'u']], [[0, 0], [0.25, 0.9], [1.2, 1], [end, 0]],
        { scale: 1.25, jitter: 0.015, rate: 6, breath: 0.35, q: [8, 10, 12], gain: 0.9 });
    },
  },
  // a rime crow's caw: a harsh nasal "kraa", once or twice
  crowCaw: {
    len: 0.95, gain: 0.22, variants: 3, wet: true, gap: 0.08,
    async render(s, v) {
      const caws = v === 2 ? [0, 0.34] : [0];
      for (const t0 of caws) {
        const f = [310, 280, 340][v] * (t0 ? 0.94 : 1);
        voiced(s, [[t0, f * 0.9], [t0 + 0.05, f * 1.1], [t0 + 0.26, f * 0.85]], [[t0, 'a'], [t0 + 0.26, 'a']], [[t0, 0], [t0 + 0.02, 1], [t0 + 0.2, 0.8], [t0 + 0.28, 0]],
          { scale: 1.45, jitter: 0.12, rate: 70, breath: 0.25, fm: [96, 70], q: [4, 5, 6], gain: 1 });
      }
    },
  },
  // a flock of crows taking flight: wings flurrying, fading off; caws among them
  crowFlock: {
    len: 2.4, gain: 0.3, wet: true, sr: 16000, gap: 0.4, deps: ['crowCaw'],
    async render(s, v, dep) {
      for (let k = 0; k < 7; k++) {
        if (s.due()) await s.pace();
        const t0 = s.r(0, 0.5);
        const rate = s.r(8, 12);
        const pts = [[t0, 0]];
        for (let t = t0; t < t0 + 1.3; t += 1 / rate) pts.push([t + 0.01, s.r(0.4, 1) * (1 - (t - t0) / 1.6)], [t + 0.05, 0.05]);
        s.out(s.amp(s.filter(s.noiseSrc('white', t0), 'bandpass', s.r(500, 1100), 1.1), s.curve(pts)), 0.35, s.r(-0.5, 0.5));
      }
      for (const [t, rate] of [[0.15, 1], [0.6, 0.93], [1.05, 1.08]]) {
        const b = s.ctx.createBufferSource();
        b.buffer = dep('crowCaw');
        b.playbackRate.value = rate;
        b.start(t);
        s.out(b, 0.45);
      }
    },
  },
  // Old Gullet's roar: a deep, bubbling roar from under the ice — a throat in water
  gulletRoar: {
    len: 3.6, gain: 0.44, wet: true, sr: 16000, gap: 0.3,
    async render(s) {
      const e = s.shape([[0, 0], [0.3, 0.8], [1.2, 1], [2.6, 0.7], [3.5, 0]]);
      s.saturate(2, 4000, e);
      const f0 = s.curve([[0, 42], [0.4, 58], [1.8, 50], [3.4, 36]], true);
      const w = s.wobble(9);
      const g = s.formants(s.osc('sawtooth', s.ctl((t, i) => f0[i] * (1 + 0.08 * w[i]))), [[s.curve([[0, 300], [1.5, 420], [3.4, 280]]), 4, 1], [720, 5, 0.6], [1400, 6, 0.25]]);
      s.out(g, 1.2, 0, 'drive');
      for (let k = 0; k < 26; k++) {
        if (s.due()) await s.pace();
        const t = s.r(0.1, 3.2);
        const f = s.r(140, 420);
        const o = s.osc('sine', s.curve([[t, f], [t + 0.06, f * 1.8]], true), t, 0.12);
        s.out(s.amp(o, s.shape([[t, 0], [t + 0.004, 1], [t + 0.07, 0]])), s.r(0.05, 0.16));
      }
      s.out(s.amp(s.filter(s.noiseSrc('brown'), 'lowpass', 500, 0.7), e), 0.6);
    },
  },
  // a tentacle slamming on the ice: a wet slap, a heavy thud, the ice cracking, a splash
  tentacleSlam: {
    len: 1.8, gain: 0.44, wet: true, sr: 16000, gap: 0.08,
    async render(s) {
      s.burst(0, 0.2, { type: 'bandpass', f: 1100, q: 0.9, attack: 0.001, tau: 0.03, amp: 0.9 });
      thud(s, 0, 105, 48, 0.3, 1);
      crack(s, 0.02, 0.6, 1600);
      icePing(s, 0.03, 0.95, 0.4);
      s.out(s.amp(s.filter(s.noiseSrc(), 'lowpass', s.curve([[0, 4000], [1.2, 900]], true), 0.7), s.shape([[0.04, 0], [0.12, 0.5], [0.6, 0.2], [1.6, 0]])), 0.6);
    },
  },
  // the Mawkin's reap: a scythe's great sweep, straw rustling, a cold metal shing
  reap: {
    len: 1.3, gain: 0.17, wet: true, gap: 0.1,
    async render(s) {
      s.burst(0, 1, { f: [[0, 300], [0.3, 2400], [0.8, 600]], q: 1.2, attack: 0.18, tau: 0.16, amp: 1.2 });
      await s.scatter(0.1, 0.9, 36, { type: 'highpass', f: [2500, 6000], q: 0.8, len: [0.004, 0.015], amp: [0.03, 0.12], fade: false });
      s.modes(0.3, [[2950, 0.12, 0.16], [4120, 0.08, 0.1], [5600, 0.04, 0.06]]);
    },
  },
  // the frost crown shattering: a crack, glass and ice bursting, tinkling, a low boom — and a bright
  // D-major ring left in the air (the promise let go)
  crownShatter: {
    len: 3.4, gain: 0.44, wet: true, gap: 1,
    async render(s) {
      crack(s, 0, 1.2, 2400);
      thud(s, 0, 90, 50, 0.35, 0.8);
      for (let k = 0; k < 40; k++) {
        if (s.due()) await s.pace();
        s.modes(s.r(0, 0.25), [[s.r(1800, 7500), s.r(0.03, 0.12), s.r(0.02, 0.12)]]);
      }
      await s.scatter(0.2, 2.2, 34, { f: [3000, 8000], q: 2, len: [0.002, 0.008], amp: [0.02, 0.1], bias: 1.5 });
      for (const m of [D4 + 12, FS4 + 12, A4 + 12, D4 + 24]) s.modes(0.08, [[mtof(m), 0.05, 1.1], [mtof(m) * 1.002, 0.04, 1]]);
    },
  },
  // Rimehart's bellow (its intro, a phase's turn, its roar): a deep, hollow, breathy stag's roar —
  // a groan rising and breaking low through an "o-a-u" throat — the frost in its breath crackling as
  // it dies away (≈ 1.4 s)
  stagBellow: {
    len: 2.2, gain: 0.36, wet: true, sr: 16000, gap: 0.3,
    async render(s) {
      const e = s.shape([[0, 0], [0.12, 0.9], [0.55, 1], [1.05, 0.7], [1.42, 0]]);
      s.saturate(1.8, 3200, e);
      const F = s.vowels([[0, 'o'], [0.5, 'a'], [1.3, 'u']], 0.72);
      const v = s.formants(s.voice(s.curve([[0, 60], [0.22, 98], [0.7, 86], [1.3, 50]], true), { jitter: 0.06, rate: 22, breath: 0.5, fm: [31, 30] }),
        [[F[0], 5, 1], [F[1], 6, 0.6], [F[2], 8, 0.3]]);
      s.out(v, 1, 0, 'drive');
      s.out(s.amp(s.filter(s.noiseSrc('brown'), 'bandpass', s.curve([[0, 260], [0.6, 520], [1.4, 220]], true), 0.9), e), 0.7);
      await s.scatter(0.8, 1.9, 26, { f: [2200, 6500], q: 1.6, len: [0.002, 0.01], amp: [0.03, 0.18], bias: 0.6 });
      icePing(s, 1.15, 1.1, 0.35);
    },
  },
  // a frost wolf's snarl: a low rattling growl, lips drawn back, a snap of breath (2 voices)
  wolfSnarl: {
    len: 1, gain: 0.2, variants: 2, wet: true, sr: 16000, gap: 0.15,
    async render(s, v) {
      const k = v ? 1.12 : 1;
      voiced(s, [[0, 120 * k], [0.15, 160 * k], [0.55, 105 * k]], [[0, 'a'], [0.3, 'e'], [0.6, 'a']], [[0, 0], [0.05, 0.8], [0.35, 1], [0.62, 0]],
        { scale: 1.1, jitter: 0.18, rate: 55, breath: 0.45, fm: [38, 60], q: [4, 5, 6], gain: 1 });
      s.burst(0.6, 0.12, { type: 'highpass', f: 1800, q: 0.7, attack: 0.002, tau: 0.03, amp: 0.4 });
    },
  },
  // a frost breath: a cold blast of air — a hiss swelling and sweeping down — and ice tinkling in it
  frostBreath: {
    len: 1.6, gain: 0.11, wet: true, sr: 16000, gap: 0.15,
    async render(s) {
      const e = s.shape([[0, 0], [0.15, 1], [0.7, 0.7], [1.45, 0]]);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', s.curve([[0, 3800], [0.4, 2200], [1.4, 1200]], true), 0.9), e), 0.9);
      s.out(s.amp(s.filter(s.noiseSrc('brown'), 'lowpass', 700, 0.7), e), 0.6);
      await s.scatter(0.15, 1.3, 30, { f: [3500, 8000], q: 2, len: [0.002, 0.008], amp: [0.02, 0.12], bias: 1.3 });
    },
  },
  // an ice shard spat: a hard "tchk" of a throat, the shard whistling off (a falling zip)
  shardSpit: {
    len: 0.7, gain: 0.18, variants: 2, wet: true, gap: 0.06,
    async render(s, v) {
      const k = v ? 1.15 : 1;
      s.burst(0, 0.05, { type: 'bandpass', f: 1400 * k, q: 1.2, attack: 0.0005, tau: 0.008, amp: 0.8 });
      thud(s, 0, 160 * k, 90, 0.03, 0.3);
      const o = s.osc('sine', s.curve([[0.02, 4200 * k], [0.4, 1500 * k]], true), 0.02, 0.45);
      s.out(s.amp(o, s.shape([[0.02, 0], [0.04, 0.5], [0.25, 0.3], [0.45, 0]])), 0.25);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', s.curve([[0.02, 5000 * k], [0.4, 2000 * k]], true), 3), s.shape([[0.02, 0], [0.05, 1], [0.42, 0]])), 0.3);
      icePing(s, 0.003, 1.3 * k, 0.25);
    },
  },
  // a hushguard re-sealing: frost knitting the ice shut again — crackles quickening and rising, a
  // glassy shimmer drawing in, a soft clink as it closes (F6: the Hush Bell's retrograde's F)
  hushSeal: {
    len: 1.4, gain: 0.13, wet: true, gap: 0.1,
    async render(s) {
      for (let k = 0; k < 30; k++) {
        if (s.due()) await s.pace();
        const u = k / 30;
        s.modes(0.9 * (1 - (1 - u) ** 2), [[2200 + 4200 * u + s.r(-300, 300), s.r(0.03, 0.08) * (0.4 + u), s.r(0.01, 0.04)]]);
      }
      s.burst(0, 0.95, { f: [[0, 6000], [0.9, 2400]], q: 3, attack: 0.6, tau: 0.04, amp: 0.25 });
      s.modes(0.92, [[mtof(89), 0.1, 0.3], [mtof(89) * 2.76, 0.03, 0.08]]);
    },
  },
  // the cantor's hush: a long breathed "shhh" over a low hum of two voices (D3 and F3: the Hush's
  // minor third), its handbell touched and damped at once
  cantorHush: {
    len: 1.8, gain: 0.11, wet: true, sr: 16000, gap: 0.2,
    async render(s) {
      const e = s.shape([[0, 0], [0.25, 1], [1, 0.8], [1.6, 0]]);
      s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', 3000, 1.1), e), 0.9);
      for (const [f, g] of [[147, 0.5], [175, 0.35]]) {
        voiced(s, [[0, f], [1.6, f * 0.95]], [[0, 'u'], [1.6, 'u']], [[0, 0], [0.3, 0.5], [1.2, 0.4], [1.6, 0]], { jitter: 0.01, rate: 5, breath: 0.1, q: [8, 10, 12], gain: g });
      }
      s.modes(0.002, [[mtof(77), 0.2, 0.18], [mtof(77) * 3.01, 0.05, 0.06]]);
    },
  },
  // a gull's cry: "kee-ow" (or its laughing call)
  gullCry: {
    len: 1.4, gain: 0.1, variants: 2, wet: true, gap: 0.1,
    async render(s, v) {
      if (v === 0) {
        voiced(s, [[0, 1100], [0.12, 1650], [0.55, 900]], [[0, 'i'], [0.2, 'e'], [0.55, 'o']], [[0, 0], [0.03, 1], [0.4, 0.7], [0.6, 0]], { scale: 1.9, jitter: 0.05, rate: 50, breath: 0.2, q: [5, 7, 9] });
      } else {
        for (let k = 0; k < 5; k++) {
          const t0 = k * 0.2;
          voiced(s, [[t0, 1350 - k * 40], [t0 + 0.06, 1500 - k * 40], [t0 + 0.14, 1150]], [[t0, 'e'], [t0 + 0.14, 'a']], [[t0, 0], [t0 + 0.02, 1 - k * 0.12], [t0 + 0.14, 0]], { scale: 1.9, jitter: 0.06, rate: 60, breath: 0.2, q: [5, 7, 9] });
        }
      }
    },
  },
};

/**
 * The ambience's voices (not `playSfx` names): the ice's creak (a low groan of strain) and its
 * ping; the surf's loop (two waves breaking, their foam and backwash; stereo; its end crossfaded
 * into its start). The drips, gulls and crows play the sounds' buffers (`drip`, `gullCry`, `crowCaw`).
 * @type {Record<string, VqSound>}
 */
export const EV_VOICES = {
  creak: {
    len: 1.6, gain: 1, variants: 3, sr: 16000,
    async render(s, v) {
      const f = [62, 74, 55][v];
      voiced(s, [[0, f], [0.4, f * 1.3], [1.4, f * 0.9]], [[0, 'o'], [1.4, 'u']], [[0, 0], [0.2, 0.8], [1, 0.6], [1.5, 0]], { jitter: 0.2, rate: 22, breath: 0.1, q: [3, 4, 5], scale: 0.7 });
      icePing(s, s.r(0.3, 0.8), [0.7, 0.8, 0.6][v], 0.25);
    },
  },
  ping: {
    len: 0.9, gain: 1, variants: 3, sr: 16000,
    async render(s, v) {
      icePing(s, 0.002, [1, 0.8, 1.25][v]);
    },
  },
  surf: {
    len: 12.6, gain: 1, stereo: true, sr: 16000,
    async render(s) {
      for (const [t0, pan, size] of [[0, -0.3, 1], [6.1, 0.35, 0.85]]) {
        if (s.due()) await s.pace();
        // the swell rising (its roar opening), the crash at its top, the foam, the backwash's pebbles
        const swell = s.shape([[t0, 0.1], [t0 + 2.4, 0.7], [t0 + 2.9, 1], [t0 + 4.6, 0.5], [t0 + 6.3, 0.1]]);
        s.out(s.amp(s.filter(s.noiseSrc('brown'), 'lowpass', s.curve([[t0, 250], [t0 + 2.8, 1100], [t0 + 6.2, 300]], true), 0.6), swell), 1.2 * size, pan);
        s.out(s.amp(s.filter(s.noiseSrc(), 'bandpass', 2600, 0.6), s.shape([[t0 + 2.6, 0], [t0 + 2.9, 1], [t0 + 3.6, 0.45], [t0 + 6, 0]])), 0.5 * size, pan * 0.6);
        s.out(s.amp(s.filter(s.noiseSrc(), 'highpass', 4500, 0.7), s.shape([[t0 + 3, 0], [t0 + 3.4, 0.4], [t0 + 6.2, 0]])), 0.3 * size, -pan);
        await s.scatter(t0 + 4, t0 + 6.2, 30, { f: [1500, 5000], q: 1.4, len: [0.002, 0.006], amp: [0.01, 0.04], stereo: 0.7 });
      }
    },
    post(chans, sr) {
      // the loop: its last 0.6 s crossfaded into its start
      const x = Math.round(0.6 * sr);
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
};
