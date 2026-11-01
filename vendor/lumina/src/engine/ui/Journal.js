import { t, registerStrings, hasStrings, getLang } from '../i18n/I18n.js';
import STORY_UI from '../i18n/strings/story-ui.js';
import { pal, GEMS } from './art/palette.js';
import { art } from './art/painter.js';
import { glyph, gemGlyph, hairline, selBand, coin, fade, rgbOf } from './art/pieces.js';
import { txt, txc, measure, fit, capMid, grow, UP, cjk, originOf, setOrigin, roleFonts, roles, FONT } from './layout/type.js';
import { iconCanvas, CORE_ICONS, GOLD_ICON } from './art/icons/core.js';
import { group, put, win, key, keyHints, section, place, U } from './layout/layout.js';
import { onScale, currentScale } from './UiScale.js';
import { currentFonts } from './FontLoader.js';
import './ui.css';
import './story.css';

/**
 * @import { JournalData, JournalQuest, JournalItem, JournalTab } from './types.js'
 * @import { TextEl } from './layout/type.js'
 */

/**
 * Journal — the story journal overlay (`.lu-journal`, story levels only, created by
 * `UI.useStoryUI()`), drawn in mockup G's family (docs/specs/PIXEL_UI.md §5): A's large window
 * like the tactics panel (the crown, the lattice, the beads), over the tactics veil. The header
 * holds JOURNAL in the heading type, the two tabs — **Quests** and **Items**, small tracked
 * capitals between their Q / E keycaps, the chosen one gilt with A's underline gem, a count on a
 * small plate — the gold (on the Items tab) and the key hints at the right. Under a dim rule: the
 * list at the left (section headings — active quests first, then the finished and failed ones
 * dimmed; key items, then the rest — rows on G's selection band with the cursor, a gem, check or
 * cross per state, the count), the selected entry at the right (its name, its state, the text, the
 * objectives with pixel checkboxes, the log). z 7, the world map's layer: the game never opens
 * both.
 *
 * An empty tab shows no columns: its empty state, centred under the header — the tab's icon (a
 * scroll, a chest) in engraved gold, its line ('story-ui' `empty.quests` / `empty.items`, class
 * `lu-journal__empty`) in the name type and a hint under it in the line type.
 *
 * Laid out in art px of G's 640 × 360 frame (layout/layout.js `group`, centred) and laid out again
 * on a scale change and when a language's font slices arrive; reflowed to the screen rather than
 * scaled while it can be (`geom`: narrower than G's 608 on a screen under 640 art px wide —
 * 1024 × 768: 480, the list column narrower —, shorter on one under 360 art px tall). The list and
 * the details are scroll boxes (their own pixel scroll marks; the wheel scrolls them, the window
 * carries `data-input-ignore`, so the camera does not zoom).
 *
 * Input (`update(dt, input)`, actions read like DialogBox: `input.consumeAction?.(name) ??
 * input.actionPressed(name)`): `camLeft` / `camRight` and `left` / `right` switch tabs, `up` /
 * `down` move the selection (wrapping), `cancel` closes — `update` then returns true and `onClose`
 * runs, so the game can react. The journal binds no key (UI-01): the game opens and closes it with
 * its own journal action. Mouse: the tabs and list entries are clickable, a click outside the
 * window closes it (reported by the next `update`).
 *
 * All text is untrusted (story files): it is set as escaped text only (layout/type.js `txt`);
 * `{word}` renders "word" in gold like the dialog. The texts arrive translated (StoryRunner); the
 * journal's own words are the 'story-ui' strings (src/engine/i18n/strings/story-ui.js), registered
 * by the constructor.
 */

const TABS = /** @type {const} */ (['quests', 'items']);

/** The window at G's size (A's L window at the tactics panel's place and size), the narrowest it reflows to, in art px. */
const WW0 = 608, WH0 = 328, WW_MIN = 480;
/** inside the list box: the selection band, the mark column, the name */
const BAND_X = 8, MARK_X = 13, NAME_X = 25;

/**
 * The window and its columns in art px of G's 640 × 360 frame, for a screen of `artW` × `artH`
 * art px: G's 608 × 328 window (x 16, y 20) where the screen holds it; on a narrower screen as
 * wide as it leaves (16 art px each side; WW_MIN at least, scaled to fit below that), on a shorter
 * one as tall (the list and the detail scroll) — reflowed, not scaled, so its pixels stay whole.
 * @param {number} artW
 * @param {number} artH
 */
function geom(artW, artH) {
  const WW = Math.max(WW_MIN, Math.min(WW0, (artW - 32) - ((artW - 32) % 2)));
  const WH = artH >= 360 ? WH0 : Math.max(200, artH - 32);
  const WX = 320 - WW / 2, WY = artH >= 360 ? 20 : Math.round(180 - WH / 2);
  const L = WX + 26, R = WX + WW - 26;
  // the list column: G's 216 art px, narrower with the window (the detail keeps the rest)
  const listW = WW >= WW0 ? 216 : Math.max(160, Math.round((216 * (R - L)) / (WW0 - 52)));
  const LX0 = L - 12, LX1 = LX0 + listW, DIV = LX1 + 10, DX0 = DIV + 12, DX1 = R + 2;
  return {
    WX, WY, WW, WH, L, R,
    /** the header's centre line, the rule under it, the columns' top and bottom */
    HY: WY + 17, RULE: WY + 29, CY: WY + 38, BOT: WY + WH - 22,
    /** the list box (the cursor sits in its first 9 px), the divider, the detail box */
    LX0, LX1, DIV, DX0, DX1, LW: listW, DW: DX1 - DX0 - 6,
    /** the list's count's right end (in the list box) */
    COUNT_R: listW - 8,
  };
}
/** @typedef {ReturnType<typeof geom>} JournalGeom */

/** The story UI's strings (the constructor registers them; the chunk's own table). */
function useStrings() {
  if (!hasStrings('story-ui')) registerStrings('story-ui', STORY_UI);
}
/** @param {string} k @param {Record<string, any>} [v] */
const s = (k, v) => t(`story-ui.${k}`, v);

// ---------------------------------------------------------------------------------------------
// The fonts a text needs (the story UI's: the journal, the emotes and the end card)
// ---------------------------------------------------------------------------------------------

