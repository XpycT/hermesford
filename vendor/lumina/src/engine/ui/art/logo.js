/**
 * The title logo (docs/specs/PIXEL_UI.md §2), ported from mockup G's art: A's hand-drawn Roman
 * capitals (11 rows), scaled ×3 with Scale3x and gilded in bands with lit and shaded edges, a
 * bronze inner line, an ink outline and a hard drop shadow; `textLogo` draws another script (the
 * name in Japanese or Chinese) from a font and gilds it the same way.
 *
 * Any level's or campaign's title: `LETTERS` is G's alphabet (the letters of CINDERWATCH PASS)
 * completed in the same hand — A–Z, 0–9 and the punctuation of titles (' " - – — . , : ; ! ? & · …
 * ( ) / +) —, lower case drawn as capitals, accented capitals as the capital with its mark drawn in
 * bits (É Ñ Ü Å Ç …). A title with any other character is drawn whole from Jersey 10 instead
 * (`LOGO_FALLBACK_FONT`: its 10-px capitals are the Roman capitals' height within one bit, so it
 * scales and gilds like them). `logoFit` fits a title to a width: one line at scale 3, then 2, then
 * two lines (at 2, then 1); `textLogoFit` fits a Japanese or Chinese name the same way (smaller,
 * then two lines broken between words). Owner: B-title (docs/specs/PIXEL_UI.md §8).
 */
import { pal } from './palette.js';
import { scale2x, scale3x } from './gilt.js';
import { art } from './painter.js';

/** The capitals' height in bits (rows 0–10; a glyph's rows past 10 hang below the baseline). */
const CAP = 11;

/**
 * A's Roman capitals and G's additions in the same hand: 11 rows each ('#' ink; thick strokes two
 * bits, thin ones one, slab serifs), a few with rows below the baseline (Q's tail, the comma's).
 * @type {Record<string, string[]>}
 */
