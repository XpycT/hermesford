// (no @fontsource import here: the UI's faces come from FontLoader.js — Google first, else dist/ —
// and Cinzel, Crimson Pro and Pixelify Sans left the game UI, docs/specs/PIXEL_UI.md §4; the
// editor and the sandbox pages that still use them import them themselves)
import './ui.css';
import './layout/base.css';

import { EventEmitter } from '../core/EventEmitter.js';
import { setLang, resolveLang, t, hasStrings } from '../i18n/I18n.js';
import { registerCoreStrings } from '../i18n/strings/index.js';
import { artScale, bindScaleRoot, unbindScaleRoot, scaleRootOf } from './UiScale.js';
import { startFonts, currentFonts, fontsIn } from './FontLoader.js';
import { applyPalette, pal } from './art/palette.js';
import { cursorCss } from './art/cursors.js';
import { art, copyCanvas } from './art/painter.js';
import { gem } from './art/gilt.js';
import { hairline } from './art/pieces.js';
import { setPx as setTypePx, setMeasureHost, measureHost, measure, txc, roleFonts, fontTokens } from './layout/type.js';
import { group, put, key, capW, U } from './layout/layout.js';
import { DialogBox } from './DialogBox.js';
import { Banner } from './Banner.js';
import { TitleScreen } from './TitleScreen.js';
import { HUD } from './HUD.js';
import { InteractPrompt } from './InteractPrompt.js';
import { Fader } from './Fader.js';
import { DebugPanel } from './DebugPanel.js';
import { Minimap, WorldMap } from './Minimap.js';

/**
 * @import * as THREE from 'three'
 * @import { CombatHUD } from './CombatHUD.js'
 * @import { BossBar } from './BossBar.js'
 * @import { WorldLabels } from './WorldLabels.js'
 * @import { Announcer } from './Announcer.js'
 * @import { DeathScreen } from './DeathScreen.js'
 * @import { Journal } from './Journal.js'
 * @import { Emotes } from './Emotes.js'
 * @import { EndCard } from './EndCard.js'
 */

/** The combat UI classes registered by `UI.useCombatUI()` (null: none yet). */
let combatClasses = null;

/**
 * The text edge filters (docs/specs/PIXEL_UI.md §1.4; layout/base.css applies them to text only):
 * the pixel fonts alpha-thresholded, CJK text from 20 CSS px a one-pixel alpha ramp, small CJK text
 * grey anti-aliasing (the filter alone removes the colour fringes).
 */
const SVG_FILTERS = `<svg class="lu-filters" width="0" height="0" aria-hidden="true" focusable="false">
  <filter id="lu-crisp" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
    <feComponentTransfer><feFuncA type="discrete" tableValues="0 1"/></feComponentTransfer>
  </filter>
  <filter id="lu-soft" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
    <feComponentTransfer><feFuncA type="table" tableValues="0 0 1 1"/></feComponentTransfer>
  </filter>
  <filter id="lu-aa" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
    <feComponentTransfer><feFuncA type="identity"/></feComponentTransfer>
  </filter>
</svg>`;

/** The skip ring's 13 states, painted once each (`skipRing`; art px: the same at every scale). @type {HTMLCanvasElement[]} */
const RINGS = [];
/**
 * The cutscene skip hint's ring (15 × 15 art px) with `lit` segments: painted once per state and
 * kept (`paintRing`); callers draw it into a canvas of their own.
 * @param {number} lit 0–12
 * @returns {HTMLCanvasElement}
 */
function skipRing(lit) {
  const i = Math.max(0, Math.min(12, Math.round(lit)));
  return RINGS[i] ?? (RINGS[i] = paintRing(i));
}

/**
 * The cutscene skip hint's ring (15 × 15 art px): a 2-px ring in 12 segments with ink gaps round a
 * dusk gem, the first `lit` segments gilt clockwise from the top (the newest the brightest); all
 * twelve light the gem too.
 * @param {number} lit 0–12
 * @returns {HTMLCanvasElement}
 */
function paintRing(lit) {
  const k = pal();
  const seg = Math.PI / 6;
  return art(15, 15, (p) => {
    for (let y = 0; y < 15; y++) {
      for (let x = 0; x < 15; x++) {
        const dx = x - 7, dy = y - 7, d = Math.hypot(dx, dy);
        if (d > 7.4) continue;
        // ink round the outside and the inside of a 2-px ring, the ink glass in the middle
        if (d > 6.4 || (d > 3.6 && d <= 4.4)) { p.px(x, y, k.ink0); continue; }
        if (d <= 3.6) { p.px(x, y, k.ink1); continue; }
        // the ring: 12 segments clockwise from the top, an ink gap between them
        let a = Math.atan2(dx, -dy);
        if (a < 0) a += Math.PI * 2;
        const i = Math.min(11, Math.floor(a / seg));
        const edge = Math.min(a - i * seg, (i + 1) * seg - a) * d;
        if (edge < 0.55) { p.px(x, y, k.ink0); continue; }
        const on = i < lit, lead = on && i === lit - 1 && lit < 12, outer = d > 5.4;
        p.px(x, y, on ? (lead ? (outer ? k.tx1 : k.g4) : (outer ? k.g4 : k.g2)) : (outer ? k.dm2 : k.dm3));
      }
    }
    const full = lit >= 12;
    gem(p, 7, 7, 1, full ? [k.g2, k.g4, k.g5] : [k.ink2, k.ink3, k.ink4], { setting: full ? [k.g5, k.g4, k.g3] : [k.dm1, k.dm2, k.dm3] });
  });
}

