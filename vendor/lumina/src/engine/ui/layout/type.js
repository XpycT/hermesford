/**
 * The pixel UI's type (docs/specs/PIXEL_UI.md §4), ported from mockup G's UI code: one system of
 * type roles per language, measured with canvas `measureText`, placed on whole pixels; and `txt`,
 * the DOM text element every component sets its words in.
 *
 * Sizes are in font units: `u` 'px' (one per art pixel: the size scales with --px) or 'fpx' (one
 * per --fpx = ⌈--px / 2⌉, UiScale.js `fpxFor`: E's half-size fonts, whose pixels stay whole at
 * every --px; ⅔ of an art px at --px 3, the nearer whole size to G's ½). `em`
 * font size, `L` line box, `mid` the ink centre below the line box top (E's cap centre; for the CJK
 * faces the measured centre of 回), `ink` the ink height; `ou` the unit of its outlines and drops;
 * `fx` its edge filter (#lu-crisp alpha threshold for the pixel fonts, #lu-soft a one-pixel ramp for
 * CJK text from 20 CSS px, #lu-aa grey anti-aliasing for small CJK text); `bold` a bitmap bold (a
 * copy one pixel to the right, `currentColor`).
 *
 * Roles that change with the language:
 *   head   the one big heading (level-up, area banner, the member on the tactics panel, end titles)
 *   name   today's small capitals: names, headings, the menu
 *   body   dialogue, choices, blurbs
 *   line   today's small italic lines: region, phase, speaker title, hints, help, footers, tagline
 *   small  tracked labels
 *   val    a rule's value (English: the body; CJK: a bold weight a step over the line size)
 * and roles that never do (numbers and Latin abbreviations; no digit is ever set in Tiny5):
 *   num    Jersey 10, half size (HP numbers, gold)
 *   big    Jersey 15, half size (the clock, hit numbers, cooldown seconds)
 *   numL   Jersey 10, full size (the level numeral, crits)
 *   tiny   Tiny5 (Lv, HP, MP, SP, G, N, keycaps)
 *
 * The language is the page's (`getLang()`, src/engine/i18n/I18n.js); the scale is set by the UI root
 * (`setPx`, UI.js). Layouts are written in the English --px 2 layout's art px; `txt` moves another
 * language's ink centre onto the English role's centre line.
 *
 * `TYPE` is G's table at --px 2. The roles in use (`FONT`, and what `txt` / `measure` set) follow
 * the scale where a face has a grid of its own (`rolesAt`): Japanese names and dialogue are
 * DotGothic16 only at a size on its 16-dot grid near G's (32 px at --px 3, 48 at 4), else Noto Sans
 * JP at G's size (--px 2: DotGothic16 at 24 px closes the dakuten up, バ reads パ); and the CJK
 * lines' Jersey aliases take the whole-pixel Jersey size nearest G's proportion (`aliasSpecs`).
 *
 * Every stack carries the pixel glyphs (GlyphFont.js: ← ↑ → ↓ ↔ ↕ ↖ ↗ ↘ ↙ ♪, which neither Jersey
 * has) on the same grid as its face — "Lu Glyph 15" after Jersey 15, "Lu Glyph 10" after Jersey 10,
 * "Lu Glyph 5" after Tiny5, and a role-named alias of them ("Lu G Body" …) after a CJK role's
 * Jersey alias —, so an arrow or a note is pixel art in every role and language, in DOM text
 * (DialogBox's per-character spans too: they inherit the stack) and in `measure`.
 */
import { getLang, isCJK } from '../../i18n/I18n.js';
import { fpxFor } from '../UiScale.js';

/** The characters every role draws as pixel glyphs (GlyphFont.js): ← ↑ → ↓ ↔ ↕ ↖ ↗ ↘ ↙ ♪. */
export { PIXEL_GLYPHS } from '../GlyphFont.js';

/** @typedef {'head'|'name'|'body'|'line'|'small'|'val'|'num'|'big'|'numL'|'tiny'} RoleId */
/**
 * A role of the type table.
 * @typedef {object} Role
 * @property {string} family the CSS font-family stack
 * @property {number} w the font weight
 * @property {'px'|'fpx'} u the size unit
 * @property {'px'|'fpx'} ou the outlines' unit
 * @property {number} em the font size, in `u`
 * @property {number} L the line box, in `u`
 * @property {number} mid the ink centre below the line box top, in `u`
 * @property {number} ink the ink height, in `u`
 * @property {'crisp'|'soft'|'aa'} fx the edge filter
 * @property {string} [bold] a bitmap bold's offset (CSS length)
 * @property {boolean} [cjk] a CJK face (set solid, no tracking)
 */
/**
 * A role in art px for the current language and --px (`FONT[id]`).
 * @typedef {Role & { unit: number, size: number, cjk: boolean }} RoleMetrics
 */

