/**
 * Emulated-XR scenario helpers. Drive IWER controllers through the iwsdk CLI and
 * assert on ECS state. Requires a running `npm run dev` with a command-ready browser.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let tab;

export async function cli(domain, action, args = {}) {
  const input = tab && domain !== 'browser' ? { ...args, expectedTab: tab } : args;
  const { stdout } = await exec(process.execPath, ['node_modules/@iwsdk/cli/dist/cli.js', domain, action, '--input-json', JSON.stringify(input), '--raw'], { maxBuffer: 16_000_000 });
  const data = JSON.parse(stdout);
  if (data.error || data.ok === false) throw new Error(`${domain} ${action}: ${JSON.stringify(data).slice(0, 400)}`);
  if (data._tab) tab = data._tab;
  return data;
}

/** Pin every later call to the current runtime tab (fails fast if the page reloads). */
export async function pinRuntime() {
  tab = undefined;
  const status = await cli('xr', 'status');
  tab = status._tab;
  return status;
}

let origin = [0, 0, .4];
export async function syncOrigin() {
  const data = await cli('ecs', 'query', { entityIndex: 2, components: ['Transform'] });
  origin = data.components[0].values.position;
  return origin;
}
const rel = (p) => ({ x: p[0] - origin[0], y: p[1] - origin[1], z: p[2] - origin[2] });

export async function enterXR() {
  const status = await cli('xr', 'status');
  if (!status.sessionActive) await cli('xr', 'enter');
  await delay(600);
  await syncOrigin();
}

const lastAt = new Map();
/** Animate a device to a world point; long carries are slowed to a humanly plausible hand speed. */
export async function move(p, seconds = .5, orientation, device = 'controller-right') {
  const from = lastAt.get(device);
  const distance = from ? Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]) : 0;
  const duration = Math.max(seconds, distance / 6);
  lastAt.set(device, [...p]);
  await cli('xr', 'animate-to', { device, position: rel(p), duration, ...(orientation ? { orientation } : {}) });
}
export async function look(target) {
  await cli('xr', 'look-at', { device: 'headset', target: rel(target) });
}
export async function grip(value, device = 'controller-right') {
  await cli('xr', 'set-gamepad-state', { device, buttons: [{ index: 1, value }] });
}
export async function trigger(value, device = 'controller-right') {
  await cli('xr', 'set-gamepad-state', { device, buttons: [{ index: 0, value }] });
}

export async function find(components, namePattern) {
  return cli('ecs', 'find', { withComponents: components, ...(namePattern ? { namePattern } : {}), limit: 50 });
}
export async function query(entityIndex, components) {
  const data = await cli('ecs', 'query', { entityIndex, components });
  const out = {};
  for (const component of data.components) out[component.componentId] = component.values;
  return out;
}
export async function singleton(component) {
  const found = await find([component]);
  if (!found.total) throw new Error(`No ${component}`);
  return (await query(found.entities[0].entityIndex, [component]))[component];
}
export async function setOn(component, field, value) {
  const found = await find([component]);
  await cli('ecs', 'set-component', { entityIndex: found.entities[0].entityIndex, componentId: component, field, value });
}

/** Every Item entity with its Item values and world position. */
export async function items() {
  const found = await find(['Item']);
  const result = [];
  for (const entity of found.entities) {
    const data = await query(entity.entityIndex, ['Item', 'Transform']);
    result.push({ index: entity.entityIndex, name: entity.name, ...data.Item, position: data.Transform?.position, held: entity.componentIds.includes('Grabbed') });
  }
  return result;
}
export async function itemBy(predicate) {
  const list = await items();
  const match = list.find(predicate);
  if (!match) throw new Error('item not found');
  return match;
}

/** Near-grab an item: open hand, move onto it, squeeze, confirm Grabbed (one re-approach on a miss). */
export async function grab(predicate, device = 'controller-right', offset = [0, 0, 0]) {
  const target = await itemBy(predicate);
  for (let approach = 0; approach < 2; approach++) {
    // Re-read each approach: the item may still have been falling.
    const p = (await itemBy((item) => item.index === target.index)).position;
    await grip(0, device);
    await move([p[0] + offset[0], p[1] + offset[1] + .15, p[2] + offset[2]], .35, { x: 0, y: 0, z: 0, w: 1 }, device);
    await move([p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]], .3, { x: 0, y: 0, z: 0, w: 1 }, device);
    await delay(120);
    await grip(1, device);
    for (let attempt = 0; attempt < 6; attempt++) {
      await delay(150);
      const held = await find(['Item', 'Grabbed']);
      if (held.entities.some((entity) => entity.entityIndex === target.index)) return target;
    }
  }
  throw new Error(`grab failed: ${target.kind} ${target.uid}`);
}
export async function release(device = 'controller-right') {
  await grip(0, device);
  await delay(250);
}

