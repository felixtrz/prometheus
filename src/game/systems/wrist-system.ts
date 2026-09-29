import { createSystem, Entity, ScreenSpace, Types, UIKitMLAsset, Vector3 } from '@iwsdk/core';
import { bus } from '../bus.js';
import { Campfire, GameState, Held, Item } from '../components.js';
import { phaseAt } from '../rules.js';
import { currentObjective, ENDING, objectiveIndex, OBJECTIVES } from '../story.js';
import { LANDMARKS } from '../terrain.js';
import {
  clampPercent, healthBand, hungerBand, HIDE, NUMBER, PanelText, PERCENT, PHASE_INDEX, plain,
  SHOW, SKY_ICON_SUFFIX, Style,
} from './journal-system.js';
import { SurvivalSystem } from './survival-system.js';

const SKY_IDS = SKY_ICON_SUFFIX.map((s) => `wr-ic-${s}`);
const IDS: readonly string[] = [
  ...SKY_IDS, 'wr-day', 'wr-ic-fire', 'wr-fire', 'wr-hunger-fill', 'wr-hunger-val', 'wr-health-fill', 'wr-health-val',
  'wr-ic-health', 'wr-ic-hunger',
  'wr-obj-label', 'wr-obj', 'wr-hint', 'wr-tonight-row', 'wr-bolts-row', 'wr-bolts', 'wr-fed-row', 'wr-fed',
];
const SLEEP = objectiveIndex('sleep');

