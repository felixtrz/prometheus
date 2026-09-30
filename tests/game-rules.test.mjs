import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const recipes = await loadTs('src/game/recipes.ts');
const story = await loadTs('src/game/story.ts');
const rules = await loadTs('src/game/rules.ts');
const catalog = await loadTs('src/game/catalog.ts');

test('bench recipes match in any bay order and reject near misses', () => {
  assert.equal(recipes.BENCH_RECIPES[recipes.matchBench(['resin', 'stick', 'reeds'])].product, 'torch');
  assert.equal(recipes.BENCH_RECIPES[recipes.matchBench(['flint', 'stick', 'stick'])].product, 'bolts');
  assert.equal(recipes.matchBench(['stick', 'stick', 'stick']), -1);
  assert.equal(recipes.matchBench(['stick', 'reeds']), -1);
  assert.equal(recipes.matchBench(['stick', 'reeds', '']), -1);
});

test('the recipe tree: gathered materials make parts, parts make tools', () => {
  const make = (...kinds) => recipes.BENCH_RECIPES[recipes.matchBench(kinds)]?.product;
  assert.equal(make('reeds', 'reeds', 'reeds'), 'cord');
  assert.equal(make('stick', 'resin', 'stick'), 'plank');
  assert.equal(make('flint', 'plank', 'stick'), 'trigger');
  assert.equal(make('resin', 'cord', 'stick'), 'limb');
  assert.equal(make('cord', 'flint', 'stick'), 'spear');
  assert.equal(make('trigger', 'limb', 'plank'), 'crossbow');
  assert.equal(make('limb', 'trigger', 'log'), 'sentry-kit');
  // Every set is distinct, and the bench's three bays take exactly three parts.
  const keys = recipes.BENCH_RECIPES.map((r) => [...r.inputs].sort().join('+'));
  assert.equal(new Set(keys).size, keys.length);
  for (const r of recipes.BENCH_RECIPES) assert.equal(r.inputs.length, 3, r.product);
  // Only gathered materials are placed in the world; everything else is made.
  const gathered = new Set(['stick', 'log', 'resin', 'flint', 'reeds', 'meat', 'mushroom', 'berries', 'herb']);
  const made = new Set(recipes.BENCH_RECIPES.map((r) => r.product));
  for (const r of recipes.BENCH_RECIPES) for (const input of r.inputs) assert.ok(gathered.has(input) || made.has(input), `${r.product} needs ${input}`);
  assert.ok(!catalog.isItemKind('cloth') && !catalog.isItemKind('spring'), 'cloth and the iron spring are gone');
});

test('save bits: the five page-taught products keep their bits; the parts are known from the start', () => {
  assert.deepEqual(recipes.BENCH_RECIPES.slice(0, 5).map((r) => r.product), ['torch', 'spear', 'bolts', 'crossbow', 'sentry-kit']);
  assert.ok(recipes.BENCH_RECIPES.slice(0, 5).every((r) => !r.part));
  const parts = recipes.BENCH_RECIPES.filter((r) => r.part).map((r) => r.product);
  assert.deepEqual(parts.sort(), ['cord', 'limb', 'plank', 'trigger']);
  const known = recipes.knownRecipes(0);
  recipes.BENCH_RECIPES.forEach((r, i) => assert.equal((known & recipes.recipeBit(i)) !== 0, r.part, r.product));
  assert.equal(recipes.knownRecipes(1) & 1, 1, 'learned products stay known');
  for (const page of story.PAGES) if (page.teaches) assert.ok(!recipes.BENCH_RECIPES[recipes.benchRecipeIndex(page.teaches)].part, `page ${page.index} teaches a product`);
});

test('every recipe input and product is a catalog item', () => {
  for (const recipe of recipes.BENCH_RECIPES) {
    assert.ok(catalog.isItemKind(recipe.product), recipe.product);
    for (const input of recipe.inputs) assert.ok(catalog.isItemKind(input), input);
  }
});

