/**
 * Valley props that items rest on: each is its own scene node with an `ItemSurface`
 * component, so ItemSystem builds a catching top from the prop's bounds and a dropped
 * item lands back where it was found instead of falling inside the prop. Their
 * dressing (lids, lanterns, roots, shadows) stays baked in the region batches.
 * Origins sit on the ground under the prop; the scene node carries position and yaw
 * (placements in valley-layout.scene-asset.ts). Keep anything taller than the top
 * surface out of these prototypes: the surface height is the bounds' top (+ lift).
 * Each prop paints onto one shared material so it costs a single draw.
 */
import { BoxGeometry, CylinderGeometry, Group, IcosahedronGeometry, ShapeGeometry, TorusGeometry } from '@iwsdk/core';
import { batchStatic } from './static-batch.js';
import { flameShape, ledgeRockProp, mats, paint, put } from './valley-kit.scene-asset.js';
import { BROOK, CRATE_STRAW_TOP, GROVE, OUTPOST, SPIRE } from './valley-layout.scene-asset.js';

const box = (w: number, h: number, d: number, color: number, v = .05) => paint(new BoxGeometry(w, h, d), color, v);
const cyl = (top: number, bottom: number, h: number, seg: number, color: number, v = .05) => paint(new CylinderGeometry(top, bottom, h, seg), color, v);
function named(root: Group, name: string): Group {
  const result = batchStatic(root);
  result.name = name;
  return result;
}

/**
 * Salvage crate dimensions (the leaning lid is baked into the outpost batch in front of it).
 * `rim` is the top of the highest wall slat: the bounds' top.
 */
export const CRATE = { width: .9, depth: .52, height: .5, rim: .515 } as const;

/**
 * Open salvage crate, packed almost to the brim with straw so the salvage sits in view.
 * The scene gives it ItemSurface lift = CRATE_STRAW_TOP − CRATE.rim, so items rest on the straw.
 */
