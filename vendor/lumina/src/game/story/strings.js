/**
 * UI strings, namespace 'story' (docs/specs/I18N.md §2): the story runtime's own messages — the
 * toasts that say what changed hands and how a quest stands. Owner: G-story (docs/specs/PIXEL_UI.md
 * §8). A feature namespace: registered by the StoryRunner when it starts (`registerStoryStrings`),
 * so a level without a story never loads it. Import-free and Node-safe (the i18n checker reads it).
 *
 * What the story files and the levels say (lines, names, quest and item texts) is content, not
 * here: the runtime translates it at display (`loc()` by its key, names with `term()`; I18N.md §4).
 * A code default that stands in for blank data is a UI string here (`ending.default`: an `ending`
 * without a title, I18N.md §4.8). Story errors stay English (the developer UI).
 *
 * Keys are ids; each entry a whole sentence with `{var}` slots: `{title}` a quest's title,
 * `{item}` an item's name (both already translated), `{n}` a count.
 */
/** @type {import('../../engine/i18n/I18n.js').StringTable} */
const table = {
  en: {
    'quest.start': 'New quest: {title}',
    'quest.stage': 'Quest updated: {title}',
    'quest.done': 'Quest complete: {title}',
    'quest.fail': 'Quest failed: {title}',
    'gold.received': 'Received {n} gold',
    'gold.given': 'Gave {n} gold',
    'item.received': 'Received: {item}',
    'item.receivedCount': 'Received: {item} ×{n}',
    'item.given': 'Handed over: {item}',
    'item.givenCount': 'Handed over: {item} ×{n}',
    'ending.default': 'The End',
  },
  ja: {
    'quest.start': '新しいクエスト：{title}',
    'quest.stage': 'クエスト更新：{title}',
    'quest.done': 'クエスト達成：{title}',
    'quest.fail': 'クエスト失敗：{title}',
    'gold.received': '{n}ゴールドを受け取った',
    'gold.given': '{n}ゴールドを渡した',
    'item.received': '{item}を受け取った',
    'item.receivedCount': '{item}×{n}を受け取った',
    'item.given': '{item}を渡した',
    'item.givenCount': '{item}×{n}を渡した',
    'ending.default': 'おわり',
  },
  zh: {
    'quest.start': '新任务：{title}',
    'quest.stage': '任务更新：{title}',
    'quest.done': '任务完成：{title}',
    'quest.fail': '任务失败：{title}',
    'gold.received': '获得 {n} 金币',
    'gold.given': '交出 {n} 金币',
    'item.received': '获得：{item}',
    'item.receivedCount': '获得：{item} ×{n}',
    'item.given': '交出：{item}',
    'item.givenCount': '交出：{item} ×{n}',
    'ending.default': '完',
  },
};
export default table;
