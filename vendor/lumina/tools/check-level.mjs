#!/usr/bin/env node
/**
 * check-level.mjs — the generators' level checks for any level file, e.g. one made in the editor.
 *
 * Runs `checkLevel` of tools/lib/levelcheck.mjs — the checks `tools/make-gildhaven.mjs` runs on
 * the level it builds — on a saved level: a walk from the spawn with the game's movement rules
 * (every villager, door, sign, well and region reachable; no unreachable pocket), stairs, the
 * waterfalls' drops, bridges walkable end to end (an automatic deck height resolved as the game
 * does), props on flat dry ground, overlaps, blocked doors, what the north-looking camera cannot
 * see past roofs and tree crowns (villagers, talk spots, doors, signs, wells, campfires; the share
 * of street tiles behind roofs), walls and cliffs that hide a walker, critters, wall torches,
 * presets, the villagers' sprite names (a `spec` hat, hair style, weapon, build, outfit or cape
 * style or crest the character sprites do not know, and so draw as their default without a word: a
 * warning, also with --strict), environment areas, regions over the reachable ground. Read-only: it
 * never writes the level.
 *
 * Usage:
 *   node tools/check-level.mjs <level> [<level> …] [--strict] [--routes=<file.json>] [--quiet]
 *   node tools/check-level.mjs --campaign=<campaign> [--strict] [--quiet]
 *   npm run level:check -- <level> …
 *     <level>   a name in public/levels/ (`brightwater-crossing`) or a path to a .json file
 *     --strict  the generators' bar: the composition rules (roofs, crowns, overlaps, footprints,
 *               pockets, the 3 % of street tiles behind roofs, region coverage) are errors too;
 *               without it they are warnings
 *     --routes  a JSON file of walks that must stay direct (≤ 1.5 × the straight line + 3):
 *               [["the square → the bridge", [x0, z0], [x1, z1]], …] — one level per run
 *     --quiet   print only the problems and the summary
 *     --campaign  a campaign (docs/specs/CAMPAIGN_FORMAT.md): a name in public/campaigns/ or a
 *               folder holding campaign.json — every level file of it (chapter variants
 *               included) is checked, then the links between them: exits that lead to a level
 *               and an entrance that exist, seams of placed levels that agree (in every
 *               chapter), every level reachable from the start — and the story: its story files
 *               (`story/`), every script parses and names what exists, flags read but never set,
 *               exits whose story condition can never hold (tools/lib/campaigncheck.mjs)
 *
 * On a level file the streets are inferred from the tile types (dirt paths, cobbles, stone tiles,
 * wooden decks, stairs — dirt counts as ground), and every tree counts as hand-placed. A
 * generator's own run knows its streets and scatter: for a generated level run its generator.
 *
 * A level's story problems (`storyIssues`: scripts and conditions that do not parse, events that
 * lack what their trigger needs, names the level does not have) are part of every check.
 *
 * Story states: when the objects' `when` / `unless` apply — a level with a story (an event, a
 * villager with a talk script or an actor), every level of a campaign (a file in a campaign's
 * `levels/` folder too) — the walk and everything that depends on what is there is checked once per
 * story state: each distinct set of objects that one combination of what the conditions test lets
 * be there (all of them up to 64 on a 128 × 128 level, up to 256 on a smaller one; past that a
 * sample, and the report says so). Two objects the story never has there together do not overlap;
 * a finding in every state where its objects are there reads as without conditions; something
 * reached only in some states is one warning naming them ("reached only with `bridge-mended`: exit
 * exit_east …"); any other finding that holds only in some states names them in brackets.
 *
 * Exit code: 0 when no level has an error (warnings allowed), 1 when one has, 2 on usage errors or
 * a file that cannot be read (with --campaign: a level or story file that cannot be read or parsed
 * is reported and the rest is still checked, then the exit code is 2).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevel, validateLevel } from '../src/engine/level/LevelFormat.js';
import { parseArgs } from './lib/levelgen.mjs';
import { gridFromLevel, placerFromLevel, checkLevel } from './lib/levelcheck.mjs';
import { checkCampaign } from './lib/campaigncheck.mjs';
import { normalizeCampaign, levelFile } from '../src/game/campaign/CampaignFormat.js';
import { storyFile } from '../src/game/campaign/StoryFormat.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const args = parseArgs(argv.filter((a) => a.startsWith('--')));
const names = argv.filter((a) => !a.startsWith('--'));
const usage = [
  'usage: node tools/check-level.mjs <level name or .json path> [...] [--strict] [--routes=<file.json>] [--quiet]',
  '       node tools/check-level.mjs --campaign=<name or folder> [--strict] [--quiet]',
].join('\n');
if (args.campaign) process.exit(runCampaign(String(args.campaign)));
if (!names.length || args.help) {
  console.error(usage);
  process.exit(2);
}
if (args.routes === true || (args.routes && names.length > 1)) {
  console.error(args.routes === true ? '--routes needs a file: --routes=<file.json>' : '--routes applies to one level per run');
  process.exit(2);
}

/** A level name (public/levels/<name>.json) or a path to a .json file. */
function resolveLevel(name) {
  if (/[\\/]/.test(name) || name.endsWith('.json')) return path.resolve(process.cwd(), name);
  return path.join(root, 'public', 'levels', `${name}.json`);
}

