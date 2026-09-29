import {
  createSystem, Entity, RayInteractable, Types, UIKitMLAsset, Vector3, VisibilityState,
} from '@iwsdk/core';
import { bus } from '../bus.js';
import { GameState } from '../components.js';
import { clearSave, continueLabel, readSave, writeSave } from '../save.js';
import { START } from '../story.js';
import { CampfireSystem } from './campfire-system.js';
import { CombatSystem } from './combat-system.js';
import { CraftingSystem } from './crafting-system.js';
import { CreatureSystem } from './creature-system.js';
import { DayNightSystem } from './daynight-system.js';
import { GatherSystem } from './gather-system.js';
import { ItemSystem } from './item-system.js';
import { HIDE, PanelText, plain, SHOW, Style } from './journal-system.js';
import { StorySystem } from './story-system.js';
import { SurvivalSystem } from './survival-system.js';
import { VignetteSystem } from './vignette-system.js';

export type JourneyChoice = 'new' | 'continue';
/** 'waiting': the start panel is up and the world holds still; 'starting': the fade and reset; 'running': a journey. */
export type StartPhase = 'waiting' | 'starting' | 'running';

type Pausable = { isPaused: boolean; stop(): void; play(): void };

const IDS = [
  'sm-root', 'sm-name', 'sm-subtitle', 'sm-lead', 'sm-hook', 'sm-continue', 'sm-continue-sub',
  'sm-new', 'sm-new-label', 'sm-new-sub', 'sm-help', 'sm-enter-xr',
] as const;

/** Stable names so XR tests (and players' rays) resolve the exact buttons. */
export const START_BUTTONS = {
  continue: 'Start Continue Button',
  fresh: 'Start New Journey Button',
  enterXR: 'Start Enter VR Button',
} as const;

const FADE_OUT = 0.45;
const FADE_IN = 1.2;
/** A level (re)load that has not finished by now is treated as failed: back to the panel. */
const LOAD_TIMEOUT_MS = 15_000;
const CONFIRM_SECONDS = 4;
/** Seconds after entering/leaving XR before the panel re-centres (the first poses settle). */
const REPLACE_DELAY = 0.3;
/** Lazy follow: re-centre when the view turns this far from the panel (rad) or the head moves this far (m). */
const FOLLOW_ANGLE = 0.6;
const FOLLOW_MOVE = 1.2;
const MAX_PITCH_UP = 0.17;
const MAX_PITCH_DOWN = -0.42;

const ROOT_SETUP: Style = { depthTest: false, renderOrder: 30 };
const PRIMARY: Style = { backgroundColor: '#d9ae70', borderColor: '#b78d59', hover: { backgroundColor: '#e8c48f' } };
const QUIET: Style = { backgroundColor: '#1b2621', borderColor: '#667567', hover: { backgroundColor: '#2a3a31' } };
const ARMED: Style = { backgroundColor: '#7c2f22', borderColor: '#c4583f', hover: { backgroundColor: '#8e3627' } };
const INK_DARK: Style = { color: '#17231e' };
const INK_LIGHT: Style = { color: '#e6ebdf' };
const HOOK_LEAD = plain(START.hook[0]);
const HOOK_BODY = plain(START.hook[1]);
const HELP_BROWSER = 'Click to choose.';
const HELP_XR = 'Point and pull the trigger to choose.';

/**
 * The start of every page load: a panel in front of the player's view with the
 * game's name, the story hook (story.ts START / OPENING) and New journey /
 * Continue (Continue only when a save exists, naming its day and progress).
 *
 * Until a choice is made the world holds still: the gameplay systems (items, fire,
 * bench, gathering, combat, creatures, survival, story/autosave) are stopped with
 * their own `stop()`, the day clock is pinned, and the fire stays cold. The panel is
 * reachable by mouse in the browser and by ray + trigger in XR, lazily follows the
 * view, and re-centres when XR is entered. It never returns mid-journey.
 *
 * Choosing fades to black, then:
 * - New journey (also the journal's New journey, via bus 'new-game'): clear the save
 *   and ItemSystem's consumed ledger; if a journey already ran on this page, reload
 *   the level (StorySystem.resetWorld) so everything is the scene's authored default.
 * - Continue: StorySystem.applySave onto the untouched level.
 * Then the held systems play again, 'journey-begin' {resumed} is emitted (the story,
 * wrist, guide intro and 'journey-start' toasts follow) and the view fades back in.
 *
 * If the level reload fails or hangs (LOAD_TIMEOUT_MS), the start is abandoned: the panel
 * comes back with a toast, the world stays held, and the next choice reloads again.
 *
 * Tests: `await world.getSystem(StartSystem)!.choose('new' | 'continue')` resolves once
 * the journey has begun (and rejects if it could not start); or click START_BUTTONS by
 * name; or emit bus 'new-game'.
 */
