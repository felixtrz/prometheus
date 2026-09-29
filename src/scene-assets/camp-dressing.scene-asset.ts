/**
 * Camp dressing restored from design/source/environment.glts, trimmed for a calm first
 * view: the bedroll, the chopping stump (the grabbable axe is placed in it by the scene)
 * and the journal notice board with the camp lantern. Static, non-interactive, batched per
 * material. Nothing here may look like a grabbable item (no loose sticks, logs or cups).
 */
import {
  BoxGeometry, CircleGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, TorusGeometry,
} from '@iwsdk/core';
import type { BufferGeometry, Material } from '@iwsdk/core';
import { woodTexture } from './procedural-textures.js';
import { batchStatic, paint, unify } from './static-batch.js';

type Vec3 = [number, number, number];

/**
 * Scene placements, mirrored by public/scenes/main.iwsdk.scene.json. The woodland
 * bakes contact shadows from these, so move both together. The stump also matches
 * the 'stump' surface in src/game/rules.ts.
 */
export const dressingPlacements = {
  bedroll: { x: -1.55, z: -3.05, yawDeg: 57.4 },
  stump: { x: 2.7, z: -3.25, yawDeg: -20 },
} as const;

const named = (material: Material, name: string) => ((material.name = name), material);
const soft = named(new MeshStandardMaterial({ vertexColors: true, roughness: .94 }), 'Camp cloth and cut wood');
const timber = named(new MeshStandardMaterial({ vertexColors: true, map: woodTexture({ bark: true }), roughness: .95, flatShading: true }), 'Camp bark');
const metal = named(new MeshStandardMaterial({ vertexColors: true, roughness: .58, metalness: .2, flatShading: true }), 'Camp iron and brass');
// Opaque unlit glass reads as a lit lantern without a light or transparency sorting.
// FxSystem finds it by name and keeps it cold until the first fire is lit.
const glow = named(new MeshBasicMaterial({ color: 0xffc46a }), 'Lantern glow');

function add(parent: Group, geometry: BufferGeometry, material: Material, at: Vec3, rotation: Vec3 = [0, 0, 0]): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...at);
  mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}
const box = (size: Vec3, color: number, variation = .04) => paint(new BoxGeometry(...size), color, variation);
const cyl = (top: number, bottom: number, height: number, segments: number, color: number, variation = .04) =>
  paint(new CylinderGeometry(top, bottom, height, segments), color, variation);
const disc = (radius: number, segments: number, color: number, start = 0, length = Math.PI * 2) =>
  paint(new CircleGeometry(radius, segments, start, length), color, 0);
const ring = (radius: number, tube: number, color: number, arc = Math.PI * 2) =>
  paint(new TorusGeometry(radius, tube, 5, 14, arc), color, 0);

/** Cut end grain: concentric discs facing +Z, so callers only orient one group. */
function endGrain(parent: Group, radius: number, at: Vec3, rotation: Vec3, half = false): void {
  const start = half ? Math.PI : 0, length = half ? Math.PI : Math.PI * 2;
  const face = new Group();
  face.position.set(...at);
  face.rotation.set(...rotation);
  [[1, 0xc28b58], [.72, 0x9f6c42], [.55, 0xc9955f], [.22, 0x93643d]].forEach(([scale, color], i) => {
    add(face, disc(radius * scale, 12, color, start, length), soft, [0, 0, i * .0015]);
  });
  parent.add(face);
}

function makeBedroll(): Group {
  const root = new Group();
  root.name = 'Bedroll on a padded mat';
  add(root, box([1.36, .088, .8], 0x4d4238, .03), soft, [0, .044, 0]);
  add(root, box([1.25, .048, .7], 0xb8956a, .05), soft, [0, .104, 0]);
  // Stitched binding around the pad edge.
  for (const z of [-.35, .35]) add(root, box([1.27, .012, .022], 0x8e6f4b, 0), soft, [0, .133, z]);
  for (const x of [-.625, .625]) add(root, box([.022, .012, .72], 0x8e6f4b, 0), soft, [x, .133, 0]);
  // Rolled wool blanket with woven stripes, spiral ends and buckled straps.
  const rollY = .318, rollZ = -.1;
  add(root, cyl(.19, .19, 1.0, 16, 0xc9a473, .05), soft, [0, rollY, rollZ], [0, 0, Math.PI / 2]);
  for (const x of [-.34, .3]) add(root, cyl(.194, .194, .07, 16, 0x9c7a50, 0), soft, [x, rollY, rollZ], [0, 0, Math.PI / 2]);
  for (const side of [-1, 1]) {
    add(root, disc(.17, 16, 0x7a5d3f), soft, [side * .501, rollY, rollZ], [0, side * Math.PI / 2, 0]);
    for (const r of [.052, .1, .145]) add(root, ring(r, .009, 0xb08c5e), soft, [side * .505, rollY, rollZ], [0, side * Math.PI / 2, 0]);
  }
  for (const x of [-.16, .14]) {
    add(root, cyl(.199, .199, .045, 16, 0x6b4a34, .03), soft, [x, rollY, rollZ], [0, 0, Math.PI / 2]);
    add(root, box([.05, .014, .062], 0xc4954f, 0), metal, [x, rollY + .2, rollZ]);
  }
  // The small buckles fold into the cloth draw.
  unify(root, soft, (m) => m !== metal);
  return batchStatic(root);
}

