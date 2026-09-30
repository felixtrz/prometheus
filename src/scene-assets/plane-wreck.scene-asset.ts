/**
 * The plane wreck where a fresh journey wakes (design/JOURNEY.md): a twin-engine
 * commuter plane down in the valley's south-west corner, burning at dawn.
 *
 * Authored in wreck-local space (src/game/journey.ts WRECK: +X the nose, -Z the door
 * side, cabin deck at WRECK.deckY). Every scene node of the wreck sits at WRECK.origin
 * with no rotation; exterior parts that touch the ground sample the terrain through
 * groundLocal, so the prototype only fits that spot.
 *
 * Prototypes (all parentless, deterministic, no lights):
 * - planeWreck: the visual. Six draws: one lit, vertex-coloured material for all solids
 *   ('Wreck hull', with a baked `glow` attribute added as emissive: firelight and the red
 *   emergency light without a light source), the door panel (same material, its own
 *   mesh), 'Wreck emergency lights' (unlit strips a system may blink), 'Wreck windows and
 *   embers' (unlit), 'Wreck fire' (additive shader flames, uniforms uTime, uIntensity) and
 *   'Wreck smoke' (shader, uTime, uDensity).
 *   Named contracts: 'wreck-door-panel' (group; origin at the panel's bottom centre, posed
 *   ajar by journey.panelAjar; JourneySystem animates it), 'wreck-axe-bracket' (marker
 *   group at the axe's grip point), 'wreck-fire', 'wreck-smoke', 'wreck-lamps'. The hull
 *   material's glow strength is `material.userData.glow` ({ value }, shared uniform).
 * - wreckDeck: invisible cabin floor (scene: ItemSurface + LocomotionEnvironment).
 * - wreckWalls: invisible cabin walls, hull, wings, tail and the ramp at the door
 *   (LocomotionEnvironment).
 * - wreckDoorBlocker: invisible quad across the doorway (LocomotionEnvironment), removed
 *   when the door is torn off.
 */
import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Euler, Float32BufferAttribute,
  Group, Matrix3, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, ShaderMaterial, SphereGeometry, Vector3,
} from '@iwsdk/core';
import type { Material, Object3D } from '@iwsdk/core';
import { DOOR, groundLocal, panelAjar, WRECK, WRECK_FIRES, type PanelPose } from '../game/journey.js';

type Vec3 = [number, number, number];
type Tint = number | ((x: number, y: number, z: number) => number);

const { cy, outer: R_OUT, inner: R_IN } = WRECK.tube;
const DECK = WRECK.deckY;
const DOOR_Z = WRECK.door.z;

// ─────────────────────────────────────────────────────────────────── batch builder

/** Accumulates non-indexed triangles for one draw, attribute by attribute. */
class Batch {
  readonly data: Record<string, number[]> = {};
  constructor(readonly sizes: Record<string, number>) {
    for (const key of Object.keys(sizes)) this.data[key] = [];
  }
  get glowing(): boolean { return 'glow' in this.sizes; }
  mesh(name: string, material: Material): Mesh {
    const geometry = new BufferGeometry();
    for (const [key, size] of Object.entries(this.sizes)) geometry.setAttribute(key, new Float32BufferAttribute(this.data[key], size));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }
}

const tmpColor = new Color();
const tmpMatrix = new Matrix4();
const tmpNormal = new Matrix3();
const tmpQuat = new Quaternion();
const tmpEuler = new Euler();
const tmpScale = new Vector3();
const tmpPos = new Vector3();
const p = new Vector3();
const n = new Vector3();

/** Deterministic value noise in [-1, 1]. */
const wobble = (a: number, b: number) => Math.sin(a * 12.9898 + b * 78.233) * .5 + Math.sin(a * 3.1 - b * 5.7 + 1.3) * .5;

/**
 * Soot and dirt, as a brightness factor on a vertex: black near the rear fire and the
 * burning engine, dusty low on the outside.
 */
function grime(x: number, y: number, z: number): number {
  let k = 1;
  k *= .28 + .72 * Math.min(1, Math.max(0, (x - WRECK.rearX) / 2.2));
  const engine = Math.hypot(x - .9, z - 3.45);
  k *= .35 + .65 * Math.min(1, engine / 2.4);
  if (Math.abs(z) > 1.3 && y < .5) k *= .72 + .56 * Math.max(0, y);
  return k;
}

/** Firelight and emergency light baked per vertex (linear RGB, added as emissive). */
function glowAt(x: number, y: number, z: number, out: number[]): void {
  let r = 0, g = 0, b = 0;
  for (const fire of WRECK_FIRES) {
    const d2 = (x - fire.x) ** 2 + ((y - fire.y - .5) * 1.2) ** 2 + (z - fire.z) ** 2;
    const k = fire.heat * (fire.inside ? .55 : .45) / (1 + d2 / (fire.inside ? 1.1 : 1.6));
    r += k; g += k * .42; b += k * .12;
  }
  // Red strips along the ceiling, amber path lights along the floor.
  if (x > -3.4 && x < 4.3) {
    const strip = Math.min(Math.hypot(y - 2.33, z - .92), Math.hypot(y - 2.33, z + .92));
    const s = .09 / (1 + (strip / .3) ** 2);
    r += s; g += s * .05; b += s * .04;
    const floor = Math.min(Math.hypot(y - DECK, z + .52), Math.hypot(y - DECK, z - .17));
    const f = .06 / (1 + (floor / .2) ** 2);
    r += f; g += f * .45;
  }
  out.push(Math.min(r, .9), Math.min(g, .5), Math.min(b, .2));
}

const glowScratch: number[] = [];
/** Push one vertex's colour (and glow) at its final position. */
function colourVertex(batch: Batch, x: number, y: number, z: number, tint: Tint, variation: number, dirty: boolean): void {
  tmpColor.setHex(typeof tint === 'number' ? tint : tint(x, y, z));
  const drift = (1 + variation * wobble(x * 1.7 + y * .3, z * 1.9 - y)) * (dirty ? grime(x, y, z) : 1);
  batch.data.color.push(tmpColor.r * drift, tmpColor.g * drift, tmpColor.b * drift);
  if (batch.glowing) {
    glowScratch.length = 0;
    glowAt(x, y, z, glowScratch);
    batch.data.glow.push(glowScratch[0], glowScratch[1], glowScratch[2]);
  }
}

