/**
 * The party's UI classes (the tactics panel, the HUD frames), handed to `UI.usePartyUI` by
 * `Game.ensureParty` — imported here, in the party chunk, so a game nobody joins loads none of
 * them nor their CSS, art or strings (docs/specs/PARTY.md §6; `PARTY_PURE` in vite.config.js).
 * Asking for them registers the 'party' strings (src/game/party/strings.js), which the panel and
 * the frames read: wherever the party UI is made, it has its words.
 */
import { PartyPanel } from '../../engine/ui/PartyPanel.js';
import { PartyFrames } from '../../engine/ui/PartyFrames.js';
import { registerPartyStrings } from './strings.js';
import '../../engine/ui/party.css';

/** @returns {import('./types.js').PartyUIClasses} */
export function partyUIClasses() {
  registerPartyStrings();
  return { PartyPanel, PartyFrames };
}
