/**
 * UI strings, namespace 'party' (docs/specs/I18N.md §2, docs/specs/PIXEL_UI.md §8): the tactics
 * panel's chrome, the party frames, the rule vocabulary of src/engine/level/PartyRules.js by id
 * (fields, values, presets, classes, roles, weapons), the built-in party conversation and the rule
 * toast. Owner: B-party. Registered by the feature when it starts — the `Party` constructor and
 * `partyUIClasses()` (`registerPartyStrings`), never at import — so a game nobody joins never loads
 * it.
 *
 * Node-safe (the i18n checker imports it): it imports only the import-free I18n.js and
 * PartyRules.js. PartyRules.js stays English and is the English here (`rule.<field>.label` … are
 * made from it), so the vocabulary has one English source; the Japanese and Chinese follow the
 * glossary (docs/specs/I18N_GLOSSARY.md §3.13, §4.13, §6: 作戦 / 方針 / 指示, 衛士 / 守卫 …).
 *
 * Keys are ids, not English: `panel.*`, `frame.*`, `toast.*`, `talk.*`, `rule.<field>.{label,help}`,
 * `rule.<field>.<value>.{label,hint}`, `preset.<id>.{label,help}`, `class.<id>.{label,help}`,
 * `role.<id>`, `weapon.<id>`.
 */
import { registerStrings, hasStrings, t } from '../../engine/i18n/I18n.js';
import { RULE_FIELDS, PARTY_PRESETS, PARTY_CLASSES } from '../../engine/level/PartyRules.js';

/** @typedef {import('../../engine/i18n/I18n.js').StringEntry} StringEntry */

/** The rule vocabulary's English, by id, from PartyRules.js (its one English source). */
function rulesEnglish() {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, f] of Object.entries(RULE_FIELDS)) {
    out[`rule.${k}.label`] = f.label;
    out[`rule.${k}.help`] = f.help;
    for (const v of f.values) {
      out[`rule.${k}.${v}.label`] = f.labels[v];
      out[`rule.${k}.${v}.hint`] = f.hints[v];
    }
  }
  for (const [k, p] of Object.entries(PARTY_PRESETS)) {
    out[`preset.${k}.label`] = p.label;
    out[`preset.${k}.help`] = p.help;
  }
  for (const [k, c] of Object.entries(PARTY_CLASSES)) {
    out[`class.${k}.label`] = c.label;
    out[`class.${k}.help`] = c.help;
  }
  return out;
}

