/**
 * The content text players read, extracted from level, campaign and story data and from
 * `loc('<code key>', '…')` calls in code (docs/specs/I18N.md §4.6): what the content tables
 * translate. Node-safe (no DOM, no three.js) — the i18n checker (`tools/check-i18n.mjs`), the
 * translators' worklist (`tools/i18n-worklist.mjs`) and the self-tests import it; the game never
 * does (it only looks text up, ContentText.js).
 *
 * Every entry is one of:
 * - a **unit** `{ key, text, kind, where, field, note }`: prose with the key the data holds for it
 *   (I18N.md §4.2: a GUID in `textKeys`, a script line's `#line:` tag — `tk`, a banner subtitle's
 *   `tks[1]` —, a story item's, quest's, stage's or goal's built `textKey`), read with the readers
 *   of ContentKeys.js; a unit whose text has no key is listed with `key: ''` (it stays English: the
 *   checker says "no key", `npm run i18n:keys -- --assign` gives it one);
 * - a **term** `{ term: true, text, kind, where, field, note }`: a name, translated by itself.
 *
 * `text` is the English, trimmed; `kind` what it is shown as (ContentText.CONTENT_KINDS); `where` a
 * readable place (`levels/emberfall.json › elder (npc) › dialogue[2]`); `field` the kind of field
 * (`npc.dialogue`, `story.script.say` …); `note` what a translator wants beside it (the speaker,
 * the line before and after, the object type). Pages and script lines are numbered with the
 * runtime's own helpers: `textPages`, `dialogueUnits` (ContentKeys.js) and `scriptTextSlots`
 * (StoryScript.js); a blank page or slot keeps its index and is not listed.
 *
 * What is extracted (I18N.md §4.6):
 * - **a level**: its `name` (term), `subtitle` and, for a single level, `environment.title.*` (a
 *   campaign shows the campaign's title screen, so a campaign's level files' titles are left out);
 * - **level objects** (the catalog fields flagged `i18n: true`): house / well / signpost `text[i]`,
 *   the sign's `speaker` (term), a villager's `name` (term), `title`, `dialogue[i]` and
 *   `dialogue[i].choices[j]`, `talk#n` and — when a conversation offers it (the shop action, a
 *   `shop` command in its talk script) — `item` (term); a region's `name` (term), `sub` and
 *   `banner`; in a campaign's level files an exit's `label` (`mode: use`; not a built-in verb —
 *   Enter, Look … are UI strings) and `locked[i]` (with `requires`); an event's `label` (used with
 *   Space; not a built-in verb) and `run#n`; enemy and waystone names (terms);
 * - **a campaign**: `name` (term), `subtitle`, `title.*`, chapter titles and subtitles;
 * - **story files**: item, quest and actor names (terms), item and quest texts, stage texts, goals,
 *   and every script's text slots; the speakers of `say` lines as resolved (terms; a bark shows no
 *   name);
 * - **the names a script shows** (terms, `storyNames`): the item a `give` / `take` hands over (the
 *   story's name for it, else `titleCase(id)`) and the quest a `quest` command names (the story's
 *   title, else the title a `quest … start` gives, else `titleCase(id)`), as StoryRunner shows them;
 * - **code**: every `loc('<code key>', '<English>'[, kind])` call (`scanLocCalls`), and the common
 *   terms (`COMMON_TERMS`, with the shipped levels' names: `commonTerms`).
 *
 * Left out, because the game never shows them: exits on a single level (the game reads exits only
 * in a campaign), a walked exit's prompt, the locked text of an exit with no `requires`, the prompt
 * of an event not used with Space, an item no conversation offers, dialogue a talk script, the
 * actor's talk or a hand-written conversation replaces (`SHADOWING_SCRIPTS`) — except where the
 * talk runs `builtin shopkeeper` (or, on a peaceful level, `builtin drillmaster`), which plays the
 * villager's pages —; on a combat level the drillmaster's pages, the shopkeeper's `item` and its
 * pages with choices (the combat shop shows its plain pages only).
 * Identities that are no names shown are never extracted (I18N.md §4.5): ids, flags, conditions,
 * entrance / marker / house names, `to`, `actor`, item / quest / script ids, a level's
 * `description` and `author`.
 */
import { parseScript, walkNodes, hasScript, scriptTextSlots, titleCase } from '../level/StoryScript.js';
import { OBJECT_TYPES, levelHasCombat, levelHasStory } from '../level/ObjectCatalog.js';
import { ownValue } from '../utils/own.js';
import {
  textKeyOf, pageKeyOf, dialogueKeyOf, choiceKeyOf, isGuid, isTextKey, textPages, dialogueUnits, isCodeKey, builtinLabel,
} from './ContentKeys.js';
import { CONTENT_KINDS } from './ContentText.js';

/**
 * @import { ScriptNode, TextSlot } from '../level/StoryScript.js'
 * @import { FieldDef, ObjectTypeDef } from '../level/types.js'
 */

/**
 * @typedef {{ type?: string, speaker?: string, prev?: string, next?: string }} ContentNote
 * @typedef {{ key?: string, term?: true, text: string, kind: string, where: string, field: string, note?: ContentNote }} ContentString
 *   a unit (`key`: the key the data holds for it, '' when its text has none) or a term (`term:
 *   true`; no key: a name is its own key).
 */

/**
 * Hand-written conversations (src/game/dialogue.js `CONVERSATIONS`) that replace a villager's own
 * dialogue pages on every level. `drillmaster` (on a peaceful level) and `shopkeeper` (always)
 * play the pages, so their villagers' pages are extracted — on a combat level
 * (`levelHasCombat`) the drillmaster's pages are not (it speaks its own lines there), nor the
 * shopkeeper's `item` (it sells the combat wares), nor its pages with choices (the combat shop
 * shows its plain pages). A talk script that runs one of them (`builtin shopkeeper`, `builtin
 * drillmaster`) plays the pages the same way.
 */
export const SHADOWING_SCRIPTS = Object.freeze(['elder', 'innkeeper', 'merchant', 'guard', 'farmer', 'child', 'bard', 'scholar']);

