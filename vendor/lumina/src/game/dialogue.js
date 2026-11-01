/**
 * Conversations.
 *
 * Who stands where, what they look like and what the signs say is level data
 * (`public/levels/*.json`, see docs/contracts/LEVEL_EDITOR.md). This module holds the behaviour:
 *  - `CONVERSATIONS`: Emberfall's hand-written conversations, referenced by a level NPC's
 *    `script` id (ObjectCatalog.NPC_SCRIPTS), plus the combat `drillmaster` and `shopkeeper`
 *    (Cinderwatch Pass);
 *  - `levelConversation(obj)`: the conversation of any other NPC, built from its plain `dialogue`
 *    pages plus a built-in `action` (rest / shop / music);
 *  - `conversationFor(obj)`: picks one of the two.
 *
 * A conversation is `async (ctx, obj) => void` (obj: the level NPC object). ctx:
 *   say(lines, opts?)  → Promise<choiceIndex|undefined>  (opens the DialogBox as this NPC)
 *   toast(text), sfx(name), visits (times talked to before), game (the Game instance), npc
 * Markup: `{word}` is shown in gold.
 *
 * Languages (docs/specs/I18N.md §4, §4.8): everything this module shows is translated at display —
 * its own lines as `loc('dlg.<conversation>.<name>', 'English')` (a stable code key with the English
 * beside it: the `common` table's unit records that English, so an edited line shows its English
 * until a translator has reviewed it); the level's pages and choices by the text keys the villager's
 * object holds for them (§4.2: ContentKeys.js `dialogueKeyOf` / `choiceKeyOf` at the raw indices of
 * `dialogueUnits`; a page or a choice without one — the scripts' `{}` fallback, a level never
 * keyed — shows its English); the item
 * a villager sells as a term (`term`), the UI's default for none (`t('game.default.item')`); the
 * combat shop's wares by the labels `combat.shopOffers()` gives (UI strings). Sentences with values
 * are whole English templates with `${name}` slots, translated first and filled second
 * (`contentFormat`); lines that name keys are whole sentences (`drillLines`). What `say` and `toast` get
 * is translated: the callers (Game, StoryRunner) show it as it is and translate only the speaker.
 * Names that are looked up stay English: the item a villager sells (`combat.buy` / `priceOf`,
 * `story.giveNamed`, the inventory — 'Crisp Apple' for none), the wares of the combat shop.
 */

import { ownValue } from '../engine/utils/own.js';
import { loc, term, contentFormat } from '../engine/i18n/ContentText.js';
import { dialogueKeyOf, choiceKeyOf, dialogueUnits } from '../engine/i18n/ContentKeys.js';
import { t } from '../engine/i18n/I18n.js';

/**
 * @import { DialogLine } from '../engine/ui/DialogBox.js'
 * @import { Game } from './Game.js'
 * @import { Npc } from './Npc.js'
 * @import { LevelObjectOf } from '../engine/level/types.js'
 */

/**
 * What a conversation gets (built by `Game._interact`).
 * @typedef {object} ConversationContext
 * @property {(lines: string | (string | DialogLine)[],
 *   opts?: { speaker?: string }) => Promise<number|undefined>} say
 *   opens the DialogBox as this NPC → the chosen choice index (undefined: no choice); the lines
 *   arrive translated
 * @property {(text: string) => void} toast   a HUD toast (translated)
 * @property {(name: string) => void} sfx     an AudioSystem sound effect
 * @property {number} visits                  times talked to before
 * @property {Game} game
 * @property {Npc} npc
 */

/**
 * A level NPC's conversation (`conversationFor`): resolves when it is over.
 * @typedef {(ctx: ConversationContext) => Promise<void>} Conversation
 */

/**
 * The drillmaster's lines that name keys, as whole sentences — so a translation never has a key
 * phrase dropped into the middle of it (COMBAT.md §6.12). Read when spoken (the table of the
 * language in force).
 */
