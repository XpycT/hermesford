/**
 * The party's rule vocabulary (docs/specs/PARTY.md §3): the combat rule a party member fights by,
 * its fields and their values, the presets, the member classes — names and labels only. Import-free
 * and Node-safe: the story's parser and checks (`party rule <who> <preset>`, `party set …`), the
 * game, the tactics panel and the tools read it. The numbers behind the names (how far `mid` is,
 * when `half` heals, a class's stats and moves) are the game's: src/game/party/rules.js.
 */

/** At most this many members besides the player. */
export const MAX_PARTY = 3;

/**
 * A rule's fields, in the tactics panel's order: each one's label, its values (the first is not a
 * default — the presets give every field) and a label and a help line per value.
 * @type {Readonly<Record<string, { label: string, help: string, values: readonly string[],
 *   labels: Readonly<Record<string, string>>, hints: Readonly<Record<string, string>> }>>}
 */
export const RULE_FIELDS = Object.freeze({
  target: Object.freeze({
    label: 'Target',
    help: 'Which foe to go for.',
    values: Object.freeze(['leader', 'nearest', 'weakest', 'strongest', 'ranged']),
    labels: Object.freeze({ leader: "Leader's foe", nearest: 'Nearest', weakest: 'Weakest', strongest: 'Strongest', ranged: 'Archers & casters' }),
    hints: Object.freeze({
      leader: 'The foe you lock on to, else the one nearest you.',
      nearest: 'Whatever foe is closest to them.',
      weakest: 'The foe with the least health left — finish it off.',
      strongest: 'Elites and the boss first, then the toughest foe.',
      ranged: 'Archers and shamans first, then the nearest foe.',
    }),
  }),
  distance: Object.freeze({
    label: 'Distance',
    help: 'How far from you they range in a fight.',
    values: Object.freeze(['close', 'mid', 'far']),
    labels: Object.freeze({ close: 'Stay close', mid: 'Mid range', far: 'Range far' }),
    hints: Object.freeze({
      close: 'Never far from your side.',
      mid: 'Within a few strides of you.',
      far: 'Free to chase foes well away from you.',
    }),
  }),
  attack: Object.freeze({
    label: 'Attack',
    help: 'When to attack.',
    values: Object.freeze(['free', 'assist', 'never']),
    labels: Object.freeze({ free: 'Freely', assist: 'Assist only', never: 'Never' }),
    hints: Object.freeze({
      free: 'Any foe in range.',
      assist: 'Only foes that fight you or the party.',
      never: 'They do not attack.',
    }),
  }),
  skills: Object.freeze({
    label: 'Skills',
    help: 'Using their combat skills (heals are set apart).',
    values: Object.freeze(['free', 'save', 'never']),
    labels: Object.freeze({ free: 'Use freely', save: 'Save mana', never: 'Never' }),
    hints: Object.freeze({
      free: 'Whenever a skill is ready.',
      save: 'Only with mana to spare for healing.',
      never: 'Basic attacks only.',
    }),
  }),
  heal: Object.freeze({
    label: 'Heal',
    help: 'When to heal you or the party.',
    values: Object.freeze(['never', 'low', 'half', 'often']),
    labels: Object.freeze({ never: 'Never', low: 'When low', half: 'Below half', often: 'Often' }),
    hints: Object.freeze({
      never: 'They keep their mana for fighting.',
      low: 'Someone is close to falling.',
      half: 'Someone is below half health.',
      often: 'At the first wounds.',
    }),
  }),
  evade: Object.freeze({
    label: 'Evade',
    help: 'Rolling out of a foe’s marked attacks.',
    values: Object.freeze(['on', 'off']),
    labels: Object.freeze({ on: 'Dodge attacks', off: 'Stand firm' }),
    hints: Object.freeze({
      on: 'They roll out of marked attacks.',
      off: 'They hold their ground and take the hit.',
    }),
  }),
  retreat: Object.freeze({
    label: 'Fall back',
    help: 'Falling back to you when hurt.',
    values: Object.freeze(['never', 'low', 'half']),
    labels: Object.freeze({ never: 'Never', low: 'When low', half: 'Below half' }),
    hints: Object.freeze({
      never: 'They fight on to the end.',
      low: 'Behind you when close to falling.',
      half: 'Behind you below half health.',
    }),
  }),
});

