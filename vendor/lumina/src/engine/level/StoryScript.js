/**
 * The story language of Luminati (docs/specs/STORY_SCRIPT.md): **conditions** (`bridge-mended`,
 * `not refused and item:plank >= 3`, `quest:find-ilse = active`, `hour >= 20 or hour < 6` —
 * StoryCondition.js, re-exported here) and **scripts** — what a villager says and does when talked
 * to (npc `talk`, an actor's `talk`), what an `event` object runs (`run`), and the named scripts of
 * a campaign's story files.
 *
 * A script is a list of text lines (stored as `string[]` in the level / story JSON, the author's
 * text verbatim; a `.story` file holds them as plain text), one command per line, blocks by
 * indentation:
 *
 *     if bridge-mended
 *       Hollis: She'll hold. Off you go.
 *       stop
 *     Hollis: Wren sent you? Bring me three {oak planks}.
 *     choice Give Hollis the planks?
 *       > Not yet
 *         - The river won't wait forever.
 *       > [if item:plank >= 3] Here they are
 *         take plank 3
 *         set bridge-mended
 *
 * What a line is, decided from its first characters: `#` a comment · `>` an option of a choice ·
 * `*` an alternative of `cycle` / `seq` / `pick` · `: text` the narrator · `- text` the speaker of
 * the nearest line of dialogue above · a command word (lower case, then a space or the end) · else
 * `Speaker: text` (the speaker is everything before the first colon, which a space must follow, or
 * a "quoted" name) · anything else is an error, so a misspelt command never turns into dialogue.
 *
 * Node-safe (no DOM, no three.js): the game, the editor, `tools/check-level.mjs` and the campaign
 * generators share it. Untrusted input: nothing is evaluated as code, commands are looked up as own
 * keys of a fixed table, scripts are capped in size and depth, and no pattern backtracks over a
 * line (a hostile script parses in linear time).
 */
import { isOwnKey, toText } from '../utils/own.js';
import { isStoryName, parseCondition, parseRef, plainNumber, isTextRef, scriptLines, conditionRefs, RESERVED_WORDS } from './StoryCondition.js';
import { PRESET_NAMES, CLASS_NAMES, RULE_KEYS, RULE_FIELDS, isPreset, isClass, isRuleField, isRuleValue } from './PartyRules.js';
import { splitLineTag, subtitleKey, LINE_TAG } from '../i18n/ContentKeys.js';

export {
  REF_KINDS, GAME_REFS, RESERVED_WORDS, QUEST_STATES, isTextRef, plainNumber, isStoryName, isFlagName, parseRef, parseCondition,
  isBareName, flagCondition, cachedCondition, cachedScriptCondition, evalCondition, conditionRefs, scriptLines, hasScript, titleCase,
  eventIdOf, stageIdOf,
} from './StoryCondition.js';

/**
 * (The condition types live in StoryCondition.js; these names keep `@import { Cond } from
 * './StoryScript.js'` working.)
 * @typedef {import('./StoryCondition.js').Cond} Cond
 * @typedef {import('./StoryCondition.js').Ref} Ref
 * @typedef {import('./StoryCondition.js').RefKind} RefKind
 * @typedef {import('./StoryCondition.js').Cmp} Cmp
 * @typedef {import('./StoryCondition.js').RefReader} RefReader
 */

// =================================================================================================
// Scripts
// =================================================================================================

/** The most lines one script may have, how deep its blocks may nest, how long one line may be. */
export const SCRIPT_LIMITS = Object.freeze({ lines: 4000, depth: 16, lineLength: 2000 });

/** Facings a `face` / `teleport` command accepts (the sprite's directions). */
export const SCRIPT_FACINGS = /** @type {const} */ (['up', 'down', 'left', 'right']);
/** Emote bubbles (`emote <who> <icon>`) by name; the symbols themselves are accepted too. */
export const EMOTES = Object.freeze({ '!': '!', '?': '?', '...': '…', '…': '…', note: '♪', '♪': '♪', heart: '♥', '♥': '♥', zzz: 'zzz', anger: '#', sweat: '💧', idea: '✦' });
/** Weathers a `weather` command accepts (`frost`: a clear cold sky over settled snow — EVERMERE_CAMPAIGN.md §5.2). */
export const SCRIPT_WEATHERS = /** @type {const} */ (['clear', 'rain', 'snow', 'frost']);
/** Ways a `cycle` / `seq` / `pick` block chooses one of its `*` alternatives. */
export const VARY_MODES = /** @type {const} */ (['cycle', 'seq', 'pick']);
/**
 * Poses a `pose <who> <pose>` plays (set-piece direction, docs/contracts/DRAGON_CAMPAIGN.md §5.5):
 * `victory` a raised weapon, `ready` a combat stance, `none` back to normal.
 */
export const POSE_NAMES = /** @type {const} */ (['cheer', 'dance', 'cower', 'kneel', 'bow', 'victory', 'ready', 'cast', 'none']);
/**
 * Named visual effects an `effect <name> <where>` plays (DRAGON_CAMPAIGN.md §5.5; the runtime's
 * registry: src/game/story/Effects.js): `fireball` falls from the sky and explodes, `roar` is a
 * shockwave of dust and a shake. Nothing is hurt. The last six are The Bells of Evermere's
 * (EVERMERE_CAMPAIGN.md §5.6, owned in ./Owners.js): `toll` a gold sound-ring, `thaw` steam and
 * glints, `petals`, `leaves`, `memory` a white veil of motes, `crows` a burst of crows.
 */
export const EFFECT_NAMES = /** @type {const} */ (['explosion', 'fireball', 'flames', 'smoke', 'holy', 'frost', 'shockwave', 'dust', 'sparkle', 'fireworks', 'embers', 'roar',
  'toll', 'thaw', 'petals', 'leaves', 'memory', 'crows']);
/** Colours of a `flash` (G palette tones; the default first). */
export const FLASH_COLORS = /** @type {const} */ (['white', 'gold', 'red']);
/**
 * The framing words of a `shot` (each followed by its number; `on` by a who, place or x z) and the
 * range each number is clamped to while a story owns the camera (DRAGON_CAMPAIGN.md §5.5): `yaw`
 * degrees (0 from the south looking north, 90 from the east; free), `pitch` degrees, `dist` world
 * units, `fov` degrees, `lift` the look-at point raised (u), `orbit` the yaw turning (degrees per
 * second).
 */
export const SHOT_LIMITS = Object.freeze({
  yaw: Object.freeze([-36000, 36000]),
  pitch: Object.freeze([2, 85]),
  dist: Object.freeze([4, 90]),
  fov: Object.freeze([12, 70]),
  lift: Object.freeze([-10, 30]),
  orbit: Object.freeze([-360, 360]),
});
/** Every word a `shot` takes (`on`, the framing words, `reset`). */
export const SHOT_WORDS = /** @type {const} */ (['on', 'yaw', 'pitch', 'dist', 'fov', 'lift', 'orbit', 'reset']);
/**
 * The words of an `sfx` after its sound (each followed by its number, in any order, each at most
 * once) and the range it is clamped to: `pitch` in semitones (a sound played higher or lower — a
 * far Season Bell on its note of the motif), `pan` its side (−1 left … 1 right).
 */
export const SFX_LIMITS = Object.freeze({
  pitch: Object.freeze([-24, 24]),
  pan: Object.freeze([-1, 1]),
});

/**
 * One command of a parsed script. Every node carries the 1-based `line` it came from.
 * - `say`: a line of dialogue. `speaker`: '' the narrator (no name plate); null the villager
 *   talked to (a `- text` with no line of dialogue above it); else the name written.
 * - `vary`: `cycle` (one alternative after the other, round and round), `seq` (one after the other,
 *   then the last again and again), `pick` (one by the key, the day, the count and the journey's
 *   seed — `varyIndex`). An alternative whose line does not parse is kept empty (its error is
 *   reported), so the others keep their places — and a save's turns their meaning.
 * - `cmd`: a command (`SCRIPT_COMMANDS`) and its arguments, e.g. `bark`: `{ who, text }`.
 * - `tk` / `tks`: the content keys of its texts — the line's `#line:` tag (`parseScript` sets them
 *   on a line that holds text; a banner's or a title card's `tks`: the tag and `<tag>.2`). An untagged line has none.
 * @typedef {{ t: 'say', line: number, speaker: string|null, text: string, tk?: string }
 *   | { t: 'choice', line: number, text: string, options: ChoiceOption[], tk?: string }
 *   | { t: 'if', line: number, branches: { cond: Cond, src: string, body: ScriptNode[] }[], otherwise: ScriptNode[]|null }
 *   | { t: 'loop', line: number, body: ScriptNode[] }
 *   | { t: 'once', line: number, key: string, body: ScriptNode[] }
 *   | { t: 'vary', line: number, mode: 'cycle'|'seq'|'pick', key: string, alts: ScriptNode[][] }
 *   | { t: 'cmd', line: number, op: string, args: Record<string, any>, tk?: string, tks?: [string, string] }} ScriptNode
 */

/**
 * An option of a `choice`: offered while `cond` holds (null: always); `once`: gone after it was
 * picked (keyed by the choice's script and line). `tk`: its label's content key (its line's tag).
 * @typedef {{ line: number, label: string, cond: Cond|null, src: string, once: boolean, body: ScriptNode[], tk?: string }} ChoiceOption
 */

/**
 * The commands: their arguments (for the help and the errors) and what they do.
 * @type {Record<string, { args: string, help: string }>}
 */
