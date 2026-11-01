/**
 * The prop textures of The Bells of Evermere (docs/contracts/EVERMERE_CAMPAIGN.md §6.3): the bells
 * (bronze, the black Hush Bell), the ships' atlas, the ice of the citadel's crags and its snowy top,
 * snow drifts, eave icicles, the shrine's vermilion roof, lacquer and copper patina, the abbey's
 * blue-grey ashlar, the lighthouse's whitewash and red band, the bell-lantern's glass, the forge's
 * loam and the bellows' leather, the town belfry's stopped clock dial. Registered by the season kit
 * (src/engine/world/SeasonKitParts.js `registerTextureSet(evermerePropTextures,
 * EVERMERE_PROP_TEXTURE_NAMES)`), so a level without the kit paints none of them. Owner: the
 * architecture package; its builders (src/engine/world/props/Belfry.js, Ships.js, Monuments.js,
 * Smithy.js, House.js icicles, Crags.js ice) are the only users — no level legend names them.
 *
 * Layouts (canvas row 0 = texture v 1):
 *  - `bell_bronze`, `bell_black` (32²): one bell's skin from the crown (row 0) to the lip (row 31),
 *    tiling around (u); mapped onto the bell's lathe with v = the profile's length / its total (a
 *    decal, like the door). The black bell's frost veins and lip glow faintly (emissive mask).
 *  - `ship_atlas` (64 × 128 = 4 × 8 u): eight bands 16 px (1 u) tall, each tiling along u — 0 the
 *    hull's clinker strakes, 1 the tarred lower hull with its weed line, 2 the wale (a navy and ochre
 *    stripe under a cap rail), 3 the deck planks, 4 spar wood, 5 rope (and iron), 6 sailcloth, 7 the
 *    name board (its left 32 px; illegible carved marks, no words) and a red-striped cloth (right).
 *    Ships.js maps every face into its band (`SHIP_BANDS`), ≤ 1 u of v per strip.
 *  - `ice_crag` (64² = 4 × 4 u): painted ice — vertical fracture planes (4–13 px) of deep teal →
 *    pale cyan, most with a lit left rim, all with a dark right edge, soft diagonal internal light
 *    streaks, a broad cloud; emissive ≈ 0.15 over the ice and three heart veins full (the spectacle
 *    notes §7: painted ice reads better in pixel art than shader ice).
 *  - `ice_crag_top` (32²): ice dusted with snow; `snow_drift` (32²): wind-rippled snow.
 *  - `icicles` (32 × 16, alpha): an eave's frozen drip line (rows 0–1) and icicles hanging from it.
 *  - `roof_vermilion` (32², a roof: its name starts with `roof_`, so the snow cover takes it).
 *  - `lacquer_red`, `copper_patina`, `leather` (16²); `abbey_stone`, `lighthouse_wall`,
 *    `lighthouse_band`, `loam` (32², masonry rows of 8 px like `stone_brick`).
 *  - `bell_lantern` (16², emissive): a lantern pane, warm flame light behind leaded glass.
 *  - `clock_dial` (32²): a cream enamel dial with twelve marks (no numerals) and a dark rim.
 *
 * @import { TextureKit, TexDef } from '../Textures.js'
 */

/** Every name of the set (the registration checks the set against it). */
export const EVERMERE_PROP_TEXTURE_NAMES = Object.freeze([
  'bell_bronze', 'bell_black', 'ship_atlas', 'ice_crag', 'ice_crag_top', 'snow_drift', 'icicles',
  'roof_vermilion', 'lacquer_red', 'copper_patina', 'abbey_stone', 'lighthouse_wall', 'lighthouse_band',
  'bell_lantern', 'loam', 'leather', 'clock_dial',
]);

/** The ship atlas's bands (row index; each 16 px = 1 u tall, 64 px = 4 u wide). */
export const SHIP_BANDS = Object.freeze({ hull: 0, lower: 1, wale: 2, deck: 3, spar: 4, rope: 5, sail: 6, board: 7 });

