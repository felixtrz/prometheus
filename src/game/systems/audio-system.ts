/**
 * Game audio director (priority 40). Owns every game audio entity; gameplay never
 * touches AudioSource directly, it only emits bus events.
 *
 * - One-shots: a bus event is mapped by audio-map.ts to a cue, then played with ±1 dB
 *   level jitter; clips with takes pick one at random, never the same twice running.
 *   Positional cues borrow a voice from one shared pool of SPATIAL.voices single-
 *   instance PositionalAudio emitters: the take's buffer is swapped in and the voice is
 *   moved to the cue with the clip's distance settings, so moving a voice never drags a
 *   sound still ringing elsewhere. A clip holds at most `voices` of them (its oldest
 *   restarts); a full pool steals the voice nearest its end. Head-locked clips keep one
 *   emitter each with `voices` overlapping instances (takes swapped the same way).
 *   The swap writes AudioSource `_buffer`, which IWSDK 0.5.3's AudioSystem reads when it
 *   starts an instance (createAndPlayInstance); @iwsdk/core is pinned, re-check on upgrade.
 * - Beds (stereo, head-locked): forest-day and night loop forever; their volumes are an
 *   equal-power crossfade of nightness(GameState.clock), ducked while a stinger plays.
 * - World ambience: birds by day and owls at night play from random points 8–70 m
 *   around the listener (world-anchored, never a fixed pattern), dipping under the
 *   shade's voice; from danger stage 1 a distant howl follows the dusk stinger.
 * - World loops: campfire = fire-bed + fire-pops (co-prime 17 s / 29 s) scaled by
 *   Campfire.lit/fuel; a torch-flame loop follows the tip of a held lit torch every
 *   frame; the brook emitter slides to the nearest point of LANDMARKS.brook; the
 *   beacon-build riser follows Beacon.progress, then the beacon roar plays while the
 *   spire is lit (ducked under the ending theme).
 * - Heartbeat: below HEARTBEAT.on health, one 'lub-dub' every HEARTBEAT.period s from this
 *   system's own beat clock, with a light haptic tick on each lub. `heartbeatPhase()`
 *   exposes the clock so the vignette pulse locks to the same beat.
 * - Footsteps: one step per stride (strideFor(speed): 0.7–1.1 m, longer when faster, so
 *   ~2.4 steps/s at 2.6 m/s) of head travel while the rig locomotes (standing,
 *   turning on the spot and room-scale walking stay silent), dirt or grass by the ground
 *   under the feet, alternating feet. Silent before 'journey-begin' and through fades
 *   (sleep, death until respawn, the journey fade-in).
 * - Stingers: dusk, dawn (deduped, and held until a sleep swell finishes), stage (only
 *   when it rises during play), sleep, death, journey, spire-eye, ending theme.
 * - Voice duck: while Prometheus' shade speaks aloud (a 'guide' event with `voiced`, for its
 *   `seconds`, released early by 'guide-end'), the beds, world loops, ambience spots and
 *   music stingers dip to VOICE_DUCK.level. Subtitle-only lines (no clip) never duck.
 * - Journey reset ('new-game'): the music and stingers fade out (RESET_FADE), the world
 *   loops and heartbeat stop, every timer and cooldown clears; loops, heartbeat and
 *   footsteps wait for the next 'journey-begin'.
 * - Unlock: resumes the shared AudioContext on pointer/key/touch and XR select/squeeze
 *   (IWSDK only resumes it on XR sessionstart). One-shots requested while suspended are
 *   skipped (else they would all fire on resume) but logged with played:false. A master
 *   compressor on the listener catches pile-ups (finale: roar + ignite + theme).
 * - Verification: globalThis.__prometheusAudioLog (last 64 {clip, t, played}; footsteps
 *   and repeat heartbeats are counted in the state instead) and
 *   globalThis.__prometheusAudioState (live loop, heartbeat and footstep state).
 *
 * Exported as both `AudioSystem` and `GameAudioSystem`; the class name is
 * GameAudioSystem so ECS tooling can tell it from IWSDK's built-in AudioSystem.
 */
import {
  AssetManager, AudioContext as ThreeAudioContext, AudioSource, AudioUtils, createSystem, DistanceModel, PlaybackMode, Vector3,
  type AudioListener, type Entity,
} from '@iwsdk/core';
import type { ClipId } from '../audio-assets.js';
import {
  CLIP_DEFS, DUCK, HEARTBEAT, STEP, beaconBuildVolume, createCue, dayBedGain, fireLoopVolume, heartbeatVolume, mapEvent,
  nearestOnPolyline, nightBedGain, stepCue, strideFor, variantId, type AudioCue, type ClipDef, type OneShotId,
} from '../audio-map.js';
import { bus, type GameEvent } from '../bus.js';
import { ITEMS } from '../catalog.js';
import { Beacon, Campfire, GameState, Held, Item } from '../components.js';
import { pulse } from '../haptics.js';
import { nightness } from '../rules.js';
import { LANDMARKS, terrainHeight } from '../terrain.js';
import { trailHit, trailNearest } from '../../scene-assets/valley-layout.scene-asset.js';
import { DayNightSystem } from './daynight-system.js';

