/**
 * Static valley dressing, split into region batches so frustum culling helps:
 * grove, meadow (with the brook, banks and log bridge), outpost, Spire, trail,
 * south, and the horizon (mountains, clouds, distant treeline). Every region is
 * authored in world coordinates and placed at the scene origin.
 */
import {
  BufferAttribute, BufferGeometry, BoxGeometry, CircleGeometry, Color, CylinderGeometry, DataTexture, DodecahedronGeometry, DoubleSide, ExtrudeGeometry, Group,
  IcosahedronGeometry, Mesh, MeshStandardMaterial, Path, PlaneGeometry, RGBAFormat, Shape, ShapeGeometry, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector3,
} from '@iwsdk/core';
import { batchStatic } from './static-batch.js';
import { smoothSampling } from './procedural-textures.js';
import {
  boulder, broadleaf, colliders, fern, flameShape, FLOWERS, GRASS, ground, litter, mats, mountain, mossMound, paint, pebble, put, root as rootBranch,
  shadow, shrub, span, steppingStone, treeShadow, tuft,
} from './valley-kit.scene-asset.js';
import {
  BROADLEAVES, BROOK, GLB_PINES, GROVE, MEADOW, OUTPOST, rng, SPIRE, TRAILS, trailNearest, VALLEY_PINES,
} from './valley-layout.scene-asset.js';
import { brookNearest, brookPath, brookWaterY, noise, smooth, WORLD_BOUNDS } from '../game/terrain.js';

type V3 = [number, number, number];
const regions = {
  grove: new Group(), meadow: new Group(), outpost: new Group(), spire: new Group(),
  trail: new Group(), south: new Group(), horizon: new Group(),
};
type Region = keyof typeof regions;
function regionOf(x: number, z: number): Region {
  if (z < -45) return 'spire';
  if (z > 2.5) return 'south';
  if (x > 8.5 && z > -36) return 'meadow';
  if (x < -6.5 && z > -27) return 'grove';
  if (z < -24) return 'outpost';
  return 'trail';
}
const R = (x: number, z: number) => regions[regionOf(x, z)];
const inCamp = (x: number, z: number, r = 12.5) => Math.hypot(x, z + 1) < r;
const box = (w: number, h: number, d: number, color: number, v = .05) => paint(new BoxGeometry(w, h, d), color, v);
const cyl = (top: number, bottom: number, h: number, seg: number, color: number, v = .05, open = false) => paint(new CylinderGeometry(top, bottom, h, seg, 1, open), color, v);
/** A local frame on the terrain at (x, z) with yaw; children are authored in local metres. */
function frame(x: number, z: number, yawDeg: number, y = ground(x, z)): Group {
  const g = new Group();
  g.position.set(x, y, z);
  g.rotation.y = yawDeg * Math.PI / 180;
  R(x, z).add(g);
  return g;
}
const local = (f: Group, lx: number, lz: number) => {
  const a = f.rotation.y;
  return { x: f.position.x + lx * Math.cos(a) + lz * Math.sin(a), z: f.position.z - lx * Math.sin(a) + lz * Math.cos(a) };
};

// ================================================================== shared keep-outs
const nodeSpots: [number, number, number][] = [
  ...GROVE.resinPines.map((p): [number, number, number] => [p.x, p.z, 1.1]),
  ...GROVE.deadwood.map((p): [number, number, number] => [p.x, p.z, 1.3]),
  ...GROVE.mushrooms.map((p): [number, number, number] => [p.x, p.z, .9]),
  [GROVE.stump.x, GROVE.stump.z, 1], [GROVE.brazier.x, GROVE.brazier.z, 1.3],
  ...MEADOW.berries.map((p): [number, number, number] => [p.x, p.z, 1.2]),
  ...MEADOW.herbs.map((p): [number, number, number] => [p.x, p.z, .8]),
  ...BROOK.reeds.map((p): [number, number, number] => [p.x, p.z, 1]),
  ...BROOK.flint.map((p): [number, number, number] => [p.x, p.z, .9]),
  [BROOK.pageRock.x, BROOK.pageRock.z, 1.3], [BROOK.bridge.x, BROOK.bridge.z, 3.4],
  [OUTPOST.tent.x, OUTPOST.tent.z, 2.4], [OUTPOST.table.x, OUTPOST.table.z, 1.2], [OUTPOST.brazier.x, OUTPOST.brazier.z, 1.3],
  [OUTPOST.crate.x, OUTPOST.crate.z, 1.4], [OUTPOST.lookout.x, OUTPOST.lookout.z, 1.8], [OUTPOST.lookoutBox.x, OUTPOST.lookoutBox.z, .7],
  [OUTPOST.banner.x, OUTPOST.banner.z, .9], [SPIRE.beacon.x, SPIRE.beacon.z, 1.8], [SPIRE.ledge.x, SPIRE.ledge.z, 1], [SPIRE.stone.x, SPIRE.stone.z, 3.6],
];
const clearOfNodes = (x: number, z: number, pad = 0) => nodeSpots.every(([px, pz, r]) => Math.hypot(x - px, z - pz) > r + pad);

// ====================================================================== the grove
{
  const g = regions.grove;
  // Mossy roots flaring from the old pines, plus needle litter under them.
  for (const pine of GLB_PINES.filter((p) => p.id.startsWith('grove'))) {
    const y = ground(pine.x, pine.z);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + pine.x, r = .9 + (i % 2) * .5;
      const from = new Vector3(pine.x + Math.cos(a) * .14, y + .22, pine.z + Math.sin(a) * .14);
      const tx = pine.x + Math.cos(a) * r, tz = pine.z + Math.sin(a) * r;
      rootBranch(g, from, new Vector3(tx, ground(tx, tz) - .03, tz), .09 * pine.scale, .025, 0x5f4a38);
    }
    mossMound(g, pine.x + .5, pine.z - .3, .5, pine.x);
    for (let i = 0; i < 5; i++) litter(g, pine.x + Math.cos(i * 2.4) * (.8 + i * .25), pine.z + Math.sin(i * 2.4) * (.8 + i * .25), i, true, .9);
  }
  // Page 3's old stump: the sawn trunk is the 'grove-stump' ItemSurface prop; its flared base,
  // roots and moss are baked here.
  const s = GROVE.stump, sy = ground(s.x, s.z);
  const stump = frame(s.x, s.z, 20, sy);
  put(stump, cyl(s.radius * 1.08, s.radius * 1.3, .12, 12, 0x5f3f2a, .05), mats.bark, [0, .06, 0]);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.6 + .4;
    rootBranch(stump, new Vector3(Math.cos(a) * .25, .12, Math.sin(a) * .25), new Vector3(Math.cos(a) * .62, -.04, Math.sin(a) * .62), .07, .02, 0x5f3f2a);
  }
  put(stump, paint(new IcosahedronGeometry(1, 1), 0x5d8a34, .12), mats.solid, [.3, .1, -.22], [0, 1, 0], [.14, .06, .1]);
  shadow(s.x, s.z, .6, .55, .32);
  // Ferns, moss and needle litter on the grove floor.
  const random = rng(31);
  for (let i = 0; i < 260 && g.children.length < 400; i++) {
    const a = random() * Math.PI * 2, d = Math.sqrt(random()) * 11.5;
    const x = GROVE.centre.x + Math.cos(a) * d * 1.1, z = GROVE.centre.z + Math.sin(a) * d * .9;
    if (!clearOfNodes(x, z, .2) || trailNearest(x, z) < 1.1 || x < WORLD_BOUNDS.minX + .5) continue;
    const roll = random();
    if (roll < .16) fern(g, x, z, .8 + random() * .5, i);
    else if (roll < .24) mossMound(g, x, z, .3 + random() * .4, i);
    else if (roll < .45) litter(g, x, z, i, true, .7 + random() * .4);
    else if (roll < .72) tuft(g, x, z, .6 + random() * .3, [GRASS.forest, GRASS.deep]);
  }
  for (const [x, z, h, yaw] of [[-21.8, -18.6, .9, .4], [-12.6, -16.8, .7, 2.1], [-24.8, -15.2, 1.1, 1.3], [-15.4, -4.2, .6, .9]]) boulder(g, x, z, h, yaw);
  // Ferns and moss tucked behind each mushroom patch.
  GROVE.mushrooms.forEach((m, i) => {
    const away = Math.atan2(m.z - GROVE.centre.z, m.x - GROVE.centre.x);
    fern(g, m.x + Math.cos(away) * .75, m.z + Math.sin(away) * .75, .75, i * 3 + 1);
    fern(g, m.x + Math.cos(away + 1.2) * .7, m.z + Math.sin(away + 1.2) * .7, .6, i * 3 + 2);
  });
}

