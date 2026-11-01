/**
 * Text keys through edits (docs/specs/I18N.md §4.2, §4.10): how the editor and the generators keep
 * every translatable text's GUID (ContentKeys.js) when the text around it changes — as Unreal keeps
 * an FText's key: an edited line keeps its key (its translation then waits for review), a line that
 * moved keeps its key, a new line gets a new one, a removed line takes its key with it.
 *
 * - `alignTexts(old, new)`: which old text each new text continues — equal texts in order (a
 *   longest common subsequence; a long list anchors on texts once in each side first), moves, then
 *   edits (similar texts, the most alike first: between the equal ones, then across them; in the
 *   editor, what is left in place, in order).
 * - `carryObjectText(old, obj, mint, used)`: an object's `textKeys` and script tags after an edit
 *   (`old` is the object before it; null: the object's own keys are the old ones).
 * - `carryRootText`, `carryCampaignText`, `carryStoryFile`, `retagStoryText`: the same for a
 *   level's own texts, a campaign file, a story file and a `.story` file.
 * - `assignTextKeys(level, { previous, base, mint })`: the generators' pass — keys carried over from
 *   the previous output (the same text, a moved text, a similar edit), a chapter variant's unchanged
 *   lines keeping the base level's keys, new ones minted.
 * - `textKeyIssues(level)`: missing, stray and repeated keys (the level checks).
 *
 * Every pass keys in two phases: first each text takes the key it keeps (its own, the old text's)
 * while that key is free, then the texts left get new ones — a new key is never one already taken
 * (`used`), nor one the previous file held. `used` is the keys of the REST of the level (every other
 * object's, the level's own texts' when an object is edited) — never the edited object's own keys:
 * a key in `used` counts as taken elsewhere, so passing the object's own keys there gives every one
 * of its texts a new key (and loses every translation). `mint(seed)` makes a new key: `randomGuid`
 * in the editor, `seededMint(prefix)` in the generators and tools (the same input, the same keys:
 * their files stay byte for byte). Node-safe; the editor, the generators and the tools import it
 * (the game does not); it imports nothing from src/game (the engine never does).
 */

import {
  TEXT_KEY_FIELDS, LEVEL_TEXT_FIELDS, CHAPTER_TEXT_FIELDS, LINE_TAG, isGuid, toGuid, guidOf, splitLineTag,
  textPages, dialogueUnits, builtinLabel,
} from './ContentKeys.js';
import { parseScript, scriptLines, scriptTextSlots } from '../level/StoryScript.js';
// (the loader's ids of events and stages: from the engine's condition module, never from src/game)
import { eventIdOf, stageIdOf } from '../level/StoryCondition.js';

/**
 * Makes a new key for a text: `seed` names it (where it is, what it says) for a seeded minter;
 * `info` says which field and text it is for.
 * @typedef {(seed: string, info?: { field?: string, text?: string }) => string} Mint
 */

/** How alike two texts must be (0–1) for a changed text to count as an edit of an old one. */
export const SIMILAR = 0.5;

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => isPlain(o) && Object.prototype.hasOwnProperty.call(o, k);
const ownOf = (o, k) => (hasOwn(o, k) ? o[k] : undefined);
/** An id for a seed or a message: a string as it is, a number as text, anything else ''. */
const idText = (v) => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/**
 * Is `prefix` a seed prefix that gives the same keys on every machine: a repository-relative POSIX
 * path (`public/levels/gildhaven.json`) or a file stem (`gildhaven`) — no `\`, no drive, no leading
 * `/`, no empty, `.` or `..` segment?
 * @param {unknown} prefix
 */
