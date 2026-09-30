import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DataTexture, LinearFilter, NormalBlending, Points,
  PointsMaterial, RGBAFormat, Vector3,
} from '@iwsdk/core';

/** Soft round sprite so points read as sparks and puffs, not squares. */
function softDot(): DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2 + .5, y - size / 2 + .5) / (size / 2);
      const a = Math.max(0, 1 - d);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a * a);
    }
  }
  return spriteTexture(data, size);
}

/** Four-point glint: a soft hot core with thin horizontal and vertical rays (a catch of light). */
function starGlint(): DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x - size / 2 + .5) / (size / 2), v = (y - size / 2 + .5) / (size / 2);
      const core = Math.max(0, 1 - Math.hypot(u, v) / .42) ** 2;
      const rayX = Math.exp(-(v * v) / .0035) * Math.max(0, 1 - Math.abs(u)) ** 1.6;
      const rayY = Math.exp(-(u * u) / .0035) * Math.max(0, 1 - Math.abs(v)) ** 1.6;
      const a = Math.min(1, core + .85 * (rayX + rayY));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(255 * a);
    }
  }
  return spriteTexture(data, size);
}

function spriteTexture(data: Uint8Array, size: number): DataTexture {
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Per-particle point size: PointsMaterial's `size` becomes a multiplier of the `pSize` attribute (m). */
function sizedPoints(shader: { vertexShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('uniform float size;', 'uniform float size;\nattribute float pSize;')
    .replace('gl_PointSize = size;', 'gl_PointSize = size * pSize;');
}

export type Burst = {
  count: number;
  color: number;
  /** Second colour; each particle picks a random mix of the two. */
  color2?: number;
  speed: number;
  spread: number;
  up: number;
  gravity: number;
  life: number;
  /** Point size in metres (each particle varies it by ±`sizeJitter`). */
  size: number;
  sizeJitter?: number;
  drag?: number;
  /** Swell and shrink over the particle's life (a twinkle) instead of holding its size. */
  twinkle?: boolean;
};

export type Sprite = 'dot' | 'star';

/**
 * Fixed pool of point particles (one draw, skipped while nothing is alive). Allocation-free
 * after construction: bursts overwrite the oldest slots; fades are baked into the RGBA
 * colour stream and sizes into a per-particle size stream.
 */
export class ParticlePool {
  readonly points: Points;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private velocity: Float32Array;
  private base: Float32Array;
  private baseSize: Float32Array;
  private twinkle: Uint8Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private gravity: Float32Array;
  private drag: Float32Array;
  private next = 0;
  private alive = 0;
  private scratch = new Color();
  private scratch2 = new Color();

  constructor(private capacity: number, additive: boolean, sprite: Sprite = 'dot') {
    this.positions = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 4);
    this.sizes = new Float32Array(capacity);
    this.velocity = new Float32Array(capacity * 3);
    this.base = new Float32Array(capacity * 4);
    this.baseSize = new Float32Array(capacity);
    this.twinkle = new Uint8Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) this.positions[i * 3 + 1] = -1000;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new BufferAttribute(this.colors, 4));
    geometry.setAttribute('pSize', new BufferAttribute(this.sizes, 1));
    const material = new PointsMaterial({
      size: 1, map: sprite === 'star' ? starGlint() : softDot(), vertexColors: true, transparent: true, depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending, sizeAttenuation: true,
    });
    material.onBeforeCompile = sizedPoints;
    material.name = sprite === 'star' ? 'FX glints' : additive ? 'FX embers' : 'FX puffs';
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.pointerEvents = 'none';
    this.points.visible = false;
  }

  private jitter(spread: number): number {
    return (Math.random() * 2 - 1) * spread;
  }

  emit(at: Vector3, burst: Burst, direction?: Vector3): void {
    const spread = burst.spread;
    for (let n = 0; n < burst.count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.capacity;
      this.positions[i * 3] = at.x + this.jitter(spread) * .15;
      this.positions[i * 3 + 1] = at.y + Math.random() * .05;
      this.positions[i * 3 + 2] = at.z + this.jitter(spread) * .15;
      const speed = burst.speed * (.5 + Math.random() * .7);
      let vx = this.jitter(spread), vy = burst.up + Math.random() * .5, vz = this.jitter(spread);
      if (direction) { vx += direction.x; vy += direction.y; vz += direction.z; }
      const length = Math.hypot(vx, vy, vz) || 1;
      this.velocity[i * 3] = vx / length * speed;
      this.velocity[i * 3 + 1] = vy / length * speed;
      this.velocity[i * 3 + 2] = vz / length * speed;
      this.scratch.setHex(burst.color);
      if (burst.color2 !== undefined) this.scratch.lerp(this.scratch2.setHex(burst.color2), Math.random());
      this.base[i * 4] = this.scratch.r; this.base[i * 4 + 1] = this.scratch.g; this.base[i * 4 + 2] = this.scratch.b;
      this.base[i * 4 + 3] = 1;
      this.baseSize[i] = burst.size * (1 + this.jitter(burst.sizeJitter ?? 0));
      this.twinkle[i] = burst.twinkle ? 1 : 0;
      this.sizes[i] = burst.twinkle ? 0 : this.baseSize[i];
      this.maxLife[i] = this.life[i] = burst.life * (.6 + Math.random() * .6);
      this.gravity[i] = burst.gravity;
      this.drag[i] = burst.drag ?? 1.2;
    }
    this.alive = this.capacity;
    this.points.visible = true;
  }

  update(delta: number): void {
    if (this.alive === 0) return;
    const dt = Math.min(delta, 1 / 30);
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -1000;
        this.colors[i * 4 + 3] = 0;
        this.sizes[i] = 0;
        continue;
      }
      alive++;
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.velocity[i * 3] *= damp;
      this.velocity[i * 3 + 1] = this.velocity[i * 3 + 1] * damp - this.gravity[i] * dt;
      this.velocity[i * 3 + 2] *= damp;
      this.positions[i * 3] += this.velocity[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocity[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocity[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      if (this.twinkle[i]) {
        // Swell over the first 30% of its life, then shrink and dim away: a catch of light, never a steady dot.
        const age = 1 - t;
        const swell = age < .3 ? age / .3 : 1 - (age - .3) / .7;
        this.sizes[i] = this.baseSize[i] * Math.sin(swell * Math.PI / 2);
        const glow = age < .3 ? 1 : swell;
        this.colors[i * 4] = this.base[i * 4] * glow;
        this.colors[i * 4 + 1] = this.base[i * 4 + 1] * glow;
        this.colors[i * 4 + 2] = this.base[i * 4 + 2] * glow;
        this.colors[i * 4 + 3] = glow;
        continue;
      }
      const fade = t < .6 ? t / .6 : 1;
      this.colors[i * 4] = this.base[i * 4] * fade;
      this.colors[i * 4 + 1] = this.base[i * 4 + 1] * fade;
      this.colors[i * 4 + 2] = this.base[i * 4 + 2] * fade;
      this.colors[i * 4 + 3] = fade;
    }
    this.alive = alive;
    const geometry = this.points.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
    geometry.attributes.pSize.needsUpdate = true;
    // Nothing left alive: the pool stops costing a draw until the next burst.
    if (alive === 0) this.points.visible = false;
  }
}

