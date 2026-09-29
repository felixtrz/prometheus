/**
 * Game component declarations. System-free: systems import these, never the
 * reverse. Registered for the editor in src/components.ts.
 */
import { createComponent, Types } from '@iwsdk/core';

/**
 * Anything the player can pick up. `slot` says where it currently lives:
 * '' loose in the world, 'pot', 'fire', 'bay-0..2', 'pack-0..8', 'lost-<n>',
 * 'sentry', 'consumed'. `charges` is kind-specific (bolts loaded, bundle size,
 * stew servings); `lit` covers torch/lighter flames; `uid` survives save/load.
 */
export const Item = createComponent('Item', {
  kind: { type: Types.String, default: '' },
  slot: { type: Types.String, default: '' },
  charges: { type: Types.Int16, default: 0 },
  lit: { type: Types.Boolean, default: false },
  variant: { type: Types.String, default: '' },
  uid: { type: Types.String, default: '' },
});

/** Loose item in flight (dropped or thrown). Removed when it comes to rest. */
export const Airborne = createComponent('Airborne', {
  velocity: { type: Types.Vec3, default: [0, 0, 0] },
  spin: { type: Types.Vec3, default: [0, 0, 0] },
  /** >0 while travelling fast enough to hurt a creature. */
  damage: { type: Types.Int8, default: 0 },
  age: { type: Types.Float32, default: 0 },
});

export const Campfire = createComponent('Campfire', {
  fuel: { type: Types.Float32, default: 90 },
  lit: { type: Types.Boolean, default: false },
  potA: { type: Types.String, default: '' },
  potB: { type: Types.String, default: '' },
  stir: { type: Types.Float32, default: 0 },
  /** Recipe id of the finished stew waiting in the pot ('' when none). */
  stew: { type: Types.String, default: '' },
  servings: { type: Types.Int8, default: 0 },
});

export const CraftBench = createComponent('CraftBench', {
  strikes: { type: Types.Int8, default: 0 },
  /** Product id matched by the current bay contents ('' none, '!' invalid set). */
  match: { type: Types.String, default: '' },
});

export const Backpack = createComponent('Backpack', {
  /** 'unrolled' | 'held' | 'worn' */
  state: { type: Types.String, default: 'unrolled' },
});

/** Harvestable world feature: deadwood, resin, mushrooms, berries, reeds, flint. */
export const ResourceNode = createComponent('ResourceNode', {
  kind: { type: Types.String, default: 'deadwood' },
  /** Item kinds produced, comma separated, e.g. 'log,stick,stick'. */
  yields: { type: Types.String, default: 'stick' },
  hitsNeeded: { type: Types.Int8, default: 0 },
  hits: { type: Types.Int8, default: 0 },
  available: { type: Types.Boolean, default: true },
  regrowAt: { type: Types.Float32, default: 0 },
  regrowSeconds: { type: Types.Float32, default: 180 },
});

export const Creature = createComponent('Creature', {
  species: { type: Types.String, default: 'deer' },
  health: { type: Types.Float32, default: 1 },
  mode: { type: Types.String, default: 'idle' },
  timer: { type: Types.Float32, default: 0 },
  heading: { type: Types.Float32, default: 0 },
  speed: { type: Types.Float32, default: 0 },
  home: { type: Types.Vec3, default: [0, 0, 0] },
});

/** Scene-authored herd or pack anchor; the creature system spawns around it. */
export const CreatureSpawn = createComponent('CreatureSpawn', {
  species: { type: Types.String, default: 'deer' },
  count: { type: Types.Int8, default: 2 },
  radius: { type: Types.Float32, default: 4 },
  /** Wolves only: minimum danger stage before this anchor is used. */
  minStage: { type: Types.Int8, default: 0 },
});

export const Sentry = createComponent('Sentry', {
  bolts: { type: Types.Int8, default: 0 },
  cooldown: { type: Types.Float32, default: 0 },
  yaw: { type: Types.Float32, default: 0 },
});

export const Page = createComponent('Page', {
  index: { type: Types.Int8, default: 1 },
});

/** 'spire' is the finale brazier; 'echo' braziers relight across the valley at the ending. */
export const Beacon = createComponent('Beacon', {
  role: { type: Types.String, default: 'spire' },
  lit: { type: Types.Boolean, default: false },
  progress: { type: Types.Float32, default: 0 },
});

/** Held in a hand (the Item system's own grab; replaces IWSDK Grabbed for items). */
export const Held = createComponent('Held', {
  hand: { type: Types.String, default: 'right' },
});

/**
 * A prop whose top face catches dropped items (crates, tables, benches). Items
 * rest on its bounds' top; `inset` shrinks the footprint so things don't balance
 * on an edge, `lift` nudges the resting height (e.g. a lid rim).
 */
export const ItemSurface = createComponent('ItemSurface', {
  inset: { type: Types.Float32, default: 0.03 },
  lift: { type: Types.Float32, default: 0 },
});

export const Bedroll = createComponent('Bedroll', {});
export const LostPack = createComponent('LostPack', {
  index: { type: Types.Int8, default: 0 },
});
export const FireVisual = createComponent('FireVisual', {});

/** Singleton on the scene's 'game' node. Bitmasks index into story.ts tables. */
export const GameState = createComponent('GameState', {
  hunger: { type: Types.Float32, default: 70 },
  health: { type: Types.Float32, default: 100 },
  /** Seconds into the current day cycle (see DAY in rules.ts). */
  clock: { type: Types.Float32, default: 40 },
  day: { type: Types.Int16, default: 1 },
  stage: { type: Types.Int8, default: 0 },
  objectives: { type: Types.Int32, default: 0 },
  pages: { type: Types.Int16, default: 0 },
  recipes: { type: Types.Int16, default: 0 },
  respawn: { type: Types.Vec3, default: [0, 0, 0.4] },
  ended: { type: Types.Boolean, default: false },
  deaths: { type: Types.Int16, default: 0 },
  revision: { type: Types.Int32, default: 0 },
  /** Guide lines already spoken this journey (comma-separated ids, see voice-lines.ts). */
  guide: { type: Types.String, default: '' },
});
