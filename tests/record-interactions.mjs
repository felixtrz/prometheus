import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import https from 'node:https';

const exec = promisify(execFile);
const tab = { id: process.env.CAMP_TAB, generation: Number(process.env.CAMP_GENERATION || 1) };
if (!tab.id) throw new Error('Set CAMP_TAB and CAMP_GENERATION from the managed runtime result');
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function cli(domain, action, args = {}) {
  const { stdout } = await exec(process.execPath, ['node_modules/@iwsdk/cli/dist/cli.js', domain, action, '--input-json', JSON.stringify({ ...args, expectedTab: tab }), '--raw'], { maxBuffer: 8_000_000 });
  const data = JSON.parse(stdout);
  if (data.error || data.ok === false) throw new Error(JSON.stringify(data));
  return data;
}
export async function capture(command) {
  return new Promise((resolve, reject) => {
    const req = https.request('https://localhost:8081/__camp-video', { method: 'POST', rejectUnauthorized: false, headers: { 'Content-Type': 'application/json' } }, res => {
      let body = ''; res.on('data', data => body += data); res.on('end', () => {
        const value = JSON.parse(body); if (value.error) reject(new Error(value.error)); else resolve(value);
      });
    }); req.on('error', reject); req.end(JSON.stringify(command));
  });
}
let origin = [0, 0, .4];
export async function syncOrigin() {
  const data = await cli('ecs', 'query', { entityIndex: 2, components: ['Transform'] });
  origin = data.components[0].values.position;
}
export async function move(p, seconds = .7, orientation, device = 'controller-right') {
  await cli('xr', 'animate-to', { device, position: { x: p[0] - origin[0], y: p[1] - origin[1], z: p[2] - origin[2] }, duration: seconds, ...(orientation ? { orientation } : {}) });
}
export async function grip(value, device = 'controller-right') { await cli('xr', 'set-gamepad-state', { device, buttons: [{ index: 1, value }] }); }
export async function item(kind) {
  const found = await cli('ecs', 'find', { namePattern: `^Item ${kind}$` });
  if (found.total !== 1) throw new Error(`Missing item ${kind}`);
  return cli('ecs', 'query', { entityIndex: found.entities[0].entityIndex, components: ['Transform', 'CampItem'] });
}
export async function grab(kind) {
  const status = await cli('xr', 'status'); if (!status.sessionActive) await cli('xr', 'enter');
  const found = await item(kind);
  const p = found.components.find(c => c.componentId === 'Transform').values.position;
  // Aim at exposed surfaces, not inside the mushroom's narrow stem.
  const gripPoint = kind === 'stew' ? [p[0] + .17, p[1] + .015, p[2]] : kind === 'mushroom' ? [p[0], p[1] + .14, p[2]] : p;
  await grip(0); await move(gripPoint, .65, { x: 0, y: 0, z: 0, w: 1 }); await grip(1); await delay(180);
  const held = await cli('ecs', 'find', { withComponents: ['CampItem', 'Grabbed'] });
  if (!held.entities.some(e => e.entityIndex === found.entityIndex)) throw new Error(`Grab failed: ${kind}`);
  return p;
}
export async function state(label) {
  const found = await cli('ecs', 'find', { withComponents: ['CampState'] });
  const data = await cli('ecs', 'query', { entityIndex: found.entities[0].entityIndex, components: ['CampState'] });
  const value = data.components[0].values;
  await mkdir('design/verify/videos', { recursive: true });
  await writeFile(`design/verify/videos/${label}-state.json`, JSON.stringify(value, null, 2));
  console.log(label, JSON.stringify(value)); return value;
}
export async function start(name, title, position, target) {
  await move(position, .4, undefined, 'headset');
  await cli('xr', 'look-at', { device: 'headset', target: { x: target[0] - origin[0], y: target[1] - origin[1], z: target[2] - origin[2] } });
  await capture({ action: 'start', name, title }); await delay(700);
}
export async function stop() { await delay(1000); await capture({ action: 'stop' }); }
function findNamed(node, name) {
  if (node.name === name) return node;
  for (const child of node.children || []) { const found = findNamed(child, name); if (found) return found; }
}
async function clickJournal(name) {
  const tree = await cli('scene', 'runtime-hierarchy', { maxDepth: 10 });
  const button = findNamed(tree, name); if (!button) throw new Error(`Missing ${name}`);
  const transform = await cli('scene', 'transform', { uuid: button.uuid });
  const [x, y, z] = transform.positionRelativeToXROrigin;
  await cli('xr', 'look-at', { device: 'controller-left', target: { x, y, z } });
  await delay(400); await cli('xr', 'set-select-value', { device: 'controller-left', value: 1 });
  await delay(180); await cli('xr', 'set-select-value', { device: 'controller-left', value: 0 });
}