/** @type {import('../../engine/i18n/I18n.js').StringTable} */
const table = {
  en: {
    // the tactics panel
    'panel.party': 'Party',
    'panel.tactics': 'Tactics',
    'panel.presets': 'Presets',
    'panel.rules': 'Rules',
    'panel.custom': 'Custom',
    'panel.empty': 'Empty',
    'panel.count': '{n} / {max}',
    'panel.presetsHelp': 'Pick one to set every rule at once. Changing a rule below makes the tactic Custom.',
    'panel.choose': 'Choose',
    'panel.change': 'Change',
    'panel.pick': 'Pick',
    'panel.member': 'Member',
    'panel.close': 'Close',
    'panel.aria': 'Party tactics',
    'panel.members': 'Members',
    'panel.prev': 'Previous {field}',
    'panel.next': 'Next {field}',
    'panel.of': '{i} of {n}',
    // the party frames (HUD)
    'frame.lv': 'Lv',
    'frame.down': 'Down',
    // a rule the story set (the player's own changes make none)
    'toast.rule': '{name}: {preset}',
    // the built-in party conversation (a member's talk without a script, PARTY.md §4.3)
    'talk.line0': 'Right behind you. Something on your mind?',
    'talk.line1': 'Lead on — I will keep pace.',
    'talk.line2': 'Need something? I am listening.',
    'talk.line3': 'The road has been kind so far. What is it?',
    'talk.tactics': 'Tactics…',
    'talk.part': 'Part ways',
    'talk.carryOn': 'Carry on',
    'talk.stayQ': 'You want me to stay behind?',
    'talk.stay': 'No — stay with me',
    'talk.leave': 'Yes, part ways',
    'talk.bye': 'Then this is where I leave you. Safe travels — you know where to find me.',
    'talk.glad': 'Good. I was not ready to turn back yet.',
    // the classes' roles and weapons (PARTY_CLASSES role / weapon ids)
    'role.melee': 'Melee',
    'role.ranged': 'Ranged',
    'role.caster': 'Caster',
    'weapon.spear': 'Spear',
    'weapon.bow': 'Bow',
    'weapon.staff': 'Staff',
    // the heroes of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md §5.4)
    'weapon.holystaff': 'Holy Staff',
    'weapon.icestaff': 'Ice Staff',
    'weapon.greatshield': 'Tower Shield',
    ...rulesEnglish(),
  },
  ja: {
    'panel.party': 'パーティ',
    'panel.tactics': '作戦',
    'panel.presets': '方針',
    'panel.rules': '指示',
    'panel.custom': 'カスタム',
    'panel.empty': '空き',
    'panel.count': '{n} / {max}',
    'panel.presetsHelp': '方針を選ぶと全指示を一括設定。指示を変えると「カスタム」になる。',
    'panel.choose': '選択',
    'panel.change': '変更',
    'panel.pick': '決定',
    'panel.member': '仲間',
    'panel.close': '閉じる',
    'panel.aria': 'パーティの作戦',
    'panel.members': 'メンバー',
    'panel.prev': '{field}：前へ',
    'panel.next': '{field}：次へ',
    'panel.of': '{n}段階中{i}段階目',
    'frame.lv': 'Lv',
    'frame.down': '戦闘不能',
    'toast.rule': '{name}：{preset}',
    'talk.line0': 'すぐ後ろにいるよ。何か気になることでも？',
    'talk.line1': '先導は任せた。遅れずについていく。',
    'talk.line2': '何か用かな？　聞いているよ。',
    'talk.line3': 'ここまでは穏やかな道のりだね。どうしたの？',
    'talk.tactics': '作戦…',
    'talk.part': '別れる',
    'talk.carryOn': 'このまま進む',
    'talk.stayQ': 'ここに残ってほしいということ？',
    'talk.stay': 'いや、一緒に来てくれ',
    'talk.leave': 'ああ、ここで別れよう',
    'talk.bye': 'では、ここでお別れだ。良い旅を──私の居場所はわかっているね。',
    'talk.glad': 'よかった。まだ引き返す気にはなれなかったんだ。',
    'role.melee': '近接',
    'role.ranged': '遠距離',
    'role.caster': '魔法',
    'weapon.spear': '槍',
    'weapon.bow': '弓',
    'weapon.staff': '杖',
    'weapon.holystaff': '聖杖',
    'weapon.icestaff': '氷の杖',
    'weapon.greatshield': '大盾',
    'rule.target.label': '標的',
    'rule.target.help': 'どの敵を狙うか。',
    'rule.target.leader.label': 'リーダーと同じ',
    'rule.target.leader.hint': 'リーダーの標的、なければリーダーに近い敵。',
    'rule.target.nearest.label': '近い敵',
    'rule.target.nearest.hint': '自分に最も近い敵。',
    'rule.target.weakest.label': '弱った敵',
    'rule.target.weakest.hint': '残りHPが最も少ない敵。とどめを刺す。',
    'rule.target.strongest.label': '強い敵',
    'rule.target.strongest.hint': 'まず精鋭とボス、次に手強い敵。',
    'rule.target.ranged.label': '弓兵と術者',
    'rule.target.ranged.hint': 'まず弓兵とシャーマン、次に近くの敵。',
    'rule.distance.label': '距離',
    'rule.distance.help': '戦闘中、リーダーからどこまで離れるか。',
    'rule.distance.close.label': '近距離',
    'rule.distance.close.hint': 'リーダーのそばを離れない。',
    'rule.distance.mid.label': '中距離',
    'rule.distance.mid.hint': 'リーダーから数歩の範囲で戦う。',
    'rule.distance.far.label': '遠距離',
    'rule.distance.far.hint': '離れた敵も自由に追いかける。',
    'rule.attack.label': '攻撃',
    'rule.attack.help': 'いつ攻撃するか。',
    'rule.attack.free.label': '自由に',
    'rule.attack.free.hint': '範囲内の敵なら何でも。',
    'rule.attack.assist.label': '援護のみ',
    'rule.attack.assist.hint': 'リーダーや仲間と戦う敵だけ。',
    'rule.attack.never.label': 'しない',
    'rule.attack.never.hint': '攻撃しない。',
    'rule.skills.label': 'スキル',
    'rule.skills.help': '戦闘スキルの使い方（回復は別）。',
    'rule.skills.free.label': '自由に使う',
    'rule.skills.free.hint': '準備ができしだい使う。',
    'rule.skills.save.label': 'MP温存',
    'rule.skills.save.hint': '回復用のMPに余裕がある時だけ。',
    'rule.skills.never.label': '使わない',
    'rule.skills.never.hint': '通常攻撃のみ。',
    'rule.heal.label': '回復',
    'rule.heal.help': 'リーダーや仲間をいつ回復するか。',
    'rule.heal.never.label': 'しない',
    'rule.heal.never.hint': 'MPは戦闘のために取っておく。',
    'rule.heal.low.label': 'ピンチ時',
    'rule.heal.low.hint': '誰かが倒れそうな時。',
    'rule.heal.half.label': '半分以下',
    'rule.heal.half.hint': '誰かのHPが半分を切った時。',
    'rule.heal.often.label': 'こまめに',
    'rule.heal.often.hint': '少しでも傷を負ったら。',
    'rule.evade.label': '回避',
    'rule.evade.help': '敵の予告攻撃を転がってかわすか。',
    'rule.evade.on.label': 'かわす',
    'rule.evade.on.hint': '予告された攻撃を転がってかわす。',
    'rule.evade.off.label': '踏みとどまる',
    'rule.evade.off.hint': 'その場に踏みとどまり、攻撃を受ける。',
    'rule.retreat.label': '後退',
    'rule.retreat.help': '傷ついた時、リーダーのもとへ下がるか。',
    'rule.retreat.never.label': 'しない',
    'rule.retreat.never.hint': '最後まで戦い抜く。',
    'rule.retreat.low.label': 'ピンチ時',
    'rule.retreat.low.hint': '倒れそうになったらリーダーの後ろへ。',
    'rule.retreat.half.label': '半分以下',
    'rule.retreat.half.hint': 'HPが半分を切ったらリーダーの後ろへ。',
    'preset.balanced.label': 'バランス',
    'preset.balanced.help': '中距離で戦い、誰かがピンチなら回復。予告攻撃はかわす。',
    'preset.aggressive.label': '総攻撃',
    'preset.aggressive.help': '近くの敵に突撃し、スキルを使い切る。回復も後退もしない。',
    'preset.guardian.label': '護衛',
    'preset.guardian.help': 'そばに控え、リーダーに迫る敵を討つ。',
    'preset.support.label': '支援',
    'preset.support.help': 'リーダーを支える。回復はこまめに、戦うのは向かってくる敵だけ。',
    'preset.hunter.label': '術者狙い',
    'preset.hunter.help': '弓兵とシャーマンを優先し、遠くまで追う。',
    'preset.passive.label': '見守り',
    'preset.passive.help': '戦わない。そばにいて、攻撃をかわし回復する。',
    'class.warden.label': '衛士',
    'class.warden.help': '間近で槍を突き、薙ぎ払い、「ヒール」で回復する。',
    'class.ranger.label': '狩人',
    'class.ranger.help': '遠くから矢を射る。一斉射撃と「ヒール」も使う。',
    'class.mystic.label': '秘術士',
    'class.mystic.help': '火炎弾を放ち、敵の上で閃光をはじけさせる。「ヒール」も強力。',
    'class.cleric.label': '僧侶',
    'class.cleric.help': '聖なる光弾を放ち、「審判」の光の柱と「聖域」の癒しの輪を生む。強力な回復で倒れた仲間も立たせる。',
    'class.icemage.label': '氷術士',
    'class.icemage.help': '氷の槍で敵を鈍らせ、「ブリザード」で群れの足を止め、「氷葬」の氷の輪で凍りつかせる。',
    'class.greatshield.label': '大盾使い',
    'class.greatshield.help': '盾で打ち、鎚矛を振るい、打たれても怯まない。「鉄壁」で敵を引きつけて仲間を守り、「大地砕き」で叩き伏せる。',
  },
  zh: {
    'panel.party': '队伍',
    'panel.tactics': '战术',
    'panel.presets': '预设',
    'panel.rules': '规则',
    'panel.custom': '自定义',
    'panel.empty': '空位',
    'panel.count': '{n} / {max}',
    'panel.presetsHelp': '选择预设可一次设定全部规则。修改下方规则后，战术将变为“自定义”。',
    'panel.choose': '选择',
    'panel.change': '切换',
    'panel.pick': '确定',
    'panel.member': '队员',
    'panel.close': '关闭',
    'panel.aria': '队伍战术',
    'panel.members': '队员',
    'panel.prev': '{field}：上一项',
    'panel.next': '{field}：下一项',
    'panel.of': '第 {i} 档，共 {n} 档',
    'frame.lv': 'Lv',
    'frame.down': '倒地',
    'toast.rule': '{name}：{preset}',
    'talk.line0': '我就在你身后。有什么心事吗？',
    'talk.line1': '你来带路——我会跟上。',
    'talk.line2': '需要什么吗？我在听。',
    'talk.line3': '一路走来还算顺利。怎么了？',
    'talk.tactics': '战术…',
    'talk.part': '分道扬镳',
    'talk.carryOn': '继续前进',
    'talk.stayQ': '你是要我留下吗？',
    'talk.stay': '不，留在我身边',
    'talk.leave': '是的，就此别过',
    'talk.bye': '那我们就在此分别吧。一路平安——你知道去哪儿找我。',
    'talk.glad': '那就好。我还不想就此回头。',
    'role.melee': '近战',
    'role.ranged': '远程',
    'role.caster': '施法',
    'weapon.spear': '长枪',
    'weapon.bow': '弓',
    'weapon.staff': '法杖',
    'weapon.holystaff': '圣杖',
    'weapon.icestaff': '冰杖',
    'weapon.greatshield': '巨盾',
    'rule.target.label': '目标',
    'rule.target.help': '攻击哪个敌人。',
    'rule.target.leader.label': '跟随你',
    'rule.target.leader.hint': '你锁定的敌人，没有则选离你最近的。',
    'rule.target.nearest.label': '就近',
    'rule.target.nearest.hint': '离自己最近的敌人。',
    'rule.target.weakest.label': '最弱',
    'rule.target.weakest.hint': '剩余HP最少的敌人，给它最后一击。',
    'rule.target.strongest.label': '最强',
    'rule.target.strongest.hint': '先打精英和首领，再打最强的敌人。',
    'rule.target.ranged.label': '弓手与法师',
    'rule.target.ranged.hint': '先打弓手和萨满，再打最近的敌人。',
    'rule.distance.label': '距离',
    'rule.distance.help': '战斗中离你多远。',
    'rule.distance.close.label': '近距离',
    'rule.distance.close.hint': '始终不离你左右。',
    'rule.distance.mid.label': '中距离',
    'rule.distance.mid.hint': '保持在你几步之内。',
    'rule.distance.far.label': '远距离',
    'rule.distance.far.hint': '可自由追击远处的敌人。',
    'rule.attack.label': '攻击',
    'rule.attack.help': '何时攻击。',
    'rule.attack.free.label': '自由攻击',
    'rule.attack.free.hint': '攻击范围内的任意敌人。',
    'rule.attack.assist.label': '仅协助',
    'rule.attack.assist.hint': '只打与你或队伍交战的敌人。',
    'rule.attack.never.label': '不攻击',
    'rule.attack.never.hint': '完全不攻击。',
    'rule.skills.label': '技能',
    'rule.skills.help': '如何使用战斗技能（治疗另行设定）。',
    'rule.skills.free.label': '自由使用',
    'rule.skills.free.hint': '技能一就绪就使用。',
    'rule.skills.save.label': '节省MP',
    'rule.skills.save.hint': '仅在留足治疗用MP时使用。',
    'rule.skills.never.label': '不使用',
    'rule.skills.never.hint': '只用普通攻击。',
    'rule.heal.label': '治疗',
    'rule.heal.help': '何时治疗你或队友。',
    'rule.heal.never.label': '不治疗',
    'rule.heal.never.hint': '把MP留给战斗。',
    'rule.heal.low.label': '危急时',
    'rule.heal.low.hint': '有人快要倒下时。',
    'rule.heal.half.label': '半血以下',
    'rule.heal.half.hint': '有人HP低于一半时。',
    'rule.heal.often.label': '频繁',
    'rule.heal.often.hint': '一受伤就治疗。',
    'rule.evade.label': '闪避',
    'rule.evade.help': '是否翻滚躲开敌人的预警攻击。',
    'rule.evade.on.label': '闪避攻击',
    'rule.evade.on.hint': '翻滚躲开预警攻击。',
    'rule.evade.off.label': '坚守原地',
    'rule.evade.off.hint': '原地坚守，硬接攻击。',
    'rule.retreat.label': '后撤',
    'rule.retreat.help': '受伤时是否退回你身边。',
    'rule.retreat.never.label': '不后撤',
    'rule.retreat.never.hint': '战斗到最后一刻。',
    'rule.retreat.low.label': '危急时',
    'rule.retreat.low.hint': '快倒下时退到你身后。',
    'rule.retreat.half.label': '半血以下',
    'rule.retreat.half.hint': 'HP低于一半时退到你身后。',
    'preset.balanced.label': '均衡',
    'preset.balanced.help': '中距离作战，有人危急时治疗，闪避预警攻击。',
    'preset.aggressive.label': '全力进攻',
    'preset.aggressive.help': '冲向最近的敌人，用尽所有技能，从不治疗或后撤。',
    'preset.guardian.label': '贴身护卫',
    'preset.guardian.help': '守在你身边，迎击一切冲你而来的敌人。',
    'preset.support.label': '辅助',
    'preset.support.help': '护你周全：频繁治疗，只打主动出手的敌人。',
    'preset.hunter.label': '猎杀法师',
    'preset.hunter.help': '远距离游走，优先击倒弓手与萨满。',
    'preset.passive.label': '避战',
    'preset.passive.help': '不参与战斗：紧随身边，闪避并治疗。',
    'class.warden.label': '守卫',
    'class.warden.help': '近身长枪突刺，横扫一击，还会用“治愈术”疗伤。',
    'class.ranger.label': '游侠',
    'class.ranger.help': '远程射箭，箭雨齐射，还会用“治愈术”疗伤。',
    'class.mystic.label': '秘术师',
    'class.mystic.help': '发射烬火弹，在敌群中炸开闪焰，“治愈术”效果更强。',
    'class.cleric.label': '牧师',
    'class.cleric.help': '发射圣光弹，降下“审判”光柱，展开“圣域”治愈法阵；治疗强力，还能扶起倒下的同伴。',
    'class.icemage.label': '冰术师',
    'class.icemage.help': '冰枪令敌人迟缓，“暴风雪”拖住敌群，“冰葬”以冰环冻结敌人。',
    'class.greatshield.label': '巨盾手',
    'class.greatshield.help': '盾击与钉锤近身猛攻，受击不退；“铁壁”嘲讽敌人并守护全队，“裂地”重击震倒敌人。',
  },
};
export default table;

