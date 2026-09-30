import { createSystem, Entity, InputComponent, Vector3, VisibilityState } from '@iwsdk/core';
import { bus } from '../bus.js';
import { itemInfo, ITEMS, TOOLS } from '../catalog.js';
import { Campfire, Creature, GameState, Held, Item } from '../components.js';
import { pulse } from '../haptics.js';
import { isStewIngredient, stewId, stewName, stewValue } from '../recipes.js';
import { CAMP, DANGER, inFire, inFireRing, inPot, respawnFuelFor, stirTravel, SURVIVAL } from '../rules.js';
import { objectiveIndex } from '../story.js';
import { ItemSystem } from './item-system.js';

const LIGHTER_TIP = new Vector3(...ITEMS.lighter.tip);
const TORCH_TIP = new Vector3(...ITEMS.torch.tip);
const SPOON_TIP = new Vector3(...ITEMS.spoon.tip);

const LIGHT_FIRE = objectiveIndex('light-fire');

/**
 * The campfire and its pot: fuel, ignition, cooking, roasting, lighting torches.
 * "The fire kept you": on a respawn a cold or nearly dead camp fire (once the player
 * has lit it at least once) is relit with rules.respawnFuelFor(stage) (more once the
 * Hollow smother it), so waking never starts another death in the dark. After the ending the valley is warm again: the
 * camp fire (relit by the ending) no longer burns down.
 */
