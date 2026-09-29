import {
  createSystem, DirectionalLightComponent, DomeGradient, Entity, Fog, HemisphereLightComponent,
  IBLGradient, LevelRoot, Material, Mesh, MeshStandardMaterial, Points, Pressed, SRGBColorSpace, Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { bus } from '../bus.js';
import { Bedroll, Campfire, Creature, GameState } from '../components.js';
import { DAWN_CLOCK, DAY, DAY_LENGTH, nightness, Phase, phaseAt, SLEEP, SURVIVAL } from '../rules.js';

type RGB = readonly [number, number, number];
type Writable = { [index: number]: number };
type Palette = {
  domeSky: RGB; domeEquator: RGB; domeGround: RGB;
  iblSky: RGB; iblEquator: RGB; iblGround: RGB;
  sun: RGB; sunIntensity: number; hemiSky: RGB; hemiGround: RGB; hemiIntensity: number;
  fogNear: number; fogFar: number;
};
// Day = the authored scene; dusk/night are art placeholders tuned for readable nights.
const DAY_P: Palette = {
  domeSky: [.10, .36, .68], domeEquator: [.62, .80, .87], domeGround: [.32, .38, .20],
  iblSky: [.53, .68, .81], iblEquator: [.72, .77, .65], iblGround: [.28, .34, .17],
  sun: [1, .89, .72], sunIntensity: 1.7, hemiSky: [.69, .82, 1], hemiGround: [.33, .40, .18], hemiIntensity: .3,
  fogNear: 30, fogFar: 120,
};
const DUSK_P: Palette = {
  domeSky: [.20, .22, .45], domeEquator: [.95, .55, .32], domeGround: [.22, .18, .14],
  iblSky: [.45, .40, .50], iblEquator: [.80, .55, .40], iblGround: [.22, .20, .14],
  sun: [1, .58, .34], sunIntensity: .9, hemiSky: [.70, .55, .55], hemiGround: [.25, .22, .15], hemiIntensity: .22,
  fogNear: 20, fogFar: 90,
};
const NIGHT_P: Palette = {
  domeSky: [.02, .035, .09], domeEquator: [.06, .09, .16], domeGround: [.02, .03, .025],
  iblSky: [.09, .12, .22], iblEquator: [.07, .09, .15], iblGround: [.03, .035, .03],
  // Dim enough that the campfire's pool of light reads as the safe ring.
  sun: [.55, .65, 1], sunIntensity: .2, hemiSky: [.2, .26, .48], hemiGround: [.05, .06, .05], hemiIntensity: .09,
  fogNear: 12, fogFar: 60,
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mix(out: Writable, a: RGB, b: RGB, c: RGB, t: number, dusk: number): void {
  // Blend day→night, with a warm dusk band peaking mid-transition.
  for (let i = 0; i < 3; i++) out[i] = lerp(lerp(a[i], c[i], t), b[i], dusk);
}

/**
 * Clock, sky, sun/moon, fog, throttled IBL, sleep. Runs before EnvironmentSystem.
 *
 * The Spire hold (bus 'finale-hold') darkens the sky to full night whatever the
 * clock ("the Hollow bring the dark"): the sky follows max(nightness(clock),
 * finaleDark), and the ending lifts it again as the dawn. StartSystem sets
 * `holdClock` while the start panel is up so the day stays put.
 */
export class DayNightSystem extends createSystem({
  game: { required: [GameState] },
  sky: { required: [DomeGradient, IBLGradient, LevelRoot] },
  sleepers: { required: [Bedroll, Pressed] },
  fires: { required: [Campfire] },
  creatures: { required: [Creature] },
}) {
  /** Night-only sky materials found by name in the level (clouds dim, stars and moon fade in). */
  private skyMaterials?: { clouds: { material: MeshStandardMaterial; base: number }[]; night: Material[] };
  private viewer = new Vector3();
  private moonDir = new Vector3();
  private sun?: Entity;
  private hemi?: Entity;
  private phase: Phase | '' = '';
  private lastNight = -1;
  /** Seconds until a sleep takes effect (behind the fade), or -1. */
  private sleepIn = -1;
  private domeNight = -1;
  private domeTimer = 0;
  private iblStep = -1;
  private iblTimer = 0;
  private forceSky = true;
  private sunDir = new Vector3();
  private fogColor = new Float32Array(3);
  private sunColor?: Writable;
  private hemiSkyColor?: Writable;
  private hemiGroundColor?: Writable;
  private game?: Entity;
  /** While true the clock does not advance (the start panel is up). */
  holdClock = false;
  /** 0..1 darkness the finale hold lays over the sky (read by creatures and effects). */
  finaleDark = 0;
  private finaleTarget = 0;
  /** Units per second finaleDark moves toward its target. */
  private finaleRate = 1 / 3;
  /** The sleep in progress is beside a cold fire. */
  private sleepCold = false;
  private skyRoot?: Entity;
  private fire?: Entity;
  /** Seconds of running (unpaused) time, for the shaken spell after a death. */
  private elapsed = 0;
  /** No sleep until `elapsed` passes this: too shaken after a death (SLEEP.shakenSeconds). */
  private shakenUntil = -Infinity;

  init(): void {
    this.cleanupFuncs.push(
      this.queries.game.subscribe('qualify', (entity) => { this.game = entity; }, true),
      this.queries.game.subscribe('disqualify', (entity) => { if (this.game === entity) this.game = undefined; }),
      this.queries.sky.subscribe('qualify', (entity) => { this.skyRoot = entity; }, true),
      this.queries.sky.subscribe('disqualify', (entity) => { if (this.skyRoot === entity) this.skyRoot = undefined; }),
      this.queries.fires.subscribe('qualify', (entity) => { this.fire = entity; }, true),
      this.queries.fires.subscribe('disqualify', (entity) => { if (this.fire === entity) this.fire = undefined; }),
      this.queries.sleepers.subscribe('qualify', () => this.sleep()),
      // Dying is not a way to skip the night: after a death in the dark, too shaken to sleep for a while.
      bus.on('respawn', () => {
        const phase = phaseAt(this.game?.getValue(GameState, 'clock') ?? 0);
        if (phase === 'dusk' || phase === 'night') this.shakenUntil = this.elapsed + SLEEP.shakenSeconds;
      }),
      bus.on('journey-begin', () => { this.shakenUntil = -Infinity; }),
      bus.on('finale-hold', (event) => {
        this.finaleTarget = event.active ? 1 : 0;
        this.finaleRate = event.active ? 1 / 3 : 1 / 4;
      }),
      bus.on('ending', () => {
        this.forceDawn();
        // The dark lifts slowly: the finale's own sunrise.
        this.finaleTarget = 0;
        this.finaleRate = 1 / 8;
      }),
      this.world.activeLevel.subscribe(() => {
        this.finaleDark = this.finaleTarget = 0;
        this.sleepIn = -1;
        this.skyMaterials = undefined;
        this.sun = this.hemi = undefined;
        this.sunColor = this.hemiSkyColor = this.hemiGroundColor = undefined;
        this.forceSky = true;
        this.phase = '';
        this.domeNight = this.lastNight = -1;
      }),
    );
  }

  get state(): Entity | undefined {
    return this.game;
  }

  /**
   * Point at the bedroll and pull the trigger: from a third of the way into the night.
   * Beside a lit fire you wake mended; beside a cold one you may still sleep if no wolf
   * is near, but you wake stiff and hungry (SURVIVAL.coldSleep*, never fatal).
   */
  sleep(): void {
    const game = this.state;
    if (!game || this.sleepIn >= 0) return;
    const clock = game.getValue(GameState, 'clock') ?? 0;
    const phase = phaseAt(clock);
    const fire = this.fire;
    if (phase === 'day' || phase === 'dusk') {
      bus.emit({ type: 'toast', text: 'You aren\u2019t tired yet', body: 'Sleep comes once the night is under way, best beside a lit fire.', tone: 'info' });
      return;
    }
    if (phase === 'dawn') {
      bus.emit({ type: 'toast', text: 'The sun is already rising', tone: 'info' });
      return;
    }
    const nightStart = DAY.day + DAY.dusk;
    if ((clock - nightStart) / DAY.night < SLEEP.minNightFraction) {
      bus.emit({ type: 'toast', text: 'The night is still young', body: 'Keep the fire fed. Rest when the stars have turned.', tone: 'info' });
      return;
    }
    if (this.elapsed < this.shakenUntil) {
      bus.emit({
        type: 'toast', text: 'Too shaken to sleep', tone: 'warn',
        body: 'Your heart is still pounding. Keep the fire fed and watch the dark a while.',
      });
      return;
    }
    const cold = !fire?.getValue(Campfire, 'lit');
    const clear = cold ? SLEEP.coldWolfClearRadius : SLEEP.wolfClearRadius;
    this.camera.getWorldPosition(this.viewer);
    for (const creature of this.queries.creatures.entities) {
      if (creature.getValue(Creature, 'species') !== 'wolf' || (creature.getValue(Creature, 'health') ?? 0) <= 0) continue;
      const p = creature.object3D?.position;
      if (p && Math.hypot(p.x - this.viewer.x, p.z - this.viewer.z) < clear) {
        bus.emit({
          type: 'toast', text: 'The Hollow are too close', tone: 'warn',
          body: cold ? 'Without a fire they will not let you rest. Light it, or drive them off.' : 'Drive them back from the fire first.',
        });
        return;
      }
    }
    // Fade to black first (VignetteSystem listens to 'sleep'); the night ends behind the fade.
    this.sleepIn = .8;
    this.sleepCold = cold;
    bus.emit({ type: 'sleep', day: game.getValue(GameState, 'day') ?? 1, cold });
  }

  private wake(game: Entity): void {
    game.setValue(GameState, 'clock', DAWN_CLOCK);
    const hunger = game.getValue(GameState, 'hunger') ?? 0, health = game.getValue(GameState, 'health') ?? 0;
    if (this.sleepCold) {
      // A night beside a dead fire: it takes its toll, but it never kills.
      game.setValue(GameState, 'hunger', Math.max(0, hunger - SURVIVAL.coldSleepHunger));
      game.setValue(GameState, 'health', Math.max(Math.min(health, SURVIVAL.coldSleepMinHealth), health - SURVIVAL.coldSleepHealth));
      bus.emit({ type: 'toast', text: 'You slept cold', body: 'You wake stiff and hungry. Keep the fire fed through the night.', tone: 'warn', hold: 6 });
    } else {
      game.setValue(GameState, 'hunger', Math.max(0, hunger - 10));
      game.setValue(GameState, 'health', Math.min(100, health + 25));
    }
    this.sleepCold = false;
    // Wake standing beside the bedroll, facing the fire.
    const respawn = game.getVectorView(GameState, 'respawn');
    respawn[0] = -.8; respawn[1] = 0; respawn[2] = -2.55;
    this.forceSky = true;
    this.iblStep = -1;
  }

  /** The ending brings the sunrise (no hunger cost, unlike sleeping). */
  private forceDawn(): void {
    const game = this.state;
    if (!game) return;
    const phase = phaseAt(game.getValue(GameState, 'clock') ?? 0);
    if (phase === 'night' || phase === 'dusk') game.setValue(GameState, 'clock', DAWN_CLOCK);
    this.forceSky = true;
    this.iblStep = -1;
  }

  private findSkyMaterials(): void {
    const clouds: { material: MeshStandardMaterial; base: number }[] = [];
    const night: Material[] = [];
    const seen = new Set<Material>();
    this.world.getActiveRoot().traverse((object) => {
      if (!(object instanceof Mesh) && !(object instanceof Points)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (seen.has(material)) continue;
        seen.add(material);
        if (material.name === 'Clouds' && material instanceof MeshStandardMaterial) clouds.push({ material, base: material.emissiveIntensity });
        else if (material.name === 'Night stars' || material.name === 'Moon') {
          material.transparent = true;
          night.push(material);
        }
      }
    });
    this.skyMaterials = { clouds, night };
  }

  private applySky(night: number): void {
    if (!this.skyMaterials) this.findSkyMaterials();
    for (const { material, base } of this.skyMaterials!.clouds) {
      material.emissiveIntensity = base * (1 - .92 * night);
      material.color.setScalar(1 - .75 * night);
    }
    for (const material of this.skyMaterials!.night) {
      const opacity = Math.max(0, night * 1.15 - .15);
      material.opacity = opacity;
      material.visible = opacity > .01;
    }
  }

  update(delta: number): void {
    const game = this.state;
    if (!game) return;
    if (this.sleepIn >= 0 && (this.sleepIn -= delta) < 0) this.wake(game);
    const visibility = this.visibilityState.peek();
    const running = visibility !== VisibilityState.VisibleBlurred && visibility !== VisibilityState.Hidden;
    if (running && !this.holdClock) this.elapsed += Math.min(delta, .25);
    let clock = game.getValue(GameState, 'clock') ?? 0;
    if (running && this.finaleDark !== this.finaleTarget) {
      const step = this.finaleRate * Math.min(delta, .25);
      this.finaleDark = this.finaleDark < this.finaleTarget
        ? Math.min(this.finaleTarget, this.finaleDark + step) : Math.max(this.finaleTarget, this.finaleDark - step);
    }
    if (running && !this.holdClock) {
      clock += Math.min(delta, .25);
      if (clock >= DAY_LENGTH) {
        clock -= DAY_LENGTH;
        game.setValue(GameState, 'day', (game.getValue(GameState, 'day') ?? 1) + 1);
      }
      game.setValue(GameState, 'clock', clock);
    }
    const phase = phaseAt(clock);
    if (phase !== this.phase) {
      const initial = this.phase === '';
      this.phase = phase;
      if (!initial) bus.emit({ type: 'phase', phase, day: game.getValue(GameState, 'day') ?? 1 });
    }

    const night = Math.max(nightness(clock), this.finaleDark);
    const dusk = 1 - Math.abs(night * 2 - 1); // 0 at day/night plateaus, 1 mid-transition
    // Timers tick every frame so a jump (save load, debug) is written once the throttle opens.
    this.domeTimer -= delta;
    this.iblTimer -= delta;
    this.applyLights(clock, night, dusk);
    if (this.forceSky || Math.abs(night - this.lastNight) > 1e-4) {
      this.lastNight = night;
      this.applyFog(night, dusk);
      this.applySky(night);
    }
    const root = this.skyRoot;
    if (!root) return;
    if ((this.forceSky || Math.abs(night - this.domeNight) > 1e-4) && (this.forceSky || this.domeTimer <= 0)) {
      this.domeTimer = 1 / 12;
      this.domeNight = night;
      mix(root.getVectorView(DomeGradient, 'sky'), DAY_P.domeSky, DUSK_P.domeSky, NIGHT_P.domeSky, night, dusk);
      mix(root.getVectorView(DomeGradient, 'equator'), DAY_P.domeEquator, DUSK_P.domeEquator, NIGHT_P.domeEquator, night, dusk);
      mix(root.getVectorView(DomeGradient, 'ground'), DAY_P.domeGround, DUSK_P.domeGround, NIGHT_P.domeGround, night, dusk);
      root.setValue(DomeGradient, '_needsUpdate', true);
    }
    // IBL rebuilds are expensive: quantised steps, at least a second apart.
    const step = Math.round(night * 16);
    if (this.forceSky || (step !== this.iblStep && this.iblTimer <= 0)) {
      this.iblStep = step;
      this.iblTimer = 1;
      const q = step / 16, qd = 1 - Math.abs(q * 2 - 1);
      mix(root.getVectorView(IBLGradient, 'sky'), DAY_P.iblSky, DUSK_P.iblSky, NIGHT_P.iblSky, q, qd);
      mix(root.getVectorView(IBLGradient, 'equator'), DAY_P.iblEquator, DUSK_P.iblEquator, NIGHT_P.iblEquator, q, qd);
      mix(root.getVectorView(IBLGradient, 'ground'), DAY_P.iblGround, DUSK_P.iblGround, NIGHT_P.iblGround, q, qd);
      root.setValue(IBLGradient, '_needsUpdate', true);
    }
    this.forceSky = false;
  }

  private applyLights(clock: number, night: number, dusk: number): void {
    if (!this.sun) {
      this.sun = this.world.getSceneEntity('sun');
      this.sunColor = this.sun?.getVectorView(DirectionalLightComponent, 'color');
    }
    if (!this.hemi) {
      this.hemi = this.world.getSceneEntity('ambient-fill');
      this.hemiSkyColor = this.hemi?.getVectorView(HemisphereLightComponent, 'skyColor');
      this.hemiGroundColor = this.hemi?.getVectorView(HemisphereLightComponent, 'groundColor');
    }
    const sun = this.sun, hemi = this.hemi;
    if (sun?.object3D && this.sunColor) {
      mix(this.sunColor, DAY_P.sun, DUSK_P.sun, NIGHT_P.sun, night, dusk);
      sun.setValue(DirectionalLightComponent, 'intensity', lerp(lerp(DAY_P.sunIntensity, NIGHT_P.sunIntensity, night), DUSK_P.sunIntensity, dusk));
      // The sun rises in the east (+X), crosses the south behind camp, sets in the west;
      // at night the light blends toward the moon's fixed high north-east position.
      const t = Math.min(1, Math.max(0, (((clock % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / (DAY.day + DAY.dusk)));
      const azimuth = Math.PI / 2 - Math.PI * t;
      const elevation = .22 + .9 * Math.sin(Math.PI * t);
      this.sunDir.set(-Math.cos(elevation) * Math.sin(azimuth), -Math.sin(elevation), -Math.cos(elevation) * Math.cos(azimuth));
      this.moonDir.set(-Math.cos(.95) * Math.sin(2.4), -Math.sin(.95), -Math.cos(.95) * Math.cos(2.4));
      this.sunDir.lerp(this.moonDir, night).normalize();
      sun.object3D.quaternion.setFromUnitVectors(FORWARD, this.sunDir);
    }
    if (hemi && this.hemiSkyColor && this.hemiGroundColor) {
      mix(this.hemiSkyColor, DAY_P.hemiSky, DUSK_P.hemiSky, NIGHT_P.hemiSky, night, dusk);
      mix(this.hemiGroundColor, DAY_P.hemiGround, DUSK_P.hemiGround, NIGHT_P.hemiGround, night, dusk);
      hemi.setValue(HemisphereLightComponent, 'intensity', lerp(lerp(DAY_P.hemiIntensity, NIGHT_P.hemiIntensity, night), DUSK_P.hemiIntensity, dusk));
    }
  }

  private applyFog(night: number, dusk: number): void {
    const fog = this.world.scene.fog;
    if (!(fog instanceof Fog)) return;
    mix(this.fogColor, DAY_P.domeEquator, DUSK_P.domeEquator, NIGHT_P.domeEquator, night, dusk);
    fog.color.setRGB(this.fogColor[0], this.fogColor[1], this.fogColor[2], SRGBColorSpace);
    fog.near = lerp(lerp(DAY_P.fogNear, NIGHT_P.fogNear, night), DUSK_P.fogNear, dusk);
    fog.far = lerp(lerp(DAY_P.fogFar, NIGHT_P.fogFar, night), DUSK_P.fogFar, dusk);
  }
}

const FORWARD = new Vector3(0, 0, -1);
