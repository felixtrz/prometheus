/**
 * Grabbable item prototypes (items build). Every prototype is parentless and
 * deterministic, with its origin at the grip centre and long tools running along
 * +Y toward the working end (tips and rest poses live in src/game/catalog.ts).
 *
 * Named children are gameplay contracts (torch-flame, flame, raw/roast,
 * bowl-contents/broth, loaded-bolt, muzzle, kit/deployed/turret). Everything else
 * is baked into one draw per material inside each named scope, so every item
 * stays within four draws. Colour is baked per vertex; the few shared materials
 * carry low-frequency procedural grain, weave and leather maps.
 */
import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, ExtrudeGeometry,
  Float32BufferAttribute, Group, IcosahedronGeometry, LatheGeometry, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, RGBAFormat, RepeatWrapping, SRGBColorSpace, Shape, SphereGeometry,
  TorusGeometry, Vector2, Vector3,
} from '@iwsdk/core';
import type { Material } from '@iwsdk/core';
import { smoothSampling } from './procedural-textures.js';

type V3 = [number, number, number];
type Paint = number | ((x: number, y: number, z: number, nx: number, ny: number, nz: number) => number);

const TAU = Math.PI * 2;
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const colorA = new Color();
const colorB = new Color();
const mixHex = (a: number, b: number, t: number): number => colorA.setHex(a).lerp(colorB.setHex(b), clamp01(t)).getHex();

// ---------------------------------------------------------------------------
// Procedural maps: near-white so the baked vertex colour stays truthful.

function greyTexture(size: number, value: (x: number, y: number) => number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.max(0, Math.min(255, Math.round(value(x, y))));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return smoothSampling(texture);
}
const K = TAU / 64; // one period across a 64 px tile, so every map tiles seamlessly
/** Planed grain: streaks run along V (cylinder length, box height). */
const grainMap = greyTexture(64, (x, y) =>
  236 + 11 * Math.sin(x * 6 * K + Math.sin(y * K) * 1.8) + 5 * Math.sin(x * 22 * K + y * 2 * K) - 4 * Math.max(0, Math.sin(x * 3 * K - y * K)));
/** Bark: deep, wandering ridges along V. */
const barkMap = greyTexture(64, (x, y) => {
  const ridge = .5 + .5 * Math.sin(x * 7 * K + 1.6 * Math.sin(y * 2 * K + x * K));
  return 200 + 44 * Math.pow(ridge, 1.6) + 8 * Math.sin(y * 9 * K + x * 2 * K);
});
/** Twill: diagonal ribs, reads as woven cloth or as twisted cord along a tube. */
const twillMap = greyTexture(64, (x, y) => 226 + 17 * Math.sin((x + y) * 8 * K) + 6 * Math.sin((x - y) * 16 * K));
/** Leather: soft, low-frequency grain with a little pore noise. */
const leatherMap = greyTexture(64, (x, y) =>
  234 + 6 * Math.sin(y * 3 * K + 2 * Math.sin(x * K)) + 5 * Math.sin((x + 2 * y) * 5 * K) + 6 * (hash(x * 64 + y) - .5));

/** Handwritten journal page (both faces sample it; the back is mirrored in UV). */
function pageTexture(): DataTexture {
  const W = 128, H = 180;
  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const stain = .5 + .5 * Math.sin(x * .05 + y * .031) * Math.sin(y * .043 - x * .021);
      const edge = Math.min(x, W - 1 - x, y, H - 1 - y);
      const burn = edge < 7 ? .84 + .023 * edge : 1;
      const fox = hash(Math.floor(x / 9) * 31 + Math.floor(y / 9)) > .93 ? .95 : 1;
      const f = (1 - .07 * stain) * burn * fox;
      const i = (y * W + x) * 3;
      rgb[i] = 236 * f; rgb[i + 1] = 224 * f; rgb[i + 2] = 192 * f * (1 - .04 * stain);
    }
  }
  const ink = (x: number, y: number, a: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (Math.round(y) * W + Math.round(x)) * 3;
    rgb[i] = lerp(rgb[i], 54, a); rgb[i + 1] = lerp(rgb[i + 1], 44, a); rgb[i + 2] = lerp(rgb[i + 2], 62, a);
  };
  const scribble = (x0: number, x1: number, baseline: number, seed: number, weight: number) => {
    let x = x0, word = 0;
    while (x < x1) {
      const len = 5 + Math.floor(hash(seed * 13 + word) * 15);
      for (let k = 0; k < len && x + k < x1; k++) {
        const px = x + k;
        const py = baseline + 1.3 * Math.sin(px * 1.25 + seed * 2.1) + (hash(px * 7 + seed) > .86 ? -2 : 0);
        for (let w = 0; w < weight; w++) ink(px, py - w, .88);
        if (hash(px * 3.1 + seed * 5.7) > .9) for (let h = 1; h < 4; h++) ink(px, py - weight - h, .7);
      }
      x += len + 4;
      word++;
    }
  };
  scribble(14, 78, 17, 1, 3);
  ink(14, 21, 0);
  for (let line = 0; line < 13; line++) {
    const end = line === 5 || line === 12 ? 60 + Math.floor(hash(line) * 20) : 114;
    scribble(line === 6 ? 20 : 12, end, 31 + line * 10, line + 3, 2);
  }
  // A small margin sketch of the pierced Spire under a sun.
  for (let t = 0; t <= 1; t += .02) {
    ink(96 + t * 7, 170 - t * 24, .8); ink(110 - t * 7, 170 - t * 24, .8); ink(92 + t * 22, 170, .8);
    ink(112 + Math.cos(t * TAU) * 4, 147 + Math.sin(t * TAU) * 4, .7);
  }
  for (let t = 0; t <= 1; t += .1) ink(103 + Math.cos(t * TAU) * 1.5, 158 + Math.sin(t * TAU) * 1.5, .8);
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const src = (y * W + x) * 3;
      const dst = ((H - 1 - y) * W + x) * 4; // image row 0 is the top of the page (v = 1)
      data[dst] = rgb[src]; data[dst + 1] = rgb[src + 1]; data[dst + 2] = rgb[src + 2]; data[dst + 3] = 255;
    }
  }
  const texture = new DataTexture(data, W, H, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  return smoothSampling(texture, 8);
}

// ---------------------------------------------------------------------------
// Shared materials (one instance each for the whole module).

const named = <T extends Material>(material: T, name: string): T => {
  material.name = name;
  return material;
};
const woodMat = named(new MeshStandardMaterial({ vertexColors: true, map: grainMap, roughness: .74 }), 'Item wood');
const barkMat = named(new MeshStandardMaterial({ vertexColors: true, map: barkMap, roughness: .95 }), 'Item bark');
const metalMat = named(new MeshStandardMaterial({ vertexColors: true, roughness: .4, metalness: .55 }), 'Item metal');
const fibreMat = named(new MeshStandardMaterial({ vertexColors: true, map: twillMap, roughness: .96 }), 'Item fibre');
const leatherMat = named(new MeshStandardMaterial({ vertexColors: true, map: leatherMap, roughness: .7 }), 'Item leather');
const organicMat = named(new MeshStandardMaterial({ vertexColors: true, roughness: .58 }), 'Item organic');
const leafMat = named(new MeshStandardMaterial({ vertexColors: true, roughness: .7, side: DoubleSide }), 'Item leaf');
const stoneMat = named(new MeshStandardMaterial({ vertexColors: true, roughness: .3, metalness: .05 }), 'Item knapped stone');
// Warm self-glow stands in for translucency without transmission or sorting.
const amberMat = named(new MeshStandardMaterial({
  vertexColors: true, roughness: .1, metalness: .12, emissive: 0x6e2602, emissiveIntensity: .6,
}), 'Item amber resin');
const brothMat = named(new MeshStandardMaterial({ color: 0x874927, roughness: .3 }), 'Stew broth');
// Pages are flat and pale: a faint warm self-light (through their own ink, so the writing stays
// dark) lifts them off dirt, stone and pale wood so they read as things to pick up.
const pageMap = pageTexture();
const paperMat = named(new MeshStandardMaterial({
  map: pageMap, roughness: .9, emissive: 0xffb347, emissiveMap: pageMap, emissiveIntensity: .26,
}), 'Journal paper');
// Flames carry a base-to-tip vertex gradient; their groups' origins sit at the flame base.
const flameOuter = named(new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .8, depthWrite: false, side: DoubleSide }), 'Torch flame');
const flameCore = named(new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .95, depthWrite: false, side: DoubleSide }), 'Torch flame core');
const lighterFlame = named(new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .88, depthWrite: false }), 'Lighter flame');
const lighterCore = named(new MeshBasicMaterial({ vertexColors: true }), 'Lighter flame core');

// ---------------------------------------------------------------------------
// Geometry helpers. Every geometry gets a baked vertex colour.

/** Bake a colour (or a colour function of position and normal) with gentle value drift. */
function tint<T extends BufferGeometry>(geometry: T, paint: Paint, variation = .04): T {
  const p = geometry.getAttribute('position');
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const n = geometry.getAttribute('normal');
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    colorA.setHex(typeof paint === 'number' ? paint : paint(x, y, z, n.getX(i), n.getY(i), n.getZ(i)));
    const drift = 1 + variation * (Math.sin(x * 41.3 + z * 23.1) * .6 + Math.sin(y * 31.7 - x * 17.9) * .4);
    colors[i * 3] = colorA.r * drift;
    colors[i * 3 + 1] = colorA.g * drift;
    colors[i * 3 + 2] = colorA.b * drift;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}
/** Per-triangle colour for faceted natural forms (non-indexed geometry). */
function faceTint(geometry: BufferGeometry, paint: (face: number, c: Vector3, n: Vector3) => number): BufferGeometry {
  const p = geometry.getAttribute('position');
  const colors = new Float32Array(p.count * 3);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), centre = new Vector3(), normal = new Vector3();
  for (let f = 0; f < p.count / 3; f++) {
    a.fromBufferAttribute(p, f * 3); b.fromBufferAttribute(p, f * 3 + 1); c.fromBufferAttribute(p, f * 3 + 2);
    centre.copy(a).add(b).add(c).divideScalar(3);
    normal.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    colorA.setHex(paint(f, centre, normal));
    for (let k = 0; k < 3; k++) colorA.toArray(colors, (f * 3 + k) * 3);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}
/** Split shared vertices so every face shades flat (knapped stone, forged iron). */
function faceted(geometry: BufferGeometry): BufferGeometry {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  result.deleteAttribute('normal');
  result.computeVertexNormals();
  return result;
}
/** Weld coincident vertices so extrusions shade smoothly (soft food). UVs are dropped. */
function welded(geometry: BufferGeometry): BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = source.getAttribute('position');
  const ids = new Map<string, number>();
  const positions: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 2e4)},${Math.round(p.getY(i) * 2e4)},${Math.round(p.getZ(i) * 2e4)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      ids.set(key, id);
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
    }
    index.push(id);
  }
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(positions, 3));
  result.setIndex(index);
  result.computeVertexNormals();
  return result;
}
/** Scale UVs so a map tiles every `tile` metres (fibre, bark, leather wraps). */
function tiled<T extends BufferGeometry>(geometry: T, uLength: number, vLength: number, tile = .05): T {
  const uv = geometry.getAttribute('uv');
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uLength / tile, uv.getY(i) * vLength / tile);
  return geometry;
}

const box = (size: V3, paint: Paint, variation = .04, segments: V3 = [1, 1, 1]) =>
  tint(new BoxGeometry(size[0], size[1], size[2], segments[0], segments[1], segments[2]), paint, variation);
