import { createSystem, Entity, Object3D, Types, UIKitMLAsset, Vector3 } from '@iwsdk/core';
import { bus, GameEvent } from '../bus.js';
import { itemInfo } from '../catalog.js';
import { GameState, Held, Item } from '../components.js';
import { benchRecipeIndex, BENCH_RECIPES, stewName } from '../recipes.js';
import { phaseAt } from '../rules.js';
import { onSettings, settings } from '../settings.js';
import { currentObjective, ENDING, objectiveIndex, OBJECTIVES, OPENING, PAGES } from '../story.js';
import { lineById } from '../voice-lines.js';
import { BackpackSystem } from './backpack-system.js';
import { GuideSystem } from './guide-system.js';
import { Element, HIDE, plain, recipeInputs, SHOW, Style } from './journal-system.js';

type Tone = 'info' | 'good' | 'warn';

/** One notice. Messages posted in the same frame are merged into a single toast. */
type Message = {
  title: string;
  body: string;
  tone: Tone;
  /** Seconds fully visible; < 0 means "scale with length". */
  hold: number;
  /** Highest priority in a same-frame batch becomes the toast. */
  priority: number;
  /** Short phrase appended to the winner's body when this message loses a merge ('' = dropped). */
  merge: string;
  /** Event kind + subject, for merge rules ('crafted:spear', 'recipe:spear') and guide covers ('stew', 'dusk'). */
  key: string;
  /** When it was posted or queued (toast clock), for the hold while the shade speaks. */
  at: number;
};

/** A toast a guide line says first (covers) or must follow (defers), parked on that line. */
type Parked = { message: Message; line: string; defer: boolean; at: number };

type Slot = {
  asset: UIKitMLAsset;
  entity: Entity;
  root: Element;
  title: Element;
  body: Element;
  icons: Record<Tone, Element>;
  active: boolean;
  age: number;
  hold: number;
  /** Estimated world height (m), for stacking. */
  height: number;
  /** World height of the stack's bottom edge. */
  baseY: number;
  /** Height of this toast's bottom edge above the stack base (m); eases toward `target`. */
  offset: number;
  target: number;
  opacityStep: number;
  tone: Tone | '';
  bodyShown: boolean;
  title_: string;
  body_: string;
};

const POOL = 3;
const NEAR_DISTANCE = 1.4;
const NEAR_DROP = 0.15;
/** While walking (> 0.8 m/s) toasts go a little further out and ~10 degrees above the eyes, out of the path. */
const MOVING_SPEED = 0.8;
const FAR_DISTANCE = 1.6;
const FAR_RISE = Math.tan((10 * Math.PI) / 180) * FAR_DISTANCE;
const STACK_GAP = 0.012;
const FADE_IN = 0.25;
const FADE_OUT = 0.6;
const HOLD_BASE = 3;
const HOLD_PER_CHAR = 0.05;
const HOLD_MAX = 9;
/** Minimum gap between two toasts appearing, so separate actions read as a sequence. */
const STAGGER = 0.45;
const QUEUE_CAP = 6;
const DEDUPE_SECONDS = 5;
/** Hide a toast when the head comes this close (m). */
const HIDE_NEAR = 0.7;
const IDLE_SECONDS = 90;
const IDLE_REPEAT = 180;
/** Toasts wait while the shade speaks, but never longer than this (s). */
const SPEECH_HOLD_MAX = 16;
/** A toast parked on a guide line that still has not spoken after this long (s) shows anyway. */
const PARK_MAX = 20;
/** A situational hint (bus 'toast') that waited this long (s) in the queue is stale: dropped. */
const HINT_STALE = 12;

/* Guide subtitles (bus 'guide'): their own panel, below the toast stack, never pooled with toasts. */
const DEG = Math.PI / 180;
/**
 * The subtitle hangs SUB_DISTANCE m out along a ray from the eye, facing it (pitched,
 * not only yawed, so a lowered gaze never sees it edge-on): SUB_BELOW under a level
 * gaze (about 0.35 m down, clear of the fire, which lies 22-40 degrees down from the
 * camp), leaning SUB_SIDE toward the shade. Once the gaze drops below SUB_DOWN_ON (at
 * the flames, the pot, the hands) it moves SUB_ABOVE over the gaze instead, never above
 * the horizon (SUB_ABOVE_MAX, where the toasts sit): over what is being looked at, never
 * on it, never on the ground. Back under the gaze above SUB_DOWN_OFF (hysteresis).
 */
