import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const J = await loadTs('src/game/journey.ts');
const { terrainHeight, WORLD_BOUNDS, LANDMARKS } = await loadTs('src/game/terrain.ts');
const { phaseAt, DAY_LENGTH } = await loadTs('src/game/rules.ts');

const pose = () => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
const inBounds = (p) => p.x > WORLD_BOUNDS.minX && p.x < WORLD_BOUNDS.maxX && p.z > WORLD_BOUNDS.minZ && p.z < WORLD_BOUNDS.maxZ;
/** World position of a point on the door panel (group-local), for a panel pose (Euler XYZ). */
function panelPoint(p, lx, ly, lz) {
  // R = Rx · Ry · Rz applied to the local point (three.js 'XYZ').
  let x = lx * Math.cos(p.rz) - ly * Math.sin(p.rz), y = lx * Math.sin(p.rz) + ly * Math.cos(p.rz), z = lz;
  [x, z] = [x * Math.cos(p.ry) + z * Math.sin(p.ry), -x * Math.sin(p.ry) + z * Math.cos(p.ry)];
  [y, z] = [y * Math.cos(p.rx) - z * Math.sin(p.rx), y * Math.sin(p.rx) + z * Math.cos(p.rx)];
  return { x: p.x + x, y: p.y + y, z: p.z + z };
}

test('the keeper wakes in the seat, inside the cabin, facing the nose', () => {
  const [x, y, z] = J.SPAWN.position;
  assert.ok(J.insideCabin(x, z));
  assert.equal(y, J.WRECK.origin.y + J.WRECK.deckY, 'standing on the deck');
  assert.ok(J.doorDistance(x, z) > J.DOOR.near, 'the door is a walk away');
  assert.deepEqual(J.SPAWN.rotationDeg, [0, -90, 0]);
  // The seat is behind the door (the door is forward, toward the nose).
  assert.ok(J.WRECK.seat.x < J.WRECK.door.x0);
});

test('outside the door is outside the cabin; the doorway is where the blows land', () => {
  const out = J.wreckWorld((J.WRECK.door.x0 + J.WRECK.door.x1) / 2, J.WRECK.door.z - 1.6);
  assert.equal(J.insideCabin(out.x, out.z), false);
  const d = J.WRECK.door;
  assert.equal(J.doorGap((d.x0 + d.x1) / 2, 1.2, d.z), 0, 'on the panel');
  assert.ok(J.doorGap(J.WRECK.seat.x, 1.2, J.WRECK.seat.z) > J.DOOR.rearm, 'far from the seat');
});

test('the ajar panel hangs on its forward hinge; the torn panel lies from the sill to the ground', () => {
  const ajar = J.panelAjar(J.DOOR.ajarDeg, pose());
  const hinge = panelPoint(ajar, J.DOOR.panel.width / 2, 0, 0);
  assert.ok(Math.abs(hinge.x - J.WRECK.door.x1) < 1e-9 && Math.abs(hinge.z - J.WRECK.door.z) < 1e-9, 'hinge stays on the wall');
  const free = panelPoint(ajar, -J.DOOR.panel.width / 2, 0, 0);
  assert.ok(free.z < J.WRECK.door.z - .2, 'the free edge stands outward (-Z)');
  const fallen = J.panelFallen(pose());
  const top = panelPoint(fallen, 0, J.DOOR.panel.height, 0);
  assert.ok(top.z < J.WRECK.door.z - 1.2, 'fallen outward');
  assert.ok(Math.abs(top.y - J.groundLocal(top.x, top.z)) < .2, `its far edge rests on the ground (${top.y.toFixed(2)} vs ${J.groundLocal(top.x, top.z).toFixed(2)})`);
  const start = J.panelTear(0, J.DOOR.ajarDeg, pose()), end = J.panelTear(J.TEAR_SECONDS, J.DOOR.ajarDeg, pose());
  assert.ok(Math.abs(start.ry - ajar.ry) < 1e-9);
  for (const key of ['x', 'y', 'z', 'rx', 'ry']) assert.ok(Math.abs(end[key] - fallen[key]) < 1e-9, `tear ends fallen (${key})`);
});

test('the watching Hollow stand past the walls, outside the fire, and back away from the keeper', () => {
  const out = { x: 0, z: 0 };
  for (const [i, post] of J.WOLF_POSTS.entries()) {
    assert.equal(inBounds(post), false, 'unreachable: beyond the valley walls');
    assert.ok(Math.hypot(post.x - J.WARD.x, post.z - J.WARD.z) >= J.WARD.radius, 'outside the ward');
    assert.ok(terrainHeight(post.x, post.z) > 1.5, 'up on the hills');
    for (let t = 0; t < 20; t += 1.3) {
      J.stagedGoal(post, i, t, post.x, post.z, out);
      assert.ok(Math.hypot(out.x - J.WARD.x, out.z - J.WARD.z) >= J.WARD.radius - 1e-6, 'never inside the ward');
      assert.ok(Math.hypot(out.x - post.x, out.z - post.z) >= J.STAGED.keepFromPlayer - 1e-6, 'backs off from the keeper');
    }
  }
});