function makeSalvageCrate(): Group {
  const root = new Group();
  const { width: W, depth: D, height: H } = CRATE;
  for (let k = 0; k < 3; k++) {
    const y = .06 + k * .16 + .07;
    for (const side of [-1, 1]) {
      put(root, box(W, .13, .025, k % 2 ? 0xa37a4e : 0x94704a), mats.timber, [0, y, side * (D / 2 - .012)]);
      put(root, box(.025, .13, D - .05, k % 2 ? 0x94704a : 0xa37a4e), mats.timber, [side * (W / 2 - .012), y, 0]);
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(root, box(.05, H, .05, 0x7a5236), mats.timber, [sx * (W / 2 - .025), H / 2, sz * (D / 2 - .025)]);
  put(root, box(W - .04, .03, D - .04, 0x7a5236), mats.timber, [0, .05, 0]);
  // Straw bed filling the crate to CRATE_STRAW_TOP, lumpy on top.
  put(root, box(W - .06, CRATE_STRAW_TOP - .08, D - .06, 0xc9aa55, .08), mats.timber, [0, .065 + (CRATE_STRAW_TOP - .08) / 2, 0]);
  for (let i = 0; i < 7; i++) {
    put(root, paint(new IcosahedronGeometry(1, 1), i % 2 ? 0xd9bf6a : 0xc9aa55, .1), mats.timber,
      [-.33 + i * .11, CRATE_STRAW_TOP - .035, ((i % 3) - 1) * .12], [i, i, 0], [.14, .03, .17]);
  }
  for (let i = 0; i < 16; i++) {
    const a = i * 2.39;
    put(root, paint(new CylinderGeometry(.003, .003, .16, 3, 1, true), 0xe0c878, 0), mats.timber, [Math.cos(a) * .38, CRATE_STRAW_TOP - .005, Math.sin(a) * .2], [1.4, a, 0]);
  }
  // Rope handles and the expedition's flame mark on the ends.
  for (const sx of [-1, 1]) put(root, paint(new TorusGeometry(.05, .01, 4, 8, Math.PI), 0xb8a27a, 0), mats.timber, [sx * (W / 2 + .005), .36, 0], [0, Math.PI / 2, 0]);
  put(root, paint(new ShapeGeometry(flameShape(.1)), 0xc8502a, 0), mats.timber, [W / 2 + .001, .2, 0], [0, Math.PI / 2, 0]);
  return named(root, 'Salvage crate');
}

/** Camp table: four planks on crossed legs. Page 5 lies on its top (lantern and cup are batch dressing). */
function makeOutpostTable(): Group {
  const root = new Group();
  const top = OUTPOST.table.top;
  for (let k = 0; k < 4; k++) put(root, box(1.3, .03, .165, k % 2 ? 0x9a6f48 : 0x8a6040), mats.timber, [0, top - .015, -.26 + k * .175]);
  for (const side of [-1, 1]) {
    // Crossed legs stay just under the planks so the top is the bounds' top.
    for (const lean of [-1, 1]) put(root, box(.05, .88, .05, 0x7a5236), mats.timber, [side * .52, top / 2 - .02, 0], [lean * .52, 0, 0]);
    put(root, box(.06, .05, .66, 0x6b4830), mats.timber, [side * .52, top - .055, 0]);
  }
  put(root, box(1.0, .045, .045, 0x6b4830), mats.timber, [0, .3, 0]);
  return named(root, 'Outpost table');
}

/** Page 6's lidded supply box at the lookout's foot. */
function makeSupplyBox(): Group {
  const root = new Group();
  const top = OUTPOST.lookoutBox.top;
  put(root, box(.46, top - .03, .36, 0x94704a), mats.timber, [0, (top - .03) / 2, 0]);
  put(root, box(.5, .03, .4, 0x7a5236), mats.timber, [0, top - .015, 0]);
  for (const sx of [-1, 1]) put(root, box(.04, top - .04, .38, 0x6b4830), mats.timber, [sx * .21, (top - .04) / 2, 0]);
  put(root, paint(new ShapeGeometry(flameShape(.05)), 0xc8502a, 0), mats.timber, [0, .12, .181]);
  return named(root, 'Supply box');
}

/** Iron-hooped water barrel with a lid. */
function makeBarrel(): Group {
  const root = new Group();
  put(root, cyl(.2, .19, .5, 12, 0x8a6040, .08), mats.timber, [0, .25, 0]);
  for (const y of [.08, .42]) put(root, cyl(.205, .205, .03, 12, 0x3a3634, 0), mats.timber, [0, y, 0]);
  put(root, cyl(.19, .19, .01, 12, 0x6b4830, 0), mats.timber, [0, .5, 0]);
  return named(root, 'Barrel');
}

/** Two supply crates stacked square, the upper one marked with the flame. */
function makeCrateStack(): Group {
  const root = new Group();
  put(root, box(.52, .36, .38, 0x94704a), mats.timber, [0, .18, 0]);
  put(root, box(.46, .3, .34, 0xa37a4e), mats.timber, [.02, .51, .01]);
  for (const x of [-.255, .255]) put(root, box(.03, .36, .39, 0x7a5236), mats.timber, [x, .18, 0]);
  put(root, paint(new ShapeGeometry(flameShape(.08)), 0xc8502a, 0), mats.timber, [.02, .46, .182]);
  return named(root, 'Crate stack');
}

/** Page 3's old stump: sawn top with growth rings (its flared base and roots are grove batch dressing). */
function makeGroveStump(): Group {
  const root = new Group();
  const s = GROVE.stump;
  put(root, paint(new CylinderGeometry(s.radius * .92, s.radius * 1.05, s.top, 12), 0x6b4830, .06), mats.bark, [0, s.top / 2, 0]);
  [[1, 0xc28b58], [.74, 0x9f6c42], [.55, 0xc9955f], [.25, 0x93643d]].forEach(([k, color], i) => {
    put(root, paint(new CylinderGeometry(s.radius * .9 * k, s.radius * .9 * k, .004, 14), color, 0), mats.timber, [0, s.top + .002 + i * .0015, 0]);
  });
  return named(root, 'Grove stump');
}

/** Flat-topped brook-side rock for page 4. */
function makePageRock(): Group {
  const root = new Group();
  ledgeRockProp(root, BROOK.pageRock.top, .55, 1);
  return named(root, 'Brook page rock');
}

/** Flat-topped ledge beside the Spire beacon for page 7 (Ilse's satchel is batch dressing). */
function makeSpireLedge(): Group {
  const root = new Group();
  ledgeRockProp(root, SPIRE.ledge.top, .62, 1);
  return named(root, 'Spire ledge');
}

export const salvageCrate = makeSalvageCrate();
export const outpostTable = makeOutpostTable();
export const supplyBox = makeSupplyBox();
export const outpostBarrel = makeBarrel();
export const crateStack = makeCrateStack();
export const groveStump = makeGroveStump();
export const pageRock = makePageRock();
export const spireLedge = makeSpireLedge();
