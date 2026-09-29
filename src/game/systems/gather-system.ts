import { Box3, createSystem, Entity, InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Vector3, VisibilityState } from '@iwsdk/core';
import { BROADLEAVES } from '../../scene-assets/valley-layout.scene-asset.js';
import { bus } from '../bus.js';
import { ITEMS } from '../catalog.js';
import { Held, Item, ResourceNode } from '../components.js';
import { pulse } from '../haptics.js';
import { SURFACES } from '../rules.js';
import { terrainHeight } from '../terrain.js';
import { ItemSystem } from './item-system.js';

const AXE_TIP = new Vector3(...ITEMS.axe.tip);
const STUMP = SURFACES.find((s) => s.id === 'stump')!;
const SWEEP_SECONDS = .5;
/**
 * Optional named child of a forage node visual that disappears while it regrows. Today's
 * nodes show only their source (no copies of the item), so none carries one.
 */
const HARVEST_PARTS = ['resin', 'mushrooms', 'berries', 'herbs', 'reeds', 'flint', 'canvas'];
const CHOP_SPEED = 1.8;

/**
 * A node's bounds in its own frame (tight for a trunk lying along its local X, however
 * the node is yawed), the world→local transform, and its world centre for yields.
 */
type NodeShape = { x: number; y: number; z: number; radius: number; box: Box3; toLocal: Matrix4 };

/**
 * Standing trees: three blows on the trunk shake down two sticks (every third harvest
 * also drops a log) at the chopper's side of its foot, then the tree rests before it
 * yields again. Trees stay standing.
 */
export const TREE_CHOP = {
  hits: 3,
  restSeconds: 120,
  /** How far off the bark the blade still counts as a blow (m). */
  contact: .08,
  /** Pull the blade this far off the bark to arm the next blow (m). */
  rearm: .3,
  /** Partial chopping is forgotten after this long (s). */
  forgetSeconds: 25,
  /** Only trees within this reach of the axe tip are tested (m). */
  reach: 3,
  logEvery: 3,
  /**
   * Blows count anywhere the blade can reach on the trunk, from the root flare to above
   * the head (m above the trunk's foot), whatever the tree's size.
   */
  bandBottom: .1,
  bandTop: 2.3,
  /** Softer contact (a slow swing, or bark above the band) still knocks: a tap and a light buzz. */
  knockSpeed: .5,
  knockTop: 3.2,
} as const;
/**
 * Trunk radius at chopping height, per unit of the tree's horizontal scale. GLB pines are
 * measured in source units; the procedural pines' trunks run r .17 → .07 up to the first tier.
 */
const GLB_PINES: Record<string, { r: number }> = { 'pine-1': { r: .2 }, 'pine-2': { r: .2 } };
const PATTERN_PINES: Record<string, { r: number }> = { 'valley-pine': { r: .13 }, 'valley-pine-tall': { r: .13 } };
const CELL = 4;
const cellKey = (x: number, z: number) => (Math.floor(x / CELL) + 1024) * 4096 + Math.floor(z / CELL) + 1024;

type Trunk = { x: number; z: number; y: number; r: number; hits: number; readyAt: number; lastHit: number; armed: boolean };