export function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
  console.log(`  ✓ ${message}`);
}

function findNamed(node, name) {
  if (node.name === name) return node;
  for (const child of node.children || []) {
    const found = findNamed(child, name);
    if (found) return found;
  }
  return undefined;
}


/** Object3D uuid for an entity: walk down from the level root one level at a time (the tool caps node counts). */
export async function objectUuid(entityIndex) {
  const levelRoot = (await cli('ecs', 'find', { withComponents: ['LevelRoot'], limit: 2 })).entities[0].entityIndex;
  const top = await cli('scene', 'runtime-hierarchy', { maxDepth: 1 });
  const queue = [];
  for (const child of top.children || []) if (child.entityIndex === levelRoot || child.entityIndex === entityIndex) queue.push(child);
  for (let depth = 0; depth < 6 && queue.length; depth++) {
    const next = [];
    for (const node of queue) {
      if (node.entityIndex === entityIndex) return node.uuid;
      const sub = await cli('scene', 'runtime-hierarchy', { parentId: node.uuid, maxDepth: 1 });
      for (const child of sub.children || []) {
        if (child.entityIndex === entityIndex) return child.uuid;
        if (child.children?.length || child.entityIndex === undefined) next.push(child);
      }
    }
    queue.splice(0, queue.length, ...next.filter((n) => n.entityIndex === undefined).slice(0, 40));
  }
  throw new Error(`Missing object for entity ${entityIndex}`);
}

/** Resolve a named object inside an entity's subtree to a point relative to the XR origin. */
export async function locateNamed(name, rootEntityPattern = '^Camp Journal$') {
  const root = await cli('ecs', 'find', { namePattern: rootEntityPattern, limit: 5 });
  if (!root.total) throw new Error(`Missing root ${rootEntityPattern}`);
  const uuid = await objectUuid(root.entities[0].entityIndex);
  const tree = await cli('scene', 'runtime-hierarchy', { parentId: uuid, maxDepth: 40 });
  const target = findNamed(tree, name);
  if (!target) throw new Error(`Missing ${name}`);
  return (await cli('scene', 'transform', { uuid: target.uuid })).positionRelativeToXROrigin;
}

/** Aim the ray at a resolved point and pull the trigger `times` in quick succession. */
export async function clickAt([x, y, z], times = 1, device = 'controller-left') {
  await cli('xr', 'look-at', { device, target: { x, y, z } });
  await delay(350);
  for (let i = 0; i < times; i++) {
    await cli('xr', 'set-select-value', { device, value: 1 });
    await delay(150);
    await cli('xr', 'set-select-value', { device, value: 0 });
    await delay(350);
  }
}

/** Point the left controller ray at a named object inside an entity's subtree and pull the trigger. */
export async function clickNamed(name, rootEntityPattern = '^Camp Journal$', device = 'controller-left') {
  await clickAt(await locateNamed(name, rootEntityPattern), 1, device);
}

/** Two taps on the journal's New journey button, then re-pin the reloaded level. */
export async function newJourney() {
  // Start from a clean page: an aborted run can leave emulated input stuck mid-grab.
  await cli('browser', 'reload', {}).catch(() => {});
  await delay(9000);
  await pinRuntime();
  lastAt.clear();
  await enterXR();
  await move([1.2, 1.6, -1.2], .4, undefined, 'headset');
  // The button asks for a second tap within 4 s: resolve it once, then tap twice.
  await clickAt(await locateNamed('New Journey Button'), 2);
  await delay(2500);
  await syncOrigin();
}

/** Headset position in world space (IWER reports it relative to the XR origin). */
export async function headWorld() {
  await syncOrigin();
  const head = await cli('xr', 'get-transform', { device: 'headset' });
  return [origin[0] + head.position.x, origin[1] + head.position.y, origin[2] + head.position.z];
}

/** Ray-click an entity's own object (e.g. the bedroll) with the left controller. */
export async function clickEntity(namePattern, device = 'controller-left') {
  const found = await cli('ecs', 'find', { namePattern, limit: 5 });
  if (!found.total) throw new Error(`Missing ${namePattern}`);
  const uuid = await objectUuid(found.entities[0].entityIndex);
  const transform = await cli('scene', 'transform', { uuid });
  const [x, y, z] = transform.positionRelativeToXROrigin;
  await cli('xr', 'look-at', { device, target: { x, y: y + .12, z } });
  await delay(350);
  await cli('xr', 'set-select-value', { device, value: 1 });
  await delay(150);
  await cli('xr', 'set-select-value', { device, value: 0 });
  await delay(300);
}
