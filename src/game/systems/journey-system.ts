/**
 * JourneySystem: the guided opening (design/JOURNEY.md). A fresh journey wakes in the
 * burning wreck; the beats run wake → door → armed → open → outside → dawn → waystation →
 * forest → camp → done (journey.ts JOURNEY_STEPS), each teaching one interaction.
 *
 * Registered in index.ts (priority 9.5). Every beat is announced on the bus as
 * { type: 'journey', step } (the guide hears 'journey:<step>'); the objectives 'escape',
 * 'waystation' and 'forest' (story.ts) complete here. Scene nodes: design/JOURNEY.md §5.
 * Verification (dev builds): globalThis.__prometheusJourney (step, door hits, wolves).
 *
 * What it owns:
 * - The day clock through the wreck: held in the grey before sunrise
 *   (DayNightSystem.holdClock) until the Hollow have been seen, then released.
 * - The jammed door: axe blows (gather-style arming, creature-ai bladeContact) on the
 *   'wreck-door-panel' of the 'wreck' scene object; DOOR.hits tear it off (journey.panelTear),
 *   and the 'wreck-door-blocker' node (a kinematic locomotion environment) sinks out of the way.
 * - The staged Hollow: visual-only 'wolf' instances (no Creature, so no AI, combat or
 *   threat gate) on WOLF_POSTS, kept outside the wreck fire's WARD and away from the player
 *   (journey.stagedGoal); they crumble at the sunrise.
 * - The wreck's fire, smoke and blinking emergency lights (shared shader uniforms), burning
 *   down once the keeper has left.
 * - Fail-safes: an axe thrown out of the closed cabin goes back to its bracket; a lenient
 *   door after DOOR.lenientAfter; reminders for an axe or a pack left behind.
 * - Continue: the beat resumes from the saved objectives (journey.resumeStep/resumePose).
 */
import {
  createSystem, eq, LocomotionSystem, Vector3, VisibilityState,
} from '@iwsdk/core';
import type { Entity, Object3D } from '@iwsdk/core';
import { bus } from '../bus.js';
import { ITEMS } from '../catalog.js';
import { GameState, Held, Item } from '../components.js';
import { bladeContact } from '../creature-ai.js';
import { pulse } from '../haptics.js';
import {
  atCamp, atWaystation, DOOR, doorDistance, doorGap, forestDone, insideCabin, JOURNEY_STEPS, panelAjar, panelTear,
  resumePose, resumeStep, STAGED, stagedGoal, TEAR_SECONDS, WARD, WAYSTATION, WOLF_POSTS, WRECK, WRECK_CLOCK,
  type JourneyProgress, type JourneyStep, type PanelPose, type XZ,
} from '../journey.js';
import { settings } from '../settings.js';
import { objectiveIndex } from '../story.js';
import { terrainHeight } from '../terrain.js';
import { wreckUniforms, type WreckUniforms } from '../../scene-assets/plane-wreck.scene-asset.js';
import { BackpackSystem } from './backpack-system.js';
import { DayNightSystem } from './daynight-system.js';
import { ItemSystem } from './item-system.js';
import { StorySystem } from './story-system.js';

/** Scene node ids the journey binds to (design/JOURNEY.md). */
export const JOURNEY_NODES = {
  wreck: 'wreck',
  blocker: 'wreck-door-blocker',
} as const;

/** Live journey state for checks (dev builds only; mutated in place, never reallocated). */
export type JourneyDebug = { step: string; doorHits: number; wolves: number; clockHeld: boolean; cues: string[] };
declare global {
  // eslint-disable-next-line no-var
  var __prometheusJourney: JourneyDebug | undefined;
}

const AXE_TIP = new Vector3(...ITEMS.axe.tip);
const DEG = Math.PI / 180;
/** Seconds after the last wolf crumbles before the wreck's flames start to die down, and how long they take. */
const BURN_DOWN_AFTER = 45;
const BURN_DOWN_SECONDS = 240;
/** Emergency lights: blink period (s) and the dim level between blinks (a steady glow with reduced flashes). */
const BLINK_PERIOD = 1.1;
const BLINK_LOW = 0.35;
/** How far (m) the door blocker sinks when the doorway opens (see openDoorway). */
const BLOCKER_SUNK = -60;

