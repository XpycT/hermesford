/**
 * Story states for the checks (docs/specs/CAMPAIGN_FORMAT.md §9): what the `when` / `unless` of a
 * level's objects test, which outcomes of those tests can happen together, and which objects are
 * there in each combination. `storyExclusive` (Travel.js) asks it whether two objects can ever be
 * there together (`canHoldTogether`); `tools/lib/levelcheck.mjs` checks a level once per story
 * state (`storyStates`).
 *
 * A condition is read as a function of its **tests**: a flag or value standing alone
 * (`bridge-mended`, `item:plank`) or a comparison (`item:plank >= 3`, `quest:find-ilse = done`).
 * One test stands for its opposite too: `x != v` is `not (x = v)`; against a number — or a word,
 * which the game turns into one (`stage:find-ilse < bridge-fixed`, `planks < needed`) — `x < v` is
 * `not (x >= v)` and `x > v` is `not (x <= v)`; a value compared with 0 by `=` / `!=` is that value
 * standing alone, and so is a count compared with 1 (`item:plank >= 1`, `visited:mill = 1`).
 *
 * Tests of one value constrain each other (`hour >= 20` and `hour < 6` cannot both hold): a
 * combination is possible when one value passes them all. The party's size and its members are
 * read together: `party:<who>` (a name in any case) holds for no more members than `party` counts,
 * at most `MAX_PARTY` (`party:sela` and `party = 0` cannot both hold; two names are two members).
 * The values one story can give (`valueRange`): `visited:` and `done:` 0 or 1; items, visits,
 * stage numbers, gold and the day (from 1) whole numbers; the hour any number from 0 to 24; flags
 * and variables any number (`var x = 1.5`; a flag is a variable that `set` makes 1); quests one of
 * their four states; the chapter, the level and the weather words. Tried are the numbers the tests name and the values between and
 * beyond them in that range; the words they name. A test against a word that stands for a number
 * (`gold >= inn.price`) is free against the other tests of its value. So "can never hold together"
 * is exact for flags, numbers and words, and never claimed when it is not so.
 *
 * Tests are **grouped**: two tests that one object's condition makes, or that read one value, are
 * in one group (union-find); the groups are independent of each other. A group's combinations are
 * all tried (up to `maxTests` tests in it), and the story states are the combinations of what the
 * groups have there — all of them up to `maxStates` (64 for six objects with flags of their own,
 * whatever each flag's conditions); past that a sample, and the checks say so.
 *
 * Node-safe (no DOM, no three.js); imports only the small condition module and the seeded RNG.
 */
import { cachedCondition, isTextRef, QUEST_STATES } from './StoryCondition.js';
import { mulberry32 } from '../utils/math.js';

/**
 * @import { Cond, Ref } from './StoryCondition.js'
 * @import { LevelObject } from './types.js'
 */

/**
 * One test a condition makes, in its canonical form.
 * @typedef {object} StoryTest
 * @property {string} key    identity (`:bridge-mended`, `item:plank >= 3`)
 * @property {string} label  as written in a condition (`bridge-mended`, `item:plank >= 3`)
 * @property {string} notLabel  its opposite (`not bridge-mended`, `item:plank < 3`)
 * @property {boolean} bare  a flag or value standing alone (`bridge-mended`): "with" / "without" it
 * @property {Ref} ref
 * @property {''|'='|'<='|'>='} cmp  '' the value standing alone
 * @property {number|string|null} value  what it is compared with
 * @property {((v: number|string) => boolean)|null} test  does a value pass it (null: a word for a
 *   number on the right — free)
 */

/**
 * A group of tests that depend on each other (one object's condition makes them, or they read one
 * value), with the objects whose conditions make them and what those objects can be.
 * @typedef {object} StoryGroup
 * @property {number[]} tests  indices into `tests`, ascending
 * @property {LevelObject[]} objects  the objects whose conditions make these tests
 * @property {{ present: LevelObject[], combos: Uint8Array[] }[]} patterns  what of `objects` is
 *   there together, in order of the first combination found; `combos`: the combinations of the
 *   group's tests that give it (bit j: test `tests[j]` passes)
 * @property {boolean} exhaustive  every combination of the group's tests was tried
 */

