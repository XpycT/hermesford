/**
 * The pixel UI's combat icons (docs/specs/PIXEL_UI.md §2), from mockup G's icon set; palette keys
 * as in icons/core.js. Listed in COMBAT_PURE (vite.config.js): only the combat chunk imports this
 * file.
 */
import { ICON_RAMPS, CORE_ICONS, iconCanvas } from './core.js';

/** @import { IconDef, IconOptions } from './core.js' */

const { MAIN, ACCENT, pal } = ICON_RAMPS;

/** @type {Record<string, IconDef>} */
export const COMBAT_ICONS = {
  // Whirl Slash: main the blade and hilt; accent the swoosh (c head → a tail), w its bright start.
  whirl: {
    palette: pal(MAIN.STEEL, ACCENT.WIND),
    rows: [
      '..............o.',
      '.....oooooo..oho',
      '...oocccwwwoohmo',
      '..occcbbccwwlmo.',
      '.occbbboccclmo..',
      '.ocbbomloolmo...',
      'occbo.omllmo....',
      'ocbo...omlo.....',
      'obao..oddmlo....',
      'obao.oddoomlo...',
      'obaoolmo..oo....',
      '.obaooo.........',
      '.obaao.....oo...',
      '..obaaoooooaao..',
      '...oobaaaaaoo...',
      '.....oooooo.....',
    ],
  },
  // Ember Bolt: main the fire (d dark red → h yellow), w the white-hot core; accent unused.
  bolt: {
    palette: pal(MAIN.FIRE, ACCENT.FIRE),
    rows: [
      '..........oooo..',
      '........oommmmo.',
      '.......ommllllmo',
      '......omllhhhlmo',
      '.....omlhhwwhhlo',
      '....omllhwwwwhlo',
      '...ommlhhwwwwhlo',
      '..ommomlhhwwhhlo',
      '.ommommllhhhhlmo',
      '.omommmlllllllo.',
      'omoommlommllmdo.',
      '.oommdodmmmddo..',
      '.ommdo.oooooo...',
      'omdoo...........',
      '.oo.............',
      '................',
    ],
  },
  // Radiant Nova: main the light (gold), w the core; accent unused.
  nova: {
    palette: pal(MAIN.GOLD, ACCENT.FIRE),
    rows: [
      '.......o........',
      '......olo.......',
      '......oho.......',
      '..o..olhlo..o...',
      '.omo.olhlo.omo..',
      '..ololhhhlolo...',
      '.ooolhhwhhlooo..',
      'olllhhwwwhhlllo.',
      '.ooolhhwhhlooo..',
      '..ololhhhlolo...',
      '.omo.olhlo.omo..',
      '..o..olhlo..o...',
      '......olo.......',
      '......omo.......',
      '.......o........',
      '................',
    ],
  },
  // The swordmaster's skills (docs/contracts/DRAGON_CAMPAIGN.md §6.8).
  // Tempest Edge: main an upright sword; accent the storm band round it — its tail (a) behind the
  // blade, the bright head (w) rising on the right after it crossed in front.
  tempest: {
    palette: pal(MAIN.STEEL, ACCENT.WIND),
    rows: [
      '....oo.oo.o.....',
      '...oaaohloaoo...',
      '..oaooohlooowo..',
      '.oabo.ohlo..owo.',
      'obbo..ohmo..owco',
      'obco..ohmo..ocbo',
      'obco..ohmo.occo.',
      '.obcooohmoooco..',
      '..obcccwccccbo..',
      '...obbbbbbbbo...',
      '....oooddooo....',
      '...ohllmmmmdo...',
      '....oooddooo....',
      '......omdo......',
      '......ommo......',
      '.......oo.......',
    ],
  },
  // Dragonfang Wave: main the crescent's body (red), accent its white-hot leading edge and the
  // echo it leaves behind.
  dragonfang: {
    palette: pal(MAIN.RED, ACCENT.FIRE),
    rows: [
      '..ooooo.........',
      '.occwccooo......',
      '.obllllcccoo....',
      '..oommmlllcco...',
      '..o.oodmmllcco..',
      '.oco..oddmlcco..',
      '..obo..oddmlcco.',
      '...obo...odmlco.',
      '....obo..odmlcco',
      '....obo...odlcco',
      '....obo..oddlcco',
      '....oao...odlco.',
      '...oao...odlcco.',
      '..oao...odmlco..',
      '...o...oddmco...',
      '........oooo....',
    ],
  },
  // Skyfall Judgement: main the sword, point down; accent the light bursting where it strikes.
  skyfall: {
    palette: pal(MAIN.STEEL, ACCENT.GOLD),
    rows: [
      '......oooo......',
      '......ohmo......',
      '......oddo......',
      '......omdo......',
      '..oooooddooooo..',
      '..ohllllmmmmdo..',
      '..oooohlmdoooo..',
      '.....ohlmdo.....',
      '.....ohlmdo.....',
      '..a..ohlmdo..a..',
      '...b.ohlmdo.b...',
      '....cohlmdoc....',
      '.....cohmoc.....',
      '..aabccwwccbaa..',
      '.oabbbccccbbbao.',
      '..oooooooooooo..',
    ],
  },
  // The bellwarden's skills (docs/contracts/EVERMERE_CAMPAIGN.md §5.5).
  // Peal: main the bell-founder's hammer (its head struck bright on the face), accent the sound
  // rolling out from it in arcs (c the nearest, a the farthest).
  peal: {
    palette: pal(MAIN.STEEL, ACCENT.GOLD),
    rows: [
      '.......obo.oaaoa',
      '.ooooo.obbo.oaoo',
      'owhhhho.obbooao.',
      'ollllmco.oboobo.',
      'ollllmwo.ocoobo.',
      'ollllmco.ocoobo.',
      'olddddo.obboobo.',
      '.oomdo.obbo.oaoo',
      '..omdoobbo.oaaoa',
      '..omdo.oo.oaaooa',
      '..omdo...oaaooaa',
      '..omdo..oaaooaao',
      '..omdo...oo.oao.',
      '..omdo.......o..',
      '..omdo..........',
      '..odo...........',
    ],
  },
  // Toll: main the spectral bell (its loop, the cast line, the clapper), accent the sound ring
  // round its foot and the ticks of its toll.
  toll: {
    palette: pal(MAIN.GOLD, ACCENT.WIND),
    rows: [
      '......olmo......',
      '......omdo......',
      '.....ohlmdo.....',
      '.o...owlmdo...o.',
      'oco.ohhllmdo.oco',
      '.ocoohhllmdooco.',
      'o.o.ohhllmdo.o.o',
      'bo..ohhllmdo..ob',
      'o..ohhhllmddo..o',
      '...oddddddddo...',
      '..ohhhlllmmddo..',
      '..ohhhhllllllo..',
      '.oaaaaamdaaaaao.',
      'oaaooooooooooabo',
      'obbbboooooobbbbo',
      '.ooobbbbbbbbooo.',
    ],
  },
  // Carillon: main the four bells round her, accent the last chord bursting between them.
  carillon: {
    palette: pal(MAIN.GOLD, ACCENT.GOLD),
    rows: [
      '......omlo......',
      '......ohlo......',
      '.....ohlldo.....',
      '.....ohlldo.....',
      '..oo.ohhllo.oo..',
      '.omlo.oooo.omlo.',
      '.ohlooacoaoohlo.',
      'ohlldocwcoohlldo',
      'ohlldoocbbohlldo',
      'ohhlloaobaohhllo',
      '.oooo.omlo.oooo.',
      '......ohlo......',
      '.....ohlldo.....',
      '.....ohlldo.....',
      '.....ohhllo.....',
      '......oooo......',
    ],
  },
  // Healing Draught: d m the cork, l h the glass, a b c the liquid, w the glass glint.
  draught: {
    palette: pal(MAIN.FLASK, ACCENT.RED),
    rows: [
      '......oooo......',
      '.....ommmdo.....',
      '.....ommddo.....',
      '....ohlllllo....',
      '.....ohlllo.....',
      '....oohllloo....',
      '...ohhllllllo...',
      '..ohlllllllllo..',
      '..ohwcccccccco..',
      '.ohwcbbbbbbbbao.',
      '.ohcbbbbbbbbbao.',
      '.olcbbbbbbbbaao.',
      '..obbbbbbbbaao..',
      '..oabbbbbbaaao..',
      '...oaaaaaaaao...',
      '....oooooooo....',
    ],
  },
  // MP: main the drop (l on the lower right is the inner glow), w the glint.
  mana: {
    palette: pal(MAIN.BLUE, ACCENT.BLUE),
    rows: [
      '.......o........',
      '......omo.......',
      '.....olmmo......',
      '.....olmmo......',
      '....olhmmdo.....',
      '...olhmmmmdo....',
      '...olhmmmmdo....',
      '..olhmmmmmmdo...',
      '.olhwmmmmmmmdo..',
      '.olhhmmmmmmldo..',
      '.olhmmmmmmmldo..',
      '..ommmmmmmldo...',
      '...odmmmlldo....',
      '....odddddo.....',
      '.....ooooo......',
      '................',
    ],
  },
  // SP: main the lightning.
  stamina: {
    palette: pal(MAIN.GREEN, ACCENT.GREEN),
    rows: [
      '.......oooo.....',
      '......ohhhmo....',
      '.....ohllmo.....',
      '.....ohlmo......',
      '....ohllmo......',
      '....ohlmooo.....',
      '...ohllhhhmo....',
      '...odmmllmo.....',
      '....ooollmo.....',
      '.....ollmo......',
      '.....olmo.......',
      '....ollmo.......',
      '....olmo........',
      '...olmo.........',
      '...omo..........',
      '....o...........',
    ],
  },
  // main the bone; a the glint in the eye sockets (o).
  skull: {
    palette: pal(MAIN.BONE, ACCENT.RED),
    rows: [
      '................',
      '.....oooooo.....',
      '...oohllllmoo...',
      '..ohlmmmmmmlmo..',
      '.ohmmmmmmmmmmmo.',
      '.olmmmmmmmmmmdo.',
      '.olmdddmmdddmdo.',
      '.oldoooldoooldo.',
      '.oldoaoldoaoldo.',
      '.omdooomdoooldo.',
      '..omllmoohlldo..',
      '...olmdlldmdo...',
      '...oldoldoldo...',
      '...omdmddmddo...',
      '....oooooooo....',
      '................',
    ],
  },
  // main the blade; a b c the hilt (a the grip).
  sword: {
    palette: pal(MAIN.STEEL, ACCENT.GOLD),
    rows: [
      '..............o.',
      '.............oho',
      '............ohmo',
      '...........ohmo.',
      '..........olmo..',
      '.........olmo...',
      '....oo..olmo....',
      '...obcoolmo.....',
      '....obclmo......',
      '.....obco.......',
      '....oabbco......',
      '...oaboobco.....',
      '.ooabo..oo......',
      'ocboo...........',
      'obao............',
      '.oo.............',
    ],
  },
};

