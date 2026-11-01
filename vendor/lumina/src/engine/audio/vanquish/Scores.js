/**
 * Scores — Vanquish the Evil Dragon's six tracks (docs/contracts/DRAGON_CAMPAIGN.md §6.9), written
 * with the scoring kit of ScoreKit.js: 'dread' (the opening), 'siege' (Sunhallow burning), 'ascent'
 * (the Wyrmspine), 'dragon' (Vorthrax), 'festival' (the bonfire jig) and 'triumph' (the credits).
 * Each track is built lazily on first use from its own seed (`scoreTrack`, AudioSystem
 * `_combatTrack`), like the combat tracks; the default song, 'battle' and 'boss' are untouched.
 * The instruments that play the events are ScoreVoices.js's and MusicRenders.js's.
 *
 * Orchestrated by register: each section is written melody first (`lead`), then the bass and the
 * pedals, then the harmony (one voicing per bar, voice-led, out of the melody's lane, clear of the
 * low-interval limits) and the colours; the plan of each section stands above it — B the basses,
 * L the celli, H the harmony, M the melody, C a counter-line or colour. Velocities are dynamics
 * (0–1); the track's `mix` balances the families — the melody on top, clear of the rest in its band —
 * and its `eq` (the mix EQ) eases the great drum's sub boom, lifts a lead's presence and eases the
 * cuivré horn's blare.
 *
 * Imports ScoreKit.js and the engine's utils only (it runs in Node: tools/test-vq-scores.mjs
 * builds every track there); imported only through VanquishAudio.js.
 */
import { mulberry32 } from '../../utils/math.js';
import { ownValue } from '../../utils/own.js';
import { buildScoreSections, chordOf, grind, grindAlt, pcFrom } from './ScoreKit.js';

/** @import { ScoreTrackDef } from './ScoreKit.js' */

/**
 * The siege's lament (E phrygian, E3–C4): a rise to the third that sinks onto the ♭2 and home, a
 * climb to the ♭6, its chromatic fall (C B B♭ A), the ♭2 again on the way down. A's solo cello plays
 * it at pitch; B's horn an octave up, the trombones at pitch.
 */
const SIEGE_THEME = 'E3:1.5 G3:.5 F3:2 | E3:3 r:1 | F3:1 A3:1 C4:1.5 B3:.5 | B3:4 | '
  + 'C4:1.5 B3:.5 Bb3:1 A3:1 | G3:1.5 F3:.5 E3:2 | D3:1 F3:1 A3:1.5 G3:.5 | E3:4';

/** The dragon's call (C locrian, two bars): the tritone up from C, its semitone's collapse, C again. */
const DRAGON_MOTIF = 'C3:2 Gb3:1.5 F3:.5 | C3:4';

/** C locrian's pitch classes (the dragon: G♭, never G; D♭ the only major chord). */
const LOCRIAN = [0, 1, 3, 5, 6, 8, 10];

/** The ascent's fight: G phrygian with its C♯ and F♯ (the grinds' ♭9s over C and F) — never an A natural. */
const NO_A = [0, 1, 2, 3, 5, 6, 7, 8, 10];

/** The timpani's note for a chord: its bass from `lo` up. */
const timpOf = (chord, lo) => pcFrom(chordOf(chord).bass, lo);

/**
 * A grinding stab or swell of the low brass on a chord (ScoreKit `grind`: the ♭9 over an open
 * fifth, kept in `mode`), placed by `Score.stack` with the grind's other colour to fall back on.
 * @param {import('./ScoreKit.js').Score} S @param {number} bar @param {number} beat @param {number} beats
 * @param {string|number[]} chord a chord name, or the notes themselves @param {object} opts `stack`'s
 * @param {number} [lo] the bass from (a chord name) @param {number[]} [mode]
 */
function grinding(S, bar, beat, beats, chord, opts, lo = 38, mode = undefined) {
  const g = typeof chord === 'string' ? grind(chord, lo, mode) : chord;
  return S.stack(bar, beat, beats, g, { alt: grindAlt(g, mode), ...opts });
}

/**
 * The mix EQ's shapes (a track's `eq`): the great drum's sub boom (its 52 Hz fundamental, most of
 * its power and little of its loudness) shelved down, its stroke kept; a lead's presence.
 * @type {Record<string, import('./ScoreKit.js').ScoreFilter[]>}
 */
const EQ = {
  boom: [['lowshelf', 70, 0, -5]],
  hornPresence: [['peaking', 2000, 1, 3]],
  bowPresence: [['peaking', 2500, 1, 3]],
  // (the cuivré horn's blare eased: its sub-bus's 2.8 kHz lift cancelled, its 1.2 kHz nasal peak kept for small speakers)
  cuivre: [['peaking', 3000, 1.2, -2.5]],
};

/** The second half of a 16-bar melody (its bars 8–15), for the doublings that enter there. */
const backHalf = (theme) => theme.split('|').slice(8).join('|');

/**
 * Vanquish the Evil Dragon's tracks. `bpb` beats per bar (3: the festival's 6/8 in quarter beats);
 * each section `{ bars, bpm?, level?, write(S) }` (`bpm`: its own tempo, taken at its first beat;
 * `level` scales its velocities); `mix`: the instance's bus levels; `gain` the whole track's level.
 * `order` as for COMBAT_TRACKS.
 * @type {Record<string, ScoreTrackDef>}
 */
