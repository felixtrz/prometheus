/**
 * Pure audio rules: game bus event → one-shot cue, per-clip playback settings, and
 * the small curves the AudioSystem uses for its loops. No World, DOM or Three here,
 * so tests/audio-map.test.mjs can run it under plain Node.
 */
import type { ClipId } from './audio-assets.js';
import type { GameEvent } from './bus.js';
import { CAMP } from './rules.js';
import { LANDMARKS } from './terrain.js';

export type LoopId =
  | 'forest-day' | 'night' | 'fire-bed' | 'fire-pops' | 'torch-flame' | 'brook' | 'beacon-roar' | 'beacon-build';
/** Rendered variants `<id>-2` … `<id>-6`; only their base id appears in CLIP_DEFS. */
export type VariantId = Extract<ClipId, `${string}-${2 | 3 | 4 | 5 | 6}`>;
export type OneShotId = Exclude<ClipId, LoopId | VariantId>;

export interface ClipDef {
  /** true: HRTF voice placed at the event; false: head-locked (plays "from the listener"). */
  positional: boolean;
  /** Default volume 0..1 (events may scale it). */
  volume: number;
  /**
   * Concurrent plays of this clip. Positional clips borrow single-instance voices from
   * the AudioSystem's shared pool (at most `voices` at once; the oldest restarts), so
   * moving a voice never drags a sound still ringing elsewhere; a head-locked clip is
   * one entity with `voices` overlapping instances.
   */
  voices: number;
  /** Rendered takes: id, id-2 … id-N. The system picks one at random, never the same twice running. */
  variants: number;
  /** Inverse distance model: full volume inside refDistance, then ref/(ref+rolloff·(d−ref)). */
  refDistance: number;
  rolloff: number;
  /** Beyond this distance from the listener the cue is skipped entirely. */
  maxDistance: number;
  /** Minimum seconds between two triggers of this clip (debounces per-frame emitters). */
  cooldown: number;
  /**
   * The listener's own body (positional only): the voice sits this many metres from the
   * head toward the cue's x/z, not at it, so a blow is heard on the attacker's side.
   */
  near?: number;
}

const P = (volume: number, voices: number, refDistance: number, rolloff: number, maxDistance: number, cooldown: number, variants = 1): ClipDef =>
  ({ positional: true, volume, voices, variants, refDistance, rolloff, maxDistance, cooldown });
const H = (volume: number, voices: number, cooldown: number, variants = 1): ClipDef =>
  ({ positional: false, volume, voices, variants, refDistance: 1, rolloff: 1, maxDistance: 10000, cooldown });

