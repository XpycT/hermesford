import './ui.css';
import './combat.css';
import { pal, GEMS } from './art/palette.js';
import { art } from './art/painter.js';
import { gem } from './art/gilt.js';
import { fade, rgbOf, hairline } from './art/pieces.js';
import { measure, txt, grow, UP, cjk } from './layout/type.js';
import { put, win } from './layout/layout.js';
import { anchorGroup } from './CombatHUD.js';
import { currentFonts } from './FontLoader.js';

/**
 * Announcer — centred combat announcements (`.lu-announce`, COMBAT.md §13.1–§13.2), drawn after
 * mockup G (docs/specs/PIXEL_UI.md §5): the level-up card ('level', G's `levelUp`: no panel, a
 * stepped radial shade, gold hairlines fading at both ends with a gem, the title in the heading
 * type in capitals, the gains in the line type) and the boss 'results' card (A's framed M window
 * with gold corners and the trio, the title in the heading type, a hairline with a gem, the line
 * in the body type). Queued: each announcement starts when the previous one has ended, and its
 * promise resolves when it has finished. Its own element (never the area Banner); the level card
 * high on the screen (`compact`: a level-up mid-fight, G's place at the top; else a little lower),
 * the results card under it, or where the caller's `y` puts them (below the area banner while it
 * shows: CombatSystem); hidden in photo mode only. While a results card shows the root carries
 * `lu-root--results` (RESULTS_CLASS): the controls legend stays aside until it has gone (the boss
 * bar, whose `lu-root--boss` set it aside, hides 0.5 s into the card; at 1024 × 768 the card's lower
 * left corner covered the legend's top right).
 *
 * `duration` is the whole time on screen, fades included (in 0.45 s, out 0.55 s, in hard steps; at
 * least 1.2 s), counted on the wall clock. CSS animations restart by toggling between two
 * identical keyframe names (no forced layout). The title's text stays as given (`_title`'s
 * textContent; English capitals are CSS), so tests and bots read it as they did.
 *
 * The level card's gains line has G's ink outline; a Japanese or Chinese one (anti-aliased, its
 * outline a font pixel) gets the numbers' outline of one art pixel, so it reads over a pale talk
 * bubble or the sky too.
 */

const IN = 0.45;
const OUT = 0.55;
/** The cards' default tops (art px): the compact level card (G's), the level card, the results card. */
const Y_COMPACT = 48;
const Y_LEVEL = 78;
const Y_RESULTS = 96;
/** The root's class while a results card shows (combat.css: the controls legend steps aside). */
const RESULTS_CLASS = 'lu-root--results';

export class Announcer {
  /** @param {HTMLElement} root the UI root (`#luminati-ui`) */
  constructor(root) {
    this.root = root;
    const el = document.createElement('div');
    el.className = 'lu-announce';
    el.setAttribute('aria-live', 'polite');
    root.appendChild(el);
    this.element = el;
    /** @type {HTMLElement} the title on screen (its text as given) */
    this._title = document.createElement('div');
    /** @type {HTMLElement} the line under it */
    this._sub = document.createElement('div');
    this._queue = Promise.resolve();
    /** Pending timer id → its resolver (dispose resolves them at once). */
    this._pending = new Map();
    this._disposed = false;
    this._flip = false;
    this._showing = false;
    /** Bumped by clear(): queued announcements of an older generation end at once. */
    this._gen = 0;
  }

  /** True while an announcement is on screen. */
  get visible() { return this._showing; }

  /**
   * @param {string} title
   * @param {string} [sub]
   * @param {{ duration?: number, kind?: 'level'|'results', compact?: boolean,
   *   y?: number|(() => (number|null|undefined)) }} [opts] seconds on screen (2.4); 'results': the
   *   framed card; compact: G's place at the top of the screen instead of a little lower (a
   *   level-up in the middle of a fight; additive to COMBAT.md §13.2); y: the card's top in art px
   *   of the 640 × 360 frame instead (the level card's top hairline sits 9 below it, the results
   *   window's frame at it), or a function read when the card shows — it may wait in the queue —
   *   returning one, or null for the default (additive)
   * @returns {Promise<void>} resolves when this announcement has finished
   */
  announce(title, sub = '', { duration = 2.4, kind = 'level', compact = false, y = undefined } = {}) {
    const d = Math.max(IN + OUT + 0.2, Number.isFinite(duration) ? duration : 2.4);
    const k = kind === 'results' ? 'results' : 'level';
    const gen = this._gen;
    const t = String(title ?? '');
    const s = String(sub ?? '');
    /** @type {() => Promise<void>} */
    const run = () => new Promise((resolve) => {
      if (this._disposed || gen !== this._gen) { resolve(); return; }
      const at = typeof y === 'function' ? y() : y;
      this._show(t, s, d, k, !!compact, Number.isFinite(at) ? Number(at) : null);
      const id = setTimeout(() => {
        this._pending.delete(id);
        this._hide();
        resolve();
      }, d * 1000);
      this._pending.set(id, resolve);
    });
    this._queue = this._queue.then(run);
    // the texts' font slices (Japanese, Chinese) start loading now: in by the time it shows
    currentFonts()?.ensure([t, s]);
    return this._queue;
  }

  /**
   * Drop every queued announcement and hide the one on screen (their promises resolve at once) —
   * the combat test `reset()` hook.
   */
  clear() {
    this._gen++;
    for (const [id, resolve] of this._pending) { clearTimeout(id); resolve(); }
    this._pending.clear();
    if (this._showing) this._hide();
  }