export const LETTERS = {
  // G's (A's) letters
  C: ['..######.', '.##....##', '##......#', '##.......', '##.......', '##.......', '##.......', '##.......', '##......#', '.##....##', '..######.'],
  I: ['####', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '.##.', '####'],
  N: ['###....###', '.##.....#.', '.###....#.', '.#.##...#.', '.#.##...#.', '.#..##..#.', '.#...##.#.', '.#...##.#.', '.#....###.', '.#.....##.', '###.....#.'],
  D: ['#######..', '.##...##.', '.##....##', '.##....##', '.##....##', '.##....##', '.##....##', '.##....##', '.##....##', '.##...##.', '#######..'],
  E: ['########', '.##....#', '.##.....', '.##.....', '.##..#..', '.######.', '.##..#..', '.##.....', '.##.....', '.##....#', '########'],
  R: ['#######...', '.##...##..', '.##....##.', '.##....##.', '.##...##..', '.######...', '.##..##...', '.##...##..', '.##...##..', '.##....##.', '####...###'],
  W: ['####...#...####', '.##....##....#.', '..##...###...#.', '..##..#.##..#..', '..##..#.##..#..', '...##.#..##.#..', '...##.#..##.#..', '...##.#..##.#..', '...###...###...', '....##....##...', '....##....##...'],
  A: ['....##....', '....##....', '...#.##...', '...#.##...', '..#...##..', '..#...##..', '..#######.', '.#.....##.', '.#.....##.', '.#......##', '###....###'],
  T: ['##########', '#...##...#', '....##....', '....##....', '....##....', '....##....', '....##....', '....##....', '....##....', '....##....', '...####...'],
  H: ['####..####', '.##....##.', '.##....##.', '.##....##.', '.##....##.', '.########.', '.##....##.', '.##....##.', '.##....##.', '.##....##.', '####..####'],
  P: ['#######..', '.##...##.', '.##....##', '.##....##', '.##...##.', '.######..', '.##......', '.##......', '.##......', '.##......', '####.....'],
  S: ['..####.#', '.##..###', '##....##', '###.....', '.####...', '..#####.', '....####', '......##', '##....##', '###..##.', '#.####..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  // the rest of the alphabet
  B: ['#######..', '.##...##.', '.##....##', '.##....##', '.##...##.', '.######..', '.##...##.', '.##....##', '.##....##', '.##...##.', '#######..'],
  F: ['########', '.##....#', '.##.....', '.##.....', '.##..#..', '.######.', '.##..#..', '.##.....', '.##.....', '.##.....', '####....'],
  G: ['..######.', '.##....##', '##......#', '##.......', '##.......', '##...####', '##.....##', '##.....##', '##.....##', '.##....##', '..######.'],
  J: ['...####', '....##.', '....##.', '....##.', '....##.', '....##.', '....##.', '....##.', '#...##.', '##.##..', '.###...'],
  K: ['####..###', '.##....#.', '.##...#..', '.##..#...', '.##.#....', '.####....', '.##.##...', '.##..##..', '.##..##..', '.##...##.', '####..###'],
  L: ['####....', '.##.....', '.##.....', '.##.....', '.##.....', '.##.....', '.##.....', '.##.....', '.##.....', '.##....#', '########'],
  M: ['###.......###', '.##.......##.', '.###.....###.', '.#.##....###.', '.#.##...#.##.', '.#..##..#.##.', '.#..##.#..##.', '.#...###..##.', '.#...##...##.', '.#....#...##.', '###...#..####'],
  O: ['..######..', '.##....##.', '##......##', '##......##', '##......##', '##......##', '##......##', '##......##', '##......##', '.##....##.', '..######..'],
  Q: ['..######..', '.##....##.', '##......##', '##......##', '##......##', '##......##', '##......##', '##......##', '##......##', '.##....##.', '..######..', '.....##...', '......####'],
  U: ['####..###', '.##....#.', '.##....#.', '.##....#.', '.##....#.', '.##....#.', '.##....#.', '.##....#.', '.##....#.', '..##..#..', '...###...'],
  V: ['####...###', '.##.....#.', '.##.....#.', '..##...#..', '..##...#..', '..##...#..', '...##.#...', '...##.#...', '....###...', '....##....', '....##....'],
  X: ['####..###', '.##....#.', '..##..#..', '..##..#..', '...###...', '....##...', '...#.##..', '...#.##..', '..#...##.', '.#....##.', '###..####'],
  Y: ['####..###', '.##....#.', '..##..#..', '..##..#..', '...####..', '....##...', '....##...', '....##...', '....##...', '....##...', '...####..'],
  Z: ['########', '#.....##', '.....##.', '.....##.', '....##..', '...##...', '..##....', '..##....', '.##.....', '##.....#', '########'],
  // figures (lining, the capitals' height)
  0: ['..####..', '.##..##.', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '.##..##.', '..####..'],
  1: ['..##..', '.###..', '#.##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..', '######'],
  2: ['..####..', '.##..##.', '##....##', '......##', '.....##.', '....##..', '...##...', '..##....', '.##.....', '##.....#', '########'],
  3: ['..####..', '.##..##.', '##....##', '......##', '.....##.', '...###..', '.....##.', '......##', '##....##', '.##..##.', '..####..'],
  4: ['.....##..', '....###..', '...#.##..', '...#.##..', '..#..##..', '.#...##..', '#########', '.....##..', '.....##..', '.....##..', '....####.'],
  5: ['.#######', '.##.....', '.##.....', '.##.###.', '.###..##', '......##', '......##', '......##', '##....##', '.##..##.', '..####..'],
  6: ['...####.', '..##....', '.##.....', '##......', '##.###..', '###..##.', '##....##', '##....##', '##....##', '.##..##.', '..####..'],
  7: ['########', '#.....##', '.....##.', '.....##.', '....##..', '....##..', '...##...', '...##...', '..##....', '..##....', '..##....'],
  8: ['..####..', '.##..##.', '##....##', '##....##', '.##..##.', '..####..', '.##..##.', '##....##', '##....##', '.##..##.', '..####..'],
  9: ['..####..', '.##..##.', '##....##', '##....##', '##....##', '.##..###', '..###.##', '......##', '.....##.', '....##..', '.####...'],
  // punctuation
  "'": ['##', '##', '.#', '#.', '..', '..', '..', '..', '..', '..', '..'],
  '"': ['##.##', '##.##', '.#..#', '#..#.', '.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '.....', '.....', '#####', '#####', '.....', '.....', '.....', '.....'],
  '–': ['........', '........', '........', '........', '........', '########', '########', '........', '........', '........', '........'],
  '—': ['............', '............', '............', '............', '............', '############', '############', '............', '............', '............', '............'],
  '.': ['..', '..', '..', '..', '..', '..', '..', '..', '..', '##', '##'],
  ',': ['..', '..', '..', '..', '..', '..', '..', '..', '..', '##', '##', '.#', '#.'],
  ':': ['..', '..', '..', '##', '##', '..', '..', '..', '..', '##', '##'],
  ';': ['..', '..', '..', '##', '##', '..', '..', '..', '..', '##', '##', '.#', '#.'],
  '!': ['##', '##', '##', '##', '##', '##', '##', '..', '..', '##', '##'],
  '?': ['.#####.', '##...##', '##...##', '.....##', '....##.', '...##..', '...##..', '.......', '.......', '...##..', '...##..'],
  '&': ['..###......', '.##.##.....', '.##.##.....', '.##.##.....', '..###...###', '.####....#.', '##..##..#..', '##...##.#..', '##....###..', '.##....###.', '..####..###'],
  '·': ['..', '..', '..', '..', '..', '##', '##', '..', '..', '..', '..'],
  '…': ['........', '........', '........', '........', '........', '........', '........', '........', '........', '##.##.##', '##.##.##'],
  '(': ['..##', '.##.', '.##.', '##..', '##..', '##..', '##..', '##..', '.##.', '.##.', '..##'],
  ')': ['##..', '.##.', '.##.', '..##', '..##', '..##', '..##', '..##', '.##.', '.##.', '##..'],
  '/': ['.....#', '....##', '....#.', '...##.', '...#..', '..##..', '..#...', '.##...', '.#....', '##....', '#.....'],
  '+': ['........', '........', '...##...', '...##...', '...##...', '########', '########', '...##...', '...##...', '...##...', '........'],
};

/** Characters drawn as another of LETTERS (typographic variants, spaces). */
const SAME = Object.freeze({
  '’': "'", '‘': "'", 'ʼ': "'", '`': "'", '´': "'", '“': '"', '”': '"', '„': '"',
  '‐': '-', '‑': '-', '−': '-', '‒': '–', '―': '—', '‧': '·', '•': '·',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '　': ' ',
});

/**
 * Combining marks drawn over a capital (É, Ñ, Ü …): their rows end one bit over the capital, centred
 * on it.
 * @type {Readonly<Record<string, string[]>>}
 */
const MARKS_ABOVE = Object.freeze({
  '̀': ['##.', '.##'], // grave
  '́': ['.##', '##.'], // acute
  '̂': ['.###.', '##.##'], // circumflex
  '̃': ['.##.#', '#.##.'], // tilde
  '̄': ['#####'], // macron
  '̆': ['#...#', '.###.'], // breve
  '̇': ['##', '##'], // dot
  '̈': ['##.##', '##.##'], // diaeresis
  '̊': ['.#.', '#.#', '.#.'], // ring
  '̋': ['.##.##', '##.##.'], // double acute
  '̌': ['##.##', '.###.'], // caron
});
/** Combining marks drawn under a capital (Ç). @type {Readonly<Record<string, string[]>>} */
const MARKS_BELOW = Object.freeze({
  '̧': ['.##.', '..##', '.##.'], // cedilla
});
/** Rows over the capitals when a mark is there (three for the mark, one apart). */
const ABOVE = 4;

/**
 * The font a title is drawn from when a character has no glyph in LETTERS (a canvas font
 * shorthand): Jersey 10 at its own pixel size (capitals 10 px: one bit each), then the CJK faces and
 * the system's for what Jersey lacks. Jersey 10 is in the Latin font set every language loads.
 */
export const LOGO_FALLBACK_FONT = `400 ${56 / 3}px "Jersey 10", "Noto Sans JP", "Noto Sans SC", sans-serif`;

/** The outline and the drop per scale (G's: 2 and 3 at scale 3, 1 and 1 at scale 1). */
const GILD = Object.freeze({ 3: [2, 3], 2: [2, 2], 1: [1, 1] });

/**
 * One character's cell for the Roman capitals: its glyph and marks.
 * @typedef {{ rows: string[], above: string[]|null, below: string[]|null }} Cell
 */

/**
 * The cells of a text in the Roman capitals (lower case as capitals; an accented letter as its base
 * and mark), or null when a character has no glyph.
 * @param {unknown} text
 * @returns {Cell[]|null}
 */
function cellsOf(text) {
  /** @type {Cell[]} */
  const cells = [];
  for (const ch0 of String(text ?? '').normalize('NFC')) {
    for (const ch of ch0.toUpperCase()) { // ß → SS
      const c = SAME[ch] ?? ch;
      if (Object.prototype.hasOwnProperty.call(LETTERS, c)) { cells.push({ rows: LETTERS[c], above: null, below: null }); continue; }
      const [base, ...marks] = c.normalize('NFD');
      if (!marks.length || !Object.prototype.hasOwnProperty.call(LETTERS, base)) return null;
      /** @type {Cell} */
      const cell = { rows: LETTERS[base], above: null, below: null };
      for (const m of marks) {
        if (MARKS_ABOVE[m] && !cell.above) cell.above = MARKS_ABOVE[m];
        else if (MARKS_BELOW[m] && !cell.below) cell.below = MARKS_BELOW[m];
        else return null;
      }
      cells.push(cell);
    }
  }
  return cells;
}

/**
 * True when every character of `text` is drawn in the Roman capitals (no fallback font).
 * @param {unknown} text
 */
export const canLogo = (text) => cellsOf(text) !== null;

/**
 * The bit grid of a row of cells, one bit apart: `top` rows over the capitals (for marks), the
 * capitals' 11, the rows below the baseline any glyph or mark needs.
 * @param {Cell[]} cells
 * @returns {{ bits: Uint8Array, w: number, h: number, top: number }}
 */
function romanBits(cells) {
  const gap = 1;
  const top = cells.some((c) => c.above) ? ABOVE : 0;
  const down = Math.max(0, ...cells.map((c) => Math.max(c.rows.length - CAP, c.below ? c.below.length : 0)));
  const widths = cells.map((c) => Math.max(c.rows[0].length, c.above ? c.above[0].length : 0, c.below ? c.below[0].length : 0));
  const w = Math.max(1, widths.reduce((s, cw) => s + cw + gap, -gap));
  const h = top + CAP + down;
  const bits = new Uint8Array(w * h);
  /** @param {string[]} rows @param {number} x0 @param {number} y0 */
  const stamp = (rows, x0, y0) => rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') bits[(y0 + y) * w + x0 + x] = 1; });
  /** A mark's column: centred on the glyph, inside the cell. @param {number} ox @param {number} cw @param {number} gx @param {number} gw @param {number} mw */
  const markX = (ox, cw, gx, gw, mw) => Math.min(ox + cw - mw, Math.max(ox, Math.round(gx + (gw - mw) / 2)));
  let ox = 0;
  cells.forEach((c, i) => {
    const cw = widths[i], gw = c.rows[0].length;
    const gx = ox + Math.floor((cw - gw) / 2);
    stamp(c.rows, gx, top);
    if (c.above) stamp(c.above, markX(ox, cw, gx, gw, c.above[0].length), top - 1 - c.above.length);
    if (c.below) stamp(c.below, markX(ox, cw, gx, gw, c.below[0].length), top + CAP);
    ox += cw + gap;
  });
  return { bits, w, h, top };
}

/**
 * A's Roman capitals for `text`, gilded; scale 3 is the logo (Scale3x, a 2-px outline, a 3-px drop),
 * 2 the logo for a long title (Scale2x, 2 and 2), 1 the small wordmark (1 and 1). Lower case is drawn
 * in capitals; a text with a character outside LETTERS (and its marks) is drawn from
 * `LOGO_FALLBACK_FONT` at the same scale. With `{ maxW }` the text is fitted (`logoFit`).
 * @param {string} text
 * @param {number|{ scale?: number, maxW?: number, lines?: number }} [o] the scale (3, 2 or 1), or
 *   the options of `logoFit` (scale: draw at that scale; maxW: fit)
 * @returns {HTMLCanvasElement}
 */
export function logo(text, o = 3) {
  if (typeof o === 'object' && o) {
    if (o.maxW != null) return logoFit(text, o).canvas;
    return logoLine(text, o.scale ?? 3);
  }
  return logoLine(text, typeof o === 'number' ? o : 3);
}

/** The gilding's outline and drop for a scale. @param {number} scale */
const gildOf = (scale) => GILD[scale] ?? GILD[3];

/**
 * One line of the logo at a scale (3, 2 or 1): the Roman capitals, else the fallback font.
 * @param {string} text
 * @param {number} scale
 * @returns {HTMLCanvasElement}
 */
function logoLine(text, scale) {
  const s = scale === 2 || scale === 1 ? scale : 3;
  const g = lineBits(text);
  const big = s === 3 ? scale3x(g.bits, g.w, g.h) : s === 2 ? scale2x(g.bits, g.w, g.h) : g.bits;
  const [ol, sh] = gildOf(s);
  return gildLogo(big, g.w * s, g.h * s, ol, sh, false, g.top * s, g.cap * s);
}

/**
 * A line's bits: the Roman capitals' grid, or the fallback font's raster (trimmed to its ink).
 * @param {string} text
 * @returns {{ bits: Uint8Array, w: number, h: number, top: number, cap: number, roman: boolean }}
 */
function lineBits(text) {
  const cells = cellsOf(text);
  if (cells) {
    const r = romanBits(cells);
    return { ...r, cap: CAP, roman: true };
  }
  const r = rasterize(String(text ?? '').normalize('NFC').toUpperCase(), LOGO_FALLBACK_FONT, 1, false) ?? { bits: new Uint8Array(CAP), w: 1, h: CAP };
  return { ...r, top: 0, cap: r.h, roman: false };
}

/**
 * The canvas width of a line at a scale, without painting it.
 * @param {{ w: number }} g its bits
 * @param {number} scale
 */
const lineWidth = (g, scale) => g.w * scale + 2 * (gildOf(scale)[0] + 1);

/** A line may not start with these (a break before them would orphan the punctuation). */
const NO_START = /^[-–—:;,.!?…)&·/+]/;

/**
 * The fit of a title to `maxW` art px (G's 560 for the title group): one line at scale 3, else one
 * line at scale 2, else two lines at 2 (broken at the space that leaves the narrower longer line,
 * never before punctuation), else one line at 1, else two lines at 1; when nothing fits, the
 * narrowest. Two lines are centred on one canvas.
 * @param {string} text
 * @param {{ maxW?: number, lines?: number }} [o] maxW (default: no limit), lines: at most 1 or 2 (2)
 * @returns {{ canvas: HTMLCanvasElement, scale: number, lines: string[], roman: boolean }} roman:
 *   drawn in the Roman capitals (false: the fallback font)
 */
export function logoFit(text, { maxW = Infinity, lines = 2 } = {}) {
  const str = String(text ?? '');
  const roman = canLogo(str);
  const words = str.split(' ');
  /** @type {string[][]} the two-line breaks */
  const splits = [];
  if (lines >= 2) {
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      if (a.trim() && b.trim() && !NO_START.test(b)) splits.push([a, b]);
    }
  }
  const memo = new Map();
  /** @param {string} s */
  const bitsOf = (s) => { if (!memo.has(s)) memo.set(s, lineBits(s)); return memo.get(s); };
  /** @param {string[]} ls @param {number} sc */
  const widthOf = (ls, sc) => Math.max(...ls.map((l) => lineWidth(bitsOf(l), sc)));
  /** The best two-line break at a scale. @param {number} sc */
  const best2 = (sc) => {
    let best = null, bw = Infinity;
    for (const sp of splits) { const w = widthOf(sp, sc); if (w < bw) { bw = w; best = sp; } }
    return best;
  };
  /** @type {[string[], number][]} the candidates in order */
  const cands = [[[str], 3], [[str], 2]];
  const two2 = best2(2);
  if (two2) cands.push([two2, 2]);
  cands.push([[str], 1]);
  const two1 = best2(1);
  if (two1) cands.push([two1, 1]);
  let pick = cands.find(([ls, sc]) => widthOf(ls, sc) <= maxW);
  if (!pick) pick = cands.reduce((a, b) => (widthOf(b[0], b[1]) < widthOf(a[0], a[1]) ? b : a));
  const [ls, sc] = pick;
  const canvases = ls.map((l) => logoLine(l, sc));
  return { canvas: canvases.length === 1 ? canvases[0] : stack(canvases), scale: sc, lines: ls, roman };
}

