/**
 * S4, S10, S11: an expedition on foot, every tool made from gathered materials. Fell a
 * tree for firewood, twist camp reeds into cord, fetch flint from the brook, craft a
 * spear and stalk a deer; then split a log on the stump for planks, carve a trigger
 * latch, bind a bow limb, build the crossbow, make bolts, load and fire. Every trip is
 * walked with the thumbstick.
 *   npm run check -- expedition
 */
import { Vector3 } from '@iwsdk/core';
import { ITEMS } from '/src/game/catalog.ts';
import { Airborne, Carcass, Creature, GameState } from '/src/game/components.ts';
import { ForestSystem } from '/src/game/systems/forest-system.ts';
import { craft, gatherKind, pointAxis, pointY, putAway, splitLog, twistCord } from '/vitexec/lib/camp.ts';
import {
  all, approach, boot, bring, check, done, enterXR, eventsOf, grab, head, horizontal, item, items, local,
  locomote, look, loose, move, nearest, note, read, release, rest, same, section, shot, sleep, state, trigger,
  turnHeld, until, waitFor, walk, world, worldPos,
} from '/vitexec/lib/harness.ts';
import { beginJourney, skipOpening } from '/vitexec/lib/journey.ts';

const node = (kind: string) => (it: { kind: string; slot: string }) => it.kind === kind && it.slot === 'node';

await boot();
await enterXR();
await beginJourney();
await skipOpening();
await walk([0, 1.6, .8]);
await look([0, 1.2, -2]);
await rest('left');
await rest('right');

if (await section('S4 fell a tree for firewood')) {
  const axe = await grab(loose('axe'), 'right', 'axe');
  await rest('right');
  const forest = world.getSystem(ForestSystem)!;
  const tree = forest.nearestChoppable(0, -3)!;
  check(tree, 'a standing tree near camp can be felled');
  const trunk = new Vector3(tree.x, tree.ground, tree.z);
  note(`felling a ${tree.height.toFixed(1)} m tree ${horizontal(trunk, head()).toFixed(1)} m away`);
  await approach(trunk, 1.1);
  // Swing sideways into the bark at chest height, pulling well back between blows.
  const side = head().sub(trunk).setY(0).normalize();
  const bark = (reach: number): [number, number, number] =>
    [tree.x + side.x * (forest.trunkRadius(tree) + reach), tree.ground + 1.1, tree.z + side.z * (forest.trunkRadius(tree) + reach)];
  for (let i = 0; i < 7 && forest.stateOf(tree) === 'standing'; i++) {
    await bring('right', axe.entity, ITEMS.axe.tip!, bark(.65), .35);
    await bring('right', axe.entity, ITEMS.axe.tip!, bark(-.03), .12);
    await sleep(380);
  }
  check(forest.stateOf(tree) === 'felled', 'axe blows fell the tree');
  check(eventsOf('chop').filter((e) => e.node === 'tree').length >= 5, `each blow lands (${eventsOf('chop').filter((e) => e.node === 'tree').length} chop cues)`);
  await putAway('right');
  check(item(loose('axe')).slot === 'hip-right', 'the axe goes back on the right hip');
  check(await waitFor(() => eventsOf('thud').some((e) => e.kind === 'tree-fall'), 4000), 'the tree crashes down');
  await shot('05-tree-felled');
  check(await waitFor(() => eventsOf('harvest').some((e) => e.kind === 'log'), 5000), 'the fallen trunk breaks into firewood');
  await sleep(800);
  const reach = tree.height + 1.5;
  const yields = items((it) => ['log', 'stick'].includes(it.kind) && it.slot === '' && horizontal(it.position, trunk) < reach);
  check(yields.some((it) => it.kind === 'log') && yields.filter((it) => it.kind === 'stick').length >= 2,
    `the tree gives ${yields.map((it) => it.kind).join(', ')}`);
  // One trip's worth into the pack: sticks for the spear, the latch, the limb and the bolts,
  // and a log to split for planks.
  const fallen = yields.find((it) => it.kind === 'stick')!.position;
  await gatherKind('stick', 5, [fallen.x, fallen.y, fallen.z]);
  await gatherKind('log', 1, [fallen.x, fallen.y, fallen.z]);
  const packed = (kind: string) => items((it) => it.kind === kind && it.slot.startsWith('pack-')).length;
  check(packed('stick') === 5 && packed('log') >= 1, `the pack carries ${packed('stick')} sticks (stacked) and ${packed('log')} log`);
}