/**
 * The common terms the catalog and boot write into data as names (I18N.md §4.1, §4.8): the
 * `common` table holds them, and no other table repeats them. The shipped levels' names are common
 * terms too: `commonTerms(SHIPPED_LEVELS)` adds them (the tools read `SHIPPED_LEVELS` from
 * src/game/levels.js of the tree they check). A shop villager without an `item` offers 'Crisp
 * Apple', shown as the UI's default (`t('game.default.item')`); only a story's journal names it,
 * so it is a term of the level whose story keeps it (`objectStrings`), not of `common`.
 * @type {readonly ContentString[]}
 */
export const COMMON_TERMS = Object.freeze([
  commonTerm('Signpost', 'speaker', 'default.signpost.speaker', 'catalog default: a signpost\'s speaker (ObjectCatalog.js; the game shows it for a blank one)'),
  commonTerm('Villager', 'name', 'default.npc.name', 'catalog default: a villager\'s name (ObjectCatalog.js; the game shows it for a blank one)'),
  commonTerm('Waystone', 'name', 'default.waystone.name', 'catalog default: a waystone\'s name (ObjectCatalog.js; the game shows it for a blank one)'),
  commonTerm('Untitled', 'name', 'default.level.name', 'default: the name of a level without one (src/main.js, LevelFormat.js)'),
  commonTerm('Untitled campaign', 'name', 'default.campaign.name', 'default: the name of a campaign without one (src/game/campaign/CampaignFormat.js)'),
]);

/**
 * A frozen common term.
 * @param {string} text
 * @param {string} kind
 * @param {string} field
 * @param {string} where
 * @returns {ContentString}
 */
function commonTerm(text, kind, field, where) {
  return Object.freeze({ term: true, text, kind, field, where, note: Object.freeze({}) });
}

/**
 * Every common term: the shipped levels' names (the title screen's destinations, `SHIPPED_LEVELS`
 * of src/game/levels.js) and `COMMON_TERMS`.
 * @param {readonly { value: string, label: string }[]} [shipped]
 * @returns {ContentString[]}
 */
export function commonTerms(shipped = []) {
  /** @type {ContentString[]} */
  const out = [];
  for (const l of Array.isArray(shipped) ? shipped : []) {
    const text = typeof l?.label === 'string' ? l.label.trim() : '';
    if (text) out.push({ term: true, text, kind: 'name', field: 'code.shippedLevel', where: `src/game/levels.js › SHIPPED_LEVELS › ${l.value}`, note: {} });
  }
  for (const e of COMMON_TERMS) out.push({ ...e, note: {} });
  return out;
}

/**
 * The flagged catalog fields (`<type>.<key>`) shown as names: terms, with the kind they are shown
 * as. Every other flagged field is prose: units.
 */
const TERM_FIELDS = Object.freeze({
  'signpost.speaker': 'speaker',
  'npc.name': 'name',
  'npc.item': 'name',
  'region.name': 'name',
  'enemy.name': 'name',
  'waystone.name': 'name',
});

/** The kind of each flagged prose field of the `text` widget (`<type>.<key>`); default 'line'. */
const UNIT_KINDS = Object.freeze({
  'npc.title': 'title',
  'region.sub': 'title',
  'region.banner': 'title',
  'exit.label': 'label',
  'event.label': 'label',
});

/** Longest text kept in a note (the line before / after). */
const NOTE_MAX = 140;
const short = (s) => (typeof s === 'string' && s.length > NOTE_MAX ? `${s.slice(0, NOTE_MAX - 1)}…` : s);
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** An own field of untrusted data (a dotted path), or undefined. */
function own(o, key) {
  let v = o;
  for (const k of key.split('.')) {
    if (!isPlain(v) && !Array.isArray(v)) return undefined;
    v = ownValue(/** @type {object} */ (v), k);
  }
  return v;
}
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * A collector of units and terms: each keeps non-blank text (trimmed); a unit whose text has no
 * key is listed with `key: ''` (it stays English; the checker says so). A unit in a run of lines (a
 * dialogue, a script) is linked to the one before it (`note.prev` / `note.next`) when `chain` is
 * set.
 */
function collector() {
  /** @type {ContentString[]} */
  const out = [];
  /** @type {ContentString|null} */
  let last = null;
  return {
    out,
    /**
     * @param {string} key
     * @param {unknown} text
     * @param {string} kind
     * @param {string} field
     * @param {string} where
     * @param {ContentNote} [note]
     * @param {boolean} [chain] part of a run of lines (a script, a dialogue)
     * @returns {ContentString|null}
     */
    unit(key, text, kind, field, where, note = {}, chain = false) {
      if (typeof text !== 'string') return null;
      const t = text.trim();
      if (!t) return null;
      /** @type {ContentString} */
      const e = { key: isTextKey(key) ? key : '', text: t, kind, where, field, note: { ...note } };
      if (chain) {
        if (last) { e.note.prev = short(last.text); last.note.next = short(t); }
        last = e;
      }
      out.push(e);
      return e;
    },
    /**
     * @param {unknown} text
     * @param {string} kind
     * @param {string} field
     * @param {string} where
     * @param {ContentNote} [note]
     * @returns {ContentString|null}
     */
    term(text, kind, field, where, note = {}) {
      if (typeof text !== 'string') return null;
      const t = text.trim();
      if (!t) return null;
      /** @type {ContentString} */
      const e = { term: true, text: t, kind, where, field, note: { ...note } };
      out.push(e);
      return e;
    },
    /** End a run of lines. */
    cut() { last = null; },
  };
}

/**
 * Resolve a speaker written in a script to the name the game shows: the speaker `player` as a
 * campaign's hero (campaign.json `player.name`), a villager of the given levels by id, actor or
 * name, or an actor of the story by id or name (case-insensitive, as `StoryRunner._speaker`); null
 * when nothing matches (the game then shows it as written).
 * @param {{ objects?: any[] }[]} levels
 * @param {{ actors?: Record<string, { name?: string }> }|null} [story]
 * @param {string} [hero] a campaign's `player.name` ('' or absent: `player` is shown as written)
 * @returns {(written: string) => string|null}
 */
