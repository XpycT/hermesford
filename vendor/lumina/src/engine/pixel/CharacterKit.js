/**
 * CharacterKit — The Bells of Evermere's character sprite parts (docs/contracts/EVERMERE_CAMPAIGN.md
 * §5.3, §6.5; the hero package): the bell-founder's hammer (`weapon: 'hammer'`: at rest, drawn, its
 * combat poses, its bronze collar — glow texels with `gear.hammerGlow`), the frost crown and the
 * Hushguard's greathelm (`hat: 'crown' | 'greathelm'`), a hood's fur rim (`hoodTrim`) and the tower
 * shield's other crests (`gear.crest: 'anchor' | 'plain'`). A chunk of its own, out of the static
 * graph every level downloads: CharacterSprites.js `loadCharacterKit` imports it and installs what
 * `createCharacterKit` returns (its hats into the hat table); CharacterSprites keeps only the names
 * (`usesCharacterKit`), the material ids and the seams that call these parts. Every texel is the
 * one the parts drew inside CharacterSprites.js (sandbox/bellwarden.cast.json: 96 sheets).
 *
 * @import { _painterKit } from './CharacterSprites.js'
 */
/** @typedef {InstanceType<typeof _painterKit.Painter>} Painter */
import { parseColor, shadeColor, mixColor } from './PixelCanvas.js';

/**
 * The parts, made over CharacterSprites' building blocks (`_painterKit`).
 * @param {typeof _painterKit} pk
 */
