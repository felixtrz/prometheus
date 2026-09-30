/**
 * Camp routines shared by the gameplay checks: standing at the bench, filling
 * bays, hammering a recipe, gathering raw materials, splitting a log on the stump,
 * lighting a torch at the fire.
 */
import { Quaternion, Vector3 } from '@iwsdk/core';
import { ITEMS } from '/src/game/catalog.ts';
import { Campfire, CraftBench } from '/src/game/components.ts';
import { CAMP, SURFACES } from '/src/game/rules.ts';
import {
  bring, check, grab, head, holder, holster, note, horizontal, info, item, items, locomote, look, loose, move, nearest, release, rest, same,
  sleep, state, stowOverShoulder, trigger, turnHeld, until, waitFor, type Hand, type ItemInfo, type V3,
} from '/vitexec/lib/harness.ts';

export const FIRE: V3 = [CAMP.fire.x, CAMP.fire.y, CAMP.fire.z];
export const PAD: V3 = [CAMP.work.x, CAMP.work.y, CAMP.work.z];
export const bay = (index: number): V3 => [CAMP.bench.x + CAMP.slotOffsets[index], CAMP.bench.y + .07, CAMP.bench.z];
/** Where a player stands to work the bench: in front of it, facing -Z. */
const BENCH_STAND: readonly [number, number] = [-1.9, -.8];
/** The hammer's local +X (one striking face) turned onto world -Y. */
const FACE_DOWN = [0, 0, -Math.SQRT1_2, Math.SQRT1_2] as const;
const HAMMER_FACE: V3 = [.123, .22, 0];

export async function atBench(): Promise<void> {
  if (horizontal(head(), [BENCH_STAND[0], 0, BENCH_STAND[1]]) > .5) await locomote(BENCH_STAND, { tolerance: .25 });
  await look([CAMP.bench.x + .3, CAMP.bench.y, CAMP.bench.z]);
}

/** Lay the held item into a bench bay and let go. */
export async function toBay(hand: Hand, index: number): Promise<void> {
  await atBench();
  const to = bay(index);
  await move(hand, [to[0], to[1] + .5, to[2] + .3], { seconds: .45 });
  await move(hand, to, { seconds: .35 });
  await release(hand);
  await rest(hand, .3);
}

/** Park the held item on the bench's right end, front edge: clear of the bays, the pad and the hammer's rest. */
export async function toBenchEnd(hand: Hand): Promise<void> {
  await atBench();
  await move(hand, [-1.0, 1.15, -1.3], { seconds: .45 });
  await release(hand);
  await rest(hand, .3);
}

/** Three hammer strikes on the pad (the bays must already match); returns the product. */
export async function hammerOut(product: string): Promise<ItemInfo> {
  await atBench();
  check(state(CraftBench).match === product, `the bays match ${product}`);
  const before = new Set(items(loose(product)).map((it) => it.entity));
  const hammer = await grab(loose('hammer'), 'right', 'hammer');
  await move('right', [PAD[0] + .2, PAD[1] + .45, PAD[2] + .35], { seconds: .4 });
  await turnHeld('right', hammer.entity, FACE_DOWN);
  for (let i = 0; i < 3; i++) {
    await bring('right', hammer.entity, HAMMER_FACE, [PAD[0], PAD[1] + .3, PAD[2]], .35);
    await bring('right', hammer.entity, HAMMER_FACE, [PAD[0], PAD[1] - .03, PAD[2]], .15);
    await sleep(250);
  }
  // The hammer rests at the back of the bench's right end, away from parked materials.
  await move('right', [-1.0, 1.2, -1.75], { seconds: .4 });
  await release('right');
  await rest('right', .3);
  const made = await waitFor(() => items(loose(product)).some((it) => !before.has(it.entity)), 2000);
  check(made, `three hammer strikes craft ${product}`);
  return items(loose(product)).find((it) => !before.has(it.entity))!;
}

/**
 * The nearest item of a kind a player could take right now, from `near` (default: the
 * head): loose, in the pack, or waiting at a forage node (taking that one pulls it).
 */
export const takeable = (kind: string, near?: V3) => nearest((it) => it.kind === kind && it.slot !== 'consumed'
  && !it.slot.startsWith('bay-') && !it.held, near ?? head());

/**
 * Pick up the item a filter names (walking to it; one waiting at a forage node is pulled)
 * and stow it over the shoulder into the worn pack, where it stacks with its kind.
 */
export async function gather(filter: (item: ItemInfo) => boolean, what: string, hand: Hand = 'right'): Promise<ItemInfo> {
  const taken = await grab(filter, hand, what);
  await stowOverShoulder(hand);
  await until(() => info(taken.entity).slot.startsWith('pack-'), 1500, `the ${what} to go into the pack`);
  return info(taken.entity);
}

/**
 * Gather `count` of a kind into the pack, each time the nearest one lying loose or waiting
 * at a forage node (pulling a reed clump drops its other reeds at its foot: those come next).
 */
