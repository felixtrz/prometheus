/**
 * The opening journey (design/JOURNEY.md): the burning wreck → the waystation (the pack)
 * → the forest (firewood, mushrooms) → camp (fire and stew), then the existing story.
 * Pure data and rules: no World, no DOM, no Three.js. The wreck and waystation scene
 * assets, JourneySystem, the valley's tree scatter (keep-clear) and node tests import it.
 *
 * Frames: the wreck is authored in its own frame, "wreck-local", and its scene nodes sit
 * at WRECK.origin with NO rotation (yaw 0), so wreck-local = world minus the origin.
 * Wreck-local +X is the nose (east, toward camp), -Z the door side (north, toward the
 * waystation), +Y up with the cabin deck at WRECK.deckY.
 */
import { pushOutside, type XZ } from './creature-ai.js';
import { DAWN_CLOCK } from './rules.js';
import { LANDMARKS, terrainHeight } from './terrain.js';

export type { XZ };

// ───────────────────────────────────────────────────────────────────────── the wreck

export const WRECK = {
  /** World position of the wreck-local origin (cabin centre line, x mid-cabin). Yaw 0. */
  origin: { x: -22, y: -0.15, z: 4 },
  /** Cabin deck height (wreck-local). */
  deckY: 0.35,
  /** Fuselage cross-section: circle centre height and radii (outer skin, inner lining). */
  tube: { cy: 1.3, outer: 1.5, inner: 1.42 },
  /** Flat ceiling panel height (wreck-local): 2.0 m headroom over the deck. */
  ceilingY: 2.35,
  /** Walkable cabin (wreck-local): the rear debris wall to the cockpit bulkhead, and the half-width. */
  cabin: { x0: -3.75, x1: 4.3, halfWidth: 1.02 },
  /** Rear break (the fire) and the cockpit bulkhead (wreck-local x). */
  rearX: -4.6,
  bulkheadX: 4.35,
  /** Door opening on the -Z wall (wreck-local): x span, sill and head heights, the wall line z. */
  door: { x0: 2.85, x1: 3.75, sill: 0.35, top: 2.02, z: -1.2 },
  /** Seat rows (wreck-local x of each cushion centre), rear to front. */
  rows: [-3.5, -2.64, -1.78, -0.92, -0.06, 0.8, 1.66],
  /** Seat centres across the cabin (wreck-local z): one single seat by the door side, a double opposite. */
  seatZ: { single: -0.76, aisle: 0.42, window: 0.84 },
  /** The keeper's seat: row 4, aisle side of the double (wreck-local cushion centre). */
  seat: { x: -0.92, z: 0.42 },
  /** The emergency-axe bracket above the door, inside (wreck-local; the axe's grip point). */
  axe: { x: 3.3, y: 2.13, z: -1.07 },
} as const;

/** World → wreck-local (the wreck never turns). */
export const toWreckX = (x: number) => x - WRECK.origin.x;
export const toWreckZ = (z: number) => z - WRECK.origin.z;
/** Wreck-local → world. */
export const wreckWorld = (lx: number, lz: number): XZ => ({ x: WRECK.origin.x + lx, z: WRECK.origin.z + lz });

/** Ground height under a wreck-local point, in wreck-local Y (for exterior parts that sit on the terrain). */
export function groundLocal(lx: number, lz: number): number {
  return terrainHeight(WRECK.origin.x + lx, WRECK.origin.z + lz) - WRECK.origin.y;
}

/**
 * Where the player starts a fresh journey: standing in the keeper's seat, facing the nose
 * (the scene's player.transform: rotationDeg [0, -90, 0] turns the view from -Z to +X).
 */
export const SPAWN = {
  position: [WRECK.origin.x + WRECK.seat.x + 0.06, WRECK.origin.y + WRECK.deckY, WRECK.origin.z + WRECK.seat.z] as const,
  rotationDeg: [0, -90, 0] as const,
};

/** Inside the cabin (world x/z)? The door threshold counts as outside once past the wall line. */
export function insideCabin(x: number, z: number): boolean {
  const lx = toWreckX(x), lz = toWreckZ(z);
  return lx > WRECK.rearX && lx < WRECK.bulkheadX && Math.abs(lz) < WRECK.tube.inner - 0.05;
}

/** Horizontal distance (m) from a world point to the door opening's centre. */
export function doorDistance(x: number, z: number): number {
  const d = WRECK.door;
  return Math.hypot(toWreckX(x) - (d.x0 + d.x1) / 2, toWreckZ(z) - d.z);
}

