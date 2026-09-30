import { createSystem, Entity, Object3D, Vector3, VisibilityState } from '@iwsdk/core';
import { bus } from '../bus.js';
import { ITEMS } from '../catalog.js';
import { Held, Item, ResourceNode } from '../components.js';
import { pulse } from '../haptics.js';
import { SURFACES } from '../rules.js';
import { ForestSystem } from './forest-system.js';
import { ItemSystem } from './item-system.js';

const AXE_TIP = new Vector3(...ITEMS.axe.tip);
const STUMP = SURFACES.find((s) => s.id === 'stump')!;
const SWEEP_SECONDS = .5;
/** A forage node whose spawn failed waits this long before trying again (s). */
const FORAGE_RETRY_SECONDS = 10;
/**
 * Optional named child of a forage node visual that disappears while it regrows. Today's
 * nodes show only their source (no copies of the item), so none carries one.
 */
const HARVEST_PARTS = ['resin', 'mushrooms', 'berries', 'herbs', 'reeds', 'flint', 'canvas'];
const CHOP_SPEED = 1.8;

/**
 * Axe blows on standing trees (ForestSystem owns the trees; FELL in ../forest.ts says how
 * many blows fell one, and how it falls and regrows).
 */
export const TREE_CHOP = {
  /** How far off the bark the blade still counts as a blow (m). */
  contact: .08,
  /** Pull the blade this far off the bark to arm the next blow (m). */
  rearm: .3,
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
/** Felling standing trees, splitting logs on the stump, and forage regrowth. */
export class GatherSystem extends createSystem({
  nodes: { required: [ResourceNode] },
  items: { required: [Item] },
  held: { required: [Item, Held] },
}) {
  private forage = new Map<number, Entity>();
  private spawning = new Set<number>();
  /** Forage nodes whose last spawn failed: the time they may try again. */
  private retryAt = new Map<number, number>();
  private splitHits = new Map<number, number>();
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
  private youngNoticeAt = -Infinity;
  /** Bumped on every level change: a forage spawn that resolves after one belongs to no node. */
  private generation = 0;
  private itemSystem?: ItemSystem;
  private forestSystem?: ForestSystem;

  /** ItemSystem, looked up once (registered before this system). */
  private get items(): ItemSystem | undefined {
    return this.itemSystem ??= this.world.getSystem(ItemSystem);
  }

  private get forest(): ForestSystem | undefined {
    return this.forestSystem ??= this.world.getSystem(ForestSystem);
  }

  init(): void {
    this.cleanupFuncs.push(
      this.queries.nodes.subscribe('disqualify', (node) => {
        this.forage.delete(node.index);
        this.retryAt.delete(node.index);
        this.parts.delete(node.index);
      }),
      this.queries.items.subscribe('disqualify', (item) => { this.splitHits.delete(item.index); }),
      this.queries.held.subscribe('disqualify', () => { this.hasPreviousTip = false; }),
      // A level is fully built when it becomes active: index its trees on the next frame.
      this.world.activeLevel.subscribe(() => {
        this.generation++;
        this.forage.clear();
        this.spawning.clear();
        this.retryAt.clear();
        this.parts.clear();
        this.splitHits.clear();
      }),
    );
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.cooldown = Math.max(0, this.cooldown - delta);
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

    this.chopTrees(speed, hand);
    this.splitOnStump(speed, hand);
  }

  /**
   * Axe blows into a standing trunk (only trees in the tip's cell are tested). A brisk
   * blow anywhere from the root flare to above the head counts (ForestSystem fells the
   * tree on the last); any other contact (a slow swing, bark out of the band, a sapling)
   * still knocks, so a tree never ignores the axe.
   */
  private chopTrees(speed: number, hand: 'left' | 'right' | undefined): void {
    const forest = this.forest;
    const nearby = forest?.treesNear(this.tip.x, this.tip.z);
    if (!forest || !nearby) return;
    for (let i = 0; i < nearby.length; i++) {
      const tree = nearby[i];
      const state = forest.stateOf(tree);
      if (state === 'felled') continue;
      const dx = this.tip.x - tree.x, dz = this.tip.z - tree.z;
      const bark = Math.sqrt(dx * dx + dz * dz) - forest.trunkRadius(tree);
      if (bark > TREE_CHOP.rearm) {
        tree.armed = true;
        continue;
      }
      if (bark >= TREE_CHOP.contact || !tree.armed || this.cooldown > 0) continue;
      const up = this.tip.y - tree.ground;
      if (up < 0 || up > Math.min(TREE_CHOP.knockTop, forest.heightOf(tree))) continue;
      const inBand = up >= TREE_CHOP.bandBottom && up <= TREE_CHOP.bandTop;
      if (inBand && speed > CHOP_SPEED && state === 'standing' && tree.choppable) {
        tree.armed = false;
        this.cooldown = .3;
        pulse(this.input, hand, .9, 60);
        forest.blow(tree, dx, dz, this.tip.x, this.tip.y, this.tip.z);
      } else if (speed > TREE_CHOP.knockSpeed) {
        tree.armed = false;
        this.cooldown = .2;
        pulse(this.input, hand, .3, 25);
        bus.emit({ type: 'thud', kind: 'tree', x: this.tip.x, y: this.tip.y, z: this.tip.z });
        if (state === 'young' && inBand && speed > CHOP_SPEED && this.elapsed - this.youngNoticeAt > 20) {
          this.youngNoticeAt = this.elapsed;
          bus.emit({ type: 'toast', text: 'This young tree is still growing', body: 'Fell a full-grown tree, or come back when it has grown.', tone: 'info' });
        }
      }
    }
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

  /**
   * A node on a felled or regrowing tree (a resin scar) is gone with it: hidden, its waiting
   * item removed. It comes back ready once the tree stands again.
   */
  private fellNode(node: Entity): void {
    if (node.object3D) node.object3D.visible = false;
    node.setValue(ResourceNode, 'available', true);
    node.setValue(ResourceNode, 'regrowAt', 0);
    const waiting = this.forage.get(node.index);
    if (!waiting) return;
    this.forage.delete(node.index);
    if (waiting.active && waiting.getValue(Item, 'slot') === 'node' && !waiting.hasComponent(Held)) this.items?.consume(waiting);
  }

  /** Forage nodes keep one real item waiting at their spawn point; taking it starts regrowth. */
  private sweepNodes(): void {
    const items = this.items;
    if (!items) return;
    for (const node of this.queries.nodes.entities) {
      if (this.forest?.nodeDown(node)) {
        this.fellNode(node);
        continue;
      }
      const available = node.getValue(ResourceNode, 'available') !== false;
      const regrowAt = node.getValue(ResourceNode, 'regrowAt') ?? 0;
      if (!available) {
        if (regrowAt <= 0) node.setValue(ResourceNode, 'regrowAt', this.elapsed + (node.getValue(ResourceNode, 'regrowSeconds') ?? 180));
        else if (this.elapsed >= regrowAt) {
          node.setValue(ResourceNode, 'available', true);
          node.setValue(ResourceNode, 'regrowAt', 0);
          if (node.object3D) node.object3D.visible = true;
        }
        this.showHarvestPart(node, node.getValue(ResourceNode, 'available') === true);
        continue;
      }
      if (node.object3D && !node.object3D.visible) node.object3D.visible = true; // its tree stands again
      this.showHarvestPart(node, true);
      const tracked = this.forage.get(node.index);
      if (tracked) {
        // Taken the moment a hand closes on it: the node's part hides and the rustle plays at the pick.
        if (tracked.active && tracked.getValue(Item, 'slot') === 'node' && !tracked.hasComponent(Held)) continue;
        this.forage.delete(node.index);
        node.setValue(ResourceNode, 'available', false);
        node.setValue(ResourceNode, 'regrowAt', this.elapsed + (node.getValue(ResourceNode, 'regrowSeconds') ?? 180));
        node.object3D?.getWorldPosition(this.point);
        // The rest of a multi-yield node (a reed clump gives three reeds) drops round its foot.
        const extra = (node.getValue(ResourceNode, 'yields') ?? '').split(',');
        for (let i = 1; i < extra.length; i++) {
          const kind = extra[i].trim(), angle = i * 2.4 + .7;
          if (kind) void items.dropAt(kind, this.point.x + Math.cos(angle) * .3, this.point.z + Math.sin(angle) * .3);
        }
        bus.emit({ type: 'harvest', kind: node.getValue(ResourceNode, 'kind') ?? '', x: this.point.x, y: this.point.y, z: this.point.z });
        continue;
      }
      if (this.spawning.has(node.index) || !node.object3D) continue;
      if ((this.retryAt.get(node.index) ?? 0) > this.elapsed) continue;
      const kind = (node.getValue(ResourceNode, 'yields') ?? '').split(',')[0]?.trim();
      if (!kind) continue;
      node.object3D.getWorldPosition(this.point);
      this.spawning.add(node.index);
      const index = node.index, generation = this.generation;
      // Whatever happens to the spawn, the node is free to try again (unless the level changed
      // under it); a failed spawn backs off instead of retrying every sweep.
      const backOff = () => { if (generation === this.generation) this.retryAt.set(index, this.elapsed + FORAGE_RETRY_SECONDS); };
      void items.spawnItem(kind, this.point.x, this.point.y, this.point.z, { slot: 'node' })
        .then((entity) => {
          if (generation !== this.generation) return;
          if (!entity) { backOff(); return; }
          if (node.active) this.forage.set(index, entity);
          this.retryAt.delete(index);
        })
        .catch((error: unknown) => {
          console.warn(`[Prometheus] forage spawn failed (${kind})`, error);
          backOff();
        })
        .finally(() => { if (generation === this.generation) this.spawning.delete(index); });
    }
  }
}
