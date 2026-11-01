import * as THREE from 'three';
import { Sprite3D } from '../engine/sprite/Sprite3D.js';
import { createCreatureSheet } from '../engine/pixel/CharacterSprites.js';
import { RNG, damp, hashString } from '../engine/utils/math.js';
import { CHARACTER_SPRITE_OPTS } from './config.js';
import { isOwnKey } from '../engine/utils/own.js';
import { critterStartPoints, critterYard } from '../engine/level/ObjectCatalog.js';
import { hasStoryCondition } from '../engine/level/Travel.js';

/**
 * @import { LevelObject, LevelObjectOf } from '../engine/level/types.js'
 * @import { SpriteManager } from '../engine/sprite/SpriteManager.js'
 * @import { TileMap } from '../engine/world/TileMap.js'
 */

/**
 * Critters, driven by the level's `critters` objects (docs/contracts/LEVEL_EDITOR.md):
 *  - chickens peck inside their yard and scatter from the player and chasing villagers;
 *  - cats (and dogs) wander around their home spot and look at the player;
 *  - birds hop about, take flight when the player comes close and return a little later.
 * A group with a story condition (`when` / `unless`) comes and goes with the story (`applyStory`).
 */

class Critter {
  constructor({ sheet, tileMap, x, z, seed, bounds = null, radius = 0.15, speed = 0.9, opts = {} }) {
    this.tileMap = tileMap;
    this.sprite = new Sprite3D(sheet, { ...CHARACTER_SPRITE_OPTS, blobSize: [0.55, 0.26], ...opts });
    this.position = this.sprite.position;
    this.position.set(x, tileMap.getHeight(x, z), z);
    this.home = new THREE.Vector3(x, 0, z);
    /** Where it started (a story group that comes back starts there again: `reset`). */
    this.start = { x, z };
    /** Its story group is absent (`Critters.applyStory`): hidden, not updated. */
    this.absent = false;
    this.bounds = bounds;
    this.radius = radius;
    this.speed = speed;
    this.rng = new RNG(seed);
    this.state = 'idle';
    this.timer = this.rng.range(0.2, 2.5);
    this.target = new THREE.Vector3(x, 0, z);
    this._out = { x: 0, z: 0 };
    this.sprite.setDirection(this.rng.pick(['down', 'left', 'right', 'up']));
    this.sprite.play('idle');
  }

  /**
   * Back at its start point, idle and shown (its story group came back) — or, when what the story
   * brought meanwhile stands there (a house), at the nearest walkable spot.
   */
  reset() {
    const { x, z } = clearSpot(this.tileMap, this.start.x, this.start.z);
    this.position.set(x, this.tileMap.getHeight(x, z), z);
    this.target.set(x, 0, z);
    this.state = 'idle';
    this.timer = this.rng.range(0.2, 2.5);
    this.sprite.speed = 1;
    if (this.sprite.opacity !== 1) this.sprite.opacity = 1;
    this.sprite.visible = true;
    this.sprite.play('idle');
  }

  _clampTarget(v) {
    const b = this.bounds;
    if (!b) return v;
    v.x = Math.min(b.maxX, Math.max(b.minX, v.x));
    v.z = Math.min(b.maxZ, Math.max(b.minZ, v.z));
    return v;
  }

  _step(dt, tx, tz, speed, anim = 'walk') {
    const p = this.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const s = Math.min(d, speed * dt);
    const out = this.tileMap.move(p, (dx / d) * s, (dz / d) * s, this.radius, 0.55, this._out);
    const moved = Math.hypot(out.x - p.x, out.z - p.z);
    p.x = out.x;
    p.z = out.z;
    this.sprite.faceVector(dx, dz);
    this.sprite.play(anim);
    return moved < s * 0.2;
  }

  _followGround(dt) {
    const p = this.position;
    const gy = this.tileMap.getHeight(p.x, p.z);
    p.y += (gy - p.y) * damp(18, dt);
  }
}

