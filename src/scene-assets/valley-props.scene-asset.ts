/**
 * Valley interaction props: resource-node visuals, braziers, the procedural pines used
 * by instanced scene patterns, and the invisible boundary walls. Each prop is a
 * parentless prototype, batched per material. A forage node shows only its SOURCE (a
 * stump, a bush, a reed clump, a chalk outcrop) in one draw; the one grabbable item
 * waiting on it is the only pickable piece, never surrounded by copies.
 */
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DataTexture, DodecahedronGeometry, DoubleSide, Group,
  ExtrudeGeometry, IcosahedronGeometry, LatheGeometry, LinearFilter, Mesh, MeshBasicMaterial, MeshStandardMaterial, NormalBlending, OctahedronGeometry,
  PlaneGeometry, Points, PointsMaterial, RepeatWrapping, RGBAFormat, ShaderMaterial, Shape, Sphere, SphereGeometry, SRGBColorSpace, TorusGeometry, Vector2,
  Vector3,
} from '@iwsdk/core';
import { batchStatic } from './static-batch.js';
import { mats, paint, put, span } from './valley-kit.scene-asset.js';
import { BoxGeometry } from '@iwsdk/core';
import { BERRY_SPAWN } from './valley-layout.scene-asset.js';
import { terrainHeight, WORLD_BOUNDS } from '../game/terrain.js';

const c = new Color(), c2 = new Color();

/** Bake a named sub-assembly into one child group (one draw per material). */
function baked(parent: Group, source: Group, name: string): Group {
  const result = batchStatic(source);
  result.name = name;
  parent.add(result);
  return result;
}
/** Colour a geometry per vertex from its normal: `up` above `threshold`, else `side`. */
function paintByNormal<T extends BufferGeometry>(geometry: T, side: number, up: number, threshold = .55, variation = .06): T {
  geometry.computeVertexNormals();
  const n = geometry.getAttribute('normal'), p = geometry.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const drift = 1 + variation * Math.sin(p.getX(i) * 9.1 + p.getZ(i) * 6.3 + p.getY(i) * 4.1);
    c.setHex(n.getY(i) + .12 * Math.sin(p.getX(i) * 13 + p.getZ(i) * 7) > threshold ? up : side).multiplyScalar(drift);
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}
const cyl = (top: number, bottom: number, h: number, seg: number, color: number, variation = .05, open = false) =>
  paint(new CylinderGeometry(top, bottom, h, seg, 1, open), color, variation);

// =============================================================================== deadwood
/**
 * Uprooted fallen trunk (~2.1 m, r ≈ .2) with its root plate torn out of the ground, a
 * snapped crown end, branch stubs, moss, and two fresh axe notches in pale wood: it reads
 * as a tree you chop, never as loose firewood (the 'log' item is a short sawn billet).
 * Origin at ground centre; the trunk lies along X, root plate at -X.
 */
function makeDeadwood(): Group {
  const src = new Group();
  const length = 2.1, rRoot = .22, rTop = .17, axisY = .19;
  const trunk = new CylinderGeometry(rRoot, rTop, length, 12, 8, true);
  const p = trunk.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const bump = 1 + .07 * Math.sin(a * 3 + y * 4) + .04 * Math.sin(a * 7 - y * 9);
    p.setXYZ(i, x * bump, y, z * bump + .03 * Math.sin(y * 1.8));
  }
  // CylinderGeometry's +Y (radiusTop) end turns toward -X: that is the root end.
  trunk.rotateZ(Math.PI / 2);
  paintByNormal(trunk, 0x6f5d4a, 0x6f8a3a, .62, .08);
  put(src, trunk, mats.bark, [0, axisY, 0]);
  // Root plate: a disc of earth and torn roots standing on edge at the root end.
  const plateX = -length / 2 - .06;
  put(src, paintByNormal(new IcosahedronGeometry(1, 1), 0x5a4632, 0x6f8a3a, .7, .1), mats.bark, [plateX - .04, .3, 0], [0, 0, 0], [.1, .36, .5]);
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + .3, reach = .38 + (i % 3) * .1;
    const from = new Vector3(plateX + .02, axisY + Math.sin(a) * .12, Math.cos(a) * .12);
    const to = new Vector3(plateX - .06 - (i % 2) * .08, Math.min(.62, Math.max(.02, axisY + .12 + Math.sin(a) * reach)), Math.cos(a) * reach * 1.15);
    span(src, cyl(.012, .04, 1, 5, 0x4f3b2a, .05, true), mats.bark, from, to);
  }
  // Snapped crown end: pale heartwood and jagged shards.
  const endA = new Group();
  endA.position.set(length / 2, axisY, 0);
  put(endA, cyl(rTop * .88, rTop * .88, .03, 10, 0xc9a577, .05), mats.bark, [0, 0, 0], [0, 0, Math.PI / 2]);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2 + .3, len = .1 + (i % 3) * .06;
    put(endA, cyl(0, .04, len, 3, i % 2 ? 0xb89466 : 0x8a7054, .04), mats.bark, [len / 2, Math.sin(a) * .11, Math.cos(a) * .11], [0, 0, -Math.PI / 2 + (i % 2 ? .15 : -.1)]);
  }
  src.add(endA);
  // Broken branch stubs with pale snapped tips.
  for (const [x, a, len, r] of [[.5, .9, .32, .05], [-.05, -1.1, .24, .042], [-.5, .35, .28, .038], [.2, 2.4, .18, .034]] as const) {
    const base = new Vector3(x, axisY + Math.cos(a) * .17, Math.sin(a) * .17);
    const tip = base.clone().add(new Vector3(len * .35, Math.cos(a) * len, Math.sin(a) * len));
    span(src, cyl(r * .7, r, 1, 6, 0x6f5d4a, .05, true), mats.bark, base, tip);
    put(src, cyl(r * .72, r * .72, .012, 6, 0xc9a577, 0), mats.bark, [tip.x, tip.y, tip.z]).quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tip.clone().sub(base).normalize());
  }
  // Two fresh axe notches: pale V-cuts in the upper side, with a few chips below.
  for (const nx of [.12, .62]) {
    const top = axisY + rRoot - (nx + length / 2) / length * (rRoot - rTop) - .01;
    for (const side of [-1, 1]) put(src, box3(.09, .012, .2, 0xe0c393), mats.bark, [nx + side * .03, top, .02], [0, 0, side * .62]);
    put(src, box3(.02, .05, .19, 0x9a6f45), mats.bark, [nx, top - .03, .02]);
  }
  for (let i = 0; i < 5; i++) {
    const a = i * 2.2 + .4;
    put(src, box3(.045, .006, .022, i % 2 ? 0xd9b88a : 0xc9a577), mats.bark, [.35 + Math.cos(a) * .2, .004, .3 + Math.sin(a) * .1], [0, a * 1.7, 0]);
  }
  // Moss cushions on the upper side.
  for (const [x, z, s] of [[-.4, .06, .18], [.35, -.05, .12], [.85, .04, .09]] as const) {
    put(src, paint(new IcosahedronGeometry(1, 1), 0x6f9a3c, .12), mats.bark, [x, axisY + rRoot * .92, z], [0, x * 3, 0], [s, s * .32, s * .7]);
  }
  return batchStatic(src);
}
const box3 = (w: number, h: number, d: number, color: number) => paint(new BoxGeometry(w, h, d), color, .03);

// ============================================================================== resin scar
/**
 * Tapped bark wound: the SOURCE only. Old sap has dried to dark streaks down the bark, so
 * the one fresh, glowing amber lump waiting on it (the 'resin' item) is the only resin in
 * sight. Origin = the resin spawn point, +Z points out of the trunk. One draw.
 */
