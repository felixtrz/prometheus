import { Group } from '@iwsdk/core';
import { dressingPlacements } from './camp-dressing.scene-asset.js';
import { boulder, broadleafFootprint, campTuft as tuft, FLOWERS, GRASS, litter, pebble, shadow, steppingStone, treeShadow } from './valley-kit.scene-asset.js';
import { BROADLEAVES, TRAILS, trailNearest } from './valley-layout.scene-asset.js';
import { batchStatic } from './static-batch.js';
import { noise, smooth, terrainHeight } from '../game/terrain.js';

// Camp region of the valley (adapted from design/source/environment.glts): broadleaf
// footprints (the trees themselves are ForestSystem's), tufts, boulders and trail stones
// around the clearing, batched to ~4 draws.
// The ground, far forest, horizon and the rest of the valley live in valley-*.scene-asset.ts.
const root = new Group();
root.name = 'Prometheus woodland (camp)';
export const woodlandTerrainHeight = terrainHeight;
const campDirt = (x: number, z: number) => {
  const n = noise(x, z), fine = noise(x * 4.5 + 9, z * 4.5 - 4);
  return Math.hypot(x / 4, (z + .1) / 3.1) + n * .12 + fine * .05;
};

// The camp broadleaves are drawn (and felled) by ForestSystem; the batch keeps their shadow and collider.
for (const t of BROADLEAVES) if (t.region === 'camp') broadleafFootprint(t.x, t.z, t.h);

/** Kept camp GLB pines (scene nodes woodland-pine-1..6 in main); their shadows are baked here. */
export const pineSourceBounds = {
  'pine-1': { minY: -.23508860170841217, height: 7.316917672753334 },
  'pine-2': { minY: -.23508860170841217, height: 7.376238122582436 },
} as const;
export const pinePlacements: { id: string; asset: 'pine-1' | 'pine-2'; x: number; z: number; height: number; yaw: number; groundY: number }[] = [];
for (const [x, z, h, yaw, variant] of [[-5.2, -1.6, 5, .2, 0], [5.4, -1.8, 5.2, -.2, 1], [-3.4, -5.6, 4.4, .7, 1], [3.6, -6, 4.8, -.6, 0], [-9.5, -6, 4.2, 1.4, 1], [9.8, -6.5, 4.4, 2.2, 0]]) {
  pinePlacements.push({ id: `woodland-pine-${pinePlacements.length + 1}`, asset: variant % 2 ? 'pine-2' : 'pine-1', x, z, height: h, yaw, groundY: terrainHeight(x, z) });
  treeShadow(x, z, h, h * .24);
}

// Tufts: one grass tone per clump, as in the first playable.
const tones = [[GRASS.olive], [GRASS.lime], [GRASS.deep]];
const dressingFootprints = [
  [dressingPlacements.bedroll.x, dressingPlacements.bedroll.z, .85],
  [dressingPlacements.stump.x - .2, dressingPlacements.stump.z + .2, .8],
];
const clearOfDressing = (x: number, z: number) => dressingFootprints.every(([dx, dz, r]) => Math.hypot(x - dx, z - dz) > r);
for (let i = 0; i < 30; i++) {
  const angle = i / 30 * Math.PI * 2, radius = 1 + noise(i, i * .3) * .14;
  const x = Math.cos(angle) * 4.3 * radius, z = .1 + Math.sin(angle) * 3.4 * radius;
  if (Math.abs(x) < 1.25 && (z > 2.6 || z < -2.6)) continue;
  if (!clearOfDressing(x, z)) continue;
  tuft(root, x, z, .75 + (i % 3) * .26, tones[i % 3], i % 5 === 0 ? FLOWERS.buttercup : i % 7 === 0 ? FLOWERS.daisy : null);
}
for (const [x, z, s, v, f] of [[-3.45, -2.7, .8, 1, 1], [-2.55, -3.45, .7, 2, 0], [-2.35, -3.7, .6, 0, 0], [3.15, -2.95, .75, 1, 2], [3.05, -3.7, .65, 2, 0], [1.95, -3.75, .6, 0, 1]]) {
  tuft(root, x, z, s, tones[v], f === 1 ? FLOWERS.buttercup : f === 2 ? FLOWERS.daisy : null);
}
for (let i = 0; i < 110; i++) {
  const angle = i * 2.399, radius = 4.8 + (i % 11) * .78 + noise(i * .7, i * .2) * .6;
  const x = Math.cos(angle) * radius * 1.3, z = -1 + Math.sin(angle) * radius * .85;
  if (z > 7 || z < -13 || campDirt(x, z) < 1.1) continue;
  if (trailNearest(x, z) < 1.25) continue;
  tuft(root, x, z, .65 + (i % 4) * .16, tones[i % 3], i % 6 === 0 ? FLOWERS.buttercup : i % 11 === 0 ? FLOWERS.daisy : i % 13 === 0 ? FLOWERS.violet : null);
}

