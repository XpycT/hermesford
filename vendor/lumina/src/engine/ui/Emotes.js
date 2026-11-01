import * as THREE from 'three';
import { isOwnKey } from '../utils/own.js';
import { getLang } from '../i18n/I18n.js';
import { pal } from './art/palette.js';
import { art } from './art/painter.js';
import { measure, styleText, FONT } from './layout/type.js';
import { U } from './layout/layout.js';
import { onScale, currentScale } from './UiScale.js';
import { fontsMissing, loadFonts } from './Journal.js';
import './ui.css';
import './story.css';

/** @import { EmoteIcon } from './types.js' */

/**
 * Emotes — pixel-art bubbles over characters (story levels only, created by `UI.useStoryUI()`):
 * `show(target, icon)` pops a bubble with an icon above an Object3D, projected into CSS pixels every
 * `update(camera)` like the interaction prompt (hidden behind the camera, off screen or while the
 * target is invisible), and pops it out again after `seconds`. One bubble per target (a new show()
 * on the same target replaces it); elements are pooled. The layer (`.lu-emotes`, z 1) sits under the
 * letterbox, the HUD and the dialog, and stays visible in cutscenes and conversations.
 *
 * Mockup G's family (docs/specs/PIXEL_UI.md §5): the bubbles are pixel art in G's keycap cream and
 * ink at the UI root's art pixel (`--px`, the prompt's bubble size), and they pop and leave in
 * whole art pixels (stepped).
 *
 * Icons: '!' '?' '…' '♪' '♥' 'zzz' '#' (anger) '💧' (sweat) '✦' (idea) — the values of the story
 * language's `EMOTES` table; '...' is taken as '…'. Anything else is drawn as short text (at most
 * 4 characters, in a speech bubble sized to it).
 *
 * `bark(target, text)` pops a **line of speech** the same way (the story's `bark` command: a
 * villager talks without the dialog window): G's speech bubble painted to the text's size (an ink
 * outline, the cream paper lit at the top left and shaded at the bottom right, the tail under its
 * middle) with the text in the body type (`{word}` highlighted, a line feed — what a script's `\n`
 * becomes — a line break, at most 160 characters). A bark and an emote over the same target replace
 * each other. The text arrives translated (StoryRunner); a language's font slices are loaded before
 * it is measured (the bubble is laid out again when they arrive), and again on a scale change.
 *
 * A speech bubble keeps clear of the interaction prompt (`.lu-prompt.is-on.is-inview`, read once
 * a frame while a bubble is in view): lifted over it (2 art px), or turned over under the
 * speaker's feet (its tail on top, `is-flipped`) when there is no room above. A bark from before a
 * conversation steps aside while the dialog is up (story.css; one a script says during the
 * conversation, `is-indialog`, stays).
 */

// 16×14 bubble with a centred tail. O outline · W paper · H highlight · S shade
const BUBBLE = [
  '..OOOOOOOOOOOO..',
  '.OHHWWWWWWWWWWO.',
  'OHWWWWWWWWWWWWSO',
  'OWWWWWWWWWWWWWSO',
  'OWWWWWWWWWWWWWSO',
  'OWWWWWWWWWWWWWSO',
  'OWWWWWWWWWWWWWSO',
  'OWWWWWWWWWWWWWSO',
  'OWWWWWWWWWWWWWSO',
  'OSWWWWWWWWWWWSSO',
  '.OSSSSSSSSSSSSO.',
  '..OOOOOOSSOOOO..',
  '.......OSO......',
  '.......OO.......',
];
/** G's keycap cream and ink (the prompt's bubble, art/pieces.js `bubble`). */
const bubbleColors = () => { const k = pal(); return { O: k.ink0, W: k.kf1, H: k.kf0, S: k.kf2 }; };

