/**
 * S5–S8, S13 (and the first half of S15): the physical pack, feeding the fire,
 * death and respawn, reading a page, sleeping through the night. The runner then
 * reloads the page and survival-restore.ts checks the save.
 *   npm run check -- survival
 */
import { Vector3 } from '@iwsdk/core';
import { Backpack, Bedroll, Campfire, GameState } from '/src/game/components.ts';
import { CAMP, DAWN_CLOCK } from '/src/game/rules.ts';
import { SAVE_KEY } from '/src/game/save.ts';
import {
  boot, check, clickAt, done, enterXR, eventsOf, fixture, grab, head, horizontal, item, items, locomote, look, loose,
  move, one, release, section, sleep, state, waitFor, walk, worldPos,
} from '/vitexec/lib/harness.ts';
import { beginJourney } from '/vitexec/lib/journey.ts';

await boot();
await enterXR();
await beginJourney();
await walk([0, 1.6, .8]);
await look([0, 1.2, -2]);
await move('left', [-.3, 1.2, .5], { seconds: .3 });

section('S5 the physical pack');
const pack = () => state(Backpack).state;
check(pack() === 'unrolled', 'the pack starts unrolled on the trestle');
await grab(loose('pack'), 'right', 'pack roll');
check(await waitFor(() => pack() === 'held', 500), 'grabbing the roll rolls the pack up');
const inside = items((it) => it.slot.startsWith('pack-'));
check(inside.length >= 5, `${inside.length} items travel inside the rolled pack`);
await move('right', [.6, .45, -.2], { seconds: .5 });
await release();
check(await waitFor(() => pack() === 'unrolled', 800), 'released low, the pack unrolls on the ground');
const meat = item(loose('meat'));
check(horizontal(meat.position, [.6, 0, -.2]) < 1, 'its items are laid out in the new cells');
await grab(loose('meat'), 'right', 'meat');
await move('right', [.6, .5, -.2], { seconds: .3 });
await release();
const stored = item(loose('meat'));
check(stored.slot.startsWith('pack-'), `released over the mat, the meat snaps into ${stored.slot}`);
await grab(loose('pack'), 'right', 'pack roll');
const eye = head();
await move('right', [eye.x + .18, eye.y - .3, eye.z + .17], { seconds: .5 });
await release();
check(await waitFor(() => pack() === 'worn', 800), 'released at the shoulder, the pack is worn');
await locomote([1.5, 1.8]);
await sleep(400);
check(horizontal(item(loose('pack')).position, head()) < .5, 'the worn pack follows the player (thumbstick walk)');

section('S6 feeding the fire');
fixture(Campfire, 'fuel', 40);
const fuelBefore = state(Campfire).fuel;
await grab(loose('log'), 'right', 'log');
await move('right', [CAMP.fire.x, .7, CAMP.fire.z + .4], { seconds: .6 });
await move('right', [CAMP.fire.x, .45, CAMP.fire.z], { seconds: .4 });
await release();
const fuelAfter = state(Campfire).fuel;
check(fuelAfter > fuelBefore + 30, `a log feeds the fire: ${Math.round(fuelBefore)} → ${Math.round(fuelAfter)}`);
check(eventsOf('fuel-added').some((event) => event.kind === 'log'), 'the fuel cue names the log');

section('S7 death and respawn');
await locomote([6, 2]);
const deathSpot = head();
fixture(GameState, 'health', 0);
check(await waitFor(() => state(GameState).deaths === 1, 1500), 'health at zero kills the player');
check(pack() === 'unrolled' && horizontal(worldPos(one(Backpack)), deathSpot) < 1.5, 'the worn pack drops where the player fell');
check(await waitFor(() => state(GameState).health >= 59, 5000), `the player respawns with ${Math.round(state(GameState).health)} health`);
const spawn = state(GameState).respawn as number[];
const back = head();
check(horizontal(back, deathSpot) > 4 && horizontal(back, [spawn[0], 0, spawn[2]]) < 1.2,
  `respawn brings the player back to camp (${horizontal(back, deathSpot).toFixed(1)} m from the fall)`);
check(eventsOf('death').length === 1 && eventsOf('respawn').length === 1, 'death and respawn cues fire once each');

section('S13 reading a page teaches its recipe');
await locomote([-1.6, -.4]);
await grab((it) => it.kind === 'page' && it.uid === 'page-2', 'right', 'page 2');
const learned = await waitFor(() => (state(GameState).pages & 2) !== 0 && (state(GameState).recipes & 2) !== 0, 1000);
check(learned, 'picking up page 2 finds it and teaches the spear recipe');
check(eventsOf('recipe-learned').some((event) => event.product === 'spear'), 'the recipe-learned cue names the spear');
await release();

section('S8 sleep at the bedroll at night');
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

section('S15 progress is saved');
await sleep(1500);
const saved = localStorage.getItem(SAVE_KEY);
check(saved, 'a save is written');
const expected = { objectives: game.objectives, pages: game.pages, recipes: game.recipes, meatSlot: item(loose('meat')).slot };
sessionStorage.setItem('vitexec.survival', JSON.stringify(expected));
done('survival');
