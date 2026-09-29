/**
 * Analytic valley terrain: the single source of ground height for the ground mesh,
 * environment dressing, dropped items and creatures. Pure and deterministic.
 */
export const noise = (x: number, z: number) =>
  .5 * Math.sin(x * 1.7 + z * .9) + .3 * Math.sin(x * .6 - z * 2.3 + 1.3) + .2 * Math.sin((x + z) * 3.1 + .7);

export const smooth = (a: number, b: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Low hills that frame the camp clearing (unchanged from the first playable). */
const bumps = [[-7, -7, 4.5, .55], [7, -8, 5, .7], [-3, -13, 7, 1.1], [6, -14, 7.5, 1.2], [0, -22, 14, 1.3], [-12, -3, 4, .5], [12, -2, 4, .5]];

/**
 * Placement contract shared by the world build, creatures, audio and story.
 * The world build may refine positions but must keep these keys.
 */
export const LANDMARKS = {
  camp: { x: 0, z: -1 },
  campfire: { x: .25, z: -1.9 },
  grove: { x: -17, z: -11 },
  meadow: { x: 16, z: -15 },
  /** Brook centreline inside the walkable valley, south → north (the water runs south). */
  brook: [
    { x: 21.4, z: 14 }, { x: 20.8, z: 4 }, { x: 21.9, z: -4 }, { x: 20.9, z: -12 }, { x: 20.6, z: -18 },
    { x: 19.6, z: -26 }, { x: 20.2, z: -36 }, { x: 22, z: -46 }, { x: 21.6, z: -56 }, { x: 20.4, z: -64 },
  ],
  outpost: { x: -4, z: -33 },
  spire: { x: 5, z: -55 },
  /** Hold a lit torch head inside this sphere to light the finale beacon (bowl centre of 'beacon-brazier'). */
  beacon: { x: 5, y: 7.62, z: -52.2, radius: .45 },
} as const;

/** Walkable limits; the world build encloses them with ridges and the 'valley-bounds' walls. */
export const WORLD_BOUNDS = { minX: -35, maxX: 35, minZ: -65, maxZ: 14 } as const;

// ---------------------------------------------------------------------------
// Brook: a Catmull-Rom centreline sampled every ~1 m, extended past the bounds so
// the water enters from the north gorge and leaves through the south tree wall.
const brookControl = [
  { x: 21, z: 40 }, { x: 21, z: 26 }, ...LANDMARKS.brook, { x: 21.2, z: -77 }, { x: 22, z: -92 },
];
const brookXs: number[] = [], brookZs: number[] = [];
for (let i = 0; i < brookControl.length - 1; i++) {
  const p0 = brookControl[Math.max(0, i - 1)], p1 = brookControl[i], p2 = brookControl[i + 1], p3 = brookControl[Math.min(brookControl.length - 1, i + 2)];
  const steps = Math.max(2, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z)));
  for (let s = 0; s < steps; s++) {
    const t = s / steps, t2 = t * t, t3 = t2 * t;
    const cr = (a: number, b: number, c: number, d: number) => .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    brookXs.push(cr(p0.x, p1.x, p2.x, p3.x));
    brookZs.push(cr(p0.z, p1.z, p2.z, p3.z));
  }
}
brookXs.push(brookControl[brookControl.length - 1].x);
brookZs.push(brookControl[brookControl.length - 1].z);
/** Dense brook centreline (south → north), for the water ribbon and bank dressing. */
export const brookPath: readonly { x: number; z: number }[] = brookXs.map((x, i) => ({ x, z: brookZs[i] }));

/** Result of the last `brookNearest` call (reused, never allocate per call). */
export const brookHit = { distance: 99, x: 0, z: 0 };
/** Nearest point on the brook centreline; writes `brookHit` and returns the distance. */
export function brookNearest(x: number, z: number): number {
  let best = 1e9, bx = 0, bz = 0;
  for (let i = 0; i < brookXs.length - 1; i++) {
    const ax = brookXs[i], az = brookZs[i], dx = brookXs[i + 1] - ax, dz = brookZs[i + 1] - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const px = ax + dx * t, pz = az + dz * t, d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < best) { best = d; bx = px; bz = pz; }
  }
  brookHit.distance = Math.sqrt(best);
  brookHit.x = bx;
  brookHit.z = bz;
  return brookHit.distance;
}

/** Rise toward the northern upland (0 south of z −20, full by z −52). */
const northRise = (z: number) => 2.4 * smooth(-20, -52, z);
/** Enclosing ridges: steep just past the walls, levelling off ~14 m up. */
const ridgeProfile = (d: number) => d <= 0 ? 0 : 14.5 * (1 - Math.exp(-((d / 9) ** 1.6)));
function ridgeAmount(x: number, z: number): number {
  const wobble = 1.3 * Math.sin(z * .13 + 1.7) + .8 * Math.sin(x * .17 - .4);
  const side = Math.abs(x) - 31.5 + wobble;
  const north = -z - 61.5 + .9 * Math.sin(x * .15 + .6);
  const south = z - 11.5 + wobble * .7;
  // Soft maximum of the three sides keeps the corners rounded.
  const d = Math.max(side, north, south);
  return ridgeProfile(d);
}
/** Water surface height at a centreline z: falls gently from the north gorge to the south. */
export function brookWaterY(z: number): number {
  return .02 + northRise(z) * .92 + .16 * Math.max(0, -z - 60) - .035 * Math.max(0, z - 12) - .22;
}

