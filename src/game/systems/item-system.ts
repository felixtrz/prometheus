import {
  BackSide, Box3, BoxGeometry, createSystem, Entity, InputComponent, Matrix4, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3,
} from '@iwsdk/core';
import { bus } from '../bus.js';
import { itemInfo, VARIANT_NODES, type Hold } from '../catalog.js';
import { Airborne, Held, Item, ItemSurface } from '../components.js';
import { pulse } from '../haptics.js';
import { surfaceHeight, THROW } from '../rules.js';
import { insideFootprint, yawFromXAxis } from '../surface-math.js';
import { terrainHeight, WORLD_BOUNDS } from '../terrain.js';

export type Hand = 'left' | 'right';
/** Return true when the target consumed or placed the released item. */
export type ReleaseTarget = (item: Entity, kind: string, at: Vector3, velocity: Vector3, hand: Hand | undefined) => boolean;
export type SpawnOptions = { variant?: string; charges?: number; velocity?: [number, number, number]; slot?: string; resting?: boolean };
type Surface = { id: string; x: number; z: number; hx: number; hz: number; yawDeg: number; y: number };

const SAMPLES = 5;
const HANDS: readonly Hand[] = ['left', 'right'];
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const X_AXIS = new Vector3(1, 0, 0);
const NEG_Z = new Vector3(0, 0, -1);
/** A closed hand takes an item whose bounds are within this distance of the palm (m). */
const GRAB_RADIUS = .075;
/** Seconds for a grabbed item to settle into its hold pose. */
const SNAP_SECONDS = .12;
/** Runtime-spawned items kept at most; the oldest loose wood/bolts give way (saves and scans stay small). */
const RUNTIME_CAP = 120;
const EVICTABLE: ReadonlySet<string> = new Set(['stick', 'log', 'bolt', 'plank']);
const DEG = Math.PI / 180;

/** Right-hand grip rotation per hold frame (see catalog Hold). The left hand mirrors it. */
const FRAME_ROTATION: Record<Hold['frame'], Quaternion> = {
  tool: new Quaternion().setFromAxisAngle(X_AXIS, -90 * DEG),
  level: new Quaternion().setFromAxisAngle(X_AXIS, -45 * DEG),
  spear: new Quaternion().setFromAxisAngle(X_AXIS, -135 * DEG),
  page: new Quaternion().setFromAxisAngle(X_AXIS, 45 * DEG),
  carry: new Quaternion().setFromAxisAngle(X_AXIS, -45 * DEG),
};

const FLIPPED_TOOL = new Quaternion().setFromAxisAngle(X_AXIS, 90 * DEG);

/**
 * Pulsing warm rim drawn behind a reachable item: an inverted hull, grown 3% about
 * each mesh's own origin (closing seams on faceted items) and pushed out in clip space
 * so the rim keeps a constant on-screen width at any distance, even on flat pages.
 */
const OUTLINE = new MeshBasicMaterial({ color: 0xffb347, side: BackSide, transparent: true, opacity: .9, depthWrite: false, fog: false });
/** Sheet variant: drawn a hair toward the viewer so it wins against the ground a page lies on. */
const OUTLINE_FLAT = OUTLINE.clone();
OUTLINE_FLAT.polygonOffset = true;
OUTLINE_FLAT.polygonOffsetFactor = -2;
OUTLINE_FLAT.polygonOffsetUnits = -2;
OUTLINE.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed *= 1.03;')
    .replace('#include <project_vertex>', `#include <project_vertex>
  vec4 clipNormal = projectionMatrix * modelViewMatrix * vec4(normal, 0.0);
  gl_Position.xy += normalize(clipNormal.xy + vec2(1e-6)) * 0.0045 * gl_Position.w;`);
};
OUTLINE_FLAT.onBeforeCompile = OUTLINE.onBeforeCompile;

type Grip = {
  entity: Entity;
  /** Item pose relative to the grip, easing from where it was grabbed to the hold pose. */
  fromPos: Vector3; fromQuat: Quaternion; toPos: Vector3; toQuat: Quaternion; t: number;
};

/**
 * Owns every Item: grabbing (squeeze near an item snaps it to its catalog hold
 * pose; the other hand can take it over), the reach highlight, where it goes on
 * release (via registered targets), and the lightweight ballistic drop/throw that
 * replaces a physics engine. Other systems ask it to spawn, consume and restyle items.
 */