function drillLines() {
  return {
    reward: loc('dlg.drillmaster.reward.keys', 'Take these {Healing Draughts}. Drink one with {C} when the world starts to spin. Bram sells more at the stall.'),
    strike: loc('dlg.drillmaster.strike.keys', 'Strike with {J (or the left mouse button)} — press it again as the blade comes back and you chain three cuts, the last one a thrust that knocks foes flat.'),
    roll: loc('dlg.drillmaster.roll.keys', 'Roll with {K (or the right mouse button)} while you move: for a heartbeat nothing can touch you. Roll just as a blow lands and the world slows for you.'),
    skills: loc('dlg.drillmaster.skills.keys', 'Your skills are on {U, I and O (or 1–3)}, your draughts on {C}, and {L} fixes your eyes on one foe.'),
    waitBoth: loc('dlg.drillmaster.wait-both.keys', 'Still waiting on a full three-cut combo on a dummy ({J (or the left mouse button)} three times) and one roll ({K (or the right mouse button)}). The dummies are patient. I am less so.'),
    waitCombo: loc('dlg.drillmaster.wait-combo.keys', 'Still waiting on a full three-cut combo on a dummy ({J (or the left mouse button)} three times). The dummies are patient. I am less so.'),
    waitRoll: loc('dlg.drillmaster.wait-roll.keys', 'Still waiting on one roll ({K (or the right mouse button)}). The dummies are patient. I am less so.'),
  };
}

/**
 * The toast of a ware the combat shop sold (`o`: a `combat.shopOffers()` entry, its name already
 * translated in `name`, its gain in `gainLabel`): an upgrade says what it changed ("ATK 20 → 22"),
 * one sentence per stat.
 * @param {string} name
 * @param {{ upgrade: string|null, gainLabel: string }} o
 * @param {number} before
 * @param {number|null} after the stat now (null: not a stat the shop reads — the gain instead)
 */
function boughtToast(name, o, before, after) {
  if (!o.upgrade) return contentFormat(loc('dlg.shopkeeper.bought', 'Obtained: ${name}'), { name });
  const p = { name, before, after };
  switch (after === null ? '' : o.upgrade) {
    case 'attack': return contentFormat(loc('dlg.shopkeeper.bought-atk', 'Obtained: ${name} — ATK ${before} → ${after}'), p);
    case 'def': return contentFormat(loc('dlg.shopkeeper.bought-def', 'Obtained: ${name} — DEF ${before} → ${after}'), p);
    case 'maxHp': return contentFormat(loc('dlg.shopkeeper.bought-max-hp', 'Obtained: ${name} — Max HP ${before} → ${after}'), p);
    case 'maxMp': return contentFormat(loc('dlg.shopkeeper.bought-max-mp', 'Obtained: ${name} — Max MP ${before} → ${after}'), p);
    default: return contentFormat(loc('dlg.shopkeeper.bought-gain', 'Obtained: ${name} — ${gain}'), { name, gain: o.gainLabel });
  }
}

/** Why a purchase failed (`combat.buy`'s reason), as the toast says it. @param {string|undefined} reason */
const refusal = (reason) => (reason === 'gold' ? loc('dlg.shop.not-enough-gold', 'Not enough gold') : reason === 'full' ? loc('dlg.shop.cannot-carry-more', 'You cannot carry more') : loc('dlg.shop.not-for-sale', 'Not for sale'));

/**
 * Emberfall's hand-written conversations, by script id.
 * @type {Record<string, (ctx: ConversationContext,
 *   obj: LevelObjectOf<'npc'>) => Promise<void>>}
 */