class Chicken extends Critter {
  update(dt, threats) {
    const p = this.position;
    // scatter from anything close (player, child)
    let fx = 0;
    let fz = 0;
    for (const t of threats) {
      const dx = p.x - t.x;
      const dz = p.z - t.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.7 && d > 1e-3) { fx += (dx / d) * (1.7 - d); fz += (dz / d) * (1.7 - d); }
    }
    if ((fx || fz) && this.state !== 'flee') {
      const l = Math.hypot(fx, fz);
      this.target.set(p.x + (fx / l) * 1.6 + this.rng.range(-0.4, 0.4), 0, p.z + (fz / l) * 1.6 + this.rng.range(-0.4, 0.4));
      this._clampTarget(this.target);
      this.state = 'flee';
      this.timer = this.rng.range(0.5, 0.8);
    }
    this.timer -= dt;
    if (this.state === 'flee') {
      const stuck = this._step(dt, this.target.x, this.target.z, 3.4, 'walk');
      this.sprite.speed = 2.2;
      if (stuck || this.timer <= 0) { this.state = 'idle'; this.timer = this.rng.range(0.6, 2); }
    } else if (this.state === 'walk') {
      const stuck = this._step(dt, this.target.x, this.target.z, this.speed, 'walk');
      this.sprite.speed = 1;
      if (stuck || this.timer <= 0 || Math.hypot(this.target.x - p.x, this.target.z - p.z) < 0.06) {
        this.state = 'idle';
        this.timer = this.rng.range(1.2, 4);
      }
    } else {
      this.sprite.play('idle'); // idle = pecking
      this.sprite.speed = 1;
      if (this.timer <= 0) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(0.4, 1.4);
        this._clampTarget(this.target.set(p.x + Math.cos(a) * r, 0, p.z + Math.sin(a) * r));
        this.state = 'walk';
        this.timer = 3;
      }
    }
    this._followGround(dt);
  }
}

class Cat extends Critter {
  constructor(o) {
    super(o);
    /** Roam radius around home. */
    this.roam = o.roam ?? 3.2;
  }

  update(dt, player) {
    const p = this.position;
    this.timer -= dt;
    if (this.state === 'walk') {
      const stuck = this._step(dt, this.target.x, this.target.z, this.speed, 'walk');
      if (stuck || this.timer <= 0 || Math.hypot(this.target.x - p.x, this.target.z - p.z) < 0.06) {
        this.state = 'idle';
        this.timer = this.rng.range(3, 8);
      }
    } else {
      this.sprite.play('idle');
      const d = Math.hypot(player.x - p.x, player.z - p.z);
      if (d < 2) this.sprite.faceVector(player.x - p.x, player.z - p.z);
      if (this.timer <= 0) {
        for (let k = 0; k < 6; k++) {
          const a = this.rng.range(0, Math.PI * 2);
          const r = this.rng.range(Math.min(1, this.roam * 0.5), this.roam);
          const x = this.home.x + Math.cos(a) * r;
          const z = this.home.z + Math.sin(a) * r;
          if (this.tileMap.isWalkable(x, z)) { this.target.set(x, 0, z); break; }
        }
        this.state = 'walk';
        this.timer = 5;
      }
    }
    this._followGround(dt);
  }
}

class Bird extends Critter {
  constructor(o) {
    super(o);
    this.vel = new THREE.Vector3();
    this.hidden = 0;
    /** How far a hop may wander from home before being pulled back. */
    this.roam = o.roam ?? 1.6;
  }

  reset() {
    super.reset();
    this.vel.set(0, 0, 0);
  }

  update(dt, player) {
    const p = this.position;
    if (this.state === 'fly') {
      this.vel.y += 1.6 * dt;
      p.addScaledVector(this.vel, dt);
      this.sprite.play('walk');
      this.sprite.speed = 3;
      this.sprite.opacity = Math.max(0, this.sprite.opacity - dt * 0.7);
      if (this.sprite.opacity <= 0) {
        this.state = 'away';
        this.sprite.visible = false;
        this.timer = this.rng.range(9, 15);
      }
      return;
    }
    if (this.state === 'away') {
      this.timer -= dt;
      if (this.timer <= 0 && Math.hypot(player.x - this.home.x, player.z - this.home.z) > 5) {
        p.set(this.home.x + this.rng.range(-0.8, 0.8), 0, this.home.z + this.rng.range(-0.8, 0.8));
        p.y = this.tileMap.getHeight(p.x, p.z);
        this.sprite.visible = true;
        this.sprite.opacity = 0;
        this.state = 'land';
        this.sprite.speed = 1;
      }
      return;
    }
    if (this.state === 'land') {
      this.sprite.opacity = Math.min(1, this.sprite.opacity + dt * 1.5);
      if (this.sprite.opacity >= 1) { this.state = 'idle'; this.timer = 1; }
    }
    const d = Math.hypot(player.x - p.x, player.z - p.z);
    if (d < 2.3 && this.state !== 'land') {
      const dx = (p.x - player.x) / Math.max(d, 1e-3);
      const dz = (p.z - player.z) / Math.max(d, 1e-3);
      this.vel.set(dx * 2.6 + this.rng.range(-0.6, 0.6), 1.8, dz * 2.6 - 0.8);
      this.sprite.faceVector(this.vel.x, this.vel.z);
      this.state = 'fly';
      return;
    }
    this.timer -= dt;
    if (this.state === 'hop') {
      const stuck = this._step(dt, this.target.x, this.target.z, 1.1, 'walk');
      if (stuck || this.timer <= 0) { this.state = 'idle'; this.timer = this.rng.range(0.6, 2.4); }
    } else if (this.timer <= 0) {
      const a = this.rng.range(0, Math.PI * 2);
      this.target.set(p.x + Math.cos(a) * 0.5, 0, p.z + Math.sin(a) * 0.5);
      if (Math.hypot(this.target.x - this.home.x, this.target.z - this.home.z) > this.roam) this.target.lerp(this.home, 0.6);
      this.state = 'hop';
      this.timer = 0.6;
    } else {
      this.sprite.play('idle');
    }
    this._followGround(dt);
  }
}

