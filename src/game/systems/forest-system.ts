/**
 * ForestSystem (priority 13.5, before GatherSystem): owns every tree of the level, draws
 * them, and fells and regrows them.
 *
 * Trees come from the loaded scene, so authored moves carry over:
 * - the GLB 'pine-1'/'pine-2' nodes;
 * - the procedural 'valley-pine'/'valley-pine-tall'/'far-pine' patterns, which are the
 *   editor's stand-ins, each replaced by the GLB pine of its height;
 * - the broadleaves (BROADLEAVES), when the level has the 'valley-broadleaves' node.
 * The authored visuals are hidden (GLB pine meshes are detached, so nothing else instances them).
 *
 * Drawing:
 * - the nearest pines (at most NEAR_CAP within NEAR_RADIUS) are full GLB pines, one
 *   instanced draw per GLB part;
 * - every other pine is an octahedral impostor of the same GLB (baked into an atlas once
 *   per session; src/vendor/octahedral-impostor), one instanced draw per pine model;
 * - broadleaves are always full (two draws), and stumps are one instanced draw.
 * Matrices are rewritten only when the viewer has moved or a tree changed; every frame
 * only while a tree is falling.
 *
 * Felling (rules in ../forest.ts): GatherSystem lands the axe blows (`blow`). The last
 * blow topples the tree away from the chopper. It lands, and its logs and sticks drop
 * along the trunk. A stump stays, then a sapling sprouts and grows back to a choppable
 * tree. The felled trees and their ages are saved (`snapshot`/`restore`).
 */