const SUB_DISTANCE = 1.3;
const SUB_BELOW = 15 * DEG;
const SUB_ABOVE = 16 * DEG;
const SUB_ABOVE_MAX = 0;
const SUB_DOWN_ON = -10 * DEG;
const SUB_DOWN_OFF = -5 * DEG;
const SUB_SIDE = 12 * DEG;
const SUB_FADE_IN = 0.3;
const SUB_FADE_OUT = 0.6;
/** Lazy follow: re-centre when the wanted spot moves this far off (rad) or the head moves this far (m). */
const SUB_FOLLOW_ANGLE = 12 * DEG;
const SUB_FOLLOW_MOVE = 0.3;
/**
 * Drawn over the world (no depth test, after the toasts): a held thing nearer than the
 * panel inside this cone around it (a bowl at the lips, a page, a torch raised) fades the
 * words to SUB_HELD_FADE rather than painting over it.
 */
const SUB_HELD_CONE = Math.cos(14 * DEG);
const SUB_HELD_FADE = 0.35;
const SUB_ROOT_SETUP: Style = { depthTest: false, renderOrder: 21 };

const OPACITY_STEPS = 10;
const OPACITY: readonly Style[] = Array.from({ length: OPACITY_STEPS + 1 }, (_, i) => ({ opacity: i / OPACITY_STEPS }));
const BORDER: Record<Tone, Style> = {
  good: { borderColor: '#9fb87a' },
  info: { borderColor: '#d4b180' },
  warn: { borderColor: '#d9714a' },
};
const TONES: readonly Tone[] = ['good', 'info', 'warn'];
const ROOT_SETUP: Style = { depthTest: false, renderOrder: 20 };

const SLEEP = objectiveIndex('sleep');
const OBJ_TITLE = OBJECTIVES.map((o) => plain(o.title));
const OBJ_HINT = OBJECTIVES.map((o) => plain(o.hint));
const PAGE_TITLE = PAGES.map((p) => plain(p.title));
const STAGE_BODY = [
  '',
  'A carried flame. They\'ve noticed. Stay in the light after dark.',
  'Every new thing you make draws more. Several will come tonight.',
  'They gather in numbers now. Let the sentry keep watch.',
];

function productLabel(product: string): string {
  const index = benchRecipeIndex(product);
  return index >= 0 ? BENCH_RECIPES[index].label : itemInfo(product)?.label ?? product;
}

export const toastHold = (title: string, body: string) =>
  Math.min(HOLD_MAX, HOLD_BASE + HOLD_PER_CHAR * (title.length + body.length));

/** Rough rendered height (world metres) of the 60-unit toast at `scale` (title 3.1, body 2.9 units). */
function estimateHeight(title: string, body: string, scale: number): number {
  const titleLines = Math.max(1, Math.ceil(title.length / 28));
  const bodyLines = body ? Math.ceil(body.length / 33) : 0;
  const units = Math.max(11.2, 4.8 + 3.9 * titleLines + (bodyLines ? 0.4 + 4.1 * bodyLines : 0));
  return (units * scale) / 100;
}

/**
 * World-space notices. A pool of 3 panels spawned in front of the camera (1.4 m ahead,
 * eye height -0.15 m; 1.6 m ahead and ~10 degrees up while walking), yawed to face it and
 * then left in place (never head-locked). Rules:
 * - at most one toast per action: everything posted in one frame is merged into the
 *   highest-priority message ("Objective complete" carries "Next:" as its body line);
 * - hold = 3 s + 0.05 s per character (max 9 s) unless the event sets `hold`;
 * - queued while a page is held (the reader is open) and while the view is faded to
 *   black (sleep, death); a toast hides when the head comes within 0.7 m;
 * - "The Hollow stir" waits for dusk when earned by day;
 * - the shade owns first times: a toast a waiting or speaking guide line `covers` is
 *   parked on it and dropped once the line speaks (shown after all if the line is
 *   dropped, or has not spoken within 20 s); one it `defers` shows after the line;
 * - toasts wait while the shade speaks (at most 16 s), and each shown toast tells the
 *   GuideSystem how long it stays up, so a due line lets it be read first; the
 *   farewell clears the air entirely;
 * - after 90 s without objective progress or a grab, the current objective's hint is
 *   re-shown (at most every 3 min).
 * Guide subtitles (bus 'guide', the shade's voice) use their own panel: ember-gold serif,
 * a flame glyph, 80% opaque, text about 1 degree tall; 1.3 m out along the view, facing
 * the eye, 15 degrees under a level gaze and leaning 12 degrees toward the shade (under
 * the toast stack, clear of the fire), and 16 degrees over a gaze lowered past 10 degrees
 * (over the flames or the pot being looked at, never on it); shown for the line's
 * `seconds` with its subtitle-only control `hint` on a second line, lazily following the
 * view, fading to 35% behind a held thing, and never queued behind, merged with or hidden
 * by ordinary toasts. A newer line replaces it; a line cut short ('guide-end' with `cut`,
 * including a line gone stale) fades it at once. Settings: subtitles off hides it.
 */