/**
 * Is a level file one of a campaign's (`<campaign>/levels/<id>.json` beside a `campaign.json`)? Its
 * objects' story conditions then always apply (a single level's only when it has a story).
 * @param {string} file
 */
function inCampaign(file) {
  const dir = path.dirname(file);
  return path.basename(dir) === 'levels' && fs.existsSync(path.join(path.dirname(dir), 'campaign.json'));
}

/** @returns {[name: string, from: [number, number], to: [number, number]][]} */
function readRoutes(file) {
  const list = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
  const point = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
  if (!Array.isArray(list) || !list.every((r) => Array.isArray(r) && typeof r[0] === 'string' && point(r[1]) && point(r[2]))) {
    throw new Error('routes must be a JSON array of ["name", [x0, z0], [x1, z1]]');
  }
  return list;
}

let failed = 0;
for (const name of names) {
  const file = resolveLevel(name);
  let level; let formatWarnings; let routes = [];
  try {
    ({ level, warnings: formatWarnings } = parseLevel(fs.readFileSync(file, 'utf8')));
    if (args.routes) routes = readRoutes(String(args.routes));
  } catch (e) {
    console.error(`${path.relative(process.cwd(), file)}: ${e.message}`);
    process.exit(2);
  }
  const t0 = performance.now();
  const errors = validateLevel(level);
  const report = errors.length
    ? { errors: [], warnings: [], info: ['the deeper checks need a structurally valid level'] }
    : (() => { const g = gridFromLevel(level); return checkLevel(level, { g, P: placerFromLevel(g, level) }, { strict: !!args.strict, routes, storyStates: inCampaign(file) || undefined }); })();
  const ms = Math.round(performance.now() - t0);
  const all = { errors: [...errors.map((m) => `validateLevel: ${m}`), ...report.errors], warnings: [...formatWarnings.map((m) => `format: ${m}`), ...report.warnings] };
  console.log(`${level.name} (${path.relative(process.cwd(), file)}): ${level.width} × ${level.depth}, ${level.objects.length} objects${args.strict ? ' · strict' : ''} · ${ms} ms`);
  if (!args.quiet) for (const m of report.info) console.log(`  · ${m}`);
  for (const m of all.warnings) console.log(`  ! ${m}`);
  for (const m of all.errors) console.log(`  ✗ ${m}`);
  console.log(`  ${all.errors.length} error(s), ${all.warnings.length} warning(s)`);
  if (all.errors.length) failed++;
}
process.exit(failed ? 1 : 0);

/**
 * `--campaign`: check every level file of a campaign and the links between them. Returns the exit
 * code.
 * @param {string} name a campaign name (public/campaigns/<name>) or a folder / campaign.json path
 */
function runCampaign(name) {
  if (name === 'true') { console.error('--campaign needs a name: --campaign=<name>'); return 2; }
  let folder = /[\\/]/.test(name) || name.endsWith('.json') ? path.resolve(process.cwd(), name) : path.join(root, 'public', 'campaigns', name);
  if (folder.endsWith('.json')) folder = path.dirname(folder);
  const file = path.join(folder, 'campaign.json');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`${path.relative(process.cwd(), file)}: ${e.message}`); return 2; }
  const { campaign, warnings, errors } = normalizeCampaign(raw);
  const t0 = performance.now();
  const readLevel = (id) => {
    const f = path.join(folder, levelFile(id));
    if (!fs.existsSync(f)) return null;
    return parseLevel(fs.readFileSync(f, 'utf8'));
  };
  const readStory = (name) => {
    const f = path.join(folder, storyFile(name));
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  };
  const report = errors.length ? null : checkCampaign(campaign, readLevel, { strict: !!args.strict, readStory });
  let failed = errors.length > 0;
  for (const [id, r] of report?.levels ?? []) {
    console.log(`${id} (${path.relative(process.cwd(), path.join(folder, r.file))})${r.base !== id ? ` · variant of ${r.base}` : ''}`);
    if (!args.quiet) for (const m of r.report.info) console.log(`  · ${m}`);
    for (const m of r.report.warnings) console.log(`  ! ${m}`);
    for (const m of r.report.errors) console.log(`  ✗ ${m}`);
    console.log(`  ${r.report.errors.length} error(s), ${r.report.warnings.length} warning(s)`);
    if (r.report.errors.length) failed = true;
  }
  const ms = Math.round(performance.now() - t0);
  console.log(`campaign ${campaign.name} (${path.relative(process.cwd(), file)})${args.strict ? ' · strict' : ''} · ${ms} ms`);
  if (!args.quiet) for (const m of report?.info ?? []) console.log(`  · ${m}`);
  for (const m of [...warnings.map((w) => `campaign.json: ${w}`), ...(report?.warnings ?? [])]) console.log(`  ! ${m}`);
  for (const m of [...errors.map((e) => `campaign.json: ${e}`), ...(report?.errors ?? [])]) console.log(`  ✗ ${m}`);
  const nErr = errors.length + (report?.errors.length ?? 0);
  console.log(`  ${nErr} error(s), ${warnings.length + (report?.warnings.length ?? 0)} warning(s)`);
  if (report?.unreadable.length) {
    console.log(`  cannot be read: ${report.unreadable.join(', ')}`);
    return 2;
  }
  return failed || nErr ? 1 : 0;
}
