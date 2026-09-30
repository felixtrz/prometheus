import {
  createSystem, Entity, eq, InputComponent, Mesh, Object3D, PlaneGeometry, Quaternion, Vector3,
} from '@iwsdk/core';
import { bus } from '../bus.js';
import { chooseSlot, emptyStacks, followYaw, PACK_SLOTS, packable, packIndex, stacksOnto } from '../carry.js';
import { ITEMS, itemInfo, STACK_LIMIT } from '../catalog.js';
import { Airborne, Backpack, Held, Item } from '../components.js';
import { pulse } from '../haptics.js';
import type { SaveData } from '../save.js';
import { cuePulse, glowMaterial, TextLabel } from './carry-cues.js';
import { ItemSystem, type Hand } from './item-system.js';
import { StorySystem } from './story-system.js';

/**
 * Backpack.state: 'unowned' lies where the scene put it until first picked up; then
 * 'worn' on the back, 'held' in a hand (rolled), 'open' in a hand with the slot panel
 * unrolled, or 'dropped' where the player fell.
 */
export type PackState = 'unowned' | 'worn' | 'held' | 'open' | 'dropped';

const HANDS: readonly Hand[] = ['left', 'right'];
const Y_AXIS = new Vector3(0, 1, 0);
/** Tips an item's resting "up" onto the panel's facing (+Y onto +Z). */
const FACE_UP = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

/** Worn: the pack's origin from the eyes in the body frame (x right, y up, z behind). Its top sits ~20 cm below the eyes. */
const BACK = new Vector3(0, -.52, .27);
/** The pack's bulk centre in its own frame (origin 10.7 cm above its base, see the 'pack-roll' prototype). */
const PACK_CENTRE = new Vector3(0, .1, 0);
/** Slot panel ('backpack' prototype): origin at the top edge's centre, facing +Z; cell centres. */
const CELL_X = [-.18, 0, .18];
const CELL_Y = [-.13, -.31, -.49];
/** Largest an item is shown in a cell (m): cells are .18 apart, so nothing spans into the next. */
const CELL_FIT = .15;
const PANEL_HALF_WIDTH = .29;
const PANEL_BOTTOM = -.6;
/** Items rest this far proud of the panel's face (plus their catalog rest height). */
const FACE = .012;
/** The open panel hangs in front of the hand holding the pack, toward the eyes, its top just below the grip. */
const PANEL_FORWARD = .13;
const PANEL_DROP = .03;
/** An item released within this margin around the open panel goes into the nearest slot. */
const PANEL_MARGIN = .07;
/** Stow over the shoulder: the hand within this of the worn pack's centre, or behind the shoulders (m). */
const BACK_REACH = .38;
/** Stow into the rolled pack held in the other hand: the hand within this of its centre (m). */
const HELD_REACH = .22;
/** A pack lost at death falls from this high above the ground. */
const DROP_HEIGHT = .5;

type Aim = '' | 'panel' | 'pack' | 'back';

/**
 * The backpack: always on the player's back once found. Reach over a shoulder and squeeze
 * to take it; pull the trigger while holding it to unroll the slot panel (it hangs upright
 * in front of that hand); let go anywhere and it goes back onto the back. Items go in when
 * released over a panel slot, onto the rolled pack in the other hand, or over the shoulder.
 * Stackable kinds share a slot (up to STACK_LIMIT): every item stays its own entity with
 * the same 'pack-N' slot, only one shows, and the slot shows the count.
 */
