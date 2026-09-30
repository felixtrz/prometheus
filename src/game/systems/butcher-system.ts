/**
 * ButcherSystem (priority 16.5): a slain deer or rabbit lies where it fell as a Carcass
 * (CreatureSystem hands it over once the collapse ends: same entity, same model, no
 * extra draws). Brisk axe blows on its body (gather-style arming: the blade must come
 * back off the hide before the next blow counts) butcher it: a haptic pulse and a 'chop'
 * cue (node 'carcass') per blow, and on the last blow its meat drops beside it on the
 * butcher's side ('harvest' kind 'meat') and the carcass sinks away. An unbutchered
 * carcass rots away after BUTCHER.rotSeconds; over BUTCHER.maxLying the oldest goes first.
 *
 * Carcasses are never saved (a Continue finds none) and are cleared on a new journey or
 * a level swap. They carry no Creature, so nothing that counts, targets or spawns
 * creatures (prey limits, herd anchors, wolves, combat) ever sees them.
 */
import { createSystem, Vector3, VisibilityState } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { bus } from '../bus.js';
import { ITEMS } from '../catalog.js';
import { Carcass, Held, Item } from '../components.js';
import { bladeContact, capsuleGap } from '../creature-ai.js';
import { pulse } from '../haptics.js';
import { CreatureSystem } from './creature-system.js';
import { ItemSystem } from './item-system.js';

interface CarcassKind {
  /** Axe blows to butcher it. */
  hits: number;
  /** Items dropped beside it on the last blow. */
  yields: readonly string[];
  /** Body capsule in the carcass's own frame (lying on its side, facing +Z): height, Z span, radius (m). */
  y: number; z0: number; z1: number; radius: number;
}

export const BUTCHER = {
  species: {
    deer: { hits: 3, yields: ['meat', 'meat'], y: .22, z0: -.62, z1: .55, radius: .26 },
    rabbit: { hits: 2, yields: ['meat'], y: .08, z0: -.12, z1: .1, radius: .1 },
  } as Record<string, CarcassKind>,
  /** Blade within this of the hide counts as a blow (m); pull it back past `rearm` to arm the next. */
  contact: .08,
  rearm: .3,
  /** Blade speed (m/s, in the player rig's frame) a blow needs, and the gap between blows (s). */
  bladeSpeed: 1.8,
  cooldown: .3,
  /** Only carcasses this close (horizontally) to the blade are tested (m). */
  reach: 2,
  /** Unbutchered carcasses rot away after this long (s); at most this many lie about at once. */
  rotSeconds: 240,
  maxLying: 4,
  /** Sinking away: seconds after butchering, seconds when rotting, and how deep (m). */
  butcheredSinkSeconds: 1.2,
  rotSinkSeconds: 4,
  sinkDepth: .45,
  /** Meat lands this far from the body's centre line, toward the butcher (m). */
  dropOffset: .5,
} as const;

const AXE_TIP = new Vector3(...ITEMS.axe.tip);

