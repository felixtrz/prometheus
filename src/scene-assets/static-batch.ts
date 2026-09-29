import { BufferGeometry, Color, Float32BufferAttribute, Group, Material, Matrix4, Mesh, Object3D } from '@iwsdk/core';

const paintColor = new Color();

/**
 * Give a geometry a baked vertex colour so differently coloured parts can share
 * one vertex-coloured material, and therefore one batched draw. `variation`
 * adds low-frequency value drift across the part's own local space.
 */
export function paint<T extends BufferGeometry>(geometry: T, color: number, variation = 0): T {
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  paintColor.setHex(color);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const drift = 1 + variation * (Math.sin(x * 7.1 + z * 3.3) * .6 + Math.sin(y * 5.3 - x * 2.1) * .4);
    colors[i * 3] = paintColor.r * drift;
    colors[i * 3 + 1] = paintColor.g * drift;
    colors[i * 3 + 2] = paintColor.b * drift;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

const unifyColor = new Color();
/**
 * Fold every mesh's material colour into its vertex colours and give it `material`
 * instead, so parts that only differ in tint batch into one draw. Meshes whose material
 * `keep` accepts (textured, glowing, named contracts) are left alone. Geometry is copied
 * before it is painted, so shared geometries stay untouched.
 */
export function unify(source: Object3D, material: Material, keep: (material: Material) => boolean = () => false): void {
  source.traverse((object: Object3D) => {
    if (!(object instanceof Mesh) || Array.isArray(object.material)) return;
    const from = object.material as Material & { color?: Color; vertexColors?: boolean };
    if (from === material || keep(from)) return;
    const geometry = (object.geometry as BufferGeometry).clone();
    const positions = geometry.getAttribute('position');
    const existing = from.vertexColors ? geometry.getAttribute('color') : undefined;
    const colors = new Float32Array(positions.count * 3);
    const base = from.color ?? unifyColor.setRGB(1, 1, 1);
    for (let i = 0; i < positions.count; i++) {
      colors[i * 3] = base.r * (existing ? existing.getX(i) : 1);
      colors[i * 3 + 1] = base.g * (existing ? existing.getY(i) : 1);
      colors[i * 3 + 2] = base.b * (existing ? existing.getZ(i) : 1);
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    object.geometry = geometry;
    object.material = material;
  });
}

/** Bake an immutable static group into one draw per shared material. */
export function batchStatic(source: Group): Group {
  source.updateMatrixWorld(true);
  const inverseRoot = new Matrix4().copy(source.matrixWorld).invert();
  const buckets = new Map<Material, { positions: number[]; normals: number[]; colors: number[]; uvs: number[] }>();
  source.traverse((object: Object3D) => {
    if (!(object instanceof Mesh)) return;
    if (Array.isArray(object.material)) throw new Error('Static batches require a single material per mesh.');
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverseRoot, object.matrixWorld));
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    let bucket = buckets.get(object.material);
    if (!bucket) {
      bucket = { positions: [], normals: [], colors: [], uvs: [] };
      buckets.set(object.material, bucket);
    }
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const colors = geometry.getAttribute('color');
    const uvs = geometry.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) {
      bucket.positions.push(positions.getX(i), positions.getY(i), positions.getZ(i));
      bucket.normals.push(normals.getX(i), normals.getY(i), normals.getZ(i));
      if (colors) bucket.colors.push(colors.getX(i), colors.getY(i), colors.getZ(i));
      if (uvs) bucket.uvs.push(uvs.getX(i), uvs.getY(i));
    }
    geometry.dispose();
  });
  const result = new Group();
  result.name = source.name;
  for (const [material, bucket] of buckets) {
    const geometry = new BufferGeometry();
    const vertexCount = bucket.positions.length / 3;
    geometry.setAttribute('position', new Float32BufferAttribute(bucket.positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(bucket.normals, 3));
    if (bucket.colors.length === vertexCount * 3) {
      geometry.setAttribute('color', new Float32BufferAttribute(bucket.colors, 3));
    }
    // Only textured materials pay for UVs.
    if ('map' in material && material.map && bucket.uvs.length === vertexCount * 2) {
      geometry.setAttribute('uv', new Float32BufferAttribute(bucket.uvs, 2));
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.name = material.name || 'Static material batch';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    result.add(mesh);
  }
  return result;
}
