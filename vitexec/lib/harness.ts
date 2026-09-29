/**
 * In-page harness for vitexec gameplay checks.
 *
 * Plays the game the way a player does: it drives the IWER emulator the IWSDK dev
 * plugin injects (window.IWER_DEVICE) — headset and controller poses, trigger and
 * squeeze — through the app's normal XR session, then reads ECS state to assert the
 * outcome. Positions are world-space; the harness converts them into the player
 * rig's tracking space, so respawns and rig moves never skew a reach.
 *
 * State writes are reserved for fixtures (skipping the clock to night, topping up
 * fuel) and are logged as such. Outcomes are never written, only observed.
 *
 * Scripts import this module by its absolute URL: `/vitexec/lib/harness.ts`.
 */
import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import type { Entity, World } from '@iwsdk/core';
import { bus, type GameEvent } from '/src/game/bus.ts';
import { GameState, Held, Item } from '/src/game/components.ts';
import { ItemSystem } from '/src/game/systems/item-system.ts';

export type V3 = readonly [number, number, number];
export type Q4 = readonly [number, number, number, number];
export type Hand = 'left' | 'right';
type DeviceName = Hand | 'head';
type AnyComponent = Parameters<Entity['hasComponent']>[0];

/** A level hand: controller pointing forward, palm down. */
export const LEVEL: Q4 = [0, 0, 0, 1];
/** Hands move no faster than a brisk human reach, so grabs hold through long carries. */
const MAX_HAND_SPEED = 6;
/** Horizontal arm's reach from the head (m); farther hand targets make the player walk. */
const REACH = 1.2;
const UP = new Vector3(0, 1, 0);

export let world: World;
// IWER's XRDevice: typed loosely, it is the dev plugin's injected instance.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let xr: any;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/** Poll `check` every frame until it holds or `ms` passes; resolves whether it held. */
export async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (check()) return true;
    await nextFrame();
  }
  return check();
}

export async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  if (!(await waitFor(check, ms))) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
}

// ---------------------------------------------------------------- reporting

let checks = 0;
const started = performance.now();

export function section(title: string): void {
  console.log(`${title}`);
}

export function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(`FAIL: ${message}`);
  checks++;
  console.log(`  ✓ ${message}`);
}

export function note(message: string): void {
  console.log(`  · ${message}`);
}

/**
 * Evidence screenshot: the runner saves the page as <shots dir>/<name>.png when run
 * with --shots (a no-op otherwise). Give the frame a moment to settle first.
 */
export async function shot(name: string): Promise<void> {
  const save = (window as unknown as { __vitexecShot?: (name: string) => Promise<void> }).__vitexecShot;
  if (!save) return;
  await nextFrame();
  await nextFrame();
  await save(name);
  console.log(`  📷 ${name}`);
}

export function done(name: string): void {
  console.log(`${name}: PASS (${checks} checks, ${((performance.now() - started) / 1000).toFixed(0)} s)`);
}

/** Every bus event since boot, for asserting cues (sounds, toasts, story beats). */
export const events: GameEvent[] = [];
export const eventsOf = <T extends GameEvent['type']>(type: T) =>
  events.filter((event): event is Extract<GameEvent, { type: T }> => event.type === type);

// ---------------------------------------------------------------- session

export async function boot(): Promise<void> {
  const host = window as unknown as { FRAMEWORK_MCP_RUNTIME?: { world: World }; IWER_DEVICE?: unknown };
  await until(() => Boolean(host.FRAMEWORK_MCP_RUNTIME?.world && host.IWER_DEVICE), 60_000, 'the IWSDK world and IWER');
  world = host.FRAMEWORK_MCP_RUNTIME!.world;
  xr = host.IWER_DEVICE;
  await until(() => all(GameState).length > 0 && all(Item).length > 10, 60_000, 'the level to load');
  bus.onAny((event) => events.push(event));
}

