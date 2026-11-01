/**
 * campaigncheck.mjs — the checks of a whole campaign (docs/specs/CAMPAIGN_FORMAT.md §9), on top of
 * `checkLevel` for each of its level files:
 *
 *  - links: every exit leads to a level of the campaign and to an entrance that exists in at least
 *    one file of that level (or, without an entrance, across a seam onto walkable ground); a chapter
 *    variant keeps its base's size; placed levels that touch or overlap agree along the seam, in
 *    every chapter; `at` on whole tiles; every level can be reached from the start;
 *  - the story: the story files (`buildStory`) and every level file's `storyIssues` against them
 *    (with the campaign's events and `once` keys, for `done:`); every story script parses; `talk`,
 *    `run` and `call` name scripts that exist; quest stages exist (in every condition: chapters'
 *    `when`, events' `if`, goals' `done`, scripts); a chapter's `when` does not read `chapter`; a
 *    reserved word is no bare flag of a chapter's `when`; `done:` / `visited:` keys name something;
 *    `once` / `cycle` keys are not shared across levels and story files; `travel` targets exist;
 *    a background event's script — and every story script its `call`s reach — uses only what a
 *    background run may (`backgroundErrors`); items taken but never given; flags and variables read
 *    but never written; declared names nobody uses (info);
 *  - the story's reach: a fixpoint from the start level and the starting flags — the levels the
 *    player can get to through exits whose conditions could hold, and the flags set there — reports
 *    exits that can never open and flags set only where the player cannot go;
 *  - the content-text keys (docs/specs/I18N.md §4.2): campaign.json's and the story files' (texts
 *    with no key, keys on no text: warnings, errors with `strict`; a key on two texts of a file: an
 *    error), and a key that the campaign's files hold with two different Englishes (an error; a
 *    chapter variant sharing its base's key for the same English is expected).
 *
 * Node-only (no DOM): `tools/check-level.mjs --campaign` and the campaign generators use it.
 */
import { validateLevel } from '../../src/engine/level/LevelFormat.js';
import { levelExits, findEntrance } from '../../src/engine/level/Travel.js';
import {
  parseScript, flagCondition, scriptRefs, emptyRefs, addConditionRefs, conditionRefs, interpolate,
} from '../../src/engine/level/StoryScript.js';
import {
  storyIssues, formatStoryIssue, scriptSpeakers, levelNames, conditionFields, scriptFields, readCondition, conditionError, refIssues,
  stagedActors, backgroundErrors,
} from '../../src/engine/level/StoryChecks.js';
import { isOwnKey } from '../../src/engine/utils/own.js';
import { levelFile, levelVariants, acrossSeam } from '../../src/game/campaign/CampaignFormat.js';
import { buildStory, storyFile } from '../../src/game/campaign/StoryFormat.js';
import { levelTexts, campaignTexts, storyFileTexts, storyTextTexts, fileKeyIssues } from '../../src/engine/i18n/TextKeys.js';
import { gridFromLevel, placerFromLevel, checkLevel } from './levelcheck.mjs';

/**
 * @import { Level } from '../../src/engine/level/types.js'
 * @import { Campaign, CampaignChapter } from '../../src/game/campaign/CampaignFormat.js'
 * @import { Story } from '../../src/game/campaign/StoryFormat.js'
 * @import { Cond, ScriptNode, ScriptRefs, RefReader } from '../../src/engine/level/StoryScript.js'
 * @import { StoryContext, ConditionRule } from '../../src/engine/level/StoryChecks.js'
 * @import { ParsedScript } from '../../src/engine/level/StoryScript.js'
 */

const walkTile = (L, i, j) => {
  const d = L.legend?.[L.tiles?.[j]?.[i]];
  return !!d && !d.void && !d.water && d.walkable !== false;
};
const heightAt = (L, i, j) => {
  const c = L.heights?.[j]?.[i];
  if (c == null) return NaN;
  const n = c.charCodeAt(0);
  return n >= 97 ? n - 87 : n - 48;
};
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const message = (e) => (e instanceof Error ? e.message : String(e));
/**
 * A story condition field as the game reads it (`readCondition`: the flag rule of `when`,
 * `unless`, `requires` and a chapter's `when`; an event's `if` and a goal's `done` as scripts write
 * them), or null when it is blank or does not parse — such a field is reported as an error where it
 * is (its fallback, one flag named by the whole text, is no flag to track).
 * @param {unknown} v
 * @param {ConditionRule} [rule]
 * @returns {Cond|null}
 */
function condOf(v, rule = 'flag') {
  const src = text(v);
  if (!src) return null;
  const { cond, error } = readCondition(src, rule);
  return error ? null : cond;
}
/** Could a flag-rule condition field hold (blank or malformed: yes — the error is reported elsewhere)? */
const fieldCouldHold = (v, S) => { const c = condOf(v); return !c || couldHold(c, S); };