/**
 * Named bursts tuned for the camp's events. `size` is the drawn point size (m): embers,
 * sparks and glows .035, puffs .045, ash and steam .13, as their pools always drew them.
 */
export const BURSTS = {
  sparks: { count: 18, color: 0xffd27a, color2: 0xff7a1e, speed: 3.2, spread: 1, up: 1.2, gravity: 6, life: .45, size: .035, drag: 1.5 },
  craft: { count: 28, color: 0xffe7a8, color2: 0xffb04a, speed: 1.6, spread: 1, up: .8, gravity: -.4, life: 1.1, size: .035, drag: 2.2 },
  flare: { count: 26, color: 0xffb35a, color2: 0xff5a1a, speed: 2.2, spread: .6, up: 2.5, gravity: -1.2, life: 1.2, size: .035, drag: 1.4 },
  ignite: { count: 44, color: 0xffd28a, color2: 0xff6a1a, speed: 2.6, spread: .8, up: 2, gravity: -1.4, life: 1.4, size: .035, drag: 1.3 },
  embers: { count: 1, color: 0xffa04a, color2: 0xff5a1a, speed: .5, spread: .4, up: 3, gravity: -.6, life: 2.2, size: .035, drag: .6 },
  chips: { count: 12, color: 0xc89a62, color2: 0x7a5236, speed: 2.4, spread: 1, up: .9, gravity: 7, life: .9, size: .045, drag: .8 },
  ash: { count: 36, color: 0x6a6660, color2: 0x2e2c2a, speed: 1.1, spread: 1, up: 1.4, gravity: -.5, life: 1.8, size: .13, drag: 1.1 },
  splash: { count: 10, color: 0x8a4a26, color2: 0xc07a3a, speed: 1.3, spread: 1, up: 1.4, gravity: 5, life: .5, size: .045, drag: .8 },
  steam: { count: 1, color: 0xe8ecef, speed: .25, spread: .35, up: 3, gravity: -.15, life: 2.4, size: .13, drag: .5 },
  /** A forage item waiting at its node, catching the light from afar (glint pool). */
  glint: { count: 1, color: 0xfff6d0, speed: .1, spread: .2, up: 1, gravity: 0, life: .5, size: .045, drag: 1, twinkle: true },
  /** A loose grabbable within reach catching the light: three brief warm glints (glint pool). */
  sparkle: { count: 3, color: 0xffd27a, color2: 0xfff3c4, speed: .12, spread: .25, up: 1, gravity: 0, life: .6, size: .055, sizeJitter: .35, drag: 2, twinkle: true },
  /** The current task's item waiting in the pack: a brighter glint that reads from across camp (glint pool). */
  beckon: { count: 4, color: 0xffd27a, color2: 0xfff3c4, speed: .14, spread: .3, up: 1, gravity: 0, life: .75, size: .08, sizeJitter: .3, drag: 2, twinkle: true },
  /** The axe knocking a trunk without biting: a few bark flecks. */
  knock: { count: 5, color: 0x8a6440, color2: 0x5a3f28, speed: 1.4, spread: 1, up: .6, gravity: 7, life: .6, size: .045, drag: .8 },
  dust: { count: 10, color: 0xb08a5a, color2: 0x8a6a45, speed: .8, spread: 1, up: .5, gravity: 1.5, life: .8, size: .045, drag: 2 },
} as const satisfies Record<string, Burst>;