test('stews need two ingredients and pay 1.5x', () => {
  assert.equal(recipes.stewValue('meat', 'mushroom'), 60);
  assert.equal(recipes.stewValue('meat', 'stick'), 0);
  assert.equal(recipes.stewId('mushroom', 'meat'), 'meat+mushroom');
  assert.equal(recipes.stewName('meat+mushroom'), 'Hearty stew');
});

test('pages teach known recipes and every objective is reachable in order', () => {
  for (const page of story.PAGES) if (page.teaches) assert.ok(recipes.benchRecipeIndex(page.teaches) >= 0, page.teaches);
  assert.equal(story.PAGES.length, 7);
  // The journey's three (appended bits 10-12) come first, then the camp's in bit order.
  assert.equal(story.currentObjective(0), story.objectiveIndex('escape'));
  assert.equal(story.currentObjective(story.JOURNEY_MASK), 0);
  assert.equal(story.currentObjective(story.JOURNEY_MASK | 0b111), 3);
  assert.equal(story.currentObjective((1 << story.OBJECTIVES.length) - 1), -1);
});

test('day cycle phases and nightness ease through dusk and dawn', () => {
  const { DAY } = rules;
  assert.equal(rules.phaseAt(10), 'day');
  assert.equal(rules.phaseAt(DAY.day + 1), 'dusk');
  assert.equal(rules.phaseAt(DAY.day + DAY.dusk + 1), 'night');
  assert.equal(rules.phaseAt(rules.DAWN_CLOCK + 1), 'dawn');
  assert.equal(rules.nightness(10), 0);
  assert.equal(rules.nightness(DAY.day + DAY.dusk + 5), 1);
  const mid = rules.nightness(DAY.day + DAY.dusk / 2);
  assert.ok(mid > .4 && mid < .6);
  assert.equal(rules.phaseAt(rules.DAY_LENGTH + 10), 'day');
});

test('camp surfaces catch dropped items, respecting rotation', () => {
  assert.equal(rules.surfaceHeight(-2.15, -1.55), 1.0);
  assert.equal(rules.surfaceHeight(1.96, -0.7), 0.79);
  assert.equal(rules.surfaceHeight(0, 0), -Infinity);
  // The bedroll is yawed; a point along its length is on it, one off its side is not.
  const bedroll = rules.SURFACES.find((surface) => surface.id === 'bedroll');
  const yaw = bedroll.yawDeg * Math.PI / 180;
  assert.equal(rules.surfaceHeight(bedroll.x + .6 * Math.cos(yaw), bedroll.z - .6 * Math.sin(yaw)), bedroll.y);
  assert.equal(rules.surfaceHeight(bedroll.x + .6 * Math.sin(yaw), bedroll.z + .6 * Math.cos(yaw)), -Infinity);
  // The chopping stump is the log-splitting surface GatherSystem reads.
  assert.ok(rules.SURFACES.some((surface) => surface.id === 'stump'));
});

test('bench bays are distinct and the pot and fire volumes do not overlap', () => {
  for (let bay = 0; bay < 3; bay++) {
    assert.equal(rules.benchBayAt(rules.CAMP.bench.x + rules.CAMP.slotOffsets[bay], rules.CAMP.bench.y, rules.CAMP.bench.z), bay);
  }
  assert.equal(rules.benchBayAt(rules.CAMP.work.x, rules.CAMP.bench.y, rules.CAMP.bench.z), -1);
  assert.equal(rules.inFire(rules.CAMP.pot.x, rules.CAMP.pot.y, rules.CAMP.pot.z), false);
  assert.ok(rules.inFireRing(rules.CAMP.fire.x, .3, rules.CAMP.fire.z));
});