/** `a`, or `a (and 2 more)`. @param {string[]} list */
const some = (list) => `${list[0]}${list.length > 1 ? ` (and ${list.length - 1} more)` : ''}`;
/** `a and b`, or `a and b (and 2 more)`. @param {string[]} list */
const both = (list) => `${list[0]} and ${list[1]}${list.length > 2 ? ` (and ${list.length - 2} more)` : ''}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Visit every node of a script, blocks included.
 * @param {ScriptNode[]|null|undefined} nodes
 * @param {(n: ScriptNode) => void} fn
 */
function eachNode(nodes, fn) {
  for (const n of nodes ?? []) {
    fn(n);
    if (n.t === 'choice') for (const o of n.options) eachNode(o.body, fn);
    else if (n.t === 'if') { for (const b of n.branches) eachNode(b.body, fn); eachNode(n.otherwise, fn); }
    else if (n.t === 'loop' || n.t === 'once') eachNode(n.body, fn);
    else if (n.t === 'vary') for (const a of n.alts) eachNode(a, fn);
  }
}

/**
 * The variables a script's texts show (`${deliveries}` — dialogue, choices, options, banners,
 * toasts, barks, endings); `${item:x}`, the game values, a `\${…}` written as text and a reference
 * that does not parse are left out (`interpolate` reads them: exactly the values the game shows).
 * @param {ScriptNode[]} nodes
 * @returns {Set<string>}
 */
function shownVariables(nodes) {
  const out = new Set();
  /** @type {RefReader} */
  const collect = { get: (ref) => { if (ref.kind === '') out.add(ref.name); return 0; } };
  const scan = (s) => {
    if (typeof s === 'string' && s.includes('${')) interpolate(s, collect);
  };
  eachNode(nodes, (n) => {
    if (n.t === 'say') scan(n.text);
    else if (n.t === 'choice') { scan(n.text); for (const o of n.options) scan(o.label); }
    else if (n.t === 'cmd') { scan(n.args.text); scan(n.args.title); scan(n.args.subtitle); }
  });
  return out;
}

/** a `cmp` b, for numbers. */
function compare(a, cmp, b) {
  switch (cmp) {
    case '=': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    default: return true;
  }
}

/**
 * Could a condition hold once the flags / variables in `S` have been set? A flag or variable
 * outside `S` stays 0; items, quests, the clock and every other value may be anything; a `not` may
 * always hold (flags start unset). Conservative: false only when the condition needs a flag that
 * nothing in `S`'s reach sets.
 * @param {Cond} c
 * @param {Set<string>} S
 * @returns {boolean}
 */
export function couldHold(c, S) {
  switch (c.op) {
    case 'const': return c.value;
    case 'and': return couldHold(c.a, S) && couldHold(c.b, S);
    case 'or': return couldHold(c.a, S) || couldHold(c.b, S);
    case 'not': return true;
    case 'ref': return c.ref.kind !== '' || S.has(c.ref.name);
    case 'cmp': return c.ref.kind !== '' || S.has(c.ref.name) || typeof c.value !== 'number' || compare(0, c.cmp, c.value);
    default: return true;
  }
}

/**
 * The flags a condition needs (read outside a `not`, not in `S`, and not satisfied by 0) — what
 * makes `couldHold` false, for messages.
 * @param {Cond} c
 * @param {Set<string>} S
 * @param {string[]} [out]
 */
function missingFlags(c, S, out = []) {
  if (c.op === 'and' || c.op === 'or') { missingFlags(c.a, S, out); missingFlags(c.b, S, out); }
  else if (c.op === 'ref' && c.ref.kind === '' && !S.has(c.ref.name)) out.push(c.ref.name);
  else if (c.op === 'cmp' && c.ref.kind === '' && !S.has(c.ref.name) && typeof c.value === 'number' && !compare(0, c.cmp, c.value)) out.push(c.ref.name);
  return [...new Set(out)];
}

/** Past this many texts without a key in one file, they are one message. */
const MISSING_ONE_BY_ONE = 3;

/**
 * The content-text keys of a campaign (docs/specs/I18N.md §4.2, §4.10), into `out`:
 * - campaign.json's and each story file's own problems (`fileKeyIssues`: a text with no key and a
 *   key on no text are warnings, errors with `strict`; one key on two texts of a file an error);
 * - a key that the campaign's files — every level file (chapter variants too), campaign.json and
 *   the story files — hold with two different Englishes: an error. Copies that share a key with the
 *   same English (a chapter variant and its base) are expected.
 * @param {Campaign} campaign
 * @param {Map<string, Level>} files level file id → level
 * @param {{ name: string, text: string }[]} storyTexts the story files that could be read
 * @param {boolean} strict
 * @param {CampaignReport} out
 */
function textKeyChecks(campaign, files, storyTexts, strict, out) {
  const soft = strict ? out.errors : out.warnings;
  /** @type {Map<string, { text: string, where: string }[]>} key → the texts that hold it */
  const byKey = new Map();
  const note = (texts, file) => {
    for (const t of texts) {
      if (!t.key) continue;
      let l = byKey.get(t.key);
      if (!l) byKey.set(t.key, (l = []));
      l.push({ text: t.text, where: `${file} › ${t.where}` });
    }
  };
  const ownIssues = (issues, file) => {
    const missing = issues.filter((i) => i.kind === 'missing');
    if (missing.length > MISSING_ONE_BY_ONE) soft.push(`${file}: text keys: ${missing.length} texts have no key — they stay English in every language (\`npm run i18n:keys -- --assign <campaign>\` gives them keys): ${missing.slice(0, MISSING_ONE_BY_ONE).map((i) => i.where).join(', ')} (and ${missing.length - MISSING_ONE_BY_ONE} more)`);
    else for (const i of missing) soft.push(`${file}: text keys: ${i.where}: ${i.msg}`);
    for (const i of issues) if (i.kind !== 'missing') (i.severity === 'error' ? out.errors : soft).push(`${file}: text keys: ${i.where}: ${i.msg}`);
  };
  for (const [id, level] of files) note(levelTexts(level), levelFile(id));
  // (campaign.json and the story files: counted for the info line; the level files count their own)
  let own = 0;
  let keyed = 0;
  const count = (texts) => { own += texts.length; keyed += texts.filter((t) => t.key).length; return texts; };
  note(count(campaignTexts(campaign)), 'campaign.json');
  ownIssues(fileKeyIssues('campaign', campaign), 'campaign.json');
  for (const { name, text } of storyTexts) {
    const f = storyFile(name);
    if (name.endsWith('.story')) {
      note(count(storyTextTexts(String(text).split(/\r?\n/))), f);
      ownIssues(fileKeyIssues('storyText', text), f);
    } else {
      let raw;
      try { raw = JSON.parse(text); } catch { continue; }
      note(count(storyFileTexts(raw)), f);
      ownIssues(fileKeyIssues('story', raw), f);
    }
  }
  const shared = [...byKey.values()].filter((l) => new Set(l.map((e) => e.where.split(' › ')[0])).size > 1).length;
  out.info.push(`text keys: campaign.json${storyTexts.length ? ` and ${storyTexts.length} story file${storyTexts.length === 1 ? '' : 's'}` : ''}: ${keyed} of ${own} texts keyed; ${shared} key${shared === 1 ? '' : 's'} shared by copies in two files (a chapter variant and its base)`);
  for (const [key, list] of byKey) {
    /** @type {Map<string, string[]>} English → where */
    const texts = new Map();
    for (const e of list) texts.set(e.text, [...(texts.get(e.text) ?? []), e.where]);
    if (texts.size < 2) continue;
    out.errors.push(`text key ${key}: one key, ${texts.size} different Englishes — ${[...texts].map(([t, w]) => `"${t.length > 50 ? `${t.slice(0, 47)}…` : t}" (${some(w)})`).join(' and ')}: the copy whose English changed needs a new key (\`npm run i18n:keys -- --fix\`, or re-run its generator)`);
  }
}

/**
 * @typedef {object} CampaignReport
 * @property {Map<string, { file: string, base: string, report: { errors: string[], warnings: string[], info: string[] } }>} levels
 *   every level file checked (bases and chapter variants), by file id
 * @property {string[]} errors    campaign-wide errors (links, missing files, the story files)
 * @property {string[]} warnings
 * @property {string[]} info
 * @property {string[]} unreadable  files that exist but cannot be read or parsed (reported as
 *   errors too; `check-level.mjs` exits 2)
 * @property {Story|null} story  the merged story files (null: the campaign lists none)
 */

