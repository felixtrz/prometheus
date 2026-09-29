/**
 * CreatureSystem (priority 16): spawns prey by day and ash-wolves by night and danger
 * stage, runs their steering AI, animates the named rig parts, drops meat and emits
 * the creature cues audio listens for.
 *
 * Inputs from other systems: CombatSystem lowers Creature.health (and may set
 * Creature.mode = 'scared' for torch contact); GameState carries the clock, stage and
 * ending; lit Campfires keep wolves out of their ring, and a held lit torch wards only
 * the cone in front of its flame (DANGER.torch*): wolves circle to the unguarded side,
 * feint into poke range (mode 'feint') and attack from behind. Creatures in mode
 * 'dying' are finished: skip them for hits and targeting. Wolves rise from ash in mode
 * 'emerge' (1.2 s) before they hunt.
 *
 * Pacing: bites are at least DANGER.biteCooldown apart and every warning crouch waits
 * DANGER.attackGap after the last attack. From the flank stage the pack stages pincers
 * (W.pincer*): two wolves take posts either side of an exposed player, beyond the torch's
 * cone, then crouch one after the other (DANGER.pincerStagger apart, each with its own
 * growl), so only a quick torch-bearer answers both. Night wolves arrive in
 * DANGER.nightWaves; after a respawn the pack keeps off for DANGER.respiteSeconds.
 *
 * The Spire hold: guardians attack FINALE.attackSlots[wave] at a time, FINALE.attackGap
 * apart; every other guardian crouches at the brazier (mode 'press') and drains the hold
 * (`pressing`, read by StorySystem; bus 'beacon-pressed') until it is warded off, scared
 * or killed. Guardians never dissolve at dawn, only when the ending comes, when the
 * attempt is abandoned for W.guardianRecallSeconds, or when the player dies (they never
 * follow a respawn home).
 */
import {
  createSystem, eq, Mesh, MeshBasicMaterial, Vector3, VisibilityState,
} from '@iwsdk/core';
import type { Color, Entity, Object3D } from '@iwsdk/core';
import { bus } from '../bus.js';
import type { GameEvent } from '../bus.js';
import { Beacon, Campfire, Creature, CreatureSpawn, GameState, Held, Item } from '../components.js';
import {
  angularGap, approach, attackReady, attackSlots, bearingFromAxis, biteLands, clampToBounds, detour, feintPhase, fleePoint,
  headingTo, horizontalDistance, inView, lungeEnd, nightWolvesDue, pressOffset, pressSpot, pushOutside, ringPoint, ringTarget,
  shouldFlee, smoothing, TAU, torchWard, turnToward, wanderPoint, wavesReached, wolfIntent, wrapAngle,
} from '../creature-ai.js';
import type { FleeRule, XZ } from '../creature-ai.js';
import { ITEMS } from '../catalog.js';
import { DANGER, DAY, DAY_LENGTH, FINALE, finaleGap, finaleSlots, nightness, phaseAt } from '../rules.js';
import type { Phase } from '../rules.js';
import { LANDMARKS, terrainHeight, WORLD_BOUNDS } from '../terrain.js';
import { DayNightSystem } from './daynight-system.js';

type Species = 'deer' | 'rabbit' | 'wolf';

interface SpeciesTuning {
  health: number; meat: number; walk: number; run: number; turn: number; accel: number;
  stride: number; strideGain: number; legSwing: number; runSwing: number; bob: number;
  graze: number; lying: number; dyingSeconds: number; hitY: number; hitRadius: number;
  /** Flee at any player speed inside this radius. */
  panicRadius: number;
  /** Item dropped on a kill (not on dawn dissolve), and how many. */
  drop: string; drops: number;
}

const SPECIES: Record<Species, SpeciesTuning> = {
  deer: {
    health: 1, meat: 2, walk: .85, run: 6.2, turn: 3.2, accel: 6, stride: 1.05, strideGain: .2, legSwing: .42,
    runSwing: .85, bob: .022, graze: 2.0, lying: .2, dyingSeconds: 1.4, hitY: .85, hitRadius: .45,
    panicRadius: 1.7, drop: 'meat', drops: 2,
  },
  rabbit: {
    health: 1, meat: 1, walk: .55, run: 4.6, turn: 8, accel: 14, stride: .3, strideGain: .14, legSwing: .5,
    runSwing: .9, bob: .05, graze: .45, lying: .075, dyingSeconds: 1.1, hitY: .14, hitRadius: .18,
    panicRadius: 2.5, drop: 'meat', drops: 1,
  },
  wolf: {
    health: DANGER.wolfHealth, meat: 0, walk: 1.5, run: 6, turn: 4.2, accel: 8, stride: .8, strideGain: .16,
    legSwing: .45, runSwing: .8, bob: .02, graze: 0, lying: .2, dyingSeconds: 1.2, hitY: .56, hitRadius: .4,
    panicRadius: 0, drop: 'flint', drops: 1,
  },
};

/** Creature tuning. `species.*.hitY/hitRadius` describe the body hit sphere for CombatSystem. */
export const CREATURE_TUNING = {
  species: SPECIES,
  prey: {
    maxAlive: 6, spawnRange: 40, despawnRange: 58, minSpawnDistance: 14, respawnCooldown: 75, spawnInterval: .6,
    /** Spawn (and despawn) outside the view cone (dot < viewDot) or beyond `hiddenRange`. */
    viewDot: .2, hiddenRange: 35, inViewAfter: 8, scaleInSeconds: .8, scaleFrom: .3,
    flee: { hurryRadius: 6, hurrySpeed: 1.2 },
    wolfFleeRadius: 8, calmSeconds: 6, fleeDistance: 7, scaredSeconds: 4,
    grazeSeconds: [3, 8], idleSeconds: [1.5, 4], wanderSeconds: 12, leash: 2.5,
  },
  wolf: {
    ringRadius: [7.3, 9], ringLead: .4, prowlSpeed: 1.5, approachSpeed: 3.4, stalkSpeed: 2.9, creepSpeed: 1.6,
    creepRange: 6, holdRadius: 4.2, stalkRange: 32, attackRange: 2.2, abandonRange: 3.6, telegraphSeconds: DANGER.telegraphSeconds,
    lungeSeconds: .3, lungeStop: .8, biteReach: 1.2, retreatSeconds: 3, retreatSpeed: 3.6, backoffSpeed: 1.8,
    scaredSeconds: 4, scaredSpeed: 6, hurtRetreatSeconds: 1.2,
    /** On a death or respawn the pack scatters this long (then keeps off for DANGER.respiteSeconds). */
    scatterSeconds: 3,
    /** During the respite prowlers ring the fire this much wider (out of smothering reach), or the player at keepOffRadius. */
    respiteRing: 4, keepOffRadius: 11,
    /** No new warning crouch within this long of the last bite, whatever the gap. */
    crouchAfterBite: 1.2,
    /**
     * Facing a torch-bearer: a wolf closer than feintRange in front of the flame darts in to
     * feintReach from the player's head (poke range), snaps, and hops back; feintEvery
     * spaces its feints. Otherwise it circles (circleRadius, circleLead) toward the side
     * away from the flame and only closes once it is flankAngle round from where the torch points.
     */
    feintRange: 3.4, feintReach: 1.35, feintIn: .4, feintSnap: .25, feintSeconds: 1.1, feintBackSpeed: 3.4,
    feintEvery: [1.6, 3.2], flankAngle: 1.95, circleRadius: [2.6, 4.5], circleLead: .75, circleSpeed: 2.6,
    /** Wolves keep this far apart (a readable ring, not a pile). */
    separation: .9,
    /**
     * A torch whose tip is this close to the spire brazier is busy lighting it and wards nothing
     * (just outside the beacon's .45 m hold sphere: pull it out to defend yourself and it wards again).
     */
    brazierBusyRadius: .6,
    /** A newly risen wolf announces itself soon; later howls space out. */
    firstHowlSeconds: [2.5, 9], howlSeconds: [16, 36], howlPose: 1.6, howlGap: 7, growlGap: 2.5, spawnDistance: 15, fallbackRing: 26,
    /** Wolves never appear closer than this to the player, and rise from ash over emergeSeconds. */
    minSpawnDistance: 14, emergeSeconds: 1.2, emergeDepth: .4,
    /**
     * From this stage two wolves may telegraph/lunge at once (facing one leaves your back to
     * the other). Stage 3 only: at stage 2 an attentive torch-bearer can still face each attack.
     */
    flankFromStage: 3,
    /**
     * The pincer (flank stage, night wolves, player out of the firelight): every pincerEvery
     * seconds the two free wolves nearest the player (within pincerRange) take posts pincerRing
     * from the player, one each side, pincerPostAngle round from where the torch (or the view)
     * points: both outside its ward, and the posts follow the player as they turn. They circle
     * round rather than through. Once both are posted (within pincerPostTolerance, or at
     * pincerGather seconds if both are within pincerRange / 2) they run in (pincerSpeed),
     * ignoring the pack's attack gap: the first to reach attackRange crouches for only
     * pincerTelegraph; its partner waits DANGER.pincerStagger, then crouches (and growls, from
     * its side) for pincerTelegraph2. Facing the first turns your back on the second: only a
     * quick player answers both. The strike lapses after pincerStrike seconds.
     */
    pincerRange: 14, pincerRing: 3.6, pincerPostAngle: 1.75, pincerPostTolerance: 1, pincerGather: 6, pincerStrike: 2.5,
    pincerSpeed: 3.6, pincerTelegraph: .65, pincerTelegraph2: .8, pincerEvery: [9, 15], pincerClearance: 2.6,
    stalkCueSeconds: 2.5, stalkCueRange: 12,
    /** Finale guardians: FINALE.waveSizes, on a ring round the spire; recalled 20 s after an abandoned attempt. */
    guardianRing: [10, 13], guardianMinDistance: 8.5, guardianRecallSeconds: 20,
    /** A pressing guardian this close to its spot stops and crouches, facing the brazier; it passes the player this wide. */
    pressSettle: .35, pressClearance: 1.3,
    duskSpawnNightness: .85, fireMargin: .4,
  },
  /** Every creature keeps this far from any campfire (lit or not). */
  campfireAvoidRadius: 1,
  boundsMargin: 1.5,
  playerSpeedSmoothing: .25,
  maxPlayerSpeed: 8,
  /** Max metres per second a hazard disc may shove a creature. */
  pushSpeed: 7,
} as const;

const P = CREATURE_TUNING.prey;
const W = CREATURE_TUNING.wolf;
const MAX_FIRES = 4;
const MAX_TORCHES = 8;
/** Night pack (5) plus every guardian of a hold and a quick retry's shortfall. */
const MAX_WOLVES = 24;
const UP = new Vector3(0, 1, 0);
const LEG_NAMES = ['leg-fl', 'leg-fr', 'leg-bl', 'leg-br'] as const;
// Diagonal walk (fl+br, fr+bl) and bounding gallop phase offsets per leg.
const WALK_PHASE = [0, Math.PI, Math.PI, 0];
const GALLOP_PHASE = [0, .35, Math.PI, Math.PI + .35];