export function speakerResolver(levels, story = null, hero = '') {
  /** @type {Map<string, string>} */
  const names = new Map();
  if (typeof hero === 'string' && hero.trim()) names.set('player', hero.trim());
  const put = (k, name) => { if (typeof k === 'string' && k.trim() && typeof name === 'string' && name.trim() && !names.has(k.trim().toLowerCase())) names.set(k.trim().toLowerCase(), name.trim()); };
  for (const L of levels) {
    for (const o of Array.isArray(L?.objects) ? L.objects : []) {
      if (!isPlain(o) || o.type !== 'npc') continue;
      const name = str(o.name) || 'Villager';
      put(o.id, name);
      put(o.actor, name);
      put(o.name, name);
    }
  }
  for (const [id, a] of Object.entries(isPlain(story?.actors) ? story.actors : {})) {
    put(id, a?.name);
    put(a?.name, a?.name);
  }
  return (written) => names.get(String(written).trim().toLowerCase()) ?? null;
}

/**
 * Does a script (a field's lines or text) use the command `op` anywhere (`shop` in a talk script)?
 * @param {unknown} source
 * @param {string} op
 */
export function scriptUses(source, op) {
  if (!hasScript(source)) return false;
  let found = false;
  walkNodes(parseScript(source).nodes, (n) => { if (n.t === 'cmd' && n.op === op) found = true; });
  return found;
}

/**
 * The built-in conversations a script runs (`builtin <name>` anywhere in it).
 * @param {unknown} source
 * @returns {Set<string>}
 */
export function scriptBuiltins(source) {
  /** @type {Set<string>} */
  const out = new Set();
  if (!hasScript(source)) return out;
  walkNodes(parseScript(source).nodes, (n) => { if (n.t === 'cmd' && n.op === 'builtin' && typeof n.args?.script === 'string') out.add(n.args.script); });
  return out;
}

/**
 * The names a story context shows for the items and quests its scripts name (StoryRunner
 * `itemName` / `questTitle`, shown as terms): an item by the story's name for it, else
 * `titleCase(id)`; a quest by the story's title, else by the title a `quest <id> start <title>`
 * gives (somewhere in the context's scripts), else `titleCase(id)`. A context is a single level (its
 * talk and run scripts) or a campaign (every level file's scripts and the story's).
 * @typedef {{ item: (id: string) => string, quest: (id: string) => string|null }} StoryNames
 *   `quest`: the title shown for a quest a script names — null when a `quest … start <title>` of the
 *   context gives it (that line lists its own title)
 */

/**
 * The names of a story context (`StoryNames`).
 * @param {{ items?: Record<string, { name?: string }>, quests?: Record<string, { title?: string }>, scripts?: Record<string, { lines?: unknown }> }|null} story
 *   the built story (StoryFormat.buildStory), or null
 * @param {unknown[]} [scripts] the context's other scripts (level talk and run fields)
 * @returns {StoryNames}
 */
export function storyNames(story, scripts = []) {
  const items = isPlain(story?.items) ? story.items : null;
  const quests = isPlain(story?.quests) ? story.quests : null;
  /** @type {Set<string>} quests some script starts with a title */
  const titled = new Set();
  const all = [...scripts, ...Object.values(isPlain(story?.scripts) ? story.scripts : {}).map((s) => s?.lines)];
  for (const src of all) {
    if (!hasScript(src)) continue;
    walkNodes(parseScript(src).nodes, (n) => {
      if (n.t === 'cmd' && n.op === 'quest' && n.args?.verb === 'start' && typeof n.args.text === 'string' && n.args.text.trim()) titled.add(n.args.id);
    });
  }
  return {
    item: (id) => str(items ? ownValue(items, id)?.name : '').trim() || titleCase(id),
    quest: (id) => str(quests ? ownValue(quests, id)?.title : '').trim() || (titled.has(id) ? null : titleCase(id)),
  };
}

/**
 * Every script field of a level's objects (talk, run): the scripts of a single-level context.
 * @param {any} level
 * @returns {unknown[]}
 */
function levelScripts(level) {
  const out = [];
  for (const o of Array.isArray(level?.objects) ? level.objects : []) {
    if (!isPlain(o)) continue;
    for (const k of ['talk', 'run']) { const v = ownValue(o, k); if (hasScript(v)) out.push(v); }
  }
  return out;
}

/**
 * The key of a script's text slot: its line's `#line:` tag as the parser sets it — an option's
 * `tk`, a banner's or a title card's `tks` (the title's, the subtitle's `<tag>.2`), any other node's `tk` — or ''.
 * @param {TextSlot} s
 * @returns {string}
 */
export function slotKey(s) {
  const node = /** @type {{ tk?: unknown, tks?: unknown[] }} */ (s.node);
  const k = s.option ? s.option.tk
    : s.node.t === 'cmd' && (s.node.op === 'banner' || s.node.op === 'title') ? (Array.isArray(node.tks) ? node.tks[s.part === 'subtitle' ? 1 : 0] : undefined)
      : node.tk;
  return isTextKey(k) && !isCodeKey(k) ? k : '';
}

/**
 * The text of one script (a talk script, an event's run, a story script): a unit per non-blank
 * text slot (`scriptTextSlots`, keyed by its line's `#line:` tag: `slotKey`), and the names it
 * shows as terms — the speaker of a `say` line as resolved (else as written; a bark shows no name),
 * the item of a `give` / `take` and the quest of a `quest` command as the context's `names` give
 * them (`storyNames`).
 * @param {unknown} source the script field (string[] or text)
 * @param {{ where: string, field?: string, self?: string, resolve?: (s: string) => string|null,
 *   line?: (n: number) => string, names?: StoryNames }} o `where`: the place prefix; `self`: the villager talked to
 *   (the speaker of `- text` lines); `resolve`: a speaker → the name shown; `line`: a node's line
 *   number → its place (default `<where>:<n>`); `names`: the context's item and quest names
 *   (default: this script alone, no story)
 * @returns {{ strings: ContentString[], errors: { line: number, msg: string }[] }}
 */
