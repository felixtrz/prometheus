import {
  AdditiveBlending, BoxGeometry, CircleGeometry, createSystem, CylinderGeometry, DataTexture, Entity, Group, InstancedMesh,
  LinearFilter, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PointLight, PointLightComponent, Quaternion,
  RGBAFormat, ShaderMaterial, Vector3,
} from '@iwsdk/core';
import { bus } from '../bus.js';
import { Beacon, Campfire, FireVisual, GameState, Held, Item, Page } from '../components.js';
import { ITEMS } from '../catalog.js';
import { beckonRank, BECKON_STEPS, BURSTS, ParticlePool, type BeckonState, type Burst } from '../fx-particles.js';
import { CAMP, nightness, phaseAt } from '../rules.js';
import { currentObjective, objectiveIndex, OBJECTIVES } from '../story.js';
import { LANDMARKS, smooth } from '../terrain.js';
import { BackpackSystem } from './backpack-system.js';

const TORCH_TIP = new Vector3(...ITEMS.torch.tip);
const LIGHTER_TIP = new Vector3(...ITEMS.lighter.tip);
const POT_SURFACE = new Vector3(CAMP.pot.x, CAMP.pot.y + .05, CAMP.pot.z);
const BROTH: Record<string, number> = {
  empty: 0x3b4a4c, meat: 0x6a3a22, mushroom: 0x6b5a3a, berries: 0x6d2438, herb: 0x4f6a2e, ready: 0xa95620,
};
const STEW_TINT: Record<string, number> = {
  'meat+mushroom': 0xa95620, 'meat+meat': 0x8e3f1c, 'berries+meat': 0x9a3b34, 'herb+meat': 0x86632a,
  'mushroom+mushroom': 0x9c7b48, 'berries+mushroom': 0x8a4a5a, 'herb+mushroom': 0x7a8a3e,
  'berries+berries': 0xa0344e, 'berries+herb': 0x8a6a3a, 'herb+herb': 0x6a8a3a,
};
const ADDITIVE = new Set(['sparks', 'craft', 'flare', 'ignite', 'embers']);
/** Glints of light on grabbables: drawn with a four-point star sprite. */
const GLINTS = new Set(['glint', 'sparkle', 'beckon']);
/** Loose items within this range sparkle now and then, so you can tell what can be picked up (m). */
const SPARKLE_RANGE = 3;
/**
 * At most one item beckons at a time (a brighter sparkle, every ~2 s, from across camp): the
 * lowest `beckonRank` of the current task's steps and page 1. Other packed items never sparkle.
 */
const KEY_RANGE = 7;
/** How often the beckoning item is chosen again (s). */
const BECKON_PICK_SECONDS = .25;
const LIGHT_FIRE_BIT = 1 << objectiveIndex('light-fire');
const EAT_MEAL_BIT = 1 << objectiveIndex('eat-meal');
/** Named child each kind's per-frame dressing drives (cached per entity). */
const DRESSING_PART: Readonly<Record<string, string>> = { torch: 'torch-flame', lighter: 'flame', crossbow: 'loaded-bolt' };
/** Spire beacon coal glow at full strength (the echo braziers burn at 0.9). */
const SPIRE_COAL_GLOW = .7;
const BRAZIER_COAL_GLOW = .9;
/** Asset prototypes compiled up front although they only enter the scene later. */
const WARM_PROTOTYPES = ['torch', 'deer', 'rabbit', 'wolf'];
/** Forage items waiting at their node glint from further off (m). */
const NODE_GLINT_RANGE = 14;
/**
 * Items smaller than this on screen (bounding radius over distance, ~0.2°: a few pixels
 * across) skip their draws until you come closer; `DETAIL_SHOW` is the hysteresis.
 */
const DETAIL_CULL = .0035;
const DETAIL_SHOW = .004;
/** A mesh on no layer is skipped by every camera (visibility, bounds and grabbing are untouched). */
const NO_LAYERS = 0;
/**
 * The scene's two dynamic point lights (never more, never added or removed at runtime):
 * the campfire's own 'fire-glow', and one roaming flame light ('held-light') that follows
 * the brightest flame that matters: the Spire beacon while it burns near you, else a held
 * torch, a lit torch nearby, or the lighter.
 */
const FLAME_LIGHT = {
  torch: { intensity: 1.8, distance: 7, decay: 2 },
  looseTorch: { intensity: 1.2, distance: 7, decay: 2 },
  lighter: { intensity: .6, distance: 7, decay: 2 },
  /** The finale beacon: soft and raised well above the bowl so the plinth never blows out. */
  beacon: { intensity: 4.5, distance: 25, decay: 1.5, lift: 2.5, range: 30 },
} as const;
const LARGE = new Set(['ash', 'steam']);

type Flames = { flames: Object3D[]; light?: PointLight; embers?: Object3D; brothMaterial?: MeshStandardMaterial; bits?: Object3D };
type BeaconParts = {
  flame?: Object3D; glow?: MeshStandardMaterial; halo?: Mesh; haloMaterial?: MeshBasicMaterial; spire: boolean;
  /** The crown's shader materials (tongues, core, wisps), whose `uTime` drives the licks. */
  flames: ShaderMaterial[];
};
type LightMode = 'off' | 'torch' | 'looseTorch' | 'lighter' | 'beacon';

