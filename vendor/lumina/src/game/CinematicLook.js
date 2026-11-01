/**
 * The cinematic look: a film look for any level or campaign, chosen when the page is launched with
 * `game.html?look=cinematic`, or by a campaign's `look: "cinematic"` (campaign.json,
 * docs/contracts/DRAGON_CAMPAIGN.md §5.1) when the URL names no look — `?look=diorama` turns it off
 * (src/main.js; no level data chooses it). It goes on top of the diorama look that
 * `Game._tunePost` sets for every page — anamorphic blue streaks from lamps and fire, oval bokeh, a
 * warm halation-like bloom, an orange & teal grade with a print's S-curve and lifted blacks, a
 * heavier, rounder vignette and film grain (soft, slightly coloured clumps). The engine side is
 * PostFX's cinematic stage (`settings.cinematic`). Design: docs/design/CINEMATIC_LOOK.md.
 *
 * Applied once, in `Game.init` right after PostFX is made — before the warm-up compiles the
 * stage's programs; the page keeps it through a campaign's travels. Weather, made later in init (by
 * the first `_buildLevel`), reads the grade's temperature and saturation from these values and
 * rewrites both every frame from its tuning; the combat look takes its baseline from them. A level
 * may tune the look's lens streaks for itself (`environment.cinematic.streaks`, `streakThreshold`): `applyLevelLook`,
 * for every level the page applies; and a level's `states` may change its `streaks` with the story
 * (`applyStateLook`, the game's `'env'` listener).
 *
 * @import { PostFX } from '../engine/render/PostFX.js'
 * @import { LevelEnvironment } from '../engine/level/types.d.ts'
 */

/** @typedef {'diorama'|'cinematic'} PostLook */

/**
 * The look a page's query asks for: `look=cinematic`, the diorama for any other value of `look`
 * (`look=diorama` too), or null when the query has no `look` (the page then takes a campaign's own
 * `look`, else the diorama: src/main.js).
 * @param {URLSearchParams} params
 * @returns {PostLook|null}
 */
export function postLookFrom(params) {
  if (!params.has('look')) return null;
  return params.get('look') === 'cinematic' ? 'cinematic' : 'diorama';
}

/**
 * What the cinematic look changes of the diorama look's settings (the diorama's value in brackets),
 * and the cinematic stage's fields. The reasons: CINEMATIC_LOOK.md §3.
 */
export const CINEMATIC_LOOK = Object.freeze({
  // a slightly stronger, narrower tilt-shift for the oval bokeh to show in (13, 0.42, 0.3, 1.6)
  dof: { maxBlur: 15, tiltShift: 0.5, tiltWidth: 0.26, bokehBoost: 2.0 },
  // a wider, warmer bloom with a lower threshold: film's halation and diffusion (0.5, 0.58, 1.05, 0.25)
  bloom: { strength: 0.6, radius: 0.7, threshold: 0.95, warmth: 0.6 },
  grade: {
    // less candy colour, more contrast before the print curve (1.03, 1.04, 1.3, 0.04)
    exposure: 1.0, contrast: 1.12, saturation: 1.02, temperature: 0.06,
    // a heavier, rounder vignette falling to a cool near-black (0.55, 0.55, 0.65, warm brown)
    vignette: 0.85, vignetteSoftness: 0.6, vignetteRoundness: 0.85, vignetteColor: [0.02, 0.025, 0.035],
    // film grain: stronger and in clumps of 1.6 px (0.03, 1 px of pixel noise)
    grain: 0.06, grainSize: 1.6,
    chromaticAberration: 0.002,
    // cooler shade, warmer light for the orange & teal split
    shadowsTint: [-0.05, 0.035, 0.11], highlightsTint: [0.07, 0.025, -0.05],
  },
  cinematic: {
    enabled: true,
    // only lamps, fires, glows and strong glints streak; × 2.2: the streak is added after ACES
    // (CINEMATIC_LOOK.md §4.2)
    streaks: 2.2, streakThreshold: 1.0, streakTint: [0.25, 0.5, 1.0], streakTintMix: 0.85,
    bokehSquash: 1.6, tealOrange: 0.3, filmCurve: 0.25,
    black: [0.025, 0.035, 0.045], white: [0.97, 0.955, 0.92], grainChroma: 0.3,
  },
});