export function scriptStrings(source, o) {
  const { nodes, errors } = parseScript(source);
  const c = collector();
  const at = o.line ?? ((n) => `${o.where}:${n}`);
  const field = o.field ?? 'script';
  const names = o.names ?? storyNames(null, [source]);
  /** The name plate of a `say`. */
  const plate = (speaker) => {
    if (speaker === null) return o.self ?? '';
    if (speaker === '') return '';
    return (o.resolve && o.resolve(speaker)) || speaker;
  };
  /** @type {Map<ScriptNode, TextSlot[]>} the slots of each node, in order */
  const slots = new Map();
  for (const s of scriptTextSlots(nodes)) {
    let l = slots.get(s.node);
    if (!l) slots.set(s.node, (l = []));
    l.push(s);
  }
  walkNodes(nodes, (/** @type {ScriptNode} */ n) => {
    const where = at(n.line);
    const mine = slots.get(n) ?? [];
    const key = slotKey;
    if (n.t === 'say') {
      const who = plate(n.speaker);
      // a speaker written by id ("npc_wren:") shows the villager's name: that name is the term
      if (n.speaker) c.term(who, 'speaker', `${field}.speaker`, where);
      for (const s of mine) c.unit(key(s), s.text, s.kind, `${field}.say`, where, who ? { speaker: who } : {}, true);
    } else if (n.t === 'choice') {
      let q = null;
      for (const s of mine) {
        if (s.part === 'question') q = c.unit(key(s), s.text, s.kind, `${field}.choice`, where, {}, true);
        else c.unit(key(s), s.text, s.kind, `${field}.option`, at(s.option?.line ?? n.line), q ? { prev: short(q.text) } : {});
      }
    } else if (n.t === 'cmd') {
      const a = n.args ?? {};
      switch (n.op) {
        case 'bark': {
          // (a bark shows no name plate: its speaker is no term)
          for (const s of mine) c.unit(key(s), s.text, s.kind, `${field}.bark`, where, { speaker: plate(a.who) || a.who });
          break;
        }
        case 'toast': for (const s of mine) c.unit(key(s), s.text, s.kind, `${field}.toast`, where); break;
        case 'banner': case 'title':
          // (a title card's two texts as a banner's: the title and its subtitle, `<tag>.2`)
          for (const s of mine) {
            const other = s.part === 'title' ? a.subtitle : a.title;
            const nb = typeof other === 'string' && other.trim() ? { [s.part === 'title' ? 'next' : 'prev']: short(other.trim()) } : {};
            c.unit(key(s), s.text, s.kind, `${field}.${n.op}`, where, nb);
          }
          break;
        case 'quest': {
          // the title its toast and the journal show (StoryRunner.questTitle): the story's, else the
          // title a `quest … start` gives (that line lists it), else titleCase(id)
          const title = names.quest(a.id);
          if (title !== null) c.term(title, 'name', `${field}.quest`, where);
          else if (a.verb === 'start') c.term(a.text, 'name', `${field}.quest-start`, where);
          for (const s of mine) c.unit(key(s), s.text, s.kind, `${field}.quest-stage`, where);
          break;
        }
        case 'give': case 'take':
          // the item its toast and the journal show (StoryRunner.itemName); gold is money, no name
          if (typeof a.item === 'string' && a.item !== 'gold') c.term(names.item(a.item), 'name', `${field}.item`, where);
          break;
        case 'ending': for (const s of mine) c.unit(key(s), s.text, s.kind, `${field}.ending`, where); break;
        default: break;
      }
    }
  });
  return { strings: c.out, errors };
}

/**
 * The flagged fields of one level object.
 * @param {any} o
 * @param {string} file
 * @param {ContentString[]} out
 * @param {{ resolve?: (s: string) => string|null, actorTalk?: (actor: string) => unknown, combat?: boolean,
 *   campaign?: boolean, story?: boolean, names?: StoryNames }} ctx
 *   `combat`: the level plays with combat (the combat scripts replace pages and items);
 *   `actorTalk`: a campaign actor's talk script (its lines; null or undefined: the actor has none,
 *   or names a script the story lacks); `campaign`: a campaign's level file (exits are
 *   read only there); `story`: a story runs there (a campaign, a level with a story: what a shop
 *   gives goes into its journal); `names`: the context's item and quest names (`storyNames`)
 */
function objectStrings(o, file, out, ctx) {
  const def = /** @type {ObjectTypeDef|undefined} */ (ownValue(OBJECT_TYPES, o.type));
  if (!def) return;
  const id = o.id;
  const base = `${file} › ${str(id) || '?'} (${o.type})`;
  const c = collector();
  const type = o.type;
  const actor = typeof o.actor === 'string' ? o.actor : '';
  // a villager's conversation (dialogue.js, StoryRunner): its talk script (or its actor's) replaces
  // the pages and the action — unless it runs `builtin shopkeeper` (or, on a peaceful level,
  // `builtin drillmaster`), which plays them; without one a hand-written conversation replaces them
  // (SHADOWING_SCRIPTS; the drillmaster on a combat level); on a combat level the shopkeeper shows
  // its plain pages and sells the combat wares, not its `item`
  const actorTalk = !hasScript(o.talk) && actor ? ctx.actorTalk?.(actor) : undefined;
  const talks = hasScript(o.talk) || (actorTalk !== undefined && actorTalk !== null);
  const talk = hasScript(o.talk) ? o.talk : actorTalk;
  const builtins = type === 'npc' && talks ? scriptBuiltins(talk) : new Set();
  const plays = talks ? builtins.has('shopkeeper') || (!ctx.combat && builtins.has('drillmaster'))
    : !(SHADOWING_SCRIPTS.includes(o.script) || (ctx.combat && o.script === 'drillmaster'));
  const combatShop = !!ctx.combat && (talks ? builtins.has('shopkeeper') : o.script === 'shopkeeper');
  // the item is offered by the talk's `shop` command, or by the shop action of the villager's own conversation
  const offers = type === 'npc' && ((talks && scriptUses(talk, 'shop')) || (o.action === 'shop' && plays && !combatShop));
  // (a blank item: the offer shows the UI's default, but a story keeps what it gives under the
  // identity 'Crisp Apple', and its journal shows that name: a term where a story runs)
  if (offers && ctx.story && !str(o.item).trim()) c.term('Crisp Apple', 'name', 'npc.item', `${base} › item (blank: the journal names it Crisp Apple)`, { type });
  for (const f of /** @type {FieldDef[]} */ (def.fields)) {
    if (!f.i18n) continue;
    const v = own(o, f.key);
    if (v === undefined || v === null || v === '') continue;
    const fk = `${type}.${f.key}`;
    // what the game never shows
    if (type === 'exit' && !ctx.campaign) continue;
    if (fk === 'exit.label' && o.mode !== 'use') continue;
    // (a built-in verb — Enter, Look, Read … — is a UI string: `t('game.prompt.<id>')`)
    if ((fk === 'exit.label' || fk === 'event.label') && builtinLabel(v)) continue;
    if (fk === 'exit.locked' && !str(o.requires).trim()) continue;
    if (fk === 'event.label' && (o.on ?? 'use') !== 'use') continue;
    if (fk === 'npc.item' && !offers) continue;
    if (fk === 'npc.dialogue' && !plays) continue;
    const termKind = ownValue(TERM_FIELDS, fk);
    const speaker = type === 'npc' ? (str(o.name).trim() || 'Villager') : type === 'signpost' ? (str(o.speaker).trim() || 'Signpost') : '';
    const note = { type, ...(speaker && f.type !== 'text' ? { speaker } : {}) };
    const where = `${base} › ${f.key}`;
    if (termKind) { c.term(v, termKind, fk, where, { type }); continue; }
    if (f.type === 'text') c.unit(textKeyOf(o, f.key), v, ownValue(UNIT_KINDS, fk) ?? 'line', fk, where, { type });
    else if (f.type === 'lines') {
      for (const p of textPages(v)) c.unit(pageKeyOf(o, f.key, p.i), p.text, 'line', fk, `${where}[${p.i}]`, note, true);
      c.cut();
    } else if (f.type === 'dialogue') {
      for (const p of dialogueUnits(v)) {
        if (combatShop && p.choices) continue;
        const q = c.unit(dialogueKeyOf(o, p.i), p.text, 'line', fk, `${where}[${p.i}]`, note, true);
        for (const ch of p.choices ?? []) c.unit(choiceKeyOf(o, p.i, ch.j), ch.text, 'choice', `${fk}.choice`, `${where}[${p.i}].choices[${ch.j}]`, { type, ...(q ? { prev: short(q.text) } : {}) });
      }
      c.cut();
    } else if (f.type === 'script') {
      const r = scriptStrings(v, { where, field: fk, self: type === 'npc' ? speaker : undefined, resolve: ctx.resolve, names: ctx.names });
      for (const e of r.strings) { e.note = { type, ...e.note }; c.out.push(e); }
    }
  }
  out.push(...c.out);
}