// 8×7 icons, drawn at (4, 2) inside the bubble. Each: rows + colours (a key per pixel char).
/** @type {Record<string, { rows: string[], colors: Record<string, string>, dots?: boolean }>} */
const ICONS = {
  '!': {
    rows: ['...ab...', '...ab...', '...ab...', '...ab...', '........', '...ab...', '...ab...'],
    colors: { a: '#e8503a', b: '#a8281e' },
  },
  '?': {
    rows: ['..aaaa..', '.ab..ab.', '.....ab.', '....ab..', '...ab...', '........', '...ab...'],
    colors: { a: '#4f7fd8', b: '#2c4c94' },
  },
  '…': {
    // one digit pair per dot (main, shade), so each dot can be its own group
    rows: ['........', '........', '........', '11.22.33', '44.55.66', '........', '........'],
    colors: { 1: '#5a4030', 2: '#5a4030', 3: '#5a4030', 4: '#3a2818', 5: '#3a2818', 6: '#3a2818' },
    dots: true,
  },
  '♪': {
    rows: ['....aaa.', '....a.ab', '....a..b', '....a...', '..aaa...', '.aaaa...', '..bb....'],
    colors: { a: '#7a5cc8', b: '#4e3890' },
  },
  '♥': {
    rows: ['.aa..aa.', 'ahaaaaab', 'aaaaaaab', 'aaaaaaab', '.aaaaab.', '..aabb..', '...bb...'],
    colors: { a: '#e8506a', b: '#a82a44', h: '#ffd0d8' },
  },
  zzz: {
    rows: ['....aaaa', '......a.', '.....a..', 'bbb.aaaa', '..b.....', '.b......', 'bbb.....'],
    colors: { a: '#4f7fd8', b: '#7fa6e8' },
  },
  '#': {
    rows: ['.aa..aa.', 'ab....ba', 'a......a', '........', 'a......a', 'ab....ba', '.aa..aa.'],
    colors: { a: '#e0402e', b: '#a02418' },
  },
  '💧': {
    rows: ['....a...', '...aa...', '..aaab..', '.ahaaab.', '.haaaab.', '.aaaabb.', '..abbb..'],
    colors: { a: '#58a8e8', b: '#2e6eb0', h: '#e4f4ff' },
  },
  '✦': {
    rows: ['...ab...', '...ab...', '..aaab..', 'aaahaaab', '..aaab..', '...ab...', '...ab...'],
    colors: { a: '#f2c23a', b: '#b8861e', h: '#fff6c8' },
  },
};
const ALIASES = { '...': '…' };

/**
 * Run-length SVG rects of a pixel grid ('.' is empty).
 * @param {string[]} rows @param {Record<string, string>} colors @param {number} ox @param {number} oy
 * @param {string|null} [only] draw only these pixel chars
 */
function rects(rows, colors, ox, oy, only = null) {
  let out = '';
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let run = 1;
      while (x + run < row.length && row[x + run] === ch) run++;
      if (ch !== '.' && (only === null || only.includes(ch))) {
        out += `<rect x="${x + ox}" y="${y + oy}" width="${run}" height="1" fill="${colors[ch]}"/>`;
      }
      x += run;
    }
  }
  return out;
}

/** @type {Map<string, string>} icon → SVG markup (built on first use) */
const svgCache = new Map();

/** @param {string} icon a key of ICONS */
function iconSvg(icon) {
  let svg = svgCache.get(icon);
  if (svg) return svg;
  let body = rects(BUBBLE, bubbleColors(), 0, 0);
  const def = isOwnKey(ICONS, icon) ? ICONS[icon] : null;
  if (def && def.dots) {
    // the "…" dots appear one after the other (CSS), like the prompt's
    body += `<g class="lu-emote__dot">${rects(def.rows, def.colors, 4, 2, '14')}</g>` +
      `<g class="lu-emote__dot lu-emote__dot--2">${rects(def.rows, def.colors, 4, 2, '25')}</g>` +
      `<g class="lu-emote__dot lu-emote__dot--3">${rects(def.rows, def.colors, 4, 2, '36')}</g>`;
  } else if (def) body += rects(def.rows, def.colors, 4, 2);
  svg = `<svg viewBox="0 0 16 14" aria-hidden="true">${body}</svg>`;
  svgCache.set(icon, svg);
  return svg;
}

/** The widest a bark's text runs before it wraps (art px), per language: about 22 Latin letters, 12 kanji. */
const BARK_MAX = { en: 136, ja: 144, zh: 132 };
/** The bubble's padding round the text (art px): the sides; above the first line box; under the last. */
const PAD_X = 6, PAD_T = 3, PAD_B = 2;

/**
 * G's speech bubble (art/pieces.js `bubble`) painted to a size: a w × h box (the ink outline, the
 * cream paper lit at the top left and shaded at the bottom right, round corners of two pixels), its
 * bottom outline and a four-row tail whose tip is at `tip` (its middle by default) — w × (h + 5)
 * art px.
 * @param {number} w
 * @param {number} h the rows down to the last paper row
 * @param {number} [tip] the tail tip's column
 */