test('night waves add up to the stage table and arrive across the night', () => {
  const { DANGER, DAY } = rules;
  assert.equal(DANGER.nightWaves.length, story.WOLVES_BY_STAGE.length);
  DANGER.nightWaves.forEach((row, stage) => {
    assert.equal(row.length, DANGER.nightWaveAt.length, `stage ${stage} row`);
    assert.equal(row.reduce((a, b) => a + b, 0), story.WOLVES_BY_STAGE[stage], `stage ${stage} total`);
  });
  // Waves are in order, the first at dusk's end and none after the night is over.
  for (let i = 1; i < DANGER.nightWaveAt.length; i++) assert.ok(DANGER.nightWaveAt[i] > DANGER.nightWaveAt[i - 1]);
  assert.ok(DANGER.nightWaveAt[0] > -DAY.dusk && DANGER.nightWaveAt[0] <= 0);
  // The last wave comes before sleep unlocks, so a sleeper has met the whole pack.
  assert.ok(DANGER.nightWaveAt.at(-1) < DAY.night * rules.SLEEP.minNightFraction);
  // No stage-3 night opens with the whole pack at once.
  assert.ok(DANGER.nightWaves[3][0] < story.WOLVES_BY_STAGE[3]);
});

test('the finale is a long hold with fixed waves: the torch hand holds, the other defends', () => {
  const { FINALE, DANGER } = rules;
  assert.ok(FINALE.holdSeconds >= 20, 'a hold long enough to be a climax');
  assert.equal(FINALE.waves.length, FINALE.waveSizes.length);
  for (let i = 1; i < FINALE.waves.length; i++) assert.ok(FINALE.waves[i] > FINALE.waves[i - 1]);
  assert.deepEqual([...FINALE.waveSizes], [2, 3, 5]);
  // One crossbow load (8 bolts) cannot clear every guardian: the last wave needs the sentry or a steady hand.
  assert.ok(FINALE.waveSizes.reduce((a, b) => a + b, 0) > 8);
  // One at a time, until the last wave comes two at once and faster.
  assert.equal(FINALE.attackSlots.length, FINALE.waves.length);
  assert.equal(FINALE.attackGap.length, FINALE.waves.length);
  assert.equal(rules.finaleSlots(1), 1);
  assert.equal(rules.finaleGap(1), FINALE.attackGap[0]);
  assert.equal(rules.finaleSlots(0), 1, 'before the first wave: the first wave\'s pacing');
  assert.equal(rules.finaleGap(0), FINALE.attackGap[0]);
  assert.equal(rules.finaleSlots(3), 2);
  assert.ok(rules.finaleGap(3) < rules.finaleGap(1));
  assert.equal(rules.finaleSlots(9), rules.finaleSlots(3));
  assert.equal(rules.finaleGap(9), rules.finaleGap(3));
  // Each attack can still be answered: the gap outlasts the warning crouch.
  for (const gap of FINALE.attackGap) assert.ok(gap > DANGER.telegraphSeconds * 2);
  // Holding fills the beacon, letting go cools it, guardians pressing drain it.
  const hold = 1 / FINALE.holdSeconds;
  assert.ok(Math.abs(rules.beaconRate(true, 0) - hold) < 1e-12);
  assert.ok(Math.abs(rules.beaconRate(false, 0) + FINALE.decayPerSecond) < 1e-12);
  assert.ok(rules.beaconRate(true, 1) < hold && rules.beaconRate(true, -2) === hold);
  // Drive most of them off and the hold still moves at a good pace ...
  assert.ok(rules.beaconRate(true, 2) > .6 * hold);
  // ... but the whole last wave pressing unanswered all but stalls it (standing still does not win).
  const total = FINALE.waveSizes.reduce((a, b) => a + b, 0);
  assert.ok(rules.beaconRate(true, total - FINALE.attackSlots.at(-1)) < .1 * hold);
  // A bite knocks the flame back, but less than two seconds of hold.
  assert.ok(FINALE.biteSetback > 0 && FINALE.biteSetback < 2 * hold * 1.01 + .02);
  // Letting go to defend costs little: a second away loses under three seconds of hold.
  assert.ok(FINALE.decayPerSecond * FINALE.holdSeconds < 3);
  // A quick jab with the beacon torch only pauses the fill (the guardians pressing still drain it).
  assert.ok(FINALE.graceSeconds >= .8 && FINALE.graceSeconds <= 1.5);
  assert.equal(rules.beaconRate(false, 0, true), 0);
  assert.ok(Math.abs(rules.beaconRate(false, 2, true) + 2 * FINALE.pressPerGuardian) < 1e-12);
  assert.ok(Math.abs(rules.beaconRate(true, 0, true) - hold) < 1e-12, 'grace never slows a steady hold');
  // The press ring sits inside the press radius and outside the flame's reach from the hold.
  assert.ok(FINALE.pressRing < FINALE.pressRadius);
});