export class ItemSystem extends createSystem({
  items: { required: [Item] },
  held: { required: [Item, Held] },
  airborne: { required: [Item, Airborne] },
  surfaces: { required: [ItemSurface] },
}) {
  private targets: { order: number; fn: ReleaseTarget }[] = [];
  private grips: Record<Hand, Grip | undefined> = { left: undefined, right: undefined };
  private hovered: Record<Hand, Entity | undefined> = { left: undefined, right: undefined };
  private samples = new Map<number, Float32Array>();
  private sampleCount = new Map<number, number>();
  /** Entities to dispose next frame, with the generation they had (pooled slots get reused). */
  private pendingDispose: { entity: Entity; generation: number }[] = [];
  /** Items that exist but cannot be picked up (hidden in the pack, deployed sentries…). */
  private locked = new Set<number>();
  private bounds = new Map<number, Box3>();
  private reach = new Map<number, { scale: number; radius: number }>();
  private outlines = new Map<number, Mesh[]>();
  /** Scene-authored item uids consumed this journey (runtime 'rt-' items just vanish). */
  readonly consumedUids = new Set<string>();
  private extraSurfaces: Surface[] = [];
  private spawnSerial = 0;
  private point = new Vector3();
  private other = new Vector3();
  private velocity = new Vector3();
  private quat = new Quaternion();
  private quat2 = new Quaternion();
  private dir = new Vector3();
  private scale = new Vector3();
  private matrix = new Matrix4();
  private matrix2 = new Matrix4();
  private box = new Box3();
  private elapsed = 0;

  init(): void {
    this.warmOutline();
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => { if (state === 'visible') this.warmOutline(); }),
      bus.on('spawn-item', (event) => {
        void this.spawnItem(event.kind, event.x, event.y, event.z, {
          variant: event.variant, charges: event.charges,
          velocity: event.vx !== undefined ? [event.vx, event.vy ?? 0, event.vz ?? 0] : undefined,
        });
      }),
      this.queries.surfaces.subscribe('qualify', (entity) => this.registerSurface(entity), true),
      this.queries.surfaces.subscribe('disqualify', (entity) => this.setSurface(`prop-${entity.index}`, null)),
      this.queries.items.subscribe('disqualify', (entity) => this.forget(entity)),
    );
  }

  /** Compile the outline program now (and on entering XR) so the first hover never hitches. */
  private warmOutline(): void {
    const geometry = new BoxGeometry(.01, .01, .01);
    const probe = new Mesh(geometry, OUTLINE);
    try {
      this.world.renderer.compile(probe, this.world.camera);
    } catch {
      // Compilation is an optimisation only.
    }
    geometry.dispose();
  }

  /** Lower `order` runs first. Targets registered by camp systems, pack, bench, sentry… */
  addReleaseTarget(order: number, fn: ReleaseTarget): () => void {
    const entry = { order, fn };
    this.targets.push(entry);
    this.targets.sort((a, b) => a.order - b.order);
    return () => { this.targets = this.targets.filter((t) => t !== entry); };
  }

  /** A dynamic surface (e.g. the unrolled pack) that catches dropped items. */
  setSurface(id: string, surface: Omit<Surface, 'id'> | null): void {
    this.extraSurfaces = this.extraSurfaces.filter((s) => s.id !== id);
    if (surface) this.extraSurfaces.push({ id, ...surface });
  }

  handOf(entity: Entity): Hand | undefined {
    for (const hand of HANDS) if (this.grips[hand]?.entity === entity) return hand;
    return undefined;
  }

  heldIn(hand: Hand): Entity | undefined {
    return this.grips[hand]?.entity;
  }

  groundAt(x: number, z: number): number {
    let y = terrainHeight(x, z);
    const camp = surfaceHeight(x, z);
    if (camp > y) y = camp;
    for (const s of this.extraSurfaces) if (s.y > y && insideFootprint(s, x, z)) y = s.y;
    return y;
  }

  /** Instantiate a catalog item as a new entity (async: never await in update). */
  async spawnItem(kind: string, x: number, y: number, z: number, options: SpawnOptions = {}): Promise<Entity | undefined> {
    const info = itemInfo(kind);
    if (!info) {
      console.warn(`[Prometheus] Unknown item kind: ${kind}`);
      return undefined;
    }
    const level = this.world.activeLevel.peek();
    let object: Object3D;
    try {
      object = await this.world.assets.instantiate(info.asset);
    } catch (error) {
      console.warn(`[Prometheus] Could not spawn ${kind}`, error);
      return undefined;
    }
    // A New journey swapped the level while the prototype loaded: this item belongs to no journey.
    if (this.world.activeLevel.peek() !== level) return undefined;
    const entity = this.world.createTransformEntity(object);
    entity.addComponent(Item, {
      kind, uid: `rt-${Date.now().toString(36)}-${this.spawnSerial++}`,
      variant: options.variant ?? '', charges: options.charges ?? 0, slot: options.slot ?? '',
    });
    object.position.set(x, y, z);
    if (options.velocity) {
      entity.addComponent(Airborne);
      const v = entity.getVectorView(Airborne, 'velocity');
      v[0] = options.velocity[0]; v[1] = options.velocity[1]; v[2] = options.velocity[2];
    } else if (options.resting !== false) {
      this.restPose(entity, kind, object.rotation.y);
    }
    this.applyVariant(entity);
    this.enforceRuntimeCap();
    return entity;
  }

  /** Over the cap, the oldest loose, resting runtime wood or bolt is cleared away. */
  private enforceRuntimeCap(): void {
    let count = 0;
    let oldest: Entity | undefined;
    let oldestSerial = Infinity;
    for (const entity of this.queries.items.entities) {
      const uid = entity.getValue(Item, 'uid') ?? '';
      if (!uid.startsWith('rt-')) continue;
      count++;
      if (entity.hasComponent(Held) || entity.hasComponent(Airborne) || entity.getValue(Item, 'slot') !== '') continue;
      if (!EVICTABLE.has(entity.getValue(Item, 'kind') ?? '')) continue;
      const serial = Number(uid.slice(uid.lastIndexOf('-') + 1));
      if (serial < oldestSerial) { oldestSerial = serial; oldest = entity; }
    }
    if (count > RUNTIME_CAP && oldest) this.consume(oldest);
  }

  /** Drop an item onto the ground (or a camp surface) below x, z. */
  dropAt(kind: string, x: number, z: number, options: SpawnOptions = {}): Promise<Entity | undefined> {
    const info = itemInfo(kind);
    return this.spawnItem(kind, x, this.groundAt(x, z) + (info?.restY ?? .05) + .25, z, { ...options, velocity: options.velocity ?? [0, 0, 0] });
  }

  /** Hide now, dispose next frame (never dispose inside a query callback). */
  consume(entity: Entity): void {
    if (!entity.active) return;
    this.detach(entity);
    const uid = entity.getValue(Item, 'uid') ?? '';
    if (uid && !uid.startsWith('rt-')) this.consumedUids.add(uid);
    entity.setValue(Item, 'slot', 'consumed');
    this.setAvailable(entity, false);
    this.pendingDispose.push({ entity, generation: entity.generation });
  }

  /**
   * Show/hide an item; hidden items can never be grabbed. `grabbable` lets a visible
   * item stay out of reach of the hands (a deployed sentry).
   */
  setAvailable(entity: Entity, available: boolean, grabbable = available): void {
    const object = entity.object3D;
    if (object) {
      object.visible = available;
      object.pointerEvents = available ? 'auto' : 'none';
    }
    if (grabbable) this.locked.delete(entity.index);
    else {
      this.locked.add(entity.index);
      if (entity.hasComponent(Held)) this.detach(entity);
    }
  }

  /** Open the hand holding this item: it is released exactly as if the player let go. */
  forceRelease(entity: Entity): void {
    const hand = this.handOf(entity);
    if (hand) this.letGo(hand);
  }

  setVariant(entity: Entity, variant: string): void {
    entity.setValue(Item, 'variant', variant);
    this.applyVariant(entity);
  }

  /** Toggle named child groups for kinds with visual variants (see catalog VARIANT_NODES). */
  applyVariant(entity: Entity): void {
    const object = entity.object3D;
    if (!object) return;
    const kind = entity.getValue(Item, 'kind') ?? '';
    const variant = entity.getValue(Item, 'variant') ?? '';
    if (kind === 'meat') {
      const roast = variant === 'roast';
      const raw = object.getObjectByName('raw'), cooked = object.getObjectByName('roast');
      if (raw) raw.visible = !roast;
      if (cooked) cooked.visible = roast;
    } else if (kind === 'bowl') {
      const contents = object.getObjectByName('bowl-contents');
      if (contents) contents.visible = variant !== '' && variant !== 'empty';
    } else if (kind === 'sentry-kit') {
      const deployed = variant === 'deployed';
      const [kitName, deployedName] = VARIANT_NODES['sentry-kit'];
      const kit = object.getObjectByName(kitName), open = object.getObjectByName(deployedName);
      if (kit) kit.visible = !deployed;
      if (open) open.visible = deployed;
      this.bounds.delete(entity.index);
      this.reach.delete(entity.index);
    }
  }

  /**
   * Heading of an object about world Y, robust to any tilt: the flatter of its local
   * Z and X axes, projected onto the ground. (Euler .y folds headings past ±90°.)
   */
  yawOf(object: Object3D): number {
    object.getWorldQuaternion(this.quat2);
    this.dir.set(0, 0, 1).applyQuaternion(this.quat2);
    this.other.set(1, 0, 0).applyQuaternion(this.quat2);
    return Math.abs(this.dir.y) < Math.abs(this.other.y)
      ? Math.atan2(this.dir.x, this.dir.z)
      : Math.atan2(-this.other.z, this.other.x);
  }

  /** Lay an item in its catalog rest pose at its current position, keeping yaw. */
  restPose(entity: Entity, kind: string, yaw: number): void {
    const object = entity.object3D;
    const info = itemInfo(kind);
    if (!object || !info) return;
    object.quaternion.setFromAxisAngle(Y_AXIS, yaw);
    if (info.lie === 'side' || info.lie === 'side-x') {
      this.quat.setFromAxisAngle(info.lie === 'side' ? Z_AXIS : X_AXIS, Math.PI / 2);
      object.quaternion.multiply(this.quat);
    }
  }

  // ---- Grabbing ------------------------------------------------------------------

  private gripSpace(hand: Hand): Object3D | undefined {
    return this.player.gripSpaces?.[hand];
  }

  /** Local-space bounds of an item's visible meshes (outline shells excluded), cached. */
  private localBounds(entity: Entity, object: Object3D): Box3 {
    let box = this.bounds.get(entity.index);
    if (box) return box;
    box = new Box3();
    object.updateWorldMatrix(true, true);
    this.matrix.copy(object.matrixWorld).invert();
    object.traverseVisible((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh || mesh.userData.outline || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      this.box.copy(mesh.geometry.boundingBox!).applyMatrix4(this.matrix2.multiplyMatrices(this.matrix, mesh.matrixWorld));
      box!.union(this.box);
    });
    if (box.isEmpty()) box.setFromCenterAndSize(new Vector3(), new Vector3(.1, .1, .1));
    this.bounds.set(entity.index, box);
    return box;
  }

  /**
   * Distance from a world point to an item's bounds (0 inside), in metres. Items never
   * rescale, so scale and a conservative radius about the origin are cached; far items
   * are rejected from last frame's world translation before any matrix work.
   */
  private reachTo(entity: Entity, object: Object3D, at: Vector3): number {
    const box = this.localBounds(entity, object);
    let reach = this.reach.get(entity.index);
    if (!reach) {
      object.getWorldScale(this.scale);
      const scale = Math.max(this.scale.x, this.scale.y, this.scale.z);
      const x = Math.max(-box.min.x, box.max.x), y = Math.max(-box.min.y, box.max.y), z = Math.max(-box.min.z, box.max.z);
      reach = { scale, radius: Math.hypot(x, y, z) * scale };
      this.reach.set(entity.index, reach);
    }
    const m = object.matrixWorld.elements;
    const dx = m[12] - at.x, dy = m[13] - at.y, dz = m[14] - at.z;
    const limit = reach.radius + GRAB_RADIUS;
    if (dx * dx + dy * dy + dz * dz > limit * limit) return Infinity;
    this.point.copy(at).applyMatrix4(this.matrix.copy(object.matrixWorld).invert());
    return box.distanceToPoint(this.point) * reach.scale;
  }

  private grabbable(entity: Entity): boolean {
    const object = entity.object3D;
    if (!entity.active || !object || !object.visible || this.locked.has(entity.index)) return false;
    const slot = entity.getValue(Item, 'slot') ?? '';
    return slot !== 'consumed' && !slot.startsWith('lost-');
  }

  /** The item a closing hand would take: the closest in reach, including one in the other hand. */
  private candidate(hand: Hand): Entity | undefined {
    const grip = this.gripSpace(hand);
    if (!grip || this.grips[hand]) return undefined;
    grip.getWorldPosition(this.dir);
    let best: Entity | undefined;
    let bestDistance = GRAB_RADIUS;
    for (const entity of this.queries.items.entities) {
      if (!this.grabbable(entity)) continue;
      const d = this.reachTo(entity, entity.object3D!, this.dir);
      if (d < bestDistance) { bestDistance = d; best = entity; }
    }
    return best;
  }

  /** Right-hand hold pose (item relative to grip), mirrored for the left hand. */
  private holdPose(entity: Entity, hand: Hand, pos: Vector3, quat: Quaternion): void {
    const kind = entity.getValue(Item, 'kind') ?? '';
    const hold = itemInfo(kind)?.hold ?? { frame: 'level' as const };
    quat.copy(hold.flip ? FLIPPED_TOOL : FRAME_ROTATION[hold.frame]);
    if (hold.roll) quat.premultiply(this.quat2.setFromAxisAngle(Z_AXIS, hold.roll * DEG));
    if (hold.frame === 'carry') {
      const box = this.localBounds(entity, entity.object3D!);
      pos.set((box.min.x + box.max.x) / 2, box.max.y - .03, (box.min.z + box.max.z) / 2);
    } else if (hold.at) pos.set(hold.at[0], hold.at[1], hold.at[2]);
    else pos.set(0, 0, 0);
    entity.object3D!.getWorldScale(this.scale);
    pos.multiply(this.scale).applyQuaternion(quat).negate();
    if (hand === 'left') {
      pos.x = -pos.x;
      quat.set(quat.x, -quat.y, -quat.z, quat.w);
    }
  }

  private grab(hand: Hand, entity: Entity): void {
    const grip = this.gripSpace(hand);
    const object = entity.object3D;
    if (!grip || !object) return;
    const from = this.handOf(entity);
    if (from) this.grips[from] = undefined;
    grip.updateWorldMatrix(true, false);
    object.updateWorldMatrix(true, false);
    // Current pose relative to the grip: the snap eases from here.
    this.matrix.copy(grip.matrixWorld).invert().multiply(object.matrixWorld);
    const g: Grip = {
      entity, fromPos: new Vector3(), fromQuat: new Quaternion(), toPos: new Vector3(), toQuat: new Quaternion(), t: 0,
    };
    this.matrix.decompose(g.fromPos, g.fromQuat, this.scale);
    this.holdPose(entity, hand, g.toPos, g.toQuat);
    this.grips[hand] = g;
    this.setHover(hand, undefined);
    if (from) {
      entity.setValue(Held, 'hand', hand);
    } else {
      if (entity.hasComponent(Airborne)) entity.removeComponent(Airborne);
      this.samples.set(entity.index, new Float32Array(SAMPLES * 4));
      this.sampleCount.set(entity.index, 0);
      entity.setValue(Item, 'slot', 'hand');
      entity.addComponent(Held, { hand });
    }
    pulse(this.input, hand, .35, 25);
    object.getWorldPosition(this.point);
    bus.emit({ type: 'grab', kind: entity.getValue(Item, 'kind') ?? '', x: this.point.x, y: this.point.y, z: this.point.z });
  }

  /** The hand opens: release targets decide where the item goes, else it falls or flies. */
  private letGo(hand: Hand): void {
    const g = this.grips[hand];
    if (!g) return;
    this.grips[hand] = undefined;
    const entity = g.entity;
    this.releaseVelocity(entity.index, this.velocity);
    this.samples.delete(entity.index);
    if (entity.hasComponent(Held)) entity.removeComponent(Held);
    if (!entity.active || entity.getValue(Item, 'slot') !== 'hand') return;
    this.release(entity, hand);
  }

  /** Take an item out of a hand without releasing it anywhere (consumed, locked). */
  private detach(entity: Entity): void {
    const hand = this.handOf(entity);
    if (hand) this.grips[hand] = undefined;
    this.samples.delete(entity.index);
    if (entity.active && entity.hasComponent(Held)) entity.removeComponent(Held);
  }

  private forget(entity: Entity): void {
    this.detach(entity);
    this.bounds.delete(entity.index);
    this.reach.delete(entity.index);
    this.sampleCount.delete(entity.index);
    this.outlines.delete(entity.index);
    this.locked.delete(entity.index);
    for (const hand of HANDS) if (this.hovered[hand] === entity) this.hovered[hand] = undefined;
  }

  private setHover(hand: Hand, entity: Entity | undefined): void {
    const previous = this.hovered[hand];
    if (previous === entity) return;
    this.hovered[hand] = entity;
    if (previous && previous !== this.hovered[hand === 'left' ? 'right' : 'left']) this.showOutline(previous, false);
    if (entity) {
      this.showOutline(entity, true);
      pulse(this.input, hand, .22, 16);
    }
  }

  /** Per-axis shell scale for a sheet-like mesh (one dimension < 12% of the others), else null. */
  private flatShell(mesh: Mesh): Vector3 | null {
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(this.dir);
    const longest = Math.max(size.x, size.y, size.z);
    if (longest <= 0) return null;
    const thin = Math.min(size.x, size.y, size.z);
    if (thin > longest * .12) return null;
    const grow = (edge: number) => (edge === thin ? 1 : 1 + .03 / Math.max(edge, .01));
    return new Vector3(grow(size.x), grow(size.y), grow(size.z));
  }

  private showOutline(entity: Entity, visible: boolean): void {
    let shells = this.outlines.get(entity.index);
    if (!shells) {
      if (!visible || !entity.object3D) return;
      shells = [];
      const meshes: Mesh[] = [];
      entity.object3D.traverse((child) => {
        const mesh = child as Mesh;
        if (mesh.isMesh && !mesh.userData.outline && mesh.geometry?.attributes.normal) meshes.push(mesh);
      });
      for (const mesh of meshes) {
        const flat = this.flatShell(mesh);
        const shell = new Mesh(mesh.geometry, flat ? OUTLINE_FLAT : OUTLINE);
        // Sheet-like items (pages, cloth) have almost no edge to extrude: widen the shell
        // across the sheet instead, so a rim shows around it seen from above.
        if (flat) shell.scale.set(flat.x, flat.y, flat.z);
        shell.userData.outline = true;
        shell.raycast = () => {};
        shell.renderOrder = -1;
        mesh.add(shell);
        shells.push(shell);
      }
      this.outlines.set(entity.index, shells);
    }
    for (const shell of shells) shell.visible = visible;
  }

  private updateHands(delta: number): void {
    const gamepads = this.input.xr.gamepads;
    if (this.world.visibilityState.peek() !== 'visible') {
      // System menu, headset off, or back on desktop: hands open.
      for (const hand of HANDS) if (this.grips[hand]) this.letGo(hand);
      return;
    }
    for (const hand of HANDS) {
      const pad = gamepads[hand];
      const g = this.grips[hand];
      if (g && (!g.entity.active || !g.entity.hasComponent(Held))) this.grips[hand] = undefined;
      // Level-based: a controller that sleeps or loses tracking opens the hand too.
      if (this.grips[hand] && !(pad?.getButtonPressed(InputComponent.Squeeze) ?? false)) this.letGo(hand);
      const candidate = this.candidate(hand);
      if (!this.grips[hand] && candidate && pad?.getButtonDown(InputComponent.Squeeze)) this.grab(hand, candidate);
      else this.setHover(hand, this.grips[hand] ? undefined : candidate);
    }
    OUTLINE.opacity = OUTLINE_FLAT.opacity = .72 + .23 * Math.sin(this.elapsed * 6);

    for (const hand of HANDS) {
      const g = this.grips[hand];
      const grip = this.gripSpace(hand);
      const object = g?.entity.object3D;
      if (!g || !grip || !object) continue;
      g.t = Math.min(1, g.t + delta / SNAP_SECONDS);
      const s = g.t * g.t * (3 - 2 * g.t);
      this.point.lerpVectors(g.fromPos, g.toPos, s);
      this.quat.slerpQuaternions(g.fromQuat, g.toQuat, s);
      object.getWorldScale(this.scale);
      grip.updateWorldMatrix(true, false);
      this.matrix.compose(this.point, this.quat, this.scale).premultiply(grip.matrixWorld);
      if (object.parent) {
        object.parent.updateWorldMatrix(true, false);
        this.matrix.premultiply(this.matrix2.copy(object.parent.matrixWorld).invert());
      }
      this.matrix.decompose(object.position, object.quaternion, this.scale);
      object.updateMatrixWorld();
    }
  }

  // ---- Surfaces --------------------------------------------------------------------

  private registerSurface(entity: Entity): void {
    const object = entity.object3D;
    if (!object) return;
    object.updateWorldMatrix(true, true);
    const box = new Box3().setFromObject(object, true);
    if (box.isEmpty()) return;
    // Oriented footprint: local bounds, turned by the prop's yaw.
    this.matrix.copy(object.matrixWorld).invert();
    const local = new Box3();
    object.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      local.union(this.box.copy(mesh.geometry.boundingBox!).applyMatrix4(this.matrix2.multiplyMatrices(this.matrix, mesh.matrixWorld)));
    });
    object.getWorldScale(this.scale);
    object.getWorldQuaternion(this.quat);
    this.dir.set(1, 0, 0).applyQuaternion(this.quat);
    local.getCenter(this.point).applyMatrix4(object.matrixWorld);
    const inset = entity.getValue(ItemSurface, 'inset') ?? .03;
    this.setSurface(`prop-${entity.index}`, {
      x: this.point.x, z: this.point.z,
      hx: Math.max(.02, (local.max.x - local.min.x) * .5 * this.scale.x - inset),
      hz: Math.max(.02, (local.max.z - local.min.z) * .5 * this.scale.z - inset),
      yawDeg: yawFromXAxis(this.dir.x, this.dir.z),
      y: box.max.y + (entity.getValue(ItemSurface, 'lift') ?? 0),
    });
  }

  // ---- Release and flight ----------------------------------------------------------

  private releaseVelocity(index: number, out: Vector3): Vector3 {
    out.set(0, 0, 0);
    const ring = this.samples.get(index);
    const count = this.sampleCount.get(index) ?? 0;
    if (!ring || count < 2) return out;
    const newest = (count - 1) % SAMPLES;
    const oldest = count >= SAMPLES ? count % SAMPLES : 0;
    const dt = ring[newest * 4 + 3] - ring[oldest * 4 + 3];
    if (dt <= 1e-3) return out;
    out.set(ring[newest * 4] - ring[oldest * 4], ring[newest * 4 + 1] - ring[oldest * 4 + 1], ring[newest * 4 + 2] - ring[oldest * 4 + 2]).divideScalar(dt);
    if (out.length() > THROW.maxSpeed) out.setLength(THROW.maxSpeed);
    return out;
  }

  private release(entity: Entity, hand: Hand | undefined): void {
    const object = entity.object3D;
    if (!object) return;
    const kind = entity.getValue(Item, 'kind') ?? '';
    object.getWorldPosition(this.point);
    entity.setValue(Item, 'slot', '');
    for (const target of this.targets) {
      if (target.fn(entity, kind, this.point, this.velocity, hand)) return;
    }
    this.launch(entity, kind, this.velocity);
  }

  /** Start ballistic flight with the given velocity (a gentle drop below THROW.minThrowSpeed). */
  launch(entity: Entity, kind: string, velocity: Vector3): void {
    const speed = velocity.length();
    if (!entity.hasComponent(Airborne)) entity.addComponent(Airborne);
    const v = entity.getVectorView(Airborne, 'velocity');
    const spin = entity.getVectorView(Airborne, 'spin');
    if (speed < THROW.minThrowSpeed) {
      v[0] = v[1] = v[2] = 0;
      spin[0] = spin[1] = spin[2] = 0;
    } else {
      v[0] = velocity.x; v[1] = velocity.y; v[2] = velocity.z;
      const pointed = kind === 'spear' || kind === 'bolt';
      spin[0] = pointed ? 0 : velocity.z * 1.5;
      spin[1] = pointed ? 0 : speed * .6;
      spin[2] = pointed ? 0 : -velocity.x * 1.5;
      if (speed > 1.2) bus.emit({ type: 'throw', kind, speed, x: this.point.x, y: this.point.y, z: this.point.z });
    }
    entity.setValue(Airborne, 'damage', speed >= THROW.damageSpeed && kind === 'spear' ? 2 : 0);
    entity.setValue(Airborne, 'age', 0);
  }

  update(delta: number): void {
    this.elapsed += delta;
    for (const { entity, generation } of this.pendingDispose) {
      if (entity.active && entity.generation === generation) entity.dispose({ disposeResources: false });
    }
    this.pendingDispose.length = 0;

    this.updateHands(delta);

    for (const entity of this.queries.held.entities) {
      const ring = this.samples.get(entity.index);
      const object = entity.object3D;
      if (!ring || !object) continue;
      const count = this.sampleCount.get(entity.index) ?? 0;
      object.getWorldPosition(this.point);
      const slot = (count % SAMPLES) * 4;
      ring[slot] = this.point.x; ring[slot + 1] = this.point.y; ring[slot + 2] = this.point.z; ring[slot + 3] = this.elapsed;
      this.sampleCount.set(entity.index, count + 1);
    }

    const dt = Math.min(delta, 1 / 30);
    for (const entity of this.queries.airborne.entities) {
      const object = entity.object3D;
      if (!object) continue;
      const kind = entity.getValue(Item, 'kind') ?? '';
      const v = entity.getVectorView(Airborne, 'velocity');
      const spin = entity.getVectorView(Airborne, 'spin');
      entity.setValue(Airborne, 'age', (entity.getValue(Airborne, 'age') ?? 0) + dt);
      v[1] -= THROW.gravity * dt;
      object.position.x = Math.min(WORLD_BOUNDS.maxX, Math.max(WORLD_BOUNDS.minX, object.position.x + v[0] * dt));
      object.position.y += v[1] * dt;
      object.position.z = Math.min(WORLD_BOUNDS.maxZ, Math.max(WORLD_BOUNDS.minZ, object.position.z + v[2] * dt));
      const speed = Math.hypot(v[0], v[1], v[2]);
      if (kind === 'spear' || kind === 'bolt') {
        if (speed > .5) {
          this.dir.set(v[0], v[1], v[2]).divideScalar(speed);
          object.quaternion.setFromUnitVectors(kind === 'spear' ? Y_AXIS : NEG_Z, this.dir);
        }
      } else if (spin[0] || spin[1] || spin[2]) {
        object.rotation.x += spin[0] * dt;
        object.rotation.y += spin[1] * dt;
        object.rotation.z += spin[2] * dt;
      }
      const info = itemInfo(kind);
      const floor = this.groundAt(object.position.x, object.position.z) + (info?.restY ?? .05);
      if (object.position.y > floor || v[1] > 0) continue;
      object.position.y = floor;
      if (speed > 2.5 && (kind !== 'spear' && kind !== 'bolt')) {
        v[0] *= .4; v[2] *= .4; v[1] = -v[1] * THROW.bounce;
        entity.setValue(Airborne, 'damage', 0);
        continue;
      }
      entity.removeComponent(Airborne);
      if (kind === 'spear' || kind === 'bolt') {
        // Stick into the ground at a slight angle rather than lying flat.
        object.position.y = floor + (kind === 'spear' ? .25 : .05);
      } else {
        this.restPose(entity, kind, this.yawOf(object));
      }
      bus.emit({ type: 'drop', kind, x: object.position.x, y: object.position.y, z: object.position.z, hard: speed > 3 });
      // Tossed into the fire, dropped into a bay or onto the pack: the target
      // takes it where it lands, exactly as if it had been placed there.
      if (kind !== 'bolt' && entity.getValue(Item, 'slot') === '') {
        this.point.copy(object.position);
        this.velocity.set(0, 0, 0);
        for (const target of this.targets) if (target.fn(entity, kind, this.point, this.velocity, undefined)) break;
      }
    }
  }
}