/** Chopping stump with a flared base, root spurs and a worn, sawn top (the 'stump' surface). */
function makeChoppingStump(): Group {
  const root = new Group();
  root.name = 'Chopping stump';
  const top = .42;
  add(root, cyl(.23, .26, top, 12, 0x6b4830, .06), timber, [0, top / 2, 0]);
  add(root, cyl(.26, .31, .08, 12, 0x5f3f2a, .05), timber, [0, .04, 0]);
  for (let i = 0; i < 3; i++) {
    const a = i * 2.2 + .5;
    // Thin end points outward and slightly down into the ground.
    add(root, cyl(.025, .065, .3, 7, 0x5f3f2a, .05), timber, [Math.cos(a) * .27, .05, Math.sin(a) * .27], [0, -a, -(Math.PI / 2 + .25)]);
  }
  endGrain(root, .225, [0, top + .001, 0], [-Math.PI / 2, 0, 0]);
  // Old blade scars in the chopping face.
  for (const [x, z, yaw] of [[.06, -.07, .5], [-.08, .05, -.7]]) add(root, box([.12, .004, .01], 0x6e4a2e, 0), soft, [x, top + .008, z], [0, yaw, 0]);
  // The axe struck into the stump is the grabbable 'axe' item (scene node camp-axe).
  return batchStatic(root);
}

/**
 * Notice board that carries the field journal panel (0.8 scale: ~1.2 × 0.86 m, centred
 * 1.5 m up). Origin on the ground under the panel; the panel hangs just in front (+Z).
 */
function makeJournalBoard(): Group {
  const root = new Group();
  root.name = 'Field journal notice board';
  for (const x of [-.68, .68]) {
    add(root, box([.09, 2.05, .09], 0x6b4830, .05), timber, [x, 1.025, -.06]);
    add(root, box([.16, .05, .16], 0x5f3f2a, .03), soft, [x, .025, -.06]);
  }
  // Plank backing, slightly proud of the posts, with a darker frame.
  for (let i = 0; i < 5; i++) add(root, box([1.3, .185, .03], i % 2 ? 0x8a5a36 : 0x7d5132, .06), soft, [0, 1.1 + i * .19, -.045]);
  for (const y of [1.03, 1.97]) add(root, box([1.42, .05, .05], 0x5f3f2a, .03), soft, [0, y, -.03]);
  add(root, box([1.42, .05, .05], 0x5f3f2a, .03), soft, [0, .62, -.06]);
  // Little shingle roof keeps the rain off the pages.
  for (const side of [-1, 1]) add(root, box([1.6, .03, .2], 0x5a3a26, .05), soft, [0, 2.1, -.06 + side * .085], [side * .55, 0, 0]);
  // Iron nails pinning the panel corners.
  for (const x of [-.6, .6]) for (const y of [1.08, 1.92]) add(root, cyl(.012, .012, .02, 6, 0x2f3336, 0), metal, [x, y, -.02], [Math.PI / 2, 0, 0]);
  // The camp lantern hangs from an iron bracket on the fire-side post: cold glass
  // until the first fire is lit (FxSystem warms the 'Lantern glow' material).
  add(root, box([.3, .025, .025], 0x2f3336, 0), metal, [-.84, 1.95, -.06]);
  add(root, box([.025, .14, .025], 0x2f3336, 0), metal, [-.76, 1.88, -.06], [0, 0, .7]);
  add(root, ring(.022, .005, 0x2f3336), metal, [-.97, 1.925, -.06], [0, 0, 0]);
  add(root, cyl(.004, .004, .07, 4, 0x2f3336, 0), metal, [-.97, 1.87, -.06]);
  const lantern = new Group();
  lantern.position.set(-.97, 1.58, -.06);
  lantern.scale.setScalar(.85);
  add(lantern, cyl(.09, .11, .05, 12, 0x4a4038, 0), metal, [0, .025, 0]);
  add(lantern, new CylinderGeometry(.075, .075, .18, 12), glow, [0, .14, 0]);
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4;
    add(lantern, cyl(.006, .006, .18, 4, 0x3b332c, 0), metal, [Math.cos(a) * .079, .14, Math.sin(a) * .079]);
  }
  for (const y of [.09, .19]) add(lantern, ring(.078, .006, 0x4a4038), metal, [0, y, 0], [Math.PI / 2, 0, 0]);
  add(lantern, cyl(.10, .08, .05, 12, 0x4a4038, 0), metal, [0, .255, 0]);
  add(lantern, cyl(.03, .03, .04, 10, 0x3b332c, 0), metal, [0, .29, 0]);
  add(lantern, ring(.10, .008, 0x3b332c, Math.PI), metal, [0, .31, 0]);
  root.add(lantern);
  // Nails, bracket and lantern frame fold into the plank draw (the glass keeps its own).
  unify(root, soft, (m) => m !== metal);
  return batchStatic(root);
}

export const journalBoard = makeJournalBoard();
export const bedroll = makeBedroll();
export const choppingStump = makeChoppingStump();
