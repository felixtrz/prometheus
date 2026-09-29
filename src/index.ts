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
import { CampfireSystem } from './game/systems/campfire-system.js';
import { CraftingSystem } from './game/systems/crafting-system.js';
import { GatherSystem } from './game/systems/gather-system.js';
import { CombatSystem } from './game/systems/combat-system.js';
import { CreatureSystem } from './game/systems/creature-system.js';
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
import { MOVE_SPEED, onSettings, settings, TUNNEL_STRENGTH } from './game/settings.js';

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
  world.registerSystem(CampfireSystem, { priority: 12 });
  world.registerSystem(CraftingSystem, { priority: 13 });
  world.registerSystem(GatherSystem, { priority: 14 });
  world.registerSystem(CombatSystem, { priority: 15 });
  world.registerSystem(CreatureSystem, { priority: 16 });
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
  // Walking speed and the comfort tunnel follow the player's settings (journal panel);
  // the 5 m/s default shrinks the valley and brings on vection.
  const locomotion = world.getSystem(LocomotionSystem);
  const applyComfort = () => {
    if (!locomotion) return;
    locomotion.config.slidingSpeed.value = MOVE_SPEED[settings.moveSpeed];
    locomotion.config.comfortAssist.value = settings.tunnel ? TUNNEL_STRENGTH : 0;
    locomotion.config.turningMethod.value = settings.turn === 'smooth' ? TurningMethod.SmoothTurn : TurningMethod.SnapTurn;
  };
  applyComfort();
  onSettings(applyComfort);
  if (import.meta.env.DEV && import.meta.env.VITE_CAMP_CAPTURE === '1') {
    void import('./dev/capture.js').then(({ attachCapture }) => attachCapture(world));
  }
}).catch((error: unknown) => {
  console.error('[Prometheus] Startup failed', error);
});
