/**
 * Scores — The Bells of Evermere's nine tracks (docs/contracts/EVERMERE_CAMPAIGN.md §5.7, §6.8),
 * written with the score kit Vanquish's six were (vanquish/ScoreKit.js) and played by the same
 * instruments (ScoreVoices.js, MusicRenders.js) plus the campaign's bells (evermere/Bells.js: the
 * great bells, tubular bells, handbells and the celesta — rendered kinds registered with the kit).
 *
 * THE MOTIF. Four notes, one per bell and one per line of the bell-song (§2.3): the line endings of
 * the song — 5̂ 3̂ 6̂ 1̂ of the home key, D major: A F♯ B · D (`MOTIF`, from the tonic). The first three
 * recur in every track (transposed to its key); the fourth — Rest's, the tonic, the line Linnet
 * cannot remember — is heard only in `firstspring` (the motif complete, the four Season Bells A3
 * F♯3 B3 D3 at the song's line endings). Over the relative minor the incomplete motif ends on the
 * minor tonic (B: Evermere frozen), which the missing D would have turned to the major. The Hush
 * Bell plays it backwards (`RETRO`, in the parallel minor: D B♭ F A — the year turned back); the
 * Hush Bell and the Bell of Rest are one pitch, D3, minor and major tierce: the same bronze, recast.
 * A region's `frozen` section plays the motif cold (the celesta, the solo cello), its season
 * section rings the region's own bell on the motif's note it carries (Waking the first, Tides the
 * second, Harvest the third) — the frozen → season switch at the thaw is the music resolving.
 *
 * THE MOODS AS NUMBERS (`MOOD`: tempo, meter, mode, the melody's register, onsets a second, the
 * lead, the bells' role), asserted by tools/test-ev-scores.mjs (`npm run ev:test`) with the kit's
 * orchestration rules (LOW_LIMIT, the lane, at most 7 lines, holds ≤ a bar where a section may be
 * switched to at a bar line, pedals re-spoken every bar — ≤ a bar + a beat —, no held melody note a
 * semitone from held harmony). Each section's plan stands above it: B the
 * basses, H the harmony, M the melody, C a counter-line or colour, Bl the bells.
 *
 * Imports ScoreKit.js, Bells.js (its kind names) and the engine's utils only: it runs in Node (the
 * score test builds every track there). Imported only through EvermereAudio.js.
 */
import { mulberry32 } from '../../utils/math.js';
import { ownValue } from '../../utils/own.js';
import { buildScoreSections, chordOf, pcFrom, pcOf, SCORE_KINDS } from '../vanquish/ScoreKit.js';
import { BELL_KIND_NAMES } from './Bells.js';

/** @import { ScoreTrackDef, Score } from '../vanquish/ScoreKit.js' */

/** The kinds Evermere's scores may emit: the kit's and the bells (`buildScoreSections` checks them). */
export const EV_KINDS = Object.freeze(Object.fromEntries([...SCORE_KINDS, ...BELL_KIND_NAMES].map((k) => [k, /** @type {true} */ (true)])));

/** The motif from the tonic of a major key: 5̂ 3̂ 6̂ 1̂ (in D: A F♯ B · D) — its fourth note a sixth below the third. */
export const MOTIF = Object.freeze([7, 4, 9, 0]);
/** The Hush Bell's retrograde in the parallel minor, from the tonic: 1̂ ♭6̂ ♭3̂ 5̂ (in D: D B♭ F A). */
export const RETRO = Object.freeze([0, 8, 3, 7]);

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
/** A MIDI note's name for the melody shorthand (61 → 'C#4'). */
export const nm = (m) => `${NAMES[pcOf(m)]}${Math.floor(m / 12) - 1}`;

/**
 * A melody in scale steps from `tonic` (MIDI) in the shorthand ('7:.5 5:1 r:2 | …': semitones from
 * the tonic, durations in beats; `_`, `!`, `~` as ScoreKit's `mel`).
 * @param {number} tonic @param {string} text
 */
const steps = (tonic, text) => text.trim().split(/\s+/).map((tok) => {
  if (tok === '|') return tok;
  const m = /^(-?\d+|r):(.+)$/.exec(tok);
  if (!m) throw new Error(`[evermere] bad step "${tok}"`);
  return m[1] === 'r' ? tok : `${nm(tonic + Number(m[1]))}:${m[2]}`;
}).join(' ');

/** The bells' kinds (Bells.js: registered with the kit, not ScoreKit's `ScoreKind` union). */
const BELL = /** @type {any} */ ('bell');
const TUBULAR = /** @type {any} */ ('tubular');
const HANDBELL = /** @type {any} */ ('handbell');
const CHIME = /** @type {any} */ ('chime');

/** The timpani's note for a chord: its bass from `lo` up. */
const timpOf = (chord, lo = 38) => pcFrom(chordOf(chord).bass, lo);

/**
 * The mix EQ's shapes (a track's `eq`).
 * @type {Record<string, import('../vanquish/ScoreKit.js').ScoreFilter[]>}
 */
const EQ = {
  boom: [['lowshelf', 70, 0, -5]],
  hornPresence: [['peaking', 2000, 1, 2.5]],
  bowPresence: [['peaking', 2500, 1, 3]],
  cuivre: [['peaking', 3000, 1.2, -2.5]],
  // (the celesta's body under its ping: a little warmth at 600 Hz, its 6 kHz tine eased)
  celesta: [['peaking', 600, 0.8, 2], ['highshelf', 6000, 0, -3]],
};

// ---------------------------------------------------------------------------------------------
// The bell-song (§2.3): Elin's lullaby, 3/4, in D major — four lines of four bars, each ending on
// its bell's note of the motif (A, F♯, B, D). The incomplete form stops at "Rest, little year—"
// (bar 13) and leaves the last two bars silent: the line Linnet forgot.
// ---------------------------------------------------------------------------------------------

const SONG_1 = 'F#4:1.5 E4:.5 D4:1 | A4:1.5 G4:.5 F#4:1 | B4:1 A4:1 G4:1 | A4:3';
const SONG_2 = 'D5:1.5 C#5:.5 B4:1 | A4:1.5 B4:.5 A4:1 | G4:1 E4:1 G4:1 | F#4:3';
const SONG_3 = 'F#4:1.5 G4:.5 A4:1 | B4:1.5 C#5:.5 D5:1 | E5:1 D5:1 C#5:1 | B4:3';
/** Line 4 whole: "Rest, little year — and begin it once more." */
const SONG_4 = 'A4:1.5 G4:.5 F#4:1 | E4:2 F#4:.5 E4:.5 | G4:1 F#4:1 E4:1 | D4:3';
/** Line 4 stopping at its dash: "Rest, little year—" — and two bars of silence. */
const SONG_4_STOPS = 'A4:1.5 G4:.5 F#4:1 | E4:3 | r:3 | r:3';
/** The song's harmony in D (its sixteen bars; the incomplete form's last two bars a half cadence). */
const SONG_CHORDS = ['D', 'Bm', 'G', 'A', 'G', 'D', 'Em', 'D', 'D', 'G', 'A', 'Bm', 'G', 'A', 'A7', 'D'];

/**
 * The moods as numbers (EVERMERE_CAMPAIGN.md §2.4 – §2.6, §6.8), per section: `bpm`, `bpb` (beats a
 * bar), `pcs` the mode's pitch classes (every pitched note in it but the `chroma` listed), `lead` the
 * melody's instrument, `reg` [lowest, highest] MIDI of its `lead` notes, `rate` [min, max] onsets a
 * second (every struck or bowed onset, chords as one), `motif` how many of the motif's notes the
 * section carries (3, 4 only in firstspring A; 'retro' the Hush Bell's), `bell` the bell's role.
 * tools/test-ev-scores.mjs asserts them on the built scores.
 * @type {Record<string, { bpm: number, bpb: number, key: string, pcs: number[], chroma?: number[], lead: string, reg: [number, number],
 *   rate: [number, number], motif: 3|4|'retro', bell: string, mood: string }>}
 */
