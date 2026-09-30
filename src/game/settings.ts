/**
 * Player comfort settings, per device (localStorage), shared by the comfort controls
 * (journal board, start panel, wrist: writers through `cycleSetting`) and the systems that
 * honour them (readers). Plain data and a tiny listener set: no World, safe to import anywhere.
 */
export type MoveSpeed = 'slow' | 'normal' | 'fast';
export type TunnelLevel = 'off' | 'on' | 'strong';
export type TurnMode = 'snap30' | 'snap45' | 'smooth';

export type Settings = {
  /** Thumbstick walking speed: slow 1.8, normal 2.6, fast 3.2 m/s. */
  moveSpeed: MoveSpeed;
  /** Comfort tunnel (vignette) while sliding: off, on (0.55) or strong (0.8). */
  tunnel: TunnelLevel;
  /** Right-stick turning: 30° or 45° snaps (comfortable) or smooth rotation. */
  turn: TurnMode;
  /** Softer damage/heartbeat vignette: no flashes, a dim rim only. */
  reduceFlashes: boolean;
  /** Show the shade's subtitles (voice still plays). */
  subtitles: boolean;
};

export const SETTINGS_KEY = 'prometheus.settings.v1';
export const DEFAULT_SETTINGS: Readonly<Settings> = { moveSpeed: 'normal', tunnel: 'on', turn: 'snap45', reduceFlashes: false, subtitles: true };
export const MOVE_SPEED: Record<MoveSpeed, number> = { slow: 1.8, normal: 2.6, fast: 3.2 };
/** Comfort tunnel strength per level (IWSDK SlideSystem comfortAssist). */
export const TUNNEL_STRENGTH: Record<TunnelLevel, number> = { off: 0, on: 0.55, strong: 0.8 };
/** Snap-turn angle in degrees (IWSDK LocomotionSystem turningAngle); smooth keeps the last snap angle. */
export const TURN_ANGLE: Record<TurnMode, number> = { snap30: 30, snap45: 45, smooth: 45 };

function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/** Each setting's choices in tap order. */
const MOVE_SPEEDS: readonly MoveSpeed[] = ['slow', 'normal', 'fast'];
const TUNNEL_LEVELS: readonly TunnelLevel[] = ['off', 'on', 'strong'];
const TURN_MODES: readonly TurnMode[] = ['snap30', 'snap45', 'smooth'];

const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | undefined =>
  options.includes(value as T) ? value as T : undefined;

/** Accepts both the current values and the older saves (tunnel as a boolean, turn 'snap'). */
export function parseSettings(raw: Record<string, unknown>, reducedMotion = false): Settings {
  const tunnel = typeof raw.tunnel === 'boolean' ? (raw.tunnel ? 'on' : 'off') : raw.tunnel;
  const turn = raw.turn === 'snap' ? 'snap45' : raw.turn;
  return {
    moveSpeed: oneOf(raw.moveSpeed, MOVE_SPEEDS) ?? DEFAULT_SETTINGS.moveSpeed,
    tunnel: oneOf(tunnel, TUNNEL_LEVELS) ?? DEFAULT_SETTINGS.tunnel,
    turn: oneOf(turn, TURN_MODES) ?? DEFAULT_SETTINGS.turn,
    // Until the player chooses, follow the system's reduced-motion preference.
    reduceFlashes: typeof raw.reduceFlashes === 'boolean' ? raw.reduceFlashes : reducedMotion,
    subtitles: typeof raw.subtitles === 'boolean' ? raw.subtitles : DEFAULT_SETTINGS.subtitles,
  };
}

function load(): Settings {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parseSettings(parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}, prefersReducedMotion());
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** The live settings object: read it anywhere; change it only through `updateSettings` / `cycleSetting`. */
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

/* ------------------------------------------------------------------------------------------
 * Comfort controls: every UI (journal board, start panel, wrist) writes and labels the
 * settings through these, so a tap means the same thing everywhere.
 * ---------------------------------------------------------------------------------------- */

/** One tappable comfort control. */
export type ComfortKey = 'speed' | 'tunnel' | 'turn' | 'flashes' | 'subs';

const next = <T>(options: readonly T[], value: T): T => options[(options.indexOf(value) + 1) % options.length];

/** One tap: step the setting to its next choice (speed slow -> normal -> fast, tunnel off -> on -> strong, turn 30 -> 45 -> smooth). */
export function cycleSetting(key: ComfortKey): void {
  switch (key) {
    case 'speed': updateSettings({ moveSpeed: next(MOVE_SPEEDS, settings.moveSpeed) }); break;
    case 'tunnel': updateSettings({ tunnel: next(TUNNEL_LEVELS, settings.tunnel) }); break;
    case 'turn': updateSettings({ turn: next(TURN_MODES, settings.turn) }); break;
    case 'flashes': updateSettings({ reduceFlashes: !settings.reduceFlashes }); break;
    case 'subs': updateSettings({ subtitles: !settings.subtitles }); break;
  }
}

const SPEED_TEXT: Record<MoveSpeed, string> = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };
const TUNNEL_TEXT: Record<TunnelLevel, string> = { off: 'Off', on: 'On', strong: 'Strong' };
/** Plain Latin-1 (the bundled MSDF fonts carry the degree sign). */
const TURN_TEXT: Record<TurnMode, string> = { snap30: 'Snap 30°', snap45: 'Snap 45°', smooth: 'Smooth' };
/** The wrist's narrow chips ("TURN 45°"). */
const TURN_SHORT: Record<TurnMode, string> = { snap30: '30°', snap45: '45°', smooth: 'Smooth' };

/** The control's current value as shown on a chip (`short`: the wrist's narrow form). */
export function settingText(key: ComfortKey, short = false): string {
  switch (key) {
    case 'speed': return SPEED_TEXT[settings.moveSpeed];
    case 'tunnel': return TUNNEL_TEXT[settings.tunnel];
    case 'turn': return (short ? TURN_SHORT : TURN_TEXT)[settings.turn];
    case 'flashes': return settings.reduceFlashes ? 'On' : 'Off';
    case 'subs': return settings.subtitles ? 'On' : 'Off';
  }
}

/** Whether the chip shows its value lit (gold) rather than quiet: anything but "off" (speed is always lit). */
export function settingLit(key: ComfortKey): boolean {
  switch (key) {
    case 'speed': return true;
    case 'tunnel': return settings.tunnel !== 'off';
    case 'turn': return true;
    case 'flashes': return settings.reduceFlashes;
    case 'subs': return settings.subtitles;
  }
}
