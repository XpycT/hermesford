import * as THREE from 'three';
import { Sprite3D, createCharacterSheet, CHARACTER_PRESETS, damp, clamp } from '../engine/index.js';
import { loadCharacterKit, usesCharacterKit, levelUsesCharacterKit } from '../engine/pixel/CharacterSprites.js';
import { festivalKit } from './siege/festival.js';
import { CHARACTER_SPRITE_OPTS, IDLE_SPEED } from './config.js';

/**
 * @import { AudioSystem } from '../engine/audio/AudioSystem.js'
 * @import { CameraRig } from '../engine/core/CameraRig.js'
 * @import { Particles } from '../engine/fx/Particles.js'
 * @import { TileMap } from '../engine/world/TileMap.js'
 * @import { Input } from '../engine/core/Input.js'
 * @import { CampaignPlayer } from './campaign/CampaignFormat.js'
 */

const WALK_SPEED = 3.2;
const RUN_SPEED = 5.6;
const RADIUS = 0.3;
/** The x-ray silhouettes' opacity (the player's own fades from it: `fadeSilhouette`). */
const SILHOUETTE_OPACITY = 0.55;

const DIR_VECTORS = {
  down: new THREE.Vector3(0, 0, 1),
  up: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
};

/**
 * The traveler: camera-relative movement (CameraRig.getMoveBasis), walk / run, 4-direction facing
 * from the screen-space movement direction, TileMap collisions + smooth height following (stairs,
 * bridge decks), footstep sfx on the contact frames and dust bursts while running.
 *
 * On combat levels (`combat: true`, COMBAT.md §9.7) the traveler carries a sword and the combat
 * sheet (18 columns) on the hit-flash sprite program, and the combat core drives it: while
 * `action` is set the combat core owns the sprite (poses through `setFrame`) and `update` only
 * follows the ground; `faceOverride` turns the sprite toward a lock-on target while walking
 * (strafing); `moveOverride` (tests) replaces the input's move vector with a world-space one;
 * `speedMul` scales walk / run; `moveBy` is every combat displacement (lunges, rolls, knockback,
 * separation). On peaceful levels none of this is used and the player is exactly today's.
 */

/**
 * The x-ray silhouette material: a flat, pale copy of a sprite quad that only draws where the
 * sprite is hidden behind something (depthFunc GREATER), so houses and canopies never lose it.
 * The texel colour is dropped (dark clothing would vanish against dark occluders) and the cut-out
 * uses the texel alpha only — three's alphaTest compares `opacity × alpha`, which would discard
 * every fragment whenever opacity < alphaTest. One program for every such material.
 * It writes its own (sprite-side) depth: the depth-of-field reads the scene depth, and with the
 * occluder's depth left in place the figure was blurred along with the roof / canopy in front of
 * it into a shapeless pale blob. Drawn last (renderOrder 60, after water, god rays and particles),
 * so the written depth only feeds the DOF.
 * @param {THREE.Texture} map the sprite's own texture (its frame offset)
 * @returns {THREE.MeshBasicMaterial}
 */
function silhouetteMaterial(map) {
  const m = new THREE.MeshBasicMaterial({
    map,
    color: new THREE.Color('#d9ccff'),
    transparent: true,
    opacity: SILHOUETTE_OPACITY,
    depthWrite: true,
    depthFunc: THREE.GreaterDepth,
    fog: false,
  });
  // Pull every vertex 1.3 u toward the camera along its own view ray: the screen footprint is
  // unchanged, but only occluders clearly in front (walls, roofs, canopies — not the grass
  // tufts at the feet) reveal the silhouette.
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n\tmvPosition.xyz *= max( 0.0, 1.0 - 1.3 / length( mvPosition.xyz ) );\n\tgl_Position = projectionMatrix * mvPosition;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      // pale tint, shaded a little by the texel's luminance so hair / face / clothes still read
      '#include <map_fragment>\n\tif ( sampledDiffuseColor.a < 0.5 ) discard;\n\tfloat silL = sqrt( dot( sampledDiffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) ) );\n\tdiffuseColor = vec4( diffuse * ( 0.42 + 0.8 * silL ), opacity );',
    );
  };
  m.customProgramCacheKey = () => 'emberfall-player-silhouette-v2';
  return m;
}