export const MOOD = {
  'hush A': { bpm: 66, bpb: 3, key: 'B minor', pcs: [11, 1, 2, 4, 6, 7, 9], chroma: [10], lead: 'chime', reg: [74, 88], rate: [1.4, 3.5], motif: 3, bell: 'far tubular bells on the motif\'s notes', mood: 'Evermere frozen at the blue hour: a music box plays the lullaby in B minor and stops at its fourth line' },
  'hush B': { bpm: 66, bpb: 3, key: 'D major / B minor', pcs: [2, 4, 6, 7, 9, 11, 1], chroma: [10], lead: 'flute', reg: [62, 83], rate: [1.8, 3.5], motif: 3, bell: 'far tubular bells; the celesta\'s motif over D, its D missing', mood: 'warmth: the flute low over the harp' },
  'waking frozen': { bpm: 76, bpb: 4, key: 'E aeolian (C lydian lift)', pcs: [4, 6, 7, 9, 11, 0, 2], chroma: [3], lead: 'chime', reg: [69, 79], rate: [0.5, 1.5], motif: 3, bell: 'none: the Bell of Waking is frozen', mood: 'buds under ice: the celesta\'s motif, an icy shimmer, the low drone' },
  'waking A': { bpm: 76, bpb: 4, key: 'G major (A-major lydian lift)', pcs: [7, 9, 11, 0, 2, 4, 6], chroma: [1], lead: 'flute', reg: [67, 81], rate: [2, 4], motif: 3, bell: 'the Bell of Waking (tubular D5) on the motif\'s first note every 4 bars', mood: 'wonder to a first triumph: flute, harp, strings, the horn\'s counter' },
  'tides frozen': { bpm: 78, bpb: 3, key: 'F# minor (harmonic)', pcs: [6, 8, 9, 11, 1, 2, 4], chroma: [5], lead: 'flute', reg: [68, 78], rate: [1, 2], motif: 3, bell: 'none: the lighthouse bell is frozen', mood: 'comedy and heartbreak: a ledger\'s spiccato tick under the flute\'s lament' },
  'tides A': { bpm: 78, bpb: 3, key: 'A major', pcs: [9, 11, 1, 2, 4, 6, 8], lead: 'flute', reg: [64, 81], rate: [2, 4], motif: 3, bell: 'the Bell of Tides (tubular C#5) on the motif\'s second note; a peal of the three into the loop', mood: 'hope: a lilting 6/8 tune on the flute, the horn rising under it' },
  'harvest frozen': { bpm: 69, bpb: 4, key: 'C minor', pcs: [0, 2, 3, 5, 7, 8, 10], chroma: [11], lead: 'flute', reg: [60, 72], rate: [0.7, 1.6], motif: 3, bell: 'Brother Fallow\'s handbell, alone, every two bars', mood: 'dread to the low point: a slow heartbeat, a low "oo" choir, the flute' },
  'harvest A': { bpm: 69, bpb: 4, key: 'E-flat major', pcs: [3, 5, 7, 8, 10, 0, 2], lead: 'flute', reg: [63, 80], rate: [2.5, 4.5], motif: 3, bell: 'the Bell of Harvest (tubular C5) on the motif\'s third note; the handbells\' peal', mood: 'grace at the golden hour: an air on the flute over the harp, the choir' },
  'rimeholt A': { bpm: 60, bpb: 4, key: 'D minor', pcs: [2, 4, 5, 7, 9, 10, 0], chroma: [1], lead: 'brass', reg: [50, 60], rate: [0.8, 2], motif: 'retro', bell: 'the Hush Bell\'s retrograde, far, rolling down the mountain (minor great bells D3 B♭2 F3 A2)', mood: 'night under the aurora: ominous, the climb begins' },
  'rimeholt B': { bpm: 60, bpb: 4, key: 'D minor', pcs: [2, 4, 5, 7, 9, 10, 0], chroma: [1], lead: 'brass', reg: [49, 62], rate: [1.5, 3], motif: 'retro', bell: 'the retrograde near, on the tubular bells: the citadel close', mood: 'the climb: the trombones join, the timpani' },
  'hushfight hush': { bpm: 120, bpb: 4, key: 'B minor', pcs: [11, 1, 2, 4, 6, 7, 9], chroma: [10], lead: 'brass', reg: [59, 76], rate: [4.5, 8], motif: 3, bell: 'the music box frantic: the celesta\'s motif in 8ths', mood: 'the tutorial raid on the frozen lake: driving, cold' },
  'hushfight waking': { bpm: 120, bpb: 4, key: 'E minor', pcs: [4, 6, 7, 9, 11, 0, 2], chroma: [3], lead: 'brass', reg: [52, 79], rate: [4.5, 8], motif: 3, bell: 'none', mood: 'a fight in the frozen wood: the flute over the horn' },
  'hushfight tides': { bpm: 120, bpb: 4, key: 'F# minor', pcs: [6, 8, 9, 11, 1, 2, 4], chroma: [5], lead: 'brass', reg: [54, 81], rate: [4.5, 8], motif: 3, bell: 'none', mood: 'a fight on the bay ice: the fiddle over the horn' },
  'hushfight harvest': { bpm: 120, bpb: 4, key: 'C minor', pcs: [0, 2, 3, 5, 7, 8, 10], chroma: [11], lead: 'brass', reg: [60, 75], rate: [4.5, 8], motif: 3, bell: 'Brother Fallow\'s handbells struck in the fight', mood: 'a fight in the frozen wheat: a low choir' },
  'hushfight rimeholt': { bpm: 120, bpb: 4, key: 'D minor', pcs: [2, 4, 5, 7, 9, 10, 0], chroma: [1], lead: 'brass', reg: [62, 77], rate: [4.5, 8], motif: 3, bell: 'the Hush Bell (minor great bell D3) every two bars', mood: 'a fight on the citadel stair' },
  'guardian A': { bpm: 132, bpb: 4, key: 'A minor', pcs: [9, 11, 0, 2, 4, 5, 7], chroma: [8], lead: 'brass', reg: [60, 72], rate: [5, 8], motif: 3, bell: 'none', mood: 'a guardian wakes: the motif as a motto' },
  'guardian B': { bpm: 132, bpb: 4, key: 'D minor', pcs: [2, 4, 5, 7, 9, 10, 0], chroma: [1], lead: 'brass', reg: [62, 74], rate: [5, 8], motif: 3, bell: 'none', mood: 'the guardian\'s second phase: trombones, the choir' },
  'guardian C': { bpm: 132, bpb: 4, key: 'A minor', pcs: [9, 11, 0, 2, 4, 5, 7], chroma: [8], lead: 'brass', reg: [68, 77], rate: [5, 8], motif: 3, bell: 'the held season\'s bell (tubular) on the motif in long notes', mood: 'the last phase: everything' },
  'hushedking A': { bpm: 108, bpb: 4, key: 'D minor', pcs: [2, 4, 5, 7, 9, 10, 0], chroma: [1, 11], lead: 'brass', reg: [62, 74], rate: [3, 6], motif: 3, bell: 'the Hush Bell (minor D3) every four bars', mood: 'the Bellkeeper: a bell-founder\'s grief — the lullaby in minor, tragic, not evil' },
  'hushedking B': { bpm: 108, bpb: 4, key: 'D minor', pcs: [2, 4, 5, 7, 9, 10, 0], chroma: [1], lead: 'brass', reg: [45, 74], rate: [3, 7], motif: 'retro', bell: 'the cantor\'s handbells; the retrograde in the trombones', mood: 'the Court: the choir, the low brass' },
  'hushedking C': { bpm: 108, bpb: 4, key: 'D minor', pcs: [2, 4, 5, 7, 9, 10, 0], chroma: [1, 6, 11], lead: 'brass', reg: [62, 77], rate: [3.5, 8], motif: 'retro', bell: 'the Hush Bell\'s retrograde (great bells) against Linnet\'s motif forward (tubular, in major)', mood: 'the Crown: the climax, the two bells fighting' },
  'hushedking rest': { bpm: 60, bpb: 3, key: 'D major', pcs: [2, 4, 6, 7, 9, 11, 1], lead: 'solo', reg: [50, 64], rate: [0.5, 1.5], motif: 3, bell: 'the celesta\'s motif, then silence', mood: 'the reconciliation: the cello sings the lullaby and stops at "Rest, little year—"' },
  'firstspring frozen': { bpm: 66, bpb: 3, key: 'B minor', pcs: [11, 1, 2, 4, 6, 7, 9], lead: 'chime', reg: [66, 83], rate: [0.3, 1], motif: 3, bell: 'the music box\'s motif, slow, a bar of silence where its D would be', mood: 'the frozen hub at dawn: anticipation' },
  'firstspring A': { bpm: 66, bpb: 3, key: 'D major', pcs: [2, 4, 6, 7, 9, 11, 1], lead: 'flute', reg: [74, 88], rate: [2, 4], motif: 4, bell: 'the four Season Bells (great bells A3 F#3 B3 D3) at the song\'s line endings: the motif complete', mood: 'the first spring: the whole song, joy' },
};

// ---------------------------------------------------------------------------------------------
// Pieces the sections share
// ---------------------------------------------------------------------------------------------

/**
 * `Score.voiced` with no note a semitone from a held melody note sounding with it (a beat or longer:
 * a passing note may rub, a held one may not — the critic's clash, CINEMATIC_CAMPAIGNS §9.4): those
 * notes added to `not` in the voicing's range. The melodies are written first, as the kit wants.
 * @param {Score} S @param {any} kind @param {number} bar @param {number} beat @param {number} beats @param {string} chord @param {any} opts
 */
