/**
 * The journey's way-finding dressing (design/JOURNEY.md), static and batched:
 * - waystation: outpost 1, the expedition's lean-to under the west ridge where the pack
 *   waits. Origin on the ground at its centre, open front toward local +Z (the scene node
 *   turns it by WAYSTATION.yawDeg). One draw.
 * - waystationTable: the trestle table the pack lies on (scene: ItemSurface; top at
 *   WAYSTATION.table.top). One draw.
 * - journeyMarkers: the orange trail markers from the wreck to camp, and two tall flags
 *   (the waystation, and camp seen from the forest). Absolute world placement: the scene
 *   node sits at the origin. One draw.
 * Nothing here may look like a grabbable item (no loose sticks, logs or tools).
 */
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from '@iwsdk/core';
import type { BufferGeometry } from '@iwsdk/core';
import { MARKERS, WAYSTATION } from '../game/journey.js';
import { terrainHeight } from '../game/terrain.js';
import { batchStatic, paint } from './static-batch.js';

type Vec3 = [number, number, number];

const material = new MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: .04, flatShading: true });
material.name = 'Waystation timber, canvas and iron';

const C = {
  post: 0x6e5236, beam: 0x7d5d3c, plank: 0x8a6a45, plankDark: 0x6b5034, canvas: 0xc9a066, canvasDark: 0xa98250,
  orange: 0xe8661c, white: 0xefe9dc, iron: 0x3f4347, glass: 0x2a2f33, crate: 0x9b7a4f, crateBand: 0x55483a,
  barrel: 0x7a5534, dirt: 0x5b4a39, rope: 0xb89c6a,
} as const;

function add(parent: Group, geometry: BufferGeometry, at: Vec3, rot: Vec3 = [0, 0, 0]): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...at);
  mesh.rotation.set(...rot);
  parent.add(mesh);
  return mesh;
}
const box = (w: number, h: number, d: number, color: number, variation = .05) => paint(new BoxGeometry(w, h, d), color, variation);
const cyl = (top: number, bottom: number, h: number, segments: number, color: number, variation = .05) =>
  paint(new CylinderGeometry(top, bottom, h, segments), color, variation);

const UP = new Vector3(0, 1, 0);

