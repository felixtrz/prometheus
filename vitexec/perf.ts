/**
 * S17, render cost where it peaks: the camp view by day, then at night with the
 * wolves out and the fire lit. Draw calls and triangles come from the renderer's
 * own counters (headless Chromium frame times are not Quest frame times; the
 * budgets below are the Quest ones from design/TECH_PLAN.md).
 *   npm run check -- perf
 */
import { Campfire, Creature, GameState } from '/src/game/components.ts';
import { lightFire } from '/vitexec/lib/camp.ts';
import { beginJourney } from '/vitexec/lib/journey.ts';
import {
  all, boot, check, done, enterXR, fixture, look, nextFrame, note, read, rest, section, shot, sleep, until, walk, world,
} from '/vitexec/lib/harness.ts';

/** GAME_SPEC S17, per view: ≤ 200 draw calls and ≤ 250k triangles. */
const DRAW_BUDGET = 200;
const TRIANGLE_BUDGET = 250_000;

/** Median per-view draw calls/triangles and frame time over `frames` rendered frames. */
async function sample(frames = 60) {
  const info = world.renderer.info;
  // Emulated XR renders each eye separately (no multiview): the counters hold both views.
  const views = world.renderer.xr.isPresenting ? Math.max(1, world.renderer.xr.getCamera().cameras.length) : 1;
  const calls: number[] = [], tris: number[] = [], ms: number[] = [];
  let last = performance.now();
  for (let i = 0; i < frames; i++) {
    await nextFrame();
    const now = performance.now();
    calls.push(Math.round(info.render.calls / views));
    tris.push(Math.round(info.render.triangles / views));
    ms.push(now - last);
    last = now;
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  return { calls: median(calls), triangles: median(tris), frameMs: median(ms), geometries: info.memory.geometries, textures: info.memory.textures };
}

await boot();
await enterXR();
await beginJourney();
await walk([0, 1.6, .8]);
await look([0, 1.2, -2]);
await rest('left');
await rest('right');

section('S17 render cost by day at camp');
const day = await sample();
note(`day, per view: ${day.calls} draws, ${Math.round(day.triangles / 1000)}k tris, ${day.frameMs.toFixed(1)} ms/frame (headless), ${day.geometries} geometries, ${day.textures} textures`);
check(day.calls <= DRAW_BUDGET, `day draws within budget (${day.calls} ≤ ${DRAW_BUDGET})`);
check(day.triangles <= TRIANGLE_BUDGET, `day triangles within budget (${Math.round(day.triangles / 1000)}k ≤ ${TRIANGLE_BUDGET / 1000}k)`);

section('S17 render cost at night with wolves');
await lightFire();
fixture(GameState, 'stage', 3);
fixture(GameState, 'clock', 340);
fixture(Campfire, 'fuel', 100);
await until(() => all(Creature).filter((e) => read(e, Creature).species === 'wolf').length >= 3, 20_000, 'wolves at night');
await sleep(3000);
await look([0, 1, -8]);
const night = await sample();
note(`night, per view: ${night.calls} draws, ${Math.round(night.triangles / 1000)}k tris, ${night.frameMs.toFixed(1)} ms/frame (headless), ${all(Creature).length} creatures`);
await shot('night-cost');
check(night.calls <= DRAW_BUDGET, `night draws within budget (${night.calls} ≤ ${DRAW_BUDGET})`);
check(night.triangles <= TRIANGLE_BUDGET, `night triangles within budget (${Math.round(night.triangles / 1000)}k ≤ ${TRIANGLE_BUDGET / 1000}k)`);
check(night.geometries - day.geometries < 200, `no geometry growth between day and night (+${night.geometries - day.geometries})`);
done('perf');