/**
 * Write the cinematic look into PostFX's settings (on top of the diorama values already there).
 * Arrays are copied: the debug panel edits them in place.
 * @param {PostFX['settings']} S
 */
export function applyCinematicLook(S) {
  for (const group of /** @type {const} */ (['dof', 'bloom', 'grade', 'cinematic'])) {
    const dst = S[group];
    for (const [k, v] of Object.entries(CINEMATIC_LOOK[group])) dst[k] = Array.isArray(v) ? [...v] : v;
  }
}

/**
 * The level's own cinematic-look settings (`environment.cinematic`, docs/specs/LEVEL_FORMAT.md
 * §9.2) over the look's: `cinematic.streaks` is the level's `streaks` when it gives one, else the
 * look's own (`CINEMATIC_LOOK.cinematic.streaks`, 2.2) again, and `cinematic.streakThreshold`
 * likewise (the level's 1.2–3, else the look's 1.0: sunlit snow must not streak —
 * EVERMERE_CAMPAIGN.md §5.2) — so a travel from a level that lowered them (the night festival of
 * *Vanquish the Evil Dragon*: 0.27) brings them back. Called by `Game` for every level a page with
 * the cinematic look applies — in `init` after `_tunePost`, in `swapLevel` (every travel, a room
 * attached again) — before the level is built: a combat level's
 * `CombatLook` takes the value as its baseline (and puts it back when its level is left). Never on
 * the diorama look (its stage is off: nothing of it is touched).
 * @param {PostFX['settings']} S
 * @param {Partial<LevelEnvironment>|null|undefined} env the level's environment (normalised:
 *   `normalizeLevel` dropped a `streaks` outside 0–4)
 */
export function applyLevelLook(S, env) {
  const look = levelLookOf(env);
  S.cinematic.streaks = look.streaks;
  S.cinematic.streakThreshold = look.streakThreshold;
  APPLIED.set(S, look);
}

/**
 * The lens streaks an environment gives the cinematic look: its `cinematic.streaks`, else the
 * look's own 2.2; its `cinematic.streakThreshold` (1.2–3: sunlit snow must not streak —
 * EVERMERE_CAMPAIGN.md §5.2), else the look's own 1.0.
 * @param {Partial<LevelEnvironment>|null|undefined} env
 * @returns {{ streaks: number, streakThreshold: number }}
 */
function levelLookOf(env) {
  const c = env?.cinematic;
  const v = c?.streaks;
  const th = c?.streakThreshold;
  return {
    streaks: typeof v === 'number' && Number.isFinite(v) ? v : CINEMATIC_LOOK.cinematic.streaks,
    streakThreshold: typeof th === 'number' && Number.isFinite(th) ? th : CINEMATIC_LOOK.cinematic.streakThreshold,
  };
}

/** What `applyLevelLook` wrote last into a page's settings (`applyStateLook` compares with it). */
const APPLIED = new WeakMap();

/**
 * A level state's lens streaks (`environment.states[].streaks`, EVERMERE_CAMPAIGN.md §5.2, §7.4):
 * `Game`'s `'env'` listener on a page with the cinematic look. On a level with `states` the
 * effective environment's streaks and threshold (`game.envNow`: the level's `cinematic` with the
 * last holding state's `streaks` over it) go in as `applyLevelLook` puts the level's own — at an
 * arrival whose story holds such a state, and on a live change (the story set a flag) — when they
 * differ from what it wrote last; a level without `states` is never touched again (its own went in
 * before its build). A combat level's `CombatLook` takes the new streaks as its baseline at once
 * (the fight's lowering, COMBAT.md §29 V17, eases from it), also before its first frame.
 * @param {PostFX['settings']} S
 * @param {Readonly<Partial<LevelEnvironment>>|null|undefined} env the effective environment
 * @param {{ base: { streaks: number } }|null} [combatLook] the running level's combat look, if any
 * @returns {boolean} whether the settings changed
 */
export function applyStateLook(S, env, combatLook = null) {
  if (!Array.isArray(env?.states) || !env.states.length) return false;
  const look = levelLookOf(env);
  const was = APPLIED.get(S);
  if (was && was.streaks === look.streaks && was.streakThreshold === look.streakThreshold) return false;
  applyLevelLook(S, env);
  if (combatLook) combatLook.base.streaks = look.streaks;
  return true;
}
