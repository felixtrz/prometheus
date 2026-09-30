/**
 * The particle pool behind every burst (src/game/fx-particles.ts): sizes are real, idle pools
 * cost no draw, and the grabbable sparkle is big enough to read from a couple of metres.
 * Transpiled into node_modules/.cache so its bare @iwsdk/core import resolves.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'node_modules/.cache', `fx-particles-tests-${process.pid}`);
after(() => rmSync(out, { recursive: true, force: true }));
const file = resolve(root, 'src/game/fx-particles.ts');
const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const target = join(out, relative(root, file)).replace(/\.ts$/, '.js');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, outputText);
const { BURSTS, ParticlePool, beckonRank } = await import(pathToFileURL(target).href);
const { Vector3 } = await import('@iwsdk/core');

test('an idle pool draws nothing; a burst shows it until its last particle dies', () => {
  const pool = new ParticlePool(8, true);
  assert.equal(pool.points.visible, false, 'hidden before any burst');
  pool.emit(new Vector3(0, 1, 0), BURSTS.sparks);
  assert.equal(pool.points.visible, true);
  for (let i = 0; i < 60; i++) pool.update(1 / 30);
  assert.equal(pool.points.visible, false, 'hidden again once every particle has faded');
});

test('burst sizes are drawn as given (per-particle size stream)', () => {
  const pool = new ParticlePool(4, false);
  pool.emit(new Vector3(), BURSTS.dust);
  pool.update(1 / 60);
  const sizes = pool.points.geometry.getAttribute('pSize');
  assert.equal(pool.points.material.size, 1, 'the material size is only a multiplier');
  assert.ok(Math.abs(sizes.getX(0) - BURSTS.dust.size) < 1e-6);
});

test('a grabbable sparkle reads from 2–3 m without being a flare', () => {
  const degreesAt = (size, metres) => size / metres * 180 / Math.PI;
  assert.ok(BURSTS.sparkle.count >= 3 && BURSTS.sparkle.count <= 4, 'a few glints, not a shower');
  assert.ok(degreesAt(BURSTS.sparkle.size, 2.5) >= 1, 'about a degree across at 2.5 m (6+ px on Quest 3)');
  assert.ok(BURSTS.sparkle.life >= .5 && BURSTS.sparkle.life <= .8, 'brief');
  assert.ok(BURSTS.beckon.size > BURSTS.sparkle.size, 'the current task\'s packed item beckons a little brighter');
  // A twinkle swells then shrinks: sizes start at 0, peak, and end near 0.
  const pool = new ParticlePool(4, true, 'star');
  pool.emit(new Vector3(), { ...BURSTS.sparkle, count: 1, sizeJitter: 0 });
  const sizes = pool.points.geometry.getAttribute('pSize');
  const trace = [];
  for (let i = 0; i < 30; i++) { pool.update(1 / 60); trace.push(sizes.getX(0)); }
  const peak = Math.max(...trace);
  assert.ok(trace[0] < peak * .5 && peak > BURSTS.sparkle.size * .9, `swells to its size (${peak.toFixed(3)})`);
});

test('page 1 beckons only after the meal or the note line, and then ahead of everything', () => {
  const state = { task: 'eat-meal', potA: '', potB: '', stew: '', placed: 0, mealDone: false, noteWaiting: true, noteStarted: false };
  assert.ok(beckonRank(state, 'meat', 'pack-0', '', 0) > 0, 'the meal comes first');
  assert.equal(beckonRank(state, 'page', 'pack-1', '', 1), -1, 'the page waits while the meal is the task');
  state.noteStarted = true;
  assert.equal(beckonRank(state, 'page', 'pack-1', '', 1), 0, 'the note line points at the page');
  state.noteStarted = false;
  state.mealDone = true;
  assert.equal(beckonRank(state, 'page', 'pack-1', '', 1), 0);
  assert.equal(beckonRank(state, 'page', 'pack-1', '', 2), -1, 'only page 1 beckons');
  state.noteWaiting = false;
  assert.equal(beckonRank(state, 'page', 'pack-1', '', 1), -1, 'a read note stops beckoning');
});

test('the opening journey beckons the loose axe and pack, and the lighter at the hip', () => {
  const state = { task: 'escape', potA: '', potB: '', stew: '', placed: 0, mealDone: false, noteWaiting: false, noteStarted: false };
  assert.ok(beckonRank(state, 'axe', '', '', 0) > 0, 'the axe on its bracket');
  assert.equal(beckonRank(state, 'axe', 'hip-right', '', 0), -1, 'not once holstered');
  state.task = 'waystation';
  assert.ok(beckonRank(state, 'pack', '', '', 0) > 0, 'the pack on the table');
  state.task = 'light-fire';
  assert.ok(beckonRank(state, 'lighter', 'hip-left', '', 0) > 0, 'the lighter at the hip');
  assert.ok(beckonRank(state, 'log', 'pack-2', '', 0) > 0, 'the firewood in the pack');
});