function makeResinScar(): Group {
  const root = new Group();
  const bark = new Group();
  // Exposed pale wood lens and the swollen bark lip around it (trunk surface ≈ z −0.03).
  put(bark, paint(new SphereGeometry(1, 10, 8), 0xb7772c, .08), mats.solid, [0, .02, -.035], [0, 0, 0], [.068, .2, .03]);
  put(bark, paint(new TorusGeometry(1, .24, 5, 16), 0x4f3a2a, .08), mats.solid, [0, .02, -.028], [0, 0, 0], [.09, .24, .085]);
  // Old axe notches the expedition cut to tap the pine.
  for (const [y, a] of [[.2, .5], [.24, -.45]] as const) put(bark, paint(new DodecahedronGeometry(1, 0), 0x3b2a1e, 0), mats.solid, [a * .05, y, -.02], [0, 0, a], [.03, .008, .02]);
  // Dried, darkened sap runs: flat streaks on the bark, never a loose lump.
  for (const [x, len, y0] of [[-.035, .26, -.12], [.03, .18, -.1], [0, .34, -.17], [.05, .1, .12]] as const) {
    const z = -.024 - x * x / .33;
    put(bark, paint(new SphereGeometry(1, 6, 5), 0x6a3c14, .06), mats.solid, [x, y0 - len / 2, z], [0, 0, 0], [.011, len / 2, .006]);
  }
  baked(root, bark, 'wound');
  root.name = 'Resin scar';
  return root;
}

// =========================================================================== mushroom patch
/**
 * Mossy rotten stump and roots: the SOURCE. It carries pale bracket fungi (a different,
 * inedible species, fused to the wood) so it reads as mushroom ground; the one brown
 * bolete waiting at the origin (the 'mushroom' item) is the only one you can pick.
 * Origin at the spawn point on the ground. One draw.
 */
function makeMushroomPatch(): Group {
  const root = new Group();
  const base = new Group();
  const stump = new CylinderGeometry(.16, .22, .36, 9, 2, false);
  const sp = stump.getAttribute('position');
  for (let i = 0; i < sp.count; i++) if (sp.getY(i) > .1) sp.setY(i, sp.getY(i) + .06 * Math.sin(Math.atan2(sp.getZ(i), sp.getX(i)) * 3));
  paintByNormal(stump, 0x6b5440, 0x5d8a34, .5, .08);
  put(base, stump, mats.solid, [-.34, .17, -.26], [.05, .4, -.04]);
  put(base, paint(new CylinderGeometry(.13, .13, .01, 9), 0x3b2a1e, 0), mats.solid, [-.34, .37, -.26]);
  for (const a of [.3, 1.9, 3.6, 4.9]) {
    const from = new Vector3(-.34 + Math.cos(a) * .16, .06, -.26 + Math.sin(a) * .16);
    const to = new Vector3(-.34 + Math.cos(a) * .55, -.03, -.26 + Math.sin(a) * .5);
    span(base, cyl(.018, .045, 1, 5, 0x5f4a38, .05, true), mats.solid, from, to);
  }
  put(base, paint(new IcosahedronGeometry(1, 1), 0x5d8a34, .14), mats.solid, [-.12, -.03, -.08], [0, .6, 0], [.46, .1, .36]);
  put(base, paint(new IcosahedronGeometry(1, 1), 0x6b9a3a, .14), mats.solid, [.18, -.02, .12], [0, 1.4, 0], [.24, .07, .2]);
  // Bracket fungi: flat, pale, ringed shelves growing out of the stump's side.
  for (const [a, y, s] of [[2.2, .12, .075], [2.6, .21, .06], [1.8, .27, .05], [3.1, .08, .055]] as const) {
    const x = -.34 + Math.cos(a) * .19, z = -.26 + Math.sin(a) * .19;
    const shelf = new CylinderGeometry(1, 1, .18, 10, 1, false, 0, Math.PI);
    const shp = shelf.getAttribute('position'), colors = new Float32Array(shp.count * 3);
    for (let i = 0; i < shp.count; i++) {
      const r = Math.hypot(shp.getX(i), shp.getZ(i));
      c.setHex(shp.getY(i) < 0 ? 0xcdbf9c : 0xe6dcc2).lerp(c2.setHex(0xa88a5a), Math.max(0, r - .55) * 1.4 * (shp.getY(i) < 0 ? .3 : 1));
      c.toArray(colors, i * 3);
    }
    shelf.setAttribute('color', new BufferAttribute(colors, 3));
    put(base, shelf, mats.solid, [x, y, z], [0, Math.PI / 2 - a, 0], [s, s * .35, s * .9]);
  }
  baked(root, base, 'base');
  root.name = 'Mushroom stump';
  return root;
}

// ============================================================================== berry bush
/** Rounded berry bush; origin = the berry spawn point on its top-front (bush-local +Z = front). */
function makeBerryBush(): Group {
  const root = new Group();
  const body = new Group();
  body.position.set(0, -BERRY_SPAWN.up, -BERRY_SPAWN.forward);
  const leaf = [0x3f6f2c, 0x4a7d30, 0x355f28, 0x56893a];
  for (const [x, y, z, s, i] of [[0, .48, 0, .42, 0], [.3, .36, .12, .3, 1], [-.32, .34, .08, .32, 2], [.1, .33, -.3, .3, 3], [-.15, .66, -.06, .26, 1], [.2, .62, .1, .24, 3], [-.05, .3, .3, .26, 0]] as const) {
    const g = paintByNormal(new IcosahedronGeometry(1, 1), leaf[i], 0x5f9440, .7, .1);
    put(body, g, mats.solid, [x, y, z], [i, i * 1.7, 0], [s, s * .82, s]);
  }
  for (const a of [.4, 2.3, 4.2]) span(body, cyl(.012, .025, 1, 5, 0x5a3d28, .05, true), mats.solid, new Vector3(Math.cos(a) * .05, -.02, Math.sin(a) * .05), new Vector3(Math.cos(a) * .22, .3, Math.sin(a) * .22));
  // A few pale blossoms on the leaf blobs (never red): the one ripe cluster at the origin is
  // the 'berries' item, the only fruit on the bush.
  for (const [bx, by, bz, bs, dx, dy, dz] of [[0, .48, 0, .42, .3, .8, .5], [.3, .36, .12, .3, .8, .4, .45], [-.32, .34, .08, .32, -.8, .45, .4],
    [.1, .33, -.3, .3, .4, .5, -.8], [-.15, .66, -.06, .26, -.5, .8, -.3], [.2, .62, .1, .24, .6, .7, .4]] as const) {
    const d = new Vector3(dx, dy, dz).normalize();
    put(body, paint(new OctahedronGeometry(.024, 0), 0xf3eee0, 0), mats.solid, [bx + d.x * bs, by + d.y * bs * .82, bz + d.z * bs], [bx * 9, by * 7, 0], [1, .45, 1]);
  }
  const bush = new Group();
  bush.add(body);
  baked(root, bush, 'bush');
  root.name = 'Berry bush';
  return root;
}

// ============================================================================== herb patch
/** Low wild-herb clump; origin at the spawn point on the ground. `herbs` holds the pickable sprigs. */
function makeHerbPatch(): Group {
  const root = new Group();
  const base = new Group();
  put(base, paint(new IcosahedronGeometry(1, 1), 0x6a5238, .1), mats.foliage, [0, -.02, 0], [0, 0, 0], [.26, .05, .22]);
  const leafGeo = (color: number) => {
    const g = new PlaneGeometry(.07, .13, 1, 2);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) { const t = (p.getY(i) + .065) / .13; p.setX(i, p.getX(i) * Math.sin(Math.max(.15, t) * Math.PI)); p.setZ(i, t * t * .03); }
    g.translate(0, .065, 0);
    g.computeVertexNormals();
    return paint(g, color, .06);
  };
  for (let i = 0; i < 9; i++) {
    const m = put(base, leafGeo(i % 2 ? 0x6e9a4c : 0x5f8a42), mats.foliage, [0, .01, 0]);
    m.rotation.order = 'YXZ';
    m.rotation.set(-1.15, i * .7, 0);
    m.scale.setScalar(1.2 + (i % 3) * .2);
  }
  // Leafy stalks still rooted round the rim (no flower heads): the tied, flowering bundle
  // waiting at the centre (the 'herb' item) is the one you pick.
  for (let s = 0; s < 5; s++) {
    const a = s * 1.26 + .5, r = .15 + (s % 2) * .05, h = .12 + (s % 3) * .03;
    const stalk = new Group();
    stalk.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    stalk.rotation.set(Math.sin(a) * .3, a, Math.cos(a) * .3);
    put(stalk, paint(new PlaneGeometry(.008, h), 0x5b7a3a, 0), mats.foliage, [0, h / 2, 0]);
    for (let k = 0; k < 3; k++) {
      const m = put(stalk, leafGeo(k % 2 ? 0x6e9a4c : 0x5f8a42), mats.foliage, [0, h * (.4 + k * .2), 0]);
      m.rotation.order = 'YXZ';
      m.rotation.set(-.9, k * 2.2, 0);
      m.scale.setScalar(.75 - k * .1);
    }
    base.add(stalk);
  }
  baked(root, base, 'base');
  root.name = 'Herb patch';
  return root;
}

