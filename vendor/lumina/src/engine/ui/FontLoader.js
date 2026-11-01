/**
 * The UI's fonts (docs/specs/I18N.md §5): Google Fonts first; if that fails, the copies built into
 * `dist/` (the @fontsource packages, emitted by Vite as woff2 files and fetched only then).
 *
 * | Set   | Faces                             | Loaded         |
 * |-------|-----------------------------------|----------------|
 * | latin | Jersey 10, Jersey 15, Tiny5       | always         |
 * | ja    | DotGothic16, Noto Sans JP 500/700 | Japanese only  |
 * | zh    | Noto Sans SC 500/700/900          | Chinese only   |
 *
 * Each set is loaded on its own (one can come from Google and another from dist/):
 * 1. Google: fetch the `css2` stylesheet (2.5 s timeout), insert it as a <style>, probe the set's
 *    faces with `document.fonts.load` (2.5 s timeout).
 * 2. On any failure: remove that <style>, `import()` the set's @fontsource CSS, probe again (8 s).
 *    In mode auto the failure is remembered for a day (`localStorage['luminati.fonts.fail']`): the
 *    next page loads go straight to dist/ instead of waiting for a Google that hangs (a firewall
 *    dropping the packets costs the timeouts on every boot otherwise); after a day Google is tried
 *    again, and a success forgets the failure.
 * 3. Japanese and Chinese: the Jersey aliases at the head of their stacks (layout/type.js ALIAS,
 *    "Lu J Head" …) are FontFaces built from whichever Jersey file loaded — Jersey 15 or Jersey 10
 *    at the whole-pixel size `aliasSpecs` picks for the scale —, size-adjusted for the current
 *    --px, rebuilt when it changes (`setScale`); with each, its pixel glyphs' alias ("Lu G Head" …).
 * 4. Every language: the pixel glyphs (GlyphFont.js: ← ↑ → ↓ ↔ ↕ ↖ ↗ ↘ ↙ ♪, which Jersey lacks),
 *    "Lu Glyph 15" / "Lu Glyph 10" / "Lu Glyph 5", are TrueType fonts generated at run time on the
 *    grids of Jersey 15, Jersey 10 and Tiny5 and added as FontFaces: nothing to download, from
 *    Google or dist/.
 * `ensure(text)` loads the unicode-range slices a new string needs (CJK fonts come in slices)
 * before it is measured; `fontsIn(text, font)` tells whether they are in (`document.fonts.check`
 * cannot: it answers true for a slice still unloaded when the family is installed on the system).
 *
 * Overrides: `?fonts=auto|google|local` (or `localStorage['luminati.fonts']`): auto (Google, then
 * dist/; the only mode that reads and writes the remembered failure), google (Google only), local
 * (dist/ only); for tests `google-fail` (an unreachable Google URL: the fallback runs) and
 * `gstatic-fail` (Google's CSS, unreachable font files: the probe fails and the fallback runs). The
 * check harness passes `--fonts` (default local) and starts every run on a fresh profile.
 */
import { aliasSpecs, ALIAS_RANGE, roleFonts } from './layout/type.js';
import { glyphFontData, GLYPH_FAMILY, GLYPH_RANGE } from './GlyphFont.js';

/** localStorage key of the font-source override. */
export const FONTS_KEY = 'luminati.fonts';
/** localStorage key of a remembered Google failure (mode auto): `{ t: ms since the epoch, why }`. */
export const FONTS_FAIL_KEY = 'luminati.fonts.fail';
/** How long a Google failure is remembered (ms): a day. */
export const FONTS_FAIL_MS = 24 * 60 * 60 * 1000;
/** @typedef {'auto'|'google'|'local'|'google-fail'|'gstatic-fail'} FontMode */
/** The accepted modes. @type {readonly FontMode[]} */
export const FONT_MODES = Object.freeze(['auto', 'google', 'local', 'google-fail', 'gstatic-fail']);
/** Where a set came from. @typedef {'google'|'local'|'none'|'pending'} FontSource */