/**
 * A silhouette mesh on a sprite's quad (added as a child of the sprite's mesh).
 * @param {THREE.BufferGeometry} geometry @param {THREE.Material} material @param {string} name
 * @returns {THREE.Mesh}
 */
function silhouetteMesh(geometry, material, name) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.renderOrder = 60;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * The player's look (`Player`'s `look` option): a campaign's `player.preset` and `player.spec`
 * (CampaignFormat.js `CampaignPlayer`), each optional.
 * @typedef {{ preset?: string, spec?: Record<string, any> }} PlayerLook
 */

/**
 * The player's sheet spec: the look's preset (a `CHARACTER_PRESETS` name; else the traveler) with
 * its spec overrides merged over it (as a villager's `spec`), and on combat levels the kit's weapon —
 * the sword, as the traveler and the swordmaster always had, the bellwarden's hammer
 * (EVERMERE_CAMPAIGN.md §6.5) — a spec's `weapon` does not replace it there: the combat poses are
 * the kit's. Without a look: exactly the traveler's spec of before.
 * @param {PlayerLook|null} look
 * @param {boolean} combat
 * @param {CampaignPlayer['kit']} [kit] the player's combat kit (absent: the traveler's)
 * @returns {Record<string, any>}
 */
export function playerSpec(look, combat, kit = 'traveler') {
  const preset = typeof look?.preset === 'string' && Object.hasOwn(CHARACTER_PRESETS, look.preset) ? look.preset : 'traveler';
  const spec = look?.spec && typeof look.spec === 'object' ? look.spec : {};
  return { ...CHARACTER_PRESETS[preset], preset, ...spec, ...(combat ? { weapon: kit === 'bellwarden' ? 'hammer' : 'sword' } : {}) };
}

/**
 * The Bells of Evermere's sprite parts (CharacterSprites `loadCharacterKit`: the hammer, the crown,
 * the greathelm, a hood's fur rim, a shield's crests — a chunk of their own) for a level about to be
 * built, where its villagers, the player's look on it or the party's members use them; null where
 * nothing does (nothing is fetched). `Game._buildLevel` awaits it before it makes the characters.
 * @param {{ level: { objects?: unknown }, look: PlayerLook|null, combat: boolean, kit?: CampaignPlayer['kit'], records?: readonly { spec?: unknown }[]|null }} o
 * @returns {Promise<unknown>|null}
 */
export function characterKitFor({ level, look, combat, kit, records }) {
  const used = levelUsesCharacterKit(level) || usesCharacterKit(playerSpec(look, combat, kit))
    || (records ?? []).some((r) => usesCharacterKit(r?.spec));
  return used ? loadCharacterKit() : null;
}