/**
 * Register the 'party' namespace (idempotent: a namespace already there is left as it is). The
 * `Party` constructor and `partyUIClasses()` call it, so the panel and the frames have their
 * strings wherever the party UI is made.
 * @param {{ force?: boolean }} [o] force: register it again (tests)
 */
export function registerPartyStrings({ force = false } = {}) {
  if (force || !hasStrings('party')) registerStrings('party', table);
}

/**
 * `t('party.<key>')`, else `fallback` when the key has no entry in any language (a name a level or
 * a save brings that the tables do not know).
 * @param {string} key without the 'party.' prefix
 * @param {string} fallback
 * @param {Record<string, any>} [vars]
 */
export function pt(key, fallback, vars) {
  const full = `party.${key}`;
  const s = t(full, vars);
  return s === full ? fallback : s;
}

/** A class's label in the page's language (by PARTY_CLASSES id; the id itself for an unknown one). @param {string} id */
export const classLabel = (id) => pt(`class.${id}.label`, Object.hasOwn(PARTY_CLASSES, id) ? PARTY_CLASSES[id].label : id);
/** A class's help line in the page's language. @param {string} id */
export const classHelp = (id) => pt(`class.${id}.help`, Object.hasOwn(PARTY_CLASSES, id) ? PARTY_CLASSES[id].help : '');
/** A role's word (melee / ranged / caster). @param {string} id */
export const roleLabel = (id) => pt(`role.${id}`, id);
/** A weapon's word (spear / bow / staff / holystaff / icestaff / greatshield). @param {string} id */
export const weaponLabel = (id) => pt(`weapon.${id}`, id);
/** A preset's label in the page's language; 'custom' is the panel's Custom. @param {string} id */
export const presetLabel = (id) => (id === 'custom' ? pt('panel.custom', 'Custom') : pt(`preset.${id}.label`, Object.hasOwn(PARTY_PRESETS, id) ? PARTY_PRESETS[id].label : id));