/**
 * Each objective's short wrist hint (story.ts `wrist`, at most 64 characters: two
 * lines, verb and action kept). A longer one is cut at a word with "..." rather
 * than dropping to its first sentence.
 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max - 3);
  return `${text.slice(0, cut > 0 ? cut : max - 3).replace(/[,.;:]$/, '')}...`;
}
const WRIST_HINT_CHARS = 64;
const OBJ_TITLE = OBJECTIVES.map((o) => plain(o.title));
const OBJ_HINT = OBJECTIVES.map((o) => clip(plain(o.wrist), WRIST_HINT_CHARS));
const ENDING_HOME = plain(ENDING.home);
const ENDING_REST = plain(ENDING.rest);
const DAY_TEXT = Array.from({ length: 100 }, (_, i) => `Day ${i}`);
const BOLT_TEXT = Array.from({ length: 65 }, (_, i) => `${i}`);
/** Campfire burns 1/3 fuel per second (smothering aside): seconds left = fuel * 3. */
const FIRE_SECONDS_PER_FUEL = 3;
const FIRE_TEXT = Array.from({ length: 301 }, (_, s) => `Fire ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
const FIRE_OUT = 'Fire out';
/** Well-fed time left ('1:30'), up to 5 minutes. */
const FED_TEXT = Array.from({ length: 301 }, (_, s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
const HOME_RADIUS = 8;

/** Vitals bands (see hungerBand / healthBand): green, amber, red for the fill, icon and number. */
const BAND_COLOR = ['#86b36a', '#e0a53f', '#e8503a'] as const;
const VITAL_FILL: readonly Style[] = BAND_COLOR.map((c) => ({ backgroundColor: c }));
const VITAL_ICON: readonly Style[] = BAND_COLOR.map((c) => ({ color: c }));
const VITAL_VALUE: readonly Style[] = [{ color: '#ede9da' }, { color: BAND_COLOR[1] }, { color: BAND_COLOR[2] }];
const BOLTS_EMPTY: Style = { color: '#e58a55' };
const BOLTS_OK: Style = { color: '#d4b180' };
/** Fire readout bands: 0 out, 1 under a minute, 2 burning. */
const FIRE_STYLE: readonly Style[] = [{ color: '#8c9d8c' }, { color: '#e58a55' }, { color: '#e9b36a' }];

/**
 * Wrist band on the inside of the left forearm (child of the left grip space,
 * persistent, display-only). Reads GameState, the camp Campfire and the held
 * crossbow's charges at 5 Hz and writes UIKit only on change:
 * day + sky icon, fire time left ("Fire 2:30" / "Fire out"), prominent health and food
 * bars that shift green -> amber -> red (bar, icon and number; see healthBand/hungerBand),
 * a "Well fed" line with its time left while a stew's buff lasts ('well-fed' events),
 * the current objective (day rule: sleep waits for the night) with its short wrist hint and
 * a "Tonight:" line while sleep is pending, and bolts loaded while a crossbow is held.
 * After the ending: ENDING.home, then ENDING.rest within 8 m of the campfire.
 *
 * Hidden until the first 'journey-begin' (the start panel stands alone before that).
 *
 * In the desktop browser the same panel doubles as a small top-left HUD via
 * ScreenSpace (disable with `browserHud`); IWSDK moves it back under the grip in XR.
 * Grip space (WebXR): -Z runs from the palm toward the fingers, +X leaves the left
 * palm, +Y is the thumb side. Yaw +90 degrees lays the panel along the forearm,
 * reading elbow-to-hand, facing out of the palm side. Tune with the config fields.
 */
export class WristSystem extends createSystem({
  game: { required: [GameState] },
  held: { required: [Item, Held] },
  fires: { required: [Campfire] },
}, {
  offsetX: { type: Types.Float32, default: 0.04 },
  offsetY: { type: Types.Float32, default: -0.015 },
  offsetZ: { type: Types.Float32, default: 0.11 },
  yawDeg: { type: Types.Float32, default: 90 },
  /** Lean toward the face around the forearm axis. */
  rollDeg: { type: Types.Float32, default: 0 },
  scale: { type: Types.Float32, default: 0.3 },
  browserHud: { type: Types.Boolean, default: true },
}) {
  private hud?: UIKitMLAsset;
  private ui?: PanelText;
  private entity?: Entity;
  private game?: Entity;
  private fire?: Entity;
  private crossbow?: Entity;
  private timer = 0;
  private disposed = false;
  private rested = false;
  private eye = new Vector3();
  /** Seconds of well-fed left at `fedAt` (from the 'well-fed' events), counted down here. */
  private fedSeconds = 0;
  private fedAt = 0;
  private now = 0;
  private snapFed = -2;

  private snapHunger = -1;
  private snapHealth = -1;
  private snapDay = -1;
  private snapPhase = -1;
  private snapObjective = -2;
  private snapBolts = -2;
  private snapFire = -2;
  private snapFireBand = -1;
  /** Hidden until a journey begins (the start panel holds the stage alone). */
  private shown = false;

  init(): void {
    this.cleanupFuncs.push(
      bus.on('journey-begin', () => this.setShown(true)),
      bus.on('well-fed', (event) => { this.fedSeconds = Math.max(0, event.seconds); this.fedAt = this.now; }),
      bus.on('new-game', () => { this.fedSeconds = 0; }),
      this.queries.game.subscribe('qualify', (entity) => { this.game = entity; this.resetSnapshots(); }, true),
      this.queries.game.subscribe('disqualify', (entity) => {
        if (this.game !== entity) return;
        this.game = undefined;
        for (const other of this.queries.game.entities) if (other !== entity) this.game = other;
        this.resetSnapshots();
      }),
      this.queries.fires.subscribe('qualify', (entity) => { this.fire = entity; }, true),
      this.queries.fires.subscribe('disqualify', (entity) => {
        if (this.fire !== entity) return;
        this.fire = undefined;
        for (const other of this.queries.fires.entities) if (other !== entity) this.fire = other;
      }),
      this.queries.held.subscribe('qualify', (entity) => {
        if (entity.getValue(Item, 'kind') === 'crossbow') this.crossbow = entity;
      }, true),
      this.queries.held.subscribe('disqualify', (entity) => {
        if (this.crossbow !== entity) return;
        this.crossbow = undefined;
        for (const other of this.queries.held.entities) {
          if (other !== entity && other.getValue(Item, 'kind') === 'crossbow') this.crossbow = other;
        }
      }),
      () => {
        this.disposed = true;
        this.entity?.dispose({ disposeResources: false });
      },
    );

    void this.world.assets.instantiate<UIKitMLAsset>('wrist-hud').then((hud) => {
      if (this.disposed) { hud.dispose(); return; }
      this.hud = hud;
      hud.pointerEvents = 'none';
      this.entity = this.world.createTransformEntity(hud, {
        parent: this.world.playerSpaceEntities.gripSpaces.left,
        persistent: true,
      });
      this.ui = new PanelText(hud, IDS, 'wrist-hud');
      hud.document.visible = this.shown;
      this.placeOnWrist();
      this.cleanupFuncs.push(
        this.config.offsetX.subscribe(() => this.placeOnWrist()),
        this.config.offsetY.subscribe(() => this.placeOnWrist()),
        this.config.offsetZ.subscribe(() => this.placeOnWrist()),
        this.config.yawDeg.subscribe(() => this.placeOnWrist()),
        this.config.rollDeg.subscribe(() => this.placeOnWrist()),
        this.config.scale.subscribe(() => this.placeOnWrist()),
        this.config.browserHud.subscribe((on) => this.setBrowserHud(on)),
      );
      this.resetSnapshots();
    }).catch((error: unknown) => console.warn('[Prometheus UI] wrist-hud failed to load', error));
  }

  private setShown(shown: boolean): void {
    this.shown = shown;
    if (this.hud) this.hud.document.visible = shown;
    this.resetSnapshots();
  }

  private placeOnWrist(): void {
    const hud = this.hud;
    if (!hud) return;
    const d = Math.PI / 180;
    hud.position.set(this.config.offsetX.peek(), this.config.offsetY.peek(), this.config.offsetZ.peek());
    hud.rotation.set(this.config.rollDeg.peek() * d, this.config.yawDeg.peek() * d, 0, 'YXZ');
    hud.scale.setScalar(this.config.scale.peek());
  }

  private setBrowserHud(on: boolean): void {
    const entity = this.entity;
    if (!entity) return;
    if (on && !entity.hasComponent(ScreenSpace)) {
      entity.addComponent(ScreenSpace, { width: '250px', height: '262px', top: '16px', left: '16px', zOffset: 0.25 });
    } else if (!on && entity.hasComponent(ScreenSpace)) {
      entity.removeComponent(ScreenSpace);
      // Return the document from the camera to the grip-space host.
      const hud = this.hud;
      if (hud && hud.document.parent !== hud) {
        hud.add(hud.document);
        hud.document.clearTargetDimensions();
        hud.document.position.set(0, 0, 0);
      }
    }
  }

  private resetSnapshots(): void {
    this.snapHunger = this.snapHealth = this.snapDay = this.snapPhase = this.snapFireBand = -1;
    this.snapObjective = this.snapBolts = this.snapFire = this.snapFed = -2;
    this.rested = false;
  }

  update(delta: number): void {
    this.now += delta;
    this.timer += delta;
    if (this.timer < 0.2) return;
    this.timer = 0;
    const ui = this.ui;
    const game = this.game;
    if (!ui || !game?.active || !this.shown) return;

    const hunger = clampPercent(game.getValue(GameState, 'hunger') ?? 0);
    if (hunger !== this.snapHunger) {
      const bandChanged = this.snapHunger < 0 || hungerBand(hunger) !== hungerBand(this.snapHunger);
      this.snapHunger = hunger;
      ui.text('wr-hunger-val', NUMBER[hunger]);
      ui.get('wr-hunger-fill')?.setProperties({ width: PERCENT[hunger] });
      if (bandChanged) {
        const b = hungerBand(hunger);
        ui.style('wr-hunger-fill', VITAL_FILL[b]);
        ui.style('wr-ic-hunger', VITAL_ICON[b]);
        ui.style('wr-hunger-val', VITAL_VALUE[b]);
      }
    }
    const health = clampPercent(game.getValue(GameState, 'health') ?? 0);
    if (health !== this.snapHealth) {
      const bandChanged = this.snapHealth < 0 || healthBand(health) !== healthBand(this.snapHealth);
      this.snapHealth = health;
      ui.text('wr-health-val', NUMBER[health]);
      ui.get('wr-health-fill')?.setProperties({ width: PERCENT[health] });
      if (bandChanged) {
        const b = healthBand(health);
        ui.style('wr-health-fill', VITAL_FILL[b]);
        ui.style('wr-ic-health', VITAL_ICON[b]);
        ui.style('wr-health-val', VITAL_VALUE[b]);
      }
    }

    const clock = game.getValue(GameState, 'clock') ?? 0;
    const phaseName = phaseAt(clock);
    const day = game.getValue(GameState, 'day') ?? 1;
    if (day !== this.snapDay) {
      this.snapDay = day;
      ui.text('wr-day', DAY_TEXT[day] ?? `Day ${day}`);
    }
    const phase = PHASE_INDEX[phaseName];
    if (phase !== this.snapPhase) {
      this.snapPhase = phase;
      for (let i = 0; i < SKY_IDS.length; i++) ui.style(SKY_IDS[i], i === phase ? SHOW : HIDE);
    }

    // Camp fire time left.
    const fire = this.fire;
    const lit = fire?.active === true && fire.getValue(Campfire, 'lit') === true;
    const seconds = lit ? Math.max(0, Math.ceil((fire!.getValue(Campfire, 'fuel') ?? 0) * FIRE_SECONDS_PER_FUEL)) : -1;
    if (seconds !== this.snapFire) {
      this.snapFire = seconds;
      ui.text('wr-fire', seconds < 0 ? FIRE_OUT : FIRE_TEXT[seconds] ?? FIRE_TEXT[300]);
      const band = seconds < 0 ? 0 : seconds <= 60 ? 1 : 2;
      if (band !== this.snapFireBand) {
        this.snapFireBand = band;
        ui.style('wr-fire', FIRE_STYLE[band]);
        ui.style('wr-ic-fire', FIRE_STYLE[band]);
      }
    }

    // Objective, hint and the "Tonight" line; after the ending, the way home.
    const ended = game.getValue(GameState, 'ended') === true;
    const mask = game.getValue(GameState, 'objectives') ?? 0;
    let key: number;
    let objective = -1;
    let tonight = false;
    if (ended) {
      if (!this.rested) {
        this.camera.getWorldPosition(this.eye);
        this.rested = Math.hypot(this.eye.x - LANDMARKS.campfire.x, this.eye.z - LANDMARKS.campfire.z) < HOME_RADIUS;
      }
      key = this.rested ? 1001 : 1000;
    } else {
      objective = currentObjective(mask, phaseName);
      tonight = objective !== SLEEP && (mask & (1 << SLEEP)) === 0;
      key = objective + (tonight ? 100 : 0);
    }
    if (key !== this.snapObjective) {
      const wasTonight = this.snapObjective >= 100 && this.snapObjective < 1000;
      this.snapObjective = key;
      if (ended) {
        ui.text('wr-obj-label', 'THE VALLEY REMEMBERS');
        ui.text('wr-obj', this.rested ? ENDING_REST : ENDING_HOME);
        ui.style('wr-hint', HIDE);
      } else {
        ui.text('wr-obj-label', 'NOW');
        ui.text('wr-obj', objective >= 0 ? OBJ_TITLE[objective] : ENDING_REST);
        if (objective >= 0) ui.text('wr-hint', OBJ_HINT[objective]);
        ui.style('wr-hint', objective >= 0 ? SHOW : HIDE);
      }
      if (tonight !== wasTonight || key === 1000 || key === 1001) ui.style('wr-tonight-row', tonight ? SHOW : HIDE);
    }

    // Well fed (a stew): mending as you go, with the time left.
    const survival = this.world.getSystem(SurvivalSystem);
    const fedLeft = survival ? survival.wellFedSeconds
      : this.fedSeconds > 0 ? this.fedSeconds - (this.now - this.fedAt) : 0;
    const fed = ended ? 0 : Math.min(300, Math.max(0, Math.ceil(fedLeft)));
    if (fed !== this.snapFed) {
      if (this.snapFed < 0 || (fed > 0) !== (this.snapFed > 0)) ui.style('wr-fed-row', fed > 0 ? SHOW : HIDE);
      this.snapFed = fed;
      if (fed > 0) ui.text('wr-fed', FED_TEXT[fed]);
    }

    const crossbow = this.crossbow;
    const bolts = crossbow?.active ? Math.max(0, crossbow.getValue(Item, 'charges') ?? 0) : -1;
    if (bolts !== this.snapBolts) {
      const wasShown = this.snapBolts >= 0;
      this.snapBolts = bolts;
      if ((bolts >= 0) !== wasShown) ui.style('wr-bolts-row', bolts >= 0 ? SHOW : HIDE);
      if (bolts >= 0) {
        ui.text('wr-bolts', BOLT_TEXT[bolts] ?? `${bolts}`);
        ui.style('wr-bolts', bolts === 0 ? BOLTS_EMPTY : BOLTS_OK);
      }
    }
  }
}