// ─────────────────────────────────────────────────────────────────────────── the door

/**
 * The jammed door: axe blows (gather-style arming, creature-ai bladeContact) on its panel
 * tear it off. `lenientAfter`: once one blow has landed, any contact at all counts after
 * this many seconds (a player who cannot swing hard still gets out).
 */
export const DOOR = {
  hits: 3,
  contact: 0.1,
  rearm: 0.3,
  bladeSpeed: 1.6,
  cooldown: 0.35,
  lenientAfter: 40,
  /** Within this distance (m) of the opening the player is "at the door" (the axe line). */
  near: 1.8,
  /** The panel's ajar angle (deg, about its forward hinge; negative swings it outward, -Z). */
  ajarDeg: -26,
  /** Panel size: width along the wall, height, thickness (m). */
  panel: { width: 0.9, height: 1.67, thickness: 0.08 },
  /** A blow kicks the panel open this much further (deg) and shakes it this long (s). */
  kickDeg: -7,
  shakeSeconds: 0.25,
  /** The tear: seconds to swing wide on the ripping hinge, then to fall onto the ground as a ramp. */
  ripSeconds: 0.25,
  fallSeconds: 0.65,
} as const;

/**
 * Signed gap (m) from a wreck-local point to the jammed door panel, as a box over the
 * opening from just inside the wall line to the ajar panel's outer edge.
 */
export function doorGap(lx: number, ly: number, lz: number): number {
  const d = WRECK.door;
  const cx = Math.max(d.x0, Math.min(d.x1, lx));
  const cy = Math.max(d.sill + 0.05, Math.min(d.top - 0.02, ly));
  const cz = Math.max(d.z - 0.32, Math.min(d.z + 0.08, lz));
  return Math.hypot(lx - cx, ly - cy, lz - cz);
}

/** A pose for the door panel group (wreck-local): position, Euler XYZ in radians. */
export type PanelPose = { x: number; y: number; z: number; rx: number; ry: number; rz: number };

const DEG = Math.PI / 180;
const HINGE_X = WRECK.door.x1;
const HALF = DOOR.panel.width / 2;

/**
 * The panel group's origin is the bottom centre of the panel. Swung by `yawDeg` about the
 * forward (hinge) edge: the pose that puts the panel there.
 */
export function panelAjar(yawDeg: number, out: PanelPose): PanelPose {
  const a = yawDeg * DEG;
  out.x = HINGE_X - HALF * Math.cos(a);
  out.y = WRECK.door.sill;
  out.z = WRECK.door.z + HALF * Math.sin(a);
  out.rx = 0; out.ry = a; out.rz = 0;
  return out;
}

/**
 * Fallen pose: the panel lies outward from the sill down to the ground, a ramp. The drop
 * from the sill to the ground outside sets its slope.
 */
export function panelFallen(out: PanelPose): PanelPose {
  const cx = (WRECK.door.x0 + WRECK.door.x1) / 2;
  const reach = DOOR.panel.height * 0.93;
  const ground = groundLocal(cx, WRECK.door.z - reach);
  const drop = Math.max(0.05, WRECK.door.sill - ground);
  const below = Math.asin(Math.min(0.95, drop / DOOR.panel.height));
  out.x = cx + 0.04;
  out.y = WRECK.door.sill - 0.03;
  out.z = WRECK.door.z - 0.06;
  // Upright (0) → past horizontal, falling outward (-Z) by 90° plus the slope below horizontal.
  out.rx = -(Math.PI / 2 + below);
  out.ry = 6 * DEG;
  out.rz = 0;
  return out;
}

const ripFrom: PanelPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
const fallTo: PanelPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
/**
 * The tear, `t` seconds after the last blow: the panel swings wide as the hinge rips
 * (DOOR.ripSeconds), then topples outward onto the ground (DOOR.fallSeconds), gravity-eased
 * (it lands on the last frame). `fromDeg` is where the blows left it.
 */
export function panelTear(t: number, fromDeg: number, out: PanelPose): PanelPose {
  if (t <= DOOR.ripSeconds) {
    const u = Math.max(0, t) / DOOR.ripSeconds;
    return panelAjar(fromDeg + (-40 - fromDeg) * u * (2 - u), out);
  }
  panelAjar(-40, ripFrom);
  panelFallen(fallTo);
  // Falling like a hinged slab: slow, then ever faster (the thud is the tear's last frame).
  const u = Math.min(1, (t - DOOR.ripSeconds) / DOOR.fallSeconds);
  const k = u * u;
  out.x = ripFrom.x + (fallTo.x - ripFrom.x) * k;
  out.y = ripFrom.y + (fallTo.y - ripFrom.y) * k;
  out.z = ripFrom.z + (fallTo.z - ripFrom.z) * k;
  out.rx = ripFrom.rx + (fallTo.rx - ripFrom.rx) * k;
  out.ry = ripFrom.ry + (fallTo.ry - ripFrom.ry) * k;
  out.rz = 0;
  return out;
}
/** Seconds the whole tear takes. */
export const TEAR_SECONDS = DOOR.ripSeconds + DOOR.fallSeconds;

