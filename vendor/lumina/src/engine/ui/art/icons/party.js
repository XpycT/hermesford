/**
 * The pixel UI's party icons (docs/specs/PIXEL_UI.md §2), from mockup G's icon set; palette keys as
 * in icons/core.js. Listed in PARTY_PURE (vite.config.js): only the party chunk imports this file.
 */
import { ICON_RAMPS, CORE_ICONS, iconCanvas } from './core.js';

/** @import { IconDef, IconOptions } from './core.js' */

const { MAIN, ACCENT, pal } = ICON_RAMPS;

/** @type {Record<string, IconDef>} */
export const PARTY_ICONS = {
  // main the white ring; a b c the red rings and the bull, w the glint.
  target: {
    palette: pal(MAIN.BONE, ACCENT.RED),
    rows: [
      '.....ooooo......',
      '...ooccccboo....',
      '..occaaaaacbo...',
      '.ocbahlllmbbbo..',
      '.ocahmdddmmbao..',
      'ocahmdccbmmmcbo.',
      'ocaldcwcbbldcao.',
      'ocaldccbbaldcao.',
      'ocaldbbbbaldcao.',
      'obammmbaahmdcao.',
      '.ocbmmlllmdcao..',
      '.obbbmddddcbao..',
      '..obacccccaao...',
      '...oobaaaaoo....',
      '.....ooooo......',
      '................',
    ],
  },
  // Distance: main the leather; a b c the cuff and the sole.
  boots: {
    palette: pal(MAIN.LEATHER, ACCENT.GOLD),
    rows: [
      '................',
      '..oooooo........',
      '.occcccbo.......',
      '.oabbbbao.......',
      '..olmmmdo.......',
      '..olmmmdo.......',
      '..olmmmdo.......',
      '..olmmmdo.......',
      '..olmmmmdo......',
      '..olmmmmmdoo....',
      '..olmmmmmmmdo...',
      '..olhmmmmmmmdo..',
      '..olmmmmmmmmdo..',
      '..oaaaaoaaaaao..',
      '...oooo.ooooo...',
      '................',
    ],
  },
  // Attack: main the blades; a b c the hilts.
  crossed: {
    palette: pal(MAIN.STEEL, ACCENT.GOLD),
    rows: [
      '.o...........o..',
      'oho.........oho.',
      'ohmo.......ohmo.',
      '.ohmo.....ohmo..',
      '..ohmo...ohmo...',
      '...ohmo.ohmo....',
      '....ohmohmo.....',
      '.....ohmmo......',
      '.....odhmo......',
      '...oohmohmoo....',
      '..ochmo.olmco...',
      '..obco...ocbo...',
      '...obco.ocbo....',
      '..oaoo...ooao...',
      '.oco.......oco..',
      '..o.........o...',
    ],
  },
  // Skills: main the pages (d the writing); a b c the cover; w c the rune sparkle above.
  spell: {
    palette: pal(MAIN.PARCH, ACCENT.VIOLET),
    rows: [
      '.......o........',
      '......owo.......',
      '.....owcwo......',
      '......owo.......',
      '...ooo.o.ooo....',
      '..ohhhooohhho...',
      '.ohlllhhhlllmo..',
      'ochlddlolddmlbo.',
      'ochllllollllmbo.',
      'ochlddlolddmmbo.',
      'ochllllollllmbo.',
      'ochllllollllmbo.',
      'ocbbbbbabbbbbao.',
      '.oaaaaoooaaaao..',
      '..oooo...oooo...',
      '................',
    ],
  },
  // Evade: main the feathers.
  wing: {
    palette: pal(MAIN.GLOVE, ACCENT.WIND),
    rows: [
      '................',
      '...........ooo..',
      '.........oohhho.',
      '.......oohhllmo.',
      '.....oohhllmmo..',
      '...oohhllmmoo...',
      '..ohhllmmoohho..',
      '.ohllmmoohhlmo..',
      '.ohlmoohhllmo...',
      'ohlmohhllmmoo...',
      'ohlohllmmoohhoo.',
      'ohlohlmoohhlllmo',
      '.oholmohhllmmoo.',
      '..oolohllmmoo...',
      '....ooooooo.....',
      '................',
    ],
  },
  // Fall back: main the arrow.
  retreat: {
    palette: pal(MAIN.GLOVE, ACCENT.BLUE),
    rows: [
      '................',
      '....o...........',
      '...olo..........',
      '..ohdooooooo....',
      '.ohmmllllllmo...',
      'olmmmmmmmmmmmo..',
      '.ommmddddddmmmo.',
      '..omdoooooommdo.',
      '...odo.....olmmo',
      '....o......olmdo',
      '...........olmdo',
      '.......oooohmmdo',
      '......ohlllmmdo.',
      '......omdddddo..',
      '.......oooooo...',
      '................',
    ],
  },
  // Balanced: main the scales.
  scales: {
    palette: pal(MAIN.GOLD, ACCENT.GOLD),
    rows: [
      '................',
      '.......oo.......',
      '..ooooohmooooo..',
      '.ohmmmmmmmmmmmo.',
      '.omooooldoooomo.',
      '.omo..oldo..omo.',
      '.omo..oldo..omo.',
      'ohmmo.oldo.ohmmo',
      'ommmdooldoolmmdo',
      '.omdo.oldo.omdo.',
      '..oo..oldo..oo..',
      '.....ooldoo.....',
      '....ohlmmlmo....',
      '...oldddddddo...',
      '....oooooooo....',
      '................',
    ],
  },
  // All-out: main the blade; a b c the flame and the hilt.
  fury: {
    palette: pal(MAIN.STEEL, ACCENT.FIRE),
    rows: [
      '.........o....o.',
      '.......ooco..oho',
      '......occao.ohmo',
      '.....ocbao.ohmo.',
      '....ocbbaoolmo..',
      '....ocbaoolmo...',
      '...ocbaaolmo....',
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
  // Hunt casters: main the white of the eye; a b c the iris; o the pupil, w the glint.
  eye: {
    palette: pal(MAIN.GLOVE, ACCENT.VIOLET),
    rows: [
      '................',
      '................',
      '.....oooooo.....',
      '...oohllllmoo...',
      '..ohlmddddmlmo..',
      '.ohmmdcccbmmmmo.',
      'ohmmdcbaabblmmmo',
      'olmmdcawocalmmdo',
      'ommmdbaoocalmmdo',
      '.ommmmbbbahmmdo.',
      '..omdmllllmddo..',
      '...oomdddddoo...',
      '.....oooooo.....',
      '................',
      '................',
      '................',
    ],
  },
  // Hold back: main the glove (an open palm); a b c the cuff.
  hand: {
    palette: pal(MAIN.GLOVE, ACCENT.GOLD),
    rows: [
      '......oo........',
      '...ooohmooo.....',
      '..ohmoldohmooo..',
      '..oldoldoldohmo.',
      '..oldoldoldoldo.',
      '..oldoldoldoldo.',
      '..oldoldoldoldo.',
      '.oolmlmmlmmlmdo.',
      'ololmmmmmmmmmdo.',
      'omlmmmmmmmmmmdo.',
      '.ommmmmmmmmmmdo.',
      '..ommmmmmmmmdo..',
      '...omddddddddo..',
      '....occccccbo...',
      '....obaaaaaao...',
      '.....ooooooo....',
    ],
  },
  // main the rim and the chevron; a b c the field.
  shield: {
    palette: pal(MAIN.STEEL, ACCENT.BLUE),
    rows: [
      '..oooooooooooo..',
      '.ohwmmmmmmmmmmo.',
      '.omcccccccccbmo.',
      '.omcbbbbabbbamo.',
      '.omcbbbahbbbamo.',
      '.omcbbahlhbbamo.',
      '.omcbahlclhbamo.',
      '.omcahlcbblhamo.',
      '.odahlcbbbblhdo.',
      '..olccbbbbbbmo..',
      '..odbbbbbbbado..',
      '...ombbbbbamo...',
      '....ombbbamo....',
      '.....ombamo.....',
      '......oldo......',
      '.......oo.......',
    ],
  },
  // Warden: main the head and the butt cap; a b c the shaft.
  spear: {
    palette: pal(MAIN.STEEL, ACCENT.WOOD),
    rows: [
      '..............o.',
      '.............oho',
      '...........oohmo',
      '..........olhmdo',
      '.........ollmdo.',
      '.........omdoo..',
      '........oddo....',
      '.......ocbo.....',
      '......ocbo......',
      '.....ocbo.......',
      '....ocbo........',
      '...ocbo.........',
      '..ocao..........',
      '.obao...........',
      'oddo............',
      '.oo.............',
    ],
  },
  // Ranger: main the wood (h also the string); a b c the grip wrap.
  bow: {
    palette: pal(MAIN.WOOD, ACCENT.RED),
    rows: [
      '.........oooo...',
      '......ooohllloo.',
      '.....ohllmmmmlho',
      '....olmooooooho.',
      '...ocbo....oho..',
      '..olbo....oho...',
      '.olmo....oho....',
      '.olo....oho.....',
      '.olo...oho......',
      'olmo..oho.......',
      'olmo.oho........',
      'olmooho.........',
      'olmoho..........',
      '.omho...........',
      '.oho............',
      '..o.............',
    ],
  },
  // Mystic: main the wood; a b c the orb, w its glint.
  staff: {
    palette: pal(MAIN.WOOD, ACCENT.VIOLET),
    rows: [
      '...........ooo..',
      '..........occbo.',
      '........oocwcbbo',
      '.......ohoccbbao',
      '.......olobbbaao',
      '.......olooaaao.',
      '.......omllmoo..',
      '......olmooo....',
      '.....olmo.......',
      '....olmo........',
      '...olmo.........',
      '..olmo..........',
      '.olmo...........',
      'omdo............',
      '.oo.............',
      '................',
    ],
  },
  // ---- the heroes of Vanquish the Evil Dragon (DRAGON_CAMPAIGN.md §5.4; PARTY.md §12) ----
  // Cleric: main the gilded staff and the sun's disc; a b c the rays, w the glint.
  holystaff: {
    palette: pal(MAIN.GOLD, ACCENT.FIRE),
    rows: [
      '........o.oco.o.',
      '.......obooooobo',
      '........oohhloo.',
      '.......oohwllmoo',
      '......ocohllmdoc',
      '.......oollmddoo',
      '........oomddoo.',
      '.......oldoooobo',
      '......oldooco.o.',
      '.....ohdo..o....',
      '....oldo........',
      '...ohdo.........',
      '..oldo..........',
      '.oldo...........',
      'omdo............',
      '.oo.............',
    ],
  },
  // Ice Mage: main the silver staff and its claw; a b c the ice crystal (shaded, mid, lit), w its glint.
  icestaff: {
    palette: pal(MAIN.STEEL, ACCENT.WIND),
    rows: [
      '..............oo',
      '......o.....oocb',
      '.....oco...occao',
      '......o...owcbao',
      '.........occbao.',
      '........occbaao.',
      '.......olcbaao..',
      '.......ohbaoo...',
      '......oldmo....o',
      '.....oldoo....oc',
      '....oldo.......o',
      '...oldo.........',
      '..oldo..........',
      '.oldo...........',
      'omdo............',
      '.oo.............',
    ],
  },
  // Greatshield: main the gilt rim, the dragon crest and the mace's head; a b the shield's field.
  towershield: {
    palette: pal(MAIN.GOLD, ACCENT.RED),
    rows: [
      '...ooooooooo.olo',
      '..ollllmddddohlm',
      '.olwbaaaaaaddmdo',
      '.olbbaaaaaaadoo.',
      '.olbhaawaahado..',
      '.olbbhahahaado..',
      '.olbbhhhhhaado..',
      '.olbbahhhaaado..',
      '.olbbaahaaaado..',
      '.ombbaahaaaado..',
      '.ombbahaaaaado..',
      '..ombaahaaado...',
      '...omaaaaado....',
      '....omaaado.....',
      '.....omado......',
      '......omo.......',
    ],
  },
};

/** The icon of each party rule field (src/engine/level/PartyRules.js RULE_FIELDS ids). */
export const FIELD_ICONS = Object.freeze({
  target: 'target', distance: 'boots', attack: 'crossed', skills: 'spell', heal: 'cross', evade: 'wing', retreat: 'retreat',
});
/** The icon of each preset (PartyRules.js PARTY_PRESETS ids). */
export const PRESET_ICONS = Object.freeze({
  balanced: 'scales', aggressive: 'fury', guardian: 'shield', support: 'heart', hunter: 'eye', passive: 'hand',
});
/** The icon of each party class (PartyRules.js PARTY_CLASSES ids). */
export const CLASS_ICONS = Object.freeze({
  warden: 'spear', ranger: 'bow', mystic: 'staff', cleric: 'holystaff', icemage: 'icestaff', greatshield: 'towershield',
});

/**
 * An icon's canvas: a party icon or a core one (`icon(name, { palette, scale, mono, outline })`).
 * @param {string} name
 * @param {IconOptions} [o]
 * @returns {HTMLCanvasElement}
 */
export function icon(name, o) {
  const own = (t) => (Object.prototype.hasOwnProperty.call(t, name) ? t[name] : null);
  const def = own(PARTY_ICONS) ?? own(CORE_ICONS);
  if (!def) throw new Error(`icon: no icon "${name}" (party: ${Object.keys(PARTY_ICONS).join(', ')}; core: ${Object.keys(CORE_ICONS).join(', ')})`);
  return iconCanvas(def, o);
}