/**
 * Canvases one under the other, each centred (whole pixels).
 * @param {HTMLCanvasElement[]} cs
 * @returns {HTMLCanvasElement}
 */
function stack(cs) {
  const out = document.createElement('canvas');
  out.width = Math.max(...cs.map((c) => c.width));
  out.height = cs.reduce((s, c) => s + c.height, 0);
  const ctx = out.getContext('2d');
  let y = 0;
  for (const c of cs) {
    ctx.drawImage(c, Math.floor((out.width - c.width) / 2), y);
    y += c.height;
  }
  return out;
}

/**
 * The logo's gilding on any bit grid (w × h): bands of gold down the letters with a white-gold
 * crease, lit top edges, shaded bottoms and right sides, a bronze inner line, an ink outline `ol`
 * pixels wide and a hard drop shadow `sh` pixels down. `plain`: no bands across the letters (CJK).
 * The bands run down the capitals' rows (`bandTop`, `bandH`: the whole grid by default), so marks
 * over the capitals and tails under them do not move them.
 * @param {Uint8Array} big
 * @param {number} w
 * @param {number} h
 * @param {number} ol
 * @param {number} sh
 * @param {boolean} [plain]
 * @param {number} [bandTop]
 * @param {number} [bandH]
 * @returns {HTMLCanvasElement}
 */
