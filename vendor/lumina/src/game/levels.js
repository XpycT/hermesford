/**
 * The levels shipped in `public/levels/` that the title screen offers as destinations
 * (COMBAT.md §13.4): `{ value: slug, label }`, in the order the ◂ ▸ row cycles through them.
 * A level loaded from `levels/<slug>.json` with a slug in this list shows the row; browser-storage
 * levels (`?level=local:…`, play-tests) never do. The labels are the levels' English names — terms
 * of the `common` table: the title shows them translated (`Game.showTitle`: `term(label)`,
 * docs/specs/I18N.md §4.1, §4.8).
 */
export const SHIPPED_LEVELS = Object.freeze([
  Object.freeze({ value: 'emberfall', label: 'Emberfall' }),
  Object.freeze({ value: 'cinderwatch-pass', label: 'Cinderwatch Pass' }),
  Object.freeze({ value: 'starfall-vale', label: 'Starfall Vale' }),
  Object.freeze({ value: 'gildhaven', label: 'Gildhaven' }),
  Object.freeze({ value: 'brightwater-crossing', label: 'Brightwater Crossing' }),
  Object.freeze({ value: 'sample-hamlet', label: 'Willowmere' }),
]);