/** Accept the app's session offer (iwsdk.config.json `xr.offer: once`), as a player would. */
export async function enterXR(): Promise<void> {
  if (!xr.activeSession) {
    await until(() => xr.sessionOffered, 20_000, 'the XR session offer');
    xr.grantOfferedSession();
  }
  await until(() => world.visibilityState.peek() === 'visible', 20_000, 'an immersive session');
  // In 'manual' mode IWER's DevUI rewrites every pose each frame; take the controls.
  xr.controlMode = 'programmatic';
  await sleep(500);
}

// ---------------------------------------------------------------- poses

const device = (name: DeviceName) => (name === 'head' ? xr : xr.controllers[name]);

function rig() {
  world.player.updateMatrixWorld(true);
  return world.player;
}

const rigQuat = new Quaternion();
function toTrackingQuat(q: Q4, out: Quaternion): Quaternion {
  rig().getWorldQuaternion(rigQuat);
  return out.set(q[0], q[1], q[2], q[3]).premultiply(rigQuat.invert());
}

/** World position of a device pose (controller origin or headset). */
export function poseWorld(name: DeviceName): Vector3 {
  const d = device(name);
  return rig().localToWorld(new Vector3(d.position.x, d.position.y, d.position.z));
}

/** The rendered head position (the XR camera), in world space. */
export function head(): Vector3 {
  return world.camera.getWorldPosition(new Vector3());
}

/**
 * Glide a device to a world point (and optionally a world orientation) with an
 * ease-in-out profile, one pose per frame, like a reaching hand.
 */
export async function move(name: DeviceName, to: V3, options: { seconds?: number; quat?: Q4; reach?: boolean } = {}): Promise<void> {
  // Honest reach: a hand never stretches past arm's length; the player walks up first.
  if (name !== 'head' && options.reach !== false && horizontal(head(), to) > REACH) await approach(to, .75);
  const d = device(name);
  const from = new Vector3(d.position.x, d.position.y, d.position.z);
  const target = rig().worldToLocal(new Vector3(to[0], to[1], to[2]));
  const q0 = new Quaternion(d.quaternion.x, d.quaternion.y, d.quaternion.z, d.quaternion.w);
  const q1 = options.quat ? toTrackingQuat(options.quat, new Quaternion()) : q0.clone();
  const ms = Math.max(options.seconds ?? .5, from.distanceTo(target) / MAX_HAND_SPEED) * 1000;
  const at = new Vector3();
  const q = new Quaternion();
  const start = performance.now();
  for (;;) {
    const t = Math.min(1, (performance.now() - start) / ms);
    const s = t * t * (3 - 2 * t);
    at.lerpVectors(from, target, s);
    q.slerpQuaternions(q0, q1, s);
    d.position.set(at.x, at.y, at.z);
    d.quaternion.set(q.x, q.y, q.z, q.w);
    if (t >= 1) break;
    await nextFrame();
  }
  await nextFrame();
}

/** Walk the headset to a world point (room-scale), keeping head height unless given. */
export async function walk(to: readonly [number, number] | V3, seconds = .5): Promise<void> {
  const y = to.length === 3 ? to[1] : head().y;
  const x = to[0], z = to.length === 3 ? to[2] : to[1];
  await move('head', [x, y, z], { seconds });
}

type Target2 = readonly [number, number] | (() => readonly [number, number]);

/**
 * Thumbstick locomotion (left stick slides relative to head yaw, forward = -y).
 * Turns the head toward the goal, then steers the head to a world (x, z) — a fixed
 * point or a moving one — easing off near it. `speed` caps the stick (1 = full
 * slidingSpeed). A stall against a collider sidesteps and retries.
 */
