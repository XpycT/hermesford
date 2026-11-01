/**
 * The pixel glyphs (docs/specs/PIXEL_UI.md §4): arrows and the note — ← ↑ → ↓ ↔ ↕ ↖ ↗ ↘ ↙ ♪ —,
 * which neither Jersey face has (Tiny5 has only ↑ ↓). Without them a signpost's arrows and the
 * music toast's note fall back to a system font: thin vector strokes inside G's pixel text.
 *
 * Each is drawn here as a bitmap on the grid of one Latin face — Jersey 15 (cap 15 font pixels,
 * 3-pixel strokes), Jersey 10 (cap 10, 2-pixel strokes), Tiny5 (cap 5, 1-pixel strokes) — and
 * `glyphFontData(grid)` builds a TrueType font from those bitmaps (whole squares of that face's
 * units per em, its ascent and descent), so the glyphs land on the face's own pixels at every size
 * the face is set at. FontLoader adds the three as FontFaces ("Lu Glyph 15" …: no download, no
 * file — like the rest of the game, generated at run time) and layout/type.js puts each after its
 * face in the role stacks; the CJK stacks get role-named aliases of them sized like the roles'
 * Jersey aliases. Pure (no DOM): the font is an ArrayBuffer.
 */

/** The characters the glyph faces draw (in the order of `CHARS`' code points). */
export const PIXEL_GLYPHS = '←↑→↓↔↕↖↗↘↙♪';
/** Their CSS unicode-range. */
export const GLYPH_RANGE = 'U+2190-2199, U+266A';

/**
 * A Latin face's grid: units per em, the units of one font pixel, ascent and descent (units, the
 * descent positive), the glyphs' left side bearing and stroke (font pixels), its cap height.
 * @typedef {object} GlyphGrid
 * @property {number} upm
 * @property {number} unit
 * @property {number} asc
 * @property {number} desc
 * @property {number} lsb
 * @property {number} stroke
 * @property {number} cap
 */
/** The grids of Jersey 15, Jersey 10 and Tiny5 (their files' head / hhea values). @type {Readonly<Record<15|10|5, GlyphGrid>>} */
export const GLYPH_GRIDS = Object.freeze({
  15: Object.freeze({ upm: 1350, unit: 50, asc: 1050, desc: 300, lsb: 1, stroke: 3, cap: 15 }),
  10: Object.freeze({ upm: 1400, unit: 75, asc: 1125, desc: 375, lsb: 0, stroke: 2, cap: 10 }),
  5: Object.freeze({ upm: 1024, unit: 128, asc: 896, desc: 256, lsb: 0, stroke: 1, cap: 5 }),
});
/** The glyph face of each grid (layout/type.js `GLYPH_FACE` maps the Latin faces onto them). */
export const GLYPH_FAMILY = Object.freeze({ 15: 'Lu Glyph 15', 10: 'Lu Glyph 10', 5: 'Lu Glyph 5' });

/**
 * A glyph's bitmap: rows top to bottom ('#' ink), `base` the bottom row's height above the
 * baseline (font pixels; negative below it).
 * @typedef {{ rows: string[], base: number }} Bitmap
 */

/** ↑ and ♪ per grid, drawn by hand in the faces' manner (flat-topped heads, the faces' strokes). */
const UP = {
  15: ['....###....', '...#####...', '..#######..', '.#########.', '###########', ...Array(10).fill('....###....')],
  10: ['...##...', '..####..', '.######.', '########', ...Array(6).fill('...##...')],
  5: ['..#..', '.###.', '#####', '..#..', '..#..'],
};
const NOTE = {
  15: [
    '....####...', '....######.', '....###.###', '....###..##', '....###...#', '....###....', '....###....',
    '....###....', '....###....', '..#####....', '.######....', '#######....', '#######....', '######.....', '.####......',
  ],
  10: ['...###..', '...#####', '...##.##', '...##..#', '...##...', '...##...', '.####...', '#####...', '#####...', '.###....'],
  5: ['..##.', '..#.#', '..#..', '###..', '##...'],
};

/** @param {string[]} r */
const flipV = (r) => [...r].reverse();
/** @param {string[]} r */
const flipH = (r) => r.map((l) => [...l].reverse().join(''));
/** Rotate 90° clockwise (↑ → →). @param {string[]} r */
const rotCW = (r) => Array.from({ length: r[0].length }, (_, c) => r.map((l) => l[c]).reverse().join(''));

/**
 * The head of an arrow: the ↑ bitmap's rows down to its widest.
 * @param {string[]} up
 */
const headRows = (up) => {
  const ink = up.map((r) => r.replace(/\./g, '').length);
  return up.slice(0, ink.indexOf(Math.max(...ink)) + 1);
};

