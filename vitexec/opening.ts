/**
 * The opening journey (design/JOURNEY.md), played the way a player does: wake in the
 * burning wreck, take the emergency axe and break the jammed door, step out past the
 * Hollow kept off by the fire, holster the axe, put on the pack at the waystation, fell a
 * tree and pick a mushroom in the forest, then at camp feed and light the fire, cook and
 * eat a stew, and craft and light a torch. Everything gathered rides in the pack; the axe
 * and the lighter live on the hips.
 *   npm run check -- opening
 */
import { Vector3 } from '@iwsdk/core';
import { ITEMS } from '/src/game/catalog.ts';
import { Campfire, Creature, GameState } from '/src/game/components.ts';
import { insideCabin, WAYSTATION, WRECK } from '/src/game/journey.ts';
import { CAMP } from '/src/game/rules.ts';
import { objectiveIndex } from '/src/game/story.ts';
import { ForestSystem } from '/src/game/systems/forest-system.ts';
import { JourneySystem } from '/src/game/systems/journey-system.ts';
import { craft, FIRE, gatherKind, lightFire, lightTorch, putAway } from '/vitexec/lib/camp.ts';
import {
  all, approach, boot, bring, check, done, enterXR, eventsOf, grab, head, holster, horizontal, item, locomote,
  look, loose, move, note, packState, read, release, rest, same, section, shot, sleep, state, turnHeld, type V3,
  waitFor, wearPack, world,
} from '/vitexec/lib/harness.ts';
import { beginJourney } from '/vitexec/lib/journey.ts';

const POT: V3 = [CAMP.pot.x, CAMP.pot.y, CAMP.pot.z];
const UPRIGHT = [0, 0, 0, 1] as const;
/** A wreck-local point in world space. */
const wreck = (x: number, y: number, z: number): V3 => [WRECK.origin.x + x, WRECK.origin.y + y, WRECK.origin.z + z];
const DOOR_X = (WRECK.door.x0 + WRECK.door.x1) / 2;
const journey = () => world.getSystem(JourneySystem)!;
/** An item of a kind carried in the pack. */
const packed = (kind: string) => (it: { kind: string; slot: string }) => it.kind === kind && it.slot.startsWith('pack-');
const objective = (id: string) => (state(GameState).objectives & (1 << objectiveIndex(id))) !== 0;

await boot();
await enterXR();
await beginJourney();

if (await section('J1 wake in the burning wreck')) {
  await sleep(2500); // the shade's first words
  await shot('01-wreck-wake');
  check(journey().step === 'wake', `the journey begins in the seat (${journey().step})`);
  check(insideCabin(head().x, head().z), 'the keeper wakes inside the cabin');
  check(item(loose('lighter')).slot === 'hip-left', 'the lighter hangs on the left hip');
  check(packState() === 'unowned', 'no pack yet');
  check(!state(Campfire).lit, 'the camp fire is cold');
}

if (await section('J2 walk to the jammed door')) {
  const inside = wreck(DOOR_X, 0, WRECK.door.z + .75);
  await locomote([inside[0], inside[2]], { tolerance: .3 });
  await look(wreck(DOOR_X, 1.2, WRECK.door.z));
  check(await waitFor(() => journey().step === 'door', 3000), 'at the door, the journey asks for the axe');
  check(insideCabin(head().x, head().z), 'the door keeps the keeper in');
}

if (await section('J3 take the emergency axe')) {
  const axe = await grab(loose('axe'), 'right', 'emergency axe');
  check(await waitFor(() => journey().step === 'armed', 1000), `axe in hand (${journey().step})`);
  await rest('right');
  check(axe.kind === 'axe', 'the axe came off its bracket above the door');
}

if (await section('J4 break the door down')) {
  const axe = item(loose('axe'));
  // Wind up inside the cabin, strike the ajar panel at chest height.
  for (let i = 0; i < 6 && journey().step === 'armed'; i++) {
    await bring('right', axe.entity, ITEMS.axe.tip!, wreck(DOOR_X, 1.55, WRECK.door.z + .6), .35);
    await bring('right', axe.entity, ITEMS.axe.tip!, wreck(DOOR_X, 1.1, WRECK.door.z - .05), .12);
    await sleep(420);
  }
  check(journey().step === 'open', `axe blows tear the door off (${globalThis.__prometheusJourney?.doorHits ?? '?'} hits)`);
  await sleep(1200); // the panel falls outward as a ramp
  await shot('02-door-down');
}

