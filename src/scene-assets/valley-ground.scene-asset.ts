/**
 * The walkable valley floor: one INDEXED, faceted mesh sampled from `terrainHeight` on a 1 m
 * grid (a 0.33 m patch around camp, coarse on the far ridges), with trails, clearings, banks
 * and baked contact shadows painted into vertex colours. Also builds the crisp trail decal
 * ('valley-trails') and the invisible locomotion colliders ('valley-colliders').
 * A hidden deck over the log bridge shares the same attribute set, so the whole group
 * is one LocomotionEnvironment.
 */
import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial } from '@iwsdk/core';
import { campDirtMask, pinePlacements } from './woodland.scene-asset.js';
import { bridgeDeckY } from './valley-regions.scene-asset.js';
import { colliders, shades } from './valley-kit.scene-asset.js';
import './valley-props.scene-asset.js';
import {
  BROOK, GLB_PINES, GROVE, MEADOW, OUTPOST, SPIRE, TRAIL_HALF_WIDTH, TRAILS, trailHit, trailNearest, VALLEY_PINES,
} from './valley-layout.scene-asset.js';
import { brookHit, brookNearest, brookWaterY, noise, smooth, terrainHeight, WORLD_BOUNDS } from '../game/terrain.js';

// ------------------------------------------------------------------ baked shadows
const CELL = 4;
const buckets = new Map<number, typeof shades>();
const key = (i: number, j: number) => (i + 500) * 1000 + (j + 500);
for (const s of shades) {
  const r = Math.max(s.rx, s.rz);
  for (let i = Math.floor((s.x - r) / CELL); i <= Math.floor((s.x + r) / CELL); i++) {
    for (let j = Math.floor((s.z - r) / CELL); j <= Math.floor((s.z + r) / CELL); j++) {
      const k = key(i, j);
      let list = buckets.get(k);
      if (!list) buckets.set(k, list = []);
      list.push(s);
    }
  }
}
function shadeAt(x: number, z: number) {
  const list = buckets.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!list) return 1;
  let k = 1;
  for (const shade of list) {
    const dx = x - shade.x, dz = z - shade.z;
    const lx = dx * shade.cos - dz * shade.sin, lz = dx * shade.sin + dz * shade.cos;
    const d = Math.hypot(lx / shade.rx, lz / shade.rz);
    if (d < 1) k *= 1 - shade.opacity * (1 - d * d) ** 2;
  }
  return k;
}