/** Radial falloff for the warm pool of firelight on the ground. */
function glowTexture(): DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.min(1, Math.hypot(x - size / 2 + .5, y - size / 2 + .5) / (size / 2));
    const a = (1 - d) ** 2.2;
    const i = (y * size + x) * 4;
    data[i] = 255; data[i + 1] = 150; data[i + 2] = 70; data[i + 3] = Math.round(255 * a);
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Every visual that follows game state: flames, light, particles, pot, bowls, beacons, ending. */
export class FxSystem extends createSystem({
  fires: { required: [FireVisual, Campfire] },
  items: { required: [Item] },
  held: { required: [Item, Held] },
  beacons: { required: [Beacon] },
  game: { required: [GameState] },
}) {
  private fire?: Flames;
  private fireEntity?: Entity;
  private beaconParts = new Map<number, BeaconParts>();
  private bowlMaterials = new Map<number, MeshStandardMaterial>();
  private heldLight?: Entity;
  private lightMode: LightMode = 'off';
  /** Spire beacon strength this frame (0 cold, 1 lit) and where its light hangs. */
  private spireStrength = 0;
  private spireLight = new Vector3();
  /** Per-item time of the next sparkle (staggered, 3–4 s apart; ~2 s for a key item). */
  private sparkleAt = new Map<number, number>();
  /** What the beckon choice reads, and the one item beckoning now (re-chosen every BECKON_PICK_SECONDS). */
  private beckon: BeckonState = { task: '', potA: '', potB: '', stew: '', placed: 0, mealDone: false, noteWaiting: false, noteStarted: false };
  private beckoner?: Entity;
  private beckonTimer = 0;
  /** Per item: its flame or loaded bolt (DRESSING_PART), found once; null when it has none. */
  private dressing = new Map<number, Object3D | null>();
  /** A level (re)load: its shaders are warmed once it has built (see warmPending). */
  private levelPending = true;
  /** Compile every shader of the level up front (after the level's first frame, and on entering XR). */
  private warmPending = false;
  private warmOnPresent = false;
  private warmProbe?: Group;
  /**
   * Material clones made for one owner entity (a campfire's broth, a brazier's coal glow and
   * halo): disposed when that owner leaves. The spire eye's clone goes with its level.
   */
  private clones = new Map<number, Material[]>();
  private level?: Entity;
  private pack?: BackpackSystem;
  private smoke?: Entity;
  /** Scene searches for objects a level may lack (the spire eye, the lantern): at most once a second. */
  private eyeSearchAt = 0;
  private lanternSearchAt = 0;
  /** Item detail culling: bounding radius, meshes and their layer masks, and whether culled. */
  private detail = new Map<number, { radius: number; meshes: Mesh[]; masks: number[]; culled: boolean }>();
  private detailTimer = 0;
  private beam?: Mesh;
  private groundGlow?: Mesh;
  private sparks!: ParticlePool;
  private puffs!: ParticlePool;
  private smokePool!: ParticlePool;
  private glints!: ParticlePool;
  private spireEye?: {
    object: Object3D; material?: Material & { opacity: number; emissiveIntensity?: number }; glow: number;
    halo?: MeshBasicMaterial; haloOpacity: number;
  };
  private lantern?: MeshBasicMaterial;
  private eyeRamp = -1;
  private smokeShown = false;
  private elapsed = 0;
  private emberTimer = 0;
  private steamTimer = 0;
  private glintTimer = 0;
  private point = new Vector3();
  private best = new Vector3();
  private viewer = new Vector3();
  private quat = new Quaternion();
  private quat2 = new Quaternion();
  private at = new Vector3();
  private origin = new Vector3();

  init(): void {
    this.sparks = new ParticlePool(220, true);
    this.puffs = new ParticlePool(120, false);
    this.smokePool = new ParticlePool(90, false);
    this.glints = new ParticlePool(64, true, 'star');
    for (const pool of [this.sparks, this.puffs, this.smokePool, this.glints]) this.world.createTransformEntity(pool.points, { persistent: true });
    const onSessionStart = () => { this.warmOnPresent = true; };
    this.renderer.xr.addEventListener('sessionstart', onSessionStart);

    const beamMaterial = new MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: .35, blending: AdditiveBlending, depthWrite: false });
    this.beam = new Mesh(new CylinderGeometry(.05, .18, 7, 10, 1, true), beamMaterial);
    this.beam.visible = false;
    this.beam.pointerEvents = 'none';
    this.world.createTransformEntity(this.beam, { persistent: true });
    // Warm pool of firelight on the ground: reads as the 6 m safe ring at night.
    const glow = new Mesh(new CircleGeometry(3.4, 32), new MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(CAMP.fire.x, .025, CAMP.fire.z);
    glow.pointerEvents = 'none';
    glow.renderOrder = 2;
    this.groundGlow = glow;
    this.world.createTransformEntity(glow, { persistent: true });

    const burstAt = (name: keyof typeof BURSTS, x: number, y: number, z: number, direction?: Vector3) => this.burst(name, this.at.set(x, y, z), direction);
    this.cleanupFuncs.push(
      () => this.renderer.xr.removeEventListener('sessionstart', onSessionStart),
      this.queries.fires.subscribe('qualify', (entity) => this.captureFire(entity), true),
      // A level reload adds the new campfire before the old one leaves: only drop the one that left.
      this.queries.fires.subscribe('disqualify', (entity) => {
        this.release(entity.index);
        if (this.fireEntity !== entity) return;
        this.fire = this.fireEntity = undefined;
        for (const other of this.queries.fires.entities) if (other !== entity) this.captureFire(other);
      }),
      this.queries.beacons.subscribe('qualify', (entity) => this.captureBeacon(entity), true),
      this.queries.beacons.subscribe('disqualify', (entity) => {
        this.release(entity.index);
        this.beaconParts.delete(entity.index);
      }),
      this.queries.items.subscribe('disqualify', (entity) => {
        this.bowlMaterials.get(entity.index)?.dispose();
        this.bowlMaterials.delete(entity.index);
        this.sparkleAt.delete(entity.index);
        this.detail.delete(entity.index);
        this.dressing.delete(entity.index);
        if (this.beckoner === entity) this.beckoner = undefined;
      }),
      this.world.activeLevel.subscribe((level) => {
        // The spire eye's clones belong to the level that is leaving.
        this.spireEye?.material?.dispose();
        this.spireEye?.halo?.dispose();
        this.level = level ?? undefined;
        this.heldLight = undefined;
        this.smoke = undefined;
        this.lightMode = 'off';
        this.spireEye = undefined;
        this.lantern = undefined;
        this.eyeSearchAt = this.lanternSearchAt = 0;
        this.eyeRamp = -1;
        this.smokeShown = false;
        this.levelPending = true;
      }),
      bus.on('strike', (e) => (e.valid ? burstAt('sparks', e.x, e.y + .02, e.z) : burstAt('dust', e.x, e.y + .02, e.z))),
      // A knock on a tree still shows a few chips; other thuds kick up dust.
      bus.on('thud', (e) => burstAt(e.kind === 'tree' ? 'knock' : 'dust', e.x, e.y, e.z)),
      bus.on('crafted', (e) => { burstAt('craft', e.x, e.y + .08, e.z); burstAt('sparks', e.x, e.y + .04, e.z); }),
      bus.on('fuel-added', () => burstAt('flare', CAMP.fire.x, .35, CAMP.fire.z)),
      bus.on('fire-lit', () => burstAt('ignite', CAMP.fire.x, .3, CAMP.fire.z)),
      bus.on('torch-lit', (e) => burstAt('flare', e.x, e.y + .2, e.z)),
      bus.on('chop', (e) => burstAt('chips', e.x, e.y, e.z)),
      bus.on('harvest', (e) => burstAt('glint', e.x, e.y + .1, e.z)),
      bus.on('ingredient', () => burstAt('splash', POT_SURFACE.x, POT_SURFACE.y, POT_SURFACE.z)),
      bus.on('bowl-filled', () => burstAt('splash', POT_SURFACE.x, POT_SURFACE.y, POT_SURFACE.z)),
      bus.on('stew-ready', () => { for (let i = 0; i < 6; i++) burstAt('steam', POT_SURFACE.x, POT_SURFACE.y, POT_SURFACE.z); }),
      bus.on('creature', (e) => {
        if (e.cue === 'dissolve') { burstAt('ash', e.x, e.y + .5, e.z); burstAt('flare', e.x, e.y + .5, e.z); }
        if (e.cue === 'spawn' && e.species === 'wolf') burstAt('ash', e.x, e.y + .2, e.z);
      }),
      bus.on('hit', (e) => burstAt(e.species === 'wolf' ? 'flare' : 'dust', e.x, e.y, e.z)),
      bus.on('brazier-lit', (e) => burstAt('ignite', e.x, e.y + .8, e.z)),
      bus.on('guide', (e) => { if (e.id === 'note') this.beckon.noteStarted = true; }),
      bus.on('new-game', () => { this.beckon.noteStarted = false; }),
      bus.on('journey-begin', () => { this.beckon.noteStarted = false; }),
      bus.on('ending-step', (e) => {
        if (e.step === 'spire-eye') this.eyeRamp = 0;
        if (e.step === 'smoke') this.smokeShown = true;
      }),
      () => {
        for (const list of this.clones.values()) for (const material of list) material.dispose();
        this.clones.clear();
        this.spireEye?.material?.dispose();
        this.spireEye?.halo?.dispose();
        // The probe's own stand-ins (never the instantiated prototypes' shared resources).
        for (const child of this.warmProbe?.children ?? []) {
          if (child.userData.warmStandIn) {
            (child as Mesh).geometry.dispose();
            ((child as Mesh).material as Material).dispose();
          }
        }
      },
    );
  }

  private burst(name: keyof typeof BURSTS, at: Vector3, direction?: Vector3): void {
    const burst: Burst = BURSTS[name];
    const pool = GLINTS.has(name) ? this.glints : ADDITIVE.has(name) ? this.sparks : LARGE.has(name) ? this.smokePool : this.puffs;
    pool.emit(at, burst, direction);
  }

  /** Record a material clone made for `owner` (an entity index), so it is disposed with it. */
  private own<T extends Material>(owner: number, material: T): T {
    let list = this.clones.get(owner);
    if (!list) this.clones.set(owner, list = []);
    list.push(material);
    return material;
  }

  private release(owner: number): void {
    const list = this.clones.get(owner);
    if (!list) return;
    for (const material of list) material.dispose();
    this.clones.delete(owner);
  }

  /**
   * Compile every program the level can draw before it is first needed (flames, beacon, spire
   * eye, lost-pack beam, the forest's trees, hidden items; compileAsync walks hidden objects too),
   * plus a probe for looks that only appear later: a crafted torch, the creatures, and a
   * deployed sentry's lamp, glow and bolt tips. Inside an XR frame this compiles the
   * headset's (multiview) variants.
   */
  private warmShaders(): void {
    const { renderer, scene, camera } = this;
    const warm = async (root: Object3D) => {
      try {
        await renderer.compileAsync(root, camera, scene);
      } catch {
        // An optimisation only: a failed warm-up just compiles on first use.
      }
    };
    void warm(scene);
    if (this.warmProbe) {
      void warm(this.warmProbe);
      return;
    }
    const probe = new Group();
    const box = new BoxGeometry(.01, .01, .01);
    box.setAttribute('color', box.getAttribute('position').clone());
    // The sentry's dressing (CombatSystem): lamp, additive glow, instanced vertex-coloured bolt tips.
    probe.add(new Mesh(box, new MeshBasicMaterial({ color: 0xffa94d, toneMapped: false, fog: false })));
    probe.add(new Mesh(box, new MeshBasicMaterial({ color: 0x3a0f0b })));
    probe.add(new Mesh(box, new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false, toneMapped: false })));
    probe.add(new InstancedMesh(box, new MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .25, flatShading: true }), 1));
    for (const child of probe.children) child.userData.warmStandIn = true;
    this.warmProbe = probe;
    // Prototypes that only enter the scene later: a crafted torch, and the valley's creatures.
    void Promise.allSettled(WARM_PROTOTYPES.map((id) => this.world.assets.instantiate(id).then((object) => { probe.add(object); })))
      .then(() => warm(probe));
  }

  private captureFire(entity: Entity): void {
    const root = entity.object3D;
    if (!root) return;
    this.fireEntity = entity;
    const flames: Object3D[] = [];
    for (let i = 0; i < 4; i++) {
      const flame = root.getObjectByName(`flame-${i}`);
      if (flame) flames.push(flame);
    }
    let light: PointLight | undefined;
    root.traverse((object) => { if (object instanceof PointLight) light = object; });
    // Reach the benches, bedroll and spawn: the firelight is the night's safe ring.
    if (light) { light.distance = 8; light.decay = 1.6; }
    const broth = root.getObjectByName('broth') as Mesh | undefined;
    let brothMaterial: MeshStandardMaterial | undefined;
    if (broth?.material instanceof MeshStandardMaterial) {
      brothMaterial = this.own(entity.index, broth.material.clone());
      broth.material = brothMaterial;
    }
    this.fire = { flames, light, embers: root.getObjectByName('embers'), brothMaterial, bits: root.getObjectByName('food-bits') };
  }

  private captureBeacon(entity: Entity): void {
    const root = entity.object3D;
    const flame = root?.getObjectByName('beacon-flame');
    let glow: MeshStandardMaterial | undefined;
    // Per-brazier copies: each fuel bed glows, and each halo fades, on its own.
    root?.traverse((object) => {
      if (glow || !(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial)) return;
      if (object.material.name.toLowerCase().includes('coal')) {
        glow = object.material.clone();
        object.material = glow;
      }
    });
    const halo = root?.getObjectByName('beacon-halo') as Mesh | undefined;
    let haloMaterial: MeshBasicMaterial | undefined;
    if (halo?.material instanceof MeshBasicMaterial) {
      haloMaterial = halo.material.clone();
      halo.material = haloMaterial;
      halo.pointerEvents = 'none';
      halo.raycast = () => {};
    }
    if (glow) this.own(entity.index, glow);
    if (haloMaterial) this.own(entity.index, haloMaterial);
    const flames: ShaderMaterial[] = [];
    flame?.traverse((object) => {
      const material = (object as Mesh).material;
      if (material instanceof ShaderMaterial && material.uniforms.uTime && !flames.includes(material)) flames.push(material);
    });
    this.beaconParts.set(entity.index, { flame, glow, halo, haloMaterial, flames, spire: entity.getValue(Beacon, 'role') === 'spire' });
  }

  private flicker(flame: Object3D | undefined, phase: number, scale: number): void {
    if (!flame) return;
    flame.scale.set(scale * (1 + .035 * Math.sin(this.elapsed * 11 + phase)), scale * (1 + .075 * Math.sin(this.elapsed * 9 + phase)), scale);
    flame.rotation.z = .035 * Math.sin(this.elapsed * 6 + phase);
  }

  /** Keep a flame child pointing world-up however its torch or lighter is tilted. */
  private upright(flame: Object3D): void {
    const parent = flame.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    parent.getWorldQuaternion(this.quat).invert();
    flame.quaternion.copy(this.quat);
  }

  update(delta: number): void {
    const dt = Math.min(delta, .05);
    this.elapsed += dt;
    if (this.levelPending && this.world.activeLevel.peek()) {
      this.levelPending = false;
      this.warmPending = true;
    }
    let game: Entity | undefined;
    for (const entity of this.queries.game.entities) { game = entity; break; }
    const night = game ? nightness(game.getValue(GameState, 'clock') ?? 0) : 0;
    this.camera.getWorldPosition(this.viewer);
    this.beckonTimer -= dt;
    if (this.beckonTimer <= 0) {
      this.beckonTimer = BECKON_PICK_SECONDS;
      this.pickBeckoner(game);
    }
    this.updateCampfire(night, dt);
    this.updateBeacons(dt);
    this.updateItems(dt);
    this.detailTimer -= dt;
    if (this.detailTimer <= 0) {
      this.detailTimer = .2;
      this.cullDetail();
    }
    this.updateEnding(game, dt);
    this.updateLantern(game);
    this.sparks.update(dt);
    this.puffs.update(dt);
    this.smokePool.update(dt);
    this.glints.update(dt);
    this.pack ??= this.world.getSystem(BackpackSystem);
    const pack = this.pack;
    const mat = pack?.mat?.object3D;
    if (this.beam) {
      this.beam.visible = !!pack?.lost && !!mat;
      if (this.beam.visible && mat) {
        this.beam.position.set(mat.position.x, mat.position.y + 3.5, mat.position.z);
        (this.beam.material as MeshBasicMaterial).opacity = .25 + .1 * Math.sin(this.elapsed * 2.4);
      }
    }
    // Once the level's first frame has built everything (the forest's trees, the spire eye's
    // clone), and again inside the first XR frame after entering the headset.
    const presenting = this.renderer.xr.isPresenting;
    if (this.warmPending || (this.warmOnPresent && presenting)) {
      this.warmPending = false;
      if (presenting) this.warmOnPresent = false;
      this.warmShaders();
    }
  }

  /** Choose the one item that beckons: the lowest beckonRank among visible items (none when all rank -1). */
  private pickBeckoner(game: Entity | undefined): void {
    this.beckoner = undefined;
    if (!game) return;
    const state = this.beckon;
    const mask = game.getValue(GameState, 'objectives') ?? 0;
    const index = currentObjective(mask, phaseAt(game.getValue(GameState, 'clock') ?? 0));
    state.task = index >= 0 ? OBJECTIVES[index].id : '';
    state.mealDone = (mask & EAT_MEAL_BIT) !== 0;
    // The shade's 'note' line points at page 1 once the first fire burns.
    state.noteWaiting = (mask & LIGHT_FIRE_BIT) !== 0 && ((game.getValue(GameState, 'pages') ?? 0) & 1) === 0;
    const fire = this.fireEntity?.active ? this.fireEntity : undefined;
    state.potA = fire?.getValue(Campfire, 'potA') ?? '';
    state.potB = fire?.getValue(Campfire, 'potB') ?? '';
    state.stew = fire?.getValue(Campfire, 'stew') ?? '';
    const steps = BECKON_STEPS[state.task];
    state.placed = 0;
    if (steps) {
      for (const entity of this.queries.items.entities) {
        if (!(entity.getValue(Item, 'slot') ?? '').startsWith('bay-')) continue;
        const step = steps.indexOf(entity.getValue(Item, 'kind') ?? '');
        if (step >= 0) state.placed |= 1 << step;
      }
    }
    if (!steps && !state.noteWaiting) return;
    let best = Infinity;
    for (const entity of this.queries.items.entities) {
      if (!entity.object3D?.visible || entity.hasComponent(Held)) continue;
      const kind = entity.getValue(Item, 'kind') ?? '';
      const page = kind === 'page' && entity.hasComponent(Page) ? entity.getValue(Page, 'index') ?? 0 : 0;
      const rank = beckonRank(state, kind, entity.getValue(Item, 'slot') ?? '', entity.getValue(Item, 'variant') ?? '', page);
      if (rank >= 0 && rank < best) { best = rank; this.beckoner = entity; }
    }
  }

  /** An item's named flame or loaded bolt (DRESSING_PART), looked up once per entity. */
  private dressingOf(entity: Entity, object: Object3D, kind: string): Object3D | undefined {
    let part = this.dressing.get(entity.index);
    if (part === undefined) {
      part = object.getObjectByName(DRESSING_PART[kind]) ?? null;
      this.dressing.set(entity.index, part);
    }
    return part ?? undefined;
  }

  private updateCampfire(night: number, dt: number): void {
    const fire = this.fire;
    const entity = this.fireEntity;
    if (!fire || !entity?.active) return;
    const lit = entity.getValue(Campfire, 'lit') === true;
    const fuel = entity.getValue(Campfire, 'fuel') ?? 0;
    const strength = lit ? .45 + .55 * Math.min(1, fuel / 60) : 0;
    // By day the tongues stand taller so they read above the logs against the bright ground.
    const tall = 1 + .35 * (1 - night);
    for (let i = 0; i < fire.flames.length; i++) {
      const flame = fire.flames[i];
      flame.visible = lit;
      if (lit) {
        this.flicker(flame, i * 1.7, strength);
        flame.scale.y *= tall;
      }
    }
    if (fire.embers) fire.embers.visible = lit;
    const flick = 1 + .09 * Math.sin(this.elapsed * 7.3) + .05 * Math.sin(this.elapsed * 17.1);
    if (fire.light) fire.light.intensity = lit ? (2.2 + 2.6 * strength) * (1 + .6 * night) * flick : 0;
    if (this.groundGlow) {
      const material = this.groundGlow.material as MeshBasicMaterial;
      material.opacity = lit ? strength * (.12 + .38 * night) * flick : 0;
      this.groundGlow.visible = material.opacity > .01;
    }
    if (lit) {
      this.emberTimer -= dt;
      if (this.emberTimer <= 0) {
        this.emberTimer = .22 / strength;
        this.burst('embers', this.at.set(CAMP.fire.x + (Math.random() - .5) * .3, .45, CAMP.fire.z + (Math.random() - .5) * .3));
      }
    }

    const potA = entity.getValue(Campfire, 'potA') ?? '';
    const potB = entity.getValue(Campfire, 'potB') ?? '';
    const stew = entity.getValue(Campfire, 'stew') ?? '';
    if (lit && (potA || stew)) {
      this.steamTimer -= dt;
      if (this.steamTimer <= 0) {
        this.steamTimer = stew ? .25 : .6;
        this.burst('steam', POT_SURFACE);
      }
    }
    if (fire.brothMaterial) {
      const hex = stew ? STEW_TINT[stew] ?? BROTH.ready : potB ? BROTH[potB] ?? BROTH.meat : potA ? BROTH[potA] ?? BROTH.meat : BROTH.empty;
      if (fire.brothMaterial.color.getHex() !== hex) fire.brothMaterial.color.setHex(hex);
      fire.brothMaterial.emissive.setHex(lit ? 0x2a1206 : 0x000000);
    }
    if (fire.bits) {
      fire.bits.visible = !!(potA || potB);
      for (const bit of fire.bits.children) {
        const wantsMeat = bit.name === 'meat-piece';
        bit.visible = wantsMeat ? potA === 'meat' || potB === 'meat' : !!(potA && potA !== 'meat') || !!(potB && potB !== 'meat');
      }
      fire.bits.rotation.y = (entity.getValue(Campfire, 'stir') ?? 0) * .35;
    }
  }

  private updateItems(dt: number): void {
    // The roaming flame light: the beacon while it burns near you, else the brightest hand flame.
    this.heldLight ??= this.world.getSceneEntity('held-light');
    let mode: LightMode = 'off';
    let nearestLoose = 10;
    this.glintTimer -= dt;
    const glint = this.glintTimer <= 0;
    if (glint) this.glintTimer = .35;
    if (this.spireStrength > .02 && this.spireLight.distanceTo(this.viewer) < FLAME_LIGHT.beacon.range) {
      mode = 'beacon';
      this.best.copy(this.spireLight);
    }
    for (const entity of this.queries.items.entities) {
      const kind = entity.getValue(Item, 'kind');
      const object = entity.object3D;
      if (!object) continue;
      if (kind === 'torch') {
        const flame = this.dressingOf(entity, object, kind);
        const lit = entity.getValue(Item, 'lit') === true;
        if (flame) {
          flame.visible = lit && object.visible;
          if (lit) { this.upright(flame); this.flicker(flame, 1, 1); }
        }
        if (!lit || !object.visible) {
          this.sparkle(entity, object, glint);
          continue;
        }
        this.point.copy(TORCH_TIP);
        object.localToWorld(this.point);
        if (Math.random() < dt * 3) this.burst('embers', this.point);
        if (mode === 'beacon' || mode === 'torch') continue;
        if (entity.hasComponent(Held)) { this.best.copy(this.point); mode = 'torch'; continue; }
        const distance = this.point.distanceTo(this.viewer);
        if (distance < nearestLoose) { nearestLoose = distance; this.best.copy(this.point); mode = 'looseTorch'; }
        continue;
      }
      if (kind === 'lighter') {
        const flame = this.dressingOf(entity, object, kind);
        const lit = entity.getValue(Item, 'lit') === true;
        if (flame) {
          flame.visible = lit;
          if (lit) { this.upright(flame); this.flicker(flame, 2.3, 1); }
        }
        if (lit && mode === 'off') {
          this.point.copy(LIGHTER_TIP);
          object.localToWorld(this.point);
          this.best.copy(this.point);
          mode = 'lighter';
        }
      } else if (kind === 'bowl') {
        this.tintBowl(entity, object);
      } else if (kind === 'crossbow') {
        const loaded = this.dressingOf(entity, object, kind);
        if (loaded) loaded.visible = (entity.getValue(Item, 'charges') ?? 0) > 0;
      }
      this.sparkle(entity, object, glint);
    }
    this.driveFlameLight(mode);
  }

  /**
   * Distance culling for small items: one far off (a few pixels on screen) costs a draw for
   * nothing, so its meshes leave every camera layer until you come closer. Visibility,
   * bounds and grabbing are untouched; held items are never culled.
   */
  private cullDetail(): void {
    for (const entity of this.queries.items.entities) {
      const object = entity.object3D;
      if (!object) continue;
      let entry = this.detail.get(entity.index);
      if (!entry) {
        const meshes: Mesh[] = [];
        let radius = 0;
        object.updateWorldMatrix(true, true);
        object.getWorldScale(this.point);
        const scale = Math.max(this.point.x, this.point.y, this.point.z);
        const origin = object.getWorldPosition(this.origin);
        object.traverse((child) => {
          const mesh = child as Mesh;
          if (!mesh.isMesh || mesh.userData.outline || !mesh.geometry) return;
          if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
          const sphere = mesh.geometry.boundingSphere!;
          this.at.copy(sphere.center).applyMatrix4(mesh.matrixWorld);
          radius = Math.max(radius, this.at.distanceTo(origin) + sphere.radius * scale);
          meshes.push(mesh);
        });
        if (!meshes.length) continue;
        entry = { radius, meshes, masks: meshes.map((mesh) => mesh.layers.mask), culled: false };
        this.detail.set(entity.index, entry);
      }
      const e = object.matrixWorld.elements;
      const distance = Math.hypot(e[12] - this.viewer.x, e[13] - this.viewer.y, e[14] - this.viewer.z);
      const size = entry.radius / Math.max(distance, 1e-3);
      const culled = !entity.hasComponent(Held) && (entry.culled ? size < DETAIL_SHOW : size < DETAIL_CULL);
      if (culled === entry.culled) continue;
      entry.culled = culled;
      for (let i = 0; i < entry.meshes.length; i++) entry.meshes[i].layers.mask = culled ? NO_LAYERS : entry.masks[i];
    }
  }

  /**
   * Grabbable affordance: forage items waiting at their node glint from afar; any other
   * loose item within arm's-and-a-step range sparkles softly every 3–4 s; the current task's
   * key item waiting in the unrolled pack beckons every ~2 s from across camp.
   */
  private sparkle(entity: Entity, object: Object3D, glint: boolean): void {
    if (!object.visible || entity.hasComponent(Held)) return;
    const slot = entity.getValue(Item, 'slot') ?? '';
    const p = object.matrixWorld.elements;
    const dx = p[12] - this.viewer.x, dy = p[13] - this.viewer.y, dz = p[14] - this.viewer.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (slot === 'node') {
      if (glint && distance < NODE_GLINT_RANGE && Math.random() < .25) this.burst('glint', this.at.set(p[12], p[13] + .08, p[14]));
      return;
    }
    const key = entity === this.beckoner;
    if ((slot !== '' && !key) || distance > (key ? KEY_RANGE : SPARKLE_RANGE)) return;
    const due = this.sparkleAt.get(entity.index);
    if (due === undefined) {
      // Stagger first sparkles so a table of items never twinkles in unison.
      const stagger = (entity.index * .618) % 1;
      this.sparkleAt.set(entity.index, this.elapsed + (key ? .3 + stagger * 1.2 : .5 + stagger * 3));
      return;
    }
    if (this.elapsed < due) return;
    this.sparkleAt.set(entity.index, this.elapsed + (key ? 1.8 + Math.random() * .6 : 3 + Math.random()));
    this.burst(key ? 'beckon' : 'sparkle', this.at.set(p[12], p[13] + .05, p[14]));
  }

  private tintBowl(entity: Entity, object: Object3D): void {
    const variant = entity.getValue(Item, 'variant') ?? '';
    if (!variant || variant === 'empty') return;
    let material = this.bowlMaterials.get(entity.index);
    if (!material) {
      object.getObjectByName('bowl-contents')?.traverse((child) => {
        if (!material && child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
          material = child.material.clone();
          child.material = material;
        }
      });
      if (!material) return;
      this.bowlMaterials.set(entity.index, material);
    }
    const hex = STEW_TINT[variant] ?? BROTH.ready;
    if (material.color.getHex() !== hex) material.color.setHex(hex);
  }

  /** Move the one roaming point light to this frame's flame; its count never changes. */
  private driveFlameLight(mode: LightMode): void {
    const light = this.heldLight;
    if (!light?.object3D) return;
    if (mode !== this.lightMode) {
      this.lightMode = mode;
      const spec = mode === 'off' ? FLAME_LIGHT.torch : FLAME_LIGHT[mode];
      light.setValue(PointLightComponent, 'distance', spec.distance);
      light.setValue(PointLightComponent, 'decay', spec.decay);
    }
    if (mode === 'off') {
      light.setValue(PointLightComponent, 'intensity', 0);
      return;
    }
    light.object3D.position.copy(this.best);
    const flicker = mode === 'beacon'
      ? this.spireStrength * (1 + .1 * Math.sin(this.elapsed * 9.1) + .05 * Math.sin(this.elapsed * 23))
      : 1 + .12 * Math.sin(this.elapsed * 13.1) + .06 * Math.sin(this.elapsed * 29);
    light.setValue(PointLightComponent, 'intensity', FLAME_LIGHT[mode].intensity * flicker);
  }

  private updateBeacons(dt: number): void {
    let spireStrength = 0;
    for (const beacon of this.queries.beacons.entities) {
      const parts = this.beaconParts.get(beacon.index);
      if (!parts) continue;
      const lit = beacon.getValue(Beacon, 'lit') === true;
      const progress = beacon.getValue(Beacon, 'progress') ?? 0;
      const strength = lit ? 1 : progress;
      if (parts.spire) {
        spireStrength = strength;
        if (progress > 0 && !lit && Math.random() < dt * 12 * progress) {
          this.burst('embers', this.at.set(LANDMARKS.beacon.x, LANDMARKS.beacon.y, LANDMARKS.beacon.z));
        }
      }
      const burning = strength > .02;
      if (parts.flame) {
        parts.flame.visible = burning;
        if (burning) {
          this.flicker(parts.flame, beacon.index, .35 + .65 * strength);
          for (let i = 0; i < parts.flames.length; i++) parts.flames[i].uniforms.uTime.value = this.elapsed;
        }
      }
      if (parts.halo && parts.haloMaterial) {
        parts.halo.visible = burning;
        if (burning) {
          // A soft glow card that always faces you.
          parts.halo.parent?.getWorldQuaternion(this.quat).invert();
          parts.halo.quaternion.copy(this.quat).multiply(this.camera.getWorldQuaternion(this.quat2));
          // Like the tongues, the glow thins within ~2 m so a close look sees into the fire.
          const near = smooth(1.2, 3, parts.halo.getWorldPosition(this.point).distanceTo(this.viewer));
          parts.haloMaterial.opacity = strength * (.5 + .08 * Math.sin(this.elapsed * 7 + beacon.index)) * (.45 + .55 * near);
        }
      }
      if (parts.glow) {
        // Only the charcoal lumps carry this material: embers between charred sticks. Two
        // incommensurate beats flicker the bed; scrolling the ramp's V lets each lump breathe.
        parts.glow.emissive.setRGB(1, .42, .1);
        const flicker = 1 + .12 * Math.sin(this.elapsed * 5.3 + beacon.index) + .07 * Math.sin(this.elapsed * 12.7 + beacon.index * 2.1);
        parts.glow.emissiveIntensity = strength * (parts.spire ? SPIRE_COAL_GLOW : BRAZIER_COAL_GLOW) * flicker;
        const ramp = parts.glow.emissiveMap;
        if (ramp && parts.glow.userData.emberBreath) ramp.offset.y = (this.elapsed * .12) % 1;
      }
    }
    this.spireStrength = spireStrength;
    const b = LANDMARKS.beacon;
    this.spireLight.set(b.x, b.y + FLAME_LIGHT.beacon.lift, b.z);
  }

  private updateEnding(game: Entity | undefined, dt: number): void {
    const ended = game?.getValue(GameState, 'ended') === true;
    if (!this.spireEye && this.level && this.elapsed >= this.eyeSearchAt) {
      this.eyeSearchAt = this.elapsed + 1;
      const object = this.world.getActiveRoot().getObjectByName('spire-eye');
      if (object) {
        let material: (Material & { opacity: number; emissiveIntensity?: number }) | undefined;
        let halo: MeshBasicMaterial | undefined;
        object.traverse((child) => {
          if (!(child instanceof Mesh) || Array.isArray(child.material)) return;
          if (child.name === 'spire-eye-halo') {
            if (!halo && child.material instanceof MeshBasicMaterial) child.material = halo = child.material.clone();
            child.raycast = () => {};
            return;
          }
          if (!material) {
            material = child.material.clone() as Material & { opacity: number; emissiveIntensity?: number };
            material.transparent = true;
            child.material = material;
          }
        });
        this.spireEye = { object, material, glow: material?.emissiveIntensity ?? 1, halo, haloOpacity: halo?.opacity ?? 0 };
      }
    }
    if (this.spireEye) {
      // Loaded endings show the eye at once; a live ending ramps it over 2 s.
      if (ended && this.eyeRamp < 0) this.eyeRamp = 2;
      const t = ended ? Math.min(1, (this.eyeRamp += dt) / 2) : 0;
      this.spireEye.object.visible = t > 0;
      // A slow, noisy flicker (three incommensurate beats), never a steady disc.
      const e = this.elapsed;
      const flicker = .5 + .5 * (.5 * Math.sin(e * 1.3) + .3 * Math.sin(e * 2.9 + 1.1) + .2 * Math.sin(e * 5.3 + 2.4));
      const eye = this.spireEye;
      if (eye.material) {
        eye.material.opacity = t * (.9 + .1 * flicker);
        if (eye.material.emissiveIntensity !== undefined) eye.material.emissiveIntensity = eye.glow * (.8 + .3 * flicker);
      }
      if (eye.halo) eye.halo.opacity = t * eye.haloOpacity * (.7 + .45 * flicker);
    }
    this.smoke ??= this.world.getSceneEntity('ending-smoke');
    const smoke = this.smoke?.object3D;
    if (smoke) smoke.visible = ended && (this.smokeShown || this.eyeRamp > 8);
  }

  /** Every fire went out: the camp lantern is cold glass until you light the first fire. */
  private updateLantern(game: Entity | undefined): void {
    if (!this.lantern) {
      if (!this.level || this.elapsed < this.lanternSearchAt) return;
      this.lanternSearchAt = this.elapsed + 1;
      this.world.getActiveRoot().traverse((object) => {
        if (!this.lantern && object instanceof Mesh && object.material instanceof MeshBasicMaterial && object.material.name === 'Lantern glow') {
          this.lantern = object.material;
        }
      });
      if (!this.lantern) return;
    }
    const warm = ((game?.getValue(GameState, 'objectives') ?? 0) & 1) !== 0;
    const hex = warm ? 0xffc46a : 0x3a3024;
    if (this.lantern.color.getHex() !== hex) this.lantern.color.setHex(hex);
  }
}
