/**
 * The pixel UI's icons, the core set (docs/specs/PIXEL_UI.md §2): mockup G's icon set as 16 × 16
 * palette rows, drawn as classic 16-bit RPG item icons — a 1-pixel dark outline, shading lit from
 * the top left, a white glint. This file holds the icons every level may show (the clock, toasts,
 * interface marks) and `icon()`; the combat-only and party-only icons are in icons/combat.js and
 * icons/party.js (COMBAT_PURE / PARTY_PURE), each with an `icon()` that also finds these.
 *
 * Palette keys, the same in every icon, so any icon recolours to the UI's palette:
 * - `o` the outline (also the holes and the dark lines inside an icon);
 * - `d m l h` the main ramp, dark to highlight: the body of the motif;
 * - `a b c` the accent ramp, dark to light: the coloured part (a gem, a liquid, a flame …);
 * - `w` a white glint.
 * The clock's dawn and dusk (and the golden hour's sun in the fire ramp) are new, in the same style.
 */
import { pal as uiPal } from '../palette.js';
import { rowsToCanvas } from '../painter.js';

/** @typedef {{ rows: readonly string[], palette: Readonly<Record<string, string>> }} IconDef */

const OUTLINE = '#1a1222';
const GLINT = '#ffffff';

/** Main ramps: d m l h, dark to highlight. */
const MAIN = {
  BLUE: { d: '#18266c', m: '#2a58c0', l: '#4c98ee', h: '#b2e0ff' },
  BONE: { d: '#6a6252', m: '#aca48c', l: '#dcd4ba', h: '#fbf8ea' },
  FIRE: { d: '#861a10', m: '#d6421a', l: '#f59a2a', h: '#ffe27a' },
  FLASK: { d: '#4a2a14', m: '#8a5a2c', l: '#9fb8d2', h: '#e6f4ff' },
  GEM: { d: '#0e4a52', m: '#1e8c8e', l: '#46c8c0', h: '#b8fff0' },
  GLOVE: { d: '#6a6c8c', m: '#acb0c6', l: '#e0e2ee', h: '#ffffff' },
  GOLD: { d: '#7c4610', m: '#c27e1a', l: '#eeb63c', h: '#fde88e' },
  GREEN: { d: '#18502a', m: '#2e8a36', l: '#68c648', h: '#ccf28a' },
  LEATHER: { d: '#3e2410', m: '#6e4222', l: '#9c6436', h: '#c88e56' },
  MOON: { d: '#545c8c', m: '#97a2d0', l: '#cfd8f2', h: '#f8fbff' },
  PARCH: { d: '#8e6a3e', m: '#c9a26c', l: '#e8cf9a', h: '#fff2cf' },
  RED: { d: '#64101e', m: '#b2202e', l: '#e64a46', h: '#ff9c8c' },
  STEEL: { d: '#3e4660', m: '#7a84a0', l: '#b8c0d4', h: '#eef1f8' },
  WOOD: { d: '#44240e', m: '#764420', l: '#a86e38', h: '#d8a462' },
};
/** Accent ramps: a b c, dark to light. */
const ACCENT = {
  BLUE: { a: '#1e3288', b: '#3a6ad8', c: '#7cb2f8' },
  FIRE: { a: '#a8300e', b: '#f07a1e', c: '#ffd050' },
  GOLD: { a: '#8a5014', b: '#d2962a', c: '#f8d668' },
  GREEN: { a: '#1e6a2e', b: '#3aa83e', c: '#8ee05a' },
  RED: { a: '#7a1424', b: '#c8303a', c: '#f47070' },
  STEEL: { a: '#4e5670', b: '#9aa2ba', c: '#dde2ee' },
  VIOLET: { a: '#4a2286', b: '#8a4ad8', c: '#c89cff' },
  WIND: { a: '#3c7ab2', b: '#7ec8ee', c: '#d6f6ff' },
  WOOD: { a: '#5a3416', b: '#8e5a2c', c: '#c08a4e' },
};

