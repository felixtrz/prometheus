import { createSystem, Entity, Mesh, Object3D, Quaternion, TorusGeometry, Vector3 } from '@iwsdk/core';
import { bus } from '../bus.js';
import { HIP_SIDE, HIP_SLOTS, hipIndex } from '../carry.js';
import { itemInfo } from '../catalog.js';
import { Held, Item } from '../components.js';
import { pulse } from '../haptics.js';
import { BackpackSystem } from './backpack-system.js';
import { cuePulse, glowMaterial, TextLabel } from './carry-cues.js';
import { ItemSystem, type Hand } from './item-system.js';

const HANDS: readonly Hand[] = ['left', 'right'];
const Z_AXIS = new Vector3(0, 0, 1);
const Y_AXIS = new Vector3(0, 1, 0);
/** Hip holster from the eyes in the body frame (x right, y up, z behind); the side comes from HIP_SIDE. */
const HIP_X = .21;
const HIP_Y = -.64;
const HIP_Z = -.02;
/** A hand holding an item within this of a free holster puts it there on letting go (m). */
const SNAP_REACH = .16;
/** Within this, the holster's ring shows faintly: something could go here. */
const SHOW_REACH = .45;
/** Seconds between re-scans for items put into a holster by others (Continue, the story). */
const RESCAN_SECONDS = .5;

/**
 * Two hip holsters (left and right) that hold any one item each, tools included. They ride
 * the body's heading (BackpackSystem.bodyYaw), like the worn pack. A held item brought to a
 * free hip shows its ring glowing (with a hint and a tick); letting go there hangs it at the
 * hip, and squeezing it there (ItemSystem's ordinary grab) takes it out. An item's Item.slot
 * is 'hip-left' / 'hip-right' while it hangs there, so saves carry it like any other slot.
 */
