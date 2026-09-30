/**
 * Felling and regrowth rules for the choppable forest. Pure: no World and no Three.js,
 * so node tests cover it. ForestSystem owns the trees, and GatherSystem lands the axe blows.
 *
 * A tree's life after felling runs on one clock, `age` = seconds since it was felled:
 *   falling → lying → sinking (the trunk breaks up into its logs) → stump → growing → standing.
 * The stump shows from the first moment until the sapling sprouts.
 */

export const FELL = {
  /** Axe blows that fell a full-grown tree. */
  hits: 5,
  /** Partial chopping is forgotten after this long (s). */
  forgetSeconds: 25,
  /** The topple, from upright to on the ground (s). */
  fallSeconds: 2.3,
  /** The trunk lies still (and settles after its bounce) this long (s). */
  lieSeconds: 1.2,
  /** Then it sinks away while its logs appear (s). */
  sinkSeconds: .7,
  /** The stump stands alone until a sapling sprouts (s after felling). */
  stumpSeconds: 120,
  /** The sapling grows to full size over this long (s). */
  growSeconds: 480,
  /** The sapling's size when it sprouts (fraction of the full tree). */
  sapling: .12,
  /** Stump height (fraction of the tree's own height, clamped in metres by ForestSystem). */
  stumpHeight: .06,
  /** Angle a felled trunk comes to rest at (rad): slightly short of flat, on its crown. */
  restAngle: Math.PI / 2 - .05,
} as const;

export type TreePhase = 'standing' | 'falling' | 'lying' | 'sinking' | 'stump' | 'growing';

/** Clamp to [0, 1]; NaN (a tree never felled) is 0. */
const clamp01 = (t: number) => (t > 0 ? (t < 1 ? t : 1) : 0);

/** When a felled tree stands full-grown again (s after felling). */
export const REGROWN_AFTER = FELL.stumpSeconds + FELL.growSeconds;

/** The phase of a tree felled `age` seconds ago (NaN or negative: never felled). */
export function treePhase(age: number): TreePhase {
  if (!(age >= 0) || age >= REGROWN_AFTER) return 'standing';
  if (age < FELL.fallSeconds) return 'falling';
  if (age < FELL.fallSeconds + FELL.lieSeconds) return 'lying';
  if (age < FELL.fallSeconds + FELL.lieSeconds + FELL.sinkSeconds) return 'sinking';
  if (age < FELL.stumpSeconds) return 'stump';
  return 'growing';
}

/**
 * The trunk's tilt from upright (rad). It topples like a hinged pole (slowly, then ever
 * faster), bounces once on landing and settles.
 */
export function fallAngle(age: number): number {
  // Upright unless felled and not yet regrowing (the sapling stands straight).
  if (!(age > 0) || age >= FELL.stumpSeconds) return 0;
  if (age < FELL.fallSeconds) {
    const t = age / FELL.fallSeconds;
    return FELL.restAngle * t * t * t;
  }
  const u = (age - FELL.fallSeconds) / .55;
  if (u >= 1) return FELL.restAngle;
  return FELL.restAngle - .09 * Math.sin(Math.PI * u) * (1 - u);
}

/** How far the fallen trunk has sunk away (0 → 1) while it breaks into logs. */
export function sinkFraction(age: number): number {
  if (age >= FELL.stumpSeconds) return 0;
  return clamp01((age - FELL.fallSeconds - FELL.lieSeconds) / FELL.sinkSeconds);
}

/** The regrowing tree's size (fraction of full size); 1 when standing. */
export function growth(age: number): number {
  if (treePhase(age) !== 'growing') return 1;
  const t = clamp01((age - FELL.stumpSeconds) / FELL.growSeconds);
  // Fast at first, easing into full size.
  return FELL.sapling + (1 - FELL.sapling) * (1 - (1 - t) * (1 - t));
}

/** Whether the trunk is drawn at all (hidden once it has sunk away, until the sapling sprouts). */
export function trunkShown(age: number): boolean {
  const phase = treePhase(age);
  return phase !== 'stump';
}

/** Whether the stump is drawn. */
export function stumpShown(age: number): boolean {
  return age >= 0 && age < FELL.stumpSeconds;
}

/** What a felled tree yields: logs by trunk size, sticks from its crown. */
export function fellYield(height: number, broadleaf: boolean): { logs: number; sticks: number } {
  return { logs: height >= 5 ? 2 : 1, sticks: broadleaf ? 3 : 2 };
}

/** A tree's save key: its trunk position to the decimetre (stable across loads and scene edits elsewhere). */
export function treeKey(x: number, z: number): string {
  return `${Math.round(x * 10)}:${Math.round(z * 10)}`;
}

/** One felled tree in a save: its key and how long ago it was felled (s). */
export type SavedTree = { k: string; t: number };

/** Saved felled trees, dropping any that have fully regrown by now. */
export function saveTrees(felled: Iterable<{ key: string; age: number }>): SavedTree[] {
  const out: SavedTree[] = [];
  for (const tree of felled) {
    if (tree.age >= 0 && tree.age < REGROWN_AFTER) out.push({ k: tree.key, t: Math.round(tree.age * 10) / 10 });
  }
  return out;
}

export function validSavedTree(value: unknown): value is SavedTree {
  const tree = value as SavedTree | null;
  return !!tree && typeof tree === 'object' && typeof tree.k === 'string' && typeof tree.t === 'number' && Number.isFinite(tree.t);
}