export function gildLogo(big, w, h, ol, sh, plain = false, bandTop = 0, bandH = h) {
  const k = pal();
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && big[y * w + x] === 1;
  const pad = ol + 1;
  return art(w + pad * 2, h + pad * 2 + sh, (p) => {
    for (let y = -ol; y < h + ol; y++) {
      for (let x = -ol; x < w + ol; x++) {
        if (on(x, y)) continue;
        let near1 = false, near2 = false;
        for (let dy = -ol; dy <= ol; dy++) {
          for (let dx = -ol; dx <= ol; dx++) {
            if (!on(x + dx, y + dy)) continue;
            const m = Math.abs(dx) + Math.abs(dy);
            if (m === 1) near1 = true;
            if (m <= (ol === 2 ? 3 : 1)) near2 = true;
          }
        }
        if (near2) p.px(pad + x, pad + y + sh, k.ink0);
        if (near2) p.px(pad + x, pad + y, near1 && ol === 2 ? k.g0 : k.ink0);
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!on(x, y)) continue;
        const t = (y - bandTop) / bandH;
        let col = t < 0.12 ? k.g5 : t < 0.39 ? k.g4 : t < 0.52 ? k.g3 : t < 0.55 ? k.g2 : t < 0.61 ? k.g5 : t < 0.79 ? k.g4 : t < 0.91 ? k.g3 : k.g2;
        if (plain) {
          // CJK: no bands across the letters (they read as strokes); each stroke shaded down from its
          // own lit top edge to its dark foot, and on its right side
          col = !on(x, y - 1) ? k.g5 : !on(x, y + 1) ? k.g1 : !on(x, y + 2) ? k.g2 : !on(x + 1, y) ? k.g3 : !on(x, y + 3) ? k.g3 : !on(x, y - 2) ? k.g5 : k.g4;
        } else if (!on(x, y - 1)) col = k.g5;
        else if (!on(x, y + 1)) col = k.g1;
        else if (!on(x + 1, y)) col = t < 0.55 ? k.g3 : k.g2;
        else if (!on(x - 1, y) && t >= 0.55) col = k.g4;
        p.px(pad + x, pad + y, col);
      }
    }
  });
}