/** The pixel glyph faces (GlyphFont.js, built by FontLoader): one per Latin face's grid. */
export const GLYPH_FACE = Object.freeze({ 'Jersey 15': 'Lu Glyph 15', 'Jersey 10': 'Lu Glyph 10', Tiny5: 'Lu Glyph 5' });
const J10 = '"Jersey 10", "Lu Glyph 10", monospace', J15 = '"Jersey 15", "Lu Glyph 15", monospace', T5 = 'Tiny5, "Lu Glyph 5", monospace';
/** @type {Pick<Role, 'fx'|'w'>} */
const PIX = { fx: 'crisp', w: 400 };
/** @type {Record<'num'|'big'|'numL'|'tiny', Role>} */
const SHARED = {
  num: { ...PIX, family: J10, u: 'fpx', ou: 'fpx', em: 56 / 3, L: 18, mid: 9, ink: 10 },
  big: { ...PIX, family: J15, u: 'fpx', ou: 'fpx', em: 27, L: 23, mid: 11.5, ink: 15 },
  numL: { ...PIX, family: J10, u: 'px', ou: 'px', em: 56 / 3, L: 14, mid: 7, ink: 10 },
  tiny: { ...PIX, family: T5, u: 'px', ou: 'px', em: 8, L: 9, mid: 4.5, ink: 5 },
};
/** @type {Record<'head'|'name'|'body'|'line'|'small'|'val', Role>} */
const EN = {
  head: { ...PIX, family: J15, u: 'px', ou: 'px', em: 27, L: 21, mid: 10.5, ink: 15 },
  name: { ...PIX, family: J15, u: 'fpx', ou: 'fpx', em: 27, L: 23, mid: 11.5, ink: 15 },
  body: { ...PIX, family: J15, u: 'fpx', ou: 'fpx', em: 27, L: 26, mid: 12.5, ink: 15 },
  line: { ...PIX, family: J10, u: 'fpx', ou: 'fpx', em: 56 / 3, L: 18, mid: 9, ink: 10 },
  small: { ...PIX, family: T5, u: 'px', ou: 'px', em: 8, L: 9, mid: 4.5, ink: 5 },
  val: null,
};
EN.val = EN.body;

/**
 * The Jersey aliases at the head of the CJK stacks (G's "G Num 14" … "G Big 36", named by role
 * here): ASCII, the Latin-1 letters (é, ü, Œ …), · and × only, size-adjusted so Jersey lands on its
 * own pixel size inside a Japanese or Chinese line ("Lv 5", "+20", "1:42:10" and "Café" read as
 * E's in every language). FontLoader builds them as FontFaces (`aliasSpecs`) and rebuilds them
 * when --px changes.
 */
export const ALIAS = Object.freeze({ head: 'Lu J Head', name: 'Lu J Name', body: 'Lu J Body', line: 'Lu J Line', small: 'Lu J Small', val: 'Lu J Val' });
/**
 * The pixel glyphs' aliases in the CJK stacks, after the Jersey aliases: the glyph face of the
 * alias's Jersey grid with the alias's size-adjust (FontLoader builds them with the aliases).
 */
export const GLYPH_ALIAS = Object.freeze({ head: 'Lu G Head', name: 'Lu G Name', body: 'Lu G Body', line: 'Lu G Line', small: 'Lu G Small', val: 'Lu G Val' });
/** The aliases' characters (CSS unicode-range): ASCII, ·, ×, and the Latin-1 and Œ œ letters (a full-width é in a CJK line otherwise). */
export const ALIAS_RANGE = 'U+0020-007E, U+00B7, U+00D7, U+00C0-00D6, U+00D8-00F6, U+00F8-00FF, U+0152-0153';
/**
 * The Jersey face each alias draws from and its own pixel size there: [family, em, unit] —
 * head Jersey 15 at 27 art px, name and body Jersey 15 at 27 font px, line, small and val Jersey 10
 * at 18⅔ font px.
 * @type {Readonly<Record<keyof typeof ALIAS, [string, number, 'px'|'fpx']>>}
 */
const ALIAS_SRC = Object.freeze({
  head: ['Jersey 15', 27, 'px'], name: ['Jersey 15', 27, 'fpx'], body: ['Jersey 15', 27, 'fpx'],
  line: ['Jersey 10', 56 / 3, 'fpx'], small: ['Jersey 10', 56 / 3, 'fpx'], val: ['Jersey 10', 56 / 3, 'fpx'],
});
/** The Jersey faces' grids: em and cap height in font pixels (the files' 1350 / 50 and 1400 / 75 units). */
const JERSEY = Object.freeze({ 'Jersey 15': { em: 27, cap: 15 }, 'Jersey 10': { em: 56 / 3, cap: 10 } });

/*
 * Japanese and Chinese, in art px (CSS px ÷ 2 at --px 2). `mid` and `ink` are measured from the
 * rendered 回 (G: a pixel scan of each role at --px 2, alpha above 40 / 255). The small roles are
 * Noto Sans JP in real weights (no bitmap bold on small kanji: it fills 離 in). DotGothic16 (the
 * heading, names and dialogue) only on its 16-dot grid (`rolesAt`): the heading at 16 art px is
 * always on it; names and dialogue are 12 art px in G, 24 px at --px 2 — 1.5 pixels per dot, where
 * the dakuten close up (バ reads パ, ブ loses its marks) — so they are DotGothic16 only at an
 * on-grid size near G's and Noto Sans JP (`JA_NOTO`) elsewhere. The bitmap bold is a half dot
 * (--fpx) on the heading and none on the names: a whole-dot copy fills the one-dot gap of ゛.
 * Chinese: Noto Sans SC throughout, weight carrying the hierarchy (900 the heading, 700 names and
 * labels, 500 the text).
 */