export const CONVERSATIONS = {
  async elder({ say, visits }) {
    if (visits === 0) {
      await say([
        loc('dlg.elder.welcome', 'Ah, a traveler. Welcome to {Emberfall}, child. Mind the cobbles — they are older than I am, and twice as stubborn.'),
        loc('dlg.elder.founders', 'Our founders followed this river up from the lowlands four hundred years ago. At dusk the falls catch the last of the sun and glow like embers in a hearth.'),
        loc('dlg.elder.hence-the-name', 'Hence the name. We are not an imaginative people, but we are an honest one.'),
        loc('dlg.elder.inn-tip', 'If your feet are weary, the {Ember & Oak} has a bed and a bowl of stew. Rosalind keeps the hearth warm and the gossip warmer.'),
      ]);
    } else if (visits % 2 === 1) {
      await say([
        loc('dlg.elder.well', 'Thirsty? The well is free to all. Its water comes down from {Windmill Hill}, and in all my years it has never once run dry.'),
        loc('dlg.elder.stair', 'Climb the stair by the inn some evening. The whole valley turns to gold up there.'),
      ]);
    } else {
      await say([
        loc('dlg.elder.still-here', 'Still here? Good. A village is only as warm as the company that lingers in it.'),
      ]);
    }
  },

  async innkeeper({ say, game }) {
    const choice = await say([
      loc('dlg.innkeeper.welcome', 'Welcome to the {Ember & Oak}! Warm beds, hot stew, and only a modest amount of snoring from the loft.'),
      // the non-committal answer comes first, so mashing through the text never skips the day
      { text: loc('dlg.rest.ask', 'Will you rest until morning?'), choices: [loc('dlg.rest.not-yet', 'Not yet', 'choice'), loc('dlg.rest.until-morning', 'Rest until morning', 'choice')] },
    ]);
    if (choice === 1) {
      await game.restUntilMorning();
      await say([loc('dlg.innkeeper.good-morning', 'Good morning, sleepyhead! Breakfast is on the table, and the rooster has been shouting about it for an hour.')]);
    } else {
      await say([loc('dlg.innkeeper.take-your-time', 'Take your time, dear. The fire will keep.')]);
    }
  },

  async merchant({ say, toast, sfx, game }) {
    const choice = await say([
      loc('dlg.merchant.step-up', 'Step right up! The finest produce this side of the river — and the only produce this side of the river, but let us not dwell on that.'),
      { text: loc('dlg.merchant.offer-apple', 'An apple, fresh from the valley orchards? For a new face in {Emberfall}, it is on the house.'), choices: [loc('dlg.shop.just-looking', 'Just looking', 'choice'), loc('dlg.merchant.take-apple', 'Take an apple', 'choice')] },
    ]);
    if (choice === 1) {
      game.inventory.apples = (game.inventory.apples ?? 0) + 1;
      sfx('chime');
      toast(game.inventory.apples > 1 ? contentFormat(loc('dlg.merchant.obtained-apple-count', 'Obtained: Crisp Apple ×${count}'), { count: game.inventory.apples }) : loc('dlg.merchant.obtained-apple', 'Obtained: Crisp Apple'));
      await say([loc('dlg.merchant.fine-choice', 'A fine choice! Crisp as a winter morning and twice as sweet. Come back tomorrow — I will have pears. Probably.')]);
    } else {
      await say([loc('dlg.merchant.looking-is-free', 'Looking is free! ...For now.')]);
    }
  },

  async guard({ say, visits }) {
    if (visits === 0) {
      await say([
        loc('dlg.guard.halt', 'Halt! State your— ah. Forgive me, traveler. Force of habit.'),
        loc('dlg.guard.ducks-and-gossip', 'Nothing has crossed this bridge in years but ducks and gossip, and I have yet to arrest either.'),
        loc('dlg.guard.grove', 'The grove beyond turns to amber this time of year. Keep to the path after dark — the river is gentle, but she is deeper than she looks.'),
      ]);
    } else {
      await say([loc('dlg.guard.all-quiet', 'All quiet on the bridge. Just the way I like it. ...Mostly.')]);
    }
  },

  async farmer({ say }) {
    await say([
      loc('dlg.farmer.turnips', 'Hm? Oh, don\'t mind me. Just asking the turnips how they are getting on.'),
      loc('dlg.farmer.soil', 'Soil\'s been kind this year. Rain came when we asked for it and kept away when we didn\'t. Can\'t ask fairer than that.'),
      loc('dlg.farmer.chickens', 'If you see my granddaughter, tell her the chickens have filed a formal complaint.'),
    ]);
  },

  async child({ say, visits }) {
    if (visits % 2 === 0) {
      await say([
        loc('dlg.child.duchess', 'Shh! I\'m sneaking up on {Duchess}. She\'s the plump one. She\'s also the fastest, which is not fair at all.'),
        loc('dlg.child.eggs', 'Grandpa says if I catch her, I get to name the next batch of eggs!'),
      ]);
    } else {
      await say([loc('dlg.child.fence', '...Hey, you\'re tall. Could you be a fence? You just have to stand really, really still.')]);
    }
  },

  // Branches on Wren's own story first (the soundtrack is usually already playing when you
  // meet him), and only silences it when the player asks.
  async bard({ say, toast, game, visits }) {
    const playing = game.audio.musicPlaying;
    if (visits === 0) {
      await say([
        loc('dlg.bard.listener', 'A listener! Sit, sit. The fire is warm and my lute is — mostly — in tune.'),
        playing
          ? loc('dlg.bard.song-intro-playing', 'You have been hearing me since the square, I expect. This one is called {Emberfall Evening}. I wrote it on that very bench, the night the falls turned gold.')
          : loc('dlg.bard.song-intro', 'This one is called {Emberfall Evening}. I wrote it on that very bench, the night the falls turned gold.'),
      ]);
      if (!playing) {
        game.setMusic(true);
        toast(loc('dlg.bard.song-toast', '♪ Emberfall Evening'));
      }
    } else if (playing) {
      const choice = await say([{ text: loc('dlg.bard.another-verse', 'Another verse, or shall I rest my fingers by the fire?'), choices: [loc('dlg.music.keep-playing', 'Keep playing', 'choice'), loc('dlg.bard.rest-a-while', 'Rest a while', 'choice')] }]);
      if (choice === 1) {
        await say([loc('dlg.bard.no-offence', 'No offence taken. Even a bard\'s fingers need a rest by the fire.')]);
        game.setMusic(false);
        toast(loc('dlg.music.fades', 'The music fades…'));
      } else {
        await say([loc('dlg.bard.another-verse-yes', 'Then another verse it is! This part is my favourite — the river joins in.')]);
      }
    } else {
      await say([loc('dlg.bard.from-the-top', 'Quiet suits a fire, but a song suits it better. Here — from the top.')]);
      game.setMusic(true);
      toast(loc('dlg.bard.song-toast', '♪ Emberfall Evening'));
    }
  },

  async scholar({ say, visits }) {
    if (visits === 0) {
      await say([
        loc('dlg.scholar.visitor', 'Oh! A visitor on the hill. I am cataloguing how the light moves over this valley. Would you believe it is different every hour?'),
        loc('dlg.scholar.time-key', 'Press {T} and watch the day turn — dawn, noon, golden hour, dusk and night. I have documented each one. Twice.'),
        loc('dlg.scholar.weather-key', '{R} summons the weather: rain, then snow, then clear skies again. Do not ask me how. Scholarship has its limits.'),
        loc('dlg.scholar.view-keys', '{P} hides everything but the view. {Q} and {E} turn the world around you, and {Z} and {X} — or the wheel — bring it closer or push it away.'),
        loc('dlg.scholar.notes-keys', 'And should you wish to see my working notes, {~} opens them. {H} will remind you of all this, should you forget.'),
      ]);
    } else {
      await say([
        loc('dlg.scholar.remember', 'Remember: {T} for the hour, {R} for the weather, {P} for the view, {H} for help. The rest is patience.'),
        loc('dlg.scholar.golden-hour', 'Golden hour is my favourite. The shadows grow long and everything looks like it remembers something.'),
      ]);
    }
  },

  /**
   * The combat drillmaster (COMBAT.md §6.12): explains the controls (the keys and mouse
   * buttons), asks for a full 3-hit combo on a dummy and one dodge, rewards 2 draughts
   * once both are done, and speaks two post-victory pages once the boss has fallen. On a peaceful
   * level the NPC's own dialogue pages play instead.
   */
  async drillmaster(ctx, obj) {
    const { say, game, toast, sfx, visits } = ctx;
    const combat = game.combat;
    if (!combat) {
      await levelConversation(obj ?? {})(ctx);
      return;
    }
    if (combat.bossDefeated) {
      await say([
        loc('dlg.drillmaster.boss-felled', 'You felled {Cinderheart}. I watched the glow go out of the caldera from the palisade — the whole camp cheered loud enough to wake the dummies.'),
        loc('dlg.drillmaster.first-watch', 'The pass has not been this quiet since my grandmother held this post. Rest by the fire tonight, soldier. You have earned the first watch off.'),
      ]);
      return;
    }
    const L = drillLines();
    const tut = combat.tutorial;
    if (tut.combo && tut.dodge && !tut.rewarded) {
      const given = combat.rewardTutorial();
      if (given > 0) {
        sfx('chime');
        toast(contentFormat(loc('dlg.drillmaster.obtained-draughts', 'Obtained: Healing Draught ×${count}'), { count: given }));
      }
      await say([
        loc('dlg.drillmaster.well-done', 'Now that is a sword arm! A full combo and a clean roll — the dummies will be telling stories about you.'),
        given > 0 ? L.reward : loc('dlg.drillmaster.satchel-full', 'I had draughts for you, but your satchel is full. Bram sells more at the stall when you need them.'),
        loc('dlg.drillmaster.glade-warning', 'The glade beyond the gate is crawling with slimes. Mind the goblins — they circle before they strike.'),
      ]);
      return;
    }
    if (tut.rewarded) {
      await say([loc('dlg.drillmaster.remember', 'Remember: strike, roll, strike again. And rest at a {waystone} before you take on anything with a crown of fire.')]);
      return;
    }
    if (visits === 0) {
      await say([
        loc('dlg.drillmaster.hold-there', 'Hold there, traveler. Nobody leaves this camp with a sword they cannot swing. I am {Captain Maren}, and the dummies are my recruits.'),
        L.strike,
        L.roll,
        L.skills,
        loc('dlg.drillmaster.show-me', 'Show me a full three-cut combo on a dummy, and one good roll. Then come back to me.'),
      ]);
      return;
    }
    await say([!tut.combo && !tut.dodge ? L.waitBoth : !tut.combo ? L.waitCombo : L.waitRoll]);
  },

  /**
   * A combat shopkeeper (the gold sink): on a combat level its dialogue pages (the first visit;
   * later visits its last page only, with "Tell me again" in the menu for the others — Odo's boss
   * hints stay reachable after a fall), then the combat shop's menu as a dialogue choice —
   * "Nothing more" first (mashing confirm never buys), then every ware not sold out with its gain
   * and price, marked when the gold does not reach (`combat.shopOffers()`, rules.js SHOP_WARES) —
   * repeated after each purchase until the player picks "Nothing more". The menu line shows the
   * gold, ATK and DEF, a bought upgrade's toast the change ("ATK 20 → 22"). Like resting, the shop
   * is shut while foes are engaged. On a peaceful level the NPC's own dialogue and action play.
   * (The wares are bought by their English name; the menu shows `shopOffers()`'s labels. The
   * villager's own pages are its plain ones, by their keys: `showPages`.)
   */
  async shopkeeper(ctx, obj) {
    const { say, game, toast, sfx, visits } = ctx;
    const combat = game.combat;
    if (!combat?.shopOffers) {
      await levelConversation(obj ?? {})(ctx);
      return;
    }
    if (combat.engaged) {
      sfx('cancel');
      await say([loc('dlg.shopkeeper.foes-near', 'Not with foes at your heels! Lose them first, then we can talk trade.')]);
      return;
    }
    const pages = /** @type {string[]} */ (showPages(dialogueUnits(obj?.dialogue).filter((u) => !u.choices), obj));
    const intro = visits === 0 ? pages : pages.slice(-1);
    const again = visits > 0 && pages.length > 1 ? loc('dlg.shopkeeper.tell-me-again', 'Tell me again', 'choice') : null;
    const pc = combat.pc;
    const STAT = { attack: () => pc.atk, def: () => pc.def, maxHp: () => pc.hpMax, maxMp: () => pc.mpMax };
    let bought = 0;
    for (let n = 0; n < 16; n++) {
      const offers = combat.shopOffers().filter((o) => !o.sold);
      /** @type {(string | DialogLine)[]} */
      const lines = n === 0 ? [...intro] : [];
      const choices = [loc('dlg.shopkeeper.nothing-more', 'Nothing more', 'choice'), ...offers.map((o) => contentFormat(o.reason === 'gold'
        ? loc('dlg.shopkeeper.ware-short', '${name} (${gain}) — ${price} gold (not enough)', 'choice')
        : loc('dlg.shopkeeper.ware', '${name} (${gain}) — ${price} gold', 'choice'), { name: o.label, gain: o.gainLabel, price: o.price }))];
      if (again) choices.push(again);
      const purse = { gold: pc.gold, atk: pc.atk, def: pc.def };
      lines.push({
        text: n === 0
          ? contentFormat(loc('dlg.shopkeeper.menu-first', 'What will it be? You carry {${gold} gold} · ATK ${atk} · DEF ${def}.'), purse)
          : contentFormat(loc('dlg.shopkeeper.menu-again', 'Anything else? You carry {${gold} gold} · ATK ${atk} · DEF ${def}.'), purse),
        choices,
      });
      const choice = await say(lines);
      if (again && choice === choices.length - 1) {
        await say(pages.slice(0, -1));
        continue;
      }
      if (typeof choice !== 'number' || choice <= 0 || !offers[choice - 1]) break;
      const o = offers[choice - 1];
      const stat = o.upgrade ? ownValue(STAT, o.upgrade) : null;
      const before = stat ? stat() : 0;
      const r = combat.buy(o.name);
      if (r.ok) {
        bought++;
        sfx('chime');
        toast(boughtToast(o.label, o, before, stat ? stat() : null));
      } else {
        sfx('cancel');
        toast(refusal(r.reason));
      }
    }
    await say([bought > 0 ? loc('dlg.shopkeeper.farewell-bought', 'A pleasure doing business. Mind the fire up there.') : loc('dlg.shopkeeper.farewell-none', 'Suit yourself. The cart is not going anywhere.')]);
  },
};

