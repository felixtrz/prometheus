import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const { yawFromXAxis, insideFootprint } = await loadTs('src/game/surface-math.ts');

/** A prop rotated by θ about +Y (three's rotation.y) maps local +X to (cosθ, 0, −sinθ). */
const xAxis = (deg) => [Math.cos(deg * Math.PI / 180), -Math.sin(deg * Math.PI / 180)];

test('yaw read from a rotated prop matches its rotation (the C1 sign bug)', () => {
  for (const deg of [0, 18, 63, 84, -15, 135, -120]) {
    const [dx, dz] = xAxis(deg);
    assert.ok(Math.abs(((yawFromXAxis(dx, dz) - deg + 540) % 360) - 180) < 1e-9, `yaw ${deg}`);
  }
});

test('a point along a rotated prop\'s long axis is on it; the mirrored point is not', () => {
  // Angles where the mirrored direction (2θ away) is well off the long axis; near 90° the
  // mirror of a symmetric prop is its own far end.
  for (const deg of [30, 63, -15, -40]) {
    const [dx, dz] = xAxis(deg);
    const surface = { x: 2, z: -3, hx: 1, hz: .2, yawDeg: yawFromXAxis(dx, dz), y: 1 };
    assert.ok(insideFootprint(surface, 2 + dx * .9, -3 + dz * .9), `on the long axis at ${deg}°`);
    // The 2θ-mirrored direction (what the old sign bug tested) lies off a narrow prop.
    const [mx, mz] = xAxis(-deg);
    assert.ok(!insideFootprint(surface, 2 + mx * .9, -3 + mz * .9), `mirrored point off at ${deg}°`);
  }
});