const DOT = (role) => `"${ALIAS[role]}", "${GLYPH_ALIAS[role]}", DotGothic16, sans-serif`;
const JP = (role) => `"${ALIAS[role]}", "${GLYPH_ALIAS[role]}", "Noto Sans JP", sans-serif`;
/** @type {Record<'head'|'name'|'body'|'line'|'small'|'val', Role>} */
const JA = {
  head: { family: DOT('head'), w: 400, u: 'px', ou: 'px', em: 16, L: 20, mid: 11.75, ink: 14.5, fx: 'soft', bold: 'var(--fpx)', cjk: true },
  name: { family: DOT('name'), w: 400, u: 'px', ou: 'px', em: 12, L: 14, mid: 6.5, ink: 11, fx: 'soft', cjk: true },
  body: { family: DOT('body'), w: 400, u: 'px', ou: 'px', em: 12, L: 14, mid: 6.5, ink: 11, fx: 'soft', cjk: true },
  line: { family: JP('line'), w: 500, u: 'px', ou: 'fpx', em: 7, L: 10, mid: 5, ink: 7, fx: 'aa', cjk: true },
  small: { family: JP('small'), w: 700, u: 'px', ou: 'fpx', em: 7, L: 9, mid: 4.5, ink: 7, fx: 'aa', cjk: true },
  val: { family: JP('val'), w: 700, u: 'px', ou: 'fpx', em: 8, L: 10, mid: 4.75, ink: 7.5, fx: 'aa', cjk: true },
};
const SC = (role) => `"${ALIAS[role]}", "${GLYPH_ALIAS[role]}", "Noto Sans SC", sans-serif`;
/** @type {Record<'head'|'name'|'body'|'line'|'small'|'val', Role>} */
const ZH = {
  head: { family: SC('head'), w: 900, u: 'px', ou: 'px', em: 18, L: 20, mid: 11, ink: 17, fx: 'soft', cjk: true },
  name: { family: SC('name'), w: 700, u: 'px', ou: 'px', em: 13, L: 14, mid: 5.75, ink: 12.5, fx: 'soft', cjk: true },
  body: { family: SC('body'), w: 500, u: 'px', ou: 'px', em: 11, L: 16, mid: 7.5, ink: 10, fx: 'soft', cjk: true },
  line: { family: SC('line'), w: 500, u: 'px', ou: 'fpx', em: 7, L: 10, mid: 5, ink: 7, fx: 'aa', cjk: true },
  small: { family: SC('small'), w: 700, u: 'px', ou: 'fpx', em: 7, L: 9, mid: 4.5, ink: 7, fx: 'aa', cjk: true },
  val: { family: SC('val'), w: 700, u: 'px', ou: 'fpx', em: 8, L: 10, mid: 4.75, ink: 7.5, fx: 'aa', cjk: true },
};

/**
 * The Japanese names and dialogue where DotGothic16 has no on-grid size near G's (--px 2): Noto
 * Sans JP at G's size, 700 the names, 500 the text. `ink` is 回's (a pixel scan at 24 px: 23 and 22
 * px); `mid` keeps the ink where DotGothic16's sat in G's layout (in a 28 px line box its 回 is
 * 0.5 px lower than Noto 700's and 1 px lower than Noto 500's: G's 6.5 becomes 6.25 and 6).
 * @type {Record<'name'|'body', Role>}
 */
const JA_NOTO = {
  name: { family: JP('name'), w: 700, u: 'px', ou: 'px', em: 12, L: 14, mid: 6.25, ink: 11.5, fx: 'soft', cjk: true },
  body: { family: JP('body'), w: 500, u: 'px', ou: 'px', em: 12, L: 14, mid: 6, ink: 11, fx: 'soft', cjk: true },
};

/** The type table per language (G's TYPE at --px 2; `rolesAt` gives the roles in use at a scale): the language's roles and the shared ones. */
export const TYPE = Object.freeze({
  en: Object.freeze({ ...EN, ...SHARED }),
  ja: Object.freeze({ ...JA, ...SHARED }),
  zh: Object.freeze({ ...ZH, ...SHARED }),
});
/** The roles per language (the contract's name for G's TYPE; docs/specs/PIXEL_UI.md §2). */
export const ROLES_BY_LANG = TYPE;
/** The English roles: layouts are written for them (txt() moves another language onto their centre lines). */
const REF = TYPE.en;

/** DotGothic16's grid: its dots are whole device pixels at a multiple of 16 device px. */
const DOT_GRID = 16;
/** How far an on-grid DotGothic16 size may be from the role's own (|ln ratio|; 32 for 36 at --px 3 is 0.118). */
const DOT_TOL = 0.125;

/**
 * The roles of a language at a scale (`px` device px per art px): G's table, with the Japanese
 * names and dialogue on DotGothic16's grid — at the multiple of 16 device px nearest G's size when
 * it is within `DOT_TOL` in proportion (32 px at --px 3, 48 at 4, 64 at 5, 80 at 6: `em` that over
 * px, the line box kept, `mid` and `ink` following the size), else Noto Sans JP at G's size
 * (`JA_NOTO`: --px 2).
 * @param {string} language 'en' | 'ja' | 'zh'
 * @param {number} px
 * @returns {Readonly<Record<RoleId, Role>>}
 */
export function rolesAt(language, px) {
  const l = Object.prototype.hasOwnProperty.call(TYPE, language) ? language : 'en';
  const base = TYPE[l];
  if (l !== 'ja') return base;
  const P = Math.max(1, Math.round(px));
  /** @type {Record<string, Role>} */
  const out = { ...base };
  for (const id of /** @type {const} */ (['name', 'body'])) {
    const f = base[id];
    const want = f.em * P;
    let k = Math.max(1, Math.round(want / DOT_GRID));
    for (const c of [k - 1, k + 1]) if (c >= 1 && Math.abs(Math.log((c * DOT_GRID) / want)) < Math.abs(Math.log((k * DOT_GRID) / want))) k = c;
    const r = (k * DOT_GRID) / want;
    if (Math.abs(Math.log(r)) <= DOT_TOL) {
      out[id] = r === 1 ? f : { ...f, em: f.em * r, mid: f.L / 2 + (f.mid - f.L / 2) * r, ink: f.ink * r };
    } else out[id] = JA_NOTO[id];
  }
  return Object.freeze(/** @type {Record<RoleId, Role>} */ (out));
}

/** @type {Readonly<Record<string, Role>>} */
let ROLES = TYPE.en;
let LANG = 'en';
/** Device px per art px (UI.js sets it from the root's scale). */
let PX = 2;
/**
 * The roles in art px for the current language and --px: `size`, `L` (line pitch), `unit` (art px
 * per font unit), `cjk`. Kept current by every function here; read it after the UI root exists.
 * @type {Record<RoleId, RoleMetrics>}
 */
export const FONT = /** @type {any} */ ({});
/** Art px per --fpx (½ at --px 2 and 4, ⅔ at 3, ⅗ at 5: `fpxFor(px) / px`). */
export let HALF = 0.5;

