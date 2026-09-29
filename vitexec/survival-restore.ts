/**
 * S15, second half: after the runner reloads the page, the journey resumes from
 * the save survival.ts left behind.
 */
import { GameState } from '/src/game/components.ts';
import { boot, check, done, enterXR, item, loose, section, state, waitFor } from '/vitexec/lib/harness.ts';
import { beginJourney } from '/vitexec/lib/journey.ts';

await boot();
section('S15 progress survives a reload');
check(state(GameState).objectives === 0, 'after a reload the world waits at the start screen (no silent resume)');
await enterXR();
await beginJourney('continue');
const expected = JSON.parse(sessionStorage.getItem('vitexec.survival') ?? 'null');
check(expected, 'the pre-reload snapshot is available');
const restored = await waitFor(() => state(GameState).objectives === expected.objectives, 5000);
const game = state(GameState);
check(restored && game.pages === expected.pages && game.recipes === expected.recipes,
  `objectives/pages/recipes restored (${game.objectives}/${game.pages}/${game.recipes})`);
check(item(loose('meat')).slot === expected.meatSlot, `the pack still holds the meat in ${expected.meatSlot}`);
done('survival-restore');
