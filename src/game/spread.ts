/**
 * Keeping loose items apart (pure maths for ItemSystem and its unit test). Each resting
 * item has a Footprint: its bounds box, turned into world space and flattened onto the
 * ground as an oriented rectangle, plus the box's height range so items on a table never
 * collide with items on the floor under it. Two footprints overlap when the separating
 * axis test finds no gap on any of their four axes; the push that clears them is the
 * shallowest of those overlaps. Nothing here allocates.
 */
export type Footprint = {
  /** Bounds centre in world space. */
  x: number; y: number; z: number;
  /** Unit long axis on the ground; the short axis is its perpendicular (-uz, ux). */
  ux: number; uz: number;
  /** Half extents along the long axis, the short axis, and up. */
  hu: number; hv: number; hy: number;
};
/** A horizontal displacement (m). */
export type Shift = { x: number; z: number };
/** Whether a footprint shifted by (dx, dz) from where it lies may rest there (ground, walls, fire). */
export type SpotTest = (dx: number, dz: number) => boolean;

export const footprint = (): Footprint => ({ x: 0, y: 0, z: 0, ux: 1, uz: 0, hu: 0, hv: 0, hy: 0 });

/** Below this, an overlap (or a shift) counts as none (m). */
const EPSILON = 1e-6;
/** Golden angle: successive spiral points never line up. */
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const scratch: Shift = { x: 0, z: 0 };

/**
 * Footprint of a local box [min, max] under a column-major 4x4 matrix (three's
 * Matrix4.elements). The rectangle hugs the box's shadow along the box axis that lies
 * longest on the ground, and contains the whole shadow.
 */
export function boxFootprint(
  out: Footprint, m: ArrayLike<number>,
  minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
): Footprint {
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const hx = (maxX - minX) / 2, hy = (maxY - minY) / 2, hz = (maxZ - minZ) / 2;
  out.x = m[0] * cx + m[4] * cy + m[8] * cz + m[12];
  out.y = m[1] * cx + m[5] * cy + m[9] * cz + m[13];
  out.z = m[2] * cx + m[6] * cy + m[10] * cz + m[14];
  // The box's three half axes in world space.
  const ax = m[0] * hx, ay = m[1] * hx, az = m[2] * hx;
  const bx = m[4] * hy, by = m[5] * hy, bz = m[6] * hy;
  const qx = m[8] * hz, qy = m[9] * hz, qz = m[10] * hz;
  out.hy = Math.abs(ay) + Math.abs(by) + Math.abs(qy);
  const la = ax * ax + az * az, lb = bx * bx + bz * bz, lq = qx * qx + qz * qz;
  let ux = ax, uz = az, length = la;
  if (lb > length) { ux = bx; uz = bz; length = lb; }
  if (lq > length) { ux = qx; uz = qz; length = lq; }
  if (length < EPSILON * EPSILON) { ux = 1; uz = 0; length = 1; }
  length = Math.sqrt(length);
  ux /= length; uz /= length;
  out.ux = ux; out.uz = uz;
  out.hu = Math.abs(ax * ux + az * uz) + Math.abs(bx * ux + bz * uz) + Math.abs(qx * ux + qz * uz);
  out.hv = Math.abs(-ax * uz + az * ux) + Math.abs(-bx * uz + bz * ux) + Math.abs(-qx * uz + qz * ux);
  return out;
}

/** Half width of a footprint measured along unit direction (nx, nz). */
function extent(f: Footprint, nx: number, nz: number): number {
  return f.hu * Math.abs(f.ux * nx + f.uz * nz) + f.hv * Math.abs(-f.uz * nx + f.ux * nz);
}

/** Radius of the circle around a footprint's centre that holds it. */
export const reachOf = (f: Footprint): number => Math.hypot(f.hu, f.hv);

/**
 * The shallowest shift that moves `a` clear of `b` with `gap` between them, written to
 * `out`. False (and a zero shift) when they are already that far apart, or at heights that
 * cannot touch. Coincident centres push along +axis, deterministically.
 */
export function pushApart(a: Footprint, b: Footprint, gap: number, out: Shift): boolean {
  out.x = out.z = 0;
  if (Math.abs(a.y - b.y) >= a.hy + b.hy) return false;
  const dx = a.x - b.x, dz = a.z - b.z;
  let best = Infinity, nx = 0, nz = 0;
  for (let axis = 0; axis < 4; axis++) {
    const f = axis < 2 ? a : b;
    const ax = axis % 2 ? -f.uz : f.ux, az = axis % 2 ? f.ux : f.uz;
    const d = dx * ax + dz * az;
    const overlap = extent(a, ax, az) + extent(b, ax, az) + gap - Math.abs(d);
    if (overlap <= EPSILON) return false;
    if (overlap < best) {
      best = overlap;
      const sign = d < 0 ? -1 : 1;
      nx = ax * sign; nz = az * sign;
    }
  }
  out.x = nx * best; out.z = nz * best;
  return true;
}

/** Whether `a` keeps at least `gap` from each of the first `count` footprints. */
export function isClear(a: Footprint, others: readonly Footprint[], count: number, gap: number): boolean {
  for (let i = 0; i < count; i++) if (pushApart(a, others[i], gap, scratch)) return false;
  return true;
}

/**
 * Push `a` out of the others (which stay put), one overlap at a time, for up to `rounds`
 * passes. The total shift goes to `out`; `a` is left where it was. True when the shifted
 * footprint is clear by `gap`.
 */
export function resolveOverlap(a: Footprint, others: readonly Footprint[], count: number, gap: number, out: Shift, rounds = 6): boolean {
  const x0 = a.x, z0 = a.z;
  let moved = true;
  for (let round = 0; round < rounds && moved; round++) {
    moved = false;
    for (let i = 0; i < count; i++) {
      if (!pushApart(a, others[i], gap, scratch)) continue;
      a.x += scratch.x; a.z += scratch.z;
      moved = true;
    }
  }
  // Out of rounds while still moving: judge where it ended up (half the gap will do).
  const clear = !moved || isClear(a, others, count, gap * .5);
  out.x = a.x - x0; out.z = a.z - z0;
  a.x = x0; a.z = z0;
  return clear;
}

/** The i-th point of a sunflower spiral (nearest first) with `step` spacing, about the origin. */
export function spiralPoint(i: number, step: number, out: Shift): Shift {
  const r = step * Math.sqrt(i), t = i * GOLDEN;
  out.x = r * Math.cos(t); out.z = r * Math.sin(t);
  return out;
}

/**
 * The nearest shift (spiral search, `tries` points `step` apart, starting with no shift)
 * at which `a` is clear of the others by `gap` and `accept` allows the spot. Written to
 * `out`; false (zero shift) when none of the points will do. `a` is left where it was.
 */
export function freeSpot(
  a: Footprint, others: readonly Footprint[], count: number, gap: number,
  step: number, tries: number, accept: SpotTest, out: Shift,
): boolean {
  const x0 = a.x, z0 = a.z;
  let found = false;
  for (let i = 0; i < tries && !found; i++) {
    spiralPoint(i, step, out);
    a.x = x0 + out.x; a.z = z0 + out.z;
    found = accept(out.x, out.z) && isClear(a, others, count, gap);
  }
  a.x = x0; a.z = z0;
  if (!found) out.x = out.z = 0;
  return found;
}