const cyl = (top: number, bottom: number, height: number, segments: number, paint: Paint, variation = .04, heightSegments = 1, open = false) =>
  tint(new CylinderGeometry(top, bottom, height, segments, heightSegments, open), paint, variation);
const torus = (radius: number, tube: number, paint: Paint, tubular = 14, radial = 5, arc = TAU, variation = .03) =>
  tint(new TorusGeometry(radius, tube, radial, tubular, arc), paint, variation);
const ball = (radius: number, width: number, height: number, paint: Paint, variation = .03) =>
  tint(new SphereGeometry(radius, width, height), paint, variation);
/** Twine or cord ring with a twisted-fibre UV scale. */
const cordRing = (radius: number, tube: number, color: number, tubular = 14, arc = TAU, radial = 4) =>
  tiled(torus(radius, tube, color, tubular, radial, arc), radius * arc, tube * TAU, .03);

function put(parent: Object3D, geometry: BufferGeometry, material: Material, at: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale?: V3): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...at);
  mesh.rotation.set(...rotation);
  if (scale) mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}
const Y_UP = new Vector3(0, 1, 0);
/** A Y-aligned geometry of the right length stretched between two points. */
function strut(parent: Object3D, from: V3, to: V3, make: (length: number) => BufferGeometry, material: Material): Mesh {
  const a = new Vector3(...from), b = new Vector3(...to);
  const mesh = new Mesh(make(a.distanceTo(b)), material);
  mesh.position.copy(a).add(b).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(Y_UP, b.sub(a).normalize());
  parent.add(mesh);
  return mesh;
}
function group(name = '', at: V3 = [0, 0, 0], rotation: V3 = [0, 0, 0], scale = 1): Group {
  const result = new Group();
  result.name = name;
  result.position.set(...at);
  result.rotation.set(...rotation);
  result.scale.setScalar(scale);
  return result;
}
const pathOf = (count: number, at: (t: number) => V3): Vector3[] =>
  Array.from({ length: count + 1 }, (_, i) => new Vector3(...at(i / count)));