export class ToastSystem extends createSystem({
  game: { required: [GameState] },
  held: { required: [Item, Held] },
}, {
  /** World scale of the 60-unit-wide panel (0.8 -> 48 cm; body text ~0.95 degrees at 1.4 m). */
  scale: { type: Types.Float32, default: 0.8 },
  /** World scale of the 64-unit-wide guide subtitle (0.72 -> 46 cm at 1.3 m; 3.3-unit text ~1 degree). */
  subtitleScale: { type: Types.Float32, default: 0.72 },
}) {
  private slots: Slot[] = [];
  private pending: Message[] = [];
  private queue: Message[] = [];
  private parked: Parked[] = [];
  private guide?: GuideSystem;
  private recent: { title: string; at: number }[] = [];
  private now = 0;
  private cooldown = 0;
  private anchor = new Vector3();
  private anchorYaw = 0;
  private anchorAt = -100;
  private eye = new Vector3();
  private lastEye = new Vector3();
  private look = new Vector3();
  private spot = new Vector3();
  private speed = 0;
  private hasLastEye = false;
  private reading = 0;
  /** Queue is held until this time (fades); Infinity while dead. */
  private blockedUntil = 0;
  private started = false;
  private lastActivity = 0;
  private lastResurface = -1000;
  private idleTimer = 0;
  private stagePending = 0;
  private disposed = false;

  private sub?: { asset: UIKitMLAsset; entity: Entity; root: Element; text: Element; hint?: Element };
  /** 1 while the subtitle sits over a lowered gaze, 0 under a level one. */
  private subMode = 0;
  private subSide = 0;
  private subAnchorMode = 0;
  private subAnchorSide = 0;
  /** Held-item fade multiplier (1 clear, SUB_HELD_FADE behind a held thing), eased. */
  private subVeil = 1;
  private readonly subDir = new Vector3();
  private readonly subTmp = new Vector3();
  private subText = '';
  private subHint = '';
  private subHintShown = true;
  private subAge = 0;
  private subHold = 0;
  private subActive = false;
  private subPending: { text: string; seconds: number; hint: string } | null = null;
  private subOpacity = -1;
  private subTarget = new Vector3();
  private subAnchorEye = new Vector3();

  init(): void {
    this.cleanupFuncs.push(
      bus.onAny((event) => this.onEvent(event)),
      this.queries.held.subscribe('qualify', (entity) => {
        if (entity.getValue(Item, 'kind') !== 'page') return;
        this.reading++;
        // Never draw over the page being read: clear the air, show the rest on release.
        for (let i = 0; i < this.slots.length; i++) this.hide(this.slots[i]);
      }, true),
      this.queries.held.subscribe('disqualify', (entity) => {
        if (entity.getValue(Item, 'kind') === 'page') this.reading = Math.max(0, this.reading - 1);
      }),
      // Subtitles turned off in the journal's comfort settings: the words go at once (the voice still plays).
      onSettings((next) => { if (!next.subtitles) this.hideSubtitle(); }),
      () => {
        this.disposed = true;
        for (const slot of this.slots) slot.entity.dispose({ disposeResources: false });
        this.slots.length = 0;
        this.sub?.entity.dispose({ disposeResources: false });
        this.sub = undefined;
      },
    );
    void this.world.assets.instantiate<UIKitMLAsset>('subtitle').then((asset) => {
      if (this.disposed) { asset.dispose(); return; }
      this.addSubtitle(asset);
    }).catch((error: unknown) => console.warn('[Prometheus UI] subtitle failed to load', error));
    for (let i = 0; i < POOL; i++) {
      void this.world.assets.instantiate<UIKitMLAsset>('toast').then((asset) => {
        if (this.disposed) { asset.dispose(); return; }
        this.addSlot(asset);
      }).catch((error: unknown) => console.warn('[Prometheus UI] toast failed to load', error));
    }
  }

  private addSlot(asset: UIKitMLAsset): void {
    const find = (id: string) => asset.getElementById<Element>(id);
    const root = find('ts-root');
    const title = find('ts-title');
    const body = find('ts-body');
    const good = find('ts-ic-good');
    const info = find('ts-ic-info');
    const warn = find('ts-ic-warn');
    if (!root || !title || !body || !good || !info || !warn) {
      console.warn('[Prometheus UI] toast.uikitml is missing an element id');
      return;
    }
    asset.pointerEvents = 'none';
    root.setProperties(ROOT_SETUP);
    const entity = this.world.createTransformEntity(asset, { persistent: true });
    entity.object3D!.visible = false;
    asset.scale.setScalar(this.config.scale.peek());
    this.slots.push({
      asset, entity, root, title, body, icons: { good, info, warn },
      active: false, age: 0, hold: HOLD_BASE, height: 0.1, baseY: 0, offset: 0, target: 0, opacityStep: -1,
      tone: '', bodyShown: true, title_: '', body_: '',
    });
  }

  /** The subtitle hangs in a world-placed holder (position, facing the eye) -> UIKit asset (scale). */
  private addSubtitle(asset: UIKitMLAsset): void {
    const root = asset.getElementById<Element>('sb-root');
    const text = asset.getElementById<Element>('sb-text');
    const hint = asset.getElementById<Element>('sb-hint') ?? undefined;
    if (!root || !text) {
      console.warn('[Prometheus UI] subtitle.uikitml is missing an element id');
      return;
    }
    asset.pointerEvents = 'none';
    root.setProperties(SUB_ROOT_SETUP);
    asset.scale.setScalar(this.config.subtitleScale.peek());
    const holder = new Object3D();
    holder.name = 'Guide Subtitle';
    holder.add(asset);
    holder.visible = false;
    const entity = this.world.createTransformEntity(holder, { persistent: true });
    this.sub = { asset, entity, root, text, hint };
    if (this.subPending) {
      const { text: line, seconds, hint: note } = this.subPending;
      this.subPending = null;
      this.speak(line, seconds, note);
    }
  }

  /** Show the shade's line for `seconds`, its control hint below (a newer line replaces the current one). */
  private speak(line: string, seconds: number, hint = ''): void {
    const text = plain(line).trim();
    if (!text || !settings.subtitles) return;
    const note = plain(hint).trim();
    const sub = this.sub;
    if (!sub) {
      this.subPending = { text, seconds, hint: note };
      return;
    }
    if (text !== this.subText) {
      this.subText = text;
      sub.text.setProperties({ text });
    }
    if (sub.hint) {
      if (note && note !== this.subHint) {
        this.subHint = note;
        sub.hint.setProperties({ text: note });
      }
      if (!!note !== this.subHintShown) {
        this.subHintShown = !!note;
        sub.hint.setProperties(note ? SHOW : HIDE);
      }
    }
    const wasActive = this.subActive;
    this.subActive = true;
    this.subHold = Math.max(1.5, seconds);
    this.subAge = wasActive ? Math.min(this.subAge, SUB_FADE_IN) : 0;
    this.subOpacity = -1;
    this.subtitleTarget(this.subTarget);
    const object = sub.entity.object3D!;
    if (!wasActive) {
      object.position.copy(this.subTarget);
      this.subVeil = 1;
    }
    object.lookAt(this.eye);
    object.visible = true;
  }

  private hideSubtitle(): void {
    this.subActive = false;
    this.subPending = null;
    if (this.sub) this.sub.entity.object3D!.visible = false;
  }

  /**
   * The unit direction (from the eye) the subtitle belongs in for the current view:
   * under a level gaze or over a lowered one (hysteresis), leaning toward the shade.
   * Reads this.eye/this.look (fresh camera pose); updates subMode and subSide.
   */
  private subtitleDirection(out: Vector3): Vector3 {
    const pitch = Math.asin(Math.max(-1, Math.min(1, this.look.y)));
    if (this.subMode === 0 && pitch < SUB_DOWN_ON) this.subMode = 1;
    else if (this.subMode === 1 && pitch > SUB_DOWN_OFF) this.subMode = 0;
    const want = this.subMode ? Math.min(SUB_ABOVE_MAX, pitch + SUB_ABOVE) : Math.min(60 * DEG, pitch - SUB_BELOW);
    this.subSide = this.guideSystem()?.shadeSide ?? 0;
    // Yaw of the view (+Z = 0); turning right lowers it.
    const yaw = Math.atan2(this.look.x, this.look.z) - this.subSide * SUB_SIDE;
    const c = Math.cos(want);
    return out.set(Math.sin(yaw) * c, Math.sin(want), Math.cos(yaw) * c);
  }

  /** Where the subtitle belongs for the current view: SUB_DISTANCE m out along subtitleDirection. */
  private subtitleTarget(out: Vector3): void {
    this.camera.getWorldPosition(this.eye);
    this.camera.getWorldDirection(this.look);
    this.subtitleDirection(this.subDir);
    out.copy(this.eye).addScaledVector(this.subDir, SUB_DISTANCE);
    this.subAnchorEye.copy(this.eye);
    this.subAnchorMode = this.subMode;
    this.subAnchorSide = this.subSide;
  }

  /** 1, or SUB_HELD_FADE while a held thing sits between the eye and the words. */
  private heldVeil(object: Object3D): number {
    const toX = object.position.x - this.eye.x, toY = object.position.y - this.eye.y, toZ = object.position.z - this.eye.z;
    const toLength = Math.hypot(toX, toY, toZ) || 1;
    for (const entity of this.queries.held.entities) {
      const held = entity.object3D;
      if (!held) continue;
      held.getWorldPosition(this.subTmp);
      const hx = this.subTmp.x - this.eye.x, hy = this.subTmp.y - this.eye.y, hz = this.subTmp.z - this.eye.z;
      const hLength = Math.hypot(hx, hy, hz);
      if (hLength < 0.05 || hLength > toLength) continue;
      if ((hx * toX + hy * toY + hz * toZ) / (hLength * toLength) > SUB_HELD_CONE) return SUB_HELD_FADE;
    }
    return 1;
  }

  private updateSubtitle(delta: number): void {
    const sub = this.sub;
    if (!sub || !this.subActive) return;
    this.subAge += delta;
    const life = SUB_FADE_IN + this.subHold + SUB_FADE_OUT;
    if (this.subAge >= life) {
      this.hideSubtitle();
      return;
    }
    const object = sub.entity.object3D!;
    // Lazy follow: stay put while the player glances about; glide to the new spot after a real turn,
    // a walk, a lowered (or raised) gaze, or the shade changing sides.
    this.camera.getWorldPosition(this.eye);
    this.camera.getWorldDirection(this.look);
    const dir = this.subtitleDirection(this.subDir);
    this.subTmp.copy(this.subTarget).sub(this.subAnchorEye).normalize();
    if (dir.dot(this.subTmp) < Math.cos(SUB_FOLLOW_ANGLE) || this.eye.distanceTo(this.subAnchorEye) > SUB_FOLLOW_MOVE
      || this.subMode !== this.subAnchorMode || this.subSide !== this.subAnchorSide) {
      this.subtitleTarget(this.subTarget);
    }
    const k = Math.min(1, delta * 5);
    object.position.lerp(this.subTarget, k);
    object.lookAt(this.eye);
    this.subVeil += (this.heldVeil(object) - this.subVeil) * Math.min(1, delta * 6);
    const alpha = this.subVeil * (this.subAge < SUB_FADE_IN ? this.subAge / SUB_FADE_IN
      : this.subAge < SUB_FADE_IN + this.subHold ? 1 : 1 - (this.subAge - SUB_FADE_IN - this.subHold) / SUB_FADE_OUT);
    const step = Math.max(0, Math.min(OPACITY_STEPS, Math.round(alpha * OPACITY_STEPS)));
    if (step !== this.subOpacity) {
      this.subOpacity = step;
      sub.root.setProperties(OPACITY[step]);
    }
  }

  /**
   * Public entry for other systems. `hold` < 0 scales with length. Messages posted in
   * the same frame merge into one toast.
   */
  show(title: string, body = '', tone: Tone = 'info', hold = -1, priority = 4): void {
    this.post(title, body, tone, hold, priority, plain(title), '');
  }

  private post(title: string, body: string, tone: Tone, hold: number, priority: number, merge: string, key: string): void {
    this.pending.push({ title: plain(title), body: plain(body), tone, hold, priority, merge: plain(merge), key, at: this.now });
  }

  private guideSystem(): GuideSystem | undefined {
    return this.guide ??= this.world.getSystem(GuideSystem);
  }

  private get game(): Entity | undefined {
    return this.queries.game.entities.values().next().value as Entity | undefined;
  }

  /** Current objective with the day rule (sleep waits for the night), or -1. */
  private objectiveNow(extraMask = 0): number {
    const game = this.game;
    if (!game || game.getValue(GameState, 'ended')) return -1;
    const mask = (game.getValue(GameState, 'objectives') ?? 0) | extraMask;
    return currentObjective(mask, phaseAt(game.getValue(GameState, 'clock') ?? 0));
  }

  private onEvent(event: GameEvent): void {
    switch (event.type) {
      case 'journey-start': {
        // Each announcement (desktop, then the first XR entry) lands in front of the camera of that moment.
        this.started = true;
        this.lastActivity = this.now;
        for (let i = 0; i < this.slots.length; i++) this.hide(this.slots[i]);
        this.queue.length = 0;
        this.recent.length = 0;
        if (!event.resumed) {
          // Title only: the start panel told the hook, and the shade's first words (which
          // cover this toast) give the first task.
          this.post(OPENING.title, '', 'info', 3.5, 10, '', 'opening');
        } else {
          const now = this.objectiveNow();
          this.post('Welcome back', now >= 0 ? `${OBJ_TITLE[now]}. ${OBJ_HINT[now]}` : plain(ENDING.rest), 'info', -1, 10, '', 'opening');
        }
        return;
      }
      case 'grab':
        this.lastActivity = this.now;
        return;
      case 'page': {
        if (!event.first) return;
        const title = PAGE_TITLE[event.index - 1];
        this.post(`Page ${event.index} of ${PAGES.length}${title ? `: ${title}` : ''}`, '', 'info', -1, 6,
          `Page ${event.index} found`, 'page');
        return;
      }
      case 'recipe-learned': {
        const index = benchRecipeIndex(event.product);
        const label = productLabel(event.product);
        this.post(`Recipe learned: ${label}`, index >= 0 ? `Bench: ${recipeInputs(BENCH_RECIPES[index].inputs)}` : '',
          'good', -1, 5, index >= 0 ? `Recipe: ${label} (${recipeInputs(BENCH_RECIPES[index].inputs)})` : `Recipe: ${label}`,
          `recipe:${event.product}`);
        return;
      }
      case 'objective': {
        this.lastActivity = this.now;
        const title = OBJ_TITLE[event.index];
        // The finale speaks for itself (flash, then the ending-step toasts).
        if (!title || this.game?.getValue(GameState, 'ended')) return;
        const next = this.objectiveNow(1 << event.index);
        this.post(title, next >= 0 ? `Next: ${OBJ_TITLE[next]}` : '', 'good', -1, 6, `${title}: done`, 'objective');
        return;
      }
      case 'crafted':
        this.post(`Crafted: ${productLabel(event.product)}`, event.learned ? 'New recipe added to your journal.' : '',
          'good', -1, 3, '', `crafted:${event.product}`);
        return;
      case 'well-fed':
        // Merges into the stew's own toast (SurvivalSystem) when it already says so; shown alone otherwise.
        if (event.seconds > 0) {
          this.post('Well fed', `For ${Math.round(event.seconds)} s you mend as you go, and hunger comes slower.`, 'good', -1, 3,
            'Well fed', 'well-fed');
        }
        return;
      case 'stew-ready':
        this.post(`${stewName(event.recipe)} is ready`, 'Dip the bowl, then bring it to your mouth.', 'good', -1, 3, '', 'stew');
        return;
      case 'fire-out':
        this.post('The campfire has gone out', 'Feed it wood and relight it with the lighter.', 'warn', -1, 4,
          'The campfire went out', 'fire-out');
        return;
      case 'sleep':
        // Shown as the view fades back in.
        this.blockedUntil = this.now + 2.1;
        if (event.cold) this.post(`Day ${event.day}`, 'You slept by cold ashes and woke weak and hungry. Relight the fire. Journey saved.', 'warn', -1, 7, '', 'sleep');
        else this.post(`Day ${event.day}`, 'You slept by the fire. If you fall, you\'ll wake here. Journey saved.', 'good', -1, 7, '', 'sleep');
        return;
      case 'death':
        // The screen fades to black; the respawn toast carries the news.
        this.blockedUntil = this.now + 20; // released early by 'respawn'
        this.queue.length = 0;
        this.pending.length = 0;
        this.parked.length = 0;
        for (let i = 0; i < this.slots.length; i++) this.hide(this.slots[i]);
        return;
      case 'respawn':
        this.blockedUntil = this.now + 0.9;
        this.post('You wake by the fire', this.world.getSystem(BackpackSystem)?.lost
          ? 'It kept you. Your pack lies where you fell.' : 'It kept you. Rest by the fire to heal.', 'info', -1, 7, '', 'respawn');
        return;
      case 'stage': {
        if (event.stage <= 0) { this.stagePending = 0; return; }
        const game = this.game;
        const phase = game ? phaseAt(game.getValue(GameState, 'clock') ?? 0) : 'night';
        if (phase === 'day') this.stagePending = Math.max(this.stagePending, event.stage);
        else this.postStage(event.stage);
        return;
      }
      case 'phase':
        if (event.phase !== 'dusk') return;
        if (this.stagePending > 0) {
          this.postStage(this.stagePending);
          this.stagePending = 0;
        } else if (this.game && !this.game.getValue(GameState, 'ended')
          && !((this.game.getValue(GameState, 'objectives') ?? 0) & (1 << SLEEP))) {
          this.post('Night is falling', 'Stay in the firelight. Keep it fed, and sleep at the bedroll late in the night.', 'info', -1, 4, '', 'dusk');
        }
        return;
      case 'ending-step':
        // The smoke is the shade's to point out (the farewell); no toast on top of it.
        if (event.step === 'theme') this.post(ENDING.title, ENDING.toast, 'good', 8, 9, '', 'ending');
        return;
      case 'toast':
        this.post(event.text, event.body ?? '', event.tone, event.hold ?? -1, 4, event.text, 'toast');
        return;
      case 'guide':
        this.speak(event.text, event.seconds, event.hint);
        // The farewell stands alone: nothing else on screen while he says goodbye.
        if (lineById(event.id)?.finale) for (let i = 0; i < this.slots.length; i++) this.hide(this.slots[i]);
        return;
      case 'guide-end':
        // Cut short (a wolf, a fade): the words fade out with the voice.
        if (event.cut && this.subActive) this.subHold = Math.min(this.subHold, Math.max(0, this.subAge - SUB_FADE_IN));
        return;
      case 'new-game':
        this.hideSubtitle();
        this.queue.length = 0;
        this.pending.length = 0;
        this.parked.length = 0;
        this.recent.length = 0;
        this.blockedUntil = 0;
        this.stagePending = 0;
        this.started = false;
        for (const slot of this.slots) this.hide(slot);
        return;
      default:
    }
  }

  private postStage(stage: number): void {
    this.post('The Hollow stir...', STAGE_BODY[Math.min(stage, 3)], 'warn', -1, 5, 'The Hollow stir', 'stage');
  }

  /** Merge everything posted since the last update into one queued toast. */
  private flush(): void {
    const batch = this.pending;
    if (batch.length === 0) return;
    // The shade says it first: park covered (and deferred) toasts on their guide line.
    const guide = this.guideSystem();
    if (guide) {
      for (let i = batch.length - 1; i >= 0; i--) {
        const m = batch[i];
        const cover = guide.coverFor(m.title, m.body, m.key);
        if (!cover) continue;
        this.parked.push({ message: m, line: cover.id, defer: cover.defer, at: this.now });
        batch.splice(i, 1);
      }
      if (batch.length === 0) return;
    }
    // A craft that teaches its recipe says so in its own body.
    for (const m of batch) {
      if (!m.key.startsWith('crafted:')) continue;
      const product = m.key.slice(8);
      for (const other of batch) if (other.key === `recipe:${product}`) other.priority = -1;
    }
    let main: Message | undefined;
    for (const m of batch) if (m.priority >= 0 && (!main || m.priority > main.priority)) main = m;
    if (main) {
      // Up to two losers ride along as short phrases, most important first.
      const extras = batch.filter((m) => m !== main && m.priority >= 0 && m.merge && m.title !== main!.title)
        .sort((a, b) => b.priority - a.priority);
      let body = main.body;
      let added = 0;
      for (const m of extras) {
        if (added >= 2 || body.includes(m.merge) || main.title.includes(m.merge)) continue;
        const phrase = `${m.merge.replace(/[.!?]+$/, '')}.`;
        body = body ? `${body}${/[.!?]$/.test(body) ? ' ' : '. '}${phrase}` : phrase;
        added++;
      }
      this.enqueue(main.title, body, main.tone, main.hold, main.priority, main.key);
    }
    batch.length = 0;
  }

  private enqueue(title: string, body: string, tone: Tone, hold: number, priority: number, key = ''): void {
    if (priority < 9) {
      for (const r of this.recent) if (r.title === title && this.now - r.at < DEDUPE_SECONDS) return;
      for (const q of this.queue) if (q.title === title) return;
    }
    if (this.recent.length >= 12) this.recent.shift();
    this.recent.push({ title, at: this.now });
    if (this.queue.length >= QUEUE_CAP) this.queue.shift();
    this.queue.push({ title, body, tone, hold: hold > 0 ? hold : toastHold(title, body), priority, merge: '', key, at: this.now });
  }

  /** Settle toasts parked on guide lines: drop the ones the shade said, show the rest. */
  private updateParked(): void {
    const parked = this.parked;
    if (parked.length === 0) return;
    const guide = this.guideSystem();
    for (let i = parked.length - 1; i >= 0; i--) {
      const p = parked[i];
      const status = guide ? guide.lineStatus(p.line) : 'dropped';
      let show = false, drop = false;
      if (status === 'waiting') {
        if (this.now - p.at > PARK_MAX) {
          // The line is stuck (a fight, a page): the toast carries it instead.
          show = true;
          if (!p.defer) guide?.withdraw(p.line);
        }
      } else if (status === 'speaking') {
        drop = !p.defer;
      } else if (status === 'spoken') {
        show = p.defer;
        drop = !p.defer;
      } else if (status === 'stale') {
        // The line's moment passed (the set was struck, the player walked off): so did the toast's.
        show = p.defer;
        drop = !p.defer;
      } else {
        show = true; // dropped unheard: the toast still has to say it
      }
      if (show) this.enqueue(p.message.title, p.message.body, p.message.tone, p.message.hold, p.message.priority, p.message.key);
      if (show || drop) parked.splice(i, 1);
    }
  }

  private hide(slot: Slot): void {
    slot.active = false;
    slot.entity.object3D!.visible = false;
  }

  private spawn(message: Message): void {
    let slot: Slot | undefined;
    for (const s of this.slots) if (!s.active) { slot = s; break; }
    if (!slot) {
      slot = this.slots[0];
      for (const s of this.slots) if (s.age > slot.age) slot = s;
      this.hide(slot);
    }

    // Anchor on the horizontal view direction: near and below the eyes, or further and above while walking.
    const moving = this.speed > MOVING_SPEED;
    const distance = moving ? FAR_DISTANCE : NEAR_DISTANCE;
    this.camera.getWorldPosition(this.eye);
    this.camera.getWorldDirection(this.look);
    this.look.y = 0;
    if (this.look.lengthSq() < 1e-6) this.look.set(0, 0, -1);
    this.look.normalize();
    this.spot.copy(this.eye).addScaledVector(this.look, distance);
    this.spot.y = moving ? this.eye.y + FAR_RISE : this.eye.y - NEAR_DROP;

    const height = estimateHeight(message.title, message.body, this.config.scale.peek());
    let stacking = false;
    for (const s of this.slots) if (s.active && s !== slot) stacking = true;
    if (stacking && this.now - this.anchorAt < HOLD_MAX && this.anchor.distanceTo(this.spot) < 0.6) {
      // The newest toast takes the bottom of the stack; live ones rise by its height.
      for (const s of this.slots) if (s.active && s !== slot) s.target += height + STACK_GAP;
    } else {
      this.anchor.copy(this.spot);
      this.anchor.y -= height / 2;
      this.anchorYaw = Math.atan2(this.eye.x - this.spot.x, this.eye.z - this.spot.z);
    }
    this.anchorAt = this.now;

    if (slot.title_ !== message.title) {
      slot.title_ = message.title;
      slot.title.setProperties({ text: message.title });
    }
    const hasBody = message.body.length > 0;
    if (hasBody && slot.body_ !== message.body) {
      slot.body_ = message.body;
      slot.body.setProperties({ text: message.body });
    }
    if (hasBody !== slot.bodyShown) {
      slot.bodyShown = hasBody;
      slot.body.setProperties(hasBody ? SHOW : HIDE);
    }
    if (slot.tone !== message.tone) {
      slot.tone = message.tone;
      for (const tone of TONES) slot.icons[tone].setProperties(tone === message.tone ? SHOW : HIDE);
      slot.root.setProperties(BORDER[message.tone]);
    }
    slot.active = true;
    slot.age = 0;
    slot.hold = message.hold;
    this.guideSystem()?.noteToast(FADE_IN + message.hold);
    slot.height = height;
    slot.offset = slot.target = 0;
    slot.baseY = this.anchor.y;
    slot.opacityStep = -1;
    const object = slot.entity.object3D!;
    object.position.set(this.anchor.x, this.anchor.y + height / 2, this.anchor.z);
    object.rotation.set(0, this.anchorYaw, 0);
    object.visible = true;
  }

  update(delta: number): void {
    this.now += delta;
    this.cooldown -= delta;

    // Smoothed walking speed from the head's horizontal motion (teleports are clamped).
    this.camera.getWorldPosition(this.eye);
    if (this.hasLastEye && delta > 0) {
      const dx = this.eye.x - this.lastEye.x;
      const dz = this.eye.z - this.lastEye.z;
      const v = Math.min(6, Math.sqrt(dx * dx + dz * dz) / delta);
      this.speed += (v - this.speed) * Math.min(1, delta * 4);
    }
    this.lastEye.copy(this.eye);
    this.hasLastEye = true;

    this.flush();
    this.updateParked();
    this.idleCheck(delta);
    this.updateSubtitle(delta);
    // Never over the shade's words: wait while he speaks (bounded, in case a line stalls).
    const head = this.queue[0];
    const speaking = !!head && this.guideSystem()?.speaking === true && this.now - head.at < SPEECH_HOLD_MAX;
    const blocked = this.reading > 0 || this.now < this.blockedUntil || speaking;
    // Situational hints held behind a long line or a page go stale ("strike the pad" after the craft).
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].key === 'toast' && this.now - this.queue[i].at > HINT_STALE) this.queue.splice(i, 1);
    }
    if (!blocked && this.queue.length > 0 && this.cooldown <= 0 && this.slots.length > 0) {
      this.spawn(this.queue.shift()!);
      this.cooldown = STAGGER;
    }

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot.active) continue;
      slot.age += delta;
      const life = FADE_IN + slot.hold + FADE_OUT;
      const object = slot.entity.object3D!;
      if (slot.age >= life || object.position.distanceToSquared(this.eye) < HIDE_NEAR * HIDE_NEAR) {
        this.hide(slot);
        continue;
      }
      if (slot.offset !== slot.target) {
        slot.offset += (slot.target - slot.offset) * Math.min(1, delta * 10);
        if (Math.abs(slot.target - slot.offset) < 0.001) slot.offset = slot.target;
        object.position.y = slot.baseY + slot.offset + slot.height / 2;
      }
      const alpha = slot.age < FADE_IN ? slot.age / FADE_IN
        : slot.age < FADE_IN + slot.hold ? 1 : 1 - (slot.age - FADE_IN - slot.hold) / FADE_OUT;
      const step = Math.max(0, Math.min(OPACITY_STEPS, Math.round(alpha * OPACITY_STEPS)));
      if (step !== slot.opacityStep) {
        slot.opacityStep = step;
        slot.root.setProperties(OPACITY[step]);
      }
    }
  }

  /** Re-surface the current objective's hint after 90 s without progress or a grab. */
  private idleCheck(delta: number): void {
    this.idleTimer += delta;
    if (this.idleTimer < 1) return;
    this.idleTimer = 0;
    if (!this.started || this.reading > 0 || this.now < this.blockedUntil) return;
    if (this.now - this.lastActivity < IDLE_SECONDS || this.now - this.lastResurface < IDLE_REPEAT) return;
    const now = this.objectiveNow();
    if (now < 0) return;
    this.lastResurface = this.now;
    this.lastActivity = this.now;
    this.enqueue(`Now: ${OBJ_TITLE[now]}`, OBJ_HINT[now], 'info', -1, 2);
  }
}