test('the dawn: the wreck starts in the grey before sunrise, and the sun rises before the day wraps', () => {
  assert.equal(phaseAt(J.WRECK_CLOCK.start), 'dawn');
  assert.equal(phaseAt(J.WRECK_CLOCK.sunrise), 'dawn');
  assert.ok(J.WRECK_CLOCK.sunrise > J.WRECK_CLOCK.start && J.WRECK_CLOCK.sunrise < DAY_LENGTH);
});

test('the route: waystation, markers and mushrooms lie in the valley, clear of the crash', () => {
  assert.ok(inBounds(J.WAYSTATION.centre));
  assert.ok(Math.hypot(J.WAYSTATION.table.x - J.WAYSTATION.centre.x, J.WAYSTATION.table.z - J.WAYSTATION.centre.z) < 1.5);
  for (const marker of J.MARKERS) assert.ok(inBounds(marker), `marker at ${marker.x}, ${marker.z}`);
  for (const patch of J.FOREST_MUSHROOMS) {
    assert.ok(inBounds(patch));
    assert.equal(J.journeyBlocksTree(patch.x, patch.z), false, 'a mushroom grows in the forest, not the clearing');
  }
  assert.ok(J.journeyBlocksTree(J.WRECK.origin.x, J.WRECK.origin.z), 'no tree through the fuselage');
  assert.ok(J.journeyBlocksTree(J.WAYSTATION.centre.x, J.WAYSTATION.centre.z));
  assert.equal(J.journeyBlocksTree(LANDMARKS.grove.x, LANDMARKS.grove.z), false, 'the forest stays a forest');
  assert.ok(J.atCamp(LANDMARKS.campfire.x, LANDMARKS.campfire.z));
  assert.equal(J.atCamp(J.WAYSTATION.centre.x, J.WAYSTATION.centre.z), false);
  const trail = J.JOURNEY_TRAIL;
  assert.ok(Math.hypot(trail.at(-1).x - LANDMARKS.grove.x, trail.at(-1).z - LANDMARKS.grove.z) < 3, 'the trail ends in the grove');
});

test('a Continue replays from the last completed objective', () => {
  const none = { escape: false, waystation: false, forest: false };
  assert.equal(J.resumeStep(none), 'wake');
  assert.equal(J.resumeStep({ ...none, escape: true }), 'dawn');
  assert.equal(J.resumeStep({ escape: true, waystation: true, forest: false }), 'forest');
  assert.equal(J.resumeStep({ escape: true, waystation: true, forest: true }), 'done');
  const seat = J.resumePose('wake');
  assert.equal(seat.x, J.SPAWN.position[0]);
  const outside = J.resumePose('dawn');
  assert.equal(J.insideCabin(outside.x, outside.z), false);
  assert.equal(J.resumePose('done'), null, 'camp and later keep the saved respawn');
  assert.ok(J.forestDone(1, 1) && !J.forestDone(1, 0) && !J.forestDone(0, 2));
});

test("the shade's marks in the wreck stand in the aisle, then outside the doorway", () => {
  const out = { x: 0, z: 0 };
  for (const step of ['wake', 'door', 'armed']) {
    J.shadeMark(step, out);
    assert.ok(J.insideCabin(out.x, out.z), `${step}: inside`);
    assert.ok(Math.abs(J.toWreckZ(out.z) + .17) < .4, `${step}: in the aisle`);
  }
  J.shadeMark('open', out);
  assert.equal(J.insideCabin(out.x, out.z), false);
  assert.equal(J.shadeMark('dawn', out), null);
});

test('the forest leg: choppable pines stand 1.7-3.2 m beside the trail, never on it', async () => {
  const L = await loadTs('src/scene-assets/valley-layout.scene-asset.ts');
  assert.ok(L.JOURNEY_PINES.length >= 6, `${L.JOURNEY_PINES.length} journey pines`);
  for (const p of L.JOURNEY_PINES) {
    L.trailNearest(p.x, p.z);
    assert.ok(L.trailHit.distance >= 1.7 && L.trailHit.distance <= 3.2, `${p.id} is ${L.trailHit.distance.toFixed(2)} m off the trail`);
    assert.ok(L.GLB_PINES.includes(p), `${p.id} has a collider and a shadow (GLB_PINES)`);
    for (const m of [...J.FOREST_MUSHROOMS, ...L.GROVE.mushrooms]) assert.ok(Math.hypot(p.x - m.x, p.z - m.z) >= 1.6, `${p.id} crowds a mushroom`);
    for (const r of L.GROVE.resinPines) assert.ok(Math.hypot(p.x - r.x, p.z - r.z) >= 1.9, `${p.id} crowds a resin pine`);
  }
});
