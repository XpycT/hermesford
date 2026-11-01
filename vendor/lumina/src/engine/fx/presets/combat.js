import { registerPresets } from '../Particles.js';
import { PRESETS as HERO_FX } from './hero.js';
import { PRESETS as PARTY_FX } from './party.js';
import { PRESETS as DRAGON_FX } from './dragon.js';
import { PRESETS as BRUTE_FX } from './brutes.js';
import { PRESETS as SWARM_FX } from './swarm.js';
import { PRESETS as HOLY_FX } from './holy.js';
import { PRESETS as EARTH_FX } from './earth.js';

/**
 * The combat packages' particle presets of Vanquish the Evil Dragon (docs/contracts/DRAGON_CAMPAIGN.md
 * §4, §8): the hero's, the companions', the dragon's, the brutes' and the swarm's (./hero.js …
 * ./swarm.js). Combat-only: imported by the combat chunk (CombatSystem.load registers them before
 * its warm-up primes the bursts) and listed in vite.config.js `COMBAT_PURE`, so a peaceful level
 * downloads none of them and `PARTICLE_PRESETS` never holds their names there.
 */
export const COMBAT_PRESET_MODULES = Object.freeze([HERO_FX, PARTY_FX, DRAGON_FX, BRUTE_FX, SWARM_FX, HOLY_FX, EARTH_FX]);

/**
 * Add the combat packages' presets to `PARTICLE_PRESETS` (Particles.js `registerPresets`; again on
 * every combat level: harmless). A name defined twice — between the packages, or with the engine's
 * own — throws.
 */
export function registerCombatPresets() {
  for (const mod of COMBAT_PRESET_MODULES) registerPresets(mod);
}

/**
 * Add a lazy enemy pack's presets (src/game/combat/packs/: registered when the pack loads, at the
 * start of CombatSystem.load — before the warm-up primes the bursts; EVERMERE_CAMPAIGN.md §6.4).
 * The same rules: the same object again is harmless, a name defined twice throws.
 * @param {Readonly<Record<string, object>>} presets
 */
export function registerPackPresets(presets) {
  registerPresets(presets);
}
