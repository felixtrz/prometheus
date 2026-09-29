import { ITEMS } from './catalog.js';

/** Bench recipes. Bit index = position in this list (GameState.recipes). */
export const BENCH_RECIPES = [
  { product: 'torch', inputs: ['stick', 'cloth', 'resin'], yields: 1, label: 'Torch' },
  { product: 'spear', inputs: ['stick', 'flint', 'cord'], yields: 1, label: 'Spear' },
  { product: 'bolts', inputs: ['stick', 'stick', 'flint'], yields: 1, label: 'Bolt bundle' },
  { product: 'crossbow', inputs: ['plank', 'cord', 'trigger'], yields: 1, label: 'Crossbow' },
  // The sentry has its own trigger (a second one lies at the outpost lookout): the crossbow stays yours.
  { product: 'sentry-kit', inputs: ['trigger', 'spring', 'plank'], yields: 1, label: 'Sentry kit' },
] as const;

export type BenchRecipe = (typeof BENCH_RECIPES)[number];
export const BOLTS_PER_BUNDLE = 6;
export const SENTRY_CAPACITY = 12;
/** Bolts a freshly deployed sentry comes loaded with: enough to prove it, not to empty a night (reload it mid-night). */
export const SENTRY_STARTER_BOLTS = 3;
/** Bolt tips standing in a sentry's magazine: one per two bolts, and one while any are left. */
export const SENTRY_TIPS = Math.ceil(SENTRY_CAPACITY / 2);
export const sentryTips = (bolts: number) => Math.min(SENTRY_TIPS, Math.max(0, Math.ceil(bolts / 2)));

const sortedKey = (kinds: readonly string[]) => [...kinds].sort().join('+');
const benchIndex = new Map(BENCH_RECIPES.map((recipe, i) => [sortedKey(recipe.inputs), i]));

/** Index of the recipe the three bay kinds make in any order, or -1. */
export function matchBench(kinds: readonly string[]): number {
  if (kinds.length !== 3 || kinds.some((kind) => !kind)) return -1;
  return benchIndex.get(sortedKey(kinds)) ?? -1;
}
export const recipeBit = (index: number) => 1 << index;
export const benchRecipeIndex = (product: string) => BENCH_RECIPES.findIndex((r) => r.product === product);

/** Pot: any two stew ingredients. Value is 1.5× the ingredients, rounded. */
export function stewValue(a: string, b: string): number {
  const value = (kind: string) => (ITEMS as Record<string, { stew?: number }>)[kind]?.stew ?? 0;
  return value(a) && value(b) ? Math.round((value(a) + value(b)) * 1.5) : 0;
}
export const isStewIngredient = (kind: string) => ((ITEMS as Record<string, { stew?: number }>)[kind]?.stew ?? 0) > 0;
/** Stable recipe id for a pair, e.g. 'meat+mushroom'. */
export const stewId = (a: string, b: string) => [a, b].sort().join('+');

const STEW_NAMES: Record<string, string> = {
  'meat+mushroom': 'Hearty stew',
  'meat+meat': 'Hunter’s stew',
  'berries+meat': 'Meat and berry stew',
  'herb+meat': 'Herb broth with meat',
  'mushroom+mushroom': 'Mushroom soup',
  'berries+mushroom': 'Forest soup',
  'herb+mushroom': 'Green soup',
  'berries+berries': 'Berry porridge',
  'berries+herb': 'Meadow tea',
  'herb+herb': 'Bitter tea',
};
export const stewName = (id: string) => STEW_NAMES[id] ?? 'Stew';
/** Stew also mends a little health, more for meat. */
export const stewHealing = (id: string) => (id.includes('meat') ? 20 : 10);