export const SCRIPT_COMMANDS = {
  // flow
  if: { args: '<condition>', help: 'the indented block runs when the condition holds (then `elif <condition>` / `else`)' },
  elif: { args: '<condition>', help: 'after an if: the next condition to try' },
  else: { args: '', help: 'after an if: the block when nothing before held' },
  choice: { args: '[question]', help: 'offer the indented `> label` options (`> [if c]`, `> [once]`); the picked option\'s block runs' },
  loop: { args: '', help: 'repeat the indented block until `break` (or `stop`)' },
  break: { args: '', help: 'leave the innermost loop' },
  once: { args: '<key>', help: 'the indented block runs only the first time (the key is remembered in the save)' },
  cycle: { args: '<key>', help: 'one `*` alternative each time, in turn, round and round' },
  seq: { args: '<key>', help: 'one `*` alternative each time, in turn, then the last one again and again' },
  pick: { args: '<key>', help: 'one `*` alternative, picked at random — per journey: a reload plays the same one' },
  stop: { args: '', help: 'end the script' },
  call: { args: '<script>', help: 'run a named script of the campaign\'s story files, then go on' },
  wait: { args: '<seconds> | <who> | thaw', help: 'pause, or wait until an actor ends a walk started with `nowait`, or (`wait thaw`) until the running thaw front has crossed the level' },
  // state
  set: { args: '<flag>', help: 'set a story flag (its value becomes 1)' },
  clear: { args: '<flag>', help: 'clear a story flag / variable (0)' },
  var: { args: '<name> = | + | - <number>', help: 'set, raise or lower a story variable' },
  give: { args: '<item> [count]', help: 'give the player an item (`gold` is money)' },
  take: { args: '<item> [count]', help: 'take an item from the player (at most as many as they have)' },
  quest: { args: '<id> start [title] | stage <stage> [text] | done | fail', help: 'start, advance, finish or fail a quest (the journal, B)' },
  // world (objects come and go with flags: `set bridge-built` and the bridge's `when: bridge-built`)
  home: { args: '<who> [x z]', help: 'where a villager stays from now on (default: where they stand; remembered for the level)' },
  time: { args: '<hour> | <hh:mm> [seconds]', help: 'set the time of day; with seconds the shown hour glides there (on a level with a fixed hour too) and the script waits' },
  weather: { args: 'clear | rain | snow | frost', help: 'change the weather (frost: a clear, cold sky over settled snow)' },
  travel: { args: '<level> [entrance]', help: 'campaigns: go to another level (the script goes on there)' },
  rest: { args: '', help: 'sleep until morning (the inn\'s fade; a new day)' },
  heal: { args: '', help: 'combat levels: restore the player\'s health and mana' },
  shop: { args: '', help: 'the talking villager\'s built-in shop' },
  builtin: { args: '<conversation>', help: 'play a hand-written conversation of the game (src/game/dialogue.js)' },
  ending: { args: '<id> [title]', help: 'the story ends: an end card, then the title screen (the save remembers the ending)' },
  // staging (`<who>`: player, a villager's id, actor or name — a name with spaces "in quotes")
  cutscene: { args: '', help: 'letterbox, no HUD, skippable (hold Esc) until the script ends' },
  walk: { args: '<who> <x> <z> | <who> <place> [run] [nowait]', help: 'walk an actor there on the walk grid; waits unless `nowait`' },
  face: { args: '<who> up | down | left | right | <who> <place>', help: 'turn an actor (towards an actor, marker, entrance or object)' },
  emote: { args: '<who> ! | ? | ... | note | heart | zzz | anger | sweat | idea [seconds]', help: 'a bubble over an actor' },
  bark: { args: '<who> <text>', help: 'a short speech bubble over an actor (the rest of the line; `${…}` and {gold} as in dialogue) — holds nobody, so it suits background events' },
  // the party (docs/specs/PARTY.md §7)
  party: {
    args: 'join <who> [as <class>] [<preset>] | leave <who> | rule <who> <preset> | set <who> <field> <value> | menu [<who>]',
    help: 'the player\'s party: a villager here joins (`party join sela as warden guardian` — classes warden, ranger, mystic, cleric, icemage, greatshield; presets balanced, aggressive, guardian, support, hunter, passive) or a member leaves; a member\'s combat rule becomes a preset, or one field changes (`party set sela heal often`); `menu` opens the tactics panel and waits until it closes. Conditions read `party` (how many members) and `party:sela`',
  },
  teleport: { args: '<who> <x> <z> | <who> <place> [facing]', help: 'put an actor somewhere at once' },
  camera: { args: '<who> [seconds] | <x> <z> [seconds] | reset [seconds]', help: 'look at an actor, an object or a point (until `camera reset` or the script ends)' },
  shake: { args: '[amount]', help: 'shake the camera' },
  fade: { args: 'out [seconds] [white] | in [seconds]', help: 'fade the screen to black (or to white) and back' },
  // set-piece direction (built for Vanquish the Evil Dragon: docs/contracts/DRAGON_CAMPAIGN.md §5.5)
  shot: {
    args: '[on <who> | on <x> <z>] [yaw <deg>] [pitch <deg>] [dist <u>] [fov <deg>] [lift <u>] [orbit <deg/s>] [seconds] [nowait] | reset [seconds]',
    help: 'frame the camera: the words in any order, each optional (what is left out stays); the last number is the move\'s length (0, the default: a cut) — a move waits until the camera is there unless `nowait`; yaw 0 looks north from the south, 90 from the east; orbit turns the yaw on and on; `shot reset` eases back to the game\'s framing (the end of the script does too)',
  },
  slowmo: { args: '<scale 0.1–1> [seconds]', help: 'the whole game\'s time slows (eased over the seconds); back to 1 at the end of the script' },
  flash: { args: '[white | gold | red] [seconds] [hold]', help: 'a full-screen flash (default white, 0.35 s); `hold` keeps the colour up (coming in over the seconds) until the next flash fades it back — a memory over white' },
  pose: { args: '<who> cheer | dance | cower | kneel | bow | victory | ready | cast | none [seconds]', help: 'an actor plays a pose (none: back to normal); does not wait' },
  effect: {
    args: '<name> <who> | <name> <x> <z> [scale]',
    help: 'a visual effect there, with its sound — explosion, fireball, flames, smoke, holy, frost, shockwave, dust, sparkle, fireworks, embers, roar, toll, thaw, petals, leaves, memory, crows; does not wait, hurts nobody',
  },
  // the frozen year (built for The Bells of Evermere: docs/contracts/EVERMERE_CAMPAIGN.md §5.6)
  thaw: {
    args: '[<who> | <place> | <x> <z>] [seconds]',
    help: 'the thaw front rolls out from there (default: the frost\'s "at") across the level in about the seconds (default by its size, 10–13); the level stays thawed if its frost\'s "until" holds. Does not wait (`wait thaw` does)',
  },
  toll: { args: '<belfry or chime id> [strength]', help: 'ring that bell: it swings and tolls on its own note — a belfry by its kind, a chime by its place among the level\'s chimes (strength 0.1–2, default 1); does not wait' },
  // feedback
  banner: { args: '<title> [| subtitle]', help: 'the big title banner' },
  title: { args: '<text> [| subtitle]', help: 'a cinematic title card in the middle of the screen; waits until it is gone (about 4 s)' },
  toast: { args: '<text>', help: 'a short message at the top' },
  sfx: { args: '<sound> [pitch <semitones>] [pan <-1–1>]', help: 'play a sound effect — higher or lower by semitones (−24–24), from a side (−1 left … 1 right)' },
  music: { args: '<track> | on | off', help: 'change, start or stop the music' },
};

/** Commands that hold an indented block. */
const BLOCK_COMMANDS = new Set(['if', 'elif', 'else', 'choice', 'loop', 'once', 'cycle', 'seq', 'pick']);

/** The longest "quoted" name a command takes as `<who>` / `<place>` (a villager's display name). */
const MAX_QUOTED_NAME = 60;

/**
 * A script line split into its indentation and text (a tab counts as two spaces); `tab` / `space`:
 * whether its indentation holds a tab / a space.
 * @param {string} raw
 */
function splitIndent(raw) {
  let indent = 0;
  let k = 0;
  let tab = false;
  let space = false;
  for (; k < raw.length; k++) {
    if (raw[k] === ' ') { indent++; space = true; } else if (raw[k] === '\t') { indent += 2; tab = true; } else break;
  }
  // (trimEnd, not .replace(/\s+$/): that pattern backtracks over every run of inner spaces)
  return { indent, text: raw.slice(k).trimEnd(), tab, space };
}

/**
 * Words of an argument list; `"quoted text"` is one word (\" for a quote); `quoted`: it was;
 * `end`: where the word ends in `s` (after its closing quote).
 * @param {string} s
 * @returns {{ text: string, quoted: boolean, end: number }[]}
 */
function splitWords(s) {
  const out = [];
  let k = 0;
  while (k < s.length) {
    while (s[k] === ' ' || s[k] === '\t') k++;
    if (k >= s.length) break;
    if (s[k] === '"') {
      let w = '';
      k++;
      while (k < s.length && s[k] !== '"') {
        if (s[k] === '\\' && k + 1 < s.length) { w += s[k + 1]; k += 2; continue; }
        w += s[k++];
      }
      k = Math.min(k + 1, s.length);
      out.push({ text: w, quoted: true, end: k });
    } else {
      let w = '';
      while (k < s.length && s[k] !== ' ' && s[k] !== '\t') w += s[k++];
      out.push({ text: w, quoted: false, end: k });
    }
  }
  return out;
}

/**
 * Words of an argument list; `"quoted text"` is one word (\" for a quote).
 * @param {string} s
 * @returns {string[]}
 */
export function splitArgs(s) {
  return splitWords(s).map((w) => w.text);
}

/** A finite number from a word, else NaN. @param {string|undefined} w */
const num = (w) => plainNumber(w);

/** The text after the first `n` words of `rest` (trimmed), '' when there is none. */
function textAfter(rest, n) {
  let s = rest.trim();
  for (let k = 0; k < n; k++) {
    const m = /^\S+\s*/.exec(s);
    if (!m) return '';
    s = s.slice(m[0].length);
  }
  return s.trim();
}

/**
 * Text of a line: `\n` is a line break (the dialog box shows it), `\\` a backslash. Backslashes
 * just before a `$` are left as written: they are `interpolate`'s (`\$` a dollar sign that begins
 * no value, `\\` there a backslash), which reads every text — so `\\${gold}` still shows a
 * backslash and the value, and `\${gold}` shows `${gold}`. Any other `\x` stays as written.
 * (One pass over runs of backslashes: nothing backtracks.)
 * @param {string} s
 */
function lineText(s) {
  if (!s.includes('\\')) return s;
  return s.replace(/(\\+)(n?)/g, (all, bs, n, at, str) => {
    if (!n && str[at + all.length] === '$') return all;
    const half = '\\'.repeat(bs.length >> 1);
    if (bs.length % 2 === 0) return half + n;
    return half + (n ? '\n' : '\\');
  });
}

/**
 * Read one command's arguments.
 * @param {string} op
 * @param {string} rest the text after the command word
 * @returns {Record<string, any>}
 */