/**
 * The question a built-in action asks when the NPC's own dialogue doesn't end with a choice.
 * Like the hand-written conversations, the non-committal answer comes first: choosing any later
 * option runs the action (a designer's own closing page with one choice: that choice runs it).
 * Built when asked (the table of the language in force).
 */
const ACTION_PROMPTS = {
  rest: () => ({ text: loc('dlg.rest.ask', 'Will you rest until morning?'), choices: [loc('dlg.rest.not-yet', 'Not yet', 'choice'), loc('dlg.rest.until-morning', 'Rest until morning', 'choice')] }),
  // (a price only on combat levels, where the combat system sells the item for gold; `item`: the
  // name shown, translated)
  shop: (item, price = null) => ({
    text: price !== null
      ? contentFormat(loc('dlg.action.shop-ask-price', 'Would you like the ${item}? (${price} gold)'), { item, price })
      : contentFormat(loc('dlg.action.shop-ask', 'Would you like the ${item}?'), { item }),
    choices: [loc('dlg.shop.just-looking', 'Just looking', 'choice'), loc('dlg.action.shop-yes', 'Yes, please', 'choice')],
  }),
  music: () => ({ text: loc('dlg.action.music-ask', 'Another song, or a little quiet?'), choices: [loc('dlg.music.keep-playing', 'Keep playing', 'choice'), loc('dlg.action.music-quiet', 'Some quiet', 'choice')] }),
};

