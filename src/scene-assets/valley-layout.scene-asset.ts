/**
 * Valley placement plan (pure data, no Three.js): the single source for scene node
 * positions in public/scenes/modules/valley*.iwsdk.scene.json and for everything the
 * ground bakes around them (dirt trails, contact shadows, clearings). Follows
 * design/concept/layout.svg. Deterministic: evaluated by the runtime and the editor.
 */
import { brookHit, brookNearest, LANDMARKS, terrainHeight, WORLD_BOUNDS } from '../game/terrain.js';
import { FOREST_MUSHROOMS, JOURNEY_TRAIL, journeyBlocksTree } from '../game/journey.js';

export type XZ = { x: number; z: number };
type Pine = XZ & { asset: 'pine-1' | 'pine-2'; scale: number; yawDeg: number; id: string };

/** Seeded PRNG (mulberry32) so every realm generates identical scatter. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function catmull(points: XZ[], spacing = .5): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    const steps = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / spacing));
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), z: cr(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------- trails
/** Trail centrelines (control points); `halfWidth` is the painted dirt half-width. */
export const TRAIL_CONTROL = {
  main: [{ x: -.15, z: -2.6 }, { x: 0, z: -5 }, { x: .8, z: -8 }, { x: 1.5, z: -12.5 }, { x: .8, z: -18 }, { x: -1.4, z: -24.5 }, { x: -3, z: -29.2 },
    { x: -2.6, z: -33.2 }, { x: -2.2, z: -37.4 }, { x: .2, z: -42.6 }, { x: 3.1, z: -47.4 }, { x: 4.6, z: -50.4 }, { x: 5, z: -51.2 }],
  grove: [{ x: .8, z: -8 }, { x: -3.5, z: -9.4 }, { x: -8.5, z: -10.2 }, { x: -13.2, z: -10.6 }, { x: -15.2, z: -11 }],
  meadow: [{ x: 1.5, z: -12.5 }, { x: 5.5, z: -12.9 }, { x: 9.5, z: -14 }, { x: 13.4, z: -15 }, { x: 16.9, z: -12.6 }, { x: 18.7, z: -11.4 }],
  east: [{ x: 23.3, z: -11.2 }, { x: 25.6, z: -10.4 }, { x: 27.4, z: -9 }],
  /** The opening journey: wreck door → waystation → the grove trail (src/game/journey.ts). */
  journey: [...JOURNEY_TRAIL],
} satisfies Record<string, XZ[]>;
export const TRAIL_HALF_WIDTH = { main: 1.05, grove: .72, meadow: .72, east: .6, journey: .72 } as const;
export const TRAILS = Object.fromEntries(Object.entries(TRAIL_CONTROL).map(([k, v]) => [k, catmull(v, .45)])) as Record<keyof typeof TRAIL_CONTROL, XZ[]>;

const trailSegments: { ax: number; az: number; dx: number; dz: number; len2: number; half: number; key: string; s0: number; len: number }[] = [];
for (const key of Object.keys(TRAILS) as (keyof typeof TRAILS)[]) {
  const pts = TRAILS[key];
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x, dz = pts[i + 1].z - pts[i].z, len2 = dx * dx + dz * dz;
    if (len2 < 1e-6) continue;
    trailSegments.push({ ax: pts[i].x, az: pts[i].z, dx, dz, len2, half: TRAIL_HALF_WIDTH[key], key, s0: s, len: Math.sqrt(len2) });
    s += Math.sqrt(len2);
  }
}
/** Result of the last `trailNearest` call. `edge` = distance / half-width (1 = dirt edge). */
export const trailHit = { distance: 99, edge: 99, key: '', along: 0 };
export function trailNearest(x: number, z: number, skip?: keyof typeof TRAIL_CONTROL): number {
  let best = 1e9, bestEdge = 1e9, key = '', along = 0;
  for (const seg of trailSegments) {
    if (seg.key === skip) continue;
    // Cheap reject: segments are ≤ 0.5 m long, so a far start point can't beat the current best.
    const ex = x - seg.ax, ez = z - seg.az;
    if (Math.max(Math.abs(ex), Math.abs(ez)) - .6 > bestEdge * seg.half) continue;
    const t = Math.min(1, Math.max(0, (ex * seg.dx + ez * seg.dz) / seg.len2));
    const px = seg.ax + seg.dx * t - x, pz = seg.az + seg.dz * t - z;
    const d = Math.sqrt(px * px + pz * pz), edge = d / seg.half;
    if (edge < bestEdge) { bestEdge = edge; best = d; key = seg.key; along = seg.s0 + t * seg.len; }
  }
  trailHit.distance = best; trailHit.edge = bestEdge; trailHit.key = key; trailHit.along = along;
  return best;
}

