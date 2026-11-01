#!/bin/sh
# Re-snapshot the Lumina world layer into vendor/lumina and apply our patches.
#   tools/vendor-lumina.sh [path-to-lumina]   (default ~/Projects/lumina)
# Patches: the game files that import the engine barrel (engine/index.js) import the modules
# directly, so the bundle does not pull in Lumina's DOM UI, CSS and fonts.
set -eu
SRC=${1:-$HOME/Projects/lumina}
DST=$(cd "$(dirname "$0")/.." && pwd)/vendor/lumina
rm -rf "$DST/src" "$DST/tools"
mkdir -p "$DST/src" "$DST/tools" "$DST/public/levels"
rsync -a "$SRC/src/engine" "$SRC/src/game" "$DST/src/"
rsync -a "$SRC/tools/lib" "$SRC/tools/check-level.mjs" "$DST/tools/"
cp "$SRC/LICENSE" "$DST/"
cp "$SRC/public/levels/sample-hamlet.json" "$DST/public/levels/"
(cd "$SRC" && git rev-parse --short HEAD) > "$DST/VERSION"
printf '{ "name": "lumina-vendor", "private": true, "type": "module", "sideEffects": ["*.css"] }\n' > "$DST/package.json"

G="$DST/src/game"
sed -i '' "s#^import { clamp, smoothstep } from '../engine/index.js';#import { clamp, smoothstep } from '../engine/utils/math.js';#" "$G/AudioDirector.js"
sed -i '' "s#^import { clamp, smoothstep, damp } from '../engine/index.js';#import { clamp, smoothstep, damp } from '../engine/utils/math.js';#" "$G/Weather.js"
sed -i '' "s#^import { Sprite3D, createCharacterSheet, CHARACTER_PRESETS, RNG, damp, hashString } from '../engine/index.js';#import { Sprite3D } from '../engine/sprite/Sprite3D.js';\nimport { createCharacterSheet, CHARACTER_PRESETS } from '../engine/pixel/CharacterSprites.js';\nimport { RNG, damp, hashString } from '../engine/utils/math.js';#" "$G/Npc.js"
sed -i '' "s#^import { Sprite3D, createCreatureSheet, RNG, damp, hashString } from '../engine/index.js';#import { Sprite3D } from '../engine/sprite/Sprite3D.js';\nimport { createCreatureSheet } from '../engine/pixel/CharacterSprites.js';\nimport { RNG, damp, hashString } from '../engine/utils/math.js';#" "$G/Critters.js"
if grep -l "engine/index.js'" "$G/AudioDirector.js" "$G/Weather.js" "$G/Npc.js" "$G/Critters.js"; then
  echo "patch failed: the files above still import the engine barrel" >&2; exit 1
fi
echo "vendored lumina $(cat "$DST/VERSION") → $DST"