/**
 * A level villager's dialogue pages as shown (`dialogueUnits`: a page with at least one non-blank
 * choice is a choice page — also a single one, which the editor writes as "Question? [Okay |]",
 * ObjectCatalog.parseDialogueText; blank pages and choices are skipped): each page by the key its
 * object holds for it (`dialogueKeyOf` at the page's raw index) and each choice on its own
 * (`choiceKeyOf`; a choice page keeps its length: the answer is its index) — raw indices, as the
 * content tools list them (docs/specs/I18N.md §4.2). A page or a choice without a key (the scripts'
 * `{}` fallback, a level never keyed) shows its English (a `nokey` miss).
 * @param {ReturnType<typeof dialogueUnits>} units
 * @param {unknown} obj the villager's level object (its `textKeys`)
 * @returns {(string | DialogLine)[]}
 */
function showPages(units, obj) {
  return units.map((u) => {
    const text = loc(dialogueKeyOf(obj, u.i), u.text);
    if (!u.choices) return text;
    const choices = u.choices.map((c) => loc(choiceKeyOf(obj, u.i, c.j), c.text, 'choice'));
    return { text, choices };
  });
}

/**
 * Conversation for a level NPC without a script: its `dialogue` pages, then its built-in action.
 *   rest  — offers to rest until morning (Game.restUntilMorning)
 *   shop  — offers an item (`item`, default "Crisp Apple"); taking it adds it to the inventory
 *   music — starts the music, or offers to stop it when it is already playing
 * If the dialogue itself ends with a choice, that choice decides the action (any option but the
 * first runs it — for music: plays it, i.e. starts it when silent and keeps it when it is
 * already playing, so "Shall I play you a song? [No thanks | Yes, play!]" never silences it);
 * otherwise the action asks its own question (music that is not playing simply starts; a playing
 * song gets "Another song, or a little quiet?", whose second answer stops it).
 * A closing page with a single choice ("Off to bed with you. [Good night |]") has no
 * non-committal answer: its only answer runs the action (rest / shop; music: plays it, as above).
 * @param {Partial<LevelObjectOf<'npc'>>} obj level npc object
 *   (the scripts' fallback may pass {})
 * @returns {Conversation}
 */