export async function locomote(
  to: Target2,
  options: { tolerance?: number; speed?: number; ms?: number; stopWhen?: () => boolean } = {},
): Promise<void> {
  const { tolerance = .3, speed = 1, ms = 30_000, stopWhen } = options;
  const goal = typeof to === 'function' ? to : () => to;
  const stick = xr.controllers.left;
  const headQuat = new Quaternion();
  const yaw = new Quaternion();
  const dir = new Vector3();
  const end = performance.now() + ms;
  const first = goal();
  const eye = head();
  await look([first[0], eye.y, first[1]], .25);
  let bestDistance = Infinity;
  let bestAt = performance.now();
  let sidestep = 0;
  try {
    for (;;) {
      const at = head();
      const [gx, gz] = goal();
      dir.set(gx - at.x, 0, gz - at.z);
      const distance = dir.length();
      if (distance < tolerance || stopWhen?.()) return;
      const now = performance.now();
      if (now > end) throw new Error(`locomotion stalled at ${at.x.toFixed(1)},${at.z.toFixed(1)}, ${distance.toFixed(2)} m from ${gx.toFixed(1)},${gz.toFixed(1)}`);
      if (distance < bestDistance - .05) { bestDistance = distance; bestAt = now; }
      else if (now - bestAt > 1000 && sidestep <= 0) { sidestep = 700; bestAt = now; }
      world.camera.getWorldQuaternion(headQuat);
      const forward = new Vector3(0, 0, -1).applyQuaternion(headQuat);
      yaw.setFromAxisAngle(UP, Math.atan2(-forward.x, -forward.z));
      dir.normalize();
      if (sidestep > 0) {
        // Blocked: slide along the obstacle (perpendicular, keeping some headway).
        dir.set(dir.x * .3 - dir.z, 0, dir.z * .3 + dir.x).normalize();
        sidestep -= 16;
      }
      dir.applyQuaternion(yaw.invert()).multiplyScalar(Math.min(speed, .25 + distance / 1.5));
      stick.updateAxes('thumbstick', Math.max(-1, Math.min(1, dir.x)), Math.max(-1, Math.min(1, dir.z)));
      await nextFrame();
    }
  } finally {
    stick.updateAxes('thumbstick', 0, 0);
    await sleep(150);
  }
}

/** Walk (thumbstick) to stand `distance` m short of a world point, facing it. */
export async function approach(point: V3 | Vector3, distance = .7, options: { speed?: number } = {}): Promise<void> {
  const [px, py, pz] = Array.isArray(point) ? point : [(point as Vector3).x, (point as Vector3).y, (point as Vector3).z];
  const at = head();
  const dx = at.x - px, dz = at.z - pz;
  const length = Math.hypot(dx, dz) || 1;
  if (length > distance + .25) {
    await locomote([px + dx / length * distance, pz + dz / length * distance], { tolerance: .2, ...options });
  }
  await look([px, Math.min(py, head().y - .3), pz]);
}

/** Bring a hand back to a relaxed carry pose beside the body. */
export async function rest(hand: Hand, seconds = .4): Promise<void> {
  const eye = head();
  const forward = new Vector3(0, 0, -1).applyQuaternion(world.camera.getWorldQuaternion(new Quaternion()));
  forward.y = 0;
  forward.normalize();
  const side = hand === 'right' ? 1 : -1;
  const right = new Vector3(-forward.z, 0, forward.x);
  // Controller level and pointing where the player faces.
  const yaw = new Quaternion().setFromAxisAngle(UP, Math.atan2(-forward.x, -forward.z));
  await move(hand, [
    eye.x + right.x * .22 * side + forward.x * .3,
    eye.y - .5,
    eye.z + right.z * .22 * side + forward.z * .3,
  ], { seconds, quat: [yaw.x, yaw.y, yaw.z, yaw.w], reach: false });
}

/** Turn the headset to look at a world point. */
export async function look(target: V3, seconds = .3): Promise<void> {
  const eye = head();
  const m = new Matrix4().lookAt(eye, new Vector3(target[0], target[1], target[2]), UP);
  const q = new Quaternion().setFromRotationMatrix(m);
  await move('head', [eye.x, eye.y, eye.z], { seconds, quat: [q.x, q.y, q.z, q.w] });
}

// ---------------------------------------------------------------- buttons

export function squeeze(hand: Hand, value: number): void {
  xr.controllers[hand].updateButtonValue('squeeze', value);
}

export function trigger(hand: Hand, value: number): void {
  xr.controllers[hand].updateButtonValue('trigger', value);
}

