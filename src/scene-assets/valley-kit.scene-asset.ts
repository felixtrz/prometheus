/**
 * Shared kit for the valley build: a handful of vertex-coloured materials (so each
 * static region batches to ~3 draws), small dressing builders in the camp's visual
 * language, and the registry of baked contact shadows the ground paints.
 */
import {
  BufferAttribute, BufferGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Group,
  IcosahedronGeometry, Mesh, MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, Shape, ShapeGeometry, Vector3,
} from '@iwsdk/core';
import type { Material, Object3D } from '@iwsdk/core';
import { mossyRockGeometry } from './mossy-rock.js';
import { woodTexture } from './procedural-textures.js';
import { paint } from './static-batch.js';
import { noise, terrainHeight } from '../game/terrain.js';

export { paint };
const named = <T extends Material>(material: T, name: string) => ((material.name = name), material);

/** One vertex-coloured family per surface response; everything else is paint. */
export const mats = {
  solid: named(new MeshStandardMaterial({ vertexColors: true, roughness: 1 }), 'Valley painted solids'),
  foliage: named(new MeshStandardMaterial({ vertexColors: true, roughness: 1, side: DoubleSide }), 'Valley grass, leaves and cloth'),
  bark: named(new MeshStandardMaterial({ vertexColors: true, roughness: .95, map: woodTexture({ bark: true }) }), 'Valley bark and logs'),
  /** Sawn, planed lumber (crates, tables, decks) with straight grain along U. */
  timber: named(new MeshStandardMaterial({ vertexColors: true, roughness: .9, map: woodTexture({ alongU: true }) }), 'Valley sawn timber'),
  iron: named(new MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .35 }), 'Valley iron'),
  water: named(new MeshStandardMaterial({ vertexColors: true, roughness: .16, metalness: .05, envMapIntensity: 1.1 }), 'Brook water'),
  amber: named(new MeshStandardMaterial({ vertexColors: true, roughness: .22, emissive: new Color(0x5a2a00), emissiveIntensity: .35 }), 'Resin amber'),
  cloud: named(new MeshStandardMaterial({ color: 0xf2f5f8, roughness: 1, emissive: new Color(0xc8d4e0), emissiveIntensity: .7, envMapIntensity: .2 }), 'Clouds'),
};

// ---------------------------------------------------------------------- placement
export type V3 = [number, number, number];
export function put(parent: Object3D, geometry: BufferGeometry, material: Material, at: V3, rotation: V3 = [0, 0, 0], scale: V3 | number = 1): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...at);
  mesh.rotation.set(...rotation);
  if (typeof scale === 'number') mesh.scale.setScalar(scale); else mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}
/** Align a mesh's local +Y from `a` to `b` (for branches, poles, braces, ropes). */
export function span(parent: Object3D, geometry: BufferGeometry, material: Material, a: Vector3, b: Vector3): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.scale.set(1, a.distanceTo(b), 1);
  parent.add(mesh);
  return mesh;
}
export const ground = terrainHeight;

/** Expedition flame emblem outline (teardrop with two side tongues), centred on its base. */
export function flameShape(size: number): Shape {
  const s = new Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(size * .55, 0, size * .62, size * .5, size * .3, size * .95);
  s.bezierCurveTo(size * .35, size * .62, size * .12, size * .55, size * .08, size * .72);
  s.bezierCurveTo(size * .05, size * 1.05, -size * .05, size * 1.2, 0, size * 1.5);
  s.bezierCurveTo(-size * .3, size * 1.05, -size * .2, size * .75, -size * .3, size * .6);
  s.bezierCurveTo(-size * .42, size * .7, -size * .45, size * .85, -size * .38, size * .98);
  s.bezierCurveTo(-size * .7, size * .55, -size * .55, 0, 0, 0);
  return s;
}

// ---------------------------------------------------------------------- colliders
/** Invisible locomotion blockers: vertical cylinders (trunks, boulders) and boxes (structures). */
export type Collider = { type: 'cyl'; x: number; z: number; r: number } | { type: 'box'; x: number; z: number; hx: number; hz: number; yawDeg: number };
export const colliders: Collider[] = [];