export class ButcherSystem extends createSystem({
  carcasses: { required: [Carcass] },
  held: { required: [Item, Held] },
}) {
  private tip = new Vector3();
  private tipLocal = new Vector3();
  private previousTip = new Vector3();
  private hasPreviousTip = false;
  private local = new Vector3();
  private viewer = new Vector3();
  private cooldown = 0;
  private creatures?: CreatureSystem;
  private itemSystem?: ItemSystem;

  init(): void {
    this.cleanupFuncs.push(
      this.queries.held.subscribe('disqualify', () => { this.hasPreviousTip = false; }),
      bus.on('new-game', () => this.clearAll()),
      // Whatever the level load leaves behind belongs to no journey.
      this.world.activeLevel.subscribe(() => this.clearAll()),
    );
  }

  update(delta: number): void {
    this.creatures ??= this.world.getSystem(CreatureSystem);
    const visibility = this.visibilityState.peek();
    // The start gate stops the creature world: carcasses neither rot nor butcher then.
    if (this.creatures?.isPaused || visibility === VisibilityState.Hidden || visibility === VisibilityState.VisibleBlurred) {
      this.hasPreviousTip = false;
      return;
    }
    if (this.queries.carcasses.entities.size === 0) {
      this.hasPreviousTip = false;
      return;
    }
    const dt = Math.min(delta, .1);
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.decay(dt);
    this.butcher(delta);
  }

  /** Age, rot and sink every carcass; over the limit the oldest lying one starts to rot. */
  private decay(dt: number): void {
    let lying = 0, oldest: Entity | undefined, oldestAge = -1;
    for (const carcass of this.queries.carcasses.entities) {
      const object = carcass.object3D;
      if (!object) continue;
      const age = (carcass.getValue(Carcass, 'age') ?? 0) + dt;
      carcass.setValue(Carcass, 'age', age);
      const state = carcass.getValue(Carcass, 'state');
      if (state === 'lying') {
        if (age >= BUTCHER.rotSeconds) {
          this.sinkAway(carcass, 'rotting');
          continue;
        }
        lying++;
        if (age > oldestAge) { oldestAge = age; oldest = carcass; }
        continue;
      }
      const timer = (carcass.getValue(Carcass, 'timer') ?? 0) - dt;
      if (timer <= 0) {
        carcass.dispose({ disposeResources: false });
        continue;
      }
      carcass.setValue(Carcass, 'timer', timer);
      const total = state === 'butchered' ? BUTCHER.butcheredSinkSeconds : BUTCHER.rotSinkSeconds;
      const t = 1 - timer / total;
      const eased = t * t * (3 - 2 * t);
      object.position.y = (carcass.getValue(Carcass, 'ground') ?? object.position.y) - BUTCHER.sinkDepth * eased;
      // Settles flat as it goes into the ground.
      object.scale.set(1, 1 - .5 * eased, 1);
    }
    if (lying > BUTCHER.maxLying && oldest) this.sinkAway(oldest, 'rotting');
  }

  private sinkAway(carcass: Entity, state: 'butchered' | 'rotting'): void {
    carcass.setValue(Carcass, 'state', state);
    carcass.setValue(Carcass, 'timer', state === 'butchered' ? BUTCHER.butcheredSinkSeconds : BUTCHER.rotSinkSeconds);
  }

  /** Axe blows on a lying carcass (blade speed measured as in GatherSystem: the arm's own swing only). */
  private butcher(delta: number): void {
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

    for (const carcass of this.queries.carcasses.entities) {
      const object = carcass.object3D;
      if (!object || carcass.getValue(Carcass, 'state') !== 'lying') continue;
      const kind = BUTCHER.species[carcass.getValue(Carcass, 'species') ?? ''];
      if (!kind) continue;
      if (Math.hypot(this.tip.x - object.position.x, this.tip.z - object.position.z) > BUTCHER.reach) {
        if (!carcass.getValue(Carcass, 'armed')) carcass.setValue(Carcass, 'armed', true);
        continue;
      }
      object.updateWorldMatrix(true, false);
      this.local.copy(this.tip);
      object.worldToLocal(this.local);
      const gap = capsuleGap(this.local.x, this.local.y, this.local.z, kind.y, kind.z0, kind.z1, kind.radius);
      const armed = carcass.getValue(Carcass, 'armed') ?? true;
      const contact = bladeContact(gap, speed, armed && this.cooldown === 0, BUTCHER.contact, BUTCHER.rearm, BUTCHER.bladeSpeed);
      if (contact === 'rearm') {
        if (!armed) carcass.setValue(Carcass, 'armed', true);
      } else if (contact === 'blow') {
        carcass.setValue(Carcass, 'armed', false);
        this.cooldown = BUTCHER.cooldown;
        this.blow(carcass, kind, axe);
      }
    }
  }

  private blow(carcass: Entity, kind: CarcassKind, axe: Entity): void {
    this.itemSystem ??= this.world.getSystem(ItemSystem);
    const items = this.itemSystem;
    const hits = (carcass.getValue(Carcass, 'hits') ?? 0) + 1;
    carcass.setValue(Carcass, 'hits', hits);
    pulse(this.input, items?.handOf(axe), .9, 60);
    bus.emit({ type: 'chop', node: 'carcass', remaining: Math.max(0, kind.hits - hits), x: this.tip.x, y: this.tip.y, z: this.tip.z });
    if (hits < kind.hits || !items) return;
    const object = carcass.object3D!;
    const x = object.position.x, z = object.position.z;
    // Beside the body on the butcher's side, spread along it so the pieces never stack.
    this.camera.getWorldPosition(this.viewer);
    let ux = this.viewer.x - x, uz = this.viewer.z - z;
    const length = Math.hypot(ux, uz);
    if (length > 1e-3) { ux /= length; uz /= length; } else { ux = 1; uz = 0; }
    const count = kind.yields.length;
    for (let i = 0; i < count; i++) {
      const along = count > 1 ? (i - (count - 1) / 2) * .35 : 0;
      void items.dropAt(kind.yields[i], x + ux * BUTCHER.dropOffset - uz * along, z + uz * BUTCHER.dropOffset + ux * along);
    }
    bus.emit({ type: 'harvest', kind: kind.yields[0] ?? 'meat', x, y: object.position.y + kind.y, z });
    this.sinkAway(carcass, 'butchered');
  }

  private clearAll(): void {
    for (const carcass of Array.from(this.queries.carcasses.entities)) {
      if (carcass.active) carcass.dispose({ disposeResources: false });
    }
  }
}
