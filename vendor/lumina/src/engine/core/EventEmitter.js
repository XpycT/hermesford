/**
 * EventEmitter — a tiny, allocation-free (on emit) publish/subscribe helper.
 *
 * Listener lists are copy-on-write: `on`/`off` replace the array for an event, while
 * `emit` iterates whatever array was current when it started. That makes it safe for a
 * listener to unsubscribe itself (or others) mid-emit, and `emit` never allocates, which
 * matters because the engine emits several events every frame.
 *
 * @example
 *   const ev = new EventEmitter();
 *   const off = ev.on('resize', ({ width, height }) => console.log(width, height));
 *   ev.emit('resize', { width: 800, height: 600 });
 *   off();
 */
export class EventEmitter {
  constructor() {
    /** @type {Map<string, (Function & { _onceOriginal?: Function })[]>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} event
   * @param {Function} fn
   * @returns {() => void} unsubscribe function
   */
  on(event, fn) {
    if (typeof fn !== 'function') throw new TypeError(`EventEmitter.on("${event}"): listener must be a function`);
    const list = this._listeners.get(event);
    this._listeners.set(event, list ? [...list, fn] : [fn]);
    return () => this.off(event, fn);
  }

  /**
   * Unsubscribe a listener (also removes a listener registered with `once`).
   * When `fn` is omitted, removes every listener of `event`.
   * @param {string} event
   * @param {Function} [fn]
   */
  off(event, fn) {
    const list = this._listeners.get(event);
    if (!list) return;
    if (fn === undefined) {
      this._listeners.delete(event);
      return;
    }
    const idx = list.findIndex((l) => l === fn || l._onceOriginal === fn);
    if (idx < 0) return;
    if (list.length === 1) this._listeners.delete(event);
    else this._listeners.set(event, list.filter((_, i) => i !== idx));
  }

  /**
   * Subscribe for a single emission.
   * @param {string} event
   * @param {Function} fn
   * @returns {() => void} unsubscribe function
   */
  once(event, fn) {
    if (typeof fn !== 'function') throw new TypeError(`EventEmitter.once("${event}"): listener must be a function`);
    const self = this;
    function wrapper() {
      self.off(event, wrapper);
      // eslint-disable-next-line prefer-rest-params
      return fn.apply(this, arguments);
    }
    wrapper._onceOriginal = fn;
    this.on(event, wrapper);
    return () => this.off(event, wrapper);
  }

  /**
   * Call every listener of `event` with the given arguments (in subscription order).
   * Allocation-free for up to four arguments.
   * @overload
   * @param {string} event
   * @param {...any} args
   * @returns {boolean} true if there was at least one listener
   */
  /**
   * (Implementation: the four named parameters keep dispatch allocation-free; a fifth argument
   * and beyond are read from `arguments`.)
   * @param {string} event
   * @param {any} [a]
   * @param {any} [b]
   * @param {any} [c]
   * @param {any} [d]
   * @returns {boolean}
   */
  emit(event, a, b, c, d) {
    const list = this._listeners.get(event);
    if (list === undefined) return false;
    const n = arguments.length - 1;
    // eslint-disable-next-line prefer-rest-params
    const rest = n > 4 ? Array.prototype.slice.call(arguments, 1) : null;
    for (let i = 0; i < list.length; i++) {
      const fn = list[i];
      switch (n) {
        case 0: fn.call(this); break;
        case 1: fn.call(this, a); break;
        case 2: fn.call(this, a, b); break;
        case 3: fn.call(this, a, b, c); break;
        case 4: fn.call(this, a, b, c, d); break;
        default: fn.apply(this, rest);
      }
    }
    return true;
  }

  /**
   * Current listener array for an event (treat as read-only; a new array replaces it on change).
   * @param {string} event
   * @returns {ReadonlyArray<Function>}
   */
  listeners(event) {
    return this._listeners.get(event) ?? EMPTY;
  }

  /**
   * Number of listeners for `event`.
   * @param {string} event
   */
  listenerCount(event) {
    return this._listeners.get(event)?.length ?? 0;
  }

  /** Remove every listener of every event. */
  clear() {
    this._listeners.clear();
  }
}

const EMPTY = Object.freeze([]);