// ------------------------------------------------------------------------ shadows
export type Shade = { x: number; z: number; rx: number; rz: number; opacity: number; cos: number; sin: number };
/** Baked soft contact shadows, painted into the ground's vertex colours. */
export const shades: Shade[] = [];
/** `height` offsets the blob away from the sun (sun from the south-west); `yawDeg` matches a node's Y rotation. */
export function shadow(x: number, z: number, rx: number, rz: number, opacity: number, height = 0, yawDeg = 0) {
  const yaw = yawDeg * Math.PI / 180;
  shades.push({ x: x + height * .318, z: z - height * .5, rx, rz, opacity, cos: Math.cos(yaw), sin: Math.sin(yaw) });
}
export function treeShadow(x: number, z: number, h: number, radius: number) {
  shadow(x, z, radius * 1.45, radius * 1.45, .35, h * .5);
  shadow(x, z, h * .06 + radius * .4, h * .06 + radius * .4, .36);
}

// ------------------------------------------------------------------------ geometry
/** Shared, painted geometry variants (created once; batching copies them). */
const bladeBase = new PlaneGeometry(.11, .5, 1, 2);
{
  const p = bladeBase.getAttribute('position'), n = bladeBase.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + .25, t = y / .5;
    p.setXYZ(i, p.getX(i) * (1 - t * .92), y, t * t * .18);
    n.setXYZ(i, 0, .75, .66);
  }
}
/** One-segment blade (2 triangles, tip still leaning out) for tufts seen from a few metres off. */
const bladeFar = new PlaneGeometry(.11, .5, 1, 1);
{
  const p = bladeFar.getAttribute('position'), n = bladeFar.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + .25, t = y / .5;
    p.setXYZ(i, p.getX(i) * (1 - t * .92), y * .97, t * .16);
    n.setXYZ(i, 0, .75, .66);
  }
}
export const GRASS = { olive: 0x6fa03a, lime: 0x8dbb44, deep: 0x5b8a33, meadow: 0x9cc64a, dry: 0xa9b456, forest: 0x4f7d30 };
const bladeCache = new Map<number, BufferGeometry>();
const bladeFarCache = new Map<number, BufferGeometry>();
/** A curved, two-segment grass blade (camp tufts, seen up close). */
export function blade(color: number): BufferGeometry {
  let g = bladeCache.get(color);
  if (!g) bladeCache.set(color, g = paint(bladeBase.clone(), color, .06));
  return g;
}
function farBlade(color: number): BufferGeometry {
  let g = bladeFarCache.get(color);
  if (!g) bladeFarCache.set(color, g = paint(bladeFar.clone(), color, .06));
  return g;
}
const bloomCache = new Map<number, BufferGeometry>();
function bloom(color: number) {
  let g = bloomCache.get(color);
  if (!g) bloomCache.set(color, g = paint(new OctahedronGeometry(.045, 0), color, 0));
  return g;
}
const stem = paint(new PlaneGeometry(.012, .3), 0x5b8a33, 0);
export const FLOWERS = { buttercup: 0xf2d54a, daisy: 0xf6f2e6, pink: 0xe8a7c8, violet: 0x9d86d8, orange: 0xf0a040 };

/** Grass tuft after the camp's broad-blade clumps; optional flower heads. Valley tufts use one-segment blades. */
export function tuft(parent: Object3D, x: number, z: number, scale: number, colors: number[], flower: number | null = null, y = ground(x, z)) {
  return tuftOf(farBlade, parent, x, z, scale, colors, flower, y);
}
/** A camp tuft: curved two-segment blades, for the clearing you stand in. */
export function campTuft(parent: Object3D, x: number, z: number, scale: number, colors: number[], flower: number | null = null, y = ground(x, z)) {
  return tuftOf(blade, parent, x, z, scale, colors, flower, y);
}
function tuftOf(shape: (color: number) => BufferGeometry, parent: Object3D, x: number, z: number, scale: number, colors: number[], flower: number | null, y: number) {
  const group = new Group();
  const count = 5 + (Math.abs(Math.round(x * 7 + z * 3)) % 3);
  for (let i = 0; i < count; i++) {
    const angle = i / count * Math.PI * 2 + x;
    const m = put(group, shape(colors[Math.abs(i + Math.round(z * 3)) % colors.length]), mats.foliage, [Math.sin(angle) * .03, 0, Math.cos(angle) * .03], [-.55 - (i % 2) * .2, angle, 0]);
    m.scale.set(1 + (i % 3) * .15, .85 + (i % 2) * .3, 1);
  }
  if (flower !== null) for (let i = 0; i < 3; i++) {
    const fx = Math.cos(i * 2.1 + x) * .07, fz = Math.sin(i * 2.1 + x) * .07, h = .26 + (i % 2) * .06;
    put(group, stem, mats.foliage, [fx, h / 2, fz], [0, i * 1.1, 0], [1, h / .3, 1]);
    put(group, bloom(flower), mats.solid, [fx, h + .01, fz], [0, i, 0], [1, .55, 1]);
  }
  group.position.set(x, y, z);
  group.scale.setScalar(scale);
  parent.add(group);
  shadow(x, z, .24 * scale, .2 * scale, .16);
  return group;
}

