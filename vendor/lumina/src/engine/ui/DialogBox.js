import './ui.css';
import './dialog.css';
import { t, registerStrings, hasStrings } from '../i18n/I18n.js';
import dialogStrings from '../i18n/strings/dialog.js';
import { pal, GEMS, gemRamp } from './art/palette.js';
import { art } from './art/painter.js';
import { glyph, gemGlyph, selBand } from './art/pieces.js';
import { portraitCanvas, PORTRAIT_CROPS } from './art/portrait.js';
import { FONT, HALF, capMid, inkH, grow, measure, fit, styleText, lineCount, cjk, UP, originOf, setOrigin } from './layout/type.js';
import { group, put, win, place } from './layout/layout.js';
import { onScale, currentScale } from './UiScale.js';
import { currentFonts } from './FontLoader.js';
import { createKeycaps, keycapsWidth } from './HUD.js';

/** @import { RoleId } from './layout/type.js' */
/** @import { FrameStyle } from './art/frames.js' */

/**
 * The dialog window after mockup G's dialogue (docs/specs/PIXEL_UI.md §5, Dialogue): A's big L
 * window (signature corners, lattice, beading, the trio and side studs) in today's navy glass,
 * anchored bottom-left from the HUD's left margin and clear of the skill bar; the speaker's
 * portrait (a character sheet's frame (0, 0), G's crop, in a thick gilt XS frame); the name
 * cartouche on the top rim (the speaker's gem, the name in capitals, a divider, the speaker's
 * title); typewriter text in the body role with punctuation pauses; a question under the speech
 * (DialogLine.ask: a gap, a gold gem, the question in the selection colour); a bobbing ▼ "next"
 * mark (a breathing ◆ on the last line) and an optional choice list in an XS window above the
 * window's right end, with a gilt selection band, a nudging gem cursor and G's keycap F at the band's
 * right end (shown once the answers are armed, below). Everything is placed in
 * art px of G's 640 × 360 frame and drawn on canvases (frames.js); the text is DOM in the type roles
 * (layout/type.js), so the window grows with its text in every language. The window never shrinks
 * with the corner groups (UiScale.js): on a screen too narrow for G's 496 art px clear of the skill
 * bar it narrows and its text reflows (`_width`).
 *
 * Text markup: `{word}` renders "word" highlighted in gold, `\n` forces a line break. Japanese and
 * Chinese are revealed one character at a time and wrap by the strict line-break rules.
 *
 * Input (via `update(dt, input)`, using `input.consumeAction(name)` when the Input has it — so the
 * press is swallowed for the rest of the frame — otherwise `input.actionPressed(name)`):
 *  - `confirm` (Space, Enter, F) while typing → completes the line; otherwise pages on
 *  - `cancel` while typing → completes the line
 *  - the answers (a line's `choices`) are mash-proof. Only `choose` (F, Enter) picks one, the one
 *    under the cursor; `confirm`'s Space never does. The list comes up **locked**: every `confirm` or
 *    `choose` press (Space, Enter, F) and every click on the window is swallowed and restarts a quiet
 *    timer (`choiceQuiet`); when it runs out with no such press the list **arms** and the next F /
 *    Enter picks — a player tapping through the text never answers by accident, one who stops to
 *    read answers with the next press. `up` / `down` move the cursor at once, locked or not
 *    (wrapping; nothing to move on a one-item list), and arm the list (a deliberate act: F / Enter
 *    right after picks). While locked the selection band, the gem cursor and the F keycap are
 *    hidden; they fade in as the list arms. A list armed by the quiet takes a press only once its
 *    look has shown for `choiceReact` s (`isChoiceReady`): a press sooner cannot answer what the
 *    player saw — it is still the tapping, so the list locks again and the quiet starts over. A
 *    Space or a window click on a ready list picks nothing: the keycap hops (a nudge toward the key
 *    that answers). `cancel` does nothing on the answers.
 *    (`choose` is read first, so it takes Enter / F and `confirm` is left with Space. The game never
 *    sees a pick: it reads its input before the UI does and starts no talk while the window is open.)
 * Mouse: clicking the window pages on but never picks an answer; moving the pointer over an answer
 * moves the cursor (it does not arm the list; a pointer the answers appear under moves nothing until
 * it moves); clicking an answer picks it, locked or not — a deliberate act.
 * A choice list may have a single item (F / Enter then picks index 0 once armed).
 */

/** Seconds of extra pause after punctuation (only when followed by whitespace / end of line / CJK). */
const PAUSES = { ',': 0.12, ';': 0.16, ':': 0.16, '—': 0.14, '.': 0.22, '!': 0.22, '?': 0.22, '…': 0.42 };
/** Full-width (Japanese / Chinese) marks: they pause whatever follows them (CJK has no spaces). */
const FULL_PAUSES = { '、': 0.12, '，': 0.12, '；': 0.16, '：': 0.16, '。': 0.22, '．': 0.22, '！': 0.22, '？': 0.22, '‥': 0.3, '―': 0.14 };
const CLOSERS = '"\'”’)]»」』）】〕〉》〙〗';
/** Characters set one by one (no word span round them): Japanese and Chinese break between characters. */
const CJK_CHAR = /[⺀-⿿　-ヿ㄀-ㇿ㐀-䶿一-鿿豈-﫿︰-﹏＀-￯]/;
/** A pair of adjacent full-width marks: the first is set in half width (layout/type.js PUNCT_PAIR). */
const HALT_FIRST = '、。，．：；！？」』）】〕〉》”’';
const HALT_SECOND = '、。，．：；！？」』）】〕〉》”’「『（【〔〈《“‘';

/** G's dialogue window in art px of the 640 × 360 frame: left edge, width, bottom, least height. */
const WX = 10, WW = 496, WBOTTOM = 344, WMIN = 62;
/**
 * A narrow screen (UiScale.js: the corner groups shrink under 512 art px, the skill bar's corner
 * moves in under 640): the window keeps its art pixels and narrows instead — `WM` art px clear of
 * the screen's right edge, `WGAP` clear of the skill bar's leftmost slot (G: the window ends at 506,
 * the slots start at 518), never under `WMINW` wide.
 */
const WM = 6, WGAP = 12, WMINW = 240;
/** The question under a speech (DialogLine.ask, G): indent after its gem; gap under the speech (CJK). */
const ASK_PI = 8, ASK_GAP = 5, ASK_GAP_CJK = 3;
/** Seconds the typewriter rests, at least, between the speech and its question. */
const ASK_BEAT = 0.3;
/**
 * The keycap on the chosen answer's row (G's keycap, HUD.js `createKeycaps`): the key that answers,
 * its right edge `KEY_IN` art px in from the row's right end (where the band's wash fades out), the
 * labels kept `KEY_GAP` clear of it. The answers' window makes room for it: max(100, longest +
 * 40 + the cap's width) wide (G: longest + 38).
 */
