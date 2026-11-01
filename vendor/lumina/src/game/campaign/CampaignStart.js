/**
 * A campaign's start (`?campaign=<name>`, docs/specs/CAMPAIGN_FORMAT.md): the campaign file and its
 * story files, the saved game, the level to begin in and where in it. Imported by `src/main.js`
 * only when a campaign is played, so a single level loads none of the campaign (or story-state)
 * code.
 */
import { loadLocalLevel } from '../../engine/level/LevelStorage.js';
import { serializeLevel } from '../../engine/level/LevelFormat.js';
import { findEntrance } from '../../engine/level/Travel.js';
import { campaignLevel } from './CampaignFormat.js';
import { loadCampaign, loadStory, CampaignLevels } from './CampaignStorage.js';
import { CampaignState } from './CampaignState.js';
import { CampaignRuntime, registerCampaignStrings } from './CampaignRuntime.js';
import { journeySeed } from '../story/StoryState.js';
import { t } from '../../engine/i18n/I18n.js';
import { term } from '../../engine/i18n/ContentText.js';

/**
 * @import { Level } from '../../engine/level/types.js'
 * @import { Campaign } from './CampaignFormat.js'
 */

/**
 * The level of `campaign` that file id `id` stands for: itself, or the level a chapter swaps it in
 * for ('' when neither).
 * @param {Campaign} campaign
 * @param {string} id
 */
function baseLevelOf(campaign, id) {
  if (campaignLevel(campaign, id)) return id;
  for (const ch of campaign.chapters) for (const [base, variant] of Object.entries(ch.levels)) if (variant === id) return base;
  return '';
}

/**
 * A campaign's start: the campaign file and its story files, the saved game (unless `&new`), the
 * level to begin in — `&level=` (a fresh story, saved apart: `….test`), else the save's, else a
 * debug start preset's (`&story=<name>`, a new game only), else the start — with the story applied
 * and the player placed at the saved spot, the named entrance or the player start. A save whose
 * level can no longer be loaded starts at the campaign's start. The loading line and title are
 * shown in the page's language (the 'campaign' strings are registered here, the campaign's name
 * through its content table when it is in).
 * @param {string} requestedName
 * @param {{ params: URLSearchParams, progress: (fraction: number, text?: string) => void,
 *   title?: Element|null }} page the page's query, its loading bar, its loading title
 * @returns {Promise<{ level: Level, warnings: string[], source: string, campaign: CampaignRuntime }>}
 */
export async function loadCampaignStart(requestedName, { params, progress, title = null }) {
  registerCampaignStrings();
  progress(0.02, t('campaign.loading'));
  const { name, campaign, warnings, errors } = await loadCampaign(requestedName);
  for (const w of warnings) console.warn(`[Luminati] campaigns/${name}/campaign.json: ${w}`);
  if (errors.length) throw new Error(`campaigns/${name}/campaign.json: ${errors.join('; ')}`);
  const { story, warnings: storyWarnings } = campaign.story.length ? await loadStory(name, campaign.story) : { story: null, warnings: [] };
  for (const w of storyWarnings) console.warn(`[Luminati] campaigns/${name}/story: ${w}`);
  const levelParam = params.get('level');
  // (a play-test or a `&level=` start never touches the real saved game)
  const test = !!levelParam;
  if (params.has('new') && params.get('new') !== '0') CampaignState.clear(name, { test });
  const saved = levelParam ? null : CampaignState.load(campaign, name, { story });
  const state = saved ?? new CampaignState(campaign, name, { story, test });
  // (a new journey: its seed for `pick` — a save keeps its own)
  if (!saved) state.story.seed = journeySeed();
  const presetName = params.get('story');
  const preset = presetName && story && Object.hasOwn(story.starts, presetName) ? story.starts[presetName] : null;
  if (presetName && !preset) console.warn(`[Luminati] the story has no start preset "${presetName}"`);
  const levels = new CampaignLevels(name);
  let levelId = state.level;
  let entrance = saved ? '' : campaign.start.entrance;
  let at = saved?.at ?? null;
  if (!saved && preset?.level && campaignLevel(campaign, preset.level)) {
    levelId = preset.level;
    entrance = preset.entrance;
    state.level = levelId;
  }
  if (levelParam) {
    // (a chapter's variant plays as the level it stands for — with its own file's content-text
    // keys: the override names the variant, and the game's `source` is that file, I18N.md §4.8)
    const baseOf = (id) => {
      const b = baseLevelOf(campaign, id);
      if (!b) throw new Error(`"${id}" is not a level of the campaign "${name}"`);
      return b;
    };
    if (levelParam.startsWith('local:')) {
      // the editor's play-test: the browser-slot level plays as campaign level `as`
      const slot = levelParam.slice(6);
      const r = loadLocalLevel(slot);
      if (!r) throw new Error(`No level "${slot}" in this browser's storage`);
      const as = params.get('as') || campaign.start.level;
      levelId = baseOf(as);
      levels.override(levelId, serializeLevel(r.level), as);
    } else {
      levelId = baseOf(levelParam);
      if (levelId !== levelParam) levels.override(levelId, serializeLevel((await levels.load(levelParam)).level), levelParam);
    }
    entrance = params.get('entrance') ?? '';
    at = null;
    state.level = levelId;
  }
  const runtime = new CampaignRuntime({ name, campaign, state, levels, levelId, fileId: levelId, hasSave: !!saved, story, start: preset });
  if (!saved && preset) runtime._applyStartPreset();
  // a play-tested level stays itself; otherwise the chapter may swap in a variant
  let fileId = levels.overridden(levelId) ? levelId : runtime.fileFor(levelId);
  let loaded;
  try {
    loaded = await levels.load(fileId);
  } catch (err) {
    if (!saved) throw err;
    // the saved level is gone (the campaign was edited): its start instead
    console.warn(`[Luminati] the saved level "${fileId}" could not be loaded (${err.message}): starting at the campaign's start`);
    levelId = campaign.start.level;
    entrance = campaign.start.entrance;
    at = null;
    state.level = levelId;
    runtime.levelId = levelId;
    fileId = runtime.fileFor(levelId);
    loaded = await levels.load(fileId);
  }
  runtime.fileId = fileId;
  // (the file as parsed: kept with the level should it be set aside — CAMPAIGN_FORMAT.md §6.3)
  runtime.levelRaw = loaded.level;
  const level = runtime.storyLevel(loaded.level);
  const e = entrance ? findEntrance(level, entrance, runtime.holds) ?? findEntrance(level, entrance) : null;
  if (at) level.spawn = { x: at.x, z: at.z, facing: at.facing };
  else if (e) level.spawn = { x: e.x, z: e.z, facing: e.facing ?? 'down' };
  else if (entrance) console.warn(`[Luminati] level "${levelId}" has no entrance "${entrance}": starting at its player start`);
  if (title) title.textContent = term(campaign.name);
  // (the source names the file whose text is played: a chapter variant's own — `textPath`)
  return { level, warnings: loaded.warnings, source: levels.textPath(fileId), campaign: runtime };
}