/** Bed levels at full day / full night (≈ −27 LUFS in game). */
const BED = { day: 0.8, night: 0.85 } as const;
/** Campfire layers relative to fireLoopVolume(): pops stay 2 dB proud of the bed. */
const FIRE = { bed: 0.8, pops: 1 } as const;
const TORCH_VOLUME = 0.45;
const BUILD_VOLUME = 0.9;
const HEART_VOLUME = 1;
/** Controller tick on each heartbeat's lub: [intensity, ms]. */
const HEART_HAPTIC = [0.2, 25] as const;
/** Loop bookkeeping interval (seconds). */
const TICK = 0.25;
/** Brook loop starts within `on` m of the centreline and stops beyond `off` m. */
const BROOK = { on: 32, off: 38, lift: 0.3, volume: 0.75 } as const;
/** Beacon roar under the ending theme: dip to `level` over `attack` s, hold, recover over `release` s. */
const ROAR_DUCK = { level: 0.4, attack: 1.5, hold: 20, release: 6 } as const;
/** Under the shade's voice: gain, attack/release rates (1/s) and a tail after the line (s). */
const VOICE_DUCK = { level: 0.5, attack: 4, release: 1.2, tail: 0.5 } as const;
/** Stingers and themes that dip under the shade's voice (and fade out on a journey reset). */
const MUSIC: readonly OneShotId[] = ['journey', 'dusk', 'dawn', 'stage', 'sleep', 'ending', 'spire-eye', 'death'];
/** Fade (s) for the music, stingers and world loops when a journey resets. */
const RESET_FADE = 0.4;
/** Shared positional one-shot voices, and the clip they load before their first swap. */
const SPATIAL = { voices: 16, placeholder: 'snap' } as const;
/**
 * Footstep bookkeeping: travel already counted when walking starts (the first step lands
 * after stride − first m), per-frame rig motion (m) below which the rig is standing
 * still, idle seconds that end a walk, per-frame jump (m) treated as a teleport, and the
 * step's place: ahead of the head along the travel, to either side, above the floor.
 */
const FEET = { first: 0.45, still: 0.0005, settle: 0.3, teleport: 1, ahead: 0.15, side: 0.1, lift: 0.05 } as const;
/** Silent footsteps after these events while the view fades (s): sleep, respawn, journey fade-in. */
const QUIET = { sleep: 3.5, respawn: 1.5, begin: 1.2 } as const;
/** World-anchored ambience: [min, max] gap (s), distance (m) and height above ground (m). */
const BIRDS = { gap: [2, 7], dist: [8, 35], up: [2, 8] } as const;
const OWLS = { gap: [40, 110], dist: [30, 70], up: [4, 10], night: 0.8 } as const;
const DUSK_HOWL = { delay: [4, 8], dist: [45, 70], scale: 0.6 } as const;
/** Seconds after startup during which a restored danger stage plays no stinger. */
const STARTUP_QUIET = 3;
/** The dawn motif waits this long after a sleep swell starts. */
const DAWN_AFTER_SLEEP = 3.2;
const LOG_SIZE = 64;
const TORCH_TIP = ITEMS.torch.tip;
const between = (range: readonly [number, number]) => range[0] + Math.random() * (range[1] - range[0]);

/** World time (s) of the running heartbeat's first lub, or -1 while silent; and the last update's time. */
let heartStart = -1;
let heartNow = 0;

/**
 * Phase (0..1) of the audible heartbeat, for anything that pulses with it (the
 * low-health vignette): 0 on the lub (the haptic tick), HEARTBEAT.dub on the dub,
 * advancing one cycle per HEARTBEAT.period s. -1 while the heartbeat is silent (health
 * at or above HEARTBEAT.on, with hysteresis to HEARTBEAT.off; dead; ended; before the
 * journey). Pass the frame's `time` (a system update's second argument) to read this
 * frame's phase; without it, the phase at the audio system's last update.
 */
export function heartbeatPhase(time: number = heartNow): number {
  if (heartStart < 0) return -1;
  const cycles = Math.max(0, time - heartStart) / HEARTBEAT.period;
  return cycles - Math.floor(cycles);
}

type AudioLogEntry = { clip: string; t: number; played: boolean };
type AudioDebugState = {
  context: string; day: number; night: number; duck: number; voiceDuck: number;
  fire: number; torch: boolean; brook: boolean; brookDistance: number; build: number; roar: number;
  heartbeat: boolean; beats: number; heartPhase: number; begun: boolean;
  steps: number; stepsPlayed: number; stepClip: string; stepRate: number; spatialBusy: number; voices: number;
};
declare global {
  // eslint-disable-next-line no-var
  var __prometheusAudioLog: AudioLogEntry[] | undefined;
  // eslint-disable-next-line no-var
  var __prometheusAudioState: AudioDebugState | undefined;
}

type Mode = (typeof PlaybackMode)[keyof typeof PlaybackMode];
type Model = (typeof DistanceModel)[keyof typeof DistanceModel];
interface EmitterInit {
  positional: boolean;
  volume: number;
  loop?: boolean;
  maxInstances?: number;
  playbackMode?: Mode;
  refDistance?: number;
  rolloffFactor?: number;
  maxDistance?: number;
  distanceModel?: Model;
}

