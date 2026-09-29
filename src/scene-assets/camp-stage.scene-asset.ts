import {
  BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry,
} from '@iwsdk/core';
import type { BufferGeometry, Material } from '@iwsdk/core';
import { woodTexture } from './procedural-textures.js';
import { batchStatic, paint, unify } from './static-batch.js';

type Vec3 = [number, number, number];
const part = (parent: Group, geometry: BufferGeometry, material: Material, at: Vec3) => {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...at);
  parent.add(mesh);
  return mesh;
};
const block = (size: Vec3, color: number, variation = .05) => paint(new BoxGeometry(...size), color, variation);

// Vertex colour carries the hue; the neutral grain map carries low-frequency detail.
const plank = new MeshStandardMaterial({ vertexColors: true, map: woodTexture({ alongU: true }), roughness: .88, flatShading: true });
plank.name = 'Trestle planks';
const post = new MeshStandardMaterial({ vertexColors: true, map: woodTexture({ repeat: [1, 1.4] }), roughness: .9, flatShading: true });
post.name = 'Trestle legs';
const iron = new MeshStandardMaterial({ vertexColors: true, roughness: .62, metalness: .16, flatShading: true });
iron.name = 'Hand-forged iron';

/**
 * Reachable trestle for the unrolled pack. Built like the bench: planked top with
 * breadboard ends, pegged aprons and low stretchers. The top surface stays at y=0.79.
 */
function makeSupplyStand(): Group {
  const root = new Group();
  root.name = 'Trestle supply stand';
  const planks: [number, number, number][] = [[-.448, .003, 0xb07548], [-.149, -.002, 0x9d6641], [.149, .002, 0xa96e45], [.448, -.003, 0x986240]];
  for (const [z, lift, color] of planks) part(root, block([1.8, .06, .285], color), plank, [0, .757 + lift, z]);
  for (const x of [-.93, .93]) part(root, block([.09, .065, 1.2], 0x8a5536), plank, [x, .7575, 0]);
  for (const z of [-.5, .5]) part(root, block([1.62, .1, .05], 0x7b4b30), plank, [0, .68, z]);
  for (const x of [-.78, .78]) part(root, block([.05, .1, .92], 0x7b4b30), plank, [x, .68, 0]);
  for (const x of [-.78, .78]) for (const z of [-.5, .5]) part(root, block([.1, .74, .1], 0x74482d), post, [x, .365, z]);
  for (const x of [-.78, .78]) part(root, block([.06, .06, .9], 0x7b4b30), plank, [x, .16, 0]);
  part(root, block([1.5, .06, .06], 0x7b4b30), plank, [0, .16, 0]);
  // Pegged joinery where aprons meet legs, and nails at the breadboard ends.
  const peg = paint(new CylinderGeometry(.013, .013, .012, 8), 0x3d2819, 0);
  for (const x of [-.78, .78]) for (const z of [-.528, .528]) part(root, peg, plank, [x, .68, z]).rotation.x = Math.PI / 2;
  const nail = paint(new CylinderGeometry(.009, .009, .008, 6), 0x2f3336, 0);
  for (const x of [-.93, .93]) for (const z of [-.448, -.149, .149, .448]) part(root, nail, iron, [x, .792, z]);
  // Iron corner straps bind the breadboard ends to the outer planks.
  for (const x of [-.9, .9]) for (const z of [-.58, .58]) part(root, block([.16, .012, .05], 0x3b4145, 0), iron, [x, .792, z]);
  // Nails and straps fold into the plank draw.
  unify(root, plank, (m) => m !== iron);
  return batchStatic(root);
}

/**
 * Hardwood block with an iron face plate. The polished strike zone is the visible
 * target for the hammer. Top surface stays at local y=+0.0175 (world 1.0625).
 */
function makeStrikingPad(): Group {
  const root = new Group();
  root.name = 'Iron-faced striking block';
  const worked = new MeshStandardMaterial({ vertexColors: true, roughness: .7, metalness: .12, flatShading: true });
  worked.name = 'Striking block';
  part(root, block([.33, .026, .33], 0x6a4530, .08), worked, [0, -.0045, 0]);
  for (const x of [-.12, .12]) part(root, block([.035, .03, .336], 0x353b3f, 0), worked, [x, -.004, 0]);
  part(root, block([.27, .009, .27], 0x4b5357, .04), worked, [0, .013, 0]);
  part(root, paint(new CylinderGeometry(.078, .078, .0016, 20), 0x9aa3a7, 0), worked, [0, .0183, 0]);
  const rivet = paint(new SphereGeometry(.012, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x2f3437, 0);
  for (const x of [-.11, .11]) for (const z of [-.11, .11]) part(root, rivet, worked, [x, .0175, z]);
  return batchStatic(root);
}

export const supplyStand = makeSupplyStand();
export const strikingPad = makeStrikingPad();
