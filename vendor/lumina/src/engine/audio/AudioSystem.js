import { clamp, mulberry32 } from '../utils/math.js';
import { ownValue } from '../utils/own.js';

/**
 * AudioSystem — fully procedural WebAudio: UI/gameplay SFX, layered ambience and a gentle
 * harp-and-strings folk loop inspired by the town themes of Square Enix's HD-2D games. No audio files.
 *
 * Nothing touches WebAudio until `unlock()` (call it from a user gesture). Before that every
 * method is a silent no-op, but ambience levels and "music wanted" are remembered and applied
 * on unlock.
 *
 * Combat levels (COMBAT.md §12, all opt-in): 35 combat SFX (`COMBAT_SFX_NAMES`), two more music
 * tracks built lazily on first use — `battle` "Ashes on the Wind" and `boss` "Heart of Cinders" —
 * that `startMusic({ track })` crossfades to, `setMusicSection` ('A' | 'B') and `playStinger`
 * ('victory' | 'levelup', with an optional `duck`). The default song, its scheduled notes, the
 * 8 `SFX_NAMES`, the ambience and the bus / compressor / reverb mix are unchanged; the combat
 * sounds' QA (loudness, clicks, spectrum, dense mixes) lives in `sandbox/combat_audio.html`.
 *
 * Vanquish the Evil Dragon (DRAGON_CAMPAIGN.md §6.9, all opt-in): six scored tracks built lazily
 * like the combat tracks (sections with their own tempo, `MUSIC_ROLE_SECTIONS` for CombatMusic),
 * played by the score's own instruments — live string, brass and choir ensembles, an organ and a
 * drone; drums, timpani, bells, cymbals and a lute rendered once into shared buffers before the
 * track starts (`primeMusic`, `musicReady`, `retainMusic`: a score track's `startMusic` waits for
 * its renders) —, 31 sounds (`VQ_SFX_NAMES`) rendered once into shared buffers by
 * OfflineAudioContext graphs — off the main thread, started by the first Vanquish track, sound or
 * crowd / blaze level (`primeSfx`) — and the `crowd` / `blaze` ambience with its own RNG. Their
 * names live here; the scores, their instruments and the music's renders live under vanquish/, the
 * sound recipes and the layers in VanquishAudio.js — the one door to all of them, a module imported
 * (`import()`) the first time one of them is asked for: a level that uses none of them never
 * fetches it. Its QA lives in `sandbox/vq_audio.html`.
 *
 * Graph:
 *   voices → [sfx | ambience | music] buses ─┬──────────────→ mix → compressor → master → out
 *                                             └→ reverb send → convolver (generated IR) → mix
 */

/** Sound-effect names accepted by `playSfx`. */
export const SFX_NAMES = Object.freeze(/** @type {const} */ (['step', 'blip', 'confirm', 'cancel', 'open', 'close', 'chime', 'splash']));
/**
 * Combat sound-effect names (combat levels, COMBAT.md §12.1), also accepted by `playSfx` — a
 * separate list, so `SFX_NAMES` keeps exactly the 8 names above. Each is a small seeded synth
 * (≤ 6 nodes per play) routed through a lazily created bank of shared stereo panners.
 */
export const COMBAT_SFX_NAMES = Object.freeze(/** @type {const} */ (['swing', 'swingHeavy', 'hit', 'crit', 'hurt', 'dodge', 'perfect', 'whirl',
  'bolt', 'boltHit', 'nova', 'drink', 'guard', 'enemyAlert', 'windup', 'arrow', 'arrowHit', 'hexBurst', 'slimeHop',
  'batScreech', 'boarSnort', 'boarCharge', 'stun', 'enemyDie', 'bossRoar', 'slam', 'rockToss', 'gateClose', 'pickup',
  'coin', 'chestOpen', 'waystone', 'levelup', 'playerDown', 'heartbeat']));
/**
 * The sound effects of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §6.9), also
 * accepted by `playSfx` — a list of their own, so `SFX_NAMES` and `COMBAT_SFX_NAMES` stay as they
 * are. Each is a seeded synth rendered once into buffers (VanquishAudio.js `VQ_SOUNDS`; one or a
 * few variants, one picked per play) and played through the combat panner banks: two nodes per play.
 */
export const VQ_SFX_NAMES = Object.freeze(/** @type {const} */ (['roar', 'roarFar', 'wingbeat', 'fireballFall', 'explosion',
  'fireRoar', 'breath', 'quake', 'swordWave', 'bladeStorm', 'skyfall', 'holyBolt', 'holyPillar', 'sanctuary', 'iceShard',
  'blizzard', 'iceSpike', 'freeze', 'shieldBash', 'taunt', 'earthshatter', 'ward', 'cheer', 'firework', 'scream', 'growl',
  'yip', 'screech', 'cackle', 'crash', 'wallHit']));
/**
 * The sound effects of The Bells of Evermere (docs/contracts/EVERMERE_CAMPAIGN.md §5.7), also
 * accepted by `playSfx` — a list of their own like Vanquish's: each a seeded synth rendered once
 * into buffers by Evermere's audio pack (EvermereAudio.js, imported on the first use of one of its
 * names) and played through the combat panner banks, two nodes a play.
 */
export const EV_SFX_NAMES = Object.freeze(/** @type {readonly ('bellToll'|'bellTollBlack'|'waysideChime'|'thawSweep'|'iceCrack'|'iceBreak'|'drip'
  |'fallsBreak'|'millStart'|'wolfHowl'|'crowCaw'|'crowFlock'|'gulletRoar'|'tentacleSlam'|'hammerHit'|'hammerSlam'|'peal'|'tollBell'|'carillon'
  |'markPop'|'reap'|'hushToll'|'crownShatter'|'tuningFork'|'memoryChime'|'gullCry'|'windGust'|'braziersLit'|'stagBellow'|'motif'|'bellTollFar'
  |'hushSeal'|'wolfSnarl'|'frostBreath'|'shardSpit'|'cantorHush')[]} */ (
  // (one string: the game chunk carries them every page — EVERMERE_CAMPAIGN.md §8's 1.5 kB)
  'bellToll bellTollBlack waysideChime thawSweep iceCrack iceBreak drip fallsBreak millStart wolfHowl crowCaw crowFlock gulletRoar tentacleSlam hammerHit hammerSlam peal tollBell carillon markPop reap hushToll crownShatter tuningFork memoryChime gullCry windGust braziersLit stagBellow motif bellTollFar hushSeal wolfSnarl frostBreath shardSpit cantorHush'.split(' ')));
/** @typedef {typeof SFX_NAMES[number] | typeof COMBAT_SFX_NAMES[number] | typeof VQ_SFX_NAMES[number] | typeof EV_SFX_NAMES[number]} SfxName a `playSfx` name */
/** @type {Set<string>} */
const COMBAT_SFX = new Set(COMBAT_SFX_NAMES);
/** @type {Set<string>} */
const VQ_SFX = new Set(VQ_SFX_NAMES);
/** @type {Set<string>} */
const EV_SFX = new Set(EV_SFX_NAMES);
/**
 * Music tracks `startMusic({ track })` accepts (COMBAT.md §12.2): the default song 'emberfall'
 * ("Emberfall Evening", 72 bpm) and the combat tracks 'battle' (132 bpm) and 'boss' (140 bpm); and
 * Vanquish the Evil Dragon's scored tracks (DRAGON_CAMPAIGN.md §6.9; vanquish/Scores.js): 'dread'
 * (64 bpm), 'siege' (92), 'ascent' (128; B 96), 'dragon' (76; C 84), 'festival' (a 6/8 jig) and
 * 'triumph' (80).
 */
export const MUSIC_TRACKS = Object.freeze(['emberfall', 'battle', 'boss', 'dread', 'siege', 'ascent', 'dragon', 'festival', 'triumph']);
/**
 * The Bells of Evermere's tracks (docs/contracts/EVERMERE_CAMPAIGN.md §5.7; evermere/Scores.js), also
 * accepted by `startMusic` — a list of their own, so `MUSIC_TRACKS` stays as it is. Their sections
 * are the pack's (`setMusicSection` takes any name for one before it plays, and the track starts in
 * it if it has it); a region's track starts in its `frozen` section while the level is frozen where
 * the camera looks, and the pack moves it to its season's at the thaw (EvermereAudio.js).
 */
export const EV_MUSIC_TRACKS = Object.freeze(['hush', 'waking', 'tides', 'harvest', 'rimeholt', 'hushfight', 'guardian', 'hushedking', 'firstspring']);
/** Stingers accepted by `playStinger` (played over the music on the music bus). */
export const MUSIC_STINGERS = Object.freeze(['victory', 'levelup']);
/**
 * Ambience layer names accepted by `setAmbience`; 'crowd' (a frightened crowd's babble and cries)
 * and 'blaze' (a big fire's roar, crackles, pops and cracking timber) are Vanquish the Evil
 * Dragon's (DRAGON_CAMPAIGN.md §6.9).
 */
export const AMBIENCE_LAYERS = Object.freeze(['wind', 'birds', 'crickets', 'fire', 'water', 'crowd', 'blaze']);
/**
 * The Bells of Evermere's layers (EVERMERE_CAMPAIGN.md §5.7: the surf with its gulls, a winter howl,
 * the ice's crackle and creak — and, with `setAmbience`'s `params.melt`, the thaw's drips), accepted
 * by `setAmbience` — a list of their own, built by Evermere's pack (EvermereAudio.js) when it has
 * arrived; 0 on every other level, which creates none of them.
 */
export const EV_AMBIENCE_LAYERS = Object.freeze(['surf', 'howl', 'icebed']);
/** Every layer `setAmbience` takes, in the order they are applied (the old ones first, as before). */
const LAYERS = [...AMBIENCE_LAYERS, ...EV_AMBIENCE_LAYERS];

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

/** Per-layer loudness at level 1 (before the ambience bus). */
const LAYER_GAIN = { wind: 0.62, birds: 1.5, crickets: 0.95, fire: 0.29, water: 0.62, crowd: 0.3, blaze: 0.38 };

/** Internal make-up gain per bus so the public 0..1 volumes land at sensible loudness. */
const BUS_TRIM = { music: 2.4, sfx: 1.9, amb: 1.5 };

/** Minimum spacing between two plays of the same sfx (s) — keeps rapid triggers from piling up. */
const SFX_MIN_INTERVAL = {
  step: 0.045, blip: 0.018, confirm: 0.05, cancel: 0.05, open: 0.08, close: 0.08, chime: 0.1, splash: 0.08,
  // combat (COMBAT.md §12.1): 30–60 ms, hit and coin 30 ms
  swing: 0.04, swingHeavy: 0.05, hit: 0.03, crit: 0.04, hurt: 0.06, dodge: 0.05, perfect: 0.06, whirl: 0.06,
  bolt: 0.05, boltHit: 0.04, nova: 0.06, drink: 0.06, guard: 0.04, enemyAlert: 0.05, windup: 0.05, arrow: 0.04,
  arrowHit: 0.04, hexBurst: 0.05, slimeHop: 0.04, batScreech: 0.05, boarSnort: 0.06, boarCharge: 0.06, stun: 0.06,
  enemyDie: 0.04, bossRoar: 0.06, slam: 0.06, rockToss: 0.05, gateClose: 0.06, pickup: 0.035, coin: 0.03,
  chestOpen: 0.06, waystone: 0.06, levelup: 0.06, playerDown: 0.06, heartbeat: 0.06,
  // Vanquish the Evil Dragon (DRAGON_CAMPAIGN.md §6.9)
  roar: 0.25, roarFar: 0.25, wingbeat: 0.12, fireballFall: 0.05, explosion: 0.06, fireRoar: 0.08, breath: 0.2, quake: 0.2,
  swordWave: 0.08, bladeStorm: 0.1, skyfall: 0.2, holyBolt: 0.05, holyPillar: 0.08, sanctuary: 0.2, iceShard: 0.05,
  blizzard: 0.2, iceSpike: 0.1, freeze: 0.06, shieldBash: 0.05, taunt: 0.2, earthshatter: 0.2, ward: 0.2, cheer: 0.3,
  firework: 0.08, scream: 0.08, growl: 0.08, yip: 0.05, screech: 0.06, cackle: 0.1, crash: 0.15, wallHit: 0.04,
};
/** Combat SFX that also feed the reverb (magic, big impacts, chimes). */
const COMBAT_WET = new Set(['perfect', 'nova', 'drink', 'hexBurst', 'bossRoar', 'slam', 'gateClose', 'chestOpen', 'waystone', 'levelup', 'playerDown']);

const LOOKAHEAD = 0.35; // seconds scheduled ahead of currentTime
const TIMER_MS = 40; // scheduler timer period
const HARP_SR = 32000; // sample rate of pre-rendered Karplus-Strong plucks
const MAX_VOICES = 96;

// ---------------------------------------------------------------------------------------------
// The song: "Emberfall Evening" — 72 bpm, 4/4, harp in rolling triplet eighths over soft string
// pads, flute melody on top. Section A in D dorian, section B in D mixolydian.
// ---------------------------------------------------------------------------------------------

const CHORDS = {
  //       bass     harp arpeggio tones (low → high)       pad voicing
  Dm: { bass: 38, arp: [50, 57, 62, 64, 65, 69], pad: [50, 57, 64, 65] }, // Dm(add9)
  C: { bass: 36, arp: [48, 55, 60, 62, 64, 67], pad: [48, 55, 62, 64] }, // C(add9)
  G: { bass: 43, arp: [50, 55, 59, 62, 67, 71], pad: [50, 55, 59, 62] }, // G/D colour
  F: { bass: 41, arp: [53, 57, 60, 64, 65, 69], pad: [53, 57, 60, 64] }, // Fmaj7
  Am: { bass: 45, arp: [52, 57, 60, 64, 69, 72], pad: [52, 57, 60, 64] },
  D: { bass: 38, arp: [50, 57, 62, 64, 66, 69], pad: [50, 57, 64, 66] }, // D(add9) — mixolydian
  Em: { bass: 40, arp: [52, 59, 62, 64, 67, 71], pad: [52, 59, 62, 67] }, // Em7
};

const PROGRESSION_A = ['Dm', 'C', 'G', 'Dm', 'F', 'C', 'G', 'Am'];
const PROGRESSION_B = ['D', 'C', 'G', 'D', 'Em', 'G', 'C', 'D'];

// [bar, beat, durationBeats, midi]
const MELODY = [
  // A — dorian
  [0, 0, 2, 69], [0, 2, 1, 74], [0, 3, 1, 76],
  [1, 0, 1.5, 77], [1, 1.5, 0.5, 76], [1, 2, 1, 74], [1, 3, 1, 72],
  [2, 0, 3, 74], [2, 3, 1, 71],
  [3, 0, 4, 69],
  [4, 0, 1, 72], [4, 1, 1, 74], [4, 2, 1, 77], [4, 3, 1, 81],
  [5, 0, 2, 79], [5, 2, 1, 76], [5, 3, 1, 72],
  [6, 0, 1.5, 74], [6, 1.5, 0.5, 76], [6, 2, 1, 74], [6, 3, 1, 71],
  [7, 0, 3, 69],
  // B — mixolydian
  [8, 0, 1, 74], [8, 1, 1, 78], [8, 2, 2, 81],
  [9, 0, 1.5, 79], [9, 1.5, 0.5, 76], [9, 2, 2, 72],
  [10, 0, 1, 71], [10, 1, 1, 74], [10, 2, 1, 79], [10, 3, 1, 78],
  [11, 0, 1, 76], [11, 1, 1, 74], [11, 2, 2, 69],
  [12, 0, 1.5, 79], [12, 1.5, 0.5, 78], [12, 2, 1, 76], [12, 3, 1, 71],
  [13, 0, 2, 74], [13, 2, 1, 71], [13, 3, 1, 74],
  [14, 0, 1, 76], [14, 1, 1, 79], [14, 2, 1, 76], [14, 3, 1, 72],
  [15, 0, 4, 74],
];

const ARP_PATTERNS = [
  [0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 2, 1],
  [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 1],
  [0, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 2],
];