/** A story field as trimmed text ('' for anything else). */
const text = (v) => (typeof v === 'string' ? v.trim() : '');
/**
 * The most members a party has: PartyRules.js `MAX_PARTY` — not imported, since Travel.js imports
 * this module and every level loads Travel.js (the party's vocabulary stays out of what game.html
 * preloads); `npm run story:test` checks that the two agree.
 */
const MAX_PARTY = 3;
/** A value standing alone holds (as `evalCondition` reads it). */
const truthy = (v) => (typeof v === 'number' ? v !== 0 : v !== '' && v !== 'none' && v != null);
/** A reference as written. @param {Ref} r */
const refName = (r) => (r.kind === '' || r.kind === 'game' ? r.name : `${r.kind}:${r.name}`);
/**
 * A reference's identity: kind and name — a party member's name in lower case, as the game finds
 * members (`party:Sela` is `party:sela`). @param {Ref} r
 */
const refKey = (r) => `${r.kind}:${r.kind === 'party' ? r.name.toLowerCase() : r.name}`;
/** The most `party:<who>` names whose combinations with the party's size are worked out (more: free of it). */
const MAX_MEMBER_NAMES = 24;
/** A comparison read the other way round. */
const FLIP = { '=': '!=', '!=': '=', '<': '>=', '>=': '<', '>': '<=', '<=': '>' };

/** a `cmp` b, for numbers. */
function compare(a, cmp, b) {
  switch (cmp) {
    case '=': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    default: return false;
  }
}

/**
 * The numbers one story can give a reference that is a number (StoryState.js `storyReader`):
 * whole or any, from `min` to `max`. `visited:` / `done:` / `party:` are 0 or 1; items, visits and
 * stage numbers (0: no stage yet) whole numbers from 0, gold too, the day from 1; the party 0 to
 * `MAX_PARTY` members; the hour 0 to 24; flags and variables any number (`var x = 1.5`,
 * `var x - 4`; story files declare any start value).
 * @param {Ref} ref
 * @returns {{ int: boolean, min: number, max: number }}
 */
export function valueRange(ref) {
  switch (ref.kind) {
    case 'visited': case 'done': case 'party': return { int: true, min: 0, max: 1 };
    case 'item': case 'visits': case 'stage': return { int: true, min: 0, max: Infinity };
    case 'game':
      if (ref.name === 'day') return { int: true, min: 1, max: Infinity };
      if (ref.name === 'gold' || ref.name === 'visits') return { int: true, min: 0, max: Infinity };
      if (ref.name === 'party') return { int: true, min: 0, max: MAX_PARTY };
      if (ref.name === 'hour') return { int: false, min: 0, max: 24 };
      return { int: false, min: -Infinity, max: Infinity };
    default: return { int: false, min: -Infinity, max: Infinity };
  }
}

/**
 * The condition under which an object is there: its `when` and not its `unless` (the flag rule of
 * `cachedCondition`, as `storyAllows` reads them); null when it has neither (always there).
 * @param {LevelObject} o
 * @returns {Cond|null}
 */
export function presenceCondition(o) {
  const when = text(o?.when);
  const unless = text(o?.unless);
  if (!when && !unless) return null;
  /** @type {Cond} */
  const u = { op: 'not', a: cachedCondition(unless) };
  if (!unless) return cachedCondition(when);
  return when ? { op: 'and', a: cachedCondition(when), b: u } : u;
}

/**
 * The test a leaf of a condition (`ref` / `cmp`) makes, and whether the leaf is its opposite.
 * @param {Cond} c a `ref` or `cmp` node
 * @returns {{ test: StoryTest, neg: boolean }}
 */
