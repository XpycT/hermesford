/**
 * UI strings, namespace 'hud' (docs/specs/I18N.md §2): the HUD (location plate, clock, controls
 * legend, toasts), the area banner. Owner: B-hud (docs/specs/PIXEL_UI.md §8). A core namespace:
 * registered by the UI root (strings/index.js), so `t('hud.<key>')` works on every page with a UI.
 *
 * Keys are ids, not English; each language a table of key → string (`{var}` slots) or function.
 * - `controls`, `hide`: the legend's heading and its footer ([H] Hide controls; the gap after the
 *   keycap is CSS, never a space in the string); `show`: the folded legend's tab ([H] Show controls).
 * - `control.<id>`: the labels of the HUD's default legend (`DEFAULT_CONTROLS` ids). The game's own
 *   legend rows (src/game/Game.js, combat bindings) are translated by their owners and passed in;
 *   these ids are free for them to reuse where the words are the same. The words are the game's
 *   (strings/game.js `controls.*`, the canonical legend vocabulary, I18N_GLOSSARY.md): one key
 *   reads the same in every legend.
 * - `phase.<id>`: the clock's phases (`timePhase()` ids; the glossary, I18N_GLOSSARY.md §6).
 * - `key.<left|up|right|down>`: the arrow keycaps' accessible names (`createKeycaps`).
 * - `clock`: the clock's accessible name.
 * Key names on keycaps (Space, Shift, Esc …) stay Latin in every language and are not here.
 */
/** @type {import('../I18n.js').StringTable} */
const table = {
  en: {
    controls: 'Controls',
    hide: 'Hide controls',
    show: 'Show controls',
    'control.move': 'Move',
    'control.run': 'Run',
    'control.talk': 'Talk / Confirm',
    'control.choose': 'Choose an answer',
    'control.rotate': 'Rotate camera',
    'control.zoom': 'Zoom (or wheel)',
    'control.map': 'World map',
    'control.time': 'Time of day',
    'control.weather': 'Weather',
    'control.photo': 'Photo mode',
    'control.music': 'Music',
    'control.debug': 'Debug panel',
    'phase.night': 'Night',
    'phase.dawn': 'Dawn',
    'phase.morning': 'Morning',
    'phase.midday': 'Midday',
    'phase.afternoon': 'Afternoon',
    'phase.golden': 'Golden Hour',
    'phase.dusk': 'Dusk',
    'key.left': 'Left arrow',
    'key.up': 'Up arrow',
    'key.right': 'Right arrow',
    'key.down': 'Down arrow',
    clock: '{time}, {phase}',
  },
  ja: {
    controls: '操作',
    hide: '操作説明を隠す',
    show: '操作説明を表示',
    'control.move': '移動',
    'control.run': 'ダッシュ',
    'control.talk': '話す／決定',
    'control.choose': '答えを選ぶ',
    'control.rotate': 'カメラ回転',
    'control.zoom': 'ズーム（ホイールも可）',
    'control.map': 'ワールドマップ',
    'control.time': '時間帯',
    'control.weather': '天気',
    'control.photo': 'フォトモード',
    'control.music': '音楽',
    'control.debug': 'デバッグパネル',
    'phase.night': '夜',
    'phase.dawn': '夜明け',
    'phase.morning': '朝',
    'phase.midday': '真昼',
    'phase.afternoon': '昼下がり',
    'phase.golden': '夕映え',
    'phase.dusk': '黄昏',
    'key.left': '左矢印',
    'key.up': '上矢印',
    'key.right': '右矢印',
    'key.down': '下矢印',
    clock: '{time}、{phase}',
  },
  zh: {
    controls: '操作',
    hide: '隐藏操作说明',
    show: '显示操作说明',
    'control.move': '移动',
    'control.run': '奔跑',
    'control.talk': '交谈／确认',
    'control.choose': '选择回答',
    'control.rotate': '旋转镜头',
    'control.zoom': '缩放（或滚轮）',
    'control.map': '世界地图',
    'control.time': '时段',
    'control.weather': '天气',
    'control.photo': '拍照模式',
    'control.music': '音乐',
    'control.debug': '调试面板',
    'phase.night': '夜晚',
    'phase.dawn': '黎明',
    'phase.morning': '清晨',
    'phase.midday': '正午',
    'phase.afternoon': '午后',
    'phase.golden': '夕照',
    'phase.dusk': '黄昏',
    'key.left': '左箭头',
    'key.up': '上箭头',
    'key.right': '右箭头',
    'key.down': '下箭头',
    clock: '{time}，{phase}',
  },
};
export default table;