const rockShapes = [mossyRockGeometry(1.3), mossyRockGeometry(5.7), mossyRockGeometry(3.1), mossyRockGeometry(8.4)];
const flatRocks = [mossyRockGeometry(2.2, 1, .3), mossyRockGeometry(6.6, 1, .35)];
/** Moss-capped faceted boulder bedded into the terrain (`h` ≈ visible height). */
export function boulder(parent: Object3D, x: number, z: number, h: number, yaw: number, stretch = 1, shadowOpacity = .28) {
  const sy = h * .6, r = h * .7 * stretch;
  if (h >= .8) colliders.push({ type: 'cyl', x, z, r: h * .62 * Math.max(1, stretch * .9) });
  // Bed into the lowest point of the footprint so big rocks never float on slopes.
  let base = ground(x, z);
  for (let k = 0; k < 6; k++) base = Math.min(base, ground(x + Math.cos(k * 1.05) * r, z + Math.sin(k * 1.05) * r * .8));
  const m = put(parent, rockShapes[Math.abs(Math.round(yaw * 3 + x)) % rockShapes.length], mats.solid,
    [x, base + .35 * sy - .04 - h * .05, z], [.04, yaw, .06], [h * .95 * stretch, sy, h * .72]);
  if (shadowOpacity > 0) shadow(x, z, h * 1.25 * stretch, h * 1.05, shadowOpacity, h * .3);
  return m;
}
/** Flat-topped rock whose top surface sits at `top` above the local ground (page ledges). */
export function ledgeRock(parent: Object3D, x: number, z: number, top: number, width: number, yaw: number) {
  // mossyRockGeometry(…, plateau .3): unit top at y≈.3·lump, base at −.35 → height ≈ .65 units.
  const sy = top / .64;
  const m = put(parent, flatRocks[Math.abs(Math.round(x)) % 2], mats.solid, [x, ground(x, z) + .35 * sy - .02, z], [0, yaw, 0], [width, sy, width * .8]);
  shadow(x, z, width * 1.3, width * 1.1, .3, top * .4);
  return m;
}
/**
 * The same flat-topped rock as a standalone prop (origin on the ground; the scene node
 * carries position and yaw). Used for the page ledges, which are ItemSurface props.
 */
export function ledgeRockProp(parent: Object3D, top: number, width: number, variant: number) {
  const sy = top / .64;
  return put(parent, flatRocks[Math.abs(variant) % 2], mats.solid, [0, .35 * sy - .02, 0], [0, 0, 0], [width, sy, width * .8]);
}
/** Warm sandstone tones: grey-blue faceted chips read as flint (a grabbable item). */
const pebbleGeo = [0xa08a6c, 0x8c7a62, 0xb09a7a].map((color) => paint(new IcosahedronGeometry(1, 0), color, .05));
/**
 * A half-buried field stone. Loose-looking chips under ~9 cm are dropped outright and the
 * rest are at least 12 cm across, so no ground stone can pass for a flint nodule.
 */
export function pebble(parent: Object3D, x: number, z: number, size: number, yaw: number, variant = 0, flat = .45): Mesh | undefined {
  if (size < .09) return undefined;
  const s = Math.max(.12, size);
  return put(parent, pebbleGeo[variant % 3], mats.solid, [x, ground(x, z) - s * flat * .12, z], [0, yaw, 0], [s, s * flat, s * .8]);
}
/** Worn flat stepping stone set into a trail. */
export function steppingStone(parent: Object3D, x: number, z: number, size: number, yaw: number, variant = 0) {
  return put(parent, pebbleGeo[variant % 2], mats.solid, [x, ground(x, z) + .012, z], [0, yaw, 0], [size, .03, size * .8]);
}