/**
 * The voicing marks a small raster loses (DotGothic16 at 16 px draws ゛ as one diagonal band run
 * into the stroke under it: ダ read タ with a blob), redrawn in bits: ゛ two ticks one bit apart, ゜
 * a ring. Scale3x keeps a one-bit gap open and the logo's outline fills it with ink.
 * @type {Record<string, string[]>}
 */
const VOICE_MARKS = { '゙': ['#.#', '#.#'], '゚': ['.#.', '#.#', '.#.'] };

/**
 * A kana with a voicing mark split into its base and the mark's bits (ダ → タ + ゛); null for any
 * other character.
 * @param {string} ch
 */
function voicing(ch) {
  const d = ch.normalize('NFD');
  return d.length === 2 && VOICE_MARKS[d[1]] ? { base: d[0], mark: VOICE_MARKS[d[1]] } : null;
}

/**
 * Stamp a voicing mark into a bit grid (w × h) at the top right of the character cell [cx, cx + cw):
 * the first place, from the cell's right edge leftward (two bits at most) on the line's top row,
 * then one row over it, where an empty bit parts every bit of the mark from any ink; where there is
 * none, the ink round the mark in the cell's corner is cleared instead.
 * @param {Uint8Array} bits
 * @param {number} w
 * @param {number} h
 * @param {number} cx
 * @param {number} cw
 * @param {number} top
 * @param {string[]} mark
 */