type StagedWolf = {
  entity: Entity;
  post: XZ;
  head?: Object3D;
  tail?: Object3D;
  /** Seconds until it is gone, its stagger included (-1: standing). */
  crumble: number;
  /** Its dissolve cue has sounded (as it starts to sink). */
  cued: boolean;
};

export class JourneySystem extends createSystem({
  game: { required: [GameState] },
  held: { required: [Item, Held] },
  axes: { required: [Item], where: [eq(Item, 'kind', 'axe')] },
  items: { required: [Item] },
}) {
  /** The current beat ('done' before a journey begins and after camp). */
  step: JourneyStep = 'done';
  private stepTime = 0;
  private time = 0;
  private game?: Entity;
  private wreck?: Object3D;
  private panel?: Object3D;
  private uniforms: WreckUniforms = {};
  private blocker?: Entity;
  // The door.
  private doorHits = 0;
  private doorArmed = true;
  private doorCooldown = 0;
  private doorDeg: number = DOOR.ajarDeg;
  private shake = 0;
  private firstBlowAt = -1;
  private tearClock = -1;
  private pose: PanelPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
  private tip = new Vector3();
  private tipLocal = new Vector3();
  private previousTip = new Vector3();
  private hasPreviousTip = false;
  // The Hollow, the clock and the fire.
  private wolves: StagedWolf[] = [];
  private wolvesLoading = false;
  /** Bumped by every reset: a wolf still loading from an older journey never stands. */
  private generation = 0;
  private howlIn = 0;
  private clockHeld = false;
  private outsideAt = -1;
  private burnClock = -1;
  private goal: XZ = { x: 0, z: 0 };
  // The player and the reminders.
  private viewer = new Vector3();
  private point = new Vector3();
  private pollIn = 0;
  private reminded = new Set<string>();
  private listeners = new Set<(step: string) => void>();
  private readonly debug: JourneyDebug = { step: 'done', doorHits: 0, wolves: 0, clockHeld: false, cues: [] };

  init(): void {
    this.cleanupFuncs.push(
      this.queries.game.subscribe('qualify', (entity) => { this.game = entity; }, true),
      this.queries.game.subscribe('disqualify', (entity) => { if (this.game === entity) this.game = undefined; }),
      bus.on('journey-begin', (event) => (event.resumed ? this.resume() : this.begin())),
      bus.on('new-game', () => this.reset()),
      // A level (re)load brings a fresh wreck: bind its parts again.
      this.world.activeLevel.subscribe(() => { this.clearWolves(); this.bindScene(); }),
      bus.on('grab', (event) => {
        if (event.kind === 'axe' && (this.step === 'wake' || this.step === 'door')) this.advance('armed');
      }),
      bus.on('fire-lit', () => { if (this.step === 'camp') this.advance('done'); }),
      // Taking the pack up anywhere (even after skipping ahead) completes its objective.
      bus.on('pack', (event) => {
        if (event.state !== 'held' && event.state !== 'worn') return;
        if (JOURNEY_STEPS.indexOf(this.step) >= JOURNEY_STEPS.indexOf('outside')) this.story()?.complete('waystation');
      }),
      () => this.clearWolves(),
      () => { if (globalThis.__prometheusJourney === this.debug) globalThis.__prometheusJourney = undefined; },
    );
    if (import.meta.env.DEV) globalThis.__prometheusJourney = this.debug;
  }

  /** Subscribe to beat changes (the guide and toasts in phase 2 hear them on the bus instead). */
  onStep(listener: (step: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(delta: number): void {
    const visibility = this.visibilityState.peek();
    if (visibility === VisibilityState.Hidden || visibility === VisibilityState.VisibleBlurred) return;
    const dt = Math.min(delta, .1);
    this.time += dt;
    this.stepTime += dt;
    this.animateWreck(dt);
    this.updateWolves(dt);
    const debug = this.debug;
    debug.step = this.step;
    debug.doorHits = this.doorHits;
    debug.wolves = this.wolves.length;
    debug.clockHeld = this.clockHeld;
    if (this.step === 'done') return;
    this.camera.getWorldPosition(this.viewer);
    const x = this.viewer.x, z = this.viewer.z;
    switch (this.step) {
      case 'wake':
        if (doorDistance(x, z) < DOOR.near) this.advance('door');
        this.guardAxe();
        break;
      case 'door':
        this.guardAxe();
        break;
      case 'armed':
        this.strikeDoor(delta);
        this.guardAxe();
        break;
      case 'open':
        this.animateTear(dt);
        if (!insideCabin(x, z)) this.advance('outside');
        break;
      case 'outside':
        this.animateTear(dt);
        this.holdTheDawn(x, z);
        break;
      case 'dawn':
        if (atWaystation(x, z)) this.advance('waystation');
        // Straight to camp, past the waystation: the journey follows (the pack's objective waits).
        else if (atCamp(x, z)) this.advance('camp');
        this.remindAxe(x, z);
        break;
      case 'waystation':
        this.waitForPack(x, z);
        break;
      case 'forest':
        this.gatherForest(dt, x, z);
        break;
      case 'camp':
        break;
      default:
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────── beats

  private advance(step: JourneyStep): void {
    if (JOURNEY_STEPS.indexOf(step) <= JOURNEY_STEPS.indexOf(this.step) && this.step !== 'done') return;
    this.step = step;
    this.stepTime = 0;
    switch (step) {
      case 'open':
        this.tearClock = 0;
        this.openDoorway();
        void this.stageWolves();
        break;
      case 'outside':
        this.outsideAt = this.time;
        this.story()?.complete('escape');
        break;
      case 'waystation':
        break;
      case 'forest':
        this.story()?.complete('waystation');
        break;
      case 'camp':
        this.story()?.complete('forest');
        break;
      default:
        break;
    }
    this.announce(step);
  }

  private announce(step: string): void {
    this.debug.step = this.step;
    this.debug.cues.push(step);
    for (const listener of this.listeners) listener(step);
    bus.emit({ type: 'journey', step });
  }

  /** A fresh journey: the seat, the jammed door, the axe on its bracket, the clock held before sunrise. */
  private begin(): void {
    this.reset();
    this.bindScene();
    this.holdClock(true);
    this.step = 'wake';
    this.stepTime = 0;
    this.announce('wake');
  }

  /** Continue: replay from the last completed objective. */
  private resume(): void {
    this.reset();
    this.bindScene();
    const step = resumeStep(this.progress());
    const pose = resumePose(step);
    if (step !== 'wake') this.doorTornAlready();
    if (pose) {
      this.point.set(pose.x, terrainHeight(pose.x, pose.z), pose.z);
      if (step === 'wake') this.point.y = WRECK.origin.y + WRECK.deckY;
      this.world.getSystem(LocomotionSystem)?.setPlayerPosition(this.point);
      // Phase 2: turn the rig to pose.yawDeg (this.player.rotation.y) once snap-turn state allows it.
    }
    if (step === 'wake') this.holdClock(true);
    if (step !== 'wake') this.burnClock = BURN_DOWN_AFTER;
    this.step = step;
    this.stepTime = 0;
    this.announce(step);
  }

  /**
   * Fixture for checks that start at camp (vitexec's skipOpening): the journey as if walked —
   * its objectives done, the door down, the Hollow gone, the clock released to morning, and
   * the keeper standing at camp. Logged by the caller as a fixture.
   */
  skipToCamp(): void {
    // Release the clock begin() held before sunrise (reset only forgets its own hold).
    this.holdClock(false);
    this.reset();
    this.bindScene();
    this.doorTornAlready();
    const story = this.story();
    for (const id of ['escape', 'waystation', 'forest']) story?.complete(id);
    this.burnClock = BURN_DOWN_AFTER + BURN_DOWN_SECONDS;
    this.world.getSystem(LocomotionSystem)?.setPlayerPosition(this.point.set(0, 0, .4));
    this.step = 'done';
    this.announce('done');
  }

  private reset(): void {
    // A new journey on the same level: the door blocker stands in the doorway again.
    const blocker = this.blocker?.object3D;
    if (blocker && blocker.position.y < BLOCKER_SUNK / 2) blocker.position.y -= BLOCKER_SUNK;
    this.step = 'done';
    this.stepTime = 0;
    this.doorHits = 0;
    this.doorArmed = true;
    this.doorCooldown = 0;
    this.doorDeg = DOOR.ajarDeg;
    this.shake = 0;
    this.firstBlowAt = -1;
    this.tearClock = -1;
    this.hasPreviousTip = false;
    this.outsideAt = -1;
    this.burnClock = -1;
    this.reminded.clear();
    this.generation++;
    // StartSystem owns the clock hold across a reset (it holds the world through the fade).
    this.clockHeld = false;
    this.clearWolves();
  }

  private progress(): JourneyProgress {
    const mask = this.game?.getValue(GameState, 'objectives') ?? 0;
    const done = (id: string) => {
      const index = objectiveIndex(id);
      // Before phase 2 adds the objectives, a save counts as past the journey.
      return index < 0 || (mask & (1 << index)) !== 0;
    };
    return { escape: done('escape'), waystation: done('waystation'), forest: done('forest') };
  }

  private story(): StorySystem | undefined {
    return this.world.getSystem(StorySystem);
  }

  private holdClock(on: boolean): void {
    const daynight = this.world.getSystem(DayNightSystem);
    if (this.clockHeld === on || !daynight) return;
    this.clockHeld = on;
    daynight.holdClock = on;
  }

  // ─────────────────────────────────────────────────────────────── the scene

  private bindScene(): void {
    this.wreck = this.world.getSceneObject(JOURNEY_NODES.wreck);
    this.panel = this.wreck?.getObjectByName('wreck-door-panel');
    this.uniforms = this.wreck ? wreckUniforms(this.wreck) : {};
    this.blocker = this.world.getSceneEntity(JOURNEY_NODES.blocker);
    if (this.panel) this.setPanel(panelAjar(DOOR.ajarDeg, this.pose));
  }

  private setPanel(pose: PanelPose): void {
    if (!this.panel) return;
    this.panel.position.set(pose.x, pose.y, pose.z);
    this.panel.rotation.set(pose.rx, pose.ry, pose.rz);
  }

  /**
   * Let the keeper out: the door blocker is a kinematic locomotion environment (the scene
   * authors it so), which the engine re-reads every frame, so sinking it far below the
   * ground clears the doorway. Removing its LocomotionEnvironment would not: IWSDK 0.5.3
   * reads the engine handle only after the component (and its handle) is gone.
   */
  private openDoorway(): void {
    const object = this.blocker?.object3D;
    if (object && object.position.y > BLOCKER_SUNK / 2) object.position.y += BLOCKER_SUNK;
  }

  /** A resumed journey past the wreck: the door already lies outside as a ramp. */
  private doorTornAlready(): void {
    this.tearClock = TEAR_SECONDS;
    this.setPanel(panelTear(TEAR_SECONDS, -40, this.pose));
    this.openDoorway();
  }

  // ─────────────────────────────────────────────────────────────── the door

  /** Axe blows on the jammed panel: measured like GatherSystem (the swing in the rig's frame). */
  private strikeDoor(delta: number): void {
    this.doorCooldown = Math.max(0, this.doorCooldown - delta);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - delta);
      const wobble = Math.sin(this.shake * 60) * this.shake * 6;
      this.setPanel(panelAjar(this.doorDeg + wobble, this.pose));
    }
    let axe: Entity | undefined;
    for (const entity of this.queries.held.entities) if (entity.getValue(Item, 'kind') === 'axe') axe = entity;
    if (!axe?.object3D || delta > .15) {
      this.hasPreviousTip = false;
      return;
    }
    axe.object3D.updateWorldMatrix(true, false);
    this.tip.copy(AXE_TIP);
    axe.object3D.localToWorld(this.tip);
    this.player.updateWorldMatrix(true, false);
    this.tipLocal.copy(this.tip);
    this.player.worldToLocal(this.tipLocal);
    const speed = this.hasPreviousTip ? this.tipLocal.distanceTo(this.previousTip) / Math.max(delta, 1e-3) : 0;
    this.previousTip.copy(this.tipLocal);
    this.hasPreviousTip = true;
    const gap = doorGap(this.tip.x - WRECK.origin.x, this.tip.y - WRECK.origin.y, this.tip.z - WRECK.origin.z);
    // After one real blow and a long struggle, any touch will do.
    const lenient = this.firstBlowAt >= 0 && this.time - this.firstBlowAt > DOOR.lenientAfter;
    const contact = bladeContact(gap, lenient ? Infinity : speed, this.doorArmed && this.doorCooldown === 0, DOOR.contact, DOOR.rearm, DOOR.bladeSpeed);
    if (contact === 'rearm') {
      this.doorArmed = true;
      return;
    }
    if (contact !== 'blow') {
      // A slow touch: the guide says "harder", once (phase 2: bus 'journey' step 'door-glance').
      if (gap < DOOR.contact && this.doorArmed && speed > .3 && !this.reminded.has('glance')) {
        this.reminded.add('glance');
        this.announce('door-glance');
      }
      return;
    }
    this.doorArmed = false;
    this.doorCooldown = DOOR.cooldown;
    this.doorHits++;
    if (this.firstBlowAt < 0) this.firstBlowAt = this.time;
    this.doorDeg += DOOR.kickDeg;
    this.shake = DOOR.shakeSeconds;
    pulse(this.input, this.world.getSystem(ItemSystem)?.handOf(axe), 1, 80);
    // Phase 2: audio-map plays a metal clank for kind 'wreck-door'.
    bus.emit({ type: 'thud', kind: 'wreck-door', x: this.tip.x, y: this.tip.y, z: this.tip.z });
    if (this.doorHits >= DOOR.hits) this.advance('open');
  }

  private animateTear(dt: number): void {
    if (this.tearClock < 0 || this.tearClock >= TEAR_SECONDS) return;
    this.tearClock = Math.min(TEAR_SECONDS, this.tearClock + dt);
    this.setPanel(panelTear(this.tearClock, this.doorDeg, this.pose));
    if (this.tearClock >= TEAR_SECONDS) {
      const x = WRECK.origin.x + this.pose.x, z = WRECK.origin.z + this.pose.z;
      bus.emit({ type: 'drop', kind: 'wreck-door', x, y: WRECK.origin.y + this.pose.y, z, hard: true });
    }
  }

  /**
   * While the door is shut, an axe dropped or thrown out through the hull (items pass
   * through walls) returns to its bracket.
   */
  private guardAxe(): void {
    for (const axe of this.queries.axes.entities) {
      const object = axe.object3D;
      if (!object || axe.hasComponent(Held) || (axe.getValue(Item, 'slot') ?? '') !== '') continue;
      if (insideCabin(object.position.x, object.position.z)) continue;
      if (Math.hypot(object.position.x - WRECK.origin.x, object.position.z - WRECK.origin.z) > 25) continue;
      object.position.set(WRECK.origin.x + WRECK.axe.x, WRECK.origin.y + WRECK.axe.y, WRECK.origin.z + WRECK.axe.z);
      object.rotation.set(-90 * DEG, 0, -90 * DEG);
    }
  }

  // ─────────────────────────────────────────────────────────────── outside and the dawn

  /**
   * Outside: the clock stays in the grey until the axe is holstered (or releaseAfter s),
   * then the sun rises; at WRECK_CLOCK.sunrise the watching Hollow crumble. Leaving the
   * ward far behind before that crumbles them early, out of sight.
   */
  private holdTheDawn(x: number, z: number): void {
    const since = this.time - this.outsideAt;
    const holstered = this.axeHolstered();
    if (this.clockHeld && (holstered || since > WRECK_CLOCK.releaseAfter)) this.holdClock(false);
    const clock = this.game?.getValue(GameState, 'clock') ?? 0;
    const away = Math.hypot(x - WARD.x, z - WARD.z) > STAGED.leaveRadius;
    if (!this.clockHeld && (clock >= WRECK_CLOCK.sunrise || clock < WRECK_CLOCK.start - 60) || away) {
      this.crumbleWolves();
      this.burnClock = 0;
      this.advance('dawn');
    }
  }

  private axeHolstered(): boolean {
    for (const axe of this.queries.axes.entities) if ((axe.getValue(Item, 'slot') ?? '').startsWith('hip-')) return true;
    return false;
  }

  /** The axe left lying behind (not held, packed or holstered) once the keeper is well away. */
  private remindAxe(x: number, z: number): void {
    if (this.reminded.has('axe')) return;
    for (const axe of this.queries.axes.entities) {
      const object = axe.object3D;
      if (!object || axe.hasComponent(Held) || (axe.getValue(Item, 'slot') ?? '') !== '') return;
      if (Math.hypot(object.position.x - x, object.position.z - z) > 12) {
        this.reminded.add('axe');
        this.announce('axe-left');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────── waystation and forest

  private waitForPack(x: number, z: number): void {
    const pack = this.world.getSystem(BackpackSystem);
    if (pack?.owned) {
      this.advance('forest');
      return;
    }
    const far = Math.hypot(x - WAYSTATION.table.x, z - WAYSTATION.table.z) > WAYSTATION.forgotten;
    if (far && !this.reminded.has('pack')) {
      this.reminded.add('pack');
      this.announce('pack-left');
    }
    // Skipping the pack never blocks the journey: camp still counts.
    if (atCamp(x, z)) this.advance('camp');
  }

  /** Firewood and mushrooms carried (held, holstered or packed), polled twice a second. */
  private gatherForest(dt: number, x: number, z: number): void {
    if (atCamp(x, z)) {
      this.advance('camp');
      return;
    }
    this.pollIn -= dt;
    if (this.pollIn > 0) return;
    this.pollIn = .5;
    let logs = 0, mushrooms = 0;
    for (const item of this.queries.items.entities) {
      const kind = item.getValue(Item, 'kind');
      if (kind !== 'log' && kind !== 'mushroom') continue;
      const slot = item.getValue(Item, 'slot') ?? '';
      if (!(item.hasComponent(Held) || slot.startsWith('pack-') || slot.startsWith('hip-'))) continue;
      if (kind === 'log') logs++;
      else mushrooms++;
    }
    if (forestDone(logs, mushrooms) && !this.reminded.has('forest')) {
      this.reminded.add('forest');
      this.announce('forest-done');
    }
  }

  // ─────────────────────────────────────────────────────────────── the staged Hollow

  private async stageWolves(): Promise<void> {
    if (this.wolves.length || this.wolvesLoading) return;
    this.wolvesLoading = true;
    const level = this.world.activeLevel.peek();
    const generation = this.generation;
    try {
      for (let i = 0; i < WOLF_POSTS.length; i++) {
        const object = await this.world.assets.instantiate('wolf');
        // A reset or level swap while loading: this wolf belongs to no journey.
        if (this.world.activeLevel.peek() !== level || this.generation !== generation) return;
        const post = WOLF_POSTS[i];
        object.position.set(post.x, terrainHeight(post.x, post.z), post.z);
        object.rotation.y = Math.atan2(WARD.x - post.x, WARD.z - post.z);
        const entity = this.world.createTransformEntity(object);
        this.wolves.push({ entity, post, head: object.getObjectByName('head'), tail: object.getObjectByName('tail'), crumble: -1, cued: false });
      }
      this.howlIn = 1.5;
    } catch (error) {
      console.warn('[Prometheus] staged Hollow failed to load', error);
    } finally {
      this.wolvesLoading = false;
    }
  }

  /** Pace, watch the player, howl now and then; crumble into the ground at the sunrise. */
  private updateWolves(dt: number): void {
    if (!this.wolves.length) return;
    this.camera.getWorldPosition(this.viewer);
    for (let i = this.wolves.length - 1; i >= 0; i--) {
      const wolf = this.wolves[i];
      const object = wolf.entity.object3D;
      if (!object) continue;
      if (wolf.crumble >= 0) {
        wolf.crumble -= dt;
        if (wolf.crumble <= 0) {
          wolf.entity.dispose();
          this.wolves.splice(i, 1);
          continue;
        }
        // Waits out its stagger, then sinks into the ground as ash.
        const t = 1 - Math.min(1, wolf.crumble / STAGED.crumbleSeconds);
        if (t > 0 && !wolf.cued) {
          wolf.cued = true;
          bus.emit({ type: 'creature', species: 'wolf', cue: 'dissolve', x: object.position.x, y: object.position.y, z: object.position.z });
        }
        object.position.y = terrainHeight(object.position.x, object.position.z) - .5 * t * t;
        continue;
      }
      stagedGoal(wolf.post, i, this.time, this.viewer.x, this.viewer.z, this.goal);
      const dx = this.goal.x - object.position.x, dz = this.goal.z - object.position.z, d = Math.hypot(dx, dz);
      if (d > .05) {
        const step = Math.min(d, STAGED.speed * dt);
        object.position.x += dx / d * step;
        object.position.z += dz / d * step;
        object.position.y = terrainHeight(object.position.x, object.position.z);
      }
      // Face the fire, the head turned toward the keeper.
      object.rotation.y = Math.atan2(WARD.x - object.position.x, WARD.z - object.position.z);
      if (wolf.head) {
        const look = Math.atan2(this.viewer.x - object.position.x, this.viewer.z - object.position.z) - object.rotation.y;
        wolf.head.rotation.y = Math.max(-.8, Math.min(.8, Math.atan2(Math.sin(look), Math.cos(look))));
      }
      if (wolf.tail) wolf.tail.rotation.y = .25 * Math.sin(this.time * 2.1 + i);
    }
    this.howlIn -= dt;
    if (this.howlIn <= 0 && this.wolves.length) {
      const [lo, hi] = STAGED.howlSeconds;
      this.howlIn = lo + Math.random() * (hi - lo);
      const wolf = this.wolves[Math.floor(Math.random() * this.wolves.length)];
      const at = wolf.entity.object3D?.position;
      if (at && wolf.crumble < 0) bus.emit({ type: 'creature', species: 'wolf', cue: 'howl', x: at.x, y: at.y, z: at.z });
    }
  }

  /** One after another, STAGED.crumbleStagger apart. */
  private crumbleWolves(): void {
    this.wolves.forEach((wolf, i) => {
      if (wolf.crumble < 0) wolf.crumble = STAGED.crumbleSeconds + i * STAGED.crumbleStagger;
    });
  }

  private clearWolves(): void {
    for (const wolf of this.wolves) if (wolf.entity.active) wolf.entity.dispose();
    this.wolves.length = 0;
  }

  // ─────────────────────────────────────────────────────────────── the wreck's fire

  /** Flames and smoke move; the emergency lights blink (steady with reduced flashes); later the fire burns down. */
  private animateWreck(dt: number): void {
    const u = this.uniforms;
    if (u.time) u.time.value = this.time;
    if (u.smokeTime) u.smokeTime.value = this.time;
    if (u.lamps) {
      const phase = (this.time % BLINK_PERIOD) / BLINK_PERIOD;
      const level = settings.reduceFlashes ? .8 : phase < .5 ? 1 : BLINK_LOW;
      u.lamps.color.setScalar(level);
    }
    if (this.burnClock < 0) return;
    this.burnClock += dt;
    const k = 1 - Math.min(1, Math.max(0, (this.burnClock - BURN_DOWN_AFTER) / BURN_DOWN_SECONDS));
    // Embers and a thin smoke linger when the flames are gone.
    if (u.intensity) u.intensity.value = k;
    if (u.glow) u.glow.value = .25 + .75 * k;
    if (u.smoke) u.smoke.value = .35 + .65 * k;
  }
}

