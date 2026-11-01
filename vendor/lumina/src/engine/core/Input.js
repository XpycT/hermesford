/**
 * Input — keyboard, mouse wheel and pointer state with named actions (keyboard and mouse only).
 *
 * Keyboard state is keyed by `KeyboardEvent.code` (layout independent, e.g. 'KeyW').
 * Edge sets (`wasPressed` / `wasReleased`) accumulate between frames and are cleared in
 * `endFrame()`, so a key tapped between two frames still registers on the next frame.
 *
 * Opt-in (combat levels, COMBAT.md §5.3): `addBindings()` adds / replaces actions at runtime,
 * `enableMouseButtons(canvas)` reports mouse buttons on the canvas as the codes 'Mouse0' (left),
 * 'Mouse1' (middle) and 'Mouse2' (right), usable in `bindings` like key codes; `lastDevice` names
 * the device of the latest pressed edge ('keyboard' | 'mouse').
 *
 * Frame protocol (the Engine does this for you): queries during the frame, `endFrame()` after
 * rendering.
 */

/** @import { ExtraActions } from './types.js' */

/**
 * An action name: one of the default bindings' or one a level adds with `addBindings` (declared in
 * ExtraActions by the module that adds it: combat/types.d.ts).
 * @typedef ActionName
 * @type {keyof typeof DEFAULT_BINDINGS | keyof ExtraActions}
 */

/** Default keyboard bindings, exactly as specified by the engine contract. */
export const DEFAULT_BINDINGS = Object.freeze({
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  confirm: ['Space', 'Enter', 'KeyF'],
  // a dialog's answers are picked with F or Enter only: Space pages on but never answers
  choose: ['Enter', 'KeyF'],
  cancel: ['Escape', 'Backspace'],
  camLeft: ['KeyQ'],
  camRight: ['KeyE'],
  zoomIn: ['KeyZ', 'Equal'],
  zoomOut: ['KeyX', 'Minus'],
  debug: ['Backquote', 'F1'],
  time: ['KeyT'],
  photo: ['KeyP'],
  help: ['KeyH'],
  weather: ['KeyR'],
  music: ['KeyM'],
  map: ['KeyN', 'Tab'],
});

const cloneBindings = (src) => Object.fromEntries(Object.entries(src).map(([k, v]) => [k, [...v]]));

/** True when keyboard focus is in something that accepts text (lil-gui inputs, forms …). */
function isEditable(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el.type || 'text').toLowerCase();
    // Buttons/checkboxes don't consume typing; everything else does.
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'image', 'color', 'file', 'range'].includes(type);
  }
  return false;
}

export class Input {
  /**
   * @param {EventTarget} [target=window] element (or window) keyboard/pointer/wheel listeners attach to
   * @param {{ wheelIgnoreSelector?: string }} [opts]
   *   - wheelIgnoreSelector: wheel events whose target matches (closest) are ignored
   *     (default: lil-gui panels, form fields and `[data-input-ignore]`)
   */
  constructor(target = window, opts = {}) {
    this.target = target;
    /** When false every query returns false / zero. */
    this.enabled = true;
    /** Keyboard bindings: { [action]: KeyboardEvent.code[] } — editable. */
    this.bindings = cloneBindings(DEFAULT_BINDINGS);
    this.wheelIgnoreSelector = opts.wheelIgnoreSelector ?? '.lil-gui, input, textarea, select, [contenteditable], [data-input-ignore]';

    /** Accumulated mouse-wheel deltaY (px) since the last endFrame (stays 0 while `enabled` is false). */
    this.wheelDelta = 0;
    /** Pointer state in CSS px (client coordinates). */
    this.pointer = { x: 0, y: 0, down: false, buttons: 0, inside: false };

    this._down = new Set();
    this._pressed = new Set();
    this._released = new Set();
    this._move = { x: 0, y: 0 };
    this._boundCodes = new Set();
    this._boundCacheKey = '';
    /**
     * The device of the latest pressed edge: 'keyboard' | 'mouse' (COMBAT.md §5.3). Updated on
     * every key press and mouse-button press (only after `enableMouseButtons`); the wheel does not
     * change it.
     * @type {'keyboard'|'mouse'}
     */
    this.lastDevice = 'keyboard';
    /** Canvas whose mouse buttons are reported as 'Mouse0' … 'Mouse2' (see enableMouseButtons). */
    this._mouseTarget = null;
    /** Mouse codes currently held (a subset of _down), released on any pointerup / blur. */
    this._mouseDown = new Set();

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onVisibility = this._onVisibility.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);

