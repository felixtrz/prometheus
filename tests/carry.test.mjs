import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './helpers/load-ts.mjs';

const carry = await loadTs('src/game/carry.ts');
const { STACK_LIMIT } = await loadTs('src/game/catalog.ts');

const stacks = (...filled) => {
  const out = carry.emptyStacks();
  for (const [index, kind, count, variant = ''] of filled) Object.assign(out[index], { kind, variant, count });
  return out;
};

test('slot names parse into pack and hip indices', () => {
  assert.equal(carry.packIndex('pack-0'), 0);
  assert.equal(carry.packIndex('pack-8'), 8);
  assert.equal(carry.packIndex('pack-9'), -1);
  assert.equal(carry.packIndex('bay-1'), -1);
  assert.equal(carry.hipIndex('hip-left'), 0);
  assert.equal(carry.hipIndex('hip-right'), 1);
  assert.equal(carry.hipIndex(''), -1);
});

test('materials and food stack up to the limit; tools never stack', () => {
  const full = stacks([0, 'stick', STACK_LIMIT], [1, 'stick', 3], [2, 'axe', 1], [3, 'meat', 2, 'roast']);
  assert.equal(carry.fits(full[1], 'stick', ''), true);
  assert.equal(carry.fits(full[0], 'stick', ''), false, `at most ${STACK_LIMIT} per slot`);
  assert.equal(carry.fits(full[2], 'axe', ''), false, 'tools take a slot each');
  assert.equal(carry.fits(full[3], 'meat', ''), false, 'raw meat does not stack on roast meat');
  assert.equal(carry.fits(full[3], 'meat', 'roast'), true);
  assert.equal(carry.fits(full[4], 'axe', ''), true, 'an empty slot takes anything');
  assert.equal(carry.stacksOnto(full[4], 'stick', ''), false);
});

test('stowing prefers the aimed slot, then a stack with room, then the first empty slot', () => {
  const some = stacks([0, 'axe', 1], [2, 'stick', 4], [4, 'stick', STACK_LIMIT]);
  assert.equal(carry.chooseSlot(some, 'stick', '', 6), 6, 'an aimed empty slot');
  assert.equal(carry.chooseSlot(some, 'stick', '', 0), 2, 'aimed at the axe: onto the stick stack');
  assert.equal(carry.chooseSlot(some, 'stick', ''), 2, 'over the shoulder: onto the stack');
  assert.equal(carry.chooseSlot(some, 'resin', ''), 1, 'a new kind: the first empty slot');
  assert.equal(carry.chooseSlot(some, 'hammer', '', 2), 1, 'a tool aimed at a stack takes an empty slot');
  const packed = stacks(...Array.from({ length: 9 }, (_, i) => [i, 'axe', 1]));
  assert.equal(carry.chooseSlot(packed, 'stick', ''), -1, 'full');
  assert.equal(carry.chooseSlot(carry.emptyStacks(), 'pack', ''), -1, 'the pack never goes in itself');
  assert.equal(carry.chooseSlot(carry.emptyStacks(), 'sentry-kit', ''), -1);
});

test('the body heading ignores a glance over the shoulder but follows a real turn', () => {
  assert.equal(carry.followYaw(0, 1, 1 / 72), 0, 'a 57° glance leaves the body');
  const dragged = carry.followYaw(0, 2, 1 / 72);
  assert.ok(Math.abs(dragged - (2 - carry.BODY_LIMIT)) < 1e-9, 'past the limit the body is dragged along');
  let body = 0;
  for (let i = 0; i < 72 * 5; i++) body = carry.followYaw(body, .3, 1 / 72);
  assert.ok(Math.abs(body - .3) < .02, `looking roughly ahead the body settles (${body.toFixed(3)})`);
  const wrapped = carry.followYaw(3, -3, 1 / 72);
  assert.ok(Math.abs(wrapped - 3) < .01, 'across ±π the difference is small: no spin');
});