function leafTest(c) {
  if (c.op !== 'ref' && c.op !== 'cmp') throw new Error(`not a test: ${c.op}`);
  const ref = c.ref;
  const base = refKey(ref);
  /** @param {boolean} neg @returns {{ test: StoryTest, neg: boolean }} */
  const bare = (neg) => ({ neg, test: { key: base, label: refName(ref), notLabel: `not ${refName(ref)}`, bare: true, ref, cmp: '', value: null, test: truthy } });
  if (c.op === 'ref') return bare(false);
  /** @type {any} ('=' / '<=' / '>=' once read the canonical way round) */
  let cmp = c.cmp;
  const value = c.value;
  const numeric = typeof value === 'number';
  const textRef = isTextRef(ref);
  if (numeric && !textRef) {
    // a value compared with 0 is the value standing alone
    if (value === 0 && (cmp === '=' || cmp === '!=')) return bare(cmp === '=');
    // … and a count (a whole number from 0) compared with 1: `item:plank >= 1`, `visited:mill = 1`
    const r = valueRange(ref);
    if (r.int && r.min === 0) {
      if ((cmp === '>=' && value === 1) || (cmp === '>' && value === 0)) return bare(false);
      if ((cmp === '<' && value === 1) || (cmp === '<=' && value === 0)) return bare(true);
      if (r.max === 1 && value === 1 && (cmp === '=' || cmp === '!=')) return bare(cmp === '!=');
    }
  }
  let neg = false;
  // (a word on the right stands for a number too — a stage, a variable: `<` is `not >=` all the same)
  if (cmp === '!=' || (!textRef && (cmp === '<' || cmp === '>'))) { cmp = FLIP[cmp]; neg = true; }
  const shown = String(value);
  /** @type {StoryTest['test']} */
  let test = null;
  if (numeric) test = (v) => typeof v === 'number' && compare(v, cmp, value);
  else if (textRef && cmp === '=') test = (v) => String(v) === value;
  return {
    neg,
    test: { key: `${base} ${cmp} ${numeric ? shown : JSON.stringify(value)}`, label: `${refName(ref)} ${cmp} ${shown}`, notLabel: `${refName(ref)} ${FLIP[cmp]} ${shown}`, bare: false, ref, cmp, value, test },
  };
}

/**
 * The values worth trying for a reference, given its tests: for a word value the words they name
 * (a quest: its four states) and two others; for a number the numbers they name, 0, the ends of
 * its range and the values between and beyond them that it can take (`valueRange`).
 * @param {Ref} ref
 * @param {StoryTest[]} list its tests
 * @returns {(number|string)[]}
 */
function refValues(ref, list) {
  if (isTextRef(ref)) {
    const words = list.map((t) => t.value).filter((w) => typeof w === 'string');
    return ref.kind === 'quest' ? [...QUEST_STATES, ...words] : ['', '\u0000another', ...words];
  }
  const r = valueRange(ref);
  const nums = list.map((t) => t.value).filter((v) => typeof v === 'number');
  const pts = [...new Set([0, ...nums, ...[r.min, r.max].filter(Number.isFinite)])].sort((a, b) => a - b);
  const out = new Set();
  if (r.int) {
    // each named number, the whole number below it and the one above it
    for (const n of pts) for (const v of [Math.floor(n) - 1, Math.floor(n), Math.ceil(n), Math.ceil(n) + 1]) out.add(v);
  } else {
    for (const n of pts) out.add(n);
    out.add(pts[0] - 1);
    out.add(pts[pts.length - 1] + 1);
    for (let k = 0; k + 1 < pts.length; k++) out.add((pts[k] + pts[k + 1]) / 2);
  }
  return [...out].filter((v) => v >= r.min && v <= r.max && (!r.int || Number.isInteger(v)));
}

/**
 * The tests a set of conditions makes, and the questions about a combination of their outcomes
 * (`bits[i]`: test i passes): does a condition hold, and can the combination happen at all (in one
 * group: `possible(bits, g)` looks at that group's tests only)? `groups`: the tests that depend on
 * each other — one condition makes them, or they read one value (union-find) —, each ascending, in
 * order of their first test; `condGroup[k]`: the group of condition k's tests (-1: it makes none).
 * @param {(Cond|null)[]} conds
 * @returns {{ tests: StoryTest[], groups: number[][], condGroup: number[],
 *   holds: (c: Cond|null, bits: ArrayLike<number>) => boolean,
 *   possible: (bits: ArrayLike<number>, g?: number) => boolean }}
 */
