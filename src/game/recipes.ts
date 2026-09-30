import { ITEMS } from './catalog.js';

/**
 * Bench recipes, three parts each (the bench has three bays). Bit index = position in
 * this list (GameState.recipes): the five products pages teach keep their original bits
 * (saves predate the parts), and the parts (`part: true`) follow. Parts are known from
 * the start: nothing finished lies in the valley, every part is made from gathered stuff.
 */
export const BENCH_RECIPES = [
  { product: 'torch', inputs: ['stick', 'reeds', 'resin'], yields: 1, label: 'Torch', part: false },
  { product: 'spear', inputs: ['stick', 'flint', 'cord'], yields: 1, label: 'Spear', part: false },
  { product: 'bolts', inputs: ['stick', 'stick', 'flint'], yields: 1, label: 'Bolt bundle', part: false },
  { product: 'crossbow', inputs: ['plank', 'limb', 'trigger'], yields: 1, label: 'Crossbow', part: false },
  // The sentry has its own limb and trigger on a log mount: the crossbow stays yours.
  { product: 'sentry-kit', inputs: ['log', 'limb', 'trigger'], yields: 1, label: 'Sentry kit', part: false },
  { product: 'cord', inputs: ['reeds', 'reeds', 'reeds'], yields: 1, label: 'Cord', part: true },
  // A log split on the camp stump gives two planks as well.
  { product: 'plank', inputs: ['stick', 'stick', 'resin'], yields: 1, label: 'Plank', part: true },
  { product: 'trigger', inputs: ['plank', 'stick', 'flint'], yields: 1, label: 'Trigger latch', part: true },
  { product: 'limb', inputs: ['stick', 'cord', 'resin'], yields: 1, label: 'Bow limb', part: true },
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
/** The parts' bits: known from the start, whatever the save says. */
export const PART_RECIPES = BENCH_RECIPES.reduce((mask, recipe, i) => (recipe.part ? mask | recipeBit(i) : mask), 0);
/** Every recipe the keeper knows: the ones pages taught or experiments found, plus the parts. */
export const knownRecipes = (learned: number) => learned | PART_RECIPES;
/** How many of the page-taught products are known (the journal's tally). */
export const PRODUCT_COUNT = BENCH_RECIPES.filter((recipe) => !recipe.part).length;
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