const CHOOSE_KEY = 'F', KEY_IN = 6, KEY_GAP = 4;
/** A row's label starts 24 art px in from the answers' window's left edge (G). */
const LABEL_X = 24;

/** The window, the name cartouche and the choice window (G's `win()` styles). */
/** @type {FrameStyle} */
const WINDOW = Object.freeze({ size: 'L', lattice: true, beads: 6, trio: true, sides: true });
/** @returns {FrameStyle} */
const PLATE = () => { const k = pal(); return { size: 'S', notch: 3, corners: null, ends: true, endR: 2, bands: [k.plate0, k.plate1], stops: [0, 0.5], sheen: false }; };
/** @returns {FrameStyle} */
const CHOICES = () => ({ size: 'XS', corners: GEMS.gold(), cornerR: 2 });

/** n art px as CSS, rounded to a whole device pixel (layout/type.js `txt` positions text the same way). */
const UR = (n) => `round(nearest, calc(var(--px) * ${n}), var(--lu-dpx, 1px))`;

/**
 * Place a kept text element (styled with `styleText`) as `txt()` places a new one: its line box at
 * (x, y) art px of the English --px 2 layout, another language's ink centre moved onto the English
 * one, a half-size font kept on its --px 2 cap centre; relative to `parent`'s frame origin.
 * @param {HTMLElement} el
 * @param {RoleId} font
 * @param {number} x
 * @param {number} y
 * @param {Element} parent
 */
function placeText(el, font, x, y, parent) {
  const f = FONT[font];
  const [ox, oy] = originOf(parent);
  let dy = capMid(font) - f.mid * (f.u === 'fpx' ? 0.5 : 1);
  if (f.u === 'fpx') dy += f.mid * (0.5 - HALF);
  el.style.left = UR(Math.round((x - ox) * 2) / 2);
  el.style.top = dy ? UR(y + dy - oy) : UR(Math.round((y - oy) * 2) / 2);
}

/**
 * A role's ink height in art px at the root's scale: `inkH` (G's --px 2 layout) plus what a half-size
 * role gains where a font pixel is more than half an art px (UiScale.js `fpxFor`: ⅔ at --px 3, so
 * English text is 1.33× G's there; 0 at --px 2 and 4).
 * @param {RoleId} font
 */
const inkNow = (font) => {
  const h = inkH(font);
  const f = FONT[font];
  return f.u === 'fpx' ? h + f.ink * (HALF - 0.5) : h;
};
/**
 * How much a plate or a row sized round English capitals at --px 2 grows for a role's ink here: a
 * CJK glyph's (`grow`), and a half-size role's at an odd --px (`inkNow`).
 * @param {RoleId} font
 */
const rise = (font) => grow(font) + inkNow(font) - inkH(font);

/**
 * A plain element (no frame-origin of its own until `setOrigin`), absolute at the top-left of its
 * parent: a layer whose children are placed in frame coordinates.
 * @param {string} cls
 */
function layer(cls) {
  const el = document.createElement('div');
  el.className = cls;
  return el;
}

/**
 * @typedef {{ speaker?: string|null, text: string, ask?: string, choices?: string[], portraitColor?: string,
 *   sheet?: HTMLCanvasElement|null, title?: string }} DialogLine
 *   `sheet`: the speaker's character-sheet canvas (`createCharacterSheet(...).canvas`; the window
 *   draws its portrait from frame (0, 0)); `title`: the speaker's small title beside the name plate.
 *   Without a sheet there is no portrait and the text starts at the left; without a speaker there is
 *   no plate either.
 *   `ask`: a question set under the speech (G's dialogue): after a gap, a gold gem at the text's left
 *   edge and the question beside it in the selection colour, wrapping on its own; the same markup as
 *   `text`, typed after it (a beat between them). Normally the line also carries the `choices` that
 *   answer it. Without `ask`, a line with `choices` sets its own text as the question (the gem, the
 *   colour), as before. An `open()` that goes on in a held window with the held line again (the same
 *   speaker and text) plus an `ask` or `choices` shows that speech at once — only the question types.
 */

