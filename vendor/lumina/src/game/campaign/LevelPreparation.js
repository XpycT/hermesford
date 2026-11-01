import { parseLevel } from '../../engine/level/LevelFormat.js';

/**
 * @import { Level, LevelObject } from '../../engine/level/types.js'
 * @import { World } from '../World.js'
 */

/** A build step yields to the page at least this often while a travel finishes it (ms). */
const FINISH_SLICE_MS = 12;

/**
 * What a preparation needs from the campaign and the game (CampaignRuntime._prepareAhead).
 * @typedef {object} PreparationHost
 * @property {(raw: Level) => { level: Level, presence: string, present: (o: LevelObject) => boolean }} apply
 *   the story applied to the parsed file as it stands in the level to be entered: the level as it
 *   will be played (CampaignRuntime.storyLevel), the presence of its story-conditioned objects
 *   (CampaignRuntime.presenceKey — what makes the build differ) and the presence test the world is
 *   built with
 * @property {(level: Level, present: (o: LevelObject) => boolean) => World} world
 *   a World built ahead (Game.prepareWorld: `defer`)
 * @property {(level: Level) => void} music
 *   the level's music rendered ahead too (Game.primeLevelMusic, kept as the 'next' level's: only
 *   Vanquish's score tracks render anything)
 */

/**
 * A campaign level built ahead of a travel (docs/specs/CAMPAIGN_FORMAT.md §6.3, KNOWN_ISSUES
 * CMP-01). CampaignRuntime makes one when the player comes near an exit (the preload rule) and
 * calls `step(budget)` every frame: the level file is parsed, the story applied and the level's
 * World built (`World.buildSteps({ paced: true })`) in slices of a few milliseconds while the
 * player still plays the level before it; its music is asked for at the parse (`host.music`: the
 * renders run off the main thread). The world stays outside the running game — no scene
 * object, light, emissive registration, emitter or collider of the level being played — until
 * the travel hands it to `Game.swapLevel`, which runs the steps not done yet (`finish`) and
 * attaches it where a build would have run.
 *
 * The travel takes it only while its inputs are the same: the same file text and the same
 * presence of every story-conditioned object (`presence`); anything else is disposed and the
 * level built at the travel as before.
 *
 * States: `loading` (the file is fetched) → `building` (parsed, the story applied, the world in
 * slices) → `ready`; `failed` (the file or a build step failed: the travel builds anew and meets
 * the same error there); `taken` (handed to the travel); `disposed`.
 */
export class LevelPreparation {
  /**
   * @param {{ to: string, fileId: string, text: Promise<string>, host: PreparationHost }} opts
   *   to: the base level id; fileId: the file played for it; text: the file's text (CampaignLevels)
   */
  constructor({ to, fileId, text, host }) {
    this.to = to;
    this.fileId = fileId;
    this.host = host;
    /** @type {'loading'|'building'|'ready'|'failed'|'taken'|'disposed'} */
    this.state = 'loading';
    /** The file's text once fetched (a travel compares it). @type {string|null} */
    this.text = null;
    /** The parsed file (story not applied) and its warnings. @type {Level|null} */
    this.raw = null;
    /** @type {string[]} */
    this.warnings = [];
    /** The level as it will be played (the story applied), and the presence it was built for. @type {Level|null} */
    this.level = null;
    this.presence = '';
    /** @type {World|null} */
    this.world = null;
    /** @type {Generator<any, void>|null} */
    this._steps = null;
    /** A promise a build step waits for (the shore bake in its worker) and whether it settled. */
    this._wait = null;
    this._waitDone = false;
    /** @type {unknown} why it failed */
    this.error = null;
    /**
     * cpuMs: milliseconds of work so far; slices: frames that did some; maxSliceMs: the longest
     * frame's work; steps: build steps run; maxStepMs / maxStepAt: the longest single step and the
     * build phase it was in ('parse' for the parse); startedAt / readyAt: performance.now() (0: not yet).
     */
    this.stats = { cpuMs: 0, slices: 0, maxSliceMs: 0, steps: 0, maxStepMs: 0, maxStepAt: '', startedAt: performance.now(), readyAt: 0 };
    /** The build phase the steps are in (the label of the last phase yielded). */
    this._phase = '';
    text.then(
      (t) => {
        if (this.state !== 'loading') return;
        this.text = t;
      },
      // (quietly: the travel fetches the file again and reports what it finds)
      (err) => this._fail(err, { quiet: true }),
    );
  }

