/**
 * Parts of the choppable forest (src/game/systems/forest-system.ts):
 * - the broadleaf drawn instanced at runtime;
 * - the stump a felled tree leaves;
 * - an editor-only group of every broadleaf.
 * The pines are the GLB 'pine-1'/'pine-2' assets. Deterministic, no World: this module is
 * evaluated by the runtime and by the editor.
 */
import { Color, CylinderGeometry, Float32BufferAttribute, Group, Mesh } from '@iwsdk/core';
import type { BufferGeometry } from '@iwsdk/core';
import { batchStatic } from './static-batch.js';
import { broadleaf, broadleafModel, mats } from './valley-kit.scene-asset.js';
import { BROADLEAVES } from './valley-layout.scene-asset.js';

/**
 * One broadleaf at h = 1, foot at the origin, as its two batched parts (bark, crowns).
 * ForestSystem scales it by the tree height and turns it by the tree's yaw.
 */
export const broadleafUnit: { geometry: BufferGeometry; material: Mesh['material'] }[] = (() => {
  const source = new Group();
  source.add(broadleafModel(1, 0, 0));
  const batched = batchStatic(source);
  return batched.children.map((child) => {
    const mesh = child as Mesh;
    return { geometry: mesh.geometry, material: mesh.material };
  });
})();

/**
 * Every broadleaf, for the editor ('valley-broadleaves' scene node). The runtime hides
 * this node: ForestSystem draws the same trees instanced, so each can be felled.
 */
export const valleyBroadleaves = (() => {
  const root = new Group();
  root.name = 'Valley broadleaves';
  for (const t of BROADLEAVES) broadleaf(root, t.x, t.z, t.h, t.yaw, t.variant);
  return batchStatic(root);
})();

/**
 * A felled tree's stump: unit radius (at the cut) and unit height, foot at the origin;
 * the cut is pale ringed heartwood, slightly slanted. Instanced by ForestSystem.
 */
export const stumpGeometry: BufferGeometry = (() => {
  const geometry = new CylinderGeometry(1, 1.14, 1, 11, 1, false).translate(0, .5, 0);
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const colors = new Float32Array(positions.count * 3);
  const bark = new Color(0x6b4830), heart = new Color(0xd9ad72), ring = new Color(0xb27a46), c = new Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    if (normals.getY(i) > .9) {
      // The cut: heartwood fading to a darker growth ring at the bark.
      const r = Math.hypot(x, z);
      c.copy(heart).lerp(ring, Math.min(1, r * 1.1));
      positions.setY(i, y + x * .09);
    } else if (y > .5) {
      c.copy(bark).multiplyScalar(1.05 + .08 * Math.sin(x * 9 + z * 5));
      positions.setY(i, y + x * .09);
    } else {
      c.copy(bark).multiplyScalar(.9);
    }
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
})();
export const stumpMaterial = mats.bark;