export class Player {
  /**
   * @param {{ tileMap: TileMap, rig: CameraRig, particles: Particles, audio: AudioSystem,
   *           spawn: {x:number, z:number, facing?:string}, combat?: boolean, look?: PlayerLook|null,
   *           festival?: boolean, kit?: CampaignPlayer['kit'] }} ctx
   *   look: the player's look (a campaign's `player`, docs/contracts/DRAGON_CAMPAIGN.md §5.1); null
   *   or absent: the traveler, as before; kit: the player's combat kit (a campaign's `player.kit`),
   *   which picks the weapon on combat levels (`playerSpec`)
   */
  constructor({ tileMap, rig, particles, audio, spawn, combat = false, look = null, festival = false, kit = 'traveler' }) {
    this.tileMap = tileMap;
    this.rig = rig;
    this.particles = particles;
    this.audio = audio;
    // (a peaceful level whose story poses the player: the festival sheet — the plain one's pixels and
    // the pose columns, FestivalPoses.js; combat levels keep the combat sheet's poses)
    this.sheet = combat ? createCharacterSheet(playerSpec(look, combat, kit), { combat: true })
      : festival ? festivalKit('the player posed by the story').createFestivalSheet(playerSpec(look, false)) : createCharacterSheet(playerSpec(look, false));
    // (a facing read from level data or a save: an unknown one faces down)
    const facing = typeof spawn.facing === 'string' && Object.hasOwn(DIR_VECTORS, spawn.facing) ? spawn.facing : 'down';
    this.sprite = new Sprite3D(this.sheet, combat
      ? { ...CHARACTER_SPRITE_OPTS, direction: facing, combatFx: true }
      : { ...CHARACTER_SPRITE_OPTS, direction: facing });
    this.sprite.name = 'Player';
    this.position = this.sprite.position;
    this.position.set(spawn.x, tileMap.getHeight(spawn.x, spawn.z), spawn.z);
    /** World-space facing (unit XZ) — used to pick the interactable "in front". */
    this.facing = DIR_VECTORS[facing].clone();
    this.speed = 0;
    this.running = false;
    /** When true, input is ignored (dialogs, fades, title). */
    this.frozen = false;
    this.radius = RADIUS;
    /** Combat action name while the combat core owns the sprite (null: locomotion). */
    this.action = null;
    /** {x, z} unit: the sprite faces it while walking / standing (lock-on strafe). */
    this.faceOverride = null;
    /** {x, z} world-space move vector replacing the input's (automation). */
    this.moveOverride = null;
    /**
     * A story script's walk (StoryRunner): a unit world direction and whether to run — the player
     * walks it even while frozen; null otherwise.
     * @type {{ x: number, z: number, run: boolean }|null}
     */
    this.scripted = null;
    /** Walk / run speed multiplier (1 on peaceful levels). */
    this.speedMul = 1;
    this._move = { x: 0, z: 0 };
    this._dir = new THREE.Vector3();
    this._stepToggle = false;
    this._dustTimer = 0;
    this._basisDir = new THREE.Vector3();

    this.sprite.onFrameChange = (frame, anim) => {
      if (!anim) return;
      const running = anim.startsWith('run');
      if (!running && !anim.startsWith('walk')) return;
      if (frame !== 0 && frame !== 2) return; // contact frames
      this._stepToggle = !this._stepToggle;
      const ground = this._groundKind();
      const pitch = ground === 'wood' ? 1.25 : ground === 'stone' ? 1.1 : ground === 'sand' ? 0.85 : 1;
      this.audio?.playSfx('step', { volume: running ? 0.55 : 0.4, pitch: pitch * (this._stepToggle ? 1 : 0.94) });
      if (running) this.particles.burst('footstep', this.position, 4);
    };
    this.sprite.play('idle');

    // X-ray silhouette: a flat, pale copy of the sprite quad that only draws where the player is
    // hidden behind something (depthFunc GREATER), so houses and canopies never lose the player.
    // The texel colour is dropped (dark clothing would vanish against dark occluders) and the
    // cut-out uses the texel alpha only — three's alphaTest compares `opacity × alpha`, which would
    // discard every fragment whenever opacity < alphaTest.
    // It writes its own (player-side) depth: the depth-of-field reads the scene depth, and with the
    // occluder's depth left in place the figure was blurred along with the roof / canopy in front
    // of it into a shapeless pale blob. Drawn last (renderOrder 60, after water, god rays and
    // particles), so the written depth only feeds the DOF.
    this.silhouetteMaterial = silhouetteMaterial(this.sprite.texture);
    this._silhouetteBase = this.silhouetteMaterial.color.clone();
    /** The silhouettes are on (`setSilhouetteEnabled`) and the player's own one's fade (1: drawn; `fadeSilhouette`). */
    this._silhouetteOn = true;
    this._silhouetteFade = 1;
    this.silhouette = silhouetteMesh(this.sprite.mesh.geometry, this.silhouetteMaterial, 'Player.silhouette');
    this.sprite.mesh.add(this.silhouette);
    // The villager the player can talk to shows the same silhouette where something hides them
    // (a keeper under a stall's awning: only the prompt showed, KNOWN_ISSUES PROP-13): one more
    // mesh of the same program, moved from villager to villager — a draw call only while there is
    // one (`setTalkSilhouette`).
    this.talkSilhouetteMaterial = silhouetteMaterial(this.sprite.texture);
    this.talkSilhouette = silhouetteMesh(this.sprite.mesh.geometry, this.talkSilhouetteMaterial, 'Player.talkSilhouette');
    /** The villager's sprite the talk silhouette is on (null: none). @type {Sprite3D|null} */
    this.talkSprite = null;
  }

  /**
   * Brightness of the x-ray silhouettes (1 = day). The game dims them after dark, where a pale
   * figure would glow brighter than the lanterns.
   * @param {number} k
   */
  setSilhouetteLevel(k) {
    this.silhouetteMaterial.color.copy(this._silhouetteBase).multiplyScalar(k);
    this.talkSilhouetteMaterial.color.copy(this.silhouetteMaterial.color);
  }

