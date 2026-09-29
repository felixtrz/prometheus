/**
 * S1–S3, the opening at camp: light the fire, cook and eat, craft and light a torch.
 *   npm run check -- opening
 */
import { ITEMS } from '/src/game/catalog.ts';
import { Campfire, CraftBench, GameState } from '/src/game/components.ts';
import { CAMP } from '/src/game/rules.ts';
import {
  boot, bring, check, done, enterXR, eventsOf, grab, head, item, items, look, loose, move, release, section,
  shot, sleep, state, trigger, turnHeld, type V3, waitFor, walk,
} from '/vitexec/lib/harness.ts';
import { beginJourney } from '/vitexec/lib/journey.ts';

const FIRE: V3 = [CAMP.fire.x, CAMP.fire.y, CAMP.fire.z];
const POT: V3 = [CAMP.pot.x, CAMP.pot.y, CAMP.pot.z];
const bay = (index: number): V3 => [CAMP.bench.x + CAMP.slotOffsets[index], CAMP.bench.y + .07, CAMP.bench.z];
const UPRIGHT = [0, 0, 0, 1] as const;

await boot();
await enterXR();
await beginJourney();
await walk([0, 1.6, .8]);
await look([0, 1.2, -2]);
await move('left', [.3, 1.3, .1], { seconds: .4 });
await sleep(2500); // the shade's first words
await shot('01-camp-first-view');

section('S1 light the campfire with the lighter');
check(!state(Campfire).lit, 'the fire starts cold');
const lighter = await grab(loose('lighter'), 'right', 'lighter');
await move('right', [FIRE[0] + .2, 1.2, FIRE[2] + .3], { seconds: .6 });
await turnHeld('right', lighter.entity, UPRIGHT);
await bring('right', lighter.entity, ITEMS.lighter.tip!, [FIRE[0], .5, FIRE[2]], .6);
trigger('right', 1);
const lit = await waitFor(() => state(Campfire).lit === true, 3000);
trigger('right', 0);
check(lit, 'holding the lighter flame at the tinder lights the fire');
await sleep(600);
await shot('02-fire-lit');
check(eventsOf('fire-lit').length === 1, 'the fire-lit cue fires once');
const fuel0 = state(Campfire).fuel;
await move('right', [1.2, 1.2, -.9], { seconds: .5 });
await release();
await sleep(1200);
check(state(Campfire).fuel < fuel0, 'fuel burns down while lit');

section('S2 cook, fill a bowl and eat');
for (const food of ['meat', 'mushroom']) {
  await grab(loose(food), 'right', food);
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
const filled = await waitFor(() => item(loose('bowl')).variant === 'meat+mushroom', 1500);
check(filled, 'dipping the bowl in the pot fills it');
await shot('03-bowl-filled');
const hungerBefore = state(GameState).hunger;
const mouth = head();
await move('right', [mouth.x + .02, mouth.y - .12, mouth.z - .08], { seconds: .8 });
const ate = await waitFor(() => state(GameState).hunger >= Math.min(100, hungerBefore + 40) - 1, 3000);
const game = state(GameState);
check(ate, `eating at the mouth restores hunger ${Math.round(hungerBefore)} → ${Math.round(game.hunger)}`);
check((game.objectives & 3) === 3, 'objectives: fire lit and meal eaten');
await move('right', [1.0, 1.1, -1.0], { seconds: .5 });
await release();

section('S3 craft a torch on the bench and light it');
for (const [material, index] of [['stick', 0], ['cloth', 1], ['resin', 2]] as const) {
  await grab(loose(material), 'right', material);
  const to = bay(index);
  await move('right', [to[0], 1.7, to[2] + .3], { seconds: .6 });
  await move('right', to, { seconds: .5 });
  await release();
}
check(state(CraftBench).match === 'torch', `the bays match: ${state(CraftBench).match}`);
const hammer = await grab(loose('hammer'), 'right', 'hammer');
await move('right', [-1.0, 1.5, -1.2], { seconds: .4 });
// Face down: the hammer's local +X (one striking face) rotated onto world -Y.
await turnHeld('right', hammer.entity, [0, 0, -Math.SQRT1_2, Math.SQRT1_2]);
const FACE: V3 = [.123, .22, 0];
const PAD: V3 = [CAMP.work.x, CAMP.work.y, CAMP.work.z];
for (let i = 0; i < 3; i++) {
  await bring('right', hammer.entity, FACE, [PAD[0], PAD[1] + .3, PAD[2]], .4);
  await bring('right', hammer.entity, FACE, [PAD[0], PAD[1] - .03, PAD[2]], .15);
  await sleep(300);
}
check(eventsOf('strike').filter((event) => event.valid).length >= 3, 'three hammer strikes land on the pad');
await move('right', [-1.0, 1.6, -1.0], { seconds: .5 });
await release();
const torchMade = await waitFor(() => items(loose('torch')).length > 0, 1500);
check(torchMade, 'three strikes craft a torch on the pad');
check(state(GameState).stage >= 1, 'crafting fire technology raises the danger stage');
const torch = await grab(loose('torch'), 'right', 'torch');
await move('right', [.75, 1.2, -1.2], { seconds: .6 });
await turnHeld('right', torch.entity, UPRIGHT);
await bring('right', torch.entity, ITEMS.torch.tip!, [FIRE[0], .55, FIRE[2]], .8);
const torchLit = await waitFor(() => item(loose('torch')).lit, 2500);
check(torchLit, 'holding the torch head in the fire lights it');
await look([FIRE[0], 1, FIRE[2]]);
await shot('04-torch-lit');
await move('right', [.9, 1.1, -1.2], { seconds: .6 });
await release();
done('opening');