export function conditionSpace(conds) {
  /** @type {StoryTest[]} */
  const tests = [];
  /** @type {Map<string, number>} */
  const index = new Map();
  /** @param {Cond|null} c @param {Set<number>} into */
  const collect = (c, into) => {
    if (!c || c.op === 'const') return;
    if (c.op === 'not') collect(c.a, into);
    else if (c.op === 'and' || c.op === 'or') { collect(c.a, into); collect(c.b, into); }
    else {
      const { test } = leafTest(c);
      let i = index.get(test.key);
      if (i === undefined) { i = tests.length; index.set(test.key, i); tests.push(test); }
      into.add(i);
    }
  };
  const condTests = conds.map((c) => { const s = new Set(); collect(c, s); return [...s]; });

  // the values that matter, per reference: which outcome patterns of its tests can happen together
  /** @type {Map<string, number[]>} reference → its testable tests */
  const byRef = new Map();
  tests.forEach((t, i) => {
    if (!t.test) return;
    const k = refKey(t.ref);
    byRef.set(k, [...(byRef.get(k) ?? []), i]);
  });
  /** @type {{ idx: number[], patterns: Set<string> }[]} */
  const refGroups = [];
  const party = partyPatterns(tests, byRef);
  if (party) refGroups.push(party);
  for (const idx of byRef.values()) {
    const values = refValues(tests[idx[0]].ref, idx.map((i) => tests[i]));
    refGroups.push({ idx, patterns: new Set(values.map((v) => idx.map((i) => (tests[i].test(v) ? '1' : '0')).join(''))) });
  }

  // the groups: union-find over one condition's tests and one reference's
  const parent = tests.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); };
  for (const list of condTests) for (let k = 1; k < list.length; k++) union(list[0], list[k]);
  for (const { idx } of refGroups) for (let k = 1; k < idx.length; k++) union(idx[0], idx[k]);
  /** @type {Map<number, number>} root → group */
  const groupOf = new Map();
  /** @type {number[][]} */
  const groups = [];
  tests.forEach((_, i) => {
    const r = find(i);
    let gi = groupOf.get(r);
    if (gi === undefined) { gi = groups.length; groupOf.set(r, gi); groups.push([]); }
    groups[gi].push(i);
  });
  /** @type {(typeof refGroups)[]} the reference patterns of each group */
  const refsOf = groups.map(() => []);
  for (const rg of refGroups) refsOf[groupOf.get(find(rg.idx[0]))].push(rg);
  const condGroup = condTests.map((list) => (list.length ? groupOf.get(find(list[0])) : -1));

  /** @param {Cond|null} c @param {ArrayLike<number>} bits @returns {boolean} */
  const holds = (c, bits) => {
    if (!c) return true;
    switch (c.op) {
      case 'const': return c.value;
      case 'and': return holds(c.a, bits) && holds(c.b, bits);
      case 'or': return holds(c.a, bits) || holds(c.b, bits);
      case 'not': return !holds(c.a, bits);
      default: {
        const { test, neg } = leafTest(c);
        const i = index.get(test.key);
        // (a test the space was not built with: unknown — neither passes nor fails for sure)
        return i === undefined ? true : !!bits[i] !== neg;
      }
    }
  };
  /** @param {ArrayLike<number>} bits @param {number} [g] */
  const possible = (bits, g) => (g === undefined ? refGroups : refsOf[g]).every((rg) => rg.patterns.has(rg.idx.map((i) => (bits[i] ? '1' : '0')).join('')));
  return { tests, groups, condGroup, holds, possible };
}

/**
 * The party's size (`party`) and its members (`party:<who>`) as one reference: the outcome patterns
 * of their tests that can happen together — a size from 0 to `MAX_PARTY` and members held up to
 * that size, each name (in lower case) another member. Their tests leave `byRef`. Null when no
 * test names a member, or more than `MAX_MEMBER_NAMES` do (each then read on its own, free of the
 * size).
 * @param {StoryTest[]} tests
 * @param {Map<string, number[]>} byRef reference → its testable tests (the party's are taken out)
 * @returns {{ idx: number[], patterns: Set<string> }|null}
 */