/**
 * The Luminati DOM overlay: composes the dialog box, area banner, title screen, HUD, interaction
 * prompt, fader and debug panel inside one `#luminati-ui` root. The root ignores the pointer; only
 * interactive children (dialog window, choices, title screen, debug panel) receive events.
 * Combat levels call `enableCombat()` once, which adds the combat components (COMBAT.md §13:
 * vitals, skill bar, loot feed, boss bar, world labels, announcer, death screen) as `ui.combat`.
 * The combat classes reach it from the caller — registered once with `UI.useCombatUI(classes)`
 * (CombatSystem imports them from their own files) or passed as `enableCombat(classes)` — so this
 * module never uses them itself and a peaceful level's bundle does not hold them (COMBAT-17; the
 * re-exports at the end are side-effect free, vite.config.js).
 *
 * Story levels call `useStoryUI({ Journal, Emotes, EndCard })` once, which adds the journal, the
 * emote bubbles, the end card and the cutscene letterbox with its skip hint (`setCutscene`,
 * `setSkipHint`); the classes come from the caller for the same reason (they and `story.css` stay
 * out of a level without a story).
 *
 * The party's first join calls `usePartyUI({ PartyPanel, PartyFrames })` once (docs/specs/PARTY.md
 * §6): the tactics panel and the party's HUD frames, as `ui.party`; likewise from the caller (the
 * party chunk), so a game nobody joins holds neither them nor `party.css`.
 *
 * Keyboard shortcuts (help, debug, photo mode) are left to the game so they can be rebound:
 * e.g. `if (input.actionPressed('debug')) ui.debug.toggle()`.
 *
 * The pixel UI's root (docs/specs/PIXEL_UI.md §3): the root carries mockup G's palette as
 * `--g-<token>` (art/palette.js) and the art scale — `--px` (one art pixel), `--fpx` (one half-size
 * font pixel), both whole device pixels, and `--shrink` (UiScale.js) — recomputed on a window
 * resize, a device-pixel-ratio change and (a contained root) its container's resize, announced as
 * `ui.on('scale', …)` once the type and the fonts follow it. A component reaches it from its parent
 * element alone: UiScale.js `onScale(parent, fn)` / `currentScale(parent)`, or `UI.of(el)`. It
 * holds the three SVG text filters (#lu-crisp, #lu-soft, #lu-aa) and the measure host, registers
 * the core string tables (src/engine/i18n/strings/) and waits for the language's fonts
 * (FontLoader.js: `fontsReady`).
 */