/**
 * Every unit and term of a level: its name, subtitle and (a single level's) title-screen texts,
 * then each object's flagged fields (catalog order within an object, file order across objects).
 * @param {any} level a parsed level (`parseLevel`'s `level`, or the raw JSON)
 * @param {{ file?: string, campaign?: boolean, resolve?: (s: string) => string|null,
 *   story?: { actors?: Record<string, { name?: string, talk?: string }>, scripts?: Record<string, { lines?: unknown }> }|null,
 *   names?: StoryNames }} [o]
 *   `file`: the place prefix (`levels/emberfall.json`); `campaign`: a campaign's level file
 *   (its title-screen texts are never shown; its exits are); `resolve`: speaker names (default:
 *   this level's villagers and the story's actors); `story`: a campaign's story (a villager whose
 *   actor has a talk script says no dialogue pages); `names`: the item and quest names of the
 *   context (default: this level's scripts and the story, `storyNames`)
 * @returns {ContentString[]}
 */
export function levelStrings(level, o = {}) {
  const file = o.file ?? 'level';
  /** @type {ContentString[]} */
  const out = [];
  if (!isPlain(level)) return out;
  const c = collector();
  c.term(level.name, 'name', 'level.name', `${file} › name`);
  c.unit(textKeyOf(level, 'subtitle'), level.subtitle, 'title', 'level.subtitle', `${file} › subtitle`);
  const title = own(level, 'environment.title');
  if (!o.campaign && isPlain(title)) {
    for (const k of ['title', 'subtitle', 'prompt', 'credit']) c.unit(textKeyOf(level, `title.${k}`), own(title, k), 'title', `level.title.${k}`, `${file} › environment.title.${k}`);
  }
  out.push(...c.out);
  const story = o.story ?? null;
  const resolve = o.resolve ?? speakerResolver([level], story);
  const actors = isPlain(story?.actors) ? story.actors : null;
  const scripts = isPlain(story?.scripts) ? story.scripts : null;
  const talkOf = (a) => str(ownValue(actors, a.trim())?.talk);
  // (an actor's talk script by its id — one the story lacks is none: StoryRunner then plays the villager's own conversation)
  const actorTalk = actors ? (a) => { const t = talkOf(a); const s = t && scripts ? ownValue(scripts, t) : undefined; return s ? (s.lines ?? []) : null; } : undefined;
  const combat = levelHasCombat(level);
  const names = o.names ?? storyNames(story, levelScripts(level));
  for (const obj of Array.isArray(level.objects) ? level.objects : []) {
    if (isPlain(obj)) objectStrings(obj, file, out, { resolve, actorTalk, combat, campaign: !!o.campaign, story: !!o.campaign || levelHasStory(level), names });
  }
  return out;
}

/**
 * Every unit and term of a story (StoryFormat.buildStory's `story`): items, quests, actors, then
 * every script (inline event runs and actor talks included, as `event.<id>` / `actor.<id>`). An
 * item's, quest's, stage's and goal's key is the `textKey` the build gives it from the file's
 * `textKeys`; a script line's its `#line:` tag.
 * @param {any} story
 * @param {{ file?: string, resolve?: (s: string) => string|null, names?: StoryNames }} [o] `file`: the place
 *   prefix of the story folder (`campaigns/ferrymans-lantern/story`); `names`: the context's item
 *   and quest names (default: the story's own, `storyNames`)
 * @returns {ContentString[]}
 */