export const CLIP_DEFS: Readonly<Record<OneShotId, ClipDef>> = {
  // fire & cooking
  // Hand sounds sit at the hand (HRTF, heard from where it is), not inside the head.
  'lighter-flick': P(0.7, 2, 0.5, 1, 15, 0.15),
  'lid-clink': P(0.8, 1, 0.5, 1, 15, 0.1),
  ignite: P(0.9, 2, 2, 1, 80, 0.2),
  'brazier-ignite': P(1, 2, 10, 0.7, 300, 0.8),
  plop: P(0.8, 2, 1, 1.2, 25, 0.06, 2),
  stir: P(0.55, 1, 1, 1.2, 20, 0.5),
  'bowl-fill': P(0.5, 1, 1, 1.2, 20, 0.3),
  eat: H(0.8, 2, 0.25, 2),
  sizzle: P(0.6, 1, 1, 1.2, 20, 0.8),
  'fire-out': P(0.55, 1, 2, 1, 40, 0.5),
  smother: P(0.85, 1, 3, 0.9, 60, 6),
  // crafting, gathering, handling
  'hammer-clank': P(0.9, 3, 2, 1.1, 50, 0.08, 3),
  knock: P(0.8, 2, 1.5, 1.2, 30, 0.08, 2),
  'craft-complete': P(0.8, 1, 2, 1, 40, 0.3),
  'bench-ready': P(0.8, 1, 1.5, 1.1, 30, 0.3),
  'recipe-learned': H(0.85, 1, 0.8),
  'invalid-clunk': P(0.7, 1, 1.5, 1.2, 30, 0.15),
  chop: P(1, 3, 2.5, 1, 70, 0.08, 3),
  'wood-split': P(0.95, 2, 2.5, 1, 70, 0.15, 2),
  rustle: P(0.75, 3, 1.5, 1.2, 30, 0.15, 3),
  grab: P(0.8, 3, 0.5, 1, 15, 0.04, 3),
  drop: P(0.85, 3, 1.5, 1.2, 35, 0.04, 3),
  'drop-light': P(0.85, 3, 1, 1.3, 25, 0.04, 3),
  snap: P(0.8, 2, 1, 1.3, 25, 0.05, 2),
  'pack-unroll': P(0.7, 1, 1.5, 1.2, 30, 0.3),
  'sfx-pack-roll': P(0.65, 1, 1, 1.2, 30, 0.3),
  'sfx-page': P(0.6, 2, 0.5, 1, 15, 0.15),
  // weapons & combat
  'spear-whoosh': P(0.6, 1, 1.5, 1, 40, 0.1),
  hit: P(0.95, 3, 2, 1, 50, 0.05, 3),
  'crossbow-twang': P(0.9, 1, 1.5, 1, 50, 0.1),
  'bolt-thunk': P(0.85, 2, 3, 1, 60, 0.05, 2),
  'reload-click': P(0.8, 2, 0.5, 1, 15, 0.06),
  'dry-click': P(1, 1, 0.5, 1, 15, 0.1),
  // A deployed sentry repeats its empty click every 1.5 s: placed at its muzzle, never in your head.
  'sentry-dry': P(0.9, 2, 1.5, 1.1, 35, 0.3),
  'sentry-fire': P(0.85, 2, 2, 1, 60, 0.1),
  // creatures & wildlife
  'deer-flee': P(0.8, 2, 3, 1, 80, 0.5),
  'wolf-howl': P(1, 3, 10, 0.6, 250, 1.5, 3),
  // A stage-3 pincer's second growl follows the first by DANGER.pincerStagger: both must sound.
  'wolf-growl': P(0.9, 3, 3, 0.9, 60, 0.3, 3),
  'wolf-bite': P(1, 2, 2, 1, 40, 0.15),
  'wolf-pant': P(0.75, 2, 2, 1.1, 30, 0.8),
  'wolf-yelp': P(0.85, 1, 2, 1, 50, 0.3),
  'wolf-dissolve': P(0.9, 2, 3, 0.9, 80, 0.2),
  /** World-anchored ambience, scheduled by the AudioSystem (not by events). */
  bird: P(0.9, 6, 6, 0.8, 80, 0.5, 6),
  owl: P(1, 2, 8, 0.6, 150, 5, 2),
  // player, stingers, music
  'player-hurt': H(1, 1, 0.25),
  // A hurt with an attacker (hurt x/z): just off the head, on the attacker's side.
  'player-struck': { ...P(1, 1, 1, 1, 10, 0.25), near: 0.35 },
  // One 'lub-dub' per HEARTBEAT.period, played on the AudioSystem's beat clock (not by events).
  heartbeat: H(1, 1, 0.3, 2),
  // Footsteps (one per STEP.stride of locomotion, at the feet): about −30 LUFS in game.
  'step-grass': P(0.5, 2, 2, 1, 15, 0.12, 4),
  'step-dirt': P(0.5, 2, 2, 1, 15, 0.12, 4),
  journey: H(0.7, 1, 30),
  sleep: H(0.7, 1, 2),
  // Dawn comes from both the day cycle and the finale; the long cooldown dedupes them.
  dawn: H(0.75, 1, 30),
  dusk: H(0.8, 1, 30),
  'spire-eye': H(0.9, 1, 10),
  ending: H(0.9, 1, 30),
  death: H(0.85, 1, 2),
  stage: H(0.75, 1, 3),
};

/** Rendered id of take `k` of a clip (0 → the base id). */
export const variantId = (id: OneShotId, k: number): ClipId =>
  (k % CLIP_DEFS[id].variants === 0 ? id : `${id}-${(k % CLIP_DEFS[id].variants) + 1}`) as ClipId;