/** Distance from (x, z) to one trail's centreline (m). */
export function trailDistance(x: number, z: number, key: keyof typeof TRAIL_CONTROL): number {
  let best = 1e9;
  for (const seg of trailSegments) {
    if (seg.key !== key) continue;
    const t = Math.min(1, Math.max(0, ((x - seg.ax) * seg.dx + (z - seg.az) * seg.dz) / seg.len2));
    best = Math.min(best, Math.hypot(seg.ax + seg.dx * t - x, seg.az + seg.dz * t - z));
  }
  return best;
}

// ------------------------------------------------------------------------ key places
export const GROVE = {
  centre: LANDMARKS.grove,
  /** Resin pines: trunk centres. The 'resin-scar' faces the clearing at 1.2 m. */
  resinPines: [{ x: -20.6, z: -13.6 }, { x: -14.6, z: -14.4 }, { x: -19.8, z: -7.4 }],
  /** Open glades kept clear of trees (where fallen trunks once lay; the tree scatter keeps them). */
  glades: [{ x: -17.4, z: -6 }, { x: -22.6, z: -10.4 }, { x: -12, z: -13 }],
  mushrooms: [{ x: -16, z: -12.9 }, { x: -19, z: -10.2 }, { x: -21.4, z: -15.8 }],
  /** Page 3 lies on this stump (scene node 'grove-stump', ItemSurface). */
  stump: { x: -16.6, z: -10, top: .46, radius: .3 },
  brazier: { x: -14.3, z: -12.1 },
  rabbits: { x: -10.8, z: -16.2 },
};
export const MEADOW = {
  centre: LANDMARKS.meadow,
  /** Bush ground centres; the berry spawn point sits on the bush's top-front toward `face`. */
  berries: [{ x: 11.8, z: -10.4 }, { x: 10.6, z: -18 }, { x: 15.2, z: -21.4 }],
  herbs: [{ x: 14.2, z: -12.2 }, { x: 8.9, z: -20.6 }],
  deer: { x: 13.6, z: -16.8 },
  rabbits: { x: 9.6, z: -14.6 },
};
/** Offset of the berry spawn point from the bush's ground centre (bush-local, +Z = front). */
export const BERRY_SPAWN = { up: .74, forward: .3 } as const;

