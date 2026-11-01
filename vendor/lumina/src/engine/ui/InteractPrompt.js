import * as THREE from 'three';
import './ui.css';
import './dialog.css';
import { t, registerStrings, hasStrings } from '../i18n/I18n.js';
import dialogStrings from '../i18n/strings/dialog.js';
import { pal } from './art/palette.js';
import { art } from './art/painter.js';
import { bubble } from './art/pieces.js';
import { grow, measure, txt, setOrigin } from './layout/type.js';
import { put, win, key, capW, place } from './layout/layout.js';
import { onScale, currentScale } from './UiScale.js';
import { currentFonts } from './FontLoader.js';

/** @import { FrameStyle } from './art/frames.js' */

/**
 * Floating interaction prompt after mockup G (docs/specs/PIXEL_UI.md §5, Prompt): today's pixel
 * speech bubble (its three dots blinking in turn) over a small cartouche with the key's keycap and
 * the action's label in the line role, anchored above a world position that is projected into CSS
 * pixels every frame. Drawn in art px at the UI root's `--px` (canvases, `image-rendering:
 * pixelated`). Hidden automatically when the point is behind the camera or off-screen.
 */

/** The cartouche: G's small plate (S, notch 3, studs on its ends, the plate bands). @returns {FrameStyle} */
const PLATE = () => { const k = pal(); return { size: 'S', notch: 3, corners: null, ends: true, endR: 2, bands: [k.plate0, k.plate1], stops: [0, 0.5], sheen: false }; };
/** Art px between the plate's bottom (or the lone bubble's) and the anchor point. */
const GAP = 2;
/** The bubble's three dots (art/pieces.js `bubble()`: 2 × 2 at rows 6–7). */
const DOTS = [6, 12, 18];

const _v = new THREE.Vector3();

