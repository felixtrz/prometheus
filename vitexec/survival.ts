/**
 * S5–S8, S13 (and the first half of S15): the pack on the back and the hip holsters, feeding the fire,
 * death and respawn, reading a page, sleeping through the night. The runner then
 * reloads the page and survival-restore.ts checks the save.
 *   npm run check -- survival
 */
import { Vector3 } from '@iwsdk/core';
import { Backpack, Bedroll, Campfire, GameState } from '/src/game/components.ts';
import { CAMP, DAWN_CLOCK } from '/src/game/rules.ts';
import { SAVE_KEY } from '/src/game/save.ts';
import { BackpackSystem } from '/src/game/systems/backpack-system.ts';
import {
  bodyPoint, boot, bring, check, clickAt, done, enterXR, eventsOf, fixture, grab, head, holster, horizontal, info, item, items,
  locomote, look, loose, move, one, openPack, packSlotPoint, packState, release, same, section, sleep, spawnFixture, state,
  stowOverShoulder, waitFor, walk, wearPack, world, worldPos,
} from '/vitexec/lib/harness.ts';
import { beginJourney, skipOpening } from '/vitexec/lib/journey.ts';

const visible = (it: { entity: { object3D?: { visible: boolean } } }) => it.entity.object3D?.visible === true;

await boot();
await enterXR();
await beginJourney();
await skipOpening({ equipped: false });
await walk([0, 1.6, .8]);
await look([0, 1.2, -2]);
await move('left', [-.3, 1.2, .5], { seconds: .3 });

if (await section('S5 the pack on the back and the hip holsters')) {
  // Found: until first picked up the pack lies where the scene put it; from then on it lives on the back.
  if (packState() === 'unowned') {
    await grab(loose('pack'), 'right', 'the pack');
    check(packState() === 'held' && eventsOf('pack').some((event) => event.state === 'held'), 'picking the pack up finds it');
    await release();
    check(await waitFor(() => packState() === 'worn', 800), 'let go anywhere, the pack goes onto the back');
  }
  check(packState() === 'worn', 'the pack is worn');
  const eye = head();
  const worn = item(loose('pack'));
  check(horizontal(worn.position, eye) < .45 && worn.position.y < eye.y - .3, 'it rides on the back, below the head');

  // Over the shoulder: two sticks share one slot.
  const ahead = bodyPoint(0, 0, -.6);
  const first = await spawnFixture('stick', ahead.x - .15, ahead.z);
  const second = await spawnFixture('stick', ahead.x + .15, ahead.z);
  await grab(same(first.entity), 'right', 'stick 1');
  await stowOverShoulder('right');
  const slot = info(first.entity).slot;
  check(slot.startsWith('pack-') && !visible(first), `let go over the shoulder, the stick goes into ${slot}`);
  check(eventsOf('snap').some((event) => event.target === slot), 'the stow cue names the slot');
  await grab(same(second.entity), 'right', 'stick 2');
  await stowOverShoulder('right');
  check(info(second.entity).slot === slot, `the second stick stacks in ${slot}`);

  // Take it off and pull the trigger: the slot panel unrolls upright in that hand; a stack shows one item.
  await openPack('left');
  const panel = one(Backpack).object3D!;
  check(packState() === 'open' && panel.visible, 'the trigger unrolls the slot panel while the pack stays in the hand');
  check(Math.abs(panel.rotation.x) < 1e-6 && Math.abs(panel.rotation.z) < 1e-6, 'the panel hangs upright');
  const shown = items((it) => it.slot === slot && visible(it));
  check(shown.length === 1, 'the stack shows one stick');
  const taken = await grab(same(shown[0].entity), 'right', 'a stick off the panel');
  check(await waitFor(() => items((it) => it.slot === slot && visible(it)).length === 1, 400), 'taking one shows the next of the stack');
  const target = packSlotPoint(Number(slot.slice(5)));
  await bring('right', taken.entity, [0, 0, 0], [target.x, target.y, target.z], .4, false);
  await release('right');
  check(info(taken.entity).slot === slot, 'released on its slot, it stacks again');
  await release('left');
  check(await waitFor(() => packState() === 'worn', 800), 'let go, the open pack goes back onto the back');
  check(items((it) => it.slot.startsWith('pack-') && visible(it)).length === 0, 'everything in it is out of sight');

  // Hip holsters: any item, tools included; they ride along with the player. The journey
  // starts with the lighter on the left hip, so the hammer goes to the right one.
  check(item(loose('lighter')).slot === 'hip-left', 'the lighter starts on the left hip');
  const hammer = await spawnFixture('hammer', ahead.x, ahead.z + .12);
  await grab(same(hammer.entity), 'right', 'hammer');
  await holster('right', 'right');
  check(info(hammer.entity).slot === 'hip-right', 'let go at the right hip, the hammer hangs there');
  check(eventsOf('snap').some((event) => event.target === 'hip-right'), 'the holster cue names the hip');
  await locomote([1.5, 1.8]);
  await sleep(400);
  check(horizontal(info(hammer.entity).position, head()) < .45, 'the holstered hammer follows the player');
  check(horizontal(item(loose('pack')).position, head()) < .5, 'so does the worn pack (thumbstick walk)');
  await grab(same(hammer.entity), 'right', 'the hammer at the hip');
  check(info(hammer.entity).held, 'squeezing it at the hip takes it out');
  await holster('right', 'right');
  check(info(hammer.entity).slot === 'hip-right', 'and let go there, it hangs again');
}