if (await section('S4 gather reeds by camp and twist cord')) {
  // Both camp clumps, three reeds each: enough for two cords (the spear's and the limb's).
  await gatherKind('reeds', 6);
  check(eventsOf('harvest').filter((event) => event.kind === 'reeds').length >= 2, 'reeds are pulled from both clumps by camp');
  const reeds = items((it) => it.kind === 'reeds');
  const packedReeds = reeds.filter((it) => it.slot.startsWith('pack-')).length;
  check(packedReeds >= 6, `${packedReeds} reeds ride in the pack, stacked (the pack started with one)`);
  await twistCord();
}

if (await section('S4 forage flint at the brook')) {
  // One trip for all three: the spear's, the latch's and the bolts'.
  await gatherKind('flint', 3);
  check(eventsOf('harvest').some((event) => event.kind === 'flint'), 'flint is picked from the brook bed');
  check(items((it) => it.kind === 'flint' && it.slot.startsWith('pack-')).length === 3, 'three flints ride in the pack');
  await shot('06-brook');
}

if (await section('S10 craft a spear and hunt')) {
  const spearMade = await craft('spear', ['stick', 'flint', 'cord']);
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
  await sleep(1800); // the 1.4 s fall ends; the deer lies as a carcass
  const at: [number, number, number] = [kill!.x, 0, kill!.z];
  const carcass = all(Carcass).sort((a, b) => horizontal(worldPos(a), at) - horizontal(worldPos(b), at))[0];
  check(carcass && read(carcass, Carcass).state === 'lying' && horizontal(worldPos(carcass), at) < 2, 'the deer lies where it fell');
  check(!all(Creature).includes(carcass), 'the carcass no longer counts as a creature');
  check(items((it) => it.kind === 'meat' && horizontal(it.position, at) < 3).length === 0, 'no meat before butchering');
  await putAway('right'); // the spear rides in the pack
  const axe = await grab(loose('axe'), 'right', 'axe');
  await rest('right');
  const body = worldPos(carcass);
  const centre: [number, number, number] = [body.x, body.y + .22, body.z];
  await approach(centre, 1.0);
  for (let i = 0; i < 4 && carcass.active && read(carcass, Carcass).state === 'lying'; i++) {
    await bring('right', axe.entity, ITEMS.axe.tip!, [centre[0], centre[1] + 1.0, centre[2]], .35);
    await bring('right', axe.entity, ITEMS.axe.tip!, [centre[0], centre[1] - .05, centre[2]], .12);
    await sleep(420);
  }
  check(eventsOf('chop').some((e) => e.node === 'carcass' && e.remaining === 0), 'axe blows butcher the deer');
  await sleep(1500);
  const meat = items((it) => it.kind === 'meat' && horizontal(it.position, centre) < 2);
  check(meat.length >= 2, `butchering yields ${meat.length} meat`);
  check(!carcass.active, 'the butchered carcass sinks away');
  check(eventsOf('harvest').some((e) => e.kind === 'meat'), 'the meat harvest cue fires (it completes the hunt)');
  await putAway('right');
  await gatherKind('meat', 2, centre);
}

if (await section('S11 split a log on the stump for planks')) {
  await splitLog();
}

if (await section('S11 carve a trigger latch: plank, stick, flint')) {
  await craft('trigger', ['plank', 'stick', 'flint']);
}

if (await section('S11 bind a bow limb: stick, cord, resin')) {
  await twistCord(); // the pack's other three reeds
  await craft('limb', ['stick', 'cord', 'resin']);
}

if (await section('S11 build the crossbow: plank, limb, latch')) {
  const bow = await craft('crossbow', ['plank', 'limb', 'trigger']);
  check(state(GameState).stage >= 2, `the crossbow raises the danger stage to ${state(GameState).stage}`);
  // Off the pad and into the pack before the next craft lands there.
  await grab(same(bow.entity), 'right', 'crossbow');
  await putAway('right');
  check(item(same(bow.entity)).slot.startsWith('pack-'), 'the crossbow rides in the pack');
}

if (await section('S11 bolts, reload and fire')) {
  const bundle = await craft('bolts', ['stick', 'stick', 'flint']);
  check(bundle.charges === 6, `a bundle holds ${bundle.charges} bolts`);
  const bow = await grab(loose('crossbow'), 'right', 'crossbow');
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
  await putAway('right'); // the crossbow rides in the pack
}

done('expedition');