function speechBubble(w, h, tip = Math.floor(w / 2), up = false) {
  const k = pal();
  const O = k.ink0, W = k.kf0, F = k.kf1, Lc = k.kf2;
  // (`up`: the tail on top, pointing up at a speaker above — the body TAIL_UP rows lower)
  const oy = up ? TAIL_UP : 0;
  return art(w, h + 5, (p) => {
    p.hline(2, oy, w - 4, O);
    p.px(1, oy + 1, O); p.px(w - 2, oy + 1, O); p.hline(2, oy + 1, w - 4, W);
    for (let y = 2; y < h - 1; y++) {
      p.px(0, oy + y, O); p.px(w - 1, oy + y, O);
      p.hline(1, oy + y, w - 2, F);
      p.px(1, oy + y, y < h - 3 ? W : y === h - 3 ? F : Lc);
      if (y === 2) p.px(2, oy + y, W);
      if (y >= h - 3) p.px(w - 2, oy + y, Lc);
      if (y === h - 2) p.px(w - 3, oy + y, Lc);
    }
    p.px(1, oy + h - 1, O); p.px(w - 2, oy + h - 1, O); p.hline(2, oy + h - 1, w - 4, Lc);
    p.hline(2, oy + h, w - 4, O);
    const tx = Math.max(5, Math.min(w - 6, tip)) - 2;
    if (!up) {
      // the bottom outline with the tail's mouth, the tail (G's, leaning right)
      p.hline(tx, h, 4, F);
      p.rows(tx - 1, h + 1, ['oFFLo', '.oFLo', '..oLo', '...o.'], { o: O, F, L: Lc });
    } else {
      // the top outline with the mouth, the tail above it (G's mirrored: lit, its tip up)
      p.hline(tx, oy, 4, W);
      p.rows(tx - 1, 0, ['...o.', '..oWo', '.oWWo', 'oWWFo'], { o: O, W, F });
    }
  });
}
/** A bubble turned over (its tail on top): the body this many art px lower in its canvas. */
const TAIL_UP = 4;

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

/**
 * A speech bubble as placed: its art (w × h + 5 art px), its text box; `dx` art px slid sideways
 * to stay on the screen (the tail the other way), `lift` CSS px moved up (negative) or down to
 * clear the interaction prompt, `flip` turned over under the speaker (its tail on top).
 * @typedef {{ art: HTMLCanvasElement, box: HTMLElement, w: number, h: number, dx: number, lift: number, flip: boolean }} SpeechBubble
 */
/**
 * @typedef {{ el: HTMLDivElement, inner: HTMLDivElement, target: THREE.Object3D|null,
 *   pos: THREE.Vector3, offsetY: number, until: number, leaving: number, inView: boolean,
 *   x: number, y: number, fy: number, speech: { text: string, cls: string }|null,
 *   bubble: SpeechBubble|null }} EmoteSlot
 *   speech: the line of a bark (or a text emote) its bubble is laid out from; fy the speaker's feet
 *   on the screen (CSS px: where a bubble turned over hangs from)
 */

