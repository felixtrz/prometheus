/**
 * Prometheus' shade (guide build): a hooded, robed Titan of smoke and ember light.
 * Origin at the tip of the robe's trailing wisps (it floats), facing +Z, eyes at
 * SHADE.eyeHeight. Stylised mid-poly, cohesive with the camp props and the ash-wolves.
 *
 * - 'shade-body': one mesh for the robe, mantle and pointed hood, the face shadow and
 *   its two ember eyes, a smoke beard, both sleeves and spectral hands, and the ember
 *   cupped in the right palm. One custom ShaderMaterial, premultiplied blend (dark
 *   translucent smoke plus additive fresnel rim and smouldering, noise-driven edges),
 *   no depth write, double-sided in a single pass (forceSinglePass: one draw, not a
 *   back-then-front pair). The smoke noise is a 64x64 tiling texture lookup (uNoise),
 *   not per-fragment value noise. The right arm is posed in the vertex shader (uArm)
 *   around SHADE.shoulder and SHADE.elbow, and the hem flutters (uTime), so gestures
 *   stay a single draw.
 * - 'shade-embers': SHADE.embers soft additive points that the GuideSystem drifts
 *   upward off the robe (positions and RGBA colours rewritten in place).
 *
 * Vertex attribute aInfo = (kind, arm, smoulder, sway): kind 0 cloth, 1 emissive,
 * 2 face shadow; arm 0 body, 1 upper arm, 2 forearm and hand; smoulder 0..1 ember
 * edge; sway 0..1 hem flutter. aTint is the emissive colour (kind 1) or a rim tint.
 *
 * Draws: 2. No lights. Eyes and the palm ember are clamped below white (1, .62, .25). Deterministic and side-effect free: the runtime and the editor
 * both evaluate it.
 */
import {
  AddEquation, AdditiveBlending, BufferAttribute, BufferGeometry, Color, CustomBlending, DataTexture, DoubleSide,
  Float32BufferAttribute, Group, LinearFilter, Mesh, OneFactor, OneMinusSrcAlphaFactor, Points, PointsMaterial,
  RepeatWrapping, RGBAFormat, ShaderMaterial, Sphere, Uint16BufferAttribute, Vector3,
} from '@iwsdk/core';

type V3 = readonly [number, number, number];
/** kind, arm, smoulder, sway */
type Info = readonly [number, number, number, number];
/** One lathe ring: height, x radius, z radius, z centre. */
type Row = readonly [number, number, number, number];

export const SHADE = {
  /** Eye height above the origin (the wisp tips). */
  eyeHeight: 1.475,
  /** Mouth, for the positional voice. */
  mouth: [0, 1.4, 0.12] as V3,
  /** Right-arm pivots used by the vertex shader (rest pose). */
  shoulder: [0.285, 1.245, 0] as V3,
  elbow: [0.315, 0.99, 0.025] as V3,
  /** The ember in the right palm (rest pose). */
  palm: [0.298, 0.7, 0.128] as V3,
  embers: 28,
  /** The GuideSystem shows the prototype at this scale: a Titan of the keeper's height, not a looming one. */
  scale: 1,
} as const;

const WHITE: V3 = [1, 1, 1];
const TAU = Math.PI * 2;
/** Smoke-noise lattice cells per texture repeat (the shader samples at 1 / NOISE_CELLS per unit). */
const NOISE_CELLS = 8;
/** Deterministic 0..1 noise for tatter lengths and ember seeds. */
const rand = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

class ShapeBuilder {
  readonly positions: number[] = [];
  readonly infos: number[] = [];
  readonly tints: number[] = [];
  readonly indices: number[] = [];
  private count = 0;

  vertex(x: number, y: number, z: number, info: Info, tint: V3): number {
    this.positions.push(x, y, z);
    this.infos.push(info[0], info[1], info[2], info[3]);
    this.tints.push(tint[0], tint[1], tint[2]);
    return this.count++;
  }