/**
 * Check a campaign, all its level files and its story files.
 * @param {Campaign} campaign a normalised campaign
 * @param {(id: string) => { level: Level, warnings: string[] } | null} readLevel the parsed
 *   `levels/<id>.json` of the campaign folder, null when it does not exist (it may throw: the file
 *   is reported as unreadable)
 * @param {{ strict?: boolean, levelChecks?: boolean, readStory?: ((name: string) => string|null)|null }} [opts]
 *   strict: checkLevel's composition rules are errors; levelChecks (true): run checkLevel on every
 *   file (false: the links and the story only); readStory: the text of `story/<name>`, null when it
 *   does not exist (it may throw) — needed when campaign.json lists story files
 * @returns {CampaignReport}
 */
export function checkCampaign(campaign, readLevel, { strict = false, levelChecks = true, readStory = null } = {}) {
  /** @type {CampaignReport} */
  const out = { levels: new Map(), errors: [], warnings: [], info: [], unreadable: [], story: null };
  const err = (m) => out.errors.push(m);
  const warn = (m) => out.warnings.push(m);
  const info = (m) => out.info.push(m);
  const baseIds = new Set(campaign.levels.map((l) => l.id));

  // ---- placement: whole tiles ----
  for (const l of campaign.levels) {
    if (l.at && !(Number.isInteger(l.at[0]) && Number.isInteger(l.at[1]))) {
      warn(`level "${l.id}": "at" [${l.at.join(', ')}] is not on whole tiles — seams join tile edges, so its seams are off by a fraction of a tile`);
    }
  }

  // ---- every file: bases and their chapter variants ----
  /** @type {Map<string, Level>} file id → level */
  const files = new Map();
  for (const base of baseIds) {
    for (const id of levelVariants(campaign, base)) {
      if (files.has(id) || out.levels.has(id)) continue;
      let r;
      try {
        r = readLevel(id);
      } catch (e) {
        out.unreadable.push(levelFile(id));
        out.levels.set(id, { file: levelFile(id), base, report: { errors: [`cannot be read: ${message(e)}`], warnings: [], info: [] } });
        continue;
      }
      if (!r) { err(`${levelFile(id)} does not exist${id === base ? '' : ` (a chapter variant of "${base}")`}`); continue; }
      const structural = validateLevel(r.level);
      let report = { errors: structural.map((m) => `validateLevel: ${m}`), warnings: r.warnings.map((m) => `format: ${m}`), info: [] };
      if (!structural.length && levelChecks) {
        try {
          const g = gridFromLevel(r.level);
          // (a campaign's levels always have a story: their objects' conditions apply — story states)
          const lr = checkLevel(r.level, { g, P: placerFromLevel(g, r.level) }, { strict, story: false, storyStates: true });
          report = { errors: [...report.errors, ...lr.errors], warnings: [...report.warnings, ...lr.warnings], info: lr.info };
        } catch (e) {
          report.errors.push(`the level checks stopped: ${message(e)}`);
        }
      }
      out.levels.set(id, { file: levelFile(id), base, report });
      files.set(id, r.level);
    }
  }

  // ---- chapter variants keep their base's size ----
  for (const [id, { base }] of out.levels) {
    const v = files.get(id);
    const b = files.get(base);
    if (id === base || !v || !b) continue;
    if (v.width !== b.width || v.depth !== b.depth) {
      err(`${levelFile(id)} is ${v.width} × ${v.depth}, but ${levelFile(base)}, the level it stands for, is ${b.width} × ${b.depth}: a chapter variant must keep its base's size (its place on the campaign plane, seams and arrivals)`);
    }
  }

  // ---- the story files ----
  /** @type {{ name: string, text: string }[]} */
  const storyTexts = [];
  for (const name of campaign.story) {
    const f = storyFile(name);
    if (!readStory) { err(`${f}: not checked — the campaign check was given no way to read story files (readStory)`); continue; }
    let src;
    try {
      src = readStory(name);
    } catch (e) {
      out.unreadable.push(f);
      err(`${f} cannot be read: ${message(e)}`);
      continue;
    }
    if (src == null) { err(`${f} does not exist (campaign.json lists it in "story")`); continue; }
    if (name.endsWith('.json')) {
      let raw;
      try {
        raw = JSON.parse(src);
      } catch (e) {
        out.unreadable.push(f);
        err(`${f} cannot be read: not valid JSON (${message(e)})`);
        continue;
      }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { out.unreadable.push(f); err(`${f} cannot be read: not a JSON object`); continue; }
    }
    storyTexts.push({ name, text: src });
  }
  /** @type {Story|null} */
  let story = null;
  if (campaign.story.length) {
    const built = buildStory(storyTexts);
    story = built.story;
    // (buildStory's messages begin with the file name, `name: …` or `name:line: …`)
    for (const w of built.warnings) warn(`story/${w}`);
  }
  out.story = story;
  const has = (table, k) => !!table && isOwnKey(table, k);

  /** Every script parsed once (level scripts by their field value, story scripts by their lines). @type {Map<unknown, ParsedScript>} */
  const parsed = new Map();
  /** @param {unknown} v @returns {ParsedScript} */
  const parse = (v) => {
    let p = parsed.get(v);
    if (!p) { p = parseScript(v); parsed.set(v, p); }
    return p;
  };

  // what `done:` keys can name across the campaign: every level file's events (`<base>.<id>`), the
  // story files' events (`story.<id>`) — and whether each is `once` — and every `once` block's key
  /** @type {Map<string, boolean>} */
  const events = new Map();
  const onceKeys = new Set();
  for (const [id, level] of files) {
    const base = out.levels.get(id).base;
    for (const o of level.objects ?? []) {
      if (o?.type === 'event' && typeof o.id === 'string') events.set(`${base}.${o.id}`, !!events.get(`${base}.${o.id}`) || !!o.once);
      for (const [, v] of scriptFields(o)) for (const k of scriptRefs(parse(v).nodes).onceKeys) onceKeys.add(k);
    }
  }
  if (story) {
    for (const e of story.events) events.set(`story.${e.id}`, e.once);
    for (const s of Object.values(story.scripts)) for (const k of scriptRefs(parse(s.lines).nodes).onceKeys) onceKeys.add(k);
  }

  // the names a villager of any level answers to (id, actor, name — in lower case): a party member
  // joined in one level follows the player to the others (`party:<who>`, `party leave <who>` …)
  const villagers = new Set(['player']);
  for (const level of files.values()) for (const v of levelNames(level).villagers) villagers.add(v);

  /** @type {StoryContext} */
  const ctx = { levels: baseIds, events, onceKeys, villagers };
  if (story) {
    ctx.items = new Set(Object.keys(story.items));
    ctx.quests = new Map(Object.entries(story.quests).map(([id, q]) => [id, q.stages.map((s) => s.id)]));
    ctx.scripts = new Set(Object.keys(story.scripts));
    ctx.actors = new Map(Object.entries(story.actors).map(([id, a]) => [id, a.name]));
  }

  // ---- each level file's story, against the story files ----
  for (const [id, level] of files) {
    const rep = out.levels.get(id).report;
    for (const i of storyIssues(level, { ...ctx, level: out.levels.get(id).base })) (i.severity === 'error' ? rep.errors : rep.warnings).push(`story: ${formatStoryIssue(i, level)}`);
  }

  // ---- content-text keys (docs/specs/I18N.md §4.2): campaign.json's and the story files' own
  // (each level file's are checkLevel's), and one key, one English across all the campaign's files ----
  textKeyChecks(campaign, files, storyTexts, strict, out);

  /**
   * The problems of a condition outside the level files (a chapter's `when`, a story event's `if`,
   * a quest goal's `done`): it does not parse, a reserved bare name, what it names.
   * @param {string} src
   * @param {ConditionRule} rule
   * @param {string} where e.g. `campaign.json: chapter "two": when`
   */
  const checkCondition = (src, rule, where) => {
    const why = conditionError(src, rule);
    if (why) err(`${where} "${src}": ${why}`);
    const r = emptyRefs();
    addConditionRefs(readCondition(src, rule).cond, r);
    for (const i of refIssues(r, ctx)) (i.severity === 'error' ? err : warn)(`${where} "${src}": ${i.msg}`);
  };

  // ---- the start ----
  const startLevel = files.get(campaign.start.level);
  if (startLevel && campaign.start.entrance && !findEntrance(startLevel, campaign.start.entrance)) {
    err(`start: level "${campaign.start.level}" has no entrance "${campaign.start.entrance}"`);
  }

  /** The files of base level `to` that have entrance `name` (in any story state), and those that lack it. */
  const entranceIn = (to, name) => {
    const ids = levelVariants(campaign, to).filter((tid) => files.has(tid));
    return { has: ids.filter((tid) => findEntrance(files.get(tid), name)), lacks: ids.filter((tid) => !findEntrance(files.get(tid), name)) };
  };

  // ---- links: every exit of every file ----
  /** @type {Map<string, Set<string>>} base id → the base ids its exits (and its scripts' travels) lead to */
  const graph = new Map([...baseIds].map((b) => [b, new Set()]));
  let links = 0;
  for (const [id, level] of files) {
    const from = out.levels.get(id).base;
    for (const o of levelExits(level)) {
      const where = `${levelFile(id)}: exit ${o.id}`;
      // (text(): level data is untrusted — String() of an object with an own `toString` throws)
      const to = text(o.to);
      const entrance = text(o.entrance);
      if (!to) continue; // (checkLevel / travelIssues already report it)
      if (!baseIds.has(to)) {
        err(`${where} leads to "${to}", which is not one of the campaign's levels${[...files.keys()].includes(to) ? ' (it is a chapter variant: exits name the base level)' : ''}`);
        continue;
      }
      links++;
      graph.get(from).add(to);
      if (entrance) {
        // an entrance may exist in some story state only (its own `when`, a chapter's variant file)
        const { has: with_, lacks } = entranceIn(to, entrance);
        if (!with_.length && lacks.length) err(`${where} arrives at entrance "${entrance}", which ${lacks.map(levelFile).join(' and ')} ${lacks.length > 1 ? 'do' : 'does'} not have`);
        else if (lacks.length) {
          const gated = !!(text(o.requires) || text(o.when) || text(o.unless));
          (gated ? info : warn)(`${where} arrives at entrance "${entrance}", which ${lacks.map(levelFile).join(' and ')} ${lacks.length > 1 ? 'do' : 'does'} not have (only ${with_.map(levelFile).join(', ')}): in a chapter that plays ${lacks.length > 1 ? 'one of those' : 'that file'} the player arrives at its player start${gated ? ' — fine if the exit\'s story condition keeps it closed then' : ''}`);
        }
        continue;
      }
      for (const tid of levelVariants(campaign, to)) {
        const target = files.get(tid);
        if (!target) continue;
        // no entrance: across the seam (both levels placed), else at the target's player start
        const cx = (o.minX + o.maxX) / 2;
        const cz = (o.minZ + o.maxZ) / 2;
        const p = acrossSeam(campaign, from, to, cx, cz);
        if (!p) { info(`${where} arrives at the player start of ${levelFile(tid)} (no entrance, the levels are not both placed)`); continue; }
        const i = Math.floor(p.x);
        const j = Math.floor(p.z);
        // (the arrival moves up to 3 u onto standable ground, as the game does)
        let ok = false;
        for (let dj = -3; dj <= 3 && !ok; dj++) for (let di = -3; di <= 3 && !ok; di++) ok = walkTile(target, i + di, j + dj);
        if (!ok) err(`${where} crosses the seam to (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) in ${levelFile(tid)}, which is not walkable ground`);
      }
    }
  }

  // ---- seams: placed levels that overlap must agree tile by tile; touching ones along the edge ----
  // (in every chapter: the files that play side by side while it is in force)
  /** @type {(CampaignChapter|null)[]} the chapters that can be in force (null: none yet) */
  const states = [...(campaign.chapters.some((c) => !c.when) ? [] : [null]), ...campaign.chapters];
  const fileFor = (ch, base) => (ch && isOwnKey(ch.levels, base) ? ch.levels[base] : base);
  const placed = campaign.levels.filter((l) => l.at);
  for (let a = 0; a < placed.length; a++) {
    for (let b = a + 1; b < placed.length; b++) {
      const A = placed[a];
      const B = placed[b];
      /** @type {Map<string, { fa: string, fb: string, ch: CampaignChapter|null }>} */
      const pairs = new Map();
      for (const ch of states) {
        const fa = fileFor(ch, A.id);
        const fb = fileFor(ch, B.id);
        if (!pairs.has(`${fa}|${fb}`)) pairs.set(`${fa}|${fb}`, { fa, fb, ch });
      }
      for (const { fa, fb, ch } of pairs.values()) {
        const LA = files.get(fa);
        const LB = files.get(fb);
        if (!LA || !LB) continue;
        const variant = fa !== A.id || fb !== B.id;
        checkSeam(A.at, LA, fa, B.at, LB, fb, variant ? ` (chapter ${ch?.id})` : '', info, warn);
      }
    }
  }

  // ---- the story: where flags, items, quests, scripts and actors are used ----
  /** @type {Map<string, string[]>} */ const reads = new Map();
  /** @type {Map<string, string[]>} */ const writes = new Map();
  /** @type {Map<string, string[]>} flag → the level objects (file › …) that set it */ const levelWrites = new Map();
  /** @type {Map<string, string[]>} */ const itemUses = new Map();
  /** @type {Map<string, string[]>} */ const takes = new Map();
  const gives = new Set();
  const usedQuests = new Set();
  /** items a debug start preset hands out (a use, not a giver: presets are not play) */
  const startItems = new Set();
  const usedScripts = new Set();
  const usedActors = new Set();
  const speakers = new Set();
  const note = (map, k, where) => { const l = map.get(k); if (l) l.push(where); else map.set(k, [where]); };
  /** @param {ScriptRefs} r @param {string} where */
  const useRefs = (r, where) => {
    for (const f of r.reads) note(reads, f, where);
    for (const f of r.writes) note(writes, f, where);
    for (const it of r.items) note(itemUses, it, where);
    for (const it of r.gives) gives.add(it);
    for (const q of r.quests) usedQuests.add(q);
    for (const s of r.scripts) usedScripts.add(s);
    for (const a of r.actors) usedActors.add(a);
    for (const a of r.joins) usedActors.add(a);
    for (const a of r.members) usedActors.add(a);
    for (const s of r.speakers) speakers.add(s.toLowerCase());
  };
  /**
   * A condition field's uses (nothing for a blank or malformed one).
   * @param {unknown} v @param {string} where @param {ConditionRule} [rule]
   */
  const useCondition = (v, where, rule = 'flag') => {
    const cond = condOf(v, rule);
    if (!cond) return;
    const r = emptyRefs();
    addConditionRefs(cond, r);
    useRefs(r, where);
  };
  /** A parsed script's uses (texts' `${…}` read variables; `take` items). @param {ScriptNode[]} nodes @param {(line: number) => string} at */
  const useScript = (nodes, where, at) => {
    const r = scriptRefs(nodes);
    useRefs(r, where);
    for (const v of shownVariables(nodes)) note(reads, v, where);
    eachNode(nodes, (n) => { if (n.t === 'cmd' && n.op === 'take' && n.args.item !== 'gold') note(takes, n.args.item, at(n.line)); });
    return r;
  };

  /**
   * `once` and `cycle` / `seq` / `pick` keys → the scripts that use them (keys are global: two
   * scripts with one key share it). `ident`: the script (a villager with an actor talks as that
   * character, in every level); `scope`: its base level ('' a story file — a level's own clashes
   * are reported by storyIssues, in that level's report).
   * @type {Record<'once'|'vary', Map<string, Map<string, { where: string, scope: string }>>>}
   */
  const keyUsers = { once: new Map(), vary: new Map() };
  /** @param {ScriptRefs} r @param {string} ident @param {string} where @param {string} scope */
  const noteKeys = (r, ident, where, scope) => {
    for (const [kind, keys] of /** @type {const} */ ([['once', r.onceKeys], ['vary', r.varyKeys]])) {
      for (const key of keys) {
        const users = keyUsers[kind].get(key) ?? new Map();
        if (!users.has(ident)) users.set(ident, { where, scope });
        keyUsers[kind].set(key, users);
      }
    }
  };

  // what each level file reads, writes and travels to
  /** @type {Map<string, { writes: Set<string>, travels: { level: string, entrance: string, where: string }[] }>} */
  const levelData = new Map();
  for (const [id, level] of files) {
    const file = levelFile(id);
    const base = out.levels.get(id).base;
    const d = { writes: new Set(), travels: [] };
    for (const o of level.objects ?? []) {
      const where = `${file} › ${o?.type} ${o?.id}`;
      for (const [field, v, rule] of conditionFields(o)) useCondition(v, `${where} › ${field}`, rule);
      if (o?.type === 'npc' && text(o.flag)) {
        note(writes, text(o.flag), `${where} › flag`);
        note(levelWrites, text(o.flag), `${where} › flag`);
        d.writes.add(text(o.flag));
      }
      if (o?.type === 'npc' && text(o.actor)) usedActors.add(text(o.actor));
      for (const [field, v] of scriptFields(o)) {
        const r = useScript(parse(v).nodes, `${where} › ${field}`, (line) => `${where} › ${field}:${line}`);
        for (const w of r.writes) { d.writes.add(w); note(levelWrites, w, `${where} › ${field}`); }
        for (const t of r.travels) d.travels.push({ level: t.level, entrance: t.entrance, where: `${where} › ${field}:${t.line}` });
        const ident = o?.type === 'npc' && field === 'talk' && text(o.actor) ? `actor:${text(o.actor).toLowerCase()}` : `${base}\u0000${o?.id}\u0000${field}`;
        noteKeys(r, ident, `${where} › ${field}`, base);
      }
    }
    levelData.set(id, d);
  }
  // level scripts' travels: an entrance that exists somewhere (the level itself: storyIssues)
  for (const d of levelData.values()) {
    for (const t of d.travels) {
      if (t.entrance && baseIds.has(t.level) && !entranceIn(t.level, t.entrance).has.length) err(`${t.where}: travel: level "${t.level}" has no entrance "${t.entrance}" in any of its files`);
    }
  }

  for (const ch of campaign.chapters) {
    if (!ch.when) continue;
    checkCondition(ch.when, 'flag', `campaign.json: chapter "${ch.id}": when`);
    // the chapter in force is what the chapters' conditions decide: one that reads it asks itself
    // (activeChapter answers such a question with the chapter decided so far)
    if (conditionRefs(readCondition(ch.when, 'flag').cond).some(({ ref }) => ref.kind === 'game' && ref.name === 'chapter')) {
      err(`campaign.json: chapter "${ch.id}": when "${ch.when}" reads "chapter" — the chapter in force is what the chapters' conditions decide, so one of them cannot read it (it would ask itself; use the flags that begin the chapters)`);
    }
    useCondition(ch.when, `chapter "${ch.id}"`);
  }
  for (const f of campaign.flags) note(writes, f, 'campaign.json "flags"');

  /** story script id → its parsed nodes */
  const storyScripts = new Map();
  /** @type {Map<string, (line: number) => string>} story script id → where its lines are */
  const scriptAt = new Map();
  /** travel targets of the story scripts (they may run anywhere) */
  const storyTravels = new Set();
  /** flags / variables the story scripts write (they count wherever the player is) */
  const storyWrites = new Set();
  if (story) {
    // the names the game finds (in any case): villagers of every level (id, actor, name: `villagers`
    // above), the story files' actors (id, name); places: every object id, marker and entrance name
    // (as written)
    const places = new Set(['player']);
    for (const level of files.values()) for (const p of levelNames(level).places) places.add(p);
    const storyActors = new Set();
    for (const [id, a] of Object.entries(story.actors)) {
      storyActors.add(id.toLowerCase());
      storyActors.add(a.name.toLowerCase());
    }
    const isVillager = (s) => villagers.has(s.toLowerCase());
    const isStoryActor = (s) => storyActors.has(s.toLowerCase());
    // (`done:` / `visited:` keys; items, quests and stages are reported below with their lines)
    // (and party members: villagers of any level, actors of the story files)
    /** @type {StoryContext} */
    const keysOnly = { levels: ctx.levels, events: ctx.events, onceKeys: ctx.onceKeys, villagers: ctx.villagers, actors: ctx.actors };
    for (const [sid, s] of Object.entries(story.scripts)) {
      const plain = s.file.endsWith('.story');
      const at = (line) => (plain ? `story/${s.file}:${s.line + line - 1}` : `story/${s.file} › script "${sid}" line ${line}`);
      const here = plain ? `story/${s.file}:${Math.max(1, s.line - 1)} (script "${sid}")` : `story/${s.file} › script "${sid}"`;
      const { nodes, errors } = parse(s.lines);
      storyScripts.set(sid, nodes);
      scriptAt.set(sid, at);
      for (const e of errors) err(`${at(e.line)}: ${e.msg}`);
      const r = useScript(nodes, here, at);
      for (const w of r.writes) storyWrites.add(w);
      noteKeys(r, `story:${sid}`, here, '');
      for (const i of refIssues(r, keysOnly)) (i.severity === 'error' ? err : warn)(`${here}: ${i.msg}`);
      // lines of the commands that name things
      const lineOf = new Map();
      eachNode(nodes, (n) => {
        if (n.t !== 'cmd') return;
        const k = n.op === 'call' ? `call:${n.args.script}` : n.op === 'quest' ? `quest:${n.args.id}` : '';
        if (k && !lineOf.has(k)) lineOf.set(k, n.line);
        if (n.op === 'quest' && n.args.verb === 'stage' && !lineOf.has(`stage:${n.args.id}:${n.args.stage}`)) lineOf.set(`stage:${n.args.id}:${n.args.stage}`, n.line);
      });
      const loc = (k) => (lineOf.has(k) ? at(lineOf.get(k)) : here);
      for (const c of r.scripts) if (!has(story.scripts, c)) err(`${loc(`call:${c}`)}: call: script "${c}" is not in the story files`);
      for (const q of r.quests) {
        if (has(story.quests, q)) continue;
        warn(`${loc(`quest:${q}`)}: quest "${q}" is not declared in the story files${r.stageReads.has(q) ? ` — so stage:${q} has no declared order of stages: a stage counts only once the quest reached it` : ''}`);
      }
      const stagesSeen = new Set();
      for (const { quest, stage } of r.stages) {
        if (!has(story.quests, quest) || stagesSeen.has(`${quest}:${stage}`)) continue;
        stagesSeen.add(`${quest}:${stage}`);
        if (!story.quests[quest].stages.some((x) => x.id === stage)) err(`${loc(`stage:${quest}:${stage}`)}: quest "${quest}" has no stage "${stage}"`);
      }
      for (const it of r.items) if (!has(story.items, it)) warn(`${here}: item "${it}" is not declared in the story files`);
      const named = new Set();
      for (const { speaker, line, quoted } of scriptSpeakers(s.lines, nodes)) {
        if (quoted || named.has(speaker.toLowerCase())) continue;
        named.add(speaker.toLowerCase());
        if (!isVillager(speaker) && !isStoryActor(speaker)) warn(`${at(line)}: speaker "${speaker}" is no actor of the story files (nor a villager of the campaign's levels) — shown as written; quote it — "${speaker}": — to say so`);
      }
      // staging commands direct a villager of the level the script runs in: an actor of the story
      // files that no villager of any level is cannot be directed anywhere
      const staged = stagedActors(nodes);
      for (const a of r.actors) {
        if (isVillager(a)) continue;
        if (!isStoryActor(a)) warn(`${here}: "${a}" is no actor of the story files and no villager of the campaign's levels`);
        else if (staged.has(a)) warn(`${here}: "${a}" is an actor of the story files, but no villager of the campaign's levels is — walk / teleport / face / home stop the script (emote, bark, pose and wait do nothing)`);
      }
      // `party join <who>`: a villager of the level the script runs in (else refused, with a warning)
      for (const a of r.joins) {
        if (isVillager(a)) continue;
        warn(isStoryActor(a)
          ? `${here}: "${a}" is an actor of the story files, but no villager of the campaign's levels is — "party join" is refused (a warning; the script goes on)`
          : `${here}: "${a}" is no villager of the campaign's levels — "party join" is refused (a warning; the script goes on)`);
      }
      for (const t of r.targets) {
        if (places.has(t) || isVillager(t)) continue;
        warn(isStoryActor(t)
          ? `${here}: "${t}" is an actor of the story files, but no villager of the campaign's levels is — a walk, teleport, camera, shot or effect to it stops the script`
          : `${here}: "${t}" names no actor, villager, object, entrance or marker of the campaign`);
      }
      for (const t of r.travels) {
        storyTravels.add(t.level);
        if (!baseIds.has(t.level)) err(`${at(t.line)}: travel: "${t.level}" is not a level of the campaign${files.has(t.level) ? ' (it is a chapter variant: travel names the base level)' : ''}`);
        else if (t.entrance && !entranceIn(t.level, t.entrance).has.length) err(`${at(t.line)}: travel: level "${t.level}" has no entrance "${t.entrance}" in any of its files`);
      }
    }
    for (const [id, a] of Object.entries(story.actors)) {
      if (a.talk && !has(story.scripts, a.talk)) err(`story: actor "${id}": talk names script "${a.talk}", which no story file has`);
    }
    for (const e of story.events) {
      const where = `story: event "${e.id}"`;
      if (!has(story.scripts, e.run)) err(`${where}: run names script "${e.run}", which no story file has`);
      // (a condition as scripts write it: `if: gold` reads the purse)
      if (e.if) checkCondition(e.if, 'script', `${where}: if`);
      useCondition(e.if, `${where} › if`, 'script');
      if (e.on === 'change' && !e.if) err(`${where}: a "change" event needs an "if" condition to watch`);
      if (e.level && !baseIds.has(e.level)) warn(`${where}: level "${e.level}" is not a level of the campaign`);
    }
    // background runs: a background story event's script, and every story script a background
    // event's `call`s reach (a level event's own script: storyIssues, in its level's report)
    /** @type {Map<string, string[]>} story script id → what runs it in the background */
    const inBackground = new Map();
    /**
     * @param {Iterable<string>} first the story scripts it runs (its `run`, or a level script's calls)
     * @param {string} by the event, for messages
     * @param {boolean} called `first` are reached through `call`
     */
    const runInBackground = (first, by, called) => {
      /** @type {[string, boolean][]} */
      const queue = [...first].map((sid) => [sid, called]);
      const seen = new Set();
      for (let h = 0; h < queue.length; h++) {
        const [sid, viaCall] = queue[h];
        if (seen.has(sid) || !storyScripts.has(sid)) continue;
        seen.add(sid);
        note(inBackground, sid, viaCall ? `${by} (through "call")` : by);
        for (const c of scriptRefs(storyScripts.get(sid)).scripts) queue.push([c, true]);
      }
    };
    for (const e of story.events) if (e.background) runInBackground([e.run], `story event "${e.id}"`, false);
    for (const [id, level] of files) {
      for (const o of level.objects ?? []) {
        if (o?.type === 'event' && o.background === true) runInBackground(scriptRefs(parse(o.run).nodes).scripts, `${levelFile(id)} › event ${o.id}`, true);
      }
    }
    for (const [sid, by] of inBackground) {
      for (const e of backgroundErrors(storyScripts.get(sid))) err(`${scriptAt.get(sid)(e.line)}: ${e.msg} (run in the background by ${some(by)})`);
    }
    for (const [qid, q] of Object.entries(story.quests)) {
      for (const g of q.goals) {
        if (!g.done) continue;
        checkCondition(g.done, 'script', `story: quest "${qid}": goal "${g.text}": done`);
        useCondition(g.done, `story: quest "${qid}" › goal`, 'script');
      }
    }
    for (const v of Object.keys(story.vars)) note(writes, v, 'story "vars"');
    for (const [name, st] of Object.entries(story.starts)) {
      const where = `story: start "${name}"`;
      for (const v of Object.keys(st.vars)) note(writes, v, where);
      for (const it of Object.keys(st.items)) startItems.add(it);
      if (st.level && !baseIds.has(st.level)) warn(`${where}: level "${st.level}" is not a level of the campaign`);
      else if (st.level && st.entrance && !entranceIn(st.level, st.entrance).has.length) warn(`${where}: level "${st.level}" has no entrance "${st.entrance}"`);
      for (const it of Object.keys(st.items)) if (!has(story.items, it)) warn(`${where}: item "${it}" is not declared`);
      for (const [q, stage] of Object.entries(st.quests)) {
        usedQuests.add(q);
        if (!has(story.quests, q)) warn(`${where}: quest "${q}" is not declared`);
        else if (stage !== 'done' && stage !== 'failed' && !story.quests[q].stages.some((x) => x.id === stage)) warn(`${where}: quest "${q}" has no stage "${stage}"`);
      }
    }
  }

  // ---- `once` and `cycle` / `seq` / `pick` keys shared by scripts of different levels or story files ----
  for (const [kind, map] of /** @type {const} */ ([['once', keyUsers.once], ['vary', keyUsers.vary]])) {
    for (const [key, users] of map) {
      if (users.size < 2) continue;
      const list = [...users.values()];
      // (all in one level: its storyIssues reports them)
      if (list.every((u) => u.scope && u.scope === list[0].scope)) continue;
      const wheres = list.map((u) => u.where);
      warn(kind === 'once'
        ? `once key "${key}" is used by ${both(wheres)} — keys are global: the block runs once for all of them together`
        : `"${key}", the key of a cycle / seq / pick, is used by ${both(wheres)} — keys are global: they share one count of turns`);
    }
  }

  // ---- items ----
  for (const [item, where] of itemUses) {
    if (gives.has(item)) continue;
    const taken = takes.get(item);
    warn(`item "${item}" is ${taken ? `taken (${some(taken)})` : `used (${some(where)})`} but never given: no script gives it`);
  }

  // ---- flags and variables: read but never written, written but never read ----
  for (const [flag, where] of reads) {
    if (!writes.has(flag)) warn(`story flag "${flag}" (read by ${some(where)}) is never set: no villager's "flag", script "set" / "var", campaign "flags" or story "vars" sets it`);
  }
  for (const [flag, where] of writes) if (!reads.has(flag)) info(`story flag "${flag}" is set (${some(where)}) but nothing reads it`);

  // ---- every level reachable from the start (exits of every chapter and script travels count; flags ignored) ----
  for (const [id, d] of levelData) for (const t of d.travels) if (baseIds.has(t.level)) graph.get(out.levels.get(id).base)?.add(t.level);
  const roots = [campaign.start.level, ...[...storyTravels].filter((t) => baseIds.has(t))];
  const seen = new Set(roots);
  const queue = [...seen];
  for (let h = 0; h < queue.length; h++) for (const n of graph.get(queue[h]) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  for (const b of baseIds) if (!seen.has(b)) warn(`level "${b}" cannot be reached from the start level "${campaign.start.level}" through any exit${storyScripts.size ? ' or story travel' : ''}`);
  for (const b of baseIds) if (b !== campaign.start.level && !(graph.get(b)?.size)) info(`level "${b}" has no exit (a dead end)`);

  // ---- the story's reach: a fixpoint of the levels the player can get to and the flags set there ----
  /** flags / variables that can be set: the start's, the story's (its scripts run anywhere) … */
  const S = new Set([...campaign.flags, ...storyWrites]);
  if (story) for (const [v, n] of Object.entries(story.vars)) if (n) S.add(v);
  /** variant file → the chapters that play it */
  const chaptersOf = new Map();
  for (const ch of campaign.chapters) for (const v of Object.values(ch.levels)) chaptersOf.set(v, [...(chaptersOf.get(v) ?? []), ch]);
  /** The files of base `b` that can play: itself, and each variant whose chapter could begin. */
  const playable = (b) => levelVariants(campaign, b).filter((f) => f === b || (chaptersOf.get(f) ?? []).some((ch) => fieldCouldHold(ch.when, S)));
  const exitOpen = (o) => fieldCouldHold(o.requires, S) && fieldCouldHold(o.when, S);
  const R = new Set(roots.filter((r) => baseIds.has(r)));
  for (let changed = true; changed;) {
    changed = false;
    const add = (set, v) => { if (!set.has(v)) { set.add(v); changed = true; } };
    for (const b of [...R]) {
      for (const fid of playable(b)) {
        const level = files.get(fid);
        if (!level) continue;
        const d = levelData.get(fid);
        for (const w of d.writes) add(S, w);
        for (const t of d.travels) if (baseIds.has(t.level)) add(R, t.level);
        for (const o of levelExits(level)) {
          const to = text(o.to);
          if (baseIds.has(to) && exitOpen(o)) add(R, to);
        }
      }
    }
  }
  for (const b of R) {
    for (const fid of playable(b)) {
      const level = files.get(fid);
      if (!level) continue;
      for (const o of levelExits(level)) {
        const to = text(o.to);
        if (!baseIds.has(to) || exitOpen(o)) continue;
        const need = [...new Set([...missingFlags(condOf(o.requires) ?? flagCondition(''), S), ...missingFlags(condOf(o.when) ?? flagCondition(''), S)])];
        const elsewhere = need.filter((f) => levelWrites.has(f));
        warn(`${levelFile(fid)}: exit ${o.id} (→ ${to}) can never open: it needs ${need.map((f) => `"${f}"`).join(', ') || 'a story condition'}, which nothing the player can reach sets${elsewhere.length ? ` (${elsewhere.map((f) => `"${f}" is set only by ${some(levelWrites.get(f))}`).join('; ')})` : ''}`);
      }
    }
  }
  for (const b of baseIds) if (seen.has(b) && !R.has(b)) warn(`level "${b}" is reached only through exits that can never open (their story conditions need flags nothing reachable sets)`);
  for (const [flag, where] of levelWrites) {
    if (S.has(flag) || !reads.has(flag)) continue;
    warn(`story flag "${flag}" is set only where the player cannot get to (${some(where)}), but ${some(reads.get(flag))} reads it`);
  }

  // ---- declared but never used ----
  if (story) {
    for (const id of Object.keys(story.items)) if (!itemUses.has(id) && !startItems.has(id)) info(`story: item "${id}" is declared but no script or condition uses it`);
    for (const id of Object.keys(story.quests)) if (!usedQuests.has(id)) info(`story: quest "${id}" is declared but no script or condition uses it`);
    const talks = new Set(Object.values(story.actors).map((a) => a.talk));
    const runs = new Set(story.events.map((e) => e.run));
    for (const id of Object.keys(story.scripts)) if (!usedScripts.has(id) && !talks.has(id) && !runs.has(id)) info(`story: script "${id}" is never called, talked or run`);
    for (const [id, a] of Object.entries(story.actors)) {
      if (!usedActors.has(id) && !speakers.has(id.toLowerCase()) && !speakers.has(a.name.toLowerCase())) info(`story: actor "${id}" is declared but no villager is it and no script names it`);
    }
    info(`story: ${plural(storyTexts.length, 'file')}, ${plural(storyScripts.size, 'script')}, ${plural(Object.keys(story.items).length, 'item')}, ${plural(Object.keys(story.quests).length, 'quest')}, ${plural(Object.keys(story.actors).length, 'actor')}, ${plural(story.events.length, 'event')}`);
  }

  info(`${campaign.levels.length} level${campaign.levels.length === 1 ? '' : 's'}, ${files.size} file${files.size === 1 ? '' : 's'}, ${links} exit link${links === 1 ? '' : 's'}, ${campaign.chapters.length} chapter${campaign.chapters.length === 1 ? '' : 's'}`);
  return out;
}

/**
 * Check one seam: placed files that overlap must agree tile by tile, touching ones along the edge.
 * @param {[number, number]} atA
 * @param {Level} LA
 * @param {string} idA
 * @param {[number, number]} atB
 * @param {Level} LB
 * @param {string} idB
 * @param {string} suffix after the pair's name (' (chapter …)' for variants)
 * @param {(m: string) => void} info
 * @param {(m: string) => void} warn
 */
function checkSeam(atA, LA, idA, atB, LB, idB, suffix, info, warn) {
  const x0 = Math.max(atA[0], atB[0]);
  const x1 = Math.min(atA[0] + LA.width, atB[0] + LB.width);
  const z0 = Math.max(atA[1], atB[1]);
  const z1 = Math.min(atA[1] + LA.depth, atB[1] + LB.depth);
  if (x1 < x0 || z1 < z0) return;
  let cells = 0;
  let bad = 0;
  const sample = [];
  if (x1 > x0 && z1 > z0) {
    // overlap: the same ground twice
    for (let z = Math.ceil(z0); z < z1; z++) {
      for (let x = Math.ceil(x0); x < x1; x++) {
        const ia = x - atA[0]; const ja = z - atA[1];
        const ib = x - atB[0]; const jb = z - atB[1];
        if (!Number.isInteger(ia) || !Number.isInteger(ib) || !Number.isInteger(ja) || !Number.isInteger(jb)) continue;
        cells++;
        if (walkTile(LA, ia, ja) !== walkTile(LB, ib, jb) || (walkTile(LA, ia, ja) && heightAt(LA, ia, ja) !== heightAt(LB, ib, jb))) {
          bad++;
          if (sample.length < 4) sample.push(`(${x}, ${z})`);
        }
      }
    }
    info(`seam ${idA} ⟷ ${idB}${suffix}: ${cells} shared tiles, ${bad} disagree`);
    if (bad) warn(`seam ${idA} ⟷ ${idB}${suffix}: ${bad} of ${cells} shared tiles differ in walkability or height (campaign plane ${sample.join(' ')}${bad > sample.length ? ' …' : ''})`);
  } else {
    // touching along a line: the edge tiles on both sides must agree where either is walkable
    const vertical = x1 === x0;
    const n = vertical ? Math.floor(z1) - Math.ceil(z0) : Math.floor(x1) - Math.ceil(x0);
    for (let k = 0; k < n; k++) {
      const s = (vertical ? Math.ceil(z0) : Math.ceil(x0)) + k;
      const [ia, ja, ib, jb] = vertical
        ? (atA[0] < atB[0] ? [LA.width - 1, s - atA[1], 0, s - atB[1]] : [0, s - atA[1], LB.width - 1, s - atB[1]])
        : (atA[1] < atB[1] ? [s - atA[0], LA.depth - 1, s - atB[0], 0] : [s - atA[0], 0, s - atB[0], LB.depth - 1]);
      const wa = walkTile(LA, ia, ja);
      const wb = walkTile(LB, ib, jb);
      if (!wa && !wb) continue;
      cells++;
      if (wa !== wb || Math.abs(heightAt(LA, ia, ja) - heightAt(LB, ib, jb)) > 1) {
        bad++;
        if (sample.length < 4) sample.push(`${vertical ? 'z' : 'x'} ${s}`);
      }
    }
    if (cells) info(`seam ${idA} | ${idB}${suffix}: ${cells} walkable edge tiles, ${bad} without a match`);
    if (bad) warn(`seam ${idA} | ${idB}${suffix}: ${bad} walkable edge tiles meet unwalkable or much higher / lower ground on the other side (${sample.join(', ')}${bad > sample.length ? ' …' : ''})`);
  }
}