function commandArgs(op, rest) {
  const W = splitWords(rest);
  const w = W.map((x) => x.text);
  const name = (v, what) => {
    if (v === undefined || v === '') throw new Error(`${what} is missing`);
    if (!isStoryName(v)) throw new Error(`"${v}" is not a ${what} (letters, digits, _ . -)`);
    return v;
  };
  /** An actor or a place: a name, or a "quoted" display name (`walk "Elder Wren" well`). */
  const who = (k, what) => {
    const x = W[k];
    if (x?.quoted) {
      const t = x.text.trim();
      if (!t || t.length > MAX_QUOTED_NAME) throw new Error(`"${x.text}" is not a ${what} (a quoted name has 1–${MAX_QUOTED_NAME} characters)`);
      return t;
    }
    return name(x?.text, what);
  };
  /** A word that is a plain number (not quoted). */
  const isNum = (k) => !!W[k] && !W[k].quoted && Number.isFinite(num(W[k].text));
  /** A word that is one of the given keywords (not quoted). */
  const isWord = (k, ...words) => !!W[k] && !W[k].quoted && words.includes(W[k].text);
  const flag = (v, what) => {
    name(v, what);
    if (RESERVED_WORDS.has(v.toLowerCase())) throw new Error(`"${v}" is a reserved word, not a ${what}`);
    return v;
  };
  const count = (v, what) => {
    if (v === undefined) return 1;
    const n = num(v);
    if (!Number.isInteger(n) || n < 1 || n > 1e6) throw new Error(`${what} must be a whole number from 1`);
    return n;
  };
  const seconds = (v, def) => {
    if (v === undefined) return def;
    const n = num(v);
    if (!(n >= 0 && n <= 600)) throw new Error(`"${v}" is not a time in seconds`);
    return n;
  };
  const none = () => {
    if (w.length) throw new Error(`"${op}" takes nothing after it`);
    return {};
  };
  switch (op) {
    case 'break': case 'stop': case 'rest': case 'heal': case 'shop': case 'cutscene': case 'else': case 'loop':
      return none();
    case 'once': case 'cycle': case 'seq': case 'pick':
      if (w.length !== 1) throw new Error(`${op} <key> (a name the save remembers it by)`);
      return { key: name(w[0], 'key') };
    case 'call': case 'builtin': {
      const what = op === 'call' ? 'script name' : 'conversation name';
      if (w.length > 1) throw new Error(`${op} takes one ${what} — nothing after it`);
      return { script: name(w[0], what) };
    }
    case 'wait': {
      if (w.length !== 1) throw new Error('wait <seconds> | <who> | thaw');
      if (isNum(0)) return { seconds: seconds(w[0], 1) };
      if (isWord(0, 'thaw')) return { thaw: true };
      return { who: who(0, 'actor') };
    }
    case 'set': case 'clear':
      if (w.length !== 1) throw new Error(`${op} <flag>`);
      return { name: flag(w[0], 'flag name') };
    case 'var': {
      if (w.length !== 3) throw new Error('var <name> = | + | - <number>');
      const by = ownOp(w[1]);
      if (!by) throw new Error(`"${w[1]}" is not = + or -`);
      const n = num(w[2]);
      if (!Number.isFinite(n) || Math.abs(n) > 1e9) throw new Error(`"${w[2]}" is not a number`);
      return { name: flag(w[0], 'variable name'), by, value: n };
    }
    case 'give': case 'take':
      if (w.length < 1 || w.length > 2) throw new Error(`${op} <item> [count]`);
      return { item: name(w[0], 'item id'), count: count(w[1], 'the count') };
    case 'quest': {
      const id = name(w[0], 'quest id');
      const verb = w[1];
      if (verb === 'start') return { id, verb, text: lineText(textAfter(rest, 2)) };
      if (verb === 'stage') return { id, verb, stage: name(w[2], 'stage name'), text: lineText(textAfter(rest, 3)) };
      if (verb === 'done' || verb === 'fail') {
        if (w.length > 2) throw new Error(`quest <id> ${verb} takes nothing after it`);
        return { id, verb };
      }
      throw new Error('quest <id> start [title] | stage <stage> [text] | done | fail');
    }
    case 'home': {
      const actor = who(0, 'actor');
      if (w.length === 1) return { who: actor };
      if (w.length !== 3 || !isNum(1) || !isNum(2)) throw new Error('home <who> [x z]');
      return { who: actor, x: num(w[1]), z: num(w[2]) };
    }
    case 'time': {
      // hh:mm — minutes 00–59 (`12:75` is no time)
      const hm = /^(\d{1,2}):([0-5]\d)$/.exec(w[0] ?? '');
      const h = hm ? Number(hm[1]) + Number(hm[2]) / 60 : num(w[0]);
      if (w.length < 1 || w.length > 2 || !(h >= 0 && h <= 24)) throw new Error('time <hour 0–24> | <hh:mm> (minutes 00–59) [seconds]');
      if (w.length === 2 && !isNum(1)) throw new Error(`time <hour> [seconds]: "${w[1]}" is not a time in seconds`);
      // (`seconds` only when given: a plain `time`'s arguments are what they always were)
      return w.length === 2 ? { hour: h, seconds: seconds(w[1], 0) } : { hour: h };
    }
    case 'weather':
      if (w.length !== 1 || !SCRIPT_WEATHERS.includes(/** @type {any} */ (w[0]))) throw new Error(`weather ${SCRIPT_WEATHERS.join(' | ')}`);
      return { weather: w[0] };
    case 'travel':
      if (w.length < 1 || w.length > 2) throw new Error('travel <level> [entrance]');
      return { level: name(w[0], 'level id'), entrance: w[1] === undefined ? '' : name(w[1], 'entrance name') };
    case 'ending':
      return { id: name(w[0], 'ending id'), title: lineText(textAfter(rest, 1)) };
    case 'walk': case 'teleport': {
      const actor = who(0, 'actor');
      const flags = new Set();
      const pos = [];
      for (let k = 1; k < W.length; k++) {
        if ((op === 'walk' && isWord(k, 'run', 'nowait')) || (op === 'teleport' && isWord(k, ...SCRIPT_FACINGS))) flags.add(W[k].text);
        else pos.push(k);
      }
      const base = op === 'walk'
        ? { who: actor, run: flags.has('run'), wait: !flags.has('nowait') }
        : { who: actor, facing: SCRIPT_FACINGS.find((f) => flags.has(f)) ?? '' };
      if (pos.length === 2 && isNum(pos[0]) && isNum(pos[1])) return { ...base, x: num(w[pos[0]]), z: num(w[pos[1]]) };
      if (pos.length === 1) return { ...base, to: who(pos[0], 'place') };
      throw new Error(op === 'walk' ? 'walk <who> <x> <z> | <who> <place> [run] [nowait]' : 'teleport <who> <x> <z> | <who> <place> [facing]');
    }
    case 'face': {
      if (w.length !== 2) throw new Error('face <who> up | down | left | right | <who> <place>');
      const actor = who(0, 'actor');
      return isWord(1, ...SCRIPT_FACINGS) ? { who: actor, dir: w[1] } : { who: actor, to: who(1, 'place') };
    }
    case 'emote': {
      if (w.length < 2 || w.length > 3) throw new Error('emote <who> <icon> [seconds]');
      if (!isOwnKey(EMOTES, w[1])) throw new Error(`"${w[1]}" is not an emote (${Object.keys(EMOTES).join(' ')})`);
      return { who: who(0, 'actor'), icon: EMOTES[w[1]], seconds: seconds(w[2], 1.6) };
    }
    case 'bark': {
      // the text is the rest of the line after <who> (a "quoted" name too), as written
      if (w.length < 2) throw new Error('bark <who> <text>');
      const actor = who(0, 'actor');
      return { who: actor, text: lineText(rest.slice(W[0].end).trim()) };
    }
    case 'camera': {
      if (isWord(0, 'reset')) {
        if (w.length > 2) throw new Error('camera reset [seconds]');
        return { reset: true, seconds: seconds(w[1], 0.8) };
      }
      if (w.length >= 2 && isNum(0) && isNum(1)) {
        if (w.length > 3) throw new Error('camera <x> <z> [seconds]');
        return { x: num(w[0]), z: num(w[1]), seconds: seconds(w[2], 1) };
      }
      if (w.length < 1 || w.length > 2) throw new Error('camera <who> [seconds] | <x> <z> [seconds] | reset [seconds]');
      return { who: who(0, 'actor or place'), seconds: seconds(w[1], 1) };
    }
    case 'shake': {
      const a = w[0] === undefined ? 0.3 : num(w[0]);
      if (w.length > 1 || !(a >= 0 && a <= 2)) throw new Error('shake [amount 0–2]');
      return { amount: a };
    }
    case 'fade': {
      const usage = 'fade out | in [seconds] — "fade out [seconds] white" fades to white';
      if ((w[0] !== 'out' && w[0] !== 'in') || W[0].quoted) throw new Error(usage);
      const dir = w[0];
      let secs;
      let white = false;
      for (let k = 1; k < W.length; k++) {
        if (isWord(k, 'white')) {
          if (dir !== 'out') throw new Error('fade in [seconds] — "white" belongs to "fade out" (a fade in comes back from the colour the fade out went to)');
          if (white) throw new Error(`${usage}: "white" is given twice`);
          white = true;
        } else if (isNum(k)) {
          if (secs !== undefined) throw new Error(`${usage}: one time in seconds`);
          secs = seconds(w[k], 0);
        } else throw notOneOf(w[k], 'a word of fade', ['white'], { quoted: W[k].quoted, usage });
      }
      // (`white` only when given: a plain fade's arguments are what they always were)
      return { dir, seconds: secs ?? (dir === 'out' ? 0.5 : 0.6), ...(white ? { white: true } : {}) };
    }
    case 'banner': case 'title': {
      const t = rest.trim();
      if (!t) throw new Error(`${op} <${op === 'banner' ? 'title' : 'text'}> [| subtitle]`);
      // `\|` is a bar inside the title
      const parts = t.split(/(?<!\\)\|/);
      const clean = (s) => lineText(s.replace(/\\\|/g, '|').trim());
      const title = clean(parts[0]);
      if (op === 'title' && !title) throw new Error('title <text> [| subtitle]: the title card\'s text is missing before the "|"');
      return { title, subtitle: clean(parts.slice(1).join('|')) };
    }
    case 'shot':
      return shotArgs(W, who, isNum, isWord, seconds);
    case 'slowmo': {
      if (w.length < 1 || w.length > 2 || !isNum(0) || (w.length === 2 && !isNum(1))) throw new Error('slowmo <scale 0.1–1> [seconds] — e.g. "slowmo 0.3", "slowmo 1 0.5"');
      return { scale: clampTo(num(w[0]), 0.1, 1), seconds: seconds(w[1], 0) };
    }
    case 'flash': {
      const usage = `flash [${FLASH_COLORS.join(' | ')}] [seconds] [hold]`;
      let color = '';
      let secs;
      let hold = false;
      for (let k = 0; k < W.length; k++) {
        if (isNum(k)) {
          if (secs !== undefined) throw new Error(`${usage}: one time in seconds`);
          secs = clampTo(seconds(w[k], 0.35), 0.05, 5);
        } else if (isWord(k, ...FLASH_COLORS)) {
          if (color) throw new Error(`${usage}: one colour`);
          color = w[k];
        } else if (isWord(k, 'hold')) {
          if (hold) throw new Error(`${usage}: "hold" is given twice`);
          hold = true;
        } else throw notOneOf(w[k], 'a colour of flash or "hold"', [...FLASH_COLORS, 'hold'], { quoted: W[k].quoted, usage });
      }
      // (`hold`: the colour comes in over the seconds — at once without them — and stays until the
      // next `flash`, which fades it back from there; the key only when given: a plain flash's
      // arguments are what they always were)
      if (hold) return { color: color || FLASH_COLORS[0], seconds: secs ?? 0, hold: true };
      return { color: color || FLASH_COLORS[0], seconds: secs ?? 0.35 };
    }
    case 'pose': {
      const usage = 'pose <who> <pose> [seconds]';
      if (w.length < 2 || w.length > 3) throw new Error(`${usage} — poses: ${POSE_NAMES.join(', ')}`);
      const actor = who(0, 'actor');
      const p = W[1];
      if (p.quoted || !POSE_NAMES.includes(/** @type {any} */ (p.text))) throw notOneOf(p.text, 'a pose', POSE_NAMES, { quoted: p.quoted, usage });
      if (w.length === 3 && !isNum(2)) throw new Error(`${usage}: "${w[2]}" is not a time in seconds`);
      return { who: actor, pose: p.text, seconds: seconds(w[2], 0) };
    }
    case 'effect': {
      const usage = 'effect <name> <who> [scale] | effect <name> <x> <z> [scale]';
      const e = W[0];
      if (!e) throw new Error(`${usage} — effects: ${EFFECT_NAMES.join(', ')}`);
      if (e.quoted || !EFFECT_NAMES.includes(/** @type {any} */ (e.text))) throw notOneOf(e.text, 'an effect', EFFECT_NAMES, { quoted: e.quoted, usage });
      if (!W[1]) throw new Error(`${usage}: where is missing`);
      /** @param {number} k */
      const scale = (k) => {
        if (W[k] === undefined) return 1;
        if (!isNum(k)) throw new Error(`${usage}: "${w[k]}" is not a scale (a number, 0.1–5)`);
        return clampTo(num(w[k]), 0.1, 5);
      };
      if (isNum(1)) {
        if (!isNum(2)) throw new Error(`${usage}: a point is two numbers, x and z`);
        if (W.length > 4) throw new Error(`${usage} — nothing after the scale`);
        return { name: e.text, x: num(w[1]), z: num(w[2]), scale: scale(3) };
      }
      if (W.length > 3) throw new Error(`${usage} — nothing after the scale`);
      return { name: e.text, who: who(1, 'actor or place'), scale: scale(2) };
    }
    case 'thaw': {
      const usage = 'thaw [<who> | <place> | <x> <z>] [seconds]';
      // (numbers only: one is the seconds, two a point, three a point and the seconds)
      const nums = W.filter((x, k) => isNum(k)).length;
      if (W.length > 3 || (W.length && !isNum(0) && nums !== W.length - 1)) throw new Error(usage);
      if (!W.length) return {};
      if (!isNum(0)) {
        if (W.length > 2) throw new Error(`${usage}: nothing after the seconds`);
        return { who: who(0, 'actor or place'), ...(W.length === 2 ? { seconds: seconds(w[1], 0) } : {}) };
      }
      if (nums !== W.length) throw new Error(usage);
      if (W.length === 1) return { seconds: seconds(w[0], 0) };
      return { x: num(w[0]), z: num(w[1]), ...(W.length === 3 ? { seconds: seconds(w[2], 0) } : {}) };
    }
    case 'toll': {
      if (w.length < 1 || w.length > 2) throw new Error('toll <belfry or chime id> [strength]');
      if (w.length === 2 && !isNum(1)) throw new Error(`toll <id> [strength]: "${w[1]}" is not a strength (a number, 0.1–2)`);
      return { id: name(w[0], 'belfry or chime id'), strength: w.length === 2 ? clampTo(num(w[1]), 0.1, 2) : 1 };
    }
    case 'toast': {
      const t = rest.trim();
      if (!t) throw new Error('toast <text>');
      return { text: lineText(t) };
    }
    case 'sfx': {
      const usage = 'sfx <sound> [pitch <semitones>] [pan <-1–1>]';
      if (!w.length) throw new Error(usage);
      /** @type {{ name: string, pitch?: number, pan?: number }} */
      const out = { name: name(w[0], 'sound name') };
      // (`pitch` and `pan` only when given: a plain sound's arguments are what they always were)
      for (let k = 1; k < W.length; k++) {
        const x = W[k];
        if (x.quoted || !isOwnKey(SFX_LIMITS, x.text)) {
          const hint = x.quoted ? '' : closestName(x.text, Object.keys(SFX_LIMITS));
          throw new Error(`"${x.text}" is not a word of sfx (pitch, pan)${hint ? ` — did you mean "${hint}"?` : ''} — ${usage}`);
        }
        const word = /** @type {keyof typeof SFX_LIMITS} */ (x.text);
        if (out[word] !== undefined) throw new Error(`${usage}: "${word}" is given twice`);
        if (!isNum(k + 1)) throw new Error(`${usage}: "${word}" takes a number${W[k + 1] ? ` — "${W[k + 1].text}" is none` : ''}`);
        const [lo, hi] = SFX_LIMITS[word];
        out[word] = clampTo(num(w[k + 1]), lo, hi);
        k++;
      }
      return out;
    }
    case 'music':
      if (w.length !== 1) throw new Error('music <track> | on | off');
      return { track: name(w[0], 'track') };
    case 'party':
      return partyArgs(W, who, isWord);
    default:
      throw new Error(`"${op}" is not a command`);
  }
}