  setSmoulder(index: number, value: number): void {
    const at = index * 4 + 2;
    this.infos[at] = Math.max(this.infos[at], value);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, a, c, d);
  }

  tri(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('aInfo', new Float32BufferAttribute(this.infos, 4));
    geometry.setAttribute('aTint', new Float32BufferAttribute(this.tints, 3));
    geometry.setIndex(new Uint16BufferAttribute(this.indices, 1));
    geometry.computeVertexNormals();
    // Generous bounds: the raised arm and the flutter reach beyond the rest pose.
    geometry.boundingSphere = new Sphere(new Vector3(0, 0.95, 0.05), 1.15);
    return geometry;
  }
}

/**
 * Closed lathe (x = rx·sin θ, z = zc + rz·cos θ; θ = 0 faces +Z). Returns the vertex
 * grid [row][col]; `cut(row, col)` drops the quad below row `row` at column `col`.
 */
function lathe(
  b: ShapeBuilder, rows: readonly Row[], cols: number, info: (row: number, col: number) => Info, tint: V3,
  offset: (row: number, col: number, out: number[]) => void = () => undefined, cut: (row: number, col: number) => boolean = () => false,
): number[][] {
  const grid: number[][] = [];
  const d = [0, 0, 0];
  for (let r = 0; r < rows.length; r++) {
    const [y, rx, rz, zc] = rows[r];
    const ring: number[] = [];
    for (let c = 0; c < cols; c++) {
      const a = (c / cols) * TAU;
      d[0] = d[1] = d[2] = 0;
      offset(r, c, d);
      ring.push(b.vertex(Math.sin(a) * rx + d[0], y + d[1], zc + Math.cos(a) * rz + d[2], info(r, c), tint));
    }
    grid.push(ring);
  }
  for (let r = 0; r + 1 < rows.length; r++) {
    for (let c = 0; c < cols; c++) {
      if (cut(r, c)) continue;
      const n = (c + 1) % cols;
      b.quad(grid[r][c], grid[r + 1][c], grid[r + 1][n], grid[r][n]);
    }
  }
  return grid;
}

/** UV ellipsoid, optionally rotated about Z; `front` builds only the +Z half. */
function ellipsoid(b: ShapeBuilder, center: V3, radii: V3, info: Info, tint: V3, rings = 6, segs = 10, rotZ = 0, front = false): void {
  const cz = Math.cos(rotZ), sz = Math.sin(rotZ);
  const grid: number[][] = [];
  const columns = front ? segs + 1 : segs;
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI;
    const row: number[] = [];
    for (let j = 0; j < columns; j++) {
      const theta = front ? -Math.PI / 2 + (j / segs) * Math.PI : (j / segs) * TAU;
      const x = Math.sin(phi) * Math.sin(theta) * radii[0];
      const y = Math.cos(phi) * radii[1];
      const z = Math.sin(phi) * Math.cos(theta) * radii[2];
      row.push(b.vertex(center[0] + x * cz - y * sz, center[1] + x * sz + y * cz, center[2] + z, info, tint));
    }
    grid.push(row);
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const n = front ? j + 1 : (j + 1) % segs;
      b.quad(grid[i][j], grid[i + 1][j], grid[i + 1][n], grid[i][n]);
    }
  }
}

/** Open tube through `points` with horizontal elliptical rings (for near-vertical sleeves and the beard). */
function tube(b: ShapeBuilder, points: readonly V3[], radii: readonly (readonly [number, number])[], segs: number, info: (ring: number) => Info, tint: V3): void {
  const grid: number[][] = [];
  for (let r = 0; r < points.length; r++) {
    const [px, py, pz] = points[r];
    const [rx, rz] = radii[r];
    const ring: number[] = [];
    for (let c = 0; c < segs; c++) {
      const a = (c / segs) * TAU;
      ring.push(b.vertex(px + Math.sin(a) * rx, py, pz + Math.cos(a) * rz, info(r), tint));
    }
    grid.push(ring);
  }
  for (let r = 0; r + 1 < points.length; r++) {
    for (let c = 0; c < segs; c++) {
      const n = (c + 1) % segs;
      b.quad(grid[r][c], grid[r + 1][c], grid[r + 1][n], grid[r][n]);
    }
  }
}

