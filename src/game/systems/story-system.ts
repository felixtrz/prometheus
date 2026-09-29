import { createSystem, Entity, Object3D, Quaternion, Vector3, VisibilityState } from '@iwsdk/core';
import { bus } from '../bus.js';
import { itemInfo, ITEMS } from '../catalog.js';
import { Airborne, Beacon, Campfire, GameState, Held, Item, Page, ResourceNode, Sentry } from '../components.js';
import { benchRecipeIndex, recipeBit } from '../recipes.js';
import { clearSave, SaveData, SavedItem, writeSave } from '../save.js';
import { objectiveIndex, PAGES, STAGE_BY_PRODUCT } from '../story.js';
import { beaconRate, FINALE } from '../rules.js';
import { LANDMARKS } from '../terrain.js';
import { CreatureSystem } from './creature-system.js';
import { ItemSystem } from './item-system.js';

const TORCH_TIP = new Vector3(...ITEMS.torch.tip);
const AUTOSAVE_SECONDS = 60;
const Y_AXIS = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);

type EndingStep = 'outpost' | 'grove' | 'camp' | 'theme' | 'smoke';
/** The valley wakes in sequence after the beacon catches (seconds since it caught). */
const ENDING_STEPS: readonly (readonly [number, EndingStep])[] = [
  [1.5, 'outpost'], [3.5, 'grove'], [4.2, 'camp'], [5, 'theme'], [8, 'smoke'],
];
/** Seconds after the beacon catches that the epilogue (journal tally, New journey) is offered: after the farewell. */
const EPILOGUE_SECONDS = 30;
/** The hold's 'beacon' event is sent when progress has moved this much (not every frame). */
const BEACON_EVENT_STEP = .01;
/** A pending save is written within this long even when the page is never idle (ms). */
const SAVE_IDLE_TIMEOUT = 1000;

/** The journey's tally for the epilogue (see bus 'epilogue'). */
export type JourneyStats = { days: number; deaths: number; crafted: number; slain: number };

/** Registered by BackpackSystem / CombatSystem so save/load can round-trip their state. */
export type SaveHooks = {
  pack?: { save(): SaveData['pack']; load(data: SaveData['pack']): void };
  sentry?: { deploy(entity: Entity, bolts: number): void };
};

/**
 * Progression authority: objectives, pages and recipes, danger stage, the Spire
 * beacon finale, autosave, and the two halves of the start: `resetWorld()` (New
 * journey: clear the save and every in-memory journey set, reload the level) and
 * `applySave()` (Continue). StartSystem decides which runs and when; nothing is
 * saved, announced or autosaved until its 'journey-begin'.
 *
 * The hold: progress follows rules.beaconRate (the torch in the brazier fills it,
 * guardians pressing it drain it: CreatureSystem.pressing) and each wolf bite during
 * the hold knocks FINALE.biteSetback off. A jab with the beacon torch (out of the
 * brazier for up to FINALE.graceSeconds) pauses the fill instead of cooling it. After the ending plays out, bus 'epilogue'
 * carries the journey's tally (also `stats`). Saves are coalesced into one write at
 * the next idle moment (requestSave).
 */