export function storyStrings(story, o = {}) {
  const dir = o.file ?? 'story';
  /** @type {ContentString[]} */
  const out = [];
  if (!isPlain(story)) return out;
  const resolve = o.resolve ?? speakerResolver([], story);
  const names = o.names ?? storyNames(story);
  const c = collector();
  /** A built item's, quest's, stage's or goal's key (`textKey`), or ''. */
  const builtKey = (x) => { const k = isPlain(x) ? ownValue(x, 'textKey') : undefined; return isGuid(k) ? k : ''; };
  for (const [id, it] of Object.entries(isPlain(story.items) ? story.items : {})) {
    c.term(it?.name, 'name', 'story.item.name', `${dir} › item ${id} › name`);
    c.unit(builtKey(it), it?.text, 'line', 'story.item.text', `${dir} › item ${id} › text`, it?.name ? { prev: short(it.name) } : {});
  }
  for (const [id, q] of Object.entries(isPlain(story.quests) ? story.quests : {})) {
    const prev = q?.title ? { prev: short(q.title) } : {};
    c.term(q?.title, 'name', 'story.quest.title', `${dir} › quest ${id} › title`);
    c.unit(builtKey(q), q?.text, 'line', 'story.quest.text', `${dir} › quest ${id} › text`, prev);
    for (const s of Array.isArray(q?.stages) ? q.stages : []) c.unit(builtKey(s), s?.text, 'line', 'story.quest.stage', `${dir} › quest ${id} › stage ${s?.id}`, prev);
    const goals = Array.isArray(q?.goals) ? q.goals : [];
    for (let k = 0; k < goals.length; k++) c.unit(builtKey(goals[k]), goals[k]?.text, 'line', 'story.quest.goal', `${dir} › quest ${id} › goal[${k}]`, prev);
  }
  for (const [id, a] of Object.entries(isPlain(story.actors) ? story.actors : {})) c.term(a?.name, 'name', 'story.actor.name', `${dir} › actor ${id} › name`);
  out.push(...c.out);
  for (const [id, s] of Object.entries(isPlain(story.scripts) ? story.scripts : {})) {
    const file = str(s?.file) || 'story';
    const first = Number.isFinite(s?.line) ? s.line : 1;
    // a .story file's lines by their line in the file; a .json file's by the script and its line
    const line = file.endsWith('.story') ? (n) => `${dir}/${file}:${first + n - 1} (${id})` : (n) => `${dir}/${file} › script ${id}:${n}`;
    const r = scriptStrings(s?.lines ?? [], { where: `${dir}/${file} › script ${id}`, field: 'story.script', resolve, line, names });
    out.push(...r.strings);
  }
  return out;
}

/**
 * Every unit and term of a campaign: campaign.json's texts (keyed by its `textKeys` and each
 * chapter's), each level file (chapter variants included) and the story.
 * @param {any} campaign the normalised campaign (`normalizeCampaign`)
 * @param {{ id: string, file: string, level: any }[]} levels each level file: `id` its stem (the
 *   level id or the chapter variant's id), `file` its place
 *   (`campaigns/ferrymans-lantern/levels/millbrook.json`)
 * @param {any} [story] the built story (`buildStory`), or null
 * @param {{ file?: string }} [o] `file`: the place prefix of the campaign folder
 * @returns {ContentString[]}
 */
export function campaignStrings(campaign, levels, story = null, o = {}) {
  const dir = o.file ?? 'campaign';
  const c = collector();
  if (isPlain(campaign)) {
    c.term(campaign.name, 'name', 'campaign.name', `${dir}/campaign.json › name`);
    // the hero's name (the speaker `player` of the story's lines: DRAGON_CAMPAIGN.md §5.1)
    if (isPlain(campaign.player)) c.term(campaign.player.name, 'name', 'campaign.player.name', `${dir}/campaign.json › player.name`);
    c.unit(textKeyOf(campaign, 'subtitle'), campaign.subtitle, 'title', 'campaign.subtitle', `${dir}/campaign.json › subtitle`);
    const title = isPlain(campaign.title) ? campaign.title : {};
    for (const k of ['title', 'subtitle', 'prompt', 'credit']) c.unit(textKeyOf(campaign, `title.${k}`), own(title, k), 'title', `campaign.title.${k}`, `${dir}/campaign.json › title.${k}`);
    for (const ch of Array.isArray(campaign.chapters) ? campaign.chapters : []) {
      c.unit(textKeyOf(ch, 'title'), ch?.title, 'title', 'campaign.chapter.title', `${dir}/campaign.json › chapter ${ch?.id} › title`, ch?.subtitle ? { next: short(ch.subtitle) } : {});
      c.unit(textKeyOf(ch, 'subtitle'), ch?.subtitle, 'title', 'campaign.chapter.subtitle', `${dir}/campaign.json › chapter ${ch?.id} › subtitle`, ch?.title ? { prev: short(ch.title) } : {});
    }
  }
  /** @type {ContentString[]} */
  const out = [...c.out];
  const resolve = speakerResolver(levels.map((l) => l.level), story, isPlain(campaign?.player) ? str(campaign.player.name) : '');
  // (one context: a quest a level's talk starts with a title is that title in the story's scripts too)
  const names = storyNames(story, levels.flatMap((l) => levelScripts(l.level)));
  for (const l of levels) out.push(...levelStrings(l.level, { file: l.file, campaign: true, resolve, story, names }));
  if (story) out.push(...storyStrings(story, { file: `${dir}/story`, resolve, names }));
  return out;
}

/**
 * The keys a list of entries holds with two different Englishes (I18N.md §4.7: an error, never a
 * crash): one message per key, with the places.
 * @param {Iterable<ContentString>} strings
 * @returns {{ key: string, texts: string[], where: string[] }[]}
 */
export function keyConflicts(strings) {
  /** @type {Map<string, { texts: string[], where: string[] }>} */
  const seen = new Map();
  /** @type {Set<string>} */
  const bad = new Set();
  for (const e of strings) {
    if (e.term || !e.key) continue;
    const s = seen.get(e.key);
    if (!s) { seen.set(e.key, { texts: [e.text], where: [e.where] }); continue; }
    if (!s.texts.includes(e.text)) { s.texts.push(e.text); s.where.push(e.where); bad.add(e.key); }
  }
  return [...bad].map((key) => ({ key, ...seen.get(key) }));
}

// =================================================================================================
// loc('<code key>', '…') in code
// =================================================================================================

/**
 * A JavaScript token (`lexJs`): an identifier, a string, a template (`exprs`: the tokens of each
 * `${…}`), a number, a regular expression or one punctuation character.
 * @typedef {{ t: 'id'|'str'|'tpl'|'num'|'rx'|'p', v: string, start: number, end: number, line: number, exprs?: JsToken[][] }} JsToken
 */

/** Words after which a `/` starts a regular expression. */
const RX_AFTER = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'instanceof', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'of']);