// ---------------------------------------------------------------- stitched grid
// A uniform 1 m grid over the valley that coarsens on the far ridges, with a 3× denser
// patch around camp (crisp contact shadows under the props). The patch's border vertices
// sit exactly on the coarse edges, so the seam is closed. (1 m keeps the whole floor near
// 20k triangles: it is drawn in every view.)
const STEP = 1, ZC = -1.2, PATCH = 7, SUB = 3;
function axis(centre: number, uniformMin: number, uniformMax: number, min: number, max: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil((uniformMin - centre) / STEP); centre + k * STEP <= uniformMax + 1e-6; k++) out.push(centre + k * STEP);
  let v = out[out.length - 1], s = STEP;
  while (v < max) { s = Math.min(5, s * 1.45); v = Math.min(max, v + s); out.push(v); }
  v = out[0]; s = STEP;
  while (v > min) { s = Math.min(5, s * 1.45); v = Math.max(min, v - s); out.unshift(v); }
  return out.map((x) => +x.toFixed(4));
}
const xs = axis(0, -36, 36, -64, 64);
const zs = axis(ZC, -67, 14.5, -100, 38);
const W = xs.length, H = zs.length;
const px0 = -PATCH * STEP, px1 = PATCH * STEP, pz0 = ZC - PATCH * STEP, pz1 = ZC + PATCH * STEP;
const N = PATCH * 2 * SUB + 1, dense = (PATCH * 2 * STEP) / (N - 1);
const vertexCount = W * H + N * N;
const positions = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3), colors = new Float32Array(vertexCount * 3);
const grassA = new Color(0x7fb038), grassB = new Color(0x9dcb46), grassC = new Color(0x5f9430);
const meadowC = new Color(0xa8cf52), groveC = new Color(0x55702e), needleC = new Color(0x6f5a3a), dryC = new Color(0x9aa84e);
const dirtA = new Color(0xb98d57), dirtB = new Color(0x9a6f42), rockC = new Color(0x8a8578), earthC = new Color(0x7d7458);
const gravelC = new Color(0xa0906e), wetC = new Color(0x6f6250), beltC = new Color(0x3d5a2e), stoneDust = new Color(0xa39a86);
const color = new Color(), tint = new Color(), dirt = new Color();
const eps = .3;
function writeVertex(v: number, x: number, z: number, y = terrainHeight(x, z)) {
  positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
  const gx = (terrainHeight(x + eps, z) - terrainHeight(x - eps, z)) / (2 * eps), gz = (terrainHeight(x, z + eps) - terrainHeight(x, z - eps)) / (2 * eps);
  const inv = 1 / Math.hypot(gx, 1, gz);
  normals[v * 3] = -gx * inv; normals[v * 3 + 1] = inv; normals[v * 3 + 2] = -gz * inv;
  const slope = Math.hypot(gx, gz);
  const broad = noise(x * .55, z * .55), fine = noise(x * 2.2 + 3, z * 2.2 - 1);
  color.copy(grassA).lerp(grassB, smooth(-.5, .6, broad)).lerp(grassC, smooth(.2, .9, fine) * .3);
  // Regional tints: bright meadow, shaded needle-strewn grove, drier upland.
  const meadow = smooth(1.05, .7, Math.hypot((x - MEADOW.centre.x + 1.2) / 12.5, (z - MEADOW.centre.z + .6) / 10.5));
  color.lerp(meadowC, meadow * .55);
  const grove = smooth(13, 6, Math.hypot(x - GROVE.centre.x, (z - GROVE.centre.z) * 1.15));
  color.lerp(tint.copy(groveC).lerp(needleC, smooth(-.4, .8, fine) * .6), grove * .9);
  color.lerp(dryC, smooth(-36, -54, z) * .45 * (1 - meadow));
  // Outside the walls: shaded forest floor under the pine belts, rock on the steepest crags.
  const out = Math.max(WORLD_BOUNDS.minX - x, x - WORLD_BOUNDS.maxX, WORLD_BOUNDS.minZ - z, z - WORLD_BOUNDS.maxZ);
  const belt = smooth(-1.5, 2.5, out);
  color.lerp(tint.copy(beltC).lerp(grassC, smooth(-.3, .7, broad) * .35), belt * .8);
  color.lerp(tint.copy(earthC).lerp(rockC, smooth(-.2, .6, broad)), smooth(.55, 1.2, slope) * (belt > .5 ? .35 + .4 * smooth(0, .8, fine) : .8));
  // Brook banks: gravel then wet sand at the waterline.
  if (Math.abs(x - 21) < 20) {
    const bd = brookNearest(x, z), water = brookWaterY(brookHit.z);
    color.lerp(gravelC, smooth(3.2, 1.9, bd + fine * .25) * .85);
    color.lerp(wetC, smooth(.12, -.04, y - water) * .8);
  }
  // Clearings: packed earth at the outpost, stone dust on the Spire plateau.
  const outpost = smooth(5.6, 2.8, Math.hypot(x - OUTPOST.centre.x, (z - OUTPOST.centre.z) * 1.1) + broad * 1.2);
  const plateau = smooth(5.6, 3, Math.hypot(x - SPIRE.centre.x, (z - SPIRE.centre.z) * 1.1) + fine * .8);
  // Trails and the camp clearing.
  trailNearest(x, z);
  const side = trailHit.key === 'main' ? 1 : .85;
  // The crisp edge comes from the 'valley-trails' decal; the paint stays just inside it.
  const trail = smooth(.95, .62, trailHit.edge + broad * .08 + fine * .05) * side;
  const mask = Math.max(campDirtMask(x, z), trail, outpost * .8);
  dirt.copy(dirtA).lerp(dirtB, smooth(-.3, .7, fine));
  color.lerp(dirt, mask).lerp(stoneDust, plateau * .7);
  color.multiplyScalar((1 - .05 * Math.sin(mask * Math.PI)) * shadeAt(x, z) * (1 + .03 * Math.min(y, 8) / 8));
  colors[v * 3] = color.r; colors[v * 3 + 1] = color.g; colors[v * 3 + 2] = color.b;
}
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) writeVertex(j * W + i, xs[i], zs[j]);
// Dense camp patch; border vertices take the coarse edge's linear height.
const lerpEdge = (a: number, b: number, t: number) => a + (b - a) * t;
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = px0 + i * dense, z = pz0 + j * dense;
    let y: number | undefined;
    const onX = i === 0 || i === N - 1, onZ = j === 0 || j === N - 1;
    if ((onX && j % SUB) || (onZ && i % SUB)) {
      if (onX) {
        const z0 = pz0 + Math.floor(j / SUB) * STEP;
        y = lerpEdge(terrainHeight(x, z0), terrainHeight(x, z0 + STEP), (j % SUB) / SUB);
      } else {
        const x0 = px0 + Math.floor(i / SUB) * STEP;
        y = lerpEdge(terrainHeight(x0, z), terrainHeight(x0 + STEP, z), (i % SUB) / SUB);
      }
    }
    writeVertex(W * H + j * N + i, x, z, y);
  }
}
const indices: number[] = [];
const inPatch = (x0: number, x1: number, z0: number, z1: number) => x0 >= px0 - 1e-3 && x1 <= px1 + 1e-3 && z0 >= pz0 - 1e-3 && z1 <= pz1 + 1e-3;
for (let j = 0; j < H - 1; j++) {
  for (let i = 0; i < W - 1; i++) {
    if (inPatch(xs[i], xs[i + 1], zs[j], zs[j + 1])) continue;
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    if ((i + j) % 2) indices.push(a, c, b, b, c, d); else indices.push(a, c, d, a, d, b);
  }
}
for (let j = 0; j < N - 1; j++) {
  for (let i = 0; i < N - 1; i++) {
    const a = W * H + j * N + i, b = a + 1, c = a + N, d = c + 1;
    if ((i + j) % 2) indices.push(a, c, b, b, c, d); else indices.push(a, c, d, a, d, b);
  }
}
// Facet the floor like the source GLTS: every triangle gets its own vertices (still INDEXED,
// sequentially), a face normal and a subtle per-triangle tint; corner colours keep the baked shadows.
const triCount = indices.length / 3;
const fPos = new Float32Array(triCount * 9), fNor = new Float32Array(triCount * 9), fCol = new Float32Array(triCount * 9);
const fIdx = new Uint32Array(triCount * 3);
for (let t = 0; t < triCount; t++) {
  const ia = indices[t * 3], ib = indices[t * 3 + 1], ic = indices[t * 3 + 2];
  const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
  const ux = positions[ib * 3] - ax, uy = positions[ib * 3 + 1] - ay, uz = positions[ib * 3 + 2] - az;
  const vx = positions[ic * 3] - ax, vy = positions[ic * 3 + 1] - ay, vz = positions[ic * 3 + 2] - az;
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const cx = ax + (ux + vx) / 3, cz = az + (uz + vz) / 3;
  const h = Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453, r = h - Math.floor(h);
  const inCampPatch = cx > px0 && cx < px1 && cz > pz0 && cz < pz1;
  const jitter = 1 + (r - .5) * (inCampPatch ? .05 : .09);
  [ia, ib, ic].forEach((src, k) => {
    const o = (t * 3 + k) * 3;
    fPos[o] = positions[src * 3]; fPos[o + 1] = positions[src * 3 + 1]; fPos[o + 2] = positions[src * 3 + 2];
    fNor[o] = nx; fNor[o + 1] = ny; fNor[o + 2] = nz;
    fCol[o] = colors[src * 3] * jitter; fCol[o + 1] = colors[src * 3 + 1] * jitter; fCol[o + 2] = colors[src * 3 + 2] * jitter;
    fIdx[t * 3 + k] = t * 3 + k;
  });
}
const groundGeometry = new BufferGeometry();
groundGeometry.setAttribute('position', new BufferAttribute(fPos, 3));
groundGeometry.setAttribute('normal', new BufferAttribute(fNor, 3));
groundGeometry.setAttribute('color', new BufferAttribute(fCol, 3));
groundGeometry.setIndex(new BufferAttribute(fIdx, 1));
groundGeometry.computeBoundingBox();
groundGeometry.computeBoundingSphere();