/** Stingers duck the ambience beds while they play: [bed gain, seconds]. */
export const DUCK: Readonly<Partial<Record<OneShotId, readonly [number, number]>>> = {
  ending: [0.35, 24],
  death: [0.45, 3.5],
  stage: [0.7, 4.5],
  sleep: [0.6, 4.5],
  dusk: [0.8, 4],
  'spire-eye': [0.6, 5],
  journey: [0.85, 5],
};

/** One resolved sound request. Reused as an out-parameter by the AudioSystem. */
export interface AudioCue {
  clip: OneShotId;
  volume: number;
  positional: boolean;
  refDistance: number;
  x: number;
  y: number;
  z: number;
}

export const createCue = (): AudioCue => ({ clip: 'grab', volume: 0, positional: false, refDistance: 1, x: 0, y: 0, z: 0 });

/** Item kinds that land with a full thud; everything else taps. */
const HEAVY: ReadonlySet<string> = new Set(['log', 'plank', 'limb', 'hammer', 'axe', 'crossbow', 'sentry-kit', 'bowl', 'torch', 'spear', 'pack']);
/** Harvests that already sound through their chop/split cue. */
const WOODEN_YIELD: ReadonlySet<string> = new Set(['log', 'stick', 'plank']);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
type Point = { readonly x: number; readonly y: number; readonly z: number };

function fill(out: AudioCue, clip: OneShotId, scale: number, x: number, y: number, z: number, refDistance?: number): AudioCue {
  const def = CLIP_DEFS[clip];
  out.clip = clip;
  out.volume = clamp(def.volume * scale, 0, 1);
  out.positional = def.positional;
  out.refDistance = refDistance ?? def.refDistance;
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}
const at = (out: AudioCue, clip: OneShotId, p: Point, scale = 1, refDistance?: number) =>
  fill(out, clip, scale, p.x, p.y, p.z, refDistance);
const head = (out: AudioCue, clip: OneShotId, scale = 1) => fill(out, clip, scale, 0, 0, 0);

/**
 * Map a bus event to the one-shot it should sound, or null for silent events.
 * Loops (beds, fire, torch, brook, beacon), the heartbeat, footsteps and the bird/owl
 * spots are state-driven by the AudioSystem, not event-driven. Pass `out` to reuse a cue
 * object (no allocation).
 */