export class InteractPrompt {
  /** @param {HTMLElement} parent the UI root (the prompt is positioned in its coordinate space) */
  constructor(parent = document.body) {
    if (!hasStrings('dialog')) registerStrings('dialog', dialogStrings);
    const el = document.createElement('div');
    el.className = 'lu-prompt';
    el.innerHTML = `
      <div class="lu-prompt__anchor">
        <div class="lu-prompt__inner">
          <div class="lu-prompt__bubble g" aria-hidden="true"></div>
          <div class="lu-prompt__label g"></div>
        </div>
      </div>`;
    parent.appendChild(el);
    this.element = el;
    /** @type {HTMLElement} */
    this._inner = el.querySelector('.lu-prompt__inner');
    /** @type {HTMLElement} */
    this._bubble = el.querySelector('.lu-prompt__bubble');
    /** @type {HTMLElement} */
    this._label = el.querySelector('.lu-prompt__label');
    this._parent = parent;

    // the bubble (24 × 18 art px) and a cover over each dot, blinking in turn (dialog.css)
    const k = pal();
    put(this._bubble, bubble(), 0, 0);
    DOTS.forEach((x, i) => {
      const cover = art(2, 2, (p) => p.rect(0, 0, 2, 2, k.kf1));
      put(this._bubble, cover, x, 6, 1, `lu-prompt__dot lu-prompt__dot${i + 1}`);
    });

    /**
     * Optional key hint shown as a keycap before the label (e.g. 'Space'); null for none.
     * @type {string|null}
     */
    this.keyHint = null;

    this._shown = false;
    this._inView = false;
    /** @type {THREE.Object3D|null} tracked object (null → use _pos) */
    this._target = null;
    this._pos = new THREE.Vector3();
    this._offsetY = 0;
    /** @type {string|null} */
    this._labelText = null;
    /** @type {string|null} */
    this._keyText = null;
    this._x = NaN;
    this._y = NaN;
    this._w = parent.clientWidth || window.innerWidth;
    this._h = parent.clientHeight || window.innerHeight;
    /** The fonts' ensure() of the label shown (a newer label drops an older answer). */
    this._ensureSeq = 0;
    this._layout();

    this._ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
        this._w = parent.clientWidth || window.innerWidth;
        this._h = parent.clientHeight || window.innerHeight;
        this._x = NaN;
      })
      : null;
    if (this._ro) this._ro.observe(parent);
    // the label is measured in the type of the root's scale: lay it out again on a change
    this._offScale = onScale(parent, () => { this._x = NaN; this._layout(); });
  }

  /** True between show() and hide(). */
  get visible() { return this._shown; }

  /**
   * Show the prompt above a world position. Cheap to call every frame (the DOM only changes when
   * the label changes). A Vector3 is copied; pass an Object3D instead to make the prompt follow it
   * automatically (its world position is re-read every update).
   * @param {(THREE.Vector3 & { isObject3D?: false })|THREE.Object3D} worldPos (a Vector3 has no
   *   `isObject3D`, which is how show() tells the two apart)
   * @param {string} [label] (default: t('dialog.prompt.talk'), "Talk"; callers pass translated labels)
   * @param {{ offsetY?: number, key?: string|null }} [opts] `offsetY` world units added to y;
   *   `key` overrides `keyHint` for this prompt.
   */
  show(worldPos, label = t('dialog.prompt.talk'), { offsetY = 0, key: keyName } = {}) {
    if (worldPos && worldPos.isObject3D) {
      if (this._target !== worldPos && this._shown) this._repop();
      this._target = worldPos;
    } else {
      this._target = null;
      if (worldPos) this._pos.copy(/** @type {THREE.Vector3} */ (worldPos)); // not an Object3D here
    }
    this._offsetY = offsetY;
    const k = keyName === undefined ? this.keyHint : keyName;
    if (label !== this._labelText || k !== this._keyText) {
      this._labelText = label;
      this._keyText = k;
      this._layout();
      this._ensureFonts();
    }
    if (!this._shown) {
      this._shown = true;
      this._x = NaN;
      this.element.classList.add('is-on');
    }
  }

  hide() {
    if (!this._shown) return;
    this._shown = false;
    // also drop the in-view state so a later show() stays invisible until update() has projected
    // the new anchor (otherwise it could flash for a frame at the previous screen position)
    this._inView = false;
    this.element.classList.remove('is-on', 'is-inview');
  }

  /**
   * Project the anchor into screen space. Call once per frame (after the camera moved).
   * @param {THREE.Camera & { near?: number }} camera (`near` 0.01 when the camera has none)
   */
  update(camera) {
    if (!this._shown || !camera) return;
    if (this._target) this._target.getWorldPosition(_v);
    else _v.copy(this._pos);
    _v.y += this._offsetY || 0;

    camera.updateMatrixWorld();
    _v.applyMatrix4(camera.matrixWorldInverse);
    const behind = _v.z > -(camera.near ?? 0.01);
    _v.applyMatrix4(camera.projectionMatrix);
    const inView = !behind && _v.x > -1.08 && _v.x < 1.08 && _v.y > -1.08 && _v.y < 1.12;
    if (inView !== this._inView) {
      this._inView = inView;
      this.element.classList.toggle('is-inview', inView);
    }
    if (!inView) return;
    // on a whole device pixel, so the art lands on the device grid at any device pixel ratio
    const dpr = currentScale(this._parent)?.dpr || window.devicePixelRatio || 1;
    const x = Math.round((_v.x * 0.5 + 0.5) * this._w * dpr) / dpr;
    const y = Math.round((-_v.y * 0.5 + 0.5) * this._h * dpr) / dpr;
    if (x !== this._x || y !== this._y) {
      this._x = x;
      this._y = y;
      this.element.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
  }

  dispose() {
    if (this._ro) this._ro.disconnect();
    this._offScale();
    this.element.remove();
  }

  /** Replay the pop-in animation (e.g. when the prompt jumps to another NPC). */
  _repop() {
    const inner = this._inner;
    inner.style.animation = 'none';
    void inner.offsetWidth;
    inner.style.animation = '';
  }

  /** Load the label's font slices (Japanese and Chinese come in slices), then lay it out again. */
  _ensureFonts() {
    const fonts = currentFonts();
    const label = this._labelText;
    if (!fonts || !label) return;
    const seq = ++this._ensureSeq;
    fonts.ensure(label).then(() => { if (seq === this._ensureSeq && this._labelText === label) this._layout(); });
  }

  /**
   * G's `interact`, about the anchor point (0, 0): the cartouche's bottom GAP art px above it — 15
   * art px tall round English (a CJK label's taller ink grows it, the key centred on it): 5 px, the
   * keycap, 3 px, the label, 5 px — and the bubble centred over it, 2 px above. Without a label or a
   * key, the bubble alone.
   */
  _layout() {
    const k = pal();
    const L = this._label;
    L.replaceChildren();
    const label = this._labelText || '';
    const cap = this._keyText || '';
    let top = -GAP;
    if (label || cap) {
      const kw = cap ? capW(cap) : 0;
      const lw = label ? measure(label, 'line') : 0;
      const gl = 2 * Math.ceil(grow('line') / 2);
      const w = 5 + kw + (cap && label ? 3 : 0) + lw + 5, h = 15 + gl;
      const x0 = -Math.floor(w / 2), y0 = -GAP - h;
      place(L, x0, y0, w, h);
      setOrigin(L, [x0, y0]);
      win(L, PLATE(), x0, y0, w, h);
      if (cap) key(L, cap, x0 + 5, y0 + 2 + gl / 2);
      if (label) txt(L, label, x0 + 5 + (cap ? kw + 3 : 0), y0 + 3 + gl / 2, { font: 'line', color: k.tx1, drop: true, cls: 'lu-prompt__text' });
      top = y0 - 2;
    }
    place(this._bubble, -12, top - 18, 24, 18);
  }
}