/** Point a controller's ray at a world point and pull the trigger `times`. */
export async function clickAt(point: V3 | Vector3, hand: Hand = 'left', times = 1): Promise<void> {
  const target = Array.isArray(point) ? new Vector3(point[0], point[1], point[2]) : (point as Vector3);
  const eye = poseWorld(hand);
  const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, target, UP));
  await move(hand, [eye.x, eye.y, eye.z], { seconds: .25, quat: [q.x, q.y, q.z, q.w], reach: false });
  await sleep(250);
  for (let i = 0; i < times; i++) {
    trigger(hand, 1);
    await sleep(150);
    trigger(hand, 0);
    await sleep(350);
  }
}

/** World position of a named scene object (UIKit elements, props). */
export function locate(name: string): Vector3 {
  const object = world.scene.getObjectByName(name);
  if (!object) throw new Error(`no object named ${name}`);
  return object.getWorldPosition(new Vector3());
}

// ---------------------------------------------------------------- ECS reads

export function all(...components: AnyComponent[]): Entity[] {
  const out: Entity[] = [];
  const lookup = (world.entityManager as unknown as { indexLookup: (Entity | undefined)[] }).indexLookup;
  for (const entity of lookup) {
    if (entity?.active && components.every((component) => entity.hasComponent(component))) out.push(entity);
  }
  return out;
}

export function one(component: AnyComponent): Entity {
  const entity = all(component)[0];
  if (!entity) throw new Error(`no ${component.id} entity`);
  return entity;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function read(entity: Entity, component: AnyComponent): Record<string, any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = {};
  const schema = (component as unknown as { schema: Record<string, { type: string }> }).schema;
  for (const [key, field] of Object.entries(schema)) {
    out[key] = /^(Vec[234]|Color)$/.test(field.type)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? Array.from(entity.getVectorView(component as any, key as never) as Float32Array)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : entity.getValue(component as any, key as never);
  }
  return out;
}

/** Values of a singleton component (GameState, Campfire, CraftBench, Backpack). */
export const state = (component: AnyComponent) => read(one(component), component);

/** Fixture write: sets up a situation (time of day, fuel); never used to fake an outcome. */
export function fixture(component: AnyComponent, field: string, value: unknown, entity = one(component)): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entity.setValue(component as any, field as never, value as never);
  note(`fixture: ${component.id}.${field} = ${JSON.stringify(value)}`);
}

export function worldPos(entity: Entity): Vector3 {
  const object = entity.object3D;
  if (!object) throw new Error(`entity ${entity.index} has no object`);
  return object.getWorldPosition(new Vector3());
}

export function horizontal(a: Vector3 | V3, b: Vector3 | V3): number {
  const [ax, az] = Array.isArray(a) ? [a[0], a[2]] : [(a as Vector3).x, (a as Vector3).z];
  const [bx, bz] = Array.isArray(b) ? [b[0], b[2]] : [(b as Vector3).x, (b as Vector3).z];
  return Math.hypot(ax - bx, az - bz);
}

export type ItemInfo = {
  entity: Entity; kind: string; slot: string; charges: number; lit: boolean; variant: string; uid: string;
  position: Vector3; held: boolean;
};

export function info(entity: Entity): ItemInfo {
  const values = read(entity, Item);
  return {
    entity,
    kind: values.kind, slot: values.slot, charges: values.charges, lit: values.lit, variant: values.variant, uid: values.uid,
    position: worldPos(entity),
    held: entity.hasComponent(Held),
  };
}

export const items = (filter: (item: ItemInfo) => boolean = () => true) => all(Item).map(info).filter(filter);

export function item(filter: (item: ItemInfo) => boolean, what = 'item'): ItemInfo {
  const match = items(filter)[0];
  if (!match) throw new Error(`no ${what} matches`);
  return match;
}

/** Narrow a filter to the single matching item closest to a world point. */
export function nearest(filter: (item: ItemInfo) => boolean, point: V3 | Vector3): (item: ItemInfo) => boolean {
  const target = Array.isArray(point) ? new Vector3(point[0], point[1], point[2]) : (point as Vector3);
  let best: Entity | undefined;
  let bestDistance = Infinity;
  for (const candidate of items(filter)) {
    const distance = candidate.position.distanceTo(target);
    if (distance < bestDistance) { bestDistance = distance; best = candidate.entity; }
  }
  return (item) => item.entity === best;
}

