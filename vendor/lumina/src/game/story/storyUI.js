/**
 * The story's UI classes (the journal, emote bubbles, the end card; the set-piece direction's title
 * card and screen flash), handed to `UI.useStoryUI` by the Game when a level or campaign has a story
 * — imported here, in the story chunk, so a level without a story loads none of them
 * (docs/architecture/modules/ui.md §11). The title card and the flash are made by the story runtime
 * itself (StoryRunner `_cineUI`, on the UI root) from `cineUIClasses()`.
 */
import { Journal } from '../../engine/ui/Journal.js';
import { Emotes } from '../../engine/ui/Emotes.js';
import { EndCard } from '../../engine/ui/EndCard.js';
import { TitleCard } from '../../engine/ui/TitleCard.js';
import { ScreenFlash } from '../../engine/ui/ScreenFlash.js';

/** @returns {{ Journal: typeof Journal, Emotes: typeof Emotes, EndCard: typeof EndCard }} */
export function storyUIClasses() {
  return { Journal, Emotes, EndCard };
}

/** The set-piece direction's UI (docs/specs/STORY_SCRIPT.md: `title`, `flash`). @returns {{ TitleCard: typeof TitleCard, ScreenFlash: typeof ScreenFlash }} */
export function cineUIClasses() {
  return { TitleCard, ScreenFlash };
}
