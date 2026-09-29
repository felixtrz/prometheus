/**
 * Oriented item-surface footprints: pure maths shared by ItemSystem (props tagged
 * ItemSurface, the unrolled pack) and its unit test. Same convention as
 * rules.ts surfaceHeight: `yawDeg` is the prop's rotation about +Y (three's
 * rotation.y), and a point is inside when its prop-local x/z are within hx/hz.
 */
export type Footprint = { x: number; z: number; hx: number; hz: number; yawDeg: number; y: number };

const DEG = Math.PI / 180;

/** Yaw (degrees) of a prop whose local +X axis points along world (dx, dz). */
export function yawFromXAxis(dx: number, dz: number): number {
  return Math.atan2(-dz, dx) / DEG;
}

/** Whether world (x, z) lies on the footprint. */
export function insideFootprint(s: Footprint, x: number, z: number): boolean {
  const yaw = s.yawDeg * DEG, dx = x - s.x, dz = z - s.z;
  const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  return Math.abs(lx) <= s.hx && Math.abs(lz) <= s.hz;
}