if (await section('J5 step out: the Hollow keep off the fire')) {
  await locomote([wreck(DOOR_X, 0, 0)[0], wreck(0, 0, WRECK.door.z - 2.2)[2]], { tolerance: .4 });
  check(await waitFor(() => journey().step === 'outside', 3000), `out of the wreck (${journey().step})`);
  check(objective('escape'), 'the escape objective completes');
  check(await waitFor(() => (globalThis.__prometheusJourney?.wolves ?? 0) > 0, 8000),
    `Hollow stand on the hills (${globalThis.__prometheusJourney?.wolves} staged)`);
  check(all(Creature).every((e) => read(e, Creature).species !== 'wolf'), 'they are scenery: no hunting wolf near the wreck');
  await sleep(1500);
  await shot('03-wolves-on-the-hills');
  check(state(GameState).health >= 99, 'the fire keeps them off');
}

if (await section('J6 holster the axe; the sun comes up')) {
  await holster('right', 'right');
  check(item(loose('axe')).slot === 'hip-right', 'the axe hangs on the right hip');
  check(await waitFor(() => journey().step === 'dawn', 45_000), `sunrise: the Hollow crumble (${journey().step})`);
  check(!(globalThis.__prometheusJourney?.clockHeld ?? true), 'the day runs again');
}

if (await section('J7 the waystation: put the pack on')) {
  await locomote([WAYSTATION.table.x + .9, WAYSTATION.table.z + .3], { tolerance: .5, ms: 40_000 });
  check(await waitFor(() => journey().step === 'waystation', 3000), `at the waystation (${journey().step})`);
  await wearPack('right');
  check(packState() === 'worn', 'the pack goes onto the back');
  check(await waitFor(() => journey().step === 'forest', 2000), 'the journey leads into the forest');
  check(objective('waystation'), 'the waystation objective completes');
}

if (await section('J8 the forest: fell a tree, pick a mushroom')) {
  const forest = world.getSystem(ForestSystem)!;
  const tree = forest.nearestChoppable(head().x, head().z, 30)!;
  check(tree, 'a choppable tree stands near the path');
  const trunk = new Vector3(tree.x, tree.ground, tree.z);
  note(`felling a ${tree.height.toFixed(1)} m tree ${horizontal(trunk, head()).toFixed(1)} m away`);
  const axe = await grab(loose('axe'), 'right', 'axe from the hip');
  await approach(trunk, 1.1);
  const side = head().sub(trunk).setY(0).normalize();
  const bark = (reach: number): V3 =>
    [tree.x + side.x * (forest.trunkRadius(tree) + reach), tree.ground + 1.1, tree.z + side.z * (forest.trunkRadius(tree) + reach)];
  for (let i = 0; i < 7 && forest.stateOf(tree) === 'standing'; i++) {
    await bring('right', axe.entity, ITEMS.axe.tip!, bark(.65), .35);
    await bring('right', axe.entity, ITEMS.axe.tip!, bark(-.03), .12);
    await sleep(380);
  }
  check(forest.stateOf(tree) === 'felled', 'the axe fells the tree');
  await putAway('right');
  check(await waitFor(() => eventsOf('harvest').some((e) => e.kind === 'log'), 6000), 'the trunk breaks into firewood');
  await sleep(800);
  await gatherKind('log', 1, [tree.x, tree.ground, tree.z]);
  await gatherKind('stick', 1, [tree.x, tree.ground, tree.z]);
  await gatherKind('mushroom', 1);
  check(await waitFor(() => journey().step === 'forest' && (globalThis.__prometheusJourney?.cues ?? []).includes('forest-done'), 2000),
    'firewood and a mushroom in the pack: the forest is done');
}

if (await section('J9 arrive at camp')) {
  await locomote([FIRE[0] + 1.2, FIRE[2] + 1.4], { tolerance: .4, ms: 60_000 });
  check(await waitFor(() => journey().step === 'camp', 3000), `at camp (${journey().step})`);
  check(objective('forest'), 'the forest objective completes');
}