function clear(S, kind, bar, beat, beats, chord, opts) {
  const from = S.at(bar, beat);
  const to = from + beats;
  const pcs = new Set(S.leads.filter((l) => l.to - l.from >= 1 && l.from < to && l.to > from).map((l) => pcOf(l.midi)));
  const not = [...(opts.not ?? [])];
  for (let m = opts.lo; m <= opts.hi; m++) if (pcs.has(pcOf(m + 1)) || pcs.has(pcOf(m - 1))) not.push(m);
  return S.voiced(kind, bar, beat, beats, chord, { ...opts, not });
}

/**
 * A fight section (the region's colour aside): the motto (the motif's first three notes — 5̂ 3̂ 8̂ of
 * the relative major, ♭7̂ 5̂ 8̂ of the minor key — in diminution, then an answer) on the horns, a 3 +
 * 3 + 2 spiccato ostinato in the celli, the basses on the root, trombone stabs, a tremolo halo,
 * war drums, the timpani, a cymbal swell into the loop. `tonic` the minor key's tonic (the horn's
 * register), `prog` 8 chords, `oct` the ostinato's octave shift.
 * @param {Score} S
 * @param {{ tonic: number, prog: string[], vel?: number, drums?: number, ostLo?: number }} o
 */
function fightCore(S, { tonic, prog, vel = 0.72, drums = 0.78, ostLo = 38 }) {
  S.mel('brass', 0, steps(tonic, '10:.5 7:.5 12:1.5 10:.5 7:1 | 8:1.5 7:.5 5:1 3:1 | 5:.5 7:.5 8:1.5 7:.5 5:1 | 7:4 | '
    + '10:.5 7:.5 12:1.5 14:.5 15:1 | 12:1.5 10:.5 8:1 7:1 | 5:1 8:1 7:1 11:1 | 12:4'), { fam: 'hn', art: 'sus', vel, lead: true });
  S.each(prog, (c, b) => {
    S.ost('strings', b, c, 'XxxXxxXx', { lo: ostLo, offs: [0, 0, 12, 0, 0, 12, 0, 7], dur: 0.42, vel: 0.5, sec: 'vc', art: 'spic', line: 'L' });
    for (const bt of [0, 2]) S.bass('strings', b, bt, c, { lo: 28, hi: 43, near: 35, desks: 'cb', dur: 1.8, vel: 0.5, art: 'marc', line: 'B' });
    S.steps('drum', b, b === 7 ? 'B.x.B.xxBxBxBxBx' : b % 2 ? 'B..xb.x.B.x.b.xx' : 'B..xb.x.B..xb.x.', drums, { big: 'great', small: 'taiko' });
  });
  S.each(prog, (c, b) => {
    clear(S, 'brass', b, 0, 0.5, c, { lo: 48, hi: 64, n: 3, fam: 'tbn', art: 'stab', vel: 0.5, chain: 'stab', avoid: 'tune' });
    clear(S, 'brass', b, 2.5, 0.5, c, { lo: 48, hi: 64, n: 3, fam: 'tbn', art: 'stab', vel: 0.42, chain: 'stab', avoid: 'tune' });
    clear(S, 'strings', b, 0, 4, c, { lo: 64, hi: 84, n: 3, chain: 'halo', sec: 'vn', art: 'trem', vel: 0.22, avoid: 'lead', gap: 2 });
  });
  for (const b of [0, 4]) S.add('timp', S.at(b), { midi: timpOf(prog[b]), vel: S.hum(0.7) });
  S.roll('timp', 7, 2, 2, 0.15, 0.7, { midi: timpOf(prog[0]) });
  S.add('cymbal', S.at(7), { dur: 4, swell: true, vel: S.hum(0.4) });
}

// ---------------------------------------------------------------------------------------------
// The tracks
// ---------------------------------------------------------------------------------------------

/**
 * The Bells of Evermere's tracks (§5.7). `bpb` beats per bar (3: 3/4, or 6/8 in quarter beats);
 * each section `{ bars, bpm?, bpb?, level?, write(S) }`; `mix` the instance's bus levels (the bells'
 * own: `bells` the great and tubular bells, `metal` the handbells, `lute` the celesta); `order` as
 * for AudioSystem's COMBAT_TRACKS. A region's frozen and season sections keep one tempo and meter,
 * hold no note past a bar (pedals two bars and a beat): the thaw moves between them at any bar line.
 * @type {Record<string, ScoreTrackDef>}
 */