export function mapEvent(event: GameEvent, out: AudioCue = createCue()): AudioCue | null {
  switch (event.type) {
    case 'grab': return at(out, event.kind === 'page' ? 'sfx-page' : 'grab', event, event.kind === 'page' ? 0.7 : 1);
    case 'drop':
      // A bolt or spear landing point-first thunks into the ground (audible at range).
      if (event.hard && (event.kind === 'bolt' || event.kind === 'spear')) return at(out, 'bolt-thunk', event, event.kind === 'spear' ? 1 : 0.8, 4);
      // The torn door panel slamming onto the ground outside the wreck.
      if (event.kind === 'wreck-door') return at(out, 'drop', event, 1, 4);
      return at(out, HEAVY.has(event.kind) ? 'drop' : 'drop-light', event, event.hard ? 1 : 0.7);
    case 'snap': return at(out, 'snap', event);
    case 'reject': return at(out, 'invalid-clunk', event);
    case 'lighter': return at(out, event.lit ? 'lighter-flick' : 'lid-clink', event);
    case 'fire-lit': return at(out, 'ignite', event);
    case 'fire-out': return at(out, 'fire-out', event);
    // Fuel catching is a soft flare at the fire (the system skips it while the fire is cold).
    case 'fuel-added': return at(out, 'ignite', CAMP.fire, clamp(0.3 + event.fuel / 100, 0.3, 0.65));
    case 'ingredient': return at(out, 'plop', event);
    case 'stir': return at(out, 'stir', CAMP.pot);
    case 'stew-ready': return at(out, 'craft-complete', CAMP.pot, 0.75);
    case 'bowl-filled': return at(out, 'bowl-fill', CAMP.pot);
    case 'roasted': return at(out, 'sizzle', event);
    case 'eat': return head(out, 'eat');
    case 'strike': return at(out, event.valid ? 'hammer-clank' : 'invalid-clunk', event);
    // A first-time craft also emits recipe-learned; let that chime play alone.
    case 'crafted': return event.learned ? null : at(out, 'craft-complete', event);
    case 'chop': {
      // Butchering a carcass with the axe: a meaty hit, never wood.
      if (event.node === 'carcass') return at(out, 'hit', event, 0.8);
      const split = event.remaining <= 0 || event.node.includes('stump') || event.node.includes('split');
      return at(out, split ? 'wood-split' : 'chop', event);
    }
    case 'harvest':
      if (WOODEN_YIELD.has(event.kind)) return null;
      if (event.kind === 'meat') return at(out, 'drop', event, 0.7);
      return at(out, event.kind === 'flint' ? 'drop-light' : 'rustle', event);
    case 'torch-lit': return at(out, 'ignite', event, 0.6, 1);
    case 'pack': return at(out, event.state === 'unrolled' ? 'pack-unroll' : event.state === 'worn' ? 'snap' : 'sfx-pack-roll', event);
    // The event has no position: the AudioSystem moves the cue to the hand holding the page.
    case 'page': return fill(out, 'sfx-page', event.first ? 1 : 0.7, 0, 0, 0);
    case 'recipe-learned': return head(out, 'recipe-learned');
    case 'objective': return head(out, 'recipe-learned', 0.6);
    case 'throw': {
      if (event.speed < 2.5) return null;
      const scale = clamp(event.speed / 9, 0.35, 1) * (event.kind === 'spear' ? 1 : 0.6);
      return at(out, 'spear-whoosh', event, scale);
    }
    case 'hit':
      // A torch shove is fire, not flesh; the wolf's yelp comes as its own creature cue.
      if (event.kind === 'torch') return at(out, 'ignite', event, 0.45, 1);
      return at(out, 'hit', event, event.killed ? 1 : 0.85);
    case 'crossbow-fire': return at(out, 'crossbow-twang', event);
    case 'crossbow-empty': return at(out, 'dry-click', event);
    case 'reload': return at(out, 'reload-click', event);
    case 'sentry-deployed': return at(out, 'hammer-clank', event, 0.55);
    case 'sentry-fire': return at(out, 'sentry-fire', event);
    case 'creature':
      switch (event.cue) {
        case 'howl': return at(out, 'wolf-howl', event);
        case 'growl': return at(out, 'wolf-growl', event);
        case 'bite': return at(out, 'wolf-bite', event);
        case 'dissolve': return at(out, 'wolf-dissolve', event);
        case 'stalk': return at(out, 'wolf-pant', event);
        case 'yelp': return at(out, 'wolf-yelp', event);
        case 'flee': return at(out, 'deer-flee', event, event.species === 'rabbit' ? 0.45 : 1);
        // A wolf arriving announces itself from afar.
        case 'spawn': return event.species === 'wolf' ? at(out, 'wolf-howl', event, 0.7) : null;
        default: return null;
      }
    case 'hurt': {
      // Starving ticks every few seconds: a soft breath; the AudioSystem restores the grunt on every STARVE.every-th tick (starveScale).
      if (event.cause === 'starving') return head(out, 'player-hurt', STARVE.soft);
      const scale = hurtScale(event.amount);
      // With an attacker's x/z the blow lands on its side ('player-struck' sits `near` the head).
      return event.x !== undefined && event.z !== undefined
        ? fill(out, 'player-struck', scale, event.x, 0, event.z)
        : head(out, 'player-hurt', scale);
    }
    case 'death': return head(out, 'death');
    case 'respawn': return head(out, 'sleep', 0.55);
    case 'phase': return event.phase === 'dawn' ? head(out, 'dawn') : event.phase === 'dusk' ? head(out, 'dusk') : null;
    case 'sleep': return head(out, 'sleep');
    case 'stage': return event.stage > 0 ? head(out, 'stage', clamp(0.8 + 0.1 * event.stage, 0.8, 1.2)) : null;
    // The build-up is the beacon-build loop (volume follows Beacon.progress); lighting it roars.
    case 'beacon': return event.lit ? at(out, 'brazier-ignite', LANDMARKS.beacon, 1, 12) : null;
    // The theme now starts on the finale's 'theme' step.
    case 'ending': return null;
    case 'thud':
      // An axe blow on the wreck's jammed door: metal, not wood.
      if (event.kind === 'wreck-door') return at(out, 'hammer-clank', event, 1, 3);
      // A felled tree landing: the heaviest thud there is, heard across the grove.
      if (event.kind === 'tree-fall') return at(out, 'drop', event, 1, 8);
      if (event.kind === 'bolt' || event.kind === 'spear') return at(out, 'bolt-thunk', event, event.kind === 'spear' ? 1 : 0.8);
      return at(out, 'knock', event, event.kind === 'hammer' || event.kind === 'axe' ? 1 : 0.7);
    case 'bench-set': return event.valid ? at(out, 'bench-ready', CAMP.bench, event.known ? 1 : 0.8) : at(out, 'invalid-clunk', CAMP.bench);
    case 'fire-smothered': return at(out, 'smother', CAMP.fire, clamp(0.75 + 0.25 * event.rate, 0.75, 1));
    case 'brazier-lit': return at(out, 'brazier-ignite', event);
    case 'ending-step':
      switch (event.step) {
        case 'spire-eye': return head(out, 'spire-eye');
        case 'dawn': return head(out, 'dawn');
        case 'camp': return at(out, 'brazier-ignite', CAMP.fire, 0.8);
        case 'theme': return head(out, 'ending');
        default: return null; // outpost / grove arrive as brazier-lit; smoke is silent
      }
    case 'journey-start': return event.resumed ? null : head(out, 'journey');
    case 'sentry-empty': return at(out, 'sentry-dry', event);
    // The dark falling on the Spire hold is a danger sting; its end is carried by the ending (or silence).
    case 'finale-hold': return event.active ? head(out, 'stage', 1) : null;
    // A guardian crouching at the brazier smothers it (the fire's smother cue, at the beacon).
    case 'beacon-pressed': return event.joined ? at(out, 'smother', LANDMARKS.beacon, clamp(0.7 + 0.1 * event.count, 0.7, 1)) : null;
    // The guide's voice is played by the GuideSystem itself (positional from the shade).
    case 'guide':
    case 'guide-end':
    case 'journey-begin':
    // The journey's beats sound through the guide and the actions themselves.
    case 'journey':
    case 'toast':
    case 'new-game':
    case 'spawn-item':
    // Guardians announce themselves with their own spawn howls; the stew's eat sound covers well-fed.
    case 'finale-wave':
    case 'well-fed':
    // The epilogue is the journal's (after the theme and the farewell): no cue of its own.
    case 'epilogue':
      return null;
    default:
      // Compile-time exhaustiveness: a new bus event type must be mapped above.
      void (event satisfies never);
      return null;
  }
}