function isSeedPrefix(prefix) {
  if (typeof prefix !== 'string' || !prefix || prefix.includes('\\') || prefix.startsWith('/') || /^[A-Za-z]:/.test(prefix)) return false;
  return prefix.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/**
 * A minter giving keys derived from `prefix` and each text's seed (`guidOf`), never one already
 * in `used` (a repeat seed takes the next counter). The generators and `npm run i18n:keys`.
 * @param {string} prefix a repository-relative POSIX path (`public/levels/x.json`) or a file stem —
 *   never an OS path: the keys of new texts would differ between machines (throws)
 * @param {Set<string>} [used] keys already taken (filled as it mints)
 * @returns {Mint}
 */
export function seededMint(prefix, used = new Set()) {
  if (!isSeedPrefix(prefix)) throw new Error(`seededMint: "${String(prefix)}" is no repository-relative POSIX path or file stem (an OS path would give other keys on another machine)`);
  return (seed) => {
    for (let n = 0; ; n++) {
      const g = guidOf(`${prefix}|${seed}${n ? `|${n}` : ''}`);
      if (!used.has(g)) { used.add(g); return g; }
    }
  };
}

/** The length of the longest common subsequence of two lists (=== items). */
function lcsLength(a, b) {
  if (!a.length || !b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  let cur = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/**
 * How alike two texts are, from 0 to 1: the share of words they have in common, in order, when both
 * have three or more; of characters for shorter texts.
 * @param {string} a
 * @param {string} b
 */
export function similarity(a, b) {
  if (a === b) return 1;
  return similarityOf(tokens(a), tokens(b)).sim;
}

/**
 * What `similarity` compares of a text: its words (lower case) and its first 400 characters.
 * @param {string} s
 * @returns {{ w: string[], c: string[] }}
 */
const tokens = (s) => ({ w: s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [], c: [...s.toLowerCase()].slice(0, 400) });

/**
 * `similarity` of two texts' tokens, and its cost (the cells of the subsequence it compared).
 * @param {{ w: string[], c: string[] }} a
 * @param {{ w: string[], c: string[] }} b
 */
function similarityOf(a, b) {
  if (a.w.length >= 3 && b.w.length >= 3) return { sim: (2 * lcsLength(a.w, b.w)) / (a.w.length + b.w.length), cost: a.w.length * b.w.length };
  const n = a.c.length + b.c.length;
  return { sim: n ? (2 * lcsLength(a.c, b.c)) / n : 0, cost: a.c.length * b.c.length };
}

/**
 * The exact subsequence is found for a middle of at most this many cells (old × new texts; a table
 * of at most about 1 MB); a longer middle is first cut at its anchors (texts once in each side).
 */
const MAX_CELLS = 1 << 18;
/** How deep the anchoring recurses (each level cuts the middle at texts once in each part). */
const MAX_ANCHOR_DEPTH = 32;
/**
 * The work the edits' similarity may take in one alignment (the cells of the subsequences it
 * compares: words, or characters — at most 400 a text): past it, the texts left stay unpaired —
 * new keys rather than a long stall on a huge run of unlike texts. Deterministic: the same input,
 * the same result.
 */
const MAX_SIMILARITY_CELLS = 30_000_000;

/**
 * The pairs of equal texts of `A[a0, a1)` and `B[b0, b1)` in order, appended to `out`: the equal
 * ends, then the longest common subsequence of the middle — or, for a middle of more than
 * `MAX_CELLS`, its anchors first (patience: the texts once in each side, never a weak one — a blank
 * or a non-text line —, their longest run in order), recursing between them. No anchor: nothing is
 * paired there (the moves pair equal texts after).
 * @param {readonly string[]} A @param {readonly string[]} B
 * @param {number} a0 @param {number} a1 @param {number} b0 @param {number} b1
 * @param {(i: number) => boolean} strongA may A[i] anchor?
 * @param {(j: number) => boolean} strongB
 * @param {[number, number][]} out
 * @param {number} depth
 */
function equalPairs(A, B, a0, a1, b0, b1, strongA, strongB, out, depth) {
  while (a0 < a1 && b0 < b1 && A[a0] === B[b0]) { out.push([a0, b0]); a0++; b0++; }
  /** @type {[number, number][]} */
  const tail = [];
  while (a1 > a0 && b1 > b0 && A[a1 - 1] === B[b1 - 1]) { a1--; b1--; tail.push([a1, b1]); }
  const n0 = a1 - a0;
  const n1 = b1 - b0;
  if (n0 && n1) {
    if (n0 * n1 <= MAX_CELLS) lcsPairs(A, B, a0, a1, b0, b1, out);
    else if (depth < MAX_ANCHOR_DEPTH) {
      /** text → [count in A, its index in A, count in B, its index in B] */
      const seen = new Map();
      for (let i = a0; i < a1; i++) {
        if (!strongA(i)) continue;
        const c = seen.get(A[i]);
        if (c) c[0]++; else seen.set(A[i], [1, i, 0, -1]);
      }
      for (let j = b0; j < b1; j++) {
        if (!strongB(j)) continue;
        const c = seen.get(B[j]);
        if (c) { c[2]++; c[3] = j; }
      }
      /** @type {[number, number][]} the texts once in each side, by their place in A */
      const once = [];
      for (const c of seen.values()) if (c[0] === 1 && c[2] === 1) once.push([c[1], c[3]]);
      once.sort((x, y) => x[0] - y[0]);
      const anchors = increasingRun(once);
      let pa = a0;
      let pb = b0;
      for (const [i, j] of anchors) {
        equalPairs(A, B, pa, i, pb, j, strongA, strongB, out, depth + 1);
        out.push([i, j]);
        pa = i + 1;
        pb = j + 1;
      }
      if (anchors.length) equalPairs(A, B, pa, a1, pb, b1, strongA, strongB, out, depth + 1);
    }
  }
  for (let k = tail.length - 1; k >= 0; k--) out.push(tail[k]);
}

/**
 * The exact longest common subsequence of `A[a0, a1)` and `B[b0, b1)`, appended to `out` as pairs
 * (a table of `MAX_CELLS` at most, walked back).
 */
function lcsPairs(A, B, a0, a1, b0, b1, out) {
  const n0 = a1 - a0;
  const n1 = b1 - b0;
  const w = n1 + 1;
  // (a subsequence is no longer than the shorter side: at most √MAX_CELLS = 512 — 16 bits hold it)
  const L = new Uint16Array((n0 + 1) * w);
  for (let i = n0 - 1; i >= 0; i--) {
    for (let j = n1 - 1; j >= 0; j--) {
      L[i * w + j] = A[a0 + i] === B[b0 + j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n0 && j < n1) {
    if (A[a0 + i] === B[b0 + j]) { out.push([a0 + i, b0 + j]); i++; j++; }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) i++;
    else j++;
  }
}

/**
 * The longest run of pairs increasing in both places, from pairs sorted by their first (patience
 * sorting, O(n log n)).
 * @param {[number, number][]} pairs
 * @returns {[number, number][]}
 */
function increasingRun(pairs) {
  /** @type {number[]} index of the pair ending a run of each length */
  const ends = [];
  /** @type {number[]} each pair's predecessor in its run */
  const back = new Array(pairs.length).fill(-1);
  for (let p = 0; p < pairs.length; p++) {
    const j = pairs[p][1];
    let lo = 0;
    let hi = ends.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[ends[mid]][1] < j) lo = mid + 1; else hi = mid; }
    if (lo > 0) back[p] = ends[lo - 1];
    ends[lo] = p;
  }
  /** @type {[number, number][]} */
  const out = [];
  for (let p = ends.length ? ends[ends.length - 1] : -1; p >= 0; p = back[p]) out.push(pairs[p]);
  return out.reverse();
}

/**
 * Which old text each new text continues (`out[j]`: the old index, or -1 for a new text):
 * 1. equal texts in order: the unchanged ends, then the longest common subsequence of the middle
 *    (a middle of more than `MAX_CELLS` cut first at its anchors: texts once in each side — never a
 *    blank or weak one —, recursing between them);
 * 2. moves: a new text still unpaired with an equal old text no new text continues (in order — a
 *    reordered line keeps its key);
 * 3. edits within a run (the texts left between two pairs of step 1): each new text with an old one
 *    at least `SIMILAR` alike, the most alike pairs first (ties: the earlier old, then the earlier
 *    new) — a run of more than `MAX_CELLS` candidates pairs in order instead;
 * 4. edits across runs: what is left of the new texts with what is left of the old ones at least
 *    `SIMILAR` alike, the most alike first (a line moved and edited in one edit keeps its key; at
 *    most `MAX_CELLS` candidates);
 * 5. with `blind` (the default: the editor, where an edit in place keeps its key), what is still
 *    left in a run, in order, when as many old as new texts are left there — never when `blind` is
 *    false (the generators: never two unlike texts just for standing at the same place).
 * Each old text is continued at most once.
 * @param {readonly string[]} oldTexts
 * @param {readonly string[]} newTexts
 * @param {{ blind?: boolean, anchor?: { old?: (i: number) => boolean, new?: (j: number) => boolean } }} [o]
 *   `anchor`: which texts may anchor a long list (default: a text that is not blank)
 * @returns {number[]}
 */
export function alignTexts(oldTexts, newTexts, o = {}) {
  const blind = o.blind !== false;
  const strongA = o.anchor?.old ?? ((i) => oldTexts[i].trim() !== '');
  const strongB = o.anchor?.new ?? ((j) => newTexts[j].trim() !== '');
  const out = new Array(newTexts.length).fill(-1);
  /** @type {[number, number][]} pairs (old, new) of equal texts, in order */
  const pairs = [];
  equalPairs(oldTexts, newTexts, 0, oldTexts.length, 0, newTexts.length, strongA, strongB, pairs, 0);
  for (const [i, j] of pairs) out[j] = i;
  // moves: a new text still unpaired continues an equal old text no new text continues
  const taken = new Set(pairs.map((p) => p[0]));
  /** @type {Map<string, number[]>} the old texts nobody continues, by text */
  const free = new Map();
  for (let i = 0; i < oldTexts.length; i++) {
    if (taken.has(i)) continue;
    const l = free.get(oldTexts[i]);
    if (l) l.push(i); else free.set(oldTexts[i], [i]);
  }
  for (let j = 0; j < newTexts.length; j++) {
    if (out[j] >= 0) continue;
    const l = free.get(newTexts[j]);
    if (l?.length) { out[j] = /** @type {number} */ (l.shift()); taken.add(out[j]); }
  }
  // the runs between the equal pairs: what is left there, paired as edits
  /** @type {[number, number][]} */
  const bounds = [[-1, -1], ...pairs, [oldTexts.length, newTexts.length]];
  let budget = MAX_SIMILARITY_CELLS;
  /** @type {Map<string, { w: string[], c: string[] }>} each text's tokens, made once */
  const tok = new Map();
  const tokensOf = (/** @type {string} */ s) => { let t = tok.get(s); if (!t) tok.set(s, (t = tokens(s))); return t; };
  /** @type {Map<number, number>} the similarity of (old, new) pairs already compared */
  const sims = new Map();
  /** How alike old text `i` and new text `j` are; -1 once the work budget is spent. */
  const simOf = (i, j) => {
    const at = i * (newTexts.length + 1) + j;
    const had = sims.get(at);
    if (had !== undefined) return had;
    if (budget < 0) return -1;
    const { sim, cost } = similarityOf(tokensOf(oldTexts[i]), tokensOf(newTexts[j]));
    budget -= cost;
    sims.set(at, sim);
    return sim;
  };
  const pair = (i, j) => { out[j] = i; taken.add(i); };
  /**
   * Pair the new texts `news` with the old texts `olds` (both unpaired) at least `SIMILAR` alike,
   * the most alike first. False (nothing done) for more than `MAX_CELLS` candidates.
   * @param {number[]} olds @param {number[]} news
   */
  const bestFirst = (olds, news) => {
    if (olds.length * news.length > MAX_CELLS) return false;
    /** @type {[number, number, number][]} [similarity, old, new] */
    const cand = [];
    for (const i of olds) for (const j of news) { const sim = simOf(i, j); if (sim >= SIMILAR) cand.push([sim, i, j]); }
    cand.sort((x, y) => y[0] - x[0] || x[1] - y[1] || x[2] - y[2]);
    for (const [, i, j] of cand) if (out[j] < 0 && !taken.has(i)) pair(i, j);
    return true;
  };
  /** Pair in order: each new text with the next old one at least `SIMILAR` alike (a run too long for `bestFirst`). */
  const inOrder = (olds, news) => {
    let k0 = 0;
    for (const j of news) {
      for (let k = k0; k < olds.length; k++) {
        const sim = simOf(olds[k], j);
        if (sim >= SIMILAR) { pair(olds[k], j); k0 = k + 1; break; }
        if (sim < 0) return;
      }
      if (k0 >= olds.length) return;
    }
  };
  /** @type {{ olds: number[], news: number[] }[]} the runs with texts left on both sides */
  const runs = [];
  for (let b = 0; b + 1 < bounds.length; b++) {
    const olds = [];
    const news = [];
    for (let i = bounds[b][0] + 1; i < bounds[b + 1][0]; i++) if (!taken.has(i)) olds.push(i);
    for (let j = bounds[b][1] + 1; j < bounds[b + 1][1]; j++) if (out[j] < 0) news.push(j);
    if (olds.length && news.length) runs.push({ olds, news });
  }
  // 3. edits within a run, the most alike first
  for (const r of runs) if (!bestFirst(r.olds, r.news)) inOrder(r.olds, r.news);
  // 4. edits across runs (a line moved and edited: its old place and its new one in two runs)
  {
    const olds = [];
    const news = [];
    for (let i = 0; i < oldTexts.length; i++) if (!taken.has(i)) olds.push(i);
    for (let j = 0; j < newTexts.length; j++) if (out[j] < 0) news.push(j);
    if (olds.length && news.length) bestFirst(olds, news);
  }
  // 5. blind (the editor): what is left in a run, in order, when as many old as new are left there
  if (blind) {
    for (const r of runs) {
      const olds = r.olds.filter((i) => !taken.has(i));
      const news = r.news.filter((j) => out[j] < 0);
      if (olds.length && olds.length === news.length) news.forEach((j, k) => pair(olds[k], j));
    }
  }
  return out;
}

// =================================================================================================
// One pass: the texts, the keys they keep, the keys they get
// =================================================================================================

/** A key from `key` if it is one (lower-case digits read as upper case) and not taken yet (then taken), else ''. */
function take(key, used) {
  const g = toGuid(key);
  if (!g || used.has(g)) return '';
  used.add(g);
  return g;
}

/** No keys. */
const NONE = /** @type {ReadonlySet<string>} */ (new Set());

/**
 * `mint` as a pass uses it: a new key is never one in `used` or `reserved` (it asks again with the
 * seed and `|n`; a minter that keeps giving taken keys gets keys derived from the seed) and is added
 * to `used`. (A minter may add what it gives to `used` itself — the editor's does: a key it just
 * added is free.)
 * @param {Mint} mint
 * @param {Set<string>} used
 * @param {ReadonlySet<string>} [reserved] keys a new key must not be (the previous file's, the base's)
 * @returns {Mint}
 */
function freeMint(mint, used, reserved = NONE) {
  return (seed, info) => {
    for (let n = 0; n < 16; n++) {
      const size = used.size;
      const g = toGuid(mint(n ? `${seed}|${n}` : seed, info));
      const added = !!g && used.size === size + 1 && used.has(g);
      if (g && !reserved.has(g) && (added || !used.has(g))) { used.add(g); return g; }
    }
    for (let n = 1; ; n++) {
      const g = guidOf(`${seed}|taken|${n}`);
      if (!used.has(g) && !reserved.has(g)) { used.add(g); return g; }
    }
  };
}

/** Throws unless `used` is a Set (the keys taken elsewhere: a caller must pass the level's). */
function requireUsed(used, fn) {
  if (!(used instanceof Set)) throw new TypeError(`${fn}: \`used\` (the keys the rest of the level holds) is required`);
}

/**
 * One text of a pass that takes a key (internal).
 * @typedef {object} Slot
 * @property {unknown[]} cands  the keys it may keep, in order (its own, the old text's …): the first
 *   still free is taken
 * @property {unknown[]} [late] keys it may keep when no slot keeps them in the first round (a line
 *   of a renamed script: the one line of the previous file with its text)
 * @property {boolean} parked   a script line read as no statement (a comment, an error): it keeps a
 *   key it has, never gets a new one
 * @property {string} seed      its seed for `mint`
 * @property {{ field?: string, text?: string }} info
 * @property {string} field     the field (`dialogue` for a choice too; '' a story file's)
 * @property {string} text      what it is aligned by (trimmed; a script line: its line, a comment's `#` cut)
 * @property {string} en        its English as the checks and the tables see it (trimmed; a script line:
 *   its texts joined by a line break; '' a parked line)
 * @property {string} own       the key it holds now ('' none)
 * @property {string} key       the result ('' none)
 * @property {string} [refused] (assignTextKeys) a key it held that a base text holds with other English
 */

/**
 * A slot.
 * @param {Partial<Slot>} s
 * @returns {Slot}
 */
const slot = (s) => ({ cands: [], parked: false, seed: '', info: {}, field: '', text: '', en: '', own: '', key: '', ...s });

/**
 * The keys other files of a table hold, each with its English (one or several): `key → English`.
 * A text keeps such a key only while its English is one of those (copy on write).
 * @typedef {Map<string, Iterable<string>|string>} SharedKeys
 */

/**
 * `shared` as sets of English (trimmed).
 * @param {SharedKeys|null|undefined} shared
 * @returns {Map<string, Set<string>>}
 */
function sharedSets(shared) {
  /** @type {Map<string, Set<string>>} */
  const out = new Map();
  for (const [k, v] of shared ?? []) {
    const g = toGuid(k);
    if (!g) continue;
    const s = out.get(g) ?? new Set();
    for (const t of typeof v === 'string' ? [v] : v) s.add(String(t).trim());
    out.set(g, s);
  }
  return out;
}

/**
 * Key the slots: first every slot keeps the first of its candidates still free (then of its `late`
 * ones, once every slot had its turn), then every slot left (not parked) gets a new key (never one
 * in `used` or `reserved`). A candidate `shared` holds with other English than the slot's is not
 * kept (copy on write).
 * @param {Slot[]} slots
 * @param {Mint} mint
 * @param {Set<string>} used
 * @param {ReadonlySet<string>} [reserved]
 * @param {Map<string, Set<string>>} [shared]
 */
function resolve(slots, mint, used, reserved = NONE, shared = undefined) {
  const keep = (c, s) => {
    const g = toGuid(c);
    const e = g && shared?.get(g);
    if (e && !e.has(s.en)) return '';
    return take(c, used);
  };
  for (const s of slots) for (const c of s.cands) { const k = keep(c, s); if (k) { s.key = k; break; } }
  for (const s of slots) if (!s.key && s.late) for (const c of s.late) { const k = keep(c, s); if (k) { s.key = k; break; } }
  const m = freeMint(mint, used, reserved);
  for (const s of slots) if (!s.key && !s.parked) s.key = m(s.seed, s.info);
}

// =================================================================================================
// Scripts
// =================================================================================================

/**
 * How each line of a script reads for its key (`parseScript`): the lines that hold text (with their
 * texts, trimmed: a banner's title and subtitle are two) and the parked lines (a comment, a line with
 * an error or the lines its error left out, a line over a limit: a tag there is kept for when the
 * line reads again, never minted). Every other line holds no key.
 * @param {string[]} lines the script's lines (tagged or not)
 * @returns {{ text: Map<number, string[]>, parked: Set<number> }} 1-based line numbers
 */
function lineKinds(lines) {
  const { nodes, parked } = parseScript(lines);
  /** @type {Map<number, string[]>} */
  const text = new Map();
  for (const s of scriptTextSlots(nodes)) {
    if (!s.held) continue;
    const line = s.option ? s.option.line : s.node.line;
    const l = text.get(line);
    if (l) l.push(s.text.trim()); else text.set(line, [s.text.trim()]);
  }
  // (in line order: a choice's options come before their blocks in the slots)
  return { text: new Map([...text].sort((a, b) => a[0] - b[0])), parked: new Set(parked) };
}

/**
 * The 1-based lines of a script that hold a text a player reads (StoryScript.js `holdsText`: a
 * `say`, a choice's question and each option, a `bark`, `toast`, `banner`, `quest … stage`,
 * `ending` whose text is not blank), each with its texts (trimmed; a banner's title and subtitle:
 * two).
 * @param {string[]} lines the script's lines (tagged or not)
 * @returns {Map<number, string[]>}
 */
export function scriptTextLines(lines) {
  return lineKinds(lines).text;
}

/** A script line as it is aligned with the old lines: trimmed, a comment's `#` cut (a line commented out and in again keeps its key). @param {string} t */
const alignKey = (t) => {
  const s = t.trim();
  return s.startsWith('#') ? s.replace(/^#+\s*/, '') : s;
};

/** A line's text with `key` as its tag (the text's trailing white space cut); no key: the text. */
const withTag = (text, key) => (key ? `${text.trimEnd()} ${LINE_TAG}${key}` : text);

/**
 * A script planned for its keys (internal): a slot per line that holds text or is parked — its
 * candidates its own tag, then the tag of the old line it continues (`alignTexts`; a long script
 * anchors only on lines that hold text). Null when the new value has no line.
 * @param {unknown} oldValue the script before (tagged)
 * @param {unknown} newValue the script after
 * @param {(k: number, text: string) => string} seedOf a line's seed (0-based line, trimmed text)
 * @param {string} field
 * @param {{ blind?: boolean }} [o]
 */
function planScript(oldValue, newValue, seedOf, field, o = {}) {
  const raw = scriptLines(newValue);
  if (!raw.length) return null;
  const now = raw.map(splitLineTag);
  const kinds = lineKinds(raw);
  const beforeRaw = scriptLines(oldValue);
  const before = beforeRaw.map(splitLineTag);
  /** @type {ReturnType<typeof lineKinds>|null} (read only when a long script anchors) */
  let oldKinds = null;
  const map = alignTexts(before.map((l) => alignKey(l.text)), now.map((l) => alignKey(l.text)), {
    blind: o.blind,
    anchor: { old: (i) => (oldKinds ??= lineKinds(beforeRaw)).text.has(i + 1), new: (j) => kinds.text.has(j + 1) },
  });
  /** @type {(Slot|null)[]} per line */
  const slots = now.map((l, k) => {
    const texts = kinds.text.get(k + 1);
    if (!texts && !kinds.parked.has(k + 1)) return null;
    const t = l.text.trim();
    return slot({
      cands: [l.tag, map[k] >= 0 ? before[map[k]].tag : ''], parked: !texts, seed: seedOf(k, t), info: { field, text: t },
      field, text: alignKey(l.text), en: texts ? texts.join('\n') : '', own: l.tag,
    });
  });
  return { raw, now, slots, value: newValue };
}

/**
 * The script of a plan with its slots' keys as tags: a line that holds text or is parked carries its
 * key (none: no tag), any other line loses its tag. The value's shape is kept (a string stays a
 * string — with its own line ending —, a list comes back one line per entry).
 * @param {NonNullable<ReturnType<typeof planScript>>} plan
 * @returns {unknown}
 */
function writeScript(plan) {
  const lines = plan.now.map((l, k) => {
    const s = plan.slots[k];
    if (s?.key) return withTag(l.text, s.key);
    return l.tag ? l.text : plan.raw[k];
  });
  if (typeof plan.value !== 'string') return lines;
  return lines.join(plan.value.includes('\r\n') ? '\r\n' : '\n');
}

/** The tags a script holds. @param {unknown} v @returns {string[]} */
const scriptTags = (v) => scriptLines(v).map((l) => splitLineTag(l).tag).filter(Boolean);

/**
 * A script's lines with their key tags after an edit: every line that holds text (a `say`, a
 * choice's question and options, a `bark`, `toast`, `banner`, `quest … stage`, `ending`) keeps its
 * own tag (when it still has one and it is free), else the tag of the old line it continues, else
 * gets a new one; a parked line (a comment, a line with an error, over a limit) keeps its own or
 * the old line's tag but never gets a new one; any other line loses its tag. Keeps the field's
 * shape (a string stays a string; a list comes back one line per entry).
 * @param {unknown} oldValue the script before (tagged)
 * @param {unknown} newValue the script after (tags kept, lost or never written)
 * @param {Mint} mint
 * @param {Set<string>} used the keys taken elsewhere (filled as it goes): the rest of the level's —
 *   never the script's own tags (a tag in `used` counts as taken: its line would get a new key)
 * @returns {unknown} the new value, tagged
 */
export function retagScript(oldValue, newValue, mint, used) {
  requireUsed(used, 'retagScript');
  const plan = planScript(oldValue, newValue, (k, t) => `${k}|${t}`, '');
  if (!plan) return newValue;
  resolve(/** @type {Slot[]} */ (plan.slots.filter(Boolean)), mint, used, new Set(scriptTags(oldValue)));
  return writeScript(plan);
}

/**
 * A script without its key tags (what the editor shows and compares): the same shape.
 * @param {unknown} value
 */
export function stripScriptTags(value) {
  if (typeof value === 'string') return scriptLines(value).map((l) => splitLineTag(l).text).join('\n');
  if (!Array.isArray(value)) return value;
  return value.map((e) => (typeof e === 'string' ? e.split(/\r?\n/).map((l) => splitLineTag(l).text).join('\n') : e));
}

// =================================================================================================
// Objects and a level's own texts
// =================================================================================================

/**
 * The translatable fields of an object type (`TEXT_KEY_FIELDS`), or null.
 * @param {unknown} type
 * @returns {Readonly<Record<string, string>>|null}
 */
const fieldsOf = (type) => (typeof type === 'string' && Object.prototype.hasOwnProperty.call(TEXT_KEY_FIELDS, type)
  ? TEXT_KEY_FIELDS[/** @type {keyof typeof TEXT_KEY_FIELDS} */ (type)] : null);

/**
 * The texts of one field in order (a dialogue: its pages; each choice page's choices another list).
 * @typedef {{ name: string, field: string, slots: Slot[], page?: number, units?: { i: number, text: string, slot: Slot|null }[] }} TextList
 *   `page`: a choice list's page (its raw index); `units`: a dialogue's pages, each with its raw
 *   index, its question (trimmed) and its slot (none for a blank question)
 */

/**
 * An object's texts planned for their keys (internal): a slot per text — its candidates the key of
 * the text of `src` it continues (`src` null: none; `src` the object itself: its own keys) — the
 * lists they are aligned in, and how to write the result (`write`: `textKeys` and the script tags).
 * @param {any} src the object before (or null)
 * @param {any} obj
 * @param {Readonly<Record<string, string>>} fields
 * @param {{ blind?: boolean }} [o]
 */
function planObject(src, obj, fields, o = {}) {
  const self = src === obj;
  const oldKeys = isPlain(ownOf(src, 'textKeys')) ? src.textKeys : {};
  const ownKeys = isPlain(ownOf(obj, 'textKeys')) ? obj.textKeys : {};
  const id = idText(ownOf(obj, 'id'));
  /** @type {Slot[]} */
  const slots = [];
  /** @type {TextList[]} */
  const lists = [];
  /** @type {(() => void)[]} each field's writer, in the fields' order */
  const writers = [];
  /** @type {Record<string, any>} */
  const keys = {};
  const align = (before, now) => (self ? now.map((_, k) => k) : alignTexts(before, now, { blind: o.blind }));
  for (const [field, kind] of Object.entries(fields)) {
    const value = ownOf(obj, field);
    const seedOf = (s) => `${id}.${field}|${s}`;
    if (kind === 'script') {
      if (value === undefined) continue;
      const plan = planScript(ownOf(src, field), value, (k, t) => seedOf(`${k}|${t}`), field, o);
      if (!plan) { writers.push(() => {}); continue; }
      const ss = /** @type {Slot[]} */ (plan.slots.filter(Boolean));
      slots.push(...ss);
      lists.push({ name: field, field, slots: ss });
      writers.push(() => { obj[field] = writeScript(plan); });
      continue;
    }
    if (kind === 'text') {
      const s = typeof value === 'string' ? value : '';
      if (!s.trim() || (field === 'label' && builtinLabel(s))) continue;
      const before = ownOf(src, field);
      const t = slot({
        cands: typeof before === 'string' && before.trim() ? [ownOf(oldKeys, field)] : [], seed: seedOf(s), info: { field, text: s },
        field, text: s.trim(), en: s.trim(), own: toGuid(ownOf(ownKeys, field)),
      });
      slots.push(t);
      lists.push({ name: field, field, slots: [t] });
      writers.push(() => { if (t.key) keys[field] = t.key; });
      continue;
    }
    if (kind === 'lines') {
      const now = textPages(value);
      if (!now.length) continue;
      const before = textPages(ownOf(src, field));
      const map = align(before.map((p) => p.text.trim()), now.map((p) => p.text.trim()));
      const ok = ownOf(oldKeys, field);
      const nk = ownOf(ownKeys, field);
      const ss = now.map((p, k) => slot({
        cands: map[k] >= 0 && Array.isArray(ok) ? [ok[before[map[k]].i]] : [], seed: seedOf(`${p.i}|${p.text}`), info: { field, text: p.text },
        field, text: p.text.trim(), en: p.text.trim(), own: Array.isArray(nk) ? toGuid(nk[p.i]) : '',
      }));
      slots.push(...ss);
      lists.push({ name: field, field, slots: ss });
      const len = Array.isArray(value) ? value.length : 1;
      writers.push(() => {
        /** @type {(string|null)[]} */
        const out = new Array(len).fill(null);
        now.forEach((p, k) => { out[p.i] = ss[k].key || null; });
        keys[field] = out;
      });
      continue;
    }
    // a dialogue: its pages, and each choice page's choices (aligned with the choices of the old
    // page the page continues)
    const now = dialogueUnits(value);
    if (!now.length) continue;
    const before = dialogueUnits(ownOf(src, field));
    const map = align(before.map((p) => p.text.trim()), now.map((p) => p.text.trim()));
    const ok = ownOf(oldKeys, field);
    const nk = ownOf(ownKeys, field);
    const entryAt = (l, i) => (Array.isArray(l) ? l[i] : undefined);
    const keyAt = (l, i) => { const e = entryAt(l, i); return isPlain(e) ? ownOf(e, 'key') : e; };
    const choiceAt = (l, i, j) => { const c = ownOf(entryAt(l, i), 'choices'); return Array.isArray(c) ? c[j] : undefined; };
    /** @type {Slot[]} */
    const pageSlots = [];
    /** @type {{ p: typeof now[number], page: Slot|null, choices: Slot[] }[]} */
    const pages = [];
    now.forEach((p, k) => {
      const old = map[k] >= 0 ? before[map[k]] : null;
      // (a page whose question is blank takes no key: `{ key: null, choices }`)
      const page = p.text.trim() ? slot({
        cands: old ? [keyAt(ok, old.i)] : [], seed: seedOf(`${p.i}|${p.text}`), info: { field, text: p.text },
        field, text: p.text.trim(), en: p.text.trim(), own: toGuid(keyAt(nk, p.i)),
      }) : null;
      if (page) { slots.push(page); pageSlots.push(page); }
      /** @type {Slot[]} */
      const choices = [];
      if (p.choices) {
        const oc = old?.choices ?? [];
        const cmap = self ? p.choices.map((_, m) => m) : alignTexts(oc.map((c) => c.text.trim()), p.choices.map((c) => c.text.trim()), { blind: o.blind });
        p.choices.forEach((c, m) => {
          const from = old && cmap[m] >= 0 ? oc[cmap[m]].j : -1;
          choices.push(slot({
            cands: from >= 0 ? [choiceAt(ok, old.i, from)] : [], seed: seedOf(`${p.i}.${c.j}|${c.text}`), info: { field, text: c.text },
            field, text: c.text.trim(), en: c.text.trim(), own: toGuid(choiceAt(nk, p.i, c.j)),
          }));
        });
        slots.push(...choices);
        lists.push({ name: `${field}[${p.i}]`, field, slots: choices, page: p.i });
      }
      pages.push({ p, page, choices });
    });
    lists.push({ name: field, field, slots: pageSlots, units: pages.map(({ p, page }) => ({ i: p.i, text: p.text.trim(), slot: page })) });
    const len = Array.isArray(value) ? value.length : 1;
    writers.push(() => {
      /** @type {any[]} */
      const out = new Array(len).fill(null);
      for (const { p, page, choices } of pages) {
        const key = page?.key || null;
        if (!p.choices) { out[p.i] = key; continue; }
        const raw = Array.isArray(value) ? value[p.i] : value;
        const rc = ownOf(raw, 'choices');
        /** @type {(string|null)[]} */
        const cs = new Array(Array.isArray(rc) ? rc.length : 0).fill(null);
        p.choices.forEach((c, m) => { cs[c.j] = choices[m].key || null; });
        out[p.i] = { key, choices: cs };
      }
      keys[field] = out;
    });
  }
  const write = () => {
    for (const k of Object.keys(keys)) delete keys[k];
    for (const w of writers) w();
    if (Object.keys(keys).length) obj.textKeys = { ...keys };
    else if (hasOwn(obj, 'textKeys')) delete obj.textKeys;
  };
  return { slots, lists, write };
}

/**
 * The keys an object holds (its `textKeys` and its scripts' tags).
 * @param {any} o
 * @returns {Set<string>}
 */
const objectKeys = (o) => new Set(isPlain(o) ? levelKeys({ objects: [o] }).map((k) => k.key) : []);

/**
 * An object's text keys after an edit, set on `obj` in place: `obj.textKeys` (deleted when it
 * holds nothing) and the tags of its scripts (`talk`, `run`). Each text keeps the key of the text
 * of `old` it continues while that key is free (`used`); the rest are minted (never a key in
 * `used`, nor one `old` held), in two phases — every kept key is taken before any is minted. `obj`'s
 * own keys count as the old ones' when `old` is null and `obj` has some (fill in missing keys:
 * `carryObjectText(obj, obj, mint, used)`); a script line's own tag always counts first.
 * `o.shared`: the keys other files of the level's table hold (a copy of the level — a chapter
 * variant, a Save As — with their English): an edited text whose key a copy holds with other
 * English gets a new key instead (copy on write: the copy keeps the key and its translation).
 * @param {any} old the object before the edit, or null
 * @param {any} obj the object after it (changed in place)
 * @param {Mint} mint
 * @param {Set<string>} used the keys the REST of the level holds — every other object's and the
 *   level's own texts' (filled as it goes): required, a key is used once in a level. Never the
 *   edited object's own keys (`old`'s or `obj`'s): a key in `used` counts as taken elsewhere, so
 *   each of its texts would get a new key and lose its translation
 * @param {{ shared?: SharedKeys|null }} [o]
 * @returns {any} obj
 */
export function carryObjectText(old, obj, mint, used, o = {}) {
  requireUsed(used, 'carryObjectText');
  const fields = fieldsOf(obj?.type);
  if (!fields) { if (hasOwn(obj, 'textKeys')) delete obj.textKeys; return obj; }
  // (no `old`: the object's own keys are the old ones — planned before anything of `obj` is written)
  const src = old ?? (isPlain(ownOf(obj, 'textKeys')) ? obj : null);
  const plan = planObject(src, obj, fields);
  resolve(plan.slots, mint, used, objectKeys(src), o.shared ? sharedSets(o.shared) : undefined);
  plan.write();
  return obj;
}

/**
 * A level's (or a campaign file's) own text: `subtitle`, or `title.<k>` of its `environment.title`
 * (a campaign: its `title`).
 * @param {any} o
 * @param {string} f a `LEVEL_TEXT_FIELDS` entry
 * @returns {string}
 */
function rootTextOf(o, f) {
  if (!isPlain(o)) return '';
  if (f === 'subtitle') return typeof ownOf(o, 'subtitle') === 'string' ? o.subtitle : '';
  if (!f.startsWith('title.')) return '';
  const env = ownOf(o, 'environment');
  const title = isPlain(env) ? ownOf(env, 'title') : ownOf(o, 'title');
  const v = ownOf(title, f.slice(6));
  return typeof v === 'string' ? v : '';
}

/**
 * A level's (or a campaign file's) own texts planned for their keys (internal): a slot per text,
 * its candidate the key of `prev`'s text of the field (when it had one).
 * @param {any} prev @param {any} next
 */
function planRoot(prev, next) {
  const oldKeys = isPlain(ownOf(prev, 'textKeys')) ? prev.textKeys : {};
  const ownKeys = isPlain(ownOf(next, 'textKeys')) ? next.textKeys : {};
  /** @type {Slot[]} */
  const slots = [];
  /** @type {TextList[]} */
  const lists = [];
  for (const f of LEVEL_TEXT_FIELDS) {
    const s = rootTextOf(next, f);
    if (!s.trim()) continue;
    const t = slot({
      cands: rootTextOf(prev, f).trim() ? [ownOf(oldKeys, f)] : [], seed: `level.${f}|${s}`, info: { field: f, text: s },
      field: f, text: s.trim(), en: s.trim(), own: toGuid(ownOf(ownKeys, f)),
    });
    slots.push(t);
    lists.push({ name: f, field: f, slots: [t] });
  }
  const write = () => {
    /** @type {Record<string, string>} */
    const keys = {};
    for (const t of slots) if (t.key) keys[t.field] = t.key;
    if (Object.keys(keys).length) next.textKeys = keys;
    else if (hasOwn(next, 'textKeys')) delete next.textKeys;
  };
  return { slots, lists, write };
}

/**
 * A level's (or a campaign file's) own texts' keys after an edit, set on `next.textKeys` in place:
 * `subtitle` and the title-screen overrides (`environment.title.*` of a level, `title.*` of a
 * campaign). Each keeps `prev`'s key of the field while it is free; new ones are minted. `o.shared`:
 * as `carryObjectText`'s (copy on write).
 * @param {any} prev the level / campaign before (or null)
 * @param {any} next the one after (changed in place)
 * @param {Mint} mint
 * @param {Set<string>} used the keys the REST of the level holds — its objects' (filled as it
 *   goes): required. Never the level's own texts' keys (`prev.textKeys` / `next.textKeys`): a key in
 *   `used` counts as taken elsewhere, so the text would get a new key and lose its translation
 * @param {{ shared?: SharedKeys|null }} [o]
 * @returns {any} next
 */
export function carryRootText(prev, next, mint, used, o = {}) {
  requireUsed(used, 'carryRootText');
  const plan = planRoot(prev, next);
  resolve(plan.slots, mint, used, new Set(Object.values(isPlain(ownOf(prev, 'textKeys')) ? prev.textKeys : {}).map(toGuid).filter(Boolean)), o.shared ? sharedSets(o.shared) : undefined);
  plan.write();
  return next;
}

// =================================================================================================
// A campaign file, a story file, a `.story` file
// =================================================================================================

/** A chapter's id as campaign.json's loader reads it: its own `id` (a string), else `chapter-<k + 1>`. */
const chapterIdOf = (c, k) => (typeof ownOf(c, 'id') === 'string' && c.id) || `chapter-${k + 1}`;

/**
 * Entries matched by id (a repeated id: by id and how many times it came before).
 * @template T
 * @param {[string, T][]} entries
 * @returns {Map<string, T>}
 */
function byOccurrence(entries) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  /** @type {Map<string, T>} */
  const out = new Map();
  for (const [id, e] of entries) {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    out.set(`${n}\u0000${id}`, e);
  }
  return out;
}

/** The occurrence keys of `byOccurrence`, in order. @param {string[]} ids */
function occurrenceKeys(ids) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return ids.map((id) => { const n = seen.get(id) ?? 0; seen.set(id, n + 1); return `${n}\u0000${id}`; });
}

/**
 * A campaign file's keys after a change (`raw`: the file's JSON before normalizing, changed in
 * place): its own texts and each chapter's title and subtitle (chapters matched by id — the
 * loader's id: `chapter-<n>` for one without —, a repeated id by its occurrence).
 * @param {any} prev the previous file (or null)
 * @param {any} raw
 * @param {Mint} mint
 * @param {Set<string>} [used]
 */
export function carryCampaignText(prev, raw, mint, used = new Set()) {
  const root = planRoot(prev, raw);
  /** @type {Slot[]} */
  const slots = [...root.slots];
  const prevChapters = Array.isArray(ownOf(prev, 'chapters')) ? prev.chapters : [];
  const before = byOccurrence(prevChapters.map((c, k) => [chapterIdOf(c, k), c]));
  const chapters = Array.isArray(ownOf(raw, 'chapters')) ? raw.chapters : [];
  const occ = occurrenceKeys(chapters.map((c, k) => chapterIdOf(c, k)));
  /** @type {(() => void)[]} */
  const writers = [];
  chapters.forEach((ch, k) => {
    if (!isPlain(ch)) return;
    const id = chapterIdOf(ch, k);
    const old = before.get(occ[k]) ?? null;
    const oldKeys = isPlain(ownOf(old, 'textKeys')) ? old.textKeys : {};
    /** @type {Slot[]} */
    const own = [];
    for (const f of CHAPTER_TEXT_FIELDS) {
      const s = typeof ownOf(ch, f) === 'string' ? ch[f] : '';
      if (!s.trim()) continue;
      const was = ownOf(old, f);
      own.push(slot({ cands: typeof was === 'string' && was.trim() ? [ownOf(oldKeys, f)] : [], seed: `chapter.${id}.${f}|${s}`, info: { field: f, text: s }, field: f, en: s.trim() }));
    }
    slots.push(...own);
    writers.push(() => {
      /** @type {Record<string, string>} */
      const keys = {};
      for (const t of own) if (t.key) keys[t.field] = t.key;
      if (Object.keys(keys).length) ch.textKeys = keys;
      else if (hasOwn(ch, 'textKeys')) delete ch.textKeys;
    });
  });
  resolve(slots, mint, used, new Set(isPlain(prev) ? campaignTexts(prev).map((t) => t.key).filter(Boolean) : []));
  root.write();
  for (const w of writers) w();
  return raw;
}

/**
 * The entries of a story file's section as `[id, entry]` pairs, as the loader reads them (`items`,
 * `quests`, `scripts`, `actors`: objects by id; `events`: a list, each by `eventIdOf`).
 * @param {any} raw
 * @param {string} sec
 * @returns {[string, any][]}
 */
function storySection(raw, sec) {
  const v = ownOf(raw, sec);
  if (sec === 'events') return Array.isArray(v) ? v.map((e, k) => [eventIdOf(e, k), e]) : [];
  return isPlain(v) ? Object.entries(v) : [];
}

/**
 * What a story file's texts are to the carry's second round (internal): each text with its kind
 * (`item`, `quest`, `stage`, `goal`, or `line` — a line of `scripts`, of an actor's `talk`, of an
 * event's `run`), its holder (the entry it belongs to: an item, a quest, a stage of a quest, a
 * script, an actor, an event — by id), its English (trimmed; a script line's texts joined by a line
 * break) and its key ('' none).
 * @param {any} raw the file's JSON
 * @returns {{ kind: string, holder: string, en: string, key: string }[]}
 */
function storyHeld(raw) {
  /** @type {{ kind: string, holder: string, en: string, key: string }[]} */
  const out = [];
  const add = (kind, holder, text, key) => { if (typeof text === 'string' && text.trim()) out.push({ kind, holder, en: text.trim(), key: toGuid(key) }); };
  for (const [id, item] of storySection(raw, 'items')) if (isPlain(item)) add('item', `item\u0000${id}`, item.text, ownOf(ownOf(item, 'textKeys'), 'text'));
  for (const [id, q] of storySection(raw, 'quests')) {
    if (!isPlain(q)) continue;
    const qk = isPlain(ownOf(q, 'textKeys')) ? q.textKeys : {};
    add('quest', `quest\u0000${id}`, q.text, ownOf(qk, 'text'));
    const seen = new Set();
    (Array.isArray(q.stages) ? q.stages : []).forEach((st, k) => {
      const sid = stageIdOf(st, k);
      if (sid === '__proto__' || seen.has(sid)) return;
      seen.add(sid);
      add('stage', `stage\u0000${id}\u0000${sid}`, isPlain(st) ? st.text : st, ownOf(ownOf(qk, 'stages'), sid));
    });
    const gk = ownOf(qk, 'goals');
    (Array.isArray(q.goals) ? q.goals : []).forEach((g, k) => add('goal', `quest\u0000${id}`, isPlain(g) ? g.text : '', Array.isArray(gk) ? gk[k] : undefined));
  }
  /** @param {string} holder @param {unknown} v */
  const lines = (holder, v) => {
    const all = scriptLines(v);
    for (const [n, texts] of lineKinds(all).text) add('line', holder, texts.join('\n'), splitLineTag(all[n - 1]).tag);
  };
  for (const [id, v] of storySection(raw, 'scripts')) lines(`script\u0000${id}`, v);
  for (const [sec, field] of /** @type {const} */ ([['actors', 'talk'], ['events', 'run']])) {
    for (const [id, e] of storySection(raw, sec)) if (isPlain(e) && Array.isArray(e[field])) lines(`${sec}\u0000${id}`, e[field]);
  }
  return out;
}

/**
 * A story file's keys after a change (`raw`: the file's JSON, changed in place): each item's
 * text, each quest's text, stages (by the loader's stage id: `stageIdOf`) and goals (aligned by
 * text), and the tags of its scripts (`scripts`, actors' inline `talk`, events' inline `run` — an
 * event by the loader's id, `eventIdOf`; a repeated id by its occurrence). A text matched by id
 * keeps its key first; then (a second round, only keys still free) a text whose English is the only
 * one of its kind in `prev` — an item's, a quest's, a stage's, a goal's text, a script line — takes
 * that text's key when its holder is gone or no longer holds that English (an item, a quest, a
 * stage, a script, an actor or an event renamed: its unchanged texts keep their translations).
 * @param {any} prev the previous file (or null)
 * @param {any} raw
 * @param {Mint} mint
 * @param {Set<string>} [used]
 */
export function carryStoryFile(prev, raw, mint, used = new Set()) {
  /** @type {Slot[]} */
  const slots = [];
  /** @type {(() => void)[]} */
  const writers = [];
  /** @type {Map<Slot, { kind: string, holder: string }>} each slot's kind and holder (`storyHeld`'s) */
  const heldBy = new Map();
  /** @param {string} kind @param {string} holder @param {Slot[]} ss */
  const hold = (kind, holder, ...ss) => { for (const x of ss) heldBy.set(x, { kind, holder }); };
  const prevItems = new Map(storySection(prev, 'items'));
  for (const [id, item] of storySection(raw, 'items')) {
    if (!isPlain(item)) continue;
    const s = typeof item.text === 'string' ? item.text : '';
    if (!s.trim()) { writers.push(() => { if (hasOwn(item, 'textKeys')) delete item.textKeys; }); continue; }
    const old = prevItems.get(id);
    const t = slot({ cands: isPlain(old) && typeof old.text === 'string' && old.text.trim() ? [ownOf(ownOf(old, 'textKeys'), 'text')] : [], seed: `item.${id}|${s}`, info: { text: s }, en: s.trim() });
    slots.push(t);
    hold('item', `item\u0000${id}`, t);
    writers.push(() => { item.textKeys = { text: t.key }; });
  }
  const prevQuests = new Map(storySection(prev, 'quests'));
  for (const [id, q] of storySection(raw, 'quests')) {
    if (!isPlain(q)) continue;
    const old = prevQuests.get(id);
    const ok = isPlain(ownOf(old, 'textKeys')) ? old.textKeys : {};
    /** @type {Slot|null} */
    let text = null;
    if (typeof q.text === 'string' && q.text.trim()) {
      text = slot({ cands: isPlain(old) && typeof old.text === 'string' && old.text.trim() ? [ok.text] : [], seed: `quest.${id}|${q.text}`, info: { text: q.text }, en: q.text.trim() });
      slots.push(text);
      hold('quest', `quest\u0000${id}`, text);
    }
    const oldStages = isPlain(ok.stages) ? ok.stages : {};
    /** @type {Map<string, unknown>} the old stages' texts by id (the first of a repeated id) */
    const stageTexts = new Map();
    (Array.isArray(ownOf(old, 'stages')) ? old.stages : []).forEach((s, k) => { const sid = stageIdOf(s, k); if (!stageTexts.has(sid)) stageTexts.set(sid, isPlain(s) ? s.text : s); });
    /** @type {[string, Slot][]} */
    const stages = [];
    const seen = new Set();
    (Array.isArray(q.stages) ? q.stages : []).forEach((s, k) => {
      const sid = stageIdOf(s, k);
      const t = isPlain(s) ? s.text : s;
      // (a repeated stage id: the loader keeps the first)
      if (typeof t !== 'string' || !t.trim() || sid === '__proto__' || seen.has(sid)) return;
      seen.add(sid);
      const was = stageTexts.get(sid);
      const st = slot({ cands: typeof was === 'string' && was.trim() ? [ownOf(oldStages, sid)] : [], seed: `quest.${id}.stage.${sid}|${t}`, info: { text: t }, en: t.trim() });
      slots.push(st);
      hold('stage', `stage\u0000${id}\u0000${sid}`, st);
      stages.push([sid, st]);
    });
    const goalText = (g) => (isPlain(g) && typeof g.text === 'string' ? g.text : '');
    const now = (Array.isArray(q.goals) ? q.goals : []).map(goalText);
    /** @type {(Slot|null)[]} */
    const goals = [];
    if (now.some((t) => t.trim())) {
      const was = (Array.isArray(ownOf(old, 'goals')) ? old.goals : []).map(goalText);
      const map = alignTexts(was.map((t) => t.trim()), now.map((t) => t.trim()));
      now.forEach((t, k) => {
        if (!t.trim()) { goals.push(null); return; }
        const g = slot({ cands: map[k] >= 0 && was[map[k]].trim() && Array.isArray(ok.goals) ? [ok.goals[map[k]]] : [], seed: `quest.${id}.goal.${k}|${t}`, info: { text: t }, en: t.trim() });
        slots.push(g);
        hold('goal', `quest\u0000${id}`, g);
        goals.push(g);
      });
    }
    writers.push(() => {
      /** @type {Record<string, any>} */
      const keys = {};
      if (text) keys.text = text.key;
      if (stages.length) keys.stages = Object.fromEntries(stages.map(([sid, st]) => [sid, st.key]));
      if (goals.length) keys.goals = goals.map((g) => g?.key || null);
      if (Object.keys(keys).length) q.textKeys = keys;
      else if (hasOwn(q, 'textKeys')) delete q.textKeys;
    });
  }
  const scripts = ownOf(raw, 'scripts');
  const prevScripts = ownOf(prev, 'scripts');
  for (const [id, lines] of storySection(raw, 'scripts')) {
    const plan = planScript(ownOf(prevScripts, id), lines, (k, t) => `script.${id}|${k}|${t}`, '');
    if (!plan) continue;
    const ss = /** @type {Slot[]} */ (plan.slots.filter(Boolean));
    slots.push(...ss);
    hold('line', `script\u0000${id}`, ...ss);
    writers.push(() => { scripts[id] = writeScript(plan); });
  }
  for (const [sec, field] of /** @type {const} */ ([['actors', 'talk'], ['events', 'run']])) {
    const entries = storySection(raw, sec);
    const prevBy = byOccurrence(storySection(prev, sec));
    const occ = occurrenceKeys(entries.map(([id]) => id));
    entries.forEach(([id, e], k) => {
      if (!isPlain(e) || !Array.isArray(e[field])) return;
      const old = prevBy.get(occ[k]);
      const plan = planScript(isPlain(old) ? old[field] : undefined, e[field], (n, t) => `${sec}.${id}.${field}|${n}|${t}`, '');
      if (!plan) return;
      const ss = /** @type {Slot[]} */ (plan.slots.filter(Boolean));
      slots.push(...ss);
      hold('line', `${sec}\u0000${id}`, ...ss);
      writers.push(() => { e[field] = writeScript(plan); });
    });
  }
  // the second round: the one text of its kind and English in `prev`, its holder gone or no longer
  // holding that English (a renamed item, quest, stage, script, actor or event)
  /** @type {Map<string, { key: string, holder: string }|null>} kind + English → the previous file's one text (null: several) */
  const once = new Map();
  for (const p of isPlain(prev) ? storyHeld(prev) : []) {
    const k = `${p.kind}\u0000${p.en}`;
    once.set(k, once.has(k) || !p.key ? null : { key: p.key, holder: p.holder });
  }
  if (once.size) {
    const holds = new Set([...heldBy].map(([x, h]) => `${h.holder}\u0000${h.kind}\u0000${x.en}`));
    for (const [x, h] of heldBy) {
      if (x.parked || !x.en) continue;
      const p = once.get(`${h.kind}\u0000${x.en}`);
      if (!p || (p.holder !== h.holder && holds.has(`${p.holder}\u0000${h.kind}\u0000${x.en}`))) continue;
      x.late = [...(x.late ?? []), p.key];
    }
  }
  resolve(slots, mint, used, new Set(isPlain(prev) ? fileKeys(storyFileTexts(prev), prev, 'story') : []));
  for (const w of writers) w();
  return raw;
}

/** A `.story` file's script header: `== <id>` (a header with a tag is still one: its tag is dropped). */
const HEADER = /^==\s*(\S+)\s*$/;
/** The script id of a `.story` file's header line (its tag cut first), or null. @param {string} l */
const headerOf = (l) => { const h = HEADER.exec(splitLineTag(l).text); return h ? h[1] : null; };

/**
 * A `.story` file's text with its lines tagged: each script (`== id`; a repeated id by its
 * occurrence) is retagged against the script of the same id in `prevText` (its tags carried, new
 * lines minted); a line whose script is new or renamed keeps the tag of the one line of the
 * previous file with its text (when only one line had it). Header lines are never tagged (a tag on
 * one is dropped). The file's own line ending is kept.
 * @param {string} prevText the previous file ('' for none)
 * @param {string} text the new file
 * @param {Mint} mint
 * @param {Set<string>} [used]
 * @returns {string}
 */
export function retagStoryText(prevText, text, mint, used = new Set()) {
  const src = String(text);
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const prevLines = String(prevText ?? '').split(/\r?\n/);
  const lines = src.split(/\r?\n/);
  /** @param {string[]} ls @returns {{ id: string, from: number, to: number }[]} */
  const sections = (ls) => {
    /** @type {{ id: string, from: number, to: number }[]} */
    const out = [];
    ls.forEach((l, k) => {
      const id = headerOf(l);
      if (id === null) return;
      if (out.length) out[out.length - 1].to = k;
      out.push({ id, from: k + 1, to: ls.length });
    });
    return out;
  };
  const prevSecs = sections(prevLines);
  const before = byOccurrence(prevSecs.map((s) => [s.id, prevLines.slice(s.from, s.to)]));
  // (a line of a new or renamed script: the tag of the one line of the previous file with its text)
  /** @type {Map<string, string|null>} */
  const unique = new Map();
  for (const s of prevSecs) {
    for (const l of prevLines.slice(s.from, s.to)) {
      const { text: t, tag } = splitLineTag(l);
      const k = alignKey(t);
      if (!k) continue;
      unique.set(k, unique.has(k) ? null : tag || null);
    }
  }
  const secs = sections(lines);
  const occ = occurrenceKeys(secs.map((s) => s.id));
  /** @type {Slot[]} */
  const slots = [];
  /** @type {{ s: typeof secs[number], plan: ReturnType<typeof planScript> }[]} */
  const plans = secs.map((s, k) => {
    const plan = planScript(before.get(occ[k]) ?? [], lines.slice(s.from, s.to), (n, t) => `story.${s.id}|${n}|${t}`, '');
    for (const sl of plan?.slots ?? []) {
      if (!sl) continue;
      const u = unique.get(sl.text);
      if (u) sl.late = [u];
      slots.push(sl);
    }
    return { s, plan };
  });
  resolve(slots, mint, used, new Set(prevLines.map((l) => splitLineTag(l).tag).filter(Boolean)));
  const out = lines.slice();
  for (const { s, plan } of plans) {
    out[s.from - 1] = splitLineTag(out[s.from - 1]).text;
    if (!plan) continue;
    const body = /** @type {string[]} */ (writeScript(plan));
    for (let k = 0; k < body.length; k++) out[s.from + k] = body[k];
  }
  return out.join(eol);
}

// =================================================================================================
// What a level holds, and its problems
// =================================================================================================

/**
 * Every key a level holds (objects' `textKeys`, script tags, its own `textKeys`), with where.
 * @param {any} level
 * @returns {{ key: string, where: string }[]}
 */
export function levelKeys(level) {
  /** @type {{ key: string, where: string }[]} */
  const out = [];
  const walk = (v, where) => {
    if (isGuid(v)) out.push({ key: v, where });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (isPlain(v)) for (const k of Object.keys(v)) walk(v[k], `${where}.${k}`);
  };
  for (const o of Array.isArray(level?.objects) ? level.objects : []) {
    if (!isPlain(o)) continue;
    walk(ownOf(o, 'textKeys'), `${idText(o.id)}.textKeys`);
    for (const [f, kind] of Object.entries(fieldsOf(o.type) ?? {})) {
      if (kind !== 'script') continue;
      scriptLines(ownOf(o, f)).forEach((l, k) => { const { tag } = splitLineTag(l); if (tag) out.push({ key: tag, where: `${idText(o.id)}.${f}:${k + 1}` }); });
    }
  }
  walk(ownOf(level, 'textKeys'), 'level.textKeys');
  return out;
}

/**
 * The text-key problems of a level: a text with no key (`missing`: it stays English in every
 * language), a key on no text (`stray`: an object's, or one of the level's own `textKeys` whose
 * field — `subtitle`, `title.*` — has no text), one key on two texts of the level (`repeated`: an
 * error — a key names one text). A tag on a parked script line (a comment, a line with an error)
 * is kept for when the line reads again: no problem. For the level checks (`npm run level:check`)
 * and `npm run i18n:keys`.
 * @param {any} level a normalized level
 * @returns {{ severity: 'error'|'warning', kind: 'missing'|'stray'|'repeated', where: string, msg: string }[]}
 */
export function textKeyIssues(level) {
  /** @type {{ severity: 'error'|'warning', kind: 'missing'|'stray'|'repeated', where: string, msg: string }[]} */
  const out = [];
  const add = (severity, kind, where, msg) => out.push({ severity, kind, where, msg });
  for (const o of Array.isArray(level?.objects) ? level.objects : []) {
    const fields = fieldsOf(o?.type);
    if (!fields) continue;
    const keys = isPlain(ownOf(o, 'textKeys')) ? o.textKeys : {};
    for (const [field, kind] of Object.entries(fields)) {
      const v = ownOf(o, field);
      const k = ownOf(keys, field);
      const where = `${idText(o.id)} › ${field}`;
      if (kind === 'text') {
        const s = typeof v === 'string' ? v : '';
        const needs = !!s.trim() && !(field === 'label' && builtinLabel(s));
        if (needs && !isGuid(k)) add('warning', 'missing', where, `"${short(s)}" has no text key`);
        if (!needs && k !== undefined) add('warning', 'stray', where, 'a text key on no translatable text');
      } else if (kind === 'lines') {
        const pages = textPages(v);
        const at = new Set(pages.map((p) => p.i));
        for (const p of pages) if (!isGuid(Array.isArray(k) ? k[p.i] : undefined)) add('warning', 'missing', `${where}[${p.i}]`, `"${short(p.text)}" has no text key`);
        if (Array.isArray(k)) k.forEach((x, i) => { if (x !== null && !at.has(i)) add('warning', 'stray', `${where}[${i}]`, 'a text key on a blank or missing page'); });
      } else if (kind === 'dialogue') {
        const pages = dialogueUnits(v);
        const at = new Map(pages.map((p) => [p.i, p]));
        for (const p of pages) {
          const e = Array.isArray(k) ? k[p.i] : undefined;
          const key = isPlain(e) ? e.key : e;
          // (a choice page's blank question takes no key)
          if (p.text.trim() && !isGuid(key)) add('warning', 'missing', `${where}[${p.i}]`, `"${short(p.text)}" has no text key`);
          else if (!p.text.trim() && key != null) add('warning', 'stray', `${where}[${p.i}]`, 'a text key on a blank question');
          for (const c of p.choices ?? []) {
            const ck = isPlain(e) && Array.isArray(e.choices) ? e.choices[c.j] : undefined;
            if (!isGuid(ck)) add('warning', 'missing', `${where}[${p.i}].choices[${c.j}]`, `"${short(c.text)}" has no text key`);
          }
        }
        if (Array.isArray(k)) k.forEach((x, i) => { if (x !== null && !at.has(i)) add('warning', 'stray', `${where}[${i}]`, 'a text key on a blank or missing page'); });
      } else if (kind === 'script' && v !== undefined) {
        const raw = scriptLines(v);
        const kinds = lineKinds(raw);
        raw.forEach((l, n) => {
          const { text, tag } = splitLineTag(l);
          if (kinds.text.has(n + 1)) { if (!tag) add('warning', 'missing', `${where}:${n + 1}`, `"${short(text.trim())}" has no #line: tag`); }
          else if (tag && !kinds.parked.has(n + 1)) add('warning', 'stray', `${where}:${n + 1}`, 'a #line: tag on a line with no text');
        });
      }
    }
  }
  const root = isPlain(ownOf(level, 'textKeys')) ? level.textKeys : {};
  for (const f of LEVEL_TEXT_FIELDS) {
    const s = rootTextOf(level, f);
    if (s.trim() && !isGuid(ownOf(root, f))) add('warning', 'missing', `level › ${f}`, `"${short(s)}" has no text key`);
  }
  // a key of the level's own texts whose field has no text (a blank subtitle, a title line it lacks)
  for (const f of Object.keys(root)) if (!rootTextOf(level, f).trim()) add('warning', 'stray', `level › ${f}`, 'a text key on no translatable text');
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const { key, where } of levelKeys(level)) {
    const was = seen.get(key);
    if (was) add('error', 'repeated', where, `text key ${key} is also on ${was} (a key names one text: give one of them a new key)`);
    else seen.set(key, where);
  }
  return out;
}