/** Google's css2 host and the host of its font files (game.html preconnects to both). */
const GOOGLE_CSS = 'https://fonts.googleapis.com/css2';
/**
 * The forced failures' unreachable addresses, Google's paths on the loopback's port 9: the browser
 * refuses it at once (an unsafe port, `net::ERR_UNSAFE_PORT`; nothing listens there either), where
 * a `.invalid` host can hang in a DNS lookup until the timeout on some networks.
 */
const FAIL_CSS = 'https://127.0.0.1:9/css2';
const FAIL_GSTATIC = 'https://127.0.0.1:9/';
/** Timeouts (ms): Google's stylesheet, a set's probe on Google's files, a set's probe on dist/'s. */
const CSS_TIMEOUT = 2500;
const GOOGLE_PROBE_TIMEOUT = 2500;
const LOCAL_PROBE_TIMEOUT = 8000;

/**
 * A font set: its Google css2 query, the local importer (the @fontsource CSS: the Latin faces'
 * latin-400.css, one file each; the full sliced weights for CJK, as Google slices them), and the
 * faces that prove it loaded.
 * @typedef {object} FontSet
 * @property {'latin'|'ja'|'zh'} id
 * @property {string} query the css2 query (`family=…&family=…`)
 * @property {() => Promise<unknown>} local
 * @property {string[]} faces CSS font shorthands of the set's faces (16 px)
 * @property {string} sample characters every face covers
 */

/** @type {Readonly<Record<'latin'|'ja'|'zh', FontSet>>} */
export const FONT_SETS = Object.freeze({
  latin: {
    id: 'latin',
    query: 'family=Jersey+10&family=Jersey+15&family=Tiny5&display=block',
    local: () => Promise.all([
      import('@fontsource/jersey-10/latin-400.css'),
      import('@fontsource/jersey-15/latin-400.css'),
      import('@fontsource/tiny5/latin-400.css'),
    ]),
    faces: ['400 16px "Jersey 10"', '400 16px "Jersey 15"', '400 16px "Tiny5"'],
    sample: 'Aa09',
  },
  ja: {
    id: 'ja',
    query: 'family=DotGothic16&family=Noto+Sans+JP:wght@500;700&display=block',
    local: () => Promise.all([
      import('@fontsource/dotgothic16/400.css'),
      import('@fontsource/noto-sans-jp/500.css'),
      import('@fontsource/noto-sans-jp/700.css'),
    ]),
    faces: ['400 16px "DotGothic16"', '500 16px "Noto Sans JP"', '700 16px "Noto Sans JP"'],
    sample: '回あ',
  },
  zh: {
    id: 'zh',
    query: 'family=Noto+Sans+SC:wght@500;700;900&display=block',
    local: () => Promise.all([
      import('@fontsource/noto-sans-sc/500.css'),
      import('@fontsource/noto-sans-sc/700.css'),
      import('@fontsource/noto-sans-sc/900.css'),
    ]),
    faces: ['500 16px "Noto Sans SC"', '700 16px "Noto Sans SC"', '900 16px "Noto Sans SC"'],
    sample: '回烬',
  },
});

/**
 * What the loader reports (`window.__luminati.fonts` on the game page).
 * @typedef {object} FontReport
 * @property {'en'|'ja'|'zh'} lang
 * @property {FontMode} mode
 * @property {number} px the scale the aliases are built for (device px per art px)
 * @property {{ latin: FontSource, ja?: FontSource, zh?: FontSource }} sources
 * @property {number|null} ms from the start to every set in (null while loading)
 * @property {string|null} googleError the first Google failure ('latin: Failed to fetch' …), else null
 * @property {string|null} remembered mode auto: Google skipped for a failure remembered from an
 *   earlier page load (its reason and age: 'latin: timeout, 3 min ago'), else null
 * @property {string|null} localError a failure of the dist/ copies too, else null
 * @property {Record<string, string>} aliases alias family → its size-adjust ('168.75%' …) and, for a
 *   Jersey alias, its source (`'Jersey 10 ×2, 104.1667%'`); empty in English
 * @property {string[]} glyphs the pixel glyph faces in the page ("Lu Glyph 15" …)
 */