// ============================================================================== reed clump
const reedBlade = (h: number, color: number, lean: number) => {
  const g = new PlaneGeometry(.035, h, 1, 4);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const t = (p.getY(i) + h / 2) / h; p.setXYZ(i, p.getX(i) * (1 - t * .85), t * h, t * t * lean); }
  g.computeVertexNormals();
  return paint(g, color, .05);
};
/**
 * Reeds and cattails on a muddy bank. The stems stand behind the origin (local -Z, toward the
 * water) and lean away from it, leaving a bare mud apron at the origin where the coiled cord
 * (the grabbable) waits in plain view, clear of every stem. Scene nodes turn +Z to dry land;
 * the bank falls ~0.4 m per metre toward the water, so the stems' feet follow it down.
 */
export const REED_CLUMP = { centreZ: -.52, bank: .4 } as const;
function makeReedClump(): Group {
  const root = new Group();
  const base = new Group();
  const { centreZ, bank } = REED_CLUMP;
  const slope = -Math.atan(bank);
  const foot = (z: number) => Math.min(0, z) * bank - .03;
  // A trampled mud patch under the cord (its top just below the coil) and the clump's own mound.
  const patch = new IcosahedronGeometry(1, 1);
  const pp = patch.getAttribute('position');
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), z = pp.getZ(i), ragged = 1 + .16 * Math.sin(Math.atan2(z, x) * 5 + 1.3) + .08 * Math.sin(Math.atan2(z, x) * 11);
    pp.setXYZ(i, x * ragged, pp.getY(i), z * ragged);
  }
  put(base, paintByNormal(patch, 0x6a563c, 0x5a4832, .75, .1), mats.foliage, [0, -.068, -.02], [slope, 0, 0], [.26, .05, .23]);
  put(base, paintByNormal(new IcosahedronGeometry(1, 1), 0x6f6250, 0x4f4032, .75, .08), mats.foliage, [0, foot(centreZ) - .03, centreZ], [slope, 0, 0], [.46, .08, .32]);
  // Lean directions all point away from the apron (to the water or the sides), never over the cord.
  const away = (i: number) => Math.PI * (.55 + .9 * ((i * .618) % 1));
  for (let i = 0; i < 10; i++) {
    const a = i * 2.39, x = Math.cos(a) * .36, z = centreZ + Math.sin(a) * .22;
    const m = put(base, reedBlade(.35 + (i % 3) * .08, 0x7a9a48, .08), mats.foliage, [x, foot(z), z]);
    m.rotation.order = 'YXZ';
    m.rotation.set(-.12, away(i + 3), 0);
  }
  // The standing reeds and cattails are the clump itself (the SOURCE, fused into one draw).
  for (let i = 0; i < 20; i++) {
    const a = i * 2.39 + .4, r = .3 + (i % 5) * .17, h = .95 + (i % 4) * .14;
    const x = Math.cos(a) * r * .3, z = centreZ + Math.sin(a) * r * .2;
    const m = put(base, reedBlade(h, [0x7a9a48, 0x8fae52, 0x6c8a3e][i % 3], .14 + (i % 3) * .06), mats.foliage, [x, foot(z), z]);
    m.rotation.order = 'YXZ';
    m.rotation.set(-.06 - (i % 3) * .05, away(i), 0);
  }
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3 + 1, r = .06 + (i % 3) * .07, h = 1.05 + (i % 3) * .12;
    const x = Math.cos(a) * r, z = centreZ + Math.sin(a) * r * .8, y = foot(z) + .03;
    put(base, cyl(.005, .007, h, 4, 0x6c8a3e, 0, true), mats.foliage, [x, y + h / 2, z]);
    put(base, cyl(.024, .024, .16, 7, 0x6b4228, .05), mats.foliage, [x, y + h - .05, z]);
    put(base, cyl(.003, .005, .08, 3, 0x6c8a3e, 0, true), mats.foliage, [x, y + h + .07, z]);
  }
  baked(root, base, 'base');
  root.name = 'Reed clump';
  return root;
}

// =============================================================================== flint bed
/**
 * Chalk outcrop banded with black flint, on a gravel bank: the SOURCE. Its flint is set
 * into the rock face (flat dark seams), never loose, so the one knapped nodule waiting at
 * the origin (the 'flint' item) is the only piece you can take. One draw.
 */
function makeFlintBed(): Group {
  const root = new Group();
  const base = new Group();
  put(base, paint(new IcosahedronGeometry(1, 1), 0xa39278, .08), mats.solid, [0, -.035, 0], [0, 0, 0], [.6, .07, .45]);
  // The outcrop: a pale chalk block behind the spawn point, banded with dark flint seams
  // (painted per face, so the bands stay crisp), bedded into the gravel.
  const rock = new IcosahedronGeometry(1, 1);
  const rp = rock.getAttribute('position');
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
    const lump = 1 + .14 * Math.sin(x * 4.1 + z * 2.3) + .08 * Math.cos(y * 5.2 - x * 1.7);
    rp.setXYZ(i, x * lump, Math.max(-.45, y * lump), z * lump);
  }
  rock.computeVertexNormals();
  const rc = new Float32Array(rp.count * 3);
  for (let f = 0; f < rp.count / 3; f++) {
    const y = (rp.getY(f * 3) + rp.getY(f * 3 + 1) + rp.getY(f * 3 + 2)) / 3;
    const seam = Math.abs(y - .28) < .12 || Math.abs(y + .12) < .07;
    const k = Math.sin(f * 12.9898) * 43758.5453, r = k - Math.floor(k);
    c.setHex(seam ? 0x34363c : 0xdcd2b8).multiplyScalar(.93 + r * .12);
    for (let v = 0; v < 3; v++) c.toArray(rc, (f * 3 + v) * 3);
  }
  rock.setAttribute('color', new BufferAttribute(rc, 3));
  put(base, rock, mats.solid, [-.08, .1, -.46], [.15, .7, .05], [.5, .32, .34]);
  put(base, rock, mats.solid, [.36, .05, -.34], [1.1, 2.1, .3], [.22, .15, .18]);
  for (let i = 0; i < 12; i++) {
    const a = i * 2.39, r = .22 + (i % 5) * .08, s = .02 + (i % 3) * .01;
    put(base, paint(new DodecahedronGeometry(1, 0), [0xb8ad96, 0xa39a86, 0xc4b89e][i % 3], .05), mats.solid, [Math.cos(a) * r * 1.2, s * .1, Math.sin(a) * r * .8 + .06], [0, a, 0], [s, s * .5, s * .8]);
  }
  baked(root, base, 'gravel');
  root.name = 'Flint outcrop';
  return root;
}