export class StorySystem extends createSystem({
  game: { required: [GameState] },
  pagesHeld: { required: [Page, Item, Held] },
  items: { required: [Item] },
  heldTorches: { required: [Item, Held] },
  beacons: { required: [Beacon] },
  nodes: { required: [ResourceNode] },
  sentries: { required: [Sentry, Item] },
  fires: { required: [Campfire] },
}) {
  readonly hooks: SaveHooks = {};
  private point = new Vector3();
  private viewer = new Vector3();
  /** A journey is under way ('journey-begin' seen, no reset since): saving and announcing allowed. */
  private begun = false;
  private saveTimer = 0;
  private proximityTimer = 0;
  private beaconAnnounced = false;
  private dirtySave = false;
  private resetting = false;
  private resumed = false;
  private journeyAnnounced = false;
  private xrAnnounced = false;
  private sinceBegin = 0;
  private coldBeaconToast = -Infinity;
  private elapsed = 0;
  /** Seconds since the beacon caught; drives the ending timeline (-1 = not running). */
  private endingClock = -1;
  private endingSteps = 0;
  /** Progress knocked off the beacon by bites since the last frame. */
  private setback = 0;
  /** Progress last announced with a 'beacon' event. */
  private beaconSent = 0;
  /** Seconds since a lit torch was last in the spire brazier (a short jab out is FINALE.graceSeconds of grace). */
  private sinceBrazier = Infinity;
  /** Journey tally (saved): products made at the bench, Hollow slain. */
  private crafted = 0;
  private slain = 0;
  /** An idle-time save is scheduled (its cancel function). */
  private pendingSave?: () => void;
  private creatures?: CreatureSystem;
  private game?: Entity;
  private fire?: Entity;
  private restQuat = new Quaternion();
  private turnQuat = new Quaternion();

  get state(): Entity | undefined {
    return this.game;
  }

  /** The journey's tally so far (days, deaths, things crafted, Hollow slain). */
  get stats(): JourneyStats {
    const game = this.state;
    return {
      days: game?.getValue(GameState, 'day') ?? 1, deaths: game?.getValue(GameState, 'deaths') ?? 0,
      crafted: this.crafted, slain: this.slain,
    };
  }

  init(): void {
    const complete = (id: string) => () => this.complete(id);
    this.cleanupFuncs.push(
      this.queries.game.subscribe('qualify', (entity) => { this.game = entity; }, true),
      this.queries.game.subscribe('disqualify', (entity) => { if (this.game === entity) this.game = undefined; }),
      this.queries.fires.subscribe('qualify', (entity) => { this.fire = entity; }, true),
      this.queries.fires.subscribe('disqualify', (entity) => { if (this.fire === entity) this.fire = undefined; }),
      bus.on('fire-lit', complete('light-fire')),
      bus.on('eat', (event) => {
        // Eaten food is gone for good: save it now, or a quick reload would put it back.
        this.dirtySave = true;
        if (event.kind === 'bowl') this.complete('eat-meal');
      }),
      bus.on('torch-lit', complete('torch')),
      bus.on('sleep', complete('sleep')),
      bus.on('hit', (event) => {
        if (event.killed && (event.species === 'deer' || event.species === 'rabbit')) this.complete('hunt');
        if (event.killed && event.species === 'wolf') this.slain++;
      }),
      // A bite during the hold knocks the flame back.
      bus.on('hurt', (event) => { if (event.cause === 'wolf' && this.beaconAnnounced) this.setback += FINALE.biteSetback; }),
      bus.on('sentry-deployed', complete('sentry')),
      bus.on('crafted', (event) => {
        this.crafted++;
        if (event.product === 'spear') this.complete('spear');
        if (event.product === 'crossbow') this.complete('crossbow');
        const stage = STAGE_BY_PRODUCT[event.product];
        const game = this.state;
        if (game && stage && stage > (game.getValue(GameState, 'stage') ?? 0)) {
          game.setValue(GameState, 'stage', stage);
          bus.emit({ type: 'stage', stage });
        }
        this.dirtySave = true;
      }),
      // The reset itself is StartSystem's (it answers 'new-game'); stop saving at once.
      bus.on('new-game', () => {
        this.begun = false;
        this.cancelSave();
        this.crafted = this.slain = 0;
      }),
      bus.on('journey-begin', (event) => {
        this.begun = true;
        this.resumed = event.resumed;
        this.journeyAnnounced = this.xrAnnounced = false;
        this.sinceBegin = 0;
        this.saveTimer = 0;
        this.dirtySave = false;
        this.setback = 0;
        this.sinceBrazier = Infinity;
        // A resumed journey's tally came with its save (applySave).
        if (!event.resumed) this.crafted = this.slain = 0;
      }),
      this.queries.pagesHeld.subscribe('qualify', (entity) => this.pageFound(entity.getValue(Page, 'index') ?? 0)),
      this.world.activeLevel.subscribe(() => {
        this.beaconAnnounced = false;
        this.journeyAnnounced = this.xrAnnounced = false;
        this.endingClock = -1;
        this.endingSteps = 0;
        this.setback = this.beaconSent = 0;
        this.sinceBrazier = Infinity;
      }),
      () => this.cancelSave(),
    );
    // Leaving or backgrounding the page: write a pending (or due) save now rather than lose it.
    const flush = () => { if (this.pendingSave || this.dirtySave) this.saveNow(); };
    const hidden = () => { if (globalThis.document?.visibilityState === 'hidden') flush(); };
    globalThis.addEventListener?.('pagehide', flush);
    globalThis.document?.addEventListener('visibilitychange', hidden);
    this.cleanupFuncs.push(() => {
      globalThis.removeEventListener?.('pagehide', flush);
      globalThis.document?.removeEventListener('visibilitychange', hidden);
    });
  }

  private bump(): void {
    const game = this.state;
    if (game) game.setValue(GameState, 'revision', (game.getValue(GameState, 'revision') ?? 0) + 1);
  }

  complete(id: string): void {
    const game = this.state;
    const index = objectiveIndex(id);
    if (!game || index < 0) return;
    const mask = game.getValue(GameState, 'objectives') ?? 0;
    if (mask & (1 << index)) return;
    game.setValue(GameState, 'objectives', mask | (1 << index));
    this.bump();
    bus.emit({ type: 'objective', index });
    this.dirtySave = true;
  }

  private pageFound(index: number): void {
    const game = this.state;
    const page = PAGES[index - 1];
    if (!game || !page) return;
    const mask = game.getValue(GameState, 'pages') ?? 0;
    const first = !(mask & (1 << (index - 1)));
    if (first) game.setValue(GameState, 'pages', mask | (1 << (index - 1)));
    bus.emit({ type: 'page', index, first });
    if (first && page.teaches) this.learn(page.teaches);
    if (index === 5) this.complete('outpost');
    this.bump();
    this.dirtySave = true;
  }

  learn(product: string): void {
    const game = this.state;
    const index = benchRecipeIndex(product);
    if (!game || index < 0) return;
    const known = game.getValue(GameState, 'recipes') ?? 0;
    if (known & recipeBit(index)) return;
    game.setValue(GameState, 'recipes', known | recipeBit(index));
    bus.emit({ type: 'recipe-learned', product });
  }

  /** True once the chosen journey has begun (and until the next reset). */
  get journeyBegun(): boolean {
    return this.begun;
  }

  update(delta: number): void {
    const game = this.state;
    if (!game || !this.begun || this.resetting) return;
    this.elapsed += delta;
    this.sinceBegin += delta;
    this.announceJourney();
    if (this.endingClock >= 0) this.runEnding(delta);

    this.proximityTimer += delta;
    if (this.proximityTimer > 1) {
      this.proximityTimer = 0;
      this.camera.getWorldPosition(this.viewer);
      if (Math.hypot(this.viewer.x - LANDMARKS.outpost.x, this.viewer.z - LANDMARKS.outpost.z) < 8) this.complete('outpost');
    }

    this.updateBeacon(game, delta);

    this.saveTimer += delta;
    if (this.dirtySave || this.saveTimer > AUTOSAVE_SECONDS) {
      this.saveTimer = 0;
      this.dirtySave = false;
      this.requestSave();
    }
  }

  /**
   * 'journey-start' = the player first sees the begun journey: in the browser as the
   * fade from the start panel clears, and again on the first XR entry (so the opening
   * toast lands in front of whichever view is looking). Never before 'journey-begin'.
   */
  private announceJourney(): void {
    const visibility = this.visibilityState.peek();
    if (visibility === VisibilityState.Visible && !this.xrAnnounced) {
      this.xrAnnounced = this.journeyAnnounced = true;
      bus.emit({ type: 'journey-start', resumed: this.resumed });
    } else if (!this.journeyAnnounced && visibility === VisibilityState.NonImmersive && this.sinceBegin > .8) {
      this.journeyAnnounced = true;
      bus.emit({ type: 'journey-start', resumed: this.resumed });
    }
  }

  private updateBeacon(game: Entity, delta: number): void {
    if (game.getValue(GameState, 'ended')) return;
    // The hold stands still with the world (the guardians do too) and a stalled frame never leaps it.
    const visibility = this.visibilityState.peek();
    if (visibility === VisibilityState.Hidden || visibility === VisibilityState.VisibleBlurred) return;
    const dt = Math.min(delta, .25);
    let spire: Entity | undefined;
    for (const beacon of this.queries.beacons.entities) if (beacon.getValue(Beacon, 'role') === 'spire') spire = beacon;
    if (!spire) return;
    let inBrazier = false as boolean;
    for (const entity of this.queries.heldTorches.entities) {
      if (entity.getValue(Item, 'kind') !== 'torch' || !entity.getValue(Item, 'lit')) continue;
      const object = entity.object3D;
      if (!object) continue;
      this.point.copy(TORCH_TIP);
      object.localToWorld(this.point);
      const b = LANDMARKS.beacon;
      if (Math.hypot(this.point.x - b.x, this.point.y - b.y, this.point.z - b.z) < b.radius) inBrazier = true;
    }
    const pageKnown = ((game.getValue(GameState, 'pages') ?? 0) & (1 << (FINALE.requiresPage - 1))) !== 0;
    if (inBrazier && !pageKnown) {
      if (this.elapsed - this.coldBeaconToast > 10) {
        this.coldBeaconToast = this.elapsed;
        bus.emit({ type: 'toast', tone: 'info', text: 'The beacon stays cold', body: 'Something is missing. The expedition\u2019s notes at the outpost may say what.' });
      }
      inBrazier = false;
    }
    const previous = spire.getValue(Beacon, 'progress') ?? 0;
    // Pulled out to jab at a guardian: the fill pauses for FINALE.graceSeconds before it starts to cool.
    this.sinceBrazier = inBrazier ? 0 : this.sinceBrazier + dt;
    const grace = !inBrazier && this.sinceBrazier <= FINALE.graceSeconds;
    // Registered after this system (index.ts): looked up once it exists.
    this.creatures ??= this.world.getSystem(CreatureSystem);
    const pressing = previous > 0 ? this.creatures?.pressing ?? 0 : 0;
    const setback = this.setback;
    this.setback = 0;
    const progress = Math.max(0, Math.min(1, previous + beaconRate(inBrazier, pressing, grace) * dt - setback));
    if (progress === previous) return;
    spire.setValue(Beacon, 'progress', progress);
    if (progress === 0 || progress >= 1 || Math.abs(progress - this.beaconSent) >= BEACON_EVENT_STEP) {
      this.beaconSent = progress;
      bus.emit({ type: 'beacon', progress, lit: false });
    }
    if (progress > 0 && !this.beaconAnnounced) {
      // The hold begins: the Hollow bring the dark (DayNightSystem) and the guardians rise (CreatureSystem).
      this.beaconAnnounced = true;
      bus.emit({ type: 'finale-hold', active: true });
      bus.emit({
        type: 'toast', text: 'Hold the flame steady', tone: 'warn', hold: 5,
        body: 'Keep your other hand free: the Hollow will try to smother it.',
      });
    }
    if (progress === 0 && this.beaconAnnounced) {
      this.beaconAnnounced = false;
      bus.emit({ type: 'finale-hold', active: false });
    }
    if (progress >= 1) this.finale(game, spire);
  }

  private finale(game: Entity, spire: Entity): void {
    spire.setValue(Beacon, 'lit', true);
    game.setValue(GameState, 'ended', true);
    this.complete('beacon');
    this.beaconAnnounced = false;
    bus.emit({ type: 'finale-hold', active: false });
    bus.emit({ type: 'beacon', progress: 1, lit: true });
    bus.emit({ type: 'ending' });
    bus.emit({ type: 'ending-step', step: 'spire-eye' });
    bus.emit({ type: 'ending-step', step: 'dawn' });
    this.endingClock = 0;
    this.endingSteps = 0;
    this.bump();
    this.dirtySave = true;
  }

  /**
   * The valley wakes in sequence: outpost, grove, your own campfire, the theme, distant
   * smoke (ENDING_STEPS); after the farewell, the epilogue (EPILOGUE_SECONDS).
   */
  private runEnding(delta: number): void {
    this.endingClock += delta;
    while (this.endingSteps < ENDING_STEPS.length && this.endingClock >= ENDING_STEPS[this.endingSteps][0]) {
      this.endingStep(ENDING_STEPS[this.endingSteps][1]);
      this.endingSteps++;
    }
    if (this.endingSteps >= ENDING_STEPS.length && this.endingClock >= EPILOGUE_SECONDS) {
      this.endingClock = -1;
      bus.emit({ type: 'epilogue', ...this.stats });
    }
  }

  private endingStep(step: EndingStep): void {
    switch (step) {
      case 'outpost':
      case 'grove':
        this.lightEcho(step === 'outpost' ? LANDMARKS.outpost : LANDMARKS.grove, step);
        return;
      case 'camp': {
        const fire = this.fire;
        if (fire) {
          fire.setValue(Campfire, 'fuel', 100);
          fire.setValue(Campfire, 'lit', true);
        }
        bus.emit({ type: 'ending-step', step: 'camp' });
        bus.emit({ type: 'fire-lit', x: LANDMARKS.campfire.x, y: .5, z: LANDMARKS.campfire.z });
        return;
      }
      default:
        bus.emit({ type: 'ending-step', step });
    }
  }

  private lightEcho(near: { x: number; z: number }, step: 'outpost' | 'grove'): void {
    let best: Entity | undefined, bestDistance = Infinity;
    for (const beacon of this.queries.beacons.entities) {
      if (beacon.getValue(Beacon, 'role') !== 'echo' || beacon.getValue(Beacon, 'lit') || !beacon.object3D) continue;
      const p = beacon.object3D.position;
      const d = Math.hypot(p.x - near.x, p.z - near.z);
      if (d < bestDistance) { best = beacon; bestDistance = d; }
    }
    if (best?.object3D) {
      best.setValue(Beacon, 'lit', true);
      const p = best.object3D.position;
      bus.emit({ type: 'brazier-lit', role: 'echo', x: p.x, y: p.y, z: p.z });
    }
    bus.emit({ type: 'ending-step', step });
  }

  /**
   * New journey: every piece of journey state back to the scene's authored defaults.
   * Clears the save and ItemSystem's consumed-uid ledger (it outlives level loads, so a
   * stale ledger would be written into the next save and eat the fresh level's meat on
   * the next Continue), then reloads the level, which recreates every level entity:
   * items, pack contents, bench bays, nodes, beacons, sentries, lost packs, GameState
   * (clock, stage, objectives, pages, recipes, guide) and the player rig's spawn pose.
   * Nothing may save until the next 'journey-begin'.
   */
  async resetWorld(): Promise<void> {
    this.begun = false;
    this.resetting = true;
    this.dirtySave = false;
    this.cancelSave();
    const items = this.world.getSystem(ItemSystem);
    clearSave();
    items?.consumedUids.clear();
    try {
      await this.world.loadLevel(this.world.activeLevelId);
    } finally {
      clearSave();
      items?.consumedUids.clear();
      this.resetting = false;
    }
  }

  /** A pristine world starting fresh (no reload needed): make sure nothing journey-scoped lingers. */
  freshJourney(): void {
    clearSave();
    this.world.getSystem(ItemSystem)?.consumedUids.clear();
    const game = this.state;
    if (game) game.setValue(GameState, 'guide', '');
    this.dirtySave = false;
  }

  /**
   * Where a held or flying item would come to rest: straight down on the ground (or a
   * surface) under it, in its catalog rest pose. Saves never capture an item mid-air.
   */
  private restingPose(items: ItemSystem, object: Object3D, kind: string): [number, number, number] {
    const info = itemInfo(kind);
    const x = object.position.x, z = object.position.z;
    this.restQuat.setFromAxisAngle(Y_AXIS, items.yawOf(object));
    if (info?.lie === 'side' || info?.lie === 'side-x') {
      this.restQuat.multiply(this.turnQuat.setFromAxisAngle(info.lie === 'side' ? Z_AXIS : X_AXIS, Math.PI / 2));
    }
    return [x, items.groundAt(x, z) + (info?.restY ?? .05), z];
  }

  /**
   * Save soon: one write at the next idle moment (requestIdleCallback, else a short
   * timeout), however many changes ask for it before then. Off the frame that asked.
   */
  requestSave(): void {
    if (this.pendingSave || this.resetting || !this.begun) return;
    const run = () => {
      this.pendingSave = undefined;
      this.saveNow();
    };
    const host = globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (host.requestIdleCallback && host.cancelIdleCallback) {
      const handle = host.requestIdleCallback(run, { timeout: SAVE_IDLE_TIMEOUT });
      this.pendingSave = () => host.cancelIdleCallback!(handle);
    } else {
      const handle = setTimeout(run, 50);
      this.pendingSave = () => clearTimeout(handle);
    }
  }

  /** Drop a scheduled save (a reset began, or the system is going away). */
  private cancelSave(): void {
    this.pendingSave?.();
    this.pendingSave = undefined;
  }

  /** Write the save now (normally via requestSave). */
  saveNow(): void {
    this.cancelSave();
    if (this.resetting || !this.begun) return;
    this.dirtySave = false;
    const game = this.state;
    const fire = this.fire;
    const items = this.world.getSystem(ItemSystem);
    if (!game || !items) return;
    const respawn = game.getVectorView(GameState, 'respawn');
    const saved: SavedItem[] = [];
    for (const entity of this.queries.items.entities) {
      const kind = entity.getValue(Item, 'kind') ?? '';
      const slot = entity.getValue(Item, 'slot') ?? '';
      const object = entity.object3D;
      // Forage nodes respawn their own waiting item; saving it would duplicate it.
      if (!object || slot === 'consumed' || slot === 'node' || kind === 'bolt' || kind === 'pack') continue;
      const loose = entity.hasComponent(Held) || entity.hasComponent(Airborne);
      const q = object.quaternion;
      let p: [number, number, number] = [object.position.x, object.position.y, object.position.z];
      let rest: [number, number, number, number] = [q.x, q.y, q.z, q.w];
      if (loose) {
        p = this.restingPose(items, object, kind);
        rest = [this.restQuat.x, this.restQuat.y, this.restQuat.z, this.restQuat.w];
      }
      saved.push({
        uid: entity.getValue(Item, 'uid') ?? '', kind, slot: slot === 'hand' ? '' : slot,
        variant: entity.getValue(Item, 'variant') ?? '', charges: entity.getValue(Item, 'charges') ?? 0,
        lit: kind === 'torch' ? entity.getValue(Item, 'lit') === true : false,
        p, q: rest,
      });
    }
    const nodes: SaveData['nodes'] = [];
    for (const node of this.queries.nodes.entities) {
      const id = node.object3D?.userData?.iwsdkSceneNodeId as string | undefined;
      if (id) nodes.push({ id, available: node.getValue(ResourceNode, 'available') !== false, hits: node.getValue(ResourceNode, 'hits') ?? 0 });
    }
    const beacons: SaveData['beacons'] = [];
    for (const beacon of this.queries.beacons.entities) {
      const id = beacon.object3D?.userData?.iwsdkSceneNodeId as string | undefined;
      if (id) beacons.push({ id, lit: beacon.getValue(Beacon, 'lit') === true });
    }
    const sentries: SaveData['sentries'] = [];
    for (const sentry of this.queries.sentries.entities) {
      sentries.push({ uid: sentry.getValue(Item, 'uid') ?? '', bolts: sentry.getValue(Sentry, 'bolts') ?? 0 });
    }
    writeSave({
      v: 1, savedAt: Date.now(),
      game: {
        hunger: game.getValue(GameState, 'hunger') ?? 70, health: game.getValue(GameState, 'health') ?? 100,
        clock: game.getValue(GameState, 'clock') ?? 0, day: game.getValue(GameState, 'day') ?? 1,
        stage: game.getValue(GameState, 'stage') ?? 0, objectives: game.getValue(GameState, 'objectives') ?? 0,
        pages: game.getValue(GameState, 'pages') ?? 0, recipes: game.getValue(GameState, 'recipes') ?? 0,
        respawn: [respawn[0], respawn[1], respawn[2]], ended: game.getValue(GameState, 'ended') === true,
        deaths: game.getValue(GameState, 'deaths') ?? 0, guide: game.getValue(GameState, 'guide') ?? '',
        crafted: this.crafted, slain: this.slain,
      },
      fire: {
        fuel: fire?.getValue(Campfire, 'fuel') ?? 0, lit: fire?.getValue(Campfire, 'lit') === true,
        potA: fire?.getValue(Campfire, 'potA') ?? '', potB: fire?.getValue(Campfire, 'potB') ?? '',
        stir: fire?.getValue(Campfire, 'stir') ?? 0, stew: fire?.getValue(Campfire, 'stew') ?? '',
      },
      pack: this.hooks.pack?.save() ?? null,
      items: saved, consumed: [...items.consumedUids], nodes, beacons, sentries,
    });
  }

  /**
   * Continue: write a save onto the freshly loaded (never played) level. Only StartSystem
   * calls this, and awaits it before 'journey-begin'. parseSave has validated every entry;
   * each section still applies on its own, so one that throws is logged and skipped
   * instead of stranding the rest. Runtime-made items (rt- uids) respawn asynchronously;
   * the pack is laid out once, after all of them are back.
   */
  async applySave(save: SaveData): Promise<void> {
    const game = this.state;
    const items = this.world.getSystem(ItemSystem);
    // Never begin a "resumed" journey on a pristine world: its first autosave would erase the real one.
    if (!game || !items) throw new Error('Continue: the level has no game state to restore into');
    const section = (name: string, apply: () => void) => {
      try {
        apply();
      } catch (error) {
        console.error(`[Prometheus] Continue: the saved ${name} could not be applied`, error);
      }
    };
    items.consumedUids.clear();
    section('journey', () => {
      const g = save.game;
      game.setValue(GameState, 'hunger', g.hunger);
      game.setValue(GameState, 'health', g.health);
      game.setValue(GameState, 'clock', g.clock);
      game.setValue(GameState, 'day', g.day);
      game.setValue(GameState, 'stage', g.stage);
      game.setValue(GameState, 'objectives', g.objectives);
      game.setValue(GameState, 'pages', g.pages);
      game.setValue(GameState, 'recipes', g.recipes);
      game.setValue(GameState, 'ended', g.ended === true);
      game.setValue(GameState, 'deaths', g.deaths ?? 0);
      game.setValue(GameState, 'guide', g.guide ?? '');
      const respawn = game.getVectorView(GameState, 'respawn');
      respawn[0] = g.respawn[0]; respawn[1] = g.respawn[1]; respawn[2] = g.respawn[2];
      this.crafted = g.crafted ?? 0;
      this.slain = g.slain ?? 0;
    });
    section('fire', () => {
      const fire = this.fire;
      if (!fire) return;
      // After the ending the camp fire never goes out (CampfireSystem): an older save may say otherwise.
      const ended = save.game.ended === true;
      fire.setValue(Campfire, 'fuel', ended ? Math.max(save.fire.fuel, 60) : save.fire.fuel);
      fire.setValue(Campfire, 'lit', ended || save.fire.lit);
      fire.setValue(Campfire, 'potA', save.fire.potA);
      fire.setValue(Campfire, 'potB', save.fire.potB);
      fire.setValue(Campfire, 'stir', save.fire.stir);
      fire.setValue(Campfire, 'stew', save.fire.stew);
    });
    const byUid = new Map<string, Entity>();
    for (const entity of this.queries.items.entities) byUid.set(entity.getValue(Item, 'uid') ?? '', entity);
    section('consumed items', () => {
      for (const uid of save.consumed) {
        const entity = byUid.get(uid);
        if (entity) items.consume(entity);
        else if (uid && !uid.startsWith('rt-')) items.consumedUids.add(uid);
      }
    });
    const sentryBolts = new Map(save.sentries.map((s) => [s.uid, s.bolts]));
    const level = this.world.activeLevel.peek();
    const apply = (entity: Entity, item: SavedItem) => {
      const object = entity.object3D;
      if (!object) return;
      object.position.set(item.p[0], item.p[1], item.p[2]);
      object.quaternion.set(item.q[0], item.q[1], item.q[2], item.q[3]);
      entity.setValue(Item, 'slot', item.slot);
      entity.setValue(Item, 'charges', item.charges);
      entity.setValue(Item, 'lit', item.lit);
      items.setVariant(entity, item.variant);
      if (item.kind === 'sentry-kit' && item.variant === 'deployed') this.hooks.sentry?.deploy(entity, sentryBolts.get(item.uid) ?? 0);
    };
    const spawns: Promise<void>[] = [];
    for (const item of save.items) {
      section(`item ${item.uid}`, () => {
        const existing = byUid.get(item.uid);
        if (existing) {
          apply(existing, item);
          return;
        }
        if (!item.uid.startsWith('rt-')) return;
        spawns.push(items.spawnItem(item.kind, item.p[0], item.p[1], item.p[2], { resting: false }).then((entity) => {
          if (!entity) return;
          // A reset or reload swapped the level while it loaded: it belongs to a world that is gone.
          if (this.world.activeLevel.peek() !== level) {
            items.consume(entity);
            return;
          }
          section(`item ${item.uid}`, () => {
            entity.setValue(Item, 'uid', item.uid);
            apply(entity, item);
          });
        }).catch((error: unknown) => console.error(`[Prometheus] Continue: item ${item.uid} failed to spawn`, error)));
      });
    }
    section('resource nodes', () => {
      for (const node of save.nodes) {
        const entity = this.world.getSceneEntity(node.id);
        if (!entity?.hasComponent(ResourceNode)) continue;
        entity.setValue(ResourceNode, 'available', node.available);
        entity.setValue(ResourceNode, 'hits', node.hits);
      }
    });
    section('beacons', () => {
      for (const beacon of save.beacons) {
        const entity = this.world.getSceneEntity(beacon.id);
        if (entity?.hasComponent(Beacon)) entity.setValue(Beacon, 'lit', beacon.lit);
      }
    });
    // Every respawned item is in its slot (or failed and was logged): lay the pack out once.
    await Promise.all(spawns);
    if (this.world.activeLevel.peek() !== level) return;
    section('pack', () => this.hooks.pack?.load(save.pack));
    this.bump();
  }
}