export class CampfireSystem extends createSystem({
  fires: { required: [Campfire] },
  held: { required: [Item, Held] },
  items: { required: [Item] },
  creatures: { required: [Creature] },
  game: { required: [GameState] },
}) {
  private smotherAnnounced = false;
  private point = new Vector3();
  private other = new Vector3();
  private previousAngle = 0;
  private previousStirValid = false;
  private stirSinceCue = 0;
  private igniteDwell = 0;
  private torchDwell = new Map<number, number>();
  private roastDwell = new Map<number, number>();
  private warned = new Map<string, number>();
  private elapsed = 0;
  private lowFuelWarned = false;
  private fireEntity?: Entity;
  private game?: Entity;
  private items!: ItemSystem;

  get fire(): Entity | undefined {
    return this.fireEntity;
  }

  init(): void {
    const items = this.world.getSystem(ItemSystem);
    if (!items) throw new Error('CampfireSystem requires ItemSystem');
    this.items = items;
    this.cleanupFuncs.push(
      this.queries.fires.subscribe('qualify', (entity) => { this.fireEntity = entity; }, true),
      this.queries.fires.subscribe('disqualify', (entity) => { if (this.fireEntity === entity) this.fireEntity = undefined; }),
      this.queries.game.subscribe('qualify', (entity) => { this.game = entity; }, true),
      this.queries.game.subscribe('disqualify', (entity) => { if (this.game === entity) this.game = undefined; }),
      bus.on('respawn', () => this.relightOnRespawn()),
      // Journey-scoped warnings start over with each journey.
      bus.on('journey-begin', () => {
        this.warned.clear();
        this.lowFuelWarned = this.smotherAnnounced = false;
      }),
      items.addReleaseTarget(20, (entity, kind, at, _v, hand) => this.releaseIntoPot(entity, kind, at, hand)),
      items.addReleaseTarget(30, (entity, kind, at) => this.releaseIntoFire(entity, kind, at)),
      this.queries.held.subscribe('disqualify', (entity) => {
        this.torchDwell.delete(entity.index);
        this.roastDwell.delete(entity.index);
        if (entity.active && entity.hasComponent(Item) && entity.getValue(Item, 'kind') === 'lighter') {
          entity.setValue(Item, 'lit', false);
          entity.object3D?.getWorldPosition(this.point);
          bus.emit({ type: 'lighter', lit: false, x: this.point.x, y: this.point.y, z: this.point.z });
        }
      }),
    );
  }

  private warn(key: string, text: string, every = 8): void {
    const last = this.warned.get(key) ?? -Infinity;
    if (this.elapsed - last < every) return;
    this.warned.set(key, this.elapsed);
    bus.emit({ type: 'toast', text, tone: 'warn' });
  }

  private releaseIntoPot(entity: Entity, kind: string, at: Vector3, hand: 'left' | 'right' | undefined): boolean {
    const fire = this.fire;
    if (!fire || !inPot(at.x, at.y, at.z)) return false;
    const items = this.items;
    const potA = fire.getValue(Campfire, 'potA') ?? '';
    const potB = fire.getValue(Campfire, 'potB') ?? '';
    const cooked = kind === 'meat' && entity.getValue(Item, 'variant') === 'roast';
    if (!isStewIngredient(kind) || cooked || fire.getValue(Campfire, 'stew') || (potA && potB)) {
      const reason = fire.getValue(Campfire, 'stew') ? 'Fill a bowl from the pot first.'
        : potA && potB ? 'The pot already holds two ingredients.'
          : cooked ? 'It’s already cooked. Eat it.' : 'That doesn’t belong in the stew.';
      this.warn(`pot-${reason}`, reason, 4);
      bus.emit({ type: 'reject', kind, reason, x: at.x, y: at.y, z: at.z });
      // Nudge it out over the rim so it lands beside the fire, not in it.
      this.other.set(at.x - CAMP.pot.x, 0, at.z - CAMP.pot.z);
      if (this.other.lengthSq() < 1e-4) this.other.set(0, 0, 1);
      this.other.setLength(1.4).setY(1.6);
      items.launch(entity, kind, this.other);
      return true;
    }
    fire.setValue(Campfire, potA ? 'potB' : 'potA', kind);
    fire.setValue(Campfire, 'stir', 0);
    items.consume(entity);
    pulse(this.input, hand, .3, 30);
    bus.emit({ type: 'ingredient', kind, x: at.x, y: at.y, z: at.z });
    if (potA) {
      const recipe = stewId(potA, kind);
      bus.emit({ type: 'toast', text: `${stewName(recipe)}: stir the pot with the spoon`, tone: 'info' });
    }
    return true;
  }

  private releaseIntoFire(entity: Entity, kind: string, at: Vector3): boolean {
    const fire = this.fire;
    const fuel = itemInfo(kind)?.fuel ?? 0;
    if (!fire || !fuel || TOOLS.has(kind) || kind === 'torch' || !inFireRing(at.x, at.y, at.z)) return false;
    const next = Math.min(SURVIVAL.maxFuel, (fire.getValue(Campfire, 'fuel') ?? 0) + fuel);
    fire.setValue(Campfire, 'fuel', next);
    if (next > this.lowFuelMark() + 10) this.lowFuelWarned = false;
    this.items.consume(entity);
    bus.emit({ type: 'fuel-added', kind, fuel: next });
    if (!fire.getValue(Campfire, 'lit') && !this.warned.has('cold-fuel')) {
      this.warned.set('cold-fuel', this.elapsed);
      bus.emit({ type: 'toast', tone: 'info', text: 'Wood on a cold fire', body: 'Light it with the lighter: hold the trigger at the tinder.' });
    }
    return true;
  }

  /** Fuel below which the fire warns: earlier once the Hollow smother it. */
  private lowFuelMark(): number {
    return (this.game?.getValue(GameState, 'stage') ?? 0) >= DANGER.smotherFromStage ? DANGER.lowFuelSmother : DANGER.lowFuel;
  }

  /** "The fire kept you": relight a cold or dying camp fire for the player who just woke beside it. */
  private relightOnRespawn(): void {
    const fire = this.fire, game = this.game;
    if (!fire || !game || game.getValue(GameState, 'ended')) return;
    // Only a fire the player has lit before: the opening's cold fire is theirs to light.
    if (!((game.getValue(GameState, 'objectives') ?? 0) & (1 << LIGHT_FIRE))) return;
    const lit = fire.getValue(Campfire, 'lit') === true;
    const fuel = fire.getValue(Campfire, 'fuel') ?? 0;
    const floor = respawnFuelFor(game.getValue(GameState, 'stage') ?? 0);
    if (lit && fuel >= floor) return;
    fire.setValue(Campfire, 'fuel', Math.max(fuel, floor));
    this.lowFuelWarned = false;
    if (lit) return;
    fire.setValue(Campfire, 'lit', true);
    bus.emit({ type: 'fire-lit', x: CAMP.fire.x, y: CAMP.fire.y, z: CAMP.fire.z });
  }

  /** Extra fuel per second drained by wolves within 10 m of the lit fire (stage ≥ 2). */
  private smotherRate(): number {
    const game = this.game;
    if (!game || (game.getValue(GameState, 'stage') ?? 0) < DANGER.smotherFromStage || game.getValue(GameState, 'ended')) {
      this.smotherAnnounced = false;
      return 0;
    }
    let wolves = 0;
    for (const creature of this.queries.creatures.entities) {
      if (creature.getValue(Creature, 'species') !== 'wolf' || (creature.getValue(Creature, 'health') ?? 0) <= 0) continue;
      if (creature.getValue(Creature, 'mode') === 'dying') continue;
      const p = creature.object3D?.position;
      if (p && Math.hypot(p.x - CAMP.fire.x, p.z - CAMP.fire.z) < 10) wolves++;
    }
    const rate = wolves * DANGER.smotherPerWolf;
    if (rate > 0 && !this.smotherAnnounced) {
      this.smotherAnnounced = true;
      bus.emit({ type: 'fire-smothered', rate });
      bus.emit({ type: 'toast', tone: 'warn', text: 'The Hollow are smothering the fire', body: 'Feed it logs, or drive them off.' });
    }
    if (wolves === 0) this.smotherAnnounced = false;
    return rate;
  }

  private ignite(fire: Entity): void {
    if ((fire.getValue(Campfire, 'fuel') ?? 0) <= 0) {
      this.warn('no-fuel', 'The fire needs wood first. Drop a log or stick in the ring.');
      return;
    }
    fire.setValue(Campfire, 'lit', true);
    this.lowFuelWarned = false;
    for (const entity of this.queries.held.entities) pulse(this.input, this.items.handOf(entity), .7, 90);
    bus.emit({ type: 'fire-lit', x: CAMP.fire.x, y: CAMP.fire.y, z: CAMP.fire.z });
  }

  update(delta: number): void {
    this.elapsed += delta;
    const fire = this.fire;
    if (!fire) return;
    const visibility = this.visibilityState.peek();
    const blurred = visibility === VisibilityState.VisibleBlurred || visibility === VisibilityState.Hidden;
    const paused = blurred || delta > .15;

    // Fuel burns down (not while the world is paused; a hitch still burns, clamped); from stage 2
    // the Hollow circling the fire smother it faster. After the ending it keeps.
    if (!blurred && fire.getValue(Campfire, 'lit') && !this.game?.getValue(GameState, 'ended')) {
      const smother = this.smotherRate();
      const fuel = Math.max(0, (fire.getValue(Campfire, 'fuel') ?? 0) - (SURVIVAL.fuelPerSecond + smother) * Math.min(delta, .25));
      fire.setValue(Campfire, 'fuel', fuel);
      if (fuel < this.lowFuelMark() && !this.lowFuelWarned) {
        this.lowFuelWarned = true;
        bus.emit({ type: 'toast', text: 'The fire is burning low. Feed it wood.', tone: 'warn' });
      }
      if (fuel <= 0) {
        fire.setValue(Campfire, 'lit', false);
        bus.emit({ type: 'fire-out', x: CAMP.fire.x, y: CAMP.fire.y, z: CAMP.fire.z });
      }
    }
    if (paused) {
      this.previousStirValid = false;
      this.igniteDwell = 0;
      return;
    }

    const items = this.items;
    const lit = fire.getValue(Campfire, 'lit') === true;
    let igniting = false;
    let spoonValid = false;
    for (const entity of this.queries.held.entities) {
      const object = entity.object3D;
      if (!object) continue;
      const kind = entity.getValue(Item, 'kind') ?? '';
      object.updateWorldMatrix(true, false);
      if (kind === 'lighter') {
        const hand = items.handOf(entity);
        const pad = hand ? this.input.xr.gamepads[hand] : undefined;
        const pressed = (pad?.getButtonPressed(InputComponent.Trigger) ?? false) || this.input.keyboard.getKeyPressed('KeyF');
        if (pressed !== entity.getValue(Item, 'lit')) {
          entity.setValue(Item, 'lit', pressed);
          object.getWorldPosition(this.point);
          bus.emit({ type: 'lighter', lit: pressed, x: this.point.x, y: this.point.y, z: this.point.z });
          if (pressed) pulse(this.input, hand, .2, 20);
        }
        if (pressed) {
          this.point.copy(LIGHTER_TIP);
          object.localToWorld(this.point);
          if (!lit && inFire(this.point.x, this.point.y, this.point.z)) igniting = true;
          this.lightNearbyTorches(this.point, delta);
        }
      } else if (kind === 'torch') {
        this.point.copy(TORCH_TIP);
        object.localToWorld(this.point);
        const inFlame = inFire(this.point.x, this.point.y, this.point.z);
        if (entity.getValue(Item, 'lit')) {
          if (!lit && inFlame) igniting = true;
        } else if (lit && inFlame) {
          this.dwellTorch(entity, delta);
        } else {
          this.torchDwell.set(entity.index, 0);
        }
      } else if (kind === 'spoon') {
        spoonValid = this.stir(fire, object, lit);
      } else if (kind === 'bowl') {
        const stew = fire.getValue(Campfire, 'stew') ?? '';
        const variant = entity.getValue(Item, 'variant') ?? '';
        object.getWorldPosition(this.point);
        if (stew && (variant === '' || variant === 'empty') && inPot(this.point.x, this.point.y, this.point.z)) {
          const [a, b] = stew.split('+');
          entity.setValue(Item, 'charges', stewValue(a, b));
          items.setVariant(entity, stew);
          fire.setValue(Campfire, 'stew', '');
          fire.setValue(Campfire, 'servings', 0);
          fire.setValue(Campfire, 'potA', '');
          fire.setValue(Campfire, 'potB', '');
          fire.setValue(Campfire, 'stir', 0);
          pulse(this.input, items.handOf(entity), .35, 40);
          bus.emit({ type: 'bowl-filled', recipe: stew });
          bus.emit({ type: 'toast', text: `${stewName(stew)}. Bring the bowl to your mouth.`, tone: 'good' });
        }
      } else if (kind === 'meat' && entity.getValue(Item, 'variant') !== 'roast') {
        object.getWorldPosition(this.point);
        if (lit && inFire(this.point.x, this.point.y, this.point.z)) {
          const dwell = (this.roastDwell.get(entity.index) ?? 0) + delta;
          this.roastDwell.set(entity.index, dwell);
          if (dwell >= SURVIVAL.roastSeconds) {
            items.setVariant(entity, 'roast');
            this.roastDwell.set(entity.index, 0);
            pulse(this.input, items.handOf(entity), .4, 50);
            bus.emit({ type: 'roasted', x: this.point.x, y: this.point.y, z: this.point.z });
          }
        } else {
          this.roastDwell.set(entity.index, 0);
        }
      }
    }
    this.previousStirValid = spoonValid;
    this.igniteDwell = igniting ? this.igniteDwell + delta : 0;
    if (this.igniteDwell >= SURVIVAL.lighterSeconds && !lit) {
      this.igniteDwell = 0;
      this.ignite(fire);
    }
  }

  private dwellTorch(entity: Entity, delta: number): void {
    const dwell = (this.torchDwell.get(entity.index) ?? 0) + delta;
    this.torchDwell.set(entity.index, dwell);
    if (dwell < CAMP.ignitionSeconds) return;
    entity.setValue(Item, 'lit', true);
    this.torchDwell.set(entity.index, 0);
    pulse(this.input, this.items.handOf(entity), .6, 60);
    entity.object3D?.getWorldPosition(this.other);
    bus.emit({ type: 'torch-lit', x: this.other.x, y: this.other.y, z: this.other.z });
  }

  /** A lighter flame held to an unlit torch head lights it too. */
  private lightNearbyTorches(flame: Vector3, delta: number): void {
    for (const entity of this.queries.items.entities) {
      if (entity.getValue(Item, 'kind') !== 'torch' || entity.getValue(Item, 'lit')) continue;
      const object = entity.object3D;
      if (!object || !object.visible) continue;
      this.other.copy(TORCH_TIP);
      object.localToWorld(this.other);
      if (this.other.distanceTo(flame) < .12) this.dwellTorch(entity, delta);
    }
  }

  private stir(fire: Entity, spoon: import('@iwsdk/core').Object3D, lit: boolean): boolean {
    const potA = fire.getValue(Campfire, 'potA'), potB = fire.getValue(Campfire, 'potB');
    if (!potA || !potB || fire.getValue(Campfire, 'stew')) return false;
    this.point.copy(SPOON_TIP);
    spoon.localToWorld(this.point);
    const dx = this.point.x - CAMP.pot.x, dz = this.point.z - CAMP.pot.z;
    const radius = Math.hypot(dx, dz);
    const valid = inPot(this.point.x, this.point.y, this.point.z) && radius > .065 && radius < .27;
    if (!valid) return false;
    if (!lit) {
      this.warn('cold-pot', 'The pot is cold. Light the fire before stirring.');
      return false;
    }
    const angle = Math.atan2(dz, dx);
    if (this.previousStirValid) {
      const travel = stirTravel(this.previousAngle, angle);
      const progress = Math.min(CAMP.stirTarget, (fire.getValue(Campfire, 'stir') ?? 0) + travel);
      fire.setValue(Campfire, 'stir', progress);
      this.stirSinceCue += travel;
      if (this.stirSinceCue > Math.PI / 2) {
        this.stirSinceCue = 0;
        bus.emit({ type: 'stir', progress: progress / CAMP.stirTarget });
      }
      if (progress >= CAMP.stirTarget) {
        const recipe = stewId(potA, potB);
        fire.setValue(Campfire, 'stew', recipe);
        fire.setValue(Campfire, 'servings', 1);
        bus.emit({ type: 'stew-ready', recipe });
      }
    }
    this.previousAngle = angle;
    return true;
  }
}