// ------------------------------------------------------------------------------ beckoning
/**
 * The current task's steps, in order, whose item beckons: one item at a time, the single
 * next step's. The meal's ingredients come from the pack (meat, then the mushroom), then the
 * spoon stirs and the bowl is dipped and drunk; the torch takes the pack's reeds, then resin.
 */
export const BECKON_STEPS: Readonly<Record<string, readonly string[]>> = {
  // The opening journey: the axe on its bracket, the pack on the waystation table (both loose).
  escape: ['axe'], waystation: ['pack'],
  'light-fire': ['log', 'lighter'], 'eat-meal': ['meat', 'mushroom', 'spoon', 'bowl'], torch: ['reeds', 'resin'],
};
/** Tasks whose steps beckon where they lie loose in the world, not in the pack. */
const LOOSE_TASKS: ReadonlySet<string> = new Set(['escape', 'waystation']);

/** What the beckon choice reads each tick (FxSystem fills one and reuses it). */
export type BeckonState = {
  /** Current objective id ('' when every task is done). */
  task: string;
  /** The campfire pot's two ingredients and its finished stew ('' when none). */
  potA: string;
  potB: string;
  stew: string;
  /** Steps already laid in a bench bay: bit i = BECKON_STEPS[task][i]. */
  placed: number;
  mealDone: boolean;
  /** Page 1 (the note in the pack) is unread once the first fire burns. */
  noteWaiting: boolean;
  /** The shade's 'note' line has started (it points at page 1). */
  noteStarted: boolean;
};

/**
 * Rank of an item in the beckon order (lower goes first; -1 never beckons). The caller lets
 * only the lowest-ranked item beckon. Page 1 beckons only once the meal is eaten or the shade's
 * note line has started (it points at the page), and then it comes first.
 */
export function beckonRank(state: BeckonState, kind: string, slot: string, variant: string, page: number): number {
  const packed = slot.startsWith('pack-');
  if (kind === 'page') {
    if (page !== 1 || !state.noteWaiting || !(packed || slot === '')) return -1;
    return state.mealDone || state.noteStarted ? 0 : -1;
  }
  const steps = BECKON_STEPS[state.task];
  const step = steps ? steps.indexOf(kind) : -1;
  if (step < 0) return -1;
  if (LOOSE_TASKS.has(state.task)) return slot === '' ? 1 + step : -1;
  // The lighter rides at the hip from the start: it beckons there as well as in the pack.
  if (state.task === 'light-fire' && kind === 'lighter') return packed || slot.startsWith('hip-') ? 1 + step : -1;
  if (state.task !== 'eat-meal') return packed && (state.placed & (1 << step)) === 0 ? 1 + step : -1;
  const full = state.potA !== '' && state.potB !== '';
  if (kind === 'meat' || kind === 'mushroom') {
    return packed && !full && !state.stew && state.potA !== kind && state.potB !== kind ? 1 + step : -1;
  }
  // The spoon and bowl wait loose by the fire (or in the pack).
  if (slot !== '' && !packed) return -1;
  if (kind === 'spoon') return full && !state.stew ? 1 + step : -1;
  const filled = variant !== '' && variant !== 'empty';
  return filled || state.stew !== '' ? 1 + step : -1;
}