/** A text cut for a message. @param {string} s */
const short = (s) => (s.length > 50 ? `${s.slice(0, 47)}…` : s);

// =================================================================================================
// The generators' pass
// =================================================================================================

/**
 * One holder of a level's texts in the generators' pass (internal): an object (`type|id`) or the
 * level's own texts (`''`).
 * @typedef {{ hk: string, type: string, slots: Slot[], lists: TextList[], write: () => void }} Holder
 */

/**
 * The holders of a level's texts (objects of a type with texts, then the level's own), planned with
 * `src` the object itself (`own`: the keys it holds) or with no source.
 * @param {any} lv
 * @param {boolean} own plan each object against itself (its own keys as the slots' `own`)
 * @returns {Holder[]}
 */
function holdersOf(lv, own) {
  /** @type {Holder[]} */
  const out = [];
  if (!isPlain(lv)) return out;
  for (const o of Array.isArray(lv.objects) ? lv.objects : []) {
    if (!isPlain(o)) continue;
    const fields = fieldsOf(o.type);
    if (!fields) continue;
    const plan = planObject(own ? o : null, o, fields, { blind: false });
    out.push({ hk: `${o.type}|${idText(o.id)}`, type: String(o.type), ...plan });
  }
  const root = planRoot(own ? lv : null, lv);
  out.push({ hk: '', type: '', ...root });
  return out;
}

