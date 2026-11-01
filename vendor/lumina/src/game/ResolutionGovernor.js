/**
 * @import { Engine } from '../engine/core/Engine.js'
 * @import { PostFX } from '../engine/render/PostFX.js'
 */

/**
 * Keeps the frame inside the GPU budget on big / high-DPI screens.
 *
 * 1. Pixel budget: the drawing buffer is capped at ~2.1 MP (about 1920×1080) by lowering the
 *    engine's maxPixelRatio when the window is larger — a 2560×1440 canvas renders at ~1930×1086
 *    and is scaled up by the browser. Screens at or below 1080p are untouched.
 * 2. Dynamic resolution: when EXT_disjoint_timer_query is available, the summed PostFX GPU stage
 *    timings are sampled twice a second. A step reallocates the drawing buffer and the post
 *    targets — a one-off hitch (a few ms on an idle GPU, up to ~0.2 s on a busy one) — so the
 *    governor decides on the median of the last samples (one slow frame is not a trend) and steps
 *    rarely: `engine.renderScale` goes down by 0.1 (not below `minScale`) after 2 s of a median
 *    above `slowMs`, back up after 10 s of a median below `fastMs`, and never twice within 3 s.
 *
 * Setting `manual = true` (the debug panel's render-scale slider does) hands renderScale back to
 * the user; the pixel budget keeps applying.
 */
export class ResolutionGovernor {
  /**
   * @param {{ engine: Engine, postfx: PostFX, maxPixelRatio?: number, pixelBudget?: number,
   *           slowMs?: number, fastMs?: number, minScale?: number }} opts
   */
  constructor({ engine, postfx, maxPixelRatio = engine.maxPixelRatio, pixelBudget = 2.1e6, slowMs = 13.5, fastMs = 8.5, minScale = 0.7 }) {
    this.engine = engine;
    this.postfx = postfx;
    this.maxPixelRatio = maxPixelRatio;
    this.pixelBudget = pixelBudget;
    this.slowMs = slowMs;
    this.fastMs = fastMs;
    this.minScale = minScale;
    this.enabled = true;
    this.manual = false;
    /** Last summed GPU frame time (ms) the governor looked at (0 = no timer data). */
    this.gpuMs = 0;
    /** Median of the recent samples (ms) the decisions are based on. */
    this.medianMs = 0;
    this._w = -1;
    this._h = -1;
    this._timer = 0;
    this._cooldown = 2;
    this._slow = 0;
    this._fast = 0;
    this._samples = [];
    this._sorted = [];
    this._timings = postfx.enableTimings(true);
  }

  update(dt) {
    const e = this.engine;
    // ---- pixel budget ----
    if (e.width !== this._w || e.height !== this._h) {
      this._w = e.width;
      this._h = e.height;
      const cap = Math.min(this.maxPixelRatio, Math.sqrt(this.pixelBudget / Math.max(1, this._w * this._h)));
      if (Math.abs(e.maxPixelRatio - cap) > 1e-3) {
        e.maxPixelRatio = cap;
        e.resize();
      }
    }
    // ---- dynamic render scale ----
    if (!this._timings || !this.enabled || this.manual) return;
    this._cooldown -= dt;
    this._timer += dt;
    if (this._timer < 0.5) return;
    this._timer = 0;
    const T = this.postfx.timings;
    let ms = 0;
    for (const k in T) ms += T[k];
    this.gpuMs = ms;
    if (ms <= 0) return;
    // median of the last 5 samples (2.5 s): a single slow frame (another app's burst) is no trend
    const S = this._samples;
    S.push(ms);
    if (S.length > 5) S.shift();
    if (S.length < 3) return;
    const sorted = this._sorted;
    sorted.length = 0;
    for (let i = 0; i < S.length; i++) sorted.push(S[i]);
    sorted.sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    this.medianMs = med;
    this._slow = med > this.slowMs ? this._slow + 1 : 0;
    this._fast = med < this.fastMs ? this._fast + 1 : 0;
    if (this._cooldown > 0) return;
    const s = e.renderScale;
    if (this._slow >= 4 && s > this.minScale + 1e-3) {
      e.renderScale = Math.max(this.minScale, Math.round((s - 0.1) * 100) / 100);
      this._settle();
    } else if (this._fast >= 20 && s < 1 - 1e-3) {
      e.renderScale = Math.min(1, Math.round((s + 0.1) * 100) / 100);
      this._settle();
    }
  }

  /** After a step: at least 3 s before the next, judged on fresh samples at the new scale. */
  _settle() {
    this._cooldown = 3;
    this._slow = 0;
    this._fast = 0;
    this._samples.length = 0;
  }

  dispose() {
    if (this._timings) this.postfx.enableTimings(false);
  }
}
