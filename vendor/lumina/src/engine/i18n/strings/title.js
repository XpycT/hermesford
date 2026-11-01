/**
 * UI strings, namespace 'title' (docs/specs/I18N.md §2): the title screen. Owner: B-title
 * (docs/specs/PIXEL_UI.md §8). A core namespace: registered by the UI root (strings/index.js), so
 * `t('title.<key>')` works on every page with a UI.
 *
 * Keys are ids, not English; each language a table of key → string (`{var}` slots) or function.
 * Key names stay Latin in every language (they are drawn as keycaps beside these words, never inside
 * them: the gap after a keycap is the layout's, so no entry starts with a space).
 *
 * - `name`: the title's default text when the caller gives none (the engine's name: a brand, not
 *   translated).
 * - `pressAnyKey`: the prompt of a title without a menu; a level passes its own
 *   `environment.title.prompt` ("Press any key" in the shipped levels), translated by the level's
 *   content table under the text key the level holds for it (its `textKeys['title.prompt']`,
 *   docs/specs/I18N.md §4.2) — a blank one is the UI string `game.default.prompt`; both must agree
 *   with these.
 * - `credit`: the footer when the caller gives none.
 * - `chooseLevel`: the label after the ← → keycaps under the level chooser.
 * - `travelTo`: the prompt (after the Enter / A keycaps) once another level is chosen.
 * - `prevLevel` / `nextLevel`: the chooser's arrows (aria labels).
 * - `choose` / `start`: the menu's key hints (↑ ↓ Choose · Space Start), as mockup G.
 * - `menu`: the menu's aria label.
 * - `language`: the language row (its aria label and the hint while it has the focus).
 * - `langSwitch` / `langBack`: the language row's hints while it has the focus (Enter Switch · Esc
 *   Back).
 */
/** @type {import('../I18n.js').StringTable} */
const table = {
  en: {
    name: 'Luminati',
    pressAnyKey: 'Press any key',
    credit: 'Luminati 2.5D Pixel-Art Engine · three.js',
    chooseLevel: 'Choose a level',
    travelTo: 'Travel to {label}',
    prevLevel: 'Previous level',
    nextLevel: 'Next level',
    choose: 'Choose',
    start: 'Start',
    menu: 'Title menu',
    language: 'Language',
    langSwitch: 'Switch',
    langBack: 'Back',
  },
  ja: {
    name: 'Luminati',
    pressAnyKey: '何かキーを押してください',
    credit: 'Luminati 2.5D ピクセルアートエンジン・three.js',
    chooseLevel: '行き先を選ぶ',
    travelTo: '{label}へ向かう',
    prevLevel: '前の行き先',
    nextLevel: '次の行き先',
    choose: '選択',
    start: '決定',
    menu: 'タイトルメニュー',
    language: '言語',
    langSwitch: '切り替え',
    langBack: '戻る',
  },
  zh: {
    name: 'Luminati',
    pressAnyKey: '按任意键开始',
    credit: 'Luminati 2.5D 像素艺术引擎 · three.js',
    chooseLevel: '选择目的地',
    travelTo: '前往{label}',
    prevLevel: '上一个目的地',
    nextLevel: '下一个目的地',
    choose: '选择',
    start: '开始',
    menu: '标题菜单',
    language: '语言',
    langSwitch: '切换',
    langBack: '返回',
  },
};
export default table;