type SweepOptions = {
  /** Section half-extents at t (0..1 along the path): along the frame normal, then binormal. */
  radius: number | [number, number] | ((t: number) => number | [number, number]);
  radial: number;
  paint: number | ((t: number, angle: number) => number);
  variation?: number;
  /** Seeds the frame normal; the section's first radius points this way. */
  up?: V3;
  caps?: boolean;
  capPaint?: number;
  /** Metres per texture tile along the path. */
  tile?: number;
};
/** Tube with a varying elliptical section along a polyline (parallel-transport frames). */
function sweep(path: Vector3[], options: SweepOptions): BufferGeometry {
  const { radial } = options;
  const count = path.length;
  const lengths = [0];
  for (let i = 1; i < count; i++) lengths.push(lengths[i - 1] + path[i].distanceTo(path[i - 1]));
  const total = lengths[count - 1] || 1;
  const tile = options.tile ?? .05;
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], uvs: number[] = [], index: number[] = [];
  const tangent = new Vector3(), normal = new Vector3(...(options.up ?? [0, 0, 1])), binormal = new Vector3();
  const point = new Vector3(), n = new Vector3();
  const color = (t: number, angle: number, variation: number, at: Vector3) => {
    colorA.setHex(typeof options.paint === 'number' ? options.paint : options.paint(t, angle));
    const drift = 1 + variation * (Math.sin(at.x * 41.3 + at.z * 23.1) * .6 + Math.sin(at.y * 31.7 - at.x * 17.9) * .4);
    colors.push(colorA.r * drift, colorA.g * drift, colorA.b * drift);
  };
  const variation = options.variation ?? .04;
  const frames: { p: Vector3; t: Vector3; n: Vector3; b: Vector3; r: [number, number] }[] = [];
  for (let i = 0; i < count; i++) {
    tangent.subVectors(path[Math.min(i + 1, count - 1)], path[Math.max(i - 1, 0)]).normalize();
    normal.addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < 1e-8) normal.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
    normal.normalize();
    binormal.crossVectors(tangent, normal);
    const raw = typeof options.radius === 'function' ? options.radius(lengths[i] / total) : options.radius;
    const r: [number, number] = typeof raw === 'number' ? [raw, raw] : raw;
    frames.push({ p: path[i], t: tangent.clone(), n: normal.clone(), b: binormal.clone(), r });
  }
  frames.forEach((frame, i) => {
    for (let j = 0; j <= radial; j++) {
      const angle = j / radial * TAU, c = Math.cos(angle), s = Math.sin(angle);
      point.copy(frame.p).addScaledVector(frame.n, c * frame.r[0]).addScaledVector(frame.b, s * frame.r[1]);
      n.copy(frame.n).multiplyScalar(c / Math.max(frame.r[0], 1e-4)).addScaledVector(frame.b, s / Math.max(frame.r[1], 1e-4)).normalize();
      positions.push(point.x, point.y, point.z);
      normals.push(n.x, n.y, n.z);
      uvs.push(lengths[i] / tile, j / radial);
      color(lengths[i] / total, angle, variation, point);
    }
  });
  for (let i = 0; i < count - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  if (options.caps) {
    for (const end of [0, count - 1]) {
      const frame = frames[end];
      const sign = end === 0 ? -1 : 1;
      const centre = positions.length / 3;
      positions.push(frame.p.x, frame.p.y, frame.p.z);
      normals.push(frame.t.x * sign, frame.t.y * sign, frame.t.z * sign);
      uvs.push(.5, .5);
      colorA.setHex(options.capPaint ?? (typeof options.paint === 'number' ? options.paint : options.paint(end ? 1 : 0, 0)));
      colors.push(colorA.r, colorA.g, colorA.b);
      for (let j = 0; j <= radial; j++) {
        const src = end * (radial + 1) + j;
        positions.push(positions[src * 3], positions[src * 3 + 1], positions[src * 3 + 2]);
        normals.push(frame.t.x * sign, frame.t.y * sign, frame.t.z * sign);
        const angle = j / radial * TAU;
        uvs.push(.5 + .5 * Math.cos(angle), .5 + .5 * Math.sin(angle));
        colors.push(colorA.r, colorA.g, colorA.b);
      }
      for (let j = 0; j < radial; j++) {
        if (sign > 0) index.push(centre, centre + 1 + j, centre + 2 + j);
        else index.push(centre, centre + 2 + j, centre + 1 + j);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  return geometry;
}

/** Leaf along +X from its stalk at the origin; the blade folds up along the midrib. */
function leaf(length: number, width: number, color: number, rib: number, options: { fold?: number; curl?: number; segments?: number; edge?: number } = {}): BufferGeometry {
  const segments = options.segments ?? 6;
  const across = [-1, -.5, 0, .5, 1];
  const positions: number[] = [], colors: number[] = [], index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const half = width / 2 * Math.max(.05, Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.04)), .7));
    for (const s of across) {
      const z = s * half;
      const y = (options.fold ?? .35) * Math.abs(s) * half + (options.curl ?? 0) * u * u * length;
      positions.push(u * length, y, z);
      colorA.setHex(s === 0 ? rib : mixHex(color, options.edge ?? color, Math.abs(s)));
      colors.push(colorA.r, colorA.g, colorA.b);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let k = 0; k < across.length - 1; k++) {
      const a = i * across.length + k, b = a + 1, c = a + across.length, d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** Archimedean spiral in the YZ plane: rolled layers seen on the end of a roll. */
const spiral = (x: number, inner: number, outer: number, turns: number, count: number): Vector3[] =>
  pathOf(count, (t) => {
    const angle = t * turns * TAU, r = lerp(inner, outer, t);
    return [x, Math.cos(angle) * r, Math.sin(angle) * r];
  });

type Tongue = { r: number; h: number; at?: V3; tilt?: V3 };
/**
 * Flame tongues growing up (+Y) from the parent's origin, which is the flame base,
 * merged into one mesh. `stops` colour base, middle and tip.
 */
function flameMesh(tongues: Tongue[], stops: [number, number, number], material: Material, segments = 9): Mesh {
  const holder = new Group();
  for (const { r, h, at = [0, 0, 0] as V3, tilt = [0, 0, 0] as V3 } of tongues) {
    const profile = [[.55, 0], [1, .14], [.86, .34], [.55, .6], [.22, .85], [0, 1]].map(([pr, py]) => new Vector2(r * pr, h * py));
    const g = tint(new LatheGeometry(profile, segments), (_x, y) => {
      const t = y / h;
      return t < .5 ? mixHex(stops[0], stops[1], smoothstep(.04, .5, t)) : mixHex(stops[1], stops[2], smoothstep(.5, 1, t));
    }, 0);
    put(holder, g, material, at, tilt);
  }
  holder.updateMatrixWorld(true);
  const mesh = new Mesh(mergeMeshes(holder.children as Mesh[], material, new Matrix4()), material);
  mesh.name = `${material.name} tongues`;
  return mesh;
}

// ---------------------------------------------------------------------------
// Baking: one draw per material inside every named scope.

function mergeMeshes(meshes: Mesh[], material: Material, inverse: Matrix4): BufferGeometry {
  const wantsColor = material.vertexColors;
  const wantsUv = 'map' in material && !!(material as MeshStandardMaterial).map;
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], uvs: number[] = [];
  const relative = new Matrix4();
  for (const mesh of meshes) {
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    relative.multiplyMatrices(inverse, mesh.matrixWorld);
    geometry.applyMatrix4(relative);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
    const c = geometry.getAttribute('color'), uv = geometry.getAttribute('uv');
    const flip = relative.determinant() < 0;
    for (let i = 0; i < p.count; i++) {
      const v = flip ? i - (i % 3) + [0, 2, 1][i % 3] : i;
      positions.push(p.getX(v), p.getY(v), p.getZ(v));
      normals.push(n.getX(v), n.getY(v), n.getZ(v));
      if (wantsColor) colors.push(c ? c.getX(v) : 1, c ? c.getY(v) : 1, c ? c.getZ(v) : 1);
      if (wantsUv) uvs.push(uv ? uv.getX(v) : 0, uv ? uv.getY(v) : 0);
    }
    geometry.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new Float32BufferAttribute(positions, 3));
  merged.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  if (wantsColor) merged.setAttribute('color', new Float32BufferAttribute(colors, 3));
  if (wantsUv) merged.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

/**
 * Merge opaque, unnamed meshes per material within the root and within every
 * named descendant group, preserving named objects (contracts) and their
 * transforms. Transparent meshes (flames) are kept as authored.
 */
function bake<T extends Object3D>(root: T): T {
  root.updateMatrixWorld(true);
  const scopes = new Map<Object3D, Mesh[]>([[root, []]]);
  const walk = (object: Object3D, scope: Object3D): void => {
    for (const child of object.children) {
      if (child.name) {
        if (!(child instanceof Mesh)) {
          scopes.set(child, []);
          walk(child, child);
        }
        continue;
      }
      if (child instanceof Mesh && !Array.isArray(child.material) && !child.material.transparent) scopes.get(scope)!.push(child);
      walk(child, scope);
    }
  };
  walk(root, root);
  const inverse = new Matrix4();
  for (const [scope, meshes] of scopes) {
    if (!meshes.length) continue;
    inverse.copy(scope.matrixWorld).invert();
    const buckets = new Map<Material, Mesh[]>();
    for (const mesh of meshes) {
      const material = mesh.material as Material;
      const list = buckets.get(material);
      if (list) list.push(mesh);
      else buckets.set(material, [mesh]);
    }
    for (const mesh of meshes) mesh.removeFromParent();
    for (const [material, list] of buckets) {
      const mesh = new Mesh(mergeMeshes(list, material, inverse), material);
      mesh.name = `${material.name} (baked)`;
      scope.add(mesh);
    }
  }
  const prune = (object: Object3D): void => {
    for (const child of [...object.children]) {
      prune(child);
      if (!child.name && child instanceof Group && child.children.length === 0) child.removeFromParent();
    }
  };
  prune(root);
  return root;
}

// ---------------------------------------------------------------------------
// Palette (sRGB).

const C = {
  woodPale: 0xc9a06c, wood: 0xa8743f, woodMid: 0x8f5e38, woodDark: 0x6a4128, walnut: 0x7d4f30,
  bark: 0x5b402c, barkDark: 0x46311f, sap: 0xd6ab73, endRing: 0xb3824f, pith: 0x8a5b35,
  iron: 0x464e53, ironDark: 0x30363a, ironLight: 0x7f8a90, steel: 0xb9c2c6, rust: 0x7b4a2d,
  brass: 0xc99a4a, brassDark: 0x8f6a2e,
  linen: 0xd9caa6, linenShade: 0xb9a985, madder: 0xa4473a,
  twine: 0xb49a62, twineDark: 0x8a7447, cord: 0xd6cbb0,
  leather: 0x6e4b34, leatherDark: 0x4f3525, leatherLight: 0xa07248, binding: 0xc9a86f,
  leafGreen: 0x557a2f, leafDark: 0x3d5c22, leafRib: 0x93b05c,
};

// ---------------------------------------------------------------------------
// Existing first-playable items (contracts unchanged, detail upgraded).

/** Natural deadwood stick: bark, cut ends and trimmed branch stubs. r ≤ .048, length .5. */
function makeStick(): Group {
  const root = group('Stick');
  const path = pathOf(8, (t) => [Math.sin(t * 5.2 + .4) * .005, -.25 + t * .5, Math.sin(t * 7.1) * .004]);
  put(root, sweep(path, {
    radius: (t) => { const r = .043 - .011 * t + .0012 * Math.sin(t * 23); return [r, r * .94]; },
    radial: 9, caps: true, capPaint: C.sap, tile: .2,
    paint: (t, a) => mixHex(C.bark, 0x77583d, .5 + .5 * Math.sin(a * 3 + t * 17)),
  }), barkMat);
  const nubPaint: Paint = (_x, y) => (y > .016 ? C.sap : C.bark);
  put(root, cyl(.01, .015, .04, 6, nubPaint), barkMat, [0, .06, .026], [.85, 0, 0]);
  put(root, cyl(.009, .013, .034, 6, nubPaint), barkMat, [-.024, -.12, 0], [0, 0, .9]);
  // Lichen crusts.
  for (const [y, a] of [[-.02, 1.2], [.15, -2.2], [-.19, 2.8]]) {
    const r = .043 - .011 * (y + .25) / .5;
    put(root, ball(.012, 6, 4, 0x9ba585, .05), barkMat, [Math.cos(a) * r, y, Math.sin(a) * r], [0, -a, 0], [.35, 1, 1]);
  }
  return bake(root);
}

/** Bound linen roll, lying along X. r .105, length .33 (unchanged). */
function makeCloth(): Group {
  const root = group('Bound cloth roll');
  const radiusAt = (x: number) => .1025 + x * (.005 / .33);
  const body = tiled(cyl(.10, .105, .33, 16, C.linen, .05), .65, .33);
  put(root, body, fibreMat, [0, 0, 0], [0, 0, Math.PI / 2]);
  // Madder-red hem stripes and the loose outer edge of the wrap.
  for (const x of [-.132, -.118, .118, .132]) {
    put(root, tiled(cyl(radiusAt(x) + .0015, radiusAt(x) + .0015, .007, 16, C.madder, .03, 1, true), .65, .01), fibreMat, [x, 0, 0], [0, 0, Math.PI / 2]);
  }
  put(root, box([.33, .004, .034], C.linenShade), fibreMat, [0, Math.cos(.75) * .104, Math.sin(.75) * .104], [.75, 0, 0]);
  // Rolled layers on both ends.
  for (const side of [-1, 1]) {
    const x = side * .1652;
    put(root, tint(new CylinderGeometry(.097, .097, .002, 16), 0xa89777), fibreMat, [x, 0, 0], [0, 0, Math.PI / 2]);
    put(root, sweep(spiral(x + side * .0015, .01, .094, 3.4, 40), { radius: .0036, radial: 4, paint: 0xe4d8b8, tile: .03 }), fibreMat);
  }
  // Twine ties with a knot on top.
  for (const x of [-.09, .09]) {
    put(root, cordRing(radiusAt(x) + .004, .0055, C.twine, 18), fibreMat, [x, 0, 0], [0, Math.PI / 2, 0]);
    put(root, ball(.009, 6, 4, C.twineDark), fibreMat, [x, radiusAt(x) + .008, 0]);
    put(root, cyl(.003, .003, .03, 4, C.twine), fibreMat, [x + .008, radiusAt(x) + .004, .012], [.5, 0, -1.1]);
  }
  return bake(root);
}

/** Carved cooking spoon; bowl tip at (0,-.28,0), bowl opening toward +X so it rests bowl-up. */
function makeSpoon(): Group {
  const root = group('Long wooden cooking spoon');
  put(root, cyl(.019, .022, .44, 10, C.wood), woodMat, [0, -.035, 0]);
  put(root, cyl(.016, .021, .05, 10, C.wood), woodMat, [0, -.232, 0]);
  put(root, ball(.071, 14, 8, C.woodMid), woodMat, [0, -.28, 0], [0, 0, 0], [.3, 1, .78]);
  // The dark stained inset gives the bowl a readable concavity.
  put(root, ball(.057, 16, 8, 0x5e3a22), woodMat, [.0185, -.28, 0], [0, 0, 0], [.07, 1, .76]);
  put(root, ball(.024, 10, 6, C.woodMid), woodMat, [0, .19, 0], [0, 0, 0], [1, .8, 1]);
  put(root, cordRing(.0205, .0045, C.twine), fibreMat, [0, .16, 0], [Math.PI / 2, 0, 0]);
  put(root, cordRing(.0205, .0045, C.twine), fibreMat, [0, .145, 0], [Math.PI / 2, 0, 0]);
  put(root, cordRing(.02, .003, C.leatherDark, 12), fibreMat, [0, .222, 0], [0, Math.PI / 2, 0]);
  return bake(root);
}

/**
 * Double-faced crafting hammer: forged octagonal head at y .22, waisted at the eye,
 * with a polished striking face on each end at x = ±.119..±.123 (face points ±.123, .22, 0).
 */
function makeHammer(): Group {
  const root = group('Crafting hammer');
  put(root, cyl(.029, .036, .43, 12, C.wood), woodMat, [0, -.02, 0]);
  put(root, cyl(.037, .042, .04, 12, C.woodPale), woodMat, [0, -.235, 0]);
  // Leather grip with cord whipping at both ends.
  put(root, tiled(cyl(.0366, .0376, .12, 12, C.leather, .05), .23, .12), leatherMat, [0, -.15, 0]);
  for (const y of [-.212, -.088]) put(root, cordRing(.037, .004, C.twine), fibreMat, [0, y, 0], [Math.PI / 2, 0, 0]);
  put(root, torus(.034, .007, C.ironDark), metalMat, [0, .173, 0], [Math.PI / 2, 0, 0]);
  // Riveted iron langets strapping the handle below the eye.
  for (const z of [-.031, .031]) {
    put(root, box([.012, .065, .003], C.ironDark, .03), metalMat, [0, .152, z]);
    for (const y of [.132, .168]) put(root, ball(.0035, 6, 4, C.ironLight, 0), metalMat, [0, y, z * 1.06], [0, 0, 0], [1, 1, .5]);
  }
  // Forged head: an octagonal bar, waisted round the eye and swelling to a
  // bevelled shoulder before each polished face.
  const section = (t: number) => {
    const u = Math.abs(t * 2 - 1);
    return u > .92 ? lerp(.041, .034, (u - .92) / .08) : lerp(.033, .041, smoothstep(.2, .82, u));
  };
  const head = faceted(sweep(pathOf(14, (t) => [-.119 + .238 * t, 0, 0]), {
    radius: section, radial: 8, caps: true, up: [0, 1, 0], capPaint: C.steel,
    paint: (t) => { const u = Math.abs(t * 2 - 1); return u > .9 ? 0x76818a : u < .3 ? 0x434b50 : C.iron; },
  }));
  put(root, head, metalMat, [0, .22, 0], [Math.PI / 8, 0, 0]);
  for (const x of [-.121, .121]) put(root, cyl(.029, .029, .004, 8, 0xd0d7da, .01), metalMat, [x, .22, 0], [Math.PI / 8, 0, Math.PI / 2]);
  // Handle end and iron wedge showing through the eye; a smith's mark on each cheek.
  put(root, box([.028, .006, .046], C.woodPale), woodMat, [0, .2515, 0]);
  put(root, box([.005, .007, .042], C.ironDark), metalMat, [0, .252, 0]);
  for (const z of [-.0318, .0318]) put(root, cyl(.0045, .0045, .0012, 8, 0x262b2e, 0), metalMat, [.05, .22, z], [Math.PI / 2, 0, 0]);
  return bake(root);
}

/** Crafted torch; flame group 'torch-flame' at (0,.32,0), hidden until lit. */
function makeTorch(): Group {
  const root = group('Crafted torch');
  put(root, cyl(.037, .045, .56, 10, C.woodMid), woodMat, [0, .04, 0]);
  // Twine grip: a whipped sleeve with a raised turn at each end.
  put(root, tiled(cyl(.0428, .0438, .12, 12, C.twine, .05, 1, true), .27, .12, .03), fibreMat, [0, -.06, 0]);
  for (const y of [-.12, 0]) put(root, cordRing(.043, .006, C.twineDark, 12), fibreMat, [0, y, 0], [Math.PI / 2, 0, 0]);
  // Resin-soaked cloth head, darker and charred toward the top.
  const head = cyl(.082, .06, .15, 12, (x, y, z) => {
    const fold = Math.sin(Math.atan2(z, x) * 5 + y * 40);
    return mixHex(mixHex(0x8a7355, 0x3b2d22, smoothstep(-.05, .075, y)), 0x5b4633, .3 + .3 * fold);
  }, .05, 3);
  const hp = head.getAttribute('position');
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
    const bulge = 1 + .05 * Math.sin(Math.atan2(z, x) * 5 + y * 40);
    hp.setXYZ(i, x * bulge, y, z * bulge);
  }
  head.computeVertexNormals();
  put(root, tiled(head, .5, .15), fibreMat, [0, .285, 0]);
  for (const y of [.235, .27, .305, .34]) put(root, cordRing(.074 + (y - .23) * .045, .0085, C.twineDark, 12), fibreMat, [0, y, 0], [Math.PI / 2, 0, 0]);
  put(root, torus(.058, .012, C.ironDark), metalMat, [0, .21, 0], [Math.PI / 2, 0, 0]);
  // Resin drips run down from the head.
  for (const [a, y, s] of [[.6, .22, 1], [2.9, .235, .8], [4.4, .215, .9]]) {
    put(root, ball(.013 * s, 8, 6, (_x, py) => mixHex(0xa7520f, 0xf0a13c, py / .02 + .5)), amberMat, [Math.cos(a) * .062, y, Math.sin(a) * .062], [0, 0, 0], [.8, 1.6, .8]);
  }
  // Flame origin = flame base inside the head, so FxSystem can keep it pointing world-up.
  const flame = group('torch-flame', [0, .32, 0]);
  flame.visible = false;
  flame.add(flameMesh([
    { r: .082, h: .33 },
    { r: .05, h: .22, at: [.034, -.005, .008], tilt: [0, 0, -.32] },
    { r: .046, h: .19, at: [-.03, -.005, -.014], tilt: [.18, 0, .34] },
  ], [0xffe296, 0xff9529, 0xe0521c], flameOuter));
  flame.add(flameMesh([{ r: .05, h: .2, at: [0, 0, .01] }], [0xfffbe6, 0xffe9a0, 0xffc45a], flameCore, 8));
  root.add(flame);
  return bake(root);
}

/** Carved wooden bowl; 'bowl-contents' holds the 'broth' mesh (tinted at runtime) and stew bits. */
function makeStewBowl(): Group {
  const root = group('Wooden bowl');
  const profile = [
    new Vector2(.08, -.06), new Vector2(.12, -.048),
    new Vector2(.155, .015), new Vector2(.16, .075),
    new Vector2(.145, .075), new Vector2(.13, .015),
    new Vector2(.075, -.04),
  ];
  put(root, tint(new LatheGeometry(profile, 18), (_x, y, _z, _nx, ny) => (ny > .2 && y < .07 ? 0x7e5030 : C.wood), .06), woodMat);
  // Close the lathed profile so the empty bowl has a solid wooden bottom.
  put(root, cyl(.078, .078, .025, 18, 0x7e5030), woodMat, [0, -.0475, 0]);
  put(root, torus(.155, .011, C.woodPale, 24), woodMat, [0, .071, 0], [Math.PI / 2, 0, 0]);
  // Carved band below the rim.
  put(root, torus(.1585, .0028, C.woodDark, 24, 4), woodMat, [0, .048, 0], [Math.PI / 2, 0, 0]);
  const contents = group('bowl-contents');
  const broth = put(contents, cyl(.139, .139, .009, 18, 0xffffff, 0), brothMat, [0, .049, 0]);
  broth.name = 'broth';
  broth.geometry.deleteAttribute('color');
  const bits: [number, number, number, number][] = [[-.05, -.035, 0xa0503a, 1], [.048, -.03, 0xe3cf9f, .9], [-.04, .045, 0xa0503a, .85], [.05, .04, 0xe3cf9f, 1], [.0, .005, 0x6f8f3e, .7]];
  bits.forEach(([x, z, color, s], i) => {
    put(contents, tint(new IcosahedronGeometry(.022 * s, 0), color, .06), organicMat, [x, .058, z], [i, i * 2, 0], [1, .6, 1]);
  });
  root.add(contents);
  return bake(root);
}

/** Meat cut on the bone (0.8 scale, ~.27 m): 'raw' (visible) and 'roast' (hidden) share one silhouette. */
function makeMeat(): Group {
  const root = group('Meat cut');
  const outline = new Shape();
  const points = 26;
  for (let i = 0; i < points; i++) {
    const a = i / points * TAU;
    const r = 1 + .06 * Math.sin(3 * a + .4) + .04 * Math.cos(5 * a + 1);
    const x = Math.cos(a) * .124 * r - .006, y = Math.sin(a) * .083 * r;
    if (i === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  }
  outline.closePath();
  const slab = () => {
    const g = welded(new ExtrudeGeometry(outline, { depth: .066, bevelEnabled: true, bevelThickness: .012, bevelSize: .014, bevelSegments: 2, curveSegments: 4 }));
    g.rotateX(-Math.PI / 2);
    g.translate(0, -.033, 0);
    return g;
  };
  const variant = (name: string, look: { top: number; side: number; fat: number; bone: number; boneEnd: number; marks: number; roast: boolean }) => {
    const part = group(name);
    // Fat cap along the far (-Z) edge, lean muscle elsewhere.
    put(part, tint(slab(), (x, y, z) => {
      if (z < -.072) return look.fat;
      const lean = y > .03 ? look.top : look.side;
      return mixHex(lean, look.fat, look.roast ? 0 : smoothstep(.97, 1, Math.sin(x * 60 + Math.sin(z * 45) * 2)) * .8);
    }, .07), organicMat);
    if (look.roast) {
      // Seared grill marks: tapered dark grooves with a caramelised halo, sitting in the crust.
      for (const [x, l] of [[-.072, .055], [-.024, .068], [.024, .068], [.072, .055]]) {
        put(part, ball(1, 10, 3, 0x6a3517, .04), organicMat, [x, .0436, .005], [0, .45, 0], [.0115, .0016, l]);
        put(part, ball(1, 10, 3, look.marks, .03), organicMat, [x, .0443, .005], [0, .45, 0], [.0055, .0016, l * .92]);
      }
      for (const [x, z, a] of [[.1, .05, 0], [-.11, -.02, 1], [.02, .09, 2]]) put(part, ball(.012, 8, 5, 0x4a2410), organicMat, [x, .01, z], [0, a, 0], [1.2, .5, 1]);
    } else {
      // Marbling streaks across the lean top.
      for (const [x, z, a, l] of [[-.04, .02, .4, .07], [.03, -.02, -.3, .06], [.06, .04, .9, .04]]) put(part, box([l, .002, .005], look.fat, .03), organicMat, [x, .0452, z], [0, a, 0]);
    }
    // Bone through the cut with a knuckle on the +X end.
    put(part, cyl(.015, .017, .075, 10, look.bone), organicMat, [.14, .004, .018], [0, 0, Math.PI / 2]);
    put(part, ball(.021, 10, 7, look.boneEnd), organicMat, [.18, .004, .018], [0, 0, 0], [.8, 1, 1.2]);
    put(part, tint(new CylinderGeometry(.011, .011, .002, 10), 0xc9a27a), organicMat, [.1, .004, .018], [0, 0, Math.PI / 2]);
    return part;
  };
  // Scaled to 0.8 so the cut sits inside a pack cell and beside the other forage.
  const raw = variant('raw', { top: 0xab403b, side: 0x8c2f2e, fat: 0xecd6bd, bone: 0xe9dfc8, boneEnd: 0xf1e8d5, marks: 0, roast: false });
  const roast = variant('roast', { top: 0x93501f, side: 0x6e3616, fat: 0xd0954c, bone: 0xd8c29a, boneEnd: 0x4d3322, marks: 0x3a2212, roast: true });
  roast.visible = false;
  for (const part of [raw, roast]) {
    part.scale.setScalar(.8);
    root.add(part);
  }
  return bake(root);
}

/** Forest mushroom at 0.7 scale: cap r ≈ .10 at y .053, stem base at y -.1015. */
function makeMushroom(): Group {
  const top = group('Forest mushroom');
  const root = group('', [0, 0, 0], [0, 0, 0], .7);
  top.add(root);
  const stem = cyl(.045, .062, .18, 12, (_x, y) => mixHex(0x9c8260, 0xe4d2ab, smoothstep(-.09, -.03, y)), .04, 4);
  const sp = stem.getAttribute('position');
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i), y = sp.getY(i), z = sp.getZ(i);
    const bulb = 1 + .12 * Math.exp(-Math.pow((y + .06) / .03, 2)) + .03 * Math.sin(Math.atan2(z, x) * 3 + y * 20);
    sp.setXYZ(i, x * bulb, y, z * bulb);
  }
  stem.computeVertexNormals();
  put(root, stem, organicMat, [0, -.055, 0]);
  const capProfile = [
    [.042, -.004], [.06, -.012], [.11, -.02], [.139, -.017], [.148, -.004], [.143, .018],
    [.128, .042], [.1, .066], [.06, .084], [.02, .09], [0, .091],
  ].map(([r, y]) => new Vector2(r, y));
  put(root, tint(new LatheGeometry(capProfile, 18), (x, y, z, _nx, ny) => {
    if (ny < -.3) return 0xe8d4aa;
    return mixHex(0xc27a4a, 0x8f4128, smoothstep(.13, .06, Math.hypot(x, z)) + .15 * Math.sin(Math.atan2(z, x) * 4 + y * 30));
  }, .05), organicMat, [0, .075, 0]);
  // Gills radiating under the cap.
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * TAU;
    put(root, box([.07, .007, .0025], 0xc9b187, .02), organicMat, [Math.cos(a) * .095, .061, Math.sin(a) * .095], [0, -a, 0]);
  }
  // Pale speckles on the cap.
  const specks: [number, number, number][] = [[.05, .02, .9], [-.03, .07, .7], [-.07, -.03, 1], [.02, -.08, .8], [.09, -.05, .6], [-.02, -.01, .7], [.07, .07, .6]];
  for (const [x, z, s] of specks) {
    const r = Math.hypot(x, z);
    const y = .075 + .091 - 2.9 * r * r * .91;
    put(root, tint(new IcosahedronGeometry(.011 * s, 0), 0xf1e6cc, .03), organicMat, [x, y, z], [0, 0, 0], [1, .35, 1]);
  }
  put(root, torus(.05, .007, 0xe9dbb8, 14, 4), organicMat, [0, -.005, 0], [Math.PI / 2, 0, 0], [1, 1, .6]);
  // A small sibling at the base, and soil still clinging to the stem foot.
  put(root, cyl(.011, .015, .042, 8, 0xdcc9a0), organicMat, [.064, -.117, .03], [.1, 0, -.35]);
  put(root, tint(new SphereGeometry(.026, 10, 5, 0, TAU, 0, Math.PI / 2), (_x, y) => (y < .004 ? 0xe2cfa6 : 0x9a4a2c), .04), organicMat, [.072, -.097, .032], [.1, 0, -.35], [1, .75, 1]);
  for (const [x, z, s] of [[.03, .05, 1], [-.05, .02, .8], [.01, -.055, .9]]) {
    put(root, tint(new IcosahedronGeometry(.018 * s, 0), 0x4a3726, .08), organicMat, [x, -.134, z], [s, s * 2, 0], [1, .5, 1]);
  }
  return bake(top);
}