/** The rule fields in order. */
export const RULE_KEYS = Object.freeze(Object.keys(RULE_FIELDS));

/**
 * A member's combat rule: one value of each `RULE_FIELDS` field.
 * @typedef {{ target: string, distance: string, attack: string, skills: string, heal: string,
 *   evade: string, retreat: string }} PartyRule
 */

/**
 * The presets the player (the tactics panel) and the story (`party rule <who> <preset>`) choose
 * from, in the panel's order.
 * @type {Readonly<Record<string, { label: string, help: string, rule: Readonly<PartyRule> }>>}
 */
export const PARTY_PRESETS = Object.freeze({
  balanced: Object.freeze({
    label: 'Balanced',
    help: 'Fights your foes at mid range, heals when someone is low, dodges marked attacks.',
    rule: Object.freeze({ target: 'leader', distance: 'mid', attack: 'free', skills: 'free', heal: 'low', evade: 'on', retreat: 'low' }),
  }),
  aggressive: Object.freeze({
    label: 'All-Out',
    help: 'Charges the nearest foe, spends every skill, never heals or falls back.',
    rule: Object.freeze({ target: 'nearest', distance: 'far', attack: 'free', skills: 'free', heal: 'never', evade: 'off', retreat: 'never' }),
  }),
  guardian: Object.freeze({
    label: 'Guard Me',
    help: 'Stays at your side and strikes whatever comes for you.',
    rule: Object.freeze({ target: 'leader', distance: 'close', attack: 'assist', skills: 'save', heal: 'half', evade: 'on', retreat: 'low' }),
  }),
  support: Object.freeze({
    label: 'Support',
    help: 'Keeps you standing: heals often, fights only what fights back.',
    rule: Object.freeze({ target: 'leader', distance: 'mid', attack: 'assist', skills: 'save', heal: 'often', evade: 'on', retreat: 'half' }),
  }),
  hunter: Object.freeze({
    label: 'Hunt Casters',
    help: 'Ranges far to bring down archers and shamans first.',
    rule: Object.freeze({ target: 'ranged', distance: 'far', attack: 'free', skills: 'free', heal: 'low', evade: 'on', retreat: 'low' }),
  }),
  passive: Object.freeze({
    label: 'Hold Back',
    help: 'Does not fight: stays close, dodges and heals.',
    rule: Object.freeze({ target: 'leader', distance: 'close', attack: 'never', skills: 'never', heal: 'half', evade: 'on', retreat: 'half' }),
  }),
});

/** The preset names in order. */
export const PRESET_NAMES = Object.freeze(Object.keys(PARTY_PRESETS));

/** A new member's rule unless the story names one. */
export const DEFAULT_PRESET = 'balanced';

/**
 * The member classes (`party join <who> as <class>`): the weapon its combat sheet draws and its
 * role; the stats and moves are the game's (src/game/party/rules.js `CLASS_STATS`). The last three
 * are Vanquish the Evil Dragon's heroes (docs/contracts/DRAGON_CAMPAIGN.md §5.4, §6.8).
 * @type {Readonly<Record<string, { label: string, weapon: string, role: 'melee'|'ranged'|'caster', help: string }>>}
 */
