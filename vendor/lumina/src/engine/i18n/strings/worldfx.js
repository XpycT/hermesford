/**
 * UI strings, namespace 'worldfx' (docs/specs/I18N.md §2): the world labels of a combat level
 * (src/engine/ui/WorldLabels.js) — the floating words a hit can show instead of a number, and the
 * level label over an elite's bar. Owner: B-worldfx (docs/specs/PIXEL_UI.md §8). A feature
 * namespace: registered by the WorldLabels constructor (the combat chunk), so a peaceful level
 * never loads it. Import-free (the i18n checker reads it in Node).
 *
 * Keys are ids, not English; each language a table of key → string. "Lv" stays Latin in every
 * language (I18N.md §2: HP, MP, SP, XP, Lv, G stay in Latin script, as JRPGs do).
 */
/** @type {import('../I18n.js').StringTable} */
const table = {
  en: {
    // a blocked hit (an enemy's guard, a companion's blocked swing): the number's place
    guard: 'Guard',
    // a perfect dodge (the i-frame roll at the last moment), over the player
    perfect: 'Perfect!',
    // the level label before an elite's level number ("Lv 3 BRAMBLE GOBLIN CAPTAIN")
    lv: 'Lv',
  },
  ja: {
    guard: 'ガード',
    perfect: 'ジャスト回避！',
    lv: 'Lv',
  },
  zh: {
    guard: '格挡',
    perfect: '完美闪避！',
    lv: 'Lv',
  },
};
export default table;
