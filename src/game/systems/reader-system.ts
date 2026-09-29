import {
  createSystem, Entity, Object3D, Quaternion, Types, UIKitMLAsset, Vector3,
} from '@iwsdk/core';
import { Held, Item, Page } from '../components.js';
import { BENCH_RECIPES, benchRecipeIndex } from '../recipes.js';
import { PAGES } from '../story.js';
import { ItemSystem } from './item-system.js';
import { HIDE, PanelText, plain, readerHooks, recipeInputs, SHOW } from './journal-system.js';

const IDS = ['pg-num', 'pg-title', 'pg-author', 'pg-body', 'pg-teach', 'pg-teach-text'] as const;
const TEXT = PAGES.map((page) => {
  const recipe = page.teaches ? benchRecipeIndex(page.teaches) : -1;
  return {
    num: `PAGE ${page.index} OF ${PAGES.length}`,
    title: plain(page.title),
    author: `- ${plain(page.author)}`,
    body: plain(page.body),
    teach: recipe >= 0 ? `${BENCH_RECIPES[recipe].label}: ${recipeInputs(BENCH_RECIPES[recipe].inputs)}` : '',
  };
});

/** Where a re-read page opens on the journal board, in the board's local metres (left/middle columns). */
const BOARD_OFFSET = new Vector3(-0.3, -0.02, 0.07);
const BOARD_SECONDS = 12;

type Mode = 'none' | 'held' | 'board';

/**
 * Parchment reader, one pooled, persistent, display-only panel with two modes:
 * - held: beside a held journal page (Item + Page + Held), following the page's
 *   world position each frame, offset toward the body centre (away from the holding
 *   hand) and a little toward the viewer, facing the camera. Never parented to the
 *   page, so it cannot join the page's grab surface or bounds. Hidden on release.
 * - board: a found page re-opened from the camp journal (tap its title). It sits just
 *   in front of the board for 12 s, or until the same title is tapped again.
 */
