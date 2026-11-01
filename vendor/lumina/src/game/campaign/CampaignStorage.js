/**
 * Loading a campaign in the game (docs/specs/CAMPAIGN_FORMAT.md): its `campaign.json` and its level
 * files, fetched from `public/campaigns/<name>/` (in dev and in production builds alike). Level
 * files are fetched once and parsed on every use (the game may change the level it plays), and a
 * level can be fetched ahead (`preload`) while the player walks toward an exit — and built ahead
 * from its text (`text`; LevelPreparation).
 */
import { parseLevel } from '../../engine/level/LevelFormat.js';
import { slugify } from '../../engine/level/LevelStorage.js';
import { parseCampaign, levelFile } from './CampaignFormat.js';
import { buildStory, storyFile } from './StoryFormat.js';

/** @import { Level } from '../../engine/level/types.js' */

const base = () => import.meta.env?.BASE_URL ?? '/';

/**
 * Fetch a text file of the site; dev servers answer unknown paths with index.html (HTTP 200), so
 * an HTML answer is "not found" too.
 * @param {string} url
 * @param {string} what for the error message
 */
async function fetchText(url, what) {
  const r = await fetch(url, { cache: 'no-store' });
  const type = r.headers.get('content-type') ?? '';
  if (!r.ok || type.includes('text/html')) throw new Error(`${what} not found${r.ok ? '' : ` (HTTP ${r.status})`}`);
  return r.text();
}

/**
 * Load `campaigns/<name>/campaign.json`.
 * @param {string} name the campaign's folder name (slugified)
 * @returns {Promise<{ name: string } & ReturnType<typeof parseCampaign>>}
 */
export async function loadCampaign(name) {
  const slug = slugify(name);
  const text = await fetchText(`${base()}campaigns/${encodeURIComponent(slug)}/campaign.json`, `Campaign "${name}"`);
  let parsed;
  try { parsed = parseCampaign(text); } catch (e) { throw new Error(`campaigns/${slug}/campaign.json is not valid JSON (${e.message})`); }
  return { name: slug, ...parsed };
}

/**
 * Load a campaign's story files (campaign.json `story`, docs/specs/STORY_SCRIPT.md §5) and build
 * its story. A file that cannot be fetched is a warning (the rest of the story still plays).
 * @param {string} name the campaign's folder name
 * @param {string[]} files the story file names (`Campaign.story`)
 * @returns {Promise<ReturnType<typeof buildStory>>}
 */
export async function loadStory(name, files) {
  const texts = [];
  const warnings = [];
  await Promise.all(files.map(async (f, k) => {
    try {
      texts[k] = { name: f, text: await fetchText(`${base()}campaigns/${encodeURIComponent(name)}/${storyFile(f)}`, `Story file "${f}"`) };
    } catch (err) {
      warnings.push(err.message);
    }
  }));
  const built = buildStory(texts.filter(Boolean));
  return { story: built.story, warnings: [...warnings, ...built.warnings] };
}

/** The level files of one campaign: fetched once, parsed on every load. */
export class CampaignLevels {
  /** @param {string} name the campaign's folder name */
  constructor(name) {
    this.name = name;
    /** @type {Map<string, Promise<string>>} file id → its text */
    this._texts = new Map();
    /** @type {Map<string, string>} file id → the text that replaces its file (an editor play-test) */
    this._overrides = new Map();
    /**
     * File id → the file whose text that override is (a chapter variant played as its level, a
     * play-test `&as=` one): `textPath` names it.
     * @type {Map<string, string>}
     */
    this._overrideFiles = new Map();
  }

  /** The level's path below the site root. @param {string} id */
  path(id) {
    return `campaigns/${this.name}/${levelFile(id)}`;
  }

  /**
   * The path of the file whose text is played as file `id`: its own (`path`), or — overridden —
   * the file the override's text is (`override`'s `textFile`). What the game's `source` names: the
   * file actually played (a chapter variant started by `&level=` or play-tested `&as=` is the
   * variant's file, docs/specs/I18N.md §4.8; its texts' keys are the ones it holds, §4.2).
   * @param {string} id
   */
  textPath(id) {
    return this.path(this._overrideFiles.get(id) ?? id);
  }

  /**
   * Play this text as level `id` instead of its file (the editor's play-test of a campaign level, a
   * chapter variant started as its level).
   * @param {string} id
   * @param {string} text a level file's text
   * @param {string} [textFile] the campaign file id that text is (a chapter's variant, the level
   *   play-tested; default `id`): the file the game's `source` then names (`textPath`)
   */
  override(id, text, textFile = id) {
    this._overrides.set(id, text);
    this._overrideFiles.set(id, textFile);
  }

  /** Has a level a play-test text? @param {string} id */
  overridden(id) {
    return this._overrides.has(id);
  }

  /**
   * Fetch level `id` without waiting (errors are kept for `load`).
   * @param {string} id
   */
  preload(id) {
    this._text(id).catch(() => {});
  }

  /**
   * Level `id`, freshly parsed.
   * @param {string} id
   * @returns {Promise<{ level: Level, warnings: string[] }>}
   */
  async load(id) {
    return parseLevel(await this._text(id));
  }

  /**
   * The text of level `id` (fetched once; its play-test text if it has one) — what a level built
   * ahead is parsed from (LevelPreparation).
   * @param {string} id
   * @returns {Promise<string>}
   */
  text(id) {
    return this._text(id);
  }

  /** @param {string} id */
  _text(id) {
    if (this._overrides.has(id)) return Promise.resolve(this._overrides.get(id));
    let p = this._texts.get(id);
    if (!p) {
      p = fetchText(`${base()}${this.path(id)}`, `Level "${id}" of campaign "${this.name}"`);
      // a failed fetch is tried again next time
      p.catch(() => this._texts.delete(id));
      this._texts.set(id, p);
    }
    return p;
  }
}
