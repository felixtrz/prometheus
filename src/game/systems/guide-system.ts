/**
 * Prometheus' shade (priority 34): first-time voice guidance, woven into the story.
 *
 * Lines (voice-lines.ts) are triggered by bus events (triggersOf) and by a few
 * watched states (a hand reaching for an item, a full pot, low hunger or health,
 * a night old enough to sleep). Each speaks once per journey: ids are saved in
 * GameState.guide as they start.
 *
 * Queue: one line at a time, highest priority first; the intro (or the welcome back)
 * always speaks first; a short gap separates lines. When a line's turn comes it is
 * checked against the live game: retired if its `unless` holds (the player already
 * did it), dropped if a `when` fails (away from the bench, the set already struck,
 * no wolves tonight) or it waited past its ttl (capped at MAX_TTL). A line whose moment
 * passes while it speaks (the fire catches under the lighter line) is cut gracefully:
 * its voice fades in STALE_FADE s, its subtitle with it, and the next line follows.
 * Watched story beats: 'beacon-cold' (a lit torch in the beacon before page 5) and
 * 'beacon-slip' (the hold's progress falling, or the guardians pressing the stone).
 * Nothing speaks before 'journey-begin', while a page is held (being read), through
 * the sleep and death fades, or (except the farewell) after the ending.
 *
 * Combat discipline: while a live wolf is within THREAT.radius m, or for
 * THREAT.hurtQuiet s after a bite, only lines of THREAT.priority or more start
 * (respawn, the beacon, the openers, the farewell). A lower line that is speaking
 * is cut, and heard again later if it was cut early.
 *
 * Toasts (ToastSystem): a line's `covers` suppress the matching toast while it waits
 * or speaks, its `defers` hold one until it has spoken; toasts wait while the shade
 * speaks, and a due line waits (up to TOAST_WAIT s) for a visible toast to clear.
 *
 * The shade: one persistent pooled entity ('prometheus-shade', 2 draws, no lights, no
 * collider, no pointer events). A line fades it in 2.4–3.0 m away, 35–50° off the view
 * (inside a headset's view: the edge of view, or 3.4–3.8 m, only when the crowded camp
 * leaves nothing nearer), floating just above the ground, on a spot clear of the camp
 * props, the player's path and the sightlines to the journal board, the fire, the current
 * objective and the held item (an urgent line, priority >= 7, first tries 35-45° off the view,
 * standing across the board's sightline rather than at the edge of view; calm lore, priority <= 5,
 * stands 40-50°).
 * It faces the player, sways, raises the ember in its right hand and flares while
 * talking, then lingers and fades out. It never follows the gaze and its voice never
 * jumps mid-line: while it speaks it only glides (at most GLIDE_MAX m/s) back if the
 * player comes within SPEAK_CLOSE (dimming there), or beside the path to keep pace with
 * a player walking away; between lines it re-forms elsewhere when its spot has gone bad
 * (the player walked MOVED m or turned away). Looking down at the hands, or a wolf within
 * WOLF_DIM_RADIUS, fades it to LOOK_DOWN_FADE. At the ending it appears unbidden, stays through the dawn,
 * speaks the farewell (nothing else on screen) and rises away as embers toward the Spire.
 *
 * Bus: emits 'guide' as a line starts (text, estimated or clip seconds, subtitle-only
 * hint, `voiced` when a clip plays) and 'guide-end' when it ends or is cut (an audio duck
 * can release on it).
 *
 * Voice: the line's Drawcall clip (lazy manifest entry) plays from a PositionalAudio
 * at the shade's mouth; an analyser drives the talking glow. One request to Drawcall's
 * cache resolver at start tells which clips exist (hashes from voice-urls.ts). A
 * missing clip, or a shade that failed to load, never blocks: the 'guide' event
 * carries an estimated duration and the line plays as a subtitle. At most one console
 * warning. The GameAudioSystem ducks the ambience and music on a voiced 'guide' only.
 *
 * The shade's shaders are compiled at load (and on entering XR) by rendering it for a
 * few frames at zero opacity, so the first line never hitches.
 *
 * Verification (dev builds only): globalThis.__prometheusGuide (live state, no allocation per frame).
 */
import {
  AssetManager, AudioAnalyser, BufferAttribute, createSystem, DynamicDrawUsage, Object3D, Points, PointsMaterial,
  PositionalAudio, ShaderMaterial, Vector3, type AudioListener, type BufferGeometry, type Entity,
} from '@iwsdk/core';
import { bus, type GameEvent } from '../bus.js';
import { ITEMS } from '../catalog.js';
import { Campfire, CraftBench, Creature, GameState, Held, Item, Sentry } from '../components.js';
import { CAMP, DAY, DAY_LENGTH, FINALE, nightness, phaseAt, SLEEP, SURFACES, surfaceHeight } from '../rules.js';
import { currentObjective, objectiveIndex, OBJECTIVES } from '../story.js';
import { LANDMARKS, terrainHeight, WORLD_BOUNDS } from '../terrain.js';
import {
  addSpoken, BEACON_SLIP_FROM, clipId, DRAWCALL_ORIGIN, estimateSeconds, GUIDE_THRESHOLDS, hasSpoken, LINES, lineTtl, removeSpoken,
  THREAT, toastMatches, TRIGGERS, triggersOf, type GuideCondition, type GuideLine,
} from '../voice-lines.js';
import { VOICE_HASHES } from '../voice-urls.js';
import { SHADE } from '../../scene-assets/ghost.scene-asset.js';
import { DayNightSystem } from './daynight-system.js';
import { BackpackSystem } from './backpack-system.js';
import { JourneySystem } from './journey-system.js';
import { insideCabin, JOURNEY_STEPS, shadeMark, WRECK, type JourneyStep, type XZ } from '../journey.js';

type Phase = 'idle' | 'arriving' | 'speaking' | 'lingering' | 'leaving' | 'departing';
type Pending = { line: GuideLine; at: number };
/**
 * Where a line stands, for the ToastSystem's covered toasts: 'stale' = dropped because
 * its moment passed (a `when` failed), so a toast it covered is stale too; 'dropped' =
 * unheard for another reason (it waited out its ttl), so the toast still has to say it.
 */
export type LineStatus = 'waiting' | 'speaking' | 'spoken' | 'stale' | 'dropped';
/** Clip availability: unknown (may exist), loading, ready, missing. */
const enum Clip { Unknown, Loading, Ready, Missing }

const DEG = Math.PI / 180;
/** Seconds for the shade to fade in / out. */
const FADE_IN = 0.7;
const FADE_OUT = 0.9;
/** Longest wait for a clip still downloading once the shade is visible. */
const CLIP_WAIT = 1.6;
/** The shade stays this long after a line before fading out. */
const LINGER = 1.4;
/** Silence between two lines (priority ≥ 8 lines need less). */
const GAP = 2.2;
const GAP_URGENT = 1.2;
/** Longest wait (s) past a line's due time for a visible toast to clear first. */
const TOAST_WAIT = 4;
/**
 * Placement candidates, in order of preference: angles off the view (deg: beside it,
 * never in it) and distances (m). Inside a Quest 3's view (about ±55°) the band is
 * 35–50°: the first meeting is seen, not glimpsed. The camp is crowded (bench, trestle,
 * board, fire), so the edge of view (beyond EDGE_ANGLE, EDGE_COST) and a step further
 * out (beyond BAND_FAR) are fallbacks, still preferred over standing in a prop or across
 * a sightline. For a line of URGENT_PRIORITY or more, a spot whose only conflict is the
 * journal board's sightline (BOARD_SIGHT_COST) beats the edge of view.
 */
const SPOT_ANGLES: readonly number[] = [42, 38, 46, 50, 35, 55, 58, 64, 70];
/** Calm lore (priority CALM_PRIORITY or lower) stands a little wider, still inside the view. */
const SPOT_ANGLES_CALM: readonly number[] = [48, 44, 50, 40, 36, 55, 58, 64, 70];
/**
 * An urgent line (URGENT_PRIORITY or more) first tries URGENT_ANGLES within the band, well
 * inside a Quest 3's view (about ±55°), accepting a spot whose only conflict is the journal
 * board's sightline; only when none is clear does it fall back to the full search. Between
 * lines, a shade standing wider than URGENT_KEEP re-forms before an urgent line.
 */
const URGENT_ANGLES: readonly number[] = [40, 38, 42, 36, 44, 35, 45];
const URGENT_KEEP = 48;
const CALM_PRIORITY = 5;
const URGENT_PRIORITY = 7;
const SPOT_DISTANCES: readonly number[] = [2.6, 2.4, 2.8, 3.0, 3.4, 3.8];
const EDGE_ANGLE = 50;
const EDGE_COST = 1;
const BOARD_SIGHT_COST = 0.6;
const BAND_FAR = 3.0;
/** Clearance from the camp surfaces (bench, trestle, stump...) the shade keeps (m). */
const PROP_PAD = 0.35;
/**
 * The journal board (scene 'Journal Board'): ~1.5 m wide, modelled as two circles along
 * its yaw (`half` either side of the centre); its sightlines run to both ends (`ends`) and the centre.
 */