export const PARTY_CLASSES = Object.freeze({
  warden: Object.freeze({ label: 'Warden', weapon: 'spear', role: 'melee', help: 'Spear thrusts up close, a sweeping strike, and Mend to heal.' }),
  ranger: Object.freeze({ label: 'Ranger', weapon: 'bow', role: 'ranged', help: 'Arrows from range, a volley, and Mend to heal.' }),
  mystic: Object.freeze({ label: 'Mystic', weapon: 'staff', role: 'caster', help: 'Ember bolts, a flare that bursts on foes, and a stronger Mend.' }),
  cleric: Object.freeze({ label: 'Cleric', weapon: 'holystaff', role: 'caster', help: 'Holy bolts, Judgement’s pillars of light, Sanctuary’s healing circle, a strong heal; raises the fallen.' }),
  icemage: Object.freeze({ label: 'Ice Mage', weapon: 'icestaff', role: 'caster', help: 'Frost lances that chill, a Blizzard that slows a crowd, and Glacial Tomb’s ring of freezing ice.' }),
  greatshield: Object.freeze({ label: 'Greatshield', weapon: 'greatshield', role: 'melee', help: 'Shield bash and mace, unshaken by blows; Bulwark taunts and wards, Earthshatter knocks foes down.' }),
});

/** The class names in order. */
export const CLASS_NAMES = Object.freeze(Object.keys(PARTY_CLASSES));

/** @param {unknown} name @returns {boolean} */
export function isPreset(name) {
  return typeof name === 'string' && Object.hasOwn(PARTY_PRESETS, name);
}

/** @param {unknown} name @returns {boolean} */
export function isClass(name) {
  return typeof name === 'string' && Object.hasOwn(PARTY_CLASSES, name);
}

/** @param {unknown} field @returns {boolean} */
export function isRuleField(field) {
  return typeof field === 'string' && Object.hasOwn(RULE_FIELDS, field);
}

/** @param {unknown} field @param {unknown} value @returns {boolean} */
export function isRuleValue(field, value) {
  return isRuleField(field) && typeof value === 'string' && RULE_FIELDS[/** @type {string} */ (field)].values.includes(value);
}

/**
 * The class a villager joins as when the story names none: by the weapon its sprite carries (a
 * bow: ranger, a staff: mystic, a holy staff: cleric, an ice staff: ice mage, a great shield:
 * greatshield, anything else: warden).
 * @param {unknown} weapon
 * @returns {string}
 */
export function classForWeapon(weapon) {
  if (weapon === 'bow') return 'ranger';
  if (weapon === 'staff') return 'mystic';
  if (weapon === 'holystaff') return 'cleric';
  if (weapon === 'icestaff') return 'icemage';
  if (weapon === 'greatshield') return 'greatshield';
  return 'warden';
}

/**
 * A copy of a preset's rule, or null for a name that is no preset.
 * @param {unknown} name
 * @returns {PartyRule|null}
 */
export function ruleOfPreset(name) {
  return isPreset(name) ? { ...PARTY_PRESETS[/** @type {string} */ (name)].rule } : null;
}

/**
 * A full, valid rule from anything (a save, a story, the panel): every known field with a valid
 * value is kept, the rest comes from `base` (the default preset's rule). Unknown keys are dropped.
 * @param {unknown} rule
 * @param {PartyRule} [base]
 * @returns {PartyRule}
 */
export function normalizeRule(rule, base = PARTY_PRESETS[DEFAULT_PRESET].rule) {
  const src = rule && typeof rule === 'object' ? /** @type {Record<string, unknown>} */ (rule) : {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const k of RULE_KEYS) {
    const v = Object.hasOwn(src, k) ? src[k] : undefined;
    out[k] = isRuleValue(k, v) ? /** @type {string} */ (v) : base[k];
  }
  return /** @type {PartyRule} */ (out);
}

/**
 * The preset a rule matches field for field, or 'custom'.
 * @param {PartyRule} rule
 * @returns {string}
 */
export function presetOf(rule) {
  for (const name of PRESET_NAMES) {
    const p = PARTY_PRESETS[name].rule;
    if (RULE_KEYS.every((k) => p[k] === rule?.[k])) return name;
  }
  return 'custom';
}

/**
 * The label of a rule: its preset's, else 'Custom'.
 * @param {PartyRule} rule
 * @returns {string}
 */
export function ruleLabel(rule) {
  const p = presetOf(rule);
  return p === 'custom' ? 'Custom' : PARTY_PRESETS[p].label;
}