export class DialogBox {
  /**
   * @param {HTMLElement} parent element the dialog is appended to (normally the UI root)
   */
  constructor(parent = document.body) {
    if (!hasStrings('dialog')) registerStrings('dialog', dialogStrings);
    /** Typewriter speed in characters per second (<= 0 → instant). */
    this.speed = 45;
    /**
     * The pace of Japanese and Chinese characters, as a share of `speed` (a character carries more
     * than a Latin letter: 0.7 × 55 ≈ 38 characters a second in the game).
     */
    this.cjkPace = 0.7;
    /** Seconds after open() during which confirm is ignored (avoids the "talk" press skipping text). */
    this.inputGuard = 0.15;
    /**
     * Seconds of quiet the answers wait for before they arm: from the moment they appear, and again
     * from every `confirm` / `choose` press (Space, Enter, F) or click on the window while they are
     * locked — so a player tapping through the text never picks the pre-selected answer by accident.
     * `up` / `down` arm the list at once.
     */
    this.choiceQuiet = 0.4;
    /**
     * Seconds the armed look (band, cursor, keycap) of a list armed by the quiet shows before a press
     * picks — about a reaction time: a press sooner is still the tapping, so the list locks again and
     * the quiet starts over. (A list armed by up / down takes the next press at once.)
     */
    this.choiceReact = 0.2;
    /** @type {((char: string) => void) | null} called for every revealed visible character (dialog blip hook). */
    this.onChar = null;
    /**
     * @type {((name: 'open'|'close'|'confirm'|'blip') => void) | null}
     * Optional sound hook; names match AudioSystem.playSfx names.
     */
    this.onSound = null;

    // the stage covers the root (group() anchors from its box); the window group hangs from its
    // bottom-left corner, 10 art px up: children are placed in G's frame coordinates
    const root = document.createElement('div');
    root.className = 'lu-dialog lu-stage';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', t('dialog.window'));
    parent.appendChild(root);
    this.element = root;
    /** @type {HTMLDivElement} */
    this._win = group(root, 'bl', 0, 0, 640, WBOTTOM + 6, 'lu-dialog__win');

    // the window: the click target is its box; the frame, portrait and question gem are repainted per
    // layout in an art layer under the text; the mark and the name plate are kept
    const panel = layer('g lu-dialog__panel');
    this._art = layer('lu-dialog__art');
    const text = layer('lu-dialog__text');
    text.setAttribute('aria-live', 'polite');
    // the question under the speech (DialogLine.ask): its own text element, typed after the speech
    const ask = layer('lu-dialog__ask-text');
    ask.setAttribute('aria-live', 'polite');
    const next = layer('g lu-dialog__next');
    next.setAttribute('role', 'img');
    next.setAttribute('aria-label', t('dialog.next'));
    const arrow = glyph('advance');
    arrow.classList.add('lu-arrow');
    const end = gemGlyph(2, GEMS.gold());
    end.classList.add('lu-end');
    put(next, arrow, 0, 0);
    put(next, end, 1, 0);
    const name = layer('g lu-dialog__name is-empty');
    this._nameArt = layer('lu-dialog__art');
    const speaker = layer('lu-dialog__speaker');
    const title = layer('lu-dialog__title');
    name.append(this._nameArt, speaker, title);
    panel.append(this._art, text, ask, next, name);
    // the choices: an XS window above the window's right end; the keycap that answers (F) is one
    // element of its own, put on the chosen row (`_placeKey`) — out of the rows, so their text is
    // only their label
    const choices = document.createElement('ul');
    choices.className = 'g lu-dialog__choices';
    choices.setAttribute('aria-label', t('dialog.choices'));
    this._choiceArt = layer('lu-dialog__art');
    const key = createKeycaps(CHOOSE_KEY);
    key.classList.add('lu-choice__key');
    key.setAttribute('aria-hidden', 'true');
    choices.append(this._choiceArt, key);
    this._win.append(panel, choices);

    /** @type {HTMLElement} */
    this._panel = panel;
    /** @type {HTMLElement} */
    this._nameEl = name;
    /** @type {HTMLElement} */
    this._speakerEl = speaker;
    /** @type {HTMLElement} the speaker's title beside the name (DialogLine.title) */
    this._titleEl = title;
    /** @type {HTMLElement} */
    this._textEl = text;
    /** @type {HTMLElement} the question under the speech (DialogLine.ask) */
    this._askEl = ask;
    /** @type {HTMLElement} */
    this._nextEl = next;
    /** @type {HTMLElement} */
    this._choicesEl = choices;
    /** @type {HTMLElement} the F keycap on the chosen row (shown while the answers are armed) */
    this._keyEl = key;

    /** @type {DialogLine[]} */
    this._lines = [];
    this._index = 0;
    this._defaultSpeaker = '';
    /** @type {HTMLCanvasElement|null} the window's sheet (open({ sheet })), for its speaker's lines */
    this._defaultSheet = null;
    this._defaultTitle = '';
    this._currentSpeaker = null;
    /** @type {{ el: HTMLElement|null, ch: string, pause: number, cjk?: boolean }[]} */
    this._glyphs = [];
    /** How many of `_glyphs` are the speech's (the rest, the question's: DialogLine.ask). */
    this._nSpeech = 0;
    /** The first line of this open() shows the held window's speech again: shown at once (open()). */
    this._carry = false;
    this._revealed = 0;
    this._timer = 0;
    this._typing = false;
    this._open = false;
    this._closing = false;
    this._held = false;
    this._hold = false;
    this._guard = 0;
    /** @type {HTMLLIElement[]} */
    this._choiceEls = [];
    /** @type {string[]} */
    this._choiceLabels = [];
    /** The line the choice list was built for (-1: none). */
    this._choicesLine = -1;
    this._choiceIndex = 0;
    this._choicesActive = false;
    /** The answers are armed: F / Enter picks (else locked: `_quiet` counts down to arming). */
    this._choiceArmed = false;
    /** Seconds of quiet left before locked answers arm (`choiceQuiet`, restarted by a press). */
    this._quiet = 0;
    /** Seconds before armed answers take a press (`choiceReact` after the quiet; 0 after up / down). */
    this._react = 0;
    /** The keycap's last nudge ran keyframes 'a' (the next one runs 'b', so it starts over). */
    this._nudgeA = false;
    /**
     * Where the keycap sits on each answer's row, relative to the answers' window (art px).
     * @type {{ x: number, y: number, w: number }[]}
     */
    this._keyRows = [];
    this._choiceDelay = -1;
    this._lastChoice = undefined;
    this._clickQueued = false;
    this._resolve = null;
    this._closeTimer = 0;
    this._portraitColor = '';
    this._lineColored = false;
    /** The fonts' ensure() of the line shown (a newer line drops an older answer). */
    this._ensureSeq = 0;
    /**
     * The last layout's geometry (art px): the window, the name plate, the body's line pitch.
     * @type {{ x0: number, y0: number, w: number, h: number, LH: number, plateEnd: number, gn: number }|null}
     */
    this._geo = null;

    this._onPanelClick = (e) => {
      e.preventDefault();
      if (this._open && !this._closing) this._clickQueued = true;
    };
    this._panel.addEventListener('click', this._onPanelClick);
    // the type follows the root's scale (a half-size font is a third of an art px at --px 3): lay out again
    this._offScale = onScale(parent, () => { if (this._open) this._layout(); });
  }

  /** True from open() until the close animation has finished. */
  get isOpen() { return this._open; }
  /** True while the typewriter is revealing text. */
  get isTyping() { return this._typing; }
  /** True while the choice list is active (locked or armed). */
  get isChoosing() { return this._choicesActive; }
  /**
   * True while the answers show and take a press: the next `choose` press (F / Enter) picks the one
   * under the cursor. (Locked answers arm after `choiceQuiet` s without a press and are ready
   * `choiceReact` s later; up / down arm them and make them ready at once.)
   */
  get isChoiceReady() { return this._choicesActive && this._choiceArmed && this._react <= 0; }