/** The generated glyph fonts, per grid (built once per page). @type {Map<number, ArrayBuffer>} */
const GLYPH_DATA = new Map();
/** @param {15|10|5} id */
const glyphData = (id) => {
  let d = GLYPH_DATA.get(id);
  if (!d) { d = glyphFontData(id); GLYPH_DATA.set(id, d); }
  return d.slice(0);
};
/** The glyph grid of a Jersey alias's source face. @param {string} source */
const gridOf = (source) => (source === 'Jersey 10' ? 10 : 15);

/**
 * The font-source override: `?fonts=` > `localStorage['luminati.fonts']` > 'auto' (unknown values
 * are ignored).
 * @param {{ search?: string, storage?: { getItem(k: string): string|null } | null }} [o] defaults: the page's
 * @returns {FontMode}
 */
export function resolveFontMode({ search, storage } = {}) {
  const ok = (v) => (typeof v === 'string' && FONT_MODES.includes(/** @type {FontMode} */ (v.trim().toLowerCase())) ? /** @type {FontMode} */ (v.trim().toLowerCase()) : null);
  const q = search ?? (typeof location !== 'undefined' ? location.search : '');
  try { const m = ok(new URLSearchParams(q).get('fonts')); if (m) return m; } catch { /* a malformed query */ }
  let st = storage;
  if (st === undefined) { try { st = typeof localStorage !== 'undefined' ? localStorage : null; } catch { st = null; } }
  try { const m = ok(st?.getItem(FONTS_KEY)); if (m) return m; } catch { /* storage off */ }
  return 'auto';
}

/** @returns {Storage|null} the page's localStorage (null where storage is off) */
const storage = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

/**
 * A Google failure remembered from an earlier page load, if younger than `FONTS_FAIL_MS`.
 * @param {number} [now]
 * @returns {{ t: number, why: string }|null}
 */
export function rememberedGoogleFailure(now = Date.now()) {
  try {
    const raw = storage()?.getItem(FONTS_FAIL_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    const t = Number(v?.t);
    if (!Number.isFinite(t) || now - t >= FONTS_FAIL_MS || t > now + 60000) return null;
    return { t, why: String(v?.why ?? 'error').slice(0, 160) };
  } catch { return null; }
}

/**
 * Remember a Google failure (`why`), or forget one (null).
 * @param {string|null} failure
 */
export function rememberGoogleFailure(failure) {
  try {
    const st = storage();
    if (!st) return;
    if (failure === null) st.removeItem(FONTS_FAIL_KEY);
    else st.setItem(FONTS_FAIL_KEY, JSON.stringify({ t: Date.now(), why: failure }));
  } catch { /* storage off or full */ }
}

/** @param {unknown} e */
const why = (e) => {
  const err = /** @type {any} */ (e);
  if (err?.name === 'AbortError') return 'timeout';
  return String(err?.message ?? err ?? 'error').slice(0, 160);
};

/**
 * A promise that rejects after `ms` with `label`.
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<never>}
 */
const timeout = (ms, label) => new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms));

/**
 * Wait for a set's faces: every face must load (a network error rejects) and match something (an
 * empty result means no @font-face of that family is in the page).
 * @param {FontSet} set
 * @param {number} ms the timeout
 */
async function probe(set, ms) {
  const loads = set.faces.map(async (f) => {
    const got = await document.fonts.load(f, set.sample);
    if (!got.length) throw new Error(`no face for ${f}`);
  });
  await Promise.race([Promise.all(loads), timeout(ms, 'probe timeout')]);
}

/**
 * The URL of a family's Latin file among the page's @font-face rules (Google's gstatic URL, the
 * built /assets/… file, or the dev server's node_modules path): the first rule of that family whose
 * unicode-range covers 'A' (or that has none).
 * @param {string} family
 * @returns {string|null}
 */