export class BackpackSystem extends createSystem({
  packs: { required: [Backpack] },
  items: { required: [Item] },
  held: { required: [Item, Held] },
  handles: { required: [Item], where: [eq(Item, 'kind', 'pack')] },
}) {
  /** The pack lies where the player last fell (FxSystem beams it, ToastSystem says so). */
  lost = false;
  /** World heading of the body (rad): the worn pack and the hip holsters face it. */
  bodyYaw = 0;
  /** Set by HolsterSystem: true when this hand would put its item into a holster (holsters win). */
  holsterClaims?: (hand: Hand) => boolean;
  private bodyLocal = 0;
  private bodyReady = false;
  private ready = false;
  private forceDrop = false;
  private dropX = 0;
  private dropZ = 0;
  private taught = new Set<string>();
  private readonly stacks = emptyStacks();
  private readonly tops: (Entity | undefined)[] = new Array(PACK_SLOTS).fill(undefined);
  private aimSlot: Record<Hand, number> = { left: -1, right: -1 };
  private aimAt: Record<Hand, Aim> = { left: '', right: '' };
  private hints!: Record<Hand, TextLabel>;
  private counts: TextLabel[] = [];
  /** What each count label and hint last showed, so their text is only rebuilt on a change (no per-frame strings). */
  private shownCounts = new Array<number>(PACK_SLOTS).fill(-1);
  private hintKeys: Record<Hand, number> = { left: NaN, right: NaN };
  private cues!: Object3D;
  private cellGlow!: Mesh;
  private elapsed = 0;
  private panelYaw = 0;
  private panelAt = new Vector3();
  private panelQuat = new Quaternion();
  private point = new Vector3();
  private grip = new Vector3();
  private head = new Vector3();
  private forward = new Vector3();
  private zero = new Vector3();
  private quat = new Quaternion();
  private matEntity?: Entity;
  private handleEntity?: Entity;

  /** The slot panel (the scene's Backpack entity), shown only while open. */
  get mat(): Entity | undefined {
    return this.matEntity;
  }

  /** The pack itself: the grabbable 'pack' item. */
  get handle(): Entity | undefined {
    return this.handleEntity;
  }

  get state(): PackState {
    return (this.mat?.getValue(Backpack, 'state') ?? 'unowned') as PackState;
  }

  /** Whether the player has found the pack (it is theirs from the first time they pick it up). */
  get owned(): boolean {
    return this.ready && this.state !== 'unowned';
  }

  init(): void {
    const items = this.world.getSystem(ItemSystem);
    if (!items) throw new Error('BackpackSystem requires ItemSystem');
    this.buildCues();
    this.cleanupFuncs.push(
      items.addReleaseTarget(0, (entity, kind, _at, _v, hand) => (kind === 'pack' ? this.releasePack(entity, hand) : false)),
      items.addReleaseTarget(10, (entity, kind, at, _v, hand) => this.releaseInto(entity, kind, at, hand)),
      this.queries.held.subscribe('qualify', (entity) => {
        if (entity.getValue(Item, 'kind') !== 'pack') return;
        const from = this.state;
        this.setState('held');
        this.lost = false;
        entity.object3D?.getWorldPosition(this.point);
        bus.emit({ type: 'pack', state: 'held', x: this.point.x, y: this.point.y, z: this.point.z });
        if (from === 'unowned') {
          this.teach('found', 'Your pack', 'Let go of it and it goes onto your back. It stays there from now on.');
        } else {
          this.teach('held', 'Your pack', 'Pull the trigger to open it. Let go and it goes back onto your back.');
        }
      }),
      this.queries.packs.subscribe('qualify', (entity) => { this.matEntity = entity; this.ready = false; }, true),
      this.queries.packs.subscribe('disqualify', (entity) => {
        if (this.matEntity !== entity) return;
        this.matEntity = undefined;
        for (const other of this.queries.packs.entities) if (other !== entity) this.matEntity = other;
      }),
      this.queries.handles.subscribe('qualify', (entity) => { this.handleEntity = entity; this.ready = false; }, true),
      this.queries.handles.subscribe('disqualify', (entity) => {
        if (this.handleEntity !== entity) return;
        this.handleEntity = undefined;
        for (const other of this.queries.handles.entities) if (other !== entity) this.handleEntity = other;
      }),
      this.world.activeLevel.subscribe(() => {
        this.ready = false;
        this.lost = false;
        this.bodyReady = false;
        this.taught.clear();
      }),
      () => {
        for (const hand of HANDS) this.hints[hand].dispose();
        for (const label of this.counts) label.dispose();
      },
    );
    const story = this.world.getSystem(StorySystem);
    if (story) story.hooks.pack = { save: () => this.save(), load: (data) => this.load(data) };
  }

  /** Hover hints by each hand, the slot counts and the aimed-slot glow (persistent, re-used across journeys). */
  private buildCues(): void {
    this.hints = { left: new TextLabel(.2, .045), right: new TextLabel(.2, .045) };
    for (const hand of HANDS) this.world.createTransformEntity(this.hints[hand].mesh, { persistent: true });
    this.cues = new Object3D();
    this.cues.name = 'Pack slot cues';
    this.cues.visible = false;
    this.cellGlow = new Mesh(new PlaneGeometry(.16, .16), glowMaterial());
    this.cellGlow.raycast = () => {};
    this.cellGlow.visible = false;
    this.cues.add(this.cellGlow);
    for (let i = 0; i < PACK_SLOTS; i++) {
      const label = new TextLabel(.055, .035);
      label.mesh.position.set(CELL_X[i % 3] + .055, CELL_Y[Math.floor(i / 3)] - .058, FACE + .03);
      this.cues.add(label.mesh);
      this.counts.push(label);
    }
    this.world.createTransformEntity(this.cues, { persistent: true });
  }

  private teach(key: string, text: string, body: string): void {
    if (this.taught.has(key)) return;
    this.taught.add(key);
    bus.emit({ type: 'toast', tone: 'info', text, body, hold: 6 });
  }

  private setState(state: PackState): void {
    const mat = this.mat;
    if (!mat) return;
    mat.setValue(Backpack, 'state', state);
    const open = state === 'open';
    if (mat.object3D) mat.object3D.visible = open;
    this.cues.visible = open;
    // Closed, every stored item is out of sight and out of reach.
    if (!open) this.refreshStacks(true);
  }

  // ---- Body heading and poses ------------------------------------------------------

  /** Follow the body, not the head: the camera's yaw relative to the rig, eased (see followYaw), plus the rig's. */
  private updateBody(delta: number): void {
    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (Math.hypot(this.forward.x, this.forward.z) > .2) {
      const headLocal = Math.atan2(-this.forward.x, -this.forward.z);
      this.bodyLocal = this.bodyReady ? followYaw(this.bodyLocal, headLocal, delta) : headLocal;
      this.bodyReady = true;
    }
    this.player.getWorldQuaternion(this.quat);
    this.forward.set(0, 0, -1).applyQuaternion(this.quat);
    this.bodyYaw = Math.atan2(-this.forward.x, -this.forward.z) + this.bodyLocal;
  }

  /** A point given in the body frame (x right, y up, z behind, from the eyes) into world space. */
  bodyPoint(x: number, y: number, z: number, out: Vector3): Vector3 {
    this.camera.getWorldPosition(this.head);
    const c = Math.cos(this.bodyYaw), s = Math.sin(this.bodyYaw);
    return out.set(this.head.x + x * c + z * s, this.head.y + y, this.head.z - x * s + z * c);
  }

  private followBack(object: Object3D): void {
    this.bodyPoint(BACK.x, BACK.y, BACK.z, object.position);
    object.rotation.set(0, this.bodyYaw, 0);
  }

  private packCentre(out: Vector3): Vector3 {
    const object = this.handle!.object3D!;
    return object.localToWorld(out.copy(PACK_CENTRE));
  }

  /** Hang the open panel in front of the hand holding the pack, upright and turned to the eyes. */
  private placePanel(hand: Hand, panel: Object3D): void {
    const grip = this.player.gripSpaces?.[hand];
    if (!grip) return;
    grip.getWorldPosition(this.grip);
    this.camera.getWorldPosition(this.head);
    const dx = this.head.x - this.grip.x, dz = this.head.z - this.grip.z;
    const length = Math.hypot(dx, dz);
    if (length > .05) this.panelYaw = Math.atan2(dx, dz);
    const fx = Math.sin(this.panelYaw), fz = Math.cos(this.panelYaw);
    this.panelAt.set(this.grip.x + fx * PANEL_FORWARD, this.grip.y - PANEL_DROP, this.grip.z + fz * PANEL_FORWARD);
    panel.position.copy(this.panelAt);
    panel.rotation.set(0, this.panelYaw, 0);
    this.cues.position.copy(this.panelAt);
    this.cues.rotation.set(0, this.panelYaw, 0);
    this.panelQuat.setFromAxisAngle(Y_AXIS, this.panelYaw).multiply(FACE_UP);
  }

  /** Where a slot of the open panel is (world), just in front of its face: to aim an item at it. */
  slotPoint(index: number, out: Vector3): Vector3 {
    return this.cellWorld(index, FACE + .03, out);
  }

  /** World centre of a slot on the open panel, `lift` proud of its face. */
  private cellWorld(index: number, lift: number, out: Vector3): Vector3 {
    const lx = CELL_X[index % 3], ly = CELL_Y[Math.floor(index / 3)];
    const c = Math.cos(this.panelYaw), s = Math.sin(this.panelYaw);
    return out.set(this.panelAt.x + lx * c + lift * s, this.panelAt.y + ly, this.panelAt.z - lx * s + lift * c);
  }

  // ---- Slots and stacks ------------------------------------------------------------

  /**
   * Recount every slot from the items' own 'pack-N' slots (the single source of truth, so
   * saves stay per item). With `layout`, also show each slot's top item on the open panel
   * and hide the rest of the stack (or everything when the pack is closed).
   */
  private refreshStacks(layout: boolean): void {
    for (const stack of this.stacks) stack.count = 0;
    this.tops.fill(undefined);
    const open = this.state === 'open';
    const items = this.world.getSystem(ItemSystem)!;
    for (const entity of this.queries.items.entities) {
      const index = packIndex(entity.getValue(Item, 'slot') ?? '');
      if (index < 0) continue;
      const stack = this.stacks[index];
      if (stack.count === 0) {
        stack.kind = entity.getValue(Item, 'kind') ?? '';
        stack.variant = entity.getValue(Item, 'variant') ?? '';
        this.tops[index] = entity;
      }
      stack.count++;
      if (!layout) continue;
      const shown = open && this.tops[index] === entity;
      items.setAvailable(entity, shown);
      if (shown) this.placeInCell(entity, index);
    }
    if (!layout) return;
    for (let i = 0; i < PACK_SLOTS; i++) {
      const count = this.stacks[i].count;
      this.counts[i].mesh.visible = open && count > 1;
      if (count > 1 && this.shownCounts[i] !== count) {
        this.shownCounts[i] = count;
        this.counts[i].set(`${count}`);
      }
    }
  }

  private placeInCell(entity: Entity, index: number): void {
    const object = entity.object3D;
    if (!object) return;
    const kind = entity.getValue(Item, 'kind') ?? '';
    this.cellWorld(index, FACE + (itemInfo(kind)?.restY ?? .04), object.position);
    const items = this.world.getSystem(ItemSystem)!;
    items.restPose(entity, kind, 0);
    object.quaternion.premultiply(this.panelQuat);
    // Fit it to its cell (a stick is .5 m long): taking it out restores its size.
    const extent = items.extent(entity);
    items.setScaleFactor(entity, extent > CELL_FIT ? CELL_FIT / extent : 1);
  }

  /** Put an item into a slot (it must fit: see chooseSlot). */
  private stow(entity: Entity, kind: string, index: number, hand: Hand | undefined, at: Vector3): void {
    const stacked = stacksOnto(this.stacks[index], kind, entity.getValue(Item, 'variant') ?? '');
    entity.setValue(Item, 'slot', `pack-${index}`);
    this.refreshStacks(true);
    pulse(this.input, hand, stacked ? .3 : .25, 20);
    bus.emit({ type: 'snap', kind, target: `pack-${index}`, x: at.x, y: at.y, z: at.z });
    if (stacked) this.teach('stacked', 'Stacked', `Up to ${STACK_LIMIT} of a kind share a slot; the number shows how many.`);
  }

  // ---- Aiming a held item at the pack ----------------------------------------------

  /**
   * Where a hand's item would go if let go now: a panel slot, the rolled pack in the other
   * hand, or the worn pack over the shoulder. Sets aimAt/aimSlot for that hand (slot -1 with
   * an aim: the pack is full for it). The release and the hover cue both use this.
   */
  private aim(hand: Hand, entity: Entity, at: Vector3): void {
    this.aimAt[hand] = '';
    this.aimSlot[hand] = -1;
    const kind = entity.getValue(Item, 'kind') ?? '';
    const handle = this.handle;
    if (!packable(kind) || !handle?.object3D || entity === handle || this.holsterClaims?.(hand)) return;
    const grip = this.player.gripSpaces?.[hand];
    if (!grip) return;
    grip.getWorldPosition(this.grip);
    const state = this.state;
    let preferred = -1;
    if (state === 'open') preferred = this.panelCell(at);
    if (preferred >= 0) this.aimAt[hand] = 'panel';
    else if ((state === 'open' || state === 'held') && this.handHolding(handle) !== hand &&
      this.grip.distanceTo(this.packCentre(this.point)) < HELD_REACH) this.aimAt[hand] = 'pack';
    else if (state === 'worn' && this.overShoulder(this.grip)) this.aimAt[hand] = 'back';
    if (!this.aimAt[hand]) return;
    this.refreshStacks(false);
    this.aimSlot[hand] = chooseSlot(this.stacks, kind, entity.getValue(Item, 'variant') ?? '', preferred);
  }

  private handHolding(entity: Entity): Hand | undefined {
    return this.world.getSystem(ItemSystem)?.handOf(entity);
  }

  /** The open panel slot nearest a point on or just in front of the panel, else -1. */
  private panelCell(at: Vector3): number {
    const dx = at.x - this.panelAt.x, dy = at.y - this.panelAt.y, dz = at.z - this.panelAt.z;
    const c = Math.cos(this.panelYaw), s = Math.sin(this.panelYaw);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) > PANEL_HALF_WIDTH + PANEL_MARGIN || dy > PANEL_MARGIN || dy < PANEL_BOTTOM - PANEL_MARGIN) return -1;
    if (lz < -.08 || lz > .25) return -1;
    let best = -1, bestDistance = Infinity;
    for (let i = 0; i < PACK_SLOTS; i++) {
      const d = Math.hypot(lx - CELL_X[i % 3], dy - CELL_Y[Math.floor(i / 3)]);
      if (d < bestDistance) { bestDistance = d; best = i; }
    }
    return best;
  }

  /** Near the worn pack, or behind the shoulders at about shoulder height. */
  private overShoulder(p: Vector3): boolean {
    if (p.distanceTo(this.packCentre(this.point)) < BACK_REACH) return true;
    this.camera.getWorldPosition(this.head);
    const dx = p.x - this.head.x, dz = p.z - this.head.z;
    const behind = dx * Math.sin(this.bodyYaw) + dz * Math.cos(this.bodyYaw);
    return behind > .05 && p.y > this.head.y - .45 && p.y < this.head.y + .25 && Math.hypot(dx, dz) < .55;
  }

  /** Per hand: aim, then the cue — slot glow or pack rim, a hint by the hand, a tick on entering. */
  private updateAims(): void {
    const items = this.world.getSystem(ItemSystem)!;
    const handle = this.handle;
    let packLit = false;
    let cellLit = -1;
    const glow = cuePulse(this.elapsed);
    for (const hand of HANDS) {
      const hint = this.hints[hand];
      const entity = items.heldIn(hand);
      const before = this.aimAt[hand] ? this.aimSlot[hand] : -2;
      if (entity?.object3D && entity !== handle) {
        entity.object3D.getWorldPosition(this.point);
        this.aim(hand, entity, this.point);
      } else {
        this.aimAt[hand] = '';
        this.aimSlot[hand] = -1;
      }
      const where = this.aimAt[hand], slot = this.aimSlot[hand];
      if (!where || !entity) {
        hint.mesh.visible = false;
        continue;
      }
      if (slot >= 0 && where === 'panel') cellLit = slot;
      if (slot >= 0 && where !== 'panel') packLit = true;
      if (slot !== before) {
        if (slot >= 0) pulse(this.input, hand, .18, 14);
        this.teach('aim', 'Into your pack', 'Let go here to stow it. The same things stack in one slot.');
      }
      this.showHint(hand, entity, where, slot, glow);
    }
    if (handle) items.setHighlight(handle, packLit);
    this.cellGlow.visible = cellLit >= 0 && this.state === 'open';
    if (cellLit >= 0) {
      this.cellGlow.position.set(CELL_X[cellLit % 3], CELL_Y[Math.floor(cellLit / 3)], FACE * .5);
      (this.cellGlow.material as { opacity: number }).opacity = .25 + .35 * glow;
    }
  }

  private showHint(hand: Hand, entity: Entity, where: Aim, slot: number, glow: number): void {
    const hint = this.hints[hand];
    const count = slot < 0 ? 0 : this.stacks[slot].count;
    const key = ((entity.index * 16 + slot + 1) * 64 + count) * 4 + (where === 'panel' ? 1 : 0);
    if (key !== this.hintKeys[hand]) {
      this.hintKeys[hand] = key;
      const kind = entity.getValue(Item, 'kind') ?? '';
      const label = itemInfo(kind)?.label ?? kind;
      if (slot < 0) hint.set('Pack full');
      else {
        const onto = stacksOnto(this.stacks[slot], kind, entity.getValue(Item, 'variant') ?? '');
        hint.set(onto ? `${label}: ${count + 1} / ${STACK_LIMIT}` : where === 'panel' ? `Put in slot ${slot + 1}` : 'Into pack');
      }
    }
    // Behind the head the hand is out of sight: the hint shows low in view instead.
    if (where === 'back') {
      this.camera.getWorldPosition(this.head);
      this.camera.getWorldDirection(this.forward);
      hint.mesh.position.set(this.head.x + this.forward.x * .55, this.head.y + this.forward.y * .55 - .18, this.head.z + this.forward.z * .55);
    } else {
      this.player.gripSpaces?.[hand]?.getWorldPosition(hint.mesh.position);
      hint.mesh.position.y += .12;
    }
    this.camera.getWorldQuaternion(hint.mesh.quaternion);
    hint.mesh.scale.setScalar(.97 + .03 * glow);
    hint.mesh.visible = true;
  }

  // ---- Release targets -------------------------------------------------------------

  /** The pack let go: back onto the back (never thrown). At death it drops where the player fell. */
  private releasePack(handle: Entity, hand: Hand | undefined): boolean {
    if (this.forceDrop) {
      this.dropBag(handle, this.dropX, this.dropZ);
      return true;
    }
    // Landing after a fall (lost at death): it lies there until picked up.
    if (hand === undefined) return true;
    this.wear(handle);
    handle.object3D?.getWorldPosition(this.point);
    bus.emit({ type: 'pack', state: 'worn', x: this.point.x, y: this.point.y, z: this.point.z });
    this.teach('worn', 'Pack on your back', 'Reach over your shoulder and squeeze to take it. Let go of things over your shoulder to stow them.');
    return true;
  }

  private releaseInto(entity: Entity, kind: string, at: Vector3, hand: Hand | undefined): boolean {
    if (!hand || !packable(kind)) return false;
    this.aim(hand, entity, at);
    const where = this.aimAt[hand], slot = this.aimSlot[hand];
    this.aimAt[hand] = '';
    if (!where) return false;
    if (slot < 0) {
      bus.emit({ type: 'toast', text: 'The pack is full', body: `Nine slots; up to ${STACK_LIMIT} of a kind share one, tools one each.`, tone: 'warn' });
      return false;
    }
    this.stow(entity, kind, slot, hand, at);
    return true;
  }

  private wear(handle: Entity): void {
    this.setState('worn');
    handle.setValue(Item, 'slot', 'worn');
    if (handle.hasComponent(Airborne)) handle.removeComponent(Airborne);
    this.world.getSystem(ItemSystem)?.setAvailable(handle, true);
    if (handle.object3D) this.followBack(handle.object3D);
  }

  /** The pack falls to the ground at (x, z), shut, and lies there until picked up. */
  private dropBag(handle: Entity, x: number, z: number): void {
    const object = handle.object3D;
    if (!object) return;
    const items = this.world.getSystem(ItemSystem)!;
    this.setState('dropped');
    handle.setValue(Item, 'slot', '');
    object.position.set(x, items.groundAt(x, z) + ITEMS.pack.restY + DROP_HEIGHT, z);
    object.rotation.set(0, this.bodyYaw, 0);
    items.launch(handle, 'pack', this.zero);
    this.lost = true;
  }

  /**
   * Death: the pack drops where the player fell (SurvivalSystem opens the hands first, so a
   * held pack is already back on the back). One already lying somewhere stays there.
   */
  dropAt(x: number, z: number): void {
    const handle = this.handle;
    if (!handle?.object3D || !this.owned) return;
    const state = this.state;
    if (state === 'dropped') return;
    this.dropX = x;
    this.dropZ = z;
    if (handle.hasComponent(Held)) {
      this.forceDrop = true;
      this.world.getSystem(ItemSystem)?.forceRelease(handle);
      this.forceDrop = false;
      return;
    }
    this.dropBag(handle, x, z);
  }

  // ---- Save --------------------------------------------------------------------------

  save(): SaveData['pack'] {
    const object = this.handle?.object3D;
    if (!object || !this.ready) return null;
    const state = this.state;
    if (state === 'unowned' || state === 'dropped') {
      const items = this.world.getSystem(ItemSystem)!;
      const p = object.position;
      return { state, p: [p.x, items.groundAt(p.x, p.z) + ITEMS.pack.restY, p.z], yaw: items.yawOf(object), lost: this.lost };
    }
    return { state: 'worn', p: [0, 0, 0], yaw: 0, lost: false };
  }

  /**
   * Continue: 'unowned' and 'dropped' packs lie at the saved spot, anything else is worn.
   * Older saves: 'unrolled' (the old mat on the ground) is worn, unless it was lost at death.
   */
  load(data: SaveData['pack']): void {
    const handle = this.handle;
    if (!data || !handle?.object3D || !this.mat) return;
    this.ready = true;
    this.lost = data.lost;
    const lying = data.state === 'unowned' || data.state === 'dropped' || (data.state === 'unrolled' && data.lost);
    if (!lying) {
      this.wear(handle);
      return;
    }
    if (handle.hasComponent(Airborne)) handle.removeComponent(Airborne);
    handle.setValue(Item, 'slot', '');
    handle.object3D.position.set(...data.p);
    this.world.getSystem(ItemSystem)!.restPose(handle, 'pack', data.yaw);
    this.setState(data.state === 'unowned' ? 'unowned' : 'dropped');
  }

  /** First sight of a level's pack: the scene says 'worn', or it lies where authored until found. */
  private setUp(handle: Entity): void {
    this.ready = true;
    this.lost = false;
    const state = this.state;
    if (state === 'worn') this.wear(handle);
    else this.setState('unowned');
  }

  update(delta: number): void {
    this.elapsed += delta;
    this.updateBody(delta);
    const mat = this.mat, handle = this.handle;
    if (!mat?.object3D || !handle?.object3D) return;
    if (!this.ready) this.setUp(handle);
    const held = handle.hasComponent(Held);
    let state = this.state;
    // Out of the hand without a release (never expected): it still goes onto the back.
    if ((state === 'held' || state === 'open') && !held) {
      this.wear(handle);
      state = 'worn';
    }
    if (state === 'worn' && !held) this.followBack(handle.object3D);
    const hand = held ? this.handHolding(handle) : undefined;
    if (hand && this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) this.toggleOpen(hand, handle);
    if (this.state === 'open' && hand) {
      this.placePanel(hand, mat.object3D);
      this.refreshStacks(true);
    }
    // FxSystem beams the lost pack at the (hidden) panel's position.
    if (state === 'dropped') mat.object3D.position.copy(handle.object3D.position);
    this.updateAims();
  }

  private toggleOpen(hand: Hand, handle: Entity): void {
    const open = this.state !== 'open';
    this.setState(open ? 'open' : 'held');
    handle.object3D!.getWorldPosition(this.point);
    bus.emit({ type: 'pack', state: open ? 'unrolled' : 'rolled', x: this.point.x, y: this.point.y, z: this.point.z });
    pulse(this.input, hand, .3, 30);
    if (open) {
      this.placePanel(hand, this.mat!.object3D!);
      this.refreshStacks(true);
      this.teach('open', 'Your pack, open', `Take things with your other hand. Hold something to a slot and let go to put it in; the same things stack, up to ${STACK_LIMIT}.`);
    }
  }
}