/** Add `text` to the set of `key` in `m`. @param {Map<string, Set<string>>} m @param {string} key @param {string} text */
const note = (m, key, text) => { const s = m.get(key); if (s) s.add(text); else m.set(key, new Set([text])); };

/**
 * The generators' pass over a level they built (normalized): every text gets its key, in this
 * order (I18N.md §4.10), over the whole level before anything is minted:
 * 1. the same object (type and id) and field in `previous` (the generator's last output), the same
 *    English — equal texts aligned in order, a moved text too;
 * 2. the same English, when only one text of that type and field had it in `previous` and its
 *    holder is gone or no longer has it (an object renamed, a text moved to another object — e.g.
 *    a sign inserted before counter-named ones);
 * 3. a chapter variant's text the base level (`base`, already assigned) has with the same English at
 *    the same object and field: the first of the base's keys there still free (they share one
 *    translation); likewise `extended` (the level a copy extends — another table: a text may
 *    diverge there);
 * 4. an edit: the same object and field in `previous`, a changed English at least `SIMILAR` alike
 *    (aligned in order; never two unlike texts just for standing at the same place) — unless the
 *    key is one `shared` (another file of the table) holds with other English: copy on write;
 * 5. a new key from `mint` (never one `previous`, `base`, `extended` or `shared` holds).
 * Objects that `previous` has come before new ones in every step. A key a base text holds with
 * other English is never kept (one key, one English: a variant's changed text gets its own —
 * listed in `split`). `previous` null: the level's own keys are the previous ones. The level's own
 * texts likewise. Changes `level` in place.
 * @param {any} level
 * @param {{ previous?: any, base?: any, extended?: any, shared?: SharedKeys|null, mint: Mint, used?: Set<string> }} o
 *   `shared`: key → the English (one or several) other files of the same table hold it with
 * @returns {{ carried: number, shared: number, minted: number, split: { key: string, was: string, text: string, where: string }[] }}
 *   `split`: texts that held a key their base holds with other English, and the key they got
 */
