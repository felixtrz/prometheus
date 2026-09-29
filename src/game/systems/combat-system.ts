import {
  AdditiveBlending, Color, createSystem, Entity, Float32BufferAttribute, InputComponent, InstancedMesh, LatheGeometry,
  Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Quaternion, SphereGeometry, Vector2, Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { bus } from '../bus.js';
import { ITEMS } from '../catalog.js';
import { Airborne, Beacon, Campfire, Creature, Held, Item, Sentry } from '../components.js';
import { pulse } from '../haptics.js';
import { BOLTS_PER_BUNDLE, SENTRY_CAPACITY, SENTRY_STARTER_BOLTS, SENTRY_TIPS, sentryTips } from '../recipes.js';
import { SENTRY, sentrySpread, THROW } from '../rules.js';
import { LANDMARKS } from '../terrain.js';
import { ItemSystem } from './item-system.js';
import { CREATURE_TUNING } from './creature-system.js';
import { StorySystem } from './story-system.js';

const SPEAR_TIP = new Vector3(...ITEMS.spear.tip);
const TORCH_TIP = new Vector3(...ITEMS.torch.tip);
const CROSSBOW_CAPACITY = 8;
const BOLT_SPEED = SENTRY.boltSpeed;
const SENTRY_RANGE: number = SENTRY.range;
const SENTRY_COOLDOWN = SENTRY.cooldown;
/** A bolt still flying after this long is lost. */
const BOLT_LIFETIME = 6;
/** A landed bolt stays stuck in the ground this long: pick it up and touch it to a crossbow, sentry or bundle. */
const BOLT_PICKUP_SECONDS = 20;
/** Reach of a single bolt to a bundle it re-bundles into (m). */
const REBUNDLE_REACH = .25;
/**
 * The flame scares a wolf it reaches: within the body's hit radius plus TORCH_REACH
 * horizontally, anywhere from the wolf's feet to TORCH_HEIGHT above them (a flame thrust
 * at a wolf's face from chest height counts).
 */
const TORCH_REACH = .3;
const TORCH_HEIGHT = 1.6;
/** A torch this close to the Spire brazier while it is being lit is busy: it scares nothing (as CreatureSystem). */
const BRAZIER_BUSY = CREATURE_TUNING.wolf.brazierBusyRadius;
/** An empty sentry aimed at a wolf dry-clicks at most this often (s). */
const SENTRY_EMPTY_CLICK = 1.5;
/** After a reload the sentry re-cocks for this long before its next shot (s). */
const SENTRY_RECOCK = .4;
/** Hit sphere per species (radius, centre height above the feet), owned by the creature tuning. */
const SPECIES = CREATURE_TUNING.species as Record<string, { hitY: number; hitRadius: number }>;
const body = (species: string) => SPECIES[species] ?? SPECIES.wolf;

/**
 * Sentry dressing, built once per deployed sentry and parented to its 'turret'
 * (turret-local; the hopper lid is at y 0.178, spanning z -0.07..0.05):
 * a fan of bolt tips standing in the hopper, one per two bolts, and a lamp at the
 * back of the hopper (warm = armed, dark red = empty, blinking red = empty while a wolf is in its sights).
 */
const MAGAZINE_AT = new Vector3(0, .17, -.022);
const LAMP_AT = new Vector3(0, .193, .036);
const TIP_PROFILE = [new Vector2(0, 0), new Vector2(.004, 0), new Vector2(.004, .046), new Vector2(.0088, .046), new Vector2(0, .078)];
let tipGeometry: LatheGeometry | undefined;
const TIP_MATERIAL = new MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .25, flatShading: true });
TIP_MATERIAL.name = 'Sentry magazine bolts';
const LAMP_GEOMETRY = new SphereGeometry(.015, 12, 8);
const LAMP_ARMED = new MeshBasicMaterial({ color: 0xffa94d, toneMapped: false, fog: false });
const LAMP_EMPTY = new MeshBasicMaterial({ color: 0xa3261b, toneMapped: false, fog: false });
const LAMP_DARK = new MeshBasicMaterial({ color: 0x3a0f0b });
/** Soft glow around a lit lamp so its state reads from across camp, day or night. */
const HALO_GEOMETRY = new SphereGeometry(.04, 12, 8);
const halo = (color: number, opacity: number) =>
  new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