function shadeGeometry(): BufferGeometry {
  const b = new ShapeBuilder();

  // Robe: broad Titan shoulders, a slight hunch, flaring to a tattered, trailing hem.
  const ROBE: Row[] = [
    [1.37, 0.1, 0.09, 0.01],
    [1.315, 0.24, 0.15, 0.005],
    [1.245, 0.3, 0.175, 0],
    [1.12, 0.285, 0.195, 0.02],
    [0.96, 0.255, 0.185, 0.012],
    [0.8, 0.232, 0.175, 0],
    [0.63, 0.25, 0.19, -0.018],
    [0.47, 0.27, 0.21, -0.035],
    [0.33, 0.29, 0.225, -0.055],
    [0.21, 0.305, 0.235, -0.075],
    [0.13, 0.3, 0.232, -0.085],
  ];
  const cols = 20;
  const robeRows = ROBE.length;
  // Tatters: one extra ring whose even columns hang in points and odd ones notch just below the hem.
  const tatter = (c: number) => (c % 2 === 0 ? 0.075 + 0.07 * rand(c) : 0.03 + 0.03 * rand(c + 40));
  const rows = [...ROBE, [0.13, 0.285, 0.22, -0.09] as Row];
  lathe(b, rows, cols, (r, c) => {
    const y = rows[r][0];
    const sway = Math.min(1, Math.pow(Math.max(0, (1.25 - y) / 1.15), 1.4));
    const smoulder = r === robeRows ? (c % 2 === 0 ? 1 : 0.8) : r === robeRows - 1 ? 0.45 : 0;
    return [0, 0, smoulder, r === robeRows ? 1.2 : sway];
  }, WHITE, (r, c, out) => {
    if (r !== robeRows) return;
    out[1] = -tatter(c);
  });

  // Hood and mantle: a pointed cowl drooping back, an open face, a V at the throat,
  // and a short mantle over the shoulders.
  const HOOD: Row[] = [
    [1.72, 0.012, 0.012, -0.125],
    [1.695, 0.07, 0.08, -0.08],
    [1.645, 0.128, 0.14, -0.04],
    [1.575, 0.158, 0.172, -0.012],
    [1.49, 0.17, 0.188, 0],
    [1.41, 0.176, 0.19, 0.006],
    [1.335, 0.215, 0.192, 0],
    [1.26, 0.295, 0.205, -0.005],
    [1.18, 0.322, 0.218, -0.012],
  ];
  const step = 360 / cols;
  const cutAngle = [0, 0, 0, 44, 46, 28, 0, 0];
  const isCut = (r: number, c: number) => {
    const limit = cutAngle[r] ?? 0;
    if (!limit) return false;
    let centre = (c + 0.5) * step;
    if (centre > 180) centre -= 360;
    return Math.abs(centre) < limit;
  };
  const hood = lathe(b, HOOD, cols, (r) => [0, 0, r === HOOD.length - 1 ? 0.55 : 0, r >= HOOD.length - 2 ? 0.12 : 0], WHITE, undefined, isCut);
  // Smouldering hood rim: every vertex on the edge of the face opening.
  for (let r = 0; r + 1 < HOOD.length; r++) {
    for (let c = 0; c < cols; c++) {
      if (!isCut(r, c)) continue;
      const n = (c + 1) % cols;
      for (const v of [hood[r][c], hood[r][n], hood[r + 1][c], hood[r + 1][n]]) b.setSmoulder(v, 0.9);
    }
  }

  // Face: a deep shadow in the hood and two ember eyes, outer corners dipping (kind, not fierce).
  ellipsoid(b, [0, 1.46, 0.0], [0.142, 0.155, 0.125], [2, 0, 0, 0], WHITE, 7, 12, 0, true);
  const eye: V3 = [1, 0.84, 0.5];
  ellipsoid(b, [0.046, 1.476, 0.124], [0.025, 0.0095, 0.006], [1, 0, 0, 0], eye, 3, 8, -0.2);
  ellipsoid(b, [-0.046, 1.476, 0.124], [0.025, 0.0095, 0.006], [1, 0, 0, 0], eye, 3, 8, 0.2);

  // Beard of smoke from the jaw onto the chest.
  tube(b,
    [[0, 1.37, 0.115], [0, 1.3, 0.14], [0.004, 1.21, 0.158], [-0.004, 1.13, 0.168], [0.006, 1.05, 0.172]],
    [[0.07, 0.03], [0.075, 0.035], [0.055, 0.03], [0.032, 0.022], [0.006, 0.006]], 8,
    (ring) => [0, 0, ring >= 3 ? 0.45 : 0, 0.2 + ring * 0.08], [0.95, 0.9, 0.85]);

  // Sleeves: the left hangs at rest; the right (arm 1 above the elbow, 2 below) gestures.
  for (const side of [1, -1] as const) {
    const arm = side > 0;
    const x = (v: number) => v * side;
    tube(b,
      [[x(0.27), 1.29, 0], [x(0.3), 1.14, 0.005], [x(0.315), 0.99, 0.025]],
      [[0.07, 0.07], [0.078, 0.075], [0.08, 0.078]], 9,
      () => [0, arm ? 1 : 0, 0, 0.05], WHITE);
    tube(b,
      [[x(0.315), 0.99, 0.025], [x(0.322), 0.88, 0.05], [x(0.328), 0.765, 0.075], [x(0.33), 0.735, 0.08]],
      [[0.08, 0.078], [0.092, 0.088], [0.118, 0.108], [0.124, 0.113]], 9,
      (ring) => [0, arm ? 2 : 0, ring >= 2 ? 0.8 : 0, 0.15], WHITE);
    // Spectral hand, brighter than the robe, fingers loosely together.
    ellipsoid(b, [x(0.312), 0.69, 0.095], [0.036, 0.062, 0.026], [0, arm ? 2 : 0, 0.15, 0.1], [1.05, 0.95, 0.85], 5, 8, x(0.1));
  }
  // The flame he gave: an ember cupped in the right palm.
  ellipsoid(b, SHADE.palm, [0.03, 0.036, 0.03], [1, 2, 0, 0], [1, 0.62, 0.22], 5, 8);

  return b.build();
}

