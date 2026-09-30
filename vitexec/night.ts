/**
 * S12 and S9: make every part of a sentry from gathered materials (a cord from camp
 * reeds, a bow limb, a trigger latch from a plank split on the stump), build and load
 * it by the fire, then live through a night.
 * Wolves ring the lit fire but keep out of its light, circle it closely enough to
 * smother it, the sentry shoots at them, and a player who wanders off gets bitten.
 *   npm run check -- night
 */
import { Campfire, Creature, GameState, Sentry } from '/src/game/components.ts';
import { DANGER } from '/src/game/rules.ts';
import { BOLTS_PER_BUNDLE, SENTRY_STARTER_BOLTS } from '/src/game/recipes.ts';
import { craft, FIRE, gatherKind, lightFire, splitLog, twistCord } from '/vitexec/lib/camp.ts';
import {
  all, boot, bring, check, done, enterXR, eventsOf, fixture, grab, head, horizontal, items, locomote, look,
  loose, move, nearest, note, one, read, release, rest, same, section, shot, sleep, state, until, waitFor,
  walk, worldPos,
} from '/vitexec/lib/harness.ts';
import { beginJourney, skipOpening } from '/vitexec/lib/journey.ts';

const node = (kind: string) => (it: { kind: string; slot: string }) => it.kind === kind && it.slot === 'node';
const wolves = () => all(Creature).filter((e) => read(e, Creature).species === 'wolf' && read(e, Creature).mode !== 'dying');

await boot();
await enterXR();
await beginJourney();
await skipOpening();
await walk([0, 1.6, .8]);
await look([0, 1.2, -2]);
await rest('left');
await rest('right');

if (await section('S12 bolts for the sentry')) {
  await lightFire();
  // One gathering round into the pack: two flints from the brook (the bolts', the latch's)
  // and four sticks from round camp (two for the bolts, one each for the limb and the latch).
  await gatherKind('flint', 2);
  await gatherKind('stick', 4, [-1.9, 0, -.8]);
  await craft('bolts', ['stick', 'stick', 'flint']);
}

if (await section('S12 a bow limb: reeds into cord, then stick, cord and resin')) {
  await gatherKind('reeds', 3);
  check(eventsOf('harvest').some((event) => event.kind === 'reeds'), 'reeds are pulled from a clump by camp');
  await twistCord();
  await craft('limb', ['stick', 'cord', 'resin']);
}

if (await section('S12 a trigger latch from a split plank')) {
  await splitLog();
  await craft('trigger', ['plank', 'stick', 'flint']);
}

if (await section('S12 craft the sentry: log, limb and latch')) {
  await craft('sentry-kit', ['log', 'limb', 'trigger']);
  check(state(GameState).stage === 3, `the sentry kit raises the danger stage to ${state(GameState).stage}`);
}

if (await section('S9 night falls: wolves ring the fire')) {
  fixture(GameState, 'clock', 340);
  fixture(Campfire, 'fuel', 100);
  await locomote([FIRE[0] + 1.2, FIRE[2] + 1.4]);
  await look([FIRE[0], 1, FIRE[2] - 6]);
  await until(() => wolves().length >= 3, 40_000, 'wolves at stage 3');
  check(wolves().length >= 3, `${wolves().length} wolves hunt at stage 3`);
  let closest = Infinity;
  const smothered = await waitFor(() => {
    for (const wolf of wolves()) closest = Math.min(closest, horizontal(worldPos(wolf), FIRE));
    return eventsOf('fire-smothered').length > 0;
  }, 30_000);
  for (let i = 0; i < 40; i++) {
    for (const wolf of wolves()) closest = Math.min(closest, horizontal(worldPos(wolf), FIRE));
    await sleep(100);
  }
  check(smothered, 'wolves circling the lit fire start to smother it');
  check(closest >= DANGER.fireSafeRadius - .3, `wolves keep out of the firelight (closest ${closest.toFixed(1)} m)`);
  check(eventsOf('creature').some((event) => event.species === 'wolf' && event.cue === 'howl'), 'the wolves howl');
  {
    const wolf = wolves()[0];
    if (wolf) { const p = worldPos(wolf); await look([p.x, 1, p.z]); }
    await shot('09-night-ring');
  }
  check(state(GameState).deaths === 0 && state(GameState).health >= 99, 'by the fire the player is safe');
}

if (await section('S9 away from the fire, wolves bite')) {
  const before = state(GameState).health;
  note(`wolves: ${wolves().map((w) => `${read(w, Creature).mode}@${horizontal(worldPos(w), head()).toFixed(0)}m`).join(' ')}`);
  const hurt = () => state(GameState).health < before || state(GameState).deaths > 0;
  await locomote([0, 9], { stopWhen: hurt });
  const bitten = await waitFor(hurt, 25_000);
  await shot('10-bitten');
  check(bitten, `away from the fire at night, a wolf bites (${Math.round(before)} → ${Math.round(state(GameState).health)}, ${state(GameState).deaths} deaths)`);
  const bite = eventsOf('creature').filter((event) => event.cue === 'bite').length;
  check(bite >= 1 && eventsOf('hurt').some((event) => event.amount === DANGER.biteDamage), `each bite is telegraphed and costs ${DANGER.biteDamage}`);
  await locomote([FIRE[0] + 1.2, FIRE[2] + 1.4]);
  note(`back at the fire with ${Math.round(state(GameState).health)} health, ${state(GameState).deaths} deaths`);
}

if (await section('S12 deploy and load the sentry')) {
  await grab(loose('sentry-kit'), 'right', 'sentry kit');
  await locomote([1.3, .2]);
  const low = head();
  await move('right', [low.x + .1, low.y - 1.3, low.z - .5], { seconds: .5 });
  await release('right');
  check(await waitFor(() => all(Sentry).length === 1, 800), 'set down low near the fire, the kit unfolds into a sentry');
  const sentry = one(Sentry);
  check(eventsOf('sentry-deployed').length === 1, 'the sentry-set cue fires');
  const shots = () => eventsOf('sentry-fire').length;
  check(read(sentry, Sentry).bolts + shots() === SENTRY_STARTER_BOLTS, `the kit comes loaded with ${SENTRY_STARTER_BOLTS} bolts`);
  check(await waitFor(() => shots() > 0, 25_000), `the loaded sentry fires at the ringing wolves (${shots()} shots)`);
  {
    const p = worldPos(sentry);
    await look([p.x, .8, p.z]);
    await shot('11-sentry');
  }
  await rest('right');
  const bundle = await grab(loose('bolts'), 'right', 'bolt bundle');
  const turret = sentry.object3D!.getObjectByName('turret') ?? sentry.object3D!;
  const aim = turret.getWorldPosition(worldPos(sentry));
  await bring('right', bundle.entity, [0, 0, 0], [aim.x, aim.y + .1, aim.z], .6);
  check(await waitFor(() => eventsOf('reload').length > 0, 1500), 'touching a bolt bundle to it tops the sentry up');
  await rest('right');
  await release('right');
  const left = items(same(bundle.entity))[0]?.charges ?? 0;
  check(read(sentry, Sentry).bolts + shots() === SENTRY_STARTER_BOLTS + BOLTS_PER_BUNDLE - left, 'every bolt is accounted for: loaded, fired or still in the bundle');
  await sleep(4000);
  note(`sentry: ${shots()} shots, ${eventsOf('hit').filter((event) => event.species === 'wolf').length} wolf hits; fuel ${Math.round(state(Campfire).fuel)}`);
}

done('night');