await syncOrigin();
const mode = process.argv[2];
if (mode === 'ingredients') {
  await cli('xr', 'enter');
  await move([1.1, 1.75, -.0], .5, undefined, 'headset');
  await start('01-ingredients', '01  •  Pick up and add ingredients', [2.45, 2.25, .0], [1.15, 1.08, -1.15]);
  for (const kind of ['meat', 'mushroom']) {
    const p = await grab(kind);
    await move([p[0], 1.6, p[2]], .8);
    await move([.25, 1.6, -1.9], 1.3);
    await move([.25, kind === 'mushroom' ? 1.36 : 1.22, -1.9], .65);
    await grip(0); await move([.7, 1.65, -1.3], .55); await delay(500);
  }
  await stop(); await state('01-ingredients');
}
if (mode === 'stir') {
  await start('02-stirring', '02  •  Stir the pot — movement is required', [.85, 2.1, -.95], [.25, 1.18, -1.9]);
  await grab('spoon');
  await move([.43, 1.7, -1.9], 1);
  await move([.43, 1.45, -1.9], .6);
  const before = await state('02-stationary-before'); await delay(1100);
  const stationary = await state('02-stationary-after');
  if (before.stir !== stationary.stir) throw new Error('Stationary spoon advanced cooking');
  for (let i = 1; i <= 46; i++) {
    const angle = i * Math.PI / 10;
    await move([.25 + .18 * Math.cos(angle), 1.45, -1.9 + .18 * Math.sin(angle)], .09);
  }
  await move([.7, 1.65, -1.5], .7); await grip(0);
  await stop(); const result = await state('02-stirring'); if (!result.stewReady) throw new Error('Stew did not finish');
}
if (mode === 'eating') {
  await move([1.45, 1.7, .2], .6, undefined, 'headset');
  await start('03-eating', '03  •  Eat the stew, then lower the empty bowl', [1.45, 1.7, .2], [1.5, 1.12, -.5]);
  await grab('stew'); await move([1.62, 1.315, -.25], .8); await delay(500);
  await move([1.62, 1.565, .03], 1); await delay(1000);
  await move([1.62, 1.265, -.25], .8); await delay(1200); await grip(0);
  await stop(); const result = await state('03-eating'); if (!result.stewEaten || result.hunger !== 100) throw new Error('Meal not eaten');
}
if (mode === 'materials') {
  await start('04-material-placement', '04  •  Place stick, cloth and resin in their matching bays', [-1.25, 2.1, -.15], [-2.1, 1.1, -1.55]);
  for (const [kind, x] of [['stick', -2.98], ['cloth', -2.43], ['resin', -1.87]]) {
    const p = await grab(kind); await move([p[0], 1.8, p[2]], .7);
    await move([x, 1.8, -1.55], 1.4); await move([x, 1.13, -1.55], .8);
    await grip(0); await move([x, 1.7, -1.1], .5); await delay(400);
  }
  await stop(); const result = await state('04-material-placement'); if (result.materials !== 7) throw new Error('Materials not accepted');
}
if (mode === 'hammer') {
  await start('05-hammering', '05  •  Strike with the metal face — three separate strokes', [-.75, 1.9, -.65], [-1.48, 1.14, -1.5]);
  await grab('hammer');
  for (let i = 0; i < 3; i++) {
    await move([-1.10, 1.6, -1.55], .65, { roll: 90 });
    await move([-1.10, 1.19, -1.55], .45, { roll: 90 });
    await delay(i === 0 ? 1000 : 450);
  }
  await move([-1.1, 1.6, -1.1], .7); await grip(0);
  await stop(); const result = await state('05-hammering'); if (!result.torchCrafted || result.strikes !== 3) throw new Error('Torch not crafted');
}
if (mode === 'torch') {
  await start('06-torch-ignition', '06  •  Light the torch head, then carry the flame', [1.15, 1.6, -.6], [.25, .75, -1.9]);
  await grab('torch'); await move([.75, 1.4, -1.1], 1.1);
  await move([.65, .55, -1.9], 1.1, { roll: 90 }); await delay(1300);
  await move([.85, .85, -1.6], 1, { roll: 0 }); await delay(1600); await grip(0);
  await stop(); const result = await state('06-torch-ignition'); if (!result.torchLit) throw new Error('Torch not lit');
}
if (mode === 'reset') {
  await grab('spoon'); await move([1.18, 1.4, -1.85], .8);
  await move([1.12, 1.4, -1.25], .5, undefined, 'controller-left');
  await start('07-journal-reset', '07  •  Reset the completed camp while holding a tool', [1.2, 1.8, -1.05], [1.7, 1.8, -2.35]);
  await delay(800); await clickJournal('Reset Camp Button'); await delay(1200);
  await move([1.0, 1.35, -1.4], .5); await grip(0);
  await stop();
  const result = await state('07-journal-reset');
  if (result.ingredients || result.materials || result.torchLit || result.stewReady || result.hunger !== 65) throw new Error('Reset did not clear state');
  const held = await cli('ecs', 'find', { withComponents: ['CampItem', 'Grabbed'] });
  if (held.total) throw new Error('Reset left an item held');
}
if (mode === 'invalid') {
  await start('08-invalid-release', '08  •  A misplaced ingredient returns to the supply pack', [1.55, 1.85, .4], [1.95, 1.08, -.5]);
  await grab('mushroom'); await move([1.96, 1.5, -.4], .7); await move([2.5, 1.3, -.1], .7);
  await grip(0); await move([2.55, 1.55, -.1], .5); await stop();
  const data = await item('mushroom');
  if (data.components.find(c => c.componentId === 'CampItem').values.accepted) throw new Error('Invalid ingredient accepted');
  await state('08-invalid-release');
}
if (mode === 'wrong-bay') {
  await grab('cloth'); await move([-2.98, 1.65, -1.55], 1.4);
  await start('09-wrong-bay', '09  •  Cloth in the stick bay is rejected and recovered', [-1.8, 1.95, -.35], [-2.5, 1.1, -1.55]);
  await move([-2.98, 1.13, -1.55], .8); await grip(0); await move([-2.55, 1.5, -1.2], .5);
  await delay(800); await move([1.55, 1.85, .4], 1, undefined, 'headset');
  await cli('xr', 'look-at', { device: 'headset', target: { x: 1.96 - origin[0], y: 1.02 - origin[1], z: -.99 - origin[2] } });
  await stop(); const result = await state('09-wrong-bay'); if (result.materials) throw new Error('Wrong bay accepted cloth');
}
if (mode === 'movement') {
  await move([.25, 1.3, .0], .5); await move([-.25, 1.3, .0], .5, undefined, 'controller-left');
  await start('10-locomotion', '10  •  Smooth movement stays supported by the clearing', [0, 1.65, .4], [.25, 1, -1.9]);
  const before = [...origin];
  await cli('xr', 'set-gamepad-state', { device: 'controller-left', axes: [{ index: 0, value: -.35 }] });
  await delay(900); await cli('xr', 'set-gamepad-state', { device: 'controller-left', axes: [{ index: 0, value: 0 }] });
  await delay(1000);
  await cli('xr', 'set-gamepad-state', { device: 'controller-left', axes: [{ index: 0, value: .35 }] });
  await delay(900); await cli('xr', 'set-gamepad-state', { device: 'controller-left', axes: [{ index: 0, value: 0 }] });
  await stop(); await syncOrigin(); console.log('Movement', { before, after: origin });
}
if (mode === 'turn') {
  await start('11-snap-turn', '11  •  Snap turning — release between steps', [0, 1.65, .4], [.25, 1, -1.9]);
  for (const value of [.8, -.8]) {
    await cli('xr', 'set-gamepad-state', { device: 'controller-right', axes: [{ index: 0, value }] });
    await delay(180); await cli('xr', 'set-gamepad-state', { device: 'controller-right', axes: [{ index: 0, value: 0 }] });
    await delay(1100);
  }
  await stop();
}
if (mode === 'exit') {
  await move([1.12, 1.4, -1.25], .5, undefined, 'controller-left');
  await start('12-leave-vr', '12  •  Leave VR through the journal', [1.2, 1.8, -1.05], [1.7, 1.8, -2.35]);
  await clickJournal('Leave VR Button'); await delay(1200); await stop();
  const result = await cli('xr', 'status'); if (result.sessionActive) throw new Error('Leave VR button failed');
  console.log('Leave VR', result.sessionActive);
}
if (mode === 'enter') {
  await capture({ action: 'start', name: '13-enter-vr', title: '13  •  Enter VR through the journal' });
  await delay(1000); await capture({ action: 'click-enter' }); await delay(1500);
  const result = await cli('xr', 'status');
  await stop();
  if (!result.sessionActive) throw new Error('Enter VR button failed');
  console.log('Enter VR', result.sessionActive);
}
