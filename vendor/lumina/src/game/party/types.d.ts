// Party contract types (docs/specs/PARTY.md). Types only: nothing here reaches a bundle. The
// runtime pieces: Party / PartyMember (src/game/party/, the follow, joins, travel, saves),
// MemberCombat (src/game/party/MemberCombat.js, a member's fight, created by CombatSystem.addAlly),
// the party UI (src/engine/ui/PartyPanel.js, PartyFrames.js, registered by UI.usePartyUI), the
// story's `party` commands and `party:<who>` conditions (StoryScript / StoryRunner / StoryState).

import type { PartyRule } from '../../engine/level/PartyRules.js';

export type { PartyRule };

// -------------------------------------------------------------------------------------------------
// The heroes of Vanquish the Evil Dragon (PARTY.md §12; docs/contracts/DRAGON_CAMPAIGN.md §6.8)
// -------------------------------------------------------------------------------------------------

/**
 * A hero's move (`MemberCombat.move`): its kit's ids. The cleric: `holyBolt`, `judgement`,
 * `sanctuary`, `mend`, `revive`; the ice mage: `frostLance`, `blizzard`, `glacialTomb`; the
 * greatshield: `bash`, `mace` (its combo), `bulwark`, `earthshatter`.
 */
export type HeroMove = 'holyBolt' | 'judgement' | 'sanctuary' | 'mend' | 'revive' | 'frostLance' | 'blizzard'
  | 'glacialTomb' | 'bash' | 'mace' | 'bulwark' | 'earthshatter';

/** `MemberCombat.info().hero` (heroes only): the second skill, the raise, what it cast. */
export interface HeroState {
  /** The running move (null between moves). */
  move: HeroMove | null;
  /** Cooldowns (s): the second skill, the raise (the cleric), the pause between two skills. */
  skill2: number;
  revive: number;
  gap: number;
  /** Moves cast so far, by id. */
  casts: Record<string, number>;
  /** Missiles in flight, spells on the ground, effect quads live. */
  missiles: number;
  fields: number;
  quads: number;
  /** The fallen member it goes to raise (id), or null. */
  reviving: string | null;
  /**
   * The ice mage's look (src/game/party/IceSpellFx.js `info()`; only where an ice mage can fight):
   * its effects, the staff's glow, lances, fields, crystals, frost patches, shells, the gust, lights.
   */
  ice?: IceLookState;
  /** The cleric's look (src/game/party/HolySpellFx.js `info()`; only where a cleric can fight). */
  holy?: object;
  /** The greatshield's look (src/game/party/EarthSpellFx.js `info()`; only where a greatshield can fight). */
  earth?: object;
}

/** The ice mage's look as the tests read it (`HeroState.ice`; IceSpellFx.js `info()`). */
export interface IceLookState {
  /** Effect quads live; the staff crystal's glow; the star at the staff; lances in flight. */
  effects: number;
  glow: number;
  star: boolean;
  lances: number;
  /** Its spells on the ground as they look (kinds). */
  fields: string[];
  flakes: number;
  drifts: number;
  shards: number;
  /** Ice shells on the foes its Tombs froze; 3D crystals standing; frost patches; the storm's gust. */
  shells: number;
  crystals: number;
  frost: number;
  gust: number;
  /** Combat VFX lights acquired so far (World.acquireSpellLight), refused (none free), held now. */
  lights: { acquired: number; refused: number; held: number };
}

/**
 * One member as the party remembers it — what a save holds (`StoryState.party`) and what rebuilds
 * the member on any level. Plain JSON: no functions, no references.
 */
export interface PartyRecord {
  /** The villager's id (its level object's `id`): the key everywhere. */
  id: string;
  /** Display name (the villager's `name`). */
  name: string;
  /** The villager's story actor ('' = none): its talk script and visits follow the member. */
  actor: string;
  /** A CHARACTER_PRESETS name (the villager's `preset`). */
  preset: string;
  /** The villager's sprite overrides (`spec`), or null. */
  spec: Record<string, unknown> | null;
  /** Name-plate colour (the villager's `portraitColor`). */
  color: string;
  /** A PARTY_CLASSES name. */
  cls: string;
  /** The combat rule it fights by. */
  rule: PartyRule;
  /** The base level id it joined in ('' on a single level without a campaign). */
  level: string;
}

/**
 * What the party reads of a member's fight (`member.combat`, a MemberCombat; null on a level
 * without combat). Created by `CombatSystem.addAlly(member)`.
 */
export interface AllyCombatView {
  /**
   * The combat drives the member now: the follow waits. A fight on (`CombatSystem.fightOn()` — not
   * the combat's linger after its last foe, in which only a Mend due keeps it), a foe after it, down,
   * an action running, the player fallen, a closed boss arena (PARTY.md §5.1, §11 PC1, PC27).
   */
  active: boolean;
  /** Down (HP 0): it gets up `ALLY.calm` s after the fight (`fightOn()` off). */
  down: boolean;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  /** Its level (MemberCombat: the player's): the party frame's `Lv`. Optional (additive). */
  level?: number;
  /** Full HP / MP, up again, action cleared (a rest, a respawn, the story's `heal`). */
  refill(): void;
  /** The member was put somewhere else at once (a teleport, a travel's arrival, a respawn). */
  onTeleport(): void;
}

/**
 * One line of the party HUD (`PartyFrames.update`). Its texts come translated (Party.frames: the
 * name as a term — `term(name)`; the default 'Villager' as `game.default.villager` —, the class
 * and the tactic in the page's language).
 */