const mod = (a, n) => ((a % n) + n) % n;

// the contract's ramps (EVERMERE_CAMPAIGN.md §6.2, the spectacle notes §4), dark → light
const BRONZE = ['#160e0a', '#2e1c12', '#4e321a', '#734c22', '#9a6a2e', '#c08e42', '#e0b664', '#f6dc98'];
const PATINA = ['#16302c', '#245448', '#3a7e6c', '#4f9c8a', '#7cc4ae', '#acdcc8'];
const IRON = ['#05050a', '#0d0d14', '#151826', '#20263a', '#2e374e', '#435068'];
const RIM = ['#1e4a66', '#3a86a8', '#5fd0e8', '#a8ecf8'];
const ICE = ['#0a1a2c', '#0e2236', '#163a56', '#1c4a68', '#2a6a8c', '#3a86a8', '#62b0cc', '#8fd6ea', '#c8f0f8', '#e2fbff'];
const SNOW = ['#3e4878', '#4b5788', '#647aa6', '#7d8fbe', '#9aaccc', '#b4c4dc', '#cad7e8', '#dfe8f4', '#eef3fa', '#f8fbff'];
const VERMILION = ['#3e100c', '#6a1c14', '#96281a', '#c03822', '#d2452c', '#e8704a', '#f6a07a'];
const LACQUER = ['#2a0c0a', '#5a1810', '#8e2618', '#b8341e', '#d2452c', '#e8644a', '#f49070'];
const ABBEY = ['#262a38', '#3a3e50', '#4e566c', '#68728a', '#8a94aa', '#a8b2c4', '#c4ccd8'];
const WHITEWASH = ['#5e5a58', '#88827a', '#aea698', '#cac0ae', '#dcd4c2', '#e6dece', '#ece4d4'];
const RED_BAND = ['#2e0c0a', '#521410', '#7a1e18', '#a02a22', '#b8322a', '#cc4a3c', '#dc6e5c'];
const HULL = ['#120c0a', '#1e1510', '#2e2018', '#3e2c1e', '#523a26', '#6a4c30', '#86623e', '#a07a50'];
const TAR = ['#0a0808', '#141010', '#1e1a16', '#2a241c', '#363024'];
const DECK = ['#2a1e14', '#43301f', '#5c4228', '#7a5a36', '#987448', '#b4905e', '#ccac7a'];
const SPAR = ['#2a1c12', '#4a321e', '#6a4a2c', '#8a663c', '#a8824e', '#c4a068'];
const ROPE = ['#2e2014', '#4e3820', '#705230', '#927046', '#b08e5e', '#ccae7c'];
const CANVAS = ['#4a4236', '#6e6452', '#948a72', '#b6aa8c', '#d0c6a6', '#e2d8bc', '#eee6d0'];
const SAIL_RED = ['#3a1410', '#64201a', '#8e3024', '#b04430', '#c4573a'];
const NAVY = ['#0e1222', '#18203e', '#24305a', '#344576'];
const OCHRE = ['#4a3410', '#7a5a1c', '#a87a2a', '#d0a040'];
const BOARD = ['#160e0a', '#2a1c12', '#3e2c1c', '#58402a', '#74583a'];
const LOAM = ['#241812', '#3a2a1e', '#523c2a', '#6c5038', '#8a6a4a', '#a68866', '#c0a684'];
const LEATHER = ['#160c08', '#2a1810', '#43261a', '#5e3622', '#7a4a2e', '#966240'];
const COPPER = ['#14302c', '#1f4a42', '#2e6a5c', '#4f9c8a', '#72bca8', '#a2dcc6'];
const GLASS = ['#5a2a0c', '#8a4614', '#c06e20', '#e8962e', '#f8bc4a', '#ffdc84', '#fff4cc'];
const DIAL = ['#2a2420', '#5a4e40', '#9a8c74', '#c8bca0', '#e0d6bc', '#eee6d0'];

/**
 * @param {TextureKit} K
 * @returns {Record<string, TexDef>}
 */
