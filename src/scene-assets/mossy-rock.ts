import { BufferGeometry, Color, Float32BufferAttribute, IcosahedronGeometry } from '@iwsdk/core';

const moss = [new Color(0x7a9a3c), new Color(0x69883a)];
const stone = [new Color(0x959a9d), new Color(0x7f868b), new Color(0x8b8e88)];
const faceColor = new Color();

/**
 * Faceted boulder after the moodboard's "Rock Medium" reference: grey stone with a
 * moss cap on upward faces. Unit size; the base is flattened so it beds into terrain
 * and `plateau` optionally flattens the top to carry an object.
 */
export function mossyRockGeometry(seed: number, detail = 1, plateau = 2): BufferGeometry {
  // Polyhedron geometry is non-indexed, so per-face colours stay crisp.
  const geometry = new IcosahedronGeometry(1, detail);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const lump = 1 + .16 * Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 - seed * .7) + .08 * Math.sin(y * 5.3 + seed * 1.9);
    positions.setXYZ(i, x * lump, Math.min(plateau, Math.max(-.35, y * lump)), z * lump);
  }
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(positions.count * 3);
  for (let face = 0; face < positions.count / 3; face++) {
    const v = face * 3;
    const up = (normals.getY(v) + normals.getY(v + 1) + normals.getY(v + 2)) / 3;
    const ragged = .08 * Math.sin(face * 2.3 + seed * 3.1);
    faceColor.copy(stone[(face + Math.round(seed)) % stone.length]);
    if (up + ragged > .62) faceColor.copy(moss[face % 2]);
    else if (up + ragged > .46) faceColor.lerp(moss[1], .45);
    for (let k = 0; k < 3; k++) faceColor.toArray(colors, (v + k) * 3);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}