export class GameAudioSystem extends createSystem({
  state: { required: [GameState] },
  fires: { required: [Campfire] },
  beacons: { required: [Beacon] },
  held: { required: [Item, Held] },
}) {
  private dayNight?: DayNightSystem;
  private ctx!: AudioContext;
  private session: XRSession | undefined;
  private readonly cue: AudioCue = createCue();
  private readonly clipIndex = new Map<string, number>();
  /** Head-locked clips: one emitter each, by clip index (undefined for positional clips). */
  private readonly headVoices: (Entity | undefined)[] = [];
  /** The shared positional voices: the clip index each plays, since and until when (s). */
  private readonly spatial: Entity[] = [];
  private spatialClip!: Int16Array;
  private spatialStart!: Float64Array;
  private spatialUntil!: Float64Array;
  private lastTake!: Int8Array;
  private lastPlayed!: Float64Array;
  private day!: Entity;
  private night!: Entity;
  private fireBed!: Entity;
  private firePops!: Entity;
  private torch!: Entity;
  private brook!: Entity;
  private roar!: Entity;
  private build!: Entity;
  private stateEntity: Entity | undefined;
  private fireEntity: Entity | undefined;
  private spire: Entity | undefined;
  /** A journey is under way ('journey-begin' seen, no 'new-game' since). */
  private begun = false;
  private fireOn = false;
  private fireLit = false;
  private torchOn = false;
  private brookOn = false;
  private roarOn = false;
  private buildOn = false;
  private heartOn = false;
  private heartBeats = 0;
  private lastStage = 0;
  private now = 0;
  private tick = 0;
  private duck = 1;
  private duckTarget = 1;
  private duckUntil = 0;
  private roarDuckAt = -1e9;
  private voiceUntil = 0;
  private voiceDuck = 1;
  private musicApplied = 1;
  private readonly musicVoices: Entity[] = [];
  private musicBase!: Float32Array;
  private sleepAt = -1e9;
  private pendingDawn = 0;
  private pendingHowl = 0;
  private birdAt = 3;
  private owlAt = 20;
  // Footsteps.
  private dead = false;
  private quietUntil = 0;
  private stepPrimed = false;
  private stepTravel = 0;
  private stepIdle = 0;
  private stepAt = -1e9;
  private stepSide = 1;
  /** Smoothed locomotion speed (m/s) for the stride. */
  private stepSpeed = 0;
  private readonly stepRig = new Vector3();
  private readonly stepEye = new Vector3();
  private readonly stepRigLast = new Vector3();
  private readonly stepEyeLast = new Vector3();
  private readonly dawnEvent: GameEvent = { type: 'phase', phase: 'dawn', day: 0 };
  private readonly head = new Vector3();
  private readonly scratch = new Vector3();
  private readonly brookPoint = { x: 0, z: 0 };
  private readonly log: AudioLogEntry[] = [];
  private readonly debug: AudioDebugState = {
    context: 'suspended', day: 0, night: 0, duck: 1, voiceDuck: 1, fire: 0, torch: false, brook: false, brookDistance: 0, build: 0, roar: 0,
    heartbeat: false, beats: 0, heartPhase: -1, begun: false, steps: 0, stepsPlayed: 0, stepClip: '', stepRate: 0, spatialBusy: 0, voices: 0,
  };

  init(): void {
    this.dayNight = this.world.getSystem(DayNightSystem);
    this.ctx = ThreeAudioContext.getContext();

    // One-shots: head-locked clips get their own emitter; positional ones share the pool.
    const ids = Object.keys(CLIP_DEFS) as OneShotId[];
    this.lastTake = new Int8Array(ids.length).fill(-1);
    this.lastPlayed = new Float64Array(ids.length).fill(-1e9);
    let voiceCount = 0;
    ids.forEach((id, i) => {
      const def = CLIP_DEFS[id];
      this.clipIndex.set(id, i);
      const voice = def.positional ? undefined : this.emitter(id, { positional: false, volume: def.volume, maxInstances: def.voices, playbackMode: PlaybackMode.Overlap });
      this.headVoices.push(voice);
      if (voice) voiceCount++;
    });
    for (let k = 0; k < SPATIAL.voices; k++) {
      this.spatial.push(this.emitter(SPATIAL.placeholder, {
        positional: true, volume: 1, maxInstances: 1, playbackMode: PlaybackMode.Restart, refDistance: 1, rolloffFactor: 1, maxDistance: 100,
      }, `spatial-${k}`));
    }
    voiceCount += SPATIAL.voices;
    this.spatialClip = new Int16Array(SPATIAL.voices).fill(-1);
    this.spatialStart = new Float64Array(SPATIAL.voices);
    this.spatialUntil = new Float64Array(SPATIAL.voices);

    for (const id of MUSIC) {
      const i = this.clipIndex.get(id);
      const voice = i === undefined ? undefined : this.headVoices[i];
      if (voice) this.musicVoices.push(voice);
    }
    this.musicBase = new Float32Array(this.musicVoices.length).fill(1);

    // Beds and world loops.
    this.day = this.emitter('forest-day', { positional: false, loop: true, volume: 0 });
    this.night = this.emitter('night', { positional: false, loop: true, volume: 0 });
    const fireSpatial = { positional: true, loop: true, volume: 0, refDistance: 1.5, rolloffFactor: 1.3, maxDistance: 60 };
    this.fireBed = this.emitter('fire-bed', fireSpatial);
    this.firePops = this.emitter('fire-pops', fireSpatial);
    this.torch = this.emitter('torch-flame', { positional: true, loop: true, volume: TORCH_VOLUME, refDistance: 0.5, rolloffFactor: 1.5, maxDistance: 30 });
    this.brook = this.emitter('brook', {
      positional: true, loop: true, volume: BROOK.volume, refDistance: 4, rolloffFactor: 1, maxDistance: BROOK.on, distanceModel: DistanceModel.Linear,
    });
    this.roar = this.emitter('beacon-roar', { positional: true, loop: true, volume: 1, refDistance: 6, rolloffFactor: 0.8, maxDistance: 250 });
    this.build = this.emitter('beacon-build', { positional: true, loop: true, volume: 0, refDistance: 4, rolloffFactor: 0.8, maxDistance: 150 });
    for (const fire of [this.fireBed, this.firePops]) fire.object3D!.position.set(LANDMARKS.campfire.x, 0.5, LANDMARKS.campfire.z);
    for (const spire of [this.roar, this.build]) spire.object3D!.position.set(LANDMARKS.beacon.x, LANDMARKS.beacon.y + 1, LANDMARKS.beacon.z);
    AudioUtils.play(this.day);
    AudioUtils.play(this.night);
    this.debug.voices = voiceCount + 8;

    this.cleanupFuncs.push(
      bus.onAny(this.onEvent),
      this.queries.state.subscribe('qualify', (e) => { this.stateEntity = e; }, true),
      this.queries.state.subscribe('disqualify', (e) => { if (this.stateEntity === e) this.stateEntity = undefined; }),
      this.queries.fires.subscribe('qualify', (e) => { this.fireEntity = e; }, true),
      this.queries.fires.subscribe('disqualify', (e) => { if (this.fireEntity === e) this.fireEntity = undefined; }),
      this.queries.beacons.subscribe('qualify', (e) => { if (e.getValue(Beacon, 'role') === 'spire') this.spire = e; }, true),
      this.queries.beacons.subscribe('disqualify', (e) => { if (this.spire === e) this.spire = undefined; }),
      () => { heartStart = -1; },
    );

    // Master bus limiter: protects the output when loud cues pile up.
    const listener = this.player.head.children.find((o) => o.type === 'AudioListener') as AudioListener | undefined;
    if (listener && !listener.getFilter()) {
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      listener.setFilter(limiter);
      this.cleanupFuncs.push(() => { if (listener.getFilter() === limiter) listener.removeFilter(); });
    }

    // Autoplay unlock: any user gesture (2D) and XR select/squeeze.
    const xr = this.renderer.xr;
    const onSessionStart = () => {
      this.detachSession();
      const session = xr.getSession();
      if (session) {
        session.addEventListener('selectstart', this.resume);
        session.addEventListener('squeezestart', this.resume);
        this.session = session;
      }
      this.resume();
    };
    const onSessionEnd = () => this.detachSession();
    window.addEventListener('pointerdown', this.resume, { passive: true });
    window.addEventListener('touchstart', this.resume, { passive: true });
    window.addEventListener('keydown', this.resume);
    xr.addEventListener('sessionstart', onSessionStart);
    xr.addEventListener('sessionend', onSessionEnd);
    if (xr.isPresenting) onSessionStart();

    globalThis.__prometheusAudioLog = this.log;
    globalThis.__prometheusAudioState = this.debug;
    this.cleanupFuncs.push(() => {
      window.removeEventListener('pointerdown', this.resume);
      window.removeEventListener('touchstart', this.resume);
      window.removeEventListener('keydown', this.resume);
      xr.removeEventListener('sessionstart', onSessionStart);
      xr.removeEventListener('sessionend', onSessionEnd);
      this.detachSession();
      if (globalThis.__prometheusAudioLog === this.log) globalThis.__prometheusAudioLog = undefined;
      if (globalThis.__prometheusAudioState === this.debug) globalThis.__prometheusAudioState = undefined;
    });
  }

  update(delta: number, time: number): void {
    this.now = time;
    const state = this.stateEntity;
    // The finale's Hollow-dark sky counts as night whatever the clock.
    const night = Math.max(nightness(state ? (state.getValue(GameState, 'clock') ?? 0) : 0), this.dayNight?.finaleDark ?? 0);
    const target = time < this.duckUntil ? this.duckTarget : 1;
    this.duck += (target - this.duck) * Math.min(1, delta * 1.5);
    const voiceTarget = time < this.voiceUntil ? VOICE_DUCK.level : 1;
    this.voiceDuck += (voiceTarget - this.voiceDuck) * Math.min(1, delta * (voiceTarget < this.voiceDuck ? VOICE_DUCK.attack : VOICE_DUCK.release));
    this.setVolume(this.day, BED.day * dayBedGain(night) * this.duck * this.voiceDuck);
    this.setVolume(this.night, BED.night * nightBedGain(night) * this.duck * this.voiceDuck);
    this.duckMusic();
    this.updateTorch();
    this.updateBeaconAudio();
    this.updateSpots(time, night);
    this.updateHeartbeat(state, time);
    this.updateSteps(delta);
    if (this.pendingDawn > 0 && time >= this.pendingDawn) {
      this.pendingDawn = 0;
      const cue = mapEvent(this.dawnEvent, this.cue);
      if (cue) this.playCue(cue);
    }

    this.tick -= delta;
    if (this.tick > 0) return;
    this.tick = TICK;
    this.updateFire();
    this.updateBrook();

    const debug = this.debug;
    debug.context = this.ctx.state;
    debug.day = AudioUtils.getVolume(this.day);
    debug.night = AudioUtils.getVolume(this.night);
    debug.duck = this.duck;
    debug.voiceDuck = this.voiceDuck;
    debug.fire = this.fireOn ? AudioUtils.getVolume(this.fireBed) : 0;
    debug.torch = this.torchOn;
    debug.brook = this.brookOn;
    debug.build = this.buildOn ? AudioUtils.getVolume(this.build) : 0;
    debug.roar = this.roarOn ? AudioUtils.getVolume(this.roar) : 0;
    debug.heartbeat = this.heartOn;
    debug.heartPhase = heartbeatPhase(time);
    debug.begun = this.begun;
    let busy = 0;
    for (let s = 0; s < this.spatialUntil.length; s++) if (this.spatialUntil[s] > time) busy++;
    debug.spatialBusy = busy;
  }

  // ─── events ───

  private readonly onEvent = (event: GameEvent): void => {
    switch (event.type) {
      case 'new-game':
        this.resetJourney();
        return;
      case 'journey-begin':
        this.begun = true;
        this.quietUntil = this.now + QUIET.begin;
        this.stepPrimed = false;
        break;
      case 'stage': {
        // Stinger only when danger rises during play (not on save restore or new game).
        const rising = event.stage > this.lastStage && this.now > STARTUP_QUIET;
        this.lastStage = event.stage;
        if (!rising) return;
        break;
      }
      case 'sleep':
        this.sleepAt = this.now;
        this.quietUntil = this.now + QUIET.sleep;
        break;
      case 'death':
        this.dead = true;
        break;
      case 'respawn':
        this.dead = false;
        this.quietUntil = this.now + QUIET.respawn;
        this.stepPrimed = false;
        break;
      case 'phase':
        // Waking from sleep: let the sleep swell finish before the dawn motif.
        if (event.phase === 'dawn' && this.now - this.sleepAt < DAWN_AFTER_SLEEP) {
          this.pendingDawn = this.sleepAt + DAWN_AFTER_SLEEP;
          return;
        }
        // Once the Hollow are awake, dusk ends with a distant howl.
        if (event.phase === 'dusk' && (this.stateEntity?.getValue(GameState, 'stage') ?? 0) >= 1) {
          this.pendingHowl = this.now + between(DUSK_HOWL.delay);
        }
        break;
      case 'fire-lit':
        this.fireLit = true;
        break;
      case 'guide':
        // Only a line whose clip actually plays ducks the world: a subtitle-only line leaves it as it is.
        if (event.voiced) this.voiceUntil = this.now + event.seconds + VOICE_DUCK.tail;
        return;
      case 'guide-end':
        // Spoken through or cut short: release the duck after its short tail.
        this.voiceUntil = Math.min(this.voiceUntil, this.now + VOICE_DUCK.tail);
        return;
      case 'fuel-added':
        if (!this.fireLit) return;
        break;
      default:
        break;
    }
    const cue = mapEvent(event, this.cue);
    if (cue) this.playCue(cue);
  };

  /**
   * A journey reset: fade the music and stingers (the ending theme, a death or dusk
   * sting) and the world loops, stop the heartbeat, and clear every timer and cooldown.
   * Loops, heartbeat and footsteps wait for the next 'journey-begin'.
   */
  private resetJourney(): void {
    this.begun = false;
    for (const voice of this.musicVoices) AudioUtils.pause(voice, RESET_FADE);
    if (this.fireOn) {
      AudioUtils.pause(this.fireBed, RESET_FADE);
      AudioUtils.pause(this.firePops, RESET_FADE);
      this.fireOn = false;
    }
    if (this.torchOn) AudioUtils.pause(this.torch, RESET_FADE);
    if (this.roarOn) AudioUtils.pause(this.roar, RESET_FADE);
    if (this.buildOn) AudioUtils.pause(this.build, RESET_FADE);
    this.fireLit = this.torchOn = this.roarOn = this.buildOn = false;
    this.heartOn = false;
    this.heartBeats = 0;
    heartStart = -1;
    this.lastStage = 0;
    this.roarDuckAt = -1e9;
    this.duckTarget = 1;
    this.duckUntil = 0;
    this.voiceUntil = 0;
    this.sleepAt = -1e9;
    this.pendingDawn = 0;
    this.pendingHowl = 0;
    this.dead = false;
    this.stepPrimed = false;
    this.lastPlayed.fill(-1e9);
  }

  /** Play a cue now; `log: false` keeps frequent cues (footsteps, repeat beats) out of the log. Returns whether it sounded. */
  private playCue(cue: AudioCue, log = true): boolean {
    const i = this.clipIndex.get(cue.clip);
    if (i === undefined) return false;
    const def = CLIP_DEFS[cue.clip];
    if (this.now - this.lastPlayed[i] < def.cooldown) return false;
    let x = cue.x, y = cue.y, z = cue.z;
    if (cue.positional) {
      const h = this.player.head.getWorldPosition(this.head);
      if (def.near !== undefined) {
        // The listener's own body: just off the head, toward the source (a biting wolf).
        const dx = x - h.x, dz = z - h.z, d = Math.hypot(dx, dz);
        x = d > 1e-3 ? h.x + (dx / d) * def.near : h.x;
        z = d > 1e-3 ? h.z + (dz / d) * def.near : h.z;
        y = h.y - 0.2;
      }
      const dx = x - h.x, dy = y - h.y, dz = z - h.z;
      if (dx * dx + dy * dy + dz * dz > def.maxDistance * def.maxDistance) return false;
    }
    this.lastPlayed[i] = this.now;
    // Takes: random but never the same one twice running.
    const n = def.variants, last = this.lastTake[i];
    const k = n === 1 ? 0 : last < 0 ? Math.floor(Math.random() * n) : (last + 1 + Math.floor(Math.random() * (n - 1))) % n;
    this.lastTake[i] = k;
    const volume = Math.min(1, cue.volume * (0.89 + 0.22 * Math.random()));
    const played = this.ctx.state === 'running' && (cue.positional
      ? this.playSpatial(i, def, variantId(cue.clip, k), x, y, z, cue.refDistance, volume)
      : this.playHead(i, def, variantId(cue.clip, k), volume));
    if (played) {
      const duck = DUCK[cue.clip];
      if (duck) {
        // Overlapping stingers keep the deeper and longer duck.
        const active = this.now < this.duckUntil;
        this.duckTarget = active ? Math.min(this.duckTarget, duck[0]) : duck[0];
        this.duckUntil = Math.max(active ? this.duckUntil : 0, this.now + duck[1]);
      }
      if (cue.clip === 'ending') this.roarDuckAt = this.now;
    }
    if (log) this.record(cue.clip, played);
    return played;
  }

  private playHead(i: number, def: ClipDef, take: ClipId, volume: number): boolean {
    const voice = this.headVoices[i]!;
    // Takes share the clip's emitter: each new instance starts with the swapped-in buffer.
    if (def.variants > 1 && voice.getValue(AudioSource, '_loaded')) {
      const buffer = AssetManager.getAudio(take);
      if (buffer) voice.setValue(AudioSource, '_buffer', buffer);
    }
    const music = this.musicVoices.indexOf(voice);
    if (music >= 0) this.musicBase[music] = volume;
    voice.setValue(AudioSource, 'volume', music >= 0 ? volume * this.voiceDuck : volume);
    AudioUtils.play(voice);
    return true;
  }

  /** Borrow a shared positional voice for take `take` of clip `i`; false while the take (or pool) is still loading. */
  private playSpatial(i: number, def: ClipDef, take: ClipId, x: number, y: number, z: number, refDistance: number, volume: number): boolean {
    const buffer = AssetManager.getAudio(take);
    if (!buffer) return false;
    // The clip's oldest voice once it has `voices` ringing; else the voice nearest its end
    // (a free one, least recently used, whenever any is free).
    let own = 0, oldest = -1, soonest = 0;
    for (let s = 0; s < this.spatial.length; s++) {
      if (this.spatialUntil[s] > this.now && this.spatialClip[s] === i) {
        own++;
        if (oldest < 0 || this.spatialStart[s] < this.spatialStart[oldest]) oldest = s;
      }
      if (this.spatialUntil[s] < this.spatialUntil[soonest]) soonest = s;
    }
    const s = own >= def.voices ? oldest : soonest;
    const voice = this.spatial[s];
    if (!voice.getValue(AudioSource, '_loaded')) return false;
    voice.setValue(AudioSource, '_buffer', buffer);
    voice.object3D!.position.set(x, y, z);
    voice.setValue(AudioSource, 'refDistance', refDistance);
    voice.setValue(AudioSource, 'rolloffFactor', def.rolloff);
    voice.setValue(AudioSource, 'maxDistance', def.maxDistance);
    voice.setValue(AudioSource, 'volume', volume);
    AudioUtils.play(voice);
    this.spatialClip[s] = i;
    this.spatialStart[s] = this.now;
    this.spatialUntil[s] = this.now + buffer.duration + 0.05;
    return true;
  }

  /** Music already playing follows the voice duck (applied only when it moves). */
  private duckMusic(): void {
    if (Math.abs(this.voiceDuck - this.musicApplied) < 0.01) return;
    this.musicApplied = this.voiceDuck;
    for (let k = 0; k < this.musicVoices.length; k++) {
      const voice = this.musicVoices[k];
      if (AudioUtils.isPlaying(voice)) this.setVolume(voice, this.musicBase[k] * this.voiceDuck);
    }
  }

  /** A one-shot from a random point around the listener (birds, owls, distant howls); dips under the shade's voice. */
  private playSpot(clip: OneShotId, dist: readonly [number, number], up: readonly [number, number], scale = 1): void {
    this.player.head.getWorldPosition(this.head);
    const angle = Math.random() * Math.PI * 2, d = between(dist);
    const cue = this.cue, def = CLIP_DEFS[clip];
    cue.clip = clip;
    cue.volume = Math.min(1, def.volume * scale * this.voiceDuck);
    cue.positional = true;
    cue.refDistance = def.refDistance;
    cue.x = this.head.x + Math.cos(angle) * d;
    cue.z = this.head.z + Math.sin(angle) * d;
    cue.y = terrainHeight(cue.x, cue.z) + between(up);
    this.playCue(cue);
  }

  private record(clip: string, played: boolean): void {
    const log = this.log;
    if (log.length < LOG_SIZE) {
      log.push({ clip, t: this.now, played });
      return;
    }
    const entry = log.shift()!;
    entry.clip = clip;
    entry.t = this.now;
    entry.played = played;
    log.push(entry);
  }

  // ─── world ambience ───

  private updateSpots(time: number, night: number): void {
    if (this.ctx.state !== 'running') return;
    if (time >= this.birdAt) {
      this.birdAt = time + between(BIRDS.gap);
      if (Math.random() < 1 - night) this.playSpot('bird', BIRDS.dist, BIRDS.up);
    }
    if (time >= this.owlAt) {
      this.owlAt = time + between(OWLS.gap);
      if (night > OWLS.night) this.playSpot('owl', OWLS.dist, OWLS.up);
    }
    if (this.pendingHowl > 0 && time >= this.pendingHowl) {
      this.pendingHowl = 0;
      this.playSpot('wolf-howl', DUSK_HOWL.dist, [0, 1], DUSK_HOWL.scale);
    }
  }

  // ─── heartbeat and footsteps ───

  /**
   * Every frame: below HEARTBEAT.on health, one lub-dub per HEARTBEAT.period on the beat
   * clock (the first beats swell in) and a light haptic tick on each lub. The clock runs
   * even while the AudioContext is suspended, so the vignette pulse never stalls.
   */
  private updateHeartbeat(state: Entity | undefined, time: number): void {
    heartNow = time;
    const health = state ? (state.getValue(GameState, 'health') ?? 100) : 100;
    const ended = state ? !!state.getValue(GameState, 'ended') : false;
    const limit = this.heartOn ? HEARTBEAT.off : HEARTBEAT.on;
    const want = this.begun && !ended && health > 0 && health < limit;
    if (want !== this.heartOn) {
      this.heartOn = want;
      this.heartBeats = 0;
      heartStart = want ? time : -1;
    }
    if (!want) return;
    const beat = Math.floor((time - heartStart) / HEARTBEAT.period);
    if (beat < this.heartBeats) return;
    this.heartBeats = beat + 1;
    const cue = this.cue;
    cue.clip = 'heartbeat';
    cue.volume = HEART_VOLUME * heartbeatVolume(health) * Math.min(1, 0.55 + 0.25 * beat);
    cue.positional = false;
    cue.refDistance = 1;
    cue.x = cue.y = cue.z = 0;
    this.playCue(cue, beat === 0);
    pulse(this.input, 'left', HEART_HAPTIC[0], HEART_HAPTIC[1]);
    pulse(this.input, 'right', HEART_HAPTIC[0], HEART_HAPTIC[1]);
    this.debug.beats++;
  }

  /**
   * Every frame: one footstep per STEP.stride of head travel, counted only on frames
   * where the rig itself moves (thumbstick locomotion), so standing, snap turns and
   * room-scale walking stay silent; a teleport (respawn, reset) restarts the count.
   */
  private updateSteps(delta: number): void {
    const rig = this.player.getWorldPosition(this.stepRig);
    const eye = this.player.head.getWorldPosition(this.stepEye);
    if (!this.stepPrimed) {
      this.stepPrimed = true;
      this.stepRigLast.copy(rig);
      this.stepEyeLast.copy(eye);
      this.stepTravel = FEET.first;
      return;
    }
    const rigMoved = Math.hypot(rig.x - this.stepRigLast.x, rig.z - this.stepRigLast.z);
    const dx = eye.x - this.stepEyeLast.x, dz = eye.z - this.stepEyeLast.z;
    const moved = Math.hypot(dx, dz);
    this.stepRigLast.copy(rig);
    this.stepEyeLast.copy(eye);
    if (rigMoved > FEET.teleport || moved > FEET.teleport) {
      this.stepTravel = FEET.first;
      return;
    }
    if (rigMoved < FEET.still) {
      this.stepIdle += delta;
      if (this.stepIdle > FEET.settle) this.stepTravel = FEET.first;
      return;
    }
    this.stepIdle = 0;
    this.stepTravel += moved;
    // Stride follows the walking speed (smoothed): longer strides, not a faster patter.
    if (delta > 0) this.stepSpeed += (Math.min(6, moved / delta) - this.stepSpeed) * Math.min(1, delta * 4);
    const stride = strideFor(this.stepSpeed);
    if (this.stepTravel < stride || moved < 1e-4) return;
    this.stepTravel = Math.min(this.stepTravel - stride, stride * 0.5);
    const since = this.now - this.stepAt;
    this.stepAt = this.now;
    if (!this.begun || this.dead || this.now < this.quietUntil) return;
    const speed = since > 0 && since < 1.5 ? stride / since : STEP.walk;
    this.debug.stepRate = since > 0 && since < 1.5 ? 1 / since : 0;
    // At the feet, a little ahead along the travel, alternating left and right.
    const fx = dx / moved, fz = dz / moved, side = FEET.side * (this.stepSide = -this.stepSide);
    const x = eye.x + fx * FEET.ahead - fz * side;
    const z = eye.z + fz * FEET.ahead + fx * side;
    trailNearest(x, z);
    const cue = stepCue(x, rig.y + FEET.lift, z, trailHit.edge, speed, this.cue);
    this.debug.steps++;
    this.debug.stepClip = cue.clip;
    if (this.playCue(cue, false)) this.debug.stepsPlayed++;
  }

  // ─── loops ───

  private updateFire(): void {
    const fire = this.fireEntity;
    const lit = this.begun && !!fire && !!fire.getValue(Campfire, 'lit');
    this.fireLit = lit;
    if (fire?.object3D) {
      fire.object3D.getWorldPosition(this.scratch);
      this.fireBed.object3D!.position.set(this.scratch.x, this.scratch.y + 0.4, this.scratch.z);
      this.firePops.object3D!.position.set(this.scratch.x, this.scratch.y + 0.4, this.scratch.z);
    }
    if (lit) {
      const v = fireLoopVolume(true, fire!.getValue(Campfire, 'fuel') ?? 0);
      this.setVolume(this.fireBed, FIRE.bed * v * this.voiceDuck);
      this.setVolume(this.firePops, FIRE.pops * v * this.voiceDuck);
    }
    if (lit && !this.fireOn) {
      AudioUtils.play(this.fireBed, 1.2);
      AudioUtils.play(this.firePops, 1.2);
      this.fireOn = true;
    } else if (!lit && this.fireOn) {
      // Fade-out then release (never a bare pause, see grounding G5).
      AudioUtils.pause(this.fireBed, 1.5);
      AudioUtils.pause(this.firePops, 1.0);
      this.fireOn = false;
    }
  }

  /** Every frame: the flame loop follows the tip of a held, lit torch. */
  private updateTorch(): void {
    let found = false;
    if (this.begun) {
      for (const entity of this.queries.held.entities) {
        if (entity.getValue(Item, 'kind') !== 'torch' || !entity.getValue(Item, 'lit') || !entity.object3D) continue;
        this.scratch.set(TORCH_TIP[0], TORCH_TIP[1], TORCH_TIP[2]);
        entity.object3D.localToWorld(this.scratch);
        this.torch.object3D!.position.copy(this.scratch);
        found = true;
        break;
      }
    }
    if (found) this.setVolume(this.torch, TORCH_VOLUME * this.voiceDuck);
    if (found && !this.torchOn) {
      AudioUtils.play(this.torch, 0.25);
      this.torchOn = true;
    } else if (!found && this.torchOn) {
      AudioUtils.pause(this.torch, 0.4);
      this.torchOn = false;
    }
  }

  /** Every frame: build-up riser by Beacon.progress, then the roar (ducked under the theme). */
  private updateBeaconAudio(): void {
    const spire = this.begun ? this.spire : undefined;
    const lit = !!spire && !!spire.getValue(Beacon, 'lit');
    const build = beaconBuildVolume(spire ? (spire.getValue(Beacon, 'progress') ?? 0) : 0, lit);
    if (build > 0) {
      this.setVolume(this.build, BUILD_VOLUME * build * this.voiceDuck);
      if (!this.buildOn) {
        this.placeAtSpire();
        AudioUtils.play(this.build, 0.3);
        this.buildOn = true;
      }
    } else if (this.buildOn) {
      AudioUtils.pause(this.build, lit ? 1.5 : 0.8);
      this.buildOn = false;
    }
    if (lit) this.setVolume(this.roar, this.roarDuck() * this.voiceDuck);
    if (lit && !this.roarOn) {
      this.placeAtSpire();
      AudioUtils.play(this.roar, 3);
      this.roarOn = true;
    } else if (!lit && this.roarOn) {
      AudioUtils.pause(this.roar, 2);
      this.roarOn = false;
    }
  }

  private roarDuck(): number {
    const t = this.now - this.roarDuckAt;
    const { level, attack, hold, release } = ROAR_DUCK;
    if (t < 0 || t >= hold + release) return 1;
    if (t < attack) return 1 - ((1 - level) * t) / attack;
    if (t < hold) return level;
    return level + ((1 - level) * (t - hold)) / release;
  }

  private placeAtSpire(): void {
    const object = this.spire?.object3D;
    if (!object) return;
    object.getWorldPosition(this.scratch);
    this.roar.object3D!.position.set(this.scratch.x, this.scratch.y + 1, this.scratch.z);
    this.build.object3D!.position.set(this.scratch.x, this.scratch.y + 1, this.scratch.z);
  }

  private updateBrook(): void {
    this.player.head.getWorldPosition(this.head);
    const p = this.brookPoint;
    const distance = nearestOnPolyline(LANDMARKS.brook, this.head.x, this.head.z, p);
    this.brook.object3D!.position.set(p.x, terrainHeight(p.x, p.z) + BROOK.lift, p.z);
    this.debug.brookDistance = distance;
    if (this.brookOn) this.setVolume(this.brook, BROOK.volume * this.voiceDuck);
    if (!this.brookOn && distance < BROOK.on) {
      AudioUtils.play(this.brook, 2);
      this.brookOn = true;
    } else if (this.brookOn && distance > BROOK.off) {
      AudioUtils.pause(this.brook, 2);
      this.brookOn = false;
    }
  }

  // ─── helpers ───

  /** One identity-transform parent keeps the ~45 emitters out of the top of the scene graph. */
  private voiceRoot?: Entity;

  private emitter(src: ClipId, init: EmitterInit, name: string = src): Entity {
    if (!this.voiceRoot) {
      this.voiceRoot = this.world.createTransformEntity(undefined, { persistent: true });
      this.voiceRoot.object3D!.name = 'audio-voices';
    }
    const entity = this.world.createTransformEntity(undefined, { parent: this.voiceRoot, persistent: true });
    entity.object3D!.name = `audio:${name}`;
    entity.addComponent(AudioSource, { src, ...init });
    return entity;
  }

  private setVolume(entity: Entity, volume: number): void {
    if (Math.abs(AudioUtils.getVolume(entity) - volume) > 0.004) AudioUtils.setVolume(entity, volume);
  }

  private readonly resume = (): void => {
    const ctx = this.ctx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  };

  private detachSession(): void {
    const session = this.session;
    if (!session) return;
    session.removeEventListener('selectstart', this.resume);
    session.removeEventListener('squeezestart', this.resume);
    this.session = undefined;
  }
}

export { GameAudioSystem as AudioSystem };