  /**
   * Open the dialog.
   * @param {{ speaker?: string, lines?: string | (string | DialogLine)[],
   *   portraitColor?: string, hold?: boolean, sheet?: HTMLCanvasElement|null, title?: string }} [opts]
   *   `speaker` is the default name plate for lines that don't set their own; `portraitColor` tints
   *   the gem on the name plate and the portrait's glow (a #rgb / #rrggbb hex; amber otherwise; a
   *   line's own `portraitColor` wins while it shows). `sheet` and `title`: the default speaker's
   *   character-sheet canvas (the portrait) and title, for the lines that are that speaker's (a line
   *   with another speaker shows its own, else none). `hold`: after the last line the window stays
   *   open (the promise resolves at once, input is ignored) until the next `open()` — which goes on
   *   in the same window, without the close and open animations — or `close()`: a story script's
   *   consecutive windows read as one conversation.
   * @returns {Promise<number|undefined>} resolves after the close animation (`hold`: when the last
   *   line is dismissed) with the last chosen choice index (or undefined when no choice was made).
   *   If another open() interrupts it, it resolves immediately with the choice made so far.
   */
  open({ speaker = '', lines = [], portraitColor, hold = false, sheet = null, title = '' } = {}) {
    // Settle a dialog that is still open / closing — with the choice already made, so a dialog
    // re-opened during the previous one's close animation doesn't lose the player's answer. (A
    // closing window whose promise has settled — a held one closed — finishes now too, or its
    // close timer would close the new window.)
    if (this._resolve || this._closing) this._finishClose(true);
    // a held window goes on (no close / open animation)
    const continued = this._held;
    const was = continued ? this.heldLine : null;
    this._held = false;

    const list = typeof lines === 'string' ? [lines] : Array.isArray(lines) ? lines : [];
    this._lines = list.map((l) => (typeof l === 'string' ? { text: l } : { ...l, text: String(l?.text ?? '') }));
    if (!this._lines.length) {
      if (continued) this._finishClose(true);
      return Promise.resolve(undefined);
    }
    this._hold = hold;
    // the held line again, now with its question or options: its speech is not typed twice
    const first = this._lines[0];
    const firstSpeaker = first.speaker === undefined ? (speaker ?? '') : first.speaker;
    this._carry = !!was && first.text === was.text && (firstSpeaker || '') === (was.speaker || '')
      && (hasText(first.ask) || (Array.isArray(first.choices) && first.choices.length > 0));

    this._defaultSpeaker = speaker ?? '';
    this._defaultSheet = isSheet(sheet) ? sheet : null;
    this._defaultTitle = typeof title === 'string' ? title : '';
    this._currentSpeaker = null;
    this._index = 0;
    this._lastChoice = undefined;
    this._closing = false;
    this._open = true;
    this._guard = this.inputGuard;
    this._clickQueued = false;
    this._portraitColor = portraitColor || '';
    this._lineColored = false;
    this._setPortrait(this._portraitColor);

    this.element.classList.remove('is-closing');
    this.element.classList.add('is-open');
    this._setLine(0);
    if (!continued) this._sound('open');
    return new Promise((resolve) => { this._resolve = resolve; });
  }

  /** True while a `hold` window waits for the next open() / close() after its last line. */
  get isHeld() { return this._held; }

  /**
   * The line a held window shows, as shown (a copy, with the window's default speaker, colour, sheet
   * and title where the line has none; null while not held): a story's `choice` that follows a block
   * puts its options on it (`open({ lines: [{ ...heldLine, choices }], hold })`).
   * @returns {DialogLine|null}
   */
  get heldLine() {
    const line = this._held ? this._lines[this._index] : null;
    if (!line) return null;
    const out = { ...line, speaker: line.speaker === undefined ? this._defaultSpeaker : line.speaker };
    if (out.portraitColor === undefined && this._portraitColor) out.portraitColor = this._portraitColor;
    const own = this._isDefaultSpeaker(line);
    if (out.sheet === undefined && own && this._defaultSheet) out.sheet = this._defaultSheet;
    if (out.title === undefined && own && this._defaultTitle) out.title = this._defaultTitle;
    return out;
  }

  /** @param {string} color */
  _setPortrait(color) {
    if (color) this.element.style.setProperty('--lu-portrait', color);
    else this.element.style.removeProperty('--lu-portrait');
  }

  /**
   * Advance the typewriter and consume input. Call once per frame.
   * @param {number} dt seconds
   * @param {{ actionPressed(name: string): boolean, consumeAction?(name: string): boolean }} [input]
   */
  update(dt, input) {
    if (!this._open || this._closing || this._held) return;
    // input first, so a press always acts on what the player currently sees
    this._handleInput(dt, input);
    if (!this._open || this._closing) return;

    // typewriter
    if (this._typing) {
      if (this.speed <= 0) this._completeLine();
      else {
        this._timer -= dt;
        let n = this._glyphs.length;
        while (this._typing && this._timer <= 0 && n-- > 0) this._revealNext();
      }
    }
    if (this._choiceDelay >= 0) {
      this._choiceDelay -= dt;
      if (this._choiceDelay < 0) this._activateChoices();
    }
  }

  /** Close the dialog (animated). The open() promise resolves when the animation completes. */
  close() {
    if (!this._open || this._closing) return;
    this._held = false;
    this._closing = true;
    this._typing = false;
    this._choiceDelay = -1;
    this._setChoicesVisible(false);
    this._nextEl.classList.remove('is-on');
    this.element.classList.remove('is-open');
    this.element.classList.add('is-closing');
    this._sound('close');
    clearTimeout(this._closeTimer);
    this._closeTimer = setTimeout(() => this._finishClose(false), 320);
  }

  /** Reveal the whole current line immediately. */
  skip() { if (this._typing) this._completeLine(); }

  dispose() {
    clearTimeout(this._closeTimer);
    this._offScale();
    this._panel.removeEventListener('click', this._onPanelClick);
    if (this._resolve) { const r = this._resolve; this._resolve = null; r(undefined); }
    this.element.remove();
  }

  // ------------------------------------------------------------------------------------------

  _sound(name) { if (this.onSound) this.onSound(name); }

  /**
   * Read an action edge. Uses `input.consumeAction(name)` when the Input provides it (the engine's
   * Input does) so gameplay code running later in the same frame doesn't also see the press.
   */
  _pressed(input, name) {
    if (!input) return false;
    return typeof input.consumeAction === 'function' ? input.consumeAction(name) : input.actionPressed(name);
  }

  _handleInput(dt, input) {
    if (this._guard > 0) {
      this._guard -= dt;
      this._clickQueued = false;
      return;
    }
    const click = this._clickQueued;
    this._clickQueued = false;

    if (this._choicesActive) {
      // `choose` first: it takes Enter / F, so `confirm` is left with Space
      const choose = this._pressed(input, 'choose');
      const tap = this._pressed(input, 'confirm') || click;
      let moved = false;
      if (this._pressed(input, 'up')) { this._moveChoice(-1); moved = true; }
      if (this._pressed(input, 'down')) { this._moveChoice(1); moved = true; }
      // moving the cursor is deliberate: the list arms and takes the next press at once
      if (moved) this._arm(0);
      if (!this._choiceArmed) {
        // locked: a press (or a click on the window) is swallowed and starts the quiet over
        if (choose || tap) this._quiet = this.choiceQuiet;
        else if ((this._quiet -= dt) <= 0) this._arm(this.choiceReact);
        return;
      }
      if (this._react > 0) {
        // armed too lately for a press to answer what the player saw: it is still the tapping
        if (choose || tap) this._lock();
        else this._react -= dt;
        return;
      }
      if (choose) this._selectChoice(this._choiceIndex);
      else if (tap) this._nudgeKey();
      return;
    }
    const confirm = this._pressed(input, 'confirm') || click;
    if (this._typing) {
      if (confirm || this._pressed(input, 'cancel')) this._completeLine();
      return;
    }
    if (confirm && this._choiceDelay < 0) {
      this._sound('confirm');
      this._advance();
    }
  }