for (const [x, z, h, yaw] of [[-3.8, 1.7, .4, .3], [3.9, 1.4, .46, 1.2], [-2.3, -4.4, .34, 2.4], [2, -4.9, .5, .8], [-5.2, -5.8, .7, 1.9], [5.3, -6.2, .62, .4], [-6.1, .6, .44, 2.8], [-2.6, 3.6, .55, 1.1], [2.9, 3.7, .48, 2], [-8.5, -9, .9, .5], [8.4, -10, 1, 2.2], [-10.8, 3.4, .8, 1.3], [10.4, 2.6, .7, .2]]) {
  boulder(root, x, z, h, yaw);
}
// Trail edge stones and worn stepping stones, from the clearing to the edge of camp.
const campTrail = TRAILS.main.filter((p) => p.z < -2.8 && p.z > -12.5);
campTrail.forEach((point, i) => {
  if (i % 2) return;
  const side = (i / 2) % 2 ? 1 : -1;
  const x = point.x + side * (1.02 + (i % 3) * .12), z = point.z + (i % 4) * .05;
  pebble(root, x, z, .05 + (i % 3) * .014, i, i % 2);
});
campTrail.forEach((point, i) => {
  if (i % 4 !== 1 || point.z > -3.6) return;
  steppingStone(root, point.x + ((i % 3) - 1) * .12, point.z, .17 + (i % 2) * .04, i * .7, i % 2);
});
// A few big, warm, half-buried stones at the clearing's edge (no small grey chips: they read
// as flint), and fallen-leaf litter across the clearing, kept clear of the fire ring.
for (const [x, z, s, yaw, v] of [[-3.3, .9, .2, .4, 0], [3.5, .3, .17, 1.9, 1], [-2.9, -3.9, .15, 2.6, 2], [1.4, 2.3, .14, 1.1, 1], [-4.1, -1.6, .18, .8, 2]] as const) {
  pebble(root, x, z, s, yaw, v, .5);
}
for (let i = 0; i < 26; i++) {
  const a = i * 1.37, r = 1.3 + (i % 7) * .45;
  const x = Math.cos(a) * r * 1.1, z = -1.2 + Math.sin(a) * r * .72;
  if (Math.hypot(x - .25, z + 1.9) < .8) continue;
  litter(root, x, z, a * .55, false, 1 + (i % 3) * .35);
}

// Baked grounding for the separately authored camp assets (their scene positions).
shadow(.25, -1.9, 1.0, .95, .24);
shadow(-2.15, -1.55, 1.38, .62, .26);
shadow(1.96, -.7, 1.12, .74, .24);
const { bedroll, stump } = dressingPlacements;
shadow(bedroll.x, bedroll.z, .8, .5, .3, 0, bedroll.yawDeg);
shadow(stump.x, stump.z, .42, .42, .3);
// The journal notice board (scene node 'journal-board').
shadow(1.75, -2.45, .8, .22, .26, .6, -25);

/** Camp dirt: the trampled clearing ellipse (the ground adds the valley trails). */
export function campDirtMask(x: number, z: number) {
  return smooth(1.08, .8, campDirt(x, z));
}
export const woodland = batchStatic(root);
export default woodland;