/** A FontFace's unicode-range as [lo, hi] pairs (parsed once per face). @type {WeakMap<FontFace, [number, number][]>} */
const RANGES = new WeakMap();
/** @param {FontFace} face */
function rangesOf(face) {
  let r = RANGES.get(face);
  if (!r) {
    r = [];
    for (const part of String(face.unicodeRange || 'U+0-10FFFF').split(',')) {
      const m = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part.trim());
      if (!m) continue;
      const lo = parseInt(m[1].replace(/\?/g, '0'), 16);
      const hi = parseInt(m[2] ?? m[1].replace(/\?/g, 'f'), 16);
      if (Number.isFinite(lo) && Number.isFinite(hi)) r.push([lo, hi]);
    }
    RANGES.set(face, r);
  }
  return r;
}
/** A CSS font-weight (or a variable face's range "100 900") holds one of `ws`. @param {string} w @param {Set<number>} ws */
function weightIn(w, ws) {
  const n = String(w).trim().split(/\s+/).map((x) => (x === 'normal' ? 400 : x === 'bold' ? 700 : Number(x)));
  const lo = n[0], hi = n[1] ?? n[0];
  if (!Number.isFinite(lo)) return true;
  for (const v of ws) if (v >= lo && v <= hi) return true;
  return false;
}

/**
 * The fonts `text` needs are not all in yet (a CJK slice not loaded): lay out again once
 * `loadFonts` has them. Reads the faces themselves — a FontFace of a type role's family and weight
 * whose unicode-range covers a character of `text` past Latin-1 (the pixel faces and their Jersey
 * aliases, loaded at the start, hold those) and is not loaded — since `document.fonts.check()`
 * answers true for slices still unloaded where the face is also installed on the system (Noto Sans
 * SC). A face that failed to load counts as in. False without a font API. (The party UI has the
 * same in PartyFrames.js; FontLoader's `fontsIn` does it per font once it is there.)
 * @param {string} text
 */