/** Height of the ground MESH (its triangles, not the analytic terrain) at (x, z). */
function meshY(x: number, z: number): number {
  const corner = (base: number, stride: number, i: number, j: number, u: number, v: number) => {
    const a = base + j * stride + i, b = a + 1, c = a + stride, d = c + 1;
    const ya = positions[a * 3 + 1], yb = positions[b * 3 + 1], yc = positions[c * 3 + 1], yd = positions[d * 3 + 1];
    if ((i + j) % 2) return u + v <= 1 ? ya + u * (yb - ya) + v * (yc - ya) : yd + (1 - u) * (yc - yd) + (1 - v) * (yb - yd);
    return v >= u ? ya + v * (yc - ya) + u * (yd - yc) : ya + u * (yb - ya) + v * (yd - yb);
  };
  if (x > px0 && x < px1 && z > pz0 && z < pz1) {
    const fi = (x - px0) / dense, fj = (z - pz0) / dense, i = Math.min(N - 2, Math.floor(fi)), j = Math.min(N - 2, Math.floor(fj));
    return corner(W * H, N, i, j, fi - i, fj - j);
  }
  const find = (arr: number[], v: number) => { let lo = 0, hi = arr.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m] <= v) lo = m; else hi = m - 1; } return lo; };
  const i = find(xs, x), j = find(zs, z);
  return corner(0, W, i, j, (x - xs[i]) / (xs[i + 1] - xs[i]), (z - zs[j]) / (zs[j + 1] - zs[j]));
}