function brookX(z: number): number {
  // Brook centreline x at z (the brook runs roughly north–south).
  brookNearest(21, z);
  return brookHit.x;
}
export const BROOK = {
  reeds: [{ x: brookX(-9) - 1.7, z: -9 }, { x: brookX(-21) + 1.7, z: -21 }, { x: brookX(-26.5) - 1.7, z: -26.5 }],
  flint: [{ x: brookX(-16.5) - 1.6, z: -16.5 }, { x: brookX(-13.4) + 1.65, z: -13.4 }],
  /** Page 4 lies on this brook-side rock (scene node 'brook-page-rock', ItemSurface). */
  pageRock: { x: brookX(-14.4) - 2.1, z: -14.4, top: .5 },
  bridge: { x: brookX(-11.3), z: -11.3, length: 5.4, yawDeg: 90 },
};
export const OUTPOST = {
  centre: { x: -4.6, z: -33.2 },
  tent: { x: -8.7, z: -32.4, yawDeg: 90 },
  /** Scene node 'outpost-table' (ItemSurface): page 5 lies on its top. */
  table: { x: -6.5, z: -31.1, yawDeg: 84, top: .76 },
  brazier: { x: -5.2, z: -35.2 },
  /** Scene node 'outpost-crate' (ItemSurface): the salvage rests on its straw, `CRATE_STRAW_TOP` up. */
  crate: { x: -5.7, z: -29.1, yawDeg: 18 },
  /** Scene nodes 'outpost-barrel' and 'outpost-crate-stack' (ItemSurface). */
  barrel: { x: -9.6, z: -30.4, yawDeg: 20 },
  crateStack: { x: -10.2, z: -33.8, yawDeg: -15 },
  lookout: { x: .7, z: -36.9, yawDeg: -8 },
  /** Page 6 lies on this supply box at the lookout's foot (scene node 'outpost-supply-box', ItemSurface). */
  lookoutBox: { x: -.5, z: -35.5, yawDeg: 12, top: .5 },
  banner: { x: -7.6, z: -35.9, yawDeg: 70 },
  /** Renewable cloth: torn canvas pinned by a stone at the collapsed tent. */
  canvas: { x: -8.2, z: -34.15, yawDeg: 20 },
  /** Rennick's toppled sentry and its empty bolt case, beside page 6. */
  brokenSentry: { x: .3, z: -34.9, yawDeg: 30 },
  boltCase: { x: .95, z: -35.35, yawDeg: -15 },
  /** Second salvage trigger, fallen from the sentry frame. */
  trigger2: { x: .72, z: -34.55, yawDeg: 55 },
  /** The fight at the lookout: bolts stuck in the ground pointing north, and ash where the Hollow fell. */
  spentBolts: [{ x: -3.4, z: -39.8 }, { x: -4.2, z: -40.9 }, { x: -3, z: -41.8 }, { x: 1.8, z: -39.6 }, { x: 2.9, z: -40.6 }, { x: 1.6, z: -41.3 }],
  ash: [{ x: -3.7, z: -41.2 }, { x: 2.3, z: -40.9 }, { x: -.6, z: -41.9 }],
};
export const SPIRE = {
  centre: { x: 5, z: -54.6 },
  stone: { x: 5.6, z: -57.8, yawDeg: -8, scale: .92 },
  beacon: { x: LANDMARKS.beacon.x, z: LANDMARKS.beacon.z },
  /** Page 7 lies on this ledge beside the beacon (scene node 'spire-ledge', ItemSurface). */
  ledge: { x: 3.4, z: -52.7, top: .58 },
  /** Ilse's satchel and a burnt-out taper beside page 7 (offsets from the ledge). */
  satchel: { dx: .28, dz: .1, yawDeg: 25 },
  taper: { dx: -.22, dz: -.05 },
};
/** Ending smoke column beyond the south tree wall (hidden until the finale). */
export const ENDING_SMOKE = { x: 6, z: 34 };
/** Wolf approach anchors, 18–30 m out behind the tree lines, plus the Spire guardians. */
export const WOLF_ANCHORS: (XZ & { id: string; radius: number })[] = [
  { id: 'wolf-anchor-south', x: -12, z: 12.6, radius: 3 },
  { id: 'wolf-anchor-west', x: -24.5, z: 1.5, radius: 3 },
  { id: 'wolf-anchor-east', x: 27, z: -3.5, radius: 3 },
  { id: 'wolf-anchor-northwest', x: -18.5, z: -21.5, radius: 3 },
  { id: 'wolf-anchor-northeast', x: 13.6, z: -24.4, radius: 3 },
  { id: 'wolf-anchor-southeast', x: 14.5, z: 11, radius: 3 },
  // Spire guardians rise ≥14 m from the beacon, behind the knoll rocks (immersion review).
  { id: 'wolf-anchor-spire-west', x: -8.8, z: -57.5, radius: 3 },
  { id: 'wolf-anchor-spire-east', x: 17.6, z: -58.4, radius: 3 },
];

/** Straw fill height inside the open salvage crate (the crate walls stand .5 m). */
export const CRATE_STRAW_TOP = .4;

// ----------------------------------------------------------------------------- trees
/**
 * Broadleaf trees (`region` says which batch keeps their shadow and collider): the
 * woodland ring round camp and the meadow edge. ForestSystem draws and fells them from
 * this list; the editor sees them as the 'valley-broadleaves' scene asset.
 * `h` is the tree height; the trunk is h·0.5 tall, radius h·0.066 → h·0.04.
 */
export const BROADLEAVES: { x: number; z: number; h: number; yaw: number; variant: number; region: 'camp' | 'meadow' }[] = [
  { x: -5.6, z: 2, h: 4.6, yaw: .4, variant: 0, region: 'camp' },
  { x: 5.4, z: 1.9, h: 4.2, yaw: 1.9, variant: 1, region: 'camp' },
  { x: -7.2, z: -3.6, h: 4, yaw: 2.6, variant: 2, region: 'camp' },
  { x: 7.4, z: -4.2, h: 4.4, yaw: .9, variant: 0, region: 'camp' },
  { x: -6.4, z: -8.4, h: 3.6, yaw: 1.2, variant: 1, region: 'camp' },
  { x: 6.8, z: -9.2, h: 3.8, yaw: 3.4, variant: 2, region: 'camp' },
  { x: 6.6, z: -21.2, h: 4.2, yaw: .6, variant: 1, region: 'meadow' },
  { x: 27.2, z: -19.4, h: 4.6, yaw: 2.1, variant: 0, region: 'meadow' },
  { x: 25.8, z: -6.4, h: 3.8, yaw: 1.2, variant: 2, region: 'meadow' },
];

