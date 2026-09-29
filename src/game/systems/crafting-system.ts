import { createSystem, Entity, Vector3, VisibilityState } from '@iwsdk/core';
import { bus } from '../bus.js';
import { itemInfo } from '../catalog.js';
import { CraftBench, GameState, Held, Item } from '../components.js';
import { pulse } from '../haptics.js';
import { BENCH_RECIPES, BOLTS_PER_BUNDLE, matchBench, recipeBit } from '../recipes.js';
import { benchBayAt, CAMP } from '../rules.js';
import { ItemSystem } from './item-system.js';

const BAY_Y = 1.0;
/** Hammer head faces in the prototype's local space (both ends strike). */
const HEAD_FACE_X = .123;
const HEAD_Y = .22;
const PAD_RADIUS = .24;
const sawHammer = (held: Iterable<Entity>) => { for (const e of held) if (e.getValue(Item, 'kind') === 'hammer') return true; return false; };
const STRIKES_NEEDED = 3;

/** Generic three-bay bench: any order, three deliberate hammer strikes on the pad. */
export class CraftingSystem extends createSystem({
  benches: { required: [CraftBench] },
  items: { required: [Item] },
  held: { required: [Item, Held] },
  game: { required: [GameState] },
}) {
  private point = new Vector3();
  private other = new Vector3();
  private hasPreviousFace = false;
  private lastMissToast = -Infinity;
  private bayItems: (Entity | undefined)[] = [undefined, undefined, undefined];
  private kinds: string[] = ['', '', ''];
  private hammerArmed = false;
  private previousHammerY = 0;
  private cooldown = 0;
  private dirty = true;
  private elapsed = 0;
  private lastInvalidToast = -Infinity;
  private items!: ItemSystem;
  private benchEntity?: Entity;
  private game?: Entity;

  get bench(): Entity | undefined {
    return this.benchEntity;
  }

  init(): void {
    const items = this.world.getSystem(ItemSystem);
    if (!items) throw new Error('CraftingSystem requires ItemSystem');
    this.items = items;
    const markDirty = () => { this.dirty = true; };
    this.cleanupFuncs.push(
      items.addReleaseTarget(40, (entity, kind, at, _v, hand) => this.releaseIntoBay(entity, kind, at, hand)),
      bus.on('grab', markDirty),
      bus.on('snap', markDirty),
      this.queries.items.subscribe('disqualify', markDirty),
      this.queries.benches.subscribe('qualify', (entity) => { this.benchEntity = entity; markDirty(); }, true),
      this.queries.benches.subscribe('disqualify', (entity) => {
        if (this.benchEntity !== entity) return;
        this.benchEntity = undefined;
        for (const other of this.queries.benches.entities) if (other !== entity) this.benchEntity = other;
      }),
      this.queries.game.subscribe('qualify', (entity) => { this.game = entity; }, true),
      this.queries.game.subscribe('disqualify', (entity) => { if (this.game === entity) this.game = undefined; }),
    );
  }

  private releaseIntoBay(entity: Entity, kind: string, at: Vector3, hand: 'left' | 'right' | undefined): boolean {
    const bay = benchBayAt(at.x, at.y, at.z);
    if (bay < 0 || kind === 'pack') return false;
    this.refreshBays();
    if (this.bayItems[bay]) return false;
    const object = entity.object3D;
    if (!object) return false;
    const items = this.items;
    object.position.set(CAMP.bench.x + CAMP.slotOffsets[bay], BAY_Y + (itemInfo(kind)?.restY ?? .05), CAMP.bench.z);
    items.restPose(entity, kind, 0);
    entity.setValue(Item, 'slot', `bay-${bay}`);
    pulse(this.input, hand, .3, 25);
    bus.emit({ type: 'snap', kind, target: `bay-${bay}`, x: object.position.x, y: object.position.y, z: object.position.z });
    return true;
  }

  private refreshBays(): void {
    this.bayItems[0] = this.bayItems[1] = this.bayItems[2] = undefined;
    for (const entity of this.queries.items.entities) {
      const slot = entity.getValue(Item, 'slot') ?? '';
      if (!slot.startsWith('bay-')) continue;
      const bay = Number(slot.slice(4));
      if (bay >= 0 && bay < 3) this.bayItems[bay] = entity;
    }
    for (let i = 0; i < 3; i++) this.kinds[i] = this.bayItems[i]?.getValue(Item, 'kind') ?? '';
  }

  private rematch(bench: Entity): void {
    this.refreshBays();
    const previous = bench.getValue(CraftBench, 'match') ?? '';
    const full = this.kinds.every(Boolean);
    const index = full ? matchBench(this.kinds) : -1;
    const match = !full ? '' : index >= 0 ? BENCH_RECIPES[index].product : '!';
    if (match !== previous) {
      bench.setValue(CraftBench, 'match', match);
      bench.setValue(CraftBench, 'strikes', 0);
      if (full) this.announceSet(index);
    }
  }

  /** Say whether three filled bays make something, before the first strike. */
  private announceSet(index: number): void {
    const game = this.game;
    const known = index >= 0 && !!game && ((game.getValue(GameState, 'recipes') ?? 0) & recipeBit(index)) !== 0;
    const product = index >= 0 ? BENCH_RECIPES[index].product : '';
    bus.emit({ type: 'bench-set', product, valid: index >= 0, known });
    if (index < 0) bus.emit({ type: 'toast', tone: 'warn', text: 'These three don\u2019t fit together', body: 'Take one out and try another part.' });
    else if (known) bus.emit({ type: 'toast', tone: 'good', text: BENCH_RECIPES[index].label, body: 'Strike the pad three times with the hammer head.' });
    else bus.emit({ type: 'toast', tone: 'info', text: 'Something could come of this', body: 'Strike the pad three times and see.' });
  }

  update(delta: number): void {
    this.elapsed += delta;
    const bench = this.bench;
    if (!bench) return;
    if (this.dirty) {
      this.dirty = false;
      this.rematch(bench);
    }
    const visibility = this.visibilityState.peek();
    if (visibility === VisibilityState.VisibleBlurred || visibility === VisibilityState.Hidden || delta > .15) {
      this.hammerArmed = false;
      return;
    }
    this.cooldown = Math.max(0, this.cooldown - delta);
    const items = this.items;
    for (const hammer of this.queries.held.entities) {
      if (hammer.getValue(Item, 'kind') !== 'hammer') continue;
      const object = hammer.object3D;
      if (!object) continue;
      object.updateWorldMatrix(true, false);
      // Either face of the head counts: take whichever is lower right now and
      // detect it crossing the pad surface on the way down, at any swing speed.
      this.point.set(-HEAD_FACE_X, HEAD_Y, 0);
      object.localToWorld(this.point);
      this.other.set(HEAD_FACE_X, HEAD_Y, 0);
      object.localToWorld(this.other);
      const face = this.point.y < this.other.y ? this.point : this.other;
      const surface = CAMP.work.y + .03;
      if (face.y > CAMP.work.y + .1) this.hammerArmed = true;
      const crossed = this.hasPreviousFace && this.previousHammerY > surface && face.y <= surface;
      if (crossed && this.hammerArmed && this.cooldown === 0) {
        const onPad = Math.hypot(face.x - CAMP.work.x, face.z - CAMP.work.z) < PAD_RADIUS;
        this.hammerArmed = false;
        this.cooldown = .25;
        if (onPad) this.strike(bench, items.handOf(hammer));
        else if (Math.abs(face.z - CAMP.bench.z) < .5 && Math.abs(face.x - CAMP.bench.x) < 1.3) {
          pulse(this.input, items.handOf(hammer), .25, 20);
          bus.emit({ type: 'thud', kind: 'hammer', x: face.x, y: face.y, z: face.z });
          this.missHint();
        }
      }
      this.previousHammerY = face.y;
      this.hasPreviousFace = true;
    }
    if (!sawHammer(this.queries.held.entities)) this.hasPreviousFace = false;
  }

  private missHint(): void {
    if (this.elapsed - this.lastMissToast < 12) return;
    this.lastMissToast = this.elapsed;
    bus.emit({ type: 'toast', tone: 'info', text: 'Strike the pad', body: 'Bring the hammer head down on the iron pad at the end of the bench.' });
  }

  private strike(bench: Entity, hand: 'left' | 'right' | undefined): void {
    const match = bench.getValue(CraftBench, 'match') ?? '';
    const { x, y, z } = CAMP.work;
    if (!match || match === '!') {
      pulse(this.input, hand, .5, 30);
      bus.emit({ type: 'strike', count: 0, valid: false, x, y, z });
      if (this.elapsed - this.lastInvalidToast > 6) {
        this.lastInvalidToast = this.elapsed;
        bus.emit({
          type: 'toast', tone: 'warn',
          text: match === '!' ? 'These three don’t fit together.' : 'Fill all three bays before striking.',
        });
      }
      return;
    }
    const strikes = (bench.getValue(CraftBench, 'strikes') ?? 0) + 1;
    bench.setValue(CraftBench, 'strikes', strikes);
    pulse(this.input, hand, .8, 45);
    bus.emit({ type: 'strike', count: strikes, valid: true, x, y, z });
    if (strikes >= STRIKES_NEEDED) this.craft(bench, match);
  }

  private craft(bench: Entity, product: string): void {
    const items = this.items;
    this.refreshBays();
    for (const entity of this.bayItems) if (entity) items.consume(entity);
    bench.setValue(CraftBench, 'strikes', 0);
    bench.setValue(CraftBench, 'match', '');
    const index = BENCH_RECIPES.findIndex((recipe) => recipe.product === product);
    const game = this.game;
    let learned = false;
    if (game && index >= 0) {
      const known = game.getValue(GameState, 'recipes') ?? 0;
      learned = !(known & recipeBit(index));
      if (learned) game.setValue(GameState, 'recipes', known | recipeBit(index));
    }
    const { x, y, z } = CAMP.work;
    void items.spawnItem(product, x, y + (itemInfo(product)?.restY ?? .05) + .02, z, {
      charges: product === 'bolts' ? BOLTS_PER_BUNDLE : 0,
      variant: product === 'sentry-kit' ? 'kit' : '',
    });
    bus.emit({ type: 'crafted', product, learned, x, y, z });
    if (learned) bus.emit({ type: 'recipe-learned', product });
    this.dirty = true;
  }
}