function stampMark(bits, w, h, cx, cw, top, mark) {
  /** @type {[number, number][]} */
  const pts = [];
  mark.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') pts.push([i, j]); });
  const mw = mark[0].length;
  const ink = (x, y) => x >= 0 && y >= 0 && x < w && y < h && bits[y * w + x] === 1;
  const near = (x0, y0) => pts.flatMap(([i, j]) => [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [x0 + i + dx, y0 + j + dy]))).filter(([x, y]) => ink(x, y));
  let at = null;
  for (const y0 of [top, top - 1]) {
    for (let x0 = cx + cw - mw; x0 >= cx + cw - mw - 2 && !at; x0--) if (y0 >= 0 && !near(x0, y0).length) at = [x0, y0];
    if (at) break;
  }
  if (!at) {
    at = [cx + cw - mw, top];
    for (const [x, y] of near(at[0], at[1])) bits[y * w + x] = 0;
  }
  for (const [i, j] of pts) bits[(at[1] + j) * w + at[0] + i] = 1;
}

/**
 * `text` drawn in `font` one character at a time `gap` bits apart, its coverage cut at half into
 * bits and trimmed to the ink (`marks`: voiced kana as base + clean mark bits); null without ink.
 * @param {string} text
 * @param {string} font
 * @param {number} gap
 * @param {boolean} marks
 * @returns {{ bits: Uint8Array, w: number, h: number }|null}
 */
