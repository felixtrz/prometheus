/**
 * The journey's scene assets (src/scene-assets/plane-wreck.scene-asset.ts and
 * waystation.scene-asset.ts): the budget (draws, triangles, no lights), the named parts
 * JourneySystem animates, and that the colliders and surfaces fit the journey's data.
 * Scene assets import @iwsdk/core, so they are transpiled into node_modules/.cache (bare
 * imports resolve there), as in scene-assets.test.mjs.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'node_modules/.cache', `journey-asset-tests-${process.pid}`);
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
const wreck = await load('src/scene-assets/plane-wreck.scene-asset.ts');
const station = await load('src/scene-assets/waystation.scene-asset.ts');
const journey = await load('src/game/journey.ts');

const meshesOf = (object) => { const list = []; object.traverse((o) => { if (o.isMesh) list.push(o); }); return list; };
const trianglesOf = (mesh) => (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.getAttribute('position').count) / 3;
const visibleDraws = (object) => meshesOf(object).filter((m) => m.visible).length;
const triangles = (object) => meshesOf(object).filter((m) => m.visible).reduce((sum, m) => sum + trianglesOf(m), 0);

test('every journey prototype is parentless, lightless and cheap', () => {
  const budget = { planeWreck: [6, 30000], waystation: [1, 6000], waystationTable: [1, 400], journeyMarkers: [1, 4000] };
  for (const [name, [draws, tris]] of Object.entries(budget)) {
    const asset = name === 'planeWreck' ? wreck[name] : station[name];
    assert.equal(asset.parent, null, `${name} is parentless`);
    const lights = [];
    asset.traverse((o) => { if (o.isLight) lights.push(o.name); });
    assert.deepEqual(lights, [], `${name}: fire and emergency light are emissive, never a light (the light count is fixed)`);
    assert.ok(visibleDraws(asset) <= draws, `${name}: ${visibleDraws(asset)} draws (max ${draws})`);
    assert.ok(triangles(asset) <= tris, `${name}: ${triangles(asset)} triangles (max ${tris})`);
  }
});

test('the wreck exposes the parts JourneySystem drives', () => {
  for (const name of ['wreck-door-panel', 'wreck-axe-bracket', 'wreck-fire', 'wreck-smoke', 'wreck-lamps']) {
    assert.ok(wreck.planeWreck.getObjectByName(name), `named part ${name}`);
  }
  const uniforms = wreck.wreckUniforms(wreck.planeWreck);
  for (const key of ['time', 'intensity', 'smoke', 'smokeTime', 'glow', 'lamps']) assert.ok(uniforms[key], `uniform ${key}`);
  // The door panel is its own mesh (animated alone), posed ajar at the hinge.
  const panel = wreck.planeWreck.getObjectByName('wreck-door-panel');
  const pose = journey.panelAjar(journey.DOOR.ajarDeg, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  assert.ok(Math.abs(panel.position.x - pose.x) < 1e-6 && Math.abs(panel.rotation.y - pose.ry) < 1e-6);
  const bracket = wreck.planeWreck.getObjectByName('wreck-axe-bracket');
  assert.deepEqual(bracket.position.toArray(), [journey.WRECK.axe.x, journey.WRECK.axe.y, journey.WRECK.axe.z]);
});

test('the colliders are invisible and sized from the journey data', () => {
  for (const name of ['wreckDeck', 'wreckWalls', 'wreckDoorBlocker']) {
    const meshes = meshesOf(wreck[name]);
    assert.ok(meshes.length === 1 && !meshes[0].visible, `${name}: one invisible mesh`);
  }
  const box = new core.Box3().setFromObject(wreck.wreckDeck);
  assert.ok(Math.abs(box.max.y - journey.WRECK.deckY) < 1e-6, 'the deck surface is the cabin floor (ItemSurface uses its top)');
  assert.ok(box.min.x <= journey.WRECK.cabin.x0 && box.max.x >= journey.WRECK.cabin.x1);
  const blocker = new core.Box3().setFromObject(wreck.wreckDoorBlocker);
  assert.ok(blocker.min.x < journey.WRECK.door.x0 && blocker.max.x > journey.WRECK.door.x1, 'the blocker spans the doorway');
  const table = new core.Box3().setFromObject(station.waystationTable);
  assert.ok(Math.abs(table.max.y - journey.WAYSTATION.table.top) < .01, 'the table top where the pack lies');
});
