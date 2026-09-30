import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the actual pure creature helpers (no imports in the module, so a data: URL works).
const source = readFileSync(new URL('../src/game/creature-ai.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const ai = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const FLEE = { panicRadius: 2.5, hurryRadius: 6, hurrySpeed: 1.2 };
const BOUNDS = { minX: -35, maxX: 35, minZ: -65, maxZ: 14 };

test('headings face +Z at zero and turn the short way round', () => {
  assert.ok(near(ai.headingTo(0, 0, 0, 5), 0));
  assert.ok(near(ai.headingTo(0, 0, 3, 0), Math.PI / 2));
  // From just below +π to just above −π is a small positive turn, not a full spin.
  const turned = ai.turnToward(Math.PI - 0.05, -Math.PI + 0.05, 1);
  assert.ok(near(turned, -Math.PI + 0.05));
  assert.ok(near(ai.turnToward(0, 1, 0.25), 0.25));
  assert.ok(near(ai.turnToward(0, -1, 0.25), -0.25));
  assert.ok(near(ai.turnToward(0.1, 0.12, 0.25), 0.12));
});

test('prey ignore a slow walker but flee from hurry or a close approach', () => {
  assert.equal(ai.shouldFlee(5, 0.8, FLEE), false, 'slow walk at 5 m is fine');
  assert.equal(ai.shouldFlee(5, 1.6, FLEE), true, 'hurrying at 5 m scares');
  assert.equal(ai.shouldFlee(7, 3, FLEE), false, 'sprinting outside 6 m is fine');
  assert.equal(ai.shouldFlee(2, 0, FLEE), true, 'standing within 2.5 m scares');
});

test('ring targets stay on the ring and lead in the chosen direction', () => {
  const out = { x: 0, z: 0 };
  ai.ringPoint(1, 2, 8, 0, out);
  assert.ok(near(out.x, 1) && near(out.z, 10));
  ai.ringTarget(0, 10, 0, 0, 8, 0.4, 1, out);
  assert.ok(near(Math.hypot(out.x, out.z), 8));
  assert.ok(near(Math.atan2(out.x, out.z), 0.4));
  ai.ringTarget(0, 10, 0, 0, 8, 0.4, -1, out);
  assert.ok(near(Math.atan2(out.x, out.z), -0.4));
});

test('push outside and bounds clamp keep creatures legal', () => {
  const p = { x: 1, z: 0 };
  assert.equal(ai.pushOutside(p, 0, 0, 6), true);
  assert.ok(near(p.x, 6) && near(p.z, 0));
  assert.equal(ai.pushOutside(p, 0, 0, 6), false);
  const centre = { x: 0, z: 0 };
  ai.pushOutside(centre, 0, 0, 1);
  assert.ok(near(Math.hypot(centre.x, centre.z), 1));
  const q = { x: 50, z: -80 };
  assert.equal(ai.clampToBounds(q, BOUNDS, 1), true);
  assert.deepEqual(q, { x: 34, z: -64 });
  assert.equal(ai.clampToBounds(q, BOUNDS, 1), false);
});

test('detour steers around a blocked disc toward the target side', () => {
  const out = { x: 0, z: 0 };
  // Clear path: target unchanged.
  assert.equal(ai.detour(-10, 10, { x: 10, z: 10 }, 0, 0, 6, 0.5, out), false);
  assert.ok(near(out.x, 10) && near(out.z, 10));
  // Straight through the disc from +Z to −Z: the detour stays outside the disc.
  assert.equal(ai.detour(0.5, 10, { x: 0.5, z: -10 }, 0, 0, 6, 0.5, out), true);
  assert.ok(Math.hypot(out.x, out.z) >= 6);
  // Target lies at +X of the start's bearing: the detour bends toward +X.
  assert.equal(ai.detour(0, 8, { x: 7, z: -3 }, 0, 0, 6, 0.5, out), true);
  assert.ok(out.x > 0, `expected +X detour, got ${out.x}`);
  assert.equal(ai.detour(0, 8, { x: -7, z: -3 }, 0, 0, 6, 0.5, out), true);
  assert.ok(out.x < 0, `expected −X detour, got ${out.x}`);
  // Starting inside the disc aims radially outward.
  ai.detour(0, 2, { x: 0, z: 0 }, 0, 0, 6, 0.5, out);
  assert.ok(near(out.x, 0) && out.z > 6);
});

test('flee and wander points are deterministic and inside their discs', () => {
  const out = { x: 0, z: 0 };
  ai.fleePoint(0, 0, 0, -3, 5, 0, out);
  assert.ok(near(out.x, 0) && near(out.z, 5));
  for (let seed = 0; seed < 50; seed++) {
    ai.wanderPoint(16, -15, 4, seed, out);
    assert.ok(Math.hypot(out.x - 16, out.z + 15) <= 4 + 1e-9);
    const again = ai.wanderPoint(16, -15, 4, seed, { x: 0, z: 0 });
    assert.ok(near(again.x, out.x) && near(again.z, out.z));
  }
  for (let seed = 0; seed < 200; seed++) {
    const h = ai.hash01(seed * 0.37);
    assert.ok(h >= 0 && h < 1);
  }
});

test('night wolf count follows the stage table, peaceful at stage 0', () => {
  const table = [0, 1, 3, 5];
  assert.equal(ai.wolvesFor(0, table), 0);
  assert.equal(ai.wolvesFor(1, table), 1);
  assert.equal(ai.wolvesFor(2, table), 3);
  assert.equal(ai.wolvesFor(3, table), 5);
  assert.equal(ai.wolvesFor(9, table), 5);
  assert.equal(ai.wolvesFor(-1, table), 0);
});

test('attack window: telegraph, lunge, then a bite only within reach', () => {
  assert.equal(ai.attackPhase(0, 0.8, 0.3), 'telegraph');
  assert.equal(ai.attackPhase(0.79, 0.8, 0.3), 'telegraph');
  assert.equal(ai.attackPhase(0.8, 0.8, 0.3), 'lunge');
  assert.equal(ai.attackPhase(1.1, 0.8, 0.3), 'done');
  assert.equal(ai.biteLands(0, 0, 0.7, 0.7, 1.2), true);
  assert.equal(ai.biteLands(0, 0, 1.0, 1.0, 1.2), false);
  const end = ai.lungeEnd(0, 0, 0, 2.2, 0.8, { x: 0, z: 0 });
  assert.ok(near(end.z, 1.4));
  // A still player is bitten; one who stepped back 0.5 m is not.
  assert.equal(ai.biteLands(end.x, end.z, 0, 2.2, 1.2), true);
  assert.equal(ai.biteLands(end.x, end.z, 0, 2.7, 1.2), false);
  // Never lunge backward when already closer than the stop distance.
  const close = ai.lungeEnd(0, 0, 0, 0.3, 0.8, { x: 0, z: 0 });
  assert.ok(near(close.z, 0));
});

test('wolves circle while the player is safe, stalk when exposed, attack up close', () => {
  assert.equal(ai.wolfIntent(true, 3, 30, 2.2), 'prowl');
  assert.equal(ai.wolfIntent(false, 40, 30, 2.2), 'prowl');
  assert.equal(ai.wolfIntent(false, 12, 30, 2.2), 'stalk');
  assert.equal(ai.wolfIntent(false, 2, 30, 2.2), 'attack');
});

test('approach and smoothing are bounded', () => {
  assert.equal(ai.approach(0, 1, 0.25), 0.25);
  assert.equal(ai.approach(1, 0, 2), 0);
  assert.ok(near(ai.smoothing(1 / 72, 0), 1));
  const k = ai.smoothing(1 / 72, 0.25);
  assert.ok(k > 0 && k < 0.1);
});

test('view cone: ahead is in view, behind and far to the side are not', () => {
  assert.equal(ai.inView(0, -1, 0, 0, 0, -10, .2), true);
  assert.equal(ai.inView(0, -1, 0, 0, 0, 10, .2), false);
  assert.equal(ai.inView(0, -1, 0, 0, 10, 0, .2), false);
  assert.equal(ai.inView(0, -2, 0, 0, 3, -10, .2), true, 'forward need not be normalised');
});

test('packs flank from stage 2; guardian waves count thresholds reached', () => {
  assert.equal(ai.attackSlots(1, 2), 1);
  assert.equal(ai.attackSlots(2, 2), 2);
  assert.equal(ai.attackSlots(3, 2), 2);
  const waves = [.02, .35, .65];
  assert.equal(ai.wavesReached(0, waves), 0);
  assert.equal(ai.wavesReached(.01, waves), 0);
  assert.equal(ai.wavesReached(.02, waves), 1);
  assert.equal(ai.wavesReached(.34, waves), 1);
  assert.equal(ai.wavesReached(.35, waves), 2);
  assert.equal(ai.wavesReached(.7, waves), 3);
  assert.equal(ai.wavesReached(1, waves), 3);
});

test('night wolves trickle in by wave, not all at dusk', () => {
  const at = [-8, 20, 45];
  const waves = [[0, 0, 0], [1, 0, 0], [2, 1, 0], [2, 2, 1]];
  assert.equal(ai.nightWolvesDue(3, -30, at, waves), 0, 'none before the first wave');
  assert.equal(ai.nightWolvesDue(3, -8, at, waves), 2);
  assert.equal(ai.nightWolvesDue(3, 19, at, waves), 2);
  assert.equal(ai.nightWolvesDue(3, 20, at, waves), 4);
  assert.equal(ai.nightWolvesDue(3, 100, at, waves), 5);
  assert.equal(ai.nightWolvesDue(2, 100, at, waves), 3);
  assert.equal(ai.nightWolvesDue(1, 100, at, waves), 1);
  assert.equal(ai.nightWolvesDue(9, 100, at, waves), 5, 'stages past the table use its last row');
  assert.equal(ai.nightWolvesDue(0, 100, at, waves), 0);
  assert.equal(ai.nightWolvesDue(-1, 100, at, waves), 0);
});

test('a held torch wards the cone in front of its flame, not the player\'s back', () => {
  const cos60 = Math.cos(Math.PI / 3);
  // Flame at the origin pointing +Z (reach 1.85, 60° half-angle, 0.9 m at the flame).
  const ward = (x, z, ax = 0, az = 1) => ai.torchWard(x, z, 0, 0, ax, az, 1.85, cos60, .9);
  assert.equal(ward(0, 1.5), 1, 'straight ahead within reach');
  assert.equal(ward(1.2, 1.2), 1, '45° off the axis');
  assert.equal(ward(1.5, .6), 0, '68° off the axis: outside the cone');
  assert.equal(ward(0, -1.5), 0, 'behind the flame');
  assert.equal(ward(0, 2.2), 0, 'beyond reach');
  assert.equal(ward(.5, -.5), 2, 'right at the flame, from any side');
  assert.equal(ward(0, 1.5, 0, 0), 0, 'a loose torch (no axis) wards only at the flame');
  assert.equal(ward(.3, .3, 0, 0), 2);
  // Bearings round the player measured from where the torch points.
  assert.ok(near(ai.bearingFromAxis(0, 0, 0, 1, 0, 5), 0));
  assert.ok(near(Math.abs(ai.bearingFromAxis(0, 0, 0, 1, 0, -5)), Math.PI));
  assert.ok(near(ai.bearingFromAxis(0, 0, 0, 1, 5, 0), Math.PI / 2));
  assert.ok(near(ai.bearingFromAxis(0, 0, 1, 0, 0, 5), -Math.PI / 2));
});

test('attacks wait for the pack gap and the bite cooldown; feints dart in, snap, hop back', () => {
  assert.equal(ai.attackReady(10, -Infinity, -Infinity, 1.2, 1.2), true);
  assert.equal(ai.attackReady(10, 9.5, -Infinity, 1.2, 1.2), false, 'within the gap after an attack');
  assert.equal(ai.attackReady(10, 8.7, -Infinity, 1.2, 1.2), true);
  assert.equal(ai.attackReady(10, 5, 9.5, 1.2, 1.2), false, 'just bitten');
  assert.equal(ai.attackReady(10, 5, 8.7, 3.2, 1.2), true);
  assert.equal(ai.feintPhase(0, .4, .25), 'in');
  assert.equal(ai.feintPhase(.45, .4, .25), 'snap');
  assert.equal(ai.feintPhase(.7, .4, .25), 'out');
});

test('finale guardians press the brazier from its far side, spread round it', () => {
  const out = { x: 0, z: 0 };
  // Brazier at the origin, player 1.6 m to +Z: the far spot is 1.8 m to -Z.
  ai.pressSpot(0, 0, 0, 1.6, 1.8, 0, out);
  assert.ok(near(out.x, 0) && near(out.z, -1.8));
  // Every offset stays on the ring and never comes round to the player's side.
  for (let n = 0; n < 12; n++) {
    const offset = ai.pressOffset(n) * 1.6;
    ai.pressSpot(0, 0, 0, 1.6, 1.8, offset, out);
    assert.ok(near(Math.hypot(out.x, out.z), 1.8));
    assert.ok(Math.hypot(out.x, out.z - 1.6) > 2.2, `spot ${n} is out of the player's attack range`);
  }
  // The first few guardians take distinct spots.
  const offsets = new Set([0, 1, 2, 3, 4].map((n) => ai.pressOffset(n)));
  assert.equal(offsets.size, 5);
  assert.ok([...Array(20).keys()].every((n) => Math.abs(ai.pressOffset(n)) <= 1));
  // A player standing on the brazier still gets a spot.
  ai.pressSpot(2, 3, 2, 3, 1.8, 0, out);
  assert.ok(near(Math.hypot(out.x - 2, out.z - 3), 1.8));
});

test('angular gaps are unsigned and wrap', () => {
  assert.ok(near(ai.angularGap(0, Math.PI / 2), Math.PI / 2));
  assert.ok(near(ai.angularGap(Math.PI - .1, -Math.PI + .1), .2));
  assert.ok(near(ai.angularGap(-1, 1), 2));
  assert.ok(near(ai.angularGap(3, 3), 0));
});

test('a carcass capsule measures the blade gap along its length and round its girth', () => {
  // Deer-like capsule: y .22, z -.62 → .55, radius .26.
  assert.ok(near(ai.capsuleGap(0, .22, 0, .22, -.62, .55, .26), -.26), 'centre is a radius inside');
  assert.ok(near(ai.capsuleGap(.5, .22, .3, .22, -.62, .55, .26), .24), 'beside the flank');
  assert.ok(near(ai.capsuleGap(0, .22, 1.05, .22, -.62, .55, .26), .24), 'past the end cap');
  assert.ok(near(ai.capsuleGap(0, .72, -.62, .22, -.62, .55, .26), .24), 'above the rump');
});

test('an axe blade butchers only with a brisk, re-armed swing', () => {
  const blow = (gap, speed, armed) => ai.bladeContact(gap, speed, armed, .08, .3, 1.8);
  assert.equal(blow(.02, 2.5, true), 'blow');
  assert.equal(blow(.02, 1.0, true), 'none', 'a slow touch is no blow');
  assert.equal(blow(.02, 2.5, false), 'none', 'resting the blade in the wound lands nothing more');
  assert.equal(blow(.2, 2.5, true), 'none', 'a near miss');
  assert.equal(blow(.4, 0, false), 'rearm', 'pulling back arms the next blow');
});