export interface PartyFrameEntry {
  id: string;
  name: string;
  color: string;
  /** The class label ('Warden'). */
  cls: string;
  /** The rule's label ('Balanced', 'Custom'). */
  tactic: string;
  /** Combat level: the member's level (`Lv 5`; absent: no level shown). */
  level?: number;
  /** Combat level: HP / MP (absent on a level without combat: the frame shows name and tactic only). */
  hp?: number;
  hpMax?: number;
  mp?: number;
  mpMax?: number;
  /** Down (HP 0). */
  down?: boolean;
  /** Fighting now (`combat.active`). */
  fighting?: boolean;
}

/** The party HUD: one small frame per member under the player's vitals / location plate. */
export interface PartyFramesLike {
  /** Show these members (in order; [] hides the frames). Cheap to call every frame. */
  update(list: PartyFrameEntry[]): void;
  /** Hide (photo mode, cutscenes, the title) / show again. */
  setVisible(on: boolean): void;
  dispose(): void;
}

/**
 * A member as the tactics panel shows it. Its texts come translated (Party.openMenu: the name as a
 * term — `term(name)`; the default 'Villager' as `game.default.villager` —, the class, its help,
 * role and weapon in the page's language).
 */
export interface PartyPanelMember {
  id: string;
  name: string;
  color: string;
  /** The class label and its help line. */
  cls: string;
  clsHelp: string;
  rule: PartyRule;
  /** The class's id (PARTY_CLASSES: 'warden' …): its icon. Optional (additive). */
  clsId?: string;
  /** The class's role and weapon, as words ('Melee', 'Spear'): `role · weapon` under the class. */
  role?: string;
  weapon?: string;
  /**
   * The member's character-sheet canvas (`createCharacterSheet(...).canvas`, its sprite's sheet):
   * the panel crops frame (0, 0) for the portrait (×2) and the slot's sprite. Absent: a gem.
   */
  portrait?: HTMLCanvasElement | null;
}

/** `PartyPanel.open` options: everything it shows comes in as data. */
export interface PartyPanelOpts {
  members: PartyPanelMember[];
  /** The member shown first (id); absent: the first. */
  focus?: string;
  /** PartyRules.PARTY_PRESETS (names, labels, help, rules). */
  presets: Readonly<Record<string, { label: string; help: string; rule: Readonly<PartyRule> }>>;
  /** PartyRules.RULE_FIELDS. */
  fields: Readonly<Record<string, { label: string; help: string; values: readonly string[]; labels: Readonly<Record<string, string>>; hints: Readonly<Record<string, string>> }>>;
  /** The key that closes it besides Esc (shown in its footer): 'G'. */
  closeKey?: string;
}

/**
 * The tactics panel: a modal over the game (the game pauses play while it is open, like the
 * journal). Input as the Journal's: it binds no key — `update(dt, input)` (called by `UI.update`
 * while open) reads the game's actions through `input.consumeAction?.(name) ?? actionPressed(name)`
 * (`up` / `down` / `left` / `right` move, `confirm` picks, `camLeft` / `camRight` switch member,
 * `cancel` closes), and the game opens / closes it with its own `party` action (G). Mouse: DOM
 * clicks (a click outside closes, reported by the next `update`). Each change calls `onRule` at
 * once (the game applies it); closing calls `onClose`.
 */
export interface PartyPanelLike {
  readonly isOpen: boolean;
  open(opts: PartyPanelOpts): void;
  close(): void;
  /** Read the panel's actions (once per frame while open); true when it closed itself this update. */
  update(dt: number, input?: { actionPressed(name: string): boolean; consumeAction?(name: string): boolean }): boolean;
  /** Replace a member's rule shown (the story changed it while the panel is open). */
  setRule(id: string, rule: PartyRule): void;
  /** A member's rule changed by the player: the game applies it. */
  onRule: ((id: string, rule: PartyRule) => void) | null;
  /** The panel closed (any way). */
  onClose: (() => void) | null;
  /** UI sounds ('menuMove', 'menuSelect', 'menuOpen', 'menuClose' — the game maps them to SFX). */
  onSound: ((name: string) => void) | null;
  dispose(): void;
}

/** `UI.usePartyUI(classes)`: the party UI classes (src/game/party/partyUI.js). */
export interface PartyUIClasses {
  PartyPanel: new (root: HTMLElement) => PartyPanelLike;
  PartyFrames: new (root: HTMLElement) => PartyFramesLike;
}

/** `state().party` (only once a party exists). */
export interface PartyInfo {
  members: {
    id: string;
    name: string;
    cls: string;
    preset: string;
    rule: PartyRule;
    x: number;
    y: number;
    z: number;
    /** 'follow' | 'combat' | 'script' (a story directs it) | 'talk'. */
    mode: string;
    /** Distance to the player (u). */
    dist: number;
    hp?: number;
    hpMax?: number;
    down?: boolean;
  }[];
  menuOpen: boolean;
}

/** `window.__game.party` (docs/specs/AUTOMATION_API.md): every level; the party is made on demand. */
export interface PartyHooks {
  /** A villager of this level joins (id, actor or name); resolves to `info()` or null (refused). */
  join(who: string, opts?: { cls?: string; preset?: string }): Promise<PartyInfo | null>;
  /** A member leaves (id, actor or name) → false when not a member. */
  leave(who: string): boolean;
  /** Set a member's rule: a preset name or a (partial) rule → the rule, or null. */
  rule(who: string, rule: string | Partial<PartyRule>): PartyRule | null;
  /** Set one field → the rule, or null. */
  set(who: string, field: string, value: string): PartyRule | null;
  /** Open (focus `who`) / close the tactics panel → open. */
  menu(open?: boolean, who?: string): boolean;
  /** `state().party`, or null without a party. */
  info(): PartyInfo | null;
}