  /**
   * Work for at most about `budgetMs` milliseconds (one frame's share): parse the file once it is
   * here (one step), then the world's build steps until the budget is spent, the build waits for
   * its worker or it is done. Returns the milliseconds worked.
   * @param {number} budgetMs
   * @returns {number}
   */
  step(budgetMs) {
    if (this.state !== 'loading' && this.state !== 'building') return 0;
    const t0 = performance.now();
    try {
      if (this.state === 'loading') {
        if (this.text === null) return 0;
        this._start();
        this._noteStep(performance.now() - t0, 'parse');
      } else this._run(t0 + budgetMs);
    } catch (err) {
      this._fail(err);
    }
    const ms = performance.now() - t0;
    this.stats.cpuMs += ms;
    this.stats.slices++;
    if (ms > this.stats.maxSliceMs) this.stats.maxSliceMs = ms;
    return ms;
  }

  /** The text is here: parse it, apply the story, make the world (one frame's step). */
  _start() {
    const { level: raw, warnings } = parseLevel(this.text);
    this.raw = raw;
    this.warnings = warnings;
    const { level, presence, present } = this.host.apply(raw);
    this.level = level;
    this.presence = presence;
    this.host.music(level);
    this.world = this.host.world(level, present);
    this._steps = this.world.buildSteps({ paced: true });
    this.state = 'building';
  }

  /** Build steps until `deadline` (performance.now()), a wait or the end. */
  _run(deadline) {
    if (this._wait && !this._waitDone) return;
    this._wait = null;
    for (;;) {
      const t = performance.now();
      const r = this._steps.next();
      const now = performance.now();
      this._noteStep(now - t, this._phase);
      if (r.done) {
        this._done();
        return;
      }
      if (r.value && 'wait' in r.value) {
        this._waitOn(r.value.wait);
        return;
      }
      if (r.value?.label) this._phase = r.value.label;
      if (now >= deadline) return;
    }
  }

  /** @param {number} ms @param {string} at */
  _noteStep(ms, at) {
    const s = this.stats;
    s.steps++;
    if (ms > s.maxStepMs) {
      s.maxStepMs = ms;
      s.maxStepAt = at;
    }
  }

  /** @param {Promise<unknown>} p */
  _waitOn(p) {
    this._wait = p;
    this._waitDone = false;
    const done = () => { if (this._wait === p) this._waitDone = true; };
    p.then(done, done);
  }

  _done() {
    this._steps = null;
    this.state = 'ready';
    this.stats.readyAt = performance.now();
  }

  /**
   * @param {unknown} err
   * @param {{ quiet?: boolean }} [opts]
   */
  _fail(err, { quiet = false } = {}) {
    if (this.state === 'disposed' || this.state === 'taken' || this.state === 'failed') return;
    this.error = err;
    this.state = 'failed';
    this._steps = null;
    if (!quiet) console.warn(`[Luminati] building "${this.fileId}" ahead failed (it is built at the travel):`, err);
    this._disposeWorld();
  }

  /**
   * The travel takes it (CampaignRuntime.travel): from now on the game owns the world.
   * @returns {this}
   */
  take() {
    this.state = 'taken';
    return this;
  }

  /**
   * The rest of the build at full speed (Game._buildLevel, behind the fader): the steps not run
   * yet, a frame to the page every ~12 ms, the waits awaited. Throws what a step throws (the
   * travel's rollback handles it as a failed build).
   * @returns {Promise<void>}
   */
  async finish() {
    const steps = this._steps;
    if (!steps) return;
    if (this._wait && !this._waitDone) await this._wait;
    this._wait = null;
    let slice = performance.now();
    for (let r = steps.next(); !r.done; r = steps.next()) {
      this.stats.steps++;
      if (r.value && 'wait' in r.value) {
        await r.value.wait;
        slice = performance.now();
      } else if (performance.now() - slice > FINISH_SLICE_MS) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        slice = performance.now();
      }
    }
    this._steps = null;
  }

  /** What `info().prep` shows. */
  info() {
    const s = this.stats;
    return {
      to: this.to,
      file: this.fileId,
      state: this.state,
      cpuMs: +s.cpuMs.toFixed(1),
      slices: s.slices,
      maxSliceMs: +s.maxSliceMs.toFixed(2),
      steps: s.steps,
      maxStepMs: +s.maxStepMs.toFixed(2),
      maxStepAt: s.maxStepAt,
      ms: Math.round((s.readyAt || performance.now()) - s.startedAt),
    };
  }

  _disposeWorld() {
    const w = this.world;
    this.world = null;
    if (!w) return;
    try {
      w.dispose();
    } catch (err) {
      console.warn('[Luminati] releasing a level built ahead failed:', err);
    }
  }

  /** Not used (the player went elsewhere, the story changed what the level holds): release it. */
  dispose() {
    if (this.state === 'disposed' || this.state === 'taken') return;
    this.state = 'disposed';
    this._steps = null;
    this._disposeWorld();
  }
}