const BOARD = { x: 1.75, z: -2.45, yawDeg: -25, half: 0.3, radius: 0.55, ends: 0.65 } as const;
const BOARD_AX = Math.cos(BOARD.yawDeg * DEG), BOARD_AZ = -Math.sin(BOARD.yawDeg * DEG);
/** Camp props without an item surface: [x, z, radius]. */
const OBSTACLES: readonly (readonly [number, number, number])[] = [
  [0.25, -1.9, 1.05],
  [BOARD.x + BOARD_AX * BOARD.half, BOARD.z + BOARD_AZ * BOARD.half, BOARD.radius],
  [BOARD.x - BOARD_AX * BOARD.half, BOARD.z - BOARD_AZ * BOARD.half, BOARD.radius],
  [2.7, -3.25, 0.7], [2.18, -3.44, 0.5], [-2.95, -3.0, 0.6],
  [2.35, -4.4, 0.7], [-3.25, -4.05, 0.7], [-5.2, -1.6, 0.7], [5.4, -1.8, 0.7], [-3.4, -5.6, 0.7], [3.6, -6.0, 0.7],
];
/** Between lines, nearer than this (m) or further than FAR the shade re-forms elsewhere. */
const CLOSE = 1.9;
const FAR = 3.8;
/** Between lines it also re-forms once the player has walked this far (m) from where it was placed... */
const MOVED = 4;
/** ...or turned so far (deg) that it stands out beside or behind them. */
const TURNED = 85;
/**
 * While speaking it never re-forms (the voice would jump): a player this close pushes it back,
 * gliding to SPEAK_BACKOFF, and it dims to CLOSE_FADE (never a robe filling the view).
 */
const SPEAK_CLOSE = 1.6;
const SPEAK_BACKOFF = 2.6;
const CLOSE_FADE = 0.55;
/**
 * Pace-keeping while speaking: a player walking faster than PACE_SPEED (m/s) who leaves it
 * beyond FAR (or behind) is followed at PACE_DISTANCE m, PACE_ANGLE deg off the direction of
 * travel (not the gaze), gliding no faster than GLIDE_MAX m/s.
 */
const PACE_SPEED = 0.8;
const PACE_DISTANCE = 2.6;
const PACE_ANGLE = 55;
const GLIDE_MAX = 3;
/** A line whose moment passes while it speaks (the fire lit under the lighter line) fades its voice over this (s). */
const STALE_FADE = 0.45;
/** ...unless it is this far through (fraction) or has only just begun (s). */
const STALE_HEARD = 0.85;
const STALE_MIN = 0.8;
/** A spot within this distance (m) of a sightline (eye → board, fire, objective, held item) is refused. */
const SIGHT_PAD = 0.6;
/** The first sightlines refreshSights adds: the journal board's centre and ends. */
const BOARD_SIGHTS = 3;
/** Sightlines longer than this (m) are ignored (the target is a speck). */
const SIGHT_RANGE = 16;
/** A held item's sightline runs this far past the eye (m). */
const HELD_RAY = 5;
/** Sightlines to fixed targets run on this far past them (m): not right behind the board or the fire either. */
const SIGHT_BEYOND = 2.5;
/** Seconds to dissolve before re-forming elsewhere (between lines only). */
const BLINK = 0.25;
/** Hem height above the ground: [min, max] (m). */
const HOVER = [0.08, 0.35] as const;
/** Looking down (head pitch below -30°: the hands, the wrist) fades the shade to this. */
const LOOK_DOWN_Y = -Math.sin(30 * DEG);
const LOOK_DOWN_FADE = 0.3;
/** A wolf this close (m) dims the shade the same way: the fight gets the view (its words still show). */
const WOLF_DIM_RADIUS = 8;
/** The farewell: seconds to rise and dissolve after the ending line; metres risen. */
const DEPART = 5;
const DEPART_RISE = 1.2;
/** Invisible frames rendered at load (and on entering XR) to compile the shade's shaders. */
const WARM_FRAMES = 3;
/** A line waits this long (s) for the shade to load before it plays as a subtitle only. */
const SHADE_LOAD_WAIT = 2;
/** Glow by day and at night (it reads brighter against the dark, so it dims). */
const GLOW_DAY = 0.9;
const GLOW_NIGHT = 0.75;

const EAT_MEAL = 1 << objectiveIndex('eat-meal');
const TORCH_TIP = new Vector3(...(ITEMS.torch.tip ?? [0, 0.32, 0]));
/** A lit torch tip this close (m) to the beacon's bowl counts as offered to it (the stone stays cold without page 5). */
const BEACON_REACH = LANDMARKS.beacon.radius + 0.2;
const BEACON_PAGE = 1 << (FINALE.requiresPage - 1);
const TORCH_DONE = 1 << objectiveIndex('torch');
const SENTRY_DONE = 1 << objectiveIndex('sentry');
const NIGHT_START = DAY.day + DAY.dusk;
const NOOP = () => undefined;
const HANDS = ['left', 'right'] as const;
const BENCH_REACH_SQ = GUIDE_THRESHOLDS.benchReach * GUIDE_THRESHOLDS.benchReach;
const CAMP_REACH_SQ = GUIDE_THRESHOLDS.campReach * GUIDE_THRESHOLDS.campReach;
const BEDROLL = SURFACES.find((s) => s.id === 'bedroll') ?? { x: -1.55, z: -3.05 };

/** Where each objective's attention goes (its sightline stays clear of the shade). */
const OBJECTIVE_TARGET: readonly ({ readonly x: number; readonly z: number } | undefined)[] = OBJECTIVES.map((o) => {
  switch (o.id) {
    case 'light-fire': case 'eat-meal': return LANDMARKS.campfire;
    case 'torch': case 'spear': case 'crossbow': case 'sentry': return CAMP.bench;
    case 'sleep': return BEDROLL;
    case 'hunt': return LANDMARKS.meadow;
    case 'outpost': return LANDMARKS.outpost;
    case 'beacon': return LANDMARKS.beacon;
    default: return undefined;
  }
});

type GuideDebug = {
  phase: Phase; line: string; lastLine: string; queue: string; spoken: string; fade: number; talk: number; arm: number;
  audio: boolean; seconds: number; clipsReady: number; clipsMissing: number; resolved: boolean; warned: boolean;
  x: number; y: number; z: number; distance: number; angle: number; started: boolean;
  threat: boolean; presence: boolean; pitchFade: number; shade: boolean; warm: number; cuts: number; pacing: boolean;
  /** Where the eye stood (x, z) and looked (fx, fz) when the current spot was chosen. */
  placedFromX: number; placedFromZ: number; placedFwdX: number; placedFwdZ: number;
};
declare global {
  // eslint-disable-next-line no-var
  var __prometheusGuide: GuideDebug | undefined;
}