/** A pole between two points (a thin cylinder). */
function pole(parent: Group, a: Vec3, b: Vec3, radius: number, color: number): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
  const mesh = add(parent, cyl(radius, radius * 1.1, len, 7, color), [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  // Align local +Y with the pole's direction.
  mesh.quaternion.setFromUnitVectors(UP, new Vector3(dx / len, dy / len, dz / len));
}

/** An orange expedition flag on a tall pole (local origin at the pole's foot). */
function flag(parent: Group, at: Vec3, yawDeg: number, height = 3.3): void {
  const g = new Group();
  g.position.set(...at);
  g.rotation.y = yawDeg * Math.PI / 180;
  add(g, cyl(.035, .045, height, 7, C.post), [0, height / 2, 0]);
  add(g, box(.72, .44, .012, C.orange, .08), [.38, height - .3, 0], [0, 0, -.04]);
  add(g, box(.72, .07, .014, C.white, .02), [.38, height - .3, 0], [0, 0, -.04]);
  add(g, cyl(.05, .05, .05, 7, C.iron), [0, height + .02, 0]);
  parent.add(g);
}

function makeWaystation(): Group {
  const root = new Group();
  root.name = 'Waystation lean-to';
  const hx = 1.7, back = -1.15, front = .95, highY = 2.45, lowY = 1.85;
  // Posts, the ridge beams, and the canvas roof sloping down to the back.
  for (const x of [-hx, hx]) {
    add(root, cyl(.07, .08, highY + .1, 7, C.post), [x, (highY + .1) / 2 - .05, front]);
    add(root, cyl(.07, .08, lowY + .1, 7, C.post), [x, (lowY + .1) / 2 - .05, back]);
    pole(root, [x, highY, front], [x, lowY, back], .055, C.beam);
  }
  add(root, cyl(.06, .06, hx * 2 + .3, 7, C.beam), [0, highY, front], [0, 0, Math.PI / 2]);
  add(root, cyl(.06, .06, hx * 2 + .3, 7, C.beam), [0, lowY, back], [0, 0, Math.PI / 2]);
  const slope = Math.atan2(highY - lowY, front - back), run = Math.hypot(highY - lowY, front - back);
  add(root, box(hx * 2 + .5, .025, run + .45, C.canvas, .1), [0, (highY + lowY) / 2 + .07, (front + back) / 2], [slope, 0, 0]);
  // A darker weathered band and the expedition stripe along the canvas's front edge.
  add(root, box(hx * 2 + .52, .03, .16, C.orange, .06), [0, highY + .1, front + .2], [slope, 0, 0]);
  // Back wall of planks, and a canvas side flap on the north (left) side.
  for (let k = 0; k < 6; k++) add(root, box(hx * 2 + .1, .22, .04, k % 2 ? C.plank : C.plankDark, .08), [0, .14 + k * .27, back - .06]);
  add(root, box(.02, 1.55, 1.9, C.canvasDark, .1), [-hx - .05, .95, (front + back) / 2 - .05], [0, 0, .06]);
  // Crates and a barrel against the back wall (surfaces nobody needs: nothing lies on them).
  add(root, box(.62, .5, .5, C.crate), [-1.05, .25, back + .38], [0, .1, 0]);
  add(root, box(.64, .03, .52, C.crateBand), [-1.05, .44, back + .38], [0, .1, 0]);
  add(root, box(.5, .42, .42, C.crate), [-1.02, .71, back + .36], [0, -.2, 0]);
  add(root, cyl(.27, .25, .8, 12, C.barrel), [1.2, .4, back + .4]);
  for (const y of [.15, .65]) add(root, cyl(.285, .285, .04, 12, C.iron, .02), [1.2, y, back + .4]);
  // A coil of rope on the crate, a cold lantern under the front beam.
  add(root, cyl(.14, .14, .06, 10, C.rope), [-1.02, .95, back + .36]);
  add(root, cyl(.004, .004, .28, 4, C.iron, 0), [.55, highY - .2, front]);
  add(root, cyl(.07, .08, .16, 8, C.iron, .02), [.55, highY - .42, front]);
  add(root, cyl(.055, .055, .12, 8, C.glass, 0), [.55, highY - .42, front]);
  add(root, paint(new ConeGeometry(.09, .08, 8), C.iron, .02), [.55, highY - .3, front]);
  // Signpost at the front corner: two painted arrow boards, one toward the forest (+X), one back.
  const sign = new Group();
  sign.position.set(hx + .7, 0, front + .8);
  add(sign, cyl(.05, .06, 1.9, 7, C.post), [0, .95, 0]);
  const arrow = (y: number, dir: number, color: number) => {
    add(sign, box(.55, .16, .03, color, .06), [dir * .3, y, 0]);
    add(sign, paint(new ConeGeometry(.12, .16, 3), color, .04), [dir * .64, y, 0], [0, 0, -dir * Math.PI / 2]);
  };
  arrow(1.62, 1, C.orange);
  arrow(1.36, -1, C.white);
  root.add(sign);
  // Trodden ground under the roof.
  add(root, cyl(2.3, 2.3, .015, 16, C.dirt, .12), [0, .006, -.1]);
  return batchStatic(root);
}

function makeTable(): Group {
  const root = new Group();
  root.name = 'Waystation trestle table';
  const top = WAYSTATION.table.top;
  add(root, box(1.3, .05, .66, C.plank, .07), [0, top - .025, 0]);
  for (const side of [-1, 1]) {
    add(root, box(.05, top - .05, .05, C.post), [side * .55, (top - .05) / 2, -.26], [.2, 0, 0]);
    add(root, box(.05, top - .05, .05, C.post), [side * .55, (top - .05) / 2, .26], [-.2, 0, 0]);
    add(root, box(.05, .05, .6, C.beam), [side * .55, .3, 0]);
  }
  add(root, box(1.1, .04, .04, C.beam), [0, .3, 0]);
  return batchStatic(root);
}

function makeMarkers(): Group {
  const root = new Group();
  root.name = 'Journey trail markers';
  for (const marker of MARKERS) {
    const y = terrainHeight(marker.x, marker.z);
    if (marker.flag) {
      flag(root, [marker.x, y - .05, marker.z], marker.yawDeg);
      continue;
    }
    const g = new Group();
    g.position.set(marker.x, y - .08, marker.z);
    g.rotation.y = marker.yawDeg * Math.PI / 180;
    add(g, box(.06, 1.35, .06, C.post), [0, .66, 0], [.03, 0, .02]);
    // Orange cloth tied near the top: a knot and two tails lifting in the wind.
    add(g, box(.08, .06, .08, C.orange, .06), [0, 1.18, 0]);
    add(g, box(.3, .07, .01, C.orange, .1), [.16, 1.14, .01], [0, 0, -.35]);
    add(g, box(.24, .05, .01, C.orange, .1), [.13, 1.08, -.01], [0, .2, -.6]);
    root.add(g);
  }
  return batchStatic(root);
}

export const waystation = makeWaystation();
export const waystationTable = makeTable();
export const journeyMarkers = makeMarkers();