export class Emotes {
  /** @param {HTMLElement} parent the UI root (the bubbles are positioned in its coordinate space) */
  constructor(parent) {
    const layer = document.createElement('div');
    layer.className = 'lu-emotes';
    parent.appendChild(layer);
    this.element = layer;
    this._parent = parent;
    /** @type {EmoteSlot[]} shown (or popping out) */
    this._active = [];
    /** @type {EmoteSlot[]} */
    this._pool = [];
    /** Seconds of the pop-out animation (CSS `lu-emote-out`). */
    this.outSeconds = 0.22;
    this._w = parent.clientWidth || window.innerWidth;
    this._h = parent.clientHeight || window.innerHeight;
    this._ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        this._w = parent.clientWidth || window.innerWidth;
        this._h = parent.clientHeight || window.innerHeight;
        for (const s of this._active) s.x = NaN;
      })
      : null;
    if (this._ro) this._ro.observe(parent);
    // the bubbles are sized in art px: a new scale lays the speech bubbles out again
    /** one art px in CSS px (the root's --px) */
    this._cssPx = currentScale(parent)?.cssPx ?? 2;
    this._offScale = onScale(parent, (sc) => {
      this._cssPx = sc.cssPx;
      for (const s of this._active) if (s.speech) this._layoutSpeech(s);
    });
  }

  /** Number of bubbles shown (including ones popping out). */
  get count() { return this._active.length; }

  /**
   * Pop a bubble over a character. A bubble already over `target` is replaced (and pops again).
   * @param {THREE.Object3D|THREE.Vector3} target followed every update (a Vector3 is copied)
   * @param {EmoteIcon|string} icon '!' '?' '…' '♪' '♥' 'zzz' '#' '💧' '✦' (else up to 4 characters
   *   of text)
   * @param {number} [seconds] how long it stays before popping out (1.6; Infinity: until clear())
   * @param {{ offsetY?: number }} [opts] offsetY: world units above the target's origin (2.3: over
   *   a 2-unit character sprite whose origin is at its feet)
   */
  show(target, icon, seconds = 1.6, { offsetY = 2.3 } = {}) {
    const slot = this._open(target, seconds, offsetY, 1.6);
    if (!slot) return;
    let name = typeof icon === 'string' ? icon : '';
    if (isOwnKey(ALIASES, name)) name = ALIASES[name];
    const known = isOwnKey(ICONS, name);
    if (known || !name) slot.inner.innerHTML = iconSvg(known ? name : '');
    else {
      // a word the bubble has no picture for: a small speech bubble with the text
      slot.speech = { text: [...name].slice(0, 4).join(''), cls: 'lu-emote__text' };
      slot.el.classList.add('lu-emote--text');
      this._layoutSpeech(slot);
    }
    slot.el.dataset.icon = known ? name : '';
    this._attach(slot);
  }

  /**
   * Pop a line of speech over a character (no dialog window, nobody held). A bubble already over
   * `target` is replaced.
   * @param {THREE.Object3D|THREE.Vector3} target followed every update (a Vector3 is copied)
   * @param {string} text the line: `{word}` highlighted, a line feed a line break (at most 160 characters)
   * @param {number} [seconds] how long it stays (default: by its length, 2–6 s)
   * @param {{ offsetY?: number }} [opts] as `show`
   * @returns {number} the seconds it stays (0: nothing shown)
   */
  bark(target, text, seconds, { offsetY = 2.3 } = {}) {
    const line = typeof text === 'string' ? [...text.trim()].slice(0, 160).join('') : '';
    if (!line) return 0;
    const shown = line.replace(/[{}\n]/g, '');
    const secs = Number.isFinite(seconds) && seconds > 0 ? seconds : Math.min(6, Math.max(2, 1.4 + shown.length * 0.055));
    const slot = this._open(target, secs, offsetY, secs);
    if (!slot) return 0;
    slot.speech = { text: line, cls: 'lu-bark' };
    slot.el.dataset.icon = '';
    slot.el.classList.add('lu-emote--bark');
    // (a bark from before a conversation steps aside while it runs, story.css; one that a script
    // says during it — its window held — stays)
    slot.el.classList.toggle('is-indialog', this._parent.classList.contains('lu-root--dialog'));
    this._layoutSpeech(slot);
    this._attach(slot);
    return secs;
  }

  /**
   * Remove the bubble over `target` (pops out), or every bubble without an argument.
   * @param {THREE.Object3D} [target]
   * @param {boolean} [instant] remove at once, without the pop-out
   */
  clear(target, instant = false) {
    const now = performance.now();
    for (let i = this._active.length - 1; i >= 0; i--) {
      const s = this._active[i];
      if (target && s.target !== target) continue;
      if (instant) this._release(i);
      else if (!s.leaving) this._leave(s, now);
    }
  }

  /**
   * Project the bubbles and expire old ones. Call once per frame after the camera moved
   * (`UI.update` does).
   * @param {THREE.Camera & { near?: number }} camera
   */
  update(camera) {
    if (!this._active.length) return;
    const now = performance.now();
    if (camera) camera.updateMatrixWorld();
    // the interaction prompt's box, read once a frame and only while a speech bubble is in view
    // (it has moved already this frame: UI.update updates it first)
    /** @type {{ l: number, t: number, r: number, b: number }|null|undefined} */
    let prompt;
    for (let i = this._active.length - 1; i >= 0; i--) {
      const s = this._active[i];
      if (s.leaving) {
        if (now >= s.leaving) { this._release(i); continue; }
      } else if (now >= s.until) this._leave(s, now);
      if (!camera) continue;
      if (s.target) s.target.getWorldPosition(_v);
      else _v.copy(s.pos);
      if (s.bubble) _f.copy(_v);
      _v.y += s.offsetY;
      _v.applyMatrix4(camera.matrixWorldInverse);
      const behind = _v.z > -(camera.near ?? 0.01);
      _v.applyMatrix4(camera.projectionMatrix);
      const shown = !s.target || isShown(s.target);
      const inView = shown && !behind && _v.x > -1.1 && _v.x < 1.1 && _v.y > -1.1 && _v.y < 1.2;
      if (inView !== s.inView) {
        s.inView = inView;
        s.el.classList.toggle('is-inview', inView);
      }
      if (!inView) continue;
      const x = Math.round((_v.x * 0.5 + 0.5) * this._w);
      const y = Math.round((-_v.y * 0.5 + 0.5) * this._h);
      if (x !== s.x || y !== s.y) {
        s.x = x;
        s.y = y;
        s.el.style.transform = `translate3d(${x}px,${y}px,0)`;
      }
      if (s.bubble) {
        _f.project(camera);
        s.fy = Math.round((-_f.y * 0.5 + 0.5) * this._h);
        if (prompt === undefined) prompt = this._promptBox();
        this._place(s, prompt);
      }
    }
  }

  dispose() {
    if (this._ro) this._ro.disconnect();
    this._offScale();
    this._active.length = 0;
    this._pool.length = 0;
    this.element.remove();
  }

  // ------------------------------------------------------------------------------------------

  /**
   * The interaction prompt's box in the layer's CSS px (its bubble and its plate: the prompt's own
   * element is a point), or null while it is not shown (off, out of view, in a dialog, a cutscene
   * or the title). One read of the layout; `update` asks once a frame, only while a speech bubble
   * is in view. Relies on InteractPrompt's `.lu-prompt.is-on.is-inview`.
   * @returns {{ l: number, t: number, r: number, b: number }|null}
   */
  _promptBox() {
    const root = this._parent;
    const c = root.classList;
    if (c.contains('lu-root--dialog') || c.contains('lu-root--cutscene') || c.contains('lu-root--title')) return null;
    const p = root.querySelector(':scope > .lu-prompt.is-on.is-inview');
    if (!p) return null;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const e of p.querySelectorAll('canvas, .tx')) {
      const q = e.getBoundingClientRect();
      if (!q.width || !q.height) continue;
      if (q.left < l) l = q.left;
      if (q.top < t) t = q.top;
      if (q.right > r) r = q.right;
      if (q.bottom > b) b = q.bottom;
    }
    if (l === Infinity) return null;
    const o = this.element.getBoundingClientRect();
    return { l: l - o.left, t: t - o.top, r: r - o.left, b: b - o.top };
  }

  /**
   * Place a speech bubble: keep it on the screen — near a side it slides in (whole art px, 4 from
   * the edge) and its tail moves the other way, so it still points at the speaker —, and clear of
   * the interaction prompt (a companion's bark over the key hint the player needs): lifted so its
   * bottom is 2 art px over the prompt's top, or, without room above, turned over under the
   * speaker's feet (its tail on top) when that clears it; else lifted as far as the screen's top
   * allows. Repainted and moved only when that changes.
   * @param {EmoteSlot} s
   * @param {{ l: number, t: number, r: number, b: number }|null} prompt the prompt's box (`_promptBox`)
   */
  _place(s, prompt) {
    const b = s.bubble;
    const px = this._cssPx;
    const half = (b.w / 2) * px, m = 4 * px;
    let d = 0;
    if (s.x - half < m) d = m - (s.x - half);
    else if (s.x + half > this._w - m) d = this._w - m - (s.x + half);
    const lim = Math.floor(b.w / 2) - 6;
    const dx = Math.max(-lim, Math.min(lim, Math.round(d / px)));
    // clear of the prompt (whole art px)
    let lift = 0, flip = false;
    if (prompt) {
      const H = (b.h + 5) * px, gap = 2 * px;
      const L = s.x + dx * px - half, R = s.x + dx * px + half;
      const hits = (/** @type {number} */ top) => R > prompt.l - gap && L < prompt.r + gap && top + H > prompt.t - gap && top < prompt.b + gap;
      const top0 = s.y - H;
      if (hits(top0)) {
        const up = Math.floor((prompt.t - gap - s.y) / px) * px;
        const fTop = (Number.isFinite(s.fy) ? s.fy : s.y) + gap;
        if (top0 + up >= m) lift = up;
        else if (!hits(fTop) && fTop + H <= this._h - m) { flip = true; lift = fTop + H - s.y; }
        else lift = Math.min(0, Math.ceil((m - top0) / px) * px);
      }
    }
    if (dx === b.dx && lift === b.lift && flip === b.flip) return;
    if (dx !== b.dx || flip !== b.flip) {
      const c = speechBubble(b.w, b.h, Math.floor(b.w / 2) - dx, flip);
      const ctx = b.art.getContext('2d');
      ctx.clearRect(0, 0, b.art.width, b.art.height);
      ctx.drawImage(c, 0, 0);
      if (flip !== b.flip) b.box.style.top = U(PAD_T + (flip ? TAIL_UP : 0));
    }
    b.dx = dx;
    b.lift = lift;
    b.flip = flip;
    s.el.classList.toggle('is-flipped', flip);
    if (dx || lift) s.inner.style.translate = `${U(dx)} ${lift}px`;
    else s.inner.style.removeProperty('translate');
  }

  /**
   * Lay a speech bubble out from its line (a bark, or a text emote): the text in the body type
   * (a text emote: the small labels' type) as wide as its longest line up to BARK_MAX, wrapped, and
   * the bubble painted round it. Measured: one forced layout per bubble (not per frame). When the
   * language's font slices for the line are not loaded yet, it is laid out again once they are.
   * @param {EmoteSlot} slot
   */
  _layoutSpeech(slot) {
    const sp = slot.speech;
    if (!sp) return;
    const k = pal();
    const bark = sp.cls === 'lu-bark';
    const font = bark ? 'body' : 'small';
    const inner = slot.inner;
    inner.textContent = '';
    const natural = Math.max(...sp.text.split('\n').map((ln) => measure(ln, font)));
    // (the widest in letters, not art px: a half-size role is ⅔ of an art px per font pixel at
    // --px 3, so its lines may run that much wider — the same words a line as at --px 2; FONT is
    // current after measure())
    const F = FONT[font];
    const grow3 = F && F.u === 'fpx' ? F.unit * 2 : 1;
    const maxW = bark ? Math.round((BARK_MAX[getLang()] ?? BARK_MAX.en) * grow3) : 60;
    let tw = Math.max(bark ? 10 : 4, Math.min(maxW, natural));
    const box = document.createElement('div');
    box.className = sp.cls;
    // `{word}` → a highlighted span, a line feed → a line break (text nodes only: no markup)
    let hl = false;
    for (const part of sp.text.split(/(\{|\}|\n)/)) {
      if (part === '{') hl = true;
      else if (part === '}') hl = false;
      else if (part === '\n') box.appendChild(document.createElement('br'));
      else if (part) {
        if (hl) {
          const span = document.createElement('span');
          span.className = 'lu-hl';
          span.textContent = part;
          box.appendChild(span);
        } else box.appendChild(document.createTextNode(part));
      }
    }
    styleText(box, font, { maxW: tw, color: k.kink });
    box.style.left = U(PAD_X);
    box.style.top = U(PAD_T);
    inner.appendChild(box);
    // the lines as laid out (a pooled slot is out of the page until attached: count in the layer).
    // The lines start at the bubble's left (whole pixels: centred lines would fall between pixels
    // and thicken); a wrapped text's bubble shrinks to its widest line
    const host = slot.el.isConnected ? null : this.element;
    if (host) host.appendChild(slot.el);
    const lh = parseFloat(getComputedStyle(box).lineHeight) || 1;
    const lines = Math.max(1, Math.round(box.offsetHeight / lh));
    if (lines > 1) {
      const range = document.createRange();
      range.selectNodeContents(box);
      const cssPx = currentScale(this.element)?.cssPx ?? 2;
      const used = Math.ceil(range.getBoundingClientRect().width / cssPx - 0.05);
      if (used > 0 && used < tw) { tw = used; box.style.width = U(tw); }
    }
    if (host) slot.el.remove();
    const w = tw + 2 * PAD_X + ((tw + 2 * PAD_X) % 2);
    const L = FONT[font].L;
    const h = Math.ceil(PAD_T + lines * L + PAD_B);
    const c = speechBubble(w, h);
    c.className = 'lu-bark__art';
    c.setAttribute('aria-hidden', 'true');
    inner.insertBefore(c, box);
    inner.style.width = U(w);
    inner.style.height = U(h + 5);
    inner.style.removeProperty('translate');
    slot.bubble = { art: c, box, w, h, dx: 0, lift: 0, flip: false };
    slot.el.classList.remove('is-flipped');
    slot.x = NaN;
    if (fontsMissing(sp.text)) {
      loadFonts(sp.text).then(() => {
        if (slot.speech === sp && this._active.includes(slot)) this._layoutSpeech(slot);
      });
    }
  }

  /**
   * A slot over `target` (replacing the bubble already there), timed; not yet shown.
   * @param {THREE.Object3D|THREE.Vector3} target
   * @param {number} seconds
   * @param {number} offsetY
   * @param {number} fallback seconds when `seconds` is not a positive number
   * @returns {(EmoteSlot & { replaced?: boolean })|null}
   */
  _open(target, seconds, offsetY, fallback) {
    if (!target) return null;
    const obj = /** @type {THREE.Object3D} */ (target).isObject3D ? /** @type {THREE.Object3D} */ (target) : null;
    const replaced = !!obj && this._active.some((s) => s.target === obj);
    if (replaced) this.clear(obj, true);
    const slot = /** @type {EmoteSlot & { replaced?: boolean }} */ (this._pool.pop() ?? this._create());
    slot.target = obj;
    if (!obj) slot.pos.copy(/** @type {THREE.Vector3} */ (target));
    slot.offsetY = Number.isFinite(offsetY) ? offsetY : 2.3;
    const secs = Number(seconds);
    slot.until = performance.now() + (secs > 0 ? secs * 1000 : fallback * 1000);
    slot.leaving = 0;
    slot.inView = false;
    slot.x = NaN;
    slot.y = NaN;
    slot.fy = NaN;
    slot.replaced = replaced;
    slot.speech = null;
    slot.bubble = null;
    slot.inner.textContent = '';
    slot.inner.style.width = '';
    slot.inner.style.height = '';
    slot.inner.style.removeProperty('translate');
    slot.el.classList.remove('lu-emote--bark', 'lu-emote--text', 'is-indialog', 'is-flipped');
    return slot;
  }

  /** Show a filled slot (`_open`): it pops in. @param {EmoteSlot & { replaced?: boolean }} slot */
  _attach(slot) {
    const el = slot.el;
    // a pooled element is detached while free, so attaching it starts the pop-in anew; one
    // detached and attached again in the same frame (a replaced bubble) is restarted by hand
    el.classList.remove('is-out', 'is-inview');
    el.classList.add('is-on');
    this.element.appendChild(el);
    if (slot.replaced) {
      slot.inner.style.animation = 'none';
      void slot.inner.offsetWidth;
      slot.inner.style.animation = '';
    }
    this._active.push(slot);
  }

  /** @returns {EmoteSlot} */
  _create() {
    const el = document.createElement('div');
    el.className = 'lu-emote';
    el.innerHTML = '<div class="lu-emote__anchor"><div class="lu-emote__inner"></div></div>';
    return {
      el, inner: /** @type {HTMLDivElement} */ (el.querySelector('.lu-emote__inner')),
      target: null, pos: new THREE.Vector3(), offsetY: 2.3, until: 0, leaving: 0, inView: false, x: NaN, y: NaN, fy: NaN, speech: null, bubble: null,
    };
  }

  /** @param {EmoteSlot} s @param {number} now */
  _leave(s, now) {
    s.leaving = now + this.outSeconds * 1000;
    s.el.classList.add('is-out');
  }

  /** @param {number} i index in `_active` */
  _release(i) {
    const s = this._active[i];
    this._active.splice(i, 1);
    s.el.classList.remove('is-on', 'is-out', 'is-inview');
    s.el.remove();
    s.target = null;
    s.speech = null;
    s.bubble = null;
    this._pool.push(s);
  }
}

/** @param {THREE.Object3D} o visible itself and through every parent */
function isShown(o) {
  for (let p = o; p; p = p.parent) if (p.visible === false) return false;
  return true;
}