export class UI {
  /**
   * @param {HTMLElement} [container] element to overlay (document.body → fixed full-screen)
   * @param {{ lang?: string, fonts?: import('./FontLoader.js').FontLoader|null }} [opts] lang: the
   *   page's language (src/main.js sets it; without it the UI resolves it itself: `?lang=`, the saved
   *   choice, else English); fonts: the page's font loader (default: the one `startFonts()` made, or
   *   a new one)
   */
  constructor(container = document.body, { lang, fonts } = {}) {
    const root = document.createElement('div');
    root.id = 'luminati-ui';
    root.className = 'lu-root';
    if (container !== document.body) {
      root.classList.add('lu-root--contained');
      if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    }
    container.appendChild(root);

    this.container = container;
    /** @type {HTMLDivElement} */
    this.root = root;

    // ---- the pixel UI's root: language, strings, palette, filters, measure host, scale, fonts ----
    /** @type {'en'|'ja'|'zh'} the page's language (docs/specs/I18N.md §1) */
    this.lang = setLang(lang !== undefined ? lang : resolveLang());
    registerCoreStrings();
    applyPalette(root);
    if (!document.getElementById('lu-crisp')) root.insertAdjacentHTML('afterbegin', SVG_FILTERS);
    /** An always-laid-out, invisible box for measuring text (layout/type.js `lineCount`). */
    this.measureHost = document.createElement('div');
    this.measureHost.className = 'lu-measure';
    this.measureHost.setAttribute('aria-hidden', 'true');
    root.appendChild(this.measureHost);
    setMeasureHost(this.measureHost);
    /** @type {import('./FontLoader.js').FontLoader} the page's font loader */
    this.fonts = fonts ?? currentFonts() ?? startFonts({ lang: this.lang });
    /** 'scale' events (`on('scale', fn)`). */
    this._events = new EventEmitter();
    /** @type {import('./UiScale.js').ArtScale|null} */
    this._scale = null;
    this._disposed = false;
    this._onResize = () => this._updateScale();
    this._onDpr = () => { this._watchDpr(); this._updateScale(); };
    /** @type {MediaQueryList|null} */
    this._dprQuery = null;
    /** @type {ResizeObserver|null} */
    this._resizeObs = null;
    /**
     * Where the mouse cursors are set (art/cursors.js): the page (`<html>`) for a full-screen UI,
     * else the container; `_cursorKey` the scale they were painted for.
     */
    this._cursorEl = container === document.body ? document.documentElement : container;
    this._cursorKey = '';
    this._updateScale();
    // components find the root's scale from their parent element (UiScale.js onScale / currentScale)
    bindScaleRoot(this);
    window.addEventListener('resize', this._onResize);
    this._watchDpr();
    if (container !== document.body && typeof ResizeObserver !== 'undefined') {
      this._resizeObs = new ResizeObserver(() => this._updateScale());
      this._resizeObs.observe(container);
    }
    // DOM order doubles as a paint-order fallback; z-index in ui.css is authoritative.
    /** @type {InteractPrompt} */
    this.prompt = new InteractPrompt(root);
    /** @type {HUD} */
    this.hud = new HUD(root);
    /** @type {Minimap} HUD minimap (hidden until it gets a map: `minimap.setMap()`) */
    this.minimap = new Minimap(this.hud.element, { anchor: this.hud.clockElement });
    /** @type {Banner} */
    this.banner = new Banner(root);
    /** @type {DialogBox} */
    this.dialog = new DialogBox(root);
    /** @type {TitleScreen} */
    this.title = new TitleScreen(root);
    /** @type {WorldMap} full-screen world map overlay (`worldMap.setMap()`, `open()` / `close()`) */
    this.worldMap = new WorldMap(root);
    /** @type {Fader} */
    this.fader = new Fader(root);
    /** @type {DebugPanel} */
    this.debug = new DebugPanel(root, { anchor: this.hud.clockElement });

    /**
     * Combat components, created by `enableCombat()` on combat levels only (null otherwise):
     * `{ hud: CombatHUD, boss: BossBar, labels: WorldLabels, announcer: Announcer, death: DeathScreen }`.
     */
    this.combat = null;

    /** @type {Journal|null} the story journal (`useStoryUI()`; null without a story) */
    this.journal = null;
    /** @type {Emotes|null} emote bubbles over characters (`useStoryUI()`; null without a story) */
    this.emotes = null;
    /** @type {EndCard|null} the story's end card (`useStoryUI()`; null without a story) */
    this.endCard = null;
    /**
     * The party's tactics panel and HUD frames (`usePartyUI()`, docs/specs/PARTY.md §6; null until
     * someone joins the party).
     * @type {{ panel: import('../../game/party/types.js').PartyPanelLike, frames: import('../../game/party/types.js').PartyFramesLike }|null}
     */
    this.party = null;
    /**
     * The cutscene's letterbox and skip hint (`useStoryUI()`; null without the story UI): the bars,
     * their gilt hairlines, the skip hint's group (laid out per scale) and its ring.
     * @type {{ letterbox: HTMLElement, bars: HTMLElement[], lines: HTMLCanvasElement[],
     *   skip: HTMLElement|null, ring: HTMLCanvasElement|null, off: () => void, job: number, fontsFor?: string }|null}
     */
    this._story = null;
    this._cutscene = false;
    this._hudShown = true;
    this._skipOn = false;
    /** the skip ring's lit segments (0–12; -1: not drawn yet) */
    this._skipLit = -1;
    /** the skip hint's keycap */
    this._skipKey = 'Esc';

    this._visible = true;
    this._talking = false;
    this._titled = false;

    /**
     * Resolves when the UI's web fonts are loaded — the language's pixel UI fonts with their
     * aliases and the pixel glyphs (FontLoader.js; Google first, else dist/) — never rejects. Game
     * awaits it before the first layout of the HUD and the title.
     * @type {Promise<void>}
     */
    this.fontsReady = typeof document !== 'undefined' && document.fonts
      ? this.fonts.ready.catch(() => null).then(() => undefined)
      : Promise.resolve();
  }

  /**
   * The UI whose root `el` is in (its nearest `.lu-root`), else the page's newest UI; null without
   * one. For a component made with only its parent element (`new HUD(root)`).
   * @param {Element|null} [el]
   * @returns {UI|null}
   */
  static of(el = null) {
    const src = scaleRootOf(el);
    return src instanceof UI ? src : null;
  }

  /**
   * Subscribe to the root's events: 'scale' (the art scale changed: px, fpx, shrink, the screen's
   * art size or the device pixel ratio; the listener gets the `ArtScale`). It fires once the type
   * (layout/type.js) and the fonts follow the new scale — a Japanese or Chinese page's Jersey
   * aliases rebuilt for it — so `measure()` is right inside the listener; a newer change in the
   * meantime supersedes it (one event, for the latest scale). Re-lay out on it.
   * @param {'scale'} event
   * @param {(scale: import('./UiScale.js').ArtScale) => void} fn
   * @returns {() => void} unsubscribe
   */
  on(event, fn) { return this._events.on(event, fn); }

