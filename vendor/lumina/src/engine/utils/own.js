/**
 * Safe handling of names and values that come from level data (KNOWN_ISSUES LVL-17).
 *
 * Own-key lookups for the constant tables that names from level data index (object types, tile
 * stairs, texture names, tree / critter kinds, particle presets, scripts, colours …):
 * `TABLE[name]` also finds the Object.prototype members ("constructor", "toString",
 * "__proto__", "hasOwnProperty" …), so a hand-written or hostile level file could pass a table
 * test with such a name and then crash on the value. `isOwnKey` / `ownValue` accept only a string
 * that is one of the table's own keys; any other name is unknown, exactly like a misspelt one.
 * Both are allocation-free (safe on per-frame paths).
 *
 * Conversions that never throw: a JSON object with an own `toString` key (`{"toString": 1}`) makes
 * `String(v)`, `${v}`, `Number(v)` and comparisons throw ("Cannot convert object to primitive
 * value": ToPrimitive finds no callable toString / valueOf). `showValue` formats any value for a
 * message, `toText` / `toNumber` convert a value that should be text / a number (load-time code;
 * they are not meant for per-frame paths). `stripUnconvertible` removes such values from parsed
 * level data where the load keeps it as it is (objects, the legend, the environment: LVL-18).
 *
 * Colour names: `ownColor` keeps the two Object.prototype names three.js would resolve to black
 * ("constructor", "__proto__") away from `THREE.Color` (LVL-19).
 */

/**
 * Is `key` a string naming one of `table`'s own properties?
 * @template {object} T
 * @param {T} table
 * @param {unknown} key any value (non-strings are never keys)
 * @returns {key is Extract<keyof T, string>}
 */
export function isOwnKey(table, key) {
  return typeof key === 'string' && Object.hasOwn(table, key);
}

/**
 * `table[key]` when `key` is one of the table's own keys (`isOwnKey`), otherwise undefined —
 * so `ownValue(T, name) ?? fallback` takes the fallback for every unknown name.
 * @template {object} T
 * @param {T} table
 * @param {unknown} key any value (non-strings give undefined)
 * @returns {T[keyof T] | undefined}
 */
export function ownValue(table, key) {
  return isOwnKey(table, key) ? table[key] : undefined;
}

/**
 * Text of any value for a warning or error message: a string as it is, anything else as JSON
 * (`5`, `null`, `["house"]`, `{"toString":1}`; undefined → "undefined"). Never throws. Strings,
 * numbers, booleans, null and undefined read exactly as `${v}` would.
 * @param {unknown} v
 * @returns {string}
 */
export function showValue(v) {
  if (typeof v === 'string') return v;
  try {
    return String(JSON.stringify(v));
  } catch {
    return typeof v;
  }
}

/**
 * `String(v)` for a level value that should be text, or `fallback` when String() throws (a JSON
 * object with an own `toString` key): every value String() converts gives the same text as before.
 * @param {unknown} v
 * @param {string} fallback
 * @returns {string}
 */
export function toText(v, fallback) {
  try {
    return String(v);
  } catch {
    return fallback;
  }
}

/**
 * `Number(v)` for a level value that should be a number, or NaN when Number() throws (a JSON
 * object with an own `toString` key and no callable `valueOf`): every value Number() converts
 * gives the same number as before.
 * @param {unknown} v
 * @returns {number}
 */
export function toNumber(v) {
  try {
    return Number(v);
  } catch {
    return NaN;
  }
}

/**
 * Can String() convert `v` without throwing? False for a JSON object with an own `toString` key
 * (`{"toString": 1}`; the only kind of parsed-JSON value whose conversion throws, besides an array
 * holding one); arrays answer true (their elements are tested on their own, see
 * `stripUnconvertible`).
 * @param {unknown} v
 */
function convertible(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return true;
  try {
    String(v);
    return true;
  } catch {
    return false;
  }
}

/**
 * Does `value` hold a value String() cannot convert (itself or anywhere inside, to depth 8)? The
 * test `stripUnconvertible` would act on (load-time code).
 * @param {unknown} value
 * @param {number} [depth] (internal: the recursion depth)
 * @returns {boolean}
 */
export function hasUnconvertible(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return false;
  if (!convertible(value)) return true;
  for (const k of Object.keys(value)) if (hasUnconvertible(value[k], depth + 1)) return true;
  return false;
}

/**
 * Remove, in place, every value String() cannot convert from parsed level data (KNOWN_ISSUES
 * LVL-18): such a value under an object key is deleted (so a default can fill it), such an array
 * element becomes null; plain objects and arrays are searched (to depth 8). Values String()
 * converts — strings, numbers, booleans, null, ordinary objects and arrays — are left exactly as
 * they are, so valid data keeps its bytes. Load-time code: pass a copy you own.
 * @template T
 * @param {T} value
 * @param {number} [depth] (internal: the recursion depth)
 * @returns {T} `value`
 */
export function stripUnconvertible(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return value;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!convertible(value[i])) value[i] = null;
      else stripUnconvertible(value[i], depth + 1);
    }
  } else {
    for (const k of Object.keys(value)) {
      if (!convertible(value[k])) delete value[k];
      else stripUnconvertible(value[k], depth + 1);
    }
  }
  return value;
}

/** Colour names `ownColor` has warned about (once each). */
const warnedColors = new Set();

/**
 * A colour from level data, safe to hand to three.js (`Color.set`, `new THREE.Color`, a light's
 * colour). three.js looks a colour name up in its keyword table with a plain index after
 * lower-casing it, so "constructor" and "__proto__" find an Object.prototype member and the colour
 * turns black without a warning (KNOWN_ISSUES LVL-19). Such a name gives `undefined` after a
 * console warning (once per name) — the caller's default, or what three.js does with any unknown
 * name: `Color.set(undefined)` keeps the colour, `new THREE.Color(undefined)` is white. Every other
 * value is returned as it is (an unknown name too: three.js warns about it itself). Allocates only
 * the lower-cased copy of a string.
 * @template T
 * @param {T} value any value (only strings are tested)
 * @param {object} names the colour-name table: `THREE.Color.NAMES` (passed in, this module has no
 *   imports)
 * @returns {T | undefined}
 */
export function ownColor(value, names) {
  if (typeof value !== 'string') return value;
  const key = value.toLowerCase();
  if (Object.hasOwn(names, key) || !(key in names)) return value;
  if (!warnedColors.has(key)) {
    warnedColors.add(key);
    console.warn(`[Luminati] "${value}" is not a colour name; the default colour is used.`);
  }
  return undefined;
}