/**
 * Per-kind look & motion defaults. `sheet` = createCreatureSheet colours, `opts` = Sprite3D options,
 * `radius` = collision radius, `speed` = walk speed.
 */
const KINDS = {
  chicken: { cls: Chicken, speed: 0.8, radius: 0.15, opts: { blobSize: [0.5, 0.24] } },
  cat: { cls: Cat, speed: 1.1, radius: 0.18, sheet: { fur: '#d8893c', fur2: '#a95a24', fur3: '#f3c27a' }, opts: { blobSize: [0.7, 0.3] } },
  dog: { cls: Cat, speed: 1.3, radius: 0.22, opts: { blobSize: [0.8, 0.34] } },
  bird: { cls: Bird, speed: 0.9, radius: 0.1, opts: { blobSize: [0.35, 0.18], castShadow: false } },
};


/**
 * (x, z) when it is walkable, else the nearest walkable spot within 4 units (rings 0.25 apart),
 * else (x, z) as it is.
 * @param {TileMap} tm @param {number} x @param {number} z
 */
function clearSpot(tm, x, z) {
  if (tm.isWalkable(x, z)) return { x, z };
  for (let d = 0.25; d <= 4.001; d += 0.25) {
    const n = Math.max(8, Math.round(d * 12));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      if (tm.isWalkable(px, pz)) return { x: px, z: pz };
    }
  }
  return { x, z };
}

export class Critters {
  /**
   * @param {{ tileMap: TileMap, scene: THREE.Object3D, spriteManager: SpriteManager,
   *   groups?: LevelObjectOf<'critters'>[] }} ctx
   *   groups: level `critters` objects { id, kind, count, x, z, radius (roam radius) } plus the
   *   optional fields `area` ({minX,maxX,minZ,maxZ} relative to x/z: the chicken yard, default
   *   the square of `radius`), `spotOffsets` ([[dx, dz], …] relative to x/z: exact start spots),
   *   `seed` (placement RNG), `seedBase` (per-animal behaviour seeds seedBase + i) and `speed`.
   *   The offsets are relative so the animals follow the object when it is moved in the editor;
   *   the absolute forms `bounds` / `spots` (world coordinates) are still honoured.
   */
  constructor({ tileMap, scene, spriteManager, groups = [] }) {
    this.tileMap = tileMap;
    this.sheets = new Map();
    /** The chickens there now (villagers who chase chickens read it: one array, changed in place). */
    this.chickens = [];
    this.cats = [];
    this.birds = [];
    this.all = [];
    /**
     * The groups with a story condition: their animals come and go together (`applyStory`).
     * @type {{ obj: LevelObject, critters: Critter[], present: boolean }[]}
     */
    this.storyGroups = [];
    for (const g of groups) {
      try {
        this._spawnGroup(g);
      } catch (err) {
        console.warn(`[Luminati] could not create critters "${g.id}":`, err);
      }
    }
    /** First cat (legacy handle). */
    this.cat = this.cats[0] ?? null;
    /** Far-critter throttle `{ focus, far2, every }` (null: every critter every frame). */
    this.throttle = null;
    for (const c of this.all) {
      scene.add(c.sprite);
      spriteManager.add(c.sprite);
    }
  }

  _sheet(kind) {
    let sheet = this.sheets.get(kind);
    if (!sheet) {
      sheet = createCreatureSheet(kind, KINDS[kind].sheet ?? {});
      this.sheets.set(kind, sheet);
    }
    return sheet;
  }