/** Chopping deadwood and standing trees, splitting logs on the stump, and forage regrowth. */
export class GatherSystem extends createSystem({
  nodes: { required: [ResourceNode] },
  items: { required: [Item] },
  held: { required: [Item, Held] },
}) {
  private forage = new Map<number, Entity>();
  private spawning = new Set<number>();
  private shapes = new Map<number, NodeShape>();
  private armed = new Map<number, boolean>();
  private splitHits = new Map<number, number>();
  private box = new Box3();
  private sphereCenter = new Vector3();
  private tip = new Vector3();
  /** Last frame's blade tip in the player rig's frame. */
  private previousTip = new Vector3();
  private tipLocal = new Vector3();
  private hasPreviousTip = false;
  private point = new Vector3();
  private elapsed = 0;
  private sweep = 0;
  private cooldown = 0;
  private stumpArmed = true;
  private parts = new Map<number, Object3D | null>();
  /** Choppable trunks, indexed once per level load (undefined = not built yet). */
  private trunks: Trunk[] | undefined;
  private trunkCells = new Map<number, Trunk[]>();
  private trunkRetryAt = 0;
  private treeHarvests = 0;
  private restNoticeAt = -Infinity;
  /** Bumped on every level change: a forage spawn that resolves after one belongs to no node. */
  private generation = 0;
  private itemSystem?: ItemSystem;

  /** ItemSystem, looked up once (registered before this system). */
  private get items(): ItemSystem | undefined {
    return this.itemSystem ??= this.world.getSystem(ItemSystem);
  }

  init(): void {
    this.cleanupFuncs.push(
      this.queries.nodes.subscribe('disqualify', (node) => {
        this.forage.delete(node.index);
        this.shapes.delete(node.index);
        this.parts.delete(node.index);
        this.armed.delete(node.index);
      }),
      this.queries.items.subscribe('disqualify', (item) => { this.splitHits.delete(item.index); }),
      this.queries.held.subscribe('disqualify', () => { this.hasPreviousTip = false; }),
      // A level is fully built when it becomes active: index its trees on the next frame.
      this.world.activeLevel.subscribe(() => {
        this.generation++;
        this.forage.clear();
        this.spawning.clear();
        this.shapes.clear();
        this.parts.clear();
        this.armed.clear();
        this.splitHits.clear();
        this.trunks = undefined;
        this.trunkCells.clear();
        this.trunkRetryAt = 0;
      }),
    );
  }

  private shapeOf(node: Entity): NodeShape | undefined {
    let shape = this.shapes.get(node.index);
    const object = node.object3D;
    if (shape || !object) return shape;
    object.updateWorldMatrix(true, true);
    const toLocal = new Matrix4().copy(object.matrixWorld).invert();
    const local = new Box3(), part = new Box3(), matrix = new Matrix4();
    object.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      local.union(part.copy(mesh.geometry.boundingBox!).applyMatrix4(matrix.multiplyMatrices(toLocal, mesh.matrixWorld)));
    });
    if (local.isEmpty()) return undefined;
    local.getCenter(this.sphereCenter).applyMatrix4(object.matrixWorld);
    const size = local.getSize(this.point);
    shape = {
      x: this.sphereCenter.x, y: this.sphereCenter.y, z: this.sphereCenter.z,
      radius: Math.max(.25, Math.max(size.x, size.z) * .5), box: local, toLocal,
    };
    this.shapes.set(node.index, shape);
    return shape;
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.cooldown = Math.max(0, this.cooldown - delta);
    // Trees are indexed as soon as a level is up, never on the first swing.
    if ((!this.trunks || this.trunks.length === 0) && this.elapsed >= this.trunkRetryAt) {
      this.buildTrunks();
      if (this.trunks!.length === 0) this.trunkRetryAt = this.elapsed + 1;
    }
    this.sweep -= delta;
    if (this.sweep <= 0) {
      this.sweep = SWEEP_SECONDS;
      this.sweepNodes();
    }
    const visibility = this.visibilityState.peek();
    if (visibility === VisibilityState.VisibleBlurred || visibility === VisibilityState.Hidden || delta > .15) {
      this.hasPreviousTip = false;
      return;
    }
    let axe: Entity | undefined;
    for (const entity of this.queries.held.entities) if (entity.getValue(Item, 'kind') === 'axe') axe = entity;
    if (!axe?.object3D) {
      this.hasPreviousTip = false;
      return;
    }
    axe.object3D.updateWorldMatrix(true, false);
    this.tip.copy(AXE_TIP);
    axe.object3D.localToWorld(this.tip);
    // Swing speed is measured in the player rig's frame: walking or turning with an axe in
    // hand never counts as a blow, only the arm's own swing does.
    this.player.updateWorldMatrix(true, false);
    this.tipLocal.copy(this.tip);
    this.player.worldToLocal(this.tipLocal);
    const speed = this.hasPreviousTip ? this.tipLocal.distanceTo(this.previousTip) / Math.max(delta, 1e-3) : 0;
    this.previousTip.copy(this.tipLocal);
    this.hasPreviousTip = true;
    const hand = this.items?.handOf(axe);

    for (const node of this.queries.nodes.entities) {
      const needed = node.getValue(ResourceNode, 'hitsNeeded') ?? 0;
      if (needed <= 0 || !node.getValue(ResourceNode, 'available')) continue;
      const shape = this.shapeOf(node);
      if (!shape) continue;
      // The whole log is a target (ends included); a short pull-back re-arms the next blow.
      const distance = shape.box.distanceToPoint(this.point.copy(this.tip).applyMatrix4(shape.toLocal));
      if (distance > .35) this.armed.set(node.index, true);
      if (distance < .08 && speed > CHOP_SPEED && this.armed.get(node.index) !== false && this.cooldown === 0) {
        this.armed.set(node.index, false);
        this.cooldown = .3;
        this.chopNode(node, needed, shape, hand);
      }
    }
    this.chopTrees(speed, hand);
    this.splitOnStump(speed, hand);
  }

  /**
   * Index every standing tree once: GLB pines and instanced pattern pines are read from
   * the loaded scene (so authored moves carry over), broadleaves from the layout data
   * they are baked from. Bucketed on a 4 m grid so a swing only tests nearby trunks.
   */
  private buildTrunks(): void {
    const trunks: Trunk[] = [];
    const add = (x: number, z: number, r: number) => {
      trunks.push({ x, z, y: terrainHeight(x, z), r, hits: 0, readyAt: 0, lastHit: -Infinity, armed: true });
    };
    const matrix = new Matrix4(), position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
    const root = this.world.getActiveRoot();
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      const asset = object.userData.iwsdkSceneAssetId as string | undefined;
      const mesh = object as InstancedMesh;
      if (mesh.isInstancedMesh) {
        const prefab = (object.parent?.userData.iwsdkSceneContent as { prefab?: string } | undefined)?.prefab ?? '';
        const kind = PATTERN_PINES[prefab];
        if (!kind) return;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          matrix.premultiply(mesh.matrixWorld).decompose(position, quaternion, scale);
          add(position.x, position.z, kind.r * scale.x);
        }
        return;
      }
      const kind = asset ? GLB_PINES[asset] ?? PATTERN_PINES[asset] : undefined;
      if (!kind) return;
      object.matrixWorld.decompose(position, quaternion, scale);
      add(position.x, position.z, kind.r * scale.x);
    });
    for (const t of BROADLEAVES) add(t.x, t.z, t.h * .058);
    this.trunkCells.clear();
    for (const trunk of trunks) {
      // Register each trunk in every cell its reach touches, so one cell lookup finds it.
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const key = cellKey(trunk.x + dx * TREE_CHOP.reach, trunk.z + dz * TREE_CHOP.reach);
        let list = this.trunkCells.get(key);
        if (!list) this.trunkCells.set(key, list = []);
        if (!list.includes(trunk)) list.push(trunk);
      }
    }
    this.trunks = trunks;
  }

  /**
   * Axe blows into a standing trunk (only trees in the tip's cell are tested). A brisk
   * blow anywhere from the root flare to above the head counts; any other contact
   * (a slow swing, bark out of the band) still knocks, so the tree never ignores the axe.
   */
  private chopTrees(speed: number, hand: 'left' | 'right' | undefined): void {
    const nearby = this.trunkCells.get(cellKey(this.tip.x, this.tip.z));
    if (!nearby) return;
    for (let i = 0; i < nearby.length; i++) {
      const trunk = nearby[i];
      const dx = this.tip.x - trunk.x, dz = this.tip.z - trunk.z;
      const bark = Math.sqrt(dx * dx + dz * dz) - trunk.r;
      if (bark > TREE_CHOP.rearm) {
        trunk.armed = true;
        continue;
      }
      if (bark >= TREE_CHOP.contact || !trunk.armed || this.cooldown > 0) continue;
      const up = this.tip.y - trunk.y;
      if (up < 0 || up > TREE_CHOP.knockTop) continue;
      const inBand = up >= TREE_CHOP.bandBottom && up <= TREE_CHOP.bandTop;
      if (inBand && speed > CHOP_SPEED) {
        trunk.armed = false;
        this.cooldown = .3;
        this.chopTree(trunk, dx, dz, hand);
      } else if (speed > TREE_CHOP.knockSpeed) {
        trunk.armed = false;
        this.cooldown = .2;
        pulse(this.input, hand, .3, 25);
        bus.emit({ type: 'thud', kind: 'tree', x: this.tip.x, y: this.tip.y, z: this.tip.z });
      }
    }
  }

  private chopTree(trunk: Trunk, dx: number, dz: number, hand: 'left' | 'right' | undefined): void {
    pulse(this.input, hand, .9, 60);
    if (this.elapsed < trunk.readyAt) {
      // Already shaken bare: the blade knocks without biting.
      bus.emit({ type: 'thud', kind: 'axe', x: this.tip.x, y: this.tip.y, z: this.tip.z });
      if (this.elapsed - this.restNoticeAt > 20) {
        this.restNoticeAt = this.elapsed;
        bus.emit({ type: 'toast', text: 'This tree is bare for now', body: 'Try another tree, or come back later.', tone: 'info' });
      }
      return;
    }
    if (this.elapsed - trunk.lastHit > TREE_CHOP.forgetSeconds) trunk.hits = 0;
    trunk.lastHit = this.elapsed;
    trunk.hits++;
    bus.emit({ type: 'chop', node: 'tree', remaining: Math.max(0, TREE_CHOP.hits - trunk.hits), x: this.tip.x, y: this.tip.y, z: this.tip.z });
    if (trunk.hits < TREE_CHOP.hits) return;
    trunk.hits = 0;
    trunk.readyAt = this.elapsed + TREE_CHOP.restSeconds;
    // Drop at the foot on the chopper's side, clear of the trunk.
    const length = Math.sqrt(dx * dx + dz * dz) || 1;
    const ux = dx / length, uz = dz / length, foot = trunk.r + .45;
    const items = this.items!;
    void items.dropAt('stick', trunk.x + ux * foot - uz * .28, trunk.z + uz * foot + ux * .28);
    void items.dropAt('stick', trunk.x + ux * (foot + .2) + uz * .22, trunk.z + uz * (foot + .2) - ux * .22);
    if (this.treeHarvests++ % TREE_CHOP.logEvery === 0) void items.dropAt('log', trunk.x + ux * (foot + .45), trunk.z + uz * (foot + .45));
    bus.emit({ type: 'harvest', kind: 'stick', x: trunk.x + ux * foot, y: trunk.y + .1, z: trunk.z + uz * foot });
  }

  private chopNode(node: Entity, needed: number, shape: NodeShape, hand: 'left' | 'right' | undefined): void {
    const hits = (node.getValue(ResourceNode, 'hits') ?? 0) + 1;
    node.setValue(ResourceNode, 'hits', hits);
    pulse(this.input, hand, .9, 60);
    bus.emit({ type: 'chop', node: node.getValue(ResourceNode, 'kind') ?? 'deadwood', remaining: Math.max(0, needed - hits), x: this.tip.x, y: this.tip.y, z: this.tip.z });
    if (hits < needed) return;
    node.setValue(ResourceNode, 'hits', 0);
    node.setValue(ResourceNode, 'available', false);
    node.setValue(ResourceNode, 'regrowAt', this.elapsed + (node.getValue(ResourceNode, 'regrowSeconds') ?? 240));
    if (node.object3D) node.object3D.visible = false;
    const items = this.items!;
    const yields = (node.getValue(ResourceNode, 'yields') ?? '').split(',').filter(Boolean);
    yields.forEach((kind, i) => {
      const angle = i * 2.1 + .4;
      void items.dropAt(kind.trim(), shape.x + Math.cos(angle) * .35, shape.z + Math.sin(angle) * .35);
    });
    bus.emit({ type: 'harvest', kind: yields[0] ?? 'log', x: shape.x, y: shape.y, z: shape.z });
  }

  /** A log resting on the chopping stump splits into two planks after two blows. */
  private splitOnStump(speed: number, hand: 'left' | 'right' | undefined): void {
    let log: Entity | undefined;
    for (const entity of this.queries.items.entities) {
      if (entity.getValue(Item, 'kind') !== 'log' || entity.getValue(Item, 'slot') !== '' || !entity.object3D) continue;
      const p = entity.object3D.position;
      if (Math.hypot(p.x - STUMP.x, p.z - STUMP.z) < .3 && p.y > STUMP.y && p.y < STUMP.y + .25) log = entity;
    }
    if (!log?.object3D) return;
    const p = log.object3D.position;
    const distance = Math.hypot(this.tip.x - p.x, this.tip.y - p.y, this.tip.z - p.z);
    if (distance > .3) this.stumpArmed = true;
    if (distance > .16 || speed < CHOP_SPEED || !this.stumpArmed || this.cooldown > 0) return;
    this.stumpArmed = false;
    this.cooldown = .3;
    const hits = (this.splitHits.get(log.index) ?? 0) + 1;
    this.splitHits.set(log.index, hits);
    pulse(this.input, hand, .9, 60);
    bus.emit({ type: 'chop', node: 'stump', remaining: Math.max(0, 2 - hits), x: p.x, y: p.y, z: p.z });
    if (hits < 2) return;
    this.splitHits.delete(log.index);
    const items = this.items!;
    items.consume(log);
    void items.dropAt('plank', STUMP.x + .35, STUMP.z + .1);
    void items.dropAt('plank', STUMP.x - .1, STUMP.z + .38);
    bus.emit({ type: 'harvest', kind: 'plank', x: p.x, y: p.y, z: p.z });
  }

  private showHarvestPart(node: Entity, visible: boolean): void {
    let part = this.parts.get(node.index);
    if (part === undefined) {
      part = null;
      for (const name of HARVEST_PARTS) {
        const found = node.object3D?.getObjectByName(name);
        if (found) { part = found; break; }
      }
      this.parts.set(node.index, part);
    }
    if (part && part.visible !== visible) part.visible = visible;
  }

  /** Forage nodes keep one real item waiting at their spawn point; taking it starts regrowth. */
  private sweepNodes(): void {
    const items = this.items;
    if (!items) return;
    for (const node of this.queries.nodes.entities) {
      const needed = node.getValue(ResourceNode, 'hitsNeeded') ?? 0;
      const available = node.getValue(ResourceNode, 'available') !== false;
      const regrowAt = node.getValue(ResourceNode, 'regrowAt') ?? 0;
      if (!available) {
        if (regrowAt <= 0) node.setValue(ResourceNode, 'regrowAt', this.elapsed + (node.getValue(ResourceNode, 'regrowSeconds') ?? 180));
        else if (this.elapsed >= regrowAt) {
          node.setValue(ResourceNode, 'available', true);
          node.setValue(ResourceNode, 'regrowAt', 0);
          if (node.object3D) node.object3D.visible = true;
        }
        if (needed > 0 && node.object3D) node.object3D.visible = node.getValue(ResourceNode, 'available') === true;
        else this.showHarvestPart(node, node.getValue(ResourceNode, 'available') === true);
        continue;
      }
      if (needed > 0) continue;
      this.showHarvestPart(node, true);
      const tracked = this.forage.get(node.index);
      if (tracked) {
        // Taken the moment a hand closes on it: the node's part hides and the rustle plays at the pick.
        if (tracked.active && tracked.getValue(Item, 'slot') === 'node' && !tracked.hasComponent(Held)) continue;
        this.forage.delete(node.index);
        node.setValue(ResourceNode, 'available', false);
        node.setValue(ResourceNode, 'regrowAt', this.elapsed + (node.getValue(ResourceNode, 'regrowSeconds') ?? 180));
        node.object3D?.getWorldPosition(this.point);
        bus.emit({ type: 'harvest', kind: node.getValue(ResourceNode, 'kind') ?? '', x: this.point.x, y: this.point.y, z: this.point.z });
        continue;
      }
      if (this.spawning.has(node.index) || !node.object3D) continue;
      const kind = (node.getValue(ResourceNode, 'yields') ?? '').split(',')[0]?.trim();
      if (!kind) continue;
      node.object3D.getWorldPosition(this.point);
      this.spawning.add(node.index);
      const index = node.index, generation = this.generation;
      // Whatever happens to the spawn, the node is free to try again (unless the level changed under it).
      void items.spawnItem(kind, this.point.x, this.point.y, this.point.z, { slot: 'node' })
        .then((entity) => {
          if (entity && node.active && generation === this.generation) this.forage.set(index, entity);
        })
        .catch((error: unknown) => console.warn(`[Prometheus] forage spawn failed (${kind})`, error))
        .finally(() => { if (generation === this.generation) this.spawning.delete(index); });
    }
  }
}
