/**
 * S4, S10, S11: an expedition on foot. Chop deadwood in the grove, forage flint and
 * cord at the brook, craft a spear and stalk a deer, salvage the outpost for a
 * crossbow, make bolts, load and fire. Every trip is walked with the thumbstick.
 *   npm run check -- expedition
 */
import { Vector3 } from '@iwsdk/core';
import { ITEMS } from '/src/game/catalog.ts';
import { Airborne, Creature, GameState, ResourceNode } from '/src/game/components.ts';
import { hammerOut, pointAxis, pointY, toBay, toBenchEnd } from '/vitexec/lib/camp.ts';
import {
  all, approach, boot, bring, check, done, enterXR, eventsOf, grab, head, horizontal, item, items, local,
  locomote, look, loose, move, nearest, note, read, release, rest, same, section, shot, sleep, state, trigger,
  turnHeld, until, waitFor, walk, worldPos,
} from '/vitexec/lib/harness.ts';
import { beginJourney } from '/vitexec/lib/journey.ts';

const node = (kind: string) => (it: { kind: string; slot: string }) => it.kind === kind && it.slot === 'node';

await boot();
await enterXR();
await beginJourney();
await walk([0, 1.6, .8]);
await look([0, 1.2, -2]);
await rest('left');
await rest('right');

section('S4 chop deadwood in the grove');
const axe = await grab(loose('axe'), 'right', 'axe');
await rest('right');
const deadwood = all(ResourceNode)
  .filter((e) => read(e, ResourceNode).kind === 'deadwood')
  .sort((a, b) => horizontal(worldPos(a), [0, 0, 0]) - horizontal(worldPos(b), [0, 0, 0]))[0];
const log = worldPos(deadwood);
const centre: [number, number, number] = [log.x, log.y + .2, log.z];
await approach(centre, 1.0);
for (let i = 0; i < 3 && read(deadwood, ResourceNode).available; i++) {
  await bring('right', axe.entity, ITEMS.axe.tip!, [centre[0], centre[1] + 1.0, centre[2]], .35);
  await bring('right', axe.entity, ITEMS.axe.tip!, [centre[0], centre[1] - .05, centre[2]], .12);
  await sleep(420);
}
check(!read(deadwood, ResourceNode).available, 'three axe blows fell the deadwood');
await shot('05-deadwood-chopped');
check(eventsOf('chop').length >= 3, `each blow lands (${eventsOf('chop').length} chop cues)`);
await rest('right');
await release('right');
await sleep(1500);
const yields = items((it) => ['log', 'stick'].includes(it.kind) && horizontal(it.position, centre) < 2.5);
check(yields.length >= 3, `the deadwood splits into ${yields.map((it) => it.kind).join(', ')}`);
await grab(nearest(loose('stick'), centre), 'right', 'stick');
await rest('right');
await grab(nearest(loose('stick'), centre), 'left', 'stick');
await rest('left');
await toBay('right', 0);
await toBenchEnd('left');

section('S4 forage flint and cord at the brook');
await grab(nearest(node('flint'), head()), 'right', 'flint');
await rest('right');
check(eventsOf('harvest').some((event) => event.kind === 'flint'), 'flint is picked from the brook bed');
await grab(nearest(node('cord'), head()), 'left', 'reeds');
await rest('left');
check(eventsOf('harvest').some((event) => event.kind === 'reeds'), 'reeds are pulled for cord');
await shot('06-brook');