function rasterize(text, font, gap, marks) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.font = font;
  const chars = [...text];
  const adv = chars.map((ch) => Math.round(ctx.measureText(ch).width));
  const m = ctx.measureText(text);
  const asc = Math.ceil(m.actualBoundingBoxAscent) + 3, desc = Math.ceil(m.actualBoundingBoxDescent) + 2;
  const W = Math.max(1, adv.reduce((a, b) => a + b + gap, -gap) + 4), H = Math.max(1, asc + desc);
  c.width = W; c.height = H;
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  /** @type {[number, number, string[]][]} */
  const cells = [];
  let x = 2;
  chars.forEach((ch, i) => {
    const v = marks ? voicing(ch) : null;
    ctx.fillText(v ? v.base : ch, x, asc);
    if (v) cells.push([x, adv[i], v.mark]);
    x += adv[i] + gap;
  });
  const data = ctx.getImageData(0, 0, W, H).data;
  const full = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) full[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  if (cells.length) {
    // the marks on the line's top row (the top of its tallest ink)
    let top = 0;
    while (top < H - 1 && !full.subarray(top * W, top * W + W).includes(1)) top++;
    for (const [cx, cw, mark] of cells) stampMark(full, W, H, cx, cw, top, mark);
  }
  // trim to the ink
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let i = 0; i < W; i++) {
      if (!full[y * W + i]) continue;
      x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) bits[y * w + i] = full[(y + y0) * W + i + x0];
  return { bits, w, h };
}

/**
 * The logo in another script (the game's name in Japanese or Chinese): `text` drawn in `font` (a
 * canvas font shorthand, e.g. DotGothic16 at 16 px, or Noto Sans SC 900 at its full size) one
 * character at a time `gap` bits apart, its coverage cut at half into bits, enlarged ×`scale`
 * (Scale3x or Scale2x: the steps of a curve stay one pixel; 1 for a face drawn at its full size)
 * and gilded like the Roman capitals (an ink outline 2 px wide outside the letters, a drop of 3);
 * `plain`: without the bands across the letters (dense CJK strokes read them as more strokes).
 * `marks`: a voiced kana is drawn as its base and its ゛ or ゜ stamped in clean bits (for a small
 * raster, whose own marks fuse). The font must be loaded first (`FontLoader.ensure`).
 * @param {string} text
 * @param {string} font
 * @param {number} [scale] 3, 2 or 1
 * @param {number} [gap]
 * @param {boolean} [plain]
 * @param {boolean} [marks]
 * @returns {HTMLCanvasElement}
 */
export function textLogo(text, font, scale = 3, gap = 1, plain = false, marks = false) {
  const r = rasterize(text, font, gap, marks);
  if (!r) return gildLogo(new Uint8Array(1), 1, 1, 2, 3, plain); // no ink (an empty or blank name)
  const { bits, w, h } = r;
  const big = scale === 3 ? scale3x(bits, w, h) : scale === 2 ? scale2x(bits, w, h) : bits;
  return gildLogo(big, w * scale, h * scale, 2, 3, plain);
}

/**
 * The logo fonts per language (G's LOGO_FONT): [font, scale, gap, plain, marks] for
 * `textLogo`. Japanese: DotGothic16 at 16 px, Scale3x, the voicing marks redrawn; Chinese: Noto
 * Sans SC 900 at 62 art px, one bit per art pixel, no bands.
 * @type {Readonly<Record<'ja'|'zh', [string, number, number, boolean, boolean]>>}
 */
export const LOGO_FONT = Object.freeze({ ja: ['400 16px DotGothic16', 3, 1, false, true], zh: ['900 62px "Noto Sans SC"', 1, 4, true, false] });

/**
 * The sizes `textLogoFit` steps down through, per language: [font px, scale]. Japanese keeps
 * DotGothic16 at its own 16 px (a dot face: smaller sizes lose its dots) and drops Scale3x to Scale2x,
 * then 1×; Chinese draws Noto Sans SC 900 smaller, one bit per art pixel.
 * @type {Readonly<Record<'ja'|'zh', readonly (readonly number[])[]>>}
 */
const TEXT_LOGO_STEPS = Object.freeze({
  ja: Object.freeze([[16, 3], [16, 2], [16, 1]]),
  zh: Object.freeze([[62, 1], [54, 1], [46, 1], [40, 1]]),
});
/** A CJK line may not start with these (small kana, the prolonged sound mark, closing punctuation). */
const CJK_NO_START = /^[ー・、。，．：；！？」』）】〕〉》”’…‥々ゝゞヽヾぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ\-–—]/;
/** … nor end with these (opening punctuation). */
const CJK_NO_END = /[「『（【〔〈《“‘]$/;
/** A line that ends with these ends between two words (a middle dot, a comma, a particle, a dash). */
const CJK_GOOD_END = /[・·、，の之的とにへをで—–-]$/;

