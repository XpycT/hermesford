/**
 * ScoreKit — the scoring kit of Vanquish the Evil Dragon's six tracks (docs/contracts/DRAGON_CAMPAIGN.md
 * §6.9) and the contract between the scores and the instruments: note and chord names, a melody
 * shorthand, drum step strings (`Score`), the build of a track's sections (`buildScoreSections`),
 * and the events a score emits — the `ScoreEvent` union, its kinds `SCORE_KINDS`, the bus names
 * a track's `mix` may set (`ScoreBusName`) and where its `eq` may sit (`ScoreEqName`).
 *
 * The orchestration rules live here as code, so a score is written by them rather than against
 * them: `LOW_LIMIT` (the lowest note at which an interval still sounds clear) and `spread`; `voice`
 * — voice leading from the previous chord of a line, open spacing, the chord's root and third kept;
 * a `Score` knows the lines written so far (the melodies, every held note) and places a chord
 * (`voiced`), a bass (`bass`), a brass cluster (`stack`) where it is clear of the held notes below
 * and keeps out of the melody's lane. The melodies are written first and marked `lead`.
 *
 * Pure data and arithmetic: no import, no browser global, so it runs in Node (the score tests,
 * tools/test-vq-scores.mjs) as well as in the page. One way only: Scores.js (the tracks),
 * ScoreVoices.js (the live voices) and MusicRenders.js (the rendered ones) import it; it imports
 * none of them. Like every module under vanquish/ it is imported only through the campaigns' audio
 * packs (VanquishAudio.js, EvermereAudio.js: AudioSystem.js's dynamic `import()`; the score kit is a
 * chunk the two share), so a level without a campaign's music never fetches it. The Bells of
 * Evermere's scores (evermere/Scores.js) are written with it too, with a kinds table of their own
 * (`buildScoreSections(def, rng, kinds)`).
 *
 * The event contract: beats in the score, the engine converts them to seconds; velocity is dynamics
 * 0–1 (pp 0.25 … mf 0.6 … ff 1.0) — the loudness balance lives in a track's `mix`. Performance is
 * stamped at build from the track's build RNG: `rr` (the round-robin render of a rendered kind,
 * cycling per kind and pitch or type) and `jitter` (seconds off the grid, by articulation).
 * A score that emits a kind not in `SCORE_KINDS` throws when it is built.
 */

/** A MIDI note → its frequency (Hz, A4 = 440). */
export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

/** A MIDI note's pitch class (0 = C). */
export const pcOf = (m) => ((m % 12) + 12) % 12;

// ---------------------------------------------------------------------------------------------
// The events
// ---------------------------------------------------------------------------------------------

/**
 * What every score event carries: `beat` (from its section's start) and its kind; optionally
 * `jitter` (s, added to its time; stamped at build), `lead` (a note of a melody — the tune, its
 * octave doubling, a counter-melody: QA's lead stem), `pan` (−1..1, extra) and `far` (the distance
 * bus: dull, quiet, mostly reverb). QA only, read by no instrument: `line` (the score line the event
 * belongs to — a melody and its octave doubling share one, so do the families of one split
 * voicing; absent: `scoreLine` derives it) and `exact` (a colour cluster written as it is, exempt
 * from the low-interval rule). `chordSize`: on the events one chord is dealt out to (a `split`
 * voicing's parts of one kind — string desks —, a part's notes split between the trombones and the
 * tuba, a held chord written as two events) the whole chord's note count, so the instruments level
 * each event as its share of one chord (absent: its own notes are the chord).
 * @typedef {{ beat: number, jitter?: number, lead?: boolean, pan?: number, far?: boolean, line?: string, exact?: boolean, chordSize?: number }} ScoreEventBase
 */
/**
 * A legato line's links (strings, solo, fiddle, brass, choir): `tied` the note slurs on from the one
 * before (no new attack; a chord: the same chord held on across the bar line), `next` the MIDI note
 * it glides into at its end.
 * @typedef {{ tied?: boolean, next?: number }} ScoreLegato
 */

// ---- live instruments (ScoreVoices.js) ----

/**
 * The string section: one note (`midi`) or a chord (`notes`) of a desk `sec` (violins, violas,
 * cellos, basses) played `art` (sustained, marcato, spiccato, tremolo, a swell), `pont` sul
 * ponticello, `tasto` sul tasto.
 * @typedef {ScoreEventBase & ScoreLegato & { kind: 'strings', notes?: number[], midi?: number, dur: number, vel: number,
 *   sec: 'vn'|'va'|'vc'|'cb', art: 'sus'|'marc'|'spic'|'trem'|'swell', pont?: boolean, tasto?: boolean }} StringsEvent
 */
/**
 * The solo cello (the lament) and the festival's fiddle: one note each.
 * @typedef {ScoreEventBase & ScoreLegato & { kind: 'solo'|'fiddle', midi: number, dur: number, vel: number }} SoloEvent
 */
/**
 * The brass: one note or a chord of a family (`fam`: horns, trombones, tubas) played `art`
 * (sustained, a stab, a swell), `cuivre` forced brassy (the dark scores' lead), `players` per note.
 * @typedef {ScoreEventBase & ScoreLegato & { kind: 'brass', notes?: number[], midi?: number, dur: number, vel: number,
 *   fam: 'hn'|'tbn'|'tba', art: 'sus'|'stab'|'swell', cuivre?: boolean, players?: number }} BrassEvent
 */
/**
 * The choir: a chord sung on a vowel ("ah", "oh", "oo"; "ah" by default); `tied`: the same chord
 * held on from the bar before.
 * @typedef {ScoreEventBase & ScoreLegato & { kind: 'choir', notes: number[], dur: number, vel: number, vowel?: 'a'|'o'|'u' }} ChoirEvent
 */
/**
 * The organ (`swell`: the swell box opening; `pedal` a pedal rank — one note, its octave ranks fused
 * into it; `respeak` the pipes re-spoken phase-aligned with the same note before them in the
 * section) and the drone (`reed`: the festival's chanter drone).
 * @typedef {ScoreEventBase & { kind: 'organ', notes: number[], dur: number, vel: number, swell?: boolean, pedal?: boolean, respeak?: boolean }} OrganEvent
 * @typedef {ScoreEventBase & { kind: 'drone', notes: number[], dur: number, vel: number, reed?: boolean, respeak?: boolean }} DroneEvent
 */
/**
 * AudioSystem's own harp pluck and flute (Emberfall's instruments, played as they are): `big` and
 * `pan` from the kit's `arp`.
 * @typedef {ScoreEventBase & { kind: 'harp', midi: number, vel: number, dur?: number, big?: boolean }} HarpEvent
 * @typedef {ScoreEventBase & { kind: 'flute', midi: number, dur: number, vel: number }} FluteEvent
 */

// ---- rendered instruments (MusicRenders.js) ----

/**
 * A drum: the great drum, a taiko, a low tom, the festival's frame drum (its open boom or a tip
 * tap); `rr` its round-robin render.
 * @typedef {ScoreEventBase & { kind: 'drum', type: 'great'|'taiko'|'tom'|'frame'|'frameTip', vel: number, rr?: number }} DrumEvent
 */