  /**
   * Unsubscribe a listener of `on()`.
   * @param {'scale'} event
   * @param {Function} fn
   */
  off(event, fn) { this._events.off(event, fn); }

  /** The current art scale (UiScale.js `artScale` of the root's size). */
  get scale() { return /** @type {import('./UiScale.js').ArtScale} */ (this._scale); }
  /** One art pixel in device pixels (whole, ≥ 2). */
  get px() { return this._scale.px; }
  /** One half-size font pixel in device pixels (whole, ≥ 1). */
  get fpx() { return this._scale.fpx; }
  /** The corner groups' scale: 1 from 1024 × 600 device px up (UiScale.js `cornerShrink`). */
  get shrink() { return this._scale.shrink; }
  /** The corner groups' scale (the same as `shrink`; UiScale.js). */
  get cornerShrink() { return this._scale.cornerShrink; }
  /** The root's width in art pixels. */
  get artW() { return this._scale.artW; }
  /** The root's height in art pixels. */
  get artH() { return this._scale.artH; }

  /**
   * Measure the root's screen and, when the art scale changed, write it onto the root (`--px`,
   * `--fpx` in CSS px, `--shrink` and `--shrink-corner` (the corner groups' scale), `--lu-dpx`;
   * `data-lu-scale` 'crisp' or 'shrunk' (the corner groups'); the font tokens of the language's
   * roles, `--lu-font-*`), hand it to the type (layout/type.js) and the font aliases, and emit
   * 'scale' once the aliases are in. Also
   * while the UI is hidden. A zero-sized screen (a contained root not laid out yet, or collapsed)
   * keeps the last scale (the window's, before the first).
   */
  _updateScale() {
    const fixed = this.container === document.body;
    let w = fixed ? window.innerWidth : this.container.clientWidth;
    let h = fixed ? window.innerHeight : this.container.clientHeight;
    if (!(w > 0 && h > 0)) {
      if (this._scale) return;
      w = window.innerWidth || 1280;
      h = window.innerHeight || 720;
    }
    const s = artScale({ w, h, dpr: window.devicePixelRatio || 1 });
    const p = this._scale;
    if (p && p.px === s.px && p.fpx === s.fpx && p.shrink === s.shrink && p.artW === s.artW && p.artH === s.artH && p.dpr === s.dpr) return;
    this._scale = s;
    const st = this.root.style;
    st.setProperty('--px', `${+s.cssPx.toFixed(6)}px`);
    st.setProperty('--fpx', `${+s.cssFpx.toFixed(6)}px`);
    st.setProperty('--shrink', `${+s.shrink.toFixed(6)}`);
    st.setProperty('--shrink-corner', `${+s.cornerShrink.toFixed(6)}`);
    st.setProperty('--lu-dpx', `${+(1 / s.dpr).toFixed(6)}px`);
    // the edge filters work at a whole device scale; shrunk corner groups are not one (an
    // attribute, not a class: the root's class list is the UI's state, which tests compare)
    this.root.dataset.luScale = s.cornerShrink === 1 ? 'crisp' : 'shrunk';
    setTypePx(s.px);
    this._applyCursors(s);
    // the roles' font stacks as tokens (ui.css: the root's own font; hud.css: the debug panel)
    for (const [name, value] of Object.entries(fontTokens())) st.setProperty(name, value);
    // 'scale' once the fonts follow (a CJK page's Jersey aliases are rebuilt for the new px, and
    // measure() reads them); a newer scale in the meantime emits instead
    const fontsIn = this.fonts ? this.fonts.setScale(s.px) : Promise.resolve();
    fontsIn.then(() => { if (this._scale === s && !this._disposed) this._events.emit('scale', s); });
  }

  /**
   * The mouse cursors at scale `s` (art/cursors.js): G's gilt arrow (`--lu-cursor`) and the gauntlet
   * over what a click acts on (`--lu-cursor-pointer`, the UI's stylesheets) on the page — the class
   * `lu-cursors` puts the arrow on everything under it (ui.css). Painted again only when the
   * cursor's pixels change (the art scale or the device pixel ratio).
   * @param {import('./UiScale.js').ArtScale} s
   */
  _applyCursors(s) {
    const key = `${s.px}|${s.dpr}`;
    if (key === this._cursorKey) return;
    this._cursorKey = key;
    const el = this._cursorEl;
    el.style.setProperty('--lu-cursor', cursorCss('arrow', s, 'auto'));
    el.style.setProperty('--lu-cursor-pointer', cursorCss('pointer', s, 'pointer'));
    el.classList.add('lu-cursors');
  }

  /** Follow the device pixel ratio (browser zoom, a move to another screen). */
  _watchDpr() {
    this._dprQuery?.removeEventListener('change', this._onDpr);
    this._dprQuery = typeof matchMedia === 'function' ? matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
    this._dprQuery?.addEventListener('change', this._onDpr);
  }