  /**
   * Show / hide the x-ray silhouettes (hidden on the title screen). Only render states change,
   * never the program: it stays compiled (and warmed) either way.
   * @param {boolean} on
   */
  setSilhouetteEnabled(on) {
    this._silhouetteOn = !!on;
    this.talkSilhouetteMaterial.colorWrite = !!on;
    this.talkSilhouetteMaterial.depthWrite = !!on;
    this._applySilhouetteFade();
  }

  /**
   * Fade the player's own x-ray silhouette toward `hidden` (1: gone, 0: drawn) over ≈ 0.15 s — the
   * game hides it while a party member stands in front of the player on the screen (the
   * silhouette's 1.3 u pull is about one member's spacing along the view ray: it painted a pale
   * ghost of the player over that member; docs/specs/PARTY.md §4.2). Only the material's opacity
   * and render states change: no program. Never called on a game without a party (it stays drawn
   * exactly as before).
   * @param {boolean} hidden
   * @param {number} dt
   */
  fadeSilhouette(hidden, dt) {
    const want = hidden ? 0 : 1;
    const step = dt / 0.15;
    const f = this._silhouetteFade;
    this._silhouetteFade = want > f ? Math.min(want, f + step) : Math.max(want, f - step);
    if (this._silhouetteFade !== f) this._applySilhouetteFade();
  }

  /** The player's silhouette as enabled and faded: opacity, and no draw at all (colour, depth) when faded out. */
  _applySilhouetteFade() {
    const m = this.silhouetteMaterial;
    const f = this._silhouetteFade;
    m.opacity = SILHOUETTE_OPACITY * f;
    const on = this._silhouetteOn && f > 0.001;
    m.colorWrite = on;
    m.depthWrite = on;
  }

  /**
   * Put the talk silhouette on a villager's sprite (the one the player can talk to), or take it
   * off (null). Its map becomes that sprite's own texture (its frame follows the animation).
   * @param {Sprite3D|null} sprite
   */
  setTalkSilhouette(sprite) {
    if (sprite === this.talkSprite) return;
    this.talkSilhouette.removeFromParent();
    this.talkSprite = sprite?.mesh && sprite.texture ? sprite : null;
    if (!this.talkSprite) return;
    this.talkSilhouette.geometry = this.talkSprite.mesh.geometry;
    this.talkSilhouetteMaterial.map = this.talkSprite.texture;
    this.talkSprite.mesh.add(this.talkSilhouette);
  }

  /** Surface under the player, for footstep colour. */
  _groundKind() {
    const tm = this.tileMap;
    const p = this.position;
    for (const r of tm.walkSurfaces) if (p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ) return 'wood';
    const t = tm.tileAt(Math.floor(p.x), Math.floor(p.z));
    if (!t) return 'grass';
    const top = t.type.top;
    if (top === 'cobblestone' || top === 'stone_tiles' || top === 'moss_stone') return 'stone';
    if (top === 'sand') return 'sand';
    return 'grass';
  }

  /** Face a world point (used when talking). */
  faceTowards(x, z) {
    const dx = x - this.position.x;
    const dz = z - this.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    this.facing.set(dx / len, 0, dz / len);
    this.sprite.faceVector(dx, dz);
  }

  /** Instantly move to (x, z) (terrain height). */
  teleport(x, z) {
    this.position.set(x, this.tileMap.getHeight(x, z), z);
    this.speed = 0;
  }

  /**
   * Arrive at (x, z) facing `facing`, standing idle with nothing left over from before — a
   * campaign level set aside and attached again (CAMPAIGN_FORMAT.md §6.3) keeps its traveler, who
   * arrives here instead of being made anew.
   * @param {{ x: number, z: number, facing?: string }} spawn
   */
  arrive(spawn) {
    const facing = /** @type {keyof typeof DIR_VECTORS} */ (typeof spawn.facing === 'string' && Object.hasOwn(DIR_VECTORS, spawn.facing) ? spawn.facing : 'down');
    this.teleport(spawn.x, spawn.z);
    this.facing.copy(DIR_VECTORS[facing]);
    this.sprite.setDirection(facing);
    this.running = false;
    this.frozen = false;
    this.scripted = null;
    this.moveOverride = null;
    this.faceOverride = null;
    this.speedMul = 1;
    this.setTalkSilhouette(null);
    this.sprite.speed = 1;
    this.sprite.play('idle');
  }