/**
 * The timpani: a stroke (`vel`, `rr` its round-robin render) or a roll — one event, one membrane —
 * rising `roll: [v0, v1]` over `dur` beats.
 * @typedef {ScoreEventBase & { kind: 'timp', midi: number, vel: number, rr?: number, big?: boolean, roll?: never, dur?: number }} TimpStroke
 * @typedef {ScoreEventBase & { kind: 'timp', midi: number, roll: [number, number], dur: number, vel?: number, rr?: number, big?: boolean }} TimpRoll
 * @typedef {TimpStroke|TimpRoll} TimpEvent
 */
/**
 * A great bell tolling (`decay` its ring, s at the hum), the tam-tam, the suspended cymbal (a
 * crash, or with `swell` a roll rising over `dur` beats to the bar line, where it rings on).
 * @typedef {ScoreEventBase & { kind: 'toll', midi: number, vel: number, decay?: number, rr?: number }} TollEvent
 * @typedef {ScoreEventBase & { kind: 'tamtam', vel: number, rr?: number }} TamtamEvent
 * @typedef {ScoreEventBase & { kind: 'cymbal', vel: number, dur?: number, swell?: boolean }} CymbalEvent
 */
/**
 * The field snare, the tambourine's jingles, the villagers' claps (a crowd of them).
 * @typedef {ScoreEventBase & { kind: 'snare'|'jingle'|'clap', vel: number, rr?: number, big?: boolean }} HandPercEvent
 */
/**
 * The festival's lute: a plucked double course, damped after `dur` beats.
 * @typedef {ScoreEventBase & { kind: 'lute', midi: number, vel: number, dur: number, rr?: number }} LuteEvent
 */

/**
 * One event of a score section (a discriminated union on `kind`).
 * @typedef {StringsEvent|SoloEvent|BrassEvent|ChoirEvent|OrganEvent|DroneEvent|HarpEvent|FluteEvent
 *   |DrumEvent|TimpEvent|TollEvent|TamtamEvent|CymbalEvent|HandPercEvent|LuteEvent} ScoreEvent
 */
/** @typedef {ScoreEvent['kind']} ScoreKind */

/**
 * The kinds as a table: a kind of the union missing here, or one here the union does not have,
 * fails the type check.
 * @type {{ [K in ScoreKind]: true }}
 */
const KINDS = {
  // live (ScoreVoices.js; harp and flute AudioSystem's)
  strings: true, solo: true, fiddle: true, brass: true, choir: true, organ: true, drone: true, harp: true, flute: true,
  // rendered (MusicRenders.js)
  drum: true, timp: true, toll: true, tamtam: true, cymbal: true, snare: true, jingle: true, clap: true, lute: true,
};

/**
 * Every event kind a score may emit (`scoreTrack` throws on another; `scoreVoice` logs one it has
 * no instrument for).
 * @type {readonly ScoreKind[]}
 */
export const SCORE_KINDS = Object.freeze(/** @type {ScoreKind[]} */ (Object.keys(KINDS)));

/**
 * The buses a track's `mix` sets (linear gains, ScoreVoices.js `scoreBuses`): the families (the
 * strings and their desks, the brass and its families, the choir, …), AudioSystem's harp and flute,
 * the rendered percussion's buses and the distance bus.
 * @typedef {'strings'|'vn'|'va'|'vc'|'cb'|'solo'|'fiddle'|'brass'|'hn'|'tbn'|'tba'|'choir'|'organ'|'drone'
 *   |'harp'|'flute'|'drums'|'timp'|'bells'|'metal'|'lute'|'far'} ScoreBusName
 */

/**
 * One section of a score track: `bars` bars; `bpm` its own tempo (taken at its first beat); `bpb`
 * its own beats per bar (else the track's: a 3/4 section in a 4/4 track — The Bells of Evermere's
 * song inside the King's track); `level` scales its velocities; `write(S)` scores it.
 * @typedef {{ bars: number, bpm?: number, bpb?: number, level?: number, write: (S: Score) => void }} ScoreSectionDef
 */
/**
 * A static filter of a track's mix EQ: [type, Hz, Q, gain dB] in WebAudio's meanings (Q in dB for
 * lowpass and highpass, linear for peaking, bandpass and the shelves' slope, which WebAudio ignores).
 * @typedef {[BiquadFilterType, number, number, number?]} ScoreFilter
 */
/**
 * Where a track's mix EQ may sit (ScoreVoices.js `scoreBuses`): an instrument's sub-bus (the string
 * desks, the solo cello, the fiddle, the horns — `hnc` the cuivré horn —, trombones and tubas, the
 * organ, the drone and the chanter's `reed`), a whole family ('strings', 'brass', 'choir') or a
 * rendered instrument's bus ('drums', 'timp', 'bells', 'metal', 'lute', 'far').
 * @typedef {'vn'|'va'|'vc'|'cb'|'solo'|'fiddle'|'hn'|'hnc'|'tbn'|'tba'|'organ'|'drone'|'reed'
 *   |'strings'|'brass'|'choir'|'drums'|'timp'|'bells'|'metal'|'lute'|'far'} ScoreEqName
 */
/**
 * A score track's definition (Scores.js `SCORE_TRACKS`): `bpb` beats per bar (3: the festival's 6/8
 * in quarter beats), `mix` the instance's bus levels, `eq` its mix EQ (static filters after an
 * instrument's own — outside its per-note level, so a cut takes energy out —, before the trim and
 * the reverb sends), `gain` the whole track's level, `order` as for AudioSystem's COMBAT_TRACKS
 * ('alternate' | 'hold').
 * @typedef {{ title: string, bpm: number, seed: number, order: string, start: string,
 *   bpb?: number, gain?: number, mix?: Partial<Record<ScoreBusName, number>>,
 *   eq?: Partial<Record<ScoreEqName, ScoreFilter[]>>,
 *   sections: Record<string, ScoreSectionDef> }} ScoreTrackDef
 */
/**
 * A built section: its sorted events, length in beats, beats per bar, the melodies' bar-line
 * issues and its tempo.
 * @typedef {{ events: ScoreEvent[], lengthBeats: number, bpb: number, issues: string[], bpm: number }} ScoreSection
 */

// ---------------------------------------------------------------------------------------------
// Notes, chords and the low-interval rule
// ---------------------------------------------------------------------------------------------

const PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Chord qualities: semitones above the root. */
const QUALITY = {
  '': [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], sus4: [0, 5, 7], sus2: [0, 2, 7], 5: [0, 7],
  maj7: [0, 4, 7, 11], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], add9: [0, 4, 7, 2],
};

/** A note name → MIDI: 'E4' 64, 'Bb3' 58, 'F#5' 78. */
export function noteNum(s) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(s);
  if (!m) throw new Error(`[AudioSystem] bad note "${s}"`);
  return 12 * (Number(m[3]) + 1) + PITCH_CLASS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/**
 * A chord's pitch classes and the tones a voicing must keep.
 * @typedef {{ name: string, root: number, bass: number, pcs: number[], third: number, dim: boolean }} ChordInfo
 */