/**
 * Ground litter must never read as a twig or stick (sticks are grabbable items): fallen
 * leaves are small pointed ovals in autumn tones, needle litter is a round, ragged mat.
 */
const leafShape = (() => {
  const shape = new Shape();
  shape.moveTo(-.05, 0);
  shape.quadraticCurveTo(-.01, .034, .05, 0);
  shape.quadraticCurveTo(-.01, -.034, -.05, 0);
  return shape;
})();
const leafGeos = [0xb0782e, 0x9a8a3c, 0xc0923e].map((color) => paint(new ShapeGeometry(leafShape, 3), color, .06).rotateX(-Math.PI / 2));
const needleGeo = (() => {
  const g = new CircleGeometry(.13, 9);
  const p = g.getAttribute('position');
  for (let i = 1; i < p.count; i++) {
    const k = .72 + .28 * Math.abs(Math.sin(i * 2.7));
    p.setXY(i, p.getX(i) * k, p.getY(i) * k);
  }
  return paint(g, 0x7a5c3a, .1).rotateX(-Math.PI / 2);
})();
export function litter(parent: Object3D, x: number, z: number, yaw: number, needles = false, scale = 1) {
  const s = needles ? scale : scale * .8;
  const geometry = needles ? needleGeo : leafGeos[Math.abs(Math.round(x * 3 + z * 7)) % leafGeos.length];
  return put(parent, geometry, mats.foliage, [x, ground(x, z) + .01, z], [0, yaw, 0], [s * (1 + Math.abs(noise(x, z)) * .2), 1, s]);
}

/** Fern: arched fronds of leaflets (double-sided), rooted at the ground. */
const frondGeo = (() => {
  const g = new PlaneGeometry(.2, .62, 1, 5);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + .31, t = y / .62;
    // Taper to a tip, deeply serrate the edge into leaflets, arch outward and down.
    const w = Math.sin(Math.min(1, t * 1.1) * Math.PI) * (.6 + .7 * Math.abs(Math.sin(t * 19)));
    p.setXYZ(i, p.getX(i) * w, y * (1 - t * .25), t * t * .34);
  }
  g.computeVertexNormals();
  return g;
})();
const frondColors = [paint(frondGeo.clone(), 0x4f8a32, .1), paint(frondGeo.clone(), 0x5f9a3a, .1), paint(frondGeo.clone(), 0x3f7a2c, .1)];
export function fern(parent: Object3D, x: number, z: number, scale: number, seed: number) {
  const group = new Group();
  const count = 7 + (seed % 3);
  for (let i = 0; i < count; i++) {
    const a = i / count * Math.PI * 2 + seed;
    const m = put(group, frondColors[(i + seed) % 3], mats.foliage, [0, 0, 0]);
    m.rotation.order = 'YXZ';
    m.rotation.set(.75 + (i % 3) * .18, a, 0);
    m.scale.setScalar(.85 + (i % 3) * .15);
  }
  group.position.set(x, ground(x, z), z);
  group.scale.setScalar(scale);
  parent.add(group);
  shadow(x, z, .45 * scale, .45 * scale, .22);
}

/** Moss mound: a flattened lumpy dome, painted deep green. */
const mossGeo = paint(new IcosahedronGeometry(1, 1), 0x5d8a34, .12);
export function mossMound(parent: Object3D, x: number, z: number, r: number, yaw: number) {
  return put(parent, mossGeo, mats.solid, [x, ground(x, z) - r * .12, z], [0, yaw, 0], [r, r * .28, r * .8]);
}

/** Tapered root or branch between two points (bark). */
export function root(parent: Object3D, a: Vector3, b: Vector3, r0: number, r1: number, color = 0x6b4830, material: Material = mats.bark) {
  return span(parent, paint(new CylinderGeometry(r1, r0, 1, 6, 1, true), color, .05), material, a, b);
}