  _finishClose(immediate) {
    clearTimeout(this._closeTimer);
    this._held = false;
    this._open = false;
    this._closing = false;
    this._typing = false;
    this._choicesActive = false;
    this._choiceArmed = false;
    this._choiceDelay = -1;
    this.element.classList.remove('is-closing', 'is-open');
    if (immediate) this._setChoicesVisible(false);
    this._textEl.textContent = '';
    this._askEl.textContent = '';
    this._glyphs.length = 0;
    this._nSpeech = 0;
    const r = this._resolve;
    this._resolve = null;
    if (r) r(this._lastChoice);
  }

  /**
   * True when a line is the window's default speaker's (its sheet and title apply).
   * @param {DialogLine} line
   */
  _isDefaultSpeaker(line) {
    return line.speaker === undefined || (!!line.speaker && line.speaker === this._defaultSpeaker);
  }

  /**
   * What a line shows besides its text: the speaker, its title, sheet and colour, its choices.
   * @param {DialogLine} line
   */
  _view(line) {
    const own = this._isDefaultSpeaker(line);
    const sheet = line.sheet !== undefined ? line.sheet : own ? this._defaultSheet : null;
    const title = line.title !== undefined ? line.title : own ? this._defaultTitle : '';
    const choices = Array.isArray(line.choices) && line.choices.length ? line.choices.map(String) : null;
    const ask = hasText(line.ask) ? String(line.ask) : '';
    return {
      speaker: this._currentSpeaker || '',
      title: typeof title === 'string' ? title : '',
      sheet: isSheet(sheet) ? sheet : null,
      color: (line.portraitColor ?? this._portraitColor) || '',
      choices,
      // the question under the speech (G: a gap, a gem, the selection colour)
      ask,
      // without one, a line that asks (its options under it) is set as G's question: a gem before
      // it, brighter
      question: !ask && !!choices && this._speechShown(),
    };
  }

  /** True when the line's speech has visible characters (not only its question). */
  _speechShown() {
    for (let i = 0; i < this._nSpeech; i++) if (this._glyphs[i].el) return true;
    return false;
  }

  /** True when the line's question (DialogLine.ask) has visible characters. */
  _askShown() {
    for (let i = this._nSpeech; i < this._glyphs.length; i++) if (this._glyphs[i].el) return true;
    return false;
  }

  _setLine(i) {
    this._index = i;
    const line = this._lines[i];
    const speaker = line.speaker === undefined ? this._defaultSpeaker : (line.speaker ?? '');
    this._setSpeaker(speaker);
    if (line.portraitColor !== undefined || this._lineColored) {
      this._lineColored = line.portraitColor !== undefined;
      this._setPortrait(line.portraitColor ?? this._portraitColor);
    }
    this._buildText(line.text, hasText(line.ask) ? String(line.ask) : '');
    this._revealed = 0;
    if (i === 0 && this._carry) {
      // the held speech again (open()): shown whole, the typewriter goes on with its question
      for (let j = 0; j < this._nSpeech; j++) this._glyphs[j].el?.classList.add('is-on');
      this._revealed = this._nSpeech;
    }
    this._carry = false;
    this._timer = 0.06; // a breath before the first character
    this._typing = this._revealed < this._glyphs.length;
    this._choiceDelay = -1;
    this._setChoicesVisible(false);
    this._nextEl.classList.remove('is-on');
    const last = i === this._lines.length - 1;
    this._nextEl.classList.toggle('is-last', last);
    this._nextEl.setAttribute('aria-label', t(last ? 'dialog.end' : 'dialog.next'));
    this._layout();
    this._ensureFonts(line);
    if (!this._typing) this._finishLine();
  }

  /**
   * Load the font slices the line needs (Japanese and Chinese fonts come in unicode-range slices),
   * then lay it out again: it was measured with what was there.
   * @param {DialogLine} line
   */
  _ensureFonts(line) {
    const fonts = currentFonts();
    if (!fonts) return;
    const seq = ++this._ensureSeq;
    const v = this._view(line);
    fonts.ensure([line.text, v.ask, v.speaker, UP(v.speaker), v.title, v.choices ?? []]).then(() => {
      if (seq === this._ensureSeq && this._open && this._lines[this._index] === line) this._layout();
    });
  }

  _setSpeaker(name) {
    if (name === this._currentSpeaker) return;
    this._currentSpeaker = name;
    this._speakerEl.textContent = name || '';
    this._nameEl.classList.toggle('is-empty', !name);
  }

  /**
   * The line's characters, one span each, for the typewriter: the speech in the text element, then
   * its question (DialogLine.ask) in its own, a beat after the speech.
   * @param {string} text
   * @param {string} [ask]
   */
  _buildText(text, ask = '') {
    this._glyphs.length = 0;
    this._buildInto(this._textEl, text);
    this._nSpeech = this._glyphs.length;
    this._buildInto(this._askEl, ask);
    if (this._nSpeech < this._glyphs.length && this._speechShown()) {
      // the speaker finishes, then asks
      let last = this._nSpeech - 1;
      while (last > 0 && !this._glyphs[last].el) last--;
      this._glyphs[last].pause = Math.max(this._glyphs[last].pause, ASK_BEAT);
    }
  }

