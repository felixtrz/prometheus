/**
 * Pure creature steering and decision helpers. No imports, no allocation: every
 * point-returning helper writes into a caller-owned `out` object. Unit-tested in
 * tests/creature-ai.test.mjs.
 *
 * Conventions: headings are rotation.y values, so heading 0 faces +Z and a
 * creature at heading h moves along (sin h, cos h) in XZ.
 */

export interface XZ { x: number; z: number }
export interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }

export const TAU = Math.PI * 2;

/** Wrap an angle into [-π, π]. */
export function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/** Heading that faces from (fromX, fromZ) toward (toX, toZ). */
export function headingTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

/** Turn `heading` toward `target` by at most `maxStep` radians, the short way round. */
export function turnToward(heading: number, target: number, maxStep: number): number {
  const delta = wrapAngle(target - heading);
  return wrapAngle(heading + Math.max(-maxStep, Math.min(maxStep, delta)));
}

/** Move `value` toward `target` by at most `maxStep`. */
export function approach(value: number, target: number, maxStep: number): number {
  return value < target ? Math.min(target, value + maxStep) : Math.max(target, value - maxStep);
}

export function horizontalDistance(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

/** Deterministic hash of a number into [0, 1). */
export function hash01(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export interface FleeRule {
  /** Flee at any player speed inside this radius. */
  panicRadius: number;
  /** Flee inside this radius only when the player hurries. */
  hurryRadius: number;
  /** Horizontal player speed (m/s) that counts as hurrying. */
  hurrySpeed: number;
}

/** "The deer don't fear us, only our hurry." */
export function shouldFlee(distance: number, playerSpeed: number, rule: FleeRule): boolean {
  return distance < rule.panicRadius || (distance < rule.hurryRadius && playerSpeed > rule.hurrySpeed);
}

/** Point on a circle of `radius` around (cx, cz) at bearing `angle` (0 = +Z). */
export function ringPoint(cx: number, cz: number, radius: number, angle: number, out: XZ): XZ {
  out.x = cx + Math.sin(angle) * radius;
  out.z = cz + Math.cos(angle) * radius;
  return out;
}

/**
 * Prowl target: the point on the ring that leads the creature's current bearing
 * around the centre by `lead` radians in `direction` (+1 or −1).
 */
export function ringTarget(
  x: number, z: number, cx: number, cz: number, radius: number, lead: number, direction: number, out: XZ,
): XZ {
  return ringPoint(cx, cz, radius, Math.atan2(x - cx, z - cz) + lead * direction, out);
}

/** Push `p` radially out of a disc. Returns true when it moved. */
export function pushOutside(p: XZ, cx: number, cz: number, radius: number): boolean {
  const dx = p.x - cx, dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-6) {
    p.x = cx;
    p.z = cz + radius;
  } else {
    p.x = cx + (dx / d) * radius;
    p.z = cz + (dz / d) * radius;
  }
  return true;
}

/** Clamp `p` inside bounds shrunk by `margin`. Returns true when it moved. */
export function clampToBounds(p: XZ, bounds: Bounds, margin: number): boolean {
  const x = Math.min(bounds.maxX - margin, Math.max(bounds.minX + margin, p.x));
  const z = Math.min(bounds.maxZ - margin, Math.max(bounds.minZ + margin, p.z));
  const moved = x !== p.x || z !== p.z;
  p.x = x;
  p.z = z;
  return moved;
}

/**
 * Steer around a forbidden disc. When the segment from (fromX, fromZ) to `target`
 * crosses the disc, the target is replaced by a point on a slightly larger circle,
 * `step` radians further round on the side the target lies. A start inside the
 * disc aims radially outward. Returns true when the target changed.
 */
export function detour(
  fromX: number, fromZ: number, target: XZ, cx: number, cz: number, radius: number, step: number, out: XZ,
): boolean {
  const fx = fromX - cx, fz = fromZ - cz;
  const fromDistance = Math.hypot(fx, fz);
  if (fromDistance < radius) {
    ringPoint(cx, cz, radius * 1.15, Math.atan2(fx, fz), out);
    return true;
  }
  const sx = target.x - fromX, sz = target.z - fromZ;
  const length2 = sx * sx + sz * sz;
  const t = length2 > 1e-9 ? Math.max(0, Math.min(1, -(fx * sx + fz * sz) / length2)) : 0;
  const px = fx + sx * t, pz = fz + sz * t;
  if (px * px + pz * pz >= radius * radius) {
    out.x = target.x;
    out.z = target.z;
    return false;
  }
  // Side of the target relative to the bearing centre → creature.
  const tx = target.x - cx, tz = target.z - cz;
  const side = fz * tx - fx * tz >= 0 ? 1 : -1;
  ringPoint(cx, cz, Math.max(fromDistance, radius * 1.15), Math.atan2(fx, fz) + side * step, out);
  return true;
}

/** Wander target inside a home disc; `seed` picks the point deterministically. */
export function wanderPoint(homeX: number, homeZ: number, radius: number, seed: number, out: XZ): XZ {
  const angle = hash01(seed) * TAU;
  const r = radius * Math.sqrt(hash01(seed + 17.31));
  return ringPoint(homeX, homeZ, r, angle, out);
}

/** Flee target `distance` metres from (x, z) directly away from the threat, veered by `veer` radians. */
export function fleePoint(
  x: number, z: number, threatX: number, threatZ: number, distance: number, veer: number, out: XZ,
): XZ {
  const away = x === threatX && z === threatZ ? veer : Math.atan2(x - threatX, z - threatZ) + veer;
  return ringPoint(x, z, distance, away, out);
}

/** Night wolf count for a danger stage (table index clamped; negative stages → 0). */
export function wolvesFor(stage: number, table: readonly number[]): number {
  if (stage <= 0 || table.length === 0) return 0;
  return table[Math.min(table.length - 1, Math.floor(stage))];
}

export type AttackPhase = 'telegraph' | 'lunge' | 'done';

/** Wolf attack schedule from the elapsed seconds since the telegraph began. */
export function attackPhase(elapsed: number, telegraphSeconds: number, lungeSeconds: number): AttackPhase {
  if (elapsed < telegraphSeconds) return 'telegraph';
  if (elapsed < telegraphSeconds + lungeSeconds) return 'lunge';
  return 'done';
}

/** A lunge bites when the player's head is within `reach` metres horizontally. */
export function biteLands(wolfX: number, wolfZ: number, headX: number, headZ: number, reach: number): boolean {
  return horizontalDistance(wolfX, wolfZ, headX, headZ) <= reach;
}

/**
 * Where a lunge ends: `stop` metres short of the locked target along the line from
 * the wolf, never behind the wolf's start.
 */
export function lungeEnd(wolfX: number, wolfZ: number, targetX: number, targetZ: number, stop: number, out: XZ): XZ {
  const dx = targetX - wolfX, dz = targetZ - wolfZ;
  const d = Math.hypot(dx, dz);
  const travel = Math.max(0, d - stop);
  if (d < 1e-6) {
    out.x = wolfX;
    out.z = wolfZ;
  } else {
    out.x = wolfX + (dx / d) * travel;
    out.z = wolfZ + (dz / d) * travel;
  }
  return out;
}

export type WolfIntent = 'prowl' | 'stalk' | 'attack';

/**
 * What a free wolf wants: circle the fire while the player is inside a lit-fire
 * radius (or out of range), stalk an exposed player in range, and start an attack
 * once close enough.
 */
export function wolfIntent(
  playerSafe: boolean, distanceToPlayer: number, stalkRange: number, attackRange: number,
): WolfIntent {
  if (playerSafe || distanceToPlayer > stalkRange) return 'prowl';
  return distanceToPlayer <= attackRange ? 'attack' : 'stalk';
}

/** Exponential smoothing factor for a time constant, frame-rate independent. */
export function smoothing(delta: number, timeConstant: number): number {
  return timeConstant <= 0 ? 1 : 1 - Math.exp(-delta / timeConstant);
}

/**
 * True when (toX, toZ) lies inside the viewer's forward cone: the dot product of the
 * horizontal view direction (fx, fz, need not be normalised) and the direction to the
 * point exceeds `minDot`.
 */
export function inView(
  fx: number, fz: number, fromX: number, fromZ: number, toX: number, toZ: number, minDot: number,
): boolean {
  const f = Math.hypot(fx, fz), dx = toX - fromX, dz = toZ - fromZ, d = Math.hypot(dx, dz);
  if (f < 1e-6 || d < 1e-6) return true;
  return (fx * dx + fz * dz) / (f * d) > minDot;
}

/** How many wolves may telegraph/lunge at once: packs flank from `flankFromStage`. */
export function attackSlots(stage: number, flankFromStage: number): number {
  return stage >= flankFromStage ? 2 : 1;
}

/** Number of guardian wave thresholds at or below `progress` (0 when idle). */
export function wavesReached(progress: number, waves: readonly number[]): number {
  if (progress <= 0) return 0;
  let count = 0;
  for (const threshold of waves) if (progress >= threshold) count++;
  return count;
}

/**
 * Night wolves due `secondsIntoNight` after nightfall (negative in late dusk): the
 * sum of every wave in `waves[stage]` whose `waveAt` time has come. Stages past the
 * table use its last row; negative stages get none.
 */
export function nightWolvesDue(
  stage: number, secondsIntoNight: number, waveAt: readonly number[], waves: readonly (readonly number[])[],
): number {
  if (stage <= 0 || waves.length === 0) return 0;
  const row = waves[Math.min(waves.length - 1, Math.floor(stage))];
  let due = 0;
  for (let i = 0; i < row.length && i < waveAt.length; i++) if (secondsIntoNight >= waveAt[i]) due += row[i];
  return due;
}

/**
 * How a torch flame at (fx, fz) wards the point (x, z): 2 = right at the flame (any
 * side, within `closeRadius`), 1 = in front of it (within `reach` and inside the cone
 * of half-angle acos(`coneCos`) around the pointing axis (ax, az)), 0 = not warded.
 * A zero axis (a torch lying loose) wards only at the flame.
 */
export function torchWard(
  x: number, z: number, fx: number, fz: number, ax: number, az: number, reach: number, coneCos: number, closeRadius: number,
): number {
  const dx = x - fx, dz = z - fz;
  const d = Math.hypot(dx, dz);
  if (d < closeRadius) return 2;
  if (d >= reach) return 0;
  const a = Math.hypot(ax, az);
  if (a < 1e-6) return 0;
  return (ax * dx + az * dz) / (a * d) > coneCos ? 1 : 0;
}

/**
 * Bearing of (x, z) around the player at (px, pz), measured from the direction the
 * player's torch points (ax, az): 0 = straight in front of the flame, ±π = at the back.
 */
export function bearingFromAxis(px: number, pz: number, ax: number, az: number, x: number, z: number): number {
  return wrapAngle(Math.atan2(x - px, z - pz) - Math.atan2(ax, az));
}

/**
 * May a wolf start its warning crouch now? Not until `gap` seconds after the last
 * attack ended, and not within `biteCooldown` of the last bite on the player.
 */
export function attackReady(now: number, lastAttackEnd: number, lastBite: number, gap: number, biteCooldown: number): boolean {
  return now - lastAttackEnd >= gap && now - lastBite >= biteCooldown;
}

/** Unsigned angle (0..π) between two bearings. */
export function angularGap(a: number, b: number): number {
  return Math.abs(wrapAngle(a - b));
}

/**
 * Where a finale guardian crouches to press the beacon at (bx, bz): on a ring of
 * `ring` metres round it, on the far side from the player at (px, pz), turned
 * `offset` radians off the far point (so several spread round the brazier).
 */
export function pressSpot(bx: number, bz: number, px: number, pz: number, ring: number, offset: number, out: XZ): XZ {
  const away = px === bx && pz === bz ? Math.PI : Math.atan2(px - bx, pz - bz) + Math.PI;
  return ringPoint(bx, bz, ring, away + offset, out);
}

/** Spread of the press spots: the n-th guardian's offset as a fraction of the half-arc (0, ±.5, ±1, ±.25, ±.75, …). */
export function pressOffset(n: number): number {
  const order = [0, .5, -.5, 1, -1, .25, -.25, .75, -.75];
  return order[((n % order.length) + order.length) % order.length];
}

export type FeintPhase = 'in' | 'snap' | 'out';

/** A feint's beat from the elapsed seconds: dart in, snap at the flame, hop back out. */
export function feintPhase(elapsed: number, inSeconds: number, snapSeconds: number): FeintPhase {
  if (elapsed < inSeconds) return 'in';
  if (elapsed < inSeconds + snapSeconds) return 'snap';
  return 'out';
}

/**
 * How far (m) the point (x, y, z), given in a carcass's own frame, lies outside a
 * capsule along local Z from z0 to z1 at height y0 with radius `radius` (negative inside).
 */
export function capsuleGap(x: number, y: number, z: number, y0: number, z0: number, z1: number, radius: number): number {
  const cz = Math.min(z1, Math.max(z0, z));
  return Math.hypot(x, y - y0, z - cz) - radius;
}

export type BladeContact = 'blow' | 'rearm' | 'none';

/**
 * An axe blade against a target (gather-style arming): a brisk swing (`speed` over
 * `minSpeed`) whose edge comes within `contact` of the surface lands a blow if the
 * target is armed; pulling the blade back beyond `rearm` arms it again.
 */
export function bladeContact(gap: number, speed: number, armed: boolean, contact: number, rearm: number, minSpeed: number): BladeContact {
  if (gap > rearm) return 'rearm';
  if (gap < contact && speed > minSpeed && armed) return 'blow';
  return 'none';
}