/**
 * An icon's palette: the outline, a main ramp, an accent ramp and the glint.
 * @param {{ d: string, m: string, l: string, h: string }} main
 * @param {{ a: string, b: string, c: string }} accent
 */
const pal = (/** @type {Record<string, string>} */ main, /** @type {Record<string, string>} */ accent) => ({ o: OUTLINE, ...main, ...accent, w: GLINT });

/** Dawn's accent: the rose of today's dawn phase colour. */
const ACCENT_ROSE = { a: '#8a2a4a', b: '#e06a7e', c: '#ffb0b4' };

/** The ramps, for the other icon files. */
export const ICON_RAMPS = Object.freeze({ OUTLINE, GLINT, MAIN, ACCENT, ACCENT_ROSE, pal });

/** @type {Record<string, IconDef>} */
export const CORE_ICONS = {
  // main the disc, a b c the rays, w the glint.
  sun: {
    palette: pal(MAIN.GOLD, ACCENT.FIRE),
    rows: [
      '.......oo.......',
      '......ocbo......',
      '...o..obao..o...',
      '..obo.oooo.obo..',
      '...obohhllobo...',
      '....ohwhllmo....',
      '.ooohhllllmmooo.',
      'ocbohllllmmdocbo',
      'obaolllmmmmdobao',
      '.ooollmmmmddooo.',
      '....ommmdddo....',
      '...obomdddobo...',
      '..obo.oooo.obo..',
      '...o..ocbo..o...',
      '......obao......',
      '.......oo.......',
    ],
  },
  // main the crescent.
  moon: {
    palette: pal(MAIN.MOON, ACCENT.BLUE),
    rows: [
      '................',
      '.....ooo........',
      '....ohldo.......',
      '...ohmdo........',
      '..ohmmdo........',
      '..olmdo.........',
      '.ohmmdo.........',
      '.olmmmmo........',
      '.olmmmdo........',
      '.ommmmmmo.......',
      '..olmmmmmooooo..',
      '..ommmmmmlllldo.',
      '...ommmmmmmmdo..',
      '....omddddddo...',
      '.....ooooooo....',
      '................',
    ],
  },
  // HP: main the heart, w the glint.
  heart: {
    palette: pal(MAIN.RED, ACCENT.RED),
    rows: [
      '................',
      '...ooo...ooo....',
      '..olllo.olmmo...',
      '.olhhllolmmmdo..',
      'olhwhlllmmmmmdo.',
      'olhhllmmmmmmmdo.',
      'ollllmmmmmmmddo.',
      '.olmmmmmmmmddo..',
      '..ommmmmmmddo...',
      '...ommmmmddo....',
      '....ommmddo.....',
      '.....omddo......',
      '......odo.......',
      '.......o........',
      '................',
      '................',
    ],
  },
  // Heal: main the cross, w the glint.
  cross: {
    palette: pal(MAIN.GREEN, ACCENT.GREEN),
    rows: [
      '................',
      '......oooo......',
      '.....ohllmo.....',
      '.....olwmdo.....',
      '.....olmmdo.....',
      '..oooolmmdoooo..',
      '.ohlllmmmmlllmo.',
      '.olmmmmmmmmmmdo.',
      '.olmmmmmmmmmmdo.',
      '.omdddmmmmddddo.',
      '..oooolmmdoooo..',
      '.....olmmdo.....',
      '.....olmmdo.....',
      '.....omdddo.....',
      '......oooo......',
      '................',
    ],
  },
  // XP: main the star.
  star: {
    palette: pal(MAIN.GOLD, ACCENT.GOLD),
    rows: [
      '.......o........',
      '......oho.......',
      '.....ohlmo......',
      '.....owlmo......',
      '.oooohllmmoooo..',
      'ohhhhhllllmmmmo.',
      '.olhlllllllmdo..',
      '..olllllllmdo...',
      '...olllllmmo....',
      '...ollllmmmo....',
      '..olllmdmmmdo...',
      '..ollmooommdo...',
      '.olmdo...omddo..',
      '.omdo.....oddo..',
      '..oo.......oo...',
      '................',
    ],
  },
  // Gold: main the coin (d the engraved ring, h l the rim).
  coin: {
    palette: pal(MAIN.GOLD, ACCENT.GOLD),
    rows: [
      '................',
      '.....oooooo.....',
      '....ohhhhlloo...',
      '...ohwllllllmo..',
      '..ohllddddllmmo.',
      '.ohlldmmmmdlmdo.',
      '.olldmmlmmmhldo.',
      '.olldmlhlmmhldo.',
      '.olldmmlmmmhldo.',
      '.olldmmmmmmhldo.',
      '.ollmdmmmmhlmdo.',
      '..olmmhhhhlmdo..',
      '...ommlllmmdo...',
      '....oddddddo....',
      '.....oooooo.....',
      '................',
    ],
  },
  // main the key; o the hole in the bow.
  key: {
    palette: pal(MAIN.GOLD, ACCENT.GOLD),
    rows: [
      '..oooo..........',
      '.ohhllo.........',
      'ohllllmo........',
      'ohloolmo........',
      'olmoomdo........',
      'olmmmddo........',
      '.ommddmlo.......',
      '..ooooodlo......',
      '.......odlo.....',
      '........odlo....',
      '.........odlo...',
      '........ommdlo..',
      '.......omdoodlo.',
      '........ooommo..',
      '.........omdo...',
      '..........oo....',
    ],
  },
  // main the parchment (d the writing and the roll's underside); a b c the wax seal.
  scroll: {
    palette: pal(MAIN.PARCH, ACCENT.RED),
    rows: [
      '..oooooooooooo..',
      '.ohllllllllllmo.',
      'olmmmmmmmmmmmmdo',
      '.oddddddddddddo.',
      '..olmmmmmmmmdo..',
      '..oldddldddldo..',
      '..olmmmmmmmmdo..',
      '..olddddlddldo..',
      '..olmmmmmddddo..',
      '..oldddllbcbmo..',
      '..olmmmmdabamo..',
      '.ohmmmmmmlllmmo.',
      'olmmmmmmmmmmmmdo',
      '.oddddddddddddo.',
      '..oooooooooooo..',
      '................',
    ],
  },
  // main the wood; a b c the bands, the rim and the lock plate; o the keyhole.
  chest: {
    palette: pal(MAIN.WOOD, ACCENT.GOLD),
    rows: [
      '................',
      '...oooooooooo...',
      '..ohllllllllmo..',
      '.ohmmmmmmmmmmmo.',
      'ohmmmmmmmmmmmmmo',
      'omdddddddddddddo',
      'occbbbccccbbbcao',
      'olbhlmcaaahlmblo',
      'omblmdbooblmdbmo',
      'omblmdbboalmdbmo',
      'omblmmmbahmmdbmo',
      'odbmdddmmddddbdo',
      'ocabbbbbbbbbbaao',
      '.oooooooooooooo.',
      '................',
      '................',
    ],
  },
  // main the stone, w the glint.
  gem: {
    palette: pal(MAIN.GEM, ACCENT.WIND),
    rows: [
      '................',
      '................',
      '....oooooooo....',
      '...ohhhhhhhho...',
      '..ohwhhhhhhlmo..',
      '.olhhllllllmmdo.',
      'olmmmmmmmmmmdddo',
      '.olhhlllmmmmddo.',
      '..olhhllmmmddo..',
      '...olhllmmddo...',
      '....olhlmddo....',
      '.....olhddo.....',
      '......oldo......',
      '.......oo.......',
      '................',
      '................',
    ],
  },
  // main the ring and the E S W points (each split light / dark); c a the north point, w the centre.
  compass: {
    palette: pal(MAIN.GOLD, ACCENT.RED),
    rows: [
      '.......o........',
      '.....oocoo......',
      '....oldcldo.....',
      '...omoccaomo....',
      '..omooccaoomo...',
      '.oloocccaaoolo..',
      '.olhhcccaalldo..',
      'ohhhhhhwllllllo.',
      '.olmmllldddddo..',
      '.odoolllddoodo..',
      '..omoolldoomo...',
      '...omolldomo....',
      '....oldlddo.....',
      '.....ooloo......',
      '.......o........',
      '................',
    ],
  },
  // main the gold; a b c the jewels.
  crown: {
    palette: pal(MAIN.GOLD, ACCENT.RED),
    rows: [
      '................',
      '................',
      '.o.....o.....o..',
      'obo...obo...obo.',
      'olo..ohlmo..olo.',
      'olmo.olmdo.ohdo.',
      'olmmohmmmmohmdo.',
      'olmmlmmmmmlmmdo.',
      'oldmmmdddmmmddo.',
      'omblmdcbalmdbmo.',
      'omlmmmlllmmmldo.',
      '.omddddddddddo..',
      '..ooooooooooo...',
      '................',
      '................',
      '................',
    ],
  },
  // main the pole; a b c the pennant.
  flag: {
    palette: pal(MAIN.STEEL, ACCENT.RED),
    rows: [
      '..o.............',
      '.olooooo........',
      '.omccccbooo.....',
      '.omcbbbbccbooo..',
      '.omcbbbbbbbccao.',
      '.omcbbbbbbaaao..',
      '.omcbbbaaaooo...',
      '.ombaaaooo......',
      '.omoooo.........',
      '.omo............',
      '.omo............',
      '.omo............',
      '.omo............',
      '.omo............',
      '.odo............',
      '..o.............',
    ],
  },
  // The pointing hand: main the glove; a b c the cuff.
  cursor: {
    palette: pal(MAIN.GLOVE, ACCENT.GOLD),
    rows: [
      '................',
      '................',
      '....oooo........',
      '...ohllmoooooo..',
      '.oohmmmmlllllmo.',
      'ocblmmmmdddddddo',
      'ocalmmmdooooooo.',
      'ocalmmmmmmmdo...',
      'ocalmmmdoooo....',
      'ocalmmmmmmmdo...',
      'ocalmmmdoooo....',
      'obalmmmmlmdo....',
      '.oomdddddoo.....',
      '...oooooo.......',
      '................',
      '................',
    ],
  },
  // A small right-pointing triangle (4 × 7 inside its outline), vertically centred: main.
  arrow: {
    palette: pal(MAIN.GLOVE, ACCENT.GOLD),
    rows: [
      '................',
      '................',
      '................',
      '......o.........',
      '.....oho........',
      '.....ohlo.......',
      '.....ohllo......',
      '.....ohllmo.....',
      '.....olmmo......',
      '.....omdo.......',
      '.....odo........',
      '......o.........',
      '................',
      '................',
      '................',
      '................',
    ],
  },
  // main the tick.
  check: {
    palette: pal(MAIN.GREEN, ACCENT.GREEN),
    rows: [
      '................',
      '................',
      '............oo..',
      '...........ohmo.',
      '..........ohmdo.',
      '.........ohmdo..',
      '.oo.....ohmdo...',
      'ohmo...ohmdo....',
      'ommmo.ohmdo.....',
      '.ommmohmdo......',
      '..ommlmdo.......',
      '...ommdo........',
      '....odo.........',
      '.....o..........',
      '................',
      '................',
    ],
  },
  // main the body; a b c the shackle; o the keyhole.
  lock: {
    palette: pal(MAIN.GOLD, ACCENT.STEEL),
    rows: [
      '.....oooooo.....',
      '....occcccbo....',
      '...ocbaaaabbo...',
      '...ocaoooocao...',
      '...ocao..ocao...',
      '...ocao..ocao...',
      '..oobaoooobaoo..',
      '.ohllllllllllmo.',
      '.olwmmmddmmmmdo.',
      '.olmmmdoolmmmdo.',
      '.olmmmdoolmmmdo.',
      '.olmmmmmolmmmdo.',
      '.olmmmmdolmmmdo.',
      '.omdddddmdddddo.',
      '..oooooooooooo..',
      '................',
    ],
  },
  // Dawn (new; G's icon set has none): the sun's upper half rising over the horizon, its rays above;
  // main the disc, a b c the rays and the glowing horizon with its reflection, w the glint.
  dawn: {
    palette: pal(MAIN.GOLD, ACCENT_ROSE),
    rows: [
      '.......oo.......',
      '......ocbo......',
      '...o..obao..o...',
      '..obo.oooo.obo..',
      '...obohhllobo...',
      '....ohwhllmo....',
      '.ooohhllllmmooo.',
      'ocbohllllmmdocbo',
      'obaolllmmmmdobao',
      '.oooooooooooooo.',
      'oaabbccccccbbaao',
      '.oooooooooooooo.',
      '....obbccbbo....',
      '.....oooooo.....',
      '......obbo......',
      '.......oo.......',
    ],
  },
  // Dusk (new): a low dome of the setting sun on the horizon, two short rays either side;
  // main the disc (fire), a b c the rays and the violet horizon, w the glint.
  dusk: {
    palette: pal(MAIN.FIRE, ACCENT.VIOLET),
    rows: [
      '................',
      '................',
      '................',
      '..o..........o..',
      '.obo........obo.',
      '..obo......obo..',
      '...o..oooo..o...',
      '.....ohhllo.....',
      '....ohwhllmo....',
      '...ohhllllmmo...',
      '..ohllllmmmmdo..',
      '.oooooooooooooo.',
      'oaabbccccccbbaao',
      '.oooooooooooooo.',
      '...oabbccbbao...',
      '....oooooooo....',
    ],
  },
};
// the golden hour: the sun in the fire ramp (today's HUD recolours its sun the same way)
CORE_ICONS.golden = { rows: CORE_ICONS.sun.rows, palette: pal(MAIN.FIRE, ACCENT.FIRE) };

