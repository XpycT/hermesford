/**
 * Combat bindings and legend (COMBAT.md §5.1–§5.2). Registered at runtime on combat levels only
 * (`input.addBindings(COMBAT_BINDINGS)`), so peaceful levels keep today's bindings exactly: keys
 * are only added (J K L U I O C 1–4 and the mouse buttons were unbound).
 */

/** Keyboard + mouse (the `Mouse*` codes need `input.enableMouseButtons(canvas)`). */
export const COMBAT_BINDINGS = Object.freeze({
  attack: ['KeyJ', 'Mouse0'], dodge: ['KeyK', 'Mouse2'],
  skill1: ['KeyU', 'Digit1'], skill2: ['KeyI', 'Digit2'], skill3: ['KeyO', 'Digit3'],
  draught: ['KeyC', 'Digit4'], lock: ['KeyL', 'Mouse1'],
});

/** The player's combat actions (the input buffer's keys), in priority order (§5.1). */
export const COMBAT_ACTIONS = Object.freeze(['dodge', 'skill1', 'skill2', 'skill3', 'attack', 'draught', 'lock']);

/**
 * HUD legend on combat levels (keyboard / mouse), 13 rows. `label` is the English; `id` names the
 * row (stable: tests find rows by it, and CombatSystem shows `t('combat.controls.<id>')`,
 * src/game/combat/strings.js — this file stays import-free).
 */
export const COMBAT_CONTROLS = Object.freeze([
  { keys: 'WASD', label: 'Move', id: 'move' },
  { keys: 'Shift', label: 'Run', id: 'run' },
  { keys: 'J/Mouse0', label: 'Attack (combo)', id: 'attack' },
  { keys: 'K/Mouse2', label: 'Dodge roll', id: 'dodge' },
  { keys: 'U/I/O', label: 'Skills (or 1-3)', id: 'skills' },
  { keys: 'C', label: 'Healing Draught', id: 'draught' },
  { keys: 'L/Mouse1', label: 'Lock on / next', id: 'lock' },
  { keys: 'Space', label: 'Talk / Rest / Open', id: 'interact' },
  { keys: 'F/Enter', label: 'Choose an answer', id: 'choose' },
  { keys: 'Q/E', label: 'Rotate camera', id: 'rotate' },
  { keys: 'Z/X', label: 'Zoom (or wheel)', id: 'zoom' },
  { keys: 'N/Tab', label: 'World map', id: 'map' },
  { keys: 'T/R/P/M', label: 'Time / Weather / Photo / Music', id: 'toggles' },
]);
