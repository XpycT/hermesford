/**
 * UI strings, namespace 'siege' (docs/specs/I18N.md §2; docs/contracts/DRAGON_CAMPAIGN.md §6.3):
 * what the villagers of a burning village cry out as they run (`panic`), what the ones cowering
 * whimper (`cower`), what they say once the level's foes are all routed (`relief`), and what the
 * festival crowd shouts (`cheer`) — barks over their heads
 * (`game.ui.emotes.bark`, a story level's). Owner: the siege package. Registered by the first
 * villager that barks (Npc.js `registerSiegeStrings`), never at import, so a level without such
 * villagers registers nothing.
 *
 * Node-safe (the i18n checker imports it): it imports only the import-free I18n.js. No names in
 * these lines (a name the UI and the content both show must be translated alike: none here).
 *
 * Keys are ids: `panic.<n>`, `cower.<n>`, `relief.<n>`, `cheer.<n>` (`SIEGE_BARKS` lists them by
 * kind).
 */
import { registerStrings, hasStrings } from '../../engine/i18n/I18n.js';

/** The bark keys by kind (the villager's behaviour; `relief`: a panicking or cowering one calmed). */
export const SIEGE_BARKS = Object.freeze({
  panic: Object.freeze(['panic.0', 'panic.1', 'panic.2', 'panic.3', 'panic.4', 'panic.5', 'panic.6', 'panic.7', 'panic.8', 'panic.9']),
  cower: Object.freeze(['cower.0', 'cower.1', 'cower.2']),
  relief: Object.freeze(['relief.0', 'relief.1', 'relief.2', 'relief.3', 'relief.4']),
  cheer: Object.freeze(['cheer.0', 'cheer.1', 'cheer.2', 'cheer.3', 'cheer.4', 'cheer.5']),
});

/** The table: en / ja / zh. */
export const SIEGE_STRINGS = {
  en: {
    'panic.0': 'Help! Somebody help us!',
    'panic.1': 'Run! Run for your lives!',
    'panic.2': 'Fire! The roofs are burning!',
    'panic.3': 'The dragon! It\'s right above us!',
    'panic.4': 'Monsters in the square!',
    'panic.5': 'My house… my house!',
    'panic.6': 'Water! Bring water!',
    'panic.7': 'Where are the children?!',
    'panic.8': 'Gods, save us!',
    'panic.9': 'Get to the temple!',
    'cower.0': 'Please, no… no…',
    'cower.1': 'I\'m scared…',
    'cower.2': 'Make it stop…',
    'relief.0': 'They\'re gone!',
    'relief.1': 'We\'re saved!',
    'relief.2': 'Thank the heroes!',
    'relief.3': 'It\'s over… it\'s really over.',
    'relief.4': 'Is everyone all right?',
    'cheer.0': 'To the heroes!',
    'cheer.1': 'The dragon is dead!',
    'cheer.2': 'Dance! Tonight we dance!',
    'cheer.3': 'Hurrah!',
    'cheer.4': 'We\'re alive!',
    'cheer.5': 'Another song!',
  },
  ja: {
    'panic.0': '誰か、助けて！',
    'panic.1': '逃げろ！ 早く逃げるんだ！',
    'panic.2': '火事だ！ 屋根が燃えてる！',
    'panic.3': '竜だ！ 真上にいるぞ！',
    'panic.4': '広場に魔物が！',
    'panic.5': '私の家が……家が！',
    'panic.6': '水だ！ 水を持ってこい！',
    'panic.7': '子どもたちはどこ!?',
    'panic.8': '神様、お助けを！',
    'panic.9': '神殿へ逃げて！',
    'cower.0': 'お願い……来ないで……',
    'cower.1': '怖いよ……',
    'cower.2': 'もうやめて……',
    'relief.0': 'あいつら、行っちまった！',
    'relief.1': '助かった！',
    'relief.2': '英雄たちのおかげだ！',
    'relief.3': '終わった……本当に終わったんだ……',
    'relief.4': 'みんな、無事か？',
    'cheer.0': '英雄たちに乾杯！',
    'cheer.1': '竜は倒れたぞ！',
    'cheer.2': '踊ろう！ 今夜は踊り明かそう！',
    'cheer.3': '万歳！',
    'cheer.4': '生きてるぞ！',
    'cheer.5': 'もう一曲！',
  },
  zh: {
    'panic.0': '救命啊！谁来救救我们！',
    'panic.1': '快跑！快逃命啊！',
    'panic.2': '着火了！屋顶烧起来了！',
    'panic.3': '是龙！它就在我们头顶！',
    'panic.4': '广场上有怪物！',
    'panic.5': '我的房子……我的房子啊！',
    'panic.6': '水！快拿水来！',
    'panic.7': '孩子们在哪儿？！',
    'panic.8': '神啊，救救我们！',
    'panic.9': '快去神殿！',
    'cower.0': '求求你……别过来……',
    'cower.1': '我好怕……',
    'cower.2': '快停下吧……',
    'relief.0': '它们走了！',
    'relief.1': '我们得救了！',
    'relief.2': '多亏了英雄们！',
    'relief.3': '结束了……真的结束了……',
    'relief.4': '大家都没事吧？',
    'cheer.0': '敬英雄们！',
    'cheer.1': '恶龙死了！',
    'cheer.2': '跳舞吧！今晚尽情跳舞！',
    'cheer.3': '万岁！',
    'cheer.4': '我们活下来了！',
    'cheer.5': '再来一曲！',
  },
};

/**
 * Register the 'siege' namespace (once; again with `force`).
 * @param {boolean} [force]
 */
export function registerSiegeStrings(force = false) {
  if (force || !hasStrings('siege')) registerStrings('siege', SIEGE_STRINGS);
}