// ────────────────────────────────────────────────────────────── fire and the Hollow

/**
 * The wreck fires (wreck-local): `heat` sizes the flames. The two outside fires are the
 * ward that keeps the staged Hollow off (their centre in world is WARD).
 */
export const WRECK_FIRES = [
  { id: 'rear', x: -4.05, y: 0.35, z: 0.05, heat: 1, inside: true },
  { id: 'seat', x: -3.5, y: 0.8, z: 0.6, heat: 0.45, inside: true },
  { id: 'engine', x: 0.9, y: 0.25, z: 3.45, heat: 1.1, inside: false },
  { id: 'tail', x: -8.6, y: 0.1, z: 0.4, heat: 0.8, inside: false },
  { id: 'grass-n', x: -6.2, y: 0, z: -2.1, heat: 0.35, inside: false },
  { id: 'grass-s', x: 2.6, y: 0, z: 2.3, heat: 0.3, inside: false },
] as const;

/** The fire's reach in world: the staged wolves never come within `radius` of `centre`. */
export const WARD = { x: WRECK.origin.x - 1.5, z: WRECK.origin.z + 1.2, radius: 11 } as const;

/**
 * The Hollow watching the wreck at dawn: visual-only wolves (the 'wolf' asset, no Creature
 * component, so CreatureSystem, combat and the guide's threat gate never see them). Each
 * holds a post on the ridges just past the valley walls, where the player cannot follow.
 */
export const WOLF_POSTS: readonly XZ[] = [
  { x: -35.4, z: 8.6 },
  { x: -26.2, z: 16.2 },
  { x: -15.2, z: 15.8 },
  { x: -35.8, z: -2.6 },
];

export const STAGED = {
  /** A wolf the player comes closer than this (m) to backs away up the slope. */
  keepFromPlayer: 9,
  /** Pacing: metres either side of the post, and seconds per pass. */
  pace: 1.1,
  paceSeconds: 7,
  /** Walking speed (m/s) toward a goal; the head tracks the player within this range (m). */
  speed: 1.6,
  watchRange: 30,
  /** Seconds between two howls of the pack (random within). */
  howlSeconds: [5, 11] as readonly [number, number],
  /** At the sunrise they crumble one after another, this far apart (s), each over `crumbleSeconds`. */
  crumbleStagger: 0.7,
  crumbleSeconds: 1.2,
  /** The player this far (m) from the ward's centre before the sunrise: they crumble early, unseen. */
  leaveRadius: 30,
} as const;

/**
 * Where a staged wolf wants to stand: its post, paced along the slope, pushed away from a
 * player who comes too close, and never inside the fire's ward. Writes `out`.
 */
export function stagedGoal(post: XZ, index: number, time: number, playerX: number, playerZ: number, out: XZ): XZ {
  // Pace across the line to the ward (along the ridge), each wolf on its own phase.
  const ax = post.x - WARD.x, az = post.z - WARD.z, len = Math.hypot(ax, az) || 1;
  const along = STAGED.pace * Math.sin((time / STAGED.paceSeconds) * Math.PI * 2 + index * 1.7);
  out.x = post.x - (az / len) * along;
  out.z = post.z + (ax / len) * along;
  const dx = out.x - playerX, dz = out.z - playerZ, d = Math.hypot(dx, dz);
  if (d < STAGED.keepFromPlayer) {
    const push = STAGED.keepFromPlayer - d;
    const ux = d > 1e-3 ? dx / d : ax / len, uz = d > 1e-3 ? dz / d : az / len;
    out.x += ux * push;
    out.z += uz * push;
  }
  pushOutside(out, WARD.x, WARD.z, WARD.radius);
  return out;
}

/**
 * The day clock through the wreck: a fresh journey starts in the grey before sunrise
 * (the scene's GameState.clock) and JourneySystem holds it there (DayNightSystem.holdClock)
 * until the Hollow have been seen; released, the sun rises `sunriseIn` s later and the
 * staged wolves crumble with the dark.
 */