/** Add a primitive to a batch with a transform (position, Euler XYZ radians, scale). */
function put(batch: Batch, geometry: BufferGeometry, at: Vec3, tint: Tint, options: { rot?: Vec3; scale?: Vec3; variation?: number; dirty?: boolean; parent?: Matrix4 } = {}): void {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  if (!source.getAttribute('normal')) source.computeVertexNormals();
  tmpEuler.set(...(options.rot ?? [0, 0, 0]));
  tmpQuat.setFromEuler(tmpEuler);
  tmpScale.set(...(options.scale ?? [1, 1, 1]));
  tmpPos.set(...at);
  tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
  if (options.parent) tmpMatrix.premultiply(options.parent);
  tmpNormal.getNormalMatrix(tmpMatrix);
  const positions = source.getAttribute('position');
  const normals = source.getAttribute('normal');
  for (let i = 0; i < positions.count; i++) {
    p.set(positions.getX(i), positions.getY(i), positions.getZ(i)).applyMatrix4(tmpMatrix);
    n.set(normals.getX(i), normals.getY(i), normals.getZ(i)).applyMatrix3(tmpNormal).normalize();
    batch.data.position.push(p.x, p.y, p.z);
    batch.data.normal.push(n.x, n.y, n.z);
    colourVertex(batch, p.x, p.y, p.z, tint, options.variation ?? .04, options.dirty ?? true);
  }
  if (source !== geometry) source.dispose();
  geometry.dispose();
}

/** One flat-shaded triangle from three points (normal from the winding). */
function tri(batch: Batch, a: Vec3, b: Vec3, c: Vec3, tint: Tint, variation = .04): void {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  for (const v of [a, b, c]) {
    batch.data.position.push(v[0], v[1], v[2]);
    batch.data.normal.push(nx, ny, nz);
    colourVertex(batch, v[0], v[1], v[2], tint, variation, true);
  }
}
const quad = (batch: Batch, a: Vec3, b: Vec3, c: Vec3, d: Vec3, tint: Tint, variation = .04) => {
  tri(batch, a, b, c, tint, variation);
  tri(batch, a, c, d, tint, variation);
};

const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);

// ─────────────────────────────────────────────────────────────────────── materials