export class ReaderSystem extends createSystem({
  pages: { required: [Page, Item, Held] },
}, {
  /** World scale of the 60-unit-wide parchment beside a held page (0.46 -> ~28 cm). */
  scale: { type: Types.Float32, default: 0.46 },
  /** World scale on the journal board (0.75 -> 45 cm). */
  boardScale: { type: Types.Float32, default: 0.75 },
  /** Sideways distance from the page centre to the reader centre (m). */
  side: { type: Types.Float32, default: 0.24 },
  /** Pull toward the viewer (m). */
  toward: { type: Types.Float32, default: 0.06 },
  lift: { type: Types.Float32, default: 0.03 },
}) {
  private asset?: UIKitMLAsset;
  private ui?: PanelText;
  private entity?: Entity;
  private page?: Entity;
  private mode: Mode = 'none';
  private boardTimer = 0;
  private shownIndex = -1;
  private sideSign = 1;
  private snap = false;
  private disposed = false;
  private pagePos = new Vector3();
  private eye = new Vector3();
  private toEye = new Vector3();
  private right = new Vector3();
  private target = new Vector3();
  private boardQuat = new Quaternion();

  init(): void {
    readerHooks.toggleBoard = (index, board) => this.toggleBoard(index, board);
    readerHooks.boardIndex = () => (this.mode === 'board' ? this.shownIndex + 1 : 0);
    this.cleanupFuncs.push(
      this.queries.pages.subscribe('qualify', (entity) => this.openHeld(entity), true),
      this.queries.pages.subscribe('disqualify', (entity) => {
        if (this.page !== entity) return;
        this.page = undefined;
        for (const other of this.queries.pages.entities) if (other !== entity) this.page = other;
        if (this.page) this.openHeld(this.page);
        else this.close();
      }),
      () => {
        this.disposed = true;
        readerHooks.toggleBoard = undefined;
        readerHooks.boardIndex = undefined;
        this.entity?.dispose({ disposeResources: false });
      },
    );
    void this.world.assets.instantiate<UIKitMLAsset>('page-reader').then((asset) => {
      if (this.disposed) { asset.dispose(); return; }
      this.asset = asset;
      asset.pointerEvents = 'none';
      this.entity = this.world.createTransformEntity(asset, { persistent: true });
      asset.scale.setScalar(this.config.scale.peek());
      this.ui = new PanelText(asset, IDS, 'page-reader');
      this.setVisible(false);
      if (this.page?.active) this.openHeld(this.page);
    }).catch((error: unknown) => console.warn('[Prometheus UI] page-reader failed to load', error));
  }

  private setPage(index: number): boolean {
    const ui = this.ui;
    const text = TEXT[index];
    if (!ui || !text) return false;
    if (index !== this.shownIndex) {
      this.shownIndex = index;
      ui.text('pg-num', text.num);
      ui.text('pg-title', text.title);
      ui.text('pg-author', text.author);
      ui.text('pg-body', text.body);
      if (text.teach) ui.text('pg-teach-text', text.teach);
      ui.style('pg-teach', text.teach ? SHOW : HIDE);
    }
    return true;
  }

  private openHeld(entity: Entity): void {
    this.page = entity;
    if (!this.setPage((entity.getValue(Page, 'index') ?? 1) - 1)) return;
    // Sit on the far side of the holding hand: left hand -> reader to its right.
    const hand = this.world.getSystem(ItemSystem)?.handOf(entity);
    this.sideSign = hand === 'right' ? -1 : 1;
    this.snap = true;
    this.mode = 'held';
    this.asset?.scale.setScalar(this.config.scale.peek());
    this.setVisible(true);
  }

  /** Journal tap on a found page: open it on the board, or close it when it is already open. */
  toggleBoard(pageIndex: number, board: Object3D): void {
    if (this.mode === 'held') return; // a page in hand wins
    const index = pageIndex - 1;
    if (this.mode === 'board' && this.shownIndex === index) {
      this.close();
      return;
    }
    const object = this.entity?.object3D;
    if (!object || !this.setPage(index)) return;
    board.updateWorldMatrix(true, false);
    object.position.copy(BOARD_OFFSET);
    board.localToWorld(object.position);
    board.getWorldQuaternion(this.boardQuat);
    object.quaternion.copy(this.boardQuat);
    this.asset?.scale.setScalar(this.config.boardScale.peek());
    this.mode = 'board';
    this.boardTimer = BOARD_SECONDS;
    this.setVisible(true);
  }

  private close(): void {
    this.mode = 'none';
    this.setVisible(false);
  }

  private setVisible(visible: boolean): void {
    const object = this.entity?.object3D;
    if (object) object.visible = visible;
  }

  update(delta: number): void {
    if (this.mode === 'board') {
      this.boardTimer -= delta;
      if (this.boardTimer <= 0) this.close();
      return;
    }
    if (this.mode !== 'held') return;
    const page = this.page;
    const object = this.entity?.object3D;
    if (!page || !object) return;
    const pageObject = page.object3D;
    if (!page.active || !pageObject) {
      this.page = undefined;
      this.close();
      return;
    }

    pageObject.getWorldPosition(this.pagePos);
    this.camera.getWorldPosition(this.eye);
    this.toEye.subVectors(this.eye, this.pagePos);
    const distance = this.toEye.length();
    if (distance < 1e-4) return;
    this.toEye.divideScalar(distance);
    // Viewer's horizontal right vector: view direction (-toEye) x world up.
    this.right.set(this.toEye.z, 0, -this.toEye.x);
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.right.normalize();

    this.target.copy(this.pagePos)
      .addScaledVector(this.right, this.sideSign * this.config.side.peek())
      .addScaledVector(this.toEye, this.config.toward.peek());
    this.target.y += this.config.lift.peek();

    if (this.snap) {
      object.position.copy(this.target);
      this.snap = false;
    } else {
      object.position.lerp(this.target, 1 - Math.exp(-delta * 18));
    }
    // UIKit panels face +Z; Object3D.lookAt points +Z at the target for non-cameras.
    object.lookAt(this.eye);
  }
}