/** The clock's icon for each phase of the day (HUD TIME_PHASES ids). */
export const PHASE_ICONS = Object.freeze({ night: 'moon', dawn: 'dawn', morning: 'sun', midday: 'sun', afternoon: 'sun', golden: 'golden', dusk: 'dusk' });

/**
 * The icon options: `palette` overrides some keys (`GOLD_ICON()` / `DUSK_ICON()` recolour a whole
 * icon to G's idle tones); `mono` paints every pixel in that colour (the outline too unless
 * `outline` is given); `scale` canvas pixels per icon pixel.
 * @typedef {{ palette?: Record<string, string>, scale?: number, mono?: string, outline?: string }} IconOptions
 */

/**
 * An icon definition's canvas (16 × 16 × scale).
 * @param {IconDef} def
 * @param {IconOptions} [o]
 * @returns {HTMLCanvasElement}
 */
export function iconCanvas(def, { palette = {}, scale = 1, mono, outline } = {}) {
  /** @type {Record<string, string>} */
  let p = { ...def.palette, ...palette };
  if (mono) {
    p = {};
    for (const k of new Set(def.rows.join(''))) if (k !== '.') p[k] = mono;
    if (outline) p.o = outline;
  }
  return rowsToCanvas([...def.rows], p, scale);
}

/**
 * A core icon's canvas (G's `icon(name, { palette, scale, mono, outline })`). Throws for a name
 * that is not a core icon (icons/combat.js and icons/party.js have their own `icon()`).
 * @param {string} name
 * @param {IconOptions} [o]
 * @returns {HTMLCanvasElement}
 */
export function icon(name, o) {
  const def = Object.prototype.hasOwnProperty.call(CORE_ICONS, name) ? CORE_ICONS[name] : null;
  if (!def) throw new Error(`icon: no core icon "${name}" (${Object.keys(CORE_ICONS).join(', ')})`);
  return iconCanvas(def, o);
}

/** G's idle tone: engraved gold (rule rows). */
export const GOLD_ICON = () => { const k = uiPal(); return { palette: { o: k.ink0, d: k.g1, m: k.g2, l: k.g3, h: k.g4, a: k.g1, b: k.g2, c: k.g3, w: k.g4 } }; };
/** G's idle tone: dusk (presets not chosen, a locked skill). */
export const DUSK_ICON = () => { const k = uiPal(); return { palette: { o: k.ink0, d: k.ink2, m: k.ink3, l: k.ink4, h: k.ink5, a: k.ink3, b: k.ink4, c: k.ink5, w: k.tx3 } }; };
