import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the actual pure rules on every supported Node version (including Node 20).
const source = readFileSync(new URL('../src/game/rules.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { CAMP, ingredientBit, inFire, inMaterialSlot, inPot, materialSlot, stirTravel } =
  await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('pot rejects far, too low, and too high releases', () => {
  assert.ok(inPot(CAMP.pot.x, CAMP.pot.y, CAMP.pot.z));
  assert.equal(inPot(CAMP.pot.x + 0.4, CAMP.pot.y, CAMP.pot.z), false);
  assert.equal(inPot(CAMP.pot.x, 0.3, CAMP.pot.z), false);
  assert.equal(inPot(CAMP.pot.x, 1.9, CAMP.pot.z), false);
});
test('recipe kinds cannot enter the wrong adjacent bay', () => {
  for (const kind of ['stick', 'cloth', 'resin']) {
    const slot = materialSlot(kind);
    assert.ok(inMaterialSlot(slot, CAMP.bench.x + CAMP.slotOffsets[slot], CAMP.bench.y, CAMP.bench.z));
    assert.equal(inMaterialSlot((slot + 1) % 3, CAMP.bench.x + CAMP.slotOffsets[slot], CAMP.bench.y, CAMP.bench.z), false);
  }
  assert.equal(materialSlot('meat'), -1);
  assert.equal(ingredientBit('cloth'), 0);
});
test('stirring crosses angle wrap, requires motion, and rejects teleports', () => {
  assert.ok(Math.abs(stirTravel(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 1e-8);
  assert.equal(stirTravel(1, 1), 0);
  assert.equal(stirTravel(0, Math.PI), 0);
});
test('ignition volume excludes the suspended pot and ground', () => {
  assert.ok(inFire(CAMP.fire.x, CAMP.fire.y, CAMP.fire.z));
  assert.equal(inFire(CAMP.pot.x, CAMP.pot.y, CAMP.pot.z), false);
  assert.equal(inFire(CAMP.fire.x, 0.1, CAMP.fire.z), false);
});
