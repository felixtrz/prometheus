/**
 * Player comfort settings, per device (localStorage), shared by the journal's
 * settings panel (writer) and the systems that honour them (readers). Plain data and
 * a tiny listener set: no World, safe to import anywhere.
 */
export type MoveSpeed = 'slow' | 'normal';
export type TurnMode = 'snap' | 'smooth';

export type Settings = {
  /** Thumbstick walking speed: slow 1.8 m/s, normal 2.6 m/s. */
  moveSpeed: MoveSpeed;
  /** Comfort tunnel (vignette) while sliding. */
  tunnel: boolean;
  /** Right-stick turning: 45° snaps (comfortable) or smooth rotation. */
  turn: TurnMode;
  /** Softer damage/heartbeat vignette: no flashes, a dim rim only. */
  reduceFlashes: boolean;
  /** Show the shade's subtitles (voice still plays). */
  subtitles: boolean;
};

export const SETTINGS_KEY = 'prometheus.settings.v1';
export const DEFAULT_SETTINGS: Readonly<Settings> = { moveSpeed: 'normal', tunnel: true, turn: 'snap', reduceFlashes: false, subtitles: true };
export const MOVE_SPEED: Record<MoveSpeed, number> = { slow: 1.8, normal: 2.6 };
/** Comfort tunnel strength when on (IWSDK SlideSystem comfortAssist). */
export const TUNNEL_STRENGTH = 0.55;

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

function load(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<Settings> : {};
    return {
      moveSpeed: parsed.moveSpeed === 'slow' ? 'slow' : 'normal',
      tunnel: typeof parsed.tunnel === 'boolean' ? parsed.tunnel : DEFAULT_SETTINGS.tunnel,
      turn: parsed.turn === 'smooth' ? 'smooth' : 'snap',
      // Until the player chooses, follow the system's reduced-motion preference.
      reduceFlashes: typeof parsed.reduceFlashes === 'boolean' ? parsed.reduceFlashes : prefersReducedMotion(),
      subtitles: typeof parsed.subtitles === 'boolean' ? parsed.subtitles : DEFAULT_SETTINGS.subtitles,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** The live settings object: read it anywhere; change it only through `updateSettings`. */
export const settings: Settings = load();
const listeners = new Set<(settings: Readonly<Settings>) => void>();

export function updateSettings(patch: Partial<Settings>): void {
  Object.assign(settings, patch);
  try {
    globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked: the change still applies for this session.
  }
  for (const listener of listeners) listener(settings);
}

/** Returns the unsubscribe function; push it into a system's cleanupFuncs. */
export function onSettings(listener: (settings: Readonly<Settings>) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
