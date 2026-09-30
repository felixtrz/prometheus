import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const { boxFootprint, footprint, freeSpot, isClear, pushApart, reachOf, resolveOverlap, spiralPoint } = await loadTs('src/game/spread.ts');

const GAP = .025;
const close = (a, b, message, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${message}: ${a} vs ${b}`);

/** Column-major matrix: yaw about +Y (three's rotation.y), then translation. */
const yawMatrix = (deg, x = 0, y = 0, z = 0) => {
  const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1];
};
/** Lying on its side: 90° about Z (catalog lie 'side'), then yaw, then translation. */
const sideMatrix = (deg, x = 0, y = 0, z = 0) => {
  const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  // R = Ry(t) * Rz(90°): columns are Ry applied to (0,1,0), (-1,0,0), (0,0,1).
  return [0, 1, 0, 0, -c, 0, s, 0, s, 0, c, 0, x, y, z, 1];
};

/** A flat footprint straight from its fields. */
const fp = (x, z, hu, hv, deg = 0, y = 0, hy = .05) => {
  const t = deg * Math.PI / 180;
  return Object.assign(footprint(), { x, y, z, ux: Math.cos(t), uz: -Math.sin(t), hu, hv, hy });
};

/** Exact overlap test on the rectangles' corners (independent of the SAT code). */
const corners = (f) => {
  const vx = -f.uz, vz = f.ux;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [f.x + f.ux * f.hu * a + vx * f.hv * b, f.z + f.uz * f.hu * a + vz * f.hv * b]);
};
const separatedBy = (a, b, gap) => {
  for (const f of [a, b]) {
    for (const [nx, nz] of [[f.ux, f.uz], [-f.uz, f.ux]]) {
      const pa = corners(a).map(([x, z]) => x * nx + z * nz), pb = corners(b).map(([x, z]) => x * nx + z * nz);
      if (Math.min(...pa) - Math.max(...pb) >= gap - 1e-6 || Math.min(...pb) - Math.max(...pa) >= gap - 1e-6) return true;
    }
  }
  return false;
};

test('a yawed box flattens to a footprint along its long side', () => {
  // A stick: 50 cm along local Y, lying on its side, turned 30°.
  const f = boxFootprint(footprint(), sideMatrix(30, 2, .05, -1), -.02, -.25, -.02, .02, .25, .02);
  close(f.x, 2, 'centre x'); close(f.z, -1, 'centre z'); close(f.y, .05, 'centre y');
  close(f.hu, .25, 'long half extent'); close(f.hv, .02, 'short half extent'); close(f.hy, .02, 'half height');
  // Local +Y lies along world -X after the side roll, then yawed 30°.
  close(Math.abs(f.ux), Math.cos(30 * Math.PI / 180), 'long axis x'); close(Math.abs(f.uz), Math.sin(30 * Math.PI / 180), 'long axis z');
  close(Math.hypot(f.ux, f.uz), 1, 'unit axis');
  // An upright item: its footprint is its base, its height is hy.
  const u = boxFootprint(footprint(), yawMatrix(0), -.05, 0, -.03, .05, .2, .03);
  close(u.hu, .05, 'upright long'); close(u.hv, .03, 'upright short'); close(u.hy, .1, 'upright half height'); close(u.y, .1, 'upright centre');
  // A box turned off its own axes still fits inside its footprint.
  const t = boxFootprint(footprint(), yawMatrix(45), -.1, -.01, -.1, .1, .01, .1);
  assert.ok(reachOf(t) >= Math.hypot(.1, .1) - 1e-9, 'the footprint holds the box');
});

test('separated footprints need no push; heights that cannot touch never collide', () => {
  const out = { x: 9, z: 9 };
  assert.equal(pushApart(fp(0, 0, .1, .05), fp(.3, 0, .1, .05), GAP, out), false);
  assert.deepEqual(out, { x: 0, z: 0 });
  // A table item right above a floor item.
  assert.equal(pushApart(fp(0, 0, .1, .05, 0, .85, .03), fp(0, 0, .1, .05, 0, .05, .05), GAP, out), false);
  // Just inside the gap counts as touching.
  assert.equal(pushApart(fp(0, 0, .1, .05), fp(.21, 0, .1, .05), GAP, out), true);
});

test('overlapping footprints push the shallowest way, to exactly the gap', () => {
  const out = { x: 0, z: 0 };
  // Two parallel sticks side by side, 1 cm apart centre to centre: slide sideways, not lengthways.
  const a = fp(0, .01, .25, .02), b = fp(0, 0, .25, .02);
  assert.equal(pushApart(a, b, GAP, out), true);
  close(out.x, 0, 'no push along the sticks');
  close(out.z, .02 + .02 + GAP - .01, 'pushed across to the gap');
  a.x += out.x; a.z += out.z;
  assert.equal(pushApart(a, b, GAP, out), false, 'clear afterwards');
  assert.ok(separatedBy(a, b, GAP - 1e-6));
  // Pushes the first footprint away from the second.
  const c = fp(-.05, 0, .1, .1), d = fp(0, 0, .1, .1);
  pushApart(c, d, GAP, out);
  assert.ok(out.x < 0, 'away from the other');
});

test('pushApart agrees with an exact corner test on random rotated pairs', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = { x: 0, z: 0 };
  for (let i = 0; i < 400; i++) {
    const a = fp(random() * .6 - .3, random() * .6 - .3, .02 + random() * .25, .01 + random() * .08, random() * 360);
    const b = fp(random() * .6 - .3, random() * .6 - .3, .02 + random() * .25, .01 + random() * .08, random() * 360);
    const touching = pushApart(a, b, GAP, out);
    assert.equal(touching, !separatedBy(a, b, GAP), `pair ${i}`);
    if (!touching) continue;
    a.x += out.x; a.z += out.z;
    assert.ok(separatedBy(a, b, GAP - 1e-6), `pair ${i} is clear after the push`);
    assert.ok(Math.hypot(out.x, out.z) <= reachOf(a) + reachOf(b) + GAP + 1e-9, `pair ${i} push is bounded`);
  }
});

test('resolveOverlap clears a pile and leaves the footprint where it was', () => {
  const others = [fp(0, 0, .25, .02), fp(-.3, .12, .1, .05, 30), fp(.3, .3, .1, .1)];
  const a = fp(.02, .02, .25, .02, 10);
  const out = { x: 0, z: 0 };
  assert.equal(resolveOverlap(a, others, others.length, GAP, out), true);
  close(a.x, .02, 'x restored'); close(a.z, .02, 'z restored');
  const moved = Object.assign(footprint(), a, { x: a.x + out.x, z: a.z + out.z });
  assert.ok(isClear(moved, others, others.length, GAP * .5), 'clear of every other');
  // Hemmed in between two sticks: the pushes cancel out, and it says so (the caller searches instead).
  const hemmed = [fp(0, 0, .25, .02), fp(0, .07, .25, .02)];
  assert.equal(resolveOverlap(fp(0, .035, .25, .02), hemmed, 2, GAP, out), false);
  assert.equal(freeSpot(fp(0, .035, .25, .02), hemmed, 2, GAP, .04, 64, () => true, out), true, 'a spiral search finds room');
  // Only the first `count` footprints count.
  assert.equal(resolveOverlap(fp(0, 0, .1, .1), others, 0, GAP, out), true);
  assert.deepEqual(out, { x: 0, z: 0 });
});

test('the spiral starts at the spot and walks outwards without repeating', () => {
  const p = { x: 1, z: 1 };
  spiralPoint(0, .04, p);
  assert.deepEqual(p, { x: 0, z: 0 });
  const seen = [];
  let last = 0;
  for (let i = 1; i < 64; i++) {
    spiralPoint(i, .04, p);
    const r = Math.hypot(p.x, p.z);
    assert.ok(r >= last - 1e-12, 'never closer than the last point');
    last = r;
    for (const [x, z] of seen) assert.ok(Math.hypot(p.x - x, p.z - z) > .02, `point ${i} is new`);
    seen.push([p.x, p.z]);
  }
});

test('freeSpot finds the nearest clear, accepted spot, or reports none', () => {
  const out = { x: 0, z: 0 };
  const everywhere = () => true;
  // Already clear: stays.
  assert.equal(freeSpot(fp(1, 1, .1, .05), [fp(0, 0, .1, .05)], 1, GAP, .04, 32, everywhere, out), true);
  assert.deepEqual(out, { x: 0, z: 0 });
  // Seven sticks dropped on the same spot spread without overlapping.
  const placed = [];
  for (let i = 0; i < 7; i++) {
    const a = fp(0, 0, .25, .02, 20);
    assert.equal(freeSpot(a, placed, placed.length, GAP, .04, 64, everywhere, out), true, `stick ${i}`);
    a.x += out.x; a.z += out.z;
    placed.push(a);
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) assert.ok(separatedBy(placed[i], placed[j], GAP - 1e-6), `sticks ${i} and ${j}`);
  }
  // The spot test is honoured: nothing west of the start.
  const a = fp(0, 0, .1, .1);
  assert.equal(freeSpot(a, [fp(0, 0, .1, .1)], 1, GAP, .04, 64, (dx) => dx >= 0, out), true);
  assert.ok(out.x >= 0);
  close(a.x, 0, 'footprint left in place');
  // No acceptable spot at all.
  assert.equal(freeSpot(a, [fp(0, 0, .1, .1)], 1, GAP, .04, 64, () => false, out), false);
  assert.deepEqual(out, { x: 0, z: 0 });
});