section('S10 craft a spear and hunt');
await toBay('right', 1);
await toBay('left', 2);
const spearMade = await hammerOut('spear');
check((state(GameState).objectives & (1 << 4)) !== 0, 'the spear objective completes');
const spear = await grab(same(spearMade.entity), 'right', 'spear');
await rest('right');
const liveDeer = () => all(Creature).filter((e) => {
  const c = read(e, Creature);
  return c.species === 'deer' && c.health > 0 && c.mode !== 'dying';
});
await locomote([10, -12]);
await until(() => liveDeer().length > 0, 45_000, 'a deer in the meadow');
let prey = liveDeer().sort((a, b) => horizontal(worldPos(a), head()) - horizontal(worldPos(b), head()))[0];
const preyAt = (): [number, number] => { const p = worldPos(prey); return [p.x, p.z]; };
note(`stalking a deer ${horizontal(worldPos(prey), head()).toFixed(1)} m away`);
let killed = false;
for (let attempt = 0; attempt < 4 && !killed; attempt++) {
  if (!prey.active || read(prey, Creature).health <= 0) break;
  // Walk in briskly, then creep under the deer's hurry speed (1.2 m/s) inside 6 m.
  await locomote(preyAt, { tolerance: 7 });
  await locomote(preyAt, { tolerance: 2.0, speed: .3 });
  const body = worldPos(prey).add(new Vector3(0, .85, 0));
  const dir = body.clone().sub(head()).setY(0).normalize();
  await turnHeld('right', spear.entity, pointY(dir), .25);
  const from = body.clone().addScaledVector(dir, -.9);
  const past = body.clone().addScaledVector(dir, .15);
  await bring('right', spear.entity, ITEMS.spear.tip!, [from.x, from.y, from.z], .2, false);
  const strike = worldPos(prey).add(new Vector3(0, .85, 0));
  const lead = strike.sub(body); // the deer may have drifted while we wound up
  await bring('right', spear.entity, ITEMS.spear.tip!, [past.x + lead.x, past.y + lead.y, past.z + lead.z], .1, false);
  killed = await waitFor(() => !prey.active || read(prey, Creature).health <= 0, 600);
  if (!killed) {
    note(`thrust ${attempt + 1} missed (deer ${read(prey, Creature).mode})`);
    await rest('right');
    if (read(prey, Creature).mode === 'flee') await sleep(4000);
  }
}
check(killed, 'a thrust of the spear brings down the deer');
await shot('07-hunt');
const kill = eventsOf('hit').find((event) => event.kind === 'spear' && event.killed);
check(kill, 'the hit cue reports a kill');
await sleep(1600);
const meat = items((it) => it.kind === 'meat' && horizontal(it.position, [kill!.x, 0, kill!.z]) < 3);
check(meat.length >= 1, `the deer leaves ${meat.length} meat`);
await rest('right');
await release('right');

section('S11 salvage the outpost for a crossbow');
await grab(nearest(node('cord'), head()), 'right', 'reeds');
await rest('right');
await grab(nearest(node('flint'), head()), 'left', 'flint');
await rest('left');
await toBay('right', 0);
await toBenchEnd('left');
await grab(nearest(loose('plank'), [-6.5, 0, -28.8]), 'right', 'plank');
await rest('right');
await grab(nearest(loose('trigger'), head()), 'left', 'trigger');
await rest('left');
await toBay('right', 1);
await toBay('left', 2);
const bowMade = await hammerOut('crossbow');
check(state(GameState).stage >= 2, `the crossbow raises the danger stage to ${state(GameState).stage}`);

section('S11 bolts, reload and fire');
await grab(nearest(loose('stick'), [-1.9, 1, -1.3]), 'right', 'stick');
await toBay('right', 0);
await grab(nearest(loose('stick'), [-1.9, 1, -1.3]), 'right', 'stick');
await toBay('right', 1);
await grab(nearest(loose('flint'), [-1.9, 1, -1.3]), 'right', 'flint');
await toBay('right', 2);
const bundle = await hammerOut('bolts');
check(bundle.charges === 6, `a bundle holds ${bundle.charges} bolts`);
const bow = await grab(same(bowMade.entity), 'right', 'crossbow');
await rest('right');
await grab(same(bundle.entity), 'left', 'bolt bundle');
const bowAt = worldPos(bow.entity);
await bring('left', bundle.entity, [0, 0, 0], [bowAt.x - .05, bowAt.y + .04, bowAt.z], .5, false);
const loaded = await waitFor(() => item(same(bow.entity)).charges === 6, 1500);
check(loaded, `touching the bundle to the bow loads ${item(same(bow.entity)).charges} bolts`);
check(eventsOf('reload').length >= 1, 'the reload cue fires');
await rest('left');
await release('left');
// Aim over the meadow: the crossbow shoots along its local -Z.
await locomote([0, -4]);
await look([0, 1.4, -14]);
await turnHeld('right', bow.entity, pointAxis([0, 0, -1], new Vector3(0, .05, -1)), .25);
trigger('right', 1);
const flying = await waitFor(() => all(Airborne).length > 0, 400);
trigger('right', 0);
check(flying, 'the trigger looses a bolt');
await shot('08-crossbow-shot');
check(item(same(bow.entity)).charges === 5, 'one bolt leaves the magazine');
check(eventsOf('crossbow-fire').length === 1, 'the crossbow twang cue fires');
const muzzle = local(bow.entity, ITEMS.crossbow.tip!);
note(`bolt away from ${muzzle.toArray().map((v) => v.toFixed(1)).join(',')}`);
await rest('right');
await release('right');
done('expedition');