/**
 * The opening journey's clearances, applied after the scatter: the wreck clearing, the
 * wolves' sightlines and the waystation stay open (journeyBlocksTree); the journey trail
 * keeps its dirt clear but trees may stand within a couple of metres of it (the "fell a
 * tree" beat); its new mushroom patches keep a little room.
 */
export const JOURNEY_TREE_CLEARANCE = { trail: 1.7, mushroom: 1.6 } as const;
export function journeyKeepsTree(x: number, z: number): boolean {
  if (journeyBlocksTree(x, z)) return false;
  if (trailDistance(x, z, 'journey') < JOURNEY_TREE_CLEARANCE.trail) return false;
  return FOREST_MUSHROOMS.every((m) => Math.hypot(x - m.x, z - m.z) >= JOURNEY_TREE_CLEARANCE.mushroom);
}

/** The valley GLB pines as first placed (the scatter keeps clear of these; see GLB_PINES). */
const SCATTER_GLB_PINES: Pine[] = [
  { id: 'grove-pine-resin-1', asset: 'pine-1', scale: .9, ...GROVE.resinPines[0], yawDeg: 0 },
  { id: 'grove-pine-resin-2', asset: 'pine-1', scale: .86, ...GROVE.resinPines[1], yawDeg: 0 },
  { id: 'grove-pine-resin-3', asset: 'pine-1', scale: .94, ...GROVE.resinPines[2], yawDeg: 0 },
  { id: 'grove-pine-4', asset: 'pine-2', scale: .95, x: -24.4, z: -12.2, yawDeg: 40 },
  { id: 'grove-pine-5', asset: 'pine-1', scale: .9, x: -17.6, z: -17.6, yawDeg: 130 },
  { id: 'grove-pine-6', asset: 'pine-1', scale: .82, x: -11.6, z: -5.4, yawDeg: 210 },
  { id: 'grove-pine-7', asset: 'pine-1', scale: .88, x: -23.3, z: -5.5, yawDeg: 300 },
  { id: 'outpost-pine-1', asset: 'pine-2', scale: .9, x: -10.6, z: -36.3, yawDeg: 75 },
];
// Resin pines turn their branch-free side (local +Z) toward the clearing.
for (let i = 0; i < 3; i++) {
  const p = SCATTER_GLB_PINES[i], dx = GROVE.centre.x - p.x, dz = GROVE.centre.z - p.z;
  p.yawDeg = Math.atan2(dx, dz) * 180 / Math.PI;
}
/**
 * Near "identity" GLB pines in the valley (scene nodes of the same ids; the camp keeps
 * woodland-pine-1..6): the first placement minus those in the journey's clearings.
 * 'grove-pine-4' stands 2.2 m off the journey trail: the first tree its "fell a tree"
 * beat meets (ForestSystem.nearestChoppable finds it).
 */
/**
 * The forest leg of the opening journey (waystation → grove → camp): choppable pines 2–3 m
 * beside the trail, so the "fell a tree for firewood" beat meets one every few steps. Added
 * after the scatter (it never moves another tree); scene nodes of the same ids
 * (ForestSystem indexes them like every GLB pine, and the colliders include them).
 */
export const JOURNEY_PINES: Pine[] = [
  { id: 'journey-pine-1', asset: 'pine-1', scale: 0.82, x: -23.39, z: -13.31, yawDeg: 0 },
  { id: 'journey-pine-2', asset: 'pine-2', scale: 0.86, x: -18.4, z: -13, yawDeg: 83 },
  { id: 'journey-pine-3', asset: 'pine-1', scale: 0.9, x: -16.24, z: -7.97, yawDeg: 166 },
  { id: 'journey-pine-4', asset: 'pine-1', scale: 0.94, x: -14.76, z: -8.77, yawDeg: 249 },
  { id: 'journey-pine-5', asset: 'pine-2', scale: 0.84, x: -12.55, z: -8.44, yawDeg: 332 },
  { id: 'journey-pine-6', asset: 'pine-1', scale: 0.88, x: -10.21, z: -12.45, yawDeg: 55 },
  { id: 'journey-pine-7', asset: 'pine-1', scale: 0.92, x: -8.74, z: -8.11, yawDeg: 138 },
  { id: 'journey-pine-8', asset: 'pine-2', scale: 0.82, x: -6.07, z: -11.92, yawDeg: 221 },
];
export const GLB_PINES: Pine[] = [...SCATTER_GLB_PINES.filter((p) => journeyKeepsTree(p.x, p.z)), ...JOURNEY_PINES];
/** GLB pine source bounds (pine-1/pine-2 share the trunk base). */
export const PINE_MIN_Y = -.235;
export const RESIN_SCAR_HEIGHT = 1.2;
/** Trunk radius of pine-1 near 1.2 m (source units ≈ 0.16 m before scale). */
export const PINE_TRUNK_RADIUS = .165;

