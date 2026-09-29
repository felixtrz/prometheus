import { createSystem, Entity, eq, Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { bus } from '../bus.js';
import { ITEMS, itemInfo } from '../catalog.js';
import { Backpack, Held, Item } from '../components.js';
import { pulse } from '../haptics.js';
import type { SaveData } from '../save.js';
import { CAMP, THROW } from '../rules.js';
import { ItemSystem, type Hand } from './item-system.js';
import { StorySystem } from './story-system.js';

/** Mat-local cell centres (the prototype is authored at 0.62 scale). */
const CELL_X = [-.459, 0, .459];
const CELL_Z = [-.291, 0, .291];
const CELL_TOP = .087;
const MAT_HX = .8, MAT_HZ = .55;
/** Roll handle rests at the mat's -X edge, lying along Z. */
const ROLL_LOCAL = new Vector3(-.843, .186, 0);
/** Items released over the roll (the mat's -X edge) still drop into the pack. */
const MAT_CATCH_MIN_X = ROLL_LOCAL.x - .12;
/** Worn anchor relative to the head: right, down, behind. */
const SHOULDER = new Vector3(.18, -.3, .17);
/** Resting height of the loose roll above the ground (where it lands before unrolling). */
const ROLL_REST_Y = ITEMS.pack.restY;
/** Seconds for the mat to unfurl from the landed roll. */
const UNROLL_SECONDS = .35;
/** Ground samples along the unrolling direction (m from the handle) that should share the handle's surface. */
const SPREAD_SAMPLES = [.45, -ROLL_LOCAL.x, 1.25, 1.6];
/** Never unroll the mat over the fire ring. */
const FIRE_CLEARANCE = .85;

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * The physical pack (GDD: "take off and reach into"; art: one object per cell).
 * States: 'unrolled' on a surface, 'held' rolled in a hand, 'worn' over the shoulder.
 *
 * Letting go of the roll low lays it down exactly where the hand let go (it drops
 * straight down onto the ground or a table) keeping the yaw it was held at; the mat
 * then unfurls from it, away from the player (or onto the same table). The logical
 * state is 'unrolled' from the moment of release; only the visuals animate.
 */
export class BackpackSystem extends createSystem({
  packs: { required: [Backpack] },
  items: { required: [Item] },
  held: { required: [Item, Held] },
  handles: { required: [Item], where: [eq(Item, 'kind', 'pack')] },
}) {
  lost = false;
  private matYaw = 0;
  /** Where the mat lies (its origin), independent of the unfurl animation. */
  private matAt = new Vector3();
  private matScale = new Vector3(1, 1, 1);
  /** Body heading the worn pack follows: it only turns when the head looks > 70° away. */
  private bodyYaw = 0;
  private taught = new Set<string>();
  private laidOut = false;
  /** Set while dropAt force-releases the roll: it must lie down, never be worn. */
  private forceDrop = false;
  /** Lay-down animation: 'fall' (roll drops to the ground), 'unroll' (mat unfurls), or ''. */
  private settle: '' | 'fall' | 'unroll' = '';
  private settleTime = 0;
  private settleFrom = new Vector3();
  private settleFromQuat = new Quaternion();
  private settleQuat = new Quaternion();
  private landY = 0;
  private point = new Vector3();
  private head = new Vector3();
  private forward = new Vector3();
  private anchor = new Vector3();
  private cell = new Vector3();
  private axis = new Vector3();
  private away = new Vector3();
  private matEntity?: Entity;
  private handleEntity?: Entity;

  get mat(): Entity | undefined {
    return this.matEntity;
  }

  get handle(): Entity | undefined {
    return this.handleEntity;
  }

  get state(): string {
    return this.mat?.getValue(Backpack, 'state') ?? 'unrolled';
  }

  init(): void {
    const items = this.world.getSystem(ItemSystem);
    if (!items) throw new Error('BackpackSystem requires ItemSystem');
    this.cleanupFuncs.push(
      items.addReleaseTarget(0, (entity, kind, at, _v, hand) => (kind === 'pack' ? this.releaseHandle(entity, at, hand) : false)),
      items.addReleaseTarget(10, (entity, kind, at, _v, hand) => this.releaseIntoCell(entity, kind, at, hand)),
      this.queries.held.subscribe('qualify', (entity) => {
        if (entity.getValue(Item, 'kind') !== 'pack') return;
        const wasWorn = this.state === 'worn';
        this.stopSettle();
        this.setState('held');
        this.lost = false;
        entity.object3D?.getWorldPosition(this.point);
        if (!wasWorn) bus.emit({ type: 'pack', state: 'held', x: this.point.x, y: this.point.y, z: this.point.z });
        this.teach('held', 'Your pack, rolled up', 'Release it low to unroll it. Release it behind your shoulder to wear it.');
      }),
      this.queries.packs.subscribe('qualify', (entity) => { this.matEntity = entity; this.laidOut = false; }, true),
      this.queries.packs.subscribe('disqualify', (entity) => {
        if (this.matEntity !== entity) return;
        this.matEntity = undefined;
        for (const other of this.queries.packs.entities) if (other !== entity) this.matEntity = other;
      }),
      this.queries.handles.subscribe('qualify', (entity) => { this.handleEntity = entity; }, true),
      this.queries.handles.subscribe('disqualify', (entity) => {
        if (this.handleEntity !== entity) return;
        this.handleEntity = undefined;
        for (const other of this.queries.handles.entities) if (other !== entity) this.handleEntity = other;
      }),
      this.world.activeLevel.subscribe(() => { this.stopSettle(); this.laidOut = false; this.lost = false; this.taught.clear(); }),
    );
    const story = this.world.getSystem(StorySystem);
    if (story) story.hooks.pack = { save: () => this.save(), load: (data) => this.load(data) };
  }

  private teach(key: string, text: string, body: string): void {
    if (this.taught.has(key)) return;
    this.taught.add(key);
    bus.emit({ type: 'toast', tone: 'info', text, body, hold: 6 });
  }

  private setState(state: string): void {
    const mat = this.mat;
    if (!mat) return;
    mat.setValue(Backpack, 'state', state);
    const unrolled = state === 'unrolled';
    if (mat.object3D) mat.object3D.visible = unrolled && this.settle !== 'fall';
    const items = this.world.getSystem(ItemSystem)!;
    if (!unrolled) items.setSurface('pack', null);
    this.layoutCells();
  }

  /** Place stored items on their cells (unrolled) or hide them inside the roll (and while the mat unfurls). */
  private layoutCells(): void {
    const mat = this.mat;
    const items = this.world.getSystem(ItemSystem)!;
    if (!mat?.object3D) return;
    const unrolled = this.state === 'unrolled';
    const origin = this.matAt;
    if (unrolled) {
      items.setSurface('pack', { x: origin.x, z: origin.z, hx: .76, hz: .5, yawDeg: this.matYaw * 180 / Math.PI, y: origin.y + CELL_TOP - .01 });
    }
    for (const entity of this.queries.items.entities) {
      const slot = entity.getValue(Item, 'slot') ?? '';
      if (!slot.startsWith('pack-')) continue;
      const index = Number(slot.slice(5));
      if (unrolled) {
        const kind = entity.getValue(Item, 'kind') ?? '';
        this.cellWorld(index, this.cell);
        entity.object3D?.position.set(this.cell.x, this.cell.y + (itemInfo(kind)?.restY ?? .04), this.cell.z);
        items.restPose(entity, kind, this.matYaw);
      }
      items.setAvailable(entity, unrolled && !this.settle);
    }
    this.placeHandleOnMat();
  }

  private cellWorld(index: number, out: Vector3): Vector3 {
    const lx = CELL_X[index % 3], lz = CELL_Z[Math.floor(index / 3)];
    const c = Math.cos(this.matYaw), s = Math.sin(this.matYaw);
    return out.set(this.matAt.x + lx * c + lz * s, this.matAt.y + CELL_TOP, this.matAt.z - lx * s + lz * c);
  }

  /** Heading (rotation.y) that turns local +X onto the roll's current horizontal axis; NaN when it stands on end. */
  private rollHeading(object: Object3D): number {
    this.axis.set(1, 0, 0).applyQuaternion(object.quaternion);
    return Math.hypot(this.axis.x, this.axis.z) < .3 ? NaN : Math.atan2(-this.axis.z, this.axis.x);
  }

  /** Of the two ways the roll can lie along the mat edge, the one nearest its current heading (never a spin). */
  private handleYaw(object: Object3D): number {
    const a = this.matYaw + Math.PI / 2, b = this.matYaw - Math.PI / 2;
    const heading = this.rollHeading(object);
    if (Number.isNaN(heading)) return a;
    return Math.abs(wrap(heading - a)) <= Math.abs(wrap(heading - b)) ? a : b;
  }

  private placeHandleOnMat(): void {
    const handle = this.handle, mat = this.mat;
    if (!handle?.object3D || !mat?.object3D || this.state !== 'unrolled' || this.settle || handle.hasComponent(Held)) return;
    const c = Math.cos(this.matYaw), s = Math.sin(this.matYaw);
    const yaw = this.handleYaw(handle.object3D);
    handle.object3D.position.set(
      this.matAt.x + ROLL_LOCAL.x * c + ROLL_LOCAL.z * s,
      this.matAt.y + ROLL_LOCAL.y,
      this.matAt.z - ROLL_LOCAL.x * s + ROLL_LOCAL.z * c,
    );
    handle.object3D.rotation.set(0, yaw, 0);
  }

  /** Worn anchor behind the right shoulder into `out`; returns the yaw it faces. */
  private shoulderAnchor(out: Vector3, follow = false): number {
    this.camera.getWorldPosition(this.head);
    this.camera.getWorldDirection(this.forward);
    const headYaw = Math.atan2(-this.forward.x, -this.forward.z);
    let yaw = headYaw;
    if (follow) {
      // Looking over your shoulder shouldn't swing the pack away: follow the body, not the head.
      const diff = Math.atan2(Math.sin(headYaw - this.bodyYaw), Math.cos(headYaw - this.bodyYaw));
      if (Math.abs(diff) > 1.2) this.bodyYaw += diff - Math.sign(diff) * 1.2;
      yaw = this.bodyYaw;
    }
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out.set(this.head.x + SHOULDER.x * c + SHOULDER.z * s, this.head.y + SHOULDER.y, this.head.z - SHOULDER.x * s + SHOULDER.z * c);
    return yaw;
  }

  private releaseHandle(handle: Entity, at: Vector3, hand: Hand | undefined): boolean {
    const yaw = this.shoulderAnchor(this.anchor);
    // Only a hand letting go can put it on (never a forced drop at death).
    const wearable = hand !== undefined && !this.forceDrop;
    // Judge "at the shoulder" by the hand as well as the roll: it hangs below the hand in the carry hold.
    const grip = wearable ? this.player.gripSpaces?.[hand] : undefined;
    if (grip) grip.getWorldPosition(this.point);
    else this.point.copy(at);
    if (wearable && (this.atShoulder(this.point) || this.atShoulder(at))) {
      this.setState('worn');
      handle.setValue(Item, 'slot', 'worn');
      this.bodyYaw = yaw;
      this.followShoulder(handle, yaw);
      bus.emit({ type: 'pack', state: 'worn', x: at.x, y: at.y, z: at.z });
      this.teach('worn', 'Pack on your back', 'Drop things over your right shoulder to stow them. Reach back and squeeze to take it off.');
      return true;
    }
    this.layDown(handle);
    return true;
  }

  /** Behind the head plane and near shoulder height, or simply close to the worn anchor (after shoulderAnchor). */
  private atShoulder(p: Vector3): boolean {
    if (p.distanceTo(this.anchor) < .4) return true;
    return (p.x - this.head.x) * this.forward.x + (p.z - this.head.z) * this.forward.z < .05 && p.y > this.head.y - .5;
  }

  /**
   * Lay the rolled pack down right below where it is now, keeping its yaw, and unroll
   * the mat from it. The handle never moves sideways and never turns; the mat spreads
   * perpendicular to the roll onto the surface the roll lands on, away from the player.
   */
  private layDown(handle: Entity): void {
    const mat = this.mat, object = handle.object3D;
    if (!mat?.object3D || !object) return;
    const items = this.world.getSystem(ItemSystem)!;
    items.setSurface('pack', null);
    handle.setValue(Item, 'slot', '');
    const hx = object.position.x, hz = object.position.z;
    const ground = items.groundAt(hx, hz);

    // Away from the player, horizontally (the view direction when the roll is right underfoot).
    this.camera.getWorldPosition(this.head);
    this.away.set(hx - this.head.x, 0, hz - this.head.z);
    if (this.away.lengthSq() < .15 * .15) {
      this.camera.getWorldDirection(this.away);
      this.away.y = 0;
    }
    let heading = this.rollHeading(object);
    // Standing on end: lay it across the way the player faces.
    if (Number.isNaN(heading)) heading = Math.atan2(this.away.x, this.away.z);
    // The mat spreads along ±(sin h, cos h): pick the side that stays on the roll's surface, then away from the player.
    const ex = Math.sin(heading), ez = Math.cos(heading);
    let best = 1, bestScore = -Infinity;
    for (const side of [1, -1]) {
      let score = (ex * this.away.x + ez * this.away.z) * side > 0 ? 1 : 0;
      for (const d of SPREAD_SAMPLES) {
        const sx = hx + ex * side * d, sz = hz + ez * side * d;
        if (Math.abs(items.groundAt(sx, sz) - ground) < .06) score += 2;
        if (Math.hypot(sx - CAMP.fire.x, sz - CAMP.fire.z) < FIRE_CLEARANCE) score -= 4;
      }
      if (score > bestScore) { bestScore = score; best = side; }
    }
    this.matYaw = wrap(heading - best * Math.PI / 2);
    const c = Math.cos(this.matYaw), s = Math.sin(this.matYaw);
    this.matAt.set(hx - (ROLL_LOCAL.x * c + ROLL_LOCAL.z * s), ground, hz - (-ROLL_LOCAL.x * s + ROLL_LOCAL.z * c));

    // Animate: the roll drops straight down and settles flat, then the mat unfurls.
    this.settleFrom.copy(object.position);
    this.settleFromQuat.copy(object.quaternion);
    this.settleQuat.setFromAxisAngle(this.axis.set(0, 1, 0), heading);
    this.landY = ground + ROLL_REST_Y;
    this.settle = 'fall';
    this.settleTime = 0;
    mat.object3D.rotation.set(0, this.matYaw, 0);
    mat.object3D.position.copy(this.matAt);
    this.setState('unrolled');
  }

  private stopSettle(): void {
    if (!this.settle) return;
    this.settle = '';
    const mat = this.mat?.object3D;
    if (mat) {
      mat.scale.copy(this.matScale);
      mat.position.copy(this.matAt);
    }
  }

  private updateSettle(delta: number, handle: Entity, mat: Object3D): void {
    const object = handle.object3D;
    if (!object) return;
    this.settleTime += delta;
    if (this.settle === 'fall') {
      const fallTime = Math.sqrt(Math.max(0, 2 * (this.settleFrom.y - this.landY) / THROW.gravity));
      const t = this.settleTime;
      object.position.set(this.settleFrom.x, Math.max(this.landY, this.settleFrom.y - .5 * THROW.gravity * t * t), this.settleFrom.z);
      const k = fallTime > 0 ? Math.min(1, t / fallTime) : 1;
      object.quaternion.slerpQuaternions(this.settleFromQuat, this.settleQuat, k);
      if (t < fallTime) return;
      object.position.y = this.landY;
      object.quaternion.copy(this.settleQuat);
      this.settle = 'unroll';
      this.settleTime = 0;
      bus.emit({ type: 'drop', kind: 'pack', x: object.position.x, y: object.position.y, z: object.position.z, hard: fallTime > .35 });
      bus.emit({ type: 'pack', state: 'unrolled', x: object.position.x, y: object.position.y, z: object.position.z });
      mat.visible = true;
    }
    // Unfurl from the roll edge: the mat grows along its local X with its -X edge held at the roll.
    const u = Math.min(1, this.settleTime / UNROLL_SECONDS);
    const k = 1 - (1 - u) * (1 - u) * (1 - u);
    const reach = Math.max(.02, k);
    mat.scale.set(this.matScale.x * reach, this.matScale.y, this.matScale.z);
    mat.position.set(
      this.settleFrom.x + (this.matAt.x - this.settleFrom.x) * reach,
      this.matAt.y,
      this.settleFrom.z + (this.matAt.z - this.settleFrom.z) * reach,
    );
    // The roll rides up onto the unfurling hinge flap.
    object.position.y = this.landY + (this.matAt.y + ROLL_LOCAL.y - this.landY) * k;
    if (u < 1) return;
    this.settle = '';
    mat.scale.copy(this.matScale);
    mat.position.copy(this.matAt);
    this.layoutCells();
  }

  private followShoulder(handle: Entity, yaw: number): void {
    const object = handle.object3D;
    if (!object) return;
    object.position.copy(this.anchor);
    object.rotation.set(0, yaw + Math.PI / 2, 0);
  }

  /** Released at the shoulder while the pack is worn: stow it in the first free cell. */
  private stowOverShoulder(entity: Entity, kind: string, at: Vector3, hand: Hand | undefined): boolean {
    const handle = this.handle?.object3D;
    if (this.state !== 'worn' || !handle || kind === 'pack' || kind === 'sentry-kit') return false;
    if (at.distanceTo(handle.position) > .45) return false;
    const taken = new Set<number>();
    for (const other of this.queries.items.entities) {
      const slot = other.getValue(Item, 'slot') ?? '';
      if (slot.startsWith('pack-')) taken.add(Number(slot.slice(5)));
    }
    let free = -1;
    for (let index = 0; index < 9 && free < 0; index++) if (!taken.has(index)) free = index;
    if (free < 0) {
      bus.emit({ type: 'toast', text: 'The pack is full', body: 'Nine cells, one item each.', tone: 'warn' });
      return false;
    }
    entity.setValue(Item, 'slot', `pack-${free}`);
    this.world.getSystem(ItemSystem)!.setAvailable(entity, false);
    pulse(this.input, hand, .25, 20);
    bus.emit({ type: 'snap', kind, target: `pack-${free}`, x: at.x, y: at.y, z: at.z });
    return true;
  }

  private releaseIntoCell(entity: Entity, kind: string, at: Vector3, hand: Hand | undefined): boolean {
    if (this.stowOverShoulder(entity, kind, at, hand)) return true;
    if (!this.mat?.object3D || this.state !== 'unrolled' || kind === 'pack' || kind === 'sentry-kit') return false;
    const dx = at.x - this.matAt.x, dz = at.z - this.matAt.z;
    const c = Math.cos(this.matYaw), s = Math.sin(this.matYaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (lx < MAT_CATCH_MIN_X || lx > MAT_HX || Math.abs(lz) > MAT_HZ || at.y > this.matAt.y + .6) return false;
    const taken = new Set<number>();
    for (const other of this.queries.items.entities) {
      const slot = other.getValue(Item, 'slot') ?? '';
      if (slot.startsWith('pack-')) taken.add(Number(slot.slice(5)));
    }
    let best = -1, bestDistance = Infinity;
    for (let index = 0; index < 9; index++) {
      if (taken.has(index)) continue;
      const d = Math.hypot(lx - CELL_X[index % 3], lz - CELL_Z[Math.floor(index / 3)]);
      if (d < bestDistance) { best = index; bestDistance = d; }
    }
    if (best < 0) {
      bus.emit({ type: 'toast', text: 'The pack is full: nine cells, one item each.', tone: 'warn' });
      return false;
    }
    entity.setValue(Item, 'slot', `pack-${best}`);
    this.cellWorld(best, this.cell);
    entity.object3D?.position.set(this.cell.x, this.cell.y + (itemInfo(kind)?.restY ?? .04), this.cell.z);
    const items = this.world.getSystem(ItemSystem)!;
    items.restPose(entity, kind, this.matYaw);
    // Dropped in while the mat is still unfurling: it appears with the others.
    if (this.settle) items.setAvailable(entity, false);
    pulse(this.input, hand, .25, 20);
    bus.emit({ type: 'snap', kind, target: `pack-${best}`, x: this.cell.x, y: this.cell.y, z: this.cell.z });
    return true;
  }

  /**
   * Death: the pack falls where you fell and unrolls there, glowing until you take it
   * back. A worn roll drops straight down from the shoulder, keeping its yaw.
   */
  dropAt(x: number, z: number): void {
    const handle = this.handle;
    if (!handle?.object3D) return;
    if (this.state === 'unrolled') {
      // Let go of in the fall (SurvivalSystem opens the hands first): already dropping here.
      if (this.settle) this.lost = true;
      return;
    }
    if (handle.hasComponent(Held)) {
      this.forceDrop = true;
      this.world.getSystem(ItemSystem)?.forceRelease(handle);
      this.forceDrop = false;
    } else {
      const p = handle.object3D.position;
      if (Math.hypot(p.x - x, p.z - z) > 1.5) p.set(x, p.y, z);
      this.layDown(handle);
    }
    this.lost = true;
  }

  save(): SaveData['pack'] {
    const mat = this.mat?.object3D;
    if (!mat) return null;
    const state = this.state === 'unrolled' ? 'unrolled' : 'worn';
    // Before the first layout the scene pose is the truth; after it, matAt (the mat may be mid-unfurl).
    const at = this.laidOut ? this.matAt : mat.position;
    return { state, p: [at.x, at.y, at.z], yaw: this.laidOut ? this.matYaw : mat.rotation.y, lost: this.lost };
  }

  load(data: SaveData['pack']): void {
    const mat = this.mat;
    if (!data || !mat?.object3D) return;
    this.stopSettle();
    this.lost = data.lost;
    this.matYaw = data.yaw;
    this.matAt.set(...data.p);
    mat.object3D.position.copy(this.matAt);
    mat.object3D.rotation.set(0, data.yaw, 0);
    const handle = this.handle;
    if (data.state === 'worn' && handle) handle.setValue(Item, 'slot', 'worn');
    this.setState(data.state);
  }

  update(delta: number): void {
    const mat = this.mat, handle = this.handle;
    if (!mat?.object3D || !handle?.object3D) return;
    if (!this.laidOut) {
      this.laidOut = true;
      this.settle = '';
      this.matYaw = mat.object3D.rotation.y;
      this.matAt.copy(mat.object3D.position);
      this.matScale.copy(mat.object3D.scale);
      this.layoutCells();
    }
    if (this.settle && !handle.hasComponent(Held)) this.updateSettle(delta, handle, mat.object3D);
    if (this.state === 'worn' && !handle.hasComponent(Held)) {
      this.followShoulder(handle, this.shoulderAnchor(this.anchor, true));
    }
  }
}