/**
 * The title in Japanese or Chinese (`textLogo` in the language's `LOGO_FONT`) fitted to `maxW` art px
 * (G's 560 for the title group): one line at the face's own size and scale, then smaller (Japanese:
 * Scale2x, then 1×; Chinese: the face at 54, 46, 40 px), two lines where one does not fit — broken at
 * a translator's hint (U+200B) or a space when the name has one, else between the two characters
 * that leave the narrower longer line, never before a small kana, a prolonged sound mark or closing
 * punctuation and never after opening punctuation; the two lines centred on one canvas. When nothing
 * fits, the narrowest. The face must be loaded first (`FontLoader.ensure`). U+200B is never drawn.
 * @param {string} text
 * @param {'ja'|'zh'|string} lang
 * @param {{ maxW?: number, lines?: number }} [o] maxW (default: no limit), lines: at most 1 or 2 (2)
 * @returns {{ canvas: HTMLCanvasElement, scale: number, size: number, lines: string[] }} the canvas,
 *   the scale and font px it was drawn at, its lines
 */
export function textLogoFit(text, lang, { maxW = Infinity, lines = 2 } = {}) {
  const L = lang === 'zh' ? 'zh' : 'ja';
  const [font, , gap0, plain, marks] = LOGO_FONT[L];
  const size0 = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '16');
  const fontOf = (/** @type {number} */ size) => font.replace(/\d+(?:\.\d+)?px/, `${size}px`);
  const gapOf = (/** @type {number} */ size) => Math.max(1, Math.round((gap0 * size) / size0));
  const str = String(text ?? '').normalize('NFC').trim();
  const flat = str.replace(/\u200b/g, '');
  const steps = TEXT_LOGO_STEPS[L];
  /** @param {string} s @param {number} size @param {number} scale */
  const draw = (s, size, scale) => textLogo(s, fontOf(size), scale, gapOf(size), plain, marks);
  /**
   * The two-line break at a size: the pair whose longer line is the narrowest.
   * @param {number} size
   * @param {number} scale
   */
  const split = (size, scale) => {
    const hinted = /[\u200b ]/.test(str);
    /** @type {[string, string][]} */
    const pairs = [];
    if (hinted) {
      const parts = str.split(/[\u200b ]+/).filter(Boolean);
      for (let i = 1; i < parts.length; i++) pairs.push([parts.slice(0, i).join(L === 'zh' ? '' : ' '), parts.slice(i).join(L === 'zh' ? '' : ' ')]);
    } else {
      const chars = [...flat];
      for (let i = 1; i < chars.length; i++) {
        const a = chars.slice(0, i).join(''), b = chars.slice(i).join('');
        if (!CJK_NO_START.test(b) && !CJK_NO_END.test(a)) pairs.push([a, b]);
      }
    }
    if (!pairs.length) return null;
    const c = document.createElement('canvas').getContext('2d');
    c.font = fontOf(size);
    // a line's canvas width, estimated from the face's advances (the raster is trimmed to its ink)
    const wOf = (/** @type {string} */ s) => (c.measureText(s).width + gapOf(size) * [...s].length) * scale + 6;
    /** @param {[string, string][]} ps */
    const narrowest = (ps) => {
      let best = null, bw = Infinity;
      for (const p of ps) { const w = Math.max(wOf(p[0]), wOf(p[1])); if (w < bw) { bw = w; best = p; } }
      return { best, bw };
    };
    // a break between words where one fits: after a middle dot, a particle or a comma (ブライトウォーター・
    // | クロッシング, not ブライトウォーター・ク | ロッシング); else between any two characters
    const good = hinted ? pairs : pairs.filter((p) => CJK_GOOD_END.test(p[0]));
    const g = narrowest(good);
    return g.best && g.bw <= maxW ? g.best : narrowest(pairs).best;
  };
  /** @type {{ lines: string[], size: number, scale: number }[]} the candidates in order */
  const cands = [];
  const last = steps.length - 1;
  for (let i = 0; i < last; i++) cands.push({ lines: [flat], size: steps[i][0], scale: steps[i][1] });
  if (lines >= 2) for (let i = 1; i < last; i++) { const sp = split(steps[i][0], steps[i][1]); if (sp) cands.push({ lines: sp, size: steps[i][0], scale: steps[i][1] }); }
  cands.push({ lines: [flat], size: steps[last][0], scale: steps[last][1] });
  if (lines >= 2) { const sp = split(steps[last][0], steps[last][1]); if (sp) cands.push({ lines: sp, size: steps[last][0], scale: steps[last][1] }); }
  let narrowest = null;
  for (const c of cands) {
    const cs = c.lines.map((l) => draw(l, c.size, c.scale));
    const canvas = cs.length === 1 ? cs[0] : stack(cs);
    const out = { canvas, scale: c.scale, size: c.size, lines: c.lines };
    if (canvas.width <= maxW) return out;
    if (!narrowest || canvas.width < narrowest.canvas.width) narrowest = out;
  }
  return narrowest;
}