/** Deciduous broadleaf tree after the camp's (trunk, three branches, clustered crowns). */
/** Crowns shade by facing so they separate from the meadow grass: sunlit tops, mid sides, deep undersides. */
const crownGeo = ([[0xb4d65c, 0x6d9a35, 0x4a6f2a], [0xa6cc52, 0x62902f, 0x43672a], [0xbddc66, 0x76a23a, 0x4f742c]] as const).map(([top, side, under]) => {
  const g = new IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position'), colors = new Float32Array(p.count * 3), c = new Color(), c2 = new Color();
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > 0) c.setHex(side).lerp(c2.setHex(top), Math.min(1, y * 1.3)); else c.setHex(side).lerp(c2.setHex(under), Math.min(1, -y * 1.4));
    c.multiplyScalar(1 + .05 * Math.sin(p.getX(i) * 7 + p.getZ(i) * 5));
    c.toArray(colors, i * 3);
  }
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
});
export function broadleaf(parent: Object3D, x: number, z: number, h: number, yaw: number, variant: number) {
  const tree = new Group();
  const trunkHeight = h * .5;
  put(tree, paint(new CylinderGeometry(h * .04, h * .066, trunkHeight, 7), 0x8a5f3a, .05), mats.bark, [0, trunkHeight * .5, 0]);
  for (let i = 0; i < 3; i++) {
    const angle = yaw + i * 2.1;
    root(tree, new Vector3(0, trunkHeight * (.55 + i * .15), 0), new Vector3(Math.cos(angle) * h * .22, trunkHeight + h * .12, Math.sin(angle) * h * .22), h * .022, h * .013, 0x6b4830);
  }
  [[0, .70, 0, .34], [-.26, .58, .12, .26], [.27, .60, -.1, .27], [.05, .56, .28, .24], [-.06, .58, -.27, .23], [-.14, .82, -.04, .22], [.18, .80, .08, .21]].forEach(([bx, by, bz, br], i) => {
    put(tree, crownGeo[(i + variant) % 3], mats.solid, [bx * h, by * h, bz * h], [i * .7, i * 1.3, i * .4], br * h);
  });
  tree.position.set(x, ground(x, z) - .05, z);
  tree.rotation.y = yaw;
  parent.add(tree);
  treeShadow(x, z, h, h * .36);
  colliders.push({ type: 'cyl', x, z, r: h * .066 + .06 });
}

/** Low leafy shrub: a few lumpy crowns (optionally flowering). */
const shrubGeo = [0x5f8f34, 0x6f9f3a, 0x4f7f2e].map((c) => paint(new IcosahedronGeometry(1, 1), c, .1));
export function shrub(parent: Object3D, x: number, z: number, r: number, yaw: number) {
  const g = new Group();
  [[0, .55, 0, 1], [.55, .4, .2, .72], [-.5, .42, -.15, .75], [.1, .38, -.55, .68]].forEach(([bx, by, bz, s], i) => {
    put(g, shrubGeo[i % 3], mats.solid, [bx * r, by * r, bz * r], [i, i * 2, 0], [s * r * .85, s * r * .7, s * r * .85]);
  });
  g.position.set(x, ground(x, z) - .04, z);
  g.rotation.y = yaw;
  parent.add(g);
  shadow(x, z, r * 1.3, r * 1.2, .3, r * .5);
}

/** Painted mountain massif (cone with wobbled, flared flanks). */
export function mountain(parent: Object3D, x: number, y: number, z: number, width: number, height: number, depth: number, color: number, snow: number, yaw: number) {
  const geometry = new ConeGeometry(1, 1, 16, 6);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const base = new Color(color), cap = new Color(0xe8eef2), rock = new Color(color).multiplyScalar(.82), c = new Color();
  for (let i = 0; i < positions.count; i++) {
    const px = positions.getX(i), py = positions.getY(i) + .5, pz = positions.getZ(i), angle = Math.atan2(pz, px);
    const wobble = 1 + .1 * Math.sin(angle * 3 + x) + .06 * Math.sin(angle * 7 + z) + .035 * Math.sin(angle * 13 + py * 9 + x);
    const flare = (1 + (1 - py) * .3) * (1 + .9 * py * (1 - py));
    positions.setXYZ(i, px * wobble * flare, py - .5 + .012 * Math.sin(angle * 11 + py * 17), pz * wobble * flare);
    c.copy(base).lerp(rock, .5 + .5 * Math.sin(angle * 5 + py * 6));
    if (py > 1 - snow + .05 * Math.sin(angle * 9)) c.copy(cap);
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  put(parent, geometry, mats.solid, [x, y + height * .5 - .3, z], [0, yaw, 0], [width, height, depth]);
}