/** A loose item of this kind: not eaten, not locked into a bench bay, not a forage node. */
export const loose = (kind: string, extra: (item: ItemInfo) => boolean = () => true) => (item: ItemInfo) =>
  item.kind === kind && item.slot !== 'consumed' && !item.slot.startsWith('bay-') && item.slot !== 'node' && extra(item);

export const same = (entity: Entity) => (item: ItemInfo) => item.entity === entity;

export function holder(entity: Entity): Hand | undefined {
  return world.getSystem(ItemSystem)?.handOf(entity);
}

// ---------------------------------------------------------------- hands on items

/**
 * Near-grab: open the hand, reach onto the item, squeeze, and confirm this hand
 * holds it. Re-approaches (re-reading the position) if the first squeeze misses.
 */
export async function grab(filter: (item: ItemInfo) => boolean, hand: Hand = 'right', what = 'item'): Promise<ItemInfo> {
  const target = item(filter, what);
  for (let approach = 0; approach < 3; approach++) {
    const p = worldPos(target.entity);
    squeeze(hand, 0);
    await move(hand, [p.x, p.y + .15, p.z], { seconds: .35, quat: LEVEL });
    await move(hand, [p.x, p.y, p.z], { seconds: .3, quat: LEVEL });
    await sleep(100);
    squeeze(hand, 1);
    if (await waitFor(() => target.entity.hasComponent(Held) && holder(target.entity) === hand, 900)) {
      await sleep(160); // the item eases into its hold pose
      return info(target.entity);
    }
  }
  throw new Error(`grab failed: ${target.kind} ${target.uid}`);
}

export async function release(hand: Hand = 'right'): Promise<void> {
  squeeze(hand, 0);
  await sleep(250);
}

/** World position of a point given in the held item's local frame (a blade tip, a hammer face). */
export function local(entity: Entity, point: V3): Vector3 {
  const object = entity.object3D!;
  object.updateMatrixWorld(true);
  return object.localToWorld(new Vector3(point[0], point[1], point[2]));
}

/**
 * Move the hand so a point of the held item (local frame) lands on a world target,
 * keeping the current grip orientation.
 */
export async function bring(hand: Hand, entity: Entity, point: V3, target: V3, seconds = .5, reach = true): Promise<void> {
  if (reach && horizontal(head(), target) > REACH) await approach(target, .75);
  const tip = local(entity, point);
  const pose = poseWorld(hand);
  await move(hand, [pose.x + target[0] - tip.x, pose.y + target[1] - tip.y, pose.z + target[2] - tip.z], { seconds, reach: false });
}

/**
 * Turn the hand in place until the held item has this world orientation
 * (e.g. identity: an item upright as modelled). The grip offset stays rigid.
 */
export async function turnHeld(hand: Hand, entity: Entity, quat: Q4, seconds = .35): Promise<void> {
  const d = xr.controllers[hand];
  const handWorld = rig().getWorldQuaternion(new Quaternion())
    .multiply(new Quaternion(d.quaternion.x, d.quaternion.y, d.quaternion.z, d.quaternion.w));
  const itemWorld = entity.object3D!.getWorldQuaternion(new Quaternion());
  // Hand-from-item stays fixed while held: hand' = item' * (item^-1 * hand).
  const grip = itemWorld.invert().multiply(handWorld);
  const next = new Quaternion(quat[0], quat[1], quat[2], quat[3]).multiply(grip);
  const pose = poseWorld(hand);
  await move(hand, [pose.x, pose.y, pose.z], { seconds, quat: [next.x, next.y, next.z, next.w], reach: false });
  await sleep(100);
}

/** Carry the held item high over the terrain (a grab lets go if the hand goes underground). */
export async function carry(hand: Hand, to: V3, seconds = .5): Promise<void> {
  const from = poseWorld(hand);
  const high = Math.max(4.5, from.y, to[1]);
  await move(hand, [from.x, high, from.z], { seconds: .3, quat: LEVEL, reach: false });
  await move(hand, [to[0], high, to[2]], { seconds, quat: LEVEL, reach: false });
  await move(hand, to, { seconds: .4, quat: LEVEL, reach: false });
}