// ================================================================================ braziers
function bowlGeometry(radius: number, depth: number, wall: number, color: number, rust: number): BufferGeometry {
  const pts = [new Vector2(0, 0), new Vector2(radius * .3, .004), new Vector2(radius * .72, depth * .3), new Vector2(radius * .95, depth * .78), new Vector2(radius, depth),
    new Vector2(radius - wall, depth), new Vector2(radius * .93 - wall, depth * .8), new Vector2(radius * .7 - wall, depth * .34), new Vector2(0, wall)];
  const g = new LatheGeometry(pts, 16);
  g.computeVertexNormals();
  const p = g.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = .5 + .5 * Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 3 + p.getY(i) * 9);
    c.setHex(color).lerp(c2.setHex(rust), k * .55).toArray(colors, i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

/**
 * Brazier fire, built to read as a burning volume at any distance, never as paper cards:
 * - `tongues`: the campfire's layered lathe licks (outer orange, inner yellow) in two turned
 *   layers and a ring, merged into one draw. Their silhouette edges fade out (each lick is a
 *   soft glowing volume, not a flat sheet), a slow shimmer climbs them, and they thin out
 *   within ~2 m of the eye so a close look sees into the fire rather than a wall of card.
 * - `core`: a paler additive inner layer.
 * - `wisps`: camera-facing soft flame sprites in one draw: a steady glowing heart low in the
 *   bowl, and licks that rise, sway, cool from yellow to red and fade.
 * Origin at the fuel bed. FxSystem flickers the crown and advances each material's `uTime`.
 */
const TONGUE_VERTEX = /* glsl */ `
uniform vec2 uNear;
varying vec4 vColor;
varying float vFacing;
varying float vNear;
varying float vY;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  vNear = smoothstep(uNear.x, uNear.y, length(mv.xyz));
  vColor = color;
  vY = position.y;
  gl_Position = projectionMatrix * mv;
}`;
const TONGUE_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec4 vColor;
varying float vFacing;
varying float vNear;
varying float vY;
void main() {
  float soft = smoothstep(0.0, 0.6, vFacing);
  float shimmer = 0.8 + 0.2 * sin(uTime * 7.0 - vY * 10.0);
  float a = vColor.a * soft * shimmer * (0.45 + 0.55 * vNear);
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const WISP_VERTEX = /* glsl */ `
attribute vec2 corner;
attribute vec4 wisp; // seed, rate (cycles/s; 0 = the steady heart), size (m), rise (m)
uniform float uTime;
uniform vec2 uNear;
varying vec2 vCorner;
varying float vLife;
varying float vRising;
varying float vNear;
void main() {
  float rising = step(0.001, wisp.y);
  float life = rising > 0.5 ? fract(uTime * wisp.y + wisp.x) : 0.3;
  float climb = wisp.w * life * rising;
  vec3 p = position;
  p.y += climb;
  p.x += sin(uTime * 2.3 + wisp.x * 17.0) * climb * 0.2;
  p.z += cos(uTime * 1.9 + wisp.x * 11.0) * climb * 0.2;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNear = smoothstep(uNear.x, uNear.y, length(mv.xyz));
  float pulse = rising > 0.5 ? mix(1.0, 0.45, life) : 1.0 + 0.1 * sin(uTime * 6.0 + wisp.x * 40.0);
  mv.xy += corner * vec2(rising > 0.5 ? 0.5 : 0.62, 1.0) * wisp.z * length(modelMatrix[0].xyz) * pulse;
  vCorner = corner;
  vLife = life;
  vRising = rising;
  gl_Position = projectionMatrix * mv;
}`;
const WISP_FRAGMENT = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uWarm;
uniform vec3 uCool;
varying vec2 vCorner;
varying float vLife;
varying float vRising;
varying float vNear;
void main() {
  // A flame's teardrop: a round belly low in the sprite, drawn out to a thin tip.
  float y = vCorner.y + 0.35;
  float tip = clamp(y / 1.35, 0.0, 1.0);
  float d = length(vec2(vCorner.x / mix(0.9, 0.12, tip * tip), y / (y < 0.0 ? 0.65 : 1.35)));
  float shape = 1.0 - smoothstep(0.15, 1.0, d);
  float fade = vRising > 0.5 ? smoothstep(0.0, 0.15, vLife) * (1.0 - smoothstep(0.3, 0.9, vLife)) : 0.55;
  vec3 color = vRising > 0.5
    ? mix(mix(uHot, uWarm, smoothstep(0.0, 0.45, vLife)), uCool, smoothstep(0.45, 1.0, vLife))
    : mix(uHot, uWarm, vCorner.y * 0.5 + 0.5);
  float a = shape * fade * (0.5 + 0.5 * vNear);
  if (a < 0.004) discard;
  gl_FragColor = vec4(color, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
function flameMaterial(name: string, vertexShader: string, fragmentShader: string, options: { additive: boolean; vertexColors: boolean; uniforms?: Record<string, { value: unknown }> }): ShaderMaterial {
  return new ShaderMaterial({
    name, vertexShader, fragmentShader, vertexColors: options.vertexColors,
    uniforms: { uTime: { value: 0 }, uNear: { value: new Vector2(1.2, 3) }, ...options.uniforms },
    transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true, fog: false,
    blending: options.additive ? AdditiveBlending : NormalBlending,
  });
}
const tongueMaterial = flameMaterial('Brazier flame tongues', TONGUE_VERTEX, TONGUE_FRAGMENT, { additive: false, vertexColors: true });
const coreMaterial = flameMaterial('Brazier flame core', TONGUE_VERTEX, TONGUE_FRAGMENT, { additive: true, vertexColors: true });
const wispMaterial = flameMaterial('Brazier flame wisps', WISP_VERTEX, WISP_FRAGMENT, {
  additive: true, vertexColors: false,
  uniforms: { uHot: { value: new Color(0xfff0c4) }, uWarm: { value: new Color(0xffa040) }, uCool: { value: new Color(0xc8401a) } },
});
type Tongue = [profile: number, x: number, z: number, height: number, base: number, tip: number, yaw: number];
function tongueMesh(tongues: Tongue[], scale: number, material: ShaderMaterial, alpha: [number, number], name: string): Mesh {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  const base = new Color(), tip = new Color();
  tongues.forEach(([ps, x, z, h, b, t, yaw], n) => {
    const pts = [new Vector2(.11 * ps, 0), new Vector2(.18 * ps, .1 * h), new Vector2(.14 * ps, .35 * h), new Vector2(.07 * ps, .68 * h), new Vector2(.018 * ps, .95 * h), new Vector2(0, h)];
    const g = new LatheGeometry(pts, 9).toNonIndexed();
    const p = g.getAttribute('position');
    // Each tongue licks sideways as it rises (a flame, not a cone).
    for (let i = 0; i < p.count; i++) {
      const k = p.getY(i) / h;
      p.setX(i, p.getX(i) + Math.sin(k * 3.2 + n * 1.7) * .06 * ps * k);
      p.setZ(i, p.getZ(i) + Math.cos(k * 2.6 + n) * .04 * ps * k);
    }
    g.rotateY(yaw);
    g.translate(x, 0, z);
    g.scale(scale, scale, scale);
    const normals = g.getAttribute('normal');
    base.setHex(b); tip.setHex(t);
    for (let i = 0; i < p.count; i++) {
      const k = Math.min(1, p.getY(i) / (h * scale));
      c.copy(base).lerp(tip, Math.min(1, k * 1.3));
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(normals.getX(i), normals.getY(i), normals.getZ(i));
      col.push(c.r, c.g, c.b, alpha[0] + (alpha[1] - alpha[0]) * k * k);
    }
    g.dispose();
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}
/** One draw of camera-facing flame sprites: `heart` steady glows low in the bowl, `licks` rising ones. */
function wispMesh(scale: number, heart: number, licks: number): Mesh {
  const pos: number[] = [], corner: number[] = [], wisp: number[] = [], index: number[] = [];
  const add = (x: number, y: number, z: number, seed: number, rate: number, size: number, rise: number) => {
    const first = pos.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(x * scale, y * scale, z * scale);
      corner.push(cx, cy);
      wisp.push(seed, rate, size * scale, rise * scale);
    }
    index.push(first, first + 1, first + 2, first, first + 2, first + 3);
  };
  for (let i = 0; i < heart; i++) add(Math.sin(i * 2.1) * .03, .1 + i * .13, Math.cos(i * 2.1) * .03, i * .37, 0, .3 - i * .05, 0);
  for (let i = 0; i < licks; i++) {
    const a = i * 2.39, r = .04 + (i % 3) * .045;
    add(Math.cos(a) * r, .16 + (i % 4) * .06, Math.sin(a) * r, (i * .618) % 1, .55 + (i % 5) * .08, .13 + (i % 3) * .035, .55 + (i % 4) * .1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('corner', new BufferAttribute(new Float32Array(corner), 2));
  geometry.setAttribute('wisp', new BufferAttribute(new Float32Array(wisp), 4));
  geometry.setIndex(index);
  // Bounds cover the whole climb and the sprites' reach, not just their anchors.
  geometry.boundingSphere = new Sphere(new Vector3(0, .55 * scale, 0), 1.05 * scale);
  const mesh = new Mesh(geometry, wispMaterial);
  mesh.name = 'wisps';
  return mesh;
}
function flameCrown(parent: Group, scale: number, ring: number, licks: number): void {
  // The campfire's tongues, a second layer turned between them, then a ring of smaller licks round the bowl.
  const tongues: Tongue[] = [
    [1.05, 0, 0, .58, 0xff5a14, 0xffb347, 0], [.78, -.1, .035, .5, 0xff8a22, 0xffd75a, .3], [.74, .11, -.03, .45, 0xff5a14, 0xffb347, -.4],
    [.62, .05, .08, .42, 0xff6a18, 0xffc050, 1.9], [.58, -.06, -.07, .38, 0xff7a1e, 0xffd06a, 3.6], [.5, .09, .06, .34, 0xff5a14, 0xffb347, 5.1],
  ];
  for (let i = 0; i < ring; i++) {
    const a = i / ring * Math.PI * 2 + .4;
    tongues.push([.5 + (i % 2) * .12, Math.cos(a) * .15, Math.sin(a) * .15, .3 + (i % 3) * .06, 0xff4a10, 0xff9a36, a]);
  }
  parent.add(tongueMesh(tongues, scale, tongueMaterial, [.74, .12], 'tongues'));
  parent.add(tongueMesh([[.6, -.02, .01, .4, 0xffb060, 0xfff2c0, .9], [.45, .05, -.04, .3, 0xffa050, 0xffe8b0, 2.1]], scale, coreMaterial, [.7, .1], 'core'));
  parent.add(wispMesh(scale, 3, licks));
}

/** Soft radial glow for the brazier halo (additive; FxSystem turns it to face the viewer). */
const haloTexture = (() => {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.min(1, Math.hypot(x - size / 2 + .5, y - size / 2 + .5) / (size / 2));
    const i = (y * size + x) * 4;
    data[i] = 255; data[i + 1] = 170; data[i + 2] = 90; data[i + 3] = Math.round(255 * (1 - d) ** 2.4);
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
})();
const haloMaterial = new MeshBasicMaterial({ map: haloTexture, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0, fog: false });
haloMaterial.name = 'Brazier halo';
/** Named 'beacon-halo'; FxSystem clones its material per brazier and drives its opacity. */
function halo(size: number, y: number): Mesh {
  const mesh = new Mesh(new PlaneGeometry(size, size), haloMaterial);
  mesh.name = 'beacon-halo';
  mesh.position.y = y;
  mesh.visible = false;
  return mesh;
}

/**
 * Ember glow ramp for the coal lumps (emissive map): U is how hot a spot of a lump burns
 * (0 dark crust, then deep red, orange, and a yellow-hot heart at 1); V is the lump's
 * breathing phase. FxSystem scrolls V so each lump brightens and dims on its own beat.
 */
const emberTexture = (() => {
  const width = 64, height = 16, data = new Uint8Array(width * height * 4);
  const stops: [number, number][] = [[0, 0x000000], [.22, 0x1a0300], [.42, 0x7a1604], [.62, 0xe0480c], [.8, 0xff8a26], [1, 0xffd27a]];
  for (let j = 0; j < height; j++) {
    const breath = .7 + .3 * (.5 + .5 * Math.sin(j / height * Math.PI * 2));
    for (let i = 0; i < width; i++) {
      const u = i / (width - 1);
      let s = 1;
      while (s < stops.length - 1 && stops[s][0] < u) s++;
      const [u0, h0] = stops[s - 1], [u1, h1] = stops[s];
      c.setHex(h0, 'srgb-linear').lerp(c2.setHex(h1, 'srgb-linear'), (u - u0) / (u1 - u0));
      // The hottest spots breathe least: a heart stays lit while the crust edges pulse.
      const k = breath + (1 - breath) * u * u;
      const o = (j * width + i) * 4;
      data[o] = Math.round(c.r * k * 255); data[o + 1] = Math.round(c.g * k * 255); data[o + 2] = Math.round(c.b * k * 255); data[o + 3] = 255;
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
})();
/**
 * Fuel bed that glows when lit: FxSystem clones this per brazier (found by 'coal' in its name),
 * ramps its emissiveIntensity and scrolls the ramp's breathing. Unlit it is plain charcoal.
 */
const coalMaterial = new MeshStandardMaterial({
  vertexColors: true, roughness: 1, flatShading: true, emissive: new Color(0xffffff), emissiveMap: emberTexture, emissiveIntensity: 0,
});
coalMaterial.name = 'Brazier coals';
coalMaterial.userData.emberBreath = true;

type Lump = { x: number; y: number; z: number; size: number; tall: number; yaw: number; hot: boolean };
/**
 * Charcoal lumps as one draw: rounded, lumpy low-poly rocks of varied height (never flat
 * coins), each sitting on `y`. Diffuse stays dark charcoal; the glow lives in UV.x (read
 * through the ember ramp): a hot lump burns through with a yellow heart, the rest keep a dark
 * crust on top with embers glowing along their undersides and in a few cracks.
 */
function coalBed(lumps: Lump[]): Mesh {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [];
  const v = new Vector3();
  lumps.forEach((lump, n) => {
    const g = new IcosahedronGeometry(1, 1).toNonIndexed();
    const p = g.getAttribute('position');
    const seed = n * 1.37 + .4, phase = (n * .618) % 1;
    const glow: number[] = [];
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      // A lump, not a gem: low-frequency bulges, and a flat-ish seat where it rests.
      const bulge = 1 + .16 * Math.sin(v.x * 3.1 + seed) * Math.cos(v.z * 2.7 - seed) + .08 * Math.sin(v.y * 4.3 + seed * 2);
      v.multiplyScalar(bulge);
      v.y = Math.max(v.y, -.55);
      const up = Math.min(1, (v.y + .55) / 1.55);
      const crack = Math.max(0, Math.sin(v.x * 7.3 + v.z * 5.1 + seed * 3) * Math.sin(v.y * 6.1 - v.x * 3.7 + seed)) ** 2;
      glow.push(lump.hot
        ? Math.min(1, .74 + .26 * (1 - up) + .2 * crack)
        : Math.min(.96, .5 * (1 - up) ** 1.6 + .08 + .75 * crack * (1 - up * .6)));
      p.setXYZ(i, v.x * lump.size, (v.y + .55) * lump.size * lump.tall, v.z * lump.size * .86);
    }
    g.rotateY(lump.yaw);
    g.translate(lump.x, lump.y, lump.z);
    g.computeVertexNormals();
    const normal = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      // Dark charcoal, a touch greyer where ash settles on top.
      const ash = Math.max(0, normal.getY(i)) * (lump.hot ? .2 : .6);
      c.setHex(0x221c1a).lerp(c2.setHex(0x3a3431), ash + .15 * Math.sin(seed + i)).toArray(col, col.length);
      uv.push(glow[i], phase);
    }
    g.dispose();
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, coalMaterial);
  mesh.name = 'coals';
  return mesh;
}

/** Stone ring with charcoal; the lit state is the `beacon-flame` child (hidden by default). */
function makeBrazier(): Group {
  const root = new Group();
  const body = new Group();
  const bowlY = .58;
  put(body, bowlGeometry(.42, .26, .03, 0x3a3634, 0x6a4a36), mats.solid, [0, bowlY, 0]);
  put(body, paint(new TorusGeometry(.415, .018, 5, 20), 0x2e2a28, 0), mats.solid, [0, bowlY + .26, 0], [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + .5;
    const top = new Vector3(Math.cos(a) * .3, bowlY + .14, Math.sin(a) * .3), foot = new Vector3(Math.cos(a) * .5, 0, Math.sin(a) * .5);
    span(body, cyl(.02, .026, 1, 6, 0x2e2a28, 0, true), mats.solid, foot, top);
    put(body, paint(new TorusGeometry(.04, .012, 4, 8, Math.PI), 0x2e2a28, 0), mats.solid, [foot.x * 1.06, .035, foot.z * 1.06], [0, -a, 0]);
    for (let r = 0; r < 4; r++) put(body, paint(new OctahedronGeometry(.011, 0), 0x5a4a3e, 0), mats.solid, [Math.cos(a + r * .12 - .2) * .418, bowlY + .23, Math.sin(a + r * .12 - .2) * .418]);
  }
  const stones = new Group();
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + .2, s = .11 + (i % 3) * .025;
    // Warm field-stone tones (the pebble palette): blue-grey faceted stone reads as flint.
    put(stones, paint(new DodecahedronGeometry(1, 0), [0xa08a6c, 0x8c7a62, 0xb09a7a][i % 3], .06), mats.solid, [Math.cos(a) * .62, s * .35, Math.sin(a) * .62], [i, a, 0], [s, s * .7, s * .85]);
  }
  // A dark ash bed that never glows, heaped with charcoal lumps (the coal material glows once lit).
  put(stones, paint(new CylinderGeometry(.33, .3, .02, 12), 0x2e2622, .12), mats.solid, [0, bowlY + .2, 0]);
  body.add(stones);
  const bed: Lump[] = [];
  for (let i = 0; i < 12; i++) {
    const a = i * 2.4, r = (i % 4) * .075, size = .042 + (i % 3) * .01;
    // Heaped toward the middle, every third lump burning through.
    bed.push({ x: Math.cos(a) * r, y: bowlY + .205 + (.225 - r) * .08, z: Math.sin(a) * r, size, tall: .62 + ((i * 7) % 5) * .09, yaw: a + i, hot: i % 3 === 0 });
  }
  baked(root, body, 'brazier').add(coalBed(bed));
  const flame = new Group();
  flame.position.y = bowlY + .21;
  flame.name = 'beacon-flame';
  flame.visible = false;
  flameCrown(flame, 1.15, 4, 5);
  root.add(flame);
  root.add(halo(1.6, bowlY + .55));
  root.name = 'Echo brazier';
  return root;
}
/** Bowl centre height of 'beacon-brazier' above its origin: LANDMARKS.beacon.y = ground + this. */
export const BEACON_BOWL_HEIGHT = 1.1;
/** A flat flame cut from sheet iron: round belly, tip flicked to one side (`flick`, m); base on the origin, in XY. */
function ironFlame(h: number, w: number, flick: number): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(-w * .5, 0);
  shape.bezierCurveTo(-w * .78, h * .3, -w * .4, h * .55, -w * .1 + flick * .3, h * .8);
  shape.quadraticCurveTo(flick * .6, h * .93, flick, h);
  shape.quadraticCurveTo(w * .2 + flick * .3, h * .76, w * .3, h * .56);
  shape.bezierCurveTo(w * .58, h * .36, w * .72, h * .15, w * .5, 0);
  shape.lineTo(-w * .5, 0);
  const g = new ExtrudeGeometry(shape, { depth: .012, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -.006);
  // Warm iron below, ember-hot along the top edge.
  const p = g.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = Math.min(1, Math.max(0, (p.getY(i) / h - .55) / .45));
    c.setHex(0x4a3a32).lerp(c2.setHex(0xc8642a), k * k).toArray(colors, i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}
/**
 * The finale brazier: iron fire-bowl on a stepped stone plinth, its rim crowned with flat
 * iron flame plates; origin at ground centre. Lit, it burns with the campfire's layered
 * tongues at 2.2×, rising wisps and a soft halo (no opaque cones).
 */
function makeBeaconBrazier(): Group {
  const root = new Group();
  const body = new Group();
  // Stepped octagonal plinth.
  put(body, paintByNormal(new CylinderGeometry(.92, 1.02, .24, 8), 0x7f858a, 0x8f959a, .6, .06), mats.solid, [0, .1, 0], [0, .2, 0]);
  put(body, paintByNormal(new CylinderGeometry(.68, .76, .3, 8), 0x8a9095, 0x979ca0, .6, .05), mats.solid, [0, .37, 0], [0, .2 + Math.PI / 8, 0]);
  // A carved band: small flame glyphs inset on the upper tier's faces.
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + .2 + Math.PI / 4;
    put(body, paint(new ConeGeometry(.045, .13, 3), 0x5f6468, 0), mats.solid, [Math.cos(a) * .69, .38, Math.sin(a) * .69], [0, Math.PI / 2 - a, 0], [1, 1, .15]);
  }
  const bowlBase = .84, bowlDepth = .44;
  put(body, cyl(.1, .14, bowlBase - .5, 8, 0x2e2a28, 0), mats.iron, [0, .5 + (bowlBase - .5) / 2, 0]);
  put(body, cyl(.2, .12, .08, 10, 0x3a3634, 0), mats.iron, [0, bowlBase - .02, 0]);
  put(body, bowlGeometry(.58, bowlDepth, .035, 0x34302e, 0x6a4a36), mats.iron, [0, bowlBase, 0]);
  put(body, paint(new TorusGeometry(.575, .025, 5, 24), 0x2a2624, 0), mats.iron, [0, bowlBase + bowlDepth, 0], [Math.PI / 2, 0, 0]);
  // Four curled arms from the pedestal to the bowl belly.
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    span(body, cyl(.018, .022, 1, 5, 0x2e2a28, 0, true), mats.iron, new Vector3(Math.cos(a) * .1, .56, Math.sin(a) * .1), new Vector3(Math.cos(a) * .45, bowlBase + .24, Math.sin(a) * .45));
    put(body, paint(new TorusGeometry(.06, .016, 4, 10, Math.PI * 1.3), 0x2e2a28, 0), mats.iron, [Math.cos(a) * .47, bowlBase + .3, Math.sin(a) * .47], [0, -a, 0]);
  }
  // Rim crown: eight flat flame-shaped plates of warm iron, their top edges ember-hot,
  // leaning gently out from the rim (flames cut from sheet, never hooked claws).
  const rimY = bowlBase + bowlDepth;
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8, tall = i % 2 === 0;
    const plate = put(body, ironFlame(tall ? .17 : .12, tall ? .1 : .075, (i % 4 < 2 ? 1 : -1) * .018), mats.iron,
      [Math.cos(a) * .585, rimY - .025, Math.sin(a) * .585]);
    plate.rotation.order = 'YXZ';
    plate.rotation.set(.22, Math.PI / 2 - a, 0);
  }
  // Charred kindling laid on a dark ash bed, with charcoal heaped between the sticks: only
  // the charcoal glows once lit (the coal material), so the bed reads as embers, not a plate.
  const kindling = new Group();
  put(kindling, paint(new CylinderGeometry(.46, .4, .03, 14), 0x2e2622, .12), mats.solid, [0, bowlBase + .16, 0]);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    span(kindling, cyl(.035, .04, 1, 6, i % 2 ? 0x2a1f19 : 0x3a2a1f, .08, false), mats.solid,
      new Vector3(Math.cos(a) * .36, bowlBase + .17, Math.sin(a) * .36), new Vector3(Math.cos(a + .6) * .05, bowlBase + .42, Math.sin(a + .6) * .05));
  }
  body.add(kindling);
  const bed: Lump[] = [];
  for (let i = 0; i < 18; i++) {
    const a = i * 2.4 + .3, r = .06 + (i % 5) * .07, size = .042 + (i % 3) * .014;
    // Heaped toward the middle between the sticks; a third burn through, the rest glow at the seams.
    bed.push({ x: Math.cos(a) * r, y: bowlBase + .172 + (.34 - r) * .09, z: Math.sin(a) * r, size, tall: .6 + ((i * 7) % 5) * .1, yaw: a * 1.7 + i, hot: i % 3 === 1 });
  }
  baked(root, body, 'beacon').add(coalBed(bed));
  const flame = new Group();
  flame.position.y = bowlBase + .18;
  flame.name = 'beacon-flame';
  flame.visible = false;
  flameCrown(flame, 2.2, 6, 9);
  root.add(flame);
  root.add(halo(3.4, bowlBase + .9));
  root.name = 'Spire beacon brazier';
  return root;
}

// =================================================================================== pines
type PineSpec = {
  tiers: number; tips: number; midRing: boolean; height: number; baseRadius: number; firstTier: number; trunkSides: number;
  /** Close the underside of each tier. Ridge belts are only ever seen from afar and from level or above: skip it. */
  underside?: boolean;
};
/** Procedural stylised pine as ONE vertex-coloured indexed mesh (instancing-friendly). */
function pineGeometry(spec: PineSpec, seed: number): BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const vert = (x: number, y: number, z: number, n: Vector3, color: Color) => {
    pos.push(x, y, z); nor.push(n.x, n.y, n.z); col.push(color.r, color.g, color.b);
    return pos.length / 3 - 1;
  };
  const tri = (a: number, b: number, d: number, outward: Vector3) => {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[d * 3] - ax, vy = pos[d * 3 + 1] - ay, vz = pos[d * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * outward.x + ny * outward.y + nz * outward.z < 0) idx.push(a, d, b); else idx.push(a, b, d);
  };
  const n = new Vector3(), out = new Vector3(), col1 = new Color();
  const jitter = (k: number) => Math.sin(k * 12.9898 + seed * 78.233) * .5 + .5;
  // Trunk (open cylinder), sunk below the origin to hide slope mismatch.
  const ts = spec.trunkSides, trunkTop = spec.firstTier + .5;
  const trunkBase: number[] = [], trunkTopIdx: number[] = [];
  for (let i = 0; i < ts; i++) {
    const a = i / ts * Math.PI * 2;
    n.set(Math.cos(a), 0, Math.sin(a));
    trunkBase.push(vert(Math.cos(a) * .17, -.3, Math.sin(a) * .17, n, col1.setHex(0x4e3524)));
    trunkTopIdx.push(vert(Math.cos(a) * .07, trunkTop, Math.sin(a) * .07, n, col1.setHex(0x6a4a30)));
  }
  for (let i = 0; i < ts; i++) {
    const j = (i + 1) % ts, a = (i + .5) / ts * Math.PI * 2;
    out.set(Math.cos(a), 0, Math.sin(a));
    tri(trunkBase[i], trunkBase[j], trunkTopIdx[i], out);
    tri(trunkBase[j], trunkTopIdx[j], trunkTopIdx[i], out);
  }
  const deep = new Color(0x1c3620), mid = new Color(0x2a522b), tip = new Color(0x467f36), under = new Color(0x172a19);
  const top = spec.height, crownSpan = top - spec.firstTier;
  for (let k = 0; k < spec.tiers; k++) {
    const f = k / (spec.tiers - 1);
    const yBot = spec.firstTier + f * crownSpan * .78;
    const apexY = k === spec.tiers - 1 ? top : yBot + crownSpan * .3 + .15;
    const R = spec.baseRadius * (1 - f * .8);
    const twist = k * 1.9 + seed;
    const light = .92 + f * .16;
    const bend = (x: number, y: number, z: number, down = false) => {
      const r = Math.hypot(x, z) || 1;
      return n.set(x / r * .78, down ? -.35 : .62 - (y - yBot) * .05, z / r * .78).normalize();
    };
    const apex = vert(0, apexY, 0, n.set(0, 1, 0), col1.copy(mid).lerp(tip, .25).multiplyScalar(light));
    const N = spec.tips, rim: number[] = [];
    for (let j = 0; j < N * 2; j++) {
      const a = j / (N * 2) * Math.PI * 2 + twist, isTip = j % 2 === 0;
      const r = R * (isTip ? 1 - jitter(j + k * 7) * .12 : .6);
      const y = yBot - (isTip ? .2 + jitter(j * 3 + k) * .1 : 0);
      col1.copy(isTip ? tip : mid).lerp(deep, isTip ? jitter(j + k) * .25 : .2).multiplyScalar(light * (.95 + jitter(j * 5 + k * 3) * .12));
      rim.push(vert(Math.cos(a) * r, y, Math.sin(a) * r, bend(Math.cos(a), y, Math.sin(a)), col1));
    }
    const centreUnder = vert(0, yBot + .3, 0, n.set(0, -1, 0), under);
    if (spec.midRing) {
      const midIdx: number[] = [];
      for (let j = 0; j < N; j++) {
        const a = (j * 2) / (N * 2) * Math.PI * 2 + twist, r = R * .5, y = yBot + (apexY - yBot) * .5 + .06;
        midIdx.push(vert(Math.cos(a) * r, y, Math.sin(a) * r, bend(Math.cos(a), y, Math.sin(a)), col1.copy(mid).multiplyScalar(light)));
      }
      for (let j = 0; j < N; j++) {
        const j2 = (j + 1) % N, a = (j + .5) / N * Math.PI * 2 + twist;
        out.set(Math.cos(a), .8, Math.sin(a));
        tri(apex, midIdx[j], midIdx[j2], out);
        tri(midIdx[j], rim[j * 2], rim[j * 2 + 1], out);
        tri(midIdx[j], rim[j * 2 + 1], midIdx[j2], out);
        tri(midIdx[j2], rim[j * 2 + 1], rim[(j * 2 + 2) % (N * 2)], out);
      }
    } else {
      for (let j = 0; j < N * 2; j++) {
        const a = (j + .5) / (N * 2) * Math.PI * 2 + twist;
        out.set(Math.cos(a), .8, Math.sin(a));
        tri(apex, rim[j], rim[(j + 1) % (N * 2)], out);
      }
    }
    if (spec.underside !== false) for (let j = 0; j < N * 2; j++) tri(centreUnder, rim[j], rim[(j + 1) % (N * 2)], out.set(0, -1, 0));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
function pineMesh(name: string, geometry: BufferGeometry): Mesh {
  const mesh = new Mesh(geometry, mats.solid);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

// ============================================================================ bounds walls
/** Tall invisible wall ring on WORLD_BOUNDS: indexed position+normal, for LocomotionEnvironment. */
function makeBounds(): Group {
  const { minX, maxX, minZ, maxZ } = WORLD_BOUNDS;
  const corners: [number, number][] = [[minX, maxZ], [maxX, maxZ], [maxX, minZ], [minX, minZ], [minX, maxZ]];
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let s = 0; s < 4; s++) {
    const [ax, az] = corners[s], [bx, bz] = corners[s + 1];
    const len = Math.hypot(bx - ax, bz - az), steps = Math.ceil(len / 2);
    // Inward normal (toward the valley centre).
    const nx = -(bz - az) / len, nz = (bx - ax) / len;
    const start = pos.length / 3;
    for (let i = 0; i <= steps; i++) {
      const x = ax + (bx - ax) * i / steps, z = az + (bz - az) * i / steps, h = terrainHeight(x, z);
      pos.push(x, h - 3, z, x, h + 9, z);
      nor.push(nx, 0, nz, nx, 0, nz);
    }
    for (let i = 0; i < steps; i++) {
      const a = start + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const mesh = new Mesh(g, mats.solid);
  mesh.name = 'Boundary wall ring';
  mesh.visible = false;
  // The scene node's visibility applies to the asset root, so the hidden mesh sits in a group.
  const root = new Group();
  root.name = 'Valley boundary walls (invisible, LocomotionEnvironment)';
  root.add(mesh);
  return root;
}

// ============================================================================ canvas scrap
/** Torn tent canvas pinned by a stone: the renewable cloth node. Origin at ground centre; `canvas` hides when taken. */
function makeCanvasScrap(): Group {
  const root = new Group();
  const base = new Group();
  put(base, paint(new DodecahedronGeometry(1, 0), 0x8f959a, .06), mats.foliage, [-.18, .07, -.12], [.3, .8, .1], [.2, .12, .16]);
  put(base, cyl(.018, .024, .42, 5, 0x7a5236), mats.foliage, [.26, .16, -.2], [.25, 0, -.2]);
  // A shred of canvas still knotted to the stake.
  const tail = new PlaneGeometry(.12, .3, 1, 3);
  const tp = tail.getAttribute('position');
  for (let i = 0; i < tp.count; i++) tp.setXYZ(i, tp.getX(i) * (1 - (tp.getY(i) + .15) * 1.4) + .03 * Math.sin(tp.getY(i) * 12), tp.getY(i), .04 * Math.sin(tp.getY(i) * 7));
  tail.computeVertexNormals();
  put(base, paint(tail, 0xc2ae84, .08), mats.foliage, [.3, .2, -.18], [0, .6, .5]);
  put(base, paint(new TorusGeometry(.028, .008, 4, 8), 0xb8a27a, 0), mats.foliage, [.27, .3, -.2], [Math.PI / 2, 0, 0]);
  // The torn tent sheet draped over the stone is the SOURCE; the folded cloth waiting at
  // the origin (the 'cloth' item) is what you take.
  const sheet = new PlaneGeometry(.7, .55, 6, 5);
  const sp = sheet.getAttribute('position');
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i), dx = x + .18, dz = -y - .1;
    const over = Math.max(0, .16 - Math.hypot(dx, dz) * .55);
    const torn = y > .22 ? -.06 * Math.abs(Math.sin(x * 29)) : 0;
    sp.setXYZ(i, x, y + torn, .012 + over + .015 * Math.sin(x * 9 + y * 7));
  }
  sheet.rotateX(-Math.PI / 2);
  sheet.computeVertexNormals();
  put(base, paint(sheet, 0xd2bf95, .08), mats.foliage, [-.12, .005, -.1], [0, .3, 0]);
  baked(root, base, 'base');
  root.name = 'Canvas scrap';
  return root;
}

// ============================================================================== night sky
/** Skip the draw entirely while a fading material is fully transparent (daytime sky costs no draws). */
function hideWhenClear<T extends PointsMaterial | MeshBasicMaterial>(material: T): T {
  let opacity = material.opacity;
  Object.defineProperty(material, 'opacity', {
    get: () => opacity,
    set: (value: number) => { opacity = value; material.visible = value > .002; },
    configurable: true,
  });
  material.visible = opacity > .002;
  return material;
}
/** Draw a far element at the far plane: always behind the valley, never clipped by camera.far. */
function atFarPlane<T extends PointsMaterial | MeshBasicMaterial>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n\tgl_Position.z = gl_Position.w * .99999;');
  };
  return material;
}
/**
 * Star field and moon, both starting fully transparent. DayNightSystem finds the materials by
 * name ('Night stars', 'Moon') and sets their opacity from nightness. The moon sits along the
 * direction the moonlight comes from (azimuth 2.4 rad, elevation .95 rad).
 */
export const MOON_DIRECTION = { azimuth: 2.4, elevation: .95 } as const;
function makeNightSky(): Group {
  const root = new Group();
  root.name = 'Night sky';
  const count = 600, radius = 120, pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < count; i++) {
    const h = Math.sin(.1) + rand() * (1 - Math.sin(.1)), a = rand() * Math.PI * 2, r = Math.sqrt(1 - h * h);
    pos[i * 3] = Math.cos(a) * r * radius; pos[i * 3 + 1] = h * radius; pos[i * 3 + 2] = Math.sin(a) * r * radius;
    const b = .45 + .55 * rand() ** 2.2, warm = rand();
    c.setRGB(b * (warm > .85 ? 1 : .86), b * (warm > .85 ? .92 : .9), b).toArray(col, i * 3);
  }
  const stars = new BufferGeometry();
  stars.setAttribute('position', new BufferAttribute(pos, 3));
  stars.setAttribute('color', new BufferAttribute(col, 3));
  stars.computeBoundingSphere();
  const starMaterial = hideWhenClear(atFarPlane(new PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false })));
  starMaterial.name = 'Night stars';
  const points = new Points(stars, starMaterial);
  points.name = 'stars';
  points.frustumCulled = false;
  root.add(points);
  // Moon: bright disc with soft maria and a faint halo that fades out (vertex alpha), facing the valley.
  const moonGeo = new BufferGeometry();
  const ring = 40, mp: number[] = [0, 0, 0], mc: number[] = [.93, .95, .98, 1], mi: number[] = [];
  for (let k = 0; k <= ring; k++) {
    const a = k / ring * Math.PI * 2;
    for (const [r, alpha, z] of [[2.8, 1, 0], [3.1, .3, -.02], [6, 0, -.05]] as const) {
      mp.push(Math.cos(a) * r, Math.sin(a) * r, z);
      const maria = r < 3 ? .1 * Math.max(0, Math.sin(a * 3 + 1)) : 0;
      c.setHex(r < 3 ? 0xe6ebf6 : 0xcfd8ee).lerp(c2.setHex(0xb8c2d6), maria);
      mc.push(c.r, c.g, c.b, alpha);
    }
  }
  for (let k = 0; k < ring; k++) {
    const a = 1 + k * 3, b = 1 + (k + 1) * 3;
    mi.push(0, a, b, a, a + 1, b, b, a + 1, b + 1, a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
  }
  moonGeo.setAttribute('position', new BufferAttribute(new Float32Array(mp), 3));
  moonGeo.setAttribute('color', new BufferAttribute(new Float32Array(mc), 4));
  moonGeo.setIndex(mi);
  moonGeo.computeBoundingSphere();
  const moonMaterial = hideWhenClear(new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  moonMaterial.name = 'Moon';
  const moon = new Mesh(moonGeo, moonMaterial);
  moon.name = 'moon';
  const { azimuth, elevation } = MOON_DIRECTION;
  moon.position.set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth)).multiplyScalar(110);
  moon.lookAt(0, 0, 0);
  root.add(moon);
  return root;
}

// ============================================================================ ending smoke
/** Smoke column (10–14 m) with an ember glow at its base: "a campfire you never lit". Origin on the ground. */
function makeEndingSmoke(): Group {
  const smokeMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1, emissive: new Color(0x3a3632), emissiveIntensity: .35 });
  smokeMat.name = 'Ending smoke';
  const emberMat = new MeshStandardMaterial({ color: 0xffa048, emissive: new Color(0xff6a1a), emissiveIntensity: 2.4, roughness: 1 });
  emberMat.name = 'Ending ember';
  const src = new Group();
  for (let i = 0; i < 15; i++) {
    const t = i / 14, y = .9 + t * 12.2 + Math.sin(i * 1.7) * .3;
    const drift = t * t * 2.6, r = .7 + t * 1.9 + (i % 3) * .2;
    const puff = paint(new IcosahedronGeometry(1, 1), 0x6d6a66, 0);
    const pc = puff.getAttribute('color');
    c.setHex(0x6d6a66).lerp(c2.setHex(0xc4c2be), t);
    for (let k = 0; k < pc.count; k++) pc.setXYZ(k, c.r, c.g, c.b);
    put(src, puff, smokeMat, [drift + Math.sin(i * 2.3) * .35, y, Math.cos(i * 1.9) * .3], [i, i * .7, 0], [r, r * .78, r * .9]);
  }
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    put(src, paint(new DodecahedronGeometry(1, 0), 0x6f767c, .06), mats.solid, [Math.cos(a) * .55, .08, Math.sin(a) * .55], [i, a, 0], [.16, .1, .13]);
    if (i < 4) put(src, cyl(.05, .06, .8, 6, 0x3b2a1e, .04), mats.solid, [Math.cos(a) * .12, .14, Math.sin(a) * .12], [0, a, Math.PI / 2 - .35]);
  }
  for (let i = 0; i < 5; i++) put(src, new ConeGeometry(.12 + (i % 2) * .05, .45 + (i % 3) * .15, 6), emberMat, [Math.cos(i * 2.4) * .12, .32, Math.sin(i * 2.4) * .12], [0, i, (i % 2 ? .15 : -.12)]);
  for (let i = 0; i < 8; i++) put(src, new DodecahedronGeometry(1, 0), emberMat, [Math.cos(i * 2.4) * (i % 3) * .1, .1, Math.sin(i * 2.4) * (i % 3) * .1], [i, i, 0], [.07, .04, .06]);
  const root = batchStatic(src);
  root.name = 'Ending smoke';
  return root;
}

