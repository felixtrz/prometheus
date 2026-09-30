/**
 * S14, the shortest road to the ending: light the fire, craft and light a torch,
 * read Ilse's account at the outpost (page 5), climb to the Spire and hold the flame
 * in the beacon with one hand while the other keeps the Hollow guardians off. The
 * guardians that are not attacking crouch at the brazier and smother it, so standing
 * still no longer wins: here the free hand carries the crossbow page 5 teaches
 * (fixture: loaded with 8 bolts; crafting one is covered by the expedition check) and
 * shoots whichever guardian is most urgent. Walked with the thumbstick.
 *   npm run check -- finale
 */
import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { Beacon, Creature, GameState, Item } from '/src/game/components.ts';
import { ITEMS } from '/src/game/catalog.ts';
import { FINALE } from '/src/game/rules.ts';
import { LANDMARKS } from '/src/game/terrain.ts';
import { ItemSystem } from '/src/game/systems/item-system.ts';
import { craft, lightFire, lightTorch } from '/vitexec/lib/camp.ts';
import { beginJourney, skipOpening } from '/vitexec/lib/journey.ts';
import {
  all, boot, bring, check, done, enterXR, eventsOf, grab, head, horizontal, locomote, look, loose, move, nearest,
  holder, item, note, poseWorld, read, release, rest, same, section, shot, sleep, state, trigger, turnHeld, waitFor, walk, world,
  worldPos,
} from '/vitexec/lib/harness.ts';

/** A player's reaction time before answering a guardian (s), and the least time between two shots (s). */
const REACT = .45, SHOT_GAP = 1;
const BOLT_SPEED = 30;
const b = LANDMARKS.beacon;
const guardians = () => all(Creature).filter((e) => read(e, Creature).species === 'wolf' && read(e, Creature).mode !== 'dying');

await boot();
await enterXR();
await beginJourney();
await skipOpening();
await walk([0, 1.6, .8]);
await look([0, 1.2, -2]);
await rest('left');
await rest('right');

if (await section('S14 carry fire from camp')) {
  await lightFire();
  const made = await craft('torch', ['stick', 'reeds', 'resin']);
  const torch = await grab(same(made.entity), 'right', 'torch');
  await lightTorch('right', torch);
}

if (await section('S14 read Ilse\'s account at the outpost')) {
  await grab((it) => it.kind === 'page' && it.uid === 'page-5', 'left', 'page 5');
  check(await waitFor(() => (state(GameState).pages & (1 << (FINALE.requiresPage - 1))) !== 0, 1500), 'page 5 is found and read');
  await rest('left');
  await release('left');
}

if (await section('S14 climb to the Spire')) {
  for (const [x, z] of [[-2, -38], [2, -45], [b.x - .2, b.z + 1.6]] as const) await locomote([x, z], { tolerance: .5, ms: 40_000 });
  note(`at the Spire: head ${head().toArray().map((v) => v.toFixed(1)).join(',')}`);
  const items = world.getSystem(ItemSystem)!;
  const at = head();
  const bow = (await items.spawnItem('crossbow', at.x - .4, items.groundAt(at.x - .4, at.z) + .06, at.z, { charges: 8 }))!;
  note('fixture: a crossbow loaded with 8 bolts set down beside the player');
  await grab(same(bow), 'left', 'crossbow');
  await rest('left');
}