const vertexShader = /* glsl */ `
attribute vec4 aInfo;
attribute vec3 aTint;
uniform float uTime;
uniform float uArm;
uniform float uSway;
uniform vec3 uShoulder;
uniform vec3 uElbow;
varying vec3 vLocal;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec4 vInfo;
varying vec3 vTint;

vec3 rotX(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z);
}

void main() {
  vec3 p = position;
  vec3 n = normal;
  float arm = aInfo.y;
  // Forearm bends at the elbow first (rest space), then the whole arm swings from the shoulder.
  if (arm > 1.5) { float a = -1.45 * uArm; p = uElbow + rotX(p - uElbow, a); n = rotX(n, a); }
  if (arm > 0.5) {
    float a = -0.62 * uArm;
    p = uShoulder + rotX(p - uShoulder, a);
    n = rotX(n, a);
    p.x += 0.05 * uArm * clamp((uShoulder.y - position.y) * 2.0, 0.0, 1.0);
  }
  float w = aInfo.w * uSway;
  p.x += w * 0.035 * sin(uTime * 1.7 + position.y * 6.0 + position.z * 3.0);
  p.z += w * (0.03 * sin(uTime * 1.3 + position.y * 5.0 + position.x * 4.0) - 0.025);
  vLocal = position;
  vInfo = aInfo;
  vTint = aTint;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vViewPos = mv.xyz;
  vNormalView = normalize(normalMatrix * n);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uFade;
uniform float uTalk;
uniform float uGlow;
uniform float uDensity;
uniform vec3 uRim;
uniform vec3 uSmoke;
uniform vec3 uEmber;
uniform vec3 uCore;
uniform sampler2D uNoise;
varying vec3 vLocal;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec4 vInfo;
varying vec3 vTint;

// Smooth value noise from the tiling texture (NOISE_CELLS lattice cells per repeat):
// one lookup, with z sheared into the plane so the drift still reads as volume.
float noiseT(vec3 p) {
  return texture2D(uNoise, (p.xy + p.z * vec2(0.37, 0.61)) * ${(1 / NOISE_CELLS).toFixed(4)}).r;
}

void main() {
  float kind = vInfo.x;
  // Colours are display values: additive light is summed after this shader, so it is
  // not encoded per fragment (a small linear rim would jump to ~0.1 per layer).
  vec3 color;
  float alpha;
  float front = gl_FrontFacing ? 1.0 : 0.0;
  if (kind > 1.5) {
    // The shadow inside the hood, warmed by the eyes' glow across the brow and cheeks.
    float band = exp(-pow((vLocal.y - 1.47) * 14.0, 2.0)) * (1.0 - smoothstep(0.03, 0.12, abs(vLocal.x)) * 0.6);
    color = uEmber * (0.02 + band * (0.16 + 0.14 * uTalk) * uGlow);
    // Feathered toward its rim so the shadow melts into the hood instead of reading as a mask.
    float facingVoid = abs(dot(normalize(vNormalView), normalize(-vViewPos)));
    alpha = 0.88 * smoothstep(0.0, 0.3, facingVoid);
    color *= alpha;
  } else if (kind > 0.5) {
    // Eyes and the palm ember: hot, flickering, brighter while he speaks.
    float flick = 0.86 + 0.14 * sin(uTime * 11.0 + vLocal.x * 40.0) * sin(uTime * 7.3 + vLocal.y * 30.0);
    // Clamped below white: with toneMapped off, a hot yellow would clip to a white stare.
    color = min(vTint * uGlow * (0.85 + 0.55 * uTalk) * flick, vec3(1.0, 0.62, 0.25));
    alpha = 0.0;
  } else {
    vec3 nrm = normalize(vNormalView);
    vec3 view = normalize(-vViewPos);
    float facing = min(abs(dot(nrm, view)), 1.0);
    float fres = pow(1.0 - facing, 2.5);
    // The inner (far) wall seen through the smoke adds less.
    float layer = mix(0.4, 1.0, front);
    float n1 = noiseT(vLocal * 6.0 + vec3(0.0, -uTime * 0.5, uTime * 0.13));
    // Dense in the chest, thinning to wisps below the knees.
    float body = smoothstep(0.2, 0.9, vLocal.y);
    alpha = (0.26 + 0.3 * n1) * body * (0.55 + 0.45 * facing) * mix(0.6, 1.0, front) * uDensity;
    vec3 rim = uRim * vTint * fres * (0.65 + 0.5 * n1) * (0.9 + 0.6 * uTalk) * uGlow * layer;
    // A banked fire in the chest, seen through the smoke.
    vec3 d = vLocal - vec3(0.0, 1.0, 0.1);
    float heart = exp(-dot(d, d) * 24.0);
    vec3 core = uCore * heart * (0.1 + 0.3 * uTalk) * facing * uGlow * layer;
    // Smouldering edges: ember-bright cracks crawling up the hem, cuffs and hood rim.
    float n2 = noiseT(vLocal * 15.0 + vec3(uTime * 0.2, -uTime * 1.1, 0.0));
    float edge = vInfo.z * smoothstep(0.52, 0.86, n2 + 0.28 * vInfo.z);
    // Softer where the robe has thinned to wisps, so the hem smoulders rather than burns.
    vec3 ember = uEmber * edge * (0.9 + 0.8 * uTalk) * uGlow * layer * (0.55 + 0.45 * body);
    color = (rim + core) * (0.35 + 0.65 * body) + ember + uSmoke * alpha;
    // Inside the hood (its far wall, seen through the face opening) is deep shadow.
    float hood = (1.0 - front) * smoothstep(1.33, 1.39, vLocal.y) * (1.0 - smoothstep(1.55, 1.61, vLocal.y))
      * (1.0 - smoothstep(0.1, 0.17, abs(vLocal.x)));
    alpha = mix(alpha, 0.8, hood);
    color = mix(color, uEmber * 0.03 * alpha, hood);
  }
  gl_FragColor = vec4(color * uFade, alpha * uFade);
}
`;