export const SCORE_TRACKS = {
  // the opening: the party on the road, the village burning ahead, the dragon's shadow — low
  // drones, war drums far off, a tolling bell; then the choir, the horn's grim theme, closer drums
  dread: {
    title: 'Shadow over Sunhallow', bpm: 64, seed: 0xd4ead, order: 'alternate', start: 'A', gain: 1.05,
    // (the mix: the horn's theme over the choir and the low strings, the drums and timpani under them)
    mix: { far: 0.85, drone: 1, va: 1, vc: 1.05, cb: 0.9, flute: 1.1, choir: 1.05, hn: 1.55, tbn: 1, tba: 1, drums: 0.56, timp: 0.7, bells: 1, metal: 1 },
    eq: { drums: EQ.boom, hn: EQ.hornPresence },
    sections: {
      A: {
        bars: 8,
        // B  the drone D2 A2 (re-spoken at bar 4); it holds the slash basses
        // H  violas and a cello sul tasto, D3–E♭4, three notes (no slash bass: the drone has it)
        // M  the flute's motif an octave up, G4–E♭5 (bars 4–7)
        // percussion: far drums, a far toll on D3 every other bar, timpani rolls on D2, a cymbal swell into B
        write(S) {
          const prog = ['Dm', 'Dm', 'Eb/D', 'Dm', 'Gm/D', 'Gm/D', 'Eb/D', 'Dm'];
          S.mel('flute', 4, 'D4:2 Eb4:1 D4:1 | C4:3 A3:1 | Bb3:2 G3:2 | D4:4', { vel: 0.8, oct: 1, lead: true });
          S.chord('drone', 0, 0, 16, [38, 45], { vel: 0.5 });
          S.chord('drone', 4, 0, 16, [38, 45], { vel: 0.5, respeak: true });
          S.each(prog, (c, b) => {
            S.voiced('strings', b, 0, 4, c, {
              lo: 50, hi: 63, n: 3, chain: 'H', split: [['strings/vc', 1], ['strings/va', 2]], art: 'sus', tasto: true, vel: 0.35, tie: true,
            });
            S.steps('drum', b, b % 2 ? 'B.....x.B...x.x.' : 'B.....x.b.......', 0.9, { big: 'great', small: 'taiko', far: true });
          });
          for (const b of [0, 2, 4, 6]) S.add('toll', S.at(b), { midi: 50, vel: S.hum(0.35), decay: 5, far: true });
          S.roll('timp', 3, 2, 2, 0.12, 0.55, { midi: 38 });
          S.roll('timp', 7, 2, 2, 0.15, 0.7, { midi: 38 });
          S.add('cymbal', S.at(7), { dur: 4, swell: true, vel: S.hum(0.45) });
        },
      },
      B: {
        bars: 8,
        // B  the basses on beats 1 and 3, the bass line led by its nearest octave (D2 B♭1 G1 A1 …)
        // L  the celli's ostinato on the bass (D2 B♭2 G2 A2 …: where the celli reach the basses'
        //    note, on it), its octave leaps kept under the horn
        // H  the male choir "oh", A2–A3, three notes; in bars 3 and 7 it rests and the low brass swell
        //    the dominant (A1 / C♯3 E3) under the horn's C♯4
        // M  the horn's grim theme, A3–B♭4
        // percussion: closer drums, the timpani on the root of bars 0, 3, 4 and 7, a cymbal swell into A
        write(S) {
          const prog = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb', 'Eb', 'A'];
          S.mel('brass', 0, 'D4:1.5 A3:.5_ D4:1 F4:1 | F4:2 D4:1 Bb3:1 | G4:3 F4:.5_ D4:.5 | E4:2 C#4:1 A3:1 | '
            + 'D4:1.5 F4:.5_ A4:2 | Bb4:1.5 A4:.5_ F4:2 | G4:1.5 F4:.5_ Eb4:2 | E4:2 C#4:1 E4:1', { fam: 'hn', art: 'sus', vel: 0.72, lead: true });
          S.each(prog, (c, b) => {
            let cb = 0;
            for (const bt of [0, 2]) cb = S.bass('strings', b, bt, c, { lo: 28, hi: 45, near: 38, desks: 'cb', dur: 1.8, vel: 0.55, line: 'B' });
            // the ostinato on the bass's own note where the celli reach it, else an octave up: its
            // octave leaps stay under the horn (an octave higher they would land on its notes)
            S.ost('strings', b, c, 'X.x.X.x.X.x.X.x.', { root: cb >= 36 ? cb : cb + 12, offs: [0, 0, 12, 0, 0, 0, 12, 7], dur: 0.42, vel: 0.6, sec: 'vc', art: 'marc', line: 'L' });
            if (b === 3 || b === 7) S.stack(b, 0, 4, [33, 49, 52], { art: 'swell', vel: b === 3 ? 0.6 : 0.68, line: 'swell' });
            S.steps('drum', b, b === 7 ? 'B..xB.x.BxBxBxBx' : 'B..xB.x.B..xb.xx', 0.82, { big: 'great', small: 'taiko' });
            if (b === 0 || b === 3 || b === 4 || b === 7) S.add('timp', S.at(b), { midi: timpOf(c, 38), vel: S.hum(0.7) });
          });
          S.each(prog, (c, b) => {
            if (b !== 3 && b !== 7) S.voiced('choir', b, 0, 4, c, { lo: 45, hi: 57, n: 3, vowel: 'o', vel: 0.5, tie: true });
          });
          S.add('cymbal', S.at(7), { dur: 4, swell: true, vel: S.hum(0.55) });
        },
      },
    },
  },

  // the village battle under the dragon's shadow — a dirge, not a charge (92 bpm, E phrygian): a
  // pedal E in the drone and the low strings, the lament theme (a ♭2 sigh, a chromatic fall) on a
  // solo cello, then the low horn's answer over a chromatic descent, war drums far off in a
  // lurching 3 + 3 + 2, a funeral bell, cluster swells in the low brass. The fight (B) keeps the
  // tempo and the pedal: low 16ths accented 3 + 3 + 2 in each half bar with a semitone's grind
  // into the bar line, half-time war drums, grinding cluster stabs, the theme on the horn (the
  // trombones an octave below), then the choir around the horn and the cello's chromatic lament,
  // tremolo clusters at the end. Held notes last a bar at most, pedals 2 bars and a beat, so a
  // switch between the sections (at a bar line) leaves at most a bar of the other's sound
  siege: {
    title: 'Sunhallow Burns', bpm: 92, seed: 0x5e1e9, order: 'hold', start: 'A', gain: 1,
    // (the mix: the lament — solo cello, then the horns — over the pedal, the choir and the swells under it)
    mix: { solo: 1.9, hn: 1.7, tbn: 1.2, tba: 1.2, vc: 1.5, cb: 1.05, vn: 1, drone: 1, choir: 0.75, drums: 0.55, timp: 0.6, bells: 1, metal: 0.8, far: 0.7 },
    eq: { drums: EQ.boom, solo: EQ.bowPresence },
    sections: {
      A: {
        bars: 16,
        level: 0.85,
        // B  E1 on every other downbeat
        //    the drone E2 B2, re-spoken every 2 bars (phase-aligned), a beat into the next
        // L  the celli's E2 in 3 + 3 + 2
        // H  none in bars 0–7 (the lament outlines F and Dm itself); bars 8–15 the choir "oh" around
        //    the horn and the solo cello's fall — the pedal keeps the octave under them clear, so it
        //    sits mostly above them (A4–F5; E3 below in bars 8–9); in a swell bar its lower half rests
        // M  the solo cello's lament E3–C4 (0–7); the horn's answer E3–F4 (8–15)
        // C  the solo cello's chromatic fall A3 → A♭3 (12–13), the horn's own descent its end (G3 F3
        //    E3: it never crosses the horn); the low brass swells (bars 2, 6, 10,
        //    13, 15: the ♭2 against the pedal, the tritone, the open fifth into the loop) placed
        //    clear of the pedal and out of the melody's lane; tremolo E3 F3 (12–13), F4 B4 (14–15)
        // percussion: war drums far (0–7) then near, the funeral toll on E3, timpani rolls on E2
        write(S) {
          const prog = ['Em', 'Em', 'F', 'Em', 'Em', 'Em', 'Dm', 'Em', 'Am', 'Am', 'F', 'Em', 'Dm', 'Bdim', 'F', 'Em'];
          S.mel('solo', 0, SIEGE_THEME, { vel: 0.8, lead: true });
          S.mel('brass', 8, 'E4:1.5 C4:.5_ A3:2 | B3:1 C4:1 D4:1.5 C4:.5 | C4:3 A3:1 | B3:4 | '
            + 'D4:1.5 F4:.5_ E4:1 D4:1 | F4:2 D4:1 B3:1 | A3:1.5 G3:.5_ F3:1 G3:1 | E3:4', { fam: 'hn', art: 'sus', vel: 0.7, lead: true });
          // (the fall stops on A♭3, under the diminished seventh: on to G3 and F3 it would double the
          // horn's G3 and cross under its F3 and E3, which complete the descent themselves)
          S.mel('solo', 12, 'A3:4 | Ab3:4', { vel: 0.55, lead: true, line: 'fall' });
          // (under bars 6–7 the pedal is E alone: its B2 would grind against the lament's D3)
          for (let b = 0; b < 16; b += 2) {
            // (re-spoken at bar 0 too: the loop crosses over from bar 14's pedal)
            const props = { vel: b < 8 ? 0.42 : 0.48, respeak: true };
            if (b === 4) {
              // (one chord written as two events, its B2 a beat shorter: each plays its share)
              S.chord('drone', b, 0, 9, [40], { ...props, chordSize: 2 });
              S.chord('drone', b, 0, 8, [47], { ...props, chordSize: 2 });
            } else S.chord('drone', b, 0, b < 14 ? 9 : 8, b === 6 ? [40] : [40, 47], props);
          }
          S.each(prog, (c, b) => {
            if (b % 2 === 0) S.add('strings', S.at(b), { midi: 28, dur: 3, vel: S.hum(0.5), sec: 'cb', art: 'sus', line: 'B' });
            S.ost('strings', b, 'E', 'X.....x.....x...', { lo: 40, dur: 1, vel: 0.5, sec: 'vc', art: 'marc', line: 'L' });
            if (b < 8) S.steps('drum', b, b % 4 === 3 ? 'B.........b...b.' : 'B.........b.....', 0.9, { big: 'great', small: 'tom', far: true });
            else S.steps('drum', b, b % 4 === 3 ? 'B.....b...b.b.x.' : 'B.....b.....b...', 0.7, { big: 'great', small: 'tom' });
          });
          for (const b of [0, 2, 4, 6]) S.add('toll', S.at(b), { midi: 52, vel: S.hum(0.5), decay: 7, far: true });
          for (const b of [8, 10, 12, 14]) S.add('toll', S.at(b), { midi: 52, vel: S.hum(0.3), decay: 7 });
          // (the swells crest about mf, their tops never on the melody's notes above it; the tremolo
          // stays under the horn)
          S.stack(2, 0, 4, [40, 41, 48], { art: 'swell', vel: 0.6, line: 'swell' });
          S.stack(6, 0, 4, [38, 45, 53], { art: 'swell', vel: 0.44, line: 'swell' });
          S.stack(10, 0, 4, [40, 41, 45], { art: 'swell', vel: 0.6, line: 'swell' });
          S.stack(13, 0, 4, [35, 41, 47], { art: 'swell', vel: 0.66, line: 'swell' });
          S.stack(15, 0, 4, [28, 40, 47], { art: 'swell', vel: 0.7, line: 'swell' });
          for (const b of [12, 13]) S.chord('strings', b, 0, 4, [52, 53], { exact: true, sec: 'va', art: 'trem', vel: 0.32 });
          for (const b of [14, 15]) S.chord('strings', b, 0, 4, [65, 71], { exact: true, sec: 'vn', art: 'trem', vel: 0.41 });
          for (let b = 8; b < 16; b++) {
            const swell = b === 10 || b === 13 || b === 15;
            S.voiced('choir', b, 0, 4, prog[b], { lo: swell ? 55 : 45, hi: 81, n: swell ? 3 : 4, vowel: 'o', vel: 0.5, tie: true });
          }
          S.roll('timp', 7, 2, 2, 0.12, 0.55, { midi: 40 });
          S.roll('timp', 15, 1, 3, 0.1, 0.7, { midi: 40 });
          S.add('cymbal', S.at(15), { dur: 4, swell: true, vel: S.hum(0.35) });
        },
      },
      B: {
        bars: 16,
        // B  the basses in 3 + 3 + 2 on the bass line (an E chord always on E1, the others the
        //    nearest octave: A1 … D2 | A1 … B1 F1 E1)
        // L  the celli's 16ths an octave above, accented 3 + 3 + 2, the last two a semitone off
        // H  bars 0–7 no choir (the stabs carry the harmony): a soft halo of violins sul tasto above
        //    the horn (E5–E6) keeps the chord; bars 8–15 the choir "ah" around the horn and the lament
        //    (Am → C3 E3 + A4 C5)
        // M  the horn on the theme an octave up E4–C5, the trombones at pitch E3–C4 (0–7); the horn's
        //    second strain A3–B♭4 (8–15)
        // C  the solo cello's chromatic lament C4 → E3 (8–15); grinding stabs (the ♭9 over an open
        //    fifth, tops kept off the melody) on the odd bars, swells into bars 8, 12 and the loop;
        //    tremolo B4 C5 (12–13), E5 F5 (14–15)
        // percussion: half-time war drums, timpani on the bass, the toll every 4 bars, rolls into 8
        //    and the loop, cymbal swells
        write(S) {
          const prog = ['Em', 'Em', 'F', 'Em', 'Am', 'Em', 'Dm', 'Em', 'Am', 'Am', 'Dm', 'Dm', 'Bdim', 'Bdim', 'F', 'Em'];
          S.mel('brass', 0, SIEGE_THEME, { fam: 'hn', art: 'sus', oct: 1, vel: 0.8, lead: true });
          S.mel('brass', 0, SIEGE_THEME, { fam: 'tbn', art: 'sus', vel: 0.5, lead: true });
          S.mel('brass', 8, 'A3:1.5 C4:.5_ E4:2 | F4:1.5 E4:.5_ D4:1 C4:1 | D4:1.5 F4:.5_ A4:2 | Bb4:1.5 A4:.5_ G4:1 F4:1 | '
            + 'F4:2 D4:1 B3:1 | D4:1.5 C4:.5_ B3:1 A3:1 | A3:1.5 C4:.5_ F4:1 E4:1 | E4:3 r:1', { fam: 'hn', art: 'sus', vel: 0.78, lead: true });
          S.mel('solo', 8, 'C4:4 | B3:4 | A3:4 | Bb3:2 A3:2 | Ab3:4 | G3:4 | F3:4 | E3:4', { vel: 0.6, lead: true, line: 'lament' });
          S.each(prog, (c, b) => {
            let cb = 0;
            for (const bt of [0, 1.5, 3]) cb = S.bass('strings', b, bt, c, { lo: 28, hi: c === 'Em' ? 33 : 40, near: 28, desks: 'cb', dur: 1, vel: 0.5, line: 'B' });
            const g = c === 'F' ? -1 : 1;
            S.ost('strings', b, c, 'XxxXxxXxXxxXxxXx', { root: S.vcOf(cb), offs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, g, g], dur: 0.22, vel: 0.6, sec: 'vc', art: 'spic', line: 'L' });
            S.steps('drum', b, b % 4 === 3 ? 'B.....B.x.x.BxBx' : 'B.....B.x...B.x.', 0.9, { big: 'great', small: 'tom' });
            S.add('timp', S.at(b), { midi: timpOf(c, 38), vel: S.hum(0.7) });
            if (b % 4 === 0) S.add('toll', S.at(b), { midi: 52, vel: S.hum(0.35), decay: 7 });
            // (the swells into the phrase ends crest under the horn's held note, their tops under G4)
            if (b === 7 || b === 11 || b === 15) grinding(S, b, 0, 4, c, { art: 'swell', top: 67, vel: 0.68 });
            else if (b % 2 === 1) for (const [bt, d, v] of [[1.5, 0.5, 0.75], [3, 0.6, 0.88]]) grinding(S, b, bt, d, c, { art: 'stab', vel: v });
          });
          for (const b of [12, 13]) S.chord('strings', b, 0, 4, [71, 72], { exact: true, sec: 'vn', art: 'trem', vel: 0.34 });
          for (const b of [14, 15]) S.chord('strings', b, 0, 4, [76, 77], { exact: true, sec: 'vn', art: 'trem', vel: 0.42 });
          for (let b = 0; b < 8; b++) S.voiced('strings', b, 0, 4, prog[b], { lo: 75, hi: 88, n: 3, sec: 'vn', art: 'sus', tasto: true, vel: 0.26, line: 'halo', tie: true });
          for (let b = 8; b < 16; b++) S.voiced('choir', b, 0, 4, prog[b], { lo: b === 14 ? 45 : 41, hi: 81, n: b === 15 ? 3 : 4, vowel: 'a', vel: 0.55, tie: true });
          S.roll('timp', 7, 2, 2, 0.15, 0.7, { midi: 40 });
          S.roll('timp', 15, 2, 2, 0.15, 0.8, { midi: 40 });
          S.add('cymbal', S.at(7), { dur: 4, swell: true, vel: S.hum(0.3) });
          S.add('cymbal', S.at(15), { dur: 4, swell: true, vel: S.hum(0.4) });
        },
      },
    },
  },

  // the golden climb: heroic and driving in G mixolydian — a galloping string ostinato under the
  // horn's theme, harp arpeggios, a flute descant; the fight (B, 96 bpm) sinks it into G phrygian:
  // the theme an octave down on the cuivré low horn, every bright degree flattened (A♭, B♭, E♭) and
  // its climbs turned to falls and sighs, the gallop slowed into a low grind under sul ponticello
  // tremolo, half-time war drums, cluster stabs and swells in the low brass, a low choir, a bell;
  // no note of B outlasts its bar
  ascent: {
    title: 'The Wyrmspine at Golden Hour', bpm: 128, seed: 0xa5ce7, order: 'hold', start: 'A', gain: 0.95,
    mix: { hn: 1.5, tbn: 1.1, tba: 1.1, vc: 1.3, cb: 0.95, va: 0.8, vn: 1, choir: 1, harp: 0.75, flute: 1, drums: 0.65, timp: 0.85, bells: 1, metal: 0.85 },
    eq: { drums: EQ.boom, hnc: EQ.cuivre },
    sections: {
      A: {
        bars: 16,
        level: 1.15,
        // B  the basses in half notes on the bass line (G1–D2)
        // L  the celli's gallop, D2–C3
        // H  violas sul tasto, D3–E4, three notes; the harp's arpeggios G3–D5 as they were
        // M  the horn's theme, D4–F5
        // C  the flute's descant (8–15) a sixth or third off the horn: D5 | A5 | G5 | B5 | G5 | G5 | A5 | F♯5
        // percussion: taiko and great drum, a cymbal swell into the loop
        write(S) {
          const prog = ['G', 'F', 'C', 'G', 'Em', 'C', 'D', 'D', 'G', 'F', 'C', 'G', 'Em', 'C', 'Dsus4', 'D'];
          S.mel('brass', 0, 'G4:1.5 D4:.5_ G4:1 A4:1 | A4:1.5 C5:.5_ A4:1 F4:1 | G4:1.5 E4:.5_ C5:1 E5:1 | D5:4 | '
            + 'B4:1.5 G4:.5_ E5:1 D5:1 | C5:1.5 B4:.5_ A4:1 G4:1 | F#4:1 A4:1 D5:1 C5:1 | A4:4 | '
            + 'G4:1.5 D4:.5_ G4:1 B4:1 | C5:1.5 A4:.5_ F5:2 | E5:1.5 D5:.5_ C5:1 G4:1 | D5:2 B4:2 | '
            + 'E5:1.5 D5:.5_ B4:1 G4:1 | C5:1.5 D5:.5_ E5:2 | D5:2 G4:1 A4:1 | D5:4', { fam: 'hn', art: 'sus', vel: 0.75, lead: true });
          S.mel('flute', 8, 'D5:4 | A5:4 | G5:4 | B5:4 | G5:4 | G5:4 | A5:4 | F#5:4', { vel: 0.45, lead: true, line: 'descant' });
          S.each(prog, (c, b) => {
            for (const bt of [0, 2]) S.bass('strings', b, bt, c, { lo: 28, hi: 40, near: 31, desks: 'cb', dur: 1.8, vel: 0.5, line: 'B' });
            S.ost('strings', b, c, 'X.xxX.xxX.xxX.xx', { lo: 38, dur: 0.22, vel: 0.55, sec: 'vc', art: 'spic', line: 'L' });
            S.arp(b, c, { lo: 55, n: 6, step: 0.5, pat: [0, 1, 2, 3, 4, 3, 2, 1], vel: 0.4 });
            S.steps('drum', b, 'B...x...b...x.x.', 0.54, { big: 'great', small: 'taiko' });
          });
          S.each(prog, (c, b) => S.voiced('strings', b, 0, 4, c, { lo: 50, hi: 64, n: 3, sec: 'va', art: 'sus', tasto: true, vel: 0.32, tie: true }));
          S.add('cymbal', S.at(15), { dur: 4, swell: true, vel: S.hum(0.4) });
        },
      },
      B: {
        bars: 16,
        bpm: 96,
        // B  the basses in half notes on the bass line (F1–E♭2)
        // L  the celli's grind on the bass an octave up, a semitone's grind at the end of beats 2
        //    and 4 (down from A♭ and E♭); no A natural anywhere
        // H  bars 0–7 tremolo sul ponticello above the theme (violas, violins), F4–E♭5; bars 8–15 the
        //    choir "oh", out of the theme's lane — the trombones' line fills the low octave, so it sits
        //    just above the theme (D4–C5)
        // M  A's theme sunk into G phrygian on the cuivré low horn, D3–E♭4; the trombones an octave
        //    below it (8–15, G2–E♭3), in unison with it where the octave below would be muddy over
        //    the basses (D3 in bar 8, E♭3 in 10, F3 A♭3 in 14, A♭3 in 15): the basses keep every downbeat
        // C  stabs (bars 1, 5, 9, 13) and swells (3, 7, 11, 15) of the low brass, the ♭9 over an open
        //    fifth placed off the theme (in the mode, the C♯ and F♯ kept: no A natural)
        //    tremolo clusters G4 A♭4 (12–13), A♭4 D5 (14–15)
        // percussion: half-time war drums, timpani on the bass, the bell near and far, rolls into 8
        //    and the loop, the tam-tam at the top, a cymbal swell into the loop
        write(S) {
          // the phrases end on the tritone (D°, A♭ over D: bar 7) and on the ♭2's fall to the tonic
          // (bar 15: D° for two beats, then Gm)
          const prog = ['Gm', 'Fm/G', 'Cm', 'Gm', 'Cm/Eb', 'Cm', 'Ddim', 'Ddim', 'Gm', 'Fm', 'Cm', 'Gm', 'Cm', 'Fm/Ab', 'Ddim', 'Gm'];
          // A's theme, sunk an octave into G phrygian (A → A♭, B → B♭, E → E♭, F♯ → F) and turned
          // downward: its climbs fall back, sighs instead of fanfares, the first phrase hangs on the
          // tritone (A♭ over D), the second falls from D through the tritone to A♭ and onto G
          const theme = 'G3:1.5 D3:.5 G3:1 Ab3:1 | Ab3:2 G3:1 F3:1 | G3:1 C4:1 Eb4:2 | D4:2 Bb3:1 G3:1 | '
            + 'C4:2 Eb4:1.5 D4:.5 | C4:1.5 Bb3:.5 Ab3:1 G3:1 | F3:1 Ab3:1 D4:1 C4:1 | Ab3:4 | '
            + 'G3:1.5 D3:.5 G3:1 Bb3:1 | C4:1.5 Ab3:.5 F3:2 | Eb3:1 G3:1 C4:2 | D4:1 Bb3:1 G3:2 | '
            + 'Eb4:2 D4:1 C4:1 | C4:1.5 Bb3:.5 Ab3:2 | F3:1 Ab3:1 D4:2 | Ab3:2 G3:2';
          S.mel('brass', 0, theme, { fam: 'hn', cuivre: true, art: 'sus', vel: 0.9, lead: true });
          // the bass before the trombones' doubling: where its octave below would be muddy against
          // the basses (E♭2 over C2, F2 and A♭2 over the cadence's D2) it folds into unison with the
          // horn, and the basses keep every downbeat
          const cbs = prog.map((c, b) => {
            const halves = b === 15 ? ['Ddim', 'Gm'] : [c, c];
            let cb = 0;
            halves.forEach((h, i) => {
              const n = S.bass('strings', b, i * 2, h, { lo: 28, hi: 40, near: 31, desks: 'cb', dur: 1.6, vel: 0.55, line: 'B' });
              if (i === 0) cb = n;
            });
            return b === 15 ? S.bassNote('Gm', { lo: 28, hi: 40 }) : cb;
          });
          S.mel('brass', 8, backHalf(theme), { fam: 'tbn', art: 'sus', oct: -1, fold: true, vel: 0.5, lead: true });
          S.each(prog, (c, b) => {
            const cb = cbs[b];
            const nb = c === 'Cm/Eb' || c === 'Fm/Ab' ? -1 : 1;
            S.ost('strings', b, c, 'X.xxX.xxX.xxX.xx', { root: S.vcOf(cb), offs: [0, 0, 0, 0, 0, nb, 0, 0, 0, 0, 0, nb], dur: 0.22, vel: 0.75, sec: 'vc', art: 'spic', line: 'L' });
            S.steps('drum', b, b % 4 === 3 ? 'B.......B.x.BxBx' : 'B.......B...x.b.', 0.8, { big: 'great', small: 'tom' });
            S.add('timp', S.at(b), { midi: timpOf(c, 38), vel: S.hum(0.65) });
            if (b === 3 || b === 11) S.add('timp', S.at(b, 2), { midi: timpOf(c, 38), vel: S.hum(0.42) });
            // (on A♭ the stabs take the tritone A♭–D: the bass's minor ninth would be an A natural)
            const g = c === 'Fm/Ab' ? [44, 50, 56] : c;
            if (b % 4 === 1) for (const [bt, d, v] of [[0, 0.6, 0.95], [2.5, 0.4, 0.8]]) grinding(S, b, bt, d, g, { art: 'stab', vel: v }, 38, NO_A);
            if (b === 15) {
              grinding(S, b, 0, 2, 'Ddim', { art: 'swell', vel: 0.85 }, 38, NO_A);
              S.stack(b, 2, 2, [43, 50, 55], { art: 'swell', vel: 0.9 });
            } else if (b % 4 === 3) grinding(S, b, 0, 4, g, { art: 'swell', vel: 0.85 }, 38, NO_A);
          });
          for (const b of [12, 13]) S.chord('strings', b, 0, 4, [67, 68], { exact: true, sec: 'vn', art: 'trem', vel: 0.45 });
          S.chord('strings', 14, 0, 4, [68, 74], { exact: true, sec: 'vn', art: 'trem', vel: 0.52 });
          S.chord('strings', 15, 0, 2, [68, 74], { exact: true, sec: 'vn', art: 'trem', vel: 0.56 });
          S.each(prog, (c, b) => {
            if (b < 8) {
              S.voiced('strings', b, 0, 4, c, {
                lo: 65, hi: 76, n: 3, chain: 'Htrem', split: [['strings/va', 1], ['strings/vn', 2]], art: 'trem', pont: true, vel: 0.38, tie: true,
              });
            } else if (b === 15) {
              S.voiced('choir', b, 0, 2, 'Ddim', { lo: 46, hi: 72, n: 3, avoid: 'tune', vowel: 'o', vel: 0.5 });
              S.voiced('choir', b, 2, 2, c, { lo: 46, hi: 72, n: 3, avoid: 'tune', vowel: 'o', vel: 0.5 });
            } else S.voiced('choir', b, 0, 4, c, { lo: 46, hi: 72, n: 3, avoid: 'tune', vowel: 'o', vel: 0.48, tie: true });
          });
          for (const [b, vel, far] of [[0, 0.3, false], [4, 0.45, true], [8, 0.35, false], [12, 0.5, true]]) {
            S.add('toll', S.at(/** @type {number} */ (b)), { midi: 55, vel: S.hum(/** @type {number} */ (vel)), decay: 7, ...(far ? { far: true } : {}) });
          }
          S.roll('timp', 7, 2, 2, 0.15, 0.7, { midi: 38 });
          S.roll('timp', 15, 2, 2, 0.15, 0.8, { midi: 38 });
          S.add('tamtam', S.at(0), { vel: S.hum(0.4) });
          S.add('cymbal', S.at(15), { dur: 4, swell: true, vel: S.hum(0.35) });
        },
      },
    },
  },

  // the boss: Vorthrax over the caldera — C locrian, the tritone (C–G♭) and the ♭2 everywhere, an
  // organ's pedal under it all, never a major lift. A (phase 1) looms at 76 bpm: the dragon's
  // heartbeat on the great drum (once a bar, then twice) over the celli's unbroken quarters, a
  // doom bell far off then near, the tritone motif on the cuivré low horn with the tubas, the
  // organ's chords a soft halo above it, cluster swells. B (phase 2) adds the grind — low 8ths on the
  // bass and its minor second, the tritone before each bar line, kept in the mode — and the choir;
  // the organ's pedal an octave up; the theme on the horn, the trombones an octave below. C (phase
  // 3, 84 bpm) plunges: the bass falls by semitones from C to F under the organ's held C (an
  // inverted pedal), a 16th-note grind, cluster stabs on the drums' double 3 + 3 + 2, both choirs
  // between the theme's long notes and their doubling, a bell every bar; bars 8–11 draw breath
  // (8ths, one choir), 12–15 rebuild (tom runs, tremolo clusters). The organ's pedals are re-spoken
  // every 2 bars: a phase change leaves at most a bar of the last one's
  dragon: {
    title: 'Vorthrax, the Ashen Tyrant', bpm: 76, seed: 0xd7a90, order: 'hold', start: 'A', gain: 0.85,
    mix: { hn: 1.5, tbn: 1.1, tba: 1.1, organ: 1.1, choir: 0.9, vc: 1.8, cb: 1.6, vn: 1, drums: 0.8, timp: 0.8, bells: 1, metal: 0.75, far: 1.2 },
    eq: { drums: EQ.boom, hnc: EQ.cuivre },
    sections: {
      A: {
        bars: 16,
        // B  the organ's pedal C2 alone (one note, its ranks fused), re-spoken every 2 bars; it
        //    rests in bars 0–1 and 8–9, where the tubas' motif is the bass
        // L  the celli's quarters on C2, the pulse that never stops (the timpani take its downbeat
        //    in bars 0, 4, 8, 12)
        // H  the organ's chords as a soft halo above the theme, E♭4–E♭5
        // M  the motif and theme on the cuivré low horn, C3–C4; the tubas double the motif an
        //    octave down (bars 0–1, 8–9)
        // C  cluster swells of the low brass (bars 3, 7, 11, 15) placed off the theme; tremolo two
        //    octaves up, C6 C♯6 (8–11), C6 F♯6 (12–15)
        // percussion: the heartbeat on the great drum, the bell far then near, the timpani on C2,
        //    rolls into 8 and the loop, a cymbal swell into the loop
        write(S) {
          // the motif's bars (0, 8) voiced diminished: its G♭ is the mode, never a semitone under G
          const prog = ['Cdim', 'Cm', 'Db', 'Cm', 'Fm', 'Fm', 'Ebm/Gb', 'Cdim', 'Cdim', 'Cm', 'Bbm', 'Bbm', 'Fm', 'Ebm/Gb', 'Db', 'Cdim'];
          S.mel('brass', 0, `${DRAGON_MOTIF} | Db3:1.5 Eb3:.5_ F3:1 Gb3:1 | F3:2 Eb3:1 Db3:1 | `
            + 'F3:2 C4:1.5 B3:.5_ | C4:4 | Bb3:1.5 Gb3:.5_ Eb3:2 | Gb3:2 Eb3:1 C3:1 | '
            + 'C3:2 Gb3:1.5 F3:.5 | Eb3:2 Db3:1 C3:1 | Db3:2 F3:1.5 Bb3:.5_ | Bb3:2 Ab3:1 F3:1 | '
            + 'C4:2 Ab3:1 F3:1 | Gb3:3 Bb3:1 | Ab3:2 F3:1 Db3:1 | Gb3:2 C3:2', { fam: 'hn', cuivre: true, art: 'sus', vel: 0.88, lead: true });
          S.mel('brass', 0, DRAGON_MOTIF, { fam: 'tba', art: 'sus', oct: -1, vel: 0.5, lead: true });
          S.mel('brass', 8, DRAGON_MOTIF, { fam: 'tba', art: 'sus', oct: -1, vel: 0.55, lead: true });
          for (const b of [2, 4, 6, 10, 12, 14]) {
            S.chord('organ', b, 0, 8, [36], { vel: 0.5, pedal: true, line: 'pedal', ...(b === 2 || b === 10 ? {} : { respeak: true }) });
          }
          S.each(prog, (c, b) => {
            S.steps('drum', b, b < 4 ? 'B..b............' : 'B..b....B..b....', 0.95, { big: 'great' });
            S.ost('strings', b, 'C', b % 4 === 0 ? '....x...x...x...' : 'X...x...x...x...', { lo: 36, dur: 0.7, vel: b < 4 ? 0.3 : 0.38, sec: 'vc', art: 'marc', line: 'L' });
          });
          for (const b of [0, 2, 4, 6]) S.add('toll', S.at(b), { midi: 48, vel: S.hum(0.55), decay: 7, far: true });
          for (const b of [8, 10, 12, 14]) S.add('toll', S.at(b), { midi: 48, vel: S.hum(0.35), decay: 7 });
          for (const b of [0, 4, 8, 12]) S.add('timp', S.at(b), { midi: 36, vel: S.hum(0.7) });
          S.stack(3, 0, 4, [36, 42, 48], { art: 'swell', vel: 0.6, line: 'swell' });
          S.stack(7, 0, 4, [36, 42, 48, 51], { art: 'swell', vel: 0.7, line: 'swell' });
          S.stack(11, 0, 4, [34, 41, 46], { art: 'swell', vel: 0.65, line: 'swell' });
          S.stack(15, 0, 4, [36, 42, 48, 49], { art: 'swell', vel: 0.78, line: 'swell' });
          for (let b = 8; b < 12; b++) S.chord('strings', b, 0, 4, [84, 85], { exact: true, sec: 'vn', art: 'trem', vel: 0.3 });
          for (let b = 12; b < 16; b++) S.chord('strings', b, 0, 4, [84, 90], { exact: true, sec: 'vn', art: 'trem', vel: 0.42 });
          // (Cm without its fifth: a G♮ would sound against the swell's G♭)
          S.each(prog, (c, b) => S.voiced('organ', b, 0, 4, c, { lo: 63, hi: 75, n: c === 'Cm' ? 2 : 3, vel: 0.28, line: 'halo', tie: true }));
          S.roll('timp', 7, 2, 2, 0.12, 0.6, { midi: 36 });
          S.roll('timp', 15, 1, 3, 0.1, 0.75, { midi: 36 });
          S.add('cymbal', S.at(15), { dur: 4, swell: true, vel: S.hum(0.35) });
        },
      },
      B: {
        bars: 16,
        level: 0.95,
        // B/L the grind in octaves (basses, celli above; at the cello's limit E3 they play the
        //    basses' note softly): 8ths on the bass and its minor second, the tritone before the
        //    bar line — kept in the mode (no G, D, B, E or A naturals)
        //    the organ's pedal C3 alone (bars 0–1 and 4–7, re-spoken; it rests under bars 2–3's
        //    Neapolitan D♭ and in 8–15, where the trombones' line takes its octave)
        // H  the choir alone: "oh" A2–A3 (0–7); "ah" (8–15) above the theme, B♭4–A5 — the theme in
        //    octaves (horn and trombones) fills C3–B♭4, and the choir keeps out of its lane
        // M  the theme on the cuivré low horn, C4–B♭4; the trombones an octave below (8–15)
        // C  the low brass's grind (the ♭9 over the fifth, in the mode): stabs on the odd bars,
        //    swells into bars 4, 8, 12 and the loop, placed after the choir; tremolo C6 F♯6 (12–15),
        //    above the choir
        // percussion: war drums and taiko ghosts, the timpani on the bass, the bell every other bar,
        //    rolls into 8 and the loop, cymbal swells
        write(S) {
          const prog = ['Cdim', 'Cm', 'Db', 'Db', 'Fm', 'Fm', 'Ebm/Gb', 'Cdim', 'Cdim', 'Bbm', 'Ebm', 'Fm', 'Cdim', 'Ebm/Gb', 'Db', 'Cdim'];
          const theme = 'C4:2 Gb4:1.5 F4:.5_ | Eb4:1.5 Db4:.5_ C4:2 | Db4:1.5 F4:.5_ Ab4:2 | Gb4:1.5 F4:.5_ Db4:2 | '
            + 'C4:1.5 Db4:.5_ F4:2 | Ab4:1.5 Gb4:.5_ F4:2 | Gb4:2 Eb4:1 Bb3:1 | C4:4 | '
            + 'C4:2 Gb4:1.5 F4:.5_ | F4:1.5 Db4:.5_ Bb3:2 | Eb4:1.5 Gb4:.5_ Bb4:2 | Ab4:1.5 Gb4:.5_ F4:1 Eb4:1 | '
            + 'Eb4:2 C4:1 Gb3:1 | Bb3:1.5 Eb4:.5_ Gb4:2 | F4:2 Db4:1 Ab3:1 | C4:4';
          S.mel('brass', 0, theme, { fam: 'hn', cuivre: true, art: 'sus', vel: 0.85, lead: true });
          S.mel('brass', 8, backHalf(theme), { fam: 'tbn', art: 'sus', oct: -1, vel: 0.48, lead: true });
          // the organ's pedal on C3 where the harmony holds a C (it rests under the Neapolitan D♭,
          // and in 8–15, where the trombones' line takes its octave)
          for (const b of [0, 4, 6]) S.chord('organ', b, 0, 8, [48], { vel: 0.45, pedal: true, line: 'pedal', ...(b === 6 ? { respeak: true } : {}) });
          S.each(prog, (c, b) => {
            const cb = S.bassNote(c, { lo: 28, hi: 45, near: 34 });
            const vc = S.vcOf(cb);
            const grindArgs = { offs: [0, 1, 0, 1, 0, 1, 0, 6], mode: LOCRIAN, dur: 0.42, art: 'marc', line: 'bass' };
            S.ost('strings', b, c, 'X.x.x.x.X.x.x.x.', { ...grindArgs, root: cb, vel: 0.62, sec: 'cb' });
            S.ost('strings', b, c, 'X.x.x.x.X.x.x.x.', { ...grindArgs, root: vc, vel: vc === cb ? 0.3 : 0.6, sec: 'vc' });
            // (the war drums a touch under the heartbeat's weight: the grind and the choir fill the low end)
            S.steps('drum', b, b % 4 === 3 ? 'B..b..B...b.BxBx' : 'B..b..B.....B.x.', 0.81, { big: 'great', small: 'tom' });
            S.steps('drum', b, '..o...o...o...o.', 0.6, { small: 'taiko' });
            S.add('timp', S.at(b), { midi: timpOf(c, 36), vel: S.hum(0.7) });
            if (b % 2 === 0) S.add('toll', S.at(b), { midi: 48, vel: S.hum(0.35), decay: 6 });
          });
          for (let b = 12; b < 16; b++) S.chord('strings', b, 0, 4, [84, 90], { exact: true, sec: 'vn', art: 'trem', vel: 0.42 });
          // (bar 1's Cm sung in the mode, C E♭ G♭ — the grind's own notes, held on from bar 0: a G♮
          // would sound against the stabs' and the basses' F♯)
          S.each(prog, (c, b) => S.voiced('choir', b, 0, 4, c === 'Cm' ? 'Cdim' : c, {
            lo: b < 8 ? 45 : 67, hi: b < 8 ? 60 : 81, n: 3, chain: b < 8 ? 'low' : 'high', vowel: b < 8 ? 'o' : 'a', vel: 0.5, tie: true, line: 'choir',
          }));
          S.each(prog, (c, b) => {
            if (b % 4 === 3) grinding(S, b, 0, 4, c, { art: 'swell', vel: 0.75 }, 34, LOCRIAN);
            else if (b % 2 === 1) for (const [bt, d, v] of [[1.5, 0.5, 0.75], [3, 0.6, 0.88]]) grinding(S, b, bt, d, c, { art: 'stab', vel: v }, 34, LOCRIAN);
          });
          S.roll('timp', 7, 2, 2, 0.15, 0.7, { midi: 36 });
          S.roll('timp', 15, 2, 2, 0.15, 0.8, { midi: 36 });
          S.add('cymbal', S.at(7), { dur: 4, swell: true, vel: S.hum(0.3) });
          S.add('cymbal', S.at(15), { dur: 4, swell: true, vel: S.hum(0.4) });
        },
      },
      C: {
        bars: 16,
        bpm: 84,
        level: 0.95,
        // B  the plunge: the basses fall by semitones C2 → F1 in half notes
        //    the organ holds C high above it (an inverted pedal; C5 — at C3 it ground against the
        //    trombones' line, which moves around that C), re-spoken every 2 bars
        // L  the celli an octave above the basses (C3 → F2): 16ths with the minor second's grind and
        //    a tritone, 8ths in the breath (8–11)
        // H  the "oh" choir between the theme and its doubling; the "ah" choir a halo above the theme
        //    and under the organ's C5 (E4–B4), never on an "oh" note (bars 8–11 "oh" alone)
        // M  the theme's long notes on the cuivré low horn, G3–F♯4, the trombones an octave below
        // C  cluster stabs on the drums' double 3 + 3 + 2 (beats 0, 1.5, 3.5) on a chord's first
        //    bar, a swell on its second (none in the breath); tremolo F5 F♯5 (12–15)
        // percussion: the double 3 + 3 + 2 on the great drum, taiko ghosts, tom runs as it rebuilds,
        //    timpani, the bell every bar (far on the odd bars, shorter), the tam-tam at the top,
        //    cymbal swells into the rebuild and the loop
        write(S) {
          const prog = ['Cdim', 'Cdim', 'Bdim', 'Bdim', 'Bbm', 'Bbm', 'Adim', 'Adim', 'Fm/Ab', 'Fm/Ab', 'Gm', 'Gm', 'Ebm/Gb', 'Ebm/Gb', 'Fm', 'Fm'];
          const theme = 'C4:4 | Gb4:2 F4:2 | F4:4 | D4:2 B3:2 | Db4:4 | C4:2 Bb3:2 | Eb4:4 | C4:2 A3:2 | '
            + 'C4:4 | Db4:2 C4:2 | Bb3:4 | D4:2 Db4:2 | Eb4:4 | Db4:2 Bb3:2 | C4:4 | Ab3:2 G3:2';
          S.mel('brass', 0, theme, { fam: 'hn', cuivre: true, art: 'sus', vel: 0.88, lead: true });
          S.mel('brass', 0, theme, { fam: 'tbn', art: 'sus', oct: -1, vel: 0.48, lead: true });
          for (let b = 0; b < 16; b += 2) S.chord('organ', b, 0, 8, [72], { vel: 0.38, pedal: true, line: 'pedal', respeak: true });
          S.each(prog, (c, b, same) => {
            // an arc in each loop: bars 8–11 draw breath (8ths, one choir, no ghosts, no stabs), 12–15 rebuild
            const thin = b >= 8 && b < 12;
            let cb = 0;
            for (const bt of [0, 2]) cb = S.bass('strings', b, bt, c, { lo: 28, hi: 45, near: 36, desks: 'cb', dur: 1.6, vel: 0.5, line: 'B' });
            const vc = S.vcOf(cb);
            if (thin) S.ost('strings', b, c, 'X.x.X.x.X.x.X.x.', { root: vc, offs: [0, 0, 1, 0, 0, 0, 6, 1], dur: 0.42, vel: 0.62, sec: 'vc', art: 'marc', line: 'L' });
            else S.ost('strings', b, c, 'XxxxXxxxXxxxXxxx', { root: vc, offs: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 6, 1, 0], dur: 0.22, vel: 0.62, sec: 'vc', art: 'spic', line: 'L' });
            S.steps('drum', b, b % 4 === 3 ? 'B..b..B.B..bBxBx' : thin ? 'B..b..B.B.......' : 'B..b..B.B..b..B.', thin ? 0.6 : 0.75, { big: 'great', small: 'tom' });
            if (b >= 12 && b < 15) S.steps('drum', b, '............oxxx', 0.7, { small: 'tom' });
            if (!thin) S.steps('drum', b, '.o...o...o...o..', 0.7, { small: 'taiko' });
            // (the timpani on the bass; on E♭m/G♭'s second bar its root, E♭2 — the theme's D♭ and B♭
            // over the choir's G♭ and the falling bass would sound a G♭ major chord, and D♭ is the
            // only major chord the dragon has)
            const timp = c === 'Ebm/Gb' && same ? 39 : timpOf(c, 41);
            S.add('timp', S.at(b), { midi: timp, vel: S.hum(0.7) });
            S.add('timp', S.at(b, 2), { midi: timp, vel: S.hum(0.45) });
            S.add('toll', S.at(b), b % 2 ? { midi: 48, vel: S.hum(0.3), decay: 3.5, far: true } : { midi: 48, vel: S.hum(0.4), decay: 6 });
            // (the swell on a chord's second bar crests under the theme's long note)
            if (same) grinding(S, b, 0, 4, c, { art: 'swell', vel: 0.56 }, 41);
            else if (!thin) for (const [bt, d, v] of [[0, 0.6, 0.85], [1.5, 0.4, 0.72], [3.5, 0.4, 0.78]]) grinding(S, b, bt, d, c, { art: 'stab', vel: v }, 41);
          });
          for (let b = 12; b < 16; b++) S.chord('strings', b, 0, 4, [77, 78], { exact: true, sec: 'vn', art: 'trem', vel: b < 14 ? 0.42 : 0.52 });
          S.each(prog, (c, b) => {
            const thin = b >= 8 && b < 12;
            const common = { tie: b !== 8 && b !== 12, line: 'choirs' };
            const oh = S.voiced('choir', b, 0, 4, c, { lo: 45, hi: 66, n: thin ? 2 : 3, chain: 'oh', vowel: 'o', vel: thin ? 0.45 : 0.54, ...common });
            // "ah" a chain of its own above the theme, under the organ's C5, never on an "oh" note: a
            // soft halo (it sings in the theme's band)
            if (!thin) S.voiced('choir', b, 0, 4, c, { lo: 64, hi: 71, n: 2, chain: 'ah', vowel: 'a', not: oh ?? [], vel: 0.42, ...common });
          });
          S.add('tamtam', S.at(0), { vel: S.hum(0.42) });
          S.add('cymbal', S.at(11), { dur: 4, swell: true, vel: S.hum(0.3) });
          S.add('cymbal', S.at(15), { dur: 4, swell: true, vel: S.hum(0.4) });
        },
      },
    },
  },

  // the bonfire: a 6/8 jig in D — fiddle, then the flute; frame drum, jingles, the villagers'
  // claps, a strummed lute and a chanter drone
  festival: {
    title: 'Bonfire Jig', bpm: 174, bpb: 3, seed: 0xfe571, order: 'alternate', start: 'A', gain: 1,
    // (the mix: the tune on top, about 10 dB over the band — no more, so the strums and the bodhrán
    // drive the jig; the lute's strums carved where the fiddle sings, the bodhrán's boom eased)
    mix: { fiddle: 2.3, flute: 1.15, lute: 0.75, drone: 0.8, drums: 0.75, metal: 0.95 },
    eq: { drums: [['peaking', 80, 1, -3]], lute: [['peaking', 1300, 0.9, -5]] },
    sections: {
      A: {
        bars: 16,
        // B  the lute's roots and fifths, D2–A2 (damped)
        //    the reed drone D2 A2, soft
        // H  the lute's strums on the two dotted-quarter beats, open (D3–A4, four strings), damped
        //    after 1.3 beats
        // M  the fiddle's tune (its new ending in bars 12–15)
        // C  the flute's harmony, bars 8–11 as written, 12–15 an octave up in the whistle register
        // percussion: the bodhrán (boom, tips), jingles
        write(S) {
          const prog = ['D', 'D', 'G', 'A', 'D', 'D', 'G|A', 'D', 'D', 'D', 'G', 'A', 'D', 'D', 'G|A', 'D'];
          const tune = 'A4:.5 F#4:.5 A4:.5 D5:1 A4:.5 | F#5:1 E5:.5 D5:.5 E5:.5 F#5:.5 | G5:1 B4:.5 D5:.5 B4:.5 G4:.5 | A4:.5 B4:.5 C#5:.5 E5:1 C#5:.5 | '
            + 'D5:.5 F#5:.5 A5:.5 F#5:1 D5:.5 | E5:.5 F#5:.5 E5:.5 D5:.5 B4:.5 A4:.5 | B4:.5 D5:.5 G5:.5 E5:.5 C#5:.5 A4:.5 | D5:1 A4:.5 D5:1.5';
          S.mel('fiddle', 0, tune, { vel: 0.8, legato: 0.92, lead: true });
          S.mel('fiddle', 8, tune.split('|').slice(0, 4).join('|'), { vel: 0.84, legato: 0.92, lead: true });
          S.mel('fiddle', 12, 'D5:.5 F#5:.5 A5:.5 B5:1 A5:.5 | G5:.5 F#5:.5 E5:.5 D5:.5 E5:.5 F#5:.5 | G5:.5 F#5:.5 E5:.5 E5:.5 D5:.5 C#5:.5 | D5:2.5 r:.5', { vel: 0.84, legato: 0.92, lead: true });
          S.mel('flute', 8, 'F#5:1.5 F#5:1.5 | A5:3 | B5:1.5 G5:1.5 | A5:1.5 E5:1.5', { vel: 0.5, lead: true, line: 'flute' });
          S.mel('flute', 12, 'F#6:3 | E6:1.5 D6:1.5 | D6:1.5 C#6:1.5 | D6:3', { vel: 0.4, lead: true, line: 'flute' });
          S.chord('drone', 0, 0, 48, [38, 45], { vel: 0.35, reed: true });
          S.each(prog, (c, b) => {
            const [c1, c2 = c1] = c.split('|');
            S.strum('lute', b, 0, c1, { vel: 0.5 });
            S.strum('lute', b, 1.5, c2, { vel: 0.4 });
            S.root('lute', b, 0, c1, { lo: 35, hi: 47, chain: 'roots', dur: 1.4, vel: 0.7, line: 'roots' });
            S.root('lute', b, 1.5, c2, { lo: 35, hi: 47, chain: 'roots', dur: 1.4, vel: 0.48, fifth: c1 === c2, line: 'roots' });
            S.steps('drum', b, b % 4 === 3 ? 'BxxBxB' : 'BxxBxx', 0.85, { big: 'frame', small: 'frameTip' });
            S.steps('jingle', b, '.x..x.', 0.6);
          });
        },
      },
      B: {
        bars: 16,
        // B  the lute's roots and fifths
        // H  the lute's strums, open and damped
        // M  the flute's tune
        // C  the fiddle's counter-line under it (8–15), its unisons with the flute moved (bar 10
        //    G4, 11 A4, 12 F♯4, 15 A4)
        // percussion: the bodhrán, jingles, the villagers' claps (a crowd)
        write(S) {
          const prog = ['G', 'D', 'G', 'A', 'Bm', 'G', 'A', 'D', 'G', 'D', 'G', 'A', 'Bm', 'G', 'A', 'D'];
          const tune = 'D5:.5 G5:.5 B5:.5 A5:1 G5:.5 | F#5:.5 A5:.5 F#5:.5 D5:1 A4:.5 | B4:.5 D5:.5 G5:.5 B5:1 A5:.5 | A5:1 G5:.5 E5:1 C#5:.5 | '
            + 'D5:.5 F#5:.5 B5:.5 A5:.5 F#5:.5 D5:.5 | G5:.5 B5:.5 G5:.5 D5:1 B4:.5 | C#5:.5 E5:.5 A5:.5 G5:.5 E5:.5 C#5:.5 | ';
          S.mel('flute', 0, `${tune}D5:1 A4:.5 D5:.5 F#5:.5 A5:.5`, { vel: 0.75, legato: 0.9, lead: true });
          S.mel('flute', 8, `${tune}D5:2.5 r:.5`, { vel: 0.8, legato: 0.9, lead: true });
          S.mel('fiddle', 8, 'B4:1.5 D5:1.5 | A4:1.5 F#4:1.5 | G4:1.5 D5:1.5 | C#5:1.5 A4:1.5 | F#4:1.5 B4:1.5 | B4:1.5 G4:1.5 | A4:1.5 C#5:1.5 | A4:2.5 r:.5', { vel: 0.5, lead: true, line: 'counter' });
          S.each(prog, (c, b) => {
            S.strum('lute', b, 0, c, { vel: 0.52 });
            S.strum('lute', b, 1.5, c, { vel: 0.42 });
            S.root('lute', b, 0, c, { lo: 35, hi: 47, chain: 'roots', dur: 1.4, vel: 0.7, line: 'roots' });
            S.root('lute', b, 1.5, c, { lo: 35, hi: 47, chain: 'roots', dur: 1.4, vel: 0.48, fifth: true, line: 'roots' });
            S.steps('drum', b, b % 4 === 3 ? 'BxxBxB' : 'BxxBxx', 0.9, { big: 'frame', small: 'frameTip' });
            S.steps('jingle', b, '.x..x.', 0.65);
            S.steps('clap', b, 'X..X..', 0.55);
          });
        },
      },
    },
  },

  // the credits: a broad, noble theme in E-flat — harp triplets and strings under the horn; then
  // the whole orchestra, low brass and choir in one chorale, the flute an octave over the horn, to
  // a full cadence
  triumph: {
    title: 'Embers of Dawn', bpm: 80, seed: 0x7a1e4, order: 'alternate', start: 'A', gain: 1.1,
    mix: { hn: 1.6, tbn: 0.9, tba: 0.9, choir: 0.75, va: 0.8, vc: 1, cb: 1, harp: 0.65, flute: 1, timp: 0.8, drums: 0.9, metal: 0.9 },
    sections: {
      A: {
        bars: 16,
        level: 1.22,
        // L  the celli in half notes, E♭2–C3
        // H  violas and a cello sul tasto, D3–E♭4 (above the celli's line), under the horn; the harp's
        //    triplet arpeggios G2–F4 beneath it (Emberfall's harp under its flute; bar 15's from B♭2)
        // M  the horn's noble theme, B♭3–E♭5
        // C  the flute's counter-line (8–15): bars 8–9 at pitch, 10–15 an octave up
        // percussion: timpani rolls into 8 and the loop, a cymbal swell into B
        write(S) {
          const prog = ['Eb', 'Bb', 'Cm', 'Ab', 'Eb', 'Ab', 'Fm', 'Bb', 'Eb', 'Bb', 'Cm', 'Gm', 'Ab', 'Eb/G', 'Fm7', 'Bb7'];
          S.mel('brass', 0, 'Bb3:1 Eb4:2 F4:1 | G4:3 F4:1 | Eb4:1.5 F4:.5_ G4:1 C5:1 | Bb4:3 Ab4:1 | '
            + 'G4:2 Eb4:1 Bb3:1 | Ab4:2 C5:1 Ab4:1 | F4:2 Ab4:1 C5:1 | Bb4:4 | '
            + 'Bb4:1 Eb5:2 D5:1 | D5:2 Bb4:1 F4:1 | C5:2 Eb5:1 D5:1 | Bb4:2 G4:2 | '
            + 'Ab4:1 C5:1 Eb5:2 | Bb4:2 G4:1 Eb5:1 | Eb5:1.5 D5:.5_ C5:1 Ab4:1 | Bb4:3 F4:1', { fam: 'hn', art: 'sus', vel: 0.68, lead: true });
          S.mel('flute', 8, 'G5:4 | F5:4 | Eb6:4 | D6:4 | C6:4 | Bb5:4 | Ab5:2 C6:2 | D6:4', { vel: 0.4, lead: true, line: 'counter' });
          S.each(prog, (c, b) => {
            S.ost('strings', b, c, 'X.......X.......', { lo: 39, dur: 1.8, vel: 0.42, sec: 'vc', art: 'sus', line: 'L' });
            // (bar 15's B♭7 from B♭2: from G2 its A♭2 B♭2 would be a muddy second)
            S.arp(b, c, { lo: b === 15 ? 46 : 43, n: 6, step: 1 / 3, pat: [0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 2, 1], vel: 0.45 });
          });
          S.each(prog, (c, b) => S.voiced('strings', b, 0, 4, c, {
            lo: 50, hi: 63, n: 3, chain: 'H', split: [['strings/vc', 1], ['strings/va', 2]], art: 'sus', tasto: true, vel: 0.3, tie: true,
          }));
          S.roll('timp', 7, 2, 2, 0.1, 0.5, { midi: 46 });
          S.add('timp', S.at(8), { midi: 39, vel: S.hum(0.55) });
          S.roll('timp', 15, 2, 2, 0.1, 0.55, { midi: 46 });
          S.add('cymbal', S.at(15), { dur: 4, swell: true, vel: S.hum(0.35) });
        },
      },
      B: {
        bars: 16,
        // B  the basses in quarters on the bass line (E♭2 B♭1 C2 A♭1 …: the low E♭ is below the
        //    basses' E1, so the line stays in their range)
        // L  the celli an octave above them (one line)
        // H  one six-note chain in root position (the full cadence on E♭2): the tuba on the bass and
        //    a trombone above it, sustained, tied over a repeated chord, swelling only into bars 4, 8,
        //    12 and 13; the choir "ah" above in four parts (E♭3–E♭4); the harp's triplets under the horn
        // M  the horn's theme with the flute an octave above it
        // percussion: timpani on the root and the fifth in half notes, the field snare, cymbals,
        //    the roll into the cadence
        write(S) {
          const prog = ['Eb', 'Bb', 'Cm', 'Ab', 'Eb', 'Ab', 'Fm', 'Bb', 'Eb', 'Bb', 'Cm', 'Gm', 'Ab', 'Bb', 'Eb', 'Eb'];
          const theme = 'Bb3:1 Eb4:2 F4:1 | G4:3 F4:1 | Eb4:1.5 F4:.5_ G4:1 C5:1 | Bb4:3 Ab4:1 | '
            + 'G4:2 Eb4:1 Bb3:1 | Ab4:2 C5:1 Ab4:1 | F4:2 Ab4:1 C5:1 | Bb4:4 | '
            + 'Bb4:1 Eb5:2 D5:1 | D5:2 Bb4:1 F4:1 | C5:2 Eb5:1 D5:1 | Bb4:2 G4:2 | '
            + 'Ab4:1 C5:1 Eb5:2 | F5:2 D5:1 Bb4:1 | Eb5:4 | G4:1 Bb4:1 Eb5:2';
          S.mel('brass', 0, theme, { fam: 'hn', art: 'sus', vel: 0.8, lead: true });
          S.mel('flute', 0, theme, { oct: 1, vel: 0.5, lead: true });
          S.each(prog, (c, b) => {
            for (const bt of [0, 1, 2, 3]) S.bass('strings', b, bt, c, { lo: 28, hi: 40, near: 39, desks: 'both', dur: 0.9, vel: 0.52, art: 'marc', line: 'bass' });
            const t = timpOf(c, 38);
            // (bar 14's downbeat is the cadence's own stroke, below: one stroke on it, not two)
            if (b !== 14) S.add('timp', S.at(b), { midi: t, vel: S.hum(0.55) });
            S.add('timp', S.at(b, 2), { midi: t + 7 <= 57 ? t + 7 : t - 5, vel: S.hum(0.4) });
            S.steps('snare', b, 'x..o....x..o....', 0.4);
            if (b % 4 === 3 && b < 12) S.add('cymbal', S.at(b), { dur: 4, swell: true, vel: S.hum(0.32) });
            S.arp(b, c, { lo: 46, n: 6, step: 1 / 3, pat: [0, 1, 2, 3, 4, 5, 4, 3, 2, 3, 2, 1], vel: 0.34 });
          });
          S.each(prog, (c, b) => {
            const art = b === 3 || b === 7 || b === 11 || b === 12 ? 'swell' : 'sus';
            S.voiced('brass', b, 0, 4, c, {
              lo: 34, hi: 63, n: 6, bass: true, chain: 'H', tie: true, vel: 0.55,
              split: [['brass/tba', 1, { art }], ['brass/tbn', 1, { art }], ['choir', 4, { vowel: 'a' }]],
            });
          });
          S.add('cymbal', S.at(0), { vel: S.hum(0.45) });
          S.add('cymbal', S.at(8), { vel: S.hum(0.4) });
          S.add('cymbal', S.at(14), { vel: S.hum(0.5) });
          S.roll('timp', 13, 2, 2, 0.2, 0.75, { midi: 46 });
          S.add('timp', S.at(14), { midi: 39, vel: S.hum(0.85) });
        },
      },
    },
  },
};

/**
 * A score track built from its seed (AudioSystem `_combatTrack`): tempo, section order, sections
 * (with their tempo and beats per bar), play RNG and its definition; null for another name. Throws
 * when the score emits an event kind not in ScoreKit.js `SCORE_KINDS`.
 * @param {string} name
 */
export function scoreTrack(name) {
  const score = ownValue(SCORE_TRACKS, name);
  if (!score) return null;
  const rng = mulberry32(score.seed);
  return {
    name, title: score.title, bpm: score.bpm, order: score.order, start: score.start,
    sections: buildScoreSections(score, rng), rng: mulberry32(score.seed ^ 0x5bd1e995), score,
  };
}