import { AssetManager, createSystem, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from '@iwsdk/core';
import type { BufferGeometry, Entity, Material, Mesh, Object3D } from '@iwsdk/core';
import { broadleafUnit, stumpGeometry, stumpMaterial } from '../../scene-assets/forest-parts.scene-asset.js';
import { BROADLEAF_SINK } from '../../scene-assets/valley-kit.scene-asset.js';
import { BROADLEAVES } from '../../scene-assets/valley-layout.scene-asset.js';
import { pineSourceBounds } from '../../scene-assets/woodland.scene-asset.js';
import { OctahedralImpostor } from '../../vendor/octahedral-impostor/index.js';
import { bus } from '../bus.js';
import { ResourceNode } from '../components.js';
import {
  FELL, fallAngle, fellYield, growth, REGROWN_AFTER, saveTrees, sinkFraction, stumpShown, treeKey, treePhase, trunkShown,
  type SavedTree,
} from '../forest.js';
import { terrainHeight, WORLD_BOUNDS } from '../terrain.js';
import { ItemSystem } from './item-system.js';

/** Pines drawn in full: within this radius (m), the nearest NEAR_CAP of them. */
const NEAR_RADIUS = 16;
/** A full pine turns back into an impostor only this much farther out (m), so none flickers at the edge. */
const NEAR_HYSTERESIS = 2.5;
const NEAR_CAP = 10;
/** Rewrite the instances when the viewer has moved this far (m)... */
const MOVE_REFRESH = .6;
/** ...checked this often (s); regrowing trees also refresh this often. */
const REFRESH_SECONDS = .25;
const GROW_REFRESH_SECONDS = 1;
/** Impostor atlas: 12×12 views of 170 px (hemi-octahedral: trees are seen from the side and above). */
const ATLAS = { textureSize: 2048, spritesPerSide: 12, alphaClamp: .4 } as const;
/** GLB pine origins sit this far above the ground per unit of vertical scale (trunk base just under it). */
const PINE_ORIGIN = .155;
/** Trunk radius at chopping height per unit of horizontal scale (GLB source units / broadleaf h = 1). */
const PINE_TRUNK = .2;
const BROADLEAF_TRUNK = .058;
/** The procedural stand-ins: which GLB pine replaces each, at the scale that matches its height. */
const PINE_HEIGHT = { 'pine-1': pineSourceBounds['pine-1'].height, 'pine-2': pineSourceBounds['pine-2'].height };
const PATTERNS: Record<string, { model: 'pine-1' | 'pine-2' | 'mixed'; scale: number }> = {
  'valley-pine': { model: 'pine-1', scale: 5.6 / PINE_HEIGHT['pine-1'] },
  'valley-pine-tall': { model: 'pine-2', scale: 6.5 / PINE_HEIGHT['pine-2'] },
  'far-pine': { model: 'mixed', scale: 5.8 / PINE_HEIGHT['pine-1'] },
};
/**
 * A resource node this close to a trunk centre (m, horizontal) grows on that tree (a resin
 * scar): it falls with the tree and returns once the tree stands again (nodeDown).
 */
const ON_TRUNK = .9;
const CELL = 4;
/** Only trees within this reach of the axe tip are offered to GatherSystem (m). */
const REACH = 3;
const cellKey = (x: number, z: number) => (Math.floor(x / CELL) + 1024) * 4096 + Math.floor(z / CELL) + 1024;
const UP = new Vector3(0, 1, 0);

/** Model indices (looks). */
const PINE_1 = 0, PINE_2 = 1, BROADLEAF = 2;

export type Tree = {
  /** Save key (trunk position to the decimetre). */
  key: string;
  model: number;
  x: number; z: number;
  /** Terrain height at the trunk, and the model origin's height. */
  ground: number; y: number;
  yaw: number;
  /** Model scale: horizontal, vertical. */
  s: number; sy: number;
  /** Full-grown trunk radius at chopping height, and height (m). */
  r: number; height: number;
  choppable: boolean;
  hits: number; lastHit: number;
  /** Re-armed once the blade has pulled back off the bark (GatherSystem). */
  armed: boolean;
  /** When it was felled (this system's clock); NaN while standing. */
  felledAt: number;
  fallX: number; fallZ: number;
  landed: boolean; dropped: boolean;
  /** Drawn as the full model this refresh (pines; broadleaves always are). */
  near: boolean;
};

/** What a tree offers an axe right now. */
export type TreeState = 'standing' | 'young' | 'felled';

type Look = {
  parts: { geometry: BufferGeometry; material: Material | Material[] }[];
  impostor?: { geometry: BufferGeometry; material: Material };
};
type LevelMeshes = { near: InstancedMesh[]; far?: InstancedMesh; nearCount: number; farCount: number };

export class ForestSystem extends createSystem({
  nodes: { required: [ResourceNode] },
}) {
  private trees: Tree[] = [];
  private cells = new Map<number, Tree[]>();
  /** Resource node (entity index) → the tree it grows on. */
  private nodeTrees = new Map<number, Tree>();
  /** Felled trees not yet grown back, and the ones still falling or lying. */
  private felled: Tree[] = [];
  private moving: Tree[] = [];
  private looks: Look[] = [];
  private meshes: LevelMeshes[] = [];
  private stumps?: InstancedMesh;
  private stumpCount = 0;
  private assets: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private levelPending = true;
  private built = false;
  private pendingRestore?: SavedTree[];
  private elapsed = 0;
  private refreshTimer = 0;
  private growTimer = 0;
  private dirty = true;
  private viewer = new Vector3();
  private lastViewer = new Vector3(1e9, 0, 0);
  private matrix = new Matrix4();
  private turn = new Matrix4();
  private quat = new Quaternion();
  private scale = new Vector3();
  private point = new Vector3();
  private axis = new Vector3();
  /** Near-pine candidates and their sort keys (squared distance; -1 = falling, always near). */
  private rank: Int32Array = new Int32Array(0);
  private rankKey: Float32Array = new Float32Array(0);
  private itemSystem?: ItemSystem;
  /** Full pines drawn at most (NEAR_CAP; 0 draws every pine as an impostor, for comparing the two). */
  nearCap: number = NEAR_CAP;

  private get items(): ItemSystem | undefined {
    return this.itemSystem ??= this.world.getSystem(ItemSystem);
  }

  init(): void {
    // DEV handle for runtime probes (impostor/full comparisons, felling from the console).
    if (import.meta.env.DEV) (globalThis as { __forest?: ForestSystem }).__forest = this;
    this.cleanupFuncs.push(
      this.world.activeLevel.subscribe(() => {
        // The old level's meshes go with its entities; the looks (GLB parts, atlases) stay.
        this.levelPending = true;
        this.built = false;
        this.trees = [];
        this.cells.clear();
        this.felled.length = 0;
        this.moving.length = 0;
        this.meshes = [];
        this.stumps = undefined;
      }),
    );
  }

  update(delta: number): void {
    this.elapsed += delta;
    if (this.assets === 'idle') this.loadLooks();
    const level = this.world.activeLevel.peek();
    if (this.levelPending && level?.object3D) {
      // Same frame the level appears, before FxSystem (priority 25) would instance the GLB pines.
      this.levelPending = false;
      this.collect(level.object3D);
    }
    if (!this.built && this.assets === 'ready' && level?.object3D && !this.levelPending) this.mount(level);
    if (!this.built) return;

    if (this.moving.length) this.animate();
    this.growTimer -= delta;
    if (this.growTimer <= 0) {
      this.growTimer = GROW_REFRESH_SECONDS;
      this.regrow();
    }
    this.refreshTimer -= delta;
    if (this.moving.length || this.dirty || this.refreshTimer <= 0) {
      this.refreshTimer = REFRESH_SECONDS;
      this.camera.getWorldPosition(this.viewer);
      const dx = this.viewer.x - this.lastViewer.x, dz = this.viewer.z - this.lastViewer.z;
      if (this.moving.length || this.dirty || dx * dx + dz * dz > MOVE_REFRESH * MOVE_REFRESH) this.refresh();
    }
  }

  // ------------------------------------------------------------------ public API

  /** Trees whose trunk may be within REACH (3 m) of (x, z): the axe tip's 4 m cell. */
  treesNear(x: number, z: number): readonly Tree[] | undefined {
    return this.cells.get(cellKey(x, z));
  }

  /** A node on a tree that is felled or still regrowing: it is gone until the tree stands again. */
  nodeDown(node: Entity): boolean {
    const tree = this.nodeTrees.get(node.index);
    return tree !== undefined && this.stateOf(tree) !== 'standing';
  }

  stateOf(tree: Tree): TreeState {
    const phase = treePhase(this.elapsed - tree.felledAt);
    return phase === 'standing' ? 'standing' : phase === 'growing' ? 'young' : 'felled';
  }

  /** The trunk's radius at chopping height now (a sapling's is thinner), m. */
  trunkRadius(tree: Tree): number {
    return tree.r * growth(this.elapsed - tree.felledAt);
  }

  /** How tall the tree stands now (m). */
  heightOf(tree: Tree): number {
    return tree.height * growth(this.elapsed - tree.felledAt);
  }

  /**
   * The nearest standing, full-grown, choppable tree to (x, z) within `maxDistance` m, for
   * a guide to point at (its trunk foot is (tree.x, tree.ground, tree.z)).
   */
  nearestChoppable(x: number, z: number, maxDistance = 40): Tree | undefined {
    let best: Tree | undefined, bestD2 = maxDistance * maxDistance;
    for (const tree of this.trees) {
      if (!tree.choppable || this.stateOf(tree) !== 'standing') continue;
      const dx = tree.x - x, dz = tree.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = tree; }
    }
    return best;
  }

  /**
   * One counted axe blow into a standing tree, the blade at (tipX, tipY, tipZ). (dx, dz)
   * points from the trunk toward the chopper. The FELL.hits-th blow fells it: it topples
   * away from the chopper. Returns true when this blow felled it.
   */
  blow(tree: Tree, dx: number, dz: number, tipX: number, tipY: number, tipZ: number): boolean {
    if (!tree.choppable || this.stateOf(tree) !== 'standing') return false;
    if (this.elapsed - tree.lastHit > FELL.forgetSeconds) tree.hits = 0;
    tree.lastHit = this.elapsed;
    tree.hits++;
    bus.emit({ type: 'chop', node: 'tree', remaining: Math.max(0, FELL.hits - tree.hits), x: tipX, y: tipY, z: tipZ });
    if (tree.hits < FELL.hits) return false;
    const length = Math.hypot(dx, dz) || 1;
    this.fell(tree, -dx / length, -dz / length, 0);
    return true;
  }

  /** Felled trees still regrowing, for the save. */
  snapshot(): SavedTree[] {
    return saveTrees(this.felledAges());
  }

  /**
   * Continue: fell the saved trees at their saved ages (applied now, or when the level's
   * trees are next collected). Trees already past their fall drop nothing again: their
   * logs are in the save as items.
   */
  restore(trees: readonly SavedTree[] | undefined): void {
    this.pendingRestore = trees ? [...trees] : [];
    if (this.trees.length) this.applyRestore();
  }

  // ------------------------------------------------------------------ felling

  private *felledAges(): Generator<{ key: string; age: number }> {
    for (const tree of this.felled) yield { key: tree.key, age: this.elapsed - tree.felledAt };
  }

  private fell(tree: Tree, fallX: number, fallZ: number, age: number): void {
    tree.felledAt = this.elapsed - age;
    tree.fallX = fallX;
    tree.fallZ = fallZ;
    tree.hits = 0;
    tree.landed = age >= FELL.fallSeconds;
    tree.dropped = age >= FELL.fallSeconds + FELL.lieSeconds;
    tree.armed = true;
    if (!this.felled.includes(tree)) this.felled.push(tree);
    if (!tree.dropped || age < FELL.fallSeconds + FELL.lieSeconds + FELL.sinkSeconds) {
      if (!this.moving.includes(tree)) this.moving.push(tree);
    }
    this.dirty = true;
  }

  private applyRestore(): void {
    const saved = this.pendingRestore;
    this.pendingRestore = undefined;
    if (!saved) return;
    for (const tree of this.felled) tree.felledAt = NaN;
    this.felled.length = 0;
    this.moving.length = 0;
    const byKey = new Map<string, Tree>();
    for (const tree of this.trees) byKey.set(tree.key, tree);
    for (const { k, t } of saved) {
      const tree = byKey.get(k);
      if (!tree || !tree.choppable || !(t >= 0) || t >= REGROWN_AFTER) continue;
      // The fall direction is not saved: a restored trunk mid-fall topples away from camp.
      const length = Math.hypot(tree.x, tree.z) || 1;
      this.fell(tree, tree.x / length, tree.z / length, t);
    }
    this.dirty = true;
  }

  /** Landing and the logs dropping, for trees still falling or lying. */
  private animate(): void {
    for (let i = this.moving.length - 1; i >= 0; i--) {
      const tree = this.moving[i];
      const age = this.elapsed - tree.felledAt;
      if (!tree.landed && age >= FELL.fallSeconds) {
        tree.landed = true;
        const reach = tree.height * .55;
        bus.emit({ type: 'thud', kind: 'tree-fall', x: tree.x + tree.fallX * reach, y: tree.ground + .2, z: tree.z + tree.fallZ * reach });
      }
      if (!tree.dropped && age >= FELL.fallSeconds + FELL.lieSeconds) {
        tree.dropped = true;
        this.dropYield(tree);
      }
      if (!(age < FELL.fallSeconds + FELL.lieSeconds + FELL.sinkSeconds) || Number.isNaN(age)) {
        this.moving[i] = this.moving[this.moving.length - 1];
        this.moving.pop();
      }
    }
  }

  /** Logs where the trunk lay, sticks where the crown broke up; kept inside the valley walls. */
  private dropYield(tree: Tree): void {
    const items = this.items;
    if (!items) return;
    const { logs, sticks } = fellYield(tree.height, tree.model === BROADLEAF);
    const fx = tree.fallX, fz = tree.fallZ, side = .55;
    const inX = (x: number) => Math.min(WORLD_BOUNDS.maxX - 1.2, Math.max(WORLD_BOUNDS.minX + 1.2, x));
    const inZ = (z: number) => Math.min(WORLD_BOUNDS.maxZ - 1.2, Math.max(WORLD_BOUNDS.minZ + 1.2, z));
    for (let i = 0; i < logs; i++) {
      const d = tree.height * (.2 + .2 * i) + .5;
      void items.dropAt('log', inX(tree.x + fx * d), inZ(tree.z + fz * d));
    }
    for (let i = 0; i < sticks; i++) {
      const d = tree.height * (.55 + .12 * i), s = (i % 2 ? 1 : -1) * side;
      void items.dropAt('stick', inX(tree.x + fx * d - fz * s), inZ(tree.z + fz * d + fx * s));
    }
    const mid = tree.height * .35;
    bus.emit({ type: 'harvest', kind: 'log', x: inX(tree.x + fx * mid), y: tree.ground + .2, z: inZ(tree.z + fz * mid) });
  }

  /** Grown-back trees stand again; stumps and saplings refresh while any tree regrows. */
  private regrow(): void {
    for (let i = this.felled.length - 1; i >= 0; i--) {
      const tree = this.felled[i];
      if (this.elapsed - tree.felledAt >= REGROWN_AFTER) {
        tree.felledAt = NaN;
        tree.hits = 0;
        this.felled[i] = this.felled[this.felled.length - 1];
        this.felled.pop();
      }
      this.dirty = true;
    }
  }

  // ------------------------------------------------------------------ building

  /** Load the GLB pines once per session, then bake their impostors (next update). */
  private loadLooks(): void {
    this.assets = 'loading';
    Promise.all([AssetManager.loadGLTFById('pine-1'), AssetManager.loadGLTFById('pine-2')])
      .then(() => {
        try {
          this.looks = [this.pineLook('pine-1'), this.pineLook('pine-2'), { parts: broadleafUnit }];
          this.assets = 'ready';
        } catch (error) {
          this.assets = 'failed';
          console.error('[Prometheus] ForestSystem: baking the tree impostors failed; the valley has no trees', error);
        }
      })
      .catch((error: unknown) => {
        this.assets = 'failed';
        console.error('[Prometheus] ForestSystem: the GLB pines failed to load; the valley has no trees', error);
      });
  }

  /** A GLB pine's parts (for full instances) and its octahedral impostor, baked from the same model. */
  private pineLook(id: 'pine-1' | 'pine-2'): Look {
    const gltf = AssetManager.getGLTF(id);
    if (!gltf) throw new Error(`GLB '${id}' is not loaded`);
    const source = gltf.scene;
    source.updateMatrixWorld(true);
    const parts: Look['parts'] = [];
    const toRoot = new Matrix4().copy(source.matrixWorld).invert(), local = new Matrix4();
    source.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      local.multiplyMatrices(toRoot, mesh.matrixWorld);
      const geometry = local.equals(IDENTITY) ? mesh.geometry : mesh.geometry.clone().applyMatrix4(local);
      parts.push({ geometry, material: mesh.material });
    });
    const impostor = new OctahedralImpostor({
      renderer: this.world.renderer, target: source, useHemiOctahedron: true, baseType: MeshStandardMaterial,
      textureSize: ATLAS.textureSize, spritesPerSide: ATLAS.spritesPerSide, alphaClamp: ATLAS.alphaClamp,
    });
    const material = impostor.material as MeshStandardMaterial;
    material.name = `${id} impostor`;
    material.roughness = .95;
    material.metalness = 0;
    return { parts, impostor: { geometry: impostor.geometry, material } };
  }

  /**
   * Index the level's trees and hide their authored visuals. Runs the frame the level
   * appears (the look may still be loading; `mount` draws them once it is ready).
   */
  private collect(root: Object3D): void {
    const trees: Tree[] = [];
    const strip: Object3D[] = [];
    const matrix = new Matrix4(), position = new Vector3(), quaternion = new Quaternion(), scale = new Vector3();
    const yawOf = (q: Quaternion) => 2 * Math.atan2(q.y, q.w);
    const add = (model: number, x: number, z: number, yaw: number, s: number, sy: number, choppable: boolean, y?: number) => {
      const ground = terrainHeight(x, z);
      const pine = model !== BROADLEAF;
      trees.push({
        key: treeKey(x, z), model, x, z, ground,
        y: y ?? (pine ? ground + PINE_ORIGIN * sy : ground - BROADLEAF_SINK), yaw, s, sy,
        r: (pine ? PINE_TRUNK : BROADLEAF_TRUNK) * s,
        height: pine ? PINE_HEIGHT[model === PINE_1 ? 'pine-1' : 'pine-2'] * sy : sy,
        choppable: choppable && x > WORLD_BOUNDS.minX && x < WORLD_BOUNDS.maxX && z > WORLD_BOUNDS.minZ && z < WORLD_BOUNDS.maxZ,
        hits: 0, lastHit: -Infinity, armed: true, felledAt: NaN, fallX: 0, fallZ: 1, landed: false, dropped: false, near: false,
      });
    };
    let broadleaves = false;
    root.updateMatrixWorld(true);
    root.traverse((object) => {
      const mesh = object as InstancedMesh;
      if (mesh.isInstancedMesh) {
        const prefab = (object.parent?.userData.iwsdkSceneContent as { prefab?: string } | undefined)?.prefab ?? '';
        const pattern = PATTERNS[prefab];
        if (!pattern) return;
        mesh.visible = false;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          matrix.premultiply(mesh.matrixWorld).decompose(position, quaternion, scale);
          const model = pattern.model === 'mixed' ? (Math.abs(Math.round(position.x * 7 + position.z * 3)) % 2 ? PINE_2 : PINE_1)
            : pattern.model === 'pine-1' ? PINE_1 : PINE_2;
          add(model, position.x, position.z, yawOf(quaternion), scale.x * pattern.scale, scale.y * pattern.scale, true);
        }
        return;
      }
      const asset = object.userData.iwsdkSceneAssetId as string | undefined;
      if (asset === 'pine-1' || asset === 'pine-2') {
        object.matrixWorld.decompose(position, quaternion, scale);
        add(asset === 'pine-1' ? PINE_1 : PINE_2, position.x, position.z, yawOf(quaternion), scale.x, scale.y, true, position.y);
        strip.push(object);
      } else if (asset === 'valley-broadleaves') {
        object.visible = false;
        broadleaves = true;
      }
    });
    // Detached (not just hidden): nothing else may instance or draw the authored GLB pines.
    for (const object of strip) object.clear();
    if (broadleaves) for (const t of BROADLEAVES) add(BROADLEAF, t.x, t.z, t.yaw, t.h, t.h, true);
    // Resource nodes on a trunk (the resin scars) belong to that tree.
    this.nodeTrees.clear();
    for (const node of this.queries.nodes.entities) {
      if (!node.object3D) continue;
      node.object3D.getWorldPosition(position);
      const tree = trees.find((t) => Math.hypot(t.x - position.x, t.z - position.z) < Math.max(ON_TRUNK, t.r + .5));
      if (tree) this.nodeTrees.set(node.index, tree);
    }

    this.trees = trees;
    this.cells.clear();
    // Every tree answers the axe (a tree that is never felled still knocks).
    for (const tree of trees) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const key = cellKey(tree.x + dx * REACH, tree.z + dz * REACH);
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, list = []);
        if (!list.includes(tree)) list.push(tree);
      }
    }
    this.rank = new Int32Array(trees.length);
    this.rankKey = new Float32Array(trees.length);
    if (this.pendingRestore) this.applyRestore();
  }

  /** The level's instanced draws (children of the level, so they go with it). */
  private mount(level: Entity): void {
    this.built = true;
    const counts = [0, 0, 0];
    let choppable = 0;
    for (const tree of this.trees) {
      counts[tree.model]++;
      if (tree.choppable) choppable++;
    }
    const make = (geometry: BufferGeometry, material: Material | Material[], capacity: number, name: string) => {
      const mesh = new InstancedMesh(geometry, material, Math.max(1, capacity));
      mesh.name = name;
      mesh.count = 0;
      mesh.castShadow = mesh.receiveShadow = false;
      mesh.pointerEvents = 'none';
      mesh.raycast = () => {};
      this.world.createTransformEntity(mesh, { parent: level });
      return mesh;
    };
    this.meshes = this.looks.map((look, model) => {
      const capacity = look.impostor ? Math.min(counts[model], NEAR_CAP) : counts[model];
      const near = counts[model] ? look.parts.map((part, i) => make(part.geometry, part.material, capacity, `Forest ${model}/${i}`)) : [];
      let far: InstancedMesh | undefined;
      if (look.impostor && counts[model]) {
        far = make(look.impostor.geometry, look.impostor.material, counts[model], `Forest ${model} impostors`);
        // The quad is placed by the shader (impostorTransform): the plane's own bounds say nothing.
        far.frustumCulled = false;
      }
      return { near, far, nearCount: 0, farCount: 0 };
    });
    this.stumps = make(stumpGeometry, stumpMaterial, choppable, 'Forest stumps');
    this.dirty = true;
    this.refresh();
  }

  // ------------------------------------------------------------------ drawing

  /** Pick the full-model pines and rewrite every instance. */
  private refresh(): void {
    this.dirty = false;
    this.camera.getWorldPosition(this.viewer);
    this.lastViewer.copy(this.viewer);
    const vx = this.viewer.x, vz = this.viewer.z;
    const inside = NEAR_RADIUS * NEAR_RADIUS, outside = (NEAR_RADIUS + NEAR_HYSTERESIS) ** 2;
    let candidates = 0;
    for (let i = 0; i < this.trees.length; i++) {
      const tree = this.trees[i];
      const wasNear = tree.near;
      tree.near = !this.looks[tree.model]?.impostor;
      if (tree.near) continue;
      const age = this.elapsed - tree.felledAt;
      if (!trunkShown(age)) continue;
      const phase = treePhase(age);
      const falling = phase === 'falling' || phase === 'lying' || phase === 'sinking';
      const dx = tree.x - vx, dz = tree.z - vz, d2 = dx * dx + dz * dz;
      if (!falling && d2 > (wasNear ? outside : inside)) continue;
      this.rank[candidates++] = i;
      this.rankKey[i] = falling ? -1 : d2;
    }
    // Insertion sort (a few dozen candidates at most), nearest first.
    for (let a = 1; a < candidates; a++) {
      const index = this.rank[a], key = this.rankKey[index];
      let b = a - 1;
      while (b >= 0 && this.rankKey[this.rank[b]] > key) { this.rank[b + 1] = this.rank[b]; b--; }
      this.rank[b + 1] = index;
    }
    for (let k = 0; k < Math.min(candidates, this.nearCap); k++) this.trees[this.rank[k]].near = true;

    for (const meshes of this.meshes) { meshes.nearCount = 0; meshes.farCount = 0; }
    this.stumpCount = 0;
    for (const tree of this.trees) {
      const age = this.elapsed - tree.felledAt;
      if (stumpShown(age) && this.stumps) {
        this.stumpMatrix(tree, this.matrix);
        this.stumps.setMatrixAt(this.stumpCount++, this.matrix);
      }
      if (!trunkShown(age)) continue;
      const meshes = this.meshes[tree.model];
      if (!meshes) continue;
      this.treeMatrix(tree, age, this.matrix);
      if (tree.near && meshes.nearCount < (meshes.near[0]?.instanceMatrix.count ?? 0)) {
        for (const part of meshes.near) part.setMatrixAt(meshes.nearCount, this.matrix);
        meshes.nearCount++;
      } else if (meshes.far) {
        meshes.far.setMatrixAt(meshes.farCount++, this.matrix);
      }
    }
    for (const meshes of this.meshes) {
      for (const part of meshes.near) {
        part.count = meshes.nearCount;
        part.instanceMatrix.needsUpdate = true;
        part.computeBoundingSphere();
      }
      if (meshes.far) {
        meshes.far.count = meshes.farCount;
        meshes.far.instanceMatrix.needsUpdate = true;
      }
    }
    if (this.stumps) {
      this.stumps.count = this.stumpCount;
      this.stumps.instanceMatrix.needsUpdate = true;
      this.stumps.computeBoundingSphere();
    }
  }

  /** Stump height (m): a knee-low cut, whatever the tree. */
  private stumpHeight(tree: Tree): number {
    return Math.min(.42, Math.max(.22, tree.height * FELL.stumpHeight));
  }

  /**
   * Standing, regrowing (scaled about its foot), toppling (hinged on the stump top, away
   * from the chopper) or sinking away once down.
   */
  private treeMatrix(tree: Tree, age: number, out: Matrix4): void {
    const size = growth(age);
    const hinge = this.stumpHeight(tree);
    this.quat.setFromAxisAngle(UP, tree.yaw);
    this.scale.set(tree.s * size, tree.sy * size, tree.s * size);
    out.compose(this.point.set(0, (tree.y - tree.ground) * size - hinge, 0), this.quat, this.scale);
    const angle = fallAngle(age);
    if (angle > 0) {
      this.axis.set(tree.fallZ, 0, -tree.fallX).normalize();
      out.premultiply(this.turn.makeRotationAxis(this.axis, angle));
    }
    const sink = sinkFraction(age);
    const e = out.elements;
    e[12] += tree.x;
    e[13] += tree.ground + hinge - sink * (tree.r * 4 + 1.4);
    e[14] += tree.z;
  }

  private stumpMatrix(tree: Tree, out: Matrix4): void {
    const height = this.stumpHeight(tree) + .05;
    this.quat.setFromAxisAngle(UP, tree.yaw);
    this.scale.set(tree.r * 1.12, height, tree.r * 1.12);
    out.compose(this.point.set(tree.x, tree.ground - .05, tree.z), this.quat, this.scale);
  }
}

const IDENTITY = new Matrix4();
