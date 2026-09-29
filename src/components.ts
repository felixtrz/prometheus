/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { defineComponents } from '@iwsdk/core';
import {
  Airborne, Backpack, Beacon, Bedroll, Campfire, CraftBench, Creature, CreatureSpawn,
  FireVisual, GameState, Held, Item, ItemSurface, LostPack, Page, ResourceNode, Sentry,
} from './game/components.js';

export default defineComponents([
  Item, Airborne, Campfire, CraftBench, Backpack, ResourceNode, Creature, CreatureSpawn,
  Sentry, Page, Beacon, Bedroll, LostPack, FireVisual, GameState, Held, ItemSurface,
]);
