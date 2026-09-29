/**
 * Creature prototypes: 'deer', 'rabbit' and the hollow ash-'wolf'. Stylized mid-poly,
 * origin on the ground between the feet, facing +Z.
 *
 * Each creature is one rigidly skinned mesh per material: every part is modelled in
 * root space and bound (weight 1) to a named Bone, so the procedural animation
 * rotates bones while the whole hide stays a single draw. Named parts (Bones):
 * 'body' (torso centre), 'head' (pivot at the neck base), 'leg-fl' 'leg-fr' 'leg-bl'
 * 'leg-br' (pivot at the shoulder/hip; rotating .x swings the leg), 'tail'. Every bone
 * rests with identity rotation. The wolf adds skinned meshes 'embers' (glowing
 * cracks) and 'eyes', whose MeshBasic materials the creature system clones per
 * entity to pulse. Every creature also carries an unskinned 'shadow': a soft radial
 * contact disc at y +0.01 (shared transparent material, depthWrite off) that the
 * system tilts to the terrain. Draws: deer 2, rabbit 2, wolf 4.
 *
 * Deterministic and side-effect free (evaluated by both the runtime and the editor).
 */
import {
  Bone, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Skeleton, SkinnedMesh,
  SphereGeometry, Uint16BufferAttribute, Vector3,
} from '@iwsdk/core';
import type { Material } from '@iwsdk/core';

type Vec3 = readonly [number, number, number];
/** Writes a vertex colour from its root-space position and normal. */
type Shade = (out: Color, x: number, y: number, z: number, nx: number, ny: number, nz: number) => void;

const hide = new MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0 });
hide.name = 'Creature hide';
// Unlit and untone-mapped so the cracks and eyes read as light sources at night.
const embers = new MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: DoubleSide });
embers.name = 'Wolf embers';
const eyeGlow = new MeshBasicMaterial({ color: 0xffcf6a, toneMapped: false });
eyeGlow.name = 'Wolf eyes';
// Black with per-vertex alpha (RGBA colours): a soft blob shadow with no texture.
const contactShadow = new MeshBasicMaterial({ color: 0x000000, vertexColors: true, transparent: true, depthWrite: false });
contactShadow.name = 'Creature contact shadow';

/** Radial contact-shadow disc (ellipse rx × rz) lying flat, darkest in the middle. */
function shadowDisc(rx: number, rz: number, cz: number, alpha = .42): Mesh {
  const segments = 20, rings = [[0, alpha], [.5, alpha * .72], [1, 0]] as const;
  const positions: number[] = [], colors: number[] = [], normals: number[] = [];
  const vertex = (ring: number, i: number) => {
    const [r, a] = rings[ring];
    const angle = (i % segments) / segments * Math.PI * 2;
    positions.push(Math.sin(angle) * rx * r, .01, cz + Math.cos(angle) * rz * r);
    colors.push(1, 1, 1, a);
    normals.push(0, 1, 0);
  };
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let i = 0; i < segments; i++) {
      // Counter-clockwise seen from above (+Y), so the disc faces up.
      vertex(ring, i); vertex(ring + 1, i); vertex(ring + 1, i + 1);
      if (ring > 0) { vertex(ring, i); vertex(ring + 1, i + 1); vertex(ring, i + 1); }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4));
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, contactShadow);
  mesh.name = 'shadow';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const ONE = new Vector3(1, 1, 1);
const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpQ = new Quaternion();
const tmpM = new Matrix4();
const tmpColor = new Color();
const tmpColor2 = new Color();

interface Bucket { name: string; material: Material; positions: number[]; normals: number[]; colors: number[]; bones: number[] }

/** Builds a rigid-skinned creature: bones with identity rest rotation, parts in root space. */
class Rig {
  readonly root = new Group();
  private readonly bones: Bone[] = [];
  private readonly pivots: Vector3[] = [];
  private readonly index = new Map<string, number>();
  private readonly buckets: Bucket[] = [];

  constructor(name: string) {
    this.root.name = name;
  }

  bone(name: string, parent: string | null, pivot: Vec3): this {
    const bone = new Bone();
    bone.name = name;
    const world = new Vector3(...pivot);
    const parentIndex = parent === null ? -1 : this.index.get(parent)!;
    const origin = parentIndex < 0 ? new Vector3() : this.pivots[parentIndex];
    bone.position.copy(world).sub(origin);
    (parentIndex < 0 ? this.root : this.bones[parentIndex]).add(bone);
    this.index.set(name, this.bones.length);
    this.bones.push(bone);
    this.pivots.push(world);
    return this;
  }

