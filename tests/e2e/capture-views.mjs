/**
 * Runtime (system-driven) screenshots from the player's eye in emulated XR, for
 * review and verification evidence.  node tests/e2e/capture-views.mjs [outDir]
 */
import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { cli, delay, enterXR, find, look, move, pinRuntime, setOn, syncOrigin } from './harness.mjs';
import { loadTs } from '../helpers/load-ts.mjs';

const { terrainHeight, LANDMARKS } = await loadTs('src/game/terrain.ts');
const out = process.argv[2] ?? 'design/verify/v2';
mkdirSync(out, { recursive: true });
const eye = (x, z, h = 1.62) => [x, terrainHeight(x, z) + h, z];
const at = (x, z, h = 1) => [x, terrainHeight(x, z) + h, z];

async function shot(name, head, target, wait = 900) {
  await move(head, .2, undefined, 'headset');
  await look(target);
  await delay(wait);
  await new Promise((resolve, reject) => execFile(process.execPath, ['node_modules/@iwsdk/cli/dist/cli.js', 'browser', 'screenshot', '--input-json', '{}', '--output-file', `${out}/${name}.png`], (error) => (error ? reject(error) : resolve())));
  console.log('  shot', name);
}

await pinRuntime();
await enterXR();
await syncOrigin();
// Hands low and out of frame.
await move([.2, .6, .6], .2, undefined, 'controller-right');
await move([-.2, .6, .6], .2, undefined, 'controller-left');

await setOn('GameState', 'clock', 60);
await delay(1500);
await shot('01-camp-day', [0, 1.6, .9], [.25, .9, -1.9], 1500);
await shot('02-bench', [-1.55, 1.55, -.45], [-2.15, .95, -1.55]);
await shot('03-pack-trestle', [1.55, 1.55, .35], [1.96, .85, -.7]);
await shot('04-camp-home', [.3, 1.6, -.4], [-.6, .4, -3.1]);
await shot('05-trail-north', [0, 1.65, .4], [.8, 2.2, -24]);
await shot('06-grove', eye(-12.5, -6.5), at(-17, -11, 1.1));
await shot('07-meadow', eye(10.5, -10), at(16, -15, .8));
await shot('08-brook', eye(16.5, -7.5), at(20.9, -12, .3));
await shot('09-outpost', eye(-.5, -27.5), at(-4.3, -33, 1.2));
await shot('10-spire', eye(5, -45), [5, 7.4, -52.2]);
await shot('11-journal', [1.25, 1.55, -1.15], [1.75, 1.5, -2.45]);

// Night: the fire and a prowling wolf at stage 1.
await setOn('GameState', 'stage', 1);
await setOn('GameState', 'clock', 342);
await delay(6000);
await shot('12-camp-night', [0, 1.6, .9], [.25, .9, -1.9], 1500);
const wolves = await find(['Creature']);
if (wolves.total) {
  const data = await cli('ecs', 'query', { entityIndex: wolves.entities[0].entityIndex, components: ['Transform'] });
  const p = data.components[0].values.position;
  await shot('13-night-wolf', [(p[0] + .25) / 2, 1.6, (p[2] - 1.9) / 2], [p[0], p[1] + .5, p[2]], 1200);
}
// Wrist band: left hand raised, palm in, in front of the face.
await move([-.12, 1.35, .45], .3, { x: .38, y: .38, z: .6, w: .6 }, 'controller-left');
await shot('14-wrist-night', [0, 1.6, .9], [-.1, 1.35, .45], 900);
await setOn('GameState', 'clock', 60);
console.log('captured to', out);