/**
 * ↗ in a square box of n: the head a right triangle in the top-right corner (legs `a`, its long
 * side square to the shaft) and a shaft of the grid's stroke from the bottom-left corner into it.
 * @param {GlyphGrid} g
 * @param {number} n the box
 * @param {number} a the head's legs
 */
function diagonal(g, n, a) {
  const t = g.stroke;
  const m = Array.from({ length: n }, () => Array(n).fill('.'));
  const set = (x, y) => { if (x >= 0 && y >= 0 && x < n && y < n) m[y][x] = '#'; };
  for (let r = 0; r < a; r++) for (let x = n - a + r; x < n; x++) set(x, r);
  for (let y = 0; y < n; y++) {
    const c = n - 1 - y - Math.floor((t - 1) / 2);
    for (let i = 0; i < t; i++) set(c + i, y);
  }
  return m.map((r) => r.join(''));
}

/**
 * Every glyph of a grid, by character.
 * @param {15|10|5} id
 * @returns {Record<string, Bitmap>}
 */
export function glyphBitmaps(id) {
  const g = GLYPH_GRIDS[id];
  const up = UP[id];
  const right = rotCW(up);
  // horizontal arrows centred on the cap's middle
  const hBase = Math.floor((g.cap - right.length) / 2 + 0.5);
  const head = headRows(up);
  const stemRow = up[up.length - 1];
  // ↕: a head each way and the stem between (at least the stroke long), as tall as the cap where it fits
  const mid = Math.max(g.stroke, g.cap - 2 * head.length);
  const updown = [...head, ...Array(mid).fill(stemRow), ...flipV(head)];
  const udBase = Math.floor((g.cap - updown.length) / 2);
  // ↔: the same, turned
  const lr = rotCW(updown);
  const diag = id === 15 ? diagonal(g, 13, 8) : id === 10 ? diagonal(g, 9, 5) : diagonal(g, 5, 3);
  const dBase = Math.floor((g.cap - diag.length) / 2 + 0.5);
  return {
    '↑': { rows: up, base: 0 },
    '↓': { rows: flipV(up), base: 0 },
    '→': { rows: right, base: hBase },
    '←': { rows: flipH(right), base: hBase },
    '↕': { rows: updown, base: udBase },
    '↔': { rows: lr, base: Math.floor((g.cap - lr.length) / 2 + 0.5) },
    '↗': { rows: diag, base: dBase },
    '↖': { rows: flipH(diag), base: dBase },
    '↘': { rows: flipV(diag), base: dBase },
    '↙': { rows: flipH(flipV(diag)), base: dBase },
    '♪': { rows: NOTE[id], base: 0 },
  };
}

// ---------------------------------------------------------------------------------------------
// TrueType
// ---------------------------------------------------------------------------------------------

/**
 * A bitmap's ink as rectangles (font pixels, y up from the baseline): each row's runs, a run
 * carried down while the next rows repeat it.
 * @param {Bitmap} bm
 * @returns {[number, number, number, number][]} [x0, y0, x1, y1]
 */
function rects(bm) {
  const H = bm.rows.length;
  const used = bm.rows.map((r) => Array(r.length).fill(false));
  /** @type {[number, number, number, number][]} */
  const out = [];
  for (let r = 0; r < H; r++) {
    const row = bm.rows[r];
    let x = 0;
    while (x < row.length) {
      if (row[x] !== '#' || used[r][x]) { x++; continue; }
      let x1 = x;
      while (x1 < row.length && row[x1] === '#' && !used[r][x1]) x1++;
      // carry the run down while the rows below have exactly it
      let r1 = r + 1;
      const same = (rr) => {
        const l = bm.rows[rr];
        if (!l) return false;
        for (let i = x; i < x1; i++) if (l[i] !== '#' || used[rr][i]) return false;
        return (x === 0 || l[x - 1] !== '#' || used[rr][x - 1]) && (x1 >= l.length || l[x1] !== '#' || used[rr][x1]);
      };
      while (r1 < H && same(r1)) r1++;
      for (let rr = r; rr < r1; rr++) for (let i = x; i < x1; i++) used[rr][i] = true;
      // bitmap rows top-down → y up: row r's bottom is base + (H - 1 - r)
      out.push([x, bm.base + (H - r1), x1, bm.base + (H - r)]);
      x = x1;
    }
  }
  return out;
}

/** A growable big-endian byte writer. */
class Bytes {
  constructor() { /** @type {number[]} */ this.b = []; }
  u8(v) { this.b.push(v & 255); return this; }
  u16(v) { this.b.push((v >> 8) & 255, v & 255); return this; }
  i16(v) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v) { this.b.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return this; }
  tag(s) { for (let i = 0; i < 4; i++) this.b.push(s.charCodeAt(i)); return this; }
  pad() { while (this.b.length % 4) this.b.push(0); return this; }
  get length() { return this.b.length; }
}