  /** Unskinned contact shadow under the body (one extra small draw). */
  shadow(rx: number, rz: number, cz: number): this {
    this.root.add(shadowDisc(rx, rz, cz));
    return this;
  }

  /** Bake `geometry` (already in root space) onto `bone`, coloured by `color`. */
  add(bone: string, mesh: string, material: Material, geometry: BufferGeometry, color: number | Shade, variation = .05): this {
    const boneIndex = this.index.get(bone);
    if (boneIndex === undefined) throw new Error(`Unknown bone ${bone}`);
    let bucket = this.buckets.find((b) => b.name === mesh);
    if (!bucket) this.buckets.push(bucket = { name: mesh, material, positions: [], normals: [], colors: [], bones: [] });
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!source.getAttribute('normal')) source.computeVertexNormals();
    const positions = source.getAttribute('position');
    const normals = source.getAttribute('normal');
    const baked = source.getAttribute('color');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const nx = normals.getX(i), ny = normals.getY(i), nz = normals.getZ(i);
      if (baked) tmpColor.setRGB(baked.getX(i), baked.getY(i), baked.getZ(i));
      else if (typeof color === 'number') tmpColor.setHex(color);
      else color(tmpColor, x, y, z, nx, ny, nz);
      const drift = 1 + variation * (Math.sin(x * 23.1 + z * 11.3) * .6 + Math.sin(y * 17.3 - x * 9.1) * .4);
      bucket.positions.push(x, y, z);
      bucket.normals.push(nx, ny, nz);
      bucket.colors.push(tmpColor.r * drift, tmpColor.g * drift, tmpColor.b * drift);
      bucket.bones.push(boneIndex);
    }
    if (source !== geometry) source.dispose();
    geometry.dispose();
    return this;
  }

  build(): Group {
    this.root.updateMatrixWorld(true);
    const skeleton = new Skeleton(this.bones);
    for (const bucket of this.buckets) {
      const count = bucket.positions.length / 3;
      const skinIndex = new Uint16Array(count * 4);
      const skinWeight = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        skinIndex[i * 4] = bucket.bones[i];
        skinWeight[i * 4] = 1;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(bucket.positions, 3));
      geometry.setAttribute('normal', new Float32BufferAttribute(bucket.normals, 3));
      geometry.setAttribute('color', new Float32BufferAttribute(bucket.colors, 3));
      geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
      geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new SkinnedMesh(geometry, bucket.material);
      mesh.name = bucket.name;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.root.add(mesh);
      mesh.bind(skeleton);
      // Posed limbs (grazing, collapse) stay inside a padded rest-pose sphere for culling.
      mesh.boundingSphere = geometry.boundingSphere!.clone();
      mesh.boundingSphere.radius *= 1.35;
    }
    return this.root;
  }
}

// ---- Root-space primitive helpers -------------------------------------------------

/** Average normals across coincident vertices (sphere seams and poles). */
function weldNormals(geometry: BufferGeometry): BufferGeometry {
  geometry.computeVertexNormals();
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const sums = new Map<string, Vector3>();
  const key = (i: number) => `${positions.getX(i).toFixed(4)},${positions.getY(i).toFixed(4)},${positions.getZ(i).toFixed(4)}`;
  for (let i = 0; i < positions.count; i++) {
    const k = key(i);
    const sum = sums.get(k) ?? sums.set(k, new Vector3()).get(k)!;
    sum.x += normals.getX(i); sum.y += normals.getY(i); sum.z += normals.getZ(i);
  }
  for (let i = 0; i < positions.count; i++) {
    const n = tmpA.copy(sums.get(key(i))!).normalize();
    normals.setXYZ(i, n.x, n.y, n.z);
  }
  return geometry;
}

/** Ellipsoid at `c` with radii `r`, optional Euler rotation. */
function blob(c: Vec3, r: Vec3, segments: [number, number], rotation: Vec3 = [0, 0, 0]): BufferGeometry {
  const geometry = new SphereGeometry(1, segments[0], segments[1]);
  geometry.scale(r[0], r[1], r[2]);
  if (rotation[0] || rotation[1] || rotation[2]) {
    geometry.rotateX(rotation[0]);
    geometry.rotateY(rotation[1]);
    geometry.rotateZ(rotation[2]);
  }
  geometry.translate(c[0], c[1], c[2]);
  return geometry;
}

/** Tapered cylinder from `a` (radius ra) to `b` (radius rb). */
function limb(a: Vec3, b: Vec3, ra: number, rb: number, radial = 8, open = true): BufferGeometry {
  tmpA.set(...a);
  tmpB.set(...b).sub(tmpA);
  const geometry = new CylinderGeometry(rb, ra, tmpB.length(), radial, 1, open);
  tmpQ.setFromUnitVectors(UP, tmpB.normalize());
  tmpM.compose(tmpA.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), tmpQ, ONE);
  return geometry.applyMatrix4(tmpM);
}