function latinFileOf(family) {
  const covers = (range) => {
    if (!range) return true;
    for (const part of range.split(',')) {
      const m = part.trim().match(/^u\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i);
      if (!m) continue;
      const lo = parseInt(m[1].replace(/\?/g, '0'), 16), hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, 'f'), 16);
      if (lo <= 0x41 && 0x41 <= hi) return true;
    }
    return false;
  };
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; } // a cross-origin sheet
    for (const rule of Array.from(rules ?? [])) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const fam = rule.style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '');
      if (fam !== family) continue;
      if (!covers(rule.style.getPropertyValue('unicode-range'))) continue;
      const m = rule.style.getPropertyValue('src').match(/url\(\s*(["']?)([^"')]+)\1\s*\)/);
      if (!m) continue;
      try { return new URL(m[2], sheet.href ?? location.href).href; } catch { return m[2]; }
    }
  }
  return null;
}

/** A face's unicode-range as [lo, hi] code point pairs (parsed once per face). @type {WeakMap<FontFace, number[][]>} */
const RANGES = new WeakMap();
/** @param {FontFace} face */
function rangesOf(face) {
  let r = RANGES.get(face);
  if (r) return r;
  r = [];
  for (const part of String(face.unicodeRange || 'U+0-10FFFF').split(',')) {
    const m = part.trim().match(/^u\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i);
    if (!m) continue;
    const lo = parseInt(m[1].replace(/\?/g, '0'), 16);
    const hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, 'f'), 16);
    r.push([lo, hi]);
  }
  RANGES.set(face, r);
  return r;
}
/** @param {FontFace} face @param {number} cp */
const covers = (face, cp) => rangesOf(face).some(([lo, hi]) => lo <= cp && cp <= hi);
/** A face's weight range [lo, hi] ('400', '100 900', 'bold'). @param {FontFace} face */
function weightsOf(face) {
  const w = String(face.weight || '400').trim().split(/\s+/).map((v) => (v === 'bold' ? 700 : v === 'normal' ? 400 : Number(v)));
  const lo = Number.isFinite(w[0]) ? w[0] : 400;
  return [lo, Number.isFinite(w[1]) ? w[1] : lo];
}
/** @param {string} f */
const unquote = (f) => f.trim().replace(/^(["'])(.*)\1$/, '$2');

/** Bumped when the loader swaps faces of its own (the aliases, the glyphs): `fontsIn` re-reads them. */
let facesVersion = 0;
/**
 * The page's faces by family, kept while document.fonts holds the same number of faces and the
 * loader has not swapped any (a stylesheet added or removed changes the count).
 */
let faceIndex = { size: -1, version: -1, /** @type {Map<string, FontFace[]>} */ byFamily: new Map() };
function facesByFamily() {
  const set = document.fonts;
  if (faceIndex.size === set.size && faceIndex.version === facesVersion) return faceIndex.byFamily;
  /** @type {Map<string, FontFace[]>} */
  const byFamily = new Map();
  set.forEach((face) => {
    const fam = unquote(face.family);
    let list = byFamily.get(fam);
    if (!list) byFamily.set(fam, list = []);
    list.push(face);
  });
  faceIndex = { size: set.size, version: facesVersion, byFamily };
  return byFamily;
}

/**
 * Whether the glyphs of `text` in `font` are in: per character, the face the browser draws it
 * with — the first family of the stack with a face of that weight (else the nearest weight) whose
 * unicode-range covers it — has status 'loaded'. A character no family's face covers falls back to
 * the system (nothing to load). Unlike `document.fonts.check`, a slice of a family installed on the
 * system that is still unloaded counts as not in. Without the Font Loading API: true.
 * @param {unknown} text a string, or anything whose JSON holds the strings
 * @param {string} font a CSS font shorthand ('500 16px "Lu J Body", "Noto Sans SC", sans-serif')
 * @returns {boolean}
 */
export function fontsIn(text, font) {
  if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.forEach !== 'function') return true;
  const s = typeof text === 'string' ? text : JSON.stringify(text ?? '');
  const m = String(font).match(/^\s*(?:(?:italic|oblique|normal)\s+)?(?:(\d{1,4}|bold|normal)\s+)?[\d.]+[a-z%]+(?:\s*\/\s*\S+)?\s+(.+)$/i);
  if (!m || !s) return true;
  const weight = m[1] === 'bold' ? 700 : m[1] && m[1] !== 'normal' ? Number(m[1]) : 400;
  const byFamily = facesByFamily();
  /** each family's faces at the weight the browser picks for it */
  const stack = [];
  for (const fam of m[2].split(',').map(unquote)) {
    const all = byFamily.get(fam);
    if (!all?.length) continue;
    let pick = all.filter((f) => { const [lo, hi] = weightsOf(f); return lo <= weight && weight <= hi; });
    if (!pick.length) {
      const dist = (f) => { const [lo, hi] = weightsOf(f); return weight < lo ? lo - weight : weight - hi; };
      const best = Math.min(...all.map(dist));
      pick = all.filter((f) => dist(f) === best);
    }
    stack.push(pick);
  }
  if (!stack.length) return true;
  const seen = new Set();
  for (const ch of s) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (seen.has(cp)) continue;
    seen.add(cp);
    for (const faces of stack) {
      const hit = faces.filter((f) => covers(f, cp));
      if (!hit.length) continue;
      if (!hit.some((f) => f.status === 'loaded')) return false;
      break;
    }
  }
  return true;
}

/**
 * Loads the language's fonts (Google, else dist/) and keeps the CJK stacks' Jersey aliases in step
 * with the scale. One per page: `startFonts()` makes it, `currentFonts()` returns it.
 */
export class FontLoader {
  /**
   * @param {{ lang?: string, mode?: FontMode, px?: number }} [o] lang: 'en' | 'ja' | 'zh' (en);
   *   mode: default `resolveFontMode()`; px: the scale to build the aliases for (2)
   */
  constructor({ lang = 'en', mode = resolveFontMode(), px = 2 } = {}) {
    /** @type {'en'|'ja'|'zh'} */
    this.lang = lang === 'ja' || lang === 'zh' ? lang : 'en';
    /** @type {FontMode} */
    this.mode = FONT_MODES.includes(mode) ? mode : 'auto';
    this._px = Math.max(1, Math.round(px));
    /** The sets this language loads. @type {FontSet[]} */
    this.sets = [FONT_SETS.latin, ...(this.lang === 'en' ? [] : [FONT_SETS[this.lang]])];
    /** @type {FontReport} */
    this.report = {
      lang: this.lang, mode: this.mode, px: this._px,
      sources: /** @type {FontReport['sources']} */ (Object.fromEntries(this.sets.map((s) => [s.id, 'pending']))),
      ms: null, googleError: null, remembered: null, localError: null, aliases: {}, glyphs: [],
    };
    /** Mode auto: skip Google this page load (a failure remembered from an earlier one). */
    this._skipGoogle = false;
    if (this.mode === 'auto') {
      const f = rememberedGoogleFailure();
      if (f) {
        this._skipGoogle = true;
        const min = Math.max(0, Math.round((Date.now() - f.t) / 60000));
        this.report.remembered = `${f.why}, ${min < 120 ? `${min} min` : `${Math.round(min / 60)} h`} ago`;
      }
    }
    /** @type {FontFace[]} the alias faces in document.fonts */
    this._aliases = [];
    /** @type {FontFace[]} the pixel glyph faces in document.fonts (`_addGlyphs`) */
    this._glyphs = [];
    this._aliasJob = Promise.resolve();
    /** @type {Promise<FontReport>|null} */
    this._ready = null;
    /** Every set is in (the aliases can be built). */
    this._setsIn = false;
    /**
     * `ensure`: per font shorthand, the characters asked for and the load that brings them in (each
     * character is loaded once per font).
     * @type {Map<string, Map<string, Promise<unknown>>>}
     */
    this._ensured = new Map();
  }

  /**
   * Start loading (idempotent): every set, then the aliases. Never rejects.
   * @returns {Promise<FontReport>}
   */
  start() {
    if (this._ready) return this._ready;
    const t0 = performance.now();
    this._ready = Promise.all([...this.sets.map((s) => this._loadSet(s)), this._addGlyphs()])
      .then(() => {
        // mode auto: remember a Google failure for the next page loads, forget one on a success
        if (this.mode === 'auto' && !this._skipGoogle) rememberGoogleFailure(this.report.googleError);
        this._setsIn = true;
        return this._queueAliases();
      })
      .catch((e) => { console.warn('[Luminati] fonts:', e); })
      .then(() => {
        this.report.ms = Math.round(performance.now() - t0);
        return this.report;
      });
    return this._ready;
  }

  /** Resolves (never rejects) with the report once every set is in and the aliases are built. */
  get ready() { return this.start(); }

  /** The scale the aliases are built for (device px per art px). */
  get px() { return this._px; }

  /**
   * The UI's scale changed (UI.js): rebuild the Jersey aliases of a CJK language for it.
   * @param {number} px device px per art px
   * @returns {Promise<void>} when the fonts follow `px`: the sets are in and the aliases for it
   *   built (in English, when the sets are in); never rejects
   */
  setScale(px) {
    const p = Math.max(1, Math.round(px));
    // before the sets are in, start() builds the aliases for the latest scale
    if (!this._setsIn) {
      this._px = p;
      this.report.px = p;
      return this.start().then(() => this._aliasJob);
    }
    if (p === this._px) return this._aliasJob;
    this._px = p;
    this.report.px = p;
    return this._queueAliases();
  }

  /**
   * Load the font slices `text` needs in every face the language's type roles use (CJK fonts come
   * in unicode-range slices): one `document.fonts.load` per role font with the characters not asked
   * for in that font before (ASCII never: the Latin faces and the CJK stacks' Jersey aliases are in
   * once `ready` is) — no `document.fonts.check`, which answers true for an unloaded slice of a
   * family installed on the system. Resolves when they are in (a character asked for again waits for
   * its first load). Call it with a new string before measuring it. Never rejects.
   * @param {unknown} text a string, or anything whose JSON holds the strings (an array, a table)
   * @returns {Promise<void>}
   */
  async ensure(text) {
    await this.ready;
    const s = typeof text === 'string' ? text : JSON.stringify(text ?? '');
    if (!s || typeof document === 'undefined' || !document.fonts) return;
    /** the text's characters past ASCII */
    const chars = new Set();
    for (const ch of s) if (/** @type {number} */ (ch.codePointAt(0)) > 0x7e) chars.add(ch);
    if (!chars.size) return;
    const fonts = new Set([...this.sets.flatMap((set) => set.faces), ...roleFonts()]);
    /** @type {Set<Promise<unknown>>} */
    const waits = new Set();
    for (const f of fonts) {
      let known = this._ensured.get(f);
      if (!known) this._ensured.set(f, known = new Map());
      let need = '';
      for (const ch of chars) {
        const p = known.get(ch);
        if (p) waits.add(p);
        else need += ch;
      }
      if (!need) continue;
      /** @type {Promise<unknown>} */
      let job;
      try { job = document.fonts.load(f, need).catch(() => []); } catch { job = Promise.resolve([]); }
      for (const ch of need) known.set(ch, job);
      waits.add(job);
    }
    if (waits.size) await Promise.all(waits);
  }

  /**
   * One set: Google (unless mode 'local'), else the dist/ copies (unless mode 'google').
   * @param {FontSet} set
   */
  async _loadSet(set) {
    const r = this.report;
    if (this.mode !== 'local' && !this._skipGoogle) {
      try {
        await this._viaGoogle(set);
        r.sources[set.id] = 'google';
        return;
      } catch (e) {
        if (!r.googleError) r.googleError = `${set.id}: ${why(e)}`;
        if (this.mode === 'google') { r.sources[set.id] = 'none'; return; }
      }
    }
    try {
      await set.local();
      await probe(set, LOCAL_PROBE_TIMEOUT);
      r.sources[set.id] = 'local';
    } catch (e) {
      if (!r.localError) r.localError = `${set.id}: ${why(e)}`;
      r.sources[set.id] = 'none';
    }
  }

  /**
   * Google's css2 stylesheet for a set, inserted as a <style> and probed; on a failure the <style>
   * is removed again and the error thrown.
   * @param {FontSet} set
   */
  async _viaGoogle(set) {
    const url = `${this.mode === 'google-fail' ? FAIL_CSS : GOOGLE_CSS}?${set.query}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CSS_TIMEOUT);
    let css;
    try {
      const res = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      css = await res.text();
    } finally {
      clearTimeout(timer);
    }
    if (!/@font-face/.test(css)) throw new Error('no @font-face in the stylesheet');
    if (this.mode === 'gstatic-fail') css = css.replace(/https:\/\/fonts\.gstatic\.com\//g, FAIL_GSTATIC);
    const style = document.createElement('style');
    style.dataset.fonts = `google:${set.id}`;
    style.textContent = css;
    document.head.append(style);
    try {
      await probe(set, GOOGLE_PROBE_TIMEOUT);
    } catch (e) {
      style.remove();
      throw e;
    }
  }

  /**
   * Add the pixel glyph faces (GlyphFont.js), once: generated, so nothing is fetched. Never rejects
   * (a face that fails to load is left out: its characters fall back as before).
   */
  async _addGlyphs() {
    if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return;
    const faces = /** @type {[15|10|5, string][]} */ (Object.entries(GLYPH_FAMILY).map(([id, fam]) => [Number(id), fam]));
    const made = await Promise.all(faces.map(async ([id, family]) => {
      try {
        const f = new FontFace(family, glyphData(id), { unicodeRange: GLYPH_RANGE, display: 'block', weight: '100 900' });
        await f.load();
        document.fonts.add(f);
        return f;
      } catch (e) {
        console.warn(`[Luminati] pixel glyphs ${family}:`, e);
        return null;
      }
    }));
    this._glyphs = /** @type {FontFace[]} */ (made.filter(Boolean));
    facesVersion++;
    this.report.glyphs = this._glyphs.map((f) => f.family);
  }

  /** Rebuild the aliases after any build in progress. @returns {Promise<void>} */
  _queueAliases() {
    this._aliasJob = this._aliasJob.then(() => this._buildAliases()).catch((e) => { console.warn('[Luminati] font aliases:', e); });
    return this._aliasJob;
  }

  /** The Jersey aliases for the language at the current scale (none in English). */
  async _buildAliases() {
    const specs = aliasSpecs(this.lang, this._px);
    if (!specs.length) return;
    /** @type {Record<string, string|null>} */
    const files = {};
    for (const s of specs) if (!(s.source in files)) files[s.source] = latinFileOf(s.source);
    const faces = [];
    /** @type {Record<string, string>} */
    const report = {};
    for (const s of specs) {
      const file = files[s.source];
      const adjust = `${+(s.sizeAdjust * 100).toFixed(6)}%`;
      // the pixel glyphs' alias: the glyph face of the same grid at the same size
      try {
        faces.push(new FontFace(s.glyphs, glyphData(gridOf(s.source)), {
          unicodeRange: GLYPH_RANGE, sizeAdjust: adjust, display: 'block', weight: '100 900',
        }));
        report[s.glyphs] = adjust;
      } catch { /* no FontFace from data: the CJK face's own glyphs */ }
      if (!file) continue;
      faces.push(new FontFace(s.family, `url("${file}") format("woff2")`, {
        unicodeRange: ALIAS_RANGE, sizeAdjust: adjust, display: 'block', weight: '100 900',
      }));
      report[s.family] = `${s.source} ×${s.k}, ${adjust}`;
    }
    // load the new faces before they replace the old (the bytes are cached: no new download)
    await Promise.all(faces.map((f) => f.load().catch(() => null)));
    for (const f of this._aliases) document.fonts.delete(f);
    for (const f of faces) if (f.status === 'loaded') document.fonts.add(f);
    this._aliases = faces.filter((f) => f.status === 'loaded');
    facesVersion++;
    this.report.aliases = report;
  }
}

/** @type {FontLoader|null} */
let shared = null;

/**
 * Make and start the page's font loader (src/main.js at the top of boot; a UI made without one
 * starts it itself). A second call returns the first loader.
 * @param {{ lang?: string, mode?: FontMode, px?: number }} [o]
 * @returns {FontLoader}
 */
export function startFonts(o = {}) {
  if (!shared) {
    shared = new FontLoader(o);
    shared.start();
  }
  return shared;
}

/** The page's font loader (null before `startFonts`). */
export const currentFonts = () => shared;