  /**
   * Register the combat UI classes once (`src/engine/ui/{CombatHUD,BossBar,WorldLabels,Announcer,
   * DeathScreen}.js`) for `enableCombat()` (additive; CombatSystem does it before enabling). Kept
   * out of this module's imports so a peaceful level's bundle does not hold them (COMBAT-17).
   * @param {{ CombatHUD: Function, BossBar: Function, WorldLabels: Function, Announcer: Function, DeathScreen: Function }} classes
   */
  static useCombatUI(classes) {
    combatClasses = classes ?? null;
  }

  /**
   * Create the combat UI (COMBAT.md §13.1): combat HUD, boss bar, world labels, announcer and
   * death screen, plus the root class `lu-root--combat`. The world labels keep out of the HUD
   * panels (COMBAT-07) and the death screen is pre-rendered once (COMBAT-02). Idempotent; peaceful
   * levels never call it. The classes are the ones registered with `UI.useCombatUI()`, or
   * `classes` when given (either way the caller imports them — also re-exported by this module and
   * the engine barrel), so importing this module does not pull the combat UI into a peaceful
   * level's bundle (COMBAT-17). Throws when neither holds them.
   * @param {{ CombatHUD: typeof CombatHUD, BossBar: typeof BossBar,
   *   WorldLabels: typeof WorldLabels, Announcer: typeof Announcer,
   *   DeathScreen: typeof DeathScreen }} classes default: the registered ones
   * @returns {{ hud: CombatHUD, boss: BossBar,
   *   labels: WorldLabels, announcer: Announcer,
   *   death: DeathScreen }}
   */
  enableCombat(classes = combatClasses) {
    if (this.combat) return this.combat;
    const { CombatHUD, BossBar, WorldLabels, Announcer, DeathScreen } = classes ?? {};
    if (!CombatHUD || !BossBar || !WorldLabels || !Announcer || !DeathScreen) {
      throw new Error('UI.enableCombat: register the combat UI classes first (UI.useCombatUI({ CombatHUD, BossBar, WorldLabels, Announcer, DeathScreen })) or pass them');
    }
    const hudEl = this.hud.element;
    this.combat = {
      hud: new CombatHUD(hudEl, { anchor: hudEl.querySelector('.lu-loc') }),
      boss: new BossBar(hudEl),
      labels: new WorldLabels(this.root),
      announcer: new Announcer(this.root),
      death: new DeathScreen(this.root),
    };
    this.root.classList.add('lu-root--combat');
    const c = this.combat;
    // COMBAT-07: numbers, bars, pips, alerts, the reticle and edge arrows keep out of the HUD
    // panels (the label layer is under the HUD)
    this._setLabelPanels();
    // COMBAT-02: pre-render the death screen (its first show was one long frame) once the fonts
    // are in, with the texts it will show (the combat namespace, CombatSystem registers it; a
    // sandbox without it primes the English)
    this.fontsReady.then(() => {
      if (this.combat !== c) return;
      const has = hasStrings('combat');
      c.death.prime({
        title: has ? t('combat.death.title') : 'You Have Fallen',
        prompt: has ? t('combat.death.prompt', { place: t('combat.place.camp') }) : 'Press any key to rise at the camp',
      });
    });
    return c;
  }

  /**
   * The HUD panels the combat's world labels keep out of (COMBAT-07): the location plate, clock,
   * minimap, legend (or its tab while it is folded), vitals, skill bar and boss bar (a zone of its own, `merge: false`) — and the
   * party frames once there is a party. `shown` reads class / JS state only. No-op without the
   * combat UI.
   */
  _setLabelPanels() {
    const c = this.combat;
    if (!c) return;
    const hud = this.hud;
    const loc = hud.locationElement;
    const help = hud.helpElement;
    const tab = hud.helpTabElement;
    const frames = this.party?.frames;
    c.labels.setPanels([
      { el: loc, shown: () => !loc.classList.contains('is-empty') },
      hud.clockElement,
      { el: this.minimap.element, shown: () => this.minimap.visible },
      { el: help, shown: () => !help.classList.contains('is-hidden') },
      { el: tab, shown: () => !tab.classList.contains('is-hidden') && !tab.classList.contains('is-empty') },
      c.hud.vitalsElement,
      c.hud.skillsElement,
      // (never merged: with the skill bar beside it the one zone covered the open lower middle)
      { el: c.boss.element, shown: () => c.boss.visible, merge: false },
      ...(frames && 'element' in frames && frames.element instanceof HTMLElement
        ? [{ el: frames.element, shown: () => !!(/** @type {{ visible?: boolean }} */ (frames).visible) }]
        : []),
    ]);
  }

