import { CHARACTER_PRESETS } from '../../engine/pixel/CharacterSprites.js';
import { classForWeapon } from '../../engine/level/PartyRules.js';
import { isOwnKey } from '../../engine/utils/own.js';

/**
 * Where a hero class can fight — what decides that a class's look package exists on a combat level
 * (`CombatSystem.load`): the ice mage's (src/game/party/IceSpellFx.js), the cleric's and the
 * greatshield's (their chunks, programs and draw calls). The combat VFX lights their spells take
 * (src/engine/lighting/VfxLights.js) do not depend on it: every game has them.
 */

/**
 * A party member of class `cls` can fight on this level (CombatSystem.load makes that class's look
 * only then — no program, draw call or object anywhere else): a record of the party (the story's or
 * the party's own) is of that class, a villager of the level carries its weapon (`classForWeapon`:
 * a plain `party join` makes it one), or a script line of the level's events and talk or of the
 * campaign's story files joins someone `as <cls>`.
 * @param {string} cls a party class (`PARTY_CLASSES`: 'icemage', 'cleric', 'greatshield' …)
 * @param {{ objects?: any[] }} level
 * @param {{ scripts?: Record<string, { lines?: unknown }> }|null|undefined} story the campaign's story files
 * @param {readonly { cls?: unknown }[]|null|undefined} records the party's records
 * @returns {boolean}
 */
export function classMayFight(cls, level, story, records) {
  if (Array.isArray(records) && records.some((r) => r?.cls === cls)) return true;
  const join = joinLine(cls);
  /** @type {(lines: unknown) => boolean} */
  const joins = (lines) => Array.isArray(lines) && lines.some((l) => typeof l === 'string' && join.test(l));
  for (const o of Array.isArray(level?.objects) ? level.objects : []) {
    if (o?.type === 'npc') {
      const spec = o.spec && typeof o.spec === 'object' ? o.spec : null;
      const preset = typeof o.preset === 'string' && isOwnKey(CHARACTER_PRESETS, o.preset) ? CHARACTER_PRESETS[o.preset] : null;
      if (classForWeapon(spec?.weapon ?? preset?.weapon ?? null) === cls || joins(o.talk)) return true;
    } else if (o?.type === 'event' && joins(o.run)) return true;
  }
  for (const s of Object.values(story?.scripts ?? {})) if (joins(s?.lines)) return true;
  return false;
}

/** A script line that joins someone as `cls` (`party join <who> as <cls> …`; also a `*` alternative), per class. @type {Map<string, RegExp>} */
const JOIN_LINES = new Map();
/** @param {string} cls @returns {RegExp} */
function joinLine(cls) {
  let re = JOIN_LINES.get(cls);
  if (!re) {
    re = new RegExp(String.raw`^\s*(?:\*\s+)?party\s+join\s+.*\bas\s+${cls.replace(/[^A-Za-z0-9_-]/g, '')}\b`, 'i');
    JOIN_LINES.set(cls, re);
  }
  return re;
}