/** The skill slots' icons (the HUD's skill ids → icon): the traveler's, the swordmaster's, the bellwarden's, the draught. */
export const SKILL_ICONS = Object.freeze({
  whirl: 'whirl', bolt: 'bolt', nova: 'nova', tempest: 'tempest', dragonfang: 'dragonfang', skyfall: 'skyfall',
  peal: 'peal', toll: 'toll', carillon: 'carillon', draught: 'draught',
});
/** The loot feed's icons (CombatHUD loot kinds → icon). */
export const LOOT_ICONS = Object.freeze({ gold: 'coin', heart: 'heart', mana: 'mana', draught: 'draught', upgrade: 'star', core: 'gem' });

/**
 * An icon's canvas: a combat icon or a core one (`icon(name, { palette, scale, mono, outline })`).
 * @param {string} name
 * @param {IconOptions} [o]
 * @returns {HTMLCanvasElement}
 */
export function icon(name, o) {
  const own = (t) => (Object.prototype.hasOwnProperty.call(t, name) ? t[name] : null);
  const def = own(COMBAT_ICONS) ?? own(CORE_ICONS);
  if (!def) throw new Error(`icon: no icon "${name}" (combat: ${Object.keys(COMBAT_ICONS).join(', ')}; core: ${Object.keys(CORE_ICONS).join(', ')})`);
  return iconCanvas(def, o);
}