export class HolsterSystem extends createSystem({
  items: { required: [Item] },
  held: { required: [Item, Held] },
}) {
  private readonly occupants: (Entity | undefined)[] = [undefined, undefined];
  private rings: Mesh[] = [];
  private hints!: Record<Hand, TextLabel>;
  private aimed: Record<Hand, number> = { left: -1, right: -1 };
  /** What each hint last showed (its text is only rebuilt on a change). */
  private hintKeys: Record<Hand, number> = { left: NaN, right: NaN };
  private taught = new Set<string>();
  private rescan = 0;
  private elapsed = 0;
  private hip = new Vector3();
  private grip = new Vector3();
  private quat = new Quaternion();
  private backpack?: BackpackSystem;

  init(): void {
    const items = this.world.getSystem(ItemSystem);
    if (!items) throw new Error('HolsterSystem requires ItemSystem');
    this.backpack = this.world.getSystem(BackpackSystem);
    if (this.backpack) this.backpack.holsterClaims = (hand) => this.claims(hand);
    for (let i = 0; i < HIP_SLOTS.length; i++) {
      const ring = new Mesh(new TorusGeometry(.075, .006, 6, 28), glowMaterial());
      ring.name = `Holster ring ${HIP_SLOTS[i]}`;
      ring.raycast = () => {};
      ring.visible = false;
      const holder = new Object3D();
      holder.add(ring);
      this.world.createTransformEntity(holder, { persistent: true });
      this.rings.push(ring);
    }
    this.hints = { left: new TextLabel(.2, .045), right: new TextLabel(.2, .045) };
    for (const hand of HANDS) this.world.createTransformEntity(this.hints[hand].mesh, { persistent: true });
    this.cleanupFuncs.push(
      // Before the pack (10) and every camp target: a hand at the hip means the holster.
      items.addReleaseTarget(5, (entity, kind, _at, _v, hand) => this.release(entity, kind, hand)),
      this.queries.held.subscribe('qualify', (entity) => {
        const index = this.occupants.indexOf(entity);
        if (index >= 0) this.occupants[index] = undefined;
      }),
      this.queries.items.subscribe('disqualify', (entity) => {
        const index = this.occupants.indexOf(entity);
        if (index >= 0) this.occupants[index] = undefined;
      }),
      this.world.activeLevel.subscribe(() => {
        this.occupants[0] = this.occupants[1] = undefined;
        this.rescan = 0;
        this.taught.clear();
      }),
      () => { for (const hand of HANDS) this.hints[hand].dispose(); },
    );
  }

  /**
   * Hang an item at a hip now (the story fills them at a journey's start). It leaves a hand
   * holding it; one already hanging there is dropped at the player's feet.
   */
  put(entity: Entity, side: 'left' | 'right'): void {
    const index = side === 'left' ? 0 : 1;
    const items = this.world.getSystem(ItemSystem)!;
    const previous = this.occupants[index];
    if (previous && previous !== entity && previous.active) {
      previous.setValue(Item, 'slot', '');
      items.launch(previous, previous.getValue(Item, 'kind') ?? '', this.grip.set(0, 0, 0));
    }
    // Out of a hand without releasing it anywhere (hang makes it available again).
    if (entity.hasComponent(Held)) items.setAvailable(entity, false);
    this.hang(entity, index);
  }

  /** Where a hip holster is now (world). */
  hipAt(side: 'left' | 'right', out: Vector3): Vector3 {
    return this.hipPoint(side === 'left' ? 0 : 1, out);
  }

  /** The item hanging at a hip, if any. */
  at(side: 'left' | 'right'): Entity | undefined {
    return this.occupants[side === 'left' ? 0 : 1];
  }

  private hang(entity: Entity, index: number): void {
    const items = this.world.getSystem(ItemSystem)!;
    entity.setValue(Item, 'slot', HIP_SLOTS[index]);
    items.setAvailable(entity, true);
    this.occupants[index] = entity;
    this.place(entity, index);
  }

  /** World position of a holster (from the body heading). */
  private hipPoint(index: number, out: Vector3): Vector3 {
    const backpack = this.backpack ??= this.world.getSystem(BackpackSystem);
    if (backpack) return backpack.bodyPoint(HIP_SIDE[index] * HIP_X, HIP_Y, HIP_Z, out);
    this.camera.getWorldPosition(out);
    return out.set(out.x + HIP_SIDE[index] * HIP_X, out.y + HIP_Y, out.z);
  }

  /**
   * Hang an item at its hip: its grip (the prototype's origin) at the holster; long tools
   * hang point-down along the leg, everything else in its resting pose, facing the body's way.
   */
  private place(entity: Entity, index: number): void {
    const object = entity.object3D;
    if (!object) return;
    const kind = entity.getValue(Item, 'kind') ?? '';
    const info = itemInfo(kind);
    const yaw = this.backpack?.bodyYaw ?? 0;
    this.hipPoint(index, object.position);
    if (info?.tip && Math.abs(info.tip[1]) > Math.abs(info.tip[2])) {
      object.quaternion.setFromAxisAngle(Y_AXIS, yaw);
      // Tip down, leaning a little out from the leg.
      const down = info.tip[1] > 0 ? Math.PI : 0;
      object.quaternion.multiply(this.quat.setFromAxisAngle(Z_AXIS, down - HIP_SIDE[index] * .18));
    } else {
      this.world.getSystem(ItemSystem)!.restPose(entity, kind, yaw);
    }
  }

  /** The free holster a hand's grip is within reach of, else -1 (-2: in reach of a taken one). */
  private reach(hand: Hand): number {
    const grip = this.player.gripSpaces?.[hand];
    if (!grip) return -1;
    grip.getWorldPosition(this.grip);
    let best = -1, bestDistance = SNAP_REACH;
    for (let i = 0; i < HIP_SLOTS.length; i++) {
      const d = this.grip.distanceTo(this.hipPoint(i, this.hip));
      if (d >= bestDistance) continue;
      bestDistance = d;
      best = this.occupants[i] ? -2 : i;
    }
    return best;
  }

  /** Whether letting go now would hang this hand's item at a hip (the pack defers to it). */
  claims(hand: Hand): boolean {
    return this.aimed[hand] >= 0;
  }

  private release(entity: Entity, kind: string, hand: Hand | undefined): boolean {
    if (!hand || kind === 'pack') return false;
    const index = this.reach(hand);
    if (index < 0) return false;
    this.hang(entity, index);
    this.aimed[hand] = -1;
    pulse(this.input, hand, .3, 22);
    this.hipPoint(index, this.hip);
    bus.emit({ type: 'snap', kind, target: HIP_SLOTS[index], x: this.hip.x, y: this.hip.y, z: this.hip.z });
    this.teach('stored', 'At your hip', 'Squeeze it there to take it back. Two hips, one thing each.');
    return true;
  }

  private teach(key: string, text: string, body: string): void {
    if (this.taught.has(key)) return;
    this.taught.add(key);
    bus.emit({ type: 'toast', tone: 'info', text, body, hold: 6 });
  }

  /** Occupants are cached; items given a hip slot by someone else (a Continue) are picked up here. */
  private rescanSlots(): void {
    for (const entity of this.queries.items.entities) {
      const index = hipIndex(entity.getValue(Item, 'slot') ?? '');
      if (index < 0 || this.occupants[index] === entity || entity.hasComponent(Held)) continue;
      if (this.occupants[index]) continue;
      this.occupants[index] = entity;
    }
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.rescan -= delta;
    if (this.rescan <= 0) {
      this.rescan = RESCAN_SECONDS;
      this.rescanSlots();
    }
    for (let i = 0; i < HIP_SLOTS.length; i++) {
      const entity = this.occupants[i];
      if (!entity) continue;
      if (!entity.active || entity.getValue(Item, 'slot') !== HIP_SLOTS[i]) this.occupants[i] = undefined;
      else this.place(entity, i);
    }
    this.updateCues();
  }

  /** Rings: faint when a held item is near a free hip, bright and pulsing when letting go would hang it. */
  private updateCues(): void {
    const items = this.world.getSystem(ItemSystem)!;
    const glow = cuePulse(this.elapsed);
    const near = [0, 0];
    for (const hand of HANDS) {
      const held = items.heldIn(hand);
      const kind = held?.getValue(Item, 'kind') ?? '';
      const before = this.aimed[hand];
      this.aimed[hand] = held && kind !== 'pack' ? this.reach(hand) : -1;
      const aimed = this.aimed[hand];
      const hint = this.hints[hand];
      if (held && kind !== 'pack') {
        for (let i = 0; i < HIP_SLOTS.length; i++) {
          if (this.occupants[i]) continue;
          const d = this.grip.distanceTo(this.hipPoint(i, this.hip));
          if (d < SHOW_REACH) near[i] = Math.max(near[i], i === aimed ? 1 : .35);
        }
      }
      if (aimed !== before && aimed >= 0) {
        pulse(this.input, hand, .2, 14);
        this.teach('aim', 'Hip holster', 'Let go here to hang it at your hip.');
      }
      if (aimed === -1 || !held) {
        hint.mesh.visible = false;
        continue;
      }
      const key = held.index * 4 + aimed + 2;
      if (key !== this.hintKeys[hand]) {
        this.hintKeys[hand] = key;
        hint.set(aimed === -2 ? 'Hip taken' : `${itemInfo(kind)?.label ?? kind}: ${aimed === 0 ? 'left' : 'right'} hip`);
      }
      this.player.gripSpaces?.[hand]?.getWorldPosition(hint.mesh.position);
      hint.mesh.position.y += .12;
      this.camera.getWorldQuaternion(hint.mesh.quaternion);
      hint.mesh.visible = true;
    }
    for (let i = 0; i < HIP_SLOTS.length; i++) {
      const ring = this.rings[i];
      ring.visible = near[i] > 0;
      if (!ring.visible) continue;
      const holder = ring.parent!;
      this.hipPoint(i, holder.position);
      // Level around the hip, like a belt loop.
      holder.rotation.set(Math.PI / 2, 0, 0);
      (ring.material as { opacity: number }).opacity = near[i] >= 1 ? .45 + .5 * glow : .22;
      ring.scale.setScalar(near[i] >= 1 ? 1 + .08 * glow : 1);
    }
  }
}
