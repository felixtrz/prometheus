/**
 * S5–S8, S13, S15: pack, fuel, death and respawn, sleep, pages, save/reload.
 *   node tests/e2e/survival.mjs   (run on a fresh journey)
 */
import {
  assert, cli, clickEntity, delay, enterXR, grab, headWorld, itemBy, items, look, move, newJourney,
  pinRuntime, release, setOn, singleton,
} from './harness.mjs';

await pinRuntime();
await newJourney();
await enterXR();
await move([0, 1.6, .8], .3, undefined, 'headset');
await look([0, 1.2, -2]);
await move([-.3, 1.2, .5], .3, undefined, 'controller-left');

console.log('S5 the physical pack');
const pack = () => singleton('Backpack');
assert((await pack()).state === 'unrolled', 'the pack starts unrolled on the trestle');
await grab((item) => item.kind === 'pack');
assert((await pack()).state === 'held', 'grabbing the roll rolls the pack up');
const hidden = (await items()).filter((item) => item.slot.startsWith('pack-'));
assert(hidden.length >= 5, `${hidden.length} items travel inside the rolled pack`);
await move([.6, .45, -.2], .5);
await release();
assert((await pack()).state === 'unrolled', 'released low, the pack unrolls on the ground');
const meat = await itemBy((item) => item.kind === 'meat');
assert(Math.hypot(meat.position[0] - .6, meat.position[2] + .2) < 1, 'its items are laid out in the new cells');
await grab((item) => item.kind === 'meat');
await move([.6, .5, -.2], .3);
await release();
const stored = await itemBy((item) => item.kind === 'meat');
assert(stored.slot.startsWith('pack-'), `released over the mat, the meat snaps into ${stored.slot}`);
await grab((item) => item.kind === 'pack');
const head = await headWorld();
await move([head[0] + .18, head[1] - .3, head[2] + .17], .5);
await release();
assert((await pack()).state === 'worn', 'released at the shoulder, the pack is worn');
await move([1.5, 1.6, 1.8], .5, undefined, 'headset');
await delay(400);
const roll = await itemBy((item) => item.kind === 'pack');
const moved = await headWorld();
assert(Math.hypot(roll.position[0] - moved[0], roll.position[2] - moved[2]) < .5, 'the worn pack follows the player');

console.log('S6 feeding the fire');
await setOn('Campfire', 'fuel', 40);
const fuelBefore = (await singleton('Campfire')).fuel;
await grab((item) => item.kind === 'log');
await move([.25, .7, -1.5], .6);
await move([.25, .45, -1.9], .4);
await release();
const fuelAfter = (await singleton('Campfire')).fuel;
assert(fuelAfter > fuelBefore + 30, `a log feeds the fire: ${Math.round(fuelBefore)} → ${Math.round(fuelAfter)}`);

console.log('S7 death and respawn');
await move([6, 1.6, 2], .3, undefined, 'headset');
await delay(300);
const deathSpot = await headWorld();
await setOn('GameState', 'health', 0);
await delay(600);
let state = await singleton('GameState');
assert(state.deaths === 1, 'health at zero kills the player');
assert((await pack()).state === 'unrolled', 'the worn pack drops where the player fell');
await delay(3000);
state = await singleton('GameState');
assert(state.health >= 59, `the player respawns with ${Math.round(state.health)} health`);
const origin = (await cli('ecs', 'query', { entityIndex: 2, components: ['Transform'] })).components[0].values.position;
assert(Math.hypot(origin[0] - deathSpot[0], origin[2] - deathSpot[2]) > 2, 'respawn moves the player back to camp');

console.log('S13 reading a page teaches its recipe');
await move([-2.3, 1.6, -.6], .3, undefined, 'headset');
await grab((item) => item.kind === 'page' && item.uid === 'page-2');
await delay(400);
state = await singleton('GameState');
assert(state.pages & 2, 'page 2 is found');
assert(state.recipes & 2, 'the spear recipe is learned from page 2');
await release();

console.log('S8 sleep at the bedroll at night');
await setOn('Campfire', 'lit', true);
await setOn('Campfire', 'fuel', 80);
// Sleep is allowed only in the second half of the night (SLEEP.minNightFraction).
await setOn('GameState', 'clock', 412);
await move([-.6, 1.6, -1.5], .3, undefined, 'headset');
await delay(500);
await clickEntity('^Camp Bedroll$');
await delay(800);
state = await singleton('GameState');
assert(state.clock >= 480 && state.clock < 520, `sleeping skips to dawn (clock ${Math.round(state.clock)})`);
assert(state.objectives & (1 << 3), 'the sleep objective completes');
assert(Math.abs(state.respawn[0] + .8) < .01, 'the respawn point moves to the bedroll');

console.log('S15 progress survives a reload');
const before = await singleton('GameState');
await delay(1500);
await cli('browser', 'reload', {}).catch(() => {});
await delay(9000);
await pinRuntime();
const after = await singleton('GameState');
assert(after.objectives === before.objectives && after.pages === before.pages && after.recipes === before.recipes,
  `objectives/pages/recipes restored (${after.objectives}/${after.pages}/${after.recipes})`);
console.log('survival: PASS');