/**
 * A chord name → its pitch classes: 'Em', 'Bb', 'Dsus4', 'F#m7', 'Eb/G' (a slash names the bass;
 * `pcs` does not hold it unless it is a chord tone). `third` the third's pitch class (−1: a sus or
 * power chord), `dim` a diminished fifth.
 * @param {string} name
 * @returns {ChordInfo}
 */
export function chordOf(name) {
  const m = /^([A-G])(#|b)?(m7|maj7|m|dim|sus4|sus2|5|7|add9)?(?:\/([A-G])(#|b)?)?$/.exec(name);
  if (!m) throw new Error(`[AudioSystem] bad chord "${name}"`);
  const acc = (a) => (a === '#' ? 1 : a === 'b' ? -1 : 0);
  const root = (PITCH_CLASS[m[1]] + acc(m[2]) + 12) % 12;
  const q = QUALITY[m[3] ?? ''];
  return {
    name, root,
    bass: m[4] ? (PITCH_CLASS[m[4]] + acc(m[5]) + 12) % 12 : root,
    pcs: q.map((i) => (root + i) % 12),
    third: q.includes(3) ? (root + 3) % 12 : q.includes(4) ? (root + 4) % 12 : -1,
    dim: q.includes(6),
  };
}

/** The lowest MIDI note ≥ `lo` of pitch class `pc`. */
export const pcFrom = (pc, lo) => lo + ((((pc - lo) % 12) + 12) % 12);

/**
 * The low-interval limits: for an interval of n semitones (1–7), the lowest MIDI note at which it
 * still sounds clear (a minor second from E3, a major second from E♭3, a minor third from C3, a
 * major third from B♭2, a fourth from A2, a tritone from B2, a fifth from B♭1); none from 8 up.
 * @type {Readonly<Record<number, number>>}
 */
export const LOW_LIMIT = Object.freeze({ 1: 52, 2: 51, 3: 48, 4: 46, 5: 45, 6: 47, 7: 34 });

/** Whether two notes sounding together are clear: their interval at the lower one is at or above its `LOW_LIMIT`. */
export function clearPair(a, b) {
  const lim = LOW_LIMIT[Math.abs(a - b)];
  return lim === undefined || Math.min(a, b) >= lim;
}

/**
 * Notes moved apart until every interval is clear (`LOW_LIMIT`): one move per pass — the upper
 * note of the lowest muddy pair goes up an octave — then sorted again. A deliberate cluster is
 * written `exact` instead (`Score.chord`).
 * @param {number[]} notes
 */
export function spread(notes) {
  const out = [...notes].sort((a, b) => a - b);
  for (let guard = 0; guard < 64; guard++) {
    let i = 1;
    while (i < out.length && clearPair(out[i - 1], out[i])) i++;
    if (i >= out.length) break;
    out[i] += 12;
    out.sort((a, b) => a - b);
  }
  return out;
}

/**
 * A grinding cluster on a chord's bass (≥ `lo`), for the low brass: the bass, its fifth (the
 * tritone in a diminished chord) and the minor ninth above it. With `mode` (pitch classes) a fifth
 * outside it becomes the tritone, and a ♭9 outside it moves the semitone onto the fifth (the note a
 * semitone above it) or, failing that, becomes the bass's lower neighbour in the mode (the dragon's
 * locrian: G♭, never G). The notes come unplaced — `Score.stack` spreads them (`grindAlt`: the
 * colour it tries when the ♭9 finds no room).
 * @param {string} name @param {number} lo @param {number[]} [mode]
 */
export function grind(name, lo, mode) {
  const ch = chordOf(name);
  const r = pcFrom(ch.bass, lo);
  let fifth = ch.dim && !ch.pcs.includes((ch.root + 7) % 12) ? r + 6 : r + 7;
  if (mode && !mode.includes(pcOf(fifth)) && mode.includes(pcOf(r + 6))) fifth = r + 6;
  const inMode = (m) => !mode || mode.includes(pcOf(m));
  return [r, fifth, inMode(r + 1) ? r + 13 : inMode(fifth + 1) ? fifth + 13 : r + 12 + modeNote(r, 1, mode)];
}

/**
 * The colour a grind (`grind`) falls back on when its ♭9 has no room: the semitone above its fifth
 * (in `mode`), else none.
 * @param {number[]} g a grind's notes @param {number[]} [mode]
 * @returns {number[]}
 */
export function grindAlt(g, mode) {
  const c = g[1] + 13;
  return c !== g[2] && (!mode || mode.includes(pcOf(c))) ? [c] : [];
}

/**
 * An ostinato's offset `off` from a root kept in `mode` (pitch classes): an out-of-mode minor
 * second becomes the root's lower neighbour in the mode, an out-of-mode tritone the fifth (or the
 * root), anything else out of the mode the nearest mode note below it. `root` is a pitch class or
 * a MIDI note; the result is the offset to play.
 * @param {number} root @param {number} off @param {number[]} mode
 */
export function modeNote(root, off, mode) {
  const inMode = (o) => mode.includes(pcOf(root + o));
  if (inMode(off)) return off;
  const o12 = ((off % 12) + 12) % 12;
  const base = off - o12;
  if (o12 === 1) {
    for (const d of [-1, -2]) if (inMode(d)) return base + d;
    return base;
  }
  if (o12 === 6) return inMode(7) ? base + 7 : base;
  for (let d = 1; d < 12; d++) if (inMode(off - d)) return off - d;
  return off;
}

/** `n` chord tones upward from `lo` (close position; the harp's arpeggios). */
export function voicing(ch, lo, n) {
  const out = [];
  for (let m = lo; out.length < n; m++) if (ch.pcs.includes(pcOf(m))) out.push(m);
  return out;
}

/** Every k-subset of `arr` (in order), passed to `fn`. */
function eachCombo(arr, k, fn, start = 0, acc = []) {
  if (acc.length === k) {
    fn(acc);
    return;
  }
  for (let i = start; i <= arr.length - (k - acc.length); i++) {
    acc.push(arr[i]);
    eachCombo(arr, k, fn, i + 1, acc);
    acc.pop();
  }
}

/** How far a voicing moves from the one before it (sorted notes paired; else nearest notes both ways). */
function motion(prev, c) {
  if (prev.length === c.length) {
    let s = 0;
    for (let i = 0; i < c.length; i++) s += Math.abs(c[i] - prev[i]);
    return s;
  }
  const near = (m, set) => set.reduce((d, x) => Math.min(d, Math.abs(m - x)), Infinity);
  return (c.reduce((s, m) => s + near(m, prev), 0) + prev.reduce((s, p) => s + near(p, c), 0)) / 2;
}

/**
 * Voice a chord: up to `n` notes in [`lo`, `hi`] — every adjacent pair clear (`LOW_LIMIT`), the
 * third never doubled, the root, third and a diminished fifth kept (`bass`: the lowest note is the
 * chord's bass, a slash bass included) — moving least from `prev` (sorted pairs; common tones stay)
 * or, with none before, sitting in the middle of the range (`mid`: a centre it keeps near, pulled
 * harder). It thins to n − 1 notes before it drops a root or third, and drops one only when
 * nothing else fits. No note within `gap` semitones of an `avoid` note (a melody's); `ok(m)`
 * filters the candidates further (the Score's held notes and the melody's lane). Null when no
 * note fits at all.
 * @param {string|ChordInfo} chord
 * @param {number[]|null} prev
 * @param {{ lo: number, hi: number, n?: number, bass?: boolean, mid?: number, avoid?: number[], gap?: number,
 *   ok?: ((m: number) => boolean)|null }} opts
 * @returns {number[]|null}
 */
export function voice(chord, prev, { lo, hi, n = 3, bass = false, mid, avoid = [], gap = 2, ok = null }) {
  const ch = typeof chord === 'string' ? chordOf(chord) : chord;
  const need = [ch.root];
  if (ch.third >= 0) need.push(ch.third);
  if (ch.dim) need.push((ch.root + 6) % 12);
  if (bass && !need.includes(ch.bass)) need.push(ch.bass);
  const cand = [];
  for (let m = lo; m <= hi; m++) {
    const pc = pcOf(m);
    if (!(ch.pcs.includes(pc) || (bass && pc === ch.bass)) || avoid.some((a) => Math.abs(a - m) <= gap)) continue;
    if (!ok || ok(m)) cand.push(m);
  }
  const centre = mid ?? (lo + hi) / 2;
  const pull = mid === undefined ? (prev ? 0.08 : 0.4) : 0.3;
  let best = null;
  let bestCost = Infinity;
  const consider = (c, k, allowMissing) => {
    if (bass && pcOf(c[0]) !== ch.bass) return;
    let thirds = 0;
    let seconds = 0;
    for (let i = 0; i < c.length; i++) {
      const pc = pcOf(c[i]);
      if (i > 0 && !ch.pcs.includes(pc)) return; // a slash bass only at the bottom
      if (pc === ch.third && ++thirds > 1) return;
      if (i > 0) {
        if (!clearPair(c[i - 1], c[i])) return;
        if (c[i] - c[i - 1] <= 2) seconds++;
      }
    }
    let missing = 0;
    for (const p of need) if (!c.some((m) => pcOf(m) === p)) missing++;
    if (missing && !allowMissing) return;
    const pcs = new Set(c.map(pcOf));
    let cost = missing * 20 + (n - k) * 6 + seconds * 1.5 + (c.length - pcs.size) * 0.4;
    cost += prev ? motion(prev, c) : 0;
    cost += c.reduce((s, m) => s + Math.abs(m - centre), 0) * pull;
    if (cost < bestCost - 1e-9) {
      bestCost = cost;
      best = [...c];
    }
  };
  for (let k = n; k >= Math.max(1, n - 1); k--) if (k <= cand.length) eachCombo(cand, k, (c) => consider(c, k, false));
  if (!best) for (let k = n; k >= 1; k--) if (k <= cand.length) eachCombo(cand, k, (c) => consider(c, k, true));
  return best;
}

// ---------------------------------------------------------------------------------------------
// Lines: what QA counts and the Score places against
// ---------------------------------------------------------------------------------------------

/** Kinds whose notes are held (when a beat or longer): what the low-interval rule and the lane rule look at. */
const HELD_KINDS = new Set(['strings', 'solo', 'fiddle', 'brass', 'choir', 'organ', 'drone', 'flute']);
/** Kinds whose notes are struck and not counted as a line (the drums, the timpani, the bells, the metals). */
export const PERCUSSION_KINDS = Object.freeze(['drum', 'timp', 'toll', 'tamtam', 'cymbal', 'snare', 'jingle', 'clap']);

/** An event's pitches (its chord or its note; none for percussion without a pitch). */
export const pitchesOf = (ev) => /** @type {number[]} */ (ev.notes ?? (ev.midi !== undefined ? [ev.midi] : []));

/**
 * Whether an event's notes are held — a pitched, bowed, blown or sung note of a beat or longer
 * (plucked and struck notes decay; shorter notes pass): the notes `LOW_LIMIT` and the melody's lane
 * are checked against.
 * @param {any} ev
 */
export const isHeld = (ev) => HELD_KINDS.has(ev.kind) && (ev.dur ?? 0) >= 1 && pitchesOf(ev).length > 0;

/**
 * The score line an event belongs to: its `line`, else a melody's 'lead', else its kind and desk
 * or family ('strings/vc', 'brass/tbn', 'choir').
 * @param {any} ev
 */
export function scoreLine(ev) {
  if (ev.line) return ev.line;
  if (ev.lead) return 'lead';
  const sub = ev.sec ?? ev.fam;
  return sub ? `${ev.kind}/${sub}` : ev.kind;
}

/** A desk or family spec 'brass/tbn', 'strings/va', 'choir' → the event's kind and its `fam` / `sec`. */
function familyOf(spec) {
  const [kind, sub] = spec.split('/');
  if (!sub) return { kind, props: {} };
  return { kind, props: kind === 'brass' ? { fam: sub } : { sec: sub } };
}

/** The legato kinds that slur adjacent notes of different pitch by themselves; the rest articulate unless a token ends in '_'. */
const SLURRING = new Set(['strings', 'solo', 'choir']);

// ---------------------------------------------------------------------------------------------
// The scoring kit
// ---------------------------------------------------------------------------------------------

/**
 * One section being scored: `bars` bars of `bpb` beats; the helpers push events (beats from the
 * section's start) for `_scheduleMusic`; velocities are humanised by the track's build RNG and
 * never exceed 1. Step strings spread their characters evenly over a bar: an upper-case letter is
 * an accent (1), lower case a normal stroke (0.62), 'o' a ghost (0.32), '.' a rest; for the drums
 * 'B' / 'b' are the big drum, 'X' / 'x' / 'o' the small one.
 *
 * The Score remembers what it has written: the melodies (`lead` events), every held note of every
 * line and the exact clusters. `voiced`, `bass` and `stack` place their notes against them, so a
 * section is written melody first, then the bass and the pedals, then the harmony and the colours.
 */
export class Score {
  /** @param {number} bars @param {number} bpb @param {() => number} rng @param {number} [level] */
  constructor(bars, bpb, rng, level = 1) {
    this.bars = bars;
    this.bpb = bpb;
    this.rng = rng;
    /** The section's level: every velocity is scaled by it (`hum`). */
    this.level = level;
    /** @type {ScoreEvent[]} */
    this.events = [];
    /** Bar lines of `mel` that do not fall on a bar (`tracks.issues`, read by sandbox/vq_audio.js). */
    this.issues = [];
    /** @type {{ from: number, to: number, midi: number, line: string }[]} every held note written */
    this.held = [];
    /** @type {{ from: number, to: number, midi: number, line: string }[]} every melody note */
    this.leads = [];
    /** @type {{ from: number, to: number, midi: number, line: string }[]} every note of an exact cluster */
    this.exacts = [];
    /** @type {Map<string, { notes: number[], end: number, evs?: ScoreEvent[] }>} each chord line's last voicing (and its events) */
    this.chains = new Map();
    /** @type {Map<string, number>} each bass line's last note */
    this.basses = new Map();
    /** @type {Map<ScoreEvent, ScoreEvent>} a `tied` event → the one it slurs or holds on from (it keeps its timing: `stampPerformance`) */
    this.ties = new Map();
  }

  /** The beat of (bar, beat). */
  at(bar, beat = 0) { return bar * this.bpb + beat; }

  /** A velocity with ±6 % seeded variation, at the section's level (at most 1). */
  hum(v) { return Math.min(1, v * this.level * (0.94 + this.rng() * 0.12)); }

  /**
   * An event of `kind` at `beat` with its fields; registers its melody notes and held notes. A
   * trombone note below E2 goes to the tuba.
   * @param {ScoreKind} kind @param {number} beat @param {object} props
   */
  add(kind, beat, props) {
    const ev = /** @type {any} */ ({ beat, kind, ...props });
    if (kind === 'brass' && ev.fam === 'tbn' && ev.midi !== undefined && ev.midi < 40) ev.fam = 'tba';
    this.events.push(ev);
    const pitches = pitchesOf(ev);
    if (!pitches.length || PERCUSSION_KINDS.includes(kind)) return ev;
    const line = scoreLine(ev);
    const span = { from: beat, to: beat + (ev.dur ?? 0) };
    if (ev.lead) for (const midi of pitches) this.leads.push({ ...span, midi, line });
    if (ev.exact) for (const midi of pitches) this.exacts.push({ ...span, midi, line });
    if (isHeld(ev)) for (const midi of pitches) this.held.push({ ...span, midi, line });
    return ev;
  }

  /**
   * Whether a note `m` held over [from, to) by `line` is clear of every other line's held notes
   * (`LOW_LIMIT`) and, with `lead`, keeps out of the melodies' lane: more than `gap` semitones from
   * every melody note sounding with it (`upper`: only the melody notes within an octave of the
   * highest one — a tune, not its doubling an octave below — though never in unison with one), and
   * neither on nor a semitone from an exact cluster's note (a cluster is not thickened). `octave`:
   * nor on a sounding melody note's pitch class above it (a held cluster's top never doubles the
   * tune an octave or more up).
   * @param {number} m @param {number} from @param {number} to @param {string} line
   * @param {{ gap?: number, lead?: boolean, held?: boolean, upper?: boolean, octave?: boolean }} [opts]
   */
  fits(m, from, to, line, { gap = 2, lead = true, held = true, upper = false, octave = false } = {}) {
    const over = (x) => x.line !== line && x.from < to && x.to > from;
    if (held) for (const h of this.held) if (over(h) && !clearPair(m, h.midi)) return false;
    if (octave) for (const l of this.leads) if (over(l) && l.midi < m && pcOf(l.midi) === pcOf(m)) return false;
    if (lead) {
      const sounding = this.leads.filter(over);
      const floor = upper ? Math.max(-Infinity, ...sounding.map((l) => l.midi)) - 11 : -Infinity;
      for (const l of sounding) if (l.midi === m || (l.midi >= floor && Math.abs(l.midi - m) <= gap)) return false;
      for (const e of this.exacts) if (over(e) && Math.abs(e.midi - m) <= 1) return false;
    }
    return true;
  }

  /**
   * A melody in shorthand from `bar`: tokens 'E4:1.5' (a note of 1.5 beats; '!' after it accents,
   * '~' softens, a final '_' slurs it into the next note), 'r:1' (a rest), '|' (a bar line, checked
   * to fall on one); consecutive. Legato: strings, the solo cello and the choir slur adjacent notes
   * of different pitch; brass, flute and fiddle articulate each note unless it ends in '_'; a
   * repeated pitch is always played again. `lead` marks a melody (its `line` 'lead' unless given:
   * an octave doubling passes the same line, a counter-melody its own). `fold` (a doubling `oct`
   * octaves away): a note muddy there against another line's held notes (`LOW_LIMIT`: the bass
   * under a doubling an octave down) is played at its written pitch instead.
   * @param {ScoreKind} kind @param {number} bar @param {string} text
   * @param {{ vel?: number, oct?: number, legato?: number, lead?: boolean, line?: string, fold?: boolean, [field: string]: unknown }} [opts]
   */
  mel(kind, bar, text, { vel = 1, oct = 0, legato = 1, lead = false, line, fold = false, ...extra } = {}) {
    let beat = bar * this.bpb;
    const toks = [];
    for (const tok of text.trim().split(/\s+/)) {
      if (tok === '|') {
        if (Math.abs(beat / this.bpb - Math.round(beat / this.bpb)) > 1e-6) this.issues.push(`${kind} bar line at beat ${beat}`);
        continue;
      }
      const m = /^([^:]+):([\d.]+)([!~]?)(_?)$/.exec(tok);
      if (!m) throw new Error(`[AudioSystem] bad melody token "${tok}"`);
      const dur = Number(m[2]);
      toks.push({
        rest: m[1] === 'r', midi: m[1] === 'r' ? 0 : noteNum(m[1]) + oct * 12, beat, dur,
        k: m[3] === '!' ? 1.18 : m[3] === '~' ? 0.72 : 1, slur: m[4] === '_',
      });
      beat += dur;
    }
    if (fold && oct) {
      const ln = lead ? line ?? 'lead' : line ?? scoreLine({ kind, ...extra });
      for (const t of toks) if (!t.rest && !this.fits(t.midi, t.beat, t.beat + t.dur * legato, ln, { lead: false })) t.midi -= oct * 12;
    }
    const slurs = SLURRING.has(kind);
    let before = null;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.rest) {
        before = null;
        continue;
      }
      const p = toks[i - 1];
      const q = toks[i + 1];
      const props = /** @type {Record<string, unknown>} */ ({ midi: t.midi, dur: t.dur * legato, vel: this.hum(vel * t.k) });
      if (p && !p.rest && p.midi !== t.midi && (slurs || p.slur)) props.tied = true;
      if (q && !q.rest && q.midi !== t.midi && (slurs || t.slur)) props.next = q.midi;
      if (lead) {
        props.lead = true;
        props.line = line ?? 'lead';
      } else if (line) props.line = line;
      const ev = this.add(kind, t.beat, { ...props, ...extra });
      if (props.tied && before) this.ties.set(ev, before);
      before = ev;
    }
  }

  /**
   * Strokes of an unpitched (or fixed-pitch) instrument along a bar; for `drum` the big strokes
   * ('B', 'b') are the drum `big`, the others the drum `small`.
   * @param {ScoreKind} kind @param {number} bar @param {string} pat @param {number} [vel]
   * @param {{ big?: string, small?: string, [field: string]: unknown }} [opts]
   */
  steps(kind, bar, pat, vel = 1, { big = 'great', small = 'taiko', ...extra } = {}) {
    const step = this.bpb / pat.length;
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i];
      const v = c === 'X' || c === 'B' ? 1 : c === 'x' || c === 'b' ? 0.62 : c === 'o' ? 0.32 : 0;
      if (!v) continue;
      const type = kind === 'drum' ? { type: c === 'B' || c === 'b' ? big : small } : {};
      this.add(kind, this.at(bar, i * step), { ...type, vel: this.hum(v * vel), ...extra });
    }
  }

  /**
   * A timpani roll: one event from (bar, beat) over `beats` beats, its strokes rising v0 → v1 (one
   * membrane, rendered whole).
   * @param {'timp'} kind @param {number} bar @param {number} beat @param {number} beats
   * @param {number} v0 @param {number} v1 @param {{ midi: number, [field: string]: unknown }} extra
   */
  roll(kind, bar, beat, beats, v0, v1, extra) {
    this.add(kind, this.at(bar, beat), { midi: extra.midi, roll: [this.hum(v0), this.hum(v1)], dur: beats, ...extra });
  }

  /**
   * A held chord of explicit MIDI notes (a cluster, a pedal) of `beats` from (bar, beat): spread
   * by `LOW_LIMIT` unless `exact` (a deliberate colour cluster, written and marked as it is).
   * @param {ScoreKind} kind @param {number} bar @param {number} beat @param {number} beats @param {number[]} notes
   * @param {{ vel?: number, exact?: boolean, [field: string]: unknown }} [opts]
   */
  chord(kind, bar, beat, beats, notes, { vel = 1, exact = false, ...extra } = {}) {
    this.add(kind, this.at(bar, beat), { notes: exact ? [...notes] : spread(notes), dur: beats, vel: this.hum(vel), ...(exact ? { exact: true } : {}), ...extra });
  }

  /**
   * The voicing a chord line `line` (`chain`: the voice-leading memory, default the line) takes
   * over [from, to): `voice` from the chain's last voicing, every note clear of the other lines'
   * held notes and more than `gap` semitones from the melodies (`avoid` 'lead': every melody note,
   * the doublings too; 'tune': the tunes only, not their doublings an octave below; false: none);
   * the chain moves on. `not`: notes it may not take.
   * @param {string} chord @param {number} from @param {number} to @param {string} line
   * @param {{ lo: number, hi: number, n?: number, bass?: boolean, mid?: number, chain?: string, avoid?: 'lead'|'tune'|false, gap?: number, not?: number[] }} opts
   * @returns {{ notes: number[], tied: boolean }|null}
   */
  voicing(chord, from, to, line, { lo, hi, n = 3, bass = false, mid, chain, avoid = 'lead', gap = 2, not = [] }) {
    const key = chain ?? line;
    const last = this.chains.get(key);
    const ok = (m) => !not.includes(m) && this.fits(m, from, to, line, { gap, lead: !!avoid, upper: avoid === 'tune' });
    const notes = voice(chord, last?.notes ?? null, { lo, hi, n, bass, mid, ok });
    if (!notes) return null;
    const tied = !!last && Math.abs(last.end - from) < 1e-9 && last.notes.length === notes.length && last.notes.every((m, i) => m === notes[i]);
    this.chains.set(key, { notes, end: to });
    return { notes, tied };
  }

  /**
   * A voiced chord of `beats` from (bar, beat) (`voicing`: led from its chain's last chord, clear of
   * what is held, out of the melody's lane). `split: [['brass/tba', 1], ['brass/tbn', 2], ['choir',
   * 3, { vowel: 'a' }], …]` deals the one voicing out bottom-up to several families (one chain, one
   * line, no shared notes; each event carries a `chordSize`: the voicing's when every part is of one
   * kind — string desks —, else its part's own notes); `tie`: the same chord
   * straight after its last one is marked `tied` (and keeps the last one's timing). `not`: notes it
   * may not take (another line's, not to be doubled in unison). Returns the notes (null when nothing
   * fits: the bar rests).
   * @param {ScoreKind} kind @param {number} bar @param {number} beat @param {number} beats @param {string} chord
   * @param {{ lo: number, hi: number, n?: number, bass?: boolean, mid?: number, chain?: string, avoid?: 'lead'|'tune'|false, gap?: number,
   *   split?: [string, number, object?][], tie?: boolean, vel?: number, line?: string, not?: number[], [field: string]: unknown }} opts
   */
  voiced(kind, bar, beat, beats, chord, opts) {
    const { lo, hi, n = 3, bass = false, mid, chain, avoid = 'lead', gap = 2, split = null, tie = false, vel = 1, line, not = [], ...extra } = opts;
    const from = this.at(bar, beat);
    const ln = line ?? chain ?? scoreLine({ kind, ...extra });
    const last = this.chains.get(chain ?? ln);
    const v = this.voicing(chord, from, from + beats, ln, { lo, hi, n, bass, mid, chain, avoid, gap, not });
    if (!v) return null;
    const tied = tie && v.tied ? { tied: true } : {};
    /** @type {ScoreEvent[]} */
    const evs = [];
    if (!split) evs.push(this.add(kind, from, { notes: v.notes, dur: beats, vel: this.hum(vel), line: ln, ...tied, ...extra }));
    else {
      // (one kind's desks or families share the voicing's level, each event its notes' share of the
      // whole chord; parts of different kinds — a chorale's tuba, trombones and choir — each its own
      // chord, so a brass part keeps its weight beside the choir: only a part's own split, the
      // trombones' low notes to the tuba, shares)
      const kinds = new Set(split.map(([spec]) => familyOf(spec).kind));
      const whole = Math.min(v.notes.length, split.reduce((s, [, count]) => s + count, 0));
      let i = 0;
      for (const [spec, count, part = {}] of split) {
        const ns = v.notes.slice(i, i + count);
        i += count;
        if (!ns.length) continue;
        const f = familyOf(spec);
        const chordSize = kinds.size === 1 ? whole : ns.length;
        const props = { dur: beats, vel: this.hum(vel), line: ln, chordSize, ...f.props, ...tied, ...extra, ...part };
        // the trombones from E2 up: their notes below it go to the tuba (same line)
        const low = f.kind === 'brass' && props.fam === 'tbn' ? ns.filter((m) => m < 40) : [];
        if (low.length) evs.push(this.add('brass', from, { notes: low, ...props, fam: 'tba' }));
        if (low.length < ns.length) evs.push(this.add(/** @type {ScoreKind} */ (f.kind), from, { notes: ns.filter((m) => !low.includes(m)), ...props }));
      }
    }
    // (a held chord keeps the timing of the one it holds on from: the same events, one by one)
    if (tied.tied && last?.evs?.length === evs.length) evs.forEach((ev, k) => this.ties.set(ev, last.evs[k]));
    this.chains.get(chain ?? ln).evs = evs;
    return v.notes;
  }

  /**
   * A bass line's note for a chord: its bass in the octave nearest the line's last note within
   * [`lo`, `hi`] (`near` before the first); the line (`chain`) moves on.
   * @param {string} chord @param {{ lo?: number, hi?: number, chain?: string, near?: number }} [opts]
   */
  bassNote(chord, { lo = 28, hi = 45, chain = 'bass', near = lo } = {}) {
    const pc = chordOf(chord).bass;
    const prev = this.basses.get(chain) ?? near;
    let best = null;
    for (let m = lo; m <= hi; m++) if (pcOf(m) === pc && (best === null || Math.abs(m - prev) < Math.abs(best - prev))) best = m;
    if (best === null) throw new Error(`[AudioSystem] no ${chord} bass in ${lo}..${hi}`);
    this.basses.set(chain, best);
    return best;
  }

  /** The celli's note over a bass note: an octave above, or the bass's own note (at half level) when that would pass E3. */
  vcOf(cb) { return cb + 12 <= 52 ? cb + 12 : cb; }

  /**
   * The bass of a chord as a line (`bassNote`): for `strings` the basses (`desks` 'cb') and the
   * celli an octave above (`vcOf`; 'vc'), or both ('both': one line); another kind plays the
   * bass's note itself. `fit`: a note muddy against another line's held notes (`LOW_LIMIT`) is left
   * out. Returns the bass note.
   * @param {ScoreKind} kind @param {number} bar @param {number} beat @param {string} chord
   * @param {{ lo?: number, hi?: number, chain?: string, near?: number, dur?: number, vel?: number,
   *   desks?: 'both'|'cb'|'vc', art?: string, fit?: boolean, line?: string, [field: string]: unknown }} [opts]
   */
  bass(kind, bar, beat, chord, { lo = 28, hi = 45, chain = 'bass', near = lo, dur = 1, vel = 1, desks = 'both', art = 'sus', fit = true, line, ...extra } = {}) {
    const from = this.at(bar, beat);
    const cb = this.bassNote(chord, { lo, hi, chain, near });
    const ln = line ?? chain;
    const emit = (midi, props, v) => {
      if (fit && dur >= 1 && !this.fits(midi, from, from + dur, ln, { lead: false })) return;
      this.add(kind, from, { midi, dur, vel: this.hum(v), line: ln, ...props, ...extra });
    };
    if (kind !== 'strings') emit(cb, {}, vel);
    else {
      if (desks !== 'vc') emit(cb, { sec: 'cb', art }, vel);
      const vc = this.vcOf(cb);
      if (desks !== 'cb') emit(vc, { sec: 'vc', art }, vc === cb ? vel * 0.5 : vel);
    }
    return cb;
  }

  /**
   * A pitched ostinato on the chord's bass note: `root`, else (`chain`) the bass line's note nearest
   * its last in [`lo`, `hi`] (`bassNote`), else the bass from `lo` up; a stroke per step character,
   * each a semitone offset from `offs` in turn (in `mode`: `modeNote`); notes `dur` beats long.
   * @param {ScoreKind} kind @param {number} bar @param {string} chord @param {string} pat
   * @param {{ lo?: number, hi?: number, root?: number, chain?: string, offs?: number[], dur?: number, vel?: number, mode?: number[], [field: string]: unknown }} [opts]
   */
  ost(kind, bar, chord, pat, { lo = 36, hi, root, chain, offs = [0], dur = 0.4, vel = 1, mode, ...extra } = {}) {
    const r = root ?? (chain ? this.bassNote(chord, { lo, hi: hi ?? lo + 11, chain }) : pcFrom(chordOf(chord).bass, lo));
    const step = this.bpb / pat.length;
    let k = 0;
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i];
      const v = c === 'X' ? 1 : c === 'x' ? 0.68 : c === 'o' ? 0.4 : 0;
      if (!v) continue;
      const off = offs[k++ % offs.length];
      this.add(kind, this.at(bar, i * step), { midi: r + (mode ? modeNote(r, off, mode) : off), dur, vel: this.hum(v * vel), ...extra });
    }
  }

  /**
   * A brass chord placed by register, from its lowest (written) note up: each note takes, of its
   * written octave, the one above, the one below, two above …, the first that is clear (`LOW_LIMIT`)
   * of the notes placed and — held — of the other lines' held notes, and out of the melody's lane
   * (more than `gap` semitones from the melody notes sounding with it: held, every one of them, a
   * doubling too; a short stab, only the tune's — its top may grind against the doubling below); no
   * note goes under the first one placed (the chord's bass), none above `top` — a note that fits
   * nowhere is left out, and the notes of `alt` are tried in its place (a grind's other colour,
   * `grindAlt`); a held note never doubles a sounding melody note an octave or more above it
   * (`fits` `octave`), and a stab's note that the doubling below the tune holds is left to it (in
   * the cluster, not struck again in unison). The tuba takes the notes below E2, the trombones up
   * to G4, the horns above (only ever above the theme). One line (`line`). Returns the notes played.
   * @param {number} bar @param {number} beat @param {number} beats @param {number[]} notes
   * @param {{ art?: 'stab'|'swell'|'sus', vel?: number, top?: number, gap?: number, alt?: number[], line?: string, [field: string]: unknown }} [opts]
   */
  stack(bar, beat, beats, notes, { art = 'stab', vel = 1, top = 77, gap = 2, alt = [], line = 'grind', ...extra } = {}) {
    const from = this.at(bar, beat);
    const to = from + beats;
    const sorted = [...notes].sort((a, b) => a - b);
    const placed = [];
    const held = beats >= 1;
    // (a short stab's note that a melody's doubling below the tune holds then is left to it:
    // counted in the cluster, not struck a second time in unison)
    const sounding = this.leads.filter((l) => l.line !== line && l.from < to && l.to > from);
    const floor = Math.max(-Infinity, ...sounding.map((l) => l.midi)) - 11;
    const given = (m) => !held && sounding.some((l) => l.midi === m && l.midi < floor);
    for (const n of [...sorted, ...alt]) {
      if (placed.length >= sorted.length) break;
      for (const m of [n, n + 12, n - 12, n + 24, n - 24, n + 36]) {
        if (m < 26 || m > top || placed.includes(m) || (placed.length && m < placed[0])) continue;
        if (!placed.every((p) => clearPair(p, m))) continue;
        if (!given(m) && !this.fits(m, from, to, line, { gap, held, upper: !held, octave: held })) continue;
        placed.push(m);
        break;
      }
    }
    const played = placed.filter((m) => !given(m)).sort((a, b) => a - b);
    const v = this.hum(vel);
    for (const [fam, part] of [['tba', played.filter((m) => m < 40)], ['tbn', played.filter((m) => m >= 40 && m <= 67)], ['hn', played.filter((m) => m > 67)]]) {
      if (part.length) this.add('brass', from, { notes: part, dur: beats, vel: v, fam, art, line, ...extra });
    }
    return played;
  }

  /**
   * An arpeggio over a bar: `n` chord tones from `lo`, `pat` indices every `step` beats.
   * @param {number} bar @param {string} chord
   * @param {{ lo?: number, n?: number, step?: number, pat?: number[], vel?: number, kind?: ScoreKind, dur?: number, beats?: number, from?: number }} [opts]
   */
  arp(bar, chord, { lo = 55, n = 6, step = 0.5, pat = [0, 1, 2, 3, 4, 3, 2, 1], vel = 0.45, kind = 'harp', dur = step, beats = this.bpb, from = 0 } = {}) {
    const tones = voicing(chordOf(chord), lo, n);
    const count = Math.round(beats / step);
    for (let i = 0; i < count; i++) {
      const idx = pat[i % pat.length];
      const accent = (i * step) % 1 < 1e-6 ? 1.18 : 1;
      this.add(kind, this.at(bar, from + i * step), {
        midi: tones[idx], dur, vel: this.hum(vel * accent), pan: -0.35 + (idx / Math.max(1, n - 1)) * 0.7,
        jitter: (this.rng() - 0.5) * 0.008,
      });
    }
  }

  /**
   * A strummed chord (the festival's lute): an open voicing led from the strum's last one
   * (`voicing`, chain 'strum'), the strings 22 ms apart from the lowest, each damped after `dur`
   * beats.
   * @param {ScoreKind} kind @param {number} bar @param {number} beat @param {string} chord
   * @param {{ lo?: number, hi?: number, n?: number, vel?: number, dur?: number }} [opts]
   */
  strum(kind, bar, beat, chord, { lo = 50, hi = 69, n = 4, vel = 0.5, dur = 1.3 } = {}) {
    const from = this.at(bar, beat);
    const v = this.voicing(chord, from, from + dur, 'strum', { lo, hi, n, avoid: false });
    if (!v) return;
    v.notes.forEach((m, i) => this.add(kind, from, {
      midi: m, dur, vel: this.hum(vel * (1 - i * 0.08)), pan: -0.25 + i * 0.15, line: 'strum',
      jitter: Math.round((i * 0.022 + (this.rng() - 0.5) * 0.006) * 1e4) / 1e4,
    }));
  }

  /**
   * The chord's bass note as one note (≥ `lo`; with `chain`, the octave nearest the line's last
   * note in [`lo`, `hi`]), or its fifth — the one above, or below where that would leave the range
   * (a bass alternating root and fifth stays in its register, under the strums).
   * @param {ScoreKind} kind @param {number} bar @param {number} beat @param {string} chord
   * @param {{ lo?: number, hi?: number, chain?: string, dur?: number, vel?: number, fifth?: boolean, line?: string, [field: string]: unknown }} [opts]
   */
  root(kind, bar, beat, chord, { lo = 38, hi, chain, dur = 1, vel = 1, fifth = false, line, ...extra } = {}) {
    const top = hi ?? lo + 11;
    const r = chain ? this.bassNote(chord, { lo, hi: top, chain }) : pcFrom(chordOf(chord).bass, lo);
    const midi = !fifth ? r : r + 7 <= top || r - 5 < lo ? r + 7 : r - 5;
    this.add(kind, this.at(bar, beat), { midi, dur, vel: this.hum(vel), pan: -0.1, ...(line ? { line } : {}), ...extra });
  }

  /** Each chord of `prog` in turn, with its bar (`fn(chord, bar, sameAsBefore)`). */
  each(prog, fn) {
    prog.forEach((c, b) => fn(c, b, b > 0 && prog[b - 1] === c));
  }

  /** The sorted events, the length in beats, the beats per bar and the bar-line issues. */
  done() {
    this.events.sort((a, b) => a.beat - b.beat);
    return { events: this.events, lengthBeats: this.bars * this.bpb, bpb: this.bpb, issues: this.issues };
  }
}