// ---------------------------------------------------------------------------
// Resources.

/** Firewood billet: bark, knot and two cut ends of end grain. Along Y, r ≈ .075. */
function makeLog(): Group {
  const root = group('Firewood billet');
  const body = cyl(.074, .076, .45, 12, (x, y, z) => mixHex(0x75533a, 0x4d3625, .5 + .5 * Math.sin(Math.atan2(z, x) * 6 + y * 14)), .05, 3);
  const bp = body.getAttribute('position');
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
    const a = Math.atan2(z, x);
    const f = 1 + .045 * Math.sin(a * 3 + y * 9) + .025 * Math.sin(a * 7 - 1.3);
    bp.setXYZ(i, x * f, y, z * f);
  }
  body.computeVertexNormals();
  put(root, tiled(body, .47, .45, .2), barkMat);
  // End grain: sapwood, growth rings, pith and drying checks.
  for (const side of [-1, 1]) {
    const face = group('', [0, side * .2255, 0], [side * -Math.PI / 2, 0, 0]);
    const rings: [number, number][] = [[.066, C.sap], [.054, C.endRing], [.041, 0xd0a068], [.027, C.endRing], [.012, C.pith]];
    rings.forEach(([r, color], i) => put(face, tint(new CylinderGeometry(r, r, .001, 14), color, .03), woodMat, [0, 0, .0006 + i * .0011], [Math.PI / 2, 0, 0]));
    for (const a of [.4, 2.3]) put(face, box([.045, .003, .0012], 0x5d3f26, 0), woodMat, [Math.cos(a) * .03, Math.sin(a) * .03, .0036], [0, 0, a]);
    root.add(face);
  }
  // Knot stub and a moss patch.
  put(root, cyl(.013, .02, .03, 7, (_x, y) => (y > .012 ? C.sap : C.barkDark)), barkMat, [0, .07, .078], [Math.PI / 2 - .3, 0, 0]);
  put(root, ball(.03, 8, 5, 0x6d8a3a, .08), barkMat, [.05, -.12, .055], [0, .8, 0], [.5, 1.3, 1]);
  return bake(root);
}