export function evermerePropTextures(K) {
  const { clamp, hash2, field, mixColor } = K;
  /** Ramp lookup, clamped. @param {string[]} R @param {number} i */
  const ri = (R, i) => R[i < 0 ? 0 : i >= R.length ? R.length - 1 : i | 0];
  /** A grey emissive-mask value. @param {number} v 0–1 */
  const em = (v) => { const g = Math.round(clamp(v, 0, 1) * 255); return [g, g, g, 255]; };

  /**
   * A bell's skin, crown (row 0) to lip (row 31): metal ramp with vertical streaks, raised bands
   * at the shoulder, the waist and the sound bow, a bright worn lip. `streak` paints the weather
   * running down from the shoulder (patina on bronze, frost on iron).
   */
  const bellSkin = (s, ctx, { R, streakRamp, rim = null, glow = false, density = 0.2 }) => {
    const { w, h } = s;
    const { seed } = ctx;
    const N = field(w, h, 4, 2, seed + 3, { oct: 3 });
    // thin weather streaks: single columns (never two side by side), each its own length
    const streak = new Float32Array(w);
    for (let x = 0; x < w; x++) streak[x] = hash2(x, 0, seed + 9) < density && !(x > 0 && streak[x - 1]) ? 6 + Math.floor(hash2(x, 1, seed + 9) * 16) : 0;
    const bands = new Map([[5, 2], [6, 1], [7, 2], [17, 1], [24, 2], [25, 1], [26, 2]]);
    const E = glow ? s.emissive() : null;
    s.each((x, y, i) => {
      // the bell's own light: a rounder form reads brighter toward the shoulder, darker at the waist
      const form = y < 4 ? 0.9 : y < 10 ? 1.1 : y < 22 ? 0.85 : y < 28 ? 1.0 : 1.2;
      let k = Math.round(2.5 + form * 2.2 + (N[i] - 0.5) * 1.6);
      const b = bands.get(y);
      let hh = 0.4;
      if (b === 2) { k += 2; hh = 0.75; }
      else if (b === 1) { k -= 1; hh = 0.55; }
      if (y >= 30) { k += y === 31 ? 1 : 2; hh = 0.5; }
      s.set(x, y, ri(R, k));
      s.hf[i] = hh + (N[i] - 0.5) * 0.08;
      // the running ornament between the shoulder's two raised lines: a bead every 4 px
      if (y === 6 && mod(x, 4) === 1) { s.set(x, y, ri(R, k + 3)); s.hf[i] = 0.85; }
      // weather streaks running down from under the shoulder band
      const len = streak[x];
      if (streakRamp && len && y > 7 && y < 8 + len && y < 29 && hash2(x, y >> 1, seed + 10) < 0.9) {
        const t = (y - 8) / len;
        s.set(x, y, mixColor(s.get(x, y), ri(streakRamp, Math.round((1 - t) * (streakRamp.length - 2)) + (b ? 1 : 0)), 0.62 - t * 0.4));
        if (E && t < 0.7) E.set(x, y, em(0.18 * (1 - t)));
      }
      if (E && y >= 30) E.set(x, y, em(y === 30 ? 0.3 : 0.18));
    });
    if (rim) for (let x = 0; x < w; x++) { s.set(x, 29, ri(rim, 2 + (hash2(x, 29, seed) < 0.3 ? 1 : 0))); if (E) E.set(x, 29, em(0.45)); }
    return { normal: 1.6 };
  };

  /** Masonry repainted on a ramp (K.genStoneBrick's blocks and normals). */
  const masonry = (R) => K.gradientMap(K.genStoneBrick, R);

  /**
   * The ship atlas: eight 16 px bands, each tiling along u.
   * @type {TexDef['gen']}
   */
  const shipAtlas = (s, ctx) => {
    const { w } = s;
    const { seed, rng } = ctx;
    const N = field(w, 128, 8, 16, seed + 1, { oct: 3 });
    const grain = (x, y, period) => hash2(x >> 2, Math.floor(y / period), seed + 2);
    s.each((x, y, i) => {
      const band = y >> 4;
      const v = y & 15;
      let c;
      let hh = 0.5;
      switch (band) {
        case 0: case 1: {
          // clinker strakes 4 px: a lit lapped edge on top, shadow under it, plank butts
          const r = v & 3;
          const plank = (y >> 2) * 7 + Math.floor((x + ((y >> 2) * 23)) / 24);
          let k = 3 + (hash2(plank, 1, seed) < 0.3 ? -1 : hash2(plank, 2, seed) < 0.25 ? 1 : 0);
          if (r === 0) k += 2; else if (r === 3) k -= 2;
          if (mod(x + (y >> 2) * 23, 24) === 0) k -= 2; // a butt joint
          if (N[i] > 0.9) k += 1; else if (N[i] < 0.08) k -= 1;
          const R = band === 0 ? HULL : TAR;
          c = ri(R, band === 0 ? k + 1 : k - 1);
          // the lower hull: a pale weed and salt line near its top, barnacle specks
          if (band === 1 && v <= 1) c = mixColor(c, v === 0 ? '#5e6a4a' : '#3e4a36', 0.7);
          if (band === 1 && v > 3 && hash2(x, y, seed + 4) < 0.012) c = '#6e6e62';
          hh = r === 0 ? 0.8 : r === 3 ? 0.2 : 0.5;
          break;
        }
        case 2: {
          // wale: cap rail (rows 0–3), navy stripe (4–8), an ochre line (9–10), planks below
          if (v <= 3) { c = ri(SPAR, v === 0 ? 5 : v === 3 ? 1 : 3 + (N[i] > 0.7 ? 1 : 0)); hh = 0.9; }
          else if (v <= 8) { c = ri(NAVY, v === 4 ? 3 : v === 8 ? 0 : 2 - (N[i] < 0.2 ? 1 : 0)); hh = 0.6; }
          else if (v <= 10) { c = ri(OCHRE, v === 9 ? 3 : 1); hh = 0.65; }
          else { const r = (v - 11) & 3; c = ri(HULL, 4 + (r === 0 ? 2 : r === 3 ? -2 : 0)); hh = r === 0 ? 0.8 : 0.4; }
          break;
        }
        case 3: {
          // deck planks running along u, 4 px wide, caulked seams, a treenail now and then
          const r = v & 3;
          const plank = (v >> 2) * 5 + Math.floor((x + (v >> 2) * 17) / 32);
          let k = 3 + (hash2(plank, 3, seed) < 0.3 ? 1 : hash2(plank, 4, seed) < 0.25 ? -1 : 0);
          if (r === 3) k = 0;
          else if (r === 0) k += 1;
          if (grain(x, y, 1) < 0.2 && r !== 3) k -= 1;
          if (mod(x + (v >> 2) * 17, 32) === 0) k = 1;
          c = ri(DECK, k);
          hh = r === 3 ? 0.1 : 0.55;
          break;
        }
        case 4: {
          // spar wood: grain along u, a lit upper edge, a dark lower one (rows wrap round a spar)
          let k = 2 + Math.round(Math.sin((v / 16) * Math.PI) * 2);
          if (hash2(x >> 3, v, seed + 6) < 0.15) k -= 1;
          c = ri(SPAR, k);
          hh = 0.5 + Math.sin((v / 16) * Math.PI) * 0.3;
          break;
        }
        case 5: {
          // rope: a twisted strand (diagonal lay every 3 px) over rows 0–7; iron below (8–15)
          if (v < 8) {
            const lay = mod(x + v, 3);
            c = ri(ROPE, lay === 0 ? 4 : lay === 1 ? 3 : 1);
            hh = lay === 0 ? 0.8 : 0.4;
          } else {
            c = ri(IRON, 3 + (v === 8 ? 2 : v === 15 ? -2 : 0) + (hash2(x, v, seed + 7) < 0.15 ? 1 : 0));
            hh = 0.6;
          }
          break;
        }
        case 6: {
          // sailcloth: vertical cloths 12 px wide (a seam and its shadow), soft weave, weathering
          const sx = mod(x, 12);
          let k = 4 + (N[i] > 0.75 ? 1 : N[i] < 0.2 ? -1 : 0);
          if (sx === 0) k -= 2; else if (sx === 1) k += 1;
          if (((x + v) & 1) === 0 && hash2(x, v, seed + 8) < 0.2) k -= 1;
          c = ri(CANVAS, k);
          hh = sx === 0 ? 0.3 : 0.55;
          break;
        }
        default: {
          // the name board (x < 32): a dark board, a carved line of marks (no letters), gilt edges;
          // a red-striped cloth (x ≥ 32)
          if (x < 32) {
            const edge = v <= 1 || v >= 14 || x <= 1 || x >= 30;
            let k = edge ? (v <= 1 || x <= 1 ? 4 : 0) : 2 + (N[i] > 0.8 ? 1 : 0);
            c = ri(BOARD, k);
            if (!edge && v >= 5 && v <= 10 && x >= 4 && x <= 27) {
              const g = Math.floor((x - 4) / 4);
              const gx = (x - 4) & 3;
              const pat = hash2(g, v >> 1, seed + 11) < 0.55;
              if (gx < 3 && pat && g !== 3) c = ri(OCHRE, v === 5 ? 3 : 2);
            }
            if (v === 2 || v === 13) c = ri(OCHRE, 2);
            hh = edge ? 0.8 : 0.5;
          } else {
            const sx = mod(x, 12);
            const red = sx >= 6;
            let k = red ? 3 : 4;
            if (sx === 0) k -= 2;
            if (N[i] > 0.8) k += 1;
            c = red ? ri(SAIL_RED, k) : ri(CANVAS, k);
            hh = sx === 0 ? 0.3 : 0.55;
          }
        }
      }
      s.set(x, y, c);
      s.hf[i] = hh;
    });
    // a few iron nails on the wale and patches of a darker cloth on the sail
    for (let k = 0; k < 10; k++) s.set(rng.int(0, w - 1), 32 + 12 + rng.int(0, 3), ri(IRON, 4));
    for (let k = 0; k < 3; k++) {
      const px = rng.int(0, w - 8), py = 96 + rng.int(2, 9);
      for (let yy = 0; yy < 5; yy++) for (let xx = 0; xx < 6; xx++) s.set(px + xx, py + yy, mixColor(s.get(px + xx, py + yy), CANVAS[2], 0.45));
    }
    return { normal: 1.8 };
  };

  /**
   * Painted ice: vertical fracture planes (each its own depth of teal, a lit left rim, a dark right
   * edge, a gradient toward pale cyan at its top), diagonal light streaks inside them, rare heart
   * veins; emissive ≈ 0.15 over the ice, the veins full.
   * @type {TexDef['gen']}
   */
  const iceCliff = (s, ctx) => {
    const { w, h } = s;
    const { rng, seed } = ctx;
    const E = s.emissive();
    // planes: column spans 4–13 px, each with its own depth, offset and lean; a lit left rim on
    // most, a dark right edge on all
    const planeOf = new Int32Array(w);
    const planes = [];
    let x0 = 0;
    while (x0 < w) {
      let pw = rng.int(4, 13);
      if (w - x0 - pw < 4) pw = w - x0;
      planes.push({ x0, w: pw, base: rng.pick([3, 4, 4, 5, 5, 5, 6, 6]), off: rng.int(0, h - 1), rim: rng.chance(0.7), streak: rng.int(0, 40), streaky: rng.chance(0.6) });
      for (let k = 0; k < pw; k++) planeOf[x0 + k] = planes.length - 1;
      x0 += pw;
    }
    const N = field(w, h, 4, 6, seed + 2, { oct: 3 });
    const B = field(w, h, 2, 3, seed + 5, { oct: 2 });
    s.each((x, y, i) => {
      const p = planes[planeOf[x]];
      const u = x - p.x0;
      const vy = mod(y + p.off, h) / h;
      // a pale top, a deep foot (per plane, offset so planes do not band together), broad cloud
      let k = p.base + Math.round((0.5 - vy) * 2.4 + (B[i] - 0.5) * 2.2) + (N[i] > 0.88 ? 1 : N[i] < 0.1 ? -1 : 0);
      if (u === 0 && p.rim) k = Math.max(k + 3, 8);
      else if (u === p.w - 1) k -= 2;
      // soft diagonal light streaks inside the ice (down-right)
      const d = mod(x * 2 - y + p.streak, 19);
      if (p.streaky && u > 0 && u < p.w - 1 && d === 0) k += 2;
      s.set(x, y, ri(ICE, k));
      s.hf[i] = 0.45 + (u === 0 ? 0.3 : u === p.w - 1 ? -0.25 : 0) + (N[i] - 0.5) * 0.12;
      E.set(x, y, em(0.15));
    });
    // heart veins: a few thin bright cyan threads wandering down
    for (let v = 0; v < 3; v++) {
      let x = rng.int(0, w - 1);
      for (let y = rng.int(0, h - 1), n = 0; n < h * 0.5; n++, y++) {
        s.set(x, y, ri(ICE, 9));
        E.set(x, y, em(1));
        if (hash2(x, y, seed + 20 + v) < 0.35) x += hash2(x, y, seed + 30) < 0.5 ? -1 : 1;
      }
    }
    return { normal: 2 };
  };

  /** Ice dusted with snow (the citadel's ledges and tops). @type {TexDef['gen']} */
  const iceTop = (s, ctx) => {
    const { w, h } = s;
    const { seed } = ctx;
    const A = field(w, h, 3, 3, seed + 1, { oct: 3 });
    const B = field(w, h, 6, 6, seed + 2, { oct: 2 });
    s.each((x, y, i) => {
      const snow = A[i] > 0.45;
      const edge = snow && A[i] < 0.52;
      let c;
      if (snow) {
        const k = 6 + (B[i] > 0.7 ? 1 : B[i] < 0.25 ? -1 : 0) + (edge ? -2 : 0);
        c = ri(SNOW, k);
        if (hash2(x, y, seed + 5) < 0.02) c = SNOW[9];
        s.hf[i] = 0.7 + (A[i] - 0.45) * 0.4;
      } else {
        const k = 5 + (B[i] > 0.75 ? 2 : B[i] < 0.2 ? -1 : 0);
        c = ri(ICE, k);
        s.hf[i] = 0.4;
      }
      s.set(x, y, c);
    });
    // a crack or two through the bare ice
    const { rng } = ctx;
    for (let k = 0; k < 3; k++) {
      let x = rng.int(0, w - 1), y = rng.int(0, h - 1);
      for (let n = 0; n < 10; n++) {
        if (A[s.ix(x, y)] <= 0.45) { s.set(x, y, ICE[2]); s.setH(x, y, 0.2); }
        x += rng.int(-1, 1); y += 1;
      }
    }
    return { normal: 1.6 };
  };

  /** Wind-rippled snow. @type {TexDef['gen']} */
  const snowDrift = (s, ctx) => {
    const { w, h } = s;
    const { seed } = ctx;
    const A = field(w, h, 2, 4, seed + 1, { oct: 3 });
    s.each((x, y, i) => {
      // soft ripples running diagonally, shaded on their lee side
      const r = Math.sin((x * 0.35 + y * 0.9 + A[i] * 6) * 1.1);
      let k = 7 + (r > 0.75 ? 1 : r < -0.6 ? -1 : 0) + (A[i] < 0.12 ? -1 : 0);
      let c = ri(SNOW, k);
      if (hash2(x, y, seed + 3) < 0.015) c = SNOW[9];
      s.set(x, y, c);
      s.hf[i] = 0.5 + r * 0.12;
    });
    return { normal: 1.2 };
  };

  /** An eave's frozen drip line and the icicles hanging from it (alpha). @type {TexDef['gen']} */
  const icicles = (s, ctx) => {
    const { w, h } = s;
    const { rng } = ctx;
    // the crust: rows 0–1 everywhere
    for (let x = 0; x < w; x++) {
      s.set(x, 0, ri(ICE, 8));
      s.set(x, 1, ri(ICE, x % 5 === 0 ? 6 : 7));
      s.setH(x, 0, 0.8); s.setH(x, 1, 0.6);
    }
    let x = rng.int(0, 2);
    while (x < w) {
      const iw = rng.chance(0.3) ? 3 : rng.chance(0.6) ? 2 : 1;
      const len = rng.chance(0.25) ? rng.int(10, 15) : rng.int(3, 9);
      for (let y = 2; y < 2 + len && y < h; y++) {
        const t = (y - 2) / len;
        const cw = Math.max(1, Math.round(iw * (1 - t * 0.8)));
        for (let u = 0; u < cw; u++) {
          const k = u === 0 ? 9 : u === cw - 1 && cw > 1 ? 5 : 7;
          s.set(x + u, y, ri(ICE, t > 0.85 ? k - 1 : k));
          s.setH(x + u, y, 0.8 - u * 0.2);
        }
      }
      x += iw + rng.int(1, 3);
    }
    return { normal: 1.2, wrap: false };
  };

  /** Vermilion lacquer over wood: the grain along v, worn spots, black-lacquered ends. @type {TexDef['gen']} */
  const lacquer = (s, ctx) => {
    const { seed } = ctx;
    s.each((x, y, i) => {
      let k = 4 + (hash2(x, y >> 2, seed) < 0.2 ? -1 : 0) + (x === 0 ? 1 : x === 15 ? -1 : 0);
      if (hash2(x >> 1, y >> 1, seed + 3) < 0.04) k = 1; // worn through to the wood
      s.set(x, y, ri(LACQUER, k));
      s.hf[i] = 0.5 + (x === 0 ? 0.2 : 0);
    });
    return { normal: 1 };
  };

  /** Copper patina: verdigris with darker runs. @type {TexDef['gen']} */
  const patina = (s, ctx) => {
    const { w, h } = s;
    const { seed } = ctx;
    const N = field(w, h, 2, 2, seed + 1, { oct: 3 });
    s.each((x, y, i) => {
      let k = 3 + (N[i] > 0.75 ? 1 : N[i] < 0.25 ? -1 : 0);
      if (hash2(x, 0, seed + 2) < 0.2 && hash2(x, y >> 2, seed + 3) < 0.7) k -= 1;
      s.set(x, y, ri(COPPER, k));
      s.hf[i] = 0.5 + (N[i] - 0.5) * 0.2;
    });
    return { normal: 1.2 };
  };

  /** Leather with folds (the bellows' pleats run along u). @type {TexDef['gen']} */
  const leather = (s, ctx) => {
    const { seed } = ctx;
    s.each((x, y, i) => {
      const r = y & 3;
      let k = r === 0 ? 4 : r === 3 ? 1 : 3;
      if (hash2(x, y, seed) < 0.08) k -= 1;
      s.set(x, y, ri(LEATHER, k));
      s.hf[i] = r === 0 ? 0.8 : r === 3 ? 0.2 : 0.5;
    });
    return { normal: 1.6 };
  };

  /** A lantern pane: an iron frame and leaded glass lit warm from inside (emissive). @type {TexDef['gen']} */
  const lanternPane = (s) => {
    const E = s.emissive();
    s.each((x, y, i) => {
      const frame = x <= 1 || x >= 14 || y <= 1 || y >= 14;
      const came = x === 7 || y === 8;
      if (frame || came) {
        let k = 2;
        if (x === 0 || y === 0) k = 4;
        if (x === 15 || y === 15) k = 1;
        s.set(x, y, ri(IRON, k));
        s.hf[i] = 1;
        E.set(x, y, '#000000');
        return;
      }
      const d = Math.hypot((x + 0.5 - 8) / 6, (y + 0.5 - 9) / 6.5);
      const k = d < 0.3 ? 6 : d < 0.5 ? 5 : d < 0.72 ? 4 : d < 0.95 ? 3 : 2;
      s.set(x, y, ri(GLASS, k));
      s.hf[i] = 0.3;
      E.set(x, y, em(clamp(1.08 - d * 0.5, 0.45, 1)));
    });
    return { normal: 1.2 };
  };

  /** The clock dial: cream enamel, twelve marks, a dark rim (a disc in a square). @type {TexDef['gen']} */
  const dial = (s) => {
    s.each((x, y, i) => {
      const dx = x + 0.5 - 16;
      const dy = y + 0.5 - 16;
      const r = Math.hypot(dx, dy);
      let c;
      if (r > 14.5) c = ri(DIAL, 0);
      else if (r > 13.2) c = ri(DIAL, r > 14 ? 1 : 2);
      else c = ri(DIAL, 4 + (dx < 0 && dy < 0 && r < 9 ? 1 : 0));
      s.set(x, y, c);
      s.hf[i] = r > 13.2 ? 0.8 : 0.5;
    });
    // the twelve marks (the quarters bold)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const bold = k % 3 === 0;
      for (let t = bold ? 9 : 10.5; t <= 12.5; t += 0.5) {
        const px = Math.floor(16 + Math.sin(a) * t);
        const py = Math.floor(16 - Math.cos(a) * t);
        s.set(px, py, ri(DIAL, 0));
        if (bold) s.set(px + (Math.abs(Math.cos(a)) > 0.5 ? 1 : 0), py + (Math.abs(Math.sin(a)) > 0.5 ? 1 : 0), ri(DIAL, 0));
      }
    }
    for (const [x, y] of [[15, 15], [16, 15], [15, 16], [16, 16]]) s.set(x, y, ri(DIAL, 1));
    return { normal: 1 };
  };

  return {
    bell_bronze: { px: [32, 32], gen: (s, c) => bellSkin(s, c, { R: BRONZE, streakRamp: PATINA, density: 0.24 }), normalScale: 0.6 },
    bell_black: { px: [32, 32], gen: (s, c) => bellSkin(s, c, { R: IRON, streakRamp: RIM, rim: RIM, glow: true, density: 0.12 }), normalScale: 0.6, emissive: true },
    ship_atlas: { px: [64, 128], gen: shipAtlas, normalScale: 0.6 },
    ice_crag: { px: [64, 64], gen: iceCliff, normalScale: 0.6, emissive: true },
    ice_crag_top: { px: [32, 32], gen: iceTop, normalScale: 0.45 },
    snow_drift: { px: [32, 32], gen: snowDrift, normalScale: 0.4 },
    icicles: { px: [32, 16], gen: icicles, normalScale: 0.5, alpha: true },
    roof_vermilion: { px: [32, 32], gen: (s, c) => K.genClayRoof(s, c, VERMILION.slice(1)), normalScale: 0.7 },
    lacquer_red: { px: [16, 16], gen: lacquer, normalScale: 0.4 },
    copper_patina: { px: [16, 16], gen: patina, normalScale: 0.5 },
    abbey_stone: { px: [32, 32], gen: masonry(ABBEY), normalScale: 0.6 },
    lighthouse_wall: { px: [32, 32], gen: masonry(WHITEWASH), normalScale: 0.5 },
    lighthouse_band: { px: [32, 32], gen: masonry(RED_BAND), normalScale: 0.5 },
    bell_lantern: { px: [16, 16], gen: lanternPane, normalScale: 0.5, emissive: true },
    loam: { px: [32, 32], gen: K.gradientMap((s, c) => K.genDirt(s, c, { base: 3, cracks: 6 }), LOAM), normalScale: 0.5 },
    leather: { px: [16, 16], gen: leather, normalScale: 0.6 },
    clock_dial: { px: [32, 32], gen: dial, normalScale: 0.3 },
  };
}