const TORCH_TIP = ITEMS.torch.tip;
const TORCH_CONE_COS = Math.cos(DANGER.torchConeDegrees * Math.PI / 180);
const TORCH_CONE = DANGER.torchConeDegrees * Math.PI / 180;
const NIGHTFALL = DAY.day + DAY.dusk;
/** A held torch whose flame is this close to the head is the player's own ward. */
const OWN_TORCH_RANGE = 1.3;
const FLEE: Record<Species, FleeRule> = {
  deer: { panicRadius: SPECIES.deer.panicRadius, hurryRadius: P.flee.hurryRadius, hurrySpeed: P.flee.hurrySpeed },
  rabbit: { panicRadius: SPECIES.rabbit.panicRadius, hurryRadius: P.flee.hurryRadius, hurrySpeed: P.flee.hurrySpeed },
  wolf: { panicRadius: 0, hurryRadius: 0, hurrySpeed: Infinity },
};

const random = (range: readonly number[]) => range[0] + Math.random() * (range[1] - range[0]);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Per-creature scene-graph handles and AI scratch, keyed by the entity's Object3D. */
interface CreatureRig {
  species: Species;
  wolf: boolean;
  body: Object3D | null;
  head: Object3D | null;
  tail: Object3D | null;
  legs: (Object3D | null)[];
  bodyY: number;
  embers: MeshBasicMaterial | null;
  eyes: MeshBasicMaterial | null;
  eyeBase: Color | null;
  anchor: Object3D | null;
  radius: number;
  night: boolean;
  guardian: boolean;
  seed: number;
  gait: number;
  ringRadius: number;
  ringDir: number;
  veer: number;
  howlIn: number;
  howling: number;
  growlIn: number;
  lastMode: string;
  lastHealth: number;
  threatX: number; threatZ: number;
  goalX: number; goalZ: number;
  fromX: number; fromZ: number; toX: number; toZ: number;
  headPitch: number; headYaw: number; bodyPitch: number; crouch: number; tailLift: number;
  rollSide: number;
  /** Latched once dying starts, so later writes to Creature.mode cannot revive it. */
  dying: boolean;
  shadow: Object3D | null;
  /** Seconds since spawn (drives the prey scale-in). */
  age: number;
  stalkCueIn: number;
  /** Time (s) this wolf may next feint at a torch; whether this feint has snapped yet. */
  feintAt: number;
  snapped: boolean;
  /** Guardians: where round the brazier this one presses (see pressOffset). */
  pressOffset: number;
  /** Guardians: the recall epoch it rose in (a player death recalls every guardian of an older one). */
  epoch: number;
  /** Which of every three frames a standing creature re-tilts its contact shadow (0..2). */
  shadowSlot: number;
}

/**
 * Decision output, reused every tick. `direct` moves the creature along rig.from → rig.to
 * (a lunge or a feint's dash), `directT` of the way there, covering it in `directSeconds`.
 */
interface Intent {
  mode: string; timer: number; desired: number; face: number; direct: boolean; backpedal: boolean;
  directT: number; directSeconds: number;
}