/**
 * Tokens of JavaScript source (comments and white space dropped): enough to find calls and their
 * arguments, not a parser. Strings and templates come with their cooked value.
 * @param {string} src
 * @param {number} [from]
 * @param {boolean} [inExpr] lex a template's `${…}` (stop at its closing brace)
 * @param {number} [line0]
 * @returns {{ tokens: JsToken[], end: number, line: number }}
 */
export function lexJs(src, from = 0, inExpr = false, line0 = 1) {
  /** @type {JsToken[]} */
  const tokens = [];
  let i = from;
  let line = line0;
  let depth = 0;
  const n = src.length;
  /** The cooked escape at `i` (just after the backslash); returns [text, next index]. */
  const escape = (k) => {
    const ch = src[k];
    switch (ch) {
      case 'n': return ['\n', k + 1];
      case 't': return ['\t', k + 1];
      case 'r': return ['\r', k + 1];
      case 'b': return ['\b', k + 1];
      case 'f': return ['\f', k + 1];
      case 'v': return ['\v', k + 1];
      case '0': return ['\0', k + 1];
      case 'x': return [String.fromCharCode(parseInt(src.slice(k + 1, k + 3), 16) || 0), k + 3];
      case 'u': {
        if (src[k + 1] === '{') {
          const e = src.indexOf('}', k);
          return [String.fromCodePoint(parseInt(src.slice(k + 2, e), 16) || 0), e + 1];
        }
        return [String.fromCharCode(parseInt(src.slice(k + 1, k + 5), 16) || 0), k + 5];
      }
      case '\r': return ['', src[k + 1] === '\n' ? k + 2 : k + 1];
      case '\n': line++; return ['', k + 1];
      default: return [ch ?? '', k + 1];
    }
  };
  const prevSig = () => tokens[tokens.length - 1];
  while (i < n) {
    const ch = src[i];
    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v' || ch === '\uFEFF') { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const stop = e < 0 ? n : e + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') line++;
      i = stop;
      continue;
    }
    const start = i;
    const at = line;
    if (ch === '\'' || ch === '"') {
      let v = '';
      i++;
      while (i < n && src[i] !== ch && src[i] !== '\n') {
        if (src[i] === '\\') { const [s, k] = escape(i + 1); v += s; i = k; } else v += src[i++];
      }
      i++;
      tokens.push({ t: 'str', v, start, end: i, line: at });
      continue;
    }
    if (ch === '`') {
      let v = '';
      /** @type {JsToken[][]} */
      const exprs = [];
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { const [s, k] = escape(i + 1); v += s; i = k; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          const r = lexJs(src, i + 2, true, line);
          exprs.push(r.tokens);
          line = r.line;
          i = r.end + 1;
          v += '${…}';
          continue;
        }
        if (src[i] === '\n') line++;
        v += src[i++];
      }
      i++;
      tokens.push({ t: 'tpl', v, start, end: i, line: at, exprs });
      continue;
    }
    if (/[A-Za-z_$À-￿]/.test(ch)) {
      while (i < n && /[\w$À-￿]/.test(src[i])) i++;
      tokens.push({ t: 'id', v: src.slice(start, i), start, end: i, line: at });
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      while (i < n && /[\w.]/.test(src[i])) i++;
      tokens.push({ t: 'num', v: src.slice(start, i), start, end: i, line: at });
      continue;
    }
    if (ch === '/') {
      const p = prevSig();
      const rx = !p || (p.t === 'p' && !')]}'.includes(p.v)) || (p.t === 'id' && RX_AFTER.has(p.v));
      if (rx) {
        let inClass = false;
        i++;
        while (i < n && src[i] !== '\n') {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) break;
          i++;
        }
        i++;
        while (i < n && /[a-z]/.test(src[i])) i++;
        tokens.push({ t: 'rx', v: src.slice(start, i), start, end: i, line: at });
        continue;
      }
    }
    if (inExpr) {
      if (ch === '{') depth++;
      else if (ch === '}') {
        if (depth === 0) return { tokens, end: i, line };
        depth--;
      }
    }
    tokens.push({ t: 'p', v: ch, start, end: i + 1, line: at });
    i++;
  }
  return { tokens, end: i, line };
}

/**
 * The arguments of a call whose `(` is `tokens[k]`: each argument's tokens, and the index of the
 * closing `)` (-1 when it never closes).
 * @param {JsToken[]} tokens
 * @param {number} k
 */
function callArgs(tokens, k) {
  /** @type {JsToken[][]} */
  const args = [[]];
  let depth = 0;
  for (let j = k + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.t === 'p') {
      if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
      else if (t.v === ')' || t.v === ']' || t.v === '}') {
        if (depth === 0) return { args: args[args.length - 1].length ? args : args.slice(0, -1), close: j };
        depth--;
      } else if (t.v === ',' && depth === 0) { args.push([]); continue; }
    }
    args[args.length - 1].push(t);
  }
  return { args, close: -1 };
}

/** Do the braces of a text pair up (`{gold}`, `${value}`, `{${slot}}`)? @param {string} s */
function bracesBalance(s) {
  let d = 0;
  for (const ch of s) {
    if (ch === '{') d++;
    else if (ch === '}' && --d < 0) return false;
  }
  return d === 0;
}

