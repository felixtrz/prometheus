import { createSystem, Entity, LocomotionSystem, Vector3, VisibilityState } from '@iwsdk/core';
import { bus } from '../bus.js';
import { itemInfo, ROAST_FOOD } from '../catalog.js';
import { Campfire, GameState, Held, Item } from '../components.js';
import { pulse } from '../haptics.js';
import { stewHealing, stewName } from '../recipes.js';
import { CAMP, SURVIVAL, THROW } from '../rules.js';
import { BackpackSystem } from './backpack-system.js';
import { ItemSystem } from './item-system.js';

const DEATH_SECONDS = 2.5;
/** Starving costs health in discrete, clearly signalled ticks (flash, pulse, grunt), not a silent drain. */
const STARVE_TICK_SECONDS = 3;
/** Below this, a one-time "you're starving" warning (re-armed once fed above HUNGER_REARM). */
const HUNGER_WARN = 25;
const HUNGER_REARM = 40;
/** Bite haptics: the attacker's side, the other hand, and how far off-centre (camera-local) counts as a side. */
const BITE_NEAR = 1, BITE_FAR = .35, BITE_CENTRE = .25;
/** A starving tick: one faint pulse on the wrist (left) hand. */
const STARVE_PULSE = .15, STARVE_PULSE_MS = 25;

/**
 * Hunger, health, eating, death and respawn. Every loss of health goes through
 * `hurt` (bus 'hurt'): VignetteSystem flashes red scaled by the amount and the audio
 * plays the hurt cue. The controllers feel where it came from: a bite pulses the hand
 * on the attacker's side hard and the other lightly; a starving tick is one faint tick
 * on the wrist hand, never a buzz in both. Held still by StartSystem until a journey begins.
 *
 * A bowl of stew leaves the player well fed for SURVIVAL.wellFedSeconds (bus
 * 'well-fed' {seconds}: sent when it starts, and {seconds: 0} whenever it ends: worn
 * off, death, or a new journey): hunger drains slower and health mends anywhere.
 * The camp fire relighting on respawn is CampfireSystem's (it answers 'respawn').
 */