export class CreatureSystem extends createSystem({
  creatures: { required: [Creature] },
  spawns: { required: [CreatureSpawn] },
  state: { required: [GameState] },
  fires: { required: [Campfire] },
  torches: { required: [Item], where: [eq(Item, 'kind', 'torch'), eq(Item, 'lit', true)] },
  beacons: { required: [Beacon], where: [eq(Beacon, 'role', 'spire')] },
}) {
  private rigs = new WeakMap<Object3D, CreatureRig>();
  private viewer = new Vector3();
  private lastPlayer = new Vector3();
  private hasLastPlayer = false;
  private playerSpeed = 0;
  private scratch = new Vector3();
  private point: XZ = { x: 0, z: 0 };
  private target: XZ = { x: 0, z: 0 };
  private detoured: XZ = { x: 0, z: 0 };
  private pushed: XZ = { x: 0, z: 0 };
  private intent: Intent = { mode: '', timer: 0, desired: 0, face: NaN, direct: false, backpedal: false, directT: 0, directSeconds: 1 };
  private litFires = new Float32Array(MAX_FIRES * 2);
  private litFireCount = 0;
  private allFires = new Float32Array(MAX_FIRES * 2);
  private allFireCount = 0;
  private torchPos = new Float32Array(MAX_TORCHES * 2);
  /** Horizontal unit direction each torch flame points (0, 0 for a loose torch: it wards only at the flame). */
  private torchAxis = new Float32Array(MAX_TORCHES * 2);
  private torchCount = 0;
  private torchBase = new Vector3();
  /** The player's own held torch (flame near the head): where it is and which way it points. */
  private playerTorch = false;
  private playerTorchAx = 0;
  private playerTorchAz = 0;
  /** Distance to the flame found by the last torchThreat(). */
  private threatD = Infinity;
  private wolfPos = new Float32Array(MAX_WOLVES * 2);
  private wolfCount = 0;
  private pendingPrey = 0;
  private pendingWolves = 0;
  private pendingGuardians = 0;
  /** Guardians left from an abandoned attempt, not yet counted against this attempt's waves. */
  private holdovers = 0;
  private pendingAt = new Map<Object3D, number>();
  private anchorCooldown = new Map<Object3D, number>();
  private spawnClock = 0;
  private nightSpawned = 0;
  /** Finale guardian waves already summoned during the current lighting attempt. */
  private waveIndex = 0;
  private beaconProgress = 0;
  private beaconLit = false;
  /** Seconds since the spire beacon last had progress (recalls stranded guardians). */
  private beaconIdle = 0;
  /** Seconds prey have been unable to spawn out of view (then they may scale in, in view). */
  private preyBlocked = 0;
  private forward = new Vector3();
  private howlGap = 0;
  private wolfCursor = 0;
  private generation = 0;
  private time = 0;
  private phase: Phase = 'day';
  private night = 0;
  private stage = 0;
  private ended = false;
  private playerSafe = false;
  private nearestX = 0;
  private nearestZ = 0;
  /** Wolves allowed to telegraph/lunge at once (1, or 2 from the flank stage); the rest hold a ring round the player. */
  private attackers: (Object3D | null)[] = [null, null];
  /** The one wolf feinting at the player's torch. */
  private feinter: Object3D | null = null;
  private lastBite = -Infinity;
  private lastAttackEnd = -Infinity;
  private respiteUntil = -Infinity;
  /** The Spire hold is under way: guardians attack one at a time; night wolves leave the player to them. */
  private finaleActive = false;
  /** Seconds since nightfall on the current clock (negative through the day and dusk). */
  private sinceNightfall = 0;
  /** Sky darkness for the ember and eye glow (the finale darkens the sky whatever the clock). */
  private dark = 0;
  private daynight?: DayNightSystem;
  private game?: Entity;
  /** Guardians pressing the beacon (settled at the end of each update) and this frame's running count. */
  private pressCount = 0;
  private pressTally = 0;
  /** Guardians summoned this attempt (spreads their press spots round the brazier). */
  private pressSerial = 0;
  /** The "smothering the beacon" toast has been shown this attempt. */
  private pressWarned = false;
  /** The two free guardians nearest the player: the ones that attack when slots open (see slotCount). */
  private nextAttacker: Object3D | null = null;
  private nextAttacker2: Object3D | null = null;
  /** Earliest time (s) the pack may stage its next pincer. */
  private pincerAt = 0;
  /** The pincer under way: its two wolves (null once one has crouched or dropped out), and which side each posts on (±1). */
  private pincerWolves: (Object3D | null)[] = [null, null];
  private pincerSides = new Int8Array(2);
  /** The pincer's deadline: to post (gathering) or to crouch (striking). */
  private pincerUntil = 0;
  private pincerStriking = false;
  /** Pincer wolves that have crouched in this strike, and when the next may (DANGER.pincerStagger after the first). */
  private pincerCrouched = 0;
  private pincerNextAt = 0;
  /** Bumped on every player death: guardians of an older epoch dissolve, and one still loading never rises. */
  private guardianEpoch = 0;
  /** Update count (staggers the standing creatures' shadow refresh). */
  private frame = 0;
  /** Running tallies for balance checks this journey: pincer orders given and pincer crouches that followed. */
  readonly stats = { pincerOrders: 0, pincerCrouches: 0 };

  /** Guardians crouched at the Spire brazier right now, each draining FINALE.pressPerGuardian of the hold per second. */
  get pressing(): number {
    return this.pressCount;
  }

  init(): void {
    // DayNight is registered first (index.ts); update() looks again should that ever change.
    this.daynight = this.world.getSystem(DayNightSystem);
    this.cleanupFuncs.push(
      this.queries.state.subscribe('qualify', (entity) => { this.game = entity; }, true),
      this.queries.state.subscribe('disqualify', (entity) => { if (this.game === entity) this.game = undefined; }),
      // However a creature goes (killed, dissolved, disposed with its level), it gives up its slots.
      this.queries.creatures.subscribe('disqualify', (entity) => this.forget(entity.object3D)),
      bus.on('new-game', () => this.clearAll()),
      bus.on('journey-begin', () => {
        this.endPincer(0);
        this.pressWarned = false;
        this.stats.pincerOrders = this.stats.pincerCrouches = 0;
      }),
      bus.on('death', () => {
        this.scatterWolves();
        // The Spire's guardians never follow a respawn home: they dissolve where they stand.
        this.guardianEpoch++;
      }),
      bus.on('respawn', () => {
        this.scatterWolves();
        this.respiteUntil = this.time + DANGER.respiteSeconds;
      }),
      // A level swap orphans any spawn still loading (it would land in the new level), every
      // anchor, and the pack's slots (their wolves went with the old level).
      this.world.activeLevel.subscribe(() => {
        this.generation++;
        this.pendingAt.clear();
        this.anchorCooldown.clear();
        this.resetPack();
      }),
    );
  }

  update(delta: number): void {
    const visibility = this.visibilityState.peek();
    if (visibility === VisibilityState.Hidden || visibility === VisibilityState.VisibleBlurred) return;
    const state = this.game;
    if (!state) return;
    this.daynight ??= this.world.getSystem(DayNightSystem);
    const dt = Math.min(delta, .1);
    // Play time: every deadline here (respite, bites, pincers, feints) stands still while the world is paused.
    this.time += dt;
    this.frame++;
    const clock = state.getValue(GameState, 'clock') ?? 0;
    this.stage = state.getValue(GameState, 'stage') ?? 0;
    this.ended = state.getValue(GameState, 'ended') ?? false;
    this.phase = phaseAt(clock);
    this.night = nightness(clock);
    this.dark = Math.max(this.night, this.daynight?.finaleDark ?? 0);
    this.sinceNightfall = (((clock % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) - NIGHTFALL;
    if (this.phase === 'day') this.nightSpawned = 0;
    this.howlGap = Math.max(0, this.howlGap - dt);

    this.samplePlayer(dt);
    this.sampleBeacon(dt);
    this.sampleHazards();
    this.playerSafe = this.insideLitFire(this.viewer.x, this.viewer.z);

    this.spawnClock -= dt;
    if (this.spawnClock <= 0) {
      this.spawnClock = P.spawnInterval;
      this.manageSpawns();
    }
    this.pressTally = 0;
    this.managePincer();
    for (const entity of this.queries.creatures.entities) this.tick(entity, dt);
    this.settlePress();
  }

  /** Publish how many guardians press the beacon (bus 'beacon-pressed' on change; a toast the first time each attempt). */
  private settlePress(): void {
    const count = this.finaleActive ? this.pressTally : 0;
    if (count === this.pressCount) return;
    const joined = count > this.pressCount;
    this.pressCount = count;
    bus.emit({ type: 'beacon-pressed', count, joined });
    if (joined && !this.pressWarned) {
      this.pressWarned = true;
      bus.emit({
        type: 'toast', tone: 'warn', text: 'The Hollow are smothering the beacon',
        body: 'Keep the flame in. Drive them off with your other hand.', hold: 5,
      });
    }
  }

  // ---- Sensing ------------------------------------------------------------------

  private samplePlayer(dt: number): void {
    this.camera.getWorldPosition(this.viewer);
    if (this.hasLastPlayer && dt > 0) {
      const raw = Math.min(CREATURE_TUNING.maxPlayerSpeed,
        horizontalDistance(this.viewer.x, this.viewer.z, this.lastPlayer.x, this.lastPlayer.z) / dt);
      this.playerSpeed += (raw - this.playerSpeed) * smoothing(dt, CREATURE_TUNING.playerSpeedSmoothing);
    }
    this.lastPlayer.copy(this.viewer);
    this.hasLastPlayer = true;
    this.camera.getWorldDirection(this.forward);
  }

  private sampleBeacon(dt: number): void {
    let progress = 0, lit = false;
    for (const beacon of this.queries.beacons.entities) {
      progress = Math.max(progress, beacon.getValue(Beacon, 'progress') ?? 0);
      lit ||= beacon.getValue(Beacon, 'lit') ?? false;
    }
    this.beaconProgress = progress;
    this.beaconLit = lit;
    this.beaconIdle = progress > 0 ? 0 : this.beaconIdle + dt;
    this.finaleActive = progress > 0 && !lit && !this.ended;
    if (progress <= 0) {
      this.waveIndex = 0;
      this.pressWarned = false;
    }
    if (this.ended || lit) return;
    // Each FINALE wave threshold crossed during this attempt summons a fixed wave, whatever the
    // stage. Guardians still about from an abandoned attempt stand in for the first ones due
    // (a quick retry meets the survivors, not a second pack); kills this attempt are never refilled.
    const reached = wavesReached(progress, FINALE.waves);
    while (this.waveIndex < reached) {
      if (this.waveIndex === 0) this.holdovers = this.liveGuardians();
      const size = FINALE.waveSizes[this.waveIndex] ?? 0;
      const standIns = Math.min(size, this.holdovers);
      this.holdovers -= standIns;
      this.waveIndex++;
      this.spawnGuardians(size - standIns);
      bus.emit({ type: 'finale-wave', wave: this.waveIndex, count: size - standIns });
    }
  }

  /** Guardians alive or on their way (spawns still loading count too). */
  private liveGuardians(): number {
    let count = this.pendingGuardians;
    for (const entity of this.queries.creatures.entities) {
      const rig = entity.object3D ? this.rigs.get(entity.object3D) : undefined;
      if (rig?.guardian && !rig.dying) count++;
    }
    return count;
  }

  /** The spire brazier is being lit: a torch held in it is busy and wards nothing. */
  private brazierBusy(): boolean {
    return this.beaconProgress > 0 && this.beaconProgress < 1 && !this.beaconLit;
  }

  private sampleHazards(): void {
    this.litFireCount = 0;
    this.allFireCount = 0;
    for (const fire of this.queries.fires.entities) {
      if (!fire.object3D || this.allFireCount >= MAX_FIRES) continue;
      fire.object3D.getWorldPosition(this.scratch);
      this.allFires[this.allFireCount * 2] = this.scratch.x;
      this.allFires[this.allFireCount * 2 + 1] = this.scratch.z;
      this.allFireCount++;
      if (fire.getValue(Campfire, 'lit')) {
        this.litFires[this.litFireCount * 2] = this.scratch.x;
        this.litFires[this.litFireCount * 2 + 1] = this.scratch.z;
        this.litFireCount++;
      }
    }
    this.torchCount = 0;
    this.playerTorch = false;
    let ownDistance = OWN_TORCH_RANGE;
    for (const torch of this.queries.torches.entities) {
      if (!torch.object3D || this.torchCount >= MAX_TORCHES) continue;
      const slot = torch.getValue(Item, 'slot') ?? '';
      // Packed, lost or consumed torches do not ward anything off.
      if (slot === 'consumed' || slot.startsWith('pack-') || slot.startsWith('lost-')) continue;
      // The flame is at the torch tip.
      this.scratch.set(TORCH_TIP[0], TORCH_TIP[1], TORCH_TIP[2]);
      torch.object3D.localToWorld(this.scratch);
      if (this.brazierBusy() && Math.hypot(this.scratch.x - LANDMARKS.beacon.x, this.scratch.y - LANDMARKS.beacon.y,
        this.scratch.z - LANDMARKS.beacon.z) < W.brazierBusyRadius) continue;
      const i = this.torchCount++;
      this.torchPos[i * 2] = this.scratch.x;
      this.torchPos[i * 2 + 1] = this.scratch.z;
      let ax = 0, az = 0;
      if (torch.hasComponent(Held)) {
        // Where a held flame points: along the shaft and out from the body, flattened.
        torch.object3D.getWorldPosition(this.torchBase);
        ax = 2 * this.scratch.x - this.torchBase.x - this.viewer.x;
        az = 2 * this.scratch.z - this.torchBase.z - this.viewer.z;
        const length = Math.hypot(ax, az);
        if (length > 1e-3) { ax /= length; az /= length; } else { ax = az = 0; }
        const own = horizontalDistance(this.scratch.x, this.scratch.z, this.viewer.x, this.viewer.z);
        if (own < ownDistance && (ax !== 0 || az !== 0)) {
          ownDistance = own;
          this.playerTorch = true;
          this.playerTorchAx = ax;
          this.playerTorchAz = az;
        }
      }
      this.torchAxis[i * 2] = ax;
      this.torchAxis[i * 2 + 1] = az;
    }
    this.wolfCount = 0;
    this.nextAttacker = this.nextAttacker2 = null;
    let nextD = Infinity, next2D = Infinity;
    for (const entity of this.queries.creatures.entities) {
      const object = entity.object3D;
      const rig = object ? this.rigs.get(object) : undefined;
      if (!object || !rig?.wolf || this.wolfCount >= MAX_WOLVES) continue;
      this.wolfPos[this.wolfCount * 2] = object.position.x;
      this.wolfPos[this.wolfCount * 2 + 1] = object.position.z;
      this.wolfCount++;
      // On the Spire the free guardians nearest the player take the next attacks; the rest press the beacon.
      if (!this.finaleActive || !rig.guardian || rig.dying) continue;
      const mode = entity.getValue(Creature, 'mode');
      if (mode !== 'press' && mode !== 'stalk' && mode !== 'prowl') continue;
      const d = horizontalDistance(object.position.x, object.position.z, this.viewer.x, this.viewer.z);
      if (d < nextD) {
        next2D = nextD; this.nextAttacker2 = this.nextAttacker;
        nextD = d; this.nextAttacker = object;
      } else if (d < next2D) {
        next2D = d; this.nextAttacker2 = object;
      }
    }
  }

  private insideLitFire(x: number, z: number): boolean {
    for (let i = 0; i < this.litFireCount; i++) {
      if (horizontalDistance(x, z, this.litFires[i * 2], this.litFires[i * 2 + 1]) < DANGER.fireSafeRadius) return true;
    }
    return false;
  }

  /**
   * The strongest torch ward on (x, z): 2 = right at a flame, 1 = in front of a held
   * flame (its cone), 0 = unwarded. The flame lands in nearestX/Z, its distance in threatD.
   */
  private torchThreat(x: number, z: number): number {
    let best = 0;
    this.threatD = Infinity;
    for (let i = 0; i < this.torchCount; i++) {
      const fx = this.torchPos[i * 2], fz = this.torchPos[i * 2 + 1];
      const level = torchWard(x, z, fx, fz, this.torchAxis[i * 2], this.torchAxis[i * 2 + 1],
        DANGER.torchRadius, TORCH_CONE_COS, DANGER.torchCloseRadius);
      if (level === 0) continue;
      const d = horizontalDistance(x, z, fx, fz);
      if (level > best || (level === best && d < this.threatD)) {
        best = level;
        this.threatD = d;
        this.nearestX = fx;
        this.nearestZ = fz;
      }
    }
    return best;
  }

  /** Nearest live wolf distance; its position lands in nearestX/Z. */
  private nearestWolf(x: number, z: number): number {
    let best = Infinity;
    for (let i = 0; i < this.wolfCount; i++) {
      const d = horizontalDistance(x, z, this.wolfPos[i * 2], this.wolfPos[i * 2 + 1]);
      if (d < best) { best = d; this.nearestX = this.wolfPos[i * 2]; this.nearestZ = this.wolfPos[i * 2 + 1]; }
    }
    return best;
  }

  /** Index of the lit fire a prowler circles: the one guarding the player, else the wolf's nearest. */
  private prowlFire(x: number, z: number): number {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.litFireCount; i++) {
      const d = horizontalDistance(this.viewer.x, this.viewer.z, this.litFires[i * 2], this.litFires[i * 2 + 1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && bestD < 30) return best;
    bestD = Infinity;
    for (let i = 0; i < this.litFireCount; i++) {
      const d = horizontalDistance(x, z, this.litFires[i * 2], this.litFires[i * 2 + 1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  private nightWindow(): boolean {
    return this.phase === 'night' || (this.phase === 'dusk' && this.night >= W.duskSpawnNightness);
  }

  // ---- Spawning -----------------------------------------------------------------

  private manageSpawns(): void {
    let preyAlive = this.pendingPrey;
    for (const entity of this.queries.creatures.entities) {
      if (entity.getValue(Creature, 'species') !== 'wolf' && entity.getValue(Creature, 'mode') !== 'dying') preyAlive++;
    }
    if (this.phase !== 'night' && preyAlive < P.maxAlive) this.trySpawnPrey();

    if (this.ended || this.stage < 1) return;
    // The night's pack arrives in waves (DANGER.nightWaves), one wolf per spawn tick.
    if (this.nightWindow() &&
      this.nightSpawned < nightWolvesDue(this.stage, this.sinceNightfall, DANGER.nightWaveAt, DANGER.nightWaves)) {
      this.nightSpawned++;
      this.spawnWolf();
    }
  }

  private aliveAt(anchor: Object3D): number {
    let count = this.pendingAt.get(anchor) ?? 0;
    for (const entity of this.queries.creatures.entities) {
      const rig = entity.object3D ? this.rigs.get(entity.object3D) : undefined;
      if (rig?.anchor === anchor && entity.getValue(Creature, 'mode') !== 'dying') count++;
    }
    return count;
  }

  private trySpawnPrey(): void {
    // Best spot over every herd that wants a member: out of view (or far off) first, then the
    // nearer herd; never under the player's nose.
    let best: Entity | undefined, score = -Infinity, x = 0, z = 0, homeX = 0, homeZ = 0, bestRadius = 4;
    for (const anchor of this.queries.spawns.entities) {
      const species = anchor.getValue(CreatureSpawn, 'species');
      const object = anchor.object3D;
      if ((species !== 'deer' && species !== 'rabbit') || !object) continue;
      if ((this.anchorCooldown.get(object) ?? 0) > this.time) continue;
      object.getWorldPosition(this.scratch);
      const ax = this.scratch.x, az = this.scratch.z;
      const d = horizontalDistance(ax, az, this.viewer.x, this.viewer.z);
      if (d > P.spawnRange) continue;
      if (this.aliveAt(object) >= (anchor.getValue(CreatureSpawn, 'count') ?? 0)) continue;
      const radius = Math.max(.5, anchor.getValue(CreatureSpawn, 'radius') ?? 4);
      for (let i = 0; i < 5; i++) {
        wanderPoint(ax, az, radius, Math.random() * 1000, this.point);
        const pd = horizontalDistance(this.point.x, this.point.z, this.viewer.x, this.viewer.z);
        if (pd < P.minSpawnDistance) continue;
        const candidate = (this.hiddenFromViewer(this.point.x, this.point.z, pd) ? 1000 : 0) - d + pd * .1;
        if (candidate > score) {
          score = candidate; best = anchor; x = this.point.x; z = this.point.z; homeX = ax; homeZ = az; bestRadius = radius;
        }
      }
    }
    if (!best?.object3D) return;
    if (score < 500) {
      // Only in-view spots: wait a while for the player to look away, then scale in regardless.
      this.preyBlocked += P.spawnInterval;
      if (this.preyBlocked < P.inViewAfter) return;
    }
    this.preyBlocked = 0;
    const species = best.getValue(CreatureSpawn, 'species') as Species;
    void this.spawn(species, x, z, homeX, homeZ, best.object3D, bestRadius, false, false, 0);
  }

  private hiddenFromViewer(x: number, z: number, distance: number): boolean {
    return distance > P.hiddenRange ||
      !inView(this.forward.x, this.forward.z, this.viewer.x, this.viewer.z, x, z, P.viewDot);
  }

  private wolfAnchorEligible(anchor: Entity): boolean {
    return anchor.getValue(CreatureSpawn, 'species') === 'wolf' && !!anchor.object3D &&
      (anchor.getValue(CreatureSpawn, 'minStage') ?? 0) <= this.stage;
  }

  private spawnWolf(): void {
    // Round-robin over eligible anchors far enough from the player; else the farthest one.
    let far = 0, farthest: Entity | undefined, farthestD = -1;
    for (const anchor of this.queries.spawns.entities) {
      if (!this.wolfAnchorEligible(anchor)) continue;
      anchor.object3D!.getWorldPosition(this.scratch);
      const d = horizontalDistance(this.scratch.x, this.scratch.z, this.viewer.x, this.viewer.z);
      if (d >= W.spawnDistance) far++;
      if (d > farthestD) { farthestD = d; farthest = anchor; }
    }
    let chosen = farthest;
    if (far > 0) {
      let index = this.wolfCursor++ % far;
      for (const anchor of this.queries.spawns.entities) {
        if (!this.wolfAnchorEligible(anchor)) continue;
        anchor.object3D!.getWorldPosition(this.scratch);
        if (horizontalDistance(this.scratch.x, this.scratch.z, this.viewer.x, this.viewer.z) < W.spawnDistance) continue;
        if (index-- === 0) { chosen = anchor; break; }
      }
    }
    if (chosen?.object3D) {
      chosen.object3D.getWorldPosition(this.scratch);
      const radius = chosen.getValue(CreatureSpawn, 'radius') ?? 3;
      wanderPoint(this.scratch.x, this.scratch.z, radius, Math.random() * 1000, this.point);
      void this.spawn('wolf', this.point.x, this.point.z, this.scratch.x, this.scratch.z, chosen.object3D, radius, true, false, W.minSpawnDistance);
      return;
    }
    // No authored anchors: emerge from the treeline on a wide ring round the camp fire.
    ringPoint(LANDMARKS.campfire.x, LANDMARKS.campfire.z, W.fallbackRing, Math.random() * TAU, this.point);
    clampToBounds(this.point, WORLD_BOUNDS, CREATURE_TUNING.boundsMargin + 2);
    void this.spawn('wolf', this.point.x, this.point.z, this.point.x, this.point.z, null, 3, true, false, W.minSpawnDistance);
  }

  /** A finale wave: `count` guardians rise from ash on a ring round the Spire, well clear of the player. */
  private spawnGuardians(count: number): void {
    const night = this.phase === 'night' || this.phase === 'dusk';
    for (let i = 0; i < count; i++) {
      let x: number = LANDMARKS.spire.x, z: number = LANDMARKS.spire.z, far = -1;
      for (let k = 0; k < 10 && far < W.guardianMinDistance + 1; k++) {
        ringPoint(LANDMARKS.spire.x, LANDMARKS.spire.z, random(W.guardianRing), Math.random() * TAU, this.point);
        clampToBounds(this.point, WORLD_BOUNDS, CREATURE_TUNING.boundsMargin + 1);
        const d = horizontalDistance(this.point.x, this.point.z, this.viewer.x, this.viewer.z);
        if (d > far) { far = d; x = this.point.x; z = this.point.z; }
      }
      void this.spawn('wolf', x, z, x, z, null, 3, night, true, W.guardianMinDistance, pressOffset(this.pressSerial++));
    }
  }

  private async spawn(
    species: Species, x: number, z: number, homeX: number, homeZ: number,
    anchor: Object3D | null, radius: number, night: boolean, guardian: boolean, minDistance: number, press = 0,
  ): Promise<void> {
    const generation = this.generation;
    const epoch = this.guardianEpoch;
    const wolf = species === 'wolf';
    if (wolf) this.pendingWolves++; else this.pendingPrey++;
    if (guardian) this.pendingGuardians++;
    if (anchor) this.pendingAt.set(anchor, (this.pendingAt.get(anchor) ?? 0) + 1);
    try {
      const object = await this.world.assets.instantiate(species);
      if (generation !== this.generation) return;
      if (wolf && (this.ended || (night && !guardian && !this.nightWindow()))) return;
      // The player died while it loaded: the hold it rose for is over.
      if (guardian && epoch !== this.guardianEpoch) return;
      this.point.x = x;
      this.point.z = z;
      if (minDistance > 0) pushOutside(this.point, this.viewer.x, this.viewer.z, minDistance);
      clampToBounds(this.point, WORLD_BOUNDS, CREATURE_TUNING.boundsMargin);
      const y = terrainHeight(this.point.x, this.point.z);
      const heading = wolf ? headingTo(this.point.x, this.point.z, this.viewer.x, this.viewer.z) : Math.random() * TAU;
      const entity = this.world.createTransformEntity(object);
      // Wolves rise from ash below the ground; prey scale in (both finish in animate()).
      object.position.set(this.point.x, y - (wolf ? W.emergeDepth : 0), this.point.z);
      object.quaternion.setFromAxisAngle(UP, heading);
      if (wolf) object.scale.set(.6, .1, .6); else object.scale.setScalar(P.scaleFrom);
      const rig = this.buildRig(object, species);
      rig.anchor = anchor;
      rig.radius = radius;
      rig.night = night;
      rig.guardian = guardian;
      rig.pressOffset = press;
      rig.epoch = epoch;
      this.rigs.set(object, rig);
      entity.addComponent(Creature, {
        species, health: SPECIES[species].health, heading, speed: 0,
        mode: wolf ? 'emerge' : 'graze', timer: wolf ? W.emergeSeconds : random(P.grazeSeconds),
        home: [homeX, terrainHeight(homeX, homeZ), homeZ],
      });
      rig.lastMode = entity.getValue(Creature, 'mode') ?? '';
      rig.lastHealth = SPECIES[species].health;
      this.cue(species, 'spawn', this.point.x, y, this.point.z);
    } catch (error) {
      console.warn(`[Prometheus] ${species} spawn failed`, error);
    } finally {
      if (wolf) this.pendingWolves--; else this.pendingPrey--;
      if (guardian) this.pendingGuardians--;
      // After a reset or level swap the ledger was cleared: never re-add a stale anchor.
      if (anchor && generation === this.generation) {
        const left = (this.pendingAt.get(anchor) ?? 1) - 1;
        if (left > 0) this.pendingAt.set(anchor, left); else this.pendingAt.delete(anchor);
      }
    }
  }

  private buildRig(object: Object3D, species: Species): CreatureRig {
    const body = object.getObjectByName('body') ?? null;
    let embers: MeshBasicMaterial | null = null, eyes: MeshBasicMaterial | null = null;
    // Per-entity glow materials so each wolf pulses (and dissolves) on its own.
    const emberMesh = object.getObjectByName('embers');
    if (emberMesh instanceof Mesh && emberMesh.material instanceof MeshBasicMaterial) {
      embers = emberMesh.material = emberMesh.material.clone();
    }
    const eyeMesh = object.getObjectByName('eyes');
    if (eyeMesh instanceof Mesh && eyeMesh.material instanceof MeshBasicMaterial) {
      eyes = eyeMesh.material = eyeMesh.material.clone();
    }
    return {
      species, wolf: species === 'wolf', body, head: object.getObjectByName('head') ?? null,
      tail: object.getObjectByName('tail') ?? null, legs: LEG_NAMES.map((name) => object.getObjectByName(name) ?? null),
      bodyY: body?.position.y ?? 0, embers, eyes, eyeBase: eyes ? eyes.color.clone() : null,
      anchor: null, radius: 4, night: false, guardian: false, seed: Math.random() * 100, gait: Math.random() * TAU,
      ringRadius: random(W.ringRadius), ringDir: Math.random() < .5 ? -1 : 1, veer: 0,
      howlIn: random(W.firstHowlSeconds), howling: 0, growlIn: 0, lastMode: '', lastHealth: SPECIES[species].health,
      threatX: 0, threatZ: 0, goalX: object.position.x, goalZ: object.position.z, fromX: 0, fromZ: 0, toX: 0, toZ: 0,
      headPitch: 0, headYaw: 0, bodyPitch: 0, crouch: 0, tailLift: 0, rollSide: Math.random() < .5 ? -1 : 1,
      dying: false, shadow: object.getObjectByName('shadow') ?? null, age: 0, stalkCueIn: Math.random() * W.stalkCueSeconds,
      feintAt: 0, snapped: false, pressOffset: 0, epoch: this.guardianEpoch, shadowSlot: Math.floor(Math.random() * 3),
    };
  }

  /** Creatures created elsewhere (scene-authored, debug) get a rig on first sight. */
  private adoptRig(entity: Entity, object: Object3D): CreatureRig {
    const name = entity.getValue(Creature, 'species');
    const species: Species = name === 'wolf' || name === 'rabbit' ? name : 'deer';
    const rig = this.buildRig(object, species);
    const home = entity.getVectorView(Creature, 'home');
    rig.goalX = home[0];
    rig.goalZ = home[2];
    rig.night = species === 'wolf';
    rig.lastMode = entity.getValue(Creature, 'mode') ?? '';
    rig.lastHealth = entity.getValue(Creature, 'health') ?? 1;
    rig.age = P.scaleInSeconds + 1; // already in the world: no scale-in
    this.rigs.set(object, rig);
    return rig;
  }

  private releaseRig(object: Object3D | undefined): void {
    const rig = object ? this.rigs.get(object) : undefined;
    if (!object || !rig) return;
    rig.embers?.dispose();
    rig.eyes?.dispose();
    this.rigs.delete(object);
  }

  /** A creature is gone (or going): it gives up its attack slot, feint, pincer post and turn, and its rig. */
  private forget(object: Object3D | undefined): void {
    if (!object) return;
    this.releaseSlot(object);
    if (this.feinter === object) this.feinter = null;
    if (this.nextAttacker === object) this.nextAttacker = null;
    if (this.nextAttacker2 === object) this.nextAttacker2 = null;
    for (let i = 0; i < 2; i++) if (this.pincerWolves[i] === object) this.pincerWolves[i] = null;
    this.releaseRig(object);
  }

  private remove(entity: Entity, object: Object3D): void {
    this.forget(object);
    entity.dispose({ disposeResources: false });
  }

  /** The pack's bookkeeping back to idle: slots, feint, pincer, finale waves, night tally (new journey, level swap). */
  private resetPack(): void {
    this.nightSpawned = 0;
    this.waveIndex = 0;
    this.holdovers = 0;
    this.pressSerial = 0;
    this.pressWarned = false;
    this.attackers[0] = this.attackers[1] = null;
    this.feinter = null;
    this.nextAttacker = this.nextAttacker2 = null;
    this.lastBite = this.lastAttackEnd = this.respiteUntil = -Infinity;
    this.endPincer(0);
  }

  private clearAll(): void {
    this.generation++;
    for (const entity of Array.from(this.queries.creatures.entities)) {
      if (entity.object3D) this.remove(entity, entity.object3D);
    }
    this.resetPack();
    this.anchorCooldown.clear();
    this.pendingAt.clear();
  }

  private scatterWolves(): void {
    for (const entity of this.queries.creatures.entities) {
      const mode = entity.getValue(Creature, 'mode');
      if (entity.getValue(Creature, 'species') !== 'wolf' || mode === 'dying') continue;
      entity.setValue(Creature, 'mode', 'retreat');
      entity.setValue(Creature, 'timer', W.scatterSeconds);
    }
  }

  private cue(species: string, cue: Extract<GameEvent, { type: 'creature' }>['cue'], x: number, y: number, z: number): void {
    bus.emit({ type: 'creature', species, cue, x, y, z });
  }

  // ---- Per-creature tick ----------------------------------------------------------

  private tick(entity: Entity, dt: number): void {
    const object = entity.object3D;
    if (!object) return;
    const rig = this.rigs.get(object) ?? this.adoptRig(entity, object);
    const spec = SPECIES[rig.species];
    const storedMode = entity.getValue(Creature, 'mode') ?? 'idle';
    let mode = rig.dying ? 'dying' : storedMode;
    const storedTimer = entity.getValue(Creature, 'timer') ?? 0;
    let timer = storedTimer - dt;
    rig.age += dt;
    let heading = entity.getValue(Creature, 'heading') ?? 0;
    let speed = entity.getValue(Creature, 'speed') ?? 0;
    const health = entity.getValue(Creature, 'health') ?? 1;
    const x = object.position.x, z = object.position.z;
    const dPlayer = horizontalDistance(x, z, this.viewer.x, this.viewer.z);

    // External inputs: damage and torch contact from CombatSystem, dawn and the ending.
    if (mode !== 'dying') {
      if (health <= 0) {
        mode = 'dying';
        timer = spec.dyingSeconds;
        this.onDeath(rig, object);
      } else if (rig.wolf && (this.ended || (rig.night && !rig.guardian && (this.phase === 'dawn' || this.phase === 'day')) ||
        (rig.guardian && (this.beaconIdle > W.guardianRecallSeconds || rig.epoch !== this.guardianEpoch)))) {
        mode = 'dying';
        timer = spec.dyingSeconds;
        this.cue('wolf', 'dissolve', x, object.position.y, z);
      } else if (mode === 'scared' && (rig.lastMode !== 'scared' || storedTimer === 0)) {
        timer = rig.wolf ? W.scaredSeconds : P.scaredSeconds;
        rig.threatX = this.viewer.x;
        rig.threatZ = this.viewer.z;
        this.cue(rig.species, 'flee', x, object.position.y, z);
      } else if (health < rig.lastHealth) {
        rig.threatX = this.viewer.x;
        rig.threatZ = this.viewer.z;
        this.cue(rig.species, 'yelp', x, object.position.y, z);
        if (rig.wolf) {
          mode = 'retreat';
          timer = W.hurtRetreatSeconds;
        } else {
          mode = 'flee';
          timer = P.calmSeconds;
          rig.veer = (Math.random() - .5) * .8;
          this.cue(rig.species, 'flee', x, object.position.y, z);
        }
      }
    }

    const intent = this.intent;
    intent.mode = mode;
    intent.timer = timer;
    intent.desired = 0;
    intent.face = NaN;
    intent.direct = false;
    intent.backpedal = false;
    intent.directT = 0;
    this.target.x = x;
    this.target.z = z;

    if (mode === 'dying') {
      if (timer <= 0) {
        this.remove(entity, object);
        return;
      }
    } else if (rig.wolf) {
      this.decideWolf(rig, object, x, z, object.position.y, dPlayer, dt);
    } else {
      if (dPlayer > P.despawnRange && (mode === 'graze' || mode === 'idle' || mode === 'wander') &&
        !inView(this.forward.x, this.forward.z, this.viewer.x, this.viewer.z, x, z, P.viewDot)) {
        this.remove(entity, object);
        return;
      }
      this.decidePrey(entity, rig, spec, x, z, object.position.y, dPlayer);
    }
    mode = intent.mode;
    timer = intent.timer;
    if (mode === 'dying') rig.dying = true;
    if (mode !== 'telegraph' && mode !== 'lunge') this.releaseSlot(object);
    if (mode !== 'feint' && this.feinter === object) this.feinter = null;

    // Steering: smoothed heading toward the target, speed eased toward the desired speed.
    const p = this.point;
    if (intent.direct) {
      const t = clamp01(intent.directT);
      const eased = 1 - (1 - t) * (1 - t);
      p.x = rig.fromX + (rig.toX - rig.fromX) * eased;
      p.z = rig.fromZ + (rig.toZ - rig.fromZ) * eased;
      heading = turnToward(heading, headingTo(rig.fromX, rig.fromZ, rig.toX, rig.toZ), spec.turn * 3 * dt);
      speed = t < 1 ? horizontalDistance(rig.fromX, rig.fromZ, rig.toX, rig.toZ) / intent.directSeconds : 0;
    } else if (mode === 'dying' || mode === 'emerge') {
      speed = approach(speed, 0, spec.accel * 2 * dt);
      if (mode === 'emerge') heading = turnToward(heading, headingTo(x, z, this.viewer.x, this.viewer.z), spec.turn * dt);
      p.x = x + Math.sin(heading) * speed * dt;
      p.z = z + Math.cos(heading) * speed * dt;
    } else {
      const toTarget = horizontalDistance(x, z, this.target.x, this.target.z);
      let desired = intent.desired;
      if (desired > 0 && toTarget < .2) desired = 0;
      let travel = heading;
      if (intent.backpedal) {
        travel = headingTo(x, z, this.target.x, this.target.z);
        if (!Number.isNaN(intent.face)) heading = turnToward(heading, intent.face, spec.turn * dt);
      } else {
        if (desired > 0) {
          const want = headingTo(x, z, this.target.x, this.target.z);
          heading = turnToward(heading, want, spec.turn * dt);
          // Slow down while turning hard, so creatures pivot instead of orbiting.
          desired *= Math.max(.25, .35 + .65 * Math.cos(wrapAngle(want - heading)));
        } else if (!Number.isNaN(intent.face)) {
          heading = turnToward(heading, intent.face, spec.turn * 1.5 * dt);
        }
        travel = heading;
      }
      speed = approach(speed, desired, spec.accel * dt);
      p.x = x + Math.sin(travel) * speed * dt;
      p.z = z + Math.cos(travel) * speed * dt;
    }
    if (rig.wolf && mode !== 'dying' && !intent.direct) this.separate(p, x, z);
    // A committed lunge is bounded by the fire only; everything else also keeps out of the flames.
    if (mode !== 'dying') this.constrain(rig, p, x, z, dt, mode !== 'lunge');

    let progress = 0, sink = 0;
    if (mode === 'dying') {
      progress = clamp01(1 - timer / spec.dyingSeconds);
      sink = rig.wolf ? .18 * progress : .5 * clamp01((progress - .55) / .45);
    } else if (mode === 'emerge') {
      progress = clamp01(1 - timer / W.emergeSeconds);
      sink = W.emergeDepth * (1 - progress * progress * (3 - 2 * progress));
    }
    const ground = terrainHeight(p.x, p.z);
    object.position.set(p.x, ground - sink, p.z);
    object.quaternion.setFromAxisAngle(UP, heading);
    this.animate(rig, object, spec, mode, speed, progress, dt);
    this.groundShadow(rig, mode, progress, sink, p.x, p.z, heading, speed < .05 && !intent.direct);

    if (mode !== storedMode) entity.setValue(Creature, 'mode', mode);
    entity.setValue(Creature, 'timer', timer);
    entity.setValue(Creature, 'heading', heading);
    entity.setValue(Creature, 'speed', speed);
    rig.lastMode = mode;
    rig.lastHealth = health;
  }

  /** Attack slots: on the Spire per guardian wave (FINALE.attackSlots), else 1 (or 2 from the flank stage). */
  private slotCount(): number {
    return this.finaleActive ? finaleSlots(this.waveIndex) : attackSlots(this.stage, W.flankFromStage);
  }

  /**
   * The pack may start a new attack: a slot is free and the gap since the last attack (and
   * the bite) has passed. A pincer ignores the pack's gap (it is part of the same attack).
   */
  private slotOpen(pincer = false): boolean {
    const gap = pincer ? 0 : this.finaleActive ? finaleGap(this.waveIndex) : DANGER.attackGap;
    if (!attackReady(this.time, this.lastAttackEnd, this.lastBite, gap, W.crouchAfterBite)) return false;
    const slots = this.slotCount();
    for (let i = 0; i < slots; i++) if (this.attackers[i] === null) return true;
    return false;
  }

  /** Claim an attack slot (see slotCount), only once the pack's attack gap has passed (see slotOpen). */
  private takeSlot(object: Object3D, pincer = false): boolean {
    const slots = this.slotCount();
    for (let i = 0; i < this.attackers.length; i++) if (this.attackers[i] === object) return true;
    if (!this.slotOpen(pincer)) return false;
    for (let i = 0; i < slots; i++) {
      if (this.attackers[i] === null) {
        this.attackers[i] = object;
        return true;
      }
    }
    return false;
  }

  /** Free a wolf's attack slot; an attack that ends (bite, miss or abort) starts the pack's gap. */
  private releaseSlot(object: Object3D): void {
    for (let i = 0; i < this.attackers.length; i++) {
      if (this.attackers[i] !== object) continue;
      this.attackers[i] = null;
      this.lastAttackEnd = this.time;
    }
  }

  /** Nudge a wolf out of its packmates' space (positions from the start of the frame). */
  private separate(p: XZ, fromX: number, fromZ: number): void {
    for (let i = 0; i < this.wolfCount; i++) {
      const wx = this.wolfPos[i * 2], wz = this.wolfPos[i * 2 + 1];
      if (Math.abs(wx - fromX) < 1e-4 && Math.abs(wz - fromZ) < 1e-4) continue; // itself
      const dx = p.x - wx, dz = p.z - wz, d = Math.hypot(dx, dz);
      if (d < 1e-4 || d >= W.separation) continue;
      const k = (W.separation - d) / d * .5;
      p.x += dx * k;
      p.z += dz * k;
    }
  }

  /**
   * Keep the contact shadow on the ground under the (possibly sunk) body, tilted to the slope.
   * The tilt costs four terrain samples: a creature standing still re-tilts every third frame.
   */
  private groundShadow(
    rig: CreatureRig, mode: string, progress: number, sink: number, x: number, z: number, heading: number, standing: boolean,
  ): void {
    const shadow = rig.shadow;
    if (!shadow) return;
    if (!standing || (this.frame + rig.shadowSlot) % 3 === 0) {
      const fx = Math.sin(heading) * .5, fz = Math.cos(heading) * .5;
      const slopeForward = terrainHeight(x + fx, z + fz) - terrainHeight(x - fx, z - fz);
      const slopeSide = terrainHeight(x + fz, z - fx) - terrainHeight(x - fz, z + fx);
      shadow.rotation.set(-Math.atan(slopeForward), 0, Math.atan(slopeSide));
    }
    shadow.position.y = sink;
    const size = mode === 'dying' ? 1 - progress : mode === 'emerge' ? progress : 1;
    shadow.scale.setScalar(Math.max(.01, size));
  }

  /**
   * Stay in bounds; keep clear of campfire rings; wolves also of lit-fire discs and (unless
   * lunging: a lunge is bounded by the fire only) of the flames themselves. These win at the edge.
   */
  private constrain(rig: CreatureRig, p: XZ, fromX: number, fromZ: number, dt: number, flames = true): void {
    clampToBounds(p, WORLD_BOUNDS, CREATURE_TUNING.boundsMargin);
    for (let i = 0; i < this.allFireCount; i++) {
      this.push(p, this.allFires[i * 2], this.allFires[i * 2 + 1], CREATURE_TUNING.campfireAvoidRadius, fromX, fromZ, dt);
    }
    if (rig.wolf) {
      for (let i = 0; flames && i < this.torchCount; i++) {
        this.push(p, this.torchPos[i * 2], this.torchPos[i * 2 + 1], DANGER.torchPushRadius, fromX, fromZ, dt);
      }
      for (let i = 0; i < this.litFireCount; i++) {
        this.push(p, this.litFires[i * 2], this.litFires[i * 2 + 1], DANGER.fireSafeRadius, fromX, fromZ, dt);
      }
    }
  }

  /** Push out of a disc, but never shove faster than `pushSpeed` (no pops when a fire lights). */
  private push(p: XZ, cx: number, cz: number, radius: number, fromX: number, fromZ: number, dt: number): void {
    const x = p.x, z = p.z;
    if (horizontalDistance(x, z, cx, cz) >= radius) return;
    // Radial push-out, then limit the displacement from this frame's start.
    const d = this.pushed;
    const dx = x - cx, dz = z - cz, len = Math.hypot(dx, dz);
    d.x = len < 1e-6 ? cx : cx + dx / len * radius;
    d.z = len < 1e-6 ? cz + radius : cz + dz / len * radius;
    // Only a creature that started the frame inside (a fire just lit, a torch thrust at it)
    // is eased out; anything stepping in is simply held at the edge.
    const startedInside = horizontalDistance(fromX, fromZ, cx, cz) < radius - 1e-3;
    const mx = d.x - fromX, mz = d.z - fromZ, move = Math.hypot(mx, mz);
    const limit = CREATURE_TUNING.pushSpeed * dt + horizontalDistance(x, z, fromX, fromZ);
    if (startedInside && move > limit && move > 1e-6) {
      d.x = fromX + mx / move * limit;
      d.z = fromZ + mz / move * limit;
    }
    p.x = d.x;
    p.z = d.z;
  }

  // ---- Prey ---------------------------------------------------------------------

  private decidePrey(entity: Entity, rig: CreatureRig, spec: SpeciesTuning, x: number, z: number, y: number, dPlayer: number): void {
    const intent = this.intent;
    const scaredOfPlayer = shouldFlee(dPlayer, this.playerSpeed, FLEE[rig.species]);
    const wolfD = this.nearestWolf(x, z);
    const scaredOfWolf = wolfD < P.wolfFleeRadius;
    if (scaredOfPlayer || scaredOfWolf) {
      if (intent.mode !== 'flee' && intent.mode !== 'scared') {
        intent.mode = 'flee';
        rig.veer = (Math.random() - .5) * .8;
        this.cue(rig.species, 'flee', x, y, z);
      }
      if (intent.mode === 'flee') intent.timer = P.calmSeconds;
      if (scaredOfWolf && (!scaredOfPlayer || wolfD < dPlayer)) {
        rig.threatX = this.nearestX;
        rig.threatZ = this.nearestZ;
      } else {
        rig.threatX = this.viewer.x;
        rig.threatZ = this.viewer.z;
      }
    }
    switch (intent.mode) {
      case 'flee':
      case 'scared':
        fleePoint(x, z, rig.threatX, rig.threatZ, P.fleeDistance, rig.veer, this.target);
        clampToBounds(this.target, WORLD_BOUNDS, CREATURE_TUNING.boundsMargin + 1);
        intent.desired = spec.run;
        if (intent.timer <= 0) {
          intent.mode = 'idle';
          intent.timer = random(P.idleSeconds);
        }
        break;
      case 'graze':
        if (intent.timer <= 0) {
          intent.mode = 'idle';
          intent.timer = random(P.idleSeconds);
        }
        break;
      case 'idle':
        if (intent.timer <= 0) {
          const home = entity.getVectorView(Creature, 'home');
          if (horizontalDistance(x, z, home[0], home[2]) > rig.radius * P.leash) {
            this.point.x = home[0];
            this.point.z = home[2];
          } else {
            wanderPoint(home[0], home[2], rig.radius, Math.random() * 1000, this.point);
          }
          rig.goalX = this.point.x;
          rig.goalZ = this.point.z;
          intent.mode = 'wander';
          intent.timer = P.wanderSeconds;
        }
        break;
      case 'wander':
        this.target.x = rig.goalX;
        this.target.z = rig.goalZ;
        intent.desired = spec.walk;
        if (horizontalDistance(x, z, rig.goalX, rig.goalZ) < .35 || intent.timer <= 0) {
          intent.mode = 'graze';
          intent.timer = random(P.grazeSeconds);
        }
        break;
      default:
        intent.mode = 'graze';
        intent.timer = random(P.grazeSeconds);
    }
    for (let i = 0; i < this.allFireCount; i++) {
      detour(x, z, this.target, this.allFires[i * 2], this.allFires[i * 2 + 1], CREATURE_TUNING.campfireAvoidRadius + .3, .6, this.detoured);
      this.target.x = this.detoured.x;
      this.target.z = this.detoured.z;
    }
  }

  private onDeath(rig: CreatureRig, object: Object3D): void {
    const { x, y, z } = object.position;
    if (rig.wolf) this.cue('wolf', 'dissolve', x, y, z);
    else if (rig.anchor) this.anchorCooldown.set(rig.anchor, this.time + P.respawnCooldown);
    // Deer and rabbits drop meat; a slain wolf leaves an ash-flint shard.
    const { drop, drops } = SPECIES[rig.species];
    for (let i = 0; i < drops; i++) {
      const side = drops > 1 ? (i - (drops - 1) / 2) * .3 : 0;
      bus.emit({
        type: 'spawn-item', kind: drop, x: x + side, y: y + .35, z,
        vx: side * 1.5 + (Math.random() - .5) * .4, vy: 1.4, vz: (Math.random() - .5) * .6,
      });
    }
  }

  // ---- Wolves -------------------------------------------------------------------

  private decideWolf(rig: CreatureRig, object: Object3D, x: number, z: number, y: number, dPlayer: number, dt: number): void {
    const intent = this.intent;
    const px = this.viewer.x, pz = this.viewer.z;
    const threat = this.torchThreat(x, z);
    const flameX = this.nearestX, flameZ = this.nearestZ, flameD = this.threatD;
    // Off limits: inside the firelight, just back from death, or (for night wolves) on the Spire hold.
    const safe = this.playerSafe || this.time < this.respiteUntil || (this.finaleActive && !rig.guardian);
    rig.growlIn -= dt;
    rig.stalkCueIn -= dt;

    switch (intent.mode) {
      case 'emerge':
        // Rising from ash: stand, face the player, then hunt.
        intent.face = headingTo(x, z, px, pz);
        if (intent.timer <= 0) {
          intent.mode = 'prowl';
          intent.timer = 0;
        }
        break;
      case 'scared':
        if (threat > 0 && flameD < dPlayer) { rig.threatX = flameX; rig.threatZ = flameZ; } else { rig.threatX = px; rig.threatZ = pz; }
        fleePoint(x, z, rig.threatX, rig.threatZ, 6, rig.veer, this.target);
        intent.desired = W.scaredSpeed;
        rig.feintAt = this.time + W.feintEvery[1];
        if (intent.timer <= 0) {
          intent.mode = 'retreat';
          intent.timer = 1.5;
        }
        break;
      case 'retreat':
        fleePoint(x, z, px, pz, 6, rig.veer, this.target);
        intent.desired = W.retreatSpeed;
        if (intent.timer <= 0) intent.mode = 'prowl';
        break;
      case 'feint': {
        // Dart in at the flame to poke range, snap, hop back out: the moment to thrust the torch.
        intent.face = headingTo(x, z, px, pz);
        const beat = feintPhase(W.feintSeconds - intent.timer, W.feintIn, W.feintSnap);
        if (safe) {
          intent.mode = 'retreat';
          intent.timer = 1.5;
          break;
        }
        if (beat === 'in') {
          // A dash, not a walk: straight at poke range in feintIn seconds.
          intent.direct = true;
          intent.directT = (W.feintSeconds - intent.timer) / W.feintIn;
          intent.directSeconds = W.feintIn;
        } else if (beat === 'snap') {
          intent.desired = 0;
          if (!rig.snapped) {
            rig.snapped = true;
            rig.growlIn = W.growlGap;
            this.cue('wolf', 'growl', x, y, z);
          }
        } else {
          fleePoint(x, z, px, pz, 2, 0, this.target);
          intent.desired = W.feintBackSpeed;
          intent.backpedal = true;
        }
        if (intent.timer <= 0) {
          intent.mode = 'stalk';
          intent.timer = 0;
          rig.feintAt = this.time + random(W.feintEvery);
        }
        break;
      }
      case 'telegraph':
        intent.face = headingTo(x, z, px, pz);
        if (safe || threat > 0) {
          // Faced with the flame (or the player reached the fire): abandon the attack.
          intent.mode = 'retreat';
          intent.timer = 1.5;
          rig.veer = (Math.random() - .5) * 1.2;
        } else if (dPlayer > W.abandonRange) {
          intent.mode = 'stalk';
        } else if (intent.timer <= 0) {
          lungeEnd(x, z, px, pz, W.lungeStop, this.point);
          // A lunge is bounded by the fire's light only: a torch does not stop a committed wolf.
          this.constrain(rig, this.point, x, z, 1, false);
          rig.fromX = x; rig.fromZ = z;
          rig.toX = this.point.x; rig.toZ = this.point.z;
          intent.mode = 'lunge';
          intent.timer = W.lungeSeconds;
          intent.direct = true;
          intent.directT = 0;
          intent.directSeconds = W.lungeSeconds;
        }
        break;
      case 'lunge':
        intent.direct = true;
        intent.directT = 1 - intent.timer / W.lungeSeconds;
        intent.directSeconds = W.lungeSeconds;
        if (intent.timer <= 0) {
          intent.direct = false;
          // One bite per DANGER.biteCooldown on the player, however many wolves lunge.
          if (!this.playerSafe && this.time - this.lastBite >= DANGER.biteCooldown &&
            biteLands(rig.toX, rig.toZ, px, pz, W.biteReach)) {
            this.lastBite = this.time;
            bus.emit({ type: 'hurt', amount: DANGER.biteDamage, cause: 'wolf', x: rig.toX, z: rig.toZ });
            this.cue('wolf', 'bite', rig.toX, y, rig.toZ);
          }
          intent.mode = 'retreat';
          intent.timer = W.retreatSeconds;
          rig.veer = (Math.random() - .5) * 1.2;
        }
        break;
      default: {
        if (threat > 0) {
          // In front of a flame: feint at it (poke range) or back away from it, snarling.
          if (!safe && dPlayer < W.feintRange && this.startFeint(rig, object, x, z, y)) break;
          if (intent.mode === 'press') intent.mode = 'stalk';
          fleePoint(x, z, flameX, flameZ, 2.5, 0, this.target);
          intent.desired = W.backoffSpeed;
          intent.backpedal = true;
          intent.face = headingTo(x, z, flameX, flameZ);
          rig.howling = 0;
          if (rig.growlIn <= 0) {
            rig.growlIn = W.growlGap;
            this.cue('wolf', 'growl', x, y, z);
          }
          break;
        }
        // On the Spire: the guardian whose turn it is attacks; the others press the beacon.
        if (rig.guardian && this.finaleActive && !safe && this.pressBeacon(rig, object, x, z, dPlayer)) break;
        // A pincer: take the post, then run in and crouch with the partner.
        if (!safe && this.pincerTurn(rig, object, x, y, z, dPlayer)) break;
        const want = wolfIntent(safe, dPlayer, W.stalkRange, W.attackRange);
        if (want !== 'prowl' && this.playerTorch) {
          // A torch-bearer's front is warded: feint at it, or circle to the unguarded side first.
          const rel = bearingFromAxis(px, pz, this.playerTorchAx, this.playerTorchAz, x, z);
          if (Math.abs(rel) < W.flankAngle) {
            if (Math.abs(rel) < TORCH_CONE && dPlayer < W.feintRange && this.startFeint(rig, object, x, z, y)) break;
            intent.mode = 'stalk';
            const radius = Math.min(W.circleRadius[1], Math.max(W.circleRadius[0], dPlayer));
            ringPoint(px, pz, radius, Math.atan2(x - px, z - pz) + (rel >= 0 ? 1 : -1) * W.circleLead, this.target);
            intent.desired = dPlayer > W.creepRange ? W.stalkSpeed : W.circleSpeed;
            this.stalkCue(rig, dPlayer, x, y, z);
            break;
          }
        }
        if (want === 'attack' && this.takeSlot(object)) {
          this.telegraph(rig, x, y, z, W.telegraphSeconds);
          break;
        }
        if (want === 'attack' || (want === 'stalk' && dPlayer < W.holdRadius + .6 && !this.slotOpen())) {
          // The pack's attack is taken (or on its gap): circle the player just out of reach.
          intent.mode = 'stalk';
          ringTarget(x, z, px, pz, W.holdRadius, W.ringLead, rig.ringDir, this.target);
          intent.desired = W.creepSpeed;
          this.stalkCue(rig, dPlayer, x, y, z);
          break;
        }
        if (want === 'stalk') {
          intent.mode = 'stalk';
          this.target.x = px;
          this.target.z = pz;
          intent.desired = dPlayer < W.creepRange ? W.creepSpeed : W.stalkSpeed;
          rig.howling = 0;
          this.stalkCue(rig, dPlayer, x, y, z);
        } else {
          intent.mode = 'prowl';
          const fire = this.prowlFire(x, z);
          const respite = this.time < this.respiteUntil;
          if (fire >= 0) {
            const fx = this.litFires[fire * 2], fz = this.litFires[fire * 2 + 1];
            const ring = rig.ringRadius + (respite ? W.respiteRing : 0);
            ringTarget(x, z, fx, fz, ring, W.ringLead, rig.ringDir, this.target);
            intent.desired = horizontalDistance(x, z, fx, fz) > ring + 4 ? W.approachSpeed : W.prowlSpeed;
            // A prowler at the ring edge watches the player between steps.
            if (dPlayer < 14 && Math.sin(this.time * .35 + rig.seed) > .6) {
              intent.desired = 0;
              intent.face = headingTo(x, z, px, pz);
            }
          } else if (safe) {
            // No fire to circle, but the player is off limits: keep a wide ring round them.
            ringTarget(x, z, px, pz, W.keepOffRadius, W.ringLead, rig.ringDir, this.target);
            intent.desired = W.prowlSpeed;
          } else {
            this.target.x = px;
            this.target.z = pz;
            intent.desired = W.approachSpeed;
          }
          rig.howlIn -= dt;
          if (rig.howling > 0) {
            rig.howling -= dt;
            intent.desired = 0;
          } else if (rig.howlIn <= 0 && this.howlGap <= 0 && dPlayer > 6) {
            rig.howling = W.howlPose;
            rig.howlIn = random(W.howlSeconds);
            this.howlGap = W.howlGap;
            this.cue('wolf', 'howl', x, y, z);
          }
        }
      }
    }
    // Route around lit-fire discs rather than grinding along their edge.
    if (!intent.direct) {
      for (let i = 0; i < this.litFireCount; i++) {
        detour(x, z, this.target, this.litFires[i * 2], this.litFires[i * 2 + 1], DANGER.fireSafeRadius + W.fireMargin, .6, this.detoured);
        this.target.x = this.detoured.x;
        this.target.z = this.detoured.z;
      }
    }
  }

  /** Start the warning crouch (the intent's mode becomes 'telegraph' for `seconds`). */
  private telegraph(rig: CreatureRig, x: number, y: number, z: number, seconds: number): void {
    const intent = this.intent;
    intent.mode = 'telegraph';
    intent.timer = seconds;
    intent.face = headingTo(x, z, this.viewer.x, this.viewer.z);
    rig.howling = 0;
    rig.growlIn = W.growlGap;
    this.cue('wolf', 'growl', x, y, z);
  }

  /**
   * A finale guardian that is not taking its turn to attack goes to the brazier and presses
   * it: runs to its spot on the far side (pressSpot), then crouches there facing the flame
   * and counts toward `pressing`. Returns false when it is this guardian's turn to attack
   * (the nearest free one, or two when the wave attacks in pairs, once a slot is open) so
   * the normal attack runs.
   */
  private pressBeacon(rig: CreatureRig, object: Object3D, x: number, z: number, dPlayer: number): boolean {
    const turn = object === this.nextAttacker || dPlayer <= W.attackRange ||
      (object === this.nextAttacker2 && this.slotCount() > 1);
    if (turn && this.slotOpen()) return false;
    const intent = this.intent;
    const b = LANDMARKS.beacon;
    pressSpot(b.x, b.z, this.viewer.x, this.viewer.z, FINALE.pressRing, rig.pressOffset * FINALE.pressSpread, this.target);
    const toSpot = horizontalDistance(x, z, this.target.x, this.target.z);
    rig.howling = 0;
    if (horizontalDistance(x, z, b.x, b.z) < FINALE.pressRadius) {
      intent.mode = 'press';
      this.pressTally++;
      if (toSpot > W.pressSettle) intent.desired = W.creepSpeed;
      else intent.face = headingTo(x, z, b.x, b.z);
    } else {
      intent.mode = 'stalk';
      intent.desired = toSpot > W.creepRange ? W.approachSpeed : W.stalkSpeed;
    }
    // Round the player, never through them, on the way to the far side.
    if (toSpot > W.pressSettle) {
      detour(x, z, this.target, this.viewer.x, this.viewer.z, W.pressClearance, .6, this.detoured);
      this.target.x = this.detoured.x;
      this.target.z = this.detoured.z;
    }
    return true;
  }

  /**
   * Stage and run the pack's pincer (see W.pincer*): pick two free wolves near an exposed
   * player, send them to opposite posts, then strike together. Called once per update.
   */
  private managePincer(): void {
    const px = this.viewer.x, pz = this.viewer.z;
    const active = this.pincerWolves[0] !== null || this.pincerWolves[1] !== null;
    if (this.stage < W.flankFromStage || this.finaleActive || this.ended || this.playerSafe || this.time < this.respiteUntil) {
      if (active) this.endPincer(this.time + W.pincerEvery[0]);
      return;
    }
    if (!active) {
      if (this.time < this.pincerAt) return;
      let a: Object3D | null = null, b: Object3D | null = null, da: number = W.pincerRange, db: number = W.pincerRange;
      for (const entity of this.queries.creatures.entities) {
        const object = entity.object3D;
        const rig = object ? this.rigs.get(object) : undefined;
        if (!object || !rig?.wolf || rig.dying || rig.guardian || !this.pincerFree(entity.getValue(Creature, 'mode'))) continue;
        const d = horizontalDistance(object.position.x, object.position.z, px, pz);
        if (d < da) { b = a; db = da; a = object; da = d; } else if (d < db) { b = object; db = d; }
      }
      if (!a || !b) {
        this.pincerAt = this.time + 1;
        return;
      }
      // The nearer keeps its side of the torch; the other goes round to the opposite one.
      const side = wrapAngle(Math.atan2(a.position.x - px, a.position.z - pz) - this.facing()) >= 0 ? 1 : -1;
      this.pincerWolves[0] = a;
      this.pincerWolves[1] = b;
      this.pincerSides[0] = side;
      this.pincerSides[1] = -side;
      this.pincerUntil = this.time + W.pincerGather;
      this.pincerStriking = false;
      this.stats.pincerOrders++;
      return;
    }
    // A wolf that was scared off, hurt or killed drops out; while gathering, that ends it.
    for (let i = 0; i < 2; i++) {
      const object = this.pincerWolves[i];
      if (!object) continue;
      const rig = this.rigs.get(object);
      const mode = rig && !rig.dying ? rig.lastMode : 'dying';
      if (!this.pincerFree(mode) && !(this.pincerStriking && (mode === 'telegraph' || mode === 'lunge'))) this.pincerWolves[i] = null;
    }
    const a = this.pincerWolves[0], b = this.pincerWolves[1];
    if (!this.pincerStriking) {
      if (!a || !b) {
        this.endPincer(this.time + random(W.pincerEvery) * .5);
        return;
      }
      const ea = this.fromPost(a, 0), eb = this.fromPost(b, 1);
      const ready = ea < W.pincerPostTolerance && eb < W.pincerPostTolerance;
      const late = this.time > this.pincerUntil && ea < W.pincerRange / 2 && eb < W.pincerRange / 2;
      if (ready || late) {
        this.pincerStriking = true;
        this.pincerUntil = this.time + W.pincerStrike;
        this.pincerCrouched = 0;
        this.pincerNextAt = 0;
      } else if (this.time > this.pincerUntil + W.pincerGather) {
        this.endPincer(this.time + random(W.pincerEvery) * .5);
      }
      return;
    }
    if ((!a && !b) || this.time > this.pincerUntil) this.endPincer(this.time + random(W.pincerEvery));
  }

  /** Bearing (0 = +Z) the player's torch points, else where they look. */
  private facing(): number {
    return this.playerTorch ? Math.atan2(this.playerTorchAx, this.playerTorchAz) : Math.atan2(this.forward.x, this.forward.z);
  }

  /** Pincer post `i`: pincerRing from the player, pincerPostAngle round from their facing on its side. */
  private pincerPost(i: number, out: XZ): XZ {
    return ringPoint(this.viewer.x, this.viewer.z, W.pincerRing, this.facing() + this.pincerSides[i] * W.pincerPostAngle, out);
  }

  private endPincer(nextAt: number): void {
    this.pincerWolves[0] = this.pincerWolves[1] = null;
    this.pincerStriking = false;
    this.pincerCrouched = 0;
    this.pincerNextAt = 0;
    this.pincerAt = nextAt;
  }

  /** Modes in which a wolf may take part in a pincer. */
  private pincerFree(mode: string | null | undefined): boolean {
    return mode === 'stalk' || mode === 'prowl';
  }

  /** How far a pincer wolf stands from its post. */
  private fromPost(object: Object3D, i: number): number {
    this.pincerPost(i, this.point);
    return horizontalDistance(object.position.x, object.position.z, this.point.x, this.point.z);
  }

  /**
   * This wolf's part in the pincer, if it has one: go to its post (round the player, never
   * through), wait there facing them, then on the strike run in and crouch: the first there
   * for W.pincerTelegraph, its partner DANGER.pincerStagger later (holding just out of reach
   * till then) for W.pincerTelegraph2, each with its own growl.
   */
  private pincerTurn(rig: CreatureRig, object: Object3D, x: number, y: number, z: number, dPlayer: number): boolean {
    const role = this.pincerWolves[0] === object ? 0 : this.pincerWolves[1] === object ? 1 : -1;
    if (role < 0) return false;
    const intent = this.intent;
    const px = this.viewer.x, pz = this.viewer.z;
    intent.mode = 'stalk';
    rig.howling = 0;
    if (this.pincerStriking) {
      if (dPlayer <= W.attackRange) {
        if (this.time >= this.pincerNextAt && this.takeSlot(object, true)) {
          this.telegraph(rig, x, y, z, this.pincerCrouched === 0 ? W.pincerTelegraph : W.pincerTelegraph2);
          this.pincerWolves[role] = null;
          this.pincerCrouched++;
          this.pincerNextAt = this.time + DANGER.pincerStagger;
          this.stats.pincerCrouches++;
          return true;
        }
        // In reach, waiting its turn: stand facing the player.
        intent.face = headingTo(x, z, px, pz);
        return true;
      }
      this.target.x = px;
      this.target.z = pz;
      intent.desired = W.pincerSpeed;
      return true;
    }
    this.pincerPost(role, this.target);
    const toPost = horizontalDistance(x, z, this.target.x, this.target.z);
    if (toPost > W.pincerPostTolerance * .5) {
      detour(x, z, this.target, px, pz, W.pincerClearance, .6, this.detoured);
      this.target.x = this.detoured.x;
      this.target.z = this.detoured.z;
      intent.desired = W.pincerSpeed;
    } else {
      intent.face = headingTo(x, z, px, pz);
    }
    this.stalkCue(rig, dPlayer, x, y, z);
    return true;
  }

  /** Begin a feint at the player's torch, if this wolf's turn has come (one feinter at a time). */
  private startFeint(rig: CreatureRig, object: Object3D, x: number, z: number, y: number): boolean {
    if (this.time < rig.feintAt || (this.feinter !== null && this.feinter !== object)) return false;
    const intent = this.intent;
    this.feinter = object;
    intent.mode = 'feint';
    intent.timer = W.feintSeconds;
    intent.face = headingTo(x, z, this.viewer.x, this.viewer.z);
    // Dash from here to feintReach short of the player, along the line between them.
    ringPoint(this.viewer.x, this.viewer.z, W.feintReach, headingTo(this.viewer.x, this.viewer.z, x, z), this.point);
    rig.fromX = x; rig.fromZ = z;
    rig.toX = this.point.x; rig.toZ = this.point.z;
    intent.direct = true;
    intent.directT = 0;
    intent.directSeconds = W.feintIn;
    rig.snapped = false;
    rig.howling = 0;
    void y;
    return true;
  }

  private stalkCue(rig: CreatureRig, dPlayer: number, x: number, y: number, z: number): void {
    if (dPlayer < W.stalkCueRange && rig.stalkCueIn <= 0) {
      rig.stalkCueIn = W.stalkCueSeconds;
      this.cue('wolf', 'stalk', x, y, z);
    }
  }

  // ---- Animation ----------------------------------------------------------------

  private animate(rig: CreatureRig, object: Object3D, spec: SpeciesTuning, mode: string, speed: number, progress: number, dt: number): void {
    const time = this.time;
    const k = smoothing(dt, .16);
    const moving = clamp01(speed / (spec.walk * .6));
    const running = clamp01((speed - spec.walk) / (spec.run - spec.walk));
    rig.gait += dt * speed * TAU / (spec.stride + spec.strideGain * speed);
    const swing = (spec.legSwing + (spec.runSwing - spec.legSwing) * running) * moving;

    let headPitch = .08 + Math.sin(rig.gait * 2) * .04 * moving;
    let headYaw = 0, bodyPitch = 0, crouch = 0, tailLift = 0;
    let tailWag = Math.sin(time * 2.2 + rig.seed) * .08;
    switch (mode) {
      case 'graze':
        headPitch = spec.graze + Math.sin(time * 5 + rig.seed) * .05;
        bodyPitch = rig.species === 'deer' ? .1 : 0;
        break;
      case 'idle':
        headPitch = -.12;
        headYaw = Math.sin(time * .6 + rig.seed) * .4;
        break;
      case 'flee':
      case 'scared':
        headPitch = rig.wolf ? .1 : -.25;
        tailLift = rig.wolf ? -.5 : 1.1;
        break;
      case 'prowl':
        headPitch = rig.howling > 0 ? -.95 : .28;
        tailLift = .1;
        tailWag = Math.sin(time * 1.4 + rig.seed) * .14;
        break;
      case 'stalk':
        headPitch = .42;
        crouch = speed < W.creepSpeed + .2 ? .35 : .1;
        tailLift = -.15;
        tailWag = 0;
        break;
      case 'telegraph':
        headPitch = .45;
        headYaw = Math.sin(time * 31) * .05;
        crouch = 1;
        tailLift = .45;
        tailWag = 0;
        break;
      case 'lunge':
        headPitch = -.2;
        tailLift = .5;
        break;
      case 'feint':
        headPitch = .3;
        headYaw = Math.sin(time * 23) * .06;
        crouch = .55;
        tailLift = .4;
        tailWag = 0;
        break;
      case 'retreat':
        headPitch = .22;
        tailLift = -.35;
        break;
      case 'press':
        // Crouched at the brazier, head low and thrust at the flame.
        headPitch = .5 + Math.sin(time * 3.3 + rig.seed) * .04;
        headYaw = Math.sin(time * 1.7 + rig.seed) * .12;
        crouch = .6;
        tailLift = -.2;
        tailWag = 0;
        break;
      case 'dying':
        headPitch = rig.wolf ? .5 : .3;
        crouch = rig.wolf ? 1 : 0;
        tailWag = 0;
        break;
      case 'emerge':
        headPitch = .35 - .3 * progress;
        crouch = 1 - progress;
        tailLift = -.3;
        tailWag = 0;
        break;
    }
    rig.headPitch += (headPitch - rig.headPitch) * k;
    rig.headYaw += (headYaw - rig.headYaw) * k;
    rig.bodyPitch += (bodyPitch - rig.bodyPitch) * k;
    rig.crouch += (crouch - rig.crouch) * smoothing(dt, mode === 'telegraph' ? .1 : .16);
    rig.tailLift += (tailLift - rig.tailLift) * k;

    if (rig.head) rig.head.rotation.set(rig.headPitch, rig.headYaw, 0);
    if (rig.tail) rig.tail.rotation.set(rig.tailLift, 0, tailWag);

    const body = rig.body;
    if (body) {
      let y = rig.bodyY, pitch = rig.bodyPitch, roll = 0;
      if (rig.species === 'rabbit') {
        const hop = Math.max(0, Math.sin(rig.gait)) * (spec.bob + .03 * running) * moving;
        y += hop;
        pitch += -Math.cos(rig.gait) * .18 * moving;
      } else {
        y += Math.abs(Math.sin(rig.gait)) * spec.bob * moving;
        pitch += Math.sin(rig.gait) * .07 * running;
      }
      // Wolf crouch: body drops and dips forward while the legs splay (feet stay planted).
      y -= .09 * rig.crouch;
      pitch += .08 * rig.crouch;
      if (mode === 'dying' && !rig.wolf) {
        const collapse = Math.min(1, progress / .35);
        const eased = collapse * collapse * (3 - 2 * collapse);
        roll = rig.rollSide * 1.45 * eased;
        y = rig.bodyY + (spec.lying - rig.bodyY) * eased;
      }
      body.position.y = y;
      body.rotation.set(pitch, 0, roll);
    }

    for (let i = 0; i < 4; i++) {
      const leg = rig.legs[i];
      if (!leg) continue;
      const front = i < 2;
      let angle: number;
      if (rig.species === 'rabbit') {
        angle = (front ? Math.cos(rig.gait) * .6 : -Math.cos(rig.gait)) * swing;
      } else {
        const phase = WALK_PHASE[i] + (GALLOP_PHASE[i] - WALK_PHASE[i]) * running;
        angle = Math.sin(rig.gait + phase) * swing;
      }
      angle += (front ? -.7 : .43) * rig.crouch;
      if (mode === 'dying' && !rig.wolf) angle = (front ? -.35 : .35) * Math.min(1, progress * 3);
      leg.rotation.x = angle;
    }

    if (rig.wolf) {
      const dissolve = mode === 'dying' ? progress : 0;
      // Rising from ash: squat and wide at first, then up to full height as the embers settle.
      const emerge = mode === 'emerge' ? progress : 1;
      if (dissolve > 0) {
        object.scale.set(1 + .25 * dissolve, Math.max(.05, 1 - .9 * dissolve * dissolve), 1 + .25 * dissolve);
      } else if (mode === 'emerge' || object.scale.y !== 1) {
        const rise = emerge * emerge * (3 - 2 * emerge);
        object.scale.set(.6 + .4 * rise, .1 + .9 * rise, .6 + .4 * rise);
      }
      const hunting = mode === 'stalk' || mode === 'telegraph' || mode === 'lunge' || mode === 'feint' || mode === 'press' ? 1 : 0;
      if (rig.embers) {
        const smoulder = (.35 + .65 * this.dark) * (.8 + .2 * Math.sin(time * 2.6 + rig.seed));
        let flare = smoulder * (1 + .25 * hunting);
        if (dissolve > 0) flare = 1.6 * (1 - dissolve) + smoulder * (1 - dissolve);
        else if (emerge < 1) flare = 1.6 * (1 - emerge) + smoulder * emerge;
        rig.embers.color.setScalar(flare);
      }
      if (rig.eyes && rig.eyeBase) {
        const glow = (.55 + .45 * this.dark) * (1 + .5 * hunting + .15 * Math.sin(time * 4.1 + rig.seed)) *
          (1 - dissolve) * emerge * emerge;
        rig.eyes.color.copy(rig.eyeBase).multiplyScalar(glow);
      }
    } else if (rig.age < P.scaleInSeconds + .1) {
      // Prey fade into the world by growing from a third of their size.
      const t = clamp01(rig.age / P.scaleInSeconds);
      object.scale.setScalar(P.scaleFrom + (1 - P.scaleFrom) * t * t * (3 - 2 * t));
    }
  }
}
