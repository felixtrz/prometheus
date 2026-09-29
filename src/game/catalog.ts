/**
 * Item kinds: pure data shared by systems, save/load and tests. Tool tips are in
 * the prototype's local space (origin at the grip, +Y along the handle).
 */
/** 'side' lays local Y along X (rotate about Z); 'side-x' rotates about X instead. */
export type Lie = 'side' | 'side-x' | 'upright' | 'flat';
/**
 * How an item sits in the hand, snapped on grab. Frames are relative to the grip
 * (palm at the origin; the fist's -Z runs forward-up 45° when the controller points
 * level):
 * - 'tool': local +Y runs out of the fist along -Z — handle in hand, head past the
 *   thumb; `roll` (degrees) turns it about the handle; `flip` points local -Y out instead.
 * - 'level': local axes follow the pointing ray (-Z forward, +Y up for a level hand).
 * - 'spear': local +Y along the pointing ray, a shaft held for thrusting.
 * - 'page': face turned to the eyes, held by its bottom edge.
 * - 'carry': level, hanging from the top of its bounds (handles).
 * `at` is the local point that lands in the palm (default: origin).
 */
export type Hold = {
  frame: 'tool' | 'level' | 'spear' | 'page' | 'carry'; at?: [number, number, number]; roll?: number;
  /** 'tool' only: local -Y runs out of the fist instead (a spoon's bowl past the thumb). */
  flip?: boolean;
};
export type ItemInfo = {
  asset: string;
  label: string;
  /** Hunger restored when eaten directly (0 = not edible raw). */
  food?: number;
  /** Stew contribution when released into the pot. */
  stew?: number;
  /** Fuel added when released into a lit or cold fire ring. Only wood burns: crafting materials never do. */
  fuel?: number;
  lie: Lie;
  /** Origin height above the ground when resting. */
  restY: number;
  /** Local-space working point: spoon bowl, blade, flame, muzzle… */
  tip?: [number, number, number];
  hold: Hold;
};

export const ITEMS = {
  stick: { asset: 'stick', label: 'Stick', fuel: 10, lie: 'side', restY: .045, hold: { frame: 'tool' } },
  log: { asset: 'log', label: 'Firewood', fuel: 35, lie: 'side', restY: .081, hold: { frame: 'tool' } },
  plank: { asset: 'plank', label: 'Plank', lie: 'side', restY: .019, hold: { frame: 'tool', at: [0, -.08, 0] } },
  cloth: { asset: 'cloth', label: 'Cloth', lie: 'flat', restY: .112, hold: { frame: 'level' } },
  resin: { asset: 'resin', label: 'Resin', lie: 'upright', restY: .04, hold: { frame: 'level' } },
  flint: { asset: 'flint', label: 'Flint', lie: 'flat', restY: .018, hold: { frame: 'level' } },
  cord: { asset: 'cord', label: 'Cord', lie: 'flat', restY: .02, hold: { frame: 'level' } },
  trigger: { asset: 'trigger', label: 'Trigger mechanism', lie: 'flat', restY: .019, hold: { frame: 'level', at: [0, 0, .03] } },
  spring: { asset: 'spring', label: 'Iron spring', lie: 'flat', restY: .029, hold: { frame: 'level' } },
  // variant 'roast' after 3 s in the flame (ROAST_FOOD); the prototype holds both looks.
  meat: { asset: 'meat', label: 'Raw meat', food: 5, stew: 25, lie: 'flat', restY: .036, hold: { frame: 'level', at: [.02, 0, 0] } },
  mushroom: { asset: 'mushroom', label: 'Mushroom', food: 6, stew: 15, lie: 'upright', restY: .104, hold: { frame: 'level', at: [0, -.05, 0] } },
  berries: { asset: 'berries', label: 'Berries', food: 8, stew: 12, lie: 'flat', restY: .009, hold: { frame: 'level' } },
  herb: { asset: 'herb', label: 'Wild herb', food: 4, stew: 10, lie: 'flat', restY: .013, hold: { frame: 'level' } },
  bowl: { asset: 'stew-bowl', label: 'Bowl', lie: 'upright', restY: .06, hold: { frame: 'level', at: [0, -.05, 0] } },
  spoon: { asset: 'spoon', label: 'Spoon', lie: 'side', restY: .025, tip: [0, -.28, 0], hold: { frame: 'tool', at: [0, .17, 0], flip: true } },
  hammer: { asset: 'hammer', label: 'Hammer', lie: 'side-x', restY: .042, tip: [-.123, .22, 0], hold: { frame: 'tool', at: [0, -.17, 0], roll: 90 } },
  axe: { asset: 'axe', label: 'Axe', lie: 'side', restY: .02, tip: [0, .28, -.117], hold: { frame: 'tool', at: [0, -.2, 0] } },
  lighter: { asset: 'lighter', label: 'Lighter', lie: 'upright', restY: .049, tip: [0, .07, 0], hold: { frame: 'level', at: [0, .01, 0] } },
  torch: { asset: 'torch', label: 'Torch', lie: 'side', restY: .087, tip: [0, .32, 0], hold: { frame: 'tool', at: [0, -.12, 0] } },
  spear: { asset: 'spear', label: 'Spear', lie: 'side', restY: .025, tip: [0, .97, 0], hold: { frame: 'spear', at: [0, -.05, 0] } },
  crossbow: { asset: 'crossbow', label: 'Crossbow', lie: 'flat', restY: .054, tip: [0, .05, -.42], hold: { frame: 'level', at: [0, -.03, .12] } },
  bolts: { asset: 'bolt-bundle', label: 'Bolt bundle', lie: 'side', restY: .024, hold: { frame: 'tool' } },
  'sentry-kit': { asset: 'sentry-kit', label: 'Sentry kit', lie: 'upright', restY: 0, hold: { frame: 'carry' } },
  page: { asset: 'page', label: 'Journal page', lie: 'flat', restY: .003, hold: { frame: 'page', at: [0, 0, .09] } },
  /** The backpack's roll: its grab handle. BackpackSystem owns every release. */
  pack: { asset: 'pack-roll', label: 'Backpack', lie: 'flat', restY: .107, hold: { frame: 'carry' } },
} as const satisfies Record<string, ItemInfo>;

export type ItemKind = keyof typeof ITEMS;
export const isItemKind = (kind: string): kind is ItemKind => kind in ITEMS;
export const itemInfo = (kind: string): ItemInfo | undefined =>
  isItemKind(kind) ? ITEMS[kind] : undefined;

export const ROAST_FOOD = 35;

/**
 * Visual variants toggled by name inside one prototype, so state changes never
 * swap entities mid-grip: meat 'raw'|'roast', bowl 'empty'|<stew id>,
 * sentry-kit 'kit'|'deployed'. Bowls toggle their 'bowl-contents' group.
 */
export const VARIANT_NODES = { meat: ['raw', 'roast'], 'sentry-kit': ['kit', 'deployed'] } as const;

/** Tools stay with the player: they never burn or cook when released near fire. */
export const TOOLS: ReadonlySet<string> = new Set(['spoon', 'hammer', 'axe', 'lighter', 'bowl', 'crossbow', 'spear', 'sentry-kit', 'page']);