export const deadwood = makeDeadwood();
export const resinScar = makeResinScar();
export const mushroomPatch = makeMushroomPatch();
export const berryBush = makeBerryBush();
export const herbPatch = makeHerbPatch();
export const reedClump = makeReedClump();
export const flintBed = makeFlintBed();
export const brazier = makeBrazier();
export const beaconBrazier = makeBeaconBrazier();
/** ~190-triangle mid-poly pine for valley stands (instanced patterns). */
export const valleyPine = pineMesh('Valley pine', pineGeometry({ tiers: 5, tips: 6, midRing: true, height: 5.6, baseRadius: 1.6, firstTier: 1.0, trunkSides: 6 }, 3));
/** ~44-triangle far pine for ridge belts (instanced patterns; no undersides). */
export const farPine = pineMesh('Far pine', pineGeometry({ tiers: 3, tips: 6, midRing: false, height: 5.8, baseRadius: 1.7, firstTier: .9, trunkSides: 4, underside: false }, 7));
export const valleyBounds = makeBounds();
export const canvasScrap = makeCanvasScrap();
export const nightSky = makeNightSky();
export const endingSmoke = makeEndingSmoke();
/** Taller, slimmer second silhouette for valley stands: plain stacked cones (~156 triangles). */
export const valleyPineTall = pineMesh('Valley pine (tall)', pineGeometry({ tiers: 6, tips: 6, midRing: false, height: 6.5, baseRadius: 1.35, firstTier: 1.15, trunkSides: 6 }, 9));