/** `v` clamped into [lo, hi]. @param {number} v @param {number} lo @param {number} hi */
const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Words a writer may mean by a `shot` word — only for the hint, they are not accepted. */
const SHOT_SYNONYMS = Object.freeze({ distance: 'dist', zoom: 'dist', at: 'on', look: 'on', target: 'on', tilt: 'pitch', angle: 'yaw', turn: 'orbit', rotate: 'orbit', height: 'lift', raise: 'lift' });

/**
 * The arguments of `shot …` (DRAGON_CAMPAIGN.md §5.5) → `{ reset: true, seconds }` for
 * `shot reset [seconds]` (default 0.8 s, as `camera reset`), else `{ reset: false, seconds, who?,
 * x?, z?, yaw?, pitch?, dist?, fov?, lift?, orbit? }`: the words in any order, each at most once,
 * each followed by its number (clamped to `SHOT_LIMITS`); `on` by a who / place (`who`) or two
 * numbers (`x`, `z`); a number that follows no word is the move's length (0, the default: a cut).
 * A word left out is absent (the camera keeps what it has). At least one word.
 * @param {{ text: string, quoted: boolean }[]} W the words after `shot`
 * @param {(k: number, what: string) => string} who
 * @param {(k: number) => boolean} isNum
 * @param {(k: number, ...words: string[]) => boolean} isWord
 * @param {(v: string|undefined, def: number) => number} seconds
 * @returns {Record<string, any>}
 */
function shotArgs(W, who, isNum, isWord, seconds) {
  const usage = 'shot [on <who> | on <x> <z>] [yaw <deg>] [pitch <deg>] [dist <u>] [fov <deg>] [lift <u>] [orbit <deg/s>] [seconds] [nowait] | shot reset [seconds]';
  if (!W.length) throw new Error(`${usage} — at least one of on, yaw, pitch, dist, fov, lift, orbit`);
  if (isWord(0, 'reset')) {
    if (W.length > 2 || (W.length === 2 && !isNum(1))) throw new Error('shot reset [seconds] — nothing else after "reset"');
    return { reset: true, seconds: seconds(W[1]?.text, 0.8) };
  }
  /** @type {Record<string, any>} */
  const out = { reset: false };
  let secs;
  let framed = false;
  for (let k = 0; k < W.length; k++) {
    const x = W[k];
    // (a move waits until the camera is there — `nowait` goes on at once)
    if (isWord(k, 'nowait')) { if (out.wait === false) throw new Error(`${usage}: "nowait" is given twice`); out.wait = false; continue; }
    if (isNum(k)) {
      if (secs !== undefined) throw new Error(`${usage}: "${x.text}" — the move's length is given twice (a number after no word is the length)`);
      secs = seconds(x.text, 0);
      continue;
    }
    if (x.quoted || !SHOT_WORDS.includes(/** @type {any} */ (x.text)) || x.text === 'reset') {
      if (isWord(k, 'reset')) throw new Error('shot reset [seconds] — "reset" comes alone, first');
      const low = x.text.toLowerCase();
      const syn = isOwnKey(SHOT_SYNONYMS, low) ? SHOT_SYNONYMS[low] : '';
      const hint = x.quoted ? '' : syn || closestName(x.text, SHOT_WORDS.filter((s) => s !== 'reset'));
      throw new Error(`"${x.text}" is not a word of shot (on, yaw, pitch, dist, fov, lift, orbit; or "shot reset")${hint ? ` — did you mean "${hint}"?` : ''}`);
    }
    const word = x.text;
    if (word === 'on' ? out.who !== undefined || out.x !== undefined : out[word] !== undefined) throw new Error(`${usage}: "${word}" is given twice`);
    framed = true;
    if (word === 'on') {
      if (!W[k + 1]) throw new Error(`${usage}: who or where is missing after "on"`);
      if (isNum(k + 1)) {
        if (!isNum(k + 2)) throw new Error(`${usage}: "on" a point takes two numbers, x and z`);
        out.x = plainNumber(W[k + 1].text);
        out.z = plainNumber(W[k + 2].text);
        k += 2;
      } else {
        out.who = who(k + 1, 'actor or place');
        k++;
      }
      continue;
    }
    if (!isNum(k + 1)) throw new Error(`${usage}: "${word}" takes a number${W[k + 1] ? ` — "${W[k + 1].text}" is none` : ''}`);
    const [lo, hi] = SHOT_LIMITS[/** @type {keyof typeof SHOT_LIMITS} */ (word)];
    out[word] = clampTo(plainNumber(W[k + 1].text), lo, hi);
    k++;
  }
  if (!framed) throw new Error(`${usage} — a length alone frames nothing: at least one of on, yaw, pitch, dist, fov, lift, orbit`);
  out.seconds = secs ?? 0;
  return out;
}

/** The forms of `party` (its verbs, in the order the help lists them). */
export const PARTY_VERBS = /** @type {const} */ (['join', 'leave', 'rule', 'set', 'menu']);
/** Each `party` form as written (for the errors). */
const PARTY_USAGE = Object.freeze({
  join: 'party join <who> [as <class>] [<preset>]',
  leave: 'party leave <who>',
  rule: 'party rule <who> <preset>',
  set: 'party set <who> <field> <value>',
  menu: 'party menu [<who>]',
});

/**
 * The closest of `names` to a misspelt word, in any case ('' when none is close): for "did you
 * mean …?" — at most 1 edit for a word of up to 4 letters, 2 for a longer one (two neighbours
 * swapped count as one edit), and fewer than the word has letters.
 * @param {string} word
 * @param {readonly string[]} names
 */
export function closestName(word, names) {
  const w = String(word).toLowerCase();
  const most = w.length <= 4 ? 1 : 2;
  let best = '';
  let bestD = most + 1;
  for (const n of names) {
    const d = swapDistance(w, n);
    if (d < bestD && d < w.length) { bestD = d; best = n; }
  }
  return best;
}

/**
 * Edit distance where two neighbours swapped count as one edit (99 when the lengths differ by
 * more than 3). @param {string} a @param {string} b
 */
function swapDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Words a writer may mean by a rule value — only for the hint, they are not accepted:
 * `party set sela distance near` → "did you mean "close"?".
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
const RULE_SYNONYMS = Object.freeze({
  target: Object.freeze({ closest: 'nearest', near: 'nearest', boss: 'strongest', toughest: 'strongest', archers: 'ranged', casters: 'ranged', mine: 'leader' }),
  distance: Object.freeze({ near: 'close', nearby: 'close', short: 'close', medium: 'mid', middle: 'mid', normal: 'mid', long: 'far', away: 'far', wide: 'far' }),
  attack: Object.freeze({ always: 'free', freely: 'free', yes: 'free', on: 'free', help: 'assist', no: 'never', off: 'never', none: 'never' }),
  skills: Object.freeze({ always: 'free', freely: 'free', yes: 'free', on: 'free', mana: 'save', no: 'never', off: 'never', none: 'never' }),
  heal: Object.freeze({ always: 'often', sometimes: 'half', rarely: 'low', no: 'never', off: 'never', none: 'never' }),
  evade: Object.freeze({ yes: 'on', true: 'on', always: 'on', dodge: 'on', no: 'off', false: 'off', never: 'off', none: 'off' }),
  retreat: Object.freeze({ no: 'never', off: 'never', none: 'never' }),
});

/**
 * `"x" is not <what> (a, b, c) — did you mean "y"?` A quoted name of the list says to write it
 * without quotes; the synonyms of `field`'s values (`RULE_SYNONYMS`) come before the closest
 * spelling.
 * @param {string} word @param {string} what @param {readonly string[]} names
 * @param {{ quoted?: boolean, usage?: string, field?: string }} [opts]
 */
function notOneOf(word, what, names, { quoted = false, usage = '', field = '' } = {}) {
  const low = String(word).toLowerCase();
  if (quoted && names.includes(low)) return new Error(`"${word}" is quoted — ${what} is written without quotes: ${low}${usage ? ` (${usage})` : ''}`);
  const syn = field && isOwnKey(RULE_SYNONYMS, field) && isOwnKey(RULE_SYNONYMS[field], low) ? RULE_SYNONYMS[field][low] : '';
  const hint = syn || closestName(word, names);
  return new Error(`"${word}" is not ${what} (${names.join(', ')})${hint ? ` — did you mean "${hint}"?` : ''}`);
}

/** `<who>` as a command writes it again (quoted when it has spaces). @param {string} v */
const asWritten = (v) => (/\s/.test(v) ? `"${v}"` : v);

/**
 * The arguments of `party …` (docs/specs/PARTY.md §7.1) → `{ verb, who, cls?, preset?, field?,
 * value? }` (`who` '' for a `party menu` that names nobody). Class, preset, field and value names
 * are PartyRules.js's; an unknown one is an error that lists them, with the closest name.
 * @param {{ text: string, quoted: boolean }[]} W the words after `party`
 * @param {(k: number, what: string) => string} who a name or a "quoted" name at word k
 * @param {(k: number, ...words: string[]) => boolean} isWord
 * @returns {Record<string, any>}
 */
function partyArgs(W, who, isWord) {
  const verb = W[0] && !W[0].quoted ? W[0].text : '';
  if (!verb) throw new Error(`party ${PARTY_VERBS.join(' | ')} — ${Object.values(PARTY_USAGE).join(' · ')}`);
  if (!isOwnKey(PARTY_USAGE, verb)) throw notOneOf(verb, 'a party command', PARTY_VERBS);
  const usage = PARTY_USAGE[verb];
  /** The member or villager (word 1): never the player, who leads the party. */
  const villager = () => {
    if (!W[1]) throw new Error(`${usage}: the villager is missing`);
    const v = who(1, 'villager');
    if (v.toLowerCase() === 'player') throw new Error(`${usage}: the player leads the party — <who> is a villager`);
    return v;
  };
  switch (verb) {
    case 'join': {
      const v = villager();
      let cls = '';
      let preset = '';
      for (let k = 2; k < W.length; k++) {
        const x = W[k];
        if (isWord(k, 'as')) {
          if (cls) throw new Error(`${usage}: the class is given twice`);
          const c = W[k + 1];
          if (!c) throw new Error(`${usage}: the class is missing after "as" (${CLASS_NAMES.join(', ')})`);
          if (!c.quoted && isPreset(c.text.toLowerCase())) throw new Error(`"${c.text}" is a preset, not a class (${CLASS_NAMES.join(', ')}) — a preset is written without "as": party join ${asWritten(v)} ${c.text.toLowerCase()}`);
          if (c.quoted || !isClass(c.text)) throw notOneOf(c.text, 'a class', CLASS_NAMES, { quoted: c.quoted, usage });
          cls = c.text;
          k++;
          continue;
        }
        if (!x.quoted && isClass(x.text)) throw new Error(`"${x.text}" is a class — write "as ${x.text}" (${usage})`);
        if (x.quoted || !isPreset(x.text)) throw notOneOf(x.text, 'a preset', PRESET_NAMES, { quoted: x.quoted, usage });
        if (preset) throw new Error(`${usage}: the preset is given twice`);
        preset = x.text;
      }
      return { verb, who: v, cls, preset };
    }
    case 'leave': {
      const v = villager();
      if (W.length > 2) throw new Error(`${usage} — nothing after the villager`);
      return { verb, who: v };
    }
    case 'rule': {
      const v = villager();
      const x = W[2];
      if (!x) throw new Error(`${usage}: the preset is missing (${PRESET_NAMES.join(', ')})`);
      if (!x.quoted && isRuleField(x.text)) throw new Error(`"${x.text}" is a field of the rule — write "party set ${asWritten(v)} ${x.text} <value>" (${usage})`);
      if (!x.quoted && isClass(x.text.toLowerCase())) throw new Error(`"${x.text}" is a class, not a preset (${PRESET_NAMES.join(', ')}) — a member's class is chosen when it joins: party join ${asWritten(v)} as ${x.text.toLowerCase()}`);
      if (x.quoted || !isPreset(x.text)) throw notOneOf(x.text, 'a preset', PRESET_NAMES, { quoted: x.quoted, usage });
      if (W.length > 3) throw new Error(`${usage} — one preset, nothing after it`);
      return { verb, who: v, preset: x.text };
    }
    case 'set': {
      const v = villager();
      const f = W[2];
      if (!f) throw new Error(`${usage}: the field is missing (${RULE_KEYS.join(', ')})`);
      if (!f.quoted && isPreset(f.text)) throw new Error(`"${f.text}" is a preset — write "party rule ${asWritten(v)} ${f.text}" (${usage})`);
      if (f.quoted || !isRuleField(f.text)) throw notOneOf(f.text, 'a field of the rule', RULE_KEYS, { quoted: f.quoted, usage });
      const values = RULE_FIELDS[f.text].values;
      const x = W[3];
      if (!x) throw new Error(`${usage}: the value is missing (${f.text}: ${values.join(', ')})`);
      if (x.quoted || !isRuleValue(f.text, x.text)) throw notOneOf(x.text, `a value of ${f.text}`, values, { quoted: x.quoted, usage, field: f.text });
      if (W.length > 4) throw new Error(`${usage} — one value, nothing after it`);
      return { verb, who: v, field: f.text, value: x.text };
    }
    default: {
      // menu
      if (W.length > 2) throw new Error(`${usage} — at most one member, nothing after it`);
      return { verb, who: W[1] ? villager() : '' };
    }
  }
}

/** `var` operators. @param {string|undefined} s */
function ownOp(s) {
  return s === '=' ? '=' : s === '+' || s === '+=' ? '+' : s === '-' || s === '-=' ? '-' : '';
}