export function assignTextKeys(level, { previous = null, base = null, extended = null, shared = null, mint, used = new Set() }) {
  /** @type {{ carried: number, shared: number, minted: number, split: { key: string, was: string, text: string, where: string }[] }} */
  const counts = { carried: 0, shared: 0, minted: 0, split: [] };
  if (!isPlain(level)) return counts;
  // (no previous output: the level's own keys are the previous ones)
  const prevLevel = previous ?? (levelKeys(level).length ? structuredClone(level) : null);
  // the level's objects of a type with no texts hold no keys
  for (const o of Array.isArray(level.objects) ? level.objects : []) if (isPlain(o) && !fieldsOf(o.type) && hasOwn(o, 'textKeys')) delete o.textKeys;
  const now = holdersOf(level, false);
  const prev = holdersOf(prevLevel, true);
  const prevBy = new Map(prev.map((h) => [h.hk, h]));
  const baseBy = new Map(holdersOf(base, true).map((h) => [h.hk, h]));
  const extBy = new Map(holdersOf(extended, true).map((h) => [h.hk, h]));
  const nowBy = new Map(now.map((h) => [h.hk, h]));
  // (objects the previous output has first, then new ones; the level's own texts last)
  const order = [...now.filter((h) => h.hk && prevBy.has(h.hk)), ...now.filter((h) => h.hk && !prevBy.has(h.hk)), ...now.filter((h) => !h.hk)];
  /** @type {Map<string, Set<string>>} the base's English of each of its keys */
  const baseEn = new Map();
  for (const t of isPlain(base) ? levelTexts(base) : []) if (t.key) note(baseEn, t.key, t.text);
  const sharedEn = sharedSets(shared);
  const reserved = new Set([...levelKeys(prevLevel), ...levelKeys(base), ...levelKeys(extended)].map((k) => k.key));
  for (const k of sharedEn.keys()) reserved.add(k);

  /**
   * `key` if slot `s` may take it now: free, and no base text holds it with other English (`own`:
   * the key of the text it continues — refused, it is listed in `split` with the key `s` gets).
   * @param {unknown} key @param {Slot} s @param {boolean} [own]
   */
  const free = (key, s, own = false) => {
    const g = toGuid(key);
    if (!g || used.has(g)) return '';
    const b = baseEn.get(g);
    if (b && !b.has(s.en)) { if (own) s.refused ||= g; return ''; }
    return g;
  };
  const give = (s, key, how) => { used.add(key); s.key = key; counts[how]++; };

  /** @type {Map<Holder, { now: Slot, old: Slot, equal: boolean }[]>} each holder's texts paired with the previous output's */
  const pairs = new Map();
  for (const h of order) {
    const p = prevBy.get(h.hk);
    if (!p) continue;
    /** @type {{ now: Slot, old: Slot, equal: boolean }[]} */
    const out = [];
    const pl = new Map(p.lists.map((l) => [l.name, l]));
    /** @param {TextList} a the previous list @param {TextList} b */
    const pair = (a, b) => {
      const map = alignTexts(a.slots.map((s) => s.text), b.slots.map((s) => s.text), { blind: false, anchor: { old: (i) => !a.slots[i].parked, new: (j) => !b.slots[j].parked } });
      map.forEach((i, j) => { if (i >= 0) out.push({ now: b.slots[j], old: a.slots[i], equal: a.slots[i].text === b.slots[j].text }); });
    };
    for (const l of h.lists) {
      if (l.page !== undefined) continue;
      const a = pl.get(l.name);
      if (!a) continue;
      if (!l.units || !a.units) { pair(a, l); continue; }
      // a dialogue: its pages (a choice page with a blank question too — its choices follow it),
      // then the choices of each page with those of the old page it continues
      const map = alignTexts(a.units.map((u) => u.text), l.units.map((u) => u.text), { blind: false });
      map.forEach((i, j) => {
        if (i < 0) return;
        const ou = a.units[i];
        const nu = l.units[j];
        if (ou.slot && nu.slot) out.push({ now: nu.slot, old: ou.slot, equal: ou.text === nu.text });
        const nc = h.lists.find((x) => x.field === l.field && x.page === nu.i);
        const oc = p.lists.find((x) => x.field === l.field && x.page === ou.i);
        if (nc && oc) pair(oc, nc);
      });
    }
    pairs.set(h, out);
  }

  // 1. the same object and field, the same English
  for (const h of order) for (const e of pairs.get(h) ?? []) if (e.equal && !e.now.key) { const k = free(e.old.own, e.now, true); if (k) give(e.now, k, 'carried'); }
  // 2. the same English, once in the previous output for that type and field, its holder gone or no longer holding it
  /** @type {Map<string, { key: string, hk: string }|null>} */
  const once = new Map();
  for (const p of prev) {
    if (!p.hk) continue;
    for (const s of p.slots) {
      if (s.parked || !s.own || !s.en) continue;
      const k = `${p.type}|${s.field}|${s.en}`;
      once.set(k, once.has(k) ? null : { key: s.own, hk: p.hk });
    }
  }
  for (const h of order) {
    if (!h.hk) continue;
    for (const s of h.slots) {
      if (s.key || s.parked || !s.en) continue;
      const e = once.get(`${h.type}|${s.field}|${s.en}`);
      if (!e) continue;
      const holder = nowBy.get(e.hk);
      if (holder && holder !== h && holder.slots.some((x) => x.field === s.field && x.en === s.en)) continue;
      const k = free(e.key, s);
      if (k) give(s, k, 'carried');
    }
  }
  // 3. a chapter variant's unchanged text: the base's key (the first still free); a copy's: the extended level's
  for (const [by, check] of /** @type {const} */ ([[baseBy, true], [extBy, false]])) {
    for (const h of order) {
      const b = by.get(h.hk);
      if (!b) continue;
      for (const s of h.slots) {
        if (s.key || s.parked) continue;
        for (const x of b.slots) {
          if (x.field !== s.field || x.en !== s.en || !x.own) continue;
          const k = check ? free(x.own, s) : (used.has(x.own) ? '' : x.own);
          if (k) { give(s, k, 'shared'); break; }
        }
      }
    }
  }
  // 4. an edit: the same object and field, a similar English (copy on write: never a key another file holds with other English)
  for (const h of order) {
    for (const e of pairs.get(h) ?? []) {
      if (e.equal || e.now.key) continue;
      const k = free(e.old.own, e.now, true);
      if (!k) continue;
      const sh = sharedEn.get(k);
      if (sh && !sh.has(e.now.en)) continue;
      give(e.now, k, 'carried');
    }
  }
  // 5. new keys
  const m = freeMint(mint, used, reserved);
  for (const h of order) {
    for (const s of h.slots) {
      if (s.key || s.parked) continue;
      s.key = m(s.seed, s.info);
      counts.minted++;
      if (s.refused && s.refused !== s.key) counts.split.push({ key: s.key, was: s.refused, text: s.en, where: h.hk ? `${h.hk.slice(h.hk.indexOf('|') + 1)} › ${s.field}` : `level › ${s.field}` });
    }
  }
  for (const h of now) h.write();
  return counts;
}