/** The shade's material. The GuideSystem clones it and drives its uniforms. */
function shadeMaterial(): ShaderMaterial {
  const material = new ShaderMaterial({
    name: 'Shade smoke and ember',
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 1 },
      uTalk: { value: 0.25 },
      uGlow: { value: 1 },
      uDensity: { value: 1 },
      uArm: { value: 0 },
      uSway: { value: 1 },
      uShoulder: { value: new Vector3(...SHADE.shoulder) },
      uElbow: { value: new Vector3(...SHADE.elbow) },
      // Display-space colours (see the fragment shader).
      uRim: { value: new Color(1, 0.66, 0.32) },
      uSmoke: { value: new Color(0.17, 0.12, 0.1) },
      uEmber: { value: new Color(1, 0.45, 0.12) },
      uCore: { value: new Color(1, 0.55, 0.2) },
      uNoise: { value: noiseTexture() },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });
  // Both faces in one draw: the shader already weights the far wall by gl_FrontFacing.
  material.forceSinglePass = true;
  return material;
}

/**
 * 64x64 tiling value noise (two octaves, smoothstep-interpolated, wrapped lattice):
 * the smoke's noise, sampled instead of computing 8 hashes per fragment.
 */
function noiseTexture(): DataTexture {
  const size = 64;
  const lattice = (octave: number, cells: number, x: number, y: number) =>
    rand(octave * 4099 + (((y % cells) + cells) % cells) * 131 + (((x % cells) + cells) % cells));
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const sample = (octave: number, cells: number, u: number, v: number) => {
    const fx = u * cells, fy = v * cells, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = smooth(fx - ix), ty = smooth(fy - iy);
    const a = lattice(octave, cells, ix, iy), b = lattice(octave, cells, ix + 1, iy);
    const c = lattice(octave, cells, ix, iy + 1), d = lattice(octave, cells, ix + 1, iy + 1);
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
  };
  const values = new Float32Array(size * size);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = sample(1, NOISE_CELLS, x / size, y / size) * 2 + sample(2, NOISE_CELLS * 2, x / size, y / size);
      values[y * size + x] = n;
      min = Math.min(min, n);
      max = Math.max(max, n);
    }
  }
  // Stretched to the full 0..1 range, like the per-fragment value noise it replaces.
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < values.length; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.round((255 * (values[i] - min)) / (max - min || 1));
    data[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.name = 'Shade smoke noise';
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Soft round sprite for the drifting embers. */
function emberDot(): DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(1, Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * Math.pow(1 - d, 1.8));
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function emberPoints(): Points {
  const n = SHADE.embers;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    // Rest layout (editor preview): a loose column of sparks around the robe.
    const a = rand(i + 7) * TAU, h = 0.2 + rand(i + 91) * 1.35;
    positions[i * 3] = Math.sin(a) * 0.3;
    positions[i * 3 + 1] = h;
    positions[i * 3 + 2] = Math.cos(a) * 0.24;
    colors[i * 4] = 1;
    colors[i * 4 + 1] = 0.45 + 0.3 * rand(i + 3);
    colors[i * 4 + 2] = 0.12;
    colors[i * 4 + 3] = 0.3 + 0.6 * rand(i + 17);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 4));
  geometry.boundingSphere = new Sphere(new Vector3(0, 1.1, 0), 1.4);
  const material = new PointsMaterial({
    name: 'Shade embers', size: 0.026, map: emberDot(), vertexColors: true, transparent: true, depthWrite: false,
    blending: AdditiveBlending, sizeAttenuation: true, toneMapped: false, fog: false,
  });
  const points = new Points(geometry, material);
  points.name = 'shade-embers';
  return points;
}

function makeShade(): Group {
  const root = new Group();
  root.name = 'prometheus-shade';
  const body = new Mesh(shadeGeometry(), shadeMaterial());
  body.name = 'shade-body';
  body.castShadow = false;
  body.receiveShadow = false;
  root.add(body, emberPoints());
  return root;
}

export const prometheusShade = makeShade();