function partyPatterns(tests, byRef) {
  const names = [...byRef.keys()].filter((k) => k.startsWith('party:'));
  if (!names.length || names.length > MAX_MEMBER_NAMES) return null;
  const sizeIdx = byRef.get('game:party') ?? [];
  const memberIdx = names.map((k) => /** @type {number[]} */ (byRef.get(k)));
  const held = new Uint8Array(names.length);
  const patterns = new Set();
  const emit = (size) => {
    let p = '';
    for (const i of sizeIdx) p += tests[i].test(size) ? '1' : '0';
    memberIdx.forEach((list, m) => { for (const i of list) p += tests[i].test(held[m]) ? '1' : '0'; });
    patterns.add(p);
  };
  // every set of at most `size` members, for every size
  const choose = (from, left, size) => {
    emit(size);
    if (!left) return;
    for (let m = from; m < names.length; m++) {
      held[m] = 1;
      choose(m + 1, left - 1, size);
      held[m] = 0;
    }
  };
  for (let size = 0; size <= MAX_PARTY; size++) choose(0, size, size);
  byRef.delete('game:party');
  for (const k of names) byRef.delete(k);
  return { idx: [...sizeIdx, ...memberIdx.flat()], patterns };
}

/**
 * Can the conditions all hold at once in some story? null when a group of tests that depend on
 * each other (`conditionSpace`) has more than `maxTests` (too many combinations to try) and the
 * others leave it open.
 * @param {(Cond|null)[]} conds
 * @param {number} [maxTests]
 * @returns {boolean|null}
 */
export function canHoldTogether(conds, maxTests = 12) {
  const { tests, groups, condGroup, holds, possible } = conditionSpace(conds);
  const bits = new Uint8Array(tests.length);
  // (a condition that makes no test — `not true` — holds or not by itself)
  if (conds.some((c, k) => condGroup[k] < 0 && !holds(c, bits))) return false;
  let open = false;
  for (let g = 0; g < groups.length; g++) {
    const idx = groups[g];
    if (idx.length > Math.min(maxTests, 20)) { open = true; continue; }
    const mine = conds.filter((_, k) => condGroup[k] === g);
    let any = false;
    for (let m = 0; m < 2 ** idx.length && !any; m++) {
      idx.forEach((t, j) => { bits[t] = (m >> j) & 1; });
      any = possible(bits, g) && mine.every((c) => holds(c, bits));
    }
    if (!any) return false;
  }
  return open ? null : true;
}

/**
 * The story states of a set of objects — every possible combination of the outcomes of the tests
 * their conditions make (`presenceCondition`), grouped by what is there. The tests fall into
 * independent groups (`conditionSpace`); each group's combinations are all tried up to `maxTests`
 * tests in it (past that: all off, all on and each test alone flipped from either), giving what of
 * the group's objects can be there together (its **patterns**); the states are the combinations of
 * the groups' patterns — all of them when there are at most `maxStates`, else `maxStates` of them:
 * every group at its fullest, at its emptiest, each pattern of each group with the others at
 * either, then an even spread of the rest (seeded: the same every run).
 * States come in the order of their first combination (test 0 counting fastest).
 * @param {LevelObject[]} objects (only those with a condition matter)
 * @param {{ maxTests?: number, maxStates?: number }} [opts]
 * @returns {{ tests: StoryTest[], groups: StoryGroup[], exhaustive: boolean, capped: boolean,
 *   total: number, states: { present: Set<LevelObject>, pick: number[] }[] }}
 *   exhaustive: every possible combination was checked; capped: there are more states (`total`:
 *   how many — at least, when a group was sampled) than were checked; states: what is there in each
 *   (objects without a condition always are) and the pattern of each group (`pick`)
 */