    const t = target;
    t.addEventListener('keydown', this._onKeyDown);
    t.addEventListener('keyup', this._onKeyUp);
    t.addEventListener('wheel', this._onWheel, { passive: true });
    t.addEventListener('pointermove', this._onPointerMove, { passive: true });
    t.addEventListener('pointerdown', this._onPointerDown, { passive: true });
    t.addEventListener('pointerup', this._onPointerUp, { passive: true });
    t.addEventListener('pointercancel', this._onPointerUp, { passive: true });
    if (typeof window !== 'undefined') {
      window.addEventListener('blur', this._onBlur);
      document.addEventListener('visibilitychange', this._onVisibility);
      document.documentElement.addEventListener('pointerleave', this._onPointerLeave);
    }
  }

  // ---------------------------------------------------------------------------
  // Raw key queries
  // ---------------------------------------------------------------------------

  /** Is the key (KeyboardEvent.code, or a 'Mouse*' code after `enableMouseButtons`) currently held? */
  isDown(code) {
    return this.enabled && this._down.has(code);
  }

  /** Was the key pressed since the previous frame? */
  wasPressed(code) {
    return this.enabled && this._pressed.has(code);
  }

  /** Was the key released since the previous frame? */
  wasReleased(code) {
    return this.enabled && this._released.has(code);
  }

  /** True if any key (or reported mouse button) was pressed since the previous frame. */
  anyPressed() {
    return this.enabled && this._pressed.size > 0;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /** Is any key bound to the action held? @param {ActionName} name */
  action(name) {
    if (!this.enabled) return false;
    return this._anyOf(this.bindings[name], this._down);
  }

  /** Was any key bound to the action pressed since the previous frame? @param {ActionName} name */
  actionPressed(name) {
    if (!this.enabled) return false;
    return this._anyOf(this.bindings[name], this._pressed);
  }

  /** Was any key bound to the action released since the previous frame? @param {ActionName} name */
  actionReleased(name) {
    if (!this.enabled) return false;
    return this._anyOf(this.bindings[name], this._released);
  }

  /**
   * Consume the pressed edge of an action so later readers in the same frame don't see it
   * (e.g. a dialog box swallowing 'confirm'). Returns whether it was pressed.
   * @param {ActionName} name
   */
  consumeAction(name) {
    const was = this.actionPressed(name);
    if (was) {
      const k = this.bindings[name];
      if (k) for (let i = 0; i < k.length; i++) this._pressed.delete(k[i]);
    }
    return was;
  }

  _anyOf(codes, set) {
    if (!codes) return false;
    for (let i = 0; i < codes.length; i++) if (set.has(codes[i])) return true;
    return false;
  }

  /**
   * Movement vector from WASD / the arrow keys.
   * x > 0 = right, y > 0 = up/forward (screen up). Length ≤ 1.
   * The returned object is reused between calls — copy it if you need to keep it.
   * @param {{x:number, y:number}} [out]
   * @returns {{x:number, y:number}}
   */
  getMoveVector(out = this._move) {
    out.x = 0;
    out.y = 0;
    if (!this.enabled) return out;
    let x = (this.action('right') ? 1 : 0) - (this.action('left') ? 1 : 0);
    let y = (this.action('up') ? 1 : 0) - (this.action('down') ? 1 : 0);
    if (x !== 0 && y !== 0) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
      // a diagonal's length in doubles is 1.0000000000000002: scaled back to 1, as it always was
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
    }
    out.x = x;
    out.y = y;
    return out;
  }

  /**
   * Add or replace action bindings at runtime (combat levels, COMBAT.md §5.2). For every action
   * key of `keyboard` the action's code list is replaced by a copy of the given one (an empty list
   * unbinds it); other actions are untouched; new action names are allowed. Newly bound keyboard
   * codes are preventDefault'ed from then on (unless Ctrl / Alt / Meta is held).
   * @param {Record<string, string[]>} [keyboard] action → KeyboardEvent.code[] (or 'Mouse0'…'Mouse2')
   */
  addBindings(keyboard = {}) {
    for (const [action, codes] of Object.entries(keyboard ?? {})) this.bindings[action] = [...(codes ?? [])];
    this._boundCacheKey = ''; // rebuild the preventDefault set on the next key event
  }

  /**
   * Report mouse buttons on `target` (the renderer canvas) as the codes 'Mouse0' (left),
   * 'Mouse1' (middle) and 'Mouse2' (right) for `isDown` / `wasPressed` / actions (bind them like
   * key codes). Combat levels only (COMBAT.md §5.3); peaceful pages never call it.
   * - A press counts only when the pointer event's target IS `target`: clicks on UI panels
   *   (dialog, choices, title, lil-gui, death screen) never produce the codes.
   * - A release counts anywhere (a window listener), and blur / a hidden tab release every held
   *   button through `reset()`, so a button can never stick.
   * - Buttons pressed while another is held (chorded, reported by browsers as `pointermove` with a
   *   `button` ≥ 0) are handled the same way.
   * - The context menu and the middle-button autoscroll on `target` are suppressed.
   * Calling it again moves the listeners to the new target.
   * @param {EventTarget} target
   */
  enableMouseButtons(target) {
    if (!target || typeof window === 'undefined') return;
    if (this._mouseTarget) this._disableMouseButtons();
    this._mouseTarget = target;
    this._onMouseDown ??= this._mouseDownEdge.bind(this);
    this._onMouseMove ??= this._mouseChord.bind(this);
    this._onMouseUp ??= this._mouseUpEdge.bind(this);
    this._onContextMenu ??= (e) => e.preventDefault();
    this._onAuxDown ??= (e) => { if (e.button === 1) e.preventDefault(); };
    window.addEventListener('pointerdown', this._onMouseDown, { capture: true, passive: true });
    window.addEventListener('pointermove', this._onMouseMove, { capture: true, passive: true });
    window.addEventListener('pointerup', this._onMouseUp, { capture: true, passive: true });
    window.addEventListener('pointercancel', this._onMouseUp, { capture: true, passive: true });
    target.addEventListener('contextmenu', this._onContextMenu);
    target.addEventListener('mousedown', this._onAuxDown);
  }

  /**
   * A copy of the current bindings, for `restoreBindings` (a level that adds bindings with
   * `addBindings` and is left again: a campaign's combat level).
   * @returns {{ keyboard: Record<string, string[]> }}
   */
  saveBindings() {
    return { keyboard: cloneBindings(this.bindings) };
  }

  /**
   * Put back bindings saved by `saveBindings` (actions added since are removed).
   * @param {{ keyboard: Record<string, string[]> }} saved
   */
  restoreBindings(saved) {
    this.bindings = cloneBindings(saved.keyboard);
    this._boundCacheKey = '';
  }

  /** Stop reporting mouse buttons (the opposite of `enableMouseButtons`). */
  disableMouseButtons() {
    this._disableMouseButtons();
  }

  /** @internal remove the listeners of enableMouseButtons and release held mouse codes */
  _disableMouseButtons() {
    const t = this._mouseTarget;
    if (!t) return;
    window.removeEventListener('pointerdown', this._onMouseDown, { capture: true });
    window.removeEventListener('pointermove', this._onMouseMove, { capture: true });
    window.removeEventListener('pointerup', this._onMouseUp, { capture: true });
    window.removeEventListener('pointercancel', this._onMouseUp, { capture: true });
    t.removeEventListener('contextmenu', this._onContextMenu);
    t.removeEventListener('mousedown', this._onAuxDown);
    for (const code of this._mouseDown) this._releaseCode(code);
    this._mouseDown.clear();
    this._mouseTarget = null;
  }

  /** @internal press edge of a mouse button (only on the enabled target) */
  _mouseDownEdge(e) {
    if (e.target !== this._mouseTarget) return;
    this._pressMouse(e.button);
  }

  /** @internal chorded button change (a second button pressed / released while one is held) */
  _mouseChord(e) {
    const b = e.button;
    if (!(b >= 0 && b <= 2)) return; // -1: a plain move
    const bit = b === 1 ? 4 : b === 2 ? 2 : 1; // `buttons` bits: left 1, right 2, middle 4
    if (e.buttons & bit) { if (e.target === this._mouseTarget) this._pressMouse(b); }
    else this._releaseCode(`Mouse${b}`);
  }

  /** @internal release edge (anywhere) */
  _mouseUpEdge(e) {
    const b = e.button;
    if (b >= 0 && b <= 2) this._releaseCode(`Mouse${b}`);
    // a lost release (e.g. a pointercancel without a button): drop codes whose bit is clear
    if (this._mouseDown.size && typeof e.buttons === 'number') {
      for (const code of this._mouseDown) {
        const n = +code.charAt(5);
        const bit = n === 1 ? 4 : n === 2 ? 2 : 1;
        if (!(e.buttons & bit)) this._releaseCode(code);
      }
    }
  }

  /** @internal */
  _pressMouse(button) {
    if (!(button >= 0 && button <= 2)) return;
    const code = `Mouse${button}`;
    if (this._down.has(code)) return;
    this._down.add(code);
    this._mouseDown.add(code);
    this._pressed.add(code);
    this.lastDevice = 'mouse';
  }

  /** @internal */
  _releaseCode(code) {
    this._mouseDown.delete(code);
    if (this._down.delete(code)) this._released.add(code);
  }

  // ---------------------------------------------------------------------------
  // Frame protocol
  // ---------------------------------------------------------------------------

  /** Call once after rendering: clears per-frame edges and the wheel accumulator. */
  endFrame() {
    if (this._pressed.size) this._pressed.clear();
    if (this._released.size) this._released.clear();
    this.wheelDelta = 0;
  }

  /** Release every held key (fires release edges). */
  reset() {
    for (const code of this._down) this._released.add(code);
    this._down.clear();
    this._mouseDown.clear();
    this.pointer.down = false;
    this.pointer.buttons = 0;
    this.wheelDelta = 0;
  }

  /** Remove all event listeners. */
  dispose() {
    const t = this.target;
    t.removeEventListener('keydown', this._onKeyDown);
    t.removeEventListener('keyup', this._onKeyUp);
    t.removeEventListener('wheel', this._onWheel);
    t.removeEventListener('pointermove', this._onPointerMove);
    t.removeEventListener('pointerdown', this._onPointerDown);
    t.removeEventListener('pointerup', this._onPointerUp);
    t.removeEventListener('pointercancel', this._onPointerUp);
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', this._onBlur);
      document.removeEventListener('visibilitychange', this._onVisibility);
      document.documentElement.removeEventListener('pointerleave', this._onPointerLeave);
      this._disableMouseButtons();
    }
    this._down.clear();
    this._mouseDown.clear();
    this._pressed.clear();
    this._released.clear();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Set of every keyboard code referenced by `bindings` (rebuilt when bindings change). */
  _isBound(code) {
    // Cheap change detection: bindings are small; rebuild when the joined key changes.
    let key = '';
    for (const k in this.bindings) key += k + ':' + this.bindings[k].join(',') + ';';
    if (key !== this._boundCacheKey) {
      this._boundCacheKey = key;
      this._boundCodes.clear();
      for (const k in this.bindings) for (const c of this.bindings[k]) this._boundCodes.add(c);
    }
    return this._boundCodes.has(code);
  }

  _onKeyDown(e) {
    const code = e.code;
    if (!code) return;
    const editable = isEditable(e.target) || isEditable(typeof document !== 'undefined' ? document.activeElement : null);
    if (editable) return; // typing into a field must not drive the game
    if (!e.ctrlKey && !e.metaKey && !e.altKey && this._isBound(code)) e.preventDefault();
    if (!this._down.has(code)) {
      this._down.add(code);
      if (!e.repeat) {
        this._pressed.add(code);
        this.lastDevice = 'keyboard';
      }
    }
  }

  _onKeyUp(e) {
    const code = e.code;
    if (!code) return;
    if (this._down.has(code)) {
      this._down.delete(code);
      this._released.add(code);
    }
    const editable = isEditable(e.target);
    if (!editable && !e.ctrlKey && !e.metaKey && !e.altKey && this._isBound(code)) e.preventDefault();
  }

  _onBlur() {
    this.reset();
  }

  _onVisibility() {
    if (document.visibilityState === 'hidden') this.reset();
  }

  _onWheel(e) {
    if (!this.enabled) return; // contract: disabled input reports zero (incl. wheelDelta)
    const t = e.target;
    if (t && t.closest && this.wheelIgnoreSelector && t.closest(this.wheelIgnoreSelector)) return;
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; // lines
    else if (e.deltaMode === 2) dy *= 400; // pages
    this.wheelDelta += dy;
  }

  _onPointerMove(e) {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.inside = true;
  }

  _onPointerDown(e) {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.down = true;
    this.pointer.buttons = e.buttons;
    this.pointer.inside = true;
  }

  _onPointerUp(e) {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.buttons = e.buttons ?? 0;
    this.pointer.down = this.pointer.buttons !== 0;
  }

  _onPointerLeave() {
    this.pointer.inside = false;
  }
}