  dispose() {
    this._disposed = true;
    for (const [id, resolve] of this._pending) { clearTimeout(id); resolve(); }
    this._pending.clear();
    this.root.classList.remove(RESULTS_CLASS);
    this.element.remove();
  }

  /**
   * @param {string} title
   * @param {string} sub
   * @param {number} d seconds on screen
   * @param {'level'|'results'} kind
   * @param {boolean} compact
   * @param {number|null} y the card's top (art px), null: the kind's default
   */
  _show(title, sub, d, kind, compact, y) {
    const el = this.element;
    el.textContent = '';
    if (kind === 'results') this._results(title, sub, y ?? Y_RESULTS);
    else this._level(title, sub, y ?? (compact ? Y_COMPACT : Y_LEVEL));
    el.style.setProperty('--lu-an-out', `${(d - OUT).toFixed(3)}s`);
    this._flip = !this._flip;
    el.className = `lu-announce lu-announce--${kind}${compact ? ' lu-announce--compact' : ''} ${this._flip ? 'is-a' : 'is-b'}`;
    this.root.classList.toggle(RESULTS_CLASS, kind === 'results');
    this._showing = true;
  }

  /**
   * G's level-up card at y: a stepped shade, hairlines with a gem, the title, the gains.
   * @param {string} title
   * @param {string} sub
   * @param {number} y the card's top (art px)
   */
  _level(title, sub, y) {
    const k = pal();
    const tw = measure(UP(title), 'head', 1), gw = sub ? measure(sub, 'line') : 0;
    let lw = Math.max(102, tw + 40, gw + 30);
    lw += lw % 2;
    const gh = Math.ceil(grow('head'));
    const g = this._card(320 - lw / 2 - 24, y, lw + 48, 56 + gh);
    put(g, fade(lw + 48, 50 + gh, rgbOf(k.band), (u, v) => Math.max(0, 1 - Math.hypot((u - 0.5) / 0.5, (v - 0.5) / 0.5)) * 1.4 * 0.7, [0.25, 0.5, 0.7]), 320 - lw / 2 - 24, y + 2, 1, 'lu-announce__shade');
    put(g, hairline(lw, 'both'), 320 - lw / 2, y + 9, 1, 'lu-announce__rule');
    put(g, art(9, 5, (p) => gem(p, 4, 2, 1, GEMS.gold(), { setting: [k.g5, k.g4, k.g3] })), 316, y + 7);
    put(g, hairline(lw, 'both'), 320 - lw / 2, y + 45 + gh, 1, 'lu-announce__rule lu-announce__rule--b');
    this._title = this._capsTitle(g, title, 320, y + 12, { font: 'head', track: 1, color: k.g5, align: 'center', ol: true, cls: 'lu-announce__title' });
    const ol = cjk() ? { ol8: true } : { ol: true };
    this._sub = txt(g, sub, 320, y + 33 + gh, { font: 'line', color: k.tx1, align: 'center', ...ol, cls: 'lu-announce__sub' });
  }

  /**
   * The results card: A's framed window, the title, a hairline with a gem, the line.
   * @param {string} title
   * @param {string} sub
   * @param {number} y0 the window's top (art px)
   */
  _results(title, sub, y0) {
    const k = pal();
    const tw = measure(UP(title), 'head', 1), sw = sub ? measure(sub, 'body') : 0;
    let W = Math.max(240, tw + 60, sw + 48);
    W += W % 2;
    const gh = Math.ceil(grow('head')), gb = Math.ceil(grow('body'));
    const H = 64 + gh + gb;
    const x0 = 320 - W / 2;
    const g = this._card(x0 - 20, y0 - 20, W + 40, H + 40);
    win(g, { size: 'M', corners: GEMS.gold(), cornerR: 2, trio: true }, x0, y0, W, H);
    this._title = this._capsTitle(g, title, 320, y0 + 11, { font: 'head', track: 1, color: k.g5, align: 'center', drop: true, cls: 'lu-announce__title' });
    const rw = Math.min(W - 40, Math.max(120, tw));
    put(g, hairline(rw, 'both'), 320 - Math.floor(rw / 2), y0 + 38 + gh, 1, 'lu-announce__rule');
    put(g, art(9, 5, (p) => gem(p, 4, 2, 1, GEMS.gold(), { setting: [k.g5, k.g4, k.g3] })), 316, y0 + 36 + gh);
    this._sub = txt(g, sub, 320, y0 + 44 + gh, { font: 'body', color: k.g5, align: 'center', drop: true, cls: 'lu-announce__sub' });
  }

  /**
   * The card's group (`.lu-announce__card`), anchored at the top centre.
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   */
  _card(x, y, w, h) {
    const g = document.createElement('div');
    g.className = 'lu-announce__card';
    anchorGroup(g, 'tc', x, y, w, h, this.root);
    this.element.append(g);
    return g;
  }

  /**
   * The title in capitals (English; CJK has none), placed as the capitals; its text stays the
   * caller's (CSS sets the capitals: `.lu-caps`), so `_title.textContent` reads as given.
   * @param {HTMLElement} g
   * @param {string} title
   * @param {number} x
   * @param {number} y
   * @param {import('./layout/type.js').TextOptions} o
   */
  _capsTitle(g, title, x, y, o) {
    const up = UP(title);
    const el = txt(g, up, x, y, o);
    if (up !== title) { el.textContent = title; el.classList.add('lu-caps'); }
    return el;
  }

  _hide() {
    this._showing = false;
    this.root.classList.remove(RESULTS_CLASS);
    this.element.className = 'lu-announce';
  }
}