  /**
   * Set `text` into `root` as typewriter glyphs (appended to `_glyphs`) with its punctuation pauses.
   * @param {HTMLElement} root
   * @param {string} text
   */
  _buildInto(root, text) {
    const glyphs = this._glyphs;
    const from = glyphs.length;
    root.textContent = '';
    const frag = document.createDocumentFragment();
    /** @type {HTMLElement|null} */
    let word = null;
    let hl = false;
    const chars = [...text];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === '{') { hl = true; continue; }
      if (ch === '}') { hl = false; continue; }
      if (ch === '\n') {
        word = null;
        frag.appendChild(document.createElement('br'));
        glyphs.push({ el: null, ch, pause: 0 });
        continue;
      }
      if (ch === ' ' || ch === '\t') {
        word = null;
        frag.appendChild(document.createTextNode(' '));
        glyphs.push({ el: null, ch: ' ', pause: 0 });
        continue;
      }
      const c = document.createElement('span');
      c.className = hl ? 'lu-c lu-hl kw' : 'lu-c';
      c.textContent = ch;
      const wide = CJK_CHAR.test(ch);
      if (wide) {
        // Japanese / Chinese: one character at a time, the line breaks between characters (strict)
        word = null;
        if (HALT_FIRST.includes(ch)) {
          let j = i + 1;
          while (j < chars.length && (chars[j] === '{' || chars[j] === '}')) j++;
          if (j < chars.length && HALT_SECOND.includes(chars[j])) c.classList.add('halt');
        }
        frag.appendChild(c);
      } else {
        // a Latin word stays whole on its line
        if (!word) {
          word = document.createElement('span');
          word.className = 'lu-w';
          frag.appendChild(word);
        }
        word.appendChild(c);
      }
      glyphs.push({ el: c, ch, pause: 0, cjk: wide });
    }
    root.appendChild(frag);

    // punctuation pauses: a Latin mark only when it ends a phrase (followed by space / end / closer,
    // or by a Japanese or Chinese character); a full-width mark always (unless another mark follows:
    // the last one of a run pauses)
    for (let i = from; i < glyphs.length; i++) {
      const ch = glyphs[i].ch;
      const full = FULL_PAUSES[ch];
      const p = full ?? PAUSES[ch];
      if (!p) continue;
      let j = i + 1;
      while (j < glyphs.length && CLOSERS.includes(glyphs[j].ch)) j++;
      const next = j < glyphs.length ? glyphs[j].ch : ' ';
      if (full !== undefined) {
        if (FULL_PAUSES[next] !== undefined || next === '…' || next === '—') continue;
        glyphs[j - 1].pause = full;
      } else if (next === ' ' || next === '\n' || CJK_CHAR.test(next) && FULL_PAUSES[next] === undefined) {
        const ellipsis = ch === '.' && i > from && glyphs[i - 1].ch === '.';
        glyphs[j - 1].pause = ellipsis ? PAUSES['…'] : p;
      }
    }
  }

  _revealNext() {
    const g = this._glyphs[this._revealed++];
    if (g.el) {
      g.el.classList.add('is-on');
      if (this.onChar) this.onChar(g.ch);
    }
    this._timer += (g.cjk && this.cjkPace > 0 ? 1 / (this.speed * this.cjkPace) : 1 / this.speed) + g.pause;
    if (this._revealed >= this._glyphs.length) this._finishLine();
  }

  _completeLine() {
    const glyphs = this._glyphs;
    for (let i = this._revealed; i < glyphs.length; i++) if (glyphs[i].el) glyphs[i].el.classList.add('is-on');
    this._revealed = glyphs.length;
    this._finishLine();
  }

  _finishLine() {
    this._typing = false;
    const line = this._lines[this._index];
    if (line && Array.isArray(line.choices) && line.choices.length) {
      this._buildChoices(line.choices);
      this._choiceDelay = 0.12;
    } else {
      this._nextEl.classList.add('is-on');
    }
  }

  _advance() {
    if (this._index + 1 < this._lines.length) this._setLine(this._index + 1);
    else if (this._hold) {
      // held: the window stays, the caller goes on (the next open() continues it)
      this._held = true;
      this._nextEl.classList.remove('is-on');
      const r = this._resolve;
      this._resolve = null;
      if (r) r(this._lastChoice);
    } else this.close();
  }

  // ------------------------------------------------------------------------------------------
  // Layout (PIXEL_UI.md §5, Dialogue): art px of the 640 × 360 frame, the window's bottom at 344
  // ------------------------------------------------------------------------------------------

  /**
   * The lines the text element takes (as laid out; in the measure host while it is not rendered).
   * @param {HTMLElement} el
   * @param {string} text
   * @param {number} maxW
   */
  _countLines(el, text, maxW) {
    if (el.isConnected && el.getClientRects().length) {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      if (lh > 0) return Math.max(1, Math.round(el.offsetHeight / lh));
    }
    return String(text).split('\n').reduce((n, part) => n + (part.trim() ? lineCount(null, part, 'body', maxW) : 1), 0);
  }

  /**
   * How far a text element's last line reaches, in art px from its left edge (0 when unknown): its
   * glyphs are `_glyphs[from … to)`.
   * @param {HTMLElement} el
   * @param {number} maxW
   * @param {number} [from]
   * @param {number} [to]
   */
  _reach(el, maxW, from = 0, to = this._glyphs.length) {
    let last = null;
    for (let i = to - 1; i >= from && !last; i--) last = this._glyphs[i].el;
    if (!last) return 0;
    const er = el.getBoundingClientRect();
    if (!er.width) return 0;
    return ((last.getBoundingClientRect().right - er.left) / er.width) * maxW;
  }

  /**
   * The window's width (art px): G's 496 where the screen holds it clear of the skill bar, else
   * narrowed — `WM` clear of the screen's right edge, `WGAP` clear of the skill bar's leftmost slot
   * or label when a skill bar is shown — and never under `WMINW`. The window keeps its art pixels on
   * every screen (no shrink: dialog.css), so below G's corner footprint it reflows instead.
   */
  _width() {
    const s = currentScale(this.element);
    if (!s) return WW;
    let right = s.artW - WM;
    const host = this.element.parentElement;
    const bar = host?.querySelector('.lu-skills');
    if (bar && !bar.closest('[hidden]')) {
      const hr = host.getBoundingClientRect();
      let left = Infinity;
      for (const el of bar.querySelectorAll('.lu-skill, .lu-skill .tx')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) left = Math.min(left, r.left);
      }
      if (left < Infinity && s.cssPx > 0) right = Math.min(right, Math.floor((left - hr.left) / s.cssPx) - WGAP);
    }
    return Math.max(WMINW, Math.min(WW, right - WX));
  }

  /** Lay the window out for the line shown: frame, portrait, text, mark, plate and choices. */
  _layout() {
    const line = this._lines[this._index];
    if (!this._open || !line) return;
    const k = pal();
    const v = this._view(line);
    const x0 = WX, w = this._width();
    const panel = this._panel, el = this._textEl, ae = this._askEl;

    // the text: at x0 + 72 beside a portrait, x0 + 24 without; a question after its gem
    const tx = x0 + (v.sheet ? 72 : 24);
    const PI = v.question ? ASK_PI : 0;
    const maxW = x0 + w - 24 - tx - PI;
    styleText(el, 'body', { color: v.question ? k.sel : k.tx1, kw: k.kw, maxW, drop: true });
    const LH = FONT.body.L;
    const C = cjk();
    const n1 = this._speechShown() ? this._countLines(el, line.text, maxW) : 0;
    // the question under the speech (G): a gap, its gem at tx, the question at tx + 8 in the
    // selection colour, wrapping on its own
    const asks = !!v.ask && this._askShown();
    const askW = maxW - ASK_PI;
    // (without a question the element is empty: _buildText)
    let n2 = 0, GAP = 0;
    if (asks) {
      styleText(ae, 'body', { color: k.sel, kw: k.kw, maxW: askW, drop: true });
      n2 = this._countLines(ae, v.ask, askW);
      GAP = n1 ? (C ? ASK_GAP_CJK : ASK_GAP) : 0;
    }
    const n = n1 + n2;
    // the window's height follows the text, with today's padding (CJK has no descenders under its
    // last line); a short speech sits in the middle of the least height. The ▼ mark stays clear of
    // a long last line: the window grows under it.
    const FOOT = C ? 8 : 10;
    let need = 12 + n * LH + GAP + FOOT;
    const reach = !n ? 0 : asks
      ? tx + ASK_PI + this._reach(ae, askW, this._nSpeech)
      : tx + PI + this._reach(el, maxW, 0, this._nSpeech);
    let h = WMIN, y0 = 0, PAD = 12;
    for (let i = 0; i < 4; i++) {
      h = Math.max(WMIN, Math.round(need));
      y0 = WBOTTOM - h;
      PAD = 12 + Math.floor((h - need) / 2);
      if (!n || reach < x0 + w - 37 - 4) break;
      const inkBottom = y0 + PAD + (n - 1) * LH + GAP + capMid('body') + inkNow('body') / 2;
      const over = Math.ceil(inkBottom + 2 - (y0 + h - 15));
      if (over <= 0) break;
      need += over;
    }

    // the name plate on the top rim (a cartouche, studs on its ends): the gem, the name in capitals,
    // a divider, the title as a small line; 16 art px round English capitals, taller round CJK
    let plate = null;
    if (v.speaker) {
      const gn = 2 * Math.ceil(rise('name') / 2), ph = 16 + gn;
      const maxPW = w - 60;
      let shown = v.speaker;
      let nw = measure(UP(shown), 'name', 1);
      if (23 + nw > maxPW) {
        // (a very long name: cut, with an ellipsis)
        const cut = [...fit(UP(shown), 'name', maxPW - 23, 1)];
        shown = cut.length > 1 ? `${[...v.speaker].slice(0, cut.length - 1).join('').trimEnd()}…` : v.speaker;
        nw = measure(UP(shown), 'name', 1);
      }
      let title = v.title;
      if (title) {
        const room = maxPW - (6 + 7 + 3 + nw + 6 + 7);
        title = room >= 24 ? fit(title, 'line', room) : '';
      }
      const tw = title ? measure(title, 'line') : 0;
      const pw = title ? 6 + 7 + 3 + nw + 6 + tw + 7 : 6 + 7 + 3 + nw + 7;
      const px0 = x0 + 30, py0 = y0 - ph / 2;
      plate = { shown, nw, title, gn, ph, pw, px0, py0, nc: py0 + ph / 2 + 0.25 };
    }
    // a plate long enough to reach the top trio hides it
    const trioTop = !plate || plate.px0 + plate.pw + 3 < x0 + Math.floor((w - 1) / 2) - 11;

    // the window and its art
    place(panel, x0, y0, w, h);
    setOrigin(panel, [x0, y0]);
    const A = this._art;
    setOrigin(A, [x0, y0]);
    A.replaceChildren();
    win(A, { ...WINDOW, trioTop }, x0, y0, w, h);
    if (v.sheet) {
      // the portrait: the speaker's sheet, G's crop ×2 in a thick gilt frame, clear of the corner scroll
      const pc = portraitCanvas(v.sheet, { ...PORTRAIT_CROPS.dialogue, glow: gemRamp(v.color)[0] });
      pc.classList.add('lu-dialog__portrait');
      pc.setAttribute('role', 'img');
      pc.setAttribute('aria-label', t('dialog.portrait', { name: v.speaker }));
      put(A, pc, x0 + 23, y0 + Math.floor((h - 42) / 2));
    }
    placeText(el, 'body', tx + PI, y0 + PAD, panel);
    const qy = y0 + PAD + n1 * LH + GAP;
    if (asks) placeText(ae, 'body', tx + ASK_PI, qy, panel);
    if (v.question || asks) put(A, gemGlyph(1, GEMS.gold(), { setting: [k.g5, k.g4, k.g3] }), tx, Math.round((asks ? qy : y0 + PAD) + capMid('body') - 2), 1, 'lu-dialog__ask');
    place(this._nextEl, w - 37, h - 15, 9, 8);

    // the name plate
    const N = this._nameEl, NA = this._nameArt;
    N.classList.toggle('is-empty', !plate);
    if (plate) {
      const { px0, py0, pw, ph, gn, nw, nc } = plate;
      place(N, px0 - x0, py0 - y0, pw, ph);
      setOrigin(N, [px0, py0]);
      setOrigin(NA, [px0, py0]);
      NA.replaceChildren();
      win(NA, PLATE(), px0, py0, pw, ph);
      put(NA, gemGlyph(2, gemRamp(v.color)), px0 + 6, py0 + ph / 2 - 3, 1, 'lu-dialog__gem');
      const sp = this._speakerEl;
      if (sp.textContent !== plate.shown) sp.textContent = plate.shown;
      styleText(sp, 'name', { track: 1, color: k.g4, drop: true });
      placeText(sp, 'name', px0 + 16, nc - capMid('name'), N);
      const te = this._titleEl;
      if (plate.title) {
        put(NA, art(1, 10 + gn, (p) => p.vline(0, 0, 10 + gn, k.dm1)), px0 + 16 + nw + 3, py0 + 3);
        te.textContent = plate.title;
        styleText(te, 'line', { color: k.tx2, drop: true });
        // the title on the name's baseline (their ink bottoms on one line)
        placeText(te, 'line', px0 + 16 + nw + 6, nc + inkNow('name') / 2 - inkNow('line') / 2 - capMid('line'), N);
        te.hidden = false;
      } else {
        te.textContent = '';
        te.hidden = true;
      }
    }

    this._geo = { x0, y0, w, h, LH, plateEnd: plate ? plate.px0 + plate.pw : 0, gn: plate ? plate.gn : 0 };
    if (this._choicesLine === this._index && this._choiceEls.length) this._layoutChoices();
  }

  /**
   * The choice window (G): an XS window above the window's right end, as wide as its longest option
   * and the F keycap at its row's right end (100 art px at least), rows 16 art px round English
   * capitals (taller round CJK text; a label too long for the window wraps), lifted clear of a long
   * name plate.
   */
  _layoutChoices() {
    const g = this._geo;
    if (!g) return;
    const { x0, y0, w, LH } = g;
    const RW = 16 + 2 * Math.ceil(rise('body') / 2);
    const labels = this._choiceLabels;
    // a label runs from LABEL_X to KEY_GAP before the keycap, which ends KEY_IN in from the row's
    // right end (the row: 6 in from each side of the window)
    const KW = keycapsWidth(CHOOSE_KEY);
    const side = 6 + KEY_IN + KW + KEY_GAP;
    const cw = Math.min(w - 20, Math.max(100, Math.max(...labels.map((c) => measure(c, 'body'))) + LABEL_X + side));
    const room = cw - LABEL_X - side;
    const rows = labels.map((c) => {
      const nl = measure(c, 'body') > room ? lineCount(null, c, 'body', room) : 1;
      return { nl, rh: RW + (nl - 1) * LH };
    });
    const ch = 12 + rows.reduce((a, r) => a + r.rh, 0);
    const cx0 = x0 + w - 10 - cw;
    const cy0 = y0 - 10 - ch - (g.plateEnd && g.plateEnd + 4 > cx0 ? 4 + g.gn / 2 : 0);
    const ul = this._choicesEl;
    place(ul, cx0, cy0, cw, ch);
    setOrigin(ul, [cx0, cy0]);
    const A = this._choiceArt;
    setOrigin(A, [cx0, cy0]);
    A.replaceChildren();
    win(A, CHOICES(), cx0, cy0, cw, ch);
    let ry = cy0 + 6;
    this._keyRows.length = 0;
    this._choiceEls.forEach((li, i) => {
      const { nl, rh } = rows[i];
      place(li, 6, ry - cy0, cw - 12, rh);
      setOrigin(li, [cx0 + 6, ry]);
      const label = /** @type {HTMLElement} */ (li.querySelector('.lu-choice__label'));
      // the band and the cursor are on every row (shown on the chosen one: dialog.css)
      li.replaceChildren(label);
      put(li, selBand(cw - 12, rh), cx0 + 6, ry, 1, 'lu-choice__band');
      put(li, glyph('cursorGem'), cx0 + 8, ry + RW / 2 - 4, 1, 'lu-choice__cursor');
      styleText(label, 'body', { drop: true, maxW: nl > 1 ? room : null });
      placeText(label, 'body', cx0 + LABEL_X, ry + RW / 2 - capMid('body'), li);
      // the keycap's place on this row: centred on the first line, as the cursor
      this._keyRows.push({ x: cw - 6 - KEY_IN - KW, y: Math.round(ry - cy0 + RW / 2 - 5.5), w: KW });
      ry += rh;
    });
    this._placeKey();
  }

  /** Put the F keycap on the chosen row (`_keyRows`, laid out by `_layoutChoices`). */
  _placeKey() {
    const r = this._keyRows[this._choiceIndex];
    if (r) place(this._keyEl, r.x, r.y, r.w, 11);
  }

  _buildChoices(choices) {
    const ul = this._choicesEl;
    // new labels: the last list's armed look (left on its pick as it faded out) goes now
    ul.classList.remove('is-armed');
    this._keyEl.classList.remove('is-nudge-a', 'is-nudge-b');
    for (const li of this._choiceEls) li.remove();
    this._choiceEls.length = 0;
    this._choiceLabels = choices.map((c) => String(c));
    this._choiceLabels.forEach((label, i) => {
      const li = document.createElement('li');
      li.className = 'g lu-choice';
      const lab = document.createElement('div');
      lab.className = 'lu-choice__label';
      lab.textContent = label;
      li.append(lab);
      // (moves, not enters: answers that appear under a resting pointer must not move the cursor)
      li.addEventListener('pointermove', () => { if (this._choicesActive && this._choiceIndex !== i) this._setChoice(i, true); });
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._choicesActive && this._guard <= 0) this._selectChoice(i);
      });
      ul.appendChild(li);
      this._choiceEls.push(li);
    });
    this._choicesLine = this._index;
    this._layoutChoices();
    this._setChoice(0, false);
  }

  /** The answers show, locked: they arm after `choiceQuiet` s of quiet (or at an up / down). */
  _activateChoices() {
    this._choiceDelay = -1;
    this._choicesActive = true;
    this._choiceArmed = false;
    this._quiet = this.choiceQuiet;
    this._react = 0;
    this._choicesEl.classList.remove('is-armed');
    this._keyEl.classList.remove('is-nudge-a', 'is-nudge-b');
    this._setChoicesVisible(true);
  }

  /**
   * The answers arm: the band, the cursor and the keycap fade in (dialog.css); F / Enter picks once
   * `react` s have passed (0: at once).
   * @param {number} react
   */
  _arm(react) {
    if (this._choiceArmed) { this._react = Math.min(this._react, react); return; }
    this._choiceArmed = true;
    this._react = react;
    this._choicesEl.classList.add('is-armed');
  }

  /** A press on answers armed too lately to be answered: they lock again, the quiet starts over. */
  _lock() {
    this._choiceArmed = false;
    this._react = 0;
    this._quiet = this.choiceQuiet;
    this._choicesEl.classList.remove('is-armed');
  }

  /** A Space or a window click on ready answers: nothing is picked, the keycap hops (dialog.css). */
  _nudgeKey() {
    // two keyframe names in turn, so a nudge right after another starts over
    this._nudgeA = !this._nudgeA;
    this._keyEl.classList.toggle('is-nudge-a', this._nudgeA);
    this._keyEl.classList.toggle('is-nudge-b', !this._nudgeA);
  }

  _setChoicesVisible(on) {
    if (!on) {
      this._choicesActive = false;
      this._choiceArmed = false;
    }
    this._choicesEl.classList.toggle('is-on', on);
  }

  _setChoice(i, sound) {
    const n = this._choiceEls.length;
    if (!n) return;
    this._choiceIndex = ((i % n) + n) % n;
    for (let k = 0; k < n; k++) this._choiceEls[k].classList.toggle('is-sel', k === this._choiceIndex);
    this._placeKey();
    if (sound) this._sound('blip');
  }

  _moveChoice(delta) {
    // a one-item list has nowhere to go: no move, no blip (the press is still consumed)
    if (this._choiceEls.length > 1) this._setChoice(this._choiceIndex + delta, true);
  }

  _selectChoice(i) {
    this._lastChoice = i;
    this._sound('confirm');
    this._setChoicesVisible(false);
    this._advance();
  }
}

/**
 * True for a string with something to show (DialogLine.ask: an empty or blank one is no question).
 * @param {unknown} s
 * @returns {s is string}
 */
function hasText(s) {
  return typeof s === 'string' && s.trim() !== '';
}

/**
 * A character-sheet canvas (`createCharacterSheet(...).canvas`) — anything else gives no portrait.
 * @param {unknown} c
 * @returns {c is HTMLCanvasElement}
 */
function isSheet(c) {
  return typeof HTMLCanvasElement !== 'undefined' && c instanceof HTMLCanvasElement && c.width > 0 && c.height > 0;
}