export function storyStates(objects, { maxTests = 12, maxStates = 64 } = {}) {
  const conds = objects.map((o) => ({ o, c: presenceCondition(o) })).filter((x) => x.c);
  const { tests, groups: testGroups, condGroup, holds, possible } = conditionSpace(conds.map((x) => x.c));
  const bits = new Uint8Array(tests.length);
  const always = objects.filter((o) => !presenceCondition(o));
  // (a condition that makes no test — `not true` — is there or not by itself)
  conds.forEach((x, k) => { if (condGroup[k] < 0 && holds(x.c, bits)) always.push(x.o); });

  /** @type {StoryGroup[]} */
  const groups = testGroups.map((idx, g) => {
    const mine = conds.filter((_, k) => condGroup[k] === g);
    const n = idx.length;
    let exhaustive = n <= Math.min(maxTests, 20);
    /** @type {Uint8Array[]} */
    const tries = [];
    if (exhaustive) {
      for (let m = 0; m < 2 ** n; m++) tries.push(Uint8Array.from(idx, (_, j) => (m >> j) & 1));
    } else {
      for (const all of [0, 1]) {
        tries.push(new Uint8Array(n).fill(all));
        for (let j = 0; j < n; j++) { const b = new Uint8Array(n).fill(all); b[j] = 1 - all; tries.push(b); }
      }
    }
    /** @type {StoryGroup['patterns']} */
    const patterns = [];
    /** @type {Map<string, number>} */
    const byKey = new Map();
    for (const local of tries) {
      bits.fill(0);
      idx.forEach((t, j) => { bits[t] = local[j]; });
      if (!possible(bits, g)) continue;
      const there = mine.map((x) => (holds(x.c, bits) ? '1' : '0')).join('');
      let p = byKey.get(there);
      if (p === undefined) {
        p = patterns.length;
        byKey.set(there, p);
        patterns.push({ present: mine.filter((_, k) => there[k] === '1').map((x) => x.o), combos: [] });
      }
      patterns[p].combos.push(local);
    }
    if (!patterns.length) {
      // (nothing tried can happen — tests that contradict each other in every sample: all there)
      patterns.push({ present: mine.map((x) => x.o), combos: [] });
      exhaustive = false;
    }
    return { tests: idx, objects: mine.map((x) => x.o), patterns, exhaustive };
  });

  const total = groups.reduce((a, gr) => a * gr.patterns.length, 1);
  const capped = total > maxStates;
  /** @type {number[][]} */
  let picks = [];
  if (!capped) {
    for (let m = 0; m < total; m++) {
      let r = m;
      picks.push(groups.map((gr) => { const p = r % gr.patterns.length; r = (r - p) / gr.patterns.length; return p; }));
    }
  } else picks = samplePicks(groups, maxStates);
  // in the order of their first combination, test 0 counting fastest (the order every combination
  // of the tests would meet them in)
  const first = (pick) => {
    const b = new Uint8Array(tests.length);
    pick.forEach((p, g) => { const c = groups[g].patterns[p].combos[0]; if (c) groups[g].tests.forEach((t, j) => { b[t] = c[j]; }); });
    return b;
  };
  const keyed = picks.map((pick) => ({ pick, b: first(pick) }));
  keyed.sort((x, y) => {
    for (let i = tests.length - 1; i >= 0; i--) if (x.b[i] !== y.b[i]) return x.b[i] - y.b[i];
    return 0;
  });
  const states = keyed.map(({ pick }) => ({ pick, present: new Set([...always, ...pick.flatMap((p, g) => groups[g].patterns[p].present)]) }));
  return { tests, groups, exhaustive: !capped && groups.every((gr) => gr.exhaustive), capped, total, states };
}

/**
 * `max` combinations of the groups' patterns when there are more: every group at its fullest
 * pattern (the most objects there) and at its emptiest, each pattern of each group with the others
 * at either, then an even spread of the rest (mulberry32, a fixed seed).
 * @param {StoryGroup[]} groups
 * @param {number} max
 * @returns {number[][]}
 */
function samplePicks(groups, max) {
  const by = (better) => groups.map((gr) => gr.patterns.reduce((best, p, k) => (better(p.present.length, gr.patterns[best].present.length) ? k : best), 0));
  const fullest = by((a, b) => a > b);
  const emptiest = by((a, b) => a < b);
  /** @type {number[][]} */
  const out = [];
  const seen = new Set();
  const add = (pick) => {
    const k = pick.join(',');
    if (out.length < max && !seen.has(k)) { seen.add(k); out.push(pick); }
  };
  add(emptiest);
  add(fullest);
  for (const base of [emptiest, fullest]) groups.forEach((gr, g) => gr.patterns.forEach((_, p) => add(base.map((q, k) => (k === g ? p : q)))));
  const rand = mulberry32(0x5eed);
  for (let tries = 0; out.length < max && tries < max * 32; tries++) add(groups.map((gr) => Math.floor(rand() * gr.patterns.length)));
  return out;
}