/** Hurt grunt level for `amount` damage. */
const hurtScale = (amount: number) => clamp(0.55 + amount / 50, 0.55, 1);

/**
 * Starving hurts: a soft breath (`soft` of the grunt clip's level) on most ticks, a full
 * grunt on the first of a run and every `every`-th after; a gap over `reset` s starts a new run.
 */
export const STARVE = { soft: 0.25, every: 3, reset: 10 } as const;
/** Level of the `tick`-th (0-based) starving hurt of a run. */
export const starveScale = (tick: number, amount: number): number => (tick % STARVE.every === 0 ? hurtScale(amount) : STARVE.soft);

/** Shared room send for positional one-shots: wet = clamp((d − start) / span, 0, max) of the dry level. */
export const REVERB = { start: 4, span: 40, max: 0.3 } as const;
export const reverbWet = (distance: number): number => clamp((distance - REVERB.start) / REVERB.span, 0, REVERB.max);

// ─── Loop curves (pure; the AudioSystem applies them) ───

/** Equal-power day/night bed gains for a nightness value (0 full day → 1 full night). */
export const dayBedGain = (night: number) => Math.cos(clamp(night, 0, 1) * Math.PI * 0.5);
export const nightBedGain = (night: number) => Math.sin(clamp(night, 0, 1) * Math.PI * 0.5);

