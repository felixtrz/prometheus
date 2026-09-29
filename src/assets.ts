import { defineAssets } from '@iwsdk/core';
import { campfire, bench, backpack } from './scene-assets/camp-props.scene-asset.js';
import { itemAssets } from './scene-assets/items.scene-asset.js';
import { valleyAssets } from './scene-assets/valley-assets.js';
import { audioAssets } from './game/audio-assets.js';
import { uiAssets } from './game/ui-assets.js';
import { guideAssets } from './game/guide-assets.js';
import { creatureAssets } from './scene-assets/creatures.scene-asset.js';
import { supplyStand, strikingPad } from './scene-assets/camp-stage.scene-asset.js';
import { bedroll, choppingStump, journalBoard } from './scene-assets/camp-dressing.scene-asset.js';

// Each feature module owns one registry record; this file only merges them.
// Owners: camp (here), items, creatures, valley, audio, ui. See design/ARCHITECTURE.md.
const campAssets = {
  campfire, bench, backpack,
  'supply-stand': supplyStand, 'striking-pad': strikingPad,
  bedroll, 'chopping-stump': choppingStump, 'journal-board': journalBoard,
};

export default defineAssets({
  ...campAssets,
  ...itemAssets,
  ...valleyAssets,
  ...creatureAssets,
  ...audioAssets,
  ...uiAssets,
  ...guideAssets,
});