function refresh() {
  for (const [id, f] of Object.entries(ROLES)) {
    const u = f.u === 'fpx' ? HALF : 1;
    FONT[id] = { ...f, unit: u, size: f.em * u, L: f.L * u, cjk: !!f.cjk };
  }
}

/** Follow the page's language (set once at boot; cheap when unchanged). */
function sync() {
  const l = getLang();
  if (l !== LANG || !FONT.body) {
    LANG = Object.prototype.hasOwnProperty.call(TYPE, l) ? l : 'en';
    ROLES = rolesAt(LANG, PX);
    refresh();
  }
}

/**
 * Set the scale: device px per art px (UI.js, on every scale change; G's `setPx`). The half-size
 * roles' art size follows (HALF = fpxFor(px) / px = ⌈px / 2⌉ / px), and so do the roles with a
 * grid of their own (`rolesAt`).
 * @param {number} [px]
 */
export function setPx(px = 2) {
  PX = Math.max(1, Math.round(px));
  HALF = fpxFor(PX) / PX;
  LANG = '';
  sync();
}
/** The scale the type follows (device px per art px). */
export const typePx = () => PX;
/** The roles in use: the page's language at the type's scale (`rolesAt(lang(), typePx())`). */
export const roles = () => { sync(); return /** @type {Readonly<Record<RoleId, Role>>} */ (ROLES); };

/** The type's language ('en' | 'ja' | 'zh'): the page's. */
export const lang = () => { sync(); return LANG; };
/** True when the page's language breaks lines between characters (Japanese, Chinese). */
export const cjk = () => isCJK(getLang());
/** Today's names and headings are capitals in English; CJK has no case. @param {unknown} s */
export const UP = (s) => (cjk() ? String(s) : String(s).toUpperCase());
/** G's name style: the name role with one art px of tracking (English). */
export const NAME = Object.freeze({ font: /** @type {RoleId} */ ('name'), track: 1 });

/** @param {Role} f */
const midOf = (f) => f.mid * (f.u === 'fpx' ? 0.5 : 1);
/**
 * Where a role's cap (ink) centre sits below its line box top, in art px of the --px 2 layout, in
 * English. Callers centre text on a point with y = point - capMid(font); txt() lands the other
 * languages' ink centre on the same point.
 * @param {RoleId} font
 */
export const capMid = (font) => midOf(REF[font]);
/**
 * A role's ink height (cap height; 回 for CJK) in art px at --px 2, in the page's language.
 * @param {RoleId} font
 */
export const inkH = (font) => { sync(); return ROLES[font].ink * (ROLES[font].u === 'fpx' ? 0.5 : 1); };
/**
 * How much taller a role's ink is than in English (0 in English): a CJK glyph fills its em where a
 * Latin capital fills about half of it, so plates and rows sized round English capitals grow by it.
 * @param {RoleId} font
 */
export const grow = (font) => Math.max(0, inkH(font) - REF[font].ink * (REF[font].u === 'fpx' ? 0.5 : 1));

/** @type {CanvasRenderingContext2D|null} */
let mctx = null;
/** @param {Role} f @param {number} [scale] */
const cssFont = (f, scale = 8) => `${f.w} ${f.em * scale}px ${f.family}`;
/**
 * A tracking's art px in a role: `track` is art px of the --px 2 layout, so a half-size role's is
 * `track` × 2 of its own font pixels (`trackCss`) — ⅔ of a font pixel more per art px at --px 3,
 * where the role's letters are ⅔ larger too; 0 for CJK text (set solid).
 * @param {RoleId} font
 * @param {number} track
 */
export const trackArt = (font, track) => {
  sync();
  const f = ROLES[font];
  if (f.cjk || !track) return 0;
  return f.u === 'fpx' ? track * 2 * HALF : track;
};
/**
 * A tracking as CSS: `letter-spacing` for `track` art px of the --px 2 layout in a role (in the
 * role's own unit, so its pixels stay whole: `calc(var(--fpx) * 2·track)` for a half-size role).
 * @param {RoleId} font
 * @param {number} track
 */
export const trackCss = (font, track) => {
  sync();
  const f = ROLES[font];
  if (f.cjk || !track) return '0';
  return f.u === 'fpx' ? `calc(var(--fpx) * ${track * 2})` : U(track);
};

/**
 * The advance width of a string in art px, rounded up (with `track` art px of the --px 2 layout
 * between letters, in the role's own unit — `trackArt`; English only: CJK text is set solid). `{`
 * and `}` (the keyword markup) are not counted.
 * @param {unknown} str
 * @param {RoleId} [font]
 * @param {number} [track]
 */
export function measure(str, font = 'body', track = 0) {
  sync();
  const f = ROLES[font];
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = cssFont(f);
  if ('fontKerning' in mctx) mctx.fontKerning = 'none';
  const s = String(str).replace(/[{}]/g, '');
  const tk = trackArt(font, track) * Math.max(0, [...s].length - 1);
  // CJK text set apart by textHtml — adjacent full-width marks (`.halt`, with Chrome's own
  // spacing trim, which canvas text knows nothing of), a Chinese middle dot in the CJK face
  // (`.cjkdot`) — is measured as it is set (`setWidth`); everything else on the canvas
  const w = f.cjk && (PUNCT_PAIR_T.test(s) || (LANG === 'zh' && CJK_DOT.test(s))) ? setWidth(f, s) : mctx.measureText(s).width;
  return Math.ceil(Math.ceil(w / 8) * FONT[font].unit + tk - 1e-9);
}

/**
 * `str` cut with an ellipsis to fit `maxW` art px.
 * @param {unknown} str
 * @param {RoleId} font
 * @param {number} maxW
 * @param {number} [track]
 */
