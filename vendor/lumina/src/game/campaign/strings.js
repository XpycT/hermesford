/**
 * UI strings, namespace 'campaign' (docs/specs/I18N.md §2): the campaign runtime's own messages —
 * the loading line, the refusals and failures of a travel, the save error and the title screen's
 * Continue / New journey menu. Owner: G-story (docs/specs/PIXEL_UI.md §8). A feature namespace:
 * registered when a campaign starts (CampaignStart, CampaignRuntime), so a single level never loads
 * it. Import-free and Node-safe (the i18n checker reads it).
 *
 * What the campaign and its levels say (names, chapter titles, an exit's `locked` lines) is
 * content, translated at display (`term` / `loc`, I18N.md §4); the code default standing in for
 * blank `locked` data is a UI string here (`exit.closed`, §4.8). "Lv" stays Latin in every
 * language.
 */
/** @type {import('../../engine/i18n/I18n.js').StringTable} */
const table = {
  en: {
    loading: 'Opening the campaign',
    'exit.nowhere': 'This way leads nowhere yet.',
    /** an exit whose `requires` does not hold, with no `locked` lines */
    'exit.closed': 'The way is closed.',
    /** {place}: the level's name (translated) */
    'travel.failed': 'The way to {place} could not be opened.',
    /** a level whose name is not known (its file did not load) */
    'travel.failedUnknown': 'The way could not be opened.',
    'save.failed': 'The game could not be saved (browser storage is full or off)',
    'title.continue': 'Continue',
    'title.newJourney': 'New journey',
    /** the Continue entry's second line: where the save is, the combat level, the time played */
    'title.save': '{place} · Lv {level} · {time}',
    'title.saveNoLevel': '{place} · {time}',
  },
  ja: {
    loading: 'キャンペーンを読み込み中',
    'exit.nowhere': 'この先へはまだ行けない。',
    'exit.closed': 'この先へは進めない。',
    'travel.failed': '{place}への道を開けなかった。',
    'travel.failedUnknown': '道を開けなかった。',
    'save.failed': 'ゲームを保存できませんでした（ブラウザの保存領域がいっぱいか、無効です）',
    'title.continue': '続きから',
    'title.newJourney': '新たな旅',
    'title.save': '{place}・Lv {level}・{time}',
    'title.saveNoLevel': '{place}・{time}',
  },
  zh: {
    loading: '正在载入战役',
    'exit.nowhere': '此路暂时不通。',
    'exit.closed': '此路不通。',
    'travel.failed': '无法打开通往{place}的道路。',
    'travel.failedUnknown': '无法打开这条道路。',
    'save.failed': '无法保存游戏（浏览器存储已满或已关闭）',
    'title.continue': '继续游戏',
    'title.newJourney': '新的旅程',
    'title.save': '{place} · Lv {level} · {time}',
    'title.saveNoLevel': '{place} · {time}',
  },
};
export default table;
