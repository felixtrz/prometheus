/**
 * Runtime-only game event bus. Systems emit semantic events; audio, UI and story
 * listen. Never imported by the asset or component manifests.
 */
export type GameEvent =
  | { type: 'grab'; kind: string; x: number; y: number; z: number }
  | { type: 'drop'; kind: string; x: number; y: number; z: number; hard: boolean }
  | { type: 'snap'; kind: string; target: string; x: number; y: number; z: number }
  | { type: 'reject'; kind: string; reason: string; x: number; y: number; z: number }
  | { type: 'lighter'; lit: boolean; x: number; y: number; z: number }
  | { type: 'fire-lit'; x: number; y: number; z: number }
  | { type: 'fire-out'; x: number; y: number; z: number }
  | { type: 'fuel-added'; kind: string; fuel: number }
  | { type: 'ingredient'; kind: string; x: number; y: number; z: number }
  | { type: 'stir'; progress: number }
  | { type: 'stew-ready'; recipe: string }
  | { type: 'bowl-filled'; recipe: string }
  | { type: 'roasted'; x: number; y: number; z: number }
  | { type: 'eat'; kind: string; hunger: number }
  | { type: 'strike'; count: number; valid: boolean; x: number; y: number; z: number }
  | { type: 'crafted'; product: string; learned: boolean; x: number; y: number; z: number }
  | { type: 'chop'; node: string; remaining: number; x: number; y: number; z: number }
  | { type: 'harvest'; kind: string; x: number; y: number; z: number }
  | { type: 'torch-lit'; x: number; y: number; z: number }
  | { type: 'pack'; state: string; x: number; y: number; z: number }
  | { type: 'page'; index: number; first: boolean }
  | { type: 'recipe-learned'; product: string }
  | { type: 'objective'; index: number }
  | { type: 'throw'; kind: string; speed: number; x: number; y: number; z: number }
  | { type: 'hit'; kind: string; species: string; killed: boolean; x: number; y: number; z: number }
  | { type: 'crossbow-fire'; loaded: number; x: number; y: number; z: number }
  | { type: 'crossbow-empty'; x: number; y: number; z: number }
  | { type: 'reload'; charges: number; x: number; y: number; z: number }
  | { type: 'sentry-deployed'; x: number; y: number; z: number }
  | { type: 'sentry-fire'; x: number; y: number; z: number }
  | { type: 'creature'; species: string; cue: 'howl' | 'growl' | 'flee' | 'bite' | 'dissolve' | 'spawn' | 'stalk' | 'yelp'; x: number; y: number; z: number }
  /** `x`/`z`: where the harm came from (a biting wolf), for directional feedback. */
  | { type: 'hurt'; amount: number; cause: string; x?: number; z?: number }
  | { type: 'death'; x: number; y: number; z: number }
  | { type: 'respawn'; x: number; y: number; z: number }
  | { type: 'phase'; phase: 'day' | 'dusk' | 'night' | 'dawn'; day: number }
  /** `cold`: slept beside a dead fire (allowed, but the player wakes hurt and hungry). */
  | { type: 'sleep'; day: number; cold?: boolean }
  | { type: 'stage'; stage: number }
  | { type: 'beacon'; progress: number; lit: boolean }
  | { type: 'ending' }
  /** `text` is the title; optional `body` line and `hold` seconds (default scales with length). */
  | { type: 'toast'; text: string; tone: 'info' | 'good' | 'warn'; body?: string; hold?: number }
  /** A tool hit something that isn't a target (hammer off the pad, axe glancing, bolt into the ground). */
  | { type: 'thud'; kind: string; x: number; y: number; z: number }
  /** All three bench bays are filled: `product` is '' for an invalid set. */
  | { type: 'bench-set'; product: string; valid: boolean; known: boolean }
  /** Wolves circling the lit fire are draining it (first time each night). */
  | { type: 'fire-smothered'; rate: number }
  | { type: 'brazier-lit'; role: string; x: number; y: number; z: number }
  /** Finale sequence beats, in order (see StorySystem). */
  | { type: 'ending-step'; step: 'spire-eye' | 'dawn' | 'outpost' | 'grove' | 'camp' | 'theme' | 'smoke' }
  /** The player first sees the world in this journey (XR entered, or desktop view ready). */
  | { type: 'journey-start'; resumed: boolean }
  | { type: 'new-game' }
  /** A deployed sentry tried to fire with an empty magazine. */
  | { type: 'sentry-empty'; x: number; y: number; z: number }
  /**
   * The guide (Prometheus' shade) spoke a line; `text` is the subtitle, `hint` a subtitle-only control hint,
   * `voiced` whether a clip actually plays (the audio ducks only then; subtitle-only lines leave the world as it is).
   */
  | { type: 'guide'; id: string; text: string; seconds: number; hint?: string; voiced?: boolean }
  /** The guide's line ended: spoken through, or `cut` short (a wolf, a fade, a page picked up). */
  | { type: 'guide-end'; id: string; cut: boolean }
  /** The start screen closed: a fresh journey or a resumed save begins. */
  | { type: 'journey-begin'; resumed: boolean }
  /** The Spire hold began (`active`) or ended (abandoned, or the beacon caught): the Hollow bring the dark. */
  | { type: 'finale-hold'; active: boolean }
  /** A finale guardian wave (1-based) of `count` wolves is rising round the Spire. */
  | { type: 'finale-wave'; wave: number; count: number }
  /** A stew was eaten: well fed for `seconds` (0 when it wears off, at death, or on a new journey). */
  | { type: 'well-fed'; seconds: number }
  /**
   * Finale guardians crouched at the Spire brazier, draining the hold: `count` pressing now
   * (0 = the press is lifted), `joined` when one more has just started. Emitted on change only.
   */
  | { type: 'beacon-pressed'; count: number; joined: boolean }
  /**
   * The ending has played out (the farewell spoken): the journey's tally for the journal's
   * epilogue and its New journey prompt. Also readable any time as StorySystem.stats.
   */
  | { type: 'epilogue'; days: number; deaths: number; crafted: number; slain: number }
  /** Request (not a notification): ItemSystem spawns a loose item here. */
  | { type: 'spawn-item'; kind: string; x: number; y: number; z: number; variant?: string; charges?: number; vx?: number; vy?: number; vz?: number };

export type GameEventType = GameEvent['type'];
type Listener<T extends GameEventType> = (event: Extract<GameEvent, { type: T }>) => void;

class GameBus {
  private listeners = new Map<string, Set<(event: GameEvent) => void>>();
  private any = new Set<(event: GameEvent) => void>();

  emit(event: GameEvent): void {
    // One failing listener must never starve the rest (e.g. the ones that unfreeze the world).
    for (const listener of this.any) this.call(listener, event);
    const set = this.listeners.get(event.type);
    if (set) for (const listener of set) this.call(listener, event);
  }

  private call(listener: (event: GameEvent) => void, event: GameEvent): void {
    try {
      listener(event);
    } catch (error) {
      console.error('[Prometheus] bus listener failed', event.type, error);
    }
  }

  /** Returns the unsubscribe function; push it into a system's cleanupFuncs. */
  on<T extends GameEventType>(type: T, listener: Listener<T>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, set = new Set());
    const wrapped = listener as (event: GameEvent) => void;
    set.add(wrapped);
    return () => set!.delete(wrapped);
  }

  onAny(listener: (event: GameEvent) => void): () => void {
    this.any.add(listener);
    return () => this.any.delete(listener);
  }
}

export const bus = new GameBus();
