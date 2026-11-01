/**
 * The pixel UI's palette (docs/specs/PIXEL_UI.md §1.3): mockup G's tokens, verbatim. The JS object
 * is the palette's source of truth; `applyPalette(root)` mirrors it as CSS custom properties
 * `--g-<token>` for the stylesheets (`var(--g-ink0)`, `var(--g-tx1)` …).
 */

/**
 * The tokens (CSS colours). Groups: ink and today's navy (ink0–5) · today's gold, bronze to white
 * gold (g0–g5) · the gold studs' stone (gs0–2) · dim gilt (dm1–3) · text (tx1–3, sel, kw) · A's gems
 * (sa sapphire, se Sela's amber, rb ruby, em ember) · bars (hp, mp, sp, bs boss, tr trough, xp0) ·
 * numbers over the world (hit, crit, mint, heal, nol) · markers (teal, foe, way, fire, npc, phase) ·
 * keycaps (kf0–3, kink) · bands, plates and glass · the empty socket (sock0–2) · the minimap (m-*:
 * the level's own tile colours, washes and the vignette) · the day bar (day0–7).
 */
const TOKENS = {
  // ink and today's navy
  ink0: '#07080f', ink1: '#0c1022', ink2: '#141a36', ink3: '#1a2242', ink4: '#2a3462', ink5: '#6f7aa6',
  // today's gold: bronze to white gold
  g0: '#3e2a10', g1: '#6e4f1e', g2: '#8c6a32', g3: '#c9a45c', g4: '#e8cf8a', g5: '#f4e3b3',
  // the gold studs' stone (today's ◆: a gold setting, a bronze heart)
  gs0: '#3e2a10', gs1: '#6e4f1e', gs2: '#b8904a',
  // dim gilt: idle frames and pips
  dm1: '#6a5a3c', dm2: '#4c4231', dm3: '#332d26',
  // text
  tx1: '#f3ead7', tx2: '#c6bda9', tx3: '#8f897d', sel: '#fff6e0', kw: '#f3cf7a',
  // A's gems: the court's sapphire, Sela's amber, ruby (the foe), ember (the boss's phases)
  sa1: '#23408f', sa2: '#5288e6', sa3: '#b0d6ff',
  se1: '#8e3f16', se2: '#e8873a', se3: '#ffc07a',
  rb1: '#6a1418', rb2: '#d0452f', rb3: '#ff9a7a',
  em1: '#9c2a12', em2: '#f08a3a', em3: '#ffe0a8',
  // today's bars: dark → light
  hp0: '#7a1530', hp1: '#a8233a', hp2: '#e0674f', hp3: '#f08a6a',
  mp0: '#34569c', mp1: '#4f7fd8', mp2: '#6aa6ee', mp3: '#8fd0ff',
  sp0: '#8c6a32', sp1: '#c9a45c', sp2: '#e8cf8a',
  bs0: '#6a1418', bs1: '#9c1f24', bs2: '#d0452f', bs3: '#f07a4a', bs4: '#ffc690',
  tr0: '#120a0e', tr1: '#26151c', xp0: '#2e2210',
  // numbers over the world
  hit: '#fff4dc', crit: '#ffd98a', mint: '#9fe6d2', heal: '#bfe58f', nol: '#120c08',
  // markers and accents
  teal: '#3fcfae', 'teal-rim': '#e6fff7', foe: '#e0674f', way: '#7fe3ff', fire: '#ff9a3c', npc: '#8fd0ff', phase: '#f6b25a',
  // keycaps: ivory, ink lettering
  kf0: '#fffaf0', kf1: '#fbf3dc', kf2: '#d6c08e', kf3: '#a88a50', kink: '#2a1d0c',
  // bands, plates, glass (today's: navy shading darker downward, in hard bands)
  band: '#080b1a', plate0: '#222a4e', plate1: '#0c0f20',
  glass0: 'rgba(26, 34, 66, 0.86)', glass1: 'rgba(19, 25, 50, 0.88)', glass2: 'rgba(12, 16, 34, 0.9)', glass3: 'rgba(6, 8, 18, 0.93)',
  'glass-hi': 'rgba(96, 118, 184, 0.55)', 'glass-lat': 'rgba(96, 118, 184, 0.16)', 'glass-x': 'rgba(140, 158, 214, 0.34)',
  wash: 'rgba(201, 164, 92, 0.22)', shade: 'rgba(4, 6, 16, 0.74)',
  dim: '#04050c', veil: 'rgba(7, 8, 15, 0.8)',
  'slot-glass': 'rgba(12, 16, 34, 0.6)', 'card-glass': 'rgba(40, 50, 96, 0.28)',
  'card-sel0': 'rgba(201, 164, 92, 0.2)', 'card-sel1': 'rgba(201, 164, 92, 0.12)', 'card-sel2': 'rgba(201, 164, 92, 0.06)',
  // an empty socket (the boss's phase not reached)
  sock0: '#1c180f', sock1: '#2c2618', sock2: '#3a3220',
  // the minimap: the level's own tile colours (src/engine/level/LevelFormat.js)
  'm-g': '#5f9a3e', 'm-G': '#3f7434', 'm-f': '#8fb14e', 'm-F': '#7a5433', 'm-s': '#d6c08b', 'm-p': '#b18a5c',
  'm-c': '#8d8a8e', 'm-k': '#a6a39b', 'm-m': '#6e7d5c', 'm-r': '#5d5a60', 'm-t': '#2b4f2a', 'm-b': '#9c6b3f', 'm-w': '#3b7fa6',
  'm-void': '#101018', 'm-cliff': '#3e3228', 'm-light': '#9fc46a',
  'm-mute': 'rgba(6, 8, 18, 0.15)', 'm-wedge': 'rgba(255, 240, 200, 0.42)',
  'm-vig0': 'rgba(6, 8, 18, 0.55)', 'm-vig1': 'rgba(6, 8, 18, 0.38)', 'm-vig2': 'rgba(6, 8, 18, 0.3)', 'm-ol': 'rgba(20, 14, 6, 0.92)',
  // the day bar: the sky across the day
  day0: '#25306a', day1: '#2b3778', day2: '#c98aa0', day3: '#f3c989', day4: '#f5e4b0', day5: '#f2b45a', day6: '#d07a55', day7: '#6e4f8c',
};