export function createCharacterKit(pk) {
  const { T, M, HAT_L, glowTexel, rampForKind, inFrame } = pk;
  /** The greathelm's: the T-slit's dark (`k`: the eyes' darkest, glowing faintly) and the eyes in it (`E`). */
  const GREATHELM_L = { ...HAT_L, k: [M.SLIT, 0], E: [M.SLIT, 2] };
  const HATS = {
    // The Bells of Evermere's Hushed King (EVERMERE_CAMPAIGN.md §5.3, §6.7): a tall crown of frost —
    // three ice spikes and two nubs rising off a band, a gem (`staffGem`, `gearGlow`) at its front; the
    // ice is the hat's colour (`hatColor`; default a pale ice). Its tips reach three rows over the hat
    // row of the head box (the frame's top margin kept).
    crown: {
      down: T([
        '.....5......',
        '.....54.....',
        '..5..54.5...',
        '..54.54.54..',
        '.443.43.433.',
        '.4554Jj4433.',
        '.2333j33222.',
      ], HAT_L, 0, -3),
      side: T([
        '.....5......',
        '.....54.....',
        '..5..54.5...',
        '..54.54.54..',
        '.443.43.433.',
        'J45544433332',
        'j2333333222.',
      ], HAT_L, 0, -3),
      up: T([
        '.....4......',
        '.....43.....',
        '..4..43.4...',
        '..43.43.43..',
        '.332.32.322.',
        '.3443333322.',
        '.2222222111.',
      ], HAT_L, 0, -3),
    },
    // The Bells of Evermere's Hushguard (EVERMERE_CAMPAIGN.md §5.4; Tin wears its empty helm): a barrel
    // greathelm over the whole head — a rounded crown, straight cheeks, a rim — its T-slit dark with the
    // eyes glowing in it (`eyes`: their colour; `M.SLIT` glow texels); iron by default (`hatColor`).
    greathelm: {
      down: T([
        '....3554....',
        '..33455443..',
        '.3445444332.',
        '.3444443332.',
        '344444433322',
        '345555544322',
        '3kkEkkkkEkk2',
        '34444kk33322',
        '34444kk33322',
        '34444kk33321',
        '233333322221',
        '.2222222111.',
      ], GREATHELM_L, 0, 0),
      side: T([
        '....35543...',
        '..3455443322',
        '.34544443322',
        '.34444433322',
        '344444433322',
        '455554433322',
        'kEkkk4433322',
        '3kk44433332.',
        '3kk44433332.',
        '3kk44433321.',
        '233333322221',
        '.2222222111.',
      ], GREATHELM_L, 0, 0),
      up: T([
        '....3554....',
        '..33455443..',
        '.3445444332.',
        '.3444443332.',
        '344444433322',
        '344444433322',
        '344444433322',
        '344444433322',
        '344444433322',
        '344444433321',
        '233333322221',
        '.2222222111.',
      ], HAT_L, 0, 0),
    },
  };
  /** The greathelm's default iron (the Hushguard's: `hatColor` overrides it). */
  const GREATHELM_IRON = '#2a3040';
  /** The crown's default ice (a pale frost blue: `hatColor` overrides it). */
  const CROWN_ICE = '#a9d9ec';
  /** The bell-founder's hammer's bronze collar (its ramp; glow texels with `gear.hammerGlow`). */
  const HAMMER_BRONZE = Object.freeze([[86, 50, 20, 255], [138, 86, 34, 255], [190, 128, 52, 255], [226, 172, 84, 255], [250, 214, 132, 255]]);
  /** The hats' default colours (`hatColor` overrides them). */
  const HAT_COLORS = Object.freeze({ crown: CROWN_ICE, greathelm: GREATHELM_IRON });

  /**
   * The parts' ramps (CharacterSprites' buildRamps, after the eyes'): the hammer's bronze collar, a
   * hood's fur rim, the greathelm's slit — the eyes' colour glowing in the dark of the helm (glow texels).
   * @param {any} c the resolved spec @param {any[]} ramps @param {any} eyeDark @param {any} eyeHex the eyes' colour
   */
  function ramps(c, ramps, eyeDark, eyeHex) {
    if (c.weapon === 'hammer') ramps[M.HCOLLAR] = c.gear.hammerGlow ? HAMMER_BRONZE.map(glowTexel) : HAMMER_BRONZE;
    if (c.hoodTrim) ramps[M.TRIM] = rampForKind(c.hoodTrim === true ? '#e8dcc8' : c.hoodTrim);
    if (c.hat === 'greathelm') ramps[M.SLIT] = [eyeDark, mixColor(eyeDark, eyeHex, 0.5), [...parseColor(eyeHex)], shadeColor(eyeHex, 0.3), shadeColor(eyeHex, 0.3)].map(glowTexel);
  }

  /**
   * The tower shield's crests (spec `gear.crest`, EVERMERE_CAMPAIGN.md §5.3: absent the wyvern):
   * `anchor` — Wenna's harbour-office door: an anchor, its ring, stock, shank and flukes —, `plain` —
   * the field alone, the boss kept. Rows of `shieldFace`; `CREST_EDGE_PLAIN` the plain one edge-on (`shieldEdge`).
   */
  const CRESTS = Object.freeze({
    anchor: Object.freeze([
      '.rRRRr.',
      'rLFgFFr',
      'rLgFgFr',
      'rGGGGGr',
      'rLFGFFr',
      'rLFGFFr',
      'rFFbFFr',
      'rGFGFGr',
      'rFGGGFd',
      '.rFFFd.',
      '..rdd..',
    ]),
    plain: Object.freeze([
      '.rRRRr.',
      'rLFFFFr',
      'rLFFFFr',
      'rLFFFFr',
      'rLFFFFr',
      'rLFFFFr',
      'rFFbFFr',
      'rLFFFFr',
      'rFFFFFd',
      '.rFFFd.',
      '..rdd..',
    ]),
  });
  const CREST_EDGE_PLAIN = Object.freeze(['rR.', 'LrR', 'LrR', 'LrR', 'LrR', 'FrR', 'brR', 'FrR', 'FrR', 'Frd', '.d.']);

  /**
   * The bell-founder's hammer (spec `weapon: 'hammer'`, EVERMERE_CAMPAIGN.md §5.3, §6.5: Linnet's,
   * her grandfather's) at rest in the plain poses: held low in the right hand at (hx, hy), the long
   * haft hanging straight down, the heavy square head resting by the foot — its long axis across
   * (`side` false: front / back views, the faces left and right) or along the facing (`side`: the side
   * views) —, a bronze collar where the haft enters it (`M.HCOLLAR`: glow texels with
   * `gear.hammerGlow`). `near`: the near hand (lit).
   * @param {Painter} p @param {number} hx @param {number} hy @param {boolean} side @param {boolean} [near]
   */
  function hammerHanging(p, hx, hy, side, near = true) {
    const s = near ? 1 : 0;
    // (side views: the haft angles forward, the head rests a step ahead of the feet — it shows past
    // them when the far hand holds it)
    const lean = side ? -4 : 0;
    const xAt = (y) => hx + Math.round(lean * Math.max(0, y - hy - 1) / 5);
    p.begin('all', 0);
    // the haft (the butt above the fist, the wood below it down to the head)
    p.set(hx, hy - 1, M.WOOD, 2 + s);
    for (let y = hy + 2; y <= hy + 5; y++) p.set(xAt(y), y, M.WOOD, y === hy + 2 ? 2 + s : 1 + s);
    // the collar
    p.set(xAt(hy + 6), hy + 6, M.HCOLLAR, 3);
    // the head: 5 across × 3 tall, dark iron (front: its faces at both ends; side: the face toward
    // the facing lit), only its top-left corner catching the light
    const x0 = xAt(hy + 6) - 2;
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 5; dx++) {
        let sh = dy === 0 ? 2 : dy === 2 ? 0 : 1;
        if (dx === 0) sh += 1;
        if (dx === 4) sh = Math.max(0, sh - 1);
        if (dx === 0 && dy === 0) sh = 3;
        p.set(x0 + dx, hy + 7 + dy, M.METAL, Math.max(0, sh + (near ? 1 : 0) - 1 + (dy === 0 && dx < 2 ? 1 : 0)));
      }
    }
    p.end();
  }

  /** The hammer at rest in the plain front / back views: in the right hand (screen left in front). */
  function hammerFront(p, c, back, handY) {
    const r = c.rig;
    const wx = back ? r.cx + r.half : r.cx - r.half - 2;
    hammerHanging(p, wx, handY(back ? 1 : 0), false, true);
  }

  /**
   * A hood's fur rim (spec `hoodTrim`: its colour, EVERMERE_CAMPAIGN.md §5.3 — Corin's fox-red hood
   * with a cream fur rim): the hood's texels round the face opening (front, side) — or along its
   * bottom edge, on the shoulders (back) — in the rim's colour, tufted (the shades alternate), lit on
   * the left. Drawn over the hood's own texels: the hood keeps its silhouette.
   * @param {Painter} p @param {number} hx @param {number} hy @param {'down'|'up'|'side'} view
   */
  function hoodTrim(p, hx, hy, view) {
    const t = pk.HATS.hood[view];
    const rows = t.rows;
    const at = (r, k) => (r >= 0 && r < rows.length && k >= 0 && k < rows[r].length ? rows[r][k] : '.');
    const lastRow = rows.length - 1;
    p.begin(null);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const first = row.search(/[^.]/);
      const last = row.length - 1 - [...row].reverse().join('').search(/[^.]/);
      for (let k = 0; k < row.length; k++) {
        if (row[k] === '.') continue;
        let rim = false;
        if (view === 'up') rim = r === lastRow || at(r + 1, k) === '.';
        else if (view === 'side' && r >= 5 && at(r, k - 1) === '.') rim = true;
        else if (r >= 5) {
          // a texel bordering the opening: a '.' beside it inside the hood's span, or under it
          for (const [dr, dk] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const rr = r + dr, kk = k + dk;
            if (at(rr, kk) !== '.') continue;
            const span = rows[rr] ?? '';
            const f = span.search(/[^.]/);
            const l = span.length - 1 - [...span].reverse().join('').search(/[^.]/);
            if (f >= 0 && kk > f && kk < l && rr >= 5 && rr < lastRow) { rim = true; break; }
          }
        }
        // (and the hood's lower edge, on the chest: a fur collar)
        if (!rim && view !== 'up' && r === lastRow && (view === 'down' || k < first + 4)) rim = true;
        if (!rim) continue;
        const lit = k <= (first + last) / 2;
        // tufted: the shades alternate, a soft cream (never white)
        const sh = (k + r) % 2 ? (lit ? 3 : 2) : (lit ? 2 : 1);
        p.set(hx + t.ox + k, hy + t.oy + r, M.TRIM, sh);
        // a ruff: thicker down the sides of the face (one texel more, outward)
        if (view === 'down' && r >= 8 && r < lastRow) {
          const out = lit ? k - 1 : k + 1;
          if (at(r, out) !== '.') p.set(hx + t.ox + out, hy + t.oy + r, M.TRIM, Math.max(0, sh - 1));
        }
      }
    }
    p.end();
  }

  /**
   * The bell-founder's hammer's overrides (EVERMERE_CAMPAIGN.md §6.5): both hands on the long haft and
   * the head raised high overhead in `cast` (the slam's wind-up, Toll's stroke, Carillon), driven down
   * before her in `thrust` (the slam; side: forward and down onto the ground). Acts without an entry
   * keep ACTS' arms (the hammer swung where the sword is).
   */
  const HAMMER_ACTS = {
    cast: {
      side: { lean: [1, 0], w: { h: [3, -6], l: 'behind', d: [0.45, -1] }, o: { h: [1, -4], l: 'under' }, legs: 'stance' },
      down: { w: { h: [-3, -6], d: [-0.25, -1] }, o: { h: [3, -4] }, legs: { spread: 1 } },
      up: { w: { h: [3, -6], d: [0.25, -1] }, o: { h: [-3, -4] }, legs: { spread: 1 } },
    },
    thrust: {
      side: { lean: [-2, 1], w: { h: [-5, 4], l: 'under', d: [-1, 0.55] }, o: { h: [-3, 4], l: 'under' }, legs: 'lunge' },
      down: { w: { h: [3, 5], d: [0.1, 1] }, o: { h: [-2, 5] }, legs: { spread: 1, lifts: [0, 1] } },
      up: { w: { h: [-1, 1], d: [0, -1] }, o: { h: [1, 2] }, legs: { spread: 1, lifts: [1, 0] } },
    },
  };

  /**
   * The bell-founder's hammer held at the grip (≤ 8 px): the butt behind the fist, a leather grip, the
   * long haft, the bronze collar (`M.HCOLLAR`: glow texels with `gear.hammerGlow`), and the heavy
   * square head across the end — four texels wide, two deep, lit on the near side and the upper left.
   */
  function hammerDrawn(p, gx, gy, d, near) {
    const [ux, uy] = d;
    const px = -uy, py = ux;
    p.begin('all', 0);
    const at = (t, o = 0) => [Math.round(gx + ux * t + px * o - 0.5), Math.round(gy + uy * t + py * o - 0.5)];
    const put = (xy, m, sh) => { if (inFrame(xy[0], xy[1])) p.set(xy[0], xy[1], m, Math.max(0, sh)); };
    put(at(-1.0), M.WOOD, 1);
    put(at(0.6), M.LEATHER, 2);
    put(at(1.6), M.WOOD, near ? 3 : 2);
    put(at(2.6), M.WOOD, near ? 2 : 1);
    put(at(3.5), M.WOOD, near ? 2 : 1);
    put(at(4.4), M.HCOLLAR, 3);
    // the head: five across the haft's end and three deep, dark iron; the side toward the upper left
    // and its leading face catch the light
    const lit = (o) => (px * o * -1 + py * o * -1 > 0);
    for (const o of [-2, -1, 0, 1, 2]) {
      const edge = Math.abs(o) === 2;
      put(at(5.3, o), M.METAL, (lit(o) ? 3 : 1) + (edge ? 0 : 0) - (near ? 0 : 1));
      put(at(6.2, o), M.METAL, (lit(o) ? 2 : 1) - (near ? 0 : 1));
      if (!edge) put(at(7.0, o), M.METAL, (lit(o) ? 3 : 2) - (near ? 0 : 1));
    }
    p.end();
  }

  return { HATS, HAT_COLORS, ramps, CRESTS, CREST_EDGE_PLAIN, hammerHanging, hammerFront, hoodTrim, HAMMER_ACTS, hammerDrawn };
}