test('a pincer\'s second wolf crouches a beat after the first, inside one warning crouch', () => {
  const { DANGER } = rules;
  assert.ok(DANGER.pincerStagger >= .25 && DANGER.pincerStagger < DANGER.telegraphSeconds);
});

test('the sentry leads its target but its aim wanders: sure up close, about three in four at range', () => {
  const p = (distance, speed) => rules.hitChance(rules.sentrySpread(distance, speed));
  assert.ok(p(3, 0) > .93, `point blank ${p(3, 0)}`);
  for (const distance of [8, 10, 12]) {
    const hit = p(distance, 1.5);
    assert.ok(hit >= .7 && hit <= .85, `a prowler at ${distance} m: ${hit.toFixed(2)}`);
  }
  assert.ok(p(10, 6) < .6, 'a running wolf at range is hit about half the time');
  assert.ok(p(12, 1.5) < p(6, 1.5) && p(10, 4) < p(10, 0), 'spread grows with distance and speed');
  assert.equal(rules.hitChance(0), 1);
  assert.ok(rules.SENTRY.range >= 10);
});

test('no death spiral: the fire relights on respawn and a cold sleep never kills', () => {
  const { SURVIVAL, SLEEP, DANGER, DAY } = rules;
  assert.ok(SURVIVAL.respawnFuel >= 20, 'enough fuel to feed it before it dies again');
  // Once the Hollow smother the fire, the relit fire outlasts the shaken spell against the whole
  // pack (after the respite, when they ring wider): a death's night can be slept out without wood.
  assert.equal(rules.respawnFuelFor(1), SURVIVAL.respawnFuel);
  assert.equal(rules.respawnFuelFor(DANGER.smotherFromStage), SURVIVAL.respawnFuelSmother);
  const pack = DANGER.nightWaves[3].reduce((a, b) => a + b, 0);
  const idle = DANGER.respiteSeconds + (SURVIVAL.respawnFuelSmother - SURVIVAL.fuelPerSecond * DANGER.respiteSeconds) /
    (SURVIVAL.fuelPerSecond + pack * DANGER.smotherPerWolf);
  assert.ok(idle > SLEEP.shakenSeconds, `relit fire lasts ${idle.toFixed(0)} s`);
  assert.ok(SURVIVAL.respawnFuelSmother <= SURVIVAL.maxFuel);
  assert.ok(DANGER.respiteSeconds >= 10);
  assert.ok(SURVIVAL.respawnHealth > DANGER.biteDamage * 2, 'a respawn survives two bites');
  assert.ok(SURVIVAL.coldSleepMinHealth > 0);
  assert.ok(SLEEP.coldWolfClearRadius > SLEEP.wolfClearRadius);
  assert.ok(SLEEP.minNightFraction > 0 && SLEEP.minNightFraction < .5);
  // ... but dying is no ticket to sleep: too shaken for a good while after a respawn.
  assert.ok(SLEEP.shakenSeconds >= 45 && SLEEP.shakenSeconds < DAY.night * (1 - SLEEP.minNightFraction));
  assert.ok(DANGER.biteCooldown >= 1.5 && DANGER.lowFuelSmother > DANGER.lowFuel);
  // The torch is a cone, not a circle.
  assert.ok(DANGER.torchConeDegrees < 90 && DANGER.torchCloseRadius < DANGER.torchRadius);
  assert.ok(DANGER.torchPushRadius < DANGER.torchCloseRadius);
});
