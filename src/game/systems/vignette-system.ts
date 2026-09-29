import {
  Color, createSystem, Entity, Mesh, PlaneGeometry, ShaderMaterial, Types, Vector2, Vector3,
} from '@iwsdk/core';
import { HEARTBEAT } from '../audio-map.js';
import { bus } from '../bus.js';
import { GameState } from '../components.js';
import { nightness } from '../rules.js';
import { onSettings, settings } from '../settings.js';
import { heartbeatPhase } from './audio-system.js';

/** Plane distance in front of the eye (m); well past the 0.03 m near plane. */
const DISTANCE = 0.25;
/** Half extent of the plane in view-tangent units (3 -> +-71 deg, wider than any headset FOV). */
const PLANE_TAN = 3;
/** Per-eye half-FOV tangents used in XR, where the browser projection does not apply. */
const XR_TAN_X = 1.1;
const XR_TAN_Y = 1.0;

/** Health below this pulses red at the edges, one swell per heartbeat (the audio heartbeat's threshold). */
export const LOW_HEALTH = HEARTBEAT.on;
/** Hunger below this breathes a dim amber at the edges (stronger as it falls). */
export const LOW_HUNGER = 25;

/** Hurt red by day, and the darker blood red it becomes at night (never brighter than the dark view centre). */
const HURT_DAY = new Color('#9a1018');
const HURT_NIGHT = new Color('#5a0a0e');
const AMBER = new Color('#6a3a08');
/** Starving: a steady dark rim instead of a flash every tick. */
const STARVE = new Color('#1c0a06');
const BLACK = new Color('#000000');
const GOLD = new Color('#ffe2a6');
/** No second full flash within this long of the last one (s). */
const FLASH_GAP = 0.6;
/** The flash's inner edge never reaches further in than this (1 = screen edge). */
const FLASH_INNER_MIN = 0.75;
/** Starving rim opacity. */
const STARVE_RIM = 0.25;
/**
 * Reduce flashes (comfort setting): a hurt never flashes; it deepens a dim, dark rim that
 * rises over ~0.35 s and ebbs over ~1.5 s, and the low-health heartbeat breathes gently at
 * the edge instead of swelling. The ending's gold flash is a slow, faint glow.
 */
const REDUCED = {
  /** Rim opacity at a full-strength hit (a 20-point bite), and how far in it reaches (1 = edge). */
  rimPeak: 0.38, rimInner: 0.86, rise: 0.35, ebb: 1.5,
  /** Heartbeat depth relative to the standard pulse. */
  pulse: 0.45,
  ending: 0.35,
};
const RIM_DAY = new Color('#4a0e12');
const RIM_NIGHT = new Color('#2a080a');