// ---------------------------------------------------------------------------------------------
// Performance, stamped at build
// ---------------------------------------------------------------------------------------------

/** Round-robin renders per rendered kind (`rr` cycles through them per kind and pitch or drum type). */
export const ROUND_ROBINS = Object.freeze({ drum: 3, timp: 2, snare: 3, jingle: 3, clap: 3, lute: 2, toll: 1, tamtam: 1 });

/** A seeded offset in [centre − spread, centre + spread] seconds, rounded to 0.1 ms. */
const offset = (rng, centre, spread) => Math.round((centre + (rng() * 2 - 1) * spread) * 1e4) / 1e4;

/**
 * An event's timing off the grid (s), by articulation: short strings +4 ms ± 3 (the grind stays
 * with the drums), held strings +10 ± 8, brass ± 6, the choir ± 15, the solo cello ± 10, the
 * fiddle and the flute ± 5, struck and plucked notes ± 3; the organ, the drone and a cymbal swell
 * (it peaks on the bar line) none.
 * @param {any} ev @param {() => number} rng
 */
function jitterOf(ev, rng) {
  switch (ev.kind) {
    case 'strings': return ev.art === 'spic' || ev.art === 'marc' ? offset(rng, 0.004, 0.003) : offset(rng, 0.01, 0.008);
    case 'brass': return offset(rng, 0, 0.006);
    case 'choir': return offset(rng, 0, 0.015);
    case 'solo': return offset(rng, 0, 0.01);
    case 'fiddle': case 'flute': return offset(rng, 0, 0.005);
    case 'organ': case 'drone': return 0;
    case 'cymbal': return ev.swell ? 0 : offset(rng, 0, 0.003);
    default: return offset(rng, 0, 0.003);
  }
}

