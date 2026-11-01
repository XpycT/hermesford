/**
 * UI strings, namespace 'dialog' (docs/specs/I18N.md §2): the dialog box, its choices and the
 * interaction prompt. Owner: B-dialog (docs/specs/PIXEL_UI.md §8). A core namespace: registered by
 * the UI root (strings/index.js), so `t('dialog.<key>')` works on every page with a UI (DialogBox and
 * InteractPrompt register it themselves when they are made without a UI root).
 *
 * Keys are ids, not English; each language a table of key → string (`{var}` slots) or function.
 * The words follow the glossary (docs/specs/I18N_GLOSSARY.md §6: talk 話す / 交谈).
 *
 * - `window`      the dialog window's accessible name (role="dialog")
 * - `choices`     the choice list's accessible name
 * - `portrait`    the portrait's accessible name ({name}: the speaker, as shown)
 * - `next`        the advance mark (▼: more to read)
 * - `end`         the last line's mark (◆: the conversation ends)
 * - `prompt.talk` the prompt's default label (`InteractPrompt.show(pos)` without one; the game
 *                 passes its own translated verbs)
 */
/** @type {import('../I18n.js').StringTable} */
const table = {
  en: {
    window: 'Dialogue',
    choices: 'Choices',
    portrait: 'Portrait of {name}',
    next: 'More',
    end: 'End',
    'prompt.talk': 'Talk',
  },
  ja: {
    window: '会話',
    choices: '選択肢',
    portrait: '{name}の肖像',
    next: '次へ',
    end: '終わり',
    'prompt.talk': '話す',
  },
  zh: {
    window: '对话',
    choices: '选项',
    portrait: '{name}的肖像',
    next: '继续',
    end: '结束',
    'prompt.talk': '交谈',
  },
};
export default table;