const vertexShader = /* glsl */ `
varying vec2 vView;
void main() {
  vView = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/**
 * Three layers, one draw: a dim edge (amber hunger, darkening to a starving rim), a red
 * edge over it (hurt flash, biased toward the attacker's side; the low-health heartbeat),
 * and a full-screen fill on top (fade through black, ending flash). Composited "over".
 */
const fragmentShader = /* glsl */ `
uniform vec3 uRed;
uniform float uFlashA;
uniform float uFlashInner;
uniform vec2 uFlashDir;
uniform float uFlashDirAmt;
uniform float uPulseA;
uniform float uPulseInner;
uniform vec3 uAmber;
uniform float uAmberA;
uniform vec3 uFillColor;
uniform float uFill;
uniform vec2 uHalf;
varying vec2 vView;
void main() {
  // 0 at the view centre, 1 at the screen-edge midpoints.
  vec2 v = vView / uHalf;
  float r = length(v);
  // Directional hurt: full on the attacker's side, a faint rim opposite.
  float side = dot(v / max(r, 1e-3), uFlashDir);
  float toward = mix(1.0, 0.15 + 0.85 * smoothstep(-0.5, 0.75, side), uFlashDirAmt);
  float flash = smoothstep(uFlashInner, 1.22, r) * uFlashA * toward;
  float pulse = smoothstep(uPulseInner, 1.22, r) * uPulseA;
  float red = max(flash, pulse);
  float amber = smoothstep(0.62, 1.3, r) * uAmberA;
  float edgeA = red + amber * (1.0 - red);
  vec3 edgeC = (uRed * red + uAmber * amber * (1.0 - red)) / max(edgeA, 1e-4);
  float a = uFill + edgeA * (1.0 - uFill);
  vec3 c = (uFillColor * uFill + edgeC * edgeA * (1.0 - uFill)) / max(a, 1e-4);
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

type Stage = { to: number; seconds: number };

/**
 * Camera-attached overlay: one plane, one shader material, uniforms only.
 * - Red edge: a flash on `hurt` (strength and reach scaled by the damage, inner edge
 *   never past r 0.75, at most one full flash per 0.6 s), leaning toward the side the
 *   harm came from when `hurt` carries x/z. It darkens to blood red at night so the
 *   periphery never outshines the view centre. While the low-health heartbeat plays
 *   (below 30 health): one soft swell per beat, read from the audio heartbeat's clock.
 * - Dim edge: amber breathing while hunger is below 25; starving is a steady dark rim
 *   (starving ticks never flash).
 * - Fill: `sleep` fades out 0.8 s, holds 1.2 s, fades in 1.5 s; `death` fades to black
 *   over 1.5 s and holds until `respawn`, then fades in 1.5 s; `ending-step` 'spire-eye'
 *   flashes warm white-gold (0.3 s up, 2 s down); StartSystem fades through black
 *   around a journey reset (`fadeOut` / `fadeIn`).
 * - Reduce flashes (settings): no hurt flash, only a dim rim that eases in and out; a
 *   gentler heartbeat; a slow, faint ending glow instead of the gold flash.
 * Never raycast, no pointer events, draws last without depth. The shader is compiled
 * up front (a few frames at zero opacity) so the first hit never hitches.
 */
export class VignetteSystem extends createSystem({
  game: { required: [GameState] },
}, {
  /** Peak opacity of the hurt flash (a 20-point bite reaches it). */
  flashStrength: { type: Types.Float32, default: 0.55 },
  /** Peak opacity of the low-health heartbeat. */
  pulseStrength: { type: Types.Float32, default: 0.5 },
  /** Peak opacity of the hunger edge (just before starving). */
  hungerStrength: { type: Types.Float32, default: 0.4 },
  /** Peak opacity of the ending flash. */
  endingFlash: { type: Types.Float32, default: 0.8 },
}) {
  private mesh!: Mesh;
  private material!: ShaderMaterial;
  private entity?: Entity;
  private game?: Entity;
  private fillColor!: Color;
  private half!: Vector2;
  private red!: Color;
  private amberColor!: Color;
  private flashA!: { value: number };
  private flashInner!: { value: number };
  private flashDir!: Vector2;
  private flashDirAmt!: { value: number };
  private pulseA!: { value: number };
  private pulseInner!: { value: number };
  private amberA!: { value: number };
  private fillUniform!: { value: number };
  private attacker = new Vector3();
  /** Hurt flash envelope 1 -> 0, and its peak (0.45..1, from the damage). */
  private flash = 0;
  private flashPeak = 0;
  private lastFlashAt = -Infinity;
  /** Direction bias of the current flash (fades with it). */
  private directional = 0;
  private beat = 0;
  private hunger = 0;
  private starve = 0;
  private time = 0;
  /** Frames left to draw at zero opacity so the program compiles before it is needed. */
  private warmFrames = 3;
  /** Reduce flashes: the dim rim's depth (eased) and where it is heading (0..1). */
  private reduced = settings.reduceFlashes;
  private rim = 0;
  private rimTarget = 0;

  private fill = 0;
  private stages: Stage[] = [];
  private stageIndex = 0;
  private stageFrom = 0;
  private stageTime = 0;
  /** Seconds spent fully black with nothing scheduled (safety release). */
  private blackTime = 0;

  init(): void {
    this.fillColor = new Color().copy(BLACK);
    this.half = new Vector2(1, 1);
    this.red = new Color().copy(HURT_DAY);
    this.amberColor = new Color().copy(AMBER);
    this.flashA = { value: 0 };
    this.flashInner = { value: 0.95 };
    this.flashDir = new Vector2(1, 0);
    this.flashDirAmt = { value: 0 };
    this.pulseA = { value: 0 };
    this.pulseInner = { value: 0.95 };
    this.amberA = { value: 0 };
    this.fillUniform = { value: 0 };
    this.material = new ShaderMaterial({
      name: 'prometheus-vignette',
      uniforms: {
        uRed: { value: this.red },
        uFlashA: this.flashA,
        uFlashInner: this.flashInner,
        uFlashDir: { value: this.flashDir },
        uFlashDirAmt: this.flashDirAmt,
        uPulseA: this.pulseA,
        uPulseInner: this.pulseInner,
        uAmber: { value: this.amberColor },
        uAmberA: this.amberA,
        uFillColor: { value: this.fillColor },
        uFill: this.fillUniform,
        uHalf: { value: this.half },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const size = 2 * PLANE_TAN * DISTANCE;
    this.mesh = new Mesh(new PlaneGeometry(size, size), this.material);
    this.mesh.name = 'prometheus-vignette';
    this.mesh.position.set(0, 0, -DISTANCE);
    this.mesh.renderOrder = 10_000;
    this.mesh.frustumCulled = false;
    // Drawn (fully transparent) for the first frames so the program is compiled up front.
    this.mesh.visible = true;
    this.mesh.raycast = () => {};
    this.mesh.pointerEvents = 'none';
    this.entity = this.world.createTransformEntity(this.mesh, { parent: this.world.cameraEntity, persistent: true });

    this.cleanupFuncs.push(
      this.queries.game.subscribe('qualify', (entity) => { this.game = entity; }, true),
      this.queries.game.subscribe('disqualify', (entity) => {
        if (this.game !== entity) return;
        this.game = undefined;
        for (const other of this.queries.game.entities) if (other !== entity) this.game = other;
      }),
      // Entering the headset: warm again (a new session is the moment a hitch would show).
      this.world.visibilityState.subscribe((state) => { if (state === 'visible') this.warmFrames = Math.max(this.warmFrames, 2); }),
      onSettings((next) => {
        if (next.reduceFlashes === this.reduced) return;
        this.reduced = next.reduceFlashes;
        // Switching mid-hit never leaves a flash (or a stale rim) running.
        this.flash = 0;
        this.rim = this.rimTarget = 0;
      }),
      bus.on('hurt', (event) => {
        // Starving ticks never flash: the starving rim already says it, steadily.
        if (event.cause === 'starving') return;
        this.hurtFlash(event.amount, event.x, event.z);
      }),
      bus.on('sleep', () => this.fadeSequence(BLACK, [{ to: 1, seconds: 0.8 }, { to: 1, seconds: 1.2 }, { to: 0, seconds: 1.5 }])),
      bus.on('death', () => {
        this.hurtFlash(40);
        this.fadeSequence(BLACK, [{ to: 1, seconds: 1.5 }]);
      }),
      bus.on('respawn', () => {
        this.flash = 0;
        this.rim = this.rimTarget = 0;
        this.beat = 0;
        this.fadeSequence(BLACK, [{ to: 0, seconds: 1.5 }]);
      }),
      bus.on('ending-step', (event) => {
        if (event.step !== 'spire-eye') return;
        const peak = this.config.endingFlash.peek();
        if (this.reduced) this.fadeSequence(GOLD, [{ to: peak * REDUCED.ending, seconds: 1.2 }, { to: 0, seconds: 2.5 }]);
        else this.fadeSequence(GOLD, [{ to: peak, seconds: 0.3 }, { to: 0, seconds: 2 }]);
      }),
      // The journey reset fades through black itself (StartSystem.fadeOut/fadeIn).
      bus.on('new-game', () => {
        this.flash = 0;
        this.rim = this.rimTarget = 0;
        this.beat = 0;
        this.hunger = 0;
        this.starve = 0;
      }),
      () => {
        this.entity?.dispose({ disposeResources: false });
        this.mesh.geometry.dispose();
        this.material.dispose();
      },
    );
  }

  /**
   * Red flash scaled by damage: a small knock ~0.5 peak, a 20-point bite full. A second
   * hit within FLASH_GAP only deepens the running flash; it never re-flashes the periphery.
   */
  private hurtFlash(amount: number, x?: number, z?: number): void {
    const peak = Math.min(1, 0.45 + Math.max(0, amount) / 36);
    if (this.reduced) {
      // No flash: the dim rim eases toward a depth set by the damage.
      this.rimTarget = Math.max(this.rimTarget, peak);
      return;
    }
    const current = this.flashPeak * this.flash;
    if (this.time - this.lastFlashAt < FLASH_GAP && this.flash > 0.05) {
      this.flashPeak = Math.max(this.flashPeak, Math.min(1, peak));
      return;
    }
    this.flashPeak = Math.max(peak, current);
    this.flash = 1;
    this.lastFlashAt = this.time;
    this.aimFlash(x, z);
  }

  /** Point the flash at the attacker: its bearing from the head, in view-plane terms. */
  private aimFlash(x?: number, z?: number): void {
    if (x === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(z)) {
      this.directional = 0;
      return;
    }
    this.camera.updateWorldMatrix(true, false);
    this.camera.getWorldPosition(this.attacker);
    // A bite comes from about knee height.
    this.attacker.set(x, this.attacker.y - 1, z);
    this.camera.worldToLocal(this.attacker);
    const ahead = -this.attacker.z, across = this.attacker.x;
    const length = Math.hypot(across, ahead);
    if (length < 0.05) {
      this.directional = 0;
      return;
    }
    // In front: toward where it is on screen (low, to its side). Behind: the nearer side edge.
    const sideways = across / length;
    const low = ahead > 0 ? -0.6 * (ahead / length) : 0;
    this.flashDir.set(ahead > 0 ? sideways : Math.sign(sideways || 1), low).normalize();
    this.directional = 0.8;
  }

  /** Fade the view to black over `seconds` and hold it there (journey reset). */
  fadeOut(seconds: number): void {
    this.fadeSequence(BLACK, [{ to: 1, seconds }]);
  }

  /** Fade back in from whatever fill is showing. */
  fadeIn(seconds: number): void {
    this.fadeSequence(this.fill > 0.01 ? this.fillColor : BLACK, [{ to: 0, seconds }]);
  }

  /** Start a fill sequence from the current fill value (event-driven). */
  private fadeSequence(color: Color, stages: Stage[]): void {
    // Switching colour mid-fade (black <-> gold) only happens from a clear view.
    if (this.fill < 0.01 || color === this.fillColor) this.fillColor.copy(color);
    this.stages = stages;
    this.stageIndex = 0;
    this.stageFrom = this.fill;
    this.stageTime = 0;
    this.blackTime = 0;
  }

  update(delta: number, time: number): void {
    this.time += delta;
    this.flash = Math.max(0, this.flash - delta / 0.75);
    this.rim += (this.rimTarget - this.rim) * Math.min(1, delta / REDUCED.rise);
    this.rimTarget = Math.max(0, this.rimTarget - delta / REDUCED.ebb);
    const reduced = this.reduced;

    // Fill sequencer.
    if (this.stageIndex < this.stages.length) {
      const stage = this.stages[this.stageIndex];
      this.stageTime += delta;
      const t = stage.seconds > 0 ? Math.min(1, this.stageTime / stage.seconds) : 1;
      const eased = t * t * (3 - 2 * t);
      this.fill = this.stageFrom + (stage.to - this.stageFrom) * eased;
      if (t >= 1) {
        this.stageIndex++;
        this.stageFrom = this.fill;
        this.stageTime = 0;
      }
    } else if (this.fill > 0.99) {
      // Held black (death, a reset) with nothing scheduled: never leave the player blind.
      this.blackTime += delta;
      if (this.blackTime > 12) this.fadeSequence(this.fillColor, [{ to: 0, seconds: 1.5 }]);
    }

    const game = this.game;
    const alive = game?.active === true && !game.getValue(GameState, 'ended');
    const health = alive ? game!.getValue(GameState, 'health') ?? 100 : 100;
    const hunger = alive ? game!.getValue(GameState, 'hunger') ?? 100 : 100;
    const night = game?.active ? nightness(game.getValue(GameState, 'clock') ?? 0) : 0;

    // Low health: one swell per heartbeat, on the audio heartbeat's own clock (lub at
    // phase 0, dub at HEARTBEAT.dub), so the edge and the sound never drift apart. It
    // pulses only while that heartbeat plays; health sets the depth.
    const phase = alive && health > 0 ? heartbeatPhase(time) : -1;
    const danger = phase >= 0 ? Math.min(1, Math.max(0, (HEARTBEAT.on - health) / HEARTBEAT.on)) : 0;
    let beatTarget = 0;
    if (phase >= 0 && reduced) {
      // A gentle breath on the heart's rhythm: the rim never drops away or snaps back.
      beatTarget = (0.4 + 0.6 * danger) * (0.6 + 0.4 * Math.cos(phase * Math.PI * 2));
    } else if (phase >= 0) {
      // Quick rise on the lub, a slow fall through the dub: a single beat, never two flashes.
      const rise = Math.min(1, phase / 0.08);
      const fall = Math.exp(-Math.max(0, phase - 0.08) / 0.22);
      beatTarget = (0.4 + 0.6 * danger) * (0.2 + 0.8 * rise * fall);
    }
    this.beat += (beatTarget - this.beat) * Math.min(1, delta * (reduced ? 4 : 18));

    // Low hunger: a slow dim amber breath (~3.5 s); starving: a steady dark rim.
    const starving = alive && hunger <= 0;
    const famine = !starving && hunger < LOW_HUNGER ? (LOW_HUNGER - hunger) / LOW_HUNGER : 0;
    const hungerTarget = famine > 0 ? (0.3 + 0.7 * famine) * (0.75 + 0.25 * Math.sin(this.time * 1.8)) : 0;
    this.hunger += (hungerTarget - this.hunger) * Math.min(1, delta * 2);
    this.starve += ((starving ? 1 : 0) - this.starve) * Math.min(1, delta * 1.5);

    const envelope = this.flash * (2 - this.flash); // fast attack, eased decay
    const flash = reduced ? this.rim * REDUCED.rimPeak : envelope * this.flashPeak * this.config.flashStrength.peek();
    const pulse = this.beat * this.config.pulseStrength.peek() * (reduced ? REDUCED.pulse : 1);
    const amber = this.hunger * this.config.hungerStrength.peek();
    const dim = amber + (STARVE_RIM - amber) * this.starve;
    const warming = this.warmFrames > 0;
    if (warming) this.warmFrames--;
    if (!warming && flash < 0.004 && pulse < 0.004 && dim < 0.004 && this.fill < 0.004) {
      if (this.mesh.visible) this.mesh.visible = false;
      return;
    }
    if (!this.mesh.visible) this.mesh.visible = true;
    // Blood red deepens with the night: the edge never outshines the dark view centre.
    // Reduced: a dim, near-black red that only darkens the edge.
    if (reduced) this.red.copy(RIM_DAY).lerp(RIM_NIGHT, night);
    else this.red.copy(HURT_DAY).lerp(HURT_NIGHT, night);
    this.flashA.value = flash;
    // Bigger hits reach further in, but never past FLASH_INNER_MIN (reduced: a fixed thin rim).
    this.flashInner.value = reduced ? REDUCED.rimInner : 0.95 - (0.95 - FLASH_INNER_MIN) * this.flashPeak * envelope;
    this.flashDirAmt.value = reduced ? 0 : this.directional;
    this.pulseA.value = pulse;
    this.pulseInner.value = reduced ? REDUCED.rimInner : 0.93 - 0.13 * danger;
    this.amberColor.copy(AMBER).lerp(STARVE, this.starve);
    this.amberA.value = dim;
    this.fillUniform.value = Math.min(1, Math.max(0, this.fill));

    // Map the screen edges to r = 1: browser from the projection, XR from typical per-eye FOV.
    if (this.renderer.xr.isPresenting) {
      this.half.set(XR_TAN_X * DISTANCE, XR_TAN_Y * DISTANCE);
    } else {
      const tanY = Math.tan((this.camera.fov * Math.PI) / 360);
      this.half.set(tanY * this.camera.aspect * DISTANCE, tanY * DISTANCE);
    }
  }
}
