/** Valley environment registry (owned by the world build). */
import { AssetType } from '@iwsdk/core';
import { woodland } from './woodland.scene-asset.js';
import { valleyColliders, walkableGround } from './valley-ground.scene-asset.js';
import {
  valleyGrove, valleyHorizon, valleyMeadow, valleyOutpost, valleySouth, valleySpire, valleyTrail,
} from './valley-regions.scene-asset.js';
import {
  beaconBrazier, berryBush, brazier, canvasScrap, deadwood, endingSmoke, farPine, flintBed, herbPatch, mushroomPatch, nightSky,
  reedClump, resinScar, valleyBounds, valleyPine, valleyPineTall,
} from './valley-props.scene-asset.js';
import {
  crateStack, groveStump, outpostBarrel, outpostTable, pageRock, salvageCrate, spireLedge, supplyBox,
} from './valley-surfaces.scene-asset.js';

const url = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export const valleyAssets = {
  // Ground (LocomotionEnvironment) and the invisible boundary walls (LocomotionEnvironment too).
  'walkable-ground': walkableGround,
  'valley-bounds': valleyBounds,
  // Invisible trunk/boulder/structure blockers (LocomotionEnvironment).
  'valley-colliders': valleyColliders,
  // Static region batches, each placed at the scene origin.
  woodland,
  'valley-grove': valleyGrove,
  'valley-meadow': valleyMeadow,
  'valley-outpost': valleyOutpost,
  'valley-spire': valleySpire,
  'valley-trail': valleyTrail,
  'valley-south': valleySouth,
  'valley-horizon': valleyHorizon,
  // Resource-node visuals: the source only, one draw each (the grabbable item waits on it).
  deadwood,
  'resin-scar': resinScar,
  'mushroom-patch': mushroomPatch,
  'berry-bush': berryBush,
  'herb-patch': herbPatch,
  'reed-clump': reedClump,
  'flint-bed': flintBed,
  'canvas-scrap': canvasScrap,
  // Props that items rest on (scene nodes carry ItemSurface; see valley-surfaces.scene-asset.ts).
  'salvage-crate': salvageCrate,
  'outpost-table': outpostTable,
  'supply-box': supplyBox,
  'outpost-barrel': outpostBarrel,
  'crate-stack': crateStack,
  'grove-stump': groveStump,
  'page-rock': pageRock,
  'spire-ledge': spireLedge,
  // Braziers ('beacon-flame' child hidden until lit).
  brazier,
  'beacon-brazier': beaconBrazier,
  // Sky and finale: stars + moon (materials 'Night stars', 'Moon', opacity 0), and the south smoke column.
  'night-sky': nightSky,
  'ending-smoke': endingSmoke,
  // Trees: near GLB pines, and single-mesh procedural pines for instanced patterns.
  'pine-1': { type: AssetType.GLTF, url: url('models/pine-1.glb') },
  'pine-2': { type: AssetType.GLTF, url: url('models/pine-2.glb') },
  'valley-pine': valleyPine,
  'valley-pine-tall': valleyPineTall,
  'far-pine': farPine,
};