/** Build the scheduled event list for a run of chords (+ optional melody). */
function buildSection(chords, melody, seed) {
  const rng = mulberry32(seed);
  const events = [];
  chords.forEach((name, bar) => {
    const ch = CHORDS[name];
    const b0 = bar * 4;
    // Pad chord for the bar.
    events.push({ beat: b0, kind: 'pad', notes: ch.pad, dur: 4 });
    // Bass pluck on beat 1 and a softer fifth/octave on beat 3.
    events.push({ beat: b0, kind: 'harp', midi: ch.bass, vel: 0.85, pan: -0.1 });
    events.push({ beat: b0 + 2, kind: 'harp', midi: ch.bass + (bar % 2 ? 12 : 7), vel: 0.45, pan: -0.1 });
    // Rolling triplet arpeggio.
    const pat = ARP_PATTERNS[bar % 4 === 3 ? 2 : bar % 2];
    for (let i = 0; i < 12; i++) {
      const idx = pat[i];
      const accent = i % 3 === 0 ? 0.72 : 0.5;
      events.push({
        beat: b0 + i / 3,
        kind: 'harp',
        midi: ch.arp[idx],
        vel: accent * (0.88 + rng() * 0.24),
        pan: -0.35 + (idx / 5) * 0.7,
        jitter: (rng() - 0.5) * 0.012,
      });
    }
  });
  if (melody) {
    for (const [bar, beat, dur, midi] of melody) {
      events.push({ beat: bar * 4 + beat, kind: 'flute', midi, dur, vel: 0.85 + rng() * 0.15 });
    }
  }
  events.sort((a, b) => a.beat - b.beat);
  return { events, lengthBeats: chords.length * 4 };
}

// ---------------------------------------------------------------------------------------------
// Combat tracks (COMBAT.md §12.2) — built lazily on first use, each from its own seeded RNG, so
// the default song above (and its RNG sequence) is untouched. Same instruments as the song (the
// Karplus-Strong harp, string pads, flute) plus a noise-and-sine taiko and a staccato saw bass.
// ---------------------------------------------------------------------------------------------

const COMBAT_CHORDS = {
  // D minor ("Ashes on the Wind")
  Dm: { bass: 38, arp: [50, 53, 57, 62, 65, 69], pad: [50, 57, 62, 65] },
  Bb: { bass: 34, arp: [46, 50, 53, 58, 62, 65], pad: [46, 53, 58, 62] },
  C: { bass: 36, arp: [48, 52, 55, 60, 64, 67], pad: [48, 55, 60, 64] },
  Gm: { bass: 43, arp: [50, 55, 58, 62, 67, 70], pad: [50, 55, 58, 62] },
  A: { bass: 33, arp: [45, 49, 52, 57, 61, 64], pad: [49, 52, 57, 61] }, // V major (C#)
  // C phrygian ("Heart of Cinders")
  Cm: { bass: 36, arp: [48, 51, 55, 60, 63, 67], pad: [48, 55, 60, 63] },
  Db: { bass: 37, arp: [49, 53, 56, 61, 65, 68], pad: [49, 56, 61, 65] },
  Ab: { bass: 32, arp: [44, 48, 51, 56, 60, 63], pad: [48, 51, 56, 60] },
  Bbm: { bass: 34, arp: [46, 49, 53, 58, 61, 65], pad: [46, 53, 58, 61] },
  Fm: { bass: 41, arp: [48, 53, 56, 60, 65, 68], pad: [48, 53, 56, 60] },
  C5: { bass: 36, arp: [48, 55, 60, 67, 72, 79], pad: [48, 55, 60, 67] }, // open fifth
};

/**
 * Track definitions. Per section: `prog` (one chord per 4/4 bar), `bass` (8th-note ostinato, semitone
 * offsets from the chord's bass), `bassVel`, `drums` (8th-note taiko velocities; beats 1 and 3 are the
 * big drum), `harp` (`step` in beats and an index pattern into the chord's `arp`), `melody`
 * ([bar, beat, beats, midi] flute notes), `fill` (16th-note drum fill in the last bar). `order`:
 * 'alternate' plays A, B, A, B …; 'hold' loops the current section until `setMusicSection` changes it.
 */
const COMBAT_TRACKS = {
  battle: {
    title: 'Ashes on the Wind', bpm: 132, seed: 0xa5e5, order: 'alternate', start: 'A',
    sections: {
      A: {
        prog: ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A'],
        bass: [0, 0, 12, 0, 7, 0, 12, 7], bassVel: [1, 0.55, 0.8, 0.55, 0.9, 0.55, 0.8, 0.62],
        drums: [1, 0.3, 0.5, 0.3, 0.85, 0.3, 0.55, 0.4],
        harp: { step: 0.5, pat: [0, 1, 2, 3, 4, 3, 2, 1], vel: 0.5 },
        melody: [
          [4, 0, 1, 62], [4, 1, 1, 65], [4, 2, 2, 69],
          [5, 0, 1.5, 69], [5, 1.5, 0.5, 67], [5, 2, 2, 65],
          [6, 0, 2, 67], [6, 2, 2, 70],
          [7, 0, 3, 69], [7, 3, 1, 61],
        ],
      },
      B: {
        prog: ['Bb', 'C', 'Dm', 'Dm', 'Gm', 'Bb', 'A', 'A'],
        bass: [0, 12, 0, 12, 7, 12, 0, 7], bassVel: [1, 0.6, 0.75, 0.6, 0.9, 0.6, 0.8, 0.7],
        drums: [1, 0.4, 0.6, 0.75, 0.9, 0.4, 0.7, 0.85],
        harp: { step: 0.25, pat: [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 5, 2, 4, 1, 3, 2], vel: 0.42 },
        fill: true,
        melody: [
          [0, 0, 1.5, 70], [0, 1.5, 0.5, 69], [0, 2, 2, 65],
          [1, 0, 1.5, 67], [1, 1.5, 0.5, 69], [1, 2, 2, 72],
          [2, 0, 3, 74], [2, 3, 1, 72],
          [3, 0, 1, 69], [3, 1, 1, 72], [3, 2, 2, 74],
          [4, 0, 1.5, 74], [4, 1.5, 0.5, 72], [4, 2, 1, 70], [4, 3, 1, 67],
          [5, 0, 2, 70], [5, 2, 1, 74], [5, 3, 1, 77],
          [6, 0, 3, 76], [6, 3, 1, 73],
          [7, 0, 2, 69], [7, 2, 2, 64],
        ],
      },
    },
  },
  boss: {
    title: 'Heart of Cinders', bpm: 140, seed: 0xc1d3, order: 'hold', start: 'A',
    sections: {
      A: { // phase 1
        prog: ['Cm', 'Db', 'Cm', 'Db', 'Ab', 'Bbm', 'Db', 'Cm'],
        bass: [0, 0, 12, 0, 0, 12, 7, 12], bassVel: [1, 0.5, 0.75, 0.5, 0.95, 0.75, 0.6, 0.75],
        drums: [1, 0.25, 0.3, 0.6, 0.9, 0.25, 0.6, 0.35],
        harp: { step: 0.5, pat: [0, 2, 1, 3, 2, 4, 3, 1], vel: 0.46 },
        melody: [
          [0, 0, 2, 72], [0, 2, 1, 73], [0, 3, 1, 72],
          [1, 0, 3, 68], [1, 3, 1, 70],
          [2, 0, 2, 67], [2, 2, 2, 63],
          [3, 0, 4, 65],
          [4, 0, 2, 72], [4, 2, 1, 75], [4, 3, 1, 72],
          [5, 0, 2, 73], [5, 2, 2, 70],
          [6, 0, 1, 68], [6, 1, 1, 70], [6, 2, 1, 72], [6, 3, 1, 73],
          [7, 0, 4, 72],
        ],
      },
      B: { // phases 2–3
        prog: ['Cm', 'Cm', 'Db', 'Db', 'Fm', 'Ab', 'Db', 'C5'],
        bass: [0, 12, 0, 12, 0, 12, 7, 12], bassVel: [1, 0.7, 0.85, 0.7, 1, 0.7, 0.85, 0.8],
        drums: [1, 0.5, 0.7, 0.5, 1, 0.5, 0.8, 0.9],
        harp: { step: 0.25, pat: [0, 2, 4, 5, 3, 1, 2, 4, 5, 4, 2, 3, 1, 2, 4, 3], vel: 0.4 },
        fill: true,
        melody: [
          [0, 0, 1, 75], [0, 1, 1, 73], [0, 2, 2, 72],
          [1, 0, 1.5, 79], [1, 1.5, 0.5, 77], [1, 2, 2, 75],
          [2, 0, 2, 77], [2, 2, 2, 80],
          [3, 0, 3, 77], [3, 3, 1, 73],
          [4, 0, 2, 77], [4, 2, 1, 75], [4, 3, 1, 72],
          [5, 0, 2, 75], [5, 2, 2, 72],
          [6, 0, 1, 73], [6, 1, 1, 75], [6, 2, 1, 77], [6, 3, 1, 80],
          [7, 0, 4, 79],
        ],
      },
    },
  },
};

/**
 * The sections of Vanquish's tracks (their scores live in vanquish/Scores.js, behind
 * VanquishAudio.js): `setMusicSection` checks a name against them before the module arrives.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const SCORE_SECTIONS = Object.freeze({
  dread: ['A', 'B'], siege: ['A', 'B'], ascent: ['A', 'B'], dragon: ['A', 'B', 'C'], festival: ['A', 'B'], triumph: ['A', 'B'],
});

/**
 * Vanquish the Evil Dragon's audio module (VanquishAudio.js: the sound recipes and their renders,
 * the crowd / blaze ambience, and the door to vanquish/ — the scores, their instruments, the
 * music's renders), imported the first time a Vanquish track, sound or layer is asked for — a
 * level that uses none of them never fetches it. One for every AudioSystem; `VQ` once it has
 * arrived.
 * @type {Promise<typeof import('./VanquishAudio.js')>|null}
 */
let vqImport = null;
/** @type {typeof import('./VanquishAudio.js')|null} */
let VQ = null;

/** Import Vanquish's audio module (once). */
function loadVq() {
  vqImport ??= import('./VanquishAudio.js').then((m) => (VQ = m));
  return vqImport;
}

/**
 * The Bells of Evermere's audio pack (EvermereAudio.js: its bells, scores, sounds and layers, on the
 * score kit it shares with Vanquish — vanquish/ScoreKit, ScoreVoices, RenderKit, MusicRenders, a
 * chunk of their own), imported the first time an Evermere track, sound or layer is asked for, like
 * Vanquish's: neither campaign fetches the other's scores or recipes. `EV` once it has arrived.
 * @type {Promise<typeof import('./EvermereAudio.js')>|null}
 */
let evImport = null;
/** @type {typeof import('./EvermereAudio.js')|null} */
let EV = null;

/** Import Evermere's audio pack (once). */
function loadEv() {
  evImport ??= import('./EvermereAudio.js').then((m) => (EV = m));
  return evImport;
}

/**
 * The pack a score track belongs to (`'vq'` Vanquish's, `'ev'` Evermere's) or null: a track that
 * renders nothing (the song, the combat tracks).
 * @param {string} t
 * @returns {'vq'|'ev'|null}
 */
const packOf = (t) => (Object.hasOwn(SCORE_SECTIONS, t) ? 'vq' : EV_MUSIC_TRACKS.includes(t) ? 'ev' : null);
/** A pack's module once it has arrived (null before). @param {'vq'|'ev'} p */
const packMod = (p) => (p === 'ev' ? EV : VQ);
/** What a campaign's pack that failed to load or prime logs. */
const PACK_ERROR = '[AudioSystem] campaign audio:';
/** Import a pack (once). @param {'vq'|'ev'} p */
const loadPack = (p) => (p === 'ev' ? loadEv() : loadVq());
/**
 * A track name without the section it may carry ('hushedking.rest' → 'hushedking': `startMusic`).
 * @param {string} t
 */
const trackOf = (t) => t.split('.')[0];

/**
 * What each owner wants kept (`retainMusic`) while a pack is still on its way — per pack the
 * latest wish per owner, handed over when it arrives (an earlier wish never overtakes a later
 * release).
 * @type {Map<'level'|'next'|'story', string[]>}
 */
const pendingRetains = new Map();
/** @type {Record<'vq'|'ev', Map<'level'|'next'|'story', string[]>>} */
const PENDING = { vq: pendingRetains, ev: new Map() };

/**
 * Which section each part of play takes on a track that has them (CombatMusic,
 * DRAGON_CAMPAIGN.md §6.9): `explore` (the level's track) and `battle` (a fight) — on one track,
 * the fight moves to its section at the next bar instead of crossfading —, and `phases` (the boss
 * fight's phase 1, 2, 3 …; the last entry holds for later phases). A track without an entry — the
 * default song, 'battle', 'boss', and the tracks played whole ('dread', 'festival', 'triumph') —
 * keeps CombatMusic's own behaviour. (The Bells of Evermere's role sections are CombatMusic's own
 * table, `EV_ROLE_SECTIONS`: the combat chunk's, not the game chunk's.)
 * @type {Readonly<Record<string, Readonly<{ explore: string, battle: string, phases: readonly string[] }>>>}
 */
export const MUSIC_ROLE_SECTIONS = Object.freeze({
  siege: Object.freeze({ explore: 'A', battle: 'B', phases: Object.freeze(['B']) }),
  ascent: Object.freeze({ explore: 'A', battle: 'B', phases: Object.freeze(['B']) }),
  dragon: Object.freeze({ explore: 'A', battle: 'A', phases: Object.freeze(['A', 'B', 'C']) }),
});

/**
 * Build one combat-track section's sorted event list (pad, bass, taiko, harp, flute).
 * @param {{ prog: string[], bass: number[], bassVel: number[], drums: number[], fill?: boolean,
 *   harp: { step: number, pat: number[], vel: number }, melody?: number[][] }} sec a COMBAT_TRACKS
 *   section (melody rows: [bar, beat, dur, midi])
 * @param {() => number} rng
 * @returns {{ events: any[], lengthBeats: number }}
 */
function buildCombatSection(sec, rng) {
  const events = [];
  const bars = sec.prog.length;
  sec.prog.forEach((name, bar) => {
    const ch = COMBAT_CHORDS[name];
    const b0 = bar * 4;
    events.push({ beat: b0, kind: 'pad', notes: ch.pad, dur: 4 });
    for (let i = 0; i < 8; i++) {
      events.push({ beat: b0 + i * 0.5, kind: 'bass', midi: ch.bass + sec.bass[i], dur: 0.4, vel: sec.bassVel[i] * (0.92 + rng() * 0.16) });
      const dv = sec.drums[i];
      const fillBar = sec.fill && bar === bars - 1 && i >= 4;
      if (dv > 0 && !fillBar) events.push({ beat: b0 + i * 0.5, kind: 'taiko', big: i % 4 === 0, vel: dv * (0.9 + rng() * 0.15) });
    }
    if (sec.fill && bar === bars - 1) {
      // 16th-note fill over beats 3–4, crescendo into the next section
      for (let k = 0; k < 8; k++) events.push({ beat: b0 + 2 + k * 0.25, kind: 'taiko', big: k === 0 || k === 7, vel: 0.35 + k * 0.09 + rng() * 0.05 });
    }
    const hp = sec.harp;
    const n = Math.round(4 / hp.step);
    for (let i = 0; i < n; i++) {
      const idx = hp.pat[i % hp.pat.length];
      events.push({
        beat: b0 + i * hp.step,
        kind: 'harp',
        midi: ch.arp[idx],
        vel: hp.vel * (i % (n / 4) === 0 ? 1.25 : 1) * (0.88 + rng() * 0.24),
        pan: -0.35 + (idx / 5) * 0.7,
        jitter: (rng() - 0.5) * 0.008,
      });
    }
  });
  for (const [bar, beat, dur, midi] of sec.melody ?? []) {
    events.push({ beat: bar * 4 + beat, kind: 'flute', midi, dur, vel: 0.8 + rng() * 0.15 });
  }
  events.sort((a, b) => a.beat - b.beat);
  return { events, lengthBeats: bars * 4 };
}

/**
 * Stingers: short scored phrases played over the music (`playStinger`). `bpm`, events in beats:
 * harp plucks, pad chords, flute notes and a final bell.
 */