export const EV_SCORE_TRACKS = {
  // Evermere frozen at the blue hour of the last night: melancholy and warmth — a music box plays
  // the lullaby in B minor and stops where Linnet stops; then the flute low and warm
  hush: {
    title: 'Evermere at the Blue Hour', bpm: 66, bpb: 3, seed: 0xe7e5a, order: 'alternate', start: 'A', gain: 1,
    mix: { lute: 1.4, harp: 0.75, va: 0.9, vc: 0.9, cb: 0.75, flute: 1.35, bells: 0.9, far: 1 },
    eq: { lute: EQ.celesta },
    sections: {
      A: {
        bars: 16,
        level: 0.85,
        // M  the celesta (a music box) plays the song an octave up, F♯5–E6, and stops at bar 13
        // H  violas and a cello sul tasto, ppp (under the box's ringing); the harp's eighths in B2–F♯4
        // B  the basses on the bass, a dotted half a bar
        // Bl the motif's three notes far off on the tubular bells (A4, F♯4, B4: bars 3, 7, 11)
        write(S) {
          const prog = ['Bm', 'Bm', 'G', 'A', 'Em', 'Bm', 'Em', 'F#', 'Bm', 'G', 'A', 'Bm', 'G', 'Em', 'Em', 'F#'];
          S.mel(CHIME, 0, `${SONG_1} | ${SONG_2} | ${SONG_3} | ${SONG_4_STOPS}`, { oct: 1, vel: 0.76, lead: true });
          S.each(prog, (c, b) => {
            S.bass('strings', b, 0, c, { lo: 35, hi: 47, near: 35, desks: 'cb', dur: 2.8, vel: 0.21, line: 'B' });
            // (bars 14–15: the music box has stopped — the harp holds its breath with it)
            if (b < 14) S.arp(b, c, { lo: 47, n: 6, step: 0.5, pat: [0, 1, 2, 3, 4, 5], vel: 0.17, beats: b % 4 === 3 || b === 13 ? 1 : 3 });
          });
          // (the strings sink as the box runs down: its last note rings over them)
          S.each(prog, (c, b) => clear(S, 'strings', b, 0, 3, c, {
            lo: 50, hi: 64, n: 3, chain: 'H', split: [['strings/vc', 1], ['strings/va', 2]], art: 'sus', tasto: true, vel: b < 13 ? 0.1 : 0.08, tie: true,
          }));
          for (const [b, m] of [[3, 69], [7, 66], [11, 71]]) S.add(TUBULAR, S.at(b), { midi: m, vel: S.hum(0.45), far: true });
        },
      },
      B: {
        bars: 16,
        // M  the flute low and warm, D4–B4
        // C  the celesta's motif over the bars 8–10 (A5 F♯5 B5) — and the D of bar 11 missing
        // H, B as A, the strings without the mute; the harp a little more
        // Bl the tubular bells far off: A4 at bar 3, F♯4 at bar 7
        write(S) {
          const prog = ['D', 'D', 'G', 'A', 'D', 'Bm', 'G', 'A', 'Bm', 'D', 'Em', 'D', 'Em', 'G', 'Em', 'F#'];
          S.mel('flute', 0, 'D4:2 F#4:1 | A4:2 B4:1 | A4:1.5 G4:.5 F#4:1 | E4:3 | F#4:2 A4:1 | D5:2 C#5:1 | B4:1 A4:1 G4:1 | A4:3 | '
            + 'B4:2 A4:1 | F#4:2 D4:1 | G4:1.5 F#4:.5 E4:1 | F#4:3 | E4:2 F#4:1 | G4:2 A4:1 | B4:1 A4:1 E4:1 | F#4:3', { vel: 0.72, lead: true });
          S.mel(CHIME, 8, 'A5:3 | F#5:3 | B5:3', { vel: 0.5, lead: true, line: 'motif' });
          S.each(prog, (c, b) => {
            S.bass('strings', b, 0, c, { lo: 35, hi: 47, near: 38, desks: 'cb', dur: 2.8, vel: 0.28, line: 'B' });
            S.arp(b, c, { lo: 52, n: 6, step: 0.5, pat: [0, 1, 2, 3, 4, 5], vel: 0.28 });
          });
          S.each(prog, (c, b) => clear(S, 'strings', b, 0, 3, c, {
            lo: 54, hi: 64, n: 3, chain: 'H', sec: 'va', art: 'sus', vel: 0.26, tie: true,
          }));
          for (const [b, m] of [[3, 69], [7, 66]]) S.add(TUBULAR, S.at(b), { midi: m, vel: S.hum(0.42), far: true });
        },
      },
    },
  },

  // the Blossomwood: frozen (the celesta's motif under ice), then spring — wonder to a first
  // triumph, the Bell of Waking ringing the motif's first note
  waking: {
    title: 'The Blossomwood Wakes', bpm: 76, seed: 0xa1c09, order: 'hold', start: 'A', gain: 1,
    mix: { flute: 1.2, hn: 1.2, harp: 0.75, va: 0.85, vc: 0.95, cb: 0.85, vn: 0.8, drone: 0.75, lute: 1.35, bells: 1, timp: 0.7, metal: 0.8 },
    eq: { lute: EQ.celesta, hn: EQ.hornPresence },
    sections: {
      frozen: {
        bars: 8,
        level: 0.8,
        // M  the celesta's motif D5 B4 E5 (G major's 5̂ 3̂ 6̂ over E minor), answered, A4–G5
        // H  violins' tremolo sul ponticello high above it (the ice), pp
        // B  the drone E2 B2, re-spoken every 2 bars
        // C  the harp's single notes, like drops
        write(S) {
          const prog = ['Em', 'Em', 'Cmaj7', 'Cmaj7', 'Em', 'Am', 'C', 'B'];
          S.mel(CHIME, 0, 'r:1 D5:2 B4:1 | E5:4 | r:2 F#5:1 D5:1 | E5:4 | r:1 D5:2 B4:1 | A4:4 | r:2 B4:1 C5:1 | B4:4', { vel: 0.78, lead: true });
          for (let b = 0; b < 8; b++) S.chord('drone', b, 0, b < 7 ? 5 : 4, b === 7 ? [47] : [40, 47], { vel: 0.26, respeak: true });
          S.each(prog, (c, b) => {
            clear(S, 'strings', b, 0, 4, c, { lo: 83, hi: 95, n: 2, chain: 'ice', sec: 'vn', art: 'trem', pont: true, vel: 0.08, tie: true });
            if (b % 2) S.add('harp', S.at(b, 2.5), { midi: pcFrom(chordOf(c).root, 64), vel: S.hum(0.24), pan: 0.2 });
          });
        },
      },
      A: {
        bars: 16,
        // M  the flute's spring theme, opening on the motif (D5 B4 E5), G4–A5
        // C  the horn's counter (bars 8–15), G3–E4: the first triumph
        // H  violas and a cello; the harp's eighths from G2
        // B  basses and celli on the bass, half notes
        // Bl the Bell of Waking (tubular D5) on bars 0, 4, 8, 12; its motif far off in bar 7
        // percussion: a timpani roll into bar 8, a cymbal swell into the loop
        write(S) {
          const prog = ['G', 'D/F#', 'Em', 'C', 'G', 'Am', 'D', 'D', 'C', 'G/B', 'Am', 'D', 'G', 'A', 'C', 'D'];
          S.mel('flute', 0, 'D5:2 B4:1 C5:1 | E5:3 D5:1 | B4:1.5 A4:.5 G4:1 B4:1 | A4:4 | B4:1 D5:1 G5:2 | F#5:1.5 E5:.5 C5:2 | A4:1 B4:1 C5:1 D5:1 | D5:4 | '
            + 'E5:1.5 D5:.5 C5:1 E5:1 | D5:2 B4:2 | C5:1 E5:1 A5:1 G5:1 | F#5:4 | G5:2 D5:1 B4:1 | C#5:1.5 D5:.5 E5:2 | E5:1 D5:1 C5:1 A4:1 | A4:2 C5:2', { vel: 0.78, lead: true });
          S.mel('brass', 8, 'E4:2 D4:2 | D4:4 | C4:2 E4:2 | D4:4 | B3:2 D4:2 | C#4:2 E4:2 | C4:2 E4:2 | D4:4', { fam: 'hn', art: 'sus', vel: 0.5, lead: true, line: 'counter' });
          S.each(prog, (c, b) => {
            for (const bt of [0, 2]) S.bass('strings', b, bt, c, { lo: 31, hi: 43, near: 43, desks: 'both', dur: 1.8, vel: 0.38, line: 'B' });
            S.arp(b, c, { lo: 43, n: 6, step: 0.5, pat: [0, 1, 2, 3, 4, 5, 4, 3], vel: 0.34 });
          });
          S.each(prog, (c, b) => clear(S, 'strings', b, 0, 4, c, {
            lo: 52, hi: 67, n: 3, chain: 'H', sec: 'va', art: 'sus', vel: 0.28, tie: true,
          }));
          for (const b of [0, 4, 8, 12]) S.add(TUBULAR, S.at(b), { midi: 74, vel: S.hum(b === 8 ? 0.6 : 0.48) });
          for (const [bt, m] of [[0, 74], [1.5, 71], [3, 76]]) S.add(TUBULAR, S.at(7, bt), { midi: m, vel: S.hum(0.36), far: true });
          S.roll('timp', 7, 2, 2, 0.12, 0.5, { midi: 38 });
          S.add('timp', S.at(8), { midi: 43, vel: S.hum(0.5) });
          S.add('cymbal', S.at(15), { dur: 4, swell: true, vel: S.hum(0.28) });
        },
      },
    },
  },

  // Saltcombe: frozen (comedy and heartbreak: a ledger's tick, the flute's lament), then summer —
  // hope in a lilting 6/8, the Bell of Tides on the motif's second note
  tides: {
    title: 'The Tides of Saltcombe', bpm: 78, bpb: 3, seed: 0x71de5, order: 'hold', start: 'A', gain: 1,
    mix: { flute: 1.05, hn: 1.15, vn: 0.75, va: 0.85, vc: 0.95, cb: 0.85, harp: 0.75, drone: 0.75, lute: 1.05, bells: 1, drums: 0.5, timp: 0.6 },
    eq: { lute: EQ.celesta, drums: EQ.boom },
    sections: {
      frozen: {
        bars: 8,
        level: 1,
        // M  the flute's lament, opening on the motif (E5 C♯5 F♯5: A major's 5̂ 3̂ 6̂ over F♯ minor), G♯4–F♯5
        //    (the solo cello's once, an octave down: the listener chose the flute, 2026-10-29)
        // C  the violins' spiccato tick on the chord (Wenna's ledger), bars 0–3
        // B  the drone F♯2 C♯3, re-spoken every 2 bars; the basses' dotted halves
        // H  the violas, pp
        write(S) {
          const prog = ['F#m', 'D', 'Bm', 'C#', 'F#m', 'D', 'Bm', 'C#'];
          S.mel('flute', 0, 'E4:1.5 C#4:1.5 | F#4:3 | E4:1 D4:.5 C#4:1 B3:.5 | C#4:3 | A3:1.5 B3:.5 C#4:1 | D4:1.5 C#4:1.5 | B3:1 A3:.5 G#3:1.5 | C#4:3', { oct: 1, vel: 0.7, lead: true });
          for (let b = 0; b < 8; b++) S.chord('drone', b, 0, b < 7 ? 4 : 3, [42, 49], { vel: 0.3, respeak: true });
          S.each(prog, (c, b) => {
            if (b < 4) S.ost('strings', b, c, 'x.x.x.', { lo: 66, offs: [0, 7, 12], dur: 0.3, vel: 0.26, sec: 'vn', art: 'spic', line: 'tick' });
            clear(S, 'strings', b, 0, 3, c, { lo: 57, hi: 69, n: 2, chain: 'H', sec: 'va', art: 'sus', tasto: true, vel: 0.22, tie: true });
          });
        },
      },
      A: {
        bars: 16,
        // M  the flute's 6/8 tune, E4–A5, in slurred pairs (a fiddle once: a listener found it
        //    jarring, 2026-10-29)
        // C  the horn rising under it (bars 8–15), F♯3–D4: hope
        // H  the violas' pad; the harp's eighths
        // B  basses and celli on the dotted beats
        // Bl the Bell of Tides (tubular C♯5) on bars 0 and 8; the motif's peal (E5 C♯5 F♯5) into the loop
        // percussion: a low tom on the lilt, the timpani every 4 bars
        write(S) {
          const prog = ['A', 'D', 'Bm', 'A', 'A', 'A', 'E', 'E', 'D', 'E', 'A', 'A', 'D', 'Bm', 'E', 'A'];
          S.mel('flute', 0, 'E5:1_ C#5:.5 E5:1.5_ | F#5:1.5_ E5:1.5 | D5:1_ C#5:.5 B4:1_ A4:.5_ | C#5:3 | A4:1_ B4:.5 C#5:1_ D5:.5_ | E5:1.5_ A5:1.5 | G#5:1_ F#5:.5 E5:1_ D5:.5_ | E5:3 | '
            + 'F#5:1_ E5:.5 D5:1_ C#5:.5_ | B4:1.5_ E5:1.5 | C#5:1_ D5:.5 E5:1_ F#5:.5_ | E5:3 | D5:1_ C#5:.5 B4:1_ A4:.5_ | F#4:1.5_ B4:1.5 | A4:1_ G#4:.5 B4:1.5_ | A4:3', { vel: 0.72, lead: true });
          S.mel('brass', 8, 'A3:3 | G#3:3 | A3:3 | C#4:3 | F#3:3 | D4:3 | B3:1.5 D4:1.5 | C#4:3', { fam: 'hn', art: 'sus', vel: 0.5, lead: true, line: 'counter' });
          S.each(prog, (c, b) => {
            for (const bt of [0, 1.5]) S.bass('strings', b, bt, c, { lo: 33, hi: 45, near: 33, desks: 'both', dur: 1.4, vel: bt ? 0.3 : 0.4, line: 'B' });
            S.arp(b, c, { lo: 45, n: 6, step: 0.5, pat: [0, 2, 4, 5, 4, 2], vel: 0.3 });
            S.steps('drum', b, 'x.....x.....', 0.32, { big: 'tom', small: 'tom' });
          });
          S.each(prog, (c, b) => clear(S, 'strings', b, 0, 3, c, { lo: 52, hi: 64, n: 2, chain: 'H', sec: 'va', art: 'sus', vel: 0.24, tie: true }));
          for (const b of [0, 8]) S.add(TUBULAR, S.at(b), { midi: 73, vel: S.hum(0.52) });
          for (const [bt, m] of [[0, 76], [1, 73], [2, 78]]) S.add(TUBULAR, S.at(15, bt), { midi: m, vel: S.hum(0.34) });
          for (const b of [0, 4, 8, 12]) S.add('timp', S.at(b), { midi: timpOf(prog[b], 40), vel: S.hum(0.42) });
        },
      },
    },
  },

  // Amberfield: frozen (dread to the low point — a slow heartbeat, a low choir, Brother Fallow's
  // lone handbell), then autumn — grace at the golden hour, the Bell of Harvest on the motif's third note
  harvest: {
    title: 'Amberfield at the Golden Hour', bpm: 69, seed: 0xa4be5, order: 'hold', start: 'A', gain: 1.15,
    mix: { flute: 0.72, choir: 0.85, vn: 0.8, va: 0.85, vc: 0.9, cb: 0.75, harp: 0.65, drone: 0.75, drums: 0.5, timp: 0.65, bells: 1, metal: 0.9 },
    eq: { drums: EQ.boom },
    sections: {
      frozen: {
        bars: 8,
        level: 1,
        // M  the flute, low and breathy, opening on the motif (B♭4 G4 C5: E♭ major's 5̂ 3̂ 6̂ over C minor),
        //    C4–C5 (the solo cello's once, an octave down: the listener chose the flute, 2026-10-29)
        // H  a low "oo" choir, G3–G4, pp
        // B  the drone C2 G2, re-spoken every 2 bars
        // Bl Brother Fallow's handbell (G5) alone, every two bars
        // percussion: the great drum's slow heartbeat
        write(S) {
          const prog = ['Cm', 'Ab', 'Fm', 'G', 'Cm', 'Eb', 'G', 'Cm'];
          S.mel('flute', 0, 'Bb3:2 G3:2 | C4:3 r:1 | Ab3:1.5 G3:.5 F3:1 Eb3:1 | D3:4 | Eb3:2 G3:1 Ab3:1 | Bb3:2 Ab3:1 G3:1 | F3:1 Eb3:1 D3:2 | C3:4', { oct: 1, vel: 0.95, lead: true });
          for (let b = 0; b < 6; b++) S.chord('drone', b, 0, 5, [2, 4, 5].includes(b) ? [36] : [36, 43], { vel: 0.34, respeak: true });
          S.each(prog, (c, b) => {
            clear(S, 'choir', b, 0, 4, c, { lo: 55, hi: 67, n: 3, vowel: 'u', vel: 0.3, tie: true });
            S.steps('drum', b, 'b.....o.........', 0.42, { big: 'great', small: 'tom' });
          });
          for (const b of [0, 2, 4, 6]) S.add(HANDBELL, S.at(b, 1), { midi: 79, vel: S.hum(0.4) });
        },
      },
      A: {
        bars: 16,
        // M  the flute's air, the old horn chorale an octave up, E♭4–G5, slurred stepwise (a horn
        //    chorale once: a listener found it jarring, 2026-10-29)
        // C  an "ah" choir around it (bars 8–15), E♭4–F5
        // H  the harp's triplets from E♭2; the celli and basses on the bass
        // Bl the Bell of Harvest (tubular C5) on bars 0 and 8; the handbells' peal (bar 7); the
        //    motif's peal (B♭4 G4 C5) into the loop
        // percussion: a timpani roll into bar 8 and the loop
        write(S) {
          const prog = ['Eb', 'Eb', 'Bb', 'Eb', 'Eb', 'Cm', 'Bb', 'Bb', 'Cm', 'Eb', 'Ab', 'Bb', 'Cm', 'Ab', 'Bb', 'Eb'];
          S.mel('flute', 0, 'Bb3:2 G3:1_ C4:1 | Bb3:3 Eb4:1_ | D4:1.5_ C4:.5_ Bb3:1_ Ab3:1_ | G3:4 | G3:1 Ab3:1_ Bb3:1_ C4:1_ | Eb4:2_ D4:1_ C4:1_ | Bb3:1.5_ Ab3:.5_ G3:1_ F3:1 | Bb3:4 | '
            + 'Eb4:2_ D4:1_ C4:1_ | Bb3:2_ G3:2 | Ab3:1_ C4:1_ Eb4:1_ G4:1_ | F4:4 | Eb4:1.5_ D4:.5_ C4:1_ Bb3:1_ | Ab3:2_ C4:2_ | Bb3:1_ G3:1_ Ab3:1_ F3:1_ | Eb3:4', { oct: 1, vel: 0.68, lead: true });
          S.each(prog, (c, b) => {
            for (const bt of [0, 2]) S.bass('strings', b, bt, c, { lo: 31, hi: 43, near: 39, desks: 'both', dur: 1.8, vel: 0.3, line: 'B' });
            S.arp(b, c, { lo: 46, n: 6, step: 1 / 3, pat: [0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 2, 1], vel: 0.24 });
            if (b >= 8) clear(S, 'choir', b, 0, 4, c, { lo: 63, hi: 77, n: 3, vowel: 'a', vel: 0.34, tie: true });
          });
          for (const b of [0, 8]) S.add(TUBULAR, S.at(b), { midi: 72, vel: S.hum(0.5) });
          for (const [bt, m] of [[0, 86], [1, 84], [2, 82], [3, 77]]) S.add(HANDBELL, S.at(7, bt), { midi: m, vel: S.hum(0.36) });
          for (const [bt, m] of [[0, 70], [1.33, 67], [2.67, 72]]) S.add(TUBULAR, S.at(15, bt), { midi: m, vel: S.hum(0.32) });
          S.roll('timp', 7, 2, 2, 0.1, 0.45, { midi: 46 });
          S.add('timp', S.at(8), { midi: 36, vel: S.hum(0.45) });
          S.roll('timp', 15, 2, 2, 0.1, 0.45, { midi: 46 });
        },
      },
    },
  },

  // the climb to Rimeholt at night under the aurora: ominous — the Hush Bell's motif backwards,
  // far, rolling down the mountain; a low horn climbing; then the citadel near
  rimeholt: {
    title: 'The Hush on Rimeholt', bpm: 60, seed: 0x41e01, order: 'alternate', start: 'A', gain: 1,
    mix: { hn: 1.5, tbn: 1.1, tba: 1, choir: 0.9, vn: 0.8, vc: 1.2, cb: 1, far: 1.3, bells: 1, drums: 0.6, timp: 0.7, metal: 0.8 },
    eq: { drums: EQ.boom, hnc: EQ.cuivre },
    sections: {
      A: {
        bars: 8,
        level: 1.15,
        // Bl the Hush Bell's retrograde far off (minor great bells D3 B♭2 F3 A2), bars 0–3
        // M  the cuivré horn's climb from bar 4, D3–C4
        // L  the celli's marcato 8ths on D (3 + 3 + 2)
        // H  a low "oh" choir; the aurora: a violin tremolo sul ponticello high, pp
        // percussion: the great drum far, twice a bar
        write(S) {
          const prog = ['Dm', 'Bb', 'F', 'A', 'Dm', 'Bb', 'Gm', 'Dm'];
          S.mel('brass', 4, 'D3:2 F3:1 G3:1 | A3:3 Bb3:1 | A3:1.5 G3:.5 F3:1 E3:1 | D3:4', { fam: 'hn', art: 'sus', cuivre: true, vel: 0.62, lead: true });
          RETRO.forEach((off, b) => S.add(BELL, S.at(b), { midi: [50, 46, 53, 45][b], minor: true, decay: 6, vel: S.hum(0.62), far: true }));
          S.each(prog, (c, b) => {
            S.ost('strings', b, c, 'X.x.X.x.', { lo: 38, offs: [0, 0, 12, 0], dur: 0.42, vel: 0.42, sec: 'vc', art: 'marc', line: 'L' });
            clear(S, 'choir', b, 0, 4, c, { lo: 57, hi: 69, n: 3, vowel: 'o', vel: 0.3, tie: true });
            clear(S, 'strings', b, 0, 4, c, { lo: 84, hi: 96, n: 2, chain: 'aurora', sec: 'vn', art: 'trem', pont: true, vel: 0.12, tie: true });
            S.steps('drum', b, 'B.......b.......', 0.6, { big: 'great', small: 'tom', far: true });
          });
        },
      },
      B: {
        bars: 8,
        level: 1.05,
        // M  the horn's climb on (the trombones at the octave below where it is clear), E3–D4
        // Bl the retrograde near, high, on the tubular bells (D5 B♭4 F5 A4), bars 0–3
        // L  the celli's 8ths; B the basses on the bass
        // H  the "ah" choir above the horn
        // percussion: the timpani on D, a roll into the loop; the great drum near
        write(S) {
          const prog = ['Dm', 'F', 'Bb', 'A', 'Dm', 'Gm', 'A', 'Dm'];
          S.mel('brass', 0, 'F3:2 A3:1 Bb3:1 | C4:3 D4:1 | Bb3:1.5 A3:.5 G3:1 F3:1 | E3:4 | D3:2 F3:1 A3:1 | Bb3:3 A3:1 | G3:1 E3:1 C#3:1 E3:1 | D3:4', { fam: 'hn', art: 'sus', cuivre: true, vel: 0.7, lead: true });
          RETRO.forEach((off, b) => S.add(TUBULAR, S.at(b), { midi: 74 + off - (off > 6 ? 12 : 0), vel: S.hum(0.42) }));
          S.each(prog, (c, b) => {
            S.ost('strings', b, c, 'XxxXxxXx', { lo: 38, offs: [0, 0, 12, 0, 0, 12, 0, 7], dur: 0.42, vel: 0.45, sec: 'vc', art: 'marc', line: 'L' });
            S.bass('strings', b, 0, c, { lo: 28, hi: 43, near: 38, desks: 'cb', dur: 3.6, vel: 0.42, line: 'B' });
            clear(S, 'choir', b, 0, 4, c, { lo: 62, hi: 74, n: 3, vowel: 'a', vel: 0.34, tie: true });
            S.steps('drum', b, b === 7 ? 'B...b.b.B.b.bbbb' : 'B.......b...b...', 0.66, { big: 'great', small: 'tom' });
          });
          for (const b of [0, 4]) S.add('timp', S.at(b), { midi: 38, vel: S.hum(0.6) });
          S.roll('timp', 7, 2, 2, 0.15, 0.6, { midi: 38 });
        },
      },
    },
  },

  // the fights, a section per region (named after the region's track: CombatMusic plays the one of
  // the level's explore track) — driving, cold, the motif's three notes as the motto
  hushfight: {
    title: 'The Hushguard March', bpm: 120, seed: 0xf1a47, order: 'hold', start: 'hush', gain: 1.05,
    mix: { hn: 2, tbn: 0.85, vc: 1.05, cb: 0.8, vn: 0.7, drums: 0.52, timp: 0.6, metal: 0.8, lute: 0.8, flute: 1.1, fiddle: 1.6, choir: 0.8, bells: 1 },
    eq: { drums: EQ.boom, hn: EQ.hornPresence },
    sections: {
      // the raid on Evermere's frozen lake (B minor): the music box frantic — the celesta's motif in 8ths
      hush: {
        bars: 8,
        write(S) {
          const prog = ['Bm', 'G', 'Em', 'F#', 'Bm', 'G', 'Em', 'F#'];
          fightCore(S, { tonic: 59, prog, ostLo: 47 });
          S.each(prog, (c, b) => { if (b % 4 < 2) for (let k = 0; k < 8; k++) S.add(CHIME, S.at(b, k * 0.5), { midi: [81, 78, 83, 78][k % 4], vel: S.hum(k % 2 ? 0.18 : 0.25), line: 'box' }); });
        },
      },
      // the frozen wood (E minor): the flute doubling the motto's answer an octave up
      waking: {
        bars: 8,
        write(S) {
          const prog = ['Em', 'C', 'Am', 'B', 'Em', 'C', 'Am', 'B'];
          fightCore(S, { tonic: 52, prog, ostLo: 40 });
          S.mel('flute', 4, steps(64, '10:.5 7:.5 12:1.5 14:.5 15:1 | 12:1.5 10:.5 8:1 7:1 | 5:1 8:1 7:1 11:1 | 12:4'), { vel: 0.55, lead: true });
        },
      },
      // the bay ice (F♯ minor): the fiddle on the motto's answer an octave up
      tides: {
        bars: 8,
        write(S) {
          const prog = ['F#m', 'D', 'Bm', 'C#', 'F#m', 'D', 'Bm', 'C#'];
          fightCore(S, { tonic: 54, prog, ostLo: 42 });
          S.mel('fiddle', 4, steps(66, '10:.5 7:.5 12:1.5 14:.5 15:1 | 12:1.5 10:.5 8:1 7:1 | 5:1 8:1 7:1 11:1 | 12:4'), { vel: 0.55, lead: true });
        },
      },
      // the frozen wheat (C minor): a low "oo" choir, Brother Fallow's handbells in the fight
      harvest: {
        bars: 8,
        write(S) {
          const prog = ['Cm', 'Ab', 'Fm', 'G', 'Cm', 'Ab', 'Fm', 'G'];
          fightCore(S, { tonic: 60, prog, ostLo: 36 });
          S.each(prog, (c, b) => {
            clear(S, 'choir', b, 0, 4, c, { lo: 48, hi: 59, n: 3, vowel: 'u', vel: 0.32, tie: true });
            if (b % 2 === 0) for (const bt of [0, 2]) S.add(HANDBELL, S.at(b, bt), { midi: 79, vel: S.hum(0.34) });
          });
        },
      },
      // the citadel stair (D minor): the Hush Bell every two bars
      rimeholt: {
        bars: 8,
        write(S) {
          const prog = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'Gm', 'A'];
          fightCore(S, { tonic: 62, prog, ostLo: 38 });
          for (const b of [0, 2, 4, 6]) S.add(BELL, S.at(b), { midi: 50, minor: true, decay: 4, vel: S.hum(0.5) });
          S.each(prog, (c, b) => clear(S, 'choir', b, 0, 4, c, { lo: 50, hi: 60, n: 3, vowel: 'o', vel: 0.3, tie: true }));
        },
      },
    },
  },

  // the three guardians (Rimehart, Old Gullet, the Harvest Mawkin): phases A, B, C — the motif as a
  // motto (G E A: C major's 5̂ 3̂ 6̂ over A minor); a release, not a victory, at the end
  guardian: {
    title: 'The Guardians of the Held Year', bpm: 132, seed: 0x9a4d1, order: 'hold', start: 'A', gain: 1.05,
    mix: { hn: 2, tbn: 0.95, tba: 0.9, vc: 1.05, cb: 0.8, vn: 0.75, choir: 0.85, drums: 0.54, timp: 0.65, metal: 0.85, bells: 1 },
    eq: { drums: EQ.boom, hn: EQ.hornPresence },
    sections: {
      A: {
        bars: 8,
        level: 1.04,
        // M  the motto on the horns, C4–C5; L the celli's 3 + 3 + 2; B basses; H trombone stabs, a halo
        write(S) {
          const prog = ['Am', 'Dm', 'Dm', 'E', 'Am', 'F', 'E', 'Am'];
          S.mel('brass', 0, 'G4:1 E4:1 A4:2 | F4:1.5 E4:.5 D4:1 C4:1 | D4:1 E4:1 F4:1 D4:1 | E4:4 | G4:1 E4:1 A4:1.5 B4:.5 | C5:1.5 B4:.5 A4:1 G4:1 | F4:1 E4:1 D4:1 G#4:1 | A4:4', { fam: 'hn', art: 'sus', vel: 0.75, lead: true });
          guardianBed(S, prog, 0.7);
        },
      },
      B: {
        bars: 8,
        level: 1.05,
        // M  the motto in D minor (A F B♭), the trombones beneath where clear; H an "ah" choir above
        write(S) {
          const prog = ['Dm', 'Gm', 'Gm', 'A', 'Dm', 'Bb', 'A', 'Dm'];
          S.mel('brass', 0, 'A4:1 F4:1 Bb4:2 | G4:1.5 F4:.5 E4:1 D4:1 | E4:1 F4:1 G4:1 E4:1 | A4:4 | A4:1 F4:1 Bb4:1.5 C5:.5 | D5:1.5 C5:.5 Bb4:1 A4:1 | G4:1 F4:1 E4:1 C#5:1 | D5:4', { fam: 'hn', art: 'sus', vel: 0.8, lead: true });
          guardianBed(S, prog, 0.8);
          S.each(prog, (c, b) => clear(S, 'choir', b, 0, 4, c, { lo: 74, hi: 81, n: 2, vowel: 'a', vel: 0.32, tie: true }));
        },
      },
      C: {
        bars: 8,
        level: 1.0,
        // M  the motto high, A4–F5; Bl the held season's bell on the motif in long notes (tubular G4 E4 A4)
        write(S) {
          const prog = ['Am', 'F', 'C', 'G', 'Am', 'Dm', 'E', 'Am'];
          S.mel('brass', 0, 'E5:2 C5:1 B4:1 | A4:1.5 B4:.5 C5:1 D5:1 | E5:1 D5:1 C5:1 B4:1 | C5:2 B4:2 | A4:1 C5:1 E5:2 | F5:1.5 E5:.5 D5:1 C5:1 | B4:1 C5:1 D5:1 G#4:1 | A4:4', { fam: 'hn', art: 'sus', vel: 0.82, lead: true });
          guardianBed(S, prog, 0.85, 'XxXXxXXx');
          for (const [b, m] of [[0, 67], [1, 64], [2, 69]]) S.add(TUBULAR, S.at(b), { midi: m, vel: S.hum(0.5) });
          S.each(prog, (c, b) => clear(S, 'choir', b, 0, 4, c, { lo: 50, hi: 60, n: 3, vowel: 'o', vel: 0.34, tie: true }));
        },
      },
    },
  },

  // the Hushed King: phases A (the Bellkeeper — the lullaby in minor, a grief), B (the Court — the
  // retrograde in the trombones), C (the Crown — the Hush Bell's retrograde against Linnet's motif
  // forward); `rest`, the reconciliation (3/4): the cello sings the song and stops at its dash —
  // the story finishes the line. The track starts in `rest` (a story's `music hushedking` after the
  // crown: no fight runs); the boss fight asks for its phase (CombatMusic: A, then B, C)
  hushedking: {
    title: 'Grief of the Bell-Founder', bpm: 108, seed: 0x4ed61, order: 'hold', start: 'rest', gain: 0.95,
    mix: { hn: 1.55, tbn: 1.1, tba: 1, vc: 1.2, cb: 1.05, vn: 0.75, va: 0.8, choir: 0.95, solo: 1.7, drums: 0.62, timp: 0.8, metal: 0.85, bells: 1.05, lute: 1, harp: 0.6 },
    eq: { drums: EQ.boom, hn: EQ.hornPresence, solo: EQ.bowPresence },
    sections: {
      A: {
        bars: 8,
        // M  the song's first two lines in D minor on the horn, D4–D5; Bl the Hush Bell every 4 bars
        write(S) {
          const prog = ['Dm', 'Dm', 'Gm', 'A', 'A7', 'Dm', 'Gm', 'Dm'];
          S.mel('brass', 0, 'F4:1.5 E4:.5 D4:2 | A4:1.5 G4:.5 F4:2 | Bb4:1 A4:1 G4:1 F4:1 | A4:4 | D5:1.5 C#5:.5 Bb4:2 | A4:1.5 Bb4:.5 A4:2 | G4:1 E4:1 G4:1 E4:1 | F4:4', { fam: 'hn', art: 'sus', vel: 0.72, lead: true });
          kingBed(S, prog, 0.66);
          for (const b of [0, 4]) S.add(BELL, S.at(b), { midi: 50, minor: true, decay: 5, vel: S.hum(0.55) });
          // (the motif in the minor, far off on the bells: his own memory of the song — A F B♭)
          for (const [bt, m] of [[0, 69], [1, 65], [2, 70]]) S.add(TUBULAR, S.at(7, bt), { midi: m, vel: S.hum(0.4), far: true });
        },
      },
      B: {
        bars: 8,
        level: 1.04,
        // M  the horn, D4–D5; C the retrograde in the trombones (D3 B♭2 F3 A2), bars 0–3
        // H  an "ah" choir; Bl the cantor's handbells
        write(S) {
          const prog = ['Dm', 'Bb', 'F', 'A', 'Bb', 'Dm', 'A', 'Dm'];
          S.mel('brass', 0, 'A4:2 Bb4:1 A4:1 | G4:1.5 F4:.5 D4:2 | F4:1 G4:1 A4:1 C5:1 | Bb4:2 A4:2 | D5:2 C5:1 Bb4:1 | A4:1.5 G4:.5 F4:2 | E4:1 F4:1 G4:1 C#4:1 | D4:4', { fam: 'hn', art: 'sus', vel: 0.76, lead: true });
          S.mel('brass', 0, 'D3:4 | Bb2:4 | F3:4 | A2:4', { fam: 'tbn', art: 'sus', vel: 0.6, lead: true, line: 'retro' });
          kingBed(S, prog, 0.72, 'XxxXxxXx');
          S.each(prog, (c, b) => {
            if (b >= 4) clear(S, 'choir', b, 0, 4, c, { lo: 74, hi: 81, n: 2, vowel: 'a', vel: 0.3, tie: true });
            if (b % 2) S.add(HANDBELL, S.at(b, 3), { midi: 81, vel: S.hum(0.34) });
          });
        },
      },
      C: {
        bars: 8,
        level: 1.08,
        // M  the horn high, D4–F5; Bl the Hush Bell's retrograde (minor great bells) bars 0–3 against
        //    Linnet's motif forward in D major on the tubular bells (A4 F♯4 B4) bars 4–6
        // H  an "oh" choir under the horn
        write(S) {
          const prog = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'C', 'Gm', 'Dm'];
          S.mel('brass', 0, 'D5:1.5 C5:.5 A4:2 | Bb4:1.5 A4:.5 F4:2 | G4:1 A4:1 Bb4:1 D5:1 | C#5:4 | D5:1 E5:1 F5:2 | E5:1.5 D5:.5 C5:2 | Bb4:1 A4:1 G4:1 E4:1 | D4:4', { fam: 'hn', art: 'sus', vel: 0.82, lead: true });
          kingBed(S, prog, 0.8, 'XXxXXxXx');
          RETRO.forEach((off, b) => S.add(BELL, S.at(b), { midi: [50, 46, 53, 45][b], minor: true, decay: 4, vel: S.hum(0.6) }));
          for (const [b, m] of [[4, 69], [5, 66], [6, 71]]) S.add(TUBULAR, S.at(b), { midi: m, vel: S.hum(0.55) });
          S.each(prog, (c, b) => clear(S, 'choir', b, 0, 4, c, { lo: 50, hi: 60, n: 3, vowel: 'o', vel: 0.34, tie: true }));
        },
      },
      rest: {
        bars: 16,
        bpm: 60,
        bpb: 3,
        level: 1,
        // M  the solo cello sings the song in D, D3–E4, and stops at "Rest, little year—" (bar 13)
        // H  violins and violas sul tasto above it, pp; B the basses pp
        // C  the celesta's motif (A5 F♯5 B5) in the silence of bars 14–15 — and no D
        write(S) {
          const prog = ['D', 'Bm', 'G', 'A', 'G', 'D', 'Em', 'D', 'D', 'G', 'A', 'Bm', 'G', 'A', 'Bm', 'A'];
          S.mel('solo', 0, `${SONG_1} | ${SONG_2} | ${SONG_3} | ${SONG_4_STOPS}`, { oct: -1, vel: 0.74, lead: true });
          S.mel(CHIME, 14, 'A5:1 F#5:1 B5:1 | r:3', { vel: 0.42, lead: true, line: 'motif' });
          S.each(prog, (c, b) => {
            clear(S, 'strings', b, 0, 3, c, { lo: 64, hi: 77, n: 3, chain: 'H', split: [['strings/va', 1], ['strings/vn', 2]], art: 'sus', tasto: true, vel: 0.22, tie: true });
            S.bass('strings', b, 0, c, { lo: 31, hi: 43, near: 38, desks: 'cb', dur: 2.8, vel: 0.16, line: 'B' });
          });
        },
      },
    },
  },

  // the first spring: the frozen hub at dawn (the music box's motif, a bar of silence where its D
  // would be), then the whole song in D — the motif complete, the four Season Bells at its line ends
  firstspring: {
    title: 'The First Morning of the Year', bpm: 66, bpb: 3, seed: 0xd1a01, order: 'hold', start: 'A', gain: 1,
    mix: { flute: 1.25, hn: 1.15, vn: 0.85, va: 0.85, vc: 0.95, cb: 0.85, harp: 0.8, lute: 1.6, bells: 1.05, drone: 0.6, timp: 0.6, metal: 0.8 },
    eq: { lute: EQ.celesta },
    sections: {
      frozen: {
        bars: 8,
        level: 1,
        // M  the celesta's motif, slow (A5 F♯5 B5), and a bar's silence where the D would be
        // H  violas and a cello sul tasto, ppp; B the drone D2 A2, re-spoken every 2 bars
        write(S) {
          const prog = ['Bm', 'D', 'G', 'A', 'Bm', 'D', 'Em', 'A'];
          S.mel(CHIME, 0, 'A5:3 | F#5:3 | B5:3 | r:3 | A5:3 | F#5:3 | B5:3 | r:3', { vel: 0.85, lead: true });
          S.mel(CHIME, 0, 'A5:3 | F#5:3 | B5:3 | r:3 | A5:3 | F#5:3 | B5:3 | r:3', { oct: -1, vel: 0.55, lead: true });
          for (let b = 0; b < 8; b++) S.chord('drone', b, 0, b < 7 ? 4 : 3, [38, 45], { vel: 0.13, respeak: true });
          S.each(prog, (c, b) => clear(S, 'strings', b, 0, 3, c, {
            lo: 50, hi: 64, n: 3, chain: 'H', split: [['strings/vc', 1], ['strings/va', 2]], art: 'sus', tasto: true, vel: 0.1, tie: true,
          }));
        },
      },
      A: {
        bars: 16,
        // M  the whole song on the flute an octave up, D5–E6 — line 4 complete; the violins with it
        //    at pitch in lines 3–4
        // C  the horn's counter (bars 8–15), G3–D4
        // H  violas and a cello; the harp's eighths; B basses and celli
        // Bl the four Season Bells at the line endings: A3 (bar 3), F♯3 (7), B3 (11), D3 (15) —
        //    the motif complete; celesta birdsong (bars 1, 5, 9)
        write(S) {
          const prog = SONG_CHORDS;
          S.mel('flute', 0, `${SONG_1} | ${SONG_2} | ${SONG_3} | ${SONG_4}`, { oct: 1, vel: 0.76, lead: true });
          S.mel('strings', 8, `${SONG_3} | ${SONG_4}`, { sec: 'vn', art: 'sus', vel: 0.4, lead: true });
          S.mel('brass', 8, 'A3:3 | B3:3 | C#4:3 | D4:3 | B3:3 | A3:3 | G3:1.5 C#4:1.5 | D4:3', { fam: 'hn', art: 'sus', vel: 0.46, lead: true, line: 'counter' });
          S.each(prog, (c, b) => {
            S.bass('strings', b, 0, c, { lo: 31, hi: 43, near: 38, desks: 'both', dur: 2.8, vel: 0.36, line: 'B' });
            S.arp(b, c, { lo: 43, n: 6, step: 0.5, pat: [0, 1, 2, 3, 4, 5], vel: 0.32 });
          });
          S.each(prog, (c, b) => clear(S, 'strings', b, 0, 3, c, {
            lo: 52, hi: 66, n: 3, chain: 'H', sec: 'va', art: 'sus', vel: 0.26, tie: true,
          }));
          for (const [b, m] of [[3, 57], [7, 54], [11, 59], [15, 50]]) S.add(BELL, S.at(b), { midi: m, decay: 5, vel: S.hum(b === 15 ? 0.62 : 0.5) });
          for (const b of [1, 5, 9]) for (const [bt, m] of [[1.5, 93], [2, 90]]) S.add(CHIME, S.at(b, bt), { midi: m, vel: S.hum(0.22), line: 'birds' });
          S.roll('timp', 14, 1, 2, 0.1, 0.45, { midi: 45 });
          S.add('timp', S.at(15), { midi: 38, vel: S.hum(0.5) });
        },
      },
    },
  },
};