export function fontsMissing(text) {
  if (!text || typeof document === 'undefined' || !document.fonts) return false;
  /** @type {Set<number>} */
  const cps = new Set();
  for (const ch of text) {
    const c = /** @type {number} */ (ch.codePointAt(0));
    if (c > 0xff) cps.add(c);
  }
  if (!cps.size) return false;
  /** @type {Map<string, Set<number>>} family → weights the roles set it in */
  const want = new Map();
  for (const r of Object.values(roles())) {
    for (const fam of r.family.split(',')) {
      const name = fam.trim().replace(/^["']|["']$/g, '');
      if (!want.has(name)) want.set(name, new Set());
      want.get(name).add(Number(r.w) || 400);
    }
  }
  try {
    for (const face of document.fonts) {
      if (face.status === 'loaded' || face.status === 'error') continue;
      const ws = want.get(face.family.replace(/^["']|["']$/g, ''));
      if (!ws || !weightIn(face.weight, ws)) continue;
      for (const [lo, hi] of rangesOf(face)) for (const c of cps) if (c >= lo && c <= hi) return true;
    }
  } catch { return false; }
  return false;
}

/**
 * Load the faces `text` needs (`fontsMissing`): FontLoader's `ensure`, and each role's font asked
 * for the text itself (`document.fonts.load` loads a matching slice whatever `check()` says).
 * Never rejects.
 * @param {string} text
 * @returns {Promise<void>}
 */
export function loadFonts(text) {
  /** @type {Promise<unknown>[]} */
  const jobs = [currentFonts()?.ensure(text) ?? Promise.resolve()];
  if (typeof document !== 'undefined' && document.fonts) {
    for (const f of roleFonts()) jobs.push(document.fonts.load(f, text).catch(() => []));
  }
  return Promise.all(jobs).then(() => {}, () => {});
}

/** A role's ink height (cap height; 回 for CJK) in art px at the type's scale now. @param {import('./layout/type.js').RoleId} font */
const inkNow = (font) => { roles(); return FONT[font].ink * FONT[font].unit; };

// ---------------------------------------------------------------------------------------------
// Centred lines (the end card's paragraphs, the journal's empty state)
// ---------------------------------------------------------------------------------------------

/** Marks that never start a line (Japanese and Chinese), and brackets that never end one. */
const NO_START = /[、。，．,.！？!?：；:;」』）】〕〉》”’ー…‥ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]/;
const NO_END = /[「『（【〔〈《“‘]/;
/** Latin letters, digits and the marks and spaces that run with them ('HP 120', 'Lv 5', 'G-7'). */
const LATIN = /^[A-Za-z0-9À-ɏ'’.,:;!?%/+\-× ]+$/;

/**
 * A CJK text's pieces that a line may break between: Japanese by `Intl.Segmenter` words where the
 * browser has it (no break inside a word: 見て, から …), else one character each — and a run of
 * Latin letters and digits with the spaces between its words always one piece.
 * @param {string} text
 * @returns {string[]}
 */
function cjkPieces(text) {
  /** @type {any} */
  const Seg = /** @type {any} */ (Intl).Segmenter;
  const words = getLang() === 'ja' && typeof Seg === 'function'
    ? [...new Seg('ja', { granularity: 'word' }).segment(text)].map((x) => x.segment)
    : [...text];
  /** @type {string[]} */
  const out = [];
  for (const w of words) {
    const n = out.length;
    if (n && LATIN.test(w) && LATIN.test(out[n - 1])) out[n - 1] += w;
    else out.push(w);
  }
  return out;
}

/**
 * A text broken into lines of at most `maxW` art px in a role, so each line can be centred on
 * whole pixels (CSS centring of a wrapped block puts lines on half pixels, where the pixel faces'
 * edge filter thickens them): at spaces in English (a word longer than a line at a character); in
 * Japanese and Chinese between pieces (`cjkPieces`: Latin runs whole, Japanese words whole where
 * the browser segments them, else characters) by the strict rules (no 、。」 at a line's start, no
 * 「 at its end; a piece wider than a line at characters). A space at a line's end is dropped.
 * `{word}` markup cut by a break is closed and opened again on the next line.
 * @param {string} text
 * @param {import('./layout/type.js').RoleId} role
 * @param {number} maxW
 * @param {number} [track]
 * @returns {string[]}
 */
export function wrapLines(text, role, maxW, track = 0) {
  if (measure(text, role, track) <= maxW) return [text];
  const fits = (/** @type {string} */ str) => measure(str.trimEnd(), role, track) <= maxW;
  /** @type {string[]} */
  const out = [];
  if (cjk()) {
    let cur = '';
    for (const piece of cjkPieces(text)) {
      if (!cur || fits(cur + piece) || NO_START.test(piece[0])) { cur += piece; continue; }
      // a bracket left at the end goes down with the next piece
      let carry = '';
      while (cur.length > 1 && NO_END.test(cur[cur.length - 1])) { carry = cur[cur.length - 1] + carry; cur = cur.slice(0, -1); }
      out.push(cur.trimEnd());
      cur = (carry + piece).trimStart();
      // a piece wider than a line: at characters
      while (cur.length > 1 && !fits(cur)) {
        let cut = cur.length - 1;
        while (cut > 1 && !fits(cur.slice(0, cut))) cut--;
        out.push(cur.slice(0, cut).trimEnd());
        cur = cur.slice(cut).trimStart();
      }
    }
    if (cur) out.push(cur.trimEnd());
  } else {
    let cur = '';
    for (const word of text.split(/ +/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (fits(next)) { cur = next; continue; }
      if (cur) out.push(cur);
      cur = '';
      // a word wider than a line: cut at characters
      let piece = '';
      for (const ch of word) {
        if (piece && !fits(piece + ch)) { out.push(piece); piece = ''; }
        piece += ch;
      }
      cur = piece;
    }
    if (cur) out.push(cur);
  }
  // keep the gold markup balanced on every line
  let open = false;
  return out.filter((ln) => ln !== '').map((ln) => {
    let line = open ? `{${ln}` : ln;
    for (const ch of ln) { if (ch === '{') open = true; else if (ch === '}') open = false; }
    if (open) line += '}';
    return line;
  });
}

/**
 * An element at (x, y) art px of the frame, inside `parent` (a group or another box): absolute,
 * w × h when given; its own children are placed in frame coordinates too (its origin is (x, y)).
 * @template {keyof HTMLElementTagNameMap} K
 * @param {Element} parent
 * @param {K} tag
 * @param {string} cls
 * @param {number} x
 * @param {number} y
 * @param {number|null} [w]
 * @param {number|null} [h]
 * @returns {HTMLElementTagNameMap[K]}
 */
function box(parent, tag, cls, x, y, w = null, h = null) {
  const el = document.createElement(tag);
  el.className = `g ${cls}`;
  const [ox, oy] = originOf(parent);
  // whole art px (a canvas inside lands on the art grid at every --px)
  const rx = Math.round(x - ox), ry = Math.round(y - oy);
  place(el, rx, ry, w, h);
  setOrigin(el, [ox + rx, oy + ry]);
  parent.append(el);
  return el;
}

// ---------------------------------------------------------------------------------------------
// The journal's own small art (G's glyph family: ink outline, the gold ramp)
// ---------------------------------------------------------------------------------------------

/** A failed quest's cross (7 × 7): ruby strokes in an ink outline. */
function crossGlyph() {
  const k = pal();
  const rows = ['oo...oo', 'oHo.oRo', '.oHoRo.', '..oRo..', '.oRoDo.', 'oRo.oDo', 'oo...oo'];
  return art(7, 7, (p) => p.rows(0, 0, rows, { o: k.ink0, H: k.rb3, R: k.rb2, D: k.rb1 }));
}

/** A key item's key (9 × 6): the bow at the left, the shaft and two teeth, in gilt. */
function keyGlyph() {
  const k = pal();
  const rows = ['.ooo.....', 'oWLGooooo', 'oL.DLLLGo', 'oGDDoGoGo', '.ooo.o.o.', '.........'];
  return art(9, 6, (p) => p.rows(0, 0, rows, { o: k.ink0, W: k.g5, L: k.g4, G: k.g3, D: k.g2 }));
}

/**
 * An objective's checkbox (9 × 9): an ink box with a dim gilt rim round dark glass; a done one has
 * a lit rim and a gold tick.
 * @param {boolean} done
 */
function checkbox(done) {
  const k = pal();
  const rows = done
    ? ['.ooooooo.', 'oLLLLLLGo', 'oLiiiiWGo', 'oLiiiWLGo', 'oLWiWLiGo', 'oLLWLiiGo', 'oLiLiiiGo', 'oGGGGGGGo', '.ooooooo.']
    : ['.ooooooo.', 'oMMMMMMNo', 'oMiiiiiNo', 'oMiiiiiNo', 'oMiiiiiNo', 'oMiiiiiNo', 'oMiiiiiNo', 'oNNNNNNNo', '.ooooooo.'];
  return art(9, 9, (p) => p.rows(0, 0, rows, { o: k.ink0, L: k.g4, G: k.g2, W: k.g5, M: k.dm1, N: k.dm3, i: k.ink1 }));
}

/**
 * A tab count on a small plate (G's locked skill's level plate): an ink plate with a dim gilt top
 * line; the number in `num`.
 * @param {number} w
 */
function badgePlate(w) {
  const k = pal();
  return art(w, 9, (p) => { p.rect(1, 0, w - 2, 9, k.ink0); p.rect(0, 1, w, 7, k.ink0); p.rect(1, 1, w - 2, 7, k.plate1); p.hline(2, 1, w - 4, k.dm1); });
}

/**
 * The tab's underline: a gilt rule fading to dots at both ends, a gem at its middle (w × 5).
 * @param {number} w
 */
function underline(w) {
  const k = pal();
  const ww = w + (w % 2 ? 0 : 1);
  const line = hairline(ww, 'both', k.g3);
  return art(ww, 5, (p) => {
    p.ctx.drawImage(line, 0, 2);
    const cx = Math.floor(ww / 2);
    // a gap in the rule either side of the gem, then the gem (a 5 × 5 diamond lit at the top left)
    p.ctx.clearRect(cx - 3, 2, 7, 1);
    p.rows(cx - 2, 0, ['..o..', '.oWo.', 'oLGDo', '.oBo.', '..o..'], { o: k.ink0, W: k.g5, L: k.g4, G: k.g3, D: k.g2, B: k.g1 });
  });
}

/**
 * The scroll mark of a scroll box: a dotted dim track and a gilt thumb (2 art px wide).
 * @param {number} h
 */
function scrollTrack(h) {
  const k = pal();
  return art(2, h, (p) => { for (let y = 0; y < h; y += 2) p.px(0, y, k.dm3); });
}
/** @param {number} h */
function scrollThumb(h) {
  const k = pal();
  return art(2, h, (p) => { p.vline(0, 0, h, k.g4); p.vline(1, 0, h, k.g2); p.px(0, 0, k.g5); });
}

/**
 * The divider between the columns: a dim gilt line fading to dots at both ends (1 × h).
 * @param {number} h
 */
function vRule(h) {
  const k = pal();
  return art(1, h, (p) => {
    for (let y = 0; y < h; y++) {
      const d = Math.abs((y + 0.5) / h - 0.5) * 2;
      if (d > 0.72 && y % 2) continue;
      if (d > 0.88 && y % 4) continue;
      p.px(0, y, k.dm2);
    }
  });
}

/** The tactics panel's veil (G's tactics screen): the scene dimmed, darker toward the edges, in hard steps. */
const VEILS = new Map();
/** @param {number} w @param {number} h */
function veil(w, h) {
  const id = `${w}x${h}`;
  let c = VEILS.get(id);
  if (!c) {
    c = fade(w, h, rgbOf(pal().dim), (u, v) => 0.6 + 0.28 * Math.min(1, Math.hypot((u - 0.5) / 0.5, (v - 0.5) / 0.5) ** 1.6), [0.6, 0.7, 0.8, 0.88]);
    VEILS.clear();
    VEILS.set(id, c);
  }
  const copy = document.createElement('canvas');
  copy.width = c.width; copy.height = c.height;
  copy.getContext('2d').drawImage(c, 0, 0);
  return copy;
}

/** @param {unknown} v @returns {string} */
const str = (v) => (v === undefined || v === null ? '' : String(v));

/**
 * Normalise untrusted journal data (any shape) into clean arrays.
 * @param {JournalData} data
 * @returns {{ quests: Required<JournalQuest>[], items: Required<JournalItem>[], gold: number }}
 */
function clean(data) {
  const d = data && typeof data === 'object' ? data : {};
  const quests = (Array.isArray(d.quests) ? d.quests : []).filter((q) => q && typeof q === 'object').map((q, i) => ({
    id: str(q.id) || `#${i}`,
    title: str(q.title) || str(q.id),
    state: /** @type {JournalQuest['state']} */ (q.state === 'done' || q.state === 'failed' ? q.state : 'active'),
    text: str(q.text),
    log: (Array.isArray(q.log) ? q.log : []).map(str).filter(Boolean),
    goals: (Array.isArray(q.goals) ? q.goals : []).filter((g) => g && typeof g === 'object')
      .map((g) => ({ text: str(g.text), done: !!g.done })).filter((g) => g.text),
  }));
  const items = (Array.isArray(d.items) ? d.items : []).filter((it) => it && typeof it === 'object').map((it, i) => {
    const n = Number(it.count);
    return {
      id: str(it.id) || `#${i}`,
      name: str(it.name) || str(it.id),
      count: Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 1,
      text: str(it.text),
      key: !!it.key,
    };
  });
  const g = Number(d.gold);
  return { quests, items, gold: Number.isFinite(g) ? Math.max(0, Math.floor(g)) : 0 };
}

/**
 * @typedef {{ id: string, el: HTMLElement, y: number, top: number }} ListEntry
 *   y: the row's top in the list box (art px); top: where it scrolls to (its group's heading)
 */

export class Journal {
  /** @param {HTMLElement} parent the UI root */
  constructor(parent) {
    useStrings();
    /** @type {((name: 'open'|'close'|'blip'|'confirm') => void) | null} sound hook (AudioSystem.playSfx names) */
    this.onSound = null;
    /** @type {(() => void) | null} called when the journal closes itself (cancel, a click outside) */
    this.onClose = null;

    const el = document.createElement('div');
    el.className = 'lu-journal';
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('data-input-ignore', '');
    parent.appendChild(el);
    this.element = el;
    this._parent = parent;

    this._open = false;
    /** @type {JournalTab} */
    this._tab = 'quests';
    this._data = clean({});
    /** selected entry id per tab (kept across setData while it still exists) */
    this._sel = { quests: '', items: '' };
    /** @type {ListEntry[]} entries of the shown list, in order */
    this._entries = [];
    this._index = -1;
    this._dirty = true;
    this._closeQueued = false;
    /** the row pitch of the list (art px; taller round CJK text) */
    this._rp = 16;
    /** @type {HTMLElement|null} the window (the layout's group) */
    this._window = null;
    /** @type {HTMLElement|null} */
    this._list = null;
    /** @type {HTMLElement|null} */
    this._detail = null;
    /** @type {HTMLCanvasElement|null} */
    this._veil = null;
    /** @type {{ band: HTMLCanvasElement, cursor: HTMLCanvasElement }|null} the list's selection */
    this._selArt = null;
    /** @type {{ box: HTMLElement, thumb: HTMLCanvasElement, y: number, h: number, th: number }[]} */
    this._scrolls = [];
    /** a font load in flight (a newer render supersedes it) */
    this._fontJob = 0;

    this._onBackdrop = (e) => {
      if (this._open && !(this._window && this._window.contains(/** @type {Node} */ (e.target)))) this._closeQueued = true;
    };
    el.addEventListener('click', this._onBackdrop);
    this._onListClick = (e) => {
      const li = /** @type {HTMLElement} */ (e.target).closest?.('.lu-journal__entry');
      if (!li || !this._open) return;
      const i = this._entries.findIndex((x) => x.el === li);
      if (i >= 0 && i !== this._index) { this._select(i, false); this._sound('blip'); }
    };
    this._onScroll = (e) => this._updateScroll(/** @type {HTMLElement} */ (e.target));
    this._offScale = onScale(parent, () => {
      this._veilSize = '';
      if (this._open) this._layout(true);
      else this._dirty = true;
    });
    this._veilSize = '';
    /** @type {JournalGeom} the window's geometry for the screen it was laid out on (`geom`) */
    this._G = geom(640, 360);
  }

  /** True between open() and close(). */
  get isOpen() { return this._open; }
  /** The tab shown ('quests' | 'items'). */
  get tab() { return this._tab; }
  /** The selected entry's id on the current tab ('' when the list is empty). */
  get selectedId() { return this._entries[this._index]?.id ?? ''; }

  /**
   * Replace the journal's contents (any time; re-rendered at once while open, else on open). The
   * selection stays on the same id while it exists.
   * @param {JournalData} data
   */
  setData(data) {
    this._data = clean(data);
    this._dirty = true;
    if (this._open) this._render();
  }

  /**
   * Open the journal (fades in) on a tab.
   * @param {JournalTab} [tab]
   * @returns {boolean} true
   */
  open(tab = 'quests') {
    const tb = TABS.includes(tab) ? tab : 'quests';
    this._closeQueued = false;
    if (!this._open) {
      this._open = true;
      this.element.classList.add('is-open');
      this.element.setAttribute('aria-hidden', 'false');
      this._sound('open');
    }
    if (tb !== this._tab || this._dirty) { this._tab = tb; this._render(); }
    return true;
  }

  /**
   * Close the journal (fades out).
   * @returns {boolean} false
   */
  close() {
    this._closeQueued = false;
    if (!this._open) return false;
    this._open = false;
    this.element.classList.remove('is-open');
    this.element.setAttribute('aria-hidden', 'true');
    this._sound('close');
    return false;
  }

  /**
   * Read the journal's actions. Call once per frame while open (`UI.update` does).
   * @param {number} dt seconds (unused so far)
   * @param {{ actionPressed(name: string): boolean, consumeAction?(name: string): boolean }} [input]
   * @returns {boolean} true when the journal closed itself this update (cancel, a click outside)
   */
  update(dt, input) {
    if (!this._open) return false;
    const pressed = (name) => !!input && (typeof input.consumeAction === 'function' ? input.consumeAction(name) : input.actionPressed(name));
    if (pressed('cancel') || this._closeQueued) {
      this.close();
      if (this.onClose) this.onClose();
      return true;
    }
    if (pressed('camLeft') || pressed('left')) this._cycleTab(-1);
    else if (pressed('camRight') || pressed('right')) this._cycleTab(1);
    if (pressed('up')) this._move(-1);
    else if (pressed('down')) this._move(1);
    return false;
  }

  dispose() {
    this._offScale();
    this._fontJob++;
    this.element.removeEventListener('click', this._onBackdrop);
    this.element.remove();
  }

  // ------------------------------------------------------------------------------------------

  _sound(name) { if (this.onSound) this.onSound(name); }

  /** @param {number} dir */
  _cycleTab(dir) {
    const i = TABS.indexOf(this._tab);
    this._setTab(TABS[(i + dir + TABS.length) % TABS.length]);
    this._sound('confirm');
  }

  /** @param {JournalTab} tab */
  _setTab(tab) {
    this._tab = tab;
    this._render();
  }

  /** @param {number} dir */
  _move(dir) {
    const n = this._entries.length;
    if (n < 2) return;
    this._select((this._index + dir + n) % n, true);
    this._sound('blip');
  }

  /** Render the shown tab from the top (a tab switch, new data, opening). */
  _render() {
    this._dirty = false;
    this._layout(false);
    // a language's glyphs not loaded yet (CJK fonts come in slices): lay out again once they are
    const text = `${JSON.stringify(this._data)}${Object.keys(STORY_UI.en).map((id) => s(id)).join('')}`;
    if (fontsMissing(text)) {
      const job = ++this._fontJob;
      loadFonts(text).then(() => { if (job === this._fontJob && this._open) this._layout(true); });
    }
  }

  /**
   * Build the window: the frame, the header, the list and the detail of the selected entry.
   * @param {boolean} keep keep the scroll positions (a re-layout of the same content)
   */
  _layout(keep) {
    const el = this.element;
    const listTop = keep && this._list ? this._list.scrollTop : 0;
    const detailTop = keep && this._detail ? this._detail.scrollTop : 0;
    this._fontJob += keep ? 0 : 1;
    // the veil: the screen at one canvas pixel per art pixel (painted once per screen size)
    const sc = currentScale(el);
    const vw = Math.ceil((sc?.W ?? 1280) / (sc?.px ?? 2)), vh = Math.ceil((sc?.H ?? 720) / (sc?.px ?? 2));
    const vid = `${vw}x${vh}`;
    if (!this._veil || this._veilSize !== vid) {
      this._veil?.remove();
      this._veil = veil(vw, vh);
      this._veil.className = 'lu-journal__veil';
      this._veil.setAttribute('aria-hidden', 'true');
      this._veil.style.width = U(vw);
      this._veil.style.height = U(vh);
      el.prepend(this._veil);
      this._veilSize = vid;
    }
    this._window?.remove();
    this._scrolls = [];
    const k = pal();
    // the window: A's L window, the tactics panel's place (reflowed to the screen: `geom`)
    const G = geom(sc?.artW ?? 640, sc?.artH ?? 360);
    this._G = G;
    const { WX, WY, WW, WH, L, R, RULE, CY, BOT, LX0, LX1, DIV, DX0, DX1, LW } = G;
    const g = group(el, 'mc', WX, WY, WW, WH, 'over lu-journal__window');
    g.setAttribute('role', 'dialog');
    g.setAttribute('aria-label', s('journal.title'));
    this._window = g;
    win(g, { size: 'L', lattice: true, beads: 6, crown: true, trio: true, sides: true }, WX, WY, WW, WH);

    this._header(g);
    put(g, hairline(R - L, 'both', k.dm1), L, RULE);
    // (an empty tab: no columns — its empty state centred under the header: `_emptyState`)
    const empty = this._tab === 'quests' ? !this._data.quests.length : !this._data.items.length;
    g.classList.toggle('is-empty', empty);
    if (!empty) put(g, vRule(BOT - CY), DIV, CY, 1, 'lu-journal__divider');

    // the list (left) and the selected entry (right): scroll boxes
    const list = box(g, 'ul', 'lu-journal__list', LX0, CY, LW, BOT - CY);
    list.addEventListener('click', this._onListClick);
    list.addEventListener('scroll', this._onScroll, { passive: true });
    this._list = list;
    const detail = box(g, 'article', 'lu-journal__detail', DX0, CY, DX1 - DX0, BOT - CY);
    detail.addEventListener('scroll', this._onScroll, { passive: true });
    this._detail = detail;
    this._scrolls.push(this._scrollMark(g, list, LX1 + 3), this._scrollMark(g, detail, DX1 + 2));

    this._buildList(list);
    if (empty) this._emptyState(g);
    list.scrollTop = listTop;
    const keepSel = this._entries.findIndex((e) => e.id === this._sel[this._tab]);
    this._index = -1;
    this._select(keepSel >= 0 ? keepSel : 0, !keep);
    if (keep) detail.scrollTop = detailTop;
    for (const m of this._scrolls) this._updateScroll(m.box);
  }

  /**
   * An empty tab's state, centred in the window under the header (no list, no divider, no detail):
   * the tab's icon (a scroll for the quests, a chest for the items) in engraved gold, one line in
   * the name type and a hint under it in the line type.
   * @param {HTMLElement} g
   */
  _emptyState(g) {
    const k = pal();
    const { L, R, CY, BOT } = this._G;
    const quests = this._tab === 'quests';
    const box0 = box(g, 'div', 'lu-journal__none', L, CY);
    const cx = Math.round((L + R) / 2);
    const head = s(quests ? 'empty.quests' : 'empty.items');
    const hint = s(quests ? 'empty.questsHint' : 'empty.itemsHint');
    const maxW = Math.min(R - L - 40, 320);
    // the hint's lines (it may wrap: each centred on whole pixels) and the stack's height: the
    // icon 32, 8, the line's ink, 7, the hint
    const hints = wrapLines(hint, 'line', maxW);
    const lineP = cjk() ? FONT.line.L : 18 * FONT.line.unit;
    const nameH = Math.max(8, inkNow('name'));
    const h = 32 + 8 + nameH + 7 + hints.length * lineP;
    let y = Math.round(CY + (BOT - CY - h) / 2) - 4;
    put(box0, iconCanvas(CORE_ICONS[quests ? 'scroll' : 'chest'], { ...GOLD_ICON(), scale: 2 }), cx - 16, y, 1, 'lu-journal__none-icon');
    y += 32 + 8;
    txc(box0, head, cx, y + nameH / 2, { font: 'name', color: k.tx1, drop: true, align: 'center', cls: 'lu-journal__empty' });
    y += nameH + 7;
    for (const ln of hints) {
      txt(box0, ln, cx, y, { font: 'line', color: k.tx3, drop: true, align: 'center', lineH: cjk() ? null : 9, cls: 'lu-journal__empty-hint' });
      y += lineP;
    }
  }

  /** The header: JOURNAL, the tabs between their keys, the gold, the key hints. @param {HTMLElement} g */
  _header(g) {
    const k = pal();
    const { WX, WY, L, R, HY } = this._G;
    const head = box(g, 'div', 'lu-journal__head', WX, WY);
    const title = UP(s('journal.title'));
    txc(head, title, L, HY, { font: 'head', track: 1, color: k.tx1, drop: true, cls: 'lu-journal__kicker' });
    const tw = measure(title, 'head', 1);
    put(head, gemGlyph(2), L + tw + 6, HY - 3);
    // the tabs: Q ‹ QUESTS (n) · ITEMS › E
    const tabs = box(head, 'nav', 'lu-journal__tabs', WX, WY);
    tabs.setAttribute('aria-label', s('hint.tabs'));
    let x = L + tw + 18;
    x += key(tabs, 'Q', x, HY - 5.5, { cls: 'lu-journal__cap' }) + 7;
    const active = this._data.quests.filter((q) => q.state === 'active').length;
    const gs = Math.ceil(grow('small'));
    for (const tb of TABS) {
      const on = tb === this._tab;
      const label = UP(s(`tab.${tb}`));
      const lw = measure(label, 'small', 1);
      const n = tb === 'quests' ? active : 0;
      const nw = n ? measure(String(n), 'num') + 6 : 0;
      const w = lw + (n ? 4 + nw : 0) + 6;
      const b = box(tabs, 'button', `lu-journal__tab${on ? ' is-on' : ''}`, x, HY - 8 - gs / 2, w, 16 + gs);
      b.type = 'button';
      b.dataset.tab = tb;
      b.setAttribute('aria-selected', String(on));
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._open && tb !== this._tab) { this._setTab(tb); this._sound('confirm'); }
      });
      txc(b, label, x + 3, HY, { font: 'small', track: 1, color: on ? k.g5 : k.tx3, drop: true, cls: 'lu-journal__tab-label' });
      const badge = box(b, 'span', 'lu-journal__badge', x + 3 + lw + 4, HY - 4.5);
      if (n) {
        put(badge, badgePlate(nw), x + 3 + lw + 4, HY - 4.5);
        txc(badge, String(n), x + 3 + lw + 7, HY, { font: 'num', color: k.g5 });
      }
      if (on) put(b, underline(lw + 4), x + 1, HY + 4 + gs / 2);
      x += w + 6;
    }
    key(tabs, 'E', x + 1, HY - 5.5, { cls: 'lu-journal__cap' });
    // the key hints at the right (G's tactics header), the gold before them on the Items tab
    const foot = box(head, 'div', 'lu-journal__foot', WX, WY);
    const hw = keyHints(foot, [{ keys: ['↑', '↓'], label: s('hint.select') }, { keys: ['Esc'], label: s('hint.close') }],
      R, HY - 5.5, { align: 'right', color: k.tx2, drop: true, cls: 'lu-journal__hint' });
    const gold = box(head, 'div', `lu-journal__gold${this._tab === 'items' ? ' is-on' : ''}`, WX, WY);
    const gn = this._data.gold.toLocaleString('en-US');
    const unit = s('gold');
    const nw = measure(gn, 'num'), uw = measure(unit, 'tiny');
    const gx1 = R - hw - 14;
    put(gold, coin(), gx1 - uw - 2 - nw - 3 - 9, HY - 4.5, 1, 'lu-journal__coin');
    txc(gold, gn, gx1 - uw - 2 - nw, HY, { font: 'num', color: k.kw, drop: true, cls: 'lu-journal__gold-n' });
    txc(gold, unit, gx1 - uw, HY - 0.5, { font: 'tiny', color: k.g3, drop: true });
  }

  /**
   * A scroll box's mark at x (the box's right): the track and the thumb, shown while it overflows.
   * @param {HTMLElement} g @param {HTMLElement} sbox @param {number} x
   */
  _scrollMark(g, sbox, x) {
    const { CY, BOT } = this._G;
    const h = BOT - CY;
    const track = put(g, scrollTrack(h), x, CY, 1, 'lu-journal__track');
    const thumb = put(g, scrollThumb(8), x, CY, 1, 'lu-journal__thumb');
    track.style.visibility = 'hidden';
    thumb.style.visibility = 'hidden';
    return { box: sbox, thumb, track, y: CY, h, th: 8 };
  }

  /** Follow a scroll box's position with its mark. @param {HTMLElement} sbox */
  _updateScroll(sbox) {
    const m = /** @type {any} */ (this._scrolls.find((x) => x.box === sbox));
    if (!m) return;
    const over = sbox.scrollHeight - sbox.clientHeight;
    const on = over > 1;
    m.track.style.visibility = on ? '' : 'hidden';
    m.thumb.style.visibility = on ? '' : 'hidden';
    if (!on) return;
    const th = Math.max(8, Math.round(m.h * sbox.clientHeight / sbox.scrollHeight));
    if (th !== m.th) {
      const c = scrollThumb(th);
      m.thumb.width = c.width; m.thumb.height = c.height;
      m.thumb.getContext('2d').drawImage(c, 0, 0);
      m.thumb.style.height = U(th);
      m.th = th;
    }
    const ty = Math.round((m.h - th) * Math.min(1, sbox.scrollTop / over));
    m.thumb.style.top = U(m.y + ty - (originOf(/** @type {Element} */ (m.thumb.parentElement))[1]));
  }

  /** The list of the shown tab. @param {HTMLElement} list */
  _buildList(list) {
    const k = pal();
    const { LX0, CY, LW, COUNT_R } = this._G;
    const { quests, items } = this._data;
    this._entries = [];
    const RP = 16 + 2 * Math.ceil(grow('body') / 2);
    const GH = 13 + Math.ceil(grow('small'));
    this._rp = RP;
    // the selection: G's band and the nudging cursor, moved to the selected row
    const band = put(list, selBand(LW - BAND_X - 2, RP), LX0 + BAND_X, CY, 1, 'lu-journal__sel');
    const cursor = put(list, glyph('cursor'), LX0 + 1, CY + RP / 2 - 4, 1, 'nudge lu-journal__cursor');
    band.style.visibility = 'hidden';
    cursor.style.visibility = 'hidden';
    this._selArt = { band, cursor };
    const groups = this._tab === 'quests'
      ? [
        { label: s('group.active'), rows: quests.filter((q) => q.state === 'active') },
        { label: s('group.concluded'), rows: quests.filter((q) => q.state !== 'active') },
      ]
      : [
        { label: s('group.keyItems'), rows: items.filter((it) => it.key) },
        { label: s('group.items'), rows: items.filter((it) => !it.key) },
      ];
    let y = 0;
    for (const grp of groups) {
      if (!grp.rows.length) continue;
      const head = box(list, 'li', 'lu-journal__group', LX0, CY + y);
      section(head, UP(grp.label), LX0 + MARK_X, LX0 + COUNT_R, CY + y + GH / 2, String(grp.rows.length), 'num');
      const top = y;
      y += GH;
      grp.rows.forEach((row, i) => {
        const q = /** @type {any} */ (row);
        const isQuest = this._tab === 'quests';
        const state = isQuest ? (q.state === 'active' ? '' : q.state) : (q.key ? 'key' : '');
        const li = box(list, 'li', `lu-journal__entry${state ? ` is-${state}` : ''}`, LX0, CY + y, LW, RP);
        const cy = CY + y + RP / 2;
        // the mark: a gem (active / an item), a check (done), a cross (failed), a key (a key item)
        const mark = box(li, 'span', 'lu-journal__mark', LX0 + MARK_X, CY + y);
        let mc;
        if (isQuest) mc = q.state === 'done' ? glyph('check') : q.state === 'failed' ? crossGlyph() : gemGlyph(2, GEMS.gold());
        else mc = q.key ? keyGlyph() : gemGlyph(1, GEMS.gold());
        put(mark, mc, LX0 + MARK_X + Math.floor((9 - mc.width) / 2), Math.round(cy - mc.height / 2));
        const count = isQuest || (q.key && q.count <= 1) ? '' : s('count', { n: q.count });
        const cw = count ? measure(count, 'num') + 6 : 0;
        const name = fit(isQuest ? q.title : q.name, 'body', COUNT_R - NAME_X - cw);
        const nm = txc(li, name, LX0 + NAME_X, cy, { font: 'body', drop: true, cls: 'lu-journal__name' });
        if (state === 'failed') {
          // struck through: a ruby line across the name's ink
          put(li, art(Math.max(1, nm.tw), 1, (p) => p.hline(0, 0, nm.tw, k.rb2)), LX0 + NAME_X, Math.round(cy), 1, 'lu-journal__strike');
        }
        if (count) txc(li, count, LX0 + COUNT_R, cy, { font: 'num', color: k.g5, align: 'right', drop: true, cls: 'lu-journal__count' });
        this._entries.push({ id: q.id, el: li, y, top: i === 0 ? top : y });
        y += RP;
      });
      y += 4;
    }
    // (an empty tab: its state is drawn over the window, `_emptyState`)
    // the box scrolls to its last row (absolute rows give it no height of their own)
    box(list, 'li', 'lu-journal__end', LX0, CY + y, 1, 1);
  }

  /** @param {number} i @param {boolean} scroll keep the entry in view */
  _select(i, scroll) {
    const prev = this._entries[this._index];
    if (prev) prev.el.classList.remove('is-sel');
    this._index = this._entries.length ? Math.max(0, Math.min(this._entries.length - 1, i)) : -1;
    const cur = this._entries[this._index];
    const sel = this._selArt;
    if (cur) {
      cur.el.classList.add('is-sel');
      this._sel[this._tab] = cur.id;
      if (sel) {
        sel.band.style.top = U(cur.y);
        sel.cursor.style.top = U(cur.y + this._rp / 2 - 4);
        sel.band.style.visibility = '';
        sel.cursor.style.visibility = '';
      }
      if (scroll) this._scrollTo(cur);
    } else if (sel) {
      sel.band.style.visibility = 'hidden';
      sel.cursor.style.visibility = 'hidden';
    }
    this._renderDetail(cur?.id ?? '');
  }

  /** Scroll the list (only) so the entry is in view. @param {ListEntry} e */
  _scrollTo(e) {
    const list = this._list;
    if (!list) return;
    const px = currentScale(this.element)?.cssPx ?? 2;
    // the group heading above the first entry of a group comes into view with it
    const top = e.top * px;
    const bottom = (e.y + this._rp) * px;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }

  /** @param {string} id */
  _renderDetail(id) {
    const d = this._detail;
    if (!d) return;
    const k = pal();
    const { DX0, DX1, CY, BOT, DW } = this._G;
    d.textContent = '';
    d.scrollTop = 0;
    const x0 = DX0 + 2;
    const found = this._tab === 'quests' ? this._data.quests.find((x) => x.id === id) : this._data.items.find((x) => x.id === id);
    d.classList.toggle('is-empty', !found);
    if (!found) {
      // (an empty tab shows its empty state instead: no detail at all)
      if (this._entries.length) put(d, gemGlyph(3, GEMS.dusk(), { setting: [k.dm1, k.dm2, k.dm3] }), DX0 + Math.floor((DX1 - DX0) / 2) - 4, CY + Math.floor((BOT - CY) / 2) - 4);
      return;
    }
    const lh = (/** @type {TextEl} */ e) => e.lines * e.lh;
    let y = CY + 2;
    if (this._tab === 'quests') {
      const q = /** @type {Required<JournalQuest>} */ (found);
      const title = txt(d, UP(q.title), x0, y, { font: 'name', track: 1, color: k.g5, drop: true, maxW: DW, cls: 'lu-journal__title' });
      y += lh(title) + 3 + Math.ceil(grow('small') / 2);
      // the state: its mark and a small tracked label
      const mc = q.state === 'done' ? glyph('check') : q.state === 'failed' ? crossGlyph() : gemGlyph(2, GEMS.gold());
      const sc = y + capMid('small');
      put(d, mc, x0 + Math.floor((9 - mc.width) / 2), Math.round(sc - mc.height / 2));
      this._stateLabel(d, s(`state.${q.state}`), x0 + 12, y, `is-${q.state}`, q.state === 'done' ? k.heal : q.state === 'failed' ? k.rb3 : k.g4);
      y += 9 + Math.ceil(grow('small')) + 6;
      if (q.text) {
        const tx = txt(d, q.text, x0, y, { font: 'body', color: k.tx1, drop: true, maxW: DW, cls: 'lu-journal__text' });
        y += lh(tx) + 4;
      }
      if (q.goals.length) {
        y = this._section(d, s('objectives'), x0, y);
        const ul = box(d, 'ul', 'lu-journal__goals', DX0, CY);
        for (const goal of q.goals) {
          const li = box(ul, 'li', `lu-journal__goal${goal.done ? ' is-done' : ''}`, DX0, CY);
          const gt = txt(li, goal.text, x0 + 14, y, { font: 'body', color: goal.done ? k.tx3 : k.tx1, drop: true, maxW: DW - 14, cls: 'lu-journal__goal-text' });
          put(li, checkbox(goal.done), x0 + 1, Math.round(y + capMid('body') - 4.5), 1, 'lu-journal__box');
          y += lh(gt) + 2;
        }
        y += 3;
      }
      if (q.log.length) {
        y = this._section(d, s('log'), x0, y);
        const ol = box(d, 'ol', 'lu-journal__log', DX0, CY);
        q.log.forEach((line, i) => {
          const last = i === q.log.length - 1;
          const li = box(ol, 'li', last ? 'is-latest' : '', DX0, CY);
          const lt = txt(li, line, x0 + 11, y, { font: 'body', color: last ? k.tx1 : k.tx3, drop: true, maxW: DW - 11 });
          put(li, gemGlyph(1, last ? GEMS.gold() : GEMS.dusk(), last ? {} : { setting: [k.dm1, k.dm2, k.dm3] }), x0 + 2, Math.round(y + capMid('body') - 2.5));
          y += lh(lt) + 1;
        });
      }
    } else {
      const it = /** @type {Required<JournalItem>} */ (found);
      const head = box(d, 'div', 'lu-journal__item-head', DX0, CY);
      const qty = !it.key || it.count > 1 ? s('count', { n: it.count }) : '';
      const qw = qty ? measure(qty, 'num') + 6 : 0;
      const title = txt(head, UP(it.name), x0, y, { font: 'name', track: 1, color: k.g5, drop: true, maxW: DW - qw, cls: 'lu-journal__title' });
      if (qty) {
        const one = title.lines === 1;
        txc(head, qty, one ? x0 + measure(UP(it.name), 'name', 1) + 6 : x0 + DW, y + capMid('name'), { font: 'num', color: k.kw, align: one ? 'left' : 'right', drop: true, cls: 'lu-journal__qty' });
      }
      y += lh(title) + 3 + Math.ceil(grow('small') / 2);
      if (it.key) {
        put(d, keyGlyph(), x0, Math.round(y + capMid('small') - 3));
        this._stateLabel(d, s('keyItem'), x0 + 12, y, 'is-key', k.g4);
        y += 9 + Math.ceil(grow('small')) + 6;
      } else y += 3;
      if (it.text) txt(d, it.text, x0, y, { font: 'body', color: k.tx1, drop: true, maxW: DW, cls: 'lu-journal__text' });
      else txt(d, s('unknownItem'), x0, y, { font: 'line', color: k.tx3, drop: true, maxW: DW, cls: 'lu-journal__text is-none' });
      y += 30;
    }
    box(d, 'div', 'lu-journal__end', DX0, y + 6, 1, 1);
  }

  /**
   * A state label (small tracked capitals; the text stays as written — capitals by CSS — so the
   * element's text is the string).
   * @param {HTMLElement} d @param {string} text @param {number} x @param {number} y @param {string} cls @param {string} color
   */
  _stateLabel(d, text, x, y, cls, color) {
    const e = txt(d, cjk() ? text : UP(text), x, y, { font: 'small', track: 1, color, drop: true, cls: `lu-journal__state ${cls}` });
    if (!cjk()) { e.textContent = text; e.style.textTransform = 'uppercase'; }
    return e;
  }

  /**
   * A section heading in the detail (G's `section`: the label, a gilt rule running right); returns
   * the y under it.
   * @param {HTMLElement} d @param {string} label @param {number} x0 @param {number} y
   */
  _section(d, label, x0, y) {
    const { DX0, CY, DW } = this._G;
    const gs = Math.ceil(grow('small'));
    const h = box(d, 'div', 'lu-journal__sub', DX0, CY);
    section(h, UP(label), x0, x0 + DW, y + 4 + gs / 2);
    return y + 11 + gs;
  }
}