/** Axe-split plank: riven faces, one bark edge. Along Y; thin along X so it lies flat on its side. */
function makePlank(): Group {
  const root = group('Split plank');
  const board = box([.03, .6, .12], (_x, _y, _z, nx, ny, nz) => {
    if (Math.abs(ny) > .9) return 0x9a6a40;
    if (nz > .9) return C.bark;
    return Math.abs(nx) > .9 ? 0xc99a62 : 0xb58454;
  }, .07, [1, 8, 3]);
  const p = board.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const riven = .0022 * Math.sin(y * 23 + z * 31) + .0015 * Math.sin(y * 61 - z * 13);
    p.setXYZ(i, x + Math.sign(x) * riven + y * .012 * (z / .06) * .5, y, z);
  }
  put(root, faceted(board), woodMat);
  // Axe-hewn marks and a knot on both faces.
  for (const side of [-1, 1]) {
    put(root, tint(new CylinderGeometry(.011, .011, .001, 10), 0x5e3a22), woodMat, [side * .0162, .12, -.02], [0, 0, Math.PI / 2], [1, 1, 1.6]);
    put(root, torus(.014, .0015, 0x8a5a34, 12, 3), woodMat, [side * .0165, .12, -.02], [0, Math.PI / 2, 0], [1.6, 1, 1]);
    for (const y of [-.24, -.2, .21]) put(root, box([.001, .004, .09], 0x8d6038, 0), woodMat, [side * .0163, y, .005], [.2, 0, 0]);
  }
  return bake(root);
}

/** Amber resin lumps on a leaf wrap, tied with grass twine. Stands upright. */
function makeResin(): Group {
  const root = group('Resin in a leaf wrap');
  for (const [yaw, lift, len] of [[0, 0, .16], [Math.PI / 2, .0025, .15], [Math.PI / 4, -.002, .14]]) {
    const holder = group('', [0, -.03 + lift, 0], [0, yaw, 0]);
    const blade = leaf(len, .07, 0x6a8f3a, 0xa6c46c, { fold: .85, segments: 7, edge: 0x4c6d2a });
    blade.translate(-len / 2, 0, 0);
    const bp = blade.getAttribute('position');
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i);
      bp.setY(i, bp.getY(i) + 2.4 * x * x);
    }
    blade.computeVertexNormals();
    put(holder, blade, leafMat);
    root.add(holder);
  }
  // Smooth, drippy lumps: honey-gold on top, deep amber underneath, lit from within.
  const lump = (radius: number, detail: number, at: V3, scale: V3, seed: number, sag = .35) => {
    const g = welded(new IcosahedronGeometry(1, detail));
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const f = 1 + .12 * Math.sin(x * 3.1 + seed) * Math.cos(z * 2.7 - seed) + .06 * Math.sin(y * 5.3 + seed * 1.7);
      // Resin slumps: the underside spreads, the top rounds over.
      const spread = y < 0 ? 1 + sag * -y : 1;
      p.setXYZ(i, x * f * spread, y * f * (y < 0 ? .7 : 1), z * f * spread);
    }
    g.computeVertexNormals();
    tint(g, (_x, y) => mixHex(0x7a2e04, 0xf0a531, smoothstep(-.6, 1, y)), .03);
    put(root, g, amberMat, at, [0, seed, 0], [radius * scale[0], radius * scale[1], radius * scale[2]]);
  };
  // A clump of fused tears rather than one ball.
  lump(.029, 2, [-.012, -.004, .008], [1.1, .85, .95], 1.3);
  lump(.025, 2, [.014, .004, -.004], [1, .9, 1.05], 3.2, .25);
  lump(.017, 1, [-.004, .02, -.012], [1, 1.1, 1], 5.7, .1);
  lump(.02, 1, [.038, -.012, -.02], [1, .8, 1], 4.1);
  lump(.013, 1, [-.034, -.016, -.03], [1, .75, 1.2], 2.2);
  // A drip running off the leaf edge, and glints that sell the glassy surface.
  put(root, tint(welded(new SphereGeometry(.009, 8, 6)), (_x, y) => mixHex(0x8a3606, 0xeea033, y / .018 + .5), .02), amberMat, [.012, -.024, .045], [0, 0, 0], [1, 1.8, 1]);
  for (const [x, y, z, r] of [[-.016, .029, .012, .0045], [.03, .004, -.012, .003]]) {
    put(root, ball(r, 8, 6, 0xfff6d8, 0), amberMat, [x, y, z], [0, 0, 0], [1, .25, 1]);
  }
  // Bark flecks caught in the resin.
  for (const [x, y, z] of [[.012, .024, .018], [-.026, .014, .022]]) put(root, box([.006, .002, .004], 0x3b2718, 0), leafMat, [x, y, z], [x * 40, y * 30, 0]);
  put(root, cordRing(.05, .0028, C.twine, 18), fibreMat, [0, -.012, 0], [Math.PI / 2, 0, 0], [1, 1, .6]);
  put(root, ball(.006, 6, 4, C.twineDark), fibreMat, [0, -.009, .051]);
  return bake(root);
}

/** Knapped flint nodule: glassy blue-grey scars, chalky cortex on one side. Lies flat. */
function makeFlint(): Group {
  const root = group('Flint nodule');
  const g = new IcosahedronGeometry(1, 2); // polyhedra are already non-indexed
  const p = g.getAttribute('position');
  // Knapping scars on the working (+X) half; the -X half keeps its chalky cortex.
  const planes: [number, number, number, number][] = [
    [0, -1, 0, .018], [.35, .9, .2, .018], [-.25, .85, -.3, .02], [.25, .8, -.55, .02],
    [1, .2, .1, .043], [.7, 0, .7, .035], [.3, -.3, -.9, .03], [.8, .1, -.6, .034], [.55, .6, .6, .03],
  ];
  const cut = new Int8Array(p.count).fill(-1);
  const v = new Vector3(), n = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const lump = 1 + .06 * Math.sin(v.x * 4.1 + 1) * Math.cos(v.z * 3.3);
    v.set(v.x * .053 * lump, v.y * .028 * lump, v.z * .038 * lump);
    planes.forEach(([x, y, z, d], k) => {
      n.set(x, y, z).normalize();
      const s = v.dot(n) - d;
      if (s > 0) { v.addScaledVector(n, -s); cut[i] = k; }
    });
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const flaked: number[] = [], cortex: number[] = [];
  for (let f = 0; f < p.count / 3; f++) (cut[f * 3] > 0 && cut[f * 3 + 1] > 0 && cut[f * 3 + 2] > 0 ? flaked : cortex).push(f);
  const subset = (faces: number[]) => {
    const out = new BufferGeometry();
    const pos: number[] = [];
    for (const f of faces) for (let k = 0; k < 3; k++) pos.push(p.getX(f * 3 + k), p.getY(f * 3 + k), p.getZ(f * 3 + k));
    out.setAttribute('position', new Float32BufferAttribute(pos, 3));
    out.computeVertexNormals();
    return out;
  };
  const scars = [0x46525f, 0x5d6b79, 0x39434e, 0x72818f, 0x505d6a];
  put(root, faceTint(subset(flaked), (f, c) => scars[Math.abs(cut[flaked[f] * 3] * 3 + Math.round(c.y * 300)) % scars.length]), stoneMat);
  put(root, faceTint(subset(cortex), (f, c) => (c.y < -.016 ? 0x9d937c : mixHex(0xdcd3bc, 0xbdb198, hash(f)))), organicMat);
  return bake(root);
}

/** Coil of twisted reed cord lying flat, with two binding wraps and a frayed tail. */
function makeCord(): Group {
  const root = group('Coil of reed cord');
  const turns = 2.7, total = turns * TAU;
  const coil = pathOf(66, (t) => {
    const a = t * total;
    const r = .052 + .005 * Math.sin(a * .7);
    return [Math.cos(a) * r + .003 * Math.sin(a * .5), -.005 + .009 * t + .0018 * Math.sin(a * 1.9), Math.sin(a) * r + .002 * Math.cos(a * .4)];
  });
  const end = coil[coil.length - 1];
  const tail: Vector3[] = [];
  for (let k = 1; k <= 6; k++) {
    const a = total + k * .12;
    tail.push(new Vector3(Math.cos(a) * (.056 + k * .008), end.y - k * .0015, Math.sin(a) * (.056 + k * .008) + k * .004));
  }
  const path = [...coil, ...tail];
  put(root, sweep(path, { radius: .0062, radial: 6, caps: true, capPaint: 0xd9c690, tile: .028, paint: (t) => mixHex(0xbca468, 0x9c8450, .5 + .5 * Math.sin(t * 90)) }), fibreMat);
  // Frayed fibres at the tail end.
  const last = path[path.length - 1];
  for (const [a, b] of [[.3, .2], [-.4, .1], [.1, -.3]]) put(root, cyl(.0013, .0018, .022, 4, 0xd4c089), fibreMat, [last.x + .006, last.y, last.z + .008], [a, .9, 1.4 + b]);
  // Binding wraps across the coil bundle.
  for (const a of [Math.PI / 2, Math.PI * 1.5]) {
    put(root, cordRing(.0125, .0033, 0x8a7447, 12), fibreMat, [Math.cos(a) * .054, 0, Math.sin(a) * .054], [0, -a, 0], [1, 1.25, 1]);
  }
  return bake(root);
}

/** Salvaged iron crossbow lock: housing, brass nut with string ears, pins and trigger lever. Lies flat. */
function makeTrigger(): Group {
  const root = group('Crossbow trigger mechanism');
  put(root, box([.022, .03, .062], C.iron, .06), metalMat, [0, 0, 0]);
  // Side windows showing the sear, and worn edges.
  for (const x of [-.0112, .0112]) put(root, box([.001, .012, .028], 0x1e2326, 0), metalMat, [x, .002, .006]);
  put(root, box([.023, .004, .064], C.ironLight, .03), metalMat, [0, .0145, 0]);
  // Brass nut (the catch) with its two ears.
  put(root, cyl(.0135, .0135, .026, 12, C.brass), metalMat, [0, .014, -.017], [0, 0, Math.PI / 2]);
  for (const x of [-.008, .008]) put(root, box([.005, .018, .008], C.brass), metalMat, [x, .03, -.022], [.25, 0, 0]);
  put(root, box([.004, .008, .008], C.brassDark), metalMat, [0, .026, -.006], [-.3, 0, 0]);
  // Axle pins with peened heads.
  for (const z of [-.017, .018]) {
    put(root, cyl(.0035, .0035, .03, 6, C.ironLight), metalMat, [0, z < 0 ? .014 : -.003, z], [0, 0, Math.PI / 2]);
    for (const x of [-.0155, .0155]) put(root, ball(.0048, 8, 4, C.steel), metalMat, [x, z < 0 ? .014 : -.003, z], [0, 0, 0], [.5, 1, 1]);
  }
  // Long trigger lever swinging back from the housing.
  put(root, sweep(pathOf(6, (t) => [0, -.004 - .006 * t + .003 * Math.sin(t * Math.PI), .018 + t * .075]), {
    radius: (t) => [.0065 - .0015 * t, .0042], radial: 6, caps: true, up: [0, 1, 0], paint: 0x51595e,
  }), metalMat);
  put(root, torus(.006, .0022, C.ironDark, 10, 4), metalMat, [0, -.011, .098], [0, Math.PI / 2, 0]);
  // Leaf spring under the housing.
  put(root, box([.012, .0025, .05], 0x5e676c, .02), metalMat, [0, -.0158, -.004], [.05, 0, 0]);
  return bake(root);
}