/**
 * The guardians' bed (`guardian` A–C): the celli's ostinato (`pat`), the basses, trombone stabs, a
 * tremolo halo, war drums, the timpani and a cymbal swell into the loop.
 * @param {Score} S @param {string[]} prog @param {number} drums @param {string} [pat]
 */
function guardianBed(S, prog, drums, pat = 'XxxXxxXx') {
  S.each(prog, (c, b) => {
    S.ost('strings', b, c, pat, { lo: 40, offs: [0, 0, 12, 0, 0, 12, 0, 7], dur: 0.42, vel: 0.52, sec: 'vc', art: 'spic', line: 'L' });
    for (const bt of [0, 2]) S.bass('strings', b, bt, c, { lo: 28, hi: 45, near: 33, desks: 'cb', dur: 1.8, vel: 0.5, art: 'marc', line: 'B' });
    S.steps('drum', b, b === 7 ? 'BxBxB.xxBxBxBxBx' : b % 2 ? 'B.xxb.x.B.xxb.xx' : 'B..xb.x.B.x.b.x.', drums, { big: 'great', small: 'taiko' });
  });
  S.each(prog, (c, b) => {
    for (const bt of [0, 1.5]) clear(S, 'brass', b, bt, 0.5, c, { lo: 48, hi: 62, n: 3, fam: 'tbn', art: 'stab', vel: bt ? 0.42 : 0.52, chain: 'stab', avoid: 'tune' });
    clear(S, 'strings', b, 0, 4, c, { lo: 76, hi: 88, n: 2, chain: 'halo', sec: 'vn', art: 'trem', vel: 0.2, avoid: 'lead' });
  });
  for (const b of [0, 4]) S.add('timp', S.at(b), { midi: timpOf(prog[b], 40), vel: S.hum(0.72) });
  S.roll('timp', 7, 2, 2, 0.15, 0.7, { midi: timpOf(prog[0], 40) });
  S.add('cymbal', S.at(7), { dur: 4, swell: true, vel: S.hum(0.42) });
}