/** The command closest to a misspelt word (for "did you mean"). */
function suggest(word) {
  const w = word.toLowerCase();
  let best = '';
  let bestD = 3;
  for (const c of Object.keys(SCRIPT_COMMANDS)) {
    const d = editDistance(w, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

/** Levenshtein distance (99 when the lengths differ by more than 3). */
export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/**
 * The inside of an option's `[…]` prefix as a modifier — `once`, `if <condition>`,
 * `once if <condition>` (the words in any case) — or null: not a modifier, it stays in the label
 * (`> [Lie] I never saw her`). `src` null: no `if`; '' an `if` without its condition.
 * @param {string} inside
 * @returns {{ once: boolean, src: string|null }|null}
 */
function optionModifier(inside) {
  let s = inside.trim();
  const first = () => /^\S+/.exec(s)?.[0] ?? '';
  let w = first();
  let once = false;
  if (w.toLowerCase() === 'once') {
    once = true;
    s = s.slice(w.length).trim();
    w = first();
    if (!w) return { once, src: null };
  }
  if (w.toLowerCase() === 'if') return { once, src: s.slice(w.length).trim() };
  return null;
}

/**
 * @typedef {{ line: number, msg: string }} ScriptError
 * @typedef {{ nodes: ScriptNode[], errors: ScriptError[], stray: number[], parked: number[] }} ParsedScript
 *   stray: the lines whose `#line:` tag is on no text (an `if`, a `set`, a `quest … start`, a blank
 *   line) — the tag is ignored there (the checks report it); parked: the lines read as no statement
 *   that may read again — a comment, a line with an error (and the lines its error left out), a
 *   line over a limit (`SCRIPT_LIMITS`) —, tagged or not: a tag there is kept for when the line
 *   reads again (TextKeys.js `retagScript`), never called stray
 */

/** Where `#line:` starts in a line's text after its tag was cut off (-1: nowhere). @param {string} text */
const tagLeft = (text) => text.indexOf(LINE_TAG);

/**
 * Parse a script. Lines with errors are left out (the rest still runs); `errors` names each with
 * its 1-based line number. A line's trailing `#line:<GUID>` tag (ContentKeys.js `splitLineTag`)
 * is cut off before the line is read — no text, label, speaker or key ever holds it — and becomes
 * the content key of the line's text when the line holds text (`holdsText`): `tk` on a `say`, a
 * `choice`'s question, an option, a `bark`, `toast`, `quest … stage` and `ending`; a `banner`'s and a
 * `title` card's `tks`: the tag and `<tag>.2`. A line whose text still holds `#line:` (a malformed tag, two tags)
 * is an error: it is never shown.
 * @param {unknown} source a script field value (string[] or text)
 * @returns {ParsedScript}
 */
export function parseScript(source) {
  const raw = scriptLines(source);
  /** @type {ScriptError[]} */
  const errors = [];
  /** the lines read as no statement that may read again (`ParsedScript.parked`) */
  const parked = new Set();
  if (raw.length > SCRIPT_LIMITS.lines) {
    errors.push({ line: SCRIPT_LIMITS.lines + 1, msg: `a script may have at most ${SCRIPT_LIMITS.lines} lines — the rest is ignored` });
    for (let k = SCRIPT_LIMITS.lines; k < raw.length; k++) parked.add(k + 1);
    raw.length = SCRIPT_LIMITS.lines;
  }
  /** @type {{ line: number, indent: number, text: string }[]} */
  const lines = [];
  let tabs = false;
  let spaces = false;
  /** line number → its key tag */
  const tags = new Map();
  raw.forEach((r, k) => {
    const s = toText(r, '');
    // (the tag is not counted: a line is as long as its text)
    const { indent, text: full, tab, space } = splitIndent(s);
    const { text, tag } = splitLineTag(full);
    if (text.length > SCRIPT_LIMITS.lineLength) {
      errors.push({ line: k + 1, msg: `line longer than ${SCRIPT_LIMITS.lineLength} characters` });
      parked.add(k + 1);
      return;
    }
    if (tag) tags.set(k + 1, tag);
    if (text.startsWith('#')) { parked.add(k + 1); return; }
    if (!text) return;
    if (tagLeft(text) >= 0) {
      errors.push({ line: k + 1, msg: `"${LINE_TAG}" in the line: a key tag is "${LINE_TAG}" and 32 hex digits at the end of the line, after a space — one per line` });
      parked.add(k + 1);
      return;
    }
    tabs ||= tab;
    spaces ||= space;
    lines.push({ line: k + 1, indent, text });
  });
  /** Said after an indentation error when the script indents with tabs and with spaces. */
  const indentHint = tabs && spaces ? ' (this script indents with tabs and with spaces: a tab counts as 2 spaces)' : '';
  let k = 0;
  /** The speaker of the nearest line of dialogue above (in the text): what `- text` repeats. */
  let lastSpeaker = /** @type {string|null} */ (null);

  /**
   * The lines of one block (all at its indentation) → nodes.
   * @param {number} indent
   * @param {number} depth
   * @param {'script'|'choice'|'vary'} kind
   * @returns {any[]}
   */
  const block = (indent, depth, kind) => {
    const nodes = [];
    while (k < lines.length) {
      const L = lines[k];
      if (L.indent < indent) break;
      if (L.indent > indent) {
        errors.push({ line: L.line, msg: `unexpected indentation${indentHint}` });
        parked.add(L.line);
        k++;
        continue;
      }
      const from = k;
      k++;
      try {
        const node = statement(L, depth, kind, nodes);
        if (node) nodes.push(node);
      } catch (err) {
        errors.push({ line: L.line, msg: err.message });
        while (k < lines.length && lines[k].indent > L.indent) k++;
        // (the line and every line its statement read — its block too — are left out: parked)
        for (let i = from; i < k; i++) parked.add(lines[i].line);
        // a broken `*` alternative keeps its place (empty): the others keep their turns
        if (kind === 'vary' && L.text.startsWith('*')) nodes.push({ t: 'alt', line: L.line, body: [] });
      }
    }
    return nodes;
  };

  /** Is the next line indented under line L? */
  const hasChildren = (L) => k < lines.length && lines[k].indent > L.indent;

  /**
   * A line that takes no block has lines indented under it: they are reported (one error, at the
   * first) and left out; the line itself stays.
   * @param {{ line: number, indent: number }} L
   * @param {string} what
   */
  const rejectChildren = (L, what) => {
    const first = lines[k].line;
    let n = 0;
    while (k < lines.length && lines[k].indent > L.indent) { parked.add(lines[k].line); k++; n++; }
    errors.push({ line: first, msg: `unexpected indentation: ${what} takes no indented block — ${n === 1 ? 'this line is' : `these ${n} lines are`} left out${indentHint}` });
  };

  /**
   * The indented block under header line L.
   * @returns {any[]}
   */
  const childBlock = (L, depth, kind = /** @type {'script'|'choice'|'vary'} */ ('script')) => {
    if (depth >= SCRIPT_LIMITS.depth) throw new Error(`blocks nested deeper than ${SCRIPT_LIMITS.depth}`);
    if (!hasChildren(L)) throw new Error(`an indented block must follow${indentHint}`);
    return block(lines[k].indent, depth + 1, kind);
  };

  /**
   * A line of dialogue or a command — what may follow a `*` on its line.
   * @param {{ line: number, indent: number, text: string }} L
   * @returns {ScriptNode|null} null: not dialogue
   */
  const dialogue = (L, text) => {
    if (text.startsWith(':') && (text.length === 1 || /\s/.test(text[1]))) {
      const said = text.slice(1).trim();
      if (!said) throw new Error('the line says nothing');
      lastSpeaker = '';
      return { t: 'say', line: L.line, speaker: '', text: lineText(said) };
    }
    if (text === '-' || text.startsWith('- ')) {
      const said = text.slice(1).trim();
      if (!said) throw new Error('the line says nothing');
      return { t: 'say', line: L.line, speaker: lastSpeaker, text: lineText(said) };
    }
    // a command word goes first: `toast Obtained: an apple` is a command
    const m = /^([a-z]+)(?:\s|$)/.exec(text);
    if (m && isOwnKey(SCRIPT_COMMANDS, m[1])) return null;
    // `Speaker: text` / `"A voice": text` — the colon followed by a space (or the end)
    const q = /^"([^"]{1,60})":(\s+([\s\S]*))?$/.exec(text);
    const colon = text.indexOf(':');
    if (q || (colon > 0 && colon <= 60 && (colon === text.length - 1 || /\s/.test(text[colon + 1])))) {
      const speaker = q ? q[1].trim() : text.slice(0, colon).trim();
      const said = (q ? q[3] ?? '' : text.slice(colon + 1)).trim();
      if (!said) throw new Error('the line says nothing');
      lastSpeaker = speaker;
      return { t: 'say', line: L.line, speaker, text: lineText(said) };
    }
    return null;
  };

  /** "x is not a command", with a hint (the closest command; a speaker's colon without its space). */
  const notACommand = (text, dialogueHint) => {
    const first = /^\S+/.exec(text)?.[0] ?? text;
    const hint = suggest(first);
    const colon = first.includes(':') ? ' — a speaker\'s colon needs a space after it ("Name: text")' : dialogueHint ? ' — dialogue is written "Name: text"' : '';
    return new Error(`"${first}" is not a command${hint ? ` (did you mean "${hint}"?)` : ''}${colon}`);
  };

  /**
   * One statement line (and its block) → a node, or null (an `elif` / `else` joined to its `if`).
   * @param {{ line: number, indent: number, text: string }} L
   * @param {number} depth
   * @param {'script'|'choice'|'vary'} kind
   * @param {any[]} siblings
   * @returns {any}
   */
  const statement = (L, depth, kind, siblings) => {
    const text = L.text;
    if (kind === 'choice' && !text.startsWith('>')) throw new Error('a choice holds only options ("> label")');
    if (kind === 'vary' && !text.startsWith('*')) throw new Error('a cycle / seq / pick holds only "*" alternatives');
    if (text.startsWith('>')) {
      if (kind !== 'choice') throw new Error('an option ("> label") must be inside a choice');
      let rest = text.slice(1).trim();
      let cond = null;
      let src = '';
      let once = false;
      // `[once]`, `[if c]`, `[once if c]` (read by hand: no pattern that backtracks over the line)
      const mod = /^\[([^\]]*)\]\s*/.exec(rest);
      const m = mod ? optionModifier(mod[1]) : null;
      if (mod && m) {
        once = m.once;
        if (m.src !== null) {
          if (!m.src) throw new Error('option condition: the condition is missing — [if <condition>]');
          src = m.src;
          const p = parseCondition(src);
          if (p.error) throw new Error(`option condition: ${p.error}`);
          cond = p.cond;
        }
        rest = rest.slice(mod[0].length).trim();
      }
      if (!rest) throw new Error('the option has no label');
      const body = hasChildren(L) ? childBlock(L, depth) : [];
      return { t: 'option', line: L.line, label: lineText(rest), cond, src, once, body };
    }
    if (text.startsWith('*')) {
      if (kind !== 'vary') throw new Error('an alternative ("*") must be inside a cycle, seq or pick');
      const inline = text.slice(1).trim();
      const body = [];
      if (inline) {
        const sub = { line: L.line, indent: L.indent, text: inline };
        // (the lines indented under the `*` belong to the alternative, after its inline line)
        const n = dialogue(sub, inline) ?? simple(sub, inline, true);
        body.push(n);
      }
      if (hasChildren(L)) body.push(...childBlock(L, depth));
      if (!body.length) throw new Error('an empty alternative');
      return { t: 'alt', line: L.line, body };
    }
    const said = dialogue(L, text);
    if (said) {
      if (hasChildren(L)) rejectChildren(L, 'a line of dialogue');
      return said;
    }
    const m = /^([a-z]+)(?:\s+([\s\S]*))?$/.exec(text);
    if (m && isOwnKey(SCRIPT_COMMANDS, m[1])) {
      const op = m[1];
      const rest = m[2] ?? '';
      if (op === 'if' || op === 'elif') {
        if (!rest.trim()) throw new Error(`${op} <condition>`);
        const p = parseCondition(rest);
        if (p.error) throw new Error(`${op}: ${p.error}`);
        if (op === 'elif') {
          const prev = siblings[siblings.length - 1];
          if (!prev || prev.t !== 'if' || prev.otherwise) throw new Error('elif without an if before it');
          prev.branches.push({ cond: p.cond, src: rest.trim(), body: childBlock(L, depth) });
          return null;
        }
        return { t: 'if', line: L.line, branches: [{ cond: p.cond, src: rest.trim(), body: childBlock(L, depth) }], otherwise: null };
      }
      if (op === 'else') {
        commandArgs(op, rest);
        const prev = siblings[siblings.length - 1];
        if (!prev || prev.t !== 'if' || prev.otherwise) throw new Error('else without an if before it');
        prev.otherwise = childBlock(L, depth);
        return null;
      }
      if (op === 'loop') {
        commandArgs(op, rest);
        return { t: 'loop', line: L.line, body: childBlock(L, depth) };
      }
      if (op === 'once') {
        const { key } = commandArgs(op, rest);
        return { t: 'once', line: L.line, key, body: childBlock(L, depth) };
      }
      if (op === 'cycle' || op === 'seq' || op === 'pick') {
        const { key } = commandArgs(op, rest);
        const alts = childBlock(L, depth, 'vary').filter((a) => a.t === 'alt').map((a) => a.body);
        if (!alts.some((a) => a.length)) throw new Error(`a ${op} needs at least one "*" alternative`);
        return { t: 'vary', line: L.line, mode: op, key, alts };
      }
      if (op === 'choice') {
        const options = childBlock(L, depth, 'choice').filter((o) => o.t === 'option').map(({ t, ...o }) => o);
        if (!options.length) throw new Error('a choice needs at least one option');
        if (options.length > 8) throw new Error('a choice may offer at most 8 options');
        return { t: 'choice', line: L.line, text: lineText(rest.trim()), options };
      }
      return simple(L, text);
    }
    throw notACommand(text, true);
  };

  /**
   * A command without a block.
   * @param {{ line: number, indent: number, text: string }} L
   * @param {string} text
   * @param {boolean} [inline] the command of a `*` line (the lines under it are the alternative's)
   * @returns {ScriptNode}
   */
  const simple = (L, text, inline = false) => {
    const m = /^([a-z]+)(?:\s+([\s\S]*))?$/.exec(text);
    if (!m || !isOwnKey(SCRIPT_COMMANDS, m[1])) throw notACommand(text, false);
    if (BLOCK_COMMANDS.has(m[1])) throw new Error(`"${m[1]}" needs a line of its own with an indented block`);
    const args = commandArgs(m[1], m[2] ?? '');
    if (!inline && hasChildren(L)) rejectChildren(L, `"${m[1]}"`);
    return { t: 'cmd', line: L.line, op: m[1], args };
  };

  const nodes = block(lines.length ? lines[0].indent : 0, 0, 'script');
  while (k < lines.length) {
    errors.push({ line: lines[k].line, msg: `unexpected indentation${indentHint}` });
    parked.add(lines[k].line);
    k++;
  }
  errors.sort((a, b) => a.line - b.line);
  /** @type {number[]} */
  const stray = [];
  if (tags.size) {
    // (a tag keys its line's text where the line holds text — the one rule, `holdsText`)
    const used = new Set();
    for (const s of scriptTextSlots(nodes)) {
      if (!s.held) continue;
      const line = s.option ? s.option.line : s.node.line;
      const g = tags.get(line);
      if (!g) continue;
      used.add(line);
      const n = /** @type {{ tk?: string, tks?: [string, string] }} */ (s.node);
      if (s.option) s.option.tk = g;
      else if (s.node.t === 'cmd' && (s.node.op === 'banner' || s.node.op === 'title')) n.tks = [g, subtitleKey(g)];
      else n.tk = g;
    }
    for (const l of tags.keys()) if (!used.has(l) && !parked.has(l)) stray.push(l);
  }
  return { nodes, errors, stray, parked: [...parked].sort((a, b) => a - b) };
}