const OUTPOST_FLAT = { x: -4.6, z: -33.2, inner: 6, outer: 13 };
const SPIRE_FLAT = { x: 5, z: -54.6, inner: 4.8, outer: 11.5 };
const MEADOW_FLAT = { x: 14.8, z: -15.6 };

/** Terrain before plateaus, brook and the camp clearing. */
function rawHeight(x: number, z: number): number {
  let y = 0;
  for (const [bx, bz, width, height] of bumps) y += height * Math.exp(-(((x - bx) / width) ** 2 + ((z - bz) / width) ** 2) * 1.6);
  const meadow = smooth(13, 7, Math.hypot((x - MEADOW_FLAT.x) / 1.15, z - MEADOW_FLAT.z));
  const roll = .5 * Math.sin(x * .19 + .7) * Math.cos(z * .16 - .4) + .32 * Math.sin((x - z) * .11 + 1.9) + .22 * Math.sin(x * .07 + z * .23 + .3);
  y += roll * (1 - .75 * meadow) * smooth(3, 12, Math.abs(x - 21));
  y += northRise(z);
  // The Spire knoll on the far north ridge.
  y += 4.2 * Math.exp(-(((x - 5) / 13) ** 2 + ((z + 57) / (z > -57 ? 16 : 11)) ** 2) * 1.6);
  y += ridgeAmount(x, z);
  return y;
}
const outpostY = rawHeight(OUTPOST_FLAT.x, OUTPOST_FLAT.z);
const spireY = rawHeight(SPIRE_FLAT.x, SPIRE_FLAT.z) + .15;
/** Graded climb from the outpost shelf to the Spire plateau (follows the main trail). */
const CLIMB = [[-2.5, -35.8], [-2.2, -37.4], [.2, -42.6], [3.1, -47.4], [4.6, -50.4], [5, -52]];
const climbLength = CLIMB.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - CLIMB[i][0], p[1] - CLIMB[i][1]), 0);
function climb(x: number, z: number, y: number): number {
  if (z > -34 || z < -54 || x < -8 || x > 11) return y;
  let best = 1e9, along = 0, run = 0;
  for (let i = 0; i < CLIMB.length - 1; i++) {
    const [ax, az] = CLIMB[i], dx = CLIMB[i + 1][0] - ax, dz = CLIMB[i + 1][1] - az, len = Math.hypot(dx, dz);
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / (len * len)));
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; along = run + t * len; }
    run += len;
  }
  // Arrive at plateau height just before the plateau rim so the flatten meets it without a kink.
  const u = Math.min(1, along / (climbLength * .86)), eased = .7 * u + .3 * u * u * (3 - 2 * u);
  const target = outpostY + (spireY - outpostY) * eased;
  return y + (target - y) * smooth(4.6, 1.8, best);
}

export function terrainHeight(x: number, z: number): number {
  let y = rawHeight(x, z);
  // Level shelves for the outpost camp and the Spire plateau.
  let d = Math.hypot(x - OUTPOST_FLAT.x, z - OUTPOST_FLAT.z);
  if (d < OUTPOST_FLAT.outer) y += (outpostY - y) * smooth(OUTPOST_FLAT.outer, OUTPOST_FLAT.inner, d);
  y = climb(x, z, y);
  d = Math.hypot(x - SPIRE_FLAT.x, (z - SPIRE_FLAT.z) * 1.1);
  if (d < SPIRE_FLAT.outer) y += (spireY - y) * smooth(SPIRE_FLAT.outer, SPIRE_FLAT.inner, d);
  // Brook channel: bed, gravel banks, then back to the land within a few metres.
  if (Math.abs(x - 21) < 19) {
    const bd = brookNearest(x, z);
    const reach = 6.5 + Math.min(12, ridgeAmount(brookHit.x, brookHit.z)) * .8;
    if (bd < reach) {
      const water = brookWaterY(brookHit.z);
      const bank = water - .3 + .44 * smooth(.6, 2.3, bd) + .08 * noise(x * .8, z * .8) * smooth(1.2, 2.5, bd);
      y = bank + (y - bank) * smooth(2.2, reach, bd);
    }
  }
  // Flat playable clearing, including every camp prop and the initial player rig.
  const edge = Math.hypot(x / 4.6, (z + .6) / 4.3);
  return (y + .035 * noise(x * .55, z * .55)) * smooth(1, 1.6, edge);
}
