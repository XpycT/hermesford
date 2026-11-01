/**
 * The core UI string tables (docs/specs/I18N.md §2): the namespaces every page with a UI uses,
 * registered by the UI root (`registerCoreStrings()`, UI.js). One file per namespace, each owned by
 * one component's owner (docs/specs/PIXEL_UI.md §8). A feature's own namespaces (combat, party,
 * story, campaign, the world labels' worldfx, the story UI's story-ui) are not listed here: the
 * feature registers them when it starts, so a page without the feature never loads them.
 */
import { registerStrings, hasStrings } from '../I18n.js';
import hud from './hud.js';
import dialog from './dialog.js';
import map from './map.js';
import title from './title.js';
import game from './game.js';

/** The core namespaces and their tables. */
export const CORE_STRINGS = Object.freeze({ hud, dialog, map, title, game });

/**
 * The core tables of one language (each namespace's table for `lang`; a namespace without that
 * language is left out): what FontLoader.ensure reads the glyphs of a page's UI from (Game.js
 * `_shownTexts`, src/main.js `prefetchGlyphs`).
 * @param {string} lang
 * @returns {Record<string, unknown>[]}
 */
export function coreStringsOf(lang) {
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const table of Object.values(CORE_STRINGS)) {
    const t = /** @type {Record<string, Record<string, unknown>|undefined>} */ (/** @type {unknown} */ (table))[lang];
    if (t) out.push(t);
  }
  return out;
}

/**
 * Register the core namespaces (idempotent: a namespace already registered is left as it is).
 * @param {{ force?: boolean }} [o] force: register them again (tests)
 */
export function registerCoreStrings({ force = false } = {}) {
  for (const [ns, table] of Object.entries(CORE_STRINGS)) {
    if (force || !hasStrings(ns)) registerStrings(ns, table);
  }
}