// ============================================================= meadow and brook
{
  const g = regions.meadow;
  // Wildflower meadow: dense tufts, most of them flowering.
  const random = rng(41);
  const blooms = [FLOWERS.buttercup, FLOWERS.daisy, FLOWERS.pink, FLOWERS.violet, FLOWERS.buttercup, FLOWERS.orange];
  for (let i = 0; i < 520; i++) {
    const a = random() * Math.PI * 2, d = Math.sqrt(random());
    const x = MEADOW.centre.x - 1.2 + Math.cos(a) * d * 12, z = MEADOW.centre.z - .6 + Math.sin(a) * d * 10;
    if (brookNearest(x, z) < 2.7 || trailNearest(x, z) < 1.05 || !clearOfNodes(x, z)) continue;
    if (random() > .3) continue;
    tuft(g, x, z, .7 + random() * .45, [GRASS.meadow, GRASS.lime, GRASS.olive], random() < .62 ? blooms[i % blooms.length] : null);
  }
  for (const t of BROADLEAVES) if (t.region === 'meadow') broadleaf(g, t.x, t.z, t.h, t.yaw, t.variant);
  for (const [x, z, r, yaw] of [[7.8, -9.6, .5, .3], [17.8, -24.6, .55, 1.4], [24.6, -15.8, .45, 2.2], [9.4, -24.8, .5, .8]]) shrub(g, x, z, r, yaw);
  for (const [x, z, h, yaw] of [[12, 4.5, 1.2, .5], [9, -28, 1.1, 1.6], [14, -33.5, 1.3, .2], [26.4, -27.5, 1, 2.5], [29.5, -8.5, .9, 1.1]]) boulder(g, x, z, h, yaw);
  // Page 4's flat rock on the west bank is the 'brook-page-rock' ItemSurface prop.
  shadow(BROOK.pageRock.x, BROOK.pageRock.z, .55 * 1.3, .55 * 1.1, .3, BROOK.pageRock.top * .4);

  // Water: a ribbon following the brook, level across, falling gently south.
  const pos: number[] = [], col: number[] = [], nor: number[] = [], idx: number[] = [];
  const across = [-1.95, -1.15, -.45, .45, 1.15, 1.95];
  const deep = new Color(0x1f5a74), shallow = new Color(0x4f98aa), foam = new Color(0xdfeef0), cc = new Color();
  const path = brookPath.filter((p) => p.z < 36 && p.z > -88);
  path.forEach((p, i) => {
    const q = path[Math.min(path.length - 1, i + 1)], o = path[Math.max(0, i - 1)];
    let tx = q.x - o.x, tz = q.z - o.z;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const y = brookWaterY(p.z), steep = Math.abs(brookWaterY(q.z) - brookWaterY(o.z)) / (tl || 1);
    across.forEach((o2, k) => {
      const w = Math.abs(o2) / 1.95;
      pos.push(p.x - tz * o2, y, p.z + tx * o2);
      const ripple = .5 + .5 * Math.sin(p.z * 1.7 + o2 * 2.3 + noise(p.x, p.z) * 2);
      cc.copy(deep).lerp(shallow, w * .8 + ripple * .15).lerp(foam, Math.min(1, steep * 3.2) * (.4 + ripple * .5));
      // Pale wet edge where the water meets the gravel.
      if (w > .99) cc.lerp(foam, .5 + ripple * .15);
      col.push(cc.r, cc.g, cc.b);
      const wobble = .06 * Math.sin(p.z * 2.3 + k);
      nor.push(wobble, 1, .06 * Math.cos(p.z * 1.9 - k));
    });
    if (i < path.length - 1) for (let k = 0; k < across.length - 1; k++) {
      const a = i * across.length + k, b = a + across.length;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  });
  const water = new BufferGeometry();
  water.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  water.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  water.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  water.setIndex(idx);
  water.computeBoundingSphere();
  // Winding faces up either way: check one triangle and flip if needed.
  {
    const p0 = new Vector3().fromArray(pos, idx[0] * 3), p1 = new Vector3().fromArray(pos, idx[1] * 3), p2 = new Vector3().fromArray(pos, idx[2] * 3);
    if (p1.sub(p0).cross(p2.sub(p0)).y < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    water.setIndex(idx);
  }
  put(g, water, mats.water, [0, 0, 0]);
  // Banks: gravel, stones in the current, reed tufts (decor only).
  brookPath.forEach((p, i) => {
    if (p.z > 15 || p.z < -66 || i % 3) return;
    for (const side of [-1, 1]) {
      const q = brookPath[i + 1] ?? p, tl = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      const nx = -(q.z - p.z) / tl * side, nz = (q.x - p.x) / tl * side;
      const off = 1.55 + ((i * 7 + side * 3) % 5) * .16;
      const x = p.x + nx * off, z = p.z + nz * off;
      if (Math.hypot(x - BROOK.bridge.x, z - BROOK.bridge.z) < 1.2) continue;
      pebble(R(x, z), x, z, .06 + ((i + side) % 4) * .025, i, (i + side + 3) % 3, .5);
      if (i % 6 === 0) pebble(R(x, z), x + nx * .35, z + nz * .3, .1 + (i % 3) * .03, i * 2, 2, .5);
      if ((i + (side > 0 ? 3 : 0)) % 11 === 0 && clearOfNodes(x, z)) {
        const rx = p.x + nx * 2.3, rz = p.z + nz * 2.3;
        tuft(R(rx, rz), rx, rz, 1.1, [GRASS.deep, GRASS.olive]);
      }
    }
    if (i % 9 === 4 && Math.abs(p.z - BROOK.bridge.z) > 3) boulder(R(p.x, p.z), p.x + ((i % 3) - 1) * .5, p.z, .35 + (i % 4) * .08, i, 1, 0);
  });
  // Log bridge where the east trail crosses.
  {
    const b = BROOK.bridge, half = b.length / 2;
    const yA = ground(b.x - half, b.z), yB = ground(b.x + half, b.z);
    const deckY = (t: number) => yA + (yB - yA) * t + .14 + .12 * Math.sin(Math.PI * t);
    for (const dz of [-.46, .46]) {
      for (let k = 0; k < 4; k++) {
        const t0 = k / 4, t1 = (k + 1) / 4;
        rootBranch(g, new Vector3(b.x - half + t0 * b.length - .05, deckY(t0) - .14, b.z + dz), new Vector3(b.x - half + t1 * b.length + .05, deckY(t1) - .14, b.z + dz), .13, .12, 0x6b4830);
      }
    }
    for (let k = 0; k <= 26; k++) {
      const t = k / 26, x = b.x - half + t * b.length;
      put(g, cyl(.085, .085, 1.22, 7, k % 3 ? 0x8a6040 : 0x7a5236, .06), mats.bark, [x, deckY(t) - .03, b.z + ((k % 2) - .5) * .03], [Math.PI / 2, 0, (k % 3 - 1) * .03], [1, 1, .55]);
    }
    for (const t of [.06, .5, .94]) {
      const x = b.x - half + t * b.length;
      put(g, cyl(.05, .06, 1.05, 6, 0x6b4830), mats.bark, [x, deckY(t) + .38, b.z - .62]);
    }
    for (let k = 0; k < 2; k++) {
      const t0 = k * .5 - .02, t1 = k * .5 + .52;
      rootBranch(g, new Vector3(b.x - half + t0 * b.length, deckY(Math.max(0, t0)) + .86, b.z - .62), new Vector3(b.x - half + t1 * b.length, deckY(Math.min(1, t1)) + .86, b.z - .62), .045, .04, 0x7a5236);
    }
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) boulder(g, b.x + side * (half + .1), b.z + (k - 1) * .6, .28 + k * .06, k + side, 1, .2);
    shadow(b.x, b.z, half + .3, .8, .3, 0, 0);
  }
}
/** Bridge deck top (world), for the invisible walk surface in the ground asset. */
export function bridgeDeckY(t: number) {
  const b = BROOK.bridge, half = b.length / 2;
  const yA = ground(b.x - half, b.z), yB = ground(b.x + half, b.z);
  return yA + (yB - yA) * t + .14 + .12 * Math.sin(Math.PI * t) + .02;
}

// ====================================================================== outpost
{
  // Collapsed A-frame tent (3 m): the back pole snapped, canvas sagging to the ground.
  const t = OUTPOST.tent, f = frame(t.x, t.z, t.yawDeg);
  const L = 3.1, HW = 1.35, RIDGE = 1.8;
  const canvas = (side: number) => {
    const geo = new PlaneGeometry(1, 1, 6, 9);
    const p = geo.getAttribute('position');
    const colors = new Float32Array(p.count * 3), cc = new Color(), dirtC = new Color(0x7a6a4a);
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) + .5, v = p.getY(i) + .5; // u: ridge → ground, v: back → front
      const ridgeY = .28 + (RIDGE - .28) * v * v * (3 - 2 * v);
      const sag = (.24 + .22 * (1 - v)) * Math.sin(Math.PI * u) * (side < 0 ? 1.5 : 1) + .035 * Math.sin(v * 17 + u * 5);
      const y = Math.max(.015, ridgeY * (1 - u) + .02 * u - sag * (1 - u * .4));
      p.setXYZ(i, side * (u * HW + .05 * Math.sin(v * 9) * u), y, -L / 2 + v * L);
      cc.setHex(0xd2bf95).lerp(dirtC, Math.max(0, .75 - y * 1.3) * .55 + .08 * Math.sin(u * 7 + v * 11));
      if (Math.sin(u * 9 + v * 23) > .96) cc.lerp(dirtC, .5);
      cc.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    put(f, geo, mats.foliage, [0, 0, 0]);
  };
  canvas(-1); canvas(1);
  // Groundsheet and the dark mouth of the tent.
  put(f, paint(new PlaneGeometry(HW * 1.9, L), 0x4a4a36, .05), mats.solid, [0, .012, 0], [-Math.PI / 2, 0, 0]);
  put(f, paint(new PlaneGeometry(1.2, 1.05), 0x1e1c16, 0), mats.foliage, [0, .52, L / 2 - .35]);
  // A loose front flap folded back, the standing front pole, the snapped back pole.
  const flap = new PlaneGeometry(.8, 1.3, 2, 3);
  const fp = flap.getAttribute('position');
  for (let i = 0; i < fp.count; i++) fp.setZ(i, .12 * Math.sin(fp.getY(i) * 2.5));
  flap.computeVertexNormals();
  put(f, paint(flap, 0xc2ae84, .06), mats.foliage, [.62, .7, L / 2 + .06], [0, -.7, -.35]);
  put(f, cyl(.035, .04, RIDGE + .06, 6, 0x7a5236), mats.timber, [0, (RIDGE + .06) / 2, L / 2]);
  rootBranch(f, new Vector3(0, 0, -L / 2), new Vector3(.12, .6, -L / 2 + .1), .035, .03, 0x7a5236, mats.timber);
  put(f, cyl(.03, .03, .05, 6, 0xc9a577), mats.timber, [.12, .61, -L / 2 + .1]);
  for (const [a, b] of [[[0, RIDGE, L / 2], [1.1, 0, L / 2 + 1]], [[0, RIDGE, L / 2], [-1.1, 0, L / 2 + 1]], [[0, .35, -L / 2], [.9, 0, -L / 2 - .8]]] as [V3, V3][]) {
    span(f, cyl(.006, .006, 1, 3, 0xb8a27a, 0, true), mats.solid, new Vector3(...a), new Vector3(...b));
    put(f, cyl(.012, .003, .22, 4, 0x8a6040, 0), mats.solid, [b[0], .06, b[2]], [.3, 0, 0]);
  }
  // Spilled kit: an abandoned pack slumped by the tent mouth.
  put(f, box(.34, .42, .2, 0x6b5a3a), mats.solid, [-.95, .2, L / 2 + .35], [.1, .5, .15]);
  put(f, box(.3, .06, .22, 0x5a4a30), mats.solid, [-.95, .43, L / 2 + .35], [.1, .5, .15]);
  shadow(t.x, t.z, 1.9, 1.6, .3, .45, t.yawDeg);
  colliders.push({ type: 'box', x: t.x, z: t.z, hx: HW + .05, hz: L / 2, yawDeg: t.yawDeg });

  // Camp table ('outpost-table' ItemSurface prop) with an unlit lantern, a cup and a plate
  // baked on its top (page 5 goes on the free left half).
  const tb = OUTPOST.table, tf = frame(tb.x, tb.z, tb.yawDeg);
  // The Prometheus lantern: brass body, soot-black cracked glass, the expedition flame on its base.
  const lantern = new Group();
  lantern.position.set(.45, tb.top, -.14);
  put(lantern, cyl(.075, .09, .045, 12, 0xa0763a, .05), mats.iron, [0, .022, 0]);
  put(lantern, cyl(.062, .062, .16, 12, 0x1e1a16, .02), mats.solid, [0, .125, 0]);
  for (const [y, a, len] of [[.15, .5, .07], [.11, -.7, .05], [.085, .3, .04]] as const) {
    put(lantern, box(.003, len, .002, 0xcfc6b0, 0), mats.solid, [Math.cos(.9) * .062, y, Math.sin(.9) * .062], [0, -.9 + Math.PI / 2, a]);
  }
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + .6; put(lantern, cyl(.006, .006, .16, 4, 0x8a6430, 0), mats.iron, [Math.cos(a) * .066, .125, Math.sin(a) * .066]); }
  put(lantern, cyl(.085, .065, .05, 12, 0xa0763a, .05), mats.iron, [0, .23, 0]);
  put(lantern, paint(new TorusGeometry(.08, .007, 4, 12, Math.PI), 0x8a6430, 0), mats.iron, [0, .27, 0]);
  put(lantern, paint(new ShapeGeometry(flameShape(.05)), 0xc8502a, 0), mats.solid, [0, .005, .0905]);
  tf.add(lantern);
  put(tf, cyl(.035, .03, .08, 9, 0x8a8e90, 0), mats.iron, [.22, tb.top + .04, .2]);
  put(tf, cyl(.045, .045, .012, 12, 0x8a6a3a, 0), mats.iron, [.32, tb.top + .006, .02]);
  shadow(tb.x, tb.z, .8, .5, .3, .3, tb.yawDeg);
  // Folding stool knocked over beside the table.
  put(tf, box(.36, .03, .3, 0x8a6040), mats.timber, [-.25, .16, .72], [1.2, .3, 0]);
  for (const dx of [-.14, .14]) put(tf, box(.03, .42, .03, 0x6b4830), mats.timber, [-.25 + dx, .2, .6], [.5, .3, 0]);

  // Open salvage crate ('outpost-crate' ItemSurface prop, straw near the brim); its lid
  // leans on the front face here.
  const cr = OUTPOST.crate, cf = frame(cr.x, cr.z, cr.yawDeg);
  const W = .9, D = .52;
  // Lid leaning on the front face, with battens and a painted flame mark.
  const lid = new Group();
  lid.position.set(0, 0, D / 2 + .2);
  lid.rotation.x = -.35;
  for (let k = 0; k < 3; k++) put(lid, box(W, .17, .022, k % 2 ? 0xa37a4e : 0x94704a), mats.timber, [0, .1 + k * .175, 0]);
  for (const x of [-.3, .3]) put(lid, box(.07, .5, .02, 0x7a5236), mats.timber, [x, .28, -.02]);
  const flameMark = flameShape(.12);
  put(lid, paint(new ShapeGeometry(flameMark), 0xc8502a, 0), mats.solid, [0, .2, .013], [0, 0, 0], 1);
  cf.add(lid);
  shadow(cr.x, cr.z, .7, .5, .34, .3, cr.yawDeg);

  // Lookout tower (~2.5 m platform, railing, bracing, a ladder with broken rungs).
  const lk = OUTPOST.lookout, lf = frame(lk.x, lk.z, lk.yawDeg);
  const baseHalf = .9, topHalf = .7, deck = 2.5, rail = 3.35;
  const post = (sx: number, sz: number, y: number) => new Vector3(sx * (baseHalf + (topHalf - baseHalf) * y / rail), y, sz * (baseHalf + (topHalf - baseHalf) * y / rail));
  // Posts reach down to the ground under each foot (the tower stands on the start of the climb).
  const footY = (sx: number, sz: number) => { const w = local(lf, sx * baseHalf, sz * baseHalf); return ground(w.x, w.z) - lf.position.y - .12; };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) rootBranch(lf, post(sx, sz, footY(sx, sz)), post(sx, sz, rail), .085, .07, 0x7a5236, mats.timber);
  for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]] as [[number, number], [number, number]][]) {
    rootBranch(lf, post(a[0], a[1], .35), post(b[0], b[1], 2.2), .035, .035, 0x6b4830, mats.timber);
    rootBranch(lf, post(b[0], b[1], .35), post(a[0], a[1], 2.2), .035, .035, 0x6b4830, mats.timber);
    rootBranch(lf, post(a[0], a[1], deck - .05), post(b[0], b[1], deck - .05), .05, .05, 0x6b4830, mats.timber);
    if (!(a[1] === 1 && b[1] === 1)) {
      rootBranch(lf, post(a[0], a[1], rail - .05), post(b[0], b[1], rail - .05), .04, .04, 0x7a5236, mats.timber);
      rootBranch(lf, post(a[0], a[1], deck + .45), post(b[0], b[1], deck + .45), .03, .03, 0x7a5236, mats.timber);
    }
  }
  const deckHalf = topHalf + (baseHalf - topHalf) * (1 - deck / rail) + .08;
  for (let k = 0; k < 9; k++) put(lf, box(deckHalf * 2, .04, deckHalf * 2 / 9 - .01, k % 2 ? 0x9a6f48 : 0x8a6040), mats.timber, [0, deck, -deckHalf + (k + .5) * deckHalf * 2 / 9]);
  // Ladder on the +Z face; two rungs missing, one snapped.
  const ladderFoot = (sx: number) => { const w = local(lf, sx, baseHalf + .45); return ground(w.x, w.z) - lf.position.y - .05; };
  for (const sx of [-.24, .24]) rootBranch(lf, new Vector3(sx, ladderFoot(sx), baseHalf + .45), new Vector3(sx, deck + .1, deckHalf + .02), .03, .03, 0x7a5236, mats.timber);
  for (let k = 0; k < 8; k++) {
    if (k === 3 || k === 4) continue;
    const t = (k + .6) / 8.2, z = baseHalf + .45 + (deckHalf + .02 - baseHalf - .45) * t;
    const rung = put(lf, cyl(.018, .018, k === 5 ? .26 : .48, 5, 0x8a6040), mats.timber, [k === 5 ? -.11 : 0, t * (deck + .1), z], [0, 0, Math.PI / 2]);
    if (k === 5) rung.rotation.x = .5;
  }
  // Wind-torn canvas on the north railing.
  const wind = new PlaneGeometry(deckHalf * 2, .75, 4, 3);
  const wp = wind.getAttribute('position');
  for (let i = 0; i < wp.count; i++) { const x = wp.getX(i), y = wp.getY(i); wp.setXYZ(i, x, y - (y < -.3 ? .12 * Math.abs(Math.sin(x * 9)) : 0), .06 * Math.sin(x * 4 + y * 3)); }
  wind.computeVertexNormals();
  put(lf, paint(wind, 0xc2ae84, .08), mats.foliage, [0, deck + .45, -deckHalf - .02]);
  put(lf, cyl(.03, .03, .5, 8, 0x3a3634, 0), mats.iron, [.35, deck + .95, .2], [.2, 0, Math.PI / 2 - .2]);
  shadow(lk.x, lk.z, 1.4, 1.4, .3, 1.2, lk.yawDeg);
  { const c = local(lf, 0, .2); colliders.push({ type: 'box', x: c.x, z: c.z, hx: baseHalf + .05, hz: baseHalf + .4, yawDeg: lk.yawDeg }); }
  // Page 6's supply box at the tower's foot is the 'outpost-supply-box' ItemSurface prop.
  const lb = OUTPOST.lookoutBox;
  shadow(lb.x, lb.z, .45, .38, .3, .2, lb.yawDeg);

  // Tattered banner with the expedition's flame emblem.
  const bn = OUTPOST.banner, nf = frame(bn.x, bn.z, bn.yawDeg);
  put(nf, cyl(.035, .045, 2.9, 7, 0x6b4830), mats.timber, [0, 1.45, 0]);
  put(nf, cyl(.025, .025, 1.1, 6, 0x6b4830), mats.timber, [.5, 2.62, 0], [0, 0, Math.PI / 2]);
  const cloth = new PlaneGeometry(.92, 1.45, 6, 9);
  const cp = cloth.getAttribute('position');
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i), t = (.725 - y) / 1.45;
    const torn = y < -.6 ? (.12 + .12 * Math.abs(Math.sin(x * 23))) : 0;
    cp.setXYZ(i, x + .03 * Math.sin(y * 5) * t, y + torn, .08 * Math.sin(x * 5 + y * 2) * t + .04 * t);
  }
  cloth.computeVertexNormals();
  put(nf, paint(cloth, 0x7a2a22, .1), mats.foliage, [.5, 2.62 - .75, 0]);
  for (const side of [1, -1]) {
    put(nf, paint(new ShapeGeometry(flameShape(.3)), 0xe8a030, 0), mats.solid, [.5, 1.98, side * .045 + .02], [0, side < 0 ? Math.PI : 0, 0]);
  }
  for (let i = 0; i < 5; i++) put(nf, paint(new DodecahedronGeometry(1, 0), 0x8f959a, .06), mats.solid, [Math.cos(i * 1.3) * .2, .05, Math.sin(i * 1.3) * .2], [i, i, 0], [.12, .08, .1]);
  span(nf, cyl(.006, .006, 1, 3, 0xb8a27a, 0, true), mats.solid, new Vector3(0, 2.85, 0), new Vector3(-1.1, 0, .6));
  shadow(bn.x, bn.z, .5, .5, .25, 1.2);

  // Scattered gear: the barrel and crate stack ('outpost-barrel', 'outpost-crate-stack'
  // ItemSurface props), a pot on its side and a shovel planted in the dirt.
  const gear = (x: number, z: number, yaw: number, build: (f: Group) => void, r = .5) => { const gf = frame(x, z, yaw); build(gf); shadow(x, z, r, r * .8, .3, .2); };
  shadow(OUTPOST.barrel.x, OUTPOST.barrel.z, .35, .28, .3, .2);
  shadow(OUTPOST.crateStack.x, OUTPOST.crateStack.z, .5, .4, .3, .2);
  gear(-6.9, -34.3, 40, (f) => {
    put(f, cyl(.17, .13, .22, 12, 0x2e2a28, .04), mats.iron, [0, .16, 0], [Math.PI / 2 - .15, 0, 0]);
    put(f, cyl(.12, .12, .005, 12, 0x14110f, 0), mats.solid, [0, .165, .112], [Math.PI / 2 - .15, 0, 0]);
    put(f, paint(new TorusGeometry(.17, .014, 4, 14), 0x3a3634, 0), mats.iron, [0, .165, .11], [-.15, 0, 0]);
    put(f, paint(new TorusGeometry(.12, .008, 4, 10, Math.PI), 0x2e2a28, 0), mats.iron, [0, .3, -.02], [0, 0, 0]);
    put(f, cyl(.25, .3, .01, 10, 0x8a8580, .1), mats.solid, [0, .005, .32]);
  }, .3);
  gear(-7.4, -29.8, 60, (f) => {
    put(f, box(.22, .26, .015, 0x5a6368, 0), mats.iron, [0, .05, 0], [.12, 0, 0]);
    put(f, cyl(.018, .018, .95, 6, 0x9a6a3e), mats.timber, [0, .6, -.04], [.04, 0, 0]);
    put(f, box(.14, .025, .025, 0x6b4830), mats.timber, [0, 1.08, -.06]);
  }, .2);
  // Rennick's sentry, toppled on its side with a snapped leg, and its empty bolt case (by page 6).
  {
    const bs = OUTPOST.brokenSentry, f = frame(bs.x, bs.z, bs.yawDeg);
    const rig = new Group();
    rig.position.set(0, .16, 0);
    rig.rotation.set(0, 0, 1.32);
    put(rig, cyl(.12, .13, .045, 12, 0x3a3634, .03), mats.iron, [0, .62, 0]);
    put(rig, cyl(.035, .045, .16, 8, 0x2e2a28, 0), mats.iron, [0, .52, 0]);
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + .4, snapped = i === 1;
      const top = new Vector3(Math.cos(a) * .06, .46, Math.sin(a) * .06), foot = new Vector3(Math.cos(a) * .36, snapped ? .22 : -.1, Math.sin(a) * .36);
      rootBranch(rig, top, snapped ? top.clone().lerp(foot, .55) : foot, .022, .02, 0x7a5236, mats.timber);
      if (snapped) put(rig, cyl(0, .02, .05, 4, 0xc9a577), mats.timber, [top.x + (foot.x - top.x) * .58, top.y + (foot.y - top.y) * .58, top.z + (foot.z - top.z) * .58], [0, 0, .6]);
    }
    const bow = new Group();
    bow.position.set(0, .68, 0);
    put(bow, box(.06, .05, .56, 0x8a6040), mats.timber, [0, .03, 0]);
    put(bow, paint(new TorusGeometry(.27, .012, 4, 14, Math.PI * .8), 0x4a4038, 0), mats.iron, [0, .05, .22], [Math.PI / 2, 0, Math.PI * .1]);
    put(bow, cyl(.003, .003, .5, 3, 0xd8c9a4, 0, true), mats.solid, [0, .05, .08], [0, 0, Math.PI / 2]);
    rig.add(bow);
    f.add(rig);
    shadow(bs.x, bs.z, .6, .45, .3, 0, bs.yawDeg);
    const bc = OUTPOST.boltCase, cf2 = frame(bc.x, bc.z, bc.yawDeg);
    put(cf2, box(.44, .012, .18, 0x7a5236), mats.timber, [0, .006, 0]);
    for (const side of [-1, 1]) {
      put(cf2, box(.44, .1, .012, 0x94704a), mats.timber, [0, .05, side * .084]);
      put(cf2, box(.012, .1, .16, 0x94704a), mats.timber, [side * .214, .05, 0]);
    }
    put(cf2, box(.44, .012, .18, 0x8a6040), mats.timber, [0, .19, -.18], [-1.1, 0, 0]);
    put(cf2, paint(new ShapeGeometry(flameShape(.035)), 0xc8502a, 0), mats.solid, [0, .03, .091]);
    shadow(bc.x, bc.z, .32, .2, .28, 0, bc.yawDeg);
  }
  // Six spent bolts stuck in the ground pointing north, and ash where the Hollow fell.
  OUTPOST.spentBolts.forEach((b, i) => {
    const pitch = (35 + (i % 3) * 5) * Math.PI / 180, yawOff = ((i * 7) % 5 - 2) * .06;
    const dir = new Vector3(Math.sin(yawOff) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yawOff) * Math.cos(pitch));
    const tip = new Vector3(b.x, ground(b.x, b.z) - .06, b.z), tail = tip.clone().addScaledVector(dir, -.42);
    const gb = R(b.x, b.z);
    span(gb, cyl(.008, .009, 1, 5, 0x8a6a42, .03, true), mats.timber, tail, tip);
    for (let k = 0; k < 3; k++) {
      const fl = put(gb, paint(new PlaneGeometry(.03, .09), k ? 0xd8c9a4 : 0xa8302a, 0), mats.foliage, [0, 0, 0]);
      fl.position.copy(tail).addScaledVector(dir, .05);
      fl.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
      fl.rotateY(k * Math.PI * 2 / 3);
      fl.translateX(.012);
    }
  });
  OUTPOST.ash.forEach((a, i) => {
    const ga = R(a.x, a.z);
    for (let k = 0; k < 4; k++) {
      const x = a.x + Math.cos(k * 2.1 + i) * .18 * (k ? 1 : 0), z = a.z + Math.sin(k * 2.1 + i) * .14 * (k ? 1 : 0);
      put(ga, paint(new CircleGeometry(k ? .16 : .34, 7), k ? 0x4a4744 : 0x3a3836, .08), mats.solid, [x, ground(x, z) + .036 + k * .002, z], [-Math.PI / 2, 0, i + k]);
    }
    for (let k = 0; k < 5; k++) put(ga, paint(new IcosahedronGeometry(1, 0), 0x1e1c1a, 0), mats.solid, [a.x + Math.cos(k * 2.4) * .25, ground(a.x, a.z) + .02, a.z + Math.sin(k * 2.4) * .2], [k, k, 0], [.03, .012, .025]);
  });
  // Stones and packed-earth clutter round the clearing.
  for (const [x, z, h, yaw] of [[-11.6, -31.2, .8, .4], [-1.6, -29.4, .5, 1.8], [-9.4, -38.6, .9, 2.3], [2.6, -33.5, .7, .9]]) boulder(R(x, z), x, z, h, yaw);
}

