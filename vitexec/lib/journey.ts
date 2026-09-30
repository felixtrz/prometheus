/**
 * Start screen, as a player uses it: point the left ray at a button on the start
 * panel and pull the trigger. Gameplay systems hold still until a choice is made.
 */
import { Campfire, GameState } from '/src/game/components.ts';
import { JourneySystem } from '/src/game/systems/journey-system.ts';
import { StartSystem } from '/src/game/systems/start-system.ts';
import {
  check, clickAt, fixture, grab, holster, items, locate, loose, note, one, packState, resuming, shot, sleep, spawnFixture,
  until, waitFor, wearPack, world,
} from '/vitexec/lib/harness.ts';

const DEG = Math.PI / 180;

const BUTTONS = { new: 'Start New Journey Button', continue: 'Start Continue Button' } as const;

/** A resumed run (harness `resuming()`) always continues its checkpoint's save. */
export async function beginJourney(choice: keyof typeof BUTTONS = 'new'): Promise<void> {
  if (resuming()) choice = 'continue';
  const start = world.getSystem(StartSystem)!;
  const name = BUTTONS[choice];
  await until(() => Boolean(world.scene.getObjectByName(name)), 15_000, 'the start panel');
  await sleep(700); // the panel settles in front of the view
  await shot(`start-panel-${choice}`);
  // "New journey" over an existing save asks for a second tap.
  for (let tap = 0; tap < 2 && start.phase === 'waiting'; tap++) {
    await clickAt(locate(name), 'left');
    if (await waitFor(() => start.phase !== 'waiting', 1500)) break;
  }
  await until(() => start.phase === 'running', 10_000, `the ${choice} journey to begin`);
  await sleep(1300); // fade back in
}

/**
 * Fixture for the scenarios that start at camp (everything after the opening): the wreck,
 * the waystation and the forest as if walked (JourneySystem.skipToCamp: objectives done,
 * the door down, the clock released to morning, the keeper at camp), and the camp laid out
 * the way those scenarios expect it: the axe back on the chopping stump, the pack on the
 * trestle, two logs by the stump and a fed fire. vitexec/opening.ts plays the real journey.
 *
 * `equipped` (default) then kits the keeper out the way the journey leaves them: the pack
 * put on and the axe taken from the stump onto the right hip (the lighter is on the left),
 * so scenarios carry what they gather instead of walking one item at a time. Scenarios that
 * test finding the pack pass `{ equipped: false }`.
 */
export async function skipOpening({ equipped = true } = {}): Promise<void> {
  if (resuming()) return; // a checkpoint's save already holds this state
  const journey = world.getSystem(JourneySystem);
  if (!journey) throw new Error('skipOpening: no JourneySystem');
  journey.skipToCamp();
  note('fixture: the opening journey skipped (JourneySystem.skipToCamp)');
  const game = one(GameState);
  fixture(GameState, 'clock', 40, game);
  fixture(GameState, 'day', 1, game);
  const move = (uid: string, p: readonly [number, number, number], rotationDeg: readonly [number, number, number]) => {
    const target = items((i) => i.uid === uid)[0];
    const object = target?.entity.object3D;
    if (!object) throw new Error(`skipOpening: no item ${uid}`);
    object.position.set(...p);
    object.rotation.set(rotationDeg[0] * DEG, rotationDeg[1] * DEG, rotationDeg[2] * DEG);
    note(`fixture: ${uid} moved to ${p.join(', ')}`);
  };
  move('camp-axe', [2.5695, .6194, -3.0928], [-109.737, 15.662, -36.959]);
  move('pack-roll', [1.117, .976, -.7], [0, 90, 0]);
  fixture(Campfire, 'fuel', 90);
  await spawnFixture('log', 2.2, -2.72);
  await spawnFixture('log', 2.42, -2.58);
  await sleep(600);
  if (!equipped) return;
  await wearPack('right');
  await grab(loose('axe'), 'right', 'axe');
  await holster('right', 'right');
  check(items((i) => i.kind === 'axe')[0]?.slot === 'hip-right' && packState() === 'worn', 'kitted out: the pack on the back, the axe on the right hip');
}
