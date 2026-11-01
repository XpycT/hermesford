/**
 * The pixel UI's party-only art (docs/specs/PIXEL_UI.md §2), ported from mockup G's art: the rule
 * pips of the tactics panel. Listed in PARTY_PURE (vite.config.js): only the party chunk imports it.
 */
import { pal } from './palette.js';
import { art } from './painter.js';

/**
 * A value's place among its options (today's position pips as A's little gems): n diamonds, the
 * i-th lit (a sapphire heart). On the focused row (`focus`) the others are brighter gilt round an
 * ink heart, so all n still read on the gold wash. (6n − 3) × 3 art px.
 * @param {number} n
 * @param {number} i
 * @param {boolean} [focus]
 */
export function pips(n, i, focus = false) {
  const k = pal();
  return art(n * 6 - 3, 3, (p) => {
    for (let j = 0; j < n; j++) {
      const cx = j * 6 + 1;
      if (j === i) { p.px(cx, 0, k.g5); p.px(cx - 1, 1, k.g4); p.px(cx + 1, 1, k.g3); p.px(cx, 2, k.g2); p.px(cx, 1, k.sa3); }
      else if (focus) { p.px(cx, 0, k.g3); p.px(cx - 1, 1, k.g3); p.px(cx + 1, 1, k.g2); p.px(cx, 2, k.g2); p.px(cx, 1, k.ink0); }
      else { p.px(cx, 0, k.dm1); p.px(cx - 1, 1, k.dm1); p.px(cx + 1, 1, k.dm2); p.px(cx, 2, k.dm2); }
    }
  });
}