export function fit(str, font, maxW, track = 0) {
  if (measure(str, font, track) <= maxW) return String(str);
  let s = [...String(str)];
  while (s.length > 1 && measure(`${s.join('').trimEnd()}…`, font, track) > maxW) s = s.slice(0, -1);
  return `${s.join('').trimEnd()}…`;
}

/**
 * The role's font as a canvas / FontFace shorthand at `px` CSS px (for a logo drawn from it).
 * @param {RoleId} font
 * @param {number} px
 */
export const fontAt = (font, px) => { sync(); return `${ROLES[font].w} ${px}px ${ROLES[font].family}`; };

/**
 * The CSS font shorthands of every role of the page's language at 16 px (FontLoader.ensure loads
 * a new string's slices in each).
 */
export const roleFonts = () => { sync(); return [...new Set(Object.values(ROLES).map((f) => cssFont(f, 16 / f.em)))]; };

/**
 * A Jersey alias at a scale.
 * @typedef {object} AliasSpec
 * @property {string} family the alias family ("Lu J Body" …)
 * @property {string} glyphs its pixel glyphs' alias family ("Lu G Body" …: `GLYPH_ALIAS`)
 * @property {string} source the Jersey face it draws from ('Jersey 15' | 'Jersey 10')
 * @property {number} k device px per font pixel of that face
 * @property {number} size the Jersey face's CSS size in device px (its em × k: 27·k or 18⅔·k)
 * @property {number} sizeAdjust that size over the CJK role's own size in device px
 * @property {string} role
 */
/**
 * The Jersey aliases a language needs at a scale: each alias family, the Jersey face it draws
 * from at a whole number `k` of device px per font pixel, and its size-adjust (that size over the
 * CJK role's). At --px 2 they are G's: the heading Jersey 15 at 2 px per font pixel (27·2 / (16·2)
 * = 168.75 %), names and dialogue Jersey 15 at 1, the lines Jersey 10 at 1. At another scale each
 * takes the Jersey cap (15·k or 10·k device px) nearest to G's proportion of the role's CJK ink —
 * G's cap ÷ G's ink × the role's ink there: --px 4 G's own faces at twice the size; --px 3 names
 * and dialogue Jersey 10 at 2 (cap 20 against G's 22.5) and the lines Jersey 15 at 1 (cap 15, G's
 * exactly), the heading Jersey 15 at 3. A tie goes to G's face. Empty for English (it needs none).
 * @param {string} language 'en' | 'ja' | 'zh'
 * @param {number} px device px per art px
 * @returns {AliasSpec[]}
 */
export function aliasSpecs(language, px) {
  if (language !== 'ja' && language !== 'zh') return [];
  const P = Math.max(1, Math.round(px));
  const g = TYPE[language], now = rolesAt(language, P);
  return Object.entries(ALIAS).map(([role, family]) => {
    const [gSource, , unit] = ALIAS_SRC[role];
    // G's cap (device px at --px 2) over G's CJK ink there, applied to the role's ink at this scale
    const gCap = JERSEY[gSource].cap * (unit === 'px' ? 2 : 1);
    const gInk = g[role].ink * 2;
    const cj = now[role];
    const want = (gCap / gInk) * cj.ink * P;
    let best = { source: gSource, k: Math.max(1, Math.round(want / JERSEY[gSource].cap)), d: Infinity };
    for (const source of [gSource, ...Object.keys(JERSEY).filter((n) => n !== gSource)]) {
      for (let k = 1; k <= 16; k++) {
        const d = Math.abs(Math.log((JERSEY[source].cap * k) / want));
        if (d < best.d - 1e-9) best = { source, k, d };
      }
    }
    const size = JERSEY[best.source].em * best.k;
    const own = cj.em * P;
    return { family, glyphs: GLYPH_ALIAS[role], source: best.source, k: best.k, size, sizeAdjust: size / own, role };
  });
}

/**
 * The font stacks of the language's roles at the type's scale as CSS custom properties, for CSS
 * that sets text outside `txt()` (UI.js writes them on the root on every scale change): `--lu-font`
 * / `--lu-font-w` the body role (the root's own font: ui.css), `--lu-font-name` / `--lu-font-line`
 * / `--lu-font-num` / `--lu-font-tiny` (+ `-w`) those roles, and the plain faces with their pixel
 * glyphs `--lu-font-j15`, `--lu-font-j10`, `--lu-font-t5` (Latin text in any language, sized by
 * the caller on its grid: Jersey 15 at 27·n px, Jersey 10 at 18⅔·n, Tiny5 at 8·n).
 * @returns {Record<string, string>}
 */
