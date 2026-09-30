/**
 * The opening journey's registry (design/JOURNEY.md), merged into src/assets.ts.
 * Scene contract: every 'wreck*' node sits at journey.ts WRECK.origin with no rotation;
 * 'journey-markers' sits at the scene origin; 'waystation' and 'waystation-table' at their
 * WAYSTATION placements.
 */
import { planeWreck, wreckDeck, wreckDoorBlocker, wreckWalls } from './plane-wreck.scene-asset.js';
import { journeyMarkers, waystation, waystationTable } from './waystation.scene-asset.js';

export const journeyAssets = {
  'plane-wreck': planeWreck,
  // Invisible: the cabin floor (ItemSurface + LocomotionEnvironment), the hull walls and the
  // door ramp (LocomotionEnvironment), and the doorway blocker JourneySystem removes.
  'wreck-deck': wreckDeck,
  'wreck-walls': wreckWalls,
  'wreck-door-blocker': wreckDoorBlocker,
  waystation,
  'waystation-table': waystationTable,
  'journey-markers': journeyMarkers,
};
