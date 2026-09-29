import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const recipes = await loadTs('src/game/recipes.ts');

test('a freshly deployed sentry comes loaded, within its magazine', () => {
  assert.ok(recipes.SENTRY_STARTER_BOLTS > 0, 'the kit brings a starter load');
  assert.ok(recipes.SENTRY_STARTER_BOLTS <= recipes.SENTRY_CAPACITY);
  // A full bundle still fits on top of the starter load.
  assert.ok(recipes.SENTRY_STARTER_BOLTS + recipes.BOLTS_PER_BUNDLE <= recipes.SENTRY_CAPACITY);
});

test('the magazine shows one bolt tip per two bolts, and one while any are left', () => {
  assert.equal(recipes.SENTRY_TIPS, Math.ceil(recipes.SENTRY_CAPACITY / 2));
  assert.equal(recipes.sentryTips(0), 0);
  assert.equal(recipes.sentryTips(1), 1);
  assert.equal(recipes.sentryTips(2), 1);
  assert.equal(recipes.sentryTips(3), 2);
  assert.equal(recipes.sentryTips(recipes.SENTRY_STARTER_BOLTS), Math.ceil(recipes.SENTRY_STARTER_BOLTS / 2));
  // The starter load runs dry within a stage-3 night (5 wolves): the sentry needs a reload.
  assert.ok(recipes.SENTRY_STARTER_BOLTS < 5);
  assert.equal(recipes.sentryTips(recipes.SENTRY_CAPACITY), recipes.SENTRY_TIPS);
  assert.equal(recipes.sentryTips(99), recipes.SENTRY_TIPS);
  assert.equal(recipes.sentryTips(-3), 0);
});