/** Anything a tree must keep clear of (points with radii). */
const keepClear: [number, number, number][] = [
  ...GROVE.resinPines.map((p): [number, number, number] => [p.x, p.z, 2.6]),
  ...GROVE.glades.map((p): [number, number, number] => [p.x, p.z, 2.2]),
  ...GROVE.mushrooms.map((p): [number, number, number] => [p.x, p.z, 1.8]),
  [GROVE.stump.x, GROVE.stump.z, 2.4], [GROVE.brazier.x, GROVE.brazier.z, 2.6],
  ...MEADOW.berries.map((p): [number, number, number] => [p.x, p.z, 2.5]),
  ...MEADOW.herbs.map((p): [number, number, number] => [p.x, p.z, 2]),
  ...SCATTER_GLB_PINES.map((p): [number, number, number] => [p.x, p.z, 3.4]),
  [BROOK.pageRock.x, BROOK.pageRock.z, 2.5],
];
/**
 * Where the original scatter may not put a tree. The journey trail is left out here on
 * purpose: its clearances are a later filter (`journeyKeepsTree`), so adding the journey
 * only removed trees and moved none (the scene's pattern transforms were baked from this).
 */
function blockedForTrees(x: number, z: number, margin = 0): boolean {
  if (trailNearest(x, z, 'journey') < 2.9 + margin) return true;
  if (Math.abs(x - 21) < 8 && brookNearest(x, z) < 3.4 + margin) return true;
  if (Math.hypot(x - .3, z + 1.6) < 11 + margin) return true;
  if (Math.hypot(x - OUTPOST.centre.x, z - OUTPOST.centre.z) < 8.6 + margin) return true;
  if (Math.hypot(x - SPIRE.centre.x, z - SPIRE.centre.z) < 9.6 + margin) return true;
  if (((x - 14.8) / 12.2) ** 2 + ((z + 15.6) / 10.2) ** 2 < 1) return true;
  if (Math.hypot(x - GROVE.centre.x, (z - GROVE.centre.z) * 1.2) < 5.2) return true;
  // Keep the camp → Spire sightline open.
  const sx = 5, sz = -57, ax = 0, az = .4, t = Math.max(0, Math.min(1, ((x - ax) * (sx - ax) + (z - az) * (sz - az)) / ((sx - ax) ** 2 + (sz - az) ** 2)));
  if (Math.hypot(x - (ax + (sx - ax) * t), z - (az + (sz - az) * t)) < 3.2 + t * 2) return true;
  return keepClear.some(([px, pz, r]) => Math.hypot(x - px, z - pz) < r + margin);
}

/** `scale` is the horizontal scale; `sy` multiplies it vertically; `variant` picks the prototype. */
export type TreeInstance = { x: number; z: number; y: number; scale: number; sy: number; variant: number; yawDeg: number };
function scatter(seed: number, attempts: number, spacing: number, sample: (r: () => number) => XZ | null, scaleRange: [number, number], existing: TreeInstance[] = []): TreeInstance[] {
  const random = rng(seed), out: TreeInstance[] = [];
  for (let i = 0; i < attempts; i++) {
    const p = sample(random);
    if (!p) continue;
    const s = scaleRange[0] + random() * (scaleRange[1] - scaleRange[0]);
    const clash = (list: TreeInstance[]) => list.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < spacing * (t.scale + s) * .5);
    if (clash(out) || clash(existing)) continue;
    out.push({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: 0, scale: +s.toFixed(3), sy: +(.85 + random() * .45).toFixed(3), variant: random() < .45 ? 1 : 0, yawDeg: Math.round(random() * 360) });
  }
  for (const t of out) t.y = +(terrainHeight(t.x, t.z) - .06 * t.scale * t.sy).toFixed(3);
  return out;
}
const inside = (x: number, z: number, m = 0) => x > WORLD_BOUNDS.minX + m && x < WORLD_BOUNDS.maxX - m && z > WORLD_BOUNDS.minZ + m && z < WORLD_BOUNDS.maxZ - m;