/** Coiled iron spring on its side (axis X) with a hook loop at each end. */
function buildSpring(parent: Object3D, material: Material, at: V3, rotation: V3, o: { length: number; radius: number; wire: number; turns: number; perTurn: number; radial: number; hook?: number }): void {
  const { length, radius, wire, turns } = o;
  const coilCount = Math.round(turns * o.perTurn);
  const helix = pathOf(coilCount, (t) => {
    const a = t * turns * TAU;
    return [-length / 2 + length * t, Math.cos(a) * radius, Math.sin(a) * radius];
  });
  // End loop in the XY plane just beyond the coil, entered from its top.
  const hook = (x0: number, dir: number): Vector3[] => {
    const cx = x0 + dir * radius * .85, rho = radius * .8;
    return pathOf(o.hook ?? 10, (t) => {
      const a = Math.PI / 2 - t * 1.8 * Math.PI;
      return [cx + dir * rho * Math.cos(a), rho * Math.sin(a), 0];
    });
  };
  const start = hook(-length / 2, -1).reverse();
  const finish = hook(length / 2, 1);
  const path = [...start, ...helix, ...finish];
  const mesh = put(parent, sweep(path, {
    radius: wire, radial: o.radial, caps: true,
    paint: (t) => mixHex(0x535b60, C.rust, smoothstep(.75, 1, Math.sin(t * 57) * .5 + .5) * .6),
  }), material, at, rotation);
  mesh.name = '';
}
function makeSpring(): Group {
  const root = group('Iron spring');
  buildSpring(root, metalMat, [0, 0, 0], [0, 0, 0], { length: .1, radius: .026, wire: .0045, turns: 7, perTurn: 11, radial: 5 });
  return bake(root);
}

/** Cluster of bilberries on two leaves with their twig. Lies flat. */
function makeBerries(): Group {
  const root = group('Wild berries');
  for (const [yaw, x, z] of [[.35, -.045, .01], [-2.7, .04, -.012]]) {
    const holder = group('', [x, -.008, z], [0, yaw, 0]);
    put(holder, leaf(.085, .042, C.leafGreen, C.leafRib, { fold: .25, curl: .06, edge: C.leafDark }), leafMat, [0, 0, 0], [0, 0, 0]);
    root.add(holder);
  }
  put(root, cyl(.0024, .003, .09, 5, 0x5d4a30), leafMat, [0, -.001, 0], [0, .3, Math.PI / 2]);
  const berries: [number, number, number, number][] = [
    [-.022, .006, -.01, .014], [.0, .006, .012, .015], [.022, .006, -.006, .014], [-.006, .006, -.026, .0135],
    [.012, .006, .03, .0125], [-.012, .02, .004, .014], [.012, .021, -.012, .0135], [-.03, .005, .016, .012],
  ];
  berries.forEach(([x, y, z, r], i) => {
    // Red to match the meadow bushes: #7e1f22 shadow side up to #b8322e, dark crown on top.
    put(root, ball(r, 9, 7, (_x, py) => (py > r * .92 ? 0x3a1412 : mixHex(0x7e1f22, 0xb8322e, smoothstep(-r, r * .7, py) * .8 + hash(i) * .2)), .02), organicMat, [x, y, z], [0, i, 0]);
    put(root, cyl(.0012, .0015, .018, 4, 0x5d4a30), leafMat, [x * .6, y - .004, z * .6], [.4, i * 1.3, .9]);
  });
  return bake(root);
}

/** Tied bundle of leafy herb stems with flower spikes. Lies flat along X. */
function makeHerb(): Group {
  const root = group('Wild herb bundle');
  const stems: [number, number, number][] = [[-.03, .082, .0], [-.012, .075, .004], [.006, .085, .002], [.022, .072, .003], [-.004, .062, .006]];
  stems.forEach(([zEnd, xEnd, lift], s) => {
    const from: V3 = [-.075, 0, (s - 2) * .003], to: V3 = [xEnd, lift, zEnd];
    strut(root, from, to, (l) => cyl(.0018, .0024, l, 4, 0x6c8a3a), leafMat);
    for (let k = 0; k < 3; k++) {
      const t = .35 + k * .22;
      const at: V3 = [lerp(from[0], to[0], t), lerp(from[1], to[1], t) + .001, lerp(from[2], to[2], t)];
      const side = (k + s) % 2 ? 1 : -1;
      const heading = Math.atan2(-(to[2] - from[2]), to[0] - from[0]);
      put(root, leaf(.034 - k * .004, .016, 0x7f9a5a, 0xa9c07d, { fold: .3, curl: .04, segments: 5, edge: 0x607c3f }), leafMat, at, [0, heading + side * .75, 0]);
    }
    if (s % 2 === 0) {
      for (let k = 0; k < 3; k++) put(root, ball(.0042 - k * .0008, 5, 4, 0xa58bd0, .03), leafMat, [to[0] + .004 * k, to[1] + .002, to[2] + .001 * k]);
    }
  });
  put(root, cordRing(.0115, .003, C.twine, 12), fibreMat, [-.05, 0, -.001], [0, Math.PI / 2, 0], [1, .9, 1]);
  put(root, cordRing(.006, .0022, C.twine, 10), fibreMat, [-.05, .014, .006], [.6, .4, 0]);
  put(root, cordRing(.006, .0022, C.twine, 10), fibreMat, [-.05, .014, -.007], [-.6, -.4, 0]);
  return bake(root);
}

// ---------------------------------------------------------------------------
// Tools.

/** Hatchet: oval ash handle along +Y, forged head at y .28, blade edge toward -Z. */
function makeAxe(): Group {
  const root = group('Hatchet');
  const handlePath = pathOf(14, (t) => [0, -.29 + .62 * t, .009 * Math.sin(Math.PI * t) - .002]);
  const section = (t: number, grow = 0): [number, number] => {
    const knob = 1 + .32 * (1 - smoothstep(0, .07, t));
    const neck = 1 - .1 * smoothstep(.85, .95, t);
    return [.0145 * knob * neck + grow, .0195 * knob * neck + grow];
  };
  put(root, sweep(handlePath, { radius: (t) => section(t), radial: 10, caps: true, up: [1, 0, 0], capPaint: 0xd9b27c, tile: .3, paint: (t) => mixHex(0xc79d66, 0xae8250, .5 + .5 * Math.sin(t * 19)) }), woodMat);
  // Leather grip wrap centred on the origin, whipped at both ends.
  const wrapPath = handlePath.filter((p) => p.y > -.08 && p.y < .08);
  put(root, sweep(wrapPath, { radius: (t) => section(.35 + t * .24, .0028), radial: 10, caps: true, up: [1, 0, 0], paint: 0x5e3f2a, tile: .06 }), leatherMat);
  for (const y of [-.074, .074]) put(root, cordRing(.02, .0032, C.twine, 12), fibreMat, [0, y, .006], [Math.PI / 2, 0, 0], [.8, 1.05, 1]);
  // Lanyard hole through the knob.
  put(root, cyl(.004, .004, .031, 6, 0x2d1d12, 0), woodMat, [0, -.272, -.002], [0, 0, Math.PI / 2]);
  // Forged head: side profile extruded across X and tapered to a thin bit.
  const head = (points: [number, number][], paint: Paint) => {
    const shape = new Shape(points.map(([s, dy]) => new Vector2(s, dy)));
    const g = new ExtrudeGeometry(shape, { depth: .04, bevelEnabled: false });
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const s = p.getX(i), dy = p.getY(i), across = p.getZ(i) - .02;
      const taper = s <= .03 ? 1 : lerp(1, .11, (s - .03) / (.117 - .03));
      p.setXYZ(i, across * taper, .28 + dy, -s);
    }
    return tint(faceted(g), paint, .04);
  };
  put(root, head([[-.04, -.03], [.018, -.03], [.042, -.022], [.068, -.042], [.084, -.068], [.1, -.084], [.1, .062], [.08, .052], [.05, .03], [.018, .03], [-.04, .03]],
    (_x, _y, z, nx, ny) => (z > .03 || ny > .8 ? 0x5a6368 : Math.abs(nx) > .5 ? 0x3c4347 : 0x4b5358)), metalMat);
  put(root, head([[.1, -.084], [.108, -.088], [.113, -.06], [.116, -.025], [.117, .01], [.115, .04], [.11, .064], [.1, .062]], C.steel), metalMat);
  // Handle end and wedge through the eye; a maker's punch mark on each cheek.
  put(root, cyl(.0135, .0135, .012, 10, 0xd9b27c), woodMat, [0, .316, -.001], [0, 0, 0], [1, 1, 1.35]);
  put(root, box([.004, .013, .03], C.ironDark), metalMat, [0, .317, 0]);
  for (const x of [-.0192, .0192]) put(root, cyl(.004, .004, .0015, 8, 0x22272a, 0), metalMat, [x, .282, -.05], [0, 0, Math.PI / 2]);
  return bake(root);
}

/**
 * Brass flip lighter at 1.4 scale (case ≈ .054 × .073 × .02 m), lid open. The hidden
 * 'flame' group's origin is the flame base over the wick at (0,.07,0). Stands upright.
 */
function makeLighter(): Group {
  const root = group('Brass flip lighter');
  const body = group('', [0, 0, 0], [0, 0, 0], 1.4);
  root.add(body);
  const rounded = (w: number, h: number, r: number) => {
    const s = new Shape();
    s.moveTo(-w / 2 + r, -h / 2);
    s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    return s;
  };
  const caseGeo = new ExtrudeGeometry(rounded(.036, .05, .005), { depth: .011, bevelEnabled: true, bevelThickness: .0015, bevelSize: .0012, bevelSegments: 1, curveSegments: 3 });
  caseGeo.translate(0, 0, -.0055);
  put(body, tint(caseGeo, (_x, y) => (y < -.02 ? C.brassDark : C.brass), .04), metalMat, [0, -.009, 0]);
  // Lid seam band and an engraved expedition emblem on both faces.
  put(body, box([.0386, .0022, .0146], C.brassDark, 0), metalMat, [0, .0165, 0]);
  for (const z of [-.0072, .0072]) {
    put(body, torus(.0075, .0007, C.brassDark, 14, 3), metalMat, [0, -.011, z]);
    put(body, box([.0012, .01, .0005], C.brassDark, 0), metalMat, [0, -.011, z], [0, 0, .5]);
    put(body, box([.0012, .01, .0005], C.brassDark, 0), metalMat, [0, -.011, z], [0, 0, -.5]);
  }
  // Open lid swung out on its hinge.
  const lid = group('', [.019, .0175, 0], [0, 0, -2.05]);
  const lidGeo = new ExtrudeGeometry(rounded(.036, .02, .004), { depth: .011, bevelEnabled: true, bevelThickness: .0015, bevelSize: .0012, bevelSegments: 1, curveSegments: 3 });
  lidGeo.translate(-.019, .01, -.0055);
  put(lid, tint(lidGeo, C.brass, .04), metalMat);
  body.add(lid);
  put(body, cyl(.0026, .0026, .0145, 8, C.brassDark), metalMat, [.019, .0175, 0], [Math.PI / 2, 0, 0]);
  // Perforated chimney, striker wheel and wick.
  put(body, box([.02, .025, .012], C.steel, .02), metalMat, [-.001, .03, 0]);
  for (const z of [-.0062, .0062]) for (const x of [-.008, -.001, .006]) for (const y of [.026, .035]) put(body, box([.003, .003, .0006], 0x1d2124, 0), metalMat, [x, y, z]);
  put(body, box([.016, .0008, .0085], 0x1d2124, 0), metalMat, [-.001, .0427, 0]);
  put(body, cyl(.002, .002, .007, 6, 0x3a3029, 0), metalMat, [0, .045, 0]);
  put(body, cyl(.0055, .0055, .0075, 12, (x, _y, z) => (Math.sin(Math.atan2(z, x) * 12) > 0 ? 0x5a6166 : 0x2c3134), 0), metalMat, [.0145, .036, 0], [Math.PI / 2, 0, 0]);
  for (const z of [-.005, .005]) put(body, box([.004, .014, .0012], C.steel, 0), metalMat, [.0145, .031, z]);
  // Wick top sits at y .068; the flame grows up from its base just above it.
  const flame = group('flame', [0, .07, 0]);
  flame.visible = false;
  flame.add(flameMesh([{ r: .012, h: .075 }], [0x7aa6ff, 0xffc04e, 0xff7a1e], lighterFlame, 10));
  flame.add(flameMesh([{ r: .0055, h: .036, at: [0, .003, 0] }], [0xffffff, 0xfff4c8, 0xffe08a], lighterCore, 8));
  root.add(flame);
  return bake(root);
}