const HALO_ARMED = halo(0xffa94d, .2);
const HALO_EMPTY = halo(0xd0301f, .38);
/** Seconds per blink (on for half) while an empty sentry tracks a wolf. */
const LAMP_BLINK = .7;

/** Upright bolt: pale shaft, steel head. Vertex colours by lathe profile point. */
function makeTipGeometry(): LatheGeometry {
  const geometry = new LatheGeometry(TIP_PROFILE, 6);
  const shaft = new Color(0xd9b27c), head = new Color(0xc9d1d5);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const c = i % TIP_PROFILE.length >= 3 ? head : shaft;
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

/** A fired bolt the system cleans up; `generation` guards against a pooled entity reused for something else. */
type BoltRecord = { entity: Entity; generation: number; age: number; rest: number };

type SentryLook = {
  turret: Object3D; muzzle: Object3D; magazine: InstancedMesh; lamp: Mesh; halo: Mesh; hopper: Object3D | undefined; tips: number;
};

/** Spears, crossbow, bolts, the camp sentry and torch contact. */
export class CombatSystem extends createSystem({
  creatures: { required: [Creature] },
  held: { required: [Item, Held] },
  items: { required: [Item] },
  flying: { required: [Item, Airborne] },
  sentries: { required: [Sentry, Item] },
  fires: { required: [Campfire] },
  beacons: { required: [Beacon] },
}) {
  private bolts: BoltRecord[] = [];
  private emptyHints = 0;
  private sentryEmptyTaught = false;
  private looks = new Map<number, SentryLook>();
  private clock = 0;
  /** Creature index → combat clock until which it cannot be hit again by the same kind of blow. */
  private cooldowns = new Map<number, number>();
  /** Bumped on every level swap: a bolt still loading from an older level is dropped. */
  private level = 0;
  private items!: ItemSystem;
  private previousSpearTip = new Vector3();
  private hasSpearTip = false;
  private point = new Vector3();
  private other = new Vector3();
  private dir = new Vector3();
  private velocity = new Vector3();
  private center = new Vector3();
  private across = new Vector3();
  private upward = new Vector3();
  /** Sentry bolts loosed and bolt strikes on wolves this journey (for tuning and checks). */
  readonly sentryStats = { shots: 0 };

  init(): void {
    const items = this.world.getSystem(ItemSystem);
    if (!items) throw new Error('CombatSystem requires ItemSystem');
    this.items = items;
    this.cleanupFuncs.push(
      items.addReleaseTarget(50, (entity, kind, at) => this.deployRelease(entity, kind, at)),
      this.queries.held.subscribe('disqualify', () => { this.hasSpearTip = false; }),
      this.queries.sentries.subscribe('qualify', (entity) => this.dress(entity), true),
      this.queries.sentries.subscribe('disqualify', (entity) => this.undress(entity)),
      this.queries.creatures.subscribe('disqualify', (entity) => this.cooldowns.delete(entity.index)),
      this.world.activeLevel.subscribe(() => {
        this.level++;
        this.bolts.length = 0;
        this.cooldowns.clear();
      }),
      // Journey-scoped teaching starts over with each journey.
      bus.on('journey-begin', () => {
        this.emptyHints = 0;
        this.sentryEmptyTaught = false;
        this.sentryStats.shots = 0;
      }),
    );
    const story = this.world.getSystem(StorySystem);
    if (story) story.hooks.sentry = { deploy: (entity, bolts) => this.deploy(entity, bolts) };
  }

  /**
   * Release the folded kit on open ground and it unfolds into a sentry, loaded with
   * the starter bolts that came with the kit. It stands where it was let go, facing
   * the way it was carried.
   */
  private deployRelease(entity: Entity, kind: string, at: Vector3): boolean {
    if (kind !== 'sentry-kit' || entity.getValue(Item, 'variant') === 'deployed') return false;
    // Set it down low on open ground anywhere: camp, the outpost, or the Spire plateau.
    this.camera.getWorldPosition(this.other);
    if (at.y > this.other.y - .6) return false;
    const items = this.items;
    const object = entity.object3D;
    if (object) {
      this.dir.set(0, 0, -1).applyQuaternion(object.quaternion);
      const yaw = Math.hypot(this.dir.x, this.dir.z) > .2 ? Math.atan2(-this.dir.x, -this.dir.z) : 0;
      object.position.set(at.x, items.groundAt(at.x, at.z), at.z);
      object.rotation.set(0, yaw, 0);
    }
    this.deploy(entity, SENTRY_STARTER_BOLTS);
    bus.emit({ type: 'sentry-deployed', x: at.x, y: at.y, z: at.z });
    bus.emit({
      type: 'toast', tone: 'good', text: 'Sentry set',
      body: `Loaded with ${SENTRY_STARTER_BOLTS} bolts: it shoots wolves that come near. Touch bolts to it to reload.`,
    });
    return true;
  }

  /** Unfold a kit into a sentry holding `bolts` (deploy above, and save/restore via StorySystem). */
  deploy(entity: Entity, bolts: number): void {
    const items = this.items;
    items.setVariant(entity, 'deployed');
    entity.setValue(Item, 'slot', 'sentry');
    items.setAvailable(entity, true, false);
    const load = Math.max(0, Math.min(SENTRY_CAPACITY, bolts));
    if (!entity.hasComponent(Sentry)) entity.addComponent(Sentry, { bolts: load });
    else entity.setValue(Sentry, 'bolts', load);
  }

  /** Build the magazine tips and lamp on a sentry's turret (once, when it becomes a sentry). */
  private dress(entity: Entity): void {
    const turret = entity.object3D?.getObjectByName('turret');
    if (!turret || this.looks.has(entity.index)) return;
    tipGeometry ??= makeTipGeometry();
    const magazine = new InstancedMesh(tipGeometry, TIP_MATERIAL, SENTRY_TIPS);
    magazine.name = 'sentry-magazine';
    const matrix = new Matrix4(), at = new Vector3(), lean = new Quaternion(), tangent = new Vector3(), one = new Vector3(1, 1, 1);
    for (let i = 0; i < SENTRY_TIPS; i++) {
      // A small fan, each bolt leaning outward, so the count reads from any side.
      const a = (i / SENTRY_TIPS) * Math.PI * 2;
      at.set(MAGAZINE_AT.x + Math.cos(a) * .013, MAGAZINE_AT.y, MAGAZINE_AT.z + Math.sin(a) * .013);
      lean.setFromAxisAngle(tangent.set(-Math.sin(a), 0, Math.cos(a)), -.2);
      magazine.setMatrixAt(i, matrix.compose(at, lean, one));
    }
    magazine.instanceMatrix.needsUpdate = true;
    magazine.computeBoundingSphere();
    magazine.count = 0;
    magazine.visible = false;
    const lamp = new Mesh(LAMP_GEOMETRY, LAMP_DARK);
    lamp.name = 'sentry-lamp';
    lamp.position.copy(LAMP_AT);
    const glow = new Mesh(HALO_GEOMETRY, HALO_ARMED);
    glow.name = 'sentry-lamp-halo';
    glow.visible = false;
    glow.renderOrder = 2;
    lamp.add(glow);
    turret.add(magazine, lamp);
    // Optional prototype group of static bolts in the hopper: shown only while loaded.
    this.looks.set(entity.index, {
      turret, muzzle: turret.getObjectByName('muzzle') ?? turret, magazine, lamp, halo: glow,
      hopper: turret.getObjectByName('hopper-bolts'), tips: -1,
    });
  }

  private undress(entity: Entity): void {
    const look = this.looks.get(entity.index);
    if (!look) return;
    look.magazine.removeFromParent();
    look.magazine.dispose();
    look.lamp.removeFromParent();
    this.looks.delete(entity.index);
  }

  private hurt(creature: Entity, damage: number, kind: string, at: Vector3): void {
    const health = (creature.getValue(Creature, 'health') ?? 1) - damage;
    creature.setValue(Creature, 'health', health);
    const species = creature.getValue(Creature, 'species') ?? '';
    bus.emit({ type: 'hit', kind, species, killed: health <= 0, x: at.x, y: at.y, z: at.z });
  }

  private alive(creature: Entity): boolean {
    const mode = creature.getValue(Creature, 'mode');
    return (creature.getValue(Creature, 'health') ?? 0) > 0 && mode !== 'dying' && mode !== 'gone';
  }

  /** First living creature whose hit sphere contains `at` (with padding). */
  private creatureAt(at: Vector3, padding: number): Entity | undefined {
    for (const creature of this.queries.creatures.entities) {
      if (!this.alive(creature) || !creature.object3D) continue;
      const hit = body(creature.getValue(Creature, 'species') ?? '');
      const p = creature.object3D.position;
      if (Math.hypot(at.x - p.x, at.y - (p.y + hit.hitY), at.z - p.z) < hit.hitRadius + padding) return creature;
    }
    return undefined;
  }

  /** A living wolf the flame at `at` reaches (see TORCH_REACH / TORCH_HEIGHT). */
  private wolfInFlame(at: Vector3): Entity | undefined {
    const reach = body('wolf').hitRadius + TORCH_REACH;
    for (const creature of this.queries.creatures.entities) {
      if (creature.getValue(Creature, 'species') !== 'wolf' || !this.alive(creature) || !creature.object3D) continue;
      const p = creature.object3D.position;
      if (at.y < p.y - .2 || at.y > p.y + TORCH_HEIGHT) continue;
      if (Math.hypot(at.x - p.x, at.z - p.z) < reach) return creature;
    }
    return undefined;
  }

  /** The flame is held in the Spire brazier while it is being lit. */
  private inBrazier(at: Vector3): boolean {
    const b = LANDMARKS.beacon;
    if (Math.hypot(at.x - b.x, at.y - b.y, at.z - b.z) >= BRAZIER_BUSY) return false;
    for (const beacon of this.queries.beacons.entities) {
      if (beacon.getValue(Beacon, 'role') !== 'spire') continue;
      const progress = beacon.getValue(Beacon, 'progress') ?? 0;
      return progress > 0 && progress < 1 && !beacon.getValue(Beacon, 'lit');
    }
    return false;
  }

  /** True (and arms the cooldown) when this creature may take another blow now. */
  private cooledDown(creature: Entity, seconds: number): boolean {
    if ((this.cooldowns.get(creature.index) ?? 0) > this.clock) return false;
    this.cooldowns.set(creature.index, this.clock + seconds);
    return true;
  }

  update(delta: number): void {
    this.clock += delta;
    this.updateProjectiles(delta);
    const visibility = this.visibilityState.peek();
    if (visibility === VisibilityState.VisibleBlurred || visibility === VisibilityState.Hidden) return;
    const items = this.items;
    let sawSpear = false;
    for (const entity of this.queries.held.entities) {
      const object = entity.object3D;
      if (!object) continue;
      const kind = entity.getValue(Item, 'kind') ?? '';
      const hand = items.handOf(entity);
      object.updateWorldMatrix(true, false);
      if (kind === 'spear') {
        sawSpear = true;
        this.point.copy(SPEAR_TIP);
        object.localToWorld(this.point);
        const speed = this.hasSpearTip ? this.point.distanceTo(this.previousSpearTip) / Math.max(delta, 1e-3) : 0;
        this.previousSpearTip.copy(this.point);
        this.hasSpearTip = true;
        const target = speed > 2.5 ? this.creatureAt(this.point, .25) : undefined;
        if (target && this.cooledDown(target, .6)) {
          this.hurt(target, 1, 'spear', this.point);
          pulse(this.input, hand, 1, 80);
        }
      } else if (kind === 'torch' && entity.getValue(Item, 'lit')) {
        this.point.copy(TORCH_TIP);
        object.localToWorld(this.point);
        const wolf = this.inBrazier(this.point) ? undefined : this.wolfInFlame(this.point);
        if (wolf && this.cooledDown(wolf, 1)) {
          wolf.setValue(Creature, 'mode', 'scared');
          wolf.setValue(Creature, 'timer', 0);
          bus.emit({ type: 'hit', kind: 'torch', species: 'wolf', killed: false, x: this.point.x, y: this.point.y, z: this.point.z });
          pulse(this.input, hand, .7, 60);
        }
      } else if (kind === 'crossbow') {
        const pad = hand ? this.input.xr.gamepads[hand] : undefined;
        if ((pad?.getButtonDown(InputComponent.Trigger) ?? false) || this.input.keyboard.getKeyDown('KeyF')) this.fireCrossbow(entity, object, hand);
      } else if (kind === 'bolts' || kind === 'bolt') {
        this.reloadFrom(entity, object, kind === 'bolt');
      }
    }
    if (!sawSpear) this.hasSpearTip = false;
    this.updateSentries(delta);
  }

  private fireCrossbow(crossbow: Entity, object: Object3D, hand: 'left' | 'right' | undefined): void {
    const charges = crossbow.getValue(Item, 'charges') ?? 0;
    const muzzle = object.getObjectByName('muzzle');
    (muzzle ?? object).getWorldPosition(this.point);
    if (charges <= 0) {
      pulse(this.input, hand, .15, 15);
      bus.emit({ type: 'crossbow-empty', x: this.point.x, y: this.point.y, z: this.point.z });
      if (this.emptyHints < 2) {
        this.emptyHints++;
        bus.emit({ type: 'toast', tone: 'info', text: 'The crossbow is empty', body: 'Hold a bolt bundle to it with your other hand to load it.' });
      }
      return;
    }
    crossbow.setValue(Item, 'charges', charges - 1);
    this.syncLoadedBolt(crossbow);
    // The crossbow shoots along its local -Z.
    object.getWorldDirection(this.dir).negate();
    this.velocity.copy(this.dir).multiplyScalar(BOLT_SPEED);
    void this.launchBolt(this.point, this.velocity, this.dir);
    pulse(this.input, hand, .9, 70);
    bus.emit({ type: 'crossbow-fire', loaded: charges - 1, x: this.point.x, y: this.point.y, z: this.point.z });
  }

  private syncLoadedBolt(crossbow: Entity): void {
    const loaded = crossbow.object3D?.getObjectByName('loaded-bolt');
    if (loaded) loaded.visible = (crossbow.getValue(Item, 'charges') ?? 0) > 0;
  }

  private async launchBolt(from: Vector3, velocity: Vector3, direction: Vector3): Promise<void> {
    const vx = velocity.x, vy = velocity.y, vz = velocity.z;
    const x = from.x + direction.x * .05, y = from.y + direction.y * .05, z = from.z + direction.z * .05;
    const level = this.level;
    let object: Object3D;
    try {
      object = await this.world.assets.instantiate('bolt');
    } catch (error) {
      console.warn('[Prometheus] bolt spawn failed', error);
      return;
    }
    // The level was swapped while the bolt loaded: it belongs to a world that is gone.
    if (level !== this.level) return;
    const entity = this.world.createTransformEntity(object);
    object.position.set(x, y, z);
    entity.addComponent(Item, { kind: 'bolt', uid: 'rt-bolt' });
    entity.addComponent(Airborne, { damage: 2 });
    const v = entity.getVectorView(Airborne, 'velocity');
    v[0] = vx; v[1] = vy; v[2] = vz;
    this.bolts.push({ entity, generation: entity.generation, age: 0, rest: 0 });
  }

  private updateProjectiles(delta: number): void {
    for (const entity of this.queries.flying.entities) {
      const damage = entity.getValue(Airborne, 'damage') ?? 0;
      const object = entity.object3D;
      if (damage <= 0 || !object) continue;
      const kind = entity.getValue(Item, 'kind') ?? '';
      if (kind === 'spear') {
        this.point.copy(SPEAR_TIP);
        object.localToWorld(this.point);
      } else {
        object.getWorldPosition(this.point);
      }
      const target = this.creatureAt(this.point, kind === 'bolt' ? .1 : .25);
      if (!target) continue;
      this.hurt(target, damage, kind, this.point);
      entity.setValue(Airborne, 'damage', 0);
      const v = entity.getVectorView(Airborne, 'velocity');
      v[0] *= .1; v[1] = Math.min(v[1], 0) * .1; v[2] *= .1;
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      const entity = bolt.entity;
      // Disposed (and maybe pooled into another entity), picked up, or stowed: no longer ours to clean up.
      const gone = !entity.active || entity.generation !== bolt.generation || !entity.hasComponent(Item);
      if (gone || entity.hasComponent(Held) || entity.getValue(Item, 'slot') !== '') {
        this.dropBolt(i);
        continue;
      }
      bolt.age += delta;
      const flying = entity.hasComponent(Airborne);
      bolt.rest = flying ? 0 : bolt.rest + delta;
      const lost = flying ? bolt.age > BOLT_LIFETIME : bolt.rest > BOLT_PICKUP_SECONDS;
      if (lost || (entity.object3D?.position.y ?? 0) < THROW.killY) {
        this.dropBolt(i);
        entity.dispose({ disposeResources: false });
      }
    }
  }

  /** Stop tracking bolt record `i` (swap-remove, no allocation). */
  private dropBolt(i: number): void {
    const last = this.bolts.length - 1;
    if (i !== last) this.bolts[i] = this.bolts[last];
    this.bolts.length = last;
  }

  /**
   * Touch a bolt bundle (or a single bolt picked up off the ground) to a crossbow or a
   * deployed sentry to load it; a single bolt touched to a bundle with room re-bundles.
   */
  private reloadFrom(bundle: Entity, object: Object3D, single: boolean): void {
    const available = single ? 1 : bundle.getValue(Item, 'charges') ?? 0;
    if (available <= 0) return;
    object.getWorldPosition(this.point);
    let target: Entity | undefined;
    let capacity = 0;
    for (const entity of this.queries.items.entities) {
      if (entity === bundle || !entity.object3D) continue;
      const kind = entity.getValue(Item, 'kind');
      if (single && kind === 'bolts' && entity.getValue(Item, 'slot') !== 'consumed') {
        entity.object3D.getWorldPosition(this.other);
        if (this.other.distanceTo(this.point) < REBUNDLE_REACH && (entity.getValue(Item, 'charges') ?? 0) < BOLTS_PER_BUNDLE) {
          target = entity; capacity = BOLTS_PER_BUNDLE;
        }
      } else if (kind === 'crossbow') {
        entity.object3D.getWorldPosition(this.other);
        if (this.other.distanceTo(this.point) < .28 && (entity.getValue(Item, 'charges') ?? 0) < CROSSBOW_CAPACITY) {
          target = entity; capacity = CROSSBOW_CAPACITY;
        }
      } else if (kind === 'sentry-kit' && entity.hasComponent(Sentry)) {
        const turret = entity.object3D.getObjectByName('turret') ?? entity.object3D;
        turret.getWorldPosition(this.other);
        if (this.other.distanceTo(this.point) < .55 && (entity.getValue(Sentry, 'bolts') ?? 0) < SENTRY_CAPACITY) {
          target = entity; capacity = SENTRY_CAPACITY;
        }
      }
    }
    if (!target) return;
    const isSentry = target.hasComponent(Sentry);
    const current = isSentry ? target.getValue(Sentry, 'bolts') ?? 0 : target.getValue(Item, 'charges') ?? 0;
    const moved = Math.min(available, capacity - current);
    if (moved <= 0) return;
    if (isSentry) {
      target.setValue(Sentry, 'bolts', current + moved);
      target.setValue(Sentry, 'cooldown', Math.min(target.getValue(Sentry, 'cooldown') ?? 0, SENTRY_RECOCK));
    } else {
      target.setValue(Item, 'charges', current + moved);
      this.syncLoadedBolt(target);
    }
    const items = this.items;
    const left = available - moved;
    if (!single) bundle.setValue(Item, 'charges', left);
    pulse(this.input, items.handOf(bundle), .5, 40);
    bus.emit({ type: 'reload', charges: current + moved, x: this.point.x, y: this.point.y, z: this.point.z });
    if (left <= 0) items.consume(bundle);
  }

  private updateSentries(delta: number): void {
    const blinkOn = this.clock % LAMP_BLINK < LAMP_BLINK / 2;
    for (const sentry of this.queries.sentries.entities) {
      const look = this.looks.get(sentry.index);
      if (!look) continue;
      const turret = look.turret;
      const cooldown = Math.max(0, (sentry.getValue(Sentry, 'cooldown') ?? 0) - delta);
      sentry.setValue(Sentry, 'cooldown', cooldown);
      const bolts = sentry.getValue(Sentry, 'bolts') ?? 0;
      const tips = sentryTips(bolts);
      if (tips !== look.tips) {
        look.tips = tips;
        look.magazine.count = tips;
        look.magazine.visible = tips > 0;
        if (look.hopper) look.hopper.visible = bolts > 0;
      }

      // Track the nearest living wolf in range (never prey).
      turret.getWorldPosition(this.point);
      let best: Entity | undefined, bestDistance = SENTRY_RANGE;
      for (const creature of this.queries.creatures.entities) {
        if (creature.getValue(Creature, 'species') !== 'wolf' || !this.alive(creature) || !creature.object3D) continue;
        const d = this.point.distanceTo(creature.object3D.position);
        if (d < bestDistance) { best = creature; bestDistance = d; }
      }
      const lamp = bolts > 0 ? LAMP_ARMED : best && blinkOn ? LAMP_EMPTY : LAMP_DARK;
      if (look.lamp.material !== lamp) {
        look.lamp.material = lamp;
        look.halo.visible = lamp !== LAMP_DARK;
        look.halo.material = lamp === LAMP_ARMED ? HALO_ARMED : HALO_EMPTY;
      }
      if (!best?.object3D || !turret.parent) continue;

      // Aim in the turret's parent frame, so a sentry set down at any yaw tracks true.
      this.center.copy(best.object3D.position).setY(best.object3D.position.y + body('wolf').hitY);
      this.other.copy(this.center);
      turret.parent.worldToLocal(this.other);
      const desired = Math.atan2(-(this.other.x - turret.position.x), -(this.other.z - turret.position.z));
      let yaw = sentry.getValue(Sentry, 'yaw') ?? 0;
      const diff = Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw));
      yaw += Math.sign(diff) * Math.min(Math.abs(diff), delta * 3.5);
      sentry.setValue(Sentry, 'yaw', yaw);
      turret.rotation.y = yaw;
      if (Math.abs(diff) > .14 || cooldown > 0) continue;

      look.muzzle.getWorldPosition(this.other);
      if (bolts <= 0) {
        // Aimed, but nothing to shoot: a dry click, at most every SENTRY_EMPTY_CLICK seconds.
        sentry.setValue(Sentry, 'cooldown', SENTRY_EMPTY_CLICK);
        bus.emit({ type: 'sentry-empty', x: this.other.x, y: this.other.y, z: this.other.z });
        if (!this.sentryEmptyTaught) {
          this.sentryEmptyTaught = true;
          bus.emit({ type: 'toast', tone: 'warn', text: 'The sentry is empty', body: 'Touch a bolt bundle to it to reload it.', hold: 6 });
        }
        continue;
      }
      sentry.setValue(Sentry, 'bolts', bolts - 1);
      sentry.setValue(Sentry, 'cooldown', SENTRY_COOLDOWN);
      this.aimSentry(best);
      const flight = this.other.distanceTo(this.center) / BOLT_SPEED;
      this.dir.copy(this.center).sub(this.other).normalize();
      this.velocity.copy(this.dir).multiplyScalar(BOLT_SPEED);
      this.velocity.y += .5 * THROW.gravity * flight;
      void this.launchBolt(this.other, this.velocity, this.dir);
      this.sentryStats.shots++;
      bus.emit({ type: 'sentry-fire', x: this.other.x, y: this.other.y, z: this.other.z });
    }
  }

  /**
   * Where the sentry's bolt goes (into `center`; the muzzle is in `other`): it leads the
   * wolf by its speed and heading over the bolt's flight, then its aim wanders by a
   * round normal error of sentrySpread(distance, speed) across the line of fire, so it
   * mostly hits a wolf that is close or still and misses more at range or on the run.
   */
  private aimSentry(target: Entity): void {
    const speed = Math.max(0, target.getValue(Creature, 'speed') ?? 0);
    const heading = target.getValue(Creature, 'heading') ?? 0;
    const lead = this.other.distanceTo(this.center) / BOLT_SPEED * speed;
    this.center.x += Math.sin(heading) * lead;
    this.center.z += Math.cos(heading) * lead;
    const spread = sentrySpread(this.other.distanceTo(this.center), speed);
    // Two axes across the line of fire: horizontal, and the one above it.
    this.dir.copy(this.center).sub(this.other).normalize();
    this.across.set(-this.dir.z, 0, this.dir.x);
    if (this.across.lengthSq() < 1e-6) this.across.set(1, 0, 0);
    this.across.normalize();
    this.upward.crossVectors(this.across, this.dir).normalize();
    // Box-Muller: a round 2-D normal error of one-sigma `spread`.
    const r = spread * Math.sqrt(-2 * Math.log(1 - Math.random()));
    const a = Math.random() * Math.PI * 2;
    this.center.addScaledVector(this.across, r * Math.cos(a)).addScaledVector(this.upward, r * Math.sin(a));
  }
}
