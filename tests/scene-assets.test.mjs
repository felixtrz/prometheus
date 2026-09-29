/**
 * World and VFX prototypes (src/scene-assets) and the main scene's lights: the S17 budget
 * choices and the look-alike rules that are easy to undo by accident.
 * Scene assets import @iwsdk/core, so they are transpiled into the project's own
 * node_modules/.cache (bare imports resolve there) rather than a temp dir.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'node_modules/.cache', `scene-asset-tests-${process.pid}`);
const done = new Set();
after(() => rmSync(out, { recursive: true, force: true }));
function transpile(file) {
  if (done.has(file)) return;
  done.add(file);
  const source = readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  const target = join(out, relative(root, file)).replace(/\.ts$/, '.js');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, outputText);
  for (const match of source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)\.js['"]/g)) transpile(resolve(dirname(file), `${match[1]}.ts`));
}
async function load(path) {
  const entry = resolve(root, path);
  transpile(entry);
  return import(pathToFileURL(join(out, relative(root, entry)).replace(/\.ts$/, '.js')).href);
}

const core = await import('@iwsdk/core');
const props = await load('src/scene-assets/valley-props.scene-asset.ts');
const camp = await load('src/scene-assets/camp-props.scene-asset.ts');
const items = await load('src/scene-assets/items.scene-asset.ts');
const kit = await load('src/scene-assets/valley-kit.scene-asset.ts');
const scene = JSON.parse(readFileSync(join(root, 'public/scenes/main.iwsdk.scene.json'), 'utf8'));

const meshesOf = (object) => { const list = []; object.traverse((o) => { if (o.isMesh) list.push(o); }); return list; };
const trianglesOf = (mesh) => (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.getAttribute('position').count) / 3;
function walk(nodes, visit) { for (const node of nodes) { visit(node); walk(node.children ?? [], visit); } }

test('two dynamic point lights at most: the campfire glow and the roaming flame light', () => {
  const scenePointLights = [];
  walk(scene.nodes, (node) => {
    const components = node.components ?? {};
    if (components.PointLight || components['com.iwsdk.components.PointLight']) scenePointLights.push(node.id);
  });
  assert.deepEqual(scenePointLights, ['held-light'], 'the beacon is lit by emissive and halo, not its own light');
  const campfireLights = [];
  camp.campfire.traverse((o) => { if (o.isPointLight) campfireLights.push(o.name); });
  assert.deepEqual(campfireLights, ['fire-glow']);
});

test('forage nodes show their SOURCE only: no pickable copies around the one real item', () => {
  const HARVEST_PARTS = ['resin', 'mushrooms', 'berries', 'herbs', 'reeds', 'flint', 'canvas'];
  for (const [name, node] of Object.entries({
    resinScar: props.resinScar, mushroomPatch: props.mushroomPatch, berryBush: props.berryBush, herbPatch: props.herbPatch,
    reedClump: props.reedClump, flintBed: props.flintBed, canvasScrap: props.canvasScrap,
  })) {
    for (const part of HARVEST_PARTS) assert.equal(node.getObjectByName(part), undefined, `${name} has no '${part}' copies`);
    assert.equal(meshesOf(node).length, 1, `${name} is one draw`);
  }
});

test('the campfire folds into a few draws; its logs are charred, its tongues transparent and single-pass', () => {
  const statics = camp.campfire.children.filter((o) => o.isMesh && o.name.startsWith('static-'));
  assert.ok(statics.length <= 2, `static draws: ${statics.length}`);
  for (let i = 0; i < 4; i++) {
    const flame = camp.campfire.getObjectByName(`flame-${i}`);
    assert.ok(flame?.material.transparent && flame.material.forceSinglePass, `flame-${i}`);
  }
  const bed = meshesOf(camp.campfire.getObjectByName('embers'));
  assert.equal(bed.length, 1, 'the glowing bed is one draw');
  assert.ok(bed[0].geometry.boundingSphere.radius < .4, 'no wide, bright core disc');
  assert.ok(camp.campfire.getObjectByName('broth'), 'FxSystem tints the broth');
});

test('braziers burn with soft transparent tongues, rising wisps and a halo, never opaque cones', () => {
  for (const brazier of [props.brazier, props.beaconBrazier]) {
    const flame = brazier.getObjectByName('beacon-flame');
    assert.ok(flame && !flame.visible, 'hidden until lit');
    const layers = meshesOf(flame);
    assert.deepEqual(layers.map((mesh) => mesh.name), ['tongues', 'core', 'wisps'], 'three layers, three draws');
    for (const mesh of layers) {
      assert.ok(mesh.material.transparent && !mesh.material.depthWrite, `${mesh.name} is transparent`);
      assert.ok(mesh.material.uniforms?.uTime, `${mesh.name} animates (FxSystem drives uTime)`);
    }
    assert.equal(layers[0].geometry.getAttribute('normal')?.count, layers[0].geometry.getAttribute('position').count, 'tongues carry normals for their soft edges');
    assert.ok(brazier.getObjectByName('beacon-halo'), 'halo card');
  }
});

test('lit fuel beds glow as charcoal between charred sticks, never as a pale plate', () => {
  for (const brazier of [props.brazier, props.beaconBrazier]) {
    const coals = meshesOf(brazier).filter((mesh) => mesh.material.name.toLowerCase().includes('coal'));
    assert.equal(coals.length, 1, 'one draw of charcoal FxSystem can make glow');
    const colors = coals[0].geometry.getAttribute('color');
    let brightest = 0;
    for (let i = 0; i < colors.count; i++) brightest = Math.max(brightest, colors.getX(i), colors.getY(i), colors.getZ(i));
    assert.ok(brightest < .06, `only dark charcoal carries the glow (brightest ${brightest.toFixed(3)})`);
  }
});

test('the reed clump leaves the cord\'s spot clear, and every clump turns it to dry land', async () => {
  const mesh = meshesOf(props.reedClump)[0];
  const p = mesh.geometry.getAttribute('position');
  let nearest = Infinity;
  // Anything standing 5 cm above the bank (which rises toward +Z) counts as a stem.
  const bank = (z) => Math.max(0, z) * props.REED_CLUMP.bank;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > .05 + bank(p.getZ(i))) nearest = Math.min(nearest, Math.hypot(p.getX(i), p.getZ(i)));
  assert.ok(nearest > .25, `no stem rises within ${nearest.toFixed(2)} m of the cord (origin)`);
  const terrain = await load('src/game/terrain.ts');
  let clumps = 0;
  walk(scene.nodes, (node) => {
    if (node.content?.asset !== 'reed-clump') return;
    clumps++;
    const [x, , z] = node.transform.position, yaw = node.transform.rotationDeg[1] * Math.PI / 180;
    const here = terrain.brookNearest(x, z), ahead = terrain.brookNearest(x + Math.sin(yaw) * .5, z + Math.cos(yaw) * .5);
    assert.ok(ahead > here + .35, `${node.id}: +Z (the cord's side) points away from the brook`);
  });
  assert.equal(clumps, 3);
});

test('journal pages carry a faint warm self-light through their own ink', () => {
  const page = meshesOf(items.itemAssets.page)[0];
  assert.ok(page.material.emissiveIntensity > .1 && page.material.emissiveIntensity < .35, 'subtle');
  assert.equal(page.material.emissiveMap, page.material.map, 'the writing stays dark');
});

test('the pack roll is a leather roll (no spiral), about the old size', () => {
  const box = new core.Box3().setFromObject(items.itemAssets['pack-roll']);
  const size = box.getSize(new core.Vector3());
  assert.ok(size.x > .5 && size.x < .62, `length ${size.x.toFixed(3)}`);
  assert.ok(size.y < .32 && size.z < .32, `section ${size.y.toFixed(3)} × ${size.z.toFixed(3)}`);
  assert.ok(box.max.y > .17 && box.max.y < .22, 'the carry loop stands where the old handle did');
});

test('ground stones are never flint-sized', () => {
  const group = new core.Group();
  assert.equal(kit.pebble(group, 0, 0, .05, 0), undefined, 'small chips are dropped');
  const stone = kit.pebble(group, 0, 0, .1, 0);
  assert.ok(stone.scale.x >= .12, 'kept stones are at least 12 cm');
});

test('repeated trees stay cheap (S17)', () => {
  assert.ok(trianglesOf(props.farPine) <= 50, `far pine ${trianglesOf(props.farPine)}`);
  assert.ok(trianglesOf(props.valleyPine) <= 200, `valley pine ${trianglesOf(props.valleyPine)}`);
  assert.ok(trianglesOf(props.valleyPineTall) <= 170, `tall pine ${trianglesOf(props.valleyPineTall)}`);
  let far = 0, valley = 0;
  walk(scene.nodes, (node) => {
    if (node.content?.type !== 'pattern') return;
    const count = node.content.distribution.transforms.length;
    if (node.content.prefab === 'far-pine') far += count; else valley += count;
  });
  assert.equal(far, 335, 'split belts keep every far pine');
  assert.equal(valley, 135, 'split stands keep every valley pine');
});