/** @typedef {keyof typeof TOKENS} PaletteToken */
/** The tokens, frozen. @type {Readonly<Record<PaletteToken, string>>} */
export const PALETTE = Object.freeze(TOKENS);

/** The palette (G's `pal()`: the same object every call; no computed-style read). */
export const pal = () => PALETTE;

/** The CSS custom property of a token: `--g-<token>`. @param {PaletteToken} token */
export const cssVar = (token) => `--g-${token}`;

/** `var(--g-<token>)`, for inline styles. @param {PaletteToken} token */
export const cssColor = (token) => `var(--g-${token})`;

/**
 * Write the palette onto `root` as CSS custom properties (`--g-ink0` …), for the stylesheets and
 * inline styles that name a token. The UI root does it once (UI.js).
 * @param {HTMLElement} root
 */
export function applyPalette(root) {
  for (const [k, v] of Object.entries(PALETTE)) root.style.setProperty(`--g-${k}`, v);
}

/**
 * Gem ramps [dark, mid, light]: the gold studs (today's ◆), the court's sapphire, Sela's amber,
 * ruby, ember, dusk (an empty slot), the waystone's. Functions, as in G (each call a fresh array).
 */
export const GEMS = Object.freeze({
  gold: () => [PALETTE.gs0, PALETTE.gs1, PALETTE.gs2],
  sapphire: () => [PALETTE.sa1, PALETTE.sa2, PALETTE.sa3],
  amber: () => [PALETTE.se1, PALETTE.se2, PALETTE.se3],
  ruby: () => [PALETTE.rb1, PALETTE.rb2, PALETTE.rb3],
  ember: () => [PALETTE.em1, PALETTE.em2, PALETTE.em3],
  dusk: () => [PALETTE.ink2, PALETTE.ink3, PALETTE.ink4],
  way: () => [PALETTE.sa1, PALETTE.way, PALETTE['teal-rim']],
});

/**
 * A gem ramp [dark, mid, light] from one colour (a villager's `portraitColor`): the colour as the
 * mid tone, darkened and lightened round it. Anything that is not a #rgb / #rrggbb hex gives the
 * amber ramp (level data is untrusted).
 * @param {string} hex
 * @returns {string[]}
 */
export function gemRamp(hex) {
  const s = typeof hex === 'string' ? hex.trim().replace(/^#/, '') : '';
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return GEMS.amber();
  const n = parseInt(s.length === 3 ? s.replace(/./g, (c) => c + c) : s, 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const mix = (t, to) => `#${rgb.map((v) => Math.round(v + (to - v) * t).toString(16).padStart(2, '0')).join('')}`;
  return [mix(0.55, 0), mix(0, 0), mix(0.55, 255)];
}