// ----------------------------------------------------------- crisp trail decal strips
function trailDecal(): Mesh {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const edgeC = new Color(0x93683e), midC = new Color(0xb28654), wornC = new Color(0xc49a62), cc = new Color();
  for (const key of Object.keys(TRAILS) as (keyof typeof TRAILS)[]) {
    const pts = TRAILS[key], half = TRAIL_HALF_WIDTH[key], lift = key === 'main' ? .016 : .011;
    const start = pos.length / 3;
    let along = 0;
    pts.forEach((p, i) => {
      const q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      const tl = Math.hypot(q.x - o.x, q.z - o.z) || 1, nx = -(q.z - o.z) / tl, nz = (q.x - o.x) / tl;
      if (i) along += Math.hypot(p.x - o.x, p.z - o.z);
      const remain = (pts.length - 1 - i) * .45;
      const taper = Math.min(1, (along + .2) / 1.1, (remain + .2) / 1.1);
      const jag = (k: number) => .93 + .1 * Math.abs(Math.sin(along * 3.7 + k * 1.9)) + .05 * Math.sin(along * 11 + k);
      const offsets = [-half * jag(1), -half * .5, 0, half * .5, half * jag(2)];
      offsets.forEach((off, k) => {
        const x = p.x + nx * off * taper, z = p.z + nz * off * taper;
        pos.push(x, meshY(x, z) + lift, z);
        const n = noise(x * 1.9 + 4, z * 1.9 - 2);
        cc.copy(k === 0 || k === 4 ? edgeC : k === 2 ? wornC : midC).multiplyScalar((.94 + .1 * n) * shadeAt(x, z));
        col.push(cc.r, cc.g, cc.b);
      });
      if (i) for (let k = 0; k < 4; k++) {
        const a = start + (i - 1) * 5 + k, b = a + 5;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    });
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  // Wind every quad to face up.
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uz = pos[b * 3 + 2] - pos[a * 3 + 2], vx = pos[c * 3] - pos[a * 3], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    if (uz * vx - ux * vz < 0) { idx[t + 1] = c; idx[t + 2] = b; }
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new Mesh(g, floorMaterial);
  mesh.name = 'Valley trails';
  return mesh;
}

// --------------------------------------------------------- hidden deck over the bridge
function bridgeWalkDeck(): BufferGeometry {
  const b = BROOK.bridge, half = b.length / 2 + .15, steps = 16, pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = k / steps, x = b.x - half + t * (half * 2), y = bridgeDeckY(Math.min(1, Math.max(0, (x - b.x + b.length / 2) / b.length)));
    for (const dz of [-.62, .62]) { pos.push(x, y, b.z + dz); nor.push(0, 1, 0); col.push(1, 1, 1); }
    if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const floorMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
floorMaterial.name = 'Painted valley floor';
/** Terrain-only prototype: attach LocomotionEnvironment to this asset's node. */
export const walkableGround = new Group();
walkableGround.name = 'Walkable valley floor';
/** Concatenate indexed position/normal/color geometries (same attribute set as the floor). */
function concat(parts: BufferGeometry[]): BufferGeometry {
  const names = ['position', 'normal', 'color'] as const;
  const total = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
  const out = new BufferGeometry(), index: number[] = [];
  const arrays = names.map(() => new Float32Array(total * 3));
  let offset = 0;
  for (const g of parts) {
    names.forEach((name, k) => arrays[k].set(g.getAttribute(name).array as Float32Array, offset * 3));
    const idx = g.getIndex()!;
    for (let i = 0; i < idx.count; i++) index.push(idx.getX(i) + offset);
    offset += g.getAttribute('position').count;
  }
  names.forEach((name, k) => out.setAttribute(name, new BufferAttribute(arrays[k], 3)));
  out.setIndex(index);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
// The crisp trail strips ride 1–1.6 cm above the facets inside the same mesh (no extra draw).
const floor = new Mesh(concat([groundGeometry, trailDecal().geometry]), floorMaterial);
floor.name = 'Valley floor';
walkableGround.add(floor);
const deck = new Mesh(bridgeWalkDeck(), floorMaterial);
deck.name = 'Bridge walk deck (hidden)';
deck.visible = false;
walkableGround.add(deck);
export const groundStats = { columns: W, rows: H, patch: N, triangles: indices.length / 3 };
export default walkableGround;



// ------------------------------------------------------------------ locomotion colliders
/**
 * Invisible vertical walls around trunks, big boulders, the tent, the lookout and
 * the Spire stone (indexed; position+normal+color like the floor). Tag the node LocomotionEnvironment.
 * Anything that would narrow a trail is skipped so the paths stay clear.
 */
function makeColliders(): Group {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  const clearOfTrails = (x: number, z: number, r: number) => {
    const d = trailNearest(x, z);
    return d - r > TRAIL_HALF_WIDTH[trailHit.key as keyof typeof TRAIL_HALF_WIDTH] + .35;
  };
  const wall = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number) => {
    const base = pos.length / 3, len = Math.hypot(bx - ax, bz - az) || 1, nx = (bz - az) / len, nz = -(bx - ax) / len;
    pos.push(ax, y0, az, bx, y0, bz, ax, y1, az, bx, y1, bz);
    for (let k = 0; k < 4; k++) { nor.push(nx, 0, nz); col.push(1, 1, 1); }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  };
  const span = (x: number, z: number, r: number) => {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 8; k++) { const h = terrainHeight(x + Math.cos(k * .785) * r, z + Math.sin(k * .785) * r); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    return [lo - 1, hi + 2.6];
  };
  const cylinder = (x: number, z: number, r: number) => {
    if (!clearOfTrails(x, z, r)) return false;
    const [y0, y1] = span(x, z, r);
    for (let k = 0; k < 8; k++) {
      const a0 = k / 8 * Math.PI * 2, a1 = (k + 1) / 8 * Math.PI * 2;
      wall(x + Math.cos(a0) * r, z + Math.sin(a0) * r, x + Math.cos(a1) * r, z + Math.sin(a1) * r, y0, y1);
    }
    return true;
  };
  const boxWalls = (x: number, z: number, hx: number, hz: number, yawDeg: number) => {
    const a = yawDeg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
    const pt = (lx: number, lz: number): [number, number] => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    const corners = [pt(-hx, -hz), pt(hx, -hz), pt(hx, hz), pt(-hx, hz)];
    if (!corners.every(([cx, cz]) => clearOfTrails(cx, cz, 0))) return false;
    const [y0, y1] = span(x, z, Math.max(hx, hz));
    for (let k = 0; k < 4; k++) wall(...corners[k], ...corners[(k + 1) % 4], y0, y1);
    return true;
  };
  let placed = 0, skipped = 0;
  const count = (ok: boolean) => { if (ok) placed++; else skipped++; };
  for (const p of GLB_PINES) count(cylinder(p.x, p.z, .3 * p.scale / .9));
  for (const p of pinePlacements) count(cylinder(p.x, p.z, .28));
  for (const stand of Object.values(VALLEY_PINES)) for (const t of stand) count(cylinder(t.x, t.z, .24 * t.scale));
  for (const c of colliders) count(c.type === 'cyl' ? cylinder(c.x, c.z, c.r) : boxWalls(c.x, c.z, c.hx, c.hz, c.yawDeg));
  colliderStats.placed = placed; colliderStats.skipped = skipped;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const mesh = new Mesh(g, floorMaterial);
  mesh.name = 'Collider walls';
  mesh.visible = false;
  const root = new Group();
  root.name = 'Valley colliders (invisible, LocomotionEnvironment)';
  root.add(mesh);
  return root;
}
export const colliderStats = { placed: 0, skipped: 0 };
export const valleyColliders = makeColliders();