// =================================================================================================
// Every keyed text of a file (the checks across files, `npm run i18n:keys -- --fix`)
// =================================================================================================

/**
 * One text of a file that takes a key.
 * @typedef {object} KeyedText
 * @property {string} key    its key ('' when it has none; a script line's tag)
 * @property {string} text   its English, trimmed (a script line: its texts — a banner's title and
 *   subtitle — joined by a line break)
 * @property {string} where  where it is (`elder › dialogue[2]`, `level › subtitle`,
 *   `script wren:9`, `chapter the-flood › title`)
 * @property {string} field  the list it is one of — `where` without its place (`elder › dialogue`,
 *   `level › subtitle`, `script wren`, `quest find-ilse › stages`): `npm run i18n:keys -- --fix`
 *   swaps two keys back between texts of one field
 * @property {(key: string) => void} set  gives it another key, in place (the holder's `textKeys`
 *   made as needed; a script line retagged)
 */

/** The `textKeys` map of a holder, made when it has none (a fresh one replaces a malformed one). @param {any} o */
function keysHolder(o) {
  if (!isPlain(ownOf(o, 'textKeys'))) o.textKeys = {};
  return o.textKeys;
}

/**
 * A list of `textKeys` parallel to a raw list of `len` entries (made, or grown with nulls).
 * @param {Record<string, any>} keys
 * @param {string} field
 * @param {number} len
 * @returns {any[]}
 */