export class GuideSystem extends createSystem({
  game: { required: [GameState] },
  fires: { required: [Campfire] },
  benches: { required: [CraftBench] },
  creatures: { required: [Creature] },
  sentries: { required: [Sentry] },
  items: { required: [Item] },
  held: { required: [Item, Held] },
}) {
  private now = 0;
  private started = false;
  /** The first line of a session (intro or welcome) must speak before any other. */
  private opener = '';
  private ended = false;
  private dead = false;
  private blockedUntil = 0;
  private nextAt = 0;
  private readonly queue: Pending[] = [];
  private readonly keys: string[] = [];
  /** Lines last dropped because their moment passed (cleared when one is requested again). */
  private readonly stale = new Set<string>();
  private current: GuideLine | undefined;
  private phase: Phase = 'idle';
  private phaseAt = 0;
  private speakStart = 0;
  private speakEnd = 0;
  private usingAudio = false;
  private pollTimer = 0;
  private followTimer = 0;
  private handNearDone = false;
  private grabbedAny = false;
  /** Where the journey pins the shade (the wreck's aisle, outside its door), when it does. */
  private journey?: JourneySystem;
  private readonly mark: XZ = { x: 0, z: 0 };
  private stateEntity: Entity | undefined;
  private fireEntity: Entity | undefined;
  private benchEntity: Entity | undefined;
  /** Pages held right now (the reader is open). */
  private pagesHeld = 0;
  /** A live wolf within THREAT.radius (4 Hz scan), and within WOLF_DIM_RADIUS. */
  private threatNear = false;
  private wolfClose = false;
  /** Quiet after a bite until this time. */
  private hurtUntil = 0;
  /** A toast is on screen until this time (ToastSystem.noteToast). */
  private toastUntil = 0;
  /** The ending: the shade stays shown between lines until its farewell. */
  private presence = false;
  /** The Spire hold: last progress seen, and the most it reached since the hold began. */
  private beaconLast = 0;
  private dayNight?: DayNightSystem;
  private beaconPeak = 0;
  /** Keeping pace beside a player walking away mid-line. */
  private pacing = false;
  /** A stale line's voice is fading out: stop it at this time (0 = none). */
  private voiceStopAt = 0;

  // Shade
  private entity: Entity | undefined;
  private root: Object3D | undefined;
  private material: ShaderMaterial | undefined;
  private shadeFailed = false;
  private emberGeometry: BufferGeometry | undefined;
  private emberMaterial: PointsMaterial | undefined;
  private emberPositions: BufferAttribute | undefined;
  private emberColors: BufferAttribute | undefined;
  private emberSeeds!: Float32Array;
  private fade = 0;
  private talk = 0;
  private arm = 0;
  private side = -1;
  private yaw = 0;
  private lift = 0;
  private rise = 0;
  private placed = false;
  private blinking = false;
  private lookingDown = false;
  private pitchFade = 1;
  private warm = 0;
  private wasPresenting = false;
  private readonly spot = new Vector3();
  private readonly target = new Vector3();
  private readonly eye = new Vector3();
  private readonly forward = new Vector3();
  private readonly lastEye = new Vector3();
  private readonly velocity = new Vector3();
  private readonly scratch = new Vector3();
  private readonly tip = new Vector3();
  /** Where the eye stood when the current spot was chosen (MOVED is measured from here). */
  private readonly placedFrom = new Vector3();
  /** Sightline targets for placement: x, z, metres checked beyond the target (a ray for held items). */
  private readonly sights = new Float32Array(3 * 8);
  private sightCount = 0;
  private hasLastEye = false;

  // Voice
  private voice: PositionalAudio | undefined;
  private analyser: AudioAnalyser | undefined;
  private readonly clips = new Map<string, Clip>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private resolved = false;
  private warned = false;
  private disposed = false;

  private readonly debug: GuideDebug = {
    phase: 'idle', line: '', lastLine: '', queue: '', spoken: '', fade: 0, talk: 0, arm: 0, audio: false, seconds: 0,
    clipsReady: 0, clipsMissing: 0, resolved: false, warned: false, x: 0, y: 0, z: 0, distance: 0, angle: 0, started: false,
    threat: false, presence: false, pitchFade: 1, shade: false, warm: 0, cuts: 0, pacing: false,
    placedFromX: 0, placedFromZ: 0, placedFwdX: 0, placedFwdZ: -1,
  };

  init(): void {
    this.emberSeeds = new Float32Array(SHADE.embers * 4);
    for (let i = 0; i < SHADE.embers; i++) {
      const s = this.emberSeeds;
      s[i * 4] = Math.random() * Math.PI * 2; // start angle
      s[i * 4 + 1] = 0.2 + Math.random() * 1.15; // start height
      s[i * 4 + 2] = 1.7 + Math.random() * 1.6; // life (s)
      s[i * 4 + 3] = Math.random(); // phase
    }
    for (const line of LINES) this.clips.set(line.id, Clip.Unknown);

    void this.world.assets.instantiate('prometheus-shade').then((object) => {
      if (this.disposed) return;
      this.adopt(object);
    }).catch((error: unknown) => {
      // Lines still play, as subtitles (advance() never waits for a shade that is not coming).
      this.shadeFailed = true;
      console.warn('[Prometheus guide] shade failed to load; lines play as subtitles only', error);
    });

    const isPage = (entity: Entity) => entity.getValue(Item, 'kind') === 'page';
    this.cleanupFuncs.push(
      bus.onAny(this.onEvent),
      this.queries.game.subscribe('qualify', (entity) => { this.stateEntity = entity; }, true),
      this.queries.game.subscribe('disqualify', (entity) => { if (this.stateEntity === entity) this.stateEntity = undefined; }),
      this.queries.fires.subscribe('qualify', (entity) => { this.fireEntity = entity; }, true),
      this.queries.fires.subscribe('disqualify', (entity) => { if (this.fireEntity === entity) this.fireEntity = undefined; }),
      this.queries.benches.subscribe('qualify', (entity) => { this.benchEntity = entity; }, true),
      this.queries.benches.subscribe('disqualify', (entity) => { if (this.benchEntity === entity) this.benchEntity = undefined; }),
      this.queries.held.subscribe('qualify', (entity) => { if (isPage(entity)) this.pagesHeld++; }, true),
      this.queries.held.subscribe('disqualify', (entity) => { if (isPage(entity)) this.pagesHeld = Math.max(0, this.pagesHeld - 1); }),
      () => {
        this.disposed = true;
        this.stopVoice();
        const voice = this.voice;
        if (voice) {
          voice.disconnect(); // the buffer source (if it ever played)
          voice.getOutput().disconnect(); // gain → listener and → the analyser
          voice.removeFromParent();
        }
        this.entity?.dispose({ disposeResources: false });
        this.material?.dispose();
        this.emberMaterial?.dispose();
        this.emberGeometry?.dispose();
        if (globalThis.__prometheusGuide === this.debug) globalThis.__prometheusGuide = undefined;
      },
    );
    // Verification only: the dev server (and vitexec, which runs it) exposes the live state.
    if (import.meta.env.DEV) globalThis.__prometheusGuide = this.debug;
    void this.resolveClips();
  }

  /** Take ownership of the instantiated prototype: private materials, no picking, hidden. */
  private adopt(root: Object3D): void {
    root.traverse((object) => {
      object.pointerEvents = 'none';
      object.raycast = NOOP;
    });
    const body = root.getObjectByName('shade-body') as (Object3D & { material: ShaderMaterial }) | undefined;
    const embers = root.getObjectByName('shade-embers') as Points | undefined;
    if (!body) {
      this.shadeFailed = true;
      console.warn('[Prometheus guide] shade prototype has no body; lines play as subtitles only');
      return;
    }
    const noise = body.material.uniforms.uNoise?.value;
    this.material = body.material.clone();
    // Share the prototype's noise texture instead of the clone's copy (nothing extra to upload or dispose).
    if (noise && this.material.uniforms.uNoise) this.material.uniforms.uNoise.value = noise;
    body.material = this.material;
    body.frustumCulled = false;
    if (embers) {
      // The prototype's buffers stay untouched; this clone is rewritten every visible frame (disposed with the system).
      this.emberGeometry = embers.geometry = embers.geometry.clone();
      this.emberMaterial = (embers.material as PointsMaterial).clone();
      embers.material = this.emberMaterial;
      embers.frustumCulled = false;
      this.emberPositions = embers.geometry.getAttribute('position') as BufferAttribute;
      this.emberColors = embers.geometry.getAttribute('color') as BufferAttribute;
      this.emberPositions.setUsage(DynamicDrawUsage);
      this.emberColors.setUsage(DynamicDrawUsage);
    }
    root.visible = false;
    root.scale.setScalar(SHADE.scale);
    this.root = root;
    this.entity = this.world.createTransformEntity(root, { persistent: true });
    // Compile its shaders now, invisibly, not on the first line.
    this.warm = WARM_FRAMES;
    this.debug.shade = true;

    const listener = this.player.head.children.find((o) => o.type === 'AudioListener') as AudioListener | undefined;
    if (listener) {
      const voice = new PositionalAudio(listener);
      voice.name = 'shade-voice';
      voice.position.set(SHADE.mouth[0], SHADE.mouth[1], SHADE.mouth[2]);
      voice.setRefDistance(2.6);
      voice.setRolloffFactor(0.7);
      voice.setMaxDistance(40);
      voice.setDistanceModel('inverse');
      voice.setVolume(1);
      root.add(voice);
      this.voice = voice;
      this.analyser = new AudioAnalyser(voice, 32);
    }
  }

  // ─── toast coordination (called by the ToastSystem) ───

  /** The waiting or speaking line whose `covers` (or `defers`) match this toast, if any. */
  coverFor(title: string, body: string, key: string): { id: string; defer: boolean } | undefined {
    const current = this.current;
    if (current && (this.phase === 'arriving' || this.phase === 'speaking')) {
      if (toastMatches(current.covers, title, body, key)) return { id: current.id, defer: false };
      if (toastMatches(current.defers, title, body, key)) return { id: current.id, defer: true };
    }
    for (let i = 0; i < this.queue.length; i++) {
      const line = this.queue[i].line;
      if (toastMatches(line.covers, title, body, key)) return { id: line.id, defer: false };
      if (toastMatches(line.defers, title, body, key)) return { id: line.id, defer: true };
    }
    return undefined;
  }

  /** Where a line stands: waiting (queued or arriving), speaking, spoken, or dropped unheard. */
  lineStatus(id: string): LineStatus {
    if (this.current?.id === id) return this.phase === 'speaking' ? 'speaking' : 'waiting';
    for (let i = 0; i < this.queue.length; i++) if (this.queue[i].line.id === id) return 'waiting';
    if (hasSpoken(this.spoken(), id) || this.debug.lastLine === id) return 'spoken';
    return this.stale.has(id) ? 'stale' : 'dropped';
  }

  /** A covered toast waited too long and was shown instead: the line is retired unheard. */
  withdraw(id: string): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const line = this.queue[i].line;
      if (line.id !== id) continue;
      this.queue.splice(i, 1);
      this.markSpoken(line);
    }
    this.refreshQueueDebug();
  }

  /**
   * A voiced line is on its way: the shade is arriving for it and its clip is loaded (the
   * audio can play). The GameAudioSystem starts the voice duck here, so the beds are already
   * down for the first word rather than dipping under it.
   */
  get voiceComing(): boolean {
    const line = this.current;
    if (this.phase !== 'arriving' || !line || this.voice?.context.state !== 'running') return false;
    return this.clips.get(line.id) === Clip.Ready || !!AssetManager.getAudio(clipId(line.id));
  }

  /** The shade is speaking (or about to, or taking its leave): ordinary toasts wait. */
  get speaking(): boolean {
    return this.phase === 'arriving' || this.phase === 'speaking' || this.phase === 'departing';
  }

  /**
   * Which side of the view the shade stands on while shown: +1 right, -1 left, 0 when
   * absent. The subtitle leans toward it, tying the words to the speaker.
   */
  get shadeSide(): number {
    if (!this.root?.visible || this.fade < 0.05 || this.phase === 'idle') return 0;
    const dx = this.spot.x - this.eye.x, dz = this.spot.z - this.eye.z;
    // Right of the view: forward rotated -90° about +Y is (-fz, fx).
    const right = -dx * this.forward.z + dz * this.forward.x;
    return right > 0.05 ? 1 : right < -0.05 ? -1 : 0;
  }

  /** A toast went up for `seconds`: a due line lets it be read first (up to TOAST_WAIT). */
  noteToast(seconds: number): void {
    this.toastUntil = Math.max(this.toastUntil, this.now + seconds);
  }

  // ─── events ───

  private readonly onEvent = (event: GameEvent): void => {
    switch (event.type) {
      case 'journey-begin':
        this.beaconPeak = this.beaconLast = 0;
        this.started = true;
        this.ended = !!this.state?.getValue(GameState, 'ended');
        this.dead = false;
        this.blockedUntil = 0;
        this.hurtUntil = 0;
        this.presence = false;
        this.queue.length = 0;
        this.stale.clear();
        // A resumed keeper already knows how to take hold of things.
        this.grabbedAny = event.resumed;
        this.handNearDone = event.resumed || hasSpoken(this.spoken(), 'grab');
        // After the ending the shade is free: no welcome back.
        this.opener = event.resumed ? (this.ended ? '' : 'welcome') : hasSpoken(this.spoken(), 'intro') ? '' : 'intro';
        this.debug.started = true;
        this.prefetch('intro');
        this.prefetch('welcome');
        this.prefetch('grab');
        this.prefetch('lighter');
        break;
      case 'new-game':
        // The level reloads; the start screen begins the new journey.
        this.beaconPeak = this.beaconLast = 0;
        this.started = false;
        this.pagesHeld = 0;
        this.ended = false;
        this.presence = false;
        this.debug.presence = false;
        this.queue.length = 0;
        this.silence(true);
        if (this.phase === 'departing') this.phase = 'leaving';
        this.rise = this.lift = 0;
        return;
      case 'death':
        this.dead = true;
        this.queue.length = 0;
        this.silence(true);
        break;
      case 'respawn':
        this.dead = false;
        this.blockedUntil = this.now + 1.2;
        break;
      case 'sleep':
        this.blockedUntil = this.now + 3.4;
        this.silence(true);
        break;
      case 'grab':
        this.grabbedAny = true;
        break;
      case 'ingredient':
        // The pot-full line at once (not at the next 4 Hz poll), so it is queued before the
        // same frame's "stir the pot" toast is flushed, and covers it.
        if (this.started) this.pollPot();
        break;
      case 'hurt':
        // A bite (not hunger) silences the lecture: the fight has the player's attention.
        if (event.cause !== 'starving') {
          this.hurtUntil = this.now + THREAT.hurtQuiet;
          this.cutForThreat();
        }
        break;
      case 'beacon':
        this.watchBeacon(event.progress, event.lit);
        break;
      case 'finale-hold':
        if (!event.active) this.beaconPeak = this.beaconLast = 0;
        break;
      case 'ending':
        this.ended = true;
        for (let i = this.queue.length - 1; i >= 0; i--) if (!this.queue[i].line.finale) this.queue.splice(i, 1);
        this.refreshQueueDebug();
        this.summon();
        break;
      case 'beacon-pressed':
        // Guardians crouch at the brazier and drain the hold: it is slipping.
        if (event.count > 0 && this.beaconPeak >= BEACON_SLIP_FROM && this.started) this.trigger('beacon-slip');
        break;
      default:
        break;
    }
    if (!this.started) return;
    const keys = triggersOf(event, this.keys);
    for (let i = 0; i < keys.length; i++) this.trigger(keys[i]);
  };

  /** 'beacon-slip' once the hold has got somewhere and its progress falls (let go, or pressed by the Hollow). */
  private watchBeacon(progress: number, lit: boolean): void {
    if (lit) {
      this.beaconPeak = this.beaconLast = 0;
      return;
    }
    if (progress < this.beaconLast - 1e-4 && this.beaconPeak >= BEACON_SLIP_FROM && this.started) this.trigger('beacon-slip');
    this.beaconLast = progress;
    this.beaconPeak = progress <= 0 ? 0 : Math.max(this.beaconPeak, progress);
  }

  private trigger(key: string): void {
    const refs = TRIGGERS.get(key);
    if (!refs) return;
    for (const ref of refs) this.request(ref.line, ref.delay);
  }

  private request(line: GuideLine, delay: number): void {
    if (!this.started || (this.ended && !line.finale)) return;
    if (!line.repeat && hasSpoken(this.spoken(), line.id)) return;
    if (this.current === line) return;
    for (const pending of this.queue) {
      if (pending.line !== line) continue;
      // Already waiting (a slow fallback trigger queued it first): the earlier due time wins.
      if (this.now + delay < pending.at) {
        pending.at = this.now + delay;
        this.stale.delete(line.id);
      }
      return;
    }
    this.stale.delete(line.id);
    this.queue.push({ line, at: this.now + delay });
    this.prefetch(line.id);
    this.refreshQueueDebug();
  }

  // ─── game state ───

  private get state(): Entity | undefined {
    return this.stateEntity;
  }

  private spoken(): string {
    return this.state?.getValue(GameState, 'guide') ?? '';
  }

  private markSpoken(line: GuideLine): void {
    const game = this.state;
    if (!game || line.repeat) return;
    const list = game.getValue(GameState, 'guide') ?? '';
    const next = addSpoken(list, line.id);
    if (next !== list) game.setValue(GameState, 'guide', next);
    this.debug.spoken = next;
    if (line.id === 'grab') this.handNearDone = true;
  }

  private unmarkSpoken(line: GuideLine): void {
    const game = this.state;
    if (!game || line.repeat) return;
    const list = game.getValue(GameState, 'guide') ?? '';
    const next = removeSpoken(list, line.id);
    if (next !== list) game.setValue(GameState, 'guide', next);
    this.debug.spoken = next;
  }

  private holds(condition: GuideCondition): boolean {
    const game = this.state;
    const fire = this.fireEntity;
    const objectives = game?.getValue(GameState, 'objectives') ?? 0;
    switch (condition) {
      case 'fire-lit': return !!fire?.getValue(Campfire, 'lit');
      case 'page-read': return (game?.getValue(GameState, 'pages') ?? 0) !== 0;
      case 'stew-cooked': return !!fire?.getValue(Campfire, 'stew') || (objectives & EAT_MEAL) !== 0;
      case 'meal-eaten': return (objectives & EAT_MEAL) !== 0;
      case 'pot-half': return !!fire && !fire.getValue(Campfire, 'stew') && !fire.getValue(Campfire, 'potA') !== !fire.getValue(Campfire, 'potB');
      case 'fed': return (game?.getValue(GameState, 'hunger') ?? 100) >= GUIDE_THRESHOLDS.fed;
      case 'healed': return (game?.getValue(GameState, 'health') ?? 100) >= GUIDE_THRESHOLDS.healed;
      case 'whole': return (game?.getValue(GameState, 'health') ?? 100) >= GUIDE_THRESHOLDS.whole;
      case 'day': return phaseAt(game?.getValue(GameState, 'clock') ?? 0) === 'day';
      case 'night': return phaseAt(game?.getValue(GameState, 'clock') ?? 0) !== 'day';
      case 'grabbed': return this.grabbedAny;
      case 'wolves-stirring': return (game?.getValue(GameState, 'stage') ?? 0) >= 1;
      case 'at-bench': {
        const dx = this.eye.x - CAMP.bench.x, dz = this.eye.z - CAMP.bench.z;
        return dx * dx + dz * dz < BENCH_REACH_SQ;
      }
      case 'at-camp': {
        const dx = this.eye.x - LANDMARKS.campfire.x, dz = this.eye.z - LANDMARKS.campfire.z;
        return dx * dx + dz * dz < CAMP_REACH_SQ;
      }
      case 'bench-ready': {
        const match = this.benchEntity?.getValue(CraftBench, 'match') ?? '';
        return match !== '' && match !== '!';
      }
      case 'bench-wrong': return this.benchEntity?.getValue(CraftBench, 'match') === '!';
      case 'torch-lit': return (objectives & TORCH_DONE) !== 0;
      case 'sentry-built': return (objectives & SENTRY_DONE) !== 0;
      case 'in-wreck': return insideCabin(this.eye.x, this.eye.z);
      case 'near-door': return this.journeyAtLeast('door');
      case 'door-open': return this.journeyAtLeast('open');
      case 'axe-holstered': {
        for (const item of this.queries.items.entities) {
          if (item.getValue(Item, 'kind') === 'axe' && (item.getValue(Item, 'slot') ?? '').startsWith('hip-')) return true;
        }
        return false;
      }
      case 'pack-owned': return this.world.getSystem(BackpackSystem)?.owned === true;
      case 'sentry-dry': {
        for (const sentry of this.queries.sentries.entities) if ((sentry.getValue(Sentry, 'bolts') ?? 0) <= 0) return true;
        return false;
      }
      default: {
        void (condition satisfies never);
        return false;
      }
    }
  }

  private whenHolds(line: GuideLine): boolean {
    const when = line.when;
    if (!when) return true;
    for (let i = 0; i < when.length; i++) if (!this.holds(when[i])) return false;
    return true;
  }

  private readingPage(): boolean {
    return this.pagesHeld > 0;
  }

  /** A wolf is near, or a bite was just taken. */
  private threatened(): boolean {
    return this.threatNear || this.now < this.hurtUntil;
  }

  // ─── update ───

  update(delta: number, time: number): void {
    this.now = time;
    const dt = Math.min(delta, 0.1);
    this.trackHead(dt);
    if (this.started) {
      this.pollTimer -= dt;
      if (this.pollTimer <= 0) {
        this.pollTimer = 0.25;
        this.poll();
      }
      this.pump();
    }
    if (this.voiceStopAt > 0 && this.now >= this.voiceStopAt) this.stopVoice();
    this.advance();
    this.animate(dt, time);
  }

  private trackHead(dt: number): void {
    this.camera.getWorldPosition(this.eye);
    this.camera.getWorldDirection(this.forward);
    this.lookingDown = this.forward.y < LOOK_DOWN_Y;
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    if (this.hasLastEye && dt > 0) {
      const vx = (this.eye.x - this.lastEye.x) / dt, vz = (this.eye.z - this.lastEye.z) / dt;
      const k = Math.min(1, dt * 4);
      // Clamp teleports and respawns.
      if (vx * vx + vz * vz < 64) {
        this.velocity.x += (vx - this.velocity.x) * k;
        this.velocity.z += (vz - this.velocity.z) * k;
      }
    }
    this.lastEye.copy(this.eye);
    this.hasLastEye = true;
  }

  /** Watched states that trigger lines, the threat scan, and stale lines. */
  private poll(): void {
    this.scanThreat();
    this.cutForThreat();
    const game = this.state;
    if (!game || this.dead) return;
    const hunger = game.getValue(GameState, 'hunger') ?? 100;
    const health = game.getValue(GameState, 'health') ?? 100;
    if (hunger < GUIDE_THRESHOLDS.hungerLow) this.trigger('hunger-low');
    if (health < GUIDE_THRESHOLDS.healthLow) this.trigger('health-low');

    this.pollPot();

    const clock = game.getValue(GameState, 'clock') ?? 0;
    const t = ((clock % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH;
    // Late enough to sleep (beside a cold fire too: allowed, if harsher, so the offer stands after a cold night).
    if (t >= NIGHT_START && t < NIGHT_START + DAY.night && (t - NIGHT_START) / DAY.night >= SLEEP.minNightFraction) this.trigger('sleep-ready');

    if (!this.handNearDone && !this.grabbedAny) this.pollHands();
    if (!this.ended && ((game.getValue(GameState, 'pages') ?? 0) & BEACON_PAGE) === 0) this.pollBeaconCold();
    this.purgeStale();
    this.cutStale();
  }

  /** A lit torch held into the Spire's beacon before page 5 is read: the stone stays cold. */
  private pollBeaconCold(): void {
    const b = LANDMARKS.beacon;
    for (const entity of this.queries.held.entities) {
      if (entity.getValue(Item, 'kind') !== 'torch' || !entity.getValue(Item, 'lit') || !entity.object3D) continue;
      // Cheap reject first: the Spire is far from everything else.
      const m = entity.object3D.matrixWorld.elements;
      if (Math.abs(m[12] - b.x) > 2 || Math.abs(m[14] - b.z) > 2) continue;
      this.tip.copy(TORCH_TIP).applyMatrix4(entity.object3D.matrixWorld);
      if (Math.hypot(this.tip.x - b.x, this.tip.y - b.y, this.tip.z - b.z) < BEACON_REACH) {
        this.trigger('beacon-cold');
        return;
      }
    }
  }

  /**
   * The speaking line's moment passed (its `unless` came true, or a `when` failed: the
   * fire caught under the lighter line, the set was struck mid-"strike the pad"): its voice
   * fades within STALE_FADE s, its subtitle with it ('guide-end' cut), and the next line may follow.
   */
  private cutStale(): void {
    const line = this.current;
    if (!line || this.phase !== 'speaking') return;
    const spoken = this.now - this.speakStart;
    if (spoken < STALE_MIN || spoken / Math.max(0.1, this.speakEnd - this.speakStart) > STALE_HEARD) return;
    const done = !!line.unless && this.holds(line.unless);
    if (!done && this.whenHolds(line)) return;
    this.debug.cuts++;
    this.fadeVoice();
    this.current = undefined;
    this.debug.line = '';
    this.phase = 'lingering';
    this.phaseAt = this.now;
    this.nextAt = this.now + GAP_URGENT;
    bus.emit({ type: 'guide-end', id: line.id, cut: true });
    this.trigger(`done:${line.id}`);
  }

  private pollPot(): void {
    const fire = this.fireEntity;
    if (fire && fire.getValue(Campfire, 'potA') && fire.getValue(Campfire, 'potB') && !fire.getValue(Campfire, 'stew')) this.trigger('pot-full');
  }

  /** Any live wolf within THREAT.radius of the player (last frame's matrices; 4 Hz). */
  private scanThreat(): void {
    let nearest = Infinity;
    for (const entity of this.queries.creatures.entities) {
      if (entity.getValue(Creature, 'species') !== 'wolf' || entity.getValue(Creature, 'mode') === 'dying') continue;
      if ((entity.getValue(Creature, 'health') ?? 0) <= 0) continue;
      const object = entity.object3D;
      if (!object?.visible) continue;
      const m = object.matrixWorld.elements;
      const dx = m[12] - this.eye.x, dz = m[14] - this.eye.z;
      nearest = Math.min(nearest, dx * dx + dz * dz);
    }
    const near = nearest < THREAT.radius * THREAT.radius;
    this.threatNear = near;
    this.wolfClose = nearest < WOLF_DIM_RADIUS * WOLF_DIM_RADIUS;
    this.debug.threat = near || this.now < this.hurtUntil;
  }

  /** Under threat, a low line stops: requeued (and unheard) if it was cut early. */
  private cutForThreat(): void {
    const line = this.current;
    if (!line || line.priority >= THREAT.priority || !this.threatened()) return;
    if (this.phase === 'speaking') {
      const heard = (this.now - this.speakStart) / Math.max(0.1, this.speakEnd - this.speakStart);
      if (heard < 0.6) {
        this.unmarkSpoken(line);
        this.queue.push({ line, at: this.now });
        this.refreshQueueDebug();
      }
      this.debug.cuts++;
      this.silence(true);
    } else if (this.phase === 'arriving') {
      this.queue.push({ line, at: this.now });
      this.refreshQueueDebug();
      this.silence(false);
    }
  }

  /** Drop waiting lines the player no longer needs (already done) or that waited too long. */
  private purgeStale(): void {
    let changed = false;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const { line, at } = this.queue[i];
      const expired = this.now - at > lineTtl(line);
      const done = !!line.unless && this.holds(line.unless);
      if (!expired && !done) continue;
      this.queue.splice(i, 1);
      if (done) this.markSpoken(line); // retired for the journey
      changed = true;
    }
    if (changed) this.refreshQueueDebug();
  }

  /** First time an open hand comes near a loose item. */
  private pollHands(): void {
    const reach = GUIDE_THRESHOLDS.handNear * GUIDE_THRESHOLDS.handNear;
    for (const hand of HANDS) {
      const grip = this.player.gripSpaces[hand];
      if (!grip) continue;
      grip.getWorldPosition(this.scratch);
      for (const entity of this.queries.items.entities) {
        if (entity.hasComponent(Held) || !entity.object3D?.visible) continue;
        const slot = entity.getValue(Item, 'slot') ?? '';
        if (slot !== '' && !slot.startsWith('pack-')) continue;
        // Last frame's world matrix: no recomputation for a 4 Hz proximity check.
        const m = entity.object3D.matrixWorld.elements;
        const dx = m[12] - this.scratch.x, dy = m[13] - this.scratch.y, dz = m[14] - this.scratch.z;
        if (dx * dx + dy * dy + dz * dz < reach) {
          this.handNearDone = true;
          this.trigger('hand-near');
          return;
        }
      }
    }
  }

  private blocked(): boolean {
    return this.dead || this.now < this.blockedUntil || this.readingPage();
  }

  /** Start the best waiting line when the shade is free. */
  private pump(): void {
    if (this.queue.length === 0) return;
    if (this.phase === 'arriving' || this.phase === 'speaking' || this.phase === 'departing') return;
    if (this.now < this.nextAt || this.blocked()) return;
    if (this.opener) {
      let waiting = false;
      for (let i = 0; i < this.queue.length; i++) if (this.queue[i].line.id === this.opener) waiting = true;
      if (!waiting) this.opener = '';
    }
    const threatened = this.threatened();
    let best = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const pending = this.queue[i];
      if (pending.at > this.now) continue;
      if (this.opener && pending.line.id !== this.opener) continue;
      // In a fight only the urgent speak; the rest wait for the calm (within their ttl).
      if (threatened && pending.line.priority < THREAT.priority) continue;
      if (best < 0 || pending.line.priority > this.queue[best].line.priority
        || (pending.line.priority === this.queue[best].line.priority && pending.at < this.queue[best].at)) best = i;
    }
    if (best < 0) return;
    const { line, at } = this.queue[best];
    // A toast is up: let it be read first (briefly), so words never stack.
    if (this.now < this.toastUntil && this.now - at < TOAST_WAIT) return;
    this.queue.splice(best, 1);
    this.refreshQueueDebug();
    if (this.now - at > lineTtl(line)) return;
    if ((this.ended && !line.finale) || (!line.repeat && hasSpoken(this.spoken(), line.id))) return;
    if (line.unless && this.holds(line.unless)) {
      // Already done: retire it for the journey.
      this.markSpoken(line);
      return;
    }
    // Its moment has passed (away from the bench, the set struck, no wolves tonight): dropped, not retired.
    if (!this.whenHolds(line)) {
      this.stale.add(line.id);
      return;
    }
    this.start(line);
  }

  private start(line: GuideLine): void {
    if (this.opener === line.id) this.opener = '';
    this.current = line;
    this.phase = 'arriving';
    this.phaseAt = this.now;
    this.debug.line = line.id;
    if (this.fade < 0.05 || !this.placed) {
      this.placeShade(true);
      this.fade = 0;
    } else if (!this.blinking && !this.spotGood() && this.chooseSpot(this.target) && this.target.distanceTo(this.spot) > 0.8) {
      // Between lines only: dissolve and re-form at a better spot before the voice starts
      // (left behind on a walk, turned away from, or too near the view for calm lore).
      this.blinking = true;
    }
    this.prefetch(line.id);
  }

  /** Bring the shade (silent) for the ending; it stays until its farewell. */
  private summon(): void {
    this.presence = true;
    this.debug.presence = true;
    if (this.phase === 'idle' || this.phase === 'leaving') {
      if (this.fade < 0.05 || !this.placed) {
        this.placeShade(true);
        this.fade = 0;
      }
      this.phase = 'lingering';
      this.phaseAt = this.now;
    }
  }

  private advance(): void {
    const line = this.current;
    switch (this.phase) {
      case 'arriving': {
        if (!line) { this.phase = 'leaving'; break; }
        if (this.blocked()) {
          // Not heard yet (a page was picked up, a fade began): it waits for its turn again.
          if (!this.dead) this.queue.push({ line, at: this.now });
          this.refreshQueueDebug();
          this.silence(false);
          break;
        }
        // No shade to wait for (failed, or still loading after a while): subtitles only.
        const noShade = this.shadeFailed || (!this.material && this.now - this.phaseAt > SHADE_LOAD_WAIT);
        const shown = noShade
          ? this.now - this.phaseAt > 0.3
          : !!this.material && this.fade > 0.9 && !this.blinking && this.now - this.phaseAt > 0.25;
        const clip = this.clips.get(line.id);
        const waited = this.now - this.phaseAt > FADE_IN + CLIP_WAIT;
        if (shown && (clip !== Clip.Loading || waited)) this.speak(line);
        break;
      }
      case 'speaking':
        if (this.now >= this.speakEnd) {
          this.current = undefined;
          this.debug.line = '';
          this.nextAt = this.now + (line && line.priority >= 8 ? GAP_URGENT : GAP);
          if (line) bus.emit({ type: 'guide-end', id: line.id, cut: false });
          if (line?.finale && this.ended && this.presence) {
            // The farewell: he rises away as embers, freed.
            this.phase = 'departing';
          } else {
            this.phase = 'lingering';
          }
          this.phaseAt = this.now;
          if (line) this.trigger(`done:${line.id}`);
        }
        break;
      case 'lingering':
        if (!this.presence && this.now - this.phaseAt > LINGER) this.phase = 'leaving';
        break;
      default:
        break;
    }
  }

  private speak(line: GuideLine): void {
    this.markSpoken(line);
    const id = clipId(line.id);
    const buffer = AssetManager.getAudio(id) ?? this.buffers.get(line.id);
    const voice = this.voice;
    let seconds = estimateSeconds(line.text);
    this.usingAudio = false;
    if (buffer && voice && voice.context.state === 'running') {
      if (voice.isPlaying) voice.stop();
      this.voiceStopAt = 0;
      // A faded (stale) line left the gain at zero.
      const gain = voice.gain.gain;
      gain.cancelScheduledValues(voice.context.currentTime);
      gain.setValueAtTime(1, voice.context.currentTime);
      voice.setBuffer(buffer);
      voice.play();
      seconds = buffer.duration;
      this.usingAudio = true;
    }
    this.phase = 'speaking';
    this.phaseAt = this.now;
    this.speakStart = this.now;
    this.speakEnd = this.now + seconds + 0.2;
    this.debug.audio = this.usingAudio;
    this.debug.seconds = seconds;
    this.debug.lastLine = line.id;
    bus.emit({ type: 'guide', id: line.id, text: line.text, seconds: Math.round(seconds * 10) / 10, hint: line.hint, voiced: this.usingAudio });
  }

  private stopVoice(): void {
    const voice = this.voice;
    this.voiceStopAt = 0;
    if (voice?.isPlaying) voice.stop();
  }

  /** Let the voice trail off (a stale line), stopping it once faded. */
  private fadeVoice(): void {
    const voice = this.voice;
    if (!voice?.isPlaying) return;
    voice.gain.gain.setTargetAtTime(0, voice.context.currentTime, STALE_FADE / 4);
    this.voiceStopAt = this.now + STALE_FADE;
  }

  /** Cut the current line and let the shade fade away. */
  private silence(cut: boolean): void {
    const line = this.current;
    const wasSpeaking = this.phase === 'speaking';
    this.stopVoice();
    this.current = undefined;
    this.debug.line = '';
    if (this.phase !== 'idle' && this.phase !== 'departing') {
      this.phase = 'leaving';
      this.phaseAt = this.now;
    }
    if (line && wasSpeaking) bus.emit({ type: 'guide-end', id: line.id, cut });
  }

  // ─── placement ───

  /** Pick a clear spot beside the view; `snap` moves the shade there at once. */
  private placeShade(snap: boolean): void {
    const found = this.chooseSpot(this.target);
    if (!found) return;
    if (snap || this.target.distanceTo(this.spot) > 3) {
      this.spot.copy(this.target);
      this.yaw = Math.atan2(this.eye.x - this.spot.x, this.eye.z - this.spot.z);
    }
    this.placed = true;
  }

  /**
   * Best spot beside the view: 35° or more off it and 2.4–3.0 m out, clear of props,
   * out of the walking path and of every sightline, preferred side first.
   */
  private chooseSpot(out: Vector3): boolean {
    const eye = this.eye, f = this.forward;
    // In the wreck the usual spot lands in the seats or beyond the hull: the journey's mark instead.
    if (this.journeyMark()) {
      out.set(this.mark.x, 0, this.mark.z);
      this.finishSpot(out);
      if (insideCabin(out.x, out.z)) out.y = Math.max(out.y, WRECK.origin.y + WRECK.deckY + HOVER[0]);
      this.placedFrom.copy(eye);
      return true;
    }
    const presenting = this.renderer.xr.isPresenting;
    const camera = this.camera as unknown as { fov?: number; aspect?: number };
    // A flat browser view is narrower than the headset: spots shrink toward it to stay on screen.
    const maxAngle = presenting || !camera.fov
      ? 90 : Math.max(18, Math.atan(Math.tan((camera.fov * DEG) / 2) * (camera.aspect ?? 1)) / DEG - 8);
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.refreshSights();
    let best = Infinity, bestSide = this.side;
    const priority = this.current?.priority ?? 10;
    const calm = priority <= CALM_PRIORITY;
    const urgent = priority >= URGENT_PRIORITY;
    const angles = calm ? SPOT_ANGLES_CALM : SPOT_ANGLES;
    // Urgent: a spot well inside the view first (the board's sightline allowed), before the edge of view.
    if (urgent) {
      for (let ai = 0; ai < URGENT_ANGLES.length; ai++) {
        for (let di = 0; di < SPOT_DISTANCES.length; di++) for (let s = 0; s < 2; s++) {
          const distance = SPOT_DISTANCES[di];
          if (distance > BAND_FAR) continue;
          const side = s === 0 ? this.side : -this.side;
          const angle = Math.min(URGENT_ANGLES[ai], maxAngle) * DEG * side;
          const c = Math.cos(angle), sn = Math.sin(angle);
          const dx = f.x * c + f.z * sn, dz = -f.x * sn + f.z * c;
          const x = eye.x + dx * distance, z = eye.z + dz * distance;
          if (speed > 0.4 && (dx * this.velocity.x + dz * this.velocity.z) / speed > Math.cos(35 * DEG)) continue;
          const sight = this.sightlineHit(x, z);
          if (sight === 2 || !this.clear(x, z, eye.y)) continue;
          const score = ai * 0.02 + di * 0.03 + s * 0.05 + (sight === 1 ? BOARD_SIGHT_COST : 0);
          if (score < best) {
            best = score;
            bestSide = side;
            out.set(x, 0, z);
          }
        }
      }
    }
    const inView = best < Infinity;
    for (let ai = 0; ai < angles.length && !inView; ai++) {
      for (let di = 0; di < SPOT_DISTANCES.length; di++) for (let s = 0; s < 2; s++) {
        const side = s === 0 ? this.side : -this.side;
        const angleDeg = angles[ai], distance = SPOT_DISTANCES[di];
        const angle = Math.min(angleDeg, maxAngle) * DEG * side;
        // Rotate the view direction about +Y (positive = to the right of the view).
        const c = Math.cos(angle), sn = Math.sin(angle);
        const dx = f.x * c + f.z * sn, dz = -f.x * sn + f.z * c;
        const x = eye.x + dx * distance, z = eye.z + dz * distance;
        // Preference (the band, the angle order, the current side), then the fallbacks, then heavy
        // penalties: inside a prop, across a sightline, in the walking path.
        let score = ai * 0.02 + di * 0.03 + s * 0.05;
        if (angleDeg > EDGE_ANGLE) score += EDGE_COST + (angleDeg > 64 ? 0.5 : 0);
        if (distance > BAND_FAR) score += 2;
        if (speed > 0.4 && (dx * this.velocity.x + dz * this.velocity.z) / speed > Math.cos(35 * DEG)) score += 5;
        const sight = this.sightlineHit(x, z);
        if (sight === 1 && urgent) score += BOARD_SIGHT_COST;
        else if (sight !== 0) score += 6;
        if (!this.clear(x, z, eye.y)) score += 10;
        if (score < best) {
          best = score;
          bestSide = side;
          out.set(x, 0, z);
        }
      }
    }
    this.side = bestSide;
    this.finishSpot(out);
    this.placedFrom.copy(eye);
    this.debug.placedFromX = eye.x;
    this.debug.placedFromZ = eye.z;
    this.debug.placedFwdX = f.x;
    this.debug.placedFwdZ = f.z;
    return best < Infinity;
  }

  /** The journey's pin for the shade this beat (in `mark`), if any. */
  private journeyMark(): boolean {
    this.journey ??= this.world.getSystem(JourneySystem);
    return !!this.journey && shadeMark(this.journey.step, this.mark) !== null;
  }

  /** The journey has reached `step` (or is not running: before a journey, or past camp). */
  private journeyAtLeast(step: JourneyStep): boolean {
    this.journey ??= this.world.getSystem(JourneySystem);
    const current = this.journey?.step ?? 'done';
    return JOURNEY_STEPS.indexOf(current) >= JOURNEY_STEPS.indexOf(step);
  }

  /** Whether the current spot still works for the next line (between lines only). */
  private spotGood(): boolean {
    if (this.journeyMark()) return Math.hypot(this.spot.x - this.mark.x, this.spot.z - this.mark.z) < .6;
    const dx = this.spot.x - this.eye.x, dz = this.spot.z - this.eye.z;
    const distance = Math.hypot(dx, dz);
    if (distance < CLOSE || distance > FAR) return false;
    // Left behind on the walk, or the player turned away: re-form beside the view (never mid-line, so never chasing the gaze).
    if (Math.hypot(this.eye.x - this.placedFrom.x, this.eye.z - this.placedFrom.z) > MOVED) return false;
    if ((dx * this.forward.x + dz * this.forward.z) / distance < Math.cos(TURNED * DEG)) return false;
    // Calm lore stands a little wide: a spot almost in the view is traded for one beside it.
    if ((this.current?.priority ?? 10) <= CALM_PRIORITY
      && (dx * this.forward.x + dz * this.forward.z) / distance > Math.cos(30 * DEG)) return false;
    // Out at the edge of view (or beyond it): re-formed inside the band before it speaks.
    if ((dx * this.forward.x + dz * this.forward.z) / distance < Math.cos((EDGE_ANGLE + 8) * DEG)) return false;
    // An urgent line is not spoken from the edge of view: re-formed well inside it.
    if ((this.current?.priority ?? 10) >= URGENT_PRIORITY
      && (dx * this.forward.x + dz * this.forward.z) / distance < Math.cos(URGENT_KEEP * DEG)) return false;
    this.refreshSights();
    const sight = this.sightlineHit(this.spot.x, this.spot.z);
    return this.clear(this.spot.x, this.spot.z, this.eye.y)
      && (sight === 0 || (sight === 1 && (this.current?.priority ?? 10) >= URGENT_PRIORITY));
  }

  private finishSpot(out: Vector3): void {
    const ground = terrainHeight(out.x, out.z);
    const y = this.eye.y - SHADE.eyeHeight * SHADE.scale;
    out.y = Math.min(Math.max(y, ground + HOVER[0]), ground + HOVER[1]);
  }

  private clear(x: number, z: number, eyeY: number): boolean {
    if (x < WORLD_BOUNDS.minX + 1 || x > WORLD_BOUNDS.maxX - 1 || z < WORLD_BOUNDS.minZ + 1 || z > WORLD_BOUNDS.maxZ - 1) return false;
    for (const [ox, oz, r] of OBSTACLES) if ((x - ox) * (x - ox) + (z - oz) * (z - oz) < r * r) return false;
    const pad = PROP_PAD;
    if (surfaceHeight(x, z, SURFACES) > -Infinity || surfaceHeight(x + pad, z, SURFACES) > -Infinity
      || surfaceHeight(x - pad, z, SURFACES) > -Infinity || surfaceHeight(x, z + pad, SURFACES) > -Infinity
      || surfaceHeight(x, z - pad, SURFACES) > -Infinity) return false;
    // Not sunk into a rising slope.
    return terrainHeight(x, z) < eyeY - 1.1;
  }

  /** The sightlines worth keeping clear right now: the board, the fire, the objective, held items. */
  private refreshSights(): void {
    const s = this.sights;
    let n = 0;
    const add = (x: number, z: number, beyond: number) => {
      if (n >= s.length / 3) return;
      s[n * 3] = x;
      s[n * 3 + 1] = z;
      s[n * 3 + 2] = beyond;
      n++;
    };
    // The whole board: both ends and the centre (a wide target, not a point); BOARD_SIGHTS entries.
    add(BOARD.x, BOARD.z, SIGHT_BEYOND);
    add(BOARD.x + BOARD_AX * BOARD.ends, BOARD.z + BOARD_AZ * BOARD.ends, SIGHT_BEYOND);
    add(BOARD.x - BOARD_AX * BOARD.ends, BOARD.z - BOARD_AZ * BOARD.ends, SIGHT_BEYOND);
    add(LANDMARKS.campfire.x, LANDMARKS.campfire.z, SIGHT_BEYOND);
    const game = this.state;
    if (game && !game.getValue(GameState, 'ended')) {
      const objective = currentObjective(game.getValue(GameState, 'objectives') ?? 0, phaseAt(game.getValue(GameState, 'clock') ?? 0));
      const target = objective >= 0 ? OBJECTIVE_TARGET[objective] : undefined;
      if (target) add(target.x, target.z, SIGHT_BEYOND);
    }
    for (const entity of this.queries.held.entities) {
      const object = entity.object3D;
      if (!object) continue;
      // A ray from the eye through the item: what is looked at past a held thing.
      const m = object.matrixWorld.elements;
      let dx = m[12] - this.eye.x, dz = m[14] - this.eye.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) { dx = this.forward.x; dz = this.forward.z; } else { dx /= d; dz /= d; }
      add(this.eye.x + dx * HELD_RAY, this.eye.z + dz * HELD_RAY, 0);
    }
    this.sightCount = n;
  }

  /**
   * Which sightlines (last refreshSights) pass within SIGHT_PAD of (x, z): 0 none, 1 only
   * the journal board's (its first BOARD_SIGHTS entries), 2 another (fire, objective, held item).
   */
  private sightlineHit(x: number, z: number): number {
    const s = this.sights, ex = this.eye.x, ez = this.eye.z;
    let hit = 0;
    for (let i = 0; i < this.sightCount; i++) {
      const dx = s[i * 3] - ex, dz = s[i * 3 + 1] - ez;
      const length = Math.hypot(dx, dz);
      if (length < 0.3 || length > SIGHT_RANGE) continue;
      const ux = dx / length, uz = dz / length;
      const along = (x - ex) * ux + (z - ez) * uz;
      if (along < 0 || along > length + s[i * 3 + 2]) continue;
      if (Math.abs((x - ex) * uz - (z - ez) * ux) >= SIGHT_PAD) continue;
      if (i >= BOARD_SIGHTS) return 2;
      hit = 1;
    }
    return hit;
  }

  /**
   * While shown: hold the spot (no gaze-following; the voice never jumps), tracking
   * eye height. A player walking right into it pushes it back, gliding.
   */
  private follow(dt: number): void {
    this.followTimer -= dt;
    const dx = this.spot.x - this.eye.x, dz = this.spot.z - this.eye.z;
    const distance = Math.hypot(dx, dz);
    const cos = distance > 1e-3 ? (dx * this.forward.x + dz * this.forward.z) / distance : 1;
    this.debug.distance = distance;
    this.debug.angle = Math.acos(Math.max(-1, Math.min(1, cos))) / DEG;
    if (this.followTimer > 0 || this.blinking || this.phase === 'departing') return;
    this.followTimer = 0.1;
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    // Pace-keeping starts when a walking player leaves it behind, and lasts while they keep walking.
    if (this.phase !== 'speaking' || speed < PACE_SPEED) this.pacing = false;
    else if (distance > FAR || cos < Math.cos(100 * DEG)) this.pacing = true;
    this.debug.pacing = this.pacing;
    if (distance < SPEAK_CLOSE) {
      // Back along the same bearing (or to the side of the view if the player stands in it).
      let ux = dx, uz = dz;
      if (distance < 0.05) { ux = -this.forward.z * this.side; uz = this.forward.x * this.side; } else { ux /= distance; uz /= distance; }
      this.target.set(this.eye.x + ux * SPEAK_BACKOFF, 0, this.eye.z + uz * SPEAK_BACKOFF);
    } else if (this.pacing) {
      // Walking away mid-line: keep pace beside the path (off the travel direction, never in the gaze).
      const tx = this.velocity.x / speed, tz = this.velocity.z / speed;
      for (let s = 0; s < 2; s++) {
        const a = PACE_ANGLE * DEG * (s === 0 ? this.side : -this.side);
        const c = Math.cos(a), sn = Math.sin(a);
        const x = this.eye.x + (tx * c + tz * sn) * PACE_DISTANCE, z = this.eye.z + (-tx * sn + tz * c) * PACE_DISTANCE;
        if (!this.clear(x, z, this.eye.y)) continue;
        if (s === 1) this.side = -this.side;
        this.target.set(x, 0, z);
        break;
      }
    } else {
      this.target.x = this.spot.x;
      this.target.z = this.spot.z;
    }
    this.finishSpot(this.target);
  }

  // ─── animation ───

  private animate(dt: number, time: number): void {
    const root = this.root, material = this.material;
    if (!root || !material) return;
    const presenting = this.renderer.xr.isPresenting;
    if (presenting !== this.wasPresenting) {
      // The XR framebuffer needs its own shader variants: compile them before a line needs them.
      this.wasPresenting = presenting;
      this.warm = WARM_FRAMES;
    }
    const showing = this.phase === 'arriving' || this.phase === 'speaking' || this.phase === 'lingering';
    if (this.phase === 'departing') {
      const t = Math.min(1, (this.now - this.phaseAt) / DEPART);
      this.rise = t;
      this.lift = DEPART_RISE * t * t;
      const s = Math.min(1, Math.max(0, (t - 0.2) / 0.8));
      this.fade = 1 - s * s * (3 - 2 * s);
      if (t >= 1) {
        this.phase = 'idle';
        this.placed = false;
        this.presence = false;
        this.debug.presence = false;
        this.fade = this.rise = this.lift = 0;
      }
    } else {
      const fadeTarget = showing && !this.blinking ? 1 : 0;
      const rate = this.blinking ? dt / BLINK : showing ? dt / FADE_IN : dt / FADE_OUT;
      this.fade = fadeTarget > this.fade ? Math.min(fadeTarget, this.fade + rate) : Math.max(fadeTarget, this.fade - rate);
    }
    if (this.blinking && this.fade <= 0) {
      // Re-form at the new spot, facing the player.
      this.blinking = false;
      this.spot.copy(this.target);
      this.yaw = Math.atan2(this.eye.x - this.spot.x, this.eye.z - this.spot.z);
    }
    if (this.phase === 'leaving' && this.fade <= 0) {
      this.phase = 'idle';
      this.placed = false;
    }
    const dim = this.lookingDown || this.wolfClose ? LOOK_DOWN_FADE : this.placed && this.debug.distance < SPEAK_CLOSE ? CLOSE_FADE : 1;
    this.pitchFade += (dim - this.pitchFade) * Math.min(1, dt * 4);
    this.debug.phase = this.phase;
    this.debug.fade = this.fade;
    this.debug.pitchFade = this.pitchFade;
    const u = material.uniforms;
    if (this.fade <= 0 && !this.blinking) {
      if (this.warm > 0) {
        // Drawn at zero opacity just ahead of the eye: compiles the programs, shows nothing.
        this.warm--;
        this.debug.warm = this.warm;
        root.visible = true;
        root.position.set(this.eye.x + this.forward.x * 3, this.eye.y - 1, this.eye.z + this.forward.z * 3);
        u.uFade.value = 0;
        this.updateEmbers(time, 0);
        return;
      }
      if (root.visible) root.visible = false;
      return;
    }
    root.visible = true;
    if (showing || this.phase === 'departing') this.follow(dt);

    // Glide toward the chosen spot (a ghost drifts; it never walks). Never mid-blink: it re-forms there.
    if (!this.blinking) {
      const k = 1 - Math.exp(-dt * 2.4);
      let gx = (this.target.x - this.spot.x) * k, gz = (this.target.z - this.spot.z) * k;
      // A glide, never a dash: at most GLIDE_MAX m/s across the ground.
      const step = Math.hypot(gx, gz), cap = GLIDE_MAX * dt;
      if (step > cap) { gx *= cap / step; gz *= cap / step; }
      this.spot.x += gx;
      this.spot.y += (this.target.y - this.spot.y) * k;
      this.spot.z += gz;
    }
    const wantYaw = Math.atan2(this.eye.x - this.spot.x, this.eye.z - this.spot.z);
    let dy = wantYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * (1 - Math.exp(-dt * 3));

    // Talking envelope: the voice's loudness, or a speech-like rhythm without a clip.
    let level = 0.08;
    if (this.phase === 'speaking') {
      if (this.usingAudio && this.analyser && this.voice?.isPlaying) {
        level = Math.min(1, Math.max(0, (this.analyser.getAverageFrequency() - 6) / 50));
      } else if (!this.usingAudio) {
        const s = Math.sin(time * 8.3) * Math.sin(time * 3.1 + 1) + 0.35 * Math.sin(time * 13.7);
        level = Math.min(1, Math.max(0.1, 0.45 + 0.5 * s));
      }
    }
    this.talk += (level - this.talk) * Math.min(1, dt * (level > this.talk ? 14 : 5));
    const speaking = this.phase === 'speaking';
    const remaining = this.speakEnd - this.now;
    // The raised ember is offered at a distance, never pushed into a close player's face.
    const room = Math.min(1, Math.max(0, (this.debug.distance - 1.3) / 0.4));
    const armTarget = speaking && remaining > 0.9 ? (0.62 + 0.14 * Math.sin(time * 0.9) + 0.08 * this.talk) * room
      : this.phase === 'departing' ? 0.9 : 0;
    this.arm += (armTarget - this.arm) * Math.min(1, dt * (armTarget > this.arm ? 2.2 : 1.6));

    const bob = 0.025 * Math.sin(time * 1.15);
    root.position.set(this.spot.x, this.spot.y + bob + this.lift, this.spot.z);
    root.rotation.set(0.05 * this.talk + 0.02 * Math.sin(time * 0.6), this.yaw + 0.04 * Math.sin(time * 0.45), 0.03 * Math.sin(time * 0.7), 'YXZ');

    const game = this.state;
    // The finale's Hollow-dark sky counts as night whatever the clock.
    this.dayNight ??= this.world.getSystem(DayNightSystem);
    const night = Math.max(nightness(game?.getValue(GameState, 'clock') ?? 0), this.dayNight?.finaleDark ?? 0);
    const shown = this.fade * this.fade * (3 - 2 * this.fade) * this.pitchFade;
    u.uTime.value = time;
    u.uFade.value = shown;
    u.uTalk.value = this.talk;
    u.uArm.value = this.arm;
    u.uGlow.value = GLOW_DAY + (GLOW_NIGHT - GLOW_DAY) * night;
    u.uDensity.value = 1.15 - 0.3 * night;
    this.updateEmbers(time, this.fade * this.pitchFade);

    this.debug.talk = this.talk;
    this.debug.arm = this.arm;
    this.debug.x = this.spot.x;
    this.debug.y = this.spot.y;
    this.debug.z = this.spot.z;
  }

  /** Sparks lift off the robe, swirl and fade; brighter while he speaks, streaming toward the Spire as he departs. */
  private updateEmbers(time: number, fade: number): void {
    const positions = this.emberPositions, colors = this.emberColors, seeds = this.emberSeeds;
    if (!positions || !colors) return;
    const p = positions.array as Float32Array, c = colors.array as Float32Array;
    const talk = this.talk, rise = this.rise;
    // The Spire's bearing in the shade's own frame (it faces the player; yaw about +Y).
    let driftX = 0, driftZ = 0;
    if (rise > 0) {
      const wx = LANDMARKS.spire.x - this.spot.x, wz = LANDMARKS.spire.z - this.spot.z;
      const d = Math.hypot(wx, wz) || 1;
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      driftX = ((wx * cy - wz * sy) / d) * 1.6 * rise;
      driftZ = ((wx * sy + wz * cy) / d) * 1.6 * rise;
    }
    for (let i = 0; i < SHADE.embers; i++) {
      const angle0 = seeds[i * 4], h0 = seeds[i * 4 + 1], life = seeds[i * 4 + 2], phase = seeds[i * 4 + 3];
      const cycle = time / life + phase;
      const t = cycle - Math.floor(cycle);
      const angle = angle0 + t * 1.3 + Math.floor(cycle) * 2.4;
      const radius = 0.2 + 0.16 * t;
      p[i * 3] = Math.sin(angle) * radius * 1.15 + driftX * t;
      p[i * 3 + 1] = h0 + t * (0.5 + 0.25 * talk + 2.6 * rise);
      p[i * 3 + 2] = Math.cos(angle) * radius * 0.9 - 0.03 + driftZ * t;
      const alpha = Math.pow(Math.sin(Math.PI * t), 1.4) * fade * (0.55 + 0.6 * talk + 0.8 * rise) * (0.75 + 0.25 * Math.sin(time * 9 + i));
      c[i * 4] = 1;
      c[i * 4 + 1] = 0.3 + 0.35 * (1 - t);
      c[i * 4 + 2] = 0.06 + 0.1 * (1 - t);
      c[i * 4 + 3] = alpha;
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  }

  // ─── voice clips ───

  /** One request tells which clips Drawcall has generated (no 404 per missing clip). */
  private async resolveClips(): Promise<void> {
    try {
      const hashes = LINES.map((line) => VOICE_HASHES[line.id] ?? '');
      const response = await fetch(new URL('/api/v1/cache/resolve', DRAWCALL_ORIGIN), {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes: hashes.filter((hash) => hash) }),
      });
      if (!response.ok) return;
      const { missing } = await response.json() as { missing?: string[] };
      if (this.disposed || !Array.isArray(missing)) return;
      const gone = new Set(missing);
      let count = 0;
      LINES.forEach((line, i) => {
        if ((hashes[i] && !gone.has(hashes[i])) || this.clips.get(line.id) === Clip.Ready) return;
        this.clips.set(line.id, Clip.Missing);
        count++;
      });
      this.resolved = true;
      this.debug.resolved = true;
      this.countClips();
      if (count > 0) this.warnMissing(count);
    } catch {
      // Offline or the resolver moved: clips load (or fail) one by one instead.
    }
  }

  /** Start loading a line's clip (no-op when ready, loading or known missing). */
  private prefetch(id: string): void {
    const state = this.clips.get(id);
    if (state !== Clip.Unknown) return;
    const asset = clipId(id);
    if (!VOICE_HASHES[id]) {
      this.clips.set(id, Clip.Missing);
      this.countClips();
      return;
    }
    if (AssetManager.getAudio(asset)) {
      this.clips.set(id, Clip.Ready);
      this.countClips();
      return;
    }
    this.clips.set(id, Clip.Loading);
    AssetManager.loadAudioById(asset).then((buffer) => {
      this.buffers.set(id, buffer);
      this.clips.set(id, Clip.Ready);
      this.countClips();
    }).catch(() => {
      this.clips.set(id, Clip.Missing);
      this.countClips();
      this.warnMissing(0);
    });
  }

  private warnMissing(count: number): void {
    if (this.warned) return;
    this.warned = true;
    this.debug.warned = true;
    const what = count > 0 ? `${count} of ${LINES.length} voice clips are` : 'Voice clips are';
    console.warn(`[Prometheus guide] ${what} not generated yet; the shade speaks in subtitles only. `
      + 'Generate them from the dev server at /voice-prep.html.');
  }

  private countClips(): void {
    let ready = 0, missing = 0;
    for (const state of this.clips.values()) {
      if (state === Clip.Ready) ready++;
      else if (state === Clip.Missing) missing++;
    }
    this.debug.clipsReady = ready;
    this.debug.clipsMissing = missing;
  }

  private refreshQueueDebug(): void {
    this.debug.queue = this.queue.map((pending) => pending.line.id).join(',');
    this.debug.started = this.started;
  }
}