  /**
   * Remove the combat UI again (a campaign leaving a combat level for a peaceful one): every
   * combat component is disposed and the root class dropped. No-op without one.
   */
  disableCombat() {
    const c = this.combat;
    if (!c) return;
    this.combat = null;
    c.death.dispose();
    c.announcer.dispose();
    c.labels.dispose();
    c.boss.dispose();
    c.hud.dispose();
    this.root.classList.remove('lu-root--combat');
  }

  /**
   * Add the party UI (docs/specs/PARTY.md §6): the tactics panel (`.lu-party`, a root child at
   * z 7) and the party's HUD frames (`.lu-pframes`, inside the HUD: they hide with it), made from
   * the classes the game passes (src/game/party/partyUI.js, the party chunk — this module imports
   * neither them nor `party.css`, so a game nobody joins holds none of it). Once; later calls
   * return the same; null (nothing made) without both classes. From then on `update()` reads the
   * panel's input while it is open, and on a combat level the world labels keep out of the frames.
   * @param {import('../../game/party/types.js').PartyUIClasses|null} classes
   * @returns {{ panel: import('../../game/party/types.js').PartyPanelLike, frames: import('../../game/party/types.js').PartyFramesLike }|null}
   */
  usePartyUI(classes) {
    if (this.party) return this.party;
    if (!classes?.PartyPanel || !classes?.PartyFrames) return null;
    this.party = { panel: new classes.PartyPanel(this.root), frames: new classes.PartyFrames(this.root) };
    this._setLabelPanels();
    return this.party;
  }

  /**
   * Create the story UI (story levels only; idempotent): `journal`, `emotes` and `endCard` from the
   * given classes (`src/engine/ui/{Journal,Emotes,EndCard}.js` — the caller imports them, so this
   * module and a level without a story hold none of them, nor `story.css` nor the 'story-ui'
   * strings, which the components register), plus the cutscene letterbox and the skip hint
   * (`setCutscene`, `setSkipHint`), and the root class `lu-root--story`. From then on `update()`
   * updates them. Throws when a class is missing.
   * @param {{ Journal: typeof Journal, Emotes: typeof Emotes, EndCard: typeof EndCard }} classes
   * @returns {{ journal: Journal, emotes: Emotes, endCard: EndCard }}
   */
  useStoryUI(classes) {
    if (this._story) return { journal: this.journal, emotes: this.emotes, endCard: this.endCard };
    const { Journal, Emotes, EndCard } = classes ?? {};
    if (!Journal || !Emotes || !EndCard) {
      throw new Error('UI.useStoryUI: pass the story UI classes ({ Journal, Emotes, EndCard }, imported from src/engine/ui/)');
    }
    const root = this.root;
    // the components first: they register the 'story-ui' strings the skip hint reads
    this.emotes = new Emotes(root);
    // emotes paint over the prompt (both z 1), under everything else
    root.insertBefore(this.emotes.element, this.prompt.element.nextSibling);
    this.journal = new Journal(root);
    this.endCard = new EndCard(root);
    // the letterbox (z 2) goes before the HUD (z 2): the HUD's toasts paint over the top bar
    const letterbox = document.createElement('div');
    letterbox.className = 'lu-letterbox';
    letterbox.innerHTML = `
      <div class="lu-letterbox__bar lu-letterbox__bar--top"></div>
      <div class="lu-letterbox__bar lu-letterbox__bar--bottom"></div>`;
    root.insertBefore(letterbox, this.hud.element);
    const bars = /** @type {HTMLElement[]} */ ([...letterbox.querySelectorAll('.lu-letterbox__bar')]);
    this._story = { letterbox, bars, lines: [], skip: null, ring: null, off: () => {}, job: 0 };
    this._skipLit = -1;
    this._layoutStory();
    this._story.off = this.on('scale', () => this._layoutStory());
    root.classList.add('lu-root--story');
    return { journal: this.journal, emotes: this.emotes, endCard: this.endCard };
  }