/**
 * RULE_FIELDS in the page's language (the same shape and ids, labels, help and hints translated):
 * what the tactics panel shows. English: the same text as RULE_FIELDS.
 * @returns {Record<string, { label: string, help: string, values: string[], labels: Record<string, string>, hints: Record<string, string> }>}
 */
export function localFields() {
  /** @type {Record<string, { label: string, help: string, values: string[], labels: Record<string, string>, hints: Record<string, string> }>} */
  const out = {};
  for (const [k, f] of Object.entries(RULE_FIELDS)) {
    /** @type {Record<string, string>} */
    const labels = {};
    /** @type {Record<string, string>} */
    const hints = {};
    for (const v of f.values) {
      labels[v] = pt(`rule.${k}.${v}.label`, f.labels[v]);
      hints[v] = pt(`rule.${k}.${v}.hint`, f.hints[v]);
    }
    out[k] = { label: pt(`rule.${k}.label`, f.label), help: pt(`rule.${k}.help`, f.help), values: [...f.values], labels, hints };
  }
  return out;
}

/**
 * PARTY_PRESETS in the page's language (ids and rules untouched).
 * @returns {Record<string, { label: string, help: string, rule: import('../../engine/level/PartyRules.js').PartyRule }>}
 */
export function localPresets() {
  /** @type {Record<string, { label: string, help: string, rule: import('../../engine/level/PartyRules.js').PartyRule }>} */
  const out = {};
  for (const [k, p] of Object.entries(PARTY_PRESETS)) out[k] = { label: presetLabel(k), help: pt(`preset.${k}.help`, p.help), rule: { ...p.rule } };
  return out;
}
