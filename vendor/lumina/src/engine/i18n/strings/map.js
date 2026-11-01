/**
 * UI strings, namespace 'map' (docs/specs/I18N.md §2): the minimap and the world map. Owner: B-map
 * (docs/specs/PIXEL_UI.md §8). A core namespace: registered by the UI root (strings/index.js), so
 * `t('map.<key>')` works on every page with a UI.
 *
 * Keys are ids, not English; each language a table of key → string (`{var}` slots) or function.
 * The compass letter stays Latin in every language (I18N.md §2: key names and abbreviations), as
 * does each keycap; the legend's words follow the glossary (docs/specs/I18N_GLOSSARY.md §6:
 * 道標石 / 路标石 for the waystone, as in 四つ辻の道標石 / 十字路口的路标石). Region names, the map's
 * title and subtitle arrive translated from the game (PIXEL_UI.md §8.1); the world map only sets
 * them (in capitals in English: CJK has no case).
 */
/** @type {import('../I18n.js').StringTable} */
const table = {
  en: {
    /** the minimap's compass letter (Latin in every language) */
    north: 'N',
    /** the world map's small tracked label, before the map's title */
    title: 'World Map',
    /** the legend's section heading */
    legend: 'Legend',
    'legend.you': 'You',
    'legend.villager': 'Villager',
    'legend.companion': 'Companion',
    /** one row for the three small gems (signs, doors and wells): a list, the language's own separator */
    'legend.poi': 'Sign · door · well',
    'legend.campfire': 'Campfire',
    'legend.enemy': 'Enemy',
    'legend.waystone': 'Waystone',
    'legend.chest': 'Chest',
    'legend.building': 'Building',
    'legend.road': 'Road',
    'legend.water': 'Water',
    'legend.forest': 'Forest',
    /** the section heading over the region the player stands in (the region's name under it) */
    here: 'You are in',
    /** the key hint's label after N, Tab and Esc */
    close: 'Close',
    /** the world map window's accessible name */
    aria: 'World map',
  },
  ja: {
    north: 'N',
    title: 'ワールドマップ',
    legend: '凡例',
    'legend.you': '現在地',
    'legend.villager': '村人',
    'legend.companion': '仲間',
    'legend.poi': '立て札・扉・井戸',
    'legend.campfire': '焚き火',
    'legend.enemy': '敵',
    'legend.waystone': '道標石',
    'legend.chest': '宝箱',
    'legend.building': '建物',
    'legend.road': '道',
    'legend.water': '水辺',
    'legend.forest': '森',
    here: '現在のエリア',
    close: '閉じる',
    aria: 'ワールドマップ',
  },
  zh: {
    north: 'N',
    title: '世界地图',
    legend: '图例',
    'legend.you': '当前位置',
    'legend.villager': '村民',
    'legend.companion': '同伴',
    'legend.poi': '指示牌 · 门 · 水井',
    'legend.campfire': '篝火',
    'legend.enemy': '敌人',
    'legend.waystone': '路标石',
    'legend.chest': '宝箱',
    'legend.building': '建筑',
    'legend.road': '道路',
    'legend.water': '水域',
    'legend.forest': '森林',
    here: '当前区域',
    close: '关闭',
    aria: '世界地图',
  },
};
export default table;