/** The name of the function a line belongs to (the nearest definition above it), for messages. */
function enclosingNames(src) {
  const lines = src.split('\n');
  const names = [];
  let cur = '';
  const def = /^\s*(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/;
  const decl = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return']);
  for (const l of lines) {
    const m = def.exec(l) ?? decl.exec(l);
    if (m && !KEYWORDS.has(m[1])) cur = m[1];
    names.push(cur);
  }
  return names;
}

/** Is a token a literal string (a quoted string, or a template without `${…}`)? @param {JsToken} x */
const isLit = (x) => x.t === 'str' || (x.t === 'tpl' && !(x.exprs ?? []).length);
/** Is a token a `+`? @param {JsToken|undefined} x */
const isPlus = (x) => !!x && x.t === 'p' && x.v === '+';

/**
 * Every `loc(…)` call of a source file (I18N.md §4.6): the code's units —
 * `loc('<code key>', '<English>'[, kind])`, both literals, the key a code key (`isCodeKey`:
 * `dlg.elder.welcome`) — and the errors:
 * - a code key with an English that is no literal, a template with `${…}`, or a literal joined
 *   with `+` (a sentence in pieces: write one English with `${name}` slots and fill it with
 *   `contentFormat(loc('…', '…'), { name })`); an empty English;
 * - a literal key that is no code key; a key built in code (a template with `${…}`, `+`);
 * - a literal English beside a key that is no literal (a default for blank data is a UI string,
 *   `t()`, I18N.md §4.8);
 * - one key with two different Englishes (in this file; `conflicts: false` leaves that to the
 *   caller — the tools check across files with `keyConflicts`, one error per key);
 * - an English whose braces do not pair up; an unknown literal kind; a call joined with `+` to
 *   more text; a call that never closes.
 * A call whose key and English are both data (`loc(pageKeyOf(sign, 'text', i), line)`,
 * `loc(node.tk, node.text)`) is shown by the key the data holds: it is counted (`data`), not
 * extracted.
 * @param {string} src
 * @param {string} file the place prefix (`src/game/dialogue.js`)
 * @param {{ kinds?: readonly string[], conflicts?: boolean }} [o]
 * @returns {{ strings: ContentString[], errors: { line: number, msg: string }[], data: number, calls: number }}
 */
export function scanLocCalls(src, file, o = {}) {
  const { tokens } = lexJs(String(src));
  const names = enclosingNames(String(src));
  /** @type {{ line: number, msg: string }[]} */
  const errors = [];
  /** @type {ContentString[]} */
  const strings = [];
  /** @type {Map<string, string>} key → its first English */
  const english = new Map();
  let data = 0;
  let calls = 0;
  const kinds = o.kinds ?? CONTENT_KINDS;
  const where = (line) => `${file}:${line}${names[line - 1] ? ` (${names[line - 1]})` : ''}`;
  const clip = (s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);
  /** @param {JsToken[]} list */
  const visit = (list) => {
    for (let k = 0; k < list.length; k++) {
      const t = list[k];
      if (t.t === 'tpl') for (const e of t.exprs ?? []) visit(e);
      if (t.t !== 'id' || t.v !== 'loc') continue;
      const open = list[k + 1];
      if (!open || open.t !== 'p' || open.v !== '(') continue;
      const before = list[k - 1];
      if (before && ((before.t === 'p' && before.v === '.') || (before.t === 'id' && (before.v === 'function' || before.v === 'get' || before.v === 'set')))) continue;
      calls++;
      const { args, close } = callArgs(list, k + 1);
      if (close < 0) { errors.push({ line: t.line, msg: 'loc( never closes' }); continue; }
      if (isPlus(before) || isPlus(list[close + 1])) {
        errors.push({ line: t.line, msg: 'loc(…) joined with + — a sentence in pieces: write one English with ${name} slots and fill it with contentFormat(loc(\'…\', \'…\'), { name })' });
      }
      const [keyArg = [], enArg = [], kindArg] = args;
      if (!keyArg.length || !enArg.length) { errors.push({ line: t.line, msg: 'loc() needs a key and its English: loc(\'<ns>.<name>\', \'English\')' }); continue; }
      let kind = 'line';
      if (kindArg && kindArg.length === 1 && kindArg[0].t === 'str') {
        if (!kinds.includes(kindArg[0].v)) errors.push({ line: t.line, msg: `loc(…, '${kindArg[0].v}'): not a kind (${kinds.join(', ')})` });
        else kind = kindArg[0].v;
      }
      const keyLit = keyArg.length === 1 && isLit(keyArg[0]);
      const enLit = enArg.length === 1 && isLit(enArg[0]);
      const enHasLit = enArg.some(isLit);
      if (!keyLit) {
        if (keyArg.some((x) => x.t === 'tpl' && (x.exprs ?? []).length) || keyArg.some((x, j) => isLit(x) && (isPlus(keyArg[j - 1]) || isPlus(keyArg[j + 1])))) {
          errors.push({ line: t.line, msg: 'loc(<a key built in code>, …): a code key is one literal (\'dlg.elder.welcome\'); a data key is the one the data holds (textKeyOf, pageKeyOf, a script node\'s tk …: ContentKeys.js)' });
        } else if (enHasLit) {
          errors.push({ line: t.line, msg: `loc(${clip(String(src).slice(keyArg[0].start, keyArg[keyArg.length - 1].end))}, '…'): a literal English needs a literal code key — a default for blank data is a UI string (t(), I18N.md §4.8)` });
        } else data++;
        continue;
      }
      const key = keyArg[0].v;
      if (!isCodeKey(key)) { errors.push({ line: t.line, msg: `loc('${clip(key)}', …): not a code key (lower case, no colon, two or more dot-separated parts: 'dlg.elder.welcome')` }); continue; }
      if (!enLit) {
        if (enArg.some((x) => x.t === 'tpl' && (x.exprs ?? []).length)) errors.push({ line: t.line, msg: `loc('${key}', \`…\${…}…\`): a sentence built in code — write the English with \${name} slots in a plain string and fill them with contentFormat(loc('${key}', '…'), { name })` });
        else if (enArg.some((x, j) => isLit(x) && (isPlus(enArg[j - 1]) || isPlus(enArg[j + 1])))) errors.push({ line: t.line, msg: `loc('${key}', '…' + …): a sentence joined with + — write one English with \${name} slots and fill it with contentFormat(loc('${key}', '…'), { name })` });
        else errors.push({ line: t.line, msg: `loc('${key}', ${clip(String(src).slice(enArg[0].start, enArg[enArg.length - 1].end))}): the English of a code key is a literal` });
        continue;
      }
      const text = enArg[0].v;
      if (!text.trim()) { errors.push({ line: t.line, msg: `loc('${key}', ''): an empty English` }); continue; }
      if (!bracesBalance(text)) errors.push({ line: t.line, msg: `loc('${key}', '${clip(text)}'): unbalanced braces { } — a piece of a sentence?` });
      const first = english.get(key);
      if (first === undefined) english.set(key, text.trim());
      else if (first !== text.trim() && o.conflicts !== false) errors.push({ line: t.line, msg: `loc('${key}', …): the key is used with two different Englishes ("${clip(first)}" and "${clip(text.trim())}") — one key, one line` });
      strings.push({ key, text: text.trim(), kind, where: where(enArg[0].line), field: 'code.loc', note: {} });
    }
  };
  visit(tokens);
  return { strings, errors, data, calls };
}