function keyList(keys, field, len) {
  let l = ownOf(keys, field);
  if (!Array.isArray(l)) { l = []; keys[field] = l; }
  while (l.length < len) l.push(null);
  return l;
}

/**
 * The keyed texts of a script field (its lines that hold text), each retagged in place by `set`.
 * @param {any} holder the object (or story section) holding the field
 * @param {string} field
 * @param {string} where
 * @param {KeyedText[]} out
 */
function scriptTexts(holder, field, where, out) {
  const raw = scriptLines(holder[field]);
  if (!raw.length) return;
  const lines = raw.map(splitLineTag);
  for (const [n, texts] of lineKinds(raw).text) {
    out.push({
      key: lines[n - 1].tag, text: texts.join('\n'), where: `${where}:${n}`, field: where,
      set: (key) => {
        const now = scriptLines(holder[field]);
        const l = splitLineTag(now[n - 1]);
        now[n - 1] = withTag(l.tag ? l.text : now[n - 1], toGuid(key));
        holder[field] = typeof holder[field] === 'string' ? now.join(holder[field].includes('\r\n') ? '\r\n' : '\n') : now;
      },
    });
  }
}

/**
 * Every text of a level that takes a key — each object's translatable fields (a built-in verb's
 * label takes none, nor a choice page's blank question), the lines of its scripts that hold text and
 * the level's own texts — with its key and English.
 * @param {any} level a level (normalized, or as read)
 * @returns {KeyedText[]}
 */
export function levelTexts(level) {
  /** @type {KeyedText[]} */
  const out = [];
  for (const o of Array.isArray(level?.objects) ? level.objects : []) {
    const fields = fieldsOf(o?.type);
    if (!fields) continue;
    const id = idText(ownOf(o, 'id'));
    const keysOf = () => (isPlain(ownOf(o, 'textKeys')) ? o.textKeys : {});
    for (const [field, kind] of Object.entries(fields)) {
      const v = ownOf(o, field);
      const where = `${id} › ${field}`;
      if (kind === 'text') {
        const s = typeof v === 'string' ? v.trim() : '';
        if (!s || (field === 'label' && builtinLabel(s))) continue;
        const k = ownOf(keysOf(), field);
        out.push({ key: isGuid(k) ? k : '', text: s, where, field: where, set: (key) => { keysHolder(o)[field] = key; } });
      } else if (kind === 'lines') {
        const len = Array.isArray(v) ? v.length : 1;
        for (const p of textPages(v)) {
          const l = ownOf(keysOf(), field);
          const k = Array.isArray(l) ? l[p.i] : undefined;
          out.push({ key: isGuid(k) ? k : '', text: p.text.trim(), where: `${where}[${p.i}]`, field: where, set: (key) => { keyList(keysHolder(o), field, len)[p.i] = key; } });
        }
      } else if (kind === 'dialogue') {
        const len = Array.isArray(v) ? v.length : 1;
        const raw = (i) => (Array.isArray(v) ? v[i] : v);
        const entry = (i) => { const l = ownOf(keysOf(), field); return Array.isArray(l) ? l[i] : undefined; };
        /** the page's entry as `{ key, choices }` (a choice page's), made as needed */
        const pageObj = (i) => {
          const l = keyList(keysHolder(o), field, len);
          if (!isPlain(l[i])) l[i] = { key: isGuid(l[i]) ? l[i] : null, choices: [] };
          const cs = ownOf(raw(i), 'choices');
          const n = Array.isArray(cs) ? cs.length : 0;
          if (!Array.isArray(l[i].choices)) l[i].choices = [];
          while (l[i].choices.length < n) l[i].choices.push(null);
          return l[i];
        };
        for (const p of dialogueUnits(v)) {
          const e = entry(p.i);
          const k = isPlain(e) ? ownOf(e, 'key') : e;
          if (p.text.trim()) {
            out.push({
              key: isGuid(k) ? k : '', text: p.text.trim(), where: `${where}[${p.i}]`, field: where,
              set: (key) => { if (p.choices) pageObj(p.i).key = key; else keyList(keysHolder(o), field, len)[p.i] = key; },
            });
          }
          for (const c of p.choices ?? []) {
            const cs = ownOf(entry(p.i), 'choices');
            const ck = Array.isArray(cs) ? cs[c.j] : undefined;
            out.push({ key: isGuid(ck) ? ck : '', text: c.text.trim(), where: `${where}[${p.i}].choices[${c.j}]`, field: where, set: (key) => { pageObj(p.i).choices[c.j] = key; } });
          }
        }
      } else if (kind === 'script' && v !== undefined) scriptTexts(o, field, where, out);
    }
  }
  rootTexts(level, 'level', out);
  return out;
}

/**
 * A level's or a campaign file's own texts (`subtitle`, `title.*`).
 * @param {any} root
 * @param {string} name `level` or `campaign`
 * @param {KeyedText[]} out
 */
function rootTexts(root, name, out) {
  if (!isPlain(root)) return;
  for (const f of LEVEL_TEXT_FIELDS) {
    const s = rootTextOf(root, f).trim();
    if (!s) continue;
    const k = ownOf(ownOf(root, 'textKeys'), f);
    out.push({ key: isGuid(k) ? k : '', text: s, where: `${name} › ${f}`, field: `${name} › ${f}`, set: (key) => { keysHolder(root)[f] = key; } });
  }
}