/** Open cone from a base centre to a tip; `flatten` squashes it across its local Z. */
function spike(base: Vec3, tip: Vec3, radius: number, radial = 4, flatten = 1): BufferGeometry {
  tmpA.set(...base);
  tmpB.set(...tip).sub(tmpA);
  const geometry = new ConeGeometry(radius, tmpB.length(), radial, 1, true);
  if (flatten !== 1) geometry.scale(1, 1, flatten);
  tmpQ.setFromUnitVectors(UP, tmpB.normalize());
  tmpM.compose(tmpA.set((base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2, (base[2] + tip[2]) / 2), tmpQ, ONE);
  return geometry.applyMatrix4(tmpM);
}

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Profile stop along a loft: [t (−1 back … +1 front), half-width, top, bottom, y offset]. */
type Stop = readonly [number, number, number, number, number];

/**
 * A body lofted along +Z: a unit sphere (poles on ±Z) whose cross-section follows
 * smoothly interpolated profile stops, so chest, tucked waist and rump read as one
 * continuous form. Optional `pitch` tilts it about X around its centre.
 */
class Loft {
  private readonly profile = [0, 0, 0, 0];
  constructor(
    readonly center: Vec3, readonly halfLength: number, readonly stops: readonly Stop[], readonly pitch = 0,
  ) {}

  private sample(t: number): number[] {
    const stops = this.stops, p = this.profile;
    let i = 0;
    while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
    const a = stops[i], b = stops[i + 1];
    const k = smoothstep(a[0], b[0], t);
    for (let j = 0; j < 4; j++) p[j] = a[j + 1] + (b[j + 1] - a[j + 1]) * k;
    return p;
  }

  /** Map a unit-sphere point (poles on ±Z) onto the loft surface, in root space. */
  map(x: number, y: number, z: number, out: Vector3): Vector3 {
    const [w, top, bottom, yOff] = this.sample(z);
    out.set(x * w, y * (y >= 0 ? top : bottom) + yOff, z * this.halfLength);
    if (this.pitch) out.applyAxisAngle(X_AXIS, this.pitch);
    return out.add(tmpB.set(...this.center));
  }

  /** Surface point at axial `t` and angle `a` round the axis (0 = top, +π/2 = +X side). */
  point(t: number, a: number, out: Vector3): Vector3 {
    const r = Math.sqrt(Math.max(0, 1 - t * t));
    return this.map(r * Math.sin(a), r * Math.cos(a), t, out);
  }

  normal(t: number, a: number, out: Vector3): Vector3 {
    const e = .01;
    const p0 = this.point(t, a - e, new Vector3()), p1 = this.point(t, a + e, new Vector3());
    const q0 = this.point(t - e, a, new Vector3()), q1 = this.point(t + e, a, new Vector3());
    out.crossVectors(p1.sub(p0), q1.sub(q0)).normalize();
    const axis = this.map(0, 0, t, new Vector3());
    if (out.dot(this.point(t, a, new Vector3()).sub(axis)) < 0) out.negate();
    return out;
  }

  geometry(radial: number, rings: number): BufferGeometry {
    const geometry = new SphereGeometry(1, radial, rings);
    geometry.deleteAttribute('normal');
    geometry.deleteAttribute('uv');
    geometry.rotateX(Math.PI / 2);
    const positions = geometry.getAttribute('position');
    const p = new Vector3();
    for (let i = 0; i < positions.count; i++) {
      this.map(positions.getX(i), positions.getY(i), positions.getZ(i), p);
      positions.setXYZ(i, p.x, p.y, p.z);
    }
    return weldNormals(geometry);
  }
}

/**
 * A jagged glowing crack ribbon through surface points: three vertices across
 * (hot core, red edges), lifted off the surface, tapering toward its ends.
 */
function ribbon(points: Vector3[], normals: Vector3[], width: number, lift = .004): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const normalData: number[] = [];
  const core = new Color(0xffd27a), edge = new Color(0xff4410);
  const rows: Vector3[][] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(points.length - 1, i + 1)];
    const tangent = next.clone().sub(prev).normalize();
    const side = new Vector3().crossVectors(normals[i], tangent).normalize();
    const w = width * (.2 + .8 * Math.sin(Math.PI * (i + .5) / points.length));
    const p = points[i].clone().addScaledVector(normals[i], lift);
    rows.push([p.clone().addScaledVector(side, w / 2), p, p.clone().addScaledVector(side, -w / 2)]);
  }
  const push = (p: Vector3, color: Color, n: Vector3) => {
    positions.push(p.x, p.y, p.z);
    colors.push(color.r, color.g, color.b);
    normalData.push(n.x, n.y, n.z);
  };
  for (let i = 0; i < rows.length - 1; i++) {
    for (let k = 0; k < 2; k++) {
      const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1];
      const ca = k === 0 ? edge : core, cb = k === 0 ? core : edge;
      push(a, ca, normals[i]); push(c, ca, normals[i + 1]); push(b, cb, normals[i]);
      push(b, cb, normals[i]); push(c, ca, normals[i + 1]); push(d, cb, normals[i + 1]);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normalData, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Crack on a loft through (t, angle) samples. */
function loftCrack(loft: Loft, path: readonly (readonly [number, number])[], width: number): BufferGeometry {
  return ribbon(path.map(([t, a]) => loft.point(t, a, new Vector3())), path.map(([t, a]) => loft.normal(t, a, new Vector3())), width);
}

/** Crack on an ellipsoid through surface directions. */
function blobCrack(c: Vec3, r: Vec3, directions: readonly Vec3[], width: number): BufferGeometry {
  const points: Vector3[] = [], normals: Vector3[] = [];
  for (const d of directions) {
    const s = 1 / Math.hypot(d[0] / r[0], d[1] / r[1], d[2] / r[2]);
    const p = new Vector3(d[0] * s, d[1] * s, d[2] * s);
    normals.push(new Vector3(p.x / (r[0] * r[0]), p.y / (r[1] * r[1]), p.z / (r[2] * r[2])).normalize());
    points.push(p.add(new Vector3(...c)));
  }
  return ribbon(points, normals, width);
}

/** Coat shading: darker back, lighter belly, blended by the surface normal. */
function coat(side: number, back: number, belly: number, backFrom = .35, bellyFrom = -.2, soft = .5): Shade {
  const s = new Color(side), b = new Color(back), u = new Color(belly);
  return (out, _x, _y, _z, _nx, ny) => {
    out.copy(s);
    out.lerp(b, smoothstep(backFrom, backFrom + soft, ny));
    out.lerp(u, smoothstep(bellyFrom, bellyFrom - soft, ny));
  };
}

const LEGS = [['leg-fl', 1], ['leg-fr', -1]] as const;
const HIND = [['leg-bl', 1], ['leg-br', -1]] as const;
const sx = (s: number, v: Vec3): Vec3 => [v[0] * s, v[1], v[2]];

// ---- Deer ---------------------------------------------------------------------

function makeDeer(): Group {
  // Long, deep-chested torso (1.28 m) so the legs no longer read as stilts.
  const F = .08, H = -.1; // front and hind shifts from the first-playable layout
  const rig = new Rig('deer')
    .bone('body', null, [0, .88, 0])
    .bone('head', 'body', [0, .93, .27 + F])
    .bone('tail', 'body', [0, 1.0, -.66])
    .bone('leg-fl', 'body', [.085, .84, .27 + F])
    .bone('leg-fr', 'body', [-.085, .84, .27 + F])
    .bone('leg-bl', 'body', [.09, .86, -.3 + H])
    .bone('leg-br', 'body', [-.09, .86, -.3 + H]);

  const tan = 0xb3743d, back = 0x8a552c, cream = 0xeadcbc, hoof = 0x2c231d, dark = 0x1a1310;
  const body = coat(tan, back, cream, .3, -.35, .6);
  const rumpShade: Shade = (out, x, y, z, nx, ny, nz) => {
    body(out, x, y, z, nx, ny, nz);
    // Pale rump patch around the tail.
    out.lerp(tmpColor2.setHex(cream), smoothstep(.14, .06, Math.hypot(x, y - .95)) * smoothstep(-.3, -.75, nz));
  };
  const torso = new Loft([0, .89, -.05], .64, [
    [-1, .12, .15, .15, .03], [-.62, .16, .2, .2, .02], [-.1, .15, .185, .2, 0], [.45, .17, .205, .25, 0], [1, .125, .17, .19, .04],
  ]);
  rig.add('body', 'hide', hide, torso.geometry(18, 12), rumpShade);

  // Neck, head, ears and small antlers (all on the neck pivot).
  const throat: Shade = (out, _x, _y, _z, _nx, ny, nz) => {
    out.setHex(tan).lerp(tmpColor2.setHex(back), smoothstep(.2, .7, ny - nz * .5));
    out.lerp(tmpColor2.setHex(cream), smoothstep(1.0, 1.45, nz - ny) * .55);
  };
  const skull = new Loft([0, 1.24, .555 + F], .13, [
    [-1, .06, .06, .06, 0], [-.4, .076, .075, .066, 0], [.2, .05, .046, .05, -.01], [1, .034, .03, .034, -.02],
  ], .32);
  const nose = skull.point(1, 0, new Vector3());
  const z = (v: Vec3): Vec3 => [v[0], v[1], v[2] + F];
  rig
    .add('body', 'hide', hide, blob([0, 1.02, .33 + F], [.1, .12, .11], [9, 7]), body)
    .add('head', 'hide', hide, limb([0, .93, .27 + F], [0, 1.225, .5 + F], .092, .056, 10, false), throat)
    .add('head', 'hide', hide, skull.geometry(12, 9), coat(tan, back, cream, .45, -.4, .45))
    .add('head', 'hide', hide, blob([nose.x, nose.y + .002, nose.z - .012], [.03, .026, .022], [8, 6]), 0x2a211c, 0);
  for (const s of [1, -1]) {
    const eye = skull.point(-.3, s * 1.05, new Vector3());
    rig
      .add('head', 'hide', hide, blob([eye.x, eye.y, eye.z], [.016, .018, .014], [7, 5]), dark, 0)
      .add('head', 'hide', hide, spike(z(sx(s, [.05, 1.3, .46])), z(sx(s, [.15, 1.39, .44])), .036, 6, .38), coat(tan, back, tan, .3, -.9))
      .add('head', 'hide', hide, spike(z(sx(s, [.056, 1.302, .468])), z(sx(s, [.138, 1.376, .452])), .024, 5, .2), 0xc9a07e, .02)
      .add('head', 'hide', hide, limb(z(sx(s, [.035, 1.315, .475])), z(sx(s, [.075, 1.405, .455])), .015, .012, 5), 0xd8c29a, .03)
      .add('head', 'hide', hide, limb(z(sx(s, [.075, 1.405, .455])), z(sx(s, [.066, 1.48, .41])), .012, .006, 5), 0xe3d2ae, .03)
      .add('head', 'hide', hide, limb(z(sx(s, [.074, 1.4, .455])), z(sx(s, [.094, 1.45, .505])), .009, .005, 5), 0xe3d2ae, .03)
      .add('head', 'hide', hide, blob(z(sx(s, [.035, 1.312, .475])), [.02, .014, .02], [6, 4]), 0x6b4a2e, 0);
  }

  // Tail: tan flag with a white underside.
  const flag: Shade = (out, _x, _y, _z, _nx, ny, nz) => {
    out.setHex(back).lerp(tmpColor2.setHex(0xf4efe4), smoothstep(-.2, -.6, nz + ny * .6));
  };
  rig.add('tail', 'hide', hide, blob([0, .965, -.7], [.046, .085, .032], [8, 7], [-.45, 0, 0]), flag);

  // Legs: a shoulder mass bridges each foreleg into the chest; hind legs carry haunch, hock and cannon.
  const leg = coat(tan, back, cream, .6, -.4);
  const shin = coat(0x94603a, 0x7a4c2c, 0xd9c4a0, .6, -.6);
  const fz = (v: Vec3): Vec3 => [v[0], v[1], v[2] + F];
  const hz = (v: Vec3): Vec3 => [v[0], v[1], v[2] + H];
  for (const [name, s] of LEGS) {
    rig
      .add(name, 'hide', hide, blob(fz(sx(s, [.07, .8, .24])), [.062, .16, .105], [9, 7]), body)
      .add(name, 'hide', hide, limb(fz(sx(s, [.088, .86, .27])), fz(sx(s, [.082, .49, .29])), .072, .041, 9), leg)
      .add(name, 'hide', hide, blob(fz(sx(s, [.082, .49, .29])), [.038, .042, .04], [7, 5]), shin)
      .add(name, 'hide', hide, limb(fz(sx(s, [.082, .49, .29])), fz(sx(s, [.08, .085, .28])), .036, .026, 7), shin)
      .add(name, 'hide', hide, blob(fz(sx(s, [.08, .09, .282])), [.028, .03, .03], [6, 4]), 0x6b4a33)
      .add(name, 'hide', hide, limb(fz(sx(s, [.08, .07, .285])), fz(sx(s, [.08, 0, .3])), .027, .034, 7, false), hoof, .02);
  }
  for (const [name, s] of HIND) {
    rig
      .add(name, 'hide', hide, blob(hz(sx(s, [.1, .78, -.3])), [.08, .17, .13], [10, 8]), rumpShade)
      .add(name, 'hide', hide, limb(hz(sx(s, [.1, .7, -.28])), hz(sx(s, [.092, .42, -.38])), .056, .034, 8), leg)
      .add(name, 'hide', hide, blob(hz(sx(s, [.092, .42, -.38])), [.034, .038, .038], [6, 4]), shin)
      .add(name, 'hide', hide, limb(hz(sx(s, [.092, .42, -.38])), hz(sx(s, [.09, .085, -.33])), .034, .026, 7), shin)
      .add(name, 'hide', hide, blob(hz(sx(s, [.09, .09, -.328])), [.028, .03, .03], [6, 4]), 0x6b4a33)
      .add(name, 'hide', hide, limb(hz(sx(s, [.09, .07, -.325])), hz(sx(s, [.09, 0, -.31])), .027, .034, 7, false), hoof, .02);
  }
  return rig.shadow(.3, .74, -.05).build();
}

// ---- Rabbit -------------------------------------------------------------------

function makeRabbit(): Group {
  const rig = new Rig('rabbit')
    .bone('body', null, [0, .12, -.02])
    .bone('head', 'body', [0, .17, .07])
    .bone('tail', 'body', [0, .13, -.14])
    .bone('leg-fl', 'body', [.035, .1, .07])
    .bone('leg-fr', 'body', [-.035, .1, .07])
    .bone('leg-bl', 'body', [.055, .11, -.06])
    .bone('leg-br', 'body', [-.055, .11, -.06]);

  const fur = 0x8a7862, back = 0x6f5f4c, belly = 0xd9ccb4;
  const body = coat(fur, back, belly, .4, -.3);
  rig
    .add('body', 'hide', hide, blob([0, .122, -.035], [.074, .084, .112], [12, 9]), body)
    .add('body', 'hide', hide, blob([0, .13, -.075], [.078, .088, .08], [10, 8]), body)
    .add('body', 'hide', hide, blob([0, .118, .045], [.058, .07, .062], [10, 7]), body);

  const face = coat(fur, back, belly, .55, -.35);
  rig
    .add('head', 'hide', hide, blob([0, .198, .108], [.045, .047, .058], [10, 8], [-.25, 0, 0]), face)
    .add('head', 'hide', hide, blob([0, .186, .14], [.03, .026, .03], [8, 6]), face)
    .add('head', 'hide', hide, blob([0, .19, .163], [.011, .009, .007], [6, 4]), 0xc98a82, 0);
  for (const s of [1, -1]) {
    rig
      .add('head', 'hide', hide, blob(sx(s, [.036, .214, .128]), [.011, .012, .01], [6, 4]), 0x120e0c, 0)
      .add('head', 'hide', hide, blob(sx(s, [.021, .282, .07]), [.018, .068, .009], [7, 6], [-.4, s * .25, s * -.18]), coat(fur, back, fur, .6, -.9))
      .add('head', 'hide', hide, blob(sx(s, [.021, .284, .078]), [.011, .052, .004], [6, 5], [-.4, s * .25, s * -.18]), 0xd39c8e, .02);
  }

  rig.add('tail', 'hide', hide, blob([0, .135, -.148], [.028, .028, .024], [8, 6]), 0xf4f0e8, .02);

  const leg = coat(fur, back, belly, .5, -.2);
  for (const [name, s] of LEGS) {
    rig
      .add(name, 'hide', hide, limb(sx(s, [.035, .1, .07]), sx(s, [.036, .014, .085]), .015, .011, 6), leg)
      .add(name, 'hide', hide, blob(sx(s, [.036, .01, .092]), [.014, .01, .02], [6, 4]), belly);
  }
  for (const [name, s] of HIND) {
    rig
      .add(name, 'hide', hide, blob(sx(s, [.058, .092, -.07]), [.034, .058, .064], [9, 7]), body)
      .add(name, 'hide', hide, blob(sx(s, [.056, .012, -.03]), [.019, .012, .056], [7, 5]), leg);
  }
  return rig.shadow(.1, .16, -.02).build();
}

// ---- Hollow ash-wolf ----------------------------------------------------------------

function makeWolf(): Group {
  // Canine stance: shoulder ~0.78 m, angled elbows and a Z-shaped hind leg (stifle, hock, cannon).
  const rig = new Rig('wolf')
    .bone('body', null, [0, .58, 0])
    .bone('head', 'body', [0, .7, .34])
    .bone('tail', 'body', [0, .63, -.5])
    .bone('leg-fl', 'body', [.09, .56, .24])
    .bone('leg-fr', 'body', [-.09, .56, .24])
    .bone('leg-bl', 'body', [.08, .58, -.34])
    .bone('leg-br', 'body', [-.08, .58, -.34]);

  // Charcoal flanks, pale ash along the back, near-black underneath.
  const ash = coat(0x302d2b, 0x8c867e, 0x1b1a19, .25, -.3, .55);
  const leg = coat(0x2a2826, 0x5e5953, 0x181716, .5, -.4);

  const torso = new Loft([0, .57, -.05], .5, [
    [-1, .075, .1, .08, .03], [-.62, .105, .13, .11, .02], [-.18, .08, .12, .07, .025], [.35, .145, .2, .21, .02], [1, .11, .16, .15, .06],
  ]);
  rig.add('body', 'hide', hide, torso.geometry(16, 12), ash, .16);
  for (const s of [1, -1]) {
    // Bony hip points and a ragged chest ruff.
    rig
      .add('body', 'hide', hide, blob(sx(s, [.058, .675, -.35]), [.024, .018, .036], [6, 4]), 0x5a554f, .1)
      .add('body', 'hide', hide, spike(sx(s, [.055, .44, .25]), sx(s, [.06, .37, .2]), .028, 4, .6), 0x252321, .1);
  }
  rig.add('body', 'hide', hide, spike([0, .41, .3], [0, .34, .25], .03, 4, .6), 0x252321, .1);
  // Hackles: a ragged ridge of ash spikes from the withers to the hips.
  const hackles: [Vec3, Vec3, number][] = [
    [[0, .77, .2], [0, .86, .13], .034], [[0, .78, .1], [0, .86, .02], .036], [[0, .76, -.01], [0, .825, -.08], .032],
    [[0, .73, -.12], [0, .78, -.18], .027], [[0, .71, -.25], [0, .75, -.31], .024], [[0, .71, -.37], [0, .74, -.43], .022],
  ];
  for (const [a, b, r] of hackles) rig.add('body', 'hide', hide, spike(a, b, r, 4, .6), 0x4a4540, .12);

  // Head: long neck into a narrow lofted skull, a solid muzzle with an under-jaw wedge, pointed ears.
  const skull = new Loft([0, .74, .6], .16, [
    [-1, .06, .062, .055, .01], [-.45, .074, .07, .058, .01], [.1, .05, .046, .054, -.012], [.6, .038, .036, .044, -.026], [1, .028, .026, .03, -.032],
  ]);
  const EYE = skull.point(-.3, 1.0, new Vector3());
  const eyeDark: Shade = (out, x, y, z, nx, ny, nz) => {
    ash(out, x, y, z, nx, ny, nz);
    // Hollow, sooty sockets around the ember eyes.
    const socket = Math.min(Math.hypot(x - EYE.x, y - EYE.y, z - EYE.z), Math.hypot(x + EYE.x, y - EYE.y, z - EYE.z));
    out.lerp(tmpColor2.setHex(0x080707), smoothstep(.042, .018, socket));
  };
  const nose = skull.point(1, 0, new Vector3());
  rig
    .add('head', 'hide', hide, limb([0, .64, .28], [0, .74, .48], .1, .06, 10, false), ash, .16)
    .add('head', 'hide', hide, skull.geometry(12, 10), eyeDark, .1)
    .add('head', 'hide', hide, limb([0, .7, .55], [0, .69, .71], .042, .028, 8, false), 0x1f1d1c, .05)
    .add('head', 'hide', hide, spike([0, .675, .55], [0, .668, .69], .038, 5, .4), 0x181716, .05)
    .add('head', 'hide', hide, blob([nose.x, nose.y + .002, nose.z - .012], [.024, .017, .014], [6, 4]), 0x0c0b0b, 0);
  for (const s of [1, -1]) {
    const eye = skull.point(-.3, s * 1.0, new Vector3());
    const n = skull.normal(-.3, s * 1.0, new Vector3());
    rig
      .add('head', 'hide', hide, spike(sx(s, [.045, .8, .5]), sx(s, [.07, .92, .47]), .033, 4, .55), 0x2a2725, .1)
      .add('head', 'hide', hide, spike(sx(s, [.07, .7, .42]), sx(s, [.105, .63, .32]), .036, 4, .6), 0x4a4540, .1)
      .add('head', 'eyes', eyeGlow, blob([eye.x + n.x * .003, eye.y + n.y * .003, eye.z + n.z * .003], [.025, .013, .01], [6, 4], [0, s * .55, s * .3]), 0xffffff, 0);
  }
  rig.add('head', 'hide', hide, spike([0, .74, .34], [0, .72, .24], .05, 5, .7), 0x4a4540, .1);

  // Tail: slim, tapering brush carried low behind the hips.
  rig
    .add('tail', 'hide', hide, limb([0, .64, -.49], [0, .56, -.6], .03, .036, 8), ash, .14)
    .add('tail', 'hide', hide, limb([0, .56, -.6], [0, .41, -.72], .036, .008, 8, false), ash, .14)
    .add('tail', 'hide', hide, spike([0, .53, -.62], [.022, .46, -.68], .02, 4), 0x2b2826, .1);

  // Forelegs: upper arm angles back to the elbow, forearm down, pastern canted forward to the paw.
  for (const [name, s] of LEGS) {
    rig
      .add(name, 'hide', hide, limb(sx(s, [.09, .6, .26]), sx(s, [.085, .34, .2]), .068, .036, 8), leg, .1)
      .add(name, 'hide', hide, blob(sx(s, [.085, .34, .2]), [.033, .036, .036], [6, 4]), leg, .1)
      .add(name, 'hide', hide, limb(sx(s, [.085, .34, .2]), sx(s, [.085, .09, .235]), .03, .022, 7), leg, .1)
      .add(name, 'hide', hide, blob(sx(s, [.085, .09, .235]), [.024, .026, .025], [6, 4]), leg, .1)
      .add(name, 'hide', hide, limb(sx(s, [.085, .09, .235]), sx(s, [.085, .035, .262]), .022, .024, 6), leg, .1)
      .add(name, 'hide', hide, blob(sx(s, [.085, .027, .278]), [.034, .028, .05], [7, 5]), 0x1d1b1a, .06);
  }
  // Hind legs: a thigh that blends into the flank, gaskin back to a high hock, cannon forward to the paw.
  const thigh = (s: number): Vec3 => sx(s, [.05, .575, -.31]);
  const thighR: Vec3 = [.055, .15, .11];
  for (const [name, s] of HIND) {
    rig
      .add(name, 'hide', hide, blob(thigh(s), thighR, [10, 8]), ash, .14)
      .add(name, 'hide', hide, limb(sx(s, [.07, .47, -.27]), sx(s, [.08, .2, -.45]), .052, .03, 8), leg, .1)
      .add(name, 'hide', hide, blob(sx(s, [.08, .2, -.45]), [.026, .03, .03], [6, 4]), leg, .1)
      .add(name, 'hide', hide, limb(sx(s, [.08, .2, -.45]), sx(s, [.08, .04, -.37]), .024, .02, 7), leg, .1)
      .add(name, 'hide', hide, blob(sx(s, [.08, .025, -.35]), [.032, .026, .047], [7, 5]), 0x1d1b1a, .06);
    // Ember crack down the outside of each haunch.
    rig.add(name, 'embers', embers, blobCrack(thigh(s), thighR, [[s, .75, .15], [s, .4, -.12], [s, .12, .1], [s, -.2, -.08], [s * .8, -.55, .05]], .014), 0xffffff, 0);
  }

  // Ember cracks: split ribs on each flank, a broken spine seam, the brow and mid-tail.
  for (const s of [1, -1]) {
    const a = (v: number) => s * v;
    rig
      .add('body', 'embers', embers, loftCrack(torso, [[.5, a(.55)], [.44, a(.85)], [.5, a(1.15)], [.42, a(1.45)], [.48, a(1.8)], [.4, a(2.15)]], .02), 0xffffff, 0)
      .add('body', 'embers', embers, loftCrack(torso, [[.22, a(.7)], [.28, a(1.0)], [.2, a(1.3)], [.26, a(1.6)], [.18, a(1.95)]], .016), 0xffffff, 0)
      .add('body', 'embers', embers, loftCrack(torso, [[.27, a(1.3)], [.36, a(1.42)], [.42, a(1.38)]], .01), 0xffffff, 0)
      .add('body', 'embers', embers, loftCrack(torso, [[-.55, a(.5)], [-.6, a(.85)], [-.52, a(1.15)], [-.6, a(1.5)]], .016), 0xffffff, 0);
  }
  rig
    .add('body', 'embers', embers, loftCrack(torso, [[.75, .06], [.6, -.08], [.45, .07], [.3, -.05], [.15, .06], [0, -.04]], .016), 0xffffff, 0)
    .add('body', 'embers', embers, loftCrack(torso, [[-.25, .05], [-.4, -.06], [-.55, .04], [-.72, -.03]], .012), 0xffffff, 0)
    .add('head', 'embers', embers, loftCrack(skull, [[-.75, .1], [-.55, -.08], [-.35, .06], [-.15, -.05], [.05, .04]], .012), 0xffffff, 0)
    .add('tail', 'embers', embers, blobCrack([0, .565, -.6], [.036, .06, .036], [[.3, 1, .2], [1, .4, -.1], [.6, -.3, -.5], [-.4, -.8, -.4]], .012), 0xffffff, 0);
  return rig.shadow(.24, .6, -.07).build();
}

export const deer = makeDeer();
export const rabbit = makeRabbit();
export const wolf = makeWolf();

export const creatureAssets = { deer, rabbit, wolf };