  /**
   * Move by (dx, dz) through the terrain and colliders (`tileMap.move`, radius 0.3, max step
   * 0.55) — lunges, rolls, knockback and separation on combat levels.
   * @returns {number} the fraction of the requested distance achieved (0..1)
   */
  moveBy(dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return 1;
    const p = this.position;
    const out = this.tileMap.move(p, dx, dz, RADIUS, 0.55, this._move);
    const moved = Math.hypot(out.x - p.x, out.z - p.z);
    p.x = out.x;
    p.z = out.z;
    return Math.min(1, moved / len);
  }

  /** @param {number} dt @param {Input} input */
  update(dt, input) {
    const tm = this.tileMap;
    const p = this.position;
    // a combat action owns the sprite: only follow the ground (no play / face / speed writes)
    if (this.action !== null) {
      this._followGround(dt);
      return;
    }
    let mx = 0;
    let my = 0;
    let run = false;
    let world = false;
    const scripted = this.scripted;
    if (scripted) {
      // a story script walks the player (StoryRunner): a world direction, frozen or not
      mx = scripted.x;
      my = scripted.z;
      world = true;
      run = scripted.run;
    } else if (!this.frozen && input) {
      const mo = this.moveOverride;
      if (mo) {
        mx = mo.x;
        my = mo.z;
        world = true;
      } else {
        const mv = input.getMoveVector();
        mx = mv.x;
        my = mv.y;
      }
      run = input.action('run');
    }
    const mag = Math.min(1, Math.hypot(mx, my));
    const face = this.faceOverride;
    if (mag > 0.05) {
      const d = this._dir;
      if (world) d.set(mx, 0, my);
      else {
        // screen-space move vector → world XZ via the camera's move basis
        const { forward, right } = this.rig.getMoveBasis();
        d.set(0, 0, 0).addScaledVector(right, mx).addScaledVector(forward, my);
      }
      d.y = 0;
      d.normalize();
      // a lock-on strafe (faceOverride) always walks: it plays the walk cycle (§6.9), and running
      // speed under a walk cycle slid the feet
      if (face) run = false;
      this.running = run;
      const speed = (run ? RUN_SPEED : WALK_SPEED) * mag * this.speedMul;
      const out = tm.move(p, d.x * speed * dt, d.z * speed * dt, RADIUS, 0.55, this._move);
      const moved = Math.hypot(out.x - p.x, out.z - p.z);
      p.x = out.x;
      p.z = out.z;
      this.speed = dt > 0 ? moved / dt : 0;
      if (face) {
        // lock-on: strafe facing the target, with the walk cycle
        this.facing.set(face.x, 0, face.z);
        this.sprite.faceVector(face.x, face.z);
      } else {
        this.facing.copy(d);
        this.sprite.faceVector(d.x, d.z);
      }
      // pushing against a wall: keep walking in place slowly rather than freezing mid-stride
      const anim = run ? 'run' : 'walk';
      this.sprite.play(anim);
      this.sprite.speed = clamp(0.55 + 0.45 * (this.speed / Math.max(0.01, speed)), 0.55, 1) * Math.max(0.6, mag);
    } else {
      this.speed = 0;
      this.running = false;
      this.sprite.play('idle');
      this.sprite.speed = IDLE_SPEED[0] + 0.04;
      if (face) this.facing.set(face.x, 0, face.z);
      // keep the screen-space facing in sync with the world facing when the camera orbits (Q/E),
      // so the character visibly faces what the interaction prompt refers to
      this.sprite.faceVector(this.facing.x, this.facing.z);
    }
    this._followGround(dt);
  }

  /** Smooth height following (stairs ramps, 0.5 ledges, bridge arches). */
  _followGround(dt) {
    const p = this.position;
    const gy = this.tileMap.getHeight(p.x, p.z);
    const k = gy > p.y ? damp(22, dt) : damp(16, dt);
    p.y += (gy - p.y) * k;
    if (Math.abs(gy - p.y) < 1e-3) p.y = gy;
  }

  dispose() {
    this.silhouetteMaterial.dispose();
    this.talkSilhouette.removeFromParent();
    this.talkSprite = null;
    this.talkSilhouetteMaterial.dispose();
    this.sprite.dispose();
    this.sheet.dispose?.();
  }
}
