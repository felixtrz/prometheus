/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { LocomotionSystem, TurningMethod, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { ItemSystem } from './game/systems/item-system.js';
import { StorySystem } from './game/systems/story-system.js';
import { BackpackSystem } from './game/systems/backpack-system.js';
import { HolsterSystem } from './game/systems/holster-system.js';
import { CampfireSystem } from './game/systems/campfire-system.js';
import { CraftingSystem } from './game/systems/crafting-system.js';
import { GatherSystem } from './game/systems/gather-system.js';
import { ForestSystem } from './game/systems/forest-system.js';
import { CombatSystem } from './game/systems/combat-system.js';
import { CreatureSystem } from './game/systems/creature-system.js';
import { ButcherSystem } from './game/systems/butcher-system.js';
import { SurvivalSystem } from './game/systems/survival-system.js';
import { DayNightSystem } from './game/systems/daynight-system.js';
import { FxSystem } from './game/systems/fx-system.js';
import { GameAudioSystem } from './game/systems/audio-system.js';
import { JournalSystem } from './game/systems/journal-system.js';
import { WristSystem } from './game/systems/wrist-system.js';
import { ToastSystem } from './game/systems/toast-system.js';
import { ReaderSystem } from './game/systems/reader-system.js';
import { VignetteSystem } from './game/systems/vignette-system.js';
import { GuideSystem } from './game/systems/guide-system.js';
import { StartSystem } from './game/systems/start-system.js';
import { JourneySystem } from './game/systems/journey-system.js';
import { MOVE_SPEED, onSettings, settings, TUNNEL_STRENGTH, TURN_ANGLE } from './game/settings.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  // Registration order matters: systems look up ItemSystem/StorySystem in init().
  // DayNight first: Creature, Guide, Audio and Journal look it up in init() (finale darkness).
  // Priority -0.5 runs it before EnvironmentSystem/LightSystem (0), so sky and light writes land this frame.
  world.registerSystem(DayNightSystem, { priority: -0.5 });
  world.registerSystem(ItemSystem, { priority: 10 });
  world.registerSystem(StorySystem, { priority: 18 });
  world.registerSystem(BackpackSystem, { priority: 11 });
  // After BackpackSystem: the hips follow the body heading it tracks.
  world.registerSystem(HolsterSystem, { priority: 11.2 });
  world.registerSystem(CampfireSystem, { priority: 12 });
  world.registerSystem(CraftingSystem, { priority: 13 });
  // Before GatherSystem (it lands the axe blows on the forest's trees) and FxSystem (it must
  // not instance the GLB pines the forest takes over).
  world.registerSystem(ForestSystem, { priority: 13.5 });
  world.registerSystem(GatherSystem, { priority: 14 });
  world.registerSystem(CombatSystem, { priority: 15 });
  world.registerSystem(CreatureSystem, { priority: 16 });
  // After CreatureSystem: a slain deer or rabbit becomes a Carcass there and is butchered here.
  world.registerSystem(ButcherSystem, { priority: 16.5 });
  // The opening journey (the wreck, the waystation, the forest): after the systems it reads,
  // running before ItemSystem so a door blow and the axe's bracket guard land this frame.
  world.registerSystem(JourneySystem, { priority: 9.5 });
  world.registerSystem(SurvivalSystem, { priority: 17 });
  world.registerSystem(FxSystem, { priority: 25 });
  world.registerSystem(JournalSystem, { priority: 35 });
  world.registerSystem(WristSystem, { priority: 36 });
  world.registerSystem(ToastSystem, { priority: 37 });
  world.registerSystem(ReaderSystem, { priority: 38 });
  world.registerSystem(VignetteSystem, { priority: 39 });
  world.registerSystem(StartSystem, { priority: 33 });
  world.registerSystem(GuideSystem, { priority: 34 });
  world.registerSystem(GameAudioSystem, { priority: 40 });
  // Walking speed, the comfort tunnel and turning follow the player's comfort settings
  // (journal board, start panel, wrist), live; the 5 m/s default shrinks the valley and brings on vection.
  const locomotion = world.getSystem(LocomotionSystem);
  const applyComfort = () => {
    if (!locomotion) return;
    locomotion.config.slidingSpeed.value = MOVE_SPEED[settings.moveSpeed];
    locomotion.config.comfortAssist.value = TUNNEL_STRENGTH[settings.tunnel];
    locomotion.config.turningMethod.value = settings.turn === 'smooth' ? TurningMethod.SmoothTurn : TurningMethod.SnapTurn;
    locomotion.config.turningAngle.value = TURN_ANGLE[settings.turn];
  };
  applyComfort();
  onSettings(applyComfort);
  if (import.meta.env.DEV && import.meta.env.VITE_CAMP_CAPTURE === '1') {
    void import('./dev/capture.js').then(({ attachCapture }) => attachCapture(world));
  }
}).catch((error: unknown) => {
  console.error('[Prometheus] Startup failed', error);
});
