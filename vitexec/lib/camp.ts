/**
 * Camp routines shared by the gameplay checks: standing at the bench, filling
 * bays, hammering a recipe, lighting a torch at the fire.
 */
import { Quaternion, Vector3 } from '@iwsdk/core';
import { ITEMS } from '/src/game/catalog.ts';
import { Campfire, CraftBench } from '/src/game/components.ts';
import { CAMP } from '/src/game/rules.ts';
import {
  bring, check, grab, head, horizontal, item, items, locomote, look, loose, move, release, rest, same, sleep, state,
  trigger, turnHeld, waitFor, type Hand, type ItemInfo, type V3,
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
  await rest('right');
  await release('right');
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