// =================================================================================================
// References
// =================================================================================================

/**
 * Everything scripts and conditions refer to (the checks, the editor and the runtime read it).
 * @typedef {object} ScriptRefs
 * @property {Set<string>} reads    flags / variables read by conditions
 * @property {Set<string>} writes   flags / variables set, cleared or changed
 * @property {Set<string>} items    items given, taken or read
 * @property {Set<string>} gives    items given (to find items taken but never given)
 * @property {Set<string>} quests   quests changed or read
 * @property {{ quest: string, stage: string }[]} stages   stages set or compared
 * @property {Set<string>} stageReads  quests whose stage a condition reads (`stage:<quest>`)
 * @property {Set<string>} scripts  named scripts called
 * @property {Set<string>} builtins hand-written conversations played
 * @property {Set<string>} actors   actors named by staging commands (`player` left out): walk,
 *   teleport, face, emote, bark, home, wait, pose
 * @property {Set<string>} speakers names lines of dialogue are spoken by
 * @property {Set<string>} targets  places named by walk / teleport / face / camera / shot / effect (actors, objects,
 *   entrances, markers)
 * @property {Set<string>} levels   levels travelled to / read (`visited:`)
 * @property {Set<string>} visited  levels read by `visited:`
 * @property {{ level: string, entrance: string, line: number }[]} travels
 * @property {Set<string>} done     keys read by `done:`
 * @property {Set<string>} onces    keys of `once`, `cycle`, `seq`, `pick` blocks
 * @property {Set<string>} onceKeys keys of `once` blocks (what `done:<key>` reads)
 * @property {Set<string>} varyKeys keys of `cycle`, `seq`, `pick` blocks (their turns)
 * @property {Set<string>} sounds   sound effects
 * @property {Set<string>} tracks   music tracks
 * @property {Set<string>} joins    villagers `party join` takes (a villager of the level the script
 *   runs in)
 * @property {Set<string>} members  party members named by `party:<who>` and by `party leave` /
 *   `rule` / `set` / `menu` (a villager of any level of the campaign, or an actor of the story)
 */

/** @returns {ScriptRefs} */
export function emptyRefs() {
  return {
    reads: new Set(), writes: new Set(), items: new Set(), gives: new Set(), quests: new Set(), stages: [], stageReads: new Set(),
    scripts: new Set(), builtins: new Set(), actors: new Set(), speakers: new Set(), targets: new Set(), levels: new Set(),
    visited: new Set(), travels: [], done: new Set(), onces: new Set(), onceKeys: new Set(), varyKeys: new Set(),
    sounds: new Set(), tracks: new Set(), joins: new Set(), members: new Set(),
  };
}

/**
 * Add a condition's references to `out`.
 * @param {Cond} c
 * @param {ScriptRefs} out
 */
export function addConditionRefs(c, out) {
  for (const { ref: r, value } of conditionRefs(c)) {
    if (r.kind === '') out.reads.add(r.name);
    else if (r.kind === 'item') out.items.add(r.name);
    else if (r.kind === 'quest') out.quests.add(r.name);
    else if (r.kind === 'stage') {
      out.quests.add(r.name);
      out.stageReads?.add(r.name);
      if (typeof value === 'string') out.stages.push({ quest: r.name, stage: value });
    } else if (r.kind === 'visited') { out.levels.add(r.name); out.visited?.add(r.name); }
    else if (r.kind === 'done') out.done.add(r.name);
    else if (r.kind === 'visits') out.actors.add(r.name);
    else if (r.kind === 'party') out.members?.add(r.name);
    // a variable on the right of a numeric comparison (`gold >= inn.price`)
    if (typeof value === 'string' && !isTextRef(r) && r.kind !== 'stage') out.reads.add(value);
  }
}

/**
 * Everything the nodes of a script refer to.
 * @param {ScriptNode[]} nodes
 * @param {ScriptRefs} [out]
 * @returns {ScriptRefs}
 */
export function scriptRefs(nodes, out = emptyRefs()) {
  for (const n of nodes) {
    switch (n.t) {
      case 'say': if (n.speaker) out.speakers.add(n.speaker); break;
      case 'choice':
        for (const o of n.options) {
          if (o.cond) addConditionRefs(o.cond, out);
          scriptRefs(o.body, out);
        }
        break;
      case 'if':
        for (const b of n.branches) {
          addConditionRefs(b.cond, out);
          scriptRefs(b.body, out);
        }
        if (n.otherwise) scriptRefs(n.otherwise, out);
        break;
      case 'loop': scriptRefs(n.body, out); break;
      case 'once': out.onces.add(n.key); out.onceKeys?.add(n.key); scriptRefs(n.body, out); break;
      case 'vary': out.onces.add(n.key); out.varyKeys?.add(n.key); for (const a of n.alts) scriptRefs(a, out); break;
      case 'cmd': cmdRefs(n, out); break;
      default: break;
    }
  }
  return out;
}

/**
 * @param {Extract<ScriptNode, { t: 'cmd' }>} n
 * @param {ScriptRefs} out
 */
function cmdRefs(n, out) {
  const a = n.args;
  const actor = (who) => { if (who && !isPlayerName(who)) out.actors.add(who); };
  const place = (to) => { if (to && !isPlayerName(to)) out.targets.add(to); };
  switch (n.op) {
    case 'set': case 'clear': case 'var': out.writes.add(a.name); break;
    case 'give': if (a.item !== 'gold') { out.items.add(a.item); out.gives.add(a.item); } break;
    case 'take': if (a.item !== 'gold') out.items.add(a.item); break;
    case 'quest':
      out.quests.add(a.id);
      if (a.verb === 'stage') out.stages.push({ quest: a.id, stage: a.stage });
      break;
    case 'call': out.scripts.add(a.script); break;
    case 'builtin': out.builtins.add(a.script); break;
    case 'travel': out.levels.add(a.level); out.travels.push({ level: a.level, entrance: a.entrance, line: n.line }); break;
    case 'walk': case 'teleport': actor(a.who); place(a.to); break;
    case 'face': actor(a.who); place(a.to); break;
    case 'emote': case 'bark': case 'home': actor(a.who); break;
    case 'wait': actor(a.who); break;
    case 'camera': case 'shot': place(a.who); break;
    case 'pose': actor(a.who); break;
    case 'effect': place(a.who); break;
    case 'thaw': place(a.who); break;
    case 'toll': place(a.id); break;
    case 'sfx': out.sounds.add(a.name); break;
    case 'music': if (a.track !== 'on' && a.track !== 'off') out.tracks.add(a.track); break;
    case 'party':
      if (a.verb === 'join') out.joins?.add(a.who);
      else if (a.who) out.members?.add(a.who);
      break;
    default: break;
  }
}

/**
 * `${…}` in a line of text: the value of a reference (`${gold}`, `${deliveries}`,
 * `${item:plank}`, `${hour}`; spaces inside the braces are ignored: `${ gold }`) — for `stage:` and
 * `quest:` references what the reader's `text` gives (`${stage:q}`: the stage reached, by its id),
 * else the value. `${` always begins a value, so a `$` just before it is a dollar sign (`$${price}`
 * → `$12`); `$$` anywhere else is one dollar sign. A backslash before a `$` writes that `$` as it
 * is (`\${gold}` → `${gold}`, `\$` → `$`); two backslashes there are one (`\\${gold}` → `\12`);
 * backslashes anywhere else stay as written. A reference that does not parse stays as written.
 * Every text of the story goes through here once (a script's texts after the parser's `\n`,
 * which leaves the backslashes before a `$` to this function; the story files' texts as written).
 * Reads each character once (a hostile text is linear).
 * @param {string} text
 * @param {RefReader} read
 * @returns {string}
 */
export function interpolate(text, read) {
  if (!text.includes('$')) return text;
  const n = text.length;
  let out = '';
  let k = 0;
  while (k < n) {
    const c = text[k];
    if (c === '\\') {
      let j = k + 1;
      while (j < n && text[j] === '\\') j++;
      if (text[j] !== '$') {
        out += text.slice(k, j);
        k = j;
        continue;
      }
      // a run of backslashes before a `$`: each pair is one backslash, an odd one makes the `$` plain
      const run = j - k;
      out += '\\'.repeat(run >> 1);
      if (run % 2) {
        out += '$';
        k = j + 1;
      } else k = j;
      continue;
    }
    if (c !== '$') {
      let j = k + 1;
      while (j < n && text[j] !== '$' && text[j] !== '\\') j++;
      out += text.slice(k, j);
      k = j;
      continue;
    }
    if (text[k + 1] === '{') {
      const m = /^\$\{([^{}]{1,90})\}/.exec(text.slice(k, k + 93));
      if (m) {
        out += refText(m[1], m[0], read);
        k += m[0].length;
        continue;
      }
    } else if (text[k + 1] === '$' && text[k + 2] !== '{') {
      // `$$` is one dollar sign (`$${x}`: a dollar sign, then the value)
      out += '$';
      k += 2;
      continue;
    }
    out += '$';
    k++;
  }
  return out;
}