export function levelConversation(obj) {
  const units = dialogueUnits(obj.dialogue);
  const action = obj.action ?? 'none';
  // (the English: what `buy`, the story and the inventory look up; `shown` is what the player reads)
  const item = String(obj.item || 'Crisp Apple');
  const last = units[units.length - 1];
  const endsWithChoice = !!last?.choices;
  // the first answer of the closing question that runs the action: the second one (the first is
  // the non-committal answer), or the only one of a one-choice closing page
  const firstYes = endsWithChoice && last.choices.length === 1 ? 0 : 1;
  return async (ctx) => {
    const { say, toast, sfx, game } = ctx;
    const playing = game.audio.musicPlaying;
    // (the item a term; none: the UI's default — its identity stays 'Crisp Apple'; looked up only
    // when it is shown, by the shop: another action never shows an `item` left in the data)
    const shown = action !== 'shop' ? '' : obj.item ? term(item) : t('game.default.item');
    // combat levels sell combat items for gold (COMBAT.md §6.12); anything else is a gift
    const price = action === 'shop' ? game.combat?.priceOf(item) ?? null : null;
    const lines = showPages(units, obj);
    if (!endsWithChoice) {
      if (action === 'rest') lines.push(ACTION_PROMPTS.rest());
      else if (action === 'shop') lines.push(ACTION_PROMPTS.shop(shown, price));
      else if (action === 'music' && playing) lines.push(ACTION_PROMPTS.music());
    }
    if (!lines.length) lines.push('…');
    const choice = await say(lines);
    const yes = typeof choice === 'number' && choice >= firstYes;
    /** "Obtained: …" with the count when it is more than one. @param {number} count */
    const obtained = (count) => (count > 1 ? contentFormat(loc('dlg.action.obtained-count', 'Obtained: ${item} ×${count}'), { item: shown, count }) : contentFormat(loc('dlg.action.obtained', 'Obtained: ${item}'), { item: shown }));
    if (action === 'rest' && yes) {
      await game.restUntilMorning();
    } else if (action === 'shop' && yes && price !== null) {
      const r = game.combat.buy(item);
      if (r.ok) {
        sfx('chime');
        toast(obtained(1));
      } else {
        sfx('cancel');
        toast(refusal(r.reason));
      }
    } else if (action === 'shop' && yes && game.story) {
      // a story keeps the item in its state, under the story file's id for that name (the journal)
      const { count } = game.story.giveNamed(item, 1);
      sfx('chime');
      toast(obtained(count));
    } else if (action === 'shop' && yes) {
      const key = item.toLowerCase();
      game.inventory[key] = (game.inventory[key] ?? 0) + 1;
      sfx('chime');
      toast(obtained(game.inventory[key]));
    } else if (action === 'music') {
      if (endsWithChoice) {
        // the designer's own question: a "yes" plays the music (a song already playing goes on)
        if (yes && !playing) {
          game.setMusic(true);
          toast(loc('dlg.action.music-toast', '♪ Music'));
        }
      } else if (!playing) {
        game.setMusic(true);
        toast(loc('dlg.action.music-toast', '♪ Music'));
      } else if (yes) {
        // the built-in "Another song, or a little quiet?" → "Some quiet"
        game.setMusic(false);
        toast(loc('dlg.music.fades', 'The music fades…'));
      }
    }
  };
}

/**
 * The conversation of a level NPC: its hand-written script when `script` names one, otherwise
 * its plain dialogue + action.
 * @param {LevelObjectOf<'npc'>} obj level npc object
 * @returns {Conversation}
 */
export function conversationFor(obj) {
  const script = obj.script ? ownValue(CONVERSATIONS, obj.script) : null;
  if (obj.script && !script) console.warn(`[Luminati] NPC "${obj.id}": unknown script "${obj.script}"; using its dialogue.`);
  // scripts get the NPC object too (the drillmaster falls back to its dialogue on peaceful levels)
  return script ? (ctx) => script(ctx, obj) : levelConversation(obj);
}