export async function gatherKind(kind: string, count: number, near?: V3): Promise<void> {
  for (let i = 0; i < count; i++) {
    await gather(nearest((it) => it.kind === kind && (it.slot === '' || it.slot === 'node') && !it.held, near ?? head()), kind);
  }
}

/** Put the held tool away the way a player would: the axe on the right hip, anything else in the pack. */
export async function putAway(hand: Hand = 'right'): Promise<void> {
  const held = items((it) => it.held && holder(it.entity) === hand)[0];
  if (held?.kind === 'axe') await holster(hand, 'right');
  else await stowOverShoulder(hand);
  await rest(hand, .3);
}

/** Fill the three bays with these kinds (each the nearest takeable) and hammer out the product. */
export async function craft(product: string, kinds: readonly [string, string, string]): Promise<ItemInfo> {
  for (let i = 0; i < 3; i++) {
    const from = item(takeable(kinds[i]), kinds[i]).slot || 'ground';
    const taken = await grab(takeable(kinds[i]), 'right', kinds[i]);
    await toBay('right', i);
    const landed = info(taken.entity).slot;
    if (landed !== `bay-${i}`) note(`${kinds[i]} from ${from} landed in '${landed}', not bay-${i}`);
  }
  return hammerOut(product);
}

/** Twist three reeds into cord: pulled from the nearest clumps (or already gathered) and hammered at the bench. */
export const twistCord = () => craft('cord', ['reeds', 'reeds', 'reeds']);

const STUMP = SURFACES.find((surface) => surface.id === 'stump')!;

/** Lay the nearest log on the camp stump and split it with two axe blows: two planks. */
export async function splitLog(): Promise<void> {
  const axe = await grab(loose('axe'), 'right', 'axe');
  await rest('right');
  await grab(nearest(loose('log'), [STUMP.x, STUMP.y, STUMP.z]), 'left', 'log');
  await move('left', [STUMP.x, STUMP.y + .2, STUMP.z], { seconds: .5 });
  await release('left');
  await rest('left');
  const log = item(nearest(loose('log'), [STUMP.x, STUMP.y, STUMP.z]), 'log on the stump');
  check(horizontal(log.position, [STUMP.x, 0, STUMP.z]) < .3 && log.position.y > STUMP.y, 'the log rests on the stump');
  const before = items(loose('plank')).length;
  const at = log.position;
  for (let i = 0; i < 4 && items(same(log.entity)).some((it) => it.kind === 'log' && it.slot !== 'consumed'); i++) {
    await bring('right', axe.entity, ITEMS.axe.tip!, [at.x, at.y + .9, at.z], .35);
    await bring('right', axe.entity, ITEMS.axe.tip!, [at.x, at.y, at.z], .12);
    await sleep(420);
  }
  check(await waitFor(() => items(loose('plank')).length >= before + 2, 2000), 'two axe blows split the log on the stump into two planks');
  await putAway('right');
}

/** Light the campfire the way the opening teaches: lighter flame to the tinder. */
export async function lightFire(): Promise<void> {
  const lighter = await grab(loose('lighter'), 'right', 'lighter');
  await move('right', [FIRE[0] + .3, 1.1, FIRE[2] + .5], { seconds: .5 });
  await turnHeld('right', lighter.entity, [0, 0, 0, 1]);
  await bring('right', lighter.entity, ITEMS.lighter.tip!, [FIRE[0], .5, FIRE[2]], .5);
  trigger('right', 1);
  const lit = await waitFor(() => state(Campfire).lit === true, 3000);
  trigger('right', 0);
  check(lit, 'the lighter lights the campfire');
  // Back on the left hip, where the journey keeps it.
  await holster('right', 'left');
  await rest('right', .3);
}

/** Hold an unlit torch's head in the lit campfire until it catches. */
export async function lightTorch(hand: Hand, torch: ItemInfo): Promise<void> {
  check(state(Campfire).lit, 'the campfire is lit');
  await move(hand, [FIRE[0] + .5, 1.1, FIRE[2] + .5], { seconds: .5 });
  await turnHeld(hand, torch.entity, [0, 0, 0, 1]);
  await bring(hand, torch.entity, ITEMS.torch.tip!, [FIRE[0], .55, FIRE[2]], .6);
  check(await waitFor(() => item(same(torch.entity)).lit, 2500), 'holding the torch head in the fire lights it');
  await rest(hand);
}

/** Rotation that turns an item's local axis toward a world direction. */
export function pointAxis(axis: V3, direction: Vector3): [number, number, number, number] {
  const q = new Quaternion().setFromUnitVectors(new Vector3(axis[0], axis[1], axis[2]).normalize(), direction.clone().normalize());
  return [q.x, q.y, q.z, q.w];
}

/** Local +Y (spear shaft, torch) toward a world direction. */
export const pointY = (direction: Vector3) => pointAxis([0, 1, 0], direction);