/** Mid-poly procedural pines inside the valley ('valley-pine' instanced), split by sector. */
export const VALLEY_PINES: Record<string, TreeInstance[]> = {};
{
  const all: TreeInstance[] = [];
  // Old growth ringing the grove clearing.
  const grove = scatter(11, 900, 2.2, (r) => {
    const a = r() * Math.PI * 2, d = Math.sqrt(.3 + r() * .7);
    const x = GROVE.centre.x + Math.cos(a) * d * 11, z = GROVE.centre.z + Math.sin(a) * d * 9;
    return inside(x, z, 1) && !blockedForTrees(x, z) ? { x, z } : null;
  }, [.8, 1.25]);
  all.push(...grove);
  // Rim trees just inside the walls (the walls sit at the bounds).
  const rim = scatter(12, 2600, 3.8, (r) => {
    const x = WORLD_BOUNDS.minX + r() * (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX), z = WORLD_BOUNDS.minZ + r() * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ);
    const edge = Math.min(x - WORLD_BOUNDS.minX, WORLD_BOUNDS.maxX - x, z - WORLD_BOUNDS.minZ + 3, WORLD_BOUNDS.maxZ - z);
    if (edge > 4.2 || edge < .6 || z < -60) return null;
    return !blockedForTrees(x, z) ? { x, z } : null;
  }, [.8, 1.25], all);
  all.push(...rim);
  // Scattered valley trees, thinner up north and near the central corridor.
  const valley = scatter(13, 3200, 3.6, (r) => {
    const x = WORLD_BOUNDS.minX + 2 + r() * (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX - 4), z = WORLD_BOUNDS.minZ + 3 + r() * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ - 5);
    if (blockedForTrees(x, z, .6)) return null;
    if (z < -42 && r() < .6) return null;
    if (Math.abs(x) < 12 && z > -30 && r() < .55) return null;
    // Clump into stands with open glades between them.
    const stand = Math.sin(x * .19 + 1.3) * Math.cos(z * .15 - .7) + .45 * Math.sin((x + z) * .11);
    if (r() > .15 + .85 * Math.min(1, Math.max(0, (stand + .25) / .7))) return null;
    return { x, z };
  }, [.8, 1.25], all);
  all.push(...valley);
  // Three sectors × two silhouettes ('valley-pine', 'valley-pine-tall'); each list lowers to one InstancedMesh.
  const sector = (t: TreeInstance) => (t.z > -9 ? 'south' : t.x < 2 ? 'west' : 'east') + (t.variant ? '-tall' : '');
  for (const t of all) if (journeyKeepsTree(t.x, t.z)) (VALLEY_PINES[sector(t)] ??= []).push(t);
}

/** Low-poly 'far-pine' belts on the ridges outside the walls, split by sector. */
export const FAR_PINES: Record<string, TreeInstance[]> = {};
{
  const all = scatter(21, 12000, 2.55, (r) => {
    const x = -60 + r() * 120, z = -96 + r() * 128;
    const out = Math.max(WORLD_BOUNDS.minX - x, x - WORLD_BOUNDS.maxX, WORLD_BOUNDS.minZ - z, z - WORLD_BOUNDS.maxZ);
    if (out < 1.3 || out > 23) return null;
    if (Math.abs(x - 21) < 10 && brookNearest(x, z) < 4.5) return null;
    const north = z < WORLD_BOUNDS.minZ && Math.abs(x) < WORLD_BOUNDS.maxX + 2;
    // Dense wall just past the bounds, thinning up the ridge; the north flank stays rocky.
    const keep = north ? (out < 7 ? .14 : .03) : (out < 8 ? .74 : .07);
    return r() < keep ? { x, z } : null;
  }, [.85, 1.35]);
  for (const t of all) {
    if (journeyBlocksTree(t.x, t.z)) continue;
    const key = t.z > WORLD_BOUNDS.maxZ ? 'south'
      : t.z < WORLD_BOUNDS.minZ ? 'north'
      : `${t.x < 0 ? 'west' : 'east'}-${t.z < -34 ? 'north' : t.z < -8 ? 'mid' : 'south'}`;
    (FAR_PINES[key] ??= []).push(t);
  }
}