  /**
   * Lay the letterbox and the skip hint out for the scale (`useStoryUI`, then on every 'scale';
   * docs/specs/PIXEL_UI.md §5): the bars solid ink, a whole number of art px tall (about 11 % of
   * the screen, a multiple of 8 so the slide moves in whole 8-art-px steps), a 1-art-px gilt
   * hairline on each bar's inner edge; the skip hint at the bottom right, centred on the bottom
   * bar — a ring of 12 segments that light as the key is held, then the 'story-ui' template "Hold
   * {key} to skip" with the key as G's keycap. A language's glyphs not loaded yet: laid out again
   * once they are.
   */
  _layoutStory() {
    const st = this._story;
    if (!st) return;
    const k = pal();
    const sc = this._scale;
    const aw = Math.ceil(sc.W / sc.px), ah = sc.artH;
    const steps = Math.max(4, Math.round(ah * 0.11 / 8));
    const bh = steps * 8;
    st.letterbox.style.setProperty('--lu-bar', U(bh));
    for (const b of st.bars) b.style.transitionTimingFunction = `steps(${steps}, end)`;
    // the hairlines: dim gilt, fading to dots toward both ends
    for (const c of st.lines) c.remove();
    st.lines = st.bars.map((b, i) => {
      const c = hairline(aw, 'both', k.g2);
      c.className = `lu-letterbox__line lu-letterbox__line--${i ? 'bottom' : 'top'}`;
      c.style.width = U(aw);
      c.style.height = U(1);
      b.append(c);
      return c;
    });
    // the skip hint: ◌ Hold [Esc] to skip
    const wasOn = this._skipOn;
    st.skip?.remove();
    const tpl = t('story-ui.skip.hold');
    const [before, after] = tpl.includes('{key}') ? tpl.split('{key}', 2).map((x) => x.trim()) : [tpl.trim(), ''];
    const kw = capW(this._skipKey);
    const bw = before ? measure(before, 'line') : 0, tw = after ? measure(after, 'line') : 0;
    const w = 15 + 5 + bw + (bw ? 3 : 0) + kw + (tw ? 3 : 0) + tw;
    const y0 = Math.round(360 - bh / 2 - 7.5);
    const g = group(st.letterbox, 'br', 630 - w, y0, w, 15, `lu-skip${wasOn ? ' is-on' : ''}`);
    g.setAttribute('aria-hidden', 'true');
    let x = 630 - w;
    const ring = copyCanvas(skipRing(Math.max(0, this._skipLit)));
    put(g, ring, x, y0, 1, 'lu-skip__ring');
    x += 15 + 5;
    const ty = y0 + 7.5;
    if (before) { txc(g, before, x, ty, { font: 'line', color: k.tx2, drop: true, cls: 'lu-skip__text' }); x += bw + 3; }
    key(g, this._skipKey, x, y0 + 2, { cls: 'lu-skip__key' });
    x += kw + 3;
    if (after) txc(g, after, x, ty, { font: 'line', color: k.tx2, drop: true, cls: 'lu-skip__text' });
    g.classList.toggle('is-full', this._skipLit >= 12);
    st.skip = g;
    st.ring = ring;
    // a language's glyphs not loaded yet (CJK slices): lay it out again once they are (once per
    // text: a face that never loads must not lay it out over and over)
    try {
      if (st.fontsFor !== tpl && !roleFonts().every((f) => fontsIn(tpl, f))) {
        st.fontsFor = tpl;
        const job = ++st.job;
        this.fonts?.ensure(tpl).then(() => { if (this._story === st && st.job === job) this._layoutStory(); });
      }
    } catch { /* no font API: laid out as it is */ }
  }

  /**
   * Remove the story UI again (dispose the journal, emotes and end card, drop the letterbox and the
   * cutscene state). No-op without it.
   */
  disableStoryUI() {
    const st = this._story;
    if (!st) return;
    this._story = null;
    st.off();
    st.job++;
    this.endCard.dispose();
    this.journal.dispose();
    this.emotes.dispose();
    this.endCard = null;
    this.journal = null;
    this.emotes = null;
    st.letterbox.remove();
    this._cutscene = false;
    this._skipOn = false;
    this._skipLit = -1;
    this.root.classList.remove('lu-root--story', 'lu-root--cutscene');
    if (!this._hudShown) this.setHudVisible(true);
  }

  /** True between `setCutscene(true)` and `setCutscene(false)`. */
  get cutscene() { return this._cutscene; }

  /**
   * Cutscene mode (story UI only — a no-op before `useStoryUI()`): ink letterbox bars slide in at
   * the top and bottom (about 11 % of the screen in whole art px, 0.4 s in 8-art-px steps, a gilt
   * hairline on their inner edges); the HUD panels, the interaction prompt and combat labels
   * step aside (toasts stay, over the top bar); the dialog, banner and emotes stay visible.
   * Leaving it also hides the skip hint.
   * @param {boolean} on
   * @returns {boolean} whether cutscene mode is on now
   */
  setCutscene(on) {
    if (!this._story) return false;
    this._cutscene = !!on;
    this.root.classList.toggle('lu-root--cutscene', this._cutscene);
    if (!this._cutscene) this.setSkipHint(false);
    return this._cutscene;
  }

  /** Whether the HUD panels are shown (`setHudVisible`). */
  get hudVisible() { return this._hudShown; }

  /**
   * Show / hide the HUD panels only — location plate, clock, controls legend, minimap and the
   * combat HUD; toasts stay — unlike `setVisible`, which hides the dialog and everything else too.
   * @param {boolean} on
   */
  setHudVisible(on) {
    this._hudShown = !!on;
    this.root.classList.toggle('lu-root--nohud', !this._hudShown);
  }