function buildStinger(name) {
  const rng = mulberry32(name === 'victory' ? 0x51c7 : 0x1e7e1);
  const events = [];
  if (name === 'victory') {
    // D major fanfare, 4 bars at 108 bpm: D · G · A · D, rising harp rolls, flute line, bell
    const bars = [
      { pad: [50, 57, 62, 66], arp: [50, 57, 62, 66, 69, 74] },
      { pad: [50, 55, 59, 62], arp: [43, 50, 55, 59, 62, 67] },
      { pad: [49, 52, 57, 61], arp: [45, 52, 57, 61, 64, 69] },
      { pad: [50, 57, 62, 66], arp: [38, 50, 57, 62, 66, 69] },
    ];
    const ROLL = [0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 4, 5];
    bars.forEach((b, bar) => {
      const b0 = bar * 4;
      events.push({ beat: b0, kind: 'pad', notes: b.pad, dur: bar === 3 ? 6 : 4 });
      const n = bar === 3 ? 6 : 12;
      for (let i = 0; i < n; i++) {
        const idx = bar === 3 ? i : ROLL[i];
        events.push({ beat: b0 + i / 3, kind: 'harp', midi: b.arp[idx], vel: (i % 3 === 0 ? 0.7 : 0.5) * (0.9 + rng() * 0.2), pan: -0.35 + (idx / 5) * 0.7 });
      }
    });
    for (const [bar, beat, dur, midi] of [
      [0, 0, 1, 74], [0, 1, 1, 78], [0, 2, 2, 81],
      [1, 0, 1.5, 83], [1, 1.5, 0.5, 81], [1, 2, 2, 79],
      [2, 0, 1, 78], [2, 1, 1, 76], [2, 2, 2, 73],
      [3, 0, 4, 74],
    ]) events.push({ beat: bar * 4 + beat, kind: 'flute', midi, dur, vel: 0.9 });
    events.push({ beat: 12, kind: 'bell', midi: 86, vel: 0.12 });
    events.push({ beat: 12.25, kind: 'bell', midi: 93, vel: 0.1 });
    return { bpm: 108, events: events.sort((a, b) => a.beat - b.beat), lengthBeats: 16, rng: mulberry32(0x51c8) };
  }
  // levelup: a quick rising D-major harp arpeggio and a bell pair
  [62, 66, 69, 74, 78, 81, 86].forEach((m, i) => events.push({ beat: i * 0.25, kind: 'harp', midi: m, vel: 0.65 + i * 0.03, pan: -0.4 + i * 0.13 }));
  events.push({ beat: 0, kind: 'pad', notes: [50, 57, 62, 66], dur: 3 });
  events.push({ beat: 1.75, kind: 'bell', midi: 93, vel: 0.13 });
  events.push({ beat: 1.9, kind: 'bell', midi: 98, vel: 0.1 });
  return { bpm: 120, events, lengthBeats: 4, rng: mulberry32(0x1e7e2) };
}

/**
 * A combat track built once by `_combatTrack`: tempo, section order and the sections' events.
 * @typedef {object} CombatTrack
 * @property {string} name
 * @property {string} title
 * @property {number} bpm
 * @property {string} order
 * @property {string} start
 * @property {Record<string, { events: any[], lengthBeats: number, bpm?: number, bpb?: number, issues?: string[] }>} sections
 *   (a score track's sections carry their tempo and beats per bar)
 * @property {() => number} rng
 * @property {import('./VanquishAudio.js').ScoreTrackDef} [score] the score track's definition (Vanquish's and Evermere's tracks)
 */
/**
 * A stereo panner from `_panner`, with its optional reverb send (disconnected with it).
 * @typedef {StereoPannerNode & { _send?: GainNode }} SfxPanner
 */