/** Solids: one lit vertex-coloured material; `glow` (vec3 attribute) adds baked emissive light. */
function glowingMaterial(name: string): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: .72, metalness: .12, flatShading: true });
  material.name = name;
  const glow = { value: 1 };
  material.userData.glow = glow;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = glow;
    shader.vertexShader = `attribute vec3 glow;\nvarying vec3 vGlow;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGlow = glow;');
    shader.fragmentShader = `uniform float uGlow;\nvarying vec3 vGlow;\n${shader.fragmentShader}`
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vGlow * uGlow;');
  };
  material.customProgramCacheKey = () => 'prometheus-wreck-glow';
  return material;
}
const hullMaterial = glowingMaterial('Wreck hull');
const lampMaterial = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
lampMaterial.name = 'Wreck emergency lights';
const glassMaterial = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
glassMaterial.name = 'Wreck windows and embers';

const fireMaterial = new ShaderMaterial({
  name: 'Wreck fire',
  uniforms: { uTime: { value: 0 }, uIntensity: { value: 1 } },
  vertexShader: /* glsl */ `
    attribute vec3 flame; // phase, heat, base height
    uniform float uTime;
    varying vec2 vUv;
    varying float vHeat;
    void main() {
      vUv = uv;
      vHeat = flame.y;
      vec3 p = position;
      float t = uTime * 2.4 + flame.x * 6.2832;
      float lift = uv.y * uv.y;
      p.y = flame.z + (p.y - flame.z) * (0.86 + 0.18 * sin(t * 1.9) + 0.08 * sin(t * 4.3));
      p.x += sin(t * 1.7 + uv.y * 3.0) * 0.09 * lift * flame.y;
      p.z += cos(t * 1.3 + uv.y * 2.0) * 0.09 * lift * flame.y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uIntensity;
    varying vec2 vUv;
    varying float vHeat;
    void main() {
      float y = vUv.y;
      float half_width = sin(3.14159 * pow(max(y, 0.001), 0.55)) * (1.0 - 0.65 * y) * 0.5;
      float x = abs(vUv.x - 0.5);
      float a = (1.0 - smoothstep(half_width * 0.35, half_width, x)) * smoothstep(0.0, 0.07, y) * (1.0 - y * 0.85);
      vec3 hot = vec3(1.0, 0.9, 0.55);
      vec3 col = mix(hot, vec3(1.0, 0.42, 0.08), smoothstep(0.08, 0.6, y));
      col = mix(col, vec3(0.55, 0.09, 0.02), smoothstep(0.62, 1.0, y));
      gl_FragColor = vec4(col * a * uIntensity * (0.75 + 0.25 * vHeat), a * uIntensity);
    }`,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  side: DoubleSide,
});

const smokeMaterial = new ShaderMaterial({
  name: 'Wreck smoke',
  uniforms: { uTime: { value: 0 }, uDensity: { value: 1 } },
  vertexShader: /* glsl */ `
    attribute vec2 smoke; // phase, density
    varying vec2 vUv;
    varying vec2 vSmoke;
    uniform float uTime;
    void main() {
      vUv = uv;
      vSmoke = smoke;
      vec3 p = position;
      p.x += sin(uTime * 0.35 + smoke.x * 6.28 + uv.y * 2.0) * 0.35 * uv.y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uDensity;
    varying vec2 vUv;
    varying vec2 vSmoke;
    float wave(vec2 q) {
      return sin(q.x * 5.1 + sin(q.y * 3.3)) * 0.5 + sin(q.y * 7.3 - q.x * 2.1 + 1.7) * 0.3 + sin((q.x + q.y) * 11.0) * 0.2;
    }
    void main() {
      vec2 q = vec2(vUv.x * 2.0 + vSmoke.x * 7.0, vUv.y * 3.0 - uTime * 0.22 - vSmoke.x);
      float billow = 0.55 + 0.45 * wave(q);
      float edge = 1.0 - smoothstep(0.18, 0.5, abs(vUv.x - 0.5));
      float fade = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
      float a = edge * fade * billow * vSmoke.y * uDensity;
      vec3 col = mix(vec3(0.07, 0.065, 0.06), vec3(0.3, 0.29, 0.28), vUv.y);
      gl_FragColor = vec4(col, a * 0.8);
    }`,
  transparent: true,
  depthWrite: false,
  side: DoubleSide,
});

// ─────────────────────────────────────────────────────────────────────── palette

const C = {
  paint: 0xe4e2dc, stripe: 0xb3342a, stripe2: 0x1f3a5c, belly: 0x8c9096, metal: 0x5d6268, darkMetal: 0x33373c,
  lining: 0xd8d2c2, liningDark: 0xa9a291, ceiling: 0xe6e1d4, carpet: 0x3b4150, aisle: 0x4a4f5e,
  fabric: 0x2b3a57, fabricDark: 0x1f2a40, headrest: 0xcfd3d6, seatFrame: 0x3a3d42, belt: 0x6d6f72, buckle: 0xb9bcc0,
  bin: 0xdcd6c8, mask: 0xf2c230, soil: 0x3a2e24, soilDark: 0x271f19, char: 0x1a1715, emergency: 0xc81e1e,
  cockpitGlass: 0x1b242e, dawnGlass: 0x7d93ab, exitGreen: 0x16c455, exitWhite: 0xf4fff4, stripLight: 0xff2a14,
  pathLight: 0xffa21e, ember: 0xff5a14, emberDeep: 0xa81e08,
} as const;

// ───────────────────────────────────────────────────────────────────── the fuselage

/** A point on the fuselage tube: angle `a` from the top, round through +Z (south) and the belly. */
const ring = (x: number, a: number, r: number): Vec3 => [x, cy + r * Math.cos(a), r * Math.sin(a)];

const DOOR_A0 = 2 * Math.PI - Math.acos((WRECK.door.sill - cy) / R_OUT);
const DOOR_A1 = 2 * Math.PI - Math.acos((WRECK.door.top - cy) / R_OUT);
const SEGMENTS = 36;
/** Heights where the paint and lining change (stripes, window band, belly): exact angle breaks, both sides. */
const PAINT_BREAKS = [.55, 1.29, 1.455, 1.525, 1.55, 1.61, 1.69, 2.2];
/** Tube angles (0 = top), with the door's head and sill and the paint lines as exact breaks. */
const ANGLES = [
  ...Array.from({ length: SEGMENTS + 1 }, (_, i) => i / SEGMENTS * Math.PI * 2), DOOR_A0, DOOR_A1,
  ...[R_OUT, R_IN].flatMap((r) => PAINT_BREAKS.flatMap((y) => {
    const a = Math.acos((y - cy) / r);
    return [a, 2 * Math.PI - a];
  })),
].sort((a, b) => a - b).filter((a, i, list) => i === 0 || a - list[i - 1] > 1e-4);
/** Tube stations along X, with the door's edges as exact breaks. */
const STATIONS = (() => {
  const xs: number[] = [];
  for (let x = WRECK.rearX; x < WRECK.bulkheadX + .05; x += .45) xs.push(+x.toFixed(3));
  xs.push(WRECK.door.x0, WRECK.door.x1, 4.4);
  return [...new Set(xs)].sort((a, b) => a - b).filter((x) => x <= 4.4);
})();

/** Torn skin at the rear: the first station ring is jagged, and the roof there is open. */
const rearJag = (a: number) => .38 * Math.abs(wobble(a * 3.1, 1.7)) + .12 * Math.sin(a * 7);
const roofHole = (x: number, a: number) => x < -3.25 && (a < .55 || a > 2 * Math.PI - .5);
const inDoor = (x: number, a: number) => x > WRECK.door.x0 && x < WRECK.door.x1 && a > DOOR_A0 && a < DOOR_A1;

function skin(batch: Batch, r: number, inward: boolean): void {
  for (let i = 0; i < STATIONS.length - 1; i++) {
    for (let j = 0; j < ANGLES.length - 1; j++) {
      const x0 = STATIONS[i], x1 = STATIONS[i + 1], a0 = ANGLES[j], a1 = ANGLES[j + 1];
      const xm = (x0 + x1) / 2, am = (a0 + a1) / 2;
      if (inDoor(xm, am) || roofHole(xm, am)) continue;
      const ym = cy + r * Math.cos(am);
      // The lining stops at the deck; the skin is buried below -0.35.
      if (inward && ym < DECK - .02) continue;
      if (!inward && ym < -.35) continue;
      const jag0 = i === 0 ? rearJag(a0) : 0, jag1 = i === 0 ? rearJag(a1) : 0;
      const a: Vec3 = ring(x0 + jag0, a0, r), b: Vec3 = ring(x1, a0, r), c: Vec3 = ring(x1, a1, r), d: Vec3 = ring(x0 + jag1, a1, r);
      // One flat paint per cell, read at its centre (the stripes follow the angle breaks).
      const zm = r * Math.sin(am);
      const tint = inward
        ? (Math.abs(ym - 1.45) < .16 ? C.liningDark : ym > 2.2 ? C.ceiling : C.lining)
        : (ym < .55 ? C.belly : Math.abs(ym - 1.62) < .07 ? C.stripe : Math.abs(ym - 1.49) < .035 && zm < 0 ? C.stripe2 : C.paint);
      if (inward) { quad(batch, a, b, c, d, tint, .03); } else { quad(batch, a, d, c, b, tint, .03); }
    }
  }
}

/** A small window patch hugging the tube at station x, angle a. */
function windowPatch(batch: Batch, x: number, a: number, r: number, tint: number, inward: boolean): void {
  const hw = .12, ha = .16 / r;
  const lift = inward ? -.012 : .012;
  const pts = [[-hw, -ha], [hw, -ha], [hw, ha], [-hw, ha]].map(([dx, da]) => ring(x + dx, a + da, r + lift));
  if (inward) quad(batch, pts[0], pts[3], pts[2], pts[1], tint, 0);
  else quad(batch, pts[0], pts[1], pts[2], pts[3], tint, 0);
}

// ─────────────────────────────────────────────────────────────────────── the cabin

function seat(batch: Batch, x: number, z: number, burnt: number, tiltDeg = 0): void {
  const fabric: Tint = burnt > .5 ? C.char : burnt > 0 ? C.fabricDark : C.fabric;
  const t = tiltDeg * Math.PI / 180;
  const parent = new Matrix4().compose(new Vector3(x, DECK, z), new Quaternion().setFromEuler(new Euler(t * .3, 0, t)), new Vector3(1, 1, 1));
  const opts = (extra: object = {}) => ({ parent, ...extra });
  put(batch, box(.46, .12, .43), [0, .43, 0], fabric, opts());
  put(batch, box(.1, .7, .43), [-.25, .83, 0], fabric, opts({ rot: [0, 0, .17] }));
  put(batch, box(.022, .2, .36), [-.19, 1.07, 0], burnt > 0 ? C.char : C.headrest, opts({ rot: [0, 0, .17], variation: .02 }));
  for (const side of [-1, 1]) {
    put(batch, box(.42, .045, .05), [-.02, .6, side * .235], C.seatFrame, opts());
    put(batch, box(.05, .37, .05), [.15, .185, side * .17], C.seatFrame, opts());
    put(batch, box(.05, .37, .05), [-.18, .185, side * .17], C.seatFrame, opts());
  }
  // The belt, unbuckled: two straps hanging over the cushion's front edge.
  for (const side of [-1, 1]) put(batch, box(.2, .006, .045), [.12, .5, side * .1], C.belt, opts({ rot: [0, 0, -.9], variation: 0 }));
  put(batch, box(.045, .012, .06), [.22, .41, -.1], C.buckle, opts({ variation: 0 }));
}

function cabin(solid: Batch): void {
  const { x0, x1 } = { x0: WRECK.rearX + .35, x1: WRECK.bulkheadX };
  const len = x1 - x0, mid = (x0 + x1) / 2;
  // Floor: carpet with a lighter aisle runner.
  put(solid, box(len, .05, 2.12), [mid, DECK - .025, 0], C.carpet, { variation: .06 });
  put(solid, box(len, .004, .72), [mid, DECK + .002, -.17], C.aisle, { variation: .05 });
  // Ceiling panel and the coves down to the bins (the rear of it fell in: see the roof hole).
  const cx0 = -3.25;
  put(solid, box(x1 - cx0, .03, 1.9), [(cx0 + x1) / 2, WRECK.ceilingY + .015, 0], C.ceiling, { variation: .03 });
  // A torn ceiling panel hanging into the aisle at the rear.
  put(solid, box(.9, .025, .7), [-3.0, 2.12, -.1], C.ceiling, { rot: [.35, 0, -.55] });
  // Overhead bins along both walls (not over the door and galley); two hang open.
  for (const side of [-1, 1]) {
    for (let bx = -3.3; bx < 2.2; bx += 1.1) {
      put(solid, box(1.06, .33, .44), [bx + .55, 2.13, side * .95], C.bin, { variation: .03 });
      const open = (side < 0 && bx > -1.5 && bx < -.5) || (side > 0 && bx < -2.5);
      put(solid, box(1.0, .2, .025), [bx + .55, open ? 1.83 : 1.98, side * (open ? .69 : .728)], C.liningDark, { rot: [open ? side * .9 : 0, 0, 0] });
    }
  }
  // Seats: a single on the door side, a double opposite; the rear two rows burnt and wrecked.
  WRECK.rows.forEach((x, row) => {
    const burnt = row === 0 ? 1 : row === 1 ? .4 : 0;
    const tilt = row === 0 ? 14 : row === 1 ? 5 : 0;
    seat(solid, x, WRECK.seatZ.single, burnt, tilt);
    seat(solid, x, WRECK.seatZ.aisle, burnt, row === 0 ? -9 : 0);
    seat(solid, x, WRECK.seatZ.window, burnt, row === 0 ? 11 : 0);
  });
  // Oxygen masks dropped over the rear rows.
  for (const [x, z, drop] of [[-3.4, .6, .5], [-2.55, .78, .62], [-2.6, -.8, .44], [-1.7, .45, .58], [-.86, -.75, .5], [-.9, .82, .4]] as Vec3[]) {
    put(solid, box(.008, drop, .008), [x, 1.95 - drop / 2, z], 0xd9dadb, { variation: 0 });
    put(solid, new CylinderGeometry(.045, .06, .07, 8), [x, 1.95 - drop - .035, z], C.mask, { variation: 0 });
  }
  // Galley opposite the door, a jump seat folded on the bulkhead, a fallen trolley.
  put(solid, box(1.3, 1.05, .5), [3.35, DECK + .525, .78], C.bin, { variation: .03 });
  put(solid, box(1.32, .04, .52), [3.35, DECK + 1.07, .78], C.metal);
  put(solid, box(.1, .5, .42), [4.26, 1.3, -.45], C.fabric);
  put(solid, box(.72, .38, .3), [2.62, DECK + .15, .6], C.metal, { rot: [0, .5, 1.5] });
  // Cockpit bulkhead with its crumpled door: a flat wall between the skins, deck to ceiling.
  put(solid, box(.04, WRECK.ceilingY - DECK + .05, 2.2), [x1 + .01, (WRECK.ceilingY + DECK) / 2, 0], C.liningDark);
  put(solid, box(.05, 1.82, .66), [x1 - .03, DECK + .91, .22], C.liningDark, { rot: [.02, 0, .015] });
  put(solid, box(.03, .04, .12), [x1 - .07, 1.35, -.02], C.metal);
  // Door frame: jambs, head and sill between the two skins.
  const dz = DOOR_Z + .05;
  put(solid, box(.07, WRECK.door.top - WRECK.door.sill + .06, .16), [WRECK.door.x0 - .035, (WRECK.door.top + WRECK.door.sill) / 2, dz], C.metal, { dirty: false });
  put(solid, box(.07, WRECK.door.top - WRECK.door.sill + .06, .16), [WRECK.door.x1 + .035, (WRECK.door.top + WRECK.door.sill) / 2, dz], C.metal, { dirty: false });
  put(solid, box(WRECK.door.x1 - WRECK.door.x0 + .14, .07, .22), [(WRECK.door.x0 + WRECK.door.x1) / 2, WRECK.door.top + .035, dz - .02], C.metal, { dirty: false });
  put(solid, box(WRECK.door.x1 - WRECK.door.x0 + .14, .05, .36), [(WRECK.door.x0 + WRECK.door.x1) / 2, DECK - .02, dz - .1], C.darkMetal, { dirty: false });
  // Emergency-axe bracket above the door: red backing plate, a white stripe, two clips.
  const ax = WRECK.axe;
  put(solid, box(.66, .2, .02), [ax.x + .02, ax.y, ax.z - .05], C.emergency, { variation: .02, dirty: false });
  put(solid, box(.6, .02, .004), [ax.x + .02, ax.y + .075, ax.z - .038], 0xf2f2f0, { variation: 0, dirty: false });
  for (const dx of [-.18, .18]) put(solid, box(.03, .06, .05), [ax.x + dx, ax.y - .02, ax.z - .02], C.metal, { dirty: false });
  // The rear debris wall: crushed seats and torn panels heaped against the break.
  const heap: [number, number, number, number, number, number, number, number][] = [
    [-4.15, .6, -.45, .55, .5, .5, .4, .3], [-4.2, .55, .45, .6, .45, .55, -.3, .6], [-4.3, 1.1, 0, .5, .45, .9, .8, -.2],
    [-4.05, .95, .7, .08, 1.1, .6, .2, .9], [-4.1, 1.35, -.6, .08, .9, .7, -.5, .4], [-4.35, 1.7, .1, .06, 1.0, 1.2, .3, 1.2],
  ];
  for (const [x, y, z, w, h, d, rx, rz] of heap) put(solid, box(w, h, d), [x, y, z], C.char, { rot: [rx, .3, rz], variation: .2 });
  // Scorched luggage by the heap (nothing that looks like a game item).
  put(solid, box(.55, .35, .22), [-3.7, DECK + .17, -.25], 0x55301f, { rot: [0, .6, .1] });
}

// ───────────────────────────────────────────────────────────── outside: wings, tail, soil

function exterior(solid: Batch, glass: Batch): void {
  // Nose: a tapered, crumpled cone, dipped into the dirt.
  const nose = new CylinderGeometry(.42, R_OUT, 2.2, 24, 3, true);
  const pos = nose.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const crush = (y + 1.1) / 2.2;
    pos.setXYZ(i, x * (1 - .08 * crush * Math.abs(wobble(x * 4, z * 4))), y, z * (1 + .06 * crush * wobble(z * 3, x * 5)));
  }
  put(solid, nose, [4.4 + 1.1, cy - .12, 0], (_x, y) => (y < .55 ? C.belly : C.paint), { rot: [0, 0, -Math.PI / 2 - .07] });
  put(solid, new SphereGeometry(.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), [6.55, cy - .36, 0], C.paint, { rot: [0, 0, -Math.PI / 2 - .07], scale: [1, .5, 1] });
  // Cockpit windows (dark) on the nose cone, and the passenger windows seen from outside.
  const noseAt = (x: number, a: number): Vec3 => {
    const r = R_OUT + (.42 - R_OUT) * (x - 4.4) / 2.2 + .015;
    return [x, cy - .04 - (x - 4.4) * .07 + r * Math.cos(a), r * Math.sin(a)];
  };
  for (const side of [-1, 1]) {
    quad(glass, noseAt(4.75, side * .5), noseAt(5.45, side * .5), noseAt(5.45, side * 1.05), noseAt(4.75, side * 1.05), C.cockpitGlass, 0);
  }
  for (const x of WRECK.rows) {
    windowPatch(glass, x + .12, Math.acos((1.45 - cy) / R_OUT), R_OUT, C.cockpitGlass, false);
    if (x < WRECK.door.x0 - .3) windowPatch(glass, x + .12, 2 * Math.PI - Math.acos((1.45 - cy) / R_OUT), R_OUT, C.cockpitGlass, false);
  }
  // Right wing (south, +Z): the root, then the outer panel broken down into the ground.
  put(solid, box(1.9, .2, 3.2), [.7, .22, 1.3 + 1.6], C.paint, { rot: [.03, 0, 0] });
  const outerLen = 4.4, hingeZ = 4.5, tipGround = groundLocal(.7, hingeZ + outerLen * .95) + .05;
  const droop = Math.atan2(.3 - tipGround, outerLen);
  put(solid, box(1.55, .16, outerLen), [.8, .3 - Math.sin(droop) * outerLen / 2, hingeZ + Math.cos(droop) * outerLen / 2], C.paint, { rot: [droop, .08, .05] });
  // Engine nacelle, spinner and bent blades (burning).
  put(solid, new CylinderGeometry(.4, .44, 2.5, 14), [.9, .45, 3.45], C.metal, { rot: [0, 0, Math.PI / 2] });
  put(solid, new CylinderGeometry(.02, .3, .45, 12), [2.37, .45, 3.45], C.darkMetal, { rot: [0, 0, -Math.PI / 2] });
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2 + .4;
    put(solid, box(.05, 1.1, .16), [2.25, .45 + Math.cos(a) * .55, 3.45 + Math.sin(a) * .55], C.darkMetal, { rot: [a, .3 * (k - 1), .5 + .25 * k] });
  }
  // Left wing (north, the door side): only a torn stub; the rest lies in the furrow.
  put(solid, box(1.9, .2, 1.2), [.7, .22, -1.3 - .6], C.paint);
  for (let k = 0; k < 5; k++) put(solid, box(.3, .18, .25), [-.1 + k * .38, .22, -2.5 - .12 * Math.abs(wobble(k, 2))], C.paint, { rot: [.2 * wobble(k, 1), .4 * wobble(k, 3), .3 * wobble(k, 5)] });
  // Lying upside down along the furrow's edge, on the flat before the ridge climbs.
  const wing = { x: -8, z: -3.6 };
  put(solid, box(1.7, .18, 4.6), [wing.x, groundLocal(wing.x, wing.z) + .06, wing.z], (_x, y) => (y < .15 ? C.belly : C.paint), { rot: [3.08, .1, .04] });
  // Tail section: the aft cone, fin and stabilisers, broken off and lying on its side.
  const tail = { x: -8.9, z: .7 };
  const tailY = groundLocal(tail.x, tail.z) + 1.05;
  const tailFrame = new Matrix4().compose(new Vector3(tail.x, tailY, tail.z), new Quaternion().setFromEuler(new Euler(.42, .32, .06)), new Vector3(1, 1, 1));
  put(solid, new CylinderGeometry(.34, 1.36, 4.2, 20, 2, true), [-2.1, 0, 0], (_x, y) => (y < -.6 ? C.belly : C.paint), { rot: [0, 0, Math.PI / 2], parent: tailFrame });
  put(solid, new CylinderGeometry(1.38, 1.38, .08, 20, 1, true), [0, 0, 0], C.char, { rot: [0, 0, Math.PI / 2], parent: tailFrame, variation: .25 });
  put(solid, box(1.6, 2.1, .14), [-3.1, 1.25, 0], C.paint, { rot: [0, 0, .42], parent: tailFrame });
  put(solid, box(.9, .5, .15), [-3.6, 2.1, 0], C.stripe, { rot: [0, 0, .42], parent: tailFrame });
  put(solid, box(1.2, .1, 3.6), [-3.6, .15, 0], C.paint, { parent: tailFrame });
  // Soil: the furrow the belly ploughed, berms along the hull and a heap before the nose.
  for (let x = -12; x < WRECK.rearX; x += 1) {
    const g0 = groundLocal(x, -1.3) + .025, g1 = groundLocal(x + 1, -1.3) + .025, g2 = groundLocal(x + 1, 1.3) + .025, g3 = groundLocal(x, 1.3) + .025;
    const e0 = .25 * wobble(x, 1), e1 = .25 * wobble(x + 1, 1);
    quad(solid, [x, g0, -1.3 + e0], [x, g3, 1.3 - e0], [x + 1, g2, 1.3 - e1], [x + 1, g1, -1.3 + e1], (xx) => (Math.sin(xx * 2.3) > .6 ? C.soilDark : C.soil), .12);
  }
  const berm = (x: number, z: number, rx: number, ry: number, rz: number) =>
    put(solid, new SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), [x, groundLocal(x, z) - .05, z], C.soil, { scale: [rx, ry, rz], variation: .15 });
  for (const side of [-1, 1]) {
    for (let x = -10.5; x < 5; x += 2.1) berm(x, side * (x < WRECK.rearX ? 1.75 : 1.45), 1.3, .38 + .12 * Math.abs(wobble(x, side)), .55);
  }
  berm(6.9, .1, 1.5, .62, 1.6);
  berm(7.6, -.9, .9, .4, .9);
  // Debris: hull panels and a seat thrown out along the furrow.
  const bits: Vec3[] = [[-6.8, 0, 1.9], [-5.6, 0, -2.4], [-13.2, 0, .8], [-7.6, 0, -2.9], [3.8, 0, 4.6], [-2.4, 0, 3.8]];
  bits.forEach(([x, , z], k) => put(solid, box(.7 + .3 * (k % 2), .03, .5), [x, groundLocal(x, z) + .06, z], C.paint, { rot: [.3 * wobble(k, 2), k, .25 * wobble(k, 7)] }));
  seat(solid, -6.3, 2.6, .6, 60);
  // Char under the outside fires.
  for (const fire of WRECK_FIRES) {
    if (fire.inside) continue;
    const r = .6 + fire.heat * .7;
    put(solid, new CylinderGeometry(r, r, .02, 12), [fire.x, groundLocal(fire.x, fire.z) + .012, fire.z], C.char, { variation: .3 });
  }
}

// ───────────────────────────────────────────────── lamps, glass, embers, fire, smoke

function lamps(lamp: Batch, glass: Batch): void {
  // Overhead emergency strips along both ceiling edges, then the floor path to the door.
  for (const side of [-1, 1]) put(lamp, box(7.3, .025, .05), [.55, 2.33, side * .92], C.stripLight, { variation: 0, dirty: false });
  for (let x = -3.3; x < WRECK.door.x0 + .2; x += .36) {
    put(lamp, box(.16, .012, .03), [x, DECK + .012, -.55], C.pathLight, { variation: 0, dirty: false });
    if (x < 2.2) put(lamp, box(.16, .012, .03), [x, DECK + .012, .2], C.pathLight, { variation: 0, dirty: false });
  }
  // The last of the path turns into the doorway.
  for (const dz of [-.8, -1.05]) put(lamp, box(.03, .012, .16), [(WRECK.door.x0 + WRECK.door.x1) / 2, DECK + .012, dz], C.pathLight, { variation: 0, dirty: false });
  // EXIT sign hanging from the ceiling before the door, facing the cabin (-X); letters run +Z.
  const sx = WRECK.door.x0 - .1, sy = 2.2, sz = -.45;
  put(glass, box(.035, .15, .42), [sx, sy, sz], C.exitGreen, { variation: 0, dirty: false });
  const E = ['111', '100', '110', '100', '111'], X = ['101', '101', '010', '101', '101'], I = ['1', '1', '1', '1', '1'], T = ['111', '010', '010', '010', '010'];
  let cursor = sz - .15;
  for (const glyph of [E, X, I, T]) {
    glyph.forEach((row, r) => [...row].forEach((bit, c) => {
      if (bit === '1') put(glass, box(.004, .019, .019), [sx - .02, sy + .04 - r * .02, cursor + c * .02], C.exitWhite, { variation: 0, dirty: false });
    }));
    cursor += glyph[0].length * .02 + .025;
  }
  // Interior windows: the grey dawn outside.
  for (const x of WRECK.rows) {
    windowPatch(glass, x + .12, Math.acos((1.45 - cy) / R_IN), R_IN, C.dawnGlass, true);
    if (x < WRECK.door.x0 - .3) windowPatch(glass, x + .12, 2 * Math.PI - Math.acos((1.45 - cy) / R_IN), R_IN, C.dawnGlass, true);
  }
  // Ember beds under every fire.
  for (const fire of WRECK_FIRES) {
    const base = fire.inside ? fire.y : groundLocal(fire.x, fire.z);
    const r = .25 + fire.heat * .35;
    put(glass, new CylinderGeometry(r, r * 1.1, .05, 10), [fire.x, base + .03, fire.z], (x, _y, z) => (Math.sin(x * 9 + z * 7) > .2 ? C.ember : C.emberDeep), { variation: 0, dirty: false });
  }
}

function flames(fire: Batch): void {
  let serial = 0;
  for (const source of WRECK_FIRES) {
    const base = source.inside ? source.y : groundLocal(source.x, source.z);
    const count = 3 + Math.round(source.heat * 5);
    for (let k = 0; k < count; k++) {
      const seed = ++serial;
      const a = seed * 2.399, spread = .12 + .3 * source.heat * Math.abs(wobble(seed, 3));
      const x = source.x + Math.cos(a) * spread, z = source.z + Math.sin(a) * spread;
      const h = (.55 + .6 * Math.abs(wobble(seed, 9))) * (.6 + .7 * source.heat) * (source.id === 'engine' ? 1.5 : 1);
      const w = h * (.42 + .1 * wobble(seed, 5));
      const phase = Math.abs(wobble(seed, 11));
      for (const yaw of [a, a + Math.PI / 2]) {
        const dx = Math.cos(yaw) * w / 2, dz = Math.sin(yaw) * w / 2;
        const corners: [number, number, number, number, number][] = [
          [x - dx, base, z - dz, 0, 0], [x + dx, base, z + dz, 1, 0], [x + dx, base + h, z + dz, 1, 1], [x - dx, base + h, z - dz, 0, 1],
        ];
        for (const index of [0, 1, 2, 0, 2, 3]) {
          const [px, py, pz, u, v] = corners[index];
          fire.data.position.push(px, py, pz);
          fire.data.uv.push(u, v);
          fire.data.flame.push(phase, source.heat, base);
        }
      }
    }
  }
}

function smokeColumns(smoke: Batch): void {
  const column = (x: number, y: number, z: number, width: number, height: number, density: number, seed: number) => {
    for (const yaw of [0, Math.PI / 3, Math.PI * 2 / 3]) {
      const dx = Math.cos(yaw + seed) * width / 2, dz = Math.sin(yaw + seed) * width / 2;
      const lean = height * .18;
      const corners: [number, number, number, number, number][] = [
        [x - dx, y, z - dz, 0, 0], [x + dx, y, z + dz, 1, 0], [x + dx * 1.8 - lean, y + height, z + dz * 1.8, 1, 1], [x - dx * 1.8 - lean, y + height, z - dz * 1.8, 0, 1],
      ];
      for (const index of [0, 1, 2, 0, 2, 3]) {
        const [px, py, pz, u, v] = corners[index];
        smoke.data.position.push(px, py, pz);
        smoke.data.uv.push(u, v);
        smoke.data.smoke.push((seed * .37 + yaw) % 1, density);
      }
    }
  };
  column(-3.9, 2.3, 0, 1.6, 7.5, .9, 1);
  column(.9, .9, 3.45, 1.4, 8.5, 1, 2);
  column(-8.6, groundLocal(-8.6, .4) + .6, .4, 1.3, 6, .8, 3);
  // A low layer under the cabin ceiling, thick at the rear and thinning toward the door.
  const sheet = (x0: number, x1: number, y: number) => {
    const corners: [number, number, number, number, number][] = [
      [x0, y, -.95, 0, 0], [x0, y, .95, 1, 0], [x1, y, .95, 1, 1], [x1, y, -.95, 0, 1],
    ];
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const [px, py, pz, u, v] = corners[index];
      smoke.data.position.push(px, py, pz);
      smoke.data.uv.push(u, .15 + v * .85);
      smoke.data.smoke.push(.5, .8);
    }
  };
  sheet(-3.7, .2, 2.27);
  sheet(-3.7, -1.4, 2.2);
}

// ─────────────────────────────────────────────────────────────────────── the door

function doorPanel(): Group {
  const panel = new Batch({ position: 3, normal: 3, color: 3, glow: 3 });
  const { width, height, thickness } = DOOR.panel;
  // Group frame: origin at the bottom centre, +Y up, the outside face toward -Z.
  // Glow is sampled as if the panel were closed in the door (its light barely changes).
  put(panel, box(width, height, thickness * .5), [0, height / 2, -thickness * .25], (_x, y) => (Math.abs(y - (1.62 - DECK)) < .07 ? C.stripe : C.paint), { variation: .03, dirty: false });
  put(panel, box(width - .04, height - .04, thickness * .5), [0, height / 2, thickness * .25], C.lining, { variation: .03, dirty: false });
  put(panel, new CylinderGeometry(.13, .13, thickness + .01, 14), [0, 1.2, 0], C.cockpitGlass, { rot: [Math.PI / 2, 0, 0], variation: 0, dirty: false });
  put(panel, box(.05, .28, .05), [-.33, .95, thickness / 2 + .03], C.metal, { dirty: false });
  put(panel, box(.26, .06, .04), [-.3, 1.08, thickness / 2 + .025], C.emergency, { dirty: false, variation: 0 });
  // Dents from the crash along the bottom edge.
  put(panel, box(width * .9, .12, thickness * .7), [0, .1, -.01], C.metal, { rot: [.12, 0, .03] });
  const group = new Group();
  group.name = 'wreck-door-panel';
  group.add(panel.mesh('Wreck door panel', hullMaterial));
  const pose: PanelPose = panelAjar(DOOR.ajarDeg, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  group.position.set(pose.x, pose.y, pose.z);
  group.rotation.set(pose.rx, pose.ry, pose.rz);
  return group;
}

// ─────────────────────────────────────────────────────────────────────── the visual

function makePlaneWreck(): Group {
  const solid = new Batch({ position: 3, normal: 3, color: 3, glow: 3 });
  const lamp = new Batch({ position: 3, normal: 3, color: 3 });
  const glass = new Batch({ position: 3, normal: 3, color: 3 });
  const fire = new Batch({ position: 3, uv: 2, flame: 3 });
  const smoke = new Batch({ position: 3, uv: 2, smoke: 2 });
  skin(solid, R_OUT, false);
  skin(solid, R_IN, true);
  cabin(solid);
  exterior(solid, glass);
  lamps(lamp, glass);
  flames(fire);
  smokeColumns(smoke);

  const root = new Group();
  root.name = 'Plane wreck';
  root.add(solid.mesh('Wreck hull and cabin', hullMaterial));
  root.add(doorPanel());
  const lampMesh = lamp.mesh('wreck-lamps', lampMaterial);
  root.add(lampMesh);
  root.add(glass.mesh('Wreck windows and embers', glassMaterial));
  const fireMesh = fire.mesh('wreck-fire', fireMaterial);
  fireMesh.renderOrder = 2;
  root.add(fireMesh);
  const smokeMesh = smoke.mesh('wreck-smoke', smokeMaterial);
  smokeMesh.renderOrder = 3;
  root.add(smokeMesh);
  // Where the emergency axe's grip rests (the scene's 'wreck-axe' item sits here).
  const bracket = new Group();
  bracket.name = 'wreck-axe-bracket';
  bracket.position.set(WRECK.axe.x, WRECK.axe.y, WRECK.axe.z);
  root.add(bracket);
  return root;
}

// ─────────────────────────────────────────────────────────────── locomotion colliders

/** Invisible collider group: walls are plain quads, walkable parts flat or gently sloped. */
class Collider {
  private pos: number[] = [];
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
    // Both windings: the capsule is stopped from either side.
    this.pos.push(...a, ...b, ...c, ...a, ...c, ...d, ...a, ...c, ...b, ...a, ...d, ...c);
  }
  /** A vertical wall from (ax, az) to (bx, bz), wreck-local, from below the ground to above the roof. */
  wall(ax: number, az: number, bx: number, bz: number, y0 = -1, y1 = 3.2): void {
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]);
  }
  /** Four walls round an axis-aligned box. */
  boxWalls(x0: number, z0: number, x1: number, z1: number): void {
    this.wall(x0, z0, x1, z0); this.wall(x1, z0, x1, z1); this.wall(x1, z1, x0, z1); this.wall(x0, z1, x0, z0);
  }
  /** A walkable flat or sloped face (upward winding only). */
  floor(a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
    this.pos.push(...a, ...c, ...b, ...a, ...d, ...c);
  }
  group(name: string): Group {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    // The locomotion engine reads an index buffer: give the triangle soup a trivial one.
    geometry.setIndex(Array.from({ length: this.pos.length / 3 }, (_, i) => i));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new MeshBasicMaterial({ color: 0xffffff });
    material.name = 'Wreck collider (invisible)';
    const mesh = new Mesh(geometry, material);
    mesh.name = `${name} mesh`;
    mesh.visible = false;
    const root = new Group();
    root.name = name;
    root.add(mesh);
    return root;
  }
}

const { x0: CX0, x1: CX1, halfWidth: HW } = WRECK.cabin;
const HULL_W = R_OUT + .05;

function makeDeck(): Group {
  const deck = new Collider();
  deck.floor([CX0, DECK, -HW], [CX1, DECK, -HW], [CX1, DECK, HW], [CX0, DECK, HW]);
  // The sill out to the wall line (so the ramp meets the deck).
  deck.floor([WRECK.door.x0, DECK, DOOR_Z - .08], [WRECK.door.x1, DECK, DOOR_Z - .08], [WRECK.door.x1, DECK, -HW], [WRECK.door.x0, DECK, -HW]);
  return deck.group('Wreck deck (invisible: ItemSurface, LocomotionEnvironment)');
}

/**
 * The locomotion capsule is 1 m across (IWSDK locomotor radius 0.5), wider than the 0.9 m
 * door: the colliders' opening is padded this much each side so the keeper fits through.
 */
const DOOR_COLLIDER_PAD = .12;

function makeWalls(): Group {
  const c = new Collider();
  const d0 = WRECK.door.x0 - DOOR_COLLIDER_PAD, d1 = WRECK.door.x1 + DOOR_COLLIDER_PAD;
  // Cabin: rear debris wall, bulkhead, the far wall, the door-side wall either side of the door.
  c.wall(CX0, -HW, CX0, HW);
  c.wall(CX1, -HW, CX1, HW);
  c.wall(CX0, HW, CX1, HW);
  c.wall(CX0, -HW, d0, -HW);
  c.wall(d1, -HW, CX1, -HW);
  // The doorway is a short corridor through the hull.
  c.wall(d0, -HW, d0, -HULL_W);
  c.wall(d1, -HW, d1, -HULL_W);
  // Hull outline from outside (nose to the torn rear), open only at the door.
  const rear = WRECK.rearX - .3, nose = 6.9;
  c.wall(rear, -HULL_W, rear, HULL_W);
  c.wall(rear, HULL_W, nose, HULL_W);
  c.wall(nose, HULL_W, nose, -HULL_W);
  c.wall(nose, -HULL_W, d1, -HULL_W);
  c.wall(d0, -HULL_W, rear, -HULL_W);
  // Right wing root and engine, the broken outer wing, the left stub, the tail and the torn wing.
  c.boxWalls(-.4, HULL_W, 2.6, 4.3);
  c.boxWalls(-.1, 4.3, 1.7, 8.9);
  c.boxWalls(-.3, -2.7, 1.7, -HULL_W);
  c.boxWalls(-11.4, -.6, -6.6, 2.1);
  c.boxWalls(-9, -6, -7, -1.2);
  // The ramp outside the door: from the sill down to the ground, where the torn panel lands.
  const out = DOOR_Z - 1.75, gOut = Math.min(groundLocal(d0, out), groundLocal(d1, out)) - .02;
  c.floor([d0, gOut, out], [d1, gOut, out], [d1, DECK, DOOR_Z - .08], [d0, DECK, DOOR_Z - .08]);
  return c.group('Wreck walls (invisible, LocomotionEnvironment)');
}

function makeDoorBlocker(): Group {
  const c = new Collider();
  c.wall(WRECK.door.x0 - DOOR_COLLIDER_PAD - .05, DOOR_Z + .12, WRECK.door.x1 + DOOR_COLLIDER_PAD + .05, DOOR_Z + .12, DECK - .2, WRECK.door.top + .1);
  return c.group('Wreck door blocker (invisible, LocomotionEnvironment)');
}

export const planeWreck = makePlaneWreck();
export const wreckDeck = makeDeck();
export const wreckWalls = makeWalls();
export const wreckDoorBlocker = makeDoorBlocker();

/** Material names JourneySystem looks up (by traversal) to animate the fire, smoke and lamps. */
export const WRECK_MATERIALS = {
  hull: hullMaterial.name, lamps: lampMaterial.name, fire: fireMaterial.name, smoke: smokeMaterial.name,
} as const;

type Uniform = { value: number };
/** The wreck's animatable shared state (see wreckUniforms). */
export type WreckUniforms = {
  time?: Uniform; intensity?: Uniform; smokeTime?: Uniform; smoke?: Uniform; glow?: Uniform; lamps?: MeshBasicMaterial;
};

/** For JourneySystem: the shared uniforms (every placed clone shares the prototype's materials). */
export function wreckUniforms(root: Object3D): WreckUniforms {
  const out: WreckUniforms = {};
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material = object.material as Material;
    if (material.name === fireMaterial.name) {
      const shader = material as ShaderMaterial;
      out.time = shader.uniforms.uTime;
      out.intensity = shader.uniforms.uIntensity;
    } else if (material.name === smokeMaterial.name) {
      const shader = material as ShaderMaterial;
      out.smokeTime = shader.uniforms.uTime;
      out.smoke = shader.uniforms.uDensity;
    } else if (material.name === hullMaterial.name) {
      out.glow = material.userData.glow as Uniform;
    } else if (material.name === lampMaterial.name) {
      out.lamps = material as MeshBasicMaterial;
    }
  });
  return out;
}