export function fontTokens() {
  sync();
  /** @type {Record<string, string>} */
  const out = { '--lu-font-j15': J15, '--lu-font-j10': J10, '--lu-font-t5': T5 };
  for (const [id, name] of /** @type {const} */ ([['body', ''], ['name', '-name'], ['line', '-line'], ['num', '-num'], ['tiny', '-tiny']])) {
    out[`--lu-font${name}`] = ROLES[id].family;
    out[`--lu-font${name}-w`] = String(ROLES[id].w);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// DOM text
// ---------------------------------------------------------------------------------------------

/** A group's place in the 640 × 360 frame (`group()`): its children are placed relative to it. */
const ORIGINS = new WeakMap();
/**
 * The frame position a parent's children are measured from ([0, 0] for anything but a group).
 * @param {Element} parent
 * @returns {[number, number]}
 */
export const originOf = (parent) => ORIGINS.get(parent) ?? [0, 0];
/**
 * Set a parent's frame position (layout.js `group()`).
 * @param {Element} el
 * @param {[number, number]} o
 */
export const setOrigin = (el, o) => { ORIGINS.set(el, o); };

/** n art pixels as CSS. @param {number} n */
const U = (n) => `calc(var(--px) * ${n})`;
/**
 * n art px as CSS, rounded to a whole device pixel (text positions: half an art px is 1.5 px at
 * --px 3); `--lu-dpx` is one device pixel in CSS px (the root sets it).
 * @param {number} n
 */
const UR = (n) => `round(nearest, calc(var(--px) * ${n}), var(--lu-dpx, 1px))`;

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
/**
 * Adjacent full-width punctuation set as a pair (、「 one em, ”。 one and a half): the first mark of
 * a closing + any pair in half width (the font's `halt`). Chrome's default text-spacing-trim does
 * part of it in Japanese and nothing in Chinese; with this both close the hole.
 */
const PUNCT_PAIR = /([、。，．：；！？」』）】〕〉》”’])(?=[、。，．：；！？」』）】〕〉》”’「『（【〔〈《“‘])/g;
/** The same, non-global (a test). */
const PUNCT_PAIR_T = new RegExp(PUNCT_PAIR.source);
/** What a mark set as a pair gives back where the text cannot be set (no measure host): half its em. */
const HALT = 0.5;
/** CJK texts measured as set, by role font and text (`setWidth`; the newest `SET_MAX` kept). @type {Map<string, number>} */
const SET_W = new Map();
const SET_MAX = 512;
let setWatch = false;
/**
 * The width of a CJK text as `textHtml` sets it, in px at the canvas size `measure` uses (em × 8):
 * laid out once in the measure host and kept — what the marks give back differs by face and mark
 * (DotGothic16's `halt` halves none, Noto Sans JP and SC not all of them, and Chrome trims some
 * pairs itself). Forgotten when fonts load (a face not in yet measures its fallback). Without a
 * measure host: the canvas width less half an em per pair, the dots in the CJK face.
 * @param {Role} f
 * @param {string} s the text (no `{}` markup)
 */
function setWidth(f, s) {
  const font = cssFont(f);
  const key = `${font}|${s}`;
  const known = SET_W.get(key);
  if (known !== undefined) return known;
  if (!HOST?.isConnected) {
    let w = 0, rest = s;
    if (LANG === 'zh') {
      mctx.font = `${f.w} ${f.em * 8}px ${ZH_DOT_FACE}`;
      w += (s.match(CJK_DOT_G)?.length ?? 0) * mctx.measureText('·').width;
      rest = s.replace(CJK_DOT_G, '');
      mctx.font = font;
    }
    return w + mctx.measureText(rest).width - (rest.match(PUNCT_PAIR)?.length ?? 0) * f.em * 8 * HALT;
  }
  if (!setWatch && typeof document.fonts?.addEventListener === 'function') {
    setWatch = true;
    document.fonts.addEventListener('loadingdone', () => SET_W.clear());
  }
  const sp = document.createElement('div');
  sp.className = 'tx cjk';
  // (the longhands, as styleText sets them: the font shorthand would reset font-kerning)
  sp.style.cssText = 'position:absolute;left:0;top:0;white-space:pre;font-kerning:none;letter-spacing:0;';
  sp.style.fontFamily = f.family;
  sp.style.fontWeight = String(f.w);
  sp.style.fontSize = `${f.em * 8}px`;
  let html = esc(s).replace(PUNCT_PAIR, '<span class="halt">$1</span>');
  if (LANG === 'zh') html = html.replace(CJK_DOT_G, '<span class="cjkdot">·</span>');
  sp.innerHTML = html;
  HOST.append(sp);
  const w = sp.getBoundingClientRect().width;
  sp.remove();
  SET_W.set(key, w);
  if (SET_W.size > SET_MAX) SET_W.delete(/** @type {string} */ (SET_W.keys().next().value));
  return w;
}
/**
 * A middle dot between two CJK characters (烬心·远古熔岩魔像): in Chinese set in the CJK face
 * (`.cjkdot`, base.css), not as the Jersey alias's tiny dot (U+00B7 is in `ALIAS_RANGE` for "Lv 5 · HP").
 */
const CJK_CHAR = '[\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}]';
const CJK_DOT = new RegExp(`(?<=${CJK_CHAR})·(?=${CJK_CHAR})`, 'u');
const CJK_DOT_G = new RegExp(CJK_DOT.source, 'gu');
/** The same two at one place (sticky: `cjkCharClass`). */
const CJK_DOT_Y = new RegExp(CJK_DOT.source, 'uy');
const PUNCT_PAIR_Y = new RegExp(PUNCT_PAIR.source, 'y');
/** The face `.cjkdot` sets the Chinese middle dot in (base.css; `measure` measures it there). */
const ZH_DOT_FACE = '"Noto Sans SC", sans-serif';

/**
 * A CSS length of n units of --px or --fpx (plus a bitmap bold's extra pixel).
 * @param {number} n
 * @param {'px'|'fpx'} u
 * @param {string|null} [plus]
 */
const len = (n, u, plus = null) => {
  if (!plus) return n === 0 ? '0' : `calc(var(--${u}) * ${n})`;
  return n === 0 ? plus : `calc(var(--${u}) * ${n} + ${plus})`;
};

/**
 * The text-shadow options of `txt`.
 * @typedef {object} ShadowOptions
 * @property {boolean} [ol] an ink outline (four ways; with `drop` a drop under it)
 * @property {boolean} [drop] alone: a one-unit drop
 * @property {boolean} [ol8] today's number outline (eight ways and a drop, one art px, --g-nol)
 * @property {boolean} [olx] the same without the drop (a number over an icon)
 */

/**
 * The hard text-shadows of a text element (see ShadowOptions). A bitmap bold (Japanese headings
 * and names) is a copy of the text one pixel to the right, and every ink offset is doubled at that
 * pixel so the outline follows the wider strokes.
 * @param {ShadowOptions} o
 * @param {Role} f
 * @returns {string}
 */
export function shadow(o, f) {
  let u = f.ou, col = 'var(--g-ink0)', offs = [];
  const four = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const eight = [...four, [1, 1], [-1, 1], [1, -1], [-1, -1]];
  if (o.ol8) { u = 'px'; col = 'var(--g-nol)'; offs = [...eight, [0, 2], [1, 2], [-1, 2]]; }
  else if (o.olx) { u = 'px'; col = 'var(--g-nol)'; offs = eight; }
  else if (o.ol) {
    offs = [...four];
    if (o.drop) { offs.push([0, 2]); if (u === 'fpx') offs.push([1, 1], [-1, 1]); }
  } else if (o.drop) offs = [[0, 1]];
  const parts = [];
  const b = f.bold;
  if (b) parts.push(`${b} 0 0 currentColor`);
  const seen = new Set();
  for (const [dx, dy] of offs) {
    for (const plus of b ? [null, b] : [null]) {
      const key = `${dx},${dy},${plus}`;
      if (seen.has(key) || (plus && dx === 0 && dy === 0)) continue;
      seen.add(key);
      parts.push(`${len(dx, u, plus)} ${len(dy, u)} 0 ${col}`);
    }
  }
  return parts.join(', ');
}

/**
 * The options of `txt`.
 * @typedef {ShadowOptions & {
 *   font?: RoleId, color?: string, kw?: string, track?: number,
 *   align?: 'left'|'right'|'center', maxW?: number|null, lineH?: number|null, cls?: string,
 * }} TextOptions
 *   font the role ('body'); color; kw the keyword colour for `{…}` markup; track letter spacing in
 *   art px of the --px 2 layout, in the role's own unit (`trackArt`; English only: CJK text is set
 *   solid); align: x is then the right edge / the middle; maxW
 *   wraps to that width (left aligned; CJK by the strict line-break rules); lineH a taller line box
 *   (art px at --px 2); cls extra classes
 */
/**
 * A text element from `txt`: `tw` its width (art px: the measured advance, or maxW), `lines` its
 * line count, `lh` the line pitch (art px).
 * @typedef {HTMLDivElement & { tw: number, lines: number, lh: number }} TextEl
 */

/**
 * A text's HTML in a role: escaped, the keyword markup `{word}` as `.kw` spans, and in Japanese and
 * Chinese adjacent full-width punctuation set as a pair (`.halt`) — in Chinese also a middle dot
 * between two characters in the CJK face (`.cjkdot`: 烬心·远古). For an element a component keeps
 * and refills (a pooled label, the dialogue's typewriter): `el.innerHTML = textHtml(text, role)`.
 * @param {unknown} text
 * @param {RoleId} [font]
 * @returns {string}
 */
export function textHtml(text, font = 'body') {
  sync();
  let html = esc(text);
  if (ROLES[font].cjk) {
    html = html.replace(PUNCT_PAIR, '<span class="halt">$1</span>');
    if (LANG === 'zh') html = html.replace(CJK_DOT_G, '<span class="cjkdot">·</span>');
  }
  return html.replace(/\{([^}]*)\}/g, '<span class="kw">$1</span>');
}

/**
 * The class a character of a CJK role's text takes where `textHtml` sets it apart (DialogBox
 * builds its own per-character spans: it adds this to the character's span): 'halt' for the first
 * mark of a full-width pair, 'cjkdot' for a Chinese middle dot between two characters, '' otherwise.
 * @param {string} text the whole text (without the `{}` markup)
 * @param {number} i the character's index in `text` (UTF-16)
 * @param {RoleId} [font]
 * @returns {''|'halt'|'cjkdot'}
 */
export function cjkCharClass(text, i, font = 'body') {
  sync();
  if (!ROLES[font].cjk) return '';
  const s = String(text);
  if (s[i] === '·') {
    if (LANG !== 'zh') return '';
    CJK_DOT_Y.lastIndex = i;
    return CJK_DOT_Y.test(s) ? 'cjkdot' : '';
  }
  PUNCT_PAIR_Y.lastIndex = i;
  return PUNCT_PAIR_Y.test(s) ? 'halt' : '';
}

/** The classes styleText() manages (the rest of an element's class list is left alone). */
const TEXT_CLASSES = ['fx-crisp', 'fx-soft', 'fx-aa', 'cjk', 'wrap'];

/**
 * Style an element as text in a role (what `txt` does to its element, without the text and the
 * position): the classes `g tx fx-<filter>` (+ `cjk`, `wrap` with o.maxW, o.cls) — other classes
 * stay —, and inline the font, size, line height, shadow, colour, keyword colour, tracking and
 * (o.maxW) width. Every property it manages is written, or cleared where `o` has none, so a pooled
 * element can change role or options. Returns the text's width in art px: o.maxW, else the
 * measured advance of `text` (0 without it).
 * @param {HTMLElement} el
 * @param {RoleId} [font]
 * @param {TextOptions} [o] (font, align and the position are not read)
 * @param {unknown} [text] the text, for the width returned
 * @returns {number}
 */
export function styleText(el, font = 'body', o = {}, text = undefined) {
  sync();
  const f = ROLES[font];
  const c = el.classList;
  c.add('g', 'tx');
  c.remove(...TEXT_CLASSES);
  c.add(`fx-${f.fx}`);
  if (f.cjk) c.add('cjk');
  if (o.maxW) c.add('wrap');
  if (o.cls) c.add(...o.cls.split(' ').filter(Boolean));
  const s = el.style;
  s.fontFamily = f.family;
  s.fontWeight = String(f.w);
  s.fontSize = `calc(var(--${f.u}) * ${f.em})`;
  s.lineHeight = `calc(var(--${f.u}) * ${f.L})`;
  if (o.lineH) s.lineHeight = f.u === 'fpx' ? `calc(var(--fpx) * ${o.lineH * 2})` : U(o.lineH);
  const sh = shadow(o, f);
  if (sh) s.textShadow = sh; else s.removeProperty('text-shadow');
  if (o.color) s.color = o.color; else s.removeProperty('color');
  if (o.kw) s.setProperty('--g-kw', o.kw); else s.removeProperty('--g-kw');
  const track = f.cjk ? 0 : (o.track ?? 0);
  if (track) s.letterSpacing = trackCss(font, track); else s.removeProperty('letter-spacing');
  // (letter-spacing follows the last letter too: a wrapped box is that much wider)
  if (o.maxW) s.width = track ? `calc(${U(o.maxW)} + ${trackCss(font, track)})` : U(o.maxW); else s.removeProperty('width');
  return o.maxW ?? (text === undefined ? 0 : measure(text, font, track));
}

/**
 * The line count of a wrapped text element as laid out — counted on a copy in the measure host when
 * the element is not rendered (not in the page yet, or inside a component hidden with display:none,
 * where its height is 0).
 * @param {HTMLElement} d
 */
function linesOf(d) {
  let el = d;
  /** @type {HTMLElement|null} */
  let copy = null;
  if (!d.isConnected || d.getClientRects().length === 0) {
    if (!HOST?.isConnected) return 1;
    copy = /** @type {HTMLElement} */ (d.cloneNode(true));
    HOST.append(copy);
    el = copy;
  }
  // (layout pixels: offsetHeight ignores a group's shrink)
  const n = Math.max(1, Math.round(el.offsetHeight / parseFloat(getComputedStyle(el).lineHeight)));
  copy?.remove();
  return n;
}

/**
 * DOM text whose line box starts at (x, y) art px in the --px 2 English layout (the English cap top
 * REF[font] below y), appended to `parent`. Another language's ink centre is moved onto the English
 * one; a half-size font at another --px (a third of an art px per font pixel at 3) is moved so that
 * its cap centre stays where it is at --px 2: the rows keep their centre lines. `{word}` in the text
 * is the keyword markup (`.kw`). The element carries the classes `g tx fx-<filter>` (+ `cjk`,
 * `wrap`, o.cls) and inline font, size, line height, shadow and position (`textHtml` and
 * `styleText` are its two halves, for an element a component keeps). Its `lines` is right also
 * inside a component hidden with display:none (counted in the measure host).
 * @param {Element} parent
 * @param {unknown} text
 * @param {number} x
 * @param {number} y
 * @param {TextOptions} [o]
 * @returns {TextEl}
 */
export function txt(parent, text, x, y, o = {}) {
  sync();
  const font = o.font ?? 'body';
  const f = ROLES[font], F = FONT[font];
  const d = /** @type {TextEl} */ (document.createElement('div'));
  d.innerHTML = textHtml(text, font);
  const w = styleText(d, font, o, text);
  const s = d.style;
  let left = x;
  if (o.align === 'right') left = x - w;
  else if (o.align === 'center') left = x - Math.floor(w / 2);
  const [ox, oy] = originOf(parent);
  // the ink centre: the English role's at --px 2 (another language's role lands on it)
  const ref = REF[font] ?? f;
  let dy = midOf(ref) - midOf(f);
  // a half-size font keeps its --px 2 cap centre (no shift at --px 2 and 4, where HALF is ½)
  if (f.u === 'fpx') dy += f.mid * (0.5 - HALF);
  s.left = UR(Math.round((left - ox) * 2) / 2);
  s.top = dy ? UR(y + dy - oy) : UR(Math.round((y - oy) * 2) / 2);
  parent.append(d);
  d.tw = w;
  const lh = o.lineH ? (f.u === 'fpx' ? o.lineH * 2 * F.unit : o.lineH) : F.L;
  d.lines = o.maxW ? linesOf(d) : 1;
  d.lh = lh;
  return d;
}

/**
 * Text whose ink is centred on the line cy (art px), in any language.
 * @param {Element} parent
 * @param {unknown} text
 * @param {number} x
 * @param {number} cy
 * @param {TextOptions} [o]
 */
export const txc = (parent, text, x, cy, o = {}) => txt(parent, text, x, cy - capMid(o.font ?? 'body'), o);

/** @type {HTMLElement|null} */
let HOST = null;
/**
 * The measure host (UI.js sets it): an always-laid-out, invisible element of the UI root where
 * `lineCount` lays text out (a component hidden with display:none would measure 0).
 * @param {HTMLElement|null} el
 */
export const setMeasureHost = (el) => { HOST = el; };
/** The measure host (null before a UI root exists). */
export const measureHost = () => HOST;

/**
 * The number of lines `text` takes at `maxW` art px: laid out in the measure host, then removed, so
 * it is right while the component is hidden. `sc` (G's signature) is used only where no UI root's
 * measure host is in the page.
 * @param {Element|null} sc
 * @param {unknown} text
 * @param {RoleId} font
 * @param {number} maxW
 * @param {TextOptions} [o]
 */
export function lineCount(sc, text, font, maxW, o = {}) {
  const host = (HOST?.isConnected ? HOST : null) ?? sc ?? document.body;
  const pr = txt(host, text, 0, 0, { ...o, font, maxW });
  const n = pr.lines;
  pr.remove();
  return n;
}

/**
 * The words of a name (G's `nameParts`): split at spaces and at U+200B, the translators' break
 * hints in Japanese and Chinese.
 * @param {unknown} name
 */
export const nameParts = (name) => String(name).split(/[ ​]/).filter(Boolean);

/**
 * A name broken into lines of at most `maxW` art px (G's `lines`): at spaces in English, at the
 * translator's break hints (U+200B) in Japanese and Chinese, whose pieces join without a space.
 * @param {unknown} text
 * @param {RoleId} font
 * @param {number} maxW
 * @returns {string[]}
 */
export function lines(text, font, maxW) {
  const join = cjk() ? '' : ' ';
  const out = [];
  for (const word of nameParts(text)) {
    const cur = out[out.length - 1];
    if (cur != null && measure(`${cur}${join}${word}`, font) <= maxW) out[out.length - 1] = `${cur}${join}${word}`;
    else out.push(word);
  }
  return out;
}