/** Campfire loudness from its state: silent when out, louder with fuel. */
export function fireLoopVolume(lit: boolean, fuel: number): number {
  return lit ? clamp(0.35 + (0.65 * fuel) / 60, 0.35, 1) : 0;
}

/** Beacon build-up loudness from Beacon.progress (0..1); silent once lit. */
export function beaconBuildVolume(progress: number, lit: boolean): number {
  return lit || progress <= 0 ? 0 : clamp(0.15 + 0.85 * Math.pow(progress, 1.3), 0, 1);
}

/**
 * Low-health heartbeat, shared by the audio and the vignette pulse: it starts below `on`
 * health and stops at or above `off` (hysteresis). One 'lub-dub' every `period` s: the
 * lub at phase 0 (with a light haptic tick), the dub at phase `dub` (0.27 s in).
 */
export const HEARTBEAT = { on: 30, off: 34, period: 0.75, dub: 0.36 } as const;
export function heartbeatVolume(health: number): number {
  return clamp(0.6 + (0.4 * (HEARTBEAT.on - health)) / HEARTBEAT.on, 0.6, 1);
}

// ─── Footsteps (pure; the AudioSystem measures the travel) ───

/**
 * Footstep stride: `stride` m at `walk` m/s (the locomotion speed, ~2.4 steps/s), shorter
 * when slower (strideFor), never below `minStride`. Steps at `walk` m/s sound at full level.
 */
export const STEP = { stride: 1.1, minStride: 0.7, walk: 2.6 } as const;

/** Stride (m) for a walking speed (m/s): 0.45 + 0.25·v, within [minStride, stride] (1.1 m at 2.6 m/s). */
export const strideFor = (speed: number): number => clamp(0.45 + 0.25 * speed, STEP.minStride, STEP.stride);
export type StepClip = 'step-dirt' | 'step-grass';
const brookScratch = { x: 0, z: 0 };

/**
 * Footstep surface at (x, z), following the ground paint: packed dirt in the camp
 * clearing, on the trails, the outpost shelf, the Spire plateau and the brook's gravel
 * banks; grass elsewhere. `trailEdge` is the trail distance over its half-width
 * (valley-layout's `trailNearest` → `trailHit.edge`; the dirt paint ends near 0.95).
 */
export function stepSurface(x: number, z: number, trailEdge: number): StepClip {
  if (trailEdge < 0.9 || Math.hypot(x / 4, (z + 0.1) / 3.1) < 1) return 'step-dirt';
  if (Math.hypot(x - LANDMARKS.outpost.x, (z - LANDMARKS.outpost.z) * 1.1) < 4.5) return 'step-dirt';
  if (Math.hypot(x - LANDMARKS.spire.x, (z - LANDMARKS.spire.z) * 1.1) < 4.5) return 'step-dirt';
  return nearestOnPolyline(LANDMARKS.brook, x, z, brookScratch) < 2.6 ? 'step-dirt' : 'step-grass';
}

/** A footstep cue at the feet (x, y, z) for walking at `speed` m/s: slower steps are softer. */
export function stepCue(x: number, y: number, z: number, trailEdge: number, speed: number, out: AudioCue = createCue()): AudioCue {
  return fill(out, stepSurface(x, z, trailEdge), clamp(0.6 + (0.4 * speed) / STEP.walk, 0.6, 1), x, y, z);
}

/** Nearest point on an x/z polyline; writes it to `out` and returns the distance. */
export function nearestOnPolyline(points: ReadonlyArray<{ readonly x: number; readonly z: number }>, x: number, z: number, out: { x: number; z: number }): number {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1) : 0;
    const px = a.x + dx * t, pz = a.z + dz * t;
    const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (d2 < best) { best = d2; out.x = px; out.z = pz; }
  }
  if (points.length === 1) { out.x = points[0].x; out.z = points[0].z; best = (x - out.x) ** 2 + (z - out.z) ** 2; }
  return Math.sqrt(best);
}