if (await section('S1 feed the fire and light it with the lighter')) {
  check(!state(Campfire).lit && state(Campfire).fuel <= 1, 'the camp fire is cold and empty');
  await grab(packed('log'), 'right', 'firewood from the pack');
  await move('right', [FIRE[0], .7, FIRE[2] + .4], { seconds: .6 });
  await move('right', [FIRE[0], .45, FIRE[2]], { seconds: .4 });
  await release('right');
  check(await waitFor(() => state(Campfire).fuel > 20, 1500), `the log feeds the ring (fuel ${Math.round(state(Campfire).fuel)})`);
  await lightFire();
  check(item(loose('lighter')).slot === 'hip-left', 'the lighter goes back on the left hip');
  check(await waitFor(() => journey().step === 'done', 2000), 'the fire ends the journey');
  check(objective('light-fire'), 'the light-fire objective completes');
  await sleep(600);
  await shot('04-camp-fire');
}

if (await section('S2 cook a mushroom stew, fill a bowl and eat')) {
  for (const food of ['meat', 'mushroom']) {
    await grab(packed(food), 'right', `${food} from the pack`);
    await move('right', [POT[0] + .3, 1.6, POT[2] + .35], { seconds: .6 });
    await move('right', [POT[0], 1.24, POT[2]], { seconds: .5 });
    await release();
  }
  let fire = state(Campfire);
  check(fire.potA && fire.potB, `the pot holds ${fire.potA} + ${fire.potB}`);
  const spoon = await grab(loose('spoon'), 'right', 'spoon');
  await move('right', [POT[0] + .2, 1.75, POT[2]], { seconds: .6 });
  await turnHeld('right', spoon.entity, UPRIGHT); // bowl of the spoon points down
  const stirY = POT[1] + .04;
  await bring('right', spoon.entity, ITEMS.spoon.tip!, [POT[0] + .17, stirY, POT[2]], .4);
  for (let i = 1; i <= 46 && !state(Campfire).stew; i++) {
    const a = i * Math.PI / 10;
    await bring('right', spoon.entity, ITEMS.spoon.tip!, [POT[0] + .17 * Math.cos(a), stirY, POT[2] + .17 * Math.sin(a)], .08);
  }
  await move('right', [1.0, 1.5, -1.2], { seconds: .5 });
  await release();
  fire = state(Campfire);
  check(fire.stew === 'meat+mushroom', `stirring cooks the stew: ${fire.stew}`);
  await grab(loose('bowl'), 'right', 'bowl');
  await move('right', [POT[0] + .3, 1.6, POT[2] + .3], { seconds: .6 });
  await move('right', [POT[0], POT[1] + .04, POT[2]], { seconds: .5 });
  check(await waitFor(() => item(loose('bowl')).variant === 'meat+mushroom', 1500), 'dipping the bowl in the pot fills it');
  await shot('05-bowl-filled');
  const hungerBefore = state(GameState).hunger;
  const mouth = head();
  await move('right', [mouth.x + .02, mouth.y - .12, mouth.z - .08], { seconds: .8 });
  const ate = await waitFor(() => state(GameState).hunger >= Math.min(100, hungerBefore + 40) - 1, 3000);
  check(ate, `eating at the mouth restores hunger ${Math.round(hungerBefore)} → ${Math.round(state(GameState).hunger)}`);
  check(objective('eat-meal'), 'the meal objective completes');
  await move('right', [1.0, 1.1, -1.0], { seconds: .5 });
  await release();
}

if (await section('S3 craft a torch on the bench and light it')) {
  const made = await craft('torch', ['stick', 'reeds', 'resin']);
  check(state(GameState).stage >= 1, 'crafting fire technology raises the danger stage');
  const torch = await grab(same(made.entity), 'right', 'torch');
  await lightTorch('right', torch);
  check(item(same(made.entity)).lit, 'holding the torch head in the fire lights it');
  await look([FIRE[0], 1, FIRE[2]]);
  await shot('06-torch-lit');
  await rest('right');
  await release('right');
}

done('opening');