/**
 * Every text of a campaign file (`campaign.json`, as read or normalized) that takes a key: its own
 * texts and each chapter's title and subtitle (a chapter named by the loader's id).
 * @param {any} raw
 * @returns {KeyedText[]}
 */
export function campaignTexts(raw) {
  /** @type {KeyedText[]} */
  const out = [];
  rootTexts(raw, 'campaign', out);
  (Array.isArray(ownOf(raw, 'chapters')) ? raw.chapters : []).forEach((ch, n) => {
    if (!isPlain(ch)) return;
    for (const f of CHAPTER_TEXT_FIELDS) {
      const s = typeof ownOf(ch, f) === 'string' ? ch[f].trim() : '';
      if (!s) continue;
      const k = ownOf(ownOf(ch, 'textKeys'), f);
      out.push({ key: isGuid(k) ? k : '', text: s, where: `chapter ${chapterIdOf(ch, n)} › ${f}`, field: `chapter ${chapterIdOf(ch, n)} › ${f}`, set: (key) => { keysHolder(ch)[f] = key; } });
    }
  });
  return out;
}

/**
 * Every text of a story file (`story/<name>.json`, as read) that takes a key: each item's text,
 * each quest's text, stages (by the loader's stage id) and goals, and the lines of its scripts
 * (`scripts`, actors' inline `talk`, events' inline `run`) that hold text.
 * @param {any} raw
 * @returns {KeyedText[]}
 */
export function storyFileTexts(raw) {
  /** @type {KeyedText[]} */
  const out = [];
  for (const [id, item] of storySection(raw, 'items')) {
    const s = isPlain(item) && typeof item.text === 'string' ? item.text.trim() : '';
    if (!s) continue;
    const k = ownOf(ownOf(item, 'textKeys'), 'text');
    out.push({ key: isGuid(k) ? k : '', text: s, where: `item ${id} › text`, field: `item ${id} › text`, set: (key) => { keysHolder(item).text = key; } });
  }
  for (const [id, q] of storySection(raw, 'quests')) {
    if (!isPlain(q)) continue;
    const qk = () => (isPlain(ownOf(q, 'textKeys')) ? q.textKeys : {});
    if (typeof q.text === 'string' && q.text.trim()) {
      const k = ownOf(qk(), 'text');
      out.push({ key: isGuid(k) ? k : '', text: q.text.trim(), where: `quest ${id} › text`, field: `quest ${id} › text`, set: (key) => { keysHolder(q).text = key; } });
    }
    const seen = new Set();
    (Array.isArray(q.stages) ? q.stages : []).forEach((st, k) => {
      const sid = stageIdOf(st, k);
      const t = isPlain(st) ? st.text : st;
      if (typeof t !== 'string' || !t.trim() || sid === '__proto__' || seen.has(sid)) return;
      seen.add(sid);
      const g = ownOf(ownOf(qk(), 'stages'), sid);
      out.push({
        key: isGuid(g) ? g : '', text: t.trim(), where: `quest ${id} › stage ${sid}`, field: `quest ${id} › stages`,
        set: (key) => { const h = keysHolder(q); if (!isPlain(ownOf(h, 'stages'))) h.stages = {}; h.stages[sid] = key; },
      });
    });
    const goals = Array.isArray(q.goals) ? q.goals : [];
    goals.forEach((gl, k) => {
      const t = isPlain(gl) && typeof gl.text === 'string' ? gl.text.trim() : '';
      if (!t) return;
      const l = ownOf(qk(), 'goals');
      const g = Array.isArray(l) ? l[k] : undefined;
      out.push({ key: isGuid(g) ? g : '', text: t, where: `quest ${id} › goal[${k}]`, field: `quest ${id} › goals`, set: (key) => { keyList(keysHolder(q), 'goals', goals.length)[k] = key; } });
    });
  }
  const scripts = ownOf(raw, 'scripts');
  for (const [id] of storySection(raw, 'scripts')) scriptTexts(scripts, id, `script ${id}`, out);
  for (const [sec, field] of /** @type {const} */ ([['actors', 'talk'], ['events', 'run']])) {
    for (const [id, e] of storySection(raw, sec)) {
      if (isPlain(e) && Array.isArray(e[field])) scriptTexts(e, field, `${sec === 'actors' ? 'actor' : 'event'} ${id} › ${field}`, out);
    }
  }
  return out;
}

/**
 * Every key a file holds that a new key must not be: its texts' keys and its scripts' other tags.
 * @param {KeyedText[]} texts
 * @param {any} raw
 * @param {'story'} kind
 * @returns {string[]}
 */
function fileKeys(texts, raw, kind) {
  const out = texts.map((t) => t.key).filter(Boolean);
  if (kind === 'story') {
    for (const [, v] of storySection(raw, 'scripts')) out.push(...scriptTags(v));
    for (const [sec, field] of /** @type {const} */ ([['actors', 'talk'], ['events', 'run']])) for (const [, e] of storySection(raw, sec)) if (isPlain(e)) out.push(...scriptTags(e[field]));
  }
  return out;
}

/**
 * The scripts of a `.story` file's lines: each `== id` header's body, lines [from, to) — headers as
 * the loader reads them (a tagged header is none: its line joins the script before).
 * @param {string[]} lines
 * @returns {{ id: string, from: number, to: number }[]}
 */
function storySections(lines) {
  /** @type {{ id: string, from: number, to: number }[]} */
  const out = [];
  for (let k = 0; k < lines.length; k++) {
    const h = HEADER.exec(lines[k]);
    if (!h) continue;
    if (out.length) out[out.length - 1].to = k;
    out.push({ id: h[1], from: k + 1, to: lines.length });
  }
  return out;
}

/**
 * Every text of a `.story` file that takes a key: the lines of each script (`== id` sections; a
 * header is never tagged) that hold text. `set` retags a line of `lines` in place.
 * @param {string[]} lines the file's lines (changed in place by `set`)
 * @returns {KeyedText[]}
 */
export function storyTextTexts(lines) {
  /** @type {KeyedText[]} */
  const out = [];
  for (const { id, from, to } of storySections(lines)) {
    const body = lines.slice(from, to);
    const tagged = body.map(splitLineTag);
    for (const [n, texts] of lineKinds(body).text) {
      const at = from + n - 1;
      out.push({
        key: tagged[n - 1].tag, text: texts.join('\n'), where: `line ${at + 1} (${id})`, field: `script ${id}`,
        set: (key) => { const l = splitLineTag(lines[at]); lines[at] = withTag(l.tag ? l.text : lines[at], toGuid(key)); },
      });
    }
  }
  return out;
}

/**
 * The text-key problems of a campaign file, a story file or a `.story` file, as `textKeyIssues`
 * lists a level's: a text with no key (`missing`), a key or tag on no text (`stray`; a tag on a
 * parked script line — a comment, a line with an error — is none; a tag on a `== id` header is one:
 * the line is then no header), one key on two texts of the file (`repeated`, an error).
 * @param {'campaign'|'story'|'storyText'} kind
 * @param {any} file the campaign's or story file's JSON (as read), or the `.story` file's text
 * @returns {{ severity: 'error'|'warning', kind: 'missing'|'stray'|'repeated', where: string, msg: string }[]}
 */
export function fileKeyIssues(kind, file) {
  /** @type {{ severity: 'error'|'warning', kind: 'missing'|'stray'|'repeated', where: string, msg: string }[]} */
  const out = [];
  const lines = kind === 'storyText' ? String(file).split(/\r?\n/) : [];
  const texts = kind === 'campaign' ? campaignTexts(file) : kind === 'story' ? storyFileTexts(file) : storyTextTexts(lines);
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const t of texts) {
    if (!t.key) { out.push({ severity: 'warning', kind: 'missing', where: t.where, msg: `"${short(t.text.split('\n')[0])}" has no text key` }); continue; }
    const was = seen.get(t.key);
    if (was) out.push({ severity: 'error', kind: 'repeated', where: t.where, msg: `text key ${t.key} is also on ${was} (a key names one text: give one of them a new key)` });
    else seen.set(t.key, t.where);
  }
  // keys on no text: a script's tags on lines without text; a `textKeys` entry beside a blank text
  const strayAt = (where, msg = 'a text key on no translatable text') => out.push({ severity: 'warning', kind: 'stray', where, msg });
  /** @param {unknown} v @param {string} where @param {(n: number) => string} [at] */
  const scriptStray = (v, where, at = (n) => `${where}:${n}`) => {
    const raw = scriptLines(v);
    const kinds = lineKinds(raw);
    raw.forEach((l, n) => {
      if (!splitLineTag(l).tag || kinds.text.has(n + 1) || kinds.parked.has(n + 1)) return;
      strayAt(at(n + 1), 'a #line: tag on a line with no text');
    });
  };
  if (kind === 'campaign') {
    for (const f of Object.keys(isPlain(ownOf(file, 'textKeys')) ? file.textKeys : {})) if (!rootTextOf(file, f).trim()) strayAt(`campaign › ${f}`);
    (Array.isArray(ownOf(file, 'chapters')) ? file.chapters : []).forEach((ch, n) => {
      for (const f of Object.keys(isPlain(ownOf(ch, 'textKeys')) ? ch.textKeys : {})) if (!(typeof ownOf(ch, f) === 'string' && ch[f].trim())) strayAt(`chapter ${chapterIdOf(ch, n)} › ${f}`);
    });
  } else if (kind === 'story') {
    for (const [id, item] of storySection(file, 'items')) {
      if (isPlain(item) && ownOf(item, 'textKeys') !== undefined && !(typeof item.text === 'string' && item.text.trim())) strayAt(`item ${id} › text`);
    }
    for (const [id, q] of storySection(file, 'quests')) {
      const qk = ownOf(q, 'textKeys');
      if (!isPlain(qk)) continue;
      if (ownOf(qk, 'text') !== undefined && !(typeof q.text === 'string' && q.text.trim())) strayAt(`quest ${id} › text`);
      const stages = new Set((Array.isArray(q.stages) ? q.stages : []).map((st, k) => {
        const t = isPlain(st) ? st.text : st;
        return typeof t === 'string' && t.trim() ? stageIdOf(st, k) : '';
      }));
      const qs = ownOf(qk, 'stages');
      for (const sid of Object.keys(isPlain(qs) ? qs : {})) if (!stages.has(sid)) strayAt(`quest ${id} › stage ${sid}`);
      const goals = Array.isArray(q.goals) ? q.goals : [];
      const qg = ownOf(qk, 'goals');
      (Array.isArray(qg) ? qg : []).forEach((g, k) => { if (g !== null && !(isPlain(goals[k]) && typeof goals[k].text === 'string' && goals[k].text.trim())) strayAt(`quest ${id} › goal[${k}]`); });
    }
    for (const [id, v] of storySection(file, 'scripts')) scriptStray(v, `script ${id}`);
    for (const [sec, field] of /** @type {const} */ ([['actors', 'talk'], ['events', 'run']])) {
      for (const [id, e] of storySection(file, sec)) if (isPlain(e) && Array.isArray(e[field])) scriptStray(e[field], `${sec === 'actors' ? 'actor' : 'event'} ${id} › ${field}`);
    }
  } else {
    const secs = storySections(lines);
    const first = secs.length ? secs[0].from - 1 : lines.length;
    for (let k = 0; k < first; k++) if (splitLineTag(lines[k]).tag) strayAt(`line ${k + 1}`, headerOf(lines[k]) !== null ? 'a #line: tag on a "== id" header: the line is no header then (its script joins the one before) — remove the tag' : 'a #line: tag before the first script');
    for (const { id, from, to } of secs) {
      for (let k = from; k < to; k++) if (headerOf(lines[k]) !== null) strayAt(`line ${k + 1} (${id})`, 'a #line: tag on a "== id" header: the line is no header then (its script joins the one before) — remove the tag');
      scriptStray(lines.slice(from, to).map((l) => (headerOf(l) !== null ? '' : l)), id, (n) => `line ${from + n} (${id})`);
    }
  }
  return out;
}