/** @param {number[]} b */
const checksum = (b) => {
  let sum = 0;
  for (let i = 0; i < b.length; i += 4) sum = (sum + (((b[i] << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0)) >>> 0;
  return sum;
};

/**
 * A TrueType font of one grid's pixel glyphs (an ArrayBuffer for `new FontFace(family, data)`):
 * glyph 0 an empty .notdef, then `PIXEL_GLYPHS` in order; the outlines are the bitmaps' rectangles
 * in whole font pixels; ascent, descent and units per em those of the grid's face, so its line box
 * and pixels are the face's.
 * @param {15|10|5} id
 * @param {string} [family]
 * @returns {ArrayBuffer}
 */
export function glyphFontData(id, family = GLYPH_FAMILY[id]) {
  const g = GLYPH_GRIDS[id];
  const maps = glyphBitmaps(id);
  const chars = [...PIXEL_GLYPHS];
  const U = g.unit;
  /** @type {{ cp: number, adv: number, rects: [number, number, number, number][], w: number }[]} */
  const glyphs = [{ cp: -1, adv: Math.round(g.upm / 4 / U) * U, rects: [], w: 0 }];
  for (const ch of chars) {
    const bm = maps[ch];
    const w = Math.max(...bm.rows.map((r) => r.length));
    glyphs.push({ cp: /** @type {number} */ (ch.codePointAt(0)), adv: (g.lsb + w + 1) * U, rects: rects(bm).map(([x0, y0, x1, y1]) => [(x0 + g.lsb) * U, y0 * U, (x1 + g.lsb) * U, y1 * U]), w });
  }
  // glyf + loca (long offsets)
  const glyf = new Bytes();
  const loca = [];
  let xMin = 0, yMin = 0, xMax = 0, yMax = 0, maxPts = 0, maxCont = 0, advMax = 0, minLsb = 32767, minRsb = 32767, maxExt = 0;
  for (const gl of glyphs) {
    loca.push(glyf.length);
    advMax = Math.max(advMax, gl.adv);
    if (!gl.rects.length) continue;
    const bx0 = Math.min(...gl.rects.map((r) => r[0])), by0 = Math.min(...gl.rects.map((r) => r[1]));
    const bx1 = Math.max(...gl.rects.map((r) => r[2])), by1 = Math.max(...gl.rects.map((r) => r[3]));
    xMin = Math.min(xMin, bx0); yMin = Math.min(yMin, by0); xMax = Math.max(xMax, bx1); yMax = Math.max(yMax, by1);
    minLsb = Math.min(minLsb, bx0); minRsb = Math.min(minRsb, gl.adv - bx1); maxExt = Math.max(maxExt, bx1);
    glyf.i16(gl.rects.length).i16(bx0).i16(by0).i16(bx1).i16(by1);
    gl.rects.forEach((_, i) => glyf.u16(i * 4 + 3));
    glyf.u16(0); // no instructions
    const pts = [];
    // clockwise (TrueType's outer contours): up the left side, along the top, down the right
    for (const [x0, y0, x1, y1] of gl.rects) pts.push([x0, y0], [x0, y1], [x1, y1], [x1, y0]);
    maxPts = Math.max(maxPts, pts.length); maxCont = Math.max(maxCont, gl.rects.length);
    for (let i = 0; i < pts.length; i++) glyf.u8(1); // on curve, 2-byte deltas
    let px = 0, py = 0;
    for (const [x] of pts) { glyf.i16(x - px); px = x; }
    for (const [, y] of pts) { glyf.i16(y - py); py = y; }
    glyf.pad();
  }
  loca.push(glyf.length);
  if (minLsb === 32767) minLsb = 0;
  if (minRsb === 32767) minRsb = 0;
  const n = glyphs.length;

  const tables = /** @type {Record<string, Bytes>} */ ({});
  // head (the checksum adjustment is patched in at the end)
  tables.head = new Bytes().u32(0x00010000).u32(0x00010000).u32(0).u32(0x5F0F3CF5).u16(0x000B).u16(g.upm)
    .u32(0).u32(0).u32(0).u32(0).i16(xMin).i16(yMin).i16(xMax).i16(yMax).u16(0).u16(6).i16(2).i16(1).i16(0);
  tables.hhea = new Bytes().u32(0x00010000).i16(g.asc).i16(-g.desc).i16(0).u16(advMax).i16(minLsb).i16(minRsb).i16(maxExt)
    .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(n);
  tables.maxp = new Bytes().u32(0x00010000).u16(n).u16(maxPts).u16(maxCont).u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);
  const cps = glyphs.slice(1).map((gl) => gl.cp);
  const os2 = new Bytes().u16(4).i16(Math.round(advMax * 0.75)).u16(400).u16(5).u16(0)
    .i16(Math.round(g.upm * 0.65)).i16(Math.round(g.upm * 0.6)).i16(0).i16(Math.round(g.upm * 0.075))
    .i16(Math.round(g.upm * 0.65)).i16(Math.round(g.upm * 0.6)).i16(0).i16(Math.round(g.upm * 0.35))
    .i16(g.unit).i16(Math.round(g.cap * g.unit * 0.5)).i16(0);
  for (let i = 0; i < 10; i++) os2.u8(0);
  // ulUnicodeRange: arrows (bit 37) and misc. symbols (bit 46)
  os2.u32(0).u32((1 << 5) | (1 << 14)).u32(0).u32(0).tag('NONE').u16(0x00C0)
    .u16(Math.min(...cps)).u16(Math.max(...cps)).i16(g.asc).i16(-g.desc).i16(0).u16(g.asc).u16(g.desc)
    .u32(1).u32(0).i16(Math.round(g.cap * 0.7) * g.unit).i16(g.cap * g.unit).u16(0).u16(32).u16(1);
  tables['OS/2'] = os2;
  const hmtx = new Bytes();
  for (const gl of glyphs) hmtx.u16(gl.adv).i16(gl.rects.length ? Math.min(...gl.rects.map((r) => r[0])) : 0);
  tables.hmtx = hmtx;
  // cmap: format 4, one segment per character (+ the closing 0xFFFF)
  const sorted = glyphs.map((gl, gid) => ({ cp: gl.cp, gid })).filter((e) => e.cp >= 0).sort((a, b) => a.cp - b.cp);
  const segs = [...sorted.map((e) => ({ start: e.cp, end: e.cp, delta: (e.gid - e.cp + 65536) % 65536 })), { start: 0xFFFF, end: 0xFFFF, delta: 1 }];
  const segX2 = segs.length * 2;
  const p2 = 2 ** Math.floor(Math.log2(segs.length));
  const sub = new Bytes().u16(4).u16(16 + segs.length * 8).u16(0).u16(segX2).u16(p2 * 2).u16(Math.log2(p2)).u16(segX2 - p2 * 2);
  for (const sg of segs) sub.u16(sg.end);
  sub.u16(0);
  for (const sg of segs) sub.u16(sg.start);
  for (const sg of segs) sub.u16(sg.delta);
  for (let i = 0; i < segs.length; i++) sub.u16(0);
  const cmap = new Bytes().u16(0).u16(2).u16(0).u16(3).u32(20).u16(3).u16(1).u32(20);
  cmap.b.push(...sub.b);
  tables.cmap = cmap;
  tables.glyf = glyf;
  const locaT = new Bytes();
  for (const o of loca) locaT.u32(o);
  tables.loca = locaT;
  // name: family, style, unique id, full name, PostScript name (Windows, US English)
  const ps = family.replace(/[^A-Za-z0-9]/g, '');
  const names = [[1, family], [2, 'Regular'], [3, `${ps}-gen`], [4, family], [6, ps]];
  const name = new Bytes().u16(0).u16(names.length).u16(6 + names.length * 12);
  const strings = new Bytes();
  for (const [id2, str] of names) {
    name.u16(3).u16(1).u16(0x409).u16(/** @type {number} */ (id2)).u16(String(str).length * 2).u16(strings.length);
    for (const ch of String(str)) strings.u16(ch.charCodeAt(0));
  }
  name.b.push(...strings.b);
  tables.name = name;
  tables.post = new Bytes().u32(0x00030000).u32(0).i16(-g.unit).i16(g.unit).u32(0).u32(0).u32(0).u32(0).u32(0);

  // the file: the table directory (tags sorted), each table padded to 4 bytes
  const tags = Object.keys(tables).sort();
  const nt = tags.length;
  const sr = 2 ** Math.floor(Math.log2(nt)) * 16;
  const out = new Bytes().u32(0x00010000).u16(nt).u16(sr).u16(Math.log2(sr / 16)).u16(nt * 16 - sr);
  let off = 12 + nt * 16;
  const dir = [];
  for (const t of tags) {
    const body = tables[t].b;
    dir.push({ t, sum: checksum(body), off, len: body.length });
    off += Math.ceil(body.length / 4) * 4;
  }
  for (const d of dir) out.tag(d.t).u32(d.sum).u32(d.off).u32(d.len);
  let headOff = 0;
  for (const t of tags) {
    if (t === 'head') headOff = out.length;
    out.b.push(...tables[t].b);
    out.pad();
  }
  const adj = (0xB1B0AFBA - checksum(out.b)) >>> 0;
  out.b[headOff + 8] = (adj >>> 24) & 255; out.b[headOff + 9] = (adj >>> 16) & 255;
  out.b[headOff + 10] = (adj >>> 8) & 255; out.b[headOff + 11] = adj & 255;
  return new Uint8Array(out.b).buffer;
}