export const WRECK_CLOCK = {
  start: DAWN_CLOCK + 6,
  /** Release the hold at most this long (s) after stepping outside, whatever the guide says. */
  releaseAfter: 28,
  /** Clock value at which the staged wolves crumble (the sun is up). */
  sunrise: DAWN_CLOCK + 26,
} as const;

// ──────────────────────────────────────────────────── the route: waystation, forest, camp

/** Outpost 1, the waystation: a lean-to under the west ridge where the pack waits. */
export const WAYSTATION = {
  centre: { x: -27.6, z: -5.6 },
  /** The lean-to's open front (asset +Z) faces east: toward the arriving player and the forest beyond. */
  yawDeg: 80,
  /** Scene node 'waystation-table' (ItemSurface): the pack lies on its top. */
  table: { x: -27.0, z: -5.7, yawDeg: 80, top: 0.78 },
  /** Within this (m) of the centre the player has arrived. */
  arrive: 6,
  /** The pack left behind: the reminder speaks once the player is this far (m) from it, pack not taken. */
  forgotten: 16,
} as const;

/** Camp (outpost 2): within this (m) of the campfire the player has arrived. */
export const CAMP_ARRIVE = 8;
export const atCamp = (x: number, z: number) => Math.hypot(x - LANDMARKS.campfire.x, z - LANDMARKS.campfire.z) < CAMP_ARRIVE;
export const atWaystation = (x: number, z: number) =>
  Math.hypot(x - WAYSTATION.centre.x, z - WAYSTATION.centre.z) < WAYSTATION.arrive;

/**
 * The journey trail (control points, world): from the wreck door past the waystation
 * into the grove, where it meets the grove trail (valley-layout TRAIL_CONTROL.grove)
 * that runs on to the main trail and camp.
 */
export const JOURNEY_TRAIL: readonly XZ[] = [
  { x: -18.7, z: 1.9 }, { x: -20.8, z: -0.4 }, { x: -23.6, z: -2.6 }, { x: -26.0, z: -4.3 },
  { x: -26.4, z: -7.2 }, { x: -24.6, z: -9.6 }, { x: -21.6, z: -10.8 }, { x: -18.4, z: -10.9 }, { x: -15.2, z: -11 },
];

/**
 * Expedition trail markers (orange cloth on a stake), world x/z and the way the cloth
 * faces; `flag` marks a tall pole (the waystation, and camp seen from the forest).
 */
export const MARKERS: readonly (XZ & { yawDeg: number; flag?: boolean })[] = [
  { x: -19.6, z: 0.5, yawDeg: 40 },
  { x: -22.4, z: -2.1, yawDeg: 50 },
  { x: -25.0, z: -3.0, yawDeg: 60 },
  { x: -29.4, z: -7.6, yawDeg: 125, flag: true },
  { x: -25.3, z: -8.9, yawDeg: 120 },
  { x: -22.8, z: -11.6, yawDeg: 100 },
  { x: -12.2, z: -11.9, yawDeg: 95 },
  { x: -6.6, z: -10.6, yawDeg: 80 },
  { x: -3.4, z: -8.6, yawDeg: 70, flag: true },
];

/** New mushroom patches on the way through the forest (the grove's three are on it too). */
export const FOREST_MUSHROOMS: readonly XZ[] = [
  { x: -22.9, z: -8.6 },
  { x: -9.6, z: -9.9 },
];

/** The forest's work: at least this much carried before the camp line asks for a fire. */
export const FOREST_NEEDS = { logs: 1, mushrooms: 1 } as const;
export const forestDone = (logs: number, mushrooms: number) =>
  logs >= FOREST_NEEDS.logs && mushrooms >= FOREST_NEEDS.mushrooms;

/**
 * Places the tree scatter keeps clear for the journey: the crash clearing and its furrow,
 * sightlines from the door to the watching wolves, and the waystation. Circles and
 * capsules in world x/z. (The journey trail itself is cleared like any trail.)
 */