  /**
   * The "Hold Esc to skip" hint at the bottom right (on the bottom letterbox bar), with a ring of
   * 12 segments that light in steps with `progress` (story UI only — a no-op before
   * `useStoryUI()`). Cheap to call every frame: the DOM changes only when the state, the key or
   * the lit segments do.
   * @param {boolean} on
   * @param {number} [progress] 0..1 (how long the skip key has been held)
   * @param {{ key?: string }} [opts] key: the keycap shown ('Esc')
   */
  setSkipHint(on, progress = 0, { key: keyName } = {}) {
    const st = this._story;
    if (!st) return;
    const shown = !!on;
    if (keyName !== undefined && String(keyName) !== this._skipKey) {
      this._skipKey = String(keyName);
      this._layoutStory();
    }
    if (shown !== this._skipOn) {
      this._skipOn = shown;
      st.skip?.classList.toggle('is-on', shown);
    }
    const lit = Math.round(Math.min(1, Math.max(0, Number(progress) || 0)) * 12);
    if (lit !== this._skipLit) {
      this._skipLit = lit;
      if (st.ring) {
        const ctx = st.ring.getContext('2d');
        ctx.clearRect(0, 0, st.ring.width, st.ring.height);
        ctx.drawImage(skipRing(lit), 0, 0);
      }
      st.skip?.classList.toggle('is-full', lit >= 12);
    }
  }

  /** Whether the overlay is shown (false = photo mode). */
  get visible() { return this._visible; }

  /**
   * Show / hide the whole overlay (photo mode). The fader stays active.
   * @param {boolean} visible
   */
  setVisible(visible) {
    this._visible = !!visible;
    this.root.classList.toggle('lu-root--hidden', !this._visible);
  }

  /**
   * Per-frame update: typewriter + dialog input, prompt projection, HUD; with the story UI also the
   * end card's and the journal's input and the emote bubbles; with the party UI the tactics panel's
   * input while it is open (before the dialog's, like the journal's).
   * @param {number} dt seconds
   * @param {{ camera?: THREE.Camera, input?: { actionPressed(name: string): boolean } }} [ctx]
   */
  update(dt, ctx) {
    const camera = ctx ? ctx.camera : undefined;
    const input = ctx ? ctx.input : undefined;
    // dialog only takes input while the overlay is visible and the title screen is gone
    const acceptInput = this._visible && !this.title.visible;
    let dialogInput = acceptInput ? input : undefined;
    if (this._story) {
      // the end card, then the journal (both z 7, over the dialog) take the input first
      if (this.endCard.active) {
        this.endCard.update(dt, this._visible ? input : undefined);
        dialogInput = undefined;
      }
      if (this.journal.isOpen) {
        this.journal.update(dt, dialogInput);
        dialogInput = undefined;
      }
    }
    // the party's tactics panel (z 7, like the journal: never open with it) takes the input next
    const panel = this.party?.panel;
    if (panel?.isOpen) {
      panel.update(dt, dialogInput);
      dialogInput = undefined;
    }
    this.dialog.update(dt, dialogInput);
    // state classes: dialog tucks the controls legend & prompt away, title hides HUD & prompt
    const talking = this.dialog.isOpen;
    if (talking !== this._talking) {
      this._talking = talking;
      this.root.classList.toggle('lu-root--dialog', talking);
    }
    const titled = this.title.visible;
    if (titled !== this._titled) {
      this._titled = titled;
      this.root.classList.toggle('lu-root--title', titled);
    }
    if (camera) this.prompt.update(camera);
    if (camera && this.emotes) this.emotes.update(camera);
    if (camera && this.combat) this.combat.labels.update(dt, camera);
    this.hud.update(dt);
  }

  dispose() {
    this.disableStoryUI();
    if (this.party) {
      this.party.panel.dispose();
      this.party.frames.dispose();
      this.party = null;
    }
    if (this.combat) {
      const c = this.combat;
      this.combat = null;
      c.death.dispose();
      c.announcer.dispose();
      c.labels.dispose();
      c.boss.dispose();
      c.hud.dispose();
    }
    this.debug.dispose();
    this.worldMap.dispose();
    this.minimap.dispose();
    this.fader.dispose();
    this.title.dispose();
    this.dialog.dispose();
    this.banner.dispose();
    this.hud.dispose();
    this.prompt.dispose();
    window.removeEventListener('resize', this._onResize);
    this._dprQuery?.removeEventListener('change', this._onDpr);
    this._dprQuery = null;
    this._resizeObs?.disconnect();
    this._resizeObs = null;
    this._cursorEl.classList.remove('lu-cursors');
    this._cursorEl.style.removeProperty('--lu-cursor');
    this._cursorEl.style.removeProperty('--lu-cursor-pointer');
    this._disposed = true;
    this._events.off('scale');
    unbindScaleRoot(this);
    if (measureHost() === this.measureHost) setMeasureHost(null);
    this.root.remove();
  }
}

export { DialogBox, Banner, TitleScreen, HUD, InteractPrompt, Fader, DebugPanel, Minimap, WorldMap };
// combat levels only (COMBAT.md §13): re-exported from their own files; side-effect free
// (vite.config.js), so a bundle that does not use them does not hold them
export { CombatHUD } from './CombatHUD.js';
export { BossBar } from './BossBar.js';
export { WorldLabels } from './WorldLabels.js';
export { Announcer } from './Announcer.js';
export { DeathScreen } from './DeathScreen.js';
