/**
 * Start screen, as a player uses it: point the left ray at a button on the start
 * panel and pull the trigger. Gameplay systems hold still until a choice is made.
 */
import { StartSystem } from '/src/game/systems/start-system.ts';
import { clickAt, locate, shot, sleep, until, waitFor, world } from '/vitexec/lib/harness.ts';

const BUTTONS = { new: 'Start New Journey Button', continue: 'Start Continue Button' } as const;

export async function beginJourney(choice: keyof typeof BUTTONS = 'new'): Promise<void> {
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