/**
 * What one `${…}` shows (`interpolate`): `all` as written when the reference does not parse.
 * @param {string} t the text between the braces
 * @param {string} all the whole `${…}`
 * @param {RefReader} read
 */
function refText(t, all, read) {
  const ref = parseRef(t.trim());
  if (typeof ref === 'string') return all;
  const shown = (ref.kind === 'stage' || ref.kind === 'quest') && read.text ? read.text(ref) : undefined;
  if (shown !== undefined) return String(shown);
  const v = read.get(ref);
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
}

/**
 * Which `*` alternative of a `vary` block plays: `count` is how often the block played before.
 * `pick` hashes the key, the day and the count (FNV-1a) and mixes in `seed` — the journey's own
 * (`StoryState.seed`, kept by the save): two journeys pick otherwise, a reload of one replays its
 * picks (runs are atomic). `seed` 0: the fixed picks (a story without a seed, tests).
 * @param {'cycle'|'seq'|'pick'} mode
 * @param {number} n alternatives
 * @param {number} count
 * @param {string} key
 * @param {number} day
 * @param {number} [seed] a u32 (anything else counts as 0)
 */
export function varyIndex(mode, n, count, key, day, seed = 0) {
  if (n <= 1) return 0;
  if (mode === 'cycle') return count % n;
  if (mode === 'seq') return Math.min(count, n - 1);
  let h = 2166136261;
  const s = `${key}|${day}|${count}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const sd = typeof seed === 'number' ? seed >>> 0 : 0;
  if (sd) {
    // the seed, then a full avalanche (murmur3's finaliser): every bit of the seed moves the pick
    h ^= sd;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) % n;
}

// =================================================================================================
// Background runs
// =================================================================================================

/**
 * The commands a **background run** may use (an event with `background: true`, STORY_SCRIPT.md §6):
 * it plays while the player keeps walking — it holds nobody and opens no dialog window — so only
 * commands that need no input and move no one but villagers. Also allowed: `if` / `loop` / `once` /
 * `cycle` / `seq` / `pick` (their blocks are checked line by line). Not allowed: dialogue and
 * `choice` (they need the player), `cutscene`, `camera`, `fade` (the screen and the camera stay the
 * player's), `travel`, `rest`, `shop`, `builtin`, `ending` (they hold or move the player), `time`
 * (a clock jump re-lights the scene and runs the `time` events between at once — a scene change for
 * a run that holds the player). `banner`, `music`, `weather` and `shake` are in: they need no input
 * and move no one (the region banner, the music and the weather change while the player walks
 * anyway; a shake jolts the camera without taking it, as a hit in combat does). `party` is in for
 * `join`, `leave`, `rule` and `set` (a villager joins or leaves, a rule changes — no input);
 * `party menu` is not (`backgroundIssue`: the tactics panel needs the player). The set-piece
 * commands (DRAGON_CAMPAIGN.md §5.5): `pose` (a villager's or a member's, never the player's) and
 * `effect` are in; `shot`, `slowmo`, `flash` and `title` are not (they take the camera, the game's
 * time or the screen).
 * @type {ReadonlySet<string>}
 */
export const BACKGROUND_OPS = new Set([
  'bark', 'emote', 'walk', 'face', 'teleport', 'home', 'wait',
  'set', 'clear', 'var', 'give', 'take', 'quest', 'heal',
  'sfx', 'toast', 'banner', 'music', 'weather', 'shake',
  'call', 'stop', 'break',
  // (`party join` / `leave` / `rule` / `set` — not `party menu`, which needs the player)
  'party',
  // set-piece direction (DRAGON_CAMPAIGN.md §5.5): a villager's or a member's pose — never the
  // player's —, an effect somewhere (nobody hurt, nothing waited for)
  'pose', 'effect',
]);

/** Why a command outside `BACKGROUND_OPS` cannot run in the background. */
const BACKGROUND_REASONS = Object.freeze({
  cutscene: 'a cutscene holds the player',
  camera: 'the camera stays with the player',
  fade: 'a fade takes the screen from the player',
  travel: 'travel takes the player to another level',
  rest: 'resting holds the player',
  shop: 'the shop needs the player',
  builtin: 'a conversation needs the player',
  ending: 'the ending holds the player',
  time: 'a clock jump re-lights the scene and runs the time events at once',
  shot: 'the camera stays with the player',
  slowmo: 'slow motion takes the whole game\'s time from the player',
  flash: 'a flash takes the screen from the player',
  title: 'a title card takes the screen from the player',
  thaw: 'the thaw front changes the whole level under the player',
  toll: 'a toll is a beat of a scene: it rings while the story holds the player',
});

/**
 * Why one node may not run in a background run ('' when it may): dialogue and `choice` never;
 * a command only from `BACKGROUND_OPS`, `walk` / `face` / `teleport` / `pose` never on the player, `party`
 * never as `party menu`.
 * Blocks (`if`, `loop`, `once`, `cycle` / `seq` / `pick`) may — their nodes are asked one by one
 * (`backgroundIssues` walks a tree; the runtime asks before each node it runs, so a script reached
 * through `call` is checked as it runs).
 * @param {ScriptNode} node
 * @returns {string}
 */
export function backgroundIssue(node) {
  switch (node?.t) {
    case 'say': return 'dialogue needs the player';
    case 'choice': return 'a choice needs the player\'s answer';
    case 'if': case 'loop': case 'once': case 'vary': return '';
    case 'cmd': {
      const op = node.op;
      if (!BACKGROUND_OPS.has(op)) return isOwnKey(BACKGROUND_REASONS, op) ? BACKGROUND_REASONS[op] : `"${op}" needs the player`;
      if ((op === 'walk' || op === 'face' || op === 'teleport' || op === 'pose') && isPlayerName(node.args?.who)) return `"${op} player": the player is the player's in the background`;
      if (op === 'party' && node.args?.verb === 'menu') return 'the tactics panel needs the player';
      return '';
    }
    default: return 'not a line a background run knows';
  }
}

/**
 * Visit every node of a script, blocks included (a choice's options, every branch of an `if`,
 * the bodies of `loop` / `once`, the alternatives of `cycle` / `seq` / `pick`), in order.
 * @param {ScriptNode[]|null|undefined} nodes
 * @param {(n: ScriptNode) => void} fn
 */
/**
 * Is `<who>` the player? In any case (`player`, `Player`), as the runtime resolves it — the
 * background lane's guard and the checks use the same test.
 * @param {unknown} s
 */
export function isPlayerName(s) {
  return typeof s === 'string' && s.toLowerCase() === 'player';
}

export function walkNodes(nodes, fn) {
  for (const n of nodes ?? []) {
    fn(n);
    if (n.t === 'choice') for (const o of n.options) walkNodes(o.body, fn);
    else if (n.t === 'if') { for (const b of n.branches) walkNodes(b.body, fn); walkNodes(n.otherwise, fn); }
    else if (n.t === 'loop' || n.t === 'once') walkNodes(n.body, fn);
    else if (n.t === 'vary') for (const a of n.alts) walkNodes(a, fn);
  }
}

/**
 * One text slot of a script (docs/specs/I18N.md §4.2): a text the player reads, numbered `n` in
 * the script's own order. `part`: what of its node it is (a choice's `question` and each `option`,
 * a banner's or a title card's `title` and `subtitle`; else `text`); `kind`: what it is shown as; `held`: whether it
 * holds a text (`holdsText`) — a line holds text when one of its slots does.
 * @typedef {{ n: number, node: ScriptNode, option: ChoiceOption|null, part: 'text'|'question'|'option'|'title'|'subtitle',
 *   kind: 'line'|'choice'|'title', text: string, held: boolean }} TextSlot
 */

/**
 * Does a slot's text hold a text a player reads — the one rule of "a line that holds text"
 * (I18N.md §4.2): a string that is not blank. `parseScript` keys such a line with its tag,
 * `scriptTextSlots` marks its slots `held`, TextKeys.js (`scriptTextLines`, `retagScript`, the
 * checks) tags it and wants its tag.
 * @param {unknown} text
 * @returns {boolean}
 */
export function holdsText(text) {
  return typeof text === 'string' && text.trim() !== '';
}

/**
 * The text slots of a parsed script, numbered in `walkNodes` order (a choice's question and its
 * options at the choice, before the options' blocks): a `say` 1 (its text; the speaker is a name,
 * translated as a term), a `choice` 1 for the question and 1 per option, a `bark` / `toast` 1, a
 * `banner` and a `title` card 2 each (title, subtitle), a `quest … stage` 1 (a `quest … start` title is a name: none), an
 * `ending` 1. A slot is numbered even when its text is blank (`held` false: the extractor skips
 * it; a blank banner subtitle does not move the keys after it). The extractor (ContentStrings.js)
 * lists them by their line's tag.
 * @param {ScriptNode[]} nodes
 * @returns {TextSlot[]}
 */
export function scriptTextSlots(nodes) {
  /** @type {TextSlot[]} */
  const out = [];
  /**
   * @param {ScriptNode} node
   * @param {ChoiceOption|null} option
   * @param {TextSlot['part']} part
   * @param {TextSlot['kind']} kind
   * @param {unknown} text
   */
  const slot = (node, option, part, kind, text) => out.push({ n: out.length, node, option, part, kind, text: typeof text === 'string' ? text : '', held: holdsText(text) });
  walkNodes(nodes, (n) => {
    if (n.t === 'say') slot(n, null, 'text', 'line', n.text);
    else if (n.t === 'choice') {
      slot(n, null, 'question', 'line', n.text);
      for (const o of n.options) slot(n, o, 'option', 'choice', o.label);
    } else if (n.t === 'cmd') {
      const a = n.args ?? {};
      if (n.op === 'bark' || n.op === 'toast') slot(n, null, 'text', 'line', a.text);
      else if (n.op === 'banner' || n.op === 'title') { slot(n, null, 'title', 'title', a.title); slot(n, null, 'subtitle', 'title', a.subtitle); }
      else if (n.op === 'quest' && a.verb === 'stage') slot(n, null, 'text', 'line', a.text);
      else if (n.op === 'ending') slot(n, null, 'title', 'title', a.title);
    }
  });
  return out;
}

/**
 * Every node of a script a background run cannot play (`backgroundIssue`), by line — also inside
 * blocks, a choice's options included. Scripts it `call`s are not followed (the campaign check
 * does that; the runtime asks node by node).
 * @param {ScriptNode[]} nodes
 * @returns {{ line: number, msg: string }[]}
 */
export function backgroundIssues(nodes) {
  /** @type {{ line: number, msg: string }[]} */
  const out = [];
  walkNodes(nodes, (n) => {
    const msg = backgroundIssue(n);
    if (msg) out.push({ line: n.line, msg });
  });
  return out.sort((a, b) => a.line - b.line);
}