  /** @param {LevelObjectOf<'critters'>} g */
  _spawnGroup(g) {
    /** @type {string} a KINDS key (widened: the critter classes' constructor types predate `roam` / `kind`) */
    const kind = isOwnKey(KINDS, g.kind) ? g.kind : 'chicken';
    const K = KINDS[kind];
    const tm = this.tileMap;
    const x = Number(g.x) || 0;
    const z = Number(g.z) || 0;
    const R = Math.max(0.3, Number(g.radius) || 2.5);
    // the chickens' yard: the relative `area` (or legacy absolute `bounds`), else the radius square
    const bounds = critterYard(g) ?? { minX: x - R, maxX: x + R, minZ: z - R, maxZ: z + R };
    const seedBase = Number.isFinite(g.seedBase) ? g.seedBase : hashString(String(g.id ?? kind)) % 10000;
    const sheet = this._sheet(kind);
    // the start spots, shared with the editor previews (ObjectCatalog.critterStartPoints): `count`
    // wins (the inspector edits it), the first animals take the exact spots and any extra ones
    // are scattered over the yard, a few retries keeping them out of water, walls and props
    const starts = critterStartPoints(g, (px, pz) => tm.isWalkable(px, pz));
    // (a story group: its animals come and go together — registered first, so one that throws half
    // way still follows the story with the animals made)
    const made = [];
    if (hasStoryCondition(g)) this.storyGroups.push({ obj: g, critters: made, present: true });
    for (let i = 0; i < starts.length; i++) {
      const [px, pz] = starts[i];
      const c = new K.cls({
        sheet, tileMap: tm, seed: seedBase + i, x: px, z: pz,
        bounds: kind === 'chicken' ? bounds : null,
        radius: K.radius, speed: Number.isFinite(g.speed) ? Math.max(0.1, g.speed) : K.speed, roam: R, opts: K.opts,
      });
      c.kind = kind;
      made.push(c);
      this.all.push(c);
      if (kind === 'chicken') this.chickens.push(c);
      else if (kind === 'bird') this.birds.push(c);
      else this.cats.push(c);
    }
  }

  /**
   * Animals standing where the story just brought something (a house, a wall of crates — the rect
   * that changed) go to the nearest walkable spot, as villagers are sent home.
   * @param {(x: number, z: number) => boolean} inRect
   */
  standClear(inRect) {
    for (const c of this.all) {
      if (c.absent) continue;
      const p = c.position;
      if (!inRect(p.x, p.z) || c.tileMap.isWalkable(p.x, p.z)) continue;
      const s = clearSpot(c.tileMap, p.x, p.z);
      p.set(s.x, c.tileMap.getHeight(s.x, s.z), s.z);
      c.target.set(s.x, 0, s.z);
    }
  }

  /**
   * The story changed (StoryRunner.applyPresence; a level without a story never calls it): a group
   * whose `when` / `unless` does not hold now is absent — its animals hidden and not updated, its
   * chickens out of `chickens` (no villager chases them); one that comes back starts again at its
   * start points.
   * @param {(o: LevelObject) => boolean} present is the object there as the story stands?
   * @returns {boolean} whether a group came or went
   */
  applyStory(present) {
    let changed = false;
    for (const sg of this.storyGroups) {
      const on = !!present(sg.obj);
      if (on === sg.present) continue;
      sg.present = on;
      changed = true;
      for (const c of sg.critters) {
        c.absent = !on;
        if (on) c.reset();
        else c.sprite.visible = false;
      }
    }
    if (changed) {
      this.chickens.length = 0;
      for (const c of this.all) if (c.kind === 'chicken' && !c.absent) this.chickens.push(c);
    }
    return changed;
  }

  /**
   * @param {number} dt
   * @param {{ player: THREE.Vector3, threats: {x:number, z:number}[] }} ctx
   *   threats: what chickens scatter from (the player, chasing villagers)
   */
  update(dt, { player, threats }) {
    const all = this.all;
    // optional far-critter throttle (big levels): { focus, far2, every } — animals farther than
    // √far2 from the focus update every `every`-th frame with the accumulated time
    const th = this.throttle;
    if (th) {
      this._frame = (this._frame ?? 0) + 1;
      this._acc ??= new Float32Array(all.length);
    }
    for (let i = 0; i < all.length; i++) {
      const c = all[i];
      // (a story group that is absent stands still, hidden; `reset` brings it back)
      if (c.absent) continue;
      if (th) {
        this._acc[i] += dt;
        const p = c.position;
        const far = (p.x - th.focus.x) ** 2 + (p.z - th.focus.z) ** 2 >= th.far2;
        if (far && (this._frame + i) % th.every !== 0) continue;
        c.update(Math.min(this._acc[i], 0.25), c.kind === 'chicken' ? threats : player);
        this._acc[i] = 0;
      } else c.update(dt, c.kind === 'chicken' ? threats : player);
    }
  }

  dispose(spriteManager) {
    for (const c of this.all) {
      spriteManager?.remove(c.sprite);
      c.sprite.removeFromParent();
      c.sprite.dispose();
    }
    for (const s of this.sheets.values()) s.dispose?.();
    this.sheets.clear();
  }
}