/**
 * Stamp a built section's performance: `rr` on every rendered stroke (cycling per kind and pitch
 * or drum type, in time order; a timpani roll is one render and has none) and `jitter` on every
 * event that has none yet (an arpeggio's and a strum's own spread stay). A `tied` event takes the
 * jitter of the one it slurs or holds on from (`ties`), so a slur's join stays on its beat.
 * @param {ScoreEvent[]} events sorted
 * @param {() => number} rng the track's build RNG
 * @param {Map<ScoreEvent, ScoreEvent>} ties the Score's `ties`
 */
function stampPerformance(events, rng, ties) {
  const cycle = new Map();
  for (const e of events) {
    const ev = /** @type {any} */ (e);
    if (Object.hasOwn(ROUND_ROBINS, ev.kind) && !(ev.kind === 'timp' && ev.roll)) {
      const key = `${ev.kind}:${ev.type ?? ev.midi ?? ''}`;
      const k = cycle.get(key) ?? 0;
      ev.rr = k % ROUND_ROBINS[ev.kind];
      cycle.set(key, k + 1);
    }
    if (ev.jitter === undefined) {
      // (drawn for every event, so the others' timing does not depend on which are tied)
      const own = jitterOf(ev, rng);
      ev.jitter = ties.get(e)?.jitter ?? own;
    }
  }
}