export class SurvivalSystem extends createSystem({
  game: { required: [GameState] },
  held: { required: [Item, Held] },
  fires: { required: [Campfire] },
}) {
  private mouth = new Vector3();
  private point = new Vector3();
  private respawnPoint = new Vector3();
  private eatDwell = new Map<number, number>();
  private dying = 0;
  private deathSpot = new Vector3();
  private hungerWarned = false;
  private starvingWarned = false;
  private starveTimer = 0;
  /** Seconds of "well fed" left (a stew). */
  private wellFed = 0;
  private game?: Entity;
  private fire?: Entity;
  private items?: ItemSystem;
  private backpack?: BackpackSystem;
  private attacker = new Vector3();
  private facing = new Vector3();

  get state(): Entity | undefined {
    return this.game;
  }

  /** Seconds the stew's well-fed buff has left (0 when none). */
  get wellFedSeconds(): number {
    return this.wellFed;
  }

  init(): void {
    this.cleanupFuncs.push(
      this.queries.game.subscribe('qualify', (entity) => { this.game = entity; }, true),
      this.queries.game.subscribe('disqualify', (entity) => { if (this.game === entity) this.game = undefined; }),
      this.queries.fires.subscribe('qualify', (entity) => { this.fire = entity; }, true),
      this.queries.fires.subscribe('disqualify', (entity) => { if (this.fire === entity) this.fire = undefined; }),
      bus.on('hurt', (event) => this.hurt(event.amount, event.cause, event.x, event.z)),
      bus.on('new-game', () => this.resetJourney()),
      bus.on('journey-begin', () => this.resetJourney()),
      this.queries.held.subscribe('disqualify', (entity) => this.eatDwell.delete(entity.index)),
    );
  }

  /** Per-journey state: a reset world starts fed, alive and un-warned. */
  private resetJourney(): void {
    this.dying = 0;
    this.hungerWarned = this.starvingWarned = false;
    this.starveTimer = 0;
    this.endWellFed();
    this.eatDwell.clear();
  }

  /** The well-fed spell is over (worn off, death, a new journey): say so once. */
  private endWellFed(): void {
    if (this.wellFed <= 0) return;
    this.wellFed = 0;
    bus.emit({ type: 'well-fed', seconds: 0 });
  }

  hurt(amount: number, cause = '', x?: number, z?: number): void {
    const game = this.state;
    if (!game || this.dying > 0 || game.getValue(GameState, 'ended') || amount <= 0) return;
    const health = Math.max(0, (game.getValue(GameState, 'health') ?? 100) - amount);
    game.setValue(GameState, 'health', health);
    this.feelHurt(amount, cause, x, z);
    if (health <= 0) this.die(game);
  }

  /**
   * Haptics for a hurt: starving is one faint tick on the wrist hand; a blow with a
   * source (a bite's x/z) drives the hand on its side hard and the other lightly (both
   * medium when it comes from dead ahead or behind); an unplaced blow pulses both.
   */
  private feelHurt(amount: number, cause: string, x?: number, z?: number): void {
    if (cause === 'starving') {
      pulse(this.input, 'left', STARVE_PULSE, STARVE_PULSE_MS);
      return;
    }
    const strength = Math.min(1, 0.5 + amount / 40);
    const ms = Math.min(220, 70 + amount * 6);
    if (x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z)) {
      pulse(this.input, 'left', strength, ms);
      pulse(this.input, 'right', strength, ms);
      return;
    }
    // Where the blow came from, across the way the head faces (yaw only: looking down changes nothing).
    this.camera.getWorldPosition(this.attacker);
    const dx = x - this.attacker.x, dz = z - this.attacker.z;
    this.camera.getWorldDirection(this.facing);
    const fl = Math.hypot(this.facing.x, this.facing.z) || 1;
    // Right of a horizontal facing (fx, fz) is (-fz, fx).
    const across = (dx * -this.facing.z + dz * this.facing.x) / fl / (Math.hypot(dx, dz) || 1);
    if (Math.abs(across) < BITE_CENTRE) {
      pulse(this.input, 'left', strength * .75, ms);
      pulse(this.input, 'right', strength * .75, ms);
      return;
    }
    const near = across > 0 ? 'right' : 'left';
    pulse(this.input, near, BITE_NEAR * strength, ms);
    pulse(this.input, near === 'right' ? 'left' : 'right', BITE_FAR * strength, Math.round(ms * .6));
  }

  private die(game: Entity): void {
    this.dying = DEATH_SECONDS;
    this.endWellFed();
    this.camera.getWorldPosition(this.deathSpot);
    const items = this.items ??= this.world.getSystem(ItemSystem);
    for (const entity of [...this.queries.held.entities]) items?.forceRelease(entity);
    (this.backpack ??= this.world.getSystem(BackpackSystem))?.dropAt(this.deathSpot.x, this.deathSpot.z);
    game.setValue(GameState, 'deaths', (game.getValue(GameState, 'deaths') ?? 0) + 1);
    bus.emit({ type: 'death', x: this.deathSpot.x, y: this.deathSpot.y, z: this.deathSpot.z });
  }

  private respawn(game: Entity): void {
    const spawn = game.getVectorView(GameState, 'respawn');
    this.respawnPoint.set(spawn[0], spawn[1], spawn[2]);
    this.world.getSystem(LocomotionSystem)?.setPlayerPosition(this.respawnPoint);
    game.setValue(GameState, 'hunger', Math.max(game.getValue(GameState, 'hunger') ?? 0, SURVIVAL.respawnHunger));
    game.setValue(GameState, 'health', SURVIVAL.respawnHealth);
    this.starveTimer = 0;
    bus.emit({ type: 'respawn', x: spawn[0], y: spawn[1], z: spawn[2] });
  }

  update(delta: number): void {
    const game = this.state;
    if (!game) return;
    if (this.dying > 0) {
      this.dying -= delta;
      if (this.dying <= 0) this.respawn(game);
      return;
    }
    const visibility = this.visibilityState.peek();
    if (visibility === VisibilityState.VisibleBlurred || visibility === VisibilityState.Hidden) return;
    const dt = Math.min(delta, .25);
    this.camera.getWorldPosition(this.mouth);
    if (this.mouth.y < THROW.killY) {
      this.respawn(game);
      return;
    }

    const drain = SURVIVAL.hungerPerSecond * (this.wellFed > 0 ? SURVIVAL.wellFedHunger : 1);
    let hunger = Math.max(0, (game.getValue(GameState, 'hunger') ?? 0) - drain * dt);
    let health = game.getValue(GameState, 'health') ?? 100;
    const fire = this.fire;
    const nearFire = fire?.getValue(Campfire, 'lit') &&
      Math.hypot(this.mouth.x - CAMP.fire.x, this.mouth.z - CAMP.fire.z) < SURVIVAL.regenRadius;
    if (hunger > 50 && nearFire) health = Math.min(100, health + SURVIVAL.regenPerSecond * dt);
    if (this.wellFed > 0) {
      // Well fed: mending anywhere, on top of the fire's warmth.
      health = Math.min(100, health + SURVIVAL.wellFedRegenPerSecond * dt);
      if (this.wellFed <= dt) this.endWellFed();
      else this.wellFed -= dt;
    }

    // Eating: hold food at the mouth for a moment.
    this.mouth.y -= .12;
    for (const entity of this.queries.held.entities) {
      const kind = entity.getValue(Item, 'kind') ?? '';
      const variant = entity.getValue(Item, 'variant') ?? '';
      const edible = kind === 'bowl' ? variant !== '' && variant !== 'empty' : (itemInfo(kind)?.food ?? 0) > 0;
      if (!edible || !entity.object3D) continue;
      entity.object3D.getWorldPosition(this.point);
      if (this.point.distanceTo(this.mouth) > SURVIVAL.eatRadius) {
        this.eatDwell.set(entity.index, 0);
        continue;
      }
      const dwell = (this.eatDwell.get(entity.index) ?? 0) + dt;
      this.eatDwell.set(entity.index, dwell);
      if (dwell < SURVIVAL.eatSeconds) continue;
      this.eatDwell.set(entity.index, 0);
      const items = this.items ??= this.world.getSystem(ItemSystem)!;
      let gain: number;
      if (kind === 'bowl') {
        gain = entity.getValue(Item, 'charges') ?? 40;
        health = Math.min(100, health + stewHealing(variant));
        entity.setValue(Item, 'charges', 0);
        items.setVariant(entity, 'empty');
        this.wellFed = SURVIVAL.wellFedSeconds;
        bus.emit({ type: 'well-fed', seconds: SURVIVAL.wellFedSeconds });
        bus.emit({
          type: 'toast', text: `${stewName(variant)}. Warm, and filling.`, tone: 'good',
          body: `Well fed: for ${SURVIVAL.wellFedSeconds} s you mend as you go and hunger comes slower.`,
        });
      } else {
        gain = kind === 'meat' && variant === 'roast' ? ROAST_FOOD : itemInfo(kind)?.food ?? 0;
        items.consume(entity);
        if (kind === 'meat' && variant !== 'roast') bus.emit({ type: 'toast', text: 'Raw meat. It would be better roasted.', tone: 'info' });
      }
      hunger = Math.min(100, hunger + gain);
      pulse(this.input, items.handOf(entity), .3, 60);
      bus.emit({ type: 'eat', kind, hunger });
    }
    game.setValue(GameState, 'hunger', hunger);
    game.setValue(GameState, 'health', Math.max(0, health));
    if (health <= 0) {
      this.die(game);
      return;
    }
    this.hungerCues(hunger, dt);
  }

  /** Warn once as hunger runs low; once empty, every few seconds costs health through `hurt`. */
  private hungerCues(hunger: number, dt: number): void {
    if (hunger > HUNGER_REARM) this.hungerWarned = false;
    if (hunger > 0) {
      this.starvingWarned = false;
      this.starveTimer = 0;
    }
    if (hunger < HUNGER_WARN && !this.hungerWarned) {
      this.hungerWarned = true;
      bus.emit({
        type: 'toast', tone: 'warn', text: 'You’re starving — eat something',
        body: 'Berries, meat or a hot stew. When hunger runs out, you lose health.',
      });
    }
    if (hunger > 0) return;
    if (!this.starvingWarned) {
      this.starvingWarned = true;
      bus.emit({ type: 'toast', tone: 'warn', text: 'Starving: you are losing health', body: 'Eat now. Every few seconds without food hurts.', hold: 5 });
    }
    this.starveTimer += dt;
    if (this.starveTimer >= STARVE_TICK_SECONDS) {
      this.starveTimer -= STARVE_TICK_SECONDS;
      // After the frame's writes: `hurt` reads and lowers the stored health itself.
      bus.emit({ type: 'hurt', amount: SURVIVAL.starveDamagePerSecond * STARVE_TICK_SECONDS, cause: 'starving' });
    }
  }
}
