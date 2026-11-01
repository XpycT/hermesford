/**
 * Shared 2.5D pixel-art palette. Every ramp runs dark → light and is hue-shifted the way a
 * pixel artist would paint it (cool, saturated shadows; warm, soft highlights).
 * Using the same ramps for world textures and sprites keeps the whole scene cohesive.
 */
export const PALETTE = {
  // Nature
  grass: ['#1f3a2c', '#2e5a34', '#4a7d3a', '#77a345', '#a9c95d', '#d6e58a'],
  grassDry: ['#3b3a24', '#5d5a2e', '#857d3c', '#ad9f4f', '#cfc27a'],
  leaves: ['#14281f', '#1f4a30', '#2f6b36', '#4f8f3d', '#7eb24a', '#b8d86a'],
  leavesAutumn: ['#3a1a1c', '#6b2a22', '#a44a26', '#d0752f', '#eaa94a', '#f6d77a'],
  pine: ['#0f2226', '#17363a', '#22523f', '#347049', '#57915a'],
  dirt: ['#2a1c1c', '#46302a', '#67483a', '#8a6547', '#ad8a5f', '#cfb07f'],
  sand: ['#6b5a45', '#9a8360', '#c2a87a', '#dcc596', '#efe0b8'],
  stone: ['#1e1e2a', '#34364a', '#4f5468', '#727a8a', '#9aa3ad', '#c9cfd0'],
  stoneWarm: ['#2a2426', '#463c3c', '#665a55', '#8a7d72', '#b0a494', '#d8ccb9'],
  moss: ['#1c2f25', '#2e4a31', '#4b6b3a', '#6f8d45'],
  water: ['#0e1f3a', '#163a5c', '#1f5a7a', '#2f7f96', '#57a8b4', '#9fd6d2', '#e4f6ee'],
  bark: ['#1d1414', '#33231f', '#4d352a', '#6b4d37', '#8c6a48'],

  // Building materials
  wood: ['#24160f', '#3e2618', '#5c3a22', '#7d5230', '#9f6f40', '#c49358'],
  woodGray: ['#26221f', '#3d3632', '#58504a', '#776d64', '#9a8f84'],
  plaster: ['#6e5f55', '#968474', '#b9a790', '#d6c7ad', '#ece2cc', '#fbf6e8'],
  brick: ['#2e1414', '#4f1f1a', '#73301f', '#984a2b', '#b8693d'],
  roofRed: ['#2a0f16', '#4d1a1f', '#7a2a26', '#a5402e', '#c9643c', '#e39a5a'],
  roofBlue: ['#131a33', '#1d2a4d', '#2b4169', '#3f5f88', '#6286a6'],
  thatch: ['#3a2a15', '#5e451f', '#84662c', '#a88a3e', '#cfb25a', '#ecd690'],
  slate: ['#16161f', '#25263a', '#383b52', '#50566e', '#707a8e'],
  metal: ['#15151c', '#2c2d38', '#4b4e5c', '#7a7f8c', '#b4b9c2', '#eef0f2'],
  gold: ['#3a2410', '#6b4515', '#a5701f', '#d6a33a', '#f2d072', '#fff3c0'],

  // Cloth / accents
  red: ['#2e0c14', '#5a1420', '#8c2330', '#bf3b3b', '#e0674f', '#f5a07a'],
  blue: ['#10132e', '#1c2556', '#2a3d86', '#3d5fb4', '#6a8fd6', '#a9c7ee'],
  green: ['#0f261c', '#1a4028', '#2b6236', '#468a45', '#78b35b'],
  purple: ['#1c1029', '#34194a', '#522a6e', '#77428f', '#a569b3'],
  yellow: ['#3a2a0c', '#6e4d12', '#a8781d', '#d9a92e', '#f2d45a', '#fff0a0'],
  cream: ['#5c4d3f', '#8a7862', '#b5a386', '#d9cbaa', '#f2e8cf'],
  brown: ['#1f130e', '#3a2418', '#5a3a24', '#7d5634', '#a27749'],
  black: ['#0b0a10', '#16151f', '#23222f', '#353446'],
  white: ['#8a8f9e', '#b3b8c4', '#d6dae0', '#eef0f2', '#ffffff'],

  // Characters
  skinLight: ['#6b3b33', '#a15f4c', '#d08f6e', '#eab48f', '#f8d6b4'],
  skinTan: ['#4a2721', '#7a4331', '#a8674a', '#c98a62', '#e2ae84'],
  skinDark: ['#23130f', '#3f231a', '#5e3726', '#80503a', '#a06d50'],
  hairBrown: ['#1e110c', '#3a2014', '#5a331d', '#7e4d2b', '#a36e41'],
  hairBlonde: ['#5c3a14', '#8c5e1f', '#bf8c33', '#e4bb56', '#f7e08e'],
  hairBlack: ['#0b0a12', '#171623', '#262538', '#3b3b52'],
  hairRed: ['#2e0e0e', '#5a1a14', '#8c2c1a', '#bf4a26', '#e0753a'],
  hairWhite: ['#5c5c6b', '#8a8a99', '#b4b4c0', '#dcdce2', '#f6f6f8'],

  // Light / glow
  fire: ['#5a1208', '#a8260c', '#e0561a', '#f59a2e', '#ffd36a', '#fff6d0'],
  glowWarm: '#ffc27a',
  glowCool: '#9fd8ff',
  outline: '#140f17',
};

/** Pick color i from a ramp, clamped. */
export const rampAt = (ramp, i) => ramp[Math.max(0, Math.min(ramp.length - 1, i | 0))];