/** Hunting spear: 1.5 m shaft (butt at -.5), grip wrap at the origin, knapped flint point to y .995. */
function makeSpear(): Group {
  const root = group('Flint spear');
  const shaft = pathOf(12, (t) => [.0025 * Math.sin(t * 4.3), -.5 + 1.405 * t, .002 * Math.sin(t * 6.1 + 1)]);
  put(root, sweep(shaft, {
    radius: (t) => .0188 - .0028 * t, radial: 10, caps: true, capPaint: 0x2e2118, tile: .4,
    // Fire-hardened butt, pale debarked shaft with a few knots.
    paint: (t, a) => (t < .045 ? 0x3a2a1e : mixHex(0xbf9763, 0x8e6a40, smoothstep(.96, 1, Math.sin(t * 23 + a * .5)) + .3 * (1 - smoothstep(.045, .1, t)))),
  }), woodMat);
  put(root, tiled(cyl(.0215, .0218, .18, 10, C.leather, .05), .135, .18), leatherMat, [0, 0, 0]);
  for (const y of [-.093, .093]) put(root, cordRing(.0215, .0034, C.twine, 12), fibreMat, [0, y, 0], [Math.PI / 2, 0, 0]);
  // Cord lashing binding the point into the split shaft, sealed with pitch.
  put(root, tiled(cyl(.0172, .0186, .064, 10, C.twine, .05, 1, true), .12, .064, .02), fibreMat, [0, .872, 0]);
  for (const y of [.841, .903]) put(root, cordRing(.0182, .0032, C.twineDark, 12), fibreMat, [0, y, 0], [Math.PI / 2, 0, 0]);
  put(root, ball(.0185, 8, 5, 0x4a2a10, .05), stoneMat, [0, .905, 0], [0, 0, 0], [1, .45, 1]);
  const point = sweep(pathOf(10, (t) => [0, .87 + .125 * t, 0]), {
    radius: (t) => {
      const w = t < .24 ? .012 + .0135 * (t / .24) : .0255 * (1 - Math.pow((t - .24) / .76, 1.3));
      return [Math.max(.0004, w + .0014 * Math.sin(t * 41)), Math.max(.0003, .0072 * (1 - t * t) + .0008)];
    },
    radial: 6, caps: true, up: [0, 0, 1], paint: 0x3d4752,
  });
  const facetedPoint = faceted(point);
  put(root, faceTint(facetedPoint, (f, c) => [0x39434e, 0x4d5a66, 0x2f3841, 0x5b6874][(f + Math.round(c.y * 300)) % 4]), stoneMat);
  // Crossed binding over the flint's tang.
  for (const x of [-.0066, .0066]) {
    put(root, box([.0015, .04, .004], C.twineDark), fibreMat, [x, .878, 0], [0, 0, 0]).rotation.set(0, 0, x > 0 ? .35 : -.35);
  }
  return bake(root);
}

/** One crossbow bolt pointing along -Z, origin at its middle. Tip at z -.196. */
function buildBolt(parent: Object3D, material: Material, simple = false): void {
  put(parent, cyl(.0055, .0055, .30, 6, 0xcfa874, .03), material, [0, 0, .01], [Math.PI / 2, 0, 0]);
  put(parent, cyl(.0068, .006, .022, 6, 0x3e4549), material, [0, 0, -.145], [Math.PI / 2, 0, 0]);
  put(parent, cyl(0, .0095, .04, 4, (_x, y) => (y > .01 ? 0x8e989d : 0x555e63), 0), material, [0, 0, -.176], [-Math.PI / 2, Math.PI / 4, 0]);
  if (simple) return;
  const vane = new Shape([new Vector2(0, 0), new Vector2(.066, 0), new Vector2(.056, .0135), new Vector2(.014, .0135)]);
  for (let k = 0; k < 3; k++) {
    const holder = group('', [0, 0, 0], [0, 0, k * TAU / 3]);
    const g = new ExtrudeGeometry(vane, { depth: .0012, bevelEnabled: false });
    g.translate(0, 0, -.0006);
    put(holder, tint(g, k === 0 ? 0x9a3b2c : 0xe4ddcf, .03), material, [0, .0048, .152], [0, Math.PI / 2, 0]);
    parent.add(holder);
  }
  put(parent, cyl(.0062, .0062, .008, 6, 0x3a2a20), material, [0, 0, .158], [Math.PI / 2, 0, 0]);
  put(parent, cyl(.006, .006, .01, 6, 0x4a3a2c), material, [0, 0, .078], [Math.PI / 2, 0, 0]);
}
function makeBolt(): Group {
  const root = group('Crossbow bolt');
  buildBolt(root, organicMat);
  return bake(root);
}

/** Four bolts heads-up along +Y, tied with cord twice. */
function makeBoltBundle(): Group {
  const root = group('Bundle of crossbow bolts');
  const spots: [number, number, number, number][] = [[-.0085, -.0085, .008, .3], [.0085, -.0085, -.006, 1.4], [-.0085, .0085, -.01, 2.2], [.0085, .0085, .004, .9]];
  for (const [x, z, y, spin] of spots) {
    const holder = group('', [x, y, z], [Math.PI / 2 + z * 1.5, 0, -x * 1.5]);
    const inner = group('', [0, 0, 0], [0, 0, spin]);
    buildBolt(inner, organicMat);
    holder.add(inner);
    root.add(holder);
  }
  for (const y of [-.06, .065]) {
    put(root, cordRing(.0165, .0034, C.twine, 14), fibreMat, [0, y, 0], [Math.PI / 2, 0, 0]);
    put(root, ball(.0048, 6, 4, C.twineDark), fibreMat, [.018, y, .004]);
  }
  put(root, cyl(.0018, .0018, .03, 4, C.twine), fibreMat, [.021, .05, .006], [0, 0, .25]);
  return bake(root);
}

type CrossbowMaterials = { wood: Material; metal: Material; cord: Material };
/**
 * Crossbow with its grip origin at the trigger: stock/rail forward along -Z to
 * -.42, prod across X at z≈-.37 with a spanned string to the nut, stirrup at the front.
 */
function buildCrossbow(parent: Object3D, m: CrossbowMaterials, simple = false): void {
  const inset: [number, number][] = [
    [-.416, .038], [.03, .038], [.07, .03], [.17, .024], [.262, .016], [.266, -.046],
    [.24, -.05], [.12, -.034], [.04, -.018], [-.4, -.014], [-.416, -.008],
  ];
  const stock = new ExtrudeGeometry(new Shape(inset.map(([z, y]) => new Vector2(z, y))), {
    depth: .032, bevelEnabled: true, bevelThickness: .004, bevelSize: .004, bevelSegments: 1,
  });
  // Taper the tiller toward the prod so it reads as a shaped stock, not a plank.
  const sp = stock.getAttribute('position');
  for (let i = 0; i < sp.count; i++) {
    const z = sp.getX(i), across = sp.getZ(i) - .016;
    sp.setZ(i, .016 + across * (z < -.05 ? lerp(1, .8, (-.05 - z) / .37) : 1));
  }
  stock.computeVertexNormals();
  put(parent, tint(stock, C.walnut, .06), m.wood, [.016, 0, 0], [0, -Math.PI / 2, 0]);
  put(parent, box([.006, .0015, .44], 0x3a2618, 0), m.wood, [0, .0424, -.195]);
  // Prod: one tapered limb across X, tips drawn back by the spanned string.
  const radial = simple ? 5 : 6;
  put(parent, sweep(pathOf(simple ? 10 : 14, (t) => { const u = t * 2 - 1; return [.29 * u, .03, -.37 + .04 * u * u]; }), {
    radius: (t) => { const e = Math.abs(t * 2 - 1); return [.016 - .006 * e, .009 - .003 * e]; },
    radial, caps: true, up: [0, 1, 0],
    paint: (t) => { const e = Math.abs(t * 2 - 1); return e > .93 ? 0xe2d6bb : mixHex(0x5b3a22, 0x7a5030, .5 + .5 * Math.sin(t * 40)); },
  }), m.wood);
  const tipL: V3 = [-.287, .03, -.331], tipR: V3 = [.287, .03, -.331], nut: V3 = [0, .049, -.004];
  for (const tip of [tipL, tipR]) {
    strut(parent, tip, nut, (l) => cyl(.0021, .0021, l, 4, C.cord, .02, 1, simple), m.cord);
    if (!simple) put(parent, torus(.0065, .0022, C.cord, 8, 3), m.cord, tip, [Math.PI / 2, 0, 0]);
  }
  // Cord bridle lashing the prod to the stock.
  for (const z of [-.349, -.392]) put(parent, cordRing(.03, .0032, C.twine, simple ? 8 : 12, TAU, simple ? 3 : 4), m.cord, [0, .013, z], [0, 0, 0], [.75, 1.07, 1]);
  // Nut with string ears, lock plates and rivets.
  put(parent, cyl(.0125, .0125, .03, simple ? 8 : 10, C.brass), m.metal, [0, .044, -.002], [0, 0, Math.PI / 2]);
  for (const x of [-.008, .008]) put(parent, box([.0055, .018, .008], C.brass), m.metal, [x, .058, -.007], [.2, 0, 0]);
  for (const x of [-.0212, .0212]) {
    put(parent, box([.003, .05, .08], C.ironDark, .05), m.metal, [x, .012, .015]);
    if (!simple) for (const [y, z] of [[.026, -.012], [.026, .042], [-.004, -.012], [-.004, .042]]) put(parent, cyl(.0034, .0034, .004, 6, C.ironLight), m.metal, [x * 1.1, y, z], [0, 0, Math.PI / 2]);
  }
  // Long trigger lever tucked under the stock.
  put(parent, sweep(pathOf(5, (t) => [0, -.018 - .03 * t + .006 * Math.sin(t * Math.PI), .004 + .19 * t]), {
    radius: [.0045, .0042], radial: 5, caps: true, up: [1, 0, 0], paint: 0x4a5156,
  }), m.metal);
  // Front cap, stirrup and its cross bar, butt plate.
  put(parent, box([.046, .058, .01], C.ironDark, .05), m.metal, [0, .013, -.415]);
  put(parent, torus(.062, .0055, C.iron, simple ? 8 : 14, simple ? 4 : 5, Math.PI), m.metal, [0, .005, -.42], [-2.498, 0, 0]);
  put(parent, cyl(.0045, .0045, .13, 6, C.iron), m.metal, [0, .005, -.42], [0, 0, Math.PI / 2]);
  put(parent, box([.044, .066, .006], C.ironDark, .05), m.metal, [0, -.014, .269], [0, 0, 0]).rotation.x = -.05;
}