/**
 * The King's bed (`hushedking` A–C): a heavy 3 + 3 + 2 ostinato (`pat`), the basses, trombone
 * stabs, war drums, the timpani, a cymbal swell into the loop.
 * @param {Score} S @param {string[]} prog @param {number} drums @param {string} [pat]
 */
function kingBed(S, prog, drums, pat = 'X.xX.xXx') {
  S.each(prog, (c, b) => {
    S.ost('strings', b, c, pat, { lo: 38, offs: [0, 12, 0, 12, 0, 12, 0, 7], dur: 0.45, vel: 0.5, sec: 'vc', art: 'marc', line: 'L' });
    for (const bt of [0, 2]) S.bass('strings', b, bt, c, { lo: 28, hi: 43, near: 38, desks: 'cb', dur: 1.8, vel: 0.48, art: 'marc', line: 'B' });
    S.steps('drum', b, b === 7 ? 'B...B.b.B.b.BbBb' : 'B.....b.B...b...', drums, { big: 'great', small: 'taiko' });
  });
  S.each(prog, (c, b) => clear(S, 'brass', b, 0, 0.5, c, { lo: 48, hi: 62, n: 3, fam: 'tbn', art: 'stab', vel: 0.48, chain: 'stab', avoid: 'tune' }));
  for (const b of [0, 4]) S.add('timp', S.at(b), { midi: timpOf(prog[b], 38), vel: S.hum(0.66) });
  S.roll('timp', 7, 2, 2, 0.12, 0.6, { midi: 38 });
  S.add('cymbal', S.at(7), { dur: 4, swell: true, vel: S.hum(0.38) });
}

/**
 * A score track built from its seed (AudioSystem `_combatTrack`, EvermereAudio.js): tempo, order,
 * sections, play RNG and its definition; null for another name. Throws when a score emits an event
 * kind not in `EV_KINDS`.
 * @param {string} name
 */
export function scoreTrack(name) {
  const score = ownValue(EV_SCORE_TRACKS, name);
  if (!score) return null;
  const rng = mulberry32(score.seed);
  return {
    name, title: score.title, bpm: score.bpm, order: score.order, start: score.start,
    sections: buildScoreSections(score, rng, EV_KINDS), rng: mulberry32(score.seed ^ 0x5bd1e995), score,
  };
}
