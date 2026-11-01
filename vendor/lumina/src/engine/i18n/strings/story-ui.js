/**
 * UI strings, namespace 'story-ui' (docs/specs/I18N.md §2): the story UI — the journal, the end
 * card, the cutscene's skip hint. Owner: B-story (docs/specs/PIXEL_UI.md §8). A feature namespace:
 * registered by the story UI when `UI.useStoryUI()` makes it (the journal, emotes and end card
 * register it in their constructors: this file travels in the story chunk, never in what a level
 * without a story loads).
 *
 * Keys are ids, not English; each language a table of key → string (`{var}` slots) or function.
 * `{key}` is a keycap slot: the component draws the key there as a keycap (never a word in the
 * sentence). Import-free: the i18n checker reads it in Node.
 *
 * Terms (docs/specs/I18N.md §3; the journal 日誌 / 日志 per docs/specs/I18N_GLOSSARY.md §6, which
 * the controls legend's "Journal" must match): Select 選択 / 选择 and Close 閉じる / 关闭 as the
 * tactics panel's hints, key items だいじなもの / 重要物品.
 */
/** @type {import('../I18n.js').StringTable} */
const table = {
  en: {
    // the journal's window
    'journal.title': 'Journal',
    'tab.quests': 'Quests',
    'tab.items': 'Items',
    'group.active': 'Active',
    'group.concluded': 'Concluded',
    'group.keyItems': 'Key Items',
    'group.items': 'Items',
    'state.active': 'In progress',
    'state.done': 'Completed',
    'state.failed': 'Failed',
    'empty.quests': 'No quests yet.',
    'empty.items': 'Your pack is empty.',
    /** the empty tabs' hints, under their line (the journal's empty state) */
    'empty.questsHint': 'What the people you meet ask of you is written here.',
    'empty.itemsHint': 'What you find and are given is kept here.',
    objectives: 'Objectives',
    log: 'Log',
    keyItem: 'Key Item',
    unknownItem: 'Nothing more is known of it.',
    /** an item's count (the list and the item's heading) */
    count: '×{n}',
    /** the gold's unit (Latin in every language) */
    gold: 'G',
    // the journal's key hints (in its header)
    'hint.tabs': 'Tabs',
    'hint.select': 'Select',
    'hint.close': 'Close',
    // the end card's prompt (shown once input is accepted; {key} the keycap)
    'end.prompt': 'Press {key} to continue',
    // the cutscene's skip hint ({key} the keycap)
    'skip.hold': 'Hold {key} to skip',
  },
  ja: {
    'journal.title': '日誌',
    'tab.quests': 'クエスト',
    'tab.items': 'アイテム',
    'group.active': '進行中',
    'group.concluded': '終了',
    'group.keyItems': 'だいじなもの',
    'group.items': 'アイテム',
    'state.active': '進行中',
    'state.done': '達成',
    'state.failed': '失敗',
    'empty.quests': 'まだクエストはない。',
    'empty.items': 'かばんは空っぽだ。',
    'empty.questsHint': '出会った人々に頼まれたことは、ここに記される。',
    'empty.itemsHint': '見つけた物や受け取った物は、ここにしまわれる。',
    objectives: '目標',
    log: '記録',
    keyItem: 'だいじなもの',
    unknownItem: 'それ以上のことは分からない。',
    count: '×{n}',
    gold: 'G',
    'hint.tabs': '切替',
    'hint.select': '選択',
    'hint.close': '閉じる',
    'end.prompt': '{key}で続ける',
    'skip.hold': '{key}長押しでスキップ',
  },
  zh: {
    'journal.title': '日志',
    'tab.quests': '任务',
    'tab.items': '物品',
    'group.active': '进行中',
    'group.concluded': '已结束',
    'group.keyItems': '重要物品',
    'group.items': '物品',
    'state.active': '进行中',
    'state.done': '已完成',
    'state.failed': '失败',
    'empty.quests': '暂无任务。',
    'empty.items': '背包空空如也。',
    'empty.questsHint': '旅途中受人所托之事，都会记在这里。',
    'empty.itemsHint': '找到或收到的物品，都会收在这里。',
    objectives: '目标',
    log: '记录',
    keyItem: '重要物品',
    unknownItem: '除此之外一无所知。',
    count: '×{n}',
    gold: 'G',
    'hint.tabs': '切换',
    'hint.select': '选择',
    'hint.close': '关闭',
    'end.prompt': '按{key}继续',
    'skip.hold': '长按{key}跳过',
  },
};
export default table;