type Capsule = { ax: number; az: number; bx: number; bz: number; r: number };
const DOOR_OUT = wreckWorld((WRECK.door.x0 + WRECK.door.x1) / 2, WRECK.door.z - 1.6);
export const JOURNEY_CLEAR: readonly Capsule[] = [
  // Crash clearing: along the fuselage from the tail to the nose, wide enough for the wings.
  { ax: WRECK.origin.x - 11, az: WRECK.origin.z + 0.4, bx: WRECK.origin.x + 7, bz: WRECK.origin.z + 0.4, r: 5.2 },
  // The broken right wing reaches south.
  { ax: WRECK.origin.x + 1, az: WRECK.origin.z + 3, bx: WRECK.origin.x - 1, bz: WRECK.origin.z + 9.5, r: 2.6 },
  // Sightlines from outside the door to each watching wolf.
  ...WOLF_POSTS.map((p) => ({ ax: DOOR_OUT.x, az: DOOR_OUT.z, bx: p.x, bz: p.z, r: 1.6 })),
  // The waystation.
  { ax: WAYSTATION.centre.x, az: WAYSTATION.centre.z, bx: WAYSTATION.centre.x, bz: WAYSTATION.centre.z, r: 5 },
];

/** Whether a tree at world (x, z) would stand in the journey's clearings (margin in m). */
export function journeyBlocksTree(x: number, z: number, margin = 0): boolean {
  for (const c of JOURNEY_CLEAR) {
    const dx = c.bx - c.ax, dz = c.bz - c.az, len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - c.ax) * dx + (z - c.az) * dz) / len2)) : 0;
    if (Math.hypot(x - c.ax - dx * t, z - c.az - dz * t) < c.r + margin) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────── steps and resume

/**
 * The journey's beats, in order. Only the objectives are saved; the beats in between
 * (the door, the holster, the dawn) replay from their objective on a Continue.
 */
export const JOURNEY_STEPS = [
  'wake', // in the seat: walk to the door
  'door', // at the jammed door: take the axe
  'armed', // axe in hand: strike the door
  'open', // the door is down: get out
  'outside', // out: the Hollow on the hills, the fire at your back; holster the axe
  'dawn', // the sun rises, the Hollow crumble: follow the markers
  'waystation', // at the waystation: take the pack, wear it
  'forest', // pack on: through the forest, fell a tree, pick mushrooms
  'camp', // at camp: firewood in the ring, light it; then the existing story
  'done',
] as const;
export type JourneyStep = typeof JOURNEY_STEPS[number];
export const stepIndex = (step: JourneyStep) => JOURNEY_STEPS.indexOf(step);

/** Objective ids the journey completes (proposed for story.ts OBJECTIVES, in this order, before 'light-fire'). */
export const JOURNEY_OBJECTIVES = ['escape', 'waystation', 'forest'] as const;
export type JourneyObjective = typeof JOURNEY_OBJECTIVES[number];

/** Which objectives are done, as read from the save (by id: bit layout is story.ts's). */
export type JourneyProgress = { escape: boolean; waystation: boolean; forest: boolean };

/** The beat a journey resumes at (Continue): replayed from its last completed objective. */
export function resumeStep(done: JourneyProgress): JourneyStep {
  if (!done.escape) return 'wake';
  if (!done.waystation) return 'dawn';
  if (!done.forest) return 'forest';
  return 'done';
}

/**
 * Where a resumed journey puts the player (world x/z and facing yaw in degrees), or null
 * to keep the saved respawn (camp and later). A resumed wreck starts in the seat again.
 */
export function resumePose(step: JourneyStep): (XZ & { yawDeg: number }) | null {
  switch (step) {
    case 'wake': return { x: SPAWN.position[0], z: SPAWN.position[2], yawDeg: SPAWN.rotationDeg[1] };
    // Outside the torn door, facing along the trail.
    case 'dawn': return { ...wreckWorld((WRECK.door.x0 + WRECK.door.x1) / 2, WRECK.door.z - 2.4), yawDeg: 145 };
    // At the waystation, facing the forest.
    case 'waystation':
    case 'forest': return { x: WAYSTATION.centre.x + 2.2, z: WAYSTATION.centre.z - 1.6, yawDeg: 110 };
    default: return null;
  }
}

/**
 * Where Prometheus' shade stands for the wreck's lines (world x/z), or null to let the
 * GuideSystem choose as usual. Inside the cabin its usual spot (2.4–3 m out, 35–50° off
 * the view) would land in the seats or beyond the hull: it stands in the aisle between
 * the keeper and the door instead, then just outside the torn doorway.
 */
export function shadeMark(step: JourneyStep, out: XZ): XZ | null {
  const doorX = (WRECK.door.x0 + WRECK.door.x1) / 2;
  switch (step) {
    case 'wake': Object.assign(out, wreckWorld(1.1, -0.15)); return out;
    case 'door':
    case 'armed': Object.assign(out, wreckWorld(doorX - 1.5, 0.05)); return out;
    case 'open': Object.assign(out, wreckWorld(doorX + 0.4, WRECK.door.z - 2.6)); return out;
    default: return null;
  }
}