/** Handheld crossbow: hideable 'loaded-bolt' on the rail and an empty 'muzzle' at the rail front. */
function makeCrossbow(): Group {
  const root = group('Crossbow');
  buildCrossbow(root, { wood: woodMat, metal: metalMat, cord: fibreMat });
  const loaded = group('loaded-bolt', [0, .0505, -.172]);
  buildBolt(loaded, organicMat);
  root.add(loaded);
  root.add(group('muzzle', [0, .05, -.42]));
  return bake(root);
}

/** Sentry kit: 'kit' (folded, visible) and 'deployed' (tripod + yawing 'turret' with 'muzzle', hidden). Origin on the ground. */
function makeSentryKit(): Group {
  const root = group('Sentry kit');
  const kit = group('kit');
  const legs: [number, number][] = [[0, -.022], [.019, .011], [-.019, .011]];
  for (const [x, z] of legs) {
    put(kit, box([.028, .3, .028], C.walnut, .05), woodMat, [x, .17, z]);
    put(kit, box([.032, .02, .032], C.ironDark), metalMat, [x, .01, z]);
  }
  put(kit, cyl(.048, .048, .045, 12, C.iron), metalMat, [0, .3425, 0]);
  for (const y of [.1, .24]) {
    put(kit, tiled(cyl(.047, .047, .028, 12, C.leather, .05), .3, .03), leatherMat, [0, y, 0]);
    put(kit, box([.012, .03, .026], C.brass), metalMat, [0, y, .049]);
  }
  buildSpring(kit, metalMat, [.066, .17, 0], [0, 0, Math.PI / 2], { length: .12, radius: .017, wire: .0035, turns: 5, perTurn: 7, radial: 4, hook: 6 });
  put(kit, tiled(cyl(.024, .024, .02, 8, C.leatherDark, .05, 1, true), .15, .02), leatherMat, [.066, .1, 0]);
  const folded = group('', [0, .392, .03], [0, 0, 0], .5);
  buildCrossbow(folded, { wood: woodMat, metal: metalMat, cord: leatherMat }, true);
  kit.add(folded);
  put(kit, tiled(box([.05, .012, .06], C.leatherDark, .04), .06, .06), leatherMat, [0, .372, .02]);
  root.add(kit);

  const deployed = group('deployed');
  deployed.visible = false;
  const top = .965;
  const feet: V3[] = [[0, 0, .44], [-.381, 0, -.22], [.381, 0, -.22]];
  feet.forEach((foot, i) => {
    const a = Math.atan2(foot[2], foot[0]);
    const head: V3 = [Math.cos(a) * .035, top, Math.sin(a) * .035];
    strut(deployed, [foot[0] * .97, .045, foot[2] * .97], head, (l) => box([.032, l, .032], C.walnut, .05), woodMat);
    put(deployed, cyl(.018, .004, .05, 6, C.ironDark), metalMat, [foot[0] * .975, .025, foot[2] * .975]);
    const next = feet[(i + 1) % 3];
    const mid = (f: V3, t: number): V3 => [lerp(f[0], Math.cos(Math.atan2(f[2], f[0])) * .035, t), lerp(.045, top, t), lerp(f[2], Math.sin(Math.atan2(f[2], f[0])) * .035, t)];
    strut(deployed, mid(foot, .42), mid(next, .42), (l) => box([.018, l, .018], C.woodMid, .05), woodMat);
    strut(deployed, mid(foot, .4), mid(foot, .45), (l) => tiled(cyl(.024, .024, l, 8, C.twine, .04, 1, true), .15, l), woodMat);
  });
  put(deployed, cyl(.055, .06, .06, 12, C.ironDark), metalMat, [0, top + .015, 0]);
  put(deployed, tiled(cyl(.063, .063, .03, 12, C.twine, .04, 1, true), .4, .03), woodMat, [0, top - .03, 0]);
  const turret = group('turret', [0, top + .05, 0]);
  put(turret, cyl(.06, .06, .014, 14, C.iron), metalMat, [0, .007, 0]);
  for (const x of [-.031, .031]) put(turret, box([.008, .07, .05], C.ironDark, .04), metalMat, [x, .045, .01]);
  put(turret, cyl(.006, .006, .08, 6, C.ironLight), metalMat, [0, .065, .01], [0, 0, Math.PI / 2]);
  const bow = group('', [0, .075, .06]);
  buildCrossbow(bow, { wood: woodMat, metal: metalMat, cord: woodMat }, true);
  turret.add(bow);
  // Gravity hopper of bolts over the nut, and the cocking spring along the butt.
  put(turret, box([.05, .055, .12], C.woodMid, .05), woodMat, [0, .075 + .075, .06 - .07]);
  put(turret, box([.052, .006, .122], C.ironDark), metalMat, [0, .075 + .1, .06 - .07]);
  // The loaded bolts in the hopper: a named group so CombatSystem can hide it while the sentry is empty.
  const hopper = group('hopper-bolts');
  for (let k = 0; k < 4; k++) {
    put(hopper, cyl(.0055, .0055, .05, 4, 0xcfa874, .03, 1, true), woodMat, [-.015 + k * .01, .075 + .092, .06 - .005], [Math.PI / 2, 0, 0]);
    put(hopper, box([.001, .012, .03], k === 0 ? 0x9a3b2c : 0xe4ddcf, .02), woodMat, [-.015 + k * .01, .075 + .1, .06 + .012]);
  }
  turret.add(hopper);
  buildSpring(turret, metalMat, [.036, .075, .06 + .13], [0, Math.PI / 2, 0], { length: .15, radius: .013, wire: .003, turns: 7, perTurn: 6, radial: 3, hook: 5 });
  turret.add(group('muzzle', [0, .075 + .05, .06 - .42]));
  deployed.add(turret);
  root.add(deployed);
  return bake(root);
}

/**
 * Rolled backpack: a soft tan leather bedroll-style roll, oval in section, with rounded
 * closed ends (no end grain or spiral: it must never read as a log), two buckled straps
 * and a flat leather strap loop on top as the carry handle. Along X; bounds and handle
 * height match the old roll (BackpackSystem rests and hangs it by them).
 */
function makePackRoll(): Group {
  const root = group('Rolled backpack');
  const r = .1, oval = 1.22, length = .46;
  const tan = 0x9a6a42, tanDark = 0x7e5334, strap = 0x5a3a24;
  // Body: an oval leather roll with a soft overlapping flap seam along its side.
  put(root, tiled(cyl(r, r, length, 18, (_x, y) => mixHex(tan, 0xa8784c, .5 + .5 * Math.sin(y * 21)), .05, 3), .7, length, .08),
    leatherMat, [0, 0, 0], [0, 0, Math.PI / 2], [1, 1, oval]);
  put(root, tiled(box([length - .01, .004, .05], tanDark, .04), length, .05, .08), leatherMat,
    [0, Math.cos(1.05) * (r + .001), Math.sin(1.05) * (r + .001) * oval], [1.05, 0, 0]);
  // Rounded, closed ends: squashed leather domes, a shade darker, with a stitched hem.
  for (const side of [-1, 1]) {
    const x = side * length / 2;
    put(root, tint(new SphereGeometry(r * .98, 14, 6, 0, TAU, 0, Math.PI / 2), tanDark, .05), leatherMat,
      [x, 0, 0], [0, 0, -side * Math.PI / 2], [1, .28, oval]);
    put(root, torus(r * .99, .005, 0xc9a86f, 18, 3), leatherMat, [x - side * .006, 0, 0], [0, Math.PI / 2, 0], [oval, 1, 1]);
  }
  // Two buckled straps round the roll.
  for (const x of [-.13, .13]) {
    put(root, tiled(cyl(r + .006, r + .006, .045, 18, strap, .04), .66, .045, .08), leatherMat, [x, 0, 0], [0, 0, Math.PI / 2], [1, 1, oval]);
    put(root, box([.05, .01, .05], C.brass), metalMat, [x, r + .01, 0]);
    put(root, box([.036, .012, .036], 0x3b2a1c, 0), leatherMat, [x, r + .012, 0]);
    put(root, tiled(box([.03, .016, .056], strap, .04), .03, .06, .08), leatherMat, [x + .03, r + .012, 0]);
  }
  // Carry strap: a flat leather loop standing over the roll between the straps.
  put(root, tiled(torus(.085, .011, C.leatherLight, 14, 4, Math.PI), .27, .075, .08), leatherMat, [0, r - .004, 0], [0, 0, 0], [1, 1, 1.9]);
  for (const x of [-.085, .085]) {
    put(root, box([.03, .012, .04], strap, .03), leatherMat, [x, r + .002, 0]);
    put(root, cyl(.006, .006, .044, 6, C.brass), metalMat, [x, r + .006, 0], [Math.PI / 2, 0, 0]);
  }
  return bake(root);
}

/** Journal page: curled paper with handwriting on both faces and a torn left edge. Lies flat. */
function makePage(): Group {
  const root = group('Journal page');
  const NX = 7, NZ = 10, W = .15, D = .21, T = .0006;
  const lift = (x: number, z: number) => .011 * Math.pow(Math.max(0, (x - .01) / .065), 2) + .0035 * Math.pow(z / .105, 2);
  const positions: number[] = [], uvs: number[] = [], index: number[] = [];
  for (const face of [1, -1]) {
    const base = positions.length / 3;
    for (let k = 0; k < NZ; k++) {
      for (let i = 0; i < NX; i++) {
        let x = -W / 2 + W * i / (NX - 1);
        if (i === 0) x += (hash(k * 3.7 + 1) - .5) * .008 + .002;
        const z = -D / 2 + D * k / (NZ - 1);
        positions.push(x, lift(x, z) + face * T, z);
        const u = (x + W / 2) / W;
        uvs.push(face > 0 ? u : 1 - u, 1 - (z + D / 2) / D);
      }
    }
    for (let k = 0; k < NZ - 1; k++) {
      for (let i = 0; i < NX - 1; i++) {
        const a = base + k * NX + i, b = a + NX, c = a + 1, d = b + 1;
        if (face > 0) index.push(a, b, c, b, d, c);
        else index.push(a, c, b, b, c, d);
      }
    }
  }
  const sheet = new BufferGeometry();
  sheet.setAttribute('position', new Float32BufferAttribute(positions, 3));
  sheet.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  sheet.setIndex(index);
  sheet.computeVertexNormals();
  put(root, sheet, paperMat);
  return bake(root);
}

export const itemAssets = {
  stick: makeStick(),
  log: makeLog(),
  plank: makePlank(),
  cloth: makeCloth(),
  resin: makeResin(),
  flint: makeFlint(),
  cord: makeCord(),
  trigger: makeTrigger(),
  spring: makeSpring(),
  meat: makeMeat(),
  mushroom: makeMushroom(),
  berries: makeBerries(),
  herb: makeHerb(),
  'stew-bowl': makeStewBowl(),
  spoon: makeSpoon(),
  hammer: makeHammer(),
  axe: makeAxe(),
  lighter: makeLighter(),
  torch: makeTorch(),
  spear: makeSpear(),
  crossbow: makeCrossbow(),
  bolt: makeBolt(),
  'bolt-bundle': makeBoltBundle(),
  'sentry-kit': makeSentryKit(),
  page: makePage(),
  'pack-roll': makePackRoll(),
};
