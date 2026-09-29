/**
 * S1–S3: the opening at camp, driven through emulated controllers.
 *   node tests/e2e/opening.mjs
 */
import {
  assert, delay, enterXR, find, grab, grip, headWorld, items, move, pinRuntime, release, singleton, trigger,
} from './harness.mjs';

const FIRE = [.25, .5, -1.9];
const POT = [.25, 1.24, -1.9];
const BENCH_X = -2.15, BENCH_Z = -1.55, BAYS = [-.83, -.28, .28];
const kind = (k) => (item) => item.kind === k && item.slot !== 'consumed';

await pinRuntime();
await enterXR();
await move([.3, 1.3, .1], .4, undefined, 'controller-left');

console.log('S1 light the campfire with the lighter');
let fire = await singleton('Campfire');
assert(!fire.lit, 'the fire starts cold');
await grab(kind('lighter'));
await move([FIRE[0] + .2, 1.2, FIRE[2] + .3], .6);
await move([FIRE[0], FIRE[1] - .06, FIRE[2]], .6);
await trigger(1);
await delay(1500);
await trigger(0);
fire = await singleton('Campfire');
assert(fire.lit, 'lighter flame at the tinder lights the fire');
const fuel0 = fire.fuel;
await move([1.2, 1.2, -.9], .5);
await release();
await delay(1200);
assert((await singleton('Campfire')).fuel < fuel0, 'fuel burns down while lit');

console.log('S2 cook, fill a bowl and eat');
for (const food of ['meat', 'mushroom']) {
  await grab(kind(food));
  await move([POT[0] + .3, 1.6, POT[2] + .35], .6);
  await move(POT, .5);
  await release();
}
fire = await singleton('Campfire');
assert(fire.potA && fire.potB, `pot holds ${fire.potA} + ${fire.potB}`);
// The spoon rests on its side; roll the hand so the bowl points down into the pot.
const TIP_DOWN = { x: 0, y: 0, z: -.7071, w: .7071 };
await grab(kind('spoon'));
await move([POT[0] + .18, 1.75, POT[2]], .6, TIP_DOWN);
await move([POT[0] + .18, 1.5, POT[2]], .4, TIP_DOWN);
for (let i = 1; i <= 46; i++) {
  const a = i * Math.PI / 10;
  await move([POT[0] + .17 * Math.cos(a), 1.5, POT[2] + .17 * Math.sin(a)], .08, TIP_DOWN);
}
await move([1.0, 1.5, -1.2], .5);
await release();
fire = await singleton('Campfire');
assert(fire.stew === 'meat+mushroom', `stew ready: ${fire.stew}`);
await grab(kind('bowl'));
await move([POT[0] + .3, 1.6, POT[2] + .3], .6);
await move([POT[0], 1.2, POT[2]], .5);
await delay(300);
const bowl = (await items()).find((item) => item.kind === 'bowl');
assert(bowl.variant === 'meat+mushroom', 'dipping the bowl fills it');
const before = (await singleton('GameState')).hunger;
const head = await headWorld();
await move([head[0] + .02, head[1] - .12, head[2] - .08], .8);
await delay(900);
const game = await singleton('GameState');
assert(game.hunger >= Math.min(100, before + 40) - 1, `eating restores hunger ${Math.round(before)} → ${Math.round(game.hunger)}`);
assert((game.objectives & 3) === 3, 'objectives: fire lit and meal eaten');
await move([1.0, 1.1, -1.0], .5);
await release();

console.log('S3 craft a torch on the bench and light it');
for (const [material, bay] of [['stick', 0], ['cloth', 1], ['resin', 2]]) {
  await grab(kind(material));
  const x = BENCH_X + BAYS[bay];
  await move([x, 1.7, BENCH_Z + .3], .6);
  await move([x, 1.13, BENCH_Z], .5);
  await release();
}
const bench = await singleton('CraftBench');
assert(bench.match === 'torch', `bays match: ${bench.match}`);
await grab(kind('hammer'));
for (let i = 0; i < 3; i++) {
  await move([-1.10, 1.6, -1.55], .5, { x: 0, y: 0, z: .7071, w: .7071 });
  await move([-1.10, 1.19, -1.55], .35, { x: 0, y: 0, z: .7071, w: .7071 });
  await delay(350);
}
await move([-1.0, 1.6, -1.0], .5);
await release();
await delay(600);
const torch = (await items()).find((item) => item.kind === 'torch');
assert(torch, 'three strikes craft a torch on the pad');
assert(((await singleton('GameState')).stage ?? 0) >= 1, 'crafting fire technology raises the danger stage');
// The crafted torch rests on its side: with the hand level, its head points along -X.
await grab((item) => item.kind === 'torch');
await move([.75, 1.2, -1.2], .6);
await move([.57, .55, -1.9], .8, { x: 0, y: 0, z: 0, w: 1 });
await delay(1200);
const lit = (await items()).find((item) => item.kind === 'torch');
assert(lit.lit, 'holding the torch head in the fire lights it');
await move([.9, 1.1, -1.2], .6, { x: 0, y: 0, z: 0, w: 1 });
await grip(0);
console.log('opening: PASS', (await find(['Item'])).total, 'items');
