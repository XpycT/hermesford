/**
 * Web Worker for Water.refreshAsync(): bakes the water shore texture (WaterShore.bakeShore — the
 * very code Water.refresh() runs) off the main thread, so a big level's loading screen keeps
 * animating while it bakes. Messages: { id, input, a0, b0, W, H } → { id, out } | { id, error }.
 */
import { bakeShore } from './WaterShore.js';

self.onmessage = (e) => {
  const { id, input, a0, b0, W, H } = e.data;
  let out = null;
  try {
    out = bakeShore(input, a0, b0, W, H);
  } catch (err) {
    self.postMessage({ id, error: String(err?.stack ?? err) });
    return;
  }
  // @ts-expect-error self is the worker scope, typed as Window (no webworker lib): the transfer is right
  self.postMessage({ id, out }, [out.buffer]);
};