export class AudioSystem {
  /**
   * @param {{ volume?: number, musicVolume?: number, sfxVolume?: number, ambienceVolume?: number,
   *           reverb?: number, suspendWhenHidden?: boolean, bpm?: number,
   *           context?: AudioContext | OfflineAudioContext }} [opts]
   *   volume: master volume 0..1 (0.6); musicVolume (0.5), sfxVolume (0.85), ambienceVolume (0.7);
   *   reverb: global reverb return (0.32); suspendWhenHidden: pause the context in hidden tabs (true);
   *   context: use this (Offline)AudioContext instead of creating one in unlock() — e.g. to
   *   render the soundtrack offline for tests (see `prescheduleOffline`).
   */
  constructor({ volume = 0.6, musicVolume = 0.5, sfxVolume = 0.85, ambienceVolume = 0.7, reverb = 0.32, suspendWhenHidden = true, bpm = 72, context = null } = {}) {
    /** @type {AudioContext | OfflineAudioContext | null} */
    this.ctx = null;
    this._providedContext = context;
    this._offline = typeof OfflineAudioContext !== 'undefined' && context instanceof OfflineAudioContext;
    this._volume = clamp(volume, 0, 1);
    this._muted = false;
    this._musicVolume = musicVolume;
    this._sfxVolume = sfxVolume;
    this._ambienceVolume = ambienceVolume;
    this._reverbAmount = reverb;
    this._suspendWhenHidden = suspendWhenHidden;
    this.bpm = bpm;

    this._rng = mulberry32(0x5eed1);
    this._ambTargets = { wind: 0, birds: 0, crickets: 0, fire: 0, water: 0, crowd: 0, blaze: 0 };
    this._ambFade = 2.5;
    this._layers = {};
    this._musicWanted = false;
    /** the last music wish was a stop (`stopMusic`), no start since: `musicStopped` */
    this._musicStopped = false;
    /** @type {any} the playing instance: the song's, a combat track's or a score track's (null: none) */
    this._music = null;
    /** @type {Record<string, number>} last start time by sfx name (no prototype: a well's `sfx` is level data) */
    this._lastSfx = Object.create(null);
    this._voices = 0;
    this._harpCache = new Map();
    this._timer = null;
    this._disposed = false;
    this._hiddenSuspended = false;
    this._stepSide = 1;

    this._intro = buildSection(['Dm', 'Dm'], null, 11);
    this._main = buildSection([...PROGRESSION_A, ...PROGRESSION_B], MELODY, 23);

    // combat additions (COMBAT.md §12) — all lazy / opt-in; none of them touches `_rng`
    /** Last requested track: `startMusic()` without a track, unlock and `toggleMusic` restart it. */
    this._musicTrackWanted = 'emberfall';
    /** Section requested for the wanted track ('A' | 'B' | null), kept across restarts of that track. */
    this._sectionWanted = null;
    /** @type {Map<string, CombatTrack>} combat tracks, built on first use */
    this._tracks = new Map();
    /** @type {Map<string, ReturnType<typeof buildStinger>>} stingers, built on first use */
    this._stingers = new Map();
    /** Seeded RNG of the combat SFX (their noise offsets and tiny variations). */
    this._crng = mulberry32(0xc0ba7);
    /** Shared stereo panners of the combat SFX ({ dry, wet } × 9 positions), created on first use. */
    this._cPan = null;
    /** High-passed brown noise of the combat rumbles (`_combatBrown`), created on first use. */
    this._cBrown = null;
    this._warnedMusic = null;
    // Vanquish the Evil Dragon's sounds and ambience voices (DRAGON_CAMPAIGN.md §6.9) — lazy
    /** Seeded RNG of the VQ sounds and the crowd / blaze layers (variants, jitter, scheduling). */
    this._vrng = mulberry32(0x7a6e5);
    /** Whether this system asked for every VQ render (`_packPrime`). */
    this._vqPrimed = false;
    /**
     * A Vanquish track `startMusic` waits for (its rendered music: `primeMusic`) and since when
     * (performance.now()), or null; the wait of the last one started (ms: `vqRenders.music.waitMs`).
     * @type {{ track: string, t0: number }|null}
     */
    this._musicGate = null;
    this._musicWaitMs = 0;
    /** A track whose renders failed: it starts anyway, once (its missing notes are skipped and counted). */
    this._musicGo = null;
    /** @type {Set<string>} tracks whose failed renders were reported */
    this._musicFailed = new Set();
    /** Whether this system asked for every Evermere render (`_packPrime`; EVERMERE_CAMPAIGN.md §6.8). */
    this._evPrimed = false;

    this._tick = this._tick.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create (first call) and resume the AudioContext. Call from a user gesture (click / key).
   * Safe to call repeatedly.
   * @returns {Promise<boolean>} resolves to `ready`
   */
  unlock() {
    if (this._disposed) return Promise.resolve(false);
    if (!this.ctx) {
      if (this._providedContext) {
        this.ctx = this._providedContext;
      } else {
        const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
        if (!AC) return Promise.resolve(false);
        try {
          this.ctx = new AC({ latencyHint: 'interactive' });
        } catch (err) {
          console.warn('[AudioSystem] could not create AudioContext:', err);
          return Promise.resolve(false);
        }
      }
      this._build();
    }
    const ctx = this.ctx;
    if (this._offline) return Promise.resolve(true);
    const p = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
    return p.then(() => this.ready).catch(() => false);
  }

  /** True once the AudioContext exists and is running. */
  get ready() {
    return !!this.ctx && !this._disposed && (this._offline || this.ctx.state === 'running');
  }

  /** Master volume 0..1. */
  get masterVolume() {
    return this._volume;
  }

  set masterVolume(v) {
    this._volume = clamp(Number(v) || 0, 0, 1);
    this._applyMaster();
  }

  /** Mute everything (keeps playing silently). */
  get muted() {
    return this._muted;
  }

  set muted(v) {
    this._muted = !!v;
    this._applyMaster();
  }

  /** Music bus volume 0..1. */
  get musicVolume() {
    return this._musicVolume;
  }

  set musicVolume(v) {
    this._musicVolume = clamp(Number(v) || 0, 0, 1);
    if (this._buses) this._buses.music.gain.setTargetAtTime(this._musicVolume * BUS_TRIM.music, this.ctx.currentTime, 0.05);
  }

  /** SFX bus volume 0..1. */
  get sfxVolume() {
    return this._sfxVolume;
  }

  set sfxVolume(v) {
    this._sfxVolume = clamp(Number(v) || 0, 0, 1);
    if (this._buses) this._buses.sfx.gain.setTargetAtTime(this._sfxVolume * BUS_TRIM.sfx, this.ctx.currentTime, 0.05);
  }

  /** Ambience bus volume 0..1. */
  get ambienceVolume() {
    return this._ambienceVolume;
  }

  set ambienceVolume(v) {
    this._ambienceVolume = clamp(Number(v) || 0, 0, 1);
    if (this._buses) this._buses.amb.gain.setTargetAtTime(this._ambienceVolume * BUS_TRIM.amb, this.ctx.currentTime, 0.05);
  }

  /** Current ambience targets (copy). */
  get ambience() {
    return { ...this._ambTargets };
  }

  /** Per-frame hook (engine-system compatible). Runs the scheduler and housekeeping. */
  update(dt) {
    if (this.ctx && !this._disposed) this._tick();
  }

  /** Stop everything and close the AudioContext. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._timer !== null) clearInterval(this._timer);
    this._timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibility);
    if (this.ctx) {
      for (const name of Object.keys(this._layers)) this._destroyLayer(name);
      // (the playing track's faders down and its modulators stopped: the stop path, at once)
      if (this._music) this._stopInstance(this._music, 0.05);
      this._music = null;
      // (closed only when this system created it, and then it is a live AudioContext)
      const ctx = /** @type {AudioContext} */ (this.ctx);
      try {
        this._master.disconnect();
      } catch {
        /* already disconnected */
      }
      if (!this._offline && !this._providedContext && typeof ctx.close === 'function') ctx.close().catch(() => {});
    }
    this._harpCache.clear();
    this.ctx = null;
    this._buses = null;
  }

  // ---------------------------------------------------------------------------
  // SFX
  // ---------------------------------------------------------------------------

  /**
   * Play a one-shot sound effect.
   * @param {SfxName} name one of SFX_NAMES, COMBAT_SFX_NAMES, VQ_SFX_NAMES or EV_SFX_NAMES
   * @param {{ volume?: number, pitch?: number, pan?: number, delay?: number }} [opts]
   *   volume multiplier (1), pitch frequency ratio (1), pan −1..1, delay seconds
   * @returns {boolean} whether a sound was started
   */
  playSfx(name, { volume = 1, pitch = 1, pan = 0, delay = 0 } = {}) {
    if (!this.ready || this._disposed) return false;
    const now = this.ctx.currentTime;
    const t = now + 0.005 + Math.max(0, delay);
    const last = this._lastSfx[name] ?? -1;
    if (Math.abs(t - last) < (ownValue(SFX_MIN_INTERVAL, name) ?? 0.02)) return false;
    if (this._voices > MAX_VOICES) return false;
    this._lastSfx[name] = t;
    const v = Math.max(0, volume);
    const p = Math.max(0.05, pitch);
    switch (name) {
      case 'step': this._sfxStep(t, v, p, pan); break;
      case 'blip': this._sfxBlip(t, v, p, pan); break;
      case 'confirm': this._sfxConfirm(t, v, p, pan); break;
      case 'cancel': this._sfxCancel(t, v, p, pan); break;
      case 'open': this._sfxGliss(t, v, p, pan, true); break;
      case 'close': this._sfxGliss(t, v, p, pan, false); break;
      case 'chime': this._sfxChime(t, v, p, pan); break;
      case 'splash': this._sfxSplash(t, v, p, pan); break;
      default:
        if (COMBAT_SFX.has(name)) {
          this._sfxCombat(name, t, v, p, pan);
          break;
        }
        // (a campaign's sound: Vanquish's or Evermere's pack)
        if (VQ_SFX.has(name) || EV_SFX.has(name)) {
          this._sfxPack(VQ_SFX.has(name) ? 'vq' : 'ev', name, t, v, p, pan);
          break;
        }
        if (!this._warnedSfx?.has(name)) {
          (this._warnedSfx ??= new Set()).add(name);
          console.warn(`[AudioSystem] unknown sfx "${name}"`);
        }
        return false;
    }
    return true;
  }

  _sfxStep(t, vol, pitch, pan) {
    const ctx = this.ctx;
    const r = this._rng;
    const rate = pitch * (0.82 + r() * 0.36);
    this._stepSide = -this._stepSide;
    const out = this._panner(clamp(pan + this._stepSide * 0.12, -1, 1), this._buses.sfx);

    // Crunchy noise tick.
    const src = this._noiseSource(this._white, t, r() * 1.5);
    const bp = this._biquad('bandpass', 1050 * rate, 0.9);
    const hp = this._biquad('highpass', 280, 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32 * vol, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.006, 0.02);
    src.connect(bp).connect(hp).connect(g).connect(out);
    // (both voices stop together — the cleanup follows `src` — once the thump has decayed 60 dB:
    // 0.14 cut it 45 dB under the peak, a faint click, KNOWN_ISSUES AUD-06)
    src.stop(t + 0.2);

    // Soft body thump.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(125 * rate, t);
    o.frequency.exponentialRampToValueAtTime(58 * rate, t + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.22 * vol, t + 0.004);
    og.gain.setTargetAtTime(0, t + 0.01, 0.025);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + 0.2);
    this._cleanup(src, [src, bp, hp, g, o, og, out]);
  }

  _sfxBlip(t, vol, pitch, pan) {
    const ctx = this.ctx;
    const f = 1150 * pitch * (1 + (this._rng() - 0.5) * 0.05);
    const out = this._panner(pan, this._buses.sfx);
    const lp = this._biquad('lowpass', 2600, 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.085 * vol, t + 0.002);
    g.gain.setTargetAtTime(0, t + 0.004, 0.011);
    const a = ctx.createOscillator();
    a.type = 'triangle';
    a.frequency.value = f;
    const b = ctx.createOscillator();
    b.type = 'square';
    b.frequency.value = f * 0.5;
    const bg = ctx.createGain();
    bg.gain.value = 0.22;
    a.connect(lp);
    b.connect(bg).connect(lp);
    lp.connect(g).connect(out);
    a.start(t);
    b.start(t);
    // (stopped once the envelope has decayed ≈ 68 dB: 0.07 cut it 50 dB under the peak, AUD-06)
    a.stop(t + 0.09);
    b.stop(t + 0.09);
    this._cleanup(a, [a, b, bg, lp, g, out]);
  }

  _sfxConfirm(t, vol, pitch, pan) {
    const out = this._panner(pan, this._buses.sfx, 0.35);
    this._bell(t, mtof(81) * pitch, 0.2 * vol, 0.9, out);
    this._bell(t + 0.075, mtof(88) * pitch, 0.18 * vol, 1.2, out);
    this._later(out, t, 2.0);
  }

  _sfxCancel(t, vol, pitch, pan) {
    const ctx = this.ctx;
    const out = this._panner(pan, this._buses.sfx, 0.15);
    const notes = [76, 69];
    notes.forEach((m, i) => {
      const tt = t + i * 0.075;
      const f = mtof(m) * pitch;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, tt);
      o.frequency.exponentialRampToValueAtTime(f * 0.96, tt + 0.14);
      const lp = this._biquad('lowpass', 1900, 0.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.16 * vol, tt + 0.005);
      g.gain.setTargetAtTime(0, tt + 0.02, 0.05);
      o.connect(lp).connect(g).connect(out);
      o.start(tt);
      o.stop(tt + 0.35);
      this._cleanup(o, [o, lp, g]);
    });
    this._later(out, t, 1.0);
  }

  _sfxGliss(t, vol, pitch, pan, up) {
    const out = this._panner(pan, this._buses.sfx, 0.4);
    const scale = [62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79];
    const seq = up ? scale.slice(2) : scale.slice(0, 9).reverse();
    const shift = Math.round(12 * Math.log2(pitch));
    seq.forEach((m, i) => {
      const vel = (0.26 - i * 0.012) * vol;
      const sweep = (i / (seq.length - 1) - 0.5) * 0.8 * (up ? 1 : -1);
      this._pluck(t + i * 0.034, m + shift, vel, sweep, out);
    });
    this._later(out, t, 3.2);
  }

  _sfxChime(t, vol, pitch, pan) {
    const out = this._panner(pan, this._buses.sfx, 0.6);
    const notes = [86, 90, 93, 98];
    notes.forEach((m, i) => this._bell(t + i * 0.068, mtof(m) * pitch, (0.11 - i * 0.012) * vol, 1.4, out));
    // Airy sparkle on top.
    const ctx = this.ctx;
    for (let i = 0; i < 5; i++) {
      const tt = t + 0.05 + i * 0.05 + this._rng() * 0.03;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 4200 + this._rng() * 2600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.018 * vol, tt + 0.004);
      g.gain.setTargetAtTime(0, tt + 0.008, 0.05);
      o.connect(g).connect(out);
      o.start(tt);
      o.stop(tt + 0.4);
      this._cleanup(o, [o, g]);
    }
    this._later(out, t, 2.5);
  }

  _sfxSplash(t, vol, pitch, pan) {
    const ctx = this.ctx;
    const r = this._rng;
    const out = this._panner(pan, this._buses.sfx, 0.25);
    const src = this._noiseSource(this._white, t, r() * 1.2);
    const lp = this._biquad('lowpass', 6500 * pitch, 0.9);
    lp.frequency.setValueAtTime(6500 * pitch, t);
    lp.frequency.exponentialRampToValueAtTime(380 * pitch, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.42 * vol, t + 0.01);
    g.gain.setTargetAtTime(0, t + 0.04, 0.13);
    src.connect(lp).connect(g).connect(out);
    src.stop(t + 0.9);
    this._cleanup(src, [src, lp, g]);
    // Droplets.
    for (let i = 0; i < 6; i++) {
      const tt = t + 0.06 + r() * 0.4;
      const f = (650 + r() * 900) * pitch;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, tt);
      o.frequency.exponentialRampToValueAtTime(f * 1.9, tt + 0.045);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, tt);
      og.gain.linearRampToValueAtTime((0.03 + r() * 0.04) * vol, tt + 0.004);
      og.gain.setTargetAtTime(0, tt + 0.02, 0.015);
      o.connect(og).connect(out);
      o.start(tt);
      o.stop(tt + 0.12);
      this._cleanup(o, [o, og]);
    }
    this._later(out, t, 1.6);
  }

  /** Inharmonic bell: a few decaying sine partials. */
  _bell(t, f, amp, decay, out) {
    const ctx = this.ctx;
    const partials = [[1, 1, 1], [2.0, 0.32, 0.6], [2.76, 0.2, 0.45], [5.4, 0.07, 0.25]];
    const g = ctx.createGain();
    g.gain.value = amp;
    g.connect(out);
    /** @type {AudioNode[]} */
    const nodes = [g];
    let first = null;
    for (const [ratio, a, dk] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * ratio;
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(0, t);
      pg.gain.linearRampToValueAtTime(a, t + 0.003);
      pg.gain.setTargetAtTime(0, t + 0.004, (decay * dk) / 4);
      o.connect(pg).connect(g);
      o.start(t);
      o.stop(t + decay * dk * 1.4 + 0.1);
      nodes.push(o, pg);
      first ??= o;
    }
    this._cleanup(first, nodes);
  }

  // ---------------------------------------------------------------------------
  // Combat SFX (COMBAT.md §12.1)
  // ---------------------------------------------------------------------------

  /**
   * Shared panner for combat voices: 9 fixed positions (−0.8 … 0.8 in 0.2 steps) per bank, the
   * `wet` bank also feeding the reverb. Created on the first combat sound, so peaceful levels never
   * build it and every combat voice stays within 6 nodes of its own.
   */
  _combatOut(pan, wet) {
    if (!this._cPan) {
      const ctx = this.ctx;
      const send = ctx.createGain();
      send.gain.value = 0.35;
      send.connect(this._reverbIn);
      const bank = (withSend) => Array.from({ length: 9 }, (_, k) => {
        const p = ctx.createStereoPanner();
        p.pan.value = -0.8 + k * 0.2;
        p.connect(this._buses.sfx);
        if (withSend) p.connect(send);
        return p;
      });
      this._cPan = { dry: bank(false), wet: bank(true) };
    }
    const k = Math.round((clamp(pan, -0.8, 0.8) + 0.8) / 0.2);
    return (wet ? this._cPan.wet : this._cPan.dry)[k];
  }

  /**
   * Rumble noise of the combat SFX (built on first use): brown noise like `_brown`, from its own
   * seed, with everything below ~35 Hz removed. A random stretch of plain brown noise carries a
   * slowly drifting offset: DC and sub-bass that small speakers cannot play and that only drives
   * the master compressor. 2 s, a seamless loop (each filter runs twice around it).
   */
  _combatBrown() {
    if (this._cBrown) return this._cBrown;
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 2);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const rng = mulberry32(0xb20b);
    const w = new Float32Array(len);
    for (let i = 0; i < len; i++) w[i] = rng() * 2 - 1;
    let y = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < len; i++) {
        y = (y + 0.02 * w[i]) / 1.02; // the same leaky integrator as `_brown`
        d[i] = y * 3.5;
      }
    }
    const a = Math.exp((-2 * Math.PI * 35) / sr); // two one-pole high-passes at 35 Hz
    for (let stage = 0; stage < 2; stage++) {
      let x1 = d[len - 1];
      let hp = 0;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < len; i++) {
          const x = d[i];
          hp = a * (hp + x - x1);
          x1 = x;
          if (pass) w[i] = hp;
        }
      }
      d.set(w);
    }
    this._cBrown = buf;
    return buf;
  }

  /**
   * One combat sound: small seeded synths (noise bursts through swept filters, pitch-dropping sine
   * thumps, triangle rings) built from ≤ 6 nodes each; punchy transients, soft tops (no raw square
   * waves, highs band-limited). Levels are matched per role against the song's loudness and every
   * voice stops only after its envelope is ≥ 60 dB down (the QA in `sandbox/combat_audio.html`:
   * momentary loudness, true peak, truncation, gain steps, 2–6 kHz and sub-bass; COMBAT-11).
   */
  _sfxCombat(name, t, v, p, pan) {
    const ctx = this.ctx;
    const r = this._crng;
    const out = this._combatOut(pan, COMBAT_WET.has(name));
    const nodes = [];
    let last = null;
    let end = -Infinity;
    const osc = (type, f0, f1 = f0, dur = 0.1, at = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0 * p, t + at);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1 * p, t + at + dur);
      o.start(t + at);
      nodes.push(o);
      return o;
    };
    const noise = (at = 0, buffer = this._white) => {
      const s = this._noiseSource(buffer, t + at, r() * 1.9);
      nodes.push(s);
      return s;
    };
    const filt = (type, f, q) => {
      const b = this._biquad(type, f * p, q);
      nodes.push(b);
      return b;
    };
    /**
     * Gain with a linear attack and an exponential (τ) decay after an optional hold. It starts
     * silent: a GainNode defaults to 1, and a source that starts before `at` would sound at full
     * gain until the envelope's first event.
     */
    const env = (peak, at, attack, tau, hold = 0) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(peak * v, t + at + attack);
      g.gain.setTargetAtTime(0, t + at + attack + hold, tau);
      nodes.push(g);
      return g;
    };
    const gain = () => {
      const g = ctx.createGain();
      g.gain.value = 0;
      nodes.push(g);
      return g;
    };
    /**
     * Short gain bump at `at` (for multi-hit envelopes on one gain node). A re-trigger first
     * releases a still-ringing bump over ~6 ms (τ 1.2 ms), so the restart from 0 does not click.
     */
    const bump = (g, at, peak, attack, tau) => {
      if (at > 0.006) g.gain.setTargetAtTime(0, t + at - 0.006, 0.0012);
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(peak * v, t + at + attack);
      g.gain.setTargetAtTime(0, t + at + attack, tau);
    };
    const sweep = (param, pts) => {
      param.setValueAtTime(pts[0][1] * p, t + pts[0][0]);
      for (let i = 1; i < pts.length; i++) param.exponentialRampToValueAtTime(pts[i][1] * p, t + pts[i][0]);
    };
    const stop = (src, at) => {
      src.stop(t + at);
      if (t + at > end) {
        end = t + at;
        last = src;
      }
    };
    const jit = 1 + (r() - 0.5) * 0.05; // ±2.5 % seeded variation on top of the caller's pitch

    switch (name) {
      case 'swing': { // light blade whoosh + faint steel zing
        const n = noise();
        const bp = filt('bandpass', 700, 1.1);
        sweep(bp.frequency, [[0, 700 * jit], [0.07, 2600], [0.16, 1100]]);
        n.connect(bp).connect(env(0.55, 0, 0.02, 0.04)).connect(out);
        stop(n, 0.3);
        const o = osc('triangle', 1250 * jit, 1700, 0.08);
        o.connect(env(0.035, 0, 0.01, 0.03)).connect(out);
        stop(o, 0.2);
        break;
      }
      case 'swingHeavy': { // slower, lower whoosh with a sub body
        const n = noise();
        const bp = filt('bandpass', 400, 0.9);
        sweep(bp.frequency, [[0, 400 * jit], [0.12, 1800], [0.28, 700]]);
        n.connect(bp).connect(env(0.36, 0, 0.04, 0.07)).connect(out);
        stop(n, 0.55);
        const o = osc('sine', 110, 60, 0.25);
        o.connect(env(0.18, 0.02, 0.03, 0.08)).connect(out);
        stop(o, 0.62);
        break;
      }
      case 'hit': { // sine thump + filtered crack
        const o = osc('sine', 170 * jit, 52, 0.09);
        o.connect(env(0.55, 0, 0.003, 0.05)).connect(out);
        stop(o, 0.4);
        const n = noise();
        n.connect(filt('bandpass', 1700, 0.9)).connect(env(0.42, 0, 0.002, 0.018)).connect(out);
        stop(n, 0.15);
        break;
      }
      case 'crit': { // heavier thump, crack and a short metallic ring
        const o = osc('sine', 200 * jit, 48, 0.12);
        o.connect(env(0.6, 0, 0.003, 0.07)).connect(out);
        stop(o, 0.55);
        const ring = env(0.33, 0, 0.002, 0.09);
        const o2 = osc('triangle', 1480, 1380, 0.3);
        o2.connect(ring);
        const n = noise();
        n.connect(filt('bandpass', 2900, 6)).connect(ring);
        ring.connect(out);
        stop(n, 0.7);
        stop(o2, 0.7);
        break;
      }
      case 'hurt': { // dull body blow with a falling "oof" tone
        const body = env(0.42, 0, 0.004, 0.07);
        const o = osc('sine', 190 * jit, 70, 0.18);
        const o2 = osc('triangle', 280 * jit, 150, 0.2);
        o.connect(body);
        o2.connect(body);
        body.connect(out);
        stop(o, 0.5);
        stop(o2, 0.5);
        const n = noise();
        n.connect(filt('lowpass', 1100, 0.7)).connect(env(0.3, 0, 0.002, 0.04)).connect(out);
        stop(n, 0.25);
        break;
      }
      case 'dodge': { // airy roll whoosh, then a soft landing scuff
        const n = noise();
        const bp = filt('bandpass', 1800, 0.8);
        sweep(bp.frequency, [[0, 1800 * jit], [0.18, 700]]);
        n.connect(bp).connect(env(0.32, 0, 0.03, 0.05)).connect(out);
        stop(n, 0.4);
        const n2 = noise(0.22);
        n2.connect(filt('lowpass', 900, 0.7)).connect(env(0.2, 0.22, 0.005, 0.03)).connect(out);
        stop(n2, 0.45);
        break;
      }
      case 'perfect': { // perfect dodge: a high bell dyad over a descending "time slows" swish
        const bell = env(0.113, 0, 0.005, 0.35);
        const o = osc('sine', 1568);
        const o2 = osc('sine', 2349);
        o.connect(bell);
        o2.connect(bell);
        bell.connect(out);
        stop(o, 2.5);
        stop(o2, 2.5);
        const n = noise();
        const bp = filt('bandpass', 5000, 1.5);
        sweep(bp.frequency, [[0, 5000], [0.3, 1500]]);
        n.connect(bp).connect(env(0.113, 0, 0.02, 0.08)).connect(out);
        stop(n, 0.6);
        break;
      }
      case 'whirl': { // Whirl Slash: a whoosh whose band spins at 11 Hz
        const n = noise();
        const bp = filt('bandpass', 1300, 1.4);
        const lfo = osc('sine', 11 / p);
        const depth = ctx.createGain();
        depth.gain.value = 700 * p;
        nodes.push(depth);
        lfo.connect(depth).connect(bp.frequency);
        n.connect(bp).connect(env(0.34, 0, 0.05, 0.16, 0.2)).connect(out);
        stop(n, 1.4);
        stop(lfo, 1.4);
        break;
      }
      case 'bolt': { // Ember Bolt cast: fiery rising whoosh + a warm rising tone
        const n = noise();
        const lp = filt('lowpass', 600, 0.8);
        sweep(lp.frequency, [[0, 600], [0.12, 3500], [0.35, 1200]]);
        n.connect(lp).connect(env(0.45, 0, 0.01, 0.1)).connect(out);
        stop(n, 0.75);
        const o = osc('triangle', 260 * jit, 520, 0.15);
        o.connect(env(0.1, 0, 0.01, 0.08)).connect(out);
        stop(o, 0.6);
        break;
      }
      case 'boltHit': { // small fire burst
        const n = noise();
        n.connect(filt('bandpass', 1100, 0.7)).connect(env(0.4, 0, 0.002, 0.07)).connect(out);
        stop(n, 0.52);
        const o = osc('sine', 140 * jit, 55, 0.12);
        o.connect(env(0.35, 0, 0.003, 0.06)).connect(out);
        stop(o, 0.45);
        break;
      }
      case 'nova': { // Radiant Nova: deep boom, bright falling air and a D6 shimmer
        const o = osc('sine', 120, 40, 0.6);
        o.connect(env(0.28, 0, 0.005, 0.2)).connect(out);
        stop(o, 1.4);
        const air = env(0.18, 0, 0.004, 0.2);
        const n = noise();
        const lp = filt('lowpass', 6000, 0.7);
        sweep(lp.frequency, [[0, 6000], [0.7, 500]]);
        n.connect(lp).connect(air);
        const o2 = osc('sine', 1175);
        o2.connect(air);
        air.connect(out);
        stop(n, 1.4);
        stop(o2, 1.45);
        break;
      }
      case 'drink': { // three gulps, then a sparkle
        const o = osc('sine', 260);
        const f = o.frequency;
        f.exponentialRampToValueAtTime(420 * p, t + 0.07);
        f.setValueAtTime(240 * p, t + 0.16);
        f.exponentialRampToValueAtTime(400 * p, t + 0.23);
        f.setValueAtTime(250 * p, t + 0.32);
        f.exponentialRampToValueAtTime(440 * p, t + 0.39);
        const g = gain();
        for (const at of [0, 0.16, 0.32]) bump(g, at, 0.22, 0.012, 0.03);
        o.connect(filt('lowpass', 1200, 0.7)).connect(g).connect(out);
        stop(o, 0.6);
        const o2 = osc('sine', 1760, 2640, 0.2, 0.5);
        o2.connect(env(0.06, 0.5, 0.01, 0.15)).connect(out);
        stop(o2, 1.4);
        break;
      }
      case 'guard': { // blocked: metallic clank + click
        const g = env(0.3, 0, 0.002, 0.06);
        const o = osc('triangle', 760 * jit);
        const o2 = osc('triangle', 1190 * jit);
        o.connect(g);
        o2.connect(g);
        g.connect(out);
        stop(o, 0.45);
        stop(o2, 0.45);
        const n = noise();
        n.connect(filt('highpass', 3000, 0.7)).connect(env(0.12, 0, 0.001, 0.015)).connect(out);
        stop(n, 0.1);
        break;
      }
      case 'enemyAlert': { // "!" — two quick rising blips
        const o = osc('triangle', 880);
        o.frequency.setValueAtTime(1320 * p, t + 0.07);
        const g = gain();
        bump(g, 0, 0.18, 0.005, 0.025);
        bump(g, 0.07, 0.19, 0.005, 0.05);
        o.connect(filt('lowpass', 3000, 0.5)).connect(g).connect(out);
        stop(o, 0.45);
        break;
      }
      case 'windup': { // heavy wind-up: a charging whoosh and a rising rumble
        const n = noise();
        const bp = filt('bandpass', 300, 1.2);
        sweep(bp.frequency, [[0, 300], [0.35, 1400]]);
        const g = gain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.24 * v, t + 0.35);
        g.gain.setTargetAtTime(0, t + 0.35, 0.03);
        n.connect(bp).connect(g).connect(out);
        stop(n, 0.6);
        const o = osc('sine', 70, 120, 0.35);
        const og = gain();
        og.gain.setValueAtTime(0, t);
        og.gain.linearRampToValueAtTime(0.16 * v, t + 0.35);
        og.gain.setTargetAtTime(0, t + 0.35, 0.04);
        o.connect(og).connect(out);
        stop(o, 0.6);
        break;
      }
      case 'arrow': { // bow twang + a short whistle
        const o = osc('triangle', 196 * jit, 180, 0.12);
        o.connect(env(0.2, 0, 0.002, 0.04)).connect(out);
        stop(o, 0.3);
        const n = noise();
        const bp = filt('bandpass', 2600, 5);
        sweep(bp.frequency, [[0, 2600], [0.2, 3400]]);
        n.connect(bp).connect(env(0.12, 0.02, 0.02, 0.07)).connect(out);
        stop(n, 0.45);
        break;
      }
      case 'arrowHit': { // thunk
        const o = osc('sine', 260 * jit, 110, 0.06);
        o.connect(env(0.3, 0, 0.002, 0.03)).connect(out);
        stop(o, 0.2);
        const n = noise();
        n.connect(filt('bandpass', 900, 1)).connect(env(0.26, 0, 0.001, 0.015)).connect(out);
        stop(n, 0.12);
        break;
      }
      case 'hexBurst': { // Hex Flame eruption: roaring flame burst + low boom
        const n = noise();
        const lp = filt('lowpass', 400, 0.8);
        sweep(lp.frequency, [[0, 400], [0.08, 3200], [0.6, 700]]);
        n.connect(lp).connect(env(0.42, 0, 0.01, 0.15)).connect(out);
        stop(n, 1.0);
        const o = osc('sine', 90, 38, 0.35);
        o.connect(env(0.4, 0, 0.004, 0.12)).connect(out);
        stop(o, 0.8);
        break;
      }
      case 'slimeHop': { // squishy boing + squelch
        const o = osc('sine', 170 * jit, 420, 0.07);
        o.frequency.exponentialRampToValueAtTime(260 * p, t + 0.14);
        o.connect(filt('lowpass', 1400, 0.7)).connect(env(0.26, 0, 0.004, 0.05)).connect(out);
        stop(o, 0.35);
        const n = noise();
        n.connect(filt('lowpass', 500, 0.7)).connect(env(0.12, 0, 0.002, 0.03)).connect(out);
        stop(n, 0.2);
        break;
      }
      case 'batScreech': { // a thin FM chirp, band-limited
        const o = osc('sine', 3400 * jit, 2500, 0.14);
        const fm = osc('sine', 70);
        const depth = ctx.createGain();
        depth.gain.value = 420 * p;
        nodes.push(depth);
        fm.connect(depth).connect(o.frequency);
        o.connect(filt('bandpass', 2800, 1.2)).connect(env(0.11, 0, 0.004, 0.05)).connect(out);
        stop(o, 0.38);
        stop(fm, 0.38);
        break;
      }
      case 'boarSnort': { // two nasal snorts
        const n = noise();
        const g = gain();
        bump(g, 0, 0.34, 0.02, 0.05);
        bump(g, 0.18, 0.28, 0.02, 0.06);
        n.connect(filt('bandpass', 430, 3)).connect(g).connect(out);
        stop(n, 0.62);
        const o = osc('sine', 95 * jit, 70, 0.3);
        const og = gain();
        bump(og, 0, 0.18, 0.02, 0.05);
        bump(og, 0.18, 0.15, 0.02, 0.06);
        o.connect(og).connect(out);
        stop(o, 0.62);
        break;
      }
      case 'boarCharge': { // charge start: ground rumble + squeal
        const n = noise(0, this._combatBrown());
        n.connect(filt('lowpass', 320, 0.8)).connect(env(0.5, 0, 0.05, 0.25, 0.2)).connect(out);
        stop(n, 2.0);
        const o = osc('triangle', 520 * jit, 880, 0.25);
        o.connect(env(0.12, 0, 0.02, 0.08)).connect(out);
        stop(o, 0.6);
        break;
      }
      case 'stun': { // dizzy warble
        const o = osc('triangle', 1500 * jit);
        const lfo = osc('sine', 7 / p);
        const depth = ctx.createGain();
        depth.gain.value = 300 * p;
        nodes.push(depth);
        lfo.connect(depth).connect(o.frequency);
        o.connect(env(0.1, 0, 0.01, 0.18, 0.2)).connect(out);
        stop(o, 1.5);
        stop(lfo, 1.5);
        break;
      }
      case 'enemyDie': { // poof + descending blip
        const n = noise();
        const lp = filt('lowpass', 1600, 0.7);
        sweep(lp.frequency, [[0, 1600], [0.35, 300]]);
        n.connect(lp).connect(env(0.4, 0, 0.005, 0.1)).connect(out);
        stop(n, 0.65);
        const o = osc('triangle', 560 * jit, 140, 0.32);
        o.connect(env(0.19, 0, 0.005, 0.1)).connect(out);
        stop(o, 0.65);
        break;
      }
      case 'bossRoar': { // a long growl: saw + brown noise through a wobbling lowpass
        const lp = filt('lowpass', 450, 2);
        sweep(lp.frequency, [[0, 450], [0.3, 900], [1.3, 400]]);
        const o = osc('sawtooth', 64, 46, 1.3);
        const n = noise(0, this._combatBrown());
        o.connect(lp);
        n.connect(lp);
        const lfo = osc('sine', 13);
        const depth = ctx.createGain();
        depth.gain.value = 250;
        nodes.push(depth);
        lfo.connect(depth).connect(lp.frequency);
        lp.connect(env(0.26, 0, 0.15, 0.3, 0.8)).connect(out);
        stop(o, 3.1);
        stop(n, 3.1);
        stop(lfo, 3.1);
        break;
      }
      case 'slam': { // boss slam: a huge thud + falling debris air
        const o = osc('sine', 95, 32, 0.5);
        o.connect(env(0.49, 0, 0.004, 0.18)).connect(out);
        stop(o, 1.3);
        const n = noise();
        const lp = filt('lowpass', 2400, 0.7);
        sweep(lp.frequency, [[0, 2400], [0.5, 180]]);
        n.connect(lp).connect(env(0.35, 0, 0.002, 0.14)).connect(out);
        stop(n, 1.0);
        break;
      }
      case 'rockToss': { // heave: a low swoosh and a grunt-like tone
        const n = noise();
        const bp = filt('bandpass', 250, 1);
        sweep(bp.frequency, [[0, 250], [0.25, 900]]);
        n.connect(bp).connect(env(0.3, 0, 0.04, 0.08)).connect(out);
        stop(n, 0.62);
        const o = osc('sine', 70, 55, 0.2);
        o.connect(env(0.18, 0, 0.01, 0.08)).connect(out);
        stop(o, 0.62);
        break;
      }
      case 'gateClose': { // the ember wall roars up, then a stone thud
        const n = noise(0, this._combatBrown());
        const lp = filt('lowpass', 200, 0.9);
        sweep(lp.frequency, [[0, 200], [0.35, 2800], [1.0, 600]]);
        n.connect(lp).connect(env(0.44, 0, 0.3, 0.3)).connect(out);
        stop(n, 2.4);
        const o = osc('sine', 62, 45, 0.4, 0.3);
        o.connect(env(0.44, 0.3, 0.004, 0.2)).connect(out);
        stop(o, 1.75);
        break;
      }
      case 'pickup': { // two quick harp plucks (the song's harp)
        for (const [at, m] of [[0, 81], [0.07, 86]]) {
          const s = ctx.createBufferSource();
          s.buffer = this._harpBuffer(m);
          s.playbackRate.value = p;
          const g = ctx.createGain();
          g.gain.value = 0.3 * v;
          s.connect(g).connect(out);
          s.start(t + at);
          nodes.push(s, g);
          stop(s, at + s.buffer.duration / p);
        }
        break;
      }
      case 'coin': { // bright two-step ding
        const o = osc('triangle', 1976 * jit);
        o.frequency.setValueAtTime(2637 * p * jit, t + 0.06);
        const o2 = osc('sine', 3952 * jit);
        o2.frequency.setValueAtTime(5274 * p * jit, t + 0.06);
        const g = env(0.11, 0, 0.002, 0.12, 0.06);
        const g2 = env(0.035, 0, 0.002, 0.08, 0.06);
        o.connect(g).connect(out);
        o2.connect(g2).connect(out);
        stop(o, 0.9);
        stop(o2, 0.9);
        break;
      }
      case 'chestOpen': { // lid creak, then a rising sparkle arpeggio
        const n = noise();
        const bp = filt('bandpass', 320, 8);
        sweep(bp.frequency, [[0, 320], [0.3, 560]]);
        n.connect(bp).connect(env(0.32, 0, 0.05, 0.08, 0.15)).connect(out);
        stop(n, 0.8);
        const o = osc('triangle', 1175);
        const g = gain();
        [1175, 1480, 1760, 2349].forEach((f, i) => {
          o.frequency.setValueAtTime(f * p, t + 0.3 + i * 0.08);
          bump(g, 0.3 + i * 0.08, 0.14, 0.004, i === 3 ? 0.18 : 0.05);
        });
        o.connect(g).connect(out);
        stop(o, 1.8);
        break;
      }
      case 'waystone': { // resonant crystal (D5 + A5) with an airy shimmer
        const g = env(0.14, 0, 0.03, 0.45, 0.1);
        const o = osc('sine', 587.3);
        const o2 = osc('sine', 880);
        o.connect(g);
        o2.connect(g);
        g.connect(out);
        stop(o, 3.3);
        stop(o2, 3.3);
        const n = noise();
        n.connect(filt('bandpass', 4200, 12)).connect(env(0.12, 0, 0.3, 0.4)).connect(out);
        stop(n, 3.3);
        break;
      }
      case 'levelup': { // rising D-major arpeggio (triangle + sine octave) and a sparkle tail
        const g = gain();
        const o = osc('triangle', 587.3);
        const o2 = osc('sine', 1174.7);
        [587.3, 740, 880, 1174.7].forEach((f, i) => {
          o.frequency.setValueAtTime(f * p, t + i * 0.09);
          o2.frequency.setValueAtTime(f * 2 * p, t + i * 0.09);
          bump(g, i * 0.09, i === 3 ? 0.113 : 0.085, 0.005, i === 3 ? 0.3 : 0.06);
        });
        o.connect(g);
        o2.connect(g);
        g.connect(out);
        stop(o, 2.4);
        stop(o2, 2.4);
        const n = noise(0.3);
        n.connect(filt('bandpass', 6000, 3)).connect(env(0.056, 0.3, 0.02, 0.2)).connect(out);
        stop(n, 1.75);
        break;
      }
      case 'playerDown': { // a falling, softened sigh and a thud
        const o = osc('triangle', 440, 110, 0.9);
        o.connect(filt('lowpass', 1500, 0.7)).connect(env(0.17, 0, 0.01, 0.3, 0.3)).connect(out);
        stop(o, 2.4);
        const o2 = osc('sine', 80, 40, 0.3);
        o2.connect(env(0.34, 0, 0.004, 0.12)).connect(out);
        stop(o2, 0.9);
        break;
      }
      case 'heartbeat': { // "lub-dub": a low sine with a quiet octave for small speakers
        const o = osc('sine', 72, 48, 0.08);
        o.frequency.setValueAtTime(64 * p, t + 0.19);
        o.frequency.exponentialRampToValueAtTime(44 * p, t + 0.27);
        const o2 = osc('triangle', 116, 96, 0.08);
        const g = gain();
        bump(g, 0, 0.5, 0.01, 0.05);
        bump(g, 0.19, 0.38, 0.01, 0.06);
        const g2 = gain();
        bump(g2, 0, 0.08, 0.01, 0.04);
        bump(g2, 0.19, 0.06, 0.01, 0.05);
        o.connect(g).connect(out);
        o2.connect(g2).connect(out);
        stop(o, 0.65);
        stop(o2, 0.65);
        break;
      }
      default:
        break;
    }
    this._cleanup(last, nodes);
  }

  // ---------------------------------------------------------------------------
  // Vanquish the Evil Dragon's sounds (DRAGON_CAMPAIGN.md §6.9; VanquishAudio.js)
  // ---------------------------------------------------------------------------

  /**
   * One sound of a campaign's pack (`'vq'` VanquishAudio.js, `'ev'` EvermereAudio.js: its
   * `playSfx`, two nodes): before the pack has arrived, or its buffer has rendered, it plays when
   * they do if that is within 0.4 s of its time, else it is dropped; the pack's other renders are
   * asked for (`_packPrime`).
   * @param {'vq'|'ev'} pk @param {string} name @param {number} t @param {number} v @param {number} p @param {number} pan
   */
  _sfxPack(pk, name, t, v, p, pan) {
    const mod = packMod(pk);
    if (mod) mod.playSfx(this, name, t, v, p, pan);
    else {
      loadPack(pk).then((m) => {
        if (this._disposed || !this.ctx) return;
        const now = this.ctx.currentTime;
        if (now - t <= 0.4) m.playSfx(this, name, Math.max(t, now + 0.005), v, p, pan);
      });
    }
    this._packPrime(pk);
  }

  /**
   * Render Vanquish's sound buffers now (`names`, default: every `VQ_SFX_NAMES` sound and the crowd /
   * blaze voices) rather than when they are first needed: its audio module is imported (once), then
   * the renders run on the audio rendering thread one after another (an OfflineAudioContext each);
   * the buffers belong to no context, so this works before `unlock()` and every AudioSystem shares
   * them. Resolves when they are all ready, with the time that took (ms).
   * @param {readonly string[]} [names]
   * @returns {Promise<number>}
   */
  primeSfx(names) {
    const t0 = performance.now();
    return loadVq().then((m) => m.primeSfx(names)).then(() => performance.now() - t0);
  }

  /**
   * Diagnostics of the VQ renders (shared by every AudioSystem): buffers made, sample bytes, the
   * milliseconds the main thread spent building their graphs and finishing them, its longest
   * block, the blocks over 6 ms — the sounds' and voices' —, and `music`: the score's renders
   * (VanquishAudio.js `musicRenders`). Zeros before the module has arrived.
   * @returns {{ buffers: number, bytes: number, mainMs: number, maxBlockMs: number, slow: string[],
   *   music: import('./VanquishAudio.js').MusicRenderStats }}
   */
  get vqRenders() {
    // (the render caches are the shared kit's: either pack reports both campaigns' renders)
    const mod = VQ ?? EV;
    if (mod) return { ...mod.renders(), music: { ...mod.musicRenders(), waitMs: this._musicWaitMs } };
    return {
      buffers: 0, bytes: 0, mainMs: 0, maxBlockMs: 0, slow: [],
      music: { buffers: 0, bytes: 0, mainMs: 0, maxBlockMs: 0, missed: 0, waitMs: this._musicWaitMs, primed: [] },
    };
  }

  /**
   * Render the music of a Vanquish score track ahead of its first note (VanquishAudio.js
   * `primeMusic`: the buffers belong to no context, so this works before `unlock()` and every
   * AudioSystem shares them). Any other track renders nothing and resolves at once, without
   * fetching Vanquish's audio module; a score track imports it first (once). Never rejects:
   * `failed` names what could not be rendered (the track itself when the module could not be
   * loaded or its priming failed). Its score is built once it is primed (`_combatTrack`: not in
   * the first `startMusic` of the track, which a boss's intro or the credits wait on), and — this
   * system playing live — its instruments are warmed for this system's context before the promise
   * resolves (VanquishAudio.js `warmMusic`: compiled, their caches filled, its waves made, in
   * pieces between page turns), so the first start does not do that work in one call.
   * Evermere's score tracks likewise, through its pack (EvermereAudio.js); a name may carry a
   * section ('hushedking.rest': the track's).
   * @param {string} track
   * @returns {Promise<{ ok: boolean, failed: string[] }>}
   */
  primeMusic(track) {
    track = trackOf(track);
    const pk = packOf(track);
    if (!pk) return Promise.resolve({ ok: true, failed: [] });
    return loadPack(pk).then((m) => m.primeMusic(track, this)).then((r) => (this._combatTrack(track), r)).catch((err) => {
      console.error(PACK_ERROR, err);
      return { ok: false, failed: [track] };
    });
  }

  /**
   * Whether a track's music is ready to start at once: true for every track that renders nothing
   * (all but Vanquish's score tracks); for a score track, whether its renders are done
   * (VanquishAudio.js `musicReady`) — false before Vanquish's audio module has arrived (this asks,
   * it does not fetch it: `primeMusic` does).
   * @param {string} track
   * @returns {boolean}
   */
  musicReady(track) {
    track = trackOf(track);
    const pk = packOf(track);
    if (!pk) return true;
    const mod = packMod(pk);
    return mod ? mod.musicReady(track) : false;
  }

  /**
   * Keep the rendered music of `tracks` for `owner` — the level being played, the next one built
   * ahead, a story run — instead of what that owner kept before (VanquishAudio.js `retainMusic`:
   * a set no owner keeps and nothing plays may be freed). Only Vanquish's score tracks render
   * anything: the others are left out, and with none of them and the module not loaded yet
   * nothing is kept or fetched, so this returns at once. While the module is on its way the
   * latest wish of each owner is remembered and handed over when it arrives (a release made
   * meanwhile is never overtaken by the keep before it).
   * Each pack keeps its own tracks (Vanquish's, Evermere's: what an owner keeps of one is left to
   * the other's calls); a name may carry a section ('hushedking.rest').
   * @param {'level'|'next'|'story'} owner
   * @param {readonly string[]} tracks
   */
  retainMusic(owner, tracks) {
    for (const pk of /** @type {const} */ (['vq', 'ev'])) {
      const score = tracks.map(trackOf).filter((t) => packOf(t) === pk);
      const mod = packMod(pk);
      if (mod) {
        mod.retainMusic(owner, score);
        continue;
      }
      const pending = PENDING[pk];
      if (!score.length && !pending.has(owner)) continue;
      // (the first wish while the pack is on its way asks for it)
      if (!pending.size) {
        loadPack(pk).then((m) => {
          for (const [o, t] of pending) m.retainMusic(o, t);
          pending.clear();
        }, (err) => {
          pending.clear();
          console.error(PACK_ERROR, err);
        });
      }
      pending.set(owner, score);
    }
  }

  /**
   * @internal Vanquish's audio module (VanquishAudio.js), imported once — diagnostics and tests
   * (sandbox/vq_audio.js), which wait for it before building a score track themselves.
   * @returns {Promise<typeof import('./VanquishAudio.js')>}
   */
  _vqModule() {
    return loadVq();
  }

  /**
   * Evermere's audio pack (EvermereAudio.js) once it has arrived, else null — asking for it (once):
   * the game's AudioDirector on a level of The Bells of Evermere (its `direct`), diagnostics and
   * tests (sandbox/ev_audio.js).
   * @returns {typeof import('./EvermereAudio.js')|null}
   */
  get evPack() {
    return EV ?? (loadEv(), null);
  }

  /**
   * @internal the rendered buffers of a VQ sound or voice (null: not one, or the module has not
   * arrived) — diagnostics (sandbox/vq_audio.js)
   * @param {string} name
   * @returns {(AudioBuffer|null)[]|null}
   */
  _vqBuffersOf(name) {
    return VQ ? VQ.buffersOf(name) : null;
  }

  /**
   * @internal Ask for every render of a pack once one of its sounds, score tracks or layers is used
   * (its own only: Vanquish's `primeSfx()`, Evermere's), so the next one plays at once.
   * @param {'vq'|'ev'} pk
   */
  _packPrime(pk) {
    const flag = pk === 'ev' ? '_evPrimed' : '_vqPrimed';
    if (this[flag] || this._disposed || typeof OfflineAudioContext === 'undefined') return;
    this[flag] = true;
    loadPack(pk).then((m) => m.primeSfx()).catch((err) => console.error(PACK_ERROR, err));
  }

  // ---------------------------------------------------------------------------
  // Ambience
  // ---------------------------------------------------------------------------

  /**
   * Set ambience layer levels (0..1). Only the given layers change; they crossfade smoothly.
   * @param {{ wind?: number, birds?: number, crickets?: number, fire?: number, water?: number, crowd?: number, blaze?: number,
   *   surf?: number, howl?: number, icebed?: number }} levels (EV_AMBIENCE_LAYERS: Evermere's, its pack's)
   * @param {{ replace?: boolean, fade?: number }} [opts] replace: layers not mentioned fade to 0;
   *   fade: approximate crossfade time in seconds (2.5)
   */
  setAmbience(levels = {}, { replace = false, fade = 2.5 } = {}) {
    for (const name of LAYERS) {
      if (levels[name] !== undefined) this._ambTargets[name] = clamp(Number(levels[name]) || 0, 0, 1);
      // (Evermere's layers are kept only once set: every other level's targets stay the seven)
      else if (replace && name in this._ambTargets) this._ambTargets[name] = 0;
    }
    // (the crowd's and the blaze's voices: rendered in idle slices before their layers need them;
    // Evermere's when its first layer is built)
    if (this._ambTargets.crowd > 0.001 || this._ambTargets.blaze > 0.001) this._packPrime('vq');
    this._ambFade = Math.max(0.05, fade);
    if (this.ctx && !this._disposed) this._applyAmbience();
  }

  _applyAmbience() {
    const now = this.ctx.currentTime;
    const tau = this._ambFade / 3;
    for (const name of LAYERS) {
      if (!(name in this._ambTargets)) continue;
      const level = this._ambTargets[name];
      let layer = this._layers[name];
      if (level > 0.001 && !layer) layer = this._createLayer(name);
      if (!layer) continue;
      layer.gain.gain.cancelScheduledValues(now);
      layer.gain.gain.setValueAtTime(layer.gain.gain.value, now);
      layer.gain.gain.setTargetAtTime(level * (LAYER_GAIN[name] ?? EV.LAYER_GAIN[name]), now, tau);
      layer.level = level;
      layer.silentAt = level > 0.001 ? Infinity : now + this._ambFade * 2 + 1;
    }
  }

  _createLayer(name) {
    // (Vanquish's crowd and blaze come with its audio module, Evermere's layers with its pack:
    // built when it has arrived)
    const pk = name === 'crowd' || name === 'blaze' ? 'vq' : EV_AMBIENCE_LAYERS.includes(name) ? 'ev' : null;
    if (pk && !packMod(pk)) {
      loadPack(pk).then(() => {
        if (this.ctx && !this._disposed) this._applyAmbience();
      });
      return null;
    }
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this._buses.amb);
    const layer = { name, gain, nodes: [gain], sources: [], level: 0, silentAt: Infinity, next: 0, voices: null };
    const add = (...n) => {
      layer.nodes.push(...n);
      return n[0];
    };
    const src = (buffer, rate = 1, offset = 0) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(ctx.currentTime, offset % buffer.duration);
      layer.sources.push(s);
      return add(s);
    };
    /**
     * @param {number} freq @param {number} depth @param {AudioParam} param
     * @param {OscillatorType} [type]
     */
    const lfo = (freq, depth, param, type = 'sine') => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
      layer.sources.push(o);
      add(o, g);
      return o;
    };
    const r = this._rng;

    switch (name) {
      case 'wind': {
        const s1 = src(this._brown, 1, r() * 5);
        const bp = add(this._biquad('bandpass', 380, 0.65));
        const gust = add(ctx.createGain());
        gust.gain.value = 0.7;
        const pan = add(ctx.createStereoPanner());
        s1.connect(bp).connect(gust).connect(pan).connect(gain);
        lfo(0.071, 210, bp.frequency);
        lfo(0.13, 0.32, gust.gain);
        lfo(0.043, 0.45, pan.pan);
        // Airy whistle.
        const s2 = src(this._white, 1, r() * 1.5);
        const bp2 = add(this._biquad('bandpass', 1300, 5));
        const g2 = add(ctx.createGain());
        g2.gain.value = 0.05;
        s2.connect(bp2).connect(g2).connect(gain);
        lfo(0.052, 420, bp2.frequency);
        lfo(0.09, 0.035, g2.gain);
        break;
      }
      case 'birds': {
        // Calls are scheduled by the ticker; a gentle highpass keeps them light.
        const hp = add(this._biquad('highpass', 1400, 0.7));
        hp.connect(gain);
        layer.input = hp;
        layer.next = ctx.currentTime + 0.3 + r() * 0.8;
        break;
      }
      case 'crickets': {
        layer.voices = [
          { freq: 4420, pan: -0.45, period: 0.64, pulses: 3, amp: 0.11 },
          { freq: 4780, pan: 0.5, period: 0.83, pulses: 4, amp: 0.075 },
          { freq: 3960, pan: 0.05, period: 1.07, pulses: 2, amp: 0.05 },
        ].map((v) => {
          const o = ctx.createOscillator();
          o.type = 'sine';
          o.frequency.value = v.freq;
          const g = ctx.createGain();
          g.gain.value = 0;
          const p = ctx.createStereoPanner();
          p.pan.value = v.pan;
          o.connect(g).connect(p).connect(gain);
          o.start();
          layer.sources.push(o);
          add(o, g, p);
          return { ...v, gain: g, next: ctx.currentTime + 0.1 + r() * 0.5 };
        });
        // Distant chorus of more crickets.
        const s = src(this._white, 1, r());
        const bp = add(this._biquad('bandpass', 5200, 4));
        const g = add(ctx.createGain());
        g.gain.value = 0.02;
        s.connect(bp).connect(g).connect(gain);
        lfo(2.3, 0.012, g.gain);
        break;
      }
      case 'fire': {
        const s1 = src(this._brown, 0.8, r() * 5);
        const lp = add(this._biquad('lowpass', 170, 0.7));
        const g1 = add(ctx.createGain());
        g1.gain.value = 0.75;
        s1.connect(lp).connect(g1).connect(gain);
        lfo(0.31, 0.18, g1.gain);
        lfo(0.47, 0.12, g1.gain);
        const s2 = src(this._white, 1, r());
        const bp = add(this._biquad('bandpass', 2600, 0.6));
        const g2 = add(ctx.createGain());
        g2.gain.value = 0.022;
        s2.connect(bp).connect(g2).connect(gain);
        lfo(0.9, 0.012, g2.gain);
        const crackle = add(ctx.createGain());
        crackle.gain.value = 1;
        crackle.connect(gain);
        layer.input = crackle;
        layer.next = ctx.currentTime + 0.05;
        break;
      }
      case 'water': {
        const s1 = src(this._brown, 1.15, r() * 5);
        const bp1 = add(this._biquad('bandpass', 520, 0.55));
        const g1 = add(ctx.createGain());
        g1.gain.value = 0.62;
        s1.connect(bp1).connect(g1).connect(gain);
        lfo(0.21, 160, bp1.frequency);
        lfo(0.17, 0.12, g1.gain);
        const s2 = src(this._white, 1, r() * 1.5);
        const bp2 = add(this._biquad('bandpass', 1650, 1.3));
        const g2 = add(ctx.createGain());
        g2.gain.value = 0.07;
        s2.connect(bp2).connect(g2).connect(gain);
        lfo(0.33, 0.035, g2.gain);
        lfo(0.12, 380, bp2.frequency);
        const babble = add(ctx.createGain());
        babble.gain.value = 1;
        babble.connect(gain);
        layer.input = babble;
        layer.next = ctx.currentTime + 0.1;
        break;
      }
      case 'crowd':
      case 'blaze':
        VQ.buildLayer(this, name, layer, { add, src, lfo });
        break;
      default:
        if (pk) EV.buildLayer(this, name, layer, { add, src, lfo });
        break;
    }
    this._layers[name] = layer;
    return layer;
  }

  _destroyLayer(name) {
    const layer = this._layers[name];
    if (!layer) return;
    for (const s of layer.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const n of layer.nodes) n.disconnect();
    if (layer.input) layer.input.disconnect();
    delete this._layers[name];
  }

  _scheduleAmbience(now) {
    const ahead = now + LOOKAHEAD;
    const r = this._rng;
    const L = this._layers;

    const birds = L.birds;
    if (birds && birds.level > 0.001) {
      if (birds.next < now) birds.next = now + 0.1 + r() * 0.6;
      while (birds.next < ahead) {
        this._birdCall(birds.next, birds);
        birds.next += (0.9 + r() * 3.4) / (0.35 + birds.level);
      }
    }

    const crickets = L.crickets;
    if (crickets && crickets.level > 0.001) {
      for (const v of crickets.voices) {
        if (v.next < now) v.next = now + 0.05 + r() * 0.2;
        while (v.next < ahead) {
          const g = v.gain.gain;
          for (let k = 0; k < v.pulses; k++) {
            const tt = v.next + k * 0.046;
            g.setValueAtTime(0, tt);
            g.linearRampToValueAtTime(v.amp, tt + 0.007);
            g.linearRampToValueAtTime(0, tt + 0.024);
          }
          v.next += v.period * (0.96 + r() * 0.08);
        }
      }
    }

    const fire = L.fire;
    if (fire && fire.level > 0.001) {
      if (fire.next < now) fire.next = now + r() * 0.1;
      const rate = 4 + 10 * fire.level;
      while (fire.next < ahead) {
        const cluster = r() < 0.25 ? 2 + Math.floor(r() * 3) : 1;
        for (let k = 0; k < cluster; k++) this._crackle(fire.next + k * (0.008 + r() * 0.03), fire.input);
        fire.next += -Math.log(1 - r() * 0.999) / rate;
      }
    }

    const water = L.water;
    if (water && water.level > 0.001) {
      if (water.next < now) water.next = now + r() * 0.2;
      const rate = 2.5 + 6 * water.level;
      while (water.next < ahead) {
        this._bubble(water.next, water.input);
        water.next += -Math.log(1 - r() * 0.999) / rate;
      }
    }

    // Vanquish's crowd and blaze (VanquishAudio.js; their own RNG: the shared one's sequence stays)
    if (VQ && (L.crowd || L.blaze)) VQ.scheduleLayers(this, L, now, ahead);
    // Evermere's layers and its crows, once its pack is here (EvermereAudio.js; their own RNG too)
    EV?.scheduleLayers(this, L, now, ahead);

    // Tear down layers that have been silent for a while.
    for (const name in L) {
      const layer = L[name];
      if (layer.level <= 0.001 && now > layer.silentAt) this._destroyLayer(name);
    }
  }

  _birdCall(t, layer) {
    const ctx = this.ctx;
    const r = this._rng;
    const dist = 0.35 + r() * 0.65;
    const pan = this._panner((r() - 0.5) * 1.5, layer.input);
    const species = Math.floor(r() * 3);
    /** @type {AudioNode[]} */
    const nodes = [pan];
    let last = null;
    /**
     * @param {number} tt @param {number} f0 @param {number} f1 @param {number} dur
     * @param {number} amp @param {OscillatorType} [type]
     */
    const chirp = (tt, f0, f1, dur, amp, type = 'sine') => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, tt);
      o.frequency.exponentialRampToValueAtTime(f1, tt + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(amp * dist, tt + Math.min(0.012, dur * 0.3));
      g.gain.setTargetAtTime(0, tt + dur * 0.55, dur * 0.18);
      o.connect(g).connect(pan);
      o.start(tt);
      o.stop(tt + dur + 0.1);
      nodes.push(o, g);
      last = o;
      return o;
    };
    if (species === 0) {
      // Quick descending trill.
      const n = 4 + Math.floor(r() * 4);
      const f = 3300 + r() * 1100;
      for (let i = 0; i < n; i++) chirp(t + i * 0.068, f * (1 - i * 0.025), f * 0.74 * (1 - i * 0.025), 0.05, 0.09);
    } else if (species === 1) {
      // Two-tone "tee-yoo" whistle.
      const f = 2700 + r() * 700;
      chirp(t, f, f * 1.14, 0.13, 0.08);
      chirp(t + 0.2, f * 0.95, f * 0.72, 0.19, 0.075);
    } else {
      // FM warble.
      const o = chirp(t, 3400 + r() * 700, 3000 + r() * 500, 0.28, 0.065);
      const m = ctx.createOscillator();
      m.frequency.value = 38 + r() * 30;
      const mg = ctx.createGain();
      mg.gain.value = 320 + r() * 260;
      m.connect(mg).connect(o.frequency);
      m.start(t);
      m.stop(t + 0.4);
      nodes.push(m, mg);
    }
    if (last) this._cleanup(last, nodes);
  }

  _crackle(t, dest) {
    const ctx = this.ctx;
    const r = this._rng;
    const src = this._noiseSource(this._white, t, r() * 1.8);
    const hp = this._biquad('highpass', 1200 + r() * 2800, 0.8);
    const g = ctx.createGain();
    const amp = 0.08 + r() * r() * 0.5;
    const dur = 0.003 + r() * 0.01;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.0008);
    g.gain.setTargetAtTime(0, t + 0.001, dur * 0.4);
    const p = this._panner((r() - 0.5) * 0.6, dest);
    src.connect(hp).connect(g).connect(p);
    src.stop(t + dur + 0.06);
    this._cleanup(src, [src, hp, g, p]);
  }

  _bubble(t, dest) {
    const ctx = this.ctx;
    const r = this._rng;
    const f = 480 + r() * 950;
    const dur = 0.03 + r() * 0.04;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (1.4 + r() * 0.5), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012 + r() * 0.03, t + 0.005);
    g.gain.setTargetAtTime(0, t + dur * 0.5, dur * 0.3);
    const p = this._panner((r() - 0.5) * 1.2, dest);
    o.connect(g).connect(p);
    o.start(t);
    o.stop(t + dur + 0.08);
    this._cleanup(o, [o, g, p]);
  }

  // ---------------------------------------------------------------------------
  // Music
  // ---------------------------------------------------------------------------

  /**
   * Start music with a fade-in. If called before `unlock()`, playback begins as soon as the
   * context is unlocked.
   * - Without `track`, the last requested track plays (initially 'emberfall', the song above), so
   *   the unlock / visibility resume and `toggleMusic()` restart what was playing.
   * - Requesting the track that already plays is a no-op. Requesting a DIFFERENT track while one
   *   plays crossfades: the current track takes the stop path with this `fade` while the new one
   *   fades in over the same time (COMBAT.md §12.2).
   * - Combat tracks ('battle', 'boss') are built on first use, each from its own seeded RNG.
   * - A section: `section`, or the name's ('hushedking.rest'; the story's `music` line takes one word)
   *   — the new track starts there, the playing one moves there at the next bar (`setMusicSection`);
   *   without one the track's own start (Evermere's region tracks: their `frozen` section while the
   *   level is frozen — EvermereAudio.js).
   * @param {{ fade?: number, track?: string, section?: string }} [opts] fade-in seconds (2.5); `track`
   *   one of MUSIC_TRACKS or EV_MUSIC_TRACKS
   */
  startMusic({ fade = 2.5, track, section } = {}) {
    const name = track ?? this._musicTrackWanted;
    const want = trackOf(name);
    if (!MUSIC_TRACKS.includes(want) && !EV_MUSIC_TRACKS.includes(want)) {
      this._warnMusic(`unknown music track "${want}"`);
      return;
    }
    if (want !== this._musicTrackWanted) {
      this._musicTrackWanted = want;
      this._sectionWanted = null;
    }
    section ??= name.split('.')[1];
    if (section) this.setMusicSection(section);
    this._musicWanted = true;
    this._musicStopped = false;
    if (!this.ctx || this._disposed) return;
    const cur = this._music;
    if (cur && !cur.stopping && cur.track === want) return;
    const pk = packOf(want);
    if (pk) {
      // (a campaign's score track: its sounds rendered from now on, off the main thread; its score
      // comes with its pack and its rendered instruments with `primeMusic` — the playing track goes
      // on until they are here; renders that failed: it starts anyway, their notes skipped and counted)
      this._packPrime(pk);
      const mod = packMod(pk);
      if (!mod || (this._musicGo !== want && !mod.musicReady(want))) {
        if (this._musicGate?.track !== want) this._musicGate = { track: want, t0: performance.now() };
        this.primeMusic(want).then((r) => {
          if (this._disposed || !this._musicWanted || this._musicTrackWanted !== want || !packMod(pk)) return;
          if (!r.ok) {
            if (!this._musicFailed.has(want)) {
              this._musicFailed.add(want);
              console.error(`[AudioSystem] "${want}" plays without its failed renders: ${r.failed}`);
            }
            this._musicGo = want;
          }
          this.startMusic({ track: want, fade });
        });
        return;
      }
    }
    if (cur && !cur.stopping) {
      this._music = null;
      this._stopInstance(cur, fade); // crossfade: fades out while the new track fades in
    }
    if (pk) {
      // (how long this start waited for the track's renders: 0 when they were here)
      this._musicWaitMs = this._musicGate?.track === want ? Math.round(performance.now() - this._musicGate.t0) : 0;
      this._musicGo = null;
    }
    this._musicGate = null;
    const now = this.ctx.currentTime;
    this._music = want === 'emberfall' ? this._startSong(now, fade) : this._startCombatTrack(want, now, fade);
    this._scheduleMusic(now);
  }

  /** @internal the "Emberfall Evening" instance — built exactly as before the combat tracks existed */
  _startSong(now, fade) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(1, now + Math.max(0.05, fade));
    out.connect(this._buses.music);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    out.connect(send).connect(this._reverbIn);
    const harpBus = this._biquad('lowpass', 4200, 0.5);
    harpBus.connect(out);
    const padBus = ctx.createGain();
    padBus.gain.value = 1;
    padBus.connect(out);
    const fluteBus = this._biquad('lowpass', 3400, 0.5);
    fluteBus.connect(out);
    const m = {
      out, send, harpBus, padBus, fluteBus,
      section: this._intro,
      sectionStart: now + 0.15,
      cursor: 0,
      loop: 0,
      stopping: false,
      track: 'emberfall',
      nodes: [harpBus, padBus, fluteBus, send, out],
      sections: null,
      sectionName: null,
      pending: null,
      switchAt: -1,
      lastBeat: -1,
      rng: undefined, // pads / flute use the shared `_rng`, exactly as before
      next: () => this._main, // intro → main → main …
    };
    // per-instance tempo (§12.2); the song keeps following the public `bpm` field live
    Object.defineProperty(m, 'bpm', { get: () => this.bpm, enumerable: true });
    return m;
  }

  /** @internal a combat track instance (lazily built track, its own buses and play RNG) */
  _startCombatTrack(name, now, fade) {
    const ctx = this.ctx;
    const tr = this._combatTrack(name);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(1, now + Math.max(0.05, fade));
    out.connect(this._buses.music);
    const send = ctx.createGain();
    send.gain.value = 0.4;
    out.connect(send).connect(this._reverbIn);
    // the harp and the flute; the combat tracks' pad, drum and bass (a score track has its own
    // instruments: VanquishAudio.js)
    const combat = !tr.score;
    const harpBus = this._biquad('lowpass', 4600, 0.5);
    harpBus.connect(out);
    let padBus = null;
    if (combat) {
      padBus = ctx.createGain();
      padBus.gain.value = 0.9;
      padBus.connect(out);
    }
    const fluteBus = this._biquad('lowpass', 3600, 0.5);
    fluteBus.connect(out);
    let drumBus = null;
    let bassBus = null;
    if (combat) {
      drumBus = ctx.createGain();
      drumBus.gain.value = 1;
      drumBus.connect(out);
      bassBus = this._biquad('lowpass', 2200, 0.6);
      bassBus.connect(out);
    }
    // (a score track's `start` may be its pack's live choice: Evermere's region tracks start in their
    // frozen section while the level is frozen — a getter, evermere/Scores.js)
    const start = this._sectionWanted && tr.sections[this._sectionWanted] ? this._sectionWanted : tr.start;
    const m = {
      out, send, harpBus, padBus, fluteBus, drumBus, bassBus,
      section: tr.sections[start],
      sectionStart: now + 0.15,
      cursor: 0,
      loop: 0,
      stopping: false,
      track: name,
      bpm: tr.sections[start].bpm ?? tr.bpm,
      nodes: combat ? [harpBus, padBus, fluteBus, drumBus, bassBus, send, out] : [harpBus, fluteBus, send, out],
      sections: tr.sections,
      sectionName: start,
      pending: null,
      switchAt: -1,
      lastBeat: -1,
      rng: tr.rng,
      // (the section that follows: it moves only `mm`'s name — MusicRenders.js asks it on a
      // stand-in for the section a timpani roll ends in)
      next: (mm) => {
        if (tr.order === 'alternate') mm.sectionName = mm.sectionName === 'A' ? 'B' : 'A';
        return tr.sections[mm.sectionName];
      },
      // the gains the stop path, the stinger's duck and `dispose` automate (each at 1 when it plays:
      // a score track adds its reverb sends' fader), the sources they stop (a score track's
      // modulators), the notes a score track holds for a phase-aligned re-speak (cleared at a
      // section change)
      faders: [out],
      sources: [],
      held: null,
    };
    // (a score track's own buses: the shared kit's ScoreVoices.js, through whichever pack has arrived —
    // both re-export it) — its other faders
    // fade in with `out`
    if (tr.score) {
      (VQ ?? EV).scoreBuses(this, m, tr.score);
      for (const f of m.faders) {
        if (f === out) continue;
        f.gain.setValueAtTime(0, now);
        f.gain.linearRampToValueAtTime(1, now + Math.max(0.05, fade));
      }
    }
    return m;
  }

  /** @internal build (once) and return a combat or score track: sections, tempo, order, play RNG */
  _combatTrack(name) {
    let tr = this._tracks.get(name);
    if (!tr) {
      // (a campaign's score track: its score from its pack, there by now — `startMusic` waits for it)
      const pk = packOf(name);
      if (pk) tr = packMod(pk).scoreTrack(name);
      else {
        const def = COMBAT_TRACKS[name];
        const rng = mulberry32(def.seed);
        const sections = {};
        for (const key of Object.keys(def.sections)) sections[key] = buildCombatSection(def.sections[key], rng);
        tr = { name, title: def.title, bpm: def.bpm, order: def.order, start: def.start, sections, rng: mulberry32(def.seed ^ 0x5bd1e995) };
      }
      this._tracks.set(name, tr);
    }
    return tr;
  }

  /**
   * Fade the music out and stop scheduling.
   * @param {{ fade?: number }} [opts] fade-out seconds (2.5)
   */
  stopMusic({ fade = 2.5 } = {}) {
    this._musicWanted = false;
    this._musicStopped = true;
    const m = this._music;
    if (!m || !this.ctx) return;
    this._music = null;
    this._stopInstance(m, fade);
  }

  /**
   * @internal the stop path: fade an instance out — every fader (`m.faders`: its `out`, and a score
   * track's reverb sends too) —, stop scheduling it, stop its modulators (`m.sources`) when the fade
   * is done, disconnect it later
   */
  _stopInstance(m, fade) {
    m.stopping = true;
    const now = this.ctx.currentTime;
    const end = now + Math.max(0.05, fade);
    for (const f of m.faders ?? [m.out]) {
      const g = f.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, end);
    }
    for (const s of m.sources ?? []) {
      try {
        s.stop(end + 0.1);
      } catch {
        /* already stopped */
      }
    }
    // Disconnect after the fade and the longest tails have finished.
    setTimeout(() => {
      for (const n of m.nodes) {
        try {
          n.disconnect();
        } catch {
          /* context closed */
        }
      }
    }, (fade + 4) * 1000);
  }

  /** Whether music is playing (or requested to play once unlocked). */
  get musicPlaying() {
    return this._musicWanted;
  }

  /**
   * Whether the music was stopped (`stopMusic`: a story's `music off`, the player's toggle) and not
   * started since: a written silence, which a start of the game's own — the level's track at the
   * first gesture (`Game._armAudioUnlock`) — leaves alone. (A start still waiting for its renders
   * when the stop comes is cancelled: it checks the wish when they arrive.)
   */
  get musicStopped() {
    return this._musicStopped;
  }

  /** The playing (or requested) music track (MUSIC_TRACKS), or null when the music is off. */
  get musicTrack() {
    return this._musicWanted ? this._musicTrackWanted : null;
  }

  /** The current section ('A' | 'B', 'C' on 'dragon') of a playing combat or score track, else null (diagnostics). */
  get musicSection() {
    const m = this._music;
    return m && !m.stopping && m.sections ? m.sectionName : null;
  }

  /**
   * Switch the current track's section ('A' | 'B'; 'dragon' also has 'C') at the next bar line;
   * ignored by tracks without sections ('emberfall') and by names the track does not have
   * (COMBAT.md §12.2). The request is remembered for the track (a restart of the same track begins
   * there) and cleared when another track starts. 'battle', 'dread', 'festival' and 'triumph' keep
   * alternating A, B, A … from the new section; 'boss', 'siege', 'ascent' and 'dragon' loop the
   * requested one (a section with its own tempo — 'dragon' C — takes it at its first beat).
   * @param {string} name
   */
  setMusicSection(name) {
    const w = this._musicTrackWanted;
    const def = ownValue(COMBAT_TRACKS, w);
    // (an Evermere track: any name — its sections are its pack's; a playing instance moves only to one
    // it has, a track not playing yet starts in it if it has it)
    const names = def ? Object.keys(def.sections) : ownValue(SCORE_SECTIONS, w) ?? (EV_MUSIC_TRACKS.includes(w) ? [name] : null);
    if (!names || !names.includes(name)) return;
    this._sectionWanted = name;
    const m = this._music;
    if (!m || m.stopping || !m.sections?.[name] || m.track !== w) return;
    if (name === m.sectionName) {
      m.pending = null; // already there (or back to it): cancel a pending switch
      m.switchAt = -1;
      return;
    }
    m.pending = name;
    const bpb = m.section.bpb ?? 4;
    const bar = (Math.floor(m.lastBeat / bpb) + 1) * bpb; // the first bar line not yet scheduled
    m.switchAt = bar < m.section.lengthBeats ? bar : -1; // at the section's end the advance takes it
  }

  /**
   * @internal enter the pending section — the notes a score track held for a phase-aligned re-speak
   * (`m.held`, ScoreVoices.js) are forgotten: a re-speak pairs notes of one section, across its loop
   * too (the next section forgets them as well, `_scheduleMusic`; a section looping into itself keeps
   * them)
   */
  _takeSection(m) {
    const name = m.pending;
    m.pending = null;
    m.switchAt = -1;
    m.sectionName = name;
    if (m.held) m.held = {};
    return m.sections[name];
  }

  /**
   * Play a short scored stinger over the music: 'victory' (4 bars, D major fanfare) | 'levelup'
   * (a quick harp arpeggio). The playing track is ducked to `duck` (30 %) underneath and recovers
   * after it. `duck: 0` hands the stage to the stinger instead: the playing track fades out over
   * 0.35 s and ends (the music stays on — `musicPlaying`, `musicTrack` unchanged — and nothing
   * plays after the stinger until the next `startMusic({ track })`); a combat track in another key
   * would otherwise clash with the fanfare underneath (COMBAT-11).
   * Silent (returns false) before unlock or while the music is off (M), like the music itself.
   * @param {string} name one of MUSIC_STINGERS
   * @param {{ volume?: number, duck?: number }} [opts]
   * @returns {boolean} whether it started
   */
  playStinger(name, { volume = 1, duck = 0.3 } = {}) {
    if (!this.ready || this._disposed || !this._musicWanted) return false;
    if (!MUSIC_STINGERS.includes(name)) {
      this._warnMusic(`unknown stinger "${name}"`);
      return false;
    }
    let st = this._stingers.get(name);
    if (!st) {
      st = buildStinger(name);
      this._stingers.set(name, st);
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const t0 = now + 0.06;
    const beat = 60 / st.bpm;
    const dur = st.lengthBeats * beat;
    const out = ctx.createGain();
    out.gain.value = Math.max(0, volume);
    out.connect(this._buses.music);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    out.connect(send).connect(this._reverbIn);
    const harpBus = this._biquad('lowpass', 4600, 0.5);
    harpBus.connect(out);
    const fluteBus = this._biquad('lowpass', 3600, 0.5);
    fluteBus.connect(out);
    for (const ev of st.events) {
      const tt = t0 + ev.beat * beat;
      switch (ev.kind) {
        case 'harp': this._pluck(tt, ev.midi, ev.vel * 0.34, ev.pan, harpBus); break;
        case 'pad': this._pad(tt, ev.notes, ev.dur * beat, out, st.rng); break;
        case 'flute': this._flute(tt, ev.midi, ev.dur * beat, ev.vel, fluteBus, st.rng); break;
        case 'bell': this._bell(tt, mtof(ev.midi), ev.vel, 2.4, out); break;
        default: break;
      }
    }
    // duck the playing track underneath, then let it swell back (or end it: duck 0)
    const m = this._music;
    const level = Number.isFinite(duck) ? clamp(duck, 0, 1) : 0.3;
    if (m && !m.stopping) {
      if (level <= 0.001) {
        this._music = null;
        this._stopInstance(m, 0.35);
      } else {
        // (every fader of the track: a score track's reverb sends duck with its dry mix)
        for (const f of m.faders ?? [m.out]) {
          const g = f.gain;
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
          g.setTargetAtTime(level, now, 0.12);
          g.setTargetAtTime(1, t0 + dur * 0.85, 0.6);
        }
      }
    }
    if (!this._offline) {
      setTimeout(() => {
        for (const n of [harpBus, fluteBus, send, out]) {
          try {
            n.disconnect();
          } catch {
            /* context closed */
          }
        }
      }, (dur + 6) * 1000);
    }
    return true;
  }

  /** Toggle music on/off (restarting the last requested track). Returns the new state. */
  toggleMusic() {
    if (this._musicWanted) this.stopMusic();
    else this.startMusic();
    return this._musicWanted;
  }

  /** @internal one console.warn per message */
  _warnMusic(msg) {
    if (this._warnedMusic?.has(msg)) return;
    (this._warnedMusic ??= new Set()).add(msg);
    console.warn(`[AudioSystem] ${msg}`);
  }

  _scheduleMusic(now) {
    const m = this._music;
    if (!m || m.stopping) return;
    let beat = 60 / m.bpm;
    const ahead = now + LOOKAHEAD;
    // a score section with its own tempo ('dragon' C) takes it at its first beat (the song's `bpm`
    // is a getter on the public field and its sections carry none)
    const tempo = () => {
      if (m.section.bpm && m.section.bpm !== m.bpm) {
        m.bpm = m.section.bpm;
        beat = 60 / m.bpm;
      }
    };
    let guard = 0;
    while (guard++ < 4096) {
      const sec = m.section;
      if (m.cursor >= sec.events.length) {
        m.sectionStart += sec.lengthBeats * beat;
        m.section = m.pending !== null ? this._takeSection(m) : m.next(m);
        // (a section looping into itself keeps them: its first bar re-speaks its last bar's pedal)
        if (m.held && m.section !== sec) m.held = {};
        m.cursor = 0;
        m.lastBeat = -1;
        m.loop++;
        tempo();
        continue;
      }
      const ev = sec.events[m.cursor];
      if (m.switchAt >= 0 && ev.beat >= m.switchAt) {
        // a requested section starts at this bar line
        m.sectionStart += m.switchAt * beat;
        m.section = this._takeSection(m);
        m.cursor = 0;
        m.lastBeat = -1;
        tempo();
        continue;
      }
      const t = m.sectionStart + ev.beat * beat + (ev.jitter ?? 0);
      if (t > ahead) break;
      m.cursor++;
      m.lastBeat = ev.beat;
      if (t < now - 0.03) continue; // fell behind (throttled tab) — skip rather than burst
      const tt = Math.max(t, now + 0.002);
      if (this._voices > MAX_VOICES * 1.5) continue;
      switch (ev.kind) {
        case 'harp': this._pluck(tt, ev.midi, ev.vel * 0.34, ev.pan, m.harpBus); break;
        case 'pad': this._pad(tt, ev.notes, ev.dur * beat, m.padBus, m.rng, ev.vel); break;
        case 'flute': this._flute(tt, ev.midi, ev.dur * beat, ev.vel, m.fluteBus, m.rng); break;
        case 'taiko': this._taiko(tt, ev.vel, ev.big, m.drumBus, m.rng); break;
        case 'bass': this._sawBass(tt, ev.midi, ev.dur * beat, ev.vel, m.bassBus); break;
        // the score's instruments (Vanquish's and Evermere's tracks: the shared kit's ScoreVoices.js,
        // through whichever pack has arrived)
        default:
          (VQ ?? EV)?.scoreVoice(this, ev, tt, beat, m);
          break;
      }
    }
  }

  /** Karplus-Strong harp pluck from a cached pre-rendered buffer. */
  _pluck(t, midi, vel, pan, dest) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._harpBuffer(midi);
    const g = ctx.createGain();
    g.gain.value = vel;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    src.connect(g).connect(p).connect(dest);
    src.start(t);
    this._cleanup(src, [src, g, p]);
  }

  /**
   * Soft string pad: detuned saws through a slowly breathing lowpass, slow attack. `vel` (1) scales
   * it (the score tracks'; the song and the combat tracks play it at 1).
   */
  _pad(t, notes, dur, dest, rng = this._rng, vel = 1) {
    const ctx = this.ctx;
    const lp = this._biquad('lowpass', 700, 0.45);
    lp.frequency.setValueAtTime(650, t);
    lp.frequency.linearRampToValueAtTime(1350, t + dur * 0.55);
    lp.frequency.linearRampToValueAtTime(800, t + dur + 1.6);
    const g = ctx.createGain();
    const peak = 0.03 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.min(1.2, dur * 0.4));
    g.gain.setValueAtTime(peak, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.45);
    lp.connect(g).connect(dest);
    const end = t + dur + 2.8;
    /** @type {AudioNode[]} */
    const nodes = [lp, g];
    let first = null;
    for (let i = 0; i < notes.length; i++) {
      const f = mtof(notes[i]);
      for (const side of [-1, 1]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = side * (5 + i * 1.3) + (rng() - 0.5) * 3;
        const p = ctx.createStereoPanner();
        p.pan.value = side * (0.25 + i * 0.07);
        o.connect(p).connect(lp);
        o.start(t);
        o.stop(end);
        nodes.push(o, p);
        first ??= o;
      }
    }
    this._cleanup(first, nodes);
  }

  /** Flute-like lead: sine + a little triangle, delayed vibrato, breath noise. */
  _flute(t, midi, dur, vel, dest, rng = this._rng) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const end = t + dur + 0.7;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f;
    const o2g = ctx.createGain();
    o2g.gain.value = 0.16;
    // Vibrato fades in after the attack.
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.1 + rng() * 0.4;
    const vibG = ctx.createGain();
    vibG.gain.setValueAtTime(0, t);
    vibG.gain.setValueAtTime(0, t + Math.min(0.25, dur * 0.4));
    vibG.gain.linearRampToValueAtTime(f * 0.0068, t + Math.min(0.7, dur * 0.8));
    vib.connect(vibG);
    vibG.connect(o.frequency);
    vibG.connect(o2.frequency);

    const env = ctx.createGain();
    const a = 0.12 * vel;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(a, t + 0.08);
    env.gain.linearRampToValueAtTime(a * 0.82, t + Math.max(0.1, dur * 0.7));
    env.gain.setTargetAtTime(0, t + dur * 0.96, 0.09);
    o.connect(env);
    o2.connect(o2g).connect(env);

    // Breath.
    const n = this._noiseSource(this._white, t, rng() * 1.5);
    const bp = this._biquad('bandpass', f * 2, 1.6);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.018 * vel, t + 0.05);
    ng.gain.setTargetAtTime(0.004 * vel, t + 0.06, 0.1);
    ng.gain.setTargetAtTime(0, t + dur * 0.96, 0.06);
    n.connect(bp).connect(ng).connect(dest);
    env.connect(dest);

    for (const s of [o, o2, vib]) {
      s.start(t);
      s.stop(end);
    }
    n.stop(end);
    this._cleanup(o, [o, o2, o2g, vib, vibG, env, n, bp, ng]);
  }

  /**
   * Taiko (combat tracks): a pitch-dropping sine body plus a short filtered-noise skin slap.
   * `big` = the low drum (beats 1 and 3), otherwise a higher, tighter drum.
   */
  _taiko(t, vel, big, dest, rng = this._rng) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(big ? 118 : 205, t);
    o.frequency.exponentialRampToValueAtTime(big ? 46 : 118, t + (big ? 0.22 : 0.1));
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime((big ? 0.36 : 0.19) * vel, t + 0.003);
    og.gain.setTargetAtTime(0, t + 0.01, big ? 0.13 : 0.055);
    const n = this._noiseSource(this._white, t, rng() * 1.9);
    const f = this._biquad(big ? 'lowpass' : 'bandpass', big ? 900 : 1800, big ? 0.7 : 0.9);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime((big ? 0.12 : 0.1) * vel, t + 0.002);
    ng.gain.setTargetAtTime(0, t + 0.004, big ? 0.03 : 0.018);
    o.connect(og).connect(dest);
    n.connect(f).connect(ng).connect(dest);
    o.start(t);
    o.stop(t + (big ? 0.9 : 0.45));
    n.stop(t + 0.2);
    this._cleanup(o, [o, og, n, f, ng]);
  }

  /** Staccato saw bass (combat tracks): a sawtooth through a plucked, resonant lowpass. */
  _sawBass(t, midi, dur, vel, dest) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const lp = this._biquad('lowpass', f * 12, 3.2);
    lp.frequency.setValueAtTime(Math.min(2400, f * 14), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(140, f * 2.4), t + 0.12);
    const g = ctx.createGain();
    const peak = 0.2 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.setTargetAtTime(peak * 0.55, t + 0.012, 0.05);
    g.gain.setTargetAtTime(0, t + dur, 0.03);
    o.connect(lp).connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.25);
    this._cleanup(o, [o, lp, g]);
  }

  /**
   * Render (and cache) a Karplus-Strong plucked-string buffer for a MIDI note.
   * Fractional-delay tuned, soft filtered-noise excitation → mellow harp timbre.
   */
  _harpBuffer(midi) {
    let buf = this._harpCache.get(midi);
    if (buf) return buf;
    const sr = HARP_SR;
    const f = mtof(midi);
    const dur = clamp(3.4 - (midi - 38) * 0.045, 1.1, 3.2);
    const len = Math.ceil(sr * dur);
    buf = this.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const rng = mulberry32(0x4a3b + midi * 977);
    const P = sr / f;
    const D = P - 0.5; // averaging filter contributes half a sample of delay
    const t60 = dur * 0.75;
    const g = 10 ** (-3 / (t60 * f));
    const exN = Math.ceil(P) + 2;
    // Excitation: one-pole lowpassed noise (softer for low notes), DC removed.
    const bright = clamp(0.3 + (midi - 50) * 0.02, 0.14, 0.7);
    // Two cascaded one-pole lowpasses (softer, rounder attack than raw noise).
    let lp1 = 0;
    let lp2 = 0;
    for (let i = 0; i < exN; i++) {
      lp1 += (rng() * 2 - 1 - lp1) * bright;
      lp2 += (lp1 - lp2) * bright;
      d[i] = lp2;
    }
    // Pluck-position comb (string plucked ~1/7 of the way along) and DC removal.
    const k = Math.max(1, Math.round(P * 0.14));
    for (let i = exN - 1; i >= k; i--) d[i] -= 0.55 * d[i - k];
    let mean = 0;
    for (let i = 0; i < exN; i++) mean += d[i];
    mean /= exN;
    for (let i = 0; i < exN; i++) d[i] -= mean;
    // Loop with linear-interpolated fractional delay + two-point averaging.
    for (let n = exN; n < len; n++) {
      const pos = n - D;
      const i0 = Math.floor(pos);
      const fr = pos - i0;
      const s0 = d[i0] + (d[i0 + 1] - d[i0]) * fr;
      const s1 = d[i0 - 1] + (d[i0] - d[i0 - 1]) * fr;
      d[n] = g * 0.5 * (s0 + s1);
    }
    // Normalise, soften the onset a touch, fade the tail to silence.
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    const norm = peak > 0 ? 0.9 / peak : 1;
    const fadeIn = 56;
    const fadeOut = Math.floor(len * 0.25);
    for (let i = 0; i < len; i++) {
      let s = d[i] * norm;
      if (i < fadeIn) s *= i / fadeIn;
      const k = len - 1 - i;
      if (k < fadeOut) s *= k / fadeOut;
      d[i] = s;
    }
    this._harpCache.set(midi, buf);
    return buf;
  }

  // ---------------------------------------------------------------------------
  // Graph construction & helpers
  // ---------------------------------------------------------------------------

  _build() {
    const ctx = this.ctx;
    const mix = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;
    const master = ctx.createGain();
    master.gain.value = this._muted ? 0 : this._volume;
    mix.connect(comp).connect(master).connect(ctx.destination);
    this._mix = mix;
    this._master = master;

    // Reverb.
    const convolver = ctx.createConvolver();
    convolver.buffer = this._makeImpulse(2.8, 2.3);
    const reverbIn = ctx.createGain();
    reverbIn.gain.value = 1;
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = this._reverbAmount;
    const reverbHp = this._biquad('highpass', 160, 0.7);
    reverbIn.connect(reverbHp).connect(convolver).connect(reverbOut).connect(mix);
    this._reverbIn = reverbIn;

    const bus = (vol, send) => {
      const g = ctx.createGain();
      g.gain.value = vol;
      g.connect(mix);
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(reverbIn);
      return g;
    };
    this._buses = {
      sfx: bus(this._sfxVolume * BUS_TRIM.sfx, 0.22),
      music: bus(this._musicVolume * BUS_TRIM.music, 0),
      amb: bus(this._ambienceVolume * BUS_TRIM.amb, 0.12),
    };

    // Noise sources.
    const rng = mulberry32(0xb0b);
    const white = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const wd = white.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = rng() * 2 - 1;
    this._white = white;
    const brown = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 6), ctx.sampleRate);
    const bd = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bd.length; i++) {
      last = (last + 0.02 * (rng() * 2 - 1)) / 1.02;
      bd[i] = last * 3.5;
    }
    // Make the loop seamless: remove the linear drift between the ends, then remove DC.
    const drift = bd[bd.length - 1] - bd[0];
    let m = 0;
    for (let i = 0; i < bd.length; i++) {
      bd[i] -= (drift * i) / (bd.length - 1);
      m += bd[i];
    }
    m /= bd.length;
    for (let i = 0; i < bd.length; i++) bd[i] -= m;
    this._brown = brown;

    if (!this._offline) {
      this._timer = setInterval(this._tick, TIMER_MS);
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVisibility);
    }

    this._applyAmbience();
    if (this._musicWanted) this.startMusic();
  }

  /** Generated stereo impulse response: pre-delay, early reflections, darkening exponential tail. */
  _makeImpulse(seconds, t60) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const pre = Math.floor(sr * 0.014);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const rng = mulberry32(0x1e5 + ch * 7919);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / sr;
        const env = Math.exp((-6.91 * t) / t60);
        const coef = 0.85 - 0.7 * Math.min(1, t / seconds); // brighter early, darker late
        lp += (rng() * 2 - 1 - lp) * coef;
        d[i] = lp * env;
      }
      // A few sparse early reflections.
      for (let k = 0; k < 10; k++) {
        const i = pre + Math.floor(sr * (0.004 + rng() * 0.07));
        if (i < len) d[i] += (rng() - 0.5) * 0.9 * (1 - k / 12);
      }
      // Gentle fade at the very end.
      const fade = Math.floor(sr * 0.1);
      for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
    }
    return buf;
  }

  _applyMaster() {
    if (!this.ctx || !this._master) return;
    this._master.gain.setTargetAtTime(this._muted ? 0 : this._volume, this.ctx.currentTime, 0.03);
  }

  _biquad(type, freq, q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /**
   * A panner routed to `dest` (optionally with an extra reverb send).
   * @param {number} pan
   * @param {AudioNode} dest
   * @param {number} [send]
   * @returns {SfxPanner}
   */
  _panner(pan, dest, send = 0) {
    const p = /** @type {SfxPanner} */ (this.ctx.createStereoPanner());
    p.pan.value = clamp(pan, -1, 1);
    p.connect(dest);
    if (send > 0) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      p.connect(s).connect(this._reverbIn);
      p._send = s;
    }
    return p;
  }

  /**
   * Disconnect a panner (and its send) `seconds` after the voice's scheduled start time `t`
   * (context time — so a `playSfx(..., { delay })` voice is not cut off before it sounds).
   */
  _later(node, t, seconds) {
    if (this._offline) return; // offline renders are short-lived; let GC collect the graph
    this._voices++;
    const ms = (Math.max(0, t - this.ctx.currentTime) + seconds + 0.05) * 1000;
    setTimeout(() => {
      this._voices--;
      try {
        node.disconnect();
        node._send?.disconnect();
      } catch {
        /* context closed */
      }
    }, ms);
  }

  _noiseSource(buffer, t, offset = 0) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.start(t, offset % buffer.duration);
    return s;
  }

  /** Track a voice and disconnect its nodes when `src` ends. */
  _cleanup(src, nodes) {
    if (!src) return;
    this._voices++;
    src.onended = () => {
      this._voices--;
      for (const n of nodes) {
        try {
          n.disconnect();
          n._send?.disconnect();
        } catch {
          /* ignore */
        }
      }
    };
  }

  /**
   * Test helper for an OfflineAudioContext passed as `context`: run the music/ambience
   * schedulers over [0, seconds) before `startRendering()` (offline contexts have no clock yet).
   * @param {number} seconds
   */
  prescheduleOffline(seconds) {
    if (!this.ctx || !this._offline) return;
    for (let now = 0; now < seconds; now += LOOKAHEAD * 0.5) {
      this._scheduleMusic(now);
      this._scheduleAmbience(now);
    }
  }

  _tick() {
    const ctx = this.ctx;
    if (!ctx || this._disposed || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this._scheduleMusic(now);
    this._scheduleAmbience(now);
  }

  _onVisibility() {
    // (installed only for a live context, never for an OfflineAudioContext: see _build)
    const ctx = /** @type {AudioContext} */ (this.ctx);
    if (!ctx || !this._suspendWhenHidden || this._disposed) return;
    if (document.visibilityState === 'hidden') {
      if (ctx.state === 'running') {
        this._hiddenSuspended = true;
        ctx.suspend().catch(() => {});
      }
    } else if (this._hiddenSuspended) {
      this._hiddenSuspended = false;
      ctx.resume().catch(() => {});
    }
  }
}