/** Worn stone step: flattened, lumpy slab; pale worn top, darker sides, moss on the rounded edges. */
function stepSlab(seed: number): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, 1);
  const p = geometry.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const lump = 1 + .1 * Math.sin(x * 3.3 + seed) * Math.cos(z * 2.9 - seed * .6) + .05 * Math.sin(y * 5 + seed);
    p.setXYZ(i, x * lump, Math.min(.3, Math.max(-.7, y * lump)), z * lump);
  }
  geometry.computeVertexNormals();
  const n = geometry.getAttribute('normal'), colors = new Float32Array(p.count * 3), cc = new Color();
  for (let f = 0; f < p.count / 3; f++) {
    const up = (n.getY(f * 3) + n.getY(f * 3 + 1) + n.getY(f * 3 + 2)) / 3;
    const k = Math.sin((f + seed * 31) * 12.9898) * 43758.5453, r = k - Math.floor(k);
    cc.setHex(up > .9 ? 0xaaaaa2 : 0x7f858a).multiplyScalar(.9 + r * .16);
    if (up > .3 && up <= .9 && r > .35) cc.setHex(r > .7 ? 0x7a9a3c : 0x69883a);
    for (let v = 0; v < 3; v++) cc.toArray(colors, (f * 3 + v) * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

// ======================================================================== the Spire
{
  const g = regions.spire;
  // The pierced stone, painted per face: grey stone, lichen, darker base.
  const shape = new Shape();
  for (const [x, y] of [[-2.2, 0], [-1.6, 3.5], [-1.9, 5.5], [-1, 8.5], [-.4, 11.2], [.4, 11.6], [1.1, 9], [1.9, 6], [1.5, 3.2], [2.3, 0]]) shape.lineTo(x, y);
  shape.closePath();
  const opening = new Path();
  opening.absarc(.15, 8.6, .85, 0, Math.PI * 2, true);
  shape.holes.push(opening);
  const stoneGeo = new ExtrudeGeometry(shape, { depth: 2.4, bevelEnabled: true, bevelSize: .45, bevelThickness: .45, bevelSegments: 1, curveSegments: 10 });
  stoneGeo.translate(0, 0, -1.2);
  {
    const p = stoneGeo.getAttribute('position'), colors = new Float32Array(p.count * 3), cc = new Color();
    for (let face = 0; face < p.count / 3; face++) {
      const y = (p.getY(face * 3) + p.getY(face * 3 + 1) + p.getY(face * 3 + 2)) / 3;
      const x = (p.getX(face * 3) + p.getX(face * 3 + 1) + p.getX(face * 3 + 2)) / 3;
      const k = Math.sin(face * 12.9898) * 43758.5453, r = k - Math.floor(k);
      cc.setHex(0x6f767e).lerp(new Color(0x9aa0a4), Math.min(1, y / 9 + .15)).multiplyScalar(.92 + r * .14);
      if (r > .86 && y < 7) cc.lerp(new Color(0xa7b06a), .55);
      if (y < 1.2 && r > .4) cc.lerp(new Color(0x6f8a3a), .5);
      // Soot ring round the pierced opening: fire burned here once.
      cc.lerp(new Color(0x2a2624), smooth(2.05, .95, Math.hypot(x - .15, y - 8.6)) * (.75 + r * .2));
      for (let v = 0; v < 3; v++) cc.toArray(colors, (face * 3 + v) * 3);
    }
    stoneGeo.setAttribute('color', new BufferAttribute(colors, 3));
  }
  const st = SPIRE.stone, sf = frame(st.x, st.z, st.yawDeg, ground(st.x, st.z) - .6);
  put(sf, stoneGeo, mats.solid, [0, 0, 0], [0, 0, 0], st.scale);
  // A carved flame glyph on the south face, at eye height.
  put(sf, paint(new ShapeGeometry(flameShape(.42)), 0x4a4e52, 0), mats.solid, [0, 1.9, (1.2 + .45) * st.scale + .02]);
  put(sf, paint(new DodecahedronGeometry(2.4, 1), 0x6f767e, .08), mats.solid, [0, .4, 0], [0, .3, 0], [1.25, .5, 1.1]);
  for (const [lx, lz, h, yaw] of [[-2.6, .9, 1.1, .2], [2.4, 1.2, .9, 1.7], [-1.8, -2.2, 1.4, 2.6], [2.8, -1.6, 1.2, .8]]) {
    const w = local(sf, lx, lz);
    boulder(g, w.x, w.z, h, yaw, 1.1, .3);
  }
  shadow(st.x, st.z, 3.6, 2.6, .34, 4);
  colliders.push({ type: 'box', x: st.x, z: st.z, hx: 2.6, hz: 2.1, yawDeg: st.yawDeg });
  // Flagstones round the beacon and the ledge for page 7.
  const random = rng(51);
  for (let i = 0; i < 26; i++) {
    const a = random() * Math.PI * 2, d = 1.3 + random() * 2.6;
    const x = SPIRE.beacon.x + Math.cos(a) * d, z = SPIRE.beacon.z + Math.sin(a) * d * .85;
    if (Math.hypot(x - SPIRE.ledge.x, z - SPIRE.ledge.z) < .8) continue;
    // Flags nearest the beacon are scorched: the Kindling happened here.
    const scorched = d < 1.8;
    put(g, paint(new DodecahedronGeometry(1, 0), scorched ? [0x3f3a36, 0x4a4440, 0x35302c][i % 3] : [0x9a958c, 0x8f959a, 0xa39a8a][i % 3], .05), mats.solid, [x, ground(x, z) + .005, z], [0, a, 0], [.28 + random() * .2, .03, .22 + random() * .15]);
  }
  // Page 7's ledge is the 'spire-ledge' ItemSurface prop.
  shadow(SPIRE.ledge.x, SPIRE.ledge.z, .62 * 1.3, .62 * 1.1, .3, SPIRE.ledge.top * .4);
  // Ilse's satchel and a burnt-out taper beside page 7.
  {
    const le = SPIRE.ledge, topY = ground(le.x, le.z) + le.top * (.65 / .64) - .02;
    const sat = new Group();
    sat.position.set(le.x + SPIRE.satchel.dx, topY, le.z + SPIRE.satchel.dz);
    sat.rotation.y = SPIRE.satchel.yawDeg * Math.PI / 180;
    put(sat, box(.26, .15, .09, 0x6e4b34, .06), mats.solid, [0, .075, 0]);
    put(sat, box(.265, .012, .1, 0x5a3c28, .04), mats.solid, [0, .156, 0]);
    put(sat, box(.24, .09, .01, 0x5a3c28, .04), mats.solid, [0, .115, .05]);
    put(sat, box(.03, .03, .006, 0xc99a4a, 0), mats.solid, [0, .08, .056]);
    put(sat, paint(new ShapeGeometry(flameShape(.03)), 0xc8502a, 0), mats.solid, [-.07, .11, .0555]);
    put(sat, paint(new TorusGeometry(.15, .008, 3, 16, Math.PI * 1.2), 0x5a3c28, 0), mats.solid, [.02, .006, -.12], [-Math.PI / 2, 0, .4], [1, 1, .4]);
    g.add(sat);
    const tp = new Group();
    tp.position.set(le.x + SPIRE.taper.dx, topY + .012, le.z + SPIRE.taper.dz);
    tp.rotation.y = .7;
    put(tp, cyl(.011, .012, .16, 7, 0xe8dfc8, .03), mats.solid, [0, 0, 0], [0, 0, Math.PI / 2]);
    put(tp, cyl(.006, .011, .035, 7, 0x1a1614, 0), mats.solid, [-.097, 0, 0], [0, 0, Math.PI / 2]);
    put(tp, paint(new SphereGeometry(.014, 6, 4), 0xe8dfc8, 0), mats.solid, [.05, -.006, .012], [0, 0, 0], [1.6, .5, 1]);
    g.add(tp);
  }
  // Stone steps: faceted, worn slabs with moss in the joints, constant 0.17 m risers down from the plateau rim.
  {
    const plateauY = ground(SPIRE.beacon.x, SPIRE.beacon.z);
    const climb = TRAILS.main.filter((p) => p.z < -43.5 && p.z > -51.6);
    let top = plateauY, placed = 0;
    for (let i = climb.length - 1; i >= 1 && placed < 14; i--) {
      const p = climb[i], gy = ground(p.x, p.z);
      if (gy > top - .07) continue;
      const q = climb[i - 1], yaw = Math.atan2(p.x - q.x, p.z - q.z);
      put(g, stepSlab(placed), mats.solid, [p.x, top - .1, p.z], [0, yaw + ((placed * 7) % 5 - 2) * .025, 0], [.7 + (placed % 3) * .04, .32, .33]);
      // Moss and dry grass at the ends of each step.
      for (const side of [-1, 1]) {
        const ex = p.x + Math.cos(yaw) * side * .78, ez = p.z - Math.sin(yaw) * side * .78;
        put(g, paint(new IcosahedronGeometry(1, 0), placed % 2 ? 0x6f8a3a : 0x5d7a34, .1), mats.solid, [ex, top - .07, ez], [0, placed, 0], [.14, .05, .1]);
        tuft(g, ex + Math.cos(yaw) * side * .18, ez - Math.sin(yaw) * side * .18, .55, [GRASS.dry, GRASS.olive]);
      }
      placed++;
      top -= .17;
      // Stop where the climb levels out into the trail below.
      if (top < ground(climb[0].x, climb[0].z) + .1) break;
    }
  }
  // Plateau rim boulders, rock flanks and the north ridge crags.
  for (const [x, z, h, yaw] of [[-.8, -50.4, .8, .5], [10.6, -51.2, 1, 1.8], [11.2, -57.4, 1.3, 2.7], [-1.4, -56.6, 1.1, .9], [1.2, -61.2, 1.5, 1.6], [9.6, -61.8, 1.4, .3], [-12, -50, 1.5, .5], [27, -48, 1.8, 1.4]]) boulder(g, x, z, h, yaw);
  for (const [x, z, h, yaw] of [[-36.5, -50, 5, .4], [-33.5, -59, 4, 1.7], [37.5, -53, 5.5, 2.4], [34.5, -61, 4.2, .9], [-26, -68.5, 3.6, 1.2], [29, -69, 4, 2.2], [-6, -68, 3.2, .6], [14, -67.5, 3.4, 2.9]]) boulder(g, x, z, h, yaw, 1.3, .2);
  // Rocky knoll flanks: outcrops and dry grass ringing the plateau.
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * Math.PI * 2 + random() * .2, d = 6.4 + random() * 4.5;
    const x = SPIRE.centre.x + Math.cos(a) * d, z = SPIRE.centre.z + Math.sin(a) * d * .9;
    if (trailNearest(x, z) < 1.6 || !clearOfNodes(x, z)) continue;
    if (i % 3 === 0) boulder(g, x, z, .5 + random() * .7, a, 1.2, .25);
    else for (let k = 0; k < 3; k++) tuft(g, x + (random() - .5) * 1.4, z + (random() - .5) * 1.4, .6 + random() * .35, [GRASS.dry, GRASS.olive], k === 0 && i % 4 === 1 ? FLOWERS.daisy : null);
  }
  for (let i = 0; i < 60; i++) {
    const x = -30 + random() * 60, z = -46 - random() * 17;
    if (Math.hypot(x - SPIRE.centre.x, z - SPIRE.centre.z) < 4.2 || !clearOfNodes(x, z) || trailNearest(x, z) < 1.2) continue;
    tuft(R(x, z), x, z, .6 + random() * .4, [GRASS.dry, GRASS.olive]);
  }
}

// ==================================================================== trail + open valley
{
  // Stepping stones and edge pebbles along the trails beyond the camp.
  (['main', 'grove', 'meadow', 'east'] as const).forEach((key) => {
    TRAILS[key].forEach((p, i) => {
      if (inCamp(p.x, p.z, 12) || p.z < -46) return;
      const q = TRAILS[key][i + 1] ?? p, tl = Math.hypot(q.x - p.x, q.z - p.z) || 1, nx = -(q.z - p.z) / tl, nz = (q.x - p.x) / tl;
      const half = key === 'main' ? 1.05 : .7;
      if (i % 5 === 0) steppingStone(R(p.x, p.z), p.x + ((i % 3) - 1) * .15, p.z, .2 + (i % 2) * .05, i * .7, i % 2);
      if (i % 3 === 1) {
        const side = i % 2 ? 1 : -1, x = p.x + nx * side * (half + .05 + (i % 4) * .06), z = p.z + nz * side * (half + .05);
        pebble(R(x, z), x, z, .05 + (i % 3) * .02, i, i % 3);
      }
    });
  });
  // Expedition trail marker at the grove/meadow forks, and a cairn on the way north.
  const marker = frame(2.7, -10.4, -20);
  put(marker, cyl(.05, .06, 1.5, 6, 0x6b4830), mats.solid, [0, .75, 0]);
  put(marker, box(.62, .13, .03, 0x9a6f48), mats.solid, [-.24, 1.3, .03], [0, 0, .06]);
  put(marker, box(.58, .13, .03, 0x8a6040), mats.solid, [.22, 1.08, .03], [0, 0, -.05]);
  put(marker, paint(new ShapeGeometry(flameShape(.07)), 0xc8502a, 0), mats.solid, [0, 1.42, .036]);
  shadow(2.7, -10.4, .3, .3, .3, .8);
  const cairn = frame(-2.8, -22.4, 0);
  [[0, .12, 0, .26], [.05, .33, .02, .2], [-.02, .5, -.01, .15], [.01, .63, .01, .1]].forEach(([x, y, z, s], i) => put(cairn, paint(new DodecahedronGeometry(1, 0), [0x8f959a, 0x7a8086][i % 2], .06), mats.solid, [x, y, z], [i, i * 2, 0], [s, s * .6, s * .9]));
  shadow(-2.8, -22.4, .45, .4, .3, .3);

  // Open-valley tufts, shrubs and rocks (the meadow, grove and camp have their own).
  const random = rng(61);
  for (let i = 0; i < 2600; i++) {
    const x = WORLD_BOUNDS.minX + 1 + random() * 68, z = WORLD_BOUNDS.minZ + 2 + random() * 76;
    const region = regionOf(x, z);
    if (region === 'meadow' && ((x - 14.8) / 12.5) ** 2 + ((z + 15.6) / 10.5) ** 2 < 1) continue;
    if (region === 'grove' && Math.hypot(x - GROVE.centre.x, z - GROVE.centre.z) < 12) continue;
    if (region === 'spire' || inCamp(x, z, 12.5) || !clearOfNodes(x, z, .3)) continue;
    if (trailNearest(x, z) < 1.25 || (Math.abs(x - 21) < 6 && brookNearest(x, z) < 2.6)) continue;
    if (random() > (z < -40 ? .18 : .28)) continue;
    const roll = random();
    const dry = z < -38;
    if (roll < .95) tuft(R(x, z), x, z, .65 + random() * .4, dry ? [GRASS.dry, GRASS.olive] : [GRASS.olive, GRASS.lime, GRASS.deep], random() < .18 ? [FLOWERS.buttercup, FLOWERS.daisy, FLOWERS.violet][i % 3] : null);
    else if (roll < .97) shrub(R(x, z), x, z, .35 + random() * .25, i);
    else pebble(R(x, z), x, z, .12 + random() * .1, i, i % 3, .55);
  }
  for (const [x, z, h, yaw] of [[-9, 6, 1.4, .3], [-26, -40, 1.6, 1.2], [-24, -22, 1.2, 2.4], [-30.6, -2.4, 1.1, .8], [22.8, 9.6, 1, 1.7], [-18.8, 9.4, .9, .6], [30.2, -40.4, 1.2, 2]]) boulder(R(x, z), x, z, h, yaw);
  // Litter under the valley pines.
  for (const stand of Object.values(VALLEY_PINES)) stand.forEach((t, i) => {
    if (i % 2) return;
    litter(R(t.x, t.z), t.x + .6, t.z + .3, i, true, .9);
  });
}

// ========================================================================== horizon
{
  const g = regions.horizon;
  for (const [x, y, z, w, h, d, color, snow, yaw] of [
    [-52, 12, -132, 36, 40, 26, 0x86a6c6, .22, .3], [-8, 13, -142, 44, 52, 30, 0x86a6c6, .26, 1.1], [38, 12, -134, 38, 44, 26, 0x86a6c6, .22, 2.2],
    [-26, 13, -118, 26, 28, 18, 0x6c8fa3, .06, .6], [18, 13, -116, 28, 30, 18, 0x6c8fa3, .1, 1.9], [68, 11, -112, 30, 34, 24, 0x7d9cb8, .16, .2], [-72, 11, -108, 30, 32, 22, 0x7d9cb8, .12, 2.6],
    [-102, 9, -58, 26, 30, 30, 0x7d9cb8, .1, .9], [-106, 9, -8, 26, 24, 30, 0x86a6c6, 0, 1.4], [-98, 9, 40, 26, 22, 26, 0x86a6c6, 0, .2],
    [102, 9, -54, 26, 32, 30, 0x7d9cb8, .12, 2.8], [108, 9, -4, 26, 26, 30, 0x86a6c6, 0, .7], [98, 9, 42, 26, 22, 26, 0x86a6c6, 0, 1.6],
    [-36, 9, 82, 34, 22, 22, 0x86a6c6, 0, .4], [22, 9, 86, 38, 26, 22, 0x86a6c6, 0, 2.3],
  ] as const) mountain(g, x, y, z, w, h, d, color, snow, yaw);
  const cloudGeometry = new IcosahedronGeometry(1, 1);
  for (const [x, y, z, size] of [[-16, 24, -72, 3.2], [14, 27, -84, 4], [32, 21, -44, 2.6], [-34, 20, -30, 2.4], [4, 22, 44, 3], [-40, 23, -70, 2.8]]) {
    [[-.9, 0, .55, .4], [-.45, .18, .7, .56], [.1, .28, .82, .66], [.65, .14, .62, .48], [1.1, -.02, .44, .34]].forEach(([px, py, sx, sy], i) => {
      put(g, cloudGeometry, mats.cloud, [x + px * size, y + py * size, z], [i * .9, i * .5, i * 1.1], [sx * size, sy * size, .55 * size]);
    });
  }
  // Distant treeline ribbons on the ridge crests (behind the far pine belts).
  const ribbon = (points: [number, number][]) => {
    const pos: number[] = [], col: number[] = [], nor: number[] = [], idx: number[] = [];
    const dark = new Color(0x2c4f2c), light = new Color(0x4f8040), cc = new Color();
    let n = 0;
    for (let s2 = 0; s2 < points.length - 1; s2++) {
      const [ax, az] = points[s2], [bx, bz] = points[s2 + 1], len = Math.hypot(bx - ax, bz - az), steps = Math.ceil(len / 1.3);
      // Faces the valley: inward horizontal, mostly up, so it shades like the canopy tops.
      const ix = (bz - az) / len, iz = -(bx - ax) / len;
      for (let i = 0; i < steps; i++) {
        const t = i / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t, base = ground(x, z) - 1;
        const tall = 4.2 + 1.6 * Math.abs(Math.sin(x * .7 + z * .9)) + (i % 2 ? 1.6 : 0);
        pos.push(x, base, z, x, base + tall, z);
        nor.push(ix * .3, .95, iz * .3, ix * .35, .94, iz * .35);
        cc.copy(dark).toArray(col, col.length); cc.copy(dark).lerp(light, .45 + .45 * Math.sin(x + z)).toArray(col, col.length);
        if (n > 0) idx.push((n - 1) * 2, n * 2, (n - 1) * 2 + 1, n * 2, n * 2 + 1, (n - 1) * 2 + 1);
        n++;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    geo.setIndex(idx);
    put(g, geo, mats.solid, [0, 0, 0]);
  };
  ribbon([[-61, 40], [-61, -93], [61, -93], [61, 40], [-61, 40]]);
}

// Baked contact shadows for the scene-placed props and trees (their nodes live in the scene).
for (const p of GLB_PINES) treeShadow(p.x, p.z, 7.3 * p.scale, 7.3 * p.scale * .26);
for (const stand of Object.values(VALLEY_PINES)) for (const t of stand) treeShadow(t.x, t.z, 5.6 * t.scale, 1.4 * t.scale);
for (const d of GROVE.deadwood) shadow(d.x, d.z, .95, .32, .34, 0, d.yawDeg);
for (const m of GROVE.mushrooms) shadow(m.x - .2, m.z - .15, .55, .5, .28);
for (const b of MEADOW.berries) shadow(b.x, b.z, .75, .7, .34, .4);
for (const h of MEADOW.herbs) shadow(h.x, h.z, .35, .3, .2);
for (const r of BROOK.reeds) shadow(r.x, r.z, .6, .5, .22);
for (const f of BROOK.flint) shadow(f.x, f.z, .5, .4, .2);
shadow(OUTPOST.brazier.x, OUTPOST.brazier.z, .75, .75, .3, .3);
shadow(GROVE.brazier.x, GROVE.brazier.z, .75, .75, .3, .3);
shadow(SPIRE.beacon.x, SPIRE.beacon.z, 1.2, 1.2, .32, .5);

const bake = (region: Region, name: string) => {
  const result = batchStatic(regions[region]);
  result.name = name;
  return result;
};
export const valleyGrove = bake('grove', 'Valley: resin grove');
export const valleyMeadow = bake('meadow', 'Valley: meadow and brook');
export const valleyOutpost = bake('outpost', 'Valley: expedition outpost');
export const valleySpire = bake('spire', 'Valley: the Spire');
/**
 * 'spire-eye': a flame disc filling the pierced opening, hidden until the finale. FxSystem shows
 * the group and ramps its own material 'Spire eye' (emissiveIntensity or opacity).
 */
{
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / (size - 1) - .5, v = j / (size - 1) - .5, r = Math.hypot(u, v) * 2, a = Math.atan2(v, u);
    const t = Math.min(1, r + .08 * Math.sin(a * 7 + r * 9));
    const c0 = new Color(0xfff3c0), c1 = new Color(0xffb347), c2 = new Color(0xff5a14);
    const cc = t < .45 ? c0.lerp(c1, t / .45) : c1.lerp(c2, (t - .45) / .55);
    const o = (j * size + i) * 4;
    data[o] = cc.r * 255; data[o + 1] = cc.g * 255; data[o + 2] = cc.b * 255; data[o + 3] = 255;
  }
  const map = smoothSampling(new DataTexture(data, size, size, RGBAFormat));
  map.colorSpace = SRGBColorSpace;
  const eyeMaterial = new MeshStandardMaterial({ color: 0x000000, emissive: new Color(0xffffff), emissiveMap: map, emissiveIntensity: 1.6, roughness: 1, side: DoubleSide, transparent: true, opacity: 1 });
  eyeMaterial.name = 'Spire eye';
  const st = SPIRE.stone, eye = new Group();
  eye.name = 'spire-eye';
  eye.position.set(st.x, ground(st.x, st.z) - .6, st.z);
  eye.rotation.y = st.yawDeg * Math.PI / 180;
  eye.scale.setScalar(st.scale);
  // A glowing plug: flame discs at both mouths of the opening plus a lining through the stone,
  // so the eye reads full from any angle. One mesh; the lining samples the map's hot rim.
  const depth = 1.2 + .45 - .03, parts: BufferGeometry[] = [];
  for (const z of [depth, -depth]) parts.push(new CircleGeometry(.9, 32).translate(0, 0, z));
  const tube = new CylinderGeometry(.86, .86, depth * 2, 32, 1, true).rotateX(Math.PI / 2);
  const tuv = tube.getAttribute('uv');
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, .93, .5);
  parts.push(tube);
  const merged = new BufferGeometry(), mp: number[] = [], mn: number[] = [], mu: number[] = [], mi: number[] = [];
  for (const part of parts) {
    const base = mp.length / 3, pp = part.getAttribute('position'), pn = part.getAttribute('normal'), pu = part.getAttribute('uv'), pi = part.getIndex()!;
    for (let i = 0; i < pp.count; i++) { mp.push(pp.getX(i), pp.getY(i), pp.getZ(i)); mn.push(pn.getX(i), pn.getY(i), pn.getZ(i)); mu.push(pu.getX(i), pu.getY(i)); }
    for (let i = 0; i < pi.count; i++) mi.push(pi.getX(i) + base);
  }
  merged.setAttribute('position', new BufferAttribute(new Float32Array(mp), 3));
  merged.setAttribute('normal', new BufferAttribute(new Float32Array(mn), 3));
  merged.setAttribute('uv', new BufferAttribute(new Float32Array(mu), 2));
  merged.setIndex(mi);
  merged.computeBoundingSphere();
  const disc = new Mesh(merged, eyeMaterial);
  disc.position.set(.15, 8.6, 0);
  disc.name = 'Spire eye flame';
  eye.add(disc);
  eye.visible = false;
  valleySpire.add(eye);
}
export const valleyTrail = bake('trail', 'Valley: trail and open ground');
export const valleySouth = bake('south', 'Valley: south woods');
export const valleyHorizon = bake('horizon', 'Valley: mountains, clouds and far treeline');