if (await section('S14 hold the flame with one hand, defend with the other')) {
  const torch = item((it) => it.kind === 'torch' && holder(it.entity) === 'right', 'torch in the right hand');
  const bow = item((it) => it.kind === 'crossbow' && holder(it.entity) === 'left', 'crossbow in the left hand').entity;
  await turnHeld('right', torch.entity, [0, 0, 0, 1]);
  await bring('right', torch.entity, ITEMS.torch.tip!, [b.x, b.y, b.z], .6);
  const healthAtStart = state(GameState).health;
  const hurt0 = eventsOf('hurt').length;
  const start = performance.now();
  void sleep(6000).then(() => shot('12-spire-hold'));
  const seen = new Map<number, number>();
  let lowest = healthAtStart, shots = 0, lastShot = -SHOT_GAP;
  const deadline = start + FINALE.holdSeconds * 3 * 1000;
  while (!state(GameState).ended && state(GameState).deaths === 0 && performance.now() < deadline) {
    const t = (performance.now() - start) / 1000;
    lowest = Math.min(lowest, state(GameState).health);
    // The most urgent guardian in range: crouching or lunging at us, then pressing the brazier, then the nearest.
    let target: (ReturnType<typeof guardians>)[number] | undefined, best = Infinity;
    for (const g of guardians()) {
      if (!seen.has(g.index)) seen.set(g.index, t);
      const { mode, speed } = read(g, Creature) as { mode: string; speed: number };
      const d = horizontal(worldPos(g), head());
      // A steady shot: crouching, pressing or close; not one running at range.
      if (mode === 'emerge' || d > 8 || (speed > 2 && d > 4) || t - seen.get(g.index)! < REACT) continue;
      const score = (mode === 'telegraph' || mode === 'lunge' ? 0 : mode === 'press' ? 100 : 200) + d;
      if (score < best) { best = score; target = g; }
    }
    if (!target || t - lastShot < SHOT_GAP || read(bow, Item).charges <= 0) {
      await sleep(50);
      continue;
    }
    // Aim at the body, leading a moving guardian over the bolt's flight.
    const c = read(target, Creature);
    const aim = worldPos(target);
    const flight = horizontal(aim, head()) / BOLT_SPEED;
    aim.x += Math.sin(c.heading) * c.speed * flight;
    aim.z += Math.cos(c.heading) * c.speed * flight;
    aim.y += .56;
    const hand = poseWorld('left');
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(hand, aim, new Vector3(0, 1, 0)));
    await move('left', [hand.x, hand.y, hand.z], { seconds: .12, quat: [q.x, q.y, q.z, q.w], reach: false });
    // Correct for the grip: the crossbow shoots along its own -Z.
    const object = bow.object3D!;
    object.updateMatrixWorld(true);
    const muzzle = (object.getObjectByName('muzzle') ?? object).getWorldPosition(new Vector3());
    const facing = object.getWorldDirection(new Vector3()).negate();
    q.premultiply(new Quaternion().setFromUnitVectors(facing, aim.clone().sub(muzzle).normalize()));
    await move('left', [hand.x, hand.y, hand.z], { seconds: .06, quat: [q.x, q.y, q.z, q.w], reach: false });
    trigger('left', 1);
    await sleep(60);
    trigger('left', 0);
    shots++;
    lastShot = (performance.now() - start) / 1000;
  }
  const seconds = (performance.now() - start) / 1000;
  const bites = eventsOf('hurt').length - hurt0;
  const slain = eventsOf('hit').filter((e) => e.species === 'wolf' && e.killed).length;
  note(`hold ${seconds.toFixed(1)} s; ${eventsOf('creature').filter((e) => e.cue === 'spawn' && e.species === 'wolf').length} guardians rose, ${slain} slain with ${shots} bolts; ${bites} bites; health ${Math.round(healthAtStart)} → lowest ${Math.round(lowest)}; guardians pressed the beacon ${eventsOf('beacon-pressed').filter((e) => e.joined).length} times`);
  check(state(GameState).ended && state(GameState).deaths === 0, `defending with the free hand, the flame held in the beacon lights it (${seconds.toFixed(0)} s)`);
  const spire = all(Beacon).find((e) => read(e, Beacon).role === 'spire');
  check(spire && read(spire, Beacon).lit, 'the Spire beacon burns');
  await sleep(9000);
  await look([b.x, b.y + 1, b.z - 3]);
  await shot('13-ending');
  const steps: string[] = eventsOf('ending-step').map((e) => e.step);
  check(['spire-eye', 'dawn', 'outpost', 'grove', 'camp', 'theme', 'smoke'].every((step) => steps.includes(step)),
    `the ending plays every beat (${steps.join(' → ')})`);
  const hollow = all(Creature).filter((e) => read(e, Creature).species === 'wolf' && read(e, Creature).mode !== 'dying');
  check(hollow.length === 0, 'the Hollow dissolve at dawn');
  check(horizontal(head(), [b.x, 0, b.z]) < 3, 'the player stands at the Spire for the ending');
  check(await waitFor(() => eventsOf('epilogue').length > 0, 25_000), `the epilogue offers the journey's tally (${JSON.stringify(eventsOf('epilogue')[0] ?? {})})`);
  await rest('right');
}

done('finale');