export class StartSystem extends createSystem({
  game: { required: [GameState] },
}, {
  /** Distance from the eyes to the panel (m). */
  distance: { type: Types.Float32, default: 1.35 },
  /** World scale of the 80-unit-wide panel (0.95 -> 76 cm). */
  scale: { type: Types.Float32, default: 0.95 },
}) {
  phase: StartPhase = 'waiting';
  /** Continue's second line as shown ('' when there is no save). */
  continueText = '';
  private asset?: UIKitMLAsset;
  private ui?: PanelText;
  private entity?: Entity;
  private shown = false;
  private disposed = false;
  /** A journey has begun on this page: the level is no longer pristine. */
  private dirty = false;
  private heldChecked = false;
  private busy?: Promise<void>;
  /**
   * The level reload in flight. A start that timed out leaves it running; the next choice
   * waits for it to settle instead of starting a second reload on top of it.
   */
  private reloading?: Promise<void>;
  private stopped = new Set<Pausable>();
  private hasSave = false;
  private armedUntil = 0;
  private now = 0;
  private replaceIn = -1;
  private waiters: { at: number; frames: number; resolve: () => void }[] = [];
  private eye = new Vector3();
  private look = new Vector3();
  private target = new Vector3();
  private anchorEye = new Vector3();

  private readonly onContinue = () => {
    if (this.phase === 'waiting') this.choose('continue').catch(() => { /* reported by sequence() */ });
  };
  private readonly onNew = () => {
    if (this.phase !== 'waiting') return;
    // A saved journey is erased by starting over: ask twice.
    if (this.hasSave && this.armedUntil <= this.now) {
      this.setArmed(true);
      return;
    }
    this.choose('new').catch(() => { /* reported by sequence() */ });
  };
  private readonly onEnterXR = () => this.world.launchXR();

  init(): void {
    this.hold(true);
    this.cleanupFuncs.push(
      bus.on('new-game', () => { this.run('new').catch(() => { /* reported by sequence() */ }); }),
      this.visibilityState.subscribe(() => {
        this.applyMode();
        if (this.phase === 'waiting') this.replaceIn = REPLACE_DELAY;
      }),
      () => {
        this.disposed = true;
        this.entity?.dispose({ disposeResources: false });
      },
    );
    void this.world.assets.instantiate<UIKitMLAsset>('start-menu').then((asset) => {
      if (this.disposed) { asset.dispose(); return; }
      this.bindPanel(asset);
    }).catch((error: unknown) => {
      // Never strand the player behind a missing panel: begin the obvious journey.
      console.error('[Prometheus UI] start-menu failed to load; starting without it', error);
      if (this.phase === 'waiting') this.choose(readSave() ? 'continue' : 'new').catch(() => { /* reported by sequence() */ });
    });
  }

  /**
   * Begin a journey. 'new' erases any save and resets the world (no confirmation: the
   * panel's own button asks twice when a save exists); 'continue' applies the save and
   * rejects when there is none. Resolves after 'journey-begin'.
   */
  choose(choice: JourneyChoice): Promise<void> {
    if (this.busy) return this.busy;
    if (choice === 'continue') {
      if (!readSave()) return Promise.reject(new Error('Continue: there is no saved journey'));
      return this.run('continue');
    }
    // Everyone clears their transient state on 'new-game'; our own listener starts the reset.
    bus.emit({ type: 'new-game' });
    return this.busy ?? this.run('new');
  }

  private run(choice: JourneyChoice): Promise<void> {
    if (this.busy) return this.busy;
    const busy = this.sequence(choice).finally(() => {
      if (this.busy === busy) this.busy = undefined;
    });
    this.busy = busy;
    return busy;
  }

  private async sequence(choice: JourneyChoice): Promise<void> {
    this.phase = 'starting';
    this.setShown(false);
    this.setArmed(false);
    this.hold(true);
    const vignette = this.world.getSystem(VignetteSystem);
    vignette?.fadeOut(FADE_OUT);
    await this.wait(FADE_OUT, 2);
    const story = this.world.getSystem(StorySystem);
    let resumed = false;
    const save = choice === 'continue' ? readSave() : null;
    try {
      if (!save) clearSave();
      if (this.dirty && story) {
        // One reload at a time: an earlier one that outlived its timeout must settle first.
        if (this.reloading) await this.withTimeout(this.reloading, LOAD_TIMEOUT_MS, 'the previous level reload');
        const reset = story.resetWorld();
        const reloading = this.reloading = reset.catch(() => {});
        void reloading.then(() => { if (this.reloading === reloading) this.reloading = undefined; });
        // A load that finishes after we gave up still clears storage: keep Continue's save.
        if (save) reset.then(() => { if (this.phase !== 'running') writeSave(save); }, () => {});
        await this.withTimeout(reset, LOAD_TIMEOUT_MS, 'the level reload');
        if (save) writeSave(save); // the reset clears storage; Continue keeps its save
      }
      // Let the (re)loaded level settle: queries, pack layout, scene entities.
      await this.wait(0.12, 3);
      if (save && story) {
        // Runtime-made items respawn and the pack is laid out before the journey begins.
        await this.withTimeout(story.applySave(save), LOAD_TIMEOUT_MS, 'restoring the saved journey');
        resumed = true;
      } else {
        story?.freshJourney();
      }
      await this.wait(0.1, 2);
    } catch (error) {
      console.error('[Prometheus] Journey start failed', error);
      this.recover(save);
      throw error;
    }
    this.dirty = true;
    this.phase = 'running';
    this.hold(false);
    bus.emit({ type: 'journey-begin', resumed });
    vignette?.fadeIn(FADE_IN);
  }

  /** The start could not finish: the world stays held, the panel returns, the next choice reloads the level. */
  private recover(save: ReturnType<typeof readSave>): void {
    if (save) writeSave(save);
    this.dirty = true;
    this.phase = 'waiting';
    this.hold(true);
    this.world.getSystem(VignetteSystem)?.fadeIn(FADE_IN);
    this.setShown(true);
    bus.emit({ type: 'toast', tone: 'warn', text: 'The valley would not wake', body: 'Something went wrong starting the journey. Choose again.', hold: 6 });
  }

  /** Reject if `promise` has not settled within `ms` (real time: a stalled load may stall frames too). */
  private withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
      promise.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
    });
  }

  /** Stop (or resume) the gameplay systems with their own play/stop; only resumes what it stopped. */
  private hold(on: boolean): void {
    // The day clock holds with the world; DayNight still paints the sky.
    const daynight = this.world.getSystem(DayNightSystem);
    if (daynight) daynight.holdClock = on;
    if (!on) {
      for (const system of this.stopped) system.play();
      this.stopped.clear();
      return;
    }
    const held: (Pausable | undefined)[] = [
      this.world.getSystem(ItemSystem), this.world.getSystem(CampfireSystem), this.world.getSystem(CraftingSystem),
      this.world.getSystem(GatherSystem), this.world.getSystem(CombatSystem), this.world.getSystem(CreatureSystem),
      this.world.getSystem(SurvivalSystem), this.world.getSystem(StorySystem),
    ];
    for (const system of held) {
      if (!system || system.isPaused) continue;
      system.stop();
      this.stopped.add(system);
    }
  }

  /** Resolves after `seconds` of world time and at least `frames` updates. */
  private wait(seconds: number, frames = 1): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ at: this.now + seconds, frames, resolve }));
  }

  // ---- Panel -----------------------------------------------------------------------

  private bindPanel(asset: UIKitMLAsset): void {
    this.asset = asset;
    const ui = this.ui = new PanelText(asset, IDS, 'start-menu');
    ui.get('sm-root')?.setProperties(ROOT_SETUP);
    ui.text('sm-name', plain(START.name));
    ui.text('sm-subtitle', plain(START.subtitle));
    ui.text('sm-lead', HOOK_LEAD);
    ui.text('sm-hook', HOOK_BODY);
    const bind = (id: string, name: string, handler: () => void) => {
      const element = ui.get(id);
      if (!element) return;
      element.name = name;
      element.addEventListener('click', handler);
      this.cleanupFuncs.push(() => element.removeEventListener('click', handler));
    };
    bind('sm-continue', START_BUTTONS.continue, this.onContinue);
    bind('sm-new', START_BUTTONS.fresh, this.onNew);
    bind('sm-enter-xr', START_BUTTONS.enterXR, this.onEnterXR);
    asset.name = 'Start Panel';
    asset.scale.setScalar(this.config.scale.peek());
    this.entity = this.world.createTransformEntity(asset, { persistent: true });
    asset.visible = false;
    this.cleanupFuncs.push(this.config.scale.subscribe((s) => asset.scale.setScalar(s)));
    if (this.phase === 'waiting') this.setShown(true);
  }

  private setShown(shown: boolean): void {
    const asset = this.asset;
    const entity = this.entity;
    if (!asset || !entity) return;
    if (shown === this.shown) return;
    this.shown = shown;
    asset.visible = shown;
    asset.pointerEvents = shown ? 'auto' : 'none';
    if (shown && !entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable);
    if (!shown && entity.hasComponent(RayInteractable)) entity.removeComponent(RayInteractable);
    if (shown) {
      this.refreshSave();
      this.applyMode();
      this.place(true);
    }
  }

  /** Continue appears only with a save, named by its day and progress; New journey leads otherwise. */
  private refreshSave(): void {
    const ui = this.ui;
    if (!ui) return;
    const save = readSave();
    this.hasSave = !!save;
    this.continueText = save ? continueLabel(save) : '';
    ui.style('sm-continue', save ? SHOW : HIDE);
    if (save) {
      ui.text('sm-continue-sub', this.continueText);
      ui.style('sm-continue', PRIMARY);
    }
    this.setArmed(false);
  }

  private setArmed(armed: boolean): void {
    const ui = this.ui;
    this.armedUntil = armed ? this.now + CONFIRM_SECONDS : 0;
    if (!ui) return;
    ui.style('sm-new', armed ? ARMED : this.hasSave ? QUIET : PRIMARY);
    const ink = armed || this.hasSave ? INK_LIGHT : INK_DARK;
    ui.style('sm-new-label', ink);
    ui.style('sm-new-sub', ink);
    ui.text('sm-new-label', armed ? plain(START.confirm) : 'New journey');
    ui.text('sm-new-sub', armed ? plain(START.confirmBody) : plain(START.fresh));
  }

  /** Help line and the Enter VR link follow the display mode. */
  private applyMode(): void {
    const ui = this.ui;
    if (!ui) return;
    const browser = this.visibilityState.peek() === VisibilityState.NonImmersive;
    ui.text('sm-help', browser ? HELP_BROWSER : HELP_XR);
    ui.style('sm-enter-xr', browser && this.world.xrEnabled ? SHOW : HIDE);
  }

  /** Put the panel ahead of the view (pitch clamped so it never hangs overhead or at the feet). */
  private place(immediate: boolean): void {
    const asset = this.asset;
    if (!asset) return;
    this.camera.getWorldPosition(this.eye);
    this.camera.getWorldDirection(this.look);
    const flat = Math.hypot(this.look.x, this.look.z);
    const pitch = Math.max(MAX_PITCH_DOWN, Math.min(MAX_PITCH_UP, Math.atan2(this.look.y, flat || 1e-6)));
    const fx = flat > 1e-4 ? this.look.x / flat : 0;
    const fz = flat > 1e-4 ? this.look.z / flat : -1;
    const distance = this.config.distance.peek();
    const c = Math.cos(pitch);
    this.target.set(this.eye.x + fx * c * distance, this.eye.y + Math.sin(pitch) * distance - 0.04, this.eye.z + fz * c * distance);
    this.anchorEye.copy(this.eye);
    if (immediate) asset.position.copy(this.target);
    asset.lookAt(this.eye);
  }

  private follow(delta: number): void {
    const asset = this.asset;
    if (!asset || !this.shown) return;
    if (this.replaceIn >= 0) {
      this.replaceIn -= delta;
      if (this.replaceIn < 0) this.place(true);
      return;
    }
    this.camera.getWorldPosition(this.eye);
    this.camera.getWorldDirection(this.look);
    const toX = this.target.x - this.eye.x, toZ = this.target.z - this.eye.z;
    const lookFlat = Math.hypot(this.look.x, this.look.z) || 1;
    const toFlat = Math.hypot(toX, toZ) || 1;
    const cos = (toX * this.look.x + toZ * this.look.z) / (toFlat * lookFlat);
    if (cos < Math.cos(FOLLOW_ANGLE) || this.eye.distanceTo(this.anchorEye) > FOLLOW_MOVE) this.place(false);
    asset.position.lerp(this.target, Math.min(1, delta * 4));
    asset.lookAt(this.eye);
  }

  update(delta: number): void {
    this.now += delta;
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i];
      waiter.frames--;
      if (this.now >= waiter.at && waiter.frames <= 0) {
        this.waiters.splice(i, 1);
        waiter.resolve();
      }
    }
    if (this.phase !== 'waiting') return;
    // Belt and braces: hold again on the first frame, once every system is registered.
    if (!this.heldChecked) {
      this.heldChecked = true;
      this.hold(true);
    }
    if (this.armedUntil > 0 && this.now >= this.armedUntil) this.setArmed(false);
    this.follow(delta);
  }
}