if (await section('S6 feeding the fire')) {
  fixture(Campfire, 'fuel', 40);
  const fuelBefore = state(Campfire).fuel;
  await grab(loose('log'), 'right', 'log');
  await move('right', [CAMP.fire.x, .7, CAMP.fire.z + .4], { seconds: .6 });
  await move('right', [CAMP.fire.x, .45, CAMP.fire.z], { seconds: .4 });
  await release();
  const fuelAfter = state(Campfire).fuel;
  check(fuelAfter > fuelBefore + 30, `a log feeds the fire: ${Math.round(fuelBefore)} → ${Math.round(fuelAfter)}`);
  check(eventsOf('fuel-added').some((event) => event.kind === 'log'), 'the fuel cue names the log');
}

if (await section('S7 death and respawn')) {
  await wearPack();
  await locomote([6, 2]);
  const deathSpot = head();
  fixture(GameState, 'health', 0);
  check(await waitFor(() => state(GameState).deaths === 1, 1500), 'health at zero kills the player');
  check(await waitFor(() => packState() === 'dropped', 500) && horizontal(item(loose('pack')).position, deathSpot) < 1.5,
    'the worn pack drops where the player fell');
  check(await waitFor(() => state(GameState).health >= 59, 5000), `the player respawns with ${Math.round(state(GameState).health)} health`);
  const spawn = state(GameState).respawn as number[];
  const back = head();
  check(horizontal(back, deathSpot) > 4 && horizontal(back, [spawn[0], 0, spawn[2]]) < 1.2,
    `respawn brings the player back to camp (${horizontal(back, deathSpot).toFixed(1)} m from the fall)`);
  check(eventsOf('death').length === 1 && eventsOf('respawn').length === 1, 'death and respawn cues fire once each');
  check(world.getSystem(BackpackSystem)?.lost === true, 'the pack is marked lost');
  await grab(loose('pack'), 'right', 'the lost pack');
  await release();
  check(await waitFor(() => packState() === 'worn', 800), 'picked up where it fell and let go, the pack is back on the back');
  check(world.getSystem(BackpackSystem)?.lost === false, 'and no longer lost');
}

if (await section('S13 reading a page teaches its recipe')) {
  await locomote([-1.6, -.4]);
  await grab((it) => it.kind === 'page' && it.uid === 'page-2', 'right', 'page 2');
  const learned = await waitFor(() => (state(GameState).pages & 2) !== 0 && (state(GameState).recipes & 2) !== 0, 1000);
  check(learned, 'picking up page 2 finds it and teaches the spear recipe');
  check(eventsOf('recipe-learned').some((event) => event.product === 'spear'), 'the recipe-learned cue names the spear');
  await release();
}

if (await section('S8 sleep at the bedroll at night')) {
  fixture(Campfire, 'lit', true);
  fixture(Campfire, 'fuel', 80);
  fixture(GameState, 'clock', 412); // second half of the night: sleep is allowed
  await locomote([-.8, -1.6]);
  await sleep(500);
  const bedroll = worldPos(one(Bedroll)).add(new Vector3(0, .12, 0));
  await clickAt(bedroll, 'left');
  const slept = await waitFor(() => state(GameState).clock >= DAWN_CLOCK && state(GameState).clock < DAWN_CLOCK + 40, 3000);
  const game = state(GameState);
  check(slept, `sleeping skips to dawn (clock ${Math.round(game.clock)})`);
  check(game.objectives & (1 << 3), 'the sleep objective completes');
  check(Math.abs((game.respawn as number[])[0] + .8) < .01, 'the respawn point moves to the bedroll');
}

if (await section('S15 progress is saved')) {
  await sleep(1500);
  const saved = localStorage.getItem(SAVE_KEY);
  check(saved, 'a save is written');
  const game = state(GameState);
  const sticks = items((it) => it.kind === 'stick' && it.slot.startsWith('pack-'));
  const stackSlot = sticks[0]?.slot ?? '';
  const expected = {
    objectives: game.objectives, pages: game.pages, recipes: game.recipes, pack: packState(), stackSlot,
    stack: sticks.filter((it) => it.slot === stackSlot).length,
    hips: items((it) => it.slot.startsWith('hip-')).map((it) => `${it.kind}@${it.slot}`).sort(),
  };
  check(expected.stack >= 2 && expected.hips.length > 0, `saving a stack of ${expected.stack} in ${stackSlot} and ${expected.hips.join(', ')}`);
  sessionStorage.setItem('vitexec.survival', JSON.stringify(expected));
}

done('survival');
