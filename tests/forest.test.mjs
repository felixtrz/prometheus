import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const forest = await loadTs('src/game/forest.ts');
const save = await loadTs('src/game/save.ts');
const { FELL, REGROWN_AFTER } = forest;

test('a felled tree runs falling → lying → sinking → stump → growing → standing', () => {
  assert.equal(forest.treePhase(NaN), 'standing', 'never felled');
  assert.equal(forest.treePhase(-1), 'standing');
  assert.equal(forest.treePhase(0), 'falling');
  assert.equal(forest.treePhase(FELL.fallSeconds + .1), 'lying');
  assert.equal(forest.treePhase(FELL.fallSeconds + FELL.lieSeconds + .1), 'sinking');
  assert.equal(forest.treePhase(FELL.stumpSeconds - 1), 'stump');
  assert.equal(forest.treePhase(FELL.stumpSeconds + 1), 'growing');
  assert.equal(forest.treePhase(REGROWN_AFTER), 'standing');
  assert.ok(REGROWN_AFTER >= 300, 'regrowth takes several minutes');
});

test('the trunk topples ever faster, lands near flat, and the sapling stands upright', () => {
  assert.equal(forest.fallAngle(NaN), 0);
  assert.equal(forest.fallAngle(0), 0);
  const early = forest.fallAngle(FELL.fallSeconds * .25), late = forest.fallAngle(FELL.fallSeconds * .75);
  assert.ok(late - early > early, 'accelerates like a hinged pole');
  const landed = forest.fallAngle(FELL.fallSeconds + 2);
  assert.ok(Math.abs(landed - FELL.restAngle) < 1e-9 && landed < Math.PI / 2);
  assert.equal(forest.fallAngle(FELL.stumpSeconds + 1), 0, 'a regrowing tree is upright');
  assert.equal(forest.sinkFraction(FELL.stumpSeconds + 1), 0, 'and not sunk');
  assert.equal(forest.sinkFraction(NaN), 0, 'a standing tree never sinks (NaN-safe)');
  assert.equal(forest.sinkFraction(FELL.fallSeconds + FELL.lieSeconds + FELL.sinkSeconds), 1);
});

test('regrowth: sapling size at sprouting, full size when grown; stump until then', () => {
  assert.equal(forest.growth(NaN), 1);
  assert.equal(forest.growth(1), 1, 'the falling trunk is full size');
  assert.ok(Math.abs(forest.growth(FELL.stumpSeconds) - FELL.sapling) < 1e-9);
  const mid = forest.growth(FELL.stumpSeconds + FELL.growSeconds / 2);
  assert.ok(mid > .5 && mid < 1);
  assert.ok(forest.stumpShown(FELL.stumpSeconds - .1) && !forest.stumpShown(FELL.stumpSeconds));
  assert.ok(!forest.stumpShown(NaN));
  assert.ok(forest.trunkShown(NaN) && forest.trunkShown(1) && !forest.trunkShown(FELL.stumpSeconds - 1));
});

test('felling yields firewood logs by trunk size, and sticks', () => {
  assert.deepEqual(forest.fellYield(6, false), { logs: 2, sticks: 2 });
  assert.deepEqual(forest.fellYield(4.2, true), { logs: 1, sticks: 3 });
});

test('felled trees save by position key and age; grown-back ones are dropped', () => {
  assert.equal(forest.treeKey(-24.43, -12.18), '-244:-122');
  const saved = forest.saveTrees([{ key: 'a', age: 12.34 }, { key: 'b', age: REGROWN_AFTER + 1 }, { key: 'c', age: NaN }]);
  assert.deepEqual(saved, [{ k: 'a', t: 12.3 }]);
});

test('a save keeps valid felled trees and drops a malformed list without losing the journey', () => {
  const base = {
    v: 1, savedAt: 0,
    game: { hunger: 70, health: 100, clock: 0, day: 1, stage: 0, objectives: 0, pages: 0, recipes: 0, respawn: [0, 0, 0] },
    fire: { fuel: 0, lit: false, potA: '', potB: '', stir: 0, stew: '' },
    pack: null, items: [], consumed: [], nodes: [], beacons: [], sentries: [],
  };
  assert.deepEqual(save.parseSave(JSON.stringify({ ...base, trees: [{ k: '1:2', t: 30 }] })).trees, [{ k: '1:2', t: 30 }]);
  const bad = save.parseSave(JSON.stringify({ ...base, trees: [{ k: 1 }] }));
  assert.ok(bad, 'the journey still loads');
  assert.equal(bad.trees, undefined);
  assert.equal(save.parseSave(JSON.stringify(base)).trees, undefined, 'older saves have no trees');
});