/**
 * Build a score track's sections (each with its tempo and beats per bar), their performance
 * stamped (`rr`, `jitter`). Throws on an event of a kind not in `SCORE_KINDS` (no instrument would
 * play it) — or not in `kinds`, a pack's own table: SCORE_KINDS and the rendered kinds it registers
 * with MusicRenders.js (`registerRendered`: The Bells of Evermere's bells, evermere/Scores.js).
 * @param {ScoreTrackDef} def
 * @param {() => number} rng
 * @param {Readonly<Record<string, true>>} [kinds]
 * @returns {Record<string, ScoreSection>}
 */
export function buildScoreSections(def, rng, kinds = KINDS) {
  const out = {};
  for (const key of Object.keys(def.sections)) {
    const sec = def.sections[key];
    const S = new Score(sec.bars, sec.bpb ?? def.bpb ?? 4, rng, sec.level ?? 1);
    sec.write(S);
    for (const ev of S.events) {
      if (!Object.hasOwn(kinds, ev.kind)) throw new Error(`[AudioSystem] "${def.title}" section ${key}: no instrument plays the event kind "${ev.kind}" (SCORE_KINDS)`);
    }
    const built = S.done();
    stampPerformance(built.events, rng, S.ties);
    out[key] = { ...built, bpm: sec.bpm ?? def.bpm };
  }
  return out;
}
