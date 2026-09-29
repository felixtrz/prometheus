/**
 * Versioned save format. Stored in localStorage (IWSDK has no storage helper).
 * Pure module (no World, no DOM beyond `globalThis.localStorage`): unit-tested in node.
 *
 * A save is only ever *applied* when the player picks Continue on the start panel
 * (StartSystem → StorySystem.applySave). A new journey clears it before the world is
 * reset, and nothing autosaves until the chosen journey has begun.
 */
import { OBJECTIVES, PAGES } from './story.js';

export const SAVE_KEY = 'prometheus.save.v1';

export type SavedItem = {
  uid: string; kind: string; slot: string; variant: string; charges: number; lit: boolean;
  p: [number, number, number]; q: [number, number, number, number];
};

export type SaveData = {
  v: 1;
  savedAt: number;
  game: {
    hunger: number; health: number; clock: number; day: number; stage: number;
    objectives: number; pages: number; recipes: number; respawn: [number, number, number];
    ended: boolean; deaths: number;
    /** Guide lines already spoken (comma-separated ids). Absent in saves from before the guide. */
    guide?: string;
    /** Journey tally for the epilogue: things made at the bench, Hollow slain. Absent in older saves (0). */
    crafted?: number;
    slain?: number;
  };
  fire: { fuel: number; lit: boolean; potA: string; potB: string; stir: number; stew: string };
  pack: { state: string; p: [number, number, number]; yaw: number; lost: boolean } | null;
  items: SavedItem[];
  /** Scene-authored item uids that were consumed (eaten, burned, crafted away). */
  consumed: string[];
  nodes: { id: string; available: boolean; hits: number }[];
  beacons: { id: string; lit: boolean }[];
  sentries: { uid: string; bolts: number }[];
};

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isArray = Array.isArray;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !isArray(value);
const isVector = (value: unknown, length: number): boolean =>
  isArray(value) && value.length === length && value.every(isNumber);

const validItem = (it: unknown): boolean => isObject(it) &&
  isString(it.uid) && isString(it.kind) && isString(it.slot) && isString(it.variant) &&
  isNumber(it.charges) && isBoolean(it.lit) && isVector(it.p, 3) && isVector(it.q, 4);
const validNode = (it: unknown): boolean => isObject(it) && isString(it.id) && isBoolean(it.available) && isNumber(it.hits);
const validBeacon = (it: unknown): boolean => isObject(it) && isString(it.id) && isBoolean(it.lit);
const validSentry = (it: unknown): boolean => isObject(it) && isString(it.uid) && isNumber(it.bolts);
const validPack = (it: unknown): boolean => it === null ||
  (isObject(it) && isString(it.state) && isVector(it.p, 3) && isNumber(it.yaw) && isBoolean(it.lost));

/**
 * Validate a stored save, entry by entry. Anything malformed (hand-edited, truncated,
 * an older or newer format) is treated as "no save", so Continue never applies half a
 * journey. Fields added after v1 shipped (`ended`, `deaths`, `guide`, `pack`, `crafted`,
 * `slain`) default when absent.
 */
export function parseSave(raw: string | null | undefined): SaveData | null {
  if (!raw) return null;
  let data: SaveData;
  try {
    data = JSON.parse(raw) as SaveData;
  } catch {
    return null;
  }
  if (!isObject(data) || data.v !== 1) return null;
  const g = data.game as SaveData['game'] | undefined;
  if (!isObject(g)) return null;
  for (const key of ['hunger', 'health', 'clock', 'day', 'stage', 'objectives', 'pages', 'recipes'] as const) {
    if (!isNumber(g[key])) return null;
  }
  if (!isVector(g.respawn, 3)) return null;
  if (g.ended !== undefined && !isBoolean(g.ended)) return null;
  if (g.deaths !== undefined && !isNumber(g.deaths)) return null;
  if (g.guide !== undefined && !isString(g.guide)) return null;
  if (g.crafted !== undefined && !isNumber(g.crafted)) return null;
  if (g.slain !== undefined && !isNumber(g.slain)) return null;
  g.ended = g.ended === true;
  g.deaths = g.deaths ?? 0;
  g.crafted = g.crafted ?? 0;
  g.slain = g.slain ?? 0;
  const f = data.fire as SaveData['fire'] | undefined;
  if (!isObject(f) || !isNumber(f.fuel) || !isBoolean(f.lit) || !isString(f.potA) || !isString(f.potB) ||
    !isNumber(f.stir) || !isString(f.stew)) return null;
  if (data.pack === undefined) data.pack = null;
  if (!validPack(data.pack)) return null;
  if (!isArray(data.items) || !isArray(data.consumed) || !isArray(data.nodes) || !isArray(data.beacons) || !isArray(data.sentries)) return null;
  if (!data.items.every(validItem) || !data.consumed.every(isString) || !data.nodes.every(validNode) ||
    !data.beacons.every(validBeacon) || !data.sentries.every(validSentry)) return null;
  return data;
}

export function readSave(): SaveData | null {
  try {
    return parseSave(globalThis.localStorage?.getItem(SAVE_KEY));
  } catch {
    return null;
  }
}

export function hasSave(): boolean {
  return readSave() !== null;
}

export function writeSave(data: SaveData): boolean {
  try {
    globalThis.localStorage?.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(): void {
  try {
    globalThis.localStorage?.removeItem(SAVE_KEY);
  } catch {
    // Storage may be unavailable (private mode); a new journey still starts fresh.
  }
}

const bits = (mask: number, count: number) => {
  let n = 0;
  for (let i = 0; i < count; i++) if (mask & (1 << i)) n++;
  return n;
};

export type JourneySummary = {
  day: number;
  objectivesDone: number;
  objectivesTotal: number;
  pagesFound: number;
  pagesTotal: number;
  ended: boolean;
};

export function summarizeSave(save: SaveData): JourneySummary {
  return {
    day: Math.max(1, Math.floor(save.game.day)),
    objectivesDone: bits(save.game.objectives, OBJECTIVES.length),
    objectivesTotal: OBJECTIVES.length,
    pagesFound: bits(save.game.pages, PAGES.length),
    pagesTotal: PAGES.length,
    ended: save.game.ended === true,
  };
}

/** The Continue button's second line: "Day 3 - 4 of 10 objectives - 2 of 7 pages" (ASCII: MSDF fonts). */
export function continueLabel(save: SaveData): string {
  const s = summarizeSave(save);
  if (s.ended) return `Day ${s.day} - the beacon burns`;
  return `Day ${s.day} - ${s.objectivesDone} of ${s.objectivesTotal} objectives - ${s.pagesFound} of ${s.pagesTotal} pages`;
}
